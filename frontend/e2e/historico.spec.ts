import { expect, test } from '@playwright/test';
import { FAIXA, historico, simularSala } from './apoio/historico';

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
