// storage.js

// [보안 수정] 프로토타입 오염(Prototype Pollution)을 방지하기 위한 재귀적 객체 정제 함수입니다.
// 외부 JSON 데이터를 파싱한 직후 이 함수를 호출하여 '__proto__', 'constructor', 'prototype' 같은
// 위험한 키가 전역 Object 프로토타입을 오염시키는 것을 원천적으로 차단합니다.
const sanitizeObjectForPrototypePollution = (obj) => {
    if (obj === null || typeof obj !== 'object') {
        return; // 객체가 아니면 재귀를 중단합니다.
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            delete obj[key];
        }
    }

    // 객체의 모든 속성에 대해 재귀적으로 정제 함수를 호출합니다.
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            sanitizeObjectForPrototypePollution(obj[key]);
        }
    }
};

// [버그 수정] Chrome Storage API를 Promise 기반으로 사용하기 위한 래퍼 함수
// 브라우저/환경 간 호환성을 보장하고, chrome.runtime.lastError를 확인하여 모든 실패 사례를 처리합니다.
export const storageGet = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });

export const storageSet = (obj) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });

export const storageRemove = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });

// [버그 수정] 순환 참조 해결을 위해 generateUniqueId를 state.js에서 가져오도록 수정합니다.
import { state, setState, buildNoteMap, CONSTANTS, generateUniqueId } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert, showPrompt } from './components.js';
import { updateNoteCreationDates } from './itemActions.js';
// [수정] welcomeNote.js에서 환영 메시지 내용을 가져옵니다.
import { welcomeNoteContent } from './welcomeNote.js';
// [기능 추가] LunaFlowACT.js에서 노트 내용을 가져옵니다.
import { lunaFlowACTContent } from './LunaFlowACT.js';

// [기능 추가] 습관 트래커 데이터 키 상수
const HABIT_TRACKER_DATA_KEY = 'habitTrackerDataV2_integrated';


// [순환 참조 해결] generateUniqueId 함수를 state.js 파일로 이동시켰습니다.
// 이 파일에 있던 함수 정의를 완전히 삭제합니다.


// [REMOVED] 멀티탭 동기화를 위한 분산 락(Distributed Lock) 관련 함수를 모두 제거했습니다.


// 세션 상태(활성 폴더/노트 등) 저장 (기능 유지, 변경 없음)
export const saveSession = () => {
    if (window.isInitializing) return;
    try {
        localStorage.setItem(CONSTANTS.LS_KEY, JSON.stringify({
            f: state.activeFolderId,
            n: state.activeNoteId,
            s: state.noteSortOrder,
            l: state.lastActiveNotePerFolder
        }));
    } catch (e) {
        console.error("세션 저장 실패:", e);
    }
};

/**
 * [BUG-C-CRITICAL 전면 수정] 로드된 데이터의 무결성을 검증하고 ID 충돌을 자동 복구하는 함수
 * @param {object} data - chrome.storage.local에서 로드한 appState 객체
 * @returns {{sanitizedData: object, wasSanitized: boolean, idUpdateMap: Map<string, string>}} - 복구된 데이터와 복구 여부, 그리고 ID 변경 맵
 */
const verifyAndSanitizeLoadedData = (data) => {
    if (!data || typeof data !== 'object') {
        return { sanitizedData: data, wasSanitized: false, idUpdateMap: new Map() };
    }

    const folders = data.folders || [];
    const trash = data.trash || [];
    const favorites = data.favorites || [];

    const idUpdateMap = new Map();
    let changesMade = false;

    // --- 1. 모든 ID를 먼저 수집하여 완전한 중복 검사 환경을 만듭니다. ---
    const checkSet = new Set();
    
    // [BUG FIX] 무한 루프 방지를 위해 방문한 객체를 추적하는 Set을 추가합니다.
    const visited = new WeakSet();

    const fixItems = (items) => {
        if (!Array.isArray(items)) return; // items가 배열이 아닌 경우 방어
        for (const item of items) {
            if (!item || !item.id) continue;
            
            // [BUG FIX] 순환 참조가 감지되면 재귀를 중단합니다.
            if (item.type === 'folder' && visited.has(item)) {
                console.warn(`[Data Sanitization] Circular reference detected and skipped for folder ID: ${item.id}`);
                // 순환을 유발하는 notes 배열을 비워서 문제를 해결합니다.
                item.notes = []; 
                changesMade = true;
                continue; // 다음 아이템으로 넘어감
            }
            
            if (checkSet.has(item.id)) {
                // 중복 발견
                const oldId = item.id;
                const prefix = (item.type === 'folder' ? CONSTANTS.ID_PREFIX.FOLDER : CONSTANTS.ID_PREFIX.NOTE);
                // [BUG FIX] generateUniqueId에 모든 ID가 포함된 Set을 전달하여 완벽한 고유성 보장
                const newId = generateUniqueId(prefix, checkSet);
                item.id = newId;
                checkSet.add(newId); // 새로 생성된 ID도 즉시 추가
                idUpdateMap.set(oldId, newId);
                changesMade = true;
                console.warn(`[Data Sanitization] Duplicate ID found and fixed on load: ${oldId} -> ${newId}`);
            } else {
                checkSet.add(item.id);
            }

            // 폴더인 경우, 내부 노트도 재귀적으로 처리
            if (item.type === 'folder' && Array.isArray(item.notes)) {
                // [BUG FIX] 재귀 호출 전에 현재 폴더를 방문 목록에 추가합니다.
                visited.add(item);
                fixItems(item.notes);
            }
        }
    };

    fixItems(folders);
    fixItems(trash);


    // --- 2. ID 변경이 있었다면, 모든 참조를 업데이트합니다. ---
    if (changesMade) {
        // 2-1. 즐겨찾기 목록 업데이트
        const newFavorites = new Set();
        for (const favId of favorites) {
            newFavorites.add(idUpdateMap.get(favId) || favId);
        }
        data.favorites = Array.from(newFavorites);

        // 2-2. 휴지통에 있는 노트의 originalFolderId 업데이트
        for (const item of trash) {
            if (item && (item.type === 'note' || !item.type) && item.originalFolderId) {
                if (idUpdateMap.has(item.originalFolderId)) {
                    item.originalFolderId = idUpdateMap.get(item.originalFolderId);
                }
            }
        }
        
        // 2-3. 폴더별 마지막 활성 노트 ID 업데이트
        if (data.lastActiveNotePerFolder) {
            const newLastActiveMap = {};
            for (const oldFolderId in data.lastActiveNotePerFolder) {
                const newFolderId = idUpdateMap.get(oldFolderId) || oldFolderId;
                const oldNoteId = data.lastActiveNotePerFolder[oldFolderId];
                const newNoteId = idUpdateMap.get(oldNoteId) || oldNoteId;
                newLastActiveMap[newFolderId] = newNoteId;
            }
            data.lastActiveNotePerFolder = newLastActiveMap;
        }
    }

    return { sanitizedData: data, wasSanitized: changesMade, idUpdateMap };
};


// [아키텍처 리팩토링] loadData에서 localStorage 기반 비상 백업 복구 로직을 완전히 제거하고,
// chrome.storage.local을 유일한 데이터 소스로 사용하도록 단순화합니다.
export const loadData = async () => {
    let recoveryMessage = null;
    let authoritativeData = null; // [버그 수정] 데이터 로딩 순서 제어를 위해 변수 위치 변경
    // [MAJOR BUG FIX] ID 변경 내역을 저장할 맵을 선언합니다.
    let idUpdateMap = new Map();

    try {
        // [BUG-C-01 수정] 가져오기(Import) 작업의 원자성(Atomicity) 보장 로직
        const importStatus = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        const backupResult = await storageGet('appState_backup');

        if (importStatus === 'done' && backupResult.appState_backup) {
            // 시나리오: 성공적인 가져오기 후 리로드됨. 백업을 정리하고 계속 진행합니다.
            console.log("Import successfully completed. Cleaning up backup data.");
            await storageRemove('appState_backup');
            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            recoveryMessage = CONSTANTS.MESSAGES.SUCCESS.IMPORT_SUCCESS;
        } else if (importStatus === 'true' && backupResult.appState_backup) {
            // 시나리오: 가져오기 중 비정상 종료됨. 이전 데이터로 롤백합니다.
            const backupPayload = backupResult.appState_backup;
            console.warn("Incomplete import detected. Rolling back to previous data.");
            
            // --- START OF FIX ---
            // [BUG-C-CRITICAL 수정] 롤백할 백업 데이터의 무결성을 검증하고 정제합니다.
            // JSON.parse(JSON.stringify(...))로 깊은 복사본을 만들어 원본 오염 없이 안전하게 처리합니다.
            const { sanitizedData, wasSanitized } = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(backupPayload.appState || {})));
            
            if (wasSanitized) {
                console.warn("[Rollback] The backup data itself required sanitization before restoration.");
            }
            
            // 정제된 (안전한) 데이터로 롤백을 수행합니다.
            await storageSet({ appState: sanitizedData });
        
            // 설정 데이터도 안전하게 처리합니다.
            if (backupPayload.settings) {
                try {
                    // [개선] 설정 데이터도 파싱-정제 과정을 거쳐 안전하게 복원합니다.
                    const parsedSettings = JSON.parse(backupPayload.settings);
                    const sanitizedSettings = sanitizeSettings(parsedSettings);
                    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                } catch (e) {
                    // 설정 복원 실패 시, 기본값으로 돌아가도록 기존 설정을 제거합니다.
                    console.error("Failed to parse or sanitize settings from backup. Using defaults.", e);
                    localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
                }
            } else {
                localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
            }

            // [기능 추가] 습관 트래커 데이터 롤백
            if (backupPayload.habitTrackerData) {
                localStorage.setItem(HABIT_TRACKER_DATA_KEY, backupPayload.habitTrackerData);
            } else {
                localStorage.removeItem(HABIT_TRACKER_DATA_KEY);
            }
            // --- END OF FIX ---
            
            await storageRemove('appState_backup');
            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            recoveryMessage = "데이터 가져오기 작업이 비정상적으로 종료되어, 이전 데이터로 안전하게 복구했습니다.";
        } else if (importStatus === 'true' && !backupResult.appState_backup) {
            // [안전망 추가] 시나리오: 플래그는 있으나 백업이 없는 불일치 상태.
            // 이는 백업 생성 단계에서 실패했음을 의미합니다.
            console.warn("Inconsistent import state detected: Flag is 'true' but no backup found. Clearing flag to prevent deadlock.");
            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            recoveryMessage = "이전 데이터 가져오기 작업이 비정상적으로 중단되었습니다. 작업을 다시 시도해주세요.";
        }
        
        // 2. [핵심 변경] 주 저장소(Single Source of Truth)에서 데이터를 로드합니다.
        const mainStorageResult = await storageGet('appState');
        authoritativeData = mainStorageResult.appState;
        
        // [BUG-C-CRITICAL 수정 및 통합] 로드된 데이터의 무결성을 검증하고 자동 복구합니다.
        if (authoritativeData) {
            // 데이터의 깊은 복사본을 만들어 원본 오염 없이 안전하게 검증합니다.
            // [MAJOR BUG FIX] idUpdateMap을 반환받아 세션 데이터 보정에 사용합니다.
            const { sanitizedData, wasSanitized, idUpdateMap: returnedMap } = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(authoritativeData)));
            authoritativeData = sanitizedData;
            idUpdateMap = returnedMap;
            
            if (wasSanitized) {
                // 자동 복구가 발생했음을 사용자에게 알리고, 수정된 데이터를 스토리지에 다시 저장하여 무결성을 유지합니다.
                await storageSet({ appState: authoritativeData });
                const sanizitationMessage = "데이터 무결성 검사 중 문제를 발견하여 자동 복구했습니다. 앱이 정상적으로 동작합니다.";
                // recoveryMessage가 이미 있을 경우, 새 메시지를 추가합니다.
                recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${sanizitationMessage}` : sanizitationMessage;
                console.log("Sanitized data has been saved back to storage.");
            }
        }

        // --- BUG-C-02 FIX START ---
        // 비정상 종료 데이터 복구 로직 (안전한 '변경사항' 기반 복구)
        const emergencyBackupJSON = localStorage.getItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
        if (emergencyBackupJSON) {
            try {
                const backupChanges = JSON.parse(emergencyBackupJSON);
                // [보안 수정] Prototype Pollution 방지를 위해 localStorage에서 가져온 데이터를 정제합니다.
                sanitizeObjectForPrototypePollution(backupChanges);
                
                // --- [버그 수정 시작] ---
                // 비상 복구를 실행하기 전에, 데이터 정제 과정에서 변경된 ID가 있다면 비상 백업 데이터의 ID를 먼저 업데이트합니다.
                // 이렇게 하지 않으면, ID가 변경된 노트를 찾지 못해 복구가 실패할 수 있습니다.
                if (idUpdateMap.size > 0) {
                    console.log("Applying ID updates from sanitization to emergency backup data before restoration.");
                    if (backupChanges.noteUpdate?.noteId) {
                        const oldNoteId = backupChanges.noteUpdate.noteId;
                        backupChanges.noteUpdate.noteId = idUpdateMap.get(oldNoteId) || oldNoteId;
                        if (oldNoteId !== backupChanges.noteUpdate.noteId) {
                            console.warn(`Emergency backup noteId was updated due to sanitization: ${oldNoteId} -> ${backupChanges.noteUpdate.noteId}`);
                        }
                    }
                    if (backupChanges.itemRename?.id) {
                        const oldItemId = backupChanges.itemRename.id;
                        backupChanges.itemRename.id = idUpdateMap.get(oldItemId) || oldItemId;
                         if (oldItemId !== backupChanges.itemRename.id) {
                            console.warn(`Emergency backup rename itemId was updated due to sanitization: ${oldItemId} -> ${backupChanges.itemRename.id}`);
                        }
                    }
                }
                // --- [버그 수정 끝] ---

                let confirmMessage = "탭이 비정상적으로 종료되기 전, 저장되지 않은 변경사항이 발견되었습니다.<br><br>";
                
                if(backupChanges.noteUpdate) {
                    confirmMessage += `<strong>📝 노트 수정:</strong> '${backupChanges.noteUpdate.title.slice(0, 20)}...'<br>`;
                }
                if(backupChanges.itemRename) {
                    const itemTypeStr = backupChanges.itemRename.type === 'folder' ? '📁 폴더' : '📝 노트';
                    confirmMessage += `<strong>✏️ 이름 변경:</strong> ${itemTypeStr} → '${backupChanges.itemRename.newName.slice(0, 20)}...'<br>`;
                }
                confirmMessage += "<br>이 변경사항을 복원하시겠습니까?";

                const userConfirmed = await showConfirm({
                    title: '📝 저장되지 않은 변경사항 복원',
                    message: confirmMessage,
                    isHtml: true,
                    confirmText: '✅ 예, 복원합니다',
                    cancelText: '❌ 아니요, 버립니다'
                });

                if (userConfirmed) {
                    // --- [CRITICAL BUG FIX] START ---
                    // 트랜잭션 실행 전, 이름 변경 충돌을 미리 확인하고 사용자에게 해결을 요청합니다.
                    if (backupChanges.itemRename) {
                        const { id, type, newName } = backupChanges.itemRename;
                        const foldersToCheck = authoritativeData?.folders || [];
                        const isConflict = foldersToCheck.some(f => 
                            (type === 'folder' && f.id !== id && f.name.toLowerCase() === newName.toLowerCase())
                        );

                        if (isConflict) {
                            const resolvedName = await showPrompt({
                                title: '✏️ 이름 충돌 해결',
                                message: CONSTANTS.MESSAGES.ERROR.RENAME_CONFLICT_ON_RECOVERY(newName),
                                initialValue: `${newName} (복사본)`,
                                validationFn: (value) => {
                                    const trimmedValue = value.trim();
                                    if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
                                    if (foldersToCheck.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                                        return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
                                    }
                                    return { isValid: true };
                                }
                            });

                            if (resolvedName) {
                                // 사용자가 새 이름을 입력하면 백업 객체를 수정하여 복원을 계속합니다.
                                backupChanges.itemRename.newName = resolvedName.trim();
                            } else {
                                // 사용자가 취소하면 이름 변경 복원만 제외하고 나머지는 계속 진행합니다.
                                showToast(CONSTANTS.MESSAGES.ERROR.RENAME_RECOVERY_CANCELED, CONSTANTS.TOAST_TYPE.ERROR);
                                delete backupChanges.itemRename;
                            }
                        }
                    }
                    // --- [CRITICAL BUG FIX] END ---

                    const { performTransactionalUpdate } = await import('./itemActions.js');
                    const { success } = await performTransactionalUpdate(latestData => {
                        const now = Date.now();
                        let changesApplied = false;

                        // 1. 노트 내용 업데이트 복원
                        if (backupChanges.noteUpdate) {
                            const { noteId, title, content } = backupChanges.noteUpdate;
                            for (const folder of latestData.folders) {
                                const noteToUpdate = folder.notes.find(n => n.id === noteId);
                                if (noteToUpdate) {
                                    noteToUpdate.title = title;
                                    noteToUpdate.content = content;
                                    noteToUpdate.updatedAt = now;
                                    folder.updatedAt = now;
                                    changesApplied = true;
                                    break;
                                }
                            }
                        }

                        // [CRITICAL BUG FIX & COMMENT FIX] 2. 이름 변경 복원 (활성 폴더 및 휴지통 모두 검색)
                        if (backupChanges.itemRename) {
                            const { id, type, newName } = backupChanges.itemRename;
                            let itemToRename = null;
                            let parentFolder = null;

                            if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
                                // 활성 폴더 또는 휴지통에서 폴더 찾기
                                itemToRename = latestData.folders.find(f => f.id === id) || latestData.trash.find(item => item.id === id && item.type === 'folder');
                                if (itemToRename) {
                                    itemToRename.name = newName;
                                    itemToRename.updatedAt = now;
                                    changesApplied = true;
                                }
                            } else if (type === CONSTANTS.ITEM_TYPE.NOTE) {
                                // 활성 폴더들의 노트에서 먼저 검색
                                for (const folder of latestData.folders) {
                                    const note = folder.notes.find(n => n.id === id);
                                    if (note) { itemToRename = note; parentFolder = folder; break; }
                                }
                                
                                // 활성 폴더에 없으면 휴지통에서 검색 (휴지통의 최상위 또는 폴더 내부 노트)
                                if (!itemToRename) {
                                    for (const trashItem of latestData.trash) {
                                        if (trashItem.id === id && (trashItem.type === 'note' || !trashItem.type)) {
                                            itemToRename = trashItem;
                                            break;
                                        }
                                        if (trashItem.type === 'folder' && Array.isArray(trashItem.notes)) {
                                            const noteInTrashFolder = trashItem.notes.find(n => n.id === id);
                                            if (noteInTrashFolder) {
                                                itemToRename = noteInTrashFolder;
                                                break;
                                            }
                                        }
                                    }
                                }
                                
                                if (itemToRename) {
                                    itemToRename.title = newName;
                                    itemToRename.updatedAt = now;
                                    if (parentFolder) parentFolder.updatedAt = now;
                                    changesApplied = true;
                                }
                            }
                        }

                        if (changesApplied) {
                            return { newData: latestData, successMessage: '✅ 변경사항이 성공적으로 복원되었습니다.' };
                        }
                        return null; // 적용할 변경이 없으면 업데이트 취소
                    });
                    
                    if (success) {
                       // 복원에 성공했을 때만 비상 백업을 제거합니다.
                       localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                    } else {
                       showToast("복원 중 오류가 발생했습니다. 일부 변경사항이 적용되지 않았을 수 있습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                    }
                } else {
                    // [CRITICAL BUG FIX] 사용자가 복원을 거부했으므로 비상 백업을 반드시 제거하여 무한 루프를 방지합니다.
                    localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                    showToast("저장되지 않았던 변경사항을 버렸습니다.", CONSTANTS.TOAST_TYPE.SUCCESS);
                }
                
                const updatedStorageResult = await storageGet('appState');
                authoritativeData = updatedStorageResult.appState;

            } catch (e) {
                console.error("비상 백업 데이터 복구 실패. 무한 루프 방지를 위해 백업 데이터가 제거됩니다.", e);
                localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP); // 파싱 실패 시에도 제거
                showToast("저장되지 않은 변경사항을 복구하는 중 오류가 발생했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            }
        }
        // --- BUG-C-02 FIX END ---
        
        // 3. [핵심 변경] '죽은 탭'의 비상 백업(localStorage)을 수집하고 복구하는 로직을 완전히 제거합니다.
        
        // 4. 최종 상태(state) 설정 및 UI 초기화
        let finalState = { ...state };
        
        if (authoritativeData && authoritativeData.folders) { // 데이터가 있는 경우
            Object.assign(finalState, authoritativeData);
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
                // [CRITICAL BUG FIX] ID 변경 맵을 사용하여 세션 데이터의 참조 무결성을 보장합니다.
                const correctedFolderId = idUpdateMap.get(lastSession.f) || lastSession.f;
                const correctedNoteId = idUpdateMap.get(lastSession.n) || lastSession.n;

                finalState.activeFolderId = correctedFolderId;
                finalState.activeNoteId = correctedNoteId;
                finalState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                
                // lastActiveNotePerFolder 맵의 키와 값 모두 ID 변경 맵으로 보정합니다.
                const correctedLastActiveMap = {};
                if (lastSession.l) {
                    for (const oldFolderId in lastSession.l) {
                        const newFolderId = idUpdateMap.get(oldFolderId) || oldFolderId;
                        const oldNoteId = lastSession.l[oldFolderId];
                        const newNoteId = idUpdateMap.get(oldNoteId) || oldNoteId;
                        correctedLastActiveMap[newFolderId] = newNoteId;
                    }
                }
                finalState.lastActiveNotePerFolder = correctedLastActiveMap;
            } else {
                // lastSession이 없을 경우 lastActiveNotePerFolder를 초기화합니다.
                finalState.lastActiveNotePerFolder = {};
            }

            finalState.totalNoteCount = finalState.folders.reduce((sum, f) => sum + f.notes.length, 0);
            
            setState(finalState);
            buildNoteMap();

            // 순환참조를 피하기 위해 동적 임포트 사용
            const { findFolder } = await import('./state.js'); 
            const folderExists = state.folders.some(f => f.id === state.activeFolderId) || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId);
            const noteExistsInMap = state.noteMap.has(state.activeNoteId);

            if (!folderExists) {
                setState({ activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id, activeNoteId: null });
            } else if (state.activeFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id && !noteExistsInMap) {
                const { item: activeFolder } = findFolder(state.activeFolderId);
                 const firstNoteId = (activeFolder && activeFolder.notes && activeFolder.notes.length > 0)
                    ? sortNotes(activeFolder.notes, state.noteSortOrder)[0]?.id ?? null
                    : null;
                setState({ activeNoteId: firstNoteId });
            }

        } else { // 데이터가 아예 없는 초기 실행
            const now = new Date().getTime();
            const allIds = new Set(); // 생성된 ID를 추적하여 중복 방지

            // [수정] 기본 생성 폴더 목록을 수정하고 5개의 새 폴더를 상단에 추가합니다.
            const defaultFolderNames = [
                'Inbox',
                'Today',
                'A1 (Must Have)',
                'B2 (Should Have)',
                'C3 (Could Have)',
                'Projects',
                'Areas',
                'Resources',
                'Archives',
                'Future Log',
                'Monthly Log',
                'Daily Log',
                'MothNote'
            ];
            
            // [수정] 가이드 노트 생성
            const welcomeNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            allIds.add(welcomeNoteId);
            const welcomeNote = { 
                id: welcomeNoteId, 
                title: "MothNote 에 오신 것을 환영합니다! 🦋", 
                content: welcomeNoteContent, 
                createdAt: now, 
                updatedAt: now, 
                isPinned: false 
            };

            // [기능 추가] LunaFlowACT 노트 생성
            const lunaFlowNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            allIds.add(lunaFlowNoteId);
            const lunaFlowNote = {
                id: lunaFlowNoteId,
                title: "LunaFlowACT",
                content: lunaFlowACTContent,
                createdAt: now,
                updatedAt: now,
                isPinned: true // 중요하므로 고정
            };
            
            // 폴더를 순서대로 생성
            const initialFolders = defaultFolderNames.map(name => {
                const folderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allIds);
                allIds.add(folderId);

                // 'MothNote' 폴더에만 두 개의 기본 노트를 추가
                const notesForFolder = (name === 'MothNote') ? [lunaFlowNote, welcomeNote] : [];

                return {
                    id: folderId,
                    name: name,
                    notes: notesForFolder,
                    createdAt: now,
                    updatedAt: now
                };
            });
            
            // 마지막 폴더('MothNote')의 ID를 활성 폴더로 설정
            const lastFolderId = initialFolders[initialFolders.length - 1].id;

            const initialAppState = {
                folders: initialFolders, 
                trash: [], 
                favorites: [], 
                lastSavedTimestamp: now
            };
            
            const newState = {
                ...state,
                ...initialAppState,
                favorites: new Set(),
                activeFolderId: lastFolderId,
                activeNoteId: welcomeNoteId,
                totalNoteCount: 2, // 노트 2개
                lastActiveNotePerFolder: {
                    [lastFolderId]: lunaFlowNoteId
                },
            };

            // --- [BUG FIX] START ---
            // 상태 관리 원칙을 준수하도록 수정합니다.
            // 1. `setState`를 먼저 호출하여 상태를 원자적으로 업데이트합니다.
            setState(newState);
            
            // 2. [REMOVED] 이제 setState가 자동으로 buildNoteMap을 호출하므로, 이 줄은 제거합니다.
            
            // --- [BUG FIX] END ---
            
            await storageSet({ appState: initialAppState });
        }

        updateNoteCreationDates();
        saveSession();

    } catch (e) { 
        console.error("Error loading data:", e); 
        showToast("데이터 로딩 중 심각한 오류가 발생했습니다. 개발자 콘솔을 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR, 0);
    } 
    
    if (recoveryMessage) {
        return { recoveryMessage };
    }
    return { recoveryMessage: null };
};


// --- 데이터 가져오기/내보내기 및 정제 로직 ---

// [BUG FIX] chrome.downloads API 실패 시 일반 웹 다운로드 방식으로 대체하는 헬퍼 함수
const fallbackAnchorDownload = (url, filename) => {
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // DOM 정리 및 URL 해제는 다운로드가 시작될 시간을 확보한 후 비동기적으로 수행
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        showToast(CONSTANTS.MESSAGES.SUCCESS.EXPORT_SUCCESS);
    } catch (e) {
        console.error("Fallback download failed:", e);
        showToast(CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
        // 실패 시에도 메모리 누수 방지를 위해 URL을 즉시 해제
        URL.revokeObjectURL(url);
    }
};

const escapeHtml = str => {
    if (typeof str !== 'string') return '';
    const tempDiv = document.createElement('div');
    tempDiv.textContent = str;
    return tempDiv.innerHTML;
};

const sanitizeContentData = data => {
    if (!data || !Array.isArray(data.folders)) throw new Error("유효하지 않은 파일 구조입니다.");
    const usedIds = new Set();
    const idMap = new Map(); 

    // [버그 수정] 이제 state.js에서 가져온 함수를 직접 호출
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
        // [버그 수정] Number(value) || defaultValue 패턴을 Number.isFinite()로 수정
        const noteCreatedAt = Number(n.createdAt);
        const noteUpdatedAt = Number(n.updatedAt);
        const note = {
            id: noteId,
            // [버그 수정] 제목은 잠재적 HTML을 제거하기 위해 escapeHtml을 유지합니다.
            title: escapeHtml(String(n.title ?? '제목 없는 노트')).slice(0, 200),
            // [버그 수정] content는 마크다운 원본을 보존하기 위해 escapeHtml을 제거합니다.
            content: String(n.content ?? ''),
            createdAt: Number.isFinite(noteCreatedAt) ? noteCreatedAt : Date.now(),
            updatedAt: Number.isFinite(noteUpdatedAt) ? noteUpdatedAt : Date.now(),
            isPinned: !!n.isPinned,
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
        // [버그 수정] Number(value) || defaultValue 패턴을 Number.isFinite()로 수정
        const folderCreatedAt = Number(f.createdAt);
        const folderUpdatedAt = Number(f.updatedAt);
        return {
            id: folderId,
            name: escapeHtml(String(f.name ?? '제목 없는 폴더')).slice(0, 100),
            notes: notes,
            createdAt: Number.isFinite(folderCreatedAt) ? folderCreatedAt : Date.now(),
            updatedAt: Number.isFinite(folderUpdatedAt) ? folderUpdatedAt : Date.now(),
        };
    });

    const sanitizedTrash = Array.isArray(data.trash) ? data.trash.reduce((acc, item) => {
        if (!item || !item.type) return acc;
        if (item.type === 'folder') {
            const folderId = getUniqueId('folder', item.id);
            // [버그 수정] Number(value) || defaultValue 패턴을 Number.isFinite()로 수정
            const itemCreatedAt = Number(item.createdAt);
            const itemUpdatedAt = Number(item.updatedAt);
            const folder = {
                id: folderId,
                name: escapeHtml(String(item.name ?? '제목 없는 폴더')).slice(0, 100),
                notes: [], type: 'folder', deletedAt: item.deletedAt || Date.now(),
                createdAt: Number.isFinite(itemCreatedAt) ? itemCreatedAt : (item.deletedAt || Date.now()),
                updatedAt: Number.isFinite(itemUpdatedAt) ? itemUpdatedAt : (item.deletedAt || Date.now()),
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
    
    // [BUG FIX] 즐겨찾기 목록을 실제 존재하는 노트 ID만 남도록 정제합니다.
    // 1. 모든 유효한 최종 노트 ID를 수집합니다.
    const finalNoteIds = new Set();
    sanitizedFolders.forEach(folder => {
        folder.notes.forEach(note => finalNoteIds.add(note.id));
    });
    sanitizedTrash.forEach(item => {
        if (item.type === 'note') {
            finalNoteIds.add(item.id);
        } else if (item.type === 'folder' && Array.isArray(item.notes)) {
            item.notes.forEach(note => finalNoteIds.add(note.id));
        }
    });

    // 2. 원본 favorites 배열을 순회하며 유효성 검사를 수행합니다.
    const sanitizedFavorites = (Array.isArray(data.favorites) ? data.favorites : [])
        .map(oldId => idMap.get(oldId) || oldId) // ID가 변경되었다면 새 ID로 매핑하고, 아니면 기존 ID 사용
        .filter(finalId => finalNoteIds.has(finalId)); // 최종 노트 ID 목록에 존재하는 ID만 필터링

    return {
        folders: sanitizedFolders,
        trash: sanitizedTrash,
        favorites: Array.from(new Set(sanitizedFavorites)) // 중복을 제거하여 최종 반환
    };
};

export const sanitizeSettings = (settingsData) => {
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const sanitized = JSON.parse(JSON.stringify(defaults)); 

    if (!settingsData || typeof settingsData !== 'object') {
        return sanitized;
    }

    // [BUG FIX] 숫자 0이 falsy로 취급되어 기본값으로 덮어씌워지는 문제를 해결하는 헬퍼 함수
    const getNumericValue = (value, defaultValue, isFloat = false) => {
        const parsed = isFloat ? parseFloat(value) : parseInt(value, 10);
        // Number.isFinite는 null, undefined, NaN, Infinity 등을 모두 걸러내고 유효한 숫자(0 포함)만 통과시킵니다.
        return Number.isFinite(parsed) ? parsed : defaultValue;
    };

    if (settingsData.layout) {
        sanitized.layout.col1 = getNumericValue(settingsData.layout.col1, defaults.layout.col1);
        sanitized.layout.col2 = getNumericValue(settingsData.layout.col2, defaults.layout.col2);
    }
    if (settingsData.zenMode) {
        sanitized.zenMode.maxWidth = getNumericValue(settingsData.zenMode.maxWidth, defaults.zenMode.maxWidth);
    }
    if (settingsData.editor) {
        const importedFontFamily = settingsData.editor.fontFamily;
        if (importedFontFamily && typeof CSS.supports === 'function' && CSS.supports('font-family', importedFontFamily)) {
             sanitized.editor.fontFamily = importedFontFamily;
        } else {
             sanitized.editor.fontFamily = defaults.editor.fontFamily;
        }
        sanitized.editor.fontSize = getNumericValue(settingsData.editor.fontSize, defaults.editor.fontSize);
    }
    if (settingsData.weather) {
        sanitized.weather.lat = getNumericValue(settingsData.weather.lat, defaults.weather.lat, true);
        sanitized.weather.lon = getNumericValue(settingsData.weather.lon, defaults.weather.lon, true);
    }

    return sanitized;
};

// [BUG FIX & 기능 추가] 습관 트래커 데이터를 포함하도록 handleExport 함수 수정
export const handleExport = async (settings) => {
    const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');
    await finishPendingRename();
    await saveCurrentNoteIfChanged();

    try {
        // [기능 추가] localStorage에서 습관 트래커 데이터를 가져옵니다.
        const habitTrackerData = localStorage.getItem(HABIT_TRACKER_DATA_KEY);

        const dataToExport = {
            mothNoteVersion: "18.5", // [기능 추가] 백업 파일 버전 명시
            settings: settings,
            folders: state.folders,
            trash: state.trash,
            favorites: Array.from(state.favorites),
            lastSavedTimestamp: state.lastSavedTimestamp,
            // [기능 추가] 습관 트래커 데이터가 있으면 포함시킵니다.
            habitTrackerData: habitTrackerData ? JSON.parse(habitTrackerData) : null
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

        // chrome.downloads API가 사용 가능한지 확인하고 우선적으로 사용합니다.
        if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: true // 사용자에게 저장 위치를 묻는 것이 더 나은 UX입니다.
            }, (downloadId) => {
                // [핵심 수정] API 호출 후 lastError를 확인하여 실패 여부를 판단합니다.
                if (chrome.runtime.lastError) {
                    console.warn(`chrome.downloads.download API 실패: ${chrome.runtime.lastError.message}. 일반 다운로드로 전환합니다.`);
                    // API 실패 시, 권한이 없어도 동작하는 폴백(fallback) 함수를 호출합니다.
                    fallbackAnchorDownload(url, filename);
                } else {
                    // API 성공 시, 약간의 지연 후 URL을 해제하여 메모리 누수를 방지합니다.
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    showToast(CONSTANTS.MESSAGES.SUCCESS.EXPORT_SUCCESS);
                }
            });
        } else {
            // chrome.downloads API를 사용할 수 없는 환경(예: 일반 웹페이지)일 경우 즉시 폴백을 사용합니다.
            fallbackAnchorDownload(url, filename);
        }

    } catch (e) {
        console.error("내보내기 준비 중 오류 발생:", e);
        showToast(CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
    }
};


export const handleImport = async () => {
    // 실제 동작은 app.js에서 처리하므로, 여기서는 클릭 이벤트만 트리거
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
            let importStarted = false;

            try {
                const importedData = JSON.parse(event.target.result);
                // [보안 수정] Prototype Pollution 방지를 위해 파일에서 읽어온 데이터를 정제합니다.
                sanitizeObjectForPrototypePollution(importedData);

                // [기능 추가] Simplenote 백업 파일인지 확인
                if (importedData && Array.isArray(importedData.activeNotes)) {
                    const confirmSimpleImport = await showConfirm({
                        title: '📥 Simplenote 백업 가져오기',
                        message: "Simplenote 백업 파일이 감지되었습니다. 'Simplenote' 폴더를 생성하고 노트를 가져올까요? (기존 데이터는 유지됩니다)",
                        isHtml: true, confirmText: '📥 예, 가져옵니다', confirmButtonType: 'confirm'
                    });

                    if (!confirmSimpleImport) { e.target.value = ''; return; }

                    window.isImporting = true;
                    overlay = document.createElement('div');
                    overlay.className = 'import-overlay';
                    overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">Simplenote 데이터를 변환하는 중...</p></div>`;
                    document.body.appendChild(overlay);

                    const { performTransactionalUpdate } = await import('./itemActions.js');
                    const { success } = await performTransactionalUpdate((latestData) => {
                        const now = Date.now();
                        const allExistingIds = new Set();
                        latestData.folders.forEach(f => {
                            allExistingIds.add(f.id);
                            f.notes.forEach(n => allExistingIds.add(n.id));
                        });
                        latestData.trash.forEach(item => {
                           allExistingIds.add(item.id);
                           if (item.type === 'folder' && Array.isArray(item.notes)) {
                               item.notes.forEach(note => allExistingIds.add(note.id));
                           }
                        });

                        // 1. 고유한 폴더 이름 찾기
                        let folderName = "Simplenote";
                        let counter = 1;
                        while (latestData.folders.some(f => f.name === folderName)) {
                            folderName = `Simplenote (${counter++})`;
                        }

                        // 2. 새 폴더 생성
                        const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allExistingIds);
                        allExistingIds.add(newFolderId);
                        const newFolder = {
                            id: newFolderId,
                            name: folderName,
                            notes: [],
                            createdAt: now,
                            updatedAt: now
                        };

                        // 3. activeNotes를 새 폴더로 변환
                        importedData.activeNotes.forEach(note => {
                            let content = note.content || '';
                            
                            // [BUG FIX] 공백만 있는 줄을 건너뛰고 첫 번째 실제 텍스트 줄을 제목으로 사용합니다.
                            const firstNonEmptyLine = content.split('\n').find(line => line.trim() !== '');
                            const title = (firstNonEmptyLine ? firstNonEmptyLine.trim().slice(0, 100) : null) || `가져온 노트 ${new Date(note.creationDate).toLocaleDateString()}`;
                            
                            // [수정] Simplenote 태그(Tag) 정보 보존
                            if (note.tags && Array.isArray(note.tags) && note.tags.length > 0) {
                                const tagString = note.tags.map(tag => `#${tag}`).join(' ');
                                if (content.trim().length > 0) {
                                    content += `\n\n${tagString}`;
                                } else {
                                    content = tagString;
                                }
                            }

                            const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                            allExistingIds.add(newNoteId);
                            
                            newFolder.notes.push({
                                id: newNoteId,
                                title: title,
                                content: content,
                                createdAt: new Date(note.creationDate).getTime(),
                                updatedAt: new Date(note.lastModified).getTime(),
                                // [수정] 고정된 노트(Pinned Note) 상태 유지
                                isPinned: note.pinned === true
                            });
                        });
                        latestData.folders.push(newFolder);

                        // 4. trashedNotes를 휴지통으로 변환
                        if (Array.isArray(importedData.trashedNotes)) {
                            importedData.trashedNotes.forEach(note => {
                                const content = note.content || '';
                                
                                // [BUG FIX] 여기에도 동일한 제목 생성 로직을 적용합니다.
                                const firstNonEmptyLine = content.split('\n').find(line => line.trim() !== '');
                                const title = (firstNonEmptyLine ? firstNonEmptyLine.trim().slice(0, 100) : null) || `가져온 노트 ${new Date(note.creationDate).toLocaleDateString()}`;

                                const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                                allExistingIds.add(newNoteId);

                                latestData.trash.unshift({
                                    id: newNoteId,
                                    title: title,
                                    content: content,
                                    createdAt: new Date(note.creationDate).getTime(),
                                    updatedAt: new Date(note.lastModified).getTime(),
                                    isPinned: false,
                                    type: 'note',
                                    deletedAt: now,
                                    originalFolderId: null
                                });
                            });
                        }
                        
                        return { newData: latestData, successMessage: null };
                    });

                    if (success) {
                        showToast("✅ Simplenote 데이터를 성공적으로 가져왔습니다! 앱을 다시 시작합니다.", CONSTANTS.TOAST_TYPE.SUCCESS);
                        setTimeout(() => window.location.reload(), 500);
                    } else {
                        showAlert({ title: '오류', message: 'Simplenote 데이터를 가져오는 중 오류가 발생했습니다.' });
                    }
                    
                    return; // Simplenote 가져오기 로직 종료
                }
                
                // [기존 로직] MothNote 백업 파일 처리
                const sanitizedContent = sanitizeContentData(importedData);
                
                const hasSettingsInFile = importedData.settings && typeof importedData.settings === 'object';
                const sanitizedSettings = hasSettingsInFile 
                    ? sanitizeSettings(importedData.settings) 
                    : JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));

                const firstConfirm = await showConfirm({
                    title: CONSTANTS.MODAL_TITLES.IMPORT_DATA,
                    message: "가져오기를 실행하면 현재의 모든 노트와 설정이 <strong>파일의 내용으로 덮어씌워집니다.</strong><br><br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
                    isHtml: true, confirmText: '📥 가져와서 덮어쓰기', confirmButtonType: 'danger'
                });

                if (!firstConfirm) { e.target.value = ''; return; }

                if (sanitizedContent.folders.length === 0 && sanitizedContent.trash.length === 0) {
                    const finalConfirm = await showConfirm({
                        title: '⚠️ 빈 데이터 경고',
                        message: "가져올 파일에 노트나 폴더가 없습니다.<br><br>계속 진행하면 현재의 모든 데이터가 <strong>영구적으로 삭제되고 빈 상태로 초기화됩니다.</strong><br><br>정말로 모든 데이터를 지우시겠습니까?",
                        isHtml: true, confirmText: '💥 예, 모든 데이터를 삭제합니다', confirmButtonType: 'danger'
                    });
                    if (!finalConfirm) { showToast("데이터 가져오기 작업이 취소되었습니다.", CONSTANTS.TOAST_TYPE.ERROR); e.target.value = ''; return; }
                }
                
                const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');
                await finishPendingRename();
                await saveCurrentNoteIfChanged();

                const importPayload = {
                    folders: sanitizedContent.folders, trash: sanitizedContent.trash,
                    favorites: Array.from(new Set(sanitizedContent.favorites)), lastSavedTimestamp: Date.now()
                };

                // [BUG-C-01 수정 및 안정성 강화]
                // 1. 백업 생성을 먼저 시도하여 안전을 확보합니다.
                const currentDataResult = await storageGet('appState');
                const currentSettings = localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS);
                // [기능 추가] 현재 습관 트래커 데이터 백업
                const currentHabitTrackerData = localStorage.getItem(HABIT_TRACKER_DATA_KEY);

                if (currentDataResult.appState) {
                    const backupPayload = {
                        appState: currentDataResult.appState,
                        settings: currentSettings, // settings가 null일 수도 있음 (정상)
                        habitTrackerData: currentHabitTrackerData // 습관 데이터 추가
                    };
                    try {
                        await storageSet({ 'appState_backup': backupPayload });
                    } catch (err) {
                        console.error("Import failed: Could not create backup.", err);
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '데이터 백업 생성에 실패했습니다. 저장 공간이 부족할 수 있습니다. 기존 데이터는 변경되지 않았습니다.',
                            confirmText: '✅ 확인'
                        });
                        return;
                    }
                }

                // 2. 백업이 성공적으로 생성된 후에만 진행 플래그 및 UI 변경을 적용합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'true');
                importStarted = true;
                window.isImporting = true;
                
                overlay = document.createElement('div');
                overlay.className = 'import-overlay';
                overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">데이터를 적용하는 중입니다...</p></div>`;
                document.body.appendChild(overlay);

                // 3. 실제 데이터 덮어쓰기
                await storageSet({ appState: importPayload });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));

                // [기능 추가] 습관 트래커 데이터 복원
                if (importedData.habitTrackerData) {
                    localStorage.setItem(HABIT_TRACKER_DATA_KEY, JSON.stringify(importedData.habitTrackerData));
                } else {
                    // 백업 파일에 습관 데이터가 없으면 기존 데이터도 삭제하여 일관성 유지
                    localStorage.removeItem(HABIT_TRACKER_DATA_KEY);
                }

                // 4. 성공 플래그를 설정하고 리로드합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'done');

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => window.location.reload(), 500);

            } catch (err) {
                // [BUG FIX] 실패 시 즉각적인 롤백 및 사용자 피드백 로직 강화
                console.error("Import failed critically:", err);

                const backupResult = await storageGet('appState_backup');
                if (backupResult.appState_backup) {
                    // 백업이 존재하면, 즉시 복구를 시도
                    try {
                        await storageSet({ appState: backupResult.appState_backup.appState });
                        if (backupResult.appState_backup.settings) {
                            localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, backupResult.appState_backup.settings);
                        } else {
                            localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
                        }

                        // [기능 추가] 습관 트래커 데이터 롤백
                        if (backupResult.appState_backup.habitTrackerData) {
                            localStorage.setItem(HABIT_TRACKER_DATA_KEY, backupResult.appState_backup.habitTrackerData);
                        } else {
                            localStorage.removeItem(HABIT_TRACKER_DATA_KEY);
                        }
                        
                        await storageRemove('appState_backup');
                        localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);

                        let message = '가져오기 중 오류가 발생하여 작업을 중단하고 이전 데이터로 안전하게 복원했습니다.';
                        if (err && err.message && err.message.toLowerCase().includes('quota')) {
                            message = '저장 공간이 부족하여 가져오기에 실패했습니다. 이전 데이터로 안전하게 복원되었습니다.';
                        }
                        showAlert({ title: '📥 가져오기 실패', message: message, confirmText: '✅ 확인' });

                    } catch (restoreErr) {
                        console.error("CRITICAL: Failed to restore from backup during import failure.", restoreErr);
                        showAlert({
                            title: '‼️ 심각한 오류',
                            message: '가져오기 실패 후 데이터 복원 중에도 오류가 발생했습니다. 앱을 다시 시작하면 데이터가 자동 복구될 수 있습니다.',
                            confirmText: '✅ 확인'
                        });
                        // 복구마저 실패하면, 플래그를 남겨두어 다음 실행 시 loadData가 복구를 시도하도록 함
                    }
                } else {
                    // 백업이 없다면, 원본 데이터는 변경되지 않았으므로 플래그만 정리
                    localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                    showAlert({
                        title: '📥 가져오기 실패',
                        message: `알 수 없는 오류로 가져오기에 실패했습니다. 기존 데이터는 변경되지 않았습니다. (오류: ${err.message})`,
                        confirmText: '✅ 확인'
                    });
                }
            } finally {
                window.isImporting = false;
                if (overlay?.parentElement) overlay.remove();
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };
};