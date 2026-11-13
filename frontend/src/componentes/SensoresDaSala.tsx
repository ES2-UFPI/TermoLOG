import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CpuIcon } from 'phosphor-react-native/src/icons/Cpu';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  adicionarSensor,
  desativarSensor,
  type Gateway,
  getGateways,
  getSensores,
  type Sensor,
} from '../api';
import {
  comSensor,
  dataDoCadastro,
  gatewayPadrao,
  nomeDoGateway,
  ordenarSensores,
  resumoDosSensores,
} from '../sensores';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';
import { useCelular } from '../useCelular';

// Mola curta (preset "snappy" do Motion: rigidez 300, amortecimento 30): chega rápido e
// quase sem quicar. Só anima o que mudou: o sensor novo e a confirmação de desativar.
const mola = (valor: Animated.Value, para: number) =>
  Animated.spring(valor, {
    toValue: para,
    stiffness: 300,
    damping: 30,
    mass: 1,
    useNativeDriver: false,
  });

/** Entra com mola (escala 0,96 -> 1 e opacidade). Sem animação se o sistema pedir. */
export function Entrar({ children, style }: { children: React.ReactNode; style?: object }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) =>
      reduzir ? v.setValue(1) : mola(v, 1).start(),
    );
  }, [v]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; sensores: Sensor[]; gateways: Gateway[] };

/**
 * Adicionar e desativar sensor (#95), com a confirmação e o aviso de erro. Serve à gaveta de
 * edição e à tela da sala (#180); quem usa guarda a lista e recebe cada sensor alterado.
 */
export function useAcoesDosSensores(salaId: number, aoMudar: (sensor: Sensor) => void) {
  const [novo, setNovo] = useState<Sensor | null>(null);
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState<'adicionar' | number | null>(null);
  const [erro, setErro] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: recomeça ao trocar de sala.
  useEffect(() => {
    setNovo(null);
    setConfirmar(null);
    setErro('');
  }, [salaId]);

  const adicionar = (gatewayId: number | null) => {
    if (gatewayId === null || ocupado) return;
    setOcupado('adicionar');
    setErro('');
    adicionarSensor(salaId, gatewayId)
      .then((sensor) => {
        aoMudar(sensor);
        setNovo(sensor);
      })
      // 404 de sala ou gateway que não existe mais: a mensagem da API, sem quebrar a tela.
      .catch((e: Error) => setErro(`Não deu para adicionar: ${e.message}.`))
      .finally(() => setOcupado(null));
  };

  const desativar = (id: number) => {
    setOcupado(id);
    setErro('');
    desativarSensor(id)
      .then((sensor) => {
        aoMudar(sensor);
        setConfirmar(null);
        setNovo((n) => (n?.id === id ? null : n));
      })
      .catch((e: Error) => setErro(`Não deu para desativar: ${e.message}.`))
      .finally(() => setOcupado(null));
  };

  return { novo, confirmar, setConfirmar, ocupado, erro, adicionar, desativar };
}

/** Sensor recém-criado: o ID em destaque, porque é ele que vai na configuração da placa. */
export function SensorNovo({
  sensor,
  gateways,
  tema,
}: {
  sensor: Sensor;
  gateways: Gateway[];
  tema: Tema;
}) {
  return (
    <Entrar
      style={[styles.novo, { backgroundColor: tema.vidroForte, borderColor: `${tema.folga}66` }]}
    >
      <View style={styles.novoTopo}>
        <CheckCircleIcon size={18} weight="fill" color={tema.folga} />
        <Text style={[styles.texto, { color: tema.texto }]}>Sensor adicionado</Text>
      </View>
      <Text
        style={[styles.idGrande, { color: tema.texto }]}
        accessibilityLabel={`ID do sensor: ${sensor.id}`}
        selectable
      >
        <Text style={[styles.idRotulo, { color: tema.texto2 }]}>ID </Text>
        {sensor.id}
      </Text>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>
        Configure a placa com este ID. Ela envia pelo {nomeDoGateway(gateways, sensor.gateway_id)}.
      </Text>
    </Entrar>
  );
}

/** Escolha do gateway e o botão de adicionar; sem gateway cadastrado, explica o que falta. */
export function AdicionarSensor({
  gateways,
  gatewayId,
  aoEscolher,
  ocupado,
  aoAdicionar,
  tema,
}: {
  gateways: Gateway[];
  gatewayId: number | null;
  aoEscolher: (id: number) => void;
  ocupado: boolean;
  aoAdicionar: () => void;
  tema: Tema;
}) {
  if (gateways.length === 0) {
    return (
      <Text style={[styles.texto, { color: tema.texto2 }]}>
        Nenhum gateway cadastrado. Cadastre um gateway antes de adicionar sensores.
      </Text>
    );
  }
  return (
    <>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>Gateway</Text>
      <View style={styles.gateways} accessibilityRole="radiogroup">
        {gateways.map((g) => {
          const escolhido = g.id === gatewayId;
          return (
            <Pressable
              key={g.id}
              onPress={() => aoEscolher(g.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: escolhido }}
              aria-checked={escolhido}
              accessibilityLabel={`${g.nome}, ${g.online ? 'online' : 'offline'}`}
              style={({ pressed }) => [
                styles.gateway,
                {
                  borderColor: escolhido ? tema.texto : tema.borda,
                  backgroundColor: escolhido ? tema.vidroForte : 'transparent',
                },
                pressed && styles.pressionado,
              ]}
            >
              {/* Ponto só com estado real: online ou offline. */}
              <View
                style={[styles.ponto, { backgroundColor: g.online ? tema.folga : tema.texto2 }]}
              />
              <Text style={[styles.pequeno, { color: escolhido ? tema.texto : tema.texto2 }]}>
                {g.nome}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Botao
        rotulo={ocupado ? 'Adicionando' : 'Adicionar sensor'}
        icone
        principal
        tema={tema}
        desligado={gatewayId === null || ocupado}
        aoTocar={aoAdicionar}
      />
    </>
  );
}

/** Confirmação na própria linha, com o efeito de desativar escrito. */
export function ConfirmarDesativacao({
  id,
  ocupado,
  aoCancelar,
  aoDesativar,
  tema,
}: {
  id: number;
  ocupado: boolean;
  aoCancelar: () => void;
  aoDesativar: () => void;
  tema: Tema;
}) {
  return (
    <Entrar style={styles.confirmacao}>
      <Text style={[styles.texto, styles.confirmacaoTexto, { color: tema.alerta }]}>
        As leituras dele passam a ser recusadas. Desativar o sensor {id}?
      </Text>
      <View style={styles.acoes}>
        <Botao rotulo="Cancelar" pequeno tema={tema} aoTocar={aoCancelar} />
        <Botao
          rotulo={ocupado ? 'Desativando' : 'Desativar'}
          pequeno
          perigo
          tema={tema}
          desligado={ocupado}
          aoTocar={aoDesativar}
          rotuloA11y={`Confirmar: desativar sensor ${id}`}
        />
      </View>
    </Entrar>
  );
}

/**
 * Sensores da sala na gaveta de edição (#95): a lista com ID, gateway, situação e data,
 * Adicionar sensor (escolhendo o gateway) e Desativar com confirmação na própria linha.
 */
export function SensoresDaSala({ salaId, tema }: { salaId: number; tema: Tema }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [gatewayId, setGatewayId] = useState<number | null>(null);

  const carregar = useCallback(() => {
    setEstado({ fase: 'carregando' });
    Promise.all([getSensores(salaId), getGateways()])
      .then(([sensores, gateways]) => {
        setEstado({ fase: 'pronto', sensores: ordenarSensores(sensores), gateways });
        setGatewayId((atual) =>
          atual !== null && gateways.some((g) => g.id === atual) ? atual : gatewayPadrao(gateways),
        );
      })
      .catch((e: Error) => setEstado({ fase: 'erro', mensagem: e.message }));
  }, [salaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const { novo, confirmar, setConfirmar, ocupado, erro, adicionar, desativar } =
    useAcoesDosSensores(salaId, (sensor) =>
      setEstado((e) =>
        e.fase === 'pronto' ? { ...e, sensores: comSensor(e.sensores, sensor) } : e,
      ),
    );

  return (
    <View style={styles.secao} accessibilityLabel="Sensores da sala">
      <View style={styles.cabecalho}>
        <Text style={[styles.titulo, { color: tema.texto }]} accessibilityRole="header">
          Sensores
        </Text>
        {estado.fase === 'pronto' && (
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {resumoDosSensores(estado.sensores)}
          </Text>
        )}
      </View>

      {estado.fase === 'carregando' && (
        <View accessibilityLabel="Carregando sensores" style={styles.lista}>
          {[0, 1].map((i) => (
            <View
              key={i}
              style={[
                styles.esqueleto,
                { backgroundColor: tema.vidroForte, borderColor: tema.borda },
              ]}
            />
          ))}
        </View>
      )}

      {estado.fase === 'erro' && (
        <View style={[styles.caixa, { backgroundColor: tema.alertaFundo }]}>
          <Text style={[styles.texto, { color: tema.alerta }]}>
            Não foi possível carregar os sensores: {estado.mensagem}.
          </Text>
          <Botao rotulo="Tentar de novo" tema={tema} aoTocar={carregar} />
        </View>
      )}

      {estado.fase === 'pronto' && (
        <>
          {novo && <SensorNovo sensor={novo} gateways={estado.gateways} tema={tema} />}

          <View style={[styles.adicionar, { borderColor: tema.borda }]}>
            <AdicionarSensor
              gateways={estado.gateways}
              gatewayId={gatewayId}
              aoEscolher={setGatewayId}
              ocupado={ocupado === 'adicionar'}
              aoAdicionar={() => adicionar(gatewayId)}
              tema={tema}
            />
          </View>

          {!!erro && (
            <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
              {erro}
            </Text>
          )}

          <View style={styles.lista}>
            {estado.sensores.length === 0 && (
              <Text style={[styles.texto, { color: tema.texto2 }]}>
                Esta sala ainda não tem sensores. Adicione um para começar a medir.
              </Text>
            )}
            {estado.sensores.map((s) => (
              <LinhaDoSensor
                key={s.id}
                sensor={s}
                gateway={nomeDoGateway(estado.gateways, s.gateway_id)}
                tema={tema}
                confirmando={confirmar === s.id}
                ocupado={ocupado === s.id}
                destacado={novo?.id === s.id}
                aoPedir={() => setConfirmar(s.id)}
                aoCancelar={() => setConfirmar(null)}
                aoDesativar={() => desativar(s.id)}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function LinhaDoSensor({
  sensor,
  gateway,
  tema,
  confirmando,
  ocupado,
  destacado,
  aoPedir,
  aoCancelar,
  aoDesativar,
}: {
  sensor: Sensor;
  gateway: string;
  tema: Tema;
  confirmando: boolean;
  ocupado: boolean;
  destacado: boolean;
  aoPedir: () => void;
  aoCancelar: () => void;
  aoDesativar: () => void;
}) {
  const inativo = !sensor.ativo;
  return (
    <View
      style={[
        styles.linha,
        {
          borderColor: confirmando ? tema.alerta : destacado ? `${tema.folga}66` : tema.borda,
          backgroundColor: confirmando ? tema.alertaFundo : 'transparent',
          opacity: inativo ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.linhaTopo}>
        <CpuIcon size={20} weight="light" color={tema.texto2} />
        <Text style={[styles.id, { color: tema.texto }]}>{sensor.id}</Text>
        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.texto, { color: tema.texto }]}>
            {gateway}
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            desde {dataDoCadastro(sensor.data_cadastro)}
          </Text>
        </View>
        <Text
          style={[
            styles.situacao,
            {
              color: inativo ? tema.texto2 : tema.folga,
              borderColor: inativo ? tema.borda : `${tema.folga}55`,
            },
          ]}
        >
          {inativo ? 'inativo' : 'ativo'}
        </Text>
        {!inativo && !confirmando && (
          <Botao
            rotulo="Desativar"
            pequeno
            tema={tema}
            aoTocar={aoPedir}
            rotuloA11y={`Desativar sensor ${sensor.id}`}
          />
        )}
      </View>
      {confirmando && (
        <ConfirmarDesativacao
          id={sensor.id}
          ocupado={ocupado}
          aoCancelar={aoCancelar}
          aoDesativar={aoDesativar}
          tema={tema}
        />
      )}
    </View>
  );
}

export function Botao({
  rotulo,
  tema,
  aoTocar,
  principal,
  perigo,
  pequeno,
  icone,
  desligado,
  rotuloA11y,
}: {
  rotulo: string;
  tema: Tema;
  aoTocar: () => void;
  principal?: boolean;
  perigo?: boolean;
  pequeno?: boolean;
  /** true = o "+"; ou o ícone a usar. */
  icone?: boolean | ReactNode;
  desligado?: boolean;
  rotuloA11y?: string;
}) {
  const fundo = principal ? tema.texto : perigo ? tema.alerta : tema.vidroForte;
  const cor = principal || perigo ? tema.fundo : tema.texto;
  const celular = useCelular();
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityLabel={rotuloA11y ?? rotulo}
      accessibilityState={{ disabled: !!desligado }}
      style={({ pressed }) => [
        styles.botao,
        pequeno && styles.botaoPequeno,
        celular && styles.botaoCelular,
        {
          backgroundColor: fundo,
          borderColor: principal || perigo ? fundo : tema.borda,
          opacity: desligado ? 0.4 : 1,
        },
        pressed && styles.pressionado,
      ]}
    >
      {icone === true ? <PlusIcon size={15} color={cor} /> : icone}
      <Text style={[styles.botaoTexto, pequeno && styles.botaoTextoPequeno, { color: cor }]}>
        {rotulo}
      </Text>
    </Pressable>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  secao: { gap: 12 },
  cabecalho: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  titulo: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },
  pequeno: { fontSize: 12, ...numeros },
  texto: { fontSize: 13, lineHeight: 18 },
  lista: { gap: 8 },
  esqueleto: { height: 58, borderRadius: 18, borderWidth: 1, opacity: 0.7 },
  caixa: { gap: 10, padding: 14, borderRadius: 16, alignItems: 'flex-start' },
  novo: { gap: 4, padding: 16, borderRadius: 20, borderWidth: 1 },
  novoTopo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  idGrande: { fontSize: 44, fontWeight: '200', letterSpacing: -1.5, lineHeight: 52, ...numeros },
  idRotulo: { fontSize: 16, fontWeight: '400', letterSpacing: 0 },
  adicionar: { gap: 8, paddingBottom: 14, borderBottomWidth: 1 },
  gateways: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gateway: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  ponto: { width: 7, height: 7, borderRadius: 4 },
  linha: { borderWidth: 1, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, gap: 10 },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  id: { fontSize: 20, fontWeight: '300', minWidth: 28, ...numeros },
  info: { flex: 1, minWidth: 0 },
  situacao: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  confirmacao: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  confirmacaoTexto: { flexGrow: 1, flexBasis: 200 },
  acoes: { flexDirection: 'row', gap: 6 },
  botao: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  botaoPequeno: { height: 32, paddingHorizontal: 12 },
  // Alvo de toque de 44 px no celular (#139).
  botaoCelular: { height: ALVO_DE_TOQUE },
  botaoTexto: { fontSize: 14, fontWeight: '600' },
  botaoTextoPequeno: { fontSize: 12 },
  pressionado: { transform: [{ scale: 0.97 }] },
});
