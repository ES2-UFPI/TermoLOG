import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import { useMontagemAnimada } from './useMontagemAnimada';

/**
 * Abre e fecha o conteúdo com altura e opacidade no mesmo gesto, sem empurrar o que vem
 * abaixo de uma vez. Fechado, o conteúdo sai da árvore: os campos não ficam no Tab.
 */
export function Expansivel({
  aberto,
  altura,
  children,
}: {
  aberto: boolean;
  /** Altura máxima do conteúdo aberto, em px. */
  altura: number;
  children: ReactNode;
}) {
  const { montado, valor } = useMontagemAnimada(aberto, 380, 240);
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
