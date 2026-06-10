import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApproveRecordingDto } from './dto/approve-recording.dto';
import { CreateTrainingDatasetDto } from './dto/create-dataset.dto';
import { StartFineTuneDto } from './dto/start-fine-tune.dto';
import { UpdateRecordingDto } from './dto/update-recording.dto';
import { UploadRecordingDto } from './dto/upload-recording.dto';
import { TrainingService, UploadedAudioFile } from './training.service';

@ApiTags('Training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get('recordings')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'List uploaded training recordings' })
  listRecordings() {
    return this.trainingService.listRecordings();
  }

  @Post('recordings/upload')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        callId: { type: 'string' },
        language: { type: 'string', example: 'en' },
        labelOutcome: { type: 'string', example: 'interested' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload a recorded call for training' })
  uploadRecording(
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() dto: UploadRecordingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.uploadRecording(file, dto, user.id);
  }

  @Post('recordings/:id/transcribe')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Transcribe an uploaded recording' })
  transcribeRecording(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.transcribeRecording(id, user.id);
  }

  @Patch('recordings/:id/approve')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Approve a transcript as a training example' })
  approveRecording(
    @Param('id') id: string,
    @Body() dto: ApproveRecordingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.approveRecording(id, dto, user.id);
  }

  @Patch('recordings/:id')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Update recording metadata or transcript' })
  updateRecording(
    @Param('id') id: string,
    @Body() dto: UpdateRecordingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.updateRecording(id, dto, user.id);
  }

  @Delete('recordings/:id')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Delete an uploaded recording' })
  deleteRecording(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.deleteRecording(id, user.id);
  }

  @Get('datasets')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'List training datasets' })
  listDatasets() {
    return this.trainingService.listDatasets();
  }

  @Post('datasets')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Create JSONL training dataset from approved recordings' })
  createDataset(
    @Body() dto: CreateTrainingDatasetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.createDataset(dto, user.id);
  }

  @Get('datasets/:id/jsonl')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'Preview generated JSONL for a training dataset' })
  getDatasetJsonl(@Param('id') id: string) {
    return this.trainingService.getDatasetJsonl(id);
  }

  @Post('datasets/:id/fine-tune')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Upload dataset to OpenAI and start supervised fine-tuning' })
  startFineTune(
    @Param('id') id: string,
    @Body() dto: StartFineTuneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trainingService.startFineTune(id, dto, user.id);
  }

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'List fine-tuning jobs' })
  listJobs() {
    return this.trainingService.listJobs();
  }

  @Post('jobs/:id/refresh')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Refresh fine-tuning job status from provider' })
  refreshJob(@Param('id') id: string) {
    return this.trainingService.refreshJob(id);
  }
}
