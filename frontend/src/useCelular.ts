import { useWindowDimensions } from 'react-native';
import { LARGURA_DO_CELULAR } from './toque';

/** A tela é de celular? Os controles crescem até 44 px (ver `alvo`). */
export function useCelular() {
  return useWindowDimensions().width < LARGURA_DO_CELULAR;
}
