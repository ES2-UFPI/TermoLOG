import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATALHOS,
  dataComFuso,
  dataDoCampo,
  dataLegivel,
  dentroDaGrandeza,
  diaPorExtenso,
  erroDoPeriodo,
  escolherDia,
  extremos,
  FORMATOS,
  type LeituraDoRelatorio,
  LINHAS_POR_PAGINA,
  lerCsv,
  lerRelatorio,
  linhasDaPagina,
  marcasDoEixo,
  nomeDoArquivo,
  noPeriodo,
  parametrosDoRelatorio,
  reduzirSerie,
  resumoDoRelatorio,
  semanasDoMes,
} from './relatorios.ts';

const atalho = (rotulo: string) => ATALHOS.find((a) => a.rotulo === rotulo);

test('a data sai com fuso e aponta para o início e o fim do dia local', () => {
  const inicio = dataComFuso('2026-10-16', false);
  const fim = dataComFuso('2026-10-16', true);
  assert.match(inicio, /^2026-10-16T00:00:00[+-]\d\d:\d\d$/);
  assert.match(fim, /^2026-10-16T23:59:59[+-]\d\d:\d\d$/);
  assert.equal(new Date(inicio).getTime(), new Date(2026, 9, 16).getTime());
  assert.equal(new Date(fim).getTime(), new Date(2026, 9, 16, 23, 59, 59).getTime());
});

test('o campo de data usa o dia local', () => {
  assert.equal(dataDoCampo(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('os atalhos contam o dia de hoje e o mês passado vira o ano', () => {
  const agora = new Date(2026, 0, 15, 10);
  assert.deepEqual(atalho('Últimos 7 dias')?.periodo(agora), {
    inicio: '2026-01-09',
    fim: '2026-01-15',
  });
  assert.deepEqual(atalho('Últimos 30 dias')?.periodo(agora), {
    inicio: '2025-12-17',
    fim: '2026-01-15',
  });
  assert.deepEqual(atalho('Mês passado')?.periodo(agora), {
    inicio: '2025-12-01',
    fim: '2025-12-31',
  });
});

test('período inválido é barrado; um dia só é válido', () => {
  assert.equal(
    erroDoPeriodo({ inicio: '2026-10-17', fim: '2026-10-16' }),
    'O início do período não pode ser depois do fim.',
  );
  assert.equal(
    erroDoPeriodo({ inicio: '', fim: '2026-10-16' }),
    'Escolha o último dia do período no calendário.',
  );
  assert.equal(erroDoPeriodo({ inicio: '2026-10-16', fim: '2026-10-16' }), null);
});

test('os parâmetros seguem o contrato e o fuso vai codificado', () => {
  const query = new URLSearchParams(
    parametrosDoRelatorio(3, { inicio: '2026-10-16', fim: '2026-10-17' }, 'csv'),
  );
  assert.deepEqual([...query.keys()], ['sala_id', 'inicio', 'fim', 'formato']);
  assert.equal(query.get('sala_id'), '3');
  assert.equal(query.get('formato'), 'csv');
  assert.equal(query.get('inicio'), dataComFuso('2026-10-16', false));
  assert.equal(query.get('fim'), dataComFuso('2026-10-17', true));
  // "+" sem codificar chegaria na API como espaço.
  assert.doesNotMatch(
    parametrosDoRelatorio(3, { inicio: '2026-10-16', fim: '2026-10-17' }, 'csv'),
    /\+/,
  );
});

test('o nome do arquivo vem do cabeçalho, e sem ele cai no padrão', () => {
  assert.equal(nomeDoArquivo('attachment; filename="sala-1.csv"', 'csv'), 'sala-1.csv');
  assert.equal(nomeDoArquivo('attachment; filename=sala-1.csv', 'csv'), 'sala-1.csv');
  assert.equal(nomeDoArquivo(null, 'csv'), 'relatorio-leituras.csv');
});

test('só o que a API já gera fica disponível', () => {
  assert.deepEqual(
    FORMATOS.filter((f) => f.pronto).map((f) => f.id),
    ['pdf', 'csv'],
  );
  assert.deepEqual(
    FORMATOS.map((f) => f.id),
    ['pdf', 'xlsx', 'csv'],
  );
});

// Igual ao que a rota gera, com o BOM e as aspas do módulo csv do Python.
const CSV =
  '\uFEFFEstabelecimento;"Hospital; Central"\r\nSala;\'=Câmara\r\nPeríodo;16/10/2026 00:00:00 a 16/10/2026 23:59:59\r\n' +
  'Responsável técnico;Ana\r\nFaixa de temperatura;"2,0 a 8,0 °C"\r\nFaixa de umidade;sem limite\r\n\r\n' +
  'Data e hora;Temperatura (°C);Umidade (%);ID do sensor\r\n' +
  '16/10/2026 09:00:00;9,1;61,5;12\r\n16/10/2026 09:30:00;4,5;60,0;13\r\n';
const FAIXA = { temperatura_min: 2, temperatura_max: 8, umidade_min: null, umidade_max: 61 };

test('lê as aspas com ";" e "" dentro da célula', () => {
  assert.deepEqual(lerCsv('a;"b;c"\r\n"d""e";\r\n'), [
    ['a', 'b;c'],
    ['d"e', ''],
  ]);
});

test('lê o relatório: cabeçalho, números com vírgula e hora de Brasília', () => {
  const { cabecalho, leituras } = lerRelatorio(CSV);
  assert.deepEqual(cabecalho[0], ['Estabelecimento', 'Hospital; Central']);
  assert.deepEqual(cabecalho[1], ['Sala', '=Câmara']);
  assert.equal(cabecalho.length, 6);
  assert.equal(leituras.length, 2);
  assert.equal(leituras[0].temperatura, 9.1);
  assert.equal(leituras[0].umidade, 61.5);
  assert.equal(leituras[0].sensor, 12);
  assert.equal(leituras[0].instante, Date.parse('2026-10-16T12:00:00Z'));
});

test('período sem leituras mantém o cabeçalho e a tabela vazia', () => {
  const texto = CSV.slice(0, CSV.indexOf('16/10/2026 09:00:00'));
  const { cabecalho, leituras } = lerRelatorio(texto);
  assert.equal(cabecalho.length, 6);
  assert.deepEqual(leituras, []);
  assert.deepEqual(resumoDoRelatorio(leituras, FAIXA), {
    total: 0,
    sensores: [],
    fora: 0,
    temperatura: null,
  });
});

test('o resumo conta a leitura fora por qualquer grandeza, uma vez só', () => {
  const { leituras } = lerRelatorio(CSV);
  const r = resumoDoRelatorio(leituras, FAIXA);
  assert.equal(r.fora, 1);
  assert.deepEqual(r.sensores, [12, 13]);
  assert.deepEqual(r.temperatura, [4.5, 9.1]);
  assert.equal(dentroDaGrandeza(leituras[0], FAIXA, 'temperatura'), false);
  assert.equal(dentroDaGrandeza(leituras[1], FAIXA, 'umidade'), true);
  // Limite null não reprova ninguém.
  const semFaixa = { ...FAIXA, temperatura_max: null };
  assert.equal(dentroDaGrandeza(leituras[0], semFaixa, 'temperatura'), true);
});

const serie = (n: number): LeituraDoRelatorio[] =>
  Array.from({ length: n }, (_, id) => ({
    id,
    dataHora: '',
    instante: id,
    temperatura: 5,
    umidade: 50,
    sensor: 1,
  }));

test('reduzir a série não esconde um pico e limita os pontos', () => {
  const leituras = serie(10_000);
  leituras[4321].temperatura = 40;
  const pontos = reduzirSerie(leituras, 'temperatura', 100);
  assert.ok(pontos.length <= 200);
  assert.ok(pontos.some((p) => p.temperatura === 40));
  assert.deepEqual(
    pontos.map((p) => p.instante),
    [...pontos.map((p) => p.instante)].sort((a, b) => a - b),
  );
  assert.equal(reduzirSerie(serie(5), 'temperatura', 100).length, 5);
});

test('extremos aguentam uma lista grande, onde o Math.min(...lista) estoura', () => {
  assert.deepEqual(extremos(Array.from({ length: 500_000 }, (_, i) => i)), [0, 499_999]);
});

test('as marcas do eixo cobrem os extremos, em números redondos', () => {
  const marcas = marcasDoEixo(2.3, 9.1);
  assert.ok(marcas[0] <= 2.3 && marcas[marcas.length - 1] >= 9.1);
  assert.deepEqual(marcas, [2, 4, 6, 8, 10]);
  assert.ok(marcasDoEixo(5, 5).length >= 2);
});

test('a página volta para dentro do limite quando o filtro encurta a lista', () => {
  assert.equal(linhasDaPagina(serie(60), 2).linhas.length, LINHAS_POR_PAGINA);
  assert.equal(linhasDaPagina(serie(60), 3).linhas.length, 10);
  assert.equal(linhasDaPagina(serie(60), 9).paginaAtual, 3);
  assert.deepEqual(linhasDaPagina([], 4), { linhas: [], paginaAtual: 1, paginas: 1 });
});

test('o calendário: primeiro clique é o início, segundo é o fim, e a ordem se acerta', () => {
  const vazio = { inicio: '', fim: '' };
  const um = escolherDia(vazio, '2026-10-10');
  assert.deepEqual(um, { inicio: '2026-10-10', fim: '' });
  assert.deepEqual(escolherDia(um, '2026-10-20'), { inicio: '2026-10-10', fim: '2026-10-20' });
  assert.deepEqual(escolherDia(um, '2026-10-01'), { inicio: '2026-10-01', fim: '2026-10-10' });
  assert.deepEqual(escolherDia(um, '2026-10-10'), { inicio: '2026-10-10', fim: '2026-10-10' });
  // Com o período completo, o próximo clique começa outro.
  assert.deepEqual(escolherDia({ inicio: '2026-10-01', fim: '2026-10-02' }, '2026-10-20'), {
    inicio: '2026-10-20',
    fim: '',
  });
});

test('a marcação acompanha o ponteiro mesmo antes do início', () => {
  const m = (dia: string) => noPeriodo(dia, '2026-10-10', '2026-10-05');
  assert.equal(m('2026-10-07').dentro, true);
  assert.equal(m('2026-10-05').inicio, true);
  assert.equal(m('2026-10-10').fim, true);
  assert.equal(m('2026-10-11').dentro, false);
  assert.equal(noPeriodo('2026-10-10', '2026-10-10', null).unico, true);
  assert.equal(noPeriodo('2026-10-10', '', null).dentro, false);
});

test('as semanas do mês começam no domingo e completam os dias vizinhos', () => {
  const semanas = semanasDoMes(2026, 9); // outubro de 2026 começa numa quinta
  assert.equal(semanas[0][0], '2026-09-27');
  assert.equal(semanas[0][4], '2026-10-01');
  assert.equal(semanas[semanas.length - 1][6], '2026-10-31');
  assert.ok(semanas.every((s) => s.length === 7));
  // Fevereiro de 2026 cabe certinho em quatro semanas.
  assert.equal(semanasDoMes(2026, 1).length, 4);
});

test('os textos da data', () => {
  assert.equal(dataLegivel('2026-10-16'), '16/10/2026');
  assert.equal(dataLegivel(''), 'Escolha o dia');
  assert.equal(diaPorExtenso('2026-10-16'), '16 de outubro de 2026');
});
