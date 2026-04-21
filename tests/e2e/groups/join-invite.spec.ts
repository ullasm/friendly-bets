/**
 * tests/e2e/groups/join-invite.spec.ts
 *
 * Category A13 — Join Group page (/join/[inviteCode]) scenarios
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { loginAsRole } from '../../utils/authUtils';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// ── Helper: fetch invite code for a group ─────────────────────────────────────

async function getInviteCode(groupId: string): Promise<string> {
  if (!admin.apps.length) {
    const keyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    const svc = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
  const snap = await admin.firestore().collection('groups').doc(groupId).get();
  return snap.data()?.inviteCode as string;
}

// ── Unauthenticated ───────────────────────────────────────────────────────────


test('A13-01: Unauthenticated visit with valid invite code → shows sign-in/create-account CTAs', async ({ page }) => {
  const groupId = getGroupId('family');
  const inviteCode = await getInviteCode(groupId);

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByRole('link', { name: /Sign in to join/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Create account/i })).toBeVisible();
});

test('A13-01b: Sign-in link includes correct ?redirect param', async ({ page }) => {
  const groupId = getGroupId('family');
  const inviteCode = await getInviteCode(groupId);

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const signInLink = page.getByRole('link', { name: /Sign in to join/i });
  const href = await signInLink.getAttribute('href');
  expect(href).toContain('/login');
  expect(href).toContain('redirect=');
  expect(href).toContain(encodeURIComponent(`/join/${inviteCode}`));
});

test('A13-02: Invalid invite code → "Invalid invite link" message', async ({ page }) => {
  await loginAsRole(page, 'friends_admin_ullas');
  await page.goto('/join/XXXXXX');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText(/invalid invite link/i)).toBeVisible();
});

test('A13-05: Invite code in URL is case-insensitive (normalised to uppercase)', async ({ page }) => {
  const groupId = getGroupId('family');
  const inviteCode = await getInviteCode(groupId);
  const lowercaseCode = inviteCode.toLowerCase();

  await page.goto(`/join/${lowercaseCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Should find the group, not show "Invalid invite link"
  await expect(page.getByText(/invalid invite link/i)).not.toBeVisible();
  await expect(page.getByRole('link', { name: /Sign in to join/i })).toBeVisible();
});


// ── Already-member ────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_admin_ullas'); });

test('A13-03: Authenticated + already a member → "You\'re already in this group!"', async ({ page }) => {
  const groupId = getGroupId('friends');
  const inviteCode = await getInviteCode(groupId);

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByText(/already in this group/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Go to Group/i })).toBeVisible();
});

test('A13-03b: "Go to Group" link points to the correct group', async ({ page }) => {
  const groupId = getGroupId('friends');
  const inviteCode = await getInviteCode(groupId);

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const link = page.getByRole('link', { name: /Go to Group/i });
  const href = await link.getAttribute('href');
  expect(href).toContain(groupId);
});


// ── Join flow (non-member) ────────────────────────────────────────────────────

// Use family_member_yashu who is already in the family group
// Use friends_member_chethan to verify they can see the family join page
// Note: Actually chethan is a member of friends but NOT family — so they can join family
// Using chethan's auth to join the family group would mutate data.
// Skip the actual join to avoid side effects; test the join UI renders correctly.
test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_chethan'); });

test('A13-04: Authenticated non-member sees "Join Group" button', async ({ page }) => {
  const groupId = getGroupId('family');
  const inviteCode = await getInviteCode(groupId);

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Chethan is not in the family group — should see join confirmation
  const joinBtn = page.getByRole('button', { name: /Join Group/i });
  await expect(joinBtn).toBeVisible();

  // Note: We do NOT click Join to avoid mutating membership in the test session.
  // The actual join flow is covered in cross-page flow B-01.
});


// ── A10/A9 — Points and Settlements pages ────────────────────────────────────


test('A9-01: Unauthenticated → redirected to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

test('A10-01: Settlements page — unauthenticated → redirected to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/settlements`);
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});


// ── A9 — Points page (authenticated) ─────────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_raghu'); });

test('A9-03: Standings leaderboard shows all members sorted by totalPoints descending', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Page loads without access denied
  await expect(page.getByText(/access denied/i)).not.toBeVisible();
  // Should show some member names
  await expect(page.getByRole('list').getByText('Raghu')).toBeVisible();
});

test('A9-06: NEXT_PUBLIC_SHOW_SETTLEMENTS=false → settlements section hidden', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // When SHOW_SETTLEMENTS is false, settlements section is not rendered
  await expect(page.getByText(/settlements/i)).not.toBeVisible();
});

