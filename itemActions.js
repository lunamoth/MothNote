// itemActions.js

// [버그 수정] 순환 참조 해결을 위해 generateUniqueId를 state.js에서 가져오도록 수정합니다.
import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap, generateUniqueId } from './state.js';
// import { generateUniqueId } from './storage.js'; // <- 이 줄을 삭제하고 위와 같이 state.js에서 가져옵니다.
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn,
    formatDate,
    noteContentView
} from './components.js';
// [버그 수정] 현재 UI에 표시된 노트 목록 캐시('sortedNotesCache')를 가져오기 위해 import 구문 수정
import { updateSaveStatus, clearSortedNotesCache, sortedNotesCache } from './renderer.js';
import { changeActiveFolder, changeActiveNote, confirmNavigation } from './navigationActions.js';

let globalSaveLock = Promise.resolve();
let autoSaveTimer = null; // 자동 저장을 위한 타이머

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

// [BUG FIX] 이름 변경 중 다른 작업 실행 시, 변경 사항이 유실되는 'Major' 버그를 수정합니다.
// .blur() 이벤트에 의존하는 대신, 이름 변경 완료 로직을 직접 호출하여 이벤트 경합(Race Condition)을 원천적으로 차단합니다.
export const finishPendingRename = async () => {
    // 현재 이름 변경 작업이 진행 중인지 확인합니다.
    if (state.renamingItemId && pendingRenamePromise) {
        const id = state.renamingItemId;
        // DOM에서 이름 변경 중인 li 요소를 찾습니다.
        const renamingElementWrapper = document.querySelector(`.item-list-entry[data-id="${id}"]`);
        
        if (!renamingElementWrapper) {
            // 만약 요소가 사라졌다면(예: 다른 탭에서의 변경), 강제로 상태를 정리합니다.
            forceResolvePendingRename();
            return true; // 요소가 없으면 더 이상 할 작업이 없으므로 성공으로 간주
        }

        const type = renamingElementWrapper.dataset.type;
        const nameSpan = renamingElementWrapper.querySelector('.item-name');

        if (nameSpan) {
            // 핵심 수정: .blur()를 호출하는 대신, _handleRenameEnd 함수를 직접 호출합니다.
            // 이렇게 하면 이벤트 발생 순서에 상관없이 변경 사항이 안정적으로 저장됩니다.
            // 'true'를 전달하여 변경 내용을 저장하도록 지시하며, _handleRenameEnd의 결과를 직접 반환합니다.
            return await _handleRenameEnd(id, type, nameSpan, true);
        } else {
            // span을 찾을 수 없는 예외적인 경우에도 상태를 정리합니다.
            forceResolvePendingRename();
            return true; // span이 없으면 더 이상 할 작업이 없으므로 성공으로 간주
        }
    }
    return true; // 이름 변경 중이 아니면 항상 성공
};

let calendarRenderer = () => {};
export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};

// [SIMPLIFIED] 탭 간 경쟁을 고려하지 않는 단순화된 데이터 업데이트 함수
export const performTransactionalUpdate = async (updateFn) => {
    // [주석 추가] 아래의 globalSaveLock은 멀티탭 동기화 기능이 아닙니다.
    // 단일 탭 내에서 노트 저장, 폴더 삭제 등 여러 비동기 작업이 동시에 실행될 때
    // 데이터 충돌을 막기 위한 안전장치이므로 단일 탭 환경에서도 유용합니다.
    await globalSaveLock;
    let releaseLocalLock;
    globalSaveLock = new Promise(resolve => { releaseLocalLock = resolve; });

    let resultPayload = null;
    let success = false;
    try {
        setState({ isPerformingOperation: true });
        
        // 현재 메모리 상태를 기반으로 데이터를 수정
        const dataCopy = JSON.parse(JSON.stringify({
            folders: state.folders,
            trash: state.trash,
            favorites: Array.from(state.favorites),
            lastSavedTimestamp: state.lastSavedTimestamp,
            lastActiveNotePerFolder: state.lastActiveNotePerFolder
        }));

        const result = await updateFn(dataCopy);
        
        if (result === null) { 
            releaseLocalLock();
            setState({ isPerformingOperation: false });
            return { success: false, payload: null };
        }

        const { newData, successMessage, postUpdateState, payload } = result;
        resultPayload = payload;
        
        newData.lastSavedTimestamp = Date.now();
        
        // 수정된 데이터를 스토리지에 저장
        await chrome.storage.local.set({ appState: newData });
        
        // 메모리 상태를 최신 데이터로 업데이트
        setState({
            folders: newData.folders,
            trash: newData.trash,
            favorites: new Set(newData.favorites || []),
            lastSavedTimestamp: newData.lastSavedTimestamp,
            lastActiveNotePerFolder: newData.lastActiveNotePerFolder || {},
            totalNoteCount: newData.folders.reduce((sum, f) => sum + f.notes.length, 0)
        });
        buildNoteMap();
        updateNoteCreationDates();
        clearSortedNotesCache();
        if (calendarRenderer) {
            calendarRenderer(true);
        }
        
        if (postUpdateState) setState(postUpdateState);
        if (successMessage) showToast(successMessage, CONSTANTS.TOAST_TYPE.SUCCESS, 6000);
        
        success = true;

    } catch (e) {
        console.error("Transactional update failed:", e);
        // [BUG FIX] 저장 공간 초과 오류를 감지하고 사용자에게 명확한 안내를 제공합니다.
        if (e && e.message && e.message.toLowerCase().includes('quota')) {
            showAlert({
                title: '💾 저장 공간 부족',
                message: '저장 공간(5MB)이 가득 찼습니다. 더 이상 데이터를 저장할 수 없습니다.\n\n불필요한 노트를 휴지통으로 이동한 뒤, 휴지통을 비워 영구적으로 삭제하면 공간을 확보할 수 있습니다.',
                confirmText: '✅ 확인'
            });
        } else {
            showToast("오류가 발생하여 작업을 완료하지 못했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        }
        success = false;
    } finally {
        setState({ isPerformingOperation: false });
        releaseLocalLock();
    }
    return { success, payload: resultPayload };
};

// [BUG-C-CRITICAL 수정] 모달 확인 후에 변경사항을 저장하도록 `withConfirmation` 헬퍼 수정
async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) {
        // 실제 액션을 실행하기 직전에, 모달이 떠있는 동안 발생했을 수 있는
        // 모든 변경사항을 저장 시도합니다.
        if (!(await saveCurrentNoteIfChanged())) {
            showToast("변경사항 저장에 실패하여 작업을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        await action();
    }
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

// [CRITICAL BUG FIX] ID 고유성 검사를 위해 시스템의 모든 ID를 수집하는 헬퍼 함수
const collectAllIds = () => {
    const allIds = new Set();

    // 1. 모든 활성 폴더 및 그 안의 노트를 순회하며 ID를 수집합니다.
    state.folders.forEach(folder => {
        allIds.add(folder.id);
        if (Array.isArray(folder.notes)) {
            folder.notes.forEach(note => allIds.add(note.id));
        }
    });

    // 2. 휴지통의 모든 아이템을 순회하며 ID를 수집합니다.
    // (휴지통의 폴더는 내부에 노트만 포함하므로, 1단계 깊이의 탐색만 필요합니다.)
    state.trash.forEach(item => {
        allIds.add(item.id);
        if (item.type === 'folder' && Array.isArray(item.notes)) {
            item.notes.forEach(note => allIds.add(note.id));
        }
    });
    
    // 3. 시스템에서 사용하는 가상 폴더의 ID도 충돌 방지를 위해 포함시킵니다.
    Object.values(CONSTANTS.VIRTUAL_FOLDERS).forEach(vf => allIds.add(vf.id));

    return allIds;
};

export const handleAddFolder = async () => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 폴더 추가를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    
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

    if (!(await saveCurrentNoteIfChanged())) {
        showToast("변경사항 저장에 실패하여 폴더를 추가하지 않았습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const allIds = collectAllIds();
    const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allIds);
    const trimmedName = name.trim();

    const { success } = await performTransactionalUpdate((latestData) => {
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 이미 존재합니다.`});
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
        if (!(await finishPendingRename())) {
            showToast("이름 변경 저장에 실패하여 노트 추가를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        if (!(await confirmNavigation())) return;

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        const currentActiveFolderId = state.activeFolderId;

        if (!currentActiveFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(currentActiveFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const allIds = collectAllIds();
        const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
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

            const newLastActiveMap = { ...(latestData.lastActiveNotePerFolder || {}), [currentActiveFolderId]: newNoteId };
            latestData.lastActiveNotePerFolder = newLastActiveMap;
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    isDirty: false,
                    dirtyNoteId: null,
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
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 삭제를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    
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
    const currentNotesInView = sortedNotesCache.result || [];

    return performTransactionalUpdate(latestData => {
        const { folders, trash } = latestData;
        let successMessage = '', postUpdateState = {};
        const now = Date.now();

        if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
        
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
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, currentNotesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    });
};

export const handleRestoreItem = async (id) => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 복원을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

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

    if (!(await saveCurrentNoteIfChanged())) {
        showToast("변경사항 저장에 실패하여 복원 작업을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const updateLogic = (latestData) => {
        const { folders, trash } = latestData;
        const itemIndexInTx = trash.findIndex(item => item.id === id);
        if (itemIndexInTx === -1) return null;

        const [itemToRestoreInTx] = trash.splice(itemIndexInTx, 1);
        const now = Date.now();
        let hadIdCollision = false;
        const idUpdateMap = new Map();

        if (itemToRestoreInTx.type === 'folder') {
            if (folders.some(f => f.name === finalFolderName)) {
                showAlert({ title: '오류', message: `'${finalFolderName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
                return null;
            }
            itemToRestoreInTx.name = finalFolderName;
            
            const allExistingIds = new Set();
            folders.forEach(f => {
                allExistingIds.add(f.id);
                f.notes.forEach(n => allExistingIds.add(n.id));
            });
            trash.forEach(item => {
                if (item.id !== id) {
                   allExistingIds.add(item.id);
                   if (item.type === 'folder' && Array.isArray(item.notes)) {
                       item.notes.forEach(note => allExistingIds.add(note.id));
                   }
                }
            });
            
            if (allExistingIds.has(itemToRestoreInTx.id)) {
                const oldId = itemToRestoreInTx.id;
                const newId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allExistingIds);
                itemToRestoreInTx.id = newId;
                allExistingIds.add(newId);
                idUpdateMap.set(oldId, newId);

                const favoritesSet = new Set(latestData.favorites || []);
                if (favoritesSet.has(oldId)) {
                    favoritesSet.delete(oldId);
                    favoritesSet.add(newId);
                }
                hadIdCollision = true;
            }

            const favoritesSet = new Set(latestData.favorites || []);
            const restoredNoteIds = new Set();
            
            itemToRestoreInTx.notes.forEach(note => {
                if (restoredNoteIds.has(note.id) || allExistingIds.has(note.id)) {
                    const oldId = note.id;
                    const combinedExistingIds = new Set([...allExistingIds, ...restoredNoteIds]);
                    const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, combinedExistingIds);
                    note.id = newId;
                    idUpdateMap.set(oldId, newId);
                    
                    if (favoritesSet.has(oldId)) {
                        favoritesSet.delete(oldId);
                        favoritesSet.add(newId);
                    }
                    hadIdCollision = true;
                }
                
                restoredNoteIds.add(note.id);
                allExistingIds.add(note.id);
                
                delete note.deletedAt; delete note.type; delete note.originalFolderId; 
            });
            latestData.favorites = Array.from(favoritesSet);

            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type;
            itemToRestoreInTx.updatedAt = now;
            folders.unshift(itemToRestoreInTx);

        } else if (itemToRestoreInTx.type === 'note') {
            const targetFolderInTx = folders.find(f => f.id === targetFolderId);
            if (!targetFolderInTx) {
                 showAlert({ title: '오류', message: '노트를 복원하려던 폴더가 방금 삭제되었습니다.'});
                 return null;
            }
            
            const allExistingIds = new Set();
            folders.forEach(f => {
                allExistingIds.add(f.id);
                f.notes.forEach(n => allExistingIds.add(n.id));
            });
            trash.forEach(item => {
                if (item.id !== id) {
                   allExistingIds.add(item.id);
                   if (item.type === 'folder' && Array.isArray(item.notes)) {
                       item.notes.forEach(note => allExistingIds.add(note.id));
                   }
                }
            });
            
            if (allExistingIds.has(itemToRestoreInTx.id)) {
                 const oldId = itemToRestoreInTx.id;
                 const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                 itemToRestoreInTx.id = newId;
                 idUpdateMap.set(oldId, newId);
                 
                 const favoritesSet = new Set(latestData.favorites || []);
                 if (favoritesSet.has(oldId)) {
                     favoritesSet.delete(oldId);
                     favoritesSet.add(newId);
                     latestData.favorites = Array.from(favoritesSet);
                 }
                 hadIdCollision = true;
            }

            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type; delete itemToRestoreInTx.originalFolderId;
            itemToRestoreInTx.updatedAt = now;
            targetFolderInTx.notes.unshift(itemToRestoreInTx);
            targetFolderInTx.updatedAt = now;
        }

        if (idUpdateMap.size > 0 && latestData.lastActiveNotePerFolder) {
            const newLastActiveMap = {};
            for (const oldFolderId in latestData.lastActiveNotePerFolder) {
                const newFolderId = idUpdateMap.get(oldFolderId) || oldFolderId;
                const oldNoteId = latestData.lastActiveNotePerFolder[oldFolderId];
                const newNoteId = idUpdateMap.get(oldNoteId) || oldNoteId;
                newLastActiveMap[newFolderId] = newNoteId;
            }
            latestData.lastActiveNotePerFolder = newLastActiveMap;
        }

        if (itemToRestoreInTx.type === 'folder') {
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestoreInTx.name),
                postUpdateState: {},
                payload: { hadIdCollision }
            };
        } else if (itemToRestoreInTx.type === 'note') {
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestoreInTx.title),
                postUpdateState: {},
                payload: { hadIdCollision }
            };
        }

        return null;
    };

    const { success, payload } = await performTransactionalUpdate(updateLogic);

    if (success && payload?.hadIdCollision) {
        showToast("일부 노트 또는 폴더의 ID가 충돌하여 자동으로 수정되었습니다.", CONSTANTS.TOAST_TYPE.SUCCESS, 8000);
    }
};

export const handlePermanentlyDeleteItem = async (id) => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 영구 삭제를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const item = state.trash.find(i => i.id === id);
    if (!item) return;
    
    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '💥 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            const originalTrashItems = [...latestData.trash];
            const itemIndex = originalTrashItems.findIndex(i => i.id === id);
            
            if (itemIndex === -1) return null;
            
            const [deletedItem] = latestData.trash.splice(itemIndex, 1);
            
            let postUpdateState = {};
            if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
            if (state.activeNoteId === id) {
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, originalTrashItems);
            }
            
            const favoritesSet = new Set(latestData.favorites || []);
            const initialSize = favoritesSet.size;

            if (deletedItem.type === 'note' || !deletedItem.type) {
                favoritesSet.delete(id);
            } else if (deletedItem.type === 'folder' && Array.isArray(deletedItem.notes)) {
                deletedItem.notes.forEach(note => {
                    favoritesSet.delete(note.id);
                });
            }

            if (favoritesSet.size < initialSize) {
                latestData.favorites = Array.from(favoritesSet);
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
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 휴지통 비우기를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    if (state.trash.length === 0) return;

    const message = CONSTANTS.MESSAGES.CONFIRM.EMPTY_TRASH(state.trash.length);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 영구적으로 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            let postUpdateState = {};

            const noteIdsInTrash = new Set();
            latestData.trash.forEach(item => {
                if (item.type === 'note' || !item.type) {
                    noteIdsInTrash.add(item.id);
                } else if (item.type === 'folder' && Array.isArray(item.notes)) {
                    item.notes.forEach(note => noteIdsInTrash.add(note.id));
                }
            });

            if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                postUpdateState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            } 
            else if (state.activeNoteId && noteIdsInTrash.has(state.activeNoteId)) {
                postUpdateState.activeNoteId = null;
            }

            if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                postUpdateState.renamingItemId = null;
            }

            const favoritesSet = new Set(latestData.favorites || []);
            latestData.trash.forEach(item => {
                if (item.type === 'note' || !item.type) {
                    favoritesSet.delete(item.id);
                } else if (item.type === 'folder' && Array.isArray(item.notes)) {
                    item.notes.forEach(note => {
                        favoritesSet.delete(note.id);
                    });
                }
            });
            latestData.favorites = Array.from(favoritesSet);

            latestData.trash = [];
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS, postUpdateState };
        })
    );
};

export async function saveCurrentNoteIfChanged() {
    if (!state.isDirty) {
        return true;
    }
    
    const noteId = state.activeNoteId;
    if (!noteId) {
        setState({ isDirty: false, dirtyNoteId: null });
        return true;
    }
    
    updateSaveStatus('saving');

    const { success } = await performTransactionalUpdate(latestData => {
        let noteToSave, parentFolder;
        for (const folder of latestData.folders) {
            const note = folder.notes.find(n => n.id === noteId);
            if (note) { noteToSave = note; parentFolder = folder; break; }
        }

        if (!noteToSave) {
            console.error(`Save failed: Note with ID ${noteId} not found in storage.`);
            showToast("저장 실패: 노트가 다른 곳에서 삭제된 것 같습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return null;
        }

        const now = Date.now();
        let finalTitle = noteTitleInput.value.trim();
        const content = noteContentTextarea.value;
        
        if (!finalTitle && content) {
            let firstLine = content.split('\n')[0].trim();
            if (firstLine) {
                const hasKorean = /[\uAC00-\uD7AF]/.test(firstLine);
                const limit = hasKorean ? CONSTANTS.AUTO_TITLE_LENGTH_KOR : CONSTANTS.AUTO_TITLE_LENGTH;
                
                if (firstLine.length > limit) {
                    firstLine = firstLine.slice(0, limit) + '...';
                }
                finalTitle = firstLine;
            }
        }

        noteToSave.title = finalTitle;
        noteToSave.content = content;
        noteToSave.updatedAt = now;
        if (parentFolder) parentFolder.updatedAt = now;
        
        return { newData: latestData, successMessage: null, postUpdateState: {} };
    });
    
    if (success) {
        const { item: justSavedNote } = findNote(noteId);
        const liveTitle = noteTitleInput.value;
        const liveContent = noteContentTextarea.value;

        const isStillDirty = justSavedNote && (justSavedNote.title !== liveTitle || justSavedNote.content !== liveContent);

        if (isStillDirty) {
            setState({ isDirty: true, dirtyNoteId: noteId });
            updateSaveStatus('dirty'); 
            handleUserInput();
        } else {
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        }
    } else {
        updateSaveStatus('dirty');
    }

    return success;
}

export async function handleUserInput() {
    if (!state.activeNoteId) return;
    
    const { item: activeNote } = findNote(state.activeNoteId);
    if (!activeNote) return;

    const currentTitle = noteTitleInput.value;
    const currentContent = noteContentTextarea.value;
    const hasChanged = activeNote.title !== currentTitle || activeNote.content !== currentContent;
    
    if (hasChanged) {
        if (!state.isDirty) {
            setState({ isDirty: true, dirtyNoteId: state.activeNoteId });
            updateSaveStatus('dirty');
        }
    } else {
        if (state.isDirty) {
            setState({ isDirty: false, dirtyNoteId: null });
            clearTimeout(autoSaveTimer);
            updateSaveStatus('saved');
        }
        return;
    }
    
    clearTimeout(autoSaveTimer);

    autoSaveTimer = setTimeout(() => {
        if (state.isDirty && state.dirtyNoteId === state.activeNoteId) {
            saveCurrentNoteIfChanged();
        }
    }, CONSTANTS.DEBOUNCE_DELAY.SAVE);
}


// [BUG FIX] 안정성 강화를 위해 `_handleRenameEnd` 함수에 진입 가드(guard)를 추가하고, Promise 해결 로직을 최우선으로 배치합니다.
// 이제 트랜잭션의 성공 여부(boolean)를 반환합니다.
const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    // --- 가드(Guard) 추가: 중복 실행 방지 ---
    if (state.renamingItemId !== id || !pendingRenamePromise) {
        return true; // 이미 처리되었거나 대상이 아니면 성공
    }

    nameSpan.contentEditable = false;
    
    // ★★★ 핵심 버그 수정: Promise 해결 및 관련 상태 초기화를 최우선으로 실행합니다. ★★★
    if (resolvePendingRename) {
        resolvePendingRename();
        resolvePendingRename = null;
    }
    pendingRenamePromise = null;

    // 이제 이전에 버그를 유발했던 DOM 연결 해제 케이스를 안전하게 처리할 수 있습니다.
    if (!nameSpan.isConnected) {
        setState({ renamingItemId: null });
        return true;
    }

    const { item: currentItem } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
    if (!currentItem) {
        setState({ renamingItemId: null }); 
        return true;
    }

    const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
    const newName = nameSpan.textContent.trim();

    // 저장하지 않거나(예: Esc 키 누름), 이름이 변경되지 않았다면 상태만 초기화하고 종료합니다.
    if (!shouldSave || newName === originalName) {
        setState({ renamingItemId: null });
        if (nameSpan) nameSpan.textContent = originalName;
        return true; // 저장할 필요 없으면 성공
    }
    
    // 트랜잭션을 통해 실제 데이터 저장을 수행합니다.
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
        // 실패 시, UI를 원래 이름으로 되돌리고 상태를 초기화합니다.
        setState({ renamingItemId: null });
        if(nameSpan) nameSpan.textContent = originalName;
    }
    
    return success; // 트랜잭션의 성공 여부를 반환
};

export const startRename = async (liElement, type) => {
    const id = liElement?.dataset.id;
    if (!id || state.renamingItemId || state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) return;
    if (Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;

    if (type === CONSTANTS.ITEM_TYPE.NOTE && state.activeNoteId !== id) {
        if (!(await changeActiveNote(id))) {
             showToast("노트 전환에 실패하여 이름 변경을 시작할 수 없습니다.", CONSTANTS.TOAST_TYPE.ERROR);
             return;
        }
    }
    
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
                _handleRenameEnd(id, type, nameSpan, false);
            }
        };
        
        nameSpan.addEventListener('blur', onBlur, { once: true });
        nameSpan.addEventListener('keydown', onKeydown);
    }, 0);
};

// [TAB KEY BUG FIX - FINAL ROBUST VERSION]
const handleTextareaKeyDown = (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;

        if (start === end) {
            // Case 1: No selection (single cursor)
            if (e.shiftKey) {
                // Outdent for single cursor
                const lineStart = text.lastIndexOf('\n', start - 1) + 1;
                const line = text.substring(lineStart, start);
                if (line.startsWith('\t')) {
                    textarea.value = text.substring(0, lineStart) + text.substring(lineStart + 1);
                    textarea.selectionStart = textarea.selectionEnd = start - 1;
                } else if (line.startsWith(' ')) {
                    const spaces = line.match(/^ */)[0].length;
                    const removeCount = Math.min(spaces, 4);
                    textarea.value = text.substring(0, lineStart) + text.substring(lineStart + removeCount);
                    textarea.selectionStart = textarea.selectionEnd = start - removeCount;
                }
            } else {
                // Indent for single cursor
                textarea.value = text.substring(0, start) + '\t' + text.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 1;
            }
        } else {
            // Case 2: Text is selected (single or multi-line)
            const firstLineStart = text.lastIndexOf('\n', start - 1) + 1;
            
            let lastLineEnd = text.indexOf('\n', end);
            if (lastLineEnd === -1) lastLineEnd = text.length;
            if (end > firstLineStart && text[end - 1] === '\n') lastLineEnd = end - 1;

            const selectedBlock = text.substring(firstLineStart, lastLineEnd);
            const lines = selectedBlock.split('\n');
            
            let modifiedBlock;
            if (e.shiftKey) { // Outdent
                modifiedBlock = lines.map(line => {
                    if (line.startsWith('\t')) return line.substring(1);
                    if (line.startsWith(' ')) {
                        const spaces = line.match(/^ */)[0].length;
                        return line.substring(Math.min(spaces, 4));
                    }
                    return line;
                }).join('\n');
            } else { // Indent
                modifiedBlock = lines.map(line => line.length > 0 ? '\t' + line : line).join('\n');
            }

            textarea.value = text.substring(0, firstLineStart) + modifiedBlock + text.substring(lastLineEnd);
            
            textarea.selectionStart = firstLineStart;
            textarea.selectionEnd = firstLineStart + modifiedBlock.length;
        }

        handleUserInput();
    }
};

// 이 함수는 app.js에서 호출되어야 하므로 export 합니다.
export { handleTextareaKeyDown };