import type { Canal } from './api';

// Regras da tela de canais do perfil (#118): sem React, para testar no Node.
//
// O PUT /auth/me/canais troca a lista inteira. A tela só edita um e-mail e um Telegram;
// o que ela não edita (push, canais a mais) fica em `outros` e volta no PUT como veio,
// senão salvar apagaria canais que a pessoa nem viu.

type Parte = { ligado: boolean; destino: string; salvo: string | null };

export type Rascunho = {
  /** `destino` é o texto do campo; `salvo`, o que o servidor tem (null se nunca salvou). */
  email: Parte;
  /** O chat vem do vínculo (link com código): `destino` é o chat_id, nunca digitado. */
  telegram: { ligado: boolean; chat: string | null };
  outros: Canal[];
};

const normalizar = (email: string) => email.trim().toLowerCase();

/** Monta o rascunho da lista do servidor. Sem e-mail salvo, sugere o da conta (desligado). */
export function rascunhoDosCanais(canais: Canal[], emailDaConta = ''): Rascunho {
  const email = canais.find((c) => c.tipo === 'email');
  const telegram = canais.find((c) => c.tipo === 'telegram');
  return {
    email: email
      ? { ligado: email.ativo, destino: email.destino as string, salvo: email.destino as string }
      : { ligado: false, destino: emailDaConta, salvo: null },
    telegram: telegram
      ? { ligado: telegram.ativo, chat: telegram.destino as string }
      : { ligado: false, chat: null },
    outros: canais.filter((c) => c !== email && c !== telegram),
  };
}

/** Mesma ideia do backend (EmailStr): algo@dominio.tld, sem espaços. */
export function erroDoEmail(texto: string) {
  const email = texto.trim();
  if (email === '') return 'Informe o e-mail que vai receber os alertas.';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Informe um e-mail válido, como nome@empresa.com.';
  }
  return null;
}

/** Só o e-mail ligado é validado: desligado, vale o endereço que já estava salvo. */
export function errosDoRascunho(r: Rascunho) {
  return { email: r.email.ligado ? erroDoEmail(r.email.destino) : null };
}

/** O corpo do PUT. E-mail nunca configurado e desligado fica de fora. */
export function corpoDosCanais(r: Rascunho): Canal[] {
  const lista: Canal[] = [];
  if (r.email.ligado) {
    lista.push({ tipo: 'email', destino: normalizar(r.email.destino), ativo: true });
  } else if (r.email.salvo !== null) {
    // Desligar não apaga o destino: o texto digitado com o canal desligado não vale.
    lista.push({ tipo: 'email', destino: r.email.salvo, ativo: false });
  }
  if (r.telegram.chat !== null) {
    lista.push({ tipo: 'telegram', destino: r.telegram.chat, ativo: r.telegram.ligado });
  }
  return [...lista, ...r.outros];
}

/** Tem alteração em relação ao último salvo? */
export const mudou = (r: Rascunho, salvo: Rascunho) =>
  JSON.stringify(corpoDosCanais(r)) !== JSON.stringify(corpoDosCanais(salvo));

/**
 * Traz do servidor o que a tela não digita: o Telegram (o bot cria o canal sozinho quando
 * a pessoa toca em Iniciar) e os outros canais. Mantém o e-mail e o que a pessoa mexeu.
 */
export function mesclarDoServidor(r: Rascunho, servidor: Canal[]): Rascunho {
  const doServidor = rascunhoDosCanais(servidor);
  const mesmoChat = r.telegram.chat === doServidor.telegram.chat;
  return {
    ...r,
    telegram: {
      chat: doServidor.telegram.chat,
      ligado: mesmoChat ? r.telegram.ligado : doServidor.telegram.ligado,
    },
    outros: doServidor.outros,
  };
}

/**
 * Onde mostrar o 422 do PUT. O FastAPI manda `loc: ['body', <posição na lista>, ...]`; a
 * posição volta ao tipo do canal pelo corpo que foi enviado.
 */
export function erroDoServidor(corpoDoErro: unknown, enviado: Canal[]) {
  const detalhe = (corpoDoErro as { detail?: unknown } | null)?.detail;
  const primeiro = Array.isArray(detalhe) ? detalhe[0] : null;
  const posicao: unknown = primeiro?.loc?.[1];
  const canal = typeof posicao === 'number' ? enviado[posicao] : undefined;
  const mensagem: string | undefined =
    typeof primeiro?.msg === 'string' ? primeiro.msg.replace(/^Value error, /, '') : undefined;
  if (canal?.tipo === 'email') {
    return { email: 'O servidor não aceitou este e-mail. Confira o endereço.' };
  }
  return { geral: mensagem };
}

/** Quanto falta para o link do Telegram vencer, como "9:41"; null quando já venceu. */
export function tempoRestante(expiraEm: string, agora = Date.now()) {
  const segundos = Math.ceil((new Date(expiraEm).getTime() - agora) / 1000);
  if (segundos <= 0) return null;
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}
