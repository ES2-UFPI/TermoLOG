import type { Faixa, LeituraDoSensor, StatusDaSala } from './api';

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 9.1 -> "9,1"; negativo com o sinal de menos tipográfico. */
export const numero = (valor: number) => decimal.format(valor).replace('-', '−');

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export type Folga = {
  grandeza: 'temperatura' | 'umidade';
  /** Distância até o limite mais próximo; negativa quando a leitura está fora. */
  valor: number;
  limite: 'mínimo' | 'máximo';
};

function folgaDe(valor: number, min: number | null, max: number | null) {
  const ate: { valor: number; limite: Folga['limite'] }[] = [];
  if (min !== null) ate.push({ valor: valor - min, limite: 'mínimo' });
  if (max !== null) ate.push({ valor: max - valor, limite: 'máximo' });
  return ate.sort((a, b) => a.valor - b.valor)[0] ?? null;
}

/** A folga mais crítica da leitura: o que estiver fora primeiro, senão a temperatura. */
export function folga(leitura: LeituraDoSensor, faixa: Faixa): Folga | null {
  const temperatura = folgaDe(leitura.temperatura, faixa.temperatura_min, faixa.temperatura_max);
  const umidade = folgaDe(leitura.umidade, faixa.umidade_min, faixa.umidade_max);
  if (umidade && umidade.valor < 0 && !(temperatura && temperatura.valor < umidade.valor)) {
    return { grandeza: 'umidade', ...umidade };
  }
  if (temperatura) return { grandeza: 'temperatura', ...temperatura };
  return umidade && { grandeza: 'umidade', ...umidade };
}

/** Leitura que o card destaca: a de menor folga; sem faixa, a primeira. */
export function leituraPrincipal(sala: StatusDaSala) {
  const valorDaFolga = (l: LeituraDoSensor) =>
    folga(l, sala.faixa)?.valor ?? Number.POSITIVE_INFINITY;
  return [...sala.leituras].sort((a, b) => valorDaFolga(a) - valorDaFolga(b))[0] ?? null;
}

/** Fora da faixa primeiro, depois sem leitura, depois as que estão ok. */
const ORDEM = { fora_da_faixa: 0, sem_leitura: 1, ok: 2 };
export const ordenar = (salas: StatusDaSala[]) =>
  [...salas].sort((a, b) => ORDEM[a.status] - ORDEM[b.status]);

/** Folga de temperatura (°C) de cada sala que tem leitura e algum limite de temperatura. */
export function folgasDeTemperatura(salas: StatusDaSala[]) {
  return salas
    .flatMap((sala) => {
      const { temperatura_min: min, temperatura_max: max } = sala.faixa;
      const valores = sala.leituras.flatMap((l) => folgaDe(l.temperatura, min, max)?.valor ?? []);
      return valores.length > 0 ? [{ sala, folga: Math.min(...valores) }] : [];
    })
    .sort((a, b) => a.folga - b.folga);
}

/** Domínio da régua do card: os limites e as leituras, com 25% de folga visual. */
export function dominio(faixa: Faixa, temperaturas: number[]): [number, number] {
  const valores = [faixa.temperatura_min, faixa.temperatura_max, ...temperaturas].filter(
    (v): v is number => v !== null,
  );
  const lo = Math.min(...valores);
  const hi = Math.max(...valores);
  const margem = Math.max(hi - lo, 4) * 0.25;
  return [lo - margem, hi + margem];
}

export type Figura =
  | 'quente'
  | 'frio'
  | 'congelado'
  | 'sem-sinal'
  | 'servidor'
  | 'laboratorio'
  | 'energia'
  | 'normal';

// ponytail: o tipo da sala sai do nome; trocar por um campo de tipo quando o cadastro tiver.
const TIPOS: [RegExp, Figura][] = [
  [/servidor|data ?center|rack/i, 'servidor'],
  [/laborat|microbio|an[áa]lise/i, 'laboratorio'],
  [/nobreak|ups|energia|gerador/i, 'energia'],
  [/freezer|congel/i, 'congelado'],
];

/** Figura translúcida do card: o estado manda (fora, sem leitura); senão, o tipo da sala. */
export function figura(sala: StatusDaSala): Figura {
  const leitura = leituraPrincipal(sala);
  if (!leitura) return 'sem-sinal';
  const f = folga(leitura, sala.faixa);
  if (f && f.valor < 0) return f.limite === 'máximo' ? 'quente' : 'frio';
  const tipo = TIPOS.find(([nome]) => nome.test(sala.nome));
  if (tipo) return tipo[1];
  return leitura.temperatura < 0 ? 'congelado' : 'normal';
}

/** Texto da folga: "+1,1 °C acima do máximo" ou "3,6 °C até o máximo". */
export function textoDaFolga(f: Folga) {
  const unidade = f.grandeza === 'temperatura' ? ' °C' : '%';
  if (f.valor >= 0) return { valor: `${numero(f.valor)}${unidade}`, legenda: `até o ${f.limite}` };
  const lado = f.limite === 'máximo' ? 'acima do máximo' : 'abaixo do mínimo';
  const sinal = f.limite === 'máximo' ? '+' : '−';
  return { valor: `${sinal}${numero(-f.valor)}${unidade}`, legenda: lado };
}

/** 18,0 -> "18"; 2,5 continua "2,5". */
export const limite = (v: number) => numero(v).replace(/,0$/, '');

function intervalo(min: number | null, max: number | null, unidade: string) {
  if (min !== null && max !== null) return `${limite(min)} a ${limite(max)}${unidade}`;
  if (max !== null) return `até ${limite(max)}${unidade}`;
  if (min !== null) return `a partir de ${limite(min)}${unidade}`;
  return null;
}

/** Faixa em uma linha: a de temperatura; sem ela, a de umidade; sem nenhuma, "sem faixa". */
export function faixaCurta(faixa: Faixa) {
  return (
    intervalo(faixa.temperatura_min, faixa.temperatura_max, ' °C') ??
    (intervalo(faixa.umidade_min, faixa.umidade_max, '%')?.replace(/^/, 'umidade ') || 'sem faixa')
  );
}

export function resumo(salas: StatusDaSala[]) {
  const contar = (status: StatusDaSala['status']) =>
    salas.filter((s) => s.status === status).length;
  return { fora: contar('fora_da_faixa'), dentro: contar('ok'), semLeitura: contar('sem_leitura') };
}
