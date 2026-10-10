import { resolve } from 'node:path';
import type { UserConfig } from 'vite';

export default (config: UserConfig): UserConfig => ({
  ...config,
  optimizeDeps: {
    ...config.optimizeDeps,
    esbuildOptions: {
      ...config.optimizeDeps?.esbuildOptions,
      // Preserve core-before-language evaluation when Vite shares optimizer chunks.
      inject: [
        ...(config.optimizeDeps?.esbuildOptions?.inject ?? []),
        resolve(__dirname, 'prism-runtime.ts'),
      ],
    },
  },
});
