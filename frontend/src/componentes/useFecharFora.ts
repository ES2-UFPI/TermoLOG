import { type RefObject, useEffect } from 'react';
import type { View } from 'react-native';

/** Fecha o que está aberto com Esc ou com um clique fora da caixa. */
export function useFecharFora(aberto: boolean, caixa: RefObject<View | null>, fechar: () => void) {
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    const fora = (e: PointerEvent) => {
      const elemento = caixa.current as unknown as HTMLElement | null;
      if (!elemento?.contains(e.target as Node)) fechar();
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('pointerdown', fora);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('pointerdown', fora);
    };
  }, [aberto, caixa, fechar]);
}
