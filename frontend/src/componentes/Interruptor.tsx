import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet } from 'react-native';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';

const LARGURA = 46;
const ALTURA = 28;
const BOLA = 22;
const FOLGA = (ALTURA - BOLA) / 2;
// Padding que leva a área de toque de 28 px até o alvo de 44 px.
const FOLGA_DO_TOQUE = (ALVO_DE_TOQUE - ALTURA) / 2;

/**
 * Chave de ligar e desligar (#118). A bola anda numa mola, com uma pequena sobra no fim, e a
 * trilha muda de cor junto. Com movimento reduzido, troca na hora.
 */
export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  tema,
  desabilitado,
}: {
  ligado: boolean;
  /** Pode faltar quando o interruptor está `desabilitado`: só mostra o estado. */
  aoMudar?: (ligado: boolean) => void;
  rotulo: string;
  tema: Tema;
  desabilitado?: boolean;
}) {
  const valor = useRef(new Animated.Value(ligado ? 1 : 0)).current;
  useEffect(() => {
    let vale = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (!vale) return;
      if (reduzir) return valor.setValue(ligado ? 1 : 0);
      Animated.spring(valor, {
        toValue: ligado ? 1 : 0,
        stiffness: 300,
        damping: 22,
        mass: 1,
        useNativeDriver: false,
      }).start();
    });
    return () => {
      vale = false;
    };
  }, [ligado, valor]);

  return (
    <Pressable
      onPress={() => aoMudar?.(!ligado)}
      disabled={desabilitado}
      accessibilityRole="switch"
      accessibilityLabel={rotulo}
      aria-checked={ligado}
      aria-disabled={!!desabilitado}
      // O hitSlop do React Native não existe na web: a área de 44 px vem do padding, e a
      // margem negativa devolve o espaço, para o desenho de 28 px não mudar o layout.
      style={({ pressed }) => [
        styles.area,
        pressed && styles.pressionado,
        desabilitado && styles.apagado,
      ]}
    >
      <Animated.View
        style={[
          styles.trilha,
          {
            backgroundColor: valor.interpolate({
              inputRange: [0, 1],
              outputRange: [tema.vidroForte, tema.folga],
            }),
            borderColor: valor.interpolate({
              inputRange: [0, 1],
              // Desligado, a borda é a do texto secundário: o controle precisa de 3:1 contra o fundo.
              outputRange: [tema.texto2, tema.folga],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.bola,
            {
              backgroundColor: ligado ? tema.fundo : tema.texto2,
              // A mola passa um pouco de 1: a bola vai além do fim e volta.
              transform: [
                {
                  translateX: valor.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, LARGURA - BOLA - FOLGA * 2 - 2],
                  }),
                },
              ],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: { paddingVertical: FOLGA_DO_TOQUE, marginVertical: -FOLGA_DO_TOQUE },
  trilha: {
    width: LARGURA,
    height: ALTURA,
    borderRadius: ALTURA / 2,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: FOLGA - 1,
  },
  bola: { width: BOLA, height: BOLA, borderRadius: BOLA / 2 },
  pressionado: { transform: [{ scale: 0.95 }] },
  apagado: { opacity: 0.45 },
});
