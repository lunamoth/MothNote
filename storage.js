import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert } from './components.js';
import { handleNoteUpdate, updateNoteCreationDates, toYYYYMMDD } from './itemActions.js';

// [HEARTBEAT] 다른 탭의 활성 상태를 확인하기 위한 키 (기능 유지)
const HEARTBEAT_KEY = 'mothnote_active_tabs_v1';

export let isSavingLocally = false;

// --- 분산 락(Distributed Lock) 구현 --- (기능 유지, 변경 없음)
export async function acquireWriteLock(tabId) {
    const { SS_KEY_WRITE_LOCK, LOCK_TIMEOUT_MS } = CONSTANTS;
    const newLock = { tabId, timestamp: Date.now() };

    try {
        const result = await chrome.storage.session.get(SS_KEY_WRITE_LOCK);
        let currentLock = result[SS_KEY_WRITE_LOCK];

        // 데드락 방지를 위해 만료된 락은 강제 해제
        if (currentLock && (Date.now() - currentLock.timestamp > LOCK_TIMEOUT_MS)) {
            console.warn(`만료된 쓰기 락을 발견했습니다 (소유자: ${currentLock.tabId}). 락을 강제로 해제합니다.`);
            currentLock = null;
        }

        if (!currentLock || currentLock.tabId === tabId) {
            await chrome.storage.session.set({ [SS_KEY_WRITE_LOCK]: newLock });
            
            // 내가 락을 설정한 후, 다시 읽어서 정말로 내 락인지 확인
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


// [수정] saveData는 이제 사용되지 않지만, 다른 곳에서 참조할 수 있어 유지합니다.
// 모든 저장은 performTransactionalUpdate를 통해 이루어집니다.
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

// 세션 상태(활성 폴더/노트 등) 저장 (기능 유지, 변경 없음)
export const saveSession = () => {
    localStorage.setItem(CONSTANTS.LS_KEY, JSON.stringify({
        f: state.activeFolderId,
        n: state.activeNoteId,
        s: state.noteSortOrder,
        l: state.lastActiveNotePerFolder
    }));
};

// [근본적인 아키텍처 수정] loadData 함수를 단순화하고 역할을 명확히 합니다.
// 이제 이 함수는 1) 비정상적인 가져오기 복구, 2) '죽은 탭'의 비상 백업 복구만 책임집니다.
export const loadData = async () => {
    let recoveryMessage = null;

    try {
        // 1. 비정상적인 가져오기 작업 복구 (가장 높은 우선순위)
        const incompleteImportRaw = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        if (incompleteImportRaw) {
            console.warn("완료되지 않은 가져오기 작업 감지. 복구를 시작합니다...");
            recoveryMessage = "이전 가져오기 작업이 완료되지 않아 자동으로 복구했습니다.";

            try {
                const importPayload = JSON.parse(incompleteImportRaw);
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(importPayload.settings));
                localStorage.removeItem(CONSTANTS.LS_KEY); // 세션 초기화
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                window.location.reload();
                return; // 복구 후 즉시 종료

            } catch (err) {
                console.error("가져오기 복구 실패:", err);
                showToast("데이터 가져오기 복구에 실패했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            }
        }
        
        // 2. 주 저장소에서 데이터 로드
        const mainStorageResult = await chrome.storage.local.get('appState');
        let authoritativeData = mainStorageResult.appState || { folders: [], trash: [], favorites: [], lastSavedTimestamp: 0 };

        // 3. [단순화] 'in-flight' 저널링 로직 제거
        // 분산 락과 원자적 트랜잭션으로 대체되었으므로 더 이상 필요하지 않습니다.

        // 4. '죽은 탭'의 비상 백업(uncommitted patches) 수집 및 복구
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
                
                // [핵심] 현재 탭의 백업이나 다른 활성 탭의 백업은 건너뜁니다.
                // 오직 '죽은 탭'(비정상 종료된 탭)의 백업만 복구 대상으로 삼습니다.
                if (backupTabId !== window.tabId && !activeTabs[backupTabId]) {
                    console.warn(`죽은 탭(${backupTabId})의 비상 백업 데이터 '${key}'를 발견했습니다. 복구를 시도합니다.`);
                    try {
                        const patchData = JSON.parse(localStorage.getItem(key));
                        if (Array.isArray(patchData)) {
                            allPatches.push(...patchData);
                            patchKeysProcessedInThisLoad.push(key);
                        }
                    } catch (e) {
                        console.error(`비상 백업 데이터 파싱 실패 (키: ${key}):`, e);
                    }
                }
            }
        }
        
        // 5. 수집된 패치를 주 데이터에 병합
        if (allPatches.length > 0) {
            let dataWasPatched = false;
            
            // 패치를 항목 ID별로 그룹화
            const patchesByItemId = new Map();
            for (const patch of allPatches) {
                const itemId = patch.itemId || patch.noteId;
                if (!itemId) continue;

                if (!patchesByItemId.has(itemId)) {
                    patchesByItemId.set(itemId, []);
                }
                patchesByItemId.get(itemId).push(patch);
            }

            console.warn(`${patchesByItemId.size}개 항목에 대한 저장되지 않은 변경사항(패치)을 발견했습니다. 데이터 병합을 시도합니다.`);

            for (const [itemId, patchGroup] of patchesByItemId.entries()) {
                // 패치 그룹을 시간순으로 정렬
                patchGroup.sort((a, b) => (a.timestamp || a.data?.updatedAt || 0) - (b.timestamp || b.data?.updatedAt || 0));
                const latestPatch = patchGroup[patchGroup.length - 1]; // 가장 최신 패치만 적용

                let itemToUpdate = null;
                
                // 폴더/노트/휴지통에서 항목 찾기
                for (const folder of authoritativeData.folders) {
                    if (folder.id === itemId) { itemToUpdate = folder; break; }
                    const note = folder.notes.find(n => n.id === itemId);
                    if (note) { itemToUpdate = note; break; }
                }
                if (!itemToUpdate) {
                    const trashedItem = authoritativeData.trash.find(t => t.id === itemId);
                    if (trashedItem) { itemToUpdate = trashedItem; }
                }

                if (itemToUpdate) {
                    // 항목이 존재하고, 패치가 더 최신인 경우에만 업데이트
                    const itemLastUpdated = itemToUpdate.updatedAt || 0;
                    const patchTimestamp = latestPatch.timestamp || latestPatch.data?.updatedAt || 0;
                    
                    if (itemLastUpdated < patchTimestamp) {
                        if (latestPatch.type === 'note_patch' && latestPatch.data) {
                            Object.assign(itemToUpdate, latestPatch.data);
                            recoveryMessage = (recoveryMessage ? recoveryMessage + "\n" : "") + `저장되지 않았던 노트 '${latestPatch.data.title}'의 변경사항을 복구했습니다.`;
                        }
                        if (latestPatch.type === 'rename_patch' && latestPatch.newName) {
                            if (latestPatch.itemType === CONSTANTS.ITEM_TYPE.FOLDER) itemToUpdate.name = latestPatch.newName;
                            else itemToUpdate.title = latestPatch.newName;
                            itemToUpdate.updatedAt = latestPatch.timestamp;
                            recoveryMessage = (recoveryMessage ? recoveryMessage + "\n" : "") + `이름이 변경되지 않았던 '${latestPatch.newName}' 항목을 복구했습니다.`;
                        }
                        dataWasPatched = true;
                    }
                } else {
                    // 항목이 존재하지 않는 경우 (예: 노트는 생성되었지만 폴더 정보가 저장되기 전에 탭이 닫힌 경우)
                    // '연결 끊긴 노트'로 복구
                    if (latestPatch.type === 'note_patch' && latestPatch.data) {
                        const UNLINKED_RECOVERY_FOLDER_NAME = '⚠️ 연결 끊긴 노트 복구';
                        let recoveryFolder = authoritativeData.folders.find(f => f.name === UNLINKED_RECOVERY_FOLDER_NAME);
                        if (!recoveryFolder) {
                            const now = Date.now();
                            recoveryFolder = { id: `${CONSTANTS.ID_PREFIX.FOLDER}${now}-unlinked`, name: UNLINKED_RECOVERY_FOLDER_NAME, notes: [], createdAt: now, updatedAt: now };
                            authoritativeData.folders.unshift(recoveryFolder);
                        }
                        const recoveredNote = { ...latestPatch.data, id: `${itemId}-recovered-${Date.now()}` };
                        recoveryFolder.notes.unshift(recoveredNote);
                        dataWasPatched = true;
                        recoveryMessage = (recoveryMessage ? recoveryMessage + "\n" : "") + `'${UNLINKED_RECOVERY_FOLDER_NAME}' 폴더에 연결이 끊긴 노트를 복구했습니다.`;
                    }
                }
            }

            if (dataWasPatched) {
                authoritativeData.lastSavedTimestamp = Date.now();
            }
        }
        
        // 6. 복구/병합된 데이터를 스토리지에 최종 저장하고 임시 파일 정리
        if (allPatches.length > 0) {
            await chrome.storage.local.set({ appState: authoritativeData });
            console.log("복구/병합된 데이터를 스토리지에 최종 저장했습니다.");
        }
        
        patchKeysProcessedInThisLoad.forEach(key => localStorage.removeItem(key));

        // 7. 최종 상태(state) 설정 및 UI 초기화
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

        } else { // 데이터가 아예 없는 초기 실행
            const now = Date.now();
            const fId = `${CONSTANTS.ID_PREFIX.FOLDER}${now}`;
            const nId = `${CONSTANTS.ID_PREFIX.NOTE}${now + 1}`;
            const newNote = { id: nId, title: "🎉 환영합니다!", content: "MothNote 에 오신 것을 환영합니다! 🦋", createdAt: now, updatedAt: now, isPinned: false, isFavorite: false };
            const newFolder = { id: fId, name: "🌟 첫 시작 폴더", notes: [newNote], createdAt: now, updatedAt: now };

            const initialAppState = {
                folders: [newFolder],
                trash: [],
                favorites: [],
                lastSavedTimestamp: now
            };
            
            setState({
                ...state,
                ...initialAppState,
                favorites: new Set(),
                activeFolderId: fId,
                activeNoteId: nId,
                totalNoteCount: 1,
            });
            
            buildNoteMap();
            await chrome.storage.local.set({ appState: initialAppState });
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


// --- 데이터 가져오기/내보내기 및 정제 로직 --- (기능 유지, 변경 없음)
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

                const importPayload = {
                    appState: {
                        folders: sanitizedContent.folders,
                        trash: sanitizedContent.trash,
                        favorites: Array.from(new Set(sanitizedContent.favorites)),
                        lastSavedTimestamp: Date.now()
                    },
                    settings: sanitizedSettings
                };

                // 임시 저장 -> 주 저장소 저장 -> 임시 저장 제거 (원자적 패턴)
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, JSON.stringify(importPayload));
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                localStorage.removeItem(CONSTANTS.LS_KEY); // 세션 초기화
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