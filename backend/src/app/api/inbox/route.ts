import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient, isClientOnlineSafe } from '@/lib/supabase';

// قائمة الوارد: آخر السجلات مع بيانات العميل، حالة الاتصال، وجود بيانات بطاقة
export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') || 'all'; // all | card | archive
  const search = url.searchParams.get('search') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

  const supabase = getAdminClient();

  // نجلب آخر submissions مرتبة بالأحدث، مع بيانات العميل
  let query = supabase
    .from('submissions')
    .select(
      `
      id,reference,service_type,status,created_at,
      clients!inner(id,fingerprint,full_name,email,phone,country_code,country_name,ip_address,device_info,last_seen_at,status)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter === 'archive') {
    query = query.eq('status', 'rejected');
  }

  const { data: subs, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // فلترة card: فقط السجلات التي لها بيانات دفع
  let result = subs || [];
  if (filter === 'card') {
    const ids = result.map((s) => s.id);
    const { data: cards } = await supabase
      .from('payment_cards')
      .select('submission_id')
      .in('submission_id', ids);
    const withCard = new Set((cards || []).map((c) => c.submission_id));
    result = result.filter((s) => withCard.has(s.id));
  }

  // بحث نصي
  if (search) {
    const q = search.toLowerCase();
    result = result.filter((s: any) => {
      const c = s.clients;
      return (
        c?.full_name?.toLowerCase().includes(q) ||
        c?.email?.toLowerCase().includes(q) ||
        c?.phone?.includes(q) ||
        c?.id_number?.includes(q) ||
        s.reference?.toLowerCase().includes(q) ||
        c?.fingerprint?.toLowerCase().includes(q)
      );
    });
  }

  // إثراء كل سجل: حالة الاتصال + آخر نشاط
  const enriched = result.map((s: any) => {
    const c = s.clients;
    return {
      id: s.id,
      reference: s.reference,
      service_type: s.service_type,
      status: s.status,
      created_at: s.created_at,
      client: {
        id: c.id,
        fingerprint: c.fingerprint,
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        country_code: c.country_code,
        country_name: c.country_name,
        ip_address: c.ip_address,
        device_info: c.device_info,
        online: isClientOnlineSafe(c.fingerprint, c.last_seen_at),
        last_seen_at: c.last_seen_at,
        status: c.status,
      },
    };
  });

  return NextResponse.json({ inbox: enriched });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
