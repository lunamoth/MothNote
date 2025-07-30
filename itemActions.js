import { state, setState, findFolder, findNote, updateNoteCreationDates, CONSTANTS } from './state.js';
import { saveData, saveSession } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache, sortedNotesCache } from './renderer.js';
import { changeActiveFolder } from './navigationActions.js';

// --- [수정] Promise 기반 이름 변경 동기화 ---
let pendingRenamePromise = null;

/**
 * 진행 중인 이름 변경 작업을 강제로 완료(저장 또는 취소)시킵니다.
 * 다른 액션을 실행하기 전에 호출하여 데이터 불일치를 방지합니다.
 */
export const finishPendingRename = async () => {
    if (state.renamingItemId && pendingRenamePromise) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur(); // blur 이벤트가 이름 변경 완료 로직을 트리거합니다.
            await pendingRenamePromise; // blur 이벤트 처리 및 상태 업데이트가 완료될 때까지 기다립니다.
        }
    }
};


// 달력 UI 갱신을 위한 함수를 저장할 변수
let calendarRenderer = () => {};

// app.js에서 달력 렌더러 함수를 주입받기 위한 함수
export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// --- [최적화] 상태 변경 및 저장을 위한 헬퍼 함수 ---
const commitChanges = async (newState = {}) => {
    clearSortedNotesCache();
    // [버그 수정] 가상 폴더 캐시를 초기화하여 변경사항이 즉시 반영되도록 함
    state._virtualFolderCache.recent = null;
    state._virtualFolderCache.favorites = null;
    state._virtualFolderCache.all = null;

    setState(newState);
    await saveData();
};

// --- [최적화] 공통 후처리 로직 추상화 ---
const finalizeItemChange = async (newState = {}, successMessage = '') => {
    updateNoteCreationDates();
    calendarRenderer(true);
    if (successMessage) {
        showToast(successMessage);
    }
    await commitChanges(newState);
};


// --- [최적화 & 수정] 노트 관련 액션을 위한 고차 함수 ---
const withNote = async (noteId, action) => {
    // [수정] 다른 노트에 대한 액션 실행 전, 진행 중인 이름 변경을 강제로 완료합니다.
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


// --- 이벤트 핸들러 ---

export const handleRestoreItem = async (id) => {
    await finishPendingRename(); // 복원 전 이름 변경 완료
    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;

    const itemToRestore = { ...state.trash[itemIndex] };

    if (itemToRestore.type === 'folder') {
        // [수정] 폴더 복원 시 이름 중복 확인 로직 추가
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

            if (newName) {
                itemToRestore.name = newName.trim();
            } else {
                return; // 사용자가 프롬프트를 취소하면 복원 중단
            }
        }

        const notesFromTrash = state.trash.filter(i => i.originalFolderId === id && i.type === 'note');
        const noteIdsToRestore = new Set(notesFromTrash.map(n => n.id));

        state.totalNoteCount += notesFromTrash.length;
        itemToRestore.notes = notesFromTrash.map(note => {
            delete note.deletedAt; delete note.type; delete note.originalFolderId;
            if (note.isFavorite) state.favorites.add(note.id);
            return note;
        });

        delete itemToRestore.deletedAt; delete itemToRestore.type;
        state.folders.unshift(itemToRestore);
        state.trash = state.trash.filter(i => i.id !== id && !noteIdsToRestore.has(i.id));

        itemToRestore.notes.forEach(note => {
            state.noteMap.set(note.id, { note: note, folderId: itemToRestore.id });
        });
        
        await finalizeItemChange({}, CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestore.name));

    } else if (itemToRestore.type === 'note') {
        const { item: originalFolder, isInTrash } = findFolder(itemToRestore.originalFolderId);
        let targetFolder = null;

        if (originalFolder && !isInTrash) {
            targetFolder = originalFolder;
        } else {
            const newFolderId = await showFolderSelectPrompt({
                title: '🤔 원본 폴더를 찾을 수 없음',
                message: '이 노트의 원본 폴더가 없거나 휴지통에 있습니다. 복원할 폴더를 선택해주세요.'
            });

            if (newFolderId) {
                targetFolder = findFolder(newFolderId).item;
            }
        }

        if (!targetFolder) return;

        state.trash.splice(itemIndex, 1);
        delete itemToRestore.deletedAt; delete itemToRestore.type; delete itemToRestore.originalFolderId;
        if (itemToRestore.isFavorite) state.favorites.add(itemToRestore.id);
        
        targetFolder.notes.unshift(itemToRestore);
        state.totalNoteCount++;
        state.noteMap.set(itemToRestore.id, { note: itemToRestore, folderId: targetFolder.id });

        await finalizeItemChange({}, CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestore.title));
    }
    saveSession(); // [수정] 복원 후 세션 상태 저장
};

const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;
    const deletedIndex = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndex === -1) return notesInView[0]?.id ?? null;
    const nextNote = notesInView[deletedIndex + 1] || notesInView[deletedIndex - 1] || null;
    return nextNote?.id ?? null;
};

const focusAfterDeletion = (listElement, deletedItemId) => {
    const children = Array.from(listElement.children);
    const deletedIndex = children.findIndex(el => el.dataset && el.dataset.id === deletedItemId);
    if (deletedIndex === -1) {
        const firstItem = listElement.querySelector('.item-list-entry');
        if (firstItem) firstItem.focus();
        return;
    }
    const nextFocusElement = children[deletedIndex + 1] || children[deletedIndex - 1] || listElement;
    if (nextFocusElement && typeof nextFocusElement.focus === 'function') nextFocusElement.focus();
};

export const handleAddFolder = async () => {
    await finishPendingRename();

    const name = await showPrompt({
        title: CONSTANTS.MODAL_TITLES.NEW_FOLDER,
        placeholder: '📁 폴더 이름을 입력하세요',
        hideCancelButton: true,
        validationFn: (value) => {
            const trimmedValue = value.trim();
            if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
            if (state.folders.some(f => f.name === trimmedValue)) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
            return { isValid: true };
        }
    });

    if (name) {
        const newFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${Date.now()}`, name: name.trim(), notes: [] };
        state.folders.push(newFolder);
        await changeActiveFolder(newFolder.id);
        await saveData();
        
        // [개선] 새로 생성된 폴더로 스크롤
        setTimeout(() => {
            const newFolderEl = folderList.querySelector(`[data-id="${newFolder.id}"]`);
            if (newFolderEl) {
                newFolderEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }, 100); // DOM 렌더링 시간을 고려
    }
};

export const handleAddNote = async () => {
    await finishPendingRename();

    const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
    if (!state.activeFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(state.activeFolderId)) {
        showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    const { item: activeFolder } = findFolder(state.activeFolderId);
    if (activeFolder) {
        const baseTitle = "📝 새 노트";
        let newTitle = baseTitle;
        let counter = 2;
        const existingTitles = new Set(activeFolder.notes.map(n => n.title));
        while (existingTitles.has(newTitle)) newTitle = `${baseTitle} (${counter++})`;

        const now = Date.now();
        const newNote = { id: `${CONSTANTS.ID_PREFIX.NOTE}${now}`, title: newTitle, content: "", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
        activeFolder.notes.unshift(newNote);
        state.totalNoteCount++;
        state.lastActiveNotePerFolder[state.activeFolderId] = newNote.id;
        state.noteMap.set(newNote.id, { note: newNote, folderId: state.activeFolderId });

        // [버그 수정] toISOString()은 UTC를 반환하므로, 사용자 로컬 시간대 기준으로 날짜 문자열 생성
        const noteDate = new Date(newNote.createdAt);
        const y = noteDate.getFullYear();
        const m = String(noteDate.getMonth() + 1).padStart(2, '0');
        const d = String(noteDate.getDate()).padStart(2, '0');
        const newNoteDateStr = `${y}-${m}-${d}`;

        state.noteCreationDates.add(newNoteDateStr);
        calendarRenderer(true);

        await commitChanges({ activeNoteId: newNote.id, searchTerm: '' });
        saveSession();
        
        // [개선] 새로 생성된 노트로 스크롤하고 제목 입력 필드에 포커스
        setTimeout(() => {
            const newNoteEl = noteList.querySelector(`[data-id="${newNote.id}"]`);
            if (newNoteEl) {
                newNoteEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            noteTitleInput.focus();
            noteTitleInput.select();
        }, 100); // DOM 렌더링 시간을 고려
    }
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

const handleDeleteFolder = async (id) => {
    const { item: folder, index } = findFolder(id);
    if (!folder) return;

    state.totalNoteCount -= folder.notes.length;
    const folderToMove = state.folders.splice(index, 1)[0];
    const noteIdsInDeletedFolder = new Set(folderToMove.notes.map(n => n.id));
    for (const folderId in state.lastActiveNotePerFolder) {
        if (noteIdsInDeletedFolder.has(state.lastActiveNotePerFolder[folderId])) {
            delete state.lastActiveNotePerFolder[folderId];
        }
    }

    moveItemToTrash(folderToMove, 'folder');
    folderToMove.notes.reverse().forEach(note => {
        state.favorites.delete(note.id);
        moveItemToTrash(note, 'note', folderToMove.id);
    });
    noteIdsInDeletedFolder.forEach(noteId => state.noteMap.delete(noteId));
    
    delete state.lastActiveNotePerFolder[id];
    
    const nextActiveFolderId = (state.activeFolderId === id) 
        ? state.folders[Math.max(0, index - 1)]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id 
        : state.activeFolderId;

    await finalizeItemChange({}, CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name));
    
    if (state.activeFolderId === id) {
        await changeActiveFolder(nextActiveFolderId);
    }
    
    focusAfterDeletion(folderList, id);
};

const handleDeleteNote = async (id) => {
    const { item, folder } = findNote(id);
    if (!item) return;

    let nextActiveNoteIdToSet = null;
    const wasActiveNoteDeleted = state.activeNoteId === id;
    const wasInDateFilteredView = !!state.dateFilter;
    if (wasActiveNoteDeleted) {
        const notesInCurrentView = sortedNotesCache.result;
        if (notesInCurrentView) nextActiveNoteIdToSet = getNextActiveNoteAfterDeletion(id, notesInCurrentView);
        else if (folder) nextActiveNoteIdToSet = getNextActiveNoteAfterDeletion(id, sortNotes(folder.notes, state.noteSortOrder));
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
        // [버그 수정] toISOString()으로 인한 시간대 문제를 피하기 위해 날짜 구성 요소 직접 비교
        const filterDate = new Date(state.dateFilter);
        
        const hasOtherNotesOnSameDate = Array.from(state.noteMap.values()).some(({note}) => {
            if (note.id === item.id) return false; // 자기 자신은 제외
            const noteDate = new Date(note.createdAt);
            return noteDate.getFullYear() === filterDate.getFullYear() &&
                   noteDate.getMonth() === filterDate.getMonth() &&
                   noteDate.getDate() === filterDate.getDate();
        });

        if (!hasOtherNotesOnSameDate) {
            // noteCreationDates Set에서 제거할 'YYYY-MM-DD' 형식의 로컬 날짜 문자열 생성
            const year = filterDate.getFullYear();
            const month = String(filterDate.getMonth() + 1).padStart(2, '0');
            const day = String(filterDate.getDate()).padStart(2, '0');
            const dateStrToRemove = `${year}-${month}-${day}`;

            state.noteCreationDates.delete(dateStrToRemove);
            newState.dateFilter = null;
            newState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
            newState.activeNoteId = null;
        }
    }

    await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(item.title || '제목 없음'));
    
    if (wasActiveNoteDeleted) saveSession();
    focusAfterDeletion(noteList, id);
};

export const handleDelete = async (id, type, force = false) => {
    await finishPendingRename();
    const finder = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder : findNote;
    const { item } = finder(id);
    if (!item) return;

    if (force) {
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) await handleDeleteFolder(id);
        else await handleDeleteNote(id);
        return;
    }

    const itemName = item.name || item.title || '제목 없음';
    const confirmMessage = type === CONSTANTS.ITEM_TYPE.FOLDER
        ? `📁 '${itemName}' 폴더와 포함된 모든 노트를 휴지통으로 이동할까요?`
        : `📝 '${itemName}' 노트를 휴지통으로 이동할까요?`;

    await withConfirmation(
        { title: '🗑️ 휴지통으로 이동', message: confirmMessage, confirmText: '이동' },
        async () => {
            if (type === CONSTANTS.ITEM_TYPE.FOLDER) await handleDeleteFolder(id);
            else await handleDeleteNote(id);
        }
    );
};

export const handlePermanentlyDeleteItem = async (id) => {
    await finishPendingRename();
    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;
    const item = state.trash[itemIndex];

    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '삭제', confirmButtonType: 'danger' },
        async () => {
            const idsToDelete = new Set([id]);
            let successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS;

            if (item.type === 'folder') {
                state.trash.forEach(i => {
                    if (i.originalFolderId === id && i.type === 'note') idsToDelete.add(i.id);
                });
                successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_FOLDER_SUCCESS;
            }
            
            state.trash = state.trash.filter(i => !idsToDelete.has(i.id));
            
            await finalizeItemChange({}, successMessage);
            focusAfterDeletion(noteList, id);
        }
    );
};

export const handleEmptyTrash = async () => {
    await finishPendingRename();
    if (state.trash.length === 0) return;

    const folderCount = state.trash.filter(item => item.type === 'folder').length;
    const noteCount = state.trash.length - folderCount;
    const messageParts = [];
    if (folderCount > 0) messageParts.push(`폴더 ${folderCount}개`);
    if (noteCount > 0) messageParts.push(`노트 ${noteCount}개`);
    const message = `휴지통에 있는 ${messageParts.join('와 ')} (총 ${state.trash.length}개 항목)을(를) 영구적으로 삭제할까요?`;

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '모두 삭제', confirmButtonType: 'danger' },
        async () => {
            state.trash = [];
            await finalizeItemChange({}, CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS);
        }
    );
};

// [리팩토링] 이름 변경 완료 로직을 별도 함수로 분리
const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    nameSpan.contentEditable = false;
    setState({ renamingItemId: null }); // 즉시 상태 변경하여 중복 호출 방지

    if (!nameSpan.isConnected) return;

    const finder = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder : findNote;
    const { item: currentItem, folder } = finder(id);

    if (!currentItem) return;

    const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
    const newName = nameSpan.textContent.trim();

    // 저장하지 않거나(Escape) 이름이 변경되지 않은 경우, 원래 텍스트로 복원하고 종료
    if (!shouldSave || newName === originalName) {
        nameSpan.textContent = originalName;
        return;
    }

    if (!newName) {
        showToast(CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR, CONSTANTS.TOAST_TYPE.ERROR);
        nameSpan.textContent = originalName;
        return;
    }

    let isDuplicate = false;
    const newNameLower = newName.toLowerCase();
    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        // [수정] 가상 폴더 이름으로 변경하는 것을 방지
        const virtualFolderNames = Object.values(CONSTANTS.VIRTUAL_FOLDERS).map(vf => vf.name.toLowerCase());
        if (virtualFolderNames.includes(newNameLower)) {
            showToast('시스템에서 사용하는 이름으로는 변경할 수 없습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            nameSpan.textContent = originalName;
            return;
        }
        isDuplicate = state.folders.some(f => f.id !== id && f.name.toLowerCase() === newNameLower);
    } else {
        isDuplicate = folder.notes.some(n => n.id !== id && n.title.toLowerCase() === newNameLower);
    }

    if (isDuplicate) {
        showToast(CONSTANTS.MESSAGES.ERROR.DUPLICATE_NAME_ERROR(newName), CONSTANTS.TOAST_TYPE.ERROR);
        nameSpan.textContent = originalName;
        return;
    }

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        currentItem.name = newName;
    } else {
        currentItem.title = newName;
        currentItem.updatedAt = Date.now();
    }
    await commitChanges(); // 변경사항 저장 및 UI 업데이트
};


export const startRename = (liElement, type) => {
    const id = liElement?.dataset.id;
    if (!id || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;
    
    const nameSpan = liElement.querySelector('.item-name');
    if (!nameSpan) return;

    setState({ renamingItemId: id });
    
    // --- [수정] Promise 기반 동기화 로직 ---
    let resolvePromise;
    pendingRenamePromise = new Promise(resolve => { resolvePromise = resolve; });

    // 이벤트 핸들러를 한 번만 연결하기 위해 클로저 사용
    const onBlur = async () => {
        cleanup();
        await _handleRenameEnd(id, type, nameSpan, true);
        resolvePromise();
        pendingRenamePromise = null;
    };

    const onKeydown = async (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            nameSpan.blur(); // blur 이벤트가 _handleRenameEnd 호출
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cleanup();
            // _handleRenameEnd를 await하고 promise를 resolve
            await _handleRenameEnd(id, type, nameSpan, false);
            resolvePromise();
            pendingRenamePromise = null;
        }
    };
    
    const cleanup = () => {
        nameSpan.removeEventListener('blur', onBlur);
        nameSpan.removeEventListener('keydown', onKeydown);
    };

    nameSpan.addEventListener('blur', onBlur);
    nameSpan.addEventListener('keydown', onKeydown);
};


let debounceTimer;
const debounce = (fn, delay) => { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, delay); };
let isSaving = false;

// [BUGFIX] handleNoteUpdate가 Promise를 반환하도록 구조 변경
export const handleNoteUpdate = (isForced = false) => {
    return new Promise(async (resolve) => {
        if (state.renamingItemId && isForced) return resolve();
        if (isSaving && !isForced) return resolve();

        const noteIdToUpdate = state.activeNoteId;
        if (!noteIdToUpdate) return resolve();

        const { item: activeNote } = findNote(noteIdToUpdate);
        if (activeNote) {
            let newTitle = noteTitleInput.value;
            const newContent = noteContentTextarea.value;
            if (!state.isDirty && !newTitle.trim() && newContent.trim()) {
                newTitle = newContent.split('\n')[0].trim().slice(0, CONSTANTS.AUTO_TITLE_LENGTH);
                if (document.activeElement !== noteTitleInput) noteTitleInput.value = newTitle;
            }

            if (activeNote.title !== newTitle || activeNote.content !== newContent) {
                if (!state.isDirty) { setState({ isDirty: true }); updateSaveStatus('dirty'); }
                activeNote.title = newTitle; activeNote.content = newContent; activeNote.updatedAt = Date.now();

                const saveAndUpdate = async () => {
                    if (state.activeNoteId !== noteIdToUpdate) {
                        if (state.isDirty) setState({ isDirty: false });
                        updateSaveStatus('saved'); 
                        isSaving = false;
                        return; // 여기서 resolve()를 호출하지 않음, 호출부에서 관리
                    }
                    isSaving = true;
                    updateSaveStatus('saving');
                    await saveData();
                    
                    clearSortedNotesCache();
                    state._virtualFolderCache.recent = null;

                    setState({});
                    updateSaveStatus('saved');
                    if (state.isDirty) setState({ isDirty: false });
                    isSaving = false;
                };

                if (isForced) {
                    clearTimeout(debounceTimer);
                    await saveAndUpdate();
                    resolve(); // 강제 저장 후 Promise를 resolve
                } else {
                    debounce(async () => {
                        await saveAndUpdate();
                        resolve(); // 디바운스된 저장 후 Promise를 resolve
                    }, CONSTANTS.DEBOUNCE_DELAY.SAVE);
                }
            } else {
                resolve(); // 변경사항이 없으면 즉시 resolve
            }
        } else {
            resolve(); // 활성 노트가 없으면 즉시 resolve
        }
    });
};