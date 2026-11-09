import { Stack } from 'expo-router';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  type Faixa,
  getIndicadores,
  getStatusDasSalas,
  type Indicadores,
  type StatusDaSala,
} from '../src/api';
import { ordemDasBuscas, repetir } from '../src/busca';
import { CardSala, Destaque, Folgas, ListaSalas, Resumo } from '../src/componentes/Blocos';
import { avisoDeEdicao, EditorSala, type Salvo } from '../src/componentes/EditorSala';
import { type Mensagem, Toast } from '../src/componentes/Toast';
import { Brilho, Vidro } from '../src/componentes/Vidro';
import { ordenar } from '../src/painel';
import type { Tema } from '../src/tema';
import { useTema } from '../src/useTema';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | {
      fase: 'pronto';
      salas: StatusDaSala[];
      indicadores: Indicadores | null;
      atualizadoEm: Date;
      falhou: boolean;
    };

export default function Painel() {
  const { escuro, tema } = useTema();
  const { width, height } = useWindowDimensions();
  const comLateral = width >= 1100;
  const colunas = width >= 1280 ? 3 : width >= 760 ? 2 : 1;
  const margem = width >= 760 ? 40 : 16;

  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  // Só a resposta da busca mais recente vale: uma antiga (ou o erro dela) que chegue
  // depois não sobrescreve o que já está na tela.
  const [novaBusca] = useState(ordemDasBuscas);
  const buscar = useCallback(
    (comCarregando: boolean) => {
      const valeAinda = novaBusca();
      if (comCarregando) setEstado({ fase: 'carregando' });
      // Os indicadores vêm junto com o status; se só eles falharem, o painel segue com os
      // últimos que tinha (ou sem eles) em vez de virar erro.
      return Promise.all([getStatusDasSalas(), getIndicadores().catch(() => undefined)])
        .then(([salas, indicadores]) => {
          if (!valeAinda()) return;
          setEstado((anterior) => ({
            fase: 'pronto',
            salas: ordenar(salas),
            indicadores: indicadores ?? (anterior.fase === 'pronto' ? anterior.indicadores : null),
            atualizadoEm: new Date(),
            falhou: false,
          }));
        })
        .catch((erro: Error) => {
          if (!valeAinda()) return;
          // Com salas na tela, a falha vira só um aviso no cabeçalho e os dados ficam.
          setEstado((anterior) =>
            anterior.fase === 'pronto'
              ? { ...anterior, falhou: true }
              : { fase: 'erro', mensagem: erro.message },
          );
        });
    },
    [novaBusca],
  );
  const carregar = useCallback(() => buscar(true), [buscar]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Contrato (2.3): o painel busca o status a cada 30 s, sem voltar para "carregando".
  // A próxima busca só é agendada quando a anterior termina, então elas nunca se sobrepõem.
  useEffect(() => repetir(() => buscar(false), 30_000), [buscar]);

  // Gaveta de sala (#94): undefined = fechada, null = nova sala, sala = edição.
  const [emEdicao, setEmEdicao] = useState<StatusDaSala | null | undefined>(undefined);
  const [previa, setPrevia] = useState<Faixa | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const fecharEditor = useCallback(() => setEmEdicao(undefined), []);
  const aoSalvar = useCallback(
    ({ sala, nova, antes }: Salvo) => {
      // Sala nova: a gaveta continua aberta, já na edição dela, para adicionar o sensor (#95).
      setEmEdicao(
        nova
          ? {
              sala_id: sala.id,
              nome: sala.nome,
              faixa: sala.faixa,
              intervalo_leitura_s: null,
              status: 'sem_leitura',
              conformidade_24h: null,
              leituras: [],
            }
          : undefined,
      );
      buscar(false);
      setMensagem(
        nova
          ? { id: Date.now(), texto: `${sala.nome} cadastrada. Agora adicione um sensor.` }
          : avisoDeEdicao({ sala, nova, antes }, () => buscar(false), setMensagem),
      );
    },
    [buscar],
  );
  const editando = emEdicao !== undefined;
  // Telas largas abrem espaço para a gaveta, e o card editado continua à vista.
  const abrirEspaco = editando && width >= 1180;

  const salasDaApi = estado.fase === 'pronto' ? estado.salas : [];
  // O card da sala em edição mostra a faixa nova antes de salvar.
  const salas =
    previa && emEdicao
      ? salasDaApi.map((s) => (s.sala_id === emEdicao.sala_id ? { ...s, faixa: previa } : s))
      : salasDaApi;
  const foco = (sala: StatusDaSala | null) => ({
    aoEditar: sala
      ? () => setEmEdicao(salasDaApi.find((s) => s.sala_id === sala.sala_id))
      : undefined,
    editando: !!sala && !!emEdicao && emEdicao.sala_id === sala.sala_id,
    apagado: editando && (!sala || !emEdicao || emEdicao.sala_id !== sala.sala_id),
  });
  const destacada = salas.find((s) => s.status === 'fora_da_faixa') ?? null;
  const outras = salas.filter((s) => s !== destacada);

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Painel | TermoLOG' }} />
      <ScrollView
        contentContainerStyle={[
          styles.conteudo,
          { padding: margem, paddingTop: 12, paddingRight: abrirEspaco ? 576 : margem },
        ]}
      >
        <View style={styles.acoes}>
          <Text numberOfLines={1} style={[styles.pequeno, styles.situacao, { color: tema.texto2 }]}>
            {estado.fase === 'pronto' &&
              `Atualizado às ${estado.atualizadoEm.toLocaleTimeString('pt-BR')}`}
            {estado.fase === 'pronto' && estado.falhou && (
              <Text style={{ color: tema.alerta }}>. A última busca falhou</Text>
            )}
          </Text>
          <Pressable
            onPress={() => setEmEdicao(null)}
            accessibilityRole="button"
            accessibilityLabel="Nova sala"
            style={({ pressed }) => [
              styles.novaSala,
              { backgroundColor: tema.texto },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <PlusIcon size={16} color={tema.fundo} />
            <Text style={[styles.novaSalaTexto, { color: tema.fundo }]}>Nova sala</Text>
          </Pressable>
        </View>

        {estado.fase === 'carregando' && <Esqueleto tema={tema} />}
        {estado.fase === 'erro' && (
          <Aviso tema={tema} mensagem={estado.mensagem} aoTentar={carregar} />
        )}
        {estado.fase === 'pronto' && salas.length === 0 && (
          <Aviso tema={tema} vazio aoTentar={() => setEmEdicao(null)} />
        )}
        {estado.fase === 'pronto' && salas.length > 0 && (
          <View style={styles.corpo}>
            <Resumo
              salas={salas}
              indicadores={estado.indicadores}
              tema={tema}
              estreito={width < 760}
            />
            <View style={[styles.corpo, { flexDirection: comLateral ? 'row' : 'column' }]}>
              <View style={styles.principal}>
                {/* O bloco grande só aparece com sala fora da faixa: o desvio num olhar. */}
                {destacada && (
                  <View style={styles.destaqueComBrilho}>
                    <Brilho cor={tema.brilho} />
                    <Destaque sala={destacada} tema={tema} foco={foco(destacada)} />
                  </View>
                )}
                <Grade colunas={colunas}>
                  {outras.map((sala, i) => (
                    <CardSala
                      key={sala.sala_id}
                      sala={sala}
                      tema={tema}
                      ordem={i + 3}
                      foco={foco(sala)}
                    />
                  ))}
                </Grade>
              </View>
              <View style={[styles.corpo, comLateral && styles.lateral]}>
                <Folgas salas={salas} tema={tema} />
                <ListaSalas salas={salas} tema={tema} />
              </View>
            </View>
          </View>
        )}
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
      />
      <Toast mensagem={mensagem} tema={tema} escuro={escuro} recuo={abrirEspaco ? 552 : 0} />
    </View>
  );
}

function Grade({ colunas, children }: { colunas: number; children: ReactNode[] }) {
  const linhas = [];
  for (let i = 0; i < children.length; i += colunas) {
    const linha = children.slice(i, i + colunas);
    while (linha.length < colunas) {
      linha.push(<View key={`vazio-${linha.length}`} style={styles.celulaVazia} />);
    }
    linhas.push(
      <View key={i} style={styles.linha}>
        {linha}
      </View>,
    );
  }
  return <View style={styles.grade}>{linhas}</View>;
}

function Esqueleto({ tema }: { tema: Tema }) {
  return (
    <View style={styles.corpo} accessibilityLabel="Carregando salas">
      <View style={styles.linha}>
        {['a', 'b'].map((chave) => (
          <View
            key={chave}
            style={[
              styles.esqueleto,
              { height: 300, backgroundColor: tema.vidro, borderColor: tema.borda },
            ]}
          />
        ))}
      </View>
      <View style={styles.linha}>
        {['c', 'd', 'e'].map((chave) => (
          <View
            key={chave}
            style={[
              styles.esqueleto,
              { height: 230, backgroundColor: tema.vidro, borderColor: tema.borda },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function Aviso({
  tema,
  mensagem,
  aoTentar,
  vazio,
}: {
  tema: Tema;
  mensagem?: string;
  aoTentar?: () => void;
  vazio?: boolean;
}) {
  return (
    <Vidro tema={tema} style={styles.aviso}>
      <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
        {vazio ? 'Nenhuma sala cadastrada' : 'Não foi possível carregar as salas'}
      </Text>
      <Text style={[styles.pequeno, { color: tema.texto2, marginTop: 8 }]}>
        {vazio
          ? 'Cadastre a primeira sala para acompanhá-la aqui. Depois, ligue um sensor a ela.'
          : `Verifique se a API está no ar e tente de novo. (${mensagem})`}
      </Text>
      {aoTentar && (
        <Pressable
          onPress={aoTentar}
          style={({ pressed }) => [
            styles.acao,
            { borderColor: tema.texto, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.acaoTexto, { color: tema.texto }]}>
            {vazio ? 'Nova sala' : 'Tentar de novo'}
          </Text>
        </Pressable>
      )}
    </Vidro>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1 },
  conteudo: { gap: 16 },
  acoes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  novaSala: {
    minWidth: 38,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingLeft: 14,
    paddingRight: 18,
    borderRadius: 999,
  },
  novaSalaTexto: { fontSize: 14, fontWeight: '600' },
  pequeno: { fontSize: 14, fontVariant: ['tabular-nums'] },
  situacao: { flexShrink: 1 },
  corpo: { gap: 16 },
  principal: { flex: 1, gap: 16 },
  lateral: { width: 300 },
  linha: { flexDirection: 'row', gap: 16 },
  destaqueComBrilho: { flexDirection: 'row' },
  grade: { gap: 16 },
  // Mesmo padding e borda do card, para a célula vazia dividir a linha por igual.
  celulaVazia: {
    flex: 1,
    flexBasis: 0,
    minWidth: 220,
    padding: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  esqueleto: { flex: 1, borderWidth: 1, borderRadius: 26, opacity: 0.7 },
  aviso: { alignItems: 'flex-start', padding: 30 },
  avisoTitulo: { fontSize: 22, fontWeight: '500' },
  acao: {
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  acaoTexto: { fontSize: 14, fontWeight: '600' },
});
