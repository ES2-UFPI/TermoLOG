import { Stack } from 'expo-router';
import { ArrowSquareOutIcon } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { BellRingingIcon } from 'phosphor-react-native/src/icons/BellRinging';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { TelegramLogoIcon } from 'phosphor-react-native/src/icons/TelegramLogo';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  type Canal,
  ErroDaApi,
  getCanais,
  getUsuarioLogado,
  salvarCanais,
  type UsuarioLogado,
  vincularTelegram,
} from '../src/api';
import { repetir } from '../src/busca';
import {
  corpoDosCanais,
  erroDoEmail,
  erroDoServidor,
  errosDoRascunho,
  mesclarDoServidor,
  mudou,
  type Rascunho,
  rascunhoDosCanais,
  tempoRestante,
} from '../src/canais';
import { BarraDeAlteracoes } from '../src/componentes/BarraDeAlteracoes';
import { Expansivel } from '../src/componentes/Expansivel';
import { Interruptor } from '../src/componentes/Interruptor';
import { LinhaDoCanal } from '../src/componentes/LinhaDoCanal';
import { Pulso } from '../src/componentes/Pulso';
import { Botao } from '../src/componentes/SensoresDaSala';
import { type Mensagem, Toast } from '../src/componentes/Toast';
import { Vidro } from '../src/componentes/Vidro';
import type { Tema } from '../src/tema';
import { ALVO_DE_TOQUE, LARGURA_DO_CELULAR } from '../src/toque';
import { useTema } from '../src/useTema';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; usuario: UsuarioLogado | null; salvo: Rascunho };

/** Tela de perfil (#118): por quais canais a pessoa quer receber os alertas. */
export default function Perfil() {
  const { escuro, tema } = useTema();
  const { width } = useWindowDimensions();
  const margem = width >= LARGURA_DO_CELULAR ? 40 : 16;
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const carregar = useCallback(() => {
    setEstado({ fase: 'carregando' });
    // A conta só serve para sugerir o e-mail: se falhar, a tela abre sem a sugestão.
    Promise.all([getCanais(), getUsuarioLogado().catch(() => null)])
      .then(([canais, usuario]) =>
        setEstado({
          fase: 'pronto',
          usuario,
          salvo: rascunhoDosCanais(canais, usuario?.email),
        }),
      )
      .catch((erro: Error) => setEstado({ fase: 'erro', mensagem: erro.message }));
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Perfil | TermoLOG' }} />
      {estado.fase === 'pronto' ? (
        <Formulario
          usuario={estado.usuario}
          inicial={estado.salvo}
          margem={margem}
          tema={tema}
          escuro={escuro}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: margem, paddingTop: 12 }}>
          <View style={styles.corpo}>
            <Titulo tema={tema} />
            {estado.fase === 'carregando' && (
              <View
                accessibilityLabel="Carregando os canais"
                style={[styles.esqueleto, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
              />
            )}
            {estado.fase === 'erro' && (
              <Vidro tema={tema} style={styles.aviso}>
                <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
                  Não foi possível carregar os canais
                </Text>
                <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                  Verifique se a API está no ar e tente de novo. ({estado.mensagem})
                </Text>
                <Botao rotulo="Tentar de novo" tema={tema} aoTocar={carregar} />
              </Vidro>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Titulo({ tema, usuario }: { tema: Tema; usuario?: UsuarioLogado | null }) {
  const perfil = usuario?.perfil === 'visualizador' ? 'Visualizador' : 'Administrador';
  return (
    <View style={styles.titulo}>
      <Text style={[styles.h1, { color: tema.texto }]} accessibilityRole="header">
        Perfil
      </Text>
      {!!usuario && (
        <>
          <Text style={[styles.texto, { color: tema.texto }]}>{usuario.nome}</Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {usuario.perfil ? `${usuario.email} · ${perfil}` : usuario.email}
          </Text>
        </>
      )}
    </View>
  );
}

type Vinculo =
  | { fase: 'nenhum' }
  | { fase: 'criando' }
  | { fase: 'esperando'; link: string; expiraEm: string; chatAntes: string | null }
  | { fase: 'expirado' }
  | { fase: 'erro'; mensagem: string };

function Formulario({
  usuario,
  inicial,
  margem,
  tema,
  escuro,
}: {
  usuario: UsuarioLogado | null;
  inicial: Rascunho;
  margem: number;
  tema: Tema;
  escuro: boolean;
}) {
  const [salvo, setSalvo] = useState(inicial);
  const [rascunho, setRascunho] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erroEmail, setErroEmail] = useState('');
  const [erroGeral, setErroGeral] = useState('');
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [vinculo, setVinculo] = useState<Vinculo>({ fase: 'nenhum' });
  const [agora, setAgora] = useState(Date.now());
  const emailRef = useRef<TextInput>(null);
  const tremor = useRef(new Animated.Value(0)).current;
  const alterado = mudou(rascunho, salvo);

  // Campo com erro: uma tremida curta chama o olhar (e nada se mexe com movimento reduzido).
  const tremer = () =>
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir) return;
      const passo = (toValue: number) =>
        Animated.timing(tremor, { toValue, duration: 55, useNativeDriver: false });
      Animated.sequence([passo(-7), passo(7), passo(-4), passo(4), passo(0)]).start();
    });

  const mostrarErroDoEmail = (texto: string) => {
    setErroEmail(texto);
    tremer();
  };

  const ligarEmail = (ligado: boolean) => {
    setRascunho({ ...rascunho, email: { ...rascunho.email, ligado } });
    setErroEmail('');
    // Espera o campo abrir para focar.
    if (ligado) setTimeout(() => emailRef.current?.focus(), 120);
  };

  // Depois do link, o bot do Telegram cria o canal sozinho no servidor: a tela pergunta
  // de poucos em poucos segundos até ele aparecer, e só enquanto o link vale.
  useEffect(() => {
    if (vinculo.fase !== 'esperando') return;
    const { chatAntes } = vinculo;
    // `repetir` só cancela o próximo ciclo: uma busca já em andamento ainda responde depois
    // do cleanup (a pessoa cancelou, o link venceu ou a tela saiu), e não pode mexer na tela.
    let ativo = true;
    const parar = repetir(
      () =>
        getCanais().then((canais) => {
          if (!ativo) return;
          const chat = canais.find((c) => c.tipo === 'telegram')?.destino;
          if (!chat || chat === chatAntes) return;
          setSalvo((s) => mesclarDoServidor(s, canais));
          setRascunho((x) => mesclarDoServidor(x, canais));
          setVinculo({ fase: 'nenhum' });
          setMensagem({ id: Date.now(), texto: 'Telegram vinculado' });
        }),
      3000,
    );
    return () => {
      ativo = false;
      parar();
    };
  }, [vinculo]);

  useEffect(() => {
    if (vinculo.fase !== 'esperando') return;
    const { expiraEm } = vinculo;
    const tique = setInterval(() => {
      setAgora(Date.now());
      if (tempoRestante(expiraEm) === null) setVinculo({ fase: 'expirado' });
    }, 1000);
    return () => clearInterval(tique);
  }, [vinculo]);

  const vincular = () => {
    setVinculo({ fase: 'criando' });
    vincularTelegram()
      .then((v) => {
        setAgora(Date.now());
        setVinculo({
          fase: 'esperando',
          link: v.link,
          expiraEm: v.expira_em,
          chatAntes: rascunho.telegram.chat,
        });
      })
      .catch((erro: Error) =>
        setVinculo({
          fase: 'erro',
          mensagem:
            erro instanceof ErroDaApi && erro.status === 503
              ? 'O Telegram ainda não está configurado neste servidor. Peça a um administrador.'
              : `Não deu para gerar o link: ${erro.message}`,
        }),
      );
  };

  const descartar = () => {
    setRascunho(salvo);
    setErroEmail('');
    setErroGeral('');
  };

  const salvar = async () => {
    const { email } = errosDoRascunho(rascunho);
    if (email) {
      mostrarErroDoEmail(email);
      emailRef.current?.focus();
      return;
    }
    setSalvando(true);
    setErroGeral('');
    let enviado: Canal[] = [];
    try {
      // O bot pode ter vinculado o Telegram depois da última busca, e o PUT troca a lista
      // inteira: traz o que o servidor tem antes de enviar. Isso encurta a corrida, mas não a
      // fecha (o bot ainda pode criar o canal entre esta busca e o PUT): a correção de verdade
      // é do backend.
      const atual = mesclarDoServidor(rascunho, await getCanais());
      enviado = corpoDosCanais(atual);
      const novo = rascunhoDosCanais(await salvarCanais(enviado), usuario?.email);
      setSalvo(novo);
      setRascunho(novo);
      setVinculo((v) => (v.fase === 'esperando' ? v : { fase: 'nenhum' }));
      setMensagem({ id: Date.now(), texto: 'Canais salvos' });
    } catch (erro) {
      if (erro instanceof ErroDaApi && erro.status === 422) {
        const onde = erroDoServidor(erro.corpo, enviado);
        if (onde.email) mostrarErroDoEmail(onde.email);
        else setErroGeral(`A API recusou: ${onde.geral ?? erro.message}`);
      } else {
        setErroGeral(`Não deu para salvar: ${(erro as Error).message}`);
      }
    } finally {
      setSalvando(false);
    }
  };

  const push = rascunho.outros.find((c) => c.tipo === 'push');
  const comTelegramVinculado = rascunho.telegram.chat !== null;
  const restante = vinculo.fase === 'esperando' ? tempoRestante(vinculo.expiraEm, agora) : null;

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: margem, paddingTop: 12, paddingBottom: 120 }}>
        <View style={styles.corpo}>
          <Titulo tema={tema} usuario={usuario} />

          <Vidro tema={tema} ordem={0} style={styles.painel}>
            <View style={styles.painelTopo}>
              <Text style={[styles.avisoTitulo, { color: tema.texto }]} accessibilityRole="header">
                Canais de alerta
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Escolha por onde avisar quando uma sala sair da faixa. Pode ligar mais de um: se um
                falhar, os outros continuam.
              </Text>
            </View>

            <LinhaDoCanal
              icone={<EnvelopeSimpleIcon size={20} color={tema.texto} />}
              titulo="E-mail"
              descricao="Um e-mail a cada alerta, com a sala, o sensor e a leitura."
              tema={tema}
              direita={
                <Interruptor
                  ligado={rascunho.email.ligado}
                  aoMudar={ligarEmail}
                  rotulo="E-mail"
                  tema={tema}
                />
              }
            >
              <Expansivel aberto={rascunho.email.ligado} altura={110}>
                <Animated.View style={[styles.campo, { transform: [{ translateX: tremor }] }]}>
                  <Text style={[styles.rotulo, { color: tema.texto2 }]}>Enviar para</Text>
                  <TextInput
                    ref={emailRef}
                    value={rascunho.email.destino}
                    onChangeText={(texto) => {
                      setRascunho({ ...rascunho, email: { ...rascunho.email, destino: texto } });
                      setErroEmail('');
                    }}
                    onBlur={() =>
                      rascunho.email.ligado &&
                      setErroEmail(erroDoEmail(rascunho.email.destino) ?? '')
                    }
                    onSubmitEditing={salvar}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    maxLength={254}
                    placeholder="nome@empresa.com"
                    placeholderTextColor={tema.texto2}
                    accessibilityLabel="E-mail para os alertas"
                    aria-invalid={!!erroEmail}
                    style={[
                      styles.entrada,
                      {
                        color: tema.texto,
                        backgroundColor: tema.vidroForte,
                        borderColor: erroEmail ? tema.alerta : tema.borda,
                      },
                    ]}
                  />
                  {!!erroEmail && (
                    <Text
                      style={[styles.pequeno, { color: tema.alerta }]}
                      accessibilityRole="alert"
                    >
                      {erroEmail}
                    </Text>
                  )}
                </Animated.View>
              </Expansivel>
            </LinhaDoCanal>

            <LinhaDoCanal
              icone={<TelegramLogoIcon size={20} color={tema.texto} />}
              titulo="Telegram"
              descricao={
                comTelegramVinculado
                  ? `Chat vinculado (${rascunho.telegram.chat}).`
                  : 'Receba o alerta no seu chat do Telegram.'
              }
              tema={tema}
              direita={
                comTelegramVinculado ? (
                  <Interruptor
                    ligado={rascunho.telegram.ligado}
                    aoMudar={(ligado) =>
                      setRascunho({ ...rascunho, telegram: { ...rascunho.telegram, ligado } })
                    }
                    rotulo="Telegram"
                    tema={tema}
                  />
                ) : (
                  <Botao
                    rotulo="Vincular Telegram"
                    pequeno
                    tema={tema}
                    desligado={vinculo.fase === 'criando' || vinculo.fase === 'esperando'}
                    aoTocar={vincular}
                  />
                )
              }
            >
              <Expansivel aberto={vinculo.fase !== 'nenhum'} altura={190}>
                <View style={[styles.vinculo, { borderColor: tema.borda }]}>
                  {vinculo.fase === 'criando' && (
                    <Text style={[styles.pequeno, { color: tema.texto2 }]}>Gerando o link</Text>
                  )}
                  {vinculo.fase === 'esperando' && (
                    <>
                      <Text style={[styles.pequeno, { color: tema.texto }]}>
                        Abra o link no Telegram e toque em Iniciar. A tela confirma sozinha.
                      </Text>
                      <View style={styles.vinculoLinha}>
                        <Botao
                          rotulo="Abrir no Telegram"
                          principal
                          pequeno
                          tema={tema}
                          icone={<ArrowSquareOutIcon size={14} color={tema.fundo} />}
                          aoTocar={() => Linking.openURL(vinculo.link)}
                        />
                        <Pulso tema={tema} />
                        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                          {restante ? `Aguardando · o link vale por ${restante}` : 'Aguardando'}
                        </Text>
                      </View>
                    </>
                  )}
                  {vinculo.fase === 'expirado' && (
                    <>
                      <Text style={[styles.pequeno, { color: tema.texto }]}>
                        O link venceu. Gere outro para tentar de novo.
                      </Text>
                      <Botao rotulo="Gerar novo link" pequeno tema={tema} aoTocar={vincular} />
                    </>
                  )}
                  {vinculo.fase === 'erro' && (
                    <>
                      <Text
                        style={[styles.pequeno, { color: tema.alerta }]}
                        accessibilityRole="alert"
                      >
                        {vinculo.mensagem}
                      </Text>
                      <Botao rotulo="Tentar de novo" pequeno tema={tema} aoTocar={vincular} />
                    </>
                  )}
                </View>
              </Expansivel>
              {comTelegramVinculado && vinculo.fase === 'nenhum' && (
                <View style={styles.trocar}>
                  <Botao rotulo="Trocar chat" pequeno tema={tema} aoTocar={vincular} />
                </View>
              )}
            </LinhaDoCanal>

            <LinhaDoCanal
              icone={<BellRingingIcon size={20} color={tema.texto} />}
              titulo="Notificação no navegador"
              descricao={
                push
                  ? 'Há uma inscrição de push nesta conta. Ela é mantida, mas ainda não dá para alterá-la por aqui.'
                  : 'Em breve: aviso no navegador, mesmo com a aba do painel fechada.'
              }
              tema={tema}
              ultima
              direita={
                <Interruptor
                  ligado={!!push?.ativo}
                  rotulo="Notificação no navegador"
                  tema={tema}
                  desabilitado
                />
              }
            />

            {!!erroGeral && (
              <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
                {erroGeral}
              </Text>
            )}
          </Vidro>
        </View>
      </ScrollView>

      <BarraDeAlteracoes
        aberta={alterado}
        salvando={salvando}
        aoDescartar={descartar}
        aoSalvar={salvar}
        tema={tema}
      />
      <Toast mensagem={mensagem} tema={tema} escuro={escuro} />
    </>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  tela: { flex: 1 },
  corpo: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 20, paddingTop: 12 },
  titulo: { gap: 6 },
  h1: { fontSize: 34, fontWeight: '300', letterSpacing: -0.9, lineHeight: 40 },
  texto: { fontSize: 15, lineHeight: 22, ...numeros },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  rotulo: { fontSize: 13 },
  painel: { padding: 0, gap: 0 },
  painelTopo: { gap: 4, padding: 22, paddingBottom: 14 },
  campo: { gap: 6, paddingLeft: 54, paddingBottom: 2 },
  entrada: {
    minHeight: ALVO_DE_TOQUE,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  vinculo: {
    marginLeft: 54,
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'flex-start',
  },
  vinculoLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  trocar: { paddingLeft: 54, alignItems: 'flex-start' },
  esqueleto: { height: 380, borderRadius: 26, borderWidth: 1, opacity: 0.7 },
  aviso: { gap: 8, padding: 30, alignItems: 'flex-start' },
  avisoTitulo: { fontSize: 20, fontWeight: '500', letterSpacing: -0.2 },
});
