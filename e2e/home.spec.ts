import { test, expect } from '@playwright/test';

test('home page lists seeded books', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Bookshelf' })).toBeVisible();
  await expect(page.locator('.book-card', { hasText: 'The Pragmatic Programmer' })).toBeVisible();
});

test('search filters the book list via htmx', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('Search books by title or author...').fill('Pragmatic');
  await expect(page.locator('.book-card', { hasText: 'The Pragmatic Programmer' })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(1);
});
