import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { Pressable, StyleSheet, Text } from 'react-native';
import { sair } from '../api';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';
import { useCelular } from '../useCelular';

/** Encerra a sessão. Em tela estreita fica só o ícone, como o link de gateways. */
export function BotaoSair({ tema, comTexto }: { tema: Tema; comTexto: boolean }) {
  const celular = useCelular();
  return (
    <Pressable
      onPress={() => sair()}
      accessibilityRole="button"
      accessibilityLabel="Sair"
      style={({ pressed }) => [
        styles.botao,
        celular && styles.botaoCelular,
        pressed && styles.apertado,
      ]}
    >
      <SignOutIcon size={comTexto ? 17 : 20} color={tema.texto2} />
      {comTexto && <Text style={[styles.texto, { color: tema.texto2 }]}>Sair</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  botao: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Alvo de toque no celular (#139).
  botaoCelular: { minHeight: ALVO_DE_TOQUE, minWidth: ALVO_DE_TOQUE },
  apertado: { transform: [{ scale: 0.96 }] },
  texto: { fontSize: 14 },
});
