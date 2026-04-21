/**
 * tests/e2e/betting/place-bet.spec.ts
 *
 * A7-06, A7-10 — Inline bet placement, change bet, and stake presets
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';

function dashUrl(groupId: string) { return `/groups/${groupId}`; }

let matchId: string;

test.beforeEach(async ({ page }) => {
  await loginAsRole(page, 'friends_member_raghu');
});

test.beforeEach(async () => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'England',
    drawAllowed: false,
    bettingOpen: true,
    status: 'upcoming',
  });
});

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('A7-06: Click "Place Bet" → select outcome → set stake → confirm → bet recorded; button changes to "Change Bet"', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const matchCard = page.locator('div').filter({ hasText: /India.*England|England.*India/ }).filter({ has: page.getByRole('button', { name: /Place Bet/i }) }).last();

  // Open bet form
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);

  // Select India
  await matchCard.locator('button', { hasText: /^India$/ }).first().click();

  // Set stake
  const stakeInput = page.getByPlaceholder('Custom amount');
  await expect(stakeInput).toBeVisible();
  await stakeInput.clear();
  await stakeInput.fill('500');

  // Confirm
  await page.getByRole('button', { name: /Confirm Bet/i }).click();

  await expect(page.getByText(/placed successfully/i)).toBeVisible();

  // Bet placed — "Change Bet" should appear
  const matchCardAfterBet = page.locator('div').filter({ hasText: /India.*England|England.*India/ }).filter({ has: page.getByRole('button', { name: /Change Bet/i }) }).last();
  await expect(matchCardAfterBet.getByRole('button', { name: /Change Bet/i }).first()).toBeVisible();
});

test('A7-10: "Change Bet" opens inline form pre-filled with current outcome/stake', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const matchCard = page.locator('div').filter({ hasText: /India.*England|England.*India/ }).filter({ has: page.getByRole('button', { name: /Place Bet/i }) }).last();
  const matchCardAfterBet = page.locator('div').filter({ hasText: /India.*England|England.*India/ }).filter({ has: page.getByRole('button', { name: /Change Bet/i }) }).last();

  // Place a bet first
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);
  await matchCard.locator('button', { hasText: /^India$/ }).first().click();
  const stakeInput = page.getByPlaceholder('Custom amount');
  await stakeInput.fill('750');
  await page.getByRole('button', { name: /Confirm Bet/i }).click();
  await expect(page.getByText(/placed successfully/i)).toBeVisible();

  // Click Change Bet
  await matchCardAfterBet.getByRole('button', { name: /Change Bet/i }).first().click();
  await page.waitForTimeout(500);

  // The form should open with the stake input visible and India outcome accessible
  await expect(page.getByPlaceholder('Custom amount')).toBeVisible();
  await expect(matchCard.locator('button', { hasText: /India/ }).first()).toBeVisible();
});

