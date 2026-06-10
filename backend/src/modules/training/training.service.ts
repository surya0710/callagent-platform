import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TrainingDatasetStatus,
  TrainingJobStatus,
  TrainingRecordingStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ApproveRecordingDto } from './dto/approve-recording.dto';
import { CreateTrainingDatasetDto } from './dto/create-dataset.dto';
import { StartFineTuneDto } from './dto/start-fine-tune.dto';
import { UploadRecordingDto } from './dto/upload-recording.dto';
import { TrainingProviderFactory } from './training-provider.factory';

export interface UploadedAudioFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are an AI voice agent improvement model. Learn the desired outbound call style, compliance posture, objection handling, and next-step discipline from reviewed examples.';

@Injectable()
export class TrainingService {
  private readonly recordingsDir = path.join('storage', 'training-recordings');
  private readonly datasetsDir = path.join('storage', 'training-datasets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly trainingProviderFactory: TrainingProviderFactory,
    private readonly configService: ConfigService,
  ) {}

  listRecordings() {
    return this.prisma.trainingRecording.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async uploadRecording(
    file: UploadedAudioFile | undefined,
    dto: UploadRecordingDto,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }

    this.assertAudioFile(file);

    const extension = this.getSafeExtension(file.originalname);
    const fileName = `${randomUUID()}${extension}`;
    const relativePath = path.join(this.recordingsDir, fileName).replace(/\\/g, '/');
    const absolutePath = path.resolve(process.cwd(), relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    const recording = await this.prisma.trainingRecording.create({
      data: {
        callId: dto.callId,
        originalFileName: file.originalname,
        fileName,
        mimeType: file.mimetype,
        storagePath: relativePath,
        sizeBytes: file.size,
        language: dto.language,
        labelOutcome: dto.labelOutcome,
        uploadedById: userId,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'training_recording',
      entityId: recording.id,
      metadata: { originalFileName: file.originalname, sizeBytes: file.size },
    });

    return recording;
  }

  async transcribeRecording(id: string, userId: string) {
    const recording = await this.findRecording(id);

    if (
      recording.transcript &&
      (recording.status === TrainingRecordingStatus.transcribed ||
        recording.status === TrainingRecordingStatus.approved)
    ) {
      return recording;
    }

    const absolutePath = this.toAbsolutePath(recording.storagePath);
    try {
      await access(absolutePath);
    } catch {
      throw new BadRequestException(
        'Audio file not found on server. Please re-upload the recording.',
      );
    }

    await this.prisma.trainingRecording.update({
      where: { id },
      data: {
        status: TrainingRecordingStatus.transcribing,
        errorMessage: null,
      },
    });

    try {
      const provider = this.trainingProviderFactory.getProvider();
      const output = await provider.transcribeAudio({
        filePath: this.toAbsolutePath(recording.storagePath),
        fileName: recording.originalFileName,
        mimeType: recording.mimeType,
        language: recording.language ?? undefined,
      });

      const redactedTranscript = this.redactSensitiveData(output.text);
      const updated = await this.prisma.trainingRecording.update({
        where: { id },
        data: {
          transcript: output.text,
          redactedTranscript,
          status: TrainingRecordingStatus.transcribed,
        },
      });

      await this.auditLogsService.log({
        userId,
        action: 'update',
        entityType: 'training_recording',
        entityId: id,
        metadata: { event: 'transcribed', provider: output.provider, model: output.model },
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed';
      await this.prisma.trainingRecording.update({
        where: { id },
        data: {
          status: TrainingRecordingStatus.failed,
          errorMessage: message,
        },
      });
      throw new BadGatewayException(message);
    }
  }

  async approveRecording(id: string, dto: ApproveRecordingDto, userId: string) {
    const recording = await this.findRecording(id);
    const transcript = dto.redactedTranscript ?? recording.redactedTranscript ?? recording.transcript;

    if (!transcript) {
      throw new BadRequestException('Recording must be transcribed before approval');
    }

    const updated = await this.prisma.trainingRecording.update({
      where: { id },
      data: {
        status: TrainingRecordingStatus.approved,
        trainingApproved: true,
        labelOutcome: dto.labelOutcome,
        expectedResponse: dto.expectedResponse,
        redactedTranscript: this.redactSensitiveData(transcript),
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'activate',
      entityType: 'training_recording',
      entityId: id,
      metadata: { event: 'approved_for_training', labelOutcome: dto.labelOutcome },
    });

    return updated;
  }

  listDatasets() {
    return this.prisma.trainingDataset.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async createDataset(dto: CreateTrainingDatasetDto, userId: string) {
    const recordings = await this.prisma.trainingRecording.findMany({
      where: {
        trainingApproved: true,
        status: TrainingRecordingStatus.approved,
        ...(dto.recordingIds?.length ? { id: { in: dto.recordingIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!recordings.length) {
      throw new BadRequestException('No approved training recordings found');
    }

    const systemPrompt = dto.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const dataset = await this.prisma.trainingDataset.create({
      data: {
        name: dto.name,
        description: dto.description,
        status: TrainingDatasetStatus.draft,
        createdById: userId,
      },
    });

    const examples = recordings.map((recording) => {
      const transcript = recording.redactedTranscript ?? recording.transcript ?? '';
      return {
        datasetId: dataset.id,
        recordingId: recording.id,
        systemPrompt,
        userPrompt: this.buildUserPrompt(transcript, recording.labelOutcome),
        assistantResponse: recording.expectedResponse ?? '',
        metadata: {
          source: 'uploaded_call_recording',
          recordingId: recording.id,
          labelOutcome: recording.labelOutcome,
        },
      };
    });

    await this.prisma.trainingExample.createMany({ data: examples });

    const jsonl = examples
      .map((example) =>
        JSON.stringify({
          messages: [
            { role: 'system', content: example.systemPrompt },
            { role: 'user', content: example.userPrompt },
            { role: 'assistant', content: example.assistantResponse },
          ],
        }),
      )
      .join('\n');

    const fileName = `${dataset.id}.jsonl`;
    const relativePath = path.join(this.datasetsDir, fileName).replace(/\\/g, '/');
    const absolutePath = path.resolve(process.cwd(), relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${jsonl}\n`, 'utf8');

    const updated = await this.prisma.trainingDataset.update({
      where: { id: dataset.id },
      data: {
        status: TrainingDatasetStatus.ready,
        jsonlPath: relativePath,
        exampleCount: examples.length,
      },
      include: { examples: true },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'training_dataset',
      entityId: dataset.id,
      metadata: { exampleCount: examples.length },
    });

    return updated;
  }

  async getDatasetJsonl(id: string) {
    const dataset = await this.findDataset(id);

    if (!dataset.jsonlPath) {
      throw new BadRequestException('Dataset JSONL has not been generated yet');
    }

    return {
      datasetId: id,
      content: await readFile(this.toAbsolutePath(dataset.jsonlPath), 'utf8'),
    };
  }

  async startFineTune(id: string, dto: StartFineTuneDto, userId: string) {
    const dataset = await this.prisma.trainingDataset.findUnique({
      where: { id },
      include: { examples: true },
    });

    if (!dataset) {
      throw new NotFoundException('Training dataset not found');
    }

    if (!dataset.jsonlPath) {
      throw new BadRequestException('Dataset JSONL has not been generated yet');
    }

    const provider = this.trainingProviderFactory.getProvider();
    if (provider.name === 'openai' && dataset.examples.length < 10) {
      throw new BadRequestException(
        'OpenAI supervised fine-tuning requires at least 10 approved examples.',
      );
    }

    const baseModel =
      dto.baseModel ??
      this.configService.get<string>('OPENAI_FINE_TUNE_MODEL') ??
      'gpt-4.1-mini-2025-04-14';

    const job = await this.prisma.trainingJob.create({
      data: {
        datasetId: id,
        provider: provider.name,
        baseModel,
        openAiFileId: dataset.openAiFileId,
        status: TrainingJobStatus.uploading,
        createdById: userId,
      },
    });

    try {
      const fileId =
        dataset.openAiFileId ??
        (
          await provider.uploadTrainingFile({
            filePath: this.toAbsolutePath(dataset.jsonlPath),
            fileName: `${dataset.id}.jsonl`,
          })
        ).fileId;

      await this.prisma.trainingDataset.update({
        where: { id },
        data: {
          status: TrainingDatasetStatus.uploaded,
          openAiFileId: fileId,
          baseModel,
        },
      });

      const providerJob = await provider.startFineTune({
        trainingFileId: fileId,
        model: baseModel,
        suffix: dto.suffix,
      });

      const updatedJob = await this.prisma.trainingJob.update({
        where: { id: job.id },
        data: {
          openAiFileId: fileId,
          openAiJobId: providerJob.providerJobId,
          status: this.toTrainingJobStatus(providerJob.status),
          fineTunedModel: providerJob.fineTunedModel,
          errorMessage: providerJob.errorMessage,
        },
      });

      await this.auditLogsService.log({
        userId,
        action: 'create',
        entityType: 'training_job',
        entityId: updatedJob.id,
        metadata: {
          provider: provider.name,
          providerJobId: providerJob.providerJobId,
          datasetId: id,
        },
      });

      return updatedJob;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fine-tune job failed';
      await this.prisma.trainingJob.update({
        where: { id: job.id },
        data: {
          status: TrainingJobStatus.failed,
          errorMessage: message,
        },
      });
      throw error;
    }
  }

  listJobs() {
    return this.prisma.trainingJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        dataset: { select: { id: true, name: true, exampleCount: true } },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async refreshJob(id: string) {
    const job = await this.prisma.trainingJob.findUnique({ where: { id } });

    if (!job) {
      throw new NotFoundException('Training job not found');
    }

    if (!job.openAiJobId) {
      throw new BadRequestException('Training job has no provider job ID yet');
    }

    const provider = this.trainingProviderFactory.getProvider();
    const providerJob = await provider.getFineTuneJob(job.openAiJobId);

    return this.prisma.trainingJob.update({
      where: { id },
      data: {
        status: this.toTrainingJobStatus(providerJob.status),
        fineTunedModel: providerJob.fineTunedModel,
        errorMessage: providerJob.errorMessage,
        finishedAt:
          providerJob.status === 'succeeded' ||
          providerJob.status === 'failed' ||
          providerJob.status === 'cancelled'
            ? new Date()
            : job.finishedAt,
      },
    });
  }

  private async findRecording(id: string) {
    const recording = await this.prisma.trainingRecording.findUnique({ where: { id } });

    if (!recording) {
      throw new NotFoundException('Training recording not found');
    }

    return recording;
  }

  private async findDataset(id: string) {
    const dataset = await this.prisma.trainingDataset.findUnique({ where: { id } });

    if (!dataset) {
      throw new NotFoundException('Training dataset not found');
    }

    return dataset;
  }

  private assertAudioFile(file: UploadedAudioFile) {
    const allowedExtensions = new Set([
      '.flac',
      '.mp3',
      '.mp4',
      '.mpeg',
      '.mpga',
      '.m4a',
      '.ogg',
      '.wav',
      '.webm',
    ]);
    const extension = this.getSafeExtension(file.originalname);

    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException(
        'Unsupported audio format. Use flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.',
      );
    }
  }

  private getSafeExtension(fileName: string) {
    return path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  }

  private toAbsolutePath(relativePath: string) {
    return path.resolve(process.cwd(), relativePath);
  }

  private redactSensitiveData(text: string) {
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-number]');
  }

  private buildUserPrompt(transcript: string, labelOutcome?: string | null) {
    const outcomeLine = labelOutcome ? `\nKnown call outcome: ${labelOutcome}` : '';
    return `Review this outbound voice call transcript and produce the ideal assistant behavior for future similar calls.${outcomeLine}\n\nTranscript:\n${transcript}`;
  }

  private toTrainingJobStatus(status: string): TrainingJobStatus {
    switch (status) {
      case 'succeeded':
        return TrainingJobStatus.succeeded;
      case 'failed':
        return TrainingJobStatus.failed;
      case 'cancelled':
        return TrainingJobStatus.cancelled;
      case 'running':
        return TrainingJobStatus.running;
      case 'queued':
      case 'validating_files':
      default:
        return TrainingJobStatus.queued;
    }
  }
}
