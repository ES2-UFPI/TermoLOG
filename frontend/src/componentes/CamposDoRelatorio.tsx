import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  dataDoCampo,
  diaPorExtenso,
  escolherDia,
  noPeriodo,
  type Periodo,
  semanasDoMes,
} from '../relatorios';
import type { Tema } from '../tema';
import { ALVO_DE_TOQUE } from '../toque';
import { useCelular } from '../useCelular';
import { Surgir } from './Surgir';
import { useFecharFora } from './useFecharFora';

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Lista suspensa própria: Enter ou clique abre, setas andam, Esc e clique fora fecham. */
export function Seletor({
  rotulo,
  valor,
  opcoes,
  aoEscolher,
  tema,
}: {
  rotulo: string;
  valor: number;
  opcoes: { id: number; nome: string }[];
  aoEscolher: (id: number) => void;
  tema: Tema;
}) {
  const celular = useCelular();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<View>(null);
  const atual = opcoes.find((o) => o.id === valor);
  const fechar = useCallback(() => setAberto(false), []);
  useFecharFora(aberto, caixa, fechar);

  useEffect(() => {
    if (!aberto) return;
    const elemento = () => caixa.current as unknown as HTMLElement | null;
    const itens = () => [...(elemento()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    // Abre com o foco na opção escolhida, para as setas partirem dela.
    itens()
      .find((i) => i.getAttribute('aria-selected') === 'true')
      ?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const lista = itens();
      const agora = lista.indexOf(document.activeElement as HTMLElement);
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      lista[(agora + passo + lista.length) % lista.length]?.focus();
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aberto]);

  return (
    <View ref={caixa}>
      <Pressable
        onPress={() => setAberto((a) => !a)}
        accessibilityRole="button"
        accessibilityLabel={`${rotulo}: ${atual?.nome ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        style={({ pressed, hovered, focused }: EstadoDoBotao) => [
          styles.campo,
          {
            backgroundColor: tema.vidroForte,
            borderColor: aberto || hovered || focused ? tema.texto : tema.borda,
          },
          pressed && styles.pressionado,
        ]}
      >
        <Text numberOfLines={1} style={[styles.campoTexto, { color: tema.texto }]}>
          {atual?.nome}
        </Text>
        <CaretDownIcon size={15} color={tema.texto2} />
      </Pressable>
      {aberto && (
        <Surgir style={[styles.lista, { backgroundColor: tema.fundo, borderColor: tema.borda }]}>
          <ScrollView style={styles.listaRolagem} {...({ role: 'listbox' } as object)}>
            {opcoes.map((o) => {
              const escolhida = o.id === valor;
              return (
                <Pressable
                  key={o.id}
                  role="option"
                  aria-selected={escolhida}
                  onPress={() => {
                    aoEscolher(o.id);
                    setAberto(false);
                  }}
                  style={({ hovered, focused }: EstadoDoBotao) => [
                    styles.opcao,
                    celular && styles.opcaoCelular,
                    (hovered || focused) && { backgroundColor: tema.vidroForte },
                  ]}
                >
                  <Text style={[styles.opcaoTexto, { color: tema.texto }]}>{o.nome}</Text>
                  {escolhida && <CheckIcon size={15} color={tema.texto} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Surgir>
      )}
    </View>
  );
}

type EstadoDoBotao = { pressed: boolean; hovered?: boolean; focused?: boolean };

/**
 * Calendário de período, sempre à vista: o primeiro clique marca o início e o segundo, o
 * fim. Enquanto falta o fim, o trecho até o dia sob o ponteiro já aparece marcado.
 */
export function CalendarioDePeriodo({
  periodo,
  aoMudar,
  tema,
}: {
  periodo: Periodo;
  aoMudar: (periodo: Periodo) => void;
  tema: Tema;
}) {
  const celular = useCelular();
  const hoje = dataDoCampo(new Date());
  const [mes, setMes] = useState(() => mesDe(periodo.fim || periodo.inicio || hoje));
  const [sobOPonteiro, setSobOPonteiro] = useState<string | null>(null);

  // Um atalho muda o período por fora: o calendário vai até o mês dele.
  const fim = periodo.fim;
  useEffect(() => {
    if (fim) setMes(mesDe(fim));
  }, [fim]);

  const titulo = new Date(mes.ano, mes.mes, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  const ultimoDoMes = dataDoCampo(new Date(mes.ano, mes.mes + 1, 0));
  const fimDaMarca = periodo.fim || (periodo.inicio ? sobOPonteiro : null) || periodo.inicio;

  return (
    <View style={styles.calendario}>
      <View style={styles.calendarioTopo}>
        <BotaoDoMes
          rotulo="Mês anterior"
          tema={tema}
          aoTocar={() => setMes(mesDe(dataDoCampo(new Date(mes.ano, mes.mes - 1, 1))))}
        >
          <CaretLeftIcon size={14} color={tema.texto} />
        </BotaoDoMes>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.calendarioTitulo, { color: tema.texto }]}
        >
          {titulo.charAt(0).toUpperCase() + titulo.slice(1)}
        </Text>
        <BotaoDoMes
          rotulo="Próximo mês"
          desligado={ultimoDoMes >= hoje}
          tema={tema}
          aoTocar={() => setMes(mesDe(dataDoCampo(new Date(mes.ano, mes.mes + 1, 1))))}
        >
          <CaretRightIcon size={14} color={tema.texto} />
        </BotaoDoMes>
      </View>
      <View style={styles.semana}>
        {DIAS_DA_SEMANA.map((d, i) => (
          // A ordem da semana não muda: o índice serve de chave ("S" e "Q" se repetem).
          // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa.
          <Text key={i} style={[styles.diaDaSemana, { color: tema.texto2 }]}>
            {d}
          </Text>
        ))}
      </View>
      <View onPointerLeave={() => setSobOPonteiro(null)}>
        {semanasDoMes(mes.ano, mes.mes).map((semana) => (
          <View key={semana[0]} style={styles.semana}>
            {semana.map((dia) => {
              const doMes = dia.slice(0, 7) === titulo7(mes);
              const futuro = dia > hoje;
              const marca = noPeriodo(dia, periodo.inicio, fimDaMarca);
              return (
                <View
                  key={dia}
                  style={[
                    styles.celula,
                    celular && styles.celulaCelular,
                    marca.dentro &&
                      !marca.unico && {
                        backgroundColor: tema.vidroForte,
                      },
                    marca.inicio && !marca.unico && styles.bandaInicio,
                    marca.fim && !marca.unico && styles.bandaFim,
                  ]}
                >
                  {doMes && (
                    <Pressable
                      onPress={() => aoMudar(escolherDia(periodo, dia))}
                      onHoverIn={() => setSobOPonteiro(dia)}
                      disabled={futuro}
                      accessibilityRole="button"
                      accessibilityLabel={diaPorExtenso(dia)}
                      accessibilityState={{ disabled: futuro, selected: marca.dentro }}
                      // O botão ocupa a célula inteira (44 px de alto no celular); o círculo é só desenho.
                      style={styles.diaArea}
                    >
                      {({ hovered, focused, pressed }: EstadoDoBotao) => (
                        <View
                          style={[
                            styles.dia,
                            (hovered || focused) && !marca.ponta && { borderColor: tema.texto2 },
                            dia === hoje && !marca.ponta && { borderColor: tema.borda },
                            marca.ponta && { backgroundColor: tema.texto },
                            pressed && styles.pressionado,
                          ]}
                        >
                          <Text
                            style={[
                              styles.diaTexto,
                              {
                                color: marca.ponta ? tema.fundo : futuro ? tema.trilho : tema.texto,
                                fontWeight: marca.ponta || dia === hoje ? '600' : '400',
                              },
                            ]}
                          >
                            {Number(dia.slice(8))}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function BotaoDoMes({
  rotulo,
  desligado,
  tema,
  aoTocar,
  children,
}: {
  rotulo: string;
  desligado?: boolean;
  tema: Tema;
  aoTocar: () => void;
  children: React.ReactNode;
}) {
  const celular = useCelular();
  return (
    <Pressable
      onPress={aoTocar}
      disabled={desligado}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: !!desligado }}
      style={({ pressed, hovered, focused }: EstadoDoBotao) => [
        styles.botaoDoMes,
        celular && styles.botaoDoMesCelular,
        {
          borderColor: hovered || focused ? tema.texto2 : tema.borda,
          opacity: desligado ? 0.3 : 1,
        },
        pressed && styles.pressionado,
      ]}
    >
      {children}
    </Pressable>
  );
}

const mesDe = (campo: string) => ({
  ano: Number(campo.slice(0, 4)),
  mes: Number(campo.slice(5, 7)) - 1,
});
const titulo7 = ({ ano, mes }: { ano: number; mes: number }) =>
  `${ano}-${String(mes + 1).padStart(2, '0')}`;

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  pressionado: { transform: [{ scale: 0.97 }] },
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    height: ALVO_DE_TOQUE,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  campoTexto: { flexShrink: 1, fontSize: 15 },
  lista: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    padding: 6,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  listaRolagem: { maxHeight: 220 },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  opcaoTexto: { flexShrink: 1, fontSize: 14 },
  calendario: { gap: 4 },
  calendarioTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  calendarioTitulo: { fontSize: 14, fontWeight: '500' },
  botaoDoMes: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Alvos de toque de 44 px no celular (#139).
  opcaoCelular: { minHeight: ALVO_DE_TOQUE },
  botaoDoMesCelular: {
    width: ALVO_DE_TOQUE,
    height: ALVO_DE_TOQUE,
    borderRadius: ALVO_DE_TOQUE / 2,
  },
  celulaCelular: { height: ALVO_DE_TOQUE },
  diaArea: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  semana: { flexDirection: 'row' },
  diaDaSemana: { flex: 1, textAlign: 'center', fontSize: 12, lineHeight: 24 },
  celula: {
    flex: 1,
    height: 36,
    marginVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandaInicio: { borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  bandaFim: { borderTopRightRadius: 18, borderBottomRightRadius: 18 },
  dia: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diaTexto: { fontSize: 13, ...numeros },
});
