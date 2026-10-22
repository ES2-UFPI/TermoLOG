import { MoonIcon } from 'phosphor-react-native/src/icons/Moon';
import { SunIcon } from 'phosphor-react-native/src/icons/Sun';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Animated, Platform, Pressable, StyleSheet } from 'react-native';
import type { Tema } from '../tema';

// O tema novo entra como água pela diagonal: a página nova aparece dentro de uma máscara 2x
// maior que a tela, com uma borda em onda ao longo da diagonal, que desliza sobre a tela.
// Ligando o escuro, sobe do canto inferior esquerdo; desligando, volta do superior direito.
// Usa a View Transitions API do navegador.
function mascara(cheio: 'abaixo' | 'acima') {
  const pontos = [];
  for (let t = -30; t <= 330; t += 6) {
    const onda = 7 * Math.sin((t / 50) * 2 * Math.PI);
    pontos.push(`${(t + onda).toFixed(1)},${(t - onda).toFixed(1)}`);
  }
  // Fecha pelo canto inferior esquerdo (água abaixo da diagonal) ou superior direito (acima).
  const canto = cheio === 'abaixo' ? '-30,330' : '330,-30';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300' preserveAspectRatio='none'><polygon points='${pontos.join(' ')} ${canto}' fill='white'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / 200% 200% no-repeat`;
}

const CSS_DA_AGUA = `
::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
:root[data-agua]::view-transition-new(root) { animation: 1150ms cubic-bezier(.55,.05,.35,1) forwards; }
:root[data-agua='sobe']::view-transition-new(root) { -webkit-mask: ${mascara('abaixo')}; mask: ${mascara('abaixo')}; animation-name: termolog-sobe; }
:root[data-agua='volta']::view-transition-new(root) { -webkit-mask: ${mascara('acima')}; mask: ${mascara('acima')}; animation-name: termolog-volta; }
@keyframes termolog-sobe {
  from { -webkit-mask-position: 100% 0%; mask-position: 100% 0%; }
  to { -webkit-mask-position: 0% 100%; mask-position: 0% 100%; }
}
@keyframes termolog-volta {
  from { -webkit-mask-position: 0% 100%; mask-position: 0% 100%; }
  to { -webkit-mask-position: 100% 0%; mask-position: 100% 0%; }
}`;

type DocumentoComTransicao = Document & {
  startViewTransition?: (atualizar: () => void) => { finished: Promise<void> };
};

/** Troca o tema com a água na diagonal; sem suporte ou com movimento reduzido, troca na hora. */
export function trocarComAgua(paraEscuro: boolean, aplicar: () => void) {
  const doc = Platform.OS === 'web' ? (document as DocumentoComTransicao) : null;
  const reduzir = doc && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc?.startViewTransition || reduzir) return aplicar();
  if (!doc.getElementById('termolog-agua')) {
    const estilo = doc.createElement('style');
    estilo.id = 'termolog-agua';
    estilo.textContent = CSS_DA_AGUA;
    doc.head.append(estilo);
  }
  const raiz = doc.documentElement;
  raiz.dataset.agua = paraEscuro ? 'sobe' : 'volta';
  // flushSync aplica o tema novo no DOM antes da captura da transição.
  const transicao = doc.startViewTransition(() => flushSync(aplicar));
  transicao.finished.finally(() => delete raiz.dataset.agua);
}

/**
 * Pílula de vidro com sol e lua: um seletor translúcido desliza com mola até o ícone ativo,
 * que acende enquanto o outro apaga.
 */
export function BotaoTema({
  escuro,
  aoTrocar,
  tema,
}: {
  escuro: boolean;
  aoTrocar: () => void;
  tema: Tema;
}) {
  const noite = useRef(new Animated.Value(escuro ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(noite, {
      toValue: escuro ? 1 : 0,
      friction: 8,
      tension: 70,
      useNativeDriver: false,
    }).start();
  }, [escuro, noite]);

  const deslizar = noite.interpolate({ inputRange: [0, 1], outputRange: [0, 34] });
  const opacidade = (ativoDeNoite: boolean) =>
    noite.interpolate({ inputRange: [0, 1], outputRange: ativoDeNoite ? [0.45, 1] : [1, 0.45] });

  return (
    <Pressable
      onPress={aoTrocar}
      accessibilityRole="switch"
      accessibilityState={{ checked: escuro }}
      accessibilityLabel="Tema escuro"
      style={({ pressed }) => [
        styles.trilho,
        { backgroundColor: tema.vidroForte, borderColor: tema.borda },
        pressed && styles.pressionado,
      ]}
    >
      <Animated.View
        style={[
          styles.seletor,
          {
            backgroundColor: escuro ? 'rgba(255,255,255,0.14)' : '#ffffff',
            borderColor: tema.borda,
            transform: [{ translateX: deslizar }],
          },
        ]}
      />
      <Animated.View style={[styles.icone, { opacity: opacidade(false) }]}>
        <SunIcon size={16} weight={escuro ? 'light' : 'fill'} color={tema.texto} />
      </Animated.View>
      <Animated.View style={[styles.icone, { opacity: opacidade(true) }]}>
        <MoonIcon size={15} weight={escuro ? 'fill' : 'light'} color={tema.texto} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trilho: {
    width: 72,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  pressionado: { transform: [{ scale: 0.96 }] },
  seletor: {
    position: 'absolute',
    left: 3,
    width: 32,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  icone: { width: 32, height: 30, alignItems: 'center', justifyContent: 'center' },
});
