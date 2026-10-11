import { describe, expect, it } from 'vitest';
import { translationEngine } from '../../server/src/engine';
import { articleSchema, prepareInput } from './fixtures';

const rules = {
  title: { translate: false },
  slug: { translate: true, uidStrategy: 'regenerate' as const },
};

describe('UID dependency boundaries', () => {
  it('rejects a private default title source even when a target value exists', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: 'Source secret', slug: 'source' },
        {
          schema: {
            ...articleSchema,
            attributes: {
              ...articleSchema.attributes,
              title: { type: 'string', localized: true, private: true },
            },
          },
          target: { title: 'Target secret', slug: null },
          rules,
        }
      )
    );
    expect(() => translationEngine.apply(prepared, {})).toThrow();
  });
  it('does not replace an explicit null translated title with an old target title', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: null, slug: 'source' },
        {
          target: { title: 'Old target title', slug: null },
          rules: { slug: rules.slug },
          force: true,
        }
      )
    );
    expect(() => translationEngine.apply(prepared, {})).toThrow();
  });
});
