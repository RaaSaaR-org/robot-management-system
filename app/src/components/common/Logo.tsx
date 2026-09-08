/**
 * @file Logo.tsx
 * @description Shared brand lockup with the NeoDEM folded-N mark and custom logo support.
 * @feature brand
 */

import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';

interface LogoProps {
  showText?: boolean;
  size?: 'sm' | 'default';
  linkTo?: string;
}

/** A folded N: one continuous route between intelligence and the physical world. */
function DefaultLogoSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 2H27L38 13V30C38 34.4 34.4 38 30 38H10C5.6 38 2 34.4 2 30V10C2 5.6 5.6 2 10 2Z"
        fill="#B2F8DF"
      />
      <path
        d="M11 29V13C11 11 12.5 10.5 14 12.5L26 27.5C27.5 29.5 29 29 29 27V11"
        stroke="#080F18"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ showText = true, size = 'default', linkTo = '/' }: LogoProps) {
  const brand = useBrand();
  const iconSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';

  const logoElement = brand.logoUrl
    ? <img src={brand.logoUrl} alt={showText ? '' : brand.name} className={`${iconSize} object-contain`} />
    : <DefaultLogoSVG className={`${iconSize} w-full h-full`} />;

  const content = (
    <div className="flex items-center gap-2">
      <div className={`${iconSize} relative`}>
        {logoElement}
      </div>
      {showText && (
        <span className={`text-theme-primary font-semibold ${textSize}`}>{brand.name}</span>
      )}
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo} aria-label={brand.name}>{content}</Link>;
  }

  return content;
}
