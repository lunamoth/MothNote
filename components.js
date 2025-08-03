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
export const noteTitleInput = getEl(CONSTANTS.EDITOR.DOM_IDS.titleInput), noteContentTextarea = getEl(CONSTANTS.EDITOR.DOM_IDS.contentTextArea);
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
// [수정] 캐싱 요소 변경
export const datePickerCloseBtn = getEl('date-picker-close-btn');
export const datePickerTodayBtn = getEl('date-picker-today-btn');
export const datePickerConfirmBtn = getEl('date-picker-confirm-btn');

// --- 설정 모달 DOM 요소 캐싱 ---
export const settingsModal = getEl('settings-modal');
export const settingsModalCloseBtn = getEl('settings-modal-close-btn');
export const settingsTabs = document.querySelector('.settings-tabs');
export const settingsTabPanels = document.querySelectorAll('.settings-tab-panel');
export const settingsCol1Width = getEl('settings-col1-width');
export const settingsCol1Value = getEl('settings-col1-value');
export const settingsCol2Width = getEl('settings-col2-width');
export const settingsCol2Value = getEl('settings-col2-value');
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
    const date = new Date(d);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    const timePart = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true });

    return `${year}. ${month}. ${day}. ${timePart}`;
};

export const showToast = (message, type = CONSTANTS.TOAST_TYPE.SUCCESS) => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), CONSTANTS.TOAST_DURATION);
};

const _showModalInternal = ({ type, title, message = '', placeholder = '', initialValue = '', confirmText = '✅ 확인', cancelText = '❌ 취소', isHtml = false, hideConfirmButton = false, hideCancelButton = false, validationFn = null, confirmButtonType = 'confirm' }) => {
    return new Promise(resolve => {
        modalTitle.textContent = title;
        
        modalMessage.innerHTML = '';
        if (message instanceof Node) {
            modalMessage.appendChild(message);
        } else if (isHtml) {
            modalMessage.innerHTML = message;
        } else {
            modalMessage.textContent = message;
        }

        modalErrorMessage.textContent = '';
        modalErrorMessage.style.display = 'none';

        modalConfirmBtn.textContent = confirmText;
        modalCancelBtn.textContent = cancelText;

        modalConfirmBtn.classList.remove('confirm', 'danger');
        modalConfirmBtn.classList.add(confirmButtonType);

        if (hideConfirmButton) {
            modalConfirmBtn.style.display = 'none';
        } else {
            modalConfirmBtn.style.display = 'inline-block';
        }
        
        if (hideCancelButton || type === 'alert') {
            modalCancelBtn.style.display = 'none';
        } else {
            modalCancelBtn.style.display = 'inline-block';
        }

        modalCloseBtn.style.display = 'block';

        modalInput.style.display = type === CONSTANTS.MODAL_TYPE.PROMPT ? 'block' : 'none';
        modalMessage.style.display = message ? 'block' : 'none';
        
        modalInput.value = initialValue;
        modalInput.placeholder = placeholder;
        
        let cleanupSpecificListeners = () => {};

        const handleCloseClick = () => modal.close('cancel');
        modalCloseBtn.addEventListener('click', handleCloseClick);

        if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
            let hasUserInput = false;

            const runValidation = (force = false) => {
                if (!validationFn) return true;
                
                const { isValid, message } = validationFn(modalInput.value);
                modalConfirmBtn.disabled = !isValid;

                if ((force || hasUserInput) && !isValid && message) {
                    modalErrorMessage.textContent = message;
                    modalErrorMessage.style.display = 'block';
                } else {
                    modalErrorMessage.textContent = '';
                    modalErrorMessage.style.display = 'none';
                }
                return isValid;
            };

            const handleInputKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    modalConfirmBtn.click();
                } else if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    modalConfirmBtn.focus();
                }
            };
            modalInput.addEventListener('keydown', handleInputKeydown);
            
            const handleInput = () => {
                if (!hasUserInput) hasUserInput = true;
                runValidation();
            };
            
            const handleConfirmClick = (e) => {
                if (validationFn && !runValidation(true)) {
                    e.preventDefault();
                }
            };

            if (validationFn) {
                modalInput.addEventListener('input', handleInput);
                modalConfirmBtn.addEventListener('click', handleConfirmClick);
            }

            cleanupSpecificListeners = () => {
                modalInput.removeEventListener('keydown', handleInputKeydown);
                if (validationFn) {
                    modalInput.removeEventListener('input', handleInput);
                    modalConfirmBtn.removeEventListener('click', handleConfirmClick);
                }
            };
            
            modalConfirmBtn.disabled = false;
        }
        
        modal.showModal();
        if (type === CONSTANTS.MODAL_TYPE.PROMPT) modalInput.focus();

        const handleClose = () => {
            modal.removeEventListener('close', handleClose);
            modalCloseBtn.removeEventListener('click', handleCloseClick);
            cleanupSpecificListeners();
            
            if (modal.returnValue === 'cancel') {
                resolve(null);
                return;
            }

            if (modal.returnValue === 'confirm') {
                if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
                    resolve(modalInput.value);
                } else if (message instanceof Node && message.querySelector('select')) {
                    resolve(message.querySelector('select').value);
                } else {
                    resolve(true);
                }
            } else {
                resolve(null);
            }
        };
        modal.addEventListener('close', handleClose);
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

    const realFolders = state.folders.filter(folder => 
        !Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === folder.id)
    );

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
        await showAlert({
            title,
            message: formContent,
            confirmText: '✅ 확인',
        });
        return null;
    }

    return await _showModalInternal({
        type: CONSTANTS.MODAL_TYPE.CONFIRM,
        title,
        message: formContent,
        confirmText: '✅ 폴더 선택',
        cancelText: '❌ 취소',
    });
};

export const showDatePickerPopover = ({ initialDate }) => {
    return new Promise(resolve => {
        yearInput.value = initialDate.getFullYear();
        monthInput.value = initialDate.getMonth() + 1;
        datePickerPopover.style.display = 'flex';
        yearInput.focus();
        yearInput.select();

        const cleanup = () => {
            datePickerPopover.style.display = 'none';
            datePickerConfirmBtn.removeEventListener('click', onConfirm);
            // [수정] 이벤트 리스너 정리
            datePickerCloseBtn.removeEventListener('click', onCancel);
            datePickerTodayBtn.removeEventListener('click', onToday);
            document.removeEventListener('click', onOutsideClick, true);
            datePickerPopover.removeEventListener('keydown', onKeydown);
        };

        const onConfirm = () => {
            const year = parseInt(yearInput.value, 10);
            const month = parseInt(monthInput.value, 10);
            if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 1900 || year > 2200) {
                showToast('🤔 유효한 년(1900-2200)과 월(1-12)을 입력해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }
            cleanup();
            resolve({ year, month: month - 1 });
        };
        
        const onToday = () => {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            cleanup();
            resolve({ year, month });
        };

        const onCancel = () => { cleanup(); resolve(null); };
        
        const onOutsideClick = (e) => { 
            if (!datePickerPopover.contains(e.target) && e.target.id !== 'calendar-month-year') {
                onCancel(); 
            }
        };
        
        const onKeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
            else if (e.key === 'Escape') onCancel();
        };

        datePickerConfirmBtn.addEventListener('click', onConfirm);
        // [수정] 이벤트 리스너 등록
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

    showAlert({
        title: CONSTANTS.MODAL_TITLES.SHORTCUT_GUIDE,
        message: list,
        hideConfirmButton: true
    });
};

export const sortNotes = (notes, sortOrder) => {
    const sorted = [...notes];
    sorted.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
        switch (sortOrder) {
            case 'createdAt_desc': return b.createdAt - a.createdAt;
            case 'createdAt_asc': return a.createdAt - b.createdAt;
            case 'updatedAt_asc': return a.updatedAt - b.updatedAt;
            case 'title_asc': return (a.title ?? '').localeCompare(b.title ?? '', 'ko-KR');
            case 'title_desc': return (b.title ?? '').localeCompare(a.title ?? '', 'ko-KR');
            case 'updatedAt_desc': default: return b.updatedAt - a.updatedAt;
        }
    });
    return sorted;
};