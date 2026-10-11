/**
 * @param {unknown} manifest
 * @param {string} command
 * @returns {string}
 */
export const declaredBinary = (manifest, command) => {
  if (typeof manifest !== 'object' || manifest === null || !('bin' in manifest))
    throw new TypeError('The installed package has no CLI declaration');
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (typeof manifest.bin === 'object' && manifest.bin !== null && command in manifest.bin) {
    const binary = Object.getOwnPropertyDescriptor(manifest.bin, command)?.value;
    if (typeof binary === 'string') return binary;
  }
  throw new TypeError('The installed package does not declare the requested CLI');
};
