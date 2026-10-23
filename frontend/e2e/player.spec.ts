import { expect, test } from '@playwright/test';

test.describe('player', () => {
  test('loads the demo session and renders the player chrome', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByText('CodeCinema').first()).toBeVisible();
    await expect(page.getByText('Explorer')).toBeVisible();
    await expect(page.getByText('Terminal')).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('slider', { name: 'Session timeline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
  });

  test('seeking to the end keeps the player interactive', async ({ page }) => {
    await page.goto('/demo#t=9999999');
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('CodeCinema').first()).toBeVisible();
  });

  test('the project explorer renders', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByTestId('project-explorer')).toBeVisible({
      timeout: 60_000,
    });
  });
});
