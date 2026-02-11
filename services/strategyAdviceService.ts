import { InboxMessage, Post, Survey } from '../types';
import { geminiService } from './geminiService';
import { inboxService } from './inboxService';
import { postsService } from './postsService';
import { rankCollectionService } from './rankCollectionService';
import { surveyService } from './surveyService';

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

export interface StrategyAdviceSnapshot {
  postCount30d: number;
  totalPostCount: number;
  pendingReplyCount: number;
  avgReplyHours?: number;
  totalMessageCount: number;
  surveyCount: number;
  surveyResponseCount: number;
  surveyPositiveRate?: number;
  latestAvgRank?: number;
  collectedAt: Date;
}

export interface StrategyAdviceResult {
  snapshot: StrategyAdviceSnapshot;
  reportText: string;
  usedAi: boolean;
}

const isWithinDays = (date: Date | undefined, daysMs: number): boolean => {
  if (!date) return false;
  return Date.now() - date.getTime() <= daysMs;
};

const summarizePosts = (posts: Post[]): { postCount30d: number; totalPostCount: number } => {
  const postCount30d = posts.filter((post) => {
    const refDate = post.publishedDate || post.scheduledDate;
    return isWithinDays(refDate, DAYS_30_MS);
  }).length;

  return {
    postCount30d,
    totalPostCount: posts.length,
  };
};

const summarizeMessages = (messages: InboxMessage[]): {
  pendingReplyCount: number;
  avgReplyHours?: number;
  totalMessageCount: number;
} => {
  const pendingReplyCount = messages.filter((message) => !message.isReplied).length;

  const replyHours = messages
    .filter((message) => message.isReplied && message.replySentAt)
    .map((message) => {
      const diffMs = (message.replySentAt as Date).getTime() - message.receivedAt.getTime();
      return diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
    })
    .filter((hours) => Number.isFinite(hours));

  const avgReplyHours = replyHours.length > 0
    ? replyHours.reduce((sum, hours) => sum + hours, 0) / replyHours.length
    : undefined;

  return {
    pendingReplyCount,
    avgReplyHours,
    totalMessageCount: messages.length,
  };
};

const summarizeSurveys = async (surveys: Survey[]): Promise<{
  surveyCount: number;
  surveyResponseCount: number;
  surveyPositiveRate?: number;
}> => {
  const surveyCount = surveys.length;
  const surveyResponseCount = surveys.reduce((sum, survey) => sum + (survey.responseCount || 0), 0);
  const published = surveys.find((survey) => survey.status === 'PUBLISHED');

  if (!published) {
    return { surveyCount, surveyResponseCount };
  }

  try {
    const analytics = await surveyService.getAnalytics(published.id);
    return {
      surveyCount,
      surveyResponseCount,
      surveyPositiveRate: analytics.positiveRate,
    };
  } catch {
    return {
      surveyCount,
      surveyResponseCount,
    };
  }
};

const summarizeRank = async (storeId: string): Promise<{ latestAvgRank?: number }> => {
  try {
    const details = await rankCollectionService.listRunDetailsByStore(storeId, 1);
    const latest = details[0];
    if (!latest) return {};

    const ranked = latest.results
      .filter((result) => result.status === 'SUCCESS' && typeof result.position === 'number')
      .map((result) => Number(result.position));

    if (ranked.length === 0) return {};
    const average = ranked.reduce((sum, value) => sum + value, 0) / ranked.length;
    return { latestAvgRank: average };
  } catch {
    return {};
  }
};

export const strategyAdviceService = {
  async run(params: {
    storeId: string;
    storeName: string;
    industry?: string;
    areaHint?: string;
  }): Promise<StrategyAdviceResult> {
    const [posts, messages, surveys, rankSummary] = await Promise.all([
      postsService.listByStore(params.storeId),
      inboxService.listByStore(params.storeId),
      surveyService.listByStore(params.storeId),
      summarizeRank(params.storeId),
    ]);

    const postSummary = summarizePosts(posts);
    const messageSummary = summarizeMessages(messages);
    const surveySummary = await summarizeSurveys(surveys);

    const snapshot: StrategyAdviceSnapshot = {
      postCount30d: postSummary.postCount30d,
      totalPostCount: postSummary.totalPostCount,
      pendingReplyCount: messageSummary.pendingReplyCount,
      avgReplyHours: messageSummary.avgReplyHours,
      totalMessageCount: messageSummary.totalMessageCount,
      surveyCount: surveySummary.surveyCount,
      surveyResponseCount: surveySummary.surveyResponseCount,
      surveyPositiveRate: surveySummary.surveyPositiveRate,
      latestAvgRank: rankSummary.latestAvgRank,
      collectedAt: new Date(),
    };

    const reportText = await geminiService.generateMarketingAdvice({
      storeName: params.storeName,
      industry: params.industry,
      areaHint: params.areaHint,
      postCount30d: snapshot.postCount30d,
      pendingReplyCount: snapshot.pendingReplyCount,
      avgReplyHours: snapshot.avgReplyHours,
      surveyResponseCount30d: snapshot.surveyResponseCount,
      surveyPositiveRate30d: snapshot.surveyPositiveRate,
      latestAvgRank: snapshot.latestAvgRank,
      memo: 'この提案は手動実行で都度更新します。',
    });

    return {
      snapshot,
      reportText,
      usedAi: geminiService.isConfigured(),
    };
  },
};
