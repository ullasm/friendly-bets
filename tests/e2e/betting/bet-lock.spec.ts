/**
 * tests/e2e/betting/bet-lock.spec.ts
 *
 * E-02 — Betting locked after match starts / bettingOpen=false
 * A7-05 — "Place Bet" not shown when betting is closed
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';
import * as admin from 'firebase-admin';

function dashUrl(groupId: string) { return `/groups/${groupId}`; }

let matchId: string;

test.beforeEach(async ({ page }) => {
  await loginAsRole(page, 'friends_member_raghu');
});

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('E-02: bettingOpen=false → "Place Bet" button not shown', async ({ page }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Sri Lanka',
    drawAllowed: false,
    bettingOpen: false,
    status: 'upcoming',
  });

  // Reload to ensure fresh data from Firestore
  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Scope to the specific match card to avoid collisions with parallel tests
  const matchCard = page.locator('div').filter({ hasText: /India.*Sri Lanka|Sri Lanka.*India/ }).first();
  // The match should show in upcoming section but without a Place Bet button
  await expect(matchCard.getByText(/India.*Sri Lanka/)).toBeVisible();
  await expect(matchCard.getByRole('button', { name: /Place Bet/i })).not.toBeVisible();
});

test('E-02b: Betting locked match — existing bet is read-only, Change Bet hidden', async ({ page }) => {
  const groupId = getGroupId('friends');

  // Create match with betting open, place a bet, then close betting
  matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'New Zealand',
    drawAllowed: false,
    bettingOpen: true,
    status: 'upcoming',
  });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Scope to the specific match card to avoid collisions with parallel tests
  const matchCard = page.locator('div').filter({ hasText: /India.*New Zealand|New Zealand.*India/ }).filter({ has: page.getByRole('button', { name: /Place Bet/i }) }).last();
  await matchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await page.waitForTimeout(500);
  await matchCard.locator('button', { hasText: /^India$/ }).first().click();
  await page.getByPlaceholder('Custom amount').fill('200');
  await page.getByRole('button', { name: /Confirm Bet/i }).click();
  await expect(page.getByText(/placed successfully/i)).toBeVisible();

  // Close betting via Admin SDK
  await admin.firestore().collection('matches').doc(matchId).update({
    bettingOpen: false,
    bettingClosedAt: admin.firestore.Timestamp.now(),
  });

  // Reload the page
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Change Bet and Remove Bet should no longer appear
  await expect(page.getByRole('button', { name: /Change Bet/i })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Remove Bet/i })).not.toBeVisible();
});

test('A7-18: Match auto-closes betting when matchDate has passed (bettingOpen=false)', async ({ page }) => {
  const groupId = getGroupId('friends');
  // Create a match in the past with bettingOpen=false (simulating auto-close)
  matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'West Indies',
    drawAllowed: false,
    bettingOpen: false,
    status: 'upcoming',
    matchDate: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 60 * 60 * 1000) // 1 hour in the past
    ),
  });

  await page.goto(dashUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Bet button should not be shown
  await expect(page.getByRole('button', { name: /Place Bet/i })).not.toBeVisible();
});

