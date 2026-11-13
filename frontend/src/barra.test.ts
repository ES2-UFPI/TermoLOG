import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StatusDaSala } from './api.ts';
import { abaAtiva, iniciais, situacaoDaBarra } from './barra.ts';

const sala = (status: StatusDaSala['status']): StatusDaSala => ({
  sala_id: 1,
  nome: 'Sala',
  faixa: { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: null },
  intervalo_leitura_s: null,
  status,
  leituras: [],
});

test('a aba acompanha a tela, e a tela da sala fica no Painel', () => {
  assert.equal(abaAtiva('/'), '/');
  assert.equal(abaAtiva('/sala/3'), '/');
  assert.equal(abaAtiva('/alertas'), '/alertas');
  assert.equal(abaAtiva('/gateways'), '/gateways');
  assert.equal(abaAtiva('/relatorios'), '/relatorios');
  assert.equal(abaAtiva('/health'), null);
});

test('sala fora da faixa vem antes de qualquer outra situação', () => {
  const uma = situacaoDaBarra([sala('fora_da_faixa'), sala('sem_leitura'), sala('ok')], false);
  assert.equal(uma.tom, 'alerta');
  assert.equal(uma.texto, '1 sala fora da faixa');
  assert.equal(uma.curto, '1 fora');
  const duas = situacaoDaBarra([sala('fora_da_faixa'), sala('fora_da_faixa')], false);
  assert.equal(duas.texto, '2 salas fora da faixa');
});

test('sem leitura não aparece como tudo certo', () => {
  const r = situacaoDaBarra([sala('ok'), sala('sem_leitura')], false);
  assert.equal(r.tom, 'sem-leitura');
  assert.equal(r.texto, 'Nenhuma fora, 1 sem leitura');
  assert.equal(situacaoDaBarra([sala('ok')], false).texto, 'Todas na faixa');
});

test('falha na busca diz sem conexão mesmo com salas de antes na memória', () => {
  const r = situacaoDaBarra([sala('ok')], true);
  assert.equal(r.semConexao, true);
  assert.equal(r.texto, 'Sem conexão com a API');
  assert.equal(situacaoDaBarra(null, true).semConexao, true);
});

test('carregando e sem salas não inventam situação', () => {
  assert.equal(situacaoDaBarra(null, false).texto, 'Buscando as salas');
  assert.equal(situacaoDaBarra([], false).tom, 'neutro');
});

test('as iniciais usam o primeiro e o último nome', () => {
  assert.equal(iniciais('Ana Maria Lima'), 'AL');
  assert.equal(iniciais('ana'), 'A');
  assert.equal(iniciais('  Conta   de teste '), 'CT');
  assert.equal(iniciais(''), '');
  assert.equal(iniciais(undefined), '');
});
