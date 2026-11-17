import { type ReactNode, useId } from 'react';
import { Platform, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
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

/** Único brilho do fundo: atrás da sala fora da faixa. Some quando tudo está ok. */
export function Brilho({ cor }: { cor: string }) {
  // O Stack deixa o painel montado por baixo: o id não pode repetir entre as telas.
  const id = `brilho${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={styles.brilho} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={cor} />
            <Stop offset="1" stopColor={cor} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  vidro: { borderWidth: 1, borderRadius: 26, padding: 22, overflow: 'hidden' },
  brilho: { position: 'absolute', left: -240, top: -220, right: -240, bottom: -220 },
});
