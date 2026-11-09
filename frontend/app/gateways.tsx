import { Stack } from 'expo-router';
import { BroadcastIcon } from 'phosphor-react-native/src/icons/Broadcast';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  cadastrarGateway,
  ErroDaApi,
  type Gateway,
  type GatewayCriado,
  getGateways,
} from '../src/api';
import { ordemDasBuscas, repetir } from '../src/busca';
import { Surgir } from '../src/componentes/Surgir';
import { Vidro } from '../src/componentes/Vidro';
import { erroDoNome, ordenarGateways, resumoDosGateways, ultimoContato } from '../src/gateways';
import type { Tema } from '../src/tema';
import { useTema } from '../src/useTema';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; gateways: Gateway[]; falhou: boolean };

/**
 * Tela de gateways (#93): a lista com quem está online e o último contato, atualizada a
 * cada 30 s como o painel, e o cadastro de um gateway novo com a chave de API, que a API
 * mostra uma única vez.
 */
export default function Gateways() {
  const { tema } = useTema();
  const { width } = useWindowDimensions();
  const margem = width >= 760 ? 40 : 16;

  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [novaBusca] = useState(ordemDasBuscas);
  const buscar = useCallback(
    (comCarregando: boolean) => {
      const valeAinda = novaBusca();
      if (comCarregando) setEstado({ fase: 'carregando' });
      return getGateways()
        .then((gateways) => {
          if (valeAinda()) {
            setEstado({ fase: 'pronto', gateways: ordenarGateways(gateways), falhou: false });
          }
        })
        .catch((erro: Error) => {
          if (!valeAinda()) return;
          // Com a lista na tela, a falha vira só um aviso e os dados ficam.
          setEstado((anterior) =>
            anterior.fase === 'pronto'
              ? { ...anterior, falhou: true }
              : { fase: 'erro', mensagem: erro.message },
          );
        });
    },
    [novaBusca],
  );
  useEffect(() => {
    buscar(true);
  }, [buscar]);
  useEffect(() => repetir(() => buscar(false), 30_000), [buscar]);

  const [formulario, setFormulario] = useState(false);
  const [criado, setCriado] = useState<GatewayCriado | null>(null);
  const aoCadastrar = (gateway: GatewayCriado) => {
    setFormulario(false);
    setCriado(gateway);
    buscar(false);
  };

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Gateways | TermoLOG' }} />
      <ScrollView contentContainerStyle={[styles.conteudo, { padding: margem, paddingTop: 12 }]}>
        <View style={styles.corpo}>
          <View style={styles.titulo}>
            <View style={styles.tituloTexto}>
              <Text style={[styles.h1, { color: tema.texto }]} accessibilityRole="header">
                Gateways
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                {estado.fase === 'pronto'
                  ? resumoDosGateways(estado.gateways)
                  : 'Nós centrais que enviam as leituras para a API'}
                {estado.fase === 'pronto' && estado.falhou && (
                  <Text style={{ color: tema.alerta }}> · a última busca falhou</Text>
                )}
              </Text>
            </View>
            {/* Some enquanto a chave está na tela: só "Pronto, já copiei" fecha a chave. */}
            {!formulario && !criado && (
              <Botao
                rotulo="Novo gateway"
                icone
                principal
                tema={tema}
                aoTocar={() => setFormulario(true)}
              />
            )}
          </View>

          {formulario && (
            <NovoGateway
              tema={tema}
              aoCancelar={() => setFormulario(false)}
              aoCadastrar={aoCadastrar}
            />
          )}
          {criado && <ChaveCriada gateway={criado} tema={tema} aoFechar={() => setCriado(null)} />}

          <Lista
            estado={estado}
            tema={tema}
            novo={criado?.id ?? null}
            aoTentar={() => buscar(true)}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function NovoGateway({
  tema,
  aoCancelar,
  aoCadastrar,
}: {
  tema: Tema;
  aoCancelar: () => void;
  aoCadastrar: (gateway: GatewayCriado) => void;
}) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<TextInput>(null);
  useEffect(() => {
    campo.current?.focus();
  }, []);

  const enviar = () => {
    // Enter no campo também chama enviar: sem isso, dois Enter criam dois gateways.
    if (salvando) return;
    const problema = erroDoNome(nome);
    if (problema) {
      setErro(problema);
      return campo.current?.focus();
    }
    setSalvando(true);
    setErro('');
    cadastrarGateway(nome.trim())
      .then(aoCadastrar)
      .catch((e: Error) => {
        // Recusa da API (422...): a mensagem dela. Rede ou tempo esgotado: o gateway pode ter
        // sido salvo, então a pessoa confere a lista antes de cadastrar de novo.
        setErro(
          e instanceof ErroDaApi
            ? `A API recusou: ${e.message}`
            : `Sem resposta da API (${e.message}). Confira na lista se o gateway entrou antes de tentar de novo.`,
        );
        setSalvando(false);
      });
  };

  return (
    <Surgir style={[styles.painel, { backgroundColor: tema.vidro, borderColor: tema.borda }]}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Nome do gateway</Text>
      <View style={styles.linhaForm}>
        <TextInput
          ref={campo}
          value={nome}
          onChangeText={(t) => {
            setNome(t);
            setErro('');
          }}
          onSubmitEditing={enviar}
          maxLength={120}
          placeholder="Ex.: Gateway Bloco C"
          placeholderTextColor={tema.texto2}
          accessibilityLabel="Nome do gateway"
          style={[
            styles.entrada,
            {
              color: tema.texto,
              backgroundColor: tema.vidroForte,
              borderColor: erro ? tema.alerta : tema.borda,
            },
          ]}
        />
        <Botao rotulo="Cancelar" tema={tema} aoTocar={aoCancelar} />
        <Botao
          rotulo={salvando ? 'Cadastrando' : 'Cadastrar'}
          principal
          tema={tema}
          desligado={salvando}
          aoTocar={enviar}
        />
      </View>
      {!!erro && (
        <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
          {erro}
        </Text>
      )}
    </Surgir>
  );
}

/** A chave de API do gateway recém-cadastrado. Some ao fechar e não volta mais. */
function ChaveCriada({
  gateway,
  tema,
  aoFechar,
}: {
  gateway: GatewayCriado;
  tema: Tema;
  aoFechar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);
  const [semCopiar, setSemCopiar] = useState(false);
  const copiar = () => {
    // Fora de HTTPS/localhost (painel aberto pelo IP da rede) não há navigator.clipboard.
    const area = Platform.OS === 'web' ? navigator.clipboard : undefined;
    if (!area) return setSemCopiar(true);
    area.writeText(gateway.chave_api).then(
      () => {
        setSemCopiar(false);
        setCopiada(true);
        setTimeout(() => setCopiada(false), 2500);
      },
      () => setSemCopiar(true),
    );
  };
  return (
    <Surgir
      style={[styles.painel, { backgroundColor: tema.vidro, borderColor: `${tema.folga}66` }]}
    >
      <View style={styles.linhaIcone}>
        <CheckCircleIcon size={18} weight="fill" color={tema.folga} />
        <Text style={[styles.texto, { color: tema.texto }]}>
          {gateway.nome} cadastrado com o ID {gateway.id}
        </Text>
      </View>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Chave de API</Text>
      <View style={[styles.chave, { backgroundColor: tema.vidroForte, borderColor: tema.borda }]}>
        <Text
          selectable
          style={[styles.chaveTexto, { color: tema.texto }]}
          accessibilityLabel="Chave de API do gateway"
        >
          {gateway.chave_api}
        </Text>
        <Botao
          rotulo={copiada ? 'Copiada' : 'Copiar'}
          pequeno
          tema={tema}
          aoTocar={copiar}
          iconeCopiada={copiada}
        />
      </View>
      {semCopiar && (
        <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
          Não deu para copiar. Selecione a chave acima e copie com Ctrl+C.
        </Text>
      )}
      <View style={styles.linhaIcone}>
        <WarningCircleIcon size={16} weight="fill" color={tema.alerta} />
        <Text style={[styles.pequeno, styles.flex, { color: tema.alerta }]}>
          Esta chave não aparece de novo. Copie agora e configure no nó central.
        </Text>
      </View>
      <Botao rotulo="Pronto, já copiei" tema={tema} aoTocar={aoFechar} />
    </Surgir>
  );
}

function Lista({
  estado,
  tema,
  novo,
  aoTentar,
}: {
  estado: Estado;
  tema: Tema;
  novo: number | null;
  aoTentar: () => void;
}) {
  if (estado.fase === 'carregando') {
    return (
      <View style={styles.linhas} accessibilityLabel="Carregando gateways">
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[styles.esqueleto, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
          />
        ))}
      </View>
    );
  }
  if (estado.fase === 'erro') {
    return (
      <Vidro tema={tema} style={styles.painel}>
        <Text style={[styles.texto, { color: tema.texto }]}>
          Não foi possível carregar os gateways.
        </Text>
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          Verifique se a API está no ar e tente de novo. ({estado.mensagem})
        </Text>
        <Botao rotulo="Tentar de novo" tema={tema} aoTocar={aoTentar} />
      </Vidro>
    );
  }
  if (estado.gateways.length === 0) {
    return (
      <Vidro tema={tema} style={styles.painel}>
        <Text style={[styles.texto, { color: tema.texto }]}>Nenhum gateway cadastrado</Text>
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          Cadastre o nó central que vai enviar as leituras. Depois, ligue os sensores das salas a
          ele.
        </Text>
      </Vidro>
    );
  }
  return (
    <View style={styles.linhas}>
      {estado.gateways.map((g, i) => (
        <Vidro
          key={g.id}
          tema={tema}
          ordem={i}
          style={[styles.linha, g.id === novo && { borderColor: `${tema.folga}66` }]}
        >
          <BroadcastIcon size={22} weight="light" color={g.online ? tema.folga : tema.texto2} />
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[styles.texto, { color: tema.texto }]}>
              {g.nome}
            </Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              ID {g.id} ·{' '}
              {g.ultimo_contato
                ? `último contato ${ultimoContato(g.ultimo_contato)}`
                : 'nunca se conectou'}
            </Text>
          </View>
          {/* O ponto só aparece com estado real: online ou offline. */}
          <View
            style={[styles.situacao, { borderColor: g.online ? `${tema.folga}55` : tema.borda }]}
          >
            <View
              style={[styles.ponto, { backgroundColor: g.online ? tema.folga : tema.texto2 }]}
            />
            <Text style={[styles.pequeno, { color: g.online ? tema.folga : tema.texto2 }]}>
              {g.online ? 'online' : 'offline'}
            </Text>
          </View>
        </Vidro>
      ))}
    </View>
  );
}

function Botao({
  rotulo,
  tema,
  aoTocar,
  principal,
  pequeno,
  icone,
  iconeCopiada,
  desligado,
}: {
  rotulo: string;
  tema: Tema;
  aoTocar: () => void;
  principal?: boolean;
  pequeno?: boolean;
  icone?: boolean;
  iconeCopiada?: boolean;
  desligado?: boolean;
}) {
  const cor = principal ? tema.fundo : tema.texto;
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!desligado }}
      style={({ pressed }) => [
        styles.botao,
        pequeno && styles.botaoPequeno,
        {
          backgroundColor: principal ? tema.texto : tema.vidroForte,
          borderColor: principal ? tema.texto : tema.borda,
          opacity: desligado ? 0.4 : 1,
        },
        pressed && styles.pressionado,
      ]}
    >
      {icone && <PlusIcon size={15} color={cor} />}
      {iconeCopiada && <CheckIcon size={14} color={tema.folga} />}
      <Text style={[styles.botaoTexto, pequeno && styles.botaoTextoPequeno, { color: cor }]}>
        {rotulo}
      </Text>
    </Pressable>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };
// Monoespaçada só na chave: é um dado para copiar, e assim 0/O e 1/l não se confundem.
const mono = Platform.select({
  web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  default: 'monospace',
});

const styles = StyleSheet.create({
  tela: { flex: 1 },
  conteudo: { gap: 16 },
  corpo: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 16, paddingTop: 8 },
  titulo: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' },
  tituloTexto: { flex: 1, minWidth: 200, gap: 4 },
  h1: { fontSize: 26, fontWeight: '500', letterSpacing: -0.4 },
  pequeno: { fontSize: 13, ...numeros },
  texto: { fontSize: 15 },
  rotulo: { fontSize: 13 },
  flex: { flex: 1, minWidth: 0 },
  painel: { borderWidth: 1, borderRadius: 26, padding: 22, gap: 10, alignItems: 'stretch' },
  linhaForm: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  entrada: {
    flexGrow: 1,
    flexBasis: 240,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  linhaIcone: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 8,
  },
  chaveTexto: { flex: 1, fontFamily: mono, fontSize: 14, letterSpacing: 0.3 },
  linhas: { gap: 10 },
  esqueleto: { height: 72, borderRadius: 26, borderWidth: 1, opacity: 0.7 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  situacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  ponto: { width: 7, height: 7, borderRadius: 4 },
  botao: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  botaoPequeno: { height: 32, paddingHorizontal: 12, alignSelf: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '600' },
  botaoTextoPequeno: { fontSize: 12 },
  pressionado: { transform: [{ scale: 0.97 }] },
});
