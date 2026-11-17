// Isotermas da tela de login: curvas de mesma temperatura de um campo que se move devagar.
// Só a matemática fica aqui; o desenho no canvas está em componentes/Isotermas.tsx.

/** Campo de fundo, em torno de -2,6 a 2,6. Senos dobrados uns nos outros, sem custo de ruído. */
export function campo(u: number, v: number, t: number) {
  return (
    Math.sin(u * 1.7 + t * 0.11 + 1.3 * Math.sin(v * 1.1 - t * 0.07)) +
    Math.sin(v * 2.1 - t * 0.09 + 1.1 * Math.sin(u * 0.9 + t * 0.05)) +
    0.6 * Math.sin((u + v) * 2.7 + t * 0.13)
  );
}

/** Aproxima de um alvo no mesmo ritmo em qualquer taxa de quadros (constante de tempo em s). */
export const aproximar = (atual: number, alvo: number, dt: number, constante: number) =>
  alvo + (atual - alvo) * Math.exp(-dt / constante);

export const saidaExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));

/** Intensidade de um pulso na vida: cresce sem tranco e some devagar (progresso de 0 a 1). */
export function envelope(progresso: number) {
  if (progresso <= 0 || progresso >= 1) return 0;
  const subida = Math.min(progresso / 0.18, 1);
  return subida * subida * (3 - 2 * subida) * (1 - progresso) ** 2;
}

/** Crista de um pulso que se afasta da origem. */
export function onda(distancia: number, raio: number, largura: number, progresso: number) {
  const d = (distancia - raio) / largura;
  return Math.exp(-d * d) * envelope(progresso);
}

/**
 * Marching squares: entrega os segmentos da curva `nivel` numa grade de valores, em px.
 * `grade` tem colunas * linhas valores, linha a linha, com `passo` px entre os pontos.
 */
export function segmentos(
  grade: ArrayLike<number>,
  colunas: number,
  linhas: number,
  passo: number,
  nivel: number,
  emitir: (x1: number, y1: number, x2: number, y2: number) => void,
) {
  for (let l = 0; l < linhas - 1; l++) {
    for (let c = 0; c < colunas - 1; c++) {
      const i = l * colunas + c;
      const a = grade[i];
      const b = grade[i + 1];
      const d = grade[i + colunas];
      const e = grade[i + colunas + 1];
      const caso =
        (a > nivel ? 8 : 0) | (b > nivel ? 4 : 0) | (e > nivel ? 2 : 0) | (d > nivel ? 1 : 0);
      if (caso === 0 || caso === 15) continue;

      const x = c * passo;
      const y = l * passo;
      // Onde a curva cruza cada lado da célula, por interpolação linear.
      const topo = () => x + (passo * (nivel - a)) / (b - a);
      const base = () => x + (passo * (nivel - d)) / (e - d);
      const esquerda = () => y + (passo * (nivel - a)) / (d - a);
      const direita = () => y + (passo * (nivel - b)) / (e - b);
      const xd = x + passo;
      const yb = y + passo;

      switch (caso) {
        case 1:
        case 14:
          emitir(x, esquerda(), base(), yb);
          break;
        case 2:
        case 13:
          emitir(base(), yb, xd, direita());
          break;
        case 3:
        case 12:
          emitir(x, esquerda(), xd, direita());
          break;
        case 4:
        case 11:
          emitir(topo(), y, xd, direita());
          break;
        case 6:
        case 9:
          emitir(topo(), y, base(), yb);
          break;
        case 7:
        case 8:
          emitir(x, esquerda(), topo(), y);
          break;
        // Selas: o centro da célula decide de que lado a curva passa.
        case 5:
          emitir(x, esquerda(), topo(), y);
          emitir(base(), yb, xd, direita());
          break;
        case 10:
          emitir(topo(), y, xd, direita());
          emitir(x, esquerda(), base(), yb);
          break;
      }
    }
  }
}

/** "#ff8a73" em [255, 138, 115], para misturar uma cor na outra quadro a quadro. */
export function corEmRgb(cor: string): [number, number, number] {
  const inteiro = Number.parseInt(cor.slice(1), 16);
  return [inteiro >> 16, (inteiro >> 8) & 255, inteiro & 255];
}

/**
 * A desaceleração terminou? Só então o laço de desenho pode parar: antes disso, cortar o
 * laço faria as curvas pararem de repente ou a cor pular para a nova.
 */
export function assentou(ritmo: number, calor: number, cor: number[], alvo: number[]) {
  return ritmo < 0.005 && calor < 0.01 && cor.every((c, i) => Math.abs(c - alvo[i]) < 1);
}
