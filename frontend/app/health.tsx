import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getHealth } from '../src/api';

export default function Health() {
  const [status, setStatus] = useState('Carregando...');

  useEffect(() => {
    getHealth()
      .then((dados) => setStatus(JSON.stringify(dados)))
      .catch((erro) => setStatus(`Falha ao conectar na API: ${erro.message}`));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Status da API</Text>
      <Text>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  titulo: { fontSize: 24, fontWeight: 'bold' },
});
