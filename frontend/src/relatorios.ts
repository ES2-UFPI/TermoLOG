import type { Faixa } from './api';
import { folgaDe } from './painel.ts';

// Regras da tela de relatórios (#109): sem React, para testar no Node.

export type Formato = 'pdf' | 'xlsx' | 'csv';

/** Cada tipo é uma rota: GET /relatorios/leituras (#109) e GET /relatorios/alertas (#119). */
export type TipoDeRelatorio = 'leituras' | 'alertas';
export const TIPOS: { id: TipoDeRelatorio; rotulo: string }[] = [
  { id: 'leituras', rotulo: 'Leituras' },
  { id: 'alertas', rotulo: 'Alertas' },
];

// Contrato (2.8): os três formatos. O Excel (#108) liga aqui quando a API tiver.
export const FORMATOS: { id: Formato; rotulo: string; pronto: boolean }[] = [
  { id: 'pdf', rotulo: 'PDF', pronto: true },
  { id: 'xlsx', rotulo: 'Excel', pronto: false },
  { id: 'csv', rotulo: 'CSV', pronto: true },
];

const doisDigitos = (n: number) => String(Math.abs(n)).padStart(2, '0');

/** Valor do campo de data: "2026-10-16", no dia local e não em UTC. */
export const dataDoCampo = (d: Date) =>
  `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

/** Início ou fim do dia local em ISO 8601, sempre com o fuso (#87). */
export function dataComFuso(campo: string, fimDoDia: boolean) {
  const [ano, mes, dia] = campo.split('-').map(Number);
  const d = fimDoDia ? new Date(ano, mes - 1, dia, 23, 59, 59) : new Date(ano, mes - 1, dia);
  const minutos = -d.getTimezoneOffset();
  const sinal = minutos < 0 ? '-' : '+';
  const fuso = `${sinal}${doisDigitos(Math.trunc(minutos / 60))}:${doisDigitos(minutos % 60)}`;
  const hora = fimDoDia ? '23:59:59' : '00:00:00';
  return `${campo}T${hora}${fuso}`;
}

export type Periodo = { inicio: string; fim: string };

const antes = (agora: Date, dias: number) =>
  new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - dias);

export const ATALHOS: { rotulo: string; periodo: (agora: Date) => Periodo }[] = [
  {
    rotulo: 'Últimos 7 dias',
    periodo: (agora) => ({ inicio: dataDoCampo(antes(agora, 6)), fim: dataDoCampo(agora) }),
  },
  {
    rotulo: 'Últimos 30 dias',
    periodo: (agora) => ({ inicio: dataDoCampo(antes(agora, 29)), fim: dataDoCampo(agora) }),
  },
  {
    rotulo: 'Mês passado',
    periodo: (agora) => ({
      inicio: dataDoCampo(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)),
      fim: dataDoCampo(new Date(agora.getFullYear(), agora.getMonth(), 0)),
    }),
  },
];

/** Barra o período inválido antes de chamar a API; null quando está certo. */
export function erroDoPeriodo({ inicio, fim }: Periodo) {
  if (!inicio || !fim) return 'Escolha o último dia do período no calendário.';
  // "AAAA-MM-DD" em ordem de texto é a mesma ordem das datas.
  if (inicio > fim) return 'O início do período não pode ser depois do fim.';
  return null;
}

/** Query das rotas de relatório (Contrato, 2.8): a mesma para os dois tipos. */
export function parametrosDoRelatorio(salaId: number, { inicio, fim }: Periodo, formato: Formato) {
  return new URLSearchParams({
    sala_id: String(salaId),
    inicio: dataComFuso(inicio, false),
    fim: dataComFuso(fim, true),
    formato,
  }).toString();
}

/** Nome do arquivo no Content-Disposition; sem ele, um nome pelo formato. */
export function nomeDoArquivo(
  cabecalho: string | null,
  formato: Formato,
  tipo: TipoDeRelatorio = 'leituras',
) {
  return cabecalho?.match(/filename="?([^";]+)"?/)?.[1] ?? `relatorio-${tipo}.${formato}`;
}

/** Primeiro clique: novo início. Segundo: o fim, trocando os dois se vier antes do início. */
export function escolherDia({ inicio, fim }: Periodo, dia: string): Periodo {
  if (!inicio || fim) return { inicio: dia, fim: '' };
  return dia < inicio ? { inicio: dia, fim: inicio } : { inicio, fim: dia };
}

/** Como o dia entra na marcação do calendário. */
export function noPeriodo(dia: string, inicio: string, fim: string | null) {
  if (!inicio) return { dentro: false, ponta: false, inicio: false, fim: false, unico: false };
  const [de, ate] = fim && fim < inicio ? [fim, inicio] : [inicio, fim ?? inicio];
  return {
    dentro: dia >= de && dia <= ate,
    ponta: dia === de || dia === ate,
    inicio: dia === de,
    fim: dia === ate,
    unico: de === ate,
  };
}

/** As semanas do mês, de domingo a sábado, completas com os dias vizinhos. */
export function semanasDoMes(ano: number, mes: number) {
  const primeiro = new Date(ano, mes, 1);
  const dias = new Date(ano, mes + 1, 0).getDate() + primeiro.getDay();
  const total = Math.ceil(dias / 7) * 7;
  const semanas: string[][] = [];
  for (let i = 0; i < total; i++) {
    const campo = dataDoCampo(new Date(ano, mes, 1 + i - primeiro.getDay()));
    if (i % 7 === 0) semanas.push([]);
    semanas[semanas.length - 1].push(campo);
  }
  return semanas;
}

/** "16 de outubro de 2026", para o leitor de tela. */
export const diaPorExtenso = (campo: string) => {
  const [ano, mes, dia] = campo.split('-').map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/** "16/10/2026", ou um pedido enquanto o dia não foi escolhido. */
export const dataLegivel = (campo: string) =>
  campo ? `${campo.slice(8)}/${campo.slice(5, 7)}/${campo.slice(0, 4)}` : 'Escolha o dia';

export type Grandeza = 'temperatura' | 'umidade';
export type LeituraDoRelatorio = {
  /** Posição no arquivo: identifica a linha mesmo com duas leituras no mesmo segundo. */
  id: number;
  dataHora: string;
  instante: number;
  temperatura: number;
  umidade: number;
  sensor: number;
};
export type RelatorioLido = { cabecalho: string[][]; leituras: LeituraDoRelatorio[] };

/** Linhas e células do CSV da API: ";", aspas com "" dentro e fim de linha CRLF. */
export function lerCsv(texto: string) {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = '';
  let entreAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (c === '"') entreAspas = false;
      else celula += c;
    } else if (c === '"') entreAspas = true;
    else if (c === ';') {
      linha.push(celula);
      celula = '';
    } else if (c === '\n') {
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = '';
    } else if (c !== '\r') celula += c;
  }
  if (celula || linha.length > 0) linhas.push([...linha, celula]);
  return linhas;
}

// O arquivo vem no horário de Brasília (UTC-3, sem horário de verão).
function instanteDe(dataHora: string) {
  const [dia, mes, ano, hora, minuto, segundo] = dataHora.split(/[/ :]/).map(Number);
  return Date.UTC(ano, mes - 1, dia, hora + 3, minuto, segundo);
}

const numeroDoCsv = (texto: string) => Number(texto.replace(',', '.'));

// O apóstrofo só existe para a planilha não tratar o texto como fórmula (a mesma lista
// de caracteres do backend).
const semApostrofo = (texto: string) => texto.replace(/^'(?=[=+\-@\t\r])/, '');

/** O arquivo como a API gerou: o cabeçalho até a linha em branco, a tabela depois dela. */
function partesDoCsv(texto: string) {
  const linhas = lerCsv(texto.replace(/^\uFEFF/, ''));
  const branco = linhas.findIndex((l) => l.length === 1 && l[0] === '');
  return {
    cabecalho: linhas.slice(0, branco).map(([r, v]) => [r, semApostrofo(v)]),
    colunas: linhas[branco + 1] ?? [],
    tabela: linhas.slice(branco + 2),
  };
}

export function lerRelatorio(texto: string): RelatorioLido {
  const { cabecalho, tabela } = partesDoCsv(texto);
  return {
    cabecalho,
    leituras: tabela.map(([dataHora, temperatura, umidade, sensor], id) => ({
      id,
      dataHora,
      instante: instanteDe(dataHora),
      temperatura: numeroDoCsv(temperatura),
      umidade: numeroDoCsv(umidade),
      sensor: Number(sensor),
    })),
  };
}

export type RelatorioDeAlertasLido = {
  cabecalho: string[][];
  colunas: string[];
  /** Uma linha por alerta, as células como o arquivo traz. */
  alertas: string[][];
};

/** O CSV de GET /relatorios/alertas (#119): a prévia mostra a tabela como ela é. */
export function lerRelatorioDeAlertas(texto: string): RelatorioDeAlertasLido {
  const { cabecalho, colunas, tabela } = partesDoCsv(texto);
  return { cabecalho, colunas, alertas: tabela.map((linha) => linha.map(semApostrofo)) };
}

/** O relatório lido leva o tipo junto: cada tipo tem a sua prévia. */
export type Lido =
  | { tipo: 'leituras'; relatorio: RelatorioLido }
  | { tipo: 'alertas'; relatorio: RelatorioDeAlertasLido };

export const lerPeloTipo = (tipo: TipoDeRelatorio, texto: string): Lido =>
  tipo === 'leituras'
    ? { tipo, relatorio: lerRelatorio(texto) }
    : { tipo, relatorio: lerRelatorioDeAlertas(texto) };

/** A prévia guardada só vale para o tipo escolhido: a do outro tipo não fica na tela. */
export const doTipo = (lido: Lido | null, tipo: TipoDeRelatorio) =>
  lido?.tipo === tipo ? lido : null;

const limitesDe = (faixa: Faixa, g: Grandeza) =>
  g === 'temperatura'
    ? ([faixa.temperatura_min, faixa.temperatura_max] as const)
    : ([faixa.umidade_min, faixa.umidade_max] as const);

/** A leitura pela faixa configurada, a mesma que o cabeçalho do relatório mostra. */
export function dentroDaGrandeza(l: LeituraDoRelatorio, faixa: Faixa, g: Grandeza) {
  const [min, max] = limitesDe(faixa, g);
  return (folgaDe(l[g], min, max)?.valor ?? 0) >= 0;
}

/** Menor e maior, sem espalhar a lista em argumentos: um mês estouraria a pilha. */
export function extremos(valores: number[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of valores) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function resumoDoRelatorio(leituras: LeituraDoRelatorio[], faixa: Faixa) {
  return {
    total: leituras.length,
    sensores: [...new Set(leituras.map((l) => l.sensor))].sort((a, b) => a - b),
    fora: leituras.filter(
      (l) => !dentroDaGrandeza(l, faixa, 'temperatura') || !dentroDaGrandeza(l, faixa, 'umidade'),
    ).length,
    temperatura: leituras.length > 0 ? extremos(leituras.map((l) => l.temperatura)) : null,
  };
}

/**
 * Pontos de uma linha do gráfico: em cada balde, o menor e o maior valor. Assim um pico
 * continua visível mesmo com milhares de leituras em poucos pixels.
 */
export function reduzirSerie(leituras: LeituraDoRelatorio[], g: Grandeza, baldes: number) {
  if (leituras.length <= baldes * 2) return leituras;
  const pontos: LeituraDoRelatorio[] = [];
  const tamanho = leituras.length / baldes;
  for (let b = 0; b < baldes; b++) {
    const balde = leituras.slice(Math.floor(b * tamanho), Math.floor((b + 1) * tamanho));
    const menor = balde.reduce((a, l) => (l[g] < a[g] ? l : a));
    const maior = balde.reduce((a, l) => (l[g] > a[g] ? l : a));
    pontos.push(...(menor.instante <= maior.instante ? [menor, maior] : [maior, menor]));
  }
  return pontos;
}

/** Marcas do eixo em números redondos (passo 1, 2 ou 5), cobrindo os dois extremos. */
export function marcasDoEixo(lo: number, hi: number) {
  const distancia = hi - lo || 1;
  const bruto = distancia / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = ([1, 2, 5, 10].find((m) => m * potencia >= bruto) ?? 10) * potencia;
  const marcas: number[] = [];
  for (let v = Math.floor(lo / passo); v <= Math.ceil(hi / passo); v++) {
    marcas.push(Math.round(v * passo * 1000) / 1000);
  }
  return marcas.length > 1 ? marcas : [marcas[0], marcas[0] + passo];
}

const diaEmBrasilia = (ms: number) =>
  new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
export const mesmoDia = (a: number, b: number) => diaEmBrasilia(a) === diaEmBrasilia(b);

export const LINHAS_POR_PAGINA = 25;

/** A página pedida da tabela, trazida para dentro do limite quando um filtro encurta a lista. */
export function linhasDaPagina<T>(leituras: T[], pagina: number) {
  const paginas = Math.max(1, Math.ceil(leituras.length / LINHAS_POR_PAGINA));
  const paginaAtual = Math.min(Math.max(1, pagina), paginas);
  const inicio = (paginaAtual - 1) * LINHAS_POR_PAGINA;
  return { linhas: leituras.slice(inicio, inicio + LINHAS_POR_PAGINA), paginaAtual, paginas };
}
