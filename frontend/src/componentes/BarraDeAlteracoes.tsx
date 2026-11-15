import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { Animated, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { Tema } from '../tema';
import { Botao } from './SensoresDaSala';
import { useMontagemAnimada } from './useMontagemAnimada';

const desfoque = Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px)' } as ViewStyle) : null;

/** Faixa que sobe do rodapé quando há o que salvar, e desce ao salvar ou descartar. */
export function BarraDeAlteracoes({
  aberta,
  salvando,
  aoDescartar,
  aoSalvar,
  tema,
}: {
  aberta: boolean;
  salvando: boolean;
  aoDescartar: () => void;
  aoSalvar: () => void;
  tema: Tema;
}) {
  const { montado, valor } = useMontagemAnimada(aberta, 480, 260);
  if (!montado) return null;
  return (
    <View pointerEvents="box-none" style={styles.faixa}>
      <Animated.View
        accessibilityRole="alert"
        style={[
          styles.barra,
          desfoque,
          {
            backgroundColor: tema.flutuante,
            borderColor: tema.borda,
            shadowColor: tema.sombra,
            opacity: valor,
            transform: [
              { translateY: valor.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) },
            ],
          },
        ]}
      >
        <Text style={[styles.texto, { color: tema.texto }]}>Alterações não salvas</Text>
        <Botao rotulo="Descartar" pequeno tema={tema} desligado={salvando} aoTocar={aoDescartar} />
        <Botao
          rotulo={salvando ? 'Salvando' : 'Salvar'}
          principal
          pequeno
          tema={tema}
          desligado={salvando}
          icone={salvando ? false : <CheckCircleIcon size={14} weight="fill" color={tema.fundo} />}
          aoTocar={aoSalvar}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' },
  barra: {
    maxWidth: '94%',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 20,
    paddingRight: 10,
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  texto: { fontSize: 14, marginRight: 4 },
});
