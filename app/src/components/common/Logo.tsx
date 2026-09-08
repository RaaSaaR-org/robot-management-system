/**
 * @file Logo.tsx
 * @description Shared brand lockup with the NeoDEM orbital mark and custom logo support.
 * @feature brand
 */

import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';

interface LogoProps {
  showText?: boolean;
  size?: 'sm' | 'default';
  linkTo?: string;
}

/** Two interlocking orbits around a shared intelligence core. */
function DefaultLogoSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="var(--color-primary)" strokeWidth="1.8">
        <ellipse cx="16" cy="16" rx="12.5" ry="5.8" transform="rotate(-42 16 16)" />
        <ellipse cx="16" cy="16" rx="12.5" ry="5.8" transform="rotate(42 16 16)" />
      </g>
      <path d="M16 12.5L19.5 16L16 19.5L12.5 16Z" fill="var(--color-primary)" />
      <circle cx="25.3" cy="7.6" r="2.3" fill="var(--text-primary)" />
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
