import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  ErroDaApi,
  type Faixa,
  type Gateway,
  getGateways,
  getSala,
  getStatusDasSalas,
  getUsuarioLogado,
  type SalaDetalhe,
  type SensorResumo,
  type StatusDaSala,
  type UsuarioLogado,
} from '../../src/api';
import { ordemDasBuscas, repetir } from '../../src/busca';
import { avisoDeEdicao, EditorSala, type Salvo } from '../../src/componentes/EditorSala';
import { GraficoDaSala } from '../../src/componentes/GraficoDaSala';
import { type PontoComparado, ReguaComparada } from '../../src/componentes/Regua';
import {
  AdicionarSensor,
  Botao,
  ConfirmarDesativacao,
  SensorNovo,
  useAcoesDosSensores,
} from '../../src/componentes/SensoresDaSala';
import { Surgir } from '../../src/componentes/Surgir';
import { type Mensagem, Toast } from '../../src/componentes/Toast';
import { Brilho, Vidro } from '../../src/componentes/Vidro';
import { leituraPrincipal, numero, situacao, type Tom } from '../../src/painel';
import {
  avaliarLeitura,
  colunasDaGrade,
  dataHoraDaLeitura,
  fatosDaSala,
  podeAdministrar,
  type SensorDaSala,
  sensoresDaSala,
} from '../../src/sala';
import {
  comSensor,
  dataDoCadastro,
  gatewayPadrao,
  nomeDoGateway,
  resumoDosSensores,
} from '../../src/sensores';
import { corDoTom, type Tema } from '../../src/tema';
import { useCelular } from '../../src/useCelular';
import { useTema } from '../../src/useTema';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'ausente' }
  | {
      fase: 'pronto';
      sala: StatusDaSala;
      detalhe: SalaDetalhe;
      atualizadoEm: Date;
      falhou: boolean;
    };

const ICONE_DO_TOM = {
  ok: CheckCircleIcon,
  alerta: WarningCircleIcon,
  'sem-leitura': WifiSlashIcon,
  neutro: InfoIcon,
};

const TITULO_DO_TOM: Record<Tom, string> = {
  ok: 'Dentro da faixa',
  alerta: 'Fora da faixa',
  'sem-leitura': 'Sem leitura',
  neutro: 'Sem faixa definida',
};

/**
 * Tela da sala (#180): os dados da sala, a leitura de cada sensor lado a lado e, para o
 * administrador, adicionar e desativar sensor e editar a sala. Atualiza a cada 30 s, como
 * o painel, e com a lista na tela uma busca que falha vira só um aviso.
 */
export default function TelaDaSala() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const salaId = Number(id);
  const { escuro, tema } = useTema();
  const { width, height } = useWindowDimensions();
  const margem = width >= 760 ? 40 : 16;
  const estreito = width < 760;

  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null);
  const [novaBusca] = useState(ordemDasBuscas);

  const buscar = useCallback(
    (comCarregando: boolean) => {
      if (!Number.isInteger(salaId)) {
        setEstado({ fase: 'ausente' });
        return Promise.resolve();
      }
      const valeAinda = novaBusca();
      if (comCarregando) setEstado({ fase: 'carregando' });
      getUsuarioLogado()
        .then(setUsuario)
        .catch(() => {});
      return Promise.all([getStatusDasSalas(), getSala(salaId)])
        .then(([salas, detalhe]) => {
          if (!valeAinda()) return;
          const sala = salas.find((s) => s.sala_id === salaId);
          setEstado(
            sala
              ? { fase: 'pronto', sala, detalhe, atualizadoEm: new Date(), falhou: false }
              : { fase: 'ausente' },
          );
        })
        .catch((erro: Error) => {
          if (!valeAinda()) return;
          if (erro instanceof ErroDaApi && erro.status === 404) {
            return setEstado({ fase: 'ausente' });
          }
          setEstado((anterior) =>
            anterior.fase === 'pronto'
              ? { ...anterior, falhou: true }
              : { fase: 'erro', mensagem: erro.message },
          );
        });
    },
    [salaId, novaBusca],
  );
  useEffect(() => {
    buscar(true);
  }, [buscar]);
  useEffect(() => repetir(() => buscar(false), 30_000), [buscar]);

  const admin = podeAdministrar(usuario);

  // GET /gateways é só de administrador (Contrato, 2.6): para o visualizador nem é chamada,
  // e o sensor aparece como "Gateway 3".
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [gatewayId, setGatewayId] = useState<number | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `adicionando` só dispara a nova busca.
  useEffect(() => {
    if (!admin) return;
    getGateways()
      .then((lista) => {
        setGateways(lista);
        setGatewayId((atual) =>
          atual !== null && lista.some((g) => g.id === atual) ? atual : gatewayPadrao(lista),
        );
      })
      .catch(() => {});
    // Abrir o "adicionar" busca de novo: pode haver gateway cadastrado depois de abrir a tela.
  }, [admin, adicionando]);

  const aoMudarSensor = (sensor: SensorResumo) => {
    setEstado((e) =>
      e.fase === 'pronto'
        ? {
            ...e,
            detalhe: { ...e.detalhe, sensores: comSensor(e.detalhe.sensores ?? [], sensor) },
          }
        : e,
    );
    buscar(false);
  };
  const acoes = useAcoesDosSensores(salaId, aoMudarSensor);

  // Foto da sala ao abrir a gaveta: a busca de 30 s não pode recomeçar o formulário aberto.
  const [emEdicao, setEmEdicao] = useState<StatusDaSala | undefined>(undefined);
  const [previa, setPrevia] = useState<Faixa | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const fecharEditor = useCallback(() => setEmEdicao(undefined), []);
  const aoSalvar = useCallback(
    (salvo: Salvo) => {
      setEmEdicao(undefined);
      buscar(false);
      setMensagem(avisoDeEdicao(salvo, () => buscar(false), setMensagem));
    },
    [buscar],
  );

  const pronto = estado.fase === 'pronto' ? estado : null;
  const faixa = previa ?? pronto?.sala.faixa ?? null;
  const fora = pronto?.sala.status === 'fora_da_faixa';
  const abrirEspaco = emEdicao !== undefined && width >= 1180;

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen
        options={{ headerShown: false, title: `${pronto?.sala.nome ?? 'Sala'} | TermoLOG` }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.conteudo,
          { padding: margem, paddingTop: 12, paddingRight: abrirEspaco ? 576 : margem },
        ]}
      >
        <View style={styles.corpo}>
          <View style={styles.voltarLinha}>
            <Voltar tema={tema} />
            <Text numberOfLines={1} style={[styles.pequeno, styles.flex, { color: tema.texto2 }]}>
              {pronto
                ? `Atualizado às ${pronto.atualizadoEm.toLocaleTimeString('pt-BR')}`
                : 'Painel'}
            </Text>
          </View>
          {estado.fase === 'carregando' && <Esqueleto tema={tema} largura={width} />}
          {estado.fase === 'erro' && (
            <Aviso
              tema={tema}
              titulo="Não foi possível carregar a sala"
              texto={`Verifique se a API está no ar e tente de novo. (${estado.mensagem})`}
              aoTentar={() => buscar(true)}
            />
          )}
          {estado.fase === 'ausente' && (
            <Aviso
              tema={tema}
              titulo="Sala não encontrada"
              texto="Ela pode ter sido removida, ou o endereço está incompleto."
            />
          )}
          {pronto && faixa && (
            <Conteudo
              sala={{ ...pronto.sala, faixa }}
              detalhe={pronto.detalhe}
              falhou={pronto.falhou}
              fora={fora}
              admin={admin}
              gateways={gateways}
              gatewayId={gatewayId}
              aoEscolherGateway={setGatewayId}
              adicionando={adicionando}
              aoAlternarAdicionar={() => setAdicionando((a) => !a)}
              acoes={acoes}
              aoEditar={() => setEmEdicao(pronto.sala)}
              largura={width - margem * 2 - (abrirEspaco ? 536 : 0)}
              estreito={estreito}
              tema={tema}
            />
          )}
        </View>
      </ScrollView>
      <EditorSala
        sala={emEdicao}
        tema={tema}
        escuro={escuro}
        largura={width}
        altura={height}
        aoFechar={fecharEditor}
        aoMudarFaixa={setPrevia}
        aoSalvar={aoSalvar}
        semSensores
      />
      <Toast mensagem={mensagem} tema={tema} escuro={escuro} recuo={abrirEspaco ? 552 : 0} />
    </View>
  );
}

/** Volta para o painel sem perder a rolagem; aberta por link direto, vai para o painel. */
function Voltar({ tema }: { tema: Tema }) {
  const router = useRouter();
  const celular = useCelular();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="link"
      accessibilityLabel="Voltar ao painel"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.voltar,
        celular && styles.voltarCelular,
        { backgroundColor: hovered ? tema.vidroForte : 'transparent', borderColor: tema.borda },
        pressed && styles.pressionado,
      ]}
    >
      <ArrowLeftIcon size={16} color={tema.texto} />
    </Pressable>
  );
}

function Conteudo({
  sala,
  detalhe,
  falhou,
  fora,
  admin,
  gateways,
  gatewayId,
  aoEscolherGateway,
  adicionando,
  aoAlternarAdicionar,
  acoes,
  aoEditar,
  largura,
  estreito,
  tema,
}: {
  sala: StatusDaSala;
  detalhe: SalaDetalhe;
  falhou: boolean;
  fora: boolean;
  admin: boolean;
  gateways: Gateway[];
  gatewayId: number | null;
  aoEscolherGateway: (id: number) => void;
  adicionando: boolean;
  aoAlternarAdicionar: () => void;
  acoes: ReturnType<typeof useAcoesDosSensores>;
  aoEditar: () => void;
  largura: number;
  estreito: boolean;
  tema: Tema;
}) {
  const { tom, texto } = situacao(sala);
  const IconeDoTom = ICONE_DO_TOM[tom];
  const cor = corDoTom(tema, tom);
  const sensores = detalhe.sensores ?? [];
  const { ativos, inativos } = sensoresDaSala(sensores, sala.leituras);
  const intervaloS = detalhe.intervalo_leitura_s ?? sala.intervalo_leitura_s;
  const fatos = fatosDaSala(sala.faixa, intervaloS, sala.conformidade_24h);

  return (
    <>
      <View style={styles.tituloComBrilho}>
        {fora && <Brilho cor={tema.brilho} />}
        <Surgir style={styles.titulo}>
          <View style={styles.tituloTexto}>
            <View
              style={styles.status}
              accessibilityLabel={`Status: ${TITULO_DO_TOM[tom]}. ${texto}`}
            >
              <IconeDoTom size={18} weight={tom === 'alerta' ? 'fill' : 'regular'} color={cor} />
              <Text style={[styles.statusTitulo, { color: cor }]}>{TITULO_DO_TOM[tom]}</Text>
              <Text style={[styles.statusTexto, { color: tom === 'alerta' ? cor : tema.texto2 }]}>
                {texto}
              </Text>
            </View>
            <Text
              style={[styles.h1, estreito && styles.h1Estreito, { color: tema.texto }]}
              accessibilityRole="header"
            >
              {sala.nome}
            </Text>
            {!!detalhe.descricao && (
              <Text style={[styles.descricao, { color: tema.texto2 }]}>{detalhe.descricao}</Text>
            )}
            {falhou && (
              <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
                A última busca falhou. Estes dados são da busca anterior.
              </Text>
            )}
          </View>
          {admin && (
            <Botao
              rotulo="Editar sala"
              tema={tema}
              aoTocar={aoEditar}
              icone={<PencilSimpleIcon size={15} color={tema.texto} />}
            />
          )}
        </Surgir>
        <Surgir ordem={1} style={[styles.fatos, largura < 620 && styles.fatosEstreitos]}>
          {fatos.map((f, i) => (
            <View
              key={f.rotulo}
              style={[
                styles.fato,
                largura < 620 && styles.fatoEstreito,
                i === 0 && styles.primeiroFato,
                i > 0 && largura >= 620 && { borderLeftWidth: 1, borderLeftColor: tema.trilho },
              ]}
            >
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>{f.rotulo}</Text>
              <Text style={[styles.fatoValor, { color: tema.texto }]}>{f.valor}</Text>
            </View>
          ))}
        </Surgir>
      </View>

      <Surgir ordem={2} style={styles.secaoCabecalho}>
        <View style={styles.secaoTitulo}>
          <Text style={[styles.h2, { color: tema.texto }]} accessibilityRole="header">
            Sensores
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {resumoDosSensores(sensores)}
          </Text>
        </View>
        {admin && (
          <Botao
            rotulo={adicionando ? 'Fechar' : 'Adicionar sensor'}
            principal={!adicionando}
            tema={tema}
            aoTocar={aoAlternarAdicionar}
            icone={
              adicionando ? (
                <XIcon size={15} color={tema.texto} />
              ) : (
                <PlusIcon size={15} color={tema.fundo} />
              )
            }
            rotuloA11y={adicionando ? 'Fechar adicionar sensor' : 'Adicionar sensor'}
          />
        )}
      </Surgir>

      {admin && adicionando && (
        <Surgir
          style={[styles.adicionar, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
        >
          <AdicionarSensor
            gateways={gateways}
            gatewayId={gatewayId}
            aoEscolher={aoEscolherGateway}
            ocupado={acoes.ocupado === 'adicionar'}
            aoAdicionar={() => acoes.adicionar(gatewayId)}
            tema={tema}
          />
        </Surgir>
      )}
      {acoes.novo && <SensorNovo sensor={acoes.novo} gateways={gateways} tema={tema} />}
      {!!acoes.erro && (
        <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
          {acoes.erro}
        </Text>
      )}

      <Leituras
        sala={sala}
        ativos={ativos}
        admin={admin}
        gateways={gateways}
        acoes={acoes}
        largura={largura}
        tema={tema}
      />

      <GraficoDaSala salaId={sala.sala_id} faixa={sala.faixa} tema={tema} largura={largura} />

      {inativos.length > 0 && (
        <Surgir ordem={4} style={styles.inativos}>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            Inativos: não recebem leituras novas
          </Text>
          {inativos.map(({ sensor }) => (
            <View key={sensor.id} style={[styles.inativo, { borderTopColor: tema.trilho }]}>
              <Text style={[styles.inativoId, { color: tema.texto }]}>Sensor {sensor.id}</Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                {nomeDoGateway(gateways, sensor.gateway_id)}
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Cadastrado em {dataDoCadastro(sensor.data_cadastro)}
              </Text>
              <Text style={[styles.pequeno, styles.inativoRotulo, { color: tema.texto2 }]}>
                Inativo
              </Text>
            </View>
          ))}
        </Surgir>
      )}
    </>
  );
}

/** A folha de vidro única: as réguas em comum e, abaixo, cada sensor na sua coluna. */
function Leituras({
  sala,
  ativos,
  admin,
  gateways,
  acoes,
  largura,
  tema,
}: {
  sala: StatusDaSala;
  ativos: SensorDaSala[];
  admin: boolean;
  gateways: Gateway[];
  acoes: ReturnType<typeof useAcoesDosSensores>;
  largura: number;
  tema: Tema;
}) {
  const [emFoco, setEmFoco] = useState<number | null>(null);

  if (ativos.length === 0) {
    return (
      <Vidro tema={tema} ordem={3} style={styles.vazio}>
        <Text style={[styles.vazioTitulo, { color: tema.texto }]}>
          Nenhum sensor ativo nesta sala
        </Text>
        <Text style={[styles.pequeno, { color: tema.texto2 }]}>
          {admin
            ? 'Adicione um sensor para começar a medir.'
            : 'Quando um administrador adicionar um sensor, as leituras aparecem aqui.'}
        </Text>
      </Vidro>
    );
  }

  const { temperatura_min: tMin, temperatura_max: tMax } = sala.faixa;
  const { umidade_min: uMin, umidade_max: uMax } = sala.faixa;
  const comLeitura = ativos.flatMap((s) => (s.leitura ? [s.leitura] : []));
  const temperaturas: PontoComparado[] = comLeitura.map((l) => ({
    id: l.sensor_id,
    valor: l.temperatura,
    fora: avaliarLeitura(l, sala.faixa).temperaturaFora,
  }));
  const umidades: PontoComparado[] = comLeitura.map((l) => ({
    id: l.sensor_id,
    valor: l.umidade,
    fora: avaliarLeitura(l, sala.faixa).umidadeFora,
  }));
  const principal = leituraPrincipal(sala)?.sensor_id;
  const destacar = comLeitura.length > 1 && (tMin ?? tMax ?? uMin ?? uMax) !== null;

  const colunas = colunasDaGrade(ativos.length, largura);
  const linhas: SensorDaSala[][] = [];
  for (let i = 0; i < ativos.length; i += colunas) linhas.push(ativos.slice(i, i + colunas));
  const unico = ativos.length === 1 && largura >= 760;

  return (
    <Vidro tema={tema} ordem={3} style={styles.folha}>
      {comLeitura.length > 0 && (
        <View
          style={[
            styles.comparador,
            largura >= 900 && styles.comparadorLargo,
            { borderBottomColor: tema.trilho },
          ]}
        >
          <View style={styles.flex}>
            <ReguaComparada
              titulo="Temperatura"
              unidade=" °C"
              sufixo="°"
              min={tMin}
              max={tMax}
              pontos={temperaturas}
              emFoco={emFoco}
              aoFocar={setEmFoco}
              tema={tema}
            />
          </View>
          <View style={styles.flex}>
            <ReguaComparada
              titulo="Umidade"
              unidade="%"
              sufixo="%"
              min={uMin}
              max={uMax}
              pontos={umidades}
              emFoco={emFoco}
              aoFocar={setEmFoco}
              tema={tema}
            />
          </View>
        </View>
      )}
      {linhas.map((linha, l) => (
        <View
          key={linha[0].sensor.id}
          style={[
            styles.linha,
            colunas === 1 && styles.linhaUma,
            l > 0 && { borderTopWidth: 1, borderTopColor: tema.trilho },
          ]}
        >
          {linha.map((item, c) => (
            <CelulaDoSensor
              key={item.sensor.id}
              item={item}
              sala={sala}
              gateway={nomeDoGateway(gateways, item.sensor.gateway_id)}
              piorLeitura={destacar && item.sensor.id === principal}
              admin={admin}
              acoes={acoes}
              largura={unico}
              comFilete={c > 0}
              emColunas={colunas > 1}
              emFoco={emFoco === item.sensor.id}
              aoFocar={setEmFoco}
              tema={tema}
            />
          ))}
          {/* Mesma largura de coluna na última linha, quando ela não enche. */}
          {colunas > 1 &&
            ['a', 'b', 'c']
              .slice(0, colunas - linha.length)
              .map((vazia) => <View key={vazia} style={styles.celulaVazia} />)}
        </View>
      ))}
    </Vidro>
  );
}

function CelulaDoSensor({
  item,
  sala,
  gateway,
  piorLeitura,
  admin,
  acoes,
  largura,
  comFilete,
  emColunas,
  emFoco,
  aoFocar,
  tema,
}: {
  item: SensorDaSala;
  sala: StatusDaSala;
  gateway: string;
  piorLeitura: boolean;
  admin: boolean;
  acoes: ReturnType<typeof useAcoesDosSensores>;
  largura: boolean;
  comFilete: boolean;
  emColunas: boolean;
  emFoco: boolean;
  aoFocar: (id: number | null) => void;
  tema: Tema;
}) {
  const { sensor, leitura } = item;
  const avaliacao = leitura && avaliarLeitura(leitura, sala.faixa);
  const alerta = avaliacao?.tom === 'alerta';
  const IconeDoTom = avaliacao ? ICONE_DO_TOM[avaliacao.tom] : WifiSlashIcon;
  const cor = avaliacao ? corDoTom(tema, avaliacao.tom) : tema.texto2;
  const confirmando = acoes.confirmar === sensor.id;
  const novo = acoes.novo?.id === sensor.id;

  return (
    <Pressable
      focusable={false}
      onHoverIn={() => aoFocar(sensor.id)}
      onHoverOut={() => aoFocar(null)}
      accessibilityLabel={`Sensor ${sensor.id}`}
      style={[
        styles.celula,
        emColunas && styles.celulaEmColuna,
        largura && styles.celulaLarga,
        comFilete && { borderLeftWidth: 1, borderLeftColor: tema.trilho },
        {
          backgroundColor: alerta ? tema.alertaFundo : emFoco ? tema.vidroForte : 'transparent',
        },
      ]}
    >
      <View style={[styles.celulaLeitura, largura && styles.flex]}>
        <View style={styles.celulaTopo}>
          <Text style={[styles.sensorNome, { color: tema.texto }]}>Sensor {sensor.id}</Text>
          {piorLeitura && (
            <Text style={[styles.pequeno, { color: alerta ? tema.alerta : tema.texto2 }]}>
              pior leitura
            </Text>
          )}
        </View>
        {leitura && avaliacao ? (
          <>
            <Text
              style={[
                styles.temperatura,
                { color: avaliacao.temperaturaFora ? tema.alerta : tema.texto },
              ]}
            >
              {numero(leitura.temperatura, avaliacao.temperaturaFora ? 2 : 1)}
              <Text style={styles.unidade}> °C</Text>
            </Text>
            <Text
              style={[styles.umidade, { color: avaliacao.umidadeFora ? tema.alerta : tema.texto2 }]}
            >
              {numero(leitura.umidade, avaliacao.umidadeFora ? 2 : 1)}% de umidade
            </Text>
            <View style={styles.situacao}>
              <IconeDoTom
                size={15}
                weight={avaliacao.tom === 'alerta' ? 'fill' : 'regular'}
                color={cor}
              />
              <Text style={[styles.pequeno, styles.situacaoTitulo, { color: cor }]}>
                {avaliacao.titulo}
              </Text>
            </View>
            {avaliacao.detalhe && (
              <Text style={[styles.pequeno, { color: alerta ? cor : tema.texto2 }]}>
                {avaliacao.detalhe}
              </Text>
            )}
          </>
        ) : (
          <View style={styles.semLeitura}>
            <WifiSlashIcon size={20} weight="light" color={tema.texto2} />
            <Text style={[styles.semLeituraTexto, { color: tema.texto2 }]}>
              {novo ? 'Aguardando a primeira leitura' : 'Ainda não enviou leitura'}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.celulaFicha, largura && styles.flex]}>
        <View style={styles.ficha}>
          <Linha rotulo="Última leitura" tema={tema}>
            {leitura ? dataHoraDaLeitura(leitura.data_hora) : 'Nenhuma'}
          </Linha>
          <Linha rotulo="Gateway" tema={tema}>
            {gateway}
          </Linha>
          <Linha rotulo="Cadastrado em" tema={tema}>
            {dataDoCadastro(sensor.data_cadastro)}
          </Linha>
          <Linha rotulo="Situação" tema={tema}>
            Ativo
          </Linha>
        </View>
        {admin && !confirmando && (
          <Botao
            rotulo="Desativar"
            pequeno
            tema={tema}
            aoTocar={() => acoes.setConfirmar(sensor.id)}
            rotuloA11y={`Desativar sensor ${sensor.id}`}
          />
        )}
        {admin && confirmando && (
          <ConfirmarDesativacao
            id={sensor.id}
            ocupado={acoes.ocupado === sensor.id}
            aoCancelar={() => acoes.setConfirmar(null)}
            aoDesativar={() => acoes.desativar(sensor.id)}
            tema={tema}
          />
        )}
      </View>
    </Pressable>
  );
}

function Linha({
  rotulo,
  tema,
  children,
}: {
  rotulo: string;
  tema: Tema;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fichaLinha}>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>{rotulo}</Text>
      <Text numberOfLines={1} style={[styles.pequeno, styles.fichaValor, { color: tema.texto }]}>
        {children}
      </Text>
    </View>
  );
}

/** Mesmo desenho da tela pronta, para nada pular quando os dados chegam. */
function Esqueleto({ tema, largura }: { tema: Tema; largura: number }) {
  const bloco = { backgroundColor: tema.vidro, borderColor: tema.borda };
  return (
    <View style={styles.corpo} accessibilityLabel="Carregando a sala">
      <View style={[styles.esqueletoTitulo, bloco]} />
      <View style={[styles.esqueletoFatos, bloco]} />
      <View style={[styles.esqueletoFolha, { height: largura < 760 ? 520 : 440 }, bloco]} />
    </View>
  );
}

function Aviso({
  tema,
  titulo,
  texto,
  aoTentar,
}: {
  tema: Tema;
  titulo: string;
  texto: string;
  aoTentar?: () => void;
}) {
  return (
    <Vidro tema={tema} style={styles.aviso}>
      <Text style={[styles.vazioTitulo, { color: tema.texto }]}>{titulo}</Text>
      <Text style={[styles.pequeno, { color: tema.texto2 }]}>{texto}</Text>
      <View style={styles.avisoAcoes}>
        {aoTentar && <Botao rotulo="Tentar de novo" principal tema={tema} aoTocar={aoTentar} />}
        <Link href="/" asChild>
          <Pressable accessibilityLabel="Voltar ao painel">
            {({ pressed }) => (
              <View
                style={[
                  styles.avisoLink,
                  { backgroundColor: tema.vidroForte, borderColor: tema.borda },
                  pressed && styles.pressionado,
                ]}
              >
                <ArrowLeftIcon size={15} color={tema.texto} />
                <Text style={[styles.avisoLinkTexto, { color: tema.texto }]}>Voltar ao painel</Text>
              </View>
            )}
          </Pressable>
        </Link>
      </View>
    </Vidro>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  tela: { flex: 1 },
  conteudo: { gap: 16 },
  // Alvo de toque de 44 px no celular (#139).
  voltarCelular: { width: 44, height: 44, borderRadius: 22 },
  voltar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressionado: { transform: [{ scale: 0.97 }] },
  corpo: { width: '100%', maxWidth: 1240, alignSelf: 'center', gap: 16 },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  flex: { flex: 1, minWidth: 0 },
  voltarLinha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tituloComBrilho: { gap: 24, paddingTop: 8, paddingBottom: 12 },
  titulo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  tituloTexto: { flexGrow: 1, flexShrink: 1, flexBasis: 260, gap: 8 },
  status: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  statusTitulo: { fontSize: 15, fontWeight: '600' },
  statusTexto: { fontSize: 14, ...numeros },
  h1: { fontSize: 44, fontWeight: '300', letterSpacing: -1.4, lineHeight: 50 },
  h1Estreito: { fontSize: 32, letterSpacing: -0.9, lineHeight: 38 },
  descricao: { fontSize: 15, lineHeight: 22, maxWidth: 640 },
  fatos: { flexDirection: 'row' },
  fatosEstreitos: { flexWrap: 'wrap', rowGap: 14 },
  fato: { flexGrow: 1, flexBasis: 0, gap: 3, paddingHorizontal: 20 },
  primeiroFato: { paddingLeft: 0 },
  fatoEstreito: { flexBasis: '50%', paddingHorizontal: 0, paddingRight: 12 },
  fatoValor: { fontSize: 19, fontWeight: '300', letterSpacing: -0.3, ...numeros },
  secaoCabecalho: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  secaoTitulo: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  h2: { fontSize: 22, fontWeight: '500', letterSpacing: -0.3 },
  adicionar: { gap: 8, padding: 20, borderRadius: 26, borderWidth: 1 },
  folha: { padding: 0 },
  comparador: { gap: 22, padding: 24, borderBottomWidth: 1 },
  comparadorLargo: { flexDirection: 'row', gap: 48 },
  linha: { flexDirection: 'row' },
  linhaUma: { flexDirection: 'column' },
  celula: { gap: 18, padding: 24 },
  celulaEmColuna: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  celulaLarga: { flexDirection: 'row', gap: 48 },
  celulaVazia: { flexGrow: 1, flexShrink: 1, flexBasis: 0, padding: 24 },
  celulaLeitura: { gap: 2 },
  celulaFicha: { gap: 14 },
  celulaTopo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 10,
    marginBottom: 6,
  },
  sensorNome: { fontSize: 15, fontWeight: '600', ...numeros },
  temperatura: { fontSize: 50, fontWeight: '200', letterSpacing: -2.2, lineHeight: 58, ...numeros },
  unidade: { fontSize: 18, fontWeight: '300', letterSpacing: 0 },
  umidade: { fontSize: 15, marginBottom: 12, ...numeros },
  situacao: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  situacaoTitulo: { fontWeight: '600' },
  semLeitura: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 58 },
  semLeituraTexto: { flexShrink: 1, fontSize: 15 },
  ficha: { gap: 6 },
  fichaLinha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  fichaValor: { flexShrink: 1, textAlign: 'right' },
  inativos: { gap: 8, marginTop: 8, paddingHorizontal: 4 },
  inativo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 20,
    rowGap: 2,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  inativoId: { fontSize: 14, fontWeight: '500', ...numeros },
  inativoRotulo: { marginLeft: 'auto' },
  vazio: { padding: 30, gap: 8 },
  vazioTitulo: { fontSize: 20, fontWeight: '500', letterSpacing: -0.2 },
  aviso: { padding: 30, gap: 8, alignItems: 'flex-start', marginTop: 8 },
  avisoAcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  avisoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  avisoLinkTexto: { fontSize: 14, fontWeight: '600' },
  esqueletoTitulo: { height: 120, borderRadius: 26, borderWidth: 1, marginTop: 20, opacity: 0.7 },
  esqueletoFatos: { height: 64, borderRadius: 26, borderWidth: 1, opacity: 0.7 },
  esqueletoFolha: { borderRadius: 26, borderWidth: 1, opacity: 0.7, marginTop: 40 },
});
