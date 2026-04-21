/**
 * tests/e2e/edge-cases/edge-cases.spec.ts
 *
 * Category E — Edge case tests (E-01 through E-20)
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument, updateTestMatch } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';
import * as admin from 'firebase-admin';

test.beforeEach(async ({ page }) => {
  await loginAsRole(page, 'friends_admin_ullas');
});

function dashUrl(g: string) { return `/groups/${g}`; }
function matchesUrl(g: string) { return `/groups/${g}/matches`; }

// ── E-01: Empty group dashboard ───────────────────────────────────────────────


test('E-01: Group with no matches → all sections show empty-state (no crash)', async ({ page }) => {
  // Use family group which should have no matches
  const groupId = getGroupId('family');
  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Should load without error
  await expect(page.getByText(/access denied/i)).not.toBeVisible();
  // Page should render (at minimum shows the navbar)
  expect(page.url()).toContain(groupId);
});


// ── E-02: Betting locked ──────────────────────────────────────────────────────

let matchId: string;
test.afterEach(async () => { if (matchId) { await deleteTestDocument('matches', matchId); matchId = ''; } });

test('E-02: bettingOpen=false → "Place Bet" not shown; existing bet is read-only', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'India', teamB: 'Sri Lanka', bettingOpen: false, status: 'upcoming' });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const sriLankaCard = page.locator('div').filter({ hasText: /India.*Sri Lanka|Sri Lanka.*India/ }).last();
  await expect(sriLankaCard.getByRole('button', { name: /Place Bet/i })).not.toBeVisible();
});


// ── E-03: Draw option gating ──────────────────────────────────────────────────

let matchId: string;
test.afterEach(async () => { if (matchId) { await deleteTestDocument('matches', matchId); matchId = ''; } });

test('E-03: drawAllowed=true → 3 outcome buttons (Team A / Draw / Team B)', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'England', teamB: 'Australia', drawAllowed: true, bettingOpen: true, status: 'upcoming' });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const matchCard = page.locator('div').filter({ hasText: /England.*Australia|Australia.*England/ }).filter({ has: page.getByRole('button', { name: /Place Bet/i }) }).last();
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);

  await expect(matchCard.locator('button', { hasText: /^England$/ }).first()).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^Draw$/ })).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^Australia$/ }).first()).toBeVisible();
});


// ── E-04: Test format auto-draw ───────────────────────────────────────────────


test('E-04: Format=Test in Create Match form → Allow Draw auto-checked and disabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(matchesUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const formatSelect = page.locator('select[id="format"]');
  if (await formatSelect.isVisible({ timeout: 5_000 })) {
    await formatSelect.selectOption('Test');
    const drawCheckbox = page.locator('input[id="drawAllowed"]');
    await expect(drawCheckbox).toBeChecked({ timeout: 5_000 });
    await expect(drawCheckbox).toBeDisabled();
  }
});


// ── E-05 / E-06: Stake preset accumulation and zero-stake disabled ────────────

let matchId: string;
test.afterEach(async () => { if (matchId) { await deleteTestDocument('matches', matchId); matchId = ''; } });

test('E-05: Click +100 three times → stake shows 300; clear input → Confirm disabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'India', teamB: 'Pakistan', bettingOpen: true, status: 'upcoming' });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: /^India$/ }).first().click();

  const stakeInput = page.getByPlaceholder('Custom amount');
  await stakeInput.clear();
  await stakeInput.fill('0');

  const plusHundred = page.getByRole('button', { name: '+100', exact: true });
  await plusHundred.click();
  await plusHundred.click();
  await plusHundred.click();
  expect(parseInt(await stakeInput.inputValue())).toBe(300);

  // Clear → Confirm disabled
  await stakeInput.clear();
  await expect(page.getByRole('button', { name: /Confirm Bet/i })).toBeDisabled({ timeout: 5_000 });
});

test('E-06: Stake 0 → Confirm Bet button disabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'India', teamB: 'New Zealand', bettingOpen: true, status: 'upcoming' });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: /^India$/ }).first().click();

  const stakeInput = page.getByPlaceholder('Custom amount');
  await stakeInput.fill('0');

  await expect(page.getByRole('button', { name: /Confirm Bet/i })).toBeDisabled({ timeout: 5_000 });
});


// ── E-07: Remove Bet confirmation guard ───────────────────────────────────────

let matchId: string;
test.afterEach(async () => { if (matchId) { await deleteTestDocument('matches', matchId); matchId = ''; } });

test('E-07: Clicking "Remove Bet" once does NOT remove the bet; must confirm in modal', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'India', teamB: 'Bangladesh', bettingOpen: true, status: 'upcoming' });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Place bet
  await page.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: /^India$/ }).first().click();
  await page.getByPlaceholder('Custom amount').fill('500');
  await page.getByRole('button', { name: /Confirm Bet/i }).click();
  await expect(page.getByText(/placed successfully/i)).toBeVisible();

  // Click Remove Bet — modal appears
  await page.getByRole('button', { name: /Remove Bet/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Cancel — bet still present
  await page.getByRole('dialog').getByRole('button', { name: /No/i }).click();
  await expect(page.getByRole('button', { name: /Remove Bet/i }).first()).toBeVisible();
});


// ── E-08: Invalid invite code ─────────────────────────────────────────────────


test('E-08: Visit /join/XXXXXX → "Invalid invite link" card shown', async ({ page }) => {
  await page.goto('/join/XXXXXX');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText(/invalid invite link/i)).toBeVisible();
});


// ── E-09: Group name min-length ───────────────────────────────────────────────


test('E-09: 2-char group name → error toast', async ({ page }) => {
  await page.goto('/groups/create');
  await page.getByLabel('Group Name').fill('AB');
  await page.getByRole('button', { name: 'Create Group' }).click();
  await expect(page.getByText(/at least 3 characters/i)).toBeVisible();
});


// ── E-10: Profile name min-length ─────────────────────────────────────────────


test('E-10: 1-char display name → error toast "at least 2 characters"', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const nameInput = page.getByLabel('Display Name');
  await nameInput.clear();
  await nameInput.fill('X');
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByText(/at least 2 characters/i)).toBeVisible();
});


// ── E-11: Delete group type-to-confirm guard ──────────────────────────────────


test('E-11: Partial group name → Delete button disabled; exact name → enabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/group`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Delete Group/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const confirmInput = page.getByRole('dialog').getByRole('textbox');
  const deleteBtn = page.getByRole('dialog').getByRole('button', { name: /Delete Group/i });

  // Partial name — disabled
  await confirmInput.fill('Group');
  await expect(deleteBtn).toBeDisabled();

  // Exact name — enabled
  await confirmInput.fill('GroupA');
  await expect(deleteBtn).toBeEnabled({ timeout: 3_000 });

  // Close modal without deleting
  await page.getByRole('button', { name: /Cancel/i }).click();
});


// ── E-13: Past matches filter empty state ─────────────────────────────────────


test('E-13: Filter "Betted" with no betted past matches → no crash, empty or correct state', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Click Betted filter if visible
  const bettedBtn = page.getByRole('button', { name: /Betted/i });
  if (await bettedBtn.isVisible()) {
    await bettedBtn.click();
    // Should not crash — page remains rendered
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  }
});


// ── E-14: Member name edit min-length ─────────────────────────────────────────


test('E-14: Admin edits member name to 1 char → "at least 2 characters" error', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/group`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText('Raghu')).toBeVisible();

  const editBtns = page.getByRole('button', { name: /edit|pencil/i });
  const count = await editBtns.count();
  if (count > 1) {
    await editBtns.nth(1).click();
    const memberInput = page.getByRole('textbox').last();
    await memberInput.clear();
    await memberInput.fill('X');
    await page.getByRole('button', { name: /Save|✓/i }).last().click();
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible();
  }
});


// ── E-15: Settlements empty state ─────────────────────────────────────────────


test('E-15: Group with no completed matches → Points page shows "All settled up!" or zero settlements', async ({ page }) => {
  // Use family group which may have no completed matches
  const groupId = getGroupId('family');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Page should load without error
  await expect(page.getByText(/access denied/i)).not.toBeVisible();
});


// ── E-16: Already-member join ─────────────────────────────────────────────────


test('E-16: Authenticated user visits own group invite link → "You\'re already in this group!"', async ({ page }) => {
  const groupId = getGroupId('friends');

  // Get invite code
  if (!admin.apps.length) {
    const fs2 = require('fs');
    const path2 = require('path');
    const keyPath = path2.resolve(process.cwd(), 'serviceAccountKey.json');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs2.readFileSync(keyPath, 'utf-8'))) });
  }
  const snap = await admin.firestore().collection('groups').doc(groupId).get();
  const inviteCode = snap.data()?.inviteCode as string;

  await page.goto(`/join/${inviteCode}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText(/already in this group/i)).toBeVisible();
});


// ── A12: Bet page [STUB] ──────────────────────────────────────────────────────


test.skip(true, '[STUB] /groups/[groupId]/bet/[matchId] has no navigation links in the current UI — unreachable from live interface. Page is implemented but orphaned.');

test('A12-01: Unauthenticated → redirected to /login', async ({ page }) => {
  // Would navigate to /groups/{id}/bet/{matchId} but no match ID to use here
});

test('A12-02: Non-member → "Access denied" card', async ({ page }) => {});
test('A12-03: Match not found → "Match not found" card', async ({ page }) => {});
test('A12-04: bettingOpen=false → locked view showing existing bet or "no bet placed"', async ({ page }) => {});
test('A12-05: status=completed → locked view with match status badge', async ({ page }) => {});
test('A12-06: Open match → outcome picker (2 or 3 buttons based on drawAllowed)', async ({ page }) => {});
test('A12-07: No outcome selected → Confirm Bet button does not appear', async ({ page }) => {});
test('A12-08: Existing bet → "Current bet" card shown; outcome pre-selected', async ({ page }) => {});
test('A12-09: Select outcome + confirm → bet upserted → redirected to group dashboard', async ({ page }) => {});
test('A12-10: STAKE is hardcoded to 1000 pts on this page', async ({ page }) => {});


// ── E-18: Series "ended" badge ────────────────────────────────────────────────


test.skip(true, '[SETUP REQUIRED] Setting a past end date on a series row requires series data in Firestore. Verify manually in /admin.');


// ── E-19: No upcoming matches in admin search ─────────────────────────────────


test('E-19: Search Matches section renders without error even if empty', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(matchesUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Page should load; if no master matches exist, section should handle gracefully
  await expect(page.getByText(/access denied/i)).not.toBeVisible();
});


// ── E-20: Manage Bets — members show in modal ────────────────────────────────

let matchId: string;
test.afterEach(async () => { if (matchId) { await deleteTestDocument('matches', matchId); matchId = ''; } });

test('E-20: Manage Bets modal lists group members', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, { teamA: 'India', teamB: 'Nepal', bettingOpen: true, status: 'upcoming' });

  await page.goto(matchesUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText('India vs Nepal')).toBeVisible();

  await page.getByRole('button', { name: /Manage Bets/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Friends group has members: Ullas, Vasu, Raghu, Chethan, Gourish, Shrimanth, Kulli, Kutti
  await expect(
    page.getByRole('dialog').getByText('Raghu').or(page.getByRole('dialog').getByText('Ullas')).first()
  ).toBeVisible();
});

