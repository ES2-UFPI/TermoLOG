import { useEffect, useState } from 'react';
import { getUsuarioLogado, type UsuarioLogado } from './api';

/**
 * Quem está logado, para a tela decidir o que mostrar (US24). `null` enquanto a resposta
 * não chega e se ela falhar: sem saber quem é, as ações de administrador ficam escondidas
 * (`podeAdministrar`).
 */
export function useUsuario() {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null);
  useEffect(() => {
    let vale = true;
    getUsuarioLogado()
      .then((u) => vale && setUsuario(u))
      .catch(() => {});
    return () => {
      vale = false;
    };
  }, []);
  return usuario;
}
