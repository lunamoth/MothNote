import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
import { acquireWriteLock, releaseWriteLock } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn,
    formatDate
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
    // crypto.randomUUID가 있으면 사용 (더 강력한 고유성)
    if (typeof crypto?.randomUUID === 'function') {
        let id;
        do {
            id = crypto.randomUUID();
        } while (existingIds.has(id));
        return id;
    }
    
    // Fallback: 기존 방식보다 고유성을 강화
    let id;
    do {
        id = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

// 휴지통에 있는 노트를 제외하고 달력에 표시할 노트 생성 날짜 Set을 다시 빌드합니다. (기능 유지)
export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
    const allNotes = [...Array.from(state.noteMap.values()).map(e => e.note)];
    
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
            forceResolvePendingRename();
        }
    }
};

// 달력 UI 갱신을 위한 함수를 저장할 변수 (기능 유지)
let calendarRenderer = () => {};

export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [아키텍처 리팩토링] 모든 데이터 수정의 유일한 진입점.
// 이 함수의 역할은 이제 'chrome.storage.local에 원자적으로 쓰기'에 집중됩니다.
export const performTransactionalUpdate = async (updateFn) => {
    // 1. 분산 락(Distributed Lock) 획득
    let lockAcquired = false;
    for (let i = 0; i < 5; i++) {
        if (await acquireWriteLock(window.tabId)) {
            lockAcquired = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200));
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

        // 3. 항상 chrome.storage에서 직접 최신 데이터를 읽어 트랜잭션을 시작
        const storageResult = await chrome.storage.local.get('appState');
        const latestData = storageResult.appState || { folders: [], trash: [], favorites: [] };
        const dataCopy = JSON.parse(JSON.stringify(latestData)); 

        // 4. 전달된 함수로 데이터 변경 로직 적용
        const result = await updateFn(dataCopy);
        
        if (result === null) { 
            await releaseWriteLock(window.tabId);
            releaseLocalLock();
            setState({ isPerformingOperation: false });
            return false;
        }

        const { newData, successMessage, postUpdateState } = result;
        
        // 5. 트랜잭션 ID를 부여하여 자신의 변경사항임을 식별
        const transactionId = `${window.tabId}-${Date.now()}`;
        newData.transactionId = transactionId;
        newData.lastSavedTimestamp = Date.now();
        
        // 자신의 트랜잭션 ID를 로컬 state에 먼저 기록합니다.
        // 이렇게 하면 storage.onChanged 이벤트 발생 시 자신의 변경임을 즉시 알 수 있습니다.
        setState({ currentTransactionId: transactionId });

        // 6. [역할의 핵심] chrome.storage에 최종 데이터를 저장. 이것이 유일한 '커밋' 지점.
        await chrome.storage.local.set({ appState: newData });
        
        // 7. [핵심 변경] 로컬 state의 데이터 부분을 직접 업데이트하는 로직을 제거합니다.
        // 모든 데이터 업데이트는 storage.onChanged 이벤트를 통해 handleStorageSync가 처리하도록 위임합니다.
        // 이를 통해 모든 상태 업데이트 경로가 하나로 통일됩니다.
        
        // 단, UI 즉시 반응이 필요한 postUpdateState(예: activeFolderId 변경)는
        // 로컬에서 먼저 처리하여 사용자 경험을 향상시킵니다.
        if (postUpdateState) {
            setState(postUpdateState);
        }

        if (successMessage) {
            showToast(successMessage);
        }
        success = true;

    } catch (e) {
        console.error("Transactional update failed:", e);
        if (e.name === 'QuotaExceededError') {
             showAlert({
                title: '저장 공간 부족',
                message: '브라우저 저장 공간이 가득 차서 더 이상 데이터를 저장할 수 없습니다. 데이터가 손실되지 않도록 즉시 모든 데이터를 내보내기(백업) 해주세요.'
            });
        } else {
            showToast("오류가 발생하여 작업을 완료하지 못했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        }
        success = false;
    } finally {
        // 9. 성공/실패 여부와 관계없이 반드시 모든 락을 해제합니다.
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
            if (state.folders.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
            }
            return { isValid: true };
        }
    });

    if (!name) return;

    const updateLogic = (latestData) => {
        const trimmedName = name.trim();
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
            return null; // 트랜잭션 취소
        }

        const now = Date.now();
        // [버그 수정] 고유 ID 생성을 위해 모든 기존 ID 수집
        const allFolderIds = new Set(latestData.folders.map(f => f.id));
        const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allFolderIds);

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
        // changeActiveFolder는 postUpdateState에 의해 UI가 먼저 반응한 후,
        // storage 이벤트에 의해 전체 데이터가 동기화된 후 최종적으로 UI를 완성합니다.
        await changeActiveFolder(state.activeFolderId, { force: true });
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
            
            // [버그 수정] 고유 ID 생성을 위해 모든 기존 ID 수집
            const allNoteIds = new Set();
            latestData.folders.forEach(f => f.notes.forEach(n => allNoteIds.add(n.id)));
            const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allNoteIds);
            
            let baseTitle = `${formatDate(now)}의 노트`;
            let finalTitle = baseTitle;
            let counter = 2;
            while (activeFolder.notes.some(note => note.title === finalTitle)) {
                finalTitle = `${baseTitle} (${counter++})`;
            }

            const newNote = { id: newNoteId, title: finalTitle, content: "", createdAt: now, updatedAt: now, isPinned: false };
            
            activeFolder.notes.unshift(newNote);
            activeFolder.updatedAt = now;

            const newLastActiveMap = { ...state.lastActiveNotePerFolder, [currentActiveFolderId]: newNoteId };
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    activeNoteId: newNote.id,
                    searchTerm: '',
                    lastActiveNotePerFolder: newLastActiveMap
                }
            };
        };
        
        const success = await performTransactionalUpdate(updateLogic);

        if (success) {
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
        let noteToUpdate = null, folderOfNote = null;
        for (const folder of latestData.folders) {
            const note = folder.notes.find(n => n.id === noteId);
            if (note) {
                noteToUpdate = note; folderOfNote = folder; break;
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
    folder.updatedAt = now;
    return {
        newData: data,
        successMessage: note.isPinned ? CONSTANTS.MESSAGES.SUCCESS.NOTE_PINNED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNPINNED,
        postUpdateState: {}
    };
});

export const handleToggleFavorite = (id) => _withNoteAction(id, (note, folder, data) => {
    const now = Date.now();
    note.updatedAt = now;
    folder.updatedAt = now;
    
    const favoritesSet = new Set(data.favorites || []);
    const isNowFavorite = !favoritesSet.has(id);
    
    if (isNowFavorite) {
        favoritesSet.add(id);
    } else {
        favoritesSet.delete(id);
    }
    data.favorites = Array.from(favoritesSet);

    let postUpdateState = {};
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.FAVORITES.id && !isNowFavorite) {
        postUpdateState.searchTerm = '';
        postUpdateState.preSearchActiveNoteId = null;
    }

    return {
        newData: data,
        successMessage: isNowFavorite ? CONSTANTS.MESSAGES.SUCCESS.NOTE_FAVORITED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNFAVORITED,
        postUpdateState
    };
});

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

export const performDeleteItem = (id, type) => {
    return performTransactionalUpdate(latestData => {
        const { folders, trash } = latestData;
        let successMessage = '', postUpdateState = {};
        const now = Date.now();

        if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
        
        let activeNoteIdBeforeDelete = state.activeNoteId;
        if(state.isDirty && state.dirtyNoteId === id) {
            clearTimeout(debounceTimer);
            activeNoteIdBeforeDelete = state.dirtyNoteId;
            postUpdateState.isDirty = false;
            postUpdateState.dirtyNoteId = null;
            updateSaveStatus('saved');
        }

        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            const folderIndex = folders.findIndex(f => f.id === id);
            if (folderIndex === -1) return null;
            
            const [folderToMove] = folders.splice(folderIndex, 1);
            folderToMove.type = 'folder';
            folderToMove.deletedAt = now;
            folderToMove.updatedAt = now;
            trash.unshift(folderToMove);
            
            const favoritesSet = new Set(latestData.favorites || []);
            folderToMove.notes.forEach(note => favoritesSet.delete(note.id));
            latestData.favorites = Array.from(favoritesSet);

            successMessage = CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name);
            if (state.activeFolderId === id) {
                const nextFolderIndex = Math.max(0, folderIndex - 1);
                postUpdateState.activeFolderId = folders[folderIndex]?.id ?? folders[nextFolderIndex]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            }
        } else { // NOTE
            let noteToMove, sourceFolder;
            for(const folder of folders) {
                const noteIndex = folder.notes.findIndex(n => n.id === id);
                if (noteIndex !== -1) {
                    [noteToMove] = folder.notes.splice(noteIndex, 1);
                    sourceFolder = folder;
                    break;
                }
            }
            if (!noteToMove) return null;

            noteToMove.type = 'note';
            noteToMove.originalFolderId = sourceFolder.id;
            noteToMove.deletedAt = now;
            trash.unshift(noteToMove);
            sourceFolder.updatedAt = now;

            const favoritesSet = new Set(latestData.favorites || []);
            favoritesSet.delete(id);
            latestData.favorites = Array.from(favoritesSet);
            
            successMessage = CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(noteToMove.title || '제목 없음');
            
            if (activeNoteIdBeforeDelete === id) {
                const { item: currentFolder } = findFolder(state.activeFolderId);
                const notesInView = sortNotes(currentFolder?.notes ?? [], state.noteSortOrder);
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, notesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    });
};

export const handleRestoreItem = async (id) => {
    await finishPendingRename();

    const itemToRestore = state.trash.find(item => item.id === id);
    if (!itemToRestore) return;

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
            itemToRestoreInTx.notes.forEach(note => { delete note.deletedAt; delete note.type; delete note.originalFolderId; });
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
};

export const handlePermanentlyDeleteItem = async (id) => {
    await finishPendingRename();

    const item = state.trash.find(i => i.id === id);
    if (!item) return;
    
    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '💥 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            const itemIndex = latestData.trash.findIndex(i => i.id === id);
            if (itemIndex === -1) return null;
            
            const [deletedItem] = latestData.trash.splice(itemIndex, 1);
            
            let postUpdateState = {};
            if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
            if (state.activeNoteId === id) {
                const trashItems = state.trash; 
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, trashItems);
            }
            
            if (deletedItem.type === 'note' || !deletedItem.type) {
                const favoritesSet = new Set(latestData.favorites || []);
                if(favoritesSet.has(id)) {
                    favoritesSet.delete(id);
                    latestData.favorites = Array.from(favoritesSet);
                }
            }
            
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS,
                postUpdateState
            };
        })
    );
};

export const handleEmptyTrash = async () => {
    await finishPendingRename();
    if (state.trash.length === 0) return;

    const message = CONSTANTS.MESSAGES.CONFIRM.EMPTY_TRASH(state.trash.length);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            let postUpdateState = {};
            if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                postUpdateState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            }
            if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                postUpdateState.renamingItemId = null;
            }

            const favoritesSet = new Set(latestData.favorites || []);
            latestData.trash.forEach(item => {
                if (item.type === 'note' || !item.type) {
                     favoritesSet.delete(item.id);
                }
            });
            latestData.favorites = Array.from(favoritesSet);

            latestData.trash = [];
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS, postUpdateState };
        })
    );
};


let debounceTimer = null;
export async function handleNoteUpdate(isForced = false) {
    if (editorContainer.classList.contains(CONSTANTS.CLASSES.READONLY) || editorContainer.style.display === 'none') {
        clearTimeout(debounceTimer);
        return true;
    }
    
    const noteId = state.activeNoteId;
    if (!noteId) return true;
    
    // [중요] 최신 데이터를 state에서 가져옵니다. (렌더링을 통해 항상 최신 상태)
    const { item: activeNote } = findNote(noteId);
    if (!activeNote) return true;
    
    const currentTitle = noteTitleInput.value;
    const currentContent = noteContentTextarea.value;
    const hasChanged = activeNote.title !== currentTitle || activeNote.content !== currentContent;
    
    if (!isForced) {
        if (hasChanged) {
            if (!state.isDirty) {
                setState({ isDirty: true, dirtyNoteId: noteId });
                updateSaveStatus('dirty');
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        }
        return true;
    }
    
    clearTimeout(debounceTimer);

    if (!state.isDirty) {
        return true;
    }
    
    const noteIdToSave = state.dirtyNoteId;
    const titleToSave = currentTitle;
    const contentToSave = currentContent;

    updateSaveStatus('saving');

    const updateLogic = (latestData) => {
        let noteToSave, parentFolder;
        for (const folder of latestData.folders) {
            noteToSave = folder.notes.find(n => n.id === noteIdToSave);
            if (noteToSave) { parentFolder = folder; break; }
        }
        if (!noteToSave) {
            console.warn(`저장하려던 노트(ID: ${noteIdToSave})를 찾을 수 없습니다.`);
            return null;
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
        // 저장이 성공하면, UI에 추가적인 변경이 없는 경우에만 dirty 상태를 해제합니다.
        // 실제 데이터 업데이트는 storage.onChanged 이벤트가 처리합니다.
        if (noteTitleInput.value === titleToSave && noteContentTextarea.value === contentToSave) {
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        } else {
            // 저장하는 동안 사용자가 추가 입력한 경우, 다시 dirty 상태로 전환
            handleNoteUpdate(false);
        }
    } else {
        // 저장 실패 시 dirty 상태 유지
        updateSaveStatus('dirty');
    }

    return wasSuccessful;
}

const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    nameSpan.contentEditable = false;
    if (resolvePendingRename) {
        resolvePendingRename();
        resolvePendingRename = null;
    }
    pendingRenamePromise = null;

    if (!nameSpan.isConnected) {
        setState({ renamingItemId: null });
        return;
    }

    const { item: currentItem } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
    if (!currentItem) {
        setState({ renamingItemId: null }); return;
    }

    const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
    const newName = nameSpan.textContent.trim();

    if (!shouldSave || newName === originalName) {
        setState({ renamingItemId: null });
        return;
    }
    
    const updateLogic = (latestData) => {
        let itemToRename, parentFolder, isDuplicate = false;
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
                if (note) { itemToRename = note; parentFolder = folder; break; }
            }
            if (!itemToRename) return null;
        }

        if (!newName) {
            showToast(CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR, CONSTANTS.TOAST_TYPE.ERROR); return null;
        }
        if (isDuplicate) {
            showToast(CONSTANTS.MESSAGES.ERROR.DUPLICATE_NAME_ERROR(newName), CONSTANTS.TOAST_TYPE.ERROR); return null;
        }

        if (type === CONSTANTS.ITEM_TYPE.FOLDER) itemToRename.name = newName;
        else itemToRename.title = newName;
        
        itemToRename.updatedAt = now;
        if (parentFolder) parentFolder.updatedAt = now;

        return { newData: latestData, successMessage: null, postUpdateState: { renamingItemId: null } };
    };

    const success = await performTransactionalUpdate(updateLogic);
    if (!success) {
        // 실패 시, state를 갱신하지 않고 렌더러가 storage.onChanged를 통해
        // 어차피 원래 이름으로 되돌릴 것이므로 여기서는 UI 상태만 초기화
        setState({ renamingItemId: null });
    }
};

export const startRename = (liElement, type) => {
    const id = liElement?.dataset.id;
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id || !id) return;
    if (Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;
    if (state.renamingItemId) return;

    setState({ renamingItemId: id });

    setTimeout(() => {
        const newLiElement = document.querySelector(`.item-list-entry[data-id="${id}"]`);
        if (!newLiElement) return;
        const nameSpan = newLiElement.querySelector('.item-name');
        if (!nameSpan) return;
        
        nameSpan.contentEditable = true; nameSpan.focus();
        document.execCommand('selectAll', false, null);

        pendingRenamePromise = new Promise(resolve => { resolvePendingRename = resolve; });

        const onBlur = () => _handleRenameEnd(id, type, nameSpan, true);
        const onKeydown = (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); nameSpan.blur(); }
            else if (ev.key === 'Escape') {
                ev.preventDefault();
                const { item } = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id);
                nameSpan.textContent = item ? (item.name || item.title) : '';
                _handleRenameEnd(id, type, nameSpan, false);
            }
        };
        
        nameSpan.addEventListener('blur', onBlur, { once: true });
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0);
};