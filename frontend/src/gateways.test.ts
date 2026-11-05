import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Gateway } from './api.ts';
import { mensagemDoErro } from './api.ts';
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

test('cadastro: o 422 da API vira a mensagem do validador', () => {
  const corpo = { detail: [{ msg: 'String should have at least 1 character' }] };
  assert.equal(mensagemDoErro(422, corpo), 'String should have at least 1 character');
});

test('último contato em texto curto', () => {
  const agora = new Date('2026-11-05T15:00:00-03:00');
  assert.equal(ultimoContato(null, agora), 'nunca se conectou');
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
