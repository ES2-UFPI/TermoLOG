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
  /** Percentual das leituras das últimas 24 h dentro da faixa; null sem leitura na janela. */
  conformidade_24h?: number | null;
  leituras: LeituraDoSensor[];
};

// Menor que o intervalo do painel (30 s): uma busca presa não segura a próxima.
const TEMPO_LIMITE_MS = 10_000;

/** Sensor em GET /salas/{id}: a rota que qualquer perfil logado pode ler. */
export type SensorResumo = {
  id: number;
  gateway_id: number;
  ativo: boolean;
  data_cadastro: string;
};

// POST /salas, GET e PATCH /salas/{id} (Contrato de API, 2.4).
export type SalaDetalhe = {
  id: number;
  nome: string;
  descricao: string | null;
  faixa: Faixa;
  intervalo_leitura_s?: number | null;
  sensores?: SensorResumo[];
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

/** A API respondeu com erro (4xx/5xx). Falha de rede e tempo esgotado ficam como Error comum. */
export class ErroDaApi extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.status = status;
  }
}

// Sessão (Contrato de API, 2.2). O token fica no navegador para sobreviver a recarregar a
// página; o layout assina esta sessão para decidir entre o login e as telas do painel.
const CHAVE_TOKEN = 'termolog-token';
const CHAVE_ULTIMO_USO = 'termolog-ultimo-uso';

/** Tempo sem clique nem tecla até a próxima ação pedir login de novo. */
export const INATIVIDADE_MS = 30 * 60_000;

function lerGuardado(chave: string) {
  try {
    return globalThis.localStorage?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}

function guardar(chave: string, valor: string | null) {
  try {
    if (valor === null) globalThis.localStorage?.removeItem(chave);
    else globalThis.localStorage?.setItem(chave, valor);
  } catch {}
}

let token = lerGuardado(CHAVE_TOKEN);
let expirou = false;
const ouvintes = new Set<() => void>();
const avisar = () => {
  for (const ouvinte of ouvintes) ouvinte();
};

export const tokenAtual = () => token;
/** A última sessão acabou sozinha (401 ou inatividade), e não pelo botão de sair. */
export const sessaoExpirou = () => expirou;
export function assinarSessao(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function abrirSessao(novo: string, agora = Date.now()) {
  token = novo;
  expirou = false;
  guardar(CHAVE_TOKEN, novo);
  guardar(CHAVE_ULTIMO_USO, String(agora));
  avisar();
}

function encerrarSessao(porExpirar: boolean) {
  token = null;
  expirou = porExpirar;
  guardar(CHAVE_TOKEN, null);
  guardar(CHAVE_ULTIMO_USO, null);
  avisar();
}

// Saiu ou entrou em outra aba: esta acompanha.
globalThis.addEventListener?.('storage', (e) => {
  const evento = e as StorageEvent;
  if (evento.key !== CHAVE_TOKEN) return;
  token = evento.newValue;
  avisar();
});

async function pedir<T>(
  caminho: string,
  metodo = 'GET',
  corpo?: unknown,
  tokenDoPedido = token,
): Promise<T> {
  const cabecalhos: Record<string, string> = {};
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (tokenDoPedido) cabecalhos.Authorization = `Bearer ${tokenDoPedido}`;
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  }).catch((erro: Error) => {
    throw erro.name === 'TimeoutError' ? new Error('a API não respondeu a tempo') : erro;
  });
  // Só derruba a sessão que fez o pedido: um 401 atrasado não encerra um login mais novo,
  // e o 401 do próprio login (sem token) é só credencial errada.
  if (resposta.status === 401 && tokenDoPedido && tokenDoPedido === token) encerrarSessao(true);
  if (!resposta.ok) {
    const corpoDoErro = await resposta.json().catch(() => null);
    throw new ErroDaApi(mensagemDoErro(resposta.status, corpoDoErro), resposta.status);
  }
  return resposta.status === 204 ? (undefined as T) : resposta.json();
}

// `perfil` está no contrato (2.2), mas o backend só passa a devolver com os perfis (US24).
export type UsuarioLogado = { id: number; nome: string; email: string; perfil?: string };
export type SessaoAberta = { token: string; expira_em: string; usuario: UsuarioLogado };

export const getUsuarioLogado = () => pedir<UsuarioLogado>('/auth/me');

export const entrar = (email: string, senha: string) =>
  pedir<SessaoAberta>('/auth/login', 'POST', { email, senha });

/** Sai na hora, mesmo sem rede: sem o logout, o token vence sozinho no backend em 30 min. */
export function sair(porExpirar = false) {
  const tokenDaSessao = token;
  encerrarSessao(porExpirar);
  return pedir<void>('/auth/logout', 'POST', undefined, tokenDaSessao).catch(() => {});
}

/** Conta um clique ou tecla. Depois de 30 min parado, este mesmo gesto encerra a sessão. */
export function registrarUso(agora = Date.now()) {
  if (!token) return;
  const ultimo = Number(lerGuardado(CHAVE_ULTIMO_USO));
  if (ultimo && agora - ultimo > INATIVIDADE_MS) sair(true);
  else guardar(CHAVE_ULTIMO_USO, String(agora));
}

export const getHealth = () => pedir<{ status: string }>('/health');
export const getStatusDasSalas = () => pedir<StatusDaSala[]>('/salas/status');
export const getSala = (id: number) => pedir<SalaDetalhe>(`/salas/${id}`);
export const cadastrarSala = (corpo: CorpoDaSala) => pedir<SalaDetalhe>('/salas', 'POST', corpo);
export const editarSala = (id: number, corpo: CorpoDaSala) =>
  pedir<SalaDetalhe>(`/salas/${id}`, 'PATCH', corpo);

// Sensores e gateways (Contrato de API, 2.5 e 2.6). O ID do sensor vem do backend.
export type Sensor = SensorResumo & {
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
