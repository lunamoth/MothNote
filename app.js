import { state, subscribe, setState, findFolder, findNote, CONSTANTS, buildNoteMap } from './state.js';
import { loadData, saveData, handleExport, handleImport, setupImportHandler, saveSession, sanitizeSettings } from './storage.js';
import {
    folderList, noteList, addFolderBtn, addNoteBtn, emptyTrashBtn, searchInput, clearSearchBtn, noteSortSelect,
    noteTitleInput, noteContentTextarea, shortcutGuideBtn, settingsBtn,
    showToast, showShortcutModal, sortNotes, showDatePickerPopover, showConfirm as showConfirmModal,
    settingsModal, settingsModalCloseBtn, settingsTabs, settingsTabPanels,
    settingsCol1Width, settingsCol1Value, settingsCol2Width, settingsCol2Value,
    settingsEditorFontFamily, settingsEditorFontSize,
    settingsWeatherLat, settingsWeatherLon,
    settingsExportBtn, settingsImportBtn, settingsResetBtn, settingsSaveBtn,
    settingsWeatherCitySearch, settingsWeatherCitySearchBtn, settingsWeatherCityResults
} from './components.js';
import { renderAll, clearSortedNotesCache } from './renderer.js';
import { 
    handleAddFolder, handleAddNote, handleEmptyTrash, handlePinNote,
    handleDelete, handleRestoreItem, handlePermanentlyDeleteItem,
    startRename, handleNoteUpdate, handleToggleFavorite, setCalendarRenderer,
    finishPendingRename,
    toYYYYMMDD
} from './itemActions.js';
import { 
    changeActiveFolder, changeActiveNote, handleSearchInput, 
    handleClearSearch, handleSortChange, confirmNavigation 
} from './navigationActions.js';


// --- 설정 관련 로직 ---
let appSettings = { ...CONSTANTS.DEFAULT_SETTINGS };
let isSavingSettings = false;

const settingsZenMaxWidth = document.getElementById('settings-zen-max-width');
const settingsZenMaxValue = document.getElementById('settings-zen-max-value');

const applySettings = (settings) => {
    const root = document.documentElement;

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
    await handleNoteUpdate(true);

    settingsCol1Width.value = appSettings.layout.col1;
    settingsCol1Value.textContent = `${appSettings.layout.col1}%`;
    settingsCol2Width.value = appSettings.layout.col2;
    settingsCol2Value.textContent = `${appSettings.layout.col2}%`;
    settingsZenMaxWidth.value = appSettings.zenMode.maxWidth;
    settingsZenMaxValue.textContent = `${appSettings.zenMode.maxWidth}px`;
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
    } else {
        finalFontFamily = CONSTANTS.DEFAULT_SETTINGS.editor.fontFamily;
        settingsEditorFontFamily.value = finalFontFamily;
    }

    let lat = parseFloat(settingsWeatherLat.value);
    let lon = parseFloat(settingsWeatherLon.value);

    if (isNaN(lat) || lat < -90 || lat > 90) {
        showToast('유효하지 않은 위도 값입니다. (-90 ~ 90)', CONSTANTS.TOAST_TYPE.ERROR);
        settingsWeatherLat.focus();
        return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
        showToast('유효하지 않은 경도 값입니다. (-180 ~ 180)', CONSTANTS.TOAST_TYPE.ERROR);
        settingsWeatherLon.focus();
        return;
    }

    const newSettings = {
        layout: {
            col1: parseInt(settingsCol1Width.value, 10),
            col2: parseInt(settingsCol2Width.value, 10),
        },
        zenMode: {
            maxWidth: parseInt(settingsZenMaxWidth.value, 10)
        },
        editor: {
            fontFamily: finalFontFamily,
            fontSize: parseInt(settingsEditorFontSize.value, 10) || CONSTANTS.DEFAULT_SETTINGS.editor.fontSize,
        },
        weather: {
            lat: lat,
            lon: lon,
        }
    };

    appSettings = newSettings;
    localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
    
    localStorage.removeItem(CONSTANTS.DASHBOARD.WEATHER_CACHE_KEY);
    applySettings(appSettings);
    
    showToast(CONSTANTS.MESSAGES.SUCCESS.SETTINGS_SAVED);
    settingsModal.close();
    
    setTimeout(() => {
        if (dashboard) {
            dashboard.fetchWeather();
        }
    }, 100);
};


const handleSettingsReset = async () => {
    const ok = await showConfirmModal({
        title: '⚙️ 설정 초기화',
        message: '모든 설정을 기본값으로 되돌리시겠습니까? 이 작업은 즉시 저장됩니다.',
        confirmText: '초기화 및 저장',
        confirmButtonType: 'danger'
    });
    if (ok) {
        appSettings = JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
        applySettings(appSettings);

        settingsCol1Width.value = appSettings.layout.col1;
        settingsCol1Value.textContent = `${appSettings.layout.col1}%`;
        settingsCol2Width.value = appSettings.layout.col2;
        settingsCol2Value.textContent = `${appSettings.layout.col2}%`;
        settingsZenMaxWidth.value = appSettings.zenMode.maxWidth;
        settingsZenMaxValue.textContent = `${appSettings.zenMode.maxWidth}px`;
        settingsEditorFontFamily.value = appSettings.editor.fontFamily;
        settingsEditorFontSize.value = appSettings.editor.fontSize;
        settingsWeatherLat.value = appSettings.weather.lat;
        settingsWeatherLon.value = appSettings.weather.lon;

        showToast(CONSTANTS.MESSAGES.SUCCESS.SETTINGS_RESET);
        settingsModal.close();
    } else {
        applySettings(appSettings);
    }
};

const handleWeatherCitySearch = async () => {
    const query = settingsWeatherCitySearch.value.trim();
    if (query.length < 2) {
        settingsWeatherCityResults.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
        if (!response.ok) throw new Error('Network response was not ok.');
        const data = await response.json();
        
        settingsWeatherCityResults.innerHTML = '';
        if (data.results && data.results.length > 0) {
            data.results.forEach(city => {
                const li = document.createElement('li');
                let displayName = city.name;
                if (city.admin1) displayName += `, ${city.admin1}`;
                if (city.country) displayName += `, ${city.country}`;
                
                li.textContent = displayName;
                li.dataset.lat = city.latitude;
                li.dataset.lon = city.longitude;
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
            settingsWeatherCityResults.style.display = 'none';
            showToast(CONSTANTS.MESSAGES.ERROR.WEATHER_CITY_NOT_FOUND, CONSTANTS.TOAST_TYPE.ERROR);
        }
    } catch (error) {
        console.error('Error fetching city data:', error);
        settingsWeatherCityResults.style.display = 'none';
    }
};

const setupSettingsModal = () => {
    settingsBtn.addEventListener('click', openSettingsModal);
    settingsModalCloseBtn.addEventListener('click', () => settingsModal.close());
    settingsSaveBtn.addEventListener('click', handleSettingsSave);
    settingsResetBtn.addEventListener('click', handleSettingsReset);
    settingsExportBtn.addEventListener('click', () => handleExport(appSettings));
    settingsImportBtn.addEventListener('click', handleImport);

    settingsModal.addEventListener('close', () => {
        if (!isSavingSettings) {
            applySettings(appSettings);
        }
        isSavingSettings = false;
    });

    settingsTabs.addEventListener('click', (e) => {
        const target = e.target.closest('.settings-tab-btn');
        if (!target) return;
        
        document.querySelector('.settings-tab-btn.active').classList.remove('active');
        target.classList.add('active');
        
        document.querySelector('.settings-tab-panel.active').classList.remove('active');
        document.getElementById(`settings-tab-${target.dataset.tab}`).classList.add('active');
    });
    
    const updateSliderValue = (slider, valueEl, unit, isCol1) => {
        const value = slider.value;
        valueEl.textContent = `${value}${unit}`;
        const root = document.documentElement;
        if (isCol1 !== undefined) {
            if (isCol1) root.style.setProperty('--column-folders-width', `${value}%`);
            else root.style.setProperty('--column-notes-width', `${value}%`);
        } else if (unit === 'px') {
             root.style.setProperty('--zen-max-width', `${value}px`);
        }
    };

    settingsCol1Width.addEventListener('input', () => updateSliderValue(settingsCol1Width, settingsCol1Value, '%', true));
    settingsCol2Width.addEventListener('input', () => updateSliderValue(settingsCol2Width, settingsCol2Value, '%', false));
    settingsZenMaxWidth.addEventListener('input', () => updateSliderValue(settingsZenMaxWidth, settingsZenMaxValue, 'px'));
    
    settingsEditorFontFamily.addEventListener('input', (e) => {
        document.documentElement.style.setProperty('--editor-font-family', e.target.value);
    });
    settingsEditorFontSize.addEventListener('input', (e) => {
        document.documentElement.style.setProperty('--editor-font-size', `${e.target.value}px`);
    });

    settingsWeatherCitySearchBtn.addEventListener('click', handleWeatherCitySearch);
    settingsWeatherCitySearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleWeatherCitySearch();
        }
    });

    document.addEventListener('click', (e) => {
        if (!settingsWeatherCitySearch.contains(e.target) && !settingsWeatherCityResults.contains(e.target)) {
            settingsWeatherCityResults.style.display = 'none';
        }
    });
};

// --- 대시보드 클래스 ---
class Dashboard {
    constructor() {
        this.dom = {
            digitalClock: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.digitalClock),
            analogClockCanvas: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.analogClockCanvas),
            weatherContainer: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.weatherContainer),
            calendarGrid: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.calendarGrid),
            calendarMonthYear: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.calendarMonthYear),
            prevMonthBtn: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.prevMonthBtn),
            nextMonthBtn: document.getElementById(CONSTANTS.DASHBOARD.DOM_IDS.nextMonthBtn),
        };
        this.internalState = {
            currentDate: state.dateFilter ? new Date(state.dateFilter) : new Date(),
            analogClockAnimationId: null,
            weatherFetchController: null,
            displayedMonth: null,
        };
    }

    init() {
        this._updateDigitalClock();
        setInterval(this._updateDigitalClock.bind(this), 1000);
        this._initAnalogClock();
        if (document.body) {
            new MutationObserver(this._initAnalogClock.bind(this)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
        this.fetchWeather();
        this.renderCalendar();
        this._setupCalendarEvents();
        window.addEventListener('unload', () => {
            if (this.internalState.weatherFetchController) this.internalState.weatherFetchController.abort();
        });
    }

    _getWeatherInfo(wmoCode, isDay = true) {
        let weather = CONSTANTS.DASHBOARD.WMO_MAP[wmoCode] ?? { icon: "❓", text: "알 수 없음" };
        if (!isDay) {
            if (wmoCode === 0) weather = { icon: "🌙", text: "맑음 (밤)" };
            else if (wmoCode === 1) weather = { icon: "☁️🌙", text: "대체로 맑음 (밤)" };
        }
        return weather;
    }

    _updateDigitalClock() {
        if (!this.dom.digitalClock) return;
        this.dom.digitalClock.textContent = new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true });
    }

    _initAnalogClock() {
        if (!this.dom.analogClockCanvas) return;
        if (this.internalState.analogClockAnimationId) cancelAnimationFrame(this.internalState.analogClockAnimationId);

        const ctx = this.dom.analogClockCanvas.getContext('2d');
        const radius = this.dom.analogClockCanvas.height / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(radius, radius);

        const drawHand = (pos, length, width, color) => {
            ctx.beginPath(); ctx.lineWidth = width; ctx.lineCap = 'round';
            ctx.strokeStyle = color || getComputedStyle(document.documentElement).getPropertyValue('--font-color').trim();
            ctx.moveTo(0, 0); ctx.rotate(pos); ctx.lineTo(length, 0); ctx.stroke(); ctx.rotate(-pos);
        };
        const drawNumbers = (ctx, radius) => {
            ctx.beginPath(); const style = getComputedStyle(document.documentElement);
            ctx.font = `${radius * 0.2}px sans-serif`;
            ctx.fillStyle = style.getPropertyValue('--font-color-dim').trim();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (let num = 1; num <= 12; num++) {
                const angle = num * Math.PI / 6;
                const x = radius * 0.85 * Math.cos(angle - Math.PI / 2);
                const y = radius * 0.85 * Math.sin(angle - Math.PI / 2);
                ctx.fillText(num.toString(), x, y);
            }
        };
        const drawClock = () => {
            const style = getComputedStyle(document.documentElement);
            const accentColor = style.getPropertyValue('--accent-color').trim(); 

            ctx.clearRect(-radius, -radius, this.dom.analogClockCanvas.width, this.dom.analogClockCanvas.height);
            ctx.beginPath(); ctx.arc(0, 0, radius * 0.95, 0, 2 * Math.PI); ctx.strokeStyle = style.getPropertyValue('--font-color-dim').trim(); ctx.lineWidth = 2; ctx.stroke();
            drawNumbers(ctx, radius);
            ctx.beginPath(); ctx.arc(0, 0, radius * 0.05, 0, 2 * Math.PI); ctx.fillStyle = accentColor; ctx.fill();
            
            const now = new Date(), h = now.getHours(), m = now.getMinutes();

            drawHand((h % 12 + m / 60) * (Math.PI / 6) - Math.PI / 2, radius * 0.5, radius * 0.07, accentColor);
            drawHand(m * (Math.PI / 30) - Math.PI / 2, radius * 0.75, radius * 0.05, accentColor);
        };

        let lastMinute = -1;
        const animate = () => {
            const now = new Date();
            const currentMinute = now.getMinutes();

            if (currentMinute !== lastMinute) {
                drawClock();
                lastMinute = currentMinute;
            }
            this.internalState.analogClockAnimationId = requestAnimationFrame(animate);
        };
        
        requestAnimationFrame(animate);
    }

    async fetchWeather() {
        if (!this.dom.weatherContainer) return;
        const WEATHER_CACHE_KEY = CONSTANTS.DASHBOARD.WEATHER_CACHE_KEY, CACHE_DURATION_MINUTES = 10;
        try {
            const cachedData = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
            const now = new Date().getTime();
            if (cachedData && (now - cachedData.timestamp < CACHE_DURATION_MINUTES * 60 * 1000)) {
                const { weather, temp } = cachedData.data;
                this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="${weather.text}">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`;
                return;
            }
        } catch (e) { console.warn("Could not read weather cache.", e); }
        if (this.internalState.weatherFetchController) this.internalState.weatherFetchController.abort();
        this.internalState.weatherFetchController = new AbortController();
        const signal = this.internalState.weatherFetchController.signal;
        this.dom.weatherContainer.innerHTML = `<span>...</span>`;
        try {
            const { lat, lon } = appSettings.weather;
            
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="날씨 정보를 불러오는 데 실패했습니다.">⚠️</span>`;
                showToast('잘못된 위도/경도 값입니다. 설정을 확인해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia/Seoul`;
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            const data = await response.json();
            if (!data?.current_weather) throw new Error("API 응답에서 current_weather 객체를 찾을 수 없습니다.");
            const { temperature, weathercode, is_day } = data.current_weather;
            const currentWmoCode = weathercode ?? data.current_weather.weather_code;
            const weather = this._getWeatherInfo(currentWmoCode, is_day === 1);
            const temp = Math.round(temperature);
            this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="${weather.text}">${weather.icon}</span> <span id="weather-temp">${temp}°C</span>`;
            try {
                localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ timestamp: new Date().getTime(), data: { weather, temp } }));
            } catch (e) { console.warn("Could not save weather cache.", e); }
        } catch (error) {
            if (error.name === 'AbortError') return;
            this.dom.weatherContainer.innerHTML = `<span id="weather-icon" title="날씨 정보를 불러오는 데 실패했습니다.">⚠️</span>`;
        }
    }
    
    _updateCalendarHighlights() {
        if (!this.dom.calendarGrid) return;
        const dateCells = this.dom.calendarGrid.querySelectorAll('.date-cell');
        const activeDateStr = state.dateFilter ? toYYYYMMDD(state.dateFilter) : null;
        dateCells.forEach(cell => {
            const dateStr = cell.dataset.date;
            if (!dateStr) return;
            cell.classList.toggle('has-notes', state.noteCreationDates.has(dateStr));
            cell.classList.toggle('active-date', dateStr === activeDateStr);
            cell.title = ''; 
        });
    }

    _drawCalendarGrid() {
        if (!this.dom.calendarGrid || !this.dom.calendarMonthYear) return;
        this.dom.calendarGrid.innerHTML = '';
        const year = this.internalState.currentDate.getFullYear(), month = this.internalState.currentDate.getMonth();
        this.dom.calendarMonthYear.textContent = `${year}년 ${month + 1}월`;
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        days.forEach(day => { const el = document.createElement('div'); el.className = 'calendar-day day-name'; el.textContent = day; this.dom.calendarGrid.appendChild(el); });
        for (let i = 0; i < firstDay; i++) { const el = document.createElement('div'); el.className = 'calendar-day'; this.dom.calendarGrid.appendChild(el); }
        const today = new Date(), todayYear = today.getFullYear(), todayMonth = today.getMonth(), todayDate = today.getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const el = document.createElement('div');
            el.className = 'calendar-day date-cell current-month ripple-effect';
            el.textContent = i;
            if (i === todayDate && year === todayYear && month === todayMonth) el.classList.add('today');
            el.dataset.date = toYYYYMMDD(new Date(year, month, i));
            this.dom.calendarGrid.appendChild(el);
        }
    }

    renderCalendar(forceRedraw = false) {
        const newMonthIdentifier = `${this.internalState.currentDate.getFullYear()}-${this.internalState.currentDate.getMonth()}`;
        if (forceRedraw || this.internalState.displayedMonth !== newMonthIdentifier) {
            this._drawCalendarGrid();
            this.internalState.displayedMonth = newMonthIdentifier;
        }
        this._updateCalendarHighlights();
    }
    
    resetCalendarDate() { this.internalState.currentDate = new Date(); }

    _setupCalendarEvents() {
        if (!this.dom.prevMonthBtn || !this.dom.nextMonthBtn || !this.dom.calendarGrid || !this.dom.calendarMonthYear) return;
        this.dom.prevMonthBtn.onclick = () => { this.internalState.currentDate.setMonth(this.internalState.currentDate.getMonth() - 1); this.renderCalendar(); };
        this.dom.nextMonthBtn.onclick = () => { this.internalState.currentDate.setMonth(this.internalState.currentDate.getMonth() + 1); this.renderCalendar(); };
        this.dom.calendarMonthYear.onclick = async () => {
            const result = await showDatePickerPopover({ initialDate: this.internalState.currentDate });
            if (result) {
                this.internalState.currentDate = new Date(result.year, result.month, 1);
                this.renderCalendar();
            }
        };
        this.dom.calendarGrid.onclick = async e => {
            const target = e.target.closest('.date-cell.has-notes');
            if (target) {
                if (!(await confirmNavigation())) return;
                const newFilterDate = new Date(target.dataset.date);
                const isSameDate = state.dateFilter && new Date(state.dateFilter).getTime() === newFilterDate.getTime();
                
                searchInput.value = '';
                
                if (isSameDate) {
                    setState({ dateFilter: null, activeFolderId: 'all-notes-virtual-id', activeNoteId: null, searchTerm: '' });
                } else {
                    this.internalState.currentDate = newFilterDate;
                    
                    const notesOnDate = Array.from(state.noteMap.values()).map(entry => entry.note).filter(note => {
                        return toYYYYMMDD(note.createdAt) === target.dataset.date;
                    });

                    const sortedNotes = sortNotes(notesOnDate, state.noteSortOrder);
                    const nextActiveNoteId = sortedNotes[0]?.id ?? null;
                    
                    setState({ dateFilter: newFilterDate, activeNoteId: nextActiveNoteId, activeFolderId: null, searchTerm: '' });
                    
                    this.renderCalendar();
                }
            }
        };
        this.dom.calendarGrid.addEventListener('mouseover', e => {
            const target = e.target.closest('.date-cell.has-notes');
            if (target) {
                const dateStr = target.dataset.date;
                const notesOnDate = Array.from(state.noteMap.values()).map(entry => entry.note).filter(note => {
                    return toYYYYMMDD(note.createdAt) === dateStr;
                }).map(note => note.title || '📝 제목 없음');
                if (notesOnDate.length > 0) target.title = `작성된 노트 (${notesOnDate.length}개):\n- ${notesOnDate.join('\n- ')}`;
            }
        });
    }
}


// --- 전역 변수 ---
let keyboardNavDebounceTimer, draggedItemInfo = { id: null, type: null, sourceFolderId: null }, isListNavigating = false, dashboard;

// [개선] 미세 상호작용 - 리플 효과 설정
const setupRippleEffect = () => {
    document.body.addEventListener('click', (e) => {
        const button = e.target.closest('.ripple-effect');
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const ripple = document.createElement('span');
        const diameter = Math.max(button.clientWidth, button.clientHeight);
        const radius = diameter / 2;

        ripple.style.width = ripple.style.height = `${diameter}px`;
        ripple.style.left = `${e.clientX - rect.left - radius}px`;
        ripple.style.top = `${e.clientY - rect.top - radius}px`;
        ripple.classList.add('ripple');
        
        const existingRipple = button.querySelector('.ripple');
        if (existingRipple) {
            existingRipple.remove();
        }

        button.appendChild(ripple);

        setTimeout(() => {
            if (ripple.parentElement) {
                ripple.remove();
            }
        }, 600); // CSS 애니메이션 시간과 일치
    });
};

const handleTextareaKeyDown = (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.target;
        const start = textarea.selectionStart, end = textarea.selectionEnd, text = textarea.value;
        if (e.shiftKey) {
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            if (text.substring(lineStart, lineStart + 1) === '\t') {
                textarea.value = text.substring(0, lineStart) + text.substring(lineStart + 1);
                textarea.selectionStart = Math.max(lineStart, start - 1);
                textarea.selectionEnd = Math.max(lineStart, end - 1);
            }
        } else {
            textarea.value = text.substring(0, start) + '\t' + text.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
        }
        handleNoteUpdate(false);
    }
};

const handleItemActionClick = async (button, id, type) => {
    if (button.classList.contains('pin-btn')) handlePinNote(id);
    else if (button.classList.contains('favorite-btn')) handleToggleFavorite(id);
    else if (button.classList.contains('delete-item-btn')) handleDelete(id, type);
    else if (button.classList.contains('restore-item-btn')) handleRestoreItem(id);
    else if (button.classList.contains('perm-delete-item-btn')) handlePermanentlyDeleteItem(id);
};

const handleListClick = (e, type) => {
    const li = e.target.closest('.item-list-entry');
    if (!li) return;
    const id = li.dataset.id;
    const actionBtn = e.target.closest('.icon-button');
    if (actionBtn) {
        handleItemActionClick(actionBtn, id, li.dataset.type);
        return;
    }
    if (type === CONSTANTS.ITEM_TYPE.FOLDER) changeActiveFolder(id);
    else if (type === CONSTANTS.ITEM_TYPE.NOTE) changeActiveNote(id);
};

const setupDragAndDrop = (listElement, type) => {
    if (!listElement) return;
    let dragOverIndicator;
    const getDragOverIndicator = () => {
        if (!dragOverIndicator) {
            dragOverIndicator = document.createElement('li');
            dragOverIndicator.className = 'drag-over-indicator';
        }
        return dragOverIndicator;
    };
    listElement.addEventListener('dragstart', e => {
        const li = e.target.closest('.item-list-entry');
        if (!li || !li.draggable) { e.preventDefault(); return; }
        draggedItemInfo.id = li.dataset.id;
        draggedItemInfo.type = type;
        if (type === CONSTANTS.ITEM_TYPE.NOTE) {
            const { folder } = findNote(draggedItemInfo.id);
            draggedItemInfo.sourceFolderId = folder?.id;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedItemInfo.id);
        setTimeout(() => li.classList.add(CONSTANTS.CLASSES.DRAGGING), 0);
    });
    listElement.addEventListener('dragover', e => {
        e.preventDefault();
        if (listElement !== folderList) return;
        const indicator = getDragOverIndicator();
        const li = e.target.closest('.item-list-entry');
        
        const hasDraggableItems = listElement.querySelector('.item-list-entry[draggable="true"]');
        if (!hasDraggableItems) {
            listElement.append(indicator);
            return;
        }

        if (!li || li.classList.contains(CONSTANTS.CLASSES.DRAGGING) || !li.draggable) {
            getDragOverIndicator().remove();
            return;
        }
        const rect = li.getBoundingClientRect(), isAfter = e.clientY > rect.top + rect.height / 2;
        if (isAfter) li.after(indicator);
        else li.before(indicator);
    });
    listElement.addEventListener('dragleave', e => {
        if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) getDragOverIndicator().remove();
    });
    listElement.addEventListener('drop', async e => {
        e.preventDefault();
        if (listElement !== folderList) return;
        
        const draggedId = draggedItemInfo.id;
        if (!draggedId) return;
        
        const list = state.folders;
        const fromIndex = list.findIndex(item => item.id === draggedId);
        if (fromIndex === -1) return;

        const indicator = getDragOverIndicator();
        if(!indicator.parentElement) return;

        // [수정] 위치 변경이 없는 경우 저장을 방지하는 로직 추가
        const originalNextElId = list[fromIndex + 1]?.id;
        const dropNextElId = indicator.nextElementSibling?.dataset.id;

        if (originalNextElId === dropNextElId) {
            indicator.remove();
            // 위치 변경이 없어도 드래그 스타일은 제거해야 하므로 상태를 한번 더 업데이트하여 리렌더링.
            setState({}); 
            return;
        }
        
        const [draggedItem] = list.splice(fromIndex, 1);
        const targetEl = indicator.previousElementSibling;
        indicator.remove();

        if (!targetEl) {
            list.unshift(draggedItem);
        } else {
            const toIndex = list.findIndex(item => item.id === targetEl.dataset.id);
            list.splice(toIndex + 1, 0, draggedItem);
        }
        
        buildNoteMap();
        await saveData();
        setState({});
    });
    listElement.addEventListener('dragend', () => {
        const li = listElement.querySelector(`.${CONSTANTS.CLASSES.DRAGGING}`);
        if (li) li.classList.remove(CONSTANTS.CLASSES.DRAGGING);
        getDragOverIndicator().remove();
        if (folderList) {
            const currentDropTarget = folderList.querySelector(`.${CONSTANTS.CLASSES.DROP_TARGET}`);
            if (currentDropTarget) currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET);
        }
        draggedItemInfo = { id: null, type: null, sourceFolderId: null };
    });
};

const setupNoteToFolderDrop = () => {
    if (!folderList) return;
    let currentDropTarget = null;
    folderList.addEventListener('dragenter', e => {
        if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE) return;
        const targetFolderLi = e.target.closest('.item-list-entry');
        if (currentDropTarget && currentDropTarget !== targetFolderLi) {
            currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET);
            currentDropTarget = null;
        }
        if (targetFolderLi) {
            const folderId = targetFolderLi.dataset.id;
            const { ALL, RECENT } = CONSTANTS.VIRTUAL_FOLDERS;
            if (folderId !== draggedItemInfo.sourceFolderId && ![ALL.id, RECENT.id].includes(folderId)) {
                e.preventDefault();
                targetFolderLi.classList.add(CONSTANTS.CLASSES.DROP_TARGET);
                currentDropTarget = targetFolderLi;
            }
        }
    });
    folderList.addEventListener('dragleave', e => {
        if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE) return;
        if (currentDropTarget && !e.currentTarget.contains(e.relatedTarget)) {
            currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET);
            currentDropTarget = null;
        }
    });
    folderList.addEventListener('dragover', e => {
        if (draggedItemInfo.type === CONSTANTS.ITEM_TYPE.NOTE && currentDropTarget) e.preventDefault();
    });
    folderList.addEventListener('drop', async e => {
        e.preventDefault();
        if (draggedItemInfo.type !== CONSTANTS.ITEM_TYPE.NOTE || !currentDropTarget) return;
        if (!(await confirmNavigation())) {
             currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET);
             currentDropTarget = null;
             return;
        }
        const targetFolderId = currentDropTarget.dataset.id, noteId = draggedItemInfo.id;
        currentDropTarget.classList.remove(CONSTANTS.CLASSES.DROP_TARGET);

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        if ([ALL.id, RECENT.id].includes(targetFolderId)) {
            currentDropTarget = null;
            return;
        }

        if (targetFolderId === TRASH.id) await handleDelete(noteId, CONSTANTS.ITEM_TYPE.NOTE, true);
        else if (targetFolderId === FAVORITES.id) {
            const { item: note } = findNote(noteId);
            if (note && !note.isFavorite) await handleToggleFavorite(noteId);
        } else {
            const { folder: sourceFolder } = findNote(noteId);
            const { item: targetFolder } = findFolder(targetFolderId);
            if (sourceFolder && targetFolder && sourceFolder.id !== targetFolder.id) {
                const noteIndex = sourceFolder.notes.findIndex(n => n.id === noteId);
                const [noteToMove] = sourceFolder.notes.splice(noteIndex, 1);
                
                if (state.lastActiveNotePerFolder[sourceFolder.id] === noteId) {
                    delete state.lastActiveNotePerFolder[sourceFolder.id];
                }

                targetFolder.notes.unshift(noteToMove);
                noteToMove.updatedAt = Date.now();
                clearSortedNotesCache();
                buildNoteMap();
                if (dashboard) dashboard.renderCalendar(true);
                await saveData();
                setState({}); 
                showToast(CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_SUCCESS(noteToMove.title, targetFolder.name));
            }
        }
        currentDropTarget = null;
    });
};

const _focusAndScrollToListItem = (listElement, itemId) => {
    const itemEl = listElement.querySelector(`[data-id="${itemId}"]`);
    if (itemEl) {
        itemEl.focus();
        itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
};

const _navigateList = async (type, direction) => {
    if (isListNavigating) return;
    
    isListNavigating = true;
    try {
        await finishPendingRename();

        const list = type === CONSTANTS.ITEM_TYPE.FOLDER ? folderList : noteList;
        if (!list) return;

        const items = Array.from(list.querySelectorAll('.item-list-entry'));
        if (items.length === 0) return;
        
        const activeId = type === CONSTANTS.ITEM_TYPE.FOLDER ? state.activeFolderId : state.activeNoteId;
        const currentIndex = items.findIndex(item => item.dataset.id === activeId);
        const nextIndex = currentIndex === -1 ? (direction === 1 ? 0 : items.length - 1) : (currentIndex + direction + items.length) % items.length;
        const nextItemEl = items[nextIndex];
        if (!nextItemEl) return;

        const nextId = nextItemEl.dataset.id;
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            if (state.activeFolderId !== nextId) await changeActiveFolder(nextId);
        } else {
            if (state.activeNoteId !== nextId) await changeActiveNote(nextId);
        }
        
        setTimeout(() => _focusAndScrollToListItem(list, nextId), 50);
    } finally {
        clearTimeout(keyboardNavDebounceTimer);
        keyboardNavDebounceTimer = setTimeout(saveSession, CONSTANTS.DEBOUNCE_DELAY.KEY_NAV);
        
        setTimeout(() => {
            isListNavigating = false;
        }, 50);
    }
};

const handleListKeyDown = async (e, type) => {
    if (state.renamingItemId) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            return;
        }
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        await _navigateList(type, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            const firstNoteItem = noteList.querySelector('.item-list-entry');
            if (firstNoteItem) {
                firstNoteItem.focus();
            } else if (searchInput) {
                searchInput.focus();
            }
        }
    } else if (e.key === 'Tab' && !e.shiftKey && type === CONSTANTS.ITEM_TYPE.NOTE) {
        if (state.activeNoteId && noteContentTextarea) {
            e.preventDefault();
            noteContentTextarea.focus();
        }
    }
};

const handleGlobalKeyDown = (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            e.shiftKey ? handleAddFolder() : handleAddNote();
            return;
        }
    }
    if (e.key.toLowerCase() === 'f2') {
        e.preventDefault();
        const activeEl = document.activeElement;
        const activeListItem = activeEl.closest('.item-list-entry');
        if (activeListItem && activeListItem.dataset.id && activeListItem.dataset.type) {
            startRename(activeListItem, activeListItem.dataset.type);
        }
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const activeEl = document.activeElement;
        const isInputAreaFocused = ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeEl.tagName) || activeEl.isContentEditable;
        const isListFocused = activeEl.closest('.item-list');
        if (state.activeNoteId && !isInputAreaFocused && !isListFocused) {
            e.preventDefault();
            handleListKeyDown(e, CONSTANTS.ITEM_TYPE.NOTE);
        }
    }
};

const handleRename = (e, type) => {
    const li = e.target.closest('.item-list-entry');
    if (li) {
        startRename(li, type);
    }
};

const setupSplitter = (splitterId, panel1Id, panel2Id, cssVarName, settingsKey, sliderElement, valueElement) => {
    const splitter = document.getElementById(splitterId);
    if (!splitter) return;

    const onMouseMove = (e) => {
        e.preventDefault();
        const container = document.querySelector('.container');
        const containerRect = container.getBoundingClientRect();
        
        let newPanelWidth;
        if (splitterId === 'splitter-1') {
            newPanelWidth = e.clientX - containerRect.left;
        } else { // splitter-2
            const panel1 = document.getElementById(panel1Id);
            newPanelWidth = e.clientX - panel1.getBoundingClientRect().right;
        }

        let newPanelPercentage = (newPanelWidth / containerRect.width) * 100;

        const minWidth = 10;
        const maxWidth = 50;
        newPanelPercentage = Math.max(minWidth, Math.min(newPanelPercentage, maxWidth));
        
        document.documentElement.style.setProperty(cssVarName, `${newPanelPercentage}%`);
        
        if (sliderElement && valueElement) {
            sliderElement.value = newPanelPercentage;
            valueElement.textContent = `${Math.round(newPanelPercentage)}%`;
        }
    };

    const onMouseUp = () => {
        splitter.classList.remove('dragging');
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        window.removeEventListener('mousemove', onMouseMove);
        
        const finalPercentage = parseInt(sliderElement.value, 10);
        appSettings.layout[settingsKey] = finalPercentage;
        localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
    };

    splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        splitter.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
    });
};

const setupZenModeResize = () => {
    const leftHandle = document.getElementById('zen-resize-handle-left');
    const rightHandle = document.getElementById('zen-resize-handle-right');
    const mainContent = document.querySelector('.main-content');
    if (!leftHandle || !rightHandle || !mainContent) return;

    const initResize = (handle) => {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = mainContent.offsetWidth;

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                let newWidth;

                if (handle.id === 'zen-resize-handle-right') {
                    newWidth = startWidth + deltaX * 2;
                } else {
                    newWidth = startWidth - deltaX * 2;
                }

                const min = parseInt(settingsZenMaxWidth.min, 10);
                const max = parseInt(settingsZenMaxWidth.max, 10);
                newWidth = Math.max(min, Math.min(newWidth, max));

                document.documentElement.style.setProperty('--zen-max-width', `${newWidth}px`);
                settingsZenMaxWidth.value = newWidth;
                settingsZenMaxValue.textContent = `${newWidth}px`;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                
                const finalWidth = parseInt(settingsZenMaxWidth.value, 10);
                appSettings.zenMode.maxWidth = finalWidth;
                localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(appSettings));
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp, { once: true });
        });
    };

    initResize(leftHandle);
    initResize(rightHandle);
};

const setupEventListeners = () => {
    if(folderList) {
        folderList.addEventListener('click', e => handleListClick(e, CONSTANTS.ITEM_TYPE.FOLDER));
        folderList.addEventListener('dblclick', e => handleRename(e, CONSTANTS.ITEM_TYPE.FOLDER));
        folderList.addEventListener('keydown', e => handleListKeyDown(e, CONSTANTS.ITEM_TYPE.FOLDER));
    }
    if(noteList) {
        noteList.addEventListener('click', e => handleListClick(e, CONSTANTS.ITEM_TYPE.NOTE));
        noteList.addEventListener('dblclick', e => handleRename(e, CONSTANTS.ITEM_TYPE.NOTE));
        noteList.addEventListener('keydown', e => handleListKeyDown(e, CONSTANTS.ITEM_TYPE.NOTE));
    }
    if(addFolderBtn) addFolderBtn.addEventListener('click', handleAddFolder);
    if(addNoteBtn) addNoteBtn.addEventListener('click', handleAddNote);
    if(emptyTrashBtn) emptyTrashBtn.addEventListener('click', handleEmptyTrash);
    if(noteTitleInput) {
        noteTitleInput.addEventListener('input', () => handleNoteUpdate(false));
        noteTitleInput.addEventListener('blur', () => handleNoteUpdate(true));
    }
    if(noteContentTextarea) {
        noteContentTextarea.addEventListener('input', () => handleNoteUpdate(false));
        noteContentTextarea.addEventListener('blur', () => handleNoteUpdate(true));
        noteContentTextarea.addEventListener('keydown', handleTextareaKeyDown);
    }
    if(searchInput) searchInput.addEventListener('input', handleSearchInput);
    if(clearSearchBtn) clearSearchBtn.addEventListener('click', handleClearSearch);
    if(noteSortSelect) noteSortSelect.addEventListener('change', handleSortChange);
    if(shortcutGuideBtn) shortcutGuideBtn.addEventListener('click', showShortcutModal);
    
    setupSettingsModal();

    setupSplitter('splitter-1', 'folders-panel', 'notes-panel', '--column-folders-width', 'col1', settingsCol1Width, settingsCol1Value);
    setupSplitter('splitter-2', 'folders-panel', 'notes-panel', '--column-notes-width', 'col2', settingsCol2Width, settingsCol2Value);
    setupZenModeResize();
};

const setupFeatureToggles = () => {
    const zenModeToggleBtn = document.getElementById('zen-mode-toggle-btn');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    
    if (zenModeToggleBtn) {
        const ZEN_MODE_KEY = 'mothnote-zen-mode';
        const zenModeActive = localStorage.getItem(ZEN_MODE_KEY) === 'true';

        if (zenModeActive) {
            document.body.classList.add('zen-mode');
        }
        zenModeToggleBtn.textContent = zenModeActive ? '↔️' : '🧘';
        zenModeToggleBtn.title = zenModeActive ? '↔️ 젠 모드 종료' : '🧘 젠 모드';

        zenModeToggleBtn.addEventListener('click', async () => {
            if (!(await confirmNavigation())) {
                return;
            }

            const isActive = document.body.classList.toggle('zen-mode');
            localStorage.setItem(ZEN_MODE_KEY, isActive);
            zenModeToggleBtn.textContent = isActive ? '↔️' : '🧘';
            zenModeToggleBtn.title = isActive ? '↔️ 젠 모드 종료' : '🧘 젠 모드';
        });
    }

    if(themeToggleBtn) {
        const currentTheme = localStorage.getItem('theme');
        if (currentTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggleBtn.textContent = '☀️';
        } else {
            themeToggleBtn.textContent = '🌙';
        }
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            let theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
            localStorage.setItem('theme', theme);
            
            if (dashboard && typeof dashboard._initAnalogClock === 'function') {
                dashboard._initAnalogClock(); 
            }
        });
    }
};

const initializeDragAndDrop = () => {
    setupDragAndDrop(folderList, CONSTANTS.ITEM_TYPE.FOLDER);
    setupDragAndDrop(noteList, CONSTANTS.ITEM_TYPE.NOTE);
    setupNoteToFolderDrop();
};

const setupGlobalEventListeners = () => {
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') handleNoteUpdate(true); });
    window.addEventListener('beforeunload', (e) => { if (state.isDirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('keydown', handleGlobalKeyDown);
};

const init = async () => {
    loadAndApplySettings();

    setupEventListeners();
    setupFeatureToggles();
    initializeDragAndDrop();
    setupImportHandler();
    setupGlobalEventListeners();
    setupRippleEffect(); // [개선] 리플 효과 초기화

    subscribe(renderAll);
    
    let prevState = { ...state };
    subscribe(() => {
        if (prevState.dateFilter && !state.dateFilter && dashboard) {
            dashboard.resetCalendarDate();
            dashboard.renderCalendar();
        }
        prevState = { ...state };
    });

    await loadData();
    
    dashboard = new Dashboard();
    dashboard.init();

    setCalendarRenderer(dashboard.renderCalendar.bind(dashboard));
};

document.addEventListener('DOMContentLoaded', init);