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
    editorContainer
} from './components.js';
import { renderAll, clearSortedNotesCache } from './renderer.js';
// [버그 수정] itemActions.js에서 handleTextareaKeyDown 함수를 가져옵니다.
import { 
    handleAddFolder, handleAddNote, handleEmptyTrash, handlePinNote,
    handleDelete, handleRestoreItem, handlePermanentlyDeleteItem,
    startRename, handleUserInput, saveCurrentNoteIfChanged, handleToggleFavorite, setCalendarRenderer,
    finishPendingRename,
    toYYYYMMDD,
    updateNoteCreationDates,
    forceResolvePendingRename,
    performTransactionalUpdate,
    performDeleteItem,
    handleTextareaKeyDown, // <-- 수정된 부분
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

const openSettingsModal = async () => {
    await finishPendingRename();
    await saveCurrentNoteIfChanged();

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

    // [BUG FIX] parseInt 결과가 NaN일 경우, 기본값으로 대체하여 레이아웃 깨짐을 방지합니다.
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const newSettings = {
        layout: {
            col1: parseInt(settingsCol1Input.value, 10) || defaults.layout.col1,
            col2: parseInt(settingsCol2Input.value, 10) || defaults.layout.col2
        },
        zenMode: {
            maxWidth: parseInt(settingsZenMaxInput.value, 10) || defaults.zenMode.maxWidth
        },
        editor: {
            fontFamily: finalFontFamily,
            fontSize: parseInt(settingsEditorFontSize.value, 10) || defaults.editor.fontSize
        },
        weather: { lat, lon }
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
        };
        this.internalState = { currentDate: state.dateFilter ? new Date(state.dateFilter) : new Date(), analogClockAnimationId: null, digitalClockIntervalId: null, weatherFetchController: null, displayedMonth: null, clockFaceCache: null, };
        this.observer = null;
    }
    init() {
        this._setupVisibilityObserver(); this._initAnalogClock();
        if (document.body) new MutationObserver(() => this._initAnalogClock(true)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        this.fetchWeather(); this.renderCalendar(); this._setupCalendarEvents();
        this._setupWeatherViewEvents();
        window.addEventListener('unload', () => { if (this.internalState.weatherFetchController) this.internalState.weatherFetchController.abort(); this._stopClocks(); });
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
        
        this.dom.weatherIframe.src = `weather.html?lat=${lat}&lon=${lon}&theme=${theme}`;
        
        // 노트와 에디터 패널 숨기기
        this.dom.notesPanel.style.display = 'none';
        this.dom.splitter2.style.display = 'none';
        this.dom.mainContent.style.display = 'none';
        
        // 날씨 뷰 보이기 (display: grid로 변경)
        this.dom.weatherViewContainer.style.display = 'grid';
        
        // [버그 수정] 관련 없는 플로팅 액션 버튼(마크다운, 젠 모드)만 숨깁니다.
        const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
        const zenModeBtn = document.getElementById('zen-mode-toggle-btn');
        
        if (markdownToggleBtn) markdownToggleBtn.style.display = 'none';
        if (zenModeBtn) zenModeBtn.style.display = 'none';
    }

    _closeWeatherView() {
        // 날씨 뷰 숨기기
        this.dom.weatherViewContainer.style.display = 'none';
        this.dom.weatherIframe.src = 'about:blank';
    
        // [BUG FIX] 인라인 스타일을 제거하여 CSS 클래스 기반의 레이아웃 제어가 정상적으로 동작하도록 복원합니다.
        // 이렇게 하면 젠 모드 전환 시 CSS 규칙이 올바르게 적용됩니다.
        this.dom.notesPanel.style.removeProperty('display');
        this.dom.splitter2.style.removeProperty('display');
        this.dom.mainContent.style.removeProperty('display');
    
        // [버그 수정] 숨겼던 플로팅 액션 버튼을 다시 표시합니다.
        // 인라인 스타일을 제거하여 CSS 및 JS(렌더러)가 올바르게 제어하도록 합니다.
        const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
        const zenModeBtn = document.getElementById('zen-mode-toggle-btn');
        
        if (markdownToggleBtn) markdownToggleBtn.style.removeProperty('display');
        if (zenModeBtn) zenModeBtn.style.removeProperty('display');
    }
    
    _setupWeatherViewEvents() {
        if(this.dom.weatherContainer) {
            this.dom.weatherContainer.style.cursor = 'pointer';
            this.dom.weatherContainer.title = '클릭하여 상세 날씨 보기';
            this.dom.weatherContainer.addEventListener('click', () => this._openWeatherView());
        }
        if(this.dom.closeWeatherViewBtn) {
            this.dom.closeWeatherViewBtn.addEventListener('click', () => this._closeWeatherView());
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
    _drawStaticClockFace() { if (!this.dom.analogClockCanvas) return; const cacheCanvas = document.createElement('canvas'); cacheCanvas.width = this.dom.analogClockCanvas.width; cacheCanvas.height = this.dom.analogClockCanvas.height; const ctx = cacheCanvas.getContext('2d'); const radius = cacheCanvas.height / 2; ctx.translate(radius, radius); const drawNumbers = (context, r) => { context.beginPath(); const style = getComputedStyle(document.documentElement); context.font = `${r * 0.2}px sans-serif`; context.fillStyle = style.getPropertyValue('--font-color-dim').trim(); context.textAlign = 'center'; context.textBaseline = 'middle'; for (let num = 1; num <= 12; num++) { const angle = num * Math.PI / 6; context.fillText(num.toString(), r * 0.85 * Math.cos(angle - Math.PI / 2), r * 0.85 * Math.sin(angle - Math.PI / 2)); } }; const style = getComputedStyle(document.documentElement); ctx.beginPath(); ctx.arc(0, 0, radius * 0.95, 0, 2 * Math.PI); ctx.strokeStyle = style.getPropertyValue('--font-color-dim').trim(); ctx.lineWidth = 2; ctx.stroke(); drawNumbers(ctx, radius); ctx.beginPath(); ctx.arc(0, 0, radius * 0.05, 0, 2 * Math.PI); ctx.fillStyle = style.getPropertyValue('--accent-color').trim(); ctx.fill(); this.internalState.clockFaceCache = cacheCanvas; }
    _drawHandsOnTop() { if (!this.dom.analogClockCanvas) return; const ctx = this.dom.analogClockCanvas.getContext('2d'); const radius = this.dom.analogClockCanvas.height / 2; const drawHand = (pos, length, width, color) => { ctx.beginPath(); ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.strokeStyle = color || getComputedStyle(document.documentElement).getPropertyValue('--font-color').trim(); ctx.moveTo(0, 0); ctx.rotate(pos); ctx.lineTo(length, 0); ctx.stroke(); ctx.rotate(-pos); }; ctx.clearRect(-radius, -radius, this.dom.analogClockCanvas.width, this.dom.analogClockCanvas.height); if (this.internalState.clockFaceCache) ctx.drawImage(this.internalState.clockFaceCache, -radius, -radius); const style = getComputedStyle(document.documentElement); const accentColor = style.getPropertyValue('--accent-color').trim(); const now = new Date(), h = now.getHours(), m = now.getMinutes(); drawHand((h % 12 + m / 60) * (Math.PI / 6) - Math.PI / 2, radius * 0.5, radius * 0.07, accentColor); drawHand(m * (Math.PI / 30) - Math.PI / 2, radius * 0.75, radius * 0.05, accentColor); }
    _animateAnalogClock() { let lastMinute = -1; const animate = () => { const now = new Date(); const currentMinute = now.getMinutes(); if (currentMinute !== lastMinute) { this._drawHandsOnTop(); lastMinute = currentMinute; } this.internalState.analogClockAnimationId = requestAnimationFrame(animate); }; this._drawHandsOnTop(); animate(); }
    async fetchWeather() { if (!this.dom.weatherContainer) return; const WEATHER_CACHE_KEY = CONSTANTS.DASHBOARD.WEATHER_CACHE_KEY, CACHE_DURATION_MINUTES = 10; try { const cachedData = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); const now = new Date().getTime(); if (cachedData && (now - cachedData.timestamp < CACHE_DURATION_MINUTES * 60 * 1000)) { const { weather, temp } = cachedData.data; this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="${weather.text}">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`; return; } } catch (e) { console.warn("Could not read weather cache.", e); } if (this.internalState.weatherFetchController) this.internalState.weatherFetchController.abort(); this.internalState.weatherFetchController = new AbortController(); const signal = this.internalState.weatherFetchController.signal; this.dom.weatherContainer.innerHTML = `<span>⏳</span>`; try { const { lat, lon } = appSettings.weather; if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="날씨 정보를 불러오는 데 실패했습니다.">⚠️</span>`; showToast(CONSTANTS.MESSAGES.ERROR.INVALID_LATITUDE, CONSTANTS.TOAST_TYPE.ERROR); return; } const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia/Seoul`; const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`); const data = await response.json(); if (!data?.current_weather) throw new Error("API 응답에서 current_weather 객체를 찾을 수 없습니다."); const { temperature, weathercode, is_day } = data.current_weather; const weather = this._getWeatherInfo(weathercode ?? data.current_weather.weather_code, is_day === 1); const temp = Math.round(temperature); this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="${weather.text}">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`; try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ timestamp: new Date().getTime(), data: { weather, temp } })); } catch (e) { console.warn("Could not save weather cache.", e); } } catch (error) { if (error.name !== 'AbortError') this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="날씨 정보를 불러오는 데 실패했습니다.">⚠️</span>`; } }
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
// [버그 수정] handleTextareaKeyDown 함수를 제거합니다. itemActions.js로 이동되었습니다.
const handleItemActionClick = (button, id, type) => { if (button.classList.contains('pin-btn')) handlePinNote(id); else if (button.classList.contains('favorite-btn')) handleToggleFavorite(id); else if (button.classList.contains('delete-item-btn')) handleDelete(id, type); else if (button.classList.contains('restore-item-btn')) handleRestoreItem(id); else if (button.classList.contains('perm-delete-item-btn')) handlePermanentlyDeleteItem(id); };
const handleListClick = (e, type) => { const li = e.target.closest('.item-list-entry'); if (!li) return; const id = li.dataset.id; const actionBtn = e.target.closest('.icon-button'); if (actionBtn) { handleItemActionClick(actionBtn, id, li.dataset.type); return; } if (type === CONSTANTS.ITEM_TYPE.FOLDER) changeActiveFolder(id); else if (type === CONSTANTS.ITEM_TYPE.NOTE) changeActiveNote(id); };
const setupDragAndDrop = (listElement, type) => { if (!listElement) return; let dragOverIndicator; const getDragOverIndicator = () => { if (!dragOverIndicator) { dragOverIndicator = document.createElement('li'); dragOverIndicator.className = 'drag-over-indicator'; } return dragOverIndicator; }; listElement.addEventListener('dragstart', e => { const li = e.target.closest('.item-list-entry'); if (!li || !li.draggable) { e.preventDefault(); return; } draggedItemInfo.id = li.dataset.id; draggedItemInfo.type = type; if (type === CONSTANTS.ITEM_TYPE.NOTE) { const { folder } = findNote(draggedItemInfo.id); draggedItemInfo.sourceFolderId = folder?.id; } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', draggedItemInfo.id); setTimeout(() => li.classList.add(CONSTANTS.CLASSES.DRAGGING), 0); }); listElement.addEventListener('dragover', e => { e.preventDefault(); if (listElement !== folderList) return; const indicator = getDragOverIndicator(); const li = e.target.closest('.item-list-entry'); const hasDraggableItems = listElement.querySelector('.item-list-entry[draggable="true"]'); if (!hasDraggableItems) { listElement.append(indicator); return; } if (!li || li.classList.contains(CONSTANTS.CLASSES.DRAGGING) || !li.draggable) { getDragOverIndicator().remove(); return; } const rect = li.getBoundingClientRect(), isAfter = e.clientY > rect.top + rect.height / 2; if (isAfter) li.after(indicator); else li.before(indicator); }); listElement.addEventListener('dragleave', e => { if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) getDragOverIndicator().remove(); }); listElement.addEventListener('drop', async e => { e.preventDefault(); if (listElement !== folderList || !draggedItemInfo.id) return; const indicator = getDragOverIndicator(); if(!indicator.parentElement) return; const draggedId = draggedItemInfo.id; const fromIndex = state.folders.findIndex(item => item.id === draggedId); if (fromIndex === -1) return; const originalNextElId = state.folders[fromIndex + 1]?.id; const dropNextElId = indicator.nextElementSibling?.dataset.id; indicator.remove(); if (originalNextElId === dropNextElId) { setState({}); return; } await performTransactionalUpdate((latestData) => { const { folders } = latestData; const fromIdx = folders.findIndex(item => item.id === draggedId); if (fromIdx === -1) return null; const [draggedItem] = folders.splice(fromIdx, 1); let toIdx = folders.findIndex(item => item.id === dropNextElId); if (toIdx === -1) folders.push(draggedItem); else folders.splice(toIdx, 0, draggedItem); draggedItem.updatedAt = Date.now(); return { newData: latestData, successMessage: null, postUpdateState: {} }; }); }); listElement.addEventListener('dragend', () => { const li = listElement.querySelector(`.${CONSTANTS.CLASSES.DRAGGING}`); if (li) li.classList.remove(CONSTANTS.CLASSES.DRAGGING); getDragOverIndicator().remove(); if (folderList) folderList.querySelector(`.${CONSTANTS.CLASSES.DROP_TARGET}`)?.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); draggedItemInfo = { id: null, type: null, sourceFolderId: null }; }); };
const setupNoteToFolderDrop = () => { if (!folderList) return; let currentDropTarget = null; folderList.addEventListener('dragenter', e => { if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE) return; const targetFolderLi = e.target.closest('.item-list-entry'); if (currentDropTarget && currentDropTarget !== targetFolderLi) { currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; } if (targetFolderLi) { const folderId = targetFolderLi.dataset.id; const { ALL, RECENT } = CONSTANTS.VIRTUAL_FOLDERS; if (folderId !== draggedItemInfo.sourceFolderId && ![ALL.id, RECENT.id].includes(folderId)) { e.preventDefault(); targetFolderLi.classList.add(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = targetFolderLi; } } }); folderList.addEventListener('dragleave', e => { if (currentDropTarget && !e.currentTarget.contains(e.relatedTarget)) { currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; } }); folderList.addEventListener('dragover', e => { if (draggedItemInfo.type === CONSTANTS.ITEM_TYPE.NOTE && currentDropTarget) e.preventDefault(); }); folderList.addEventListener('drop', async e => { e.preventDefault(); if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE || !currentDropTarget) return; const targetFolderId = currentDropTarget.dataset.id, noteId = draggedItemInfo.id; currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET); currentDropTarget = null; if (!(await saveCurrentNoteIfChanged())) { showToast("변경사항 저장에 실패하여 노트 이동을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR); return; } const { TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS; if (targetFolderId === TRASH.id) { await performDeleteItem(noteId, CONSTANTS.ITEM_TYPE.NOTE); } else if (targetFolderId === FAVORITES.id) { const { item: note } = findNote(noteId); if (note && !state.favorites.has(noteId)) await handleToggleFavorite(noteId); } else { await performTransactionalUpdate((latestData) => { const { folders } = latestData; let noteToMove, sourceFolder; for (const folder of folders) { const noteIndex = folder.notes.findIndex(n => n.id === noteId); if (noteIndex > -1) { [noteToMove] = folder.notes.splice(noteIndex, 1); sourceFolder = folder; break; } } const targetFolder = folders.find(f => f.id === targetFolderId); if (!noteToMove || !targetFolder || sourceFolder.id === targetFolder.id) return null; const now = Date.now(); noteToMove.updatedAt = now; targetFolder.notes.unshift(noteToMove); sourceFolder.updatedAt = now; targetFolder.updatedAt = now; return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_SUCCESS(noteToMove.title, targetFolder.name), postUpdateState: {} }; }); } }); };
const _focusAndScrollToListItem = (listElement, itemId) => { const itemEl = listElement.querySelector(`[data-id="${itemId}"]`); if (itemEl) { itemEl.focus(); itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
const _navigateList = async (type, direction) => { if (isListNavigating) return; isListNavigating = true; try { await finishPendingRename(); const list = type === CONSTANTS.ITEM_TYPE.FOLDER ? folderList : noteList; if (!list) return; const items = Array.from(list.querySelectorAll('.item-list-entry')); if (items.length === 0) return; const activeId = type === CONSTANTS.ITEM_TYPE.FOLDER ? state.activeFolderId : state.activeNoteId; const currentIndex = items.findIndex(item => item.dataset.id === activeId); const nextIndex = currentIndex === -1 ? (direction === 1 ? 0 : items.length - 1) : (currentIndex + direction + items.length) % items.length; const nextId = items[nextIndex]?.dataset.id; if (!nextId) return; if (type === CONSTANTS.ITEM_TYPE.FOLDER) await changeActiveFolder(nextId); else await changeActiveNote(nextId); setTimeout(() => _focusAndScrollToListItem(list, nextId), 50); } finally { clearTimeout(keyboardNavDebounceTimer); keyboardNavDebounceTimer = setTimeout(saveSession, CONSTANTS.DEBOUNCE_DELAY.KEY_NAV); setTimeout(() => { isListNavigating = false; }, 50); } };
const handleListKeyDown = async (e, type) => { if (state.renamingItemId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return; } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); await _navigateList(type, e.key === 'ArrowUp' ? -1 : 1); } else if (e.key === 'Enter') { e.preventDefault(); if (type === CONSTANTS.ITEM_TYPE.FOLDER) { noteList.querySelector('.item-list-entry')?.focus() || searchInput?.focus(); } else if (type === CONSTANTS.ITEM_TYPE.NOTE && state.activeNoteId) { noteTitleInput?.focus(); } } else if (e.key === 'Tab' && !e.shiftKey && type === CONSTANTS.ITEM_TYPE.NOTE) { if (state.activeNoteId && noteContentTextarea) { e.preventDefault(); noteContentTextarea.focus(); } } };
const handleGlobalKeyDown = (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') { e.preventDefault(); e.shiftKey ? handleAddFolder() : handleAddNote(); return; } if (e.key.toLowerCase() === 'f2') { e.preventDefault(); const activeListItem = document.activeElement.closest('.item-list-entry'); if (activeListItem?.dataset.id && activeListItem.dataset.type) { startRename(activeListItem, activeListItem.dataset.type); } return; } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const activeEl = document.activeElement; const isInputArea = ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeEl.tagName) || activeEl.isContentEditable; if (state.activeNoteId && !isInputArea && !activeEl.closest('.item-list')) { e.preventDefault(); handleListKeyDown(e, CONSTANTS.ITEM_TYPE.NOTE); } } };
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
        noteTitleInput.addEventListener('blur', () => saveCurrentNoteIfChanged());
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
        noteContentTextarea.addEventListener('blur', () => saveCurrentNoteIfChanged());
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
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
            localStorage.setItem('theme', theme);
            if (dashboard) {
                dashboard._initAnalogClock(true);
                // iframe으로 테마 변경 메시지 전송
                const weatherIframe = document.getElementById('weather-iframe');
                if (weatherIframe && weatherIframe.contentWindow) {
                    weatherIframe.contentWindow.postMessage({ type: 'setTheme', theme: theme }, '*');
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
    
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveCurrentNoteIfChanged();
            finishPendingRename();
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
                    const renamingElement = document.querySelector(`.item-list-entry[data-id="${state.renamingItemId}"]`);
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
        
        // [BUG FIX] `dashboard` 객체 참조 오류 해결을 위한 초기화 순서 변경
        // 1. Dashboard 인스턴스를 먼저 생성합니다.
        dashboard = new Dashboard();
        
        // 2. 이제 dashboard 객체가 존재하는 상태에서 설정을 로드하고 적용합니다.
        //    `applySettings` 내부에서 `dashboard.fetchWeather()`가 안전하게 호출될 수 있습니다.
        loadAndApplySettings();
        
        setupEventListeners();
        setupFeatureToggles();
        initializeDragAndDrop();
        setupImportHandler();
        setupGlobalEventListeners();
        setupRippleEffect();
        
        subscribe(renderAll);
        
        let prevState = { ...state };
        subscribe(() => {
            if (prevState.dateFilter && !state.dateFilter && dashboard) {
                dashboard.resetCalendarDate();
                dashboard.renderCalendar();
            }
            prevState = { ...state };
        });

        const { recoveryMessage } = await loadData();
        if (recoveryMessage) {
            showToast(recoveryMessage, CONSTANTS.TOAST_TYPE.SUCCESS, 8000);
        }
        
        // 3. Dashboard의 나머지 초기화 작업을 수행합니다.
        dashboard.init();
        setCalendarRenderer(dashboard.renderCalendar.bind(dashboard));

    } catch (e) {
        console.error("Initialization failed critically:", e);
        showToast("앱 초기화 중 심각한 오류가 발생했습니다. 확장 프로그램을 재설치해야 할 수 있습니다.", CONSTANTS.TOAST_TYPE.ERROR, 0);
    } finally {
        window.isInitializing = false;
    }
};

document.addEventListener('DOMContentLoaded', init);