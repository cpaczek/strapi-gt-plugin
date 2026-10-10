import { describe, expect, it } from 'vitest';
import { articles, category, locales } from '../../../../playground/src/seed/content';

describe('editorial acceptance content', () => {
  it('includes published and draft control articles', () => {
    expect(articles.some((article) => article.publish)).toBe(true);
    expect(articles.some((article) => !article.publish)).toBe(true);
    expect(new Set(articles.map((article) => article.fields.slug)).size).toBe(articles.length);
  });
  it('includes left-to-right and right-to-left target languages', () => {
    expect(locales.map((locale) => locale.code)).toEqual(['en', 'fr', 'ar']);
  });
  it('covers text, Markdown, Blocks and Unicode without losing control fields', () => {
    expect(articles[0]?.fields).toMatchObject({
      readingMinutes: 7,
      featured: true,
      edition: 'field-notes',
    });
    expect(articles[0]?.fields.markdown).toContain('`');
    expect(articles[0]?.fields.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'paragraph' })])
    );
    expect(articles[0]?.fields.summary).toContain('café');
  });
  it('covers nested and repeatable components and dynamic zones', () => {
    expect(articles[0]?.fields.seo).toHaveProperty('social.title');
    expect(articles[0]?.fields.credits).toHaveLength(2);
    expect(articles[0]?.fields.sections.map((section) => section.__component)).toEqual([
      'editorial.pull-quote',
      'editorial.text-section',
      'editorial.gallery',
    ]);
  });
  it('carries JSON, numbers, dates and relations as nontranslation controls', () => {
    expect(articles[0]?.fields).toMatchObject({
      coordinates: { latitude: 48.64, longitude: -2.03 },
      observationDate: '2026-06-18',
      budget: 1250.5,
      contactEmail: 'editor@example.invalid',
    });
    expect(category).toMatchObject({ name: 'Coasts', slug: 'coasts' });
  });
});
