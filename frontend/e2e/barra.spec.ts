import { expect, type Page, test } from '@playwright/test';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};
const FAIXA = { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null };
const leitura = (temperatura: number) => ({
  sensor_id: 12,
  temperatura,
  umidade: 50,
  data_hora: new Date().toISOString(),
});
const sala = (sala_id: number, nome: string, status: string, leituras: unknown[]) => ({
  sala_id,
  nome,
  faixa: FAIXA,
  intervalo_leitura_s: null,
  status,
  leituras,
});
const SALAS = [
  sala(1, 'Farmácia', 'ok', [leitura(5)]),
  sala(2, 'Câmara fria', 'fora_da_faixa', [leitura(9.1)]),
  sala(3, 'Almoxarifado', 'sem_leitura', []),
];

async function simularApi(page: Page, perfil?: string) {
  const dados = {
    salas: SALAS as unknown[],
    falhar: false,
    apiFora: false,
    pedidos: [] as string[],
  };
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
    if (caminho === '/health') {
      return dados.apiFora ? rota.abort() : responder(200, { status: 'ok' });
    }
    if (dados.falhar) return rota.abort();
    if (caminho === '/auth/me') {
      return responder(200, { id: 1, nome: 'Ana Maria Lima', email: 'ana@exemplo.com', perfil });
    }
    if (caminho === '/salas/status') return responder(200, dados.salas);
    if (caminho === '/salas/2') {
      return responder(200, {
        id: 2,
        nome: 'Câmara fria',
        descricao: null,
        faixa: FAIXA,
        sensores: [],
      });
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
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

const situacao = (page: Page) => page.getByRole('button', { name: /^Situação das salas:/ });
const conta = (page: Page) => page.getByRole('button', { name: 'Conta e menu' });

test('a mesma barra aparece nas telas logadas e não no login', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
  await expect(conta(page)).toHaveCount(0);

  await simularApi(page);
  await page.goto('/');
  // Pelas abas a barra não é refeita, e o Stack deixa as telas anteriores montadas por baixo:
  // continua existindo uma barra só.
  for (const aba of ['Gateways', 'Relatórios', 'Painel']) {
    await page.getByRole('link', { name: aba, exact: true }).click();
    await expect(page.getByRole('img', { name: 'TermoLOG', exact: true })).toHaveCount(1);
    await expect(situacao(page)).toHaveCount(1);
  }
  await page.goto('/health');
  await expect(situacao(page)).toBeVisible();
});

test('as abas navegam e marcam a tela atual, inclusive na tela da sala', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const painel = page.getByRole('link', { name: 'Painel', exact: true });
  await expect(painel).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page).toHaveURL(/\/relatorios$/);
  await expect(page.getByRole('link', { name: 'Relatórios' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/sala/2');
  await expect(painel).toHaveAttribute('aria-current', 'page');
});

test('o marcador fica sobre a aba atual, mesmo depois que o perfil chega', async ({ page }) => {
  await simularApi(page);
  await page.goto('/relatorios');
  const aba = page.getByRole('link', { name: 'Relatórios' });
  await expect(page.getByRole('link', { name: 'Gateways' })).toBeVisible();
  await expect
    .poll(async () => {
      const caixa = await aba.boundingBox();
      const marcador = await page.getByTestId('marcador-da-aba').boundingBox();
      return Math.abs((caixa?.x ?? 0) - (marcador?.x ?? -99)) < 2;
    })
    .toBe(true);
});

test('a situação aparece em qualquer tela e leva até a sala fora da faixa', async ({ page }) => {
  await simularApi(page);
  await page.goto('/gateways');
  await expect(situacao(page)).toContainText('1 sala fora da faixa');
  await situacao(page).click();
  await expect(page.getByRole('link', { name: 'Abrir Almoxarifado' })).toContainText('Sem leitura');
  await page.getByRole('link', { name: 'Abrir Câmara fria' }).click();
  await expect(page).toHaveURL(/\/sala\/2$/);
  // Trocar de tela fecha a caixa.
  await expect(page.getByRole('link', { name: 'Abrir Câmara fria' })).toHaveCount(0);
});

test('a fita térmica tem um segmento por sala, na ordem do status', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const fita = page.getByTestId('fita-termica');
  await expect(fita.locator('> *')).toHaveCount(3);
  await expect(fita.locator('> *').first()).toHaveAttribute(
    'data-testid',
    'segmento-fora_da_faixa',
  );
  await expect(fita.locator('> *').last()).toHaveAttribute('data-testid', 'segmento-ok');
});

test('sem sala fora, a barra acalma; sem resposta, diz que está sem conexão', async ({ page }) => {
  await page.clock.install();
  const api = await simularApi(page);
  api.salas = [sala(1, 'Farmácia', 'ok', [leitura(5)])];
  await page.goto('/gateways');
  await expect(situacao(page)).toContainText('Todas na faixa');

  api.falhar = true;
  await page.clock.fastForward(30_000);
  await expect(situacao(page)).toContainText('Sem conexão com a API');
  await situacao(page).click();
  await expect(page.getByText(/da última busca que deu certo/)).toBeVisible();
  // Os dados de antes continuam: a falha não apaga as salas.
  await expect(page.getByRole('link', { name: 'Abrir Farmácia' })).toBeVisible();
});

test('o menu da conta mostra quem está logado, a API e sai', async ({ page }) => {
  const api = await simularApi(page, 'administrador');
  api.apiFora = false;
  await page.goto('/gateways');
  await expect(conta(page)).toContainText('AL');
  await conta(page).click();
  await expect(page.getByText('Ana Maria Lima')).toBeVisible();
  await expect(page.getByText('ana@exemplo.com')).toBeVisible();
  await expect(page.getByText('Perfil: Administrador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'API no ar' })).toBeVisible();
  // Esc fecha sem sair.
  await page.keyboard.press('Escape');
  await expect(page.getByText('ana@exemplo.com')).toHaveCount(0);
  await conta(page).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
  await expect(conta(page)).toHaveCount(0);
});

test('a API fora aparece no menu da conta', async ({ page }) => {
  const api = await simularApi(page);
  api.apiFora = true;
  await page.goto('/gateways');
  await conta(page).click();
  await expect(page.getByRole('link', { name: 'API sem resposta' })).toBeVisible();
});

test('visualizador não vê Gateways nem chama a rota de administrador', async ({ page }) => {
  const api = await simularApi(page, 'visualizador');
  await page.goto('/relatorios');
  await conta(page).click();
  await expect(page.getByText('Perfil: Visualizador')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gateways' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Relatórios' })).toBeVisible();
  expect(api.pedidos).not.toContain('/gateways');
});

test('no celular, a navegação e o tema ficam no menu da conta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await simularApi(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Gateways' })).toHaveCount(0);
  await expect(situacao(page)).toContainText('1 fora');
  await conta(page).click();
  await expect(page.getByRole('switch', { name: 'Tema escuro' })).toBeVisible();
  await page.getByRole('link', { name: 'Gateways' }).click();
  await expect(page).toHaveURL(/\/gateways$/);
});

test('com movimento reduzido, as isotermas da barra ficam paradas', async ({
  browser,
  baseURL,
}) => {
  const contexto = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const pagina = await contexto.newPage();
  await simularApi(pagina);
  await pagina.goto('/gateways');
  await expect(situacao(pagina)).toContainText('1 sala fora');
  const quadro = () =>
    pagina
      .locator('canvas')
      .first()
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const antes = await quadro();
  await pagina.waitForTimeout(500);
  expect(await quadro()).toBe(antes);
  await contexto.close();
});

for (const largura of [320, 390, 640, 768, 1040, 1280, 1920]) {
  test(`a barra cabe em ${largura} px, com a caixa aberta dentro da tela`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 800 });
    await simularApi(page);
    await page.goto('/gateways');
    await expect(situacao(page)).toBeVisible();
    await expect(conta(page)).toBeInViewport({ ratio: 1 });
    await situacao(page).click();
    const caixa = await page.getByRole('link', { name: 'Abrir Câmara fria' }).boundingBox();
    expect(caixa?.x).toBeGreaterThanOrEqual(0);
    expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(largura);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
