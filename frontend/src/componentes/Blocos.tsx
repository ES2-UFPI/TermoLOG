import type { Icon } from 'phosphor-react-native';
import { BatteryChargingIcon } from 'phosphor-react-native/src/icons/BatteryCharging';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { DropIcon } from 'phosphor-react-native/src/icons/Drop';
import { FlaskIcon } from 'phosphor-react-native/src/icons/Flask';
import { HardDrivesIcon } from 'phosphor-react-native/src/icons/HardDrives';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { SnowflakeIcon } from 'phosphor-react-native/src/icons/Snowflake';
import { ThermometerColdIcon } from 'phosphor-react-native/src/icons/ThermometerCold';
import { ThermometerHotIcon } from 'phosphor-react-native/src/icons/ThermometerHot';
import { ThermometerSimpleIcon } from 'phosphor-react-native/src/icons/ThermometerSimple';
import { WarningCircleIcon } from 'phosphor-react-native/src/icons/WarningCircle';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Indicadores, StatusDaSala } from '../api';
import {
  conformidade,
  type Figura,
  faixaCompleta,
  faixaCurta,
  faixaDeUmidade,
  figura,
  folga,
  folgasDeTemperatura,
  leituraPrincipal,
  limite,
  numero,
  quando,
  resumo,
  situacao,
  type Tom,
  textoDaFolga,
} from '../painel';
import { corDoTom, type Tema } from '../tema';
import { Regua, Vidro } from './Vidro';

export const ICONES: Record<Figura, Icon> = {
  quente: ThermometerHotIcon,
  frio: ThermometerColdIcon,
  umidade: DropIcon,
  congelado: SnowflakeIcon,
  'sem-sinal': WifiSlashIcon,
  servidor: HardDrivesIcon,
  laboratorio: FlaskIcon,
  energia: BatteryChargingIcon,
  normal: ThermometerSimpleIcon,
};

// Além da cor, a situação vai num ícone ao lado do texto (acessibilidade).
const ICONE_DO_TOM: Record<Tom, Icon> = {
  ok: CheckCircleIcon,
  alerta: WarningCircleIcon,
  'sem-leitura': WifiSlashIcon,
  neutro: InfoIcon,
};

/** Botão redondo de editar a sala (#94), no canto do card. */
function BotaoEditar({ nome, tema, aoEditar }: { nome: string; tema: Tema; aoEditar: () => void }) {
  return (
    <Pressable
      onPress={aoEditar}
      accessibilityRole="button"
      accessibilityLabel={`Editar ${nome}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.editar,
        {
          backgroundColor: tema.vidroForte,
          borderColor: tema.borda,
          opacity: hovered || pressed ? 1 : 0.6,
        },
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <PencilSimpleIcon size={15} color={tema.texto} />
    </Pressable>
  );
}

/** Estado do card enquanto a gaveta de edição está aberta. */
export type Foco = { aoEditar?: () => void; editando?: boolean; apagado?: boolean };
const estiloDoFoco = (tema: Tema, { editando, apagado }: Foco) => [
  apagado && { opacity: 0.4 },
  editando && { borderColor: `${tema.faixa[0]}99` },
];

/** Bloco grande da sala fora da faixa ou, sem nenhuma, a confirmação de que tudo está ok. */
export function Destaque({
  sala,
  tema,
  foco = {},
}: {
  sala: StatusDaSala;
  tema: Tema;
  foco?: Foco;
}) {
  const leitura = leituraPrincipal(sala);
  if (!leitura) return null;
  const f = folga(leitura, sala.faixa);
  const texto = f && textoDaFolga(f);
  const porUmidade = f?.grandeza === 'umidade';
  const IconeDoAlerta = ICONES[figura(sala)];
  return (
    <Vidro tema={tema} ordem={0} style={[styles.destaque, ...estiloDoFoco(tema, foco)]}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Fora da faixa agora</Text>
      <IconeDoAlerta size={56} weight="fill" color={tema.alerta} style={styles.iconeDestaque} />
      {foco.aoEditar && (
        <View style={styles.editarDestaque}>
          <BotaoEditar nome={sala.nome} tema={tema} aoEditar={foco.aoEditar} />
        </View>
      )}
      <Text style={[styles.tempGrande, { color: tema.alerta }]}>
        {porUmidade ? numero(leitura.umidade, 2) : numero(leitura.temperatura, 2)}
        <Text style={styles.unidadeGrande}>{porUmidade ? ' %' : ' °C'}</Text>
      </Text>
      <Text style={[styles.nomeGrande, { color: tema.texto }]}>{sala.nome}</Text>
      <Text style={[styles.detalhe, { color: tema.texto2 }]}>
        Sensor {leitura.sensor_id} · {quando(leitura.data_hora)}
        {texto && ` · ${texto.valor.replace(/^[+−]/, '')} ${texto.legenda}`}
        {porUmidade
          ? ` · temperatura ${numero(leitura.temperatura)} °C`
          : ` · umidade ${Math.round(leitura.umidade)}%`}
      </Text>
      {porUmidade ? (
        <Text style={[styles.pequeno, styles.reguaGrande, { color: tema.texto2 }]}>
          Faixa: {faixaDeUmidade(sala.faixa)}
        </Text>
      ) : (
        <View style={styles.reguaGrande}>
          <Regua sala={sala} tema={tema} grossa />
          <View style={styles.limites}>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              {sala.faixa.temperatura_min !== null
                ? `mín ${limite(sala.faixa.temperatura_min)} °C`
                : ''}
            </Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>
              {sala.faixa.temperatura_max !== null
                ? `máx ${limite(sala.faixa.temperatura_max)} °C`
                : ''}
            </Text>
          </View>
        </View>
      )}
      <Conformidade sala={sala} tema={tema} />
    </Vidro>
  );
}

/**
 * Faixa do topo: a situação numa frase e os três contadores na mesma linha, separados por
 * filetes (sem caixas dentro de caixa). Estreita, para os cards virem logo abaixo.
 */
export function Resumo({
  salas,
  indicadores,
  tema,
  estreito,
}: {
  salas: StatusDaSala[];
  indicadores: Indicadores | null;
  tema: Tema;
  estreito: boolean;
}) {
  const { fora, dentro, semLeitura } = resumo(salas);
  const frase =
    fora > 0
      ? `${fora} ${fora === 1 ? 'sala fora' : 'salas fora'} da faixa`
      : semLeitura > 0
        ? 'Nenhuma sala fora da faixa'
        : 'Todas as salas dentro da faixa';
  const Icone = fora > 0 ? WarningCircleIcon : CheckCircleIcon;
  const contadores = [
    { valor: fora, texto: 'fora da faixa', cor: fora > 0 ? tema.alerta : tema.texto },
    { valor: dentro, texto: 'dentro', cor: tema.texto },
    { valor: semLeitura, texto: 'sem leitura', cor: semLeitura > 0 ? tema.texto : tema.texto2 },
  ];
  // Indicador geral (#145): % das salas com leitura que estão ok agora.
  const geral = indicadores?.salas_dentro_da_faixa;
  const semGeral = geral === null || geral === undefined;
  return (
    <Vidro
      tema={tema}
      ordem={0}
      style={[
        styles.resumo,
        estreito && styles.resumoEstreito,
        fora > 0 && { borderColor: tema.alerta, backgroundColor: tema.alertaFundo },
      ]}
    >
      <View style={styles.resumoFrase} accessibilityRole="header">
        <Icone
          size={30}
          weight={fora > 0 ? 'fill' : 'light'}
          color={fora > 0 ? tema.alerta : tema.folga}
        />
        <Text style={[styles.frase, { color: fora > 0 ? tema.alerta : tema.texto }]}>{frase}</Text>
      </View>
      <View style={[styles.contadores, estreito && styles.contadoresEstreito]}>
        {contadores.map((c, i) => (
          <View
            key={c.texto}
            style={[
              styles.contador,
              estreito && styles.contadorEstreito,
              i > 0 && { borderLeftWidth: 1, borderLeftColor: tema.trilho },
            ]}
          >
            <Text style={[styles.contadorValor, { color: c.cor }]}>{c.valor}</Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>{c.texto}</Text>
          </View>
        ))}
      </View>
      {indicadores && (
        <View style={styles.conformidadeGeral} accessibilityLabel="Salas dentro da faixa">
          <Text style={[semGeral ? styles.pequeno : styles.contadorValor, { color: tema.texto }]}>
            {conformidade(geral)}
          </Text>
          <Text style={[styles.pequeno, { color: tema.texto2 }]}>das salas na faixa agora</Text>
        </View>
      )}
    </Vidro>
  );
}

/** Conformidade das últimas 24 h da sala, no card. */
function Conformidade({ sala, tema }: { sala: StatusDaSala; tema: Tema }) {
  return (
    <Text style={[styles.pequeno, styles.conformidade, { color: tema.texto2 }]}>
      Conformidade 24 h: {conformidade(sala.conformidade_24h)}
    </Text>
  );
}

/** Folga de temperatura de cada sala até o limite mais próximo (a barra parte do limite). */
export function Folgas({ salas, tema }: { salas: StatusDaSala[]; tema: Tema }) {
  const pontos = folgasDeTemperatura(salas);
  if (pontos.length === 0) return null;
  const lo = Math.min(-2, ...pontos.map((p) => p.folga));
  const hi = Math.max(6, ...pontos.map((p) => p.folga));
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;

  return (
    <Vidro tema={tema} ordem={1} style={styles.folgasPainel}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Até o limite (°C)</Text>
      <View style={styles.folgas}>
        {pontos.map(({ sala, folga: valor }) => {
          const alerta = valor < 0;
          const [esquerda, direita] = alerta ? [pos(valor), pos(0)] : [pos(0), pos(valor)];
          return (
            <View key={sala.sala_id} style={styles.folgaLinha}>
              <Text
                numberOfLines={1}
                style={[styles.folgaNome, { color: alerta ? tema.texto : tema.texto2 }]}
              >
                {sala.nome}
              </Text>
              <View style={[styles.folgaTrilho, { backgroundColor: tema.trilho }]}>
                <View
                  style={[styles.limite, { left: `${pos(0)}%`, backgroundColor: tema.texto2 }]}
                />
                <View
                  style={[
                    styles.folgaBarra,
                    {
                      left: `${esquerda}%`,
                      width: `${direita - esquerda}%`,
                      backgroundColor: alerta ? tema.alerta : tema.folga,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.folgaValor, { color: alerta ? tema.alerta : tema.texto }]}>
                {valor >= 0 ? '+' : ''}
                {numero(valor)}
              </Text>
            </View>
          );
        })}
      </View>
    </Vidro>
  );
}

/** Card de uma sala: nome e umidade em cima, figura translúcida, temperatura grande embaixo. */
export function CardSala({
  sala,
  tema,
  ordem,
  foco = {},
}: {
  sala: StatusDaSala;
  tema: Tema;
  ordem: number;
  foco?: Foco;
}) {
  const leitura = leituraPrincipal(sala);
  const f = leitura && folga(leitura, sala.faixa);
  const fora = sala.status === 'fora_da_faixa';
  // Contrato: a sala sai da faixa pela temperatura ou pela umidade; destaca a que estourou.
  const porUmidade = fora && f?.grandeza === 'umidade';
  const tempAlerta = fora && !porUmidade;
  const Figura = ICONES[figura(sala)];
  const { tom, texto } = situacao(sala);
  const IconeDoTom = ICONE_DO_TOM[tom];
  const cor = corDoTom(tema, tom);
  const faixa = faixaCompleta(sala.faixa);

  return (
    <Vidro
      tema={tema}
      ordem={ordem}
      style={[styles.card, fora && { borderColor: tema.alerta }, ...estiloDoFoco(tema, foco)]}
    >
      {/* Tom do alerta por cima do vidro, sem trocar o fundo dele. */}
      {fora && (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: tema.alertaFundo }]}
          pointerEvents="none"
        />
      )}
      <View style={styles.figura} pointerEvents="none">
        <Figura size={120} weight="light" color={fora ? tema.alerta : tema.texto} />
      </View>
      <View style={styles.cardTopo}>
        <Text numberOfLines={1} style={[styles.cardNome, { color: tema.texto }]}>
          {sala.nome}
        </Text>
        <Text style={[styles.pequeno, { color: porUmidade ? tema.alerta : tema.texto2 }]}>
          {leitura ? `${Math.round(leitura.umidade)}%` : ''}
        </Text>
        {foco.aoEditar && <BotaoEditar nome={sala.nome} tema={tema} aoEditar={foco.aoEditar} />}
      </View>
      <View style={styles.espaco} />
      <Text
        style={[
          styles.tempCard,
          { color: tempAlerta ? tema.alerta : leitura ? tema.texto : tema.texto2 },
        ]}
      >
        {leitura ? numero(leitura.temperatura, tempAlerta ? 2 : 1) : '--'}
        {leitura && <Text style={styles.unidadeCard}> °C</Text>}
      </Text>
      <View style={styles.linhaSituacao}>
        <IconeDoTom size={15} weight={tom === 'alerta' ? 'fill' : 'regular'} color={cor} />
        <Text style={[styles.pequeno, { color: cor }]}>{texto}</Text>
      </View>
      <View style={styles.reguaCard}>
        <Regua sala={sala} tema={tema} />
      </View>
      {faixa !== null && (
        <Text style={[styles.pequeno, styles.faixaCard, { color: tema.texto2 }]}>
          Faixa: {faixa}
        </Text>
      )}
      <Conformidade sala={sala} tema={tema} />
    </Vidro>
  );
}

/** Lista lateral com todas as salas, na ordem do painel. */
export function ListaSalas({ salas, tema }: { salas: StatusDaSala[]; tema: Tema }) {
  return (
    <Vidro tema={tema} ordem={2} style={styles.lista}>
      <Text style={[styles.rotulo, { color: tema.texto2, marginBottom: 8 }]}>Salas</Text>
      {salas.map((sala) => {
        const leitura = leituraPrincipal(sala);
        const porUmidade = leitura && folga(leitura, sala.faixa)?.grandeza === 'umidade';
        const fora = sala.status === 'fora_da_faixa';
        const Icone = ICONES[figura(sala)];
        const cor = fora ? tema.alerta : tema.texto;
        return (
          <View
            key={sala.sala_id}
            style={[styles.item, fora && { backgroundColor: tema.alertaFundo }]}
          >
            <Icone size={22} weight="light" color={cor} />
            <View style={styles.itemTexto}>
              <Text numberOfLines={1} style={[styles.itemNome, { color: tema.texto }]}>
                {sala.nome}
              </Text>
              <Text style={[styles.pequeno, { color: tema.texto2 }]}>
                {fora
                  ? porUmidade
                    ? 'umidade fora da faixa'
                    : 'fora da faixa'
                  : leitura
                    ? faixaCurta(sala.faixa)
                    : 'sem leitura'}
              </Text>
            </View>
            <Text style={[styles.itemValor, { color: leitura ? cor : tema.texto2 }]}>
              {!leitura
                ? '--'
                : fora && porUmidade
                  ? `${Math.round(leitura.umidade)}%`
                  : `${numero(leitura.temperatura)}°`}
            </Text>
          </View>
        );
      })}
    </Vidro>
  );
}

const numeros = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  conformidadeGeral: { gap: 2 },
  rotulo: { fontSize: 13 },
  pequeno: { fontSize: 12, ...numeros },
  destaque: { flex: 1, padding: 26 },
  iconeDestaque: { position: 'absolute', right: 24, top: 24 },
  frase: { flexShrink: 1, fontSize: 22, fontWeight: '500', letterSpacing: -0.3 },
  tempGrande: {
    fontSize: 104,
    fontWeight: '200',
    letterSpacing: -5,
    lineHeight: 110,
    marginTop: 8,
    ...numeros,
  },
  unidadeGrande: { fontSize: 28, fontWeight: '300', letterSpacing: 0 },
  nomeGrande: { fontSize: 22, fontWeight: '500' },
  detalhe: { fontSize: 14, marginTop: 6, lineHeight: 21, ...numeros },
  reguaGrande: { marginTop: 20 },
  limites: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  resumo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  resumoEstreito: { flexDirection: 'column', alignItems: 'stretch', gap: 16, padding: 20 },
  resumoFrase: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minWidth: 0 },
  contadoresEstreito: { justifyContent: 'space-between' },
  contadorEstreito: { flex: 1, paddingHorizontal: 12 },
  folgasPainel: { padding: 20 },
  contadores: { flexDirection: 'row' },
  contador: { paddingHorizontal: 22, gap: 2 },
  contadorValor: { fontSize: 32, fontWeight: '300', letterSpacing: -1, lineHeight: 36, ...numeros },
  folgas: { marginTop: 10 },
  folgaLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 30 },
  folgaNome: { flex: 1, minWidth: 0, fontSize: 13 },
  folgaTrilho: { width: 84, height: 6, borderRadius: 3 },
  limite: { position: 'absolute', top: -6, bottom: -6, width: 1, opacity: 0.6 },
  folgaBarra: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3 },
  folgaValor: { width: 40, textAlign: 'right', fontSize: 13, fontWeight: '600', ...numeros },
  card: { flex: 1, flexBasis: 0, minWidth: 220, minHeight: 230, padding: 20 },
  figura: { position: 'absolute', right: -14, top: 40, opacity: 0.1 },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  editar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editarDestaque: { position: 'absolute', right: 92, top: 36 },
  cardNome: { flex: 1, fontSize: 14 },
  espaco: { flex: 1, minHeight: 40 },
  tempCard: { fontSize: 54, fontWeight: '200', letterSpacing: -2.5, ...numeros },
  unidadeCard: { fontSize: 18, fontWeight: '300', letterSpacing: 0 },
  linhaSituacao: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reguaCard: { marginTop: 12 },
  faixaCard: { marginTop: 8 },
  conformidade: { marginTop: 4 },
  lista: { padding: 20, gap: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  itemTexto: { flex: 1 },
  itemNome: { fontSize: 14 },
  itemValor: { fontSize: 20, fontWeight: '300', ...numeros },
});
