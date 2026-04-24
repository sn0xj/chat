import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class AddChatMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  memberIds!: number[];
}
