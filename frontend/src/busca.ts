/**
 * Numera as buscas: cada chamada devolve `valeAinda`, que só é verdadeiro enquanto
 * nenhuma busca mais nova tiver começado. Assim uma resposta atrasada é descartada.
 */
export function ordemDasBuscas() {
  let ultima = 0;
  return () => {
    const id = ++ultima;
    return () => id === ultima;
  };
}

/**
 * Roda a tarefa a cada `ms`, contando a espera só depois que a anterior termina, para
 * duas nunca rodarem juntas. Devolve a função que para a repetição.
 */
export function repetir(tarefa: () => Promise<unknown>, ms: number) {
  let ativo = true;
  let espera: ReturnType<typeof setTimeout>;
  const agendar = () => {
    espera = setTimeout(
      () =>
        tarefa()
          .catch(() => {})
          .then(() => ativo && agendar()),
      ms,
    );
  };
  agendar();
  return () => {
    ativo = false;
    clearTimeout(espera);
  };
}
