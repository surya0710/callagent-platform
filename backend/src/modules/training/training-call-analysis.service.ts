import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TrainingCallAnalysisResult } from './interfaces/training-call-analysis.interface';
import {
  buildTrainingCallAnalysisUserPrompt,
  TRAINING_CALL_ANALYSIS_SYSTEM_PROMPT,
} from './prompts/training-call-analysis.prompt';
import {
  buildTrainingInsightsAggregateUserPrompt,
  TRAINING_INSIGHTS_AGGREGATE_SYSTEM_PROMPT,
} from './prompts/training-insights-aggregate.prompt';
import {
  parseTrainingAggregateInsightsResult,
  parseTrainingCallAnalysisResult,
} from './schemas/training-call-analysis.schema';
import { TrainingCallAnalysisConfigService } from './utils/training-call-analysis-config.service';

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

@Injectable()
export class TrainingCallAnalysisService {
  private readonly logger = new Logger(TrainingCallAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly analysisConfig: TrainingCallAnalysisConfigService,
  ) {}

  assertEnabled() {
    if (!this.analysisConfig.isEnabled()) {
      throw new ServiceUnavailableException('Training call analysis is disabled');
    }
  }

  listAnalyses() {
    return this.prisma.trainingRecordingAnalysis.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        recording: {
          select: {
            id: true,
            originalFileName: true,
            language: true,
            labelOutcome: true,
            status: true,
          },
        },
      },
    });
  }

  async getAnalysisForRecording(recordingId: string) {
    const analysis = await this.prisma.trainingRecordingAnalysis.findUnique({
      where: { trainingRecordingId: recordingId },
      include: {
        recording: {
          select: {
            id: true,
            originalFileName: true,
            language: true,
            labelOutcome: true,
            status: true,
          },
        },
      },
    });

    if (!analysis) {
      throw new NotFoundException('Analysis not found for this recording');
    }

    return analysis;
  }

  getLatestInsightReport() {
    return this.prisma.trainingInsightReport.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTranscribedRecordingIds(recordingIds?: string[]) {
    const where: Prisma.TrainingRecordingWhereInput = {
      transcript: { not: null },
      status: { in: ['transcribed', 'approved'] },
    };

    if (recordingIds?.length) {
      where.id = { in: recordingIds };
    }

    const recordings = await this.prisma.trainingRecording.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return recordings.map((r) => r.id);
  }

  async enqueueRecordingAnalysis(recordingId: string, reanalyze = false) {
    this.assertEnabled();

    const recording = await this.prisma.trainingRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException('Training recording not found');
    }

    if (!recording.transcript?.trim()) {
      throw new BadRequestException('Recording has no final transcript to analyze');
    }

    const existing = await this.prisma.trainingRecordingAnalysis.findUnique({
      where: { trainingRecordingId: recordingId },
    });

    if (existing?.status === 'completed' && !reanalyze) {
      return existing;
    }

    if (existing?.status === 'processing' && !reanalyze) {
      return existing;
    }

    return this.prisma.trainingRecordingAnalysis.upsert({
      where: { trainingRecordingId: recordingId },
      create: {
        trainingRecordingId: recordingId,
        status: 'pending',
      },
      update: {
        status: 'pending',
        error: null,
      },
    });
  }

  async analyzeRecording(recordingId: string, reanalyze = false) {
    this.assertEnabled();

    const recording = await this.prisma.trainingRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException('Training recording not found');
    }

    const transcript = recording.transcript?.trim();
    if (!transcript) {
      throw new BadRequestException('Recording has no final transcript to analyze');
    }

    const existing = await this.prisma.trainingRecordingAnalysis.findUnique({
      where: { trainingRecordingId: recordingId },
    });

    if (existing?.status === 'completed' && !reanalyze) {
      return existing;
    }

    if (existing?.status === 'processing' && !reanalyze) {
      return existing;
    }

    await this.prisma.trainingRecordingAnalysis.upsert({
      where: { trainingRecordingId: recordingId },
      create: {
        trainingRecordingId: recordingId,
        status: 'processing',
      },
      update: {
        status: 'processing',
        error: null,
      },
    });

    try {
      const result = await this.runPerCallAnalysis(transcript, {
        fileName: recording.originalFileName,
        language: recording.language ?? undefined,
        labelOutcome: recording.labelOutcome ?? undefined,
      });

      const callbackDateTime = result.callbackDateTime
        ? new Date(result.callbackDateTime)
        : null;

      const saved = await this.prisma.trainingRecordingAnalysis.update({
        where: { trainingRecordingId: recordingId },
        data: {
          summary: result.summary,
          outcome: result.outcome,
          leadQuality: result.leadQuality,
          customerIntent: result.customerIntent,
          nextAction: result.nextAction,
          customerRequirementsJson: result.customerRequirements,
          objectionsJson: result.objections,
          customerQuestionsJson: result.customerQuestions,
          importantDetailsJson: result.importantDetails,
          callbackRequested: result.callbackRequested,
          callbackDateTime:
            callbackDateTime && !Number.isNaN(callbackDateTime.getTime())
              ? callbackDateTime
              : null,
          executiveScore: Math.round(result.executivePerformance.score),
          executiveStrengthsJson: result.executivePerformance.strengths,
          executiveImprovementsJson: result.executivePerformance.improvements,
          missedOpportunitiesJson: result.executivePerformance.missedOpportunities,
          winningPhrasesJson: result.winningPhrases,
          badPhrasesJson: result.badPhrases,
          confidence: result.confidence,
          status: 'completed',
          error: null,
        },
      });

      this.logger.log(`Analysis completed for recording ${recordingId}`);
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown analysis error';
      this.logger.error(`Analysis failed for recording ${recordingId}: ${message}`);

      await this.prisma.trainingRecordingAnalysis.update({
        where: { trainingRecordingId: recordingId },
        data: {
          status: 'failed',
          error: message,
        },
      });

      throw error;
    }
  }

  async analyzeAllRecordings(recordingIds?: string[]) {
    this.assertEnabled();

    const ids = await this.findTranscribedRecordingIds(recordingIds);
    const batchSize = this.analysisConfig.getBatchSize();
    const results: Array<{ recordingId: string; status: string; error?: string }> = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map((id) => this.analyzeRecording(id, false)),
      );

      batchResults.forEach((result, index) => {
        const recordingId = batch[index];
        if (result.status === 'fulfilled') {
          results.push({ recordingId, status: 'completed' });
        } else {
          const error =
            result.reason instanceof Error
              ? result.reason.message
              : 'Analysis failed';
          results.push({ recordingId, status: 'failed', error });
        }
      });
    }

    return {
      total: ids.length,
      completed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  async generateAggregateInsights() {
    this.assertEnabled();

    const report = await this.prisma.trainingInsightReport.create({
      data: {
        title: `Training Insights — ${new Date().toISOString().slice(0, 10)}`,
        status: 'processing',
      },
    });

    try {
      const analyses = await this.prisma.trainingRecordingAnalysis.findMany({
        where: { status: 'completed' },
        orderBy: { updatedAt: 'desc' },
      });

      if (analyses.length === 0) {
        throw new BadRequestException(
          'No completed call analyses available. Run per-call analysis first.',
        );
      }

      const aggregate = await this.runAggregateAnalysis(analyses);

      const updated = await this.prisma.trainingInsightReport.update({
        where: { id: report.id },
        data: {
          status: 'completed',
          totalCalls: analyses.length,
          commonObjectionsJson: aggregate.commonObjections,
          commonQuestionsJson: aggregate.commonQuestions,
          commonRequirementsJson: aggregate.commonRequirements,
          winningPhrasesJson: aggregate.winningPhrases,
          badPhrasesJson: aggregate.badPhrases,
          bestOpeningsJson: aggregate.bestOpenings,
          followUpPatternsJson: aggregate.followUpPatterns,
          qualificationSignalsJson: {
            hotLeadSignals: aggregate.hotLeadSignals,
            coldLeadSignals: aggregate.coldLeadSignals,
          },
          recommendedPlaybook: aggregate.recommendedPlaybook,
          aiAgentInstructions: aggregate.aiAgentInstructions,
        },
      });

      this.logger.log(`Aggregate insights report ${report.id} completed`);
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown aggregate error';
      await this.prisma.trainingInsightReport.update({
        where: { id: report.id },
        data: { status: 'failed' },
      });
      throw error;
    }
  }

  private async runPerCallAnalysis(
    transcript: string,
    metadata?: { fileName?: string; language?: string; labelOutcome?: string },
  ): Promise<TrainingCallAnalysisResult> {
    const prompt = buildTrainingCallAnalysisUserPrompt(transcript, metadata);
    const raw = await this.callLlm(
      prompt,
      TRAINING_CALL_ANALYSIS_SYSTEM_PROMPT,
      this.analysisConfig.getAnalysisModel(),
    );
    return parseTrainingCallAnalysisResult(raw);
  }

  private async runAggregateAnalysis(
    analyses: Array<{
      summary: string | null;
      outcome: string | null;
      leadQuality: string | null;
      customerIntent: string | null;
      customerRequirementsJson: unknown;
      objectionsJson: unknown;
      customerQuestionsJson: unknown;
      importantDetailsJson: unknown;
      nextAction: string | null;
      executiveScore: number | null;
      winningPhrasesJson: unknown;
      badPhrasesJson: unknown;
      confidence: number | null;
    }>,
  ) {
    const prompt = buildTrainingInsightsAggregateUserPrompt(
      analyses.map((a) => ({
        summary: a.summary,
        outcome: a.outcome,
        leadQuality: a.leadQuality,
        customerIntent: a.customerIntent,
        customerRequirements: a.customerRequirementsJson,
        objections: a.objectionsJson,
        customerQuestions: a.customerQuestionsJson,
        importantDetails: a.importantDetailsJson,
        nextAction: a.nextAction,
        executiveScore: a.executiveScore,
        winningPhrases: a.winningPhrasesJson,
        badPhrases: a.badPhrasesJson,
        confidence: a.confidence,
      })),
    );

    const raw = await this.callLlm(
      prompt,
      TRAINING_INSIGHTS_AGGREGATE_SYSTEM_PROMPT,
      this.analysisConfig.getInsightsModel(),
    );

    return parseTrainingAggregateInsightsResult(raw);
  }

  private async callLlm(prompt: string, systemPrompt: string, model: string): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI API error ${response.status}: ${errorBody}`);
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!text) {
      throw new Error('Empty response from OpenAI');
    }

    return text;
  }
}
