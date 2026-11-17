import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Gateway, Sensor } from './api.ts';
import { mensagemDoErro } from './api.ts';
import {
  comSensor,
  dataDoCadastro,
  gatewayPadrao,
  nomeDoGateway,
  ordenarSensores,
  resumoDosSensores,
} from './sensores.ts';

const sensor = (id: number, ativo = true): Sensor => ({
  id,
  gateway_id: 1,
  ativo,
  data_cadastro: '2026-10-27T12:00:00Z',
  sala_id: 1,
  sala_nome: 'Laboratório de Redes',
});
const gateway = (id: number, online: boolean): Gateway => ({
  id,
  nome: `Gateway ${id}`,
  online,
  ultimo_contato: null,
});

test('lista: ativos primeiro e, em cada grupo, o mais novo em cima', () => {
  const ids = ordenarSensores([sensor(1), sensor(2, false), sensor(3)]).map((s) => s.id);
  assert.deepEqual(ids, [3, 1, 2]);
});

test('adicionar: o sensor novo entra na lista com o ID que a API deu', () => {
  const lista = comSensor([sensor(1)], sensor(7));
  assert.deepEqual(
    lista.map((s) => s.id),
    [7, 1],
  );
});

test('desativar: o sensor devolvido pela API troca o antigo e vai para o fim como inativo', () => {
  const lista = comSensor([sensor(3), sensor(1)], sensor(3, false));
  assert.deepEqual(
    lista.map((s) => [s.id, s.ativo]),
    [
      [1, true],
      [3, false],
    ],
  );
  assert.equal(lista.length, 2);
});

test('gateway já escolhido: o online, senão o primeiro; sem gateways, nenhum', () => {
  assert.equal(gatewayPadrao([gateway(1, false), gateway(2, true)]), 2);
  assert.equal(gatewayPadrao([gateway(1, false), gateway(2, false)]), 1);
  assert.equal(gatewayPadrao([]), null);
  assert.equal(nomeDoGateway([gateway(1, false)], 1), 'Gateway 1');
  assert.equal(nomeDoGateway([], 9), 'Gateway 9');
});

test('resumo da lista e data do cadastro', () => {
  assert.equal(resumoDosSensores([]), 'nenhum sensor');
  assert.equal(resumoDosSensores([sensor(1)]), '1 ativo');
  assert.equal(resumoDosSensores([sensor(1), sensor(2), sensor(3, false)]), '2 ativos · 1 inativo');
  assert.equal(dataDoCadastro('2026-10-27T12:00:00Z'), '27/10/2026');
});

test('sala ou gateway que não existe mais: a mensagem do 404 da API', () => {
  assert.equal(mensagemDoErro(404, { detail: 'gateway não encontrado' }), 'gateway não encontrado');
  assert.equal(mensagemDoErro(404, { detail: 'sala não encontrada' }), 'sala não encontrada');
});
