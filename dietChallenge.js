(function() {
    'use strict';

    // --- 0. 설정 및 상수 (CONFIG) ---
    const CONFIG = {
        // 한국인 기준 (대한비만학회 2020)
        BMI: { 
            UNDER: 18.5, 
            NORMAL_END: 23, 
            PRE_OBESE_END: 25, 
            OBESE_1_END: 30, 
            OBESE_2_END: 35 
        }, 
        LIMITS: { MIN_WEIGHT: 30, MAX_WEIGHT: 300, MIN_FAT: 1, MAX_FAT: 70 },
        // CSS 변수명과 매핑되는 차트 색상값
        COLORS: {
            GAIN: 'var(--heatmap-gain)', // #ffcdd2
            LOSS: 'var(--secondary)',    // #bbdefb
            WEEKEND: '#F44336', 
            WEEKDAY: '#4CAF50'
        },
        // 복싱 체급 기준
        WEIGHT_CLASSES: [
            { name: "헤비급", min: 90.7 },
            { name: "크루저급", min: 79.4 },
            { name: "라이트헤비급", min: 76.2 },
            { name: "슈퍼미들급", min: 72.6 },
            { name: "미들급", min: 69.9 },
            { name: "슈퍼웰터급", min: 66.7 },
            { name: "웰터급", min: 63.5 },
            { name: "슈퍼라이트급", min: 61.2 },
            { name: "라이트급", min: 59.0 },
            { name: "슈퍼페더급", min: 57.2 },
            { name: "페더급", min: 55.3 },
            { name: "슈퍼밴텀급", min: 53.5 },
            { name: "밴텀급", min: 52.2 },
            { name: "슈퍼플라이급", min: 50.8 },
            { name: "플라이급", min: 49.0 },
            { name: "라이트플라이급", min: 47.6 },
            { name: "미니멈급", min: 0 }
        ],
        // 문자열 상수
        MESSAGES: {
            ANALYSIS: {
                LOSS: "어제보다 {diff}kg 빠졌습니다! 이대로 쭉 가봅시다! 🔥",
                GAIN: "약간 증량({diff}kg)했지만 괜찮습니다. 장기적인 추세가 중요합니다.",
                MAINTAIN: "체중 유지 중입니다. 꾸준함이 답입니다.",
                DATA_Need: "데이터가 2개 이상 쌓이면 분석을 시작합니다. 화이팅!"
            },
            PERSONA: {
                ROLLER: "🎢 롤러코스터형 (변동이 큽니다)",
                TURTLE: "🐢 꾸준한 거북이형 (안정적입니다)",
                BALANCE: "🏃 밸런스형 (적당한 변동)",
                WEEKEND: "🍻 주말 폭식형 (월요일 급증 주의)",
                RABBIT: "🐰 토끼형 (급빠급찐)"
            },
            TIPS: [
                "단백질 섭취량을 체중 1kg당 1.5g 이상으로 늘려보세요.",
                "하루 물 섭취량을 500ml 더 늘려보세요.",
                "운동 강도를 높이거나 루틴을 완전히 바꿔보세요.",
                "치팅밀이나 간식을 완전히 끊어보세요.",
                "수면 시간을 1시간 늘려보세요.",
                "간헐적 단식 시간을 2시간 더 늘려보세요."
            ],
            PLATEAU: {
                DETECTED: "🛑 <strong>정체기 감지!</strong> 최근 2주간 변화가 {diff}kg 입니다.<br>💡 팁: {tip}",
                GOOD: "📉 현재 감량 흐름이 좋습니다! 이대로 유지하세요!",
                WARN: "📈 약간의 증량이 있지만, 일시적인 현상일 수 있습니다.",
                NEED_DATA: "데이터가 충분하지 않습니다. 7일 이상 기록해주세요."
            }
        },
        // 뱃지 정의
        BADGES: [
            { id: 'start', name: '시작이 반', icon: '🐣', desc: '첫 기록을 남겼습니다.' },
            { id: 'holiday', name: '홀리데이 서바이버', icon: '🎅', desc: '명절/연말 전후 증량을 0.5kg 미만으로 막아냈습니다.' },
            { id: 'zombie', name: '돌아온 탕아', icon: '🧟', desc: '15일 이상의 공백을 깨고 다시 기록을 시작했습니다.' },
            { id: 'sniper', name: '스나이퍼', icon: '🎯', desc: '목표 체중을 소수점까지 정확하게 명중시켰습니다.' },
            { id: 'coaster', name: '롤러코스터', icon: '🎢', desc: '하루 만에 1.5kg 이상의 급격한 변화를 경험했습니다.' },
            { id: 'zen', name: '평정심', icon: '🧘', desc: '7일 연속으로 체중 변동 폭이 0.1kg 이내로 유지되었습니다.' },
            { id: 'loss3', name: '3kg 감량', icon: '🥉', desc: '총 3kg 이상 감량했습니다.' },
            { id: 'loss5', name: '5kg 감량', icon: '🥈', desc: '총 5kg 이상 감량했습니다.' },
            { id: 'loss10', name: '10kg 감량', icon: '🥇', desc: '총 10kg 이상 감량했습니다.' },
            { id: 'streak3', name: '작심삼일 탈출', icon: '🔥', desc: '3일 연속으로 감량 또는 유지했습니다.' },
            { id: 'streak7', name: '일주일 연속', icon: '⚡', desc: '7일 연속으로 감량 또는 유지했습니다.' },
            { id: 'digit', name: '앞자리 체인지', icon: '✨', desc: '체중의 십의 자리 숫자가 바뀌었습니다.' },
            { id: 'goal', name: '목표 달성', icon: '👑', desc: '최종 목표 체중에 도달했습니다.' },
            { id: 'weekend', name: '주말 방어전', icon: '🛡️', desc: '주말(토~월) 동안 체중이 늘지 않았습니다.' },
            { id: 'plateau', name: '정체기 탈출', icon: '🧗‍♀️', desc: '7일 이상의 정체기를 뚫고 감량했습니다.' },
            { id: 'bmi', name: 'BMI 돌파', icon: '🩸', desc: 'BMI 단계(비만->과체중->정상)가 개선되었습니다.' },
            { id: 'yoyo', name: '요요 방지턱', icon: '🧘', desc: '목표 달성 후 10일간 체중을 유지했습니다.' },
            { id: 'ottogi', name: '오뚜기', icon: '💪', desc: '급격한 증량 후 3일 내에 다시 복구했습니다.' },
            { id: 'recordGod', name: '기록의 신', icon: '📝', desc: '총 누적 기록 365개를 달성했습니다.' },
            { id: 'goldenCross', name: '골든 크로스', icon: '📉', desc: '급격한 하락 추세(30일 평균 대비 7일 평균 급감)에 진입했습니다.' },
            { id: 'fatDestroyer', name: '체지방 파괴자', icon: '🥓', desc: '체지방률 25% 미만에 진입했습니다.' },
            { id: 'plateauMaster', name: '정체기 끝판왕', icon: '🧱', desc: '7일 이상 변동 없다가 0.5kg 이상 감량했습니다.' },
            { id: 'recordMaster', name: '기록의 달인', icon: '📅', desc: '90일 연속으로 기록했습니다.' },
            { id: 'reborn', name: '다시 태어난', icon: '🦋', desc: '최고 체중에서 10kg 이상 감량했습니다.' },
            { id: 'slowSteady', name: '슬로우 앤 스테디', icon: '🐢', desc: '3개월간 월평균 2kg 이하로 꾸준히 감량했습니다.' },
            { id: 'weightExpert', name: '체중 변화 전문가', icon: '🎓', desc: '1개월간 4kg 이상 감량했습니다.' },
            { id: 'plateauDestroyer', name: '정체기 파괴자', icon: '🔨', desc: '2주 이상의 정체기를 극복했습니다.' },
            { id: 'iconOfConstancy', name: '꾸준함의 아이콘', icon: '🗿', desc: '6개월 이상 연속 기록을 유지했습니다.' },
            { id: 'bigStep', name: '빅 스텝', icon: '👣', desc: '하루 만에 1.0kg 이상 감량했습니다.' },
            { id: 'phoenix', name: '불사조', icon: '🐦‍🔥', desc: '요요(증량) 후 다시 심기일전하여 최저 체중을 경신했습니다.' },
            { id: 'weekendRuler', name: '주말의 지배자', icon: '🧛', desc: '금요일 아침보다 월요일 아침 체중이 같거나 낮았습니다.' },
            { id: 'curiosity', name: '궁금증 해결사', icon: '🕵️', desc: '체지방률을 안 재다가 10일 연속으로 꼼꼼히 기록했습니다.' },
            { id: 'timeTraveler', name: '시공간 초월', icon: '🚀', desc: '예상 완료일을 10일 이상 앞당겼습니다.' },
            { id: 'parking', name: '주차의 달인', icon: '🅿️', desc: '14일 동안 체중 변동 폭이 ±0.3kg 이내로 유지되었습니다.' },
            { id: 'whoosh', name: '후루룩', icon: '📉', desc: '정체기 직후 하루 만에 0.8kg 이상 감량되었습니다.' },
            { id: 'fullMoon', name: '보름달', icon: '🌕', desc: '한 달(30일) 동안 하루도 빠짐없이 기록했습니다.' },
            { id: 'lucky7', name: '럭키 세븐', icon: '🎰', desc: '체중의 소수점 자리가 .7 또는 .77로 끝납니다.' },
            { id: 'ironWall', name: '철벽 방어', icon: '🧱', desc: '최고 체중 직전에서 다시 감량했습니다.' },
            { id: 'seasonality', name: '시즌 플레이어', icon: '🗓️', desc: '4계절(3, 6, 9, 12월)에 모두 기록이 존재합니다.' },
            // v3.0.57 추가
            { id: 'decalcomania', name: '데칼코마니', icon: '🪞', desc: '이틀 연속 체중이 소수점까지 완전히 똑같습니다.' },
            { id: 'cleaning', name: '대청소', icon: '🧹', desc: '체지방 감량량이 총 체중 감량량보다 큽니다. (이상적 감량)' },
            { id: 'gyroDrop', name: '자이로드롭', icon: '📉', desc: '하루 만에 1.0kg 이상 빠졌습니다.' },
            { id: 'weekendSniper', name: '주말의 명사수', icon: '🗓️', desc: '금요일 체중보다 월요일 체중이 더 낮습니다.' },
            { id: 'piMiracle', name: '파이(π)의 기적', icon: '🔢', desc: '3.14kg 감량했거나 체중이 .14로 끝납니다.' },
            // v3.0.67 추가
            { id: 'palindrome', name: '회문 마스터', icon: '🪞', desc: '체중이 78.87, 65.56 처럼 앞뒤가 똑같은 숫자입니다.' },
            { id: 'anniversary', name: '기념일 챙기기', icon: '🎉', desc: '기록 시작 100일, 1주년 또는 1000일을 달성했습니다.' },
            // v3.0.71 추가
            { id: 'breakMaster', name: '브레이크 마스터', icon: '🛑', desc: '폭식(급증) 후 다음날 즉시 50% 이상을 복구했습니다.' },
            { id: 'weekendVictory', name: '주말 방어전 승리', icon: '🗓️', desc: '금요일 체중보다 월요일 체중이 더 낮거나 같습니다.' },
            { id: 'maintainerQual', name: '유지어터의 자질', icon: '🧘', desc: '감량 없이 ±0.2kg 범위 내에서 10일 이상 머물렀습니다.' },
            { id: 'wallBreaker', name: '마의 구간 돌파', icon: '📉', desc: '가장 오래 머물렀던 체중 구간을 뚫고 내려갔습니다.' }
        ]
    };

    // --- 0.1 유틸리티 (DateUtil, MathUtil, DomUtil) ---
    const DateUtil = {
        parse: (str) => {
            if (!str) return null;
            const parts = str.split('-');
            return new Date(parts[0], parts[1] - 1, parts[2]);
        },
        format: (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },
        daysBetween: (d1, d2) => (d2 - d1) / (1000 * 3600 * 24),
        addDays: (dateStr, days) => {
            const d = DateUtil.parse(dateStr);
            d.setDate(d.getDate() + days);
            return DateUtil.format(d);
        },
        isFuture: (dateStr) => {
            const inputDate = DateUtil.parse(dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return inputDate > today;
        },
        getDaysInMonth: (year, month) => {
            return new Date(year, month + 1, 0).getDate();
        },
        getWeekNumber: (d) => {
            d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
            return weekNo;
        }
    };

    const MathUtil = {
        round: (num, decimals = 1) => {
            if (num === null || num === undefined) return 0;
            const factor = Math.pow(10, decimals);
            return Math.round((num + Number.EPSILON) * factor) / factor;
        },
        diff: (a, b) => MathUtil.round(a - b),
        add: (a, b) => MathUtil.round(a + b),
        clamp: (num, min, max) => Math.min(Math.max(num, min), max),
        stdDev: (arr) => {
            if (arr.length === 0) return 0;
            const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
            const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
            return Math.sqrt(variance);
        },
        mean: (arr) => arr.length ? arr.reduce((a,b)=>a+b, 0) / arr.length : 0
    };

    const DomUtil = {
        escapeHtml: (text) => {
            if (text === null || text === undefined) return '';
            return String(text)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },
        getChartColors: () => {
            const styles = getComputedStyle(document.body);
            return {
                grid: styles.getPropertyValue('--chart-grid').trim(),
                text: styles.getPropertyValue('--chart-text').trim(),
                primary: styles.getPropertyValue('--primary').trim(),
                secondary: styles.getPropertyValue('--secondary').trim(),
                danger: styles.getPropertyValue('--danger').trim(),
                accent: styles.getPropertyValue('--accent').trim()
            };
        },
        setTextColor: (el, colorType) => {
            if (!el) return;
            el.className = el.className.replace(/\btext-\S+/g, '');
            if (colorType === 'danger') el.classList.add('text-danger');
            else if (colorType === 'primary') el.classList.add('text-primary');
            else if (colorType === 'secondary') el.classList.add('text-secondary');
            else if (colorType === 'accent') el.classList.add('text-accent');
            else if (colorType === 'default') el.classList.add('text-default');
        },
        getTemplate: (id) => document.getElementById(id),
        clearAndAppend: (element, fragment) => {
            if (!element) return;
            element.innerHTML = '';
            element.appendChild(fragment);
        }
    };

    const debounce = (func, delay) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func(...args), delay);
        };
    };

    // --- 1. 상태 및 DOM 관리 ---
    const AppState = {
        STORAGE_KEY: 'diet_pro_records',
        SETTINGS_KEY: 'diet_pro_settings',
        FILTER_KEY: 'diet_pro_filter_mode',
        records: [],
		settings: { height: 179, startWeight: 78.5, goal1: 70, intake: 1862 }, 
        chartFilterMode: 'ALL',
        customStart: null,
        customEnd: null,
        // charts 객체는 차트 인스턴스 추적용
        charts: {}, 
        _elCache: {},
        getEl: function(id) {
            if (!this._elCache[id]) {
                this._elCache[id] = document.getElementById(id);
            }
            return this._elCache[id];
        },
        state: {
            editingDate: null, 
            statsCache: null, 
            isDirty: true,     
            calendarViewDate: new Date() 
        }
    };

    // --- 2. 초기화 ---
    function init() {
        const ids = [
            'dateInput', 'weightInput', 'fatInput', 'userHeight', 'startWeight', 'goal1Weight', 'dailyIntake',
            'settingsPanel', 'badgeGrid', 'jsonFileInput', 'csvImportInput', 'resetConfirmInput', 'recordInputGroup',
            'chartStartDate', 'chartEndDate', 'showTrend',
            'currentWeightDisplay', 'totalLostDisplay', 'percentLostDisplay', 'progressPercent',
            'remainingWeightDisplay', 'remainingPercentDisplay', 'bmiDisplay', 'predictedDate',
            'predictionRange', 'dashboardRate7Days', 'dashboardRate30Days', 'streakDisplay', 'successRateDisplay', 'minMaxWeightDisplay',
            'dailyVolatilityDisplay', 'weeklyAvgDisplay', 'monthCompareDisplay', 'analysisText',
            'lbmDisplay', 'lbmiDisplay', 'dDayDisplay', 'estTdeeDisplay', 'estTdeeSubDisplay', 'weeklyEffDisplay', 'shortTrendDisplay', 
            'waterIndexDisplay', 'netChangeDisplay', 'netChangeSubDisplay', 'consistencyDisplay', 'deficitDisplay', 'ffmiDisplay',
            'maDisparityDisplay', 'weightClassDisplay', 'recoveryScoreDisplay', 
            'plateauHelperText', 'yoyoRiskDisplay', 'recent3DayAvgDisplay', 'weeklySpeedDisplay', 'idealWeeklyRateDisplay',
            'bodyCompBalanceDisplay', 'lossConsistencyDisplay', 'calEfficiencyDisplay', 'volatilityIndexDisplay', 'bodyCompTrendDisplay',
            'metabolicAgeDisplay', 'dietCostDisplay', 'weekendImpactDisplay', 'muscleLossCard', 'muscleLossDisplay',
            'paperTowelDisplay', 'bmiPrimeDisplay', 'surplusCalDisplay', 'metabolicAdaptDisplay',
            'cvDisplay', 'resistanceTableBody', 'weekdayProbTableBody', 'controlChart', 'violinChart', 'githubCalendarChart',
            'dailyWinRateTable', 'zoneDurationTable', 'streakDetailTable', 'bestWorstMonthTable', 'zoneReportTableBody', 'sprintTableBody', 'gradesTableBody',
            'top5TableBody', 'monthlyRateTableBody',
            'advancedAnalysisList', 'calendarContainer', 'periodCompareTable', 'detailedStatsTable',
            'progressBarFill', 'progressEmoji', 'progressText', 'labelStart', 'labelGoal',
            'bmiProgressBarFill', 'bmiProgressEmoji', 'bmiProgressText', 'bmiLabelLeft', 'bmiLabelRight',
            'rate7Days', 'rate30Days', 'weeklyCompareDisplay', 'heatmapGrid', 'chartBackdrop',
            'monthlyTableBody', 'weeklyTableBody', 'milestoneTableBody', 'historyList',
            'tab-monthly', 'tab-weekly', 'tab-milestone', 'tab-history', 'tab-zone', 'tab-sprint', 'tab-grades', 'tab-btn-top5', 'tab-btn-monthly-rate',
            'btn-1m', 'btn-3m', 'btn-6m', 'btn-1y', 'btn-all', 
            'tab-btn-monthly', 'tab-btn-weekly', 'tab-btn-milestone', 'tab-btn-history', 'tab-btn-zone', 'tab-btn-sprint', 'tab-btn-grades', 'tab-btn-top5', 'tab-btn-monthly-rate',
            'recordBtn',
            'radarChart', 'candleStickChart', 'macdChart', 'seasonalSpiralChart',
            // --- [NEW] v3.0.71 추가 ID ---
            'trendDeviationDisplay', 'lbmRetentionDisplay', 'sodiumWarningDisplay', 'cvStatusDisplay',
            'goalTunnelChart', 'drawdownChart', 'lbmFatAreaChart', 'speedometerChart',
            'wallTableBody', 'monthlyFatLossTableBody',
            // [추가] 이벤트 리스너용 ID들
            'btn-theme-toggle', 'btn-settings-toggle', 'btn-save-settings', 'btn-import-json', 'btn-export-json', 'btn-export-csv', 'btn-import-csv', 'btn-reset-data', 'badge-toggle-header'
        ];
        ids.forEach(id => AppState.getEl(id));
        
        // --- [CSP 수정] 이벤트 리스너 연결 ---
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('click', handler);
        };
        const bindChange = (id, handler) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('change', handler);
        };

        bindClick('btn-theme-toggle', toggleDarkMode);
        bindClick('btn-settings-toggle', toggleSettings);
        bindClick('btn-save-settings', saveSettings);
        bindClick('btn-import-json', importJSON);
        bindClick('btn-export-json', exportJSON);
        bindClick('btn-export-csv', exportCSV);
        bindClick('btn-import-csv', importCSV);
        bindClick('btn-reset-data', safeResetData);
        bindClick('recordBtn', addRecord);
        bindClick('badge-toggle-header', toggleBadges);
        bindClick('chartBackdrop', closeAllExpands);

        bindChange('showTrend', updateMainChart);
        bindChange('chartStartDate', applyCustomDateRange);
        bindChange('chartEndDate', applyCustomDateRange);

        // 필터 버튼들
        bindClick('btn-1m', () => setChartFilter('1M'));
        bindClick('btn-3m', () => setChartFilter('3M'));
        bindClick('btn-6m', () => setChartFilter('6M'));
        bindClick('btn-1y', () => setChartFilter('1Y'));
        bindClick('btn-all', () => setChartFilter('ALL'));

        // 탭 버튼들
        bindClick('tab-btn-history', () => switchTab('tab-history'));
        bindClick('tab-btn-monthly', () => switchTab('tab-monthly'));
        bindClick('tab-btn-weekly', () => switchTab('tab-weekly'));
        bindClick('tab-btn-milestone', () => switchTab('tab-milestone'));
        bindClick('tab-btn-zone', () => switchTab('tab-zone'));
        bindClick('tab-btn-sprint', () => switchTab('tab-sprint'));
        bindClick('tab-btn-grades', () => switchTab('tab-grades'));
        bindClick('tab-btn-top5', () => switchTab('tab-top5'));
        bindClick('tab-btn-monthly-rate', () => switchTab('tab-monthly-rate'));

        // 확대 버튼들 (클래스 기반)
        document.querySelectorAll('.expand-chart-btn').forEach(btn => {
            btn.addEventListener('click', function() { toggleChartExpand(this); });
        });

        // -------------------------------------
        // [수정됨] 캘린더 뷰 이벤트 위임 추가 (버튼 및 셀렉트 박스)
        const calContainer = AppState.getEl('calendarContainer');
        if (calContainer) {
            calContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('cal-btn-prev')) {
                    changeCalendarMonth(-1);
                } else if (e.target.classList.contains('cal-btn-next')) {
                    changeCalendarMonth(1);
                }
            });
            calContainer.addEventListener('change', (e) => {
                if (e.target.id === 'calYearSelect' || e.target.id === 'calMonthSelect') {
                    jumpToCalendarDate();
                }
            });
        }
        // -------------------------------------

        const dateInput = AppState.getEl('dateInput');
        if (dateInput) dateInput.value = DateUtil.format(new Date());
        
        try {
            AppState.records = JSON.parse(localStorage.getItem(AppState.STORAGE_KEY)) || [];
            const savedSettings = JSON.parse(localStorage.getItem(AppState.SETTINGS_KEY));
            if (savedSettings) AppState.settings = savedSettings;
        } catch (e) {
            console.error('Data Load Error', e);
            AppState.records = [];
        }

        AppState.chartFilterMode = localStorage.getItem(AppState.FILTER_KEY) || 'ALL';
        
        // [기능 추가] 부모 창(MothNote)의 테마 설정 확인 (URL 파라미터)
        const urlParams = new URLSearchParams(window.location.search);
        const theme = urlParams.get('theme');
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else if (localStorage.getItem('diet_pro_dark_mode') === 'true') {
            document.body.classList.add('dark-mode');
        }

        const hEl = AppState.getEl('userHeight');
        const sEl = AppState.getEl('startWeight');
        const gEl = AppState.getEl('goal1Weight');
        const iEl = AppState.getEl('dailyIntake');

        if(hEl) hEl.value = AppState.settings.height;
        if(sEl) sEl.value = AppState.settings.startWeight;
        if(gEl) gEl.value = AppState.settings.goal1;
        if(iEl) iEl.value = AppState.settings.intake || 1862;

        if(AppState.records.length > 0) {
            AppState.state.calendarViewDate = DateUtil.parse(AppState.records[AppState.records.length-1].date);
        }

        // 이벤트 위임
        const hmGrid = AppState.getEl('heatmapGrid');
        if (hmGrid) {
            hmGrid.addEventListener('click', (e) => {
                const cell = e.target.closest('.heatmap-cell');
                if(cell && cell.title) showToast(cell.title);
            });
        }
        
        const badgeGrid = AppState.getEl('badgeGrid');
        if (badgeGrid) {
            badgeGrid.addEventListener('click', (e) => {
                const item = e.target.closest('.badge-item');
            });
        }

        const handleEnter = (e) => { if(e.key === 'Enter') addRecord(); };
        const wInput = AppState.getEl('weightInput');
        const fInput = AppState.getEl('fatInput');
        if (wInput) wInput.addEventListener('keyup', handleEnter);
        if (fInput) fInput.addEventListener('keyup', handleEnter);

        const histList = AppState.getEl('historyList');
        if (histList) {
            histList.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.dataset.action;
                const date = btn.dataset.date;
                
                if (action === 'edit') App.enableInlineEdit(date);
                else if (action === 'delete') deleteRecord(date);
                else if (action === 'save-inline') App.saveInlineEdit(date);
                else if (action === 'cancel-inline') App.cancelInlineEdit();
            });
        }
        
        // [기능 추가] 부모 창(MothNote)로부터 테마 변경 메시지 수신
        window.addEventListener('message', (event) => {
            if (event.data.type === 'setTheme') {
                if (event.data.theme === 'dark') {
                    document.body.classList.add('dark-mode');
                    localStorage.setItem('diet_pro_dark_mode', 'true');
                } else {
                    document.body.classList.remove('dark-mode');
                    localStorage.setItem('diet_pro_dark_mode', 'false');
                }
                updateUI(); // 테마 변경 후 UI(차트 등) 업데이트
            }
        });

        updateFilterButtons();
        updateUI();
    }
	
    // --- 3. 기본 기능 ---
    const debouncedSaveRecords = debounce(() => {
        localStorage.setItem(AppState.STORAGE_KEY, JSON.stringify(AppState.records));
    }, 500);

    const debouncedSaveSettings = debounce(() => {
        localStorage.setItem(AppState.SETTINGS_KEY, JSON.stringify(AppState.settings));
    }, 500);

    function showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function toggleSettings() {
        const panel = AppState.getEl('settingsPanel');
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }

    function toggleBadges() {
        const grid = AppState.getEl('badgeGrid');
        grid.style.display = grid.style.display === 'grid' ? 'none' : 'grid';
    }

    function toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('diet_pro_dark_mode', document.body.classList.contains('dark-mode'));
        updateUI(); 
    }

    function saveSettings() {
        const height = parseFloat(AppState.getEl('userHeight').value);
        const startWeight = parseFloat(AppState.getEl('startWeight').value);
        const goal1 = parseFloat(AppState.getEl('goal1Weight').value);
        const intake = parseFloat(AppState.getEl('dailyIntake').value);

        if (isNaN(height) || height <= 0 || height > 300) return showToast('유효한 키(cm)를 입력해주세요.');
        if (isNaN(startWeight) || startWeight <= 0 || startWeight > 500) return showToast('유효한 시작 체중을 입력해주세요.');
        if (isNaN(goal1) || goal1 <= 0 || goal1 > 500) return showToast('유효한 목표 체중을 입력해주세요.');

        AppState.settings.height = height;
        AppState.settings.startWeight = startWeight;
        AppState.settings.goal1 = goal1;
        AppState.settings.intake = intake || 2000;
        
        AppState.state.isDirty = true;
        debouncedSaveSettings();
        toggleSettings();
        updateUI();
        showToast('설정이 저장되었습니다.');
    }

    function addRecord() {
        const date = AppState.getEl('dateInput').value;
        const weight = parseFloat(AppState.getEl('weightInput').value);
        const fat = parseFloat(AppState.getEl('fatInput').value);

        if (!date) return showToast('날짜를 입력해주세요.');
        
        if (isNaN(weight) || weight < CONFIG.LIMITS.MIN_WEIGHT || weight > CONFIG.LIMITS.MAX_WEIGHT) {
            return showToast(`유효한 체중을 입력해주세요 (${CONFIG.LIMITS.MIN_WEIGHT}~${CONFIG.LIMITS.MAX_WEIGHT}kg).`);
        }
        if (!isNaN(fat) && (fat < CONFIG.LIMITS.MIN_FAT || fat > CONFIG.LIMITS.MAX_FAT)) {
            return showToast(`유효한 체지방률을 입력해주세요 (${CONFIG.LIMITS.MIN_FAT}~${CONFIG.LIMITS.MAX_FAT}%).`);
        }

        const record = { date, weight: MathUtil.round(weight) };
        if (!isNaN(fat)) record.fat = MathUtil.round(fat);

        const existingIndex = AppState.records.findIndex(r => r.date === date);

        if (AppState.state.editingDate) {
            if (AppState.state.editingDate !== date) {
                if (existingIndex >= 0) {
                    if (!confirm(`${date}에 이미 기록이 있습니다. 덮어쓰시겠습니까?`)) return;
                    AppState.records = AppState.records.filter(r => r.date !== AppState.state.editingDate && r.date !== date);
                    AppState.records.push(record);
                } else {
                    AppState.records = AppState.records.filter(r => r.date !== AppState.state.editingDate);
                    AppState.records.push(record);
                }
            } else {
                AppState.records[existingIndex] = record;
            }
        } else {
            if (existingIndex >= 0) {
                if(!confirm(`${date}에 이미 기록이 있습니다. 덮어쓰시겠습니까?`)) return;
                AppState.records[existingIndex] = record;
            } else {
                AppState.records.push(record);
            }
        }

        AppState.records.sort((a, b) => new Date(a.date) - new Date(b.date));
        AppState.state.isDirty = true;
        debouncedSaveRecords();
        
        resetForm(date); 
        updateUI();
        showToast('기록이 저장되었습니다.');
    }

    function resetForm(lastDateStr = null) {
        if (lastDateStr) {
            AppState.getEl('dateInput').value = DateUtil.addDays(lastDateStr, 1);
        } else {
            AppState.getEl('dateInput').value = DateUtil.format(new Date());
        }
        AppState.getEl('weightInput').value = '';
        AppState.getEl('fatInput').value = '';
        AppState.state.editingDate = null;
        
        const rBtn = AppState.getEl('recordBtn');
        rBtn.innerText = '기록하기 📝';
        rBtn.classList.remove('editing-mode');
        AppState.getEl('weightInput').focus();
    }

    function deleteRecord(date) {
        if(confirm('이 날짜의 기록을 삭제하시겠습니까?')) {
            AppState.records = AppState.records.filter(r => r.date !== date);
            AppState.state.isDirty = true;
            debouncedSaveRecords();
            updateUI();
            showToast('삭제되었습니다.');
        }
    }

    function editRecord(date) {
        const record = AppState.records.find(r => r.date === date);
        if (record) {
            AppState.getEl('dateInput').value = record.date;
            AppState.getEl('weightInput').value = record.weight;
            if (record.fat) AppState.getEl('fatInput').value = record.fat;
            else AppState.getEl('fatInput').value = '';
            
            AppState.state.editingDate = date; 
            const rBtn = AppState.getEl('recordBtn');
            rBtn.innerText = '수정 완료 ✔️';
            rBtn.classList.add('editing-mode');

            window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast(`${date} 기록을 수정합니다.`);
            
            const inputGroup = AppState.getEl('recordInputGroup');
            inputGroup.classList.add('highlight');
            setTimeout(() => inputGroup.classList.remove('highlight'), 1000);
        }
    }

    function safeResetData() {
        const input = AppState.getEl('resetConfirmInput');
        if (input.value === "초기화") {
            localStorage.removeItem(AppState.STORAGE_KEY);
            AppState.records = [];
            AppState.state.isDirty = true;
            input.value = '';
            updateUI();
            showToast('초기화되었습니다.');
        } else {
            showToast('"초기화"라고 정확히 입력해주세요.');
        }
    }

    function importJSON() {
        const file = AppState.getEl('jsonFileInput').files[0];
        if (!file) return showToast('JSON 파일을 선택해주세요.');
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result.trim().replace(/^\uFEFF/, '');
            try {
                const data = JSON.parse(content);
                if(data.records && Array.isArray(data.records)) {
                    AppState.records = data.records.filter(r => r.date && !isNaN(r.weight));
                    if(data.settings) AppState.settings = data.settings;
                    
                    AppState.records.sort((a, b) => new Date(a.date) - new Date(b.date));
                    AppState.state.isDirty = true;
                    
                    localStorage.setItem(AppState.STORAGE_KEY, JSON.stringify(AppState.records));
                    localStorage.setItem(AppState.SETTINGS_KEY, JSON.stringify(AppState.settings));
                    
                    updateUI();
                    showToast('데이터(JSON) 복원 완료');
                } else {
                    throw new Error('올바르지 않은 JSON 형식');
                }
            } catch(err) {
                showToast('JSON 파일 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function importCSV() {
        const file = AppState.getEl('csvImportInput').files[0];
        if (!file) return showToast('CSV 파일을 선택해주세요.');

        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result.trim().replace(/^\uFEFF/, '');
            const lines = content.split(/\r?\n/);
            let count = 0;
            const csvRegex = /(?:^|,)(?:"([^"]*)"|([^",]*))/g;
            
            for(let i=0; i<lines.length; i++) {
                const line = lines[i].trim();
                if(!line || line.toLowerCase().startsWith('date')) continue; 
                
                const matches = [];
                let match;
                while ((match = csvRegex.exec(line)) !== null) {
                     matches.push(match[1] ? match[1] : match[2]);
                }
                
                if(matches.length >= 2) {
                    const d = matches[0].trim().replace(/['"]/g, ''); 
                    const w = parseFloat(matches[1]);
                    
                    if(d.match(/^\d{4}-\d{2}-\d{2}$/) && !isNaN(w)) {
                        const rec = { date: d, weight: w };
                        if(matches[2] && !isNaN(parseFloat(matches[2]))) {
                            rec.fat = parseFloat(matches[2]);
                        }
                        const idx = AppState.records.findIndex(r => r.date === d);
                        if(idx >= 0) AppState.records[idx] = rec;
                        else AppState.records.push(rec);
                        count++;
                    }
                }
                csvRegex.lastIndex = 0;
            }
            AppState.records.sort((a, b) => new Date(a.date) - new Date(b.date));
            AppState.state.isDirty = true;
            
            localStorage.setItem(AppState.STORAGE_KEY, JSON.stringify(AppState.records));
            
            updateUI();
            showToast(`${count}건의 데이터(CSV)를 불러왔습니다.`);
        };
        reader.readAsText(file);
    }

	function exportCSV() {
        if (AppState.records.length === 0) return showToast('내보낼 데이터가 없습니다.');
        let csvContent = "\uFEFFDate,Weight,BodyFat\n";
        AppState.records.forEach(row => {
            csvContent += `${row.date},${row.weight},${row.fat || ''}\n`;
        });

        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        
        const fileName = `${yy}${mm}${dd}_Diet_Challenge_Backup.csv`;
        downloadFile(csvContent, fileName, "text/csv;charset=utf-8");
    }

	function exportJSON() {
        const data = {
            settings: AppState.settings,
            records: AppState.records,
            exportDate: new Date().toISOString()
        };

        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        
        const fileName = `${yy}${mm}${dd}_Diet_Challenge_Backup.json`;
        downloadFile(JSON.stringify(data, null, 2), fileName, "application/json");
    }
	
    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // --- 4. 메인 렌더링 함수 ---
    function updateUI() {
        if(AppState.state.isDirty) {
            AppState.state.statsCache = analyzeRecords(AppState.records);
            AppState.state.isDirty = false;
        }
        const s = AppState.state.statsCache;
        
        renderStats(s);
        renderNewStats(s); 
        renderAnalysisText(s);
        renderAdvancedText(s); 
        renderPlateauHelper(s); 
        renderPeriodComparison(); 
        renderDetailedStats(s); 
        renderExtendedStats(); 
        renderNewTables(); 
        
        renderResistanceTable();
        renderWeekdayProbTable();

        const colors = DomUtil.getChartColors();
        updateMainChart(colors);
        updateDayOfWeekChart(colors);
        updateHistogram(colors);
        updateCumulativeChart(colors);
        updateMonthlyChangeChart(colors);
        updateBodyFatChart(colors);
        updateScatterChart(colors); 
        updateWeekendChart(colors); 
        updateBodyCompStackedChart(colors); 
        updateMonthlyBoxPlotChart(colors); 
        updateRocChart(colors); 

        updateGhostRunnerChart(colors);
        updateGaugeCharts(colors);
        updateWeeklyBodyCompChart(colors); 
        updateWeightSpeedScatterChart(colors); 
        updateWaterfallChart(colors);
        updateSeasonalityChart(colors);
        updateBellCurveChart(colors);
        
        updateRadarChart(colors);
        updateCandleStickChart(colors);
        updateMacdChart(colors);
        updateSeasonalSpiralChart(colors);

        updateControlChart(colors);
        updateViolinChart(colors);
        updateGithubStyleCalendar();
        
        // --- [NEW] v3.0.71 추가 차트 업데이트 호출 ---
        updateGoalTunnelChart(colors);
        updateDrawdownChart(colors);
        updateLbmFatAreaChart(colors);
        updateSpeedometerChart(colors);

        renderHeatmap();
        renderCalendarView(); 
        renderAllTables();
        renderBadges(s);
    }

    // --- 5. 분석 계산 로직 ---
    function analyzeRecords(records) {
        if (!records || records.length === 0) return {};
        
        const weights = records.map(r => r.weight);
        const current = weights[weights.length - 1];
        const min = Math.min(...weights);
        const max = Math.max(...weights);
        const lastRec = records[records.length - 1];
        
        let maxStreak = 0, curStreak = 0;
        let successCount = 0;
        let maxDrop = 0, maxGain = 0;
        let diffs = [];

        if (records.length > 1) {
            for (let i = 1; i < records.length; i++) {
                const diff = MathUtil.diff(records[i].weight, records[i-1].weight);
                diffs.push(diff);

                if (diff <= 0) curStreak++;
                else curStreak = 0;
                if (curStreak > maxStreak) maxStreak = curStreak;

                if (diff < 0) successCount++;

                const dayDiff = DateUtil.daysBetween(new Date(records[i-1].date), new Date(records[i].date));
                if (dayDiff === 1) {
                    if (diff < 0 && Math.abs(diff) > maxDrop) maxDrop = Math.abs(diff);
                    if (diff > 0 && diff > maxGain) maxGain = diff;
                }
            }
        }

        const maxRec = records.find(r => r.weight === max) || {};
        const minRec = records.find(r => r.weight === min) || {};
        const stdDev = MathUtil.stdDev(weights);
        
        const mean = MathUtil.mean(weights);
        const cv = mean !== 0 ? (stdDev / mean) * 100 : 0;

        let fatChange = 0, lbmChange = 0;
        const firstFatRec = records.find(r => r.fat);
        const lastFatRec = [...records].reverse().find(r => r.fat);
        if(firstFatRec && lastFatRec) {
            const startFatKg = firstFatRec.weight * (firstFatRec.fat / 100);
            const endFatKg = lastFatRec.weight * (lastFatRec.fat / 100);
            fatChange = MathUtil.diff(endFatKg, startFatKg);
            
            const startLbmKg = firstFatRec.weight * (1 - firstFatRec.fat / 100);
            const endLbmKg = lastFatRec.weight * (1 - lastFatRec.fat / 100);
            lbmChange = MathUtil.diff(endLbmKg, startLbmKg);
        }

        let maxPlateau = 0, curPlateau = 0;
        for(let i=1; i<records.length; i++) {
            if(Math.abs(MathUtil.diff(records[i].weight, records[i-1].weight)) < 0.2) curPlateau++;
            else curPlateau = 0;
            if(curPlateau > maxPlateau) maxPlateau = curPlateau;
        }

        const totalLost = MathUtil.diff(AppState.settings.startWeight, current);
        const hMeter = AppState.settings.height / 100;
		const bmi = Math.round((current / (hMeter * hMeter)) * 100) / 100;

        const getRateVal = (days) => {
             const now = new Date(); now.setHours(0,0,0,0);
             const startTimestamp = now.getTime() - (days * 24 * 60 * 60 * 1000);
             const rel = records.filter(r => DateUtil.parse(r.date).getTime() >= startTimestamp);
             if(rel.length < 2) return "-";
             const diff = MathUtil.diff(rel[rel.length-1].weight, rel[0].weight);
             const d = DateUtil.daysBetween(DateUtil.parse(rel[0].date), DateUtil.parse(rel[rel.length-1].date));
             if(d===0) return "-";
             const g = ((diff/d)*1000).toFixed(0);
             return `${g > 0 ? '+' : ''}${g}g / 일`;
        };
        const rate7 = getRateVal(7);
        const rate30 = getRateVal(30);

        const now = new Date(); now.setHours(0,0,0,0);
        const t7 = now.getTime() - (7 * 24 * 60 * 60 * 1000);
        const t14 = now.getTime() - (14 * 24 * 60 * 60 * 1000);
        const thisW = records.filter(r => DateUtil.parse(r.date).getTime() >= t7);
        const lastW = records.filter(r => { const t = DateUtil.parse(r.date).getTime(); return t >= t14 && t < t7; });
        let weeklyComp = "데이터 부족";
        if(thisW.length > 0 && lastW.length > 0) {
            const avgT = thisW.reduce((a,b)=>a+b.weight,0)/thisW.length;
            const avgL = lastW.reduce((a,b)=>a+b.weight,0)/lastW.length;
            const diff = MathUtil.diff(avgT, avgL);
            const icon = diff < 0 ? '🔻' : (diff > 0 ? '🔺' : '➖');
            weeklyComp = `${icon} ${Math.abs(diff)}kg`;
        }

        const thisMonthKey = DateUtil.format(now).slice(0, 7);
        const lastMonthDate = new Date(); lastMonthDate.setMonth(now.getMonth()-1);
        const lastMonthKey = DateUtil.format(lastMonthDate).slice(0, 7);
        const thisMonthRecs = records.filter(r => r.date.startsWith(thisMonthKey));
        const lastMonthRecs = records.filter(r => r.date.startsWith(lastMonthKey));
        let monthlyComp = '-';
        if(thisMonthRecs.length > 0 && lastMonthRecs.length > 0) {
            const avgThis = thisMonthRecs.reduce((a,b)=>a+b.weight,0)/thisMonthRecs.length;
            const avgLast = lastMonthRecs.reduce((a,b)=>a+b.weight,0)/lastMonthRecs.length;
            const diff = MathUtil.diff(avgThis, avgLast);
            monthlyComp = `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}kg`;
        }
        
        let weeklyAvgLoss = '-';
        if(records.length >= 2) {
             const weeks = {};
             [...records].forEach(r => {
                const d = DateUtil.parse(r.date);
                const day = d.getDay();
                const monday = new Date(d.setDate(d.getDate() - day + (day == 0 ? -6 : 1)));
                monday.setHours(0,0,0,0);
                const key = monday.getTime();
                if(!weeks[key]) weeks[key] = [];
                weeks[key].push(r.weight);
             });
             const weekKeys = Object.keys(weeks).sort();
             if(weekKeys.length >= 2) {
                 let totalL = 0, count = 0;
                 for(let i=1; i<weekKeys.length; i++) {
                     const prevAvg = weeks[weekKeys[i-1]].reduce((a,b)=>a+b,0)/weeks[weekKeys[i-1]].length;
                     const currAvg = weeks[weekKeys[i]].reduce((a,b)=>a+b,0)/weeks[weekKeys[i]].length;
                     totalL += (prevAvg - currAvg);
                     count++;
                 }
                 if(count > 0) weeklyAvgLoss = (totalL / count).toFixed(2);
             }
        }

        return {
            current, min, max, maxStreak, lastRec, diffs,
            successRate: records.length > 1 ? Math.round((successCount / (records.length - 1)) * 100) : 0,
            maxDrop: MathUtil.round(maxDrop), 
            maxGain: MathUtil.round(maxGain),
            maxDate: maxRec.date, minDate: minRec.date,
            stdDev: stdDev,
            cv: cv,
            fatChange, lbmChange,
            maxPlateau,
            totalLost, bmi, rate7, rate30, weeklyComp, monthlyComp, weeklyAvgLoss
        };
    }

    // --- 6. 통계 렌더링 ---
    function renderStats(s) {
        const currentW = s.current !== undefined ? s.current : AppState.settings.startWeight;
        const totalLost = s.totalLost !== undefined ? s.totalLost : 0;
        
        AppState.getEl('currentWeightDisplay').innerText = currentW.toFixed(1) + 'kg';
        const totalLostEl = AppState.getEl('totalLostDisplay');
        totalLostEl.innerText = `${totalLost}kg`;
        DomUtil.setTextColor(totalLostEl, totalLost > 0 ? 'primary' : (totalLost < 0 ? 'danger' : 'default'));

        let pct = 0;
        const totalGap = MathUtil.diff(AppState.settings.startWeight, AppState.settings.goal1);
        const currentGap = MathUtil.diff(AppState.settings.startWeight, currentW);
        if(Math.abs(totalGap) > 0.01) {
             pct = (currentGap / totalGap) * 100;
        }
        
        const displayPct = MathUtil.clamp(pct, 0, 100);
        AppState.getEl('progressPercent').innerText = displayPct.toFixed(1) + '%';
        
        const remaining = MathUtil.diff(currentW, AppState.settings.goal1);
        const remainingDisplay = AppState.getEl('remainingWeightDisplay');
        remainingDisplay.innerText = `${remaining > 0 ? remaining : 0}kg`;
        DomUtil.setTextColor(remainingDisplay, remaining <= 0 ? 'secondary' : 'default');

        let remainingPct = 0;
        if(totalGap !== 0) {
            remainingPct = (remaining / totalGap * 100);
            if(remainingPct < 0) remainingPct = 0;
        }
        AppState.getEl('remainingPercentDisplay').innerText = `${remainingPct.toFixed(1)}%`;

        const bmi = s.bmi || 0;
        
        let bmiLabel = '정상';
        if(bmi < CONFIG.BMI.UNDER) bmiLabel = '저체중';
        else if(bmi < CONFIG.BMI.NORMAL_END) bmiLabel = '정상';
        else if(bmi < CONFIG.BMI.PRE_OBESE_END) bmiLabel = '비만 전 단계 (과체중, 위험 체중)';
        else if(bmi < CONFIG.BMI.OBESE_1_END) bmiLabel = '1단계 비만';
        else if(bmi < CONFIG.BMI.OBESE_2_END) bmiLabel = '2단계 비만';
        else bmiLabel = '3단계 비만 (고도 비만)';
        
		AppState.getEl('bmiDisplay').innerText = `BMI: ${bmi.toFixed(2)} (${bmiLabel})`;
        updateBmiProgressBar(parseFloat(bmi), bmiLabel);

        const percentLost = ((AppState.settings.startWeight - currentW) / AppState.settings.startWeight * 100).toFixed(1);
        AppState.getEl('percentLostDisplay').innerText = `(시작 체중 대비 ${percentLost > 0 ? '-' : '+'}${Math.abs(percentLost)}%)`;

        updateProgressBar(currentW, totalLost, pct, remaining);

        AppState.getEl('streakDisplay').innerText = (s.maxStreak || 0) + '일';
        AppState.getEl('successRateDisplay').innerText = (s.successRate || 0) + '%';
        
        const pred = calculateScenarios(currentW);
        AppState.getEl('predictedDate').innerText = pred.avg;
        AppState.getEl('predictionRange').innerText = pred.range;
        
        AppState.getEl('rate7Days').innerText = s.rate7;
        AppState.getEl('rate30Days').innerText = s.rate30;
        AppState.getEl('dashboardRate7Days').innerText = s.rate7;
        AppState.getEl('dashboardRate30Days').innerText = s.rate30;
        AppState.getEl('weeklyCompareDisplay').innerText = s.weeklyComp;

        AppState.getEl('minMaxWeightDisplay').innerHTML = `
            <span class="text-danger">${(s.max||0).toFixed(1)}kg</span> / 
            <span class="text-primary">${(s.min||0).toFixed(1)}kg</span>
        `;
        
        AppState.getEl('dailyVolatilityDisplay').innerHTML = `
            <span class="text-primary">▼${(s.maxDrop||0).toFixed(1)}</span> / 
            <span class="text-danger">▲${(s.maxGain||0).toFixed(1)}</span>
        `;

        AppState.getEl('weeklyAvgDisplay').innerText = s.weeklyAvgLoss + 'kg';
        
		const mCompEl = AppState.getEl('monthCompareDisplay');
        // [수정] 값이 없으면(undefined) 기본값 '-'을 사용하여 에러 방지
        const mCompText = s.monthlyComp || '-'; 
        mCompEl.innerText = mCompText;
        DomUtil.setTextColor(mCompEl, mCompText.includes('▼') ? 'primary' : (mCompText.includes('▲') ? 'danger' : 'default'));
		
        const cvEl = AppState.getEl('cvDisplay');
        if(cvEl) {
            const cv = s.cv || 0;
            cvEl.innerText = cv.toFixed(2) + '%';
            let cvColor = 'default';
            if(cv < 1) cvColor = 'primary'; // 매우 안정
            else if(cv > 3) cvColor = 'danger'; // 불안정
            DomUtil.setTextColor(cvEl, cvColor);
        }
    }

    function renderNewStats(s) {
        if(AppState.records.length === 0) return;

        const lastRec = s.lastRec;
        const currentW = lastRec.weight;

        const maEl = AppState.getEl('maDisparityDisplay');
        if(AppState.records.length >= 7) {
            const last7 = AppState.records.slice(-7);
            const avg7 = last7.reduce((a,b)=>a+b.weight, 0) / 7;
            const disparity = MathUtil.diff(currentW, avg7);
            maEl.innerText = (disparity > 0 ? '+' : '') + disparity.toFixed(2) + 'kg';
            DomUtil.setTextColor(maEl, disparity > 0 ? 'danger' : 'primary');

            // --- [NEW] v3.0.71 Trend Deviation ---
            const trendDevEl = AppState.getEl('trendDeviationDisplay');
            if(trendDevEl) {
                trendDevEl.innerHTML = `
                    <span class="${disparity > 1 ? 'text-danger' : (disparity < -0.5 ? 'text-primary' : '')}">
                        ${disparity > 0 ? '+' : ''}${disparity.toFixed(2)}kg
                    </span>
                `;
            }

        } else {
            maEl.innerText = '수집중';
            const trendDevEl = AppState.getEl('trendDeviationDisplay');
            if(trendDevEl) trendDevEl.innerText = '-';
        }

        const wClass = CONFIG.WEIGHT_CLASSES.find(c => currentW >= c.min);
        AppState.getEl('weightClassDisplay').innerText = wClass ? wClass.name : '미분류';

        let recoveries = [];
        for(let i=1; i<AppState.records.length-1; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(diff >= 0.5) { 
                const baseWeight = AppState.records[i-1].weight;
                let daysToRecover = 0;
                for(let j=i+1; j<AppState.records.length; j++) {
                    daysToRecover++;
                    if(AppState.records[j].weight <= baseWeight) {
                        recoveries.push(daysToRecover);
                        break;
                    }
                }
            }
        }
        AppState.getEl('recoveryScoreDisplay').innerText = recoveries.length > 0 ? (recoveries.reduce((a,b)=>a+b, 0) / recoveries.length).toFixed(1) + '일' : '-';

        if(lastRec && lastRec.fat) {
            const lbm = lastRec.weight * (1 - lastRec.fat/100);
            const hMeter = AppState.settings.height / 100;
            const lbmi = lbm / (hMeter * hMeter);
            AppState.getEl('lbmDisplay').innerText = lbm.toFixed(1) + 'kg';
            AppState.getEl('lbmiDisplay').innerText = `LBMI: ${lbmi.toFixed(1)}`;
            
            const bmiVal = currentW / (hMeter * hMeter);
            let metaAge = 25 + (bmiVal - 22) * 2 + (lastRec.fat - 20) * 0.5;
            if(metaAge < 18) metaAge = 18; 
            AppState.getEl('metabolicAgeDisplay').innerText = `약 ${Math.round(metaAge)}세`;
        } else {
            AppState.getEl('lbmDisplay').innerText = '-';
            AppState.getEl('lbmiDisplay').innerText = '체지방 입력 필요';
            AppState.getEl('metabolicAgeDisplay').innerText = '체지방 필요';
        }

        const startD = DateUtil.parse(AppState.records[0].date);
        const lastD = DateUtil.parse(lastRec.date);
        const dayDiff = Math.floor(DateUtil.daysBetween(startD, lastD));
        AppState.getEl('dDayDisplay').innerText = `Day ${dayDiff + 1}`;

        const recentRecs = AppState.records.slice(-14); 
        if(recentRecs.length > 2) {
            const first = recentRecs[0];
            const last = recentRecs[recentRecs.length-1];
            const days = DateUtil.daysBetween(DateUtil.parse(first.date), DateUtil.parse(last.date));
            if(days > 0) {
                const lossKg = MathUtil.diff(first.weight, last.weight);
                const dailyLoss = lossKg / days;
                const userIntake = AppState.settings.intake || 2000;
                const estimatedTdee = userIntake + (dailyLoss * 7700);
                AppState.getEl('estTdeeDisplay').innerText = `${Math.round(estimatedTdee)} kcal`;
                AppState.getEl('estTdeeSubDisplay').innerText = `(섭취 ${userIntake}kcal 가정)`;
                
                const calEffEl = AppState.getEl('calEfficiencyDisplay');
                if(calEffEl) {
                    const actualDeficit = dailyLoss * 7700;
                    const eff = (actualDeficit / estimatedTdee) * 100;
                    calEffEl.innerText = `${eff.toFixed(1)}%`;
                }

                const maEl = AppState.getEl('metabolicAdaptDisplay');
                if(maEl) {
                    const expectedLossKg = (estimatedTdee - userIntake) / 7700;
                    const diff = dailyLoss - expectedLossKg; 
                    if (diff < -0.05) maEl.innerText = "대사 저하 의심";
                    else maEl.innerText = "정상 범위";
                }

            } else {
                AppState.getEl('estTdeeDisplay').innerText = '-';
                const calEffEl = AppState.getEl('calEfficiencyDisplay');
                if(calEffEl) calEffEl.innerText = '-';
                const maEl = AppState.getEl('metabolicAdaptDisplay');
                if(maEl) maEl.innerText = '-';
            }
        } else {
            AppState.getEl('estTdeeDisplay').innerText = '데이터 수집중';
            const calEffEl = AppState.getEl('calEfficiencyDisplay');
            if(calEffEl) calEffEl.innerText = '-';
            const maEl = AppState.getEl('metabolicAdaptDisplay');
            if(maEl) maEl.innerText = '-';
        }

        const totalLost = MathUtil.diff(AppState.settings.startWeight, s.current);
        const totalDays = DateUtil.daysBetween(startD, lastD) || 1;
        const weeklyEff = (totalLost / totalDays) * 7;
        AppState.getEl('weeklyEffDisplay').innerText = `${weeklyEff.toFixed(2)} kg/주`;

        if(totalLost > 0) {
            const cost = totalDays / totalLost;
            AppState.getEl('dietCostDisplay').innerText = `${cost.toFixed(1)}일/kg`;
        } else {
            AppState.getEl('dietCostDisplay').innerText = '-';
        }

        const weekendImpacts = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 1) { 
                const prevFriDate = new Date(d);
                prevFriDate.setDate(d.getDate() - 3);
                const prevFriStr = DateUtil.format(prevFriDate);
                const prevFriRec = AppState.records.find(r => r.date === prevFriStr);
                if(prevFriRec) {
                    weekendImpacts.push(AppState.records[i].weight - prevFriRec.weight);
                }
            }
        }
        const wImpactEl = AppState.getEl('weekendImpactDisplay');
        if(weekendImpacts.length > 0) {
            const avgImpact = weekendImpacts.reduce((a,b)=>a+b,0) / weekendImpacts.length;
            const sign = avgImpact > 0 ? '+' : '';
            wImpactEl.innerText = `${sign}${avgImpact.toFixed(2)}kg`;
            DomUtil.setTextColor(wImpactEl, avgImpact > 0 ? 'danger' : 'primary');
        } else {
            wImpactEl.innerText = '-';
        }

        const shortTrendEl = AppState.getEl('shortTrendDisplay');
        if(AppState.records.length >= 3) {
            const r3 = AppState.records[AppState.records.length-3];
            const r1 = AppState.records[AppState.records.length-1];
            const diff3 = MathUtil.diff(r1.weight, r3.weight);
            let msg = "안정";
            if(diff3 < -0.4) msg = "📉 급하락";
            else if(diff3 < 0) msg = "↘ 하락세";
            else if(diff3 > 0.4) msg = "📈 급상승";
            else if(diff3 > 0) msg = "↗ 상승세";
            
            shortTrendEl.innerText = msg;
            DomUtil.setTextColor(shortTrendEl, diff3 > 0 ? 'danger' : (diff3 < 0 ? 'primary' : 'default'));
            
            const avgDiff3 = diff3 / 2; 
            const r3AvgEl = AppState.getEl('recent3DayAvgDisplay');
            if(r3AvgEl) r3AvgEl.innerText = `${(avgDiff3).toFixed(2)} kg/일`;
        } else {
            shortTrendEl.innerText = '-';
            const r3AvgEl = AppState.getEl('recent3DayAvgDisplay');
            if(r3AvgEl) r3AvgEl.innerText = '-';
        }

        const waterEl = AppState.getEl('waterIndexDisplay');
        if(AppState.records.length >= 7) {
             const last7 = AppState.records.slice(-7);
             const avg7 = last7.reduce((a,b)=>a+b.weight,0)/last7.length;
             const dev = MathUtil.diff(s.current, avg7);
             waterEl.innerText = (dev > 0 ? '+' : '') + dev.toFixed(1) + 'kg';
             DomUtil.setTextColor(waterEl, dev > 0.5 ? 'danger' : (dev < -0.5 ? 'primary' : 'default'));
             
             const startW7 = last7[0].weight;
             const endW7 = last7[last7.length-1].weight;
             const wSpeed = MathUtil.diff(endW7, startW7);
             const wSpeedEl = AppState.getEl('weeklySpeedDisplay');
             if(wSpeedEl) wSpeedEl.innerText = `${wSpeed.toFixed(2)} kg/주`;
             
             const stdDev7 = MathUtil.stdDev(last7.map(r=>r.weight));
             const volIdx = stdDev7 * 10;
             const volEl = AppState.getEl('volatilityIndexDisplay');
             if(volEl) volEl.innerText = volIdx.toFixed(1);

             let riskScore = 0;
             if(wSpeed < -1.5) riskScore += 40; 
             else if(wSpeed < -1.0) riskScore += 20;
             if(stdDev7 > 0.5) riskScore += 30; 
             if(dev > 1.0) riskScore += 30; 
             
             let riskLabel = '낮음';
             let riskColor = 'primary';
             if(riskScore >= 70) { riskLabel = '높음'; riskColor = 'danger'; }
             else if(riskScore >= 40) { riskLabel = '중간'; riskColor = 'accent'; }
             
             const yoyoEl = AppState.getEl('yoyoRiskDisplay');
             if(yoyoEl) {
                 yoyoEl.innerText = `${riskScore}점 (${riskLabel})`;
                 DomUtil.setTextColor(yoyoEl, riskColor);
             }
             
             const ptEl = AppState.getEl('paperTowelDisplay');
             if(ptEl) {
                 const dailyRate = Math.abs(wSpeed / 7);
                 if (dailyRate > 0) {
                    const onePercent = s.current * 0.01;
                    const days = onePercent / dailyRate;
                    ptEl.innerText = `${days.toFixed(1)}일`;
                 } else {
                     ptEl.innerText = '유지/증량 중';
                 }
             }

        } else {
            waterEl.innerText = '-';
            const wSpeedEl = AppState.getEl('weeklySpeedDisplay');
            if(wSpeedEl) wSpeedEl.innerText = '-';
            const volEl = AppState.getEl('volatilityIndexDisplay');
            if(volEl) volEl.innerText = '-';
            const yoyoEl = AppState.getEl('yoyoRiskDisplay');
            if(yoyoEl) yoyoEl.innerText = '-';
            const ptEl = AppState.getEl('paperTowelDisplay');
            if(ptEl) ptEl.innerText = '-';
        }

        const startRecWithFat = AppState.records.find(r => r.fat);
        if(startRecWithFat && lastRec.fat) {
             const startFatKg = startRecWithFat.weight * (startRecWithFat.fat/100);
             const currFatKg = lastRec.weight * (lastRec.fat/100);
             const fatLoss = MathUtil.diff(startFatKg, currFatKg);
             
             const startLeanKg = startRecWithFat.weight * (1 - startRecWithFat.fat/100);
             const currLeanKg = lastRec.weight * (1 - lastRec.fat/100);
             const leanLoss = MathUtil.diff(startLeanKg, currLeanKg);
             
             const totalLoss = fatLoss + leanLoss;
             const fatRatio = totalLoss > 0 ? (fatLoss/totalLoss)*100 : 0;
             
             AppState.getEl('netChangeDisplay').innerText = `지방 ${fatLoss.toFixed(1)}kg 감량`;
             AppState.getEl('netChangeSubDisplay').innerText = `(감량분의 ${Math.round(fatRatio)}%가 지방)`;
             
             const balance = (currLeanKg / currFatKg).toFixed(2);
             const balEl = AppState.getEl('bodyCompBalanceDisplay');
             if(balEl) balEl.innerText = `${balance} : 1`;
             
             const trendEl = AppState.getEl('bodyCompTrendDisplay');
             if(trendEl) trendEl.innerText = `근육 ${leanLoss > 0 ? '-' : '+'}${Math.abs(leanLoss).toFixed(1)}kg`;
             
             const mlCard = AppState.getEl('muscleLossCard');
             const mlDisplay = AppState.getEl('muscleLossDisplay');
             if(mlCard) {
                 if (leanLoss > 0 && totalLoss > 2 && (leanLoss / totalLoss) > 0.4) {
                     mlCard.style.display = 'block';
                     mlDisplay.innerText = `${((leanLoss/totalLoss)*100).toFixed(0)}% 근손실`;
                     DomUtil.setTextColor(mlDisplay, 'danger');
                 } else {
                     mlCard.style.display = 'none';
                 }
             }

             // --- [NEW] v3.0.71 LBM Retention ---
             const lbmRetEl = AppState.getEl('lbmRetentionDisplay');
             if(lbmRetEl) {
                 if (totalLoss > 0) {
                    const lbmRetention = ((totalLoss - Math.max(0, leanLoss)) / totalLoss) * 100;
                    lbmRetEl.innerText = `${lbmRetention.toFixed(1)}%`;
                 } else {
                     lbmRetEl.innerText = '-';
                 }
             }

        } else {
             AppState.getEl('netChangeDisplay').innerText = '-';
             AppState.getEl('netChangeSubDisplay').innerText = '체지방 데이터 필요';
             const balEl = AppState.getEl('bodyCompBalanceDisplay');
             if(balEl) balEl.innerText = '-';
             const trendEl = AppState.getEl('bodyCompTrendDisplay');
             if(trendEl) trendEl.innerText = '-';
             const mlCard = AppState.getEl('muscleLossCard');
             if(mlCard) mlCard.style.display = 'none';
             const lbmRetEl = AppState.getEl('lbmRetentionDisplay');
             if(lbmRetEl) lbmRetEl.innerText = '-';
        }

        // --- [NEW] v3.0.71 Sodium Warning ---
        const sodEl = AppState.getEl('sodiumWarningDisplay');
        if(sodEl && AppState.records.length >= 2) {
            const diff = AppState.records[AppState.records.length-1].weight - AppState.records[AppState.records.length-2].weight;
            if (diff > 1.5) {
                sodEl.innerText = "🚨 급등 감지";
                DomUtil.setTextColor(sodEl, 'danger');
            } else {
                sodEl.innerText = "정상";
                DomUtil.setTextColor(sodEl, 'default');
            }
        }

        // --- [NEW] v3.0.71 CV Status ---
        const cvStatEl = AppState.getEl('cvStatusDisplay');
        if(cvStatEl) {
            const cv = s.cv || 0;
            let status = '보통';
            let color = 'default';
            if (cv < 1) { status = '매우 안정'; color = 'primary'; }
            else if (cv > 3) { status = '과도함'; color = 'danger'; }
            cvStatEl.innerText = status;
            DomUtil.setTextColor(cvStatEl, color);
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(now.getDate()-30);
        const recentRecs30 = AppState.records.filter(r => DateUtil.parse(r.date) >= thirtyDaysAgo);
        const uniqueDays = new Set(recentRecs30.map(r => r.date)).size;
        const score = Math.min(100, Math.round((uniqueDays / 30) * 100));
        AppState.getEl('consistencyDisplay').innerText = `${score}%`;
        
        const lcEl = AppState.getEl('lossConsistencyDisplay');
        if(recentRecs30.length > 1) {
            let lossDays = 0;
            for(let i=1; i<recentRecs30.length; i++) {
                if(recentRecs30[i].weight < recentRecs30[i-1].weight) lossDays++;
            }
            const lossConsistency = (lossDays / (recentRecs30.length - 1)) * 100;
            if(lcEl) lcEl.innerText = `${lossConsistency.toFixed(0)}%`;
        } else {
            if(lcEl) lcEl.innerText = '-';
        }

        const remW = MathUtil.diff(s.current, AppState.settings.goal1);
        const defEl = AppState.getEl('deficitDisplay');
        const idealWEl = AppState.getEl('idealWeeklyRateDisplay');
        
        if(remW > 0) {
            const calToLose = remW * 7700;
            const daysToGoal = 90;
            const reqDeficit = Math.round(calToLose / daysToGoal);
            defEl.innerText = `-${reqDeficit} kcal/일`;
            
            const idealWeekly = (remW / (daysToGoal / 7)).toFixed(2);
            if(idealWEl) idealWEl.innerText = `-${idealWeekly} kg/주`;
        } else {
             defEl.innerText = '목표 달성!';
             if(idealWEl) idealWEl.innerText = '완료';
        }

        if(lastRec.fat) {
            const hMeter = AppState.settings.height/100;
            const lbm = lastRec.weight * (1 - lastRec.fat/100);
            const ffmi = lbm / (hMeter * hMeter);
            AppState.getEl('ffmiDisplay').innerText = ffmi.toFixed(1);
        } else {
             AppState.getEl('ffmiDisplay').innerText = '-';
        }

        const hMeter = AppState.settings.height / 100;
        const currentBmi = s.current / (hMeter * hMeter);
        const bpEl = AppState.getEl('bmiPrimeDisplay');
        if(bpEl) {
            const prime = currentBmi / 23;
            bpEl.innerText = prime.toFixed(2);
            DomUtil.setTextColor(bpEl, prime <= 1.0 ? 'primary' : 'danger');
        }

        const surplusEl = AppState.getEl('surplusCalDisplay');
        if(surplusEl) {
            let surplus = 0;
            for(let i=1; i<AppState.records.length; i++) {
                const diff = AppState.records[i].weight - AppState.records[i-1].weight;
                if(diff > 0) surplus += (diff * 7700);
            }
            surplusEl.innerText = `+${Math.round(surplus).toLocaleString()} kcal`;
        }
    }

	function renderAdvancedText(s) {
        if(AppState.records.length < 5) {
            AppState.getEl('advancedAnalysisList').innerHTML = '<li class="insight-item">데이터가 5개 이상 쌓이면 분석을 제공합니다.</li>';
            return;
        }

        let htmlLines = [];
        const { PERSONA } = CONFIG.MESSAGES;

        // --- 공통 변수 정의 (추가된 로직용) ---
        const totalLost = s.totalLost || 0;
        const current = s.current || 0;
        const maxPlateau = s.maxPlateau || 0;
        const lastRec = s.lastRec || {};
        const dayNames = ['일','월','화','수','목','금','토'];

        // 1. 다이어트 성향 (Persona)
        const stdDev = s.stdDev || 0;
        let persona = "";
        if(stdDev > 0.8) persona = PERSONA.ROLLER;
        else if(stdDev < 0.3) persona = PERSONA.TURTLE;
        else persona = PERSONA.BALANCE;
        
        let weekendSpike = 0;
        for(let i=1; i<AppState.records.length; i++) {
             const d = DateUtil.parse(AppState.records[i].date).getDay();
             if(d === 1 && AppState.records[i].weight > AppState.records[i-1].weight + 0.5) weekendSpike++;
        }
        if(weekendSpike >= 3) persona = PERSONA.WEEKEND;
        htmlLines.push(`<li class="insight-item"><span class="insight-label">🕵️ 다이어트 성향:</span> 당신은 <strong>${persona}</strong>입니다.</li>`);

		// 2. 수분 마스킹 (Water Masking) & 3. 상승 다이어트 (Lean Mass Up)
        if(AppState.records.length >= 3) {
            const last = AppState.records[AppState.records.length-1];
            const prev = AppState.records[AppState.records.length-2];
            
            // 조건: 체지방 정보가 있고, 체지방은 줄었으나(▼), 체중은 같거나 늘어남(▲ or =)
            if(last.fat && prev.fat && last.fat < prev.fat && last.weight >= prev.weight) {
                const wDiff = last.weight - prev.weight;

                if (wDiff > 0) {
                    // 체중이 증가한 경우 (+0.1kg 이상)
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">💪 상승 다이어트:</span> "체중이 +${wDiff.toFixed(1)}kg 늘었지만 슬퍼하지 마세요! 체지방률은 오히려 떨어졌습니다. 근육이 늘고 지방이 타는 가장 이상적인 '상승 다이어트' 중입니다."</li>`);
                } else {
                    // 체중이 정확히 같은 경우 (0.0kg)
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">🧱 체성분 재구성:</span> "체중은 어제와 똑같지만 체지방률은 떨어졌습니다! 지방이 빠진 자리를 근육이나 수분이 채우고 있는 긍정적인 신호(린매스업)입니다."</li>`);
                }
            }
        }
		
        // 4. 골든 크로스 / 데드 크로스 (Golden/Dead Cross)
        if(AppState.records.length >= 30) {
            const last7 = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
            const last30 = AppState.records.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
            const prevRecs = AppState.records.slice(0, AppState.records.length-1);
            if(prevRecs.length >= 30) {
                const prev7 = prevRecs.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const prev30 = prevRecs.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
                
                if(prev7 >= prev30 && last7 < last30) {
                    htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">📉 골든 크로스:</span> "🎉 축하합니다! 오늘부로 단기 감량 추세가 장기 추세를 앞질렀습니다. 지금부터 본격적인 '가속 감량 구간'에 진입했습니다."</li>`);
                } else if (prev7 <= prev30 && last7 > last30) {
                    htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📈 데드 크로스:</span> 단기 이동평균이 장기 이동평균을 뚫고 올라갔습니다! 상승 추세 전환을 주의하세요.</li>`);
                }
            }
        }

        // 5. 요일별 승률 (Day of Week Win Rate)
        const dayDeltas = [0,0,0,0,0,0,0]; 
        const dayCounts = [0,0,0,0,0,0,0];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            dayDeltas[d] += diff;
            dayCounts[d]++;
        }
        const dayAvgs = dayDeltas.map((sum, i) => dayCounts[i] ? sum/dayCounts[i] : 0);
        const bestDayIdx = dayAvgs.indexOf(Math.min(...dayAvgs));
        const worstDayIdx = dayAvgs.indexOf(Math.max(...dayAvgs));
        // const dayNames = ['일','월','화','수','목','금','토']; // 위에서 이미 선언됨
        
        htmlLines.push(`<li class="insight-item"><span class="insight-label">🧐 요일 승률:</span> 
            <strong>${dayNames[bestDayIdx]}요일</strong>에 가장 잘 빠지고, 
            <strong>${dayNames[worstDayIdx]}요일</strong>에 주의가 필요합니다.</li>`);

        // 6. 패턴 감지 (Cycle Pattern)
        let cyclePattern = false;
        if(AppState.records.length > 60) {
            let spikeCount = 0;
            const reversed = [...AppState.records].reverse();
            for(let i=0; i<reversed.length-30; i+=28) {
                let hasGain = false;
                for(let j=0; j<5; j++) {
                    if(i+j+1 < reversed.length && reversed[i+j].weight > reversed[i+j+1].weight + 0.5) hasGain = true;
                }
                if(hasGain) spikeCount++;
            }
            if(spikeCount >= 2) cyclePattern = true;
        }
        if(cyclePattern) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🔄 패턴 감지:</span> "약 28일 주기로 체중이 일시적으로 증가하는 패턴이 감지됩니다. 자연스러운 현상이니 당황하지 마세요."</li>`);
        }

        // 8. 리바운드 경고 (Rebound Warning)
        if(AppState.records.length >= 3) {
            const last3 = AppState.records.slice(-3);
            const drop3 = last3[0].weight - last3[2].weight;
            if(drop3 >= 2.0) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 리바운드 경고:</span> "최근 급격한 감량(-${drop3.toFixed(1)}kg/3일)이 있었습니다. 통계적으로 이런 급감 후에는 48시간 내에 반등할 확률이 높습니다. 식단에 유의하세요."</li>`);
            }
        }

        // 9. 시즈널리티 (Seasonality)
        const monthlyGains = {};
        for(let i=1; i<AppState.records.length; i++) {
            const m = DateUtil.parse(AppState.records[i].date).getMonth() + 1;
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(!monthlyGains[m]) monthlyGains[m] = 0;
            monthlyGains[m] += diff;
        }
        let worstMonth = -1, maxVal = -999;
        Object.keys(monthlyGains).forEach(m => {
            if(monthlyGains[m] > maxVal) { maxVal = monthlyGains[m]; worstMonth = m; }
        });
        if(maxVal > 1.0) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🍂 시즈널리티:</span> "<strong>${worstMonth}월</strong>에 체중이 증가하는 경향이 있습니다. 해당 시기에 활동량 저하를 주의하세요."</li>`);
        }

        // 10. 치팅 여파 (Cheating Recovery)
        const recoveries = [];
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(diff >= 0.4) {
                const spikeDay = DateUtil.parse(AppState.records[i].date).getDay();
                for(let j=i+1; j<Math.min(i+7, AppState.records.length); j++) {
                    if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                        const recoveryDay = DateUtil.parse(AppState.records[j].date).getDay();
                        recoveries.push({ spike: spikeDay, recovery: recoveryDay });
                        break;
                    }
                }
            }
        }
        if(recoveries.length > 0) {
            const counts = {};
            recoveries.forEach(r => {
                const key = `${dayNames[r.spike]}요일에 찐 살은 보통 ${dayNames[r.recovery]}요일`;
                counts[key] = (counts[key] || 0) + 1;
            });
            const bestPattern = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🍔 치팅 여파:</span> "${bestPattern}에 다 빠집니다."</li>`);
        }

        // 11. 구간 분석 (Zone Analysis)
        const zones = {};
        for(let i=10; i<AppState.records.length; i++) {
            const zone = Math.floor(AppState.records[i].weight);
            if(!zones[zone]) zones[zone] = [];
            const diff = MathUtil.diff(AppState.records[i-1].weight, AppState.records[i].weight);
            zones[zone].push(diff);
        }
        const zoneStats = Object.keys(zones).map(z => {
            return { zone: z, avg: zones[z].reduce((a,b)=>a+b,0)/zones[z].length };
        }).sort((a,b) => b.avg - a.avg);

        if(zoneStats.length >= 2) {
            const best = zoneStats[0];
            const worst = zoneStats[zoneStats.length-1];
            htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 구간 분석:</span> "${best.zone}kg대에서 가장 빠르게 감량되었습니다. ${worst.zone}kg대에서는 상대적으로 속도가 느려집니다."</li>`);
        }

        // 12. 최장 정체기 (Longest Plateau)
        // let maxPlateau = 0; // 상단에서 공통 변수로 선언됨
        let currPlateau = 0;
        let localMaxPlateau = 0; // 변수명 충돌 방지
        for(let i=1; i<AppState.records.length; i++) {
            const diff = Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
            if(diff < 0.2) currPlateau++;
            else currPlateau = 0;
            if(currPlateau > localMaxPlateau) localMaxPlateau = currPlateau;
        }
        if(localMaxPlateau >= 3) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">⏳ 최장 정체기:</span> 체중 변화가 거의 없던 최장 기간은 <strong>${localMaxPlateau}일</strong> 입니다.</li>`);
        }

        // 13. 요요 인덱스 (Yoyo Index)
        if(s.diffs && s.diffs.length > 0) {
            const mean = s.diffs.reduce((a,b)=>a+b,0)/s.diffs.length;
            const variance = s.diffs.reduce((a,b)=>a+Math.pow(b-mean,2),0)/s.diffs.length;
            const stdDevDiff = Math.sqrt(variance);
            let volScore = Math.max(0, 100 - (stdDevDiff * 50)); 
            let volMsg = volScore > 80 ? "매우 안정적" : (volScore > 50 ? "보통" : "롤러코스터 🎢");
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🎢 요요 인덱스:</span> 변동성 점수 <strong>${Math.round(volScore)}점</strong> (${volMsg}) 입니다.</li>`);
        }

        // 14. 신뢰도 구간 (Confidence Interval)
        const remaining = s.current - AppState.settings.goal1;
        if(remaining > 0) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30);
            
            let recentStartRecord = AppState.records.find(r => DateUtil.parse(r.date) >= cutoffDate);
            const useFullHistory = !recentStartRecord || 
                                  (AppState.records.indexOf(AppState.records[AppState.records.length-1]) - AppState.records.indexOf(recentStartRecord) < 3);

            if(useFullHistory) {
                recentStartRecord = AppState.records[0];
            }

            const rStartD = DateUtil.parse(recentStartRecord.date);
            const rLastD = DateUtil.parse(s.lastRec.date);
            const rDays = DateUtil.daysBetween(rStartD, rLastD) || 1;
            
            const currentSpeed = (recentStartRecord.weight - s.current) / rDays;

            if(currentSpeed > 0.01) {
                const daysCur = remaining / currentSpeed;
                
                const dEarly = new Date(); dEarly.setDate(dEarly.getDate() + daysCur * 0.9);
                const dLate = new Date(); dLate.setDate(dLate.getDate() + daysCur * 1.1);
                
                htmlLines.push(`<li class="insight-item"><span class="insight-label">🎯 신뢰도 구간:</span> "현재 속도라면 90% 확률로 <strong>${DateUtil.format(dEarly)}</strong>에서 <strong>${DateUtil.format(dLate)}</strong> 사이에 목표를 달성합니다."</li>`);
            } 
        }

        // 15. 월간 성적표 (Monthly Grade)
        const now = new Date();
        const thisMonthKey = DateUtil.format(now).slice(0, 7);
        const thisMonthRecs = AppState.records.filter(r => r.date.startsWith(thisMonthKey));
        if(thisMonthRecs.length > 3) {
            const startW = thisMonthRecs[0].weight;
            const endW = thisMonthRecs[thisMonthRecs.length-1].weight;
            const loss = MathUtil.diff(startW, endW);
            const uniqueDays = new Set(thisMonthRecs.map(r => r.date)).size;
            const daysInMonth = now.getDate();
            const consistency = (uniqueDays / daysInMonth) * 100;
            
            let grade = 'C';
            if(loss > 2 && consistency > 80) grade = 'A+';
            else if(loss > 1 && consistency > 60) grade = 'B';
            else if(loss < 0) grade = 'D';

            htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 월간 성적표:</span> 이번 달 성적은 <strong>${grade}</strong>입니다! (감량 ${loss.toFixed(1)}kg)</li>`);
        }

        // 16. 요요 위험도 경고 (Rapid Drop Warning)
        if(AppState.records.length > 7) {
            const last7 = AppState.records.slice(-7);
            const totalDrop = MathUtil.diff(last7[0].weight, last7[last7.length-1].weight);
            if(totalDrop > 2.0) { 
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🔄 요요 위험도 경고:</span> 최근 감량 속도가 너무 빠릅니다. 급격한 감량은 요요를 부를 수 있습니다.</li>`);
            }
        }

        // 17. 베스트 퍼포먼스 (Best Performance)
        if(AppState.records.length > 30) {
            let maxLoss30 = -999;
            let bestPeriod = '';
            for(let i=30; i<AppState.records.length; i++) {
                const prev = AppState.records[i-30];
                const curr = AppState.records[i];
                const diff = MathUtil.diff(prev.weight, curr.weight);
                if(diff > maxLoss30) {
                    maxLoss30 = diff;
                    bestPeriod = `${prev.date} ~ ${curr.date}`;
                }
            }
            if(maxLoss30 > 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🏆 베스트 퍼포먼스:</span> <strong>${bestPeriod}</strong> 기간에 <strong>${maxLoss30.toFixed(1)}kg</strong> 감량한 기록이 있습니다.</li>`);
            }
        }

        // 18. 7일의 법칙 경고 (7-Day Law)
        if(dayAvgs[4] < 0 && (dayAvgs[5] > 0 || dayAvgs[6] > 0)) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 7일의 법칙 경고:</span> "지난 4주간 통계를 보니, 목요일까지 잘 빼다가 금~토에 다시 찌우는 패턴이 반복됩니다. 이번 주 금요일을 조심하세요!"</li>`);
        }

        // 19. 손절매 제안 (Stop Loss)
        let gainStreak = 0, gainSum = 0;
        for(let i=AppState.records.length-1; i>0; i--) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(diff > 0) { gainStreak++; gainSum += diff; }
            else break;
        }
        if(gainStreak >= 3 && gainSum >= 1.5) {
             htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📉 손절매(Stop Loss) 제안:</span> "최근 3일 연속 증량 중이며 총 +${gainSum.toFixed(1)}kg입니다. 통계적으로 오늘 식단을 조절하지 않으면 2주 전 체중으로 복귀할 확률이 높습니다."</li>`);
        }

        // 20. 가짜 정체기 판별 (Fake Plateau)
        if(maxPlateau >= 7) {
            const last7 = AppState.records.slice(-7);
            const trend = last7[last7.length-1].weight - (last7.reduce((a,b)=>a+b.weight,0)/7);
            if(Math.abs(last7[0].weight - last7[6].weight) < 0.2 && trend < 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">💊 가짜 정체기 판별:</span> "체중은 그대로지만, 7일 평균선은 미세하게 우하향 중입니다. 이것은 정체기가 아니라 '계단식 하락' 직전의 구간일 수 있습니다. 포기하지 마세요."</li>`);
            }
        }

        // 21. 후시 효과 예측 (Whoosh Prediction)
        if (maxPlateau > 10) {
             htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">⚠️ 후시(Whoosh) 효과 예측:</span> "장기간 정체기가 지속되고 있습니다. 이는 지방세포가 수분을 머금고 버티는 현상일 수 있으며, 곧 급격한 수분 배출과 함께 체중이 뚝 떨어질(Whoosh) 가능성이 높습니다."</li>`);
        }

        // 22. 추세 반전 감지 (Head & Shoulders)
        if (AppState.records.length > 20) {
            const recs = AppState.records.slice(-10);
            const mid = Math.floor(recs.length / 2);
            if (recs[0].weight < recs[mid].weight && recs[recs.length-1].weight < recs[mid].weight && recs[mid].weight > recs[0].weight + 1) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 추세 반전 감지:</span> "최근 체중 패턴이 상승 후 하락세로 꺾이는 '헤드 앤 숄더' 패턴과 유사합니다. 증량 추세가 멈추고 다시 감량이 시작될 신호일 수 있습니다."</li>`);
            }
        }

        // 23. 치팅 회복력 (Cheating Resilience)
        if (recoveries.length > 2) {
             let recDurations = [];
             for(let i=1; i<AppState.records.length-1; i++) {
                 if(AppState.records[i].weight >= AppState.records[i-1].weight + 1.0) { 
                     for(let j=i+1; j<AppState.records.length; j++) {
                         if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                             recDurations.push(DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date)));
                             break;
                         }
                     }
                 }
             }
             if(recDurations.length > 0) {
                 const avgRecDays = recDurations.reduce((a,b)=>a+b,0) / recDurations.length;
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🍔 치팅 회복력:</span> "폭식(급격한 증량) 후 원상 복구하는데 평균 <strong>${avgRecDays.toFixed(1)}일</strong>이 걸립니다."</li>`);
             }
        }

        // 24. 거북이 vs 토끼 진단 (Turtle vs Rabbit - New Logic)
        if (AppState.records.length > 30) {
             const diffs = [];
             for(let i=1; i<AppState.records.length; i++) diffs.push(Math.abs(AppState.records[i].weight - AppState.records[i-1].weight));
             const diffStdDev = MathUtil.stdDev(diffs);
             let type = diffStdDev > 0.5 ? "토끼형(급빠급찐)" : "거북이형(꾸준함)";
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🐢 거북이 vs 토끼 진단:</span> "최근 1달 데이터를 보니, 천천히 꾸준히 빼는 '${type}'입니다. 급격한 감량보다는 현재 페이스 유지가 요요 방지에 유리합니다."</li>`);
        }

        // 25. 주말의 공격
        const satSpikes = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 6 && AppState.records[i].weight > AppState.records[i-1].weight) { // Sat spike
                 for(let j=i+1; j<AppState.records.length; j++) {
                     if(AppState.records[j].weight <= AppState.records[i-1].weight) {
                         satSpikes.push(DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date)));
                         break;
                     }
                 }
            }
        }
        if (satSpikes.length > 0) {
            const avgRec = satSpikes.reduce((a,b)=>a+b,0)/satSpikes.length;
            htmlLines.push(`<li class="insight-item"><span class="insight-label">🕵️ 주말의 공격:</span> " 주로 <strong>토요일</strong>에 체중이 늘어나고, 이를 복구하는 데 평균 <strong>${avgRec.toFixed(1)}일</strong>이 걸립니다. 주말 식단을 조절하면 목표 달성이 빨라집니다."</li>`);
        }

        // 26. 가짜 살 판독기 (Fake Weight Detector)
        // const lastRec = ... (상단 공통 변수 lastRec 사용)
        if (AppState.records.length > 7) {
            const lastRecVal = AppState.records[AppState.records.length-1].weight;
            const prevRecVal = AppState.records[AppState.records.length-2].weight;
            const diffLast = lastRecVal - prevRecVal;
            if (diffLast > 0) {
                const last7Avg = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const prev7Avg = AppState.records.slice(-8, -1).reduce((a,b)=>a+b.weight,0)/7;
                if (last7Avg < prev7Avg) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 가짜 살 판독기:</span> "오늘 체중이 +${diffLast.toFixed(1)}kg 늘었지만, 최근 7일 평균선은 여전히 하락세입니다. 이는 단순 수분/변비일 확률이 95%입니다. 멘탈 잡으세요!"</li>`);
                }
            }
        }

        // 27. 시뮬레이션 예측 (Simulation)
        if (remaining > 0) {
             const rStart = AppState.records[0];
             const rEnd = s.lastRec;
             const rate = (rStart.weight - rEnd.weight) / (DateUtil.daysBetween(DateUtil.parse(rStart.date), DateUtil.parse(rEnd.date))||1);
             if(rate > 0) {
                 const timeOld = remaining / rate;
                 const timeNew = remaining / (rate + (300/7700));
                 const saved = timeOld - timeNew;
                 const targetDate = new Date(); targetDate.setDate(targetDate.getDate() + timeNew);
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🔮 시뮬레이션 예측:</span> "만약 오늘부터 매일 300kcal씩 덜 먹는다면, 예상 목표 달성일은 <strong>${DateUtil.format(targetDate)}</strong>로 <strong>${Math.round(saved)}일</strong> 앞당겨집니다."</li>`);
             }
        }
        
        // 28. 정체기 타파 솔루션 (Plateau Solution)
        if (maxPlateau >= 10 && Math.abs(s.current - s.lastRec.weight) < 0.2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💡 정체기 타파 솔루션:</span> "현재 10일째 체중 변화가 없습니다. 지금은 <strong>운동 종류</strong>를 바꿔 대사에 충격을 줄 타이밍일 수 있습니다."</li>`);
        }

        // 29. 심리적 저항선 판독 (Psychological Resistance)
        const resistance = {}; 
        for(let i=1; i<AppState.records.length-1; i++) {
            if(AppState.records[i].weight > AppState.records[i-1].weight && AppState.records[i].weight > AppState.records[i+1].weight) {
                const z = Math.floor(AppState.records[i].weight);
                if(!resistance[z]) resistance[z] = 0;
                resistance[z]++;
            }
        }
        const topRes = Object.keys(resistance).sort((a,b)=>resistance[b]-resistance[a])[0];
        if(topRes && resistance[topRes] >= 3) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🧗‍♀️ 심리적 저항선 판독:</span> " <strong>${topRes}kg대</strong>에서 유독 3회 이상 반등한 기록이 있습니다. 이곳이 강력한 '심리적 저항선'입니다. 이번에 ${topRes}.9kg를 찍는 순간이 가장 중요합니다."</li>`);
        }
        
        // 30. 노이즈 캔슬링 (Noise Canceling)
        const lastRecVal = AppState.records[AppState.records.length-1].weight;
        const prevRecVal = AppState.records[AppState.records.length-2].weight;
        const diffLast = lastRecVal - prevRecVal;
        if (Math.abs(diffLast) > 0.6) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📡 노이즈 캔슬링:</span> "오늘 체중이 급변했지만 무시하셔도 됩니다. 통계적으로 이 정도 변동은 평소 <strong>'일일 변동 허용 범위(±0.6kg)'</strong> 이내입니다. 전체 추세는 여전히 유효합니다."</li>`);
        }

        // 31. 시간 단축 마일리지 (Time Saved)
        if(remaining > 0 && AppState.records.length > 30) {
             const avgSpeed = (AppState.records[0].weight - s.current) / AppState.records.length;
             const recentSpeed = (AppState.records[AppState.records.length-8].weight - s.current) / 7;
             if(recentSpeed > avgSpeed) {
                 const daysSaved = (remaining/avgSpeed) - (remaining/recentSpeed);
                 if(daysSaved > 5) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">⏳ 시간 단축 마일리지:</span> "지난주 불태우셨군요! 🔥 최근 속도라면 원래 예상보다 목표 달성을 <strong>${Math.round(daysSaved)}일</strong> 앞당길 수 있습니다."</li>`);
                 }
             }
        }

        // 32. 나트륨/부종 경보 (Sodium Alarm)
        if (diffLast > 2.0) {
             htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🧂 나트륨/부종 경보:</span> "하루 만에 2kg가 찌는 것은 생물학적으로 불가능합니다(지방 2kg ≈ 15,400kcal). 이는 99% <strong>수분(부종)</strong>입니다. 오늘 물 많이 드시고 칼륨(바나나 등)을 섭취하면 내일 복구됩니다."</li>`);
        }
        
        // 33. 마의 N월 예보 (Month N Forecast)
        const nextMonth = new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2;
        if (monthlyGains[nextMonth] > 1.0) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🗓️ 마의 ${nextMonth}월 예보:</span> "곧 <strong>${nextMonth}월</strong>입니다. 데이터상 ${nextMonth}월마다 평균 <strong>${monthlyGains[nextMonth].toFixed(1)}kg</strong> 증량하는 패턴이 있습니다. 대비하세요!"</li>`);
        }

		// 34. 버티기 (Zone) 승리 예측 (Zone Victory)
        const currentZoneFloor = Math.floor(s.current / 10) * 10; 
        const distToNextZone = s.current - currentZoneFloor; 

        const d30 = new Date(); 
        d30.setDate(d30.getDate() - 30);
        const recentRecsForZone = AppState.records.filter(r => DateUtil.parse(r.date) >= d30);

        if (distToNextZone > 0 && recentRecsForZone.length > 5) {
             const firstR = recentRecsForZone[0];
             const lastR = recentRecsForZone[recentRecsForZone.length - 1];
             const periodDays = DateUtil.daysBetween(DateUtil.parse(firstR.date), DateUtil.parse(lastR.date));
             const weightLoss = firstR.weight - lastR.weight;

             if (weightLoss > 0 && periodDays > 0) {
                 const dailyRate = weightLoss / periodDays; 
                 const predictedDays = distToNextZone / dailyRate; 

                 if(predictedDays < 1000) {
                     htmlLines.push(`<li class="insight-item"><span class="insight-label">🧱 버티기 (Zone) 승리 예측:</span> "현재 페이스(${dailyRate.toFixed(2)}kg/일)라면 앞자리를 바꾸는 데 약 <strong>${Math.round(predictedDays)}일</strong>이 소요될 것으로 보입니다. ${currentZoneFloor}kg 진입까지 화이팅!"</li>`);
                 }
             } else if (weightLoss <= 0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🧱 버티기 (Zone) 승리 예측:</span> "현재 앞자리를 바꾸기 위해 ${distToNextZone.toFixed(1)}kg 감량이 필요합니다. 다시 감량 추세를 만들어봅시다!"</li>`);
             }
        }
		
        // 35. 과거의 영광 비교 (Past Glory)
        if(AppState.records.length > 60) {
             const mLoss = {};
             for(let i=1; i<AppState.records.length; i++) {
                 const k = AppState.records[i].date.substring(0, 7);
                 if(!mLoss[k]) mLoss[k] = 0;
                 mLoss[k] -= (AppState.records[i].weight - AppState.records[i-1].weight);
             }
             const bestMonth = Object.keys(mLoss).sort((a,b)=>mLoss[b]-mLoss[a])[0];
             if(bestMonth) {
                 const currentMonth = DateUtil.format(new Date()).substring(0,7);
                 if(mLoss[currentMonth] > mLoss[bestMonth] * 0.8) {
                      htmlLines.push(`<li class="insight-item"><span class="insight-label">🥉 과거의 영광 비교:</span> "이번 달 감량 속도는 역대 최고였던 <strong>${bestMonth}</strong>의 퍼포먼스와 유사합니다! 폼이 돌아왔습니다. 🔥"</li>`);
                 }
             }
        }

        // ---------------------------------------------------------
        // [추가] 36 ~ 85: 심층 분석 알고리즘 (Deep Insights)
        // ---------------------------------------------------------

        // 36. 스퀴즈 (Whoosh Effect 전조)
        if (AppState.records.length > 20) {
            const last7 = AppState.records.slice(-7).map(r => r.weight);
            const std7 = MathUtil.stdDev(last7);
            const last30 = AppState.records.slice(-30).map(r => r.weight);
            const std30 = MathUtil.stdDev(last30);
            
            if (std7 < std30 * 0.5) {
                htmlLines.push(`<li class="insight-item"><span class="insight-label">💧 폭풍전야 (Whoosh 대기):</span> "최근 7일간 체중 변화가 거의 없습니다. 지방은 탔지만 수분이 그 자리를 채우고 있을 가능성이 높습니다(Whoosh 효과). 포기하지 않으면 곧 급격한 감량이 찾아옵니다."</li>`);
            }
        }

        // 37. 급격한 변동 경고 (RSI 로직 응용)
        if (AppState.records.length > 14) {
            let gain = 0, loss = 0;
            const recent14 = AppState.records.slice(-15);
            for(let i=1; i<recent14.length; i++) {
                const change = recent14[i].weight - recent14[i-1].weight;
                if (change > 0) gain += change;
                else loss -= change;
            }
            const rs = loss === 0 ? 100 : gain / loss;
            const rsi = 100 - (100 / (1 + rs));
            
            if (rsi > 70) {
                htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">⏰ 급찐살 골든타임:</span> "최근 체중이 급격히 늘었습니다(과열). 의학적으로 이것은 지방보다 '수분과 글리코겐'일 확률이 높습니다. 지금 당장 조절하면 지방이 되기 전에 뺄 수 있습니다!"</li>`);
            } else if (rsi < 30) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">🚨 항상성 반발 경고:</span> "최근 감량 속도가 너무 빠릅니다. 우리 몸은 급격한 변화를 싫어해 식욕을 폭발시킬 수 있습니다(요요 현상). 오늘은 조금 더 드셔도 괜찮습니다."</li>`);
            }
        }

        // 38. 요요 경고 (Rebound Warning) 
        if (AppState.records.length > 30) {
            const periodRecs = AppState.records.slice(-30);
            const pMax = Math.max(...periodRecs.map(r => r.weight));
            const pMin = Math.min(...periodRecs.map(r => r.weight));
            const totalDrop = pMax - pMin;
            
            const regained = s.current - pMin;
            
            if (totalDrop > 2.0 && regained > totalDrop * 0.5) {
                htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 요요 경계령:</span> "최근 한 달간 힘들게 뺀 살의 <strong>절반 이상</strong>이 다시 쪘습니다. 단순한 변동이 아니라 '요요 현상'이 시작된 것일 수 있습니다. 다시 긴장감을 가지세요!"</li>`);
            } else if (totalDrop > 2.0 && regained > totalDrop * 0.3) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🚧 주의 구간:</span> "최저 체중 대비 <strong>30% 정도</strong> 반등했습니다. 보상 심리로 인해 식단이 느슨해지지 않았는지 점검해보세요."</li>`);
            }
        }
        
        // 39. 월요병 증후군 (Monday Sickness)
        let monGains = 0, monCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if (d.getDay() === 1) { // 월요일
                if (AppState.records[i].weight > AppState.records[i-1].weight) monGains++;
                monCount++;
            }
        }
        if (monCount > 5 && (monGains / monCount) > 0.8) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📅 월요병 증후군:</span> "월요일 아침마다 체중이 늘어날 확률이 <strong>${((monGains/monCount)*100).toFixed(0)}%</strong>입니다. 일요일 저녁 식사가 주범일 수 있습니다."</li>`);
        }

        // 40. 불금 효과 (TGIF)
        let friLosses = 0, friCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if (d.getDay() === 5) { // 금요일
                if (AppState.records[i].weight < AppState.records[i-1].weight) friLosses++;
                friCount++;
            }
        }
        if (friCount > 5 && (friLosses / friCount) > 0.8) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎉 불금 효과:</span> "통계적으로 <strong>금요일 아침</strong> 체중이 가장 가볍습니다. 주중 관리를 매우 잘하고 계십니다!"</li>`);
        }

        // 41. 기록 공백 페널티 (Gap Penalty)
        let gapPenalty = 0;
        let gapCount = 0;
        for(let i=1; i<AppState.records.length; i++) {
            const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
            if (days >= 3) {
                const diff = AppState.records[i].weight - AppState.records[i-1].weight;
                if (diff > 0) {
                    gapPenalty += diff;
                    gapCount++;
                }
            }
        }
        if (gapCount >= 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🕳️ 기록 공백의 법칙:</span> "3일 이상 기록을 쉴 때마다 평균 <strong>+${(gapPenalty/gapCount).toFixed(1)}kg</strong>씩 증량했습니다. 기록을 멈추면 살이 찝니다."</li>`);
        }

        // 42. 세트 포인트 저항 (Set Point Theory)
        const roundedWeights = AppState.records.map(r => Math.round(r.weight));
        const modeMap = {};
        let maxEl = roundedWeights[0], maxCount = 1;
        for(let i = 0; i < roundedWeights.length; i++) {
            const el = roundedWeights[i];
            if(modeMap[el] == null) modeMap[el] = 1;
            else modeMap[el]++;  
            if(modeMap[el] > maxCount) { maxEl = el; maxCount = modeMap[el]; }
        }
        if (Math.abs(s.current - maxEl) < 1 && maxCount > 20) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">⚓ 세트 포인트:</span> "현재 체중 <strong>${maxEl}kg</strong> 부근은 과거 가장 오래 머물렀던 구간입니다. 뇌가 이 체중을 '정상'으로 인식하여 강력히 저항 중입니다. 이 구간을 뚫으려면 평소와 다른 자극이 필요합니다."</li>`);
        }

        // 43. 마의 29/39/49... (Last Mile)
        const decimalPart = s.current - Math.floor(s.current);
        if (decimalPart >= 0.8 && decimalPart <= 0.9) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🏁 라스트 마일:</span> "다음 앞자리 숫자까지 얼마 안 남았습니다! 보통 <strong>.8 ~ .9kg</strong> 구간에서 심리적으로 해이해지기 쉽습니다. 끝까지 긴장하세요."</li>`);
        }

        // 45. 작심삼일 판독기
        if (AppState.records.length > 10) {
            let quitStreak3 = 0;
            for(let i=0; i<AppState.records.length-3; i++) {
                const d1 = DateUtil.parse(AppState.records[i].date);
                const d3 = DateUtil.parse(AppState.records[i+2].date);
                if (DateUtil.daysBetween(d1, d3) === 2) { 
                    const dNext = DateUtil.parse(AppState.records[i+3].date);
                    if (DateUtil.daysBetween(d3, dNext) >= 3) quitStreak3++;
                }
            }
            if (quitStreak3 >= 2) {
                htmlLines.push(`<li class="insight-item"><span class="insight-label">🔥 작심삼일 판독기:</span> "3일 기록 후 쉬는 패턴이 <strong>${quitStreak3}회</strong> 감지되었습니다. 4일차 고비를 넘기면 습관이 됩니다!"</li>`);
            }
        }

        // 48. 적금 만기 (Savings Maturity)
        const totalSavedCal = totalLost * 7700;
        if (totalLost > 0) {
            htmlLines.push(`<li class="insight-item"><span class="insight-label">💰 적금 만기:</span> "지금까지 누적 <strong>${totalSavedCal.toLocaleString()}kcal</strong>를 태웠습니다. 이는 빅맥 ${Math.round(totalSavedCal/550)}개에 해당하는 열량입니다."</li>`);
        }

        // 49. 급행열차 (Express Train)
        if (s.rate30 && parseFloat(s.rate30) < -100) { 
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🚅 급행열차 탑승:</span> "최근 한 달간 감량 속도가 매우 빠릅니다. 이 속도라면 일반인 상위 5% 안에 드는 감량 퍼포먼스입니다."</li>`);
        }

        // 50. 주말 방어율 (Weekend Defense Rate)
        const myWeekendImpacts = [];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date);
            if(d.getDay() === 1) { 
                const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                const prevFriStr = DateUtil.format(prevFriDate);
                const friRec = AppState.records.find(r => r.date === prevFriStr);
                if(friRec) myWeekendImpacts.push(AppState.records[i].weight - friRec.weight);
            }
        }
        if (myWeekendImpacts.length > 4) {
             const defended = myWeekendImpacts.filter(v => v <= 0).length;
             const rate = (defended / myWeekendImpacts.length) * 100;
             let grade = 'F';
             if (rate >= 80) grade = 'A';
             else if (rate >= 60) grade = 'B';
             else if (rate >= 40) grade = 'C';
             
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🛡️ 주말 방어율:</span> "당신의 주말 방어율(증량하지 않은 주말)은 <strong>${rate.toFixed(0)}% (${grade}학점)</strong>입니다."</li>`);
        }

        // 51. 다이버전스 (Divergence)
        if (AppState.records.length > 7 && s.lastRec.fat) {
             const r = AppState.records;
             const wTrend = r[r.length-1].weight - r[r.length-7].weight; 
             const fTrend = r[r.length-1].fat - r[r.length-7].fat; 
             
             if (wTrend < 0 && fTrend > 0) {
                 htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">⚠️ 하락 다이버전스:</span> "체중은 줄고 있지만 체지방률은 오르고 있습니다. 근손실이 의심됩니다. 단백질 섭취를 늘리세요."</li>`);
             } else if (wTrend > 0 && fTrend < 0) {
                 htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">💎 상승 다이버전스:</span> "체중은 늘었지만 체지방률은 떨어졌습니다. 근육량이 늘어나는 긍정적인 신호(린매스업)입니다."</li>`);
             }
        }

        // 53. 5일 이동평균선 돌파 (Moving Average Crossover)
        if (AppState.records.length > 6) {
            const last5Avg = AppState.records.slice(-6, -1).reduce((a,b)=>a+b.weight,0)/5;
            if (s.current < last5Avg && AppState.records[AppState.records.length-2].weight > last5Avg) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 5일선 돌파:</span> "오늘 체중이 5일 이동평균선을 뚫고 내려갔습니다. 단기 하락 추세가 시작되었습니다."</li>`);
            } else if (s.current > last5Avg && AppState.records[AppState.records.length-2].weight < last5Avg) {
                 htmlLines.push(`<li class="insight-item text-danger"><span class="insight-label">📈 5일선 이탈:</span> "체중이 5일 이동평균선 위로 올라왔습니다. 단기 상승 추세로 전환될 수 있으니 주의하세요."</li>`);
            }
        }

        // 54. 3일 법칙 (The 3-Day Rule)
        let threeDayDrop = 0;
        for(let i=2; i<AppState.records.length; i++) {
             if(AppState.records[i].weight < AppState.records[i-1].weight && 
                AppState.records[i-1].weight < AppState.records[i-2].weight) threeDayDrop++;
        }
        const totalDrops = AppState.records.filter((r,i)=>i>0 && r.weight < AppState.records[i-1].weight).length;
        if(totalDrops > 0) {
            const prob = (threeDayDrop / totalDrops * 100).toFixed(0);
             htmlLines.push(`<li class="insight-item"><span class="insight-label">📉 관성의 법칙:</span> "체중이 이틀 연속 빠지면, 3일째에도 빠질 확률이 <strong>${prob}%</strong>입니다."</li>`);
        }

        // 55. 체중계 공포증 (Scale Phobia)
        let skipAfterGain = 0;
        let gainEvents = 0;
        for(let i=1; i<AppState.records.length-2; i++) {
            if (AppState.records[i].weight > AppState.records[i-1].weight + 0.5) {
                 gainEvents++;
                 const nextDay = DateUtil.addDays(AppState.records[i].date, 1);
                 if (AppState.records[i+1].date !== nextDay) {
                     skipAfterGain++;
                 }
            }
        }
        if (gainEvents > 3 && (skipAfterGain/gainEvents) > 0.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🫣 타조 효과 (Ostrich Effect):</span> "체중이 많이 늘어난 다음날은 기록을 건너뛰는 경향(${((skipAfterGain/gainEvents)*100).toFixed(0)}%)이 있습니다. 외면하지 말고 직면해야 해결됩니다!"</li>`);
        }

		// 56. BMI 클래스 변경 임박 (Proximity)
        const h = AppState.settings.height / 100;
        const currentBMI = s.current / (h*h);
        const thresholds = Object.values(CONFIG.BMI);
        let closestDist = 999;
        let targetBMI = 0;
        
        thresholds.forEach(t => {
            const dist = currentBMI - t;
            // 현재 BMI가 기준선보다 높고(빼야 함), 그 차이가 1.0 미만일 때
            if (dist > 0 && dist < 1.0 && dist < closestDist) {
                closestDist = dist;
                targetBMI = t;
            }
        });

        if (closestDist < 999) {
            const wToLose = (currentBMI - targetBMI) * h * h;
            
            let weightStr;
            // 1kg 미만이면 g 단위로 표시
            if (wToLose < 1.0) {
                // 0g으로 표시되는 것을 막기 위해 소수점 이하 올림 처리
                const grams = Math.ceil(wToLose * 1000); 
                weightStr = `${grams}g`;
            } else {
                weightStr = `${wToLose.toFixed(1)}kg`;
            }

             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎖️ 승급 심사 임박:</span> "앞으로 <strong>${weightStr}</strong>만 더 빼면 BMI 단계가 내려갑니다! 비만도 등급이 바뀌는 순간입니다."</li>`);
        }
		
        // 58. 스키니 진 지수 (Skinny Jeans Index)
        if (AppState.records.length > 30) {
            let newLows = 0;
            let minW = AppState.records[0].weight;
            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i].weight < minW) {
                    minW = AppState.records[i].weight;
                    newLows++;
                }
            }
            const freq = (AppState.records.length / newLows).toFixed(1);
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👖 스키니 진 지수:</span> "평균적으로 <strong>${freq}일</strong>마다 최저 체중을 경신하고 있습니다. 다음 신기록까지 화이팅!"</li>`);
        }

        // 59. 앵커링 효과 (Anchoring)
        if (totalLost > 5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">⚓ 앵커링 탈출:</span> "이제 시작 체중(${AppState.settings.startWeight}kg)은 남의 얘기 같습니다. 뇌의 기준점이 성공적으로 낮아지고 있습니다."</li>`);
        }

        // 60. 파레토 법칙 (80/20 Rule)
        if (AppState.records.length > 20) {
            const dailyDrops = [];
            for(let i=1; i<AppState.records.length; i++) {
                const diff = AppState.records[i-1].weight - AppState.records[i].weight;
                if(diff > 0) dailyDrops.push(diff);
            }
            dailyDrops.sort((a,b)=>b-a);
            const top20Count = Math.ceil(dailyDrops.length * 0.2);
            const top20Sum = dailyDrops.slice(0, top20Count).reduce((a,b)=>a+b,0);
            const totalSum = dailyDrops.reduce((a,b)=>a+b,0);
            
            if (totalSum > 0) {
                const ratio = (top20Sum / totalSum * 100).toFixed(0);
                htmlLines.push(`<li class="insight-item"><span class="insight-label">📊 파레토 법칙:</span> "전체 감량의 <strong>${ratio}%</strong>가 상위 20%의 '황금 같은 날들'에 이루어졌습니다. 감량 잘 되는 날의 루틴을 기억하세요."</li>`);
            }
        }

        // 62. 뇌피셜 방지 (Fact Check)
        if (AppState.records.length > 30) {
             const r7 = AppState.records.slice(-7);
             const r30 = AppState.records.slice(-30);
             const trend7 = r7[r7.length-1].weight - r7[0].weight;
             const trend30 = r30[r30.length-1].weight - r30[0].weight;

             if (trend7 > 0 && trend30 < -1.0) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🧠 뇌피셜 방지 (Fact Check):</span> "최근 1주일간 체중이 늘어 살이 안 빠진다고 느끼시죠? 하지만 30일 추세는 여전히 하락장입니다. 일시적 반등에 속지 마세요."</li>`);
             }
        }

        // 63. 명절/연휴 후유증 (Holiday Blues)
        const today = new Date();
        const mmdd = DateUtil.format(today).substring(5);
        if (['01-02','01-03','01-04', '09-15', '09-16', '12-26'].includes(mmdd)) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎁 명절/연휴 후유증:</span> "연휴 급찐살은 지방이 아니라 글리코겐과 수분입니다. 2주 내에 관리하면 100% 복구됩니다. 골든타임을 놓치지 마세요."</li>`);
        }

        // 66. 작용 반작용 (Newton's 3rd Law)
        if (s.maxDrop > 1.5 && s.lastRec.weight - AppState.records[AppState.records.length-2].weight > 0.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🍏 작용 반작용:</span> "최근 급격한 감량에 대한 반발력으로 일시적 증량이 왔습니다. 몸이 항상성을 유지하려는 자연스러운 현상입니다."</li>`);
        }

        // 67. 100일의 기적 (100 Days)
        const startD = DateUtil.parse(AppState.records[0].date);
        const lastD = DateUtil.parse(s.lastRec.date);
        const diffDays = DateUtil.daysBetween(startD, lastD);
        if (diffDays >= 95 && diffDays <= 105) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💯 100일의 기적:</span> "다이어트를 시작한 지 100일이 되었습니다! 습관이 형성되기에 충분한 시간입니다. 이제 다이어트는 당신의 일상입니다."</li>`);
        }

        // 68. 계절성 패턴 (Seasonality - Summer Prep)
        const m = new Date().getMonth() + 1;
        if (m === 5 || m === 6) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👙 여름 준비 기간:</span> "여름이 다가오고 있습니다. 통계적으로 이 시기에 동기부여가 가장 높습니다. 지금 스퍼트를 올리세요!"</li>`);
        } else if (m === 12 || m === 1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">❄️ 겨울잠 본능:</span> "기온이 떨어지면 몸은 지방을 축적하려 합니다. 식욕이 느는 것은 본능이니 자책하지 말고 활동량을 늘리세요."</li>`);
        }

        // 69. 목표 달성 압박감 (Goal Anxiety)
        if (s.current - AppState.settings.goal1 < 1.0 && s.current > AppState.settings.goal1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">😫 목표 달성 압박감:</span> "목표까지 딱 1kg 남았습니다! 이 구간이 가장 안 빠지고 심리적으로 힘든 '마의 구간'입니다. 체중계보다 눈바디를 믿으세요."</li>`);
        }

        // 70. 로또 당첨 확률 (Fun)
        if (s.diffs && s.diffs.length > 0) {
            const sameWeightCount = s.diffs.filter(d => d === 0).length;
            if (sameWeightCount > 5) {
                 htmlLines.push(`<li class="insight-item"><span class="insight-label">🎰 도플갱어:</span> "소수점까지 체중이 똑같은 날이 <strong>${sameWeightCount}일</strong>이나 됩니다."</li>`);
            }
        }

        // 73. 1% 클럽 (Top 1%)
        if (s.totalLost / AppState.settings.startWeight > 0.2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">👑 상위 1% 클럽:</span> "체중의 20% 이상을 감량하셨군요! 이는 의학적으로도 놀라운 성과이며, 일반인 중 상위 1%에 해당하는 의지력입니다."</li>`);
        }

        // 75. 우상향 정기예금 (Savings Account)
        if (s.stdDev < 0.2 && totalLost > 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🏦 정기예금 패턴:</span> "체중이 정말 꾸준하고 안정적으로 빠지고 있습니다. 가장 이상적이고 요요가 적은 '정석 다이어트'의 표본입니다."</li>`);
        }

        // 76. 수분 컷팅 (Water Cut)
        if (s.lastRec.weight - AppState.records[AppState.records.length-2].weight < -1.5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💦 수분 컷팅:</span> "하루 만에 급격히 빠진 것은 지방이 아니라 수분일 가능성이 큽니다. 어제 저염식을 하셨거나 땀을 많이 흘리셨나요?"</li>`);
        }

        // 78. 다이어트 정체성 (Identity)
        const bmiCat = s.bmi < 23 ? '유지어터' : '다이어터';
        if (bmiCat === '유지어터' && totalLost > 5) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎓 졸업반:</span> "이제 '다이어터'가 아니라 '유지어터'의 영역에 들어섰습니다. 빼는 것보다 지키는 것이 더 어렵습니다."</li>`);
        }


		// 79. 과속 방지턱 (Speed Bump) - 의학적 정밀 버전 (줄바꿈 없음)
        if (s.rate7 && parseFloat(s.rate7) <= -200) { 
             const currentGrams = parseFloat(s.rate7); 
             const absGPerDay = Math.abs(currentGrams);
             const kgPerWeek = (absGPerDay * 7 / 1000).toFixed(2); 

             htmlLines.push(`<li class="insight-item text-danger">
                <span class="insight-label">🚧 과속 방지턱:</span> 
                "현재 감량 속도(<strong>주당 ${kgPerWeek}kg</strong>)가 과도하게 빠릅니다. 담석증 예방을 위한 <strong>지방(오일, 견과류)</strong>과 탈모 방지를 위한 <strong>단백질</strong> 섭취를 지금 즉시 늘리시고, 만약 <strong>오른쪽 윗배 통증, 발열, 황달</strong>이 발생하면 즉시 병원에 가셔서 진료를 받으세요."
             </li>`);
        }
		

        // 80. 버티기 승리 (HODL Victory)
        if (maxPlateau > 10 && s.current < s.lastRec.weight) { 
             htmlLines.push(`<li class="insight-item text-primary"><span class="insight-label">🚀 버티기는 승리한다:</span> "긴 정체기를 뚫고 드디어 하락 추세로 돌아섰습니다! 포기하지 않은 당신의 승리입니다."</li>`);
        }

        // 81. 아홉수 (Ending with 9)
        const lastDigit = Math.floor(s.current) % 10;
        if (lastDigit === 9) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">9️⃣ 아홉수:</span> "앞자리가 바뀌기 직전인 X9kg대입니다. 조금만 더 힘내면 앞자리가 바뀝니다!"</li>`);
        }

        // 82. 데칼코마니 (Decalcomania)
        if (AppState.records.length > 2) {
             const r = AppState.records;
             if (r[r.length-1].weight === r[r.length-2].weight) {
                  htmlLines.push(`<li class="insight-item"><span class="insight-label">🦋 데칼코마니:</span> "어제와 체중이 소수점까지 똑같습니다. 몸이 현재 체중에 적응 중인 것 같습니다."</li>`);
             }
        }

        // 83. 손실 회피 성향 (Loss Aversion)
        if (remaining > 0 && remaining < 2) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">💎 손실 회피:</span> "목표가 코앞입니다. 지금 포기하면 지금까지의 노력이 너무 아깝지 않나요? 딱 3일만 더 버텨봅시다."</li>`);
        }

        // 85. 럭키 세븐 (Lucky 7)
        if (s.current.toString().indexOf('77') > -1) {
             htmlLines.push(`<li class="insight-item"><span class="insight-label">🎰 잭팟 (77):</span> "체중에 행운의 숫자 77이 들어있습니다. 오늘은 운 좋은 하루가 될 거예요!"</li>`);
        }

        AppState.getEl('advancedAnalysisList').innerHTML = htmlLines.join('');
    }

    function renderPlateauHelper(s) {
        const phEl = AppState.getEl('plateauHelperText');
        if (!phEl) return;
        const recent = AppState.records.slice(-14); 
        if (recent.length < 7) {
            phEl.innerText = CONFIG.MESSAGES.PLATEAU.NEED_DATA;
            return;
        }
        
        const weights = recent.map(r => r.weight);
        const max = Math.max(...weights);
        const min = Math.min(...weights);
        const diff = MathUtil.diff(max, min);
        
        let msg = "";
        if (diff < 0.5) {
            const tips = CONFIG.MESSAGES.TIPS;
            const tip = tips[Math.floor(Math.random() * tips.length)];
            msg = CONFIG.MESSAGES.PLATEAU.DETECTED.replace('{diff}', diff.toFixed(1)).replace('{tip}', tip);
        } else {
            const lastW = weights[weights.length-1];
            const firstW = weights[0];
            if (lastW < firstW) msg = CONFIG.MESSAGES.PLATEAU.GOOD;
            else msg = CONFIG.MESSAGES.PLATEAU.WARN;
        }
        phEl.innerHTML = msg;
    }

    function renderPeriodComparison() {
        const table = AppState.getEl('periodCompareTable');
        if (!table) return;
        const now = new Date();
        const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3);
        const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        const getStats = (startDate, endDate) => {
            const recs = AppState.records.filter(r => {
                const d = DateUtil.parse(r.date);
                return d >= startDate && d <= endDate;
            });
            if (recs.length < 2) return null;
            const avgW = recs.reduce((a,b) => a+b.weight, 0) / recs.length;
            const loss = MathUtil.diff(recs[0].weight, recs[recs.length-1].weight);
            const days = DateUtil.daysBetween(DateUtil.parse(recs[0].date), DateUtil.parse(recs[recs.length-1].date)) || 1;
            const speed = loss / days * 7; 
            return { avgW, loss, speed };
        };

        const currentStats = getStats(threeMonthsAgo, now);
        const pastStats = getStats(new Date(oneYearAgo.setMonth(oneYearAgo.getMonth()-3)), new Date(now.getFullYear()-1, now.getMonth(), now.getDate()));

        let rows = [];
        if (currentStats) {
            rows.push(`<tr><td>최근 3개월</td><td>${currentStats.avgW.toFixed(1)}</td><td>${currentStats.loss.toFixed(1)}</td><td>${currentStats.speed.toFixed(2)} kg/주</td></tr>`);
        } else {
            rows.push(`<tr><td>최근 3개월</td><td colspan="3">데이터 부족</td></tr>`);
        }
        
        if (pastStats) {
            rows.push(`<tr><td>작년 동기</td><td>${pastStats.avgW.toFixed(1)}</td><td>${pastStats.loss.toFixed(1)}</td><td>${pastStats.speed.toFixed(2)} kg/주</td></tr>`);
        } else {
             rows.push(`<tr><td>작년 동기</td><td colspan="3">데이터 없음</td></tr>`);
        }
        table.innerHTML = rows.join('');
    }

    function renderDetailedStats(s) {
        const table = AppState.getEl('detailedStatsTable');
        if (!table) return;
        if (AppState.records.length < 2) {
            table.innerHTML = "<tr><td colspan='2'>데이터 부족</td></tr>";
            return;
        }
        
        let rows = [];
        rows.push(`<tr><td>최고 체중 기록일</td><td>${s.maxDate} (${s.max}kg)</td></tr>`);
        rows.push(`<tr><td>최저 체중 기록일</td><td>${s.minDate} (${s.min}kg)</td></tr>`);
        rows.push(`<tr><td>체중 표준 편차</td><td>${s.stdDev.toFixed(2)}</td></tr>`);
        rows.push(`<tr><td>체지방량 변화</td><td>${s.fatChange ? s.fatChange.toFixed(1) + 'kg' : '-'}</td></tr>`);
        rows.push(`<tr><td>제지방량 변화</td><td>${s.lbmChange ? s.lbmChange.toFixed(1) + 'kg' : '-'}</td></tr>`);
        rows.push(`<tr><td>최대 일일 감량</td><td>${s.maxDrop}kg</td></tr>`);
        rows.push(`<tr><td>최대 일일 증량</td><td>${s.maxGain}kg</td></tr>`);
        rows.push(`<tr><td>최장 정체기</td><td>${s.maxPlateau}일</td></tr>`);
        
        table.innerHTML = rows.join('');
    }
    
    function renderExtendedStats() {
        if(AppState.records.length < 2) return;

        const winStats = [0,0,0,0,0,0,0]; 
        const totalStats = [0,0,0,0,0,0,0]; 
        const dayNames = ['일','월','화','수','목','금','토'];
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            if(AppState.records[i].weight < AppState.records[i-1].weight) winStats[d]++;
            totalStats[d]++;
        }
        let winRows = [];
        dayNames.forEach((name, i) => {
            const rate = totalStats[i] > 0 ? (winStats[i] / totalStats[i] * 100).toFixed(0) : 0;
            winRows.push(`<tr><td>${name}</td><td>${rate}% (${winStats[i]}/${totalStats[i]})</td></tr>`);
        });
        AppState.getEl('dailyWinRateTable').innerHTML = winRows.join('');

        const zones10 = {};
        AppState.records.forEach(r => {
            const z = Math.floor(r.weight / 10) * 10;
            const key = `${z}kg대`;
            if(!zones10[key]) zones10[key] = 0;
            zones10[key]++;
        });
        let zoneRows = [];
        Object.keys(zones10).sort().reverse().forEach(z => {
            zoneRows.push(`<tr><td>${z}</td><td>${zones10[z]}일</td></tr>`);
        });
        AppState.getEl('zoneDurationTable').innerHTML = zoneRows.join('');

        let maxLossStreak = 0, currLossStreak = 0;
        let maxGainStreak = 0, currGainStreak = 0;
        let maxRecStreak = 0, currRecStreak = 0;
        let maxGap = 0;

        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            const dayDiff = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
            
            if(dayDiff === 1) {
                currRecStreak++;
                if(currRecStreak > maxRecStreak) maxRecStreak = currRecStreak;
            } else {
                currRecStreak = 0;
                if(dayDiff > maxGap) maxGap = dayDiff;
            }

            if(diff < 0) {
                currLossStreak++; currGainStreak = 0;
                if(currLossStreak > maxLossStreak) maxLossStreak = currLossStreak;
            } else if(diff > 0) {
                currGainStreak++; currLossStreak = 0;
                if(currGainStreak > maxGainStreak) maxGainStreak = currGainStreak;
            } else {
                currLossStreak = 0; currGainStreak = 0;
            }
        }
        let streakHtml = `
            <tr><td>최장 연속 감량</td><td>${maxLossStreak}일</td></tr>
            <tr><td>최장 연속 증량</td><td>${maxGainStreak}일</td></tr>
            <tr><td>최장 연속 기록</td><td>${maxRecStreak}일</td></tr>
            <tr><td>최장 미기록(공백)</td><td>${maxGap}일</td></tr>
        `;
        AppState.getEl('streakDetailTable').innerHTML = streakHtml;

        const monthDiffs = {};
        for(let i=1; i<AppState.records.length; i++) {
            const key = AppState.records[i].date.substring(0, 7);
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            if(!monthDiffs[key]) monthDiffs[key] = 0;
            monthDiffs[key] += diff;
        }
        const sortedMonths = Object.keys(monthDiffs).map(k => ({ m: k, v: monthDiffs[k] })).sort((a,b) => a.v - b.v);
        const best3 = sortedMonths.slice(0, 3);
        const worst3 = sortedMonths.slice().reverse().slice(0, 3);
        
        let bwRows = [];
        for(let i=0; i<3; i++) {
            const best = best3[i];
            const worst = worst3[i];
            bwRows.push(`<tr>
                <td>${i+1}위</td>
                <td>${best ? best.m + ' (' + best.v.toFixed(1) + 'kg)' : '-'}</td>
                <td>${worst ? worst.m + ' (+' + worst.v.toFixed(1) + 'kg)' : '-'}</td>
            </tr>`);
        }
        AppState.getEl('bestWorstMonthTable').innerHTML = bwRows.join('');

        // --- [NEW] v3.0.71 The Wall (Zone) Analysis ---
        const zoneDays = {};
        for(let i=0; i<AppState.records.length; i++) {
            const z = Math.floor(AppState.records[i].weight);
            const key = `${z}kg대`;
            if(!zoneDays[key]) zoneDays[key] = 0;
            zoneDays[key]++;
        }
        const sortedZones = Object.keys(zoneDays).map(k => ({ z: k, d: zoneDays[k] })).sort((a,b) => b.d - a.d).slice(0, 3);
        let wallRows = [];
        sortedZones.forEach((z, i) => {
             wallRows.push(`<tr><td>${i+1}위</td><td>${z.z}</td><td>${z.d}일</td></tr>`);
        });
        const wallTbody = AppState.getEl('wallTableBody');
        if(wallTbody) wallTbody.innerHTML = wallRows.length ? wallRows.join('') : '<tr><td colspan="3">분석 중...</td></tr>';

        // --- [NEW] v3.0.71 Monthly Fat Loss ---
        const mFat = {};
        AppState.records.forEach(r => {
            if(!r.fat) return;
            const k = r.date.substring(0, 7);
            if(!mFat[k]) mFat[k] = { startFat: null, endFat: null, startLbm: null, endLbm: null };
            const fatKg = r.weight * (r.fat/100);
            const lbmKg = r.weight - fatKg;
            if(mFat[k].startFat === null) { mFat[k].startFat = fatKg; mFat[k].startLbm = lbmKg; }
            mFat[k].endFat = fatKg; mFat[k].endLbm = lbmKg;
        });
        let fatRows = [];
        Object.keys(mFat).sort().reverse().forEach(k => {
             const d = mFat[k];
             if(d.startFat !== null && d.endFat !== null) {
                 const fatLoss = d.startFat - d.endFat;
                 const lbmChange = d.endLbm - d.startLbm;
                 fatRows.push(`<tr><td>${k}</td><td>${fatLoss.toFixed(1)}kg</td><td>${lbmChange>0?'+':''}${lbmChange.toFixed(1)}kg</td></tr>`);
             }
        });
        const mfBody = AppState.getEl('monthlyFatLossTableBody');
        if(mfBody) mfBody.innerHTML = fatRows.length ? fatRows.join('') : '<tr><td colspan="3">체지방 데이터 부족</td></tr>';
    }
	
    function updateProgressBar(current, lost, percent, remaining) {
        let visualPercent = percent;
        if(visualPercent < 0) visualPercent = 0;
        if(visualPercent > 100) visualPercent = 100;

        AppState.getEl('labelStart').innerText = `시작: ${AppState.settings.startWeight}kg`;
        AppState.getEl('labelGoal').innerText = `목표: ${AppState.settings.goal1}kg`;

        const fill = AppState.getEl('progressBarFill');
        const emoji = AppState.getEl('progressEmoji');
        const text = AppState.getEl('progressText');

        fill.style.width = `${visualPercent}%`;
        emoji.style.right = `${visualPercent}%`;
        text.style.right = `${visualPercent}%`;

        const displayLost = Math.abs(lost).toFixed(1);
        const displayPercent = percent.toFixed(1);
        const safeRemain = remaining > 0 ? remaining : 0;
        
        let remainPercentVal = 100 - percent;
        if (safeRemain <= 0) remainPercentVal = 0;
        const displayRemainPercent = remainPercentVal.toFixed(1);

        let statusMsg = "";
        if (remaining <= 0) statusMsg = "🎉 목표 달성!";

        text.innerHTML = `
            <strong>${current.toFixed(1)}kg</strong> ${statusMsg}<br>
            감량: ${displayLost}kg (${displayPercent}%)<br>
            남은: ${safeRemain}kg (${displayRemainPercent}%)
        `;
    }

    function updateBmiProgressBar(bmi, label) {
        const minScale = 10;
        const maxScale = 35;
        
        let pct = ((bmi - minScale) / (maxScale - minScale)) * 100;
        let visualPercent = MathUtil.clamp(pct, 0, 100);
        let rightPos = 100 - visualPercent;

        const fill = AppState.getEl('bmiProgressBarFill');
        if (!fill) return;

        AppState.getEl('bmiLabelLeft').innerText = `BMI ${minScale}`;
        AppState.getEl('bmiLabelRight').innerText = `BMI ${maxScale}`;

        fill.style.width = `${visualPercent}%`;
        AppState.getEl('bmiProgressEmoji').style.right = `${rightPos}%`;
        AppState.getEl('bmiProgressText').style.right = `${rightPos}%`;

		AppState.getEl('bmiProgressText').innerHTML = `
			<strong>BMI ${bmi.toFixed(2)}</strong><br>
			${label}
		`;	
    }
    
    function renderAnalysisText(s) {
        const txtEl = AppState.getEl('analysisText');
        if (AppState.records.length < 2) {
            txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.DATA_Need;
            return;
        }
        const last = AppState.records[AppState.records.length-1];
        const prev = AppState.records[AppState.records.length-2];
        const diff = MathUtil.diff(last.weight, prev.weight);
        
        if (diff < 0) txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.LOSS.replace('{diff}', Math.abs(diff));
        else if (diff > 0) txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.GAIN.replace('{diff}', diff);
        else txtEl.innerText = CONFIG.MESSAGES.ANALYSIS.MAINTAIN;
    }

    function calculateScenarios(currentW) {
        if(currentW <= AppState.settings.goal1) return { avg: "달성 완료! 🎉", range: "" };
        if(AppState.records.length < 5) return { avg: "데이터 수집 중...", range: "" };
        
        const recent = AppState.records.slice(-30);
        if(recent.length < 2) return { avg: "분석 중...", range: "" };

        const first = recent[0];
        const last = recent[recent.length-1];
        const days = DateUtil.daysBetween(new Date(first.date), new Date(last.date));
        const totalDiff = MathUtil.diff(first.weight, last.weight);
        const avgRate = totalDiff / (days || 1); 

        if(avgRate <= 0.001) return { avg: "증량/유지세 🤔", range: "식단 조절 필요" };

        const remain = MathUtil.diff(currentW, AppState.settings.goal1);
        const daysLeftAvg = Math.ceil(remain / avgRate);
        
        const fastRate = avgRate * 1.5; 
        const slowRate = avgRate * 0.7;

        const dAvg = new Date(); dAvg.setDate(dAvg.getDate() + daysLeftAvg);
        const dFast = new Date(); dFast.setDate(dFast.getDate() + Math.ceil(remain / fastRate));
        const dSlow = new Date(); dSlow.setDate(dSlow.getDate() + Math.ceil(remain / slowRate));

        const formatDate = (d) => `${d.getMonth()+1}/${d.getDate()}`;
        
        return {
            avg: `${formatDate(dAvg)} (${daysLeftAvg}일 후)`,
            range: `최적 ${formatDate(dFast)} ~ 보수 ${formatDate(dSlow)}`
        };
    }

    // --- 7. 차트 그리기 함수들 ---
    function updateFilterButtons() {
        AppState.getEl('btn-1m').className = 'filter-btn' + (AppState.chartFilterMode==='1M'?' active':'');
        AppState.getEl('btn-3m').className = 'filter-btn' + (AppState.chartFilterMode==='3M'?' active':'');
        AppState.getEl('btn-6m').className = 'filter-btn' + (AppState.chartFilterMode==='6M'?' active':'');
        AppState.getEl('btn-1y').className = 'filter-btn' + (AppState.chartFilterMode==='1Y'?' active':'');
        AppState.getEl('btn-all').className = 'filter-btn' + (AppState.chartFilterMode==='ALL'?' active':'');
    }

    function setChartFilter(mode) {
        AppState.chartFilterMode = mode;
        localStorage.setItem(AppState.FILTER_KEY, mode);
        updateFilterButtons();
        updateUI(); 
    }

    function applyCustomDateRange() {
        const s = AppState.getEl('chartStartDate').value;
        const e = AppState.getEl('chartEndDate').value;
        if(s && e) {
            AppState.chartFilterMode = 'CUSTOM';
            AppState.customStart = s; AppState.customEnd = e;
            localStorage.setItem(AppState.FILTER_KEY, 'CUSTOM');
            document.querySelectorAll('.filter-group .filter-btn').forEach(b=>b.classList.remove('active'));
            updateUI();
        }
    }

    function getFilteredData() {
        if(AppState.records.length === 0) return [];
        let start = DateUtil.parse(AppState.records[0].date);
        let end = new Date(); end.setHours(23,59,59,999);
        const now = new Date(); now.setHours(0,0,0,0);

        if(AppState.chartFilterMode === '1M') { 
            start = new Date(now); start.setMonth(start.getMonth()-1); 
        } else if(AppState.chartFilterMode === '3M') { 
            start = new Date(now); start.setMonth(start.getMonth()-3); 
        } else if(AppState.chartFilterMode === '6M') { 
            start = new Date(now); start.setMonth(start.getMonth()-6);
        } else if(AppState.chartFilterMode === '1Y') { 
            start = new Date(now); start.setFullYear(start.getFullYear()-1);
        } else if(AppState.chartFilterMode === 'CUSTOM' && AppState.customStart) { 
            start = DateUtil.parse(AppState.customStart);
            end = DateUtil.parse(AppState.customEnd); end.setHours(23,59,59,999);
        }
        
        return AppState.records.filter(r => {
            const d = DateUtil.parse(r.date);
            return d >= start && d <= end;
        });
    }

    function createChartConfig(type, data, options, colors) {
        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            // [Improvement] Chart Tooltip Readability
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
                y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
            }
        };
        if(options && options.scales) {
             if(options.scales.x) Object.assign(defaultOptions.scales.x, options.scales.x);
             if(options.scales.y) Object.assign(defaultOptions.scales.y, options.scales.y);
        }
        Object.assign(defaultOptions, options);
        return { type, data, options: defaultOptions };
    }

    // [Fix] 차트 인스턴스 중복 생성 방지 강화
    function updateChartHelper(key, ctx, config) {
        // 기존 인스턴스 정리
        const existingInstance = Chart.getChart(ctx);
        if (existingInstance) {
            existingInstance.destroy();
        }
        
        // 내부 캐시 확인 및 정리
        if (AppState.charts[key]) {
            AppState.charts[key].destroy();
            delete AppState.charts[key];
        }

        // 새 차트 생성
        AppState.charts[key] = new Chart(ctx, config);
    }

    function updateMainChart(colors) {
        const ctx = document.getElementById('mainChart').getContext('2d');
        const data = getFilteredData();
        const points = data.map(r => ({ x: r.date, y: r.weight }));
        
        const h = AppState.settings.height / 100;
        const w185 = CONFIG.BMI.UNDER * h * h;
        const w23 = CONFIG.BMI.NORMAL_END * h * h;
        const w25 = CONFIG.BMI.PRE_OBESE_END * h * h;
        
        const chartStart = points.length ? points[0].x : new Date();
        const chartEnd = points.length ? points[points.length-1].x : new Date();

        const trend = [];
        const upperBand = [];
        const lowerBand = [];
        const showTrend = AppState.getEl('showTrend').checked;

        if(showTrend && data.length > 0) {
            for(let i=0; i<data.length; i++) {
                const currentDate = DateUtil.parse(data[i].date);
                const sevenDaysAgo = new Date(currentDate);
                sevenDaysAgo.setDate(currentDate.getDate() - 6);
                
                const windowData = AppState.records.filter(r => {
                    const d = DateUtil.parse(r.date);
                    return d >= sevenDaysAgo && d <= currentDate;
                });
                
                if(windowData.length > 0) {
                     const weights = windowData.map(r => r.weight);
                     const mean = weights.reduce((acc, cur) => acc + cur, 0) / weights.length;
                     trend.push({ x: data[i].date, y: mean });

                     const variance = weights.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / weights.length;
                     const stdDev = Math.sqrt(variance);
                     upperBand.push({ x: data[i].date, y: mean + (2 * stdDev) });
                     lowerBand.push({ x: data[i].date, y: mean - (2 * stdDev) });
                }
            }
        }

        const isDark = document.body.classList.contains('dark-mode');

        const datasets = [
             {
                label: '비만',
                data: [{x: chartStart, y: 150}, {x: chartEnd, y: 150}],
                fill: { target: {value: w25}, above: isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '비만 전 단계',
                data: [{x: chartStart, y: w25}, {x: chartEnd, y: w25}],
                fill: { target: {value: w23}, above: isDark ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 152, 0, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '정상',
                data: [{x: chartStart, y: w23}, {x: chartEnd, y: w23}],
                fill: { target: {value: w185}, above: isDark ? 'rgba(76, 175, 80, 0.1)' : 'rgba(76, 175, 80, 0.05)' },
                borderColor: 'transparent', pointRadius: 0
            },
            {
                label: '체중',
                data: points,
                borderColor: colors.primary,
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                fill: false,
                tension: 0.1,
                pointRadius: 3
            },
            ...(showTrend ? [{
                label: '7일 추세',
                data: trend,
                borderColor: colors.secondary, 
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.4
            }, {
                label: 'Bollinger Upper',
                data: upperBand,
                borderColor: 'transparent',
                pointRadius: 0,
                fill: '+1', 
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'
            }, {
                label: 'Bollinger Lower',
                data: lowerBand,
                borderColor: 'transparent',
                pointRadius: 0
            }] : []),
            {
                label: '목표',
                data: data.length ? [{x: data[0].date, y: AppState.settings.goal1}, {x: data[data.length-1].date, y: AppState.settings.goal1}] : [],
                borderColor: colors.secondary,
                borderDash: [5,5],
                pointRadius: 0,
                borderWidth: 1
            }
        ];

        const config = createChartConfig('line', { datasets }, {
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'MM/dd' } }
                },
                y: {
                    max: points.length > 0 ? Math.ceil(Math.max(...points.map(p => p.y), AppState.settings.startWeight)) + 1 : AppState.settings.startWeight + 1,
                    suggestedMin: AppState.settings.goal1 - 2
                }
            },
            plugins: {
                tooltip: { mode: 'index', intersect: false },
                legend: {
                    labels: {
                        color: colors.text,
                        filter: function(item) { return !['비만', '비만 전 단계', '정상', 'Bollinger Upper', 'Bollinger Lower'].includes(item.text); }
                    }
                }
            }
        }, colors);

        updateChartHelper('main', ctx, config);
    }

    function updateGhostRunnerChart(colors) {
        if(AppState.records.length === 0) return;
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
        const lastMonth = lastMonthDate.getMonth();
        const lastMonthYear = lastMonthDate.getFullYear();

        const getMonthData = (m, y) => {
            const daysInMonth = DateUtil.getDaysInMonth(y, m);
            const data = new Array(31).fill(null);
            
            AppState.records.forEach(r => {
                const d = DateUtil.parse(r.date);
                if(d.getMonth() === m && d.getFullYear() === y) {
                    data[d.getDate() - 1] = r.weight;
                }
            });

            return data.map((val, idx) => (idx < daysInMonth ? val : null));
        };

        const currentData = getMonthData(thisMonth, thisYear);
        const previousData = getMonthData(lastMonth, lastMonthYear);

        const ctx = document.getElementById('ghostRunnerChart').getContext('2d');
        const config = createChartConfig('line', {
            labels: Array.from({length: 31}, (_, i) => `${i+1}일`),
            datasets: [
                {
                    label: '이번 달',
                    data: currentData,
                    borderColor: colors.primary,
                    backgroundColor: colors.primary,
                    borderWidth: 3,
                    tension: 0.3,
                    spanGaps: true
                },
                {
                    label: '지난달',
                    data: previousData,
                    borderColor: 'rgba(150, 150, 150, 0.3)',
                    backgroundColor: 'rgba(150, 150, 150, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        }, {}, colors);

        updateChartHelper('ghostRunner', ctx, config);
    }

    function updateGaugeCharts(colors) {
        const lastRec = AppState.records[AppState.records.length - 1];
        if(!lastRec) return;

        const hMeter = AppState.settings.height / 100;
        const bmi = Math.round((lastRec.weight / (hMeter * hMeter)) * 100) / 100;
        const fat = lastRec.fat || 0;

		const createGauge = (id, val, max, ranges, chartKey) => {
			const ctx = document.getElementById(id).getContext('2d');
			const config = {
				type: 'doughnut',
				data: {
					datasets: [{
						data: [...ranges.map(r => r.size), 0],
						backgroundColor: [...ranges.map(r => r.color), 'transparent'],
						borderWidth: 0
					}]
				},
				options: {
					circumference: 180,
					rotation: 270,
					cutout: '75%',
					responsive: true,
					maintainAspectRatio: false,
					layout: { padding: { bottom: 10 } },
					plugins: {
						legend: { display: false },
						tooltip: { enabled: false }
					}
				},
				plugins: [{
					id: 'gaugeNeedle',
					afterDraw: (chart) => {
						const { ctx, chartArea: { width, height } } = chart;
						const meta = chart.getDatasetMeta(0);
						if (!meta.data[0]) return; 

						const outerRadius = meta.data[0].outerRadius;
						const centerX = meta.data[0].x;
						const centerY = meta.data[0].y;

						ctx.save();
						const total = ranges.reduce((a, b) => a + b.size, 0);
                        const ratio = Math.min(val, total) / total;
						const angle = Math.PI + (Math.PI * ratio);

						ctx.translate(centerX, centerY);
						ctx.rotate(angle);
						ctx.beginPath();
						ctx.moveTo(0, -(outerRadius * 0.03)); 
						ctx.lineTo(outerRadius * 0.9, 0); 
						ctx.lineTo(0, (outerRadius * 0.03));
						ctx.closePath();
						ctx.fillStyle = colors.text;
						ctx.fill();
						ctx.restore();

						const fontSize = Math.round(outerRadius * 0.22);
						ctx.font = `bold ${fontSize}px sans-serif`;
						ctx.fillStyle = colors.text;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';

						let displayVal = val;
						if (!Number.isInteger(val)) {
							displayVal = val.toFixed(2);
						}
						ctx.fillText(displayVal, centerX, centerY - (outerRadius * 0.2));

					}
				}]
			};
			updateChartHelper(chartKey, ctx, config);
		};
		
        const bmiRanges = [
            { size: CONFIG.BMI.UNDER, color: '#90caf9' }, // 저체중
            { size: CONFIG.BMI.NORMAL_END - CONFIG.BMI.UNDER, color: '#a5d6a7' }, // 정상
            { size: CONFIG.BMI.PRE_OBESE_END - CONFIG.BMI.NORMAL_END, color: '#fff59d' }, // 비만 전
            { size: CONFIG.BMI.OBESE_1_END - CONFIG.BMI.PRE_OBESE_END, color: '#ffcc80' }, // 1단계
            { size: CONFIG.BMI.OBESE_2_END - CONFIG.BMI.OBESE_1_END, color: '#ef9a9a' }, // 2단계
        ];
        
        createGauge('gaugeBmiChart', bmi, 45, bmiRanges, 'gaugeBmi');

        createGauge('gaugeFatChart', fat, 50, [
            { size: 15, color: '#a5d6a7' }, 
            { size: 10, color: '#fff59d' }, 
            { size: 10, color: '#ffcc80' }, 
            { size: 15, color: '#ef9a9a' }  
        ], 'gaugeFat');
    }

    function updateDayOfWeekChart(colors) {
        if(AppState.records.length < 2) return;
        const sums = [0,0,0,0,0,0,0];
        const counts = [0,0,0,0,0,0,0];
        
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            const day = DateUtil.parse(AppState.records[i].date).getDay();
            sums[day] = MathUtil.add(sums[day], diff);
            counts[day]++;
        }
        
        const avgs = sums.map((s, i) => counts[i] ? s/counts[i] : 0);
        const ctx = document.getElementById('dayOfWeekChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['일','월','화','수','목','금','토'],
            datasets: [{
                label: '평균 변화(kg)',
                data: avgs,
                backgroundColor: avgs.map(v => v>0 ? CONFIG.COLORS.GAIN : '#c8e6c9'),
                borderColor: avgs.map(v => v>0 ? '#e57373':'#81c784'),
                borderWidth: 1
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('dow', ctx, config);
    }

    function updateHistogram(colors) {
        if(AppState.records.length === 0) return;
        const weights = AppState.records.map(r => r.weight);
        const min = Math.floor(Math.min(...weights));
        const max = Math.ceil(Math.max(...weights));
        
        const labels = [];
        const data = [];
        for(let i=min; i<=max; i++) {
            labels.push(i + 'kg대');
            data.push(weights.filter(w => Math.floor(w) === i).length);
        }

        const ctx = document.getElementById('histogramChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '일수',
                data: data,
                backgroundColor: colors.secondary,
                borderRadius: 4
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('hist', ctx, config);
    }

    function updateCumulativeChart(colors) {
        if(AppState.records.length === 0) return;
        const points = AppState.records.map(r => ({
            x: r.date,
            y: MathUtil.round(AppState.settings.startWeight - r.weight, 2)
        }));

        const ctx = document.getElementById('cumulativeChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '누적 감량(kg)',
                data: points,
                borderColor: '#9C27B0',
                backgroundColor: 'rgba(156, 39, 176, 0.2)',
                fill: true,
                tension: 0.2,
                pointRadius: 1
            }]
        }, {
            scales: {
                x: { type: 'time', time: { unit: 'month' } },
                y: { beginAtZero: true }
            },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('cumul', ctx, config);
    }

    function updateMonthlyChangeChart(colors) {
        if(AppState.records.length === 0) return;
        
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });

        const labels = [];
        const data = [];
        const bgColors = [];

        Object.keys(months).sort().forEach(m => {
            const arr = months[m];
            const change = MathUtil.diff(arr[arr.length-1], arr[0]); 
            labels.push(m);
            data.push(change);
            bgColors.push(change > 0 ? CONFIG.COLORS.GAIN : CONFIG.COLORS.LOSS);
        });

        const ctx = document.getElementById('monthlyChangeChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '월별 변화(kg)',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 0
            }]
        }, {
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('monthly', ctx, config);
    }

    function updateBodyFatChart(colors) {
        const fatData = AppState.records.filter(r => r.fat).map(r => ({ x: r.date, y: r.fat }));
        if(fatData.length === 0) return;

        const ctx = document.getElementById('bodyFatChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '체지방률(%)',
                data: fatData,
                borderColor: '#FF5722',
                backgroundColor: 'rgba(255, 87, 34, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2
            }]
        }, {
            scales: { x: { type: 'time', time: { unit: 'month' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('fat', ctx, config);
    }

    function updateScatterChart(colors) {
        const data = AppState.records.filter(r => r.fat).map(r => ({ x: r.weight, y: r.fat }));
        if(data.length === 0) return;

        const ctx = document.getElementById('scatterChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중(kg) vs 체지방(%)',
                data: data,
                backgroundColor: colors.secondary
            }]
        }, {
            scales: {
                x: { title: { display: true, text: '체중 (kg)' } },
                y: { title: { display: true, text: '체지방 (%)' } }
            }
        }, colors);

        updateChartHelper('scatter', ctx, config);
    }

    function updateWeekendChart(colors) {
        if(AppState.records.length < 2) return;
        const weekdayDeltas = [], weekendDeltas = [];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            if(d === 0 || d === 6) weekendDeltas.push(diff);
            else weekdayDeltas.push(diff);
        }

        const avgWeekday = weekdayDeltas.length ? weekdayDeltas.reduce((a,b)=>a+b,0)/weekdayDeltas.length : 0;
        const avgWeekend = weekendDeltas.length ? weekendDeltas.reduce((a,b)=>a+b,0)/weekendDeltas.length : 0;

        const chartData = [avgWeekday, avgWeekend];

        const ctx = document.getElementById('weekendChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['평일 (월~금)', '주말 (토~일)'],
            datasets: [{
                label: '평균 변화량 (kg)',
                data: chartData,
                backgroundColor: [colors.primary, colors.danger],
                barThickness: 50
            }]
        }, { plugins: { legend: { display: false } } }, colors);

        updateChartHelper('weekend', ctx, config);
    }

    function updateBodyCompStackedChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;

        const fatKg = fatRecs.map(r => ({ x: r.date, y: r.weight * (r.fat/100) }));
        const leanKg = fatRecs.map(r => ({ x: r.date, y: r.weight * (1 - r.fat/100) }));

        const ctx = document.getElementById('bodyCompStackedChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '제지방량 (kg)',
                    data: leanKg,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.5)',
                    fill: true
                },
                {
                    label: '체지방량 (kg)',
                    data: fatKg,
                    borderColor: colors.danger,
                    backgroundColor: 'rgba(244, 67, 54, 0.5)',
                    fill: true
                }
            ]
        }, {
            scales: {
                x: { type: 'time', time: { unit: 'month' } },
                y: { stacked: true }
            }
        }, colors);

        updateChartHelper('bodyComp', ctx, config);
    }

    function updateWeeklyBodyCompChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;
        
        const weeks = {};
        fatRecs.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1);
            const monday = new Date(d.setDate(diff));
            const key = DateUtil.format(monday);
            weeks[key] = {
                lbm: r.weight * (1 - r.fat/100),
                fat: r.weight * (r.fat/100)
            };
        });
        
        const labels = Object.keys(weeks).sort();
        const lbmData = labels.map(k => weeks[k].lbm);
        const fatData = labels.map(k => weeks[k].fat);
        
        const ctx = document.getElementById('weeklyBodyCompChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [
                {
                    label: '제지방량 (kg)',
                    data: lbmData,
                    backgroundColor: colors.primary,
                    stack: 'Stack 0'
                },
                {
                    label: '체지방량 (kg)',
                    data: fatData,
                    backgroundColor: colors.danger,
                    stack: 'Stack 0'
                }
            ]
        }, {
            scales: { x: { display: false }, y: { stacked: true } },
            plugins: { legend: { display: true } }
        }, colors);
        
        updateChartHelper('weeklyBodyComp', ctx, config);
    }
    
    function updateWeightSpeedScatterChart(colors) {
        if(AppState.records.length < 2) return;
        const data = [];
        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i-1].weight - AppState.records[i].weight; 
            data.push({ x: AppState.records[i-1].weight, y: diff });
        }
        
        const ctx = document.getElementById('weightSpeedScatterChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중(kg) vs 감량속도(kg/일)',
                data: data,
                backgroundColor: colors.secondary
            }]
        }, {
            scales: {
                x: { title: { display: true, text: '체중 (kg)' } },
                y: { title: { display: true, text: '일일 감량량 (kg)' } }
            }
        }, colors);
        updateChartHelper('weightSpeedScatter', ctx, config);
    }

    function updateMonthlyBoxPlotChart(colors) {
        if(AppState.records.length === 0) return;
        
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });

        const labels = Object.keys(months).sort();
        const barData = []; 
        const scatterData = []; 

        labels.forEach(m => {
            const arr = months[m];
            const min = Math.min(...arr);
            const max = Math.max(...arr);
            arr.sort((a,b)=>a-b);
            const median = arr[Math.floor(arr.length/2)];
            
            barData.push([min, max]);
            scatterData.push(median);
        });

        const ctx = document.getElementById('monthlyBoxPlotChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [
                {
                    type: 'bar',
                    label: '범위 (Min-Max)',
                    data: barData,
                    backgroundColor: 'rgba(33, 150, 243, 0.3)',
                    borderColor: colors.secondary,
                    borderWidth: 1,
                    barPercentage: 0.5
                },
                {
                    type: 'line',
                    label: '중앙값',
                    data: scatterData,
                    borderColor: colors.text,
                    backgroundColor: colors.text,
                    borderWidth: 0,
                    pointRadius: 4,
                    pointStyle: 'rectRot'
                }
            ]
        }, { scales: { y: { beginAtZero: false } } }, colors);

        updateChartHelper('boxPlot', ctx, config);
    }

    function updateRocChart(colors) {
        if(AppState.records.length < 2) return;
        const data = [];
        for(let i=1; i<AppState.records.length; i++) {
            data.push({
                x: AppState.records[i].date,
                y: MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight)
            });
        }

        const ctx = document.getElementById('rocChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: [{
                label: '일일 변화량 (kg)',
                data: data,
                borderColor: colors.text,
                borderWidth: 1,
                pointRadius: 1,
                segment: {
                    borderColor: ctx => ctx.p0.parsed.y > 0 ? colors.danger : colors.primary
                }
            }]
        }, {
            scales: { x: { type: 'time', time: { unit: 'day' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('roc', ctx, config);
    }

    function updateWaterfallChart(colors) {
        if(AppState.records.length < 2) return;
        const startW = AppState.records[0].weight;
        const currentW = AppState.records[AppState.records.length - 1].weight;
        const diff = currentW - startW;

        const data = [
            [0, startW],
            [startW, startW + diff],
            [0, currentW]
        ];

        const bgColors = [colors.secondary, diff < 0 ? colors.primary : colors.danger, colors.text];

        const ctx = document.getElementById('waterfallChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: ['시작 체중', '변화량', '현재 체중'],
            datasets: [{
                label: '체중 흐름',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 0
            }]
        }, {
            plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } } }
        }, colors);

        updateChartHelper('waterfall', ctx, config);
    }

    function updateSeasonalityChart(colors) {
        if(AppState.records.length === 0) return;
        
        const years = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const y = d.getFullYear();
            if(!years[y]) years[y] = [];
            const normalizedDate = new Date(2000, d.getMonth(), d.getDate());
            years[y].push({ x: normalizedDate, y: r.weight });
        });

        const datasets = Object.keys(years).map((y, idx) => {
            const colorList = [colors.primary, colors.secondary, colors.accent, colors.danger];
            return {
                label: y + '년',
                data: years[y],
                borderColor: colorList[idx % colorList.length],
                fill: false,
                tension: 0.3,
                pointRadius: 1
            };
        });

        const ctx = document.getElementById('seasonalityChart').getContext('2d');
        const config = createChartConfig('line', {
            datasets: datasets
        }, {
            scales: {
                x: { 
                    type: 'time', 
                    time: { unit: 'month', displayFormats: { month: 'MMM' } } 
                }
            }
        }, colors);

        updateChartHelper('seasonality', ctx, config);
    }

    function updateBellCurveChart(colors) {
        if(AppState.records.length < 2) return;
        const deltas = [];
        for(let i=1; i<AppState.records.length; i++) {
            deltas.push(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
        }

        const buckets = {};
        deltas.forEach(d => {
            const bucket = Math.round(d * 10) / 10;
            if(!buckets[bucket]) buckets[bucket] = 0;
            buckets[bucket]++;
        });

        const labels = Object.keys(buckets).sort((a,b)=>parseFloat(a)-parseFloat(b));
        const data = labels.map(l => buckets[l]);

        const ctx = document.getElementById('bellCurveChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '빈도수',
                data: data,
                backgroundColor: colors.secondary,
                borderRadius: 4
            }]
        }, {
            scales: { x: { title: { display: true, text: '일일 변동량 (kg)' } } },
            plugins: { legend: { display: false } }
        }, colors);

        updateChartHelper('bellCurve', ctx, config);
    }
    
    function updateRadarChart(colors) {
        if(AppState.records.length < 2) return;
        const lossSum = [0,0,0,0,0,0,0];
        const count = [0,0,0,0,0,0,0];
        const gainCount = [0,0,0,0,0,0,0];
        
        for(let i=1; i<AppState.records.length; i++) {
             const d = DateUtil.parse(AppState.records[i].date).getDay();
             const diff = AppState.records[i-1].weight - AppState.records[i].weight; // Loss
             lossSum[d] += diff;
             count[d]++;
             if(diff < -0.3) gainCount[d]++; // Significant gain
        }

        const avgLoss = lossSum.map((s,i) => count[i] ? s/count[i] : 0);
        const maxLoss = Math.max(...avgLoss.map(Math.abs));
        const normAvgLoss = avgLoss.map(v => v > 0 ? (v/maxLoss)*100 : 0); // Only show positive loss strength
        const freq = count.map(c => (c / Math.max(...count)) * 100);
        const overeat = gainCount.map((c, i) => count[i] ? (c / count[i]) * 100 : 0);

        const ctx = document.getElementById('radarChart').getContext('2d');
        const config = createChartConfig('radar', {
            labels: ['일','월','화','수','목','금','토'],
            datasets: [
                {
                    label: '평균 감량 강도',
                    data: normAvgLoss,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.2)'
                },
                {
                    label: '기록 빈도',
                    data: freq,
                    borderColor: colors.secondary,
                    backgroundColor: 'rgba(33, 150, 243, 0.2)'
                },
                {
                    label: '증량(과식) 비율',
                    data: overeat,
                    borderColor: colors.danger,
                    backgroundColor: 'rgba(244, 67, 54, 0.2)'
                }
            ]
        }, {
            scales: {
                r: {
                    angleLines: { color: colors.grid },
                    grid: { color: colors.grid },
                    pointLabels: { color: colors.text },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            }
        }, colors);
        updateChartHelper('radar', ctx, config);
    }

    function updateCandleStickChart(colors) {
        if(AppState.records.length < 2) return;
        
        const weeks = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay();
            const diff = d.getDate() - day + (day == 0 ? -6 : 1); // Monday
            const monday = new Date(d.setDate(diff));
            monday.setHours(0,0,0,0);
            const key = monday.getTime();
            if(!weeks[key]) weeks[key] = [];
            weeks[key].push(r.weight);
        });

        const labels = [];
        const data = [];
        const bgColors = [];

        Object.keys(weeks).sort().forEach(k => {
            const wData = weeks[k];
            const min = Math.min(...wData);
            const max = Math.max(...wData);
            const open = wData[0];
            const close = wData[wData.length-1];
            
            const d = new Date(parseInt(k));
            labels.push(DateUtil.format(d).substring(5)); // MM-DD
            data.push([min, max]); // Floating bar for Range
            bgColors.push(close < open ? colors.primary : colors.danger);
        });

        const ctx = document.getElementById('candleStickChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: labels,
            datasets: [{
                label: '주간 변동 범위 (Min-Max)',
                data: data,
                backgroundColor: bgColors,
                borderWidth: 1,
                borderColor: colors.text,
                barPercentage: 0.6
            }]
        }, {
             plugins: { 
                 legend: { display: false },
                 tooltip: {
                     callbacks: {
                         label: (ctx) => `범위: ${ctx.raw[0]} ~ ${ctx.raw[1]}`
                     }
                 }
            }
        }, colors);
        updateChartHelper('candleStick', ctx, config);
    }
    
    function updateMacdChart(colors) {
        if(AppState.records.length < 26) return;
        
        const prices = AppState.records.map(r => r.weight);
        const dates = AppState.records.map(r => r.date);
        
        const calcEma = (data, period) => {
            const k = 2 / (period + 1);
            let emaArr = [data[0]];
            for(let i=1; i<data.length; i++) {
                emaArr.push(data[i] * k + emaArr[i-1] * (1 - k));
            }
            return emaArr;
        };

        const ema12 = calcEma(prices, 12);
        const ema26 = calcEma(prices, 26);
        const macdLine = ema12.map((v, i) => v - ema26[i]);
        const signalLine = calcEma(macdLine, 9);
        const histogram = macdLine.map((v, i) => v - signalLine[i]);

        const sliceIdx = Math.max(0, prices.length - 60);
        
        const ctx = document.getElementById('macdChart').getContext('2d');
        const config = createChartConfig('bar', {
            labels: dates.slice(sliceIdx),
            datasets: [
                {
                    type: 'bar',
                    label: 'MACD Hist',
                    data: histogram.slice(sliceIdx),
                    backgroundColor: histogram.slice(sliceIdx).map(v => v < 0 ? colors.primary : colors.danger)
                },
                {
                    type: 'line',
                    label: 'MACD',
                    data: macdLine.slice(sliceIdx),
                    borderColor: colors.text,
                    borderWidth: 1,
                    pointRadius: 0
                },
                {
                    type: 'line',
                    label: 'Signal',
                    data: signalLine.slice(sliceIdx),
                    borderColor: colors.accent,
                    borderWidth: 1,
                    pointRadius: 0
                }
            ]
        }, { scales: { x: { display: false } } }, colors);
        updateChartHelper('macd', ctx, config);
    }

    function updateSeasonalSpiralChart(colors) {
        if(AppState.records.length === 0) return;
        const now = new Date();
        const thisYear = now.getFullYear();
        const lastYear = thisYear - 1;
        
        const getDataForYear = (y) => {
            const months = new Array(12).fill(null);
            AppState.records.forEach(r => {
                const d = DateUtil.parse(r.date);
                if(d.getFullYear() === y) {
                    const m = d.getMonth();
                    if(months[m] === null) months[m] = { sum: 0, count: 0 };
                    months[m].sum += r.weight;
                    months[m].count++;
                }
            });
            return months.map(m => m ? m.sum/m.count : null);
        };

        const dThis = getDataForYear(thisYear);
        const dLast = getDataForYear(lastYear);

        const ctx = document.getElementById('seasonalSpiralChart').getContext('2d');
        const config = createChartConfig('radar', {
            labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
            datasets: [
                {
                    label: `${thisYear}년`,
                    data: dThis,
                    borderColor: colors.primary,
                    backgroundColor: 'rgba(76, 175, 80, 0.2)'
                },
                {
                    label: `${lastYear}년`,
                    data: dLast,
                    borderColor: colors.secondary,
                    backgroundColor: 'rgba(33, 150, 243, 0.2)'
                }
            ]
        }, {
            scales: { r: { angleLines: { display: true }, grid: { circular: true } } }
        }, colors);
        updateChartHelper('seasonalSpiral', ctx, config);
    }
    
    // --- [NEW] 새로운 차트 함수들 ---
    
    function updateControlChart(colors) {
        if(AppState.records.length < 5) return;
        
        const weights = AppState.records.map(r => r.weight);
        const mean = MathUtil.mean(weights);
        const stdDev = MathUtil.stdDev(weights);
        const ucl = mean + (3 * stdDev);
        const lcl = mean - (3 * stdDev);
        
        const dates = AppState.records.map(r => r.date);

        const ctx = document.getElementById('controlChart').getContext('2d');
        const config = createChartConfig('line', {
            labels: dates,
            datasets: [
                {
                    label: '체중',
                    data: weights,
                    borderColor: colors.text,
                    pointRadius: 2,
                    borderWidth: 1,
                    fill: false
                },
                {
                    label: 'Mean',
                    data: new Array(weights.length).fill(mean),
                    borderColor: colors.accent,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'UCL (+3σ)',
                    data: new Array(weights.length).fill(ucl),
                    borderColor: colors.danger,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    borderWidth: 1
                },
                {
                    label: 'LCL (-3σ)',
                    data: new Array(weights.length).fill(lcl),
                    borderColor: colors.primary,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    borderWidth: 1
                }
            ]
        }, {
             plugins: { 
                 legend: { display: false },
                 tooltip: { intersect: false }
            },
            scales: { x: { display: false } }
        }, colors);
        
        updateChartHelper('controlChart', ctx, config);
    }
    
    function updateViolinChart(colors) {
        if(AppState.records.length === 0) return;
        
        const scatterData = [];
        
        AppState.records.forEach(r => {
             const d = DateUtil.parse(r.date);
             const monthStr = DateUtil.format(d).substring(0, 7); // YYYY-MM
             const jitter = (d.getDate() % 10 - 5) / 30; 
             
             scatterData.push({
                 x: monthStr, 
                 y: r.weight,
                 xOffset: jitter 
             });
        });
        
        const uniqueMonths = [...new Set(scatterData.map(d => d.x))].sort();
        const mappedData = scatterData.map(d => {
            const idx = uniqueMonths.indexOf(d.x);
            const jitter = (Math.random() - 0.5) * 0.6;
            return { x: idx + jitter, y: d.y, month: d.x };
        });
        
        const ctx = document.getElementById('violinChart').getContext('2d');
        const config = createChartConfig('scatter', {
            datasets: [{
                label: '체중 분포 (밀도)',
                data: mappedData,
                backgroundColor: 'rgba(33, 150, 243, 0.4)',
                borderColor: 'rgba(33, 150, 243, 0.8)',
                pointRadius: 3
            }]
        }, {
             scales: {
                 x: {
                     type: 'linear',
                     ticks: {
                         callback: function(val, index) {
                             if (Math.abs(val - Math.round(val)) < 0.1 && uniqueMonths[Math.round(val)]) {
                                 return uniqueMonths[Math.round(val)];
                             }
                             return '';
                         }
                     },
                     grid: { display: false }
                 }
             },
             plugins: {
                 tooltip: {
                     callbacks: {
                         label: (ctx) => `${ctx.raw.month}: ${ctx.raw.y}kg`
                     }
                 },
                 legend: { display: false }
             }
        }, colors);
        
        updateChartHelper('violinChart', ctx, config);
    }

    function updateGithubStyleCalendar() {
        const container = AppState.getEl('githubCalendarChart');
        if(!container || AppState.records.length === 0) return;
        
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        const deltaMap = {};
        let maxDelta = 0;
        let minDelta = 0;
        
        for(let i=1; i<AppState.records.length; i++) {
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            deltaMap[AppState.records[i].date] = diff;
            if(diff > maxDelta) maxDelta = diff;
            if(diff < minDelta) minDelta = diff;
        }

        const dayCells = [];
        let cursor = new Date(oneYearAgo);
        cursor.setDate(cursor.getDate() - cursor.getDay());
        
        const endDate = new Date();
        
        while(cursor <= endDate) {
            const dStr = DateUtil.format(cursor);
            const val = deltaMap[dStr];
            
            let color = 'var(--heatmap-empty)';
            let title = dStr;
            
            if(val !== undefined) {
                title += ` (${val > 0 ? '+' : ''}${val.toFixed(1)}kg)`;
                if(val > 0) color = 'var(--heatmap-gain)';
                else if(val <= -1.0) color = 'var(--heatmap-4)';
                else if(val <= -0.5) color = 'var(--heatmap-3)';
                else if(val <= -0.2) color = 'var(--heatmap-2)';
                else if(val < 0) color = 'var(--heatmap-1)';
            }
            
            dayCells.push(`<div style="width:10px; height:10px; background:${color}; border-radius:2px;" title="${title}"></div>`);
            cursor.setDate(cursor.getDate() + 1);
        }
        
        let html = `<div style="
            display: grid; 
            grid-template-rows: repeat(7, 1fr); 
            grid-auto-flow: column; 
            gap: 2px; 
            overflow-x: auto;
            padding-bottom: 5px;
        ">`;
        html += dayCells.join('');
        html += '</div>';
        
        container.innerHTML = html;
    }

    // --- [NEW] 차트 추가: Goal Tunnel ---
    function updateGoalTunnelChart(colors) {
        if(AppState.records.length === 0) return;
        const ctx = document.getElementById('goalTunnelChart').getContext('2d');
        const data = getFilteredData();
        if(data.length === 0) return;
        const startRec = data[0];
        const endRec = data[data.length-1];
        
        const startDate = DateUtil.parse(startRec.date);
        const endDate = DateUtil.parse(endRec.date);
        const days = DateUtil.daysBetween(startDate, endDate) || 1;
        
        // Ideal slope: 0.75% of start weight per week (example)
        const weeklyLoss = startRec.weight * 0.0075;
        const dailyLoss = weeklyLoss / 7;
        
        const idealPoints = [];
        const upperPoints = [];
        const lowerPoints = [];
        
        for(let i=0; i<=days + 30; i++) { // Project 30 days ahead
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const idealW = startRec.weight - (dailyLoss * i);
            idealPoints.push({ x: d, y: idealW });
            upperPoints.push({ x: d, y: idealW + 1.5 }); // Tolerance band
            lowerPoints.push({ x: d, y: idealW - 1.5 });
        }
        
        const actualPoints = data.map(r => ({ x: r.date, y: r.weight }));
        
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '체중',
                    data: actualPoints,
                    borderColor: colors.text,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: '이상적 경로',
                    data: idealPoints,
                    borderColor: colors.secondary,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 1
                },
                {
                    label: '허용 범위 상한',
                    data: upperPoints,
                    borderColor: 'transparent',
                    pointRadius: 0,
                    fill: '+1',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)'
                },
                {
                    label: '허용 범위 하한',
                    data: lowerPoints,
                    borderColor: 'transparent',
                    pointRadius: 0
                }
            ]
        }, {
             scales: { x: { type: 'time', time: { unit: 'month' } } },
             plugins: { legend: { display: false } }
        }, colors);
        updateChartHelper('goalTunnel', ctx, config);
    }

    // --- [NEW] 차트 추가: Drawdown ---
    function updateDrawdownChart(colors) {
        if(AppState.records.length === 0) return;
        const ctx = document.getElementById('drawdownChart').getContext('2d');
        
        const data = [];
        let maxW = 0;
        
        AppState.records.forEach(r => {
            if(r.weight > maxW) maxW = r.weight;
            const dd = ((r.weight - maxW) / maxW) * 100;
            data.push({ x: r.date, y: dd });
        });
        
        const config = createChartConfig('line', {
            datasets: [{
                label: '하락률 (%)',
                data: data,
                borderColor: colors.danger,
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                fill: true,
                pointRadius: 0,
                borderWidth: 1
            }]
        }, {
             scales: { 
                 x: { type: 'time' },
                 y: { ticks: { callback: (v) => v + '%' } }
             },
             plugins: { legend: { display: false } }
        }, colors);
        updateChartHelper('drawdown', ctx, config);
    }

    // --- [NEW] 차트 추가: LBM vs Fat Area ---
    function updateLbmFatAreaChart(colors) {
        const fatRecs = AppState.records.filter(r => r.fat);
        if(fatRecs.length < 2) return;
        const ctx = document.getElementById('lbmFatAreaChart').getContext('2d');
        
        const lbmPct = fatRecs.map(r => ({ x: r.date, y: 100 - r.fat }));
        const fatPct = fatRecs.map(r => ({ x: r.date, y: r.fat }));
        
        const config = createChartConfig('line', {
            datasets: [
                {
                    label: '제지방 %',
                    data: lbmPct,
                    backgroundColor: colors.primary,
                    fill: true,
                    pointRadius: 0
                },
                {
                    label: '체지방 %',
                    data: fatPct,
                    backgroundColor: colors.danger,
                    fill: true,
                    pointRadius: 0
                }
            ]
        }, {
             scales: { 
                 x: { type: 'time' },
                 y: { stacked: true, max: 100 } 
             },
             plugins: { legend: { display: true } }
        }, colors);
        updateChartHelper('lbmFatArea', ctx, config);
    }

    // --- [NEW] 차트 추가: Speedometer ---
    function updateSpeedometerChart(colors) {
        const ctx = document.getElementById('speedometerChart').getContext('2d');
        const s = AppState.state.statsCache;
        if(!s || !s.rate7) return; 
        
        const recs = AppState.records.slice(-8);
        let weeklyRatePct = 0;
        if(recs.length >= 2) {
             const start = recs[0];
             const end = recs[recs.length-1];
             const days = DateUtil.daysBetween(DateUtil.parse(start.date), DateUtil.parse(end.date));
             if(days > 0) {
                 const loss = start.weight - end.weight;
                 const pct = (loss / start.weight) * 100;
                 weeklyRatePct = (pct / days) * 7;
             }
        }
        
        const val = Math.max(0, Math.min(weeklyRatePct, 2));
        
        const config = {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0.5, 0.5, 1.0], 
                    backgroundColor: ['#e0e0e0', colors.primary, colors.danger],
                    borderWidth: 0
                }]
            },
            options: {
                circumference: 180,
                rotation: 270,
                cutout: '70%',
                responsive: true,
                plugins: {
                     tooltip: { enabled: false },
                     legend: { display: false }
                }
            },
            plugins: [{
                id: 'gaugeNeedle',
                afterDraw: (chart) => {
                     const { ctx, chartArea: { width, height } } = chart;
                     const cx = (chart.chartArea.left + chart.chartArea.right) / 2;
                     const cy = chart.chartArea.bottom; 
                     
                     const ratio = val / 2.0; 
                     const angle = Math.PI + (Math.PI * ratio);
                     
                     ctx.save();
                     ctx.translate(cx, cy - 20); 
                     ctx.rotate(angle);
                     ctx.beginPath();
                     ctx.moveTo(0, -5);
                     ctx.lineTo(height/1.5, 0);
                     ctx.lineTo(0, 5);
                     ctx.fillStyle = colors.text;
                     ctx.fill();
                     ctx.restore();
                     
                     ctx.font = "bold 16px sans-serif";
                     ctx.fillStyle = colors.text;
                     ctx.textAlign = "center";
                     ctx.fillText(weeklyRatePct.toFixed(2) + "% / 주", cx, cy);
                }
            }]
        };
        updateChartHelper('speedometer', ctx, config);
    }

    // --- 8. 테이블 & 히트맵 & 캘린더 & 뱃지 렌더링 (템플릿 사용 최적화) ---
    function renderHeatmap() {
        const container = AppState.getEl('heatmapGrid');
        if(AppState.records.length === 0) { container.innerHTML = ''; return; }

        const deltaMap = {};
        for(let i=1; i<AppState.records.length; i++) {
            const diff = MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight);
            deltaMap[AppState.records[i].date] = diff;
        }

        const end = new Date();
        const start = new Date(); start.setFullYear(start.getFullYear()-1);
        
        const fragment = document.createDocumentFragment();
        const template = DomUtil.getTemplate('template-heatmap-cell');

        for(let d=start; d<=end; d.setDate(d.getDate()+1)) {
            const dateStr = DateUtil.format(d);
            const clone = template.content.cloneNode(true);
            const div = clone.querySelector('.heatmap-cell');
            
            let levelClass = 'level-0';
            let titleText = dateStr;

            if(deltaMap[dateStr] !== undefined) {
                const val = deltaMap[dateStr];
                titleText += ` (${val>0?'+':''}${val.toFixed(1)}kg)`;
                
                if(val > 0) levelClass = 'level-gain';
                else if(val > -0.2) levelClass = 'level-1'; 
                else if(val > -0.5) levelClass = 'level-2'; 
                else if(val > -1.0) levelClass = 'level-3'; 
                else levelClass = 'level-4'; 
            }
            
            div.classList.add(levelClass);
            div.title = titleText;
            fragment.appendChild(clone);
        }
        DomUtil.clearAndAppend(container, fragment);
    }

    function changeCalendarMonth(offset) {
        const d = AppState.state.calendarViewDate;
        AppState.state.calendarViewDate = new Date(d.getFullYear(), d.getMonth() + offset, 1);
        renderCalendarView();
    }

    function jumpToCalendarDate() {
        const year = parseInt(document.getElementById('calYearSelect').value);
        const month = parseInt(document.getElementById('calMonthSelect').value);
        AppState.state.calendarViewDate = new Date(year, month, 1);
        renderCalendarView();
    }

	function renderCalendarView() {
        const container = AppState.getEl('calendarContainer');
        if(AppState.records.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-light);">데이터가 없습니다.</p>';
            return;
        }
        
        const viewDate = AppState.state.calendarViewDate;
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        const dayMap = {};
        AppState.records.forEach(r => {
            const rd = DateUtil.parse(r.date);
            if(rd.getFullYear() === year && rd.getMonth() === month) {
                dayMap[rd.getDate()] = r.weight;
            }
        });

        // [수정됨] onclick, onchange 제거 및 클래스 기반으로 변경
        let html = `<div class="calendar-header">
            <button class="cal-btn-prev">◀ 이전달</button>
            <div>
                <select id="calYearSelect">`;
        const currentYear = new Date().getFullYear();
        for(let y=currentYear-5; y<=currentYear+1; y++) {
            html += `<option value="${y}" ${y===year?'selected':''}>${y}년</option>`;
        }
        html += `</select>
                <select id="calMonthSelect">`;
        for(let m=0; m<12; m++) {
            html += `<option value="${m}" ${m===month?'selected':''}>${m+1}월</option>`;
        }
        html += `</select>
            </div>
            <button class="cal-btn-next">다음달 ▶</button>
        </div>`;
        
        html += `<div class="calendar-grid">`;
        
        const days = ['일','월','화','수','목','금','토'];
        days.forEach(d => html += `<div class="calendar-cell" style="font-weight:bold;background:var(--heatmap-empty);border:none;">${d}</div>`);
        
        for(let i=0; i<firstDay.getDay(); i++) html += `<div class="calendar-cell" style="background:transparent;border:none;"></div>`;
        
        for(let d=1; d<=lastDay.getDate(); d++) {
            const weight = dayMap[d];
            let cls = 'calendar-cell';
            let diffHtml = '';
            
            const currentDateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const targetIdx = AppState.records.findIndex(r => r.date === currentDateStr);
            
            if(targetIdx > 0 && AppState.records[targetIdx] && AppState.records[targetIdx-1]) {
                const currentW = AppState.records[targetIdx].weight;
                const prevW = AppState.records[targetIdx-1].weight;
                const diff = MathUtil.diff(currentW, prevW);
                if(diff > 0) cls += ' gain';
                if(diff < 0) cls += ' loss';
                diffHtml = `<div class="calendar-val">${diff>0?'+':''}${diff.toFixed(1)}</div>`;
            }

            html += `<div class="${cls}">
                <div class="calendar-date">${d}</div>
                <div class="calendar-val" style="font-weight:bold;">${weight ? weight : '-'}</div>
                ${diffHtml}
            </div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
    }
		
    function renderAllTables() {
        renderMonthlyTable();
        renderWeeklyTable();
        renderMilestoneTable();
        renderHistoryTable();
    }
    
    function renderResistanceTable() {
        const resistance = {}; 
        const support = {};    
        
        for(let i=1; i<AppState.records.length-1; i++) {
            const prev = AppState.records[i-1].weight;
            const curr = AppState.records[i].weight;
            const next = AppState.records[i+1].weight;
            
            const zone = Math.floor(curr);
            
            if(curr > prev && curr > next) {
                if(!resistance[zone]) resistance[zone] = 0;
                resistance[zone]++;
            }
            if(curr < prev && curr < next) {
                if(!support[zone]) support[zone] = 0;
                support[zone]++;
            }
        }
        
        const sortedRes = Object.keys(resistance).sort((a,b)=>resistance[b]-resistance[a]).slice(0,3);
        const sortedSup = Object.keys(support).sort((a,b)=>support[b]-support[a]).slice(0,3);
        
        let html = '';
        sortedRes.forEach(z => html += `<tr><td>🔼 저항선 (High)</td><td>${z}kg대</td><td>${resistance[z]}회 반등</td></tr>`);
        sortedSup.forEach(z => html += `<tr><td>🔽 지지선 (Low)</td><td>${z}kg대</td><td>${support[z]}회 지지</td></tr>`);
        
        if(!html) html = '<tr><td colspan="3">데이터 부족</td></tr>';
        
        const tbody = AppState.getEl('resistanceTableBody');
        if(tbody) tbody.innerHTML = html;
    }

    function renderWeekdayProbTable() {
        const gainCounts = [0,0,0,0,0,0,0];
        const totalCounts = [0,0,0,0,0,0,0];
        const dayNames = ['일','월','화','수','목','금','토'];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            totalCounts[d]++;
            if(diff > 0) gainCounts[d]++;
        }
        
        let html = '';
        dayNames.forEach((name, i) => {
            if(totalCounts[i] > 0) {
                const prob = ((gainCounts[i] / totalCounts[i]) * 100).toFixed(0);
                let risk = '';
                if(prob >= 60) risk = '<span class="text-danger">높음</span>';
                else if(prob <= 30) risk = '<span class="text-primary">낮음</span>';
                else risk = '보통';
                
                html += `<tr><td>${name}요일</td><td>${prob}%</td><td>${risk}</td></tr>`;
            }
        });
        
        if(!html) html = '<tr><td colspan="3">데이터 부족</td></tr>';
        
        const tbody = AppState.getEl('weekdayProbTableBody');
        if(tbody) tbody.innerHTML = html;
    }

    function renderNewTables() {
        if(AppState.records.length < 2) return;

        const zones = {};
        for(let i=1; i<AppState.records.length; i++) {
            const z = Math.floor(AppState.records[i].weight / 10) * 10;
            const key = z;
            if(!zones[key]) zones[key] = { days: 0, startDate: AppState.records[i].date, endDate: AppState.records[i].date };
            zones[key].days++;
            if(AppState.records[i].date > zones[key].endDate) zones[key].endDate = AppState.records[i].date;
        }
        let zRows = [];
        Object.keys(zones).sort().reverse().forEach(z => {
            const d = zones[z];
            const escapeTime = DateUtil.daysBetween(DateUtil.parse(d.startDate), DateUtil.parse(d.endDate));
            zRows.push(`<tr><td>${z}kg대</td><td>${d.days}일</td><td>${escapeTime}일</td></tr>`);
        });
        AppState.getEl('zoneReportTableBody').innerHTML = zRows.join('');

        const sprints = [];
        for(let i=0; i<AppState.records.length; i++) {
            const startW = AppState.records[i].weight;
            for(let j=i+1; j<Math.min(i+30, AppState.records.length); j++) {
                if(startW - AppState.records[j].weight >= 1.0) {
                    const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i].date), DateUtil.parse(AppState.records[j].date));
                    sprints.push({ days, start: AppState.records[i].date, end: AppState.records[j].date, loss: startW - AppState.records[j].weight });
                    break; 
                }
            }
        }
        sprints.sort((a,b) => a.days - b.days);
        const top5 = sprints.slice(0, 5);
        let sRows = top5.map((s, i) => `<tr><td>${i+1}위</td><td>${s.loss.toFixed(1)}kg</td><td>${s.days}일</td><td>${s.start}~${s.end}</td></tr>`);
        AppState.getEl('sprintTableBody').innerHTML = sRows.length ? sRows.join('') : '<tr><td colspan="4">데이터 부족</td></tr>';

        const dayWin = [0,0,0,0,0,0,0], dayTot = [0,0,0,0,0,0,0];
        const dayLoss = [0,0,0,0,0,0,0];
        const dayNames = ['일','월','화','수','목','금','토'];
        
        for(let i=1; i<AppState.records.length; i++) {
            const d = DateUtil.parse(AppState.records[i].date).getDay();
            const diff = AppState.records[i].weight - AppState.records[i-1].weight;
            dayTot[d]++;
            dayLoss[d] += diff;
            if(diff < 0) dayWin[d]++;
        }
        
        let gRows = [];
        dayNames.forEach((n, i) => {
            if(dayTot[i] > 0) {
                const avg = dayLoss[i] / dayTot[i];
                const win = (dayWin[i] / dayTot[i] * 100).toFixed(0);
                let grade = 'C';
                if(avg < -0.2 && win > 60) grade = 'A';
                else if(avg < 0) grade = 'B';
                else if(avg > 0.2) grade = 'D';
                else if(avg > 0.5) grade = 'F';
                
                gRows.push(`<tr><td>${n}요일</td><td>${avg.toFixed(2)}</td><td>${win}%</td><td>${grade}</td></tr>`);
            }
        });
        AppState.getEl('gradesTableBody').innerHTML = gRows.join('');
        
        renderTop5Table();
        renderMonthlyRateTable();
    }
    
    function renderTop5Table() {
        const drops = [], gains = [];
        let maxStreak = 0, curStreak = 0;
        
        for(let i=1; i<AppState.records.length; i++) {
             const diff = AppState.records[i].weight - AppState.records[i-1].weight;
             if(diff < 0) {
                 drops.push({ date: AppState.records[i].date, val: diff });
                 curStreak++;
             } else {
                 gains.push({ date: AppState.records[i].date, val: diff });
                 if(curStreak > maxStreak) maxStreak = curStreak;
                 curStreak = 0;
             }
        }
        if(curStreak > maxStreak) maxStreak = curStreak;
        
        drops.sort((a,b) => a.val - b.val);
        gains.sort((a,b) => b.val - a.val); 
        
        const topDrops = drops.slice(0, 5);
        const topGains = gains.slice(0, 5);
        
        let html = '';
        for(let i=0; i<5; i++) {
            html += `<tr>
                <td>${i+1}위</td>
                <td>${topDrops[i] ? topDrops[i].date + ' (' + topDrops[i].val.toFixed(1) + 'kg)' : '-'}</td>
                <td>${topGains[i] ? topGains[i].date + ' (+' + topGains[i].val.toFixed(1) + 'kg)' : '-'}</td>
                <td>${i===0 ? maxStreak + '일 연속' : '-'}</td>
            </tr>`;
        }
        AppState.getEl('top5TableBody').innerHTML = html;
    }

    function renderMonthlyRateTable() {
        const months = {};
        AppState.records.forEach((r, i) => {
            if(i===0) return;
            const k = r.date.substring(0, 7);
            if(!months[k]) months[k] = { success: 0, total: 0 };
            const diff = r.weight - AppState.records[i-1].weight;
            months[k].total++;
            if(diff < 0) months[k].success++;
        });
        
        let html = '';
        Object.keys(months).sort().reverse().forEach(m => {
            const d = months[m];
            const rate = d.total > 0 ? ((d.success / d.total) * 100).toFixed(0) : 0;
            html += `<tr><td>${m}</td><td>${d.success}일</td><td>${d.total}일</td><td>${rate}%</td></tr>`;
        });
        AppState.getEl('monthlyRateTableBody').innerHTML = html;
    }

    function renderMonthlyTable() {
        const months = {};
        AppState.records.forEach(r => {
            const key = r.date.substring(0, 7);
            if(!months[key]) months[key] = [];
            months[key].push(r.weight);
        });
        
        let rows = [];
        Object.keys(months).sort().reverse().forEach(m => {
            const arr = months[m];
            const start = arr[0];
            const end = arr[arr.length-1];
            const diff = MathUtil.diff(end, start);
            const avg = (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1);
            rows.push(`<tr><td>${DomUtil.escapeHtml(m)}</td><td>${start}</td><td>${end}</td><td class="${diff<=0?'neg':'pos'}">${diff}</td><td>${avg}</td></tr>`);
        });
        AppState.getEl('monthlyTableBody').innerHTML = rows.join('');
    }

    function renderWeeklyTable() {
        const weeks = {};
        AppState.records.forEach(r => {
            const d = DateUtil.parse(r.date);
            const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1); 
            const monday = new Date(d.setDate(diff));
            const key = DateUtil.format(monday);
            
            if(!weeks[key]) weeks[key] = [];
            weeks[key].push(r.weight);
        });

        let rows = [];
        Object.keys(weeks).sort().reverse().forEach(w => {
            const arr = weeks[w];
            const avg = (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1);
            const diff = MathUtil.diff(arr[arr.length-1], arr[0]);
            rows.push(`<tr><td>${DomUtil.escapeHtml(w)} 주</td><td>${avg}kg</td><td class="${diff<=0?'neg':'pos'}">${diff}</td></tr>`);
        });
        AppState.getEl('weeklyTableBody').innerHTML = rows.join('');
    }

    function renderMilestoneTable() {
        let rows = [];
        if(AppState.records.length > 0) {
            let currentInt = Math.floor(AppState.records[0].weight);
            let startDate = DateUtil.parse(AppState.records[0].date);
            
            for(let i=1; i<AppState.records.length; i++) {
                const w = Math.floor(AppState.records[i].weight);
                if(w < currentInt) {
                    const nowD = DateUtil.parse(AppState.records[i].date);
                    const days = Math.ceil((nowD - startDate)/(1000*3600*24));
                    rows.push(`<tr><td>🎉 ${w}kg대 진입</td><td>${DomUtil.escapeHtml(AppState.records[i].date)}</td><td>${days}일 소요</td></tr>`);
                    currentInt = w;
                    startDate = nowD;
                }
            }
        }
        AppState.getEl('milestoneTableBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">아직 기록된 마일스톤이 없습니다.</td></tr>';
    }

    function renderHistoryTable() {
        const container = AppState.getEl('historyList');
        const template = DomUtil.getTemplate('template-history-row');
        const fragment = document.createDocumentFragment();

        const rev = [...AppState.records].reverse();
        rev.forEach(r => {
            const idx = AppState.records.findIndex(o => o.date === r.date);
            let diffStr = '-';
            let cls = '';
            if(idx > 0) {
                const d = MathUtil.diff(r.weight, AppState.records[idx-1].weight);
                diffStr = (d>0?'+':'') + d.toFixed(1);
                cls = d>0?'pos':(d<0?'neg':'');
            }
            const fatStr = r.fat ? r.fat + '%' : '-';
            
            const clone = template.content.cloneNode(true);
            clone.querySelector('.history-date').textContent = r.date;
            clone.querySelector('.history-weight').textContent = r.weight + 'kg';
            clone.querySelector('.history-fat').textContent = fatStr;
            const diffCell = clone.querySelector('.history-diff');
            diffCell.textContent = diffStr;
            if(cls) diffCell.classList.add(cls);

            const btnEdit = clone.querySelector('button[data-action="edit"]');
            btnEdit.dataset.date = r.date;
            const btnDelete = clone.querySelector('button[data-action="delete"]');
            btnDelete.dataset.date = r.date;

            fragment.appendChild(clone);
        });
        DomUtil.clearAndAppend(container, fragment);
    }

	function renderBadges(s) {
        if(AppState.records.length === 0) return;
        const totalLost = MathUtil.diff(AppState.settings.startWeight, s.current);
        const streak = s.maxStreak || 0;

        const flags = {
            weekendDef: false,
            plateauBreak: false,
            bmiBreak: false,
            yoyoPrev: false,
            ottogi: false,
            recordGod: AppState.records.length >= 365,
            goldenCross: false,
            fatDestroyer: false,
            holidaySurvivor: false,
            returnProdigal: false,
            sniper: false,
            rollerCoaster: false,
            equanimity: false,
            plateauMaster: false,
            recordMaster: false,
            reborn: false,
            slowSteady: false,
            weightExpert: false,
            plateauDestroyer: false, 
            iconOfConstancy: false,
            bigStep: false,
            phoenix: false,
            weekendRuler: false,
            curiosity: false,
            timeTraveler: false,
            parking: false,
            whoosh: false,
            fullMoon: false,
            lucky7: false,
            ironWall: false,
            seasonality: false,
            decalcomania: false,
            cleaning: false,
            gyroDrop: false,
            weekendSniper: false,
            piMiracle: false,
            palindrome: false,
            anniversary: false,
            // v3.0.71 추가 Flags
            breakMaster: false,
            weekendVictory: false,
            maintainerQual: false,
            wallBreaker: false
        };

        if(AppState.records.length > 1) {
            if(Math.abs(s.current - AppState.settings.goal1) < 0.01) flags.sniper = true;

            for(let i=1; i<AppState.records.length; i++) {
                const diff = Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight));
                if(diff >= 1.5) {
                    const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                    if(days === 1) { flags.rollerCoaster = true; break; }
                }
            }

            if(AppState.records.length >= 7) {
                for(let i=6; i<AppState.records.length; i++) {
                    const slice = AppState.records.slice(i-6, i+1);
                    const diffs = [];
                    for(let j=1; j<slice.length; j++) diffs.push(Math.abs(slice[j].weight - slice[j-1].weight));
                    if(diffs.every(d => d <= 0.1)) { flags.equanimity = true; break; }
                }
            }

            for(let i=1; i<AppState.records.length; i++) {
                const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                if(days >= 15) { flags.returnProdigal = true; break; }
            }

            const holidays = ['12-25', '01-01', '01-29', '10-06']; 
            holidays.forEach(h => {
                const year = new Date().getFullYear();
                const hDate = DateUtil.parse(`${year}-${h}`);
                const around = AppState.records.filter(r => {
                    const rd = DateUtil.parse(r.date);
                    return Math.abs(DateUtil.daysBetween(rd, hDate)) <= 3;
                });
                if(around.length >= 2) {
                    const gain = around[around.length-1].weight - around[0].weight;
                    if(gain < 0.5) flags.holidaySurvivor = true;
                }
            });

            for(let i=0; i<AppState.records.length-1; i++) {
                const d1 = DateUtil.parse(AppState.records[i].date);
                if(d1.getDay() === 6) { 
                    const next = AppState.records.find(r => r.date > AppState.records[i].date); 
                    if(next && DateUtil.parse(next.date).getDay() === 1 && next.weight <= AppState.records[i].weight) {
                        flags.weekendDef = true; break;
                    }
                }
            }
            
            let stableDays = 0;
            for(let i=1; i<AppState.records.length; i++) {
                if(Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight)) < 0.2) stableDays++;
                else {
                    if(stableDays >= 7 && (AppState.records[i].weight < AppState.records[i-1].weight)) flags.plateauBreak = true;
                    stableDays = 0;
                }
            }

            const h = AppState.settings.height / 100;
            const bmiStart = AppState.settings.startWeight / (h*h);
            const bmiCurr = s.current / (h*h);
            const getCat = (b) => {
                if(b < CONFIG.BMI.UNDER) return 'Under';
                if(b < CONFIG.BMI.NORMAL_END) return 'Normal';
                if(b < CONFIG.BMI.PRE_OBESE_END) return 'PreObese';
                if(b < CONFIG.BMI.OBESE_1_END) return 'Obese1';
                if(b < CONFIG.BMI.OBESE_2_END) return 'Obese2';
                return 'Obese3';
            };
            if(getCat(bmiStart) !== getCat(bmiCurr)) flags.bmiBreak = true;

            if(s.current <= AppState.settings.goal1) {
                const recent = AppState.records.slice(-10);
                if(recent.length >= 10 && recent.every(r => Math.abs(r.weight - AppState.settings.goal1) <= 0.5)) flags.yoyoPrev = true;
            }

            for(let i=0; i<AppState.records.length-3; i++) {
                if(MathUtil.diff(AppState.records[i+1].weight, AppState.records[i].weight) >= 0.5) {
                    if(AppState.records[i+3].weight <= AppState.records[i].weight) flags.ottogi = true;
                }
            }

            if(AppState.records.length > 30) {
                const last7 = AppState.records.slice(-7).reduce((a,b)=>a+b.weight,0)/7;
                const last30 = AppState.records.slice(-30).reduce((a,b)=>a+b.weight,0)/30;
                if(last7 < last30 - 0.5) flags.goldenCross = true;
            }

            if(s.lastRec && s.lastRec.fat && s.lastRec.fat < 25) { 
                flags.fatDestroyer = true;
            }

            stableDays = 0;
            for(let i=1; i<AppState.records.length; i++) {
                if(Math.abs(MathUtil.diff(AppState.records[i].weight, AppState.records[i-1].weight)) < 0.2) stableDays++;
                else {
                    if(stableDays >= 7 && (MathUtil.diff(AppState.records[i-1].weight, AppState.records[i].weight) >= 0.5)) flags.plateauMaster = true;
                    stableDays = 0;
                }
            }

            if(streak >= 90) flags.recordMaster = true;

            if(s.max - s.current >= 10) flags.reborn = true;

            if(AppState.records.length >= 90) {
                const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth()-3);
                const recs = AppState.records.filter(r => DateUtil.parse(r.date) >= threeMonthsAgo);
                if(recs.length > 0) {
                    const loss = MathUtil.diff(recs[0].weight, s.current);
                    const avgLoss = loss / 3;
                    if(avgLoss > 0 && avgLoss <= 2) flags.slowSteady = true;
                }
            }

            if(AppState.records.length >= 30) {
                const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth()-1);
                const rec = AppState.records.find(r => DateUtil.parse(r.date) >= oneMonthAgo);
                if(rec && (rec.weight - s.current >= 4)) flags.weightExpert = true;
            }

            if(s.maxPlateau >= 14 && s.current < s.lastRec.weight) flags.plateauDestroyer = true;

            if(streak >= 180) flags.iconOfConstancy = true;

            for(let i=1; i<AppState.records.length; i++) {
                const days = DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date));
                if(days === 1 && AppState.records[i-1].weight - AppState.records[i].weight >= 1.0) {
                    flags.bigStep = true; break;
                }
            }

            let localMin = 999;
            let rebound = false;
            for(let i=0; i<AppState.records.length-1; i++) {
                if(AppState.records[i].weight < localMin) localMin = AppState.records[i].weight;
                if(localMin < 900 && AppState.records[i].weight > localMin + 3.0) rebound = true;
            }
            if(rebound && s.current < localMin) flags.phoenix = true;

            for(let i=0; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight < friRec.weight) {
                         flags.weekendRuler = true; break;
                     }
                 }
            }

            let noFatStreak = 0;
            for(let i=0; i<AppState.records.length; i++) {
                if(!AppState.records[i].fat) noFatStreak++;
                else {
                    if(noFatStreak >= 10) { 
                        let recordedStreak = 0;
                        for(let j=i; j<Math.min(i+10, AppState.records.length); j++) {
                            if(AppState.records[j].fat) recordedStreak++;
                            else break;
                        }
                        if(recordedStreak >= 10) { flags.curiosity = true; break; }
                    }
                    noFatStreak = 0;
                }
            }

            const rem = s.current - AppState.settings.goal1;
            if(rem > 0 && AppState.records.length > 30) {
                const totalDays = DateUtil.daysBetween(DateUtil.parse(AppState.records[0].date), DateUtil.parse(s.lastRec.date));
                const totalSpeed = (AppState.records[0].weight - s.current) / totalDays;
                
                const recentRec = AppState.records[AppState.records.length-15]; 
                if(recentRec) {
                    const recentDays = DateUtil.daysBetween(DateUtil.parse(recentRec.date), DateUtil.parse(s.lastRec.date));
                    const recentSpeed = (recentRec.weight - s.current) / recentDays;
                    
                    if(totalSpeed > 0 && recentSpeed > 0) {
                        const daysTotal = rem / totalSpeed;
                        const daysRecent = rem / recentSpeed;
                        if(daysTotal - daysRecent >= 10) flags.timeTraveler = true;
                    }
                }
            }

            if(AppState.records.length >= 14) {
                 const recs14 = AppState.records.slice(-14);
                 const w14 = recs14.map(r => r.weight);
                 if(Math.max(...w14) - Math.min(...w14) <= 0.6) flags.parking = true;
            }

            let plat = 0;
            for(let i=1; i<AppState.records.length; i++) {
                if(Math.abs(AppState.records[i].weight - AppState.records[i-1].weight) < 0.2) plat++;
                else {
                    if(plat >= 3 && AppState.records[i-1].weight - AppState.records[i].weight >= 0.8) flags.whoosh = true;
                    plat = 0;
                }
            }

            let consec = 0;
            for(let i=1; i<AppState.records.length; i++) {
                if(DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date)) === 1) consec++;
                else consec = 0;
                if(consec >= 30) flags.fullMoon = true;
            }

            if(s.current.toString().endsWith('.7') || s.current.toString().endsWith('.77')) flags.lucky7 = true;

            if(s.max - s.current >= 0.5) { 
                for(let i=1; i<AppState.records.length; i++) {
                     if(Math.abs(AppState.records[i].weight - s.max) < 0.5 && AppState.records[i].weight > AppState.records[i+1].weight) {
                         flags.ironWall = true; break;
                     }
                }
            }

            const seasons = new Set();
            AppState.records.forEach(r => {
                const m = DateUtil.parse(r.date).getMonth() + 1;
                if(m===3) seasons.add('Spring');
                if(m===6) seasons.add('Summer');
                if(m===9) seasons.add('Autumn');
                if(m===12) seasons.add('Winter');
            });
            if(seasons.size === 4) flags.seasonality = true;

            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i].weight === AppState.records[i-1].weight &&
                   DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date)) === 1) {
                    flags.decalcomania = true; break;
                }
            }

            if(s.fatChange < 0 && s.fatChange < totalLost * -1) flags.cleaning = true; 

            for(let i=1; i<AppState.records.length; i++) {
                if(AppState.records[i-1].weight - AppState.records[i].weight >= 1.0 && 
                   DateUtil.daysBetween(DateUtil.parse(AppState.records[i-1].date), DateUtil.parse(AppState.records[i].date)) === 1) {
                    flags.gyroDrop = true; break;
                }
            }

            for(let i=0; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight < friRec.weight) {
                         flags.weekendSniper = true; break;
                     }
                 }
            }

            if(Math.abs(totalLost - 3.14) < 0.05 || s.current.toString().endsWith('.14') || s.current.toString().endsWith('3.14')) {
                flags.piMiracle = true;
            }

            if (s.current.toString() === s.current.toString().split('').reverse().join('')) {
                flags.palindrome = true;
            }
            
            const totalDays = DateUtil.daysBetween(DateUtil.parse(AppState.records[0].date), DateUtil.parse(AppState.records[AppState.records.length-1].date)) + 1;
            if (totalDays === 100 || totalDays === 365 || totalDays === 1000) {
                flags.anniversary = true;
            }

            // v3.0.71 추가 Flags Logic
            
            // Break Master
            for(let i=1; i<AppState.records.length-1; i++) {
                const surge = AppState.records[i].weight - AppState.records[i-1].weight;
                if(surge >= 0.5) {
                    const next = AppState.records[i+1].weight;
                    const recovery = AppState.records[i].weight - next;
                    if(recovery >= surge * 0.5) { flags.breakMaster = true; break; }
                }
            }
            
            // Weekend Victory
            for(let i=1; i<AppState.records.length; i++) {
                 const d = DateUtil.parse(AppState.records[i].date);
                 if(d.getDay() === 1) { 
                     const prevFriDate = new Date(d); prevFriDate.setDate(d.getDate()-3);
                     const prevFriStr = DateUtil.format(prevFriDate);
                     const friRec = AppState.records.find(r => r.date === prevFriStr);
                     if(friRec && AppState.records[i].weight <= friRec.weight) {
                         flags.weekendVictory = true; break;
                     }
                 }
            }

            // Maintainer Qual
            if(AppState.records.length >= 10) {
                for(let i=9; i<AppState.records.length; i++) {
                    const slice = AppState.records.slice(i-9, i+1).map(r=>r.weight);
                    const maxS = Math.max(...slice);
                    const minS = Math.min(...slice);
                    if(maxS - minS <= 0.4) { flags.maintainerQual = true; break; } 
                }
            }
            
            // Wall Breaker
            const zoneCounts = {};
            AppState.records.forEach(r => {
                const z = Math.floor(r.weight);
                if(!zoneCounts[z]) zoneCounts[z] = 0;
                zoneCounts[z]++;
            });
            const frequentZone = Object.keys(zoneCounts).sort((a,b)=>zoneCounts[b]-zoneCounts[a])[0];
            if(frequentZone && s.current < parseInt(frequentZone)) flags.wallBreaker = true;

        }

        const badgeConditions = {
            start: AppState.records.length >= 1,
            holiday: flags.holidaySurvivor,
            zombie: flags.returnProdigal,
            sniper: flags.sniper,
            coaster: flags.rollerCoaster,
            zen: flags.equanimity,
            loss3: totalLost >= 3,
            loss5: totalLost >= 5,
            loss10: totalLost >= 10,
            streak3: streak >= 3,
            streak7: streak >= 7,
            digit: Math.floor(s.current/10) < Math.floor(AppState.settings.startWeight/10),
            goal: s.current <= AppState.settings.goal1,
            weekend: flags.weekendDef,
            plateau: flags.plateauBreak,
            bmi: flags.bmiBreak,
            yoyo: flags.yoyoPrev,
            ottogi: flags.ottogi,
            recordGod: flags.recordGod,
            goldenCross: flags.goldenCross,
            fatDestroyer: flags.fatDestroyer,
            plateauMaster: flags.plateauMaster,
            recordMaster: flags.recordMaster,
            reborn: flags.reborn,
            slowSteady: flags.slowSteady,
            weightExpert: flags.weightExpert,
            plateauDestroyer: flags.plateauDestroyer,
            iconOfConstancy: flags.iconOfConstancy,
            bigStep: flags.bigStep,
            phoenix: flags.phoenix,
            weekendRuler: flags.weekendRuler,
            curiosity: flags.curiosity,
            timeTraveler: flags.timeTraveler,
            parking: flags.parking,
            whoosh: flags.whoosh,
            fullMoon: flags.fullMoon,
            lucky7: flags.lucky7,
            ironWall: flags.ironWall,
            seasonality: flags.seasonality,
            decalcomania: flags.decalcomania,
            cleaning: flags.cleaning,
            gyroDrop: flags.gyroDrop,
            weekendSniper: flags.weekendSniper,
            piMiracle: flags.piMiracle,
            palindrome: flags.palindrome,
            anniversary: flags.anniversary,
            // v3.0.71 추가 Badge conditions
            breakMaster: flags.breakMaster,
            weekendVictory: flags.weekendVictory,
            maintainerQual: flags.maintainerQual,
            wallBreaker: flags.wallBreaker
        };

        const container = AppState.getEl('badgeGrid');
        const template = DomUtil.getTemplate('template-badge-item');
        const fragment = document.createDocumentFragment();

        CONFIG.BADGES.forEach(b => {
            const isUnlocked = badgeConditions[b.id];
            
            const clone = template.content.cloneNode(true);
            const item = clone.querySelector('.badge-item');
            
            if(isUnlocked) item.classList.add('unlocked');
            item.title = `${b.desc} (${isUnlocked ? '획득 완료' : '미획득'})`;
            clone.querySelector('.badge-icon').textContent = b.icon;
            clone.querySelector('.badge-name').textContent = b.name;
            
            fragment.appendChild(clone);
        });
        DomUtil.clearAndAppend(container, fragment);
    }
	
	
    function switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        AppState.getEl(tabId).style.display = 'block';
        
        document.querySelectorAll('.filter-group button[id^="tab-btn"]').forEach(b => b.classList.remove('active'));
        if(tabId.includes('monthly') && !tabId.includes('rate')) AppState.getEl('tab-btn-monthly').classList.add('active');
        if(tabId.includes('weekly')) AppState.getEl('tab-btn-weekly').classList.add('active');
        if(tabId.includes('milestone')) AppState.getEl('tab-btn-milestone').classList.add('active');
        if(tabId.includes('history')) AppState.getEl('tab-btn-history').classList.add('active');
        if(tabId.includes('zone')) AppState.getEl('tab-btn-zone').classList.add('active');
        if(tabId.includes('sprint')) AppState.getEl('tab-btn-sprint').classList.add('active');
        if(tabId.includes('grades')) AppState.getEl('tab-btn-grades').classList.add('active');
        if(tabId.includes('top5')) AppState.getEl('tab-btn-top5').classList.add('active');
        if(tabId.includes('monthly-rate')) AppState.getEl('tab-btn-monthly-rate').classList.add('active');
    }

    function toggleChartExpand(btn) {
        const card = btn.closest('.card');
        const backdrop = AppState.getEl('chartBackdrop');
        const isExpanded = card.classList.contains('expanded-card');

        if (!isExpanded) {
            closeAllExpands();
        }

        card.classList.toggle('expanded-card');
        
        if (card.classList.contains('expanded-card')) {
            btn.innerText = '✖'; 
            btn.style.color = 'var(--danger)';
            backdrop.classList.add('active');
            document.body.style.overflow = 'hidden'; 
        } else {
            btn.innerText = '⛶'; 
            btn.style.color = '';
            backdrop.classList.remove('active');
            document.body.style.overflow = '';
        }

        setTimeout(() => {
            const canvas = card.querySelectorAll('canvas');
            canvas.forEach(cvs => {
                const chartInstance = Chart.getChart(cvs);
                if(chartInstance) chartInstance.resize();
            });
        }, 50);
    }

    function closeAllExpands() {
        const expandedCards = document.querySelectorAll('.expanded-card');
        const backdrop = AppState.getEl('chartBackdrop');
        
        expandedCards.forEach(card => {
            card.classList.remove('expanded-card');
            const btn = card.querySelector('.expand-btn');
            if(btn) {
                btn.innerText = '⛶';
                btn.style.color = '';
            }
        });
        
        if(backdrop) backdrop.classList.remove('active');
        document.body.style.overflow = '';
        
        setTimeout(() => {
            expandedCards.forEach(card => {
                const canvas = card.querySelectorAll('canvas');
                canvas.forEach(cvs => {
                    const chartInstance = Chart.getChart(cvs);
                    if(chartInstance) chartInstance.resize();
                });
            });
        }, 50);
    }

    // 전역 스코프에 API 노출 (모듈 패턴)
    window.App = {
        init,
        toggleDarkMode,
        toggleSettings,
        saveSettings,
        addRecord,
        editRecord, 
        deleteRecord, 
        safeResetData,
        importJSON,
        importCSV,
        exportCSV,
        exportJSON,
        setChartFilter,
        applyCustomDateRange,
        updateMainChart,
        toggleBadges,
        changeCalendarMonth,
        jumpToCalendarDate,
        switchTab,
        toggleChartExpand,
        closeAllExpands,
        
        enableInlineEdit: function(date) {
            const btn = document.querySelector(`button[data-date="${date}"][data-action="edit"]`);
            if(!btn) return;
            const tr = btn.closest('tr');
            const record = AppState.records.find(r => r.date === date);
            if(!record) return;

            tr.cells[1].innerHTML = `<input type="number" class="inline-input" id="inline-weight-${date}" value="${record.weight}" step="0.1">`;
            tr.cells[2].innerHTML = `<input type="number" class="inline-input" id="inline-fat-${date}" value="${record.fat || ''}" step="0.1">`;
            tr.cells[3].innerText = '-';
            tr.cells[4].innerHTML = `
                <button data-action="save-inline" data-date="${date}" class="inline-btn" title="저장">💾</button>
                <button data-action="cancel-inline" class="inline-btn" title="취소">❌</button>
            `;
        },

        saveInlineEdit: function(date) {
            const wInput = document.getElementById(`inline-weight-${date}`);
            const fInput = document.getElementById(`inline-fat-${date}`);
            
            if(!wInput) return;
            
            const newWeight = parseFloat(wInput.value);
            const newFat = parseFloat(fInput.value);
            
            if (isNaN(newWeight) || newWeight < CONFIG.LIMITS.MIN_WEIGHT || newWeight > CONFIG.LIMITS.MAX_WEIGHT) {
                return showToast(`유효한 체중을 입력해주세요 (${CONFIG.LIMITS.MIN_WEIGHT}~${CONFIG.LIMITS.MAX_WEIGHT}kg).`);
            }
            if (!isNaN(newFat) && (newFat < CONFIG.LIMITS.MIN_FAT || newFat > CONFIG.LIMITS.MAX_FAT)) {
                 return showToast(`유효한 체지방률을 입력해주세요 (${CONFIG.LIMITS.MIN_FAT}~${CONFIG.LIMITS.MAX_FAT}%).`);
            }

            const recordIndex = AppState.records.findIndex(r => r.date === date);
            if(recordIndex >= 0) {
                AppState.records[recordIndex].weight = MathUtil.round(newWeight);
                if(!isNaN(newFat)) AppState.records[recordIndex].fat = MathUtil.round(newFat);
                else delete AppState.records[recordIndex].fat; 
                
                AppState.state.isDirty = true;
                debouncedSaveRecords();
                updateUI();
                showToast('수정되었습니다.');
            }
        },

        cancelInlineEdit: function() {
            updateUI(); 
        }
    };

    window.onload = init;

})();