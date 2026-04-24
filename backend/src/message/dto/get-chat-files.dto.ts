import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetChatFilesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeMessageId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
