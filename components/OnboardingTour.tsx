import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { ViewState } from '../types';
import { getTourStepsForView, TourStep } from './guides/tourSteps';
import { TOUR_COPY } from './ui/copy';

interface OnboardingTourProps {
  onComplete: () => void;
  isOpen: boolean;
  currentView: ViewState;
}

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 260;
const VIEWPORT_PADDING = 16;
const TARGET_GAP = 12;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const getCenterStyle = () => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return {
    left: clamp((viewportWidth - POPUP_WIDTH) / 2, VIEWPORT_PADDING, viewportWidth - POPUP_WIDTH - VIEWPORT_PADDING),
    top: clamp((viewportHeight - POPUP_HEIGHT) / 2, VIEWPORT_PADDING, viewportHeight - POPUP_HEIGHT - VIEWPORT_PADDING),
  };
};

const computePopoverStyle = (targetRect: DOMRect | null, step: TourStep) => {
  if (!targetRect || step.position === 'center') return getCenterStyle();

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = targetRect.left;
  let top = targetRect.top;

  if (step.position === 'right') {
    left = targetRect.right + TARGET_GAP;
    top = targetRect.top;
    if (left + POPUP_WIDTH > viewportWidth - VIEWPORT_PADDING) {
      left = targetRect.left - POPUP_WIDTH - TARGET_GAP;
    }
  } else if (step.position === 'left') {
    left = targetRect.left - POPUP_WIDTH - TARGET_GAP;
    top = targetRect.top;
    if (left < VIEWPORT_PADDING) {
      left = targetRect.right + TARGET_GAP;
    }
  } else if (step.position === 'bottom') {
    top = targetRect.bottom + TARGET_GAP;
    left = targetRect.left;
    if (top + POPUP_HEIGHT > viewportHeight - VIEWPORT_PADDING) {
      top = targetRect.top - POPUP_HEIGHT - TARGET_GAP;
    }
  } else if (step.position === 'top') {
    top = targetRect.top - POPUP_HEIGHT - TARGET_GAP;
    left = targetRect.left;
    if (top < VIEWPORT_PADDING) {
      top = targetRect.bottom + TARGET_GAP;
    }
  }

  return {
    left: clamp(left, VIEWPORT_PADDING, viewportWidth - POPUP_WIDTH - VIEWPORT_PADDING),
    top: clamp(top, VIEWPORT_PADDING, viewportHeight - POPUP_HEIGHT - VIEWPORT_PADDING),
  };
};

const elementExists = (targetId?: string) => {
  if (!targetId) return true;
  return Boolean(document.getElementById(targetId));
};

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete, isOpen, currentView }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = useMemo(() => {
    const generated = getTourStepsForView(currentView).filter((step) => elementExists(step.targetId));
    if (generated.length > 0) return generated;
    return [
      {
        id: 'tour-fallback',
        title: 'ガイド',
        content: 'この画面の主な使い方を確認できます。',
        position: 'center',
      } satisfies TourStep,
    ];
  }, [currentView, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStep(0);
  }, [isOpen, currentView]);

  useEffect(() => {
    if (!isOpen) return;
    if (currentStep >= steps.length) {
      setCurrentStep(0);
      return;
    }

    const targetId = steps[currentStep]?.targetId;
    if (!targetId) return;

    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [currentStep, steps, isOpen]);

  if (!isOpen) return null;

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const targetRect = step.targetId ? document.getElementById(step.targetId)?.getBoundingClientRect() || null : null;
  const popoverStyle = computePopoverStyle(targetRect, step);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start pointer-events-none">
      <div className="absolute inset-0 bg-black/50 pointer-events-auto" />

      {targetRect && (
        <div
          className="absolute border-2 border-primary-400 rounded-lg bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] pointer-events-none transition-all duration-300 ease-in-out"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      <div
        className="absolute bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl w-[360px] max-w-[calc(100vw-32px)] pointer-events-auto transition-all duration-300 border border-gray-100 dark:border-gray-700"
        style={popoverStyle}
      >
        <button
          onClick={onComplete}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={20} />
        </button>

        <div className="mb-4">
          <span className="text-xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-wider">
            {TOUR_COPY.stepLabel} {currentStep + 1} / {steps.length}
          </span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{step.title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{step.content}</p>
        </div>

        <div className="flex justify-between items-center mt-6">
          <button
            onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
            disabled={currentStep === 0}
            className={`flex items-center text-sm font-medium ${
              currentStep === 0
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <ChevronLeft size={16} /> {TOUR_COPY.previousLabel}
          </button>
          <button
            onClick={() => {
              if (isLastStep) {
                onComplete();
                return;
              }
              setCurrentStep((prev) => prev + 1);
            }}
            className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 shadow-sm"
          >
            {isLastStep ? TOUR_COPY.finishLabel : TOUR_COPY.nextLabel}
            {!isLastStep && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};
