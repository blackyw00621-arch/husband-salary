/**
 * 俊賢的工作與薪水記錄表 - 應用程式邏輯 (PocketBase 雲端同步版)
 */

const CUSTOM_PB_URL = "https://chunhsien-husband-salary.fly.dev";

// 當在本機 (localhost / 127.0.0.1) 測試時，優先連接本機的 PocketBase (8091)
const pbHost = (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8091'
    : (CUSTOM_PB_URL || `${window.location.protocol}//${window.location.hostname}:8091`)
);

// 初始化 PocketBase
const pb = new PocketBase(pbHost);
pb.autoCancellation(false);

// 透過後端端點查詢「登入碼是否存在」，取代直接對 users collection 開放列表權限，
// 避免任何登入過的人可以列出所有人的登入碼。
async function resolveUsername(username) {
  return await pb.send('/api/resolve-username', {
    method: 'POST',
    body: { username },
  });
}

// 初始化狀態看守變數
let isInitializingUser = false;

// 應用程式狀態 (State)
let state = {
  year: 2026,
  month: 6,
  defaultWage: 3000,
  commonLocations: ["竹北", "豐原", "竹北>豐原"],
  sharingUsernames: [],
  currentUser: null,
  activeOwnerUsername: "", // 當前檢視的帳本擁有者使用者名稱
  currentMonthRecordId: null, // PocketBase 中的當月資料 Record ID
  appMode: "dayRate", // "dayRate" 或 "overtime"
  // 當月資料儲存結構
  currentMonthData: {
    days: {},
    deduction: 0,
    adjustment: 0,
    records: [],
    monthlySalary: 36800,
    leaderAllowance: 3000
  }
};

// 監聽器變數
let monthSubscription = null;
let userSubscription = null;
let ownerSubscription = null;

// 訂閱控制防競態條件機制 (防止多重 WebSocket/SSE 連線累積)
let subscribeSessionToken = 0;
let monthSubscribeSessionToken = 0;

// DOM 元素選取
const yearInput = document.getElementById("year-input");
const monthInput = document.getElementById("month-input");
const yearPrevBtn = document.getElementById("year-prev");
const yearNextBtn = document.getElementById("year-next");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");

const defaultWageInput = document.getElementById("default-wage");
const locationTagsContainer = document.getElementById("location-tags");
const newLocationInput = document.getElementById("new-location-input");
const addLocationBtn = document.getElementById("add-location-btn");

const backupBtn = document.getElementById("backup-btn");
const restoreTriggerBtn = document.getElementById("restore-trigger-btn");
const restoreFileInput = document.getElementById("restore-file-input");

const currentPeriodDisplay = document.getElementById("current-period-display");
const saveStatus = document.getElementById("save-status");
const salaryTableBody = document.getElementById("salary-table-body");

const totalDaysDisplay = document.getElementById("total-days");
const grossSalaryDisplay = document.getElementById("gross-salary");
const deductionAdvanceInput = document.getElementById("deduction-advance");
const adjustmentOtherInput = document.getElementById("adjustment-other");
const netSalaryDisplay = document.getElementById("net-salary");

const exportCsvBtn = document.getElementById("export-csv");
const exportImgBtn = document.getElementById("export-img");
const printBtn = document.getElementById("print-btn");

// 登入相關 UI 元素
const loginOverlay = document.getElementById("login-overlay");
const loginCodeInput = document.getElementById("login-code");
const loginSubmitBtn = document.getElementById("login-submit-btn");
const loginError = document.getElementById("login-error");
const loginLoading = document.getElementById("login-loading");

const userProfileWidget = document.getElementById("user-profile-widget");
const userAvatarInitial = document.getElementById("user-avatar-initial");
const userName = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");

const whitelistControlGroup = document.getElementById("whitelist-control-group");
const whitelistTagsContainer = document.getElementById("whitelist-tags");
const newUserInput = document.getElementById("new-user-input");
const addUserBtn = document.getElementById("add-user-btn");

// 切換帳本 UI 元素
const switchBookInput = document.getElementById("switch-book-input");
const switchBookBtn = document.getElementById("switch-book-btn");
const resetBookBtn = document.getElementById("reset-book-btn");
const activeBookLabel = document.getElementById("active-book-label");

// 建立 datalist 元素用於工作地點自動提示
const datalist = document.createElement("datalist");
datalist.id = "location-suggestions";
document.body.appendChild(datalist);

// Overtime mode selectors
const monthlySalaryInput = document.getElementById("monthly-salary");
const leaderAllowanceInput = document.getElementById("leader-allowance");
const overtimeHourlyWageText = document.getElementById("overtime-hourly-wage");
const leaveHourlyWageText = document.getElementById("leave-hourly-wage");
const metaMonthlySalary = document.getElementById("meta-monthly-salary");
const metaLeaderAllowance = document.getElementById("meta-leader-allowance");
const tableModeTitleSuffix = document.getElementById("table-mode-title-suffix");

const workDateInput = document.getElementById("workDate");
const workTypeSelect = document.getElementById("workType");
const startTimeInput = document.getElementById("startTime");
const endTimeInput = document.getElementById("endTime");
const breakMinsInput = document.getElementById("breakMins");
const leaveHoursInput = document.getElementById("leaveHours");
const addManualRecordBtn = document.getElementById("add-manual-record-btn");
const overtimeTableBody = document.getElementById("overtime-table-body");

const totalOtPayDisplay = document.getElementById("total-ot-pay");
const totalLeaveCutDisplay = document.getElementById("total-leave-cut");
const netSalaryChangeDisplay = document.getElementById("net-salary-change");
const clearRecordsBtn = document.getElementById("clear-records-btn");

const timeStartGroup = document.getElementById("timeStartGroup");
const timeEndGroup = document.getElementById("timeEndGroup");
const breakGroup = document.getElementById("breakGroup");
const hoursGroup = document.getElementById("hoursGroup");

// 星期對照表
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// 輔助函式：針對純數字登入碼，自動加上 'u' 前綴以符合 PocketBase 使用者名稱規範
function formatUsername(code) {
  const trimmed = code.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return "u" + trimmed;
  }
  return trimmed;
}

// 輔助函式：針對顯示的使用者名稱，如果為 'u' 開頭接純數字，則還原回純數字顯示
function displayUsername(username) {
  if (username && username.startsWith('u') && /^\d+$/.test(username.substring(1))) {
    return username.substring(1);
  }
  return username || "";
}

// 初始化載入
window.addEventListener("DOMContentLoaded", () => {
  setupYearMonthSelector();
  setupEventListeners();
  setupAuthListener();
});

// 設定登入監聽器
function setupAuthListener() {
  document.body.className = "logged-out";
  let lastAuthUserId = null;
  
  // 監聽 PocketBase 驗證狀態變更
  pb.authStore.onChange(async (token, model) => {
    if (model) {
      // 驗證使用者帳號是否確實存在於當前連接的資料庫中 (防止本機/雲端資料庫工作階段污染)
      try {
        await pb.collection('users').getOne(model.id);
      } catch (err) {
        if (err.status === 404) {
          console.warn("偵測到非當前資料庫的過期工作階段，正在自動登出並清除...");
          pb.authStore.clear();
          return;
        }
      }

      const isUserChanged = lastAuthUserId !== model.id;
      lastAuthUserId = model.id;

      state.currentUser = model;
      state.activeOwnerUsername = model.username.toLowerCase();
      
      // 初始化使用者的預設設定與分享名單
      await initializeUserDataIfNeeded(model);
      
      document.body.className = "logged-in";
      
      // 渲染使用者頭像與狀態
      if (userAvatarInitial) {
        const dispName = model.name || displayUsername(model.username);
        userAvatarInitial.textContent = dispName.substring(0, 1).toUpperCase();
      }
      userName.textContent = model.name || displayUsername(model.username);
      userProfileWidget.style.display = "flex";
      
      // 更新檢視帳本 UI
      updateActiveBookUI();
      
      // 開始訂閱雲端資料
      if (isUserChanged) {
        subscribeToCloudData();
      }
    } else {
      lastAuthUserId = null;
      // 未登入狀態
      state.currentUser = null;
      state.activeOwnerUsername = "";
      document.body.className = "logged-out";
      userProfileWidget.style.display = "none";
      
      // 增加此列以取消所有進行中的訂閱
      subscribeSessionToken++;
      monthSubscribeSessionToken++;
      
      // 取消所有的訂閱監聽
      unsubscribeFromAll();
    }
  }, true); // 啟動時立即觸發一次檢查
}

// 初始化使用者資料庫結構
async function initializeUserDataIfNeeded(user) {
  if (isInitializingUser) return;

  // 如果欄位缺漏預設值，在登入時補上 (同時檢查 undefined 與 null)
  if (
    user.defaultWage === undefined || user.defaultWage === null ||
    user.commonLocations === undefined || user.commonLocations === null ||
    user.sharing === undefined || user.sharing === null ||
    user.appMode === undefined || user.appMode === null
  ) {
    isInitializingUser = true;
    try {
      const updatedUser = await pb.collection('users').update(user.id, {
        defaultWage: user.defaultWage || 3000,
        commonLocations: user.commonLocations || ["竹北", "豐原", "竹北>豐原"],
        sharing: user.sharing || [],
        appMode: user.appMode || "dayRate"
      });
      state.currentUser = updatedUser;
      pb.authStore.save(pb.authStore.token, updatedUser);
    } catch (err) {
      console.error("初始化使用者資料失敗", err);
    } finally {
      isInitializingUser = false;
    }
  }
}

// 切換檢視狀態 UI
function updateActiveBookUI() {
  const isViewingSelf = state.activeOwnerUsername.toLowerCase() === state.currentUser.username.toLowerCase();
  if (isViewingSelf) {
    activeBookLabel.textContent = "目前檢視：我的帳本";
    activeBookLabel.style.color = "var(--primary)";
    resetBookBtn.style.display = "none";
    // 顯示分享自己帳本的控制面板
    whitelistControlGroup.style.display = "block";
  } else {
    activeBookLabel.textContent = `目前檢視：${displayUsername(state.activeOwnerUsername)} 的帳本`;
    activeBookLabel.style.color = "var(--success)";
    resetBookBtn.style.display = "inline-block";
    // 隱藏分享控制面板（正在看別人的，不能改別人的分享名單）
    whitelistControlGroup.style.display = "none";
  }
}

// 切換回自己的帳本
function resetToOwnBook() {
  if (state.currentUser && state.activeOwnerUsername !== state.currentUser.username.toLowerCase()) {
    state.activeOwnerUsername = state.currentUser.username.toLowerCase();
    updateActiveBookUI();
    subscribeToCloudData();
  }
}

// 取消所有訂閱
function unsubscribeFromAll() {
  try {
    pb.collection('users').unsubscribe();
    pb.collection('months').unsubscribe();
  } catch (err) {
    console.error("取消訂閱失敗", err);
  }
}

// 訂閱雲端資料即時同步
async function subscribeToCloudData() {
  const sessionToken = ++subscribeSessionToken;
  unsubscribeFromAll();
  
  const loggedInId = state.currentUser.id;
  const activeUsername = state.activeOwnerUsername.toLowerCase();
  
  try {
    // 1. 訂閱「目前登入者」的分享名單變更
    const userCallback = function (e) {
      if (e.action === 'update') {
        state.currentUser = e.record;
        pb.authStore.save(pb.authStore.token, e.record);
        state.sharingUsernames = e.record.sharing || [];
        renderSharingTags();
      }
    };

    try {
      userSubscription = await pb.collection('users').subscribe(loggedInId, userCallback);
    } catch (subErr) {
      console.warn("無法訂閱使用者變更（即時同步停用）:", subErr);
    }
    
    if (sessionToken !== subscribeSessionToken) {
      try {
        pb.collection('users').unsubscribe(loggedInId, userCallback);
      } catch (e) {}
      return;
    }
    
    // 立即載入一次分享名單
    state.sharingUsernames = state.currentUser.sharing || [];
    renderSharingTags();
    
    // 2. 取得「當前檢視帳本」擁有者的紀錄並訂閱設定變更
    let ownerRecord;
    if (activeUsername === state.currentUser.username.toLowerCase()) {
      ownerRecord = state.currentUser;
    } else {
      ownerRecord = await pb.collection('users').getFirstListItem(`username="${activeUsername}"`);
    }
    
    if (sessionToken !== subscribeSessionToken) {
      try {
        pb.collection('users').unsubscribe(loggedInId, userCallback);
      } catch (e) {}
      return;
    }
    
    state.defaultWage = ownerRecord.defaultWage !== undefined ? ownerRecord.defaultWage : 3000;
    state.commonLocations = ownerRecord.commonLocations || ["竹北", "豐原", "竹北>豐原"];
    state.appMode = ownerRecord.appMode || "dayRate";
    
    defaultWageInput.value = state.defaultWage;
    renderCommonLocations();
    applyAppMode(state.appMode);
    
    const ownerCallback = function (e) {
      if (e.action === 'update') {
        state.defaultWage = e.record.defaultWage !== undefined ? e.record.defaultWage : 3000;
        state.commonLocations = e.record.commonLocations || ["竹北", "豐原", "竹北>豐原"];
        const oldMode = state.appMode;
        state.appMode = e.record.appMode || "dayRate";
        
        defaultWageInput.value = state.defaultWage;
        renderCommonLocations();
        applyAppMode(state.appMode);
        
        if (oldMode !== state.appMode) {
          subscribeToCurrentMonth();
        }
      }
    };

    try {
      ownerSubscription = await pb.collection('users').subscribe(ownerRecord.id, ownerCallback);
    } catch (subErr) {
      console.warn("無法訂閱帳本設定變更（即時同步停用）:", subErr);
    }
    
    if (sessionToken !== subscribeSessionToken) {
      try {
        pb.collection('users').unsubscribe(ownerRecord.id, ownerCallback);
        pb.collection('users').unsubscribe(loggedInId, userCallback);
      } catch (e) {}
      return;
    }
    
    // 3. 訂閱「當前檢視帳本」指定年月份的每日工作記錄
    await subscribeToCurrentMonth(sessionToken);
  } catch (err) {
    if (sessionToken !== subscribeSessionToken) return;
    console.error("載入設定檔失敗", err);
    const isViewingSelf = state.activeOwnerUsername.toLowerCase() === (state.currentUser ? state.currentUser.username.toLowerCase() : "");
    if (isViewingSelf) {
      alert("❌ 您的登入階段已失效（資料庫已重設），請重新輸入您的登入碼。");
      pb.authStore.clear();
    } else {
      alert("❌ 載入設定失敗：您可能沒有此帳本的存取權限，或是帳號不存在。已自動切換回您的個人帳本。");
      resetToOwnBook();
    }
  }
}

// 訂閱當前選定月份的工作明細
async function subscribeToCurrentMonth(parentSessionToken) {
  const sessionToken = ++monthSubscribeSessionToken;
  // 先退訂之前的月份訂閱
  try {
    pb.collection('months').unsubscribe();
  } catch (e) {}
  
  const ownerName = state.activeOwnerUsername.toLowerCase();
  const yearMonthStr = `${state.year}-${state.month}`;
  setSaveStatus("載入中...");
  
  try {
    // 嘗試取得對應紀錄
    let record;
    try {
      record = await pb.collection('months').getFirstListItem(`owner.username="${ownerName}" && yearMonth="${yearMonthStr}"`, {
        expand: 'owner'
      });
      if (parentSessionToken && parentSessionToken !== subscribeSessionToken) return;
      if (sessionToken !== monthSubscribeSessionToken) return;
      state.currentMonthRecordId = record.id;
      state.currentMonthData = record.data || { days: {}, deduction: 0, adjustment: 0, records: [], monthlySalary: 36800, leaderAllowance: 3000 };
    } catch (e) {
      if (parentSessionToken && parentSessionToken !== subscribeSessionToken) return;
      if (sessionToken !== monthSubscribeSessionToken) return;
      
      // 404 - 尚未建立此月份
      state.currentMonthRecordId = null;
      state.currentMonthData = {
        days: {},
        deduction: 0,
        adjustment: 0,
        records: [],
        monthlySalary: 36800,
        leaderAllowance: 3000
      };
    }
    
    // 更新輸入欄位與重新渲染表格
    deductionAdvanceInput.value = state.currentMonthData.deduction || 0;
    adjustmentOtherInput.value = state.currentMonthData.adjustment || 0;
    renderTable();
    setSaveStatus("本機已同步");
    
    // 訂閱當月資料變更
    const monthCallback = function (e) {
      if (e.action === 'update' && e.record.id === state.currentMonthRecordId) {
        state.currentMonthData = e.record.data || { days: {}, deduction: 0, adjustment: 0, records: [], monthlySalary: 36800, leaderAllowance: 3000 };
        deductionAdvanceInput.value = state.currentMonthData.deduction || 0;
        adjustmentOtherInput.value = state.currentMonthData.adjustment || 0;
        renderTable();
        setSaveStatus("本機已同步");
      }
    };

    try {
      monthSubscription = await pb.collection('months').subscribe('*', monthCallback, {
        filter: `owner.username="${ownerName}" && yearMonth="${yearMonthStr}"`
      });
    } catch (subErr) {
      console.warn("無法訂閱當月資料變更（即時同步停用）:", subErr);
    }
    
    if ((parentSessionToken && parentSessionToken !== subscribeSessionToken) || (sessionToken !== monthSubscribeSessionToken)) {
      try {
        pb.collection('months').unsubscribe('*', monthCallback);
      } catch (e) {}
      return;
    }
    
  } catch (err) {
    if (parentSessionToken && parentSessionToken !== subscribeSessionToken) return;
    if (sessionToken !== monthSubscribeSessionToken) return;
    console.error("月份資料載入失敗", err);
    setSaveStatus("同步失敗");
  }
}

// 儲存資料至 PocketBase
async function saveToCloud() {
  if (!state.currentUser || !state.activeOwnerUsername) return;
  
  setSaveStatus("儲存中...");
  const ownerName = state.activeOwnerUsername.toLowerCase();
  const yearMonthStr = `${state.year}-${state.month}`;
  
  try {
    if (state.currentMonthRecordId) {
      // 更新現有紀錄
      await pb.collection('months').update(state.currentMonthRecordId, {
        data: state.currentMonthData
      });
    } else {
      // 建立新紀錄
      const ownerRecord = await pb.collection('users').getFirstListItem(`username="${ownerName}"`);
      const newRecord = await pb.collection('months').create({
        owner: ownerRecord.id,
        yearMonth: yearMonthStr,
        data: state.currentMonthData
      });
      state.currentMonthRecordId = newRecord.id;
    }
    setSaveStatus("本機已同步");
  } catch (err) {
    console.error("儲存至雲端失敗", err);
    setSaveStatus("儲存失敗");
    alert("❌ 儲存失敗：您可能沒有編輯此帳本的權限。");
  }
}

// 設定存檔狀態與樣式
function setSaveStatus(text) {
  if (saveStatus) {
    saveStatus.textContent = text;
    if (text.includes("失敗")) {
      saveStatus.style.background = "rgba(239, 68, 68, 0.15)";
      saveStatus.style.color = "var(--danger)";
    } else if (text.includes("已同步")) {
      saveStatus.style.background = "rgba(16, 185, 129, 0.15)";
      saveStatus.style.color = "var(--success)";
    } else if (text.includes("載入中") || text.includes("切換中")) {
      saveStatus.style.background = "rgba(245, 158, 11, 0.15)";
      saveStatus.style.color = "var(--warning)";
    } else {
      saveStatus.style.background = "rgba(79, 70, 229, 0.15)";
      saveStatus.style.color = "var(--primary)";
    }
  }
}

// 年月份選擇器控制
function setupYearMonthSelector() {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  yearInput.value = state.year;
  monthInput.value = state.month;
  currentPeriodDisplay.textContent = `${state.year} 年 ${state.month} 月`;

  const updatePeriod = () => {
    state.year = parseInt(yearInput.value) || 2026;
    state.month = parseInt(monthInput.value) || 6;
    currentPeriodDisplay.textContent = `${state.year} 年 ${state.month} 月`;
    
    if (state.currentUser) {
      subscribeToCurrentMonth();
    }
  };

  yearInput.addEventListener("change", () => {
    if (yearInput.value < 2000) yearInput.value = 2000;
    if (yearInput.value > 2100) yearInput.value = 2100;
    updatePeriod();
  });

  monthInput.addEventListener("change", () => {
    if (monthInput.value < 1) monthInput.value = 1;
    if (monthInput.value > 12) monthInput.value = 12;
    updatePeriod();
  });

  yearPrevBtn.addEventListener("click", () => {
    yearInput.value = parseInt(yearInput.value) - 1;
    updatePeriod();
  });

  yearNextBtn.addEventListener("click", () => {
    yearInput.value = parseInt(yearInput.value) + 1;
    updatePeriod();
  });

  monthPrevBtn.addEventListener("click", () => {
    let m = parseInt(monthInput.value) - 1;
    if (m < 1) {
      m = 12;
      yearInput.value = parseInt(yearInput.value) - 1;
    }
    monthInput.value = m;
    updatePeriod();
  });

  monthNextBtn.addEventListener("click", () => {
    let m = parseInt(monthInput.value) + 1;
    if (m > 12) {
      m = 1;
      yearInput.value = parseInt(yearInput.value) + 1;
    }
    monthInput.value = m;
    updatePeriod();
  });
}

// 渲染常用地點標籤與 datalist
function renderCommonLocations() {
  locationTagsContainer.innerHTML = "";
  datalist.innerHTML = "";
  
  state.commonLocations.forEach(loc => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `
      <span class="tag-text">${loc}</span>
      <button class="delete-tag" aria-label="刪除 ${loc}">×</button>
    `;
    
    tag.querySelector(".tag-text").addEventListener("click", () => {
      const activeInput = document.activeElement;
      if (activeInput && activeInput.classList.contains("location-input")) {
        activeInput.value = loc;
        activeInput.dispatchEvent(new Event("change"));
      }
    });

    tag.querySelector(".delete-tag").addEventListener("click", async (e) => {
      e.stopPropagation();
      const newLocs = state.commonLocations.filter(item => item !== loc);
      const activeName = state.activeOwnerUsername.toLowerCase();
      try {
        const ownerRecord = await pb.collection('users').getFirstListItem(`username="${activeName}"`);
        const updatedRecord = await pb.collection('users').update(ownerRecord.id, { commonLocations: newLocs });
        if (ownerRecord.id === state.currentUser.id) {
          pb.authStore.save(pb.authStore.token, updatedRecord);
        }
      } catch (err) {
        console.error("更新地點失敗", err);
        alert("刪除工作地點失敗：您可能沒有此帳本的編輯權限。");
      }
    });

    locationTagsContainer.appendChild(tag);

    const option = document.createElement("option");
    option.value = loc;
    datalist.appendChild(option);
  });
}

// 渲染分享名單使用者標籤
function renderSharingTags() {
  whitelistTagsContainer.innerHTML = "";
  
  state.sharingUsernames.forEach(username => {
    const tag = document.createElement("span");
    tag.className = `tag whitelist-tag`;
    tag.innerHTML = `
      <span>${displayUsername(username)}</span>
      <button class="delete-tag" aria-label="移除 ${displayUsername(username)}">×</button>
    `;
    
    tag.querySelector(".delete-tag").addEventListener("click", async () => {
      if (confirm(`確定要取消對 ${displayUsername(username)} 的分享授權嗎？`)) {
        const newList = state.sharingUsernames.filter(u => u.toLowerCase() !== username.toLowerCase());
        try {
          const updatedRecord = await pb.collection('users').update(state.currentUser.id, { sharing: newList });
          pb.authStore.save(pb.authStore.token, updatedRecord);
          state.sharingUsernames = newList;
          renderSharingTags();
        } catch (err) {
          alert("移除分享失敗: " + err.message);
        }
      }
    });
    
    whitelistTagsContainer.appendChild(tag);
  });
}

// 事件監聽綁定
function setupEventListeners() {
  // 登入碼登入送出
  loginSubmitBtn.addEventListener("click", async () => {
    const code = loginCodeInput.value.trim();
    if (!code) return;
    
    if (code.length < 6) {
      alert("❌ 登入碼長度必須至少為 6 個字元！這串碼同時也是您的密碼，請設定一個不容易被猜到的長碼，並勿告知無關人士。");
      return;
    }
    
    loginCodeInput.disabled = true;
    loginSubmitBtn.disabled = true;
    loginError.style.display = "none";
    loginLoading.style.display = "block";
    
    const username = formatUsername(code);
    const password = username + "_pb_salary_pwd";
    
    try {
      // 1. 嘗試用此登入碼進行登入
      await pb.collection('users').authWithPassword(username, password);
    } catch (err) {
      // 2. 如果登入失敗，可能是因為該帳本尚未建立 (400)
      if (err.status === 400 || err.status === 404) {
        try {
          // 自動註冊新帳號
          await pb.collection('users').create({
            username: username,
            password: password,
            passwordConfirm: password,
            name: code, // 保持原始輸入（例如純數字）作為顯示名稱
            sharing: [],
            defaultWage: 3000,
            commonLocations: ["竹北", "豐原", "竹北>豐原"],
            appMode: "dayRate"
          });
          // 註冊後自動登入
          await pb.collection('users').authWithPassword(username, password);
          alert("🎉 偵測到新的登入碼，已為您自動建立全新帳本！");
        } catch (regErr) {
          console.error("自動建立帳本失敗", regErr);
          loginError.textContent = "❌ 自動建立帳本失敗：請確認帳號名稱是否符合規範（限英數字、底線或減號，不可含空格）。";
          loginError.style.display = "block";
        }
      } else {
        console.error("登入失敗", err);
        loginError.textContent = "❌ 連線失敗，請確認 PocketBase 服務是否已啟動。";
        loginError.style.display = "block";
      }
    } finally {
      loginCodeInput.disabled = false;
      loginSubmitBtn.disabled = false;
      loginLoading.style.display = "none";
    }
  });

  // 支援登入碼欄位按 Enter 登入
  loginCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loginSubmitBtn.click();
    }
  });

  // 登出按鈕
  logoutBtn.addEventListener("click", () => {
    pb.authStore.clear();
  });

  // 變更預設日薪
  defaultWageInput.addEventListener("change", async () => {
    const wage = parseInt(defaultWageInput.value) || 0;
    const activeName = state.activeOwnerUsername.toLowerCase();
    try {
      const ownerRecord = await pb.collection('users').getFirstListItem(`username="${activeName}"`);
      const updatedRecord = await pb.collection('users').update(ownerRecord.id, { defaultWage: wage });
      if (ownerRecord.id === state.currentUser.id) {
        pb.authStore.save(pb.authStore.token, updatedRecord);
      }
    } catch (err) {
      console.error("更新日薪失敗", err);
      alert("更新日薪失敗：您可能沒有此帳本的編輯權限。");
    }
  });

  // 新增常用地點
  const addLocation = async () => {
    const value = newLocationInput.value.trim();
    const activeName = state.activeOwnerUsername.toLowerCase();
    if (value && !state.commonLocations.includes(value)) {
      const newLocs = [...state.commonLocations, value];
      try {
        const ownerRecord = await pb.collection('users').getFirstListItem(`username="${activeName}"`);
        const updatedRecord = await pb.collection('users').update(ownerRecord.id, { commonLocations: newLocs });
        if (ownerRecord.id === state.currentUser.id) {
          pb.authStore.save(pb.authStore.token, updatedRecord);
        }
        newLocationInput.value = "";
      } catch (err) {
        console.error("新增工作地點失敗", err);
        alert("更新工作地點失敗：您可能沒有此帳本的編輯權限。");
      }
    }
  };

  addLocationBtn.addEventListener("click", addLocation);
  newLocationInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addLocation();
  });

  // 切換檢視他人帳本
  const handleSwitchBook = async () => {
    const rawInput = switchBookInput.value.trim().toLowerCase();
    const targetUsername = formatUsername(rawInput);
    if (!targetUsername) return;
    
    if (targetUsername === state.currentUser.username.toLowerCase()) {
      resetToOwnBook();
      return;
    }
    
    setSaveStatus("切換中...");
    
    try {
      // 嘗試讀取目標使用者，以驗證是否有分享權限
      const targetUser = await pb.collection('users').getFirstListItem(`username="${targetUsername}"`);
      const sharing = targetUser.sharing || [];
      const myUsername = state.currentUser.username.toLowerCase();
      
      if (sharing.map(u => u.toLowerCase()).includes(myUsername)) {
        state.activeOwnerUsername = targetUsername;
        updateActiveBookUI();
        subscribeToCloudData();
        switchBookInput.value = "";
      } else {
        alert(`❌ 切換失敗：您不在 ${rawInput} 的分享授權名單中。`);
        setSaveStatus("本機已同步");
      }
    } catch (err) {
      console.error("切換帳本失敗", err);
      alert(`❌ 切換失敗：您沒有權限存取 ${rawInput} 的帳本，或該帳號不存在。`);
      setSaveStatus("本機已同步");
    }
  };
  
  switchBookBtn.addEventListener("click", handleSwitchBook);
  switchBookInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSwitchBook();
  });
  
  // 切換回自己的帳本
  resetBookBtn.addEventListener("click", resetToOwnBook);

  // 新增分享使用者
  const addSharingUser = async () => {
    const rawInput = newUserInput.value.trim().toLowerCase();
    const username = formatUsername(rawInput);
    if (username) {
      if (username === state.currentUser.username.toLowerCase()) {
        alert("您不需要把自己加入分享名單喔！自己預設就擁有權限了。");
        return;
      }
      
      if (state.sharingUsernames.map(u => u.toLowerCase()).includes(username)) {
        alert("此帳號已經在分享名單中囉！");
        return;
      }
      
      // 驗證目標帳號是否存在於資料庫中
      try {
        const result = await resolveUsername(username);
        if (!result.exists) {
          alert(`❌ 新增失敗：使用者帳號 "${rawInput}" 不存在！請確認對方已註冊。`);
          return;
        }
      } catch (e) {
        alert(`❌ 新增失敗：使用者帳號 "${rawInput}" 不存在！請確認對方已註冊。`);
        return;
      }
      
      const newList = [...state.sharingUsernames, username];
      try {
        const updatedRecord = await pb.collection('users').update(state.currentUser.id, { sharing: newList });
        pb.authStore.save(pb.authStore.token, updatedRecord);
        newUserInput.value = "";
        state.sharingUsernames = newList;
        renderSharingTags();
      } catch (err) {
        alert("新增分享失敗：" + err.message);
      }
    }
  };

  addUserBtn.addEventListener("click", addSharingUser);
  newUserInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSharingUser();
  });

  // 借支與其他輸入監聽 (立即計算並存檔)
  deductionAdvanceInput.addEventListener("input", calculateTotals);
  deductionAdvanceInput.addEventListener("change", () => {
    state.currentMonthData.deduction = parseInt(deductionAdvanceInput.value) || 0;
    saveToCloud();
  });

  adjustmentOtherInput.addEventListener("input", calculateTotals);
  adjustmentOtherInput.addEventListener("change", () => {
    state.currentMonthData.adjustment = parseInt(adjustmentOtherInput.value) || 0;
    saveToCloud();
  });

  // 匯出 CSV 檔案
  exportCsvBtn.addEventListener("click", exportToCSV);

  // 匯出圖片按鈕
  if (exportImgBtn) {
    exportImgBtn.addEventListener("click", exportToImage);
  }

  // 列印按鈕
  printBtn.addEventListener("click", () => {
    window.print();
  });

  // 備份資料
  backupBtn.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.currentMonthData, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `俊賢薪水備份_${state.year}_${state.month}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // 還原資料
  restoreTriggerBtn.addEventListener("click", () => {
    restoreFileInput.click();
  });

  restoreFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(evt) {
      try {
        const imported = JSON.parse(evt.target.result);
        if (imported.days || imported.records) {
          if (confirm("匯入備份會覆蓋您此月份目前的紀錄，確定要匯入嗎？")) {
            state.currentMonthData = imported;
            renderTable();
            saveToCloud();
            alert("此月份資料匯入並同步成功！");
          }
        } else {
          alert("不正確的備份檔案格式！");
        }
      } catch (err) {
        alert("無法讀取檔案，請確認是正確的 JSON 備份檔。");
      }
    };
    reader.readAsText(file);
    restoreFileInput.value = "";
  });

  // --- 模式切換事件監聽 ---
  const modeDayrateBtn = document.getElementById("mode-dayrate-btn");
  const modeOvertimeBtn = document.getElementById("mode-overtime-btn");
  
  const handleModeSwitch = async (targetMode) => {
    const isViewingSelf = state.currentUser && 
                          state.activeOwnerUsername && 
                          state.currentUser.username && 
                          state.activeOwnerUsername.toLowerCase() === state.currentUser.username.toLowerCase();
    const oldMode = state.appMode;
    
    // 立即在本地套用新模式與重繪，確保 UI 點擊有即時反應
    applyAppMode(targetMode);
    renderTable();
    
    if (oldMode !== targetMode) {
      await subscribeToCurrentMonth();
    }
    
    if (isViewingSelf) {
      setSaveStatus("儲存中...");
      try {
        const updatedRecord = await pb.collection('users').update(state.currentUser.id, { appMode: targetMode });
        pb.authStore.save(pb.authStore.token, updatedRecord);
        setSaveStatus("本機已同步");
      } catch (err) {
        console.error("更新介面模式失敗", err);
        // 同步失敗時還原本地狀態
        applyAppMode(oldMode);
        renderTable();
        if (oldMode !== targetMode) {
          await subscribeToCurrentMonth();
        }
        alert("更新介面模式失敗，請確認您的網路連線。");
        setSaveStatus("儲存失敗");
      }
    }
  };

  if (modeDayrateBtn) {
    modeDayrateBtn.addEventListener("click", () => handleModeSwitch("dayRate"));
  }
  if (modeOvertimeBtn) {
    modeOvertimeBtn.addEventListener("click", () => handleModeSwitch("overtime"));
  }

  // --- 加班模式控制面板監聽 ---
  if (monthlySalaryInput) {
    monthlySalaryInput.addEventListener("change", () => {
      if (!state.currentMonthData) return;
      state.currentMonthData.monthlySalary = parseInt(monthlySalaryInput.value) || 0;
      recalculateAllOvertimeRecords();
      saveToCloud();
      renderTable();
    });
  }
  
  if (leaderAllowanceInput) {
    leaderAllowanceInput.addEventListener("change", () => {
      if (!state.currentMonthData) return;
      state.currentMonthData.leaderAllowance = parseInt(leaderAllowanceInput.value) || 0;
      recalculateAllOvertimeRecords();
      saveToCloud();
      renderTable();
    });
  }

  // --- 手動新增加班紀錄表單監聽 ---
  if (workDateInput) {
    workDateInput.valueAsDate = new Date();
  }

  if (workTypeSelect) {
    workTypeSelect.addEventListener("change", toggleOvertimeTimeFields);
  }

  if (addManualRecordBtn) {
    addManualRecordBtn.addEventListener("click", addManualOvertimeRecord);
  }

  // --- 智慧匯入 Excel 監聽 ---
  const excelFileInput = document.getElementById("excelFile");
  if (excelFileInput) {
    excelFileInput.addEventListener("change", (e) => handleExcelUpload(e.target));
  }

  // --- 清除加班紀錄監聽 ---
  if (clearRecordsBtn) {
    clearRecordsBtn.addEventListener("click", clearOvertimeRecords);
  }
}

// 取得該月份總天數
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 應用程式模式切換套用
function applyAppMode(mode) {
  state.appMode = mode;
  
  // 更新 Body 模式 Class，以便用 CSS 隱藏/顯示對應元素
  document.body.classList.remove("mode-dayrate", "mode-overtime");
  document.body.classList.add("mode-" + mode.toLowerCase());
  
  // 更新切換器 Tab 狀態
  const modeDayrateBtn = document.getElementById("mode-dayrate-btn");
  const modeOvertimeBtn = document.getElementById("mode-overtime-btn");
  
  if (modeDayrateBtn && modeOvertimeBtn) {
    if (mode === "dayRate") {
      modeDayrateBtn.classList.add("active");
      modeOvertimeBtn.classList.remove("active");
    } else {
      modeDayrateBtn.classList.remove("active");
      modeOvertimeBtn.classList.add("active");
    }
  }
}

// 更新加班模式之時薪文字顯示，並返回計算後的數值
function updateOvertimeWagesDisplay() {
  const monthData = state.currentMonthData;
  const salary = monthData.monthlySalary !== undefined ? monthData.monthlySalary : 36800;
  const allowance = monthData.leaderAllowance !== undefined ? monthData.leaderAllowance : 3000;
  
  const hourlyWage = Math.round(((salary + allowance) / 240) * 100) / 100;
  const leaveHourlyWage = Math.round((salary / 240) * 100) / 100;
  
  if (monthlySalaryInput) monthlySalaryInput.value = salary;
  if (leaderAllowanceInput) leaderAllowanceInput.value = allowance;
  
  if (overtimeHourlyWageText) overtimeHourlyWageText.innerText = hourlyWage;
  if (leaveHourlyWageText) leaveHourlyWageText.innerText = leaveHourlyWage;
  
  return { hourlyWage, leaveHourlyWage };
}

// 重新計算當月份所有加班與請假的金額 (當底薪或加給變動時觸發)
function recalculateAllOvertimeRecords() {
  const monthData = state.currentMonthData;
  if (!monthData || !monthData.records) return;
  
  const salary = monthData.monthlySalary !== undefined ? monthData.monthlySalary : 36800;
  const allowance = monthData.leaderAllowance !== undefined ? monthData.leaderAllowance : 3000;
  
  const hourlyWage = Math.round(((salary + allowance) / 240) * 100) / 100;
  const leaveHourlyWage = Math.round((salary / 240) * 100) / 100;
  
  monthData.records.forEach(record => {
    if (!record.workType.startsWith('leave_')) {
      // 加班紀錄
      const r134 = record.r134 || 0;
      const r167 = record.r167 || 0;
      const r267 = record.r267 || 0;
      record.amount = Math.round((r134 * hourlyWage * (4/3)) + (r167 * hourlyWage * (5/3)) + (r267 * hourlyWage * (8/3)));
    } else {
      // 請假紀錄
      const leaveHours = record.netHours || 0;
      let cutAmt = 0;
      if (record.workType === 'leave_spe') {
        cutAmt = 0;
      } else if (record.workType === 'leave_sick' || record.workType === 'leave_men') {
        cutAmt = leaveHours * leaveHourlyWage * 0.5;
      } else if (record.workType === 'leave_fam' || record.workType === 'leave_personal') {
        cutAmt = leaveHours * leaveHourlyWage;
      } else if (record.workType === 'leave_mourn') {
        cutAmt = 0;
      }
      record.amount = -Math.round(cutAmt);
    }
  });
}

// 切換請假/加班輸入時數或時間欄位
function toggleOvertimeTimeFields() {
  if (!workTypeSelect) return;
  const type = workTypeSelect.value;
  if (type.startsWith('leave_')) {
    if (timeStartGroup) timeStartGroup.style.display = 'none';
    if (timeEndGroup) timeEndGroup.style.display = 'none';
    if (breakGroup) breakGroup.style.display = 'none';
    if (hoursGroup) hoursGroup.style.display = 'block';
  } else {
    if (timeStartGroup) timeStartGroup.style.display = 'block';
    if (timeEndGroup) timeEndGroup.style.display = 'block';
    if (breakGroup) breakGroup.style.display = 'block';
    if (hoursGroup) hoursGroup.style.display = 'none';
  }
}

// 新增手動加班或請假紀錄
function addManualOvertimeRecord() {
  const date = workDateInput.value;
  const type = workTypeSelect.value;
  const { hourlyWage, leaveHourlyWage } = updateOvertimeWagesDisplay();
  
  if (!date) {
    alert('請選擇日期！');
    return;
  }
  
  let record = { id: Date.now(), date, workType: type };
  
  if (!type.startsWith('leave_')) {
    const sTime = startTimeInput.value;
    const eTime = endTimeInput.value;
    const bMins = parseFloat(breakMinsInput.value) || 0;
    
    if (!sTime || !eTime) {
      alert('請填寫上下班時間！');
      return;
    }
    
    const start = new Date(`2026-01-01T${sTime}`);
    let end = new Date(`2026-01-01T${eTime}`);
    if (end < start) end.setDate(end.getDate() + 1);
    
    let totalMins = ((end - start) / 1000 / 60) - bMins;
    if (totalMins < 0) totalMins = 0;
    const otHours = Math.round((totalMins / 60) * 100) / 100;
    
    let r134 = 0, r167 = 0, r267 = 0;
    if (type === "weekday") {
      record.typeText = "平日加班";
      record.badgeClass = "bg-weekday";
      if (otHours <= 2) {
        r134 = otHours;
      } else {
        r134 = 2;
        r167 = otHours - 2;
      }
    } else {
      record.typeText = "休息日加班";
      record.badgeClass = "bg-restday";
      if (otHours <= 2) {
        r134 = otHours;
      } else if (otHours <= 8) {
        r134 = 2;
        r167 = otHours - 2;
      } else {
        r134 = 2;
        r167 = 6;
        r267 = otHours - 8;
      }
    }
    
    record.timeStr = `${sTime} ~ ${eTime}`;
    record.netHours = otHours;
    record.r134 = r134;
    record.r167 = r167;
    record.r267 = r267;
    record.amount = Math.round((r134 * hourlyWage * (4/3)) + (r167 * hourlyWage * (5/3)) + (r267 * hourlyWage * (8/3)));
  } else {
    const lHours = parseFloat(leaveHoursInput.value) || 0;
    let cutAmt = 0;
    record.netHours = lHours;
    record.timeStr = `${lHours} 小時`;
    
    if (type === 'leave_spe') {
      record.typeText = "特休 (全薪)";
      record.badgeClass = "bg-leave-full";
    } else if (type === 'leave_sick') {
      record.typeText = "病假 (半薪)";
      record.badgeClass = "bg-leave-half";
      cutAmt = lHours * leaveHourlyWage * 0.5;
    } else if (type === 'leave_fam') {
      record.typeText = "家庭照顧 (無薪)";
      record.badgeClass = "bg-leave-none";
      cutAmt = lHours * leaveHourlyWage;
    } else if (type === 'leave_men') {
      record.typeText = "生理假 (半薪)";
      record.badgeClass = "bg-leave-half";
      cutAmt = lHours * leaveHourlyWage * 0.5;
    } else if (type === 'leave_mourn') {
      record.typeText = "喪假 (全薪)";
      record.badgeClass = "bg-leave-full";
      cutAmt = 0;
    } else if (type === 'leave_personal') {
      record.typeText = "事假 (無薪)";
      record.badgeClass = "bg-leave-none";
      cutAmt = lHours * leaveHourlyWage;
    }
    
    record.amount = -Math.round(cutAmt);
  }
  
  if (!state.currentMonthData.records) state.currentMonthData.records = [];
  state.currentMonthData.records.push(record);
  
  saveToCloud();
  renderTable();
}

// 刪除指定加班/請假紀錄
window.deleteOvertimeRecord = function(id) {
  if (!state.currentMonthData.records) return;
  state.currentMonthData.records = state.currentMonthData.records.filter(r => r.id !== id);
  saveToCloud();
  renderTable();
};

// 清除所有加班與請假紀錄
function clearOvertimeRecords() {
  if (confirm('確定清除此月份所有加班與請假紀錄？')) {
    state.currentMonthData.records = [];
    saveToCloud();
    renderTable();
  }
}

// 智慧解析上傳之 Excel 檔案
function handleExcelUpload(input) {
  const file = input.files[0];
  if (!file) return;

  setSaveStatus("解析中...");
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      parseFengData(jsonData);
    } catch (err) {
      console.error(err);
      alert("解析 Excel 檔案失敗，請確保是正確的鋒型差勤報表。");
      setSaveStatus("同步失敗");
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

// 鋒型報表數據演算法
function parseFengData(rows) {
  if (rows.length === 0) return;
  
  const { hourlyWage, leaveHourlyWage } = updateOvertimeWagesDisplay();
  let importedCount = 0;

  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].includes("日期") && rows[i].includes("差勤紀錄")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    alert("找不到相符的鋒型報表格式！");
    return;
  }

  const headers = rows[headerIndex];
  const idxDate = headers.indexOf("日期");
  const idxStatus = headers.indexOf("狀態");
  const idxLeaveRecord = headers.indexOf("差勤紀錄");
  const idxOtRecord = headers.indexOf("加班紀錄");
  const idxActualHours = headers.indexOf("實到工時");

  if (!state.currentMonthData.records) state.currentMonthData.records = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || !row[idxDate]) continue;

    let dateStr = String(row[idxDate]).trim();
    if (dateStr.match(/^\d{2}-\d{2}/)) {
      const currentYear = new Date().getFullYear();
      dateStr = `${currentYear}-${dateStr.substring(0,5)}`;
    } else {
      dateStr = dateStr.substring(0, 10);
    }

    if (isNaN(Date.parse(dateStr))) continue;

    const status = row[idxStatus] ? String(row[idxStatus]).trim() : "";
    const leaveText = row[idxLeaveRecord] ? String(row[idxLeaveRecord]).trim() : "";
    const otText = row[idxOtRecord] ? String(row[idxOtRecord]).trim() : "";
    const actualHours = row[idxActualHours] ? parseFloat(row[idxActualHours]) || 0 : 0;

    let record = { id: Date.now() + i, date: dateStr };

    // 解析加班
    if (otText && otText.includes("H")) {
      let otMatch = otText.match(/([\d.]+)\s*H\s*\((.*?)\)/);
      let otHours = 0;
      let timeRange = otText;
      
      if (otMatch) {
        otHours = parseFloat(otMatch[1]);
        timeRange = otMatch[2].replace(/\s+/g, '');
      } else {
        let numMatch = otText.match(/([\d.]+)/);
        if (numMatch) otHours = parseFloat(numMatch[1]);
      }

      if (otHours > 0) {
        let r134 = 0, r167 = 0, r267 = 0, finalAmt = 0;
        
        if ((status.includes("排休") || status.includes("休息日")) && actualHours === 0) {
          record.workType = "restday";
          record.typeText = "休息日加班";
          record.badgeClass = "bg-restday";
          if (otHours <= 2) { r134 = otHours; } 
          else if (otHours <= 8) { r134 = 2; r167 = otHours - 2; } 
          else { r134 = 2; r167 = 6; r267 = otHours - 8; }
        } else {
          record.workType = "weekday";
          record.typeText = "平日加班";
          record.badgeClass = "bg-weekday";
          if (otHours <= 2) { r134 = otHours; } else { r134 = 2; r167 = otHours - 2; }
        }

        finalAmt = Math.round((r134 * hourlyWage * (4/3)) + (r167 * hourlyWage * (5/3)) + (r267 * hourlyWage * (8/3)));
        
        record.timeStr = timeRange;
        record.netHours = otHours;
        record.r134 = r134; record.r167 = r167; record.r267 = r267;
        record.amount = finalAmt;
        
        state.currentMonthData.records.push(record);
        importedCount++;
      }
    }

    // 解析請假
    if (leaveText && (leaveText.includes("假") || leaveText.includes("休"))) {
      let leaveHours = 8;
      let timeMatch = leaveText.match(/\((\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\)/);
      if (timeMatch) {
        let sh = parseInt(timeMatch[1]), sm = parseInt(timeMatch[2]);
        let eh = parseInt(timeMatch[3]), em = parseInt(timeMatch[4]);
        let diffMins = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMins >= 540) diffMins -= 60; 
        leaveHours = Math.round((diffMins / 60) * 100) / 100;
        if (leaveHours <= 0) leaveHours = 8;
      }

      let cutAmt = 0;
      record.netHours = leaveHours;
      record.timeStr = `${leaveHours} 小時`;
      record.r134 = 0; record.r167 = 0; record.r267 = 0;

      if (leaveText.includes("特別休假") || leaveText.includes("特休")) {
        record.workType = "leave_spe"; record.typeText = "特休 (全薪)"; record.badgeClass = "bg-leave-full";
        cutAmt = 0;
      } else if (leaveText.includes("病假")) {
        record.workType = "leave_sick"; record.typeText = "病假 (半薪)"; record.badgeClass = "bg-leave-half";
        cutAmt = Math.round(leaveHours * leaveHourlyWage * 0.5);
      } else if (leaveText.includes("家庭照顧假")) {
        record.workType = "leave_fam"; record.typeText = "家庭照顧 (無薪)"; record.badgeClass = "bg-leave-none";
        cutAmt = Math.round(leaveHours * leaveHourlyWage);
      } else if (leaveText.includes("生理假")) {
        record.workType = "leave_men"; record.typeText = "生理假 (半薪)"; record.badgeClass = "bg-leave-half";
        cutAmt = Math.round(leaveHours * leaveHourlyWage * 0.5);
      } else if (leaveText.includes("事假")) {
        record.workType = "leave_personal"; record.typeText = "事假 (無薪)"; record.badgeClass = "bg-leave-none";
        cutAmt = Math.round(leaveHours * leaveHourlyWage);
      } else if (leaveText.includes("喪假")) {
        record.workType = "leave_mourn"; record.typeText = "喪假 (全薪)"; record.badgeClass = "bg-leave-full";
        cutAmt = 0;
      }

      record.amount = -cutAmt;
      state.currentMonthData.records.push(record);
      importedCount++;
    }
  }

  saveToCloud();
  renderTable();
  alert(`成功導入 ${importedCount} 筆精準紀錄！`);
}

// 渲染加班模式表格
function renderOvertimeTable() {
  if (!overtimeTableBody) return;
  overtimeTableBody.innerHTML = '';
  
  const monthData = state.currentMonthData;
  if (!monthData.records) monthData.records = [];
  
  let totalOt = 0;
  let totalCut = 0;
  
  monthData.records.sort((a,b) => new Date(a.date) - new Date(b.date));
  
  monthData.records.forEach(r => {
    const tr = document.createElement('tr');
    
    let amtText = '';
    if (r.amount > 0) {
      amtText = `<span style="color:var(--success); font-weight:bold;">+$${r.amount}</span>`;
      totalOt += r.amount;
    } else if (r.amount < 0) {
      amtText = `<span style="color:var(--danger); font-weight:bold;">-$${Math.abs(r.amount)}</span>`;
      totalCut += Math.abs(r.amount);
    } else {
      amtText = `$0`;
    }
    
    tr.innerHTML = `
      <td>${r.date}</td>
      <td><span class="badge ${r.badgeClass}">${r.typeText}</span></td>
      <td>${r.timeStr}</td>
      <td>${r.netHours}</td>
      <td>${r.r134 || '-'}</td>
      <td>${r.r167 || '-'}</td>
      <td>${r.r267 || '-'}</td>
      <td>${amtText}</td>
      <td>
        <button class="btn btn-sm" style="background-color: var(--danger); color: white; padding: 2px 8px; height:auto; font-size:12px; border-radius: var(--radius-sm); border: none;" onclick="deleteOvertimeRecord(${r.id})">刪除</button>
      </td>
    `;
    overtimeTableBody.appendChild(tr);
  });
  
  if (totalOtPayDisplay) totalOtPayDisplay.innerText = totalOt.toLocaleString();
  if (totalLeaveCutDisplay) totalLeaveCutDisplay.innerText = totalCut.toLocaleString();
  
  const netChange = totalOt - totalCut;
  if (netSalaryChangeDisplay) {
    netSalaryChangeDisplay.innerText = (netChange >= 0 ? `+$${netChange.toLocaleString()}` : `-$${Math.abs(netChange).toLocaleString()}`);
    netSalaryChangeDisplay.style.color = netChange >= 0 ? 'var(--success)' : 'var(--danger)';
  }
}

// 動態渲染表格 (主入口)
function renderTable() {
  if (state.appMode === "overtime") {
    const wages = updateOvertimeWagesDisplay();
    
    if (metaMonthlySalary && metaLeaderAllowance) {
      const sal = state.currentMonthData.monthlySalary !== undefined ? state.currentMonthData.monthlySalary : 36800;
      const all = state.currentMonthData.leaderAllowance !== undefined ? state.currentMonthData.leaderAllowance : 3000;
      metaMonthlySalary.innerText = sal.toLocaleString();
      metaLeaderAllowance.innerText = all.toLocaleString();
    }
    if (tableModeTitleSuffix) {
      tableModeTitleSuffix.innerText = "詳細加班與請假明細";
    }
    
    renderOvertimeTable();
  } else {
    if (tableModeTitleSuffix) {
      tableModeTitleSuffix.innerText = "詳細工作明細";
    }
    renderDayrateTable();
  }
}

// 日薪模式表格渲染 (原 renderTable)
function renderDayrateTable() {
  salaryTableBody.innerHTML = "";
  
  const daysInMonth = getDaysInMonth(state.year, state.month);
  const monthData = state.currentMonthData;
  
  if (!monthData.days) monthData.days = {};
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(state.year, state.month - 1, day);
    const dayOfWeekNum = dateObj.getDay();
    const dayOfWeekStr = WEEKDAYS[dayOfWeekNum];
    
    if (!monthData.days[day]) {
      monthData.days[day] = {
        location: "",
        duration: 0,
        wage: "",
        overtime: "",
        remarks: ""
      };
    }
    
    const dayData = monthData.days[day];
    
    let rowClass = "";
    if (dayOfWeekNum === 0) rowClass = "sunday-row";
    else if (dayOfWeekNum === 6) rowClass = "saturday-row";
    
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    
    tr.innerHTML = `
      <td class="col-date">${state.month}月${day}日</td>
      <td class="col-day day-cell">${dayOfWeekStr}</td>
      <td class="col-location">
        <input type="text" class="table-input location-input" list="location-suggestions" value="${dayData.location || ''}" placeholder="請輸入地點">
      </td>
      <td class="col-duration">
        <div class="duration-selector">
          <button class="duration-opt ${dayData.duration === 0 ? 'active' : ''}" data-value="0">休</button>
          <button class="duration-opt ${dayData.duration === 0.5 ? 'active' : ''}" data-value="0.5">0.5</button>
          <button class="duration-opt ${dayData.duration === 1.0 ? 'active' : ''}" data-value="1">1.0</button>
        </div>
      </td>
      <td class="col-wage">
        <input type="number" class="table-input wage-input" value="${dayData.wage !== undefined ? dayData.wage : ''}" placeholder="0" min="0">
      </td>
      <td class="col-overtime">
        <input type="number" class="table-input overtime-input" value="${dayData.overtime !== undefined ? dayData.overtime : ''}" placeholder="0" min="0">
      </td>
      <td class="col-remarks">
        <input type="text" class="table-input remarks-input" value="${dayData.remarks || ''}" placeholder="備註">
      </td>
    `;
    
    const locationInput = tr.querySelector(".location-input");
    locationInput.addEventListener("change", () => {
      dayData.location = locationInput.value;
      saveToCloud();
    });
    
    const durationButtons = tr.querySelectorAll(".duration-opt");
    durationButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        durationButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const newValue = parseFloat(btn.dataset.value);
        dayData.duration = newValue;
        
        const wageInput = tr.querySelector(".wage-input");
        const calculatedWage = Math.round(state.defaultWage * newValue);
        
        if (newValue === 0) {
          dayData.wage = "";
          wageInput.value = "";
        } else {
          dayData.wage = calculatedWage;
          wageInput.value = calculatedWage;
        }
        
        saveToCloud();
        calculateTotals();
      });
    });
    
    const wageInput = tr.querySelector(".wage-input");
    wageInput.addEventListener("change", () => {
      const val = wageInput.value.trim();
      dayData.wage = val === "" ? "" : (parseInt(val) || 0);
      saveToCloud();
      calculateTotals();
    });
    
    const overtimeInput = tr.querySelector(".overtime-input");
    overtimeInput.addEventListener("change", () => {
      const val = overtimeInput.value.trim();
      dayData.overtime = val === "" ? "" : (parseInt(val) || 0);
      saveToCloud();
      calculateTotals();
    });
    
    const remarksInput = tr.querySelector(".remarks-input");
    remarksInput.addEventListener("change", () => {
      dayData.remarks = remarksInput.value;
      saveToCloud();
    });
    
    salaryTableBody.appendChild(tr);
  }
  
  calculateTotals();
}

// 實時計算總工時與薪資 (主入口)
function calculateTotals() {
  if (state.appMode === "overtime") {
    calculateOvertimeTotals();
  } else {
    calculateDayrateTotals();
  }
}

// 計算加班統計
function calculateOvertimeTotals() {
  const monthData = state.currentMonthData;
  if (!monthData) return;
  
  let totalOt = 0;
  let totalCut = 0;
  
  const records = monthData.records || [];
  records.forEach(r => {
    if (r.amount > 0) {
      totalOt += r.amount;
    } else {
      totalCut += Math.abs(r.amount);
    }
  });
  
  if (totalOtPayDisplay) totalOtPayDisplay.innerText = totalOt.toLocaleString();
  if (totalLeaveCutDisplay) totalLeaveCutDisplay.innerText = totalCut.toLocaleString();
  
  const netChange = totalOt - totalCut;
  if (netSalaryChangeDisplay) {
    netSalaryChangeDisplay.innerText = (netChange >= 0 ? `+$${netChange.toLocaleString()}` : `-$${Math.abs(netChange).toLocaleString()}`);
    netSalaryChangeDisplay.style.color = netChange >= 0 ? 'var(--success)' : 'var(--danger)';
  }
}

// 計算日薪統計 (原 calculateTotals)
function calculateDayrateTotals() {
  const monthData = state.currentMonthData;
  if (!monthData || !monthData.days) return;
  
  let totalDays = 0;
  let grossSalary = 0;
  
  Object.keys(monthData.days).forEach(day => {
    const dayData = monthData.days[day];
    totalDays += parseFloat(dayData.duration) || 0;
    
    const wage = parseInt(dayData.wage) || 0;
    const overtime = parseInt(dayData.overtime) || 0;
    grossSalary += (wage + overtime);
  });
  
  const deduction = parseInt(deductionAdvanceInput.value) || 0;
  const adjustment = parseInt(adjustmentOtherInput.value) || 0;
  const netSalary = grossSalary - deduction + adjustment;
  
  totalDaysDisplay.textContent = totalDays;
  grossSalaryDisplay.textContent = grossSalary.toLocaleString();
  netSalaryDisplay.textContent = netSalary.toLocaleString();
}

// 匯出 CSV，支援 Excel UTF-8 BOM
function exportToCSV() {
  if (state.appMode === "overtime") {
    exportOvertimeToCSV();
  } else {
    exportDayrateToCSV();
  }
}

// 匯出加班模式 CSV
function exportOvertimeToCSV() {
  const monthData = state.currentMonthData;
  if (!monthData) return;
  
  const records = monthData.records || [];
  records.sort((a,b) => new Date(a.date) - new Date(b.date));
  
  let csvContent = [];
  csvContent.push(["日期", "類別", "時間/時數", "淨時數", "1.34倍時數", "1.67倍時數", "2.67倍時數", "增減金額"].join(","));
  
  let totalOt = 0;
  let totalCut = 0;
  
  records.forEach(r => {
    const amt = r.amount || 0;
    if (amt > 0) totalOt += amt;
    else totalCut += Math.abs(amt);
    
    const row = [
      `"${r.date}"`,
      `"${r.typeText}"`,
      `"${(r.timeStr || "").replace(/"/g, '""')}"`,
      r.netHours || 0,
      r.r134 !== undefined ? r.r134 : "",
      r.r167 !== undefined ? r.r167 : "",
      r.r267 !== undefined ? r.r267 : "",
      amt
    ];
    csvContent.push(row.join(","));
  });
  
  csvContent.push(",,,,,,,");
  
  const netChange = totalOt - totalCut;
  csvContent.push([`"總累計加班費"`, `""`, `""`, `""`, `""`, `""`, `""`, totalOt].join(","));
  csvContent.push([`"總請假扣薪額"`, `""`, `""`, `""`, `""`, `""`, `""`, -totalCut].join(","));
  csvContent.push([`"本月薪資預估增減"`, `""`, `""`, `""`, `""`, `""`, `""`, netChange].join(","));
  
  const csvString = csvContent.join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvString], { type: "text/csv;charset=utf-8;" });
  const filename = `個人加班請假對帳表_${state.year}年${state.month}月.csv`;
  
  triggerCsvDownload(blob, filename);
}

// 匯出日薪模式 CSV (原 exportToCSV)
function exportDayrateToCSV() {
  const daysInMonth = getDaysInMonth(state.year, state.month);
  const monthData = state.currentMonthData;
  
  let csvContent = [];
  csvContent.push(["日期", "星期", "工作地點", "整天/半天", "日薪", "加班費", "備註"].join(","));
  
  let totalDays = 0;
  let grossSalary = 0;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(state.year, state.month - 1, day);
    const dayOfWeekStr = WEEKDAYS[dateObj.getDay()];
    const dayData = (monthData.days && monthData.days[day]) || { location: "", duration: 0, wage: "", overtime: "", remarks: "" };
    
    totalDays += parseFloat(dayData.duration) || 0;
    const wage = parseInt(dayData.wage) || 0;
    const overtime = parseInt(dayData.overtime) || 0;
    grossSalary += (wage + overtime);
    
    const row = [
      `"${state.month}月${day}日"`,
      `"${dayOfWeekStr}"`,
      `"${(dayData.location || "").replace(/"/g, '""')}"`,
      dayData.duration === 0 ? "休息" : dayData.duration,
      dayData.wage !== "" ? dayData.wage : "0",
      dayData.overtime !== "" ? dayData.overtime : "0",
      `"${(dayData.remarks || "").replace(/"/g, '""')}"`
    ];
    
    csvContent.push(row.join(","));
  }
  
  csvContent.push(",,,,,,");
  
  const deduction = parseInt(deductionAdvanceInput.value) || 0;
  const adjustment = parseInt(adjustmentOtherInput.value) || 0;
  const netSalary = grossSalary - deduction + adjustment;
  
  csvContent.push([`"總天數"`, `""`, `""`, totalDays, `""`, `""`, `""`].join(","));
  csvContent.push([`"全薪"`, `""`, `""`, grossSalary, `""`, `""`, `""`].join(","));
  csvContent.push([`"借支"`, `""`, `""`, deduction, `""`, `""`, `""`].join(","));
  csvContent.push([`"其他"`, `""`, `""`, adjustment, `""`, `""`, `""`].join(","));
  csvContent.push([`"實領金額"`, `""`, `""`, netSalary, `""`, `""`, `""`].join(","));
  
  const csvString = csvContent.join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvString], { type: "text/csv;charset=utf-8;" });
  const filename = `俊賢薪水工作表_${state.year}年${state.month}月.csv`;
  
  triggerCsvDownload(blob, filename);
}

// 觸發 CSV 下載
function triggerCsvDownload(blob, filename) {
  if (navigator.msSaveBlob) {
    navigator.msSaveBlob(blob, filename);
  } else {
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}

// 匯出成圖片 (支援 html2canvas)
async function exportToImage() {
  const element = document.querySelector(".main-panel");
  if (!element) {
    alert("找不到報表元件");
    return;
  }
  
  const originalStatus = saveStatus ? saveStatus.textContent : "";
  setSaveStatus("圖片產生中...");
  
  // 1. 複製一個乾淨的元素用於渲染圖片，避免 input 內容無法顯示與 glassmorphism 產生的渲染異常
  const clone = element.cloneNode(true);
  
  // 移除 clone 中的非列印/匯出元素 (例如加班模式的匯入區與手動表單)
  const cloneImportBox = clone.querySelector(".import-box");
  if (cloneImportBox) cloneImportBox.remove();
  const cloneFormGrid = clone.querySelector(".form-grid");
  if (cloneFormGrid) cloneFormGrid.remove();
  const cloneClearBtn = clone.querySelector("#clear-records-btn");
  if (cloneClearBtn) cloneClearBtn.remove();
  
  // 2. 複製所有 input 的值至 clone
  const originalInputs = element.querySelectorAll("input");
  const clonedInputs = clone.querySelectorAll("input");
  originalInputs.forEach((input, index) => {
    if (clonedInputs[index]) {
      clonedInputs[index].value = input.value;
    }
  });

  // 3. 尋找 clone 中的所有 input 欄位，並將它們替換為普通文字
  const inputs = clone.querySelectorAll("input");
  inputs.forEach(input => {
    const span = document.createElement("span");
    span.textContent = input.value || (input.placeholder === "0" ? "0" : "");
    if (input.classList.contains("wage-input") || input.classList.contains("overtime-input") || input.id === "deduction-advance" || input.id === "adjustment-other") {
      span.style.display = "block";
      span.style.textAlign = "right";
      span.style.fontWeight = "600";
      span.style.fontFamily = "Inter, monospace";
      span.style.padding = "0.4rem 0.5rem";
    } else {
      span.style.display = "inline-block";
      span.style.padding = "0.4rem 0.5rem";
    }
    input.parentNode.replaceChild(span, input);
  });

  // 4. 將按鈕選擇器換成文字
  const durationSelectors = clone.querySelectorAll(".duration-selector");
  durationSelectors.forEach(selector => {
    const activeBtn = selector.querySelector(".duration-opt.active");
    const span = document.createElement("span");
    const val = activeBtn ? activeBtn.dataset.value : "0";
    span.textContent = activeBtn ? activeBtn.textContent : "休";
    span.style.display = "inline-block";
    span.style.fontWeight = "600";
    span.style.padding = "0.2rem 0.6rem";
    span.style.borderRadius = "50px";
    span.style.fontSize = "0.75rem";
    
    if (val === "0.5") {
      span.style.color = "#b45309";
      span.style.backgroundColor = "rgba(245, 158, 11, 0.15)";
    } else if (val === "1" || val === "1.0") {
      span.style.color = "var(--primary)";
      span.style.backgroundColor = "rgba(79, 70, 229, 0.15)";
    } else {
      span.style.color = "var(--text-secondary)";
      span.style.backgroundColor = "rgba(100, 116, 139, 0.15)";
    }
    selector.parentNode.replaceChild(span, selector);
  });

  // 5. 設定複製元素的樣式與位置
  clone.style.position = "absolute";
  clone.style.left = "-9999px";
  clone.style.top = "0";
  clone.style.width = element.offsetWidth + "px";
  clone.style.backdropFilter = "none";
  clone.style.webkitBackdropFilter = "none";
  clone.style.boxShadow = "none";
  
  const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  clone.style.backgroundColor = isDark ? "#1e293b" : "#ffffff";
  clone.style.color = isDark ? "#f8fafc" : "#1e293b";
  
  document.body.appendChild(clone);
  
  try {
    const canvas = await html2canvas(clone, {
      useCORS: true,
      scale: 2,
      backgroundColor: isDark ? "#1e293b" : "#ffffff",
      logging: false
    });
    
    document.body.removeChild(clone);
    
    const image = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = image;
    
    const filenameSuffix = state.appMode === "overtime" ? "加班對帳表" : "薪水工作表";
    link.download = `個人${filenameSuffix}_${state.year}年${state.month}月.png`;
    
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    setSaveStatus(originalStatus);
  } catch (err) {
    if (document.body.contains(clone)) {
      document.body.removeChild(clone);
    }
    console.error("匯出圖片失敗", err);
    alert("匯出圖片失敗：" + err.message);
    setSaveStatus("同步失敗");
  }
}
