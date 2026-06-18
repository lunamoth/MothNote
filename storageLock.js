// storageLock.js
// appState의 read-modify-write 구간을 동일 확장 프로그램 origin의 탭 간에 직렬화합니다.

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

    // Chrome 확장 프로그램 페이지는 secure context이므로 Web Locks API를 사용할 수 있습니다.
    // 지원되지 않는 테스트/구형 환경에서는 현재 문서 안에서라도 순서를 보장하는 큐로 폴백합니다.
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return navigator.locks.request(APP_STATE_LOCK_NAME, { mode: 'exclusive' }, task);
    }

    return runWithLocalQueue(task);
};
