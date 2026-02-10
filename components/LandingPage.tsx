import React, { useMemo, useState } from 'react';
import { Calendar, MapPin, Menu, MessageSquare, PenSquare, TrendingUp, Users, X } from 'lucide-react';

type LandingPageProps = {
  onNavigateLogin: () => void;
};

type ContactFormState = {
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
};

const INITIAL_CONTACT_FORM: ContactFormState = {
  name: '',
  email: '',
  company: '',
  phone: '',
  message: '',
};

type FeatureCard = {
  title: string;
  description: string;
  icon: React.ElementType;
};

const FEATURES: FeatureCard[] = [
  {
    title: '受信メッセージ管理（口コミ/コメント）',
    description: '複数SNSのメッセージ対応を、ひとつの画面で進められます。',
    icon: MessageSquare,
  },
  {
    title: '投稿作成・予約（カレンダーで可視化）',
    description: '投稿を事前にまとめて作成し、公開タイミングを管理できます。',
    icon: Calendar,
  },
  {
    title: '店舗情報（名前・住所・電話）管理',
    description: '店舗情報の表記をそろえて、更新漏れや記載ずれを防ぎます。',
    icon: MapPin,
  },
  {
    title: 'MEOの状況把握（主要指標の可視化）',
    description: 'マップ表示や導線の変化を見ながら改善アクションを決められます。',
    icon: TrendingUp,
  },
  {
    title: 'AIで下書き作成（文章のたたき台）',
    description: '投稿文の初稿を短時間で用意し、現場の作業負荷を下げます。',
    icon: PenSquare,
  },
  {
    title: 'チーム運用（権限・複数店舗を想定）',
    description: '担当者が増えても、役割に応じた運用ルールを維持できます。',
    icon: Users,
  },
];

const FAQ_ITEMS = [
  {
    question: '料金は？',
    answer: '現在は要問い合わせです。店舗数・運用体制に合わせてご案内します。',
  },
  {
    question: '対応SNSは？',
    answer: '順次拡大予定。まずは運用方針を伺って最適な進め方をご提案します。',
  },
  {
    question: '複数店舗でも使える？',
    answer: '複数店舗の運用を想定しています。',
  },
  {
    question: '導入までの流れは？',
    answer: 'お問い合わせ → ヒアリング → 初期設定 → 運用開始',
  },
  {
    question: '既存の投稿素材は使える？',
    answer: '画像/動画素材の持ち込みを想定しています。',
  },
];

const PROBLEMS = [
  '口コミ返信が追いつかない',
  '投稿が続かない',
  '店舗情報が各所でズレる',
  '効果が見えない',
];

const HOW_TO_STEPS = ['店舗情報を登録', '投稿を作成して予約', '反応を確認して改善'];

const SCROLL_LINKS = [
  { label: '機能', targetId: 'features' },
  { label: '使い方', targetId: 'howto' },
  { label: 'FAQ', targetId: 'faq' },
  { label: 'お問い合わせ', targetId: 'contact' },
];

const buildContactBody = (state: ContactFormState): string => {
  return [
    '[TEPPEN MEO お問い合わせ]',
    `お名前: ${state.name || '-'}`,
    `メール: ${state.email || '-'}`,
    `店舗名/会社名: ${state.company || '-'}`,
    `電話: ${state.phone || '-'}`,
    '内容:',
    state.message || '-',
  ].join('\n');
};

const scrollToSection = (targetId: string) => {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigateLogin }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [contactForm, setContactForm] = useState<ContactFormState>(INITIAL_CONTACT_FORM);
  const [copySuccessMessage, setCopySuccessMessage] = useState('');
  const [copyErrorMessage, setCopyErrorMessage] = useState('');
  const [manualCopyText, setManualCopyText] = useState('');

  const contactBody = useMemo(() => buildContactBody(contactForm), [contactForm]);

  const updateContactField =
    (key: keyof ContactFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setContactForm((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const handleNavigateSection = (targetId: string) => {
    scrollToSection(targetId);
    setIsMobileMenuOpen(false);
  };

  const handleNavigateLogin = () => {
    setIsMobileMenuOpen(false);
    onNavigateLogin();
  };

  const handleCopyContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setCopySuccessMessage('');
    setCopyErrorMessage('');
    setManualCopyText('');

    try {
      await navigator.clipboard.writeText(contactBody);
      setCopySuccessMessage('コピーしました。メールやチャットに貼り付けてお送りください。');
    } catch {
      setCopyErrorMessage('コピーに失敗しました。下のテキストを手動でコピーしてください。');
      setManualCopyText(contactBody);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="absolute inset-x-0 top-0 -z-10 h-[30rem] bg-gradient-to-b from-primary-200/60 via-sky-100/30 to-transparent dark:from-primary-900/35 dark:via-slate-900 dark:to-transparent" />
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => scrollToSection('hero')}
            className="inline-flex items-center"
            aria-label="TEPPEN MEOトップへ"
          >
            <img src="/logo.svg" alt="TEPPEN MEO" className="h-8 w-auto sm:h-9" />
          </button>

          <nav className="hidden items-center gap-6 md:flex">
            {SCROLL_LINKS.map((link) => (
              <button
                key={link.targetId}
                type="button"
                onClick={() => handleNavigateSection(link.targetId)}
                className="text-sm font-medium text-slate-600 transition-colors hover:text-primary-700 dark:text-slate-300 dark:hover:text-primary-300"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <button
              type="button"
              onClick={() => handleNavigateSection('contact')}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              お問い合わせ
            </button>
            <button
              type="button"
              onClick={handleNavigateLogin}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              ログイン
            </button>
          </div>

          <button
            type="button"
            className="inline-flex rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-label={isMobileMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {isMobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-4 md:hidden dark:border-slate-800 dark:bg-slate-950">
            <div className="space-y-2">
              {SCROLL_LINKS.map((link) => (
                <button
                  key={link.targetId}
                  type="button"
                  onClick={() => handleNavigateSection(link.targetId)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {link.label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleNavigateSection('contact')}
                className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white"
              >
                お問い合わせ
              </button>
              <button
                type="button"
                onClick={handleNavigateLogin}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                ログイン
              </button>
            </div>
          </div>
        )}
      </header>

      <main>
        <section id="hero" className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-2 lg:px-8 lg:pt-20">
          <div>
            <p className="inline-flex rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold tracking-wide text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
              TEPPEN MEO
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl dark:text-white">
              店舗集客を、ひとつの画面で。
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
              Googleビジネスプロフィール（MEO）とSNS運用を統合し、投稿・口コミ対応・店舗情報を一元管理。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleNavigateSection('contact')}
                className="rounded-xl bg-primary-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-primary-700"
              >
                お問い合わせ
              </button>
              <button
                type="button"
                onClick={handleNavigateLogin}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                ログイン
              </button>
              <button
                type="button"
                onClick={() => handleNavigateSection('features')}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                機能を見る
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-100">運用状況サマリー</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">投稿予定</p>
                <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">12件</p>
              </div>
              <div className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">未返信口コミ</p>
                <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">4件</p>
              </div>
              <div className="col-span-2 rounded-2xl bg-primary-50 p-4 dark:bg-primary-900/20">
                <p className="text-xs text-primary-700 dark:text-primary-200">今週の注力タスク</p>
                <ul className="mt-2 space-y-1 text-sm font-medium text-primary-900 dark:text-primary-100">
                  <li>・高評価レビューへの返信強化</li>
                  <li>・週末キャンペーン投稿の予約</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-amber-100 bg-amber-50/80 p-6 dark:border-amber-900/50 dark:bg-amber-900/10">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">よくある店舗運用の悩み</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PROBLEMS.map((problem) => (
                <div
                  key={problem}
                  className="rounded-xl border border-white/80 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {problem}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">主要機能</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">現場運用で使う導線に絞って、日々の負担を減らします。</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <feature.icon className="h-6 w-6 text-primary-600 dark:text-primary-300" />
                <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="howto" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">使い方</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {HOW_TO_STEPS.map((step, index) => (
                <div key={step} className="rounded-2xl bg-slate-100 p-5 dark:bg-slate-800">
                  <p className="text-xs font-bold tracking-wide text-primary-700 dark:text-primary-300">STEP {index + 1}</p>
                  <p className="mt-2 text-base font-semibold text-slate-800 dark:text-slate-100">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white">FAQ</h2>
          <div className="mt-5 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <article key={item.question} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{item.question}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="mx-auto w-full max-w-4xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">お問い合わせ</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              入力内容をコピーし、メールやチャットに貼り付けてお送りください。
            </p>
            <form className="mt-6 space-y-4" onSubmit={handleCopyContact}>
              <div>
                <label htmlFor="contact-name" className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  お名前*
                </label>
                <input
                  id="contact-name"
                  required
                  value={contactForm.name}
                  onChange={updateContactField('name')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-primary-900"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  メールアドレス*
                </label>
                <input
                  id="contact-email"
                  required
                  type="email"
                  value={contactForm.email}
                  onChange={updateContactField('email')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-primary-900"
                />
              </div>
              <div>
                <label htmlFor="contact-company" className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  店舗名/会社名（任意）
                </label>
                <input
                  id="contact-company"
                  value={contactForm.company}
                  onChange={updateContactField('company')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-primary-900"
                />
              </div>
              <div>
                <label htmlFor="contact-phone" className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  電話番号（任意）
                </label>
                <input
                  id="contact-phone"
                  value={contactForm.phone}
                  onChange={updateContactField('phone')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-primary-900"
                />
              </div>
              <div>
                <label htmlFor="contact-message" className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  お問い合わせ内容*
                </label>
                <textarea
                  id="contact-message"
                  required
                  rows={5}
                  value={contactForm.message}
                  onChange={updateContactField('message')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-primary-900"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-primary-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-primary-700"
              >
                内容をコピー
              </button>
            </form>

            {copySuccessMessage && (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                {copySuccessMessage}
              </p>
            )}

            {copyErrorMessage && (
              <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{copyErrorMessage}</p>
                <textarea
                  readOnly
                  value={manualCopyText}
                  rows={8}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-slate-700 dark:border-amber-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        © 2026 TEPPEN MEO
      </footer>
    </div>
  );
};
