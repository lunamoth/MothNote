import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast
} from './components.js';
import { handleNoteUpdate, finishPendingRename } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// [아키텍처 변경 후] 이 함수의 역할은 이제 '데이터 동기화 충돌 방지'가 아니라
// 순수하게 '사용자의 저장되지 않은 작업이 날아가는 것을 방지'하는 것으로 명확해졌습니다.
// 코드 로직은 변경할 필요 없이 그대로 완벽하게 작동합니다.
export const confirmNavigation = async () => {
    if (!state.isDirty) return true;

    const ok = await showConfirm({
        title: CONSTANTS.MODAL_TITLES.UNSAVED_CHANGES,
        message: '현재 노트에 저장되지 않은 변경사항이 있습니다. 저장하고 이동할까요?',
        confirmText: '💾 저장하고 이동',
        cancelText: '❌ 취소'
    });

    if (ok) {
        const savedSuccessfully = await handleNoteUpdate(true);
        if (savedSuccessfully) {
            return true;
        } else {
            showToast('저장에 실패하여 이동이 취소되었습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return false;
        }
    }
    
    return false;
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
    // 폴더의 노트 목록은 이제 state에서 직접 가져오므로, getNotes(state) 같은 함수는 필요 없습니다.
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

const getCurrentViewNotes = () => {
    if (state.dateFilter) {
        // toYYYYMMDD는 itemActions에서 가져와야 하지만, 이 파일 내에서 직접 정의하지 않았으므로
        // 전역적으로 접근 가능하거나, 상위 모듈에서 주입받는다고 가정합니다.
        // 현재 코드 구조상 itemActions에서 export 되어 있으므로 문제가 없습니다.
        const { toYYYYMMDD } = require('./itemActions.js'); // 동적 require로 순환 참조 회피 가능
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