import { test, expect } from '@playwright/test';

test('shelves page lists seeded users', async ({ page }) => {
  await page.goto('/shelves');

  await expect(page.getByRole('heading', { name: 'Shelves' })).toBeVisible();
  await expect(page.locator('.user-card', { hasText: 'alice' })).toBeVisible();
});

test('navigating to a user shows their shelves', async ({ page }) => {
  await page.goto('/shelves');

  await page.locator('.user-card', { hasText: 'alice' }).getByRole('link', { name: 'View shelves' }).click();

  await expect(page).toHaveURL(/\/shelves\/user\/\d+/);
});
