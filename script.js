// =========== 設定與常數區 ===========
let READ_ONLY_MODE = true; 

let VIEWING_MODE_USER = null; // 新增：紀錄目前正在觀看哪位使用者的班表

// ★★★★★ 請確認 API 網址是否正確 ★★★★★
const API_URL = "https://script.google.com/macros/s/AKfycbwFP4cx-sNYfO8NrP55kK4PI6BeGMl7VylGThNt1AntGo9B-N-XDe1ZqTlusciXVMf-0Q/exec"; 

// 班表週期起始日 (甲/乙班循環的基準點)
const ANCHOR_DATE = new Date(2025, 11, 14); 

// 系統起始月份 (2025年 12月) - 用來計算 index 0
const BASE_YEAR = 2025;
const BASE_MONTH = 11; // 11 代表 12月
const EFFECTIVE_DATE = new Date(2025, 11, 1); 
// ★★★ 新增：用來記錄目前顯示班表的組別 (例如 "甲2") ★★★
let CURRENT_DISPLAY_GROUP = '';

// 當前登入的使用者
let CURRENT_USER = null; 

const KEY_RESERVED_PREFIX = 'stats_reserved_'; 

// ★★★ 修改：移除寫死的 MONTHS 陣列，改用 index 動態計算 ★★★
// currentMonthIndex = 0 代表 2025/12
// currentMonthIndex = 1 代表 2026/01 ... 以此類推
let currentMonthIndex = 0; 

const CYCLE_CONFIG = [
    { isWork: true,  text: '上班' },        
    { isWork: false, text: '休假' },  
    { isWork: true,  text: '上班' },        
    { isWork: false, text: '休假' },  
    { isWork: false, text: '休假' },        
    { isWork: false, text: '休假' }         
];

const SHIFT_CODES = ['甲12', '乙12', '甲23', '乙23', '甲31', '乙31'];
const TOTAL_CYCLE_DAYS = CYCLE_CONFIG.length; 
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const SYSTEM_TODAY = new Date(); 

// ★★★ 新增：各組別的時差設定 (修正版) ★★★
// 這是根據您提供的「甲1甲2 -> 乙1乙2...」規律推算出來的
const GROUP_OFFSETS = {
    '甲2': 0,  // 基準
    '乙2': 1,
    '甲3': 2,
    '乙3': 3,
    '甲1': 4,
    '乙1': 5
};

const OVERRIDE_RULES = {
    'work_day':   { label: '日勤', wk: 8, sb: 2, type: 'base' },
    'work_night': { label: '夜勤', wk: 8, sb: 2, type: 'base' },
    'add_day':    { label: '所加日', wk: 8, sb: 2, type: 'add' }, 
    'add_night':  { label: '所加夜', wk: 8, sb: 2, type: 'add' },
    'add_full':   { label: '所加全', wk: 16, sb: 4, type: 'add' }, 
    'hosp_day':   { label: '醫加日', wk: 8, sb: 2, type: 'add' },  
    'hosp_night': { label: '醫加夜', wk: 8, sb: 6, type: 'add' },  
    'hosp_full':  { label: '醫加全', wk: 24, sb: 0, type: 'add' }, 
    'off_day':    { label: '日休', wk: -8, sb: -1, type: 'off' }, 
    'off_night':  { label: '夜休', wk: -8, sb: -1, type: 'off' }, 
    'comp_leave': { label: '補休', wk: -16, sb: -4, type: 'off' }  
};

let userOverrides = {}; 

// =========== 日期動態計算函式 (新功能) ===========
function getMonthData(index) {
    // 透過 index 推算年份與月份
    let targetDate = new Date(BASE_YEAR, BASE_MONTH + index, 1);
    let y = targetDate.getFullYear();
    let m = targetDate.getMonth(); // 0~11
    
    return {
        year: y,
        month: m,
        label: `${y}/${String(m + 1).padStart(2, '0')}` // 例如 2026/01
    };
}

function calculateIndexFromDate(date) {
    // 計算某個日期對應的 index
    let dy = date.getFullYear() - BASE_YEAR;
    let dm = date.getMonth() - BASE_MONTH;
    return (dy * 12) + dm;
}

// =========== 認證與讀取邏輯 ===========

function checkAuth() {
    const savedUser = localStorage.getItem('shifts_user');
    const savedGroup = localStorage.getItem('shifts_group');
    
    if (savedUser && savedGroup) {
        // 有登入紀錄：直接登入並載入資料
        CURRENT_USER = { username: savedUser, group: savedGroup };
        
        // 這裡確保 CURRENT_DISPLAY_GROUP 有被初始化
        CURRENT_DISPLAY_GROUP = savedGroup; 
        
        document.getElementById('authModal').style.display = 'none';
        updateUserInfoUI();
        loadOverrides(); 
    } else {
        // 無登入紀錄：顯示登入視窗
        document.getElementById('authModal').style.display = 'flex';
        
        // ★★★ 修改重點：將原本在這裡的預設填入代碼刪除 ★★★
        document.getElementById('loginUser').value = ''; // 確保是空的
        document.getElementById('loginPass').value = ''; // 確保是空的
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
            // 1. 設定當前使用者
            CURRENT_USER = json.user;
            
            // 2. 寫入 LocalStorage 供下次自動登入
            localStorage.setItem('shifts_user', CURRENT_USER.username);
            localStorage.setItem('shifts_group', CURRENT_USER.group);
            
            // ★★★ 關鍵修正：登入當下，立刻更新「顯示組別」為該帳號的組別 ★★★
            CURRENT_DISPLAY_GROUP = CURRENT_USER.group;
            
            // 3. 載入資料
            userOverrides = json.data;
            
            document.getElementById('authModal').style.display = 'none';
            updateUserInfoUI();
            
            // 4. 跳轉到今天並刷新畫面
            jumpToToday();
            setAppMode(false);
            
        } else {
            alert("登入失敗：" + json.message);
        }
    } catch(e) { 
        console.error(e); 
        alert("網路錯誤"); 
    } finally { 
        btn.innerText = oldText; btn.disabled = false; 
    }
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
    if (menu) {
        menu.classList.toggle('show');
    }
}

window.addEventListener('click', function(e) {
    const container = document.querySelector('.user-menu-container');
    if (container && !container.contains(e.target)) {
        const menu = document.getElementById('userDropdown');
        if (menu) menu.classList.remove('show');
    }
});

// ★★★ 修改 loadOverrides：支援載入指定對象 ★★★
async function loadOverrides(targetUsername = null) {
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    
    // 決定要讀取誰的資料
    const userToFetch = targetUsername || CURRENT_USER.username;
    
    try {
        const response = await fetch(`${API_URL}?action=read&username=${userToFetch}`);
        const data = await response.json();
        
        // ★★★ 新增：檢查帳號是否被刪除 ★★★
        if (data.result === 'account_deleted') {
            if (targetUsername) {
                // 如果是在看別人，發現別人被刪了
                alert(`使用者 "${targetUsername}" 已不存在（可能已被刪除）。`);
                exitViewMode();
                return;
            } else {
                // 如果是讀取自己，發現自己被刪了
                alert("⚠️ 您的帳號已被刪除，請重新註冊！");
                
                // 強制登出清理資料
                localStorage.removeItem('shifts_user');
                localStorage.removeItem('shifts_group');
                location.reload(); 
                return;
            }
        }

        // 如果是讀自己的資料，順便更新組別
        if (!targetUsername && data._userGroup) {
            CURRENT_USER.group = data._userGroup;
            localStorage.setItem('shifts_group', data._userGroup);
        }
        
        // 更新顯示組別
        if (data._userGroup) {
            CURRENT_DISPLAY_GROUP = data._userGroup;
        } else {
            // 如果這行 data 是舊格式沒有 _userGroup，就用當前使用者
            CURRENT_DISPLAY_GROUP = CURRENT_USER.group;
        }
        
        // 移除回傳資料中的系統欄位，剩下的才是班表資料
        delete data._userGroup;
        
        userOverrides = data;
        
        // 處理介面狀態
        if (targetUsername) {
            // 觀看模式
            VIEWING_MODE_USER = targetUsername;
            document.getElementById('viewingOtherAlert').style.display = 'flex';
            document.getElementById('viewingTargetName').innerText = targetUsername;
            READ_ONLY_MODE = true;
            document.getElementById('menuEditBtn').style.display = 'none';
        } else {
            // 自己模式
            VIEWING_MODE_USER = null;
            document.getElementById('viewingOtherAlert').style.display = 'none';
            document.getElementById('menuEditBtn').style.display = 'block';
        }
        
        refreshCurrentPage();
        setAppMode(false);

    } catch (e) { 
        console.error("Load Error:", e); 
        // 網路錯誤時不強制登出，避免誤判
    } finally { 
        if(loader) loader.classList.remove('show'); 
    }
}

// 全域變數：目前是否在看備份
let IS_SHOWING_BACKUPS = false; 

// 1. 切換：同事列表 <-> 資源回收桶
function toggleBackupView() {
    IS_SHOWING_BACKUPS = !IS_SHOWING_BACKUPS;
    const btn = document.getElementById('toggleBackupBtn');
    const title = document.getElementById('userListTitle');
    
    if (IS_SHOWING_BACKUPS) {
        btn.classList.add('active');
        btn.innerText = '👥 返回列表';
        title.innerText = '已刪除帳號';
        loadBackupList(); // 載入備份檔
    } else {
        btn.classList.remove('active');
        btn.innerText = '♻️ 資源回收桶';
        title.innerText = '同事列表';
        openUserListModal(); // 重新載入正常列表 (其實就是重呼叫一次)
    }
}

// 2. 載入備份列表 (呼叫後端 get_backups)
async function loadBackupList() {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '<div class="loading-text">搜尋備份中...</div>';
    
    try {
        const res = await fetch(`${API_URL}?action=get_backups`);
        const json = await res.json();
        
        if (json.result === 'success') {
            renderBackupList(json.backups);
        } else {
            container.innerHTML = '載入失敗: ' + json.message;
        }
    } catch (e) {
        container.innerHTML = '網路錯誤';
    }
}

// 3. 渲染備份列表
// 修改：渲染備份列表 (加入刪除按鈕)
function renderBackupList(files) {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';
    
    if (files.length === 0) {
        container.innerHTML = '<div class="empty-hint">資源回收桶是空的</div>';
        return;
    }
    
    // 檢查是否為管理員
    const isAdmin = (CURRENT_USER.username === 'SHIH');
    
    files.forEach(f => {
        const div = document.createElement('div');
        div.className = 'user-item';
        
        let displayName = f.name.replace('BACKUP_', '').replace('.json', '');
        let dateStr = new Date(f.date).toLocaleDateString();
        
        // 按鈕區塊
        let buttonsHtml = `
            <button class="restore-btn" onclick="restoreUserAccount('${f.id}', '${displayName}')">
                ↩️ 復原
            </button>
        `;
        
        // ★★★ 如果是管理員，多顯示一個永久刪除按鈕 ★★★
        if (isAdmin) {
            buttonsHtml += `
                <button class="perm-delete-btn" onclick="permanentDeleteBackup('${f.id}', '${displayName}')">
                    🗑️
                </button>
            `;
        }
        
        div.innerHTML = `
            <div class="user-item-info">
                <span class="u-name">${displayName}</span>
                <span class="u-group">備份日: ${dateStr}</span>
            </div>
            <div style="display:flex; gap:5px;">
                ${buttonsHtml}
            </div>
        `;
        container.appendChild(div);
    });
}

// ★★★ 新增：執行永久刪除 ★★★
async function permanentDeleteBackup(fileId, name) {
    if (!confirm(`⚠️ 警告：確定要「永久刪除」 ${name} 的備份嗎？\n\n刪除後將無法再復原此帳號的任何資料！\n(雲端備份檔將被移至垃圾桶)`)) return;
    
    const container = document.getElementById('userListContainer');
    // 顯示讀取中，但不清空整個列表以免閃爍，這裡簡單處理
    const originalText = container.innerHTML; 
    
    try {
        const res = await fetch(`${API_URL}?action=permanent_delete_backup&admin_user=${CURRENT_USER.username}&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        
        if (json.result === 'success') {
            alert(`已永久刪除 ${name} 的備份資料。`);
            loadBackupList(); // 重新整理列表
        } else {
            alert("刪除失敗：" + json.message);
        }
    } catch (e) {
        alert("網路錯誤");
    }
}

// 4. 執行復原
async function restoreUserAccount(fileId, name) {
    if (!confirm(`確定要復原 "${name}" 的帳號嗎？\n復原後，該使用者將可以正常登入並保有之前的資料。`)) return;
    
    const container = document.getElementById('userListContainer');
    container.innerHTML = '<div class="loading-text">正在復原資料...</div>';
    
    try {
        const res = await fetch(`${API_URL}?action=restore_user&file_id=${fileId}`, { method: 'POST' });
        const json = await res.json();
        
        if (json.result === 'success') {
            alert(`✅ 成功復原 "${json.username}"！`);
            // 切換回正常列表查看
            IS_SHOWING_BACKUPS = false; 
            toggleBackupView(); // 這會觸發 UI 更新回正常狀態
        } else {
            alert("❌ 復原失敗：" + json.message);
            loadBackupList(); // 重新載入列表
        }
    } catch (e) {
        alert("復原發生錯誤");
        loadBackupList();
    }
}

// ★★★ 新增：觀看他人相關函式 ★★★

// 1. 開啟人員列表
async function openUserListModal() {
    toggleUserMenu(); // 關閉選單
    // ★★★ 重置狀態 ★★★
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
        
        if (json.result === 'success') {
            renderUserList(json.users);
        } else {
            container.innerHTML = '載入失敗';
        }
    } catch (e) {
        container.innerHTML = '網路錯誤';
    }
}

// 2. 渲染人員列表
function renderUserList(users) {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';
    
    const isAdmin = (CURRENT_USER.username === 'SHIH'); // 判斷是否為管理員
    
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-item';
        
        // 左側：名字與組別 (點擊觀看)
        const infoDiv = document.createElement('div');
        infoDiv.className = 'user-item-info';
        infoDiv.innerHTML = `<span class="u-name">${u.username}</span><span class="u-group">${u.group}</span>`;
        infoDiv.onclick = () => {
            closeUserListModalDirect();
            loadOverrides(u.username); // 載入該使用者資料
        };
        
        div.appendChild(infoDiv);
        
        // 右側：刪除按鈕 (只有 SHIH 看得到，且不能刪自己)
        if (isAdmin && u.username !== 'SHIH') {
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-user-btn';
            delBtn.innerText = '刪除';
            delBtn.onclick = (e) => {
                e.stopPropagation(); // 防止觸發觀看
                deleteUserAccount(u.username);
            };
            div.appendChild(delBtn);
        }
        
        container.appendChild(div);
    });
}

// 3. 刪除帳號 (管理員功能)
async function deleteUserAccount(targetUser) {
    if (!confirm(`⚠️ 警告！\n確定要刪除 "${targetUser}" 的帳號嗎？\n此動作無法復原，對方的班表資料將全部消失！`)) return;
    
    const loader = document.getElementById('loadingOverlay');
    if(loader) loader.classList.add('show');
    
    try {
        const res = await fetch(`${API_URL}?action=delete_user&admin_user=${CURRENT_USER.username}&target_user=${targetUser}`, {
            method: 'POST'
        });
        const json = await res.json();
        if (json.result === 'success') {
            alert(`已成功刪除 ${targetUser}`);
            openUserListModal(); // 重新整理列表
        } else {
            alert("刪除失敗：" + json.message);
        }
    } catch(e) {
        alert("刪除發生錯誤");
    } finally {
        if(loader) loader.classList.remove('show');
    }
}

// 4. 退出觀看模式
function exitViewMode() {
    loadOverrides(null); // 傳入 null 代表載入自己的資料
}

// 5. 關閉視窗相關
function closeUserListModalDirect() {
    document.getElementById('userListModal').classList.remove('show');
}
function closeUserListModal(event) {
    if (event.target.id === 'userListModal') closeUserListModalDirect();
}

// ★★★ 修改 saveToCloud：防止在觀看模式下存檔 ★★★
async function saveToCloud() {
    if (!CURRENT_USER) return;
    
    // 決定要存到「誰」的資料裡
    let targetUsername = VIEWING_MODE_USER || CURRENT_USER.username;

    // 權限檢查
    if (VIEWING_MODE_USER && CURRENT_USER.username !== 'SHIH') {
        alert("觀看模式下無法修改！");
        return;
    }
    
    const menuBtn = document.getElementById('menuEditBtn');
    if(menuBtn) { 
        menuBtn.innerText = "⏳ 儲存中..."; 
        menuBtn.disabled = true; 
    }

    const inputR = document.getElementById('inputReserved');
    if(inputR) {
        const keys = getStatsKeys();
        userOverrides[keys.reserved] = String(inputR.value);
    }
    
    try {
        await fetch(`${API_URL}?action=save&username=${targetUsername}`, {
            method: 'POST', mode: 'no-cors', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userOverrides)
        });
        
        alert("✅ 資料已同步更新！");

    } catch (e) { 
        console.error(e); 
        alert("❌ 上傳失敗，請檢查網路"); 
    } finally { 
        // ★★★ 修正重點：第一件事就是強制關閉 Loading，確保不會卡住 ★★★
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.remove('show');

        // 恢復按鈕狀態
        if(menuBtn) { 
            menuBtn.disabled = false;
            if (VIEWING_MODE_USER) {
                 menuBtn.style.display = 'none';
            } else {
                 menuBtn.innerText = "🔧 修改班表"; 
            }
        }
        
        setAppMode(false); 
        
        // 最後再重新整理畫面 (就算這裡出錯，Loading 也已經關了)
        try {
            refreshCurrentPage(); 
        } catch(err) {
            console.error("刷新頁面失敗", err);
        }
    }
}

// =========== 班表邏輯 ===========

function refreshCurrentPage() {
    // ★★★ 修改：使用 getMonthData 動態取得當月資料 ★★★
    const currentData = getMonthData(currentMonthIndex);
    
    document.getElementById('currentMonthDisplay').innerText = currentData.label;
    
    // 移除「下一頁」的限制
    document.getElementById('prevBtn').disabled = (currentMonthIndex <= 0); // 只能往前回到 2025/12
    document.getElementById('nextBtn').disabled = false; // 無限往後
    
    if (document.getElementById('view-calendar').classList.contains('active')) render(); 
    try { updateStatsUI(); } catch(e) {}
    if (document.getElementById('view-image').classList.contains('active')) renderRosterList();
}

function getStatsKeys() {
    const currentData = getMonthData(currentMonthIndex);
    return { reserved: `stats_reserved_${currentData.year}_${currentData.month}` };
}

function updateStatsUI() {
    const currentData = getMonthData(currentMonthIndex);
    const title = document.getElementById('statsTitle');
    if(title) title.innerText = `${currentData.label} 補休管理`;
    const keys = getStatsKeys();
    const resHours = parseFloat(userOverrides[keys.reserved]) || 0;
    const inputR = document.getElementById('inputReserved');
    if(inputR) {
        if (document.activeElement !== inputR) inputR.value = resHours;
        inputR.disabled = READ_ONLY_MODE;
        inputR.style.backgroundColor = READ_ONLY_MODE ? '#f0f0f0' : 'white';
    }
    calculateMonthlyStats();
}

function calculateMonthlyStats() {
    const currentData = getMonthData(currentMonthIndex);
    const lastDay = new Date(currentData.year, currentData.month + 1, 0).getDate();
    const todayZero = new Date(SYSTEM_TODAY); todayZero.setHours(0,0,0,0);
    let used = 0; let unused = 0;
    for (let day = 1; day <= lastDay; day++) {
        const date = new Date(currentData.year, currentData.month, day);
        const dateKey = formatDateKey(date);
        if (userOverrides[dateKey] && userOverrides[dateKey].includes('comp_leave')) {
            if (date < todayZero) used += 16; else unused += 16;
        }
    }
    const inputUsed = document.getElementById('inputUsed');
    const inputUnused = document.getElementById('inputUnused'); 
    if(inputUsed) inputUsed.value = used;
    if(inputUnused) inputUnused.value = unused;
    calculateBalance();
}

function calculateBalance() {
    const inputR = document.getElementById('inputReserved');
    const inputU = document.getElementById('inputUsed');
    const inputUn = document.getElementById('inputUnused');
    const txtBal = document.getElementById('txtBalance');
    if(!inputR || !inputU || !inputUn || !txtBal) return;
    let r = Number(inputR.value) || 0; let u = Number(inputU.value) || 0; let un = Number(inputUn.value) || 0;
    const balance = r - u - un;
    txtBal.innerText = balance;
    if(balance > 0) txtBal.style.color = '#2e7d32';
    else if(balance < 0) txtBal.style.color = '#c62828';
    else txtBal.style.color = '#333';
}

function formatDateKey(date) { 
    const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); 
    return `${y}-${m}-${d}`; 
}

function getDayInfo(date) {
    if (date < EFFECTIVE_DATE) return null;
    
    const diffTime = date - ANCHOR_DATE; 
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    let globalIndex = diffDays % TOTAL_CYCLE_DAYS;
    if (globalIndex < 0) globalIndex += TOTAL_CYCLE_DAYS;
    
    // ★★★ 修改：直接使用 CURRENT_DISPLAY_GROUP ★★★
    // 這樣不管是看自己還是看別人，都會用正確的組別去算時差
    let userGroup = CURRENT_DISPLAY_GROUP || '甲2'; 
    
    let offset = GROUP_OFFSETS[userGroup];
    if (offset === undefined) offset = 0;

    let personalIndex = (globalIndex - offset) % TOTAL_CYCLE_DAYS;
    if (personalIndex < 0) personalIndex += TOTAL_CYCLE_DAYS;
    
    const config = CYCLE_CONFIG[personalIndex];
    const code = SHIFT_CODES[globalIndex];
    
    return { ...config, shiftCode: code };
}

function calculateDayStats(dayInfo, overrideString) {
    let normalHours = dayInfo.isWork ? 16 : 0; let overtimeHours = 0; let standbyHours = dayInfo.isWork ? 4 : 0;
    if (!overrideString) return { normal: normalHours, overtime: overtimeHours, sb: standbyHours, labels: [] };
    const types = overrideString.split(','); const labels = [];
    const baseType = types.find(t => OVERRIDE_RULES[t] && OVERRIDE_RULES[t].type === 'base');
    if (baseType) { const rule = OVERRIDE_RULES[baseType]; normalHours = rule.wk; standbyHours = rule.sb; labels.push(rule.label); }
    types.forEach(type => {
        const rule = OVERRIDE_RULES[type]; if (!rule || rule.type === 'base') return;
        if (rule.type === 'add') { overtimeHours += rule.wk; standbyHours += rule.sb; labels.push(rule.label); } 
        else if (rule.type === 'off') { normalHours += rule.wk; standbyHours += rule.sb; labels.push(rule.label); }
    });
    if (normalHours < 0) normalHours = 0; if (overtimeHours < 0) overtimeHours = 0; if (standbyHours < 0) standbyHours = 0;
    return { normal: normalHours, overtime: overtimeHours, sb: standbyHours, labels: labels };
}

function createCalendar(year, month) {
    const container = document.getElementById('calendar-container'); if(!container) return;
    const monthContainer = document.createElement('div'); monthContainer.className = 'month-block'; 
    const table = document.createElement('table'); table.className = 'calendar';
    const thead = document.createElement('thead'); const headerRow = document.createElement('tr');
    WEEK_DAYS.forEach(day => { const th = document.createElement('th'); th.innerText = day; headerRow.appendChild(th); });
    thead.appendChild(headerRow); table.appendChild(thead); const tbody = document.createElement('tbody');
    
    let startDay = 1; 
    if (year === 2025 && month === 11) startDay = 17;

    const firstDay = new Date(year, month, startDay); const lastDay = new Date(year, month + 1, 0); 
    let currentDate = startDay; 
    let statsRealized = { days: 0, normal: 0, overtime: 0, standby: 0 }; let statsFuture = { days: 0, normal: 0, overtime: 0, standby: 0 };
    const todayZero = new Date(SYSTEM_TODAY); todayZero.setHours(0,0,0,0);
    let standardDay = firstDay.getDay(); let dayOfWeek = (standardDay + 6) % 7; 
    let row = document.createElement('tr');
    for (let i = 0; i < dayOfWeek; i++) { const td = document.createElement('td'); td.className = 'empty'; row.appendChild(td); }

    while (currentDate <= lastDay.getDate()) {
        if (dayOfWeek > 6) { tbody.appendChild(row); row = document.createElement('tr'); dayOfWeek = 0; }
        const currentFullDate = new Date(year, month, currentDate); currentFullDate.setHours(0,0,0,0);
        const dateKey = formatDateKey(currentFullDate); const overrideString = userOverrides[dateKey];
        const dayInfo = getDayInfo(currentFullDate); const isToday = (currentFullDate.getTime() === todayZero.getTime());
        const td = document.createElement('td'); td.onclick = function() { openModal(currentFullDate); };

        if (dayInfo) {
            const stats = calculateDayStats(dayInfo, overrideString);
            let targetStats = (currentFullDate <= todayZero) ? statsRealized : statsFuture;
            if (stats.normal > 0 || stats.overtime > 0) targetStats.days++;
            targetStats.normal += stats.normal; targetStats.overtime += stats.overtime; targetStats.standby += stats.sb;
            let isWork = (stats.normal > 0); td.className = isWork ? 'is-work' : 'is-rest'; const todayClass = isToday ? 'is-today' : '';
            
            let stampHtml = '';
            if (stats.labels.length > 0) {
                const labelContent = stats.labels.map(text => `<div>${text}</div>`).join('');
                let stampType = 'type-off'; if (overrideString && (overrideString.includes('add') || overrideString.includes('hosp') || overrideString.includes('work'))) stampType = 'type-add';
                stampHtml = `<div class="stamp ${stampType}">${labelContent}</div>`;
            }

            // ★★★ 修改重點：自動判斷 正班/副班 ★★★
            let displayShift = dayInfo.shiftCode; // 取得原始代碼，例如 "甲12"

            if (dayInfo.isWork) {
                // 1. 取得目前顯示組別的數字 (例如 "甲2" -> "2")
                // 使用 replace 濾掉非數字的字元，確保拿到純數字
                const myGroupNum = CURRENT_DISPLAY_GROUP.replace(/[^0-9]/g, '');
                
                // 2. 取得班表代碼的兩個數字 (例如 "甲12" -> sub="1", main="2")
                // 假設格式固定是：中文 + 數字1 + 數字2
                const subNum = displayShift.charAt(1);  // 第一個數字是副班
                const mainNum = displayShift.charAt(2); // 第二個數字是正班

                // 3. 比對
                if (myGroupNum === mainNum) {
                    displayShift += '(正)';
                } else if (myGroupNum === subNum) {
                    displayShift += '(副)';
                }
            }

            // 處理換行顯示 (如果字串太長)
            let line1 = displayShift; let line2 = ''; 
            if (displayShift.includes('(')) { 
                line1 = displayShift.split('(')[0]; 
                line2 = '(' + displayShift.split('(')[1]; 
            }

            td.innerHTML = `${stampHtml}<div class="cell-content"><span class="date-num ${todayClass}">${currentDate}</span><div class="shift-group"><span class="shift-upper">${line1}</span><span class="shift-lower">${line2}</span></div></div>`;
        } else { const todayClass = isToday ? 'is-today' : ''; td.innerHTML = `<div class="cell-content"><span class="date-num ${todayClass}">${currentDate}</span></div>`; td.onclick = null; td.style.cursor = 'default'; }
        row.appendChild(td); currentDate++; dayOfWeek++;
    }
    while (dayOfWeek <= 6) { const td = document.createElement('td'); td.className = 'empty'; row.appendChild(td); dayOfWeek++; }
    tbody.appendChild(row); table.appendChild(tbody);
    
    // 下方的統計區塊保持不變
    const statsDiv = document.createElement('div'); statsDiv.className = 'month-stats';
    const viewDate = new Date(year, month, 1);
    const isPastMonth = viewDate.getFullYear() < todayZero.getFullYear() || (viewDate.getFullYear() === todayZero.getFullYear() && viewDate.getMonth() < todayZero.getMonth());
    let statsHtml = '';
    const generateRowHtml = (title, data, colorTitle = '#666') => `
        <div class="stat-group-title" style="color:${colorTitle}; margin-top:10px;">${title}</div>
        <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="stat-card"><span class="stat-label">上班天</span><span class="stat-value">${data.days}<small> 天</small></span></div>
            <div class="stat-card"><span class="stat-label">正班時</span><span class="stat-value highlight">${data.normal}<small> hr</small></span></div>
            <div class="stat-card"><span class="stat-label">加班時</span><span class="stat-value overtime">${data.overtime}<small> hr</small></span></div>
            <div class="stat-card"><span class="stat-label">備勤時</span><span class="stat-value" style="color:#666">${data.standby}<small> hr</small></span></div>
        </div>`;
    if (isPastMonth) statsHtml += generateRowHtml('本月統計 (已結算)', statsRealized);
    else { statsHtml += generateRowHtml('累積至今日', statsRealized); statsHtml += generateRowHtml('未來排定', statsFuture, '#2196f3'); }
    statsDiv.innerHTML = statsHtml; monthContainer.appendChild(table); monthContainer.appendChild(statsDiv); 
    return monthContainer;
}

function render() {
    const container = document.getElementById('calendar-container'); if(!container) return;
    container.innerHTML = ''; 
    // ★★★ 修改：使用動態資料 ★★★
    const currentData = getMonthData(currentMonthIndex);
    container.appendChild(createCalendar(currentData.year, currentData.month));
}

// =========== Modal & 互動邏輯 ===========
let selectingDateKey = null; let currentSelection = new Set(); 
function openModal(date) {
    if (READ_ONLY_MODE) return;
    selectingDateKey = formatDateKey(date);
    const y = date.getFullYear(); const m = date.getMonth() + 1; const d = date.getDate();
    const title = document.getElementById('modalDateTitle'); if(title) title.innerText = `${y}/${m}/${d}`;
    currentSelection.clear();
    const currentVal = userOverrides[selectingDateKey];
    if (currentVal) currentVal.split(',').forEach(v => currentSelection.add(v));
    updateModalButtons();
    const modal = document.getElementById('optionModal'); if(modal) modal.classList.add('show');
}
function toggleOption(option) {
    if (currentSelection.has(option)) currentSelection.delete(option);
    else {
        const rule = OVERRIDE_RULES[option];
        if (rule && rule.type === 'base') { for (let item of currentSelection) if (OVERRIDE_RULES[item] && OVERRIDE_RULES[item].type === 'base') currentSelection.delete(item); }
        currentSelection.add(option);
    }
    updateModalButtons();
}
function updateModalButtons() {
    document.querySelectorAll('.option-btn').forEach(btn => {
        const onClickText = btn.getAttribute('onclick'); const match = onClickText.match(/'([^']+)'/);
        if (match) { const optionValue = match[1]; if (currentSelection.has(optionValue)) btn.classList.add('selected'); else btn.classList.remove('selected'); }
    });
}
function confirmModal(isClear) {
    if (isClear) delete userOverrides[selectingDateKey];
    else { if (currentSelection.size > 0) userOverrides[selectingDateKey] = Array.from(currentSelection).join(','); else delete userOverrides[selectingDateKey]; }
    refreshCurrentPage();
    closeModalDirect();
}
function closeModalDirect() { const modal = document.getElementById('optionModal'); if(modal) modal.classList.remove('show'); }
function closeModal(event) { if (event.target.id === 'optionModal') closeModalDirect(); }

// 圖片上傳與瀏覽
let selectedRosterFile = null; let currentViewingRosterKey = null; 
function handleRosterSelect(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('fileNameDisplay');
    if (file) { selectedRosterFile = file; if(nameDisplay) nameDisplay.innerText = file.name; }
}

async function saveRosterImage() {
    const dateInput = document.getElementById('rosterDateInput');
    const fileInput = document.getElementById('rosterFileInput');
    const nameDisplay = document.getElementById('fileNameDisplay');
    const loader = document.getElementById('loadingOverlay');

    if (!dateInput || !dateInput.value) { alert("請先選擇日期！"); return; }
    if (!selectedRosterFile) { alert("請先選擇圖片！"); return; }
    if (!CURRENT_USER) { alert("請先登入"); return; }
    
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
                    method: 'POST', mode: 'cors',
                    body: JSON.stringify({ file: dataUrl, name: newFileName })
                });
                const result = await response.json();
                
                if (result.result === 'success') {
                    const fileId = result.fileId;
                    const rosterKey = `roster_${dateInput.value}`;
                    userOverrides[rosterKey] = `DRIVE|${fileId}`;
                    await saveToCloud();
                    selectedRosterFile = null; 
                    if(fileInput) fileInput.value = ''; 
                    if(nameDisplay) nameDisplay.innerText = '未選擇檔案';
                    renderRosterList();
                } else { alert("上傳失敗: " + result.error); }
            } catch (err) { console.error(err); alert("上傳發生錯誤"); } 
            finally { if(loader) loader.classList.remove('show'); }
        };
    };
    reader.readAsDataURL(selectedRosterFile);
}

function renderRosterList() {
    const container = document.getElementById('rosterListContainer'); if(!container) return;
    container.innerHTML = '';
    // ★★★ 修改：動態取得當月資料 ★★★
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

function openImageModal(key, dateStr) {
    currentViewingRosterKey = key; 
    const title = document.getElementById('viewerDateTitle');
    const img = document.getElementById('viewerImage');
    const modal = document.getElementById('imageViewerModal');
    
    if(title) title.innerText = dateStr;
    if(img) {
        img.src = '';
        let val = userOverrides[key];
        if (val && val.startsWith('DRIVE|')) {
            const fileId = val.split('|')[1];
            img.src = `https://lh3.googleusercontent.com/d/${fileId}=s2000`; 
        } else if (val) {
            img.src = val;
        }
    }
    if(modal) modal.classList.add('show');
}
async function deleteCurrentRoster() {
    if (!currentViewingRosterKey) return;

    const isAdmin = (CURRENT_USER && CURRENT_USER.username === 'SHIH');
    const isOwner = (!VIEWING_MODE_USER); 

    if (!isOwner && !isAdmin) {
        alert("您沒有權限刪除他人的勤務表");
        return;
    }

    if (confirm("確定要刪除這張勤務表嗎？\n(雲端檔案也將一併刪除)")) { 
        const loader = document.getElementById('loadingOverlay');
        if(loader) loader.classList.add('show');

        // 1. 嘗試刪除雲端硬碟上的檔案
        const val = userOverrides[currentViewingRosterKey];
        if (val && val.startsWith('DRIVE|')) {
            const fileId = val.split('|')[1];
            try {
                await fetch(`${API_URL}?action=delete_drive_file&file_id=${fileId}`, { method: 'POST' });
            } catch (e) {
                console.error("雲端檔案刪除失敗", e);
            }
        }

        // 2. 刪除資料庫中的連結記錄
        delete userOverrides[currentViewingRosterKey]; 
        
        // 3. 關閉視窗
        closeImageModalDirect(); 
        
        // 4. 存檔 (這裡使用 try-finally 進行雙重保險)
        try {
            await saveToCloud(); 
        } catch (e) {
            console.error("存檔失敗", e);
            alert("存檔發生錯誤");
        } finally {
            // ★★★ 雙重保險：不管 saveToCloud 結果如何，強制關閉 Loading ★★★
            if(loader) loader.classList.remove('show');
        }
    }
}

// 模式與手勢
function setAppMode(isEditing) {
    READ_ONLY_MODE = !isEditing;
    const menuBtn = document.getElementById('menuEditBtn');
    
    const inputR = document.getElementById('inputReserved');
    if (inputR) {
        inputR.disabled = !isEditing; 
        inputR.style.backgroundColor = isEditing ? 'white' : '#f0f0f0';
    }

    if (isEditing) {
        if(menuBtn) { 
            menuBtn.innerHTML = "💾 儲存並離開"; 
            menuBtn.classList.add('saving'); 
        }
        document.body.classList.add('editing-mode');
    } else {
        if(menuBtn) { 
            menuBtn.innerHTML = "🔧 修改班表"; 
            menuBtn.classList.remove('saving'); 
        }
        document.body.classList.remove('editing-mode');
    }
}

function toggleEditMode() {
    const menu = document.getElementById('userDropdown');
    if(menu) menu.classList.remove('show');

    if (READ_ONLY_MODE) {
        setAppMode(true);
        alert("已進入修改模式\n完成後請再次點選「儲存並離開」");
    } else {
        saveToCloud();
    }
}

// 導航
function switchTab(tabName) {
    const calView = document.getElementById('view-calendar');
    const statsView = document.getElementById('view-stats');
    const imageView = document.getElementById('view-image'); 
    const tabs = document.querySelectorAll('.tab-btn');
    if(calView) calView.classList.remove('active'); 
    if(statsView) statsView.classList.remove('active'); 
    if(imageView) imageView.classList.remove('active');
    tabs.forEach(t => t.classList.remove('active'));
    if (tabName === 'calendar' && calView) { calView.classList.add('active'); if(tabs[0]) tabs[0].classList.add('active'); }
    else if (tabName === 'stats' && statsView) { statsView.classList.add('active'); if(tabs[1]) tabs[1].classList.add('active'); }
    else if (tabName === 'image' && imageView) { imageView.classList.add('active'); if(tabs[2]) tabs[2].classList.add('active'); }
    refreshCurrentPage(); 
}

// ★★★ 修改：跳轉到今天 (新功能) ★★★
function jumpToToday() {
    const now = new Date();
    // 計算今天與 2025/12 的月份差
    const index = calculateIndexFromDate(now);
    if (index < 0) currentMonthIndex = 0; // 如果是過去，回到起點
    else currentMonthIndex = index;
    refreshCurrentPage();
}

// ★★★ 修改：月份切換 ★★★
function changeMonth(step) { 
    const nextIndex = currentMonthIndex + step; 
    // 只限制不能小於 0 (2025/12)
    if (nextIndex >= 0) { 
        currentMonthIndex = nextIndex; 
        refreshCurrentPage(); 
    } 
}

let touchStartX = 0; let touchEndX = 0; const minSwipeDistance = 50; 
const calendarContainer = document.querySelector('.container');
calendarContainer.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].screenX; }, false);
calendarContainer.addEventListener('touchend', function(e) { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, false);
function handleSwipe() { const distance = touchEndX - touchStartX; if (Math.abs(distance) > minSwipeDistance) { if (distance < 0) changeMonth(1); else changeMonth(-1); } }


function closeImageModalDirect() { 
    const modal = document.getElementById('imageViewerModal');
    if(modal) {
        modal.classList.remove('show'); 
        // 稍微延遲隱藏，配合動畫
        setTimeout(() => { modal.style.display = ''; }, 300); 
    }
    // 清空當前紀錄
    currentViewingRosterKey = null; 
}

// 啟動
checkAuth();
jumpToToday();