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

// ★ 動態更新搭班選項 (例如甲2，就只能選 1 或 3)
function updatePartnerOptions() {
    const grp = document.getElementById('setupGroup').value || '甲2';
    const num = grp.replace(/[^0-9]/g, '');
    const partnerSelect = document.getElementById('setupPartner');
    partnerSelect.innerHTML = '';
    ['1', '2', '3'].forEach(n => {
        if (n !== num) {
            const opt = document.createElement('option');
            opt.value = n;
            opt.innerText = `第 ${n} 組`;
            partnerSelect.appendChild(opt);
        }
    });
}

function openSetupModal() {
    toggleUserMenu(); 
    let unit = '';
    let currentGrp = CURRENT_USER ? CURRENT_USER.group : '甲2';
    let currentPartner = '';
    let currentCycle = '6'; // ★ 預設為 6 天一輪

    if (userOverrides['config_setup']) {
        try {
            const config = JSON.parse(userOverrides['config_setup']);
            unit = config.unit || '';
            if (config.customGroup) currentGrp = config.customGroup;
            if (config.partner) currentPartner = config.partner;
            if (config.cycle) currentCycle = config.cycle; // ★ 讀取設定
        } catch(e) {}
    }
    
    document.getElementById('setupUnit').value = unit;
    document.getElementById('setupGroup').value = currentGrp;
    document.getElementById('setupCycle').value = currentCycle; // ★ 帶入選單
    
    updatePartnerOptions(); 
    if (currentPartner) document.getElementById('setupPartner').value = currentPartner;
    
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

// ★ 注意：前面加了 async
async function submitSetup() {
    const unit = document.getElementById('setupUnit').value.trim();
    const newGroup = document.getElementById('setupGroup').value;
    const partner = document.getElementById('setupPartner').value;
    const cycle = document.getElementById('setupCycle').value; // ★ 抓取新規律
    const dateStr = document.getElementById('setupDate').value;
    const shiftType = document.getElementById('setupShiftType').value; 
    
    if(!unit || !dateStr || !shiftType || !newGroup || !partner || !cycle) { showToast("請填寫完整", "error"); return; }
    
    if (userOverrides['config_setup']) {
        const confirmMsg = "⚠️ 警告：重新設定將會套用新規則，並「改變過去所有的預設班別」！\n\n(您手動疊加的休假與加班紀錄不會消失，但底層推算會全變)\n\n若只是想看別組班表，請使用「👀 觀看他人」功能。\n\n您確定要覆蓋設定嗎？";
        if (!(await showConfirm(confirmMsg))) return;
    }
    
    const selectedDate = new Date(dateStr);
    selectedDate.setHours(0,0,0,0);
    
    const config = {
        unit: unit,
        anchorTime: selectedDate.getTime(),
        shiftType: shiftType, 
        isNewMainSubRule: true,
        customGroup: newGroup, 
        partner: partner,
        cycle: cycle // ★ 存入設定
    };
    
    userOverrides['config_setup'] = JSON.stringify(config);

    if (CURRENT_USER) CURRENT_USER.group = newGroup;
    CURRENT_DISPLAY_GROUP = newGroup;
    localStorage.setItem('shifts_group', newGroup);

    saveToCloud(true);
    closeSetupModal();
    updateUserInfoUI();
    refreshCurrentPage();
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
                
                // ★★★ 讀取循環長度 (6天 或 9天) ★★★
                let cycleLen = parseInt(setup.cycle) === 9 ? 9 : 6;
                        
                let personalIndex = diffDays % cycleLen;
                if (personalIndex < 0) personalIndex += cycleLen;
                
                // ★★★ 判斷是否為上班日 ★★★
                let isWork = false;
                if (cycleLen === 6) isWork = (personalIndex === 0 || personalIndex === 2);
                if (cycleLen === 9) isWork = (personalIndex === 0 || personalIndex === 2 || personalIndex === 4);
                
                if (isWork) {
                    let isFirstDayMain = (setup.shiftType === 'main');
                    let currentRole = '';
                    
                    let prefix = myGroup.charAt(0) || '甲';
                    let num = myGroup.replace(/[^0-9]/g, '');
                    
                    let partnerDay0 = setup.partner || '1'; 
                    let partnerDay2 = ['1', '2', '3'].find(x => x !== num && x !== partnerDay0);
                    
                    let activePartner = partnerDay0; // 預設搭班
                    
                    // ★ 智慧派配正副班與搭班對象 (支援第三天上班自動輪替)
                    if (personalIndex === 0) {
                        currentRole = isFirstDayMain ? 'main' : 'sub';
                        activePartner = partnerDay0;
                    } else if (personalIndex === 2) {
                        currentRole = isFirstDayMain ? 'sub' : 'main';
                        activePartner = partnerDay2;
                    } else if (personalIndex === 4) {
                        currentRole = isFirstDayMain ? 'main' : 'sub';
                        activePartner = partnerDay0; // 9天循環的第三天，搭班對象換回來
                    }
                    
                    let shiftCode = '';
                    if ((num === '1' && activePartner === '2') || (num === '2' && activePartner === '1')) shiftCode = prefix + '12';
                    else if ((num === '2' && activePartner === '3') || (num === '3' && activePartner === '2')) shiftCode = prefix + '23';
                    else if ((num === '3' && activePartner === '1') || (num === '1' && activePartner === '3')) shiftCode = prefix + '31';
                    else shiftCode = myGroup; 
                    
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
            // ★★★ 新增：解析全自訂標籤 ★★★
            if (type === 'custom' && (subtype === 'add' || subtype === 'off')) {
                const customLabel = parts[2];
                const wk = parseFloat(parts[3]) || 0;
                const sb = parseFloat(parts[4]) || 0;
                
                if (subtype === 'add') {
                    overtime += wk; add_standby += sb;
                    // 在標籤前面加上特殊記號 ++ 供前端渲染判定顏色
                    labels.push(`++${customLabel}${wk > 0 ? wk + 'h' : ''}`); 
                } else if (subtype === 'off') {
                    base_normal -= wk; base_standby -= sb;
                    // 加上特殊記號 -- 判定顏色
                    labels.push(`--${customLabel}${wk > 0 ? wk + 'h' : ''}`);
                }
            }
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
            updateUserInfoUI();
            jumpToToday();
            READ_ONLY_MODE = false;
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
        
        // ★★★ 新增：如果有自訂變更過組別，優先使用新組別 ★★★
        if (userOverrides['config_setup']) {
            try {
                const setup = JSON.parse(userOverrides['config_setup']);
                if (setup.customGroup && !targetUsername) {
                    CURRENT_USER.group = setup.customGroup;
                    CURRENT_DISPLAY_GROUP = setup.customGroup;
                    localStorage.setItem('shifts_group', setup.customGroup);
                }
            } catch(e) {}
        }
        
        if (userOverrides['config_setup']) {
            try {
                const setup = JSON.parse(userOverrides['config_setup']);
                if (setup.customGroup) {
                    CURRENT_USER.group = setup.customGroup;
                    CURRENT_DISPLAY_GROUP = setup.customGroup;
                    localStorage.setItem('shifts_group', setup.customGroup);
                }
            } catch(e) {}
        }
        
        if (targetUsername) {
            VIEWING_MODE_USER = targetUsername;
            document.getElementById('viewingOtherAlert').style.display = 'flex';
            document.getElementById('viewingTargetName').innerText = targetUsername;
            READ_ONLY_MODE = true; // 觀看別人：鎖定
        } else {
            VIEWING_MODE_USER = null;
            document.getElementById('viewingOtherAlert').style.display = 'none';
            READ_ONLY_MODE = false; // ★★★ 觀看自己：永遠解鎖 ★★★
        }
        refreshCurrentPage();
        updateUserInfoUI();

        if (!targetUsername && !userOverrides['config_setup'] && Object.keys(userOverrides).filter(k => k !== '_userGroup').length === 0) {
            openSetupModal();
        }
    } catch (e) { console.error("Load Error:", e); } 
    finally { if(loader) loader.classList.remove('show'); }
}

// =========== 背景自動儲存機制 ===========
async function saveToCloud(silent = false) {
    if (!CURRENT_USER) return;
    let targetUsername = VIEWING_MODE_USER || CURRENT_USER.username;
    if (VIEWING_MODE_USER && CURRENT_USER.username !== 'SHIH') { 
        if(!silent) alert("觀看模式下無法修改！"); 
        return; 
    }

    const inputR = document.getElementById('inputReserved');
    if(inputR && !READ_ONLY_MODE) {
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
        
        // 如果不是靜默模式，才跳出提示
        if (!silent) alert("✅ 資料已同步更新！");
        
    } catch (e) { 
        console.error(e); 
        if (!silent) alert("❌ 上傳失敗"); 
    } finally { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.remove('show');
        refreshCurrentPage(); 
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
    
    // ★ 新增：如果年度班表開著，也順便即時更新它！
    const annualModal = document.getElementById('annualModal');
    if (annualModal && annualModal.classList.contains('show')) {
        renderAnnualCalendar();
    }
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
            
            // ★★★ 修改：智慧判定印章顏色 (支援全自訂特規記號) ★★★
            let stampHtml = '';
            if (stats.labels && stats.labels.length > 0) {
                stampHtml += '<div class="stamp-container">';
                stats.labels.forEach(lbl => {
                    let typeClass = 'type-off';
                    let displayText = lbl;
                    
                    // 攔截並剝除自訂標籤的顏色記號
                    if (lbl.startsWith('++')) {
                        typeClass = 'type-add';
                        displayText = lbl.substring(2);
                    } else if (lbl.startsWith('--')) {
                        typeClass = 'type-leave';
                        displayText = lbl.substring(2);
                    } else {
                        // 原本的系統預設關鍵字判定
                        if (lbl.includes('加') || lbl.includes('勤') || lbl.includes('自訂')) typeClass = 'type-add';
                        if (lbl.includes('假') || lbl.includes('休') || lbl.includes('換')) typeClass = 'type-leave';
                    }
                    
                    stampHtml += `<div class="stamp ${typeClass}">${displayText}</div>`;
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

    const statsDiv = document.createElement('div'); 
    statsDiv.className = 'month-stats';

    // ★★★ 新增：摺疊按鈕與內容區塊 ★★★
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'stats-toggle-btn';
    toggleBtn.innerHTML = `<span>📊 當月結算與統計</span><span class="toggle-icon">▼</span>`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'stats-content-wrapper';
    contentDiv.style.display = 'none'; // 預設摺疊起來不顯示

    toggleBtn.onclick = () => {
        const isHidden = contentDiv.style.display === 'none';
        contentDiv.style.display = isHidden ? 'block' : 'none';
        toggleBtn.querySelector('.toggle-icon').innerText = isHidden ? '▲' : '▼';
    };

    const generateRowHtml = (title, data, colorTitle = '#666') => `
        <div class="stat-group-title" style="color:${colorTitle}; margin-top:10px;">${title}</div>
        <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="stat-card"><span class="stat-label">日數</span><span class="stat-value">${data.days}</span></div>
            <div class="stat-card"><span class="stat-label">正常</span><span class="stat-value highlight">${data.normal}</span></div>
            <div class="stat-card"><span class="stat-label">加班</span><span class="stat-value overtime">${data.overtime}</span></div>
            <div class="stat-card"><span class="stat-label">備勤</span><span class="stat-value" style="color:#666">${data.standby}</span></div>
        </div>`;
        
    let statsHtml = generateRowHtml('已實現 (包含今日)', statsRealized, '#d84315');
    statsHtml += generateRowHtml('全月總計 (預估)', statsTotal, '#1565c0');
    
    contentDiv.innerHTML = statsHtml;
    statsDiv.appendChild(toggleBtn);
    statsDiv.appendChild(contentDiv);

    monthContainer.appendChild(table); 
    monthContainer.appendChild(statsDiv);
    
    return monthContainer;
}

// ★★★ 休假管理邏輯 (極簡橫條版 - 支援點擊看明細) ★★★
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
    let leaveHistory = {}; // ★ 新增：儲存各假別的歷史紀錄
    Object.keys(LEAVE_TYPES).forEach(k => { 
        usage[k] = 0; 
        leaveHistory[k] = []; 
    });
    
    let compStats = { used: 0 };
    let compHistory = []; // ★ 新增：儲存補休的歷史紀錄

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
                
                // 年度假別：只要年份對就累計，並存入歷史
                if (type === 'leave' && dataYear === viewYear) {
                    if (usage[subtype] !== undefined) {
                        usage[subtype] += hours;
                        leaveHistory[subtype].push({ date: key, hours: hours });
                    }
                }
                // 補休：年份跟月份都要對，並存入歷史
                if (type === 'comp' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += hours; 
                    compHistory.push({ date: key, hours: hours });
                }
            } else {
                if (item === 'comp_leave' && dataYear === viewYear && dataMonth === viewMonth) {
                    compStats.used += 16; 
                    compHistory.push({ date: key, hours: 16 });
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
    // ★ 綁定點擊事件：呼叫明細視窗
    compCard.onclick = () => openLeaveDetail('comp', '補休', `${viewMonth}月`);
    compCard.innerHTML = `
        <div class="l-header"><span>🌙</span> 補休</div>
        <div class="l-body">
            <div class="l-item">
                預留 <input type="number" id="inputReserved" value="${reserved}" 
                       class="mini-input" ${READ_ONLY_MODE ? 'disabled' : ''}
                       oninput="updateCompBalanceLocal()"
                       onchange="saveToCloud(true)"
                       onclick="event.stopPropagation()"> </div>
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
        // ★ 綁定點擊事件：呼叫明細視窗
        card.onclick = () => openLeaveDetail(typeKey, conf.label, `${viewYear}年度`);
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
    
    // 將歷史資料存入全域供點擊時讀取
    window.currentCompStats = compStats; 
    window.currentLeaveHistory = leaveHistory; 
    window.currentCompHistory = compHistory; 
}

// ★★★ 開啟休假明細視窗 ★★★
function openLeaveDetail(typeKey, typeLabel, periodLabel) {
    const modal = document.getElementById('leaveDetailModal');
    const titleEl = document.getElementById('leaveDetailTitle');
    const listEl = document.getElementById('leaveDetailList');

    if(!modal || !titleEl || !listEl) return;

    titleEl.innerText = `${typeLabel}明細 (${periodLabel})`;

    // 抓取對應的歷史陣列
    let history = [];
    if (typeKey === 'comp') {
        history = window.currentCompHistory || [];
    } else {
        history = (window.currentLeaveHistory && window.currentLeaveHistory[typeKey]) ? window.currentLeaveHistory[typeKey] : [];
    }

    // 依照日期先後排序
    history.sort((a, b) => a.date.localeCompare(b.date));

    if (history.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#999; padding:30px 10px;">目前尚無使用紀錄</div>';
    } else {
        let html = '';
        history.forEach(record => {
            // 將 2026-03-05 轉換成 3/5
            const parts = record.date.split('-');
            const dStr = `${parseInt(parts[1])}月${parseInt(parts[2])}日`; 
            
            html += `
                <div class="detail-list-item">
                    <span class="detail-date">${dStr}</span>
                    <span class="detail-hours">${record.hours} 小時</span>
                </div>
            `;
        });
        listEl.innerHTML = html;
    }
    
    modal.classList.add('show');
}

function closeLeaveDetailDirect() { document.getElementById('leaveDetailModal').classList.remove('show'); }
function closeLeaveDetail(event) { if (event.target.id === 'leaveDetailModal') closeLeaveDetailDirect(); }


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
    
    // 1. 強制重置並隱藏所有輸入區塊
    const fcArea = document.getElementById('fullyCustomArea');
    if (fcArea) fcArea.style.display = 'none';
    const cArea = document.getElementById('customHourArea');
    if (cArea) cArea.style.display = 'none';
    const fcLabel = document.getElementById('fcLabel');
    if (fcLabel) fcLabel.value = ''; 
    if (document.getElementById('fcWorkHour')) document.getElementById('fcWorkHour').value = ''; 
    if (document.getElementById('fcStandbyHour')) document.getElementById('fcStandbyHour').value = ''; 

    // 2. 獲取並顯示當天「目前設定狀態」
    const overrideString = userOverrides[modalCurrentDateKey];
    const dayInfo = getDayInfo(date);
    const statusDiv = document.getElementById('currentDayStatus');
    
    if (statusDiv && dayInfo) {
        if (!overrideString) {
            statusDiv.style.display = 'none';
        } else {
            statusDiv.style.display = 'block';
            
            // ★★★ 修改：直接解析原始字串，並加上獨立的 X 刪除按鈕 ★★★
            const items = overrideString.split(',');
            let labelsHtml = items.map((item, index) => {
                let labelText = item;
                let typeClass = 'base';
                
                // 解析各種類型的設定以轉換為文字
                if (OVERRIDE_RULES[item]) {
                    labelText = OVERRIDE_RULES[item].label;
                    if (OVERRIDE_RULES[item].type === 'add') typeClass = 'add';
                    else if (OVERRIDE_RULES[item].type === 'off') typeClass = 'leave';
                } else if (item.includes('|')) {
                    const parts = item.split('|');
                    if (parts[0] === 'custom' && (parts[1] === 'add' || parts[1] === 'off')) {
                        labelText = parts[2] + (parseFloat(parts[3]) > 0 ? parts[3] + 'h' : '');
                        typeClass = parts[1] === 'add' ? 'add' : 'leave';
                    } else if (parts[0] === 'leave' || parts[0] === 'comp') {
                        let h = parseFloat(parts[2]) || 0;
                        let lbl = parts[0] === 'comp' ? '補休' : (LEAVE_TYPES[parts[1]] ? LEAVE_TYPES[parts[1]].label : parts[1]);
                        labelText = lbl + h + 'h';
                        typeClass = 'leave';
                    } else if (parts[0] === 'add' && parts[1] === 'custom') {
                        labelText = `自訂(+${parseFloat(parts[2])}/${parseFloat(parts[3])})`;
                        typeClass = 'add';
                    }
                }

                // 決定標籤顏色
                let bgColor = '#e0e0e0'; let textColor = '#333';
                if (typeClass === 'add') { bgColor = '#ffebee'; textColor = '#d84315'; }
                else if (typeClass === 'leave') { bgColor = '#f3e5f5'; textColor = '#7b1fa2'; }
                
                // 產生帶有 X 按鈕的標籤 (綁定 deleteSingleOverride)
                return `<span style="background:${bgColor}; color:${textColor}; padding:4px 8px; border-radius:6px; margin:3px; display:inline-flex; align-items:center; font-weight:bold; font-size:0.85rem; border:1px solid ${textColor}40;">
                            ${labelText}
                            <span onclick="event.stopPropagation(); deleteSingleOverride(${index})" style="margin-left:6px; color:#c62828; cursor:pointer; font-size:1.2rem; line-height:0.7; font-weight:900; padding:2px;">×</span>
                        </span>`;
            }).join('');
            
            if (!labelsHtml) labelsHtml = `<span style="color:#888; font-weight:bold;">已清空當日</span>`;
            statusDiv.innerHTML = `<div style="margin-bottom:8px; color:#888; font-weight:bold;">📝 今日已疊加設定：</div><div style="display:flex; flex-wrap:wrap; justify-content:center;">${labelsHtml}</div>`;
        }
    }

    // 3. 顯示初始步驟
    document.getElementById('modalStep1').style.display = 'block';
    document.getElementById('modalStep2').style.display = 'none';
    document.getElementById('optionModal').classList.add('show');
}

// ★★★ 新增：刪除單一疊加設定 ★★★
function deleteSingleOverride(index) {
    if (!modalCurrentDateKey) return;
    let currentVal = userOverrides[modalCurrentDateKey];
    if (!currentVal) return;
    
    // 將字串拆成陣列，刪除指定的索引項目
    let items = currentVal.split(',');
    items.splice(index, 1);
    
    // 如果刪除後陣列空了，就整個清掉該日期；否則重新組裝回去
    if (items.length === 0) {
        delete userOverrides[modalCurrentDateKey];
    } else {
        userOverrides[modalCurrentDateKey] = items.join(',');
    }
    
    // 背景靜默存檔並重繪底下的日曆
    saveToCloud(true);
    refreshCurrentPage();
    
    // 將字串日期 (如 2026-03-05) 轉回 Date 物件，並重新打開 Modal 以刷新上方的標籤
    const parts = modalCurrentDateKey.split('-');
    const refreshDate = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    openModal(refreshDate);
}

function goToStep2(category) {
    modalStep1Selection = category;
    document.getElementById('modalStep1').style.display = 'none';
    document.getElementById('modalStep2').style.display = 'block';
    
    // 控制區塊顯示
    const container = document.getElementById('step2Options');
    container.innerHTML = '';
    container.style.display = category === 'fully_custom' ? 'none' : 'grid'; // 自訂模式隱藏選項網格
    document.getElementById('customHourArea').style.display = 'none';
    document.getElementById('fullyCustomArea').style.display = category === 'fully_custom' ? 'block' : 'none';
    
    // 設定標題
    document.getElementById('step2Title').innerText = category === 'work' ? '上班設定' : category === 'overtime' ? '選擇加班' : category === 'comp' ? '選擇補休' : category === 'swap' ? '換班設定' : category === 'fully_custom' ? '自訂標籤與時數' : '選擇假別';

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
        document.getElementById('customHourInput').value = ''; 
        document.getElementById('customStandbyInput').value = '';
    } else if (type === 'leave' || value === 'custom') {
        customArea.style.display = 'block';
        label1.innerText = "輸入時數:"; 
        document.getElementById('customHourInput').value = ''; 
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
    // ★★★ 新增：全自訂標籤的專屬存檔邏輯 ★★★
    if (modalStep1Selection === 'fully_custom') {
        const label = document.getElementById('fcLabel').value.trim().replace(/[,|]/g, ''); // 防呆: 過濾掉逗號與分隔符號
        if (!label) { showToast("請輸入標籤名稱", "error"); return; }
        
        const type = document.getElementById('fcType').value;
        const wk = parseFloat(document.getElementById('fcWorkHour').value) || 0;
        const sb = parseFloat(document.getElementById('fcStandbyHour').value) || 0;

        // 組裝格式： custom | add或off | 標籤名稱 | 工作時數 | 備勤時數
        const finalValue = `custom|${type}|${label}|${wk}|${sb}`;
        
        // 疊加模式 (允許同一天輸入多個)
        let currentVal = userOverrides[modalCurrentDateKey] || '';
        if (currentVal) userOverrides[modalCurrentDateKey] = currentVal + ',' + finalValue; 
        else userOverrides[modalCurrentDateKey] = finalValue;
        
        closeModalDirect();
        refreshCurrentPage();
        saveToCloud(true);
        
        // 清空輸入框準備下次輸入
        document.getElementById('fcLabel').value = ''; 
        return; 
    }
    // ★★★ 結束 ★★★
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
    saveToCloud(true);
}

function confirmModal(isClear) {
    if (isClear) delete userOverrides[modalCurrentDateKey];
    refreshCurrentPage();
    closeModalDirect();
    saveToCloud(true);
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
    
    closeLeaveSettingsDirect();
    if (document.getElementById('view-stats').classList.contains('active')) calculateLeaveStats();

    // ★★★ 直接執行自動存檔 (取代原本的 if 判斷) ★★★
    saveToCloud(true);
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

// =========== PWA 安裝與引導邏輯 ===========
let deferredPrompt;

// 偷偷攔截 Android 的原生安裝事件
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 阻止系統自己隨便亂彈
    deferredPrompt = e; // 把權限存起來，等我們按按鈕時再用
});

function handleInstallApp() {
    // 檢查是不是「已經在 App 模式內」執行了
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
    
    if (isInStandaloneMode) {
        showToast("您現在已經在使用 App 版本囉！", "success");
        return;
    }

    // 情況 1：安卓系統 (攔截到權限了，直接啟動全自動安裝！)
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            deferredPrompt = null; // 權限只能用一次，用完清空
        });
    } 
    // 情況 2：蘋果系統 (Apple 死都不給權限，只能跳出圖文教學)
    else {
        const userAgent = window.navigator.userAgent.toLowerCase();
        if (/iphone|ipad|ipod/.test(userAgent)) {
            document.getElementById('iosInstallGuide').classList.add('show');
        } else {
            // 情況 3：其他未知的電腦瀏覽器
            showToast("請使用瀏覽器的選單將本頁「加入主畫面」", "info");
        }
    }
}

// 關閉 iOS 教學視窗的輔助函式
function closeIosGuideDirect() { document.getElementById('iosInstallGuide').classList.remove('show'); }
function closeIosGuide(e) { if (e.target.id === 'iosInstallGuide') closeIosGuideDirect(); }

// =========== 下拉更新 (Pull-to-Refresh) 邏輯 ===========
const ptrContainer = document.getElementById('pullToRefresh');
const ptrSpinner = ptrContainer ? ptrContainer.querySelector('.spinner') : null;

if (ptrContainer && ptrSpinner) {
    let ptrStart = 0;
    let isPullingDown = false;

    // 1. 手指碰觸螢幕
    document.addEventListener('touchstart', (e) => {
        const hasOpenModal = document.querySelector('.modal-overlay.show');
        if (window.scrollY === 0 && !hasOpenModal) {
            ptrStart = e.touches[0].clientY;
            isPullingDown = true;
            ptrContainer.style.transition = 'none'; 
            ptrSpinner.classList.remove('refreshing');
        }
    }, { passive: true });

    // 2. 手指滑動中
    document.addEventListener('touchmove', (e) => {
        if (!isPullingDown) return;
        
        let currentY = e.touches[0].clientY;
        let pullDistance = currentY - ptrStart;
        
        if (pullDistance > 0 && window.scrollY === 0) {
            if (e.cancelable) e.preventDefault(); 
            
            // ★ 修改1：增加阻力 (從 2.5 改為 3.5)，必須滑動更長的手指距離，圖示才會拉下來
            let visualDistance = pullDistance / 3.5; 
            if (visualDistance > 90) visualDistance = 90; 
            
            ptrContainer.style.top = (visualDistance - 70) + 'px'; 
            ptrSpinner.style.transform = `rotate(${pullDistance}deg)`; 
        } else {
            isPullingDown = false;
        }
    }, { passive: false });

    // 3. 手指離開螢幕
    document.addEventListener('touchend', (e) => {
        if (!isPullingDown) return;
        isPullingDown = false;
        
        let currentY = e.changedTouches[0].clientY;
        let pullDistance = currentY - ptrStart;
        
        // 同樣套用新的阻力公式
        let visualDistance = pullDistance / 3.5;
        
        ptrContainer.style.transition = 'top 0.3s ease'; 
        
        // ★ 修改2：提高觸發門檻 (從 55 提高到 70)
        // 代表使用者必須很刻意地往下「深拉」，才能觸發更新
        if (visualDistance > 70) {
            ptrContainer.style.top = '20px'; // 讓圈圈懸停在畫面頂端
            ptrSpinner.classList.add('refreshing'); // 開始轉動
            
            // ★ 修改3：延長等待時間 (從 600ms 延長到 1200ms)
            // 讓使用者看清楚旋轉動畫，維持一段時間後再重載網頁
            setTimeout(() => { 
                location.reload(); 
            }, 1200);
        } else {
            // 沒拉到位，彈回隱藏狀態 (防誤觸成功)
            ptrContainer.style.top = '-70px'; 
        }
    });
}

// =========== 複製分享網址邏輯 ===========
function copyShareUrl() {
    // 取得目前的完整網址
    const currentUrl = window.location.href;
    
    // 使用現代瀏覽器的 Clipboard API (適用於大部分手機與新版瀏覽器)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(currentUrl).then(() => {
            showToast("✅ 網址已複製！快去貼給同事吧", "success");
        }).catch(err => {
            showToast("❌ 複製失敗，請手動複製", "error");
        });
    } else {
        // 備用方案：針對舊版瀏覽器或非安全連線環境
        let textArea = document.createElement("textarea");
        textArea.value = currentUrl;
        // 將輸入框藏在畫面外，避免畫面跳動
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            document.execCommand('copy');
            showToast("✅ 網址已複製！快去貼給同事吧", "success");
        } catch (err) {
            showToast("❌ 複製失敗，請手動複製", "error");
        }
        
        textArea.remove(); // 複製完後刪除隱藏的輸入框
    }
}

// =========== 年度班表總覽邏輯 ===========
let currentAnnualYear = new Date().getFullYear();

function openAnnualModal() {
    currentAnnualYear = new Date().getFullYear();
    renderAnnualCalendar();
    document.getElementById('annualModal').classList.add('show');
}

function closeAnnualModalDirect() { document.getElementById('annualModal').classList.remove('show'); }
function closeAnnualModal(e) { if (e.target.id === 'annualModal') closeAnnualModalDirect(); }

function changeAnnualYear(delta) {
    currentAnnualYear += delta;
    const container = document.getElementById('annualCalendarContainer');
    container.innerHTML = '<div style="text-align:center; padding:50px; color:#999; font-weight:bold; font-size:1.2rem;">產生中...</div>';
    
    // 微小延遲讓畫面先更新出「產生中」的字樣
    setTimeout(() => {
        renderAnnualCalendar();
    }, 50);
}

// =========== 極簡蘋果風：年度班表渲染邏輯 ===========
function renderAnnualCalendar() {
    // 同步更新標題
    document.getElementById('annualYearTitle').innerText = `${currentAnnualYear} 年度`;
    document.getElementById('exportYearTitle').innerText = `${currentAnnualYear}年`;
    
    const container = document.getElementById('annualCalendarContainer');
    container.innerHTML = '';
    
    // 一口氣產生 12 個月
    for (let month = 0; month < 12; month++) {
        const monthDiv = document.createElement('div');
        monthDiv.style.display = 'flex';
        monthDiv.style.flexDirection = 'column';
        
        // 幾月標題
        const title = document.createElement('div');
        title.style.fontSize = '1.8rem';
        title.style.fontWeight = 'bold';
        title.style.color = '#fff';
        title.style.marginBottom = '15px';
        title.style.paddingLeft = '5px';
        title.innerText = `${month + 1}月`;
        monthDiv.appendChild(title);
        
        // 數字網格 (7欄)
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
        grid.style.gap = '10px 5px';
        
        const firstDay = new Date(currentAnnualYear, month, 1).getDay();
        const daysInMonth = new Date(currentAnnualYear, month + 1, 0).getDate();
        
        // 填補月初的空白天數
        for(let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            grid.appendChild(empty);
        }
        
        // 產生每一天的數字
        for(let d = 1; d <= daysInMonth; d++) {
            const cell = document.createElement('div');
            cell.style.fontSize = '1.35rem';
            cell.style.fontWeight = '800';
            cell.style.textAlign = 'center';
            cell.style.padding = '5px 0';
            cell.innerText = d;
            
            // 判斷上班或休假
            const date = new Date(currentAnnualYear, month, d);
            const baseInfo = getDayInfo(date);
            let isWork = baseInfo.isWork;
            
            // 疊加判斷：如果當天有手動請假，轉為綠色(休假)；如果加了自訂班，轉為紅色(上班)
            const dateKey = formatDateKey(date);
            const overrideStr = userOverrides[dateKey];
            if (overrideStr) {
               if (overrideStr.includes('leave') || overrideStr.includes('off') || overrideStr.includes('comp')) {
                   isWork = false;
               } else if (overrideStr.includes('add')) {
                   isWork = true;
               }
            }
            
            // 蘋果風格上色
            if (isWork) {
                cell.style.color = '#ff453a'; // iOS 紅色 (上班)
            } else {
                cell.style.color = '#32d74b'; // iOS 綠色 (休假)
            }
            
            grid.appendChild(cell);
        }
        
        monthDiv.appendChild(grid);
        container.appendChild(monthDiv);
    }
}

// =========== 修正版：產生並下載全年度 1~12 月完整照片 ===========
function downloadAnnualImage() {
    const wrapper = document.getElementById('annualExportWrapper');
    const scrollArea = document.getElementById('annualScrollArea');
    if (!wrapper || !scrollArea) return;

    showToast("📸 正在生成全年度高畫質照片，請稍候...", "info");

    // 1. 暫存原本的樣式
    const originalScrollOverflow = scrollArea.style.overflow;
    const originalScrollHeight = scrollArea.style.height;

    // 2. 臨時把滾動區高度解鎖，讓 1~12 月完全展開（畫面會瞬間變長以供拍照）
    scrollArea.style.overflow = 'visible';
    scrollArea.style.height = 'auto';

    // 延遲 300ms 確保 DOM 完成重繪與展開
    setTimeout(() => {
        html2canvas(wrapper, {
            backgroundColor: "#000000", // 確保背景為極簡黑色
            scale: 2,                   // 視網膜等級高畫質
            useCORS: true,
            windowWidth: 1200,          // 確保完整拉寬畫布
            scrollY: 0,
            scrollX: 0
        }).then(canvas => {
            // 3. 拍照完成，立刻將樣式恢復原狀（使用者完全感覺不到變動）
            scrollArea.style.overflow = originalScrollOverflow;
            scrollArea.style.height = originalScrollHeight;

            // 4. 觸發下載照片
            const link = document.createElement('a');
            link.download = `${currentAnnualYear}年_全年度專屬班表.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            showToast("✅ 全年度 1~12 月照片已成功儲存！", "success");
        }).catch(err => {
            // 發生例外時也要恢復樣式
            scrollArea.style.overflow = originalScrollOverflow;
            scrollArea.style.height = originalScrollHeight;
            showToast("❌ 圖片生成失敗", "error");
        });
    }, 300);
}

// =========== 蘋果 iOS 終極破解版：全年度班表照片生成引擎 ===========
function downloadAnnualImage() {
    showToast("📸 正在生成全年度高畫質照片，請稍候...", "info");

    // 1. 確保年度資料是最新的
    if (typeof currentAnnualYear === 'undefined') {
        currentAnnualYear = new Date().getFullYear();
    }
    renderAnnualCalendar();

    // 2. 給予系統一點時間排版
    setTimeout(() => {
        const originalWrapper = document.getElementById('annualExportWrapper');
        if (!originalWrapper) {
            showToast("❌ 找不到年度班表元素", "error");
            return;
        }

        const clone = originalWrapper.cloneNode(true);
        
        // 3. 建立一個透明的隱藏圖層，專門用來讓系統拍照 (繞過畫面捲動限制)
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'fixed';
        tempContainer.style.top = '0';
        tempContainer.style.left = '0';
        tempContainer.style.width = '1000px';
        tempContainer.style.height = 'auto';
        tempContainer.style.zIndex = '-9999';
        tempContainer.style.opacity = '0'; // 隱藏起來但不影響渲染
        tempContainer.style.pointerEvents = 'none';
        
        tempContainer.appendChild(clone);
        document.body.appendChild(tempContainer);

        // 4. 開始拍照
        html2canvas(clone, {
            backgroundColor: "#000000",
            scale: 1.5, // 視網膜畫質
            useCORS: true,
            windowWidth: 1000
        }).then(canvas => {
            document.body.removeChild(tempContainer);
            
            // 轉換成 JPG 圖片
            const imgData = canvas.toDataURL('image/jpeg', 0.9);
            
            // 5. 呼叫專屬的「預覽儲存視窗」
            showImagePreviewModal(imgData);
            showToast("✅ 照片生成完畢！", "success");

        }).catch(err => {
            document.body.removeChild(tempContainer);
            showToast("❌ 圖片生成失敗", "error");
        });
    }, 500);
}

// =========== 專屬預覽儲存視窗 (完美解決 iOS 阻擋下載的問題) ===========
function showImagePreviewModal(imgData) {
    let modal = document.getElementById('capturePreviewModal');
    
    // 如果視窗還沒建立過，就動態產生一個
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'capturePreviewModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '20000'; // 確保在最上層
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 95%; width: 500px; height: 90vh; display: flex; flex-direction: column; background: #1c1c1e; padding: 10px; border-radius: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 5px 15px 5px;">
                    <div style="color: #32d74b; font-weight: 900; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                        <span>✅</span> 請長按下方圖片來儲存
                    </div>
                    <button onclick="document.getElementById('capturePreviewModal').classList.remove('show')" style="background: #3a3a3c; color: white; border: none; border-radius: 50%; width: 35px; height: 35px; font-size: 1.2rem; cursor: pointer; display: flex; justify-content: center; align-items: center;">✕</button>
                </div>
                <div style="flex: 1; overflow-y: auto; border-radius: 8px; border: 1px solid #333; background: #000;">
                    <!-- 加上 webkit-touch-callout 確保蘋果手機可以長按喚出選單 -->
                    <img id="capturePreviewImg" src="" style="width: 100%; height: auto; display: block; user-select: auto; -webkit-touch-callout: default; pointer-events: auto;">
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // 將剛剛拍好的照片塞進視窗中
    const imgEl = document.getElementById('capturePreviewImg');
    imgEl.src = imgData;
    
    // 顯示視窗
    modal.classList.add('show');
}

// =========== 區間工時計算機邏輯 ===========
function calculateRangeHours() {
    const startInput = document.getElementById('rangeStart').value;
    const endInput = document.getElementById('rangeEnd').value;
    const resultDiv = document.getElementById('rangeResult');
    
    if (!startInput || !endInput) {
        showToast("請選擇開始與結束日期！", "error");
        return;
    }
    
    let startDate = new Date(startInput);
    let endDate = new Date(endInput);
    
    // 將時間設為午夜，避免跨時區造成的誤差
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    
    if (startDate > endDate) {
        showToast("結束日期不能早於開始日期！", "error");
        return;
    }
    
    // 限制最大計算範圍為 366 天，避免不小心選錯年份導致手機當機
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays > 366) {
        showToast("計算區間請勿超過一年！", "error");
        return;
    }
    
    // 初始化統計數據
    let totalNormal = 0;
    let totalOvertime = 0;
    let totalStandby = 0;
    let totalWorkDays = 0;
    
    let currentDate = new Date(startDate);
    
    // 每一天逐日掃描 (完全套用日曆介面的底層運算引擎)
    while (currentDate <= endDate) {
        const dateKey = formatDateKey(currentDate);
        const overrideString = userOverrides[dateKey];
        const dayInfo = getDayInfo(currentDate);
        
        if (dayInfo) {
            // stats 裡面會自動扣除請假/補休，加上加班時數
            const stats = calculateDayStats(dayInfo, overrideString);
            
            // 只要當天還有剩下正常時數或加班時數，就判定為「有服勤」
            if (stats.normal > 0 || stats.overtime > 0) totalWorkDays++;
            
            totalNormal += stats.normal;
            totalOvertime += stats.overtime;
            totalStandby += stats.sb;
        }
        
        // 日期加 1 天
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const totalHours = totalNormal + totalOvertime + totalStandby;
    
    // 將結果漂亮地印在畫面上
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; text-align: center;">
            <div style="background: white; padding: 5px; border-radius: 6px; border: 1px solid #eee;">
                <div style="font-size: 0.7rem; color: #888;">總上班日</div>
                <div style="font-weight: bold; color: #333; font-size: 1rem;">${totalWorkDays} <small style="font-size: 0.7rem; font-weight: normal;">天</small></div>
            </div>
            <div style="background: white; padding: 5px; border-radius: 6px; border: 1px solid #eee;">
                <div style="font-size: 0.7rem; color: #888;">正常時數</div>
                <div style="font-weight: bold; color: #1976d2; font-size: 1rem;">${totalNormal} <small style="font-size: 0.7rem; font-weight: normal;">h</small></div>
            </div>
            <div style="background: white; padding: 5px; border-radius: 6px; border: 1px solid #eee;">
                <div style="font-size: 0.7rem; color: #888;">加班時數</div>
                <div style="font-weight: bold; color: #d84315; font-size: 1rem;">${totalOvertime} <small style="font-size: 0.7rem; font-weight: normal;">h</small></div>
            </div>
            <div style="background: white; padding: 5px; border-radius: 6px; border: 1px solid #eee;">
                <div style="font-size: 0.7rem; color: #888;">備勤時數</div>
                <div style="font-weight: bold; color: #666; font-size: 1rem;">${totalStandby} <small style="font-size: 0.7rem; font-weight: normal;">h</small></div>
            </div>
        </div>
        <div style="margin-top: 10px; text-align: center; background: #fff3e0; padding: 8px; border-radius: 6px; color: #e65100; font-weight: 900; font-size: 1.15rem; border: 1px solid #ffe0b2;">
            🚀 總計在勤時間：${totalHours} 小時
        </div>
    `;
}