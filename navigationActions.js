// navigationActions.js

import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast
} from './components.js';
import { saveCurrentNoteIfChanged, finishPendingRename, toYYYYMMDD } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
let searchRequestVersion = 0;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// [수정] 폴더 전환 중 중복 호출을 막기 위한 잠금 변수
let isChangingFolder = false;
const SEARCH_TERM_MAX_LENGTH = 100; // [버그 수정] 검색어 최대 길이 상수 추가

export const confirmNavigation = async () => {
    if (!state.isDirty) {
        return true;
    }
    return await saveCurrentNoteIfChanged();
};

export const changeActiveNote = async (newNoteId) => {
    // [버그 수정] finishPendingRename의 성공 여부를 확인합니다.
    const renameSuccess = await finishPendingRename();
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 노트 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return false; // 이름 변경 실패 시 작업 중단하고 실패를 반환
    }

    if (state.activeNoteId === newNoteId) return true;

    if (!(await confirmNavigation())) return false;

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
    return true; // 성공적으로 노트를 변경했음을 반환
};

export const changeActiveFolder = async (newFolderId, options = {}) => {
    // [수정] 이미 다른 폴더로 전환하는 작업이 진행 중이라면, 새로운 요청을 무시합니다.
    if (isChangingFolder) return false;
    isChangingFolder = true; // 잠금을 설정하여 중복 실행을 방지합니다.

    try {
        // [버그 수정] finishPendingRename의 성공 여부를 확인합니다.
        const renameSuccess = await finishPendingRename();
        if (!renameSuccess) {
            showToast("이름 변경 저장에 실패하여 폴더 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return false; // 이름 변경 실패 시 작업 중단
        }

        const { item: folder } = findFolder(newFolderId);
        if (!folder) {
            // [MAJOR BUG FIX] 오래된 DOM 이벤트, 손상된 세션, 가져오기 직후 상태 불일치 등으로
            // 존재하지 않는 폴더 ID가 들어오면 잘못된 activeFolderId를 저장하지 않고 안전한 기본 보기로 복귀합니다.
            if (!options.force && !(await confirmNavigation())) return false;
            console.warn('Requested folder does not exist. Falling back to All Notes:', newFolderId);
            setState({
                activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
                activeNoteId: null,
                dateFilter: null,
                preSearchActiveNoteId: null,
                searchTerm: ''
            });
            if (searchInput) searchInput.value = '';
            saveSession();
            showToast('선택한 폴더를 찾을 수 없어 모든 노트 보기로 이동했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return false;
        }

        if (state.activeFolderId === newFolderId && !state.dateFilter) {
            // [MAJOR BUG FIX] 새 폴더 생성 직후 postUpdateState로 이미 활성 폴더가 바뀐 경우에도
            // no-op 반환 전에 세션을 저장해, 즉시 새로고침해도 방금 만든 폴더 선택이 유지되게 합니다.
            saveSession();
            return true;
        }

        if (!options.force && !(await confirmNavigation())) return false;
        
        const notesInFolder = Array.isArray(folder.notes) ? folder.notes : [];
        
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
        return true;
    } finally {
        // [수정] try 블록의 코드가 어떤 경로로 종료되든(성공, return, 에러 발생 등)
        // 항상 잠금을 해제하여 다음 요청을 받을 수 있도록 보장합니다.
        isChangingFolder = false;
    }
};

const getCurrentViewNotes = () => {
    if (state.dateFilter) {
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
    const { item: currentFolder } = findFolder(state.activeFolderId);
    const isSortableView = currentFolder?.isSortable !== false;
    
    if (searchTerm && !previousSearchTerm) {
        newState.preSearchActiveNoteId = state.activeNoteId;
    }
    
    let nextActiveNoteId = null;

    if (searchTerm) {
        const sourceNotes = getCurrentViewNotes();
        const normalizedSearchTerm = searchTerm.toLowerCase();
        
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? n.name ?? '').toLowerCase().includes(normalizedSearchTerm) ||
            (n.content ?? '').toLowerCase().includes(normalizedSearchTerm)
        );
        const notesToSelectFrom = isSortableView ? sortNotes(filteredNotes, state.noteSortOrder) : filteredNotes;
        
        if (notesToSelectFrom.length > 0) {
            nextActiveNoteId = notesToSelectFrom[0].id;
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
            const notesToSelectFrom = isSortableView ? sortNotes(notesInCurrentView, state.noteSortOrder) : notesInCurrentView;
            nextActiveNoteId = notesToSelectFrom[0]?.id ?? null;
        }

        newState.preSearchActiveNoteId = null;
    }

    newState.activeNoteId = nextActiveNoteId;
    setState(newState);
};

const restoreSearchInput = () => {
    if (searchInput) searchInput.value = state.searchTerm;
};

const applySearchSafely = async (term, requestVersion) => {
    // 이전 검색 저장이 진행되는 동안 새 입력이 들어오면 오래된 요청을 폐기합니다.
    if (requestVersion !== searchRequestVersion) return;

    // 검색 결과는 활성 노트를 바꿀 수 있으므로, 편집 중인 노트가 실제로 저장된 뒤에만 적용합니다.
    if (!(await confirmNavigation())) {
        if (requestVersion === searchRequestVersion) restoreSearchInput();
        return;
    }

    if (requestVersion !== searchRequestVersion) return;
    handleSearch(term);
};

export const handleSearchInput = async (e) => {
    const requestVersion = ++searchRequestVersion;
    const input = e?.target || searchInput;
    let term = String(input?.value ?? '');

    // [버그 수정] 검색어 길이 제한
    if (term.length > SEARCH_TERM_MAX_LENGTH) {
        term = term.substring(0, SEARCH_TERM_MAX_LENGTH);
        if (input) input.value = term;
        showToast(`검색어는 최대 ${SEARCH_TERM_MAX_LENGTH}자까지 입력할 수 있습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
    }

    const renameSuccess = await finishPendingRename();
    if (requestVersion !== searchRequestVersion) return;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 검색을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        restoreSearchInput();
        return;
    }

    debounce(() => {
        void applySearchSafely(term, requestVersion);
    }, CONSTANTS.DEBOUNCE_DELAY.SEARCH);
};

export const handleClearSearch = async () => {
    const requestVersion = ++searchRequestVersion;
    clearTimeout(searchDebounceTimer);

    const renameSuccess = await finishPendingRename();
    if (requestVersion !== searchRequestVersion) return;
    if (!renameSuccess) {
        showToast("이름 변경 저장에 실패하여 검색 지우기를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        restoreSearchInput();
        return;
    }

    if (!(await confirmNavigation())) {
        if (requestVersion === searchRequestVersion) restoreSearchInput();
        return;
    }
    if (requestVersion !== searchRequestVersion || !searchInput) return;
    if (searchInput.value === '' && state.searchTerm === '') return;

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