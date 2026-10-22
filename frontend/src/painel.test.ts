import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StatusDaSala } from './api.ts';
import {
  faixaCurta,
  figura,
  folga,
  folgasDeTemperatura,
  leituraPrincipal,
  numero,
  ordenar,
  quando,
  textoDaFolga,
} from './painel.ts';

const leitura = (sensor_id: number, temperatura: number, umidade = 50) => ({
  sensor_id,
  temperatura,
  umidade,
  data_hora: '2026-10-21T17:30:00Z',
});

const sala = (parcial: Partial<StatusDaSala>): StatusDaSala => ({
  sala_id: 1,
  nome: 'Sala',
  faixa: { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null },
  intervalo_leitura_s: null,
  status: 'ok',
  leituras: [],
  ...parcial,
});

test('folga é a distância até o limite mais próximo e fica negativa fora da faixa', () => {
  const faixa = sala({}).faixa;
  assert.deepEqual(folga(leitura(1, 7), faixa), {
    grandeza: 'temperatura',
    valor: 1,
    limite: 'máximo',
  });
  assert.equal(folga(leitura(1, 9.5), faixa)?.valor, -1.5);
  assert.equal(folga(leitura(1, 8), faixa)?.valor, 0); // no limite conta como dentro
});

test('umidade fora da faixa tem prioridade sobre temperatura dentro', () => {
  const faixa = { temperatura_min: 2, temperatura_max: 8, umidade_min: 30, umidade_max: 60 };
  assert.equal(folga(leitura(1, 5, 75), faixa)?.grandeza, 'umidade');
});

test('limite de um lado só e sala sem faixa', () => {
  const soMaximo = {
    temperatura_min: null,
    temperatura_max: -15,
    umidade_min: null,
    umidade_max: null,
  };
  assert.equal(folga(leitura(1, -19.2), soMaximo)?.limite, 'máximo');
  const semFaixa = {
    temperatura_min: null,
    temperatura_max: null,
    umidade_min: null,
    umidade_max: null,
  };
  assert.equal(folga(leitura(1, 26), semFaixa), null);
});

test('o card destaca o sensor de menor folga', () => {
  const s = sala({ leituras: [leitura(13, 5), leitura(12, 9.1)] });
  assert.equal(leituraPrincipal(s)?.sensor_id, 12);
});

test('salas fora da faixa vêm primeiro e as sem leitura antes das ok', () => {
  const salas = [
    sala({ nome: 'a' }),
    sala({ nome: 'b', status: 'sem_leitura' }),
    sala({ nome: 'c', status: 'fora_da_faixa' }),
  ];
  assert.deepEqual(
    ordenar(salas).map((s) => s.nome),
    ['c', 'b', 'a'],
  );
});

test('gráfico usa a menor folga de temperatura e ignora salas sem limite ou sem leitura', () => {
  const salas = [
    sala({ nome: 'fora', leituras: [leitura(1, 5), leitura(2, 9.1)] }),
    sala({ nome: 'vazia' }),
    sala({
      nome: 'sem faixa',
      faixa: { temperatura_min: null, temperatura_max: null, umidade_min: null, umidade_max: null },
      leituras: [leitura(3, 20)],
    }),
  ];
  const pontos = folgasDeTemperatura(salas);
  assert.deepEqual(
    pontos.map((p) => p.sala.nome),
    ['fora'],
  );
  assert.ok(Math.abs(pontos[0].folga - -1.1) < 1e-9);
});

test('figura e texto da folga seguem o estado', () => {
  assert.equal(figura(sala({})), 'sem-sinal');
  assert.equal(figura(sala({ leituras: [leitura(1, 9.1)] })), 'quente');
  assert.equal(figura(sala({ leituras: [leitura(1, 1)] })), 'frio');
  assert.equal(
    figura(sala({ nome: 'Sala de servidores A', leituras: [leitura(1, 5)] })),
    'servidor',
  );
  assert.equal(figura(sala({ nome: 'Câmara fria 2', leituras: [leitura(1, 9.1)] })), 'quente');
  assert.deepEqual(textoDaFolga({ grandeza: 'temperatura', valor: -1.1, limite: 'máximo' }), {
    valor: '+1,1 °C',
    legenda: 'acima do máximo',
  });
});

test('faixa em uma linha: temperatura, só umidade ou sem faixa', () => {
  const nulo = {
    temperatura_min: null,
    temperatura_max: null,
    umidade_min: null,
    umidade_max: null,
  };
  assert.equal(faixaCurta({ ...nulo, temperatura_min: 18, temperatura_max: 27 }), '18 a 27 °C');
  assert.equal(faixaCurta({ ...nulo, temperatura_max: -15 }), 'até −15 °C');
  assert.equal(faixaCurta({ ...nulo, umidade_min: 30, umidade_max: 60 }), 'umidade 30 a 60%');
  assert.equal(faixaCurta(nulo), 'sem faixa');
});

test('não compara °C com %: temperatura fora vence umidade fora, e dentro vale a temperatura', () => {
  const faixa = { temperatura_min: 2, temperatura_max: 8, umidade_min: 30, umidade_max: 60 };
  // 0,5 °C acima e 20% acima: as duas estão fora, a temperatura é a que aparece
  assert.equal(folga(leitura(1, 8.5, 80), faixa)?.grandeza, 'temperatura');
  // dentro nas duas: vale a temperatura, mesmo com folga em % menor
  assert.equal(folga(leitura(1, 5, 59), faixa)?.grandeza, 'temperatura');
  // a leitura destacada é a que está fora, não a de menor número
  const s = sala({ faixa, leituras: [leitura(1, 2.5, 45), leitura(2, 5, 61)] });
  assert.equal(leituraPrincipal(s)?.sensor_id, 2);
});

test('desvio pequeno não vira "+0,0" e não existe "-0,0"', () => {
  assert.equal(
    textoDaFolga({ grandeza: 'temperatura', valor: -0.04, limite: 'máximo' }).valor,
    '+0,04 °C',
  );
  assert.equal(numero(-0.01), '0,0');
  assert.equal(numero(-19.2), '−19,2');
});

test('leitura de outro dia mostra a data junto com a hora', () => {
  const agora = new Date('2026-10-22T15:00:00');
  assert.equal(quando(new Date('2026-10-22T14:30:00'), agora), '14:30');
  assert.equal(quando(new Date('2026-10-20T09:05:00'), agora), '20/10 09:05');
});

test('ícone pelo nome usa palavra inteira e sala fora pela umidade ganha a gota', () => {
  const comLeitura = { leituras: [leitura(1, 5)] }; // dentro da faixa padrão (2 a 8 °C)
  assert.equal(figura(sala({ nome: 'Sala de Grupos', ...comLeitura })), 'normal');
  assert.equal(figura(sala({ nome: 'Sala de UPS', ...comLeitura })), 'energia');
  const faixa = { temperatura_min: null, temperatura_max: null, umidade_min: 30, umidade_max: 50 };
  assert.equal(figura(sala({ faixa, leituras: [leitura(1, 21, 58)] })), 'umidade');
});
