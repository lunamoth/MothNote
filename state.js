import { saveSession } from './storage.js';

export const CONSTANTS = {
    ITEM_TYPE: { FOLDER: 'folder', NOTE: 'note' },
    MODAL_TYPE: { PROMPT: 'prompt', CONFIRM: 'confirm', ALERT: 'alert' },
    TOAST_TYPE: { SUCCESS: 'success', ERROR: 'error' },
    LS_KEY: 'newTabNoteLastSession_v11.0',
    // --- [추가] 설정 관련 상수 ---
    LS_KEY_SETTINGS: 'newTabNoteSettings_v2',
    DEFAULT_SETTINGS: {
        // [수정] 컬럼 너비 기본값을 10%로 변경
        layout: { col1: 10, col2: 10 }, // percentages
        editor: { fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif`, fontSize: 17 },
        weather: { lat: 37.5665, lon: 126.9780 } // Default: Seoul
    },
    // --- 끝 ---
    VIRTUAL_FOLDERS: {
        ALL:    { id: 'all-notes-virtual-id', name: '모든 노트', displayName: '📚 모든 노트', icon: '📚', canAddNote: false, getNotes: (state) => Array.from(state.noteMap.values()).map(entry => entry.note) },
        RECENT: { id: 'recent-notes-virtual-id', name: '최근 노트', displayName: '🕒 최근 노트', icon: '🕒', canAddNote: false, isSortable: false, getNotes: (state) => state.folders.flatMap(f => f.notes).sort((a,b) => b.updatedAt - a.updatedAt).slice(0, CONSTANTS.RECENT_NOTES_COUNT) },
        FAVORITES: { id: 'favorites-virtual-id', name: '즐겨찾기', displayName: '⭐ 즐겨찾기', icon: '⭐', canAddNote: false, isSortable: false, getNotes: (state) => Array.from(state.noteMap.values()).map(entry => entry.note).filter(note => state.favorites.has(note.id)) },
        TRASH:  { id: 'trash-virtual-id', name: '휴지통', displayName: '🗑️ 휴지통', icon: '🗑️', canAddNote: false, isSortable: false, getNotes: (state) => state.trash }
    },
    CLASSES: {
        DRAGGING: 'dragging',
        DROP_TARGET: 'drop-target',
        PINNED: 'pinned',
        ACTIVE: 'active',
        READONLY: 'readonly'
    },
    MODAL_TITLES: {
        NEW_FOLDER: '📁 새 폴더 만들기',
        PERM_DELETE: '💥 영구 삭제',
        EMPTY_TRASH: '🗑️ 휴지통 비우기',
        IMPORT_DATA: '⚠️ 데이터 가져오기',
        SHORTCUT_GUIDE: '⌨️ 단축키 안내',
        UNSAVED_CHANGES: '📝 저장되지 않은 변경사항',
        WEATHER_LOCATION: '🌦️ 날씨 지역 설정'
    },
    ID_PREFIX: {
        FOLDER: 'folder-',
        NOTE: 'note-'
    },
    DEBOUNCE_DELAY: {
        KEY_NAV: 200,
        SEARCH: 300,
        SAVE: 700
    },
    DASHBOARD: {
        WEATHER_CACHE_KEY: 'weather_cache_v1',
        LS_KEY_WEATHER: 'newTabNoteWeatherLocation_v1', // 이제 사용되지 않지만 호환성을 위해 유지
        DOM_IDS: {
            digitalClock: 'digital-clock',
            analogClockCanvas: 'analog-clock',
            weatherContainer: 'weather-container',
            calendarGrid: 'calendar-grid',
            calendarMonthYear: 'calendar-month-year',
            prevMonthBtn: 'prev-month-btn',
            nextMonthBtn: 'next-month-btn',
        },
        WMO_MAP: {
            0: { icon: "☀️", text: "맑음" }, 1: { icon: "🌤️", text: "대체로 맑음" }, 2: { icon: "🌥️", text: "구름 조금" }, 3: { icon: "☁️", text: "흐림" }, 45: { icon: "🌫️", text: "안개" }, 48: { icon: "🌫️", text: "짙은 안개" }, 51: { icon: "🌦️", text: "가랑비" }, 53: { icon: "🌦️", text: "가랑비" }, 55: { icon: "🌦️", text: "강한 가랑비" }, 56: { icon: "🥶💧", text: "어는 가랑비" }, 57: { icon: "🥶💧", text: "강한 어는 가랑비" }, 61: { icon: "🌧️", text: "비" }, 63: { icon: "🌧️", text: "비" }, 65: { icon: "🌧️", text: "강한 비" }, 66: { icon: "🥶🌧️", text: "어는 비" }, 67: { icon: "🥶🌧️", text: "강한 어는 비" }, 71: { icon: "❄️", text: "눈" }, 73: { icon: "❄️", text: "눈" }, 75: { icon: "❄️", text: "강한 눈" }, 77: { icon: "🌨️", text: "싸락눈" }, 80: { icon: "🌧️", text: "소나기" }, 81: { icon: "🌧️", text: "소나기" }, 82: { icon: "⛈️", text: "강한 소나기" }, 85: { icon: "🌨️", text: "소낙눈" }, 86: { icon: "🌨️", text: "강한 소낙눈" }, 95: { icon: "⛈️", text: "뇌우" }, 96: { icon: "⛈️🧊", text: "뇌우 (우박 동반)" }, 99: { icon: "⛈️🧊", text: "강한 뇌우 (우박 동반)" },
        }
    },
    AUTO_TITLE_LENGTH: 100,
    RECENT_NOTES_COUNT: 10,
    TOAST_DURATION: 4000,
    // [개선] 메시지를 용도에 따라 그룹화
    MESSAGES: {
        SUCCESS: {
            NOTE_PINNED: '📍 노트를 고정했습니다.',
            NOTE_UNPINNED: '📌 노트 고정을 해제했습니다.',
            NOTE_FAVORITED: '⭐ 노트를 즐겨찾기에 추가했습니다.',
            NOTE_UNFAVORITED: '⚝ 즐겨찾기에서 노트를 제거했습니다.',
            FOLDER_MOVED_TO_TRASH: name => `🗑️ '${name}' 폴더를 휴지통으로 이동했습니다.`,
            NOTE_MOVED_TO_TRASH: name => `🗑️ '${name}' 노트를 휴지통으로 이동했습니다.`,
            ITEM_RESTORED_FOLDER: name => `♻️ 📁 '${name}' 폴더와 노트를 복원했습니다.`,
            ITEM_RESTORED_NOTE: name => `♻️ 📝 '${name}' 노트를 복원했습니다.`,
            PERM_DELETE_FOLDER_SUCCESS: '💥 폴더와 포함된 노트를 영구적으로 삭제했습니다.',
            PERM_DELETE_ITEM_SUCCESS: '💥 항목을 영구적으로 삭제했습니다.',
            EMPTY_TRASH_SUCCESS: '🗑️ 휴지통을 비웠습니다.',
            NOTE_MOVED_SUCCESS: (noteTitle, folderName) => `✅ '${noteTitle}' 노트를 '${folderName}' 폴더로 이동했습니다.`,
            EXPORT_SUCCESS: '💾✅ 데이터 내보내기 성공!',
            IMPORT_SUCCESS: '↩️✅ 데이터를 성공적으로 가져왔습니다!',
            SETTINGS_SAVED: '⚙️ 설정이 저장되었습니다.',
            SETTINGS_RESET: '⚙️ 설정이 기본값으로 복원되었습니다.',
            IMPORT_RELOAD: '데이터와 설정을 성공적으로 가져왔습니다! 앱을 다시 시작합니다.'
        },
        ERROR: {
            FOLDER_EXISTS: name => `🤔 '${name}' 폴더는 이미 존재해요.`,
            ADD_NOTE_PROMPT: '💡 노트를 추가하려면 먼저 실제 폴더를 선택해주세요.',
            RESTORE_FAILED_NO_FOLDER: '🤔 원본 폴더를 찾을 수 없습니다. 먼저 폴더를 복원해주세요.',
            EMPTY_NAME_ERROR: '🤔 이름은 비워둘 수 없어요.',
            DUPLICATE_NAME_ERROR: name => `🤔 '${name}' 이름이 이미 존재합니다.`,
            EXPORT_FAILURE: '💾❌ 데이터 내보내기 실패.',
            IMPORT_FAILURE: err => `↩️❌ 가져오기 실패: ${err.message}`,
            IMPORT_SIZE_EXCEEDED: '↩️❌ 파일 크기가 5MB를 초과할 수 없습니다.',
            INVALID_FONT_NAME: '유효하지 않은 글꼴 이름입니다. 기본값으로 복원됩니다.'
        },
        CONFIRM: {
            PERM_DELETE: name => `💥 '${name}' 항목을 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없어요! 😱`,
            EMPTY_TRASH: count => `🗑️ 휴지통에 있는 모든 항목(${count}개)을 영구적으로 삭제할까요?`,
            IMPORT_DATA: '⚠️ 데이터를 가져오면 현재 모든 데이터가 교체됩니다. 계속하시겠습니까?',
        }
    }
};

export let state = {
    folders: [],
    trash: [],
    favorites: new Set(),
    activeFolderId: null,
    activeNoteId: null,
    searchTerm: '',
    noteSortOrder: 'updatedAt_desc',
    noteMap: new Map(),
    isDirty: false,
    totalNoteCount: 0,
    renamingItemId: null,
    lastActiveNotePerFolder: {},
    preSearchActiveNoteId: null,
    _virtualFolderCache: { all: null, recent: null, favorites: null, trash: null },
    noteCreationDates: new Set(),
    dateFilter: null
};

const subscribers = new Set();
export const subscribe = (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
};
const notify = () => subscribers.forEach(callback => callback());

// [롤백] 원래의 안전한 방식으로 복귀
export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
    for (const folder of state.folders) {
        for (const note of folder.notes) {
            const noteDate = new Date(note.createdAt);
            const y = noteDate.getFullYear();
            const m = String(noteDate.getMonth() + 1).padStart(2, '0');
            const d = String(noteDate.getDate()).padStart(2, '0');
            state.noteCreationDates.add(`${y}-${m}-${d}`);
        }
    }
};

export const buildNoteMap = () => {
    state._virtualFolderCache.all = null;
    state._virtualFolderCache.recent = null;
    state._virtualFolderCache.favorites = null;
    state._virtualFolderCache.trash = null;

    state.noteMap.clear();
    for (const folder of state.folders) {
        for (const note of folder.notes) {
            state.noteMap.set(note.id, { note, folderId: folder.id });
        }
    }
    // [롤백] 맵 빌드 후, 날짜 Set도 업데이트
    updateNoteCreationDates();
};

export const setState = (newState) => {
    Object.assign(state, newState);
    notify();
};

const _findNoteInState = (id) => {
    const entry = state.noteMap.get(id);
    if (!entry) return { item: null, folder: null, index: -1 };
    
    const { item: folder } = _findFolderInState(entry.folderId);
    if (!folder) return { item: null, folder: null, index: -1 };
    
    const index = folder.notes.findIndex(n => n.id === id);
    return { item: entry.note, folder, index };
};

const _findFolderInState = (id) => {
    const index = state.folders.findIndex(f => f.id === id);
    return { item: state.folders[index], index };
};

const _findInTrash = (id) => {
    const index = state.trash.findIndex(item => item.id === id);
    return { item: state.trash[index], index };
};

const _findInVirtualFolders = (id) => {
    const virtualFolderDef = Object.values(CONSTANTS.VIRTUAL_FOLDERS).find(vf => vf.id === id);
    if (!virtualFolderDef) return null;

    let notes;
    const cacheKey = virtualFolderDef.id === CONSTANTS.VIRTUAL_FOLDERS.ALL.id ? 'all' : 
                     virtualFolderDef.id === CONSTANTS.VIRTUAL_FOLDERS.RECENT.id ? 'recent' :
                     virtualFolderDef.id === CONSTANTS.VIRTUAL_FOLDERS.FAVORITES.id ? 'favorites' :
                     virtualFolderDef.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id ? 'trash' : null;

    if (cacheKey && state._virtualFolderCache[cacheKey]) {
        notes = state._virtualFolderCache[cacheKey];
    } else {
        notes = virtualFolderDef.getNotes(state);
        if (cacheKey) state._virtualFolderCache[cacheKey] = notes;
    }
    
    return { 
        item: { ...virtualFolderDef, name: virtualFolderDef.displayName, notes, isVirtual: true }, 
        index: -1 
    };
}

const findItem = (id, type) => {
    if (!id) return { item: null, index: -1, folder: null, isInTrash: false };

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        const virtualResult = _findInVirtualFolders(id);
        if (virtualResult) return virtualResult;
    }

    const { item: trashedItem, index: trashIndex } = _findInTrash(id);
    if (trashedItem) {
        return { item: trashedItem, index: trashIndex, folder: null, isInTrash: true };
    }

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        const { item, index } = _findFolderInState(id);
        return { item, index, folder: null, isInTrash: false };
    }

    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        const { item, folder, index } = _findNoteInState(id);
        return { item, index, folder, isInTrash: false };
    }

    return { item: null, index: -1, folder: null, isInTrash: false };
};

export const findFolder = (id) => findItem(id, CONSTANTS.ITEM_TYPE.FOLDER);
export const findNote = (id) => findItem(id, CONSTANTS.ITEM_TYPE.NOTE);