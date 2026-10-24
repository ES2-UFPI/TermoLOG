# Definition of Done

Uma tarefa ou história só é considerada **pronta** (e só entra como concluída na Sprint Review) quando cumpre todos os itens abaixo.

## Tarefa

- [ ] Todos os critérios de aceite da issue foram verificados.
- [ ] O código está em uma branch `nome#issue` e foi enviado por PR para a `dev`.
- [ ] O PR referencia a issue e descreve o que foi feito.
- [ ] Todo commit do PR cita a issue no título (`tipo(escopo): descrição #N`), conferido pelo CI.
- [ ] O PR foi revisado e aprovado por pelo menos uma pessoa que não é o autor.
- [ ] O CI está verde: lint (ruff e biome) e build e testes do backend e do frontend.
- [ ] O código novo tem testes quando há regra de negócio, endpoint ou mudança no banco.
- [ ] Mudanças no banco têm migration, e ela roda (`upgrade` e `downgrade`) em um banco vazio.
- [ ] O README foi atualizado se a forma de rodar, configurar ou testar o projeto mudou.
- [ ] O PR foi mergeado na `dev` e a issue foi fechada.

## História de usuário

- [ ] Todas as tarefas da história estão prontas (pela lista acima).
- [ ] Os critérios de aceite da história foram demonstrados funcionando no sistema integrado (backend, frontend e, quando for o caso, firmware ou simulador).
- [ ] A história foi apresentada e aceita na Sprint Review.

Se algum item não se aplica à tarefa, explique o motivo no PR.
