// =========== 1. 設定與常數區 ===========
let READ_ONLY_MODE = true; 

// ★★★★★ 請在這裡貼上你 Google Apps Script 的網址 ★★★★★
const API_URL = "https://script.google.com/macros/s/AKfycbxpovFcKZkz7cxbjirIrngNRC5MAEnxoKMxiPd6ejKM6tyGsTKXRrADKyp29m8yiRqfHw/exec"; 
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

const ANCHOR_DATE = new Date(2025, 11, 14); 
const EFFECTIVE_DATE = new Date(2025, 11, 1); 
const KEY_RESERVED_PREFIX = 'stats_reserved_'; 

const MONTHS_TO_SHOW = [
    { year: 2025, month: 11, label: '2025/12' }, 
    { year: 2026, month: 0,  label: '2026/01' },  
    { year: 2026, month: 1,  label: '2026/02' },  
    { year: 2026, month: 2,  label: '2026/03' }   
];

const MAX_MONTH_INDEX = MONTHS_TO_SHOW.length - 1;
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

// =========== 資料讀取 ===========
let userOverrides = {}; 

async function loadOverrides() {
    document.getElementById('loadingOverlay').classList.add('show');
    try {
        const response = await fetch(`${API_URL}?action=read`);
        userOverrides = await response.json();
    } catch (e) { 
        console.error(e);
        alert("無法讀取資料，請檢查網路或稍後再試");
    } finally {
        document.getElementById('loadingOverlay').classList.remove('show');
        initApp(); // 讀取完畢後初始化
    }
}

function initApp() {
    // 如果是第一次載入，設定初始月份
    if (currentMonthIndex === 0 && Object.keys(userOverrides).length > 0) { 
        const now = new Date();
        const foundIndex = MONTHS_TO_SHOW.findIndex(m => m.year === now.getFullYear() && m.month === now.getMonth());
        if (foundIndex !== -1) currentMonthIndex = foundIndex;
        else currentMonthIndex = 1; 
    }

    refreshCurrentPage();
    setAppMode(false);
    initGuestMode(); // 預設進入訪客模式
}

// =========== 核心：頁面刷新與連動 ===========
function refreshCurrentPage() {
    const currentData = MONTHS_TO_SHOW[currentMonthIndex];
    document.getElementById('currentMonthDisplay').innerText = currentData.label;
    
    document.getElementById('prevBtn').disabled = (currentMonthIndex === 0);
    document.getElementById('nextBtn').disabled = (currentMonthIndex === MAX_MONTH_INDEX);
    const monthBtns = document.querySelectorAll('.month-btn');
    monthBtns.forEach((btn, index) => { 
        if (index === currentMonthIndex) btn.classList.add('active'); 
        else btn.classList.remove('active'); 
    });

    if (document.getElementById('view-calendar').classList.contains('active')) {
        render(); 
    } 
    
    try { updateStatsUI(); } catch(e) {}
    
    if (document.getElementById('view-image').classList.contains('active')) {
        renderRosterList();
    }
}

function getStatsKeys() {
    const currentData = MONTHS_TO_SHOW[currentMonthIndex];
    return {
        reserved: `stats_reserved_${currentData.year}_${currentData.month}`
    };
}

// =========== 存檔邏輯 ===========
async function saveToCloud() {
    const editBtn = document.getElementById('editBtn');
    if(editBtn) {
        editBtn.innerText = "儲存中...";
        editBtn.disabled = true;
    }

    // 準備資料
    const inputR = document.getElementById('inputReserved');
    if(inputR) {
        const keys = getStatsKeys();
        userOverrides[keys.reserved] = String(inputR.value);
    }

    try {
        await fetch(`${API_URL}?action=save`, {
            method: 'POST',
            mode: 'no-cors', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userOverrides)
        });
        alert("儲存成功！");
    } catch (e) {
        console.error(e);
        alert("儲存失敗，請檢查網路");
    } finally {
        setAppMode(false);
        refreshCurrentPage();
    }
}

function saveStatsData() { saveToCloud(); }

// =========== 補休統計邏輯 ===========
function updateStatsUI() {
    const currentData = MONTHS_TO_SHOW[currentMonthIndex];
    const title = document.getElementById('statsTitle');
    if(title) title.innerText = `${currentData.label} 補休管理`;

    const keys = getStatsKeys();
    const resHours = parseFloat(userOverrides[keys.reserved]) || 0;

    const inputR = document.getElementById('inputReserved');
    if(inputR) {
        if (document.activeElement !== inputR) {
            inputR.value = resHours;
        }
        inputR.disabled = false; 
    }

    calculateMonthlyStats();
}

function calculateMonthlyStats() {
    const currentData = MONTHS_TO_SHOW[currentMonthIndex];
    const lastDay = new Date(currentData.year, currentData.month + 1, 0).getDate();
    const todayZero = new Date(SYSTEM_TODAY); todayZero.setHours(0,0,0,0);

    let used = 0; let unused = 0;

    for (let day = 1; day <= lastDay; day++) {
        const date = new Date(currentData.year, currentData.month, day);
        const dateKey = formatDateKey(date);
        
        if (userOverrides[dateKey] && userOverrides[dateKey].includes('comp_leave')) {
            if (date < todayZero) used += 16;
            else unused += 16;
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
    
    let r = Number(inputR.value) || 0;
    let u = Number(inputU.value) || 0;
    let un = Number(inputUn.value) || 0;
    
    const balance = r - u - un;
    
    txtBal.innerText = balance;
    txtBal.className = 'big-balance'; 
    if(balance > 0) txtBal.style.color = '#2e7d32';
    else if(balance < 0) txtBal.style.color = '#c62828';
    else txtBal.style.color = '#333';
}

// =========== 勤務表功能 ===========
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
    
    if(loader) loader.classList.add('show');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image(); img.src = e.target.result;
        img.onload = async function() {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 1200; let width = img.width; let height = img.height;
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            let dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            const dateParts = dateInput.value.split('-'); 
            const newFileName = `${dateParts[1]}${dateParts[2]}.jpg`; 

            try {
                const response = await fetch(`${API_URL}?action=upload_image`, {
                    method: 'POST', mode: 'cors',
                    body: JSON.stringify({ file: dataUrl, name: newFileName })
                });
                const result = await response.json();
                
                if (result.result === 'success') {
                    const fileId = result.fileId;
                    const rosterKey = `roster_${dateInput.value}`;
                    userOverrides[rosterKey] = `DRIVE|${fileId}`;
                    
                    await saveToCloud(); // 這裡等待存檔完成
                    
                    selectedRosterFile = null; 
                    if(fileInput) fileInput.value = ''; 
                    if(nameDisplay) nameDisplay.innerText = '未選擇檔案';
                    renderRosterList();
                } else {
                    alert("上傳失敗: " + result.error);
                }
            } catch (err) {
                console.error(err);
                alert("上傳發生錯誤");
            } finally {
                if(loader) loader.classList.remove('show');
            }
        };
    };
    reader.readAsDataURL(selectedRosterFile);
}

function renderRosterList() {
    const container = document.getElementById('rosterListContainer'); if(!container) return;
    container.innerHTML = '';
    const currentData = MONTHS_TO_SHOW[currentMonthIndex];
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
            img.src = `https://lh3.googleusercontent.com/d/${fileId}`;
        } else if (val) {
            img.src = val;
        }
    }
    if(modal) modal.classList.add('show');
}
function closeImageModalDirect() { const modal = document.getElementById('imageViewerModal'); if(modal) modal.classList.remove('show'); currentViewingRosterKey = null; }
function closeImageModal(event) { if (event.target.id === 'imageViewerModal') closeImageModalDirect(); }
function deleteCurrentRoster() {
    if (!currentViewingRosterKey) return;
    if (confirm("確定要刪除這張勤務表嗎？")) { 
        delete userOverrides[currentViewingRosterKey]; 
        closeImageModalDirect(); 
        saveToCloud(); 
    }
}

// =========== ★★★ 管理員模式切換邏輯 (還原) ★★★ ===========

let clickCount = 0;
let clickTimer = null;
let IS_ADMIN_MODE = false; // 預設為 false (訪客)

// 三連擊偵測
function handleTripleClick() {
    clickCount++;
    
    if (clickCount === 3) {
        toggleAdminMode();
        clickCount = 0; // 重置
        clearTimeout(clickTimer);
    } else {
        // 設定計時器，如果 500ms 內沒點下一語，就重置計數
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
            clickCount = 0;
        }, 500);
    }
}

// 切換模式核心
function toggleAdminMode() {
    IS_ADMIN_MODE = !IS_ADMIN_MODE;
    
    if (IS_ADMIN_MODE) {
        document.body.classList.remove('guest-mode');
        alert("🔓 已切換為：管理員模式");
    } else {
        document.body.classList.add('guest-mode');
        // 如果正在編輯中，強制存檔或取消編輯
        if (!READ_ONLY_MODE) {
            setAppMode(false); 
        }
        alert("🔒 已切換為：觀看模式");
    }
}

// 初始化：強制進入訪客模式
function initGuestMode() {
    IS_ADMIN_MODE = false;
    document.body.classList.add('guest-mode');
}

// =========== 模式切換 ===========
function setAppMode(isEditing) {
    READ_ONLY_MODE = !isEditing;
    const editBtn = document.getElementById('editBtn');
    if (isEditing) {
        if(editBtn) { editBtn.innerText = "儲存"; editBtn.classList.add('saving'); editBtn.disabled = false; }
        document.body.classList.add('editing-mode');
    } else {
        if(editBtn) { editBtn.innerText = "修改"; editBtn.classList.remove('saving'); editBtn.disabled = false; }
        document.body.classList.remove('editing-mode');
    }
}
function toggleEditMode() { if (READ_ONLY_MODE) setAppMode(true); else saveToCloud(); }

// =========== 頁籤與導航 ===========
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
function jumpToMonth(monthIndex) { currentMonthIndex = monthIndex; refreshCurrentPage(); }
function changeMonth(step) { const nextIndex = currentMonthIndex + step; if (nextIndex >= 0 && nextIndex <= MAX_MONTH_INDEX) { currentMonthIndex = nextIndex; refreshCurrentPage(); } }

// =========== 計算與渲染核心 ===========
function formatDateKey(date) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
function getDayInfo(date) {
    if (date < EFFECTIVE_DATE) return null;
    const diffTime = date - ANCHOR_DATE; const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null; const cycleIndex = diffDays % TOTAL_CYCLE_DAYS;
    return { ...CYCLE_CONFIG[cycleIndex], shiftCode: SHIFT_CODES[cycleIndex] };
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
    let startDay = 1; if (year === 2025 && month === 11) startDay = 17;
    const firstDay = new Date(year, month, startDay); const lastDay = new Date(year, month + 1, 0); let currentDate = startDay; 
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
            let displayShift = dayInfo.shiftCode; if (displayShift === '甲12') displayShift = '甲12(正)'; if (displayShift === '甲23') displayShift = '甲23(副)';
            let line1 = displayShift; let line2 = ''; if (displayShift.includes('(')) { line1 = displayShift.split('(')[0]; line2 = '(' + displayShift.split('(')[1]; }
            td.innerHTML = `${stampHtml}<div class="cell-content"><span class="date-num ${todayClass}">${currentDate}</span><div class="shift-group"><span class="shift-upper">${line1}</span><span class="shift-lower">${line2}</span></div></div>`;
        } else { const todayClass = isToday ? 'is-today' : ''; td.innerHTML = `<div class="cell-content"><span class="date-num ${todayClass}">${currentDate}</span></div>`; td.onclick = null; td.style.cursor = 'default'; }
        row.appendChild(td); currentDate++; dayOfWeek++;
    }
    while (dayOfWeek <= 6) { const td = document.createElement('td'); td.className = 'empty'; row.appendChild(td); dayOfWeek++; }
    tbody.appendChild(row); table.appendChild(tbody);
    
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
    if (isPastMonth) statsHtml += generateRowHtml('本月統計', statsRealized);
    else { statsHtml += generateRowHtml('累積至今日', statsRealized); statsHtml += generateRowHtml('未來排定', statsFuture, '#2196f3'); }
    statsDiv.innerHTML = statsHtml; monthContainer.appendChild(table); monthContainer.appendChild(statsDiv); 
    return monthContainer;
}
function render() {
    const container = document.getElementById('calendar-container'); if(!container) return;
    container.innerHTML = ''; 
    const currentMonthData = MONTHS_TO_SHOW[currentMonthIndex];
    container.appendChild(createCalendar(currentMonthData.year, currentMonthData.month));
}

// Modal (保持不變)
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
    saveToCloud(); 
    const modal = document.getElementById('optionModal'); if(modal) modal.classList.remove('show');
}
function closeModalDirect() { const modal = document.getElementById('optionModal'); if(modal) modal.classList.remove('show'); }
function closeModal(event) { if (event.target.id === 'optionModal') closeModalDirect(); }

let touchStartX = 0; let touchEndX = 0; const minSwipeDistance = 50; 
const calendarContainer = document.querySelector('.container');
calendarContainer.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].screenX; }, false);
calendarContainer.addEventListener('touchend', function(e) { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, false);
function handleSwipe() { const distance = touchEndX - touchStartX; if (Math.abs(distance) > minSwipeDistance) { if (distance < 0) changeMonth(1); else changeMonth(-1); } }

loadOverrides();