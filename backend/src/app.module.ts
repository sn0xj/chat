import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { CallSessionsModule } from './call-sessions/call-sessions.module';
import { ChatModule } from './chat/chat.module';
import { CryptoModule } from './crypto/crypto.module';
import { MeetingsModule } from './meetings/meetings.module';
import { MessageModule } from './message/message.module';
import { PrismaModule } from './prisma/prisma.module';
import { SocketModule } from './socket/socket.module';
import { VideoCallModule } from './video-call/video-call.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    AuthModule,
    ChatModule,
    MessageModule,
    SocketModule,
    VideoCallModule,
    MeetingsModule,
    CallSessionsModule,
  ],
})
export class AppModule {}
