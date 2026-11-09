import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { assinarSessao, registrarUso, tokenAtual } from '../src/api';

export default function Layout() {
  const logado = useSyncExternalStore(assinarSessao, tokenAtual) !== null;

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
    <Stack screenOptions={{ title: 'TermoLOG' }}>
      <Stack.Protected guard={logado}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sala/[id]" />
        <Stack.Screen name="gateways" />
        <Stack.Screen name="health" />
      </Stack.Protected>
      <Stack.Protected guard={!logado}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
