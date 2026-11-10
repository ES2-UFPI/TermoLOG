import { expect, type Page, test } from '@playwright/test';

// Perfis (US24, #99): o visualizador não vê as ações de administrador, e um 403 inesperado
// vira uma mensagem clara, não um erro genérico.

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};
const FAIXA = { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null };
const SALAS = [
  {
    sala_id: 1,
    nome: 'Farmácia',
    faixa: FAIXA,
    intervalo_leitura_s: null,
    status: 'ok',
    conformidade_24h: 100,
    leituras: [{ sensor_id: 12, temperatura: 5, umidade: 50, data_hora: new Date().toISOString() }],
  },
];
const GATEWAYS = [
  { id: 1, nome: 'Filial Centro', online: true, ultimo_contato: new Date().toISOString() },
];

/** Simula a API. `gateways: 403` é a resposta do backend para quem não é administrador. */
async function simularApi(
  page: Page,
  opcoes: { perfil?: string; salas?: unknown[]; gateways?: 200 | 403 } = {},
) {
  const { perfil, salas = SALAS, gateways = 200 } = opcoes;
  const dados = { pedidos: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const caminho = new URL(rota.request().url()).pathname;
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (rota.request().method() === 'OPTIONS') return responder(204);
    dados.pedidos.push(caminho);
    if (caminho === '/health') return responder(200, { status: 'ok' });
    if (caminho === '/auth/me') {
      return responder(200, { id: 1, nome: 'Ana Lima', email: 'ana@exemplo.com', perfil });
    }
    if (caminho === '/salas/status') return responder(200, salas);
    if (caminho === '/gateways') {
      return gateways === 403
        ? responder(403, { detail: 'permissão insuficiente' })
        : responder(200, GATEWAYS);
    }
    return responder(200, []);
  });
  return dados;
}

let erros: string[] = [];
test.beforeEach(({ page }) => {
  erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    // O navegador registra toda resposta de erro, e o 403 aqui é provocado de propósito.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

const novaSala = (page: Page) => page.getByRole('button', { name: 'Nova sala' });
const editarSala = (page: Page) => page.getByRole('button', { name: 'Editar Farmácia' });

test('administrador vê Nova sala e o botão de editar nos cards', async ({ page }) => {
  await simularApi(page, { perfil: 'administrador' });
  await page.goto('/');
  await expect(page.getByText('Farmácia').first()).toBeVisible();
  await expect(novaSala(page)).toBeVisible();
  await expect(editarSala(page)).toBeVisible();
});

test('visualizador vê o painel, sem Nova sala e sem editar', async ({ page }) => {
  await simularApi(page, { perfil: 'visualizador' });
  await page.goto('/');
  await expect(page.getByText('Farmácia').first()).toBeVisible();
  // O perfil chega depois do painel: espera a conta mostrar quem está logado.
  await page.getByRole('button', { name: 'Conta e menu' }).click();
  await expect(page.getByText('Perfil: Visualizador')).toBeVisible();
  await expect(novaSala(page)).toHaveCount(0);
  await expect(editarSala(page)).toHaveCount(0);
});

test('sem salas, o administrador é convidado a cadastrar e o visualizador, a pedir', async ({
  page,
}) => {
  await simularApi(page, { perfil: 'administrador', salas: [] });
  await page.goto('/');
  await expect(page.getByText('Cadastre a primeira sala')).toBeVisible();
  await expect(novaSala(page).first()).toBeVisible();

  const visualizador = await page.context().newPage();
  await simularApi(visualizador, { perfil: 'visualizador', salas: [] });
  await visualizador.goto('/');
  await expect(visualizador.getByText('Peça a um administrador para cadastrar')).toBeVisible();
  await expect(visualizador.getByRole('button', { name: 'Nova sala' })).toHaveCount(0);
});

test('gateways: o visualizador que abre o endereço vê o motivo e volta ao painel', async ({
  page,
}) => {
  const api = await simularApi(page, { perfil: 'visualizador', gateways: 403 });
  await page.goto('/gateways');
  await expect(page.getByRole('alert')).toContainText('Só administradores veem os gateways');
  await expect(page.getByText('guardam as chaves de API')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo gateway' })).toHaveCount(0);
  // Uma tentativa só: depois do 403 não adianta insistir a cada 30 s.
  expect(api.pedidos.filter((p) => p === '/gateways')).toHaveLength(1);

  await page.getByRole('button', { name: 'Voltar ao painel' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Farmácia').first()).toBeVisible();
});

test('gateways: depois do 403 a tela não repete a busca', async ({ page }) => {
  await page.clock.install();
  const api = await simularApi(page, { perfil: 'visualizador', gateways: 403 });
  await page.goto('/gateways');
  await expect(page.getByRole('alert')).toContainText('Só administradores');
  await page.clock.fastForward(95_000);
  expect(api.pedidos.filter((p) => p === '/gateways')).toHaveLength(1);
});

test('gateways: o administrador vê a lista e o botão de novo gateway', async ({ page }) => {
  await simularApi(page, { perfil: 'administrador' });
  await page.goto('/gateways');
  await expect(page.getByText('Filial Centro')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo gateway' })).toBeVisible();
});
