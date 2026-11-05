import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewProps,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Faixa } from '../api';
import {
  CALOR,
  chave,
  corDaTemperatura,
  formatar,
  GRANDEZAS,
  type Grandeza,
  type Lado,
  lerNumero,
  marcas,
} from '../faixa';
import { numero } from '../painel';
import type { Tema } from '../tema';

// Mola das alças e da faixa quando o valor muda por clique, teclado ou digitação.
// Arrastando, elas seguem o ponteiro sem mola.
const mola = (valor: Animated.Value, para: number) =>
  Animated.spring(valor, { toValue: para, friction: 7, tension: 90, useNativeDriver: false });

const ALCA = 28;

type Props = {
  g: Grandeza;
  faixa: Faixa;
  dominio: [number, number];
  /** Leitura atual da sala nesta grandeza; null em sala nova ou sem leitura. */
  atual: number | null;
  tema: Tema;
  escuro: boolean;
  altura: number;
  erro?: string;
  /** Alça arrastada, teclado ou chave: o pai aplica o passo e a ordem mínimo < máximo. */
  aoArrastar: (lado: Lado, valor: number) => void;
  /** Valor digitado: vale como foi escrito (null = sem limite). */
  aoDigitar: (lado: Lado, valor: number | null) => void;
  aoLigar: (lado: Lado) => void;
};

/**
 * Termômetro vertical: escala graduada, a faixa colorida entre duas alças e o valor de cada
 * limite ao lado, editável. A linha "agora" mostra onde está a leitura atual da sala.
 */
export function Termometro({
  g,
  faixa,
  dominio: [lo, hi],
  atual,
  tema,
  escuro,
  altura,
  erro,
  aoArrastar,
  aoDigitar,
  aoLigar,
}: Props) {
  const G = GRANDEZAS[g];
  const min = faixa[chave(g, 'min')];
  const max = faixa[chave(g, 'max')];
  // Posição na escala em % a partir do topo (o máximo fica em cima).
  const pct = (v: number) => (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;
  const posMax = max === null ? 0 : pct(max);
  const posMin = min === null ? 100 : pct(min);

  // arrastado: alça que segue o ponteiro; arrastando: a que já não usa mola (após o 1º pulo).
  const arrastado = useRef<Lado | null>(null);
  const arrastando = useRef<Lado | null>(null);
  const anim = useRef({ max: new Animated.Value(posMax), min: new Animated.Value(posMin) }).current;
  useEffect(() => {
    for (const [lado, pos] of [
      ['max', posMax],
      ['min', posMin],
    ] as const) {
      if (arrastando.current === lado) anim[lado].setValue(pos);
      else mola(anim[lado], pos).start();
    }
  }, [posMax, posMin, anim]);

  // Os rótulos acompanham as alças, mas não se sobrepõem quando elas ficam perto.
  let rotMax = max === null ? 6 : posMax;
  let rotMin = min === null ? 94 : posMin;
  const distancia = (44 / altura) * 100;
  if (rotMin - rotMax < distancia) {
    const meio = (rotMin + rotMax) / 2;
    rotMax = meio - distancia / 2;
    rotMin = meio + distancia / 2;
  }
  // O rótulo sobe 22 px acima da alça: no topo da escala, desce o bastante para não cobrir
  // o nome da grandeza no cabeçalho.
  const folgaDoTopo = (22 / altura) * 100;
  if (rotMax < folgaDoTopo) {
    rotMin += folgaDoTopo - rotMax;
    rotMax = folgaDoTopo;
  }

  // Valor do ponteiro a partir da posição dentro do tubo.
  const valorEm = (y: number) => hi - (Math.min(altura, Math.max(0, y)) / altura) * (hi - lo);
  const inicio = useRef(0);
  const ultimos = useRef({ min, max, aoArrastar, valorEm });
  ultimos.current = { min, max, aoArrastar, valorEm };
  const gesto = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { min, max, aoArrastar, valorEm } = ultimos.current;
          inicio.current = e.nativeEvent.locationY;
          const v = valorEm(inicio.current);
          // Clique no tubo move a alça mais perto (ou liga o lado que estava sem limite).
          const lado: Lado =
            min === null && max === null
              ? v > (lo + hi) / 2
                ? 'max'
                : 'min'
              : min === null
                ? v < (max as number)
                  ? 'min'
                  : 'max'
                : max === null
                  ? v > min
                    ? 'max'
                    : 'min'
                  : Math.abs(v - min) < Math.abs(v - max)
                    ? 'min'
                    : 'max';
          arrastado.current = lado;
          aoArrastar(lado, v);
          // O primeiro pulo vai com mola; dali em diante a alça segue o ponteiro.
          setTimeout(() => {
            if (arrastado.current === lado) arrastando.current = lado;
          }, 120);
        },
        onPanResponderMove: (_e, gs) => {
          const lado = arrastado.current;
          if (lado)
            ultimos.current.aoArrastar(lado, ultimos.current.valorEm(inicio.current + gs.dy));
        },
        onPanResponderRelease: () => {
          arrastado.current = null;
          arrastando.current = null;
        },
        onPanResponderTerminate: () => {
          arrastado.current = null;
          arrastando.current = null;
        },
      }),
    [lo, hi],
  );

  // Temperatura usa a escala de calor (do mínimo ao máximo); umidade, o degradê da marca.
  const cores =
    g === 'temperatura'
      ? (() => {
          const paleta = escuro ? CALOR.escuro : CALOR.claro;
          const de = min ?? lo;
          const ate = max ?? hi;
          return [
            corDaTemperatura(de, paleta),
            corDaTemperatura((de + ate) / 2, paleta),
            corDaTemperatura(ate, paleta),
          ];
        })()
      : [tema.faixa[0], tema.faixa[1], tema.faixa[1]];
  const semLimite = min === null && max === null;
  const foraAgora =
    atual !== null && ((min !== null && atual < min) || (max !== null && atual > max));
  const corAgora = foraAgora ? tema.alerta : tema.marca;
  const valorAgora =
    atual === null ? null : g === 'umidade' ? `${Math.round(atual)}%` : `${numero(atual)} °C`;

  const topo = anim.max.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  const base = anim.min.interpolate({ inputRange: [0, 100], outputRange: ['100%', '0%'] });

  return (
    <View
      style={[
        styles.termo,
        { backgroundColor: tema.vidroForte, borderColor: erro ? tema.alerta : tema.borda },
      ]}
      accessibilityLabel={G.nome}
    >
      <View style={styles.cabecalho}>
        <Text style={[styles.nome, { color: tema.texto2 }]}>{G.nome}</Text>
        {valorAgora && (
          <View style={styles.agora}>
            <View style={[styles.bolinha, { backgroundColor: corAgora }]} />
            <Text style={[styles.pequeno, { color: foraAgora ? tema.alerta : tema.texto2 }]}>
              agora {valorAgora}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.escala, { height: altura }]}>
        <View style={styles.marcas}>
          {marcas([lo, hi]).map((m) => (
            <View key={m.valor} style={[styles.marca, { top: `${pct(m.valor)}%` }]}>
              {m.maior && (
                <Text style={[styles.marcaTexto, { color: tema.texto2 }]}>
                  {formatar(m.valor, 0)}
                </Text>
              )}
              <View
                style={[
                  styles.risco,
                  {
                    width: m.maior ? 4 : 2,
                    backgroundColor: tema.texto2,
                    opacity: m.maior ? 0.6 : 0.35,
                  },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={[styles.tubo, { backgroundColor: tema.trilho }]}>
          <Animated.View
            style={[
              styles.preenchimento,
              { top: topo, bottom: base, opacity: semLimite ? 0.25 : 1 },
              max === null && styles.semTopo,
              min === null && styles.semBase,
            ]}
          >
            <Svg width="100%" height="100%" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id={`tubo-${g}`} x1="0" y1="1" x2="0" y2="0">
                  <Stop offset="0" stopColor={cores[0]} stopOpacity={min === null ? 0 : 1} />
                  <Stop offset={min === null ? '0.3' : '0'} stopColor={cores[0]} />
                  <Stop offset="0.5" stopColor={cores[1]} />
                  <Stop offset={max === null ? '0.7' : '1'} stopColor={cores[2]} />
                  <Stop offset="1" stopColor={cores[2]} stopOpacity={max === null ? 0 : 1} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill={`url(#tubo-${g})`} />
            </Svg>
          </Animated.View>
          {atual !== null && (
            <View
              pointerEvents="none"
              style={[
                styles.linhaAgora,
                { top: `${pct(atual)}%`, backgroundColor: corAgora, borderColor: tema.fundo },
              ]}
            />
          )}
          {(['max', 'min'] as const).map((lado) => {
            const valor = lado === 'max' ? max : min;
            return (
              <Animated.View
                key={lado}
                pointerEvents="none"
                style={[
                  styles.alca,
                  {
                    top: (lado === 'max' ? anim.max : anim.min).interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                    backgroundColor: tema.fundo,
                    borderColor: tema.marca,
                    opacity: valor === null ? 0 : 1,
                  },
                ]}
              >
                <View style={[styles.miolo, { backgroundColor: tema.marca }]} />
              </Animated.View>
            );
          })}
          {/* Camada de toque por cima do tubo e das alças: arrastar ou clicar. */}
          <View
            {...gesto.panHandlers}
            style={styles.toque}
            accessibilityRole="adjustable"
            accessibilityLabel={`${G.nome}: arraste para ajustar a faixa`}
          />
        </View>

        <View style={styles.rotulos}>
          {(['max', 'min'] as const).map((lado) => (
            <Rotulo
              key={lado}
              g={g}
              lado={lado}
              valor={lado === 'max' ? max : min}
              top={lado === 'max' ? rotMax : rotMin}
              tema={tema}
              aoArrastar={aoArrastar}
              aoDigitar={aoDigitar}
            />
          ))}
        </View>
      </View>

      <View style={styles.chaves}>
        {(['min', 'max'] as const).map((lado) => {
          const ligado = (lado === 'min' ? min : max) !== null;
          const nome = lado === 'min' ? 'mínimo' : 'máximo';
          const Icone = ligado ? CheckIcon : PlusIcon;
          return (
            <Pressable
              key={lado}
              onPress={() => (ligado ? aoDigitar(lado, null) : aoLigar(lado))}
              accessibilityRole="switch"
              accessibilityState={{ checked: ligado }}
              aria-checked={ligado}
              accessibilityLabel={`${G.nome} ${nome}`}
              style={({ pressed }) => [
                styles.chave,
                {
                  borderColor: ligado ? `${tema.folga}66` : tema.borda,
                  borderStyle: ligado ? 'solid' : 'dashed',
                  backgroundColor: ligado ? tema.vidroForte : 'transparent',
                },
                pressed && styles.pressionado,
              ]}
            >
              <Icone size={14} color={ligado ? tema.folga : tema.texto2} />
              <Text
                numberOfLines={1}
                style={[styles.pequeno, { color: ligado ? tema.texto : tema.texto2 }]}
              >
                {ligado ? nome[0].toUpperCase() + nome.slice(1) : `Sem ${nome}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {erro && <Text style={[styles.pequeno, { color: tema.alerta }]}>{erro}</Text>}
    </View>
  );
}

/** Valor de um limite ao lado da alça: dá para digitar, e setas ajustam pelo teclado. */
function Rotulo({
  g,
  lado,
  valor,
  top,
  tema,
  aoArrastar,
  aoDigitar,
}: {
  g: Grandeza;
  lado: Lado;
  valor: number | null;
  top: number;
  tema: Tema;
  aoArrastar: (lado: Lado, valor: number) => void;
  aoDigitar: (lado: Lado, valor: number | null) => void;
}) {
  const G = GRANDEZAS[g];
  const nome = lado === 'min' ? 'mínimo' : 'máximo';
  const [texto, setTexto] = useState<string | null>(null); // null = não está editando
  const posicao = useRef(new Animated.Value(top)).current;
  useEffect(() => {
    mola(posicao, top).start();
  }, [top, posicao]);
  const mostrado = texto ?? (valor === null ? `sem ${nome}` : formatar(valor, G.casas));

  // Setas no navegador: passo; com Shift, 4 passos.
  const teclado = {
    onKeyDown: (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
      if (valor === null || texto !== null) return;
      const d = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (!d) return;
      e.preventDefault();
      aoArrastar(lado, valor + d * G.passo * (e.shiftKey ? 4 : 1));
    },
  } as unknown as ViewProps;

  return (
    <Animated.View
      style={[
        styles.rotulo,
        { top: posicao.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
      ]}
    >
      {valor !== null && <Text style={[styles.rotuloNome, { color: tema.texto2 }]}>{nome}</Text>}
      <View style={styles.linhaValor} {...teclado}>
        <TextInput
          value={mostrado}
          onFocus={() => setTexto(valor === null ? '' : formatar(valor, G.casas))}
          onChangeText={setTexto}
          onBlur={() => {
            if (texto !== null) aoDigitar(lado, lerNumero(texto));
            setTexto(null);
          }}
          onSubmitEditing={() => {
            if (texto !== null) aoDigitar(lado, lerNumero(texto));
            setTexto(null);
          }}
          inputMode="decimal"
          selectTextOnFocus
          accessibilityLabel={`${G.nome} ${nome}`}
          style={[
            valor === null && texto === null ? styles.valorVazio : styles.valor,
            { color: valor === null && texto === null ? tema.texto2 : tema.texto },
            // Largura pelo texto, para a unidade ficar colada ao número.
            {
              width: Math.max(2, mostrado.length) * (valor === null && texto === null ? 8 : 15) + 6,
            },
          ]}
        />
        {(valor !== null || texto !== null) && (
          <Text style={[styles.unidade, { color: tema.texto2 }]}>{G.unidade}</Text>
        )}
      </View>
    </Animated.View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  termo: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    paddingTop: 16,
    gap: 10,
  },
  cabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  nome: { fontSize: 13 },
  agora: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bolinha: { width: 8, height: 8, borderRadius: 4 },
  pequeno: { fontSize: 12, ...numeros },
  escala: { flexDirection: 'row', gap: 10 },
  marcas: { width: 30 },
  marca: {
    position: 'absolute',
    right: -6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    transform: [{ translateY: -7 }],
    height: 14,
  },
  marcaTexto: { fontSize: 11, ...numeros },
  risco: { height: 1 },
  tubo: { width: 18, borderRadius: 999 },
  preenchimento: { position: 'absolute', left: 0, right: 0, borderRadius: 999, overflow: 'hidden' },
  semTopo: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  semBase: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  linhaAgora: {
    position: 'absolute',
    left: -6,
    right: -6,
    height: 4,
    marginTop: -2,
    borderRadius: 2,
    borderWidth: 1,
  },
  alca: {
    position: 'absolute',
    left: 9 - ALCA / 2,
    width: ALCA,
    height: ALCA,
    marginTop: -ALCA / 2,
    borderRadius: ALCA / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  miolo: { width: 8, height: 8, borderRadius: 4 },
  toque: {
    position: 'absolute',
    top: -ALCA / 2,
    bottom: -ALCA / 2,
    left: -8,
    right: -8,
    cursor: 'grab',
  } as object,
  rotulos: { flex: 1, minWidth: 0 },
  rotulo: { position: 'absolute', left: 0, right: 0, transform: [{ translateY: -22 }] },
  rotuloNome: { fontSize: 11, height: 14 },
  linhaValor: { flexDirection: 'row', alignItems: 'baseline' },
  valor: { fontSize: 26, fontWeight: '300', letterSpacing: -1, padding: 0, ...numeros },
  valorVazio: { fontSize: 15, padding: 0, marginTop: 6 },
  unidade: { fontSize: 13, marginLeft: 4 },
  chaves: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chave: {
    flexGrow: 1,
    flexBasis: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  pressionado: { transform: [{ scale: 0.97 }] },
});
