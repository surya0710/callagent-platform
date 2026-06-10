import {
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

const DEFAULT_WSS_BASE_URL = 'wss://tatdai.in/api/voice/stream';

@ApiTags('Voice')
@Public()
@Controller('voice/smartflo')
export class VoiceController {
  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Smartflo dynamic WebSocket URL resolver' })
  resolve(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException();
    }

    const wssBaseUrl =
      process.env.VOICE_WSS_BASE_URL?.trim() || DEFAULT_WSS_BASE_URL;

    return {
      success: true,
      wss_url: `${wssBaseUrl}?token=${encodeURIComponent(token)}`,
    };
  }
}
