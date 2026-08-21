import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src-ui/**/*.spec.ts', 'src-shared-ts/**/*.spec.ts'],
    setupFiles: ['src-ui/test-setup.ts'],
  },
  resolve: {
    alias: {
      'src-ui': new URL('./src-ui', import.meta.url).pathname,
      'src-shared-ts': new URL('./src-shared-ts', import.meta.url).pathname,
    },
  },
});
