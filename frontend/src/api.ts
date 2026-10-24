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

async function get<T>(caminho: string): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  }).catch((erro: Error) => {
    throw erro.name === 'TimeoutError' ? new Error('a API não respondeu a tempo') : erro;
  });
  if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
  return resposta.json();
}

export const getHealth = () => get<{ status: string }>('/health');
export const getStatusDasSalas = () => get<StatusDaSala[]>('/salas/status');
