import type { StatusDaSala } from './api';
import { resumo, type Tom } from './painel.ts';

// Regras da barra do topo (#185): sem React, para testar no Node.

export type Aba = { rota: '/' | '/gateways' | '/relatorios'; rotulo: string; admin?: boolean };

export const ABAS: Aba[] = [
  { rota: '/', rotulo: 'Painel' },
  // GET /gateways é rota de administrador (Contrato, 2.6).
  { rota: '/gateways', rotulo: 'Gateways', admin: true },
  { rota: '/relatorios', rotulo: 'Relatórios' },
];

/** A aba da tela atual. A tela de uma sala fica no Painel; o resto não marca nenhuma. */
export function abaAtiva(rota: string) {
  if (rota === '/' || rota.startsWith('/sala')) return '/';
  return ABAS.find((a) => a.rota === rota)?.rota ?? null;
}

/** A frase da barra: `texto` completo e `curto` para quando falta espaço. */
export function situacaoDaBarra(
  salas: StatusDaSala[] | null,
  falhou: boolean,
): { tom: Tom; texto: string; curto: string; semConexao: boolean } {
  if (falhou) {
    return {
      tom: 'alerta',
      texto: 'Sem conexão com a API',
      curto: 'Sem conexão',
      semConexao: true,
    };
  }
  if (!salas) return { tom: 'neutro', texto: 'Buscando as salas', curto: '...', semConexao: false };
  if (salas.length === 0) {
    return { tom: 'neutro', texto: 'Nenhuma sala', curto: '0 salas', semConexao: false };
  }
  const { fora, semLeitura } = resumo(salas);
  if (fora > 0) {
    return {
      tom: 'alerta',
      texto: `${fora} ${fora === 1 ? 'sala fora' : 'salas fora'} da faixa`,
      curto: `${fora} fora`,
      semConexao: false,
    };
  }
  if (semLeitura > 0) {
    return {
      tom: 'sem-leitura',
      texto: `Nenhuma fora, ${semLeitura} sem leitura`,
      curto: `${semLeitura} sem leitura`,
      semConexao: false,
    };
  }
  return { tom: 'ok', texto: 'Todas na faixa', curto: 'Na faixa', semConexao: false };
}

/** "Ana Maria Lima" vira "AL"; sem nome, vazio (a barra mostra um ícone). */
export function iniciais(nome: string | null | undefined) {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return `${partes[0][0]}${ultima}`.toUpperCase();
}
