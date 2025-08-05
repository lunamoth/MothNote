import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
import { acquireWriteLock, releaseWriteLock, generateUniqueId } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn,
    formatDate
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache } from './renderer.js';
import { changeActiveFolder, changeActiveNote, confirmNavigation } from './navigationActions.js';

let globalSaveLock = Promise.resolve();

export const toYYYYMMDD = (dateInput) => {
    if (!dateInput) return null;
    const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return null;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

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

let calendarRenderer = () => {};
export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [개선 4] 반환값 일관성 확보
export const performTransactionalUpdate = async (updateFn) => {
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
        return { success: false, payload: null };
    }
    
    await globalSaveLock;
    let releaseLocalLock;
    globalSaveLock = new Promise(resolve => { releaseLocalLock = resolve; });

    let resultPayload = null;
    let success = false;
    try {
        setState({ isPerformingOperation: true });

        const storageResult = await chrome.storage.local.get('appState');
        const latestData = storageResult.appState || { folders: [], trash: [], favorites: [] };
        const dataCopy = JSON.parse(JSON.stringify(latestData)); 

        const result = await updateFn(dataCopy);
        
        if (result === null) { 
            await releaseWriteLock(window.tabId);
            releaseLocalLock();
            setState({ isPerformingOperation: false });
            return { success: false, payload: null };
        }

        const { newData, successMessage, postUpdateState, payload } = result;
        resultPayload = payload;
        
        const transactionId = `${window.tabId}-${Date.now()}`;
        newData.transactionId = transactionId;
        newData.lastSavedTimestamp = Date.now();
        
        setState({ currentTransactionId: transactionId });
        await chrome.storage.local.set({ appState: newData });
        
        if (postUpdateState) setState(postUpdateState);
        if (successMessage) showToast(successMessage);
        
        success = true;

    } catch (e) {
        console.error("Transactional update failed:", e);
        showToast("오류가 발생하여 작업을 완료하지 못했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        success = false;
    } finally {
        await releaseWriteLock(window.tabId);
        setState({ isPerformingOperation: false });
        releaseLocalLock();
    }
    return { success, payload: resultPayload };
};

async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) await action();
}

const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;
    const futureNotesInView = notesInView.filter(n => n.id !== deletedNoteId);
    if(futureNotesInView.length === 0) return null;

    const deletedIndexInOriginalView = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndexInOriginalView === -1) return futureNotesInView[0].id;
    
    const nextItem = futureNotesInView[deletedIndexInOriginalView] || futureNotesInView[deletedIndexInOriginalView - 1];
    return nextItem?.id ?? null;
};

export const handleAddFolder = async () => {
    await finishPendingRename();
    if (!(await confirmNavigation())) return;

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

    const allFolderIds = new Set(state.folders.map(f => f.id));
    const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allFolderIds);
    const trimmedName = name.trim();

    const { success } = await performTransactionalUpdate((latestData) => {
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
            return null;
        }

        const now = Date.now();
        const newFolder = { id: newFolderId, name: trimmedName, notes: [], createdAt: now, updatedAt: now };
        latestData.folders.push(newFolder);
        
        return {
            newData: latestData,
            successMessage: null,
            postUpdateState: { activeFolderId: newFolderId, activeNoteId: null }
        };
    });

    if (success) {
        await changeActiveFolder(newFolderId, { force: true });
        requestAnimationFrame(() => {
            const newFolderEl = folderList.querySelector(`[data-id="${newFolderId}"]`);
            if (newFolderEl) {
                newFolderEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                newFolderEl.focus();
            }
        });
    }
};

let addNoteLock = false;
export const handleAddNote = async () => {
    if (addNoteLock) return;
    addNoteLock = true;
    if(addNoteBtn) addNoteBtn.disabled = true;

    try {
        await finishPendingRename();
        if (!(await confirmNavigation())) return;

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        const currentActiveFolderId = state.activeFolderId;

        if (!currentActiveFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(currentActiveFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const allNoteIds = new Set(Array.from(state.noteMap.keys()));
        const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allNoteIds);
        const now = Date.now();

        const { success, payload } = await performTransactionalUpdate((latestData) => {
            const activeFolder = latestData.folders.find(f => f.id === currentActiveFolderId);
            if (!activeFolder) {
                 showAlert({ title: '오류', message: '노트를 추가하려던 폴더가 삭제되었습니다.'});
                 return null;
            }
            
            let baseTitle = `${formatDate(now)}의 노트`;
            let finalTitle = baseTitle;
            let counter = 2;
            while (activeFolder.notes.some(note => note.title === finalTitle)) {
                finalTitle = `${baseTitle} (${counter++})`;
            }

            const newNote = { id: newNoteId, title: finalTitle, content: "", createdAt: now, updatedAt: now, isPinned: false };
            
            activeFolder.notes.unshift(newNote);
            activeFolder.updatedAt = now;

            const newLastActiveMap = { ...(state.lastActiveNotePerFolder || {}), [currentActiveFolderId]: newNoteId };
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    isDirty: false,
                    dirtyNoteId: null,
                    lastActiveNotePerFolder: newLastActiveMap,
                    searchTerm: '',
                },
                payload: { newNoteId: newNote.id } 
            };
        });
        
        if (success && payload?.newNoteId) {
            await changeActiveNote(payload.newNoteId);
            
            requestAnimationFrame(() => {
                if (noteTitleInput) {
                    noteTitleInput.focus();
                    noteTitleInput.select();
                }
            });
        }
    } finally {
        addNoteLock = false;
        if(addNoteBtn) addNoteBtn.disabled = false;
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
    
    if (isNowFavorite) favoritesSet.add(id);
    else favoritesSet.delete(id);
    
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
        
        if (state.isDirty && state.dirtyNoteId === id) {
            clearTimeout(debounceTimer);
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
                // [개선 2] 폴더 삭제 시 다음 폴더 선택 로직 단순화 및 안정화
                const nextFolderIndex = Math.max(0, folderIndex - 1);
                postUpdateState.activeFolderId = folders.length > 0 ? (folders[folderIndex]?.id ?? folders[nextFolderIndex].id) : CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
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
            
            if (state.activeNoteId === id) {
                const { item: currentFolder } = findFolder(state.activeFolderId);
                const notesInView = sortNotes(currentFolder?.notes ?? [], state.noteSortOrder);
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, notesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    });
};

// ... (handleRestoreItem, handlePermanentlyDeleteItem, handleEmptyTrash 함수는 변경 없음) ...
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

    if (!state.isDirty || state.dirtyNoteId !== noteId) {
        return true;
    }
    
    const noteIdToSave = state.dirtyNoteId;
    const titleToSave = currentTitle;
    const contentToSave = currentContent;

    updateSaveStatus('saving');

    const { success } = await performTransactionalUpdate(latestData => {
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
        if (parentFolder) parentFolder.updatedAt = now;
        
        return { newData: latestData, successMessage: null, postUpdateState: {} };
    });
    
    if (success) {
        if (noteTitleInput.value === titleToSave && noteContentTextarea.value === contentToSave) {
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        } else {
            handleNoteUpdate(false);
        }
    } else {
        updateSaveStatus('dirty');
    }

    return success;
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

    // [개선 1] 취소 시 UI 복원 로직 강화
    if (!shouldSave || newName === originalName) {
        setState({ renamingItemId: null });
        if (nameSpan) nameSpan.textContent = originalName; // UI를 원래 이름으로 확실하게 되돌림
        return;
    }
    
    const { success } = await performTransactionalUpdate(latestData => {
        let itemToRename, parentFolder, isDuplicate = false;
        const now = Date.now();
        
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            itemToRename = latestData.folders.find(f => f.id === id);
            if (!itemToRename) return null;
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
    });

    if (!success) {
        setState({ renamingItemId: null });
        if(nameSpan) nameSpan.textContent = originalName;
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
            if (ev.key === 'Enter') {
                ev.preventDefault();
                nameSpan.blur();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                // [개선 1] shouldSave를 false로 전달하여 취소 로직을 명확히 함
                _handleRenameEnd(id, type, nameSpan, false);
            }
        };
        
        nameSpan.addEventListener('blur', onBlur, { once: true });
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0);
};

// [개선 3] 충돌 복구 시 UI 처리 개선
export const handleAddNoteFromConflict = async (title, content) => {
    const targetFolderId = await showFolderSelectPrompt({
        title: '새 노트로 저장',
        message: '삭제된 노트의 미저장 내용을 어느 폴더에 저장할까요?'
    });

    if (!targetFolderId) {
        showToast("저장이 취소되었습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        setState({ isDirty: false, dirtyNoteId: null });
        return;
    }

    const allNoteIds = new Set(Array.from(state.noteMap.keys()));
    const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allNoteIds);
    const now = Date.now();

    const { success, payload } = await performTransactionalUpdate(latestData => {
        const targetFolder = latestData.folders.find(f => f.id === targetFolderId);
        if (!targetFolder) {
            showAlert({ title: '오류', message: '노트를 저장하려던 폴더를 찾을 수 없습니다.' });
            return null;
        }

        const newNote = {
            id: newNoteId,
            title: title || `${formatDate(now)}의 노트 (복구됨)`,
            content: content,
            createdAt: now,
            updatedAt: now,
            isPinned: false
        };

        targetFolder.notes.unshift(newNote);
        targetFolder.updatedAt = now;
        
        return {
            newData: latestData,
            successMessage: null,
            postUpdateState: {
                activeFolderId: targetFolderId,
                isDirty: false,
                dirtyNoteId: null,
            },
            payload: { newNoteId: newNote.id }
        };
    });

    if(success && payload?.newNoteId){
        // 복구된 노트를 즉시 활성화
        await changeActiveNote(payload.newNoteId);
    }
};