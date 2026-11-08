import { defineConfig } from '@playwright/test';

// Testes de ponta a ponta do navegador: a API é simulada dentro de cada teste.
export default defineConfig({
  testDir: 'e2e',
  // A primeira página espera o Metro montar o bundle.
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:8081', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:8081',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
