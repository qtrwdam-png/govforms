import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, ensureAttachmentsBucket } from '@/lib/supabase';

const ALLOWED = ['jpg', 'jpeg', 'gif', 'png', 'bmp', 'pdf'];
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

// رفع ملف واحد إلى Supabase Storage (bucket: attachments)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'لم يُرفع ملف' }, { status: 400 });
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return NextResponse.json(
        { error: `نوع الملف غير مسموح. الأنواع: ${ALLOWED.join(', ')}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'الحجم الأقصى 20 MB' }, { status: 400 });
    }

    await ensureAttachmentsBucket();
    const admin = getAdminClient();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;
    const arrayBuf = await file.arrayBuffer();
    const { error } = await admin.storage
      .from('attachments')
      .upload(path, arrayBuf, { contentType: file.type, upsert: false });

    if (error) {
      return NextResponse.json({ error: 'فشل رفع الملف: ' + error.message }, { status: 500 });
    }

    return NextResponse.json({ path, name: file.name, type: file.type, size: file.size });
  } catch {
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
