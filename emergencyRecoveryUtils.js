// emergencyRecoveryUtils.js
// 비정상 종료 시 localStorage에 남은 변경사항을 복구하기 전에, 허용된 필드만
// 새 객체로 복사해 손상 데이터와 프로토타입 오염 키가 복구 경로로 유입되지 않게 합니다.

export class EmergencyBackupFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EmergencyBackupFormatError';
    }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasVisibleText = value => String(value ?? '').trim().length > 0;

export const parseEmergencyBackupChanges = rawBackup => {
    let parsed;
    try {
        parsed = typeof rawBackup === 'string' ? JSON.parse(rawBackup) : rawBackup;
    } catch (error) {
        throw new EmergencyBackupFormatError('비상 백업 JSON을 해석할 수 없습니다.');
    }

    if (!isRecord(parsed)) {
        throw new EmergencyBackupFormatError('비상 백업의 최상위 형식이 올바르지 않습니다.');
    }

    const normalized = {};

    if (isRecord(parsed.noteUpdate) && hasVisibleText(parsed.noteUpdate.noteId)) {
        normalized.noteUpdate = {
            noteId: String(parsed.noteUpdate.noteId),
            title: String(parsed.noteUpdate.title ?? ''),
            content: String(parsed.noteUpdate.content ?? '')
        };

        const capturedAt = Number(parsed.noteUpdate.capturedAt);
        if (Number.isFinite(capturedAt) && capturedAt > 0) {
            normalized.noteUpdate.capturedAt = capturedAt;
        }
    }

    if (isRecord(parsed.itemRename)) {
        const id = String(parsed.itemRename.id ?? '');
        const type = String(parsed.itemRename.type ?? '');
        const newName = String(parsed.itemRename.newName ?? '').trim();
        const isSupportedType = type === 'folder' || type === 'note';

        if (hasVisibleText(id) && isSupportedType && newName) {
            normalized.itemRename = { id, type, newName };

            const capturedAt = Number(parsed.itemRename.capturedAt);
            if (Number.isFinite(capturedAt) && capturedAt > 0) {
                normalized.itemRename.capturedAt = capturedAt;
            }
        }
    }

    return normalized;
};

// 저장 완료 후 비상 백업 정리 전에 탭이 종료되면, 이미 커밋된 내용보다 오래된
// 초안이 남을 수 있습니다. 내용이 동일하거나 캡처 시점보다 저장본이 명백히 더
// 최신이면 복구 대상으로 사용하지 않아 최신 저장본의 역행을 막습니다.
export const shouldDiscardEmergencyNoteUpdate = (noteUpdate, targetNote) => {
    if (!isRecord(noteUpdate) || !isRecord(targetNote)) return false;

    const matchesSavedNote = String(noteUpdate.title ?? '') === String(targetNote.title ?? '')
        && String(noteUpdate.content ?? '') === String(targetNote.content ?? '');
    if (matchesSavedNote) return true;

    const capturedAt = Number(noteUpdate.capturedAt);
    const updatedAt = Number(targetNote.updatedAt);
    return Number.isFinite(capturedAt)
        && capturedAt > 0
        && Number.isFinite(updatedAt)
        && updatedAt > 0
        // Date.now()는 밀리초 정밀도이므로, 서로 다른 작업도 같은 시각을 가질 수 있습니다.
        // 내용이 다른데 시각까지 같다면 저장과 캡처의 선후 관계를 증명할 수 없습니다.
        // 이 모호한 초안을 폐기하면 실제 최신 입력을 잃을 수 있으므로 복구 대상으로 보존합니다.
        && capturedAt < updatedAt;
};

// 이름 변경도 노트 본문과 같은 방식으로, 이미 반영되었거나 저장본보다 오래된 비상
// 백업이면 폐기합니다. capturedAt이 없는 구버전 백업은 선후 관계를 증명할 수 없으므로
// 이름이 다른 경우에는 실제 미저장 입력일 가능성을 보존합니다.
export const shouldDiscardEmergencyItemRename = (itemRename, targetItem) => {
    if (!isRecord(itemRename) || !isRecord(targetItem)) return false;

    const newName = String(itemRename.newName ?? '').trim();
    if (!newName) return false;

    const currentName = itemRename.type === 'folder'
        ? String(targetItem.name ?? '').trim()
        : String(targetItem.title ?? '').trim();
    if (currentName === newName) return true;

    const capturedAt = Number(itemRename.capturedAt);
    const updatedAt = Number(targetItem.updatedAt);
    return Number.isFinite(capturedAt)
        && capturedAt > 0
        && Number.isFinite(updatedAt)
        && updatedAt > 0
        && capturedAt < updatedAt;
};

// 적용할 대상이 없어 트랜잭션이 의도적으로 no-op이 된 경우만 오래된 백업으로 봅니다.
// 저장 API 오류, 저장공간 부족, 잠금 실패 등 실행 오류에서는 유일한 복구 사본을 보존합니다.
export const shouldDiscardEmergencyBackupAfterTransaction = result =>
    result?.success === true || result?.failureReason === 'no-change';
