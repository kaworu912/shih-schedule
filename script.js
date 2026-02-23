// =========== 設定與常數區 ===========
let READ_ONLY_MODE = true; 
const API_URL = "https://script.google.com/macros/s/AKfycbyJb7S1ySBuCSNsTYSB9buBMAkqUIVW4rU2p8RBIfKBJzYdSSX7MZU3uUer_5Iaom8O1Q/exec"; 

// 舊帳號預設起算日 (向下相容)
const ANCHOR_DATE = new Date(2025, 11, 14); 
const BASE_YEAR = 2025;
const BASE_MONTH = 11; 

let CURRENT_DISPLAY_GROUP = ''; 
let CURRENT_USER = null; 
let VIEWING_MODE_USER = null;
let IS_SHOWING_BACKUPS = false;
let currentMonthIndex = 0; 
let userOverrides = {}; 

const KEY_RESERVED_PREFIX = 'stats_reserved_'; 
const KEY_LEAVE_CONFIG = 'config_leave_limits'; 

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

const LEAVE_TYPES = {
    'annual':    { label: '特休',    default: 0,  color: 'annual' },
    'personal':  { label: '事假',    default: 32, color: 'personal' }, 
    'psych':     { label: '身心假',  default: 24, color: 'psych' },
    'min_leave': { label: '最低休假', default: 0, color: 'min_leave' },
    'other':     { label: '其他',    default: 0,  color: 'min_leave' } 
};

const OVERRIDE_RULES = {
    'work_day':   { label: '日勤', wk: 8, sb: 2, type: 'base' },
    'work_night': { label: '夜勤', wk: 8, sb: 2, type: 'base' },
    'add_day':    { label: '所加日', wk: 8, sb: 2, type: 'add' }, 
    'add_night':  { label: '所加夜', wk: 8, sb: 2, type: 'add' },
    'add_full':   { label: '所日夜', wk: 16, sb: 4, type: 'add' }, 
    'hosp_day':   { label: '醫加日', wk: 8, sb: 2, type: 'add' },  
    'hosp_night': { label: '醫加夜', wk: 8, sb: 6, type: 'add' },  
    'hosp_dn':    { label: '醫日夜', wk: 16, sb: 8, type: 'add' },
    'off_day':    { label: '日休', wk: -8, sb: -2, type: 'off' }, 
    'off_night':  { label: '夜休', wk: -8, sb: -2, type: 'off' }, 
    'comp_leave': { label: '補休', wk: -16, sb: -4, type: 'off' },
    'swap_work':  { label: '換班(上)', wk: 16, sb: 4, type: 'base' }, 
    'swap_off':   { label: '換班(休)', wk: 0, sb: 0, type: 'base' } 
};

// =========== UX 元件 (Toast 與 Confirm) ===========

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const btnOk = document.getElementById('confirmOkBtn');
        const btnCancel = document.getElementById('confirmCancelBtn');
        msgEl.innerText = message;
        modal.style.display = 'flex';
        const cleanup = () => { btnOk.onclick = null; btnCancel.onclick = null; modal.style.display = 'none'; };
        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
}

// =========== 班表初始設定 (動態生成引擎) ===========

function openSetupModal() {
    toggleUserMenu(); 
    let unit = '';
    if (userOverrides['config_setup']) {
        try {
            const config = JSON.parse(userOverrides['config_setup']);
            unit = config.unit || '';
        } catch(e) {}
    }
    document.getElementById('setupUnit').value = unit;
    const dateInput = document.getElementById('setupDate');
    if (!dateInput.value) {
        const today = new Date();
        dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    document.getElementById('setupModal').classList.add('show');
}

function closeSetupModal() {
    document.getElementById('setupModal').classList.remove('show');
}

// =========== 班表初始設定 ===========
function submitSetup() {
    const unit = document.getElementById('setupUnit').value.trim();
    const dateStr = document.getElementById('setupDate').value;
    const shiftType = document.getElementById('setupShiftType').value; 
    
    if(!unit || !dateStr || !shiftType) { showToast("請填寫完整", "error"); return; }
    
    const selectedDate = new Date(dateStr);
    selectedDate.setHours(0,0,0,0);
    
    // 儲存設定：只需要記錄起始日和當天的班別
    const config = {
        unit: unit,
        anchorTime: selectedDate.getTime(),
        shiftType: shiftType, // 'main' 或是 'sub'
        isNewMainSubRule: true 
    };
    
    userOverrides['config_setup'] = JSON.stringify(config);
    saveToCloud();
    closeSetupModal();
    updateUserInfoUI();
    showToast("班表初始設定完成！", "success");
}

// =========== 初始化與工具函式 ===========

function getMonthData(index) {
    let targetDate = new Date(BASE_YEAR, BASE_MONTH + index, 1);
    return { year: targetDate.getFullYear(), month: targetDate.getMonth(), label: `${targetDate.getFullYear()}/${String(targetDate.getMonth() + 1).padStart(2, '0')}` };
}
function calculateIndexFromDate(date) { return (date.getFullYear() - BASE_YEAR) * 12 + (date.getMonth() - BASE_MONTH); }
function formatDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

function jumpToToday() {
    const now = new Date();
    currentMonthIndex = calculateIndexFromDate(now);
    refreshCurrentPage();
}

function changeMonth(step) { 
    currentMonthIndex += step; 
    refreshCurrentPage(); 
}

// =========== 核心：取得單日班表資訊 ===========
function getDayInfo(date) {
    if (date < new Date(2020, 0, 1)) return null; 

    let myGroup = CURRENT_DISPLAY_GROUP || '甲2';
    
    // ★★★ 模式 1：新版自訂起算日 (完全遵循做1休1、做1休3) ★★★
    if (userOverrides['config_setup']) {
        try {
            const setup = JSON.parse(userOverrides['config_setup']);
            if (setup.anchorTime && setup.isNewMainSubRule) {
                const useAnchor = new Date(setup.anchorTime);
                const d1 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
                const d2 = Date.UTC(useAnchor.getFullYear(), useAnchor.getMonth(), useAnchor.getDate());
                let diffDays = Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
                
                // 個人六日迴圈 (0=第一天, 2=第三天)
                let personalIndex = diffDays % 6;
                if (personalIndex < 0) personalIndex += 6;
                
                // 只要是第0天或第2天就是上班
                let isWork = (personalIndex === 0 || personalIndex === 2);
                
                if (isWork) {
                    let isFirstDayMain = (setup.shiftType === 'main');
                    let currentRole = '';
                    
                    // 根據設定分配正副班
                    if (personalIndex === 0) currentRole = isFirstDayMain ? 'main' : 'sub';
                    if (personalIndex === 2) currentRole = isFirstDayMain ? 'sub' : 'main';
                    
                    // 自動推算全球班別代號 (如: 甲12)
                    let prefix = myGroup.charAt(0) || '甲';
                    let num = myGroup.replace(/[^0-9]/g, '');
                    let shiftCode = '';
                    
                    if (num === '1') shiftCode = currentRole === 'main' ? prefix + '12' : prefix + '31';
                    else if (num === '2') shiftCode = currentRole === 'main' ? prefix + '23' : prefix + '12';
                    else if (num === '3') shiftCode = currentRole === 'main' ? prefix + '31' : prefix + '23';
                    else shiftCode = myGroup; // 防呆
                    
                    // 回傳明確的 role，讓 UI 知道要加上 (正) 還是 (副)
                    return { isWork: true, text: '上班', shiftCode: shiftCode, role: currentRole };
                } else {
                    return { isWork: false, text: '休假', shiftCode: '' };
                }
            }
        } catch(e) {}
    }
    
    // ★★★ 模式 2：舊版向下相容 (未設定過的帳號) ★★★
    let useAnchor = ANCHOR_DATE;
    const d1 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const d2 = Date.UTC(useAnchor.getFullYear(), useAnchor.getMonth(), useAnchor.getDate());
    const diffDays = Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
    
    let globalIndex = diffDays % TOTAL_CYCLE_DAYS;
    if (globalIndex < 0) globalIndex += TOTAL_CYCLE_DAYS;
    
    let offset = GROUP_OFFSETS[myGroup] || 0;
    let personalIndex = (globalIndex - offset) % TOTAL_CYCLE_DAYS;
    if (personalIndex < 0) personalIndex += TOTAL_CYCLE_DAYS;
    
    return { ...CYCLE_CONFIG[personalIndex], shiftCode: SHIFT_CODES[globalIndex] };
}

function calculateDayStats(dayInfo, overrideString) {
    let base_normal = dayInfo.isWork ? 16 : 0; 
    let base_standby = dayInfo.isWork ? 4 : 0;
    let overtime = 0; let add_standby = 0; let labels = [];

    if (!overrideString) return { normal: base_normal, overtime: 0, sb: base_standby, labels };
    const items = overrideString.split(',');
    
    items.forEach(item => {
        if (OVERRIDE_RULES[item] && OVERRIDE_RULES[item].type === 'base') {
            base_normal = OVERRIDE_RULES[item].wk;
            base_standby = OVERRIDE_RULES[item].sb;
            labels.push(OVERRIDE_RULES[item].label);
        }
    });

    items.forEach(item => {
        if (OVERRIDE_RULES[item] && OVERRIDE_RULES[item].type === 'base') return; 
        if (OVERRIDE_RULES[item]) {
            const r = OVERRIDE_RULES[item];
            if (r.type === 'add') { overtime += r.wk; add_standby += r.sb; labels.push(r.label); }
            else if (r.type === 'off') { base_normal += r.wk; base_standby += r.sb; labels.push(r.label); }
        } else if (item.includes('|')) {
            const parts = item.split('|'); const type = parts[0]; const subtype = parts[1]; const val1 = parseFloat(parts[2]) || 0; 
            if (type === 'leave' || type === 'comp') {
                base_normal -= val1; base_standby -= (val1 / 4); 
                let lbl = type === 'comp' ? '補休' : (LEAVE_TYPES[subtype] ? LEAVE_TYPES[subtype].label : subtype);
                labels.push(`${lbl}${val1}h`);
            } else if (type === 'add' && subtype === 'custom') {
                const val2 = parseFloat(parts[3]) || 0; 
                overtime += val1; add_standby += val2;
                labels.push(`自訂(+${val1}/${val2})`);
            }
        }
    });

    if (base_normal <= 0) { base_normal = 0; base_standby = 0; }
    if (base_standby < 0) base_standby = 0;
    if (overtime < 0) overtime = 0; 
    if (add_standby < 0) add_standby = 0;
    return { normal: base_normal, overtime: overtime, sb: base_standby + add_standby, labels: labels };
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
    if(!u || !p) { showToast("請輸入完整資料", "error"); return; }
    
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
            jumpToToday();
            setAppMode(false);
            showToast(`歡迎回來，${CURRENT_USER.username}！`, "success");
            
            // 全新帳號自動跳出設定視窗
            if (!userOverrides['config_setup'] && Object.keys(userOverrides).filter(k => k !== '_userGroup').length === 0) {
                openSetupModal();
            } else { updateUserInfoUI(); }
        } else { showToast("登入失敗：" + json.message, "error"); }
    } catch(e) { showToast("網路連線錯誤", "error"); } 
    finally { btn.innerText = oldText; btn.disabled = false; }
}

async function doRegister() {
    const u = document.getElementById('regUser').value.trim();
    const p = document.getElementById('regPass').value.trim();
    const g = document.getElementById('regGroup').value;
    if(!u || !p) { showToast("請填寫完整註冊資料", "error"); return; }
    
    const btn = document.querySelector('#registerForm button');
    btn.innerText = "註冊中..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}?action=register&username=${u}&password=${p}&group=${g}`);
        const json = await res.json();
        if (json.result === 'success') {
            showToast("註冊成功！請使用新帳號登入", "success");
            switchAuthMode('login');
            document.getElementById('loginUser').value = u;
        } else { showToast("註冊失敗：" + json.message, "error"); }
    } catch(e) { showToast("網路連線錯誤", "error"); } 
    finally { btn.innerText = "註冊帳號"; btn.disabled = false; }
}

async function doLogout() {
    if (await showConfirm("確定要登出排班系統嗎？")) {
        localStorage.removeItem('shifts_user'); localStorage.removeItem('shifts_group');
        location.reload();
    }
}

function updateUserInfoUI() {
    const display = document.getElementById('userInfoDisplay');
    if(display && CURRENT_USER) {
        let unitName = '';
        if (userOverrides['config_setup']) {
            try {
                const setup = JSON.parse(userOverrides['config_setup']);
                if (setup.unit) unitName = setup.unit + ' - ';
            } catch(e) {}
        }
        display.innerText = `${CURRENT_USER.username} (${unitName}${CURRENT_USER.group})`;
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
            if (targetUsername) { showToast(`使用者 "${targetUsername}" 已不存在。`, "error"); exitViewMode(); return; } 
            else {
                await showConfirm("⚠️ 您的帳號已被刪除，請重新註冊！\n\n(點擊確定後返回登入頁面)");
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
            READ_ONLY_MODE = true; document.getElementById('menuEditBtn').style.display = 'none';
        } else {
            VIEWING_MODE_USER = null;
            document.getElementById('viewingOtherAlert').style.display = 'none';
            document.getElementById('menuEditBtn').style.display = 'block';
        }
        refreshCurrentPage();
        setAppMode(false);
        updateUserInfoUI();

        if (!targetUsername && !userOverrides['config_setup'] && Object.keys(userOverrides).filter(k => k !== '_userGroup').length === 0) {
            openSetupModal();
        }
    } catch (e) { console.error("Load Error:", e); } 
    finally { if(loader) loader.classList.remove('show'); }
}

async function saveToCloud() {
    if (!CURRENT_USER) return;
    let targetUsername = VIEWING_MODE_USER || CURRENT_USER.username;
    if (VIEWING_MODE_USER && CURRENT_USER.username !== 'SHIH') { showToast("觀看模式下無法修改！", "error"); return; }
    
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
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userOverrides)
        });
        showToast("資料已同步更新！", "success");
    } catch (e) { showToast("資料上傳失敗", "error"); } 
    finally { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.remove('show');
        if(menuBtn) { menuBtn.disabled = false; menuBtn.style.display = VIEWING_MODE_USER ? 'none' : 'block'; menuBtn.innerText = "🔧 修改班表"; }
        setAppMode(false); refreshCurrentPage(); 
    }
}

// =========== 日曆與頁面渲染 ===========

function refreshCurrentPage() {
    const currentData = getMonthData(currentMonthIndex);
    document.getElementById('currentMonthDisplay').innerText = currentData.label;
    document.getElementById('prevBtn').disabled = false;
    
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

// =========== 日曆生成 ===========
function createCalendarHTML(year, month) {
    const monthContainer = document.createElement('div'); monthContainer.className = 'month-block'; 
    const table = document.createElement('table'); table.className = 'calendar';
    const thead = document.createElement('thead'); const headerRow = document.createElement('tr');
    WEEK_DAYS.forEach(day => { const th = document.createElement('th'); th.innerText = day; headerRow.appendChild(th); });
    thead.appendChild(headerRow); table.appendChild(thead); const tbody = document.createElement('tbody');
    
    let startDay = 1; if (year === 2025 && month === 11) startDay = 17;
    const firstDay = new Date(year, month, startDay); const lastDay = new Date(year, month + 1, 0); 
    let currentDate = startDay; 
    let statsRealized = { days: 0, normal: 0, overtime: 0, standby: 0 }; 
    let statsFuture = { days: 0, normal: 0, overtime: 0, standby: 0 };
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
            
            let isWork = (stats.normal > 0 || stats.overtime > 0); 
            td.className = isWork ? 'is-work' : 'is-rest'; 
            
            // ★★★ 修改：用 stamp-container 把所有的標籤包起來 ★★★
            let stampHtml = '';
            if (stats.labels && stats.labels.length > 0) {
                stampHtml += '<div class="stamp-container">';
                stats.labels.forEach(lbl => {
                    let type = 'type-off';
                    if (lbl.includes('加') || lbl.includes('勤') || lbl.includes('自訂')) type = 'type-add';
                    if (lbl.includes('假') || lbl.includes('休') || lbl.includes('換')) type = 'type-leave';
                    stampHtml += `<div class="stamp ${type}">${lbl}</div>`;
                });
                stampHtml += '</div>';
            }

            let displayShift = dayInfo.shiftCode;
            if (dayInfo.isWork && displayShift) {
                // ★★★ 標記正副班的新舊相容邏輯 ★★★
                if (dayInfo.role) {
                    // 新版：直接吃 getDayInfo 給予的 role
                    if (dayInfo.role === 'main') displayShift += '(正)';
                    else if (dayInfo.role === 'sub') displayShift += '(副)';
                } else {
                    // 舊版：原本寫死的擷取邏輯
                    const myGroupNum = CURRENT_DISPLAY_GROUP.replace(/[^0-9]/g, '');
                    const mainNum = displayShift.charAt(2);
                    const subNum  = displayShift.charAt(1);
                    if (myGroupNum === mainNum) displayShift += '(正)'; 
                    else if (myGroupNum === subNum) displayShift += '(副)';
                }
            }
            
            let line1 = displayShift.split('(')[0]; let line2 = displayShift.includes('(') ? '('+displayShift.split('(')[1] : '';
            
            td.innerHTML = `${stampHtml}<div class="cell-content"><span class="date-num ${isToday?'is-today':''}">${currentDate}</span><div class="shift-group"><span class="shift-upper">${line1}</span><span class="shift-lower">${line2}</span></div></div>`;
        } else { td.innerHTML = `<div class="cell-content"><span class="date-num ${isToday?'is-today':''}">${currentDate}</span></div>`; td.onclick = null; td.className='empty'; }
        row.appendChild(td); currentDate++; dayOfWeek++;
    }
    while (dayOfWeek <= 6) { row.appendChild(document.createElement('td')); dayOfWeek++; }
    tbody.appendChild(row); table.appendChild(tbody);
    
    let statsTotal = {
        days: statsRealized.days + statsFuture.days,
        normal: statsRealized.normal + statsFuture.normal,
        overtime: statsRealized.overtime + statsFuture.overtime,
        standby: statsRealized.standby + statsFuture.standby
    };

    const statsDiv = document.createElement('div'); statsDiv.className = 'month-stats';
    const generateRowHtml = (title, data, colorTitle = '#666') => `
        <div class="stat-group-title" style="color:${colorTitle}; margin-top:10px;">${title}</div>
        <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="stat-card"><span class="stat-label">上班日</span><span class="stat-value">${data.days}</span></div>
            <div class="stat-card"><span class="stat-label">上班時</span><span class="stat-value highlight">${data.normal}</span></div>
            <div class="stat-card"><span class="stat-label">加班時</span><span class="stat-value overtime">${data.overtime}</span></div>
            <div class="stat-card"><span class="stat-label">備勤時</span><span class="stat-value" style="color:#666">${data.standby}</span></div>
        </div>`;
        
    let statsHtml = generateRowHtml('結算至今日 (已發生)', statsRealized, '#d84315'); 
    statsHtml += generateRowHtml('全月總統計 (預估)', statsTotal, '#1565c0');  
    
    statsDiv.innerHTML = statsHtml; 
    monthContainer.appendChild(table); monthContainer.appendChild(statsDiv); 
    return monthContainer;
}

// =========== 休假管理 (儀表板) ===========

function calculateLeaveStats() {
    const currentData = getMonthData(currentMonthIndex);
    const viewYear = currentData.year; 
    const viewMonth = currentData.month + 1; 

    const yearTitle = document.getElementById('statsYearDisplay');
    if (yearTitle) yearTitle.innerText = viewYear;

    let limits = {};
    if (userOverrides[KEY_LEAVE_CONFIG]) {
        try { limits = JSON.parse(userOverrides[KEY_LEAVE_CONFIG]); } catch(e){}
    }
    
    let usage = {}; 
    Object.keys(LEAVE_TYPES).forEach(k => usage[k] = 0);
    let compStats = { used: 0 };

    Object.keys(userOverrides).forEach(key => {
        if (!key.match(/^\d{4}-\d{2}-\d{2}$/)) return;
        const dateParts = key.split('-');
        const dataYear = parseInt(dateParts[0]);
        const dataMonth = parseInt(dateParts[1]);
        const val = userOverrides[key];
        const items = val.split(',');

        items.forEach(item => {
            if (item.includes('|')) {
                const [type, subtype, hoursStr] = item.split('|');
                const hours = parseFloat(hoursStr) || 0;
                if (type === 'leave' && dataYear === viewYear) {
                    if (usage[subtype] !== undefined) usage[subtype] += hours;
                }
                if (type === 'comp' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += hours; 
                }
            } else {
                if (item === 'comp_leave' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += 16; 
                }
            }
        });
    });

    const container = document.getElementById('leaveCardsContainer');
    container.innerHTML = '';

    const reservedKey = `${KEY_RESERVED_PREFIX}${viewYear}_${currentData.month}`;
    const reserved = parseFloat(userOverrides[reservedKey]) || 0;
    const compBalance = reserved - compStats.used;
    const balanceColor = compBalance >= 0 ? '#1976d2' : '#c62828'; 

    const compCard = document.createElement('div');
    compCard.className = 'leave-card comp-card';
    compCard.innerHTML = `
        <div class="l-header">
            <span>🌙</span> 補休
        </div>
        <div class="l-body">
            <div class="l-item">
                預留 <input type="number" id="inputReserved" value="${reserved}" class="mini-input"
                       ${READ_ONLY_MODE ? 'disabled' : ''} oninput="updateCompBalanceLocal()">
            </div>
            <div class="l-item">已用 <span class="l-val">${compStats.used}</span></div>
            <div class="l-item">剩餘 <span id="dynamicCompBalance" class="l-val balance" style="color:${balanceColor}">${compBalance}</span></div>
        </div>
    `;
    container.appendChild(compCard);

    Object.keys(LEAVE_TYPES).forEach(typeKey => {
        const conf = LEAVE_TYPES[typeKey];
        const limit = (limits[typeKey] !== undefined) ? limits[typeKey] : conf.default;
        const used = usage[typeKey];
        const remaining = limit - used;
        const remainColor = remaining >= 0 ? '#333' : '#c62828'; 

        let icon = '📄';
        if(typeKey === 'annual') icon = '🏖️';
        if(typeKey === 'personal') icon = '💼';
        if(typeKey === 'psych') icon = '🏥';
        if(typeKey === 'min_leave') icon = '⚠️';

        const card = document.createElement('div');
        card.className = `leave-card ${conf.color}`;
        card.innerHTML = `
            <div class="l-header"><span>${icon}</span> ${conf.label}</div>
            <div class="l-body">
                <div class="l-item">額度 <span class="l-val">${limit}</span></div>
                <div class="l-item">已用 <span class="l-val">${used}</span></div>
                <div class="l-item">剩餘 <span class="l-val balance" style="color:${remainColor}">${remaining}</span></div>
            </div>
        `;
        container.appendChild(card);
    });
    window.currentCompStats = compStats; 
}

function updateCompBalanceLocal() {
    const input = document.getElementById('inputReserved');
    const display = document.getElementById('dynamicCompBalance');
    if(input && display && window.currentCompStats) {
        const r = parseFloat(input.value) || 0;
        const balance = r - window.currentCompStats.used;
        display.innerText = balance;
        display.style.color = balance >= 0 ? '#1976d2' : '#c62828';
    }
}

// =========== 班表修改 Modal (三階段) ===========

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
    document.getElementById('step2Title').innerText = category === 'work' ? '上班設定' : category === 'overtime' ? '選擇加班' : category === 'comp' ? '選擇補休' : category === 'swap' ? '換班設定' : '選擇假別';

    if (category === 'work') {
        renderOptionBtn('正常上班 (清除)', 'base', 'work_day');
        renderOptionBtn('日勤', 'base', 'work_day');
        renderOptionBtn('夜勤', 'base', 'work_night');
        renderOptionBtn('日休', 'base', 'off_day');
        renderOptionBtn('夜休', 'base', 'off_night');
    } else if (category === 'overtime') {
        renderOptionBtn('所加日 (+8)', 'add', 'add_day');
        renderOptionBtn('所加夜 (+8)', 'add', 'add_night');
        renderOptionBtn('所日夜 (+16)', 'add', 'add_full');
        renderOptionBtn('醫加日 (+8)', 'add', 'hosp_day');
        renderOptionBtn('醫加夜 (+8)', 'add', 'hosp_night');
        renderOptionBtn('醫日夜 (+16)', 'add', 'hosp_dn');
        renderOptionBtn('自訂 (加班/備勤)', 'add_custom', 'custom');
    } else if (category === 'comp') {
        renderOptionBtn('補休全日 (-16)', 'comp_std', 'comp_leave');
        renderOptionBtn('自訂時數', 'comp_custom', 'custom');
    } else if (category === 'leave') {
        Object.keys(LEAVE_TYPES).forEach(k => { renderOptionBtn(LEAVE_TYPES[k].label, 'leave', k); });
    } else if (category === 'swap') {
        renderOptionBtn('換班 (我上班)', 'base', 'swap_work');
        renderOptionBtn('換班 (我休假)', 'base', 'swap_off');
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
    const label1 = document.getElementById('customLabel1');
    const standbyRow = document.getElementById('standbyInputRow');
    
    customArea.style.display = 'none';
    standbyRow.style.display = 'none';
    
    if (type === 'add_custom') {
        customArea.style.display = 'block';
        label1.innerText = "加班時數:";
        standbyRow.style.display = 'block'; 
        document.getElementById('customHourInput').value = 4; 
        document.getElementById('customStandbyInput').value = 0;
    } else if (type === 'leave' || value === 'custom') {
        customArea.style.display = 'block';
        label1.innerText = "輸入時數:"; 
        document.getElementById('customHourInput').value = 4; 
    }
}

function adjustHour(inputId, delta) {
    const input = document.getElementById(inputId);
    let val = parseFloat(input.value) || 0;
    val += delta;
    if (val < 0) val = 0; if (val > 24) val = 24;
    input.value = val;
}

function backToStep1() {
    document.getElementById('modalStep1').style.display = 'block';
    document.getElementById('modalStep2').style.display = 'none';
}

function saveOption() {
    if (!selectedOptionValue) { showToast("請選擇一個項目", "error"); return; }
    let finalValue = selectedOptionValue;
    const customArea = document.getElementById('customHourArea');
    
    if (customArea.style.display !== 'none') {
        const val1 = document.getElementById('customHourInput').value;
        if (modalStep1Selection === 'comp') {
            finalValue = `comp|custom|${val1}`;
        } else if (modalStep1Selection === 'leave') {
            finalValue = `leave|${selectedOptionValue}|${val1}`;
        } else if (modalStep1Selection === 'overtime' && selectedOptionValue === 'custom') {
            const val2 = document.getElementById('customStandbyInput').value;
            finalValue = `add|custom|${val1}|${val2}`;
        }
    }
    
    let currentVal = userOverrides[modalCurrentDateKey] || '';
    if (modalStep1Selection === 'work' || modalStep1Selection === 'swap') {
        userOverrides[modalCurrentDateKey] = finalValue;
    } else { 
        if (currentVal) finalValue = currentVal + ',' + finalValue; 
        userOverrides[modalCurrentDateKey] = finalValue; 
    }
    
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

// =========== 休假設定 ===========
function openLeaveSettings() {
    toggleUserMenu();
    let limits = {};
    if (userOverrides[KEY_LEAVE_CONFIG]) { try { limits = JSON.parse(userOverrides[KEY_LEAVE_CONFIG]); } catch(e){} }
    
    document.getElementById('settingAnnual').value = limits['annual'] || '';
    document.getElementById('settingPersonal').value = limits['personal'] !== undefined ? limits['personal'] : 32;
    document.getElementById('settingPsych').value = limits['psych'] !== undefined ? limits['psych'] : 24;
    
    // ★★★ 修改：移除預設 24，改為空值或使用者設定值 ★★★
    document.getElementById('settingMinLeave').value = limits['min_leave'] || '';
    
    // ★★★ 新增：讀取其他假別設定 ★★★
    document.getElementById('settingOther').value = limits['other'] || '';
    
    document.getElementById('leaveSettingsModal').classList.add('show');
}

function saveLeaveSettings() {
    const limits = {
        'annual': parseFloat(document.getElementById('settingAnnual').value) || 0,
        'personal': parseFloat(document.getElementById('settingPersonal').value) || 0,
        'psych': parseFloat(document.getElementById('settingPsych').value) || 0,
        'min_leave': parseFloat(document.getElementById('settingMinLeave').value) || 0,
        
        // ★★★ 新增：儲存其他假別 ★★★
        'other': parseFloat(document.getElementById('settingOther').value) || 0
    };
    userOverrides[KEY_LEAVE_CONFIG] = JSON.stringify(limits);
    
    if (!document.body.classList.contains('editing-mode')) saveToCloud();
    else showToast("設定已暫存，請記得點擊「儲存並離開」", "info");
    
    closeLeaveSettingsDirect();
    
    // 儲存後自動重整儀表板
    if (document.getElementById('view-stats').classList.contains('active')) calculateLeaveStats();
}

function closeLeaveSettingsDirect() { document.getElementById('leaveSettingsModal').classList.remove('show'); }
function closeLeaveSettings(e) { if(e.target.id === 'leaveSettingsModal') closeLeaveSettingsDirect(); }

// =========== 觀看他人 & 備份功能 ===========
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
    if (!(await showConfirm(`⚠️ 警告！\n確定要刪除 "${targetUser}" 的帳號嗎？\n此動作將自動備份資料到雲端。`))) return;
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    try {
        const res = await fetch(`${API_URL}?action=delete_user&admin_user=${CURRENT_USER.username}&target_user=${targetUser}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { showToast(`已成功刪除 ${targetUser}`, "success"); openUserListModal(); }
        else showToast("刪除失敗：" + json.message, "error");
    } catch(e) { showToast("刪除發生錯誤", "error"); } finally { if(loader) loader.classList.remove('show'); }
}

async function restoreUserAccount(fileId, name) {
    if (!(await showConfirm(`確定要復原 "${name}" 的帳號嗎？`))) return;
    const container = document.getElementById('userListContainer');
    container.innerHTML = '<div class="loading-text">正在復原資料...</div>';
    try {
        const res = await fetch(`${API_URL}?action=restore_user&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { showToast(`成功復原 "${json.username}"！`, "success"); IS_SHOWING_BACKUPS = false; toggleBackupView(); }
        else { showToast("復原失敗：" + json.message, "error"); loadBackupList(); }
    } catch (e) { showToast("復原發生錯誤", "error"); loadBackupList(); }
}

async function permanentDeleteBackup(fileId, name) {
    if (!(await showConfirm(`⚠️ 警告：確定要「永久刪除」 ${name} 的備份嗎？\n(無法復原)`))) return;
    try {
        const res = await fetch(`${API_URL}?action=permanent_delete_backup&admin_user=${CURRENT_USER.username}&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        if (json.result === 'success') { showToast(`已永久刪除 ${name}。`, "success"); loadBackupList(); }
        else showToast("刪除失敗：" + json.message, "error");
    } catch (e) { showToast("網路錯誤", "error"); }
}

function closeUserListModalDirect() { document.getElementById('userListModal').classList.remove('show'); }
function closeUserListModal(e) { if (e.target.id === 'userListModal') closeUserListModalDirect(); }
function exitViewMode() { loadOverrides(null); }

// =========== 勤務表與圖片 ===========
let selectedRosterFile = null; let currentViewingRosterKey = null; 

function handleRosterPreview(event) {
    const file = event.target.files[0];
    const dropZone = document.getElementById('dropZone');
    const placeholder = document.getElementById('uploadPlaceholder');
    const previewBox = document.getElementById('previewBox');
    const previewImg = document.getElementById('uploadPreviewImg');
    const reselectTag = document.getElementById('reselectTag');

    if (file) {
        selectedRosterFile = file; 
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            dropZone.classList.add('has-image');
            placeholder.style.display = 'none';
            previewBox.style.display = 'flex';
            reselectTag.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

async function saveRosterImage() {
    const dateInput = document.getElementById('rosterDateInput');
    if (!dateInput || !dateInput.value) { showToast("請先選擇日期！", "error"); return; }
    if (!selectedRosterFile) { showToast("請先選擇圖片！", "error"); return; }
    if (!CURRENT_USER) { showToast("請先登入", "error"); return; }
    
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image(); img.src = e.target.result;
        img.onload = async function() {
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
                    method: 'POST', mode: 'cors', body: JSON.stringify({ file: dataUrl, name: newFileName })
                });
                const result = await response.json();
                
                if (result.result === 'success') {
                    const fileId = result.fileId;
                    const rosterKey = `roster_${dateInput.value}`;
                    userOverrides[rosterKey] = `DRIVE|${fileId}`;
                    await saveToCloud(); 
                    resetUploadUI(); 
                    renderRosterList();
                } else { showToast("上傳失敗: " + result.error, "error"); }
            } catch (err) { console.error(err); showToast("上傳發生錯誤", "error"); } 
            finally { if(loader) loader.classList.remove('show'); }
        };
    };
    reader.readAsDataURL(selectedRosterFile);
}

function resetUploadUI() {
    selectedRosterFile = null;
    document.getElementById('rosterFileInput').value = '';
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
        img.style.transform = `translate(0px, 0px) scale(1)`;
        imgState = { scale: 1, pX: 0, pY: 0 };
        
        let val = userOverrides[key];
        if (val && val.startsWith('DRIVE|')) {
            const fileId = val.split('|')[1];
            img.src = `http://lh3.googleusercontent.com/d/${fileId}`; 
        } else if (val) { img.src = val; }
        
        initImageGestures(img);
    }
    if(modal) modal.classList.add('show');
}

function initImageGestures(imgElement) {
    const wrapper = document.querySelector('.image-wrapper');
    if (!imgElement || !wrapper) return;
    let startX = 0, startY = 0; let initialPinchDistance = 0;
    let isDragging = false; let isPinching = false;
    let lastScale = 1; let lastPointX = 0; let lastPointY = 0;
    let touchStartTime = 0; let hasMoved = false;
    const newWrapper = wrapper.cloneNode(true);
    wrapper.parentNode.replaceChild(newWrapper, wrapper);
    const newImg = newWrapper.querySelector('img'); 

    newWrapper.addEventListener('touchstart', function(e) {
        hasMoved = false; touchStartTime = new Date().getTime();
        if (e.touches.length === 2) { isPinching = true; isDragging = false; initialPinchDistance = getDistance(e.touches); } 
        else if (e.touches.length === 1) { isPinching = false; isDragging = true; startX = e.touches[0].clientX - lastPointX; startY = e.touches[0].clientY - lastPointY; }
    });

    newWrapper.addEventListener('touchmove', function(e) {
        e.preventDefault(); hasMoved = true; 
        if (isPinching && e.touches.length === 2) {
            const zoomFactor = getDistance(e.touches) / initialPinchDistance;
            imgState.scale = Math.min(Math.max(0.5, lastScale * zoomFactor), 5);
            updateTransform(newImg);
        } else if (isDragging && e.touches.length === 1 && imgState.scale > 1) {
            imgState.pX = e.touches[0].clientX - startX; imgState.pY = e.touches[0].clientY - startY;
            updateTransform(newImg);
        }
    });

    newWrapper.addEventListener('touchend', function(e) {
        lastScale = imgState.scale; lastPointX = imgState.pX; lastPointY = imgState.pY;
        isPinching = false; isDragging = false;
        if (!hasMoved && (new Date().getTime() - touchStartTime) < 300 && e.touches.length === 0) closeImageModalDirect();
        if (imgState.scale < 1) {
            imgState.scale = 1; imgState.pX = 0; imgState.pY = 0; lastScale = 1; lastPointX = 0; lastPointY = 0;
            updateTransform(newImg);
        }
    });

    function updateTransform(el) { el.style.transform = `translate(${imgState.pX}px, ${imgState.pY}px) scale(${imgState.scale})`; }
    function getDistance(touches) { return Math.sqrt(Math.pow(touches[0].clientX - touches[1].clientX, 2) + Math.pow(touches[0].clientY - touches[1].clientY, 2)); }
}

async function deleteCurrentRoster() {
    if (!currentViewingRosterKey) return;
    const isAdmin = (CURRENT_USER && CURRENT_USER.username === 'SHIH');
    const isOwner = (!VIEWING_MODE_USER); 
    if (!isOwner && !isAdmin) { showToast("您沒有權限刪除他人的勤務表", "error"); return; }

    if (await showConfirm("確定要刪除這張勤務表嗎？\n(雲端檔案也將一併刪除)")) { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.add('show');
        const val = userOverrides[currentViewingRosterKey];
        if (val && val.startsWith('DRIVE|')) {
            try { await fetch(`${API_URL}?action=delete_drive_file&file_id=${val.split('|')[1]}`, { method: 'POST' }); } catch (e) {}
        }
        delete userOverrides[currentViewingRosterKey]; 
        closeImageModalDirect(); 
        try { await saveToCloud(); } catch (e) { showToast("存檔發生錯誤", "error"); } finally { if(loader) loader.classList.remove('show'); }
    }
}
function closeImageModalDirect() { 
    const modal = document.getElementById('imageViewerModal');
    if(modal) { modal.classList.remove('show'); setTimeout(() => { modal.style.display = ''; }, 300); }
    currentViewingRosterKey = null; 
}

// =========== 導航與模式 ===========
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
    if (READ_ONLY_MODE) { setAppMode(true); showToast("已進入修改模式\n完成後請點選「儲存並離開」", "info"); }
    else { saveToCloud(); }
}

function switchTab(tabName) {
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.view-section');
    tabs.forEach(t => t.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    
    if (tabName === 'calendar') { document.getElementById('view-calendar').classList.add('active'); tabs[0].classList.add('active'); renderCalendar(); }
    else if (tabName === 'stats') { document.getElementById('view-stats').classList.add('active'); tabs[1].classList.add('active'); calculateLeaveStats(); }
    else if (tabName === 'image') { 
        document.getElementById('view-image').classList.add('active'); tabs[2].classList.add('active'); renderRosterList(); 
        const dateInput = document.getElementById('rosterDateInput');
        if (dateInput && !dateInput.value) {
            const today = new Date();
            dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        }
    }
    refreshCurrentPage(); 
}

let touchStartX = 0; let touchStartY = 0; const minSwipeDistance = 100; const maxVerticalDistance = 60; 
const calendarContainer = document.querySelector('.container');
calendarContainer.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, false);
calendarContainer.addEventListener('touchend', function(e) {
    const distanceX = e.changedTouches[0].screenX - touchStartX;
    const distanceY = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(distanceX) > minSwipeDistance && Math.abs(distanceY) < maxVerticalDistance) {
        if (distanceX < 0) changeMonth(1); else changeMonth(-1);
    }
}, false);

jumpToToday();
checkAuth();