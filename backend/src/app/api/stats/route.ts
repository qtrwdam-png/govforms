import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';

// إحصائيات سريعة للوحة الادارة (عدد اليوم/الأسبوع/الإجمالي + المعلّقة + المدفوعات)
export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  const supabase = getAdminClient();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // إجمالي السجلات
  const { count: total } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true });

  // سجلات اليوم
  const { count: today } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfDay);

  // سجلات الأسبوع
  const { count: week } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfWeek);

  // المعلّقة
  const { count: pending } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  // المدفوعات المعلّقة
  const { count: pendingPayments } = await supabase
    .from('payment_cards')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  // OTP المعلّقة
  const { count: pendingOtp } = await supabase
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  // العملاء المحظورون
  const { count: blocked } = await supabase
    .from('blocked_clients')
    .select('id', { count: 'exact', head: true });

  return NextResponse.json({
    total: total ?? 0,
    today: today ?? 0,
    week: week ?? 0,
    pending: pending ?? 0,
    pendingPayments: pendingPayments ?? 0,
    pendingOtp: pendingOtp ?? 0,
    blocked: blocked ?? 0,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
