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
import { escapeHtml } from './sanitizer.js';
// [기능 추가] LunaFlowACT.js에서 노트 내용을 가져옵니다.
import { lunaFlowACTContent } from './LunaFlowACT.js';
import { withAppStateWriteLock } from './storageLock.js';

// [기능 추가] 습관 트래커 데이터 키 상수
const HABIT_TRACKER_DATA_KEY = 'habitTrackerDataV2_integrated';
// [기능 추가] 다이어트 챌린지 데이터 키 상수
const DIET_CHALLENGE_DATA_KEY = 'diet_pro_records'; // dietChallenge.js의 STORAGE_KEY와 일치해야 함
const DIET_CHALLENGE_SETTINGS_KEY = 'diet_pro_settings'; // dietChallenge.js의 SETTINGS_KEY와 일치해야 함


// [순환 참조 해결] generateUniqueId 함수를 state.js 파일로 이동시켰습니다.
// 이 파일에 있던 함수 정의를 완전히 삭제합니다.


// appState의 읽기-수정-쓰기는 storageLock.js의 Web Locks 기반 배타 락으로 직렬화합니다.


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


const buildDataReferenceContext = (data) => {
    const folders = Array.isArray(data?.folders) ? data.folders : [];
    const trash = Array.isArray(data?.trash) ? data.trash : [];
    const rawFavorites = data?.favorites instanceof Set
        ? Array.from(data.favorites)
        : (Array.isArray(data?.favorites) ? data.favorites : []);
    const favorites = new Set(rawFavorites.map(String));

    const noteIdsByFolder = new Map();
    const activeNoteIds = new Set();
    const trashItemIds = new Set();

    folders.forEach(folder => {
        if (!folder?.id) return;
        const folderId = String(folder.id);
        const noteIds = new Set();
        (Array.isArray(folder.notes) ? folder.notes : []).forEach(note => {
            if (!note?.id) return;
            const noteId = String(note.id);
            noteIds.add(noteId);
            activeNoteIds.add(noteId);
        });
        noteIdsByFolder.set(folderId, noteIds);
    });

    trash.forEach(item => {
        if (item?.id) trashItemIds.add(String(item.id));
    });

    return { noteIdsByFolder, activeNoteIds, trashItemIds, favorites };
};

const isValidLastActiveReference = (folderId, noteId, context) => {
    if (!folderId || !noteId) return false;

    const normalizedFolderId = String(folderId);
    const normalizedNoteId = String(noteId);

    if (context.noteIdsByFolder.has(normalizedFolderId)) {
        return context.noteIdsByFolder.get(normalizedFolderId).has(normalizedNoteId);
    }

    const { ALL, RECENT, FAVORITES, TRASH } = CONSTANTS.VIRTUAL_FOLDERS;
    if (normalizedFolderId === ALL.id || normalizedFolderId === RECENT.id) {
        return context.activeNoteIds.has(normalizedNoteId);
    }
    if (normalizedFolderId === FAVORITES.id) {
        return context.activeNoteIds.has(normalizedNoteId) && context.favorites.has(normalizedNoteId);
    }
    if (normalizedFolderId === TRASH.id) {
        return context.trashItemIds.has(normalizedNoteId);
    }
    return false;
};

const sanitizeLastActiveNoteMap = (rawMap, data, idUpdateMaps = {}, markChanged = null) => {
    const sourceMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
    if (sourceMap !== rawMap && typeof markChanged === 'function') markChanged();

    // 과거 호출부의 단일 Map도 허용하되, 새 경로에서는 폴더/노트 ID 맵을 분리해
    // 서로 다른 유형이 같은 손상 ID를 가진 경우에도 참조를 정확히 복구합니다.
    const legacyMap = idUpdateMaps instanceof Map ? idUpdateMaps : null;
    const folderIdUpdateMap = legacyMap || idUpdateMaps.folderIdUpdateMap || new Map();
    const noteIdUpdateMap = legacyMap || idUpdateMaps.noteIdUpdateMap || new Map();

    const context = buildDataReferenceContext(data);
    const cleaned = {};

    for (const [folderId, noteId] of Object.entries(sourceMap)) {
        const normalizedFolderId = String(folderId);
        const normalizedNoteId = String(noteId);
        const newFolderId = folderIdUpdateMap.get(normalizedFolderId) || normalizedFolderId;
        const newNoteId = noteIdUpdateMap.get(normalizedNoteId) || normalizedNoteId;
        if (isValidLastActiveReference(newFolderId, newNoteId, context)) {
            cleaned[newFolderId] = newNoteId;
        } else if (typeof markChanged === 'function') {
            markChanged();
        }
    }

    return cleaned;
};

const parseSimplenoteTimestamp = (value, fallback) => {
    // 숫자형 Unix 타임스탬프는 Date 문자열 파싱보다 먼저 판별해야 합니다.
    // 그렇지 않으면 초 단위 값이 밀리초로 해석되어 1970년 날짜가 됩니다.
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 100000000000 ? numeric * 1000 : numeric;
    }
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
};

/**
 * [CRITICAL FIX] 로드된 데이터의 무결성을 검증하고, 손상된 배열/객체/ID 참조를 자동 복구합니다.
 * 일반 폴더는 type 필드가 없으므로 notes 배열을 기준으로도 폴더를 판별합니다.
 * @param {object} data - chrome.storage.local에서 로드한 appState 객체
 * @returns {{sanitizedData: object, wasSanitized: boolean, folderIdUpdateMap: Map<string, string>, noteIdUpdateMap: Map<string, string>}}
 */
const verifyAndSanitizeLoadedData = (data) => {
    const emptyMaps = {
        idUpdateMap: new Map(),
        folderIdUpdateMap: new Map(),
        noteIdUpdateMap: new Map()
    };
    if (!data || typeof data !== 'object') {
        return { sanitizedData: data, wasSanitized: false, shouldNotify: false, ...emptyMaps };
    }

    const folderIdUpdateMap = new Map();
    const noteIdUpdateMap = new Map();
    const seenOriginalFolderIds = new Set();
    const seenOriginalNoteIds = new Set();
    const usedIds = new Set();
    let changesMade = false;
    let notifyChangesMade = false;
    const now = Date.now();

    const markChanged = (shouldNotify = true) => {
        changesMade = true;
        if (shouldNotify) notifyChangesMade = true;
    };
    const markMinorChanged = () => markChanged(false);
    const ensureArray = (value) => {
        if (Array.isArray(value)) return value;
        if (value !== undefined) markChanged();
        return [];
    };
    const ensureObject = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (value !== undefined) markChanged(false);
        return {};
    };
    const normalizeText = (value, fallback, maxLength) => {
        const text = String(value ?? fallback ?? '').trim();
        return text.slice(0, maxLength);
    };
    const normalizeTimestamp = (value, fallback = now, shouldNotify = true) => {
        const timestamp = Number(value);
        if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
        markChanged(shouldNotify);
        return fallback;
    };

    const normalizeId = (item, prefix, itemType) => {
        const oldId = item.id === undefined || item.id === null ? '' : String(item.id);
        const isFolder = itemType === CONSTANTS.ITEM_TYPE.FOLDER;
        const seenIds = isFolder ? seenOriginalFolderIds : seenOriginalNoteIds;
        const updateMap = isFolder ? folderIdUpdateMap : noteIdUpdateMap;
        const wasSeenInSameType = Boolean(oldId && seenIds.has(oldId));
        const collidesGlobally = Boolean(oldId && usedIds.has(oldId));
        let finalId = oldId;

        if (!finalId || collidesGlobally) {
            finalId = generateUniqueId(prefix, usedIds);
            item.id = finalId;

            // 다른 유형과 충돌한 첫 항목은 유형별 참조 맵으로 정확히 추적합니다.
            // 같은 유형 안의 중복은 어느 항목을 뜻하는지 모호하므로 첫 항목을 기준으로 유지합니다.
            if (oldId && !wasSeenInSameType && !updateMap.has(oldId)) {
                updateMap.set(oldId, finalId);
            }

            markChanged();
            console.warn(`[Data Sanitization] Invalid or duplicate ID fixed on load: ${oldId || '(empty)'} -> ${finalId}`);
        } else if (item.id !== finalId) {
            // 숫자형 등 문자열이 아닌 ID는 실제 데이터에도 문자열로 기록해 strict 비교 실패를 막습니다.
            item.id = finalId;
            markMinorChanged();
        }

        if (oldId) seenIds.add(oldId);
        usedIds.add(finalId);
        return finalId;
    };

    data.folders = ensureArray(data.folders);
    data.trash = ensureArray(data.trash);
    data.favorites = ensureArray(data.favorites);
    data.lastActiveNotePerFolder = ensureObject(data.lastActiveNotePerFolder);

    const normalizeNote = (rawNote, isTrash = false) => {
        if (!rawNote || typeof rawNote !== 'object' || Array.isArray(rawNote)) {
            markChanged();
            return null;
        }

        const note = rawNote;
        normalizeId(note, CONSTANTS.ID_PREFIX.NOTE, CONSTANTS.ITEM_TYPE.NOTE);
        note.title = normalizeText(note.title, '제목 없음', 200) || '제목 없음';
        note.content = String(note.content ?? '');
        note.createdAt = normalizeTimestamp(note.createdAt);
        note.updatedAt = normalizeTimestamp(note.updatedAt, note.createdAt);
        note.isPinned = Boolean(note.isPinned);

        if (isTrash) {
            note.type = CONSTANTS.ITEM_TYPE.NOTE;
            note.deletedAt = normalizeTimestamp(note.deletedAt, now, false);
            if (note.originalFolderId !== undefined && note.originalFolderId !== null) {
                note.originalFolderId = String(note.originalFolderId);
            }
            if ('wasFavorite' in note) note.wasFavorite = Boolean(note.wasFavorite);
        } else if (note.type !== undefined) {
            delete note.type;
            markChanged(false);
        }
        return note;
    };

    const normalizeFolder = (rawFolder, isTrash = false) => {
        if (!rawFolder || typeof rawFolder !== 'object' || Array.isArray(rawFolder)) {
            markChanged();
            return null;
        }

        const folder = rawFolder;
        normalizeId(folder, CONSTANTS.ID_PREFIX.FOLDER, CONSTANTS.ITEM_TYPE.FOLDER);
        folder.name = normalizeText(folder.name, '새 폴더', 120) || '새 폴더';
        folder.createdAt = normalizeTimestamp(folder.createdAt);
        folder.updatedAt = normalizeTimestamp(folder.updatedAt, folder.createdAt);

        const rawNotes = ensureArray(folder.notes);
        folder.notes = rawNotes
            .map(note => normalizeNote(note, isTrash))
            .filter(Boolean);

        if (isTrash) {
            folder.type = CONSTANTS.ITEM_TYPE.FOLDER;
            folder.deletedAt = normalizeTimestamp(folder.deletedAt, now, false);
        } else if (folder.type !== undefined) {
            delete folder.type;
            markChanged(false);
        }
        return folder;
    };

    data.folders = data.folders
        .map(folder => normalizeFolder(folder, false))
        .filter(Boolean);

    data.trash = data.trash
        .map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                markChanged();
                return null;
            }
            const isFolderLike = item.type === CONSTANTS.ITEM_TYPE.FOLDER || Array.isArray(item.notes);
            return isFolderLike ? normalizeFolder(item, true) : normalizeNote(item, true);
        })
        .filter(Boolean);

    const activeNoteIds = new Set();
    data.folders.forEach(folder => folder.notes.forEach(note => activeNoteIds.add(String(note.id))));

    // 즐겨찾기는 노트 ID 맵만 적용해야 폴더/노트 간 손상 ID 충돌에서도 잘못된 유형으로 이동하지 않습니다.
    data.favorites = Array.from(new Set(data.favorites
        .map(id => {
            const normalizedId = String(id);
            return noteIdUpdateMap.get(normalizedId) || normalizedId;
        })
        .filter(id => activeNoteIds.has(id))));

    data.trash.forEach(item => {
        const applyOriginalFolderFix = (note) => {
            if (note?.originalFolderId !== undefined && note.originalFolderId !== null) {
                const normalizedId = String(note.originalFolderId);
                note.originalFolderId = folderIdUpdateMap.get(normalizedId) || normalizedId;
            }
        };
        if (item?.type === CONSTANTS.ITEM_TYPE.FOLDER) item.notes.forEach(applyOriginalFolderFix);
        else applyOriginalFolderFix(item);
    });

    const typedIdMaps = { folderIdUpdateMap, noteIdUpdateMap };
    // 실제 폴더뿐 아니라 가상 폴더 세션도 정상 참조로 인정합니다.
    data.lastActiveNotePerFolder = sanitizeLastActiveNoteMap(
        data.lastActiveNotePerFolder,
        data,
        typedIdMaps,
        markMinorChanged
    );

    if (data.activeFolderId !== undefined && data.activeFolderId !== null) {
        const normalizedId = String(data.activeFolderId);
        data.activeFolderId = folderIdUpdateMap.get(normalizedId) || normalizedId;
    }
    if (data.activeNoteId !== undefined && data.activeNoteId !== null) {
        const normalizedId = String(data.activeNoteId);
        data.activeNoteId = noteIdUpdateMap.get(normalizedId) || normalizedId;
    }

    // 기존 단일 맵 소비자를 위한 호환 맵입니다. 두 유형에서 동시에 쓰인 원본 ID는 모호하므로 제외합니다.
    const idUpdateMap = new Map();
    folderIdUpdateMap.forEach((newId, oldId) => {
        if (!seenOriginalNoteIds.has(oldId)) idUpdateMap.set(oldId, newId);
    });
    noteIdUpdateMap.forEach((newId, oldId) => {
        if (!seenOriginalFolderIds.has(oldId)) idUpdateMap.set(oldId, newId);
    });

    return {
        sanitizedData: data,
        wasSanitized: changesMade,
        shouldNotify: notifyChangesMade,
        idUpdateMap,
        folderIdUpdateMap,
        noteIdUpdateMap
    };
};

// [아키텍처 리팩토링] loadData에서 localStorage 기반 비상 백업 복구 로직을 완전히 제거하고,
// chrome.storage.local을 유일한 데이터 소스로 사용하도록 단순화합니다.
export const loadData = async () => {
    let recoveryMessage = null;
    let authoritativeData = null; // [버그 수정] 데이터 로딩 순서 제어를 위해 변수 위치 변경
    // 손상 ID 복구 시 폴더와 노트 참조를 서로 다른 맵으로 추적합니다.
    let folderIdUpdateMap = new Map();
    let noteIdUpdateMap = new Map();

    try {
        // 미완료 가져오기 복구 역시 같은 appState 락 안에서 판정·복원·정리합니다.
        // 여러 새 탭이 동시에 시작되어 같은 백업을 반복 복원하는 경합을 방지합니다.
        const importRecoveryMessage = await withAppStateWriteLock(async () => {
            const importStatus = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            const backupResult = await storageGet('appState_backup');
            const backupPayload = backupResult.appState_backup;

            if (importStatus === 'done') {
                if (backupPayload) await storageRemove('appState_backup');
                // 성공 후 백업만 먼저 지워진 경우에도 완료 플래그가 영구히 남지 않게 정리합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return backupPayload ? CONSTANTS.MESSAGES.SUCCESS.IMPORT_SUCCESS : null;
            }

            if (importStatus === 'true' && backupPayload) {
                console.warn('Incomplete import detected. Rolling back to previous data.');
                const hadAppState = backupPayload.hadAppState !== undefined
                    ? backupPayload.hadAppState === true
                    : backupPayload.appState != null;

                if (hadAppState) {
                    const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(backupPayload.appState || {})));
                    await storageSet({ appState: verification.sanitizedData });
                    if (verification.wasSanitized) {
                        console.warn('[Rollback] The backup data required sanitization before restoration.');
                    }
                } else {
                    await storageRemove('appState');
                }

                if (typeof backupPayload.settings === 'string') {
                    try {
                        const parsedSettings = JSON.parse(backupPayload.settings);
                        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizeSettings(parsedSettings)));
                    } catch (settingsError) {
                        console.error('Failed to parse settings from import backup. Using defaults.', settingsError);
                        localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
                    }
                } else {
                    localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
                }

                restoreLocalStorageValue(HABIT_TRACKER_DATA_KEY, backupPayload.habitTrackerData);
                restoreLocalStorageValue(DIET_CHALLENGE_DATA_KEY, backupPayload.dietChallengeData);
                restoreLocalStorageValue(DIET_CHALLENGE_SETTINGS_KEY, backupPayload.dietChallengeSettings);

                await storageRemove('appState_backup');
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return '데이터 가져오기 작업이 비정상적으로 종료되어, 이전 데이터로 안전하게 복구했습니다.';
            }

            if (importStatus === 'true' && !backupPayload) {
                console.warn("Inconsistent import state detected: flag is 'true' but no backup exists.");
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return '이전 데이터 가져오기 작업이 비정상적으로 중단되었습니다. 작업을 다시 시도해주세요.';
            }

            return null;
        });

        if (importRecoveryMessage) recoveryMessage = importRecoveryMessage;

        // 2. 주 저장소를 탭 간 락 안에서 읽고, 무결성 보정이 필요하면 같은 락 안에서 저장합니다.
        // 오래된 탭이 검증 직후 다른 탭의 신규 변경을 덮어쓰는 read-modify-write 경합을 막습니다.
        const loadedResult = await withAppStateWriteLock(async () => {
            const mainStorageResult = await storageGet('appState');
            let loadedData = mainStorageResult.appState;
            let loadedFolderIdUpdateMap = new Map();
            let loadedNoteIdUpdateMap = new Map();
            let shouldShowRecoveryNotice = false;

            if (loadedData) {
                const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(loadedData)));
                loadedData = verification.sanitizedData;
                loadedFolderIdUpdateMap = verification.folderIdUpdateMap;
                loadedNoteIdUpdateMap = verification.noteIdUpdateMap;
                shouldShowRecoveryNotice = verification.shouldNotify;

                if (verification.wasSanitized) {
                    await storageSet({ appState: loadedData });
                    console.log('Sanitized data has been saved back to storage.');
                }
            }

            return {
                loadedData,
                loadedFolderIdUpdateMap,
                loadedNoteIdUpdateMap,
                shouldShowRecoveryNotice
            };
        });

        authoritativeData = loadedResult.loadedData;
        folderIdUpdateMap = loadedResult.loadedFolderIdUpdateMap;
        noteIdUpdateMap = loadedResult.loadedNoteIdUpdateMap;
        if (loadedResult.shouldShowRecoveryNotice) {
            const sanitizationMessage = '데이터 무결성 검사 중 문제를 발견하여 자동 복구했습니다. 앱이 정상적으로 동작합니다.';
            recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${sanitizationMessage}` : sanitizationMessage;
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
                if (folderIdUpdateMap.size > 0 || noteIdUpdateMap.size > 0) {
                    console.log("Applying typed ID updates from sanitization to emergency backup data before restoration.");
                    if (backupChanges.noteUpdate?.noteId) {
                        const oldNoteId = String(backupChanges.noteUpdate.noteId);
                        backupChanges.noteUpdate.noteId = noteIdUpdateMap.get(oldNoteId) || oldNoteId;
                        if (oldNoteId !== backupChanges.noteUpdate.noteId) {
                            console.warn(`Emergency backup noteId was updated due to sanitization: ${oldNoteId} -> ${backupChanges.noteUpdate.noteId}`);
                        }
                    }
                    if (backupChanges.itemRename?.id) {
                        const oldItemId = String(backupChanges.itemRename.id);
                        const renameMap = backupChanges.itemRename.type === CONSTANTS.ITEM_TYPE.FOLDER
                            ? folderIdUpdateMap
                            : noteIdUpdateMap;
                        backupChanges.itemRename.id = renameMap.get(oldItemId) || oldItemId;
                        if (oldItemId !== backupChanges.itemRename.id) {
                            console.warn(`Emergency backup rename itemId was updated due to sanitization: ${oldItemId} -> ${backupChanges.itemRename.id}`);
                        }
                    }
                }
                // --- [버그 수정 끝] ---

                let confirmMessage = "탭이 비정상적으로 종료되기 전, 저장되지 않은 변경사항이 발견되었습니다.<br><br>";
                
                if(backupChanges.noteUpdate) {
                    const safeTitle = escapeHtml(String(backupChanges.noteUpdate.title ?? '').slice(0, 20));
                    confirmMessage += `<strong>📝 노트 수정:</strong> '${safeTitle}...'<br>`;
                }
                if(backupChanges.itemRename) {
                    const itemTypeStr = backupChanges.itemRename.type === 'folder' ? '📁 폴더' : '📝 노트';
                    const safeNewName = escapeHtml(String(backupChanges.itemRename.newName ?? '').slice(0, 20));
                    confirmMessage += `<strong>✏️ 이름 변경:</strong> ${itemTypeStr} → '${safeNewName}...'<br>`;
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
                if (authoritativeData) {
                    const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(authoritativeData)));
                    authoritativeData = verification.sanitizedData;
                    verification.folderIdUpdateMap.forEach((newId, oldId) => folderIdUpdateMap.set(oldId, newId));
                    verification.noteIdUpdateMap.forEach((newId, oldId) => noteIdUpdateMap.set(oldId, newId));

                    if (verification.wasSanitized) {
                        await storageSet({ appState: authoritativeData });
                        console.warn('[Emergency Recovery] Recovered data required additional sanitization and was saved back to storage.');
                    }
                    if (verification.shouldNotify) {
                        const sanitizationMessage = '복구된 데이터의 무결성 검사 중 문제를 발견하여 자동 복구했습니다.';
                        recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${sanitizationMessage}` : sanitizationMessage;
                    }
                }

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
                // 세션 ID도 문자열로 정규화하고, 폴더/노트 유형에 맞는 복구 맵을 각각 적용합니다.
                const correctedFolderId = lastSession.f === undefined || lastSession.f === null
                    ? null
                    : (folderIdUpdateMap.get(String(lastSession.f)) || String(lastSession.f));
                const correctedNoteId = lastSession.n === undefined || lastSession.n === null
                    ? null
                    : (noteIdUpdateMap.get(String(lastSession.n)) || String(lastSession.n));

                finalState.activeFolderId = correctedFolderId;
                finalState.activeNoteId = correctedNoteId;
                finalState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                
                // localStorage 세션은 앱 데이터보다 자주 낡을 수 있으므로, 존재하는 폴더/노트/휴지통 항목만 남깁니다.
                finalState.lastActiveNotePerFolder = sanitizeLastActiveNoteMap(
                    lastSession.l || {},
                    finalState,
                    { folderIdUpdateMap, noteIdUpdateMap }
                );
            } else {
                // lastSession이 없을 경우 lastActiveNotePerFolder를 초기화합니다.
                finalState.lastActiveNotePerFolder = {};
            }

            finalState.totalNoteCount = finalState.folders.reduce((sum, f) => sum + (Array.isArray(f.notes) ? f.notes.length : 0), 0);
            
            setState(finalState);
            buildNoteMap();

            // 순환참조를 피하기 위해 동적 임포트 사용
            const { findFolder } = await import('./state.js'); 
            const folderExists = state.folders.some(f => f.id === state.activeFolderId) || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId);
            const noteExistsInMap = state.noteMap.has(state.activeNoteId);
            const isTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
            const trashItemExists = !state.activeNoteId || state.trash.some(item => item?.id === state.activeNoteId);

            if (!folderExists) {
                setState({ activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id, activeNoteId: null });
            } else if (isTrashView && !trashItemExists) {
                const nextTrashItem = [...state.trash].sort((a, b) => (b?.deletedAt ?? 0) - (a?.deletedAt ?? 0))[0];
                setState({ activeNoteId: nextTrashItem?.id ?? null });
            } else if (!isTrashView && !noteExistsInMap) {
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
            
            // 다른 새 탭의 초기화/첫 저장과 충돌하지 않도록 최초 데이터 생성도 같은 락을 사용합니다.
            // 저장이 성공하기 전에 메모리 상태를 먼저 바꾸지 않아, 초기 저장 실패 시 '보이지만 저장되지 않은'
            // 기본 노트가 생기는 문제도 방지합니다.
            const initializationResult = await withAppStateWriteLock(async () => {
                const latestResult = await storageGet('appState');
                if (!latestResult.appState) {
                    await storageSet({ appState: initialAppState });
                    return { appState: initialAppState, createdHere: true };
                }

                // 락을 기다리는 사이 다른 탭이 먼저 초기화했다면 그 데이터를 권위 있는 값으로 채택합니다.
                const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(latestResult.appState)));
                const latestData = verification.sanitizedData;
                if (verification.wasSanitized) await storageSet({ appState: latestData });
                return { appState: latestData, createdHere: false };
            });

            if (initializationResult.createdHere) {
                setState({
                    ...state,
                    ...initialAppState,
                    favorites: new Set(),
                    activeFolderId: lastFolderId,
                    activeNoteId: welcomeNoteId,
                    totalNoteCount: 2,
                    lastActiveNotePerFolder: { [lastFolderId]: lunaFlowNoteId }
                });
            } else {
                const latestData = initializationResult.appState;
                const folders = Array.isArray(latestData.folders) ? latestData.folders : [];
                const preferredFolder = [...folders].reverse().find(folder => Array.isArray(folder.notes) && folder.notes.length > 0)
                    || folders[0]
                    || null;
                const preferredNote = preferredFolder && Array.isArray(preferredFolder.notes)
                    ? preferredFolder.notes[0] || null
                    : null;

                setState({
                    ...state,
                    ...latestData,
                    folders,
                    trash: Array.isArray(latestData.trash) ? latestData.trash : [],
                    favorites: new Set(latestData.favorites || []),
                    activeFolderId: preferredFolder?.id || CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
                    activeNoteId: preferredNote?.id || null,
                    lastActiveNotePerFolder: sanitizeLastActiveNoteMap(latestData.lastActiveNotePerFolder || {}, latestData),
                    totalNoteCount: folders.reduce((sum, folder) => sum + (Array.isArray(folder.notes) ? folder.notes.length : 0), 0)
                });
            }
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


const sanitizeContentData = data => {
    if (!data || !Array.isArray(data.folders)) {
        throw new Error("유효하지 않은 파일 구조입니다.");
    }

    const usedIds = new Set();
    const folderIdMap = new Map();
    const noteIdMap = new Map();
    const now = Date.now();

    const normalizeTimestamp = (value, fallback = now) => {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
    };

    const getUniqueId = (prefix, id, referenceMap) => {
        const oldId = id === undefined || id === null ? '' : String(id);
        let finalId = oldId.slice(0, 50);

        if (!finalId || usedIds.has(finalId)) {
            finalId = generateUniqueId(prefix, usedIds);
        }

        usedIds.add(finalId);
        // 같은 유형 안에서 중복된 ID는 첫 번째 항목을 기준 참조로 유지합니다.
        if (oldId && !referenceMap.has(oldId)) referenceMap.set(oldId, finalId);
        return finalId;
    };

    const assertRecord = (value, label) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${label} 데이터가 올바르지 않습니다.`);
        }
    };

    const sanitizeNote = (rawNote, isTrash = false) => {
        assertRecord(rawNote, '노트');
        const noteId = getUniqueId(CONSTANTS.ID_PREFIX.NOTE, rawNote.id, noteIdMap);
        const createdAt = normalizeTimestamp(rawNote.createdAt);
        const updatedAt = normalizeTimestamp(rawNote.updatedAt, createdAt);
        const note = {
            id: noteId,
            title: String(rawNote.title ?? '제목 없는 노트').slice(0, 200),
            content: String(rawNote.content ?? ''),
            createdAt,
            updatedAt,
            isPinned: Boolean(rawNote.isPinned),
        };

        if (isTrash) {
            note.type = CONSTANTS.ITEM_TYPE.NOTE;
            note.deletedAt = normalizeTimestamp(rawNote.deletedAt);
            if (rawNote.originalFolderId !== undefined && rawNote.originalFolderId !== null) {
                note.originalFolderId = String(rawNote.originalFolderId);
            }
            // 삭제 당시 즐겨찾기였는지를 보존해야 복원 시 즐겨찾기도 함께 복구됩니다.
            if ('wasFavorite' in rawNote) note.wasFavorite = Boolean(rawNote.wasFavorite);
        }
        return note;
    };

    const sanitizeFolder = (rawFolder, isTrash = false) => {
        assertRecord(rawFolder, '폴더');
        const folderId = getUniqueId(CONSTANTS.ID_PREFIX.FOLDER, rawFolder.id, folderIdMap);
        const deletedAt = isTrash ? normalizeTimestamp(rawFolder.deletedAt) : null;
        const createdAt = normalizeTimestamp(rawFolder.createdAt, deletedAt || now);
        const updatedAt = normalizeTimestamp(rawFolder.updatedAt, createdAt);
        const folder = {
            id: folderId,
            name: String(rawFolder.name ?? '제목 없는 폴더').slice(0, 100),
            notes: Array.isArray(rawFolder.notes)
                ? rawFolder.notes.map(note => sanitizeNote(note, isTrash))
                : [],
            createdAt,
            updatedAt,
        };

        if (isTrash) {
            folder.type = CONSTANTS.ITEM_TYPE.FOLDER;
            folder.deletedAt = deletedAt;
            const originalIndex = Number(rawFolder.originalIndex);
            if (Number.isInteger(originalIndex) && originalIndex >= 0) {
                folder.originalIndex = originalIndex;
            }
        }
        return folder;
    };

    const sanitizedFolders = data.folders.map(folder => sanitizeFolder(folder, false));

    const sanitizedTrash = Array.isArray(data.trash)
        ? data.trash.reduce((acc, item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return acc;

            // 구버전 백업은 type 필드 없이 notes 배열 유무로 폴더/노트를 구분했습니다.
            const effectiveType = item.type === CONSTANTS.ITEM_TYPE.FOLDER || Array.isArray(item.notes)
                ? CONSTANTS.ITEM_TYPE.FOLDER
                : CONSTANTS.ITEM_TYPE.NOTE;

            acc.push(effectiveType === CONSTANTS.ITEM_TYPE.FOLDER
                ? sanitizeFolder(item, true)
                : sanitizeNote(item, true));
            return acc;
        }, [])
        : [];

    // 모든 폴더 ID를 먼저 수집한 뒤 원본 폴더 참조를 보정합니다. 휴지통 배열의 순서와 무관하게 동작합니다.
    const remapOriginalFolderId = note => {
        if (note?.originalFolderId === undefined || note.originalFolderId === null) return;
        const oldFolderId = String(note.originalFolderId);
        note.originalFolderId = folderIdMap.get(oldFolderId) || oldFolderId;
    };
    sanitizedTrash.forEach(item => {
        if (item.type === CONSTANTS.ITEM_TYPE.FOLDER) {
            item.notes.forEach(remapOriginalFolderId);
        } else {
            remapOriginalFolderId(item);
        }
    });

    // 즐겨찾기는 활성 노트만 가리킬 수 있습니다. 휴지통 노트의 과거 상태는 wasFavorite로 보존합니다.
    const activeNoteIds = new Set();
    sanitizedFolders.forEach(folder => {
        folder.notes.forEach(note => activeNoteIds.add(note.id));
    });

    const sanitizedFavorites = (Array.isArray(data.favorites) ? data.favorites : [])
        .map(oldId => {
            const normalizedOldId = String(oldId);
            return noteIdMap.get(normalizedOldId) || normalizedOldId;
        })
        .filter(finalId => activeNoteIds.has(finalId));

    return {
        folders: sanitizedFolders,
        trash: sanitizedTrash,
        favorites: Array.from(new Set(sanitizedFavorites))
    };
};
export const sanitizeSettings = (settingsData) => {
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const sanitized = JSON.parse(JSON.stringify(defaults));

    if (!settingsData || typeof settingsData !== 'object') {
        return sanitized;
    }

    const parseFiniteNumber = (value, defaultValue, isFloat = false) => {
        const parsed = isFloat ? Number.parseFloat(value) : Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : defaultValue;
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const getClampedNumber = (value, defaultValue, min, max, isFloat = false) =>
        clamp(parseFiniteNumber(value, defaultValue, isFloat), min, max);
    const getNumberInRangeOrDefault = (value, defaultValue, min, max, isFloat = false) => {
        const parsed = parseFiniteNumber(value, defaultValue, isFloat);
        return parsed >= min && parsed <= max ? parsed : defaultValue;
    };

    if (settingsData.layout && typeof settingsData.layout === 'object') {
        sanitized.layout.col1 = getClampedNumber(settingsData.layout.col1, defaults.layout.col1, 10, 50);
        sanitized.layout.col2 = getClampedNumber(settingsData.layout.col2, defaults.layout.col2, 10, 50);
    }
    if (settingsData.zenMode && typeof settingsData.zenMode === 'object') {
        sanitized.zenMode.maxWidth = getClampedNumber(settingsData.zenMode.maxWidth, defaults.zenMode.maxWidth, 500, 2000);
    }
    if (settingsData.editor && typeof settingsData.editor === 'object') {
        const importedFontFamily = settingsData.editor.fontFamily;
        if (typeof importedFontFamily === 'string'
            && importedFontFamily.trim()
            && typeof CSS !== 'undefined'
            && typeof CSS.supports === 'function'
            && CSS.supports('font-family', importedFontFamily)) {
            sanitized.editor.fontFamily = importedFontFamily.trim().slice(0, 300);
        }
        sanitized.editor.fontSize = getClampedNumber(settingsData.editor.fontSize, defaults.editor.fontSize, 10, 30);
    }
    if (settingsData.weather && typeof settingsData.weather === 'object') {
        // 잘못된 좌표를 극값으로 강제 보정하면 엉뚱한 지역 날씨가 표시되므로 기본 위치로 되돌립니다.
        sanitized.weather.lat = getNumberInRangeOrDefault(settingsData.weather.lat, defaults.weather.lat, -90, 90, true);
        sanitized.weather.lon = getNumberInRangeOrDefault(settingsData.weather.lon, defaults.weather.lon, -180, 180, true);
    }

    return sanitized;
};

// 데이터 작업 전에 편집기와 인라인 이름 변경을 확실히 저장합니다.
// 실패를 무시한 채 백업/가져오기를 진행하면 방금 입력한 내용이 백업에서 빠지거나 덮어써질 수 있습니다.
const flushPendingChangesForDataOperation = async (operationName) => {
    const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');

    if (!(await finishPendingRename())) {
        showToast(`이름 변경 저장에 실패하여 ${operationName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    if (!(await saveCurrentNoteIfChanged())) {
        showToast(`노트 저장에 실패하여 ${operationName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    return true;
};

// [BUG FIX & 기능 추가] 습관 트래커 및 다이어트 챌린지 데이터를 포함하도록 handleExport 함수 수정
export const handleExport = async (settings) => {
    if (!(await flushPendingChangesForDataOperation('백업'))) {
        return false;
    }

    try {
        // 탭 간 쓰기가 끝난 시점의 영구 저장 데이터를 읽어 백업합니다.
        // 현재 탭의 메모리가 오래됐더라도 다른 탭에서 만든 노트를 누락하지 않습니다.
        const persistedResult = await withAppStateWriteLock(() => storageGet('appState'));
        const persistedState = persistedResult?.appState;
        const exportState = persistedState && Array.isArray(persistedState.folders)
            ? persistedState
            : {
                folders: state.folders,
                trash: state.trash,
                favorites: Array.from(state.favorites),
                lastSavedTimestamp: state.lastSavedTimestamp
            };

        let settingsToExport = sanitizeSettings(settings);
        const storedSettings = localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS);
        if (storedSettings) {
            try { settingsToExport = sanitizeSettings(JSON.parse(storedSettings)); }
            catch (settingsError) { console.warn('저장된 설정을 읽지 못해 현재 설정을 백업합니다.', settingsError); }
        }

        // [기능 추가] localStorage에서 습관 트래커 데이터 가져오기
        const habitTrackerData = localStorage.getItem(HABIT_TRACKER_DATA_KEY);
        // [기능 추가] localStorage에서 다이어트 챌린지 데이터 가져오기
        const dietChallengeData = localStorage.getItem(DIET_CHALLENGE_DATA_KEY);
        const dietChallengeSettings = localStorage.getItem(DIET_CHALLENGE_SETTINGS_KEY);
        let habitTrackerDataForExport = null;
        if (habitTrackerData) {
            try {
                habitTrackerDataForExport = JSON.parse(habitTrackerData);
                if (habitTrackerDataForExport && typeof habitTrackerDataForExport === 'object' && !Array.isArray(habitTrackerDataForExport)) {
                    const achievements = habitTrackerDataForExport.achievements && typeof habitTrackerDataForExport.achievements === 'object'
                        ? habitTrackerDataForExport.achievements
                        : {};
                    if (!achievements.data_guardian) {
                        achievements.data_guardian = { unlockedAt: new Date().toISOString() };
                        habitTrackerDataForExport.achievements = achievements;
                        // 백업에 포함할 뿐 아니라 습관 트래커를 다시 열었을 때도 업적이 유지되도록 저장합니다.
                        localStorage.setItem(HABIT_TRACKER_DATA_KEY, JSON.stringify(habitTrackerDataForExport));
                    }
                }
            } catch (habitDataError) {
                // 일부 데이터가 손상돼도 전체 노트 백업까지 막지 않고 원문을 보존합니다.
                console.warn('습관 트래커 데이터가 올바른 JSON이 아니어서 원문 그대로 백업합니다.', habitDataError);
                habitTrackerDataForExport = habitTrackerData;
            }
        }

        const runtimeVersion = (typeof chrome !== 'undefined'
            && chrome.runtime
            && typeof chrome.runtime.getManifest === 'function')
            ? chrome.runtime.getManifest().version
            : '23.5.1';

        const dataToExport = {
            mothNoteVersion: runtimeVersion, // 실제 설치된 확장 프로그램 버전
            settings: settingsToExport,
            folders: exportState.folders || [],
            trash: exportState.trash || [],
            favorites: Array.isArray(exportState.favorites) ? exportState.favorites : [],
            lastSavedTimestamp: exportState.lastSavedTimestamp || Date.now(),
            // [기능 추가] 습관 트래커 데이터가 있으면 포함시킵니다.
            habitTrackerData: habitTrackerDataForExport,
            // [기능 추가] 다이어트 챌린지 데이터가 있으면 포함시킵니다.
            dietChallengeData: dietChallengeData, // 문자열 그대로 저장
            dietChallengeSettings: dietChallengeSettings // 문자열 그대로 저장
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
        if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: false
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

        return true;
    } catch (e) {
        console.error("내보내기 준비 중 오류 발생:", e);
        showToast(CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
};


export const handleImport = async () => {
    // 실제 동작은 app.js에서 처리하므로, 여기서는 클릭 이벤트만 트리거
    importFileInput.click();
};

const restoreLocalStorageValue = (key, value) => {
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.removeItem(key);
};

const restoreImportBackupPayload = async (backupPayload) => {
    if (!backupPayload || typeof backupPayload !== 'object') {
        throw new Error('가져오기 백업 데이터가 없습니다.');
    }

    // 새 백업은 hadAppState를 기록합니다. 구버전 백업은 appState 존재 여부로 호환 처리합니다.
    const hadAppState = backupPayload.hadAppState !== undefined
        ? backupPayload.hadAppState === true
        : backupPayload.appState != null;

    if (hadAppState && backupPayload.appState) {
        await storageSet({ appState: backupPayload.appState });
    } else {
        await storageRemove('appState');
    }

    restoreLocalStorageValue(CONSTANTS.LS_KEY_SETTINGS, backupPayload.settings);
    restoreLocalStorageValue(HABIT_TRACKER_DATA_KEY, backupPayload.habitTrackerData);
    restoreLocalStorageValue(DIET_CHALLENGE_DATA_KEY, backupPayload.dietChallengeData);
    restoreLocalStorageValue(DIET_CHALLENGE_SETTINGS_KEY, backupPayload.dietChallengeSettings);
};

export const setupImportHandler = () => {
    importFileInput.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        // 백업 파일 크기를 임의로 5MB로 제한하지 않습니다.
        // 핵심 노트 데이터는 chrome.storage.local에 저장되며, manifest의
        // unlimitedStorage 권한으로 기본 저장 용량 한도를 초과할 수 있습니다.
        // 실제 저장 실패 시에는 아래의 트랜잭션/롤백 로직이 기존 데이터를 보호합니다.
        const reader = new FileReader();
        reader.onload = async event => {
            let overlay = null;
            let importBackupCreated = false;
            let importRollbackCompleted = false;
            let importRollbackFailed = false;
            let importCommitted = false;

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
                    if (!(await flushPendingChangesForDataOperation('Simplenote 가져오기'))) return;

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
                            const createdAt = parseSimplenoteTimestamp(note.creationDate, now);
                            const updatedAt = parseSimplenoteTimestamp(note.lastModified, createdAt);
                            const firstNonEmptyLine = content.split('\n').find(line => line.trim() !== '');
                            const title = (firstNonEmptyLine ? firstNonEmptyLine.trim().slice(0, 100) : null) || `가져온 노트 ${new Date(createdAt).toLocaleDateString()}`;
                            
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
                                createdAt: createdAt,
                                updatedAt: updatedAt,
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
                                const createdAt = parseSimplenoteTimestamp(note.creationDate, now);
                                const updatedAt = parseSimplenoteTimestamp(note.lastModified, createdAt);
                                const firstNonEmptyLine = content.split('\n').find(line => line.trim() !== '');
                                const title = (firstNonEmptyLine ? firstNonEmptyLine.trim().slice(0, 100) : null) || `가져온 노트 ${new Date(createdAt).toLocaleDateString()}`;

                                const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                                allExistingIds.add(newNoteId);

                                latestData.trash.unshift({
                                    id: newNoteId,
                                    title: title,
                                    content: content,
                                    createdAt: createdAt,
                                    updatedAt: updatedAt,
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
                
                if (!(await flushPendingChangesForDataOperation('데이터 가져오기'))) return;

                const importPayload = {
                    folders: sanitizedContent.folders, trash: sanitizedContent.trash,
                    favorites: Array.from(new Set(sanitizedContent.favorites)), lastSavedTimestamp: Date.now()
                };

                // 가져오기 전체를 탭 간 appState 락 안에서 수행합니다.
                // 실패 시에도 락을 놓기 전에 원본으로 복구하여 다른 탭의 저장과 롤백이 교차하지 않게 합니다.
                const importApplied = await withAppStateWriteLock(async () => {
                    const currentDataResult = await storageGet('appState');
                    const hasCurrentAppState = Object.prototype.hasOwnProperty.call(currentDataResult, 'appState')
                        && currentDataResult.appState != null;
                    const backupPayload = {
                        hadAppState: hasCurrentAppState,
                        appState: hasCurrentAppState ? currentDataResult.appState : null,
                        settings: localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS),
                        habitTrackerData: localStorage.getItem(HABIT_TRACKER_DATA_KEY),
                        dietChallengeData: localStorage.getItem(DIET_CHALLENGE_DATA_KEY),
                        dietChallengeSettings: localStorage.getItem(DIET_CHALLENGE_SETTINGS_KEY)
                    };

                    try {
                        await storageSet({ appState_backup: backupPayload });
                        importBackupCreated = true;
                    } catch (backupError) {
                        console.error('Import failed: Could not create backup.', backupError);
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '데이터 백업 생성에 실패했습니다. 기존 데이터는 변경되지 않았습니다.',
                            confirmText: '✅ 확인'
                        });
                        return false;
                    }

                    localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'true');
                    window.isImporting = true;

                    overlay = document.createElement('div');
                    overlay.className = 'import-overlay';
                    overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">데이터를 적용하는 중입니다...</p></div>`;
                    document.body.appendChild(overlay);

                    const toStorageString = (value) => {
                        if (value == null) return null;
                        return typeof value === 'string' ? value : JSON.stringify(value);
                    };

                    try {
                        await storageSet({ appState: importPayload });
                        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));

                        restoreLocalStorageValue(HABIT_TRACKER_DATA_KEY, toStorageString(importedData.habitTrackerData));
                        restoreLocalStorageValue(DIET_CHALLENGE_DATA_KEY, toStorageString(importedData.dietChallengeData));
                        restoreLocalStorageValue(DIET_CHALLENGE_SETTINGS_KEY, toStorageString(importedData.dietChallengeSettings));

                        localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'done');
                        return true;
                    } catch (applyError) {
                        try {
                            await restoreImportBackupPayload(backupPayload);
                            await storageRemove('appState_backup');
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                            importRollbackCompleted = true;
                        } catch (restoreError) {
                            importRollbackFailed = true;
                            console.error('CRITICAL: Failed to restore import backup while lock was held.', restoreError);
                            // 백업과 진행 플래그를 남겨 다음 실행의 자동 복구가 다시 시도하도록 합니다.
                        }
                        throw applyError;
                    }
                });

                if (!importApplied) return;
                importCommitted = true;

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => window.location.reload(), 500);

            } catch (err) {
                console.error('Import failed critically:', err);

                if (importCommitted) {
                    // 데이터 적용은 완료됐고 성공 플래그도 기록되었습니다. UI 후처리 오류 때문에
                    // 이미 완료된 가져오기를 되돌리지 않고 재시작만 안내합니다.
                    showAlert({
                        title: '📥 가져오기 완료',
                        message: '데이터 적용은 완료되었지만 화면 갱신 중 오류가 발생했습니다. 새 탭을 다시 열어주세요.',
                        confirmText: '✅ 확인'
                    });
                } else if (importRollbackCompleted) {
                    let message = '가져오기 중 오류가 발생하여 이전 데이터로 안전하게 복원했습니다.';
                    if (err?.message?.toLowerCase().includes('quota')) {
                        message = '저장 공간 문제로 가져오기에 실패했으며, 이전 데이터로 안전하게 복원했습니다.';
                    }
                    showAlert({ title: '📥 가져오기 실패', message, confirmText: '✅ 확인' });
                } else if (importRollbackFailed) {
                    showAlert({
                        title: '‼️ 심각한 오류',
                        message: '가져오기 실패 후 즉시 복원하지 못했습니다. 복구 백업은 보존되어 있으며, 새 탭을 다시 열면 자동 복구를 다시 시도합니다.',
                        confirmText: '✅ 확인'
                    });
                } else if (importBackupCreated) {
                    // 잠금 내부 복구 전에 예외가 난 극단적 상황에 대한 최후의 안전망입니다.
                    try {
                        await withAppStateWriteLock(async () => {
                            const backupResult = await storageGet('appState_backup');
                            if (!backupResult.appState_backup) throw new Error('복구 백업을 찾을 수 없습니다.');
                            await restoreImportBackupPayload(backupResult.appState_backup);
                            await storageRemove('appState_backup');
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                        });
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '가져오기 중 오류가 발생하여 이전 데이터로 복원했습니다.',
                            confirmText: '✅ 확인'
                        });
                    } catch (restoreError) {
                        console.error('CRITICAL: Fallback import rollback failed.', restoreError);
                        showAlert({
                            title: '‼️ 심각한 오류',
                            message: '가져오기 복원에 실패했습니다. 복구 백업을 보존했으므로 새 탭을 다시 열어 자동 복구를 시도해주세요.',
                            confirmText: '✅ 확인'
                        });
                    }
                } else {
                    localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                    showAlert({
                        title: '📥 가져오기 실패',
                        message: `파일을 처리하지 못했습니다. 기존 데이터는 변경되지 않았습니다. (오류: ${err?.message || '알 수 없는 오류'})`,
                        confirmText: '✅ 확인'
                    });
                }
            } finally {
                window.isImporting = false;
                if (overlay?.parentElement) overlay.remove();
                e.target.value = '';
            }
        };
        reader.onerror = () => {
            console.error('Backup file read failed:', reader.error);
            showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FILE_READ_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
            e.target.value = '';
        };
        reader.readAsText(file);
    };
};
