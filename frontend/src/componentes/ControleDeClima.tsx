import { ArrowsClockwiseIcon } from 'phosphor-react-native/src/icons/ArrowsClockwise';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { FanIcon } from 'phosphor-react-native/src/icons/Fan';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { PowerIcon } from 'phosphor-react-native/src/icons/Power';
import { ThermometerIcon } from 'phosphor-react-native/src/icons/Thermometer';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  type AcaoDeClimatizacao,
  type ComandoDeClimatizacao,
  enviarComandoDeClimatizacao,
  type Faixa,
  getComandosDeClimatizacao,
} from '../api';
import { ordemDasBuscas, repetir } from '../busca';
import {
  ANGULO_INICIAL,
  ajustePendente,
  anguloDa,
  estadoDoEquipamento,
  limitarTemperatura,
  linhaDoComando,
  META_PADRAO,
  mensagemDoEnvio,
  TEMPERATURA_MAX,
  TEMPERATURA_MIN,
  temPendente,
  temperaturaDoPonto,
  textoDoEstado,
  VARREDURA,
} from '../clima';
import { numero } from '../painel';
import { textoDoIntervalo } from '../sala';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';
import { useCelular } from '../useCelular';
import { Botao } from './SensoresDaSala';
import { Vidro } from './Vidro';

// Com um comando pendente, a lista se atualiza mais vezes para mostrar a entrega logo.
const BUSCA_PENDENTE_MS = 3_000;
const BUSCA_MS = 30_000;
const MENSAGEM_MS = 4_400;

/**
 * Ar-condicionado da sala (#162): o administrador liga, desliga e ajusta a meta; todos veem os
 * comandos. O estado mostrado é o do último comando entregue, porque o infravermelho não
 * devolve confirmação.
 */
export function ControleDeClima({
  salaId,
  sensorId,
  admin,
  intervaloS,
  leitura,
  faixa,
  largura,
  ordem,
  tema,
  aoEditar,
}: {
  salaId: number;
  /** Sensor com o emissor infravermelho; null quando a sala não tem. */
  sensorId: number | null;
  admin: boolean;
  intervaloS: number | null | undefined;
  /** Temperatura atual do sensor do emissor, se houver leitura. */
  leitura: number | null;
  faixa: Faixa;
  largura: number;
  ordem: number;
  tema: Tema;
  aoEditar: () => void;
}) {
  if (sensorId === null) {
    // O visualizador não tem o que fazer com a sala sem emissor.
    if (!admin) return null;
    return (
      <View role="region" aria-label="Ar-condicionado">
        <Vidro tema={tema} ordem={ordem} style={styles.vazio}>
          <Cabecalho titulo="Ar-condicionado" subtitulo={null} tema={tema} />
          <Text style={[styles.vazioTitulo, { color: tema.texto }]}>
            Esta sala não tem sensor de climatização
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            Escolha na edição da sala o sensor que tem o emissor infravermelho do ar-condicionado.
          </Text>
          <Botao
            rotulo="Escolher o sensor"
            rotuloA11y="Escolher o sensor de climatização"
            tema={tema}
            aoTocar={aoEditar}
            icone={<PencilSimpleIcon size={15} color={tema.texto} />}
          />
        </Vidro>
      </View>
    );
  }
  return (
    <Controle
      salaId={salaId}
      sensorId={sensorId}
      admin={admin}
      intervaloS={intervaloS}
      leitura={leitura}
      faixa={faixa}
      largura={largura}
      ordem={ordem}
      tema={tema}
    />
  );
}

function Controle({
  salaId,
  sensorId,
  admin,
  intervaloS,
  leitura,
  faixa,
  largura,
  ordem,
  tema,
}: {
  salaId: number;
  sensorId: number;
  admin: boolean;
  intervaloS: number | null | undefined;
  leitura: number | null;
  faixa: Faixa;
  largura: number;
  ordem: number;
  tema: Tema;
}) {
  const [comandos, setComandos] = useState<ComandoDeClimatizacao[] | null>(null);
  const [erroDaLista, setErroDaLista] = useState(false);
  const [novaBusca] = useState(ordemDasBuscas);
  const buscar = useCallback(() => {
    const valeAinda = novaBusca();
    return getComandosDeClimatizacao(salaId)
      .then((lista) => {
        if (!valeAinda()) return;
        setComandos(lista);
        setErroDaLista(false);
      })
      .catch(() => valeAinda() && setErroDaLista(true));
  }, [salaId, novaBusca]);
  useEffect(() => {
    buscar();
  }, [buscar]);
  const pendente = comandos !== null && temPendente(comandos, sensorId);
  useEffect(() => repetir(buscar, pendente ? BUSCA_PENDENTE_MS : BUSCA_MS), [buscar, pendente]);

  const estado = estadoDoEquipamento(comandos ?? [], sensorId);
  const metaPendente = ajustePendente(comandos ?? [], sensorId);
  const referencia = metaPendente ?? estado.meta;
  // null = a pessoa não mexeu: o dial mostra o pendente ou a meta entregue.
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const meta = escolhida ?? referencia ?? META_PADRAO;
  const mudou = meta !== referencia;

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  useEffect(() => {
    if (!mensagem) return;
    const apagar = setTimeout(() => setMensagem(''), MENSAGEM_MS);
    return () => clearTimeout(apagar);
  }, [mensagem]);

  const enviar = (acao: AcaoDeClimatizacao) => {
    if (enviando) return;
    const temperatura = acao === 'ajustar' ? meta : null;
    setEnviando(true);
    setErro('');
    enviarComandoDeClimatizacao(salaId, acao, temperatura ?? undefined)
      .then((novo) => {
        setComandos((lista) => [novo, ...(lista ?? []).filter((c) => c.id !== novo.id)]);
        // Uma busca que saiu antes do POST traria a lista sem o comando novo: a nova a invalida.
        buscar();
        setMensagem(mensagemDoEnvio(acao, temperatura));
        if (acao === 'ajustar') setEscolhida(null);
      })
      .catch((e: Error) => setErro(`Não deu para enviar o comando: ${e.message}`))
      .finally(() => setEnviando(false));
  };

  const largo = largura >= 1000;
  const controlesAoLado = (largo ? largura / 2 : largura) >= 560;

  return (
    <View role="region" aria-label="Ar-condicionado">
      <Vidro tema={tema} ordem={ordem} style={styles.cartao}>
        <View style={styles.topo}>
          <Cabecalho
            titulo="Ar-condicionado"
            subtitulo={mensagem || `Emissor infravermelho no Sensor ${sensorId}`}
            destaque={!!mensagem}
            tema={tema}
          />
          <Estado ligado={estado.ligado} texto={textoDoEstado(estado)} tema={tema} />
        </View>

        <View style={[styles.grade, largo && styles.gradeLarga]}>
          {admin ? (
            <View style={[styles.lado, largo && styles.ladoLargo]}>
              <View style={[styles.controle, controlesAoLado && styles.controleAoLado]}>
                <Dial
                  meta={meta}
                  aplicada={estado.meta}
                  ligado={estado.ligado !== false}
                  pendente={metaPendente !== null && !mudou}
                  mudou={mudou}
                  faixa={faixa}
                  leitura={leitura}
                  tema={tema}
                  aoMudar={setEscolhida}
                  aoConfirmar={() => mudou && enviar('ajustar')}
                />
                <View style={styles.comandos}>
                  <Text style={[styles.rotulo, { color: tema.texto2 }]}>Comando</Text>
                  <View style={styles.par}>
                    <BotaoDeComando
                      rotulo="Ligar"
                      ativo={estado.ligado === true}
                      desligado={enviando}
                      tema={tema}
                      aoTocar={() => enviar('ligar')}
                    />
                    <BotaoDeComando
                      rotulo="Desligar"
                      ativo={estado.ligado === false}
                      desligado={enviando}
                      tema={tema}
                      aoTocar={() => enviar('desligar')}
                    />
                  </View>
                  <Text style={[styles.rotulo, { color: tema.texto2 }]}>
                    Temperatura ({TEMPERATURA_MIN} a {TEMPERATURA_MAX} °C)
                  </Text>
                  <Seletor meta={meta} tema={tema} aoMudar={setEscolhida} />
                  <Botao
                    rotulo="Ajustar"
                    principal
                    tema={tema}
                    desligado={!mudou || enviando}
                    aoTocar={() => enviar('ajustar')}
                  />
                </View>
              </View>
              {leitura !== null && (
                <LeituraDoSensor sensorId={sensorId} leitura={leitura} faixa={faixa} tema={tema} />
              )}
              {!!erro && (
                <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
                  {erro}
                </Text>
              )}
              <View style={[styles.aviso, { borderColor: tema.borda }]}>
                <ClockIcon size={16} color={tema.pendente} />
                <View style={styles.avisoTextos}>
                  <Text style={[styles.texto, { color: tema.texto }]}>
                    O comando chega ao equipamento no próximo ciclo de leitura do nó e fica pendente
                    até lá.
                  </Text>
                  <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                    {intervaloS ? `A sala lê a cada ${textoDoIntervalo(intervaloS)}. ` : ''}O
                    equipamento não devolve confirmação: o estado mostrado é o do último comando
                    entregue.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              Só administradores enviam comandos.
            </Text>
          )}
          <View style={[styles.lado, largo && styles.ladoLargo]}>
            <ListaDeComandos
              comandos={comandos}
              falhou={erroDaLista}
              largura={largo ? largura / 2 : largura}
              tema={tema}
            />
          </View>
        </View>
      </Vidro>
    </View>
  );
}

function Cabecalho({
  titulo,
  subtitulo,
  destaque,
  tema,
}: {
  titulo: string;
  subtitulo: string | null;
  destaque?: boolean;
  tema: Tema;
}) {
  return (
    <View style={styles.cabecalho}>
      <View style={[styles.icone, { borderColor: tema.borda, backgroundColor: tema.vidroForte }]}>
        <FanIcon size={20} color={tema.texto} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.h2, { color: tema.texto }]} accessibilityRole="header">
          {titulo}
        </Text>
        {subtitulo !== null && (
          // A mensagem do envio troca o subtítulo: o leitor de tela também é avisado.
          <Text
            style={[styles.pequeno, { color: destaque ? tema.pendente : tema.texto2 }]}
            aria-live="polite"
          >
            {subtitulo}
          </Text>
        )}
      </View>
    </View>
  );
}

function Estado({ ligado, texto, tema }: { ligado: boolean | null; texto: string; tema: Tema }) {
  const cor = ligado ? tema.folga : tema.texto2;
  return (
    <View style={[styles.estado, { borderColor: ligado ? cor : tema.borda }]}>
      <Text style={[styles.estadoTexto, { color: cor }]}>{texto}</Text>
    </View>
  );
}

function BotaoDeComando({
  rotulo,
  ativo,
  desligado,
  tema,
  aoTocar,
}: {
  rotulo: string;
  ativo: boolean;
  desligado: boolean;
  tema: Tema;
  aoTocar: () => void;
}) {
  const celular = useCelular();
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityHint={ativo ? 'Último comando entregue' : undefined}
      accessibilityState={{ disabled: desligado }}
      style={({ pressed }) => [
        styles.comando,
        celular && styles.comandoCelular,
        {
          borderColor: ativo ? tema.folga : tema.borda,
          backgroundColor: tema.vidroForte,
          opacity: desligado ? 0.5 : 1,
        },
        pressed && styles.pressionado,
      ]}
    >
      <PowerIcon size={15} color={tema.texto} />
      <Text style={[styles.comandoTexto, { color: tema.texto }]}>{rotulo}</Text>
    </Pressable>
  );
}

function Seletor({
  meta,
  tema,
  aoMudar,
}: {
  meta: number;
  tema: Tema;
  aoMudar: (t: number) => void;
}) {
  const celular = useCelular();
  const passo = (rotulo: string, delta: number, Icone: typeof MinusIcon) => {
    const desligado = limitarTemperatura(meta + delta) === meta;
    return (
      <Pressable
        onPress={() => aoMudar(limitarTemperatura(meta + delta))}
        disabled={desligado}
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        accessibilityState={{ disabled: desligado }}
        style={({ pressed }) => [
          styles.passo,
          celular && styles.passoCelular,
          { opacity: desligado ? 0.35 : 1 },
          pressed && styles.pressionado,
        ]}
      >
        <Icone size={16} color={tema.texto} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.seletor, { borderColor: tema.borda, backgroundColor: tema.vidroForte }]}>
      {passo('Diminuir 1 grau', -1, MinusIcon)}
      <Text style={[styles.seletorValor, { color: tema.texto }]}>
        {meta}
        <Text style={[styles.pequeno, { color: tema.texto2 }]}> °C</Text>
      </Text>
      {passo('Aumentar 1 grau', 1, PlusIcon)}
    </View>
  );
}

function LeituraDoSensor({
  sensorId,
  leitura,
  faixa,
  tema,
}: {
  sensorId: number;
  leitura: number;
  faixa: Faixa;
  tema: Tema;
}) {
  const acima = faixa.temperatura_max !== null && leitura > faixa.temperatura_max;
  const abaixo = faixa.temperatura_min !== null && leitura < faixa.temperatura_min;
  const fora = acima || abaixo;
  const cor = fora ? tema.alerta : tema.texto2;
  return (
    <View style={styles.leitura}>
      {fora && <WarningCircleIcon size={14} weight="fill" color={cor} />}
      <Text style={[styles.pequeno, { color: cor }]}>
        Sensor {sensorId} agora: {numero(leitura)} °C
        {acima ? ', acima da faixa' : abaixo ? ', abaixo da faixa' : ', dentro da faixa'}
      </Text>
    </View>
  );
}

// O dial
const LADO = 220;
const CENTRO = LADO / 2;
const RAIO = 82;
const RAIO_DA_FAIXA = 97;

const ponto = (angulo: number, raio: number) => {
  const r = (angulo * Math.PI) / 180;
  return { x: CENTRO + raio * Math.cos(r), y: CENTRO + raio * Math.sin(r) };
};
function arco(de: number, ate: number, raio: number) {
  if (ate - de < 0.01) return '';
  const a = ponto(de, raio);
  const b = ponto(ate, raio);
  return `M ${a.x} ${a.y} A ${raio} ${raio} 0 ${ate - de > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** Valor que segue o alvo com uma mola (sobra e volta); parado com movimento reduzido. */
function useMola(alvo: number) {
  const valor = useRef(new Animated.Value(alvo)).current;
  const [atual, setAtual] = useState(alvo);
  useEffect(() => {
    const id = valor.addListener(({ value }) => setAtual(value));
    return () => valor.removeListener(id);
  }, [valor]);
  useEffect(() => {
    let vale = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduzir) => {
        if (!vale) return;
        if (reduzir) return valor.setValue(alvo);
        Animated.spring(valor, {
          toValue: alvo,
          damping: 12,
          stiffness: 120,
          mass: 1,
          useNativeDriver: false,
        }).start();
      });
    return () => {
      vale = false;
      valor.stopAnimation();
    };
  }, [alvo, valor]);
  return atual;
}

/**
 * Dial de 16 a 30 °C. O arco cheio é a meta que o equipamento já recebeu; o botão é a meta
 * escolhida (tracejado enquanto não foi enviada). Por fora, a faixa da sala e a leitura atual.
 * Arrastar ou usar as setas muda a meta; Enter envia o ajuste.
 */
function Dial({
  meta,
  aplicada,
  ligado,
  pendente,
  mudou,
  faixa,
  leitura,
  tema,
  aoMudar,
  aoConfirmar,
}: {
  meta: number;
  aplicada: number | null;
  ligado: boolean;
  pendente: boolean;
  mudou: boolean;
  faixa: Faixa;
  leitura: number | null;
  tema: Tema;
  aoMudar: (t: number) => void;
  aoConfirmar: () => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const [foco, setFoco] = useState(false);
  const fim = useMola(anguloDa(aplicada ?? TEMPERATURA_MIN));
  const naEscala = (t: number) => Math.min(TEMPERATURA_MAX, Math.max(TEMPERATURA_MIN, t));
  const botao = ponto(anguloDa(meta), RAIO);
  const marca = leitura === null ? null : ponto(anguloDa(naEscala(leitura)), RAIO_DA_FAIXA + 8);
  const corDoArco = ligado ? tema.faixa[0] : tema.texto2;
  const faixaDe = faixa.temperatura_min ?? TEMPERATURA_MIN;
  const faixaAte = faixa.temperatura_max ?? TEMPERATURA_MAX;
  const comFaixa = faixa.temperatura_min !== null || faixa.temperatura_max !== null;
  const rotulo = !ligado
    ? 'Meta guardada'
    : pendente
      ? 'Aguardando'
      : mudou && aplicada !== null
        ? 'Nova meta'
        : 'Meta';

  const pelaPosicao = (e: React.PointerEvent<HTMLDivElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect();
    const escala = LADO / caixa.width;
    aoMudar(
      temperaturaDoPonto(
        (e.clientX - caixa.left) * escala - CENTRO,
        (e.clientY - caixa.top) * escala - CENTRO,
      ),
    );
  };
  const tecla = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const passos: Record<string, number> = {
      ArrowUp: meta + 1,
      ArrowRight: meta + 1,
      ArrowDown: meta - 1,
      ArrowLeft: meta - 1,
      PageUp: meta + 5,
      PageDown: meta - 5,
      Home: TEMPERATURA_MIN,
      End: TEMPERATURA_MAX,
    };
    if (e.key === 'Enter') {
      e.preventDefault();
      return aoConfirmar();
    }
    if (passos[e.key] === undefined) return;
    e.preventDefault();
    aoMudar(limitarTemperatura(passos[e.key]));
  };

  return (
    <View style={styles.dial}>
      <Svg width={LADO} height={LADO}>
        {comFaixa && (
          <Path
            d={arco(anguloDa(naEscala(faixaDe)), anguloDa(naEscala(faixaAte)), RAIO_DA_FAIXA)}
            stroke={tema.folga}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            opacity={0.7}
          />
        )}
        <Path
          d={arco(ANGULO_INICIAL, ANGULO_INICIAL + VARREDURA, RAIO)}
          stroke={tema.trilho}
          strokeWidth={10}
          strokeLinecap="round"
          fill="none"
        />
        {aplicada !== null && (
          <Path
            d={arco(ANGULO_INICIAL, fim, RAIO)}
            stroke={corDoArco}
            strokeWidth={10}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {marca && leitura !== null && (
          <Circle
            cx={marca.x}
            cy={marca.y}
            r={4}
            fill={leitura > faixaAte || leitura < faixaDe ? tema.alerta : tema.texto2}
          />
        )}
        {arrastando && (
          <Circle cx={botao.x} cy={botao.y} r={17} fill={tema.pendente} opacity={0.2} />
        )}
        {/* Anel de foco do teclado: a camada do slider não tem contorno próprio. */}
        {foco && (
          <Circle
            cx={botao.x}
            cy={botao.y}
            r={16}
            fill="none"
            stroke={tema.pendente}
            strokeWidth={2.5}
          />
        )}
        <Circle
          cx={botao.x}
          cy={botao.y}
          r={10}
          fill={mudou ? tema.fundo : pendente ? tema.pendente : tema.texto}
          stroke={mudou ? tema.pendente : tema.fundo}
          strokeWidth={3}
          strokeDasharray={mudou ? '4 3' : undefined}
        />
      </Svg>
      <View style={styles.dialCentro} pointerEvents="none">
        <Text style={[styles.dialValor, { color: ligado ? tema.texto : tema.texto2 }]}>
          {meta}
          <Text style={[styles.dialUnidade, { color: tema.texto2 }]}> °C</Text>
        </Text>
        <Text style={[styles.pequeno, { color: pendente ? tema.pendente : tema.texto2 }]}>
          {rotulo}
        </Text>
      </View>
      {/* Camada do ponteiro e do teclado: elemento do navegador, porque o painel roda na web. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Meta do ar-condicionado"
        aria-valuemin={TEMPERATURA_MIN}
        aria-valuemax={TEMPERATURA_MAX}
        aria-valuenow={meta}
        aria-valuetext={`${meta} °C${mudou ? ', ainda não enviada. Enter envia o ajuste.' : ''}`}
        onKeyDown={tecla}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setArrastando(true);
          pelaPosicao(e);
        }}
        onPointerMove={(e) => arrastando && pelaPosicao(e)}
        onPointerUp={() => setArrastando(false)}
        onPointerCancel={() => setArrastando(false)}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          outline: 'none',
          touchAction: 'none',
          cursor: arrastando ? 'grabbing' : 'grab',
        }}
      />
    </View>
  );
}

function ListaDeComandos({
  comandos,
  falhou,
  largura,
  tema,
}: {
  comandos: ComandoDeClimatizacao[] | null;
  falhou: boolean;
  largura: number;
  tema: Tema;
}) {
  const tabela = largura >= 520;
  return (
    <View style={styles.lista}>
      <View style={styles.listaTopo}>
        <Text style={[styles.h3, { color: tema.texto }]} accessibilityRole="header">
          Comandos da sala
        </Text>
        <View style={styles.leitura}>
          <ArrowsClockwiseIcon size={13} color={tema.texto2} />
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>Atualiza sozinha</Text>
        </View>
      </View>
      {falhou && (
        <Text style={[styles.pequeno, { color: tema.alerta }]}>
          A última busca dos comandos falhou. A lista é a da busca anterior.
        </Text>
      )}
      {comandos === null ? (
        !falhou && (
          <View
            accessibilityLabel="Carregando os comandos"
            style={[styles.esqueleto, { backgroundColor: tema.vidroForte }]}
          />
        )
      ) : comandos.length === 0 ? (
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          Nenhum comando enviado para esta sala.
        </Text>
      ) : (
        <View role="list" aria-label="Comandos da sala">
          {tabela && (
            <View style={[styles.linha, styles.linhaTitulo, { borderBottomColor: tema.trilho }]}>
              {['Ação', 'Temperatura', 'Usuário', 'Data e hora', 'Situação'].map((t, i) => (
                <Text
                  key={t}
                  style={[styles.titulo, COLUNAS[i], { color: tema.texto2 }]}
                  numberOfLines={1}
                >
                  {t}
                </Text>
              ))}
            </View>
          )}
          {comandos.map((c) => (
            <LinhaDoComando key={c.id} comando={c} tabela={tabela} tema={tema} />
          ))}
        </View>
      )}
    </View>
  );
}

function LinhaDoComando({
  comando,
  tabela,
  tema,
}: {
  comando: ComandoDeClimatizacao;
  tabela: boolean;
  tema: Tema;
}) {
  const l = linhaDoComando(comando);
  const Icone = comando.acao === 'ajustar' ? ThermometerIcon : PowerIcon;
  const acao = (
    <View style={[styles.acao, tabela && COLUNAS[0]]}>
      <Icone size={15} color={tema.texto2} />
      <Text style={[styles.texto, { color: tema.texto }]}>{l.acao}</Text>
    </View>
  );
  const chip = <Situacao situacao={comando.situacao} texto={l.situacao} tema={tema} />;
  if (tabela) {
    return (
      <View role="listitem" style={[styles.linha, { borderBottomColor: tema.trilho }]}>
        {acao}
        <Text style={[styles.texto, COLUNAS[1], { color: tema.texto }]}>{l.temperatura}</Text>
        <Text style={[styles.texto, COLUNAS[2], { color: tema.texto }]} numberOfLines={1}>
          {l.usuario}
        </Text>
        <Text style={[styles.pequeno, COLUNAS[3], { color: tema.texto2 }]}>{l.dataHora}</Text>
        <View style={COLUNAS[4]}>{chip}</View>
      </View>
    );
  }
  return (
    <View role="listitem" style={[styles.linhaCelular, { borderBottomColor: tema.trilho }]}>
      <View style={styles.linhaCelularTopo}>
        {acao}
        {chip}
      </View>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>
        {[comando.temperatura_c !== null && l.temperatura, l.usuario, l.dataHora]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

function Situacao({
  situacao,
  texto,
  tema,
}: {
  situacao: ComandoDeClimatizacao['situacao'];
  texto: string;
  tema: Tema;
}) {
  const cor =
    situacao === 'pendente' ? tema.pendente : situacao === 'entregue' ? tema.folga : tema.texto2;
  const Icone = situacao === 'entregue' ? CheckIcon : ClockIcon;
  return (
    <View
      style={[
        styles.chip,
        {
          borderColor: situacao === 'expirado' ? tema.borda : cor,
          backgroundColor: situacao === 'pendente' ? tema.pendenteFundo : 'transparent',
        },
      ]}
    >
      <Icone size={12} weight="bold" color={cor} />
      <Text style={[styles.chipTexto, { color: cor }]}>{texto}</Text>
    </View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const colunas = StyleSheet.create({
  acao: { flex: 1.1, minWidth: 0 },
  temperatura: { flex: 0.9, minWidth: 0 },
  usuario: { flex: 1.4, minWidth: 0 },
  dataHora: { flex: 1.1, minWidth: 0 },
  situacao: { flex: 1.2, minWidth: 0, alignItems: 'flex-end' },
});
// Na ordem da tabela: ação, temperatura, usuário, data e hora, situação.
const COLUNAS = [
  colunas.acao,
  colunas.temperatura,
  colunas.usuario,
  colunas.dataHora,
  colunas.situacao,
];

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  cartao: { gap: 22 },
  vazio: { gap: 10, alignItems: 'flex-start' },
  vazioTitulo: { fontSize: 17, fontWeight: '500', marginTop: 6 },
  topo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  icone: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h2: { fontSize: 22, fontWeight: '400', letterSpacing: -0.4 },
  h3: { fontSize: 16, fontWeight: '500' },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  texto: { fontSize: 14, lineHeight: 20, ...numeros },
  rotulo: { fontSize: 13 },
  estado: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  estadoTexto: { fontSize: 13, fontWeight: '600', ...numeros },
  grade: { gap: 24 },
  gradeLarga: { flexDirection: 'row', alignItems: 'flex-start' },
  lado: { gap: 16, minWidth: 0 },
  ladoLargo: { flex: 1 },
  controle: { gap: 18, alignItems: 'center' },
  controleAoLado: { flexDirection: 'row', alignItems: 'center' },
  comandos: { flex: 1, gap: 10, alignSelf: 'stretch', minWidth: 0 },
  par: { flexDirection: 'row', gap: 8 },
  comando: {
    flex: 1,
    height: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  comandoCelular: { height: ALVO_DE_TOQUE },
  comandoTexto: { fontSize: 14, fontWeight: '600' },
  pressionado: { transform: [{ scale: 0.97 }] },
  seletor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 4,
    height: 46,
  },
  passo: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  passoCelular: { width: ALVO_DE_TOQUE, height: ALVO_DE_TOQUE },
  seletorValor: { fontSize: 20, fontWeight: '300', ...numeros },
  leitura: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aviso: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 18, padding: 16 },
  avisoTextos: { flex: 1, gap: 4 },
  dial: { width: LADO, height: LADO },
  dialCentro: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialValor: { fontSize: 46, fontWeight: '300', letterSpacing: -1.5, ...numeros },
  dialUnidade: { fontSize: 16, fontWeight: '400' },
  lista: { gap: 10 },
  listaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  esqueleto: { height: 180, borderRadius: 16, opacity: 0.7 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderBottomWidth: 1,
  },
  linhaTitulo: { minHeight: 34 },
  titulo: { fontSize: 12 },
  acao: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linhaCelular: { gap: 4, paddingVertical: 10, borderBottomWidth: 1 },
  linhaCelularTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipTexto: { fontSize: 12, fontWeight: '600' },
});
