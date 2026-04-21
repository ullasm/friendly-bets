/**
 * tests/e2e/auth/register.spec.ts
 *
 * Category A3 — Register page scenarios
 */

import { test, expect } from '@playwright/test';
import { loginAsRole } from '../../utils/authUtils';


test('A3-01: Valid registration → account created → redirects to /groups', async ({ page }) => {
  // Skip: creating a real Firebase Auth account requires teardown logic
  // and will conflict with re-runs. Covered by manual testing instead.
  test.skip(true, 'Registration creates real Firebase Auth users; requires teardown not yet implemented in Phase 3');
});

test('A3-02: Password fewer than 6 characters → error toast "Password must be at least 6 characters"', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Display Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByLabel('Confirm Password').fill('abc');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByText('Password must be at least 6 characters')).toBeVisible();
});

test('A3-03: Passwords do not match → error toast "Passwords do not match"', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Display Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm Password').fill('differentpassword');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByText('Passwords do not match')).toBeVisible();
});

test('A3-04: Already authenticated visit → immediately redirects to /groups', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');

  await page.goto('/register');
  await page.waitForURL('**/groups', { timeout: 10_000 });
  expect(page.url()).toContain('/groups');

  await context.close();
});

test('A3-05: Google sign-in button is visible on register page', async ({ page }) => {
  // A3-05 tests Google OAuth which cannot be fully automated; verify button presence only
  await page.goto('/register');
  const googleButton = page.getByRole('button', { name: /Continue with Google/i });
  await expect(googleButton).toBeVisible();
  await expect(googleButton).toBeEnabled();
});

test('A3-06: "Sign in" link preserves ?redirect param', async ({ page }) => {
  await page.goto('/register?redirect=%2Fgroups%2Fcreate');
  const signInLink = page.getByRole('link', { name: 'Sign in' });
  await expect(signInLink).toBeVisible();
  const href = await signInLink.getAttribute('href');
  expect(href).toContain('redirect=');
  expect(href).toContain('%2Fgroups%2Fcreate');
});

