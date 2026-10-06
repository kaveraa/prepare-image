import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // The pure logic: EXIF reading, size computing, format choice.
          // Runs under Node, without a browser: fast, and it is most of the code.
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          globals: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          // The real canvas of a real browser: decoding, rotation,
          // resizing, encoding. Nothing replaces this test.
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          globals: true,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
