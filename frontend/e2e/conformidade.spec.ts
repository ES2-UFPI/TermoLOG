import { expect, test } from '@playwright/test';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

const sala = (sala_id: number, nome: string, conformidade_24h: number | null) => ({
  sala_id,
  nome,
  faixa: { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null },
  intervalo_leitura_s: null,
  status: conformidade_24h === null ? 'sem_leitura' : 'ok',
  conformidade_24h,
  leituras:
    conformidade_24h === null
      ? []
      : [{ sensor_id: sala_id, temperatura: 5, umidade: 50, data_hora: new Date().toISOString() }],
});

const indicadores = (dentro: number | null, ok: number, semLeitura: number) => ({
  salas_dentro_da_faixa: dentro,
  salas_ok: ok,
  salas_fora_da_faixa: 0,
  salas_sem_leitura: semLeitura,
});

test('painel mostra a conformidade geral e da sala e atualiza no polling', async ({ page }) => {
  // Cada busca devolve a próxima resposta; a última se repete.
  const respostas = [
    {
      salas: [sala(1, 'Câmara fria', 92), sala(2, 'Almoxarifado', null)],
      indicadores: indicadores(100, 1, 1),
    },
    {
      salas: [sala(1, 'Câmara fria', 87.5), sala(2, 'Almoxarifado', null)],
      indicadores: indicadores(null, 0, 2),
    },
  ];
  let busca = 0;
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, (rota) => {
    const pedido = rota.request();
    const caminho = new URL(pedido.url()).pathname;
    const atual = respostas[Math.min(busca, respostas.length - 1)];
    let corpo: unknown = [];
    if (caminho === '/salas/status') corpo = atual.salas;
    if (caminho === '/salas/indicadores') {
      corpo = atual.indicadores;
      busca++;
    }
    const opcoes = pedido.method() === 'OPTIONS';
    return rota.fulfill({
      status: opcoes ? 204 : 200,
      headers: CORS,
      contentType: 'application/json',
      body: opcoes ? undefined : JSON.stringify(corpo),
    });
  });
  await page.clock.install();
  await page.goto('/');

  const geral = page.getByLabel('Salas dentro da faixa');
  await expect(geral).toContainText('100,0%');
  await expect(page.getByText('Conformidade 24 h: 92,0%')).toBeVisible();
  await expect(page.getByText('Conformidade 24 h: sem leitura')).toBeVisible();

  await page.clock.fastForward(30_000);
  await expect(page.getByText('Conformidade 24 h: 87,5%')).toBeVisible();
  await expect(geral).toContainText('sem leitura');
});
