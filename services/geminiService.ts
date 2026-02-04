import { GoogleGenAI } from "@google/genai";

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
}

export const geminiService = new GeminiService();
