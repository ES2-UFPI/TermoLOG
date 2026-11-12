import { expect, test } from '@playwright/test';
import { AGORA, FAIXA, historico, simularSala } from './apoio/historico';

// Relógio e fuso fixos: nada aqui depende da hora nem do fuso da máquina.
test.use({ timezoneId: 'America/Sao_Paulo' });
test.beforeEach(({ page }) => page.clock.install({ time: AGORA }));

const grafico = (page: import('@playwright/test').Page) =>
  page.getByRole('img', { name: /Gráfico de (temperatura|umidade)/ });

test('abre no dia, com o resumo do período e o gráfico', async ({ page }) => {
  const pedidos = await simularSala(page);
  await page.goto('/sala/1');
  await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
  await expect(grafico(page)).toBeVisible();
  await expect(page.getByText(/dos intervalos dentro da faixa/)).toBeVisible();
  await expect(page.getByText(/Pior: .* acima do limite/)).toBeVisible();
  expect(pedidos[0].get('periodo')).toBe('dia');
  expect(pedidos[0].has('fim')).toBe(false);
});

test('trocar o período pede a janela nova; voltar e "Agora" andam no tempo', async ({ page }) => {
  const pedidos = await simularSala(page);
  await page.goto('/sala/1');
  await expect(grafico(page)).toBeVisible();

  await page.getByRole('radio', { name: 'Semana' }).click();
  await expect.poll(() => pedidos.at(-1)?.get('periodo')).toBe('semana');
  await page.getByRole('radio', { name: 'Mês' }).click();
  await expect.poll(() => pedidos.at(-1)?.get('periodo')).toBe('mes');

  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(true);
  await expect(page.getByRole('button', { name: 'Voltar para agora' })).toBeVisible();

  await page.getByRole('button', { name: 'Voltar para agora' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(false);
  await expect(page.getByRole('button', { name: 'Voltar para agora' })).toHaveCount(0);
});

test('a umidade tem a própria aba e o gráfico muda de grandeza', async ({ page }) => {
  await simularSala(page);
  await page.goto('/sala/1');
  await expect(page.getByRole('img', { name: /Gráfico de temperatura/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Umidade' }).click();
  await expect(page.getByRole('img', { name: /Gráfico de umidade/ })).toBeVisible();
});

test('as setas do teclado percorrem os intervalos e mostram o valor', async ({ page }) => {
  await simularSala(page);
  await page.goto('/sala/1');
  const area = grafico(page);
  await expect(area).toBeVisible();
  await expect(page.getByText(/^Último intervalo/)).toBeVisible();
  await area.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText(/^Último intervalo/)).toHaveCount(0);
  await expect(page.getByText(/Média de \d+ leituras/)).toBeVisible();
});

test('período sem leitura avisa, não desenha nada e oferece voltar', async ({ page }) => {
  const pedidos = await simularSala(page, (periodo, fim) => ({
    corpo: historico(periodo, fim, { vazio: fim === null }),
  }));
  await page.goto('/sala/1');
  await expect(page.getByText('Sem leituras neste período')).toBeVisible();
  await expect(grafico(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver o período anterior' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(true);
  await expect(grafico(page)).toBeVisible();
});

test('faixa sem limite de temperatura: sem linhas de limite e sem percentual', async ({ page }) => {
  const sem = {
    temperatura_min: null,
    temperatura_max: null,
    umidade_min: FAIXA.umidade_min,
    umidade_max: FAIXA.umidade_max,
  };
  await simularSala(page, (p, f) => ({ corpo: historico(p, f, { faixa: sem }) }), sem);
  await page.goto('/sala/1');
  await expect(page.getByText('Sem faixa definida para a temperatura.')).toBeVisible();
  await expect(page.getByText(/máx \d+ °C/)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Umidade' }).click();
  await expect(page.getByText(/dos intervalos dentro da faixa/)).toBeVisible();
});

test('erro da API mostra o aviso e tenta de novo', async ({ page }) => {
  let falhar = true;
  await simularSala(page, (p, f) =>
    falhar ? { status: 500, corpo: { detail: 'falha' } } : { corpo: historico(p, f) },
  );
  await page.goto('/sala/1');
  await expect(page.getByText('Não foi possível carregar o histórico')).toBeVisible();
  falhar = false;
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(grafico(page)).toBeVisible();
});

test('anterior e seguinte: volta para o ao vivo e a janela volta a atualizar sozinha', async ({
  page,
}) => {
  const pedidos = await simularSala(page);
  await page.goto('/sala/1');
  await expect(grafico(page)).toBeVisible();
  const aoVivo = historico('dia', null);

  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(true);
  // A janela anterior termina 1 ms antes do início da ao vivo: nenhuma leitura fica no meio.
  expect(pedidos.at(-1)?.get('fim')).toBe(new Date(Date.parse(aoVivo.inicio) - 1).toISOString());
  await expect(page.getByRole('button', { name: 'Voltar para agora' })).toBeVisible();

  await page.getByRole('button', { name: 'Período seguinte' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(false);
  await expect(page.getByRole('button', { name: 'Voltar para agora' })).toHaveCount(0);

  // De volta ao presente, a busca de 60 s continua.
  const antes = pedidos.length;
  await page.clock.fastForward(61_000);
  await expect.poll(() => pedidos.length).toBeGreaterThan(antes);
});

test('janela do passado não atualiza sozinha', async ({ page }) => {
  const pedidos = await simularSala(page);
  await page.goto('/sala/1');
  await expect(grafico(page)).toBeVisible();
  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect.poll(() => pedidos.at(-1)?.has('fim')).toBe(true);
  await expect(grafico(page)).toBeVisible();
  const antes = pedidos.length;
  await page.clock.fastForward(125_000);
  await page.waitForTimeout(300);
  expect(pedidos.length).toBe(antes);
});

test('o vão sem leitura quebra a linha da média em dois trechos', async ({ page }) => {
  await simularSala(page);
  await page.goto('/sala/1');
  await expect(grafico(page)).toBeVisible();
  const trechos = await page.evaluate(() => {
    const linhas = [...document.querySelectorAll('svg path')].filter(
      (p) => p.getAttribute('fill') === 'none' && (p.getAttribute('d') ?? '').includes('M'),
    );
    return Math.max(...linhas.map((p) => (p.getAttribute('d') ?? '').split('M').length - 1));
  });
  expect(trechos).toBe(2);
});

test('trocar de período muda a janela e o eixo do tempo, não só o pedido', async ({ page }) => {
  await simularSala(page);
  await page.goto('/sala/1');
  await expect(page.getByText(/^\d\d\/11 \d\d:\d\d a 11\/11 \d\d:\d\d$/)).toBeVisible();
  await page.getByRole('radio', { name: 'Semana' }).click();
  // Sete dias: a janela começa dia 04 ou 05, e o eixo passa a marcar dias, não horas.
  await expect(page.getByText(/^0[45]\/11 \d\d:\d\d a 11\/11/)).toBeVisible();
  await expect(
    grafico(page)
      .getByText(/^\d\d\/11$/)
      .first(),
  ).toBeVisible();
});

test('em tela larga o gráfico não passa da coluna e o mouse acerta o último intervalo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1100 });
  await simularSala(page);
  await page.goto('/sala/1');
  const area = grafico(page);
  await expect(area).toBeVisible();
  const caixa = await area.boundingBox();
  if (!caixa) throw new Error('sem caixa');
  expect(caixa.width).toBeLessThanOrEqual(1240);
  const svg = await area.locator('svg').first().boundingBox();
  expect(svg?.width).toBeLessThanOrEqual(caixa.width + 1);
  // O mouse na borda direita da área do gráfico escolhe o último intervalo.
  await page.mouse.move(caixa.x + caixa.width - 12, caixa.y + 40);
  const ultimo = historico('dia', null).pontos.at(-1);
  if (!ultimo) throw new Error('sem pontos');
  const hora = new Date(ultimo.inicio).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  await expect(page.getByText(new RegExp(`às ${hora}$`)).first()).toBeVisible();
});

test('o eixo da umidade nunca passa de 100%', async ({ page }) => {
  await simularSala(page, (p, f) => {
    const h = historico(p, f);
    for (const ponto of h.pontos) ponto.umidade = { media: 97, min: 95, max: 99.4 };
    return { corpo: h };
  });
  await page.goto('/sala/1');
  await page.getByRole('tab', { name: 'Umidade' }).click();
  await expect(grafico(page).getByText(/^100$/)).toBeVisible();
  await expect(grafico(page).getByText(/^1[1-9]\d$/)).toHaveCount(0);
});

test('sem leituras há um limite para voltar no tempo', async ({ page }) => {
  const pedidos = await simularSala(page, (p, f) => ({ corpo: historico(p, f, { vazio: true }) }));
  await page.goto('/sala/1');
  await page.getByRole('radio', { name: 'Mês' }).click();
  await expect(page.getByText('Sem leituras neste período')).toBeVisible();
  // Cada clique volta 30 dias: depois de um ano de janelas vazias, o botão some.
  const botao = page.getByRole('button', { name: 'Ver o período anterior' });
  for (let i = 0; i < 20 && (await botao.count()) > 0; i++) {
    const antes = pedidos.length;
    // O botão pode sumir entre a contagem e o clique: é o limite chegando.
    await botao.click({ timeout: 10_000 }).catch(() => {});
    // Ou chegou a janela nova, ou o botão sumiu de vez (o limite).
    await expect.poll(async () => pedidos.length > antes || (await botao.count()) === 0).toBe(true);
  }
  await expect(botao).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Período anterior' })).toBeDisabled();
  expect(pedidos.length).toBeLessThanOrEqual(16);
});
