import { expect, test } from '@playwright/test';

/**
 * Smoke test for the player.
 *
 * This is the test that catches the class of bug unit tests cannot: the
 * engine advancing the clock, the Monaco binding applying edits, the terminal
 * streaming and the layout all working together in a real browser.
 */
test.describe('player', () => {
  test('loads the demo session and plays it back', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/demo');

    // The player chrome is present.
    await expect(page.getByText('CodeCinema').first()).toBeVisible();
    await expect(page.getByText('Explorer')).toBeVisible();
    await expect(page.getByText('Terminal')).toBeVisible();

    // Monaco mounted.
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 30_000,
    });

    // The demo auto-plays. Wait for the agent to actually start writing —
    // Monaco's first paint can delay the clock, so poll rather than guess.
    await expect
      .poll(
        async () =>
          (await page.locator('.monaco-editor .view-lines').first().innerText())
            .length,
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);

    // The scrubber exists and the timeline is populated.
    await expect(page.getByRole('slider', { name: 'Session timeline' })).toBeVisible();

    // Pause works.
    await page.getByRole('button', { name: 'Pause' }).first().click();
    await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();

    // No hard errors in the console.
    const fatal = consoleErrors.filter(
      (message) => !message.includes('favicon') && !message.includes('404'),
    );
    expect(fatal).toEqual([]);
  });

  test('seeking to the end shows the finished, fixed file', async ({ page }) => {
    // `#t=` is the shareable position marker; it is read on load.
    await page.goto('/demo#t=9999999');
    await expect(page.locator('.monaco-editor').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);

    const editorText = await page
      .locator('.monaco-editor .view-lines')
      .first()
      .innerText();

    // The last file the agent opened is test/validate.test.ts, and by the
    // end of the session its assertion has been rewritten.
    expect(editorText).toContain('parseTaskInput');
  });

  test('the project explorer lists files as they are created', async ({
    page,
  }) => {
    await page.goto('/demo');
    await expect(page.getByText('Explorer')).toBeVisible();

    // The demo session creates package.json early on. Scope the locator to
    // the explorer — the timeline also mentions the file name.
    const explorer = page
      .getByTestId('project-explorer')
      .getByText('package.json')
      .first();
    await expect(explorer).toBeVisible({ timeout: 45_000 });
  });
});
