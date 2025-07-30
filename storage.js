import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes } from './components.js';

export const saveData = async () => {
    try {
        const dataToSave = { 
            folders: state.folders, 
            trash: state.trash,
            favorites: Array.from(state.favorites) 
        };
        await chrome.storage.local.set({ appState: dataToSave });
    } catch (e) {
        console.error("Error saving state:", e);
    }
};

export const saveSession = () => {
    localStorage.setItem(CONSTANTS.LS_KEY, JSON.stringify({
        f: state.activeFolderId,
        n: state.activeNoteId,
        s: state.noteSortOrder,
        l: state.lastActiveNotePerFolder
    }));
};

export const loadData = async () => {
    try {
        const result = await chrome.storage.local.get('appState');
        let initialState = { ...state };

        if (result.appState && result.appState.folders) {
            initialState = { ...initialState, ...result.appState };
            if (!initialState.trash) {
                initialState.trash = [];
            }
            initialState.favorites = new Set(result.appState.favorites || []);

            let lastSession = null;
            try {
                const sessionData = localStorage.getItem(CONSTANTS.LS_KEY);
                if (sessionData) lastSession = JSON.parse(sessionData);
            } catch (e) {
                console.warn("Could not parse last session from localStorage:", e);
                localStorage.removeItem(CONSTANTS.LS_KEY);
            }

            if (lastSession) {
                initialState.activeFolderId = lastSession.f;
                initialState.activeNoteId = lastSession.n;
                initialState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                initialState.lastActiveNotePerFolder = lastSession.l ?? {};
            }

            initialState.totalNoteCount = initialState.folders.reduce((sum, f) => sum + f.notes.length, 0);

            // 1. 먼저 기본 상태(폴더, 휴지통, 활성 ID)를 설정합니다.
            setState(initialState);
            // 2. [핵심 수정] 설정된 상태를 기반으로 noteMap과 noteCreationDates를 빌드합니다.
            buildNoteMap();

            // 3. 빌드된 state.noteMap을 기준으로 활성 ID의 유효성을 검사합니다.
            const folderExists = state.folders.some(f => f.id === state.activeFolderId);
            const noteExists = state.noteMap.has(state.activeNoteId);

            if (!folderExists && !Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId)) {
                initialState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                initialState.activeNoteId = null;
            }

            if (state.activeFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id && !noteExists) {
                initialState.activeNoteId = null;
                const activeFolder = state.folders.find(f => f.id === state.activeFolderId);
                if (activeFolder && activeFolder.notes.length > 0) {
                    const sortedNotes = sortNotes(activeFolder.notes, state.noteSortOrder);
                    initialState.activeNoteId = sortedNotes[0]?.id ?? null;
                }
            }
            // 4. 유효성 검사 후 변경된 ID가 있다면 다시 상태를 업데이트합니다.
            setState({
                activeFolderId: initialState.activeFolderId,
                activeNoteId: initialState.activeNoteId
            });

        } else {
            // 처음 사용하는 경우 기본 데이터 생성
            const now = Date.now();
            const fId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
            const nId = `${CONSTANTS.ID_PREFIX.NOTE}${now + 1}`;
            const newNote = { id: nId, title: "🎉 환영합니다!", content: "새 탭 노트에 오신 것을 환영합니다! 🚀", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote] };

            initialState = { ...initialState, folders: [newFolder], trash: [], favorites: new Set(), activeFolderId: fId, activeNoteId: nId };
            initialState.totalNoteCount = 1;

            setState(initialState);
            buildNoteMap(); // 기본 데이터 생성 후에도 맵 빌드
            await saveData();
        }

        saveSession();

    } catch (e) { console.error("Error loading data:", e); }
};

const sanitizeContentData = data => {
    if (!data || !Array.isArray(data.folders)) throw new Error("유효하지 않은 파일 구조입니다.");
    const usedIds = new Set();
    const getUniqueId = (prefix, id) => {
        let finalId = String(id ?? `${prefix}-${Date.now()}`).slice(0, 50);
        let counter = 1;
        while (usedIds.has(finalId)) {
            finalId = `${String(id).slice(0, 40)}-${counter++}`;
        }
        usedIds.add(finalId);
        return finalId;
    };

    const sanitizeHtml = str => {
        const tempDiv = document.createElement('div');
        tempDiv.textContent = str;
        return tempDiv.innerHTML;
    };

    const sanitizeNote = (n, isTrash = false) => {
        const note = {
            id: getUniqueId('note', n.id),
            title: sanitizeHtml(String(n.title ?? '제목 없는 노트')).slice(0, 200),
            content: sanitizeHtml(String(n.content ?? '')),
            createdAt: Number(n.createdAt) || Date.now(),
            updatedAt: Number(n.updatedAt) || Date.now(),
            isPinned: !!n.isPinned,
            isFavorite: !!n.isFavorite,
        };
        if (isTrash) {
            note.originalFolderId = n.originalFolderId;
            note.type = 'note';
            note.deletedAt = n.deletedAt || Date.now();
        }
        return note;
    };

    const sanitizedFolders = data.folders.map(f => {
        const folderId = getUniqueId('folder', f.id);
        const notes = Array.isArray(f.notes) ? f.notes.map(n => sanitizeNote(n)) : [];
        return {
            id: folderId,
            name: sanitizeHtml(String(f.name ?? '제목 없는 폴더')).slice(0, 100),
            notes: notes
        };
    });

    const sanitizedTrash = Array.isArray(data.trash) ? data.trash.reduce((acc, item) => {
        if (item.type === 'folder') {
            const folderId = getUniqueId('folder', item.id);
            const folder = {
                id: folderId,
                name: sanitizeHtml(String(item.name ?? '제목 없는 폴더')).slice(0, 100),
                notes: [],
                type: 'folder',
                deletedAt: item.deletedAt || Date.now()
            };
            acc.push(folder);
            if (Array.isArray(item.notes)) {
                const notesInFolder = item.notes.map(n => {
                    const sanitized = sanitizeNote(n, true);
                    sanitized.originalFolderId = folder.id;
                    return sanitized;
                });
                acc.push(...notesInFolder);
            }
        } else if (item.type === 'note') {
            acc.push(sanitizeNote(item, true));
        }
        return acc;
    }, []) : [];

    const sanitizedFavorites = Array.isArray(data.favorites) ? data.favorites.filter(id => typeof id === 'string' && id) : [];

    return {
        folders: sanitizedFolders,
        trash: sanitizedTrash,
        favorites: sanitizedFavorites
    };
};

// [수정] 설정 데이터 유효성 검사 및 정제 함수 export
export const sanitizeSettings = (settingsData) => {
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const sanitized = JSON.parse(JSON.stringify(defaults)); // Deep copy

    if (!settingsData || typeof settingsData !== 'object') {
        return sanitized;
    }

    if (settingsData.layout) {
        sanitized.layout.col1 = parseInt(settingsData.layout.col1, 10) || defaults.layout.col1;
        sanitized.layout.col2 = parseInt(settingsData.layout.col2, 10) || defaults.layout.col2;
    }
    // [추가] 젠 모드 설정 정제
    if (settingsData.zenMode) {
        sanitized.zenMode.maxWidth = parseInt(settingsData.zenMode.maxWidth, 10) || defaults.zenMode.maxWidth;
    }
    if (settingsData.editor) {
        // [개선] 가져오기 시에도 font-family 유효성 검사
        const importedFontFamily = settingsData.editor.fontFamily;
        if (importedFontFamily && typeof CSS.supports === 'function' && CSS.supports('font-family', importedFontFamily)) {
             sanitized.editor.fontFamily = importedFontFamily;
        } else {
             sanitized.editor.fontFamily = defaults.editor.fontFamily;
        }
        sanitized.editor.fontSize = parseInt(settingsData.editor.fontSize, 10) || defaults.editor.fontSize;
    }
    if (settingsData.weather) {
        sanitized.weather.lat = parseFloat(settingsData.weather.lat) || defaults.weather.lat;
        sanitized.weather.lon = parseFloat(settingsData.weather.lon) || defaults.weather.lon;
    }

    return sanitized;
};


export const handleExport = async (settings) => {
    if (state.renamingItemId) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur();
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    try {
        // [수정] 내보낼 데이터에 설정(settings) 객체 포함
        const dataToExport = {
            settings: settings,
            folders: state.folders,
            trash: state.trash,
            favorites: Array.from(state.favorites)
        };
        const dataStr = JSON.stringify(dataToExport, null, 2);
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, dataStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `new-tab-note-backup-${new Date().toISOString().slice(0, 10)}.json`
        }, () => {
            URL.revokeObjectURL(url);
            showToast(CONSTANTS.MESSAGES.SUCCESS.EXPORT_SUCCESS);
        });
    } catch (e) {
        console.error("Export failed:", e);
        showToast(CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
    }
};

export const handleImport = async () => {
    if (state.renamingItemId) {
        const renamingElement = document.querySelector(`[data-id="${state.renamingItemId}"] .item-name`);
        if (renamingElement) {
            renamingElement.blur();
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    importFileInput.click();
};

export const setupImportHandler = () => {
    importFileInput.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_SIZE_EXCEEDED, CONSTANTS.TOAST_TYPE.ERROR);
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async event => {
            try {
                const importedData = JSON.parse(event.target.result);
                // [수정] 노트/폴더 데이터와 설정 데이터를 각각 정제
                const sanitizedContent = sanitizeContentData(importedData);
                const sanitizedSettings = sanitizeSettings(importedData.settings);

                const ok = await showConfirm({ title: CONSTANTS.MODAL_TITLES.IMPORT_DATA, message: CONSTANTS.MESSAGES.CONFIRM.IMPORT_DATA, confirmText: '가져오기' });
                if (ok) {
                    const totalNoteCount = sanitizedContent.folders.reduce((sum, f) => sum + f.notes.length, 0);
                    const rebuiltFavorites = new Set(sanitizedContent.favorites);

                    sanitizedContent.folders.forEach(folder => {
                        folder.notes.forEach(note => {
                            note.isFavorite = rebuiltFavorites.has(note.id);
                        });
                    });

                    const newState = {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: rebuiltFavorites,
                        activeFolderId: sanitizedContent.folders[0]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
                        activeNoteId: sanitizedContent.folders[0]?.notes[0]?.id ?? null,
                        searchTerm: '',
                        noteSortOrder: 'updatedAt_desc',
                        isDirty: false,
                        totalNoteCount: totalNoteCount,
                        lastActiveNotePerFolder: {}
                    };

                    // [수정] 설정(settings)을 localStorage에 저장
                    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                    
                    setState(newState);
                    buildNoteMap();
                    await saveData();
                    saveSession();

                    // [수정] 성공 메시지를 변경하고, 1.5초 후 앱을 새로고침하여 설정을 적용
                    showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD);
                    setTimeout(() => location.reload(), 1500);
                }
            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
};