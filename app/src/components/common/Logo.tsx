import { Link } from 'react-router-dom';

interface LogoProps {
  showText?: boolean;
  size?: 'sm' | 'default';
  linkTo?: string;
}

export function Logo({ showText = true, size = 'default', linkTo = '/' }: LogoProps) {
  const iconSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';

  const content = (
    <div className="flex items-center gap-2">
      <div className={`${iconSize} relative`}>
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
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
      </div>
      {showText && (
        <span className={`text-theme-primary font-semibold ${textSize}`}>RoboMindOS</span>
      )}
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>;
  }

  return content;
}
