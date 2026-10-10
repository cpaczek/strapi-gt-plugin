export const declaredBinary = (manifest, command) => {
  if (typeof manifest !== 'object' || manifest === null || !('bin' in manifest))
    throw new TypeError('The installed package has no CLI declaration');
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (
    typeof manifest.bin === 'object' &&
    manifest.bin !== null &&
    typeof manifest.bin[command] === 'string'
  )
    return manifest.bin[command];
  throw new TypeError('The installed package does not declare the requested CLI');
};
