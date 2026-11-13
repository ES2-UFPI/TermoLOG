import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as TextoSvg } from 'react-native-svg';
import type { Faixa } from '../api';
import { numero } from '../painel';
import {
  dentroDaGrandeza,
  extremos,
  type Grandeza,
  type LeituraDoRelatorio,
  LINHAS_POR_PAGINA,
  linhasDaPagina,
  marcasDoEixo,
  mesmoDia,
  type RelatorioLido,
  reduzirSerie,
  resumoDoRelatorio,
} from '../relatorios';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';
import { useCelular } from '../useCelular';
import { Surgir } from './Surgir';

const UNIDADE: Record<Grandeza, string> = { temperatura: ' °C', umidade: '%' };
const ALTURA = 240;
// O texto do SVG não herda a fonte da tela: sem isto, os eixos saem com serifa.
const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MARGEM = { topo: 12, base: 26, esquerda: 44, direita: 12 };
const hora = (ms: number, comData: boolean) =>
  new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    ...(comData ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Prévia do relatório (#109): é o próprio arquivo que a API gerou, lido na tela. Mostra o
 * cabeçalho, um resumo, o gráfico com a faixa e a tabela. Os filtros mudam só a prévia.
 */
export function PreviaDoRelatorio({
  relatorio,
  faixa,
  largura,
  tema,
}: {
  relatorio: RelatorioLido;
  faixa: Faixa;
  largura: number;
  tema: Tema;
}) {
  const { leituras } = relatorio;
  const resumo = useMemo(() => resumoDoRelatorio(leituras, faixa), [leituras, faixa]);
  const [grandeza, setGrandeza] = useState<Grandeza>('temperatura');
  const [escondidos, setEscondidos] = useState<number[]>([]);
  const [soFora, setSoFora] = useState(false);
  const [pagina, setPagina] = useState(1);
  const estreito = largura < 560;

  // Cor presa ao sensor, pela ordem do ID: filtrar não repinta os outros (ver dataviz).
  const corDo = (sensor: number) => tema.series[resumo.sensores.indexOf(sensor)] ?? tema.texto2;
  const visiveis = leituras.filter((l) => !escondidos.includes(l.sensor));
  const naTabela = soFora
    ? visiveis.filter(
        (l) => !dentroDaGrandeza(l, faixa, 'temperatura') || !dentroDaGrandeza(l, faixa, 'umidade'),
      )
    : visiveis;
  const { linhas, paginaAtual, paginas } = linhasDaPagina(naTabela, pagina);

  const fatos = [
    { rotulo: 'Leituras', valor: resumo.total.toLocaleString('pt-BR') },
    { rotulo: 'Sensores', valor: String(resumo.sensores.length) },
    {
      rotulo: 'Fora da faixa',
      valor: resumo.fora.toLocaleString('pt-BR'),
      alerta: resumo.fora > 0,
    },
    {
      rotulo: 'Temperatura lida',
      valor: resumo.temperatura
        ? `${numero(resumo.temperatura[0])} a ${numero(resumo.temperatura[1])} °C`
        : 'Sem leituras',
    },
  ];

  return (
    <View style={styles.previa}>
      <View style={styles.cabecalho}>
        {relatorio.cabecalho.map(([rotulo, valor]) => (
          <View key={rotulo} style={[styles.cabecalhoItem, estreito && styles.cabecalhoInteiro]}>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>{rotulo}</Text>
            <Text style={[styles.texto, { color: tema.texto }]}>{valor}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.fatos, { borderColor: tema.trilho }]}>
        {fatos.map((f) => (
          <View key={f.rotulo} style={[styles.fato, estreito && styles.fatoEstreito]}>
            <Text style={[styles.fatoValor, { color: f.alerta ? tema.alerta : tema.texto }]}>
              {f.valor}
            </Text>
            <View style={styles.fatoRotulo}>
              {f.alerta && <WarningCircleIcon size={13} weight="fill" color={tema.alerta} />}
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>{f.rotulo}</Text>
            </View>
          </View>
        ))}
      </View>

      {resumo.total === 0 ? (
        <View style={styles.vazio}>
          <Text style={[styles.vazioTitulo, { color: tema.texto }]}>
            Nenhuma leitura neste período
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            O arquivo sai só com o cabeçalho. Tente um período maior ou outra sala.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.controles}>
            <View style={styles.opcoes} accessibilityRole="radiogroup">
              {(['temperatura', 'umidade'] as const).map((g) => (
                <Opcao
                  key={g}
                  rotulo={g === 'temperatura' ? 'Temperatura' : 'Umidade'}
                  ativa={grandeza === g}
                  papel="radio"
                  tema={tema}
                  aoTocar={() => setGrandeza(g)}
                />
              ))}
            </View>
            <View style={styles.opcoes} accessibilityLabel="Sensores no gráfico e na tabela">
              {resumo.sensores.map((sensor) => (
                <Opcao
                  key={sensor}
                  rotulo={`Sensor ${sensor}`}
                  cor={corDo(sensor)}
                  ativa={!escondidos.includes(sensor)}
                  papel="checkbox"
                  tema={tema}
                  aoTocar={() => {
                    setPagina(1);
                    setEscondidos((e) =>
                      e.includes(sensor) ? e.filter((s) => s !== sensor) : [...e, sensor],
                    );
                  }}
                />
              ))}
            </View>
          </View>

          <Grafico
            leituras={visiveis}
            grandeza={grandeza}
            faixa={faixa}
            corDo={corDo}
            tema={tema}
          />

          <View style={styles.tabelaTopo}>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              {naTabela.length === 0
                ? 'Nenhuma leitura com estes filtros'
                : `${(paginaAtual - 1) * LINHAS_POR_PAGINA + 1} a ${Math.min(
                    paginaAtual * LINHAS_POR_PAGINA,
                    naTabela.length,
                  )} de ${naTabela.length.toLocaleString('pt-BR')}`}
            </Text>
            <Opcao
              rotulo="Só fora da faixa"
              ativa={soFora}
              papel="checkbox"
              tema={tema}
              aoTocar={() => {
                setPagina(1);
                setSoFora((s) => !s);
              }}
            />
          </View>
          <Tabela linhas={linhas} faixa={faixa} estreito={estreito} corDo={corDo} tema={tema} />
          {paginas > 1 && (
            <View style={styles.paginas}>
              <BotaoPagina
                rotulo="Página anterior"
                desligado={paginaAtual === 1}
                tema={tema}
                aoTocar={() => setPagina(paginaAtual - 1)}
              >
                <CaretLeftIcon size={14} color={tema.texto} />
              </BotaoPagina>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Página {paginaAtual} de {paginas}
              </Text>
              <BotaoPagina
                rotulo="Próxima página"
                desligado={paginaAtual === paginas}
                tema={tema}
                aoTocar={() => setPagina(paginaAtual + 1)}
              >
                <CaretRightIcon size={14} color={tema.texto} />
              </BotaoPagina>
            </View>
          )}
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            Os filtros mudam só esta prévia: o arquivo traz todas as leituras do período, no horário
            de Brasília.
          </Text>
        </>
      )}
    </View>
  );
}

function Opcao({
  rotulo,
  ativa,
  papel,
  cor,
  tema,
  aoTocar,
}: {
  rotulo: string;
  ativa: boolean;
  papel: 'radio' | 'checkbox';
  cor?: string;
  tema: Tema;
  aoTocar: () => void;
}) {
  const celular = useCelular();
  return (
    <Pressable
      onPress={aoTocar}
      accessibilityRole={papel}
      aria-checked={ativa}
      style={({ pressed }) => [
        styles.opcao,
        celular && styles.opcaoCelular,
        {
          borderColor: ativa ? tema.texto : tema.borda,
          backgroundColor: ativa ? tema.vidroForte : 'transparent',
        },
        pressed && styles.pressionado,
      ]}
    >
      {cor && (
        <View
          style={[
            styles.amostra,
            { backgroundColor: ativa ? cor : 'transparent', borderColor: cor },
          ]}
        >
          {ativa && <CheckIcon size={9} weight="bold" color={tema.fundo} />}
        </View>
      )}
      <Text style={[styles.opcaoTexto, { color: ativa ? tema.texto : tema.texto2 }]}>{rotulo}</Text>
    </Pressable>
  );
}

function BotaoPagina({
  rotulo,
  desligado,
  tema,
  aoTocar,
  children,
}: {
  rotulo: string;
  desligado: boolean;
  tema: Tema;
  aoTocar: () => void;
  children: React.ReactNode;
}) {
  const celular = useCelular();
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: desligado }}
      style={({ pressed }) => [
        styles.pagina,
        celular && styles.paginaCelular,
        { borderColor: tema.borda, opacity: desligado ? 0.35 : 1 },
        pressed && styles.pressionado,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Uma linha por sensor na mesma escala, com a faixa ao fundo e a leitura sob o ponteiro. */
function Grafico({
  leituras,
  grandeza,
  faixa,
  corDo,
  tema,
}: {
  leituras: LeituraDoRelatorio[];
  grandeza: Grandeza;
  faixa: Faixa;
  corDo: (sensor: number) => string;
  tema: Tema;
}) {
  const [largura, setLargura] = useState(0);
  const [ponteiro, setPonteiro] = useState<number | null>(null);
  const unidade = UNIDADE[grandeza];
  const min = grandeza === 'temperatura' ? faixa.temperatura_min : faixa.umidade_min;
  const max = grandeza === 'temperatura' ? faixa.temperatura_max : faixa.umidade_max;
  const areaX = Math.max(1, largura - MARGEM.esquerda - MARGEM.direita);
  const areaY = ALTURA - MARGEM.topo - MARGEM.base;

  if (leituras.length === 0) {
    return (
      <View style={[styles.graficoVazio, { height: ALTURA, borderColor: tema.trilho }]}>
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          Escolha ao menos um sensor para ver o gráfico.
        </Text>
      </View>
    );
  }

  const [lo, hi] = extremos([
    ...leituras.map((l) => l[grandeza]),
    ...(min === null ? [] : [min]),
    ...(max === null ? [] : [max]),
  ]);
  const [t0, t1] = extremos(leituras.map((l) => l.instante));
  const marcasY = marcasDoEixo(lo, hi);
  const y0 = marcasY[0];
  const y1 = marcasY[marcasY.length - 1];
  const x = (t: number) =>
    MARGEM.esquerda + (t1 === t0 ? areaX / 2 : ((t - t0) / (t1 - t0)) * areaX);
  const y = (v: number) => MARGEM.topo + areaY - ((v - y0) / (y1 - y0 || 1)) * areaY;
  const sensores = [...new Set(leituras.map((l) => l.sensor))];
  const comData = !mesmoDia(t0, t1);
  const marcasX = t1 === t0 ? [t0] : [0, 1, 2, 3].map((i) => t0 + ((t1 - t0) * i) / 3);

  // A leitura mais próxima do ponteiro em cada sensor: o leitor mira a hora, não a linha.
  const instante =
    ponteiro === null ? null : t0 + ((ponteiro - MARGEM.esquerda) / areaX) * (t1 - t0);
  const sob =
    instante === null
      ? []
      : sensores.map((sensor) =>
          leituras
            .filter((l) => l.sensor === sensor)
            .reduce((a, b) =>
              Math.abs(b.instante - instante) < Math.abs(a.instante - instante) ? b : a,
            ),
        );
  const xSob = sob.length > 0 ? x(sob[0].instante) : 0;

  return (
    <View
      style={[styles.grafico, { height: ALTURA }]}
      onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
      accessibilityRole="image"
      accessibilityLabel={`Gráfico de ${grandeza} por sensor. Os valores estão na tabela abaixo.`}
    >
      {largura > 0 && (
        <Svg width={largura} height={ALTURA}>
          {(min !== null || max !== null) && (
            <Rect
              x={MARGEM.esquerda}
              y={y(max ?? y1)}
              width={areaX}
              height={Math.max(0, y(min ?? y0) - y(max ?? y1))}
              fill={tema.folga}
              opacity={0.12}
            />
          )}
          {marcasY.map((v) => (
            <Line
              key={v}
              x1={MARGEM.esquerda}
              x2={largura - MARGEM.direita}
              y1={y(v)}
              y2={y(v)}
              stroke={tema.trilho}
              strokeWidth={1}
            />
          ))}
          {marcasY.map((v) => (
            <TextoSvg
              key={`y${v}`}
              x={MARGEM.esquerda - 8}
              y={y(v) + 4}
              fontSize={11}
              fontFamily={FONTE}
              fill={tema.texto2}
              textAnchor="end"
            >
              {`${numero(v)}`.replace(/,0$/, '')}
            </TextoSvg>
          ))}
          {marcasX.map((t, i) => (
            <TextoSvg
              key={t}
              x={x(t)}
              y={ALTURA - 8}
              fontSize={11}
              fontFamily={FONTE}
              fill={tema.texto2}
              textAnchor={
                i === 0 && marcasX.length > 1
                  ? 'start'
                  : i === marcasX.length - 1 && i > 0
                    ? 'end'
                    : 'middle'
              }
            >
              {/* Em tela estreita, só a primeira e a última não se encostam. */}
              {areaX < 420 && i > 0 && i < marcasX.length - 1 ? '' : hora(t, comData)}
            </TextoSvg>
          ))}
          {sensores.map((sensor) => {
            const pontos = reduzirSerie(
              leituras.filter((l) => l.sensor === sensor),
              grandeza,
              Math.ceil(areaX / 3),
            );
            // Com uma leitura só não há linha para desenhar: vira um marcador.
            return pontos.length === 1 ? (
              <Circle
                key={sensor}
                cx={x(pontos[0].instante)}
                cy={y(pontos[0][grandeza])}
                r={5}
                fill={corDo(sensor)}
                stroke={tema.fundo}
                strokeWidth={2}
              />
            ) : (
              <Polyline
                key={sensor}
                points={pontos
                  .map((l) => `${x(l.instante).toFixed(1)},${y(l[grandeza]).toFixed(1)}`)
                  .join(' ')}
                fill="none"
                stroke={corDo(sensor)}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })}
          {sob.length > 0 && (
            <Line
              x1={xSob}
              x2={xSob}
              y1={MARGEM.topo}
              y2={MARGEM.topo + areaY}
              stroke={tema.texto2}
              strokeWidth={1}
            />
          )}
        </Svg>
      )}
      {sob.length > 0 && (
        <Surgir
          style={[
            styles.dica,
            {
              left: Math.max(0, Math.min(largura - 176, xSob + (xSob > largura / 2 ? -188 : 12))),
              backgroundColor: tema.fundo,
              borderColor: tema.borda,
            },
          ]}
        >
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {hora(sob[0].instante, true)}
          </Text>
          {sob.map((l) => {
            const dentro = dentroDaGrandeza(l, faixa, grandeza);
            return (
              <View key={l.sensor} style={styles.dicaLinha}>
                <View style={[styles.dicaCor, { backgroundColor: corDo(l.sensor) }]} />
                <Text style={[styles.dicaValor, { color: dentro ? tema.texto : tema.alerta }]}>
                  {numero(l[grandeza])}
                  {unidade}
                </Text>
                <Text style={[styles.pequeno, { color: tema.texto2 }]}>Sensor {l.sensor}</Text>
              </View>
            );
          })}
        </Surgir>
      )}
      {/* Camada do ponteiro: elemento do navegador, porque o painel só roda na web. */}
      <div
        data-testid="area-do-grafico"
        onPointerMove={(e) => {
          const caixa = e.currentTarget.getBoundingClientRect();
          setPonteiro(
            Math.max(MARGEM.esquerda, Math.min(largura - MARGEM.direita, e.clientX - caixa.left)),
          );
        }}
        onPointerLeave={() => setPonteiro(null)}
        style={{ position: 'absolute', inset: 0, touchAction: 'pan-y' }}
      />
    </View>
  );
}

function Tabela({
  linhas,
  faixa,
  estreito,
  corDo,
  tema,
}: {
  linhas: LeituraDoRelatorio[];
  faixa: Faixa;
  estreito: boolean;
  corDo: (sensor: number) => string;
  tema: Tema;
}) {
  return (
    <View accessibilityRole="none">
      <View style={[styles.linha, { borderBottomColor: tema.trilho }]}>
        <Text style={[styles.celulaData, styles.titulo, { color: tema.texto2 }]}>Data e hora</Text>
        <Text
          style={[
            styles.celula,
            estreito && styles.celulaEstreita,
            styles.titulo,
            { color: tema.texto2 },
          ]}
        >
          {estreito ? '°C' : 'Temperatura (°C)'}
        </Text>
        <Text
          style={[
            styles.celula,
            estreito && styles.celulaEstreita,
            styles.titulo,
            { color: tema.texto2 },
          ]}
        >
          {estreito ? '%' : 'Umidade (%)'}
        </Text>
        <Text style={[styles.celulaSensor, styles.titulo, { color: tema.texto2 }]}>Sensor</Text>
      </View>
      {linhas.map((l) => {
        const temperaturaOk = dentroDaGrandeza(l, faixa, 'temperatura');
        const umidadeOk = dentroDaGrandeza(l, faixa, 'umidade');
        return (
          <View
            key={l.id}
            style={[
              styles.linha,
              { borderBottomColor: tema.trilho },
              !(temperaturaOk && umidadeOk) && { backgroundColor: tema.alertaFundo },
            ]}
          >
            <Text style={[styles.celulaData, { color: tema.texto }]}>
              {/* O ano já está no período do cabeçalho: sem ele, a data cabe numa linha. */}
              {estreito ? `${l.dataHora.slice(0, 5)} ${l.dataHora.slice(11, 16)}` : l.dataHora}
            </Text>
            <Text
              style={[
                styles.celula,
                estreito && styles.celulaEstreita,
                { color: temperaturaOk ? tema.texto : tema.alerta },
              ]}
            >
              {numero(l.temperatura)}
            </Text>
            <Text
              style={[
                styles.celula,
                estreito && styles.celulaEstreita,
                { color: umidadeOk ? tema.texto : tema.alerta },
              ]}
            >
              {numero(l.umidade)}
            </Text>
            <View style={styles.celulaSensor}>
              <View style={[styles.dicaCor, { backgroundColor: corDo(l.sensor) }]} />
              <Text style={[styles.celulaTexto, { color: tema.texto }]}>{l.sensor}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  previa: { gap: 18 },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  texto: { fontSize: 15, lineHeight: 21, ...numeros },
  pressionado: { transform: [{ scale: 0.97 }] },
  cabecalho: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  cabecalhoItem: { width: '50%', paddingRight: 16, gap: 1 },
  cabecalhoInteiro: { width: '100%', paddingRight: 0 },
  fatos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 14,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  fato: { width: '25%', paddingRight: 12, gap: 2 },
  fatoEstreito: { width: '50%' },
  fatoValor: { fontSize: 22, fontWeight: '300', letterSpacing: -0.4, ...numeros },
  fatoRotulo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vazio: { gap: 6, paddingVertical: 28, alignItems: 'center' },
  vazioTitulo: { fontSize: 18, fontWeight: '500' },
  controles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1 },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  opcaoTexto: { fontSize: 13 },
  // Alvos de toque de 44 px no celular (#139).
  opcaoCelular: { height: ALVO_DE_TOQUE },
  paginaCelular: { width: ALVO_DE_TOQUE, height: ALVO_DE_TOQUE, borderRadius: ALVO_DE_TOQUE / 2 },
  amostra: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grafico: { width: '100%' },
  graficoVazio: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: 'dashed',
  },
  dica: {
    position: 'absolute',
    top: 8,
    width: 176,
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  dicaLinha: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dicaCor: { width: 8, height: 8, borderRadius: 2 },
  dicaValor: { fontSize: 13, fontWeight: '600', ...numeros },
  tabelaTopo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    gap: 6,
  },
  titulo: { fontSize: 12 },
  celulaData: { flex: 1, minWidth: 0, fontSize: 13, ...numeros },
  celula: { width: 112, textAlign: 'right', fontSize: 13, ...numeros },
  celulaEstreita: { width: 38 },
  celulaSensor: {
    width: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    textAlign: 'right',
    fontSize: 13,
  },
  celulaTexto: { fontSize: 13, ...numeros },
  paginas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  pagina: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
