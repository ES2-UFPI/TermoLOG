import type { Gateway, SensorResumo } from './api';

// Regras da lista de sensores da sala (#95): sem React, para testar no Node.

/** Ativos primeiro; dentro de cada grupo, do mais novo para o mais antigo (ID maior). */
export const ordenarSensores = <T extends SensorResumo>(sensores: T[]) =>
  [...sensores].sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.id - a.id);

/** Troca o sensor pelo que a API devolveu (ex.: depois de desativar) ou acrescenta. */
export function comSensor<T extends SensorResumo>(sensores: T[], sensor: T) {
  const outros = sensores.filter((s) => s.id !== sensor.id);
  return ordenarSensores([...outros, sensor]);
}

/** Gateway já escolhido ao abrir: o único, ou o primeiro online, ou o primeiro da lista. */
export function gatewayPadrao(gateways: Gateway[]) {
  return (gateways.find((g) => g.online) ?? gateways[0])?.id ?? null;
}

export const nomeDoGateway = (gateways: Gateway[], id: number) =>
  gateways.find((g) => g.id === id)?.nome ?? `Gateway ${id}`;

/** "27/10/2026" (data do cadastro, sem hora). */
export const dataDoCadastro = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Resumo para o cabeçalho da lista: "2 ativos · 1 inativo". */
export function resumoDosSensores(sensores: SensorResumo[]) {
  const ativos = sensores.filter((s) => s.ativo).length;
  const inativos = sensores.length - ativos;
  if (sensores.length === 0) return 'nenhum sensor';
  const partes = [`${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}`];
  if (inativos > 0) partes.push(`${inativos} ${inativos === 1 ? 'inativo' : 'inativos'}`);
  return partes.join(' · ');
}
