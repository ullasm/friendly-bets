import type { FC, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '3xl' | '4xl' | '5xl';

const maxWidthClasses: Record<MaxWidth, string> = {
  sm:    'max-w-sm',
  md:    'max-w-md',
  lg:    'max-w-lg',
  xl:    'max-w-xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
};

interface PageHeaderProps {
  backHref?: string;
  subtitle?: string;
  center?: ReactNode;
  actions?: ReactNode;
  maxWidth?: MaxWidth;
  logoClassName?: string;
  className?: string;
}

export const PageHeader: FC<PageHeaderProps> = ({
  backHref,
  subtitle,
  center,
  actions,
  maxWidth = '5xl',
  logoClassName,
  className = '',
}) => {
  const logo = (
    <Link
      href="/"
      className={`font-bold text-green-500 ${logoClassName ?? 'text-xl sm:text-2xl'}`}
    >
      🏆 WhoWins
    </Link>
  );

  const backButton = backHref ? (
    <Link
      href={backHref}
      aria-label="Go back"
      className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      <ChevronLeft className="h-5 w-5" />
    </Link>
  ) : null;

  return (
    <header className={`bg-[var(--bg-card)] border-b border-[var(--border)] ${className}`}>
      <div className={`${maxWidthClasses[maxWidth]} mx-auto`}>

        {/* ── Desktop: single row ── */}
        <div className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-4">
          {/* Left: logo + optional back */}
          <div className="flex items-center gap-3 min-w-0">
            {logo}
            {backButton}
            {subtitle && (
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {subtitle}
              </span>
            )}
          </div>

          {/* Center */}
          <div className="flex items-center justify-center min-w-0 px-2">
            {center}
          </div>

          {/* Right */}
          <div className="flex items-center justify-end gap-3 shrink-0">
            {actions}
          </div>
        </div>

        {/* ── Mobile: two rows ── */}
        <div className="sm:hidden">
          {/* Row 1: logo */}
          <div className="px-4 pt-3 pb-1">
            {logo}
          </div>

          {/* Row 2: back + center + actions */}
          <div className="flex items-center gap-2 px-4 pb-3">
            {backButton}
            <div className="flex-1 min-w-0">
              {center}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          </div>
        </div>

      </div>
    </header>
  );
};
