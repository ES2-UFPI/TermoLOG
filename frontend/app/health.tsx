import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getHealth } from '../src/api';
import { Vidro } from '../src/componentes/Vidro';
import { useTema } from '../src/useTema';

export default function Health() {
  const { tema } = useTema();
  const [status, setStatus] = useState('Carregando...');

  useEffect(() => {
    getHealth()
      .then((dados) => setStatus(JSON.stringify(dados)))
      .catch((erro) => setStatus(`Falha ao conectar na API: ${erro.message}`));
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ title: 'Status da API | TermoLOG' }} />
      <Vidro tema={tema} style={styles.painel}>
        <Text style={[styles.titulo, { color: tema.texto }]} accessibilityRole="header">
          Status da API
        </Text>
        <Text style={{ color: tema.texto2 }}>{status}</Text>
      </Vidro>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  painel: { gap: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  titulo: { fontSize: 24, fontWeight: '500', letterSpacing: -0.3 },
});
