// components.js

import { state, CONSTANTS } from './state.js';

// --- DOM 요소 캐싱 ---
const getEl = id => document.getElementById(id);
export const folderList = getEl('folder-list'), noteList = getEl('note-list');
export const addFolderBtn = getEl('add-folder-btn'), addNoteBtn = getEl('add-note-btn');
export const emptyTrashBtn = getEl('empty-trash-btn');
export const notesPanelTitle = getEl('notes-panel-title');
export const searchInput = getEl('search-input'), clearSearchBtn = getEl('clear-search');
export const noteSortSelect = getEl('note-sort-select');
export const importFileInput = getEl('import-file-input');
export const editorContainer = getEl(CONSTANTS.EDITOR.DOM_IDS.container), placeholderContainer = getEl('placeholder-container');
export const noteTitleInput = getEl(CONSTANTS.EDITOR.DOM_IDS.titleInput), noteContentTextarea = getEl(CONSTANTS.EDITOR.DOM_IDS.contentTextArea), noteContentView = getEl(CONSTANTS.EDITOR.DOM_IDS.contentView);
export const editorFooter = getEl(CONSTANTS.EDITOR.DOM_IDS.footer), toastContainer = getEl('toast-container');
const modal = getEl('modal'), modalTitle = getEl('modal-title'), modalMessage = getEl('modal-message');
const modalErrorMessage = getEl('modal-error-message');
const modalForm = getEl('modal-form'), modalInput = getEl('modal-input');
const modalConfirmBtn = getEl('modal-confirm-btn'), modalCancelBtn = getEl('modal-cancel-btn');
const modalCloseBtn = getEl('modal-close-btn');
export const itemTemplate = getEl('item-template');
export const shortcutGuideBtn = getEl('shortcut-guide-btn');
export const settingsBtn = getEl('settings-btn');
export const saveStatusIndicator = getEl(CONSTANTS.EDITOR.DOM_IDS.saveStatus);
export const datePickerPopover = getEl('date-picker-popover');
export const yearInput = getEl('year-input');
export const monthInput = getEl('month-input');
export const datePickerCloseBtn = getEl('date-picker-close-btn');
export const datePickerTodayBtn = getEl('date-picker-today-btn');
export const datePickerConfirmBtn = getEl('date-picker-confirm-btn');

// --- 설정 모달 DOM 요소 캐싱 ---
export const settingsModal = getEl('settings-modal');
export const settingsModalCloseBtn = getEl('settings-modal-close-btn');
export const settingsTabs = document.querySelector('.settings-tabs');
export const settingsTabPanels = document.querySelectorAll('.settings-tab-panel');
export const settingsCol1Width = getEl('settings-col1-width');
export const settingsCol2Width = getEl('settings-col2-width');
export const settingsEditorFontFamily = getEl('settings-editor-font-family');
export const settingsEditorFontSize = getEl('settings-editor-font-size');
export const settingsWeatherLat = getEl('settings-weather-lat');
export const settingsWeatherLon = getEl('settings-weather-lon');
export const settingsWeatherCitySearch = getEl('settings-weather-city-search');
export const settingsWeatherCitySearchBtn = getEl('settings-weather-city-search-btn');
export const settingsWeatherCityResults = getEl('settings-weather-city-results');
export const settingsExportBtn = getEl('settings-export-btn');
export const settingsImportBtn = getEl('settings-import-btn');
export const settingsResetBtn = getEl('settings-reset-btn');
export const settingsSaveBtn = getEl('settings-save-btn');


// --- UI 유틸리티 ---
export const formatDate = d => {
    if (!d) return '';
    const date = new Date(d);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const timePart = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true });
    return `${year}. ${month}. ${day}. ${timePart}`;
};

export const showToast = (message, type = CONSTANTS.TOAST_TYPE.SUCCESS, duration = CONSTANTS.TOAST_DURATION) => {
    if (!toastContainer) return;

    // [BUG FIX] duration이 0이면 UI를 가리는 문제를 방지하기 위해 토스트 대신 모달(showAlert)로 처리합니다.
    // 이는 사용자의 확인이 반드시 필요한 중요한 메시지(예: 심각한 오류)에 해당합니다.
    if (duration === 0) {
        showAlert({
            title: type === CONSTANTS.TOAST_TYPE.ERROR ? '❗️ 오류' : '🔔 알림',
            message: message,
            confirmText: '✅ 확인',
        });
        return; // 여기서 함수 실행을 종료합니다.
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    if (message instanceof Node) {
        toast.appendChild(message);
    } else {
        toast.textContent = message;
    }
    
    // 이제 duration이 0인 경우는 없으므로, 해당 조건 분기(if/else)가 필요 없습니다.
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, duration);

    toastContainer.appendChild(toast);
};

// [버그 수정] 모달 이벤트 처리 로직을 표준적이고 안정적인 방식으로 전면 재작성
const _showModalInternal = ({ type, title, message = '', placeholder = '', initialValue = '', confirmText = '✅ 확인', cancelText = '❌ 취소', isHtml = false, hideConfirmButton = false, hideCancelButton = false, validationFn = null, confirmButtonType = 'confirm' }) => {
    // [BUG FIX] 모달을 열기 전, 현재 포커스를 받은 요소를 저장합니다.
    const elementToFocusOnClose = document.activeElement;

    return new Promise(resolve => {
        // --- 1. UI 설정 ---
        modalTitle.textContent = title;
        modalMessage.innerHTML = '';
        if (message instanceof Node) modalMessage.appendChild(message);
        else if (isHtml) modalMessage.innerHTML = message;
        else modalMessage.textContent = message;

        modalErrorMessage.textContent = '';
        modalErrorMessage.style.display = 'none';
        modalConfirmBtn.textContent = confirmText;
        modalCancelBtn.textContent = cancelText;
        modalConfirmBtn.className = 'modal-button ripple-effect ' + confirmButtonType;
        modalConfirmBtn.style.display = hideConfirmButton ? 'none' : 'inline-block';
        modalCancelBtn.style.display = (hideCancelButton || type === 'alert') ? 'none' : 'inline-block';
        modalCloseBtn.style.display = 'block';
        modalInput.style.display = type === CONSTANTS.MODAL_TYPE.PROMPT ? 'block' : 'none';
        modalMessage.style.display = message ? 'block' : 'none';
        modalInput.value = initialValue;
        modalInput.placeholder = placeholder;

        // --- 2. 이벤트 핸들러 정의 ---
        // 핸들러는 이 Promise 스코프 내에서 정의되어 외부 상태에 영향을 주지 않음
        let hasUserInput = false;
        const runValidation = (force = false) => {
            if (!validationFn) return true;
            const { isValid, message } = validationFn(modalInput.value);
            modalConfirmBtn.disabled = !isValid;
            if ((force || hasUserInput) && !isValid && message) {
                modalErrorMessage.textContent = message;
                modalErrorMessage.style.display = 'block';
            } else {
                modalErrorMessage.style.display = 'none';
            }
            return isValid;
        };
        
        const handleInput = () => {
            if (!hasUserInput) hasUserInput = true;
            runValidation();
        };

        // 확인 버튼 클릭 시, 유효성 검사를 통과해야만 모달을 닫도록 처리
        const handleConfirmClick = (e) => {
            if (validationFn && !runValidation(true)) {
                e.preventDefault(); // <form method="dialog">의 기본 동작(모달 닫기)을 막음
                return;
            }
            modal.close('confirm'); // 유효성 통과 시 'confirm' 값으로 모달 닫기
        };

        // 취소 관련 버튼은 항상 'cancel' 값으로 모달을 닫음
        const handleCancelClick = () => modal.close('cancel');
        
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 기본 form 제출 동작 방지
                modalConfirmBtn.click(); // 정의된 확인 버튼 로직을 그대로 실행
            } else if (e.key === 'Escape') {
                // Escape는 dialog의 기본 동작으로 cancel 이벤트와 close 이벤트를 발생시키므로,
                // handleClose가 자동으로 처리함. 여기서는 handleCancelClick을 명시적으로 호출하여 일관성 유지.
                handleCancelClick();
            }
        };

        // [핵심 안정성] 'close' 이벤트를 유일한 Promise 종료 지점으로 사용.
        // 어떤 방식(버튼 클릭, ESC 키, form 제출 등)으로든 모달이 닫히면 항상 호출됨.
        const handleClose = () => {
            // --- 4. 리스너 정리 ---
            // 이 모달 인스턴스를 위해 추가된 모든 이벤트 리스너를 깨끗하게 제거하여 메모리 누수 방지
            modalConfirmBtn.removeEventListener('click', handleConfirmClick);
            modalCancelBtn.removeEventListener('click', handleCancelClick);
            modalCloseBtn.removeEventListener('click', handleCancelClick);
            modalInput.removeEventListener('input', handleInput);
            modalInput.removeEventListener('keydown', handleKeydown);
            modal.removeEventListener('close', handleClose);
            
            // [BUG FIX] 모달이 닫힌 후, 이전에 저장해 둔 요소로 포커스를 되돌립니다.
            try {
                if (elementToFocusOnClose && typeof elementToFocusOnClose.focus === 'function') {
                    elementToFocusOnClose.focus();
                }
            } catch (e) {
                console.warn("Failed to restore focus to the previous element.", e);
            }

            // --- 5. 결과 반환 ---
            // modal.returnValue 값을 기반으로 Promise의 결과를 결정
            let result = null;
            if (modal.returnValue === 'confirm') {
                if (type === CONSTANTS.MODAL_TYPE.PROMPT) result = modalInput.value;
                else if (message instanceof Node && message.querySelector('select')) result = message.querySelector('select').value;
                else result = true;
            }
            resolve(result); // Promise를 최종적으로 해결
        };
        
        // --- 3. 리스너 연결 ---
        modalConfirmBtn.addEventListener('click', handleConfirmClick);
        modalCancelBtn.addEventListener('click', handleCancelClick);
        modalCloseBtn.addEventListener('click', handleCancelClick);
        modal.addEventListener('close', handleClose);
        
        if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
            modalInput.addEventListener('keydown', handleKeydown);
            if (validationFn) {
                modalInput.addEventListener('input', handleInput);
                runValidation(); // 초기 버튼 상태 설정
            }
        }
        
        modal.showModal();
        if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
            modalInput.focus();
            modalInput.select();
        }
    });
};

export const showAlert = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.ALERT, hideCancelButton: true });
export const showConfirm = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.CONFIRM });
export const showPrompt = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.PROMPT });

export const showFolderSelectPrompt = async ({ title, message }) => {
    const formContent = document.createElement('div');
    formContent.style.display = 'flex';
    formContent.style.flexDirection = 'column';
    formContent.style.gap = '15px';

    const messageP = document.createElement('p');
    messageP.textContent = message;
    
    const select = document.createElement('select');
    select.className = 'modal-input';

    const realFolders = state.folders.filter(folder => !Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === folder.id));
    realFolders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = `📁 ${folder.name}`;
        select.appendChild(option);
    });

    formContent.appendChild(messageP);
    formContent.appendChild(select);
    
    if (realFolders.length === 0) {
        messageP.textContent = '노트를 복원할 폴더가 없습니다. 먼저 새 폴더를 만들어주세요.';
        select.style.display = 'none';
        await showAlert({ title, message: formContent, confirmText: '✅ 확인' });
        return null;
    }

    return await _showModalInternal({
        type: CONSTANTS.MODAL_TYPE.CONFIRM, title, message: formContent,
        confirmText: '✅ 폴더 선택', cancelText: '❌ 취소'
    });
};

export const showDatePickerPopover = ({ initialDate }) => {
    return new Promise(resolve => {
        yearInput.value = initialDate.getFullYear();
        monthInput.value = initialDate.getMonth() + 1;
        datePickerPopover.style.display = 'flex';
        yearInput.focus();
        yearInput.select();

        const cleanup = (result) => {
            datePickerPopover.style.display = 'none';
            datePickerConfirmBtn.removeEventListener('click', onConfirm);
            datePickerCloseBtn.removeEventListener('click', onCancel);
            datePickerTodayBtn.removeEventListener('click', onToday);
            document.removeEventListener('click', onOutsideClick, true);
            datePickerPopover.removeEventListener('keydown', onKeydown);
            resolve(result);
        };

        const onConfirm = () => {
            const year = parseInt(yearInput.value, 10);
            const month = parseInt(monthInput.value, 10);
            if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 1900 || year > 2200) {
                showToast('🤔 유효한 년(1900-2200)과 월(1-12)을 입력해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }
            cleanup({ year, month: month - 1 });
        };
        
        const onToday = () => {
            const today = new Date();
            cleanup({ year: today.getFullYear(), month: today.getMonth() });
        };

        const onCancel = () => cleanup(null);
        const onOutsideClick = (e) => { if (!datePickerPopover.contains(e.target) && e.target.id !== 'calendar-month-year') onCancel(); };
        const onKeydown = (e) => { if (e.key === 'Enter') onConfirm(); else if (e.key === 'Escape') onCancel(); };

        datePickerConfirmBtn.addEventListener('click', onConfirm);
        datePickerCloseBtn.addEventListener('click', onCancel);
        datePickerTodayBtn.addEventListener('click', onToday);
        document.addEventListener('click', onOutsideClick, true);
        datePickerPopover.addEventListener('keydown', onKeydown);
    });
};

export const showShortcutModal = () => {
    const shortcuts = [
        { key: 'Alt + Shift + N', desc: '✨ 새 폴더 추가' },
        { key: 'Alt + N', desc: '✍️ 새 노트 추가' },
        { key: 'F2 / 더블클릭', desc: '✏️ 폴더/노트 이름 변경' },
        { key: '↑ / ↓', desc: '↕️ 폴더/노트 이동' },
		{ key: 'Enter', desc: '↵️ 폴더/노트 선택' },
        { key: '드래그 앤 드롭', desc: '🖐️ 폴더 위치 변경, 노트를 다른 폴더로 이동' },
    ];
    const list = document.createElement('ul');
    list.className = 'shortcut-list';
    shortcuts.forEach(sc => {
        const li = document.createElement('li');
        const keySpan = document.createElement('span');
        keySpan.className = 'shortcut-key';
        keySpan.textContent = sc.key;
        const descSpan = document.createElement('span');
        descSpan.className = 'shortcut-desc';
        descSpan.textContent = sc.desc;
        li.appendChild(keySpan);
        li.appendChild(descSpan);
        list.appendChild(li);
    });
    showAlert({ title: CONSTANTS.MODAL_TITLES.SHORTCUT_GUIDE, message: list, hideConfirmButton: true });
};

export const sortNotes = (notes, sortOrder) => {
    if (!notes) return [];
    const sorted = [...notes];
    sorted.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
        switch (sortOrder) {
            case 'createdAt_desc': return b.createdAt - a.createdAt;
            case 'createdAt_asc': return a.createdAt - b.createdAt;
            case 'updatedAt_asc': return a.updatedAt - b.updatedAt;
            case 'title_asc': return (a.title ?? '').localeCompare(b.title ?? '', 'ko');
            case 'title_desc': return (b.title ?? '').localeCompare(a.title ?? '', 'ko');
            case 'updatedAt_desc': default: return b.updatedAt - a.updatedAt;
        }
    });
    return sorted;
};