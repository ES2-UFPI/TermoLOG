import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';
import type { Tema } from '../tema';

/** Ponto que respira enquanto a tela espera algo (parado com movimento reduzido). */
export function Pulso({ tema }: { tema: Tema }) {
  const valor = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let laco: Animated.CompositeAnimation | null = null;
    let vale = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir || !vale) return;
      const passo = (toValue: number) =>
        Animated.timing(valor, {
          toValue,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        });
      laco = Animated.loop(Animated.sequence([passo(0.3), passo(1)]));
      laco.start();
    });
    return () => {
      vale = false;
      laco?.stop();
    };
  }, [valor]);
  return <Animated.View style={[styles.ponto, { backgroundColor: tema.folga, opacity: valor }]} />;
}

const styles = StyleSheet.create({
  ponto: { width: 8, height: 8, borderRadius: 4 },
});
