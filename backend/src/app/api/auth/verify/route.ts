import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';

// التحقق من صلاحية توكن المدير وإرجاع بياناته
export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }
  const supabase = getAdminClient();
  const { data } = await supabase
    .from('admin_users')
    .select('id,email,full_name,role')
    .eq('id', admin.managerId)
    .single();
  return NextResponse.json({ admin: data });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
