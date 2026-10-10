import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

export const assertAccessible = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  if (violations.length)
    await test.info().attach('axe-violations', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  expect(
    violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      affectedNodes: violation.nodes.length,
    }))
  ).toEqual([]);
};
