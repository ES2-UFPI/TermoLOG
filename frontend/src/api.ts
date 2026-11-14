import { type Formato, nomeDoArquivo } from './relatorios.ts';

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

// GET /salas/indicadores. `salas_dentro_da_faixa` é o % das salas com leitura que estão ok
// agora; null quando nenhuma sala tem leitura.
export type Indicadores = {
  salas_dentro_da_faixa: number | null;
  salas_ok: number;
  salas_fora_da_faixa: number;
  salas_sem_leitura: number;
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
  /** Sensor com o emissor infravermelho do ar-condicionado (#160); null sem climatização. */
  sensor_climatizacao_id?: number | null;
};

export type CorpoDaSala = {
  nome: string;
  descricao: string | null;
  faixa: Faixa;
  /** Só na edição (#162): ausente, o PATCH não mexe no sensor de climatização. */
  sensor_climatizacao_id?: number | null;
};

export const MENSAGEM_SEM_PERMISSAO =
  'Permissão insuficiente. Peça a um administrador para fazer esta ação.';

/**
 * Texto do erro da API para mostrar na tela. No 422 o FastAPI manda `detail` como lista
 * (validação) ou texto; a mensagem do validador vem com o prefixo "Value error, ".
 */
export function mensagemDoErro(status: number, corpo: unknown) {
  // 403 só vem das rotas de administrador (Contrato, 2.1): mensagem clara em vez de erro genérico.
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
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
  /** Corpo do erro como a API mandou, para a tela achar o campo de um 422. */
  corpo: unknown;
  constructor(mensagem: string, status: number, corpo?: unknown) {
    super(mensagem);
    this.status = status;
    this.corpo = corpo;
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

async function chamar(
  caminho: string,
  metodo: string,
  corpo: unknown,
  tokenDoPedido: string | null,
  tempoLimite = TEMPO_LIMITE_MS,
) {
  const cabecalhos: Record<string, string> = {};
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (tokenDoPedido) cabecalhos.Authorization = `Bearer ${tokenDoPedido}`;
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(tempoLimite),
  }).catch((erro: Error) => {
    throw erro.name === 'TimeoutError' ? new Error('a API não respondeu a tempo') : erro;
  });
  // Só derruba a sessão que fez o pedido: um 401 atrasado não encerra um login mais novo,
  // e o 401 do próprio login (sem token) é só credencial errada.
  if (resposta.status === 401 && tokenDoPedido && tokenDoPedido === token) encerrarSessao(true);
  if (!resposta.ok) {
    const corpoDoErro = await resposta.json().catch(() => null);
    throw new ErroDaApi(mensagemDoErro(resposta.status, corpoDoErro), resposta.status, corpoDoErro);
  }
  return resposta;
}

async function pedir<T>(
  caminho: string,
  metodo = 'GET',
  corpo?: unknown,
  tokenDoPedido = token,
): Promise<T> {
  const resposta = await chamar(caminho, metodo, corpo, tokenDoPedido);
  return resposta.status === 204 ? (undefined as T) : resposta.json();
}

// `perfil` vem de /auth/me e do login (Contrato, 2.2); fica opcional para tolerar resposta antiga.
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

// Gerar o arquivo pode demorar mais que uma consulta do painel.
const TEMPO_LIMITE_DO_ARQUIVO_MS = 60_000;

/** GET /relatorios/leituras (Contrato, 2.8), com o token no cabeçalho: um link não serve. */
export async function baixarRelatorioDeLeituras(query: string, formato: Formato) {
  const resposta = await chamar(
    `/relatorios/leituras?${query}`,
    'GET',
    undefined,
    token,
    TEMPO_LIMITE_DO_ARQUIVO_MS,
  );
  const nome = nomeDoArquivo(resposta.headers.get('Content-Disposition'), formato);
  return { arquivo: await resposta.blob(), nome };
}

// Canais de notificação do usuário logado (Contrato de API, 2.2). O PUT troca a lista inteira.
export type InscricaoPush = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Canal =
  | { tipo: 'email' | 'telegram'; destino: string; ativo: boolean }
  | { tipo: 'push'; destino: InscricaoPush; ativo: boolean };
export const getCanais = () => pedir<Canal[]>('/auth/me/canais');
export const salvarCanais = (canais: Canal[]) => pedir<Canal[]>('/auth/me/canais', 'PUT', canais);

/** POST /auth/me/canais/telegram/vinculo: link de uso único que liga o chat do Telegram. */
export type VinculoTelegram = { codigo: string; link: string; expira_em: string };
export const vincularTelegram = () =>
  pedir<VinculoTelegram>('/auth/me/canais/telegram/vinculo', 'POST');

export const getHealth = () => pedir<{ status: string }>('/health');
export const getStatusDasSalas = () => pedir<StatusDaSala[]>('/salas/status');
export type SalaResumo = Pick<SalaDetalhe, 'id' | 'nome' | 'descricao' | 'faixa'>;
export const getSalas = () => pedir<SalaResumo[]>('/salas');
export const getIndicadores = () => pedir<Indicadores>('/salas/indicadores');
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

// Série histórica da sala para o gráfico (Contrato de API, 2.4, #104).
export type PeriodoDoHistorico = 'dia' | 'semana' | 'mes';
export type EstatisticaDoHistorico = { media: number; min: number; max: number };
/** Um intervalo com leitura. Intervalo sem leitura não vem: o gráfico deixa o vão. */
export type PontoDoHistorico = {
  inicio: string;
  quantidade: number;
  temperatura: EstatisticaDoHistorico;
  umidade: EstatisticaDoHistorico;
};
export type HistoricoDaSala = {
  sala_id: number;
  nome: string;
  periodo: PeriodoDoHistorico;
  intervalo_s: number;
  inicio: string;
  fim: string;
  faixa: Faixa;
  pontos: PontoDoHistorico[];
};
export const getHistoricoDaSala = (salaId: number, periodo: PeriodoDoHistorico, fim?: string) =>
  pedir<HistoricoDaSala>(
    `/salas/${salaId}/historico?${new URLSearchParams({ periodo, ...(fim ? { fim } : {}) })}`,
  );

// Alertas (Contrato de API, 2.7). `leitura` é a leitura que abriu o alerta.
export type SituacaoDoAlerta = 'pendente' | 'reconhecido' | 'encerrado';
export type TipoDoDesvio =
  | 'temperatura_abaixo'
  | 'temperatura_acima'
  | 'umidade_abaixo'
  | 'umidade_acima';
export type Alerta = {
  id: number;
  sala_id: number;
  sala_nome: string;
  sensor_id: number;
  tipo: TipoDoDesvio;
  situacao: SituacaoDoAlerta;
  data_hora: string;
  leitura: { temperatura: number; umidade: number; data_hora: string };
  reconhecido_por: { id: number; nome: string } | null;
  reconhecido_em: string | null;
  acao_corretiva: string | null;
  encerrado_em: string | null;
};
export const getAlertas = (situacao: SituacaoDoAlerta, salaId: number | null) =>
  pedir<Alerta[]>(
    `/alertas?${new URLSearchParams({ situacao, ...(salaId ? { sala_id: String(salaId) } : {}) })}`,
  );
export const reconhecerAlerta = (id: number) => pedir<Alerta>(`/alertas/${id}/reconhecer`, 'POST');
export const encerrarAlerta = (id: number, acaoCorretiva: string) =>
  pedir<Alerta>(`/alertas/${id}/encerrar`, 'POST', { acao_corretiva: acaoCorretiva });

// Comandos do ar-condicionado da sala (#160). O POST é só do administrador e responde 202:
// o comando fica pendente até o gateway entregá-lo ao nó no próximo ciclo de leitura.
export type AcaoDeClimatizacao = 'ligar' | 'desligar' | 'ajustar';
export type ComandoDeClimatizacao = {
  id: number;
  sala_id: number;
  sensor_id: number;
  acao: AcaoDeClimatizacao;
  temperatura_c: number | null;
  usuario: { id: number; nome: string };
  criado_em: string;
  expira_em: string;
  situacao: 'pendente' | 'entregue' | 'expirado';
};
export const getComandosDeClimatizacao = (salaId: number) =>
  pedir<ComandoDeClimatizacao[]>(`/salas/${salaId}/climatizacao`);
/** `temperatura_c` só vai no ajuste: a API recusa a temperatura em ligar e desligar. */
export const enviarComandoDeClimatizacao = (
  salaId: number,
  acao: AcaoDeClimatizacao,
  temperatura_c?: number,
) =>
  pedir<ComandoDeClimatizacao>(
    `/salas/${salaId}/climatizacao`,
    'POST',
    acao === 'ajustar' ? { acao, temperatura_c } : { acao },
  );
