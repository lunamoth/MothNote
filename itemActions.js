import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
// [핵심 수정] 분산 락(Distributed Lock) 관련 함수를 storage.js에서 가져옵니다.
import { saveData, saveSession, acquireWriteLock, releaseWriteLock } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache } from './renderer.js';
import { changeActiveFolder, confirmNavigation } from './navigationActions.js';

// 모든 데이터 저장 작업을 현재 탭 내에서 순서대로 처리하기 위한 비동기 잠금(Lock)
let globalSaveLock = Promise.resolve();


/**
 * 앱의 전체 상태(활성 노트, 휴지통)를 확인하여
 * 충돌하지 않는 고유한 ID를 생성하고 반환합니다.
 */
const generateUniqueId = (prefix, existingIds) => {
    const basePrefix = prefix || CONSTANTS.ID_PREFIX.NOTE;
    // crypto.randomUUID가 있으면 사용 (더 강력한 고유성)
    if (typeof crypto?.randomUUID === 'function') {
        let id;
        do {
            id = crypto.randomUUID();
        } while (existingIds.has(id));
        return id;
    }
    
    // Fallback: 기존 방식
    let id;
    do {
        id = `${basePrefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } while (existingIds.has(id));
    
    return id;
};

// 날짜를 'YYYY-MM-DD' 형식으로 변환하는 유틸리티 함수 (기능 유지)
export const toYYYYMMDD = (dateInput) => {
    if (!dateInput) return null;
    const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return null;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// 노트 생성 날짜 Set을 다시 빌드합니다. (기능 유지)
export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
    // noteMap과 휴지통에서 모든 노트를 가져옵니다.
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

// --- Promise 기반 이름 변경 동기화 (기능 유지) ---
let pendingRenamePromise = null;
let resolvePendingRename = null;

export const forceResolvePendingRename = () => {
    if (resolvePendingRename) {
        console.warn("Force resolving a pending rename operation due to external changes.");
        setState({ renamingItemId: null });
        resolvePendingRename(); 
        resolvePendingRename = null;
        pendingRenamePromise = null;
    }
};

export const finishPendingRename = async () => {
    if (state.renamingItemId && pendingRenamePromise) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur(); // blur 이벤트가 _handleRenameEnd를 트리거
            await pendingRenamePromise; // _handleRenameEnd가 완료될 때까지 기다림
        } else {
            // 엘리먼트가 사라진 경우 강제 종료
            forceResolvePendingRename();
        }
    }
};

// 달력 UI 갱신을 위한 함수를 저장할 변수 (기능 유지)
let calendarRenderer = () => {};

export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [근본적인 아키텍처 수정] 모든 데이터 수정의 유일한 진입점.
// 원자성(All-or-Nothing)을 보장하고, 성공 시 자신의 흔적(백업 파일)을 스스로 정리합니다.
export const performTransactionalUpdate = async (updateFn) => {
    // 1. 분산 락(Distributed Lock) 획득 시도 - 여러 탭 간의 동시 쓰기 방지
    let lockAcquired = false;
    for (let i = 0; i < 5; i++) {
        if (await acquireWriteLock(window.tabId)) {
            lockAcquired = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200)); // 랜덤 백오프
    }

    if (!lockAcquired) {
        console.error("데이터 저장 실패: 다른 탭에서 작업을 처리 중입니다.");
        showToast("다른 탭에서 작업을 처리 중입니다. 잠시 후 다시 시도해주세요.", CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    
    // 2. 현재 탭 내의 동시 실행 방지를 위한 로컬 락
    await globalSaveLock;
    let releaseLocalLock;
    globalSaveLock = new Promise(resolve => { releaseLocalLock = resolve; });

    let success = false;
    try {
        setState({ isPerformingOperation: true });

        // 3. [핵심] 항상 chrome.storage에서 직접 최신 데이터를 읽어 트랜잭션을 시작합니다.
        // 메모리에 있는 state 객체를 신뢰하지 않음으로써 동기화 문제를 원천 차단합니다.
        const storageResult = await chrome.storage.local.get('appState');
        const latestData = storageResult.appState || { folders: [], trash: [], favorites: [] };
        const dataCopy = JSON.parse(JSON.stringify(latestData)); // 안전한 수정을 위해 깊은 복사

        // 4. 전달된 함수로 데이터 변경 로직 적용
        const result = await updateFn(dataCopy);
        
        if (result === null) { // 함수가 null을 반환하면 작업 취소로 간주
            return false; // finally 블록에서 락 해제
        }

        const { newData, successMessage, postUpdateState } = result;
        
        // 5. [단순화] 불안정한 저널링(in-flight) 로직 제거.
        // 분산 락이 경쟁 상태를 막아주므로, chrome.storage.local.set을 유일한 '커밋'으로 간주합니다.
        
        // 6. 트랜잭션 ID를 부여하여 자신의 변경사항임을 식별
        const transactionId = `${Date.now()}-${Math.random()}`;
        newData.transactionId = transactionId;
        const timestamp = Date.now();
        newData.lastSavedTimestamp = timestamp;
        
        setState({ currentTransactionId: transactionId });

        // 7. chrome.storage에 최종 데이터 저장 (이것이 유일한 '커밋' 지점)
        await chrome.storage.local.set({ appState: newData });
        
        // 8. [매우 중요] 트랜잭션 성공 후, 이 탭이 생성한 모든 임시 백업 파일을 즉시 정리합니다.
        // 이로써 `loadData`는 '죽은 탭'의 백업만 신경 쓰면 되므로 로직이 매우 단순해집니다.
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX}${window.tabId}`)) {
                localStorage.removeItem(key);
            }
        }
        
        // 9. 로컬 state를 성공적으로 커밋된 데이터로 업데이트하고 UI 렌더링
        setState({
            ...state,
            folders: newData.folders,
            trash: newData.trash,
            favorites: new Set(newData.favorites || []),
            lastSavedTimestamp: timestamp,
            ...postUpdateState
        });
        
        buildNoteMap();
        updateNoteCreationDates();
        clearSortedNotesCache(); // 가상 폴더 캐시를 포함한 모든 캐시 초기화
        state._virtualFolderCache = { all: null, recent: null, favorites: null, trash: null };
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
        // 10. [핵심] 성공/실패 여부와 관계없이 반드시 모든 락을 해제합니다.
        await releaseWriteLock(window.tabId);
        setState({ isPerformingOperation: false });
        releaseLocalLock();
    }
    return success;
};

// 확인 절차와 실행 로직을 결합한 고차 함수 (기능 유지)
async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) {
        await action();
    }
}

// 다음 활성 노트 ID 계산 헬퍼 (기능 유지)
const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;
    const futureNotesInView = notesInView.filter(n => n.id !== deletedNoteId);
    if(futureNotesInView.length === 0) return null;

    const deletedIndexInOriginalView = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndexInOriginalView === -1) return futureNotesInView[0].id;
    
    const nextItem = futureNotesInView[deletedIndexInOriginalView] || futureNotesInView[deletedIndexInOriginalView - 1];
    return nextItem?.id ?? null;
};

// --- 이벤트 핸들러 (모두 새로운 performTransactionalUpdate를 사용하도록 수정) ---

export const handleAddFolder = async () => {
    await finishPendingRename();

    const name = await showPrompt({
        title: CONSTANTS.MODAL_TITLES.NEW_FOLDER,
        placeholder: '📁 폴더 이름을 입력하세요',
        validationFn: (value) => {
            const trimmedValue = value.trim();
            if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
            // [수정] 현재 state 대신, 트랜잭션 시점의 데이터와 비교해야 하므로 여기서는 단순 클라이언트사이드 검증만 수행.
            if (state.folders.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
            }
            return { isValid: true };
        }
    });

    if (!name) return;

    const updateLogic = async (latestData) => {
        const trimmedName = name.trim();
        // [수정] 트랜잭션 시작 시점의 최신 데이터(latestData)로 중복 검사 (원자성 보장)
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
            return null; // 트랜잭션 취소
        }

        const now = Date.now();
        const newFolderId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
        const newFolder = { id: newFolderId, name: trimmedName, notes: [], createdAt: now, updatedAt: now };
        latestData.folders.push(newFolder);
        
        return {
            newData: latestData,
            successMessage: null,
            postUpdateState: { activeFolderId: newFolderId, activeNoteId: null }
        };
    };

    const success = await performTransactionalUpdate(updateLogic);

    if (success) {
        await changeActiveFolder(state.activeFolderId, { force: true });
        saveSession();
        setTimeout(() => {
            const newFolderEl = folderList.querySelector(`[data-id="${state.activeFolderId}"]`);
            if (newFolderEl) {
                newFolderEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                newFolderEl.focus();
            }
        }, 100);
    }
};

let addNoteLock = false; // (기능 유지)
export const handleAddNote = async () => {
    if (addNoteLock) return;
    addNoteLock = true;
    addNoteBtn.disabled = true;

    try {
        await finishPendingRename();

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        const currentActiveFolderId = state.activeFolderId;

        if (!currentActiveFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(currentActiveFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const updateLogic = (latestData) => {
            const activeFolder = latestData.folders.find(f => f.id === currentActiveFolderId);
            if (!activeFolder) {
                 showAlert({ title: '오류', message: '노트를 추가하려던 폴더가 삭제되었습니다.'});
                 return null;
            }

            const now = Date.now();
            const newNoteId = `${CONSTANTS.ID_PREFIX.NOTE}${now}`;
            const newNote = { id: newNoteId, title: "새 노트", content: "", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            
            activeFolder.notes.unshift(newNote);
            activeFolder.updatedAt = now;

            const newLastActiveMap = { ...state.lastActiveNotePerFolder, [currentActiveFolderId]: newNoteId };
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    activeNoteId: newNote.id,
                    searchTerm: '',
                    totalNoteCount: (state.totalNoteCount || 0) + 1,
                    lastActiveNotePerFolder: newLastActiveMap
                }
            };
        };
        
        const success = await performTransactionalUpdate(updateLogic);

        if (success) {
            saveSession();
            setTimeout(() => {
                const newNoteEl = noteList.querySelector(`[data-id="${state.activeNoteId}"]`);
                if (newNoteEl) newNoteEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                noteTitleInput.focus();
                noteTitleInput.select();
            }, 100);
        }
    } finally {
        addNoteLock = false;
        addNoteBtn.disabled = false;
    }
};

// [수정] 모든 노트 관련 액션을 일관된 패턴으로 변경
const _withNoteAction = (noteId, actionFn) => {
    return performTransactionalUpdate(latestData => {
        let noteToUpdate = null;
        let folderOfNote = null;

        for (const folder of latestData.folders) {
            const note = folder.notes.find(n => n.id === noteId);
            if (note) {
                noteToUpdate = note;
                folderOfNote = folder;
                break;
            }
        }
        
        if (!noteToUpdate) return null; // 노트가 없는 경우 트랜잭션 취소

        return actionFn(noteToUpdate, folderOfNote, latestData);
    });
};

export const handlePinNote = (id) => _withNoteAction(id, (note, folder, data) => {
    note.isPinned = !note.isPinned;
    const now = Date.now();
    note.updatedAt = now;
    folder.updatedAt = now;
    return {
        newData: data,
        successMessage: note.isPinned ? CONSTANTS.MESSAGES.SUCCESS.NOTE_PINNED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNPINNED,
        postUpdateState: {}
    };
});

export const handleToggleFavorite = (id) => _withNoteAction(id, (note, folder, data) => {
    note.isFavorite = !note.isFavorite;
    const now = Date.now();
    note.updatedAt = now;
    folder.updatedAt = now;
    
    const favoritesSet = new Set(data.favorites || []);
    if (note.isFavorite) {
        favoritesSet.add(id);
    } else {
        favoritesSet.delete(id);
    }
    data.favorites = Array.from(favoritesSet);

    return {
        newData: data,
        successMessage: note.isFavorite ? CONSTANTS.MESSAGES.SUCCESS.NOTE_FAVORITED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNFAVORITED,
        postUpdateState: {}
    };
});

// handleDelete, handleRestoreItem 등 모든 함수를 새로운 패턴으로 유지/수정
export const handleDelete = async (id, type) => {
    if (!(await confirmNavigation())) return;
    await finishPendingRename();
    
    const { item } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
    if (!item) return;

    const itemName = item.name || item.title || '제목 없음';
    const confirmMessage = type === CONSTANTS.ITEM_TYPE.FOLDER
        ? `📁 '${itemName}' 폴더와 포함된 모든 노트를 휴지통으로 이동할까요?`
        : `📝 '${itemName}' 노트를 휴지통으로 이동할까요?`;

    await withConfirmation(
        { title: '🗑️ 휴지통으로 이동', message: confirmMessage, confirmText: '🗑️ 이동' },
        () => performDeleteItem(id, type)
    );
};

const performDeleteItem = (id, type) => {
    return performTransactionalUpdate(latestData => {
        let successMessage = '';
        let postUpdateState = {};
        const now = Date.now();

        if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
        if (state.isDirty && state.dirtyNoteId === id) {
            clearTimeout(debounceTimer);
            postUpdateState.isDirty = false;
            postUpdateState.dirtyNoteId = null;
            updateSaveStatus('saved');
        }

        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            const folderIndex = latestData.folders.findIndex(f => f.id === id);
            if (folderIndex === -1) return null; // 이미 삭제됨
            
            const [folderToMove] = latestData.folders.splice(folderIndex, 1);
            folderToMove.type = 'folder';
            folderToMove.deletedAt = now;
            folderToMove.updatedAt = now;
            latestData.trash.unshift(folderToMove);
            
            const favoritesSet = new Set(latestData.favorites || []);
            folderToMove.notes.forEach(note => favoritesSet.delete(note.id));
            latestData.favorites = Array.from(favoritesSet);

            successMessage = CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name);
            if (state.activeFolderId === id) {
                postUpdateState.activeFolderId = latestData.folders[folderIndex]?.id ?? latestData.folders[folderIndex - 1]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            }
        } else { // NOTE
            let noteToMove, sourceFolder;
            for(const folder of latestData.folders) {
                const noteIndex = folder.notes.findIndex(n => n.id === id);
                if (noteIndex !== -1) {
                    [noteToMove] = folder.notes.splice(noteIndex, 1);
                    sourceFolder = folder;
                    break;
                }
            }
            if (!noteToMove) return null; // 이미 삭제됨

            noteToMove.type = 'note';
            noteToMove.originalFolderId = sourceFolder.id;
            noteToMove.deletedAt = now;
            latestData.trash.unshift(noteToMove);
            sourceFolder.updatedAt = now;

            const favoritesSet = new Set(latestData.favorites || []);
            favoritesSet.delete(id);
            latestData.favorites = Array.from(favoritesSet);
            
            successMessage = CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(noteToMove.title || '제목 없음');
            
            if (state.activeNoteId === id) {
                // 이 로직은 UI 상태에 의존하므로 postUpdateState에서 처리
                const currentFolderInOldState = findFolder(state.activeFolderId)?.item;
                const notesInView = sortNotes(currentFolderInOldState?.notes ?? [], state.noteSortOrder);
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, notesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    }).then(saveSession);
};

// ... handleRestoreItem, handlePermanentlyDeleteItem, handleEmptyTrash, startRename 등도
// 모두 performTransactionalUpdate를 사용하는 동일한 원자적 패턴을 따르므로 코드는 기존과 유사하게 유지됩니다.
// (생략된 코드는 기존 기능과 동일)

// [근본적인 아키텍처 수정] 노트 업데이트 핸들러의 역할을 '실시간 UI 백업'과 '저장 요청'으로 명확히 분리합니다.
// 이 함수는 더 이상 `state.pendingChanges`를 사용하지 않고, UI를 유일한 신뢰의 출처로 삼습니다.
let debounceTimer = null;

export async function handleNoteUpdate(isForced = false) {
    if (editorContainer.classList.contains(CONSTANTS.CLASSES.READONLY) || editorContainer.style.display === 'none') {
        clearTimeout(debounceTimer);
        return true; // 편집 불가능한 상태이므로 항상 성공
    }
    
    const noteId = state.activeNoteId;
    if (!noteId) return true;
    
    const { item: activeNote } = findNote(noteId);
    if (!activeNote) return true;
    
    // [핵심] 신뢰의 출처는 항상 UI
    const currentTitle = noteTitleInput.value;
    const currentContent = noteContentTextarea.value;
    const hasChanged = activeNote.title !== currentTitle || activeNote.content !== currentContent;
    
    // 1. 실시간 백업 (isForced=false, 즉 사용자가 타이핑할 때)
    if (!isForced) {
        if (state.isDirty || hasChanged) {
            if (!state.isDirty) {
                setState({ isDirty: true, dirtyNoteId: noteId });
            }
            
            // [핵심] UI의 최신 상태를 즉시 로컬스토리지에 백업합니다. (덮어쓰기)
            // 이것이 브라우저 비정상 종료 시 데이터를 보호하는 유일한 보험입니다.
            try {
                const patch = {
                    type: 'note_patch',
                    noteId: noteId,
                    data: {
                        title: currentTitle,
                        content: currentContent,
                        updatedAt: Date.now()
                    }
                };
                const backupKey = `${CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX}${window.tabId}-note`;
                localStorage.setItem(backupKey, JSON.stringify([patch]));
            } catch (e) {
                console.error("실시간 비상 백업 패치 저장에 실패했습니다:", e);
            }

            updateSaveStatus('dirty');
            clearTimeout(debounceTimer);
            // 지연 후 '실제 저장'을 시도합니다.
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        }
        return true;
    }
    
    // 2. 실제 저장 시도 (isForced=true, debounce 또는 다른 액션에 의해 트리거됨)
    clearTimeout(debounceTimer);

    // 변경사항이 없으면 저장할 필요 없음
    if (!state.isDirty && !hasChanged) {
        return true;
    }
    
    // 저장할 데이터를 이 시점에 확정
    const noteIdToSave = state.dirtyNoteId || noteId;
    const titleToSave = currentTitle;
    const contentToSave = currentContent;

    updateSaveStatus('saving');

    const updateLogic = (latestData) => {
        let noteToSave;
        let parentFolder;
        for (const folder of latestData.folders) {
            noteToSave = folder.notes.find(n => n.id === noteIdToSave);
            if (noteToSave) {
                parentFolder = folder;
                break;
            }
        }
        if (!noteToSave) {
            console.warn(`저장하려던 노트(ID: ${noteIdToSave})를 찾을 수 없습니다. 아마 다른 탭에서 삭제된 것 같습니다.`);
            return null; // 노트가 없으면 트랜잭션 취소
        }

        const now = Date.now();
        noteToSave.title = titleToSave;
        noteToSave.content = contentToSave;
        noteToSave.updatedAt = now;
        if (parentFolder) {
            parentFolder.updatedAt = now;
        }
        
        return { newData: latestData, successMessage: null, postUpdateState: {} };
    };

    const wasSuccessful = await performTransactionalUpdate(updateLogic);
    
    if (wasSuccessful) {
        // [핵심] 저장이 완료된 후, UI가 다시 변경되었는지 확인합니다. (저장 중 사용자가 추가 입력한 경우)
        const isStillDirtyAfterSave = noteTitleInput.value !== titleToSave || noteContentTextarea.value !== contentToSave;

        if (isStillDirtyAfterSave) {
            // 저장 중에 새로운 편집이 발생함. 새로운 저장 주기를 시작하여 최신 내용을 처리.
            handleNoteUpdate(false);
        } else {
            // 저장이 완료되었고 추가 변경이 없음. 상태를 깨끗하게 정리.
            // 성공적인 performTransactionalUpdate가 이미 백업 파일을 삭제했음.
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        }
    } else {
        // 저장 실패 시 UI는 'dirty' 상태로 유지되고, 백업 파일은 삭제되지 않음.
        updateSaveStatus('dirty');
    }

    return wasSuccessful;
}

// startRename, handlePermanentlyDeleteItem 등 다른 모든 함수들은
// 이미 `performTransactionalUpdate`를 사용하는 패턴을 따르고 있으므로,
// 해당 함수의 내부 로직이 강화됨에 따라 자동으로 안정성이 향상됩니다.
// 따라서 아래 코드들은 기존 기능을 그대로 유지합니다.
// (생략된 코드는 위에서 설명되지 않은 나머지 기존 함수들입니다)
export const handleRestoreItem = async (id) => {
    await finishPendingRename();

    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;
    const itemToRestore = state.trash[itemIndex];

    let finalFolderName = itemToRestore.name;
    let targetFolderId = null;

    if (itemToRestore.type === 'folder') {
        if (state.folders.some(f => f.name === itemToRestore.name)) {
            const newName = await showPrompt({
                title: '📁 폴더 이름 중복',
                message: `'${itemToRestore.name}' 폴더가 이미 존재합니다. 복원할 폴더의 새 이름을 입력해주세요.`,
                initialValue: `${itemToRestore.name} (복사본)`,
                validationFn: (value) => {
                    const trimmedValue = value.trim();
                    if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
                    if (state.folders.some(f => f.name === trimmedValue)) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
                    return { isValid: true };
                }
            });
            if (!newName) return; 
            finalFolderName = newName.trim();
        }
    } else if (itemToRestore.type === 'note') {
        const originalFolder = state.folders.find(f => f.id === itemToRestore.originalFolderId);
        if (!originalFolder) {
            const newFolderId = await showFolderSelectPrompt({
                title: '🤔 원본 폴더를 찾을 수 없음',
                message: '이 노트의 원본 폴더가 없거나 휴지통에 있습니다. 복원할 폴더를 선택해주세요.'
            });
            if (!newFolderId) return;
            targetFolderId = newFolderId;
        } else {
            targetFolderId = originalFolder.id;
        }
    }

    const updateLogic = (latestData) => {
        const { folders, trash } = latestData;
        const itemIndexInTx = trash.findIndex(item => item.id === id);
        if (itemIndexInTx === -1) return null;

        const [itemToRestoreInTx] = trash.splice(itemIndexInTx, 1);
        const now = Date.now();

        if (itemToRestoreInTx.type === 'folder') {
            if (folders.some(f => f.name === finalFolderName)) {
                showAlert({ title: '오류', message: `'${finalFolderName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
                return null;
            }
            itemToRestoreInTx.name = finalFolderName;
            
            const allFolderIds = new Set(folders.map(f => f.id));
            if (allFolderIds.has(itemToRestoreInTx.id)) {
                itemToRestoreInTx.id = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allFolderIds);
            }
            itemToRestoreInTx.notes.forEach(note => {
                delete note.deletedAt; delete note.type; delete note.originalFolderId;
            });
            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type;
            itemToRestoreInTx.updatedAt = now;
            folders.unshift(itemToRestoreInTx);
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestoreInTx.name), postUpdateState: {} };

        } else if (itemToRestoreInTx.type === 'note') {
            const targetFolderInTx = folders.find(f => f.id === targetFolderId);
            if (!targetFolderInTx) {
                 showAlert({ title: '오류', message: '노트를 복원하려던 폴더가 방금 삭제되었습니다.'});
                 return null;
            }
            
            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type; delete itemToRestoreInTx.originalFolderId;
            itemToRestoreInTx.updatedAt = now;
            targetFolderInTx.notes.unshift(itemToRestoreInTx);
            targetFolderInTx.updatedAt = now;
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestoreInTx.title), postUpdateState: {} };
        }
        return null;
    };

    await performTransactionalUpdate(updateLogic);
    saveSession();
};

export const handlePermanentlyDeleteItem = async (id) => {
    await finishPendingRename();

    const item = state.trash.find(i => i.id === id);
    if (!item) return;
    
    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '💥 삭제', confirmButtonType: 'danger' },
        () => {
            const updateLogic = (latestData) => {
                const itemIndex = latestData.trash.findIndex(i => i.id === id);
                if (itemIndex === -1) return null;
                
                latestData.trash.splice(itemIndex, 1);
                
                let postUpdateState = {};
                if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
                if (state.activeNoteId === id) {
                    const trashItems = latestData.trash.sort((a,b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
                    postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, trashItems);
                }
                
                return {
                    newData: latestData,
                    successMessage: CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS,
                    postUpdateState
                };
            };
            return performTransactionalUpdate(updateLogic);
        }
    );
};

export const handleEmptyTrash = async () => {
    await finishPendingRename();
    if (state.trash.length === 0) return;

    const message = CONSTANTS.MESSAGES.CONFIRM.EMPTY_TRASH(state.trash.length);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 삭제', confirmButtonType: 'danger' },
        () => {
            const updateLogic = (latestData) => {
                let postUpdateState = {};
                if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                    postUpdateState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                    postUpdateState.activeNoteId = null;
                }
                if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                    postUpdateState.renamingItemId = null;
                }
                latestData.trash = [];
                return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS, postUpdateState };
            };
            return performTransactionalUpdate(updateLogic).then(saveSession);
        }
    );
};

const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    nameSpan.contentEditable = false;

    // Promise 동기화 로직
    pendingRenamePromise = null;
    if (resolvePendingRename) {
        resolvePendingRename();
        resolvePendingRename = null;
    }

    if (!nameSpan.isConnected) { // 엘리먼트가 사라진 경우
        setState({ renamingItemId: null });
        return;
    }

    const { item: currentItem } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
    if (!currentItem) {
        setState({ renamingItemId: null });
        return;
    }

    const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
    const newName = nameSpan.textContent.trim();

    if (!shouldSave || newName === originalName) {
        setState({ renamingItemId: null }); // UI만 원래대로 돌리고 저장 안함
        return;
    }
    
    const updateLogic = (latestData) => {
        let itemToRename, isDuplicate = false;
        const now = Date.now();
        
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            itemToRename = latestData.folders.find(f => f.id === id);
            if (!itemToRename) return null;
            const virtualNames = Object.values(CONSTANTS.VIRTUAL_FOLDERS).map(vf => vf.name.toLowerCase());
            if (virtualNames.includes(newName.toLowerCase())) {
                showToast(CONSTANTS.MESSAGES.ERROR.RESERVED_NAME, CONSTANTS.TOAST_TYPE.ERROR); return null;
            }
            isDuplicate = latestData.folders.some(f => f.id !== id && f.name.toLowerCase() === newName.toLowerCase());
        } else {
            for (const folder of latestData.folders) {
                const note = folder.notes.find(n => n.id === id);
                if (note) { 
                    itemToRename = note; 
                    folder.updatedAt = now; // 부모 폴더도 업데이트
                    break;
                }
            }
            if (!itemToRename) return null;
        }

        if (!newName) {
            showToast(CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR, CONSTANTS.TOAST_TYPE.ERROR); return null;
        }
        if (isDuplicate) {
            showToast(CONSTANTS.MESSAGES.ERROR.DUPLICATE_NAME_ERROR(newName), CONSTANTS.TOAST_TYPE.ERROR); return null;
        }

        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            itemToRename.name = newName;
        } else {
            itemToRename.title = newName;
        }
        itemToRename.updatedAt = now;

        return { newData: latestData, successMessage: null, postUpdateState: { renamingItemId: null } };
    };

    const success = await performTransactionalUpdate(updateLogic);
    if (!success) {
        // 실패 시 UI를 원래 이름으로 되돌리기 위해 렌더링 강제
        setState({ renamingItemId: null });
    }
};

export const startRename = (liElement, type) => {
    const id = liElement?.dataset.id;
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) return;
    if (!id || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;
    if (state.renamingItemId) return;

    setState({ renamingItemId: id });

    setTimeout(() => {
        const newLiElement = document.querySelector(`.item-list-entry[data-id="${id}"]`);
        if (!newLiElement) return;
        const nameSpan = newLiElement.querySelector('.item-name');
        if (!nameSpan) return;
        
        nameSpan.contentEditable = true;
        nameSpan.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(nameSpan);
        selection.removeAllRanges();
        selection.addRange(range);

        pendingRenamePromise = new Promise(resolve => { resolvePendingRename = resolve; });

        const onBlur = () => _handleRenameEnd(id, type, nameSpan, true);
        const onKeydown = (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); nameSpan.blur(); }
            else if (ev.key === 'Escape') {
                ev.preventDefault();
                nameSpan.textContent = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id).item.name : findNote(id).item.title);
                _handleRenameEnd(id, type, nameSpan, false);
            }
        };
        
        nameSpan.addEventListener('blur', onBlur, { once: true });
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0);
};