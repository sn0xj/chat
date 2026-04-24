import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AddChatMembersDto } from './dto/add-chat-members.dto';
import { ChatService } from './chat.service';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { UpdateChatTitleDto } from './dto/update-chat-title.dto';

@UseGuards(AuthGuard)
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  getChats(@Req() req: { user: { id: number } }) {
    return this.chatService.getChats(req.user.id);
  }

  @Post('private/:userId')
  createPrivate(
    @Req() req: { user: { id: number } },
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.chatService.createOrGetPrivateChat(req.user.id, userId);
  }

  @Post('group')
  createGroup(@Req() req: { user: { id: number } }, @Body() dto: CreateGroupChatDto) {
    return this.chatService.createGroup(req.user.id, dto);
  }

  @Patch(':chatId/title')
  updateTitle(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: UpdateChatTitleDto,
  ) {
    return this.chatService.updateGroupTitle(req.user.id, chatId, dto);
  }

  @Post(':chatId/members')
  addMembers(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: AddChatMembersDto,
  ) {
    return this.chatService.addMembers(req.user.id, chatId, dto);
  }

  @Delete(':chatId/members/:userId')
  removeMember(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.chatService.removeMember(req.user.id, chatId, userId);
  }

  @Post(':chatId/leave')
  leaveChat(@Req() req: { user: { id: number } }, @Param('chatId', ParseIntPipe) chatId: number) {
    return this.chatService.leaveChat(req.user.id, chatId);
  }

  @Delete(':chatId')
  deleteChat(@Req() req: { user: { id: number } }, @Param('chatId', ParseIntPipe) chatId: number) {
    return this.chatService.deleteChat(req.user.id, chatId);
  }
}
