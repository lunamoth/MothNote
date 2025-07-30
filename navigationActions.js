import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes
} from './components.js';
import { handleNoteUpdate } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';

// itemActions.js에서 finishPendingRename을 가져오는 대신, 직접 정의하여 순환 참조를 방지하거나,
// 별도의 유틸리티 파일로 분리하는 것이 이상적입니다.
// 여기서는 itemActions.js에 정의된 것으로 가정하고, 순환 참조를 피하기 위해
// 해당 함수를 직접 여기에 정의하거나, 앱 초기화 시 주입받는 패턴을 사용할 수 있습니다.
// 이 경우에는 itemActions.js의 함수를 사용하지 않고, 각 함수에서 직접 로직을 수행합니다.
const finishPendingRename = async () => {
    if (state.renamingItemId) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur();
            await new Promise(resolve => setTimeout(resolve, 50));
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
    // [수정] 다른 노트를 선택하기 전에 활성 이름 변경을 완료합니다.
    await finishPendingRename();

    if (state.activeNoteId === newNoteId) return;

    if (!(await confirmNavigation())) return;

    // [수정] 활성 폴더가 가상 폴더일 때도 마지막 활성 노트를 기억하도록 조건 단순화
    if (newNoteId && state.activeFolderId) {
        state.lastActiveNotePerFolder[state.activeFolderId] = newNoteId;
    }
    
    setState({ activeNoteId: newNoteId });
    saveSession();
};

export const changeActiveFolder = async (newFolderId) => {
    // [수정] 다른 폴더를 선택하기 전에 활성 이름 변경을 완료합니다.
    await finishPendingRename();

    // [버그 수정] 날짜 필터가 있는 상태에서 다른 폴더를 클릭해도 정상적으로 전환되도록 조건 수정
    if (state.activeFolderId === newFolderId && !state.dateFilter) return;

    if (!(await confirmNavigation())) return;
    
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
        dateFilter: null 
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
        // [리팩토링] 헬퍼 함수를 사용하여 현재 뷰의 노트 가져오기
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
        // [핵심 버그 수정] 캐시를 명시적으로 초기화하여 "검색 결과 없음" 잔상 방지
        clearSortedNotesCache();
        
        // [리팩토링] 헬퍼 함수를 사용하여 현재 뷰의 노트 가져오기
        const notesInCurrentView = getCurrentViewNotes();

        if (state.preSearchActiveNoteId && notesInCurrentView.some(n => n.id === state.preSearchActiveNoteId)) {
            nextActiveNoteId = state.preSearchActiveNoteId;
        } else {
            if (!state.dateFilter) {
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
    // [수정] 검색 시작 시 이름 변경 상태 강제 종료
    await finishPendingRename();
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