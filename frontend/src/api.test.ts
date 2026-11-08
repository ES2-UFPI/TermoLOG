import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// localStorage de mentira antes de importar: o módulo lê o token guardado ao carregar.
const guardado = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (c: string) => guardado.get(c) ?? null,
    setItem: (c: string, v: string) => guardado.set(c, v),
    removeItem: (c: string) => guardado.delete(c),
  },
});

const {
  abrirSessao,
  assinarSessao,
  entrar,
  ErroDaApi,
  getStatusDasSalas,
  INATIVIDADE_MS,
  registrarUso,
  sair,
  sessaoExpirou,
  tokenAtual,
} = await import('./api.ts');

type Chamada = { url: string; metodo?: string; autorizacao?: string };
let chamadas: Chamada[] = [];
let responder: () => Promise<Response>;

const json = (status: number, corpo: unknown) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status }));

globalThis.fetch = ((url: string, opcoes: RequestInit) => {
  const cabecalhos = opcoes.headers as Record<string, string>;
  chamadas.push({ url, metodo: opcoes.method, autorizacao: cabecalhos.Authorization });
  return responder();
}) as typeof fetch;

beforeEach(async () => {
  responder = () => json(200, []);
  await sair();
  chamadas = [];
});

test('sem sessão, o pedido vai sem cabeçalho de autorização', async () => {
  await getStatusDasSalas();
  assert.equal(chamadas[0].autorizacao, undefined);
});

test('com sessão, todo pedido leva o Bearer e o token sobrevive no armazenamento', async () => {
  abrirSessao('abc');
  await getStatusDasSalas();
  assert.equal(chamadas[0].autorizacao, 'Bearer abc');
  assert.equal(guardado.get('termolog-token'), 'abc');
});

test('401 limpa o token, avisa quem assina e marca a sessão como expirada', async () => {
  abrirSessao('abc');
  let avisos = 0;
  const parar = assinarSessao(() => avisos++);
  responder = () => json(401, { detail: 'não autenticado' });
  await assert.rejects(getStatusDasSalas(), ErroDaApi);
  parar();
  assert.equal(tokenAtual(), null);
  assert.equal(guardado.has('termolog-token'), false);
  assert.equal(avisos, 1);
  assert.equal(sessaoExpirou(), true);
});

test('outros erros não encerram a sessão', async () => {
  abrirSessao('abc');
  responder = () => json(500, { detail: 'erro' });
  await assert.rejects(getStatusDasSalas(), ErroDaApi);
  assert.equal(tokenAtual(), 'abc');
});

test('401 atrasado de uma sessão antiga não derruba o login novo', async () => {
  abrirSessao('antigo');
  let soltar = (_: Response) => {};
  responder = () =>
    new Promise((resolver) => {
      soltar = resolver;
    });
  const pedido = getStatusDasSalas();
  abrirSessao('novo');
  soltar(new Response('{}', { status: 401 }));
  await assert.rejects(pedido, ErroDaApi);
  assert.equal(tokenAtual(), 'novo');
});

test('senha errada: mensagem da API, sem token e sem aviso de sessão expirada', async () => {
  responder = () => json(401, { detail: 'e-mail ou senha inválidos' });
  await assert.rejects(entrar('a@b.com', 'x'), /e-mail ou senha inválidos/);
  assert.equal(tokenAtual(), null);
  assert.equal(sessaoExpirou(), false);
});

test('login devolve a sessão, mas só abrirSessao guarda o token', async () => {
  responder = () => json(200, { token: 't', expira_em: 'x', usuario: { id: 1 } });
  const sessao = await entrar('a@b.com', 'x');
  assert.equal(sessao.token, 't');
  assert.equal(tokenAtual(), null);
});

test('sair chama o logout com o token (204 sem corpo) e limpa a sessão', async () => {
  abrirSessao('abc');
  responder = () => Promise.resolve(new Response(null, { status: 204 }));
  await sair();
  assert.deepEqual(chamadas[0], {
    url: 'http://localhost:8000/auth/logout',
    metodo: 'POST',
    autorizacao: 'Bearer abc',
  });
  assert.equal(tokenAtual(), null);
  assert.equal(sessaoExpirou(), false);
});

test('sair sem rede ainda encerra a sessão', async () => {
  abrirSessao('abc');
  responder = () => Promise.reject(new Error('sem rede'));
  await sair();
  assert.equal(tokenAtual(), null);
});

test('clique dentro de 30 min mantém a sessão e renova o relógio', () => {
  abrirSessao('abc', 1000);
  registrarUso(1000 + INATIVIDADE_MS);
  assert.equal(tokenAtual(), 'abc');
  registrarUso(1000 + INATIVIDADE_MS * 2);
  assert.equal(tokenAtual(), 'abc');
});

test('primeiro clique depois de 30 min parado encerra a sessão e invalida o token', () => {
  responder = () => Promise.resolve(new Response(null, { status: 204 }));
  abrirSessao('abc', 1000);
  registrarUso(1000 + INATIVIDADE_MS + 1);
  assert.equal(tokenAtual(), null);
  assert.equal(sessaoExpirou(), true);
  assert.equal(chamadas[0].url, 'http://localhost:8000/auth/logout');
  assert.equal(chamadas[0].autorizacao, 'Bearer abc');
});

test('busca automática não conta como uso: só registrarUso renova', async () => {
  abrirSessao('abc', 1000);
  await getStatusDasSalas();
  assert.equal(guardado.get('termolog-ultimo-uso'), '1000');
});
