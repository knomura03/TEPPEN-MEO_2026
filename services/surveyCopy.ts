import { Survey } from '../types';

export const DEFAULT_SURVEY_COPY = {
  questionText: '総合満足度を教えてください（1〜5）',
  thanksTitle: 'ご回答ありがとうございました',
  thanksBody: '貴重なご意見をありがとうございます。今後のサービス改善に活用します。',
  thanksPositiveMessage: '口コミページへ自動で移動します。移動しない場合は下のボタンを押してください。',
  thanksNegativeMessage: '頂いたご意見は店舗改善の優先タスクとして確認します。',
  thanksButtonText: 'Google口コミページへ進む',
} as const;

type SurveyCopySource = Pick<
  Survey,
  'questionText' | 'thanksTitle' | 'thanksBody' | 'thanksPositiveMessage' | 'thanksNegativeMessage' | 'thanksButtonText'
>;

const normalizeText = (value: string | undefined): string | undefined => {
  const next = value?.trim();
  return next ? next : undefined;
};

export const resolveSurveyCopy = (survey: SurveyCopySource) => {
  return {
    questionText: normalizeText(survey.questionText) || DEFAULT_SURVEY_COPY.questionText,
    thanksTitle: normalizeText(survey.thanksTitle) || DEFAULT_SURVEY_COPY.thanksTitle,
    thanksBody: normalizeText(survey.thanksBody) || DEFAULT_SURVEY_COPY.thanksBody,
    thanksPositiveMessage: normalizeText(survey.thanksPositiveMessage) || DEFAULT_SURVEY_COPY.thanksPositiveMessage,
    thanksNegativeMessage: normalizeText(survey.thanksNegativeMessage) || DEFAULT_SURVEY_COPY.thanksNegativeMessage,
    thanksButtonText: normalizeText(survey.thanksButtonText) || DEFAULT_SURVEY_COPY.thanksButtonText,
  };
};
