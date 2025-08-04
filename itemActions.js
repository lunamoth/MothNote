import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
// [Critical Bug Fix] 분산 락 관련 함수를 storage.js에서 가져옵니다.
import { saveData, saveSession, acquireWriteLock, releaseWriteLock } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache } from './renderer.js';
import { changeActiveFolder, confirmNavigation } from './navigationActions.js';

// 모든 데이터 저장 작업을 순서대로 처리하기 위한 전역 비동기 잠금(Lock)
let globalSaveLock = Promise.resolve();


/**
 * 앱의 전체 상태(활성 노트, 휴지통)를 확인하여
 * 충돌하지 않는 고유한 ID를 생성하고 반환합니다.
 */
const generateUniqueId = (prefix, existingIds) => {
    const basePrefix = prefix || CONSTANTS.ID_PREFIX.NOTE;
    if (typeof crypto?.randomUUID === 'function') {
        let id;
        do {
            id = crypto.randomUUID();
        } while (existingIds.has(id));
        return id;
    }
    
    let id;
    do {
        id = `${basePrefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } while (existingIds.has(id));
    
    return id;
};

// 날짜를 'YYYY-MM-DD' 형식으로 변환하는 유틸리티 함수
export const toYYYYMMDD = (dateInput) => {
    if (!dateInput) return null;
    const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return null;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// 노트 생성 날짜 Set을 다시 빌드합니다.
export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
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

// --- Promise 기반 이름 변경 동기화 ---
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
            renamingElement.blur(); 
            await pendingRenamePromise; 
        } else {
            forceResolvePendingRename();
        }
    }
};

// 달력 UI 갱신을 위한 함수를 저장할 변수
let calendarRenderer = () => {};

export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [핵심 수정] 데이터 무결성을 위한 원자적 업데이트 함수 (모든 데이터 수정의 진입점)
export const performTransactionalUpdate = async (updateFn) => {
    // --- [Critical Bug Fix] 1. 분산 락 획득 시도 ---
    // 락을 획득할 때까지 여러 번 재시도하여 안정성을 높입니다.
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
    // --- 락 획득 완료 ---

    await globalSaveLock;
    let releaseLock;
    globalSaveLock = new Promise(resolve => { releaseLock = resolve; });

    let success = false;
    try {
        setState({ isPerformingOperation: true });

        // 1. 트랜잭션 시작 시점의 데이터 읽기 (락을 획득했으므로 최신 데이터임)
        const storageResult = await chrome.storage.local.get('appState');
        const latestData = storageResult.appState || { folders: [], trash: [], favorites: [] };
        const dataCopy = JSON.parse(JSON.stringify(latestData));

        const result = await updateFn(dataCopy);
        
        if (result === null) {
            setState({ isPerformingOperation: false });
            // releaseLock()와 releaseWriteLock()은 finally 블록에서 처리
            return false;
        }

        const { newData, successMessage, postUpdateState } = result;
        
        // --- [Critical Bug Fix] 기존의 낙관적 잠금 로직은 이제 분산 락으로 대체되었으므로 제거합니다. ---
        
        // --- 저널링 로직 (데이터 손실 방지) ---
        try {
            localStorage.setItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX, JSON.stringify(newData));
        } catch (e) {
            console.error("In-flight transaction journaling failed. Aborting.", e);
            showToast("데이터 임시 저장에 실패하여 작업을 중단합니다.", CONSTANTS.TOAST_TYPE.ERROR);
            // releaseLock() 등은 finally 블록에서 처리
            return false;
        }
        
        const transactionId = Date.now() + Math.random();
        newData.transactionId = transactionId;
        
        const timestamp = Date.now();
        newData.lastSavedTimestamp = timestamp;
        
        setState({ currentTransactionId: transactionId });
        await chrome.storage.local.set({ appState: newData });
        
        localStorage.removeItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        
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
        clearSortedNotesCache();
        state._virtualFolderCache.recent = null;
        state._virtualFolderCache.favorites = null;
        state._virtualFolderCache.all = null;
        state._virtualFolderCache.trash = null;
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
        // --- [Critical Bug Fix] 2. 작업 성공/실패 여부와 관계없이 반드시 락을 해제합니다. ---
        await releaseWriteLock(window.tabId);
        // --- 락 해제 완료 ---
        
        setState({ isPerformingOperation: false });
        releaseLock();
    }
    return success;
};

// 확인 절차와 실행 로직을 결합한 고차 함수
async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) {
        await action();
    }
}

// 다음 활성 노트 ID 계산 헬퍼
const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;
    const futureNotesInView = notesInView.filter(n => n.id !== deletedNoteId);
    if(futureNotesInView.length === 0) return null;

    const deletedIndexInOriginalView = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndexInOriginalView === -1) return futureNotesInView[0].id;
    
    const nextItem = futureNotesInView[deletedIndexInOriginalView] || futureNotesInView[deletedIndexInOriginalView - 1];
    return nextItem?.id ?? null;
};

// --- 이벤트 핸들러 ---

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

    if (!name) return;

    const updateLogic = async (latestData) => {
        const trimmedName = name.trim();
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
            return null;
        }

        const now = Date.now();
        const newFolderId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
        // [수정] 새 폴더 생성 시 타임스탬프 추가
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

let addNoteLock = false;
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
            const date = new Date(now);
            const datePart = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).slice(0, -1);
            const timePart = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true });
            const baseTitle = `${datePart} ${timePart}의 노트`;

            let newTitle = baseTitle;
            let counter = 2;
            const existingTitles = new Set(activeFolder.notes.map(n => n.title));
            while (existingTitles.has(newTitle)) {
                newTitle = `${baseTitle} (${counter++})`;
            }
            
            const allIds = new Set([
                ...latestData.folders.flatMap(f => [f.id, ...f.notes.map(n => n.id)]),
                ...latestData.trash.map(t => t.id)
            ]);
            const uniqueId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            const newNote = { id: uniqueId, title: newTitle, content: "", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            
            activeFolder.notes.unshift(newNote);
            // [수정] 노트 추가 시 폴더의 updatedAt 갱신
            activeFolder.updatedAt = now;

            const newLastActiveMap = { ...state.lastActiveNotePerFolder, [currentActiveFolderId]: uniqueId };
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    activeNoteId: newNote.id,
                    searchTerm: '',
                    totalNoteCount: state.totalNoteCount + 1,
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
        
        if (!noteToUpdate) return null;

        return actionFn(noteToUpdate, folderOfNote, latestData);
    });
};

export const handlePinNote = (id) => _withNoteAction(id, (note, folder, data) => {
    note.isPinned = !note.isPinned;
    const now = Date.now();
    note.updatedAt = now;
    // [수정] 노트 상태 변경 시 폴더의 updatedAt 갱신
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
    // [수정] 노트 상태 변경 시 폴더의 updatedAt 갱신
    folder.updatedAt = now;
    
    if (note.isFavorite) {
        data.favorites.push(id);
    } else {
        data.favorites = data.favorites.filter(favId => favId !== id);
    }

    return {
        newData: data,
        successMessage: note.isFavorite ? CONSTANTS.MESSAGES.SUCCESS.NOTE_FAVORITED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNFAVORITED,
        postUpdateState: {}
    };
});

// [CRITICAL BUG FIX] 트랜잭션 내 비동기 사용자 입력 로직 해결
export const handleRestoreItem = async (id) => {
    await finishPendingRename();

    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;
    const itemToRestore = state.trash[itemIndex];

    let finalFolderName = itemToRestore.name;
    let targetFolderId = null;

    // --- 트랜잭션 시작 전, 필요한 모든 사용자 입력 수집 ---
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
            if (!newName) return; // 사용자가 취소
            finalFolderName = newName.trim();
        }
    } else if (itemToRestore.type === 'note') {
        const originalFolder = state.folders.find(f => f.id === itemToRestore.originalFolderId);
        if (!originalFolder) {
            const newFolderId = await showFolderSelectPrompt({
                title: '🤔 원본 폴더를 찾을 수 없음',
                message: '이 노트의 원본 폴더가 없거나 휴지통에 있습니다. 복원할 폴더를 선택해주세요.'
            });
            if (!newFolderId) return; // 사용자가 취소
            targetFolderId = newFolderId;
        } else {
            targetFolderId = originalFolder.id;
        }
    }
    // --- 사용자 입력 수집 완료 ---

    const updateLogic = (latestData) => {
        const { folders, trash } = latestData;
        const itemIndexInTx = trash.findIndex(item => item.id === id);
        if (itemIndexInTx === -1) return null; // 다른 탭에서 이미 복원/삭제됨

        const [itemToRestoreInTx] = trash.splice(itemIndexInTx, 1);
        const now = Date.now();

        if (itemToRestoreInTx.type === 'folder') {
            // 트랜잭션 내에서 최종 유효성 검사
            if (folders.some(f => f.name === finalFolderName)) {
                showAlert({ title: '오류', message: `'${finalFolderName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
                return null;
            }
            itemToRestoreInTx.name = finalFolderName;
            
            const allFolderIds = new Set(folders.map(f => f.id));
            const allNoteIdsInLiveFolders = new Set(folders.flatMap(f => f.notes.map(n => n.id)));
            if (allFolderIds.has(itemToRestoreInTx.id)) {
                itemToRestoreInTx.id = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allFolderIds);
            }
            itemToRestoreInTx.notes.forEach(note => {
                if (allNoteIdsInLiveFolders.has(note.id)) {
                    note.id = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allNoteIdsInLiveFolders);
                }
                delete note.deletedAt; delete note.type; delete note.originalFolderId;
            });
            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type;
            // [수정] 복원된 폴더의 updatedAt 갱신
            itemToRestoreInTx.updatedAt = now;
            folders.unshift(itemToRestoreInTx);
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestoreInTx.name), postUpdateState: {} };

        } else if (itemToRestoreInTx.type === 'note') {
            const targetFolderInTx = folders.find(f => f.id === targetFolderId);
            if (!targetFolderInTx) {
                 showAlert({ title: '오류', message: '노트를 복원하려던 폴더가 방금 삭제되었습니다.'});
                 return null;
            }

            const allNoteIds = new Set(folders.flatMap(f => f.notes.map(n => n.id)));
            if (allNoteIds.has(itemToRestoreInTx.id)) {
                itemToRestoreInTx.id = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allNoteIds);
            }
            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type; delete itemToRestoreInTx.originalFolderId;

            // [Critical Bug Fix] 노트 복원 시, 해당 노트의 `updatedAt` 타임스탬프를 갱신합니다.
            // 이렇게 해야 '수정일 순 정렬' 및 '최근 노트' 기능이 정상적으로 동작합니다.
            itemToRestoreInTx.updatedAt = now;

            targetFolderInTx.notes.unshift(itemToRestoreInTx);
            // [수정] 노트가 복원된 폴더의 updatedAt 갱신
            targetFolderInTx.updatedAt = now;
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestoreInTx.title), postUpdateState: {} };
        }
        return null;
    };

    await performTransactionalUpdate(updateLogic);
    saveSession();
};


export const handleDelete = async (id, type) => {
    if (!(await confirmNavigation())) return;
    await finishPendingRename();
    
    const { item } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder : findNote)(id);
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
    const updateLogic = (latestData) => {
        let successMessage = '';
        let postUpdateState = {};
        const now = Date.now();

        if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
        if (state.isDirty && state.dirtyNoteId === id) {
            clearTimeout(debounceTimer);
            postUpdateState.isDirty = false;
            postUpdateState.dirtyNoteId = null;
            postUpdateState.pendingChanges = null; // [아키텍처 수정] pendingChanges 초기화
            updateSaveStatus('saved');
        }

        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            const folderIndex = latestData.folders.findIndex(f => f.id === id);
            if (folderIndex === -1) return null;
            
            const [folderToMove] = latestData.folders.splice(folderIndex, 1);
            folderToMove.type = 'folder';
            folderToMove.deletedAt = now;
            // [수정] 휴지통으로 이동하는 폴더의 updatedAt 갱신
            folderToMove.updatedAt = now;
            latestData.trash.unshift(folderToMove);
            
            folderToMove.notes.forEach(note => {
                latestData.favorites = latestData.favorites.filter(favId => favId !== note.id);
            });

            successMessage = CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name);
            if (state.activeFolderId === id) {
                postUpdateState.activeFolderId = latestData.folders[folderIndex]?.id ?? latestData.folders[folderIndex - 1]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            }
        } else { // NOTE
            let noteToMove, sourceFolderId, sourceFolder;
            let found = false;
            for(const folder of latestData.folders) {
                const noteIndex = folder.notes.findIndex(n => n.id === id);
                if (noteIndex !== -1) {
                    [noteToMove] = folder.notes.splice(noteIndex, 1);
                    sourceFolderId = folder.id;
                    sourceFolder = folder;
                    found = true;
                    break;
                }
            }
            if (!found) return null;

            noteToMove.type = 'note';
            noteToMove.originalFolderId = sourceFolderId;
            noteToMove.deletedAt = now;
            latestData.trash.unshift(noteToMove);
            
            // [수정] 노트가 삭제된 폴더의 updatedAt 갱신
            if (sourceFolder) {
                sourceFolder.updatedAt = now;
            }

            latestData.favorites = latestData.favorites.filter(favId => favId !== id);
            
            successMessage = CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(noteToMove.title || '제목 없음');
            
            if (state.activeNoteId === id) {
                const { item: currentFolder } = findFolder(state.activeFolderId);
                const notesInView = sortNotes(currentFolder?.notes ?? [], state.noteSortOrder);
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, notesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    };
    return performTransactionalUpdate(updateLogic).then(saveSession);
};

export const handlePermanentlyDeleteItem = async (id) => {
    await finishPendingRename();

    const { item } = findNote(id) || findFolder(id); // find in trash
    if (!item) { // Already deleted in another tab
        const itemIndexInState = state.trash.findIndex(i => i.id === id);
        if (itemIndexInState > -1) {
            state.trash.splice(itemIndexInState, 1);
            setState({ trash: [...state.trash] }); // Force render
        }
        return;
    }
    
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
                const postUpdateState = { trash: [] };
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

    pendingRenamePromise = null;
    if (resolvePendingRename) {
        resolvePendingRename();
        resolvePendingRename = null;
    }

    if (!nameSpan.isConnected) {
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
        setState({ renamingItemId: null });
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
                    // [수정] 노트 이름 변경 시, 상위 폴더의 updatedAt도 갱신
                    folder.updatedAt = now;
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
            // [수정] 폴더 이름 변경 시 updatedAt 갱신
            itemToRename.updatedAt = now;
        } else {
            itemToRename.title = newName;
            itemToRename.updatedAt = now;
        }

        return { newData: latestData, successMessage: null, postUpdateState: { renamingItemId: null } };
    };

    const success = await performTransactionalUpdate(updateLogic);
    if (!success) {
        setState({ renamingItemId: null }); // Re-render with original name
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
                cleanup();
                _handleRenameEnd(id, type, nameSpan, false);
            }
        };
        const cleanup = () => {
            nameSpan.removeEventListener('blur', onBlur);
            nameSpan.removeEventListener('keydown', onKeydown);
        };
        nameSpan.addEventListener('blur', onBlur, { once: true });
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0);
};

// --- '열쇠' 방식 저장 관리 로직 ---
let debounceTimer = null;

async function _performSave(noteId, titleToSave, contentToSave) {
    updateSaveStatus('saving');

    const updateLogic = (latestData) => {
        let noteToSave;
        let parentFolder;
        for (const folder of latestData.folders) {
            noteToSave = folder.notes.find(n => n.id === noteId);
            if (noteToSave) {
                parentFolder = folder;
                break;
            }
        }
        if (!noteToSave) return null;

        let finalTitle = titleToSave;
        if (!finalTitle.trim() && contentToSave.trim()) {
            const firstLine = contentToSave.trim().split('\n')[0];
            finalTitle = firstLine.substring(0, CONSTANTS.AUTO_TITLE_LENGTH_KOR) + (firstLine.length > CONSTANTS.AUTO_TITLE_LENGTH_KOR ? '...' : '');
        }

        const now = Date.now();
        noteToSave.title = finalTitle;
        noteToSave.content = contentToSave;
        noteToSave.updatedAt = now;
        
        // [수정] 노트 내용 저장 시, 상위 폴더의 updatedAt도 갱신
        if (parentFolder) {
            parentFolder.updatedAt = now;
        }
        
        return { newData: latestData, successMessage: null, postUpdateState: {} };
    };

    return performTransactionalUpdate(updateLogic);
}

// [CRITICAL BUG FIX] 노트 수정 후 원상 복구 시, 변경 내용이 저장되는 데이터 유실 버그 수정
export async function handleNoteUpdate(isForced = false) {
    if (editorContainer.classList.contains(CONSTANTS.CLASSES.READONLY)) {
        clearTimeout(debounceTimer);
        return true;
    }

    if (editorContainer.style.display === 'none') {
        clearTimeout(debounceTimer);
        return true;
    }
    
    // 강제 저장이 아닌 'input' 또는 'blur' 이벤트로 인한 호출
    if (!isForced) {
        const noteId = state.activeNoteId;
        if (!noteId) return true;
        
        const { item: activeNote } = findNote(noteId);
        if (!activeNote) return true;
        
        const currentTitle = noteTitleInput.value;
        const currentContent = noteContentTextarea.value;
        
        const hasChanged = activeNote.title !== currentTitle || activeNote.content !== currentContent;
        
        // [수정] 한번 dirty 상태가 되면, 원래대로 되돌리는 변경까지 감지하여 저장 로직을 재시작합니다.
        // 이것이 Critical 데이터 유실 버그를 막습니다.
        if (state.isDirty || hasChanged) {
            // isDirty가 false였다면, 처음 변경이 시작된 것
            if (!state.isDirty) {
                setState({ isDirty: true, dirtyNoteId: noteId });
            }
            
            // UI 변경 사항을 즉시 state.pendingChanges에 반영
            const pendingData = {
                title: currentTitle,
                content: currentContent,
                updatedAt: Date.now()
            };
            setState({ pendingChanges: pendingData });

            // --- [CRITICAL BUG FIX] ---
            // 변경 사항이 감지되는 즉시, 비정상 종료에 대비하여 비상 백업 패치를 localStorage에 기록합니다.
            // 이 패치는 저장이 성공적으로 완료되면 즉시 삭제됩니다.
            try {
                const patch = {
                    type: 'note_patch',
                    noteId: noteId,
                    data: pendingData
                };
                const backupKey = `${CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX}${window.tabId}`;
                localStorage.setItem(backupKey, JSON.stringify([patch])); // loadData는 패치 배열을 기대합니다.
            } catch (e) {
                console.error("실시간 비상 백업 패치 저장에 실패했습니다:", e);
                // 이 경우 저장 공간 부족 등 심각한 문제일 수 있으므로 사용자에게 알릴 수 있습니다.
            }
            // --- 수정 끝 ---

            updateSaveStatus('dirty');
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        }
        return true;
    }
    
    // 강제 저장 실행 (debouncer 또는 다른 액션에 의해 호출됨)
    clearTimeout(debounceTimer);
    if (!state.isDirty || !state.pendingChanges) {
        return true;
    }

    const noteIdToSave = state.dirtyNoteId;
    const dataToSave = state.pendingChanges;

    if (!noteIdToSave || !dataToSave) {
        setState({ isDirty: false, dirtyNoteId: null, pendingChanges: null });
        return true;
    }
    
    const { item: noteToModify } = findNote(noteIdToSave);
    if (!noteToModify) {
        setState({ isDirty: false, dirtyNoteId: null, pendingChanges: null });
        return true;
    }
    
    let wasSuccessful = false;
    try {
        window.isSavingInProgress = true;
        const success = await _performSave(noteIdToSave, dataToSave.title, dataToSave.content);
        
        if (!success) {
            updateSaveStatus('dirty');
            return false;
        }
        
        // --- [CRITICAL BUG FIX] ---
        // 저장이 성공적으로 완료되었으므로, 실시간으로 기록했던 비상 백업 패치를 삭제합니다.
        try {
            const backupKey = `${CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX}${window.tabId}`;
            localStorage.removeItem(backupKey);
        } catch (e) {
            console.error("성공 후 비상 백업 패치 삭제에 실패했습니다:", e);
        }
        // --- 수정 끝 ---
        
        wasSuccessful = true;
        
        // 저장이 완료된 후, UI가 다시 변경되었는지 확인 (저장 중 사용자가 추가 입력한 경우)
        const isStillDirtyAfterSave = noteTitleInput.value !== dataToSave.title || noteContentTextarea.value !== dataToSave.content;

        if (isStillDirtyAfterSave) {
            // 새로운 변경사항으로 다시 dirty 상태 설정 시작
            handleNoteUpdate(false);
        } else {
            // 완전히 저장되고 추가 변경 없음
            setState({ isDirty: false, dirtyNoteId: null, pendingChanges: null });
            updateSaveStatus('saved');
        }

    } catch (e) {
        console.error("Save failed:", e);
        updateSaveStatus('dirty'); // 실패 시 다시 dirty 상태로
        wasSuccessful = false;
    } finally {
        window.isSavingInProgress = false;
    }
    return wasSuccessful;
}