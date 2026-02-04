import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';

interface Step {
  targetId?: string; // CSS IDセレクタ (未指定の場合は画面中央)
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const TOUR_STEPS: Step[] = [
  {
    title: "SocialSync Proへようこそ！",
    content: "このアプリでは、複数のSNSアカウントを一元管理し、効率的なマーケティングを行うことができます。主要な機能をご案内します。",
    position: 'center'
  },
  {
    targetId: 'nav-DASHBOARD',
    title: "ダッシュボード",
    content: "全体のフォロワー数やエンゲージメント状況を一目で確認できます。AIによる分析レポートもここから。",
    position: 'right'
  },
  {
    targetId: 'nav-CALENDAR',
    title: "カレンダー",
    content: "投稿スケジュールを月表示で管理。キャンペーンの計画にお使いください。",
    position: 'right'
  },
  {
    targetId: 'nav-CREATE_POST',
    title: "新規投稿 & AI作成",
    content: "ここから投稿を作成します。AIアシスタントを使えば、魅力的なキャプションを自動生成できます。",
    position: 'right'
  },
  {
    targetId: 'nav-INBOX',
    title: "統合受信箱",
    content: "InstagramやFacebookのコメント・DMをここでまとめて返信できます。",
    position: 'right'
  },
  {
    targetId: 'theme-toggle',
    title: "ダークモード",
    content: "夜間の作業にはダークモードがおすすめです。ここからいつでも切り替えられます。",
    position: 'bottom'
  }
];

interface OnboardingTourProps {
  onComplete: () => void;
  isOpen: boolean;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete, isOpen }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  // ターゲット要素の位置を取得
  const getTargetPosition = () => {
    if (!step.targetId || step.position === 'center') return null;
    const element = document.getElementById(step.targetId);
    if (!element) return null;
    return element.getBoundingClientRect();
  };

  const targetRect = getTargetPosition();

  // ポップオーバーの位置計算
  const getPopoverStyle = () => {
    if (!targetRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const gap = 12;
    // 簡易的な位置計算
    if (step.position === 'right') {
      return { top: targetRect.top, left: targetRect.right + gap };
    }
    if (step.position === 'bottom') {
      return { top: targetRect.bottom + gap, left: targetRect.left };
    }
    // デフォルト
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start pointer-events-none">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 pointer-events-auto" />

      {/* Target Highlight (Optional: can use clip-path on backdrop instead) */}
      {targetRect && (
        <div 
          className="absolute border-2 border-indigo-400 rounded-lg bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] pointer-events-none transition-all duration-300 ease-in-out"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      {/* Popover */}
      <div 
        className="absolute bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl w-80 pointer-events-auto transition-all duration-300 border border-gray-100 dark:border-gray-700"
        style={getPopoverStyle()}
      >
        <button 
          onClick={onComplete} 
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={20} />
        </button>

        <div className="mb-4">
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
            Step {currentStep + 1} of {TOUR_STEPS.length}
          </span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{step.title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">
            {step.content}
          </p>
        </div>

        <div className="flex justify-between items-center mt-6">
          <button 
            onClick={handlePrev}
            disabled={currentStep === 0}
            className={`flex items-center text-sm font-medium ${
              currentStep === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <ChevronLeft size={16} /> 前へ
          </button>
          <button 
            onClick={handleNext}
            className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
          >
            {isLastStep ? '完了' : '次へ'} {!isLastStep && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};