import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert } from './components.js';
// [수정] itemActions.js에서 updateNoteCreationDates 함수를 추가로 가져옵니다.
import { handleNoteUpdate, updateNoteCreationDates, toYYYYMMDD } from './itemActions.js';

// [HEARTBEAT] app.js의 키와 동일한 키
const HEARTBEAT_KEY = 'mothnote_active_tabs_v1';

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

        // [HEARTBEAT] 현재 살아있는 탭 목록을 가져옵니다.
        let activeTabs = {};
        try {
            activeTabs = JSON.parse(sessionStorage.getItem(HEARTBEAT_KEY) || '{}');
        } catch (e) {
            console.error("활성 탭 목록 읽기 실패:", e);
        }
        
        const allPatches = [];
        // [CRITICAL BUG FIX] 이 함수에서 성공적으로 처리한 패치 키만 추적하도록 변경
        const patchKeysProcessedInThisLoad = [];
        
        // [HEARTBEAT 수정] localStorage를 순회하며 "죽은 탭"의 백업만 수집합니다.
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX)) {
                // 키에서 tabId를 추출합니다 (접두사를 제거하여).
                const backupTabId = key.substring(CONSTANTS.LS_KEY_UNCOMMITTED_PREFIX.length).split('-')[0];
                
                // 자신의 백업이거나, 죽은 탭의 백업일 경우에만 처리 대상으로 삼습니다.
                if (backupTabId === window.tabId || !activeTabs[backupTabId]) {
                    if (!activeTabs[backupTabId]) {
                         console.warn(`죽은 탭(${backupTabId})의 백업 데이터 '${key}'를 발견했습니다. 복구를 시도합니다.`);
                    }
                    try {
                        const patchData = JSON.parse(localStorage.getItem(key));
                        if (Array.isArray(patchData)) {
                            allPatches.push(...patchData);
                            // 성공적으로 파싱하고 병합 목록에 추가한 키만 삭제 대상으로 지정합니다.
                            patchKeysProcessedInThisLoad.push(key);
                        }
                    } catch (e) {
                        console.error(`비상 백업 데이터 파싱 실패 (키: ${key}):`, e);
                        // 파싱에 실패한 키는 삭제하지 않고 남겨두어 다음 로드 시 다시 시도할 수 있도록 합니다.
                    }
                } else {
                    console.log(`활성 탭(${backupTabId})의 백업 데이터 '${key}'는 건너뜁니다.`);
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
            
            // 3-1. 패치를 아이템 ID 기준으로 그룹화합니다.
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

            // [CRITICAL BUG 수정] 3-2. 그룹화된 패치를 순회하며 복구 로직 적용
            for (const [itemId, patchGroup] of patchesByItemId.entries()) {
                let itemToUpdate = null, isInTrash = false;
                
                // 기준 데이터에서 아이템 위치 찾기
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

                // 타임스탬프 순으로 패치 정렬 (최신이 마지막에 오도록)
                const getTimestamp = p => p.timestamp || p.data?.updatedAt || 0;
                patchGroup.sort((a, b) => getTimestamp(a) - getTimestamp(b));
                
                // Case 1: 아이템이 기준 데이터에 존재하는 경우 (일반적인 패치 적용)
                if (itemToUpdate) {
                    let isFirstPatchApplied = false;
                    
                    for (const patch of patchGroup) {
                        const { type, data, newName, timestamp, itemType } = patch;
                        const itemLastUpdated = itemToUpdate.updatedAt || 0;
                        const patchTimestamp = timestamp || data?.updatedAt || 0;
                        
                        // 첫 번째 패치이거나, 기준 데이터보다 최신인 경우 적용
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
                        // 첫 번째 패치가 적용되었거나, 기준 데이터와 내용이 충돌하는 후속 패치들
                        // -> 모두 별도의 충돌 복구 노트로 생성하여 데이터 유실 방지
                        else {
                            if (type === 'note_patch' && data && !isInTrash) {
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
                // Case 2: 아이템이 기준 데이터에 없음 (연결 끊긴 패치).
                // 사용자의 마지막 편집 내용을 유실하지 않도록, 이 데이터를 새 노트로 안전하게 복구합니다.
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
                        
                        // 모든 연결 끊긴 노트 패치를 각각 별도의 노트로 복구
                        for (const note_patch of notePatches) {
                             const recoveredNote = {
                                ...note_patch.data,
                                id: `${itemId}-unlinked-${Date.now()}-${Math.random()}`, // 새 고유 ID 생성
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
        
        // --- 4. 복구된 데이터를 최종 저장하고 임시 파일 정리 ---
        if (authoritativeData !== mainData) {
            await chrome.storage.local.set({ appState: authoritativeData });
            console.log("복구/병합된 데이터를 스토리지에 최종 저장했습니다.");
        }
        
        localStorage.removeItem(CONSTANTS.LS_KEY_IN_FLIGHT_TX);
        
        // [HEARTBEAT 수정] 이 부분은 이제 "죽은 탭"과 "자기 자신"의 백업만 안전하게 정리합니다.
        patchKeysProcessedInThisLoad.forEach(key => localStorage.removeItem(key));

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
        // [CRITICAL BUG 수정] 복구 메시지에 줄바꿈이 포함될 수 있으므로, pre-wrap 스타일을 적용
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
            let overlay = null;
            // [버그 수정] 락 획득 여부를 추적하는 플래그를 추가합니다.
            let lockAcquired = false;

            try {
                const importedData = JSON.parse(event.target.result);
                const sanitizedContent = sanitizeContentData(importedData);
                
                const hasSettingsInFile = importedData.settings && typeof importedData.settings === 'object';
                const sanitizedSettings = hasSettingsInFile 
                    ? sanitizeSettings(importedData.settings) 
                    : JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));

                // [버그 수정] 락 획득 전에 모든 사용자 확인 절차를 먼저 수행합니다.
                const firstConfirm = await showConfirm({
                    title: CONSTANTS.MODAL_TITLES.IMPORT_DATA,
                    message: "가져오기를 실행하면 현재의 모든 노트와 설정이 <strong>파일의 내용으로 덮어씌워집니다.</strong><br><br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
                    isHtml: true,
                    confirmText: '📥 가져와서 덮어쓰기',
                    confirmButtonType: 'danger'
                });

                if (!firstConfirm) {
                    e.target.value = ''; // 사용자가 취소하면 락 획득 없이 즉시 종료
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
                        e.target.value = ''; // 사용자가 취소하면 락 획득 없이 즉시 종료
                        return;
                    }
                }

                // [버그 수정] 모든 사용자 확인이 끝난 후, 실제 데이터 쓰기 직전에 락을 획득합니다.
                if (!(await acquireWriteLock(window.tabId))) {
                    showToast("다른 탭에서 작업을 처리 중입니다. 잠시 후 다시 시도해주세요.", CONSTANTS.TOAST_TYPE.ERROR);
                    e.target.value = '';
                    return;
                }
                lockAcquired = true; // 락 획득 성공 플래그 설정

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

                // 1. 실제 데이터를 덮어쓰기 전, 복구를 위한 플래그를 localStorage에 저장합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, JSON.stringify(importPayload));

                // 2. 실제 데이터 덮어쓰기 작업을 수행합니다. (이제 락으로 보호됩니다)
                await chrome.storage.local.set({ appState: importPayload.appState });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                
                // 3. 모든 작업이 성공적으로 끝난 후, 세션 정보와 복구 플래그를 정리합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY);
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => {
                    window.location.reload();
                }, 500);

            } catch (err) {
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR);
            } finally {
                // [버그 수정] 락을 성공적으로 획득한 경우에만 해제를 시도합니다.
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