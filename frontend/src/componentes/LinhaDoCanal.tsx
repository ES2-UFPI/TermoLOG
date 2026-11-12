import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Tema } from '../tema';

/** Uma linha da lista de canais: ícone, nome, descrição, o controle à direita e, abaixo, o que abre. */
export function LinhaDoCanal({
  icone,
  titulo,
  descricao,
  direita,
  children,
  ultima,
  tema,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
  direita: ReactNode;
  children?: ReactNode;
  ultima?: boolean;
  tema: Tema;
}) {
  return (
    <View
      style={[styles.linha, !ultima && { borderBottomColor: tema.trilho, borderBottomWidth: 1 }]}
    >
      <View style={styles.topo}>
        <View style={[styles.icone, { backgroundColor: tema.vidroForte, borderColor: tema.borda }]}>
          {icone}
        </View>
        <View style={styles.texto}>
          <Text style={[styles.titulo, { color: tema.texto }]}>{titulo}</Text>
          <Text style={[styles.descricao, { color: tema.texto2 }]}>{descricao}</Text>
        </View>
        {direita}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { paddingHorizontal: 22, paddingVertical: 16, gap: 12 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  texto: { flex: 1, minWidth: 0, gap: 2 },
  titulo: { fontSize: 16, fontWeight: '500', letterSpacing: -0.1 },
  descricao: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  icone: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
