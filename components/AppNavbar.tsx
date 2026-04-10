'use client';

import { type ReactNode, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { useTheme, type Theme } from '@/lib/ThemeContext';
import { PageHeader, Avatar } from '@/components/ui';

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

export interface NavTab {
  label: string;
  href: string;
}

interface AppNavbarProps {
  backHref?: string;
  backIsHistory?: boolean;
  subtitle?: string;
  center?: ReactNode;
  maxWidth?: MaxWidth;
  extraActions?: ReactNode;
  /** When provided renders the two-row layout with tab bar */
  tabs?: NavTab[];
}

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'dark',          label: 'Dark',    icon: '🌙' },
  { value: 'light',         label: 'Light',   icon: '☀️' },
  { value: 'dark-compact',  label: 'Dark C',  icon: '🌙' },
  { value: 'light-compact', label: 'Light C', icon: '☀️' },
];

export default function AppNavbar({
  backHref,
  backIsHistory = false,
  subtitle,
  center,
  maxWidth = '5xl',
  extraActions,
  tabs,
}: AppNavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    setOpen(false);
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  const firstName = userProfile?.displayName?.split(' ')[0] ?? '';

  // ── Shared dropdown ───────────────────────────────────────────────────────
  const dropdown = userProfile && (
    <div className="relative">
      {open && (
        <div className="fixed inset-0 z-[49]" onClick={() => setOpen(false)} />
      )}

      {/* Trigger */}
      {tabs ? (
        // Two-row mode: pill button with name
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Account menu"
          className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.06] border border-white/15 hover:bg-white/10 transition-colors focus:outline-none"
        >
          <Avatar name={userProfile.displayName} color={userProfile.avatarColor} size="sm" />
          <span className="text-[13px] font-medium text-[var(--text-primary)] hidden sm:block">{firstName}</span>
          <svg
            className={`h-3 w-3 text-[var(--text-secondary)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none"
            aria-hidden
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        // Single-row mode: avatar-only button
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Account menu"
          className="flex items-center gap-1.5 rounded-full hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-solid)]"
        >
          <Avatar name={userProfile.displayName} color={userProfile.avatarColor} size="md" />
          <svg
            className={`h-3 w-3 text-[var(--text-secondary)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12" fill="currentColor"
            aria-hidden
          >
            <path d="M6 8L1 3h10L6 8z" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[210px] z-[50] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">

          {/* Identity */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-[var(--border)]">
            <Avatar name={userProfile.displayName} color={userProfile.avatarColor} size="md" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{userProfile.displayName}</p>
              <p className="text-xs text-[var(--text-muted)]">{userProfile.totalPoints} pts</p>
            </div>
          </div>

          {/* My Profile */}
          <div className="p-1 border-b border-[var(--border)]">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2.5 py-[7px] text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              <User className="h-[15px] w-[15px] opacity-70 shrink-0" />
              My Profile
            </Link>
          </div>

          {/* Theme */}
          <div className="p-1 border-b border-[var(--border)]">
            <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1 pt-1 pb-1.5">Theme</p>
            <div className="grid grid-cols-2 gap-1">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-[5px] text-xs font-medium rounded-lg border transition-all ${
                    theme === t.value
                      ? 'bg-blue-500/12 border-blue-500/35 text-blue-400'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sign out */}
          <div className="p-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2.5 py-[7px] text-[13px] text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut className="h-[15px] w-[15px] opacity-70 shrink-0" />
              Sign out
            </button>
          </div>

        </div>
      )}
    </div>
  );

  // ── Two-row layout (when tabs provided) ───────────────────────────────────
  if (tabs) {
    return (
      <header className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border)]">
        <div className={`${maxWidthClasses[maxWidth]} mx-auto`}>

          {/* ── Desktop: 3-col × 2-row grid, logo spans both rows ── */}
          <div className="hidden sm:grid grid-cols-[auto_1fr_auto] grid-rows-[56px_28px] px-5">

            <Link href="/" className="row-span-2 flex items-center pr-6 text-2xl font-bold whitespace-nowrap">
              🏆 <span className="text-[var(--text-primary)]">Who</span><span className="text-blue-400">Wins</span>
            </Link>

            <div className="row-span-2 flex items-center justify-center min-w-0 px-4">{center}</div>
            <div className="flex items-center justify-end">{dropdown}</div>

            <div className="flex items-stretch justify-end gap-5">
              {tabs.map((tab) => {
                const active = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`relative flex items-center text-[13.5px] font-light transition-colors ${
                      active
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                    {active && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-sm" />
                    )}
                  </Link>
                );
              })}
            </div>

          </div>

          {/* ── Mobile: logo + avatar row, then group name row, then tabs row ── */}
          <div className="sm:hidden">

            {/* Row 1: logo + avatar */}
            <div className="flex items-center justify-between px-4 h-[52px]">
              <Link href="/" className="text-xl font-bold whitespace-nowrap">
                🏆 <span className="text-[var(--text-primary)]">Who</span><span className="text-blue-400">Wins</span>
              </Link>
              {dropdown}
            </div>

            {/* Row 2: group name (left) + tabs (right) */}
            <div className="flex items-stretch justify-between px-4 h-[28px]">
              <div className="flex items-center">{center}</div>
              <div className="flex items-stretch gap-5">
                {tabs.map((tab) => {
                  const active = pathname === tab.href;
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={`relative flex items-center text-[13px] font-light transition-colors ${
                        active
                          ? 'text-[var(--text-primary)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {tab.label}
                      {active && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-sm" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

          </div>

        </div>
      </header>
    );
  }

  // ── Single-row layout (default, via PageHeader) ───────────────────────────
  const actions = (
    <>
      {extraActions}
      {dropdown}
    </>
  );

  return (
    <PageHeader
      backHref={backHref}
      backIsHistory={backIsHistory}
      subtitle={subtitle}
      center={center}
      maxWidth={maxWidth}
      actions={actions}
    />
  );
}
