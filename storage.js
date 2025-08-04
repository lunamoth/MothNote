import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes } from './components.js';
// [수정] itemActions.js에서 updateNoteCreationDates 함수를 추가로 가져옵니다.
import { handleNoteUpdate, updateNoteCreationDates, toYYYYMMDD } from './itemActions.js';

// [추가] 현재 탭에서 저장 중인지 여부를 나타내는 플래그. export하여 다른 모듈에서 참조할 수 있게 합니다.
export let isSavingLocally = false;

export const saveData = async () => {
    // [수정] 저장 작업을 시작하기 전에 동기적으로 플래그를 설정합니다.
    isSavingLocally = true;
    try {
        // [CRITICAL BUG 2 FIX] 저장 시점의 타임스탬프를 함께 기록합니다.
        const timestamp = Date.now();
        const dataToSave = { 
            folders: state.folders, 
            trash: state.trash,
            favorites: Array.from(state.favorites),
            lastSavedTimestamp: timestamp
        };
        await chrome.storage.local.set({ appState: dataToSave });

        // [CRITICAL BUG 2 FIX] 저장 성공 후, 메모리의 타임스탬프도 갱신합니다.
        // 이는 beforeunload 핸들러가 정확한 최신 타임스탬프를 참조하도록 보장합니다.
        setState({ lastSavedTimestamp: timestamp });

        return true; // [BUG 1 FIX] 저장 성공 시 true 반환
    } catch (e) {
        console.error("Error saving state:", e);
        showToast('데이터 저장에 실패했습니다. 저장 공간을 확인해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
        return false; // [BUG 1 FIX] 저장 실패 시 false 반환
    } finally {
        // [수정] 작업이 성공하든 실패하든, 항상 플래그를 해제하여 다음 동기화가 정상적으로 이루어지게 합니다.
        isSavingLocally = false;
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
    // [CRITICAL BUG FIX] 사용자에게 알릴 복구 메시지를 저장할 변수
    let recoveryMessage = null;

    try {
        // [Critical 버그 수정] 가져오기 중단 시 복구 로직
        const importInProgressData = await chrome.storage.local.get(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        
        // [BUG 1 FIX] 가져오기 복구를 우선적으로 처리하고, 성공 시 비정상 종료 데이터를 무효화합니다.
        if (importInProgressData && Object.keys(importInProgressData).length > 0 && importInProgressData[CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS]) {
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
            
            // 4. [핵심 수정] 가져오기 복구가 성공했으므로, 더 이상 유효하지 않은 비정상 종료 데이터는 제거합니다.
            // 이렇게 하지 않으면, 가져오기 이전의 미저장 데이터가 가져온 데이터를 덮어쓰는 문제가 발생할 수 있습니다.
            localStorage.removeItem(CONSTANTS.LS_KEY_UNCOMMITTED);
        }
        
        // [CRITICAL BUG FIX] 다중 탭 데이터 덮어쓰기 방지를 위한 복구 로직 재설계
        const mainStorageResult = await chrome.storage.local.get('appState');
        let mainStorageData = mainStorageResult.appState;
        
        const uncommittedDataStr = localStorage.getItem(CONSTANTS.LS_KEY_UNCOMMITTED);

        // [CRITICAL BUG FIX] 데이터 유실 방지: 패치 적용 전 타임스탬프 비교
        if (uncommittedDataStr) {
            try {
                const patchData = JSON.parse(uncommittedDataStr);
                let dataWasPatched = false;

                // [버그 2 수정] 노트 내용 패치 로직
                if (mainStorageData && patchData.type === 'note_patch') {
                    console.warn("저장되지 않은 노트 변경분(Patch) 발견. 데이터 병합을 시도합니다.");
                    
                    let noteFound = false;
                    for (const folder of mainStorageData.folders) {
                        const noteToPatch = folder.notes.find(n => n.id === patchData.noteId);
                        if (noteToPatch) {
                            noteFound = true;
                            const mainNoteTimestamp = noteToPatch.updatedAt || 0;
                            const patchTimestamp = patchData.data.updatedAt || 0;

                            if (patchTimestamp > mainNoteTimestamp) {
                                Object.assign(noteToPatch, patchData.data);
                                dataWasPatched = true;
                                console.log(`노트 데이터 패치 완료. (ID: ${patchData.noteId})`);
                            } else {
                                console.warn(`저장되지 않은 변경사항(Patch)이 이미 저장된 데이터보다 오래되었거나 동일하므로 무시합니다.`);
                            }
                            break;
                        }
                    }
                    
                    if (!noteFound) {
                        console.warn(`패치할 노트를 찾지 못했으며(ID: ${patchData.noteId}), 영구 손실을 방지하기 위해 노트를 복원합니다.`);
                        const RECOVERY_FOLDER_NAME = '복구된 노트';
                        let recoveryFolder = mainStorageData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                        if (!recoveryFolder) {
                            recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${Date.now()}-recovered`, name: RECOVERY_FOLDER_NAME, notes: [] };
                            mainStorageData.folders.unshift(recoveryFolder);
                        }
                        const resurrectedNote = { ...patchData.data, id: patchData.noteId, isPinned: false, isFavorite: false, createdAt: patchData.data.updatedAt };
                        recoveryFolder.notes.unshift(resurrectedNote);
                        recoveryMessage = `저장되지 않은 노트 '${resurrectedNote.title}'를 '${RECOVERY_FOLDER_NAME}' 폴더로 복원했습니다.`;
                        dataWasPatched = true;
                    }
                // [버그 2 수정] 이름 변경 패치 로직
                } else if (mainStorageData && patchData.type === 'rename_patch') {
                    console.warn("저장되지 않은 이름 변경(Patch) 발견. 데이터 병합을 시도합니다.");
                    let itemFound = false;
                    const findAndRename = (items) => {
                        for (const item of items) {
                            if (item.id === patchData.itemId) {
                                if (patchData.itemType === CONSTANTS.ITEM_TYPE.FOLDER) {
                                    item.name = patchData.newName;
                                } else {
                                    item.title = patchData.newName;
                                    item.updatedAt = patchData.timestamp;
                                }
                                return true;
                            }
                            if (item.notes) {
                                if (findAndRename(item.notes)) return true;
                            }
                        }
                        return false;
                    };
                    
                    if(findAndRename(mainStorageData.folders)) {
                        itemFound = true;
                    }

                    if (itemFound) {
                        dataWasPatched = true;
                        recoveryMessage = `이름이 변경되지 않았던 '${patchData.newName}' 항목을 복구했습니다.`;
                        console.log(`이름 변경 패치 완료. (ID: ${patchData.itemId})`);
                    } else {
                        console.warn(`이름을 변경할 아이템을 찾지 못했습니다. (ID: ${patchData.itemId})`);
                    }
                }

                if (dataWasPatched) {
                    mainStorageData.lastSavedTimestamp = Date.now();
                    await chrome.storage.local.set({ appState: mainStorageData });
                }

            } catch (e) {
                console.error("저장되지 않은 데이터(패치) 복구 실패:", e);
            } finally {
                // 복구 시도 후에는 항상 비상 백업 데이터를 삭제하여 반복적인 복구를 방지합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY_UNCOMMITTED);
            }
        }

        // [버그 수정] 앱 로딩 시 이름 변경 상태를 항상 초기화
        setState({ renamingItemId: null });

        let initialState = { ...state };

        if (mainStorageData && mainStorageData.folders) {
            initialState = { ...initialState, ...mainStorageData };
            if (!initialState.trash) {
                initialState.trash = [];
            }
            initialState.favorites = new Set(mainStorageData.favorites || []);

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

    } catch (e) { 
        console.error("Error loading data:", e); 
    } finally {
        // [CRITICAL BUG FIX] 복구 메시지가 있다면 반환하여 UI에 표시하도록 함
        return { recoveryMessage };
    }
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
            // [Critical 버그 수정] 가져오기 시, 폴더에 포함된 노트도 isTrash=true로 Sanitize 합니다.
            if (Array.isArray(item.notes)) {
                folder.notes = item.notes.map(n => sanitizeNote(n, true));
            }
            acc.push(folder);
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
            favorites: Array.from(state.favorites),
            // [CRITICAL BUG 2 FIX] 내보내는 데이터에도 타임스탬프를 포함합니다.
            lastSavedTimestamp: state.lastSavedTimestamp
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
            
            // [BUG 2 FIX] finally 블록을 사용하여 어떤 경우에도 isImporting 플래그가 초기화되도록 보장
            try {
                const importedData = JSON.parse(event.target.result);
                const sanitizedContent = sanitizeContentData(importedData);
                
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
                    // [BUG 2 FIX] 데이터 교체라는 민감한 작업이 시작됨을 알립니다.
                    window.isImporting = true;
                    
                    overlay.textContent = '데이터를 적용하는 중입니다... 잠시만 기다려주세요.';
                    document.body.appendChild(overlay);

                    const rebuiltFavorites = new Set(sanitizedContent.favorites);

                    const appStateToSave = {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(rebuiltFavorites),
                        // [CRITICAL BUG 2 FIX] 가져온 데이터에도 현재 시점의 타임스탬프를 부여합니다.
                        lastSavedTimestamp: Date.now()
                    };

                    await chrome.storage.local.set({ 
                        [CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS]: { 
                            appState: appStateToSave,
                            settings: sanitizedSettings
                        } 
                    });
                    await chrome.storage.local.set({ appState: appStateToSave });
                    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                    
                    // [CRITICAL BUG 1 FIX] 세션 불일치 방지를 위해 이전 세션 정보를 삭제합니다.
                    localStorage.removeItem(CONSTANTS.LS_KEY);
                    await chrome.storage.local.remove(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                    // [CRITICAL BUG 1 FIX] 페이지를 새로고침하여 깨끗한 상태에서 데이터를 다시 로드합니다.
                    showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                }
            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
                if (overlay.parentElement) {
                    overlay.remove();
                }
            } finally {
                // [BUG 2 FIX] 작업이 성공하든 실패하든, isImporting 상태를 해제하여
                // beforeunload 핸들러가 정상적으로 동작하도록 복원합니다.
                window.isImporting = false;
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
};