import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import {
  type CorpoDaSala,
  cadastrarSala,
  editarSala,
  type Faixa,
  getSala,
  type SalaDetalhe,
  type StatusDaSala,
} from '../api';
import {
  chave,
  corpoDaSala,
  dominio,
  errosDaFaixa,
  FAIXA_VAZIA,
  ficariaFora,
  GRANDEZAS,
  type Grandeza,
  type Lado,
  LIMITES_DO_SENSOR,
  noPasso,
  valorDaAlca,
} from '../faixa';
import { leituraPrincipal } from '../painel';
import type { Tema } from '../tema';
import { useCelular } from '../useCelular';
import { SensoresDaSala } from './SensoresDaSala';
import { Termometro } from './Termometro';
import type { Mensagem } from './Toast';

const desfoque =
  Platform.OS === 'web' ? ({ backdropFilter: 'blur(28px) saturate(140%)' } as ViewStyle) : null;

export type Salvo = { sala: SalaDetalhe; nova: boolean; antes: CorpoDaSala | null };

/** Aviso depois de editar: "Desfazer" manda de volta nome, descrição e faixa como estavam. */
export function avisoDeEdicao(
  { sala, antes }: Salvo,
  recarregar: () => void,
  avisar: (mensagem: Mensagem) => void,
): Mensagem {
  return {
    id: Date.now(),
    texto: `${sala.nome} salva`,
    desfazer: antes
      ? () =>
          editarSala(sala.id, antes)
            .then(() => {
              recarregar();
              avisar({ id: Date.now(), texto: 'Alteração desfeita' });
            })
            .catch((erro: Error) =>
              avisar({ id: Date.now(), texto: `Não deu para desfazer: ${erro.message}` }),
            )
      : undefined,
  };
}

type Props = {
  /** Sala sendo editada; null cadastra uma nova. undefined = gaveta fechada. */
  sala: StatusDaSala | null | undefined;
  tema: Tema;
  escuro: boolean;
  largura: number;
  altura: number;
  aoFechar: () => void;
  /** Faixa em edição, para o card da sala mostrar a prévia; null ao fechar. */
  aoMudarFaixa: (faixa: Faixa | null) => void;
  aoSalvar: (salvo: Salvo) => void;
  /** Na tela da sala os sensores já estão à vista: a gaveta fica só com os dados da sala. */
  semSensores?: boolean;
};

/**
 * Gaveta de vidro para cadastrar sala ou editar nome, descrição e faixa (#94). Entra pela
 * direita no computador e sobe de baixo no celular; o painel continua visível atrás.
 */
export function EditorSala({
  sala,
  tema,
  escuro,
  largura,
  altura,
  aoFechar,
  aoMudarFaixa,
  aoSalvar,
  semSensores,
}: Props) {
  const aberto = sala !== undefined;
  const celular = largura < 760;
  const [visivel, setVisivel] = useState(aberto);
  const entrada = useRef(new Animated.Value(0)).current;
  const nomeRef = useRef<TextInput>(null);
  const rolagem = useRef<ScrollView>(null);
  // Logo depois de cadastrar (null -> sala), a gaveta desce até os sensores.
  const anterior = useRef(sala);
  useEffect(() => {
    const vemDoCadastro = anterior.current === null && !!sala;
    anterior.current = sala;
    if (!vemDoCadastro) return;
    const descer = setTimeout(() => rolagem.current?.scrollToEnd({ animated: true }), 450);
    return () => clearTimeout(descer);
  }, [sala]);

  // Estado do formulário, recomeçado a cada abertura.
  const [editada, setEditada] = useState<StatusDaSala | null>(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [faixa, setFaixa] = useState<Faixa>(FAIXA_VAZIA);
  const [original, setOriginal] = useState<CorpoDaSala | null>(null);
  const [dominios, setDominios] = useState<Record<Grandeza, [number, number]>>({
    temperatura: [-30, 40],
    umidade: [0, 100],
  });
  const [salvando, setSalvando] = useState(false);
  const [erroNome, setErroNome] = useState('');
  const [erroApi, setErroApi] = useState('');

  useEffect(() => {
    if (sala === undefined) return;
    const leitura = sala && leituraPrincipal(sala);
    const inicial = sala ? { ...sala.faixa } : FAIXA_VAZIA;
    setEditada(sala);
    setNome(sala?.nome ?? '');
    setDescricao('');
    setFaixa(inicial);
    setOriginal(sala ? corpoDaSala(sala.nome, '', inicial) : null);
    setDominios({
      temperatura: dominio('temperatura', inicial, leitura?.temperatura),
      umidade: [0, 100],
    });
    setErroNome('');
    setErroApi('');
    setSalvando(false);
    if (!sala) return;
    // GET /salas/status não traz a descrição; ela vem do detalhe da sala.
    let vale = true;
    getSala(sala.sala_id)
      .then((d) => {
        if (!vale) return;
        setDescricao(d.descricao ?? '');
        setOriginal((o) => o && { ...o, descricao: d.descricao });
      })
      .catch(() => {});
    return () => {
      vale = false;
    };
  }, [sala]);

  // Entrada e saída da gaveta (sem animação se o sistema pedir menos movimento).
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduzir) => {
      const fim = () => {
        if (aberto && sala === null) nomeRef.current?.focus();
      };
      if (reduzir) {
        entrada.setValue(aberto ? 1 : 0);
        return fim();
      }
      Animated.timing(entrada, {
        toValue: aberto ? 1 : 0,
        duration: aberto ? 520 : 320,
        easing: aberto ? Easing.bezier(0.16, 1, 0.3, 1) : Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: false,
      }).start(fim);
    });
  }, [aberto, entrada, sala]);

  // Fechada, a gaveta sai da árvore depois da animação de saída: os campos não ficam no Tab.
  useEffect(() => {
    if (aberto) return setVisivel(true);
    const sair = setTimeout(() => setVisivel(false), 360);
    return () => clearTimeout(sair);
  }, [aberto]);

  // Esc fecha a gaveta no navegador.
  useEffect(() => {
    if (!aberto || Platform.OS !== 'web') return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aberto, aoFechar]);

  // O card da sala acompanha a faixa em edição.
  useEffect(() => {
    aoMudarFaixa(aberto && editada ? faixa : null);
  }, [aberto, editada, faixa, aoMudarFaixa]);

  if (!visivel) return null;

  const leituras = editada?.leituras ?? [];
  const leitura = editada ? leituraPrincipal(editada) : null;
  const erros = errosDaFaixa(faixa);
  const invalida = Object.keys(erros).length > 0;
  const corpo = corpoDaSala(nome, descricao, faixa);
  const mudou = original === null || JSON.stringify(corpo) !== JSON.stringify(original);
  const ficaFora = leituras.some((l) => ficariaFora(l, faixa));
  const estavaFora = editada?.status === 'fora_da_faixa';

  const arrastar = (g: Grandeza) => (lado: Lado, valor: number) =>
    setFaixa((f) => {
      const [lo, hi] = dominios[g];
      return { ...f, [chave(g, lado)]: valorDaAlca(f, g, lado, Math.min(hi, Math.max(lo, valor))) };
    });
  // Digitado vale como foi escrito (no passo); se inverter a faixa, aparece a mensagem.
  // Digitado vale como foi escrito: fora do que o sensor mede, aparece a mensagem e o
  // Salvar desliga. A escala cresce até o valor, mas nunca além do limite do sensor.
  const digitar = (g: Grandeza) => (lado: Lado, valor: number | null) => {
    const v = valor === null ? null : noPasso(valor, GRANDEZAS[g].passo);
    setFaixa((f) => ({ ...f, [chave(g, lado)]: v }));
    if (v !== null) {
      const [lo, hi] = dominios[g];
      const [piso, teto] = LIMITES_DO_SENSOR[g];
      if (v < lo || v > hi) {
        setDominios((d) => ({
          ...d,
          [g]: [
            Math.max(piso, Math.min(lo, Math.floor(v - 2))),
            Math.min(teto, Math.max(hi, Math.ceil(v + 2))),
          ],
        }));
      }
    }
  };
  // Ligar um limite: perto da outra alça ou da leitura atual.
  const ligar = (g: Grandeza) => (lado: Lado) => {
    const [lo, hi] = dominios[g];
    const outro = faixa[chave(g, lado === 'min' ? 'max' : 'min')];
    const ref = (leitura ? leitura[g] : null) ?? (lo + hi) / 2;
    const sinal = lado === 'min' ? -1 : 1;
    const base = outro !== null ? outro + sinal * (hi - lo) * 0.25 : ref + sinal * (hi - lo) * 0.18;
    arrastar(g)(lado, base);
  };

  const salvar = () => {
    if (!corpo.nome) {
      setErroNome('Dê um nome para a sala.');
      nomeRef.current?.focus();
      return;
    }
    if (invalida || salvando) return;
    setSalvando(true);
    setErroApi('');
    const pedido = editada ? editarSala(editada.sala_id, corpo) : cadastrarSala(corpo);
    pedido
      .then((salva) => aoSalvar({ sala: salva, nova: !editada, antes: original }))
      .catch((erro: Error) => {
        setErroApi(`A API recusou: ${erro.message}`);
        setSalvando(false);
      });
  };

  const alturaTermometro = Math.round(Math.min(400, Math.max(220, altura * (celular ? 0.3 : 0.4))));
  const deslocar = entrada.interpolate({
    inputRange: [0, 1],
    outputRange: [celular ? altura : 560, 0],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={aberto ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: entrada }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: `${tema.fundo}4d` }]}
          onPress={aoFechar}
          accessibilityLabel="Fechar"
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel={editada ? 'Editar sala' : 'Nova sala'}
        style={[
          styles.gaveta,
          celular ? styles.folha : styles.lateral,
          desfoque,
          {
            backgroundColor: escuro ? 'rgba(24,27,31,0.86)' : 'rgba(246,247,249,0.92)',
            borderColor: tema.borda,
            transform: [celular ? { translateY: deslocar } : { translateX: deslocar }],
          },
        ]}
      >
        <View style={styles.topo}>
          <Text style={[styles.titulo, { color: tema.texto }]} accessibilityRole="header">
            {editada ? 'Editar sala' : 'Nova sala'}
          </Text>
          <Pressable
            onPress={aoFechar}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            style={({ pressed }) => [
              styles.redondo,
              celular && styles.redondoCelular,
              { backgroundColor: tema.vidroForte, borderColor: tema.borda },
              pressed && styles.pressionado,
            ]}
          >
            <XIcon size={16} color={tema.texto} />
          </Pressable>
        </View>

        <ScrollView
          ref={rolagem}
          style={styles.rolagem}
          contentContainerStyle={[styles.corpo, celular && styles.corpoCelular]}
        >
          <Campo rotulo="Nome" erro={erroNome} tema={tema}>
            <TextInput
              ref={nomeRef}
              value={nome}
              onChangeText={(t) => {
                setNome(t);
                setErroNome('');
              }}
              maxLength={100}
              placeholder="Ex.: Câmara fria 2"
              placeholderTextColor={tema.texto2}
              accessibilityLabel="Nome"
              style={[
                styles.entrada,
                {
                  color: tema.texto,
                  backgroundColor: tema.vidroForte,
                  borderColor: erroNome ? tema.alerta : tema.borda,
                },
              ]}
            />
          </Campo>
          <Campo rotulo="Descrição (opcional)" tema={tema}>
            <TextInput
              value={descricao}
              onChangeText={setDescricao}
              placeholder="Onde fica, o que guarda"
              placeholderTextColor={tema.texto2}
              accessibilityLabel="Descrição"
              style={[
                styles.entrada,
                { color: tema.texto, backgroundColor: tema.vidroForte, borderColor: tema.borda },
              ]}
            />
          </Campo>
          <View style={[styles.termos, celular && styles.termosCelular]}>
            {(['temperatura', 'umidade'] as const).map((g) => (
              <Termometro
                key={g}
                g={g}
                faixa={faixa}
                dominio={dominios[g]}
                atual={leitura ? leitura[g] : null}
                tema={tema}
                escuro={escuro}
                altura={alturaTermometro}
                erro={erros[g]}
                aoArrastar={arrastar(g)}
                aoDigitar={digitar(g)}
                aoLigar={ligar(g)}
              />
            ))}
          </View>
          {/* Sensores só existem em sala já cadastrada (#95). */}
          {editada && !semSensores && <SensoresDaSala salaId={editada.sala_id} tema={tema} />}
        </ScrollView>

        {ficaFora && (
          <View
            style={[styles.aviso, { backgroundColor: tema.alertaFundo }]}
            accessibilityRole="alert"
          >
            <WarningCircleIcon size={18} weight="fill" color={tema.alerta} />
            <Text style={[styles.avisoTexto, { color: tema.alerta }]}>
              {estavaFora
                ? 'A leitura atual continua fora desta faixa. O alerta seguirá aberto.'
                : 'Com esta faixa, a leitura atual ficaria fora e um alerta seria aberto.'}
            </Text>
          </View>
        )}
        <View style={[styles.rodape, { borderTopColor: tema.borda }]}>
          <Text style={[styles.erroApi, { color: tema.alerta }]} accessibilityRole="alert">
            {erroApi}
          </Text>
          <Pressable
            onPress={aoFechar}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.botao,
              celular && styles.botaoCelular,
              { borderWidth: 1, borderColor: tema.borda, backgroundColor: tema.vidroForte },
              pressed && styles.pressionado,
            ]}
          >
            <Text style={[styles.botaoTexto, { color: tema.texto }]}>Cancelar</Text>
          </Pressable>
          <BotaoSalvar
            rotulo={editada ? 'Salvar' : 'Cadastrar'}
            salvando={salvando}
            desligado={invalida || !mudou}
            tema={tema}
            aoTocar={salvar}
          />
        </View>
      </Animated.View>
    </View>
  );
}

function Campo({
  rotulo,
  erro,
  tema,
  children,
}: {
  rotulo: string;
  erro?: string;
  tema: Tema;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.campo}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>{rotulo}</Text>
      {children}
      {!!erro && <Text style={[styles.erroCampo, { color: tema.alerta }]}>{erro}</Text>}
    </View>
  );
}

/** Botão principal com a barra de progresso embaixo enquanto a API responde. */
function BotaoSalvar({
  rotulo,
  salvando,
  desligado,
  tema,
  aoTocar,
}: {
  rotulo: string;
  salvando: boolean;
  desligado: boolean;
  tema: Tema;
  aoTocar: () => void;
}) {
  const barra = useRef(new Animated.Value(0)).current;
  const celular = useCelular();
  useEffect(() => {
    if (!salvando) return barra.setValue(0);
    const laco = Animated.loop(
      Animated.timing(barra, {
        toValue: 1,
        duration: 900,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      }),
    );
    laco.start();
    return () => laco.stop();
  }, [salvando, barra]);
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado || salvando}
      accessibilityRole="button"
      accessibilityState={{ disabled: desligado, busy: salvando }}
      style={({ pressed }) => [
        styles.botao,
        styles.principal,
        celular && styles.botaoCelular,
        { backgroundColor: tema.texto, opacity: desligado ? 0.35 : 1 },
        pressed && styles.pressionado,
      ]}
    >
      <Text style={[styles.botaoTexto, { color: tema.fundo }]}>
        {salvando ? (rotulo === 'Salvar' ? 'Salvando' : 'Cadastrando') : rotulo}
      </Text>
      {salvando && (
        <Animated.View
          style={[
            styles.barra,
            {
              backgroundColor: tema.folga,
              width: barra.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gaveta: {
    position: 'absolute',
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 24 },
  },
  lateral: { top: 16, right: 16, bottom: 16, width: 520, borderRadius: 30 },
  folha: {
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '92%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 22,
    paddingBottom: 6,
    paddingLeft: 26,
    paddingRight: 22,
  },
  titulo: { fontSize: 22, fontWeight: '500', letterSpacing: -0.3 },
  redondo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolagem: { flexGrow: 0, flexShrink: 1 },
  corpo: { paddingHorizontal: 26, paddingTop: 10, paddingBottom: 20, gap: 22 },
  corpoCelular: { paddingHorizontal: 18 },
  campo: { gap: 6 },
  rotulo: { fontSize: 13 },
  entrada: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  erroCampo: { fontSize: 12 },
  termos: { flexDirection: 'row', gap: 14 },
  termosCelular: { gap: 10 },
  aviso: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginHorizontal: 22,
    marginLeft: 26,
    marginBottom: 12,
    padding: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  avisoTexto: { flex: 1, fontSize: 13, lineHeight: 18 },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 16,
    paddingBottom: 22,
    paddingLeft: 26,
    paddingRight: 22,
    borderTopWidth: 1,
    marginTop: 'auto',
  },
  erroApi: { flex: 1, fontSize: 12 },
  botao: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  principal: { minWidth: 116 },
  // Alvos de toque de 44 px no celular (#139).
  redondoCelular: { width: 44, height: 44, borderRadius: 22 },
  botaoCelular: { height: 44 },
  botaoTexto: { fontSize: 14, fontWeight: '600' },
  barra: { position: 'absolute', left: 0, bottom: 0, height: 3 },
  pressionado: { transform: [{ scale: 0.97 }] },
});
