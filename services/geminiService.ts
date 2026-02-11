import { GoogleGenAI } from "@google/genai";

type ReviewReplyDraftInput = {
  senderName: string;
  platform: string;
  reviewText: string;
};

type MarketingAdviceInput = {
  storeName: string;
  industry?: string;
  areaHint?: string;
  postCount30d: number;
  pendingReplyCount: number;
  avgReplyHours?: number;
  surveyResponseCount30d: number;
  surveyPositiveRate30d?: number;
  latestAvgRank?: number;
  memo?: string;
};

// Gemini APIを使用して投稿文を作成するサービス
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private modelId = "gemini-3-flash-preview";
  private apiKey = (process.env.API_KEY || process.env.GEMINI_API_KEY || '').toString();

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getClient(): GoogleGenAI | null {
    if (!this.apiKey) return null;
    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.ai;
  }

  private normalizePlatformLabel(platform: string): string {
    if (platform === 'GOOGLE_BUSINESS') return 'Googleビジネスプロフィール';
    if (platform === 'INSTAGRAM') return 'Instagram';
    if (platform === 'FACEBOOK') return 'Facebook';
    if (platform === 'TIKTOK') return 'TikTok';
    return platform;
  }

  private buildFallbackReviewReply(input: ReviewReplyDraftInput): string {
    const lowerText = input.reviewText.toLowerCase();
    const positiveHints = ['ありがとう', '良い', 'よかった', '最高', 'また', '丁寧', '親切', 'great', 'good'];
    const hasPositive = positiveHints.some((hint) => lowerText.includes(hint));

    if (hasPositive) {
      return `${input.senderName}様、嬉しいご感想をありがとうございます。スタッフ一同大変励みになります。次回のご来店も心よりお待ちしております。`;
    }

    return `${input.senderName}様、このたびは貴重なご意見をありがとうございます。ご不便をおかけした点は真摯に受け止め、改善に努めてまいります。差し支えなければ詳細をお聞かせいただけますと幸いです。`;
  }

  async generatePostCaption(topic: string, platform: string, tone: string): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return "APIキーが設定されていないため、AI生成機能を使用できません。";
    }

    try {
      const prompt = `
        あなたはプロフェッショナルなSNSマーケティング担当者です。
        以下の条件に基づいて、魅力的なSNS投稿のキャプション（本文）を作成してください。
        
        トピック: ${topic}
        プラットフォーム: ${platform}
        トーン: ${tone} (例: 親しみやすい、フォーマル、情熱的)
        
        要件:
        - 日本語で出力すること
        - 絵文字を適度に使用すること
        - 関連するハッシュタグを3〜5個提案すること
        - 読者の興味を引くような書き出しにすること
      `;

      const response = await client.models.generateContent({
        model: this.modelId,
        contents: prompt,
      });

      return response.text || "生成に失敗しました。";
    } catch (error) {
      console.error("Gemini API Error:", error);
      return "AIによる生成中にエラーが発生しました。しばらく待ってから再試行してください。";
    }
  }

  async generateReviewReplyDraft(input: ReviewReplyDraftInput): Promise<string> {
    const fallback = this.buildFallbackReviewReply(input);
    const client = this.getClient();
    if (!client) {
      return fallback;
    }

    try {
      const platformLabel = this.normalizePlatformLabel(input.platform);
      const prompt = `
        あなたは店舗の口コミ返信担当です。
        以下の口コミに対して、丁寧で誠実な返信文を日本語で1案作成してください。

        送信先名: ${input.senderName}
        媒体: ${platformLabel}
        口コミ本文:
        ${input.reviewText}

        ルール:
        - 返信は1〜3文程度で簡潔にする
        - 不自然な誇張や断定表現を避ける
        - クレーム系は謝意と改善姿勢を明確にする
        - 個人情報や内部情報を含めない
        - 署名やハッシュタグは不要
      `;

      const response = await client.models.generateContent({
        model: this.modelId,
        contents: prompt,
      });

      const text = (response.text || '').trim();
      return text || fallback;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return fallback;
    }
  }

  async generateHashtags(content: string): Promise<string> {
    const client = this.getClient();
    if (!client) return "";

    try {
        const prompt = `以下の投稿内容に最適なハッシュタグを10個、日本語または英語でリストアップしてください。カンマ区切りで出力してください。\n\n投稿内容: ${content}`;
        const response = await client.models.generateContent({
            model: this.modelId,
            contents: prompt
        });
        return response.text || "";
    } catch (e) {
        console.error(e);
        return "";
    }
  }

  private buildFallbackMarketingAdvice(input: MarketingAdviceInput): string {
    const replySpeedText = typeof input.avgReplyHours === 'number'
      ? `${input.avgReplyHours.toFixed(1)}時間`
      : '未計測';
    const rankText = typeof input.latestAvgRank === 'number'
      ? `${input.latestAvgRank.toFixed(1)}位`
      : '未計測';
    const positiveRateText = typeof input.surveyPositiveRate30d === 'number'
      ? `${input.surveyPositiveRate30d.toFixed(1)}%`
      : '未計測';

    return [
      `対象店舗: ${input.storeName}`,
      '',
      '【現状サマリー】',
      `- 直近30日の投稿数: ${input.postCount30d}件`,
      `- 未返信件数: ${input.pendingReplyCount}件`,
      `- 平均返信時間: ${replySpeedText}`,
      `- 直近30日のアンケート回答数: ${input.surveyResponseCount30d}件（高評価率 ${positiveRateText}）`,
      `- 検索順位の平均: ${rankText}`,
      '',
      '【今週の優先アクション】',
      '1. 未返信がある場合は返信を優先し、24時間以内対応を徹底する',
      '2. 投稿が少ない場合は週3本を目安に、商品紹介・来店導線・実績紹介をバランス良く配信する',
      '3. アンケート結果を見て、低評価理由が多いテーマを1つ選び、改善投稿を作成する',
      '',
      '【補足】',
      'この提案は画面上の実績データから自動生成しています。実行後に再度分析を押して、改善効果を確認してください。',
    ].join('\n');
  }

  async generateMarketingAdvice(input: MarketingAdviceInput): Promise<string> {
    const fallback = this.buildFallbackMarketingAdvice(input);
    const client = this.getClient();
    if (!client) {
      return fallback;
    }

    try {
      const prompt = `
あなたは、店舗集客（MEO/SNS運用）の実務コンサルタントです。
以下の店舗データを前提に、現場がすぐ実行できる改善提案を日本語で作成してください。

店舗名: ${input.storeName}
業種: ${input.industry || '不明'}
地域情報: ${input.areaHint || '不明'}
直近30日の投稿数: ${input.postCount30d}
未返信件数: ${input.pendingReplyCount}
平均返信時間(時間): ${typeof input.avgReplyHours === 'number' ? input.avgReplyHours.toFixed(2) : '不明'}
直近30日のアンケート回答数: ${input.surveyResponseCount30d}
アンケート高評価率(%): ${typeof input.surveyPositiveRate30d === 'number' ? input.surveyPositiveRate30d.toFixed(1) : '不明'}
検索順位平均(小さいほど良い): ${typeof input.latestAvgRank === 'number' ? input.latestAvgRank.toFixed(2) : '不明'}
補足メモ: ${input.memo || 'なし'}

出力ルール:
- まず「現状の要点」を3行以内で記載
- 次に「今週やること」を優先順位付きで3〜5件提示
- その後「投稿テーマ例」を3件提示（業種と地域を踏まえる）
- 専門用語を避け、店舗責任者でも分かる表現にする
- 不確かな数値を断定しない
- 見出しつきの読みやすい箇条書きにする
`;

      const response = await client.models.generateContent({
        model: this.modelId,
        contents: prompt,
      });

      const text = (response.text || '').trim();
      return text || fallback;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return fallback;
    }
  }
}

export const geminiService = new GeminiService();
