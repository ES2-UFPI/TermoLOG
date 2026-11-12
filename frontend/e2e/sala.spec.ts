import { expect, type Page, test } from '@playwright/test';
import { historico, type Periodo } from './apoio/historico';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

const FAIXA = { temperatura_min: 2, temperatura_max: 8, umidade_min: 30, umidade_max: 60 };
const leitura = (sensor_id: number, temperatura: number, umidade = 50) => ({
  sensor_id,
  temperatura,
  umidade,
  data_hora: new Date().toISOString(),
});
const sensor = (id: number, ativo = true) => ({
  id,
  gateway_id: 1,
  ativo,
  data_cadastro: '2026-10-01T12:00:00Z',
});

type Sala = {
  sala_id: number;
  nome: string;
  descricao?: string | null;
  faixa?: typeof FAIXA;
  status: 'ok' | 'fora_da_faixa' | 'sem_leitura';
  conformidade_24h?: number | null;
  leituras: ReturnType<typeof leitura>[];
  sensores: ReturnType<typeof sensor>[];
};

// Uma sala de cada tipo que os critérios de aceite pedem.
const salas = (): Sala[] => [
  {
    sala_id: 1,
    nome: 'Câmara fria 1',
    descricao: 'Vacinas do bloco C',
    status: 'fora_da_faixa',
    conformidade_24h: 87.5,
    leituras: [leitura(12, 9.1, 61), leitura(13, 5.04, 55), leitura(14, 5.2, 54)],
    sensores: [sensor(12), sensor(13), sensor(14), sensor(9, false)],
  },
  {
    sala_id: 2,
    nome: 'Farmácia',
    status: 'ok',
    conformidade_24h: 100,
    leituras: [leitura(20, 5, 45)],
    sensores: [sensor(20)],
  },
  {
    sala_id: 3,
    nome: 'Almoxarifado',
    status: 'sem_leitura',
    conformidade_24h: null,
    leituras: [],
    sensores: [sensor(30)],
  },
  { sala_id: 4, nome: 'Sala vazia', status: 'sem_leitura', leituras: [], sensores: [] },
];

/** Simula a API. Cada teste muda só o que precisa: perfil, respostas ou falhas. */
async function simularApi(page: Page, perfil?: string) {
  const dados = { salas: salas(), falhar: false, proximoSensor: 40 };
  const pedidos: string[] = [];
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const pedido = rota.request();
    const caminho = new URL(pedido.url()).pathname;
    const metodo = pedido.method();
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (metodo === 'OPTIONS') return responder(204);
    pedidos.push(`${metodo} ${caminho}`);
    if (dados.falhar) return rota.abort();
    if (caminho === '/auth/me') {
      return responder(200, { id: 1, nome: 'Ana', email: 'ana@exemplo.com', perfil });
    }
    if (caminho === '/salas/status') {
      return responder(
        200,
        dados.salas.map(({ sensores: _s, descricao: _d, ...s }) => ({
          intervalo_leitura_s: null,
          ...s,
          faixa: s.faixa ?? FAIXA,
        })),
      );
    }
    if (caminho === '/gateways') {
      return responder(200, [{ id: 1, nome: 'Bloco C', online: true, ultimo_contato: null }]);
    }
    const desativar = caminho.match(/^\/sensores\/(\d+)\/desativar$/);
    if (desativar) {
      const id = Number(desativar[1]);
      const dono = dados.salas.find((s) => s.sensores.some((x) => x.id === id));
      if (!dono) return responder(404, { detail: 'sensor não encontrado' });
      dono.sensores = dono.sensores.map((x) => (x.id === id ? { ...x, ativo: false } : x));
      dono.leituras = dono.leituras.filter((l) => l.sensor_id !== id);
      return responder(200, { ...sensor(id, false), sala_id: dono.sala_id, sala_nome: dono.nome });
    }
    if (/^\/salas\/\d+\/historico$/.test(caminho)) {
      const busca = new URL(pedido.url()).searchParams;
      return responder(
        200,
        historico((busca.get('periodo') ?? 'dia') as Periodo, busca.get('fim')),
      );
    }
    const m = caminho.match(/^\/salas\/(\d+)(\/sensores)?$/);
    const sala = m && dados.salas.find((s) => s.sala_id === Number(m[1]));
    if (m && !sala) return responder(404, { detail: 'sala não encontrada' });
    if (sala && m?.[2] && metodo === 'POST') {
      const novo = sensor(dados.proximoSensor++);
      sala.sensores = [...sala.sensores, novo];
      return responder(201, { ...novo, sala_id: sala.sala_id, sala_nome: sala.nome });
    }
    if (sala && m?.[2]) return responder(200, sala.sensores);
    if (sala) {
      return responder(200, {
        id: sala.sala_id,
        nome: sala.nome,
        descricao: sala.descricao ?? null,
        faixa: sala.faixa ?? FAIXA,
        sensores: sala.sensores,
      });
    }
    return responder(200, []);
  });
  return { dados, pedidos };
}

// Nenhum teste aceita erro de JavaScript nem erro no console.
let erros: string[] = [];
test.beforeEach(({ page }) => {
  erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    // O navegador registra toda resposta 404 e toda falha de rede, que aqui são provocadas.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

const semRolagemLateral = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('*')].some((e) => {
            const estilo = getComputedStyle(e);
            return (
              e.scrollWidth > e.clientWidth + 1 &&
              ['auto', 'scroll'].includes(estilo.overflowX) &&
              e.clientWidth > 0
            );
          }) || document.documentElement.scrollWidth > window.innerWidth,
      ),
    )
    .toBe(false);

test('o botão Ver sala do card abre a tela e o voltar retorna ao painel', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Ver sala Farmácia' }).click();
  await expect(page).toHaveURL(/\/sala\/2$/);
  await expect(page.getByRole('heading', { name: 'Farmácia' })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar ao painel' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Ver sala Farmácia' })).toBeVisible();
});

test('a sala fora da faixa em destaque também tem o Ver sala', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Ver sala Câmara fria 1' }).click();
  await expect(page).toHaveURL(/\/sala\/1$/);
});

test('vários sensores: o card diz qual é o destaque e cada ponto se identifica', async ({
  page,
}) => {
  const { dados } = await simularApi(page);
  // Uma sala ok, porque a primeira fora da faixa vai para o bloco de destaque.
  dados.salas[0].status = 'ok';
  dados.salas[0].leituras = [leitura(12, 7.5), leitura(13, 5.04), leitura(14, 5.2)];
  await page.goto('/');
  const card = page.getByRole('link', { name: 'Ver sala Câmara fria 1' }).locator('../..');
  await expect(card.getByText('Sensor 12 · pior leitura')).toBeVisible();
  await expect(card.getByText('+2 sensores · de 5,0 a 7,5 °C')).toBeVisible();
  for (const id of [12, 13, 14]) {
    await expect(card.getByRole('button', { name: new RegExp(`^Sensor ${id}:`) })).toHaveCount(1);
  }
  // Com o mouse em cima do ponto, a dica mostra o ID e a leitura.
  await card.getByRole('button', { name: /^Sensor 12:/ }).hover();
  await expect(card.getByText('7,5 °C · 50%')).toBeVisible();
});

test('um sensor: o card diz qual é, sem falar em pior leitura nem em outros', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const card = page.getByRole('link', { name: 'Ver sala Farmácia' }).locator('../..');
  await expect(card.getByText(/^Sensor 20 · \d\d:\d\d$/)).toBeVisible();
  await expect(card.getByText('pior leitura')).toHaveCount(0);
  await expect(card.getByText(/\+\d+ sensor/)).toHaveCount(0);
});

test('sala sem leitura: o card avisa e não inventa sensor', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  const card = page.getByRole('link', { name: 'Ver sala Almoxarifado' }).locator('../..');
  await expect(card.getByText('Nenhum sensor ativo enviou dados')).toBeVisible();
  await expect(card.getByText(/^Sensor \d/)).toHaveCount(0);
});

test('a tela mostra os dados da sala e cada sensor separado', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/1');
  await expect(page.getByRole('heading', { name: 'Câmara fria 1' })).toBeVisible();
  await expect(page.getByText('Vacinas do bloco C')).toBeVisible();
  await expect(page.getByText('Fora da faixa', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2 a 8 °C')).toBeVisible();
  await expect(page.getByText('30 a 60%')).toBeVisible();
  await expect(page.getByText('Não definido')).toBeVisible();
  await expect(page.getByText('87,5%')).toBeVisible();
  await expect(page.getByText('3 ativos · 1 inativo')).toBeVisible();

  for (const nome of ['Sensor 12', 'Sensor 13', 'Sensor 14']) {
    await expect(page.getByLabel(nome, { exact: true })).toBeVisible();
  }
  const pior = page.getByLabel('Sensor 12', { exact: true });
  await expect(pior.getByText('pior leitura')).toBeVisible();
  await expect(pior.getByText('9,1 °C')).toBeVisible();
  await expect(pior.getByText('61,0% de umidade')).toBeVisible();
  await expect(pior.getByText('Fora da faixa')).toBeVisible();
  await expect(pior.getByText('Bloco C')).toBeVisible();
  await expect(pior.getByText('01/10/2026')).toBeVisible();
  await expect(
    page.getByLabel('Sensor 13', { exact: true }).getByText('Dentro da faixa'),
  ).toBeVisible();
  // O sensor desativado aparece, mas fora da comparação.
  await expect(page.getByText('Sensor 9')).toBeVisible();
  await expect(page.getByText('Inativo', { exact: true })).toBeVisible();
  // As réguas leem todos os sensores na mesma escala.
  await expect(
    page.getByRole('img', { name: /^Temperatura: sensor 12, 9,1 °C, fora da faixa; sensor 13/ }),
  ).toBeVisible();
});

test('um sensor só e sensor que ainda não leu aparecem sem pior leitura', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/2');
  await expect(
    page.getByLabel('Sensor 20', { exact: true }).getByText('Dentro da faixa'),
  ).toBeVisible();
  await expect(page.getByText('pior leitura')).toHaveCount(0);

  await page.goto('/sala/3');
  await expect(page.getByText('Sem leitura', { exact: true })).toBeVisible();
  await expect(page.getByText('Ainda não enviou leitura')).toBeVisible();
  await expect(page.getByRole('img', { name: /^Temperatura:/ })).toHaveCount(0);

  await page.goto('/sala/4');
  await expect(page.getByText('Nenhum sensor ativo nesta sala')).toBeVisible();
});

test('administrador adiciona e desativa sensor pela tela', async ({ page }) => {
  await simularApi(page, 'administrador');
  await page.goto('/sala/3');
  await page.getByRole('button', { name: 'Adicionar sensor' }).click();
  await page.getByRole('radio', { name: /^Bloco C/ }).click();
  await page.getByRole('button', { name: 'Adicionar sensor' }).last().click();
  await expect(page.getByText('Sensor adicionado')).toBeVisible();
  await expect(page.getByLabel('ID do sensor: 40')).toBeVisible();
  await expect(page.getByLabel('Sensor 40', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Desativar sensor 30' }).click();
  await expect(page.getByText('Desativar o sensor 30?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar: desativar sensor 30' }).click();
  await expect(page.getByLabel('Sensor 30', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Inativo', { exact: true })).toBeVisible();
});

test('editar a sala abre a gaveta sem repetir os sensores', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/2');
  await page.getByRole('button', { name: 'Editar sala' }).click();
  await expect(page.getByLabel('Nome')).toHaveValue('Farmácia');
  await expect(page.getByLabel('Sensores da sala')).toHaveCount(0);
});

test('visualizador vê as informações, sem as ações e sem chamar rota de administrador', async ({
  page,
}) => {
  const { pedidos } = await simularApi(page, 'visualizador');
  await page.goto('/sala/1');
  await expect(page.getByLabel('Sensor 12', { exact: true })).toBeVisible();
  // Depois que o perfil chegou.
  await expect.poll(() => pedidos).toContain('GET /auth/me');
  await expect(page.getByRole('button', { name: 'Editar sala' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adicionar sensor' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Desativar/ })).toHaveCount(0);
  expect(pedidos).not.toContain('GET /gateways');
  expect(pedidos).not.toContain('GET /salas/1/sensores');
  await expect(page.getByLabel('Sensor 12', { exact: true }).getByText('Gateway 1')).toBeVisible();
});

test('sala que não existe e endereço inválido mostram o aviso com o caminho de volta', async ({
  page,
}) => {
  await simularApi(page);
  for (const rota of ['/sala/999', '/sala/abc']) {
    await page.goto(rota);
    await expect(page.getByText('Sala não encontrada')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar ao painel' }).first()).toBeVisible();
  }
});

test('a API fora do ar mostra o erro, e tentar de novo carrega', async ({ page }) => {
  const { dados } = await simularApi(page);
  dados.falhar = true;
  await page.goto('/sala/1');
  await expect(page.getByText('Não foi possível carregar a sala')).toBeVisible();
  dados.falhar = false;
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('heading', { name: 'Câmara fria 1' })).toBeVisible();
});

test('atualiza sozinha a cada 30 s, e a falha mantém os dados na tela', async ({ page }) => {
  await page.clock.install();
  const { dados } = await simularApi(page);
  await page.goto('/sala/2');
  await expect(page.getByLabel('Sensor 20', { exact: true }).getByText('5,0 °C')).toBeVisible();

  dados.salas[1].leituras = [leitura(20, 6.5, 45)];
  await page.clock.fastForward(30_000);
  await expect(page.getByLabel('Sensor 20', { exact: true }).getByText('6,5 °C')).toBeVisible();

  dados.falhar = true;
  await page.clock.fastForward(30_000);
  await expect(page.getByText('A última busca falhou')).toBeVisible();
  await expect(page.getByLabel('Sensor 20', { exact: true }).getByText('6,5 °C')).toBeVisible();
});

for (const largura of [320, 390, 768, 1280, 1920]) {
  test(`sem rolagem lateral em ${largura} px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await simularApi(page);
    await page.goto('/sala/1');
    await expect(page.getByLabel('Sensor 14', { exact: true })).toBeVisible();
    await semRolagemLateral(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Ver sala Farmácia' })).toBeVisible();
    await semRolagemLateral(page);
  });
}
