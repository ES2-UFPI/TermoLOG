import type { Icon } from 'phosphor-react-native';
import { BatteryChargingIcon } from 'phosphor-react-native/src/icons/BatteryCharging';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { DropIcon } from 'phosphor-react-native/src/icons/Drop';
import { FlaskIcon } from 'phosphor-react-native/src/icons/Flask';
import { HardDrivesIcon } from 'phosphor-react-native/src/icons/HardDrives';
import { SnowflakeIcon } from 'phosphor-react-native/src/icons/Snowflake';
import { ThermometerColdIcon } from 'phosphor-react-native/src/icons/ThermometerCold';
import { ThermometerHotIcon } from 'phosphor-react-native/src/icons/ThermometerHot';
import { ThermometerSimpleIcon } from 'phosphor-react-native/src/icons/ThermometerSimple';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { StyleSheet, Text, View } from 'react-native';
import type { StatusDaSala } from '../api';
import {
  type Figura,
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
  textoDaFolga,
} from '../painel';
import type { Tema } from '../tema';
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

/** Bloco grande: a sala fora da faixa ou, sem nenhuma, a confirmação de que tudo está ok. */
export function Destaque({
  sala,
  tema,
  haSemLeitura,
}: {
  sala: StatusDaSala | null;
  tema: Tema;
  haSemLeitura: boolean;
}) {
  const leitura = sala && leituraPrincipal(sala);
  if (!sala || !leitura) {
    return (
      <Vidro tema={tema} ordem={0} style={styles.destaque}>
        <Text style={[styles.rotulo, { color: tema.texto2 }]}>Situação agora</Text>
        <CheckCircleIcon size={56} weight="light" color={tema.folga} style={styles.iconeDestaque} />
        <Text style={[styles.frase, { color: tema.texto }]}>
          {haSemLeitura ? 'Nenhuma sala fora da faixa' : 'Todas as salas dentro da faixa'}
        </Text>
      </Vidro>
    );
  }
  const f = folga(leitura, sala.faixa);
  const texto = f && textoDaFolga(f);
  const porUmidade = f?.grandeza === 'umidade';
  const IconeDoAlerta = ICONES[figura(sala)];
  return (
    <Vidro tema={tema} ordem={0} style={styles.destaque}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Fora da faixa agora</Text>
      <IconeDoAlerta size={56} weight="fill" color={tema.alerta} style={styles.iconeDestaque} />
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
    </Vidro>
  );
}

/** Contadores e a folga de temperatura de cada sala até o limite (barra parte do limite). */
export function VisaoGeral({ salas, tema }: { salas: StatusDaSala[]; tema: Tema }) {
  const { fora, dentro, semLeitura } = resumo(salas);
  const pontos = folgasDeTemperatura(salas);
  const lo = Math.min(-2, ...pontos.map((p) => p.folga));
  const hi = Math.max(6, ...pontos.map((p) => p.folga));
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;

  return (
    <Vidro tema={tema} ordem={1} style={styles.visao}>
      <Text style={[styles.rotulo, { color: tema.texto2 }]}>Visão geral</Text>
      <View style={styles.contadores}>
        {[
          { valor: fora, texto: 'fora da faixa', cor: fora > 0 ? tema.alerta : tema.texto },
          { valor: dentro, texto: 'dentro', cor: tema.texto },
          { valor: semLeitura, texto: 'sem leitura', cor: tema.texto },
        ].map((c) => (
          <View key={c.texto} style={[styles.contador, { backgroundColor: tema.vidroForte }]}>
            <Text style={[styles.contadorValor, { color: c.cor }]}>{c.valor}</Text>
            <Text style={[styles.pequeno, { color: tema.texto2 }]}>{c.texto}</Text>
          </View>
        ))}
      </View>
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
export function CardSala({ sala, tema, ordem }: { sala: StatusDaSala; tema: Tema; ordem: number }) {
  const leitura = leituraPrincipal(sala);
  const f = leitura && folga(leitura, sala.faixa);
  const fora = sala.status === 'fora_da_faixa';
  // Contrato: a sala sai da faixa pela temperatura ou pela umidade; destaca a que estourou.
  const porUmidade = fora && f?.grandeza === 'umidade';
  const tempAlerta = fora && !porUmidade;
  const Figura = ICONES[figura(sala)];
  const texto = f && textoDaFolga(f);

  return (
    <Vidro tema={tema} ordem={ordem} style={[styles.card, fora && { borderColor: tema.alerta }]}>
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
      <Text style={[styles.pequeno, { color: fora ? tema.alerta : tema.texto2 }]}>
        {!leitura
          ? 'Nenhum sensor ativo enviou dados'
          : texto
            ? `${texto.valor} ${texto.legenda}`
            : 'Defina a faixa da sala para acompanhar desvios'}
      </Text>
      <View style={styles.reguaCard}>
        <Regua sala={sala} tema={tema} />
      </View>
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
  rotulo: { fontSize: 13 },
  pequeno: { fontSize: 12, ...numeros },
  destaque: { flex: 1.15, minWidth: 320, padding: 26 },
  iconeDestaque: { position: 'absolute', right: 24, top: 24 },
  frase: { fontSize: 26, fontWeight: '500', marginTop: 70, letterSpacing: -0.4 },
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
  visao: { flex: 1, minWidth: 320, padding: 24 },
  contadores: { flexDirection: 'row', gap: 10, marginTop: 12 },
  contador: { flex: 1, borderRadius: 18, padding: 16 },
  contadorValor: { fontSize: 38, fontWeight: '300', letterSpacing: -1, ...numeros },
  folgas: { marginTop: 14 },
  folgaLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 30 },
  folgaNome: { width: 140, fontSize: 13 },
  folgaTrilho: { flex: 1, height: 6, borderRadius: 3 },
  limite: { position: 'absolute', top: -6, bottom: -6, width: 1, opacity: 0.6 },
  folgaBarra: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3 },
  folgaValor: { width: 40, textAlign: 'right', fontSize: 13, fontWeight: '600', ...numeros },
  card: { flex: 1, flexBasis: 0, minWidth: 220, minHeight: 230, padding: 20 },
  figura: { position: 'absolute', right: -14, top: 40, opacity: 0.1 },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardNome: { flexShrink: 1, fontSize: 14 },
  espaco: { flex: 1, minHeight: 40 },
  tempCard: { fontSize: 54, fontWeight: '200', letterSpacing: -2.5, ...numeros },
  unidadeCard: { fontSize: 18, fontWeight: '300', letterSpacing: 0 },
  reguaCard: { marginTop: 12 },
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
