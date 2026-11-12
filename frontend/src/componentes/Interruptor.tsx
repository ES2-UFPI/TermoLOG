import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet } from 'react-native';
import type { Tema } from '../tema';

const LARGURA = 46;
const ALTURA = 28;
const BOLA = 22;
const FOLGA = (ALTURA - BOLA) / 2;

/**
 * Chave de ligar e desligar (#118). A bola anda numa mola, com uma pequena sobra no fim, e a
 * trilha muda de cor junto. Com movimento reduzido, troca na hora.
 */
export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  tema,
  desligado,
}: {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  rotulo: string;
  tema: Tema;
  desligado?: boolean;
}) {
  const valor = useRef(new Animated.Value(ligado ? 1 : 0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir) return valor.setValue(ligado ? 1 : 0);
      Animated.spring(valor, {
        toValue: ligado ? 1 : 0,
        stiffness: 300,
        damping: 22,
        mass: 1,
        useNativeDriver: false,
      }).start();
    });
  }, [ligado, valor]);

  return (
    <Pressable
      onPress={() => aoMudar(!ligado)}
      disabled={desligado}
      accessibilityRole="switch"
      accessibilityLabel={rotulo}
      aria-checked={ligado}
      aria-disabled={!!desligado}
      // 28 px de alto na tela, 44 px para o toque.
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={({ pressed }) => [pressed && styles.pressionado, desligado && styles.apagado]}
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

/**
 * Abre e fecha o conteúdo com altura e opacidade no mesmo gesto, sem empurrar o que vem
 * abaixo de uma vez. Fechado, o conteúdo sai da árvore: os campos não ficam no Tab.
 */
export function Abrir({
  aberto,
  altura,
  children,
}: {
  aberto: boolean;
  /** Altura máxima do conteúdo aberto, em px. */
  altura: number;
  children: ReactNode;
}) {
  const valor = useRef(new Animated.Value(aberto ? 1 : 0)).current;
  const [montado, setMontado] = useState(aberto);
  useEffect(() => {
    if (aberto) setMontado(true);
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      const fim = () => !aberto && setMontado(false);
      if (reduzir) {
        valor.setValue(aberto ? 1 : 0);
        return fim();
      }
      Animated.timing(valor, {
        toValue: aberto ? 1 : 0,
        duration: aberto ? 380 : 240,
        easing: aberto ? Easing.bezier(0.16, 1, 0.3, 1) : Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: false,
      }).start(fim);
    });
  }, [aberto, valor]);

  if (!montado) return null;
  return (
    <Animated.View
      style={{
        overflow: 'hidden',
        opacity: valor,
        maxHeight: valor.interpolate({ inputRange: [0, 1], outputRange: [0, altura] }),
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
