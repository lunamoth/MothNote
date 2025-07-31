import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes
} from './components.js';
import { handleNoteUpdate } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';

const finishPendingRename = async () => {
    if (state.renamingItemId) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur();
        }
    }
};

let searchDebounceTimer;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// 저장되지 않은 변경이 있을 경우 사용자에게 확인을 요청하는 함수
export const confirmNavigation = async () => {
    if (!state.isDirty) return true;

    const ok = await showConfirm({
        title: CONSTANTS.MODAL_TITLES.UNSAVED_CHANGES,
        message: '현재 노트에 저장되지 않은 변경사항이 있습니다. 저장하고 이동할까요?',
        confirmText: '저장하고 이동',
        cancelText: '취소'
    });

    if (ok) {
        await handleNoteUpdate(true); // 강제 저장
        setState({ isDirty: false });
        return true;
    }
    return false;
};

export const changeActiveNote = async (newNoteId) => {
    // `itemActions.js`의 `withNote` 등에서 `finishPendingRename`이 호출되므로 중복 호출 제거 가능
    // await finishPendingRename(); // 이 파일에서는 itemActions의 함수를 직접 호출하지 않습니다.

    if (state.activeNoteId === newNoteId) return;

    if (!(await confirmNavigation())) return;

    // [수정] 활성 폴더가 가상 폴더일 때도 마지막 활성 노트를 기억하도록 조건 단순화
    if (newNoteId && state.activeFolderId) {
        state.lastActiveNotePerFolder[state.activeFolderId] = newNoteId;
    }
    
    setState({ activeNoteId: newNoteId });
    saveSession();
};

// [핵심 수정] 함수가 options 객체를 인자로 받도록 수정
export const changeActiveFolder = async (newFolderId, options = {}) => {
    // `itemActions.js`의 `withNote` 등에서 `finishPendingRename`이 호출되므로 중복 호출 제거 가능
    // await finishPendingRename();

    // [버그 수정] 날짜 필터가 있는 상태에서 다른 폴더를 클릭해도 정상적으로 전환되도록 조건 수정
    if (state.activeFolderId === newFolderId && !state.dateFilter) return;

    // [핵심 수정] options.force가 true가 아닐 경우에만 저장 확인 창을 띄웁니다.
    // 이렇게 하면 handleAddFolder에서 이 확인 과정을 건너뛸 수 있습니다.
    if (!options.force && !(await confirmNavigation())) return;
    
    const { item: folder } = findFolder(newFolderId);
    const notesInFolder = folder?.notes ?? [];
    
    let nextActiveNoteId = null;
    const lastActiveNoteId = state.lastActiveNotePerFolder[newFolderId];

    // [수정] 폴더 종류와 상관없이 lastActiveNoteId를 먼저 확인
    if (lastActiveNoteId && notesInFolder.some(n => n.id === lastActiveNoteId)) {
        nextActiveNoteId = lastActiveNoteId;
    } 
    else if (notesInFolder.length > 0) {
        // [수정] 정렬이 불가능한 가상 폴더(최근, 즐겨찾기, 휴지통)를 고려
        const isSortable = folder?.isSortable !== false;
        const notesToSelectFrom = isSortable
            ? sortNotes(notesInFolder, state.noteSortOrder)
            : notesInFolder;
        nextActiveNoteId = notesToSelectFrom[0]?.id ?? null;
    }

    setState({
        activeFolderId: newFolderId,
        activeNoteId: nextActiveNoteId,
        // [핵심 버그 수정] 다른 폴더를 클릭하면 항상 날짜 필터를 해제합니다.
        dateFilter: null,
        // [BUGFIX #2-1] 폴더 변경 시, 이전 검색 상태를 완전히 초기화
        preSearchActiveNoteId: null 
    });
    saveSession();
};

// [리팩토링] 현재 뷰의 노트 목록을 가져오는 헬퍼 함수
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

// [리팩토링] 검색 및 초기화 로직을 단일 함수로 통합하여 일관성 보장
const handleSearch = (searchTerm) => {
    const previousSearchTerm = state.searchTerm;
    const newState = { searchTerm };
    
    // 검색 시작 시 이전 활성 노트 저장
    if (searchTerm && !previousSearchTerm) {
        newState.preSearchActiveNoteId = state.activeNoteId;
    }
    
    let nextActiveNoteId = null;

    if (searchTerm) {
        // --- 검색 로직 ---
        const sourceNotes = getCurrentViewNotes();
        
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (n.content ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        );
        const sortedNotes = sortNotes(filteredNotes, state.noteSortOrder);
        
        if (sortedNotes.length > 0) {
            nextActiveNoteId = sortedNotes[0].id;
        } else {
            nextActiveNoteId = null; // 검색 결과 없으면 활성 노트 없음
        }

    } else {
        // --- 초기화 로직 ---
        clearSortedNotesCache();
        const notesInCurrentView = getCurrentViewNotes();

        // --- [버그 수정] 날짜 필터가 활성화된 경우, 해당 뷰의 첫 번째 노트를 우선적으로 활성화 ---
        if (state.dateFilter) {
            if (notesInCurrentView.length > 0) {
                nextActiveNoteId = sortNotes(notesInCurrentView, state.noteSortOrder)[0]?.id ?? null;
            }
        } 
        // --- 날짜 필터가 없는 기존 로직 ---
        else {
            if (state.preSearchActiveNoteId && notesInCurrentView.some(n => n.id === state.preSearchActiveNoteId)) {
                nextActiveNoteId = state.preSearchActiveNoteId;
            } else {
                const lastActiveNoteId = state.lastActiveNotePerFolder[state.activeFolderId];
                if (lastActiveNoteId && notesInCurrentView.some(n => n.id === lastActiveNoteId)) {
                    nextActiveNoteId = lastActiveNoteId;
                }
            }
            if (nextActiveNoteId === null && notesInCurrentView.length > 0) {
                nextActiveNoteId = sortNotes(notesInCurrentView, state.noteSortOrder)[0]?.id ?? null;
            }
        }
        newState.preSearchActiveNoteId = null; // 상태 초기화
    }

    newState.activeNoteId = nextActiveNoteId;
    setState(newState);
};

// `input` 이벤트에 대한 핸들러 (디바운싱 적용)
export const handleSearchInput = async (e) => {
    // `itemActions.js`의 액션 함수들이 `finishPendingRename`을 호출하므로,
    // 여기서 직접 호출하지 않아도 안정성이 보장됩니다.
    const term = e.target.value;
    debounce(() => handleSearch(term), CONSTANTS.DEBOUNCE_DELAY.SEARCH);
};

// 'X' 버튼 클릭에 대한 핸들러 (즉시 실행)
export const handleClearSearch = () => {
    clearTimeout(searchDebounceTimer); // 예약된 검색 취소
    searchInput.value = '';
    handleSearch(''); // 초기화 로직 즉시 실행
    searchInput.focus();
};

export const handleSortChange = (e) => {
    setState({ noteSortOrder: e.target.value });
    saveSession();
};