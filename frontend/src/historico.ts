import type {
  EstatisticaDoHistorico,
  Faixa,
  HistoricoDaSala,
  PeriodoDoHistorico,
  PontoDoHistorico,
} from './api';
import { numero } from './painel.ts';
import { marcasDoEixo } from './relatorios.ts';

// Regras do gráfico da sala (#105): sem React, para testar no Node.

export type Grandeza = 'temperatura' | 'umidade';

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** A janela de cada período é a do contrato (2.4): 24 h, 7 dias e 30 dias. */
export const PERIODOS: { id: PeriodoDoHistorico; rotulo: string; duracaoMs: number }[] = [
  { id: 'dia', rotulo: 'Dia', duracaoMs: DIA },
  { id: 'semana', rotulo: 'Semana', duracaoMs: 7 * DIA },
  { id: 'mes', rotulo: 'Mês', duracaoMs: 30 * DIA },
];

export const duracaoDoPeriodo = (periodo: PeriodoDoHistorico) =>
  (PERIODOS.find((p) => p.id === periodo) ?? PERIODOS[0]).duracaoMs;

export const UNIDADE: Record<Grandeza, string> = { temperatura: '°C', umidade: '%' };

export type Ponto = { t: number; quantidade: number } & EstatisticaDoHistorico;

/** Os pontos de uma grandeza, com o tempo em milissegundos, na ordem da API. */
export const pontosDaGrandeza = (pontos: PontoDoHistorico[], g: Grandeza): Ponto[] =>
  pontos.map((p) => ({ t: Date.parse(p.inicio), quantidade: p.quantidade, ...p[g] }));

/** Os dois limites da faixa para a grandeza; `null` é o lado sem limite. */
export const limitesDa = (faixa: Faixa, g: Grandeza) =>
  g === 'temperatura'
    ? { min: faixa.temperatura_min, max: faixa.temperatura_max }
    : { min: faixa.umidade_min, max: faixa.umidade_max };

export type Escala = { lo: number; hi: number; marcas: number[] };

/** Eixo vertical: cobre os pontos e os limites da faixa, com folga, em números redondos. */
export function escalaDoEixo(pontos: Ponto[], faixa: Faixa, g: Grandeza): Escala {
  const { min, max } = limitesDa(faixa, g);
  const valores = [
    ...pontos.flatMap((p) => [p.min, p.max]),
    ...(min === null ? [] : [min]),
    ...(max === null ? [] : [max]),
  ];
  if (valores.length === 0) return { lo: 0, hi: 1, marcas: [0, 1] };
  const baixo = Math.min(...valores);
  const alto = Math.max(...valores);
  const folga = (alto - baixo || 1) * 0.12;
  const marcas = marcasDoEixo(baixo - folga, alto + folga);
  return { lo: marcas[0], hi: marcas[marcas.length - 1], marcas };
}

export type FaixaDesenhada = {
  /** Linhas finas nos limites que existem; limite `null` não é desenhado. */
  linhas: number[];
  /** O lado aceitável, sombreado. Com um limite só, vai dele até a borda do gráfico. */
  sombra: { de: number; ate: number } | null;
};

/** O que desenhar da faixa ideal no eixo: nada para o lado sem limite. */
export function faixaNoGrafico(faixa: Faixa, g: Grandeza, escala: Escala): FaixaDesenhada {
  const { min, max } = limitesDa(faixa, g);
  const linhas = [min, max].filter((v): v is number => v !== null);
  if (min === null && max === null) return { linhas, sombra: null };
  return { linhas, sombra: { de: min ?? escala.lo, ate: max ?? escala.hi } };
}

export const saiuDaFaixa = (ponto: Ponto, faixa: Faixa, g: Grandeza) => {
  const { min, max } = limitesDa(faixa, g);
  return (min !== null && ponto.min < min) || (max !== null && ponto.max > max);
};

/** Trechos contínuos da linha: um vão maior que um intervalo e meio quebra a linha. */
export function trechosDaLinha(pontos: Ponto[], intervaloMs: number): Ponto[][] {
  const trechos: Ponto[][] = [];
  for (const p of pontos) {
    const atual = trechos[trechos.length - 1];
    if (atual && p.t - atual[atual.length - 1].t <= intervaloMs * 1.5) atual.push(p);
    else trechos.push([p]);
  }
  return trechos;
}

export type Saida = { de: number; ate: number };

/** Sequências seguidas de intervalos fora da faixa; cada sequência é uma saída. */
export function saidasDaFaixa(
  pontos: Ponto[],
  faixa: Faixa,
  g: Grandeza,
  intervaloMs: number,
): Saida[] {
  const saidas: Saida[] = [];
  let anterior: Ponto | null = null;
  let atual: Saida | null = null;
  for (const p of pontos) {
    if (saiuDaFaixa(p, faixa, g)) {
      if (atual && anterior && p.t - anterior.t <= intervaloMs * 1.5) {
        atual.ate = p.t;
      } else {
        atual = { de: p.t, ate: p.t };
        saidas.push(atual);
      }
    } else {
      atual = null;
    }
    anterior = p;
  }
  return saidas;
}

/** A janela que termina no começo desta: o gráfico volta no tempo. */
export const janelaAnterior = (fimAtualMs: number, periodo: PeriodoDoHistorico) =>
  new Date(fimAtualMs - duracaoDoPeriodo(periodo)).toISOString();

/** A janela seguinte; `null` quando já chegaria a agora (o gráfico volta a acompanhar o presente). */
export function janelaSeguinte(fimAtualMs: number, periodo: PeriodoDoHistorico, agoraMs: number) {
  const proximo = fimAtualMs + duracaoDoPeriodo(periodo);
  return proximo >= agoraMs ? null : new Date(proximo).toISOString();
}

const dois = (n: number) => String(n).padStart(2, '0');
const hora = (d: Date) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const dia = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;

/** "10/11 12:07 a 11/11 12:07", no fuso de quem olha. */
export function rotuloDaJanela(inicioMs: number, fimMs: number) {
  const a = new Date(inicioMs);
  const b = new Date(fimMs);
  return `${dia(a)} ${hora(a)} a ${dia(b)} ${hora(b)}`;
}

/** Marcas do eixo do tempo: de 4 em 4 h no dia, à meia-noite na semana e a cada 5 dias no mês. */
export function marcasDoTempo(inicioMs: number, fimMs: number, periodo: PeriodoDoHistorico) {
  const passoHoras = periodo === 'dia' ? 4 : periodo === 'semana' ? 24 : 24 * 5;
  const primeira = new Date(inicioMs);
  primeira.setMinutes(0, 0, 0);
  if (passoHoras >= 24) primeira.setHours(0);
  else primeira.setHours(Math.ceil(primeira.getHours() / passoHoras) * passoHoras);
  const marcas: number[] = [];
  for (let d = primeira.getTime(); d <= fimMs; d += passoHoras * HORA) {
    if (d >= inicioMs) marcas.push(d);
  }
  return marcas;
}

export const rotuloDoTempo = (ms: number, periodo: PeriodoDoHistorico) =>
  periodo === 'dia' ? hora(new Date(ms)) : dia(new Date(ms));

/** O ponto cujo centro está mais perto do instante, ou `null` sem pontos. */
export function pontoMaisProximo(pontos: Ponto[], instanteMs: number, intervaloMs: number) {
  let melhor: number | null = null;
  let distancia = Number.POSITIVE_INFINITY;
  pontos.forEach((p, i) => {
    const d = Math.abs(p.t + intervaloMs / 2 - instanteMs);
    if (d < distancia) {
      distancia = d;
      melhor = i;
    }
  });
  return melhor;
}

/** A frase do valor de um ponto: a média e, quando varia, de quanto a quanto. */
export function textoDoPonto(p: Ponto, g: Grandeza) {
  const variacao = p.min === p.max ? '' : ` (de ${numero(p.min)} a ${numero(p.max)})`;
  return `${numero(p.media)} ${UNIDADE[g]}${variacao}`;
}

export type Sumario = {
  pontos: Ponto[];
  /** Percentual dos intervalos com leitura que ficaram dentro da faixa; null sem faixa. */
  dentroPct: number | null;
  saidas: number;
  /** O intervalo que mais passou do limite, com o valor extremo e o lado. */
  pior: { ponto: Ponto; valor: number; sentido: 'acima' | 'abaixo' } | null;
  menor: number;
  maior: number;
};

/** O que o período diz sobre uma grandeza: quanto ficou na faixa, quantas saídas e a pior. */
export function sumarioDoPeriodo(h: HistoricoDaSala, g: Grandeza): Sumario | null {
  const pontos = pontosDaGrandeza(h.pontos, g);
  if (pontos.length === 0) return null;
  const { min, max } = limitesDa(h.faixa, g);
  const semFaixa = min === null && max === null;
  const fora = pontos.filter((p) => saiuDaFaixa(p, h.faixa, g)).length;
  let pior: Sumario['pior'] = null;
  let maiorDesvio = 0;
  for (const p of pontos) {
    const acima = max !== null ? p.max - max : 0;
    const abaixo = min !== null ? min - p.min : 0;
    const desvio = Math.max(acima, abaixo);
    if (desvio > maiorDesvio) {
      maiorDesvio = desvio;
      pior =
        acima >= abaixo
          ? { ponto: p, valor: p.max, sentido: 'acima' }
          : { ponto: p, valor: p.min, sentido: 'abaixo' };
    }
  }
  return {
    pontos,
    dentroPct: semFaixa ? null : Math.round(((pontos.length - fora) / pontos.length) * 1000) / 10,
    saidas: saidasDaFaixa(pontos, h.faixa, g, h.intervalo_s * 1000).length,
    pior,
    menor: Math.min(...pontos.map((p) => p.min)),
    maior: Math.max(...pontos.map((p) => p.max)),
  };
}

/** As frases do sumário, em duas partes: o quanto ficou na faixa e a pior saída. */
export function frasesDoSumario(sumario: Sumario | null, g: Grandeza) {
  if (!sumario) return { faixa: 'Sem leituras no período.', pior: null as string | null };
  const u = UNIDADE[g];
  const faixa =
    sumario.dentroPct === null
      ? `Sem faixa definida para ${g === 'temperatura' ? 'a temperatura' : 'a umidade'}.`
      : `${numero(sumario.dentroPct)}% dos intervalos dentro da faixa, ${
          sumario.saidas === 0
            ? 'sem saídas'
            : `${sumario.saidas} ${sumario.saidas === 1 ? 'saída' : 'saídas'}`
        }.`;
  const pior = sumario.pior
    ? `Pior: ${numero(sumario.pior.valor)} ${u} ${sumario.pior.sentido === 'acima' ? 'acima' : 'abaixo'} do limite, ${rotuloDoInstante(sumario.pior.ponto.t)}.`
    : null;
  return { faixa, pior };
}

/** "11/11 às 06:40", no fuso de quem olha. */
export const rotuloDoInstante = (ms: number) => `${dia(new Date(ms))} às ${hora(new Date(ms))}`;
