import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';

@Module({
  imports: [CryptoModule],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
