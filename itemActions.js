import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
import { saveData, saveSession } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache, sortedNotesCache } from './renderer.js';
// [CRITICAL BUG FIX] 삭제 전 unsaved 변경사항 확인을 위해 confirmNavigation 함수를 임포트합니다.
import { changeActiveFolder, confirmNavigation } from './navigationActions.js';

// [CRITICAL BUG FIX] 모든 데이터 저장 작업을 순서대로 처리하기 위한 전역 비동기 잠금(Lock)
let globalSaveLock = Promise.resolve();


/**
 * [Critical 버그 수정] 앱의 전체 상태(활성 노트, 휴지통)를 확인하여
 * 충돌하지 않는 고유한 ID를 생성하고 반환합니다.
 * 이 함수는 ID 충돌로 인한 데이터 유실을 방지합니다.
 */
const generateUniqueId = (prefix) => {
    const basePrefix = prefix || CONSTANTS.ID_PREFIX.NOTE;
    // crypto.randomUUID()가 가장 이상적이지만, 모든 환경에서 지원되지는 않음
    if (typeof crypto?.randomUUID === 'function') {
        let id;
        do {
            id = crypto.randomUUID();
        } while (state.noteMap.has(id) || state.trash.some(item => item.id === id));
        return id;
    }
    
    // 대체 수단
    let id;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;
    do {
        id = `${basePrefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        if (attempts++ > MAX_ATTEMPTS) {
            console.error("고유 ID 생성에 실패했습니다. 매우 드문 경우입니다.");
            id += `-${Math.random().toString(36).substring(2, 15)}`;
            break; 
        }
    } while (state.noteMap.has(id) || state.trash.some(item => item.id === id));
    
    return id;
};

// [BUG 1 FIX] 날짜를 'YYYY-MM-DD' 형식으로 변환하는 유틸리티 함수 수정
export const toYYYYMMDD = (dateInput) => {
    if (!dateInput) return null;
    // [수정] new Date()는 이미 로컬 시간대를 기준으로 동작합니다.
    const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return null;

    // [수정] toISOString() 대신 로컬 시간대의 년/월/일을 직접 가져옵니다.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// [추가] state.js에서 이동해온 함수. 노트 생성 날짜 Set을 다시 빌드합니다.
export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
    // 활성 노트와 휴지통에 있는 노트를 모두 포함하여 날짜를 계산합니다.
    const allNotes = [...Array.from(state.noteMap.values()).map(e => e.note), ...state.trash.filter(i => i.type === 'note')];
    
    for (const note of allNotes) {
        if (note.createdAt) {
            const dateStr = toYYYYMMDD(note.createdAt);
            if (dateStr) {
                state.noteCreationDates.add(dateStr);
            }
        }
    }
};

const animateAndRemove = (itemId, onAfterAnimate) => {
    onAfterAnimate();
};


// --- Promise 기반 이름 변경 동기화 ---
let pendingRenamePromise = null;
// [CRITICAL BUG 2 FIX] 외부에서 이름 변경 Promise를 제어하기 위한 변수 추가
let resolvePendingRename = null;

// [CRITICAL BUG 2 FIX] 다중 탭 교착 상태를 해결하기 위해 Promise를 강제로 완료하는 함수
export const forceResolvePendingRename = () => {
    if (resolvePendingRename) {
        console.warn("Force resolving a pending rename operation due to external changes.");
        // 이름 변경 상태를 즉시 초기화하여 추가적인 문제를 방지합니다.
        setState({ renamingItemId: null });
        resolvePendingRename(); // 대기 중인 모든 함수를 즉시 해제합니다.
        // 제어 변수들을 정리합니다.
        resolvePendingRename = null;
        pendingRenamePromise = null;
    }
};

// [개선] 다른 파일에서 재사용할 수 있도록 export 추가
export const finishPendingRename = async () => {
    if (state.renamingItemId && pendingRenamePromise) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur(); // blur 이벤트가 _handleRenameEnd를 트리거하고 promise를 resolve합니다.
            await pendingRenamePromise; // resolve될 때까지 기다립니다.
        } else {
            // DOM 요소가 이미 사라진 경우 (예: 다른 탭에서 삭제됨) 교착 상태에 빠질 수 있으므로 강제 해결
            forceResolvePendingRename();
        }
    }
};

// 달력 UI 갱신을 위한 함수를 저장할 변수
let calendarRenderer = () => {};

export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [Critical 버그 수정] 데이터 무결성을 위한 원자적 업데이트 함수
const performTransactionalUpdate = async (updateFn) => {
    await globalSaveLock;
    let releaseLock;
    globalSaveLock = new Promise(resolve => { releaseLock = resolve; });

    let success = false;
    try {
        setState({ isPerformingOperation: true });

        // 1. 저장소에서 최신 데이터를 읽어옵니다.
        const storageResult = await chrome.storage.local.get('appState');
        const latestData = storageResult.appState || { folders: [], trash: [], favorites: [] };

        // 2. 최신 데이터를 기반으로 업데이트 로직을 수행합니다. (updateFn 콜백)
        const result = await updateFn(JSON.parse(JSON.stringify(latestData)));
        
        // 사용자가 작업을 취소한 경우 (예: 프롬프트에서 '취소')
        if (result === null) {
            return false;
        }

        const { newData, successMessage, postUpdateState } = result;
        
        // 3. 변경된 데이터를 저장소에 다시 씁니다.
        const timestamp = Date.now();
        newData.lastSavedTimestamp = timestamp;
        await chrome.storage.local.set({ appState: newData });
        
        // 4. 현재 탭의 state를 최신 데이터와 세션 정보로 업데이트합니다.
        setState({
            ...state, // 활성 폴더/노트 등 UI 상태는 유지
            folders: newData.folders,
            trash: newData.trash,
            favorites: new Set(newData.favorites || []),
            lastSavedTimestamp: timestamp,
            ...postUpdateState // UI 변경이 필요한 추가 상태
        });
        
        // 5. 파생 데이터 및 UI 갱신
        buildNoteMap();
        updateNoteCreationDates();
        calendarRenderer(true);

        if (successMessage) {
            showToast(successMessage);
        }
        success = true;

    } catch (e) {
        console.error("Transactional update failed:", e);
        showToast("오류가 발생하여 작업을 완료하지 못했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        success = false;
    } finally {
        setState({ isPerformingOperation: false });
        releaseLock();
    }
    return success;
};

// --- 상태 변경 및 저장을 위한 헬퍼 함수 ---
// [Critical 버그 수정] commitChanges가 트랜잭션으로 동작하도록 수정 및 전역 잠금 적용
export const commitChanges = async (newState = {}) => {
    // 이전 작업이 끝날 때까지 기다림
    await globalSaveLock;

    let releaseLock;
    // 현재 작업을 위한 새 잠금 생성
    globalSaveLock = new Promise(resolve => {
        releaseLock = resolve;
    });
    
    let success = false;
    try {
        setState({ isPerformingOperation: true }); // 트랜잭션 시작 플래그
        clearSortedNotesCache();
        state._virtualFolderCache.recent = null;
        state._virtualFolderCache.favorites = null;
        state._virtualFolderCache.all = null;
        // [버그 수정] 휴지통 캐시도 함께 초기화하여 삭제 후 UI가 즉시 갱신되도록 합니다.
        state._virtualFolderCache.trash = null;

        setState(newState); // 메모리 상태 변경
        success = await saveData(); // 영구 저장 및 성공 여부 확인
    } finally {
        setState({ isPerformingOperation: false }); // 트랜잭션 종료 플래그
        releaseLock(); // 잠금 해제
    }
    return success;
};

// --- 공통 후처리 로직 추상화 ---
const finalizeItemChange = async (newState = {}, successMessage = '') => {
    // [HIGH BUG FIX] 상태 변경을 먼저 실행하고, 그 후에 파생 데이터를 계산하도록 순서 변경
    await commitChanges(newState);
    
    // 이제 새로운 state를 기반으로 날짜 데이터를 다시 계산하고 달력을 렌더링합니다.
    updateNoteCreationDates();
    calendarRenderer(true);

    if (successMessage) {
        showToast(successMessage);
    }
};

// --- 노트 관련 액션을 위한 고차 함수 ---
const withNote = async (noteId, action) => {
    await finishPendingRename();
    const { item: note } = findNote(noteId);
    if (note) {
        await action(note);
        await commitChanges();
    }
};

// 확인 절차와 실행 로직을 결합한 고차 함수
async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) {
        await action();
    }
}

// 아이템을 휴지통으로 이동시키는 헬퍼 함수
const moveItemToTrash = (item, type, originalFolderId = null) => {
    item.type = type;
    item.deletedAt = Date.now();
    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        item.originalFolderId = originalFolderId;
    }
    state.trash.unshift(item);
};

// --- 이벤트 핸들러 (저장 로직 제외) ---

export const handleRestoreItem = async (id) => {
    await finishPendingRename();

    const updateLogic = async (latestData) => {
        const { folders, trash } = latestData;
        const itemIndex = trash.findIndex(item => item.id === id);
        if (itemIndex === -1) return null; // 아이템이 다른 탭에서 이미 복원/삭제됨

        const itemToRestore = trash.splice(itemIndex, 1)[0];
        const postUpdateState = {}; // 복원 후 UI 상태 변경을 위한 객체

        // --- 폴더 복원 로직 ---
        if (itemToRestore.type === 'folder') {
            let finalFolderName = itemToRestore.name;
            const allNoteIdsInLiveFolders = new Set(folders.flatMap(f => f.notes.map(n => n.id)));

            if (folders.some(f => f.id === itemToRestore.id)) {
                const oldId = itemToRestore.id;
                itemToRestore.id = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER);
                console.warn(`복원 중 폴더 ID 충돌 발생. '${oldId}' -> '${itemToRestore.id}' (으)로 재할당됨.`);
            }

            if (folders.some(f => f.name === itemToRestore.name)) {
                const newName = await showPrompt({
                    title: '📁 폴더 이름 중복',
                    message: `'${itemToRestore.name}' 폴더가 이미 존재합니다. 복원할 폴더의 새 이름을 입력해주세요.`,
                    initialValue: `${itemToRestore.name} (복사본)`,
                    validationFn: (value) => {
                        const trimmedValue = value.trim();
                        if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
                        if (folders.some(f => f.name === trimmedValue)) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
                        return { isValid: true };
                    }
                });
                if (!newName) return null; // 사용자가 취소
                finalFolderName = newName.trim();
            }

            itemToRestore.name = finalFolderName;
            
            itemToRestore.notes.forEach(note => {
                if (allNoteIdsInLiveFolders.has(note.id)) {
                    const oldNoteId = note.id;
                    note.id = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE);
                    console.warn(`폴더 복원 중 포함된 노트의 ID 충돌 발생. '${oldNoteId}' -> '${note.id}' (으)로 재할당됨.`);
                }
                delete note.deletedAt; delete note.type; delete note.originalFolderId;
            });

            delete itemToRestore.deletedAt; delete itemToRestore.type;
            folders.unshift(itemToRestore);
            
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestore.name), postUpdateState };

        // --- 노트 복원 로직 ---
        } else if (itemToRestore.type === 'note') {
            const originalFolder = folders.find(f => f.id === itemToRestore.originalFolderId);
            let targetFolder = null;

            if (originalFolder) {
                targetFolder = originalFolder;
            } else {
                const newFolderId = await showFolderSelectPrompt({
                    title: '🤔 원본 폴더를 찾을 수 없음',
                    message: '이 노트의 원본 폴더가 없거나 휴지통에 있습니다. 복원할 폴더를 선택해주세요.'
                });
                if (!newFolderId) return null; // 사용자가 취소
                targetFolder = folders.find(f => f.id === newFolderId);
            }

            if (!targetFolder) {
                await showAlert({ title: '오류', message: '선택한 폴더를 찾을 수 없어 복원에 실패했습니다.' });
                trash.splice(itemIndex, 0, itemToRestore); // 작업 실패 시 아이템 원위치
                return null;
            }

            const allNoteIdsInLiveFolders = new Set(folders.flatMap(f => f.notes.map(n => n.id)));
            if (allNoteIdsInLiveFolders.has(itemToRestore.id)) {
                const oldId = itemToRestore.id;
                itemToRestore.id = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE);
                console.warn(`노트 복원 중 ID 충돌 발생. '${oldId}' -> '${itemToRestore.id}' (으)로 재할당됨.`);
            }

            delete itemToRestore.deletedAt; delete itemToRestore.type; delete itemToRestore.originalFolderId;
            
            targetFolder.notes.unshift(itemToRestore);
            
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestore.title), postUpdateState };
        }
        return null;
    };
    
    await performTransactionalUpdate(updateLogic);
    saveSession();
};

const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;

    // [High 버그 수정] 삭제될 노트를 제외한 새로운 리스트를 기준으로 인덱스를 찾음
    const futureNotesInView = notesInView.filter(n => n.id !== deletedNoteId);
    if(futureNotesInView.length === 0) return null;

    const deletedIndexInOriginalView = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndexInOriginalView === -1) {
        // 이 경우는 거의 없지만, 안전장치로 첫 번째 노트를 반환
        return futureNotesInView[0].id;
    }

    // 다음 아이템은 원래 인덱스에 위치하거나, 마지막 아이템이었다면 그 이전 아이템
    const nextItem = futureNotesInView[deletedIndexInOriginalView] || futureNotesInView[deletedIndexInOriginalView - 1];
    return nextItem?.id ?? null;
};

export const handleAddFolder = async () => {
    await finishPendingRename();

    const name = await showPrompt({
        title: CONSTANTS.MODAL_TITLES.NEW_FOLDER,
        placeholder: '📁 폴더 이름을 입력하세요',
        validationFn: (value) => {
            const trimmedValue = value.trim();
            if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
            if (state.folders.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
            }
            return { isValid: true };
        }
    });

    if (name) {
        const newFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${Date.now()}`, name: name.trim(), notes: [] };
        state.folders.push(newFolder);
        await changeActiveFolder(newFolder.id, { force: true });
        
        // [Critical 버그 수정] 직접 saveData 호출 대신, 전역 잠금이 적용된 commitChanges 사용
        await commitChanges();
        
        setTimeout(() => {
            const newFolderEl = folderList.querySelector(`[data-id="${newFolder.id}"]`);
            if (newFolderEl) {
                newFolderEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                newFolderEl.focus();
            }
        }, 100);
    }
};

let addNoteLock = Promise.resolve();

export const handleAddNote = () => {
    addNoteBtn.disabled = true;

    addNoteLock = addNoteLock.then(async () => {
        await finishPendingRename();

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        if (!state.activeFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(state.activeFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const { item: activeFolder } = findFolder(state.activeFolderId);
        if (activeFolder) {
            const now = Date.now();
            const date = new Date(now);

            const datePart = date.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            }).slice(0, -1);
            const timePart = date.toLocaleTimeString('ko-KR', {
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });
            const baseTitle = `${datePart} ${timePart}의 노트`;

            let newTitle = baseTitle;
            let counter = 2;
            const existingTitles = new Set(activeFolder.notes.map(n => n.title));
            while (existingTitles.has(newTitle)) {
                newTitle = `${baseTitle} (${counter++})`;
            }
            
            // [Critical 버그 수정] ID 충돌을 원천적으로 방지하기 위해 `generateUniqueId` 헬퍼 함수를 사용합니다.
            const uniqueId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE);

            const newNote = { id: uniqueId, title: newTitle, content: "", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            activeFolder.notes.unshift(newNote);
            state.totalNoteCount++;
            state.lastActiveNotePerFolder[state.activeFolderId] = newNote.id;
            state.noteMap.set(newNote.id, { note: newNote, folderId: state.activeFolderId });
            
            // 공통 후처리 로직 호출
            await finalizeItemChange({ activeNoteId: newNote.id, searchTerm: '' });
            
            saveSession();
            
            setTimeout(() => {
                const newNoteEl = noteList.querySelector(`[data-id="${newNote.id}"]`);
                if (newNoteEl) {
                    newNoteEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
                noteTitleInput.focus();
                noteTitleInput.select();
            }, 100);
        }
    }).finally(() => {
        addNoteBtn.disabled = false;
    });
};


export const handlePinNote = (id) => withNote(id, (note) => {
    note.isPinned = !note.isPinned;
    note.updatedAt = Date.now();
    showToast(note.isPinned ? CONSTANTS.MESSAGES.SUCCESS.NOTE_PINNED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNPINNED);
});

export const handleToggleFavorite = (id) => withNote(id, (note) => {
    note.isFavorite = !note.isFavorite;
    if (note.isFavorite) {
        state.favorites.add(id);
        showToast(CONSTANTS.MESSAGES.SUCCESS.NOTE_FAVORITED);
    } else {
        state.favorites.delete(id);
        showToast(CONSTANTS.MESSAGES.SUCCESS.NOTE_UNFAVORITED);
    }
    note.updatedAt = Date.now();
});

const handleDeleteFolder = (id) => {
    const deletionLogic = async () => {
        const { item: folder, index } = findFolder(id);
        if (!folder) return;
        
        // [Critical 버그 수정] 이름 변경 '좀비 상태' 방지
        if (state.renamingItemId === id) {
            setState({ renamingItemId: null });
        }

        // [CRITICAL BUG FIX] `confirmNavigation`이 `handleDelete`에서 호출되므로,
        // 이전에 데이터 유실을 유발했던 isDirty 확인 로직을 완전히 제거합니다.
        const folderToMove = state.folders.splice(index, 1)[0];
        const noteIdsInDeletedFolder = new Set(folderToMove.notes.map(n => n.id));

        state.totalNoteCount -= folder.notes.length;
        for (const folderId in state.lastActiveNotePerFolder) {
            if (noteIdsInDeletedFolder.has(state.lastActiveNotePerFolder[folderId])) {
                delete state.lastActiveNotePerFolder[folderId];
            }
        }

        // [Critical 버그 수정] 폴더 객체 하나만 휴지통으로 이동시킵니다.
        moveItemToTrash(folderToMove, 'folder');
        
        // [Critical 버그 수정] 폴더에 포함된 노트들의 즐겨찾기 상태를 제거하고 noteMap에서 삭제합니다.
        noteIdsInDeletedFolder.forEach(noteId => {
            state.noteMap.delete(noteId);
            state.favorites.delete(noteId);
        });
        
        delete state.lastActiveNotePerFolder[id];
        
        // 폴더 삭제 후 다음 활성 폴더/노트 상태를 한 번에 업데이트
        const newState = {};
        if (state.activeFolderId === id) {
            newState.activeFolderId = state.folders[index]?.id ?? state.folders[index - 1]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
            newState.activeNoteId = null; // 명시적으로 null 처리
        }
        
        await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name));
    };
    
    animateAndRemove(id, deletionLogic);
};

const handleDeleteNote = (id) => {
    const deletionLogic = async () => {
        const { item, folder } = findNote(id);
        if (!item) return;
        
        // [Critical 버그 수정] 이름 변경 '좀비 상태' 방지
        if (state.renamingItemId === id) {
            setState({ renamingItemId: null });
        }

        // [CRITICAL BUG FIX] 노트 삭제 시, 해당 노트가 'dirty' 상태인지 확인
        // 만약 삭제하려는 노트가 바로 'dirty' 상태인 노트라면,
        // isDirty 플래그를 즉시 초기화하여 데이터 유실 및 상태 오염을 방지한다.
        if (state.isDirty && state.dirtyNoteId === id) {
            clearTimeout(debounceTimer); // 예약된 저장을 취소
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved'); // 시각적으로 저장 완료/취소됨을 알림
        }

        let nextActiveNoteIdToSet = null;
        const wasActiveNoteDeleted = state.activeNoteId === id;
        const wasInDateFilteredView = !!state.dateFilter;
        
        if (wasActiveNoteDeleted) {
            // [BUG #3 FIX] Stale cache를 사용하는 대신, 현재 state를 기준으로 즉시 노트 목록을 재생성합니다.
            let sourceNotes;
            if (state.dateFilter) {
                const filterDateStr = toYYYYMMDD(state.dateFilter);
                sourceNotes = Array.from(state.noteMap.values())
                    .map(entry => entry.note)
                    .filter(note => toYYYYMMDD(note.createdAt) === filterDateStr);
            } else {
                const { item: currentFolder } = findFolder(state.activeFolderId);
                sourceNotes = currentFolder?.notes ?? [];
            }

            const filteredNotes = sourceNotes.filter(n =>
                (n.title ?? n.name ?? '').toLowerCase().includes(state.searchTerm.toLowerCase()) ||
                (n.content ?? '').toLowerCase().includes(state.searchTerm.toLowerCase())
            );

            let notesInCurrentView;
            const { item: folderData } = findFolder(state.activeFolderId);
            if (folderData?.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                notesInCurrentView = filteredNotes.sort((a,b) => (b.deletedAt ?? 0) - (b.deletedAt ?? 0));
            } else if (folderData?.isSortable !== false) {
                notesInCurrentView = sortNotes(filteredNotes, state.noteSortOrder);
            } else {
                notesInCurrentView = filteredNotes;
            }
            
            nextActiveNoteIdToSet = getNextActiveNoteAfterDeletion(id, notesInCurrentView);
        }

        state.favorites.delete(id);

        if (folder) {
            const noteIndexInFolder = folder.notes.findIndex(n => n.id === id);
            if (noteIndexInFolder > -1) {
                const noteToMove = folder.notes.splice(noteIndexInFolder, 1)[0];
                state.totalNoteCount--;
                moveItemToTrash(noteToMove, 'note', folder.id);
            }
        } else {
            console.error(`Could not find source folder for note ID: ${id}. Moving to trash without folder context.`);
            moveItemToTrash(item, 'note', item.originalFolderId || null);
        }
        state.noteMap.delete(id);
        
        if (folder && state.lastActiveNotePerFolder[folder.id] === id) delete state.lastActiveNotePerFolder[folder.id];

        const newState = {};
        if (wasActiveNoteDeleted) newState.activeNoteId = nextActiveNoteIdToSet;
        if (wasInDateFilteredView) {
            const filterDate = new Date(state.dateFilter);
            
            const hasOtherNotesOnSameDate = Array.from(state.noteMap.values()).some(({note}) => {
                if (note.id === item.id) return false;
                const noteDate = new Date(note.createdAt);
                return noteDate.getFullYear() === filterDate.getFullYear() &&
                       noteDate.getMonth() === filterDate.getMonth() &&
                       noteDate.getDate() === filterDate.getDate();
            });

            if (!hasOtherNotesOnSameDate) {
                // [수정] 이 부분은 finalizeItemChange에서 처리합니다.
                newState.dateFilter = null;
                newState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                newState.activeNoteId = null;
            }
        }

        await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(item.title || '제목 없음'));
        
        if (wasActiveNoteDeleted) saveSession();
    };

    animateAndRemove(id, deletionLogic);
};

export const handleDelete = async (id, type, force = false) => {
    // [CRITICAL BUG FIX] 삭제 작업을 시작하기 전에 저장되지 않은 변경사항을 먼저 확인하고 처리합니다.
    // 사용자가 저장을 취소하면, 모든 삭제 절차를 중단합니다.
    if (!(await confirmNavigation())) {
        return;
    }

    await finishPendingRename();
    const finder = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder : findNote;
    const { item } = finder(id);
    if (!item) return;

    const action = () => {
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) handleDeleteFolder(id);
        else handleDeleteNote(id);
    };

    if (force) {
        action();
        return;
    }

    const itemName = item.name || item.title || '제목 없음';
    const confirmMessage = type === CONSTANTS.ITEM_TYPE.FOLDER
        ? `📁 '${itemName}' 폴더와 포함된 모든 노트를 휴지통으로 이동할까요?`
        : `📝 '${itemName}' 노트를 휴지통으로 이동할까요?`;

    await withConfirmation(
        { title: '🗑️ 휴지통으로 이동', message: confirmMessage, confirmText: '🗑️ 이동' },
        action
    );
};

export const handlePermanentlyDeleteItem = async (id) => {
    await finishPendingRename();
    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;
    const item = state.trash[itemIndex];

    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    const deletionLogic = async () => {
        // [Critical 버그 수정] 이름 변경 '좀비 상태' 방지
        if (state.renamingItemId === id) {
            setState({ renamingItemId: null });
        }
        
        let nextActiveNoteIdToSet = null;
        const wasActiveItemDeleted = state.activeNoteId === id;

        if (wasActiveItemDeleted) {
            const currentTrashItems = state.trash
                .filter(i =>
                    (i.title ?? i.name ?? '').toLowerCase().includes(state.searchTerm.toLowerCase())
                )
                .sort((a, b) => (b.deletedAt ?? 0) - (b.deletedAt ?? 0));
            
            nextActiveNoteIdToSet = getNextActiveNoteAfterDeletion(id, currentTrashItems);
        }
        
        // [Critical 버그 수정] 삭제 로직을 새로운 데이터 구조에 맞게 수정합니다.
        let successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS;
        
        if (item.type === 'folder') {
            successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_FOLDER_SUCCESS;
        }

        // 휴지통에서 해당 아이템 하나만 제거합니다. (폴더일 경우 포함된 노트도 함께 사라짐)
        state.trash.splice(itemIndex, 1);

        const newState = {};
        if (wasActiveItemDeleted) {
            newState.activeNoteId = nextActiveNoteIdToSet;
        }

        await finalizeItemChange(newState, successMessage);
    };

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '💥 삭제', confirmButtonType: 'danger' },
        () => animateAndRemove(id, deletionLogic)
    );
};

export const handleEmptyTrash = async () => {
    await finishPendingRename();
    if (state.trash.length === 0) return;

    const folderCount = state.trash.filter(item => item.type === 'folder').length;
    const noteCount = state.trash.filter(item => item.type === 'note').length;
    const messageParts = [];
    if (folderCount > 0) messageParts.push(`폴더 ${folderCount}개`);
    if (noteCount > 0) messageParts.push(`노트 ${noteCount}개`);
    const message = `휴지통에 있는 ${messageParts.join('와 ')} (총 ${state.trash.length}개 항목)을(를) 영구적으로 삭제할까요?`;

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 삭제', confirmButtonType: 'danger' },
        async () => {
            const wasInTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
            const newState = { trash: [] };

            if (wasInTrashView) {
                newState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                newState.activeNoteId = null;
            }

            // [Critical 버그 수정] 이름 변경 중인 아이템이 휴지통에 있었다면 상태를 초기화합니다.
            if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                newState.renamingItemId = null;
            }

            await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS);
            
            saveSession();
        }
    );
};

// 이름 변경 완료 로직
const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    nameSpan.contentEditable = false;

    // [CRITICAL BUG 2 FIX] 함수가 호출될 때 promise 제어 변수를 정리합니다.
    pendingRenamePromise = null;
    resolvePendingRename = null;

    if (!nameSpan.isConnected) {
        setState({ renamingItemId: null });
        return;
    }

    const finder = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder : findNote;
    const { item: currentItem, folder } = finder(id);

    if (!currentItem) {
        setState({ renamingItemId: null });
        return;
    }

    const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
    const newName = nameSpan.textContent.trim();

    if (!shouldSave || newName === originalName) {
        nameSpan.textContent = originalName;
        setState({ renamingItemId: null });
        return;
    }

    if (!newName) {
        showToast(CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR, CONSTANTS.TOAST_TYPE.ERROR);
        nameSpan.textContent = originalName;
        setState({ renamingItemId: null });
        return;
    }

    let isDuplicate = false;
    const newNameLower = newName.toLowerCase();
    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        const virtualFolderNames = Object.values(CONSTANTS.VIRTUAL_FOLDERS).map(vf => vf.name.toLowerCase());
        if (virtualFolderNames.includes(newNameLower)) {
            showToast(CONSTANTS.MESSAGES.ERROR.RESERVED_NAME, CONSTANTS.TOAST_TYPE.ERROR);
            nameSpan.textContent = originalName;
            setState({ renamingItemId: null });
            return;
        }
        isDuplicate = state.folders.some(f => f.id !== id && f.name.toLowerCase() === newNameLower);
    } else {
        // [사용자 요청] 노트 이름 변경 시 중복 검사를 하지 않습니다.
        // isDuplicate는 false로 유지됩니다.
    }

    if (isDuplicate) {
        showToast(CONSTANTS.MESSAGES.ERROR.DUPLICATE_NAME_ERROR(newName), CONSTANTS.TOAST_TYPE.ERROR);
        nameSpan.textContent = originalName;
        setState({ renamingItemId: null });
        return;
    }

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        currentItem.name = newName;
    } else {
        currentItem.title = newName;
        currentItem.updatedAt = Date.now();
    }
    
    await commitChanges({ renamingItemId: null });
};

// [핵심 수정] 이름 변경 시작 로직
export const startRename = (liElement, type) => {
    const id = liElement?.dataset.id;

    // [버그 수정] 휴지통에 있는 항목은 이름을 변경할 수 없습니다.
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
        return;
    }
    
    if (!id || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;
    if (state.renamingItemId) return;

    // 1. 상태를 먼저 설정하여 렌더러가 "이름 변경 모드"로 그리도록 유도합니다.
    setState({ renamingItemId: id });

    // 2. setTimeout을 사용하여 렌더링이 완료된 후 DOM 조작을 실행합니다.
    setTimeout(() => {
        // 렌더링 후 새로 생성된 요소를 다시 찾습니다.
        const newLiElement = document.querySelector(`.item-list-entry[data-id="${id}"]`);
        if (!newLiElement) return;

        const nameSpan = newLiElement.querySelector('.item-name');
        if (!nameSpan) return;
        
        // 이제 새로 그려진 요소를 편집 가능 상태로 만듭니다.
        nameSpan.contentEditable = true;
        nameSpan.focus();

        // 텍스트 전체 선택
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(nameSpan);
        selection.removeAllRanges();
        selection.addRange(range);

        // [CRITICAL BUG 2 FIX] Promise와 resolver를 설정하여 외부 제어를 가능하게 합니다.
        pendingRenamePromise = new Promise(resolve => {
            resolvePendingRename = resolve;
        });

        const onBlur = async () => {
            cleanup();
            await _handleRenameEnd(id, type, nameSpan, true);
            if (resolvePendingRename) resolvePendingRename(); // Promise 해결
        };

        const onKeydown = async (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                nameSpan.blur();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                cleanup();
                await _handleRenameEnd(id, type, nameSpan, false);
                if (resolvePendingRename) resolvePendingRename(); // Promise 해결
            }
        };
        
        const cleanup = () => {
            nameSpan.removeEventListener('blur', onBlur);
            nameSpan.removeEventListener('keydown', onKeydown);
        };

        nameSpan.addEventListener('blur', onBlur);
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0); // macrotask queue를 사용하여 렌더링 후에 실행되도록 보장합니다.
};

// --- '열쇠' 방식 저장 관리 로직 ---

let debounceTimer = null;
// [Critical 버그 수정] 로컬 saveLock 제거. globalSaveLock으로 통일됨.

// [BUG 1 FIX] _performSave가 저장 성공 여부(boolean)를 반환하도록 수정
async function _performSave(noteId, titleToSave, contentToSave, skipSave = false) {
    updateSaveStatus('saving');

    const { item: noteToSave } = findNote(noteId);
    if (noteToSave) {
        let finalTitle = titleToSave;
        if (!finalTitle.trim() && contentToSave.trim()) {
            const firstLine = contentToSave.trim().split('\n')[0];
            if (firstLine.length > CONSTANTS.AUTO_TITLE_LENGTH_KOR) {
                finalTitle = firstLine.substring(0, CONSTANTS.AUTO_TITLE_LENGTH_KOR) + '...';
            } else {
                finalTitle = firstLine;
            }
        }

        noteToSave.title = finalTitle;
        noteToSave.content = contentToSave;
        noteToSave.updatedAt = Date.now();

        if (!skipSave) {
            const success = await saveData();
            if (!success) return false; // 저장 실패 시 즉시 false 반환
        }

        clearSortedNotesCache();
        state._virtualFolderCache.recent = null;
    }
    return true; // 저장 성공 또는 건너뛴 경우 true 반환
}

// [CRITICAL BUG FIX] 데이터 손실/오염을 방지하기 위해 handleNoteUpdate 함수 수정
export async function handleNoteUpdate(isForced = false, skipSave = false, forceData = null) {
    if (editorContainer.style.display === 'none') {
        clearTimeout(debounceTimer);
        return true;
    }
    
    if (state.renamingItemId && isForced) return true;
    
    // 자동 저장 트리거 로직 (isForced = false)
    if (!isForced) {
        const noteId = state.activeNoteId;
        if (!noteId) return true;

        const { item: activeNote } = findNote(noteId);
        if (!activeNote) return true;
        
        const hasChanged = activeNote.title !== noteTitleInput.value || activeNote.content !== noteContentTextarea.value;
        
        if (hasChanged) {
            if (!state.isDirty) {
                // [수정] 변경 발생 시, 어떤 노트가 변경되었는지 ID와 함께 상태에 기록
                setState({ isDirty: true, dirtyNoteId: noteId });
            }
            updateSaveStatus('dirty');
            
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        }
        return true;
    }
    
    // 강제 저장 실행 로직 (isForced = true)
    clearTimeout(debounceTimer);

    if (!state.isDirty && !forceData) {
        return true; // 저장할 변경사항이 없음
    }

    const noteIdToSave = state.dirtyNoteId;
    if (!noteIdToSave) {
        // isDirty는 true인데 ID가 없는 비정상적인 상태. 안전하게 리셋.
        setState({ isDirty: false, dirtyNoteId: null });
        return true;
    }
    
    // [CRITICAL BUG FIX] forceData가 있으면 DOM 대신 그 값을 사용하고, 없으면 DOM 값을 사용합니다.
    // 이는 노트 전환 시 발생하는 데이터 오염(Race Condition)을 방지합니다.
    const titleToSave = forceData ? forceData.title : noteTitleInput.value;
    const contentToSave = forceData ? forceData.content : noteContentTextarea.value;
    
    // 저장하려는 노트가 여전히 존재하는지 확인
    const { item: noteToModify } = findNote(noteIdToSave);
    if (!noteToModify) {
        setState({ isDirty: false, dirtyNoteId: null });
        return true;
    }
    
    // [CRITICAL BUG FIX] 전역 잠금을 사용하여 다른 저장 작업과 충돌 방지
    await globalSaveLock;

    let releaseLock;
    let wasSuccessful = false;
    globalSaveLock = new Promise(resolve => {
        releaseLock = resolve;
    });

    try {
        window.isSavingInProgress = true; // [BUG FIX] 저장 시작을 동기적으로 알림
        const success = await _performSave(noteIdToSave, titleToSave, contentToSave, skipSave);
        if (!success) {
            updateSaveStatus('dirty'); // 실패 시 '변경됨' 상태 유지
            return false;
        }
        
        wasSuccessful = true;

        // [CRITICAL BUG FIX] 레이스 컨디션 방지: 저장 작업 중 추가 변경이 있었는지 확인합니다.
        // forceData가 없는 일반적인 자동 저장 상황에서만 이 검사를 수행합니다.
        const isStillDirtyAfterSave = !forceData && (noteTitleInput.value !== titleToSave || noteContentTextarea.value !== contentToSave);

        if (isStillDirtyAfterSave) {
            // 저장 중에 새로운 내용이 입력되었습니다.
            // isDirty 상태는 이미 true이므로 그대로 두고, UI를 '변경됨'으로 유지합니다.
            updateSaveStatus('dirty');
            // 새로운 변경사항에 대한 저장을 다시 예약합니다.
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        } else {
            // 저장 후 추가 변경이 없었거나, 백그라운드 저장(forceData)이었습니다.
            // 이제 안전하게 dirty 상태를 초기화할 수 있습니다.
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        }
    } catch (e) {
        console.error("Save failed:", e);
        wasSuccessful = false;
    } finally {
        window.isSavingInProgress = false; // [BUG FIX] 저장 완료/실패 시 플래그 해제
        // [CRITICAL BUG FIX] 작업 완료 후 반드시 잠금 해제
        releaseLock();
    }
    return wasSuccessful;
}