import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';

// أرشفة / إلغاء أرشفة سجل (نستخدم status='rejected' كأرشيف، أو حقل منفصل)
// في هذا التنفيذ: الأرشفة = تمييز السجل كمرفوض (rejected)؛ إلغاء الأرشفة = pending
export async function POST(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  try {
    const { action, submission_ids } = await req.json();
    if (!submission_ids?.length) {
      return NextResponse.json({ error: 'حدد سجلاً واحداً على الأقل' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const newStatus = action === 'archive' ? 'rejected' : 'pending';

    const { error } = await supabase
      .from('submissions')
      .update({ status: newStatus, decided_at: new Date().toISOString() })
      .in('id', submission_ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: submission_ids.length });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
