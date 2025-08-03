import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveData, saveSession } from './storage.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn
} from './components.js';
import { updateSaveStatus, clearSortedNotesCache, sortedNotesCache } from './renderer.js';
import { changeActiveFolder } from './navigationActions.js';

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

// [개선] 다른 파일에서 재사용할 수 있도록 export 추가
export const finishPendingRename = async () => {
    if (state.renamingItemId && pendingRenamePromise) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur();
            await pendingRenamePromise;
        }
    }
};

// 달력 UI 갱신을 위한 함수를 저장할 변수
let calendarRenderer = () => {};

export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// --- 상태 변경 및 저장을 위한 헬퍼 함수 ---
const commitChanges = async (newState = {}) => {
    clearSortedNotesCache();
    state._virtualFolderCache.recent = null;
    state._virtualFolderCache.favorites = null;
    state._virtualFolderCache.all = null;
    // [버그 수정] 휴지통 캐시도 함께 초기화하여 삭제 후 UI가 즉시 갱신되도록 합니다.
    state._virtualFolderCache.trash = null;

    setState(newState);
    await saveData();
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
    const itemIndex = state.trash.findIndex(item => item.id === id);
    if (itemIndex === -1) return;

    const itemToRestore = { ...state.trash[itemIndex] };

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

            if (newName) {
                itemToRestore.name = newName.trim();
            } else {
                return;
            }
        }

        const notesFromTrash = state.trash.filter(i => i.originalFolderId === id && i.type === 'note');
        const noteIdsToRestore = new Set(notesFromTrash.map(n => n.id));

        state.totalNoteCount += notesFromTrash.length;
        itemToRestore.notes = notesFromTrash.map(note => {
            delete note.deletedAt; delete note.type; delete note.originalFolderId;
            // [수정 시작] 폴더 내 노트의 즐겨찾기 상태를 복원하는 로직 추가
            if (note.isFavorite) {
                state.favorites.add(note.id);
            }
            // [수정 끝]
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
        await saveData();
        
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
            
            // [수정] crypto.randomUUID()의 안정성을 위해 대체(Fallback) ID 생성 로직 추가
            const generateFallbackId = () => `${CONSTANTS.ID_PREFIX.NOTE}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            const uniqueId = (typeof crypto?.randomUUID === 'function')
                ? crypto.randomUUID()
                : generateFallbackId();

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
            moveItemToTrash(note, 'note', folderToMove.id);
        });

        // [BUG #1 FIX] 폴더 삭제 시, 해당 폴더에 있던 노트들의 즐겨찾기 상태도 함께 제거
        noteIdsInDeletedFolder.forEach(noteId => {
            state.noteMap.delete(noteId);
            state.favorites.delete(noteId);
        });
        
        delete state.lastActiveNotePerFolder[id];
        
        // [버그 수정] 폴더 삭제 후 다음 활성 폴더/노트 상태를 한 번에 업데이트
        const newState = {};
        if (state.activeFolderId === id) {
            newState.activeFolderId = state.folders[index]?.id ?? state.folders[index - 1]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
            newState.activeNoteId = null; // 명시적으로 null 처리
        }
        
        // `changeActiveFolder` 호출 대신, `finalizeItemChange`로 상태를 한번에 업데이트
        await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name));
    };
    
    animateAndRemove(id, deletionLogic);
};

const handleDeleteNote = (id) => {
    const deletionLogic = async () => {
        const { item, folder } = findNote(id);
        if (!item) return;

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
                notesInCurrentView = filteredNotes.sort((a,b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
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
        let nextActiveNoteIdToSet = null;
        const wasActiveItemDeleted = state.activeNoteId === id;

        if (wasActiveItemDeleted) {
            // [High 버그 수정] 불안정한 캐시(sortedNotesCache) 대신,
            // 현재 state.trash를 기준으로 표시될 목록을 즉시 생성하여 사용합니다.
            // 이렇게 하면 삭제와 같은 중요 작업이 항상 최신 데이터에 기반하여 동작합니다.
            const currentTrashItems = state.trash
                .filter(i =>
                    (i.title ?? i.name ?? '').toLowerCase().includes(state.searchTerm.toLowerCase())
                )
                .sort((a, b) => (b.deletedAt ?? 0) - (b.deletedAt ?? 0));
            
            nextActiveNoteIdToSet = getNextActiveNoteAfterDeletion(id, currentTrashItems);
        }
        
        const idsToDelete = new Set([id]);
        let successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS;

        if (item.type === 'folder') {
            state.trash.forEach(i => {
                if (i.originalFolderId === id && i.type === 'note') {
                    idsToDelete.add(i.id);
                }
            });
            successMessage = CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_FOLDER_SUCCESS;
        }

        state.trash = state.trash.filter(i => !idsToDelete.has(i.id));

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
    const noteCount = state.trash.length - folderCount;
    const messageParts = [];
    if (folderCount > 0) messageParts.push(`폴더 ${folderCount}개`);
    if (noteCount > 0) messageParts.push(`노트 ${noteCount}개`);
    const message = `휴지통에 있는 ${messageParts.join('와 ')} (총 ${state.trash.length}개 항목)을(를) 영구적으로 삭제할까요?`;

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 삭제', confirmButtonType: 'danger' },
        async () => {
            // [검증] High 버그 수정 사항 확인: await 이후 현재 state를 다시 확인하는 올바른 로직이 적용되어 있습니다.
            // 이 로직은 사용자가 확인창이 떠 있는 동안 다른 곳으로 이동해도, 현재 상태를 기준으로 동작하므로 안전합니다.
            const wasInTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
            const newState = { trash: [] };

            if (wasInTrashView) {
                newState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                newState.activeNoteId = null;
            }

            // finalizeItemChange가 상태 업데이트, 저장, 렌더링을 모두 처리
            await finalizeItemChange(newState, CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS);
            
            // 세션 정보는 별도로 저장
            saveSession();
        }
    );
};

// 이름 변경 완료 로직
const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    nameSpan.contentEditable = false;

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

        // Promise와 이벤트 리스너 설정 (이전과 동일)
        let resolvePromise;
        pendingRenamePromise = new Promise(resolve => { resolvePromise = resolve; });

        const onBlur = async () => {
            cleanup();
            await _handleRenameEnd(id, type, nameSpan, true);
            resolvePromise();
            pendingRenamePromise = null;
        };

        const onKeydown = async (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                nameSpan.blur();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                cleanup();
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
    }, 0); // macrotask queue를 사용하여 렌더링 후에 실행되도록 보장합니다.
};

// --- '열쇠' 방식 저장 관리 로직 ---

let debounceTimer = null;
let saveLock = Promise.resolve(); // '열쇠' 역할을 하는 Promise. 초기는 즉시 완료된 상태.

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

// [BUG 1 FIX] handleNoteUpdate가 저장 성공 여부(boolean)를 반환하도록 수정
export async function handleNoteUpdate(isForced = false, skipSave = false) {
    if (editorContainer.style.display === 'none') {
        clearTimeout(debounceTimer);
        return true; // 저장할 것이 없으므로 성공으로 간주
    }
    
    if (state.renamingItemId && isForced) return true;
    
    if (!isForced) {
        const noteId = state.activeNoteId;
        if (!noteId) return true;

        const { item: activeNote } = findNote(noteId);
        if (!activeNote) return true;
        
        const hasChanged = activeNote.title !== noteTitleInput.value || activeNote.content !== noteContentTextarea.value;
        
        if (hasChanged) {
            if (!state.isDirty) {
                setState({ isDirty: true });
            }
            updateSaveStatus('dirty');
            
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNoteUpdate(true), CONSTANTS.DEBOUNCE_DELAY.SAVE);
        }
        return true;
    }
    
    clearTimeout(debounceTimer);

    const noteIdToSave = state.activeNoteId;
    if (!noteIdToSave) return true;
    const titleToSave = noteTitleInput.value;
    const contentToSave = noteContentTextarea.value;
    const { item: currentNote } = findNote(noteIdToSave);
    if (!currentNote) return true;

    const hasChanged = currentNote.title !== titleToSave || currentNote.content !== contentToSave;
    if (!hasChanged && !state.isDirty) {
        return true;
    }

    await saveLock;

    let releaseLock;
    let wasSuccessful = false;
    saveLock = new Promise(resolve => {
        releaseLock = resolve;
    });

    try {
        const success = await _performSave(noteIdToSave, titleToSave, contentToSave, skipSave);
        if (!success) {
            updateSaveStatus('dirty'); // 실패 시 '변경됨' 상태로 되돌림
            return false; // 저장 실패 전파
        }
        
        if (state.activeNoteId === noteIdToSave) {
            const hasChangedAgain = noteTitleInput.value !== titleToSave || noteContentTextarea.value !== contentToSave;
            if (!hasChangedAgain) {
                setState({ isDirty: false });
                updateSaveStatus('saved');
            }
        }
        wasSuccessful = true;
    } catch (e) {
        console.error("Save failed:", e);
        wasSuccessful = false;
    } finally {
        releaseLock();
    }
    return wasSuccessful;
}