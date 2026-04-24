import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

type BusPayload = {
  topic: string;
  roomId: string;
  originInstanceId: string;
  messageId: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class RealtimeBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBusService.name);
  private readonly instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly handlers = new Set<(msg: BusPayload) => void>();
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private readonly channel = 'vks:realtime:events';

  getInstanceId() {
    return this.instanceId;
  }

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    try {
      this.pub = new Redis(redisUrl, { lazyConnect: true });
      this.sub = new Redis(redisUrl, { lazyConnect: true });
      await this.pub.connect();
      await this.sub.connect();
      await this.sub.subscribe(this.channel);
      this.sub.on('message', (_channel, raw) => {
        try {
          const parsed = JSON.parse(raw) as BusPayload;
          for (const h of this.handlers) h(parsed);
        } catch (err) {
          this.logger.warn(`Failed to parse redis realtime message: ${(err as Error).message}`);
        }
      });
      this.logger.log('Realtime Redis bus enabled');
    } catch (err) {
      this.logger.error(`Failed to init Redis bus: ${(err as Error).message}`);
      await this.onModuleDestroy();
    }
  }

  onMessage(handler: (msg: BusPayload) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async publish(topic: string, roomId: string, payload: Record<string, unknown>) {
    if (!this.pub) return;
    const msg: BusPayload = {
      topic,
      roomId,
      originInstanceId: this.instanceId,
      messageId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      payload,
    };
    await this.pub.publish(this.channel, JSON.stringify(msg));
  }

  async onModuleDestroy() {
    try {
      await this.sub?.quit();
    } catch {
      /* ignore */
    }
    try {
      await this.pub?.quit();
    } catch {
      /* ignore */
    }
    this.sub = null;
    this.pub = null;
  }
}
