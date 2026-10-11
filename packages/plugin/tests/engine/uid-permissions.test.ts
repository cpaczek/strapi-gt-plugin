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

const apply = (
  source: Parameters<typeof prepareInput>[0],
  extra: Parameters<typeof prepareInput>[1] = {}
) => {
  const prepared = translationEngine.prepare(prepareInput(source, { rules, ...extra }));
  return translationEngine.apply(
    prepared,
    Object.fromEntries(
      prepared.segments.map((segment) => [segment.id, `Translated ${segment.text}`])
    )
  );
};

describe('UID read dependency provenance', () => {
  it('requires source title Read for freshly translated output', () => {
    const result = apply({ title: 'Title', slug: 'source' }, { rules: { slug: rules.slug } });
    expect(result.patch.slug).toBe('translated-title');
    expect(result.readDependencies).toEqual([{ document: 'source', path: ['title'] }]);
  });
  it('requires target title Read for a protected human title', () => {
    const result = apply(
      { title: 'Title', slug: 'source' },
      {
        target: { title: 'Human title', slug: null },
        rules: { slug: rules.slug },
      }
    );
    expect(result.patch).toEqual({ slug: 'human-title' });
    expect(result.readDependencies).toEqual([{ document: 'target', path: ['title'] }]);
  });
  it('requires target title Read for an unchanged machine title', () => {
    const previous = apply({ title: 'Title', slug: 'source' }, { rules: { slug: rules.slug } });
    const result = apply(
      { title: 'Title', slug: 'changed-source' },
      {
        rules: { slug: rules.slug },
        target: previous.patch,
        checkpoints: previous.checkpoints,
      }
    );
    expect(result.patch).toEqual({ slug: 'translated-title' });
    expect(result.readDependencies).toEqual([{ document: 'target', path: ['title'] }]);
  });
  it('tracks an explicit sourceField instead of the default title', () => {
    const result = apply(
      { title: 'Title', summary: 'Summary', slug: 'source' },
      {
        target: { title: 'Private irrelevant title', summary: 'Chosen title', slug: null },
        rules: { ...rules, slug: { ...rules.slug, sourceField: 'summary' } },
      }
    );
    expect(result.patch).toEqual({ slug: 'chosen-title' });
    expect(result.readDependencies).toEqual([{ document: 'target', path: ['summary'] }]);
  });
  it('rejects an explicitly configured private title source', () => {
    expect(() =>
      apply(
        { title: 'Title', secret: 'Secret', slug: 'source' },
        {
          target: { secret: 'Secret target', slug: null },
          rules: { ...rules, slug: { ...rules.slug, sourceField: 'secret' } },
        }
      )
    ).toThrow();
  });
  it('requires no dependency for a protected human slug', () => {
    const result = apply(
      { title: 'Title', slug: 'source' },
      {
        target: { title: 'Restricted target', slug: 'human-slug' },
      }
    );
    expect(result.patch).toEqual({});
    expect(result.readDependencies).toEqual([]);
  });
  it('requires no title dependency when copying a UID', () => {
    const result = apply(
      { title: 'Title', slug: 'source' },
      {
        rules: { ...rules, slug: { translate: true, uidStrategy: 'copy' } },
      }
    );
    expect(result.patch).toEqual({ slug: 'source' });
    expect(result.readDependencies).toEqual([]);
  });
  it('rejects a missing dependency schema despite an existing target value', () => {
    expect(() =>
      apply(
        { slug: 'source' },
        {
          target: { missing: 'Unapproved value', slug: null },
          rules: { slug: { ...rules.slug, sourceField: 'missing' } },
        }
      )
    ).toThrow();
  });
  it('rejects a nonlocalized dependency', () => {
    expect(() =>
      apply(
        { shared: 'Source', slug: 'source' },
        {
          target: { shared: 'Shared title', slug: null },
          rules: { slug: { ...rules.slug, sourceField: 'shared' } },
        }
      )
    ).toThrow();
  });
  it.each(['', '   '])(
    'rejects an explicit empty translated title %# instead of using old target text',
    (translatedTitle) => {
      const prepared = translationEngine.prepare(
        prepareInput(
          { title: 'Source', slug: 'source' },
          {
            rules: { slug: rules.slug },
            target: { title: 'Old title', slug: null },
            force: true,
          }
        )
      );
      expect(() =>
        translationEngine.apply(
          prepared,
          Object.fromEntries(prepared.segments.map((segment) => [segment.id, translatedTitle]))
        )
      ).toThrow();
    }
  );
  it.each([false, true])(
    'tracks nested %s source fallback without confusing it with target text',
    (hasTarget) => {
      const result = apply(
        { card: { heading: 'Source title', body: 'Source body', slug: 'source' } },
        {
          components: {
            'content.card': {
              uid: 'content.card',
              localized: false,
              draftAndPublish: false,
              attributes: {
                heading: { type: 'string' },
                body: { type: 'string' },
                slug: { type: 'uid', targetField: 'heading' },
              },
            },
          },
          target: hasTarget ? { card: { heading: 'Target title', body: null, slug: null } } : null,
          rules: { 'card.heading': { translate: false }, 'card.slug': rules.slug },
        }
      );
      expect(result.patch.card).toMatchObject({
        heading: hasTarget ? 'Target title' : 'Source title',
        slug: hasTarget ? 'target-title' : 'source-title',
      });
      expect(result.readDependencies).toEqual([
        { document: hasTarget ? 'target' : 'source', path: ['card', 'heading'] },
      ]);
    }
  );
});
