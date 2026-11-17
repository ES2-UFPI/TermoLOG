import type { Faixa } from './api';

// Regras do editor de faixa (#94): sem React, para testar no Node.

export type Grandeza = 'temperatura' | 'umidade';
export type Lado = 'min' | 'max';

/** Passo da alça e casas decimais de cada grandeza. */
export const GRANDEZAS: Record<
  Grandeza,
  { nome: string; unidade: string; passo: number; casas: number }
> = {
  temperatura: { nome: 'Temperatura', unidade: '°C', passo: 0.5, casas: 1 },
  umidade: { nome: 'Umidade', unidade: '%', passo: 1, casas: 0 },
};

/**
 * O que o sensor do nó de borda (DHT22) consegue medir: −40 a 80 °C e 0 a 100% de umidade.
 * Um limite fora disso nunca seria atingido por uma leitura, então o editor não aceita.
 */
export const LIMITES_DO_SENSOR: Record<Grandeza, [number, number]> = {
  temperatura: [-40, 80],
  umidade: [0, 100],
};

const dentroDoSensor = (g: Grandeza, v: number) =>
  Math.min(LIMITES_DO_SENSOR[g][1], Math.max(LIMITES_DO_SENSOR[g][0], v));

export const FAIXA_VAZIA: Faixa = {
  temperatura_min: null,
  temperatura_max: null,
  umidade_min: null,
  umidade_max: null,
};

export const chave = (g: Grandeza, lado: Lado) => `${g}_${lado}` as keyof Faixa;

/** Arredonda para o passo, sem "2.5000000001". */
export const noPasso = (valor: number, passo: number) =>
  +(Math.round(valor / passo) * passo).toFixed(2);

/**
 * Valor do editor com casas fixas: 2 -> "2,0" (temperatura) e 58 -> "58" (umidade).
 * O numero() do painel sempre põe uma casa, e com 0 casas o toLocaleString quebra.
 */
export function formatar(valor: number, casas: number) {
  const fator = 10 ** casas;
  return (Math.round(valor * fator) / fator || 0)
    .toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
    .replace('-', '−');
}

/** "−3,5", "2,5" ou "4" -> número; texto que não é número -> null. */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace('−', '-').replace(',', '.');
  if (limpo === '') return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/** Mesma regra e mesma mensagem do backend (Faixa.minimo_menor_que_maximo). */
export function errosDaFaixa(faixa: Faixa): Partial<Record<Grandeza, string>> {
  const erros: Partial<Record<Grandeza, string>> = {};
  for (const g of ['temperatura', 'umidade'] as const) {
    const min = faixa[chave(g, 'min')];
    const max = faixa[chave(g, 'max')];
    const [lo, hi] = LIMITES_DO_SENSOR[g];
    const { unidade } = GRANDEZAS[g];
    const foraDoSensor = [min, max].some((v) => v !== null && (v < lo || v > hi));
    if (foraDoSensor) {
      const de = String(lo).replace('-', '−');
      erros[g] =
        `${GRANDEZAS[g].nome} vai de ${de} a ${hi}${unidade === '%' ? '%' : ` ${unidade}`} (o que o sensor mede)`;
    } else if (min !== null && max !== null && min >= max) {
      erros[g] = `${g}_min deve ser menor que ${g}_max`;
    }
  }
  return erros;
}

/**
 * Valor de uma alça arrastada: no passo e, se o outro limite existir, um passo antes dele,
 * para o mínimo nunca encostar no máximo.
 */
export function valorDaAlca(faixa: Faixa, g: Grandeza, lado: Lado, valor: number) {
  const { passo } = GRANDEZAS[g];
  const outro = faixa[chave(g, lado === 'min' ? 'max' : 'min')];
  let v = noPasso(dentroDoSensor(g, valor), passo);
  if (outro !== null) v = lado === 'min' ? Math.min(v, outro - passo) : Math.max(v, outro + passo);
  return noPasso(dentroDoSensor(g, v), passo);
}

/**
 * Escala do termômetro de temperatura: em volta dos limites e da leitura atual, com folga,
 * em números pares, dentro do que o sensor mede. Sem nenhum deles, de −30 a 40 °C. Umidade é
 * sempre de 0 a 100%.
 */
export function dominio(g: Grandeza, faixa: Faixa, atual?: number | null): [number, number] {
  if (g === 'umidade') return [0, 100];
  const valores = [faixa.temperatura_min, faixa.temperatura_max, atual].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (valores.length === 0) return [-30, 40];
  const lo = Math.min(...valores);
  const hi = Math.max(...valores);
  const meio = (lo + hi) / 2;
  const meia = Math.max(8, (hi - lo) * 0.85);
  // Nunca além do que o sensor mede, mesmo com leitura ou limite antigo fora disso.
  return [
    dentroDoSensor(g, Math.floor((meio - meia) / 2) * 2),
    dentroDoSensor(g, Math.ceil((meio + meia) / 2) * 2),
  ];
}

/** Marcas da escala: as maiores com número, as menores no meio. */
export function marcas([lo, hi]: [number, number]) {
  const span = hi - lo;
  const maior = span <= 20 ? 2 : span <= 50 ? 10 : 20;
  const menor = maior / 2;
  const lista: { valor: number; maior: boolean }[] = [];
  for (let v = Math.ceil(lo / menor) * menor; v <= hi + 1e-9; v += menor) {
    lista.push({
      valor: noPasso(v, 0.01),
      maior: Math.abs(v / maior - Math.round(v / maior)) < 1e-9,
    });
  }
  return lista;
}

const fora = (v: number, min: number | null, max: number | null) =>
  (min !== null && v < min) || (max !== null && v > max);

/** Se a leitura ficaria fora da faixa (o que abriria um alerta). */
export const ficariaFora = (leitura: { temperatura: number; umidade: number }, faixa: Faixa) =>
  fora(leitura.temperatura, faixa.temperatura_min, faixa.temperatura_max) ||
  fora(leitura.umidade, faixa.umidade_min, faixa.umidade_max);

/**
 * Corpo de POST /salas e PATCH /salas/{id}. A faixa vai sempre inteira: no PATCH ela
 * substitui a anterior, então mandar só o limite alterado apagaria os outros.
 */
export function corpoDaSala(nome: string, descricao: string, faixa: Faixa) {
  return {
    nome: nome.trim(),
    descricao: descricao.trim() === '' ? null : descricao.trim(),
    faixa: {
      temperatura_min: faixa.temperatura_min,
      temperatura_max: faixa.temperatura_max,
      umidade_min: faixa.umidade_min,
      umidade_max: faixa.umidade_max,
    },
  };
}

// Escala de calor do tubo de temperatura, de gelo (−20 °C) a muito quente (40 °C).
const PARADAS = [-20, 0, 12, 22, 30, 40];
export const CALOR = {
  escuro: ['#cfe8ff', '#6fb6ff', '#8fe3c8', '#ffd27a', '#ffa45c', '#ff6f5a'],
  claro: ['#5aa9e6', '#3b82f6', '#14b8a6', '#d99a00', '#ef7a2a', '#d6452c'],
};

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const misturar = (a: string, b: string, t: number) =>
  `#${rgb(a)
    .map((c, i) =>
      Math.round(c + (rgb(b)[i] - c) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Cor da temperatura na escala de calor (interpolada entre as paradas). */
export function corDaTemperatura(t: number, cores: string[]) {
  if (t <= PARADAS[0]) return cores[0];
  for (let i = 1; i < PARADAS.length; i++) {
    if (t <= PARADAS[i]) {
      return misturar(cores[i - 1], cores[i], (t - PARADAS[i - 1]) / (PARADAS[i] - PARADAS[i - 1]));
    }
  }
  return cores[cores.length - 1];
}
