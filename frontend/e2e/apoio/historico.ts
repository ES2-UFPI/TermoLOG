import type { Page } from '@playwright/test';

// Dados simulados da série histórica (Contrato de API, 2.4) e a API em volta da tela da sala.

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

export const FAIXA = { temperatura_min: 2, temperatura_max: 8, umidade_min: 40, umidade_max: 70 };
type Faixa = {
  temperatura_min: number | null;
  temperatura_max: number | null;
  umidade_min: number | null;
  umidade_max: number | null;
};

const PASSO_S = { dia: 300, semana: 3600, mes: 14_400 } as const;
const PONTOS = { dia: 288, semana: 168, mes: 180 } as const;
/** O "agora" dos testes: o relógio do navegador é fixado nele e a API simulada parte dele. */
export const AGORA = Date.parse('2026-11-11T15:00:00Z');
export type Periodo = keyof typeof PASSO_S;

/** Um ciclo diário suave, uma saída da faixa e um vão sem leitura, sempre nos mesmos lugares. */
export function historico(
  periodo: Periodo,
  fimIso: string | null,
  opcoes: { faixa?: Faixa; vazio?: boolean } = {},
) {
  const fim = fimIso ? Date.parse(fimIso) : AGORA;
  const passo = PASSO_S[periodo] * 1000;
  const total = PONTOS[periodo];
  const ultimo = Math.floor(fim / passo) * passo;
  const inicio = ultimo - passo * (total - 1);
  const pontos = [];
  for (let i = 0; i < total && !opcoes.vazio; i++) {
    const ruido = Math.sin(i * 1.7) * 0.25;
    const vao = i > total * 0.38 && i < total * 0.43;
    if (vao) continue;
    const saida = i > total * 0.62 && i < total * 0.68 ? 3.4 : 0;
    const ciclo = Math.sin((i / total) * Math.PI * 4);
    const t = 5.2 + ciclo * 1.3 + ruido + saida;
    const u = 56 + Math.cos((i / total) * Math.PI * 4) * 7 + Math.sin(i * 0.9) * 1.2;
    pontos.push({
      inicio: new Date(inicio + i * passo).toISOString(),
      quantidade: periodo === 'dia' ? 5 : periodo === 'semana' ? 60 : 240,
      temperatura: {
        media: Math.round(t * 100) / 100,
        min: Math.round((t - 0.7 - Math.abs(ruido)) * 10) / 10,
        max: Math.round((t + 0.9 + Math.abs(ruido)) * 10) / 10,
      },
      umidade: {
        media: Math.round(u * 100) / 100,
        min: Math.round((u - 2.2) * 10) / 10,
        max: Math.round((u + 2.6) * 10) / 10,
      },
    });
  }
  return {
    sala_id: 1,
    nome: 'Câmara fria 1',
    periodo,
    intervalo_s: PASSO_S[periodo],
    inicio: new Date(inicio).toISOString(),
    fim: new Date(fim).toISOString(),
    faixa: opcoes.faixa ?? FAIXA,
    pontos,
  };
}

/** A tela da sala com a API simulada. `resposta` decide o que o histórico devolve. */
export async function simularSala(
  page: Page,
  resposta: (periodo: Periodo, fim: string | null) => { status?: number; corpo: unknown } = (
    periodo,
    fim,
  ) => ({ corpo: historico(periodo, fim) }),
  faixa: Faixa = FAIXA,
) {
  const pedidos: URLSearchParams[] = [];
  await page.addInitScript(() => localStorage.setItem('termolog-token', 'token-bom'));
  await page.route(`${API}/**`, async (rota) => {
    const url = new URL(rota.request().url());
    const caminho = url.pathname;
    const responder = (status: number, corpo?: unknown) =>
      rota.fulfill({
        status,
        headers: CORS,
        contentType: 'application/json',
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    if (rota.request().method() === 'OPTIONS') return responder(204);
    if (caminho === '/health') return responder(200, { status: 'ok' });
    if (caminho === '/auth/me') {
      return responder(200, {
        id: 1,
        nome: 'Ana Lima',
        email: 'ana@exemplo.com',
        perfil: 'visualizador',
      });
    }
    const agora = new Date(AGORA).toISOString();
    const leitura = (sensor_id: number, temperatura: number, umidade: number) => ({
      sensor_id,
      temperatura,
      umidade,
      data_hora: agora,
    });
    if (caminho === '/salas/status') {
      return responder(200, [
        {
          sala_id: 1,
          nome: 'Câmara fria 1',
          faixa,
          intervalo_leitura_s: null,
          status: 'ok',
          conformidade_24h: 96.4,
          leituras: [leitura(12, 5.4, 58), leitura(13, 5.1, 57)],
        },
      ]);
    }
    if (caminho === '/salas/indicadores') {
      return responder(200, {
        salas_dentro_da_faixa: 100,
        salas_ok: 1,
        salas_fora_da_faixa: 0,
        salas_sem_leitura: 0,
      });
    }
    if (caminho === '/salas/1') {
      return responder(200, {
        id: 1,
        nome: 'Câmara fria 1',
        descricao: 'Vacinas do bloco C',
        faixa,
        sensores: [
          { id: 12, gateway_id: 1, ativo: true, data_cadastro: '2026-10-01T12:00:00Z' },
          { id: 13, gateway_id: 1, ativo: true, data_cadastro: '2026-10-01T12:00:00Z' },
        ],
      });
    }
    if (caminho === '/salas/1/historico') {
      pedidos.push(url.searchParams);
      const r = resposta(
        (url.searchParams.get('periodo') ?? 'dia') as Periodo,
        url.searchParams.get('fim'),
      );
      return responder(r.status ?? 200, r.corpo);
    }
    return responder(200, []);
  });
  return pedidos;
}
