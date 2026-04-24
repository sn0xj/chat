import { Module } from '@nestjs/common';
import { CryptoAuditService } from './crypto-audit.service';
import { CryptoReadinessService } from './crypto-readiness.service';
import { MessageCryptoService } from './message-crypto.service';

@Module({
  providers: [CryptoAuditService, MessageCryptoService, CryptoReadinessService],
  exports: [CryptoAuditService, MessageCryptoService, CryptoReadinessService],
})
export class CryptoModule {}
