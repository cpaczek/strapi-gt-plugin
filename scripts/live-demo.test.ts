import { describe, expect, it } from 'vitest';
import { createLiveProcesses } from './testbed/live-demo';

const environment = {
  GT_API_KEY: 'server-only-test-key',
  GT_PROJECT_ID: 'test-project',
  PATH: '/bin',
};

describe('real GT example launcher', () => {
  it.each(['GT_API_KEY', 'GT_PROJECT_ID'])('requires %s before starting a process', (name) => {
    expect(() => createLiveProcesses('/repo', { ...environment, [name]: '' })).toThrow(name);
  });
  it('passes the key only to Strapi and uses the official GT host', () => {
    const [strapi, reader] = createLiveProcesses('/repo', {
      ...environment,
      GT_BASE_URL: 'https://unexpected.invalid',
      GT_EXTRA_SECRET: 'private',
    });
    expect(strapi.env.GT_API_KEY).toBe(environment.GT_API_KEY);
    expect(strapi.env.GT_PROJECT_ID).toBe(environment.GT_PROJECT_ID);
    expect(strapi.env.GT_BASE_URL).toBe('https://api.gtx.dev');
    expect(Object.keys(reader.env).filter((key) => key.startsWith('GT_'))).toEqual([]);
    expect(JSON.stringify(reader)).not.toContain(environment.GT_API_KEY);
  });
  it('starts only Strapi and Next with a separate persistent local database', () => {
    const processes = createLiveProcesses('/repo', environment);
    expect(processes).toHaveLength(2);
    expect(processes[0].args).toEqual(['--filter', '@gt/playground', 'develop']);
    expect(processes[1].args).toEqual(['--filter', '@gt/reader', 'dev']);
    expect(processes[0].env.DATABASE_FILENAME).toBe('/repo/.work/live-demo/database.db');
    expect(processes[0].env.DATABASE_CLIENT).toBe('sqlite');
    expect(processes[1].env.STRAPI_URL).toBe('http://127.0.0.1:1537');
    expect(processes[1].env.READER_PORT).toBe('3300');
  });
  it('respects explicit live ports and updates the reader backend together', () => {
    const [strapi, reader] = createLiveProcesses('/repo', {
      ...environment,
      LIVE_STRAPI_PORT: '1637',
      LIVE_READER_PORT: '3400',
    });
    expect(strapi.env.PORT).toBe('1637');
    expect(reader.env.STRAPI_URL).toBe('http://127.0.0.1:1637');
    expect(reader.env.READER_PORT).toBe('3400');
  });
  it.each(['0', '65536', 'abc', '3300;echo', '1537.5'])('rejects invalid live ports %s', (port) => {
    expect(() =>
      createLiveProcesses('/repo', { ...environment, LIVE_READER_PORT: port })
    ).toThrow();
  });
  it('rejects ports that collide with each other', () => {
    expect(() =>
      createLiveProcesses('/repo', { ...environment, LIVE_READER_PORT: '1537' })
    ).toThrow();
  });
  it('normalizes leading zeros before checking port collisions', () => {
    expect(() =>
      createLiveProcesses('/repo', { ...environment, LIVE_READER_PORT: '01537' })
    ).toThrow();
  });
  it('removes unrelated API authentication from the public reader', () => {
    const [, reader] = createLiveProcesses('/repo', {
      ...environment,
      STRAPI_API_TOKEN: 'unrelated-token',
    });
    expect(reader.env.STRAPI_API_TOKEN).toBeUndefined();
  });
});
