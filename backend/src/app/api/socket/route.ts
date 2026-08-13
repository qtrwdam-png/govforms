import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'http';
import { initSocketIO, getIO } from '@/lib/socket';

// نوع موسّع يسمح بإرفاق io بخادم HTTP
type NextRespWithIO = NextApiResponse & { socket: { server: HTTPServer & { io?: unknown } } };

// تهيئة خادم Socket.io مرة واحدة وإرفاقه بخادم HTTP الخاص بـ Next.js
export default function handler(req: NextApiRequest, res: NextRespWithIO) {
  const server = res.socket.server;
  if (!server.io) {
    initSocketIO(server);
  }
  const io = getIO();
  res.status(200).json({ ok: true, socket: !!io });
}
