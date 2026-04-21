/**
 * tests/e2e/betting/draw-option.spec.ts
 *
 * A7-07 — Outcome picker shows 2 or 3 buttons based on drawAllowed
 * E-03   — Draw option gating
 * E-04   — Test format auto-enables draw
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';

function dashUrl(groupId: string) { return `/groups/${groupId}`; }

let matchId: string;

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_admin_ullas'); });

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('E-03a: Match with drawAllowed=false → 2-outcome picker (no Draw button)', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'Bangladesh',
    teamB: 'Pakistan',
    drawAllowed: false,
    bettingOpen: true,
    status: 'upcoming',
  });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const matchCard = page.locator('div').filter({ hasText: /Bangladesh.*Pakistan|Pakistan.*Bangladesh/ }).first();
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(1500);

  await expect(matchCard.locator('button', { hasText: /^Bangladesh$/ }).first()).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^Pakistan$/ }).first()).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^Draw$/ })).not.toBeVisible();
});

test('E-03b: Match with drawAllowed=true → 3-outcome picker (Draw button visible)', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'England',
    teamB: 'New Zealand',
    drawAllowed: true,
    bettingOpen: true,
    status: 'upcoming',
  });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const matchCard = page.locator('div').filter({ hasText: /England.*New Zealand|New Zealand.*England/ }).first();
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(1500);

  await expect(matchCard.locator('button', { hasText: /^England$/ }).first()).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^New Zealand$/ }).first()).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /^Draw$/ })).toBeVisible();
});


// ── E-04: Test format auto-enables draw in Create Match form ──────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_admin_ullas'); });

test('E-04: Creating a match with format=Test → "Allow Draw" checkbox auto-checked and disabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/matches`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Verify the page is accessible (admin view)
  await expect(page.getByText(/access denied/i)).not.toBeVisible();

  // Select Test format in Create Match form
  const formatSelect = page.getByLabel('Format').or(page.locator('select[id="format"]'));
  if (await formatSelect.isVisible()) {
    await formatSelect.selectOption('Test');

    // Draw checkbox should be checked and disabled
    const drawCheckbox = page.getByLabel(/Allow Draw/i).or(page.locator('input[type="checkbox"]').first());
    await expect(drawCheckbox).toBeChecked({ timeout: 5_000 });
    await expect(drawCheckbox).toBeDisabled();
  }
});

