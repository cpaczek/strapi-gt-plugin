import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { assertAccessible } from './accessibility';

const selector = 'section[aria-label="General Translation controls"]';
const controls =
  '<section aria-label="General Translation controls"><button>Translate</button></section>';
const loadPage = async (page: Page, body: string) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>Accessibility scope</title></head><body><main><h1>Translation</h1>${body}</main></body></html>`
  );
};

for (const initiallyHidden of [false, true]) {
  test(`the requested scope is visible before Axe starts when hidden=${initiallyHidden}`, async ({
    page,
  }) => {
    await loadPage(page, initiallyHidden ? controls.replace('<section ', '<section hidden ') : '');
    const original = AxeBuilder.prototype.analyze;
    AxeBuilder.prototype.analyze = async function () {
      // Observe readiness at the scan boundary, then retain the complete real Axe scan.
      expect(await page.locator(selector).isVisible()).toBe(true);
      return original.call(this);
    };
    try {
      const audited = assertAccessible(page, selector).then(
        () => ({ ok: true as const }),
        (failure: unknown) => ({ ok: false as const, failure })
      );
      await page.evaluate(
        ({ markup, hidden }) => {
          if (hidden) document.querySelector('section')?.removeAttribute('hidden');
          else document.querySelector('main')?.insertAdjacentHTML('beforeend', markup);
        },
        { markup: controls, hidden: initiallyHidden }
      );
      const result = await audited;
      if (!result.ok) throw result.failure;
    } finally {
      AxeBuilder.prototype.analyze = original;
    }
  });
}

test('an already visible scope is audited', async ({ page }) => {
  await loadPage(page, controls);
  await assertAccessible(page, selector);
});

test('a persistently missing scope fails instead of skipping its audit', async ({ page }) => {
  await loadPage(page, '<p>The native form is ready.</p>');
  await expect(assertAccessible(page, selector)).rejects.toThrow();
});

test('a persistently hidden scope fails instead of passing an empty audit', async ({ page }) => {
  await loadPage(page, controls.replace('<section ', '<section hidden '));
  await expect(assertAccessible(page, selector)).rejects.toThrow();
});
