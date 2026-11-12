import { expect, type Page, test } from '@playwright/test';

// Perfil (US17, #118): a pessoa escolhe por quais canais recebe os alertas, e a escolha
// fica salva pelo PUT /auth/me/canais.

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};
const PUSH = {
  tipo: 'push',
  destino: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'p', auth: 'a' },
  },
  ativo: true,
};

type Canal = Record<string, unknown>;
type Opcoes = {
  canais?: Canal[];
  /** Resposta do PUT; sem isso, a API aceita e devolve o que recebeu. */
  put?: { status: number; corpo: unknown };
  /** Resposta do POST do vínculo do Telegram. */
  vinculo?: { status: number; corpo: unknown };
};

/** Simula a API. `dados.canais` é o que o servidor tem; o teste pode mudá-lo (o bot do Telegram). */
async function simularApi(page: Page, opcoes: Opcoes = {}) {
  const dados = { canais: opcoes.canais ?? [], puts: [] as Canal[][], pedidos: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
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
    dados.pedidos.push(`${pedido.method()} ${caminho}`);
    if (caminho === '/health') return responder(200, { status: 'ok' });
    if (caminho === '/auth/me') {
      return responder(200, {
        id: 1,
        nome: 'Ana Lima',
        email: 'ana@exemplo.com',
        perfil: 'administrador',
      });
    }
    if (caminho === '/auth/me/canais' && pedido.method() === 'GET') {
      return responder(200, dados.canais);
    }
    if (caminho === '/auth/me/canais' && pedido.method() === 'PUT') {
      const enviado = pedido.postDataJSON() as Canal[];
      dados.puts.push(enviado);
      if (opcoes.put) return responder(opcoes.put.status, opcoes.put.corpo);
      dados.canais = enviado;
      return responder(200, enviado);
    }
    if (caminho === '/auth/me/canais/telegram/vinculo') {
      const { status, corpo } = opcoes.vinculo ?? {
        status: 201,
        corpo: {
          codigo: 'abc',
          link: 'https://t.me/termolog_bot?start=abc',
          expira_em: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      };
      return responder(status, corpo);
    }
    if (caminho === '/salas/status') return responder(200, []);
    return responder(200, []);
  });
  return dados;
}

let erros: string[] = [];
test.beforeEach(({ page }) => {
  erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    // O navegador registra toda resposta de erro, e os 422 e 503 aqui são provocados.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

const interruptor = (page: Page, nome: string) => page.getByRole('switch', { name: nome });
const campoDoEmail = (page: Page) => page.getByLabel('E-mail para os alertas');
const salvar = (page: Page) => page.getByRole('button', { name: 'Salvar' });

test('o menu da conta leva ao perfil, com os canais desligados e o e-mail da conta sugerido', async ({
  page,
}) => {
  await simularApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Conta e menu' }).click();
  await page.getByRole('link', { name: 'Meu perfil' }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole('heading', { name: 'Canais de alerta' })).toBeVisible();
  await expect(page.getByText('ana@exemplo.com · Administrador')).toBeVisible();
  await expect(interruptor(page, 'E-mail')).toHaveAttribute('aria-checked', 'false');
  await expect(campoDoEmail(page)).toHaveCount(0);
  // Sem alteração, não há o que salvar.
  await expect(salvar(page)).toHaveCount(0);
});

test('ligar o e-mail abre o campo com o e-mail da conta, e salvar envia e confirma', async ({
  page,
}) => {
  const api = await simularApi(page);
  await page.goto('/perfil');
  await interruptor(page, 'E-mail').click();
  await expect(campoDoEmail(page)).toHaveValue('ana@exemplo.com');
  await campoDoEmail(page).fill('  Plantao@Exemplo.com ');
  await salvar(page).click();
  await expect(page.getByText('Canais salvos')).toBeVisible();
  expect(api.puts).toEqual([[{ tipo: 'email', destino: 'plantao@exemplo.com', ativo: true }]]);
  // Salvo: a faixa de alterações some.
  await expect(salvar(page)).toHaveCount(0);
});

test('e-mail inválido mostra a mensagem no campo e não envia', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/perfil');
  await interruptor(page, 'E-mail').click();
  await campoDoEmail(page).fill('ana@');
  await salvar(page).click();
  await expect(page.getByText('Informe um e-mail válido')).toBeVisible();
  expect(api.puts).toHaveLength(0);
  // Corrigir limpa a mensagem.
  await campoDoEmail(page).fill('ana@exemplo.com');
  await expect(page.getByText('Informe um e-mail válido')).toHaveCount(0);
});

test('o 422 do servidor aparece no campo do e-mail', async ({ page }) => {
  await simularApi(page, {
    put: {
      status: 422,
      corpo: { detail: [{ loc: ['body', 0, 'destino'], msg: 'value is not a valid email' }] },
    },
  });
  await page.goto('/perfil');
  await interruptor(page, 'E-mail').click();
  await salvar(page).click();
  await expect(page.getByText('O servidor não aceitou este e-mail')).toBeVisible();
  // A faixa continua: nada foi salvo.
  await expect(salvar(page)).toBeVisible();
});

test('canais salvos voltam ligados, e o push que a tela não edita é enviado de volta', async ({
  page,
}) => {
  const api = await simularApi(page, {
    canais: [
      { tipo: 'email', destino: 'ana@exemplo.com', ativo: true },
      { tipo: 'telegram', destino: '123456789', ativo: true },
      PUSH,
    ],
  });
  await page.goto('/perfil');
  await expect(interruptor(page, 'E-mail')).toHaveAttribute('aria-checked', 'true');
  await expect(interruptor(page, 'Telegram')).toHaveAttribute('aria-checked', 'true');
  await expect(interruptor(page, 'Notificação no navegador')).toBeDisabled();

  // Desligar o e-mail mantém o destino salvo, e o push segue na lista.
  await interruptor(page, 'E-mail').click();
  await salvar(page).click();
  await expect(page.getByText('Canais salvos')).toBeVisible();
  expect(api.puts[0]).toEqual([
    { tipo: 'email', destino: 'ana@exemplo.com', ativo: false },
    { tipo: 'telegram', destino: '123456789', ativo: true },
    PUSH,
  ]);
});

test('descartar volta ao que estava salvo', async ({ page }) => {
  const api = await simularApi(page, {
    canais: [{ tipo: 'email', destino: 'ana@exemplo.com', ativo: true }],
  });
  await page.goto('/perfil');
  await interruptor(page, 'E-mail').click();
  await expect(interruptor(page, 'E-mail')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(interruptor(page, 'E-mail')).toHaveAttribute('aria-checked', 'true');
  await expect(salvar(page)).toHaveCount(0);
  expect(api.puts).toHaveLength(0);
});

test('Telegram: gera o link, espera o bot vincular e passa a mostrar o chat', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/perfil');
  await page.getByRole('button', { name: 'Vincular Telegram' }).click();
  await expect(page.getByRole('button', { name: 'Abrir no Telegram' })).toBeVisible();
  await expect(page.getByText(/o link vale por \d+:\d\d/)).toBeVisible();

  // O bot cria o canal no servidor quando a pessoa toca em Iniciar.
  api.canais = [{ tipo: 'telegram', destino: '555', ativo: true }];
  await expect(page.getByText('Telegram vinculado')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Chat vinculado (555).')).toBeVisible();
  await expect(interruptor(page, 'Telegram')).toHaveAttribute('aria-checked', 'true');
  // O servidor já tem o canal: não sobra alteração para salvar.
  await expect(salvar(page)).toHaveCount(0);
});

test('Telegram: servidor sem o bot configurado mostra o motivo', async ({ page }) => {
  await simularApi(page, {
    vinculo: { status: 503, corpo: { detail: 'telegram não configurado' } },
  });
  await page.goto('/perfil');
  await page.getByRole('button', { name: 'Vincular Telegram' }).click();
  await expect(page.getByRole('alert')).toContainText('Telegram ainda não está configurado');
});

test('salvar não apaga um Telegram vinculado pelo bot depois da última busca', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/perfil');
  await interruptor(page, 'E-mail').click();
  // O bot vincula o chat enquanto a tela ainda mostra a lista antiga.
  api.canais = [{ tipo: 'telegram', destino: '777', ativo: true }];
  await salvar(page).click();
  await expect(page.getByText('Canais salvos')).toBeVisible();
  expect(api.puts[0]).toEqual([
    { tipo: 'email', destino: 'ana@exemplo.com', ativo: true },
    { tipo: 'telegram', destino: '777', ativo: true },
  ]);
});

test('no celular (360 px) a tela cabe sem rolagem horizontal', async ({ page }) => {
  await simularApi(page, { canais: [{ tipo: 'email', destino: 'ana@exemplo.com', ativo: true }] });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/perfil');
  await expect(interruptor(page, 'E-mail')).toBeVisible();
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra).toBeLessThanOrEqual(0);
});
