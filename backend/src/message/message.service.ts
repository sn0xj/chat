import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { MessageCryptoService } from '../crypto/message-crypto.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessageService {
  private guestMessageTableReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageCryptoService: MessageCryptoService,
  ) {}

  private async ensureGuestMessageTable() {
    if (this.guestMessageTableReady) return;
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS call_guest_message (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        chat_id INT UNSIGNED NOT NULL,
        guest_name VARCHAR(100) NOT NULL,
        text LONGTEXT NULL,
        created_at DATETIME NULL,
        PRIMARY KEY (id),
        INDEX idx_call_guest_message_chat_created (chat_id, created_at)
      )
    `);
    this.guestMessageTableReady = true;
  }

  private toGuestMessage(row: {
    id: number;
    chat_id: number;
    guest_name: string;
    text: string | null;
    created_at: Date | null;
  }) {
    return {
      id: -2_000_000_000 - Number(row.id),
      chat_id: Number(row.chat_id),
      sender_id: 0,
      text: row.text ?? '',
      type: 'text' as const,
      created_at: row.created_at ? row.created_at.toISOString() : null,
      edited_at: null,
      crypto_metadata: null,
      sender: {
        id: 0,
        username: `guest-${row.id}`,
        firstname: row.guest_name,
        lastname: null,
      },
    };
  }

  private assertMessageText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Message text cannot be empty');
    }
    return trimmed;
  }

  async getMessages(userId: number, chatId: number, beforeId?: number) {
    await this.ensureMember(userId, chatId);
    const encryptedMessages = await this.prisma.message.findMany({
      where: {
        chat_id: chatId,
        ...(beforeId ? { id: { lt: beforeId } } : {}),
      },
      include: {
        sender: {
          select: { id: true, username: true, firstname: true, lastname: true },
        },
      },
      orderBy: { id: 'desc' },
      take: 80,
    });
    const memberMessages = encryptedMessages.map((message) => {
      const decrypted = this.messageCryptoService.decryptText(message.text, {
        actorUserId: userId,
        chatId,
        messageId: message.id,
      });
      return {
        ...message,
        text: decrypted.text,
        crypto_metadata: decrypted.metadata,
      };
    });
    await this.ensureGuestMessageTable();
    const guestRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; chat_id: number; guest_name: string; text: string | null; created_at: Date | null }>
    >(
      `
      SELECT id, chat_id, guest_name, text, created_at
      FROM call_guest_message
      WHERE chat_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 80
      `,
      chatId,
    );
    const guestMessages = guestRows.map((row) => this.toGuestMessage(row));
    const merged = [...memberMessages, ...guestMessages]
      .filter((msg) => !beforeId || msg.id < beforeId)
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aTs !== bTs) return aTs - bTs;
        return a.id - b.id;
      });
    return merged.slice(-30);
  }

  async listGuestMessages(chatId: number, limit = 30) {
    await this.ensureGuestMessageTable();
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; chat_id: number; guest_name: string; text: string | null; created_at: Date | null }>
    >(
      `
      SELECT id, chat_id, guest_name, text, created_at
      FROM call_guest_message
      WHERE chat_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `,
      chatId,
      Math.max(1, Math.min(limit, 200)),
    );
    return rows
      .map((row) => this.toGuestMessage(row))
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aTs !== bTs) return aTs - bTs;
        return a.id - b.id;
      });
  }

  async listCallChatMessages(chatId: number, limit = 60) {
    const pageLimit = Math.max(1, Math.min(limit, 200));
    const encryptedMessages = await this.prisma.message.findMany({
      where: { chat_id: chatId },
      include: {
        sender: {
          select: { id: true, username: true, firstname: true, lastname: true },
        },
      },
      orderBy: { id: 'desc' },
      take: pageLimit * 2,
    });
    const memberMessages = encryptedMessages.map((message) => {
      const decrypted = this.messageCryptoService.decryptText(message.text, {
        actorUserId: 0,
        chatId,
        messageId: message.id,
      });
      return {
        ...message,
        text: decrypted.text,
        crypto_metadata: decrypted.metadata,
      };
    });
    const guestMessages = await this.listGuestMessages(chatId, pageLimit * 2);
    const merged = [...memberMessages, ...guestMessages].sort((a, b) => {
      const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (aTs !== bTs) return aTs - bTs;
      return a.id - b.id;
    });
    return merged.slice(-pageLimit);
  }

  async createGuestMessage(chatId: number, guestName: string, text: string) {
    const body = this.assertMessageText(text);
    await this.ensureGuestMessageTable();
    const now = new Date();
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO call_guest_message (chat_id, guest_name, text, created_at)
      VALUES (?, ?, ?, ?)
      `,
      chatId,
      guestName.trim() || 'Гость',
      body,
      now,
    );
    const [row] = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; chat_id: number; guest_name: string; text: string | null; created_at: Date | null }>
    >(
      `
      SELECT id, chat_id, guest_name, text, created_at
      FROM call_guest_message
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      chatId,
    );
    const message = this.toGuestMessage({
      id: Number(row?.id ?? 0),
      chat_id: Number(row?.chat_id ?? chatId),
      guest_name: row?.guest_name ?? (guestName.trim() || 'Гость'),
      text: row?.text ?? body,
      created_at: row?.created_at ?? now,
    });
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { updated_at: now },
    });
    return message;
  }

  async createMessage(userId: number, chatId: number, text: string) {
    await this.ensureMember(userId, chatId);
    const body = this.assertMessageText(text);
    const encrypted = this.messageCryptoService.encryptText(body, { actorUserId: userId, chatId });
    const now = new Date();
    const message = await this.prisma.message.create({
      data: {
        chat_id: chatId,
        sender_id: userId,
        text: encrypted,
        created_at: now,
      },
      include: {
        sender: {
          select: { id: true, username: true, firstname: true, lastname: true },
        },
      },
    });
    await this.prisma.$transaction([
      this.prisma.chat.update({
        where: { id: chatId },
        data: { updated_at: now, last_message_id: message.id },
      }),
      this.prisma.auth.update({
        where: { id: userId },
        data: { last_activity: now, updated_at: now },
      }),
    ]);
    return {
      ...message,
      text: body,
      crypto_metadata: this.messageCryptoService.getDefaultEncryptionMetadata(),
    };
  }

  async updateMessage(userId: number, chatId: number, messageId: number, text: string) {
    await this.ensureMember(userId, chatId);
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.chat_id !== chatId) {
      throw new ForbiddenException('Message not found');
    }
    if (message.sender_id !== userId) {
      throw new ForbiddenException('Cannot edit another user message');
    }
    const body = this.assertMessageText(text);
    const encrypted = this.messageCryptoService.encryptText(body, { actorUserId: userId, chatId });
    const editedAt = new Date();
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { text: encrypted, edited_at: editedAt },
      include: {
        sender: {
          select: { id: true, username: true, firstname: true, lastname: true },
        },
      },
    });
    await this.prisma.auth.update({
      where: { id: userId },
      data: { last_activity: editedAt, updated_at: editedAt },
    });
    return {
      ...updated,
      text: body,
      crypto_metadata: this.messageCryptoService.getDefaultEncryptionMetadata(),
    };
  }

  async deleteMessage(userId: number, chatId: number, messageId: number) {
    await this.ensureMember(userId, chatId);
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.chat_id !== chatId) {
      throw new ForbiddenException('Message not found');
    }
    if (message.sender_id !== userId) {
      throw new ForbiddenException('Cannot delete another user message');
    }

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { last_message_id: true },
    });

    await this.prisma.message.delete({ where: { id: messageId } });

    if (chat?.last_message_id === messageId) {
      const last = await this.prisma.message.findFirst({
        where: { chat_id: chatId },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      const now = new Date();
      await this.prisma.chat.update({
        where: { id: chatId },
        data: { last_message_id: last?.id ?? null, updated_at: now },
      });
    }

    return { id: messageId, chat_id: chatId };
  }

  async getChatFiles(
    userId: number,
    chatId: number,
    options: { beforeMessageId?: number; limit?: number } = {},
  ) {
    await this.ensureMember(userId, chatId);
    const pageLimit = Math.min(Math.max(options.limit ?? 24, 1), 100);
    const ATTACHMENT_PREFIX = '[SC_ATTACHMENT:';

    type AttachmentRecord = {
      messageId: number;
      createdAt: Date | null;
      sender: {
        id: number;
        username: string;
        firstname: string | null;
        lastname: string | null;
      } | null;
      name: string;
      mimeType: string;
      size: number;
      url: string;
      kind: 'image' | 'file';
    };

    const results: AttachmentRecord[] = [];
    let cursorId = options.beforeMessageId ?? Number.MAX_SAFE_INTEGER;
    let lastScannedId: number | null = null;
    let exhausted = false;
    const scanBatchSize = 80;
    // Cap total DB scans per request to avoid pathological cases.
    let scannedBatches = 0;
    const maxBatches = 12;

    while (results.length < pageLimit && !exhausted && scannedBatches < maxBatches) {
      scannedBatches += 1;
      const encryptedMessages = await this.prisma.message.findMany({
        where: {
          chat_id: chatId,
          id: { lt: cursorId },
        },
        include: {
          sender: {
            select: { id: true, username: true, firstname: true, lastname: true },
          },
        },
        orderBy: { id: 'desc' },
        take: scanBatchSize,
      });

      if (encryptedMessages.length === 0) {
        exhausted = true;
        break;
      }

      for (const message of encryptedMessages) {
        lastScannedId = message.id;
        cursorId = message.id;
        let decryptedText: string;
        try {
          const decrypted = this.messageCryptoService.decryptText(message.text, {
            actorUserId: userId,
            chatId,
            messageId: message.id,
          });
          decryptedText = decrypted.text;
        } catch (_) {
          continue;
        }
        if (!decryptedText.includes(ATTACHMENT_PREFIX)) continue;

        const lines = decryptedText.split('\n');
        const messageAttachments: AttachmentRecord[] = [];
        for (const line of lines) {
          if (!line.startsWith(ATTACHMENT_PREFIX) || !line.endsWith(']')) continue;
          const payloadRaw = line.slice(ATTACHMENT_PREFIX.length, -1);
          try {
            const parsed = JSON.parse(payloadRaw) as Record<string, unknown>;
            const name = typeof parsed.name === 'string' ? parsed.name : null;
            const mimeType =
              typeof parsed.mimeType === 'string' ? parsed.mimeType : 'application/octet-stream';
            const size = typeof parsed.size === 'number' && Number.isFinite(parsed.size) ? parsed.size : 0;
            const url = typeof parsed.url === 'string' ? parsed.url : null;
            const kindRaw = parsed.kind;
            const kind: 'image' | 'file' = kindRaw === 'image' ? 'image' : 'file';
            if (!name || !url) continue;
            messageAttachments.push({
              messageId: message.id,
              createdAt: message.created_at,
              sender: message.sender ?? null,
              name,
              mimeType,
              size,
              url,
              kind,
            });
          } catch (_) {
            continue;
          }
        }

        if (messageAttachments.length > 0) {
          results.push(...messageAttachments);
          if (results.length >= pageLimit) break;
        }
      }

      if (encryptedMessages.length < scanBatchSize) {
        exhausted = true;
      }
    }

    return {
      items: results.slice(0, pageLimit),
      nextBeforeMessageId: exhausted ? null : lastScannedId,
    };
  }

  async ensureMember(userId: number, chatId: number) {
    const member = await this.prisma.chatMember.findFirst({
      where: { chat_id: chatId, user_id: userId },
    });
    if (!member) {
      throw new ForbiddenException('No access to chat');
    }
    return member;
  }
}
