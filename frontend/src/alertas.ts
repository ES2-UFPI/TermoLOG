import type { Alerta, SituacaoDoAlerta, TipoDoDesvio } from './api';

// Regras da tela de alertas (#103): sem React, para testar no Node.

export const ABAS_DOS_ALERTAS: { situacao: SituacaoDoAlerta; rotulo: string; vazia: string }[] = [
  { situacao: 'pendente', rotulo: 'Pendentes', vazia: 'Nenhum alerta pendente.' },
  { situacao: 'reconhecido', rotulo: 'Reconhecidos', vazia: 'Nenhum alerta reconhecido.' },
  { situacao: 'encerrado', rotulo: 'Encerrados', vazia: 'Nenhum alerta encerrado.' },
];

/** Uma lista por situação; null enquanto aquela situação ainda não foi buscada. */
export type ListasDeAlertas = Record<SituacaoDoAlerta, Alerta[] | null>;

export const LISTAS_VAZIAS: ListasDeAlertas = {
  pendente: null,
  reconhecido: null,
  encerrado: null,
};

/**
 * O que buscar com a aba aberta. Pendentes e reconhecidos vêm sempre, para as abas mostrarem
 * quantos há; os encerrados só crescem e só vêm quando a aba deles está aberta.
 */
export const situacoesABuscar = (aba: SituacaoDoAlerta): SituacaoDoAlerta[] =>
  aba === 'encerrado' ? ['pendente', 'reconhecido', 'encerrado'] : ['pendente', 'reconhecido'];

// A mesma ordem de GET /alertas: os mais recentes primeiro.
const maisRecenteAntes = (a: Alerta, b: Alerta) =>
  b.data_hora.localeCompare(a.data_hora) || b.id - a.id;

/**
 * Põe o alerta que a API devolveu na lista da situação dele e o tira das outras. Assim o
 * alerta reconhecido passa para os reconhecidos na hora, sem esperar a próxima busca.
 * Lista ainda não buscada continua null: a busca dela trará o alerta.
 */
export function moverAlerta(listas: ListasDeAlertas, alerta: Alerta): ListasDeAlertas {
  const novas = { ...listas };
  for (const situacao of Object.keys(novas) as SituacaoDoAlerta[]) {
    const lista = novas[situacao];
    if (lista === null) continue;
    const sem = lista.filter((a) => a.id !== alerta.id);
    novas[situacao] = situacao === alerta.situacao ? [...sem, alerta].sort(maisRecenteAntes) : sem;
  }
  return novas;
}

const DESVIOS: Record<TipoDoDesvio, string> = {
  temperatura_abaixo: 'Temperatura abaixo da faixa',
  temperatura_acima: 'Temperatura acima da faixa',
  umidade_abaixo: 'Umidade abaixo da faixa',
  umidade_acima: 'Umidade acima da faixa',
};
export const textoDoDesvio = (tipo: TipoDoDesvio) => DESVIOS[tipo] ?? 'Fora da faixa';

/** O limite de POST /alertas/{id}/encerrar (Contrato, 2.7). */
export const TAMANHO_MAXIMO_DA_ACAO = 2000;

/** Erro da ação corretiva antes de enviar; null quando dá para encerrar. */
export function erroDaAcaoCorretiva(texto: string) {
  const limpo = texto.trim();
  if (!limpo) return 'Descreva a ação tomada para encerrar o alerta.';
  if (limpo.length > TAMANHO_MAXIMO_DA_ACAO) {
    return `A descrição passa de ${TAMANHO_MAXIMO_DA_ACAO.toLocaleString('pt-BR')} caracteres.`;
  }
  return null;
}

/**
 * Texto do erro ao reconhecer ou encerrar. O 409 é o alerta que mudou de situação em outra
 * tela (outra pessoa reconheceu, por exemplo): a tela avisa e busca as listas de novo.
 */
export function erroDaAcao(status: number | undefined, mensagem: string) {
  if (status === 409) {
    const motivo = mensagem.charAt(0).toUpperCase() + mensagem.slice(1);
    return `${motivo}. Alguém pode ter mexido nele em outra tela; a lista foi atualizada.`;
  }
  if (status === 404) return 'Este alerta não existe mais; a lista foi atualizada.';
  return `Não deu certo: ${mensagem}.`;
}

/** 409 e 404: a lista na tela está velha e precisa ser buscada de novo. */
export const listaFicouVelha = (status: number | undefined) => status === 409 || status === 404;
