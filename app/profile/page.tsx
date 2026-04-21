'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { updateProfile } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getUserGroups } from '@/lib/groups';
import type { Group } from '@/lib/groups';
import {
  Spinner,
  Button,
  Card,
  FormInput,
  Avatar,
  SectionHeader,
  Badge,
} from '@/components/ui';

// ── Avatar color palette (must match auth.ts) ──────────────────────────────
const AVATAR_COLORS = [
  { hex: '#ef4444', label: 'Red'    },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Yellow' },
  { hex: '#22c55e', label: 'Green'  },
  { hex: '#3b82f6', label: 'Blue'   },
  { hex: '#8b5cf6', label: 'Purple' },
  { hex: '#ec4899', label: 'Pink'   },
];

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(ts: Group['createdAt']) {
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Profile content ────────────────────────────────────────────────────────

function ProfileContent() {
  const { user, userProfile, setUserProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [saving, setSaving] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Populate form from context once profile is available
  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName);
      setSelectedColor(userProfile.avatarColor);
    }
  }, [userProfile]);

  // Load group list once
  useEffect(() => {
    if (!user) return;
    getUserGroups(user.uid)
      .then(setGroups)
      .catch(() => toast.error('Failed to load groups'))
      .finally(() => setLoadingGroups(false));
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !userProfile) return;

    const trimmedName = displayName.trim();
    if (trimmedName.length < 2) {
      toast.error('Display name must be at least 2 characters');
      return;
    }

    const nameChanged  = trimmedName  !== userProfile.displayName;
    const colorChanged = selectedColor !== userProfile.avatarColor;

    if (!nameChanged && !colorChanged) {
      toast('Nothing to update', { icon: 'ℹ️' });
      return;
    }

    setSaving(true);
    try {
      // Update Firebase Auth displayName (shown in Firebase Console + auth token)
      if (nameChanged) {
        await updateProfile(auth.currentUser!, { displayName: trimmedName });
      }

      // Update Firestore users/{uid} — the AuthContext onSnapshot listener
      // will propagate this change globally without any extra setUserProfile call.
      const updates: Record<string, string> = {};
      if (nameChanged)  updates.displayName = trimmedName;
      if (colorChanged) updates.avatarColor  = selectedColor;

      await updateDoc(doc(db, 'users', user.uid), updates);

      // Optimistic local update so the avatar in the header changes immediately
      // (the onSnapshot will confirm it within ~100 ms)
      setUserProfile({
        ...userProfile,
        displayName: nameChanged ? trimmedName : userProfile.displayName,
        avatarColor: colorChanged ? selectedColor : userProfile.avatarColor,
      });

      toast.success('Profile updated!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (!userProfile) {
    return <Spinner size="lg" fullPage />;
  }

  const isDirty =
    displayName.trim() !== userProfile.displayName ||
    selectedColor !== userProfile.avatarColor;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppNavbar
        backIsHistory
        center={
          <span className="font-semibold text-sm sm:text-base text-[var(--text-primary)]">
            My Profile
          </span>
        }
        maxWidth="3xl"
      />

      <main className="max-w-3xl mx-auto px-2 py-8 space-y-6">

        {/* ── Avatar preview + name ── */}
        <Card variant="default" className="flex items-center gap-5">
          <Avatar
            name={displayName || userProfile.displayName}
            color={selectedColor || userProfile.avatarColor}
            size="lg"
            className="!w-16 !h-16 !text-2xl"
          />
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              {userProfile.displayName}
            </p>
            <p className="text-sm text-[var(--text-muted)]">{userProfile.email}</p>
          </div>
        </Card>

        {/* ── Edit profile form ── */}
        <Card variant="default" className="space-y-5">
          <SectionHeader title="Edit Profile" mb="mb-0" />

          <form onSubmit={handleSave} className="space-y-5">
            <FormInput
              id="displayName"
              label="Display Name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name in groups"
            />

            {/* Avatar colour swatch picker */}
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                Avatar Colour
              </p>
              <div className="flex flex-wrap gap-3">
                {AVATAR_COLORS.map(({ hex, label }) => {
                  const isSelected = selectedColor === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      title={label}
                      onClick={() => setSelectedColor(hex)}
                      className={`w-9 h-9 rounded-full transition-all duration-150 ${
                        isSelected
                          ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-card)] ring-white scale-110'
                          : 'hover:scale-105 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-pressed={isSelected}
                      aria-label={`${label} avatar colour${isSelected ? ' (selected)' : ''}`}
                    />
                  );
                })}
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={saving}
              disabled={!isDirty}
              className="w-full sm:w-auto"
            >
              Save Changes
            </Button>
          </form>
        </Card>

        {/* ── My Groups ── */}
        <Card variant="default" className="space-y-4">
          <SectionHeader title="My Groups" mb="mb-0" />

          {loadingGroups ? (
            <div className="flex justify-center py-6">
              <Spinner size="md" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">
              You haven&apos;t joined any groups yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.groupId}>
                  <Link
                    href={`/groups/${g.groupId}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] transition-colors group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate group-hover:text-green-400 transition-colors">
                        {g.name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Created {formatDate(g.createdAt)}
                      </p>
                    </div>
                    {/* Creator badge */}
                    {g.createdBy === user?.uid && (
                      <Badge variant="role-admin" shape="tag">
                        Creator
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <ProfileContent />
    </ProtectedRoute>
  );
}
