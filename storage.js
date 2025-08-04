import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert } from './components.js';
// [수정] itemActions.js에서 updateNoteCreationDates 함수를 추가로 가져옵니다.
import { handleNoteUpdate, updateNoteCreationDates, toYYYYMMDD } from './itemActions.js';

// [추가] 현재 탭에서 저장 중인지 여부를 나타내는 플래그. export하여 다른 모듈에서 참조할 수 있게 합니다.
export let isSavingLocally = false;

// --- [Critical Bug Fix] 탭 간 쓰기 충돌 방지를 위한 분산 락(Distributed Lock) 구현 ---

/**
 * 모든 탭에 걸쳐 공유되는 쓰기 락을 획득하려고 시도합니다.
 * @param {string} tabId 락을 획득하려는 현재 탭의 고유 ID
 * @returns {Promise<boolean>} 락 획득 성공 여부
 */
export async function acquireWriteLock(tabId) {
    const { SS_KEY_WRITE_LOCK, LOCK_TIMEOUT_MS } = CONSTANTS;
    const newLock = { tabId, timestamp: Date.now() };

    try {
        const result = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
        let currentLock = result[SS_KEY_WRITE_LOCK];

        // 다른 탭이 소유한 락이 만료되었는지 확인
        if (currentLock && (Date.now() - currentLock.timestamp > LOCK_TIMEOUT_MS)) {
            console.warn(`만료된 쓰기 락을 발견했습니다 (소유자: ${currentLock.tabId}). 락을 강제로 해제합니다.`);
            currentLock = null;
        }

        // 락이 없거나 만료되었다면, 락 획득 시도
        if (!currentLock || currentLock.tabId === tabId) {
            await chrome.storage.session.set({ [SS_KEY_WRITE_LOCK]: newLock });
            
            // 원자성을 보장하기 위해, 잠시 후 다시 읽어서 내가 설정한 락이 맞는지 최종 확인
            const verificationResult = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
            if (verificationResult[SS_KEY_WRITE_LOCK]?.tabId === tabId) {
                return true; // 락 획득 성공
            }
        }
    } catch (e) {
        console.error("쓰기 락 획득 중 오류 발생:", e);
    }

    return false; // 락 획득 실패
}

/**
 * 현재 탭이 소유한 쓰기 락을 해제합니다.
 * @param {string} tabId 락을 해제하려는 현재 탭의 고유 ID
 */
export async function releaseWriteLock(tabId) {
    const { SS_KEY_WRITE_LOCK } = CONSTANTS;
    try {
        const result = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
        // 내가 소유한 락일 경우에만 해제
        if (result[SS_KEY_WRITE_LOCK]?.tabId === tabId) {
            await chrome.storage.session.remove(SS_KEY_WRITE_LOCK);
        }
    } catch (e) {
        console.error("쓰기 락 해제 중 오류 발생:", e);
    }
}
// --- 락 구현 끝 ---


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
        // [Critical Bug 수정] 앱 로딩 시작 시, 완료되지 않은 가져오기 작업이 있는지 먼저 확인합니다.
        const incompleteImportRaw = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        if (incompleteImportRaw) {
            console.warn("완료되지 않은 가져오기 작업 감지. 복구를 시작합니다...");
            recoveryMessage = "이전 가져오기 작업이 완료되지 않아 자동으로 복구했습니다.";

            try {
                const importPayload = JSON.parse(incompleteImportRaw);

                // 플래그에 저장된 데이터를 사용하여 가져오기 작업을 마저 완료합니다.
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(importPayload.settings));
                
                // 이전 세션 정보를 삭제합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY); 
                
                // 복구가 완료되었으므로 플래그를 제거합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                // 복구된 데이터로 앱을 완전히 새로 시작하기 위해 페이지를 새로고침합니다.
                window.location.reload();
                return; // 추가적인 로딩 로직 실행을 중단합니다.

            } catch (err) {
                console.error("가져오기 복구 실패:", err);
                showToast("데이터 가져오기 복구에 실패했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
                // 잘못된 플래그가 계속 문제를 일으키지 않도록 제거합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            }
        }
        
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
        
        if (inFlightData) {
            authoritativeData = inFlightData;
            recoveryMessage = "이전에 완료되지 않은 작업이 복구되었습니다.";
            console.warn("완료되지 않은 트랜잭션(저널)을 발견하여, 해당 데이터를 기준으로 복구를 시작합니다.");
        }

        // --- 3. [구조 개선] 패치 그룹화 및 통합 처리 ---
        if (allPatches.length > 0) {
            let dataWasPatched = false;
            
            // 3-1. 패치를 아이템 ID 기준으로 그룹화하고, 각 타입별로 최신 패치만 유지
            const patchesByItemId = new Map();
            for (const patch of allPatches) {
                if (!patch.itemId) continue;

                if (!patchesByItemId.has(patch.itemId)) {
                    patchesByItemId.set(patch.itemId, {});
                }
                const existingPatches = patchesByItemId.get(patch.itemId);
                
                const getTimestamp = p => p.timestamp || p.data?.updatedAt || 0;
                
                const existingTimestamp = getTimestamp(existingPatches[patch.type] || {});
                const newTimestamp = getTimestamp(patch);

                if (newTimestamp >= existingTimestamp) {
                    existingPatches[patch.type] = patch;
                }
            }
            
            console.warn(`${patchesByItemId.size}개 항목에 대한 저장되지 않은 변경사항(패치)을 발견했습니다. 데이터 병합을 시도합니다.`);

            // 3-2. 그룹화된 패치를 순회하며 통합 복구 로직 적용
            for (const [itemId, groupedPatches] of patchesByItemId.entries()) {
                const { note_patch, rename_patch } = groupedPatches;

                let itemToUpdate = null, folderOfItem = null, isInTrash = false;

                // 기준 데이터에서 아이템 위치 찾기
                for (const folder of authoritativeData.folders) {
                    const note = folder.notes.find(n => n.id === itemId);
                    if (note) { itemToUpdate = note; folderOfItem = folder; break; }
                }
                if (!itemToUpdate) {
                    const folder = authoritativeData.folders.find(f => f.id === itemId);
                    if (folder) { itemToUpdate = folder; }
                }
                if (!itemToUpdate) {
                    const trashedItem = authoritativeData.trash.find(t => t.id === itemId);
                    if (trashedItem) { itemToUpdate = trashedItem; isInTrash = true; }
                }
                
                // Case 1: 아이템이 기준 데이터에 존재하는 경우 (일반적인 패치 적용)
                if (itemToUpdate) {
                    if (note_patch) {
                        // 데이터 충돌 시 '충돌 복구 노트' 생성
                        if (note_patch.data.updatedAt !== itemToUpdate.updatedAt && !isInTrash) {
                             console.warn(`데이터 충돌 감지 (ID: ${itemId}). 덮어쓰기를 방지하기 위해 복구 노트를 생성합니다.`);
                            const RECOVERY_FOLDER_NAME = '⚠️ 충돌 복구된 노트';
                            let recoveryFolder = authoritativeData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                            if (!recoveryFolder) {
                                const now = Date.now();
                                recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${now}-conflict`, name: RECOVERY_FOLDER_NAME, notes: [], createdAt: now, updatedAt: now };
                                authoritativeData.folders.unshift(recoveryFolder);
                            }
                            const conflictedNote = { ...note_patch.data, id: `${itemId}-conflict-${Date.now()}`, title: `[충돌] ${note_patch.data.title}`, isPinned: false, isFavorite: false };
                            recoveryFolder.notes.unshift(conflictedNote);
                            recoveryMessage = `'${note_patch.data.title}' 노트의 데이터 충돌이 감지되어 '${RECOVERY_FOLDER_NAME}' 폴더에 안전하게 복구했습니다.`;
                        } else { // 정상적인 복구
                            Object.assign(itemToUpdate, note_patch.data);
                            recoveryMessage = `저장되지 않았던 노트 '${note_patch.data.title}'의 변경사항을 복구했습니다.`;
                        }
                    }
                    if (rename_patch) {
                         const itemLastUpdated = itemToUpdate.updatedAt || 0;
                         const patchTimestamp = rename_patch.timestamp || 0;
                         if (itemLastUpdated <= patchTimestamp) {
                            if (rename_patch.itemType === CONSTANTS.ITEM_TYPE.FOLDER) itemToUpdate.name = rename_patch.newName;
                            else itemToUpdate.title = rename_patch.newName;
                            itemToUpdate.updatedAt = rename_patch.timestamp;
                            recoveryMessage = `이름이 변경되지 않았던 '${rename_patch.newName}' 항목을 복구했습니다.`;
                         }
                    }
                    dataWasPatched = true;
                } 
                // Case 2: 아이템이 기준 데이터에 없음 (데이터 유실 방지를 위한 '복원' 로직)
                else {
                    console.warn(`패치를 적용할 아이템(ID: ${itemId})을 찾지 못했습니다. 영구 손실을 방지하기 위해 항목을 복원합니다.`);
                    
                    const itemType = rename_patch?.itemType || (note_patch ? CONSTANTS.ITEM_TYPE.NOTE : null);
                    if (!itemType) continue; // 타입 정보가 없으면 복원 불가

                    const RECOVERY_FOLDER_NAME = '복구된 항목';
                    let recoveryFolder = authoritativeData.folders.find(f => f.name === RECOVERY_FOLDER_NAME);
                    if (!recoveryFolder) {
                        const now = Date.now();
                        recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${now}-recovered-item`, name: RECOVERY_FOLDER_NAME, notes: [], createdAt: now, updatedAt: now };
                        authoritativeData.folders.unshift(recoveryFolder);
                    }
                    
                    const timestamp = rename_patch?.timestamp || note_patch?.data?.updatedAt || Date.now();

                    if (itemType === CONSTANTS.ITEM_TYPE.FOLDER) {
                        const resurrectedFolder = {
                            id: itemId,
                            name: rename_patch.newName,
                            notes: [],
                            createdAt: timestamp,
                            updatedAt: timestamp
                        };
                        authoritativeData.folders.unshift(resurrectedFolder);
                        recoveryMessage = `저장되지 않았던 폴더 '${resurrectedFolder.name}'을(를) 복원했습니다.`;
                    } else { // NOTE
                        const resurrectedNote = {
                            id: itemId,
                            title: rename_patch?.newName || note_patch?.data?.title || '복구된 노트',
                            // [CRITICAL BUG FIX] note_patch의 내용을 우선적으로 사용하고, 없을 때만 boilerplate 텍스트 사용
                            content: note_patch?.data?.content || `(이 노트는 비정상 종료로부터 복구되었으며, 이름만 복원되었을 수 있습니다.)`,
                            createdAt: note_patch?.data?.createdAt || timestamp,
                            updatedAt: timestamp,
                            isPinned: false,
                            isFavorite: false
                        };
                        recoveryFolder.notes.unshift(resurrectedNote);
                        recoveryMessage = `저장되지 않았던 노트 '${resurrectedNote.title}'을(를) '${RECOVERY_FOLDER_NAME}' 폴더로 복원했습니다.`;
                    }
                    dataWasPatched = true;
                }
            }

            if (dataWasPatched) {
                authoritativeData.lastSavedTimestamp = Date.now();
            }
        }
        
        // --- 4. 복구된 데이터를 최종 저장하고 임시 파일 정리 ---
        if (authoritativeData !== mainData) {
            await chrome.storage.local.set({ appState: authoritativeData });
            console.log("복구/병합된 데이터를 스토리지에 최종 저장했습니다.");
        }
        
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
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote], createdAt: now, updatedAt: now };
            
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
            notes: notes,
            // [수정] 폴더 타임스탬프 정보도 안전하게 처리
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
                // [수정] 휴지통의 폴더도 타임스탬프 정보 처리
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
            // [개선] 로딩 인디케이터를 위한 변수 선언
            let overlay = null;
            
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
                    e.target.value = ''; // 사용자가 첫 확인에서 취소
                    return;
                }

                // --- [CRITICAL BUG 수정] 데이터 손실 방지를 위한 2차 확인 로직 ---
                // 가져올 데이터가 비어있는지 확인합니다.
                const isDataEmpty = sanitizedContent.folders.length === 0 && sanitizedContent.trash.length === 0;

                if (isDataEmpty) {
                    const finalConfirm = await showConfirm({
                        title: '⚠️ 빈 데이터 경고',
                        message: "가져올 파일에 노트나 폴더가 없습니다.<br><br>계속 진행하면 현재의 모든 데이터가 <strong>영구적으로 삭제되고 빈 상태로 초기화됩니다.</strong><br><br>정말로 모든 데이터를 지우시겠습니까?",
                        isHtml: true,
                        confirmText: '💥 예, 모든 데이터를 삭제합니다',
                        confirmButtonType: 'danger'
                    });

                    // 사용자가 최종 확인에서 취소하면 작업을 중단합니다.
                    if (!finalConfirm) {
                        showToast("데이터 가져오기 작업이 취소되었습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                        e.target.value = '';
                        return;
                    }
                }
                // --- 수정 끝 ---

                window.isImporting = true;
                
                // [개선] 세련된 로딩 인디케이터 생성
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

                // [Critical Bug 수정] 가져올 모든 데이터를 하나의 페이로드로 묶습니다.
                const importPayload = {
                    appState: {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(rebuiltFavorites),
                        lastSavedTimestamp: Date.now()
                    },
                    settings: sanitizedSettings
                };

                // [Critical Bug 수정] 1. 실제 데이터를 덮어쓰기 전, 복구를 위한 플래그를 localStorage에 저장합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, JSON.stringify(importPayload));

                // [Critical Bug 수정] 2. 실제 데이터 덮어쓰기 작업을 수행합니다.
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                
                // [Critical Bug 수정] 3. 모든 작업이 성공적으로 끝난 후, 세션 정보와 복구 플래그를 정리합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY);
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => {
                    window.location.reload();
                }, 500);

            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
                // [개선] 에러 발생 시에도 오버레이가 있다면 제거
                if (overlay && overlay.parentElement) {
                    overlay.remove();
                }
            } finally {
                window.isImporting = false;
                // [수정] 작업이 끝나면 입력 필드를 초기화하여 동일한 파일을 다시 선택할 수 있도록 합니다.
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };
};