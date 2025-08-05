import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import { saveSession } from './storage.js';
import {
    searchInput, showConfirm, sortNotes, showToast
} from './components.js';
// [아키텍처 수정] itemActions.js의 함수들은 이제 새로운 트랜잭션 아키텍처를 따릅니다.
import { handleNoteUpdate, finishPendingRename } from './itemActions.js';
import { clearSortedNotesCache } from './renderer.js';


let searchDebounceTimer;
const debounce = (fn, delay) => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(fn, delay); };

// [아키텍처 수정] 저장되지 않은 노트 전환 시 데이터 손실 버그 수정
export const confirmNavigation = async () => {
    // 저장되지 않은 변경사항이 없으면 즉시 이동 허용
    if (!state.isDirty) return true;

    // 사용자에게 저장 여부 확인
    const ok = await showConfirm({
        title: CONSTANTS.MODAL_TITLES.UNSAVED_CHANGES,
        message: '현재 노트에 저장되지 않은 변경사항이 있습니다. 저장하고 이동할까요?',
        confirmText: '💾 저장하고 이동',
        cancelText: '❌ 취소'
    });

    if (ok) {
        // '저장하고 이동' 선택 시, 새로운 트랜잭션 방식의 저장 함수 호출
        const savedSuccessfully = await handleNoteUpdate(true);
        if (savedSuccessfully) {
            return true; // 저장 성공 시에만 이동 허용
        } else {
            // 저장 실패 시 (예: QuotaExceededError) 사용자에게 알리고 이동을 취소
            showToast('저장에 실패하여 이동이 취소되었습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return false;
        }
    }
    
    // 사용자가 '취소'를 누른 경우 이동 거부
    return false;
};

export const changeActiveNote = async (newNoteId) => {
    await finishPendingRename();

    if (state.activeNoteId === newNoteId) return;

    // 화면 전환 전 저장되지 않은 변경사항 확인
    if (!(await confirmNavigation())) return;

    if (newNoteId && state.activeFolderId) {
        // 해당 폴더의 마지막 활성 노트 기록 (기능 유지)
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

    // 강제 전환이 아닐 경우, 저장되지 않은 변경사항 확인
    if (!options.force && !(await confirmNavigation())) return;
    
    const { item: folder } = findFolder(newFolderId);
    const notesInFolder = folder?.notes ?? [];
    
    let nextActiveNoteId = null;
    const lastActiveNoteId = state.lastActiveNotePerFolder[newFolderId];

    // 폴더의 마지막 활성 노트가 존재하면 그 노트를 활성화 (기능 유지)
    if (lastActiveNoteId && notesInFolder.some(n => n.id === lastActiveNoteId)) {
        nextActiveNoteId = lastActiveNoteId;
    } 
    // 그렇지 않으면 폴더의 첫 번째 노트를 활성화 (기능 유지)
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
        dateFilter: null, // 폴더 변경 시 날짜 필터는 해제
        preSearchActiveNoteId: null, // 검색 상태 초기화
        searchTerm: '' // 검색어 초기화
    });
    
    if (searchInput) searchInput.value = '';
    saveSession();
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
    
    // 검색 시작 시, 현재 노트 ID를 백업
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
        
        // 검색 결과가 있으면 첫번째 항목을 활성화
        if (sortedNotes.length > 0) {
            nextActiveNoteId = sortedNotes[0].id;
        } else {
            nextActiveNoteId = null;
        }

    } else { // 검색 종료 시
        clearSortedNotesCache();
        const notesInCurrentView = getCurrentViewNotes();

        // 검색 시작 전의 노트가 여전히 보이면 그 노트로 복귀
        if (state.preSearchActiveNoteId && notesInCurrentView.some(n => n.id === state.preSearchActiveNoteId)) {
            nextActiveNoteId = state.preSearchActiveNoteId;
        } 
        else { // 그렇지 않으면 폴더의 마지막 활성 노트로 복귀
            if (!state.dateFilter) {
                const lastActiveNoteId = state.lastActiveNotePerFolder[state.activeFolderId];
                if (lastActiveNoteId && notesInCurrentView.some(n => n.id === lastActiveNoteId)) {
                    nextActiveNoteId = lastActiveNoteId;
                }
            }
        }
        
        // 그래도 활성 노트가 없으면, 현재 뷰의 첫번째 노트 선택
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
    // 정렬 변경 전, 저장되지 않은 변경사항 확인
    if (!(await confirmNavigation())) {
        // 사용자가 취소하면, select 값을 이전 값으로 되돌림
        e.target.value = state.noteSortOrder;
        return;
    }
    
    setState({ noteSortOrder: e.target.value });
    saveSession();
};