import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AiService } from './ai.service';
import {
  AiSentimentDto,
  AiSummarizeDto,
  AiTestResponseDto,
} from './dto/ai-request.dto';

@ApiTags('AI')
@ApiBearerAuth()
@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('ai/test-response')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Test AI text generation' })
  testResponse(@Body() dto: AiTestResponseDto) {
    return this.aiService.testResponse(dto);
  }

  @Post('ai/summarize')
  @RequirePermissions(PERMISSIONS.CALLS_WRITE)
  @ApiOperation({ summary: 'Generate call summary using configured AI provider' })
  summarize(@Body() dto: AiSummarizeDto) {
    return this.aiService.summarize(dto);
  }

  @Post('ai/sentiment')
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Analyze sentiment using configured AI provider' })
  analyzeSentiment(@Body() dto: AiSentimentDto) {
    return this.aiService.analyzeSentiment(dto);
  }
}
