import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mensagemDoErro } from './api.ts';
import {
  CALOR,
  corDaTemperatura,
  corpoDaSala,
  dominio,
  errosDaFaixa,
  FAIXA_VAZIA,
  ficariaFora,
  formatar,
  lerNumero,
  marcas,
  valorDaAlca,
} from './faixa.ts';

const faixa = { temperatura_min: 2, temperatura_max: 8, umidade_min: 40, umidade_max: 70 };

test('cadastro: corpo com nome sem espaços, descrição vazia vira null e a faixa inteira', () => {
  assert.deepEqual(corpoDaSala('  Câmara fria 2 ', '  ', { ...FAIXA_VAZIA, temperatura_max: 8 }), {
    nome: 'Câmara fria 2',
    descricao: null,
    faixa: { temperatura_min: null, temperatura_max: 8, umidade_min: null, umidade_max: null },
  });
});

test('edição: mudar só o máximo de temperatura mantém os outros três limites no PATCH', () => {
  const corpo = corpoDaSala('Câmara fria 1', 'Laticínios', { ...faixa, temperatura_max: 6 });
  assert.deepEqual(corpo.faixa, {
    temperatura_min: 2,
    temperatura_max: 6,
    umidade_min: 40,
    umidade_max: 70,
  });
  assert.equal(corpo.descricao, 'Laticínios');
});

test('faixa inválida tem a mesma mensagem do backend', () => {
  assert.deepEqual(errosDaFaixa(faixa), {});
  assert.deepEqual(errosDaFaixa({ ...faixa, temperatura_min: 8 }), {
    temperatura: 'temperatura_min deve ser menor que temperatura_max',
  });
  assert.deepEqual(errosDaFaixa({ ...faixa, umidade_min: 80 }), {
    umidade: 'umidade_min deve ser menor que umidade_max',
  });
  // Limite em branco não tem o que comparar.
  assert.deepEqual(errosDaFaixa({ ...FAIXA_VAZIA, temperatura_min: 50 }), {});
});

test('alça arrastada fica no passo e para um passo antes da outra', () => {
  assert.equal(valorDaAlca(faixa, 'temperatura', 'max', 6.26), 6.5);
  assert.equal(valorDaAlca(faixa, 'temperatura', 'max', 1), 2.5);
  assert.equal(valorDaAlca(faixa, 'temperatura', 'min', 9), 7.5);
  assert.equal(valorDaAlca(faixa, 'umidade', 'min', 75.4), 69);
  assert.equal(valorDaAlca(FAIXA_VAZIA, 'temperatura', 'min', -3.3), -3.5);
});

test('número digitado aceita vírgula e sinal de menos tipográfico', () => {
  assert.equal(lerNumero('2,5'), 2.5);
  assert.equal(lerNumero('−18'), -18);
  assert.equal(lerNumero(' '), null);
  assert.equal(lerNumero('sem máximo'), null);
});

test('escala do termômetro cobre limites e leitura, em números pares', () => {
  assert.deepEqual(dominio('temperatura', faixa, 4.2), [-4, 14]);
  assert.deepEqual(dominio('temperatura', FAIXA_VAZIA, null), [-30, 40]);
  assert.deepEqual(dominio('umidade', faixa, 58), [0, 100]);
  const m = marcas([-4, 14]);
  assert.equal(m[0].valor, -4);
  assert.ok(m.filter((x) => x.maior).every((x) => x.valor % 2 === 0));
});

test('aviso de que a leitura atual ficaria fora da faixa nova', () => {
  assert.equal(ficariaFora({ temperatura: 4.2, umidade: 58 }, faixa), false);
  assert.equal(
    ficariaFora({ temperatura: 4.2, umidade: 58 }, { ...faixa, temperatura_max: 4 }),
    true,
  );
  assert.equal(ficariaFora({ temperatura: 4.2, umidade: 58 }, { ...faixa, umidade_max: 50 }), true);
  assert.equal(ficariaFora({ temperatura: 99, umidade: 0 }, FAIXA_VAZIA), false);
});

test('escala de calor: frio azul, quente laranja, interpolada entre as paradas', () => {
  assert.equal(corDaTemperatura(-40, CALOR.escuro), '#cfe8ff');
  assert.equal(corDaTemperatura(0, CALOR.escuro), '#6fb6ff');
  assert.equal(corDaTemperatura(30, CALOR.escuro), '#ffa45c');
  assert.equal(corDaTemperatura(99, CALOR.escuro), '#ff6f5a');
  assert.match(corDaTemperatura(6, CALOR.escuro), /^#[0-9a-f]{6}$/);
});

test('erro 422 da API vira a mensagem do validador, sem o prefixo do Pydantic', () => {
  const corpo = {
    detail: [{ msg: 'Value error, temperatura_min deve ser menor que temperatura_max' }],
  };
  assert.equal(mensagemDoErro(422, corpo), 'temperatura_min deve ser menor que temperatura_max');
  assert.equal(mensagemDoErro(404, { detail: 'sala não encontrada' }), 'sala não encontrada');
  assert.equal(mensagemDoErro(500, null), 'Erro 500');
});

test('valor do editor com casas fixas, inclusive zero casas (umidade)', () => {
  assert.equal(formatar(58, 0), '58');
  assert.equal(formatar(57.6, 0), '58');
  assert.equal(formatar(2, 1), '2,0');
  assert.equal(formatar(-18.26, 1), '−18,3');
  assert.equal(formatar(-0.01, 1), '0,0');
});
