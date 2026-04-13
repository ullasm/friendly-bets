'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { Spinner } from '@/components/ui';

function EmailVerificationWall() {
  async function resend() {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
      alert('Verification email sent! Please check your inbox.');
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-2xl">📧</p>
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">Verify your email</h1>
      <p className="text-sm text-[var(--text-secondary)] max-w-sm">
        Please verify your email address to continue. Check your inbox for a verification link.
      </p>
      <button
        onClick={resend}
        className="mt-2 text-sm text-green-500 hover:text-green-400 underline"
      >
        Resend verification email
      </button>
    </div>
  );
}

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
    }
  }, [user, loading, router]);

  if (loading) {
    return <Spinner size="lg" fullPage />;
  }

  if (!user) return null;

  // Block email/password users who haven't verified their email
  const isEmailProvider = user.providerData.some((p) => p.providerId === 'password');
  if (isEmailProvider && !user.emailVerified) {
    return <EmailVerificationWall />;
  }

  return <>{children}</>;
}
