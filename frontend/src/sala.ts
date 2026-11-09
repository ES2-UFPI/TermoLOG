import type { Faixa, LeituraDoSensor, SensorResumo, UsuarioLogado } from './api';
import { folga, folgaDaTemperatura, folgaDe, intervalo, numero, textoDaFolga } from './painel.ts';

// Regras da tela da sala (#180): sem React, para testar no Node.

/**
 * Só o visualizador perde as ações. Enquanto o backend não devolve `perfil` (US24), todo
 * mundo é tratado como administrador; sem saber quem está logado, as ações ficam escondidas.
 */
export const podeAdministrar = (usuario: UsuarioLogado | null) =>
  usuario !== null && usuario.perfil !== 'visualizador';

export type SensorDaSala = { sensor: SensorResumo; leitura: LeituraDoSensor | null };

/**
 * Junta cada sensor à sua última leitura, por ID, para a posição não mudar a cada busca.
 * O status só traz leitura de sensor ativo (Contrato, 2.3): inativo fica sem leitura.
 */
export function sensoresDaSala(sensores: SensorResumo[], leituras: LeituraDoSensor[]) {
  const porSensor = new Map(leituras.map((l) => [l.sensor_id, l]));
  const todos = [...sensores]
    .sort((a, b) => a.id - b.id)
    .map((sensor) => ({
      sensor,
      leitura: sensor.ativo ? (porSensor.get(sensor.id) ?? null) : null,
    }));
  return {
    ativos: todos.filter((s) => s.sensor.ativo),
    inativos: todos.filter((s) => !s.sensor.ativo),
  };
}

/** Dentro ou fora da faixa, de uma leitura só, e qual grandeza saiu. */
export function avaliarLeitura(leitura: LeituraDoSensor, faixa: Faixa) {
  const temperaturaFora = (folgaDaTemperatura(leitura, faixa)?.valor ?? 0) < 0;
  const umidadeFora =
    (folgaDe(leitura.umidade, faixa.umidade_min, faixa.umidade_max)?.valor ?? 0) < 0;
  const f = folga(leitura, faixa);
  if (!f) {
    return {
      tom: 'neutro' as const,
      titulo: 'Sem faixa definida',
      detalhe: null,
      temperaturaFora,
      umidadeFora,
    };
  }
  const { valor, legenda } = textoDaFolga(f);
  return {
    tom: f.valor < 0 ? ('alerta' as const) : ('ok' as const),
    titulo: f.valor < 0 ? 'Fora da faixa' : 'Dentro da faixa',
    detalhe: `${valor} ${legenda}`,
    temperaturaFora,
    umidadeFora,
  };
}

/** "21/10/2026, 14:30": a data sempre junto, para leitura antiga não parecer atual. */
export const dataHoraDaLeitura = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Intervalo de leitura; vem null até a US03. */
export function textoDoIntervalo(segundos: number | null | undefined) {
  if (segundos === null || segundos === undefined) return 'Não definido';
  return segundos >= 60 && segundos % 60 === 0 ? `${segundos / 60} min` : `${segundos} s`;
}

/** Os dados fixos do cabeçalho da sala. */
export function fatosDaSala(
  faixa: Faixa,
  intervaloS: number | null | undefined,
  conformidade: number | null | undefined,
) {
  return [
    {
      rotulo: 'Temperatura',
      valor: intervalo(faixa.temperatura_min, faixa.temperatura_max, ' °C') ?? 'Sem limite',
    },
    {
      rotulo: 'Umidade',
      valor: intervalo(faixa.umidade_min, faixa.umidade_max, '%') ?? 'Sem limite',
    },
    { rotulo: 'Intervalo de leitura', valor: textoDoIntervalo(intervaloS) },
    {
      rotulo: 'Conformidade 24 h',
      valor:
        conformidade === null || conformidade === undefined
          ? 'Sem leituras'
          : `${numero(conformidade)}%`,
    },
  ];
}

/**
 * Altura de cada rótulo da régua: sensores com valores próximos sobem de nível em vez de
 * escreverem um por cima do outro. `distancia` na mesma unidade das posições.
 */
export function niveisDosRotulos(posicoes: number[], distancia: number) {
  const ultimaDoNivel: number[] = [];
  const niveis = posicoes.map(() => 0);
  const ordem = posicoes.map((_, i) => i).sort((a, b) => posicoes[a] - posicoes[b]);
  for (const i of ordem) {
    const livre = ultimaDoNivel.findIndex((fim) => posicoes[i] - fim >= distancia);
    const nivel = livre === -1 ? ultimaDoNivel.length : livre;
    ultimaDoNivel[nivel] = posicoes[i];
    niveis[i] = nivel;
  }
  return niveis;
}

/** Colunas da grade de sensores, sem deixar um sensor sozinho na última linha. */
export function colunasDaGrade(sensores: number, largura: number) {
  const maximo = largura >= 1080 ? 4 : largura >= 760 ? 3 : largura >= 520 ? 2 : 1;
  const colunas = Math.max(1, Math.min(sensores, maximo));
  return colunas > 2 && sensores % colunas === 1 ? colunas - 1 : colunas;
}
