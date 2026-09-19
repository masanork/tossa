import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
