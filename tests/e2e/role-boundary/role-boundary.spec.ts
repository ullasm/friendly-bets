/**
 * tests/e2e/role-boundary/role-boundary.spec.ts
 *
 * Category C — Role-boundary access control tests (C-01 through C-11)
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';

// ── C-01: Member → /matches access denied ────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_kutti'); });

test('C-01: Member → /groups/[groupId]/matches → "Access denied" card', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/matches`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(/access denied/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to Group/i })).toBeVisible();
});


// ── C-02: Non-member → any group sub-route access denied ─────────────────────

// SuperAdmin is NOT a member of the friends group
test.beforeEach(async ({ page }) => { await loginAsRole(page, 'superAdmin'); });

test('C-02a: Non-member → /groups/[groupId] → access denied', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(/access denied/i)).toBeVisible();
});

test('C-02b: Non-member → /groups/[groupId]/points → access denied', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(/access denied/i)).toBeVisible();
});

test('C-11: SuperAdmin who is NOT a group member → group manage page shows no admin controls', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/group`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // SuperAdmin is not a group member so isAdmin=false — read-only view, no Danger Zone
  await expect(page.getByText(/Danger Zone/i)).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Delete Group/i })).not.toBeVisible();
});


// ── C-03: Non-superAdmin → /admin redirected ─────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_raghu'); });

test('C-03: Non-superAdmin navigates to /admin → redirected to /groups', async ({ page }) => {
  await page.goto('/admin');
  await page.waitForURL('**/groups**', { timeout: 10_000 });
  expect(page.url()).toContain('/groups');
});


// ── C-04: Member vs Admin — Matches tab visibility ────────────────────────────


test('C-04a: Member does NOT see "Matches" tab in group navbar', async ({ browser }) => {
  const groupId = getGroupId('friends');
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_member_kulli');
  await page.goto(`/groups/${groupId}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: 'Matches' })).not.toBeVisible();
  await context.close();
});

test('C-04b: Group admin DOES see "Matches" tab in group navbar', async ({ browser }) => {
  const groupId = getGroupId('friends');
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');
  await page.goto(`/groups/${groupId}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: 'Matches' })).toBeVisible();
  await context.close();
});


// ── C-05: SuperAdmin sees "Admin" link; non-admin does not ───────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_raghu'); });

test('C-05a: Member account dropdown does NOT show "Admin" link', async ({ page }) => {
  // Navigate and check navbar — Admin link must not appear
  await page.goto('/groups');
  await page.waitForLoadState('domcontentloaded');
  // The Admin link is in the user dropdown — open it
  await expect(page.getByRole('link', { name: /^Admin$/i })).not.toBeVisible();
});


// ── C-06: Member on Group page — no edit controls ────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_kutti'); });

test('C-06: Member sees no pencil icon, no Regenerate Link, no member actions, no Danger Zone', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/group`);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('button', { name: /Regenerate/i })).not.toBeVisible();
  await expect(page.getByText(/Danger Zone/i)).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Delete Group/i })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Make Admin/i })).not.toBeVisible();
});


// ── C-08: Member cannot place bet after bettingOpen=false ─────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_raghu'); });

let matchId: string;

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('C-08: Match with bettingOpen=false → no Place Bet button for member', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Zimbabwe',
    bettingOpen: false,
    status: 'upcoming',
  });

  await page.goto(`/groups/${groupId}`);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('button', { name: /Place Bet/i })).not.toBeVisible();
});

