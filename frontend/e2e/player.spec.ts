import { expect, test } from '@playwright/test';

test.describe('player', () => {
  test('loads the demo session and plays it back', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByText('CodeCinema').first()).toBeVisible();
    await expect(page.getByText('Explorer')).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        async () =>
          (await page.locator('.monaco-editor .view-lines').first().innerText())
            .length,
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);

    await expect(page.getByRole('slider', { name: 'Session timeline' })).toBeVisible();

    await page.getByRole('button', { name: 'Pause' }).first().click();
    await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();
  });

  test('seeking to the end shows the finished, fixed file', async ({ page }) => {
    await page.goto('/demo#t=9999999');
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);
    const editorText = await page
      .locator('.monaco-editor .view-lines')
      .first()
      .innerText();
    expect(editorText).toContain('parseTaskInput');
  });

  test('the project explorer lists files as they are created', async ({ page }) => {
    await page.goto('/demo');
    const explorer = page
      .getByTestId('project-explorer')
      .getByText('package.json')
      .first();
    await expect(explorer).toBeVisible({ timeout: 45_000 });
  });
});
