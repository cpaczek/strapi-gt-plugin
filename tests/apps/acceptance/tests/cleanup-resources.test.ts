import { describe, expect, it } from 'vitest';
import { cleanupTestResources } from '../src/cleanup-resources';

const steps = ['strapi', 'listeners', 'mock', 'database'] as const;
const scenarios = [
  [],
  ['strapi'],
  ['listeners'],
  ['mock'],
  ['database'],
  ['strapi', 'mock'],
  ['strapi', 'database'],
  ['mock', 'database'],
  ['strapi', 'listeners', 'mock'],
  ['strapi', 'listeners', 'mock', 'database'],
];
describe('owned test resource cleanup', () => {
  it.each(scenarios.map((failures) => [failures.join(', ') || 'none', failures] as const))(
    'attempts every cleanup in order when failures are %s',
    async (_name, failures) => {
      const calls: string[] = [];
      const errors = failures.map((step) => new Error(`${step} shutdown failed`));
      const cleanup = cleanupTestResources(
        steps.map((step) => async () => {
          calls.push(step);
          const index = failures.indexOf(step);
          if (index !== -1) throw errors[index];
        })
      );
      const result = await cleanup.then(
        () => undefined,
        (failure: unknown) => failure
      );
      expect(calls).toEqual(steps);
      if (errors.length === 0) expect(result).toBeUndefined();
      else if (errors.length === 1) expect(result).toBe(errors[0]);
      else {
        expect(result).toBeInstanceOf(AggregateError);
        if (!(result instanceof AggregateError))
          throw new Error('Cleanup did not report every failure');
        expect(result.errors).toEqual(errors);
        expect(result.cause).toBe(errors[0]);
      }
    }
  );

  it('preserves the original setup error when cleanup succeeds', async () => {
    const original = new Error('Database readiness failed');
    const calls: string[] = [];
    await expect(
      cleanupTestResources(
        [
          () => {
            calls.push('database');
          },
        ],
        [original]
      )
    ).rejects.toBe(original);
    expect(calls).toEqual(['database']);
  });

  it('reports the setup failure before cleanup failures without replacing either', async () => {
    const original = new Error('Database port was unavailable');
    const cleanupError = new Error('Container stop failed');
    const result = await cleanupTestResources(
      [
        () => {
          throw cleanupError;
        },
      ],
      [original]
    ).catch((failure: unknown) => failure);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) throw new Error('Setup failure was not retained');
    expect(result.errors).toEqual([original, cleanupError]);
    expect(result.cause).toBe(original);
  });

  it('continues after a synchronous or non-Error rejection', async () => {
    const calls: string[] = [];
    const result = await cleanupTestResources([
      () => {
        throw 'shutdown fixture';
      },
      async () => {
        throw undefined;
      },
      () => {
        calls.push('database');
      },
    ]).catch((failure: unknown) => failure);
    expect(calls).toEqual(['database']);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) throw new Error('Thrown values were not retained');
    expect(result.errors).toEqual(['shutdown fixture', undefined]);
  });

  it('cleans only acquired resources after partial initialization', async () => {
    const original = new Error('Strapi compile failed before an instance was created');
    const calls: string[] = [];
    await expect(
      cleanupTestResources(
        [
          async () => {
            calls.push('mock');
          },
          async () => {
            calls.push('database');
          },
        ],
        [original]
      )
    ).rejects.toBe(original);
    expect(calls).toEqual(['mock', 'database']);
  });

  it('does not introduce a failure when no resources were acquired', async () => {
    await expect(cleanupTestResources([])).resolves.toBeUndefined();
  });
});
