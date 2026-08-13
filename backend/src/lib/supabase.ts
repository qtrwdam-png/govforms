import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isClientOnline } from './socket';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// عميل بصلاحيات الخادم (service_role) — يتجاوز RLS
// يُستخدم في لوحة الادارة والـ middleware وفحص الحظر فقط (لا يُكشف للعميل أبداً)
let _admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

// عميل بصلاحيات anon — للعميل (موقع العملاء) عبر الـ API
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let _anon: SupabaseClient | null = null;

export function getAnonClient(): SupabaseClient {
  if (_anon) return _anon;
  _anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anon;
}

// التأكد من وجود سلة attachments في Storage (يُنشأ تلقائياً عند أول استدعاء)
let _bucketReady = false;
export async function ensureAttachmentsBucket(): Promise<void> {
  if (_bucketReady) return;
  const admin = getAdminClient();
  const { error } = await admin.storage.createBucket('attachments', {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20 MB
  });
  // تجاهل الخطأ إن كانت السلة موجودة مسبقاً
  if (error && !error.message.includes('already')) {
    console.warn('Storage bucket warning:', error.message);
  }
  _bucketReady = true;
}

// فحص حالة الاتصال مع fallback على last_seen_at (إذا لم يُعرف presence اللحظي)
export function isClientOnlineSafe(fingerprint: string, lastSeenAt?: string): boolean {
  if (fingerprint && isClientOnline(fingerprint)) return true;
  if (!lastSeenAt) return false;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  return diff < 60000; // آخر ظهور خلال دقيقة
}
