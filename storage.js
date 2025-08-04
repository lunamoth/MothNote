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

// [CRITICAL BUG FIX] 데이터 복구 로직 재구성: 타임스탬프 기반으로 최신 데이터 보존
export const loadData = async () => {
    let recoveryMessage = null;

    try {
        // --- 1. 모든 복구 소스 수집 ---
        const mainStorageResult = await chrome.storage.local.get('appState');
        const mainData = mainStorageResult.appState;

        const inFlightTxRaw = localStorage.getItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        const inFlightData = inFlightTxRaw ? JSON.parse(inFlightTxRaw) : null;
        
        const allPatches = [];
        const patchKeysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                patchKeysToRemove.push(key);
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
        
        // --- 2. 가장 최신인 '기준' 데이터 결정 ---
        let authoritativeData = mainData || { folders: [], trash: [], favorites: [], lastSavedTimestamp: 0 };
        
        if (inFlightData && inFlightData.lastSavedTimestamp > authoritativeData.lastSavedTimestamp) {
            authoritativeData = inFlightData;
            recoveryMessage = "이전에 완료되지 않은 작업이 복구되었습니다.";
            console.warn("저널링 데이터가 메인 데이터보다 최신이므로, 저널링 데이터를 기준으로 복구를 시작합니다.");
        }

        // --- 3. 기준 데이터에 '패치' 병합 ---
        if (allPatches.length > 0) {
            let dataWasPatched = false;
            console.warn(`${allPatches.length}개의 저장되지 않은 변경사항(패치)을 발견했습니다. 데이터 병합을 시도합니다.`);

            for (const patch of allPatches) {
                if (patch.type === 'note_patch') {
                    let noteFound = false;
                    for (const folder of authoritativeData.folders) {
                        const noteToPatch = folder.notes.find(n => n.id === patch.noteId);
                        if (noteToPatch) {
                            noteFound = true;
                            // [CRITICAL BUG FIX] 타임스탬프가 단순히 최신인지만 보지 않고,
                            // 패치의 updatedAt과 스토리지 데이터의 updatedAt이 다른 경우 '충돌'로 간주합니다.
                            // 이는 다른 탭에서 유의미한 변경이 있었음을 의미합니다.
                            if ((patch.data.updatedAt || 0) >= (noteToPatch.updatedAt || 0)) {
                                // 타임스탬프가 다르다면, 덮어쓰지 않고 충돌된 노트를 새로 생성합니다.
                                if (patch.data.updatedAt !== noteToPatch.updatedAt) {
                                    console.warn(`데이터 충돌 감지 (ID: ${patch.noteId}). 덮어쓰기를 방지하기 위해 복구 노트를 생성합니다.`);
                                    const RECOVERY_FOLDER_NAME = '⚠️ 충돌 복구된 노트';
                                    let recoveryFolder = authoritativeData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                                    if (!recoveryFolder) {
                                        recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${Date.now()}-conflict`, name: RECOVERY_FOLDER_NAME, notes: [] };
                                        authoritativeData.folders.unshift(recoveryFolder);
                                    }
                                    const conflictedNote = { ...patch.data, id: `${patch.noteId}-conflict-${Date.now()}`, title: `[충돌] ${patch.data.title}`, isPinned: false, isFavorite: false };
                                    recoveryFolder.notes.unshift(conflictedNote);
                                    recoveryMessage = `'${patch.data.title}' 노트의 데이터 충돌이 감지되어 '${RECOVERY_FOLDER_NAME}' 폴더에 안전하게 복구했습니다.`;
                                } else {
                                    // 타임스탬프가 같다면, 정상적인 복구로 간주하고 덮어씁니다.
                                    Object.assign(noteToPatch, patch.data);
                                    recoveryMessage = `저장되지 않았던 노트 '${patch.data.title}'의 변경사항을 복구했습니다.`;
                                }
                                 dataWasPatched = true;
                            } else {
                                 console.warn(`패치 데이터가 이미 저장된 노트 데이터보다 오래되어 무시합니다. (ID: ${patch.noteId})`);
                            }
                            break;
                        }
                    }
                    if (!noteFound && !authoritativeData.trash.some(item => item.id === patch.noteId)) {
                        console.warn(`패치할 노트를 찾지 못했으며(ID: ${patch.noteId}), 영구 손실을 방지하기 위해 노트를 복원합니다.`);
                        const RECOVERY_FOLDER_NAME = '복구된 노트';
                        let recoveryFolder = authoritativeData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                        if (!recoveryFolder) {
                            recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${Date.now()}-recovered`, name: RECOVERY_FOLDER_NAME, notes: [] };
                            authoritativeData.folders.unshift(recoveryFolder);
                        }
                        const resurrectedNote = { ...patch.data, id: patch.noteId, isPinned: false, isFavorite: false, createdAt: patch.data.updatedAt };
                        recoveryFolder.notes.unshift(resurrectedNote);
                        recoveryMessage = `저장되지 않은 노트 '${resurrectedNote.title}'를 '${RECOVERY_FOLDER_NAME}' 폴더로 복원했습니다.`;
                        dataWasPatched = true;
                    }
                } else if (patch.type === 'rename_patch') {
                    let itemFound = false;
                    const findAndRename = (items) => {
                        for (const item of items) {
                            if (item.id === patch.itemId) {
                                if (patch.itemType === CONSTANTS.ITEM_TYPE.FOLDER) item.name = patch.newName;
                                else { item.title = patch.newName; item.updatedAt = patch.timestamp; }
                                return true;
                            }
                            if (item.notes && findAndRename(item.notes)) return true;
                        }
                        return false;
                    };
                    if(findAndRename(authoritativeData.folders) || findAndRename(authoritativeData.trash)) {
                        itemFound = true;
                        dataWasPatched = true;
                        recoveryMessage = `이름이 변경되지 않았던 '${patch.newName}' 항목을 복구했습니다.`;
                        console.log(`이름 변경 패치 완료. (ID: ${patch.itemId})`);
                    } else {
                        console.warn(`이름을 변경할 아이템을 찾지 못했습니다. (ID: ${patch.itemId})`);
                    }
                }
            }

            if (dataWasPatched) {
                authoritativeData.lastSavedTimestamp = Date.now();
            }
        }
        
        // --- 4. 복구된 데이터를 최종 저장하고 임시 파일 정리 ---
        // 복구 과정에서 변경이 있었다면 최종본을 스토리지에 저장
        if (authoritativeData !== mainData) {
            await chrome.storage.local.set({ appState: authoritativeData });
            console.log("복구/병합된 데이터를 스토리지에 최종 저장했습니다.");
        }
        
        // 모든 임시 데이터 삭제
        localStorage.removeItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        patchKeysToRemove.forEach(key => localStorage.removeItem(key));

        // --- 5. 최종 데이터로 앱 상태 설정 ---
        let finalState = { ...state, ...authoritativeData };
        if (authoritativeData && authoritativeData.folders) {
            finalState.trash = finalState.trash || [];
            finalState.favorites = new Set(authoritativeData.favorites || []);

            let lastSession = null;
            try {
                const sessionData = localStorage.getItem(CONSTANTS.LS_KEY);
                if (sessionData) lastSession = JSON.parse(sessionData);
            } catch (e) {
                console.warn("Could not parse last session from localStorage:", e);
                localStorage.removeItem(CONSTANTS.LS_KEY);
            }

            if (lastSession) {
                finalState.activeFolderId = lastSession.f;
                finalState.activeNoteId = lastSession.n;
                finalState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                finalState.lastActiveNotePerFolder = lastSession.l ?? {};
            }

            finalState.totalNoteCount = finalState.folders.reduce((sum, f) => sum + f.notes.length, 0);
            
            setState(finalState);
            buildNoteMap();

            const folderExists = state.folders.some(f => f.id === state.activeFolderId) || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId);
            const noteExists = state.noteMap.has(state.activeNoteId);

            if (!folderExists) {
                setState({ activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id, activeNoteId: null });
            } else if (state.activeFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id && !noteExists) {
                const activeFolder = state.folders.find(f => f.id === state.activeFolderId);
                const firstNoteId = (activeFolder && activeFolder.notes.length > 0)
                    ? sortNotes(activeFolder.notes, state.noteSortOrder)[0]?.id ?? null
                    : null;
                setState({ activeNoteId: firstNoteId });
            }

        } else {
            // 초기 사용자 데이터 생성
            const now = Date.now();
            const fId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
            const nId = `${CONSTANTS.ID_PREFIX.NOTE}${now + 1}`;
            const newNote = { id: nId, title: "🎉 환영합니다!", content: "새 탭 노트에 오신 것을 환영합니다! 🚀", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote] };
            
            const initialState = { ...state, folders: [newFolder], trash: [], favorites: new Set(), activeFolderId: fId, activeNoteId: nId, totalNoteCount: 1 };
            setState(initialState);
            buildNoteMap();
            await saveData();
        }

        updateNoteCreationDates();
        saveSession();

    } catch (e) { 
        console.error("Error loading data:", e); 
        showToast("데이터 로딩 중 심각한 오류가 발생했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
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