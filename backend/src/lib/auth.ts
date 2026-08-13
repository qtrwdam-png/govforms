import bcrypt from 'bcryptjs';
import { getAdminClient } from './supabase';

const JWT_SECRET = process.env.JWT_SECRET || 'govforms-default-secret';
const TOKEN_TTL = 60 * 60 * 24; // 24 ساعة (بالثواني)

export interface AdminToken {
  managerId: string;
  email: string;
  role: string;
  exp: number;
}

// توليد JWT بسيط (بدون مكتبة خارجية إضافية)
function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function signToken(payload: { managerId: string; email: string; role: string }): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL });
  const data = `${header}.${body}`;
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string): AdminToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    if (sig !== parts[2]) return null;
    const payload: AdminToken = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// التحقق من بيانات المدير وإصدار توكن
export async function authenticateAdmin(email: string, password: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('admin_users')
    .select('id,email,password_hash,full_name,role')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !data) return null;

  const ok = bcrypt.compareSync(password, data.password_hash);
  if (!ok) return null;

  return {
    managerId: data.id,
    email: data.email,
    full_name: data.full_name,
    role: data.role,
    token: signToken({ managerId: data.id, email: data.email, role: data.role }),
  };
}

// استخراج المدير من ترويسة Authorization في طلبات API
export function getAdminFromRequest(req: Request): AdminToken | null {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return verifyToken(token);
}
