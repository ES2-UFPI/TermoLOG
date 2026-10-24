import { type ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/** Entrada curta (opacidade + 6 px), em cascata pela ordem. Sem animação se o sistema pedir. */
export function Surgir({
  ordem = 0,
  style,
  children,
}: {
  ordem?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const valor = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir) return valor.setValue(1);
      Animated.timing(valor, {
        toValue: 1,
        duration: 380,
        delay: ordem * 45,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: false,
      }).start();
    });
  }, [valor, ordem]);

  const subir = valor.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  return (
    <Animated.View style={[style, { opacity: valor, transform: [{ translateY: subir }] }]}>
      {children}
    </Animated.View>
  );
}
