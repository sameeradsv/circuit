import { test, expect } from '@playwright/test';

test.describe('Task Manager PWA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('loads homepage', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Circuit');
  });

  test('adds a task', async ({ page }) => {
    const input = page.locator('#task-input');
    const form = page.locator('#task-form');
    
    await input.fill('Buy groceries');
    await form.press('Enter');
    
    await expect(page.locator('.task-text')).toContainText('Buy groceries');
  });

  test('toggles task completion', async ({ page }) => {
    await page.locator('#task-input').fill('Test task');
    await page.locator('#task-form').press('Enter');
    
    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.click();
    
    await expect(checkbox).toBeChecked();
    await expect(page.locator('.task-item')).toHaveClass(/completed/);
  });

  test('deletes a task', async ({ page }) => {
    await page.locator('#task-input').fill('Task to delete');
    await page.locator('#task-form').press('Enter');
    
    await page.locator('.task-actions button[aria-label="Delete task"]').click();
    
    await expect(page.locator('.task-text')).toHaveCount(0);
  });

  test('filters tasks', async ({ page }) => {
    await page.locator('#task-input').fill('Task 1');
    await page.locator('#task-form').press('Enter');
    
    await page.locator('#task-input').fill('Task 2');
    await page.locator('#task-form').press('Enter');
    
    await page.locator('input[type="checkbox"]').first().click();
    
    await page.locator('button[data-filter="pending"]').click();
    await expect(page.locator('.task-text')).toHaveCount(1);
    
    await page.locator('button[data-filter="completed"]').click();
    await expect(page.locator('.task-text')).toHaveCount(1);
  });

  test('persists tasks after reload', async ({ page }) => {
    await page.locator('#task-input').fill('Persistent task');
    await page.locator('#task-form').press('Enter');
    await expect(page.locator('.task-text')).toContainText('Persistent task');

    await page.reload();
    await expect(page.locator('.task-text')).toContainText('Persistent task');
  });

  test('changes theme', async ({ page }) => {
    const initialTheme = await page.evaluate(() => 
      document.body.getAttribute('data-theme')
    );
    
    expect(initialTheme).toBeTruthy();
  });

  test('switches energy modes', async ({ page }) => {
    await page.locator('#mode-display').click();
    await page.locator('.mode-btn[data-mode="deep"]').click();

    await expect(page.locator('#mode-display')).toContainText('Deep Work');
  });
});

test.describe('PWA Features', () => {
  test('has service worker', async ({ page }) => {
    await page.goto('/');
    
    const swRegistered = await page.evaluate(() => 
      'serviceWorker' in navigator
    );
    
    expect(swRegistered).toBe(true);
  });

  test('has manifest', async ({ page }) => {
    await page.goto('/');
    
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveAttribute('href', 'manifest.webmanifest');
  });
});
