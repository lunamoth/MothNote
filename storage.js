import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert } from './components.js';
import { handleNoteUpdate, updateNoteCreationDates, toYYYYMMDD } from './itemActions.js';

const HEARTBEAT_KEY = 'mothnote_active_tabs_v1';

export let isSavingLocally = false;

// --- [Critical Bug Fix] 탭 간 쓰기 충돌 방지를 위한 분산 락(Distributed Lock) 구현 ---
export async function acquireWriteLock(tabId) {
    const { SS_KEY_WRITE_LOCK, LOCK_TIMEOUT_MS } = CONSTANTS;
    const newLock = { tabId, timestamp: Date.now() };

    try {
        const result = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
        let currentLock = result[SS_KEY_WRITE_LOCK];

        if (currentLock && (Date.now() - currentLock.timestamp > LOCK_TIMEOUT_MS)) {
            console.warn(`만료된 쓰기 락을 발견했습니다 (소유자: ${currentLock.tabId}). 락을 강제로 해제합니다.`);
            currentLock = null;
        }

        if (!currentLock || currentLock.tabId === tabId) {
            await chrome.storage.session.set({ [SS_KEY_WRITE_LOCK]: newLock });
            
            const verificationResult = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
            if (verificationResult[SS_KEY_WRITE_LOCK]?.tabId === tabId) {
                return true;
            }
        }
    } catch (e) {
        console.error("쓰기 락 획득 중 오류 발생:", e);
    }

    return false;
}

export async function releaseWriteLock(tabId) {
    const { SS_KEY_WRITE_LOCK } = CONSTANTS;
    try {
        const result = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
        if (result[SS_KEY_WRITE_LOCK]?.tabId === tabId) {
            await chrome.storage.session.remove(SS_KEY_WRITE_LOCK);
        }
    } catch (e) {
        console.error("쓰기 락 해제 중 오류 발생:", e);
    }
}
// --- 락 구현 끝 ---


export const saveData = async () => {
    isSavingLocally = true;
    try {
        const timestamp = Date.now();
        const dataToSave = { 
            folders: state.folders, 
            trash: state.trash,
            favorites: Array.from(state.favorites),
            lastSavedTimestamp: timestamp
        };
        await chrome.storage.local.set({ appState: dataToSave });
        setState({ lastSavedTimestamp: timestamp });
        return true;
    } catch (e) {
        console.error("Error saving state:", e);
        showToast('데이터 저장에 실패했습니다. 저장 공간을 확인해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    } finally {
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
    let recoveryMessage = null;

    try {
        const incompleteImportRaw = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        if (incompleteImportRaw) {
            console.warn("완료되지 않은 가져오기 작업 감지. 복구를 시작합니다...");
            recoveryMessage = "이전 가져오기 작업이 완료되지 않아 자동으로 복구했습니다.";

            try {
                const importPayload = JSON.parse(incompleteImportRaw);
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(importPayload.settings));
                localStorage.removeItem(CONSTANTS.LS_KEY); 
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                window.location.reload();
                return;

            } catch (err) {
                console.error("가져오기 복구 실패:", err);
                showToast("데이터 가져오기 복구에 실패했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            }
        }
        
        const mainStorageResult = await chrome.storage.local.get('appState');
        const mainData = mainStorageResult.appState;

        const inFlightTxRaw = localStorage.getItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        const inFlightData = inFlightTxRaw ? JSON.parse(inFlightTxRaw) : null;

        let activeTabs = {};
        try {
            activeTabs = JSON.parse(sessionStorage.getItem(HEARTBEAT_KEY) || '{}');
        } catch (e) {
            console.error("활성 탭 목록 읽기 실패:", e);
        }
        
        const allPatches = [];
        const patchKeysProcessedInThisLoad = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                const backupTabId = key.substring(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX.length).split('-')[0];
                
                if (backupTabId === window.tabId || !activeTabs[backupTabId]) {
                    if (!activeTabs[backupTabId]) {
                         console.warn(`죽은 탭(${backupTabId})의 백업 데이터 '${key}'를 발견했습니다. 복구를 시도합니다.`);
                    }
                    try {
                        const patchData = JSON.parse(localStorage.getItem(key));
                        if (Array.isArray(patchData)) {
                            allPatches.push(...patchData);
                            patchKeysProcessedInThisLoad.push(key);
                        }
                    } catch (e) {
                        console.error(`비상 백업 데이터 파싱 실패 (키: ${key}):`, e);
                    }
                } else {
                    console.log(`활성 탭(${backupTabId})의 백업 데이터 '${key}'는 건너뜁니다.`);
                }
            }
        }
        
        let authoritativeData = mainData || { folders: [], trash: [], favorites: [], lastSavedTimestamp: 0 };
        
        if (inFlightData) {
            authoritativeData = inFlightData;
            recoveryMessage = "이전에 완료되지 않은 작업이 복구되었습니다.";
            console.warn("완료되지 않은 트랜잭션(저널)을 발견하여, 해당 데이터를 기준으로 복구를 시작합니다.");
        }

        if (allPatches.length > 0) {
            let dataWasPatched = false;
            
            const patchesByItemId = new Map();
            for (const patch of allPatches) {
                if (!patch.itemId && !patch.noteId) continue;
                const itemId = patch.itemId || patch.noteId;

                if (!patchesByItemId.has(itemId)) {
                    patchesByItemId.set(itemId, []);
                }
                patchesByItemId.get(itemId).push(patch);
            }

            console.warn(`${patchesByItemId.size}개 항목에 대한 저장되지 않은 변경사항(패치)을 발견했습니다. 데이터 병합을 시도합니다.`);

            for (const [itemId, patchGroup] of patchesByItemId.entries()) {
                let itemToUpdate = null, isInTrash = false;
                
                for (const folder of authoritativeData.folders) {
                    const note = folder.notes.find(n => n.id === itemId);
                    if (note) { itemToUpdate = note; break; }
                }
                if (!itemToUpdate) {
                    const folder = authoritativeData.folders.find(f => f.id === itemId);
                    if (folder) { itemToUpdate = folder; }
                }
                if (!itemToUpdate) {
                    const trashedItem = authoritativeData.trash.find(t => t.id === itemId);
                    if (trashedItem) { itemToUpdate = trashedItem; isInTrash = true; }
                }

                const getTimestamp = p => p.timestamp || p.data?.updatedAt || 0;
                patchGroup.sort((a, b) => getTimestamp(a) - getTimestamp(b));
                
                if (itemToUpdate) {
                    let isFirstPatchApplied = false;
                    
                    for (const patch of patchGroup) {
                        const { type, data, newName, timestamp, itemType } = patch;
                        const itemLastUpdated = itemToUpdate.updatedAt || 0;
                        const patchTimestamp = timestamp || data?.updatedAt || 0;
                        
                        if (!isFirstPatchApplied && itemLastUpdated < patchTimestamp) {
                            if (type === 'note_patch' && data) {
                                Object.assign(itemToUpdate, data);
                                recoveryMessage = `저장되지 않았던 노트 '${data.title}'의 변경사항을 복구했습니다.`;
                            }
                            if (type === 'rename_patch' && newName) {
                                if (itemType === CONSTANTS.ITEM_TYPE.FOLDER) itemToUpdate.name = newName;
                                else itemToUpdate.title = newName;
                                itemToUpdate.updatedAt = timestamp;
                                recoveryMessage = `이름이 변경되지 않았던 '${newName}' 항목을 복구했습니다.`;
                            }
                            isFirstPatchApplied = true;
                        } 
                        else {
                            if (type === 'note_patch' && data && !isInTrash) {
                                // [근본적인 수정] 중복 노트 생성을 막기 위한 최종 방어 로직
                                // 복제 노트를 만들기 전, 내용이 정말 다른지 확인합니다.
                                const isContentIdentical = (itemToUpdate.title === data.title && itemToUpdate.content === data.content);

                                if (isContentIdentical) {
                                    console.log(`내용이 동일한 중복 패치를 발견하여 건너뜁니다 (ID: ${itemId}).`);
                                    continue; // 중복이므로 충돌 처리 없이 다음 패치로 넘어감
                                }
                                // 내용이 다를 경우에만 충돌로 간주하고 복구 노트를 생성합니다.
                                console.warn(`데이터 충돌 감지 (ID: ${itemId}). 덮어쓰기를 방지하기 위해 복구 노트를 생성합니다.`);
                                const RECOVERY_FOLDER_NAME = '⚠️ 충돌 복구된 노트';
                                let recoveryFolder = authoritativeData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                                if (!recoveryFolder) {
                                    const now = Date.now();
                                    recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${now}-conflict`, name: RECOVERY_FOLDER_NAME, notes: [], createdAt: now, updatedAt: now };
                                    authoritativeData.folders.unshift(recoveryFolder);
                                }
                                const conflictedNote = { ...data, id: `${itemId}-conflict-${Date.now()}`, title: `[충돌] ${data.title}`, isPinned: false, isFavorite: false };
                                recoveryFolder.notes.unshift(conflictedNote);

                                const newRecoveryMessage = `'${data.title}' 노트의 데이터 충돌이 감지되어 '${RECOVERY_FOLDER_NAME}' 폴더에 안전하게 복구했습니다.`;
                                recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${newRecoveryMessage}` : newRecoveryMessage;
                            }
                        }
                    }
                    dataWasPatched = true;
                } 
                else {
                    console.warn(`연결이 끊긴(unlinked) 패치를 발견하여 복구를 시도합니다 (대상 ID: ${itemId}).`);

                    const notePatches = patchGroup.filter(p => p.type === 'note_patch' && p.data);
                    
                    if (notePatches.length > 0) {
                        const UNLINKED_RECOVERY_FOLDER_NAME = '⚠️ 연결 끊긴 노트 복구';
                        let recoveryFolder = authoritativeData.folders.find(f => f.name === UNLINKED_RECOVERY_FOLDER_NAME);
                        
                        if (!recoveryFolder) {
                            const now = Date.now();
                            recoveryFolder = { 
                                id: `${CONSTANTS.ID_PREFIX.FOLDER}${now}-unlinked-recovery`, 
                                name: UNLINKED_RECOVERY_FOLDER_NAME, 
                                notes: [], 
                                createdAt: now, 
                                updatedAt: now 
                            };
                            authoritativeData.folders.unshift(recoveryFolder);
                        }
                        
                        for (const note_patch of notePatches) {
                             const recoveredNote = {
                                ...note_patch.data,
                                id: `${itemId}-unlinked-${Date.now()}-${Math.random()}`,
                                title: `[복구됨] ${note_patch.data.title || '제목 없음'}`,
                                isPinned: false,
                                isFavorite: false,
                            };
                            recoveryFolder.notes.unshift(recoveredNote);
                        }

                        dataWasPatched = true;
                        
                        const newRecoveryMessage = `저장되지 않고 삭제되었을 수 있는 노트(${notePatches.length}개)의 내용을 '${UNLINKED_RECOVERY_FOLDER_NAME}' 폴더에 복구했습니다.`;
                        recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${newRecoveryMessage}` : newRecoveryMessage;
                    } else {
                        console.warn(`내용이 없는 연결 끊긴 패치를 발견하여 무시합니다 (대상 ID: ${itemId}).`);
                    }
                }
            }

            if (dataWasPatched) {
                authoritativeData.lastSavedTimestamp = Date.now();
            }
        }
        
        if (authoritativeData !== mainData) {
            await chrome.storage.local.set({ appState: authoritativeData });
            console.log("복구/병합된 데이터를 스토리지에 최종 저장했습니다.");
        }
        
        localStorage.removeItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        patchKeysProcessedInThisLoad.forEach(key => localStorage.removeItem(key));

        let finalState = { ...state, ...authoritativeData };
        if (authoritativeData && authoritativeData.folders && authoritativeData.folders.length > 0) {
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
            const now = Date.now();
            const fId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
            const nId = `${CONSTANTS.ID_PREFIX.NOTE}${now + 1}`;
            const newNote = { id: nId, title: "🎉 환영합니다!", content: "MothNote 에 오신 것을 환영합니다! 🦋", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote], createdAt: now, updatedAt: now };

            const transactionId = Date.now() + Math.random();
            const initialAppStateForStorage = {
                folders: [newFolder],
                trash: [],
                favorites: [],
                lastSavedTimestamp: now,
                transactionId: transactionId
            };
            
            const initialStateForState = {
                ...state,
                folders: [newFolder],
                trash: [],
                favorites: new Set(),
                activeFolderId: fId,
                activeNoteId: nId,
                totalNoteCount: 1,
                lastSavedTimestamp: now,
                currentTransactionId: transactionId
            };
            setState(initialStateForState);
            
            buildNoteMap();
            
            await chrome.storage.local.set({ appState: initialAppStateForStorage });
        }

        updateNoteCreationDates();
        saveSession();

    } catch (e) { 
        console.error("Error loading data:", e); 
        showToast("데이터 로딩 중 심각한 오류가 발생했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
    } finally {
        if (recoveryMessage) {
            const preFormattedMessage = document.createElement('pre');
            preFormattedMessage.style.whiteSpace = 'pre-wrap';
            preFormattedMessage.style.textAlign = 'left';
            preFormattedMessage.style.margin = '0';
            preFormattedMessage.textContent = recoveryMessage;
            return { recoveryMessage: preFormattedMessage };
        }
        return { recoveryMessage: null };
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
            notes: notes,
            createdAt: Number(f.createdAt) || Date.now(),
            updatedAt: Number(f.updatedAt) || Date.now(),
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
                deletedAt: item.deletedAt || Date.now(),
                createdAt: Number(item.createdAt) || item.deletedAt || Date.now(),
                updatedAt: Number(item.updatedAt) || item.deletedAt || Date.now(),
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
            let overlay = null;
            let lockAcquired = false;

            try {
                const importedData = JSON.parse(event.target.result);
                const sanitizedContent = sanitizeContentData(importedData);
                
                const hasSettingsInFile = importedData.settings && typeof importedData.settings === 'object';
                const sanitizedSettings = hasSettingsInFile 
                    ? sanitizeSettings(importedData.settings) 
                    : JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));

                const firstConfirm = await showConfirm({
                    title: CONSTANTS.MODAL_TITLES.IMPORT_DATA,
                    message: "가져오기를 실행하면 현재의 모든 노트와 설정이 <strong>파일의 내용으로 덮어씌워집니다.</strong><br><br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
                    isHtml: true,
                    confirmText: '📥 가져와서 덮어쓰기',
                    confirmButtonType: 'danger'
                });

                if (!firstConfirm) {
                    e.target.value = '';
                    return;
                }

                const isDataEmpty = sanitizedContent.folders.length === 0 && sanitizedContent.trash.length === 0;

                if (isDataEmpty) {
                    const finalConfirm = await showConfirm({
                        title: '⚠️ 빈 데이터 경고',
                        message: "가져올 파일에 노트나 폴더가 없습니다.<br><br>계속 진행하면 현재의 모든 데이터가 <strong>영구적으로 삭제되고 빈 상태로 초기화됩니다.</strong><br><br>정말로 모든 데이터를 지우시겠습니까?",
                        isHtml: true,
                        confirmText: '💥 예, 모든 데이터를 삭제합니다',
                        confirmButtonType: 'danger'
                    });

                    if (!finalConfirm) {
                        showToast("데이터 가져오기 작업이 취소되었습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                        e.target.value = '';
                        return;
                    }
                }

                if (!(await acquireWriteLock(window.tabId))) {
                    showToast("다른 탭에서 작업을 처리 중입니다. 잠시 후 다시 시도해주세요.", CONSTANTS.TOAST_TYPE.ERROR);
                    e.target.value = '';
                    return;
                }
                lockAcquired = true;

                window.isImporting = true;
                
                overlay = document.createElement('div');
                overlay.className = 'import-overlay';
                overlay.innerHTML = `
                    <div class="import-indicator-box">
                        <div class="import-spinner"></div>
                        <p class="import-message">데이터를 적용하는 중입니다... 잠시만 기다려주세요.</p>
                    </div>
                `;
                document.body.appendChild(overlay);

                const rebuiltFavorites = new Set(sanitizedContent.favorites);

                const importPayload = {
                    appState: {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(rebuiltFavorites),
                        lastSavedTimestamp: Date.now()
                    },
                    settings: sanitizedSettings
                };

                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, JSON.stringify(importPayload));
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                
                localStorage.removeItem(CONSTANTS.LS_KEY);
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => {
                    window.location.reload();
                }, 500);

            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
            } finally {
                if (lockAcquired) {
                    await releaseWriteLock(window.tabId);
                }
                window.isImporting = false;
                if (overlay && overlay.parentElement) {
                    overlay.remove();
                }
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };
};