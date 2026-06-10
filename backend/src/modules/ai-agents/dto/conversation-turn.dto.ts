import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ConversationTurnDto {
  @ApiProperty({ enum: ['assistant', 'customer'] })
  @IsIn(['assistant', 'customer'])
  role!: 'assistant' | 'customer';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string;
}
