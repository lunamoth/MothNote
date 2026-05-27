// app.js

import { state, subscribe, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
import { loadData, handleExport, handleImport, setupImportHandler, saveSession, sanitizeSettings } from './storage.js';
import {
    folderList, noteList, addFolderBtn, addNoteBtn, emptyTrashBtn, searchInput, clearSearchBtn, noteSortSelect,
    noteTitleInput, noteContentTextarea, noteContentView, shortcutGuideBtn, settingsBtn,
    showToast, showShortcutModal, sortNotes, showDatePickerPopover, showConfirm as showConfirmModal,
    settingsModal, settingsModalCloseBtn, settingsTabs,
    settingsCol1Width, settingsCol2Width,
    settingsEditorFontFamily, settingsEditorFontSize,
    settingsWeatherLat, settingsWeatherLon,
    settingsExportBtn, settingsImportBtn, settingsResetBtn, settingsSaveBtn,
    settingsWeatherCitySearch, settingsWeatherCitySearchBtn, settingsWeatherCityResults,
    // [기능 추가] 새로 추가된 요소를 가져옵니다.
    settingsStorageUsage,
    editorContainer,
    habitTrackerBtn, habitTrackerContainer, habitTrackerIframe, closeHabitTrackerBtn,
    // [기능 추가] 다이어트 챌린지 관련 요소
    dietChallengeBtn, dietChallengeContainer, dietChallengeIframe, closeDietChallengeBtn
} from './components.js';
import { renderAll, clearSortedNotesCache } from './renderer.js';
// [버그 수정] itemActions.js에서 handleRestoreItem, handleTextareaKeyDown 함수를 가져옵니다.
import { 
    handleAddFolder, handleAddNote, handleEmptyTrash, handlePinNote,
    handleDelete,
    handleRestoreItem, 
    handlePermanentlyDeleteItem,
    startRename, handleUserInput, saveCurrentNoteIfChanged, handleToggleFavorite, setCalendarRenderer,
    finishPendingRename,
    toYYYYMMDD,
    updateNoteCreationDates,
    forceResolvePendingRename,
    performTransactionalUpdate,
    performDeleteItem,
    handleTextareaKeyDown,
} from './itemActions.js';
import { 
    changeActiveFolder, changeActiveNote, handleSearchInput, 
    handleClearSearch, handleSortChange, confirmNavigation 
} from './navigationActions.js';

let appSettings = { ...CONSTANTS.DEFAULT_SETTINGS };
let isSavingSettings = false;

const settingsCol1Input = document.getElementById('settings-col1-input');
const settingsCol2Input = document.getElementById('settings-col2-input');
const settingsZenMaxWidth = document.getElementById('settings-zen-max-width');
const settingsZenMaxInput = document.getElementById('settings-zen-max-input');

const applySettings = (settings) => {
    const root = document.documentElement;
    if (!settings) return;
    root.style.setProperty('--column-folders-width', `${settings.layout.col1}%`);
    root.style.setProperty('--column-notes-width', `${settings.layout.col2}%`);
    root.style.setProperty('--zen-max-width', `${settings.zenMode.maxWidth}px`);
    root.style.setProperty('--editor-font-family', settings.editor.fontFamily);
    root.style.setProperty('--editor-font-size', `${settings.editor.fontSize}px`);

    if (dashboard) {
        dashboard.fetchWeather();
    }
};

const loadAndApplySettings = () => {
    try {
        const storedSettings = localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS);
        const parsedSettings = storedSettings ? JSON.parse(storedSettings) : {};
        appSettings = sanitizeSettings(parsedSettings);
    } catch (e) {
        console.warn("Could not load settings, using defaults.", e);
        localStorage.removeItem(CONSTANTS.LS_KEY_SETTINGS);
        appSettings = JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    }
    applySettings(appSettings);
};

// [기능 추가] 저장소 사용량을 계산하고 표시하는 함수
const updateStorageUsageDisplay = async () => {
    // settingsStorageUsage 요소가 없으면 함수를 종료합니다.
    if (!settingsStorageUsage) return;
    settingsStorageUsage.textContent = '계산 중...';

    try {
        // chrome.storage.local API가 사용 가능한지 확인합니다.
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            // 현재 사용량을 비동기적으로 가져옵니다.
            const usedBytes = await new Promise((resolve, reject) => {
                // null을 전달하여 전체 사용량을 가져옵니다.
                chrome.storage.local.getBytesInUse(null, (bytes) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    resolve(bytes);
                });
            });

            // 숫자를 쉼표가 있는 문자열로 변환합니다.
            const usedFormatted = usedBytes.toLocaleString('ko-KR');

            // 최종 문자열을 생성하여 UI에 업데이트합니다.
            settingsStorageUsage.textContent = `${usedFormatted} bytes`;
        } else {
            // API를 사용할 수 없는 경우
            settingsStorageUsage.textContent = '사용량 확인 불가';
        }
    } catch (error) {
        console.error("저장소 사용량 확인 실패:", error);
        settingsStorageUsage.textContent = '사용량 확인 실패';
    }
};


const openSettingsModal = async () => {
    await finishPendingRename();
    await saveCurrentNoteIfChanged();

    // [기능 추가] 모달이 열릴 때마다 저장소 사용량을 업데이트합니다.
    updateStorageUsageDisplay();

    settingsCol1Width.value = appSettings.layout.col1;
    settingsCol1Input.value = appSettings.layout.col1;
    settingsCol2Width.value = appSettings.layout.col2;
    settingsCol2Input.value = appSettings.layout.col2;
    settingsZenMaxWidth.value = appSettings.zenMode.maxWidth;
    settingsZenMaxInput.value = appSettings.zenMode.maxWidth;

    settingsEditorFontFamily.value = appSettings.editor.fontFamily;
    settingsEditorFontSize.value = appSettings.editor.fontSize;
    settingsWeatherLat.value = appSettings.weather.lat;
    settingsWeatherLon.value = appSettings.weather.lon;
    settingsWeatherCitySearch.value = '';
    settingsWeatherCityResults.innerHTML = '';
    settingsWeatherCityResults.style.display = 'none';

    settingsModal.showModal();
};

const handleSettingsSave = () => {
    isSavingSettings = true;
    
    const newFontFamily = settingsEditorFontFamily.value.trim();
    let finalFontFamily = appSettings.editor.fontFamily; 

    if (newFontFamily && typeof CSS.supports === 'function' && CSS.supports('font-family', newFontFamily)) {
        finalFontFamily = newFontFamily;
    } else if (newFontFamily) {
        showToast(CONSTANTS.MESSAGES.ERROR.INVALID_FONT_NAME, CONSTANTS.TOAST_TYPE.ERROR);
        settingsEditorFontFamily.value = finalFontFamily;
        isSavingSettings = false;
        return;
    } else {
        finalFontFamily = CONSTANTS.DEFAULT_SETTINGS.editor.fontFamily;
        settingsEditorFontFamily.value = finalFontFamily;
    }

    let lat = parseFloat(settingsWeatherLat.value);
    let lon = parseFloat(settingsWeatherLon.value);

    if (isNaN(lat) || lat < -90 || lat > 90) {
        showToast(CONSTANTS.MESSAGES.ERROR.INVALID_LATITUDE, CONSTANTS.TOAST_TYPE.ERROR); isSavingSettings = false; return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
        showToast(CONSTANTS.MESSAGES.ERROR.INVALID_LONGITUDE, CONSTANTS.TOAST_TYPE.ERROR); isSavingSettings = false; return;
    }

    // [BUG FIX] 숫자 0이 falsy로 취급되어 기본값으로 덮어씌워지는 문제를 해결하는 헬퍼 함수
    const getNumericValue = (value, defaultValue, isFloat = false) => {
        const parsed = isFloat ? parseFloat(value) : parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : defaultValue;
    };

    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const newSettings = {
        layout: {
            col1: getNumericValue(settingsCol1Input.value, defaults.layout.col1),
            col2: getNumericValue(settingsCol2Input.value, defaults.layout.col2)
        },
        zenMode: {
            maxWidth: getNumericValue(settingsZenMaxInput.value, defaults.zenMode.maxWidth)
        },
        editor: {
            fontFamily: finalFontFamily,
            fontSize: getNumericValue(settingsEditorFontSize.value, defaults.editor.fontSize)
        },
        weather: { lat, lon } // 위에서 이미 유효성 검사를 통과했으므로 그대로 사용
    };

    appSettings = newSettings;
    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
    localStorage.removeItem(CONSTANTS.DASHBOARD.WEATHER_CACHE_KEY);
    applySettings(appSettings);
    
    showToast(CONSTANTS.MESSAGES.SUCCESS.SETTINGS_SAVED);
    settingsModal.close();
    
    setTimeout(() => { if (dashboard) dashboard.fetchWeather(); }, 100);
};

const handleSettingsReset = async () => {
    const ok = await showConfirmModal({
        title: '⚙️ 설정 초기화', message: '모든 설정을 기본값으로 되돌리시겠습니까? 이 작업은 즉시 저장됩니다.',
        confirmText: '🔄 초기화 및 저장', confirmButtonType: 'danger'
    });
    if (ok) {
        appSettings = JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
        
        settingsCol1Width.value = appSettings.layout.col1; settingsCol1Input.value = appSettings.layout.col1;
        settingsCol2Width.value = appSettings.layout.col2; settingsCol2Input.value = appSettings.layout.col2;
        settingsZenMaxWidth.value = appSettings.zenMode.maxWidth; settingsZenMaxInput.value = appSettings.zenMode.maxWidth;
        settingsEditorFontFamily.value = appSettings.editor.fontFamily;
        settingsEditorFontSize.value = appSettings.editor.fontSize;
        settingsWeatherLat.value = appSettings.weather.lat;
        settingsWeatherLon.value = appSettings.weather.lon;
        
        applySettings(appSettings);
        showToast(CONSTANTS.MESSAGES.SUCCESS.SETTINGS_RESET);
        
        // [BUG FIX] 브라우저가 CSS 변수 변경을 렌더링할 수 있도록 짧은 지연을 줍니다.
        // 50ms는 사용자가 인지하기 어려운 시간이지만 렌더링에는 충분합니다.
        await new Promise(resolve => setTimeout(resolve, 50));
        
        settingsModal.close();
    }
};

const handleWeatherCitySearch = async () => {
    const query = settingsWeatherCitySearch.value.trim();
    if (query.length < 2) {
        settingsWeatherCityResults.innerHTML = '';
        settingsWeatherCityResults.style.display = 'none';
        return;
    }

    // 요청 전에 이전 결과를 즉시 초기화하여 사용자 혼란을 방지합니다.
    settingsWeatherCityResults.innerHTML = '';
    settingsWeatherCityResults.style.display = 'none';

    try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
        if (!response.ok) throw new Error('Network response was not ok.');
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            data.results.forEach(city => {
                const li = document.createElement('li');
                let displayName = city.name;
                if (city.admin1) displayName += `, ${city.admin1}`;
                if (city.country) displayName += `, ${city.country}`;
                
                li.textContent = displayName;
                li.dataset.lat = city.latitude; li.dataset.lon = city.longitude;
                li.addEventListener('click', () => {
                    settingsWeatherLat.value = parseFloat(city.latitude).toFixed(4);
                    settingsWeatherLon.value = parseFloat(city.longitude).toFixed(4);
                    settingsWeatherCitySearch.value = displayName;
                    settingsWeatherCityResults.style.display = 'none';
                    showToast(CONSTANTS.MESSAGES.SUCCESS.WEATHER_LOCATION_UPDATED);
                });
                settingsWeatherCityResults.appendChild(li);
            });
            settingsWeatherCityResults.style.display = 'block';
        } else {
            showToast(CONSTANTS.MESSAGES.ERROR.WEATHER_CITY_NOT_FOUND, CONSTANTS.TOAST_TYPE.ERROR);
        }
    } catch (error) {
        console.error('Error fetching city data:', error);
        // 목록은 이미 함수 시작 시 초기화되었으므로 추가 작업이 필요 없습니다.
    }
};

const setupSettingsModal = () => {
    // [BUG FIX] DOM 요소가 null일 경우를 대비하여 방어 코드를 추가합니다.
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
    if (settingsModalCloseBtn) settingsModalCloseBtn.addEventListener('click', () => settingsModal.close());
    if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', handleSettingsSave);
    if (settingsResetBtn) settingsResetBtn.addEventListener('click', handleSettingsReset);
    if (settingsExportBtn) settingsExportBtn.addEventListener('click', () => handleExport(appSettings));
    if (settingsImportBtn) settingsImportBtn.addEventListener('click', () => handleImport());

    if (settingsModal) {
        settingsModal.addEventListener('close', () => {
            if (!isSavingSettings) { applySettings(appSettings); }
            isSavingSettings = false;
        });
    }

    if (settingsTabs) {
        settingsTabs.addEventListener('click', (e) => {
            const target = e.target.closest('.settings-tab-btn'); if (!target) return;
            const activeTabBtn = document.querySelector('.settings-tab-btn.active');
            if (activeTabBtn) activeTabBtn.classList.remove('active');
            target.classList.add('active');

            const activeTabPanel = document.querySelector('.settings-tab-panel.active');
            if (activeTabPanel) activeTabPanel.classList.remove('active');
            
            const tabPanel = document.getElementById(`settings-tab-${target.dataset.tab}`);
            if (tabPanel) tabPanel.classList.add('active');
        });
    }
    
    const bindSliderAndInput = (slider, input, cssVarName, unit) => {
        // [BUG FIX] slider 또는 input이 null일 경우 함수를 즉시 종료합니다.
        if (!slider || !input) return;
        const updateStyle = (value) => { document.documentElement.style.setProperty(cssVarName, `${value}${unit}`); };
        slider.addEventListener('input', () => { const value = slider.value; input.value = value; updateStyle(value); });
        input.addEventListener('input', () => { let value = parseInt(input.value, 10); const min = parseInt(input.min, 10); const max = parseInt(input.max, 10); if (isNaN(value)) return; slider.value = Math.max(min, Math.min(value, max)); updateStyle(value); });
        input.addEventListener('blur', () => { let value = parseInt(input.value, 10); const min = parseInt(input.min, 10); const max = parseInt(input.max, 10); if (isNaN(value) || value < min) value = min; else if (value > max) value = max; input.value = value; slider.value = value; updateStyle(value); });
    };

    bindSliderAndInput(settingsCol1Width, settingsCol1Input, '--column-folders-width', '%');
    bindSliderAndInput(settingsCol2Width, settingsCol2Input, '--column-notes-width', '%');
    bindSliderAndInput(settingsZenMaxWidth, settingsZenMaxInput, '--zen-max-width', 'px');

    if (settingsEditorFontFamily) {
        settingsEditorFontFamily.addEventListener('input', (e) => { document.documentElement.style.setProperty('--editor-font-family', e.target.value); });
    }
    if (settingsEditorFontSize) {
        settingsEditorFontSize.addEventListener('input', (e) => { document.documentElement.style.setProperty('--editor-font-size', `${e.target.value}px`); });
    }

    if (settingsWeatherCitySearchBtn) settingsWeatherCitySearchBtn.addEventListener('click', handleWeatherCitySearch);
    if (settingsWeatherCitySearch) {
        settingsWeatherCitySearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleWeatherCitySearch(); } });
    }
    // settingsWeatherCityResults는 동적으로 내용이 채워지므로, 전역 클릭 이벤트는 null 체크 없이 유지합니다.
    document.addEventListener('click', (e) => { if (settingsWeatherCityResults && !settingsWeatherCitySearch.contains(e.target) && !settingsWeatherCityResults.contains(e.target)) { settingsWeatherCityResults.style.display = 'none'; } });
};

// [기능 추가] 모든 iframe 뷰를 닫는 헬퍼 함수
const _closeAllIFrames = () => {
    dashboard._closeWeatherView();
    dashboard._closeHabitTracker();
    dashboard._closeDietChallenge();
};


class Dashboard {
    constructor() {
        this.dom = {
            panel: document.getElementById('folders-panel'),
            digitalClock: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.digitalClock),
            analogClockCanvas: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.analogClockCanvas),
            weatherContainer: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.weatherContainer),
            calendarGrid: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.calendarGrid),
            calendarMonthYear: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.calendarMonthYear),
            prevMonthBtn: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.prevMonthBtn),
            nextMonthBtn: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.nextMonthBtn),
            
            // 날씨 뷰 관련 DOM 요소 참조 정리
            notesPanel: document.getElementById('notes-panel'),
            splitter2: document.getElementById('splitter-2'),
            mainContent: document.querySelector('.main-content'),
            weatherViewContainer: document.getElementById('weather-view-container'),
            weatherIframe: document.getElementById('weather-iframe'),
            closeWeatherViewBtn: document.getElementById('close-weather-view-btn'),
            
            // [기능 추가] 습관 트래커 관련 DOM 요소 참조
            habitTrackerBtn: document.getElementById('habit-tracker-btn'),
            habitTrackerContainer: document.getElementById('habit-tracker-container'),
            habitTrackerIframe: document.getElementById('habit-tracker-iframe'),
            closeHabitTrackerBtn: document.getElementById('close-habit-tracker-btn'),

            // [기능 추가] 다이어트 챌린지 관련 DOM 요소 참조
            dietChallengeBtn: document.getElementById('diet-challenge-btn'),
            dietChallengeContainer: document.getElementById('diet-challenge-container'),
            dietChallengeIframe: document.getElementById('diet-challenge-iframe'),
            closeDietChallengeBtn: document.getElementById('close-diet-challenge-btn'),
        };
        this.internalState = { currentDate: state.dateFilter ? new Date(state.dateFilter) : new Date(), analogClockAnimationId: null, digitalClockIntervalId: null, weatherFetchController: null, displayedMonth: null, clockFaceCache: null, };
        this.observer = null;
    }
    init() {
        this._setupVisibilityObserver(); this._initAnalogClock();
        if (document.body) {
            new MutationObserver(() => {
                // [BUG FIX] 테마 변경 후 스타일이 완전히 적용된 다음 프레임에 시계를 다시 그리도록 수정합니다.
                // 이렇게 하면 getComputedStyle이 정확한 테마의 색상 값을 가져오는 것을 보장하여 레이스 컨디션을 해결합니다.
                requestAnimationFrame(() => this._initAnalogClock(true));
            }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
        this.fetchWeather(); this.renderCalendar(); this._setupCalendarEvents();
        this._setupWeatherViewEvents();
        // [기능 추가] 습관 트래커 이벤트 설정
        this._setupHabitTrackerEvents();
        // [기능 추가] 다이어트 챌린지 이벤트 설정
        this._setupDietChallengeEvents();
        window.addEventListener('unload', () => { if (this.internalState.weatherFetchController) this.internalState.weatherFetchController.abort(); this._stopClocks(); });
    }
    
    // [기능 추가] 모든 패널을 숨기는 공통 헬퍼 함수
    _hideMainPanels() {
        this.dom.notesPanel.style.display = 'none';
        this.dom.splitter2.style.display = 'none';
        this.dom.mainContent.style.display = 'none';

        // 관련 없는 플로팅 액션 버튼 숨기기
        const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
        const zenModeBtn = document.getElementById('zen-mode-toggle-btn');
        if (markdownToggleBtn) markdownToggleBtn.style.display = 'none';
        if (zenModeBtn) zenModeBtn.style.display = 'none';
    }

    // [기능 추가] 모든 패널을 복원하는 공통 헬퍼 함수
    _restoreMainPanels() {
        this.dom.notesPanel.style.removeProperty('display');
        this.dom.splitter2.style.removeProperty('display');
        this.dom.mainContent.style.removeProperty('display');

        // 숨겼던 플로팅 액션 버튼 복원
        const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
        const zenModeBtn = document.getElementById('zen-mode-toggle-btn');
        if (markdownToggleBtn) markdownToggleBtn.style.removeProperty('display');
        if (zenModeBtn) zenModeBtn.style.removeProperty('display');
    }

    _openWeatherView() {
        const { lat, lon } = appSettings.weather;
        
        console.log("Opening weather view with settings:", appSettings.weather);
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            console.error("Invalid lat/lon values:", lat, lon);
            showToast("날씨 위치 정보가 올바르지 않습니다. 설정에서 위치를 확인해주세요.", CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        
        // 다른 iframe 뷰가 열려있으면 닫습니다.
        this._closeHabitTracker();
        this._closeDietChallenge();
        
        this.dom.weatherIframe.src = `weather.html?lat=${lat}&lon=${lon}&theme=${theme}`;
        
        this._hideMainPanels();
        this.dom.weatherViewContainer.style.display = 'grid';
    }

    _closeWeatherView() {
        this.dom.weatherViewContainer.style.display = 'none';
        this.dom.weatherIframe.src = 'about:blank';
        this._restoreMainPanels();
    }

    // [기능 추가] 습관 트래커 열기 함수
    _openHabitTracker() {
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        
        // 다른 iframe 뷰가 열려있으면 닫습니다.
        this._closeWeatherView();
        this._closeDietChallenge();
        
        this.dom.habitTrackerIframe.src = `habitTracker.html?theme=${theme}`;
        
        this._hideMainPanels();
        this.dom.habitTrackerContainer.style.display = 'grid';
    }

    // [기능 추가] 습관 트래커 닫기 함수
    _closeHabitTracker() {
        this.dom.habitTrackerContainer.style.display = 'none';
        this.dom.habitTrackerIframe.src = 'about:blank';
        this._restoreMainPanels();
    }

    // [기능 추가] 다이어트 챌린지 열기 함수
    _openDietChallenge() {
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        
        // 다른 iframe 뷰가 열려있으면 닫습니다.
        this._closeWeatherView();
        this._closeHabitTracker();
        
        this.dom.dietChallengeIframe.src = `dietChallenge.html?theme=${theme}`;
        
        this._hideMainPanels();
        this.dom.dietChallengeContainer.style.display = 'grid';
    }

    // [기능 추가] 다이어트 챌린지 닫기 함수
    _closeDietChallenge() {
        this.dom.dietChallengeContainer.style.display = 'none';
        this.dom.dietChallengeIframe.src = 'about:blank';
        this._restoreMainPanels();
    }
    
    // [버그 수정] 날씨 위젯의 title 속성을 동적으로 업데이트하도록 수정
    _setupWeatherViewEvents() {
        if (this.dom.weatherContainer) {
            this.dom.weatherContainer.style.cursor = 'pointer';
            this.dom.weatherContainer.title = '날씨 정보 불러오는 중...';
            this.dom.weatherContainer.addEventListener('click', () => this._openWeatherView());
        }
        if (this.dom.closeWeatherViewBtn) {
            this.dom.closeWeatherViewBtn.addEventListener('click', () => this._closeWeatherView());
        }
    }
    
    // [기능 추가] 습관 트래커 이벤트 리스너 설정
    _setupHabitTrackerEvents() {
        if (this.dom.habitTrackerBtn) {
            this.dom.habitTrackerBtn.addEventListener('click', () => this._openHabitTracker());
        }
        if (this.dom.closeHabitTrackerBtn) {
            this.dom.closeHabitTrackerBtn.addEventListener('click', () => this._closeHabitTracker());
        }
    }

    // [기능 추가] 다이어트 챌린지 이벤트 리스너 설정
    _setupDietChallengeEvents() {
        if (this.dom.dietChallengeBtn) {
            this.dom.dietChallengeBtn.addEventListener('click', () => this._openDietChallenge());
        }
        if (this.dom.closeDietChallengeBtn) {
            this.dom.closeDietChallengeBtn.addEventListener('click', () => this._closeDietChallenge());
        }
    }
    
    _setupVisibilityObserver() {
        if (!this.dom.panel) return;
        this.observer = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting) this._startClocks(); else this._stopClocks(); }); });
        this.observer.observe(this.dom.panel);
    }
    _startClocks() { if (!this.internalState.digitalClockIntervalId) { this._updateDigitalClock(); this.internalState.digitalClockIntervalId = setInterval(this._updateDigitalClock.bind(this), 1000); } if (!this.internalState.analogClockAnimationId) this._animateAnalogClock(); }
    _stopClocks() { if (this.internalState.digitalClockIntervalId) { clearInterval(this.internalState.digitalClockIntervalId); this.internalState.digitalClockIntervalId = null; } if (this.internalState.analogClockAnimationId) { cancelAnimationFrame(this.internalState.analogClockAnimationId); this.internalState.analogClockAnimationId = null; } }
    
    _getWeatherInfo(wmoCode, isDay = true) {
        let weather = CONSTANTS.DASHBOARD.WMO_MAP[wmoCode] ?? { icon: "❓", text: "알 수 없음" };
        if (!isDay) {
            if (wmoCode === 0) { // 맑음
                weather = { icon: "🌙", text: "맑음 (밤)" };
            } else if (wmoCode === 1) { // 대체로 맑음
                weather = { icon: "☁️🌙", text: "대체로 맑음 (밤)" };
            }
        }
        return weather;
    }

    _updateDigitalClock() { if (!this.dom.digitalClock) return; this.dom.digitalClock.textContent = new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true }); }
    _initAnalogClock(forceRedraw = false) { if (!this.dom.analogClockCanvas) return; if (this.internalState.analogClockAnimationId) { cancelAnimationFrame(this.internalState.analogClockAnimationId); this.internalState.analogClockAnimationId = null; } if (forceRedraw || !this.internalState.clockFaceCache) this._drawStaticClockFace(); const ctx = this.dom.analogClockCanvas.getContext('2d'); const radius = this.dom.analogClockCanvas.height / 2; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(radius, radius); this._animateAnalogClock(); }
    
    // [개선] 시계 디자인을 더 미려하게 수정합니다. (시계판, 눈금, 숫자)
    _drawStaticClockFace() {
        if (!this.dom.analogClockCanvas) return;
        const cacheCanvas = document.createElement('canvas');
        cacheCanvas.width = this.dom.analogClockCanvas.width;
        cacheCanvas.height = this.dom.analogClockCanvas.height;
        const ctx = cacheCanvas.getContext('2d');
        const radius = cacheCanvas.height / 2;
        ctx.translate(radius, radius);
        const style = getComputedStyle(document.documentElement);

        // [BUG FIX] Canvas로 배경을 그리는 로직을 제거합니다. 이제 CSS가 배경을 담당합니다.
        
        // 시계 테두리
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.98, 0, 2 * Math.PI);
        ctx.strokeStyle = style.getPropertyValue('--divider-color').trim();
        ctx.lineWidth = radius * 0.04;
        ctx.stroke();

        // 시/분 눈금
        ctx.strokeStyle = style.getPropertyValue('--font-color-dim').trim();
        for(let i = 0; i < 60; i++){
            const angle = (i / 60) * 2 * Math.PI;
            ctx.rotate(angle);
            ctx.beginPath();
            if (i % 5 === 0) { // 시 눈금
                ctx.lineWidth = radius * 0.03;
                ctx.moveTo(radius * 0.85, 0);
            } else { // 분 눈금
                ctx.lineWidth = radius * 0.02;
                ctx.moveTo(radius * 0.9, 0);
            }
            ctx.lineTo(radius * 0.95, 0);
            ctx.stroke();
            ctx.rotate(-angle);
        }
        
        // 숫자
        ctx.font = `bold ${radius * 0.18}px sans-serif`;
        // [BUG FIX] 다크 모드일 때 숫자 색상을 명시적으로 지정하여 가독성 확보
        const isDarkMode = document.body.classList.contains('dark-mode');
        ctx.fillStyle = isDarkMode ? '#EEE8D5' : style.getPropertyValue('--font-color').trim();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let num = 1; num <= 12; num++) {
            const angle = num * Math.PI / 6;
            ctx.fillText(num.toString(), radius * 0.72 * Math.sin(angle), -radius * 0.72 * Math.cos(angle));
        }
        
        this.internalState.clockFaceCache = cacheCanvas;
    }
    
    // [개선] 시침/분침 디자인을 개선하고 그림자를 추가합니다. 초침은 제거합니다.
    _drawHandsOnTop() {
        if (!this.dom.analogClockCanvas) return;
        const ctx = this.dom.analogClockCanvas.getContext('2d');
        const radius = this.dom.analogClockCanvas.height / 2;
        
        ctx.clearRect(-radius, -radius, this.dom.analogClockCanvas.width, this.dom.analogClockCanvas.height);
        if (this.internalState.clockFaceCache) {
            ctx.drawImage(this.internalState.clockFaceCache, -radius, -radius);
        }
        
        const style = getComputedStyle(document.documentElement);
        const accentColor = style.getPropertyValue('--accent-color').trim();
        // [BUG FIX] 다크 모드일 때 시침/분침 색상을 명시적으로 지정하여 가독성 확보
        const isDarkMode = document.body.classList.contains('dark-mode');
        const fontColor = isDarkMode ? '#EEE8D5' : style.getPropertyValue('--font-color').trim();
        const shadowColor = 'rgba(0,0,0,0.2)';

        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        
        const drawHand = (angle, length, width, color) => {
            ctx.save();
            ctx.beginPath();
            ctx.rotate(angle);
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.strokeStyle = color;
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = 5;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -length);
            ctx.stroke();
            ctx.restore();
        };

        // 시침 그리기
        const hourAngle = (h % 12 + m / 60) * (Math.PI / 6);
        drawHand(hourAngle, radius * 0.5, radius * 0.07, fontColor);
        
        // 분침 그리기
        const minuteAngle = m * (Math.PI / 30);
        drawHand(minuteAngle, radius * 0.75, radius * 0.05, fontColor);
        
        // 시계 중심축
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.06, 0, 2 * Math.PI);
        ctx.fillStyle = accentColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.02, 0, 2 * Math.PI);
        ctx.fillStyle = style.getPropertyValue('--solar-base3').trim();
        ctx.fill();
    }
    
    _animateAnalogClock() { let lastMinute = -1; const animate = () => { const now = new Date(); const currentMinute = now.getMinutes(); if (currentMinute !== lastMinute) { this._drawHandsOnTop(); lastMinute = currentMinute; } this.internalState.analogClockAnimationId = requestAnimationFrame(animate); }; this._drawHandsOnTop(); animate(); }
    
    // [버그 수정] 날씨 위젯의 title 속성을 동적으로 업데이트하도록 수정
    async fetchWeather() {
        if (!this.dom.weatherContainer) return;

        const WEATHER_CACHE_KEY = CONSTANTS.DASHBOARD.WEATHER_CACHE_KEY;
        const CACHE_DURATION_MINUTES = 60;
        const { lat, lon } = appSettings.weather;

        try {
            const cachedData = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
            const now = new Date().getTime();
            const isSameLocation = cachedData?.lat === lat && cachedData?.lon === lon;
            if (cachedData && isSameLocation && (now - cachedData.timestamp < CACHE_DURATION_MINUTES * 60 * 1000)) {
                const { weather, temp } = cachedData.data;
                this.dom.weatherContainer.innerHTML = `<span id="weather-icon">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`;
                this.dom.weatherContainer.title = `${weather.text}, ${temp}°C \n\n(클릭해서 상세 날씨 보기)`;
                return;
            }
        } catch (e) {
            console.warn("Could not read weather cache.", e);
        }

        if (this.internalState.weatherFetchController) {
            this.internalState.weatherFetchController.abort();
        }
        this.internalState.weatherFetchController = new AbortController();
        const signal = this.internalState.weatherFetchController.signal;
        this.dom.weatherContainer.innerHTML = `<span>⏳</span>`;

        try {
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                this.dom.weatherContainer.innerHTML = `<span id="weather-icon">⚠️</span>`;
                this.dom.weatherContainer.title = "날씨 정보를 불러오는 데 실패했습니다.";
                showToast(CONSTANTS.MESSAGES.ERROR.INVALID_LATITUDE, CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }

            const params = new URLSearchParams({
                latitude: String(lat),
                longitude: String(lon),
                current: 'temperature_2m,is_day,weather_code',
                timezone: 'auto',
                temperature_unit: 'celsius'
            });
            const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
            const response = await fetch(url, { signal });

            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            
            const data = await response.json();
            if (!data?.current) throw new Error("API 응답에서 current 객체를 찾을 수 없습니다.");

            const { temperature_2m, weather_code, is_day } = data.current;
            const weather = this._getWeatherInfo(weather_code, is_day === 1);
            const temp = Math.round(temperature_2m);

            this.dom.weatherContainer.innerHTML = `<span id="weather-icon">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`;
            this.dom.weatherContainer.title = `${weather.text}, ${temp}°C \n\n(클릭해서 상세 날씨 보기)`;

            try {
                localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
                    timestamp: new Date().getTime(),
                    lat,
                    lon,
                    data: { weather, temp }
                }));
            } catch (e) {
                console.warn("Could not save weather cache.", e);
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                this.dom.weatherContainer.innerHTML = `<span id="weather-icon">⚠️</span>`;
                this.dom.weatherContainer.title = "날씨 정보를 불러오는 데 실패했습니다.";
            }
        }
    }
    
    _updateCalendarHighlights() { if (!this.dom.calendarGrid) return; const dateCells = this.dom.calendarGrid.querySelectorAll('.date-cell'); const activeDateStr = state.dateFilter ? toYYYYMMDD(state.dateFilter) : null; dateCells.forEach(cell => { const dateStr = cell.dataset.date; if (!dateStr) return; cell.classList.toggle('has-notes', state.noteCreationDates.has(dateStr)); cell.classList.toggle('active-date', dateStr === activeDateStr); cell.title = ''; }); }
    _drawCalendarGrid() { if (!this.dom.calendarGrid || !this.dom.calendarMonthYear) return; this.dom.calendarGrid.innerHTML = ''; const year = this.internalState.currentDate.getFullYear(), month = this.internalState.currentDate.getMonth(); this.dom.calendarMonthYear.textContent = `🗓️ ${year}년 ${month + 1}월`; ['일', '월', '화', '수', '목', '금', '토'].forEach(day => { const el = document.createElement('div'); el.className = 'calendar-day day-name'; el.textContent = day; this.dom.calendarGrid.appendChild(el); }); const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate(); for (let i = 0; i < firstDay; i++) this.dom.calendarGrid.appendChild(document.createElement('div')); const today = new Date(), todayYear = today.getFullYear(), todayMonth = today.getMonth(), todayDate = today.getDate(); for (let i = 1; i <= daysInMonth; i++) { const el = document.createElement('div'); el.className = 'calendar-day date-cell current-month ripple-effect'; el.textContent = i; if (i === todayDate && year === todayYear && month === todayMonth) el.classList.add('today'); el.dataset.date = toYYYYMMDD(new Date(year, month, i)); this.dom.calendarGrid.appendChild(el); } }
    renderCalendar(forceRedraw = false) { const newMonthIdentifier = `${this.internalState.currentDate.getFullYear()}-${this.internalState.currentDate.getMonth()}`; if (forceRedraw || this.internalState.displayedMonth !== newMonthIdentifier) { this._drawCalendarGrid(); this.internalState.displayedMonth = newMonthIdentifier; } this._updateCalendarHighlights(); }
    resetCalendarDate() { this.internalState.currentDate = new Date(); }
    _setupCalendarEvents() { if (!this.dom.prevMonthBtn || !this.dom.nextMonthBtn || !this.dom.calendarGrid || !this.dom.calendarMonthYear) return; this.dom.prevMonthBtn.onclick = () => { this.internalState.currentDate.setMonth(this.internalState.currentDate.getMonth() - 1); this.renderCalendar(); }; this.dom.nextMonthBtn.onclick = () => { this.internalState.currentDate.setMonth(this.internalState.currentDate.getMonth() + 1); this.renderCalendar(); }; this.dom.calendarMonthYear.onclick = async () => { const result = await showDatePickerPopover({ initialDate: this.internalState.currentDate }); if (result) { this.internalState.currentDate = new Date(result.year, result.month, 1); this.renderCalendar(); } }; this.dom.calendarGrid.onclick = async e => { const target = e.target.closest('.date-cell.has-notes'); if (target) { if (!(await confirmNavigation())) return; const newFilterDate = new Date(target.dataset.date); const isSameDate = state.dateFilter && new Date(state.dateFilter).getTime() === newFilterDate.getTime(); searchInput.value = ''; if (isSameDate) { setState({ dateFilter: null, activeFolderId: 'all-notes-virtual-id', activeNoteId: null, searchTerm: '' }); } else { this.internalState.currentDate = newFilterDate; const notesOnDate = Array.from(state.noteMap.values()).map(e => e.note).filter(n => toYYYYMMDD(n.createdAt) === target.dataset.date); const sortedNotes = sortNotes(notesOnDate, state.noteSortOrder); setState({ dateFilter: newFilterDate, activeNoteId: sortedNotes[0]?.id ?? null, activeFolderId: null, searchTerm: '' }); this.renderCalendar(); } } }; this.dom.calendarGrid.addEventListener('mouseover', e => { const target = e.target.closest('.date-cell.has-notes'); if (target) { const notesOnDate = Array.from(state.noteMap.values()).map(e => e.note).filter(n => toYYYYMMDD(n.createdAt) === target.dataset.date).map(n => n.title || '📝 제목 없음'); if (notesOnDate.length > 0) target.title = `작성된 노트 (${notesOnDate.length}개):\n- ${notesOnDate.join('\n- ')}`; } }); }
}

window.isInitializing = true;
window.isImporting = false;

let keyboardNavDebounceTimer, draggedItemInfo = { id: null, type: null, sourceFolderId: null }, isListNavigating = false, dashboard;

const setupRippleEffect = () => { document.body.addEventListener('click', (e) => { const button = e.target.closest('.ripple-effect'); if (!button) return; const ripple = document.createElement('span'); const diameter = Math.max(button.clientWidth, button.clientHeight); ripple.style.width = ripple.style.height = `${diameter}px`; ripple.style.left = `${e.clientX - button.getBoundingClientRect().left - diameter / 2}px`; ripple.style.top = `${e.clientY - button.getBoundingClientRect().top - diameter / 2}px`; ripple.classList.add('ripple'); const existingRipple = button.querySelector('.ripple'); if (existingRipple) existingRipple.remove(); button.appendChild(ripple); setTimeout(() => { if (ripple.parentElement) ripple.remove(); }, 600); }); };
// [버그 수정] handleRestoreItem, handlePermanentlyDeleteItem 호출 시 type 인자 추가
const handleItemActionClick = (button, id, type) => { 
    if (button.classList.contains('pin-btn')) handlePinNote(id); 
    else if (button.classList.contains('favorite-btn')) handleToggleFavorite(id); 
    else if (button.classList.contains('delete-item-btn')) handleDelete(id, type); 
    else if (button.classList.contains('restore-item-btn')) handleRestoreItem(id, type); 
    else if (button.classList.contains('perm-delete-item-btn')) handlePermanentlyDeleteItem(id, type); 
};

// [버그 수정] 클릭 시 즉시 키보드 탐색이 가능하도록 포커스를 설정합니다.
const handleListClick = (e, type) => {
    const li = e.target.closest('.item-list-entry');
    if (!li) return;
    const id = li.dataset.id;
    const actionBtn = e.target.closest('.icon-button');
    if (actionBtn) {
        handleItemActionClick(actionBtn, id, li.dataset.type);
        return;
    }

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        changeActiveFolder(id);
        // 상태 변경 후 DOM 업데이트가 완료될 다음 프레임에 포커스를 설정합니다.
        requestAnimationFrame(() => folderList?.focus());
    } else if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        changeActiveNote(id);
        // 노트 리스트도 동일하게 수정하여 일관성을 유지합니다.
        requestAnimationFrame(() => noteList?.focus());
    }
};

const setupDragAndDrop = (listElement, type) => { if (!listElement) return; let dragOverIndicator; const getDragOverIndicator = () => { if (!dragOverIndicator) { dragOverIndicator = document.createElement('li'); dragOverIndicator.className = 'drag-over-indicator'; } return dragOverIndicator; }; listElement.addEventListener('dragstart', e => { const li = e.target.closest('.item-list-entry'); if (!li || !li.draggable) { e.preventDefault(); return; } draggedItemInfo.id = li.dataset.id; draggedItemInfo.type = type; if (type === CONSTANTS.ITEM_TYPE.NOTE) { const { folder } = findNote(draggedItemInfo.id); draggedItemInfo.sourceFolderId = folder?.id; } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', draggedItemInfo.id); setTimeout(() => li.classList.add(CONSTANTS.CLASSES.DRAGGING), 0); }); listElement.addEventListener('dragover', e => { e.preventDefault(); if (listElement !== folderList) return; const indicator = getDragOverIndicator(); const li = e.target.closest('.item-list-entry'); const hasDraggableItems = listElement.querySelector('.item-list-entry[draggable="true"]'); if (!hasDraggableItems) { listElement.append(indicator); return; } if (!li || li.classList.contains(CONSTANTS.CLASSES.DRAGGING) || !li.draggable) { getDragOverIndicator().remove(); return; } const rect = li.getBoundingClientRect(), isAfter = e.clientY > rect.top + rect.height / 2; if (isAfter) li.after(indicator); else li.before(indicator); }); listElement.addEventListener('dragleave', e => { if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) getDragOverIndicator().remove(); }); listElement.addEventListener('drop', async e => { e.preventDefault(); if (listElement !== folderList || !draggedItemInfo.id) return; const indicator = getDragOverIndicator(); if(!indicator.parentElement) return; const draggedId = draggedItemInfo.id; const fromIndex = state.folders.findIndex(item => item.id === draggedId); if (fromIndex === -1) return; const originalNextElId = state.folders[fromIndex + 1]?.id; const dropNextElId = indicator.nextElementSibling?.dataset.id; indicator.remove(); if (originalNextElId === dropNextElId) { setState({}); return; } await performTransactionalUpdate((latestData) => { const { folders } = latestData; const fromIdx = folders.findIndex(item => item.id === draggedId); if (fromIdx === -1) return null; const [draggedItem] = folders.splice(fromIdx, 1); let toIdx = folders.findIndex(item => item.id === dropNextElId); if (toIdx === -1) folders.push(draggedItem); else folders.splice(toIdx, 0, draggedItem); draggedItem.updatedAt = Date.now(); return { newData: latestData, successMessage: null, postUpdateState: {} }; }); }); listElement.addEventListener('dragend', () => { const li = listElement.querySelector(`.${CONSTANTS.CLASSES.DRAGGING}`); if (li) li.classList.remove(CONSTANTS.CLASSES.DRAGGING); getDragOverIndicator().remove(); if (folderList) folderList.querySelector(`.${CONSTANTS.CLASSES.DROP_TARGET}`)?.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); draggedItemInfo = { id: null, type: null, sourceFolderId: null }; }); };
const setupNoteToFolderDrop = () => { if (!folderList) return; let currentDropTarget = null; folderList.addEventListener('dragenter', e => { if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE) return; const targetFolderLi = e.target.closest('.item-list-entry'); if (currentDropTarget && currentDropTarget !== targetFolderLi) { currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; } if (targetFolderLi) { const folderId = targetFolderLi.dataset.id; const { ALL, RECENT } = CONSTANTS.VIRTUAL_FOLDERS; if (folderId !== draggedItemInfo.sourceFolderId && ![ALL.id, RECENT.id].includes(folderId)) { e.preventDefault(); targetFolderLi.classList.add(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = targetFolderLi; } } }); folderList.addEventListener('dragleave', e => { if (currentDropTarget && !e.currentTarget.contains(e.relatedTarget)) { currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; } }); folderList.addEventListener('dragover', e => { if (draggedItemInfo.type === CONSTANTS.ITEM_TYPE.NOTE && currentDropTarget) e.preventDefault(); }); folderList.addEventListener('drop', async e => { e.preventDefault(); if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE || !currentDropTarget) return; const targetFolderId = currentDropTarget.dataset.id, noteId = draggedItemInfo.id; currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; if (!(await saveCurrentNoteIfChanged())) { showToast("변경사항 저장에 실패하여 노트 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR); return; } const { TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS; if (targetFolderId === TRASH.id) { await performDeleteItem(noteId, CONSTANTS.ITEM_TYPE.NOTE); } else if (targetFolderId === FAVORITES.id) { const { item: note } = findNote(noteId); if (note && !state.favorites.has(noteId)) await handleToggleFavorite(noteId); } else { await performTransactionalUpdate((latestData) => { const { folders } = latestData; let noteToMove, sourceFolder; for (const folder of folders) { const noteIndex = folder.notes.findIndex(n => n.id === noteId); if (noteIndex > -1) { [noteToMove] = folder.notes.splice(noteIndex, 1); sourceFolder = folder; break; } } const targetFolder = folders.find(f => f.id === targetFolderId); if (!noteToMove || !targetFolder || sourceFolder.id === targetFolder.id) return null; const now = Date.now(); noteToMove.updatedAt = now; targetFolder.notes.unshift(noteToMove); sourceFolder.updatedAt = now; targetFolder.updatedAt = now; return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_SUCCESS(noteToMove.title, targetFolder.name), postUpdateState: {} }; }); } }); };
const _focusAndScrollToListItem = (listElement, itemId) => {
    // [BUG FIX] DOMException 방지를 위해 CSS.escape()를 사용하여 ID를 안전하게 만듭니다.
    const safeItemId = typeof itemId === 'string' ? CSS.escape(itemId) : itemId;
    const itemEl = listElement.querySelector(`[data-id="${safeItemId}"]`);
    if (itemEl) {
        itemEl.focus();
        itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
};
const _navigateList = async (type, direction) => { if (isListNavigating) return; isListNavigating = true; try { await finishPendingRename(); const list = type === CONSTANTS.ITEM_TYPE.FOLDER ? folderList : noteList; if (!list) return; const items = Array.from(list.querySelectorAll('.item-list-entry')); if (items.length === 0) return; const activeId = type === CONSTANTS.ITEM_TYPE.FOLDER ? state.activeFolderId : state.activeNoteId; const currentIndex = items.findIndex(item => item.dataset.id === activeId); const nextIndex = currentIndex === -1 ? (direction === 1 ? 0 : items.length - 1) : (currentIndex + direction + items.length) % items.length; const nextId = items[nextIndex]?.dataset.id; if (!nextId) return; if (type === CONSTANTS.ITEM_TYPE.FOLDER) await changeActiveFolder(nextId); else await changeActiveNote(nextId); setTimeout(() => _focusAndScrollToListItem(list, nextId), 50); } finally { clearTimeout(keyboardNavDebounceTimer); keyboardNavDebounceTimer = setTimeout(saveSession, CONSTANTS.DEBOUNCE_DELAY.KEY_NAV); setTimeout(() => { isListNavigating = false; }, 50); } };
const handleListKeyDown = async (e, type) => { if (state.renamingItemId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return; } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); await _navigateList(type, e.key === 'ArrowUp' ? -1 : 1); } else if (e.key === 'Enter') { e.preventDefault(); if (type === CONSTANTS.ITEM_TYPE.FOLDER) { noteList.querySelector('.item-list-entry')?.focus() || searchInput?.focus(); } else if (type === CONSTANTS.ITEM_TYPE.NOTE && state.activeNoteId) { noteTitleInput?.focus(); } } else if (e.key === 'Tab' && !e.shiftKey && type === CONSTANTS.ITEM_TYPE.NOTE) { if (state.activeNoteId && noteContentTextarea) { e.preventDefault(); noteContentTextarea.focus(); } } };
const handleGlobalKeyDown = async (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

    if (e.altKey && !isCtrlOrCmd && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.shiftKey ? handleAddFolder() : handleAddNote();
        return;
    }
    if (e.key.toLowerCase() === 'f2') {
        e.preventDefault();
        const activeListItem = document.activeElement.closest('.item-list-entry');
        if (activeListItem?.dataset.id && activeListItem.dataset.type) {
            startRename(activeListItem, activeListItem.dataset.type);
        }
        return;
    }
    // [기능 추가] 수동 저장을 위한 Ctrl+S (Cmd+S) 단축키
    if (isCtrlOrCmd && e.key.toLowerCase() === 's') {
        e.preventDefault(); // 브라우저의 '페이지 저장' 동작을 막습니다.
        if (state.activeNoteId && state.isDirty) {
            await saveCurrentNoteIfChanged();
        }
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const activeEl = document.activeElement;
        const isInputArea = ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeEl.tagName) || activeEl.isContentEditable;
        if (state.activeNoteId && !isInputArea && !activeEl.closest('.item-list')) {
            e.preventDefault();
            handleListKeyDown(e, CONSTANTS.ITEM_TYPE.NOTE);
        }
    }
};
const handleRename = (e, type) => { const li = e.target.closest('.item-list-entry'); if (li) startRename(li, type); };
const setupSplitter = (splitterId, cssVarName, settingsKey, sliderElement, inputElement) => { const splitter = document.getElementById(splitterId); if (!splitter) return; const onMouseMove = (e) => { e.preventDefault(); const container = document.querySelector('.container'); const containerRect = container.getBoundingClientRect(); let newPanelWidth = (splitterId === 'splitter-1') ? e.clientX - containerRect.left : e.clientX - document.getElementById('folders-panel').getBoundingClientRect().right; let newPanelPercentage = Math.max(10, Math.min((newPanelWidth / containerRect.width) * 100, 50)); document.documentElement.style.setProperty(cssVarName, `${newPanelPercentage}%`); const roundedValue = Math.round(newPanelPercentage); if (sliderElement) sliderElement.value = roundedValue; if (inputElement) inputElement.value = roundedValue; }; const onMouseUp = () => { splitter.classList.remove('dragging'); document.body.style.cursor = 'default'; document.body.style.userSelect = 'auto'; window.removeEventListener('mousemove', onMouseMove); if (sliderElement) { appSettings.layout[settingsKey] = parseInt(sliderElement.value, 10); localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings)); } }; splitter.addEventListener('mousedown', (e) => { e.preventDefault(); splitter.classList.add('dragging'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp, { once: true }); }); };
const setupZenModeResize = () => { const leftHandle = document.getElementById('zen-resize-handle-left'); const rightHandle = document.getElementById('zen-resize-handle-right'); const mainContent = document.querySelector('.main-content'); if (!leftHandle || !rightHandle || !mainContent) return; const initResize = (handle) => { handle.addEventListener('mousedown', (e) => { e.preventDefault(); const startX = e.clientX, startWidth = mainContent.offsetWidth; const onMouseMove = (moveEvent) => { const deltaX = moveEvent.clientX - startX; let newWidth = startWidth + (handle.id === 'zen-resize-handle-right' ? deltaX * 2 : -deltaX * 2); newWidth = Math.max(parseInt(settingsZenMaxWidth.min, 10), Math.min(newWidth, parseInt(settingsZenMaxWidth.max, 10))); const roundedWidth = Math.round(newWidth); document.documentElement.style.setProperty('--zen-max-width', `${roundedWidth}px`); settingsZenMaxWidth.value = roundedWidth; settingsZenMaxInput.value = roundedWidth; }; const onMouseUp = () => { window.removeEventListener('mousemove', onMouseMove); appSettings.zenMode.maxWidth = parseInt(settingsZenMaxWidth.value, 10); localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings)); }; window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp, { once: true }); }); }; initResize(leftHandle); initResize(rightHandle); };
const setupEventListeners = () => {
    // [BUG FIX] 모든 이벤트 리스너 바인딩 전에 null 체크를 일관되게 적용합니다.
    if (folderList) {
        folderList.addEventListener('click', e => handleListClick(e, CONSTANTS.ITEM_TYPE.FOLDER));
        folderList.addEventListener('dblclick', e => handleRename(e, CONSTANTS.ITEM_TYPE.FOLDER));
        folderList.addEventListener('keydown', e => handleListKeyDown(e, CONSTANTS.ITEM_TYPE.FOLDER));
    }
    if (noteList) {
        noteList.addEventListener('click', e => handleListClick(e, CONSTANTS.ITEM_TYPE.NOTE));
        noteList.addEventListener('dblclick', e => handleRename(e, CONSTANTS.ITEM_TYPE.NOTE));
        noteList.addEventListener('keydown', e => handleListKeyDown(e, CONSTANTS.ITEM_TYPE.NOTE));
    }
    if (addFolderBtn) addFolderBtn.addEventListener('click', handleAddFolder);
    if (addNoteBtn) addNoteBtn.addEventListener('click', handleAddNote);
    if (emptyTrashBtn) emptyTrashBtn.addEventListener('click', handleEmptyTrash);
    if (noteTitleInput) {
        noteTitleInput.addEventListener('input', handleUserInput);
        // [BUG FIX] blur 이벤트 핸들러를 async로 만들고 saveCurrentNoteIfChanged를 await 합니다.
        noteTitleInput.addEventListener('blur', async () => await saveCurrentNoteIfChanged());
        noteTitleInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                await saveCurrentNoteIfChanged();
                noteContentTextarea.focus();
            }
        });
    }
    if (noteContentTextarea) {
        noteContentTextarea.addEventListener('input', handleUserInput);
        // [BUG FIX] blur 이벤트 핸들러를 async로 만들고 saveCurrentNoteIfChanged를 await 합니다.
        noteContentTextarea.addEventListener('blur', async () => await saveCurrentNoteIfChanged());
        noteContentTextarea.addEventListener('keydown', handleTextareaKeyDown);
    }
    if (searchInput) searchInput.addEventListener('input', handleSearchInput);
    if (clearSearchBtn) clearSearchBtn.addEventListener('click', handleClearSearch);
    if (noteSortSelect) noteSortSelect.addEventListener('change', handleSortChange);
    if (shortcutGuideBtn) shortcutGuideBtn.addEventListener('click', showShortcutModal);
    
    // 이 함수들은 내부에서 null 체크를 수행하도록 수정되었거나, 원래부터 방어적으로 작성되었습니다.
    setupSettingsModal();
    setupSplitter('splitter-1', '--column-folders-width', 'col1', settingsCol1Width, settingsCol1Input);
    setupSplitter('splitter-2', '--column-notes-width', 'col2', settingsCol2Width, settingsCol2Input);
    setupZenModeResize();
};

const setupFeatureToggles = () => {
    const zenModeToggleBtn = document.getElementById('zen-mode-toggle-btn');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const markdownToggleBtn = document.getElementById('markdown-toggle-btn');

    if (markdownToggleBtn) {
        markdownToggleBtn.addEventListener('click', async () => {
            if (!state.isMarkdownView) {
                if (!(await confirmNavigation())) return;
            }
            setState({ isMarkdownView: !state.isMarkdownView });
        });
    }

    if (zenModeToggleBtn) {
        const zenModeActive = localStorage.getItem('mothnote-zen-mode') === 'true';
        if (zenModeActive) document.body.classList.add('zen-mode');
        zenModeToggleBtn.textContent = zenModeActive ? '↔️' : '🧘';
        zenModeToggleBtn.title = zenModeActive ? '↔️ 젠 모드 종료' : '🧘 젠 모드';
        zenModeToggleBtn.addEventListener('click', async () => {
            if (!(await confirmNavigation())) return;
            const isActive = document.body.classList.toggle('zen-mode');
            localStorage.setItem('mothnote-zen-mode', isActive);
            zenModeToggleBtn.textContent = isActive ? '↔️' : '🧘';
            zenModeToggleBtn.title = isActive ? '↔️ 젠 모드 종료' : '🧘 젠 모드';
        });
    }

    if(themeToggleBtn) {
        const currentTheme = localStorage.getItem('theme');
        if (currentTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggleBtn.textContent = '☀️';
        }

        // [수정] FOUC 방지를 위해 테마 적용이 완료되었음을 알리는 클래스를 추가합니다.
        document.body.classList.add('theme-applied');

        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
            localStorage.setItem('theme', theme);

            // [BUG FIX] 테마 변경 버튼에서 직접 시계 다시 그리기를 호출하지 않습니다.
            // Dashboard.init()에 설정된 MutationObserver가 body의 class 변경을 감지하고
            // 자동으로 시계를 다시 그리므로, 레이스 컨디션이 발생하지 않습니다.
            if (dashboard) {
                const message = { type: 'setTheme', theme: theme };
                // [기능 추가] 모든 iframe에 테마 변경 메시지 전송
                if (dashboard.dom.weatherIframe?.contentWindow) {
                    dashboard.dom.weatherIframe.contentWindow.postMessage(message, window.location.origin);
                }
                if (dashboard.dom.habitTrackerIframe?.contentWindow) {
                    dashboard.dom.habitTrackerIframe.contentWindow.postMessage(message, window.location.origin);
                }
                if (dashboard.dom.dietChallengeIframe?.contentWindow) {
                    dashboard.dom.dietChallengeIframe.contentWindow.postMessage(message, window.location.origin);
                }
            }
        });
    }
};

const initializeDragAndDrop = () => { setupDragAndDrop(folderList, CONSTANTS.ITEM_TYPE.FOLDER); setupDragAndDrop(noteList, CONSTANTS.ITEM_TYPE.NOTE); setupNoteToFolderDrop(); };

const setupGlobalEventListeners = () => {
    window.addEventListener('unload', () => {
        saveSession();
    });
    
    // [BUG FIX] visibilitychange 이벤트 핸들러를 async로 만들고 내부 함수들을 await 합니다.
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
            await saveCurrentNoteIfChanged();
            await finishPendingRename();
        }
    });
    
    // 데이터 유실 방지를 위해 beforeunload 핸들러 로직 전면 수정
    window.addEventListener('beforeunload', (e) => {
        const isNoteDirty = state.isDirty && state.dirtyNoteId;
        const isRenaming = !!state.renamingItemId;

        // 저장되지 않은 노트 수정 또는 이름 변경 작업이 진행 중일 때
        if ((isNoteDirty || isRenaming) && !window.isImporting) {
            const message = '저장되지 않은 변경사항이 있습니다. 정말로 페이지를 나가시겠습니까?';
            e.preventDefault();
            e.returnValue = message;

            // 복잡한 데이터 조작 대신, 안전하게 변경사항 '원시 정보'만 기록
            try {
                const changesToBackup = {};
                let hasChanges = false;

                if (isNoteDirty) {
                    changesToBackup.noteUpdate = {
                        noteId: state.dirtyNoteId,
                        title: noteTitleInput.value,
                        content: noteContentTextarea.value
                    };
                    hasChanges = true;
                }

                if (isRenaming) {
                    // [CRITICAL BUG FIX] DOMException 방지를 위해 CSS.escape()를 사용하여 ID를 안전하게 만듭니다.
                    const safeRenamingId = typeof state.renamingItemId === 'string' ? CSS.escape(state.renamingItemId) : state.renamingItemId;
                    const renamingElement = document.querySelector(`.item-list-entry[data-id="${safeRenamingId}"]`);
                    const nameSpan = renamingElement?.querySelector('.item-name');
                    if (renamingElement && nameSpan) {
                        const newName = nameSpan.textContent.trim();
                        // 빈 이름이 아닌 경우에만 백업
                        if (newName) {
                            changesToBackup.itemRename = {
                                id: state.renamingItemId,
                                type: renamingElement.dataset.type,
                                newName: newName
                            };
                            hasChanges = true;
                        }
                    }
                }
                
                // 유효한 변경사항이 있을 때만 백업 파일을 생성
                if (hasChanges) {
                    localStorage.setItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP, JSON.stringify(changesToBackup));
                } else {
                    // 유효한 변경사항이 없으면 기존 백업을 제거하여 혼동 방지
                    localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                }
            } catch (err) {
                console.error("Emergency changes backup failed:", err);
            }
            
            // 경고 메시지를 반환하여 페이지 이탈을 막음
            return message;
        }
    
        if (window.isImporting) {
            const message = '데이터 가져오기 작업이 진행 중입니다. 이 페이지를 나가면 작업이 취소될 수 있습니다.';
            e.preventDefault();
            e.returnValue = message;
            return message;
        }
    });
    
    window.addEventListener('keydown', handleGlobalKeyDown);
};

const init = async () => {
    try {
        window.isInitializing = true;
        
        // --- 1. 핵심 경로 초기화 (실패 시 앱 전체 중단) ---
        // 이 블록의 기능들은 앱의 기본 동작을 위해 반드시 성공해야 합니다.
        setupEventListeners();
        setupImportHandler();
        setupGlobalEventListeners();
        subscribe(renderAll);
        
        const { recoveryMessage } = await loadData();
        if (recoveryMessage) {
            showToast(recoveryMessage, CONSTANTS.TOAST_TYPE.SUCCESS, 8000);
        }

    } catch (e) {
        // 핵심 경로 실패는 복구가 거의 불가능하므로 사용자에게 심각한 오류를 알립니다.
        console.error("Critical initialization failed, app cannot start:", e);
        showToast("앱의 핵심 기능을 불러오는 데 실패했습니다. 확장 프로그램을 재설치해야 할 수 있습니다.", CONSTANTS.TOAST_TYPE.ERROR, 0);
        // finally 블록에서 isInitializing 플래그가 설정되도록 여기서 함수를 종료합니다.
        return;
    } finally {
        // 성공하든 실패하든 초기화 상태 플래그는 해제합니다.
        window.isInitializing = false;
    }

    // --- 2. 부가 기능 초기화 (개별 실패 처리) ---
    // 이 블록의 기능들은 실패하더라도 앱의 핵심 기능(노트 작성/읽기)은 계속 동작해야 합니다.
    
    try {
        // 대시보드는 가장 복잡하고 실패 가능성이 있는 부가 기능입니다.
        dashboard = new Dashboard();
        
        // 대시보드에 의존하는 구독 로직을 이 블록 안으로 이동시킵니다.
        let prevState = { ...state };
        subscribe(() => {
            if (prevState.dateFilter && !state.dateFilter && dashboard) {
                dashboard.resetCalendarDate();
                dashboard.renderCalendar();
            }
            prevState = { ...state };
        });

        dashboard.init();
        setCalendarRenderer(dashboard.renderCalendar.bind(dashboard));
    } catch (e) {
        console.warn("Dashboard module failed to initialize. The app will continue without it.", e);
        // 사용자에게는 방해되는 오류 메시지를 보여주지 않습니다.
    }

    try {
        // 설정 로딩/적용은 실패하더라도 기본값으로 동작할 수 있습니다.
        loadAndApplySettings();
    } catch(e) {
        console.warn("Failed to load and apply settings. Using default values.", e);
    }
    
    try {
        // UI 토글 버튼(젠모드, 테마) 설정
        setupFeatureToggles();
    } catch(e) {
        console.warn("Feature toggles (Zen mode, Theme) failed to initialize.", e);
    }

    try {
        // 드래그 앤 드롭 기능 설정
        initializeDragAndDrop();
    } catch(e) {
        console.warn("Drag and Drop functionality failed to initialize.", e);
    }
    
    try {
        // 꾸밈 효과(Ripple) 설정
        setupRippleEffect();
    } catch(e) {
        console.warn("Ripple effect setup failed.", e);
    }
};

document.addEventListener('DOMContentLoaded', init);