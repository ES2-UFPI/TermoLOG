import { Stack } from 'expo-router';
import { DownloadSimpleIcon } from 'phosphor-react-native/src/icons/DownloadSimple';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { baixarRelatorioDeLeituras, getSalas, type SalaResumo } from '../src/api';
import { ordemDasBuscas } from '../src/busca';
import { CalendarioDePeriodo, Seletor } from '../src/componentes/CamposDoRelatorio';
import { PreviaDoRelatorio } from '../src/componentes/PreviaDoRelatorio';
import { Botao } from '../src/componentes/SensoresDaSala';
import { type Mensagem, Toast } from '../src/componentes/Toast';
import { Vidro } from '../src/componentes/Vidro';
import {
  ATALHOS,
  dataLegivel,
  erroDoPeriodo,
  FORMATOS,
  type Formato,
  lerRelatorio,
  type Periodo,
  parametrosDoRelatorio,
  type RelatorioLido,
} from '../src/relatorios';
import type { Tema } from '../src/tema';
import { ALVO_DE_TOQUE, LARGURA_DO_CELULAR } from '../src/toque';
import { useCelular } from '../src/useCelular';
import { useTema } from '../src/useTema';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; salas: SalaResumo[] };

/** Tela de relatórios (#109): escolhe sala, período e formato, confere a prévia e baixa. */
export default function Relatorios() {
  const { escuro, tema } = useTema();
  const { width } = useWindowDimensions();
  const margem = width >= LARGURA_DO_CELULAR ? 40 : 16;

  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);

  const carregar = useCallback(() => {
    setEstado({ fase: 'carregando' });
    getSalas()
      .then((salas) => setEstado({ fase: 'pronto', salas }))
      .catch((erro: Error) => setEstado({ fase: 'erro', mensagem: erro.message }));
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <View style={[styles.tela, { backgroundColor: tema.fundo }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Relatórios | TermoLOG' }} />
      <ScrollView contentContainerStyle={[styles.conteudo, { padding: margem, paddingTop: 12 }]}>
        <View style={styles.corpo}>
          <View style={styles.titulo}>
            <Text style={[styles.h1, { color: tema.texto }]} accessibilityRole="header">
              Relatórios
            </Text>
            <Text style={[styles.texto, { color: tema.texto2 }]}>
              Leituras de uma sala no período escolhido, para a vigilância sanitária.
            </Text>
          </View>

          {estado.fase === 'carregando' && (
            <View
              accessibilityLabel="Carregando as salas"
              style={[styles.esqueleto, { backgroundColor: tema.vidro, borderColor: tema.borda }]}
            />
          )}
          {estado.fase === 'erro' && (
            <Vidro tema={tema} style={styles.aviso}>
              <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
                Não foi possível carregar as salas
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Verifique se a API está no ar e tente de novo. ({estado.mensagem})
              </Text>
              <Botao rotulo="Tentar de novo" tema={tema} aoTocar={carregar} />
            </Vidro>
          )}
          {estado.fase === 'pronto' && estado.salas.length === 0 && (
            <Vidro tema={tema} style={styles.aviso}>
              <Text style={[styles.avisoTitulo, { color: tema.texto }]}>
                Nenhuma sala cadastrada
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                Cadastre uma sala no painel para gerar o relatório dela.
              </Text>
            </Vidro>
          )}
          {estado.fase === 'pronto' && estado.salas.length > 0 && (
            <Formulario
              salas={estado.salas}
              largura={Math.min(width - margem * 2, 1320)}
              tema={tema}
              aoBaixar={(nome) => setMensagem({ id: Date.now(), texto: `${nome} baixado` })}
            />
          )}
        </View>
      </ScrollView>
      <Toast mensagem={mensagem} tema={tema} escuro={escuro} />
    </View>
  );
}

const LARGURA_DO_FORMULARIO = 340;
// O formulário acompanha a rolagem enquanto a tabela da prévia desce.
const fixo = { position: 'sticky', top: 16 } as unknown as ViewStyle;

type Previa =
  | { fase: 'carregando'; relatorio: RelatorioLido | null }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; relatorio: RelatorioLido };

function Formulario({
  salas,
  largura,
  tema,
  aoBaixar,
}: {
  salas: SalaResumo[];
  largura: number;
  tema: Tema;
  aoBaixar: (nome: string) => void;
}) {
  const largo = largura >= 980;
  const celular = useCelular();
  const [salaId, setSalaId] = useState(salas[0].id);
  const [periodo, setPeriodo] = useState<Periodo>(() => ATALHOS[0].periodo(new Date()));
  const [formato, setFormato] = useState<Formato>('csv');
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  const [previa, setPrevia] = useState<Previa>({ fase: 'carregando', relatorio: null });
  const [tentativa, setTentativa] = useState(0);
  const sala = salas.find((s) => s.id === salaId) ?? salas[0];
  const problema = erroDoPeriodo(periodo);
  const atalhos = useMemo(() => {
    const agora = new Date();
    return ATALHOS.map((a) => ({ rotulo: a.rotulo, periodo: a.periodo(agora) }));
  }, []);

  // A prévia é o próprio CSV da rota, sem rota nova: o que aparece é o que será baixado.
  // ponytail: traz o período inteiro a cada mudança. Se ficar pesado com períodos longos,
  // a rota precisa de um formato resumido, combinado no contrato.
  const [novaBusca] = useState(ordemDasBuscas);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tentativa` só repete a busca.
  useEffect(() => {
    if (problema) return;
    const valeAinda = novaBusca();
    setPrevia((p) => ({
      fase: 'carregando',
      relatorio: p.fase === 'erro' ? null : p.relatorio,
    }));
    // Espera a pessoa terminar de digitar a data antes de gerar o arquivo.
    const espera = setTimeout(() => {
      baixarRelatorioDeLeituras(parametrosDoRelatorio(salaId, periodo, 'csv'), 'csv')
        .then(({ arquivo }) => arquivo.text())
        .then((texto) => {
          if (valeAinda()) setPrevia({ fase: 'pronto', relatorio: lerRelatorio(texto) });
        })
        .catch((e: Error) => {
          if (valeAinda()) setPrevia({ fase: 'erro', mensagem: e.message });
        });
    }, 300);
    return () => clearTimeout(espera);
  }, [salaId, periodo, problema, tentativa, novaBusca]);

  const mudarPeriodo = (novo: Periodo) => {
    setPeriodo(novo);
    setErro('');
  };

  const baixar = () => {
    if (problema) return setErro(problema);
    setBaixando(true);
    setErro('');
    baixarRelatorioDeLeituras(parametrosDoRelatorio(salaId, periodo, formato), formato)
      .then(({ arquivo, nome }) => {
        const url = URL.createObjectURL(arquivo);
        const link = document.createElement('a');
        link.href = url;
        link.download = nome;
        link.click();
        // Revoga depois: no Firefox e no Safari, revogar na hora pode cancelar um download grande.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        aoBaixar(nome);
      })
      .catch((e: Error) => setErro(`Não deu para gerar o relatório: ${e.message}.`))
      .finally(() => setBaixando(false));
  };

  const relatorio = previa.fase === 'erro' ? null : previa.relatorio;

  return (
    <View style={[styles.grade, largo && styles.gradeLarga]}>
      <Vidro
        tema={tema}
        ordem={0}
        style={[styles.formulario, largo && styles.formularioLargo, largo && fixo]}
      >
        <View style={[styles.campo, styles.campoDaSala]}>
          <Text style={[styles.rotulo, { color: tema.texto2 }]}>Sala</Text>
          <Seletor rotulo="Sala" valor={salaId} opcoes={salas} aoEscolher={setSalaId} tema={tema} />
        </View>

        <View style={styles.campo}>
          <Text style={[styles.rotulo, { color: tema.texto2 }]}>Período</Text>
          <View style={styles.opcoes}>
            {atalhos.map((a) => {
              const ativo = a.periodo.inicio === periodo.inicio && a.periodo.fim === periodo.fim;
              return (
                <Pressable
                  key={a.rotulo}
                  onPress={() => mudarPeriodo(a.periodo)}
                  accessibilityRole="button"
                  aria-pressed={ativo}
                  style={({ pressed }) => [
                    styles.opcao,
                    celular && styles.opcaoCelular,
                    {
                      borderColor: ativo ? tema.texto : tema.borda,
                      backgroundColor: ativo ? tema.vidroForte : 'transparent',
                    },
                    pressed && styles.pressionado,
                  ]}
                >
                  <Text style={[styles.opcaoTexto, { color: ativo ? tema.texto : tema.texto2 }]}>
                    {a.rotulo}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <CalendarioDePeriodo periodo={periodo} aoMudar={mudarPeriodo} tema={tema} />
          <View style={[styles.datas, { borderTopColor: tema.trilho }]}>
            <View style={styles.data}>
              <Text style={[styles.rotulo, { color: tema.texto2 }]}>De</Text>
              <Text style={[styles.dataValor, { color: tema.texto }]}>
                {dataLegivel(periodo.inicio)}
              </Text>
            </View>
            <View style={styles.data}>
              <Text style={[styles.rotulo, { color: tema.texto2 }]}>Até</Text>
              <Text style={[styles.dataValor, { color: periodo.fim ? tema.texto : tema.texto2 }]}>
                {dataLegivel(periodo.fim)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.campo}>
          <Text style={[styles.rotulo, { color: tema.texto2 }]}>Formato</Text>
          <View style={styles.opcoes} accessibilityRole="radiogroup">
            {FORMATOS.map((f) => (
              <Pressable
                key={f.id}
                // Formato indisponível (Excel, até a #108) fica na tela, mas não reage ao toque.
                onPress={() => {
                  setFormato(f.id);
                  // O erro do formato anterior (ex.: 422 do PDF) não vale para o novo.
                  setErro('');
                }}
                disabled={!f.pronto}
                accessibilityRole="radio"
                aria-checked={f.id === formato}
                accessibilityLabel={f.pronto ? f.rotulo : `${f.rotulo}, ainda não disponível`}
                style={({ pressed }) => [
                  styles.opcao,
                  celular && styles.opcaoCelular,
                  {
                    borderColor: f.id === formato ? tema.texto : tema.borda,
                    backgroundColor: f.id === formato ? tema.vidroForte : 'transparent',
                    opacity: f.pronto ? 1 : 0.55,
                  },
                  f.pronto && pressed && styles.pressionado,
                ]}
              >
                <Text
                  style={[
                    styles.opcaoTexto,
                    { color: f.id === formato ? tema.texto : tema.texto2 },
                  ]}
                >
                  {f.rotulo}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {formato === 'pdf'
              ? 'O PDF aceita até 200.000 leituras e pode levar alguns segundos. A prévia é a do CSV.'
              : 'O Excel ainda não está disponível.'}
          </Text>
        </View>

        {!!erro && (
          <Text style={[styles.pequeno, { color: tema.alerta }]} accessibilityRole="alert">
            {erro}
          </Text>
        )}
        <Botao
          rotulo={baixando ? 'Gerando o relatório' : 'Baixar relatório'}
          principal
          tema={tema}
          desligado={baixando}
          aoTocar={baixar}
          icone={<DownloadSimpleIcon size={16} color={tema.fundo} />}
        />
      </Vidro>

      <Vidro tema={tema} ordem={1} style={styles.documento}>
        <View style={styles.documentoTopo}>
          <Text style={[styles.avisoTitulo, { color: tema.texto }]} accessibilityRole="header">
            Prévia do relatório
          </Text>
          {previa.fase === 'carregando' && !problema && (
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>Atualizando</Text>
          )}
        </View>
        {problema && (
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>
            {problema} A prévia aparece em seguida.
          </Text>
        )}
        {!problema && previa.fase === 'erro' && (
          <View style={styles.previaErro}>
            <Text style={[styles.texto, { color: tema.texto }]}>
              Não foi possível gerar a prévia.
            </Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>({previa.mensagem})</Text>
            <Botao rotulo="Tentar de novo" tema={tema} aoTocar={() => setTentativa((t) => t + 1)} />
          </View>
        )}
        {!problema && previa.fase === 'carregando' && !relatorio && (
          <View
            accessibilityLabel="Gerando a prévia"
            style={[styles.previaEsqueleto, { backgroundColor: tema.vidroForte }]}
          />
        )}
        {/* Enquanto escolhe o período, a prévia anterior fica apagada: a tela não pula. */}
        {relatorio && (
          <View style={(problema || previa.fase === 'carregando') && styles.atualizando}>
            <PreviaDoRelatorio
              relatorio={relatorio}
              faixa={sala.faixa}
              largura={largo ? largura - LARGURA_DO_FORMULARIO - 16 - 44 : largura - 44}
              tema={tema}
            />
          </View>
        )}
      </Vidro>
    </View>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  tela: { flex: 1 },
  conteudo: { gap: 16 },
  corpo: { width: '100%', maxWidth: 1320, alignSelf: 'center', gap: 20, paddingTop: 12 },
  titulo: { gap: 6 },
  h1: { fontSize: 34, fontWeight: '300', letterSpacing: -0.9, lineHeight: 40 },
  texto: { fontSize: 15, lineHeight: 22, ...numeros },
  pequeno: { fontSize: 13, lineHeight: 18, ...numeros },
  rotulo: { fontSize: 13 },
  grade: { gap: 16 },
  gradeLarga: { flexDirection: 'row', alignItems: 'flex-start' },
  formulario: { gap: 22 },
  formularioLargo: { width: LARGURA_DO_FORMULARIO },
  campo: { gap: 8 },
  // Toda View da web é uma camada própria: a lista só passa por cima do calendário assim.
  campoDaSala: { zIndex: 2 },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  opcao: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  opcaoTexto: { fontSize: 13 },
  // Alvo de toque de 44 px no celular (#139).
  opcaoCelular: { height: ALVO_DE_TOQUE },
  datas: { flexDirection: 'row', gap: 12, marginTop: 4, paddingTop: 12, borderTopWidth: 1 },
  data: { flex: 1, gap: 2 },
  dataValor: { fontSize: 15, ...numeros },
  pressionado: { transform: [{ scale: 0.97 }] },
  documento: { flex: 1, gap: 18, minWidth: 0 },
  documentoTopo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  previaErro: { gap: 8, alignItems: 'flex-start' },
  previaEsqueleto: { height: 480, borderRadius: 18, opacity: 0.7 },
  atualizando: { opacity: 0.55 },
  esqueleto: { height: 420, borderRadius: 26, borderWidth: 1, opacity: 0.7 },
  aviso: { gap: 8, padding: 30, alignItems: 'flex-start' },
  avisoTitulo: { fontSize: 20, fontWeight: '500', letterSpacing: -0.2 },
});
