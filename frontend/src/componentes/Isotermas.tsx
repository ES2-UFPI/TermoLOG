import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { aproximar, assentou, campo, corEmRgb, envelope, onda, segmentos } from '../isotermas';
import type { Tema } from '../tema';

export type TipoDoPulso = 'tecla' | 'envio' | 'erro' | 'ok';

export type ControleIsotermas = {
  /** Solta um pulso a partir de um ponto da janela (px). */
  pulso: (x: number, y: number, tipo: TipoDoPulso) => void;
  /** Faz as curvas sumirem aos poucos numa elipse (px da janela); null tira a clareira. */
  clareira: (area: { x: number; y: number; rx: number; ry: number } | null) => void;
  /** Apaga as curvas: a saída da tela depois do login. */
  apagar: () => void;
};

// Pulso: força na deformação, velocidade (px/s), vida (s) e a cor que corre na crista.
const PULSOS = {
  tecla: { forca: 0.16, velocidade: 300, vida: 1.6, cor: null },
  envio: { forca: 0.3, velocidade: 340, vida: 2, cor: null },
  erro: { forca: 0.7, velocidade: 420, vida: 2.6, cor: 'alerta' },
  ok: { forca: 0.7, velocidade: 520, vida: 2.2, cor: 'folga' },
} as const;

const NIVEIS = 12;
const MAX_PULSOS = 10;
const LARGURA_DA_ONDA = 130;
const RAIO_DO_PONTEIRO = 200;

export const movimentoReduzido = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function comAlfa(cor: string, alfa: number) {
  const inteiro = Number.parseInt(cor.slice(1), 16);
  return `rgba(${inteiro >> 16},${(inteiro >> 8) & 255},${inteiro & 255},${alfa})`;
}

/**
 * Fundo da tela de login: isotermas vivas. O ponteiro é uma fonte de calor que as curvas
 * contornam, cada tecla solta uma onda, e o erro corre pelas curvas na cor do alerta.
 * Com movimento reduzido, fica um quadro parado. O laço só roda com a aba visível (rAF).
 * Com `animada`, quem usa decide quando as curvas se movem: ao desligar, elas desaceleram até
 * parar e o laço de desenho termina de verdade, sem gastar nada enquanto estiverem paradas.
 */
export function Isotermas({
  tema,
  mascara,
  animada,
  ref,
}: {
  tema: Tema;
  /** Degradê CSS que enfraquece as curvas onde há texto por cima. */
  mascara?: string;
  /** Sem esta propriedade, as curvas estão sempre vivas, como no login. */
  animada?: boolean;
  ref?: Ref<ControleIsotermas>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const temaAtual = useRef(tema);
  temaAtual.current = tema;
  const animadaAtual = useRef(animada ?? true);
  animadaAtual.current = animada ?? true;
  // Só quem controla a animação tem a troca suave de cor: no login, a cor segue o tema na hora.
  const corSuave = useRef(animada !== undefined);
  const ligar = useRef<(() => void) | null>(null);
  const redesenhar = useRef<(() => void) | null>(null);
  const pulsos = useRef<{ x: number; y: number; inicio: number; tipo: TipoDoPulso }[]>([]);
  const apagadaEm = useRef<number | null>(null);
  const clareira = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      pulso(x, y, tipo) {
        if (movimentoReduzido()) return;
        pulsos.current.push({ x, y, tipo, inicio: performance.now() });
        if (pulsos.current.length > MAX_PULSOS) pulsos.current.shift();
      },
      clareira(area) {
        clareira.current = area;
      },
      apagar() {
        apagadaEm.current = performance.now();
      },
    }),
    [],
  );

  // Antes do efeito do tema: com o laço já pedido, a cor nova vem aos poucos, sem pular.
  useEffect(() => {
    if (animada ?? true) ligar.current?.();
  }, [animada]);

  // Tema trocado com as curvas paradas: não há laço, então redesenha o quadro.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tema só dispara o redesenho.
  useEffect(() => redesenhar.current?.(), [tema]);

  useEffect(() => {
    const tela = canvas.current;
    const ctx = tela?.getContext('2d');
    if (!tela || !ctx) return;

    let largura = 0;
    let altura = 0;
    let passo = 14;
    let colunas = 0;
    let linhas = 0;
    let grade = new Float32Array(0);

    const medir = () => {
      const caixa = tela.getBoundingClientRect();
      largura = caixa.width;
      altura = caixa.height;
      // ponytail: DPR limitado a 1,5 e passo fixo; subir o passo se faltar quadro em máquina fraca.
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
      tela.width = Math.round(largura * dpr);
      tela.height = Math.round(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      passo = largura < 760 ? 16 : 11;
      colunas = Math.ceil(largura / passo) + 2;
      linhas = Math.ceil(altura / passo) + 2;
      grade = new Float32Array(colunas * linhas);
    };
    medir();

    // O calor do ponteiro vai atrás do alvo devagar, para as curvas não pularem com o mouse.
    const calor = { x: largura * 0.68, y: altura * 0.42, forca: 0 };
    const alvo = { x: calor.x, y: calor.y, ativo: false };
    const aoMover = (e: PointerEvent) => {
      alvo.x = e.clientX;
      alvo.y = e.clientY;
      alvo.ativo = true;
    };
    const aoSair = () => {
      alvo.ativo = false;
    };

    const reduzido = movimentoReduzido();
    const comecaViva = animadaAtual.current && !reduzido;
    // Quem começa parado já aparece inteiro, sem as curvas surgindo uma a uma.
    const inicio = performance.now() - (comecaViva ? 0 : 60_000);
    let anterior = performance.now();
    // O relógio do campo só anda no ritmo atual: parar e voltar continua do mesmo desenho.
    let tempo = 40;
    let ritmo = comecaViva ? 1 : 0;
    const alvoDaCor = () => temaAtual.current.faixa.flatMap(corEmRgb);
    let cor = alvoDaCor();

    const desenhar = (agora: number) => {
      const decorrido = (agora - anterior) / 1000;
      const dt = Math.min(decorrido, 0.05);
      anterior = agora;
      const cores = temaAtual.current;
      const viva = animadaAtual.current && !reduzido;

      ritmo = reduzido ? 0 : aproximar(ritmo, viva ? 1 : 0, dt, 0.4);
      tempo += decorrido * 0.85 * ritmo;
      const destino = alvoDaCor();
      cor = corSuave.current ? cor.map((c, i) => aproximar(c, destino[i], dt, 0.4)) : destino;

      calor.x = aproximar(calor.x, alvo.x, dt, 0.45);
      calor.y = aproximar(calor.y, alvo.y, dt, 0.45);
      calor.forca = aproximar(calor.forca, alvo.ativo && viva ? 1 : 0, dt, 0.8);

      pulsos.current = pulsos.current.filter(
        (p) => (agora - p.inicio) / 1000 < PULSOS[p.tipo].vida,
      );
      const ativos = pulsos.current.map((p) => {
        const idade = (agora - p.inicio) / 1000;
        const P = PULSOS[p.tipo];
        return { ...P, x: p.x, y: p.y, raio: idade * P.velocidade, progresso: idade / P.vida };
      });

      // Escala do campo: uma tela maior mostra mais ondulações, não ondulações maiores.
      const escala = 1 / 300;
      const t = tempo;
      const raioDoCalor = 2 * RAIO_DO_PONTEIRO * RAIO_DO_PONTEIRO;
      let n = 0;
      for (let l = 0; l < linhas; l++) {
        const y = l * passo;
        for (let c = 0; c < colunas; c++) {
          const x = c * passo;
          let valor = campo(x * escala, y * escala, t);
          if (calor.forca > 0.01) {
            const dx = x - calor.x;
            const dy = y - calor.y;
            valor += 1.5 * calor.forca * Math.exp(-(dx * dx + dy * dy) / raioDoCalor);
          }
          for (const p of ativos) {
            valor +=
              p.forca * onda(Math.hypot(x - p.x, y - p.y), p.raio, LARGURA_DA_ONDA, p.progresso);
          }
          grade[n++] = valor;
        }
      }

      ctx.clearRect(0, 0, largura, altura);
      const saida = apagadaEm.current === null ? 0 : Math.min((agora - apagadaEm.current) / 850, 1);
      ctx.save();

      const degrade = ctx.createLinearGradient(0, altura, largura, 0);
      degrade.addColorStop(0, `rgb(${cor[0]},${cor[1]},${cor[2]})`);
      degrade.addColorStop(1, `rgb(${cor[3]},${cor[4]},${cor[5]})`);
      ctx.strokeStyle = degrade;
      ctx.lineCap = 'round';

      const tudo = new Path2D();
      for (let i = 0; i < NIVEIS; i++) {
        const nivel = -2.4 + (i * 4.8) / (NIVEIS - 1);
        const curva = new Path2D();
        segmentos(grade, colunas, linhas, passo, nivel, (x1, y1, x2, y2) => {
          curva.moveTo(x1, y1);
          curva.lineTo(x2, y2);
        });
        // Quanto mais quente o nível, mais marcada a curva. Cada uma surge um pouco depois.
        const surgindo = Math.min(Math.max(((agora - inicio) / 1000 - i * 0.12) / 1.4, 0), 1);
        const atraso = surgindo * surgindo * (3 - 2 * surgindo);
        ctx.globalAlpha = (1 - saida) * atraso * (0.2 + (0.55 * i) / (NIVEIS - 1));
        ctx.lineWidth = i % 4 === 3 ? 1.5 : 1;
        ctx.stroke(curva);
        tudo.addPath(curva);
      }

      // A cor do pulso corre só na crista: as mesmas curvas, pintadas de novo num anel.
      ctx.lineWidth = 1.6;
      for (const p of ativos) {
        if (!p.cor) continue;
        const raioFora = p.raio + LARGURA_DA_ONDA * 1.6;
        const anel = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, raioFora);
        const cor = cores[p.cor];
        const miolo = Math.max(p.raio - LARGURA_DA_ONDA * 1.6, 0) / raioFora;
        anel.addColorStop(0, comAlfa(cor, 0));
        anel.addColorStop(miolo, comAlfa(cor, 0));
        anel.addColorStop(p.raio / raioFora, comAlfa(cor, 1));
        anel.addColorStop(1, comAlfa(cor, 0));
        ctx.globalAlpha = (1 - saida) * Math.min(envelope(p.progresso) * 1.6, 1);
        ctx.strokeStyle = anel;
        ctx.stroke(tudo);
      }
      // Clareira: apaga as curvas com borda suave, sem um contorno que chame atenção.
      if (clareira.current) {
        const { x, y, rx, ry } = clareira.current;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.translate(x, y);
        ctx.scale(rx, ry);
        const suave = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        suave.addColorStop(0, 'rgba(0,0,0,1)');
        suave.addColorStop(0.5, 'rgba(0,0,0,1)');
        suave.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = suave;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
    };

    let quadro = 0;
    // Com as curvas paradas, um quadro só, na cor certa e sem pedir outro.
    const quadroParado = () => {
      if (quadro !== 0) return;
      cor = alvoDaCor();
      anterior = performance.now();
      desenhar(anterior);
    };
    redesenhar.current = quadroParado;

    // performance.now(), não o carimbo do rAF: ele é do início do quadro e pode ser anterior
    // ao `inicio` ou a um pulso recém-criado, o que daria raio negativo no canvas.
    const laco = () => {
      desenhar(performance.now());
      // Desligada e assentada, o laço termina: nada mais roda até religar.
      if (!animadaAtual.current && assentou(ritmo, calor.forca, cor, alvoDaCor())) {
        quadro = 0;
        ritmo = 0;
        return;
      }
      quadro = requestAnimationFrame(laco);
    };
    ligar.current = () => {
      if (reduzido || quadro !== 0) return;
      anterior = performance.now();
      quadro = requestAnimationFrame(laco);
    };

    const observador = new ResizeObserver(() => {
      medir();
      quadroParado();
    });
    observador.observe(tela);
    if (comecaViva) ligar.current();
    else quadroParado();
    if (reduzido) {
      return () => {
        observador.disconnect();
        ligar.current = null;
      };
    }
    document.addEventListener('pointermove', aoMover, { passive: true });
    document.addEventListener('pointerdown', aoMover, { passive: true });
    document.documentElement.addEventListener('pointerleave', aoSair);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      ligar.current = null;
      document.removeEventListener('pointermove', aoMover);
      document.removeEventListener('pointerdown', aoMover);
      document.documentElement.removeEventListener('pointerleave', aoSair);
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden>
      <canvas
        ref={canvas}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          maskImage: mascara,
          WebkitMaskImage: mascara,
        }}
      />
    </View>
  );
}
