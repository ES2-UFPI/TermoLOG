// Alvo de toque (#139): no celular, todo controle precisa de pelo menos 44 px. O hitSlop do
// React Native não existe na web, então o tamanho desenhado é o que vale.

/** Abaixo desta largura a tela é de celular (a mesma regra da margem do painel e da gaveta). */
export const LARGURA_DO_CELULAR = 760;

/** Lado mínimo de um alvo de toque, em px. */
export const ALVO_DE_TOQUE = 44;
