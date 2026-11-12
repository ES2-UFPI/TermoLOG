import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Canal } from './api.ts';
import {
  corpoDosCanais,
  erroDoEmail,
  erroDoServidor,
  errosDoRascunho,
  mesclarDoServidor,
  mudou,
  rascunhoDosCanais,
  tempoRestante,
} from './canais.ts';

const PUSH: Canal = {
  tipo: 'push',
  destino: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'p', auth: 'a' },
  },
  ativo: true,
};
const email = (destino = 'ana@exemplo.com', ativo = true): Canal => ({
  tipo: 'email',
  destino,
  ativo,
});
const telegram = (destino = '123456789', ativo = true): Canal => ({
  tipo: 'telegram',
  destino,
  ativo,
});

test('sem canais salvos: e-mail sugerido da conta, tudo desligado e nada a enviar', () => {
  const r = rascunhoDosCanais([], 'ana@exemplo.com');
  assert.deepEqual(r.email, { ligado: false, destino: 'ana@exemplo.com', salvo: null });
  assert.deepEqual(r.telegram, { ligado: false, chat: null });
  assert.deepEqual(corpoDosCanais(r), []);
});

test('ligar o e-mail envia o endereço sem espaços e em minúsculas', () => {
  const r = rascunhoDosCanais([]);
  r.email = { ...r.email, ligado: true, destino: '  Ana@Exemplo.COM ' };
  assert.deepEqual(corpoDosCanais(r), [email('ana@exemplo.com')]);
});

test('desligar não apaga o destino, e o texto digitado com o canal desligado não vale', () => {
  const r = rascunhoDosCanais([email('ana@exemplo.com')]);
  r.email = { ...r.email, ligado: false, destino: 'lixo' };
  assert.deepEqual(corpoDosCanais(r), [email('ana@exemplo.com', false)]);
  assert.equal(errosDoRascunho(r).email, null);
});

test('o PUT leva de volta o push e os canais a mais, que a tela não edita', () => {
  const extra = email('outra@exemplo.com');
  const r = rascunhoDosCanais([email(), PUSH, extra, telegram()]);
  assert.deepEqual(r.outros, [PUSH, extra]);
  assert.deepEqual(corpoDosCanais(r), [email(), telegram(), PUSH, extra]);
});

test('Telegram desligado mantém o chat; sem vínculo, fica de fora', () => {
  const r = rascunhoDosCanais([telegram('-100200', true)]);
  r.telegram.ligado = false;
  assert.deepEqual(corpoDosCanais(r), [telegram('-100200', false)]);
});

test('e-mail: vazio e malformado são barrados; o válido passa', () => {
  assert.match(erroDoEmail('  ') ?? '', /Informe o e-mail/);
  for (const ruim of ['ana', 'ana@', '@x.com', 'ana@x', 'a na@x.com']) {
    assert.match(erroDoEmail(ruim) ?? '', /e-mail válido/, ruim);
  }
  assert.equal(erroDoEmail(' ana@exemplo.com '), null);
  assert.equal(erroDoEmail('a'.repeat(250) + '@x.co') === null, false);
});

test('só o e-mail ligado é validado', () => {
  const r = rascunhoDosCanais([], '');
  assert.equal(errosDoRascunho(r).email, null);
  r.email.ligado = true;
  assert.match(errosDoRascunho(r).email ?? '', /Informe o e-mail/);
});

test('mudou: igual ao salvo não é alteração; mexer em qualquer canal é', () => {
  const salvo = rascunhoDosCanais([email(), telegram()]);
  const r = structuredClone(salvo);
  assert.equal(mudou(r, salvo), false);
  r.telegram.ligado = false;
  assert.equal(mudou(r, salvo), true);
  const outro = structuredClone(salvo);
  outro.email.destino = ' ANA@exemplo.com ';
  assert.equal(mudou(outro, salvo), false);
});

test('mesclar: o Telegram vinculado pelo bot entra sem perder o que foi digitado', () => {
  const r = rascunhoDosCanais([], '');
  r.email = { ...r.email, ligado: true, destino: 'novo@exemplo.com' };
  const depois = mesclarDoServidor(r, [telegram('555'), PUSH]);
  assert.deepEqual(depois.telegram, { ligado: true, chat: '555' });
  assert.equal(depois.email.destino, 'novo@exemplo.com');
  assert.deepEqual(depois.outros, [PUSH]);
});

test('mesclar: o mesmo chat mantém o interruptor que a pessoa mexeu', () => {
  const r = rascunhoDosCanais([telegram('555', true)]);
  r.telegram.ligado = false;
  assert.equal(mesclarDoServidor(r, [telegram('555', true)]).telegram.ligado, false);
});

test('422: a posição do erro volta ao canal enviado', () => {
  const enviado = [email('x'), telegram()];
  const corpo = (i: number) => ({
    detail: [{ loc: ['body', i, 'destino'], msg: 'Value error, chat_id do Telegram inválido' }],
  });
  assert.match(erroDoServidor(corpo(0), enviado).email ?? '', /e-mail/);
  assert.equal(erroDoServidor(corpo(1), enviado).geral, 'chat_id do Telegram inválido');
  assert.deepEqual(erroDoServidor(null, enviado), { geral: undefined });
});

test('tempo restante do link: m:ss, e nulo quando vence', () => {
  const agora = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(tempoRestante('2026-11-12T10:09:41Z', agora), '9:41');
  assert.equal(tempoRestante('2026-11-12T10:00:05Z', agora), '0:05');
  assert.equal(tempoRestante('2026-11-12T10:00:00Z', agora), null);
});
