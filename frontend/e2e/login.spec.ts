import { expect, type Page, test } from '@playwright/test';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

// Erro de JavaScript em qualquer teste reprova, inclusive os do desenho das animações.
let errosDaPagina: string[] = [];
test.beforeEach(({ page }) => {
  errosDaPagina = [];
  page.on('pageerror', (erro) => errosDaPagina.push(erro.message));
});
test.afterEach(() => expect(errosDaPagina).toEqual([]));

/** Simula a API: login aceita só a senha certa e as rotas do painel exigem o token. */
async function simularApi(page: Page) {
  const logout: (string | null)[] = [];
  let tokenValido = 'token-bom';
  await page.route(`${API}/**`, async (rota) => {
    const pedido = rota.request();
    const caminho = new URL(pedido.url()).pathname;
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (pedido.method() === 'OPTIONS') return responder(204);
    if (caminho === '/auth/login') {
      const { senha } = pedido.postDataJSON();
      return senha === 'certa'
        ? responder(200, { token: tokenValido, expira_em: '2030-01-01T00:00:00Z', usuario: {} })
        : responder(401, { detail: 'e-mail ou senha inválidos' });
    }
    if (caminho === '/auth/logout') {
      logout.push(await pedido.headerValue('authorization'));
      return responder(204);
    }
    if ((await pedido.headerValue('authorization')) !== `Bearer ${tokenValido}`) {
      return responder(401, { detail: 'não autenticado' });
    }
    return responder(200, []);
  });
  return {
    logout,
    derrubarSessao: () => {
      tokenValido = 'outro';
    },
  };
}

async function entrar(page: Page, senha = 'certa') {
  await page.getByLabel('E-mail').fill('ana@exemplo.com');
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

const noLogin = (page: Page) =>
  expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
const noPainel = (page: Page) =>
  expect(page.getByRole('button', { name: 'Conta e menu' })).toBeVisible();
const sairDoPainel = async (page: Page) => {
  await page.getByRole('button', { name: 'Conta e menu' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
};

for (const rota of ['/', '/gateways', '/health']) {
  test(`sem login, ${rota} redireciona para o login`, async ({ page }) => {
    await simularApi(page);
    await page.goto(rota);
    await noLogin(page);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Nova sala' })).toHaveCount(0);
  });
}

test('credencial inválida mostra a mensagem e continua no login', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await entrar(page, 'errada');
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha inválidos.');
  await noLogin(page);
  expect(await page.evaluate(() => localStorage.getItem('termolog-token'))).toBeNull();
});

test('erro 5xx e API fora do ar não parecem senha errada', async ({ page }) => {
  let falha: 'servidor' | 'rede' = 'servidor';
  await page.route(`${API}/auth/login`, (rota) =>
    falha === 'rede'
      ? rota.abort()
      : rota.fulfill({ status: 500, headers: CORS, json: { detail: 'erro interno' } }),
  );
  await page.goto('/');
  await entrar(page);
  await expect(page.getByRole('alert')).toContainText('A API respondeu com erro');
  falha = 'rede';
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível falar com a API');
});

test('digitar e errar várias vezes soltam pulsos sem erro no desenho', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await page.getByLabel('E-mail').pressSequentially('ana@exemplo.com', { delay: 20 });
  for (let i = 0; i < 3; i++) await entrar(page, 'errada');
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha inválidos.');
  await page.waitForTimeout(1600);
});

test('mostrar senha alterna o campo e Enter envia o formulário', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const senha = page.getByLabel('Senha', { exact: true });
  await expect(senha).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await expect(senha).not.toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Esconder senha' }).click();
  await page.getByLabel('E-mail').fill('ana@exemplo.com');
  await senha.fill('certa');
  await senha.press('Enter');
  await noPainel(page);
});

test('sair em outra aba encerra a sessão nesta também', async ({ context, page }) => {
  await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);
  const outra = await context.newPage();
  await simularApi(outra);
  await outra.goto('/');
  await sairDoPainel(outra);
  await noLogin(outra);
  await noLogin(page);
});

test('com movimento reduzido, o erro aparece e o fundo fica parado', async ({
  browser,
  baseURL,
}) => {
  const contexto = await browser.newContext({
    baseURL,
    reducedMotion: 'reduce',
  });
  const pagina = await contexto.newPage();
  await simularApi(pagina);
  await pagina.goto('/');
  await noLogin(pagina);
  const quadro = () =>
    pagina.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => c.toDataURL()));
  const antes = await quadro();
  await entrar(pagina, 'errada');
  await expect(pagina.getByRole('alert')).toContainText('E-mail ou senha inválidos.');
  expect(await quadro()).toEqual(antes);
  await contexto.close();
});

test('fundo animado em todas as larguras; a frase só na tela larga', async ({ page }) => {
  await simularApi(page);
  const frase = page.getByRole('img', { name: /em um olhar/ });
  await page.goto('/');
  await noLogin(page);
  await expect(frase).toBeVisible();
  // Fundo e ícone em onda: dois quadros seguidos do ícone precisam ser diferentes.
  await expect(page.locator('canvas')).toHaveCount(2);
  const icone = () =>
    page
      .locator('canvas')
      .nth(1)
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const antes = await icone();
  await page.waitForTimeout(400);
  expect(await icone()).not.toBe(antes);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(frase).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeInViewport();
});

test('a logo vetorial aparece no login e no painel', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const logo = page.getByRole('img', { name: 'TermoLOG', exact: true });
  await expect(logo.locator('svg path')).toHaveCount(2);
  await entrar(page);
  await noPainel(page);
  await expect(logo.locator('svg path')).toHaveCount(2);
});

test('o site usa o favicon do TermoLOG', async ({ request }) => {
  const resposta = await request.get('/favicon.ico');
  expect(resposta.ok()).toBe(true);
  expect(resposta.headers()['content-type']).toContain('image');
});

test('campos vazios não chamam a API', async ({ page }) => {
  await simularApi(page);
  let chamou = false;
  page.on('request', (r) => {
    if (r.url().endsWith('/auth/login')) chamou = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Informe o seu e-mail.');
  expect(chamou).toBe(false);
});

test('entra, recarrega sem perder a sessão e sai com o logout na API', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);

  await page.reload();
  await noPainel(page);

  await sairDoPainel(page);
  await noLogin(page);
  await expect.poll(() => api.logout).toEqual(['Bearer token-bom']);
  expect(await page.evaluate(() => localStorage.getItem('termolog-token'))).toBeNull();

  await expect(page).toHaveURL(/\/login$/);

  // Sair não deixa voltar: o endereço do painel cai no login de novo.
  await page.goto('/gateways');
  await noLogin(page);
});

test('logado, o endereço /login leva de volta ao painel', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);
  await page.goto('/login');
  await noPainel(page);
  await expect(page).toHaveURL(/\/$/);
});

test('sair em Gateways também encerra a sessão', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);
  await page.goto('/gateways');
  await sairDoPainel(page);
  await noLogin(page);
});

test('401 numa tela do painel limpa o token e volta para o login com o aviso', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);

  api.derrubarSessao();
  await page
    .getByRole('button', { name: 'Gateways' })
    .or(page.getByRole('link', { name: 'Gateways' }))
    .click();
  await noLogin(page);
  await expect(page.getByText('Sua sessão expirou')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('termolog-token'))).toBeNull();
});

test('depois de 30 min sem uso, o próximo clique leva ao login', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/');
  await entrar(page);
  await noPainel(page);

  await page.evaluate(() =>
    localStorage.setItem('termolog-ultimo-uso', String(Date.now() - 31 * 60_000)),
  );
  await page.getByRole('button', { name: 'Nova sala' }).click();
  await noLogin(page);
  await expect(page.getByText('Sua sessão expirou')).toBeVisible();
  await expect.poll(() => api.logout).toEqual(['Bearer token-bom']);
});
