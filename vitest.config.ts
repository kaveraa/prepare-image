import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // La logique pure : lecture EXIF, calcul des tailles, choix du format.
          // Tourne sous Node, sans navigateur : rapide, et c'est la majorite du code.
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          globals: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          // Le vrai canevas d'un vrai navigateur : decodage, rotation,
          // redimensionnement, encodage. Rien ne remplace ce test la.
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
