import { Injectable, Logger } from '@nestjs/common';

type CryptoAuditEvent = {
  action: string;
  actorUserId?: number;
  chatId?: number;
  messageId?: number;
  keyId?: string;
  algorithmId?: string;
  success: boolean;
  reason?: string;
};

@Injectable()
export class CryptoAuditService {
  private readonly logger = new Logger('CryptoAudit');

  log(event: CryptoAuditEvent) {
    this.logger.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        domain: 'message-crypto',
        ...event,
      }),
    );
  }
}
