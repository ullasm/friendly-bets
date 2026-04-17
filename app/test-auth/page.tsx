'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';

function TestAuthInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      router.replace('/');
      return;
    }
    const token = params.get('token');
    if (!token) return;

    signInWithCustomToken(auth, token)
      .then(() => router.replace('/groups'))
      .catch((err) => console.error('[test-auth] sign-in failed', err));
  }, [params, router]);

  return <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>Signing in for test…</div>;
}

export default function TestAuthPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <TestAuthInner />
    </Suspense>
  );
}
