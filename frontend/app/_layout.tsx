import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { assinarSessao, registrarUso, tokenAtual } from '../src/api';
import { BarraDoPainel } from '../src/componentes/BarraDoPainel';
import { useTema } from '../src/useTema';

export default function Layout() {
  const logado = useSyncExternalStore(assinarSessao, tokenAtual) !== null;
  const { tema } = useTema();

  // Clique e tecla contam como uso; a busca automática de 30 s do painel, não. Sem isso a
  // sessão nunca venceria com a aba aberta, porque cada busca a renova no backend.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const usar = () => registrarUso();
    usar();
    document.addEventListener('pointerdown', usar, true);
    document.addEventListener('keydown', usar, true);
    return () => {
      document.removeEventListener('pointerdown', usar, true);
      document.removeEventListener('keydown', usar, true);
    };
  }, []);

  // O Stack.Protected já escolhe a tela certa, mas ao abrir um endereço direto a URL ficaria
  // parada nele: a barra de endereços acompanha.
  const router = useRouter();
  const rota = usePathname();
  useEffect(() => {
    const naTelaDeLogin = rota === '/login' && globalThis.location?.pathname === '/login';
    if (!logado && !naTelaDeLogin) router.replace('/login');
    if (logado && globalThis.location?.pathname === '/login') router.replace('/');
  }, [logado, rota, router]);

  return (
    <View style={{ flex: 1, backgroundColor: tema.fundo }}>
      {/* Uma barra só, acima das telas, para ela não ser refeita a cada navegação (#185). */}
      {logado && <BarraDoPainel />}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ title: 'TermoLOG', headerShown: false }}>
          <Stack.Protected guard={logado}>
            <Stack.Screen name="index" />
            <Stack.Screen name="sala/[id]" />
            <Stack.Screen name="gateways" />
            <Stack.Screen name="relatorios" />
            <Stack.Screen name="perfil" />
            <Stack.Screen name="health" />
          </Stack.Protected>
          <Stack.Protected guard={!logado}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </View>
    </View>
  );
}
