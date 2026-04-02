import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';

interface LogoProps {
  showText?: boolean;
  size?: 'sm' | 'default';
  linkTo?: string;
}

function DefaultLogoSVG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Connection lines */}
      <path
        d="M8 10 L24 10 M8 10 L16 24 M24 10 L16 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-turquoise"
      />

      {/* Top left robot node */}
      <circle cx="8" cy="10" r="5" className="fill-cobalt" />
      <circle cx="6.5" cy="9" r="1" className="fill-white" />
      <circle cx="9.5" cy="9" r="1" className="fill-white" />
      <rect x="6" y="11" width="4" height="1" rx="0.5" className="fill-white/60" />

      {/* Top right robot node */}
      <circle cx="24" cy="10" r="5" className="fill-cobalt" />
      <circle cx="22.5" cy="9" r="1" className="fill-white" />
      <circle cx="25.5" cy="9" r="1" className="fill-white" />
      <rect x="22" y="11" width="4" height="1" rx="0.5" className="fill-white/60" />

      {/* Bottom robot node */}
      <circle cx="16" cy="24" r="5" className="fill-cobalt" />
      <circle cx="14.5" cy="23" r="1" className="fill-white" />
      <circle cx="17.5" cy="23" r="1" className="fill-white" />
      <rect x="14" y="25" width="4" height="1" rx="0.5" className="fill-white/60" />
    </svg>
  );
}

export function Logo({ showText = true, size = 'default', linkTo = '/' }: LogoProps) {
  const brand = useBrand();
  const iconSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';

  const logoElement = brand.logoUrl
    ? <img src={brand.logoUrl} alt={brand.name} className={`${iconSize} object-contain`} />
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
    return <Link to={linkTo}>{content}</Link>;
  }

  return content;
}
