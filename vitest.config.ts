import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'src-grpc-web-client': fileURLToPath(new URL('./src-grpc-web-client', import.meta.url)),
      'src-shared-ts': fileURLToPath(new URL('./src-shared-ts', import.meta.url)),
      'src-ui': fileURLToPath(new URL('./src-ui', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['@angular/compiler'],
  },
});
