import { Stack } from 'expo-router';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ABAS_DOS_ALERTAS,
  daSala,
  erroDaAcao,
  erroDaAcaoCorretiva,
  LISTAS_VAZIAS,
  type ListasDeAlertas,
  listaFicouVelha,
  moverAlerta,
  situacoesABuscar,
  TAMANHO_MAXIMO_DA_ACAO,
  textoDoDesvio,
} from '../src/alertas';
import {
  type Alerta,
  ErroDaApi,
  encerrarAlerta,
  getAlertas,
  getSalas,
  reconhecerAlerta,
  type SalaResumo,
  type SituacaoDoAlerta,
} from '../src/api';
import { ordemDasBuscas, repetir } from '../src/busca';
import { Seletor } from '../src/componentes/CamposDoRelatorio';
import { Botao } from '../src/componentes/SensoresDaSala';
import { type Mensagem, Toast } from '../src/componentes/Toast';
import { Vidro } from '../src/componentes/Vidro';
import { numero, quando } from '../src/painel';
import type { Tema } from '../src/tema';
import { useTema } from '../src/useTema';

const TODAS_AS_SALAS = 0;

/** Tela de alertas (#103): pendentes, reconhecidos e encerrados, cada um na sua aba. */
export default function Alertas() {
  const { escuro, tema } = useTema();
  const { width } = useWindowDimensions();
  const margem = width >= 760 ? 40 : 16;

  const [aba, setAba] = useState<SituacaoDoAlerta>('pendente');
  const [salaId, setSalaId] = useState(TODAS_AS_SALAS);
  const [salas, setSalas] = useState<SalaResumo[]>([]);
  const [listas, setListas] = useState<ListasDeAlertas>(LISTAS_VAZIAS);
  const [falha, setFalha] = useState<string | null>(null);
  // Conflito de uma ação (409): fica na tela, porque o cartão some com a lista nova.
  const [conflito, setConflito] = useState('');
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  // Texto da ação tomada por alerta: fica aqui para sobreviver à troca de aba e de sala.
  const [rascunhos, setRascunhos] = useState<Record<number, string>>({});
  const [novaBusca] = useState(ordemDasBuscas);

  // As salas só preenchem o filtro: sem elas, a tela mostra os alertas de todas.
  useEffect(() => {
    getSalas()
      .then(setSalas)
      .catch(() => {});
  }, []);

  // Uma busca por situação, com o filtro da API (Contrato, 2.7). Busca nova descarta a
  // resposta atrasada de antes, para um alerta já reconhecido não voltar aos pendentes.
  const buscar = useCallback(() => {
    const valeAinda = novaBusca();
    const situacoes = situacoesABuscar(aba);
    return Promise.all(situacoes.map((s) => getAlertas(s, salaId || null)))
      .then((resultados) => {
        if (!valeAinda()) return;
        setListas((antigas) => {
          const novas = { ...antigas };
          situacoes.forEach((s, i) => {
            novas[s] = resultados[i];
          });
          return novas;
        });
        setFalha(null);
      })
      .catch((erro: Error) => {
        if (valeAinda()) setFalha(erro.message);
      });
  }, [aba, salaId, novaBusca]);
  useEffect(() => {
    buscar();
    return repetir(buscar, 30_000);
  }, [buscar]);
  // A resposta de um POST chega depois de a pessoa talvez ter trocado de aba ou de sala: ela
  // usa a busca e o filtro de agora. A busca do render do clique pediria a sala antiga e,
  // por ser a mais nova, descartaria a da sala atual.
  const buscarAgora = useRef(buscar);
  buscarAgora.current = buscar;
  const salaAgora = useRef(salaId);
  salaAgora.current = salaId;

  const escolherSala = (id: number) => {
    if (id === salaId) return;
    setSalaId(id);
    setConflito('');
    setFalha(null);
    // Os alertas da sala anterior não podem aparecer como se fossem desta.
    setListas(LISTAS_VAZIAS);
  };

  const aoMudar = (alerta: Alerta, texto: string) => {
    setConflito('');
    if (daSala(alerta, salaAgora.current)) setListas((l) => moverAlerta(l, alerta));
    if (alerta.situacao === 'encerrado') {
      setRascunhos(({ [alerta.id]: _, ...outros }) => outros);
    }
    setMensagem({ id: Date.now(), texto });
    buscarAgora.current();
  };

  const aoFicarVelha = (texto: string) => {
    setConflito(texto);
    buscarAgora.current();
  };

  const lista = listas[aba];
  const opcoesDeSala = [{ id: TODAS_AS_SALAS, nome: 'Todas as salas' }, ...salas];

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Alertas | TermoLOG' }} />
      <ScrollView contentContainerStyle={{ padding: margem, paddingTop: 12 }}>
        <View style={styles.corpo}>
          <View style={styles.titulo}>
            <Text style={[styles.h1, { color: tema.texto }]} accessibilityRole="header">
              Alertas
            </Text>
            <Text style={[styles.texto, { color: tema.texto2 }]}>
              Reconheça o alerta ao ver o problema e, resolvido, registre a ação tomada.
            </Text>
          </View>

          <View style={styles.controles}>
            <View style={styles.abas} accessibilityRole="tablist">
              {ABAS_DOS_ALERTAS.map((a) => {
                const ativa = a.situacao === aba;
                const total = listas[a.situacao]?.length;
                return (
                  <Pressable
                    key={a.situacao}
                    onPress={() => {
                      setAba(a.situacao);
                      setConflito('');
                      setFalha(null);
                    }}
                    accessibilityRole="tab"
                    aria-selected={ativa}
                    accessibilityState={{ selected: ativa }}
                    style={({ pressed }) => [
                      styles.aba,
                      {
                        borderColor: ativa ? tema.texto : tema.borda,
                        backgroundColor: ativa ? tema.vidroForte : 'transparent',
                      },
                      pressed && styles.pressionado,
                    ]}
                  >
                    <Text style={[styles.abaTexto, { color: ativa ? tema.texto : tema.texto2 }]}>
                      {a.rotulo}
                      {a.situacao !== 'encerrado' && total !== undefined ? ` ${total}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.filtro}>
              <Seletor
                rotulo="Sala"
                valor={salaId}
                opcoes={opcoesDeSala}
                aoEscolher={escolherSala}
                tema={tema}
              />
            </View>
          </View>

          {!!conflito && (
            <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
              {conflito}
            </Text>
          )}
          {falha && lista && (
            <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
              Não deu para atualizar os alertas ({falha}). Mostrando os da última busca.
            </Text>
          )}
          {falha && !lista && (
            <Vidro tema={tema} style={styles.aviso}>
              <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
                Não foi possível carregar os alertas
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Verifique se a API está no ar e tente de novo. ({falha})
              </Text>
              <Botao rotulo="Tentar de novo" tema={tema} aoTocar={buscar} />
            </Vidro>
          )}
          {!falha && !lista && (
            <View
              accessibilityLabel="Carregando os alertas"
              style={[styles.esqueleto, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
            />
          )}
          <View role="tabpanel" style={styles.painel}>
            {lista?.length === 0 && (
              <Text style={[styles.texto, { color: tema.texto2 }]}>
                {ABAS_DOS_ALERTAS.find((a) => a.situacao === aba)?.vazia}
              </Text>
            )}
            {lista?.map((alerta, i) => (
              <CartaoDoAlerta
                key={alerta.id}
                alerta={alerta}
                ordem={i}
                tema={tema}
                aoMudar={aoMudar}
                aoFicarVelha={aoFicarVelha}
                acao={rascunhos[alerta.id] ?? ''}
                aoEscrever={(texto) => setRascunhos((r) => ({ ...r, [alerta.id]: texto }))}
              />
            ))}
          </View>
        </View>
      </ScrollView>
      <Toast mensagem={mensagem} tema={tema} escuro={escuro} />
    </View>
  );
}

function CartaoDoAlerta({
  alerta,
  ordem,
  tema,
  aoMudar,
  aoFicarVelha,
  acao,
  aoEscrever,
}: {
  alerta: Alerta;
  ordem: number;
  tema: Tema;
  aoMudar: (alerta: Alerta, texto: string) => void;
  /** A lista na tela está velha (409, 404): a tela mostra o aviso e busca de novo. */
  aoFicarVelha: (texto: string) => void;
  acao: string;
  aoEscrever: (texto: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  // Trava síncrona: o botão só fica desligado no próximo render, e um clique duplo
  // mandaria o segundo POST, que voltaria 409.
  const enviando = useRef(false);
  const { leitura } = alerta;

  const executar = (pedir: () => Promise<Alerta>, sucesso: string) => {
    if (enviando.current) return;
    enviando.current = true;
    setOcupado(true);
    setErro('');
    pedir()
      .then((atualizado) => aoMudar(atualizado, sucesso))
      .catch((e: Error) => {
        const status = e instanceof ErroDaApi ? e.status : undefined;
        const texto = erroDaAcao(status, e.message);
        if (listaFicouVelha(status)) aoFicarVelha(texto);
        else setErro(texto);
      })
      .finally(() => {
        enviando.current = false;
        setOcupado(false);
      });
  };

  const encerrar = () => {
    const problema = erroDaAcaoCorretiva(acao);
    if (problema) return setErro(problema);
    executar(() => encerrarAlerta(alerta.id, acao.trim()), 'Alerta encerrado');
  };

  return (
    <Vidro tema={tema} ordem={ordem} style={styles.cartao}>
      <View accessibilityLabel={`Alerta ${alerta.id}`} style={styles.cartaoCorpo}>
        <View style={styles.cartaoTopo}>
          <Text style={[styles.sala, { color: tema.texto }]}>{alerta.sala_nome}</Text>
          <Text
            style={[
              styles.desvio,
              alerta.situacao === 'pendente' && {
                color: tema.alerta,
                backgroundColor: tema.alertaFundo,
              },
              alerta.situacao !== 'pendente' && { color: tema.texto2 },
            ]}
          >
            {textoDoDesvio(alerta.tipo)}
          </Text>
        </View>
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          Sensor {alerta.sensor_id} · leitura de {numero(leitura.temperatura)} °C e{' '}
          {numero(leitura.umidade)} % · aberto em {quando(alerta.data_hora)}
        </Text>

        {alerta.reconhecido_por && alerta.reconhecido_em && (
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            Reconhecido por <Text style={{ color: tema.texto }}>{alerta.reconhecido_por.nome}</Text>{' '}
            em {quando(alerta.reconhecido_em)}
          </Text>
        )}
        {alerta.situacao === 'encerrado' && (
          <View style={[styles.encerramento, { borderTopColor: tema.trilho }]}>
            <Text style={[styles.rotulo, { color: tema.texto2 }]}>
              Ação tomada
              {alerta.encerrado_em ? ` · encerrado em ${quando(alerta.encerrado_em)}` : ''}
            </Text>
            <Text style={[styles.texto, { color: tema.texto }]}>{alerta.acao_corretiva}</Text>
          </View>
        )}

        {alerta.situacao === 'pendente' && (
          <View style={styles.acoes}>
            <Botao
              rotulo={ocupado ? 'Reconhecendo' : 'Reconhecer'}
              rotuloA11y={`Reconhecer o alerta ${alerta.id}, ${alerta.sala_nome}`}
              principal
              pequeno
              tema={tema}
              desligado={ocupado}
              icone={<CheckIcon size={14} color={tema.fundo} />}
              aoTocar={() =>
                executar(
                  () => reconhecerAlerta(alerta.id),
                  'Alerta reconhecido, agora em Reconhecidos',
                )
              }
            />
          </View>
        )}
        {alerta.situacao === 'reconhecido' && (
          <View style={[styles.encerramento, { borderTopColor: tema.trilho }]}>
            <Text style={[styles.rotulo, { color: tema.texto2 }]}>Ação tomada</Text>
            <TextInput
              value={acao}
              onChangeText={(texto) => {
                aoEscrever(texto);
                setErro('');
              }}
              multiline
              maxLength={TAMANHO_MAXIMO_DA_ACAO}
              placeholder="Ex.: porta da câmara estava aberta; fechada e temperatura conferida."
              placeholderTextColor={tema.texto2}
              accessibilityLabel={`Ação tomada no alerta ${alerta.id}, ${alerta.sala_nome}`}
              aria-invalid={!!erro}
              style={[
                styles.entrada,
                {
                  color: tema.texto,
                  backgroundColor: tema.vidroForte,
                  borderColor: erro ? tema.alerta : tema.borda,
                },
              ]}
            />
            <View style={styles.acoes}>
              <Botao
                rotulo={ocupado ? 'Encerrando' : 'Encerrar alerta'}
                rotuloA11y={`Encerrar o alerta ${alerta.id}, ${alerta.sala_nome}`}
                principal
                pequeno
                tema={tema}
                desligado={ocupado}
                aoTocar={encerrar}
              />
            </View>
          </View>
        )}

        {!!erro && (
          <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
            {erro}
          </Text>
        )}
      </View>
    </Vidro>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  tela: { flex: 1 },
  corpo: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 16, paddingTop: 12 },
  titulo: { gap: 6, marginBottom: 4 },
  h1: { fontSize: 34, fontWeight: '300', letterSpacing: -0.9, lineHeight: 40 },
  texto: { fontSize: 15, lineHeight: 22, ...numeros },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  rotulo: { fontSize: 13 },
  // A lista do seletor de sala passa por cima dos cartões.
  controles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 2,
  },
  abas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  aba: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  abaTexto: { fontSize: 14, ...numeros },
  filtro: { width: 240, maxWidth: '100%' },
  pressionado: { transform: [{ scale: 0.97 }] },
  painel: { gap: 16 },
  esqueleto: { height: 160, borderRadius: 26, borderWidth: 1, opacity: 0.7 },
  aviso: { gap: 8, padding: 30, alignItems: 'flex-start' },
  avisoTitulo: { fontSize: 20, fontWeight: '500', letterSpacing: -0.2 },
  cartao: { padding: 18 },
  cartaoCorpo: { gap: 8 },
  cartaoTopo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sala: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },
  desvio: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  encerramento: { gap: 8, marginTop: 4, paddingTop: 12, borderTopWidth: 1 },
  entrada: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  acoes: { flexDirection: 'row', marginTop: 4 },
});
