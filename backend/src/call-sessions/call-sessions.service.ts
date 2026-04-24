import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ActiveSession = {
  id: number;
  chatId: number;
  startedAt: Date;
  participantUsernames: Set<string>;
};

@Injectable()
export class CallSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallSessionsService.name);
  private readonly activeSessions = new Map<number, ActiveSession>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * On boot: any session that was left with endedAt = null is stale (the
   * server or clients crashed). Close them so history doesn't show "LIVE"
   * forever. We set endedAt to startedAt to make the duration zero and
   * distinguishable from normal calls.
   */
  async onModuleInit() {
    try {
      const stale = await this.prisma.callSession.findMany({
        where: { endedAt: null },
        select: { id: true, startedAt: true },
      });
      if (stale.length === 0) return;
      await this.prisma.$transaction(
        stale.map((s) =>
          this.prisma.callSession.update({
            where: { id: s.id },
            data: { endedAt: s.startedAt },
          }),
        ),
      );
      this.logger.log(`Closed ${stale.length} stale call session(s) on startup`);
    } catch (err) {
      this.logger.warn(
        `Failed to close stale call sessions on startup: ${(err as Error).message}`,
      );
    }
  }

  /**
   * On graceful shutdown: close every in-memory session so they don't appear
   * as live after the server is restarted.
   */
  async onModuleDestroy() {
    if (this.activeSessions.size === 0) return;
    const now = new Date();
    const sessions = [...this.activeSessions.values()];
    this.activeSessions.clear();
    await Promise.all(
      sessions.map((session) =>
        this.prisma.callSession
          .update({
            where: { id: session.id },
            data: {
              endedAt: now,
              participantUsernames: Array.from(session.participantUsernames),
            },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `Failed to finalize session ${session.id} on shutdown: ${(err as Error).message}`,
            );
          }),
      ),
    );
  }

  async startSessionIfAbsent(chatId: number, username?: string) {
    const existing = this.activeSessions.get(chatId);
    if (existing) {
      if (username) {
        existing.participantUsernames.add(username);
      }
      return existing;
    }
    const now = new Date();
    try {
      const record = await this.prisma.callSession.create({
        data: {
          chatId,
          startedAt: now,
          participantUsernames: username ? [username] : [],
        },
      });
      const session: ActiveSession = {
        id: record.id,
        chatId,
        startedAt: now,
        participantUsernames: new Set(username ? [username] : []),
      };
      this.activeSessions.set(chatId, session);
      return session;
    } catch (err) {
      this.logger.warn(`Failed to start call session for chat ${chatId}: ${(err as Error).message}`);
      return null;
    }
  }

  addParticipant(chatId: number, username?: string) {
    if (!username) return;
    const session = this.activeSessions.get(chatId);
    if (!session) return;
    session.participantUsernames.add(username);
  }

  /**
   * Called when a peer leaves. Closes the session if the room is empty.
   *
   * Idempotent: even if the in-memory entry is missing (e.g. after a server
   * restart), we still close any orphaned DB sessions for this chat so the
   * UI doesn't show stale "LIVE" badges.
   */
  async endSessionIfEmpty(chatId: number, currentPeerCount: number) {
    if (currentPeerCount > 0) return;
    const now = new Date();
    const session = this.activeSessions.get(chatId);
    if (session) {
      this.activeSessions.delete(chatId);
      try {
        await this.prisma.callSession.update({
          where: { id: session.id },
          data: {
            endedAt: now,
            participantUsernames: Array.from(session.participantUsernames),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to end call session ${session.id}: ${(err as Error).message}`,
        );
      }
      return;
    }
    // Fallback: no in-memory entry (server restart etc.). Close any dangling
    // DB sessions for this chat so the history stops showing "LIVE".
    try {
      const result = await this.prisma.callSession.updateMany({
        where: { chatId, endedAt: null },
        data: { endedAt: now },
      });
      if (result.count > 0) {
        this.logger.log(
          `Closed ${result.count} orphaned call session(s) for chat ${chatId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to close orphaned sessions for chat ${chatId}: ${(err as Error).message}`,
      );
    }
  }

  async listForUser(userId: number, params: { chatId?: number; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const memberships = await this.prisma.chatMember.findMany({
      where: { user_id: userId },
      select: { chat_id: true },
    });
    const accessibleChatIds = memberships.map((m) => m.chat_id);
    if (params.chatId) {
      if (!accessibleChatIds.includes(params.chatId)) {
        throw new ForbiddenException('No access to chat');
      }
    }
    const where = params.chatId
      ? { chatId: params.chatId }
      : accessibleChatIds.length
        ? { chatId: { in: accessibleChatIds } }
        : { chatId: -1 };
    const sessions = await this.prisma.callSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return sessions.map((s) => ({
      id: s.id,
      chatId: s.chatId,
      meetingId: s.meetingId,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      participantUsernames: Array.isArray(s.participantUsernames)
        ? (s.participantUsernames as string[])
        : [],
    }));
  }
}
