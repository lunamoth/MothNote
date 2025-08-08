(function WeatherApp() {
    'use strict';

    // --- CONFIGURATION ---
    const CONFIG = {
        // [수정] 위도/경도를 URL 파라미터에서 읽어오도록 변경
        API_BASE_URL: "https://api.open-meteo.com/v1/forecast",
        PARTICLE_DENSITY_SNOW_DIVISOR: 25000,
        PARTICLE_DENSITY_RAIN_DIVISOR: 18000,
        MAX_PARTICLES: 250,
        MODAL_ACTIVE_CLASS: 'active',
        // [수정] 갱신 주기(캐시 유효 시간) 설정
        REFRESH_INTERVAL_MINUTES: 10,
        // [추가] 상세 날씨 페이지 캐시 키
        WEATHER_DETAIL_CACHE_KEY: 'weather_detail_cache_v1',
        // [삭제] 테마 키는 부모 창에서 관리
        WMO_MAP: {0:{description:"맑음",icon:"☀️",effect:null},1:{description:"대체로 맑음",icon:"🌤️",effect:null},2:{description:"부분적 흐림",icon:"🌥️",effect:null},3:{description:"흐림",icon:"☁️",effect:null},45:{description:"안개",icon:"🌫️",effect:null},48:{description:"서리 안개",icon:"🌫️❄️",effect:null},51:{description:"가벼운 이슬비",icon:"💧",effect:"rain"},53:{description:"보통 이슬비",icon:"💧",effect:"rain"},55:{description:"강한 이슬비",icon:"💧",effect:"rain"},56:{description:"가벼운 어는 이슬비",icon:"🥶💧",effect:"rain_snow"},57:{description:"강한 어는 이슬비",icon:"🥶💧",effect:"rain_snow"},61:{description:"가벼운 비",icon:"🌧️",effect:"rain"},63:{description:"보통 비",icon:"🌧️",effect:"rain"},65:{description:"강한 비",icon:"🌧️",effect:"rain"},66:{description:"가벼운 어는 비",icon:"🥶🌧️",effect:"rain_snow"},67:{description:"강한 어는 비",icon:"🥶🌧️",effect:"rain_snow"},71:{description:"가벼운 눈",icon:"❄️",effect:"snow"},73:{description:"보통 눈",icon:"❄️",effect:"snow"},75:{description:"강한 눈",icon:"❄️",effect:"snow"},77:{description:"싸락눈",icon:"❄️",effect:"snow"},80:{description:"가벼운 소나기",icon:"🌦️",effect:"rain"},81:{description:"보통 소나기",icon:"🌦️",effect:"rain"},82:{description:"강한 소나기",icon:"⛈️",effect:"rain"},85:{description:"가벼운 눈 소나기",icon:"🌨️",effect:"snow"},86:{description:"강한 눈 소나기",icon:"🌨️",effect:"snow"},95:{description:"천둥번개",icon:"⛈️",effect:"rain"},96:{description:"가벼운 우박 동반 뇌우",icon:"⛈️🧊",effect:"rain"},99:{description:"강한 우박 동반 뇌우",icon:"⛈️🧊",effect:"rain"}}
    };
    
    // [추가] URL 파라미터에서 위도/경도를 가져오는 로직
    const urlParams = new URLSearchParams(window.location.search);
    const LAT = parseFloat(urlParams.get('lat'));
    const LON = parseFloat(urlParams.get('lon'));
    const THEME = urlParams.get('theme');

    const ICON_ANIMATION_MAP = {
        '☀️': 'sun',
        '☁️': 'anim-cloud-drift',
        '🌥️': 'anim-cloud-drift',
        '🌤️': 'anim-cloud-drift',
        '🌧️': 'anim-rain-drop',
        '💧': 'anim-rain-drop',
        '🌦️': 'anim-rain-drop',
        '⛈️': 'anim-rain-drop',
        '❄️': 'anim-snow-flake',
        '🌨️': 'anim-snow-flake',
    };

    // --- DOM ELEMENT CACHING ---
    const DOM = {
        appContainer: document.getElementById('appContainer'),
        loadingSkeleton: document.getElementById('loadingSkeleton'),
        forecastContainer: document.getElementById('forecastContainer'),
        errorMessage: document.getElementById('error'),
        weatherEffectsCanvas: document.getElementById('weather-effects-canvas'),
        hourlyModal: document.getElementById('hourlyModal'),
        closeModalButton: document.getElementById('closeModalButton'),
        hourlyForecastList: document.getElementById('hourlyForecastList'),
        modalTitle: document.getElementById('modalTitle'),
        aqiSection: document.getElementById('aqiSection'),
        themeToggleButton: document.getElementById('themeToggle'),
        lastUpdated: document.getElementById('lastUpdated'),
        mainTitle: document.getElementById('mainTitle'),
        subTitle: document.getElementById('subTitle'),
        currentWeatherIcon: document.getElementById('currentWeatherIcon'),
        currentTemp: document.getElementById('currentTemp'),
        currentWeatherDesc: document.getElementById('currentWeatherDesc'),
        currentApparentTemp: document.getElementById('currentApparentTemp'),
        currentHumidity: document.getElementById('currentHumidity'),
        currentWindSpeed: document.getElementById('currentWindSpeed'),
        currentWindDir: document.getElementById('currentWindDir'),
        currentPrecipitation: document.getElementById('currentPrecipitation'),
        currentTime: document.getElementById('currentTime'),
        weeklyTempChartCanvas: document.getElementById('weeklyTempChart'),
        hourlyTempChartCanvas: document.getElementById('hourlyTempChart')
    };
    const weatherEffectsCtx = DOM.weatherEffectsCanvas.getContext('2d');

    // --- APP STATE ---
    const _appState = {
        hourlyFullData: null,
        weeklyTempChartInstance: null,
        hourlyTempChartInstance: null,
        weatherEffect: {
            animationFrameId: null,
            particles: [],
            currentEffectType: null
        }
    };

    // --- UTILITY FUNCTIONS ---
    function getWeatherDetails(wmoCode, isDay = true) {
        const details = CONFIG.WMO_MAP[wmoCode];
        if (details) {
            let icon = details.icon;
            if (!isDay) {
                if (wmoCode === 0) icon = "🌙";
                else if (wmoCode === 1) icon = "☁️🌙";
            }
            return { ...details, icon };
        }
        return { description: `코드 ${wmoCode}`, icon: "❓", effect: null };
    }

    function formatTime(dateString, includeSeconds = false) {
        if (!dateString) return "N/A";
        try {
            const date = new Date(dateString);
            const options = { hour: '2-digit', minute: '2-digit', hour12: false };
            if (includeSeconds) options.second = '2-digit';
            return date.toLocaleTimeString('ko-KR', options);
        } catch (e) {
            console.error("Error formatting time:", dateString, e);
            return "N/A";
        }
    }

    function degreesToCardinal(deg) {
        if (typeof deg !== 'number' || isNaN(deg)) return "N/A";
        const cardinals = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"];
        return cardinals[Math.round(deg / 22.5) % 16];
    }

    function applySpecificIconAnimation(element, iconChar) {
        if (!element) return;

        const classes = Array.from(element.classList);
        for (const cls of classes) {
            if (cls.startsWith('anim-') || cls === 'gentleBob-active' || cls === 'sun') {
                element.classList.remove(cls);
            }
        }
        for (const key in ICON_ANIMATION_MAP) {
            if (iconChar.includes(key)) {
                if (key === '🌦️' && iconChar.includes('⛈️')) continue;
                element.classList.add(ICON_ANIMATION_MAP[key]);
                if (ICON_ANIMATION_MAP[key] !== 'sun') break; 
            }
        }
    }
    
    // --- THEME MANAGEMENT ---
    function updateChartInstanceColors(chartInstance, newColors, chartType) {
        if (!chartInstance?.options) return;

        chartInstance.options.plugins.legend.labels.color = newColors.primaryTextColor;
        const tooltip = chartInstance.options.plugins.tooltip;
        tooltip.backgroundColor = newColors.cardBgColor;
        tooltip.titleColor = newColors.primaryTextColor;
        tooltip.bodyColor = newColors.primaryTextColor;
        tooltip.borderColor = newColors.borderColor;

        Object.values(chartInstance.options.scales).forEach(axis => {
            if (axis.ticks) axis.ticks.color = newColors.primaryTextColor;
            if (axis.grid) axis.grid.color = newColors.borderColor;
            if (axis.title?.display) axis.title.color = newColors.primaryTextColor;
        });
        
        const ctx = chartInstance.ctx;
        chartInstance.data.datasets.forEach((dataset, index) => {
            let newOpts;
            if (chartType === 'weekly') {
                newOpts = createChartDatasetOptions(index === 0 ? 'weeklyMax' : 'weeklyMin', newColors, ctx, dataset.label, dataset.data);
            } else if (chartType === 'hourly') {
                newOpts = createChartDatasetOptions(index === 0 ? 'hourlyTemp' : 'hourlyPrecip', newColors, ctx, dataset.label, dataset.data);
            }
            if (newOpts) Object.assign(dataset, newOpts);
        });
        chartInstance.update();
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        // [수정] 차트와 파티클 색상 업데이트
        if (DOM.appContainer.style.display === 'block' || DOM.appContainer.style.display === '') {
            const newChartColors = getChartColors();
            if (_appState.weeklyTempChartInstance) {
                updateChartInstanceColors(_appState.weeklyTempChartInstance, newChartColors, 'weekly');
            }
            if (_appState.hourlyTempChartInstance) {
                updateChartInstanceColors(_appState.hourlyTempChartInstance, newColors, 'hourly');
            }
            if (_appState.weatherEffect.particles.length > 0) {
                updateAllParticleColors();
            }
        }
    }
    
    // --- CHART UTILITIES ---
    function getChartColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            primaryTextColor: style.getPropertyValue('--primary-text-color').trim(),
            borderColor: style.getPropertyValue('--border-color').trim(),
            cardBgColor: style.getPropertyValue('--card-bg-color').trim(),
            accentColorWarm: style.getPropertyValue('--accent-color-warm').trim(),
            accentColorCold: style.getPropertyValue('--accent-color-cold').trim(),
            accentColor: style.getPropertyValue('--accent-color').trim(),
            fontFamily: style.getPropertyValue('--font-family').trim()
        };
    }
    
    function getBaseChartOptions() {
        const colors = getChartColors();
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: colors.primaryTextColor, font: { size: 13, family: colors.fontFamily }}},
                tooltip: {
                    backgroundColor: colors.cardBgColor, titleColor: colors.primaryTextColor,
                    bodyColor: colors.primaryTextColor, borderColor: colors.borderColor, borderWidth: 1,
                    padding: 10, cornerRadius: 6,
                    titleFont: { weight: 'bold', size: 14, family: colors.fontFamily },
                    bodyFont: { size: 13, family: colors.fontFamily },
                }
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { color: colors.primaryTextColor, font: {size: 11, family: colors.fontFamily}}, grid: { display: false, borderColor: colors.borderColor }},
                y: { ticks: { color: colors.primaryTextColor, font: {size: 11, family: colors.fontFamily}}, grid: { color: colors.borderColor }}
            }
        };
    }

    function createChartGradient(ctx, colorVarName, opacity = 0.2) {
        const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
        const parsedColor = getComputedStyle(document.documentElement).getPropertyValue(colorVarName).trim();
        let r = 0, g = 0, b = 0;

        if (parsedColor.startsWith('#')) {
            r = parseInt(parsedColor.slice(1, 3), 16);
            g = parseInt(parsedColor.slice(3, 5), 16);
            b = parseInt(parsedColor.slice(5, 7), 16);
        } else if (parsedColor.startsWith('rgb')) {
            const match = parsedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
            if (match) {
                r = parseInt(match[1], 10);
                g = parseInt(match[2], 10);
                b = parseInt(match[3], 10);
            }
        }
        gradient.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
        return gradient;
    }

    function createChartDatasetOptions(type, colors, ctx, label, data) {
        const baseDataset = {
            label, data,
            tension: 0.3, fill: 'start',
            pointBorderColor: colors.cardBgColor,
        };

        switch (type) {
            case 'weeklyMax':
                return {
                    ...baseDataset,
                    borderColor: colors.accentColorWarm, backgroundColor: createChartGradient(ctx, '--accent-color-warm', 0.3),
                    borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
                    pointBackgroundColor: colors.accentColorWarm, pointHoverBorderColor: colors.accentColorWarm, pointBorderWidth: 2
                };
            case 'weeklyMin':
                return {
                    ...baseDataset,
                    borderColor: colors.accentColorCold, backgroundColor: createChartGradient(ctx, '--accent-color-cold', 0.3),
                    borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
                    pointBackgroundColor: colors.accentColorCold, pointHoverBorderColor: colors.accentColorCold, pointBorderWidth: 2
                };
            case 'hourlyTemp':
                return {
                    ...baseDataset, yAxisID: 'yTemp',
                    borderColor: colors.accentColorWarm, backgroundColor: createChartGradient(ctx, '--accent-color-warm', 0.25),
                    borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
                    pointBackgroundColor: colors.accentColorWarm, pointHoverBorderColor: colors.accentColorWarm, pointBorderWidth: 1.5
                };
            case 'hourlyPrecip':
                return {
                    ...baseDataset, yAxisID: 'yPrecip', stepped: false,
                    borderColor: colors.accentColor, backgroundColor: createChartGradient(ctx, '--accent-color', 0.15),
                    borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
                    pointBackgroundColor: colors.accentColor, pointHoverBorderColor: colors.accentColor, pointBorderWidth: 1.5
                };
            default: return baseDataset;
        }
    }

    // --- UI RENDERING ---
    function renderSkeleton(show = true) {
        DOM.loadingSkeleton.style.display = show ? 'block' : 'none';
        DOM.appContainer.style.display = show ? 'none' : 'block';
    }

    function renderError(message, url = null) {
        DOM.errorMessage.style.display = 'block';
        let html = `<span>⚠️</span>${message}`;
        if (url) {
            const displayUrl = url.length > 200 ? `${url.substring(0, 200)}...` : url;
            html += `<br><a href="${url}" target="_blank" style="color: var(--accent-color); word-break:break-all;">API 요청 URL (${displayUrl})</a>`;
        }
        DOM.errorMessage.innerHTML = html;
    }

    function clearError() {
        DOM.errorMessage.style.display = 'none';
        DOM.errorMessage.innerHTML = '';
    }
    
    function renderCurrentWeather(current, hourly, timezone) {
        if (!current) {
            console.warn("Current weather data is missing.");
            DOM.currentWeatherIcon.textContent = 'N/A'; DOM.currentTemp.innerHTML = 'N/A&deg;C';
            DOM.currentWeatherDesc.textContent = 'N/A'; DOM.currentApparentTemp.innerHTML = 'N/A&deg;C';
            DOM.currentHumidity.innerHTML = 'N/A%'; DOM.currentWindSpeed.innerHTML = 'N/A km/h';
            DOM.currentWindDir.textContent = 'N/A'; DOM.currentPrecipitation.innerHTML = 'N/A mm';
            DOM.currentTime.textContent = 'N/A';
            return;
        }

        const weatherDetails = getWeatherDetails(current.weathercode, current.is_day === 1);
        DOM.currentWeatherIcon.textContent = weatherDetails.icon;
        DOM.currentTemp.innerHTML = `${Math.round(current.temperature)}&deg;C`;
        DOM.currentWeatherDesc.textContent = weatherDetails.description;
        DOM.currentWindSpeed.innerHTML = `${current.windspeed?.toFixed(1) ?? 'N/A'} km/h`;
        DOM.currentWindDir.textContent = degreesToCardinal(current.winddirection);
        DOM.currentTime.textContent = `${formatTime(current.time)} (${timezone || 'KST'})`;

        applySpecificIconAnimation(DOM.currentWeatherIcon, weatherDetails.icon);

        if (hourly?.time?.length > 0) {
            const now = new Date(current.time);
            const closestTimeIndex = hourly.time.reduce((closestIdx, timeStr, currentIdx) => {
                const diff = Math.abs(new Date(timeStr) - now);
                const prevDiff = Math.abs(new Date(hourly.time[closestIdx]) - now);
                return diff < prevDiff ? currentIdx : closestIdx;
            }, 0);

            DOM.currentApparentTemp.innerHTML = `${Math.round(hourly.apparent_temperature?.[closestTimeIndex] ?? 'N/A')}&deg;C`;
            DOM.currentHumidity.innerHTML = `${hourly.relative_humidity_2m?.[closestTimeIndex] ?? 'N/A'}%`;
            DOM.currentPrecipitation.innerHTML = `${hourly.precipitation?.[closestTimeIndex]?.toFixed(1) ?? '0'} mm`;
        } else {
            DOM.currentApparentTemp.innerHTML = 'N/A&deg;C';
            DOM.currentHumidity.innerHTML = 'N/A%';
            DOM.currentPrecipitation.innerHTML = '0 mm';
        }
    }

    function renderWeeklyTempChart(dailyData) {
        if (!dailyData?.time?.length) return;

        const labels = dailyData.time.map(dateStr => new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));
        const chartColors = getChartColors();
        const baseOptions = getBaseChartOptions();
        const ctx = DOM.weeklyTempChartCanvas.getContext('2d');

        if (_appState.weeklyTempChartInstance) _appState.weeklyTempChartInstance.destroy();
        
        Chart.defaults.color = chartColors.primaryTextColor;
        Chart.defaults.borderColor = chartColors.borderColor;

        _appState.weeklyTempChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    createChartDatasetOptions('weeklyMax', chartColors, ctx, '최고 기온', dailyData.temperature_2m_max),
                    createChartDatasetOptions('weeklyMin', chartColors, ctx, '최저 기온', dailyData.temperature_2m_min)
                ]
            },
            options: {
                ...baseOptions,
                scales: {
                    y: { ...baseOptions.scales.y, beginAtZero: false, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}°C` }},
                    x: { ...baseOptions.scales.x, ticks: { ...baseOptions.scales.x.ticks, font: { size: 14 }}}
                },
                plugins: { ...baseOptions.plugins, tooltip: { ...baseOptions.plugins.tooltip, padding: 12, cornerRadius: 8, titleFont: { ...baseOptions.plugins.tooltip.titleFont, size: 15 }, callbacks: { label: context => `${context.dataset.label}: ${context.parsed.y}°C`}}}
            }
        });
    }

    function createForecastCardHTML(dayData, index) {
        const dateObj = new Date(`${dayData.time[index]}T00:00:00`);
        const today = new Date(); today.setHours(0,0,0,0);
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

        const dayNameOriginal = dateObj.toLocaleDateString('ko-KR', { weekday: 'long' });
        let dayNameFormattedForCard = `(${dayNameOriginal})`; // For card display

        if (dateObj.getTime() === today.getTime()) dayNameFormattedForCard = "(오늘)";
        else if (dateObj.getTime() === tomorrow.getTime()) dayNameFormattedForCard = "(내일)";

        const monthDay = dateObj.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        const weatherDetails = getWeatherDetails(dayData.weather_code[index], true);

        const tempMin = Math.round(dayData.temperature_2m_min[index]);
        const tempMax = Math.round(dayData.temperature_2m_max[index]);
        const apparentMin = Math.round(dayData.apparent_temperature_min[index]);
        const apparentMax = Math.round(dayData.apparent_temperature_max[index]);
        const precipSum = dayData.precipitation_sum[index].toFixed(1);
        const precipProbMax = dayData.precipitation_probability_max[index];
        const windMax = dayData.wind_speed_10m_max[index].toFixed(1);
        const windDir = degreesToCardinal(dayData.wind_direction_10m_dominant[index]);
        const uvMax = dayData.uv_index_max[index].toFixed(1);
        const sunriseTime = formatTime(dayData.sunrise[index]);
        const sunsetTime = formatTime(dayData.sunset[index]);
        const precipHours = dayData.precipitation_hours[index].toFixed(0);

        let precipType = "";
        if (dayData.rain_sum[index] > 0) precipType += "비 ";
        if (dayData.showers_sum[index] > 0) precipType += "소나기 ";
        if (dayData.snowfall_sum[index] > 0) precipType += "눈 ";
        precipType = precipType.trim() || "없음";

        const card = document.createElement('div');
        card.className = 'weather-card';
        card.dataset.dateStr = dayData.time[index];
        card.dataset.dayName = dayNameOriginal; // Store full day name for modal
        card.dataset.monthDay = monthDay;
        
        card.innerHTML = `
            <div class="card-header">
                <div class="date-wrapper">
                    <span class="month-day">${monthDay}</span>
                    <span class="day-name">${dayNameFormattedForCard}</span>
                </div>
            </div>
            <div class="card-main-weather">
                <span class="icon">${weatherDetails.icon}</span>
                <div class="temps">
                    <div class="temp-range">
                        <span class="temp-min">${tempMin}&deg;</span> / <span class="temp-max">${tempMax}&deg;</span>
                    </div>
                    <div class="weather-description">${weatherDetails.description}</div>
                </div>
            </div>
            <div class="card-details-grid">
                <div class="detail-item feels-like"><span class="label">체감</span><span class="value">${apparentMin}&deg; / ${apparentMax}&deg;</span></div>
                <div class="detail-item precipitation"><span class="label">강수 (${precipType})</span><span class="value">${precipSum}<span class="unit">mm</span> (${precipProbMax}%)</span></div>
                <div class="detail-item wind"><span class="label">바람</span><span class="value">${windMax}<span class="unit">km/h</span> (${windDir})</span></div>
                <div class="detail-item uv-index"><span class="label">자외선</span><span class="value">${uvMax}</span></div>
                <div class="detail-item sunrise-sunset"><span class="label">일출/일몰</span><span class="value">${sunriseTime} / ${sunsetTime}</span></div>
                <div class="detail-item precipitation-hours"><span class="label">강수 시간</span><span class="value">${precipHours}<span class="unit">시간</span></span></div>
            </div>`;
        
        const iconEl = card.querySelector('.card-main-weather .icon');
        if (iconEl) applySpecificIconAnimation(iconEl, weatherDetails.icon);
        return card;
    }

    function renderDailyForecasts(dailyData) {
        DOM.forecastContainer.innerHTML = '';
        if (!dailyData?.time?.length) {
            console.warn("Daily forecast data is missing.");
            return;
        }
        const fragment = document.createDocumentFragment();
        dailyData.time.forEach((_, i) => {
            try {
                fragment.appendChild(createForecastCardHTML(dailyData, i));
            } catch (error) {
                console.error("Error creating forecast card for index:", i, error);
            }
        });
        DOM.forecastContainer.appendChild(fragment);
    }

    function createHourlyForecastItemHTML(hourlyData, index) {
        const weatherDetails = getWeatherDetails(hourlyData.weather_code[index], hourlyData.is_day[index] === 1);
        const temp = Math.round(hourlyData.temperature_2m[index]);
        const precipProb = hourlyData.precipitation_probability[index];
        return `
            <div class="hourly-item">
                <span class="time">${formatTime(hourlyData.time[index])}</span>
                <span class="icon">${weatherDetails.icon}</span>
                <span class="temp">${temp}&deg;C</span>
                <span class="precip">${precipProb}%</span>
                <span class="desc">${weatherDetails.description}</span>
            </div>`;
    }
    
    function renderHourlyDataInModal(dateStr, dayName, monthDay) { // dayName is now always full day name like "일요일"
        const hourlyFullData = _appState.hourlyFullData;
        if (!hourlyFullData?.time) {
            console.error("Hourly data for modal is not available in app state.");
            DOM.modalTitle.textContent = "오류";
            DOM.hourlyForecastList.innerHTML = "<div class='hourly-item'>시간별 예보 데이터를 불러올 수 없습니다.</div>";
            if (_appState.hourlyTempChartInstance) { _appState.hourlyTempChartInstance.destroy(); _appState.hourlyTempChartInstance = null; }
            DOM.hourlyTempChartCanvas.getContext('2d').clearRect(0,0,DOM.hourlyTempChartCanvas.width, DOM.hourlyTempChartCanvas.height);
            DOM.hourlyModal.classList.add(CONFIG.MODAL_ACTIVE_CLASS);
            return;
        }

        DOM.modalTitle.textContent = `${monthDay} (${dayName}) 시간별 예보`; // Changed order
        
        const selectedDate = dateStr.split('T')[0];
        const chartLabels = [];
        const chartTemps = [];
        const chartPrecipProbs = [];
        let hourlyItemsHTML = "";

        hourlyFullData.time.forEach((time, index) => {
            if (time.startsWith(selectedDate)) {
                hourlyItemsHTML += createHourlyForecastItemHTML(hourlyFullData, index);
                chartLabels.push(new Date(time));
                chartTemps.push(hourlyFullData.temperature_2m[index]);
                chartPrecipProbs.push(hourlyFullData.precipitation_probability[index]);
            }
        });
        DOM.hourlyForecastList.innerHTML = hourlyItemsHTML;

        const chartColors = getChartColors();
        const baseOptions = getBaseChartOptions();
        const ctx = DOM.hourlyTempChartCanvas.getContext('2d');

        if (_appState.hourlyTempChartInstance) _appState.hourlyTempChartInstance.destroy();
        
        Chart.defaults.color = chartColors.primaryTextColor;
        Chart.defaults.borderColor = chartColors.borderColor;

        _appState.hourlyTempChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [
                    createChartDatasetOptions('hourlyTemp', chartColors, ctx, '온도 (°C)', chartTemps),
                    createChartDatasetOptions('hourlyPrecip', chartColors, ctx, '강수 확률 (%)', chartPrecipProbs)
                ]
            },
            options: {
                ...baseOptions,
                scales: {
                    x: { ...baseOptions.scales.x, type: 'time', time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' }}},
                    yTemp: { ...baseOptions.scales.y, type: 'linear', position: 'left', title: { display: true, text: '온도 (°C)', color: chartColors.primaryTextColor, font: {size: 14, weight: '500', family: chartColors.fontFamily}}, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}°C`}},
                    yPrecip: { ...baseOptions.scales.y, type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: '강수 확률 (%)', color: chartColors.primaryTextColor, font: {size: 14, weight: '500', family: chartColors.fontFamily}}, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}%`}, grid: { ...baseOptions.scales.y.grid, drawOnChartArea: false }}
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
        DOM.hourlyModal.classList.add(CONFIG.MODAL_ACTIVE_CLASS);
    }

    // --- WEATHER EFFECTS ---
    function setupWeatherEffectsCanvas() {
        DOM.weatherEffectsCanvas.width = window.innerWidth;
        DOM.weatherEffectsCanvas.height = window.innerHeight;
    }

    function Particle(effectType) {
        this.type = effectType;
        this.x = Math.random() * DOM.weatherEffectsCanvas.width;
        if (effectType === 'snow') {
            this.y = Math.random() * DOM.weatherEffectsCanvas.height;
            this.radius = Math.random() * 3 + 1;
            this.speedY = Math.random() * 1 + 0.5;
            this.speedX = Math.random() * 1 - 0.5;
            this.opacity = Math.random() * 0.5 + 0.5;
        } else if (effectType === 'rain') {
            this.y = Math.random() * -DOM.weatherEffectsCanvas.height;
            this.length = Math.random() * 20 + 10;
            this.speedY = Math.random() * 10 + 10;
            this.opacity = Math.random() * 0.3 + 0.2;
        }
        this.setColor();
    }

    Particle.prototype.setColor = function() {
        const style = getComputedStyle(document.documentElement);
        if (this.type === 'snow') this.color = style.getPropertyValue('--snow-color').trim();
        else if (this.type === 'rain') this.color = style.getPropertyValue('--rain-color').trim();
    };

    Particle.prototype.draw = function() {
        weatherEffectsCtx.beginPath();
        weatherEffectsCtx.globalAlpha = this.opacity;
        if (this.type === 'snow') {
            weatherEffectsCtx.fillStyle = this.color;
            weatherEffectsCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            weatherEffectsCtx.fill();
        } else if (this.type === 'rain') {
            weatherEffectsCtx.strokeStyle = this.color;
            weatherEffectsCtx.lineWidth = 1.5;
            weatherEffectsCtx.moveTo(this.x, this.y);
            weatherEffectsCtx.lineTo(this.x, this.y + this.length);
            weatherEffectsCtx.stroke();
        }
        weatherEffectsCtx.globalAlpha = 1;
    };
    Particle.prototype.update = function() {
        this.y += this.speedY;
        const canvas = DOM.weatherEffectsCanvas;
        if (this.type === 'snow') {
            this.x += this.speedX;
            if (this.y > canvas.height + this.radius) { this.y = -this.radius; this.x = Math.random() * canvas.width; }
            if (this.x > canvas.width + this.radius || this.x < -this.radius) { this.x = Math.random() * canvas.width; this.y = -this.radius; }
        } else if (this.type === 'rain') {
            if (this.y > canvas.height) { this.y = Math.random() * -50; this.x = Math.random() * canvas.width; }
        }
    };
    
    function updateAllParticleColors() {
        _appState.weatherEffect.particles.forEach(p => p.setColor());
    }

    function createParticles(effectType) {
        const effect = _appState.weatherEffect;
        effect.particles = [];
        let numParticles;
        const canvasArea = DOM.weatherEffectsCanvas.width * DOM.weatherEffectsCanvas.height;

        if (effectType === 'snow') numParticles = Math.floor(canvasArea / CONFIG.PARTICLE_DENSITY_SNOW_DIVISOR);
        else if (effectType === 'rain' || effectType === 'rain_snow') numParticles = Math.floor(canvasArea / CONFIG.PARTICLE_DENSITY_RAIN_DIVISOR);
        else return;

        numParticles = Math.min(numParticles, CONFIG.MAX_PARTICLES);
        for (let i = 0; i < numParticles; i++) {
            let particleType = (effectType === 'rain_snow') ? (Math.random() > 0.5 ? 'rain' : 'snow') : effectType;
            effect.particles.push(new Particle(particleType));
        }
    }

    function animateParticles() {
        const effect = _appState.weatherEffect;
        weatherEffectsCtx.clearRect(0, 0, DOM.weatherEffectsCanvas.width, DOM.weatherEffectsCanvas.height);
        effect.particles.forEach(p => { p.update(); p.draw(); });
        effect.animationFrameId = requestAnimationFrame(animateParticles);
    }

    function startWeatherEffect(effectType) {
        const effect = _appState.weatherEffect;
        if (effect.animationFrameId) cancelAnimationFrame(effect.animationFrameId);
        
        effect.currentEffectType = effectType;
        effect.particles = [];
        weatherEffectsCtx.clearRect(0, 0, DOM.weatherEffectsCanvas.width, DOM.weatherEffectsCanvas.height);

        if (effectType) {
            createParticles(effectType);
            if (effect.particles.length > 0) animateParticles();
        }
    }
    
    // --- DATA FETCHING AND PROCESSING ---
    async function fetchWeatherData() {
        const dailyP = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,rain_sum,showers_sum,snowfall_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max";
        const hourlyP = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,is_day";
        // [수정] API 호출 시 동적으로 받은 위도/경도 사용
        const url = `${CONFIG.API_BASE_URL}?latitude=${LAT}&longitude=${LON}&current_weather=true&daily=${dailyP}&hourly=${hourlyP}&timezone=Asia/Seoul&forecast_days=7`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                let errorData = { message: response.statusText, reason: "Unknown error" };
                try { errorData = await response.json(); } catch (e) { /* ignore */ }
                throw new Error(`HTTP ${response.status}: ${errorData.reason || errorData.message}`);
            }
            const data = await response.json();
            if (!data?.current_weather || !data?.daily || !data?.hourly) {
                throw new Error("API 응답 데이터 형식이 올바르지 않습니다.");
            }
            return {data, url};
        } catch (error) {
            console.error('Error fetching weather data:', error);
            throw { originalError: error, failedUrl: url };
        }
    }

    function processAndDisplayWeatherData(weatherData) {
        _appState.hourlyFullData = weatherData.hourly;
        
        // [수정] 지역 이름 고정 텍스트 제거
        DOM.mainTitle.textContent = `오늘과 주간 날씨`;
        DOM.subTitle.textContent = `현재 위치의 상세한 날씨 정보를 확인하세요.`;

        renderCurrentWeather(weatherData.current_weather, weatherData.hourly, weatherData.timezone_abbreviation);
        renderWeeklyTempChart(weatherData.daily);
        renderDailyForecasts(weatherData.daily);

        const currentWeatherDetails = getWeatherDetails(weatherData.current_weather.weathercode, weatherData.current_weather.is_day === 1);
        startWeatherEffect(currentWeatherDetails.effect);
        
        const now = new Date();
        DOM.lastUpdated.textContent = `마지막 업데이트: ${now.toLocaleDateString('ko-KR')} ${now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit'})}`;
    }

    async function loadWeatherData(showSkeletonUI = true) {
        if (!LAT || !LON) {
            renderError("위치 정보가 제공되지 않았습니다. MothNote 설정에서 위치를 지정해주세요.");
            renderSkeleton(false);
            return;
        }

        // [수정] 로컬 스토리지를 이용한 캐시 검사
        try {
            const cachedDataString = localStorage.getItem(CONFIG.WEATHER_DETAIL_CACHE_KEY);
            if (cachedDataString) {
                const cachedData = JSON.parse(cachedDataString);
                const now = Date.now();
                // 캐시가 유효하고, 위치 정보가 동일할 때 캐시 사용
                if (cachedData.lat === LAT && cachedData.lon === LON && (now - cachedData.timestamp < CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000)) {
                    processAndDisplayWeatherData(cachedData.data);
                    renderSkeleton(false); // 스켈레톤 숨김
                    return; // 캐시 사용했으므로 함수 종료
                }
            }
        } catch(e) {
            console.warn("날씨 캐시를 읽는 데 실패했습니다.", e);
            localStorage.removeItem(CONFIG.WEATHER_DETAIL_CACHE_KEY); // 오류 발생 시 캐시 삭제
        }

        if (showSkeletonUI) renderSkeleton(true);
        clearError();
        if (DOM.aqiSection) DOM.aqiSection.style.display = 'none';

        try {
            const {data, url} = await fetchWeatherData();
            processAndDisplayWeatherData(data);

            // [수정] 성공 시 캐시에 데이터 저장
            try {
                const cachePayload = {
                    timestamp: Date.now(),
                    lat: LAT,
                    lon: LON,
                    data: data
                };
                localStorage.setItem(CONFIG.WEATHER_DETAIL_CACHE_KEY, JSON.stringify(cachePayload));
            } catch (e) {
                console.warn("날씨 캐시 저장에 실패했습니다.", e);
            }

            if (showSkeletonUI) renderSkeleton(false);
        } catch (errorInfo) {
            if (showSkeletonUI) renderSkeleton(false);
            
            // [BUG FIX] errorInfo 객체의 구조를 확인하여 안전하게 오류 메시지를 추출합니다.
            // fetchWeatherData 내에서 throw된 Error 객체는 originalError 속성이 없을 수 있습니다.
            const errorMessage = errorInfo?.originalError?.message || errorInfo?.message || '알 수 없는 오류';
            const failedUrl = errorInfo?.failedUrl || null; // failedUrl이 없는 경우를 대비
            renderError(`날씨 정보 로드 실패: ${errorMessage}`, failedUrl);
        }
    }
    
    // --- EVENT LISTENERS & INITIALIZATION ---
    function setupEventListeners() {
        DOM.closeModalButton.onclick = () => DOM.hourlyModal.classList.remove(CONFIG.MODAL_ACTIVE_CLASS);
        window.onclick = event => {
            if (event.target === DOM.hourlyModal) DOM.hourlyModal.classList.remove(CONFIG.MODAL_ACTIVE_CLASS);
        };
        window.addEventListener('resize', () => {
            setupWeatherEffectsCanvas();
            if (_appState.weatherEffect.currentEffectType) {
                startWeatherEffect(_appState.weatherEffect.currentEffectType);
            }
        });
        
        // [추가] 부모 창으로부터 테마 변경 메시지를 수신하는 리스너
        window.addEventListener('message', (event) => {
            // 보안을 위해 origin을 확인할 수 있지만, 확장 프로그램 내부이므로 생략
            // if (event.origin !== 'chrome-extension://...') return;
            if (event.data && event.data.type === 'setTheme') {
                applyTheme(event.data.theme);
            }
        });

        DOM.forecastContainer.addEventListener('click', event => {
            const card = event.target.closest('.weather-card');
            if (card?.dataset.dateStr && card.dataset.dayName && card.dataset.monthDay) {
                renderHourlyDataInModal(card.dataset.dateStr, card.dataset.dayName, card.dataset.monthDay);
            }
        });

        // [수정] 페이지가 다시 보일 때 캐시를 고려하여 갱신 시도
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                loadWeatherData(false); // 스켈레톤 없이 부드럽게 갱신 (내부에서 캐시 체크)
            }
        });
    }

    function initialize() {
        // [수정] 초기 테마를 URL 파라미터에서 가져옴
        if (THEME) {
            applyTheme(THEME);
        }
        setupWeatherEffectsCanvas();
        setupEventListeners();
        loadWeatherData(); // 페이지 첫 로드 시에는 항상 갱신 시도 (내부에서 캐시 체크)
    }

    // --- START THE APP ---
    initialize();

})();