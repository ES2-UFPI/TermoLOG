import type { ReactNode } from 'react';
import { Platform, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { StatusDaSala } from '../api';
import { dominio, folgaDaTemperatura } from '../painel';
import type { Tema } from '../tema';
import { Surgir } from './Surgir';

// Desfoque do que está atrás do painel; só existe no navegador.
const desfoque = Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px)' } as ViewStyle) : null;

/** Painel de vidro: translúcido, borda fina e cantos de 26 px. Entra em cascata pela ordem. */
export function Vidro({
  tema,
  ordem,
  style,
  children,
}: {
  tema: Tema;
  ordem?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Surgir
      ordem={ordem}
      style={[
        styles.vidro,
        desfoque,
        { backgroundColor: tema.vidro, borderColor: tema.borda },
        style,
      ]}
    >
      {children}
    </Surgir>
  );
}

/** Faixa de temperatura (degradê) com o ponto de cada leitura; aberta na ponta sem limite. */
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
  const altura = grossa ? 18 : 12;
  const meio = altura / 2;
  const espessura = grossa ? 6 : 4;
  if (min === null && max === null) {
    return (
      <Svg width="100%" height={altura}>
        <Line
          x1="0"
          y1={meio}
          x2="100%"
          y2={meio}
          stroke={tema.trilho}
          strokeWidth={espessura}
          strokeDasharray="2 6"
        />
      </Svg>
    );
  }
  const [lo, hi] = dominio(
    sala.faixa,
    sala.leituras.map((l) => l.temperatura),
  );
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const x = (v: number) => `${pos(v).toFixed(2)}%`;
  const inicio = min === null ? 0 : pos(min);
  const fim = max === null ? 100 : pos(max);

  return (
    <Svg width="100%" height={altura}>
      <Defs>
        <LinearGradient id={`faixa-${sala.sala_id}`} x1="0" x2="1" y1="0" y2="0">
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
      <Rect
        x={`${inicio}%`}
        y={meio - espessura / 2}
        width={`${fim - inicio}%`}
        height={espessura}
        rx={espessura / 2}
        fill={`url(#faixa-${sala.sala_id})`}
        opacity={sala.leituras.length ? 1 : 0.4}
      />
      {sala.leituras.map((l) => {
        const fora = (folgaDaTemperatura(l, sala.faixa)?.valor ?? 0) < 0;
        return (
          <Circle
            key={l.sensor_id}
            cx={x(l.temperatura)}
            cy={meio}
            r={grossa ? 6 : 4.5}
            fill={fora ? tema.alerta : tema.marca}
            stroke={tema.fundo}
            strokeWidth={2}
          />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  vidro: { borderWidth: 1, borderRadius: 26, padding: 22, overflow: 'hidden' },
});
