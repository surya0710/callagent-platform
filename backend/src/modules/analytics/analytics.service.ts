import { Injectable, NotFoundException } from '@nestjs/common';
import { CallStatus, SentimentLabel } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalCustomers,
      totalCampaigns,
      totalCalls,
      completedCalls,
      failedCalls,
      durationAgg,
      sentimentCounts,
      promptsToday,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.campaign.count(),
      this.prisma.call.count(),
      this.prisma.call.count({ where: { status: CallStatus.completed } }),
      this.prisma.call.count({
        where: { status: { in: [CallStatus.failed, CallStatus.no_answer, CallStatus.busy] } },
      }),
      this.prisma.call.aggregate({
        _avg: { durationSec: true },
        where: { durationSec: { not: null } },
      }),
      this.prisma.callSummary.groupBy({
        by: ['sentiment'],
        _count: { sentiment: true },
      }),
      this.prisma.agentPrompt.count({
        where: { createdAt: { gte: startOfToday } },
      }),
    ]);

    const sentimentMap = Object.fromEntries(
      sentimentCounts.map((s) => [s.sentiment, s._count.sentiment]),
    ) as Record<string, number>;

    return {
      totalCustomers,
      totalCampaigns,
      totalCalls,
      completedCalls,
      failedCalls,
      averageCallDuration: Math.round(durationAgg._avg.durationSec ?? 0),
      positiveSentiment: sentimentMap[SentimentLabel.positive] ?? 0,
      neutralSentiment: sentimentMap[SentimentLabel.neutral] ?? 0,
      negativeSentiment: sentimentMap[SentimentLabel.negative] ?? 0,
      promptsToday,
    };
  }

  async getCampaignAnalytics(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const [totalCalls, completedCalls, failedCalls, statusBreakdown] =
      await Promise.all([
        this.prisma.call.count({ where: { campaignId } }),
        this.prisma.call.count({
          where: { campaignId, status: CallStatus.completed },
        }),
        this.prisma.call.count({
          where: {
            campaignId,
            status: { in: [CallStatus.failed, CallStatus.no_answer, CallStatus.busy] },
          },
        }),
        this.prisma.call.groupBy({
          by: ['status'],
          where: { campaignId },
          _count: { status: true },
        }),
      ]);

    return {
      campaignId,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      totalCalls,
      completedCalls,
      failedCalls,
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s.status,
        count: s._count.status,
      })),
    };
  }

  async getCallAnalytics() {
    const [byStatus, byDay] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM calls
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
    ]);

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count.status,
      })),
      last30Days: byDay.map((d) => ({
        date: d.date,
        count: Number(d.count),
      })),
    };
  }

  async getSentimentAnalytics() {
    const breakdown = await this.prisma.callSummary.groupBy({
      by: ['sentiment'],
      _count: { sentiment: true },
    });

    const total = breakdown.reduce((sum, b) => sum + b._count.sentiment, 0);

    return {
      total,
      breakdown: breakdown.map((b) => ({
        sentiment: b.sentiment,
        count: b._count.sentiment,
        percentage: total > 0 ? Math.round((b._count.sentiment / total) * 100) : 0,
      })),
    };
  }
}
