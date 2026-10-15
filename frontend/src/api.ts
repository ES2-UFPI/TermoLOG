const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export async function getHealth() {
  const resposta = await fetch(`${API_URL}/health`);
  if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
  return resposta.json();
}
