import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Faixa, HistoricoDaSala } from './api.ts';
import {
  duracaoDoPeriodo,
  escalaDoEixo,
  faixaNoGrafico,
  frasesDoSumario,
  janelaAnterior,
  janelaSeguinte,
  marcasDoTempo,
  pontoMaisProximo,
  pontosDaGrandeza,
  saidasDaFaixa,
  saiuDaFaixa,
  sumarioDoPeriodo,
  trechosDaLinha,
} from './historico.ts';

const FAIXA: Faixa = {
  temperatura_min: 2,
  temperatura_max: 8,
  umidade_min: 40,
  umidade_max: 70,
};
const SEM_LIMITE: Faixa = {
  temperatura_min: null,
  temperatura_max: null,
  umidade_min: null,
  umidade_max: null,
};
const INTERVALO_S = 300;
const T0 = Date.parse('2026-11-11T12:00:00Z');

// Um intervalo com leitura: média/min/max da temperatura e uma umidade fixa.
const ponto = (i: number, media: number, min = media, max = media) => ({
  inicio: new Date(T0 + i * INTERVALO_S * 1000).toISOString(),
  quantidade: 5,
  temperatura: { media, min, max },
  umidade: { media: 55, min: 54, max: 56 },
});

const historico = (pontos: ReturnType<typeof ponto>[], faixa = FAIXA): HistoricoDaSala => ({
  sala_id: 1,
  nome: 'Câmara fria 1',
  periodo: 'dia',
  intervalo_s: INTERVALO_S,
  inicio: new Date(T0).toISOString(),
  fim: new Date(T0 + 24 * 3_600_000).toISOString(),
  faixa,
  pontos,
});

test('a janela de cada período é a do contrato', () => {
  assert.equal(duracaoDoPeriodo('dia'), 24 * 3_600_000);
  assert.equal(duracaoDoPeriodo('semana'), 7 * 24 * 3_600_000);
  assert.equal(duracaoDoPeriodo('mes'), 30 * 24 * 3_600_000);
});

test('voltar e avançar andam uma janela; avançar até agora volta a acompanhar o presente', () => {
  const fim = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(janelaAnterior(fim, 'dia'), '2026-11-10T12:00:00.000Z');
  assert.equal(janelaAnterior(fim, 'semana'), '2026-11-04T12:00:00.000Z');
  const agora = Date.parse('2026-11-11T18:00:00Z');
  assert.equal(
    janelaSeguinte(Date.parse('2026-11-09T12:00:00Z'), 'dia', agora),
    '2026-11-10T12:00:00.000Z',
  );
  assert.equal(janelaSeguinte(fim, 'dia', agora), null);
});

test('limite nulo não vira linha nem sombra', () => {
  const pontos = pontosDaGrandeza(historico([ponto(0, 5)]).pontos, 'temperatura');
  const escala = escalaDoEixo(pontos, SEM_LIMITE, 'temperatura');
  assert.deepEqual(faixaNoGrafico(SEM_LIMITE, 'temperatura', escala), { linhas: [], sombra: null });
  const so_max = { ...SEM_LIMITE, temperatura_max: 8 };
  const desenhada = faixaNoGrafico(so_max, 'temperatura', escala);
  assert.deepEqual(desenhada.linhas, [8]);
  assert.deepEqual(desenhada.sombra, { de: escala.lo, ate: 8 });
});

test('o eixo cobre os pontos e os limites da faixa', () => {
  const pontos = pontosDaGrandeza(historico([ponto(0, 5, 4, 11)]).pontos, 'temperatura');
  const { lo, hi } = escalaDoEixo(pontos, FAIXA, 'temperatura');
  assert.ok(lo <= 2 && hi >= 11);
});

test('saiu da faixa usa o menor e o maior do intervalo, não só a média', () => {
  const [dentro, picoAcima, picoAbaixo] = pontosDaGrandeza(
    [ponto(0, 5, 4, 6), ponto(1, 7, 6, 9), ponto(2, 3, 1.5, 4)],
    'temperatura',
  );
  assert.equal(saiuDaFaixa(dentro, FAIXA, 'temperatura'), false);
  assert.equal(saiuDaFaixa(picoAcima, FAIXA, 'temperatura'), true);
  assert.equal(saiuDaFaixa(picoAbaixo, FAIXA, 'temperatura'), true);
  assert.equal(saiuDaFaixa(picoAcima, SEM_LIMITE, 'temperatura'), false);
});

test('um vão sem leitura quebra a linha; intervalos vizinhos continuam juntos', () => {
  const pontos = pontosDaGrandeza([ponto(0, 5), ponto(1, 5), ponto(5, 5)], 'temperatura');
  const trechos = trechosDaLinha(pontos, INTERVALO_S * 1000);
  assert.deepEqual(
    trechos.map((t) => t.length),
    [2, 1],
  );
});

test('uma saída é uma sequência seguida; o vão separa duas saídas', () => {
  const pontos = pontosDaGrandeza(
    [ponto(0, 9), ponto(1, 9), ponto(2, 5), ponto(3, 9), ponto(6, 9)],
    'temperatura',
  );
  const saidas = saidasDaFaixa(pontos, FAIXA, 'temperatura', INTERVALO_S * 1000);
  assert.equal(saidas.length, 3);
  assert.equal(saidas[0].de, pontos[0].t);
  assert.equal(saidas[0].ate, pontos[1].t);
});

test('o sumário conta o percentual dentro da faixa e acha a pior saída', () => {
  const h = historico([ponto(0, 5), ponto(1, 5), ponto(2, 10, 9, 12), ponto(3, 5)]);
  const sumario = sumarioDoPeriodo(h, 'temperatura');
  assert.ok(sumario);
  assert.equal(sumario.dentroPct, 75);
  assert.equal(sumario.saidas, 1);
  assert.equal(sumario.pior?.valor, 12);
  assert.equal(sumario.pior?.sentido, 'acima');
  const { faixa, pior } = frasesDoSumario(sumario, 'temperatura');
  assert.match(faixa, /75,0% dos intervalos dentro da faixa, 1 saída\./);
  assert.match(pior ?? '', /Pior: 12,0 °C acima do limite/);
});

test('sem limite não há percentual nem pior saída; sem leitura não há sumário', () => {
  const sumario = sumarioDoPeriodo(historico([ponto(0, 50, 40, 60)], SEM_LIMITE), 'temperatura');
  assert.ok(sumario);
  assert.equal(sumario.dentroPct, null);
  assert.equal(sumario.pior, null);
  assert.match(frasesDoSumario(sumario, 'temperatura').faixa, /Sem faixa definida/);
  assert.equal(sumarioDoPeriodo(historico([]), 'temperatura'), null);
  assert.match(frasesDoSumario(null, 'umidade').faixa, /Sem leituras/);
});

test('o ponto mais perto do cursor, e nenhum quando não há pontos', () => {
  const pontos = pontosDaGrandeza([ponto(0, 5), ponto(1, 5), ponto(2, 5)], 'temperatura');
  const meio = (i: number) => pontos[i].t + (INTERVALO_S * 1000) / 2;
  assert.equal(pontoMaisProximo(pontos, meio(1) + 20_000, INTERVALO_S * 1000), 1);
  assert.equal(pontoMaisProximo(pontos, meio(2) + 9_000_000, INTERVALO_S * 1000), 2);
  assert.equal(pontoMaisProximo([], T0, INTERVALO_S * 1000), null);
});

test('as marcas do tempo ficam dentro da janela e em ordem', () => {
  for (const periodo of ['dia', 'semana', 'mes'] as const) {
    const fim = Date.parse('2026-11-11T14:57:00Z');
    const inicio = fim - duracaoDoPeriodo(periodo);
    const marcas = marcasDoTempo(inicio, fim, periodo);
    assert.ok(marcas.length >= 4, periodo);
    assert.ok(
      marcas.every((m) => m >= inicio && m <= fim),
      periodo,
    );
    assert.deepEqual(
      [...marcas].sort((a, b) => a - b),
      marcas,
    );
  }
});
