(function WeatherApp() {
    'use strict';

    // --- CONFIGURATION ---
    const CONFIG = {
        API_BASE_URL: "https://api.open-meteo.com/v1/forecast",
        AIR_QUALITY_API_BASE_URL: "https://air-quality-api.open-meteo.com/v1/air-quality",
        PARTICLE_DENSITY_SNOW_DIVISOR: 25000,
        PARTICLE_DENSITY_RAIN_DIVISOR: 18000,
        MAX_PARTICLES: 250,
        MODAL_ACTIVE_CLASS: 'active',
        REFRESH_INTERVAL_MINUTES: 60,
        WEATHER_DETAIL_CACHE_KEY: 'weather_detail_cache_v8_trend_precip_priority_notice_fit',
        AIR_QUALITY_CACHE_KEY: 'air_quality_cache_v4',
        WMO_MAP: {0:{description:"맑음",icon:"☀️",effect:null},1:{description:"대체로 맑음",icon:"🌤️",effect:null},2:{description:"부분적 흐림",icon:"🌥️",effect:null},3:{description:"흐림",icon:"☁️",effect:null},45:{description:"안개",icon:"🌫️",effect:null},48:{description:"서리 안개",icon:"🌫️❄️",effect:null},51:{description:"가벼운 가랑비",icon:"💧",effect:"rain"},53:{description:"보통 가랑비",icon:"💧",effect:"rain"},55:{description:"강한 가랑비",icon:"💧",effect:"rain"},56:{description:"가벼운 어는 가랑비",icon:"🥶💧",effect:"rain_snow"},57:{description:"강한 어는 가랑비",icon:"🥶💧",effect:"rain_snow"},61:{description:"가벼운 비",icon:"🌧️",effect:"rain"},63:{description:"보통 비",icon:"🌧️",effect:"rain"},65:{description:"강한 비",icon:"🌧️",effect:"rain"},66:{description:"가벼운 어는 비",icon:"🥶🌧️",effect:"rain_snow"},67:{description:"강한 어는 비",icon:"🥶🌧️",effect:"rain_snow"},71:{description:"가벼운 눈",icon:"❄️",effect:"snow"},73:{description:"보통 눈",icon:"❄️",effect:"snow"},75:{description:"강한 눈",icon:"❄️",effect:"snow"},77:{description:"싸락눈",icon:"❄️",effect:"snow"},80:{description:"가벼운 소나기",icon:"🌦️",effect:"rain"},81:{description:"보통 소나기",icon:"🌦️",effect:"rain"},82:{description:"강한 소나기",icon:"⛈️",effect:"rain"},85:{description:"가벼운 소낙눈",icon:"🌨️",effect:"snow"},86:{description:"강한 소낙눈",icon:"🌨️",effect:"snow"},95:{description:"뇌우",icon:"⛈️",effect:"rain"},96:{description:"가벼운 우박 동반 뇌우",icon:"⛈️🧊",effect:"rain"},99:{description:"강한 우박 동반 뇌우",icon:"⛈️🧊",effect:"rain"}},
        // [수정] WHO 기준으로 미세먼지 등급 기준을 변경합니다.
        AQI_WHO_STANDARDS: {
            pm2_5: [
                { limit: 9, level: '좋음', class: 'level-good' },
                { limit: 15, level: '보통', class: 'level-moderate' },
                { limit: 50, level: '나쁨', class: 'level-unhealthy' },
                { limit: Infinity, level: '매우 나쁨', class: 'level-very-unhealthy' }
            ],
            pm10: [
                { limit: 22, level: '좋음', class: 'level-good' },
                { limit: 45, level: '보통', class: 'level-moderate' },
                { limit: 100, level: '나쁨', class: 'level-unhealthy' },
                { limit: Infinity, level: '매우 나쁨', class: 'level-very-unhealthy' }
            ]
        }
    };
    
    const urlParams = new URLSearchParams(window.location.search);
    const LAT = parseFloat(urlParams.get('lat'));
    const LON = parseFloat(urlParams.get('lon'));
    const THEME = urlParams.get('theme');

    const ICON_ANIMATION_MAP = {
        '☀️': ['sun'],
        '☁️': ['anim-cloud-drift', 'gentleBob-active'],
        '🌥️': ['anim-cloud-drift', 'gentleBob-active'],
        '🌤️': ['anim-cloud-drift', 'gentleBob-active'],
        '🌧️': ['anim-rain-drop', 'gentleBob-active'],
        '💧': ['anim-rain-drop', 'gentleBob-active'],
        '🌦️': ['anim-rain-drop', 'gentleBob-active'],
        '⛈️': ['anim-rain-drop', 'gentleBob-active'],
        '❄️': ['anim-snow-flake', 'gentleBob-active'],
        '🌨️': ['anim-snow-flake', 'gentleBob-active'],
        'default': ['gentleBob-active']
    };

    // --- DOM ELEMENT CACHING ---
    const DOM = {
        appContainer: document.getElementById('appContainer'),
        loadingSkeleton: document.getElementById('loadingSkeleton'),
        forecastContainer: document.getElementById('forecastContainer'),
        forecastTrendNotice: document.getElementById('forecastTrendNotice'),
        twoWeekTrendSection: document.getElementById('twoWeekTrendSection'),
        twoWeekTrendList: document.getElementById('twoWeekTrendList'),
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
        detailedObservationGrid: document.getElementById('detailedObservationGrid'),
        weatherBriefingList: document.getElementById('weatherBriefingList'),
        weatherBriefingMoreSection: document.getElementById('weatherBriefingMoreSection'),
        weatherBriefingMoreList: document.getElementById('weatherBriefingMoreList'),
        next24HoursList: document.getElementById('next24HoursList'),
        weeklyTempChartCanvas: document.getElementById('weeklyTempChart'),
        hourlyTempChartCanvas: document.getElementById('hourlyTempChart'),
        currentPm10Value: document.getElementById('currentPm10Value'),
        currentPm10Level: document.getElementById('currentPm10Level'),
        currentPm25Value: document.getElementById('currentPm25Value'),
        currentPm25Level: document.getElementById('currentPm25Level'),
        currentUsAqiValue: document.getElementById('currentUsAqiValue'),
        currentUsAqiLevel: document.getElementById('currentUsAqiLevel'),
        currentUvValue: document.getElementById('currentUvValue'),
        currentUvLabel: document.getElementById('currentUvLabel'),
        currentUvLevel: document.getElementById('currentUvLevel'),
        currentNo2Value: document.getElementById('currentNo2Value'),
        currentNo2Note: document.getElementById('currentNo2Note'),
        currentOzoneValue: document.getElementById('currentOzoneValue'),
        currentOzoneNote: document.getElementById('currentOzoneNote'),
    };
    const weatherEffectsCtx = DOM.weatherEffectsCanvas.getContext('2d');

    // --- APP STATE ---
    const _appState = {
        hourlyFullData: null,
        airQualityFullData: null,
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
    
    function getAqiLevel(pollutant, value) {
        if (value == null || isNaN(value)) {
            return { level: '정보 없음', class: 'level-default' };
        }
        const standards = CONFIG.AQI_WHO_STANDARDS[pollutant];
        if (!standards) {
            return { level: '기준 없음', class: 'level-default' };
        }
        for (const standard of standards) {
            if (value <= standard.limit) {
                return { level: standard.level, class: standard.class };
            }
        }
        return { level: '정보 없음', class: 'level-default' };
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[ch]));
    }

    function toFiniteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatNumber(value, digits = 0, fallback = '—') {
        const number = toFiniteNumber(value);
        return number === null ? fallback : number.toFixed(digits);
    }

    function formatWithUnit(value, digits = 0, unit = '', fallback = '—') {
        const number = formatNumber(value, digits, fallback);
        return number === fallback ? fallback : `${number}${unit}`;
    }

    function calculateDewPoint(tempC, humidityPercent) {
        const temp = toFiniteNumber(tempC);
        const humidity = toFiniteNumber(humidityPercent);
        if (temp === null || humidity === null || humidity <= 0) return null;
        const a = 17.625;
        const b = 243.04;
        const gamma = Math.log(humidity / 100) + (a * temp) / (b + temp);
        return (b * gamma) / (a - gamma);
    }

    function calculateWindChill(tempC, windKmh) {
        const temp = toFiniteNumber(tempC);
        const wind = toFiniteNumber(windKmh);
        if (temp === null || wind === null || temp > 10 || wind < 4.8) return null;
        return 13.12 + (0.6215 * temp) - (11.37 * (wind ** 0.16)) + (0.3965 * temp * (wind ** 0.16));
    }

    function getUvLevel(value) {
        const uv = toFiniteNumber(value);
        if (uv === null) return { level: '정보 없음', class: 'level-default', tone: '자외선 자료 없음' };
        if (uv < 3) return { level: '낮음', class: 'level-uv-low', tone: '야외활동 부담이 낮습니다' };
        if (uv < 6) return { level: '보통', class: 'level-uv-moderate', tone: '장시간 외출 시 차단이 좋습니다' };
        if (uv < 8) return { level: '높음', class: 'level-uv-high', tone: '자외선 차단을 권장합니다' };
        if (uv < 11) return { level: '매우 높음', class: 'level-uv-very-high', tone: '강한 차단이 필요합니다' };
        return { level: '위험', class: 'level-uv-extreme', tone: '야외활동 최소화를 권합니다' };
    }

    function getUsAqiLevel(value) {
        const aqi = toFiniteNumber(value);
        if (aqi === null) return { level: '정보 없음', class: 'level-default', tone: 'US AQI 자료 없음' };
        if (aqi <= 50) return { level: '좋음', class: 'level-good', tone: '대체로 쾌적합니다' };
        if (aqi <= 100) return { level: '보통', class: 'level-moderate', tone: '민감군은 컨디션을 살펴 주세요' };
        if (aqi <= 150) return { level: '민감군 나쁨', class: 'level-unhealthy', tone: '호흡기 민감군은 주의가 필요합니다' };
        if (aqi <= 200) return { level: '나쁨', class: 'level-very-unhealthy', tone: '장시간 야외활동을 줄여 주세요' };
        if (aqi <= 300) return { level: '매우 나쁨', class: 'level-very-unhealthy', tone: '외출 강도를 낮추는 편이 좋습니다' };
        return { level: '위험', class: 'level-very-unhealthy', tone: '실내 활동을 권합니다' };
    }


    function getOutfitAdvice(feelsLike) {
        const value = toFiniteNumber(feelsLike);
        if (value === null) return { tag: '확인 필요', tone: 'info', text: '체감온도 자료가 부족합니다. 실제 바람과 햇볕을 함께 확인하세요.' };
        if (value <= -5) return { tag: '혹한 대비', tone: 'danger', text: '두꺼운 외투, 장갑, 목도리처럼 노출 부위를 줄이는 옷차림이 좋습니다. 🧣' };
        if (value <= 5) return { tag: '매우 추움', tone: 'warn', text: '두꺼운 겉옷과 보온성 있는 이너를 추천드립니다. 🧥' };
        if (value <= 12) return { tag: '쌀쌀함', tone: 'info', text: '자켓이나 니트처럼 보온이 되는 겉옷이 편안합니다. 🧶' };
        if (value <= 20) return { tag: '선선함', tone: 'good', text: '가벼운 겉옷을 챙기면 아침·저녁 변화에 대응하기 좋습니다. 🧢' };
        if (value <= 27) return { tag: '쾌적', tone: 'good', text: '대체로 가벼운 옷차림이 좋고, 활동량이 많다면 통풍을 고려하세요. 👕' };
        if (value <= 32) return { tag: '더움', tone: 'warn', text: '통풍이 좋은 옷, 물, 모자 준비를 권합니다. 야외 장시간 활동은 쉬어가세요. 🧃' };
        return { tag: '폭염 체감', tone: 'danger', text: '그늘, 수분, 휴식이 중요합니다. 낮 시간대 무리한 야외활동은 피하는 편이 안전합니다. 🥵' };
    }

    function getOutdoorActivityAdvice(uv, gust, weatherCode) {
        const uvValue = toFiniteNumber(uv);
        const gustValue = toFiniteNumber(gust);
        const stormy = [82, 95, 96, 99].includes(Number(weatherCode));
        if (stormy) return { tag: '뇌우 유의', tone: 'danger', text: '천둥·번개 가능성이 있으므로 개활지, 산행, 수상 활동은 피하는 것이 좋습니다. ⚡' };
        if (gustValue !== null && gustValue >= 50) return { tag: '강풍 유의', tone: 'danger', text: '돌풍이 강할 수 있습니다. 간판, 우산, 자전거, 해안가 활동에 주의하세요. 🌬️' };
        if (uvValue !== null && uvValue >= 8) return { tag: '자외선 강함', tone: 'warn', text: '자외선이 매우 강합니다. 모자, 선글라스, 자외선 차단제를 준비하세요. 🧴' };
        if (uvValue !== null && uvValue >= 6) return { tag: '차단 권장', tone: 'warn', text: '낮 시간대 햇볕이 강할 수 있습니다. 긴 야외활동은 그늘 휴식을 섞어주세요. 🕶️' };
        return { tag: '활동 무난', tone: 'good', text: '위험 신호가 크지 않습니다. 다만 시간별 강수와 바람 변화는 한 번 더 확인하세요. 🚶' };
    }

    function getDiurnalRangeBriefing(dailyData) {
        const todayHigh = toFiniteNumber(dailyData?.temperature_2m_max?.[0]);
        const todayLow = toFiniteNumber(dailyData?.temperature_2m_min?.[0]);
        if (todayHigh === null || todayLow === null) {
            return { tag: '확인 필요', tone: 'info', text: '오늘 최고·최저기온 자료가 부족합니다. 시간별 기온 변화를 함께 확인해 주세요.' };
        }
        const range = todayHigh - todayLow;
        const base = `오늘 최고기온은 ${formatWithUnit(todayHigh, 1, '°C')}, 최저기온은 ${formatWithUnit(todayLow, 1, '°C')}로 일교차가 ${formatWithUnit(range, 1, '°C')}입니다.`;
        if (range >= 10) {
            return { tag: '일교차 큼', tone: 'warn', text: `${base} 아침·저녁 옷차림 조절을 권장합니다.` };
        }
        return { tag: '일교차 무난', tone: 'good', text: `${base} 온도 변화가 큰 편은 아닙니다.` };
    }


    function average(values) {
        const numeric = (Array.isArray(values) ? values : []).map(toFiniteNumber).filter((value) => value !== null);
        if (!numeric.length) return null;
        return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    }

    function sumNextHourly(hourly, variable, startIndex, hours) {
        const values = getNextHourlyNumbers(hourly, variable, startIndex, hours);
        return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    }

    function getHourlyEntry(hourly, variable, index) {
        const value = getHourlyValue(hourly, variable, index);
        const numeric = toFiniteNumber(value);
        if (numeric === null || !hourly?.time?.[index]) return null;
        return { value: numeric, index, time: hourly.time[index] };
    }

    function maxNextHourlyEntry(hourly, variable, startIndex, hours) {
        if (!hourly?.time?.length || !Array.isArray(hourly[variable]) || startIndex < 0) return null;
        let best = null;
        const endIndex = Math.min(startIndex + hours, hourly.time.length, hourly[variable].length);
        for (let index = startIndex; index < endIndex; index += 1) {
            const entry = getHourlyEntry(hourly, variable, index);
            if (!entry) continue;
            if (!best || entry.value > best.value) best = entry;
        }
        return best;
    }

    function minNextHourlyEntry(hourly, variable, startIndex, hours) {
        if (!hourly?.time?.length || !Array.isArray(hourly[variable]) || startIndex < 0) return null;
        let best = null;
        const endIndex = Math.min(startIndex + hours, hourly.time.length, hourly[variable].length);
        for (let index = startIndex; index < endIndex; index += 1) {
            const entry = getHourlyEntry(hourly, variable, index);
            if (!entry) continue;
            if (!best || entry.value < best.value) best = entry;
        }
        return best;
    }

    function isPrecipitationWeatherCode(code) {
        return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(Number(code));
    }

    function addHoursToIsoLikeString(iso, hours = 1) {
        if (!iso || !String(iso).includes('T')) return iso || '';
        const [datePart, timePart = '00:00'] = String(iso).split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour = 0, minute = 0] = timePart.split(':').map(Number);
        const date = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0);
        date.setHours(date.getHours() + hours);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d}T${h}:${min}`;
    }

    function formatHourRange(hourly, startIndex, endIndex) {
        if (!hourly?.time?.[startIndex]) return '시간대 정보 없음';
        const nextEnd = hourly.time[endIndex + 1] || addHoursToIsoLikeString(hourly.time[endIndex], 1);
        return `${formatTime(hourly.time[startIndex])}~${formatTime(nextEnd)}`;
    }

    function describeIndexRanges(hourly, indices, maxRanges = 2) {
        if (!Array.isArray(indices) || !indices.length) return '';
        const sorted = [...new Set(indices)].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0];
        let previous = sorted[0];
        for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i] === previous + 1) {
                previous = sorted[i];
                continue;
            }
            ranges.push([start, previous]);
            start = previous = sorted[i];
        }
        ranges.push([start, previous]);
        return ranges.slice(0, maxRanges).map(([s, e]) => formatHourRange(hourly, s, e)).join(', ');
    }

    function findPrecipitationWindow(hourly, startIndex, hours = 24) {
        if (!hourly?.time?.length || startIndex < 0) return null;
        const indices = [];
        const endIndex = Math.min(startIndex + hours, hourly.time.length);
        for (let index = startIndex; index < endIndex; index += 1) {
            const probability = toFiniteNumber(getHourlyValue(hourly, 'precipitation_probability', index)) ?? 0;
            const precipitation = toFiniteNumber(getHourlyValue(hourly, 'precipitation', index)) ?? 0;
            const code = getHourlyValue(hourly, 'weather_code', index);
            if (probability >= 40 || precipitation >= 0.1 || isPrecipitationWeatherCode(code)) indices.push(index);
        }
        if (!indices.length) return null;
        return {
            indices,
            label: describeIndexRanges(hourly, indices),
            peak: maxNextHourlyEntry(hourly, 'precipitation_probability', startIndex, hours)
        };
    }

    function calculateRollingHourlyAverage(hourly, variable, currentTime, hours = 24) {
        if (!hourly?.time?.length || !Array.isArray(hourly[variable])) return null;
        let currentIndex = -1;
        const key = String(currentTime || hourly.time[0]);
        for (let index = 0; index < hourly.time.length; index += 1) {
            if (String(hourly.time[index]) <= key) currentIndex = index;
        }
        if (currentIndex < 0) currentIndex = getClosestHourlyIndex(currentTime, hourly);
        const start = Math.max(0, currentIndex - hours + 1);
        const values = hourly[variable].slice(start, currentIndex + 1).map(toFiniteNumber).filter((value) => value !== null);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }

    function getAirQualityMetrics(aqiData, dailyData, currentTime) {
        const current = aqiData?.current || null;
        const hourly = aqiData?.hourly || null;
        const pm10Current = current?.pm10 ?? null;
        const pm25Current = current?.pm2_5 ?? null;
        const pm10Avg24 = calculateRollingHourlyAverage(hourly, 'pm10', current?.time || currentTime, 24) ?? pm10Current;
        const pm25Avg24 = calculateRollingHourlyAverage(hourly, 'pm2_5', current?.time || currentTime, 24) ?? pm25Current;
        const usAqi = current?.us_aqi ?? null;
        const uvCurrent = current?.uv_index ?? null;
        const uvDailyMax = dailyData?.uv_index_max?.[0] ?? null;
        const uvValue = uvCurrent ?? uvDailyMax;
        const uvSource = uvCurrent != null ? '현재 자외선 지수' : '오늘 최대 자외선';
        return {
            pm10Current,
            pm25Current,
            pm10Avg24,
            pm25Avg24,
            pm10Info: getAqiLevel('pm10', pm10Avg24),
            pm25Info: getAqiLevel('pm2_5', pm25Avg24),
            usAqi,
            usAqiInfo: getUsAqiLevel(usAqi),
            uvValue,
            uvSource,
            uvInfo: getUvLevel(uvValue),
            no2: current?.nitrogen_dioxide ?? null,
            ozone: current?.ozone ?? null
        };
    }

    function getToneFromSeverity(severity) {
        if (severity >= 3) return 'danger';
        if (severity >= 2) return 'warn';
        if (severity >= 1) return 'info';
        return 'good';
    }

    function buildRiskSignals(current, hourly, dailyData, aqiData, startIndex) {
        const risks = [];
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 24);
        const rainSum24 = sumNextHourly(hourly, 'precipitation', startIndex, 24);
        const maxGust = Math.max(
            toFiniteNumber(maxNextHourly(hourly, 'wind_gusts_10m', startIndex, 24)) ?? 0,
            toFiniteNumber(dailyData?.wind_gusts_10m_max?.[0]) ?? 0,
            toFiniteNumber(current?.wind_gusts_10m) ?? 0
        );
        const uvValue = getAirQualityMetrics(aqiData, dailyData, current?.time).uvValue;
        const air = getAirQualityMetrics(aqiData, dailyData, current?.time);
        const todayHigh = toFiniteNumber(dailyData?.temperature_2m_max?.[0]);
        const todayLow = toFiniteNumber(dailyData?.temperature_2m_min?.[0]);
        const diurnalRange = todayHigh !== null && todayLow !== null ? todayHigh - todayLow : null;
        const humidity = toFiniteNumber(current?.relative_humidity_2m ?? getHourlyValue(hourly, 'relative_humidity_2m', startIndex));
        const minVisibility = minNextHourly(hourly, 'visibility', startIndex, 12);

        if ((toFiniteNumber(maxRainProb) ?? 0) >= 65 || (toFiniteNumber(rainSum24) ?? 0) >= 5) risks.push({ label: `강수 ${formatWithUnit(maxRainProb, 0, '%')}`, severity: 3 });
        else if ((toFiniteNumber(maxRainProb) ?? 0) >= 40 || (toFiniteNumber(rainSum24) ?? 0) > 0) risks.push({ label: `비 가능성 ${formatWithUnit(maxRainProb, 0, '%')}`, severity: 2 });
        if (maxGust >= 50) risks.push({ label: `돌풍 ${formatWithUnit(maxGust, 0, ' km/h')}`, severity: 3 });
        else if (maxGust >= 35) risks.push({ label: `바람 ${formatWithUnit(maxGust, 0, ' km/h')}`, severity: 2 });
        if ((toFiniteNumber(uvValue) ?? 0) >= 8) risks.push({ label: `자외선 ${formatNumber(uvValue, 1)}`, severity: 3 });
        else if ((toFiniteNumber(uvValue) ?? 0) >= 6) risks.push({ label: `자외선 ${formatNumber(uvValue, 1)}`, severity: 2 });
        if ((toFiniteNumber(air.usAqi) ?? 0) > 100 || ['나쁨', '매우 나쁨'].includes(air.pm10Info.level) || ['나쁨', '매우 나쁨'].includes(air.pm25Info.level)) risks.push({ label: `대기질 ${air.usAqiInfo.level}`, severity: 2 });
        if (diurnalRange !== null && diurnalRange >= 10) risks.push({ label: `일교차 ${formatWithUnit(diurnalRange, 1, '°C')}`, severity: 2 });
        if (humidity !== null && humidity >= 85) risks.push({ label: `높은 습도 ${formatWithUnit(humidity, 0, '%')}`, severity: 1 });
        if (minVisibility !== null && minVisibility < 5000) risks.push({ label: `시정 저하`, severity: minVisibility < 1000 ? 3 : 2 });
        if (!risks.length) risks.push({ label: '큰 위험 신호 없음', severity: 0 });
        return risks.sort((a, b) => b.severity - a.severity).slice(0, 3);
    }

    function findBestOutdoorWindow(hourly, startIndex, aqiData, dailyData, hours = 24, windowSize = 3) {
        if (!hourly?.time?.length || startIndex < 0) return null;
        const air = getAirQualityMetrics(aqiData, dailyData, hourly.time[startIndex]);
        const aqiPenalty = (toFiniteNumber(air.usAqi) ?? 50) > 100 ? 18 : (toFiniteNumber(air.usAqi) ?? 50) > 50 ? 8 : 0;
        let best = null;
        const lastStart = Math.min(startIndex + hours - windowSize, hourly.time.length - windowSize);
        for (let start = startIndex; start <= lastStart; start += 1) {
            const end = start + windowSize;
            const rain = average(hourly.precipitation_probability?.slice(start, end));
            const wind = average(hourly.wind_speed_10m?.slice(start, end));
            const gust = Math.max(...(hourly.wind_gusts_10m?.slice(start, end).map((v) => toFiniteNumber(v) ?? 0) || [0]));
            const apparent = average(hourly.apparent_temperature?.slice(start, end));
            const uv = average(hourly.uv_index?.slice(start, end));
            const visibility = average(hourly.visibility?.slice(start, end));
            let score = 100;
            score -= Math.max(0, (rain ?? 0) - 15) * 0.8;
            score -= Math.max(0, (wind ?? 0) - 18) * 0.8;
            score -= Math.max(0, gust - 30) * 0.6;
            if (apparent !== null) {
                if (apparent < 5) score -= (5 - apparent) * 2.1;
                if (apparent > 28) score -= (apparent - 28) * 2.1;
            }
            if (uv !== null && uv >= 6) score -= (uv - 5) * 4;
            if (visibility !== null && visibility < 5000) score -= 12;
            score -= aqiPenalty;
            if (!best || score > best.score) best = { score, start, end: end - 1, rain, wind, apparent, uv };
        }
        if (!best) return null;
        return {
            label: formatHourRange(hourly, best.start, best.end),
            tag: best.score >= 78 ? '추천' : best.score >= 58 ? '무난' : '조건 제한',
            tone: best.score >= 78 ? 'good' : best.score >= 58 ? 'info' : 'warn',
            text: `${formatHourRange(hourly, best.start, best.end)} 구간이 상대적으로 낫습니다. 평균 강수확률 ${formatWithUnit(best.rain, 0, '%')}, 바람 ${formatWithUnit(best.wind, 1, ' km/h')}, 체감 ${formatWithUnit(best.apparent, 1, '°C')} 수준입니다.`
        };
    }

    function buildDailySummary(current, hourly, dailyData, aqiData, startIndex) {
        const weatherDetails = getWeatherDetails(current?.weathercode ?? current?.weather_code, current?.is_day === 1);
        const temp = current?.temperature ?? current?.temperature_2m;
        const apparent = current?.apparent_temperature ?? getHourlyValue(hourly, 'apparent_temperature', getClosestHourlyIndex(current?.time, hourly));
        const risks = buildRiskSignals(current, hourly, dailyData, aqiData, startIndex);
        const topRisk = risks[0];
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 24);
        const air = getAirQualityMetrics(aqiData, dailyData, current?.time);
        const uvText = air.uvValue !== null ? `자외선 ${air.uvInfo.level}` : '자외선 정보 일부 부족';
        const base = `현재는 ${weatherDetails.icon} ${weatherDetails.description}, 기온 ${formatWithUnit(temp, 0, '°C')}·체감 ${formatWithUnit(apparent, 0, '°C')}입니다.`;
        let action = '오늘은 큰 위험 신호가 적은 편이라 기본적인 외출은 무난합니다.';
        if (topRisk?.severity >= 3) action = `오늘은 ${topRisk.label} 신호가 가장 큽니다. 이동 전 시간별 변화를 한 번 더 확인해 주세요.`;
        else if ((toFiniteNumber(maxRainProb) ?? 0) >= 40) action = `비 가능성이 있어 우산 여부와 강수 시간대를 확인하는 것이 좋습니다.`;
        else if ((toFiniteNumber(air.usAqi) ?? 0) > 100) action = '대기질이 민감군에게 부담될 수 있어 야외활동 강도 조절이 좋습니다.';
        else if ((toFiniteNumber(air.uvValue) ?? 0) >= 6) action = `낮 시간대 ${uvText} 신호가 있어 자외선 차단을 챙기세요.`;
        return { tag: topRisk?.severity ? topRisk.label : '무난', tone: getToneFromSeverity(topRisk?.severity ?? 0), text: `${base} ${action}` };
    }

    function getRainAdvice(current, hourly, dailyData, startIndex) {
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 24);
        const rainSum24 = sumNextHourly(hourly, 'precipitation', startIndex, 24);
        const todayRain = dailyData?.precipitation_sum?.[0];
        const todaySnow = dailyData?.snowfall_sum?.[0];
        const currentPrecip = current?.precipitation ?? getHourlyValue(hourly, 'precipitation', getClosestHourlyIndex(current?.time, hourly));
        if ((toFiniteNumber(todaySnow) ?? 0) > 0) return { icon: '❄️', title: '강수·우산 판단', tag: '눈 가능', tone: 'warn', text: `눈 예보가 있습니다. 예상 적설 또는 강수 신호와 미끄럼, 시야 저하를 함께 확인해 주세요.` };
        if ((toFiniteNumber(maxRainProb) ?? 0) >= 65 || (toFiniteNumber(todayRain) ?? 0) >= 10 || (toFiniteNumber(currentPrecip) ?? 0) > 0) return { icon: '☔', title: '강수·우산 판단', tag: '우산 권장', tone: 'warn', text: `앞으로 24시간 최대 강수확률은 ${formatWithUnit(maxRainProb, 0, '%')}, 예상 강수량은 ${formatWithUnit(todayRain, 1, ' mm')}입니다. 이동 시간이 길다면 우산을 챙기시는 편이 안전합니다.` };
        if ((toFiniteNumber(maxRainProb) ?? 0) >= 40 || (toFiniteNumber(rainSum24) ?? 0) > 0) return { icon: '🌂', title: '강수·우산 판단', tag: '확률 확인', tone: 'info', text: `강수 가능성이 조금 있습니다. 앞으로 24시간 최대 강수확률은 ${formatWithUnit(maxRainProb, 0, '%')}입니다.` };
        return { icon: '🌤️', title: '강수·우산 판단', tag: '강수 낮음', tone: 'good', text: `앞으로 24시간 최대 강수확률은 ${formatWithUnit(maxRainProb, 0, '%')}로 낮은 편입니다.` };
    }

    function getWindBriefing(current, hourly, dailyData, startIndex) {
        const maxWind = maxNextHourly(hourly, 'wind_speed_10m', startIndex, 24) ?? current?.windspeed ?? current?.wind_speed_10m;
        const maxGust = Math.max(
            toFiniteNumber(maxNextHourly(hourly, 'wind_gusts_10m', startIndex, 24)) ?? 0,
            toFiniteNumber(dailyData?.wind_gusts_10m_max?.[0]) ?? 0,
            toFiniteNumber(current?.wind_gusts_10m) ?? 0
        );
        if (maxGust >= 50) return { tag: '강풍 유의', tone: 'danger', text: `최대 돌풍이 ${formatWithUnit(maxGust, 1, ' km/h')}까지 강해질 수 있습니다. 우산, 자전거, 해안가 이동에 유의하세요.` };
        if (maxGust >= 35 || (toFiniteNumber(maxWind) ?? 0) >= 30) return { tag: '바람 주의', tone: 'warn', text: `최대 풍속 ${formatWithUnit(maxWind, 1, ' km/h')}, 돌풍 ${formatWithUnit(maxGust, 1, ' km/h')} 수준입니다. 가벼운 물건은 고정하는 편이 좋습니다.` };
        return { tag: '무난', tone: 'good', text: `바람은 대체로 무난합니다. 최대 풍속 ${formatWithUnit(maxWind, 1, ' km/h')}, 돌풍 ${formatWithUnit(maxGust, 1, ' km/h')} 수준입니다.` };
    }

    function getVentilationAdvice(aqiData, dailyData, current, hourly, startIndex) {
        const air = getAirQualityMetrics(aqiData, dailyData, current?.time);
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 6);
        const wind = current?.windspeed ?? current?.wind_speed_10m ?? getHourlyValue(hourly, 'wind_speed_10m', startIndex);
        const hasAirData = [air.pm10Current, air.pm25Current, air.usAqi].some((value) => toFiniteNumber(value) !== null);
        if (!hasAirData) return { tag: '자료 확인', tone: 'info', text: '대기질 자료가 부족합니다. 환기 전 실시간 대기질과 비·바람을 함께 확인해 주세요.' };
        const aqiBad = (toFiniteNumber(air.usAqi) ?? 0) > 100 || ['나쁨', '매우 나쁨'].includes(air.pm10Info.level) || ['나쁨', '매우 나쁨'].includes(air.pm25Info.level);
        if (aqiBad) return { tag: '짧게 환기', tone: 'warn', text: `PM10 ${air.pm10Info.level}, PM2.5 ${air.pm25Info.level}, US AQI ${formatNumber(air.usAqi, 0, '--')}입니다. 환기는 짧게 하고 민감하시면 창문을 오래 열어두지 않는 편이 좋습니다.` };
        if ((toFiniteNumber(maxRainProb) ?? 0) >= 60) return { tag: '비 확인', tone: 'info', text: `대기질은 큰 부담이 없지만 가까운 시간 강수 가능성이 있습니다. 창문을 열기 전 비 여부를 확인하세요.` };
        if ((toFiniteNumber(wind) ?? 0) >= 35) return { tag: '바람 확인', tone: 'info', text: `대기질은 무난하지만 바람이 다소 강할 수 있습니다. 짧은 환기가 적합합니다.` };
        return { tag: '환기 무난', tone: 'good', text: `대기질이 대체로 무난하고 강한 비·바람 신호가 크지 않아 짧은 환기에 큰 부담은 적습니다.` };
    }

    function getSensitiveGroupAdvice(aqiData, dailyData, current) {
        const air = getAirQualityMetrics(aqiData, dailyData, current?.time);
        const uv = air.uvValue;
        const issues = [];
        if ((toFiniteNumber(air.usAqi) ?? 0) > 100 || ['나쁨', '매우 나쁨'].includes(air.pm25Info.level)) issues.push(`호흡기 민감군은 장시간 야외활동을 줄이는 편이 좋습니다`);
        if ((toFiniteNumber(uv) ?? 0) >= 6) issues.push(`피부가 민감하시면 낮 시간대 자외선 차단을 강화하세요`);
        if (!issues.length) return { tag: '부담 낮음', tone: 'good', text: '현재 자료상 대기질·자외선 모두 일반적인 활동에는 큰 부담이 낮은 편입니다. 개인 컨디션에 맞춰 조절하세요.' };
        return { tag: '민감군 주의', tone: 'warn', text: `${issues.join('. ')}.` };
    }

    function getTravelAdvice(current, hourly, startIndex) {
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 12);
        const minVisibility = minNextHourly(hourly, 'visibility', startIndex, 12);
        const maxGust = maxNextHourly(hourly, 'wind_gusts_10m', startIndex, 12);
        const stormy = [82, 95, 96, 99].includes(Number(current?.weathercode ?? current?.weather_code));
        if (stormy) return { tag: '뇌우 주의', tone: 'danger', text: '뇌우 신호가 있어 이동 시 실시간 기상 알림과 도로 상황을 확인하는 편이 안전합니다.' };
        if ((toFiniteNumber(minVisibility) ?? Infinity) < 1000) return { tag: '시야 매우 낮음', tone: 'danger', text: `가까운 12시간 최저 시정이 ${formatWithUnit(minVisibility, 0, ' m')} 수준입니다. 운전 시 감속과 차간거리 확보가 필요합니다.` };
        if ((toFiniteNumber(maxRainProb) ?? 0) >= 60 || (toFiniteNumber(maxGust) ?? 0) >= 45 || (toFiniteNumber(minVisibility) ?? Infinity) < 5000) return { tag: '이동 주의', tone: 'warn', text: `강수확률 ${formatWithUnit(maxRainProb, 0, '%')}, 돌풍 ${formatWithUnit(maxGust, 1, ' km/h')}, 최저 시정 ${formatWithUnit(minVisibility, 0, ' m')}를 확인하세요.` };
        return { tag: '이동 무난', tone: 'good', text: '강수, 강풍, 시정 저하 신호가 크지 않아 일반적인 이동은 대체로 무난합니다.' };
    }

    function getLaundryDryingAdvice(current, hourly, startIndex) {
        const maxRainProb = maxNextHourly(hourly, 'precipitation_probability', startIndex, 12);
        const precipitation = sumNextHourly(hourly, 'precipitation', startIndex, 12);
        const humidityAvg = average(hourly?.relative_humidity_2m?.slice(startIndex, startIndex + 12));
        const cloudAvg = average(hourly?.cloud_cover?.slice(startIndex, startIndex + 12));
        const windAvg = average(hourly?.wind_speed_10m?.slice(startIndex, startIndex + 12));
        if ((toFiniteNumber(maxRainProb) ?? 0) >= 50 || (toFiniteNumber(precipitation) ?? 0) > 0.5) return { tag: '실내 권장', tone: 'warn', text: `강수 가능성이 있어 빨래·건조는 실내가 더 안전합니다. 12시간 최대 강수확률은 ${formatWithUnit(maxRainProb, 0, '%')}입니다.` };
        if ((toFiniteNumber(humidityAvg) ?? 0) >= 75 || (toFiniteNumber(cloudAvg) ?? 0) >= 80) return { tag: '건조 느림', tone: 'info', text: `평균 습도 ${formatWithUnit(humidityAvg, 0, '%')}, 구름량 ${formatWithUnit(cloudAvg, 0, '%')}로 건조 속도가 느릴 수 있습니다.` };
        if ((toFiniteNumber(windAvg) ?? 0) >= 8 && (toFiniteNumber(cloudAvg) ?? 100) < 60) return { tag: '건조 양호', tone: 'good', text: `비 가능성이 낮고 바람도 약간 있어 빨래 건조 조건은 비교적 괜찮습니다.` };
        return { tag: '보통', tone: 'good', text: '강수 신호는 크지 않지만 습도와 구름량을 함께 보며 건조 시간을 넉넉히 잡는 편이 좋습니다.' };
    }

    function normalizeForecastData(data) {
        if (!data || typeof data !== 'object') return data;
        if (data.current && !data.current_weather) {
            data.current_weather = {
                time: data.current.time,
                interval: data.current.interval,
                temperature: data.current.temperature_2m,
                temperature_2m: data.current.temperature_2m,
                relative_humidity_2m: data.current.relative_humidity_2m,
                apparent_temperature: data.current.apparent_temperature,
                is_day: data.current.is_day,
                precipitation: data.current.precipitation,
                rain: data.current.rain,
                showers: data.current.showers,
                snowfall: data.current.snowfall,
                weathercode: data.current.weather_code,
                weather_code: data.current.weather_code,
                cloud_cover: data.current.cloud_cover,
                pressure_msl: data.current.pressure_msl,
                surface_pressure: data.current.surface_pressure,
                windspeed: data.current.wind_speed_10m,
                wind_speed_10m: data.current.wind_speed_10m,
                winddirection: data.current.wind_direction_10m,
                wind_direction_10m: data.current.wind_direction_10m,
                wind_gusts_10m: data.current.wind_gusts_10m
            };
        } else if (data.current_weather && !data.current) {
            data.current = {
                time: data.current_weather.time,
                temperature_2m: data.current_weather.temperature,
                is_day: data.current_weather.is_day,
                weather_code: data.current_weather.weathercode ?? data.current_weather.weather_code,
                wind_speed_10m: data.current_weather.windspeed,
                wind_direction_10m: data.current_weather.winddirection
            };
        }
        return data;
    }

    function getClosestHourlyIndex(currentTime, hourly) {
        if (!hourly?.time?.length) return -1;
        if (!currentTime) return 0;
        const currentDate = new Date(currentTime);
        if (Number.isNaN(currentDate.getTime())) return 0;
        return hourly.time.reduce((closestIdx, timeStr, currentIdx) => {
            const diff = Math.abs(new Date(timeStr) - currentDate);
            const prevDiff = Math.abs(new Date(hourly.time[closestIdx]) - currentDate);
            return diff < prevDiff ? currentIdx : closestIdx;
        }, 0);
    }

    function getHourlyStartIndex(hourly, currentTime) {
        if (!hourly?.time?.length) return -1;
        if (!currentTime) return 0;
        const currentDate = new Date(currentTime);
        if (Number.isNaN(currentDate.getTime())) return 0;
        const index = hourly.time.findIndex((timeStr) => new Date(timeStr) >= currentDate);
        return index >= 0 ? index : Math.max(0, getClosestHourlyIndex(currentTime, hourly));
    }

    function getNextHourlyNumbers(hourly, variable, startIndex, hours) {
        if (!hourly?.time?.length || !Array.isArray(hourly[variable]) || startIndex < 0) return [];
        return hourly[variable]
            .slice(startIndex, Math.min(startIndex + hours, hourly[variable].length))
            .map(toFiniteNumber)
            .filter((value) => value !== null);
    }

    function maxNextHourly(hourly, variable, startIndex, hours) {
        const values = getNextHourlyNumbers(hourly, variable, startIndex, hours);
        return values.length ? Math.max(...values) : null;
    }

    function minNextHourly(hourly, variable, startIndex, hours) {
        const values = getNextHourlyNumbers(hourly, variable, startIndex, hours);
        return values.length ? Math.min(...values) : null;
    }

    function getHourlyValue(hourly, variable, index) {
        if (!hourly || index < 0 || !Array.isArray(hourly[variable])) return null;
        return hourly[variable][index] ?? null;
    }

    function pressureHint(value) {
        const pressure = toFiniteNumber(value);
        if (pressure === null) return '기압 자료 없음';
        if (pressure < 1000) return '기압이 낮은 편입니다';
        if (pressure > 1020) return '기압이 높은 편입니다';
        return '평균적인 기압대입니다';
    }

    function cloudHint(value) {
        const cloud = toFiniteNumber(value);
        if (cloud === null) return '구름량 자료 없음';
        if (cloud >= 80) return '하늘이 많이 덮였습니다';
        if (cloud >= 45) return '구름이 어느 정도 있습니다';
        return '하늘이 비교적 열려 있습니다';
    }

    function applySpecificIconAnimation(element, iconChar) {
        if (!element) return;
        const classesToRemove = Array.from(element.classList).filter(cls =>
            cls.startsWith('anim-') || cls === 'gentleBob-active' || cls === 'sun'
        );
        if (classesToRemove.length > 0) {
            element.classList.remove(...classesToRemove);
        }
        let classesToAdd = ICON_ANIMATION_MAP['default'];
        for (const key in ICON_ANIMATION_MAP) {
            if (iconChar.includes(key) && key !== 'default') {
                classesToAdd = ICON_ANIMATION_MAP[key];
                break;
            }
        }
        if (classesToAdd && classesToAdd.length > 0) {
            element.classList.add(...classesToAdd);
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
        if (DOM.appContainer.style.display === 'block' || DOM.appContainer.style.display === '') {
            const newChartColors = getChartColors();
            if (_appState.weeklyTempChartInstance) {
                updateChartInstanceColors(_appState.weeklyTempChartInstance, newChartColors, 'weekly');
            }
            if (_appState.hourlyTempChartInstance) {
                updateChartInstanceColors(_appState.hourlyTempChartInstance, newChartColors, 'hourly');
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
        const baseDataset = { label, data, tension: 0.3, fill: 'start', pointBorderColor: colors.cardBgColor };
        switch (type) {
            case 'weeklyMax': return { ...baseDataset, borderColor: colors.accentColorWarm, backgroundColor: createChartGradient(ctx, '--accent-color-warm', 0.3), borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: colors.accentColorWarm, pointHoverBorderColor: colors.accentColorWarm, pointBorderWidth: 2 };
            case 'weeklyMin': return { ...baseDataset, borderColor: colors.accentColorCold, backgroundColor: createChartGradient(ctx, '--accent-color-cold', 0.3), borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: colors.accentColorCold, pointHoverBorderColor: colors.accentColorCold, pointBorderWidth: 2 };
            case 'hourlyTemp': return { ...baseDataset, yAxisID: 'yTemp', borderColor: colors.accentColorWarm, backgroundColor: createChartGradient(ctx, '--accent-color-warm', 0.25), borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: colors.accentColorWarm, pointHoverBorderColor: colors.accentColorWarm, pointBorderWidth: 1.5 };
            case 'hourlyPrecip': return { ...baseDataset, yAxisID: 'yPrecip', stepped: false, borderColor: colors.accentColor, backgroundColor: createChartGradient(ctx, '--accent-color', 0.15), borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: colors.accentColor, pointHoverBorderColor: colors.accentColor, pointBorderWidth: 1.5 };
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
        DOM.errorMessage.innerHTML = '';

        const icon = document.createElement('span');
        icon.textContent = '⚠️';
        DOM.errorMessage.append(icon, document.createTextNode(String(message ?? '날씨 정보 로드 실패')));

        if (url) {
            try {
                const parsedUrl = new URL(String(url));
                if (parsedUrl.protocol === 'https:') {
                    const displayUrl = parsedUrl.href.length > 200 ? `${parsedUrl.href.substring(0, 200)}...` : parsedUrl.href;
                    const link = document.createElement('a');
                    link.href = parsedUrl.href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.style.color = 'var(--accent-color)';
                    link.style.wordBreak = 'break-all';
                    link.textContent = `API 요청 URL (${displayUrl})`;
                    DOM.errorMessage.append(document.createElement('br'), link);
                }
            } catch (error) {
                console.warn('Invalid weather error URL was ignored.', error);
            }
        }
    }

    function clearError() {
        DOM.errorMessage.style.display = 'none';
        DOM.errorMessage.innerHTML = '';
    }
    
    function renderCurrentWeather(current, hourly, timezone) {
        if (!current) {
            console.warn("Current weather data is missing.");
            DOM.currentWeatherIcon.textContent = 'N/A';
            DOM.currentTemp.innerHTML = 'N/A&deg;C';
            DOM.currentWeatherDesc.textContent = 'N/A';
            if (DOM.detailedObservationGrid) DOM.detailedObservationGrid.innerHTML = '<div class="observation-item"><span class="label">자료 없음</span><span class="value">—</span><span class="hint">현재 날씨 데이터를 불러오지 못했습니다.</span></div>';
            return;
        }

        const weatherDetails = getWeatherDetails(current.weathercode, current.is_day === 1);
        DOM.currentWeatherIcon.textContent = weatherDetails.icon;
        DOM.currentTemp.innerHTML = `${Math.round(current.temperature)}&deg;C`;
        DOM.currentWeatherDesc.textContent = weatherDetails.description;
        if (DOM.currentWindSpeed) DOM.currentWindSpeed.innerHTML = `${current.windspeed?.toFixed(1) ?? 'N/A'} km/h`;
        if (DOM.currentWindDir) DOM.currentWindDir.textContent = degreesToCardinal(current.winddirection);
        if (DOM.currentTime) DOM.currentTime.textContent = `${formatTime(current.time)} (${timezone || 'KST'})`;
        applySpecificIconAnimation(DOM.currentWeatherIcon, weatherDetails.icon);

        const closestTimeIndex = getClosestHourlyIndex(current.time, hourly);
        if (closestTimeIndex >= 0) {
            if (DOM.currentApparentTemp) DOM.currentApparentTemp.innerHTML = `${formatNumber(getHourlyValue(hourly, 'apparent_temperature', closestTimeIndex), 0, 'N/A')}&deg;C`;
            if (DOM.currentHumidity) DOM.currentHumidity.innerHTML = `${formatNumber(getHourlyValue(hourly, 'relative_humidity_2m', closestTimeIndex), 0, 'N/A')}%`;
            if (DOM.currentPrecipitation) DOM.currentPrecipitation.innerHTML = `${formatNumber(getHourlyValue(hourly, 'precipitation', closestTimeIndex), 1, '0')} mm`;
        } else {
            if (DOM.currentApparentTemp) DOM.currentApparentTemp.innerHTML = 'N/A&deg;C';
            if (DOM.currentHumidity) DOM.currentHumidity.innerHTML = 'N/A%';
            if (DOM.currentPrecipitation) DOM.currentPrecipitation.innerHTML = '0 mm';
        }
    }

    function observationItem(icon, label, value, hint) {
        return `<div class="observation-item">
            <span class="label">${escapeHTML(icon)} ${escapeHTML(label)}</span>
            <span class="value">${escapeHTML(value)}</span>
            <span class="hint">${escapeHTML(hint)}</span>
        </div>`;
    }

    function renderDetailedObservations(current, hourly) {
        if (!DOM.detailedObservationGrid) return;
        if (!current) {
            DOM.detailedObservationGrid.innerHTML = observationItem('⚠️', '자료 없음', '—', '현재 관측값을 불러오지 못했습니다.');
            return;
        }

        const index = getClosestHourlyIndex(current.time, hourly);
        const temp = getHourlyValue(hourly, 'temperature_2m', index) ?? current.temperature;
        const apparent = getHourlyValue(hourly, 'apparent_temperature', index);
        const humidity = getHourlyValue(hourly, 'relative_humidity_2m', index);
        const precipitation = getHourlyValue(hourly, 'precipitation', index);
        const precipitationProbability = getHourlyValue(hourly, 'precipitation_probability', index);
        const cloudCover = getHourlyValue(hourly, 'cloud_cover', index);
        const pressure = getHourlyValue(hourly, 'pressure_msl', index) ?? getHourlyValue(hourly, 'surface_pressure', index);
        const windSpeed = getHourlyValue(hourly, 'wind_speed_10m', index) ?? current.windspeed;
        const windDirection = getHourlyValue(hourly, 'wind_direction_10m', index) ?? current.winddirection;
        const windGust = getHourlyValue(hourly, 'wind_gusts_10m', index);
        const dewPoint = calculateDewPoint(temp, humidity);
        const windChill = calculateWindChill(temp, windSpeed);

        DOM.detailedObservationGrid.innerHTML = [
            observationItem('🌡️', '체감온도', formatWithUnit(apparent, 0, '°C'), windChill === null ? '체감온도 API 기준입니다' : `바람냉각 추정 ${formatWithUnit(windChill, 0, '°C')}`),
            observationItem('💧', '상대습도', formatWithUnit(humidity, 0, '%'), `이슬점 약 ${formatWithUnit(dewPoint, 1, '°C')}`),
            observationItem('🍃', '바람', formatWithUnit(windSpeed, 1, ' km/h'), `${degreesToCardinal(windDirection)} · 돌풍 ${formatWithUnit(windGust, 1, ' km/h')}`),
            observationItem('☔', '강수', formatWithUnit(precipitation, 1, ' mm'), `시간당 강수확률 ${formatWithUnit(precipitationProbability, 0, '%')}`),
            observationItem('☁️', '구름량', formatWithUnit(cloudCover, 0, '%'), cloudHint(cloudCover)),
            observationItem('🧭', '기압', formatWithUnit(pressure, 0, ' hPa'), pressureHint(pressure))
        ].join('');
    }

    function renderAirQuality(aqiData, dailyData) {
        const current = aqiData?.current || null;
        const currentWeatherTime = _appState?.latestWeatherCurrentTime || current?.time;
        const air = getAirQualityMetrics(aqiData, dailyData, currentWeatherTime);

        DOM.currentPm10Value.textContent = `${formatNumber(air.pm10Current, 1, '--')} µg/m³`;
        DOM.currentPm10Level.textContent = air.pm10Info.level;
        DOM.currentPm10Level.className = `aqi-level ${air.pm10Info.class}`;
        DOM.currentPm10Level.title = `최근 24시간 평균 기준: ${formatNumber(air.pm10Avg24, 1, '--')} µg/m³`;

        DOM.currentPm25Value.textContent = `${formatNumber(air.pm25Current, 1, '--')} µg/m³`;
        DOM.currentPm25Level.textContent = air.pm25Info.level;
        DOM.currentPm25Level.className = `aqi-level ${air.pm25Info.class}`;
        DOM.currentPm25Level.title = `최근 24시간 평균 기준: ${formatNumber(air.pm25Avg24, 1, '--')} µg/m³`;

        if (DOM.currentUsAqiValue) DOM.currentUsAqiValue.textContent = formatNumber(air.usAqi, 0, '--');
        if (DOM.currentUsAqiLevel) {
            DOM.currentUsAqiLevel.textContent = air.usAqiInfo.level;
            DOM.currentUsAqiLevel.className = `aqi-level ${air.usAqiInfo.class}`;
            DOM.currentUsAqiLevel.title = air.usAqiInfo.tone;
        }

        if (DOM.currentUvLabel) DOM.currentUvLabel.textContent = air.uvSource;
        if (DOM.currentUvValue) DOM.currentUvValue.textContent = formatNumber(air.uvValue, 1, '--');
        if (DOM.currentUvLevel) {
            DOM.currentUvLevel.textContent = air.uvInfo.level;
            DOM.currentUvLevel.className = `aqi-level ${air.uvInfo.class}`;
            DOM.currentUvLevel.title = `${air.uvSource} · ${air.uvInfo.tone}`;
        }

        if (DOM.currentNo2Value) DOM.currentNo2Value.textContent = `${formatNumber(air.no2, 1, '--')} µg/m³`;
        if (DOM.currentNo2Note) DOM.currentNo2Note.textContent = air.no2 == null ? '자료 없음' : '교통·연소 영향 참고 지표';
        if (DOM.currentOzoneValue) DOM.currentOzoneValue.textContent = `${formatNumber(air.ozone, 1, '--')} µg/m³`;
        if (DOM.currentOzoneNote) DOM.currentOzoneNote.textContent = air.ozone == null ? '자료 없음' : '햇빛이 강할 때 높아질 수 있습니다';

        DOM.aqiSection.style.display = 'block';
        if (!current) {
            console.warn("Current AQI data is missing; showing UV fallback and AQI placeholders.");
        }
    }

    function briefingItem(icon, title, body, tag = '', tone = 'info') {
        const allowedTones = new Set(['good', 'warn', 'danger', 'info']);
        const safeTone = allowedTones.has(String(tone)) ? String(tone) : 'info';
        const tagMarkup = tag ? `<em class="briefing-tag ${safeTone}">${escapeHTML(tag)}</em>` : '';
        return `<div class="briefing-item"><span class="briefing-icon" aria-hidden="true">${escapeHTML(icon)}</span><span><span class="briefing-title-row"><strong>${escapeHTML(title)}</strong>${tagMarkup}</span><span>${escapeHTML(body)}</span></span></div>`;
    }

    function setBriefingRemainderVisible(isVisible) {
        if (DOM.weatherBriefingMoreSection) {
            DOM.weatherBriefingMoreSection.style.display = isVisible ? 'block' : 'none';
        }
    }

    function renderWeatherBriefing(current, hourly, dailyData, aqiData) {
        if (!DOM.weatherBriefingList) return;
        const TOP_BRIEFING_ITEM_COUNT = 5;
        if (!current) {
            DOM.weatherBriefingList.innerHTML = briefingItem('⚠️', '브리핑을 만들 수 없습니다', '현재 날씨 데이터가 부족합니다.');
            if (DOM.weatherBriefingMoreList) DOM.weatherBriefingMoreList.innerHTML = '';
            setBriefingRemainderVisible(false);
            return;
        }

        const startIndex = getHourlyStartIndex(hourly, current.time);
        const closestIndex = getClosestHourlyIndex(current.time, hourly);
        const apparentNow = current.apparent_temperature ?? getHourlyValue(hourly, 'apparent_temperature', closestIndex) ?? current.temperature;
        const air = getAirQualityMetrics(aqiData, dailyData, current.time);
        const summary = buildDailySummary(current, hourly, dailyData, aqiData, startIndex);
        const risks = buildRiskSignals(current, hourly, dailyData, aqiData, startIndex);
        const rain = getRainAdvice(current, hourly, dailyData, startIndex);
        const rainWindow = findPrecipitationWindow(hourly, startIndex, 24);
        const outfit = getOutfitAdvice(apparentNow);
        const diurnal = getDiurnalRangeBriefing(dailyData);
        const wind = getWindBriefing(current, hourly, dailyData, startIndex);
        const maxApparent = maxNextHourlyEntry(hourly, 'apparent_temperature', startIndex, 24);
        const minApparent = minNextHourlyEntry(hourly, 'apparent_temperature', startIndex, 24);
        const outdoor = getOutdoorActivityAdvice(air.uvValue, Math.max(toFiniteNumber(maxNextHourly(hourly, 'wind_gusts_10m', startIndex, 24)) ?? 0, toFiniteNumber(dailyData?.wind_gusts_10m_max?.[0]) ?? 0), current.weathercode ?? current.weather_code);
        const ventilation = getVentilationAdvice(aqiData, dailyData, current, hourly, startIndex);
        const sensitive = getSensitiveGroupAdvice(aqiData, dailyData, current);
        const travel = getTravelAdvice(current, hourly, startIndex);
        const laundry = getLaundryDryingAdvice(current, hourly, startIndex);
        const bestOutdoor = findBestOutdoorWindow(hourly, startIndex, aqiData, dailyData);

        const riskSummary = risks.map((risk, index) => `${index + 1}. ${risk.label}`).join(' · ');
        const riskTone = getToneFromSeverity(risks[0]?.severity ?? 0);
        const rainWindowText = rainWindow
            ? `강수 신호가 잡히는 시간대는 ${rainWindow.label}입니다. 가장 높은 강수확률은 ${rainWindow.peak ? `${formatTime(rainWindow.peak.time)} ${formatWithUnit(rainWindow.peak.value, 0, '%')}` : '시간별 자료 확인 필요'}입니다.`
            : '앞으로 24시간 안에 뚜렷한 강수 시간대는 크지 않습니다.';
        const apparentPeakText = maxApparent || minApparent
            ? `체감온도는 ${maxApparent ? `${formatTime(maxApparent.time)} 전후 ${formatWithUnit(maxApparent.value, 1, '°C')}로 가장 높고` : '최고값 확인이 어렵고'}, ${minApparent ? `${formatTime(minApparent.time)} 전후 ${formatWithUnit(minApparent.value, 1, '°C')}로 가장 낮습니다` : '최저값 확인이 어렵습니다'}.`
            : '체감온도 피크를 계산할 시간별 자료가 부족합니다.';
        const uvTitle = air.uvSource === '현재 자외선 지수' ? '자외선·햇빛 판단' : '자외선·햇빛 판단';
        const uvTone = (toFiniteNumber(air.uvValue) ?? 0) >= 8 ? 'danger' : (toFiniteNumber(air.uvValue) ?? 0) >= 6 ? 'warn' : air.uvInfo.level === '낮음' ? 'good' : 'info';
        const airQualityWarn = (toFiniteNumber(air.usAqi) ?? 0) > 100 || ['나쁨', '매우 나쁨'].includes(air.pm10Info.level) || ['나쁨', '매우 나쁨'].includes(air.pm25Info.level);
        const bestOutdoorItem = bestOutdoor || { tag: '확인 필요', tone: 'info', text: '외출 추천 시간대를 계산할 시간별 자료가 부족합니다.' };

        const items = [
            briefingItem('🧭', '오늘 한 줄 총평', summary.text, summary.tag, summary.tone),
            briefingItem('🚦', '오늘의 위험 신호 순위', riskSummary, risks[0]?.severity ? '주의 신호' : '무난', riskTone),
            briefingItem(rain.icon, rain.title, rain.text, rain.tag, rain.tone),
            briefingItem('⏰', '비가 온다면 언제 오는지', rainWindowText, rainWindow ? '시간대 확인' : '뚜렷한 비 없음', rainWindow ? 'info' : 'good'),
            briefingItem('🧥', '옷차림·체감온도 판단', outfit.text, outfit.tag, outfit.tone),
            briefingItem('🌡️', '체감온도 피크', apparentPeakText, maxApparent && maxApparent.value >= 28 ? '더위 피크' : minApparent && minApparent.value <= 5 ? '추위 피크' : '체감 확인', maxApparent && maxApparent.value >= 32 ? 'danger' : maxApparent && maxApparent.value >= 28 ? 'warn' : 'info'),
            briefingItem('🌡️', '일교차 판단', diurnal.text, diurnal.tag, diurnal.tone),
            briefingItem('💨', '바람·돌풍 판단', wind.text, wind.tag, wind.tone),
            briefingItem('☀️', uvTitle, `${air.uvSource}는 ${formatNumber(air.uvValue, 1, '--')} · ${air.uvInfo.level} 단계입니다. ${air.uvInfo.tone}.`, air.uvInfo.level, uvTone),
            briefingItem('🪟', '대기질·환기 판단', ventilation.text, ventilation.tag, ventilation.tone),
            briefingItem('😷', '민감군 주의', sensitive.text, sensitive.tag, sensitive.tone),
            briefingItem('🌳', '외부활동 판단', outdoor.text, outdoor.tag, outdoor.tone),
            briefingItem('🚗', '운전·이동 주의', travel.text, travel.tag, travel.tone),
            briefingItem('👕', '빨래·건조 판단', laundry.text, laundry.tag, laundry.tone),
            briefingItem('🕒', '외출 추천 시간대', bestOutdoorItem.text, bestOutdoorItem.tag, bestOutdoorItem.tone)
        ];

        const hasAirData = [air.pm10Current, air.pm25Current, air.usAqi].some((value) => toFiniteNumber(value) !== null);
        if (!hasAirData) {
            items.splice(10, 0, briefingItem('🌬️', '대기질 요약', '대기질 API 응답이 부족해 PM10·PM2.5·US AQI를 확정적으로 평가하지 못했습니다.', '자료 확인', 'info'));
        } else if (airQualityWarn) {
            items.splice(10, 0, briefingItem('🌬️', '대기질 요약', `PM10은 ${air.pm10Info.level}(24시간 평균 ${formatNumber(air.pm10Avg24, 1, '--')} µg/m³), PM2.5는 ${air.pm25Info.level}(24시간 평균 ${formatNumber(air.pm25Avg24, 1, '--')} µg/m³), US AQI는 ${formatNumber(air.usAqi, 0, '--')}입니다.`, '대기질 주의', 'warn'));
        } else {
            items.splice(10, 0, briefingItem('🌬️', '대기질 요약', `PM10 ${air.pm10Info.level}, PM2.5 ${air.pm25Info.level}, US AQI ${formatNumber(air.usAqi, 0, '--')}로 대체로 무난합니다.`, '무난', 'good'));
        }

        const primaryItems = items.slice(0, TOP_BRIEFING_ITEM_COUNT);
        const remainderItems = items.slice(TOP_BRIEFING_ITEM_COUNT);

        DOM.weatherBriefingList.innerHTML = primaryItems.join('');
        if (DOM.weatherBriefingMoreList) {
            DOM.weatherBriefingMoreList.innerHTML = remainderItems.join('');
        }
        setBriefingRemainderVisible(remainderItems.length > 0);
    }

    function renderNext24Hours(current, hourly) {
        if (!DOM.next24HoursList) return;
        if (!hourly?.time?.length) {
            DOM.next24HoursList.innerHTML = '<div class="next-24h-card"><span class="time">자료 없음</span><span class="icon">⚠️</span><span class="temp">—</span><small>시간별 예보를 불러오지 못했습니다.</small></div>';
            return;
        }
        const startIndex = getHourlyStartIndex(hourly, current?.time);
        const endIndex = Math.min(startIndex + 24, hourly.time.length);
        const cards = [];

        for (let index = startIndex; index < endIndex; index += 1) {
            const weatherDetails = getWeatherDetails(hourly.weather_code?.[index], hourly.is_day?.[index] === 1);
            const timeLabel = index === startIndex ? `지금 · ${formatTime(hourly.time[index])}` : formatTime(hourly.time[index]);
            const temp = getHourlyValue(hourly, 'temperature_2m', index);
            const apparent = getHourlyValue(hourly, 'apparent_temperature', index);
            const precipProb = getHourlyValue(hourly, 'precipitation_probability', index);
            const windSpeed = getHourlyValue(hourly, 'wind_speed_10m', index) ?? current?.windspeed;
            const cloudCover = getHourlyValue(hourly, 'cloud_cover', index);
            cards.push(`<article class="next-24h-card">
                <span class="time">${escapeHTML(timeLabel)}</span>
                <span class="icon" aria-hidden="true">${escapeHTML(weatherDetails.icon)}</span>
                <span class="temp">${formatWithUnit(temp, 0, '°C')}</span>
                <small>${escapeHTML(weatherDetails.description)}<br>체감 ${formatWithUnit(apparent, 0, '°C')} · ☔ ${formatWithUnit(precipProb, 0, '%')}<br>💨 ${formatWithUnit(windSpeed, 1, ' km/h')} · ☁️ ${formatWithUnit(cloudCover, 0, '%')}</small>
            </article>`);
        }
        DOM.next24HoursList.innerHTML = cards.join('');
    }

    function renderWeeklyTempChart(dailyData) {
        if (!dailyData?.time?.length) return;
        const limit = Math.min(7, dailyData.time.length);
        const labels = dailyData.time.slice(0, limit).map(dateStr => new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));
        const maxTemps = Array.isArray(dailyData.temperature_2m_max) ? dailyData.temperature_2m_max.slice(0, limit) : [];
        const minTemps = Array.isArray(dailyData.temperature_2m_min) ? dailyData.temperature_2m_min.slice(0, limit) : [];
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
                    createChartDatasetOptions('weeklyMax', chartColors, ctx, '최고 기온', maxTemps),
                    createChartDatasetOptions('weeklyMin', chartColors, ctx, '최저 기온', minTemps)
                ]
            },
            options: { ...baseOptions, scales: { y: { ...baseOptions.scales.y, beginAtZero: false, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}°C` }}, x: { ...baseOptions.scales.x, ticks: { ...baseOptions.scales.x.ticks, font: { size: 14 }}} }, plugins: { ...baseOptions.plugins, tooltip: { ...baseOptions.plugins.tooltip, padding: 12, cornerRadius: 8, titleFont: { ...baseOptions.plugins.tooltip.titleFont, size: 15 }, callbacks: { label: context => `${context.dataset.label}: ${context.parsed.y}°C`}}} }
        });
    }

    function createForecastCardHTML(dayData, index, hourlyAqiData, options = {}) {
        const isTrendCard = Boolean(options.isTrendCard);
        const dateObj = new Date(`${dayData.time[index]}T00:00:00`);
        
        const dayNameOriginal = dateObj.toLocaleDateString('ko-KR', { weekday: 'long' });
        const dayNameFormattedForCard = `(${dayNameOriginal})`;

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
        
        let dailyAqiHTML = `<div class="detail-item air-quality"><span class="label">대기질</span><span class="value">정보 없음</span></div>`;
        if (hourlyAqiData?.time?.length > 0) {
            const dateStr = dayData.time[index];
            const todaysAqiPm10 = [];
            const todaysAqiPm25 = [];
            hourlyAqiData.time.forEach((time, i) => {
                if (time.startsWith(dateStr)) {
                    if (hourlyAqiData.pm10[i] != null) todaysAqiPm10.push(hourlyAqiData.pm10[i]);
                    if (hourlyAqiData.pm2_5[i] != null) todaysAqiPm25.push(hourlyAqiData.pm2_5[i]);
                }
            });

            if (todaysAqiPm10.length > 0 && todaysAqiPm25.length > 0) {
                const avgPm10 = todaysAqiPm10.reduce((a, b) => a + b, 0) / todaysAqiPm10.length;
                const avgPm25 = todaysAqiPm25.reduce((a, b) => a + b, 0) / todaysAqiPm25.length;
                const pm10Info = getAqiLevel('pm10', avgPm10);
                const pm25Info = getAqiLevel('pm2_5', avgPm25);
                dailyAqiHTML = `<div class="detail-item air-quality">
                    <span class="label">대기질 (PM10 / PM2.5)</span>
                    <span class="value">${pm10Info.level} (${Math.round(avgPm10)}) / ${pm25Info.level} (${Math.round(avgPm25)})</span>
                </div>`;
            }
        }

        const trendAssessment = isTrendCard ? getTwoWeekTrendAssessment(dayData, index) : null;
        const trendDetailHTML = trendAssessment
            ? `<div class="detail-item trend-indicator"><span class="label">경향 관련 표시</span><span class="value"><span class="trend-inline-badge ${escapeHTML(trendAssessment.tone)}">${escapeHTML(trendAssessment.tag)}</span></span></div>`
            : '';

        const card = document.createElement('div');
        card.className = `weather-card${isTrendCard ? ' trend-forecast-card' : ''}`;
        card.dataset.dateStr = dayData.time[index];
        card.dataset.dayName = dayNameOriginal; 
        card.dataset.monthDay = monthDay;
        if (isTrendCard) card.dataset.forecastType = 'trend';
        
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
                ${dailyAqiHTML}
                ${trendDetailHTML}
                <div class="detail-item precipitation"><span class="label">강수 (${precipType})</span><span class="value">${precipSum}<span class="unit">mm</span> (${precipProbMax}%)</span></div>
                <div class="detail-item precipitation-hours"><span class="label">강수 시간</span><span class="value">${precipHours}<span class="unit">시간</span></span></div>
                <div class="detail-item wind"><span class="label">바람</span><span class="value">${windMax}<span class="unit">km/h</span> (${windDir})</span></div>
                <div class="detail-item sunrise-sunset"><span class="label">일출/일몰</span><span class="value">${sunriseTime} / ${sunsetTime}</span></div>
                <div class="detail-item uv-index"><span class="label">자외선</span><span class="value">${uvMax}</span></div>
            </div>`;
        
        const iconEl = card.querySelector('.card-main-weather .icon');
        if (iconEl) applySpecificIconAnimation(iconEl, weatherDetails.icon);
        return card;
    }

    function renderDailyForecasts(dailyData, hourlyAqiData) {
        DOM.forecastContainer.innerHTML = '';
        if (!dailyData?.time?.length) {
            console.warn("Daily forecast data is missing.");
            if (DOM.forecastTrendNotice) DOM.forecastTrendNotice.style.display = 'none';
            return;
        }

        const limit = Math.min(16, dailyData.time.length);
        if (DOM.forecastTrendNotice) DOM.forecastTrendNotice.style.display = limit > 7 ? '' : 'none';

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < limit; i += 1) {
            try {
                fragment.appendChild(createForecastCardHTML(dailyData, i, hourlyAqiData, { isTrendCard: i >= 7 }));
            } catch (error) {
                console.error("Error creating forecast card for index:", i, error);
            }
        }
        DOM.forecastContainer.appendChild(fragment);
    }


    function getTwoWeekTrendAssessment(dailyData, index) {
        const code = Number(dailyData?.weather_code?.[index]);
        const maxTemp = toFiniteNumber(dailyData?.temperature_2m_max?.[index]);
        const minTemp = toFiniteNumber(dailyData?.temperature_2m_min?.[index]);
        const rainProbability = toFiniteNumber(dailyData?.precipitation_probability_max?.[index]);
        const precipitation = toFiniteNumber(dailyData?.precipitation_sum?.[index]);
        const rainSum = toFiniteNumber(dailyData?.rain_sum?.[index]);
        const showersSum = toFiniteNumber(dailyData?.showers_sum?.[index]);
        const precipHours = toFiniteNumber(dailyData?.precipitation_hours?.[index]);
        const snowfallSum = toFiniteNumber(dailyData?.snowfall_sum?.[index]);
        const gust = toFiniteNumber(dailyData?.wind_gusts_10m_max?.[index]);
        const uv = toFiniteNumber(dailyData?.uv_index_max?.[index]);

        const drizzleCodes = [51, 53, 55, 56, 57];
        const rainCodes = [61, 63, 65, 66, 67];
        const showerCodes = [80, 81, 82];
        const snowCodes = [71, 73, 75, 77, 85, 86];
        const stormCodes = [95, 96, 99];
        const freezingRainCodes = [56, 57, 66, 67];

        const drizzleLike = drizzleCodes.includes(code);
        const rainLike = rainCodes.includes(code) || showerCodes.includes(code) || drizzleLike;
        const snowy = snowCodes.includes(code) || (snowfallSum ?? 0) > 0;
        const stormy = stormCodes.includes(code) || code === 82;
        const freezing = freezingRainCodes.includes(code);
        const hasPrecipAmount = (precipitation ?? 0) > 0 || (rainSum ?? 0) > 0 || (showersSum ?? 0) > 0 || (precipHours ?? 0) > 0;
        const hasPrecipSignal = rainLike || hasPrecipAmount;
        const hasPrecipProbabilitySignal = (rainProbability ?? 0) >= 40;
        const hasStrongPrecipSignal = (rainProbability ?? 0) >= 70 || (precipitation ?? 0) >= 10 || [63, 65, 66, 67, 80, 81, 82].includes(code);
        const hasUvSignal = (uv ?? 0) >= 6;

        if (stormy) return { tag: '대류 주의', tone: 'danger', note: '소나기·뇌우 계열 신호가 있어 변동성이 큽니다.' };
        if (freezing) return { tag: '어는비 주의', tone: 'danger', note: '어는비 계열 신호가 있어 도로·보행 안전을 최신 예보로 확인해 주세요.' };
        if (snowy) return { tag: '눈 가능', tone: 'warn', note: '눈 계열 예보가 있어 기온 변화와 함께 보셔야 합니다.' };

        // 8~16일 장기 구간에서는 대표 날씨가 이슬비·비·소나기 계열이면
        // UV가 높더라도 단독 “햇빛 경향”으로 보내지 않고 강수 신호를 우선합니다.
        if (hasStrongPrecipSignal) {
            return { tag: '강수 경향', tone: 'warn', note: '강수 신호가 비교적 뚜렷하지만, 8일 이후는 경향으로만 참고해 주세요.' };
        }
        if (hasPrecipSignal) {
            if (hasUvSignal && drizzleLike) {
                return { tag: '가랑비·햇빛 변동', tone: 'warn', note: '약한 이슬비와 낮 시간대 햇빛·자외선 신호가 함께 있어 시간대별 변동을 참고해 주세요.' };
            }
            if (hasUvSignal) {
                return { tag: '약한 강수·햇빛 변동', tone: 'warn', note: '약한 강수 신호와 햇빛·자외선 신호가 함께 있어 최신 시간별 예보를 다시 확인해 주세요.' };
            }
            return { tag: drizzleLike ? '약한 가랑비 경향' : '약한 강수 경향', tone: 'warn', note: '약한 비나 이슬비 신호가 있어 장기 구간에서는 강수 쪽으로 보수적으로 해석합니다.' };
        }
        if (hasPrecipProbabilitySignal) return { tag: '강수 가능 경향', tone: 'warn', note: '강수확률 신호가 있어 외출 전 최신 예보를 한 번 더 확인해 주세요.' };
        if ((gust ?? 0) >= 45) return { tag: '바람 경향', tone: 'warn', note: '바람 또는 돌풍 신호가 있어 야외 일정은 최신 예보로 다시 확인해 주세요.' };
        if ((maxTemp ?? -Infinity) >= 30) return { tag: '더위 경향', tone: 'warn', note: '낮 기온이 높게 예보되어 더위 흐름을 참고하시면 좋습니다.' };
        if ((minTemp ?? Infinity) <= 0) return { tag: '추위 경향', tone: 'warn', note: '아침 최저기온이 낮아질 수 있어 보온 흐름을 참고해 주세요.' };
        if (hasUvSignal) return { tag: '햇빛 경향', tone: 'info', note: '뚜렷한 강수 신호가 없고 낮 시간대 햇빛·자외선 흐름이 두드러집니다.' };
        return { tag: '무난 경향', tone: 'good', note: '현재 자료상 큰 위험 신호는 약하지만, 장기 예보는 변동될 수 있습니다.' };
    }

    function createTwoWeekTrendCardHTML(dailyData, index) {
        const dateObj = new Date(`${dailyData.time[index]}T00:00:00`);
        const weekday = dateObj.toLocaleDateString('ko-KR', { weekday: 'short' });
        const monthDay = dateObj.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        const weatherDetails = getWeatherDetails(dailyData.weather_code?.[index], true);
        const assessment = getTwoWeekTrendAssessment(dailyData, index);
        const minTemp = formatWithUnit(dailyData.temperature_2m_min?.[index], 0, '°');
        const maxTemp = formatWithUnit(dailyData.temperature_2m_max?.[index], 0, '°');
        const rainProbability = formatWithUnit(dailyData.precipitation_probability_max?.[index], 0, '%');
        const rainAmount = formatWithUnit(dailyData.precipitation_sum?.[index], 1, 'mm');
        const gust = formatWithUnit(dailyData.wind_gusts_10m_max?.[index], 0, 'km/h');
        const uv = formatWithUnit(dailyData.uv_index_max?.[index], 1, '');
        const dayNumber = index + 1;

        return `
            <article class="two-week-card" aria-label="${escapeHTML(monthDay)} ${escapeHTML(weekday)} 2주 경향">
                <div class="two-week-card-head">
                    <div>
                        <span class="two-week-date-main">${escapeHTML(monthDay)} ${escapeHTML(weekday)}</span>
                        <span class="two-week-date-sub">${dayNumber}일차 · 경향 예보</span>
                    </div>
                    <span class="two-week-trend-tag ${assessment.tone}">${escapeHTML(assessment.tag)}</span>
                </div>
                <div class="two-week-trend-weather">
                    <span class="icon" aria-hidden="true">${weatherDetails.icon}</span>
                    <span class="desc">${escapeHTML(weatherDetails.description)}</span>
                </div>
                <div class="two-week-temp-range"><span class="min">${escapeHTML(minTemp)}</span> / <span class="max">${escapeHTML(maxTemp)}</span></div>
                <div class="two-week-meta">
                    <span>☔ ${escapeHTML(rainProbability)} · ${escapeHTML(rainAmount)}</span>
                    <span>💨 최대 돌풍 ${escapeHTML(gust)} · ☀️ UV ${escapeHTML(uv)}</span>
                </div>
                <p class="two-week-note">${escapeHTML(assessment.note)}</p>
            </article>
        `;
    }

    function renderTwoWeekTrend(dailyData) {
        if (DOM.twoWeekTrendSection) DOM.twoWeekTrendSection.style.display = 'none';
        if (DOM.twoWeekTrendList) DOM.twoWeekTrendList.innerHTML = '';
    }

    function createHourlyForecastItemHTML(hourlyData, index) {
        const weatherDetails = getWeatherDetails(hourlyData.weather_code[index], hourlyData.is_day[index] === 1);
        const temp = Math.round(hourlyData.temperature_2m[index]);
        const precipProb = hourlyData.precipitation_probability[index];
        return `<div class="hourly-item"><span class="time">${formatTime(hourlyData.time[index])}</span><span class="icon">${weatherDetails.icon}</span><span class="temp">${temp}&deg;C</span><span class="precip">${precipProb}%</span><span class="desc">${weatherDetails.description}</span></div>`;
    }
    
    function renderHourlyDataInModal(dateStr, dayName, monthDay) { 
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

        DOM.modalTitle.textContent = `${monthDay} (${dayName}) 시간별 예보`;
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

        _appState.hourlyTempChartInstance = new Chart(ctx, { type: 'line', data: { labels: chartLabels, datasets: [ createChartDatasetOptions('hourlyTemp', chartColors, ctx, '온도 (°C)', chartTemps), createChartDatasetOptions('hourlyPrecip', chartColors, ctx, '강수 확률 (%)', chartPrecipProbs) ] }, options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, type: 'time', time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' }}}, yTemp: { ...baseOptions.scales.y, type: 'linear', position: 'left', title: { display: true, text: '온도 (°C)', color: chartColors.primaryTextColor, font: {size: 14, weight: '500', family: chartColors.fontFamily}}, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}°C`}}, yPrecip: { ...baseOptions.scales.y, type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: '강수 확률 (%)', color: chartColors.primaryTextColor, font: {size: 14, weight: '500', family: chartColors.fontFamily}}, ticks: { ...baseOptions.scales.y.ticks, callback: value => `${value}%`}, grid: { ...baseOptions.scales.y.grid, drawOnChartArea: false }} }, interaction: { mode: 'nearest', axis: 'x', intersect: false } } });
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
    Particle.prototype.setColor = function() { const style = getComputedStyle(document.documentElement); if (this.type === 'snow') this.color = style.getPropertyValue('--snow-color').trim(); else if (this.type === 'rain') this.color = style.getPropertyValue('--rain-color').trim(); };
    Particle.prototype.draw = function() { weatherEffectsCtx.beginPath(); weatherEffectsCtx.globalAlpha = this.opacity; if (this.type === 'snow') { weatherEffectsCtx.fillStyle = this.color; weatherEffectsCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); weatherEffectsCtx.fill(); } else if (this.type === 'rain') { weatherEffectsCtx.strokeStyle = this.color; weatherEffectsCtx.lineWidth = 1.5; weatherEffectsCtx.moveTo(this.x, this.y); weatherEffectsCtx.lineTo(this.x, this.y + this.length); weatherEffectsCtx.stroke(); } weatherEffectsCtx.globalAlpha = 1; };
    Particle.prototype.update = function() { this.y += this.speedY; const canvas = DOM.weatherEffectsCanvas; if (this.type === 'snow') { this.x += this.speedX; if (this.y > canvas.height + this.radius) { this.y = -this.radius; this.x = Math.random() * canvas.width; } if (this.x > canvas.width + this.radius || this.x < -this.radius) { this.x = Math.random() * canvas.width; this.y = -this.radius; } } else if (this.type === 'rain') { if (this.y > canvas.height) { this.y = Math.random() * -50; this.x = Math.random() * canvas.width; } } };
    function updateAllParticleColors() { _appState.weatherEffect.particles.forEach(p => p.setColor()); }
    function createParticles(effectType) { const effect = _appState.weatherEffect; effect.particles = []; let numParticles; const canvasArea = DOM.weatherEffectsCanvas.width * DOM.weatherEffectsCanvas.height; if (effectType === 'snow') numParticles = Math.floor(canvasArea / CONFIG.PARTICLE_DENSITY_SNOW_DIVISOR); else if (effectType === 'rain' || effectType === 'rain_snow') numParticles = Math.floor(canvasArea / CONFIG.PARTICLE_DENSITY_RAIN_DIVISOR); else return; numParticles = Math.min(numParticles, CONFIG.MAX_PARTICLES); for (let i = 0; i < numParticles; i++) { let particleType = (effectType === 'rain_snow') ? (Math.random() > 0.5 ? 'rain' : 'snow') : effectType; effect.particles.push(new Particle(particleType)); } }
    function animateParticles() { const effect = _appState.weatherEffect; weatherEffectsCtx.clearRect(0, 0, DOM.weatherEffectsCanvas.width, DOM.weatherEffectsCanvas.height); effect.particles.forEach(p => { p.update(); p.draw(); }); effect.animationFrameId = requestAnimationFrame(animateParticles); }
    function startWeatherEffect(effectType) { const effect = _appState.weatherEffect; if (effect.animationFrameId) cancelAnimationFrame(effect.animationFrameId); effect.currentEffectType = effectType; effect.particles = []; weatherEffectsCtx.clearRect(0, 0, DOM.weatherEffectsCanvas.width, DOM.weatherEffectsCanvas.height); if (effectType) { createParticles(effectType); if (effect.particles.length > 0) animateParticles(); } }
    
    // --- DATA FETCHING AND PROCESSING ---
    async function fetchWeatherData() {
        const currentP = "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m";
        const dailyP = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,rain_sum,showers_sum,snowfall_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max";
        const hourlyP = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,is_day,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index";
        const params = new URLSearchParams({
            latitude: String(LAT),
            longitude: String(LON),
            current: currentP,
            daily: dailyP,
            hourly: hourlyP,
            timezone: 'auto',
            forecast_days: '16',
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
            precipitation_unit: 'mm'
        });
        const url = `${CONFIG.API_BASE_URL}?${params.toString()}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                let errorData = { message: response.statusText, reason: "Unknown error" };
                try { errorData = await response.json(); } catch (e) { /* ignore */ }
                throw new Error(`HTTP ${response.status}: ${errorData.reason || errorData.message}`);
            }
            const data = normalizeForecastData(await response.json());
            if (!data?.current || !data?.current_weather || !data?.daily || !data?.hourly) {
                throw new Error("API 응답 데이터 형식이 올바르지 않습니다.");
            }
            return { data, url };
        } catch (error) {
            console.error('Error fetching weather data:', error);
            throw { originalError: error, failedUrl: url };
        }
    }
    
    async function fetchAirQualityData() {
        const params = new URLSearchParams({
            latitude: String(LAT),
            longitude: String(LON),
            current: 'pm10,pm2_5,us_aqi,uv_index,nitrogen_dioxide,ozone',
            hourly: 'pm10,pm2_5,us_aqi,uv_index,nitrogen_dioxide,ozone',
            timezone: 'auto',
            forecast_days: '7',
            past_hours: '24'
        });
        const url = `${CONFIG.AIR_QUALITY_API_BASE_URL}?${params.toString()}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                let errorData = { message: response.statusText, reason: "Unknown error" };
                try { errorData = await response.json(); } catch (e) { /* ignore */ }
                throw new Error(`HTTP ${response.status}: ${errorData.reason || errorData.message}`);
            }
            const data = await response.json();
            if (!data?.current || !data?.hourly) {
                throw new Error("대기질 API 응답 데이터 형식이 올바르지 않습니다.");
            }
            return { data, url };
        } catch(error) {
            console.error('Error fetching air quality data:', error);
            throw { originalError: error, failedUrl: url };
        }
    }

    function processAndDisplayAllData(weatherData, aqiData, timestamp) {
        weatherData = normalizeForecastData(weatherData);
        const current = weatherData.current_weather || weatherData.current;
        _appState.hourlyFullData = weatherData.hourly;
        _appState.airQualityFullData = aqiData ? aqiData.hourly : null;
        _appState.latestWeatherCurrentTime = current?.time || weatherData.current?.time || null;
        DOM.mainTitle.textContent = `오늘과 주간 날씨`;
        DOM.subTitle.textContent = `현재 위치의 상세한 날씨 정보를 확인하세요.`;
        renderCurrentWeather(current, weatherData.hourly, weatherData.timezone_abbreviation || weatherData.timezone);
        renderDetailedObservations(current, weatherData.hourly);
        renderAirQuality(aqiData, weatherData.daily);
        renderWeatherBriefing(current, weatherData.hourly, weatherData.daily, aqiData);
        renderNext24Hours(current, weatherData.hourly);
        renderWeeklyTempChart(weatherData.daily);
        renderDailyForecasts(weatherData.daily, aqiData ? aqiData.hourly : null);
        const currentWeatherDetails = getWeatherDetails(current?.weathercode ?? current?.weather_code, current?.is_day === 1);
        startWeatherEffect(currentWeatherDetails.effect);
        const updateTime = new Date(timestamp);
        DOM.lastUpdated.textContent = `마지막 업데이트: ${updateTime.toLocaleDateString('ko-KR')} ${updateTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit'})}`;
    }

    async function loadWeatherData() {
        if (isNaN(LAT) || isNaN(LON) || LAT < -90 || LAT > 90 || LON < -180 || LON > 180) { renderError("잘못된 위치 정보입니다. 위도는 -90 ~ 90, 경도는 -180 ~ 180 사이의 유효한 숫자여야 합니다."); renderSkeleton(false); return; }
        let cachedWeather = null; let cachedAqi = null; const now = Date.now();
        try { const cachedWeatherString = localStorage.getItem(CONFIG.WEATHER_DETAIL_CACHE_KEY); if (cachedWeatherString) { const parsed = JSON.parse(cachedWeatherString); if (parsed.lat === LAT && parsed.lon === LON && (now - parsed.timestamp < CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000)) { cachedWeather = parsed; } } const cachedAqiString = localStorage.getItem(CONFIG.AIR_QUALITY_CACHE_KEY); if (cachedAqiString) { const parsed = JSON.parse(cachedAqiString); if (parsed.lat === LAT && parsed.lon === LON && (now - parsed.timestamp < CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000)) { cachedAqi = parsed; } } } catch (e) { console.warn("캐시를 읽는 중 오류 발생:", e); localStorage.removeItem(CONFIG.WEATHER_DETAIL_CACHE_KEY); localStorage.removeItem(CONFIG.AIR_QUALITY_CACHE_KEY); }
        if (cachedWeather && cachedAqi) { processAndDisplayAllData(cachedWeather.data, cachedAqi.data, cachedWeather.timestamp); renderSkeleton(false); return; }
        renderSkeleton(true); clearError();
        const weatherPromise = cachedWeather ? Promise.resolve({data: cachedWeather.data}) : fetchWeatherData();
        const aqiPromise = cachedAqi ? Promise.resolve({data: cachedAqi.data}) : fetchAirQualityData();
        try {
            const [weatherResult, aqiResult] = await Promise.allSettled([weatherPromise, aqiPromise]);
            const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value.data : null;
            const aqiData = aqiResult.status === 'fulfilled' ? aqiResult.value.data : null;
            const fetchTimestamp = Date.now();
            if (!weatherData) { const errorInfo = weatherResult.reason; const errorMessage = errorInfo?.originalError?.message || '날씨 정보 로드 실패'; renderError(errorMessage, errorInfo?.failedUrl); return; }
            processAndDisplayAllData(weatherData, aqiData, fetchTimestamp);
            if (weatherResult.status === 'fulfilled' && !cachedWeather) { try { localStorage.setItem(CONFIG.WEATHER_DETAIL_CACHE_KEY, JSON.stringify({ timestamp: fetchTimestamp, lat: LAT, lon: LON, data: weatherData })); } catch(e) { console.warn("날씨 캐시 저장 실패", e); } }
            if (aqiResult.status === 'fulfilled' && !cachedAqi) { try { localStorage.setItem(CONFIG.AIR_QUALITY_CACHE_KEY, JSON.stringify({ timestamp: fetchTimestamp, lat: LAT, lon: LON, data: aqiData })); } catch(e) { console.warn("대기질 캐시 저장 실패", e); } }
        } finally { renderSkeleton(false); }
    }
    
    // --- EVENT LISTENERS & INITIALIZATION ---
    function setupEventListeners() {
        DOM.closeModalButton.onclick = () => DOM.hourlyModal.classList.remove(CONFIG.MODAL_ACTIVE_CLASS);
        window.onclick = event => { if (event.target === DOM.hourlyModal) DOM.hourlyModal.classList.remove(CONFIG.MODAL_ACTIVE_CLASS); };
        window.addEventListener('resize', () => { setupWeatherEffectsCanvas(); if (_appState.weatherEffect.currentEffectType) { startWeatherEffect(_appState.weatherEffect.currentEffectType); } });
        window.addEventListener('message', (event) => { if (event.origin !== window.location.origin || event.source !== window.parent) { console.warn('Blocked a message from an untrusted source:', event.origin); return; } if (event.data && event.data.type === 'setTheme') { applyTheme(event.data.theme); } });
        DOM.forecastContainer.addEventListener('click', event => { const card = event.target.closest('.weather-card'); if (card?.dataset.dateStr && card.dataset.dayName && card.dataset.monthDay) { renderHourlyDataInModal(card.dataset.dateStr, card.dataset.dayName, card.dataset.monthDay); } });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadWeatherData(); } });
    }

    function initialize() {
        const activeTheme = THEME || 'light';
        applyTheme(activeTheme);
        document.body.classList.add('theme-applied');
        setupWeatherEffectsCanvas();
        setupEventListeners();
        loadWeatherData();
    }

    initialize();

})();