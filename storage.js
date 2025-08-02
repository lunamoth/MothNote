import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes } from './components.js';
import { handleNoteUpdate } from './itemActions.js';


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
        // [버그 수정] 앱 로딩 시 이름 변경 상태를 항상 초기화
        setState({ renamingItemId: null });

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

            // --- [BUG FIX] ---
            // 1. 먼저 기본 상태(폴더, 휴지통, 활성 ID 등)를 설정합니다.
            setState(initialState);
            // 2. [핵심 수정] 유효성 검사 전에, 설정된 상태를 기반으로 noteMap을 먼저 빌드합니다.
            // 이렇게 해야 다음 단계의 유효성 검사가 정확한 noteMap을 참조할 수 있습니다.
            buildNoteMap();

            // 3. 이제 빌드된 state.noteMap을 기준으로 활성 ID의 유효성을 검사합니다.
            const folderExists = state.folders.some(f => f.id === state.activeFolderId) || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId);
            const noteExists = state.noteMap.has(state.activeNoteId);

            let needsStateUpdate = false;
            let finalActiveFolderId = state.activeFolderId;
            let finalActiveNoteId = state.activeNoteId;

            if (!folderExists) {
                finalActiveFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                finalActiveNoteId = null;
                needsStateUpdate = true;
            }

            // 휴지통에 있는 노트는 noteMap에 없으므로, 휴지통 뷰가 아닐 때만 noteExists를 검사합니다.
            if (finalActiveFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id && !noteExists) {
                finalActiveNoteId = null; // ID가 유효하지 않으면 일단 null로 설정
                
                // 해당 폴더의 마지막 활성 노드를 찾거나, 첫 번째 노드를 활성화합니다.
                const activeFolder = state.folders.find(f => f.id === finalActiveFolderId);
                if (activeFolder && activeFolder.notes.length > 0) {
                    const sortedNotes = sortNotes(activeFolder.notes, state.noteSortOrder);
                    finalActiveNoteId = sortedNotes[0]?.id ?? null;
                }
                needsStateUpdate = true;
            }
            
            // 4. 유효성 검사 후 변경된 ID가 있다면 다시 상태를 업데이트하여 렌더링을 트리거합니다.
            // 이 시점에는 noteMap이 완전히 준비되었으므로 렌더러가 올바르게 동작합니다.
            if (needsStateUpdate) {
                setState({
                    activeFolderId: finalActiveFolderId,
                    activeNoteId: finalActiveNoteId
                });
            }
            // --- [BUG FIX END] ---

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

// [코드 명확성] 함수의 역할을 명확히 하는 이름으로 변경 (sanitizeHtml -> escapeHtml)
const escapeHtml = str => {
    const tempDiv = document.createElement('div');
    tempDiv.textContent = str;
    return tempDiv.innerHTML;
};

const sanitizeContentData = data => {
    if (!data || !Array.isArray(data.folders)) throw new Error("유효하지 않은 파일 구조입니다.");
    const usedIds = new Set();
    const idMap = new Map(); 

    const getUniqueId = (prefix, id) => {
        const oldId = id; 
        let finalId = String(id ?? `${prefix}-${Date.now()}`).slice(0, 50);
        let counter = 1;
        while (usedIds.has(finalId)) {
            finalId = `${String(id).slice(0, 40)}-${counter++}`;
        }
        usedIds.add(finalId);
        if (oldId) {
            idMap.set(oldId, finalId); 
        }
        return finalId;
    };

    const sanitizeNote = (n, isTrash = false) => {
        const noteId = getUniqueId('note', n.id);
        const note = {
            id: noteId,
            title: escapeHtml(String(n.title ?? '제목 없는 노트')).slice(0, 200),
            content: escapeHtml(String(n.content ?? '')),
            createdAt: Number(n.createdAt) || Date.now(),
            updatedAt: Number(n.updatedAt) || Date.now(),
            isPinned: !!n.isPinned,
            isFavorite: !!n.isFavorite, 
        };
        if (isTrash) {
            note.originalFolderId = idMap.get(n.originalFolderId) || n.originalFolderId;
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
            name: escapeHtml(String(f.name ?? '제목 없는 폴더')).slice(0, 100),
            notes: notes
        };
    });

    const sanitizedTrash = Array.isArray(data.trash) ? data.trash.reduce((acc, item) => {
        if (item.type === 'folder') {
            const folderId = getUniqueId('folder', item.id);
            const folder = {
                id: folderId,
                name: escapeHtml(String(item.name ?? '제목 없는 폴더')).slice(0, 100),
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
    
    const sanitizedFavorites = Array.isArray(data.favorites) 
        ? data.favorites.map(oldId => idMap.get(oldId)).filter(Boolean)
        : [];

    return {
        folders: sanitizedFolders,
        trash: sanitizedTrash,
        favorites: sanitizedFavorites 
    };
};

export const sanitizeSettings = (settingsData) => {
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const sanitized = JSON.parse(JSON.stringify(defaults)); 

    if (!settingsData || typeof settingsData !== 'object') {
        return sanitized;
    }

    if (settingsData.layout) {
        sanitized.layout.col1 = parseInt(settingsData.layout.col1, 10) || defaults.layout.col1;
        sanitized.layout.col2 = parseInt(settingsData.layout.col2, 10) || defaults.layout.col2;
    }
    if (settingsData.zenMode) {
        sanitized.zenMode.maxWidth = parseInt(settingsData.zenMode.maxWidth, 10) || defaults.zenMode.maxWidth;
    }
    if (settingsData.editor) {
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

    // [핵심 수정] isDirty 플래그 확인 없이, 항상 강제 저장을 시도하여 최신 데이터를 보장
    await handleNoteUpdate(true);

    try {
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
        
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const filename = `${year}${month}${day}_MothNote_Backup.json`;

        chrome.downloads.download({
            url: url,
            filename: filename
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
    
    // [핵심 수정] isDirty 플래그 확인 없이, 항상 강제 저장을 시도
    await handleNoteUpdate(true);
    
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
                const sanitizedContent = sanitizeContentData(importedData);
                
                const hasSettingsInFile = importedData.settings && typeof importedData.settings === 'object';
                const sanitizedSettings = hasSettingsInFile ? sanitizeSettings(importedData.settings) : null;

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

                    if (sanitizedSettings) {
                        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                    }
                    
                    await chrome.storage.local.set({ appState: { folders: newState.folders, trash: newState.trash, favorites: Array.from(newState.favorites) } });
                    saveSession();

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