import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface KnowledgeRetrievalInput {
  department: string;
  conversationText: string;
  issueCategory?: string;
  customerContext?: Record<string, unknown>;
}

export interface RetrievedDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  relevanceScore?: number;
}

export interface KnowledgeRetrievalOutput {
  documents: RetrievedDocument[];
}

@Injectable()
export class KnowledgeRetrievalService {
  constructor(private readonly prisma: PrismaService) {}

  async retrieve(input: KnowledgeRetrievalInput): Promise<KnowledgeRetrievalOutput> {
    const entries = await this.prisma.knowledgeBaseEntry.findMany({
      where: {
        department: input.department,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const contextText = [
      input.conversationText,
      input.issueCategory ?? '',
      JSON.stringify(input.customerContext ?? {}),
    ]
      .join(' ')
      .toLowerCase();

    const keywords = this.extractKeywords(contextText);

    const scored = entries
      .map((entry) => ({
        entry,
        score: this.scoreEntry(entry, keywords, input.issueCategory),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      documents: scored.map(({ entry, score }) => ({
        id: entry.id,
        title: entry.title,
        content: entry.content,
        category: entry.category,
        relevanceScore: score,
      })),
    };
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
      'it', 'this', 'that', 'i', 'you', 'we', 'they', 'my', 'your', 'our',
      'me', 'he', 'she', 'them', 'have', 'has', 'had', 'do', 'did', 'not',
      'no', 'yes', 'okay', 'ok', 'please', 'thank', 'thanks', 'hello', 'hi',
    ]);

    return [...new Set(
      text
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stopWords.has(word)),
    )];
  }

  private scoreEntry(
    entry: {
      title: string;
      content: string;
      category: string;
      tags: Prisma.JsonValue;
    },
    keywords: string[],
    issueCategory?: string,
  ): number {
    if (keywords.length === 0) {
      return 0;
    }

    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string')
      : [];

    const searchable = [
      entry.title,
      entry.content,
      entry.category,
      ...tags,
    ]
      .join(' ')
      .toLowerCase();

    let score = keywords.reduce(
      (total, keyword) => total + (searchable.includes(keyword) ? 1 : 0),
      0,
    );

    if (issueCategory && entry.category.toLowerCase().includes(issueCategory.toLowerCase())) {
      score += 3;
    }

    if (entry.title.toLowerCase().includes('script') || entry.title.toLowerCase().includes('flow')) {
      score += 1;
    }

    return score;
  }
}
