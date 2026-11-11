import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import {
  type Faixa,
  getHistoricoDaSala,
  type HistoricoDaSala,
  type PeriodoDoHistorico,
} from '../api';
import { ordemDasBuscas, repetir } from '../busca';
import {
  escalaDoEixo,
  faixaNoGrafico,
  frasesDoSumario,
  type Grandeza,
  janelaAnterior,
  janelaSeguinte,
  limitesDa,
  marcasDoTempo,
  PERIODOS,
  podeVoltar,
  pontoMaisProximo,
  rotuloDaJanela,
  rotuloDoInstante,
  rotuloDoTempo,
  saidasDaFaixa,
  saiuDaFaixa,
  sumarioDoPeriodo,
  trechosDaLinha,
  UNIDADE,
} from '../historico';
import { limite, numero } from '../painel';
import type { Tema } from '../tema';
import { Botao } from './SensoresDaSala';
import { Surgir } from './Surgir';
import { Vidro } from './Vidro';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; dados: HistoricoDaSala; atualizando: boolean };

// O SVG não herda a fonte da página: sem isto, os rótulos caem numa fonte com serifa.
const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const CURVA = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Transição e cursor próprios: nenhum controle daqui usa o visual padrão do navegador. */
const SUAVE = {
  cursor: 'pointer',
  outlineStyle: 'none',
  transitionProperty: 'background-color, border-color, color, opacity, transform, box-shadow',
  transitionDuration: '200ms',
  transitionTimingFunction: CURVA,
} as object;

const reduzMovimento = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Estado do toque no navegador: passar o mouse e foco por teclado ganham visual próprio. */
function estadoDoToque(e: PressableStateCallbackType) {
  const { hovered, focused } = e as PressableStateCallbackType & {
    hovered?: boolean;
    focused?: boolean;
  };
  return { pressed: e.pressed, hovered: !!hovered, focused: !!focused };
}

function estiloDoToque(tema: Tema, e: PressableStateCallbackType, ativo = false) {
  const { pressed, hovered, focused } = estadoDoToque(e);
  return [
    SUAVE,
    !ativo && hovered && { backgroundColor: tema.vidro, borderColor: tema.texto2 },
    focused && ({ boxShadow: `0 0 0 3px ${tema.folga}73` } as object),
    pressed && styles.pressionado,
  ];
}

/** 0 → 1 em 900 ms toda vez que a chave muda: o gráfico se desenha da esquerda para a direita. */
function useRevelar(chave: string) {
  const [progresso, setProgresso] = useState(reduzMovimento() ? 1 : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a chave é o gatilho
  useEffect(() => {
    if (reduzMovimento()) {
      setProgresso(1);
      return;
    }
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      // O quadro pode ter começado um pouco antes de `inicio`: nunca abaixo de 0.
      const t = Math.min(1, Math.max(0, (agora - inicio) / 900));
      setProgresso(1 - (1 - t) ** 3);
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    setProgresso(0);
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [chave]);
  return progresso;
}

/** Segue o alvo com uma curva suave; sem alvo, guarda o último valor e o próximo entra sem salto. */
function useSuave(alvo: number | null, ms = 140) {
  const [valor, setValor] = useState(alvo ?? 0);
  const atual = useRef(alvo ?? 0);
  const parado = useRef(alvo === null);
  useEffect(() => {
    if (alvo === null) {
      parado.current = true;
      return;
    }
    if (parado.current || reduzMovimento()) {
      parado.current = false;
      atual.current = alvo;
      setValor(alvo);
      return;
    }
    const de = atual.current;
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const t = Math.min(1, Math.max(0, (agora - inicio) / ms));
      atual.current = de + (alvo - de) * (1 - (1 - t) ** 3);
      setValor(atual.current);
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo, ms]);
  return valor;
}

const LARGURA_MAXIMA = 1240;
const ESQUERDA = 38;
const DIREITA = 8;
const TOPO = 18;
const ALTURA_DA_TIRA = 8;

/**
 * Histórico da sala (#105). Um gráfico por vez, grande, com o número do ponto sob o cursor e
 * a faixa ideal como fundo. O que sai da faixa fica em coral, na linha e numa faixa fina de
 * conformidade logo abaixo: a saída aparece num olhar. Intervalo sem leitura fica em branco,
 * nada é inventado.
 */
export function GraficoDaSala({
  salaId,
  faixa,
  tema,
  largura: larguraDaTela,
}: {
  salaId: number;
  faixa: Faixa;
  tema: Tema;
  largura: number;
}) {
  // A coluna da sala tem largura máxima; o gráfico segue a largura medida dela, não a da tela.
  const [medida, setMedida] = useState<number | null>(null);
  const largura = Math.floor(medida ?? Math.min(larguraDaTela, LARGURA_MAXIMA));
  const [periodo, setPeriodo] = useState<PeriodoDoHistorico>('dia');
  // null = a janela termina em agora e acompanha o presente.
  const [fim, setFim] = useState<string | null>(null);
  const [grandeza, setGrandeza] = useState<Grandeza>('temperatura');
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [foco, setFoco] = useState<number | null>(null);
  const estreito = largura < 560;

  const [novaBusca] = useState(ordemDasBuscas);
  const buscar = useCallback(() => {
    const valeAinda = novaBusca();
    // Trocar de período mantém o gráfico anterior apagado até o novo chegar: a tela não pula.
    setEstado((e) => (e.fase === 'pronto' ? { ...e, atualizando: true } : { fase: 'carregando' }));
    return getHistoricoDaSala(salaId, periodo, fim ?? undefined)
      .then((dados) => {
        if (!valeAinda()) return;
        setFoco(null);
        setEstado({ fase: 'pronto', dados, atualizando: false });
      })
      .catch((erro: Error) => {
        if (valeAinda()) setEstado({ fase: 'erro', mensagem: erro.message });
      });
  }, [salaId, periodo, fim, novaBusca]);
  useEffect(() => {
    buscar();
  }, [buscar]);
  // Só a janela que termina em agora é atualizada sozinha.
  useEffect(() => (fim === null ? repetir(buscar, 60_000) : undefined), [fim, buscar]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const apagado = useApagado(estado.fase === 'pronto' && estado.atualizando);
  const vazio = dados !== null && dados.pontos.length === 0;
  const fimMs = dados ? Date.parse(dados.fim) : Date.now();
  const inicioMs = dados ? Date.parse(dados.inicio) : Date.now();
  const voltarLiberado = dados !== null && podeVoltar(inicioMs, Date.now());
  const voltar = () => setFim(janelaAnterior(inicioMs));
  const avancar = () => setFim(janelaSeguinte(fimMs, periodo, Date.now()));
  const trocarPeriodo = (novo: PeriodoDoHistorico) => {
    setPeriodo(novo);
    setFim(null);
  };

  return (
    <Surgir ordem={4} style={styles.secao}>
      <View
        onLayout={(e) => setMedida(e.nativeEvent.layout.width)}
        style={{ alignSelf: 'stretch', height: 0, marginBottom: -16 }}
      />
      <View style={[styles.cabecalho, estreito && styles.cabecalhoEstreito]}>
        <View style={styles.tituloLinha}>
          <Text style={[styles.h2, { color: tema.texto }]} accessibilityRole="header">
            Histórico
          </Text>
          {dados && (
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              {rotuloDaJanela(Date.parse(dados.inicio), Date.parse(dados.fim))}
            </Text>
          )}
        </View>
        <View style={[styles.controles, estreito && styles.controlesEstreito]}>
          <View style={styles.opcoes} accessibilityRole="radiogroup">
            {PERIODOS.map((p) => {
              const ativo = p.id === periodo;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => trocarPeriodo(p.id)}
                  accessibilityRole="radio"
                  aria-checked={ativo}
                  accessibilityLabel={p.rotulo}
                  style={(e) => [
                    styles.opcao,
                    {
                      borderColor: ativo ? tema.texto : tema.borda,
                      backgroundColor: ativo ? tema.vidroForte : 'transparent',
                    },
                    estiloDoToque(tema, e, ativo),
                  ]}
                >
                  <Text style={[styles.opcaoTexto, { color: ativo ? tema.texto : tema.texto2 }]}>
                    {p.rotulo}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.navegacao}>
            <Passo
              rotulo="Período anterior"
              tema={tema}
              aoTocar={voltar}
              desligado={!voltarLiberado}
              icone={<CaretLeftIcon size={14} color={tema.texto} />}
            />
            <Passo
              rotulo="Período seguinte"
              tema={tema}
              aoTocar={avancar}
              desligado={fim === null}
              icone={<CaretRightIcon size={14} color={tema.texto} />}
            />
            {fim !== null && (
              <Pressable
                onPress={() => setFim(null)}
                accessibilityRole="button"
                accessibilityLabel="Voltar para agora"
                style={(e) => [styles.agora, { borderColor: tema.borda }, estiloDoToque(tema, e)]}
              >
                <Text style={[styles.opcaoTexto, { color: tema.texto }]}>Agora</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View style={styles.abas} accessibilityRole="tablist">
        {(['temperatura', 'umidade'] as const).map((g) => {
          const ativa = g === grandeza;
          const nome = g === 'temperatura' ? 'Temperatura' : 'Umidade';
          return (
            <Pressable
              key={g}
              onPress={() => {
                setGrandeza(g);
                setFoco(null);
              }}
              accessibilityRole="tab"
              aria-selected={ativa}
              accessibilityLabel={nome}
              style={(e) => [
                styles.aba,
                SUAVE,
                { borderBottomColor: ativa ? tema.texto : 'transparent' },
                !ativa && estadoDoToque(e).hovered && { borderBottomColor: tema.borda },
                estadoDoToque(e).focused && ({ boxShadow: `0 0 0 3px ${tema.folga}73` } as object),
              ]}
            >
              <Text style={[styles.abaTexto, { color: ativa ? tema.texto : tema.texto2 }]}>
                {nome}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {estado.fase === 'carregando' && <Esqueleto tema={tema} />}
      {estado.fase === 'erro' && (
        <Vidro tema={tema} style={styles.aviso}>
          <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
            Não foi possível carregar o histórico
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            Verifique se a API está no ar e tente de novo. ({estado.mensagem})
          </Text>
          <Botao rotulo="Tentar de novo" tema={tema} aoTocar={buscar} />
        </Vidro>
      )}
      {vazio && dados && (
        <Vidro tema={tema} style={styles.aviso}>
          <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
            Sem leituras neste período
          </Text>
          <Text style={[styles.texto, { color: tema.texto2 }]}>
            A sala não enviou leituras entre{' '}
            {rotuloDaJanela(Date.parse(dados.inicio), Date.parse(dados.fim))}. O gráfico não
            preenche o que não foi medido.
          </Text>
          {voltarLiberado && <Botao rotulo="Ver o período anterior" tema={tema} aoTocar={voltar} />}
        </Vidro>
      )}
      {dados && !vazio && (
        <Animated.View style={{ opacity: apagado }}>
          <Corpo
            dados={dados}
            faixa={faixa}
            g={grandeza}
            tema={tema}
            largura={largura}
            estreito={estreito}
            foco={foco}
            aoFocar={setFoco}
            chave={`${grandeza}|${periodo}|${fim ?? 'agora'}`}
          />
        </Animated.View>
      )}
    </Surgir>
  );
}

/** Opacidade suave: 0,5 enquanto o gráfico novo carrega, 1 quando chega. */
function useApagado(atualizando: boolean) {
  const valor = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(valor, {
      toValue: atualizando ? 0.5 : 1,
      duration: 220,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [atualizando, valor]);
  return valor;
}

function Passo({
  rotulo,
  tema,
  aoTocar,
  desligado,
  icone,
}: {
  rotulo: string;
  tema: Tema;
  aoTocar: () => void;
  desligado: boolean;
  icone: ReactNode;
}) {
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      style={(e) => [
        styles.passo,
        { borderColor: tema.borda, opacity: desligado ? 0.35 : 1 },
        desligado ? ({ cursor: 'default' } as object) : estiloDoToque(tema, e),
      ]}
    >
      {icone}
    </Pressable>
  );
}

function Esqueleto({ tema }: { tema: Tema }) {
  return (
    <View
      accessibilityLabel="Carregando o histórico"
      style={[styles.esqueleto, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
    />
  );
}

/** O número grande do ponto, as frases do período e o gráfico. */
function Corpo({
  dados,
  faixa,
  g,
  tema,
  largura,
  estreito,
  foco,
  aoFocar,
  chave,
}: {
  dados: HistoricoDaSala;
  faixa: Faixa;
  g: Grandeza;
  tema: Tema;
  largura: number;
  estreito: boolean;
  foco: number | null;
  aoFocar: (i: number | null) => void;
  chave: string;
}) {
  const sumario = sumarioDoPeriodo({ ...dados, faixa }, g);
  const frases = frasesDoSumario(sumario, g);
  const pontos = sumario?.pontos ?? [];
  const mostrado = pontos[foco ?? pontos.length - 1];
  const fora = mostrado ? saiuDaFaixa(mostrado, faixa, g) : false;
  const nome = g === 'temperatura' ? 'temperatura' : 'umidade';
  // O número escorrega até o valor novo em vez de trocar de uma vez.
  const exibido = useSuave(mostrado ? mostrado.media : null, 160);

  return (
    <View style={styles.corpo}>
      {mostrado && (
        <View style={styles.leitura} accessibilityLiveRegion="polite">
          <View style={styles.leituraNumero}>
            <Text style={[styles.numero, { color: fora ? tema.alerta : tema.texto }, SUAVE]}>
              {numero(exibido)}
            </Text>
            <Text style={[styles.unidade, { color: tema.texto2 }]}>{UNIDADE[g]}</Text>
          </View>
          <View style={styles.leituraLegenda}>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              {foco === null ? 'Último intervalo, ' : ''}
              {rotuloDoInstante(mostrado.t)}
            </Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              Média de {mostrado.quantidade} {mostrado.quantidade === 1 ? 'leitura' : 'leituras'}
              {mostrado.min === mostrado.max
                ? ''
                : `, de ${numero(mostrado.min)} a ${numero(mostrado.max)} ${UNIDADE[g]}`}
              {fora ? ', fora da faixa' : ''}
            </Text>
          </View>
        </View>
      )}
      <View style={styles.frases}>
        <Text style={[styles.texto, { color: tema.texto }]}>{frases.faixa}</Text>
        {frases.pior && <Text style={[styles.texto, { color: tema.alerta }]}>{frases.pior}</Text>}
      </View>
      <Grafico
        dados={dados}
        faixa={faixa}
        g={g}
        tema={tema}
        largura={largura}
        altura={estreito ? 200 : 260}
        foco={foco}
        aoFocar={aoFocar}
        chave={chave}
        rotulo={`Gráfico de ${nome}. ${frases.faixa} ${frases.pior ?? ''} Use as setas para percorrer os intervalos.`}
      />
      <Legenda tema={tema} />
    </View>
  );
}

function Grafico({
  dados,
  faixa,
  g,
  tema,
  largura,
  altura,
  foco,
  aoFocar,
  chave,
  rotulo,
}: {
  dados: HistoricoDaSala;
  faixa: Faixa;
  g: Grandeza;
  tema: Tema;
  largura: number;
  altura: number;
  foco: number | null;
  aoFocar: (i: number | null) => void;
  chave: string;
  rotulo: string;
}) {
  const [comAnel, setComAnel] = useState(false);
  const revelado = useRevelar(chave);
  const sumario = sumarioDoPeriodo({ ...dados, faixa }, g);
  const pontos = sumario?.pontos ?? [];
  const cor = g === 'temperatura' ? tema.series[0] : tema.series[3];
  const intervaloMs = dados.intervalo_s * 1000;
  const inicioMs = Date.parse(dados.inicio);
  const fimMs = Date.parse(dados.fim);
  const area = { x0: ESQUERDA, x1: Math.max(ESQUERDA + 60, largura - DIREITA) };
  const tiraY = altura - ALTURA_DA_TIRA - 30;
  const baseY = tiraY - 12;
  const escala = escalaDoEixo(pontos, faixa, g);
  const desenhada = faixaNoGrafico(faixa, g, escala);
  const lim = limitesDa(faixa, g);
  const x = (ms: number) => area.x0 + ((ms - inicioMs) / (fimMs - inicioMs)) * (area.x1 - area.x0);
  const y = (v: number) => TOPO + (1 - (v - escala.lo) / (escala.hi - escala.lo)) * (baseY - TOPO);
  // Cada intervalo ocupa a largura dele, sem vão entre vizinhos: a faixa de baixo é contínua.
  const larguraDoIntervalo = Math.max(
    1.2,
    (intervaloMs / (fimMs - inicioMs)) * (area.x1 - area.x0),
  );
  const meio = (ms: number) => x(ms) + larguraDoIntervalo / 2;
  const ponto = (p: { t: number; media: number }, i: number) =>
    `${i === 0 ? 'M' : 'L'}${meio(p.t).toFixed(1)} ${y(p.media).toFixed(1)}`;

  const trechos = trechosDaLinha(pontos, intervaloMs);
  const compridos = trechos.filter((t) => t.length > 1);
  const linha = compridos.map((t) => t.map(ponto).join('')).join('');
  const variacao = compridos
    .map((t) => {
      const cima = t.map(
        (p, i) => `${i === 0 ? 'M' : 'L'}${meio(p.t).toFixed(1)} ${y(p.max).toFixed(1)}`,
      );
      const baixo = [...t].reverse().map((p) => `L${meio(p.t).toFixed(1)} ${y(p.min).toFixed(1)}`);
      return `${cima.join('')}${baixo.join('')}Z`;
    })
    .join('');
  const isolados = trechos.filter((t) => t.length === 1).map((t) => t[0]);
  const saidas = saidasDaFaixa(pontos, faixa, g, intervaloMs);
  // A linha em coral só nas sequências fora da faixa.
  const linhaCoral = saidas
    .map((s) => {
      const daSaida = pontos.filter((p) => p.t >= s.de && p.t <= s.ate);
      return daSaida.length > 1 ? daSaida.map(ponto).join('') : '';
    })
    .join('');
  let dentroTira = '';
  let foraTira = '';
  const largTira = (larguraDoIntervalo + 0.35).toFixed(1);
  for (const p of pontos) {
    const t = `M${x(p.t).toFixed(1)} ${tiraY}h${largTira}v${ALTURA_DA_TIRA}h-${largTira}z`;
    if (saiuDaFaixa(p, faixa, g)) foraTira += t;
    else dentroTira += t;
  }
  const marcasT = marcasDoTempo(inicioMs, fimMs, dados.periodo);
  const alvo = foco === null ? null : pontos[foco];
  const pior = sumario?.pior ?? null;
  // A mira desliza de um intervalo ao outro; na primeira vez entra direto no ponto.
  const miraX = useSuave(alvo ? meio(alvo.t) : null, 120);
  const miraY = useSuave(alvo ? y(alvo.media) : null, 120);

  const mover = (clientX: number, caixa: { left: number }) => {
    const fracao = Math.min(1, Math.max(0, (clientX - caixa.left - area.x0) / (area.x1 - area.x0)));
    aoFocar(pontoMaisProximo(pontos, inicioMs + fracao * (fimMs - inicioMs), intervaloMs));
  };
  // Mouse, toque e teclado: só existem na web, que é onde o painel roda.
  const eventos = {
    onMouseMove: (e: { clientX: number; currentTarget: HTMLElement }) =>
      mover(e.clientX, e.currentTarget.getBoundingClientRect()),
    onMouseLeave: () => aoFocar(null),
    onTouchStart: (e: { touches: { clientX: number }[]; currentTarget: HTMLElement }) =>
      mover(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()),
    onTouchMove: (e: { touches: { clientX: number }[]; currentTarget: HTMLElement }) =>
      mover(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const ultimo = pontos.length - 1;
      aoFocar(Math.min(ultimo, Math.max(0, (foco ?? ultimo) + (e.key === 'ArrowRight' ? 1 : -1))));
    },
    // O anel só aparece com o teclado: clicar no gráfico não desenha anel nenhum.
    onFocus: (e: { currentTarget: HTMLElement }) =>
      setComAnel(!!e.currentTarget.matches?.(':focus-visible')),
    onBlur: () => {
      setComAnel(false);
      aoFocar(null);
    },
  };

  return (
    <View
      style={[
        { height: altura },
        SUAVE,
        {
          cursor: 'crosshair',
          userSelect: 'none',
          borderRadius: 14,
          ...(comAnel ? { boxShadow: `0 0 0 3px ${tema.folga}73` } : {}),
        } as object,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={rotulo}
      focusable
      {...(eventos as object)}
    >
      <Svg width={largura} height={altura}>
        <Defs>
          <ClipPath id="revelar">
            <Rect x={0} y={0} width={(area.x1 + DIREITA) * revelado} height={altura} />
          </ClipPath>
        </Defs>
        {desenhada.sombra && (
          <Rect
            x={area.x0}
            y={y(desenhada.sombra.ate)}
            width={area.x1 - area.x0}
            height={Math.max(0, y(desenhada.sombra.de) - y(desenhada.sombra.ate))}
            fill={tema.folga}
            fillOpacity={0.08}
          />
        )}
        <G clipPath="url(#revelar)">
          {saidas.map((s) => (
            <Rect
              key={`s${s.de}`}
              x={x(s.de)}
              y={TOPO}
              width={Math.max(3, x(s.ate) + larguraDoIntervalo - x(s.de))}
              height={baseY - TOPO}
              fill={tema.alerta}
              fillOpacity={0.1}
            />
          ))}
        </G>
        {escala.marcas.map((m) => (
          <Line
            key={`l${m}`}
            x1={area.x0}
            x2={area.x1}
            y1={y(m)}
            y2={y(m)}
            stroke={tema.trilho}
            strokeWidth={1}
            opacity={0.5}
          />
        ))}
        {escala.marcas.map((m) => (
          <SvgText
            fontFamily={FONTE}
            key={`r${m}`}
            x={area.x0 - 8}
            y={y(m) + 4}
            fontSize={12}
            fill={tema.texto2}
            textAnchor="end"
          >
            {limite(m)}
          </SvgText>
        ))}
        {desenhada.linhas.map((v) => (
          <Line
            key={`lim${v}`}
            x1={area.x0}
            x2={area.x1}
            y1={y(v)}
            y2={y(v)}
            stroke={tema.folga}
            strokeWidth={1.2}
            strokeDasharray="6 5"
          />
        ))}
        {desenhada.linhas.map((v) => (
          <SvgText
            fontFamily={FONTE}
            key={`t${v}`}
            x={area.x1 - 4}
            y={y(v) + (v === lim.max ? -6 : 14)}
            fontSize={11.5}
            fill={tema.folga}
            textAnchor="end"
          >
            {`${v === lim.max ? 'máx' : 'mín'} ${limite(v)} ${UNIDADE[g]}`}
          </SvgText>
        ))}
        <G clipPath="url(#revelar)">
          <Path d={variacao} fill={cor} fillOpacity={0.13} />
          {linha !== '' && (
            <Path
              d={linha}
              fill="none"
              stroke={cor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {linhaCoral !== '' && (
            <Path
              d={linhaCoral}
              fill="none"
              stroke={tema.alerta}
              strokeWidth={2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {isolados.map((p) => (
            <Circle
              key={p.t}
              cx={meio(p.t)}
              cy={y(p.media)}
              r={2.4}
              fill={saiuDaFaixa(p, faixa, g) ? tema.alerta : cor}
            />
          ))}
          {pior && foco === null && (
            <>
              <Circle cx={meio(pior.ponto.t)} cy={y(pior.valor)} r={3.4} fill={tema.alerta} />
              <SvgText
                fontFamily={FONTE}
                x={Math.min(area.x1 - 18, Math.max(area.x0 + 18, meio(pior.ponto.t)))}
                y={y(pior.valor) + (pior.sentido === 'acima' ? -9 : 17)}
                fontSize={12}
                fontWeight="600"
                fill={tema.alerta}
                textAnchor="middle"
              >
                {`${numero(pior.valor)} ${UNIDADE[g]}`}
              </SvgText>
            </>
          )}
          <SvgText
            fontFamily={FONTE}
            x={area.x0 - 8}
            y={tiraY + ALTURA_DA_TIRA - 0.5}
            fontSize={10.5}
            fill={tema.texto2}
            textAnchor="end"
          >
            faixa
          </SvgText>
          <Path d={dentroTira} fill={tema.folga} fillOpacity={0.55} />
          <Path d={foraTira} fill={tema.alerta} />
        </G>
        {alvo && (
          <>
            <Line
              x1={miraX}
              x2={miraX}
              y1={TOPO}
              y2={tiraY + ALTURA_DA_TIRA}
              stroke={tema.texto}
              strokeWidth={1}
              opacity={0.5}
            />
            <Circle
              cx={miraX}
              cy={miraY}
              r={4.5}
              fill={tema.fundo}
              stroke={saiuDaFaixa(alvo, faixa, g) ? tema.alerta : cor}
              strokeWidth={2.2}
            />
          </>
        )}
        {marcasT.map((m) => (
          <SvgText
            fontFamily={FONTE}
            key={`x${m}`}
            x={x(m)}
            y={altura - 6}
            fontSize={12}
            fill={tema.texto2}
            textAnchor="middle"
          >
            {rotuloDoTempo(m, dados.periodo)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

function Legenda({ tema }: { tema: Tema }) {
  return (
    <View style={styles.legenda}>
      <View style={styles.legendaItem}>
        <View style={[styles.marcaTracejada, { borderColor: tema.folga }]} />
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>Faixa ideal</Text>
      </View>
      <View style={styles.legendaItem}>
        <View style={[styles.marca, { backgroundColor: tema.alerta }]} />
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>Fora da faixa</Text>
      </View>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>
        A área clara é a variação dentro do intervalo. Vão em branco: sem leitura.
      </Text>
    </View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  secao: { gap: 16 },
  cabecalho: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cabecalhoEstreito: { flexDirection: 'column', alignItems: 'stretch' },
  tituloLinha: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexShrink: 1 },
  h2: { fontSize: 22, fontWeight: '500', letterSpacing: -0.3 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  controlesEstreito: { justifyContent: 'space-between' },
  opcoes: { flexDirection: 'row', gap: 6 },
  opcao: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  opcaoTexto: { fontSize: 13 },
  navegacao: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agora: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pressionado: { transform: [{ scale: 0.96 }] },
  abas: { flexDirection: 'row', gap: 22 },
  aba: { paddingVertical: 6, borderBottomWidth: 2 },
  abaTexto: { fontSize: 15, fontWeight: '500' },
  corpo: { gap: 14 },
  leitura: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: 16,
    rowGap: 4,
  },
  leituraNumero: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  numero: { fontSize: 48, fontWeight: '300', letterSpacing: -1.2, lineHeight: 54, ...numeros },
  unidade: { fontSize: 18, fontWeight: '300' },
  leituraLegenda: { gap: 2, paddingBottom: 6, flexShrink: 1 },
  frases: { gap: 2 },
  texto: { fontSize: 14, lineHeight: 20, ...numeros },
  pequeno: { fontSize: 12, lineHeight: 17, ...numeros },
  esqueleto: { height: 320, borderRadius: 22, borderWidth: 1, opacity: 0.7 },
  aviso: { gap: 10, alignItems: 'flex-start' },
  avisoTitulo: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },
  legenda: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 18,
    rowGap: 4,
  },
  legendaItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  marca: { width: 14, height: 3, borderRadius: 2 },
  marcaTracejada: { width: 14, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
});
