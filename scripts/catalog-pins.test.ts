import { describe, expect, it } from 'vitest';
import { checkStrapiPeerPins } from './check-catalog-pins.mjs';

const catalog = {
  react: '18.3.1',
  'react-dom': '18.3.1',
  'react-router-dom': '6.30.6',
  'styled-components': '6.5.3',
};
describe('Strapi build compatibility pins', () => {
  it('accepts exact declarations matching the shared catalog', () => {
    expect(checkStrapiPeerPins(catalog, { ...catalog, other: '1.0.0' })).toEqual([]);
  });
  it('rejects a drifted framework peer', () => {
    expect(checkStrapiPeerPins(catalog, { ...catalog, react: '19.3.0' })).toHaveLength(1);
  });
  it('rejects catalog references where Strapi requires semver text', () => {
    expect(checkStrapiPeerPins(catalog, { ...catalog, react: 'catalog:' })).toHaveLength(1);
  });
  it('rejects missing direct app peers', () => {
    expect(checkStrapiPeerPins(catalog, {})).toHaveLength(4);
  });
  it('rejects an unavailable catalog', () => {
    expect(() => checkStrapiPeerPins(null, catalog)).toThrow();
  });
});
