import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendTextMessageDto {
  @ApiProperty({ example: '966512345678@c.us' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ example: 'Your OTP is: 482910', maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'true_966512345678@c.us_3EB0123456789' })
  messageId: string;

  @ApiProperty({ example: 1706868000 })
  timestamp: number;
}
