import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'http';
import { initSocketIO, getIO } from '@/lib/socket';

// Pages API route (وليس App Router) — Socket.io يحتاج res.socket.server
// لتهيئة خادم HTTP مرة واحدة وإرفاق io به.
type NextRespWithIO = NextApiResponse & { socket: { server: HTTPServer & { io?: unknown } } };

export default function handler(_req: NextApiRequest, res: NextRespWithIO) {
  const server = res.socket.server;
  if (!server.io) {
    initSocketIO(server);
    // eslint-disable-next-line no-console
    console.log('[socket.io] تمت التهيئة على خادم HTTP');
  }
  const io = getIO();
  res.status(200).json({ ok: true, socket: !!io });
}
