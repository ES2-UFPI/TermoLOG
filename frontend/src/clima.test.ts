import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComandoDeClimatizacao } from './api.ts';
import {
  ajustePendente,
  anguloDa,
  estadoDoEquipamento,
  limitarTemperatura,
  linhaDoComando,
  mensagemDoEnvio,
  temPendente,
  temperaturaDoPonto,
  textoDoEstado,
} from './clima.ts';

let proximo = 1;
const comando = (
  acao: ComandoDeClimatizacao['acao'],
  situacao: ComandoDeClimatizacao['situacao'],
  criado_em: string,
  temperatura_c: number | null = null,
  sensor_id = 17,
): ComandoDeClimatizacao => ({
  id: proximo++,
  sala_id: 1,
  sensor_id,
  acao,
  temperatura_c,
  usuario: { id: 1, nome: 'Ana Lima' },
  criado_em,
  expira_em: criado_em,
  situacao,
});

test('a temperatura fica entre 16 e 30 °C, em graus inteiros', () => {
  assert.equal(limitarTemperatura(12), 16);
  assert.equal(limitarTemperatura(31), 30);
  assert.equal(limitarTemperatura(22.4), 22);
  assert.equal(limitarTemperatura(22.6), 23);
});

test('o estado é o do último comando entregue, não o do pendente', () => {
  const comandos = [
    comando('desligar', 'pendente', '2026-11-13T12:00:00Z'),
    comando('ajustar', 'entregue', '2026-11-13T11:20:00Z', 22),
    comando('ligar', 'entregue', '2026-11-13T10:58:00Z'),
  ];
  assert.deepEqual(estadoDoEquipamento(comandos, 17), { ligado: true, meta: 22 });
});

test('desligar entregue desliga e guarda a última meta; expirado não conta', () => {
  const comandos = [
    comando('ligar', 'expirado', '2026-11-13T12:00:00Z'),
    comando('desligar', 'entregue', '2026-11-12T22:40:00Z'),
    comando('ajustar', 'entregue', '2026-11-12T18:12:00Z', 24),
  ];
  assert.deepEqual(estadoDoEquipamento(comandos, 17), { ligado: false, meta: 24 });
});

test('a ordem da lista não importa: vale a data de criação', () => {
  const comandos = [
    comando('ligar', 'entregue', '2026-11-12T10:00:00Z'),
    comando('desligar', 'entregue', '2026-11-13T10:00:00Z'),
  ];
  assert.equal(estadoDoEquipamento(comandos, 17).ligado, false);
});

test('sem comando entregue o estado é desconhecido', () => {
  const estado = estadoDoEquipamento([comando('ligar', 'pendente', '2026-11-13T12:00:00Z')], 17);
  assert.deepEqual(estado, { ligado: null, meta: null });
  assert.equal(textoDoEstado(estado), 'Sem comando entregue');
  assert.equal(textoDoEstado({ ligado: true, meta: 22 }), 'Ligado, meta 22 °C');
  assert.equal(textoDoEstado({ ligado: true, meta: null }), 'Ligado');
  assert.equal(textoDoEstado({ ligado: false, meta: 22 }), 'Desligado');
});

test('há pendente enquanto algum comando não foi entregue nem expirou', () => {
  assert.equal(temPendente([comando('ligar', 'entregue', '2026-11-13T12:00:00Z')], 17), false);
  assert.equal(temPendente([comando('ligar', 'pendente', '2026-11-13T12:00:00Z')], 17), true);
});

test('a linha da lista: ação, temperatura, usuário, data e situação', () => {
  const linha = linhaDoComando(comando('ajustar', 'pendente', '2026-11-13T11:20:00Z', 20));
  assert.equal(linha.acao, 'Ajustar');
  assert.equal(linha.temperatura, '20 °C');
  assert.equal(linha.usuario, 'Ana Lima');
  assert.equal(linha.situacao, 'Pendente');
  assert.match(linha.dataHora, /^\d\d\/\d\d \d\d:\d\d$/);
  assert.equal(
    linhaDoComando(comando('ligar', 'expirado', '2026-11-13T11:20:00Z')).temperatura,
    '–',
  );
});

test('a mensagem do envio diz a ação e que ela está pendente', () => {
  assert.equal(mensagemDoEnvio('ajustar', 20), 'Ajustar para 20 °C enviado, pendente');
  assert.equal(mensagemDoEnvio('ligar', null), 'Ligar enviado, pendente');
});

test('o dial cobre 270 graus: 16 °C embaixo à esquerda, 30 °C embaixo à direita', () => {
  assert.equal(anguloDa(16), 135);
  assert.equal(anguloDa(23), 270);
  assert.equal(anguloDa(30), 405);
});

test('o ponteiro vira a temperatura mais próxima no arco', () => {
  assert.equal(temperaturaDoPonto(0, -1), 23);
  assert.equal(temperaturaDoPonto(-1, 0), 18);
  assert.equal(temperaturaDoPonto(1, 0), 28);
  // No vão de baixo, vai para a ponta mais perto.
  assert.equal(temperaturaDoPonto(0.2, 1), 30);
  assert.equal(temperaturaDoPonto(-0.2, 1), 16);
});

test('trocado o emissor, os comandos do sensor antigo não contam', () => {
  const comandos = [comando('ajustar', 'entregue', '2026-11-13T11:20:00Z', 22, 17)];
  assert.deepEqual(estadoDoEquipamento(comandos, 18), { ligado: null, meta: null });
  assert.equal(temPendente([comando('ligar', 'pendente', '2026-11-13T12:00:00Z')], 18), false);
  assert.equal(
    ajustePendente([comando('ajustar', 'pendente', '2026-11-13T12:00:00Z', 20)], 17),
    20,
  );
  assert.equal(
    ajustePendente([comando('ajustar', 'pendente', '2026-11-13T12:00:00Z', 20)], 18),
    null,
  );
});
