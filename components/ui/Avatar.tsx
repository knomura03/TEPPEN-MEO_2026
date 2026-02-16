import React from 'react';
import { User as UserIcon } from 'lucide-react';

type AvatarProps = {
  src?: string | null;
  alt: string;
  sizeClassName?: string;
  className?: string;
  iconSize?: number;
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  sizeClassName = 'h-10 w-10',
  className = '',
  iconSize = 18,
}) => {
  const hasImage = typeof src === 'string' && src.trim().length > 0;
  return (
    <div
      aria-label={alt}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-300 ${sizeClassName} ${className}`.trim()}
    >
      {hasImage ? (
        <img src={src as string} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <UserIcon size={iconSize} />
      )}
    </div>
  );
};
