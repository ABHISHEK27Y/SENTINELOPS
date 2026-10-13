import { fileURLToPath } from 'node:url';

export default {
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) } },
  test: {
    coverage: {
      // Vitest 4 defaults to imported files; retain coverage for the full source tree.
      include: [
        'apps/api/src/**/*.ts',
        'apps/web/app/**/*.{ts,tsx}',
        'apps/web/components/**/*.{ts,tsx}',
        'apps/web/lib/**/*.{ts,tsx}',
        'packages/*/src/**/*.ts',
        'services/*/src/**/*.ts',
        'control-plane/*/src/**/*.ts',
        'scripts/*.mjs',
      ],
    },
  },
};
