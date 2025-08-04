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
        // [Critical 버그 수정] 데이터 손상 방지: 로드 시작 시 충돌 플래그를 확인합니다.
        const hadDataConflict = localStorage.getItem(CONSTANTS.LS_KEY_DATA_CONFLICT);
        if (hadDataConflict) {
            // 플래그가 있었다면, 잠재적으로 오염된 비상 백업 데이터를 폐기합니다.
            localStorage.removeItem(CONSTANTS.LS_KEY_DATA_CONFLICT);
            // [Critical 버그 수정] 충돌 시 모든 비상 백업 키를 제거합니다.
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                    localStorage.removeItem(key);
                }
            }
            console.warn("이전 세션에서 데이터 충돌이 감지되었습니다. 데이터 손상을 방지하기 위해 저장되지 않은 변경사항을 폐기합니다.");
            showToast(
                "⚠️ 이전 세션의 데이터 충돌로 인해 일부 변경사항이 저장되지 않았을 수 있습니다.",
                CONSTANTS.TOAST_TYPE.ERROR,
                8000
            );
        }

        const importInProgressDataPromise = chrome.storage.local.get(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        const mainStorageResultPromise = chrome.storage.local.get('appState');
        
        const [importInProgressResult, mainStorageResult] = await Promise.all([importInProgressDataPromise, mainStorageResultPromise]);

        // [Critical 버그 수정] 가져오기 중단 시 복구 로직
        if (importInProgressResult && Object.keys(importInProgressResult).length > 0 && importInProgressResult[CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS]) {
            const recoveredImport = importInProgressResult[CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS];
            console.warn("중단된 가져오기 발견. 데이터 복구를 시도합니다.");
            
            // [Critical 버그 수정] 가져오기 복구 시, 최신 비상 백업 데이터와 충돌하는지 확인
            // 이 로직은 이제 모든 비상 백업 키를 검사해야 하지만, 현재 구현에서는 가장 최신 패치 하나만 비교합니다.
            // 복잡성을 고려하여 첫 번째 발견된 백업 데이터와 비교하는 로직을 유지하되, 모든 키를 검사하도록 개선할 수 있습니다.
            let uncommittedPatchExists = false;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                     uncommittedPatchExists = true;
                     // 여기서는 우선순위 결정을 위해 하나의 패치만 확인합니다.
                     const uncommittedDataStr = localStorage.getItem(key);
                     try {
                        const patches = JSON.parse(uncommittedDataStr);
                        const notePatch = Array.isArray(patches) ? patches.find(p => p.type === 'note_patch') : null;
                        const importTimestamp = recoveredImport.appState?.lastSavedTimestamp || 0;
                        const patchTimestamp = notePatch?.data?.updatedAt || 0;

                        if (patchTimestamp > importTimestamp) {
                            console.warn("가져오기 복구 데이터보다 최신인 비상 백업 데이터가 존재하여, 가져오기 복구를 취소합니다. 사용자의 최신 작업을 우선적으로 복구합니다.");
                        } else {
                            localStorage.removeItem(key); // 더 오래된 백업은 제거
                        }
                    } catch (e) {
                         console.error("비상 백업 데이터와 가져오기 데이터 비교 중 오류 발생:", e);
                         localStorage.removeItem(key);
                    }
                    break; // 첫 번째 패치만 확인 후 중단
                }
            }

            if (!uncommittedPatchExists) {
                 // 비상 백업이 없으면 안전하게 가져오기 복구 진행
                await chrome.storage.local.set({ appState: recoveredImport.appState });
                if (recoveredImport.settings) {
                    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(recoveredImport.settings));
                }
            }
            
            await chrome.storage.local.remove(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            console.log("가져오기 데이터 복구 완료.");
        }
        
        // 다시 최신 데이터를 불러옵니다 (가져오기 복구가 있었을 수 있으므로).
        let mainStorageData = (await chrome.storage.local.get('appState')).appState;
        
        // [Critical 버그 수정] 여러 탭의 모든 비상 백업 데이터를 수집하고 처리합니다.
        const allPatches = [];
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                keysToRemove.push(key);
                try {
                    const patchData = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(patchData)) {
                        allPatches.push(...patchData);
                    }
                } catch (e) {
                    console.error(`비상 백업 데이터 파싱 실패 (키: ${key}):`, e);
                }
            }
        }

        if (allPatches.length > 0) {
            let dataWasPatched = false;
            try {
                console.warn(`${allPatches.length}개의 저장되지 않은 변경사항을 발견했습니다. 데이터 병합을 시도합니다.`);

                for (const patchData of allPatches) {
                    if (mainStorageData && patchData.type === 'note_patch') {
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
                                    recoveryMessage = `저장되지 않은 노트 '${patchData.data.title}'의 변경사항을 복구했습니다.`;
                                    console.log(`노트 데이터 패치 완료. (ID: ${patchData.noteId})`);
                                } else {
                                    console.warn(`저장되지 않은 변경사항(Patch)이 이미 저장된 데이터보다 오래되었거나 동일하므로 무시합니다.`);
                                }
                                break;
                            }
                        }
                        if (!noteFound) {
                            // 노트가 삭제된 경우의 복원 로직
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

                    } else if (mainStorageData && patchData.type === 'rename_patch') {
                        // 이름 변경 패치 로직은 동일
                        let itemFound = false;
                        const findAndRename = (items) => {
                            for (const item of items) {
                                if (item.id === patchData.itemId) {
                                    if (patchData.itemType === CONSTANTS.ITEM_TYPE.FOLDER) item.name = patchData.newName;
                                    else { item.title = patchData.newName; item.updatedAt = patchData.timestamp; }
                                    return true;
                                }
                                if (item.notes && findAndRename(item.notes)) return true;
                            }
                            return false;
                        };
                        
                        if(findAndRename(mainStorageData.folders)) {
                            itemFound = true;
                            dataWasPatched = true;
                            recoveryMessage = `이름이 변경되지 않았던 '${patchData.newName}' 항목을 복구했습니다.`;
                            console.log(`이름 변경 패치 완료. (ID: ${patchData.itemId})`);
                        } else {
                            console.warn(`이름을 변경할 아이템을 찾지 못했습니다. (ID: ${patchData.itemId})`);
                        }
                    }
                }

                if (dataWasPatched) {
                    mainStorageData.lastSavedTimestamp = Date.now();
                    await chrome.storage.local.set({ appState: mainStorageData });
                }

            } catch (e) {
                console.error("저장되지 않은 데이터(패치) 복구 실패:", e);
            } finally {
                // [Critical 버그 수정] 처리된 모든 비상 백업 키 삭제
                keysToRemove.forEach(key => localStorage.removeItem(key));
                console.log("모든 비상 백업 데이터를 처리하고 삭제했습니다.");
            }
        }

        setState({ renamingItemId: null });

        let initialState = { ...state };

        if (mainStorageData && mainStorageData.folders) {
            initialState = { ...initialState, ...mainStorageData };
            initialState.trash = initialState.trash || [];
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

            setState(initialState);
            buildNoteMap();

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

            if (finalActiveFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id && !noteExists) {
                finalActiveNoteId = null; 
                const activeFolder = state.folders.find(f => f.id === finalActiveFolderId);
                if (activeFolder && activeFolder.notes.length > 0) {
                    const sortedNotes = sortNotes(activeFolder.notes, state.noteSortOrder);
                    finalActiveNoteId = sortedNotes[0]?.id ?? null;
                }
                needsStateUpdate = true;
            }
            
            if (needsStateUpdate) {
                setState({ activeFolderId: finalActiveFolderId, activeNoteId: finalActiveNoteId });
            }

        } else {
            const now = Date.now();
            const fId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
            const nId = `${CONSTANTS.ID_PREFIX.NOTE}${now + 1}`;
            const newNote = { id: nId, title: "🎉 환영합니다!", content: "새 탭 노트에 오신 것을 환영합니다! 🚀", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote] };

            initialState = { ...initialState, folders: [newFolder], trash: [], favorites: new Set(), activeFolderId: fId, activeNoteId: nId };
            initialState.totalNoteCount = 1;

            setState(initialState);
            buildNoteMap();
            await saveData();
        }

        updateNoteCreationDates();
        saveSession();

    } catch (e) { 
        console.error("Error loading data:", e); 
    } finally {
        return { recoveryMessage };
    }
};

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

    await handleNoteUpdate(true);

    try {
        const dataToExport = {
            settings: settings,
            folders: state.folders,
            trash: state.trash,
            favorites: Array.from(state.favorites),
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
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 9999; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold;';
            
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
                    window.isImporting = true;
                    
                    overlay.textContent = '데이터를 적용하는 중입니다... 잠시만 기다려주세요.';
                    document.body.appendChild(overlay);

                    const rebuiltFavorites = new Set(sanitizedContent.favorites);

                    const appStateToSave = {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(rebuiltFavorites),
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
                    
                    localStorage.removeItem(CONSTANTS.LS_KEY);
                    await chrome.storage.local.remove(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

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
                window.isImporting = false;
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
};