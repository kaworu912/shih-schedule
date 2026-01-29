// =========== 設定與常數區 ===========
let READ_ONLY_MODE = true; 

// ★★★ 請確認您的 Google Apps Script 網址是否正確 ★★★
const API_URL = "https://script.google.com/macros/s/AKfycbwFP4cx-sNYfO8NrP55kK4PI6BeGMl7VylGThNt1AntGo9B-N-XDe1ZqTlusciXVMf-0Q/exec"; 

const ANCHOR_DATE = new Date(2025, 11, 14); 
const BASE_YEAR = 2025;
const BASE_MONTH = 11; 

// 狀態變數
let CURRENT_DISPLAY_GROUP = ''; 
let CURRENT_USER = null; 
let VIEWING_MODE_USER = null;
let IS_SHOWING_BACKUPS = false;
let currentMonthIndex = 0; 
let userOverrides = {}; 

const KEY_RESERVED_PREFIX = 'stats_reserved_'; 
const KEY_LEAVE_CONFIG = 'config_leave_limits'; 

// 班表循環設定
const CYCLE_CONFIG = [
    { isWork: true,  text: '上班' }, { isWork: false, text: '休假' },  
    { isWork: true,  text: '上班' }, { isWork: false, text: '休假' },  
    { isWork: false, text: '休假' }, { isWork: false, text: '休假' }         
];
const SHIFT_CODES = ['甲12', '乙12', '甲23', '乙23', '甲31', '乙31'];
const TOTAL_CYCLE_DAYS = CYCLE_CONFIG.length; 
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const SYSTEM_TODAY = new Date(); 
const GROUP_OFFSETS = { '甲2': 0, '乙2': 1, '甲3': 2, '乙3': 3, '甲1': 4, '乙1': 5 };

// 休假類別定義 (更新：事假32, 新增最低休假24)
const LEAVE_TYPES = {
    'annual':    { label: '特休',    default: 0,  color: 'annual' },
    'personal':  { label: '事假',    default: 32, color: 'personal' }, // 改為 32
    'psych':     { label: '身心假',  default: 24, color: 'psych' },
    'min_leave': { label: '最低休假', default: 24, color: 'min_leave' } // 新增
};

// 排班規則定義
const OVERRIDE_RULES = {
    'work_day':   { label: '日勤', wk: 8, sb: 2, type: 'base' },
    'work_night': { label: '夜勤', wk: 8, sb: 2, type: 'base' },
    'add_day':    { label: '所加日', wk: 8, sb: 2, type: 'add' }, 
    'add_night':  { label: '所加夜', wk: 8, sb: 2, type: 'add' },
    'add_full':   { label: '所加全', wk: 16, sb: 4, type: 'add' }, 
    'hosp_day':   { label: '醫加日', wk: 8, sb: 2, type: 'add' },  
    'hosp_night': { label: '醫加夜', wk: 8, sb: 6, type: 'add' },  
    'hosp_full':  { label: '醫全日', wk: 24, sb: 0, type: 'add' }, 
    'off_day':    { label: '日休', wk: -8, sb: -1, type: 'off' }, 
    'off_night':  { label: '夜休', wk: -8, sb: -1, type: 'off' }, 
    'comp_leave': { label: '補休', wk: -16, sb: -4, type: 'off' } // 兼容舊版
};

// =========== 初始化與工具函式 ===========

function getMonthData(index) {
    let targetDate = new Date(BASE_YEAR, BASE_MONTH + index, 1);
    return { year: targetDate.getFullYear(), month: targetDate.getMonth(), label: `${targetDate.getFullYear()}/${String(targetDate.getMonth() + 1).padStart(2, '0')}` };
}
function calculateIndexFromDate(date) { return (date.getFullYear() - BASE_YEAR) * 12 + (date.getMonth() - BASE_MONTH); }
function formatDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

function jumpToToday() {
    const now = new Date();
    const index = calculateIndexFromDate(now);
    currentMonthIndex = (index < 0) ? 0 : index;
    refreshCurrentPage();
}

function changeMonth(step) { 
    const nextIndex = currentMonthIndex + step; 
    if (nextIndex >= 0) { 
        currentMonthIndex = nextIndex; 
        refreshCurrentPage(); 
    } 
}

function getDayInfo(date) {
    if (date < new Date(2025, 11, 1)) return null;
    const diffTime = date - ANCHOR_DATE; 
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    let globalIndex = diffDays % TOTAL_CYCLE_DAYS;
    if (globalIndex < 0) globalIndex += TOTAL_CYCLE_DAYS;
    
    let userGroup = CURRENT_DISPLAY_GROUP || '甲2'; 
    let offset = GROUP_OFFSETS[userGroup];
    if (offset === undefined) offset = 0;
    
    let personalIndex = (globalIndex - offset) % TOTAL_CYCLE_DAYS;
    if (personalIndex < 0) personalIndex += TOTAL_CYCLE_DAYS;
    
    return { ...CYCLE_CONFIG[personalIndex], shiftCode: SHIFT_CODES[globalIndex] };
}

function calculateDayStats(dayInfo, overrideString) {
    let normal = dayInfo.isWork ? 16 : 0; 
    let overtime = 0; 
    let standby = dayInfo.isWork ? 4 : 0;
    let labels = [];

    if (!overrideString) return { normal, overtime, sb: standby, labels };

    const items = overrideString.split(',');
    
    // 先處理 Base
    items.forEach(item => {
        if (OVERRIDE_RULES[item] && OVERRIDE_RULES[item].type === 'base') {
            normal = OVERRIDE_RULES[item].wk;
            standby = OVERRIDE_RULES[item].sb;
            labels.push(OVERRIDE_RULES[item].label);
        }
    });

    // 再處理 Add/Off/Complex
    items.forEach(item => {
        if (OVERRIDE_RULES[item] && OVERRIDE_RULES[item].type === 'base') return; 

        if (OVERRIDE_RULES[item]) {
            const r = OVERRIDE_RULES[item];
            if (r.type === 'add') { overtime += r.wk; standby += r.sb; labels.push(r.label); }
            else if (r.type === 'off') { normal += r.wk; standby += r.sb; labels.push(r.label); }
        }
        else if (item.includes('|')) {
            const parts = item.split('|'); 
            const type = parts[0];
            const subtype = parts[1];
            const hours = parseFloat(parts[2]) || 0;

            if (type === 'leave') {
                normal -= hours;
                let labelText = LEAVE_TYPES[subtype] ? LEAVE_TYPES[subtype].label : subtype;
                labels.push(`${labelText}${hours}h`);
            } else if (type === 'comp') {
                normal -= hours;
                labels.push(`補休${hours}h`);
            }
        }
    });

    if (normal < 0) normal = 0; if (overtime < 0) overtime = 0; if (standby < 0) standby = 0;
    return { normal, overtime, sb: standby, labels };
}

// =========== 認證與登入邏輯 ===========

function checkAuth() {
    const savedUser = localStorage.getItem('shifts_user');
    const savedGroup = localStorage.getItem('shifts_group');
    
    if (savedUser && savedGroup) {
        CURRENT_USER = { username: savedUser, group: savedGroup };
        CURRENT_DISPLAY_GROUP = savedGroup; 
        document.getElementById('authModal').style.display = 'none';
        updateUserInfoUI();
        loadOverrides(); 
    } else {
        document.getElementById('authModal').style.display = 'flex';
        document.getElementById('loginUser').value = ''; 
        document.getElementById('loginPass').value = ''; 
    }
}

function switchAuthMode(mode) {
    const loginForm = document.getElementById('loginForm');
    const regForm = document.getElementById('registerForm');
    const tabs = document.querySelectorAll('.auth-tab');
    if (mode === 'login') {
        loginForm.style.display = 'block'; regForm.style.display = 'none';
        tabs[0].classList.add('active'); tabs[1].classList.remove('active');
    } else {
        loginForm.style.display = 'none'; regForm.style.display = 'block';
        tabs[0].classList.remove('active'); tabs[1].classList.add('active');
    }
}

async function doLogin() {
    const u = document.getElementById('loginUser').value.trim();
    const p = document.getElementById('loginPass').value.trim();
    if(!u || !p) { alert("請輸入完整"); return; }
    
    const btn = document.querySelector('#loginForm button');
    const oldText = btn.innerText; btn.innerText = "登入中..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}?action=login&username=${u}&password=${p}`);
        const json = await res.json();
        
        if (json.result === 'success') {
            CURRENT_USER = json.user;
            localStorage.setItem('shifts_user', CURRENT_USER.username);
            localStorage.setItem('shifts_group', CURRENT_USER.group);
            CURRENT_DISPLAY_GROUP = CURRENT_USER.group;
            
            userOverrides = json.data;
            document.getElementById('authModal').style.display = 'none';
            updateUserInfoUI();
            jumpToToday();
            setAppMode(false);
        } else {
            alert("登入失敗：" + json.message);
        }
    } catch(e) { console.error(e); alert("網路錯誤"); } 
    finally { btn.innerText = oldText; btn.disabled = false; }
}

async function doRegister() {
    const u = document.getElementById('regUser').value.trim();
    const p = document.getElementById('regPass').value.trim();
    const g = document.getElementById('regGroup').value;
    if(!u || !p) { alert("請輸入完整"); return; }
    const btn = document.querySelector('#registerForm button');
    btn.innerText = "註冊中..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}?action=register&username=${u}&password=${p}&group=${g}`);
        const json = await res.json();
        if (json.result === 'success') {
            alert("註冊成功！請使用新帳號登入。");
            switchAuthMode('login');
            document.getElementById('loginUser').value = u;
        } else { alert("註冊失敗：" + json.message); }
    } catch(e) { alert("網路錯誤"); } 
    finally { btn.innerText = "註冊帳號"; btn.disabled = false; }
}

function doLogout() {
    if(confirm("確定要登出嗎？")) {
        localStorage.removeItem('shifts_user');
        localStorage.removeItem('shifts_group');
        location.reload();
    }
}

function updateUserInfoUI() {
    const display = document.getElementById('userInfoDisplay');
    if(display && CURRENT_USER) {
        display.innerText = `${CURRENT_USER.username} (${CURRENT_USER.group})`;
    }
}

function toggleUserMenu() {
    const menu = document.getElementById('userDropdown');
    if (menu) menu.classList.toggle('show');
}
window.addEventListener('click', function(e) {
    const container = document.querySelector('.user-menu-container');
    if (container && !container.contains(e.target)) {
        const menu = document.getElementById('userDropdown');
        if (menu) menu.classList.remove('show');
    }
});

// =========== 資料存取 ===========

async function loadOverrides(targetUsername = null) {
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    
    const userToFetch = targetUsername || CURRENT_USER.username;
    try {
        const response = await fetch(`${API_URL}?action=read&username=${userToFetch}`);
        const data = await response.json();
        
        if (data.result === 'account_deleted') {
            if (targetUsername) {
                alert(`使用者 "${targetUsername}" 已不存在。`);
                exitViewMode(); return;
            } else {
                alert("⚠️ 您的帳號已被刪除，請重新註冊！");
                localStorage.removeItem('shifts_user'); localStorage.removeItem('shifts_group');
                location.reload(); return;
            }
        }

        if (!targetUsername && data._userGroup) {
            CURRENT_USER.group = data._userGroup;
            localStorage.setItem('shifts_group', data._userGroup);
        }
        
        CURRENT_DISPLAY_GROUP = data._userGroup || CURRENT_USER.group;
        delete data._userGroup;
        userOverrides = data;
        
        if (targetUsername) {
            VIEWING_MODE_USER = targetUsername;
            document.getElementById('viewingOtherAlert').style.display = 'flex';
            document.getElementById('viewingTargetName').innerText = targetUsername;
            READ_ONLY_MODE = true;
            document.getElementById('menuEditBtn').style.display = 'none';
        } else {
            VIEWING_MODE_USER = null;
            document.getElementById('viewingOtherAlert').style.display = 'none';
            document.getElementById('menuEditBtn').style.display = 'block';
        }
        refreshCurrentPage();
        setAppMode(false);
    } catch (e) { console.error("Load Error:", e); } 
    finally { if(loader) loader.classList.remove('show'); }
}

async function saveToCloud() {
    if (!CURRENT_USER) return;
    let targetUsername = VIEWING_MODE_USER || CURRENT_USER.username;
    if (VIEWING_MODE_USER && CURRENT_USER.username !== 'SHIH') { alert("觀看模式下無法修改！"); return; }
    
    const menuBtn = document.getElementById('menuEditBtn');
    if(menuBtn) { menuBtn.innerText = "⏳ 儲存中..."; menuBtn.disabled = true; }

    const inputR = document.getElementById('inputReserved');
    if(inputR) {
        const currentData = getMonthData(currentMonthIndex);
        const key = `${KEY_RESERVED_PREFIX}${currentData.year}_${currentData.month}`;
        userOverrides[key] = String(inputR.value);
    }
    
    try {
        await fetch(`${API_URL}?action=save&username=${targetUsername}`, {
            method: 'POST', mode: 'no-cors', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userOverrides)
        });
        alert("✅ 資料已同步更新！");
    } catch (e) { console.error(e); alert("❌ 上傳失敗"); } 
    finally { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.remove('show');
        if(menuBtn) { menuBtn.disabled = false; menuBtn.style.display = VIEWING_MODE_USER ? 'none' : 'block'; menuBtn.innerText = "🔧 修改班表"; }
        setAppMode(false); 
        refreshCurrentPage(); 
    }
}

// =========== 日曆與頁面渲染 ===========

function refreshCurrentPage() {
    const currentData = getMonthData(currentMonthIndex);
    document.getElementById('currentMonthDisplay').innerText = currentData.label;
    document.getElementById('prevBtn').disabled = (currentMonthIndex <= 0);
    document.getElementById('nextBtn').disabled = false;
    
    if (document.getElementById('view-calendar').classList.contains('active')) renderCalendar(); 
    if (document.getElementById('view-stats').classList.contains('active')) calculateLeaveStats();
    if (document.getElementById('view-image').classList.contains('active')) renderRosterList();
}

function renderCalendar() {
    const container = document.getElementById('calendar-container'); container.innerHTML = ''; 
    const currentData = getMonthData(currentMonthIndex);
    const table = createCalendarHTML(currentData.year, currentData.month);
    container.appendChild(table);
}

function createCalendarHTML(year, month) {
    const monthContainer = document.createElement('div'); monthContainer.className = 'month-block'; 
    const table = document.createElement('table'); table.className = 'calendar';
    const thead = document.createElement('thead'); const headerRow = document.createElement('tr');
    WEEK_DAYS.forEach(day => { const th = document.createElement('th'); th.innerText = day; headerRow.appendChild(th); });
    thead.appendChild(headerRow); table.appendChild(thead); const tbody = document.createElement('tbody');
    
    let startDay = 1; if (year === 2025 && month === 11) startDay = 17;
    const firstDay = new Date(year, month, startDay); const lastDay = new Date(year, month + 1, 0); 
    let currentDate = startDay; 
    let statsRealized = { days: 0, normal: 0, overtime: 0, standby: 0 }; let statsFuture = { days: 0, normal: 0, overtime: 0, standby: 0 };
    const todayZero = new Date(SYSTEM_TODAY); todayZero.setHours(0,0,0,0);
    let standardDay = firstDay.getDay(); let dayOfWeek = (standardDay + 6) % 7; 
    let row = document.createElement('tr');
    for (let i = 0; i < dayOfWeek; i++) { row.appendChild(document.createElement('td')); }

    while (currentDate <= lastDay.getDate()) {
        if (dayOfWeek > 6) { tbody.appendChild(row); row = document.createElement('tr'); dayOfWeek = 0; }
        const currentFullDate = new Date(year, month, currentDate); currentFullDate.setHours(0,0,0,0);
        const overrideString = userOverrides[formatDateKey(currentFullDate)];
        const dayInfo = getDayInfo(currentFullDate); const isToday = (currentFullDate.getTime() === todayZero.getTime());
        const td = document.createElement('td'); 
        td.onclick = function() { openModal(currentFullDate); }; 

        if (dayInfo) {
            const stats = calculateDayStats(dayInfo, overrideString);
            let targetStats = (currentFullDate <= todayZero) ? statsRealized : statsFuture;
            if (stats.normal > 0 || stats.overtime > 0) targetStats.days++;
            targetStats.normal += stats.normal; targetStats.overtime += stats.overtime; targetStats.standby += stats.sb;
            
            let isWork = (stats.normal > 0); td.className = isWork ? 'is-work' : 'is-rest'; 
            
            let stampHtml = '';
            stats.labels.forEach(lbl => {
                let type = 'type-off';
                if (lbl.includes('加') || lbl.includes('勤')) type = 'type-add';
                if (lbl.includes('假') || lbl.includes('休')) type = 'type-leave';
                stampHtml += `<div class="stamp ${type}">${lbl}</div>`;
            });

            let displayShift = dayInfo.shiftCode;
            if (dayInfo.isWork) {
                const myGroupNum = CURRENT_DISPLAY_GROUP.replace(/[^0-9]/g, '');
                const subNum = displayShift.charAt(1); const mainNum = displayShift.charAt(2);
                if (myGroupNum === mainNum) displayShift += '(正)'; else if (myGroupNum === subNum) displayShift += '(副)';
            }
            let line1 = displayShift.split('(')[0]; let line2 = displayShift.includes('(') ? '('+displayShift.split('(')[1] : '';
            
            td.innerHTML = `${stampHtml}<div class="cell-content"><span class="date-num ${isToday?'is-today':''}">${currentDate}</span><div class="shift-group"><span class="shift-upper">${line1}</span><span class="shift-lower">${line2}</span></div></div>`;
        } else { td.innerHTML = `<div class="cell-content"><span class="date-num ${isToday?'is-today':''}">${currentDate}</span></div>`; td.onclick = null; td.className='empty'; }
        row.appendChild(td); currentDate++; dayOfWeek++;
    }
    while (dayOfWeek <= 6) { row.appendChild(document.createElement('td')); dayOfWeek++; }
    tbody.appendChild(row); table.appendChild(tbody);
    
    const statsDiv = document.createElement('div'); statsDiv.className = 'month-stats';
    let statsHtml = '';
    const generateRowHtml = (title, data, colorTitle = '#666') => `
        <div class="stat-group-title" style="color:${colorTitle}; margin-top:10px;">${title}</div>
        <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="stat-card"><span class="stat-label">上班天</span><span class="stat-value">${data.days}</span></div>
            <div class="stat-card"><span class="stat-label">正班時</span><span class="stat-value highlight">${data.normal}</span></div>
            <div class="stat-card"><span class="stat-label">加班時</span><span class="stat-value overtime">${data.overtime}</span></div>
            <div class="stat-card"><span class="stat-label">備勤時</span><span class="stat-value" style="color:#666">${data.standby}</span></div>
        </div>`;
    statsHtml += generateRowHtml('本月統計 (參考)', statsRealized);
    statsDiv.innerHTML = statsHtml; monthContainer.appendChild(table); monthContainer.appendChild(statsDiv); 
    return monthContainer;
}

// =========== 休假管理 (儀表板) ===========

// ★★★ 休假管理邏輯 (極簡橫條版) ★★★
function calculateLeaveStats() {
    // 1. 取得當前年份與月份
    const currentData = getMonthData(currentMonthIndex);
    const viewYear = currentData.year; 
    const viewMonth = currentData.month + 1; 

    // 更新標題年份
    const yearTitle = document.getElementById('statsYearDisplay');
    if (yearTitle) yearTitle.innerText = viewYear;

    // 2. 讀取設定值
    let limits = {};
    if (userOverrides[KEY_LEAVE_CONFIG]) {
        try { limits = JSON.parse(userOverrides[KEY_LEAVE_CONFIG]); } catch(e){}
    }
    
    // 3. 初始化統計數據
    let usage = {}; 
    // 確保所有假別 (含新增的 min_leave) 都有初始值
    Object.keys(LEAVE_TYPES).forEach(k => usage[k] = 0);
    
    let compStats = { used: 0 };

    // 4. 遍歷資料進行計算
    Object.keys(userOverrides).forEach(key => {
        // 過濾非日期的 key
        if (!key.match(/^\d{4}-\d{2}-\d{2}$/)) return;

        const dateParts = key.split('-');
        const dataYear = parseInt(dateParts[0]);
        const dataMonth = parseInt(dateParts[1]);
        const val = userOverrides[key];
        const items = val.split(',');

        items.forEach(item => {
            // 解析複合標籤 (type|subtype|hours)
            if (item.includes('|')) {
                const [type, subtype, hoursStr] = item.split('|');
                const hours = parseFloat(hoursStr) || 0;

                // A. 年度假別 (特休/事假/身心/最低) -> 只要年份對就累計
                if (type === 'leave' && dataYear === viewYear) {
                    if (usage[subtype] !== undefined) usage[subtype] += hours;
                }
                
                // B. 補休 (月結) -> 年份跟月份都要對
                if (type === 'comp' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += hours; 
                }
            } else {
                // C. 舊版補休標籤 (相容性)
                if (item === 'comp_leave' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += 16; 
                }
            }
        });
    });

    // 5. 開始渲染
    const container = document.getElementById('leaveCardsContainer');
    container.innerHTML = '';

    // --- 渲染【補休卡片】(極簡版：含輸入框) ---
    // 取得預留值 (key 使用 year_monthIndex)
    const reservedKey = `${KEY_RESERVED_PREFIX}${viewYear}_${currentData.month}`;
    const reserved = parseFloat(userOverrides[reservedKey]) || 0;
    
    // 計算剩餘 (預留 - 已用)
    const compBalance = reserved - compStats.used;
    const balanceColor = compBalance >= 0 ? '#1976d2' : '#c62828'; // 藍色或紅色

    const compCard = document.createElement('div');
    compCard.className = 'leave-card comp-card';
    compCard.innerHTML = `
        <div class="l-header">
            <span>🌙</span> 補休
        </div>
        <div class="l-body">
            <div class="l-item">
                預留 <input type="number" id="inputReserved" value="${reserved}" 
                       class="mini-input"
                       ${READ_ONLY_MODE ? 'disabled' : ''}
                       oninput="updateCompBalanceLocal()">
            </div>
            <div class="l-item">
                已用 <span class="l-val">${compStats.used}</span>
            </div>
            <div class="l-item">
                剩餘 <span id="dynamicCompBalance" class="l-val balance" style="color:${balanceColor}">${compBalance}</span>
            </div>
        </div>
    `;
    container.appendChild(compCard);

    // --- 渲染【其他假別卡片】(極簡版：純顯示) ---
    Object.keys(LEAVE_TYPES).forEach(typeKey => {
        const conf = LEAVE_TYPES[typeKey];
        // 取得額度 (優先讀取設定，否則用預設值)
        const limit = (limits[typeKey] !== undefined) ? limits[typeKey] : conf.default;
        const used = usage[typeKey];
        const remaining = limit - used;
        const remainColor = remaining >= 0 ? '#333' : '#c62828'; // 正常黑字，超用紅字

        // 根據類型決定圖示
        let icon = '📄';
        if(typeKey === 'annual') icon = '🏖️';
        if(typeKey === 'personal') icon = '💼';
        if(typeKey === 'psych') icon = '🏥';
        if(typeKey === 'min_leave') icon = '⚠️';

        const card = document.createElement('div');
        card.className = `leave-card ${conf.color}`;
        card.innerHTML = `
            <div class="l-header">
                <span>${icon}</span> ${conf.label}
            </div>
            <div class="l-body">
                <div class="l-item">
                    額度 <span class="l-val">${limit}</span>
                </div>
                <div class="l-item">
                    已用 <span class="l-val">${used}</span>
                </div>
                <div class="l-item">
                    剩餘 <span class="l-val balance" style="color:${remainColor}">${remaining}</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // 將本月補休統計存入全域變數，供 input 輸入時即時更新前端顯示
    window.currentCompStats = compStats; 
}

// 輔助函式：即時計算補休餘額
function updateCompBalanceLocal() {
    const input = document.getElementById('inputReserved');
    const display = document.getElementById('dynamicCompBalance');
    if(input && display && window.currentCompStats) {
        const r = parseFloat(input.value) || 0;
        // 公式：輸入值 - 已用
        const balance = r - window.currentCompStats.used;
        display.innerText = balance;
        display.style.color = balance >= 0 ? '#1976d2' : '#c62828';
    }
}

// 輔助函式：當使用者輸入預留時數時，即時更新顯示的餘額
function updateCompBalanceLocal() {
    const input = document.getElementById('inputReserved');
    const display = document.getElementById('dynamicCompBalance');
    if(input && display && window.currentCompStats) {
        const r = parseFloat(input.value) || 0;
        const balance = r + window.currentCompStats.added - window.currentCompStats.used;
        display.innerText = balance;
        display.style.color = balance >= 0 ? '#1976d2' : '#c62828';
    }
}

function openModal(date) {
    if (READ_ONLY_MODE) return;
    modalCurrentDateKey = formatDateKey(date);
    document.getElementById('modalDateTitle').innerText = `${date.getMonth()+1}/${date.getDate()}`;
    document.getElementById('modalStep1').style.display = 'block';
    document.getElementById('modalStep2').style.display = 'none';
    document.getElementById('optionModal').classList.add('show');
}

function goToStep2(category) {
    modalStep1Selection = category;
    document.getElementById('modalStep1').style.display = 'none';
    document.getElementById('modalStep2').style.display = 'block';
    const container = document.getElementById('step2Options');
    container.innerHTML = '';
    document.getElementById('customHourArea').style.display = 'none';
    document.getElementById('step2Title').innerText = category === 'work' ? '上班設定' : category === 'overtime' ? '選擇加班' : category === 'comp' ? '選擇補休' : '選擇假別';

    if (category === 'work') {
        renderOptionBtn('正常上班 (清除設定)', 'base', 'work_day');
        renderOptionBtn('日勤', 'base', 'work_day');
        renderOptionBtn('夜勤', 'base', 'work_night');
        renderOptionBtn('日休', 'base', 'off_day');
        renderOptionBtn('夜休', 'base', 'off_night');
    } else if (category === 'overtime') {
        renderOptionBtn('所加日 (+8)', 'add', 'add_day');
        renderOptionBtn('所加夜 (+8)', 'add', 'add_night');
        renderOptionBtn('所加全 (+16)', 'add', 'add_full');
        renderOptionBtn('醫加日 (+8)', 'add', 'hosp_day');
        renderOptionBtn('醫加夜 (+8)', 'add', 'hosp_night');
    } else if (category === 'comp') {
        renderOptionBtn('補休全日 (-16)', 'comp_std', 'comp_leave');
        renderOptionBtn('自訂時數', 'comp_custom', 'custom');
    } else if (category === 'leave') {
        Object.keys(LEAVE_TYPES).forEach(k => { renderOptionBtn(LEAVE_TYPES[k].label, 'leave', k); });
    }
}

let selectedOptionValue = '';
function renderOptionBtn(text, type, value) {
    const btn = document.createElement('button');
    btn.className = 'opt-btn'; btn.innerText = text;
    btn.onclick = () => selectOption(btn, type, value);
    document.getElementById('step2Options').appendChild(btn);
}

function selectOption(btn, type, value) {
    document.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOptionValue = value;
    const customArea = document.getElementById('customHourArea');
    customArea.style.display = (type === 'leave' || value === 'custom') ? 'block' : 'none';
}

function adjustHour(delta) {
    const input = document.getElementById('customHourInput');
    let val = parseInt(input.value) || 0;
    val += delta;
    if (val < 1) val = 1; if (val > 24) val = 24;
    input.value = val;
}

function backToStep1() {
    document.getElementById('modalStep1').style.display = 'block';
    document.getElementById('modalStep2').style.display = 'none';
}

function saveOption() {
    if (!selectedOptionValue) { alert('請選擇一個項目'); return; }
    let finalValue = selectedOptionValue;
    const customArea = document.getElementById('customHourArea');
    if (customArea.style.display !== 'none') {
        const hours = document.getElementById('customHourInput').value;
        if (modalStep1Selection === 'comp') finalValue = `comp|custom|${hours}`;
        else if (modalStep1Selection === 'leave') finalValue = `leave|${selectedOptionValue}|${hours}`;
    }
    
    let currentVal = userOverrides[modalCurrentDateKey] || '';
    if (modalStep1Selection === 'work') userOverrides[modalCurrentDateKey] = finalValue;
    else { if (currentVal) finalValue = currentVal + ',' + finalValue; userOverrides[modalCurrentDateKey] = finalValue; }
    
    closeModalDirect();
    refreshCurrentPage();
}

function confirmModal(isClear) {
    if (isClear) delete userOverrides[modalCurrentDateKey];
    refreshCurrentPage();
    closeModalDirect();
}
function closeModalDirect() { document.getElementById('optionModal').classList.remove('show'); }
function closeModal(event) { if (event.target.id === 'optionModal') closeModalDirect(); }

// 休假設定：開啟
function openLeaveSettings() {
    toggleUserMenu();
    let limits = {};
    if (userOverrides[KEY_LEAVE_CONFIG]) { try { limits = JSON.parse(userOverrides[KEY_LEAVE_CONFIG]); } catch(e){} }
    
    document.getElementById('settingAnnual').value = limits['annual'] || '';
    // 使用新的預設值
    document.getElementById('settingPersonal').value = limits['personal'] !== undefined ? limits['personal'] : 32;
    document.getElementById('settingPsych').value = limits['psych'] !== undefined ? limits['psych'] : 24;
    document.getElementById('settingMinLeave').value = limits['min_leave'] !== undefined ? limits['min_leave'] : 24;
    
    document.getElementById('leaveSettingsModal').classList.add('show');
}

// 休假設定：儲存
function saveLeaveSettings() {
    const limits = {
        'annual': parseFloat(document.getElementById('settingAnnual').value) || 0,
        'personal': parseFloat(document.getElementById('settingPersonal').value) || 0,
        'psych': parseFloat(document.getElementById('settingPsych').value) || 0,
        'min_leave': parseFloat(document.getElementById('settingMinLeave').value) || 0
    };
    userOverrides[KEY_LEAVE_CONFIG] = JSON.stringify(limits);
    
    if (!document.body.classList.contains('editing-mode')) saveToCloud();
    else alert("設定已暫存，請記得點擊「儲存並離開」");
    
    closeLeaveSettingsDirect();
    if (document.getElementById('view-stats').classList.contains('active')) calculateLeaveStats();
}

function closeLeaveSettingsDirect() { document.getElementById('leaveSettingsModal').classList.remove('show'); }
function closeLeaveSettings(e) { if(e.target.id === 'leaveSettingsModal') closeLeaveSettingsDirect(); }

// 3. 人員列表與備份
async function openUserListModal() {
    toggleUserMenu(); 
    IS_SHOWING_BACKUPS = false;
    document.getElementById('toggleBackupBtn').classList.remove('active');
    document.getElementById('toggleBackupBtn').innerText = '♻️ 資源回收桶';
    document.getElementById('userListTitle').innerText = '同事列表';
    const modal = document.getElementById('userListModal');
    const container = document.getElementById('userListContainer');
    modal.classList.add('show');
    container.innerHTML = '<div class="loading-text">載入中...</div>';
    
    try {
        const res = await fetch(`${API_URL}?action=get_user_list`);
        const json = await res.json();
        if (json.result === 'success') renderUserList(json.users);
        else container.innerHTML = '載入失敗';
    } catch (e) { container.innerHTML = '網路錯誤'; }
}

function renderUserList(users) {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';
    const isAdmin = (CURRENT_USER.username === 'SHIH');
    users.forEach(u => {
        const div = document.createElement('div'); div.className = 'user-item';
        const infoDiv = document.createElement('div'); infoDiv.className = 'user-item-info';
        infoDiv.innerHTML = `<span class="u-name">${u.username}</span><span class="u-group">${u.group}</span>`;
        infoDiv.onclick = () => { closeUserListModalDirect(); loadOverrides(u.username); };
        div.appendChild(infoDiv);
        if (isAdmin && u.username !== 'SHIH') {
            const delBtn = document.createElement('button'); delBtn.className = 'delete-user-btn'; delBtn.innerText = '刪除';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteUserAccount(u.username); };
            div.appendChild(delBtn);
        }
        container.appendChild(div);
    });
}

function toggleBackupView() {
    IS_SHOWING_BACKUPS = !IS_SHOWING_BACKUPS;
    const btn = document.getElementById('toggleBackupBtn');
    const title = document.getElementById('userListTitle');
    if (IS_SHOWING_BACKUPS) {
        btn.classList.add('active'); btn.innerText = '👥 返回列表'; title.innerText = '已刪除帳號';
        loadBackupList();
    } else {
        btn.classList.remove('active'); btn.innerText = '♻️ 資源回收桶'; title.innerText = '同事列表';
        openUserListModal();
    }
}

async function loadBackupList() {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '<div class="loading-text">搜尋備份中...</div>';
    try {
        const res = await fetch(`${API_URL}?action=get_backups`);
        const json = await res.json();
        if (json.result === 'success') renderBackupList(json.backups);
        else container.innerHTML = '載入失敗: ' + json.message;
    } catch (e) { container.innerHTML = '網路錯誤'; }
}

function renderBackupList(files) {
    const container = document.getElementById('userListContainer'); container.innerHTML = '';
    if (files.length === 0) { container.innerHTML = '<div class="empty-hint">資源回收桶是空的</div>'; return; }
    const isAdmin = (CURRENT_USER.username === 'SHIH');
    files.forEach(f => {
        const div = document.createElement('div'); div.className = 'user-item';
        let displayName = f.name.replace('BACKUP_', '').replace('.json', '');
        let dateStr = new Date(f.date).toLocaleDateString();
        let buttonsHtml = `<button class="restore-btn" onclick="restoreUserAccount('${f.id}', '${displayName}')">↩️ 復原</button>`;
        if (isAdmin) buttonsHtml += `<button class="perm-delete-btn" onclick="permanentDeleteBackup('${f.id}', '${displayName}')">🗑️</button>`;
        div.innerHTML = `<div class="user-item-info"><span class="u-name">${displayName}</span><span class="u-group">備份日: ${dateStr}</span></div><div style="display:flex; gap:5px;">${buttonsHtml}</div>`;
        container.appendChild(div);
    });
}

async function deleteUserAccount(targetUser) {
    if (!confirm(`⚠️ 警告！\n確定要刪除 "${targetUser}" 的帳號嗎？\n此動作將自動備份資料到雲端。`)) return;
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    try {
        const res = await fetch(`${API_URL}?action=delete_user&admin_user=${CURRENT_USER.username}&target_user=${targetUser}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { alert(`已成功刪除 ${targetUser}`); openUserListModal(); }
        else alert("刪除失敗：" + json.message);
    } catch(e) { alert("刪除發生錯誤"); } finally { if(loader) loader.classList.remove('show'); }
}

async function restoreUserAccount(fileId, name) {
    if (!confirm(`確定要復原 "${name}" 的帳號嗎？`)) return;
    const container = document.getElementById('userListContainer');
    container.innerHTML = '<div class="loading-text">正在復原資料...</div>';
    try {
        const res = await fetch(`${API_URL}?action=restore_user&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { alert(`✅ 成功復原 "${json.username}"！`); IS_SHOWING_BACKUPS = false; toggleBackupView(); }
        else { alert("❌ 復原失敗：" + json.message); loadBackupList(); }
    } catch (e) { alert("復原發生錯誤"); loadBackupList(); }
}

async function permanentDeleteBackup(fileId, name) {
    if (!confirm(`⚠️ 警告：確定要「永久刪除」 ${name} 的備份嗎？`)) return;
    const container = document.getElementById('userListContainer');
    try {
        const res = await fetch(`${API_URL}?action=permanent_delete_backup&admin_user=${CURRENT_USER.username}&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { alert(`已永久刪除 ${name}。`); loadBackupList(); }
        else alert("刪除失敗：" + json.message);
    } catch (e) { alert("網路錯誤"); }
}

function closeUserListModalDirect() { document.getElementById('userListModal').classList.remove('show'); }
function closeUserListModal(e) { if (e.target.id === 'userListModal') closeUserListModalDirect(); }
function exitViewMode() { loadOverrides(null); }

// 4. 勤務表與圖片
let selectedRosterFile = null; let currentViewingRosterKey = null; 
function handleRosterSelect(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('fileNameDisplay');
    if (file) { selectedRosterFile = file; if(nameDisplay) nameDisplay.innerText = file.name; }
}

function handleRosterPreview(event) {
    const file = event.target.files[0];
    const dropZone = document.getElementById('dropZone');
    const placeholder = document.getElementById('uploadPlaceholder');
    const previewBox = document.getElementById('previewBox');
    const previewImg = document.getElementById('uploadPreviewImg');
    const reselectTag = document.getElementById('reselectTag');

    if (file) {
        selectedRosterFile = file; // 存入全域變數
        
        // 讀取圖片並顯示
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            // 切換 UI 狀態
            dropZone.classList.add('has-image');
            placeholder.style.display = 'none';
            previewBox.style.display = 'flex';
            reselectTag.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        // 如果使用者取消選擇，保持原狀或清空，這裡選擇不動作保留上一張，或可選清空
    }
}

async function saveRosterImage() {
    const dateInput = document.getElementById('rosterDateInput');
    // ... (原本的檢查邏輯保持不變) ...
    if (!dateInput || !dateInput.value) { alert("請先選擇日期！"); return; }
    if (!selectedRosterFile) { alert("請先選擇圖片！"); return; }
    if (!CURRENT_USER) { alert("請先登入"); return; }
    
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image(); img.src = e.target.result;
        img.onload = async function() {
            // ... (原本的 canvas 壓縮邏輯保持不變) ...
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 1200; 
            let width = img.width; let height = img.height;
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            
            let dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const dateParts = dateInput.value.split('-'); 
            const newFileName = `${dateParts[1]}${dateParts[2]}.jpg`; 

            try {
                const response = await fetch(`${API_URL}?action=upload_image&username=${CURRENT_USER.username}`, {
                    method: 'POST', mode: 'cors',
                    body: JSON.stringify({ file: dataUrl, name: newFileName })
                });
                const result = await response.json();
                
                if (result.result === 'success') {
                    const fileId = result.fileId;
                    const rosterKey = `roster_${dateInput.value}`;
                    userOverrides[rosterKey] = `DRIVE|${fileId}`;
                    await saveToCloud(); // 存檔
                    
                    // ★★★ 加入這行：重置介面 ★★★
                    resetUploadUI(); 
                    
                    renderRosterList();
                } else { alert("上傳失敗: " + result.error); }
            } catch (err) { console.error(err); alert("上傳發生錯誤"); } 
            finally { if(loader) loader.classList.remove('show'); }
        };
    };
    reader.readAsDataURL(selectedRosterFile);
}

function resetUploadUI() {
    selectedRosterFile = null;
    document.getElementById('rosterFileInput').value = '';
    
    // 恢復 UI 初始狀態
    document.getElementById('dropZone').classList.remove('has-image');
    document.getElementById('uploadPlaceholder').style.display = 'flex';
    document.getElementById('previewBox').style.display = 'none';
    document.getElementById('uploadPreviewImg').src = '';
    document.getElementById('reselectTag').style.display = 'none';
}

function renderRosterList() {
    const container = document.getElementById('rosterListContainer'); if(!container) return;
    container.innerHTML = '';
    const currentData = getMonthData(currentMonthIndex);
    const targetMonthStr = `${currentData.year}-${String(currentData.month + 1).padStart(2, '0')}`;
    const rosterKeys = Object.keys(userOverrides).filter(key => key.startsWith('roster_')).filter(key => key.includes(targetMonthStr)).sort(); 
    if (rosterKeys.length === 0) { container.innerHTML = `<div class="empty-hint">尚無 ${currentData.label} 的勤務表</div>`; return; }
    rosterKeys.forEach(key => {
        const dateStr = key.replace('roster_', '');
        const parts = dateStr.split('-');
        const displayDate = `${parts[1]}/${parts[2]}`;
        const btn = document.createElement('div');
        btn.className = 'roster-item-btn';
        btn.innerHTML = `<span class="roster-date-text">${displayDate}</span>`;
        btn.onclick = () => openImageModal(key, dateStr);
        container.appendChild(btn);
    });
}

let imgState = { scale: 1, pX: 0, pY: 0 };

function openImageModal(key, dateStr) {
    currentViewingRosterKey = key; 
    const title = document.getElementById('viewerDateTitle');
    const img = document.getElementById('viewerImage');
    const modal = document.getElementById('imageViewerModal');
    
    if(title) title.innerText = dateStr;
    if(img) {
        img.src = ''; 
        // 重置圖片狀態 (大小、位置)
        img.style.transform = `translate(0px, 0px) scale(1)`;
        imgState = { scale: 1, pX: 0, pY: 0 };
        
        let val = userOverrides[key];
        if (val && val.startsWith('DRIVE|')) {
            const fileId = val.split('|')[1];
            img.src = `https://lh3.googleusercontent.com/d/${fileId}`; 
        } else if (val) {
            img.src = val;
        }
        
        // ★★★ 啟動手勢監聽 ★★★
        initImageGestures(img);
    }
    if(modal) modal.classList.add('show');
}

// ★★★ 新增：圖片手勢控制核心 (縮放、拖曳、點擊關閉) ★★★
function initImageGestures(imgElement) {
    const wrapper = document.querySelector('.image-wrapper');
    if (!imgElement || !wrapper) return;

    // 變數初始化
    let startX = 0, startY = 0;
    let initialPinchDistance = 0;
    let isDragging = false;
    let isPinching = false;
    
    // 紀錄上一動作結束時的狀態
    let lastScale = 1;
    let lastPointX = 0;
    let lastPointY = 0;
    
    // 用來判斷是否為「單點」
    let touchStartTime = 0;
    let hasMoved = false;

    // 移除舊的監聽器 (防止重複綁定)
    // 簡單做法：用 cloneNode 替換元素來清除 EventListener
    const newWrapper = wrapper.cloneNode(true);
    wrapper.parentNode.replaceChild(newWrapper, wrapper);
    // 重新抓取新元素裡的 img
    const newImg = newWrapper.querySelector('img'); 

    // --- 1. 觸控開始 (Touch Start) ---
    newWrapper.addEventListener('touchstart', function(e) {
        hasMoved = false;
        touchStartTime = new Date().getTime();

        // 兩指：縮放模式
        if (e.touches.length === 2) {
            isPinching = true;
            isDragging = false;
            initialPinchDistance = getDistance(e.touches);
        } 
        // 單指：拖曳模式
        else if (e.touches.length === 1) {
            isPinching = false;
            isDragging = true;
            startX = e.touches[0].clientX - lastPointX;
            startY = e.touches[0].clientY - lastPointY;
        }
    });

    // --- 2. 觸控移動 (Touch Move) ---
    newWrapper.addEventListener('touchmove', function(e) {
        e.preventDefault(); // 禁止瀏覽器預設捲動
        hasMoved = true; // 標記有移動過，所以不是單純點擊

        // 縮放邏輯
        if (isPinching && e.touches.length === 2) {
            const currentDistance = getDistance(e.touches);
            const zoomFactor = currentDistance / initialPinchDistance;
            
            // 限制縮放範圍 (0.5倍 ~ 5倍)
            let newScale = lastScale * zoomFactor;
            newScale = Math.min(Math.max(0.5, newScale), 5);
            
            imgState.scale = newScale;
            updateTransform(newImg);
        } 
        // 拖曳邏輯 (只有放大時才允許拖曳，原尺寸時拖曳沒意義)
        else if (isDragging && e.touches.length === 1 && imgState.scale > 1) {
            const x = e.touches[0].clientX - startX;
            const y = e.touches[0].clientY - startY;
            
            imgState.pX = x;
            imgState.pY = y;
            updateTransform(newImg);
        }
    });

    // --- 3. 觸控結束 (Touch End) ---
    newWrapper.addEventListener('touchend', function(e) {
        // 儲存狀態供下次操作使用
        lastScale = imgState.scale;
        lastPointX = imgState.pX;
        lastPointY = imgState.pY;
        
        isPinching = false;
        isDragging = false;

        // ★★★ 單點關閉邏輯 ★★★
        // 條件：手指數量變為0(離開) + 沒有大幅移動過 + 時間很短(小於300ms)
        const touchDuration = new Date().getTime() - touchStartTime;
        if (!hasMoved && touchDuration < 300 && e.touches.length === 0) {
            // 執行關閉
            closeImageModalDirect();
        }
        
        // 如果縮得太小，自動彈回原尺寸
        if (imgState.scale < 1) {
            imgState.scale = 1;
            imgState.pX = 0;
            imgState.pY = 0;
            lastScale = 1; lastPointX = 0; lastPointY = 0;
            updateTransform(newImg);
        }
    });

    // 輔助：更新 CSS
    function updateTransform(el) {
        el.style.transform = `translate(${imgState.pX}px, ${imgState.pY}px) scale(${imgState.scale})`;
    }

    // 輔助：計算兩指距離
    function getDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

async function deleteCurrentRoster() {
    if (!currentViewingRosterKey) return;
    const isAdmin = (CURRENT_USER && CURRENT_USER.username === 'SHIH');
    const isOwner = (!VIEWING_MODE_USER); 
    if (!isOwner && !isAdmin) { alert("您沒有權限刪除他人的勤務表"); return; }

    if (confirm("確定要刪除這張勤務表嗎？\n(雲端檔案也將一併刪除)")) { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.add('show');

        const val = userOverrides[currentViewingRosterKey];
        if (val && val.startsWith('DRIVE|')) {
            const fileId = val.split('|')[1];
            try { await fetch(`${API_URL}?action=delete_drive_file&file_id=${fileId}`, { method: 'POST' }); } catch (e) { console.error("雲端檔案刪除失敗", e); }
        }
        delete userOverrides[currentViewingRosterKey]; 
        closeImageModalDirect(); 
        
        try { await saveToCloud(); } catch (e) { console.error("存檔失敗", e); alert("存檔發生錯誤"); } 
        finally { if(loader) loader.classList.remove('show'); }
    }
}
function closeImageModalDirect() { 
    const modal = document.getElementById('imageViewerModal');
    if(modal) { modal.classList.remove('show'); setTimeout(() => { modal.style.display = ''; }, 300); }
    currentViewingRosterKey = null; 
}

// 5. 導航與模式
function setAppMode(isEditing) {
    READ_ONLY_MODE = !isEditing;
    const menuBtn = document.getElementById('menuEditBtn');
    const inputR = document.getElementById('inputReserved');
    if (inputR) { inputR.disabled = !isEditing; inputR.style.backgroundColor = isEditing ? 'white' : '#f0f0f0'; }

    if (isEditing) {
        if(menuBtn) { menuBtn.innerHTML = "💾 儲存並離開"; menuBtn.classList.add('saving'); }
        document.body.classList.add('editing-mode');
    } else {
        if(menuBtn) { menuBtn.innerHTML = "🔧 修改班表"; menuBtn.classList.remove('saving'); }
        document.body.classList.remove('editing-mode');
    }
}

function toggleEditMode() {
    const menu = document.getElementById('userDropdown');
    if(menu) menu.classList.remove('show');
    if (READ_ONLY_MODE) { setAppMode(true); alert("已進入修改模式\n完成後請再次點選「儲存並離開」"); }
    else { saveToCloud(); }
}

function switchTab(tabName) {
    // ... (原本的 tab 切換邏輯) ...
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.view-section');
    tabs.forEach(t => t.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    
    if (tabName === 'calendar') { 
        document.getElementById('view-calendar').classList.add('active'); 
        tabs[0].classList.add('active'); 
        renderCalendar(); 
    }
    else if (tabName === 'stats') { 
        document.getElementById('view-stats').classList.add('active'); 
        tabs[1].classList.add('active'); 
        calculateLeaveStats(); 
    }
    else if (tabName === 'image') { 
        document.getElementById('view-image').classList.add('active'); 
        tabs[2].classList.add('active'); 
        renderRosterList(); 
        
        // ★★★ 加入這行：切換到勤務表頁面時，自動幫日期欄位填入今天 ★★★
        const dateInput = document.getElementById('rosterDateInput');
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            dateInput.value = `${y}-${m}-${d}`;
        }
    }
    refreshCurrentPage(); 
}

let touchStartX = 0;
let touchStartY = 0;
const minSwipeDistance = 100; // 門檻從 50 提高到 100 (要滑長一點才算)
const maxVerticalDistance = 60; // 垂直容錯值 (上下滑動超過這個距離，就不算左右切換)

const calendarContainer = document.querySelector('.container');

calendarContainer.addEventListener('touchstart', function(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY; // 紀錄垂直位置
}, false);

calendarContainer.addEventListener('touchend', function(e) {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    handleSwipe(touchEndX, touchEndY);
}, false);

function handleSwipe(endX, endY) {
    const distanceX = endX - touchStartX;
    const distanceY = endY - touchStartY;

    // 條件 1: 左右滑動距離必須大於 minSwipeDistance (100px)
    // 條件 2: 上下滑動距離必須小於 maxVerticalDistance (60px) -> 防止在捲動網頁時誤觸
    if (Math.abs(distanceX) > minSwipeDistance && Math.abs(distanceY) < maxVerticalDistance) {
        if (distanceX < 0) {
            changeMonth(1); // 向左滑 -> 下個月
        } else {
            changeMonth(-1); // 向右滑 -> 上個月
        }
    }
}

// 啟動程序
jumpToToday();
checkAuth();