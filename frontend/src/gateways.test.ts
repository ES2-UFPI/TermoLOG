import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Gateway } from './api.ts';
import { cadastrarGateway, ErroDaApi } from './api.ts';
import { erroDoNome, ordenarGateways, resumoDosGateways, ultimoContato } from './gateways.ts';

const gateway = (id: number, nome: string, online: boolean): Gateway => ({
  id,
  nome,
  online,
  ultimo_contato: null,
});

test('lista: online primeiro e depois pelo nome', () => {
  const lista = ordenarGateways([
    gateway(1, 'Bloco B', false),
    gateway(2, 'Bloco C', true),
    gateway(3, 'Bloco A', false),
  ]);
  assert.deepEqual(
    lista.map((g) => g.nome),
    ['Bloco C', 'Bloco A', 'Bloco B'],
  );
});

test('cadastro: nome vazio ou longo demais é barrado como no backend', () => {
  assert.equal(erroDoNome('   '), 'Dê um nome para o gateway.');
  assert.equal(erroDoNome('x'.repeat(101)), 'O nome pode ter no máximo 100 caracteres.');
  assert.equal(erroDoNome('  Gateway Bloco C  '), null);
});

// fetch falso: guarda o pedido e devolve a resposta dada.
function simularFetch(status: number, corpo: unknown) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(corpo), { status });
  };
  return pedidos;
}

test('cadastro: POST /gateways com o nome e a chave na resposta', async () => {
  const pedidos = simularFetch(201, { id: 7, nome: 'Bloco C', chave_api: 'abc' });
  assert.deepEqual(await cadastrarGateway('Bloco C'), { id: 7, nome: 'Bloco C', chave_api: 'abc' });
  assert.match(pedidos[0].url, /\/gateways$/);
  assert.equal(pedidos[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(pedidos[0].init.body)), { nome: 'Bloco C' });
});

test('cadastro: o 422 vira ErroDaApi com a mensagem do validador', async () => {
  simularFetch(422, { detail: [{ msg: 'String should have at least 1 character' }] });
  await assert.rejects(cadastrarGateway(''), (e) => {
    assert.ok(e instanceof ErroDaApi);
    assert.equal(e.message, 'String should have at least 1 character');
    return true;
  });
});

test('cadastro: falha de rede não é ErroDaApi', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(cadastrarGateway('Bloco C'), (e) => !(e instanceof ErroDaApi));
});

test('último contato em texto curto', () => {
  const agora = new Date('2026-11-05T15:00:00-03:00');
  assert.equal(ultimoContato('2026-11-05T14:59:40-03:00', agora), 'agora há pouco');
  assert.equal(ultimoContato('2026-11-05T14:48:00-03:00', agora), 'há 12 min');
  assert.equal(ultimoContato('2026-11-05T12:00:00-03:00', agora), 'há 3 h');
  assert.match(ultimoContato('2026-11-05T07:05:00-03:00', agora), /^hoje às \d{2}:\d{2}$/);
  assert.match(ultimoContato('2026-11-04T14:05:00-03:00', agora), /^ontem às \d{2}:\d{2}$/);
  assert.match(ultimoContato('2026-10-27T14:05:00-03:00', agora), /^\d{2}\/\d{2} às \d{2}:\d{2}$/);
});

test('resumo da lista', () => {
  assert.equal(resumoDosGateways([]), 'nenhum gateway');
  assert.equal(resumoDosGateways([gateway(1, 'A', true)]), '1 online');
  assert.equal(
    resumoDosGateways([gateway(1, 'A', true), gateway(2, 'B', false), gateway(3, 'C', false)]),
    '1 online · 2 offline',
  );
});
