/**
 * @file Logo.tsx
 * @description Shared brand lockup with the NeoDEM orbital mark and custom logo support.
 * @feature brand
 */

import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';
import { NeoDEMMark } from './NeoDEMMark';

interface LogoProps {
  showText?: boolean;
  size?: 'sm' | 'default';
  linkTo?: string;
}

export function Logo({ showText = true, size = 'default', linkTo = '/' }: LogoProps) {
  const brand = useBrand();
  const iconSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';

  const logoElement = brand.logoUrl
    ? <img src={brand.logoUrl} alt={showText ? '' : brand.name} className={`${iconSize} object-contain`} />
    : <NeoDEMMark className={`${iconSize} w-full h-full`} />;

  const content = (
    <div className="flex items-center gap-2">
      <div className={`${iconSize} relative`}>
        {logoElement}
      </div>
      {showText && (
        <span className={`text-ink-primary font-semibold ${textSize}`}>{brand.name}</span>
      )}
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo} aria-label={brand.name}>{content}</Link>;
  }

  return content;
}
