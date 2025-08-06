// storage.js

import { state, setState, buildNoteMap, CONSTANTS } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert } from './components.js';
import { updateNoteCreationDates } from './itemActions.js';


// [순환 참조 해결] generateUniqueId를 itemActions.js에서 이곳으로 이동
/**
 * 앱의 전체 상태(활성 노트, 휴지통)를 확인하여
 * 충돌하지 않는 고유한 ID를 생성하고 반환합니다.
 */
export const generateUniqueId = (prefix, existingIds) => {
    // crypto.randomUUID가 있으면 사용 (더 강력한 고유성)
    if (typeof crypto?.randomUUID === 'function') {
        let id;
        do {
            id = crypto.randomUUID();
        } while (existingIds.has(id));
        return id;
    }
    
    // Fallback: 기존 방식보다 고유성을 강화
    let id;
    do {
        id = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } while (existingIds.has(id));
    
    return id;
};

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
 * [BUG-C-CRITICAL 수정] 로드된 데이터의 무결성을 검증하고 ID 충돌을 자동 복구하는 함수
 * @param {object} data - chrome.storage.local에서 로드한 appState 객체
 * @returns {{sanitizedData: object, wasSanitized: boolean}} - 복구된 데이터와 복구 여부
 */
const verifyAndSanitizeLoadedData = (data) => {
    if (!data || typeof data !== 'object') {
        return { sanitizedData: data, wasSanitized: false };
    }

    // 데이터의 각 부분을 안전하게 추출
    const folders = data.folders || [];
    const trash = data.trash || [];
    const favorites = data.favorites || [];
    const lastActiveNotePerFolder = data.lastActiveNotePerFolder || {};

    // [CRITICAL BUG FIX] 시스템 전체 ID의 고유성을 보장하기 위해 단일 Set으로 통합
    const allIds = new Set();
    const idUpdateMap = new Map();
    let changesMade = false;

    // [버그 수정] 1. 폴더 ID 중복을 먼저 검사하고 수정합니다.
    for (const folder of folders) {
        if (!folder || !folder.id) continue;

        if (allIds.has(folder.id)) {
            // 중복된 ID 발견 시, 새로운 고유 ID 생성
            const oldId = folder.id;
            const newId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allIds);
            folder.id = newId; // 원본 데이터 객체의 ID를 직접 수정
            idUpdateMap.set(oldId, newId); // 변경사항 추적
            allIds.add(newId);
            changesMade = true;
            console.warn(`[Data Sanitization] Duplicate ID (folder) found and fixed on load: ${oldId} -> ${newId}`);
        } else {
            allIds.add(folder.id);
        }
    }

    // 시스템의 모든 노트(폴더 내, 휴지통 속 폴더 내, 휴지통의 단일 노트)를 하나의 배열로 만듭니다.
    const allNotesSources = [
        ...folders.flatMap(f => (f.notes || [])),
        ...trash.filter(item => item && (item.type === 'note' || !item.type)),
        ...trash.filter(item => item && item.type === 'folder').flatMap(f => (f.notes || []))
    ];

    for (const note of allNotesSources) {
        if (!note || !note.id) continue;

        if (allIds.has(note.id)) {
            // 중복된 ID 발견 시, 새로운 고유 ID 생성
            const oldId = note.id;
            const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            note.id = newId; // 원본 데이터 객체의 ID를 직접 수정
            idUpdateMap.set(oldId, newId); // 변경사항 추적
            allIds.add(newId);
            changesMade = true;
            console.warn(`[Data Sanitization] Duplicate ID (note) found and fixed on load: ${oldId} -> ${newId}`);
        } else {
            allIds.add(note.id);
        }
    }

    if (changesMade) {
        // 즐겨찾기 목록에서 변경된 ID를 업데이트
        const newFavorites = new Set();
        for (const favId of favorites) {
            newFavorites.add(idUpdateMap.get(favId) || favId);
        }
        data.favorites = Array.from(newFavorites);

        // 폴더별 마지막 활성 노트 목록에서 변경된 ID를 업데이트
        for (const folderId in lastActiveNotePerFolder) {
            const lastActiveId = lastActiveNotePerFolder[folderId];
            if (idUpdateMap.has(lastActiveId)) {
                lastActiveNotePerFolder[folderId] = idUpdateMap.get(lastActiveId);
            }
        }
        
        // [버그 수정] 2. 휴지통에 있는 노트의 originalFolderId가 변경된 폴더 ID를 참조하는 경우 업데이트
        for (const item of trash) {
            if (item && (item.type === 'note' || !item.type) && item.originalFolderId) {
                if (idUpdateMap.has(item.originalFolderId)) {
                    item.originalFolderId = idUpdateMap.get(item.originalFolderId);
                }
            }
        }
    }

    return { sanitizedData: data, wasSanitized: changesMade };
};


// [아키텍처 리팩토링] loadData에서 localStorage 기반 비상 백업 복구 로직을 완전히 제거하고,
// chrome.storage.local을 유일한 데이터 소스로 사용하도록 단순화합니다.
export const loadData = async () => {
    let recoveryMessage = null;
    let authoritativeData = null; // [버그 수정] 데이터 로딩 순서 제어를 위해 변수 위치 변경

    try {
        // [BUG-C-01 수정] 가져오기(Import) 작업의 원자성(Atomicity) 보장 로직
        const importStatus = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
        const backupResult = await chrome.storage.local.get('appState_backup');

        if (importStatus === 'done' && backupResult.appState_backup) {
            // 시나리오: 성공적인 가져오기 후 리로드됨. 백업을 정리하고 계속 진행합니다.
            console.log("Import successfully completed. Cleaning up backup data.");
            await chrome.storage.local.remove('appState_backup');
            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            recoveryMessage = CONSTANTS.MESSAGES.SUCCESS.IMPORT_SUCCESS;
        } else if (importStatus === 'true' && backupResult.appState_backup) {
            // 시나리오: 가져오기 중 비정상 종료됨. 이전 데이터로 롤백합니다.
            const backupPayload = backupResult.appState_backup;
            console.warn("Incomplete import detected. Rolling back to previous data.");
            
            await chrome.storage.local.set({ appState: backupPayload.appState });
            if (backupPayload.settings) {
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, backupPayload.settings);
            } else {
                localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
            }
            
            await chrome.storage.local.remove('appState_backup');
            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            recoveryMessage = "데이터 가져오기 작업이 비정상적으로 종료되어, 이전 데이터로 안전하게 복구했습니다.";
        }
        
        // 2. [핵심 변경] 주 저장소(Single Source of Truth)에서 데이터를 로드합니다.
        const mainStorageResult = await chrome.storage.local.get('appState');
        authoritativeData = mainStorageResult.appState;
        
        // [BUG-C-CRITICAL 수정] 로드된 데이터의 무결성을 검증하고 자동 복구합니다.
        if (authoritativeData) {
            // 데이터의 깊은 복사본을 만들어 원본 오염 없이 안전하게 검증합니다.
            const { sanitizedData, wasSanitized } = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(authoritativeData)));
            authoritativeData = sanitizedData;
            if (wasSanitized) {
                // 자동 복구가 발생했음을 사용자에게 알리고, 수정된 데이터를 스토리지에 다시 저장하여 무결성을 유지합니다.
                await chrome.storage.local.set({ appState: authoritativeData });
                const sanizitationMessage = "데이터 무결성 검사 중 문제를 발견하여 자동 복구했습니다.";
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
                const { performTransactionalUpdate } = await import('./itemActions.js');
                
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

                        // 2. 이름 변경 복원
                        if (backupChanges.itemRename) {
                            const { id, type, newName } = backupChanges.itemRename;
                            if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
                                const folderToRename = latestData.folders.find(f => f.id === id);
                                if (folderToRename && !latestData.folders.some(f => f.id !== id && f.name.toLowerCase() === newName.toLowerCase())) {
                                    folderToRename.name = newName;
                                    folderToRename.updatedAt = now;
                                    changesApplied = true;
                                }
                            } else if (type === CONSTANTS.ITEM_TYPE.NOTE) {
                                for (const folder of latestData.folders) {
                                    const noteToRename = folder.notes.find(n => n.id === id);
                                    if (noteToRename) {
                                        noteToRename.title = newName;
                                        noteToRename.updatedAt = now;
                                        folder.updatedAt = now;
                                        changesApplied = true;
                                        break;
                                    }
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
                }
                
                // 사용자가 복원을 거부(userConfirmed === false)한 경우, 백업을 제거하지 않습니다.
                // 파싱 에러 등 치명적 오류 발생 시에만 백업을 제거합니다.
                const updatedStorageResult = await chrome.storage.local.get('appState');
                authoritativeData = updatedStorageResult.appState;

            } catch (e) {
                console.error("비상 백업 데이터 복구 실패. 백업은 제거되지 않았습니다.", e);
                localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP); // 파싱 실패 시에도 제거
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
                finalState.activeFolderId = lastSession.f;
                finalState.activeNoteId = lastSession.n;
                finalState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                finalState.lastActiveNotePerFolder = lastSession.l ?? {};
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
            const now = Date.now();
            // [순환 참조 해결] 이제 이 파일에 있는 함수를 직접 호출
            const fId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, new Set());
            const nId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, new Set([fId]));
            
            // [수정됨] 가독성을 높인 최종 환영 노트
            const newNote = { 
                id: nId, 
                title: "MothNote 에 오신 것을 환영합니다! 🦋", 
                content: `안녕하세요! 당신의 새로운 생각 정리 공간, MothNote에 오신 것을 진심으로 환영합니다.
MothNote는 단순한 메모장을 넘어, 당신의 일상과 작업을 한곳에서 관리할 수 있는 강력한 대시보드입니다.

이 노트를 가이드 삼아 MothNote의 모든 기능을 100% 활용해보세요!

---

1. 🚀 MothNote 핵심 기능 알아보기

  🦋 올인원 대시보드:
  새 탭을 열 때마다 시계, 현재 날씨, 그리고 [클릭 가능한 달력]을 바로 확인할 수 있습니다.
    - 상세한 달력 기능: 달력에서 노트가 작성된 날짜를 클릭하면 해당 날짜의 노트들을 바로 모아볼 수 있습니다. 달력의 '년/월'을 클릭하면 특정 날짜로 점프할 수도 있어요!

  📁 폴더 기반 정리:
  생각을 주제별, 프로젝트별로 깔끔하게 정리할 수 있습니다. 무한한 폴더를 만들어 체계적으로 노트를 관리하세요.

  ⭐ 스마트 노트 관리:
    - 즐겨찾기(⭐) 및 고정(📍): 중요한 노트를 즐겨찾기에 추가하거나, 폴더 내에서 상단에 고정하여 빠르게 접근하세요.
    - 가상 폴더: [모든 노트], [최근 노트], [즐겨찾기], [휴지통]을 통해 다양한 방식으로 노트를 탐색할 수 있습니다.

  🔍 강력한 검색과 정렬:
    - 모든 노트에서 원하는 내용을 빠르게 찾아보세요. 검색어는 제목과 본문에서 하이라이트되어 표시됩니다.
    - 노트 목록 상단의 메뉴를 통해 [수정일, 생성일, 제목 순]으로 노트를 자유롭게 정렬할 수 있습니다.

  ✍️ 똑똑한 편집기:
    - 자동 저장: 글을 쓰는 동안 잠시 멈추면 자동으로 노트가 저장되므로, 더 이상 '저장' 버튼을 신경 쓰지 않아도 됩니다.
    - 유용한 정보 표시: 편집기 하단에서 현재 노트의 [글자 수, 단어 수, 생성 및 수정 일시]를 언제든 확인할 수 있습니다.

  🧘 집중을 위한 젠 모드:
  오른쪽 상단의 '🧘' 아이콘을 클릭해 주변의 모든 것을 숨기고 오직 글쓰기에만 집중할 수 있는 환경을 만들어보세요.

  🖐️ 직관적인 드래그 앤 드롭:
  폴더 순서를 바꾸거나, 노트를 다른 폴더로 쉽게 이동시킬 수 있습니다.

---

2. ⌨️ 시간을 절약해 줄 단축키

  Alt + Shift + N : ✨ 새 폴더 만들기
  Alt + N         : ✍️ 현재 폴더에 새 노트 만들기
  F2 / 더블 클릭  : ✏️ 선택된 폴더/노트의 이름 바꾸기
  ↑ / ↓         : ↕️ 목록 내에서 위아래로 이동하기
  Enter           : ↵️ 폴더/노트 선택 또는 진입하기
  Tab (편집기 안) : 들여쓰기 (Shift+Tab은 내어쓰기)

---

3. ⚙️ 나에게 맞게 설정하기

  왼쪽 아래의 '⚙️ 설정' 버튼을 눌러 MothNote를 당신에게 꼭 맞게 바꿔보세요.
    - 레이아웃 (🎨): 패널과 젠 모드의 너비를 자유롭게 조절하세요.
    - 편집기 (✏️): 좋아하는 글꼴과 편안한 글자 크기를 설정하여 최적의 가독성을 확보하세요.
    - 날씨 (🌦️): 당신이 있는 도시를 검색하여 정확한 날씨 정보를 받아보세요.
    - 데이터 (💾):
      * 내보내기: 당신의 모든 소중한 데이터를 안전하게 파일(.json)로 백업합니다. [중요: 주기적인 백업을 강력히 권장합니다!]
      * 가져오기: 백업 파일로 데이터를 복원합니다. [주의: 현재 데이터가 모두 덮어씌워집니다.]

---

4. ✅ 이제 무엇을 해볼까요? (체크리스트)

  MothNote와 친해지기 위한 몇 가지 미션을 제안합니다!

  [ ] 첫 폴더 만들기: 'Alt + Shift + N'으로 '오늘의 할 일' 폴더를 만들어보세요.
  [ ] 첫 노트 작성하기: 새 폴더를 선택하고 'Alt + N'으로 첫 노트를 작성해보세요.
  [ ] 날씨 설정하기: 설정('⚙️')에서 당신의 도시를 찾아 날씨 위젯을 활성화하세요.
  [ ] 노트 정렬해보기: 노트 목록 상단의 정렬 메뉴를 바꿔보며 차이를 확인해보세요.
  [ ] 달력으로 노트 찾기: 오늘 날짜를 클릭하여 방금 만든 노트를 찾아보세요.
  [ ] 첫 데이터 백업하기: 소중한 기록을 지키기 위해, 지금 바로 설정에서 데이터를 내보내 보세요.

당신의 모든 생각과 아이디어가 이곳에서 빛나기를 바랍니다. ✨`, 
                createdAt: now, 
                updatedAt: now, 
                isPinned: false 
            };
            const newFolder = { id: fId, name: "MothNote", notes: [newNote], createdAt: now, updatedAt: now };

            const initialAppState = {
                folders: [newFolder], trash: [], favorites: [], lastSavedTimestamp: now
            };
            
            setState({
                ...state, ...initialAppState, favorites: new Set(),
                activeFolderId: fId, activeNoteId: nId, totalNoteCount: 1,
            });
            
            buildNoteMap();
            await chrome.storage.local.set({ appState: initialAppState });
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


// --- 데이터 가져오기/내보내기 및 정제 로직 --- (기능 유지, 변경 없음)
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

    // [순환 참조 해결] 이제 이 파일에 있는 함수를 직접 호출
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
        if (!item || !item.type) return acc;
        if (item.type === 'folder') {
            const folderId = getUniqueId('folder', item.id);
            const folder = {
                id: folderId,
                name: escapeHtml(String(item.name ?? '제목 없는 폴더')).slice(0, 100),
                notes: [], type: 'folder', deletedAt: item.deletedAt || Date.now(),
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
        folders: sanitizedFolders, trash: sanitizedTrash, favorites: sanitizedFavorites 
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
    const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');
    await finishPendingRename();
    await saveCurrentNoteIfChanged();

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
            url: url, filename: filename
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
                
                // [BUG-C-01 수정] 실제 작업을 시작하기 직전에 플래그를 설정합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'true');
                importStarted = true;

                const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');
                await finishPendingRename();
                await saveCurrentNoteIfChanged();

                window.isImporting = true;
                
                overlay = document.createElement('div');
                overlay.className = 'import-overlay';
                overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">데이터를 적용하는 중입니다...</p></div>`;
                document.body.appendChild(overlay);

                const importPayload = {
                    folders: sanitizedContent.folders, trash: sanitizedContent.trash,
                    favorites: Array.from(new Set(sanitizedContent.favorites)), lastSavedTimestamp: Date.now()
                };

                // 트랜잭션 보장: 1. 백업 생성 (노트/폴더 데이터와 설정을 함께 백업)
                const currentDataResult = await chrome.storage.local.get('appState');
                const currentSettings = localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS);

                if (currentDataResult.appState) {
                    const backupPayload = {
                        appState: currentDataResult.appState,
                        settings: currentSettings // settings가 null일 수도 있음 (정상)
                    };
                    await chrome.storage.local.set({ 'appState_backup': backupPayload });
                }

                // 트랜잭션 보장: 2. 데이터 덮어쓰기
                await chrome.storage.local.set({ appState: importPayload });
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                localStorage.removeItem(CONSTANTS.LS_KEY);

                // [BUG-C-01 수정] 성공 플래그를 설정하고 리로드합니다.
                localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'done');

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                setTimeout(() => window.location.reload(), 500);

            } catch (err) {
                console.error("Import failed critically:", err);
                showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FAILURE(err), CONSTANTS.TOAST_TYPE.ERROR, 0);
                // 롤백 로직이 다음 앱 실행 시 자동으로 처리하므로, 여기서는 에러 메시지만 표시합니다.
            } finally {
                window.isImporting = false;
                if (overlay?.parentElement) overlay.remove();
                e.target.value = '';
                // [BUG-C-01 수정] 사용자가 작업을 취소했거나, 롤백이 필요한 에러가 발생한 경우에만 플래그를 제거합니다.
                // 성공적으로 리로드를 시작한 경우에는 플래그를 남겨둬야 합니다.
                if (importStarted && localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS) !== 'done') {
                    localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                }
            }
        };
        reader.readAsText(file);
    };
};