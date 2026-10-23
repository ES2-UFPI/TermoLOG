import type { Faixa, LeituraDoSensor, StatusDaSala } from './api';

/** 9.1 -> "9,1"; negativo com o sinal de menos tipográfico e sem "-0,0". */
export function numero(valor: number, casas = 1) {
  const fator = 10 ** casas;
  const arredondado = Math.round(valor * fator) / fator || 0; // `|| 0` troca -0 por 0
  return arredondado
    .toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: casas })
    .replace('-', '−');
}

/** Hora da leitura; se não for de hoje, com a data antes, para leitura antiga não parecer atual. */
export function quando(data: string | Date, agora = new Date()) {
  const d = new Date(data);
  const horario = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === agora.toDateString()) return horario;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${horario}`;
}

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

/** Folga só da temperatura (°C); null quando a sala não tem limite de temperatura. */
export const folgaDaTemperatura = (leitura: LeituraDoSensor, faixa: Faixa) =>
  folgaDe(leitura.temperatura, faixa.temperatura_min, faixa.temperatura_max);

/**
 * A folga que importa na leitura, sem comparar °C com %: o que estiver fora primeiro
 * (temperatura antes de umidade); dentro da faixa, a temperatura; sem ela, a umidade.
 */
export function folga(leitura: LeituraDoSensor, faixa: Faixa): Folga | null {
  const temperatura = folgaDaTemperatura(leitura, faixa);
  const umidade = folgaDe(leitura.umidade, faixa.umidade_min, faixa.umidade_max);
  if (temperatura && temperatura.valor < 0) return { grandeza: 'temperatura', ...temperatura };
  if (umidade && umidade.valor < 0) return { grandeza: 'umidade', ...umidade };
  if (temperatura) return { grandeza: 'temperatura', ...temperatura };
  return umidade && { grandeza: 'umidade', ...umidade };
}

/**
 * Leitura que o card destaca. Ordem: fora da faixa antes de dentro, temperatura antes de
 * umidade, e só então a menor folga; assim °C e % nunca são comparados entre si.
 */
export function leituraPrincipal(sala: StatusDaSala) {
  const chave = (l: LeituraDoSensor) => {
    const f = folga(l, sala.faixa);
    if (!f) return [2, 0, 0];
    return [f.valor < 0 ? 0 : 1, f.grandeza === 'temperatura' ? 0 : 1, f.valor];
  };
  const compara = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return [...sala.leituras].sort((a, b) => compara(chave(a), chave(b)))[0] ?? null;
}

/** Fora da faixa primeiro, depois sem leitura, depois as que estão ok. */
// O JSON não é validado em tempo de execução: status desconhecido fica junto com sem leitura.
const ORDEM: Record<string, number> = { fora_da_faixa: 0, sem_leitura: 1, ok: 2 };
const posicao = (sala: StatusDaSala) => ORDEM[sala.status] ?? 1;
export const ordenar = (salas: StatusDaSala[]) =>
  [...salas].sort((a, b) => posicao(a) - posicao(b));

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
  | 'umidade'
  | 'congelado'
  | 'sem-sinal'
  | 'servidor'
  | 'laboratorio'
  | 'energia'
  | 'normal';

// ponytail: o tipo da sala sai do nome; trocar por um campo de tipo quando o cadastro tiver.
// Palavras inteiras (ou início de palavra), para "ups" não casar com "Grupos".
const TIPOS: [RegExp, Figura][] = [
  [/\b(servidor(es)?|data ?center|racks?)\b/i, 'servidor'],
  [/\b(laborat|microbio|an[áa]lise)/i, 'laboratorio'],
  [/\b(nobreaks?|ups|energia|geradore?s?)\b/i, 'energia'],
  [/\b(freezers?|congel)/i, 'congelado'],
];

/** Figura translúcida do card: o estado manda (fora, sem leitura); senão, o tipo da sala. */
export function figura(sala: StatusDaSala): Figura {
  const leitura = leituraPrincipal(sala);
  if (!leitura) return 'sem-sinal';
  const f = folga(leitura, sala.faixa);
  if (f && f.valor < 0) {
    if (f.grandeza === 'umidade') return 'umidade';
    return f.limite === 'máximo' ? 'quente' : 'frio';
  }
  const tipo = TIPOS.find(([nome]) => nome.test(sala.nome));
  if (tipo) return tipo[1];
  return leitura.temperatura < 0 ? 'congelado' : 'normal';
}

/** Texto da folga: "+1,1 °C acima do máximo" ou "3,6 °C até o máximo". */
export function textoDaFolga(f: Folga) {
  const unidade = f.grandeza === 'temperatura' ? ' °C' : '%';
  // Até 2 casas: um desvio de 0,04 não pode aparecer como "+0,0".
  const valor = numero(Math.abs(f.valor), 2);
  if (f.valor >= 0) return { valor: `${valor}${unidade}`, legenda: `até o ${f.limite}` };
  const lado = f.limite === 'máximo' ? 'acima do máximo' : 'abaixo do mínimo';
  const sinal = f.limite === 'máximo' ? '+' : '−';
  return { valor: `${sinal}${valor}${unidade}`, legenda: lado };
}

/** 18,0 -> "18"; 2,5 continua "2,5". */
export const limite = (v: number) => numero(v).replace(/,0$/, '');

function intervalo(min: number | null, max: number | null, unidade: string) {
  if (min !== null && max !== null) return `${limite(min)} a ${limite(max)}${unidade}`;
  if (max !== null) return `até ${limite(max)}${unidade}`;
  if (min !== null) return `a partir de ${limite(min)}${unidade}`;
  return null;
}

/** Faixa de umidade com o rótulo, ex. "umidade 30 a 60%"; null sem limite de umidade. */
export function faixaDeUmidade(faixa: Faixa) {
  const texto = intervalo(faixa.umidade_min, faixa.umidade_max, '%');
  return texto && `umidade ${texto}`;
}

const faixaDeTemperatura = (faixa: Faixa) =>
  intervalo(faixa.temperatura_min, faixa.temperatura_max, ' °C');

/** Faixa em uma linha: a de temperatura; sem ela, a de umidade; sem nenhuma, "sem faixa". */
export function faixaCurta(faixa: Faixa) {
  return faixaDeTemperatura(faixa) ?? faixaDeUmidade(faixa) ?? 'sem faixa';
}

/** As duas faixas, ex. "2 a 8 °C · umidade 30 a 60%"; null quando a sala não tem faixa. */
export function faixaCompleta(faixa: Faixa) {
  const partes = [faixaDeTemperatura(faixa), faixaDeUmidade(faixa)].filter((p) => p !== null);
  return partes.length > 0 ? partes.join(' · ') : null;
}

export type Tom = 'ok' | 'alerta' | 'sem-leitura' | 'neutro';

/**
 * Linha de situação do card: o tom (cor e ícone) e o texto. Sala sem faixa e status
 * desconhecido ficam neutros, para não aparecerem como conformes.
 */
export function situacao(sala: StatusDaSala): { tom: Tom; texto: string } {
  const leitura = leituraPrincipal(sala);
  if (!leitura) return { tom: 'sem-leitura', texto: 'Nenhum sensor ativo enviou dados' };
  const f = folga(leitura, sala.faixa);
  if (!f) return { tom: 'neutro', texto: 'Defina a faixa da sala para acompanhar desvios' };
  const { valor, legenda } = textoDaFolga(f);
  const tom = sala.status === 'fora_da_faixa' ? 'alerta' : sala.status === 'ok' ? 'ok' : 'neutro';
  return { tom, texto: `${valor} ${legenda}` };
}

export function resumo(salas: StatusDaSala[]) {
  const contar = (status: StatusDaSala['status']) =>
    salas.filter((s) => s.status === status).length;
  return { fora: contar('fora_da_faixa'), dentro: contar('ok'), semLeitura: contar('sem_leitura') };
}
