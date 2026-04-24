import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatModule } from '../chat/chat.module';
import { MessageModule } from '../message/message.module';
import { VideoCallModule } from '../video-call/video-call.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [MessageModule, ChatModule, VideoCallModule, JwtModule.register({})],
  providers: [ChatGateway],
})
export class SocketModule {}
