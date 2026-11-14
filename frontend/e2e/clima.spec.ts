import { expect, type Page, test } from '@playwright/test';
import { historico, type Periodo } from './apoio/historico';

// Controle do ar-condicionado na tela da sala (#162), com a API simulada (#160).

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};
const FAIXA = { temperatura_min: 16, temperatura_max: 22, umidade_min: 30, umidade_max: 60 };
const sensor = (id: number) => ({
  id,
  gateway_id: 1,
  ativo: true,
  data_cadastro: '2026-10-01T12:00:00Z',
});

type Comando = {
  id: number;
  sala_id: number;
  sensor_id: number;
  acao: 'ligar' | 'desligar' | 'ajustar';
  temperatura_c: number | null;
  usuario: { id: number; nome: string };
  criado_em: string;
  expira_em: string;
  situacao: 'pendente' | 'entregue' | 'expirado';
};
const comando = (
  id: number,
  acao: Comando['acao'],
  situacao: Comando['situacao'],
  criado_em: string,
  temperatura_c: number | null = null,
  nome = 'Ana Lima',
): Comando => ({
  id,
  sala_id: 1,
  sensor_id: 17,
  acao,
  temperatura_c,
  usuario: { id: 1, nome },
  criado_em,
  expira_em: criado_em,
  situacao,
});

/**
 * A API da sala 1 com o histórico de comandos. `entregar` faz o próximo GET devolver os
 * pendentes como entregues, como se o gateway tivesse lido o lote.
 */
async function simularApi(
  page: Page,
  { perfil, sensorDoClima = 17 as number | null } = {} as {
    perfil?: string;
    sensorDoClima?: number | null;
  },
) {
  const dados = {
    sensorDoClima,
    entregar: false,
    /** Enquanto existir, o próximo GET da lista espera por ela e responde a lista de antes. */
    segurar: null as Promise<void> | null,
    recusar: null as null | { status: number; detail: string },
    comandos: [
      comando(2, 'ajustar', 'entregue', '2026-11-13T11:20:00Z', 22),
      comando(1, 'ligar', 'entregue', '2026-11-13T10:58:00Z', null, 'Marcos Vinícius'),
    ],
    proximo: 3,
  };
  const pedidos: { metodo: string; caminho: string; corpo: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const caminho = url.pathname;
    const metodo = pedido.method();
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (metodo === 'OPTIONS') return responder(204);
    pedidos.push({ metodo, caminho, corpo: pedido.postDataJSON?.() ?? null });
    if (caminho === '/auth/me') {
      return responder(200, { id: 1, nome: 'Ana Lima', email: 'ana@exemplo.com', perfil });
    }
    if (caminho === '/salas/status') {
      return responder(200, [
        {
          sala_id: 1,
          nome: 'Sala de Servidores',
          status: 'fora_da_faixa',
          faixa: FAIXA,
          intervalo_leitura_s: 30,
          conformidade_24h: 92.4,
          leituras: [
            { sensor_id: 17, temperatura: 24.6, umidade: 48, data_hora: new Date().toISOString() },
            { sensor_id: 18, temperatura: 21.3, umidade: 47, data_hora: new Date().toISOString() },
          ],
        },
      ]);
    }
    if (caminho === '/gateways') {
      return responder(200, [{ id: 1, nome: 'Bloco B', online: true, ultimo_contato: null }]);
    }
    if (caminho === '/salas/1/historico') {
      return responder(200, historico((url.searchParams.get('periodo') ?? 'dia') as Periodo, null));
    }
    if (caminho === '/salas/1/climatizacao' && metodo === 'POST') {
      if (dados.recusar) return responder(dados.recusar.status, { detail: dados.recusar.detail });
      const corpo = pedido.postDataJSON() as { acao: Comando['acao']; temperatura_c?: number };
      const novo = comando(
        dados.proximo++,
        corpo.acao,
        'pendente',
        new Date().toISOString(),
        corpo.temperatura_c ?? null,
      );
      dados.comandos = [novo, ...dados.comandos];
      return responder(202, novo);
    }
    if (caminho === '/salas/1/climatizacao') {
      if (dados.segurar) {
        const antes = [...dados.comandos];
        const espera = dados.segurar;
        dados.segurar = null;
        await espera;
        return responder(200, antes);
      }
      if (dados.entregar) {
        dados.comandos = dados.comandos.map((c) =>
          c.situacao === 'pendente' ? { ...c, situacao: 'entregue' } : c,
        );
      }
      return responder(200, dados.comandos);
    }
    if (caminho === '/salas/1' && metodo === 'PATCH') {
      const corpo = pedido.postDataJSON() as { sensor_climatizacao_id?: number | null };
      if (corpo.sensor_climatizacao_id !== undefined) {
        dados.sensorDoClima = corpo.sensor_climatizacao_id;
      }
    }
    if (caminho === '/salas/1') {
      return responder(200, {
        id: 1,
        nome: 'Sala de Servidores',
        descricao: 'Bloco B, rack 1 a 6',
        faixa: FAIXA,
        intervalo_leitura_s: 30,
        sensores: [sensor(17), sensor(18)],
        sensor_climatizacao_id: dados.sensorDoClima,
      });
    }
    if (caminho === '/salas/1/sensores') return responder(200, []);
    return responder(200, []);
  });
  return { dados, pedidos };
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

const secao = (page: Page) => page.getByRole('region', { name: 'Ar-condicionado' });

test('o administrador vê o controle, o aviso do ciclo e a lista de comandos', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/1');
  const clima = secao(page);
  await expect(clima.getByRole('heading', { name: 'Ar-condicionado' })).toBeVisible();
  await expect(clima.getByText('Emissor infravermelho no Sensor 17')).toBeVisible();
  // O estado é o do último comando entregue.
  await expect(clima.getByText('Ligado, meta 22 °C')).toBeVisible();
  await expect(clima.getByRole('slider', { name: 'Meta do ar-condicionado' })).toHaveAttribute(
    'aria-valuenow',
    '22',
  );
  await expect(clima.getByRole('button', { name: 'Ligar', exact: true })).toBeVisible();
  await expect(clima.getByRole('button', { name: 'Desligar', exact: true })).toBeVisible();
  await expect(clima.getByRole('button', { name: 'Ajustar', exact: true })).toBeDisabled();
  await expect(
    clima.getByText(
      'O comando chega ao equipamento no próximo ciclo de leitura do nó e fica pendente até lá.',
    ),
  ).toBeVisible();
  await expect(clima.getByRole('heading', { name: 'Comandos da sala' })).toBeVisible();
  await expect(clima.getByText('Marcos Vinícius')).toBeVisible();
  await expect(clima.getByText('Entregue', { exact: true })).toHaveCount(2);
});

test('ligar cria o comando pendente, que vira entregue no ciclo seguinte', async ({ page }) => {
  const { dados, pedidos } = await simularApi(page);
  await page.goto('/sala/1');
  const clima = secao(page);
  await clima.getByRole('button', { name: 'Desligar', exact: true }).click();
  await expect(clima.getByText('Desligar enviado, pendente')).toBeVisible();
  await expect(clima.getByText('Pendente', { exact: true })).toBeVisible();
  expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo)).toEqual([
    { acao: 'desligar' },
  ]);
  // Ainda pendente: o estado não muda antes da entrega.
  await expect(clima.getByText('Ligado, meta 22 °C')).toBeVisible();

  dados.entregar = true;
  await expect(clima.getByText('Pendente', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(clima.getByText('Entregue', { exact: true })).toHaveCount(3);
  await expect(clima.getByText('Desligado', { exact: true })).toBeVisible();
});

test('a resposta atrasada de uma busca antiga não apaga o comando enviado', async ({ page }) => {
  const { dados } = await simularApi(page);
  let soltar = () => {};
  dados.segurar = new Promise<void>((r) => {
    soltar = r;
  });
  await page.goto('/sala/1');
  const clima = secao(page);
  await clima.getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect(clima.getByText('Pendente', { exact: true })).toBeVisible();
  soltar();
  // A lista antiga, sem o comando novo, chega depois do POST e não pode valer.
  await page.waitForTimeout(1_000);
  await expect(clima.getByText('Pendente', { exact: true })).toBeVisible();
});

test('ajustar envia a nova meta, pelo seletor ou pelo teclado no dial', async ({ page }) => {
  const { pedidos } = await simularApi(page);
  await page.goto('/sala/1');
  const clima = secao(page);
  const ajustar = clima.getByRole('button', { name: 'Ajustar', exact: true });
  await clima.getByRole('button', { name: 'Diminuir 1 grau' }).click();
  await clima.getByRole('button', { name: 'Diminuir 1 grau' }).click();
  await expect(ajustar).toBeEnabled();
  await ajustar.click();
  await expect(clima.getByText('Ajustar para 20 °C enviado, pendente')).toBeVisible();

  const dial = clima.getByRole('slider', { name: 'Meta do ar-condicionado' });
  await dial.focus();
  await page.keyboard.press('End');
  await expect(dial).toHaveAttribute('aria-valuenow', '30');
  // PageDown e PageUp andam 5 graus.
  await page.keyboard.press('PageDown');
  await expect(dial).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowDown');
  await expect(dial).toHaveAttribute('aria-valuenow', '29');
  await page.keyboard.press('Enter');
  await expect(clima.getByText('Ajustar para 29 °C enviado, pendente')).toBeVisible();
  expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo)).toEqual([
    { acao: 'ajustar', temperatura_c: 20 },
    { acao: 'ajustar', temperatura_c: 29 },
  ]);
});

test('o seletor não passa de 16 nem de 30 °C', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/1');
  const clima = secao(page);
  // De 22 a 16 °C: seis toques, e o botão desliga no limite.
  for (let i = 0; i < 6; i++) await clima.getByRole('button', { name: 'Diminuir 1 grau' }).click();
  await expect(clima.getByRole('button', { name: 'Diminuir 1 grau' })).toBeDisabled();
  await expect(clima.getByRole('slider', { name: 'Meta do ar-condicionado' })).toHaveAttribute(
    'aria-valuenow',
    '16',
  );
});

test('a recusa da API aparece como mensagem', async ({ page }) => {
  const { dados } = await simularApi(page);
  dados.recusar = { status: 422, detail: 'sala sem sensor de climatização' };
  await page.goto('/sala/1');
  await secao(page).getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect(secao(page).getByRole('alert')).toContainText('sala sem sensor de climatização');
});

test('o visualizador vê a lista, mas não os botões', async ({ page }) => {
  await simularApi(page, { perfil: 'visualizador' });
  await page.goto('/sala/1');
  const clima = secao(page);
  await expect(clima.getByText('Marcos Vinícius')).toBeVisible();
  await expect(clima.getByText('Só administradores enviam comandos.')).toBeVisible();
  await expect(clima.getByRole('button', { name: 'Ligar', exact: true })).toHaveCount(0);
  await expect(clima.getByRole('slider')).toHaveCount(0);
});

test('sala sem sensor de climatização: o administrador é levado a escolher um', async ({
  page,
}) => {
  const { pedidos } = await simularApi(page, { sensorDoClima: null });
  await page.goto('/sala/1');
  const clima = secao(page);
  await expect(clima.getByText('Esta sala não tem sensor de climatização')).toBeVisible();
  await expect(clima.getByRole('button', { name: 'Ligar', exact: true })).toHaveCount(0);
  await clima.getByRole('button', { name: 'Escolher o sensor de climatização' }).click();

  const grupo = page.getByRole('radiogroup', { name: 'Sensor de climatização' });
  await expect(grupo.getByRole('radio', { name: 'Nenhum' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await grupo.getByRole('radio', { name: 'Sensor 17' }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(clima.getByText('Emissor infravermelho no Sensor 17')).toBeVisible();
  const patch = pedidos.find((p) => p.metodo === 'PATCH');
  expect(patch?.corpo).toMatchObject({ sensor_climatizacao_id: 17 });
});

test('salvar só o nome não manda o sensor de climatização', async ({ page }) => {
  const { pedidos } = await simularApi(page);
  await page.goto('/sala/1');
  await page.getByRole('button', { name: 'Editar sala', exact: true }).click();
  // O campo aparece quando o detalhe da sala chega, já com o sensor atual.
  await expect(
    page
      .getByRole('radiogroup', { name: 'Sensor de climatização' })
      .getByRole('radio', { name: 'Sensor 17' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Nome').fill('Servidores');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => pedidos.some((p) => p.metodo === 'PATCH')).toBe(true);
  // Outro administrador pode ter trocado o sensor enquanto a gaveta estava aberta.
  expect(pedidos.find((p) => p.metodo === 'PATCH')?.corpo).not.toHaveProperty(
    'sensor_climatizacao_id',
  );
});

test('o visualizador não vê a seção numa sala sem sensor de climatização', async ({ page }) => {
  await simularApi(page, { perfil: 'visualizador', sensorDoClima: null });
  await page.goto('/sala/1');
  await expect(page.getByRole('heading', { name: 'Sala de Servidores' })).toBeVisible();
  await expect(secao(page)).toHaveCount(0);
});

test('o sensor do emissor ganha a marca no card', async ({ page }) => {
  await simularApi(page);
  await page.goto('/sala/1');
  await expect(page.getByLabel('Sensor 17').getByText('Emissor de climatização')).toBeVisible();
  await expect(page.getByLabel('Sensor 18').getByText('Emissor de climatização')).toHaveCount(0);
});

for (const largura of [390, 1280]) {
  test(`sem rolagem lateral em ${largura} px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await simularApi(page);
    await page.goto('/sala/1');
    await expect(secao(page).getByText('Marcos Vinícius')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      largura,
    );
  });
}
