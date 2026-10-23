import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordemDasBuscas, repetir } from './busca.ts';

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('só a busca mais recente vale', () => {
  const novaBusca = ordemDasBuscas();
  const primeira = novaBusca();
  assert.equal(primeira(), true);
  const segunda = novaBusca();
  // A primeira ainda pode responder depois, mas não pode mais mudar a tela.
  assert.equal(primeira(), false);
  assert.equal(segunda(), true);
});

test('repetir não sobrepõe buscas, segue depois de uma falha e para quando pedido', async () => {
  let rodando = 0;
  let maximo = 0;
  let vezes = 0;
  const parar = repetir(async () => {
    vezes++;
    rodando++;
    maximo = Math.max(maximo, rodando);
    await esperar(30); // a busca demora mais que o intervalo
    rodando--;
    if (vezes === 1) throw new Error('falhou');
  }, 10);
  await esperar(200);
  parar();
  const depoisDeParar = vezes;
  await esperar(100);

  assert.equal(maximo, 1);
  assert.ok(vezes >= 3, `rodou só ${vezes} vezes`);
  assert.equal(vezes, depoisDeParar);
});
