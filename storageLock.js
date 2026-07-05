// storageLock.js

// [설계 전제 / 수정 금지선]
// 이 앱은 여러 탭에서 동일한 문서를 동시에 편집하는 것 자체를 지원하지 않고, 가정하지도 않습니다.
// 따라서 버그 수정 과정에서 cross-tab 동기화, 문서 컨텍스트 간 병합,
// localStorage lease lock, IndexedDB lock, BroadcastChannel, storage event 기반 조정 로직을 추가하지 않습니다.
// 이 모듈의 폴백은 현재 문서 컨텍스트 안의 비동기 저장 순서 보장(local Promise queue)까지만 담당합니다.

const APP_STATE_LOCK_NAME = 'mothnote-app-state-write-v1';
let localQueue = Promise.resolve();

const runWithLocalQueue = async (task) => {
    const previous = localQueue;
    let release;
    localQueue = new Promise(resolve => { release = resolve; });

    await previous;
    try {
        return await task();
    } finally {
        release();
    }
};

export const withAppStateWriteLock = async (task) => {
    if (typeof task !== 'function') {
        throw new TypeError('withAppStateWriteLock에는 함수가 필요합니다.');
    }

    // Web Locks API를 사용할 수 있으면 단일 활성 문서의 저장 경계를 직렬화하는 데 활용합니다.
    // 이 사용은 멀티탭 동시 편집 지원 계약이 아니며, API가 없거나 실패하면
    // 현재 문서 컨텍스트 안의 Promise queue로만 폴백합니다.
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return navigator.locks.request(APP_STATE_LOCK_NAME, { mode: 'exclusive' }, task);
    }

    return runWithLocalQueue(task);
};
