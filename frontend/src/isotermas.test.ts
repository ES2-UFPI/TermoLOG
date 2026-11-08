import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aproximar, envelope, onda, segmentos } from './isotermas.ts';

const coletar = (
  grade: number[],
  colunas: number,
  linhas: number,
  passo: number,
  nivel: number,
) => {
  const saida: number[][] = [];
  segmentos(grade, colunas, linhas, passo, nivel, (...s) => saida.push(s));
  return saida;
};

test('rampa em x: a curva é uma reta vertical exatamente no valor do nível', () => {
  const grade = [0, 1, 2, 0, 1, 2, 0, 1, 2];
  const saida = coletar(grade, 3, 3, 10, 1.5);
  assert.deepEqual(saida, [
    [15, 0, 15, 10],
    [15, 10, 15, 20],
  ]);
});

test('sem cruzamento, nenhum segmento', () => {
  assert.equal(coletar([1, 1, 1, 1], 2, 2, 10, 5).length, 0);
  assert.equal(coletar([9, 9, 9, 9], 2, 2, 10, 5).length, 0);
});

test('cone: todos os pontos da curva ficam no raio do nível', () => {
  const colunas = 41;
  const grade = [];
  for (let l = 0; l < colunas; l++) {
    for (let c = 0; c < colunas; c++) grade.push(Math.hypot(c - 20, l - 20));
  }
  const saida = coletar(grade, colunas, colunas, 1, 10);
  assert.ok(saida.length > 40);
  for (const [x1, y1, x2, y2] of saida) {
    assert.ok(Math.abs(Math.hypot(x1 - 20, y1 - 20) - 10) < 0.1);
    assert.ok(Math.abs(Math.hypot(x2 - 20, y2 - 20) - 10) < 0.1);
  }
});

test('sela: duas curvas na mesma célula', () => {
  assert.equal(coletar([1, 0, 0, 1], 2, 2, 10, 0.5).length, 2);
  assert.equal(coletar([0, 1, 1, 0], 2, 2, 10, 0.5).length, 2);
});

test('pulso: nasce em zero, sem tranco, cresce e some ao fim da vida', () => {
  assert.equal(envelope(0), 0);
  assert.ok(envelope(0.01) < 0.02);
  assert.ok(envelope(0.18) > 0.6);
  assert.ok(envelope(0.6) < envelope(0.3));
  assert.equal(envelope(1), 0);
  for (let p = 0; p < 1; p += 0.005) assert.ok(Math.abs(envelope(p + 0.005) - envelope(p)) < 0.05);
});

test('pulso: mais forte na crista, nada longe dela', () => {
  assert.ok(onda(100, 100, 50, 0.3) > onda(150, 100, 50, 0.3));
  assert.ok(onda(400, 100, 50, 0.3) < 0.001);
});

test('aproximar: mesmo resultado em qualquer taxa de quadros, sem passar do alvo', () => {
  const doisPassos = aproximar(aproximar(0, 10, 0.016, 0.5), 10, 0.016, 0.5);
  assert.ok(Math.abs(doisPassos - aproximar(0, 10, 0.032, 0.5)) < 1e-9);
  assert.ok(aproximar(0, 10, 5, 0.5) <= 10);
});
