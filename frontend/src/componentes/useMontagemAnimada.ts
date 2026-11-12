import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Entrada e saída de um bloco que aparece e some (campo que abre, faixa que sobe). Devolve
 * `montado`, que só fica falso depois de a saída terminar (o bloco sai da árvore e dos
 * campos do Tab), e `valor`, de 0 a 1, para a tela interpolar. Com movimento reduzido, troca
 * na hora.
 */
export function useMontagemAnimada(aberto: boolean, entrada: number, saida: number) {
  const valor = useRef(new Animated.Value(aberto ? 1 : 0)).current;
  const [montado, setMontado] = useState(aberto);

  useEffect(() => {
    // Evita agir depois do cleanup: a pessoa abriu e fechou antes de o sistema responder.
    let vale = true;
    if (aberto) setMontado(true);
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (!vale) return;
      if (reduzir) {
        valor.setValue(aberto ? 1 : 0);
        if (!aberto) setMontado(false);
        return;
      }
      Animated.timing(valor, {
        toValue: aberto ? 1 : 0,
        duration: aberto ? entrada : saida,
        easing: aberto ? Easing.bezier(0.16, 1, 0.3, 1) : Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: false,
        // Uma animação interrompida (fechou e reabriu) chega aqui com finished falso: só a que
        // terminou de fechar tira o bloco da árvore.
      }).start(({ finished }) => {
        if (finished && !aberto) setMontado(false);
      });
    });
    return () => {
      vale = false;
    };
  }, [aberto, valor, entrada, saida]);

  return { montado, valor };
}
