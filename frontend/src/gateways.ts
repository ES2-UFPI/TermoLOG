import type { Gateway } from './api';

// Regras da tela de gateways (#93): sem React, para testar no Node.

/** Online primeiro; depois em ordem alfabética, como a pessoa procura pelo nome. */
export const ordenarGateways = (gateways: Gateway[]) =>
  [...gateways].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome, 'pt-BR'),
  );

/** Mesma regra do backend (NomeDoGateway): sem espaços nas pontas, de 1 a 100 caracteres. */
export function erroDoNome(nome: string) {
  const limpo = nome.trim();
  if (limpo === '') return 'Dê um nome para o gateway.';
  if (limpo.length > 100) return 'O nome pode ter no máximo 100 caracteres.';
  return null;
}

/** "agora há pouco", "há 12 min", "há 3 h", "ontem às 14:05" ou "27/10 às 14:05". */
export function ultimoContato(iso: string, agora = new Date()) {
  const quando = new Date(iso);
  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60_000);
  if (minutos < 1) return 'agora há pouco';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 6 * 60) return `há ${Math.floor(minutos / 60)} h`;
  const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (quando.toDateString() === agora.toDateString()) return `hoje às ${hora}`;
  if (quando.toDateString() === ontem.toDateString()) return `ontem às ${hora}`;
  const dia = quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dia} às ${hora}`;
}

/** Resumo do topo da lista: "1 online · 2 offline". */
export function resumoDosGateways(gateways: Gateway[]) {
  if (gateways.length === 0) return 'nenhum gateway';
  const online = gateways.filter((g) => g.online).length;
  const offline = gateways.length - online;
  return [online > 0 && `${online} online`, offline > 0 && `${offline} offline`]
    .filter(Boolean)
    .join(' · ');
}
