import { useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { LeituraDoSensor, StatusDaSala } from '../api';
import {
  dominioDaRegua,
  folgaDaTemperatura,
  leituraPrincipal,
  limite,
  numero,
  quando,
} from '../painel';
import { niveisDosRotulos } from '../sala';
import type { Tema } from '../tema';
import { Surgir } from './Surgir';

/** Faixa em degradê sobre o trilho; aberta na ponta sem limite e sem faixa se não houver. */
function Trilho({
  inicio,
  fim,
  altura,
  espessura,
  apagada,
  tema,
}: {
  inicio: number | null;
  fim: number | null;
  altura: number;
  espessura: number;
  apagada?: boolean;
  tema: Tema;
}) {
  // O Stack deixa o painel montado por baixo: o id do degradê não pode repetir entre telas.
  const id = `faixa${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const meio = altura / 2;
  const temFaixa = inicio !== null || fim !== null;
  const de = inicio ?? 0;
  const ate = fim ?? 100;
  return (
    <Svg width="100%" height={altura}>
      <Defs>
        <LinearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor={tema.faixa[0]} />
          <Stop offset="1" stopColor={tema.faixa[1]} />
        </LinearGradient>
      </Defs>
      <Rect
        x="0"
        y={meio - espessura / 2}
        width="100%"
        height={espessura}
        rx={espessura / 2}
        fill={tema.trilho}
      />
      {temFaixa && (
        <Rect
          x={`${de}%`}
          y={meio - espessura / 2}
          width={`${ate - de}%`}
          height={espessura}
          rx={espessura / 2}
          fill={`url(#${id})`}
          opacity={apagada ? 0.4 : 1}
        />
      )}
    </Svg>
  );
}

/** Posição do ponto, deslizando até o valor novo quando a leitura muda. */
function usePosicao(alvo: number) {
  const valor = useRef(new Animated.Value(alvo)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir) return valor.setValue(alvo);
      Animated.timing(valor, {
        toValue: alvo,
        duration: 700,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: false,
      }).start();
    });
  }, [valor, alvo]);
  return valor.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });
}

/** Bolinha de uma leitura: cresce quando o sensor está em foco, sem animar se o sistema pedir. */
function Bolinha({
  raio,
  cor,
  emFoco,
  apagada,
  tema,
}: {
  raio: number;
  cor: string;
  emFoco: boolean;
  apagada?: boolean;
  tema: Tema;
}) {
  const foco = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir) return foco.setValue(emFoco ? 1 : 0);
      Animated.timing(foco, {
        toValue: emFoco ? 1 : 0,
        duration: 180,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: false,
      }).start();
    });
  }, [foco, emFoco]);
  return (
    <Animated.View
      style={{
        width: raio * 2,
        height: raio * 2,
        borderRadius: raio,
        backgroundColor: cor,
        borderWidth: 2,
        borderColor: tema.fundo,
        opacity: apagada ? 0.35 : 1,
        transform: [{ scale: foco.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
      }}
    />
  );
}

const LARGURA_DICA = 164;

/** Texto completo de um ponto da régua, para a dica e para o leitor de tela. */
const textoDoPonto = (l: LeituraDoSensor, fora: boolean) =>
  `Sensor ${l.sensor_id}: ${numero(l.temperatura)} °C, ${Math.round(l.umidade)}% de umidade, às ${quando(l.data_hora)}${fora ? ', fora da faixa' : ''}`;

/**
 * Régua do card: a faixa de temperatura com o ponto de cada sensor (#180). Passar o mouse,
 * focar pelo teclado ou tocar no ponto mostra de qual sensor ele é e a leitura.
 */
export function Regua({
  sala,
  tema,
  grossa,
}: {
  sala: StatusDaSala;
  tema: Tema;
  grossa?: boolean;
}) {
  const { temperatura_min: min, temperatura_max: max } = sala.faixa;
  const [largura, setLargura] = useState(0);
  const [ativo, setAtivo] = useState<number | null>(null);
  const altura = grossa ? 18 : 12;
  const espessura = grossa ? 6 : 4;

  if (min === null && max === null && sala.leituras.length === 0) {
    return (
      <Svg width="100%" height={altura}>
        <Line
          x1="0"
          y1={altura / 2}
          x2="100%"
          y2={altura / 2}
          stroke={tema.trilho}
          strokeWidth={espessura}
          strokeDasharray="2 6"
        />
      </Svg>
    );
  }

  const [lo, hi] = dominioDaRegua(
    min,
    max,
    sala.leituras.map((l) => l.temperatura),
  );
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const principal = leituraPrincipal(sala)?.sensor_id;
  const emDica = sala.leituras.find((l) => l.sensor_id === ativo);

  return (
    <View
      style={[styles.regua, { height: altura }]}
      onLayout={(e: LayoutChangeEvent) => setLargura(e.nativeEvent.layout.width)}
    >
      <Trilho
        inicio={min === null ? null : pos(min)}
        fim={max === null ? null : pos(max)}
        altura={altura}
        espessura={espessura}
        apagada={sala.leituras.length === 0}
        tema={tema}
      />
      {sala.leituras.map((l) => {
        const fora = (folgaDaTemperatura(l, sala.faixa)?.valor ?? 0) < 0;
        return (
          <PontoDoCard
            key={l.sensor_id}
            alvo={pos(l.temperatura)}
            raio={(grossa ? 6 : 4.5) + (l.sensor_id === principal ? 1 : 0)}
            cor={fora ? tema.alerta : tema.marca}
            rotulo={textoDoPonto(l, fora)}
            emFoco={ativo === l.sensor_id}
            altura={altura}
            tema={tema}
            aoFocar={(foco) => setAtivo((a) => (foco ? l.sensor_id : a === l.sensor_id ? null : a))}
            aoTocar={() => setAtivo((a) => (a === l.sensor_id ? null : l.sensor_id))}
          />
        );
      })}
      {emDica && (
        <Surgir
          style={[
            styles.dica,
            {
              bottom: altura + 8,
              // Centrada no ponto, mas sem passar da borda do card.
              left: Math.max(
                0,
                Math.min(
                  largura - LARGURA_DICA,
                  (pos(emDica.temperatura) / 100) * largura - LARGURA_DICA / 2,
                ),
              ),
              backgroundColor: tema.fundo,
              borderColor: tema.borda,
            },
          ]}
        >
          <Text style={[styles.dicaTitulo, { color: tema.texto }]}>Sensor {emDica.sensor_id}</Text>
          <Text style={[styles.dicaTexto, { color: tema.texto2 }]}>
            {numero(emDica.temperatura)} °C · {Math.round(emDica.umidade)}%
          </Text>
          <Text style={[styles.dicaTexto, { color: tema.texto2 }]}>
            às {quando(emDica.data_hora)}
          </Text>
        </Surgir>
      )}
    </View>
  );
}

function PontoDoCard({
  alvo,
  raio,
  cor,
  rotulo,
  emFoco,
  altura,
  tema,
  aoFocar,
  aoTocar,
}: {
  alvo: number;
  raio: number;
  cor: string;
  rotulo: string;
  emFoco: boolean;
  altura: number;
  tema: Tema;
  aoFocar: (foco: boolean) => void;
  aoTocar: () => void;
}) {
  const left = usePosicao(alvo);
  return (
    <Animated.View style={[styles.ancora, { left, top: altura / 2 }]}>
      <Pressable
        onPress={aoTocar}
        onHoverIn={() => aoFocar(true)}
        onHoverOut={() => aoFocar(false)}
        onFocus={() => aoFocar(true)}
        onBlur={() => aoFocar(false)}
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        style={styles.alvo}
      >
        <Bolinha raio={raio} cor={cor} emFoco={emFoco} tema={tema} />
      </Pressable>
    </Animated.View>
  );
}

export type PontoComparado = { id: number; valor: number; fora: boolean };

const ALTURA_NIVEL = 22;
const LARGURA_ROTULO = 84;
const ESPACO_ROTULO = 62;

/**
 * Régua da tela da sala: todos os sensores na mesma escala, cada um com o ID e o valor
 * escritos, para ver de uma vez quanto eles divergem e quem saiu da faixa (#180).
 */
export function ReguaComparada({
  titulo,
  unidade,
  sufixo,
  min,
  max,
  pontos,
  emFoco,
  aoFocar,
  tema,
}: {
  titulo: string;
  /** Unidade dos limites, ex. " °C". */
  unidade: string;
  /** Unidade curta do rótulo do ponto, ex. "°". */
  sufixo: string;
  min: number | null;
  max: number | null;
  pontos: PontoComparado[];
  emFoco: number | null;
  aoFocar: (id: number | null) => void;
  tema: Tema;
}) {
  const [largura, setLargura] = useState(0);
  const [lo, hi] = dominioDaRegua(
    min,
    max,
    pontos.map((p) => p.valor),
  );
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const px = (v: number) => (pos(v) / 100) * largura;
  const niveis = niveisDosRotulos(
    pontos.map((p) => px(p.valor)),
    ESPACO_ROTULO,
  );
  const topo = ALTURA_NIVEL * (Math.max(0, ...niveis) + 1) + 10;
  const juntos = min !== null && max !== null && px(max) - px(min) < 72;
  const descricao = `${titulo}: ${pontos
    .map((p) => `sensor ${p.id}, ${numero(p.valor)}${unidade}${p.fora ? ', fora da faixa' : ''}`)
    .join('; ')}`;

  return (
    <View style={styles.comparada}>
      <Text style={[styles.comparadaTitulo, { color: tema.texto2 }]}>{titulo}</Text>
      <View
        accessibilityRole="image"
        accessibilityLabel={descricao}
        style={[styles.comparadaArea, { paddingTop: topo }]}
        onLayout={(e: LayoutChangeEvent) => setLargura(e.nativeEvent.layout.width)}
      >
        <Trilho
          inicio={min === null ? null : pos(min)}
          fim={max === null ? null : pos(max)}
          altura={16}
          espessura={6}
          tema={tema}
        />
        {largura > 0 &&
          pontos.map((p, i) => (
            <PontoComRotulo
              key={p.id}
              ponto={p}
              alvo={pos(p.valor)}
              nivel={niveis[i]}
              topo={topo}
              sufixo={sufixo}
              emFoco={emFoco === p.id}
              apagado={emFoco !== null && emFoco !== p.id}
              aoFocar={aoFocar}
              tema={tema}
            />
          ))}
        <View style={styles.limites}>
          {largura > 0 && juntos && min !== null && max !== null && (
            <Limite x={(px(min) + px(max)) / 2} tema={tema}>
              {limite(min)} a {limite(max)}
              {unidade}
            </Limite>
          )}
          {largura > 0 && !juntos && min !== null && (
            <Limite x={px(min)} tema={tema}>
              mín {limite(min)}
              {unidade}
            </Limite>
          )}
          {largura > 0 && !juntos && max !== null && (
            <Limite x={px(max)} tema={tema}>
              máx {limite(max)}
              {unidade}
            </Limite>
          )}
        </View>
      </View>
    </View>
  );
}

function Limite({ x, tema, children }: { x: number; tema: Tema; children: React.ReactNode }) {
  return (
    <Text numberOfLines={1} style={[styles.limite, { left: x - 50, color: tema.texto2 }]}>
      {children}
    </Text>
  );
}

function PontoComRotulo({
  ponto,
  alvo,
  nivel,
  topo,
  sufixo,
  emFoco,
  apagado,
  aoFocar,
  tema,
}: {
  ponto: PontoComparado;
  alvo: number;
  nivel: number;
  topo: number;
  sufixo: string;
  emFoco: boolean;
  apagado: boolean;
  aoFocar: (id: number | null) => void;
  tema: Tema;
}) {
  const left = usePosicao(alvo);
  const cor = ponto.fora ? tema.alerta : tema.texto;
  const subida = 16 + nivel * ALTURA_NIVEL;
  return (
    <Animated.View style={[styles.ancora, { left, top: topo + 8 }]}>
      {nivel > 0 && (
        <View
          style={[
            styles.fio,
            {
              height: subida - 6,
              top: -(subida - 6),
              backgroundColor: ponto.fora ? tema.alerta : tema.texto2,
              opacity: apagado ? 0.15 : 0.45,
            },
          ]}
        />
      )}
      <Pressable
        focusable={false}
        onHoverIn={() => aoFocar(ponto.id)}
        onHoverOut={() => aoFocar(null)}
        style={[styles.rotulo, { top: -(subida + 12), opacity: apagado ? 0.35 : 1 }]}
      >
        <Text numberOfLines={1} style={styles.rotuloLinha}>
          <Text style={[styles.rotuloId, { color: tema.texto2 }]}>{ponto.id} </Text>
          <Text style={[styles.rotuloValor, { color: cor }]}>
            {numero(ponto.valor)}
            {sufixo}
          </Text>
        </Text>
      </Pressable>
      <Pressable
        focusable={false}
        onHoverIn={() => aoFocar(ponto.id)}
        onHoverOut={() => aoFocar(null)}
        style={styles.alvo}
      >
        <Bolinha
          raio={7}
          cor={ponto.fora ? tema.alerta : tema.marca}
          emFoco={emFoco}
          apagada={apagado}
          tema={tema}
        />
      </Pressable>
    </Animated.View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  regua: { width: '100%' },
  ancora: { position: 'absolute', width: 0, height: 0 },
  // Alvo de 24 px em volta do ponto, centrado na âncora de tamanho zero.
  alvo: {
    position: 'absolute',
    left: -12,
    top: -12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dica: {
    position: 'absolute',
    width: LARGURA_DICA,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 1,
  },
  dicaTitulo: { fontSize: 13, fontWeight: '600', ...numeros },
  dicaTexto: { fontSize: 12, ...numeros },
  comparada: { gap: 4 },
  comparadaTitulo: { fontSize: 13 },
  comparadaArea: { width: '100%', paddingBottom: 24 },
  limites: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18 },
  limite: { position: 'absolute', width: 100, textAlign: 'center', fontSize: 12, ...numeros },
  fio: { position: 'absolute', left: -0.5, width: 1 },
  rotulo: {
    position: 'absolute',
    left: -LARGURA_ROTULO / 2,
    width: LARGURA_ROTULO,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotuloLinha: { fontSize: 13 },
  rotuloId: { fontSize: 12, ...numeros },
  rotuloValor: { fontSize: 13, fontWeight: '600', ...numeros },
});
