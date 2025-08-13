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
            return;
        }

        const type = renamingElementWrapper.dataset.type;
        const nameSpan = renamingElementWrapper.querySelector('.item-name');

        if (nameSpan) {
            // 핵심 수정: .blur()를 호출하는 대신, _handleRenameEnd 함수를 직접 호출합니다.
            // 이렇게 하면 이벤트 발생 순서에 상관없이 변경 사항이 안정적으로 저장됩니다.
            // 'true'를 전달하여 변경 내용을 저장하도록 지시합니다.
            await _handleRenameEnd(id, type, nameSpan, true);
        } else {
            // span을 찾을 수 없는 예외적인 경우에도 상태를 정리합니다.
            forceResolvePendingRename();
        }
    }
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
            lastSavedTimestamp: state.lastSavedTimestamp
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
        showToast("오류가 발생하여 작업을 완료하지 못했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
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
    const allIds = new Set(state.noteMap.keys());
    state.folders.forEach(f => allIds.add(f.id));
    state.trash.forEach(item => {
        allIds.add(item.id);
        // 휴지통의 폴더 안에 있는 노트 ID까지 재귀적으로 추가
        if (item.type === 'folder' && Array.isArray(item.notes)) {
            item.notes.forEach(note => allIds.add(note.id));
        }
    });

    // --- 수정된 부분 ---
    // 가상 폴더 ID도 충돌 방지를 위해 전체 ID 목록에 포함시킵니다.
    Object.values(CONSTANTS.VIRTUAL_FOLDERS).forEach(vf => allIds.add(vf.id));
    // --- 수정 끝 ---

    return allIds;
};

export const handleAddFolder = async () => {
    await finishPendingRename();
    
    // [BUG-C-CRITICAL 수정] 프롬프트가 끝난 후에 변경사항을 저장하도록 순서 변경
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

    // [CRITICAL BUG FIX] ID 고유성 검사를 시스템 전체 ID로 확장
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
        await finishPendingRename();
        if (!(await confirmNavigation())) return;

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        const currentActiveFolderId = state.activeFolderId;

        if (!currentActiveFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(currentActiveFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        // [CRITICAL BUG FIX] ID 고유성 검사를 시스템 전체 ID로 확장
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
    // [BUG-C-CRITICAL 수정] 여기서 변경사항을 미리 저장하지 않습니다.
    // `withConfirmation` 헬퍼가 모달 확인 후에 저장하도록 처리합니다.
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
    // [버그 수정] 트랜잭션 시작 전에, 현재 UI에 표시된 노트 목록(사용자가 보고 있는 목록)을 캡처합니다.
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
            // [버그 수정] 불필요하고 잘못된 결과를 초래하던 'originalNotesInView' 변수 제거
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
                // [버그 수정] 물리적 폴더 목록 대신, 외부에서 캡처한 'currentNotesInView'(현재 UI 목록)를 사용해 다음 노트를 결정합니다.
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, currentNotesInView);
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

    // [BUG-C-CRITICAL 수정] 모든 모달 상호작용이 끝난 후 변경사항 저장
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

        if (itemToRestoreInTx.type === 'folder') {
            if (folders.some(f => f.name === finalFolderName)) {
                showAlert({ title: '오류', message: `'${finalFolderName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
                return null;
            }
            itemToRestoreInTx.name = finalFolderName;
            
            // [CRITICAL BUG FIX] ID 충돌 검사 대상을 시스템 전체 ID(폴더+노트)로 확장
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
                allExistingIds.add(newId); // 새로 생성된 ID도 즉시 추가하여 트랜잭션 내 충돌 방지

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
                // allExistingIds는 이미 시스템의 모든 ID를 포함하므로, 이 Set만으로 검사
                if (restoredNoteIds.has(note.id) || allExistingIds.has(note.id)) {
                    const oldId = note.id;
                    // [BUG FIX] generateUniqueId에 모든 알려진 ID를 전달하여 충돌 방지
                    const combinedExistingIds = new Set([...allExistingIds, ...restoredNoteIds]);
                    const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, combinedExistingIds);
                    note.id = newId;
                    
                    if (favoritesSet.has(oldId)) {
                        favoritesSet.delete(oldId);
                        favoritesSet.add(newId);
                    }
                    hadIdCollision = true;
                }
                
                restoredNoteIds.add(note.id);
                allExistingIds.add(note.id); // 복원/수정된 노트 ID도 충돌 검사 대상에 즉시 추가
                
                delete note.deletedAt; delete note.type; delete note.originalFolderId; 
            });
            latestData.favorites = Array.from(favoritesSet);

            delete itemToRestoreInTx.deletedAt; delete itemToRestoreInTx.type;
            itemToRestoreInTx.updatedAt = now;
            folders.unshift(itemToRestoreInTx);
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestoreInTx.name),
                postUpdateState: {},
                payload: { hadIdCollision }
            };

        } else if (itemToRestoreInTx.type === 'note') {
            const targetFolderInTx = folders.find(f => f.id === targetFolderId);
            if (!targetFolderInTx) {
                 showAlert({ title: '오류', message: '노트를 복원하려던 폴더가 방금 삭제되었습니다.'});
                 return null;
            }
            
            // [CRITICAL BUG FIX] ID 충돌 검사 대상을 시스템 전체 ID(폴더+노트)로 확장
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
    await finishPendingRename();

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
            
            // [BUG FIX] 영구 삭제 시 폴더에 포함된 노트의 즐겨찾기 상태도 함께 정리합니다.
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
    await finishPendingRename();
    if (state.trash.length === 0) return;

    const message = CONSTANTS.MESSAGES.CONFIRM.EMPTY_TRASH(state.trash.length);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            let postUpdateState = {};

            // [BUG FIX] 삭제될 모든 노트 ID를 수집하여 현재 활성 노트가 포함되는지 확인합니다.
            const noteIdsInTrash = new Set();
            latestData.trash.forEach(item => {
                if (item.type === 'note' || !item.type) {
                    noteIdsInTrash.add(item.id);
                } else if (item.type === 'folder' && Array.isArray(item.notes)) {
                    item.notes.forEach(note => noteIdsInTrash.add(note.id));
                }
            });

            // 현재 '휴지통' 폴더를 보고 있을 경우, '모든 노트'로 전환합니다.
            if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                postUpdateState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                postUpdateState.activeNoteId = null;
            } 
            // 다른 폴더를 보고 있더라도, 활성 노트가 삭제 대상에 포함되면 ID를 초기화합니다.
            else if (state.activeNoteId && noteIdsInTrash.has(state.activeNoteId)) {
                postUpdateState.activeNoteId = null;
            }

            // 이름 변경 중인 아이템이 휴지통에 있다면 상태를 초기화합니다.
            if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                postUpdateState.renamingItemId = null;
            }

            // 휴지통을 비울 때 폴더 내 노트들의 즐겨찾기 상태도 모두 제거합니다.
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
        
        // --- [NEW] 자동 제목 생성 로직 ---
        if (!finalTitle && content) {
            let firstLine = content.split('\n')[0].trim();
            if (firstLine) {
                const hasKorean = /[\uAC00-\uD7AF]/.test(firstLine);
                const limit = hasKorean ? CONSTANTS.AUTO_TITLE_LENGTH_KOR : CONSTANTS.AUTO_TITLE_LENGTH;
                
                if (firstLine.length > limit) {
                    firstLine = firstLine.slice(0, limit) + '...';
                }
                finalTitle = firstLine;
                
                // [BUG FIX] 데이터-UI 비동기화 및 데이터 유실 방지를 위해 UI 직접 조작 코드를 제거했습니다.
                // 저장이 성공적으로 완료된 후, 중앙 상태(state)가 업데이트되고,
                // 이를 구독하는 렌더링 파이프라인이 UI를 안전하게 업데이트합니다.
            }
        }
        // --- [NEW] 로직 끝 ---

        noteToSave.title = finalTitle;
        noteToSave.content = content;
        noteToSave.updatedAt = now;
        if (parentFolder) parentFolder.updatedAt = now;
        
        return { newData: latestData, successMessage: null, postUpdateState: {} };
    });
    
    // --- [CRITICAL BUG FIX START] ---
    // 자동 저장과 사용자 입력 간의 경쟁 상태로 인한 데이터 유실을 방지합니다.
    if (success) {
        // 저장이 성공한 후, state에 저장된 값과 현재 UI(편집기)의 값을 비교합니다.
        const { item: justSavedNote } = findNote(noteId);
        const liveTitle = noteTitleInput.value;
        const liveContent = noteContentTextarea.value;

        const isStillDirty = justSavedNote && (justSavedNote.title !== liveTitle || justSavedNote.content !== liveContent);

        if (isStillDirty) {
            // 저장하는 동안 사용자가 추가로 내용을 입력한 경우입니다.
            // isDirty 상태를 true로 유지하고, 변경 상태를 다시 표시한 후,
            // 새로운 자동 저장을 예약합니다.
            setState({ isDirty: true, dirtyNoteId: noteId });
            updateSaveStatus('dirty'); 
            handleUserInput(); // 새로운 변경사항에 대한 자동 저장 타이머를 다시 시작
        } else {
            // UI와 저장된 상태가 일치하는 경우, '저장 완료'로 처리합니다.
            setState({ isDirty: false, dirtyNoteId: null });
            updateSaveStatus('saved');
        }
        // [버그 수정] 성공적인 저장 작업이 관련 없는 비상 백업을 삭제하는 문제를 해결합니다.
        // 비상 백업 제거는 데이터 로드 시 복원/거부 단계에서만 처리되어야 합니다.
    } else {
        updateSaveStatus('dirty');
    }
    // --- [CRITICAL BUG FIX END] ---

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
const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    // --- 가드(Guard) 추가: 중복 실행 방지 ---
    if (state.renamingItemId !== id || !pendingRenamePromise) {
        return;
    }

    nameSpan.contentEditable = false;
    
    // ★★★ 핵심 버그 수정: Promise 해결 및 관련 상태 초기화를 최우선으로 실행합니다. ★★★
    // 이렇게 하면 어떤 분기문(if, return)을 타더라도 Promise 잠금 상태가 절대 발생하지 않습니다.
    if (resolvePendingRename) {
        resolvePendingRename();
        resolvePendingRename = null;
    }
    pendingRenamePromise = null;

    // 이제 이전에 버그를 유발했던 DOM 연결 해제 케이스를 안전하게 처리할 수 있습니다.
    if (!nameSpan.isConnected) {
        // Promise는 이미 위에서 해결되었으므로, 여기서는 UI 상태만 정리하고 종료합니다.
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

    // 저장하지 않거나(예: Esc 키 누름), 이름이 변경되지 않았다면 상태만 초기화하고 종료합니다.
    if (!shouldSave || newName === originalName) {
        setState({ renamingItemId: null });
        if (nameSpan) nameSpan.textContent = originalName;
        return;
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
        
        // postUpdateState에서 renamingItemId를 null로 설정하여, 이름 변경 상태를 종료합니다.
        return { newData: latestData, successMessage: null, postUpdateState: { renamingItemId: null } };
    });

    if (success) {
        // [버그 수정] 성공적인 이름 변경 작업이 관련 없는 비상 백업을 삭제하는 문제를 해결합니다.
        // 비상 백업 제거는 데이터 로드 시 복원/거부 단계에서만 처리되어야 합니다.
    } else {
        // 실패 시, UI를 원래 이름으로 되돌리고 상태를 초기화합니다.
        setState({ renamingItemId: null });
        if(nameSpan) nameSpan.textContent = originalName;
    }
};

export const startRename = async (liElement, type) => {
    const id = liElement?.dataset.id;
    if (!id || state.renamingItemId || state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) return;
    if (Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;

    if (type === CONSTANTS.ITEM_TYPE.NOTE && state.activeNoteId !== id) {
        await changeActiveNote(id);
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