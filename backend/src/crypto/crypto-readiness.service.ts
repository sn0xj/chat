import { Injectable, Logger } from '@nestjs/common';
import { MessageCryptoService } from './message-crypto.service';

@Injectable()
export class CryptoReadinessService {
  private readonly logger = new Logger(CryptoReadinessService.name);

  constructor(private readonly messageCryptoService: MessageCryptoService) {}

  assertRuntimeReadiness() {
    const keyIds = this.messageCryptoService.listActiveKeyIds();
    const primary = this.messageCryptoService.getPrimaryKeyId();
    const rotationDays = Number(process.env.SC_MESSAGE_KEY_ROTATION_DAYS || 90);
    const auditSink = process.env.SECURITY_AUDIT_SINK || 'application-logs';

    this.logger.log(
      `Message crypto readiness: primaryKey=${primary}, activeKeyCount=${keyIds.length}, rotationDays=${rotationDays}, auditSink=${auditSink}`,
    );
    if (!Number.isFinite(rotationDays) || rotationDays <= 0) {
      throw new Error('SC_MESSAGE_KEY_ROTATION_DAYS must be a positive number');
    }
  }
}
