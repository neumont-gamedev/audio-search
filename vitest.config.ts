import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Native sqlite handles and temp directories do not like being shared between workers.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
