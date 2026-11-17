import { Stack } from 'expo-router';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { EyeSlashIcon } from 'phosphor-react-native/src/icons/EyeSlash';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { abrirSessao, ErroDaApi, entrar, sessaoExpirou } from '../src/api';
import { BotaoTema } from '../src/componentes/BotaoTema';
import {
  type ControleIsotermas,
  Isotermas,
  movimentoReduzido,
  type TipoDoPulso,
} from '../src/componentes/Isotermas';
import { Logo, SimboloEmOnda } from '../src/componentes/Logo';
import { Surgir } from '../src/componentes/Surgir';
import type { Tema } from '../src/tema';
import { useTema } from '../src/useTema';

const FRASE = 'Temperatura e umidade de cada sala, em um olhar.';

// Atrás do formulário as curvas ficam fracas, para o texto continuar legível.
const MASCARA_LARGA = 'linear-gradient(90deg, rgba(0,0,0,0.16) 34%, #000 58%)';
const MASCARA_ESTREITA = 'linear-gradient(180deg, #000 0, rgba(0,0,0,0.14) 170px)';

// Centro do ícone da marca, em fração da tela.
const CENTRO_DO_ICONE = { x: 0.7, y: 0.42 };

type Fase = 'parado' | 'enviando' | 'entrou';

const centroDe = (elemento: unknown) => {
  const caixa = (elemento as HTMLElement | null)?.getBoundingClientRect?.();
  return caixa ? { x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2 } : null;
};

/**
 * Tela de login (#112). A leitura segue uma linha só: marca, título, campos e botão, direto na
 * página. O mapa térmico fica ao lado como uma imagem. A sessão só abre depois da saída, e aí o
 * layout troca de tela.
 */
export default function Login() {
  const { escuro, tema, trocar } = useTema();
  const { width, height } = useWindowDimensions();
  const largo = width >= 1000;
  const margem = largo ? Math.max(Math.min(width * 0.055, 88), 40) : 20;

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [fase, setFase] = useState<Fase>('parado');
  const [erro, setErro] = useState<string | null>(null);
  const [campoComErro, setCampoComErro] = useState<'email' | 'senha' | 'ambos' | null>(null);

  const isotermas = useRef<ControleIsotermas>(null);
  const formulario = useRef<View>(null);
  const botao = useRef<View>(null);
  const campoEmail = useRef<TextInput>(null);
  const campoSenha = useRef<TextInput>(null);
  const tremor = useRef(new Animated.Value(0)).current;
  const saida = useRef(new Animated.Value(0)).current;

  useEstiloDoNavegador(tema, escuro);

  const larguraDoIcone = Math.min(width * 0.27, 440);
  // As curvas somem aos poucos atrás do ícone, para nenhuma cortar o símbolo.
  useEffect(() => {
    isotermas.current?.clareira(
      largo
        ? {
            x: width * CENTRO_DO_ICONE.x,
            y: height * CENTRO_DO_ICONE.y,
            rx: larguraDoIcone * 0.85,
            ry: larguraDoIcone * 0.55,
          }
        : null,
    );
  }, [largo, width, height, larguraDoIcone]);

  const pulsarDe = (elemento: unknown, tipo: TipoDoPulso) => {
    const centro = centroDe(elemento);
    if (centro) isotermas.current?.pulso(centro.x, centro.y, tipo);
  };

  // A onda de cada tecla sai perto do cursor, não do meio do campo.
  const aoDigitar = (entrada: TextInput | null, tamanho: number) => {
    const caixa = (entrada as unknown as HTMLElement | null)?.getBoundingClientRect?.();
    if (!caixa) return;
    const x = caixa.left + Math.min(16 + tamanho * 8.4, caixa.width - 16);
    isotermas.current?.pulso(x, caixa.top + caixa.height / 2, 'tecla');
  };

  const falhar = (mensagem: string, qual: 'email' | 'senha' | 'ambos' | 'nenhum') => {
    setErro(mensagem);
    setCampoComErro(qual === 'nenhum' ? null : qual);
    pulsarDe(formulario.current, 'erro');
    if (movimentoReduzido()) return;
    // Mola com velocidade inicial: uma oscilação amortecida, sem quinas entre os movimentos.
    tremor.setValue(0);
    Animated.spring(tremor, {
      toValue: 0,
      velocity: 120,
      tension: 170,
      friction: 11,
      useNativeDriver: false,
    }).start();
  };

  const enviar = async () => {
    if (fase !== 'parado') return;
    const emailLimpo = email.trim();
    if (!emailLimpo) {
      falhar('Informe o seu e-mail.', 'email');
      campoEmail.current?.focus();
      return;
    }
    if (!senha) {
      falhar('Informe a sua senha.', 'senha');
      campoSenha.current?.focus();
      return;
    }

    setErro(null);
    setCampoComErro(null);
    setFase('enviando');
    pulsarDe(botao.current, 'envio');
    const ondas = setInterval(() => pulsarDe(botao.current, 'envio'), 950);
    try {
      const sessao = await entrar(emailLimpo, senha);
      setFase('entrou');
      pulsarDe(botao.current, 'ok');
      isotermas.current?.apagar();
      const espera = movimentoReduzido() ? 0 : 900;
      Animated.timing(saida, {
        toValue: 1,
        delay: 220,
        duration: Math.max(espera - 220, 0),
        easing: Easing.bezier(0.45, 0, 0.55, 1),
        useNativeDriver: false,
      }).start();
      setTimeout(() => abrirSessao(sessao.token), espera);
    } catch (e) {
      setFase('parado');
      if (e instanceof ErroDaApi && e.status < 500) {
        falhar(`${e.message[0].toUpperCase()}${e.message.slice(1)}.`, 'ambos');
        campoSenha.current?.focus();
      } else if (e instanceof ErroDaApi) {
        falhar('A API respondeu com erro. Tente de novo em instantes.', 'nenhum');
      } else {
        // Falha de rede ou tempo esgotado: a culpa não é da senha digitada.
        falhar('Não foi possível falar com a API. Verifique a conexão e tente de novo.', 'nenhum');
      }
    } finally {
      clearInterval(ondas);
    }
  };

  const opacidade = saida.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  const expirou = sessaoExpirou() && !erro;
  const ocupado = fase !== 'parado';

  return (
    <View style={[styles.tela, largo && styles.telaLarga, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Entrar | TermoLOG' }} />
      <Isotermas ref={isotermas} tema={tema} mascara={largo ? MASCARA_LARGA : MASCARA_ESTREITA} />

      <ScrollView
        style={
          largo
            ? { flexGrow: 0, width: Math.max(Math.min(width * 0.42, 640), 480) }
            : styles.colunaEstreita
        }
        contentContainerStyle={[styles.coluna, { paddingHorizontal: margem }]}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[styles.marca, { opacity: opacidade }]}>
          <Surgir>
            <Logo tema={tema} largura={116} />
          </Surgir>
          <BotaoTema escuro={escuro} tema={tema} aoTrocar={trocar} />
        </Animated.View>

        <Animated.View
          ref={formulario}
          style={[styles.formulario, { opacity: opacidade, transform: [{ translateX: tremor }] }]}
        >
          <Surgir ordem={2} style={styles.cabecalho}>
            <Text role="heading" aria-level={1} style={[styles.titulo, { color: tema.texto }]}>
              Entrar no painel
            </Text>
            <Text style={[styles.subtitulo, { color: tema.texto2 }]}>
              Use o e-mail e a senha da sua conta.
            </Text>
          </Surgir>

          <View style={styles.campos}>
            <Surgir ordem={4}>
              <Campo
                ref={campoEmail}
                rotulo="E-mail"
                tema={tema}
                valor={email}
                comErro={campoComErro === 'email' || campoComErro === 'ambos'}
                desativado={ocupado}
                aoMudar={(texto) => {
                  setEmail(texto);
                  aoDigitar(campoEmail.current, texto.length);
                }}
                aoConfirmar={() => campoSenha.current?.focus()}
                propsDoCampo={{
                  autoComplete: 'email',
                  inputMode: 'email',
                  autoCapitalize: 'none',
                  autoCorrect: false,
                  autoFocus: true,
                  returnKeyType: 'next',
                }}
              />
            </Surgir>
            <Surgir ordem={6}>
              <Campo
                ref={campoSenha}
                rotulo="Senha"
                tema={tema}
                valor={senha}
                secreto
                comErro={campoComErro === 'senha' || campoComErro === 'ambos'}
                desativado={ocupado}
                aoMudar={(texto) => {
                  setSenha(texto);
                  aoDigitar(campoSenha.current, texto.length);
                }}
                aoConfirmar={enviar}
                propsDoCampo={{ autoComplete: 'current-password', returnKeyType: 'go' }}
              />
            </Surgir>
          </View>

          {/* Altura reservada: a mensagem aparece sem empurrar o botão. */}
          <View style={styles.aviso} accessibilityRole="alert" aria-live="assertive">
            {erro && (
              <Surgir style={styles.linhaDoAviso}>
                <WarningCircleIcon size={17} color={tema.alerta} weight="fill" />
                <Text style={[styles.textoDoAviso, { color: tema.alerta }]}>{erro}</Text>
              </Surgir>
            )}
            {expirou && (
              <Surgir style={styles.linhaDoAviso}>
                <Text style={[styles.textoDoAviso, { color: tema.texto2 }]}>
                  Sua sessão expirou. Entre de novo para continuar.
                </Text>
              </Surgir>
            )}
          </View>

          <Surgir ordem={8}>
            <BotaoEntrar ref={botao} tema={tema} fase={fase} aoApertar={enviar} />
          </Surgir>
        </Animated.View>
      </ScrollView>

      {largo && (
        <Animated.View
          style={[
            styles.icone,
            {
              left: CENTRO_DO_ICONE.x * width,
              top: CENTRO_DO_ICONE.y * height,
              opacity: opacidade,
            },
          ]}
          pointerEvents="none"
          aria-hidden
        >
          <IconeVivo tema={tema} largura={larguraDoIcone} />
        </Animated.View>
      )}

      {largo && (
        <Animated.View style={[styles.lado, { opacity: opacidade }]} pointerEvents="none">
          <Frase texto={FRASE} tamanho={Math.min(44, width * 0.031)} />
        </Animated.View>
      )}
    </View>
  );
}

/** Ícone da marca: entra com mola, e a onda fica por conta do próprio símbolo. */
function IconeVivo({ tema, largura }: { tema: Tema; largura: number }) {
  const entrada = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (movimentoReduzido()) {
      entrada.setValue(1);
      return;
    }
    const chegada = Animated.spring(entrada, {
      toValue: 1,
      delay: 350,
      friction: 12,
      tension: 26,
      useNativeDriver: false,
    });
    chegada.start();
    return () => chegada.stop();
  }, [entrada]);

  return (
    <Animated.View
      style={{
        opacity: entrada,
        transform: [
          { translateX: '-50%' },
          { translateY: '-50%' },
          { scale: entrada.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
      }}
    >
      <SimboloEmOnda cor={tema.marca} largura={largura} />
    </Animated.View>
  );
}

/** Frase em que cada palavra sobe de trás de uma máscara, uma depois da outra, com mola. */
function Frase({ texto, tamanho }: { texto: string; tamanho: number }) {
  const { tema } = useTema();
  const palavras = texto.split(' ');
  const valores = useRef(palavras.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (movimentoReduzido()) {
      for (const v of valores) v.setValue(1);
      return;
    }
    const entrada = Animated.stagger(
      70,
      valores.map((v) =>
        Animated.spring(v, { toValue: 1, friction: 14, tension: 32, useNativeDriver: false }),
      ),
    );
    const espera = setTimeout(() => entrada.start(), 700);
    return () => {
      clearTimeout(espera);
      entrada.stop();
    };
  }, [valores]);

  return (
    <View style={styles.frase} role="img" aria-label={texto}>
      {palavras.map((palavra, i) => (
        <View key={palavra} style={styles.mascara} aria-hidden>
          <Animated.Text
            style={[
              styles.palavra,
              {
                color: tema.texto,
                fontSize: tamanho,
                lineHeight: tamanho * 1.14,
                opacity: valores[i],
                transform: [
                  {
                    translateY: valores[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [tamanho * 1.1, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {palavra}
          </Animated.Text>
        </View>
      ))}
    </View>
  );
}

function Campo({
  ref,
  rotulo,
  tema,
  valor,
  secreto,
  comErro,
  desativado,
  aoMudar,
  aoConfirmar,
  propsDoCampo,
}: {
  ref: Ref<TextInput>;
  rotulo: string;
  tema: Tema;
  valor: string;
  secreto?: boolean;
  comErro: boolean;
  desativado: boolean;
  aoMudar: (texto: string) => void;
  aoConfirmar: () => void;
  propsDoCampo: React.ComponentProps<typeof TextInput>;
}) {
  const [emFoco, setEmFoco] = useState(false);
  const [mostrar, setMostrar] = useState(false);
  const foco = useRef(new Animated.Value(0)).current;
  const idDoDegrade = useId();

  useEffect(() => {
    Animated.spring(foco, {
      toValue: emFoco ? 1 : 0,
      friction: 14,
      tension: 60,
      useNativeDriver: false,
    }).start();
  }, [emFoco, foco]);

  const Olho = mostrar ? EyeSlashIcon : EyeIcon;
  return (
    <View style={styles.campo}>
      <Text style={[styles.rotulo, { color: emFoco ? tema.texto : tema.texto2 }]}>{rotulo}</Text>
      <View
        style={[
          styles.caixa,
          {
            backgroundColor: tema.vidroForte,
            borderColor: comErro ? tema.alerta : emFoco ? tema.texto2 : tema.borda,
          },
        ]}
      >
        <TextInput
          ref={ref}
          {...propsDoCampo}
          value={valor}
          onChangeText={aoMudar}
          onSubmitEditing={aoConfirmar}
          onFocus={() => setEmFoco(true)}
          onBlur={() => setEmFoco(false)}
          editable={!desativado}
          secureTextEntry={secreto && !mostrar}
          accessibilityLabel={rotulo}
          aria-invalid={comErro}
          style={[styles.entrada, { color: tema.texto }, desativado && styles.desativado]}
        />
        {secreto && (
          <Pressable
            onPress={() => setMostrar((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={mostrar ? 'Esconder senha' : 'Mostrar senha'}
            style={({ pressed }) => [styles.olho, pressed && styles.apertado]}
          >
            <Olho size={19} color={tema.texto2} />
          </Pressable>
        )}
        {/* Filete da faixa: a mesma escala de cor do painel, abrindo a partir da esquerda. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.filete, { opacity: foco, transform: [{ scaleX: foco }] }]}
        >
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={idDoDegrade} x1="0" x2="1" y1="0" y2="0">
                <Stop offset="0" stopColor={tema.faixa[0]} />
                <Stop offset="1" stopColor={tema.faixa[1]} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${idDoDegrade})`} />
          </Svg>
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * Botão com atração magnética no ponteiro. Enviando, um filete sobe como o mercúrio do
 * termômetro; ao entrar, ele vira a cor de "dentro da faixa" e a seta vira um check.
 */
function BotaoEntrar({
  ref,
  tema,
  fase,
  aoApertar,
}: {
  ref: Ref<View>;
  tema: Tema;
  fase: Fase;
  aoApertar: () => void;
}) {
  const area = useRef<View>(null);
  const ima = useRef(new Animated.ValueXY()).current;
  const mercurio = useRef(new Animated.Value(0)).current;
  const pronto = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const elemento = area.current as unknown as HTMLElement | null;
    if (!elemento?.addEventListener || movimentoReduzido()) return;
    const puxar = (para: { x: number; y: number }) =>
      Animated.spring(ima, {
        toValue: para,
        friction: 10,
        tension: 55,
        useNativeDriver: false,
      }).start();
    const mover = (e: PointerEvent) => {
      const caixa = elemento.getBoundingClientRect();
      puxar({
        x: ((e.clientX - caixa.left) / caixa.width - 0.5) * 12,
        y: ((e.clientY - caixa.top) / caixa.height - 0.5) * 7,
      });
    };
    const soltar = () => puxar({ x: 0, y: 0 });
    elemento.addEventListener('pointermove', mover);
    elemento.addEventListener('pointerleave', soltar);
    return () => {
      elemento.removeEventListener('pointermove', mover);
      elemento.removeEventListener('pointerleave', soltar);
    };
  }, [ima]);

  useEffect(() => {
    if (fase === 'enviando') {
      mercurio.setValue(0);
      // Sobe rápido e desacelera: não finge saber quanto falta.
      Animated.timing(mercurio, {
        toValue: 0.92,
        duration: 2600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else if (fase === 'entrou') {
      Animated.parallel([
        Animated.timing(mercurio, { toValue: 1, duration: 160, useNativeDriver: false }),
        Animated.spring(pronto, { toValue: 1, friction: 6, tension: 140, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.timing(mercurio, { toValue: 0, duration: 220, useNativeDriver: false }).start();
    }
  }, [fase, mercurio, pronto]);

  const rotulo = fase === 'parado' ? 'Entrar' : fase === 'enviando' ? 'Entrando' : 'Pronto';
  return (
    <View ref={ref}>
      <View ref={area} style={styles.areaDoBotao}>
        <Animated.View style={{ transform: ima.getTranslateTransform() }}>
          <Pressable
            onPress={aoApertar}
            disabled={fase !== 'parado'}
            accessibilityRole="button"
            accessibilityState={{ busy: fase === 'enviando' }}
            accessibilityLabel={rotulo}
            style={({ pressed }) => [styles.pressionavel, pressed && styles.apertado]}
          >
            <Animated.View
              style={[
                styles.botao,
                {
                  backgroundColor: pronto.interpolate({
                    inputRange: [0, 1],
                    outputRange: [tema.texto, tema.folga],
                  }),
                },
              ]}
            >
              <Text style={[styles.textoDoBotao, { color: tema.fundo }]}>{rotulo}</Text>
              {fase === 'entrou' ? (
                <Animated.View style={{ transform: [{ scale: pronto }] }}>
                  <CheckIcon size={18} color={tema.fundo} weight="bold" />
                </Animated.View>
              ) : (
                <ArrowRightIcon size={18} color={tema.fundo} />
              )}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.mercurio,
                  {
                    opacity: mercurio.interpolate({
                      inputRange: [0, 0.02],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [{ scaleX: mercurio }],
                  },
                ]}
              >
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Defs>
                    <LinearGradient id="mercurio" x1="0" x2="1" y1="0" y2="0">
                      <Stop offset="0" stopColor={tema.faixa[0]} />
                      <Stop offset="1" stopColor={tema.faixa[1]} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#mercurio)" />
                </Svg>
              </Animated.View>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

// O que o navegador pinta por conta própria: autopreenchimento, seleção, cursor e foco. O foco
// fica em CSS porque o Pressable não recebe blur ao ser desabilitado durante o envio.
function useEstiloDoNavegador(tema: Tema, escuro: boolean) {
  useEffect(() => {
    const estilo = document.createElement('style');
    estilo.textContent = `
input:-webkit-autofill, input:-webkit-autofill:focus {
  -webkit-text-fill-color: ${tema.texto};
  caret-color: ${tema.texto};
  transition: background-color 99999s;
}
input { caret-color: ${tema.faixa[escuro ? 1 : 0]}; }
button:focus-visible { outline: 2px solid ${tema.faixa[0]}; outline-offset: 2px; }
::selection { background: ${tema.faixa[0]}55; }`;
    document.head.append(estilo);
    return () => estilo.remove();
  }, [tema, escuro]);
}

// Espaços em múltiplos de 4: apertado dentro de um grupo, generoso entre os grupos.
const styles = StyleSheet.create({
  tela: { flex: 1, overflow: 'hidden' },
  telaLarga: { flexDirection: 'row' },
  colunaEstreita: { flex: 1 },
  coluna: { flexGrow: 1, paddingTop: 24, paddingBottom: 32, gap: 32 },
  marca: {
    width: '100%',
    maxWidth: 392,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Margem automática em cima e embaixo: centraliza no que sobra e nunca corta em tela baixa.
  formulario: { width: '100%', maxWidth: 392, marginVertical: 'auto' },
  cabecalho: { gap: 8, marginBottom: 32 },
  titulo: { fontSize: 38, lineHeight: 44, fontWeight: '400', letterSpacing: -1 },
  subtitulo: { fontSize: 16, lineHeight: 24 },
  campos: { gap: 20 },
  campo: { gap: 8 },
  rotulo: { fontSize: 14 },
  caixa: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  entrada: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingHorizontal: 16,
    fontSize: 16,
    outlineStyle: 'none',
  } as object,
  desativado: { opacity: 0.6 },
  olho: {
    width: 44,
    height: 44,
    marginRight: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filete: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    transformOrigin: 'left',
  } as object,
  aviso: { minHeight: 44, justifyContent: 'center', paddingVertical: 12 },
  linhaDoAviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  textoDoAviso: { flex: 1, fontSize: 14, lineHeight: 20 },
  // Margem para a atração magnética não sair da área que detecta o ponteiro.
  areaDoBotao: { margin: -10, padding: 10 },
  pressionavel: { borderRadius: 999 },
  apertado: { transform: [{ scale: 0.975 }] },
  botao: {
    height: 52,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  textoDoBotao: { fontSize: 16, fontWeight: '600' },
  mercurio: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    transformOrigin: 'left',
  } as object,
  icone: { position: 'absolute' },
  lado: { flex: 1, minWidth: 0, justifyContent: 'flex-end', padding: 56 },
  frase: {
    maxWidth: 620,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
  },
  mascara: { overflow: 'hidden' },
  palavra: { fontWeight: '300', letterSpacing: -0.8 },
});
