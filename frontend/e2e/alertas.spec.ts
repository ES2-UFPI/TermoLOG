import { expect, type Page, test } from '@playwright/test';

// Alertas (US12, #103): pendentes e reconhecidos em abas separadas, reconhecer e encerrar
// com a ação tomada. A API simulada guarda os alertas e aplica as mesmas transições.

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};
const ANA = { id: 1, nome: 'Ana Lima', email: 'ana@exemplo.com', perfil: 'administrador' };

type Alerta = Record<string, unknown> & { id: number; sala_id: number; situacao: string };

const alerta = (id: number, sala: [number, string], situacao = 'pendente'): Alerta => ({
  id,
  sala_id: sala[0],
  sala_nome: sala[1],
  sensor_id: 10 + id,
  tipo: 'temperatura_acima',
  situacao,
  data_hora: new Date(Date.now() - id * 60_000).toISOString(),
  leitura: { temperatura: 9.4, umidade: 71, data_hora: new Date().toISOString() },
  reconhecido_por: situacao === 'pendente' ? null : { id: 2, nome: 'Bruno Reis' },
  reconhecido_em: situacao === 'pendente' ? null : new Date().toISOString(),
  acao_corretiva: null,
  encerrado_em: null,
});

const CAMARA: [number, string] = [1, 'Câmara fria'];
const FARMACIA: [number, string] = [2, 'Farmácia'];

/** `conflito`: ids cujo POST responde 409, como se outra pessoa tivesse mexido antes. */
/** `atrasoMs`: espera antes de responder ao POST, para trocar de filtro no meio dele. */
async function simularApi(page: Page, alertas: Alerta[], conflito: number[] = [], atrasoMs = 0) {
  const dados = {
    alertas,
    consultas: [] as string[],
    encerramentos: [] as unknown[],
    reconhecimentos: 0,
  };
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const caminho = url.pathname;
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (pedido.method() === 'OPTIONS') return responder(204);
    if (caminho === '/health') return responder(200, { status: 'ok' });
    if (caminho === '/auth/me') return responder(200, ANA);
    if (caminho === '/salas') {
      return responder(200, [
        { id: 1, nome: 'Câmara fria', descricao: null, faixa: {} },
        { id: 2, nome: 'Farmácia', descricao: null, faixa: {} },
      ]);
    }
    if (caminho === '/alertas') {
      dados.consultas.push(url.search);
      const situacao = url.searchParams.get('situacao');
      const sala = Number(url.searchParams.get('sala_id')) || null;
      return responder(
        200,
        dados.alertas.filter(
          (a) => (!situacao || a.situacao === situacao) && (!sala || a.sala_id === sala),
        ),
      );
    }
    const acao = caminho.match(/^\/alertas\/(\d+)\/(reconhecer|encerrar)$/);
    if (acao) {
      const id = Number(acao[1]);
      const atual = dados.alertas.find((a) => a.id === id);
      if (!atual) return responder(404, { detail: 'alerta não encontrado' });
      if (acao[2] === 'reconhecer') {
        dados.reconhecimentos++;
        await new Promise((fim) => setTimeout(fim, atrasoMs));
        if (conflito.includes(id) || atual.situacao !== 'pendente') {
          // Outra pessoa reconheceu antes: o servidor já tem o alerta como reconhecido.
          Object.assign(atual, {
            situacao: 'reconhecido',
            reconhecido_por: { id: 2, nome: 'Bruno Reis' },
            reconhecido_em: new Date().toISOString(),
          });
          return responder(409, { detail: 'alerta não está pendente' });
        }
        Object.assign(atual, {
          situacao: 'reconhecido',
          reconhecido_por: { id: ANA.id, nome: ANA.nome },
          reconhecido_em: new Date().toISOString(),
        });
        return responder(200, atual);
      }
      const corpo = pedido.postDataJSON() as { acao_corretiva: string };
      dados.encerramentos.push(corpo);
      Object.assign(atual, {
        situacao: 'encerrado',
        acao_corretiva: corpo.acao_corretiva,
        encerrado_em: new Date().toISOString(),
      });
      return responder(200, atual);
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
    // O navegador registra toda resposta de erro, e os 409 aqui são provocados.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

const aba = (page: Page, nome: RegExp) => page.getByRole('tab', { name: nome });
const cartao = (page: Page, id: number) => page.getByLabel(`Alerta ${id}`, { exact: true });

test('a aba Alertas da barra abre a tela com pendentes e reconhecidos separados', async ({
  page,
}) => {
  await simularApi(page, [alerta(1, CAMARA), alerta(2, FARMACIA, 'reconhecido')]);
  await page.goto('/');
  await page.getByRole('link', { name: 'Alertas' }).click();
  await expect(page).toHaveURL(/\/alertas$/);

  await expect(aba(page, /^Pendentes 1$/)).toHaveAttribute('aria-selected', 'true');
  await expect(aba(page, /^Reconhecidos 1$/)).toBeVisible();
  await expect(cartao(page, 1)).toContainText('Câmara fria');
  await expect(cartao(page, 1)).toContainText('Sensor 11');
  await expect(cartao(page, 1)).toContainText('9,4 °C');
  await expect(cartao(page, 2)).toHaveCount(0);

  await aba(page, /^Reconhecidos/).click();
  await expect(cartao(page, 2)).toContainText('Reconhecido por Bruno Reis');
  await expect(cartao(page, 1)).toHaveCount(0);
});

test('reconhecer passa o alerta para os reconhecidos com o meu nome', async ({ page }) => {
  await simularApi(page, [alerta(1, CAMARA)]);
  await page.goto('/alertas');
  await page.getByRole('button', { name: 'Reconhecer o alerta 1, Câmara fria' }).click();

  await expect(page.getByText('Alerta reconhecido, agora em Reconhecidos')).toBeVisible();
  await expect(aba(page, /^Pendentes 0$/)).toBeVisible();
  await expect(page.getByText('Nenhum alerta pendente.')).toBeVisible();
  await aba(page, /^Reconhecidos 1$/).click();
  await expect(cartao(page, 1)).toContainText('Reconhecido por Ana Lima em');
});

test('descrever a ação tomada encerra o alerta; vazio não envia', async ({ page }) => {
  const api = await simularApi(page, [alerta(1, CAMARA, 'reconhecido')]);
  await page.goto('/alertas');
  await aba(page, /^Reconhecidos/).click();
  const encerrar = page.getByRole('button', { name: 'Encerrar o alerta 1, Câmara fria' });

  await encerrar.click();
  await expect(page.getByText('Descreva a ação tomada para encerrar o alerta.')).toBeVisible();
  expect(api.encerramentos).toEqual([]);

  await page.getByLabel('Ação tomada no alerta 1, Câmara fria').fill('  Porta fechada.  ');
  await encerrar.click();
  await expect(page.getByText('Alerta encerrado')).toBeVisible();
  expect(api.encerramentos).toEqual([{ acao_corretiva: 'Porta fechada.' }]);
  await expect(aba(page, /^Reconhecidos 0$/)).toBeVisible();

  await aba(page, /^Encerrados/).click();
  await expect(cartao(page, 1)).toContainText('Porta fechada.');
});

test('409 aparece como mensagem e a lista se atualiza, sem quebrar a tela', async ({ page }) => {
  await simularApi(page, [alerta(1, CAMARA), alerta(3, CAMARA)], [1]);
  await page.goto('/alertas');
  await cartao(page, 1)
    .getByRole('button', { name: /^Reconhecer/ })
    .click();

  await expect(page.getByRole('alert')).toContainText('Alerta não está pendente.');
  await expect(cartao(page, 1)).toHaveCount(0);
  await expect(cartao(page, 3)).toBeVisible();
  await expect(aba(page, /^Reconhecidos 1$/)).toBeVisible();
  await aba(page, /^Reconhecidos/).click();
  await expect(cartao(page, 1)).toContainText('Reconhecido por Bruno Reis');
});

test('clique duplo em Reconhecer manda um pedido só', async ({ page }) => {
  const api = await simularApi(page, [alerta(1, CAMARA)]);
  await page.goto('/alertas');
  await page.getByRole('button', { name: 'Reconhecer o alerta 1, Câmara fria' }).dblclick();
  await expect(page.getByText('Alerta reconhecido, agora em Reconhecidos')).toBeVisible();
  expect(api.reconhecimentos).toBe(1);
  await expect(page.getByText(/não está pendente/)).toHaveCount(0);
});

test('o texto da ação tomada continua lá depois de trocar de aba', async ({ page }) => {
  await simularApi(page, [alerta(1, CAMARA, 'reconhecido')]);
  await page.goto('/alertas');
  await aba(page, /^Reconhecidos/).click();
  const campo = page.getByLabel('Ação tomada no alerta 1, Câmara fria');
  await campo.fill('Porta fechada.');
  await aba(page, /^Pendentes/).click();
  await expect(campo).toHaveCount(0);
  await aba(page, /^Reconhecidos/).click();
  await expect(campo).toHaveValue('Porta fechada.');
});

test('trocar de sala durante o POST não apaga os alertas da sala nova', async ({ page }) => {
  const api = await simularApi(page, [alerta(1, CAMARA), alerta(2, FARMACIA)], [], 1500);
  await page.goto('/alertas');
  await page.getByRole('button', { name: 'Reconhecer o alerta 1, Câmara fria' }).click();
  await page.getByRole('button', { name: 'Sala: Todas as salas' }).click();
  await page.getByRole('option', { name: 'Farmácia' }).click();

  await expect(page.getByText('Alerta reconhecido, agora em Reconhecidos')).toBeVisible();
  // A busca depois do POST é a da sala atual, e o alerta da Câmara não entra na lista dela.
  await expect.poll(() => api.consultas.at(-1)).toContain('sala_id=2');
  await expect(cartao(page, 2)).toBeVisible();
  await expect(cartao(page, 1)).toHaveCount(0);
  await expect(aba(page, /^Reconhecidos 0$/)).toBeVisible();
});

test('o filtro por sala pede à API só os alertas daquela sala', async ({ page }) => {
  const api = await simularApi(page, [alerta(1, CAMARA), alerta(2, FARMACIA)]);
  await page.goto('/alertas');
  await expect(cartao(page, 2)).toBeVisible();

  await page.getByRole('button', { name: 'Sala: Todas as salas' }).click();
  await page.getByRole('option', { name: 'Câmara fria' }).click();
  await expect(cartao(page, 2)).toHaveCount(0);
  await expect(cartao(page, 1)).toBeVisible();
  expect(api.consultas).toContain('?situacao=pendente&sala_id=1');
});
