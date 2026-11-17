import { useRouter } from 'expo-router';
import { LockKeyIcon } from 'phosphor-react-native/src/icons/LockKey';
import { StyleSheet, Text, View } from 'react-native';
import type { Tema } from '../tema';
import { Botao } from './SensoresDaSala';
import { Vidro } from './Vidro';

/**
 * Tela ou área que o perfil não pode usar (US24, #99): diz o que é restrito, por quê e o
 * que fazer, e leva de volta ao painel. Fica dentro do próprio app, com a barra do topo,
 * em vez de jogar a pessoa numa página de erro.
 */
export function SemPermissao({
  tema,
  titulo,
  motivo,
}: {
  tema: Tema;
  titulo: string;
  motivo: string;
}) {
  const router = useRouter();
  return (
    <Vidro tema={tema} style={styles.painel}>
      <View style={[styles.selo, { backgroundColor: tema.vidroForte, borderColor: tema.borda }]}>
        <LockKeyIcon size={22} color={tema.texto2} />
      </View>
      <View style={styles.texto}>
        <Text style={[styles.titulo, { color: tema.texto }]} accessibilityRole="alert">
          {titulo}
        </Text>
        <Text style={[styles.motivo, { color: tema.texto2 }]}>{motivo}</Text>
        <Text style={[styles.ajuda, { color: tema.texto2 }]}>
          Precisa de acesso? Peça a um administrador do TermoLOG para ajustar o seu perfil.
        </Text>
      </View>
      <Botao rotulo="Voltar ao painel" principal tema={tema} aoTocar={() => router.replace('/')} />
    </Vidro>
  );
}

const styles = StyleSheet.create({
  painel: { gap: 18, padding: 28, alignItems: 'flex-start' },
  // Um selo discreto: o cadeado explica a restrição sem competir com o status das salas.
  selo: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { gap: 8, maxWidth: 520 },
  titulo: { fontSize: 20, fontWeight: '500', letterSpacing: -0.2, lineHeight: 26 },
  motivo: { fontSize: 15, lineHeight: 22 },
  ajuda: { fontSize: 13, lineHeight: 19, marginTop: 4 },
});
