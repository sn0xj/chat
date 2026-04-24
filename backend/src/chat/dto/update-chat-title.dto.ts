import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateChatTitleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
