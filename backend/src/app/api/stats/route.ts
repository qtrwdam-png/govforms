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

  // تشغيل كل الاستعلامات بالتوازي (بدل التسلسل) → أسرع بـ ~7x
  const [totalR, todayR, weekR, pendingR, pendingPaymentsR, pendingOtpR, blockedR] =
    await Promise.all([
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', startOfDay),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', startOfWeek),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('payment_cards').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('otp_codes').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('blocked_clients').select('id', { count: 'exact', head: true }),
    ]);

  return NextResponse.json({
    total: totalR.count ?? 0,
    today: todayR.count ?? 0,
    week: weekR.count ?? 0,
    pending: pendingR.count ?? 0,
    pendingPayments: pendingPaymentsR.count ?? 0,
    pendingOtp: pendingOtpR.count ?? 0,
    blocked: blockedR.count ?? 0,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
