import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast, noteTitleInput, noteContentTextarea
} from './components.js';
// [아키텍처 수정] handleNoteUpdate는 이제 forceData 인자 없이 호출됩니다.
import { handleNoteUpdate, finishPendingRename } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// [아키텍처 수정] 저장되지 않은 노트 전환 시 데이터 손실 버그 수정
export const confirmNavigation = async () => {
    if (!state.isDirty) return true;

    const ok = await showConfirm({
        title: CONSTANTS.MODAL_TITLES.UNSAVED_CHANGES,
        message: '현재 노트에 저장되지 않은 변경사항이 있습니다. 저장하고 이동할까요?',
        confirmText: '💾 저장하고 이동',
        cancelText: '❌ 취소'
    });

    if (ok) {
        // [아키텍처 수정] 이제 handleNoteUpdate는 state.pendingChanges를 신뢰하므로,
        // UI 값을 캡처해서 넘겨줄 필요가 없습니다.
        const savedSuccessfully = await handleNoteUpdate(true);
        if (savedSuccessfully) {
            return true; // 저장 성공 시에만 이동 허용
        } else {
            // 저장 실패 시 사용자에게 알리고 이동을 취소
            showToast('저장에 실패하여 이동이 취소되었습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return false;
        }
    }
    return false; // 사용자가 '취소'를 누른 경우
};

export const changeActiveNote = async (newNoteId) => {
    await finishPendingRename();

    if (state.activeNoteId === newNoteId) return;

    if (!(await confirmNavigation())) return;

    if (newNoteId && state.activeFolderId) {
        state.lastActiveNotePerFolder[state.activeFolderId] = newNoteId;
    }
    
    setState({ activeNoteId: newNoteId });
    saveSession();
};

export const changeActiveFolder = async (newFolderId, options = {}) => {
    await finishPendingRename();

    if (state.activeFolderId === newFolderId && !state.dateFilter) return;

    if (!options.force && !(await confirmNavigation())) return;
    
    const { item: folder } = findFolder(newFolderId);
    const notesInFolder = folder?.notes ?? [];
    
    let nextActiveNoteId = null;
    const lastActiveNoteId = state.lastActiveNotePerFolder[newFolderId];

    if (lastActiveNoteId && notesInFolder.some(n => n.id === lastActiveNoteId)) {
        nextActiveNoteId = lastActiveNoteId;
    } 
    else if (notesInFolder.length > 0) {
        const isSortable = folder?.isSortable !== false;
        const notesToSelectFrom = isSortable
            ? sortNotes(notesInFolder, state.noteSortOrder)
            : notesInFolder;
        nextActiveNoteId = notesToSelectFrom[0]?.id ?? null;
    }

    setState({
        activeFolderId: newFolderId,
        activeNoteId: nextActiveNoteId,
        dateFilter: null,
        preSearchActiveNoteId: null 
    });
    saveSession();
};

const getCurrentViewNotes = () => {
    if (state.dateFilter) {
        const filterDateStr = new Date(state.dateFilter).toISOString().split('T')[0];
        return Array.from(state.noteMap.values())
            .map(e => e.note)
            .filter(note => new Date(note.createdAt).toISOString().split('T')[0] === filterDateStr);
    }
    const { item: currentFolder } = findFolder(state.activeFolderId);
    return currentFolder?.notes ?? [];
};

const handleSearch = (searchTerm) => {
    const previousSearchTerm = state.searchTerm;
    const newState = { searchTerm };
    
    if (searchTerm && !previousSearchTerm) {
        newState.preSearchActiveNoteId = state.activeNoteId;
    }
    
    let nextActiveNoteId = null;

    if (searchTerm) {
        const sourceNotes = getCurrentViewNotes();
        
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (n.content ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        );
        const sortedNotes = sortNotes(filteredNotes, state.noteSortOrder);
        
        if (sortedNotes.length > 0) {
            nextActiveNoteId = sortedNotes[0].id;
        } else {
            nextActiveNoteId = null;
        }

    } else {
        clearSortedNotesCache();
        const notesInCurrentView = getCurrentViewNotes();

        if (state.preSearchActiveNoteId && notesInCurrentView.some(n => n.id === state.preSearchActiveNoteId)) {
            nextActiveNoteId = state.preSearchActiveNoteId;
        } 
        else {
            if (!state.dateFilter) {
                const lastActiveNoteId = state.lastActiveNotePerFolder[state.activeFolderId];
                if (lastActiveNoteId && notesInCurrentView.some(n => n.id === lastActiveNoteId)) {
                    nextActiveNoteId = lastActiveNoteId;
                }
            }
        }
        
        if (nextActiveNoteId === null && notesInCurrentView.length > 0) {
            nextActiveNoteId = sortNotes(notesInCurrentView, state.noteSortOrder)[0]?.id ?? null;
        }

        newState.preSearchActiveNoteId = null;
    }

    newState.activeNoteId = nextActiveNoteId;
    setState(newState);
};

export const handleSearchInput = async (e) => {
    await finishPendingRename();
    const term = e.target.value;
    debounce(() => handleSearch(term), CONSTANTS.DEBOUNCE_DELAY.SEARCH);
};

export const handleClearSearch = () => {
    clearTimeout(searchDebounceTimer);
    searchInput.value = '';
    handleSearch('');
    searchInput.focus();
};

export const handleSortChange = (e) => {
    setState({ noteSortOrder: e.target.value });
    saveSession();
};