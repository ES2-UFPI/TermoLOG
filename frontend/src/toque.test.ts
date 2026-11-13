import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALVO_DE_TOQUE, alvo, LARGURA_DO_CELULAR } from './toque.ts';

test('no celular, controle pequeno cresce até o alvo de toque', () => {
  assert.equal(alvo(true, 32), ALVO_DE_TOQUE);
  assert.equal(alvo(true, 24), ALVO_DE_TOQUE);
});

test('no celular, controle que já passa de 44 px fica como está', () => {
  assert.equal(alvo(true, 48), 48);
});

test('no computador, o tamanho desenhado não muda', () => {
  assert.equal(alvo(false, 32), 32);
  assert.equal(alvo(false, 40), 40);
});

test('a largura do celular é a mesma da margem do painel', () => {
  assert.equal(LARGURA_DO_CELULAR, 760);
});
