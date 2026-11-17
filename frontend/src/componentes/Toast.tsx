import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { Tema } from '../tema';

const desfoque = Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px)' } as ViewStyle) : null;

export type Mensagem = { id: number; texto: string; desfazer?: () => void };

/** Aviso curto no rodapé depois de salvar, com "Desfazer" quando dá para voltar atrás. */
export function Toast({
  mensagem,
  tema,
  escuro,
  recuo = 0,
}: {
  mensagem: Mensagem | null;
  tema: Tema;
  escuro: boolean;
  /** Espaço à direita ocupado pela gaveta aberta: o aviso centraliza no que sobra. */
  recuo?: number;
}) {
  const [atual, setAtual] = useState(mensagem);
  const entrada = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!mensagem) return;
    setAtual(mensagem);
    entrada.setValue(0);
    Animated.timing(entrada, {
      toValue: 1,
      duration: 480,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start();
    const some = setTimeout(
      () => Animated.timing(entrada, { toValue: 0, duration: 260, useNativeDriver: false }).start(),
      6000,
    );
    return () => clearTimeout(some);
  }, [mensagem, entrada]);

  if (!atual) return null;
  return (
    <View pointerEvents="box-none" style={[styles.faixa, { right: recuo }]}>
      <Animated.View
        accessibilityRole="alert"
        pointerEvents="box-none"
        style={[
          styles.toast,
          desfoque,
          {
            backgroundColor: escuro ? 'rgba(24,27,31,0.9)' : 'rgba(246,247,249,0.94)',
            borderColor: tema.borda,
            opacity: entrada,
            transform: [
              { translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) },
            ],
          },
        ]}
      >
        <CheckCircleIcon size={18} weight="fill" color={tema.folga} />
        <Text style={[styles.texto, { color: tema.texto }]}>{atual.texto}</Text>
        {atual.desfazer && (
          <Pressable
            onPress={() => {
              atual.desfazer?.();
              Animated.timing(entrada, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
              }).start();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.botao,
              { borderColor: tema.borda, backgroundColor: tema.vidroForte },
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Text style={[styles.botaoTexto, { color: tema.texto }]}>Desfazer</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: { position: 'absolute', left: 0, bottom: 24, alignItems: 'center' },
  toast: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  texto: { fontSize: 14, flexShrink: 1 },
  botao: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  botaoTexto: { fontSize: 13, fontWeight: '600' },
});
