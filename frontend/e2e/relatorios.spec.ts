import { expect, type Page, test } from '@playwright/test';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Expose-Headers': 'Content-Disposition',
};
const SALAS = [
  {
    id: 1,
    nome: 'Câmara fria 1',
    descricao: null,
    faixa: { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null },
  },
  {
    id: 2,
    nome: 'Farmácia',
    descricao: null,
    faixa: { temperatura_min: 15, temperatura_max: 25, umidade_min: 30, umidade_max: 60 },
  },
];

const linha = (minuto: number, temperatura: string, umidade: string, sensor: number) =>
  `16/10/2026 09:${String(minuto).padStart(2, '0')}:00;${temperatura};${umidade};${sensor}\r\n`;
const CABECALHO =
  '\uFEFFEstabelecimento;Hospital Central\r\nSala;Câmara fria 1\r\n' +
  'Período;01/10/2026 00:00:00 a 16/10/2026 23:59:59\r\nResponsável técnico;Ana Lima\r\n' +
  'Faixa de temperatura;2,0 a 8,0 °C\r\nFaixa de umidade;sem limite\r\n\r\n' +
  'Data e hora;Temperatura (°C);Umidade (%);ID do sensor\r\n';
// 30 leituras de dois sensores: passa de uma página e uma delas sai da faixa.
const CSV_COMPLETO =
  CABECALHO +
  Array.from({ length: 30 }, (_, i) =>
    i === 7 ? linha(i, '9,1', '50,0', 12) : linha(i, '5,0', '50,0', i % 2 ? 13 : 12),
  ).join('');

/** Simula a API. `relatorio` responde o download e guarda a query de cada pedido. */
async function simularApi(
  page: Page,
  opcoes: { salas?: unknown; relatorio?: number; csv?: string } = {},
) {
  const dados = { falhar: false, pedidos: [] as URLSearchParams[] };
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (pedido.method() === 'OPTIONS') return responder(204);
    if (dados.falhar) return rota.abort();
    if (url.pathname === '/auth/me') return responder(200, { id: 1, nome: 'Ana Lima', email: 'a' });
    if (url.pathname === '/salas') return responder(200, opcoes.salas ?? SALAS);
    if (url.pathname === '/relatorios/leituras') {
      dados.pedidos.push(url.searchParams);
      const status = opcoes.relatorio ?? 200;
      if (status === 401) return responder(401, { detail: 'não autenticado' });
      if (status !== 200) return responder(status, { detail: 'a API recusou o período' });
      return rota.fulfill({
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="relatorio-leituras-sala-2.csv"',
        },
        body: opcoes.csv ?? CSV_COMPLETO,
      });
    }
    return responder(200, []);
  });
  return dados;
}

/** A lista própria de salas: abre e escolhe, como quem usa o mouse. */
async function escolherSala(page: Page, nome: string) {
  await page.getByRole('button', { name: /^Sala:/ }).click();
  await page.getByRole('option', { name: nome }).click();
}

let erros: string[] = [];
test.beforeEach(({ page }) => {
  erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    // O navegador registra toda resposta de erro e falha de rede, que aqui são provocadas.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      erros.push(m.text());
    }
  });
});
test.afterEach(() => expect(erros).toEqual([]));

test('sem login, /relatorios redireciona para o login', async ({ page }) => {
  await page.goto('/relatorios');
  await expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
});

test('o painel leva aos relatórios, no computador e no celular', async ({ page }) => {
  await simularApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
});

test('escolhe sala e período e baixa o arquivo com o nome da API', async ({ page }) => {
  const api = await simularApi(page);
  await page.clock.setFixedTime(new Date(2026, 9, 20, 12));
  await page.goto('/relatorios');
  await escolherSala(page, 'Farmácia');
  await page.getByRole('button', { name: '1 de outubro de 2026', exact: true }).click();
  await page.getByRole('button', { name: '16 de outubro de 2026' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar relatório' }).click();
  expect((await download).suggestedFilename()).toBe('relatorio-leituras-sala-2.csv');
  await expect(page.getByText('relatorio-leituras-sala-2.csv baixado')).toBeVisible();

  const query = api.pedidos.at(-1) as URLSearchParams;
  expect(query.get('sala_id')).toBe('2');
  expect(query.get('formato')).toBe('csv');
  expect(query.get('inicio')).toMatch(/^2026-10-01T00:00:00[+-]\d\d:\d\d$/);
  expect(query.get('fim')).toMatch(/^2026-10-16T23:59:59[+-]\d\d:\d\d$/);
});

test('a prévia mostra o conteúdo do arquivo e acompanha sala e período', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/relatorios');
  await expect(page.getByText('Hospital Central')).toBeVisible();
  await expect(page.getByText('Ana Lima')).toBeVisible();
  await expect(page.getByText('2,0 a 8,0 °C')).toBeVisible();
  await expect(page.getByText('1 a 25 de 30')).toBeVisible();
  await expect.poll(() => api.pedidos.length).toBe(1);
  await escolherSala(page, 'Farmácia');
  await expect.poll(() => api.pedidos.at(-1)?.get('sala_id')).toBe('2');
  await page.getByRole('button', { name: 'Últimos 30 dias' }).click();
  await expect.poll(() => api.pedidos.length).toBe(3);
});

test('a prévia é interativa: grandeza, sensor, fora da faixa e páginas', async ({ page }) => {
  await simularApi(page);
  await page.goto('/relatorios');
  await expect(page.getByText('1 a 25 de 30')).toBeVisible();

  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page.getByText('26 a 30 de 30')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Só fora da faixa' }).click();
  await expect(page.getByText('1 a 1 de 1')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Só fora da faixa' }).click();

  await page.getByRole('checkbox', { name: 'Sensor 13' }).click();
  await expect(page.getByRole('checkbox', { name: 'Sensor 13' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByText('1 a 16 de 16')).toBeVisible();

  await page.getByRole('radio', { name: 'Umidade' }).click();
  await expect(page.getByRole('img', { name: /Gráfico de umidade/ })).toBeVisible();

  // Sem nenhum sensor, o gráfico explica em vez de ficar vazio.
  await page.getByRole('checkbox', { name: 'Sensor 12' }).click();
  await expect(page.getByText('Escolha ao menos um sensor')).toBeVisible();
});

test('passar o ponteiro no gráfico mostra a leitura de cada sensor', async ({ page }) => {
  await simularApi(page);
  await page.goto('/relatorios');
  const area = page.getByTestId('area-do-grafico');
  await area.hover({ position: { x: 300, y: 100 } });
  await expect(page.getByText(/^Sensor 12$/).last()).toBeVisible();
  await expect(page.getByText(/^5,0 °C$/).first()).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByText(/^5,0 °C$/)).toHaveCount(0);
});

test('sensor com uma leitura só aparece no gráfico como marcador', async ({ page }) => {
  await simularApi(page, {
    csv: `${CABECALHO}${linha(0, '5,0', '50,0', 12)}${linha(0, '7,0', '50,0', 13)}`,
  });
  await page.goto('/relatorios');
  await expect(
    page.getByRole('img', { name: /Gráfico de temperatura/ }).locator('circle'),
  ).toHaveCount(2);
});

test('período sem leituras avisa e o arquivo continua disponível', async ({ page }) => {
  await simularApi(page, { csv: CABECALHO });
  await page.goto('/relatorios');
  await expect(page.getByText('Nenhuma leitura neste período')).toBeVisible();
  await expect(page.getByText('Hospital Central')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar relatório' })).toBeEnabled();
});

test('os atalhos preenchem o período', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 20, 12));
  await simularApi(page);
  await page.goto('/relatorios');
  await page.getByRole('button', { name: 'Últimos 30 dias' }).click();
  await expect(page.getByText('21/09/2026')).toBeVisible();
  await expect(page.getByText('20/10/2026').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Últimos 30 dias' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('o calendário escolhe o período, acerta a ordem e espera o fim para a prévia', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 9, 20, 12));
  const api = await simularApi(page);
  await page.goto('/relatorios');
  await expect.poll(() => api.pedidos.length).toBe(1);

  // Clicou no dia 16 e depois no 1: o período vira de 1 a 16, sem erro.
  await page.getByRole('button', { name: '16 de outubro de 2026' }).click();
  await expect(page.getByText('Escolha o dia')).toBeVisible();
  await expect(page.getByText(/A prévia aparece em seguida/)).toBeVisible();
  await page.getByRole('button', { name: 'Baixar relatório' }).click();
  await expect(page.getByRole('alert')).toContainText('Escolha o último dia');
  expect(api.pedidos).toHaveLength(1);

  await page.getByRole('button', { name: '1 de outubro de 2026', exact: true }).click();
  await expect.poll(() => api.pedidos.length).toBe(2);
  expect(api.pedidos[1].get('inicio')).toMatch(/^2026-10-01T00:00:00/);
  expect(api.pedidos[1].get('fim')).toMatch(/^2026-10-16T23:59:59/);

  // Dia futuro não abre, e o mês seguinte não existe ainda.
  await expect(page.getByRole('button', { name: '21 de outubro de 2026' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Próximo mês' })).toBeDisabled();
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page.getByText('Setembro de 2026')).toBeVisible();
});

test('a lista de salas funciona pelo teclado e fecha com Esc ou clique fora', async ({ page }) => {
  const api = await simularApi(page);
  await page.goto('/relatorios');
  const botao = page.getByRole('button', { name: /^Sala:/ });
  await botao.click();
  await expect(page.getByRole('option', { name: 'Câmara fria 1' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Farmácia' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);

  await botao.click();
  await page.getByRole('heading', { name: 'Relatórios' }).click();
  await expect(page.getByRole('option')).toHaveCount(0);

  await botao.click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sala: Farmácia' })).toBeVisible();
  await expect.poll(() => api.pedidos.at(-1)?.get('sala_id')).toBe('2');
});

test('a tela não usa campos nativos do navegador', async ({ page }) => {
  await simularApi(page);
  await page.goto('/relatorios');
  await expect(page.getByRole('button', { name: /^Sala:/ })).toBeVisible();
  await expect(page.locator('select, input, datalist')).toHaveCount(0);
});

test('PDF e Excel aparecem como indisponíveis', async ({ page }) => {
  await simularApi(page);
  await page.goto('/relatorios');
  await expect(page.getByRole('radio', { name: 'PDF, ainda não disponível' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('radio', { name: 'Excel, ainda não disponível' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'CSV', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('o erro da API aparece como mensagem', async ({ page }) => {
  await simularApi(page, { relatorio: 422 });
  await page.goto('/relatorios');
  await expect(page.getByText('Não foi possível gerar a prévia.')).toBeVisible();
  await page.getByRole('button', { name: 'Baixar relatório' }).click();
  await expect(page.getByRole('alert')).toContainText('a API recusou o período');
  await expect(page.getByRole('button', { name: 'Baixar relatório' })).toBeEnabled();
});

test('401 no download volta para o login', async ({ page }) => {
  await simularApi(page, { relatorio: 401 });
  await page.goto('/relatorios');
  await expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
});

test('sem sala cadastrada e com a API fora do ar', async ({ page }) => {
  const api = await simularApi(page, { salas: [] });
  await page.goto('/relatorios');
  await expect(page.getByText('Nenhuma sala cadastrada')).toBeVisible();

  api.falhar = true;
  await page.reload();
  await expect(page.getByText('Não foi possível carregar as salas')).toBeVisible();
  api.falhar = false;
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByText('Nenhuma sala cadastrada')).toBeVisible();
});

for (const largura of [320, 390, 768, 1280, 1920]) {
  test(`sem rolagem lateral em ${largura} px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await simularApi(page);
    await page.goto('/relatorios');
    await expect(page.getByRole('button', { name: 'Baixar relatório' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('*')].some((e) => {
            const estilo = getComputedStyle(e);
            return (
              e.scrollWidth > e.clientWidth + 1 &&
              ['auto', 'scroll'].includes(estilo.overflowX) &&
              e.clientWidth > 0
            );
          }),
        ),
      )
      .toBe(false);
    await page.getByRole('button', { name: 'Baixar relatório' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Baixar relatório' })).toBeInViewport();
  });
}
