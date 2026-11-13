import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { Pressable, StyleSheet, Text } from 'react-native';
import { sair } from '../api';
import type { Tema } from '../tema';

/** Encerra a sessão. Em tela estreita fica só o ícone, como o link de gateways. */
export function BotaoSair({ tema, comTexto }: { tema: Tema; comTexto: boolean }) {
  return (
    <Pressable
      onPress={() => sair()}
      accessibilityRole="button"
      accessibilityLabel="Sair"
      style={({ pressed }) => [styles.botao, pressed && styles.apertado]}
    >
      <SignOutIcon size={comTexto ? 17 : 20} color={tema.texto2} />
      {comTexto && <Text style={[styles.texto, { color: tema.texto2 }]}>Sair</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44 px de alto: alvo de toque no celular (#139).
  botao: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44 },
  apertado: { transform: [{ scale: 0.96 }] },
  texto: { fontSize: 14 },
});
