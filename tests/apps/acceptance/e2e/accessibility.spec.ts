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

test('a nested scope is audited after its surrounding editor is present', async ({ page }) => {
  await loadPage(page, `<article aria-label="Editor"><div>${controls}</div></article>`);
  await assertAccessible(page, selector);
});

test('a translated Arabic scope with quoted punctuation is audited', async ({ page }) => {
  const label = 'عناصر "General Translation"';
  await loadPage(page, controls);
  await page
    .locator('section')
    .evaluate((section, name) => section.setAttribute('aria-label', name), label);
  await assertAccessible(page, `section[aria-label=${JSON.stringify(label)}]`);
});

test('a visible dialog scope retains the full audit', async ({ page }) => {
  await loadPage(
    page,
    '<div role="dialog" aria-label="Translate content" aria-modal="true"><button>Translate</button></div>'
  );
  await assertAccessible(page, '[role="dialog"]');
});

test('an offscreen rendered scope does not require viewport scrolling', async ({ page }) => {
  await loadPage(page, controls.replace('<section ', '<section style="margin-top:150vh" '));
  await expect(page.locator(selector)).not.toBeInViewport();
  await assertAccessible(page, selector);
});

test('large text content inside the scope is fully audited', async ({ page }) => {
  await loadPage(
    page,
    controls.replace('<button>', `<p>${'Long translated article. '.repeat(1000)}</p><button>`)
  );
  await assertAccessible(page, selector);
});

test('a hidden unrelated panel does not prevent auditing the requested visible panel', async ({
  page,
}) => {
  await loadPage(
    page,
    `${controls}<section hidden aria-label="Other controls"><button></button></section>`
  );
  await assertAccessible(page, selector);
});

test('a scoped audit retains its boundary when unrelated content has a violation', async ({
  page,
}) => {
  await loadPage(page, `${controls}<button></button>`);
  await assertAccessible(page, selector);
});

test('a real violation inside the visible scope still fails', async ({ page }) => {
  await loadPage(page, controls.replace('<button>Translate</button>', '<button></button>'));
  await expect(assertAccessible(page, selector)).rejects.toThrow(/button-name/);
});

test('a whole-page audit still catches violations outside a plugin region', async ({ page }) => {
  await loadPage(page, `${controls}<button></button>`);
  await expect(assertAccessible(page)).rejects.toThrow(/button-name/);
});

test('independent pages can audit their requested scopes concurrently', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  try {
    await Promise.all([loadPage(page, controls), loadPage(other, controls)]);
    await Promise.all([assertAccessible(page, selector), assertAccessible(other, selector)]);
  } finally {
    await other.close();
  }
});

test('an ambiguous scope fails instead of silently choosing one panel', async ({ page }) => {
  await loadPage(page, `${controls}${controls}`);
  await expect(assertAccessible(page, selector)).rejects.toThrow(/strict mode violation/);
});

test('a whole-page audit with no include remains supported', async ({ page }) => {
  await loadPage(page, controls);
  await assertAccessible(page);
});
