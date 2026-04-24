import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ChatMemberRole, ChatType } from '@prisma/client';
import { MessageCryptoService } from '../crypto/message-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddChatMembersDto } from './dto/add-chat-members.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { UpdateChatTitleDto } from './dto/update-chat-title.dto';

@Injectable()
export class ChatService {
  private meetingTypeEnsured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageCryptoService: MessageCryptoService,
  ) {}

  private async ensureMeetingChatTypeReady() {
    if (this.meetingTypeEnsured) return;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ TABLE_NAME: string | null; COLUMN_TYPE: string | null }>
    >(
      `
      SELECT TABLE_NAME, COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(TABLE_NAME) = 'chat'
        AND COLUMN_NAME = 'type'
      LIMIT 1
      `,
    );
    const tableName = rows[0]?.TABLE_NAME || null;
    if (!tableName) {
      throw new InternalServerErrorException('Chat table not found in current schema');
    }
    const columnType = rows[0]?.COLUMN_TYPE || '';
    const matches = [...columnType.matchAll(/'([^']+)'/g)];
    const enumValues = matches.map((m) => m[1]).filter(Boolean);
    if (enumValues.includes('meeting')) {
      this.meetingTypeEnsured = true;
      return;
    }
    const nextValues = [...new Set([...enumValues, 'meeting'])].filter(Boolean);
    if (!nextValues.length) {
      throw new InternalServerErrorException('Cannot ensure chat.type enum values');
    }
    const enumSql = nextValues.map((value) => `'${value.replace(/'/g, "''")}'`).join(',');
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`type\` ENUM(${enumSql}) NOT NULL`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown db error';
      throw new InternalServerErrorException(
        `Failed to upgrade chat.type enum with meeting value: ${reason}`,
      );
    }
    this.meetingTypeEnsured = true;
  }

  async getChats(userId: number) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { user_id: userId },
      include: {
        chat: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    firstname: true,
                    lastname: true,
                    last_activity: true,
                  },
                },
              },
            },
            messages: {
              orderBy: { id: 'desc' },
              take: 1,
              include: {
                sender: {
                  select: { id: true, username: true, firstname: true, lastname: true },
                },
              },
            },
          },
        },
      },
      orderBy: { chat: { updated_at: 'desc' } },
    });
    const meetingChatIds = memberships
      .map((membership) => membership.chat)
      .filter((chat) => chat.type === ChatType.meeting)
      .map((chat) => chat.id);
    const latestGuestByChat = new Map<
      number,
      { id: number; chat_id: number; guest_name: string; text: string | null; created_at: Date | null }
    >();
    if (meetingChatIds.length) {
      try {
        const placeholders = meetingChatIds.map(() => '?').join(', ');
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{ id: number; chat_id: number; guest_name: string; text: string | null; created_at: Date | null }>
        >(
          `
          SELECT gm.id, gm.chat_id, gm.guest_name, gm.text, gm.created_at
          FROM call_guest_message gm
          INNER JOIN (
            SELECT chat_id, MAX(id) AS max_id
            FROM call_guest_message
            WHERE chat_id IN (${placeholders})
            GROUP BY chat_id
          ) latest ON latest.max_id = gm.id
          `,
          ...meetingChatIds,
        );
        for (const row of rows) {
          latestGuestByChat.set(Number(row.chat_id), row);
        }
      } catch {
        // The table may not exist yet in fresh environments; ignore and return
        // regular chat previews until guest messages are created.
      }
    }
    return memberships.map((m) => {
      const lastMessage = m.chat.messages[0] || null;
      const latestGuest = latestGuestByChat.get(m.chat.id) || null;
      const dbMessageTs = lastMessage?.created_at ? new Date(lastMessage.created_at).getTime() : 0;
      const guestMessageTs = latestGuest?.created_at ? new Date(latestGuest.created_at).getTime() : 0;
      const preferGuest = Boolean(latestGuest) && (!lastMessage || guestMessageTs >= dbMessageTs);
      if (!lastMessage) {
        return {
          id: m.chat.id,
          type: m.chat.type,
          title: m.chat.title,
          updated_at: m.chat.updated_at,
          lastMessage: latestGuest
            ? {
                id: -2_000_000_000 - Number(latestGuest.id),
                chat_id: m.chat.id,
                sender_id: 0,
                text: latestGuest.text || '',
                type: 'text' as const,
                created_at: latestGuest.created_at,
                edited_at: null,
                crypto_metadata: null,
                sender: {
                  id: 0,
                  username: `guest-${latestGuest.id}`,
                  firstname: latestGuest.guest_name,
                  lastname: null,
                },
              }
            : null,
          members: m.chat.members.map((member) => ({
            id: member.user.id,
            username: member.user.username,
            firstname: member.user.firstname,
            lastname: member.user.lastname,
            last_activity: member.user.last_activity,
            role: member.role,
          })),
        };
      }
      const decrypted = this.messageCryptoService.decryptText(lastMessage.text, {
        actorUserId: userId,
        chatId: m.chat.id,
        messageId: lastMessage.id,
      });
      const resolvedLastMessage = preferGuest
        ? {
            id: -2_000_000_000 - Number(latestGuest?.id ?? 0),
            chat_id: m.chat.id,
            sender_id: 0,
            text: latestGuest?.text || '',
            type: 'text' as const,
            created_at: latestGuest?.created_at ?? null,
            edited_at: null,
            crypto_metadata: null,
            sender: {
              id: 0,
              username: `guest-${latestGuest?.id ?? 0}`,
              firstname: latestGuest?.guest_name || 'Гость',
              lastname: null,
            },
          }
        : {
            ...lastMessage,
            text: decrypted.text,
            crypto_metadata: decrypted.metadata,
          };
      return {
      id: m.chat.id,
      type: m.chat.type,
      title: m.chat.title,
      updated_at: m.chat.updated_at,
      lastMessage: resolvedLastMessage,
      members: m.chat.members.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        firstname: member.user.firstname,
        lastname: member.user.lastname,
        last_activity: member.user.last_activity,
        role: member.role,
      })),
      };
    });
  }

  async createOrGetPrivateChat(currentUserId: number, otherUserId: number) {
    if (currentUserId === otherUserId) {
      throw new ForbiddenException('Cannot create private chat with self');
    }
    const otherUser = await this.prisma.auth.findUnique({ where: { id: otherUserId } });
    if (!otherUser) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.chat.findFirst({
      where: {
        type: ChatType.private,
        members: {
          every: { user_id: { in: [currentUserId, otherUserId] } },
          some: { user_id: currentUserId },
        },
      },
      include: { members: true },
    });
    if (existing && existing.members.length === 2) {
      return existing;
    }

    const now = new Date();
    return this.prisma.chat.create({
      data: {
        type: ChatType.private,
        created_by: currentUserId,
        created_at: now,
        updated_at: now,
        members: {
          create: [
            {
              user_id: currentUserId,
              role: ChatMemberRole.owner,
              joined_at: now,
            },
            {
              user_id: otherUserId,
              role: ChatMemberRole.member,
              joined_at: now,
            },
          ],
        },
      },
      include: { members: true },
    });
  }

  async createGroup(currentUserId: number, dto: CreateGroupChatDto) {
    const uniqueMemberIds = Array.from(new Set(dto.memberIds.filter((id) => id !== currentUserId)));
    const now = new Date();
    return this.prisma.chat.create({
      data: {
        type: ChatType.group,
        title: dto.title,
        created_by: currentUserId,
        created_at: now,
        updated_at: now,
        members: {
          create: [
            { user_id: currentUserId, role: ChatMemberRole.owner, joined_at: now },
            ...uniqueMemberIds.map((id) => ({
              user_id: id,
              role: ChatMemberRole.member,
              joined_at: now,
            })),
          ],
        },
      },
      include: { members: true },
    });
  }

  async createMeetingChat(
    currentUserId: number,
    dto: { title: string; memberIds: number[] },
  ) {
    await this.ensureMeetingChatTypeReady();
    const uniqueMemberIds = Array.from(new Set(dto.memberIds.filter((id) => id !== currentUserId)));
    const now = new Date();
    return this.prisma.chat.create({
      data: {
        type: ChatType.meeting,
        title: dto.title,
        created_by: currentUserId,
        created_at: now,
        updated_at: now,
        members: {
          create: [
            { user_id: currentUserId, role: ChatMemberRole.owner, joined_at: now },
            ...uniqueMemberIds.map((id) => ({
              user_id: id,
              role: ChatMemberRole.member,
              joined_at: now,
            })),
          ],
        },
      },
      include: { members: true },
    });
  }

  async updateGroupTitle(userId: number, chatId: number, dto: UpdateChatTitleDto) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    this.ensureGroupLike(chat.type);
    this.ensureAdminOrOwner(membership.role);
    return this.prisma.chat.update({
      where: { id: chatId },
      data: { title: dto.title, updated_at: new Date() },
    });
  }

  async addMembers(userId: number, chatId: number, dto: AddChatMembersDto) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    const uniqueIds = Array.from(new Set(dto.memberIds.filter((id) => id !== userId)));
    if (!uniqueIds.length) {
      return chat;
    }
    if (chat.type === ChatType.private || chat.type === ChatType.group) {
      if (chat.type === ChatType.group) {
        this.ensureAdminOrOwner(membership.role);
      }
      const created = await this.ensureMeetingChatCreated(chatId, userId, uniqueIds);
      if (!created.chat) {
        throw new NotFoundException('Chat not found');
      }
      return {
        sourceChatId: chatId,
        meetingChatId: created.chat.id,
        createdMeeting: created.createdMeeting,
        addedMemberIds: created.addedMemberIds,
        chat: created.chat,
      };
    }
    this.ensureGroupLike(chat.type);
    this.ensureAdminOrOwner(membership.role);
    const now = new Date();
    await this.prisma.$transaction(
      uniqueIds.map((memberId) =>
        this.prisma.chatMember.upsert({
          where: { chat_id_user_id: { chat_id: chatId, user_id: memberId } },
          update: {},
          create: { chat_id: chatId, user_id: memberId, role: ChatMemberRole.member, joined_at: now },
        }),
      ),
    );
    return this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true },
    });
  }

  // Creates a dedicated `meeting` conversation from an existing private/group
  // chat when new participants are invited into a live conversation context.
  // The source chat remains untouched; all participants move to the new chat.
  async ensureMeetingChatCreated(
    chatId: number,
    initiatorUserId: number,
    newMemberIds: number[],
  ) {
    await this.ensureMeetingChatTypeReady();
    const forceCreate = initiatorUserId <= 0 && newMemberIds.length === 0;
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: { select: { user_id: true } } },
    });
    if (!chat) {
      return { chat: null, addedMemberIds: [] as number[], createdMeeting: false };
    }

    if (chat.type === ChatType.meeting) {
      const addedInMeeting = await this.addMembersToMeetingChat(chat.id, newMemberIds);
      const refreshed = await this.prisma.chat.findUnique({ where: { id: chat.id } });
      return { chat: refreshed, addedMemberIds: addedInMeeting, createdMeeting: false };
    }

    const sourceMemberIds = chat.members.map((member) => member.user_id);
    const sourceSet = new Set(sourceMemberIds);
    const normalizedNewIds = Array.from(new Set(newMemberIds.filter((id) => Number.isFinite(id) && id > 0)));
    const addedMemberIds = normalizedNewIds.filter((id) => !sourceSet.has(id));
    if (!addedMemberIds.length && !forceCreate) {
      return { chat: null, addedMemberIds, createdMeeting: false };
    }

    const resolvedInitiatorId =
      sourceSet.has(initiatorUserId) && initiatorUserId > 0
        ? initiatorUserId
        : sourceMemberIds[0];
    if (!resolvedInitiatorId) {
      return { chat: null, addedMemberIds, createdMeeting: false };
    }
    const meetingMemberIds = Array.from(
      new Set([...sourceMemberIds, ...addedMemberIds, resolvedInitiatorId]),
    );
    const now = new Date();
    const created = await this.prisma.chat.create({
      data: {
        type: ChatType.meeting,
        title: chat.title,
        created_by: resolvedInitiatorId,
        created_at: now,
        updated_at: now,
        members: {
          create: meetingMemberIds.map((memberId) => ({
            user_id: memberId,
            role: memberId === resolvedInitiatorId ? ChatMemberRole.owner : ChatMemberRole.member,
            joined_at: now,
          })),
        },
      },
    });

    const refreshed = await this.prisma.chat.findUnique({ where: { id: created.id } });
    return { chat: refreshed, addedMemberIds, createdMeeting: true };
  }

  // Returns a single chat in the same shape a client gets from `getChats`
  // (members with user profile fields). Used for broadcasting `chat_updated`.
  async getChatSnapshot(chatId: number, viewerUserId: number) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstname: true,
                lastname: true,
                last_activity: true,
              },
            },
          },
        },
        messages: {
          orderBy: { id: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, username: true, firstname: true, lastname: true },
            },
          },
        },
      },
    });
    if (!chat) return null;
    const lastMessage = chat.messages[0] || null;
    const decryptedLast = lastMessage
      ? this.messageCryptoService.decryptText(lastMessage.text, {
          actorUserId: viewerUserId,
          chatId: chat.id,
          messageId: lastMessage.id,
        })
      : null;
    return {
      id: chat.id,
      type: chat.type,
      title: chat.title,
      updated_at: chat.updated_at,
      lastMessage: lastMessage
        ? {
            ...lastMessage,
            text: decryptedLast?.text ?? '',
            crypto_metadata: decryptedLast?.metadata ?? null,
          }
        : null,
      members: chat.members.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        firstname: member.user.firstname,
        lastname: member.user.lastname,
        last_activity: member.user.last_activity,
        role: member.role,
      })),
    };
  }

  async removeMember(userId: number, chatId: number, targetUserId: number) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    this.ensureGroupLike(chat.type);
    this.ensureAdminOrOwner(membership.role);
    if (targetUserId === chat.created_by) {
      throw new ForbiddenException('Cannot remove chat owner');
    }
    await this.prisma.chatMember.deleteMany({
      where: { chat_id: chatId, user_id: targetUserId },
    });
    return { success: true };
  }

  async leaveChat(userId: number, chatId: number) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    if (chat.type === ChatType.private) {
      throw new ForbiddenException('Cannot leave private chat');
    }
    if (membership.role === ChatMemberRole.owner) {
      throw new ForbiddenException('Owner cannot leave group');
    }
    await this.prisma.chatMember.delete({
      where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
    });
    return { success: true };
  }

  async deleteChat(userId: number, chatId: number) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    if (
      (chat.type === ChatType.group || chat.type === ChatType.meeting) &&
      membership.role !== ChatMemberRole.owner
    ) {
      throw new ForbiddenException('Only owner can delete group or meeting');
    }
    // Private chats can be deleted by either participant; group chats — only by the owner.
    await this.prisma.chat.delete({ where: { id: chatId } });
    return { success: true };
  }

  async clearHistoryForAll(userId: number, chatId: number) {
    const { chat, membership } = await this.getMemberWithChat(userId, chatId);
    if (chat.type === ChatType.group || chat.type === ChatType.meeting) {
      this.ensureAdminOrOwner(membership.role);
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { chat_id: chatId } }),
      this.prisma.callSession.deleteMany({ where: { chatId } }),
      this.prisma.chat.update({
        where: { id: chatId },
        data: { last_message_id: null, updated_at: now },
      }),
    ]);
    try {
      await this.prisma.$executeRawUnsafe(
        `
        CREATE TABLE IF NOT EXISTS call_guest_message (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          chat_id INT UNSIGNED NOT NULL,
          guest_name VARCHAR(100) NOT NULL,
          text LONGTEXT NULL,
          created_at DATETIME NULL,
          PRIMARY KEY (id),
          INDEX idx_call_guest_message_chat_created (chat_id, created_at)
        )
        `,
      );
      await this.prisma.$executeRawUnsafe(
        `
        DELETE FROM call_guest_message
        WHERE chat_id = ?
        `,
        chatId,
      );
    } catch {
      // Guest chat table may be unavailable in some environments; skip.
    }

    return { chatId, updatedAt: now.toISOString() };
  }

  async getModerationContext(userId: number, chatId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chat_id: chatId, user_id: userId },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException('No access to chat');
    }
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, created_by: true },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    return { chat, membership };
  }

  private async getMemberWithChat(userId: number, chatId: number) {
    const membership = await this.prisma.chatMember.findUnique({
      where: { chat_id_user_id: { chat_id: chatId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('No access to chat');
    }
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    return { chat, membership };
  }

  private async addMembersToMeetingChat(chatId: number, newMemberIds: number[]) {
    const uniqueIds = Array.from(new Set(newMemberIds.filter((id) => Number.isFinite(id) && id > 0)));
    const existingMembers = uniqueIds.length
      ? await this.prisma.chatMember.findMany({
          where: { chat_id: chatId, user_id: { in: uniqueIds } },
          select: { user_id: true },
        })
      : [];
    const existingSet = new Set(existingMembers.map((m) => m.user_id));
    const addedMemberIds = uniqueIds.filter((id) => !existingSet.has(id));
    if (!addedMemberIds.length) {
      return [] as number[];
    }
    const now = new Date();
    await this.prisma.$transaction(
      addedMemberIds.map((memberId) =>
        this.prisma.chatMember.upsert({
          where: { chat_id_user_id: { chat_id: chatId, user_id: memberId } },
          update: {},
          create: { chat_id: chatId, user_id: memberId, role: ChatMemberRole.member, joined_at: now },
        }),
      ),
    );
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { updated_at: now },
    });
    return addedMemberIds;
  }

  private ensureGroupLike(type: ChatType) {
    if (type !== ChatType.group && type !== ChatType.meeting) {
      throw new ForbiddenException('Only group or meeting chat supports this action');
    }
  }

  private ensureAdminOrOwner(role: ChatMemberRole) {
    if (role !== ChatMemberRole.owner && role !== ChatMemberRole.admin) {
      throw new ForbiddenException('Admin or owner role required');
    }
  }
}
