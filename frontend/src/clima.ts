import type { AcaoDeClimatizacao, ComandoDeClimatizacao } from './api';

// Regras do controle do ar-condicionado (#162): sem React, para testar no Node.

/** Faixa que a API aceita no ajuste (#160). */
export const TEMPERATURA_MIN = 16;
export const TEMPERATURA_MAX = 30;
/** Meta do seletor quando nenhum ajuste foi entregue ainda. */
export const META_PADRAO = 22;

export const limitarTemperatura = (t: number) =>
  Math.min(TEMPERATURA_MAX, Math.max(TEMPERATURA_MIN, Math.round(t)));

const ROTULO_DA_ACAO: Record<AcaoDeClimatizacao, string> = {
  ligar: 'Ligar',
  desligar: 'Desligar',
  ajustar: 'Ajustar',
};
const ROTULO_DA_SITUACAO: Record<ComandoDeClimatizacao['situacao'], string> = {
  pendente: 'Pendente',
  entregue: 'Entregue',
  expirado: 'Expirado',
};

export type EstadoDoEquipamento = { ligado: boolean | null; meta: number | null };

// O GET lista a sala inteira: depois de trocar o emissor, os comandos do sensor antigo ficam
// na lista, mas não dizem nada sobre o equipamento do sensor atual.
const doSensor = (comandos: ComandoDeClimatizacao[], sensorId: number) =>
  comandos
    .filter((c) => c.sensor_id === sensorId)
    .sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));

/**
 * O infravermelho não devolve confirmação: o estado é o do último comando entregue, nunca
 * uma leitura do equipamento. Ajustar também liga, como no controle remoto.
 */
export function estadoDoEquipamento(
  comandos: ComandoDeClimatizacao[],
  sensorId: number,
): EstadoDoEquipamento {
  const entregues = doSensor(comandos, sensorId).filter((c) => c.situacao === 'entregue');
  const ultimo = entregues[0];
  return {
    ligado: ultimo ? ultimo.acao !== 'desligar' : null,
    meta: entregues.find((c) => c.acao === 'ajustar')?.temperatura_c ?? null,
  };
}

export function textoDoEstado({ ligado, meta }: EstadoDoEquipamento) {
  if (ligado === null) return 'Sem comando entregue';
  if (!ligado) return 'Desligado';
  return meta === null ? 'Ligado' : `Ligado, meta ${meta} °C`;
}

export const temPendente = (comandos: ComandoDeClimatizacao[], sensorId: number) =>
  doSensor(comandos, sensorId).some((c) => c.situacao === 'pendente');

/** A meta do ajuste mais recente ainda pendente, que o dial mostra como "Aguardando". */
export const ajustePendente = (comandos: ComandoDeClimatizacao[], sensorId: number) =>
  doSensor(comandos, sensorId).find((c) => c.situacao === 'pendente' && c.acao === 'ajustar')
    ?.temperatura_c ?? null;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Uma linha da lista de comandos, já em texto. A data é a local, como no resto do painel. */
export function linhaDoComando(c: ComandoDeClimatizacao) {
  const d = new Date(c.criado_em);
  return {
    acao: ROTULO_DA_ACAO[c.acao],
    temperatura: c.temperatura_c === null ? '–' : `${c.temperatura_c} °C`,
    usuario: c.usuario.nome,
    dataHora: `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`,
    situacao: ROTULO_DA_SITUACAO[c.situacao],
  };
}

export const mensagemDoEnvio = (acao: AcaoDeClimatizacao, temperatura: number | null) =>
  `${ROTULO_DA_ACAO[acao]}${acao === 'ajustar' ? ` para ${temperatura} °C` : ''} enviado, pendente`;

// O dial: 270 graus, de 16 °C embaixo à esquerda até 30 °C embaixo à direita. Ângulo em
// graus no sentido do SVG (0 à direita, crescendo no sentido horário).
export const ANGULO_INICIAL = 135;
export const VARREDURA = 270;
const GRAUS_POR_C = VARREDURA / (TEMPERATURA_MAX - TEMPERATURA_MIN);

export const anguloDa = (t: number) => ANGULO_INICIAL + (t - TEMPERATURA_MIN) * GRAUS_POR_C;

/** A temperatura sob o ponteiro, pela direção a partir do centro do dial. */
export function temperaturaDoPonto(dx: number, dy: number) {
  const angulo = (Math.atan2(dy, dx) * 180) / Math.PI;
  const relativo = (((angulo - ANGULO_INICIAL) % 360) + 360) % 360;
  if (relativo > VARREDURA) {
    // No vão de baixo: a ponta mais perto.
    return relativo < VARREDURA + (360 - VARREDURA) / 2 ? TEMPERATURA_MAX : TEMPERATURA_MIN;
  }
  return limitarTemperatura(TEMPERATURA_MIN + relativo / GRAUS_POR_C);
}
