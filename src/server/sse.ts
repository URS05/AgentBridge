import type { Response } from 'express';
import type { EventEnvelope } from '../core/types';

class SseHub {
  private clients = new Set<Response>();

  subscribe(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.clients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: heartbeat\n\n`);
      }
    }, 20000);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.clients.delete(res);
    });
  }

  broadcast(envelope: EventEnvelope): void {
    const payload = `event: workflow_event\ndata: ${JSON.stringify(envelope)}\n\n`;
    for (const client of this.clients) {
      if (!client.writableEnded) {
        client.write(payload);
      }
    }
  }
}

export const sseHub = new SseHub();
