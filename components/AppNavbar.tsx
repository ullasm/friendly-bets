'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { PageHeader, Avatar, Button } from '@/components/ui';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '3xl' | '4xl' | '5xl';

interface AppNavbarProps {
  /**
   * Back chevron href. When omitted, no back arrow is shown (top-level pages).
   */
  backHref?: string;
  /**
   * Subtitle rendered below the logo (e.g. "IPL 2026 · Admin Panel").
   */
  subtitle?: string;
  /**
   * Must match the page <main> max-w-* so the header aligns with the content.
   */
  maxWidth?: MaxWidth;
  /**
   * Extra actions rendered BEFORE the avatar / sign-out cluster.
   * Use this for page-specific buttons (e.g. "Admin Panel", Settings icon).
   */
  extraActions?: ReactNode;
}

/**
 * AppNavbar — the single source of truth for the authenticated top bar.
 *
 * Renders consistently on every protected page:
 *   [← back]  🏆 WhoWins  [subtitle]  |  [extraActions]  [Theme]  [Avatar→/profile]  [Sign out]
 *
 * Owns its own auth context read and logout handler so pages don't need to
 * duplicate that logic.
 */
export default function AppNavbar({
  backHref,
  subtitle,
  maxWidth = '5xl',
  extraActions,
}: AppNavbarProps) {
  const router = useRouter();
  const { userProfile } = useAuth();

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  const actions = (
    <>
      {extraActions}
      <ThemeSwitcher />
      {userProfile && (
        <Link
          href="/profile"
          title={`${userProfile.displayName} · My Profile`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <Avatar
            name={userProfile.displayName}
            color={userProfile.avatarColor}
            size="md"
          />
        </Link>
      )}
      <Button variant="ghost-warning" size="md" onClick={handleLogout}>
        Sign out
      </Button>
    </>
  );

  return (
    <PageHeader
      backHref={backHref}
      subtitle={subtitle}
      maxWidth={maxWidth}
      actions={actions}
    />
  );
}
