
const API_BASE = "https://greedy-king.onrender.com"; 
let ID_TOKEN = null;

async function api(path, method="GET", body=null, auth=true) {
  const headers = { "Content-Type": "application/json" };
  if (auth && ID_TOKEN) headers.Authorization = "Bearer " + ID_TOKEN;
  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.text()) || ("HTTP " + res.status));
  try { return await res.json(); } catch { return null; }
}



async function handleRegister() {
  const email = document.getElementById("regUser").value.trim();
  const pass  = document.getElementById("regPass").value.trim();
  const pass2 = document.getElementById("regPass2").value.trim();
  const msg   = document.getElementById("registerMsg");
  if (pass !== pass2) { msg.textContent = "Mật khẩu xác nhận không khớp"; return; }
  try { await firebase.auth().createUserWithEmailAndPassword(email, pass);
        msg.textContent = "Đăng ký thành công. Vui lòng đăng nhập."; }
  catch(e){ msg.textContent = "Đăng ký thất bại: " + e.message; }
}
async function handleLogin() {
  const email = document.getElementById("loginUser").value.trim();
  const pass  = document.getElementById("loginPass").value.trim();
  const msg   = document.getElementById("loginMsg");
  try { await firebase.auth().signInWithEmailAndPassword(email, pass); msg.textContent = ""; }
  catch(e){ msg.textContent = "Đăng nhập thất bại: " + e.message; }
}
document.getElementById("logoutBtn")?.addEventListener("click", () => firebase.auth().signOut());



let currentUserProfile = null;

firebase.auth().onAuthStateChanged(async (user) => {
  const overlay = document.getElementById("loginOverlay");
  if (!user) { overlay.style.display="flex"; document.querySelector(".game-container").style.display="none"; ID_TOKEN=null; return; }
  ID_TOKEN = await user.getIdToken(true);

  // đồng bộ tên/avatar hiện có (nếu có phần hiển thị)
  await api("/me/init", "POST", {
    userName: document.getElementById("userNameDisplay")?.textContent || "Player",
    avatar: document.querySelector(".user-avatar")?.src || ""
  });

  currentUserProfile = await api("/me", "GET");
  reflectUserProfile(currentUserProfile);

  overlay.style.display="none";
  document.querySelector(".game-container").style.display="flex";
  await fetchJackpot();         // tải jackpot
  // await fetchBetHistory(100); // nếu muốn mở sẵn lịch sử
});

firebase.auth().onIdTokenChanged(async (user) => {
  if (user) ID_TOKEN = await user.getIdToken(true);
});

function reflectUserProfile(pf) {
  if (!pf) return;
  document.getElementById("userNameDisplay").textContent = pf.userName || "Player";
  document.getElementById("userIdDisplay").textContent   = pf.userId   || "—";
  const avatarEl = document.querySelector(".user-avatar");
  if (avatarEl && pf.avatar) avatarEl.src = pf.avatar;
  document.getElementById("balance").textContent = (pf.balance || 0).toLocaleString("en-US");
  document.getElementById("userInfo").style.display = "flex";
}



async function deposit(amount) {
  await api("/wallet/deposit", "POST", { amount });
  reflectUserProfile(await api("/me","GET"));
}
async function withdraw(amount) {
  await api("/wallet/withdraw", "POST", { amount });
  reflectUserProfile(await api("/me","GET"));
}
async function transferCoin(toUserId, amount) {
  await api("/wallet/transfer", "POST", { toUserId, amount });
  reflectUserProfile(await api("/me","GET"));
}



async function redeemCode(code) { return api("/codes/redeem","POST",{ code }); }
document.getElementById("verifyDepositCodeBtn")?.addEventListener("click", async () => {
  const code = document.getElementById("depositUserCode").value.trim();
  const status = document.getElementById("depositStatus");
  if (!code) { status.textContent="Nhập mã code trước đã"; return; }
  try { await redeemCode(code); status.textContent="✅ Đổi code thành công!";
        reflectUserProfile(await api("/me","GET")); }
  catch(e){ status.textContent="❌ "+e.message; }
});



async function fetchJackpot() {
  const j = await api("/jackpot","GET",null,false);
  document.getElementById("jackpot").textContent = (j.amount||0).toLocaleString("en-US");
  document.getElementById("jackpotProgress").value = j.amount || 0;
}
async function contributeJackpot(amount){ await api("/jackpot/contribute","POST",{amount}); await fetchJackpot(); }


async function recordBetOnServer({ roundId, betName, amount, result, payout }) {
  await api("/bets/record","POST",{ roundId, betName, amount, result, payout });
  reflectUserProfile(await api("/me","GET"));
  // nếu thua: góp jackpot 10% số thua (tuỳ bạn)
  const net = -amount + payout;
  if (net < 0) await contributeJackpot(Math.floor(Math.abs(net)*0.10));
}

function buildRoundId() {
  // YYYY-MM-DD-XXX
  window.roundIndex = (window.roundIndex || 1);
  return new Date().toISOString().slice(0,10) + "-" + String(window.roundIndex).padStart(3,"0");
}

// Nếu bạn có object `bets` thì không cần hàm DOM bên dưới.
// Trường hợp không có `bets`, đọc từ DOM:
function getBetFromDOM(name) {
  const el = document.querySelector(`.bet-box[data-name="${name}"] .bet-amount`);
  return Number((el?.textContent || el?.innerText || "0").replace(/[^\d]/g, "")) || 0;
}

// Ghi 1 bản ghi cược lên server (đã có ở các bước trước, nhắc lại cho đủ)
async function recordBetOnServer({ roundId, betName, amount, result, payout }) {
  await api("/bets/record", "POST", { roundId, betName, amount, result, payout });
  const me = await api("/me", "GET");
  reflectUserProfile(me);

  // Nếu thua: góp jackpot 10% số thua (tuỳ chọn)
  const net = -amount + payout;
  if (net < 0) {
    const donate = Math.floor(Math.abs(net) * 0.10);
    if (donate > 0) await api("/jackpot/contribute", "POST", { amount: donate });
  }
}







let countdownDuration = 40; // số giây mỗi phiên
let lastSpinTime = parseInt(localStorage.getItem("lastSpinTime")) || Date.now();
let pauseAfterSpin = false;
let pauseTimer = 0;
let autoInterval;


let spinCount = parseInt(localStorage.getItem("spinCount")) || 0;
let wheelRotation = 0;
let spinInterval;
let isSpinning = false;
// Lấy balance từ localStorage (nếu có)
let balance = parseInt(localStorage.getItem("balance")) || 0;
let jackpot = parseInt(localStorage.getItem("jackpot")) || 0;
let netProfit = parseInt(localStorage.getItem("netProfit")) || 0; // Chênh lệch xu lời
let netLoss = parseInt(localStorage.getItem("netLoss")) || 0;   // Chênh lệch xu lỗ
let currentChip = 0; // chip đang chọn
let bets = {}; // lưu trữ cược hiện tại // lưu số xu đặt cược theo từng cửa

const SPIN_DURATION = 40; // 40 giây 1 phiên
const spinCounterEl = document.getElementById("spinCounter");
const balanceEl = document.getElementById("balance");
const jackpotEl = document.getElementById("jackpot");
const notificationEl = document.getElementById("notification");
const historyEl = document.getElementById("history");
const betHistoryEl = document.getElementById("betHistory");
const JACKPOT_THRESHOLD = 5000;
const JACKPOT_CHANCE = 0;
const wheelEl = document.getElementById("wheel");
const options = [
  { name: "Chua", icon: "🍅", weight: 19.2, reward: 5 },
  { name: "Cải", icon: "🥦", weight: 19.2, reward: 5 },
  { name: "Ngô", icon: "🌽", weight: 19.2, reward: 5 },
  { name: "Rốt", icon: "🥕", weight: 19.2, reward: 5 },
  { name: "Mỳ", icon: "🌭", weight: 10, reward: 10 },
  { name: "Xiên", icon: "🍢", weight: 6.67, reward: 15 },
  { name: "Đùi", icon: "🍖", weight: 4, reward: 25 },
  { name: "Bò", icon: "🥩", weight: 2.53, reward: 45 },
];


const JACKPOT_KEY = "greedy_jackpot_value";
const JACKPOT_MAX_KEY = "greedy_jackpot_max"; // để nhớ luôn progress max (nếu bạn muốn)

function readJackpot() {
  const v = Number(localStorage.getItem(JACKPOT_KEY));
  return Number.isFinite(v) ? v : 0;
}
function writeJackpot(val) {
  const jackpotEl = document.getElementById("jackpot");
  const progressEl = document.getElementById("jackpotProgress");
  const v = Math.max(0, Math.floor(val));

  if (jackpotEl) jackpotEl.textContent = v;
  if (progressEl) {
    const savedMax = Number(localStorage.getItem(JACKPOT_MAX_KEY)) || 1000000;
    // đảm bảo max không nhỏ hơn giá trị hiện tại
    const newMax = Math.max(savedMax, v);
    progressEl.max = newMax;
    progressEl.value = v;
    localStorage.setItem(JACKPOT_MAX_KEY, String(newMax));
  }
  localStorage.setItem(JACKPOT_KEY, String(v));
}

function getJackpotFromStorage() {
  return parseInt(localStorage.getItem(JACKPOT_KEY) || "0", 10);
}
function setJackpotToStorage(value) {
  localStorage.setItem(JACKPOT_KEY, String(value));
}
function getJackpotMaxFromStorage() {
  return parseInt(localStorage.getItem(JACKPOT_MAX_KEY) || "1000000", 10);
}
function setJackpotMaxToStorage(value) {
  localStorage.setItem(JACKPOT_MAX_KEY, String(value));
}

  document.addEventListener("DOMContentLoaded", () => {
  const jackpotEl = document.getElementById("jackpot");
  const progressEl = document.getElementById("jackpotProgress");
  const saved = getJackpotFromStorage();
  const savedMax = getJackpotMaxFromStorage();

  if (jackpotEl) jackpotEl.textContent = isNaN(saved) ? 0 : saved;
  if (progressEl) {
    progressEl.max = isNaN(savedMax) ? 1000000 : savedMax;
    progressEl.value = isNaN(saved) ? 0 : saved;
  }
});

// Hàm thêm lịch sử đặt cược
  function addBetHistory(betName, amount, result = "Chờ kết quả", payout = 0) {
  const time = new Date().toLocaleTimeString();
  const spin = getCurrentSpinNumber(); // số phiên hiện tại
  const entry = { time, spin, betName, amount, result, payout };

  let betHistory = JSON.parse(localStorage.getItem("betHistory")) || [];
  betHistory.push(entry);
  localStorage.setItem("betHistory", JSON.stringify(betHistory));

  renderBetHistory(); // cập nhật UI ngay
}

  function renderBetHistory() {
  let history = JSON.parse(localStorage.getItem("betHistory")) || [];
 
  const modalEl = document.getElementById("modalBetHistory");
  if (!modalEl) return; // nếu modal chưa load
  modalEl.innerHTML = "";

  if (history.length === 0) {
  historyEl.innerHTML = "<p>⚠️ Chưa có lịch sử cược nào.</p>";
  return;
  } 

  history.forEach(entry => {
  modalEl.innerHTML += `
  <div style="margin-bottom:8px; border-bottom:1px solid #444; padding-bottom:5px;">
  ⏰ ${entry.time} | 🎯 Phiên ${entry.spin}<br>
  👉 Đặt <b>${entry.amount}</b> xu vào <b>${entry.betName}</b><br>
  🏆 Kết quả: ${entry.result} | 💰 Xu nhận: ${entry.payout}

  localStorage.setItem("betHistory", JSON.stringify(betHistory));
  </div>
    `;
  });
}


// Khôi phục khi load lại trang
  window.addEventListener("load", () => {
  /*
  let betHistory = JSON.parse(localStorage.getItem("betHistory")) || [];
  betHistoryEl.innerHTML = " <b></b>";
  betHistory.forEach(entry => {
  betHistoryEl.innerHTML += `⏰ ${entry.time} - Đặt ${entry.amount} xu vào ${entry.betName}<br>`;
  });

*/
  document.querySelectorAll('.chip, .bet-box').forEach(el => el.classList.remove('lock-bets'));
  
  resetHistoryDaily();   // chỉ xóa khi sang ngày
  renderBetHistory();    // hiển thị lại ngay lập tức
  updateBalanceDisplay();
  updateJackpotDisplay();
  updateStatsDisplay();
  restoreBets();
});


  function resetHistoryDaily() {
  let today = new Date().toLocaleDateString();
  let savedDate = localStorage.getItem("betHistoryDate");
  if (savedDate !== today) {
  localStorage.setItem("betHistory", JSON.stringify([])); // reset rỗng, KHÔNG remove hẳn
  localStorage.setItem("betHistoryDate", today);
  }
}
resetHistoryDaily();


// Lấy mốc 0h hôm nay
  function getStartOfDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

// Tính số phiên hiện tại
  function getCurrentSpinNumber() {
  const startTime = getStartOfDay();
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  return Math.floor(elapsedSeconds / countdownDuration) + 1;
}




document.querySelectorAll('#betForm input').forEach(input => {
input.addEventListener('input', updateTotalBetDisplay);
});


// Nếu chưa có thì set mốc ban đầu
if (!lastSpinTime) {
  lastSpinTime = Date.now();
  localStorage.setItem("lastSpinTime", lastSpinTime);
}

// Tính thời gian còn lại khi load lại trang
  function getRemainingTime() {
  const startTime = getStartOfDay();
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  const remaining = countdownDuration - (elapsedSeconds % countdownDuration);
  return remaining;
 

  if (remaining <= 0) {
  lastSpinTime = now;
  localStorage.setItem("lastSpinTime", lastSpinTime);
  remaining = countdownDuration;
  }
  return remaining;
}

let countdownValue = getRemainingTime();
//Hiển thị ngay khi load
  renderCountdown();

// Hàm render ra giao diện ngay lập tức
  function renderCountdown() {
  const countdownEl = document.getElementById("autoCountdown");
  countdownEl.innerHTML = `<span id="countdownValue">${countdownValue}</span>`;
}



  // Hiển thị đếm ngược
  function startCountdown() {
  const timer = setInterval(() => {
  countdownValue = getRemainingTime();
  const countdownEl = document.getElementById("autoCountdown");
  const spinNumber = getCurrentSpinNumber();

// Nếu đang trong thời gian chờ sau khi quay
  if (pauseAfterSpin) {
  if (pauseTimer > 0) {
  countdownEl.innerHTML = `<span>${pauseTimer}</span>`;
  countdownEl.classList.add("blink-yellow"); // vàng nhấp nháy
  pauseTimer--;
  // lưu lại số giây còn chờ
  localStorage.setItem("pauseTimer", pauseTimer);
  } 
  else {
  pauseAfterSpin = false;
  localStorage.setItem("pauseAfterSpin", "false");
  localStorage.removeItem("pauseTimer");
  countdownValue = 35; // reset về 35 giây
  countdownEl.classList.remove("blink-yellow");
  renderCountdown(); // hiển thị lại
  countdownEl.innerHTML = `<span id="countdownValue">${countdownValue}</span>`;
  }
  return;
  }
  countdownValue--;
  countdownEl.textContent = `${countdownValue}`;
  countdownEl.innerHTML = `<span id="countdownValue">${countdownValue}</span>`;
  if (countdownValue === 20) {
    suggestResult();
  }
  if (countdownValue <= 5) {
  countdownEl.classList.add("blink"); // đỏ nhấp nháy
  window.addEventListener("keydown", disableF5);
  window.addEventListener("beforeunload", blockReload);
  } 
  else {
  countdownEl.classList.remove("blink");
  }


  if (countdownValue <= 0) {
  lockDoors();   // khóa đặt cược
  if (!isSpinning) {
  spinWheel();
  startDoorAnimation();
  }
  
// Sau khi quay thì pause 4 giây
  pauseAfterSpin = true;
  pauseTimer = 4;
// lưu trạng thái vào localStorage
  localStorage.setItem("pauseAfterSpin", "true");
  localStorage.setItem("pauseTimer", pauseTimer);

  countdownEl.classList.remove("blink"); // tắt đỏ nhấp nháy
  lastSpinTime = Date.now();
  localStorage.setItem("lastSpinTime", lastSpinTime);
  countdownValue = countdownDuration;
  }
  renderCountdown(); // cập nhật mỗi giây
  countdownEl.innerHTML = `<span id="countdownValue">${countdownValue}</span>`;
 // Cập nhật số phiên (nếu cần hiển thị)
  document.getElementById("spinCounter").textContent = `Phiên: ${spinNumber}`;
  }, 1000);
}
startCountdown();


  function suggestResult() {
  const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
  let rand = Math.random() * totalWeight;
  let cumWeight = 0;
  let chosen = null;

  for (let opt of options) {
  cumWeight += opt.weight;
  if (rand <= cumWeight) {
  chosen = opt;
  break;
  }
  }
  if (chosen) {
 /* const hotText = `🔥 Hot: ${chosen.name} ${chosen.icon}`;*/
/*
//  1) Hiển thị ở khu vực suggestion
  document.getElementById("suggestion").textContent = hotText;
*/
//  2) Lưu lại vào localStorage
 /* localStorage.setItem("lastHot", hotText);*/
  localStorage.setItem("lastHotName", chosen.name);

 // 3) Xóa nhãn cũ trong bet-box & cửa
  document.querySelectorAll(".bet-box .hot-label").forEach(el => el.remove());
  document.querySelectorAll(".door .hot-label").forEach(el => el.remove());


//Hiển thị ở bet-box
  const box = document.querySelector(`.bet-box[data-name="${chosen.name}"]`);
  if (box) {
  const label = document.createElement("div");
  label.className = "hot-label";
  label.textContent = `🔥 Hot`;
  box.prepend(label);
  }


//Hiển thị trên ô quay thưởng
  const door = document.querySelector(`.door[data-name="${chosen.name}"]`);
  if (door) {
  const label = document.createElement("div");
  label.className = "hot-label";
  label.textContent = "🔥 Hot";
  door.appendChild(label);
  }
  }
}

//Khi load lại trang, hiển thị lại Hot nếu có
  const savedHot = localStorage.getItem("lastHot");
  if (savedHot) {
  document.getElementById("suggestion").textContent = savedHot;
}

  const savedHotName = localStorage.getItem("lastHotName");
  if (savedHotName) {
// Xóa Hot cũ
  document.querySelectorAll(".bet-box .hot-label").forEach(el => el.remove());
  document.querySelectorAll(".door .hot-label").forEach(el => el.remove());
// Hiển thị lại ở bet-box
  const betBox = document.querySelector(`.bet-box[data-name="${savedHotName}"]`);
  if (betBox) {
  const label = document.createElement("div");
  label.className = "hot-label";
  label.textContent = "🔥 Hot";
  betBox.prepend(label);
  }
// Hiển thị lại ở cửa quay thưởng
  const door = document.querySelector(`.door[data-name="${savedHotName}"]`);
  if (door) {
  const label = document.createElement("div");
  label.className = "hot-label";
  label.textContent = "🔥 Hot";
  door.appendChild(label);
  }
}

  function updateBalance() {
  document.getElementById("balance").textContent = balance;
}

// Hiển thị giao diện rút xu
  document.getElementById("withdrawBtn").onclick = () => {
  document.getElementById("withdrawInfoModal").style.display = "flex";
};

  document.getElementById("closeWithdrawModal").onclick = () => {
  document.getElementById("withdrawInfoModal").style.display = "none";
};



// Xử lý rút xu
  document.getElementById("sendWithdrawBtn").onclick = () => {
  const name = document.getElementById("userName").value;
  const bank = document.getElementById("bankName").value;
  const account = document.getElementById("userAccount").value;
  const amount = parseInt(document.getElementById("withdrawAmount").value);
  const status = document.getElementById("withdrawStatus");

  if (!name || !bank || !account || !amount || amount <= 0) {
  status.textContent = "⚠️ Vui lòng điền đầy đủ thông tin.";
  status.style.color = "red";
  return;
  }

  if (amount > balance) {
  status.textContent = "⚠️ Số dư không đủ để rút.";
  status.style.color = "red";
  return;
  }

// Trừ xu ngay khi gửi yêu cầu
  balance -= amount;
  updateBalanceDisplay();

  // Hiện trạng thái chờ xử lý
  status.style.color = "orange";
  status.textContent = "⏳ Gửi yêu cầu thành công, hệ thống đang xử lý...";

// Thời gian xử lý ngẫu nhiên từ 90s -> 120s
  let wait = Math.floor(Math.random() * (120 - 90 + 1)) + 90; // random 90-120 giây

  const countdown = setInterval(() => {
  wait--;
  status.textContent = `⏳ Hệ thống đang xử lý...`;
  if (wait <= 0) {
  clearInterval(countdown);
  status.textContent = "✅ Rút xu thành công!";
  status.style.color = "lightgreen";
  document.getElementById("notification").textContent = `Rút xu -${amount} thành công, tiền đang được chuyển tới tài khoản.`;

// Tắt notification sau 10s
   setTimeout(() => {
   document.getElementById("notification").textContent = "";
   }, 10000);


// Ẩn modal sau 5s
   setTimeout(() => {
   document.getElementById("withdrawInfoModal").style.display = "none";
   status.textContent = "";
   }, 5000);
}
}, 1000);
};


  function showBankInfo() {
  const amount = parseInt(document.getElementById("amount").value) || 0;
  if (amount > 0) {
  document.getElementById("bankInfo").style.display = "block";
  document.getElementById("depositStatus").textContent = 'Bấm gửi yêu cầu nạp sau khi chuyển khoản.';
  } else {
  alert("Vui lòng nhập số xu muốn nạp!");
  }
}

  function sendDepositRequest() {
  const amount = parseInt(document.getElementById("amount").value) || 0;
  if (amount > 0) {
  if (confirm(` Xác nhận chuyển khoản thành công !`)) {
  // Hiện thông tin ngân hàng
  document.getElementById("bankInfo").style.display = "block";
  // Trạng thái chờ
  const status = document.getElementById("depositStatus");
  let timeLeft = 35;  
  status.style.color = "orange";
  status.textContent = `⏳ Gửi yêu cầu thành công, hệ thống đang xử lý...`;
  // Đếm ngược 30s rồi cộng xu
  const countdown = setInterval(() => {
  timeLeft--;
  if (timeLeft <= 0) {
  clearInterval(countdown);
  deposit(amount);
  status.textContent = `✅ Nạp thành công ${amount} xu vào tài khoản!`;
  status.style.color = "lightgreen";
  document.getElementById("notification").textContent = `Nạp thành công +${amount} xu.`;

  // Sau 5 giây ẩn giao diện ngân hàng
  setTimeout(() => {
  document.getElementById("bankInfo").style.display = "none";
  }, 5000);
  }
  }, 1000);
  }
  } else {
  alert("Vui lòng nhập số xu muốn nạp!");
  }
}


  function updateBetDisplay() {
  document.querySelectorAll(".bet-box").forEach(box => {
  const name = box.dataset.name;
  box.querySelector(".bet-amount").textContent = bets[name];
  });

  const total = Object.values(bets).reduce((a,b)=>a+b,0);
  document.getElementById("totalBetDisplay").textContent = `${total}`;
}

  function increaseJackpotWithReset() {
  const jackpotEl = document.getElementById("jackpot");
  const progressEl = document.getElementById("jackpotProgress");
  if (!jackpotEl) return;

  // Đọc giá trị hiện tại (ưu tiên UI, fallback storage)
  let current = parseInt(jackpotEl.textContent) || getJackpotFromStorage() || 0;

  // +500–1000 xu
  const inc = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;
  let next = current + inc;

  // Tỷ lệ reset Jackpot về còn 20% (ví dụ 10% cơ hội)
  const RESET_PROB = 0.001;  //0.1%
  const RESET_FACTOR = 0.20;   // reset hũ về còn 20%
  if (Math.random() < RESET_PROB) {
  next = Math.floor(next * RESET_FACTOR);
  // (tuỳ chọn) bạn có thể hiển thị thông báo reset ở đây
  // showToast("⚠️ Jackpot bị reset còn 20%!");
  }

 writeJackpot(next); 

  // Cập nhật UI
  jackpotEl.textContent = next;

  // Cập nhật progress
  if (progressEl) {
  // nếu vượt max thì tăng max để progress không bị full
  if (next > progressEl.max) {
  progressEl.max = next;
  setJackpotMaxToStorage(next);
  }
  progressEl.value = next;
  }

  // LƯU vào localStorage để F5 không mất
  setJackpotToStorage(next);

  // hiệu ứng nhẹ
  jackpotEl.classList.add("flash-update");
  setTimeout(() => jackpotEl.classList.remove("flash-update"), 600);
}



  function updateJackpotDisplay() {
  const oldVal = parseInt(jackpotEl.textContent.replace(/\D/g,'')) || 0;
  animateNumber(jackpotEl, oldVal, jackpot, 600);
  document.getElementById("jackpotProgress").value = jackpot;
  localStorage.setItem("jackpot", jackpot);
}
 
  function updateBalanceDisplay() {
  const oldVal = parseInt(balanceEl.textContent.replace(/\D/g,'')) || 0;
  animateNumber(balanceEl, oldVal, balance, 600);
  localStorage.setItem("balance", balance);
}
   
  function showNotification(message) {
  notificationEl.textContent = message;
  setTimeout(() => notificationEl.textContent = "", 3000);
}

//Hàm nạp xu.
 function confirmDeposit() {
 const amount = parseInt(document.getElementById("amount").value) || 0;
 if (amount <= 0) {
 alert("Vui lòng nhập số xu muốn nạp!");
 return;
 }

 const modal = document.getElementById("depositConfirmModal");
 document.getElementById("depositConfirmText").textContent =
 `Bạn có chắc muốn nạp ${amount} xu không?`;

// Hiện modal với hiệu ứng fade-in
  modal.style.display = "flex";
  modal.classList.remove("hide");
  modal.classList.add("show");

 // Nút Hủy
  document.getElementById("depositNo").onclick = () => {
  modal.classList.remove("show");
  modal.classList.add("hide");
  setTimeout(() => { modal.style.display = "none"; }, 300); // đợi animation xong
  };

  // Nút Xác nhận
  document.getElementById("depositYes").onclick = () => {
  modal.classList.remove("show");
  modal.classList.add("hide");
  setTimeout(() => { modal.style.display = "none"; }, 300);
  startDepositProcess(amount);
  };
}

 // Hàm xử lý nạp xu sau khi xác nhận
 function startDepositProcess(amount) {
 const code = "NAP" + Math.floor(100000 + Math.random() * 900000);
 const modal = document.getElementById("depositInfoModal");
 const status = document.getElementById("depositStatus");

// Hiện modal thông tin nạp
 document.getElementById("depositCode").textContent = code;
 modal.style.display = "flex";
 status.style.color = "orange";
 status.innerHTML = `<br><span id="codeExpiry"></span>`;

// Đếm ngược thời gian hết hạn (30 phút)
 let expiryTime = 10 * 60; // 10 phút
 clearInterval(window.expiryTimer); // nếu trước đó còn chạy thì hủy
 window.expiryTimer = setInterval(() => {
 expiryTime--;
 if (expiryTime > 0) {
 const minutes = Math.floor(expiryTime / 60);
 const seconds = expiryTime % 60;
 document.getElementById("codeExpiry").textContent =
 `Mã hết hạn sau ${minutes}:${seconds.toString().padStart(2, "0")}`;
 } else {
 clearInterval(window.expiryTimer);
 document.getElementById("codeExpiry").textContent = "❌ Mã đã hết hạn!";
 document.getElementById("codeExpiry").style.color = "red";
    }
    }, 1000);
// Thời gian xử lý nạp (ngẫu nhiên 60–90 giây)
 let wait = Math.floor(Math.random() * (60 - 30 + 1)) + 60;
 clearInterval(window.processTimer); // hủy nếu có timer cũ
 window.processTimer = setInterval(() => {
 wait--;
 if (wait > 0) {
 status.innerHTML = `
 <span id="codeExpiry">Code hết hạn sau: ${Math.floor(expiryTime / 60)}:${(expiryTime % 60).toString().padStart(2,"0")}</span>
 `;
 } else {
 clearInterval(window.processTimer);
 deposit(amount);
 status.innerHTML = `✅ Nạp thành công ${amount} xu vào tài khoản!<br>
 `;
 status.style.color = "lightgreen";
 document.getElementById("notification").textContent = `Nạp thành công +${amount} xu.`;
 setTimeout(() => {
 document.getElementById("notification").textContent = "";
 }, 10000);
// Modal fade-out sau 5s
 setTimeout(() => {
 modal.classList.remove("show");
 modal.classList.add("hide");
 setTimeout(() => { modal.style.display = "none"; }, 300);
 }, 5000);
 }
 }, 1000);
 document.getElementById("closeDepositModal").onclick = () => {
 modal.classList.remove("show");
 modal.classList.add("hide");
 setTimeout(() => { modal.style.display = "none"; }, 300);
 clearInterval(window.expiryTimer);
 clearInterval(window.processTimer);
 };
}

  function confirmWithdraw() {
  const amount = parseInt(document.getElementById("amount").value);
  const balanceEl = document.getElementById("balance");
  if (isNaN(amount) || amount <= 0) {
  alert("Vui lòng nhập số xu hợp lệ để rút.");
  return;
  }
  if (amount > balance) {
  alert("Không thể rút xu vì số dư không đủ.");
  return;
  }
  if (confirm(`Bạn có chắc muốn rút ${amount} xu không?`)) {
  balance -= amount;
  balanceEl.textContent = balance;
  document.getElementById("notification").textContent = `Rút xu thành công -${amount}`;
  }
}

  function deposit(amount) {
  balance += amount;
  updateBalanceDisplay();
}
    
  function withdraw(amount) {
  balance -= amount;
  updateBalanceDisplay();
  showNotification(`-${amount} xu đã được rút.`);
}

  
   
  

    
  function renderWheel() {
  const angleStep = 360 / options.length;
  wheelEl.innerHTML = ""; // xóa cũ
  options.forEach((opt, index) => {
  const segment = document.createElement("div");
  segment.className = "segment";
  segment.textContent = opt.icon;
  segment.style.transform = `rotate(${index * angleStep}deg) translate(0, -85%)`;
  wheelEl.appendChild(segment);
  });
}
  renderWheel();
    
/// Hàm thêm kết quả vào lịch sử (giữ tối đa 9)
  function addResultToHistory(icon) {
  let Results = JSON.parse(localStorage.getItem("Results")) || [];

  // thêm kết quả mới vào đầu mảng
  Results.unshift(icon);

  // giới hạn 9 kết quả
  if (Results.length > 9) {
    Results = Results.slice(0, 9);
  }

  // lưu lại
  localStorage.setItem("Results", JSON.stringify(Results));

  // cập nhật hiển thị
  renderHistory();
}

// Lưu lịch sử vào localStorage
function saveHistory() {
  const data = historyEl.innerHTML.replace(' <b>Result</b><br>', '');
  localStorage.setItem("historyData", data);
}

// Khôi phục lịch sử khi F5
  function loadHistory() {
  const saved = localStorage.getItem("historyData");
  if (saved) {
   historyEl.innerHTML = ' <b>Result</b><br>' + saved;
  }
}

 // Gọi khi trang load
  window.addEventListener("load", loadHistory);

  function addHistory(resultIcon) {
  saveHistory();
  }

// Hàm hiển thị lịch sử ra giao diện
  function renderHistory() {
  const historyEl = document.getElementById("history");
  historyEl.innerHTML = " <b>Result</b><br>";
  let Results = JSON.parse(localStorage.getItem("Results")) || [];
  Results.forEach(icon => {
  const span = document.createElement("span");
  span.className = "result-item";
  span.textContent = icon + " ";
  historyEl.appendChild(span);
  });
 
}




// gọi khi tải lại trang để load lịch sử cũ
  window.onload = () => {
   // cũng load lại số dư đã lưu
};

  function spinWheel() {
  if (isSpinning) return;
  isSpinning = true;

  if (window.TopWinnersReal?.clear) TopWinnersReal.clear(); // Reset Top mỗi vòng

  document.querySelectorAll('.chip, .bet-box').forEach(chip => chip.classList.add('lock-bets'));
  const resultEl = document.getElementById("result");
  let totalBet = Object.values(bets).reduce((a,b)=>a+b,0);
  for (let key in bets) {
  let val = parseFloat(bets[key]);
  if (isNaN(val) || val < 0) {
  resultEl.textContent = `❌ Cược không hợp lệ ở cửa ${key}`;
  return;}
  }
  document.getElementById("spinSound").play();
  resultEl.classList.add("spin-animating");
  setTimeout(() => {
  resultEl.classList.remove("spin-animating");
  highlightWinner(selected.name);
  }, 5000);
  const spinDuration = 5; // giây
  let countdown = spinDuration;
  const selected = chooseResult();
  const anglePerSegment = 360 / options.length;
  const selectedIndex = options.findIndex(opt => opt.name === selected.name);
  const randomOffset = Math.random() * anglePerSegment; // giúp kết quả trông tự nhiên hơn
  const targetAngle = (360 - (selectedIndex * anglePerSegment + anglePerSegment / 2)%360);
  const extraSpins = 5;
  const targetRotation = 360 * extraSpins + targetAngle;
  wheelRotation += targetRotation;
  wheelEl.style.transform = `rotate(${wheelRotation}deg)`;
  const animationInterval = setInterval(() => {
  const tempIcon = options[Math.floor(Math.random() * options.length)].icon;
  resultEl.textContent = `${tempIcon}`;
  }, 100);

  

  const countdownInterval = setInterval(() => {
  countdown--;
  if (countdown <= 0) {
  clearInterval(countdownInterval);
  clearInterval(animationInterval);
  const betAmount = bets[selected.name] || 0;
  const winAmount = betAmount > 0 ? betAmount * selected.reward : 0;
  balance += winAmount; //trả thưởng

  // 📝 Cập nhật lịch sử cược (thắng / thua)
  const finishedSpinId = getCurrentSpinNumber();  // số phiên quay hiện tại
  let betHistory = JSON.parse(localStorage.getItem("betHistory")) || [];
  betHistory = betHistory.map(entry => {
  if (entry.spin !== finishedSpinId || entry.result !== "Chờ kết quả") return entry;
  const isWin = entry.betName === selected.name;
  entry.result = isWin ? "✅ Thắng" : "❌ Thua";
  entry.payout = isWin ? entry.amount * selected.reward : 0;
  return entry;
});


// ======= CUỐI HÀM QUAY (sau khi xử lý UI xong) =======
(async () => {
  const roundId = buildRoundId();

  // Xác định tập cửa thắng của vòng này
  const winners = saladBurst 
    ? (saladWinners || ["Chua","Cai","Ngo","Rot"])  // nổ Salad: 4 cửa rau thắng
    : [selectedName];                               // thường: 1 cửa thắng

  // Xác định tất cả các "cửa" có tồn tại trong game (để duyệt đủ các cửa người chơi có thể đặt)
  // Nếu bạn đã có mảng options, dùng nó; nếu không, lấy từ DOM:
  const betKeys = (typeof options !== "undefined" && Array.isArray(options) && options.length)
    ? options.map(o => o.name) // nếu mỗi option = { name: "Chua", ... }
    : Array.from(document.querySelectorAll('.bet-box')).map(b => b.dataset.name);

  // Ghi lần lượt tất cả các cửa mà người chơi có đặt (>0)
  for (const name of betKeys) {
    // Lấy số xu người chơi đặt vào cửa này
    const amount = (typeof bets !== "undefined" && bets) ? Number(bets[name] || 0) : getBetFromDOM(name);
    if (!amount) continue; // không đặt → bỏ qua

    // Tính payout theo thắng/thua
    const multi = winners.includes(name) ? (MULTIPLIER?.[name] || 0) : 0;
    const payout = Math.floor(amount * multi);

    // result: chuỗi mô tả kết quả cho record này (để sau này xem lại biết vòng này là "Salad" hay cửa nào thắng)
    const resultLabel = (winners.length > 1) ? ("Salad: " + winners.join("+")) : name;

    await recordBetOnServer({
      roundId,
      betName: name,
      amount,
      result: resultLabel,
      payout
    });
  }

  // Tăng chỉ số vòng cho lần sau
  window.roundIndex++;
})();


localStorage.setItem("betHistory", JSON.stringify(betHistory));
renderBetHistory(); // đẩy vào modal

  updateBalanceDisplay();
  const lostAmount = totalBet - winAmount;
  let profitOrLoss = winAmount - totalBet;
  if (profitOrLoss > 0) {
  netProfit += profitOrLoss;
  } 
  else if (profitOrLoss < 0) {
  netLoss += Math.abs(profitOrLoss);
  }
  updateStatsDisplay();
  addResultToHistory(selected.icon);
  let outcome = winAmount > 0 ? `✅ Thắng ${winAmount}` : `❌ Thua`;
  showResultModal(selected, totalBet, winAmount);
  let jackpotWin = 0;
  if (jackpot >= JACKPOT_THRESHOLD && Math.random() < JACKPOT_CHANCE) {
  jackpotWin = Math.floor(jackpot * 0.8);
  jackpot -= jackpotWin;
  balance += jackpotWin;
  updateBalanceDisplay();
  updateJackpotDisplay();
  outcome += ` 🎉 Nổ hũ! Nhận thêm ${jackpotWin} xu từ hũ!`;
  showJackpotEffect();  // Hiển thị hiệu ứng pháo hoa + coin bay
  }
  if (totalBet >= 0) {
  resultEl.textContent = `${selected.icon}`;

 // ✅ Lưu icon kết quả vào localStorage
  localStorage.setItem("lastResultIcon", result.icon);
  localStorage.setItem("lastResult", JSON.stringify(selected));
  } 
  addHistory(result.icon);

// --- THÊM NGƯỜI THẮNG VÀO TOP WINNERS ---
try {
  if (window.TopWinnersReal) {
    const name   = localStorage.getItem("userName")   || "Bạn";
    const avatar = localStorage.getItem("userAvatar") || `https://i.pravatar.cc/80?u=${encodeURIComponent(name)}`;

    // Nếu bạn thắng, đưa bạn vào bảng (số tròn)
    if (Number(winAmount) > 0) {
      window.TopWinnersReal.add({
        name,
        avatar,
        amount: Math.round(Number(winAmount)/100)*100, // số tròn
        betLabel: "",
        icon: ""
      });
    }

    // Luôn render Top 3, pad thêm người ảo nếu thiếu
    window.TopWinnersReal.renderRound(selected);
  }
} catch (e) {}
// --- HẾT KHỐI THÊM ---


// Gọi ngay sau khi add người thắng thật, trước TopWinnersReal.render()
(function seedBotWinnersForThisSpin(selectedName, isSalad=false){
  const iconMap = { "Chua":"🍅","Cải":"🥬","Ngô":"🌽","Rốt":"🥕","Mỳ":"🌭","Xiên":"🍢","Đùi":"🍖","Bò":"🥩" };
  const bots = [
    { name: "Tâm Tâm", avatar: "https://i.pravatar.cc/80?u=minh" },
    { name: "Híp Híp",  avatar: "https://i.pravatar.cc/80?u=lan"  },
    { name: "Vờ bờ",  avatar: "https://i.pravatar.cc/80?u=hai"  },
    { name: "Baby",   avatar: "https://i.pravatar.cc/80?u=vu"   },
    { name: "Vỡ nợ vì salad",   avatar: "https://i.pravatar.cc/80?u=ruoc"   },
    { name: "Kún Yêu",   avatar: "https://i.pravatar.cc/80?u=keodeo"   },
    { name: "3 rau bỏ idol",   avatar: "https://i.pravatar.cc/80?u=banhquy"   },
    { name: "Mèo Tộc",   avatar: "https://i.pravatar.cc/80?u=socola"   },
    { name: "Sói Bạc",   avatar: "https://i.pravatar.cc/80?u=nuoc"   },
    { name: "Bán máu trả nợ",   avatar: "https://i.pravatar.cc/80?u=ban"   },
    { name: "Masid",   avatar: "https://i.pravatar.cc/80?u=tulanh"   },
    { name: "Mèo Mun",   avatar: "https://i.pravatar.cc/80?u=lo"   },
    { name: "Minh Thư",   avatar: "https://i.pravatar.cc/80?u=bep"   },
    { name: "Súp bào ngư",   avatar: "https://i.pravatar.cc/80?u=quat"   },
    { name: "Thần long",   avatar: "https://i.pravatar.cc/80?u=dieuhoa"   },
    { name: "Vũ Hạo",   avatar: "https://i.pravatar.cc/80?u=maygiat"   },
    { name: "Gia Cát Dự",   avatar: "https://i.pravatar.cc/80?u=tivi"   },
    { name: "Tiểu Bá Hổ",   avatar: "https://i.pravatar.cc/80?u=giuong"   },
    { name: "Shark Tank",   avatar: "https://i.pravatar.cc/80?u=tu"   },
    { name: "Bình Minh",   avatar: "https://i.pravatar.cc/80?u=chuot"   },
    { name: "@@",   avatar: "https://i.pravatar.cc/80?u=dua"   },
    { name: "Lên top",   avatar: "https://i.pravatar.cc/80?u=xoai"   },
    { name: "Bánh bèo",   avatar: "https://i.pravatar.cc/80?u=chom"   },
    { name: "Bún Riêu Cua",   avatar: "https://i.pravatar.cc/80?u=vai"   },
    { name: "Bạch thủ đùi",   avatar: "https://i.pravatar.cc/80?u=nho"   },
    { name: "Nuôi Mỳ top 1",   avatar: "https://i.pravatar.cc/80?u=cam"   },
    { name: "Bạch Thủ Rau",   avatar: "https://i.pravatar.cc/80?u=quyt"   },
    { name: "Phong Vũ",   avatar: "https://i.pravatar.cc/80?u=le"   },
    { name: "Táo mèo",   avatar: "https://i.pravatar.cc/80?u=tao"   },
  ];
  const MULT = isSalad ? 5 : (MULTIPLIER[selectedName] || 5);

  for (let i = 0; i < 2; i++) {
    const b = bots.splice(Math.floor(Math.random()*bots.length), 1)[0];
    // tạo số thắng nguyên (không lẻ) và khác nhau mỗi vòng
    const baseBet = Math.floor(Math.random() * 10000) + 2000; // 2000–10000
    const amount  = Math.round(baseBet * MULT);

    TopWinnersReal.add({
      name: b.name,
      avatar: b.avatar,
      amount,
      betLabel: isSalad ? "Nổ Salad (4 cửa rau)" : ``,
      icon: isSalad ? "🥗" : ("")
     });
  }
})(selected.name, /* isSalad= */ false);

TopWinnersReal.render();



 increaseJackpotWithReset();

// Bật sáng cả ô đặt cược trúng
  const betBox = document.querySelector(`.bet-box[data-name="${selected.name}"]`);
  if (betBox) {
  betBox.classList.add('highlight-win');
  setTimeout(() => {
  setTimeout(() => {
  betBox.classList.remove('highlight-win');
  unlockBets();  
  document.querySelectorAll('.chip, .bet-box').forEach(chip => chip.classList.remove('lock-bets'));
//Tăng số phiên quay.
  spinCount++;
  document.getElementById("spinCounter").textContent = `🎯 Round: ${spinCount}`;
  updateSpinCounter();
//Reset cược.
  resetBets();
  unlockDoors();
  isSpinning = false;
  adminResult = null; 
  document.getElementById("adminSelect").value = "";

  clearBets(); // 🔥 sang vòng mới thì không giữ cược nữa
  clearHot();  // 🔥 Xóa HOT sau 5 giây khi đã trả kết quả
  window.removeEventListener("keydown", disableF5);
  window.removeEventListener("beforeunload", blockReload);
  },5000);
  highlightWinner(selected.name);
  }, 0); // bất sáng ô trúng và tắt ô trượt
  }
  if (winAmount >= 1000) {
  resultEl.classList.add("big-win-effect");
  } 
  else if (winAmount > 0) {
  resultEl.classList.add("small-win-effect");
  }
  setTimeout(() => {
  resultEl.classList.remove("big-win-effect", "small-win-effect");
  }, 2000);

//Hiện thị lịch sử cược.
  if (totalBet > 0) {
  let betLog = `${new Date().toLocaleTimeString()} - Cược: `;
  for (let key in bets) {
  const val = parseFloat(bets[key]) || 0;
  if (val > 0) betLog += `${key}: ${val} xu, `;
  }
  betLog += `→ Kết quả: ${selected.icon} - ${outcome}`;
  betHistoryEl.innerHTML += `🧾 ${betLog}<br>`;
  }
  }
  }, 1000);
}

  // Hàm cập nhật giao diện + lưu
  function updateSpinCounter() {
  const spinNumber = getCurrentSpinNumber();
  spinCounterEl.textContent = `🎯 Round: ${spinNumber}`;
  /*document.getElementById("spinCounter").textContent = `🎯 Round: ${spinCount}`;
  localStorage.setItem("spinCount", spinCount);
  localStorage.setItem("lastSpinDate", getToday());*/
}

// Khi load trang thì hiển thị số phiên đã lưu
  updateSpinCounter();
  setInterval(updateSpinCounter, 1000);

  function weightedRandom(items,bets) {
  const adjustedItems = items.map(item => {
  const betAmount = parseFloat(bets[item.name]) || 0;        
  let penaltyFactor = 1;
  if (betAmount > 0) {
  penaltyFactor = Math.max(0.2, 1 / (1 + betAmount / 10000000));
  }
  return { ...item, weight: item.weight * penaltyFactor };
  });
  const totalWeight = adjustedItems.reduce((sum, item) => sum + item.weight, 0);

 
//Random kết quả.
  let rand = Math.random() * totalWeight;
  let cumWeight = 0;
  for (let item of adjustedItems) {
  cumWeight += item.weight;
  if (rand <= cumWeight) {
  return item;
  }
  }
}

  function confirmSpin() {
  const form = document.getElementById("betForm");
  const formData = new FormData(form);
  let totalBet = 0;
  for (const [key, value] of formData.entries()) {
    totalBet += parseInt(value || 0);
  }
  if (totalBet <= 0) {
    alert("Vui lòng đặt cược trước khi quay.");
    return;
  }
  if (confirm(`Tổng số xu đã đặt cược: ${totalBet}.\nBạn có chắc chắn muốn quay thưởng?`)) {
   spinWheel();
  }
  }

/*//auto quay
  let autoTime = 35;
  let autoInterval;
  let pauseAfterSpin = false;
  let pauseTimer = 0;

  function startAutoSpinTimer() {
  autoInterval = setInterval(() => {
  const countdownEl = document.getElementById("autoCountdown");
// Nếu đang trong thời gian chờ sau khi quay
  if (pauseAfterSpin) {
  if (pauseTimer > 0) {
  countdownEl.textContent = `⏳ Đang chờ kết quả... ${pauseTimer}s`;
  countdownEl.classList.add("blink-yellow"); // vàng nhấp nháy
  pauseTimer--;
  } 
  else {
  autoTime = 35; // reset về 35 giây
  pauseAfterSpin = false;
  countdownEl.classList.remove("blink-yellow");
  countdownEl.textContent = `⏳ Quay thưởng sau: ${autoTime} giây`;
  }
  return;
  }
// Bình thường đếm ngược 35s
  autoTime--;
  countdownEl.textContent = `⏳ Quay thưởng sau: ${autoTime} giây`;
  if (autoTime === 20) {
    suggestResult();
  }
  if (autoTime <= 5) {
  countdownEl.classList.add("blink"); // đỏ nhấp nháy
  } 
  else {
  countdownEl.classList.remove("blink");
  }
  if (autoTime <= 0) {
  if (!isSpinning) {
  spinWheel();
  }

// Sau khi quay thì pause 4 giây
  pauseAfterSpin = true;
  pauseTimer = 4;
  countdownEl.classList.remove("blink"); // tắt đỏ nhấp nháy
  }
  }, 1000);
}*/

  window.onload = function() {
  updateBalanceDisplay();
  updateJackpotDisplay();
  startAutoSpinTimer();
};

  function showJackpotEffect() {
  const container = document.getElementById("jackpotEffect");
  container.innerHTML = "";
// Coin bay xiên
  for (let i = 0; i < 20; i++) {
  const coin = document.createElement("div");
  coin.className = "coin";
  const x = `${(Math.random() - 0.5) * 300}px`;
  const y = `${-150 - Math.random() * 200}px`;
  coin.style.left = `${50 + Math.random() * 30 - 15}%`;
  coin.style.bottom = `0`;
  coin.style.setProperty('--x', x);
  coin.style.setProperty('--y', y);
  container.appendChild(coin);
  }
// Fireworks nhiều màu
  const colors = ['#ff0', '#f0f', '#0ff', '#f55', '#5f5', '#55f', '#ffa500'];
  for (let i = 0; i < 10; i++) {
  const fw = document.createElement("div");
  fw.className = "firework";
  fw.style.left = `${40 + Math.random() * 20}%`;
  fw.style.top = `${30 + Math.random() * 30}%`;
  fw.style.setProperty('--color', colors[Math.floor(Math.random() * colors.length)]);
  container.appendChild(fw);
  }
// Mưa xu
  for (let i = 0; i < 30; i++) {
  const rain = document.createElement("div");
  rain.className = "rain-coin";
  rain.style.left = `${Math.random() * 100}%`;
  rain.style.animationDuration = `${2 + Math.random() * 2}s`;
  rain.style.animationDelay = `${Math.random() * 0.5}s`;
  container.appendChild(rain);
  }
  // Xoá hiệu ứng sau 3 giây
  setTimeout(() => container.innerHTML = "", 3000);
}

  function updateTimeDisplay() {
  const now = new Date();
  const timeString = now.toLocaleTimeString('vi-VN', { hour12: false });
  document.getElementById("currentTime").textContent = timeString;
}
  setInterval(updateTimeDisplay, 1000);
  updateTimeDisplay(); // chạy ngay khi load

  function updateStatsDisplay() {
  const profitEl = document.querySelector(".stat-value.profit");
  const lossEl   = document.querySelector(".stat-value.loss");

  const oldProfit = parseInt(profitEl.textContent.replace(/\D/g,'')) || 0;
  const oldLoss   = parseInt(lossEl.textContent.replace(/\D/g,'')) || 0;

  animateNumber(profitEl, oldProfit, netProfit, 600);
  animateNumber(lossEl, oldLoss, netLoss, 600);

  localStorage.setItem("netProfit", netProfit);
  localStorage.setItem("netLoss", netLoss);
}
  updateStatsDisplay(); // gọi 1 lần khi load trang

  function resetStats() {
  if (confirm("Reset thống kê lãi/lỗ?")) {
  netProfit = 0;
  netLoss = 0;
  updateStatsDisplay();
  }
}

  function updateJackpotDisplay() {
  jackpotEl.textContent = jackpot.toFixed(0);
  localStorage.setItem("jackpot", jackpot); // 🔥 lưu lại jackpot
  document.getElementById("jackpotProgress").value = jackpot;
}

// 🔹 Hiển thị ngay khi load trang
  updateJackpotDisplay();

  if (jackpot >= JACKPOT_THRESHOLD) {
  document.querySelector('button[onclick="confirmSpin()"]').classList.add('glow');
}


// --- CHIP CHỌN TIỀN CƯỢC ---

// Khởi tạo cược = 0 cho tất cả
  document.querySelectorAll(".bet-box").forEach(box => {
  bets[box.dataset.name] = 0;
});


// --- chọn chip ---
  document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  currentChip = parseInt(chip.dataset.value);
  });
});


// --- đặt cược bằng click ô ---
  document.querySelectorAll(".bet-box").forEach(box => {
  box.addEventListener("click", () => {
  if (!currentChip) {
  alert("Hãy chọn mệnh giá chip trước!");
  return;
  }
  if (balance < currentChip) {
  alert("Không đủ số dư để đặt cược!");
  return;
  }
  if (currentChip > 0) {
  const name = box.dataset.name;
  bets[name] = Number(bets[name] || 0) + Number(currentChip);
  balance -= currentChip;
  updateBalanceDisplay();
  updateBetDisplay();
  saveBets();  // 🔥 lưu lại ngay
  }
  });
});

  document.querySelectorAll(".door").forEach(door => {
  door.addEventListener("click", () => {
   if (!currentChip) {
  alert("Hãy chọn mệnh giá chip trước!");
  return;
  }
  if (balance < currentChip) {
  alert("Không đủ số dư để đặt cược!");
  return;
  }
  const name = door.dataset.name;
  if (!bets[name]) bets[name] = 0;
  bets[name] += currentChip;
  const betDisplay = door.querySelector(".bet-display");
  betDisplay.textContent = bets[name];
  localStorage.setItem("currentBets", JSON.stringify(bets));
  balance -= currentChip;
  updateBalanceDisplay();
  });
});


// --- reset cược ---
  function resetBets() {
  bets = {}; // reset object lưu cược
  document.querySelectorAll(".door .bet-display").forEach(el => {
  el.textContent = "0"; // reset hiển thị về 0
  });
  localStorage.removeItem("currentBets"); // nếu bạn có lưu vào localStorage
  for (let k in bets) bets[k] = 0;
  updateBetDisplay();
}

// Lấy ngày hiện tại (yyyy-mm-dd)
  function getToday() {
  let d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// Lấy ngày cuối cùng lưu trong localStorage
  let lastDate = localStorage.getItem("lastSpinDate");

// Nếu khác ngày → reset về 0
  if (lastDate !== getToday()) {
  spinCount = 0;
  localStorage.setItem("spinCount", spinCount);
  localStorage.setItem("lastSpinDate", getToday());
}

// --- Lưu cược vào localStorage ---
  function saveBets() {
  localStorage.setItem("currentBets", JSON.stringify(bets));
  localStorage.setItem("totalBet", document.getElementById("totalBetDisplay").textContent);
}

// --- Khôi phục cược khi load lại ---
  function restoreBets() {
  const savedBets = JSON.parse(localStorage.getItem("currentBets")) || {};
  bets = savedBets;
  Object.keys(bets).forEach(name => {
  bets[name] = Number(bets[name]); // ép về số
  const bet = document.querySelector(`.bet-box[data-name="${name}"] .bet-amount`);
  if (bet) bet.textContent = bets[name];

  document.querySelectorAll(".door").forEach(door => {
  const name = door.dataset.name;
  const betDisplay = door.querySelector(".bet-display");
  betDisplay.textContent = bets[name] || 0;
  });
  });

  // Tổng cược
  const savedTotal = localStorage.getItem("totalBet");
  if (savedTotal) {
  document.getElementById("totalBetDisplay").textContent = savedTotal;
  }
}

// --- Reset cược sau khi quay ---
  function clearBets() {
  bets = {};
  document.querySelectorAll(".bet-amount").forEach(el => el.textContent = "0");
  document.getElementById("totalBetDisplay").textContent = "";
  localStorage.removeItem("currentBets");
  localStorage.removeItem("totalBet");
}

// Gọi restore khi trang vừa load
  window.addEventListener("load", restoreBets);
  window.addEventListener("load", () => {
  let savedResult = localStorage.getItem("lastResult");
  if (savedResult) {
  let selected = JSON.parse(savedResult);
  document.getElementById("result").innerHTML = 
  `${selected.icon}`;
 
  const savedResult = localStorage.getItem("lastResult");
  if (savedResult) {
  startDoorAnimation(parseInt(savedResult, 10));
  }

  }
});

  function startDoorAnimation(callback) {
  const doors = document.querySelectorAll(".door");
  if (!doors.length) return;
// Làm tối tất cả
  doors.forEach(d => d.classList.add("dim"));
  let index = 0;
  const interval = setInterval(() => {
// Tắt sáng
   doors.forEach(d => d.classList.remove("highlight"));
// Sáng cửa hiện tại
   doors[index].classList.add("highlight");
   index = (index + 1) % doors.length;
   }, 100); // đổi cửa mỗi 0.1s
// Sau 5 giây thì dừng
   setTimeout(() => {
   clearInterval(interval);
   doors.forEach(d => d.classList.remove("highlight", "dim"));
   if (callback) callback();
   }, 5000);
}

  
 function highlightWinner(winnerName) {
  const doors = document.querySelectorAll(".door");
  doors.forEach(d => d.classList.remove("winner"));
  doors.forEach(door => {
  const img = door.querySelector("img");
  if (img && img.alt === winnerName) {   // so sánh theo alt
  door.classList.add("winner");
  }
  door.classList.add("dim"); // làm mờ tất cả
  if (door.dataset.name === winnerName) {
  door.classList.remove("dim"); // bỏ mờ ô trúng
  door.classList.add("highlight"); // sáng ô trúng
  } else {
  door.classList.remove("highlight");
  }
  });
// Sau 5s reset lại bình thường
  setTimeout(() => {
  doors.forEach(door => {
  door.classList.remove("dim", "highlight");
  door.classList.remove("winner");
  });
  }, 5000);
}



  function unlockBets() {
  document.querySelectorAll('.chip, .bet-box').forEach(el => {
  el.classList.remove('lock-bets');
  });
  isSpinning = false;
}

  window.addEventListener("load", () => {
  // Mở khóa chip + bet box khi F5
  document.querySelectorAll('.chip, .bet-box').forEach(el => {
  el.classList.remove('lock-bets');
  });
// khôi phục pause 4s
  const savedPause = localStorage.getItem("pauseAfterSpin") === "true";
  const savedPauseTimer = parseInt(localStorage.getItem("pauseTimer")) || 0;
  if (savedPause && savedPauseTimer > 0) {
  pauseAfterSpin = true;
  pauseTimer = savedPauseTimer;
  } else {
  pauseAfterSpin = false;
  pauseTimer = 0;
  }
});


  function clearHot() {
  // Xóa nhãn trong bet-box & cửa
  document.querySelectorAll(".bet-box .hot-label").forEach(el => el.remove());
  document.querySelectorAll(".door .hot-label").forEach(el => el.remove());
  // Xóa text ở khu vực suggestion
  document.getElementById("suggestion").textContent = "";
  // Xóa trong localStorage để lần sau suggestResult() sẽ tạo mới
  localStorage.removeItem("lastHot");
  localStorage.removeItem("lastHotName");
}



  function showResultModal(selected, totalBet, winAmount) {
  const modal = document.getElementById("resultModal");
  document.body.style.overflow = "hidden";   // khoá cuộn

  const spinNumber = getCurrentSpinNumber(); 
  document.getElementById("modalSpin").textContent = spinNumber;

  document.getElementById("modalResult").textContent = selected.icon;
  document.getElementById("modalWinner").textContent = selected.icon;
  document.getElementById("modalBet").textContent = totalBet;
  document.getElementById("modalWin").textContent = winAmount;


  modal.classList.remove("hide");
  modal.style.display = "flex";

  // dùng setTimeout để đảm bảo transition chạy
  setTimeout(() => {
    modal.classList.add("show");
  }, 10);

  // Tự động ẩn sau 5 giây
  setTimeout(() => {
    closeResultModal();
  }, 5000);
}



  function closeResultModal() {
  const modal = document.getElementById("resultModal");
  document.body.style.overflow = "";   
  modal.classList.remove("show");
  modal.classList.add("hide");

  // Chờ animation xong mới ẩn hẳn
  setTimeout(() => {
  modal.style.display = "none";
  modal.classList.remove("hide");
  }, 400);
}

// ESC để đóng modal
  document.addEventListener("keydown", function(event) {
  if (event.key === "Escape") {
  const modal = document.getElementById("resultModal");
  if (modal && modal.style.display !== "none") {
  closeResultModal();
  }
  }
});

// Click ra ngoài modal-box để đóng
  document.getElementById("resultModal").addEventListener("click", function(e) {
  if (e.target === this) {  // chỉ khi click đúng nền đen bên ngoài
  closeResultModal();
  }
});

  function animateNumber(element, start, end, duration = 500) {
  let startTime = null;
  function step(timestamp) {
  if (!startTime) startTime = timestamp;
  const progress = Math.min((timestamp - startTime) / duration, 1);
  const value = Math.floor(progress * (end - start) + start);
  element.textContent = value.toLocaleString("vi-VN") + " ";
  if (progress < 1) {
  requestAnimationFrame(step);
  }
  }
  requestAnimationFrame(step);
// Hiệu ứng flash
  element.classList.add("flash-update");
  setTimeout(() => element.classList.remove("flash-update"), 600);
}

  function lockDoors() {
  document.querySelectorAll(".door").forEach(door => door.classList.add("locked"));
}

  function unlockDoors() {
  document.querySelectorAll(".door").forEach(door => door.classList.remove("locked"));
}


// Khóa chuột phải
document.addEventListener("contextmenu", e => e.preventDefault());

// Chặn các phím tắt DevTools
  document.addEventListener("keydown", function(e) {
  // F12
/*
  if (e.key === "F12") {
  e.preventDefault();
  return false;
  }
*/
  // Ctrl+Shift+I
  if (e.ctrlKey && e.shiftKey && e.key === "I") {
  e.preventDefault();
  return false;
  }
  // Ctrl+Shift+J
  if (e.ctrlKey && e.shiftKey && e.key === "J") {
  e.preventDefault();
  return false;
  }
/*
  // Ctrl+U (view source)
  if (e.ctrlKey && e.key === "u") {
  e.preventDefault();
  return false;
  }
*/
});

let adminResult = null; // null = random, khác null = cửa do admin chọn

// Lắng nghe admin chọn
document.getElementById("adminSelect").addEventListener("change", (e) => {
adminResult = e.target.value || null;
});
// Hàm chọn kết quả (hiện tại dùng random)
function chooseResult() {
if (adminResult) {
// Nếu admin chỉ định thì lấy kết quả đó
return options.find(opt => opt.name === adminResult);
} else {
// Random như cũ
const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
let rand = Math.random() * totalWeight;
let cumWeight = 0;
for (let opt of options) {
cumWeight += opt.weight;
if (rand <= cumWeight) return opt;
  }
  }
}

// Drag & Drop cho adminPanel
  (function makeDraggable() {
  const panel = document.getElementById("adminPanel");
  let offsetX = 0, offsetY = 0, isDown = false;

  panel.addEventListener("mousedown", (e) => {
  isDown = true;
  offsetX = e.clientX - panel.offsetLeft;
  offsetY = e.clientY - panel.offsetTop;
  panel.style.cursor = "grabbing";
  });
  document.addEventListener("mouseup", () => {
  isDown = false;
  panel.style.cursor = "move";
  });
  document.addEventListener("mousemove", (e) => {
  if (!isDown) return;
  panel.style.left = (e.clientX - offsetX) + "px";
  panel.style.top  = (e.clientY - offsetY) + "px";
  });
})();


// Bản đồ phím tắt chọn kết quả
const hotkeyMap = {
  "0": "",       // Random
  "1": "Chua",
  "2": "Cải",
  "3": "Ngô",
  "4": "Rốt",
  "5": "Mỳ",
  "6": "Xiên",
  "7": "Đùi",
  "8": "Bò",
};



// Toggle panel bằng phím tắt Ctrl + M
  document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "m") {
  e.preventDefault(); // tránh select all
  const panel = document.getElementById("adminPanel");
  panel.style.display = (panel.style.display === "none" || panel.style.display === "") 
  ? "block" : "none";
  return;
}
// Chọn kết quả bằng phím số
  if (hotkeyMap.hasOwnProperty(e.key)) {
  const select = document.getElementById("adminSelect");
  select.value = hotkeyMap[e.key];
  adminResult = hotkeyMap[e.key] || null;
}
});

  

 function disableF5(e) {
 if ((e.which || e.keyCode) === 116) {  // 116 = F5
 e.preventDefault();
 return false;
 }
}

 function blockReload(event) {
 event.preventDefault();
 event.returnValue = "";
}

// Nút mở modal
document.getElementById("openHistoryBtn").onclick = () => {
  renderBetHistory(); // luôn load mới nhất trước khi show
  const modal = document.getElementById("historyBetModal");
  modal.style.display = "flex";
  setTimeout(() => modal.classList.add("show"), 10);
};

// Nút đóng modal
 document.getElementById("closeHistoryBtn").onclick = () => {
 document.getElementById("historyBetModal").style.display = "none";
};

// Đóng modal khi nhấn ESC
 document.addEventListener("keydown", (e) => {
 if (e.key === "Escape") {
 const historyModal = document.getElementById("historyBetModal");
 if (historyModal.style.display === "flex") {
 historyModal.style.display = "none";
 }
 }
});

//Mũi tên nạp
const arrow = document.getElementById("openDepositArrow");
const depositModal = document.getElementById("depositInfoModal");
const closeDepositBtn = document.getElementById("closeDepositModal");

arrow.onclick = () => {
  depositModal.style.display = "flex";
  arrow.classList.add("open");
};

closeDepositBtn.onclick = () => {
  depositModal.style.display = "none";
  arrow.classList.remove("open");
};


// Danh sách code hợp lệ + số xu nhận được
const codeRewards = {
  "NAP50": 50, "NAP100": 100, "NAP200": 200,"NAP300": 300,"NAP400": 400, "NAP500": 500, "NAP1000": 1000,"NAP2000": 2000,"NAP3000": 3000,"NAP4000": 4000,"NAP5000": 5000,"NAP10000": 10000,"NAP20000": 20000,"NAP30000": 30000, "NAP40000": 40000, "NAP50000": 50000,
 

// Code 100
"GRD518327915433" : 100,  "GRD224840549311" : 100,  "GRD240663650003" : 100,  "GRD536694243430" : 100,  "GRD620621292115" : 100,  "GRD199324507618" : 100,  "GRD199396195503" : 100,  "GRD977263453631" : 100,  "GRD882169353521" : 100,
"GRD155489840949" : 100,  "GRD325546709123" : 100,  "GRD947521559470" : 100,  "GRD125244829642" : 100,  "GRD466932273721" : 100,  "GRD478023144131" : 100,  "GRD689216189350" : 100,  "GRD405667564079" : 100,  "GRD859893941736" : 100,
"GRD516803965681" : 100,  "GRD124585230226" : 100,  "GRD263285180336" : 100,  "GRD666374772214" : 100,  "GRD206947868997" : 100,  "GRD799673824986" : 100,  "GRD962595720557" : 100,  "GRD945231173709" : 100,  "GRD986869776234" : 100,
"GRD673364651871" : 100,  "GRD275606546116" : 100,  "GRD620608459553" : 100,  "GRD172118145334" : 100,  "GRD370912021958" : 100,  "GRD617092065027" : 100,  "GRD931280946932" : 100,  "GRD513771618016" : 100,  "GRD756835418364" : 100,
"GRD857912516686" : 100,  "GRD643848043412" : 100,  "GRD401683580965" : 100,  "GRD421792465813" : 100,  "GRD683122636083" : 100,  "GRD459336459522" : 100,  "GRD538923017393" : 100,  "GRD831682244162" : 100,  "GRD489027426161" : 100,
"GRD756775224128" : 100,  "GRD451650717053" : 100,  "GRD237363621132" : 100,  "GRD776835646264" : 100,  "GRD362016629135" : 100,  "GRD747267003143" : 100,  "GRD875820435681" : 100,  "GRD465973854788" : 100,  "GRD980141365373" : 100,
"GRD964072952941" : 100,  "GRD501614122446" : 100,  "GRD546365068854" : 100,  "GRD870418224303" : 100,  "GRD462196810495" : 100,  "GRD566118256889" : 100,  "GRD610625351711" : 100,  "GRD431782027620" : 100,  "GRD517539696176" : 100,
"GRD864977047560" : 100,  "GRD885473151333" : 100,  "GRD738120149444" : 100,  "GRD279218452022" : 100,  "GRD422444521237" : 100,  "GRD712216707440" : 100,  "GRD876825603197" : 100,  "GRD149378295481" : 100,  "GRD852801374548" : 100,
"GRD406656806850" : 100,  "GRD461133671096" : 100,  "GRD569585729069" : 100,  "GRD195324411845" : 100,  "GRD707143606817" : 100,  "GRD213084798879" : 100,  "GRD689260175734" : 100,  "GRD908658151464" : 100,  "GRD943969260761" : 100,
"GRD219898021192" : 100,  "GRD409043723962" : 100,  "GRD828020356075" : 100,  "GRD895559924241" : 100,  "GRD418777049159" : 100,  "GRD203598384342" : 100,  "GRD692545042428" : 100,  "GRD613742076256" : 100,  "GRD325741948971" : 100,
"GRD456964718010" : 100,  "GRD916291480176" : 100,  "GRD191172876196" : 100,  "GRD350520159822" : 100,  "GRD915361686023" : 100,  "GRD320667527960" : 100,  "GRD535432984392" : 100,  "GRD235200201035" : 100,  "GRD322042197806" : 100,


// Code 200
"GRD818201647831" : 200,  "GRD898883673714" : 200,  "GRD671568215272" : 200,  "GRD272548150303" : 200,  "GRD778316031685" : 200,  "GRD633155878717" : 200,  "GRD232852506314" : 200,  "GRD804330778094" : 200,  "GRD256703831215" : 200,
"GRD585351851292" : 200,  "GRD295070075943" : 200,  "GRD821050127713" : 200,  "GRD132626031294" : 200,  "GRD303308033287" : 200,  "GRD648869459071" : 200,  "GRD378615865051" : 200,  "GRD198028559908" : 200,  "GRD520104076505" : 200,
"GRD580150351345" : 200,  "GRD684137809356" : 200,  "GRD335510343979" : 200,  "GRD168496772985" : 200,  "GRD461386062374" : 200,  "GRD134310609512" : 200,  "GRD191299479596" : 200,  "GRD593954899854" : 200,  "GRD638029042829" : 200,
"GRD262115053710" : 200,  "GRD291966448599" : 200,  "GRD939360360514" : 200,  "GRD846856997999" : 200,  "GRD986020481035" : 200,  "GRD440958191772" : 200,  "GRD800194711345" : 200,  "GRD864690562532" : 200,  "GRD537903702503" : 200,
"GRD500719547077" : 200,  "GRD769322482310" : 200,  "GRD333572954964" : 200,  "GRD740942816539" : 200,  "GRD342364936315" : 200,  "GRD897271974294" : 200,  "GRD524612615293" : 200,  "GRD889150118769" : 200,  "GRD591147754279" : 200,
"GRD408354476171" : 200,  "GRD360917932873" : 200,  "GRD949014950315" : 200,  "GRD485883927737" : 200,  "GRD780711040980" : 200,  "GRD766905590424" : 200,  "GRD279970598139" : 200,  "GRD892972695321" : 200,  "GRD384882292151" : 200,
"GRD510473538341" : 200,  "GRD573566209935" : 200,  "GRD586141675274" : 200,  "GRD473241307018" : 200,  "GRD257852080040" : 200,  "GRD803406755248" : 200,  "GRD273501507374" : 200,  "GRD260432220042" : 200,  "GRD105207427084" : 200,
"GRD666144989699" : 200,  "GRD184879215431" : 200,  "GRD398830337225" : 200,  "GRD660488430633" : 200,  "GRD660480601453" : 200,  "GRD310184660649" : 200,  "GRD595828671733" : 200,  "GRD591333497152" : 200,  "GRD703604995048" : 200,
"GRD419421204240" : 200,  "GRD484396738041" : 200,  "GRD771301984350" : 200,  "GRD716924805014" : 200,  "GRD617203618459" : 200,  "GRD781662437004" : 200,  "GRD917759652731" : 200,  "GRD643040549492" : 200,  "GRD395553036465" : 200,
"GRD381031995163" : 200,  "GRD749398592814" : 200,  "GRD240728904861" : 200,  "GRD356419561442" : 200,  "GRD907220508567" : 200,  "GRD930237326156" : 200,  "GRD897382531218" : 200,  "GRD975873244013" : 200,  "GRD967741561322" : 200,
"GRD789746827835" : 200,  "GRD706478548259" : 200,  "GRD611756488898" : 200,  "GRD827651824463" : 200,  "GRD982730410674" : 200,  "GRD835337381604" : 200,  "GRD600795493971" : 200,  "GRD155583747108" : 200,  "GRD474073735486" : 200,


 // Code 500
"GRD597702201895" : 500,  "GRD829159950826" : 500,  "GRD836805930865" : 500,  "GRD472923698538" : 500,  "GRD780870601165" : 500,  "GRD613000550625" : 500,  "GRD143565612419" : 500,  "GRD314163081650" : 500,  "GRD942536705934" : 500,
"GRD860241807371" : 500,  "GRD948820582149" : 500,  "GRD118889833350" : 500,  "GRD635724174930" : 500,  "GRD558566336368" : 500,  "GRD459199148952" : 500,  "GRD115028936857" : 500,  "GRD293153750470" : 500,  "GRD398830216949" : 500,
"GRD560894931935" : 500,  "GRD730100762273" : 500,  "GRD416257638482" : 500,  "GRD470301591014" : 500,  "GRD822347608801" : 500,  "GRD518085321926" : 500,  "GRD354850762651" : 500,  "GRD852883212205" : 500,  "GRD447979518183" : 500,
"GRD810505220103" : 500,  "GRD899898430046" : 500,  "GRD784891579615" : 500,  "GRD341584142403" : 500,  "GRD635068496790" : 500,  "GRD225164671781" : 500,  "GRD963263003113" : 500,  "GRD476561134505" : 500,  "GRD613931135223" : 500,
"GRD612096088770" : 500,  "GRD806687108012" : 500,  "GRD740661542309" : 500,  "GRD951109657615" : 500,  "GRD627979799343" : 500,  "GRD103585290217" : 500,  "GRD477787137715" : 500,  "GRD856214563767" : 500,  "GRD914770603035" : 500,
"GRD567117894682" : 500,  "GRD802262741290" : 500,  "GRD802618261835" : 500,  "GRD693218540834" : 500,  "GRD872645778472" : 500,  "GRD909912207147" : 500,  "GRD805800304788" : 500,  "GRD937341365263" : 500,  "GRD442349080180" : 500,
"GRD934226038555" : 500,  "GRD369753659323" : 500,  "GRD867233571168" : 500,  "GRD268346449182" : 500,  "GRD856809723597" : 500,  "GRD976435649470" : 500,  "GRD196152662133" : 500,  "GRD480236903246" : 500,  "GRD471290075886" : 500,
"GRD105861044640" : 500,  "GRD388575543154" : 500,  "GRD651828962777" : 500,  "GRD744880735143" : 500,  "GRD795278514532" : 500,  "GRD750083315598" : 500,  "GRD424392959016" : 500,  "GRD974689355237" : 500,  "GRD624509242496" : 500,
"GRD484686459522" : 500,  "GRD549628914773" : 500,  "GRD906477891723" : 500,  "GRD273896906652" : 500,  "GRD582224110003" : 500,  "GRD875436230725" : 500,  "GRD765219091634" : 500,  "GRD402370341891" : 500,  "GRD847118953889" : 500,
"GRD504451743254" : 500,  "GRD190687445567" : 500,  "GRD647868288983" : 500,  "GRD721487210885" : 500,  "GRD353651447667" : 500,  "GRD215565370579" : 500,  "GRD859991911888" : 500,  "GRD321100015559" : 500,  "GRD856345441116" : 500,
"GRD212511500007" : 500,  "GRD592790416757" : 500,  "GRD293867351092" : 500,  "GRD435316219345" : 500,  "GRD705720391482" : 500,  "GRD621375024208" : 500,  "GRD214376291617" : 500,  "GRD524294999226" : 500,  "GRD207383790300" : 500,


 // Code 1.000 
 "GRD657001248377" : 1000,"GRD936174258832" : 1000,"GRD764674350410" : 1000,"GRD899977994764" : 1000,"GRD990808515532" : 1000,"GRD942215025311" : 1000,"GRD230159811256" : 1000,"GRD395285988439" : 1000,"GRD860052091328" : 1000, 
 "GRD883045607705" : 1000,"GRD611475074123" : 1000,"GRD720210969039" : 1000,"GRD639252131257" : 1000,"GRD875873455563" : 1000,"GRD651946988354" : 1000,"GRD199223489745" : 1000,"GRD850679453400" : 1000,"GRD321631668891" : 1000, 
 "GRD456656685997" : 1000,"GRD604968327126" : 1000,"GRD630767546737" : 1000,"GRD941841143632" : 1000,"GRD333826797584" : 1000,"GRD502808867081" : 1000,"GRD809512592098" : 1000,"GRD706773874209" : 1000,"GRD414172012273" : 1000,
 "GRD775867586650" : 1000,"GRD645679894855" : 1000,"GRD818933747229" : 1000,"GRD248205933044" : 1000,"GRD467380765803" : 1000,"GRD986545652997" : 1000,"GRD593683022310" : 1000,"GRD584919393683" : 1000,"GRD298651524160" : 1000,
 "GRD603657638189" : 1000,"GRD232284057886" : 1000,"GRD717697103547" : 1000,"GRD405062962664" : 1000,"GRD350851474022" : 1000,"GRD634518928956" : 1000,"GRD684514969354" : 1000,"GRD762609460183" : 1000,"GRD693158661660" : 1000,
 "GRD426800685832" : 1000,"GRD870820057591" : 1000,"GRD911806750130" : 1000,"GRD952367888569" : 1000,"GRD794374776459" : 1000,"GRD105415273092" : 1000,"GRD338986129378" : 1000,"GRD234065523369" : 1000,"GRD668095659843" : 1000,
 "GRD962040963562" : 1000,"GRD267558261396" : 1000,"GRD523850793874" : 1000,"GRD728073630730" : 1000,"GRD681517272155" : 1000,"GRD165870032407" : 1000,"GRD678182297751" : 1000,"GRD509564201209" : 1000,"GRD997554885414" : 1000,
 "GRD262703276935" : 1000,"GRD292326416126" : 1000,"GRD250815123998" : 1000,"GRD690730273182" : 1000,"GRD948804865850" : 1000,"GRD747707857380" : 1000,"GRD509341007982" : 1000,"GRD534254974897" : 1000,"GRD129916990266" : 1000,
 "GRD765035502552" : 1000,"GRD251274285375" : 1000,"GRD785068952565" : 1000,"GRD223399348942" : 1000,"GRD499504551720" : 1000,"GRD233099085499" : 1000,"GRD420137852416" : 1000,"GRD659170882133" : 1000,"GRD314677718287" : 1000, 
 "GRD507919643129" : 1000,"GRD591185381132" : 1000,"GRD150383719691" : 1000,"GRD502458376271" : 1000,"GRD572872390857" : 1000,"GRD603530558402" : 1000,"GRD634117026918" : 1000,"GRD717963551173" : 1000,"GRD470255040531" : 1000, 
 "GRD798039334026" : 1000,"GRD391205049668" : 1000,"GRD816663720688" : 1000,"GRD580325683159" : 1000,"GRD356446639343" : 1000,"GRD644299747381" : 1000,"GRD740483832271" : 1000,"GRD909618081591" : 1000,"GRD631872331339" : 1000,  
 
// Code 5.000
"GRD1938475610294" : 5000, "GRD8392017465930" : 5000, "GRD6573829103847" : 5000, "GRD1203948572301" : 5000, "GRD9485761203847" : 5000, "GRD3049587612390" : 5000, "GRD7582937465810" : 5000, "GRD6283746571029" : 5000, "GRD3847561203948" : 5000,
"GRD9384756102039" : 5000, "GRD8475610293847" : 5000, "GRD4857612039485" : 5000, "GRD1029384756102" : 5000, "GRD2938475610293" : 5000, "GRD3847561029384" : 5000, "GRD1203948576102" : 5000, "GRD6571029384756" : 5000, "GRD3948576102938" : 5000,
"GRD2039485761023" : 5000, "GRD8475612039485" : 5000, "GRD1029384756120" : 5000, "GRD9384756120394" : 5000, "GRD5761029384756" : 5000, "GRD3847561203948" : 5000, "GRD9384756102039" : 5000, "GRD1029384756102" : 5000, "GRD3847561029384" : 5000,
"GRD9384756120394" : 5000, "GRD4857612039485" : 5000, "GRD1029384756102" : 5000, "GRD2938475610293" : 5000, "GRD3948576102938" : 5000, "GRD1203948576102" : 5000, "GRD8475610293847" : 5000, "GRD2039485761023" : 5000, "GRD6571029384756" : 5000,
"GRD5761029384756" : 5000, "GRD8475612039485" : 5000, "GRD3847561203948" : 5000, "GRD9384756102039" : 5000, "GRD1029384756102" : 5000, "GRD4857612039485" : 5000, "GRD3948576102938" : 5000, "GRD8475610293847" : 5000, "GRD2039485761023" : 5000,
"GRD2938475610293" : 5000, "GRD5761029384756" : 5000, "GRD3847561203948" : 5000, "GRD8475612039485" : 5000, "GRD9384756120394" : 5000, "GRD1203948576102" : 5000, "GRD1029384756102" : 5000, "GRD3948576102938" : 5000, "GRD6571029384756" : 5000,
"GRD2039485761023" : 5000, "GRD8475610293847" : 5000, "GRD4857612039485" : 5000, "GRD9384756102039" : 5000, "GRD1029384756102" : 5000, "GRD2938475610293" : 5000, "GRD5761029384756" : 5000, "GRD8475612039485" : 5000, "GRD3847561029384" : 5000,
"GRD3948576102938" : 5000, "GRD1203948576102" : 5000, "GRD4857612039485" : 5000, "GRD2039485761023" : 5000, "GRD6571029384756" : 5000, "GRD9384756120394" : 5000, "GRD1029384756102" : 5000, "GRD8475610293847" : 5000, "GRD3847561203948" : 5000,
"GRD5761029384756" : 5000, "GRD2938475610293" : 5000, "GRD9384756102039" : 5000, "GRD1029384756102" : 5000, "GRD3948576102938" : 5000, "GRD8475612039485" : 5000, "GRD2039485761023" : 5000, "GRD4857612039485" : 5000, "GRD3847561029384" : 5000,
"GRD8475610293847" : 5000, "GRD1029384756102" : 5000, "GRD1203948576102" : 5000, "GRD9384756120394" : 5000, "GRD2938475610293" : 5000, "GRD6571029384756" : 5000, "GRD3948576102938" : 5000, "GRD5761029384756" : 5000, "GRD3847561203948" : 5000,
"GRD4857612039485" : 5000, "GRD9384756102039" : 5000, "GRD8475612039485" : 5000, "GRD2039485761023" : 5000, "GRD1029384756102" : 5000, "GRD3847561029384" : 5000, "GRD8475610293847" : 5000, "GRD1203948576102" : 5000, "GRD6571029384756" : 5000,

 // Code 10.000
"GRD1923846572039" : 10000, "GRD3847561029384" : 10000, "GRD9574839201847" : 10000, "GRD2398475610283" : 10000, "GRD3847562103948" : 10000, "GRD6572840392847" : 10000, "GRD9482039485762" : 10000, "GRD2039485762839" : 10000, "GRD8475612938475" : 10000,
"GRD3948571029384" : 10000, "GRD9482039475610" : 10000, "GRD6571203948571" : 10000, "GRD2039485610293" : 10000, "GRD1029384762389" : 10000, "GRD3847561093847" : 10000, "GRD7384029485732" : 10000, "GRD6572039485762" : 10000, "GRD9283745610201" : 10000,
"GRD3847561029384" : 10000, "GRD5738291049573" : 10000, "GRD2948571203948" : 10000, "GRD7483928475610" : 10000, "GRD1923846572039" : 10000, "GRD3847562103948" : 10000, "GRD6572039485762" : 10000, "GRD2389475610293" : 10000, "GRD3847561029384" : 10000,
"GRD9482039485762" : 10000, "GRD6571203948571" : 10000, "GRD3847561029384" : 10000, "GRD7483928475610" : 10000, "GRD2938475610283" : 10000, "GRD3948571203948" : 10000, "GRD6572840392847" : 10000, "GRD3847562103948" : 10000, "GRD2039485610293" : 10000,
"GRD3847561093847" : 10000, "GRD5738291049573" : 10000, "GRD2398475610283" : 10000, "GRD9482039485762" : 10000, "GRD6572039485762" : 10000, "GRD2398475610283" : 10000, "GRD1923846572039" : 10000, "GRD3847561029384" : 10000, "GRD3847562103948" : 10000,
"GRD9482039485762" : 10000, "GRD6572840392847" : 10000, "GRD3948571203948" : 10000, "GRD2039485762839" : 10000, "GRD3847561029384" : 10000, "GRD6571203948571" : 10000, "GRD1029384762389" : 10000, "GRD3847561093847" : 10000, "GRD2039485610293" : 10000,
"GRD9482039485762" : 10000, "GRD7384029485732" : 10000, "GRD6572039485762" : 10000, "GRD1923846572039" : 10000, "GRD3847562103948" : 10000, "GRD6572840392847" : 10000, "GRD9482039485762" : 10000, "GRD2039485610293" : 10000, "GRD3847561093847" : 10000,
"GRD3847561029384" : 10000, "GRD6571203948571" : 10000, "GRD7392019485762" : 10000, "GRD3847562103948" : 10000, "GRD2398475610283" : 10000, "GRD9482039485762" : 10000, "GRD6572039485762" : 10000, "GRD3948571203948" : 10000, "GRD2039485762839" : 10000,
"GRD1029384762389" : 10000, "GRD3847561093847" : 10000, "GRD5738291049573" : 10000, "GRD6572039485762" : 10000, "GRD3847561029384" : 10000, "GRD9482039485762" : 10000, "GRD6571203948571" : 10000, "GRD2039485610293" : 10000, "GRD3847562103948" : 10000,
"GRD6572840392847" : 10000, "GRD3847561093847" : 10000, "GRD2398475610283" : 10000, "GRD3847562103948" : 10000, "GRD6572039485762" : 10000, "GRD3948571203948" : 10000, "GRD2389475610293" : 10000, "GRD3847561029384" : 10000, "GRD6571203948571" : 10000,

//Code 20.000
"GRD4839203848571" : 20000, "GRD7392013847561" : 20000, "GRD3847561029384" : 20000, "GRD6572039485762" : 20000, "GRD9482039475610" : 20000, "GRD2938475610283" : 20000, "GRD3847562103948" : 20000, "GRD6571203948571" : 20000, "GRD7483928475610" : 20000,
"GRD2938475610283" : 20000, "GRD6572039485762" : 20000, "GRD3847561029384" : 20000, "GRD9482039485762" : 20000, "GRD3847562103948" : 20000, "GRD6571203948571" : 20000, "GRD7392013847561" : 20000, "GRD9482039475610" : 20000, "GRD3847561029384" : 20000,
"GRD6572039485762" : 20000, "GRD3847562103948" : 20000, "GRD7392013847561" : 20000, "GRD3847561029384" : 20000, "GRD6571203948571" : 20000, "GRD2938475610283" : 20000, "GRD9482039475610" : 20000, "GRD7392013847561" : 20000, "GRD3847562103948" : 20000,
"GRD6572039485762" : 20000, "GRD9482039485762" : 20000, "GRD3847561029384" : 20000, "GRD6571203948571" : 20000, "GRD3847562103948" : 20000, "GRD7392013847561" : 20000, "GRD2938475610283" : 20000, "GRD3847562103948" : 20000, "GRD6572039485762" : 20000,
"GRD7392013847561" : 20000, "GRD3847561029384" : 20000, "GRD6571203948571" : 20000, "GRD9482039485762" : 20000, "GRD2938475610283" : 20000, "GRD3847562103948" : 20000, "GRD6572039485762" : 20000, "GRD3847561029384" : 20000, "GRD7392013847561" : 20000,
"GRD3847561029384" : 20000, "GRD6572039485762" : 20000, "GRD9482039485762" : 20000, "GRD6571203948571" : 20000, "GRD3847562103948" : 20000, "GRD7392013847561" : 20000, "GRD2938475610283" : 20000, "GRD6572039485762" : 20000, "GRD3847562103948" : 20000,
"GRD7392013847561" : 20000, "GRD3847561029384" : 20000, "GRD6571203948571" : 20000, "GRD9482039485762" : 20000, "GRD3847562103948" : 20000, "GRD6572039485762" : 20000, "GRD7392013847561" : 20000, "GRD2938475610283" : 20000, "GRD3847562103948" : 20000,
"GRD6572039485762" : 20000, "GRD3847561029384" : 20000, "GRD6571203948571" : 20000, "GRD9482039485762" : 20000, "GRD2938475610283" : 20000, "GRD3847562103948" : 20000, "GRD6572039485762" : 20000, "GRD3847561029384" : 20000, "GRD7392013847561" : 20000,

};

// Lấy danh sách code đã sử dụng từ localStorage
  let usedCodes = JSON.parse(localStorage.getItem("usedCodes")) || [];

  document.getElementById("verifyDepositCodeBtn").onclick = () => {
  const codeInput = document.getElementById("depositUserCode").value.trim();
  const statusEl = document.getElementById("depositStatus");

  if (!codeInput) {
    statusEl.textContent = "⚠️ Vui lòng nhập code!";
    statusEl.style.color = "red";
    return;
  }

  // Kiểm tra code đã dùng chưa
  if (usedCodes.includes(codeInput)) {
  statusEl.textContent = "❌ Mã code này đã được sử dụng.";
  statusEl.style.color = "red";
  return;
  }

  if (codeRewards[codeInput]) {
    const reward = codeRewards[codeInput];
    balance += reward;
    localStorage.setItem("balance", balance);
    updateBalance();

    statusEl.textContent = `✅ Đổi code thành công. +${reward} xu vào tài khoản.`;
    statusEl.style.color = "lightgreen";

 // Lưu lại code đã dùng
    usedCodes.push(codeInput);
    localStorage.setItem("usedCodes", JSON.stringify(usedCodes));

    document.getElementById("notification").textContent = `🎉 Nạp thành công +${reward} xu qua code ${codeInput}!`;

    setTimeout(() => {
    document.getElementById("notification").textContent = "";
    }, 10000);

    delete codeRewards[codeInput];
    localStorage.setItem("validCodes", JSON.stringify(validCodes));
  } else {
    statusEl.textContent = "❌ Code không hợp lệ!";
    statusEl.style.color = "red";
  }
};

let validCodes = JSON.parse(localStorage.getItem("validCodes")) || {};

// Hàm tạo code ngẫu nhiên
  function generateRandomCode(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
  code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}


// Lấy lịch sử đổi code từ localStorage
  let codeHistory = JSON.parse(localStorage.getItem("codeHistory")) || [];

// Hàm hiển thị lịch sử code
  function renderCodeHistory() {
  const listEl = document.getElementById("codeHistoryList");
  if (!listEl) return;

  if (codeHistory.length === 0) {
  listEl.innerHTML = "<p>⚠️ Chưa có code nào được tạo.</p>";
  return;
  }

   listEl.innerHTML = "";
  codeHistory.slice().reverse().forEach((entry, index) => {
  listEl.innerHTML += `
  <div style="margin-bottom:8px; border-bottom:1px solid #444; padding-bottom:5px; display:flex; justify-content:space-between; align-items:center;">
  <div>
  ⏰ ${entry.time}<br>
  🔑 <b>${entry.code}</b> | 💰 ${entry.amount} xu
  </div>
  <button class="copyBtn" data-code="${entry.code}" 
  style="padding:4px 8px; background:gold; color:#000; border:none; border-radius:6px; font-size:0.8em; cursor:pointer;">
  📋 Copy
  </button>
  </div>
  `;
  });
// Gắn sự kiện copy cho tất cả nút
  document.querySelectorAll(".copyBtn").forEach(btn => {
  btn.onclick = () => {
  const code = btn.getAttribute("data-code");
  navigator.clipboard.writeText(code).then(() => {
  btn.textContent = "✅ Copied";
  setTimeout(() => (btn.textContent = "📋 Copy"), 10000);
  });
  };
  });
}

let pendingAmount = 0; // số xu chuẩn bị đổi

// Xử lý chuyển xu thành code
  document.getElementById("convertToCodeBtn").onclick = () => {
  const amount = parseInt(document.getElementById("convertAmount").value);
  const statusEl = document.getElementById("generatedCode");

  if (!amount || amount <= 0) {
  statusEl.textContent = "⚠️ Nhập số xu hợp lệ.";
  statusEl.style.color = "red";
  return;
  }
  if (amount > balance) {
  statusEl.textContent = "❌ Số dư không đủ.";
  statusEl.style.color = "red";
  return;
  }

 // Lưu tạm số xu cần đổi
  pendingAmount = amount;


 // Hiển thị modal xác nhận (có hiệu ứng)
  document.getElementById("confirmMessage").textContent = 
  `Bạn có chắc chắn muốn đổi ${amount} xu thành code không?`;
  const modal = document.getElementById("confirmConvertModal");
  modal.style.display = "flex"; // bật flex trước
  setTimeout(() => modal.classList.add("show"), 10); // thêm class để chạy animation


// Nếu bấm "Huỷ"
  document.getElementById("confirmNo").onclick = () => {
  const modal = document.getElementById("confirmConvertModal");
  modal.classList.remove("show");
  setTimeout(() => { modal.style.display = "none"; }, 300);
  pendingAmount = 0;
};

// Nếu bấm "Đồng ý"
  document.getElementById("confirmYes").onclick = () => {
  if (pendingAmount > 0) {
  createCode(pendingAmount);
  }
  const modal = document.getElementById("confirmConvertModal");
  modal.classList.remove("show");
  setTimeout(() => { modal.style.display = "none"; }, 300);
  pendingAmount = 0;
};


function createCode(amount) {
  const statusEl = document.getElementById("generatedCode");

  // Trừ xu
  balance -= amount;
  updateBalance();

  // Sinh mã code
  const newCode = generateRandomCode(10);
  codeRewards[newCode] = amount;

  // Lưu vào localStorage
  localStorage.setItem("codeRewards", JSON.stringify(validCodes));

  // Hiển thị cho người dùng copy
  statusEl.textContent = `✅ Code đã được chuyển vào lịch sử!`;
  statusEl.style.color = "lime";

 // Lưu lịch sử
  const entry = {
  code: newCode,
  amount: amount,
  time: new Date().toLocaleString()
  };
  codeHistory.push(entry);
  localStorage.setItem("codeHistory", JSON.stringify(codeHistory));

  // Cập nhật giao diện lịch sử
  renderCodeHistory();
};
}

// Mở modal lịch sử
  document.getElementById("openHistoryModal").onclick = () => {
  document.getElementById("historyModal").style.display = "flex";
  renderCodeHistory();
};

// Đóng modal
  document.getElementById("closeHistoryModal").onclick = () => {
  document.getElementById("historyModal").style.display = "none";
};





// Ẩn game trước khi login
  document.querySelector(".game-container").style.display = "none";

// Chuyển form
  function showRegister() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "block";
}
function showLogin() {
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("loginForm").style.display = "block";
}



  document.addEventListener("DOMContentLoaded", function() {
  let users = JSON.parse(localStorage.getItem("users")) || {};
  // Nếu chưa có tài khoản admin thì tạo sẵn
  if (!users["Greedy"]) {
  users["GreedyKing"] = {
  username: "GreedyKing",
  password: "123456@",   // mật khẩu mặc định
  balance: 0            // số dư ban đầu
  };
  localStorage.setItem("users", JSON.stringify(users));
  }
});


// Đăng nhập
  function handleLogin() {
  const user = document.getElementById("loginUser").value.trim();
  const pass = document.getElementById("loginPass").value.trim();
  const msgEl = document.getElementById("loginMsg");

  let users = JSON.parse(localStorage.getItem("users")) || {};

  if (users[user] && users[user] === pass) {
  localStorage.setItem("loggedIn", "true");
  localStorage.setItem("currentUser", user);
  document.getElementById("loginOverlay").style.display = "none";
  document.querySelector(".game-container").style.display = "flex";
  msgEl.textContent = "";
  } else {
  msgEl.textContent = "❌ Sai tài khoản hoặc mật khẩu!";
  }


}

// Đăng ký
  function handleRegister() {
  const user = document.getElementById("regUser").value.trim();
  const pass = document.getElementById("regPass").value.trim();
  const pass2 = document.getElementById("regPass2").value.trim();
  const msgEl = document.getElementById("registerMsg");

  if (user === "" || pass === "" || pass2 === "") {
    msgEl.style.color = "red";
    msgEl.textContent = "⚠️ Vui lòng nhập đầy đủ!";
    return;
  }

  if (user.length < 8) {
    msgEl.style.color = "red";
    msgEl.textContent = "⚠️ Tài khoản phải từ 8 ký tự trở lên!";
    return;
  }

  if (pass.length < 6) {
    msgEl.style.color = "red";
    msgEl.textContent = "⚠️ Mật khẩu phải từ 6 ký tự trở lên!";
    return;
  }

  if (pass !== pass2) {
    msgEl.style.color = "red";
    msgEl.textContent = "❌ Mật khẩu xác nhận không khớp!";
    return;
  }

  let users = JSON.parse(localStorage.getItem("users")) || {};
  if (users[user]) {
    msgEl.style.color = "red";
    msgEl.textContent = "⚠️ Tài khoản đã tồn tại!";
    return;
  }

// Tạo ID random cho user
  let userId = "U" + Math.floor(100000 + Math.random() * 900000);

  users[user] = {
  id: userId,
  user: user,
  pass: pass,
  balance: 0
  };

  // Lưu tài khoản mới
  users[user] = pass;
  localStorage.setItem("users", JSON.stringify(users));

  // Thông báo thành công
  msgEl.style.color = "lime";
  msgEl.textContent = "✅ Đăng ký thành công!";

  // Sau 1.5 giây tự động quay về form login
  setTimeout(() => {
    showLogin();
    document.getElementById("loginUser").value = user; // điền sẵn username
    document.getElementById("loginPass").focus();
  }, 1500);
}

// Đăng xuất
  document.getElementById("logoutBtn").addEventListener("click", () => {
  // Xóa trạng thái đăng nhập hiện tại thôi
  localStorage.removeItem("currentUser");
  document.querySelector(".game-container").style.display = "none";
  document.getElementById("loginOverlay").style.display = "flex";
  showLogin(); // trở về form login
});

// Giữ trạng thái đăng nhập khi load lại
  window.addEventListener("load", () => {
  writeJackpot(readJackpot());
  if (localStorage.getItem("loggedIn") === "true") {
  document.getElementById("loginOverlay").style.display = "none";
  document.querySelector(".game-container").style.display = "flex";
  }
});


// Hàm hiển thị thông tin user
  function setUserInfo(name, id, avatarUrl) {
  document.getElementById("userNameDisplay").textContent = name;
  document.getElementById("userIdDisplay").textContent = id;
  document.querySelector(".user-avatar").src = avatarUrl;
  document.getElementById("userInfo").style.display = "flex";
}

// Tự động load lại khi F5
  window.addEventListener("load", () => {
  if (localStorage.getItem("userName")) {
  setUserInfo(
  localStorage.getItem("userName"),
  localStorage.getItem("userId"),
  localStorage.getItem("userAvatar")
  );
  }
});


//Đổi tên
(() => {
  const modal = document.getElementById("changeNameModal");
  const input = document.getElementById("newNameInput");
  const saveBtn = document.getElementById("saveNameBtn");
  const cancelBtn = document.getElementById("cancelNameBtn");
  const counter = document.getElementById("nameCounter");
  const err = document.getElementById("nameError");
  const avatarImg = document.querySelector(".rename-avatar");

  const nameDisplay = document.getElementById("userNameDisplay"); // nơi hiển thị tên hiện tại
  const openBtn = document.getElementById("changeNameBtn");       // nút mở modal

  // regex: cho phép chữ (kể cả có dấu), số, khoảng trắng; tối thiểu 2 ký tự sau khi trim
  const NAME_OK = (s) => {
  const t = s.trim();
  if (t.length < 2 || t.length > 20) return false;
  // không cho toàn khoảng trắng; cho unicode letter/number/space
  return /^[\p{L}\p{N} ]+$/u.test(t);
  };

  function openModal() {
    // gợi ý avatar hiện tại nếu có
    try {
    const current = (localStorage.getItem("userName") || nameDisplay?.textContent || "").trim();
    input.value = current;
    counter.textContent = `${input.value.length}/20`;
    avatarImg && (avatarImg.src = (localStorage.getItem("userAvatar") || `https://i.pravatar.cc/80?u=${encodeURIComponent(current)}`));
    } catch {}
    err.style.display = "none";
    input.classList.remove("input-error");

    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("show"));
    setTimeout(() => input.focus(), 50);
  }

  function closeModal() {
    modal.classList.remove("show");
    setTimeout(() => { modal.style.display = "none"; }, 200);
  }

  // mở từ nút "Đổi tên"
  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openModal();
    });
  }

  // cập nhật counter + preview avatar theo tên gõ vào
  input.addEventListener("input", () => {
  counter.textContent = `${input.value.length}/20`;
  if (avatarImg) avatarImg.src = `https://i.pravatar.cc/80?u=${encodeURIComponent(input.value.trim() || "preview")}`;
  if (NAME_OK(input.value)) {
  err.style.display = "none";
  input.classList.remove("input-error");
  }
  });

  // Lưu
  saveBtn.addEventListener("click", () => {
  const newName = input.value;
  if (!NAME_OK(newName)) {
  err.textContent = "⚠️ Tên phải 2–20 ký tự (chữ/số/khoảng trắng).";
  err.style.display = "block";
  input.classList.add("input-error");
  input.focus();
  return;
  }

  const finalName = newName.trim().replace(/\s+/g, " "); // gom khoảng trắng đôi

  // --- xử lý ID ---
  let userId = localStorage.getItem("userId");
  if (!userId) {
  userId = "GRD" + Math.floor(10000000 + Math.random() * 900000);
  localStorage.setItem("userId", userId);
  }

  // --- xử lý avatar ---
  const newAvatar = `https://i.pravatar.cc/80?u=${encodeURIComponent(finalName)}`;

  // --- lưu vào localStorage ---
  localStorage.setItem("userName", finalName);
  localStorage.setItem("userAvatar", newAvatar);

  // --- cập nhật UI ---
  const nameEl = document.getElementById("userNameDisplay");
  if (nameEl) nameEl.textContent = finalName;

  const idEl = document.getElementById("userIdDisplay");
  if (idEl) idEl.textContent = userId;

  const avatarEl = document.querySelector(".user-avatar");
  if (avatarEl) avatarEl.src = newAvatar;

  closeModal();

  // thông báo
  const note = document.getElementById("notification");
  if (note) {
    note.textContent = `✅ Đã đổi tên thành “${finalName}”`;
    setTimeout(() => (note.textContent = ""), 3000);
  }
});


  // Hủy/đóng
  cancelBtn.addEventListener("click", closeModal);

  // đóng khi click ra ngoài
  modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
  });

  // ESC để đóng
  document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.style.display === "flex") closeModal();
  });
})();

document.addEventListener("DOMContentLoaded", () => {
  // lấy dữ liệu từ localStorage
  let name = localStorage.getItem("userName");
  let userId = localStorage.getItem("userId");
  let avatar = localStorage.getItem("userAvatar");

  // nếu chưa có thì set mặc định
  if (!name) {
    name = "Người chơi";
    localStorage.setItem("userName", name);
  }
  if (!userId) {
    userId = "GRD" + Math.floor(10000000 + Math.random() * 900000);
    localStorage.setItem("userId", userId);
  }
  if (!avatar) {
    avatar = `https://i.pravatar.cc/80?u=${encodeURIComponent(userId)}`;
    localStorage.setItem("userAvatar", avatar);
  }

  // gán ra UI
  const nameEl = document.getElementById("userNameDisplay");
  if (nameEl) nameEl.textContent = name;

  const idEl = document.getElementById("userIdDisplay");
  if (idEl) idEl.textContent = userId;

  const avatarEl = document.querySelector(".user-avatar");
  if (avatarEl) avatarEl.src = avatar;
});


document.addEventListener("DOMContentLoaded", () => {
  const avatarEl = document.querySelector(".user-avatar");
  const fileInput = document.getElementById("avatarUpload");

  if (avatarEl && fileInput) {
  // Khi click avatar thì mở chọn file
  avatarEl.addEventListener("click", () => fileInput.click());

  // Khi chọn ảnh mới
  fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(ev) {
  const newAvatar = ev.target.result; // base64 string

  // cập nhật UI
  avatarEl.src = newAvatar;
  // lưu vào localStorage
  localStorage.setItem("userAvatar", newAvatar);
  // thông báo
  const note = document.getElementById("notification");
  if (note) {
  note.textContent = "✅ Đã cập nhật avatar!";
  setTimeout(() => (note.textContent = ""), 3000);
  }
  };
  reader.readAsDataURL(file); // chuyển ảnh thành base64
  });
  }
});

//Xác nhận chuyển xu
  document.addEventListener("DOMContentLoaded", function() {
  const transferBtn = document.getElementById("transferCoinBtn");
  const confirmModal = document.getElementById("confirmTransferModal");
  const confirmMsg = document.getElementById("confirmTransferMessage");
  const yesBtn = document.getElementById("confirmTransferYes");
  const noBtn = document.getElementById("confirmTransferNo");

  // Nhấn "Xác nhận" ở form chuyển xu
  transferBtn.addEventListener("click", function() {
  let toId = document.getElementById("transferUserId").value.trim();
  let amount = parseInt(document.getElementById("transferAmount").value);

  if (!toId || isNaN(amount) || amount <= 0) {
  document.getElementById("transferStatus").innerText = "⚠️ Vui lòng nhập ID và số xu hợp lệ!";
  return;
  }
  // Hiển thị modal xác nhận
  confirmMsg.innerText = `Bạn có chắc chắn muốn chuyển ${amount} xu cho ID: ${toId}?`;
  confirmModal.style.display = "flex";

  // Nếu đồng ý
  yesBtn.onclick = function() {
  let users = JSON.parse(localStorage.getItem("users")) || {};
  let currentUser = localStorage.getItem("currentUser");



  let senderBalance = parseInt(users[currentUser].balance) || 0;
  let amount = parseInt(document.getElementById("transferAmount").value);
  let toId = document.getElementById("transferUserId").value.trim();


  if (!users[toId]) {
  document.getElementById("transferStatus").innerText = "❌ Người nhận không tồn tại!";
  confirmModal.style.display = "none";
  return;
  }

 // Kiểm tra số dư
  if (balance < amount) {
  document.getElementById("transferStatus").innerText = "❌ Không đủ xu!";
  confirmModal.style.display = "none";
  return;
  }


  

  // Trừ + cộng xu 
 balance -= amount;
 users[toId].balance = balance + amount;
 updateBalance();
 updateBalanceDisplay()
 localStorage.setItem("users", JSON.stringify(users));

  // Lưu lịch sử
  let history = JSON.parse(localStorage.getItem("transferHistory")) || [];
  history.push({
  from: currentUser,
  to: toId,
  amount: amount,
  time: new Date().toLocaleString()
  });
  localStorage.setItem("transferHistory", JSON.stringify(history));

  document.getElementById("balance").innerText = users[currentUser].balance;
  document.getElementById("transferStatus").innerText = `✅ Đã chuyển ${amount} xu cho ID: ${toId}`;


  // Reset input sau khi chuyển xong
  document.getElementById("transferUserId").value = "";
  document.getElementById("transferAmount").value = "";

  confirmModal.style.display = "none";
  };
  // Nếu huỷ
  noBtn.onclick = function() {
  confirmModal.style.display = "none";
  };
  });
});


//Lưu vào lịch sử chuyển xu
  document.addEventListener("DOMContentLoaded", function() {
  const transferHistoryModal = document.getElementById("transferHistoryModal");
  const transferHistoryList = document.getElementById("transferHistoryList");
  const openHistoryBtn = document.getElementById("openTransferHistoryBtn");
  const closeHistoryBtn = document.getElementById("closeTransferHistoryBtn");

// Hàm render lịch sử
  function renderTransferHistory() {
  let history = JSON.parse(localStorage.getItem("transferHistory")) || [];
  if (history.length === 0) {
  transferHistoryList.innerHTML = "<p style='color:gray'>Chưa có giao dịch nào</p>";
  return;
  }
  transferHistoryList.innerHTML = history.map(h => `
  <div style="margin-bottom:8px; padding:6px; border-bottom:1px solid #444;">
  <b>👤 Từ:</b> ${h.from} <br>
  <b>➡️ Đến:</b> ${h.to} <br>
  <b>💰 Số xu:</b> ${h.amount} <br>
  <small>🕒 ${h.time}</small>
  </div>
  `).join("");
  }

// Mở modal lịch sử
  openHistoryBtn.addEventListener("click", function() {
  renderTransferHistory();
  transferHistoryModal.style.display = "flex";
  });

//Đóng modal lịch sử
  closeHistoryBtn.addEventListener("click", function() {
  transferHistoryModal.style.display = "none";
  });
});


Object.keys(users).forEach(uid => {
  users[uid].balance = Number(users[uid].balance) || 0;
});






/** ====== CẤU HÌNH PHEP NHÂN (đồng bộ với game hiện có) ====== **/
const MULTIPLIER = { "Chua":5, "Cải":5, "Ngô":5, "Rốt":5, "Mỳ":10, "Xiên":15, "Đùi":25, "Bò":45 };

/** ====== TÍNH PAYOUT TỪ CÁC CỬA ĐẶT ======
 * bets: object { "Chua": 100, "Mỳ": 0, ... }
 * selectedName: tên cửa trúng (VD: "Mỳ")
 * salad: boolean — nếu "nổ salad" (tất cả 4 cửa rau thắng)
 */
function computePayoutFromBets(bets, selectedName, salad=false) {
  let payout = 0;

  // 4 cửa "rau"
  const veg = ["Chua","Cải","Ngô","Rốt"];

  if (salad) {
    // Salad: 4 cửa rau đều thắng
    for (const k of veg) {
      const bet = Number(bets[k]||0);
      if (bet>0) payout += bet * (MULTIPLIER[k]||1);
    }
    return payout;
  }

  // Trúng thường: chỉ 1 cửa selectedName thắng
  const bet = Number(bets[selectedName]||0);
  if (bet>0) payout = bet * (MULTIPLIER[selectedName]||1);

  return payout;
}

(function () {
  const LS_KEY   = "topWinnersV1";
  const LIST_ID  = "topWinnersListModal";
  const MAX_ROWS = 3;

  const NAMES = ["Minh Tâm",".","Hana","Thảo Thảo","Anh Tũn","Bơ trộn salad","Diệu Diệu","Johnson","Tất tay bỏ bò","Tommy","Apex group","Hmh","My Anh","Giang bạch thủ","Long Ca","Ba Duy","Sơn Sói","Bia 6 lỗ","Lan Quế Phường","Mai Anh"];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const fmt  = x => Number(x||0).toLocaleString("vi-VN");
  const roundNice = n => Math.max(50, Math.round(Number(n)/100)*100); // số tròn (bội 100)

  function loadBoard(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"[]"); }catch{ return []; } }
  function saveBoard(list){ localStorage.setItem(LS_KEY, JSON.stringify(list)); }

  function makeFake(selected) {
    const name   = pick(NAMES);
    const seed   = `${name}-${Date.now()}-${Math.random()}`;
    const amount = roundNice(1000 + Math.random()*20000); // 1000 → ~21000
    return {
      name,
      avatar: `https://i.pravatar.cc/80?u=${encodeURIComponent(seed)}`,
      amount,
      betLabel: ``,
      icon: selected?.icon || "",
      ts: Date.now()
    };
  }

  function renderTopWinners(selected){
    const listEl = document.getElementById(LIST_ID);
    if(!listEl) return;

    const real = loadBoard().sort((a,b)=>(b.amount-a.amount) || (b.ts-a.ts));
    const need = Math.max(0, MAX_ROWS - real.length);
    const fakes = Array.from({length: need}, () => makeFake(selected));
    const data = [...real, ...fakes]
      .sort((a,b)=>(b.amount-a.amount) || (b.ts-a.ts))
      .slice(0, MAX_ROWS);

    listEl.innerHTML = "";
    const medalByRank = ["🥇","🥈","🥉"];

    data.forEach((row, idx) => {
      const card = document.createElement("div");
      card.className = `top-winner-card rank-${idx+1} ${idx===0 ? "pulse" : ""}`;
      card.innerHTML = `
        <div class="top-winner-rank">
          <span>#${idx+1}</span>
          <span class="medal">${medalByRank[idx]||""}</span>
        </div>
        <img class="top-winner-avatar" src="${row.avatar}" alt="">
        <div class="top-winner-name">${row.name}</div>
        <div class="top-winner-meta">${row.icon||""} ${row.betLabel||""}</div>
        <div class="top-winner-amount">${fmt(row.amount)} </div>
      `;
      listEl.appendChild(card);
    });
  }

  function pushRealWin({ name, avatar, amount, betLabel, icon, ts }) {
    if (!name || !amount) return;
    const list = loadBoard();
    list.push({ name, avatar, amount: roundNice(amount), betLabel, icon, ts: ts||Date.now() });
    list.sort((a,b)=>(b.amount-a.amount)||(b.ts-a.ts));
    saveBoard(list);
  }

  // Public API
  window.TopWinnersReal = {
    add: pushRealWin,                        // thêm người thắng thật
    render: (selected)=>renderTopWinners(selected), // render, có thể truyền 'selected' của vòng hiện tại
    clear: () => { localStorage.removeItem(LS_KEY); renderTopWinners(); },
    renderRound: (selected)=>{ renderTopWinners(selected); } // alias dễ nhớ
  };

  document.addEventListener("DOMContentLoaded", ()=>renderTopWinners());
})();





/** ============= SAFE CACHE ============= **/
(function () {
  const BK_KEY = "__safeBackupV1";
  const TMP_KEY = "__safeRestoreV1";

  // Các khóa nên giữ lại khi dọn sâu (bạn có thể thêm/bớt)
  const EXPLICIT_KEEP = [
    "userName","userId","userAvatar","jwt",
    "betHistory","topWinnersV1",
    "balance","walletBalance","coin","coins",
    "jackpotAmount","jackpot","jackpot_ts",
  ];
  const KEEP_PREFIXES = [
    "user_","profile_","bets_","history_","code_","token_","jackpot_","game_"
  ];

  const shouldKeep = (k) =>
    EXPLICIT_KEEP.includes(k) || KEEP_PREFIXES.some(p => k.startsWith(p));

  function backupLocal() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      data[k] = localStorage.getItem(k);
    }
    return { ts: Date.now(), data };
  }

  function restoreLocal(payload) {
    if (!payload || !payload.data) return;
    Object.entries(payload.data).forEach(([k, v]) => {
      localStorage.setItem(k, v);
    });
  }

  async function clearCacheStorage() {
    if (!("caches" in window)) return;
    const names = await caches.keys();
    await Promise.all(names.map(n => caches.delete(n)));
  }

  async function unregisterSW() {
    if (!("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }

  // DỌN NHANH: chỉ xóa Cache Storage + sessionStorage
  async function quickClean({ alsoUnregisterSW = false } = {}) {
    await clearCacheStorage();
    if (alsoUnregisterSW) await unregisterSW();
    // Giữ session backup, xóa phần còn lại
    const keep = new Set([BK_KEY, TMP_KEY]);
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
    keys.forEach(k => { if (!keep.has(k)) sessionStorage.removeItem(k); });
  }

  // DỌN SÂU AN TOÀN: giữ lại key quan trọng trong localStorage
  async function deepClean({ alsoUnregisterSW = false } = {}) {
    const backup = backupLocal(); // đề phòng
    sessionStorage.setItem(BK_KEY, JSON.stringify(backup));

    // Xóa localStorage trừ key quan trọng
    const lsKeys = [];
    for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
    lsKeys.forEach(k => { if (!shouldKeep(k)) localStorage.removeItem(k); });

    // Xóa sessionStorage (trừ backup)
    const keep = new Set([BK_KEY, TMP_KEY]);
    const ssKeys = [];
    for (let i = 0; i < sessionStorage.length; i++) ssKeys.push(sessionStorage.key(i));
    ssKeys.forEach(k => { if (!keep.has(k)) sessionStorage.removeItem(k); });

    await clearCacheStorage();
    if (alsoUnregisterSW) await unregisterSW();
  }

  // TẢI LẠI AN TOÀN (giữ dữ liệu): backup -> reload -> restore
  function safeRefresh() {
    const backup = backupLocal();
    sessionStorage.setItem(BK_KEY, JSON.stringify(backup));
    sessionStorage.setItem(TMP_KEY, "1");
    location.reload();
  }

  // Gọi ở DOMContentLoaded để tự phục hồi sau khi safeRefresh()
  function maybeRestoreOnLoad() {
    try {
      if (sessionStorage.getItem(TMP_KEY) === "1") {
        const raw = sessionStorage.getItem(BK_KEY);
        if (raw) restoreLocal(JSON.parse(raw));
        sessionStorage.removeItem(TMP_KEY);
        // Gợi ý: cập nhật lại UI nếu có
        window.setUserInfo?.(
          localStorage.getItem("userName"),
          localStorage.getItem("userId"),
          localStorage.getItem("userAvatar")
        );
        window.renderBetHistory?.();
        window.TopWinnersReal?.renderRound?.();
      }
    } catch (e) {}
  }

  // Xuất/Nhập backup ra file (phòng khi bạn thật sự phải xóa “Site data” của trình duyệt)
  function exportBackup() {
    const payload = backupLocal();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const name = `backup-${new Date(payload.ts).toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`;
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function importBackupFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          restoreLocal(payload);
          resolve(payload);
        } catch (e) { reject(e); }
      };
      reader.readAsText(file);
    });
  }

  window.SafeCache = {
    quickClean, deepClean, safeRefresh,
    exportBackup, importBackupFile, maybeRestoreOnLoad
  };

  document.addEventListener("DOMContentLoaded", () => {
    // Tự phục hồi nếu vừa safeRefresh()
    SafeCache.maybeRestoreOnLoad();

    // Gắn nút nếu có
    document.getElementById("btnSafeClear")?.addEventListener("click", async () => {
      await SafeCache.quickClean();                // dọn nhanh
      alert("Đã xóa cache tạm thời và giữ dữ liệu người chơi.");
    });
    document.getElementById("btnSafeDeep")?.addEventListener("click", async () => {
      await SafeCache.deepClean();                 // dọn sâu an toàn
      alert("Đã dọn cache sâu (an toàn). Dữ liệu quan trọng vẫn được giữ.");
    });
    document.getElementById("btnSafeRefresh")?.addEventListener("click", () => {
      SafeCache.safeRefresh();                     // tải lại nhưng giữ data
    });
    document.getElementById("btnBackupExport")?.addEventListener("click", () => {
      SafeCache.exportBackup();                    // xuất file backup
    });
    document.getElementById("inputBackupImport")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        await SafeCache.importBackupFile(f);
        alert("Phục hồi dữ liệu thành công!");
        window.setUserInfo?.(
          localStorage.getItem("userName"),
          localStorage.getItem("userId"),
          localStorage.getItem("userAvatar")
        );
        window.renderBetHistory?.();
        window.TopWinnersReal?.renderRound?.();
      } catch (err) {
        alert("File backup không hợp lệ.");
      } finally {
        e.target.value = "";
      }
    });
  });
})();


