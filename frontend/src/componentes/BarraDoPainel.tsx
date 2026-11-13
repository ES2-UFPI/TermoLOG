import { type Href, Link, usePathname } from 'expo-router';
import type { Icon } from 'phosphor-react-native';
import { BroadcastIcon } from 'phosphor-react-native/src/icons/Broadcast';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { SquaresFourIcon } from 'phosphor-react-native/src/icons/SquaresFour';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
import { UserCircleIcon } from 'phosphor-react-native/src/icons/UserCircle';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import {
  getHealth,
  getStatusDasSalas,
  getUsuarioLogado,
  type StatusDaSala,
  type UsuarioLogado,
} from '../api';
import { ABAS, type Aba, abaAtiva, iniciais, situacaoDaBarra } from '../barra';
import { ordemDasBuscas, repetir } from '../busca';
import { leituraPrincipal, numero, ordenar, type Tom } from '../painel';
import { podeAdministrar } from '../sala';
import { corDoTom, type Tema } from '../tema';
import { useTema } from '../useTema';
import { BotaoSair } from './BotaoSair';
import { BotaoTema } from './BotaoTema';
import { Isotermas } from './Isotermas';
import { Logo } from './Logo';
import { Surgir } from './Surgir';
import { useFecharFora } from './useFecharFora';

const ICONE_DA_ABA: Record<Aba['rota'], Icon> = {
  '/': SquaresFourIcon,
  '/gateways': BroadcastIcon,
  '/relatorios': FileTextIcon,
};
const ICONE_DO_TOM: Record<Tom, Icon> = {
  ok: CheckCircleIcon,
  alerta: WarningCircleIcon,
  'sem-leitura': WifiSlashIcon,
  neutro: InfoIcon,
};

const desfoque = Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px)' } as ViewStyle) : null;
// As curvas somem nas pontas, onde ficam a logo e os botões.
const MASCARA = 'linear-gradient(90deg, transparent 8%, #000 34%, #000 62%, transparent 92%)';

type Dados = {
  salas: StatusDaSala[] | null;
  falhou: boolean;
  atualizadoEm: Date | null;
  usuario: UsuarioLogado | null;
  apiNoAr: boolean | null;
};

/** O que a barra mostra, de rotas que já existem, no mesmo intervalo do painel (Contrato, 2.3). */
function useDadosDaBarra() {
  const [dados, setDados] = useState<Dados>({
    salas: null,
    falhou: false,
    atualizadoEm: null,
    usuario: null,
    apiNoAr: null,
  });
  const [novaBusca] = useState(ordemDasBuscas);
  // Nome e perfil não mudam durante a sessão: busca ao entrar e, se a rede falhar, tenta de
  // novo no próximo ciclo só enquanto não tiver vindo.
  const temUsuario = useRef(false);
  const buscar = useCallback(() => {
    const valeAinda = novaBusca();
    if (!temUsuario.current) {
      getUsuarioLogado()
        .then((usuario) => {
          temUsuario.current = true;
          setDados((d) => ({ ...d, usuario }));
        })
        .catch(() => {});
    }
    getHealth()
      .then(() => setDados((d) => ({ ...d, apiNoAr: true })))
      .catch(() => setDados((d) => ({ ...d, apiNoAr: false })));
    return getStatusDasSalas()
      .then((salas) => {
        if (valeAinda()) {
          setDados((d) => ({
            ...d,
            salas: ordenar(salas),
            falhou: false,
            atualizadoEm: new Date(),
          }));
        }
      })
      .catch(() => {
        if (valeAinda()) setDados((d) => ({ ...d, falhou: true }));
      });
  }, [novaBusca]);
  useEffect(() => {
    buscar();
    return repetir(buscar, 30_000);
  }, [buscar]);
  return dados;
}

/**
 * Barra do topo (#185), uma só para todas as telas logadas. A identidade vem dos dados: a
 * fita térmica tem um segmento por sala, na cor do status, e as isotermas do login correm
 * por trás, paradas enquanto está tudo na faixa. Com sala fora, esquentam e se movem: é o
 * único caso em que o movimento chama atenção para alguma coisa. Com movimento reduzido, nunca.
 */
export function BarraDoPainel() {
  const { escuro, tema, trocar } = useTema();
  const { width } = useWindowDimensions();
  const rota = usePathname();
  const { salas, falhou, atualizadoEm, usuario, apiNoAr } = useDadosDaBarra();
  const margem = width >= 760 ? 40 : 16;
  const comAbas = width >= 640;
  const comRotulos = width >= 1040;

  const [aberto, setAberto] = useState<'situacao' | 'conta' | null>(null);
  const fechar = useCallback(() => setAberto(null), []);
  const caixa = useRef<View>(null);
  useFecharFora(aberto !== null, caixa, fechar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fecha ao trocar de tela.
  useEffect(() => setAberto(null), [rota]);

  const situacao = situacaoDaBarra(salas, falhou);
  const abas = ABAS.filter((a) => !a.admin || podeAdministrar(usuario));
  const quente = situacao.tom === 'alerta' && !situacao.semConexao;
  const IconeDaSituacao = situacao.semConexao ? WifiSlashIcon : ICONE_DO_TOM[situacao.tom];
  const corDaSituacao = corDoTom(tema, situacao.tom);
  const hora = atualizadoEm?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <View ref={caixa} style={[styles.posicao, { marginHorizontal: margem }]}>
      <View
        style={[styles.casco, desfoque, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
      >
        <View style={styles.isotermas}>
          <Isotermas
            tema={quente ? { ...tema, faixa: [tema.alerta, tema.alerta] } : tema}
            mascara={MASCARA}
            animada={quente}
          />
        </View>
        <FitaTermica salas={salas ?? []} tema={tema} />
      </View>

      <View style={[styles.conteudo, !comAbas && styles.conteudoEstreito]}>
        <Link href="/" accessibilityLabel="TermoLOG, ir para o painel" asChild>
          <Pressable style={styles.logo}>
            <Logo tema={tema} largura={comAbas ? 88 : 76} />
          </Pressable>
        </Link>

        {comAbas && (
          <Abas
            abas={abas}
            ativa={abaAtiva(rota)}
            comRotulos={comRotulos}
            escuro={escuro}
            tema={tema}
          />
        )}
        <View style={styles.espaco} />

        <Pressable
          onPress={() => setAberto((a) => (a === 'situacao' ? null : 'situacao'))}
          accessibilityRole="button"
          accessibilityLabel={`Situação das salas: ${situacao.texto}`}
          aria-expanded={aberto === 'situacao'}
          style={({ pressed, hovered, focused }: EstadoDoBotao) => [
            styles.situacao,
            !comAbas && styles.situacaoCelular,
            {
              borderColor:
                aberto === 'situacao' || hovered || focused
                  ? corDaSituacao
                  : quente
                    ? `${tema.alerta}66`
                    : tema.borda,
              backgroundColor: quente ? tema.alertaFundo : tema.vidroForte,
            },
            pressed && styles.pressionado,
          ]}
        >
          <IconeDaSituacao
            size={16}
            weight={situacao.tom === 'alerta' ? 'fill' : 'regular'}
            color={corDaSituacao}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.situacaoTexto,
              { color: situacao.tom === 'alerta' ? corDaSituacao : tema.texto },
            ]}
          >
            {comRotulos ? situacao.texto : situacao.curto}
          </Text>
        </Pressable>

        {comAbas && <BotaoTema escuro={escuro} tema={tema} aoTrocar={trocar} />}

        <Pressable
          onPress={() => setAberto((a) => (a === 'conta' ? null : 'conta'))}
          accessibilityRole="button"
          accessibilityLabel="Conta e menu"
          aria-expanded={aberto === 'conta'}
          style={({ pressed, hovered, focused }: EstadoDoBotao) => [
            styles.conta,
            !comAbas && styles.contaCelular,
            {
              backgroundColor: aberto === 'conta' ? tema.texto : tema.vidroForte,
              borderColor: hovered || focused ? tema.texto2 : tema.borda,
            },
            pressed && styles.pressionado,
          ]}
        >
          {iniciais(usuario?.nome) ? (
            <Text
              style={[styles.contaTexto, { color: aberto === 'conta' ? tema.fundo : tema.texto }]}
            >
              {iniciais(usuario?.nome)}
            </Text>
          ) : (
            <UserIcon size={17} color={aberto === 'conta' ? tema.fundo : tema.texto} />
          )}
        </Pressable>
      </View>

      {aberto === 'situacao' && (
        <Surgir
          style={[
            styles.caixaFlutuante,
            !comAbas && styles.caixaInteira,
            { backgroundColor: tema.fundo, borderColor: tema.borda },
          ]}
        >
          <Text style={[styles.caixaTitulo, { color: tema.texto }]}>{situacao.texto}</Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {hora ? `Atualizado às ${hora}` : 'Ainda sem dados'}
            {falhou && hora ? '. Estes dados são da última busca que deu certo.' : ''}
          </Text>
          <ScrollView style={styles.listaDeSalas}>
            {(salas ?? []).map((sala) => (
              <LinhaDaSala key={sala.sala_id} sala={sala} tema={tema} />
            ))}
          </ScrollView>
        </Surgir>
      )}

      {aberto === 'conta' && (
        <Surgir
          style={[
            styles.caixaFlutuante,
            !comAbas && styles.caixaInteira,
            { backgroundColor: tema.fundo, borderColor: tema.borda },
          ]}
        >
          <Text style={[styles.caixaTitulo, { color: tema.texto }]}>
            {usuario?.nome ?? 'Conta'}
          </Text>
          {!!usuario?.email && (
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>{usuario.email}</Text>
          )}
          {!!usuario?.perfil && (
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              Perfil: {usuario.perfil === 'visualizador' ? 'Visualizador' : 'Administrador'}
            </Text>
          )}
          <View style={[styles.separador, { backgroundColor: tema.trilho }]} />
          <ItemDoMenu href="/perfil" rotulo="Meu perfil" tema={tema}>
            <UserCircleIcon size={17} color={tema.texto2} />
          </ItemDoMenu>
          {!comAbas &&
            abas.map((a) => {
              const Icone = ICONE_DA_ABA[a.rota];
              return (
                <ItemDoMenu key={a.rota} href={a.rota} rotulo={a.rotulo} tema={tema}>
                  <Icone size={17} color={tema.texto2} />
                </ItemDoMenu>
              );
            })}
          <ItemDoMenu
            href="/health"
            rotulo={apiNoAr === false ? 'API sem resposta' : 'API no ar'}
            tema={tema}
          >
            {apiNoAr === false ? (
              <WifiSlashIcon size={17} color={tema.alerta} />
            ) : (
              <CheckCircleIcon size={17} color={tema.folga} />
            )}
          </ItemDoMenu>
          {!comAbas && (
            <View style={styles.linhaDoTema}>
              <Text style={[styles.itemTexto, { color: tema.texto }]}>Tema</Text>
              <BotaoTema escuro={escuro} tema={tema} aoTrocar={trocar} />
            </View>
          )}
          <View style={[styles.separador, { backgroundColor: tema.trilho }]} />
          <View style={styles.sair}>
            <BotaoSair tema={tema} comTexto />
          </View>
        </Surgir>
      )}
    </View>
  );
}

type EstadoDoBotao = { pressed: boolean; hovered?: boolean; focused?: boolean };

/** Abas com o marcador que desliza até a tela atual, o mesmo gesto do botão de tema. */
function Abas({
  abas,
  ativa,
  comRotulos,
  escuro,
  tema,
}: {
  abas: Aba[];
  ativa: string | null;
  comRotulos: boolean;
  escuro: boolean;
  tema: Tema;
}) {
  // Só a largura de cada aba: no navegador, o onLayout não avisa quando a posição muda (por
  // exemplo, ao entrar a aba de Gateways depois que o perfil chega).
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const x = useRef(new Animated.Value(0)).current;
  const largura = useRef(new Animated.Value(0)).current;
  const indice = abas.findIndex((a) => a.rota === ativa);
  const medidas = abas.slice(0, indice + 1).map((a) => larguras[a.rota]);
  const alvoX =
    indice >= 0 && medidas.every((m) => m !== undefined)
      ? medidas.slice(0, -1).reduce((soma, m) => soma + m, 0)
      : null;
  const alvoLargura = medidas[medidas.length - 1];
  const posicionado = useRef(false);

  useEffect(() => {
    if (alvoX === null) return;
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      // A primeira medida só posiciona: o marcador não atravessa a barra ao abrir a tela.
      if (reduzir || !posicionado.current) {
        posicionado.current = true;
        x.setValue(alvoX);
        largura.setValue(alvoLargura);
        return;
      }
      const suave = {
        duration: 320,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: false,
      };
      Animated.parallel([
        Animated.timing(x, { ...suave, toValue: alvoX }),
        Animated.timing(largura, { ...suave, toValue: alvoLargura }),
      ]).start();
    });
  }, [alvoX, alvoLargura, x, largura]);

  return (
    <View style={[styles.abas, { backgroundColor: tema.vidroForte, borderColor: tema.borda }]}>
      {alvoX !== null && (
        <Animated.View
          testID="marcador-da-aba"
          style={[
            styles.marcador,
            {
              // Os 3 px do espaço interno da pílula das abas.
              left: Animated.add(x, 3),
              width: largura,
              backgroundColor: escuro ? 'rgba(255,255,255,0.14)' : '#ffffff',
              borderColor: tema.borda,
            },
          ]}
        />
      )}
      {abas.map((a) => {
        const Icone = ICONE_DA_ABA[a.rota];
        const atual = a.rota === ativa;
        return (
          <View
            key={a.rota}
            onLayout={(e) => {
              const { width } = e.nativeEvent.layout;
              setLarguras((m) => ({ ...m, [a.rota]: width }));
            }}
          >
            <Link href={a.rota} asChild>
              {/* O Link asChild descarta `style` em função: o desenho fica na View de dentro. */}
              <Pressable accessibilityLabel={a.rotulo} aria-current={atual ? 'page' : undefined}>
                {({ hovered }: EstadoDoBotao) => (
                  <View style={[styles.aba, !comRotulos && styles.abaSoIcone]}>
                    <Icone
                      size={16}
                      weight={atual ? 'fill' : 'regular'}
                      color={atual || hovered ? tema.texto : tema.texto2}
                    />
                    {comRotulos && (
                      <Text
                        style={[
                          styles.abaTexto,
                          {
                            color: atual || hovered ? tema.texto : tema.texto2,
                            fontWeight: atual ? '600' : '400',
                          },
                        ]}
                      >
                        {a.rotulo}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            </Link>
          </View>
        );
      })}
    </View>
  );
}

/** Um segmento por sala na base da barra: a situação do prédio inteiro, numa olhada. */
function FitaTermica({ salas, tema }: { salas: StatusDaSala[]; tema: Tema }) {
  return (
    <View style={styles.fita} testID="fita-termica" aria-hidden>
      {salas.map((sala) => (
        <SegmentoDaFita key={sala.sala_id} status={sala.status} tema={tema} />
      ))}
    </View>
  );
}

function SegmentoDaFita({ status, tema }: { status: StatusDaSala['status']; tema: Tema }) {
  const fora = status === 'fora_da_faixa';
  const pulso = useRef(new Animated.Value(1)).current;
  // Só a sala fora da faixa respira: é o único movimento que pede atenção na barra.
  useEffect(() => {
    if (!fora) return pulso.setValue(1);
    let laco: Animated.CompositeAnimation | null = null;
    let vale = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      if (reduzir || !vale) return;
      const passo = (toValue: number) =>
        Animated.timing(pulso, {
          toValue,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        });
      laco = Animated.loop(Animated.sequence([passo(0.45), passo(1)]));
      laco.start();
    });
    return () => {
      vale = false;
      laco?.stop();
    };
  }, [fora, pulso]);
  const cor = fora ? tema.alerta : status === 'ok' ? tema.folga : tema.texto2;
  return (
    <Animated.View
      testID={`segmento-${status}`}
      style={[
        styles.segmento,
        { backgroundColor: cor, opacity: status === 'ok' || fora ? pulso : 0.35 },
      ]}
    />
  );
}

function LinhaDaSala({ sala, tema }: { sala: StatusDaSala; tema: Tema }) {
  const leitura = leituraPrincipal(sala);
  const fora = sala.status === 'fora_da_faixa';
  const tom: Tom = fora ? 'alerta' : sala.status === 'ok' ? 'ok' : 'sem-leitura';
  const Icone = ICONE_DO_TOM[tom];
  return (
    <Link href={{ pathname: '/sala/[id]', params: { id: String(sala.sala_id) } }} asChild>
      <Pressable accessibilityLabel={`Abrir ${sala.nome}`}>
        {({ hovered }: EstadoDoBotao) => (
          <View style={[styles.item, hovered && { backgroundColor: tema.vidroForte }]}>
            <Icone size={16} weight={fora ? 'fill' : 'regular'} color={corDoTom(tema, tom)} />
            <Text
              numberOfLines={1}
              style={[styles.itemTexto, styles.itemNome, { color: tema.texto }]}
            >
              {sala.nome}
            </Text>
            <Text style={[styles.pequeno, { color: fora ? tema.alerta : tema.texto2 }]}>
              {leitura ? `${numero(leitura.temperatura)} °C` : 'Sem leitura'}
            </Text>
            <CaretRightIcon size={12} color={tema.texto2} />
          </View>
        )}
      </Pressable>
    </Link>
  );
}

function ItemDoMenu({
  href,
  rotulo,
  tema,
  children,
}: {
  href: Href;
  rotulo: string;
  tema: Tema;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityLabel={rotulo}>
        {({ hovered }: EstadoDoBotao) => (
          <View style={[styles.item, hovered && { backgroundColor: tema.vidroForte }]}>
            {children}
            <Text style={[styles.itemTexto, { color: tema.texto }]}>{rotulo}</Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  // Acima das telas: as caixas abertas passam por cima do conteúdo.
  posicao: { zIndex: 10, marginTop: 16, marginBottom: 4 },
  casco: {
    ...StyleSheet.absoluteFill,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  isotermas: { ...StyleSheet.absoluteFill, opacity: 0.32 },
  fita: {
    position: 'absolute',
    left: 34,
    right: 34,
    bottom: 3,
    height: 3,
    flexDirection: 'row',
    gap: 3,
  },
  segmento: { flex: 1, borderRadius: 2 },
  conteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 68,
    paddingLeft: 22,
    paddingRight: 14,
    paddingBottom: 5,
  },
  conteudoEstreito: { gap: 8, minHeight: 62, paddingLeft: 16, paddingRight: 10 },
  espaco: { flex: 1 },
  pressionado: { transform: [{ scale: 0.97 }] },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  abas: {
    flexDirection: 'row',
    height: 40,
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 6,
  },
  marcador: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  aba: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  abaSoIcone: { paddingHorizontal: 12 },
  abaTexto: { fontSize: 14 },
  situacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
    height: 38,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
  },
  situacaoTexto: { flexShrink: 1, fontSize: 13, fontWeight: '600', ...numeros },
  conta: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contaTexto: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  caixaFlutuante: {
    position: 'absolute',
    top: 74,
    right: 0,
    width: 340,
    gap: 3,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
  },
  caixaInteira: { left: 0, width: 'auto', top: 68 },
  caixaTitulo: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  listaDeSalas: { maxHeight: 320, marginTop: 8, marginHorizontal: -6 },
  separador: { height: 1, marginVertical: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  itemTexto: { fontSize: 14 },
  itemNome: { flex: 1, minWidth: 0 },
  linhaDoTema: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 8,
  },
  sair: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  // Alvos de toque de 44 px no celular (#139).
  logo: { minHeight: 44, justifyContent: 'center' },
  situacaoCelular: { height: 44 },
  contaCelular: { width: 44, height: 44, borderRadius: 22 },
});
