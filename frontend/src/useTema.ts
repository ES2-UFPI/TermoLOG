import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { trocarComAgua } from './componentes/BotaoTema';
import { temas } from './tema';

// A escolha de tema fica salva no navegador; sem ela, o painel segue o tema do sistema.
const CHAVE_TEMA = 'termolog-tema';

function temaSalvo(): boolean | null {
  try {
    const valor = globalThis.localStorage?.getItem(CHAVE_TEMA);
    return valor === null || valor === undefined ? null : valor === 'escuro';
  } catch {
    return null;
  }
}

function salvarTema(escuro: boolean) {
  try {
    globalThis.localStorage?.setItem(CHAVE_TEMA, escuro ? 'escuro' : 'claro');
  } catch {}
}

// Barra de rolagem fina, com trilho transparente e alça na cor do tema. A padrão do
// navegador fica clara e com setas mesmo no tema escuro (gaveta e página).
function barraDeRolagem(escuro: boolean) {
  if (Platform.OS !== 'web') return;
  const alca = escuro ? '255,255,255' : '23,26,31';
  let estilo = document.getElementById('termolog-rolagem');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'termolog-rolagem';
    document.head.append(estilo);
  }
  estilo.textContent = `
* { scrollbar-width: thin; scrollbar-color: rgba(${alca},0.18) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: rgba(${alca},0.18); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
*::-webkit-scrollbar-thumb:hover { background-color: rgba(${alca},0.32); }
*::-webkit-scrollbar-button { display: none; }`;
  document.documentElement.style.colorScheme = escuro ? 'dark' : 'light';
}

// Uma escolha só para o app: o Stack deixa o Painel montado por baixo de Gateways, e com um
// useState por tela as duas ficavam com temas diferentes depois da troca.
let escolha = temaSalvo();
const ouvintes = new Set<() => void>();
const assinar = (ouvinte: () => void) => {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
};
const escolhaAtual = () => escolha;

/** Tema das telas do painel: o salvo ou o do sistema, e a troca com a água na diagonal. */
export function useTema() {
  const sistemaEscuro = useColorScheme() === 'dark';
  const escuro = useSyncExternalStore(assinar, escolhaAtual) ?? sistemaEscuro;
  useEffect(() => barraDeRolagem(escuro), [escuro]);
  const trocar = useCallback(
    () =>
      trocarComAgua(!escuro, () => {
        escolha = !escuro;
        salvarTema(escolha);
        for (const ouvinte of ouvintes) ouvinte();
      }),
    [escuro],
  );
  return { escuro, tema: escuro ? temas.escuro : temas.claro, trocar };
}
