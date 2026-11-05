const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

// GET /salas/status (Contrato de API, 2.3). Limite null = sem limite daquele lado.
export type Faixa = {
  temperatura_min: number | null;
  temperatura_max: number | null;
  umidade_min: number | null;
  umidade_max: number | null;
};

export type LeituraDoSensor = {
  sensor_id: number;
  temperatura: number;
  umidade: number;
  data_hora: string;
};

export type StatusDaSala = {
  sala_id: number;
  nome: string;
  faixa: Faixa;
  intervalo_leitura_s: number | null;
  status: 'ok' | 'fora_da_faixa' | 'sem_leitura';
  leituras: LeituraDoSensor[];
};

// Menor que o intervalo do painel (30 s): uma busca presa não segura a próxima.
const TEMPO_LIMITE_MS = 10_000;

// POST /salas, GET e PATCH /salas/{id} (Contrato de API, 2.4).
export type SalaDetalhe = {
  id: number;
  nome: string;
  descricao: string | null;
  faixa: Faixa;
};

export type CorpoDaSala = { nome: string; descricao: string | null; faixa: Faixa };

/**
 * Texto do erro da API para mostrar na tela. No 422 o FastAPI manda `detail` como lista
 * (validação) ou texto; a mensagem do validador vem com o prefixo "Value error, ".
 */
export function mensagemDoErro(status: number, corpo: unknown) {
  const detalhe = (corpo as { detail?: unknown } | null)?.detail;
  if (typeof detalhe === 'string') return detalhe;
  if (Array.isArray(detalhe) && typeof detalhe[0]?.msg === 'string') {
    return detalhe[0].msg.replace(/^Value error, /, '');
  }
  return `Erro ${status}`;
}

async function pedir<T>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  }).catch((erro: Error) => {
    throw erro.name === 'TimeoutError' ? new Error('a API não respondeu a tempo') : erro;
  });
  if (!resposta.ok) {
    const corpoDoErro = await resposta.json().catch(() => null);
    throw new Error(mensagemDoErro(resposta.status, corpoDoErro));
  }
  return resposta.json();
}

export const getHealth = () => pedir<{ status: string }>('/health');
export const getStatusDasSalas = () => pedir<StatusDaSala[]>('/salas/status');
export const getSala = (id: number) => pedir<SalaDetalhe>(`/salas/${id}`);
export const cadastrarSala = (corpo: CorpoDaSala) => pedir<SalaDetalhe>('/salas', 'POST', corpo);
export const editarSala = (id: number, corpo: CorpoDaSala) =>
  pedir<SalaDetalhe>(`/salas/${id}`, 'PATCH', corpo);

// Sensores e gateways (Contrato de API, 2.5 e 2.6). O ID do sensor vem do backend.
export type Sensor = {
  id: number;
  gateway_id: number;
  ativo: boolean;
  data_cadastro: string;
  sala_id: number;
  sala_nome: string;
};

export type Gateway = {
  id: number;
  nome: string;
  online: boolean;
  ultimo_contato: string | null;
};

export const getSensores = (salaId: number) => pedir<Sensor[]>(`/salas/${salaId}/sensores`);
export const adicionarSensor = (salaId: number, gatewayId: number) =>
  pedir<Sensor>(`/salas/${salaId}/sensores`, 'POST', { gateway_id: gatewayId });
export const desativarSensor = (id: number) => pedir<Sensor>(`/sensores/${id}/desativar`, 'POST');
export const getGateways = () => pedir<Gateway[]>('/gateways');

/** Resposta de POST /gateways: a única vez em que a chave de API aparece. */
export type GatewayCriado = { id: number; nome: string; chave_api: string };
export const cadastrarGateway = (nome: string) =>
  pedir<GatewayCriado>('/gateways', 'POST', { nome });
