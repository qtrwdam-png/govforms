import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GovForms API',
  description: 'الباك إند لـ GovForms — Next.js + Supabase + Socket.io',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
