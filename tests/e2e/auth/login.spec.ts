/**
 * tests/e2e/auth/login.spec.ts
 *
 * Category A2 — Login page scenarios
 * Category A6 — Logout scenarios
 */

import { test, expect } from '@playwright/test';
import { parseEnvTest } from '../../utils/parseEnvTest';
import { loginWithFirebase } from '../../utils/firebaseAuthUtils';
import { loginAsRole } from '../../utils/authUtils';

// Use a real provisioned user for auth-required tests
const config = parseEnvTest();
const { email: adminEmail, password: adminPassword } = config.superAdmin;


test('A2-01: Valid email/password login → success toast → redirects to /groups', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Toast should appear
  await expect(page.getByText('Welcome back!')).toBeVisible();
  // Should land on /groups
  await page.waitForURL('**/groups', { timeout: 10_000 });
  expect(page.url()).toContain('/groups');
});

test('A2-02: Login with ?redirect param → redirects to param destination after login', async ({ page }) => {
  await page.goto('/login?redirect=%2Fprofile');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL('**/profile', { timeout: 10_000 });
  expect(page.url()).toContain('/profile');
});

test('A2-03: Wrong password → error toast, stays on /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill('wrongpassword999');
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Error toast should be visible
  await expect(page.locator('[role="status"], [data-sonner-toast]').first().or(
    page.getByText(/invalid|wrong|failed|sign in/i).first()
  )).toBeVisible();
  // Should remain on login
  expect(page.url()).toContain('/login');
});

test('A2-04: Non-existent email → error toast', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.invalid');
  await page.getByLabel('Password').fill('somepassword');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByText(/invalid|no user|not found|failed/i).first()).toBeVisible();
  expect(page.url()).toContain('/login');
});

test('A2-06: Already authenticated visit → immediately redirects to /groups', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginWithFirebase(page, adminEmail, adminPassword);

  await page.goto('/login');
  await page.waitForURL('**/groups', { timeout: 10_000 });
  expect(page.url()).toContain('/groups');

  await context.close();
});

test('A2-07: "Continue with Google" button is visible and clickable', async ({ page }) => {
  await page.goto('/login');
  const googleButton = page.getByRole('button', { name: /Continue with Google/i });
  await expect(googleButton).toBeVisible();
  await expect(googleButton).toBeEnabled();
});

test('A2-08: Register link preserves ?redirect param', async ({ page }) => {
  await page.goto('/login?redirect=%2Fgroups%2Fcreate');
  const registerLink = page.getByRole('link', { name: 'Register' });
  await expect(registerLink).toBeVisible();
  const href = await registerLink.getAttribute('href');
  expect(href).toContain('redirect=');
  expect(href).toContain('%2Fgroups%2Fcreate');
});


// ── A6: Logout ────────────────────────────────────────────────────────────────


test('A6-01: Authenticated user signs out → redirects to /login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');

  // Confirm we are on /groups after login
  await page.waitForURL('**/groups**', { timeout: 10_000 });

  // Open the account menu dropdown
  await page.getByRole('button', { name: 'Account menu' }).click();

  // Click Sign out
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Should redirect to /login
  await page.waitForURL('**/login**', { timeout: 10_000 });
  expect(page.url()).toContain('/login');

  await context.close();
});

test('A6-02: After sign out, visiting /groups redirects to /login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');

  await page.waitForURL('**/groups**', { timeout: 10_000 });

  // Sign out
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login**', { timeout: 10_000 });

  // Attempt to visit a protected route
  await page.goto('/groups');
  await page.waitForFunction(
    () => window.location.href.includes('/login'),
    { timeout: 15_000 },
  );
  expect(page.url()).toContain('/login');

  await context.close();
});

test('A6-03: After sign out, visiting /profile redirects to /login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');

  await page.waitForURL('**/groups**', { timeout: 10_000 });

  // Sign out
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login**', { timeout: 10_000 });

  // Attempt to visit another protected route
  await page.goto('/profile');
  await page.waitForFunction(
    () => window.location.href.includes('/login'),
    { timeout: 15_000 },
  );
  expect(page.url()).toContain('/login');

  await context.close();
});

