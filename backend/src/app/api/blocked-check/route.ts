import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

// فحص الحظر: يُفحص في الـ middleware بعميل service-role لتجاوز RLS
// المدير معفى دائماً من الحظر (يتحقق في مسار /admin و /api/*)
export async function POST(req: NextRequest) {
  try {
    const { fingerprint, ip_address } = await req.json();
    if (!fingerprint && !ip_address) {
      return NextResponse.json({ blocked: false });
    }
    const supabase = getAdminClient();
    let query = supabase.from('blocked_clients').select('id,reason', { count: 'exact', head: true });
    if (fingerprint && ip_address) {
      query = query.or(`fingerprint.eq.${fingerprint},ip_address.eq.${ip_address}`);
    } else if (fingerprint) {
      query = query.eq('fingerprint', fingerprint);
    } else {
      query = query.eq('ip_address', ip_address);
    }
    const { count } = await query;
    return NextResponse.json({ blocked: (count ?? 0) > 0 });
  } catch {
    return NextResponse.json({ blocked: false });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
