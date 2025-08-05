// navigationActions.js

import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast
} from './components.js';
// [BUG FIX 1] `toYYYYMMDD` 함수를 정상적으로 import하고, 존재하지 않는 함수 require 호출을 제거합니다.
import { saveCurrentNoteIfChanged, finishPendingRename, toYYYYMMDD } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

/**
 * [REFACTORED] 내비게이션을 시도하기 전에 현재 노트의 변경사항을 저장합니다.
 * 더 이상 사용자에게 확인 프롬프트를 띄우지 않습니다.
 * 대신, 저장을 시도하고 그 결과에 따라 내비게이션을 허용하거나 차단합니다.
 * @returns {Promise<boolean>} 내비게이션이 가능하면 true, 저장 실패 등으로 불가능하면 false.
 */
export const confirmNavigation = async () => {
    // isDirty 플래그가 꺼져 있으면 변경사항이 없으므로 항상 안전합니다.
    if (!state.isDirty) {
        return true;
    }
    // isDirty 플래그가 켜져 있으면, 견고한 저장 함수를 호출합니다.
    // 이 함수는 내부적으로 변경 여부를 다시 확인하고, 저장에 실패하면 false를 반환합니다.
    return await saveCurrentNoteIfChanged();
};

export const changeActiveNote = async (newNoteId) => {
    await finishPendingRename();

    if (state.activeNoteId === newNoteId) return;

    if (!(await confirmNavigation())) return;

    if (newNoteId && state.activeFolderId) {
        setState({
            lastActiveNotePerFolder: {
                ...state.lastActiveNotePerFolder,
                [state.activeFolderId]: newNoteId
            }
        });
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
        preSearchActiveNoteId: null,
        searchTerm: ''
    });
    
    if (searchInput) searchInput.value = '';
    saveSession();
};

// [BUG FIX 1] 검색 기능이 정상 동작하도록 수정합니다.
const getCurrentViewNotes = () => {
    if (state.dateFilter) {
        // [BUG FIX] 'require'를 제거하고 모듈 상단에서 import한 'toYYYYMMDD'를 사용합니다.
        const dateStr = toYYYYMMDD(state.dateFilter);
        return Array.from(state.noteMap.values())
            .map(e => e.note)
            .filter(note => toYYYYMMDD(note.createdAt) === dateStr);
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
    if (searchInput.value === '') return;
    searchInput.value = '';
    handleSearch('');
    searchInput.focus();
};

export const handleSortChange = async (e) => {
    if (!(await confirmNavigation())) {
        e.target.value = state.noteSortOrder;
        return;
    }
    
    setState({ noteSortOrder: e.target.value });
    saveSession();
};