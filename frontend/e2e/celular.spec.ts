import { expect, type Page, test } from '@playwright/test';
import { historico, type Periodo } from './apoio/historico';

// Painel no celular (US14, #139): em 360 px nenhuma tela rola na horizontal, e todo controle
// tem alvo de toque de pelo menos 44 px. O hitSlop do React Native não existe na web, então
// vale o tamanho desenhado.

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
const SALAS = [
  {
    sala_id: 1,
    nome: 'Câmara fria 1',
    status: 'fora_da_faixa',
    conformidade_24h: 87.5,
    leituras: [leitura(12, 9.1, 61), leitura(13, 5.04, 55), leitura(14, 5.2, 54)],
    sensores: [sensor(12), sensor(13), sensor(14), sensor(9, false)],
  },
  {
    sala_id: 2,
    nome: 'Farmácia de manipulação do bloco C',
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
];
const CSV =
  '﻿Estabelecimento;Hospital Central\r\nSala;Câmara fria 1\r\n' +
  'Período;01/10/2026 00:00:00 a 16/10/2026 23:59:59\r\nResponsável técnico;Ana Lima\r\n' +
  'Faixa de temperatura;2,0 a 8,0 °C\r\nFaixa de umidade;sem limite\r\n\r\n' +
  'Data e hora;Temperatura (°C);Umidade (%);ID do sensor\r\n' +
  Array.from(
    { length: 12 },
    (_, i) => `16/10/2026 09:${String(i).padStart(2, '0')}:00;5,0;50,0;12\r\n`,
  ).join('');

async function simularApi(page: Page, logado = true) {
  if (logado) await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
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
    if (caminho === '/auth/me') {
      return responder(200, {
        id: 1,
        nome: 'Ana Maria Lima',
        email: 'ana.maria@hospitalcentral.exemplo.com',
        perfil: 'administrador',
      });
    }
    if (caminho === '/auth/me/canais') return responder(200, []);
    if (caminho === '/salas/status') {
      return responder(
        200,
        SALAS.map(({ sensores: _s, ...s }) => ({ intervalo_leitura_s: null, ...s, faixa: FAIXA })),
      );
    }
    if (caminho === '/salas/indicadores') {
      return responder(200, {
        salas_dentro_da_faixa: 50,
        salas_ok: 1,
        salas_fora_da_faixa: 1,
        salas_sem_leitura: 1,
      });
    }
    if (caminho === '/salas') {
      return responder(
        200,
        SALAS.map((s) => ({ id: s.sala_id, nome: s.nome, descricao: null, faixa: FAIXA })),
      );
    }
    if (caminho === '/gateways') {
      return responder(200, [
        { id: 1, nome: 'Bloco C', online: true, ultimo_contato: new Date().toISOString() },
        { id: 2, nome: 'Almoxarifado central do prédio B', online: false, ultimo_contato: null },
      ]);
    }
    if (caminho === '/relatorios/leituras') {
      return rota.fulfill({
        status: 200,
        headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8' },
        body: CSV,
      });
    }
    if (/^\/salas\/\d+\/historico$/.test(caminho)) {
      return responder(
        200,
        historico(
          (url.searchParams.get('periodo') ?? 'dia') as Periodo,
          url.searchParams.get('fim'),
        ),
      );
    }
    const m = caminho.match(/^\/salas\/(\d+)(\/sensores)?$/);
    const sala = m && SALAS.find((s) => s.sala_id === Number(m[1]));
    if (sala && m?.[2]) return responder(200, sala.sensores);
    if (sala) {
      return responder(200, {
        id: sala.sala_id,
        nome: sala.nome,
        descricao: 'Vacinas do bloco C',
        faixa: FAIXA,
        sensores: sala.sensores,
      });
    }
    return responder(200, []);
  });
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

/** Controles com alvo menor que o mínimo. Dia do calendário: 7 colunas em 360 px dão ~40 px de largura. */
const alvosPequenos = (page: Page) =>
  page.evaluate(() => {
    const seletor =
      'a[href], button, input, select, textarea, [role=button], [role=link], [role=switch], [role=radio], [role=tab], [role=option]';
    const pequenos: string[] = [];
    for (const e of document.querySelectorAll(seletor)) {
      const r = e.getBoundingClientRect();
      const estilo = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || estilo.visibility === 'hidden') continue;
      const rotulo = e.getAttribute('aria-label') ?? (e as HTMLElement).innerText?.trim() ?? '';
      // Os pontos de sensor da régua são dicas em cima de um traço de 6 px: o mesmo dado vem
      // escrito no texto do card, e um alvo de 44 px sobreporia os vizinhos.
      if (/^Sensor \d+:/.test(rotulo)) continue;
      const dia = /^\d{1,2} de \p{L}+ de \d{4}$/u.test(rotulo);
      const larguraMinima = dia ? 40 : 44;
      if (r.height < 43.5 || r.width < larguraMinima - 0.5) {
        pequenos.push(
          `${e.tagName.toLowerCase()} "${rotulo.slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return pequenos;
  });

const semRolagemLateral = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);

const TELAS: { nome: string; logado?: boolean; abrir: (p: Page) => Promise<void> }[] = [
  {
    nome: 'painel',
    abrir: async (p) => {
      await p.goto('/');
      await expect(p.getByText('Câmara fria 1').first()).toBeVisible();
    },
  },
  {
    nome: 'sala',
    abrir: async (p) => {
      await p.goto('/sala/1');
      await expect(p.getByRole('button', { name: 'Adicionar sensor' })).toBeVisible();
    },
  },
  {
    nome: 'relatórios',
    abrir: async (p) => {
      await p.goto('/relatorios');
      await expect(p.getByRole('button', { name: 'Baixar relatório' })).toBeVisible();
    },
  },
  {
    nome: 'gateways',
    abrir: async (p) => {
      await p.goto('/gateways');
      await expect(p.getByRole('button', { name: 'Novo gateway' })).toBeVisible();
    },
  },
  {
    nome: 'novo gateway',
    abrir: async (p) => {
      await p.goto('/gateways');
      await p.getByRole('button', { name: 'Novo gateway' }).click();
      await expect(p.getByRole('button', { name: 'Cadastrar' })).toBeVisible();
    },
  },
  {
    nome: 'perfil',
    abrir: async (p) => {
      await p.goto('/perfil');
      await expect(p.getByRole('switch', { name: 'E-mail' })).toBeVisible();
    },
  },
  {
    nome: 'nova sala',
    abrir: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Nova sala' }).first().click();
      await expect(p.getByRole('button', { name: 'Cadastrar' })).toBeVisible();
    },
  },
  {
    nome: 'editar sala',
    abrir: async (p) => {
      await p.goto('/sala/1');
      await p.getByRole('button', { name: 'Editar sala' }).click();
      await expect(p.getByRole('button', { name: 'Salvar' })).toBeVisible();
    },
  },
  {
    nome: 'login',
    logado: false,
    abrir: async (p) => {
      await p.goto('/login');
      await expect(p.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
    },
  },
];

for (const largura of [360, 390]) {
  for (const tela of TELAS) {
    test(`${tela.nome} em ${largura} px: sem rolagem lateral e com alvos de 44 px`, async ({
      page,
    }) => {
      await simularApi(page, tela.logado !== false);
      await page.setViewportSize({ width: largura, height: 800 });
      await tela.abrir(page);
      // Espera as animações de entrada terminarem: o tamanho final é o que conta.
      await page.waitForTimeout(900);
      await semRolagemLateral(page);
      expect(await alvosPequenos(page)).toEqual([]);
    });
  }
}

test('a barra do painel no celular tem alvos de 44 px com o menu aberto', async ({ page }) => {
  await simularApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Conta e menu' }).click();
  await expect(page.getByRole('link', { name: 'Meu perfil' })).toBeVisible();
  await page.waitForTimeout(700);
  expect(await alvosPequenos(page)).toEqual([]);
});

test('o interruptor do perfil liga ao clicar na borda da área de 44 px', async ({ page }) => {
  await simularApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/perfil');
  const chave = page.getByRole('switch', { name: 'E-mail' });
  await expect(chave).toBeVisible();
  const caixa = await chave.boundingBox();
  if (!caixa) throw new Error('interruptor sem caixa');
  expect(caixa.height).toBeGreaterThanOrEqual(43.5);
  // 6 px abaixo do desenho de 28 px: dentro da área de toque, fora da trilha.
  await page.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height - 4);
  await expect(chave).toHaveAttribute('aria-checked', 'true');
});
