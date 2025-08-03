import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes } from './components.js';
// [수정] itemActions.js에서 updateNoteCreationDates 함수를 추가로 가져옵니다.
import { handleNoteUpdate, updateNoteCreationDates } from './itemActions.js';


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
        // [Critical 버그 수정] 가져오기 중단 시 복구 로직
        const importInProgressData = await chrome.storage.local.get(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        if (importInProgressData && Object.keys(importInProgressData).length > 0) {
            const recoveredData = importInProgressData[CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS];
            console.warn("중단된 가져오기 발견. 데이터 복구를 시도합니다.");
            
            // 1. 복구된 데이터로 메인 저장소 덮어쓰기
            await chrome.storage.local.set({ appState: recoveredData.appState });
            
            // 2. 복구된 설정이 있으면 localStorage에 저장
            if (recoveredData.settings) {
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(recoveredData.settings));
            }

            // 3. 임시 데이터 삭제
            await chrome.storage.local.remove(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            console.log("가져오기 데이터 복구 완료.");
        }


        // [High 버그 수정] 앱 로딩 시, 비정상 종료로 저장되지 않은 데이터가 있는지 확인하고 복구합니다.
        const uncommittedDataStr = localStorage.getItem(CONSTANTS.LS_KEY_UNCOMMITTED);
        if (uncommittedDataStr) {
            try {
                console.warn("저장되지 않은 데이터 발견. localStorage 백업으로부터 복구를 시도합니다.");
                const uncommittedData = JSON.parse(uncommittedDataStr);
                // chrome.storage에 비상 데이터를 저장 (복원)
                await chrome.storage.local.set({ appState: uncommittedData });
                // 복원이 완료되었으므로 localStorage의 백업은 제거
                localStorage.removeItem(CONSTANTS.LS_KEY_UNCOMMITTED);
                console.log("데이터 복구 및 백업 삭제 완료.");
            } catch (e) {
                console.error("저장되지 않은 데이터 복구 실패:", e);
                // 실패 시 백업 데이터를 남겨두어 다음 시도를 할 수 있게 함
            }
        }

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

            // 1. 먼저 기본 상태(폴더, 휴지통, 활성 ID 등)를 설정합니다.
            setState(initialState);
            // 2. 설정된 상태를 기반으로 noteMap을 먼저 빌드합니다.
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
                finalActiveNoteId = null; 
                
                const activeFolder = state.folders.find(f => f.id === finalActiveFolderId);
                if (activeFolder && activeFolder.notes.length > 0) {
                    // [버그 수정] 세션에서 불러온 정렬 순서를 사용하여 활성 노트를 결정합니다.
                    const sortedNotes = sortNotes(activeFolder.notes, state.noteSortOrder);
                    finalActiveNoteId = sortedNotes[0]?.id ?? null;
                }
                needsStateUpdate = true;
            }
            
            // 4. 유효성 검사 후 변경된 ID가 있다면 다시 상태를 업데이트하여 렌더링을 트리거합니다.
            if (needsStateUpdate) {
                setState({
                    activeFolderId: finalActiveFolderId,
                    activeNoteId: finalActiveNoteId
                });
            }

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

        // [버그 수정] 데이터 로드 완료 후, 캘린더 하이라이트를 위해 노트 생성일 데이터를 빌드합니다.
        updateNoteCreationDates();

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
            const overlay = document.createElement('div'); // 오버레이를 미리 생성
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 9999; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold;';

            try {
                const importedData = JSON.parse(event.target.result);
                const sanitizedContent = sanitizeContentData(importedData);
                
                // [BUG #1 FIX] 파일에 설정이 없으면 기본 설정으로 덮어쓰도록 수정하여,
                // "모든 설정을 덮어쓴다"는 경고 메시지와 동작을 일치시킵니다.
                const hasSettingsInFile = importedData.settings && typeof importedData.settings === 'object';
                const sanitizedSettings = hasSettingsInFile 
                    ? sanitizeSettings(importedData.settings) 
                    : JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));

                const ok = await showConfirm({
                    title: CONSTANTS.MODAL_TITLES.IMPORT_DATA,
                    message: "가져오기를 실행하면 현재의 모든 노트와 설정이 <strong>파일의 내용으로 덮어씌워집니다.</strong><br><br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
                    isHtml: true,
                    confirmText: '📥 가져와서 덮어쓰기',
                    confirmButtonType: 'danger'
                });

                if (ok) {
                    overlay.textContent = '데이터를 적용하는 중입니다... 잠시만 기다려주세요.';
                    document.body.appendChild(overlay);

                    const totalNoteCount = sanitizedContent.folders.reduce((sum, f) => sum + f.notes.length, 0);
                    const rebuiltFavorites = new Set(sanitizedContent.favorites);

                    sanitizedContent.folders.forEach(folder => {
                        folder.notes.forEach(note => {
                            note.isFavorite = rebuiltFavorites.has(note.id);
                        });
                    });

                    const appStateToSave = {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(rebuiltFavorites)
                    };

                    const newSessionState = {
                        f: sanitizedContent.folders[0]?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
                        n: sanitizedContent.folders[0]?.notes[0]?.id ?? null,
                        s: 'updatedAt_desc',
                        l: {}
                    };

                    // [Critical 버그 수정] 가져오기 프로세스를 트랜잭션화하여 데이터 유실 방지
                    // 1. 가져올 데이터를 임시 키에 저장
                    await chrome.storage.local.set({ 
                        [CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS]: { 
                            appState: appStateToSave,
                            settings: sanitizedSettings
                        } 
                    });

                    // 2. 메인 데이터 저장
                    await chrome.storage.local.set({ appState: appStateToSave });

                    // 3. 설정 저장 (이제 null 체크 없이 항상 실행)
                    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));

                    // 4. 세션 정보 저장
                    localStorage.setItem(CONSTANTS.LS_KEY, JSON.stringify(newSessionState));
                    
                    // 5. 모든 저장이 성공했으므로 임시 데이터 삭제
                    await chrome.storage.local.remove(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                    // 6. 모든 저장이 완료되었으므로, 사용자에게 알린 후 안전하게 새로고침
                    showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                    
                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                }
            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
                if (overlay.parentElement) {
                    overlay.remove();
                }
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
};