import React, { useId } from 'react';
import { SocialPlatform } from '../../types';

export type SocialPlatformLike = SocialPlatform | 'GBP' | 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE_BUSINESS';

type NormalizedPlatform = 'GOOGLE_BUSINESS' | 'FACEBOOK' | 'INSTAGRAM';

const PLATFORM_LABELS: Record<NormalizedPlatform, string> = {
  GOOGLE_BUSINESS: 'Googleビジネスプロフィール',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
};

const normalizePlatform = (platform: SocialPlatformLike): NormalizedPlatform => {
  const key = String(platform || '').trim().toUpperCase();
  if (key === 'FACEBOOK') return 'FACEBOOK';
  if (key === 'INSTAGRAM') return 'INSTAGRAM';
  return 'GOOGLE_BUSINESS';
};

export const getSocialPlatformLabel = (platform: SocialPlatformLike): string => {
  return PLATFORM_LABELS[normalizePlatform(platform)];
};

type SocialPlatformLogoProps = {
  platform: SocialPlatformLike;
  size?: number;
  className?: string;
  title?: string;
};

export const SocialPlatformLogo: React.FC<SocialPlatformLogoProps> = ({
  platform,
  size = 16,
  className = '',
  title,
}) => {
  const normalized = normalizePlatform(platform);
  const instagramGradientId = useId();

  if (normalized === 'FACEBOOK') {
    return (
      <span
        className={`inline-flex items-center justify-center align-middle ${className}`.trim()}
        style={{ width: size, height: size }}
        title={title || PLATFORM_LABELS.FACEBOOK}
        aria-label={title || PLATFORM_LABELS.FACEBOOK}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path fill="#FFFFFF" d="M14.55 8.54h1.86V5.69h-2.19c-2.95 0-4.32 1.76-4.32 4.54v1.68H7.87v2.8h2.03v8.59h3.33v-8.6h2.64l.42-2.8h-3.07v-1.31c0-1 .3-2.05 1.33-2.05Z" />
        </svg>
      </span>
    );
  }

  if (normalized === 'INSTAGRAM') {
    return (
      <span
        className={`inline-flex items-center justify-center align-middle ${className}`.trim()}
        style={{ width: size, height: size }}
        title={title || PLATFORM_LABELS.INSTAGRAM}
        aria-label={title || PLATFORM_LABELS.INSTAGRAM}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
          <defs>
            <linearGradient id={instagramGradientId} x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F58529" />
              <stop offset="0.28" stopColor="#FEDA77" />
              <stop offset="0.5" stopColor="#DD2A7B" />
              <stop offset="0.74" stopColor="#8134AF" />
              <stop offset="1" stopColor="#515BD4" />
            </linearGradient>
          </defs>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill={`url(#${instagramGradientId})`} />
          <rect x="6.2" y="6.2" width="11.6" height="11.6" rx="3.9" stroke="#FFFFFF" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.9" stroke="#FFFFFF" strokeWidth="1.8" />
          <circle cx="17.3" cy="6.7" r="1.1" fill="#FFFFFF" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center align-middle ${className}`.trim()}
      style={{ width: size, height: size }}
      title={title || PLATFORM_LABELS.GOOGLE_BUSINESS}
      aria-label={title || PLATFORM_LABELS.GOOGLE_BUSINESS}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
        <path fill="#EA4335" d="M23.49 12.27c0-.76-.07-1.5-.2-2.2H12v4.17h6.45a5.44 5.44 0 0 1-2.39 3.57v2.96h3.86c2.26-2.07 3.57-5.1 3.57-8.5Z" />
        <path fill="#4285F4" d="M12 24c3.24 0 5.96-1.06 7.95-2.88l-3.86-2.96c-1.07.71-2.45 1.14-4.09 1.14-3.13 0-5.78-2.1-6.72-4.93H1.3v3.1A11.99 11.99 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.28 14.37A7.2 7.2 0 0 1 4.9 12c0-.82.14-1.61.38-2.37V6.54H1.3A11.99 11.99 0 0 0 0 12c0 1.93.46 3.75 1.3 5.46l3.98-3.09Z" />
        <path fill="#34A853" d="M12 4.7c1.77 0 3.35.6 4.6 1.78l3.45-3.45C17.95 1.13 15.24 0 12 0 7.37 0 3.35 2.64 1.3 6.54l3.98 3.1C6.22 6.8 8.87 4.7 12 4.7Z" />
      </svg>
    </span>
  );
};

type SocialPlatformBadgeProps = {
  platform: SocialPlatformLike;
  size?: number;
  className?: string;
  labelClassName?: string;
  showLabel?: boolean;
};

export const SocialPlatformBadge: React.FC<SocialPlatformBadgeProps> = ({
  platform,
  size = 14,
  className = '',
  labelClassName = '',
  showLabel = true,
}) => {
  const label = getSocialPlatformLabel(platform);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`.trim()}>
      <SocialPlatformLogo platform={platform} size={size} title={label} />
      {showLabel ? <span className={labelClassName || 'text-xs'}>{label}</span> : null}
    </span>
  );
};
