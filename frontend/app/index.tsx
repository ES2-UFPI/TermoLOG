import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function Painel() {
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Painel</Text>
      <Link href="/health">Status da API</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  titulo: { fontSize: 24, fontWeight: 'bold' },
});
