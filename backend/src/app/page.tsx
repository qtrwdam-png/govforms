export default function Home() {
  return (
    <main style={{ padding: 40, fontFamily: 'Cairo, sans-serif', direction: 'rtl' }}>
      <h1>GovForms API</h1>
      <p>الباك إند يعمل بنجاح. الواجهات (موقع العملاء + لوحة الادارة) موجودة في مجلدات منفصلة.</p>
      <ul style={{ marginTop: 20, lineHeight: 2 }}>
        <li><code>/api/submit</code> — استقبال النماذج من العملاء</li>
        <li><code>/api/files</code> — رفع الملفات</li>
        <li><code>/api/blocked-check</code> — فحص الحظر</li>
        <li><code>/api/auth/login</code> — تسجيل دخول المدير</li>
        <li><code>/api/auth/verify</code> — التحقق من توكن المدير</li>
        <li><code>/api/inbox</code> — صندوق الوارد</li>
        <li><code>/api/client</code> — تفاصيل العميل + الخط الزمني</li>
        <li><code>/api/decision</code> — قرارات المدير</li>
        <li><code>/api/block</code> — حظر/إلغاء حظر</li>
        <li><code>/api/archive</code> — أرشفة</li>
        <li><code>/api/stats</code> — الإحصائيات</li>
        <li><code>/api/socket</code> — تهيئة Socket.io</li>
      </ul>
    </main>
  );
}
