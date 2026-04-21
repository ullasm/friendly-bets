'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin' | 'member';
  avatarColor: string;
  groupIds?: string[];
  superAdmin?: boolean;
}

interface AuthContextValue {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  /**
   * Force-refresh the in-memory userProfile from Firestore.
   * Call this after any write that changes the users/{uid} document
   * (e.g. profile page save) so the navbar avatar updates instantly
   * without waiting for the next onSnapshot tick.
   * In practice the onSnapshot listener already handles this automatically;
   * this is kept as an escape hatch for optimistic UI patterns.
   */
  setUserProfile: (profile: UserProfile | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Unsubscribe fn for the Firestore profile listener (set once auth resolves)
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);

      // Tear down any previous profile listener before setting up a new one.
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      if (firebaseUser) {
        // Real-time listener on the user's Firestore profile.
        // This means any admin-side write to users/{uid} (displayName, avatarColor)
        // is reflected globally without a refresh.
        profileUnsub = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            setUserProfile(snap.exists() ? (snap.data() as UserProfile) : null);
            setLoading(false);
          },
          (err) => {
            console.error('[AuthContext] profile listener error:', err);
            setLoading(false);
          }
        );
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsub();
      profileUnsub?.();
    };
  }, []);

  const stableSetUserProfile = useCallback((profile: UserProfile | null) => {
    setUserProfile(profile);
  }, []);

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, setUserProfile: stableSetUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
