import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Faixa, SensorResumo } from './api.ts';
import {
  avaliarLeitura,
  colunasDaGrade,
  fatosDaSala,
  niveisDosRotulos,
  opcoesDeClimatizacao,
  podeAdministrar,
  sensoresDaSala,
  textoDoIntervalo,
} from './sala.ts';

const faixa: Faixa = { temperatura_min: 2, temperatura_max: 8, umidade_min: 30, umidade_max: 60 };
const semFaixa: Faixa = {
  temperatura_min: null,
  temperatura_max: null,
  umidade_min: null,
  umidade_max: null,
};
const leitura = (sensor_id: number, temperatura = 5, umidade = 50) => ({
  sensor_id,
  temperatura,
  umidade,
  data_hora: '2026-10-21T17:30:00Z',
});
const sensor = (id: number, ativo = true): SensorResumo => ({
  id,
  gateway_id: 1,
  ativo,
  data_cadastro: '2026-10-01T12:00:00Z',
});
const usuario = (perfil?: string) => ({ id: 1, nome: 'Ana', email: 'a@b.c', perfil });

test('só o visualizador perde as ações; sem saber quem é, também não aparecem', () => {
  assert.equal(podeAdministrar(usuario('administrador')), true);
  assert.equal(podeAdministrar(usuario()), true); // backend antes da US24
  assert.equal(podeAdministrar(usuario('visualizador')), false);
  assert.equal(podeAdministrar(null), false);
});

test('cada sensor recebe a própria leitura, em ordem de ID, e inativo fica sem leitura', () => {
  const { ativos, inativos } = sensoresDaSala(
    [sensor(13), sensor(12), sensor(9, false)],
    [leitura(13), leitura(9)],
  );
  assert.deepEqual(
    ativos.map((s) => [s.sensor.id, s.leitura?.sensor_id ?? null]),
    [
      [12, null],
      [13, 13],
    ],
  );
  assert.deepEqual(
    inativos.map((s) => [s.sensor.id, s.leitura]),
    [[9, null]],
  );
});

test('leitura dentro, no limite e fora da faixa', () => {
  assert.equal(avaliarLeitura(leitura(1, 5), faixa).titulo, 'Dentro da faixa');
  assert.equal(avaliarLeitura(leitura(1, 8), faixa).tom, 'ok'); // no limite ainda está dentro
  const fora = avaliarLeitura(leitura(1, 9.1), faixa);
  assert.equal(fora.titulo, 'Fora da faixa');
  assert.equal(fora.detalhe, '+1,1 °C acima do máximo');
  assert.equal(fora.temperaturaFora, true);
  assert.equal(fora.umidadeFora, false);
});

test('só a umidade fora marca a leitura como fora e aponta a umidade', () => {
  const r = avaliarLeitura(leitura(1, 5, 70), faixa);
  assert.equal(r.tom, 'alerta');
  assert.equal(r.temperaturaFora, false);
  assert.equal(r.umidadeFora, true);
  assert.equal(r.detalhe, '+10,0% acima do máximo');
});

test('sala sem faixa não aparece como conforme', () => {
  const r = avaliarLeitura(leitura(1), semFaixa);
  assert.equal(r.tom, 'neutro');
  assert.equal(r.titulo, 'Sem faixa definida');
});

test('intervalo de leitura: sem valor até a US03, minutos quando dá conta exata', () => {
  assert.equal(textoDoIntervalo(null), 'Não definido');
  assert.equal(textoDoIntervalo(undefined), 'Não definido');
  assert.equal(textoDoIntervalo(45), '45 s');
  assert.equal(textoDoIntervalo(90), '90 s');
  assert.equal(textoDoIntervalo(300), '5 min');
});

test('os fatos da sala dizem quando não há limite nem leitura em 24 h', () => {
  assert.deepEqual(
    fatosDaSala(semFaixa, null, null).map((f) => f.valor),
    ['Sem limite', 'Sem limite', 'Não definido', 'Sem leituras'],
  );
  assert.deepEqual(
    fatosDaSala(faixa, 60, 87.5).map((f) => f.valor),
    ['2 a 8 °C', '30 a 60%', '1 min', '87,5%'],
  );
});

test('rótulos próximos sobem de nível e os distantes dividem o mesmo', () => {
  assert.deepEqual(niveisDosRotulos([10, 200, 400], 64), [0, 0, 0]);
  assert.deepEqual(niveisDosRotulos([100, 110, 120], 64), [0, 1, 2]);
  // A ordem de entrada não muda o resultado de quem vem primeiro na régua.
  assert.deepEqual(niveisDosRotulos([300, 100, 120], 64), [0, 0, 1]);
  assert.deepEqual(niveisDosRotulos([], 64), []);
});

test('a grade não deixa um sensor sozinho na última linha', () => {
  assert.equal(colunasDaGrade(1, 1400), 1);
  assert.equal(colunasDaGrade(2, 1400), 2);
  assert.equal(colunasDaGrade(4, 1400), 4);
  assert.equal(colunasDaGrade(5, 1400), 3); // 3 + 2, e não 4 + 1
  assert.equal(colunasDaGrade(4, 800), 2); // 2 + 2, e não 3 + 1
  assert.equal(colunasDaGrade(3, 390), 1);
  assert.equal(colunasDaGrade(0, 1400), 1);
});

test('sensor de climatização: nenhum ou um sensor ativo, e o atual mesmo se inativo', () => {
  const sensores = [
    { id: 18, gateway_id: 1, ativo: true, data_cadastro: '2026-10-01T12:00:00Z' },
    { id: 9, gateway_id: 1, ativo: false, data_cadastro: '2026-10-01T12:00:00Z' },
    { id: 17, gateway_id: 1, ativo: true, data_cadastro: '2026-10-01T12:00:00Z' },
  ];
  assert.deepEqual(opcoesDeClimatizacao(sensores, null), [
    { id: null, rotulo: 'Nenhum' },
    { id: 17, rotulo: 'Sensor 17' },
    { id: 18, rotulo: 'Sensor 18' },
  ]);
  assert.deepEqual(
    opcoesDeClimatizacao(sensores, 9).map((o) => o.rotulo),
    ['Nenhum', 'Sensor 9 (inativo)', 'Sensor 17', 'Sensor 18'],
  );
});
