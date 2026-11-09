import { defineConfig } from '@playwright/test';

// Outra porta quando já há um painel de outra branch ou worktree rodando na 8081.
const porta = process.env.E2E_PORTA ?? '8081';

// Testes de ponta a ponta do navegador: a API é simulada dentro de cada teste.
export default defineConfig({
  testDir: 'e2e',
  // A primeira página espera o Metro montar o bundle.
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${porta}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm start -- --port ${porta}`,
    url: `http://localhost:${porta}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
