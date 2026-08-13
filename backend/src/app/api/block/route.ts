import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';

// حظر / إلغاء حظر عميل
// action: 'block' | 'unblock'
export async function POST(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  try {
    const { action, client_id, fingerprint, ip_address, reason } = await req.json();

    const supabase = getAdminClient();

    if (action === 'block') {
      // إضافة إلى جدول الحظر
      await supabase.from('blocked_clients').insert({
        fingerprint,
        ip_address,
        reason,
        manager_id: admin.managerId,
      });
      // تحديث حالة العميل
      if (client_id) {
        await supabase.from('clients').update({ status: 'blocked' }).eq('id', client_id);
      }
      // تسجيل تدقيق
      await supabase.from('audit_log').insert({
        manager_id: admin.managerId,
        action: 'block',
        target_type: 'client',
        target_id: client_id,
        details: { fingerprint, ip_address, reason },
      });
      return NextResponse.json({ ok: true, blocked: true });
    }

    if (action === 'unblock') {
      // إزالة من جدول الحظر
      if (fingerprint) {
        await supabase.from('blocked_clients').delete().eq('fingerprint', fingerprint);
      }
      if (ip_address) {
        await supabase.from('blocked_clients').delete().eq('ip_address', ip_address);
      }
      // تحديث حالة العميل
      if (client_id) {
        await supabase.from('clients').update({ status: 'active' }).eq('id', client_id);
      }
      await supabase.from('audit_log').insert({
        manager_id: admin.managerId,
        action: 'unblock',
        target_type: 'client',
        target_id: client_id,
        details: { fingerprint, ip_address },
      });
      return NextResponse.json({ ok: true, blocked: false });
    }

    return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
