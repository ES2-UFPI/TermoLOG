import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erroDaAcao,
  erroDaAcaoCorretiva,
  LISTAS_VAZIAS,
  listaFicouVelha,
  moverAlerta,
  situacoesABuscar,
  TAMANHO_MAXIMO_DA_ACAO,
  textoDoDesvio,
} from './alertas.ts';
import type { Alerta } from './api.ts';

const alerta = (id: number, mudancas: Partial<Alerta> = {}): Alerta => ({
  id,
  sala_id: 1,
  sala_nome: 'Câmara fria',
  sensor_id: 7,
  tipo: 'temperatura_acima',
  situacao: 'pendente',
  data_hora: `2026-11-13T1${id}:00:00Z`,
  leitura: { temperatura: 9.4, umidade: 71, data_hora: `2026-11-13T1${id}:00:00Z` },
  reconhecido_por: null,
  reconhecido_em: null,
  acao_corretiva: null,
  encerrado_em: null,
  ...mudancas,
});

const reconhecido = (id: number) =>
  alerta(id, {
    situacao: 'reconhecido',
    reconhecido_por: { id: 1, nome: 'Ana Lima' },
    reconhecido_em: '2026-11-13T19:00:00Z',
  });

test('os encerrados só são buscados com a aba deles aberta', () => {
  assert.deepEqual(situacoesABuscar('pendente'), ['pendente', 'reconhecido']);
  assert.deepEqual(situacoesABuscar('reconhecido'), ['pendente', 'reconhecido']);
  assert.deepEqual(situacoesABuscar('encerrado'), ['pendente', 'reconhecido', 'encerrado']);
});

test('o alerta reconhecido sai dos pendentes e entra nos reconhecidos com quem e quando', () => {
  const listas = { ...LISTAS_VAZIAS, pendente: [alerta(3), alerta(2)], reconhecido: [] };
  const r = moverAlerta(listas, reconhecido(2));
  assert.deepEqual(
    r.pendente?.map((a) => a.id),
    [3],
  );
  assert.equal(r.reconhecido?.length, 1);
  assert.equal(r.reconhecido?.[0].reconhecido_por?.nome, 'Ana Lima');
  assert.equal(r.reconhecido?.[0].reconhecido_em, '2026-11-13T19:00:00Z');
  // A lista de antes não muda: o React compara pela referência.
  assert.equal(listas.pendente.length, 2);
});

test('o alerta movido entra na posição dele, os mais recentes primeiro', () => {
  const listas = {
    ...LISTAS_VAZIAS,
    pendente: [alerta(2)],
    reconhecido: [reconhecido(3), reconhecido(1)],
  };
  const r = moverAlerta(listas, reconhecido(2));
  assert.deepEqual(
    r.reconhecido?.map((a) => a.id),
    [3, 2, 1],
  );
});

test('o encerrado sai dos reconhecidos; a aba de encerrados não buscada continua sem lista', () => {
  const listas = { ...LISTAS_VAZIAS, pendente: [], reconhecido: [reconhecido(4)] };
  const encerrado = { ...reconhecido(4), situacao: 'encerrado' as const, acao_corretiva: 'Porta' };
  const r = moverAlerta(listas, encerrado);
  assert.deepEqual(r.reconhecido, []);
  assert.equal(r.encerrado, null);
});

test('mover não duplica o alerta que já está na lista certa', () => {
  const listas = { ...LISTAS_VAZIAS, reconhecido: [reconhecido(5)] };
  const novo = { ...reconhecido(5), reconhecido_em: '2026-11-13T20:00:00Z' };
  const r = moverAlerta(listas, novo);
  assert.equal(r.reconhecido?.length, 1);
  // A versão que a API devolveu substitui a antiga.
  assert.equal(r.reconhecido?.[0], novo);
});

test('cada desvio tem o seu texto', () => {
  assert.equal(textoDoDesvio('temperatura_acima'), 'Temperatura acima da faixa');
  assert.equal(textoDoDesvio('umidade_abaixo'), 'Umidade abaixo da faixa');
});

test('a ação corretiva vazia ou só com espaços é barrada', () => {
  assert.match(erroDaAcaoCorretiva('') ?? '', /Descreva a ação tomada/);
  assert.match(erroDaAcaoCorretiva('   \n ') ?? '', /Descreva a ação tomada/);
  assert.equal(erroDaAcaoCorretiva(' Porta da câmara fechada '), null);
});

test('a ação corretiva acima do limite da API é barrada; no limite, passa', () => {
  assert.equal(erroDaAcaoCorretiva('a'.repeat(TAMANHO_MAXIMO_DA_ACAO)), null);
  assert.match(erroDaAcaoCorretiva('a'.repeat(TAMANHO_MAXIMO_DA_ACAO + 1)) ?? '', /2\.000/);
});

test('o 409 vira mensagem com o motivo da API e pede a lista de novo', () => {
  const texto = erroDaAcao(409, 'alerta não está pendente');
  assert.match(texto, /^Alerta não está pendente\./);
  assert.match(texto, /a lista foi atualizada/);
  assert.equal(listaFicouVelha(409), true);
  assert.equal(listaFicouVelha(404), true);
});

test('outros erros mostram a mensagem e não mexem na lista', () => {
  assert.equal(
    erroDaAcao(undefined, 'a API não respondeu a tempo'),
    'Não deu certo: a API não respondeu a tempo.',
  );
  assert.equal(listaFicouVelha(500), false);
  assert.equal(listaFicouVelha(undefined), false);
});
