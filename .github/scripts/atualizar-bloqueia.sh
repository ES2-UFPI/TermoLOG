#!/usr/bin/env bash
# Preenche o campo numérico "Bloqueia #" do projeto com o número de issues
# abertas que cada issue bloqueia (dependências "blocking" do GitHub).
# Só grava quando o valor muda.
#
# Uso: GH_TOKEN=<token com escopo project> .github/scripts/atualizar-bloqueia.sh
# Com DRY_RUN=1, só mostra o que mudaria, sem gravar.
set -euo pipefail

ORG="${ORG:-ES2-UFPI}"
PROJETO="${PROJETO:-118}"
CAMPO="${CAMPO:-Bloqueia #}"

info=$(gh api graphql -f query='
  query($org:String!,$n:Int!){
    organization(login:$org){
      projectV2(number:$n){
        id
        fields(first:100){ nodes{ ... on ProjectV2Field{ id name } } }
      }
    }
  }' -f org="$ORG" -F n="$PROJETO")

projeto_id=$(jq -r '.data.organization.projectV2.id' <<<"$info")
campo_id=$(jq -r --arg c "$CAMPO" '.data.organization.projectV2.fields.nodes[] | select(.name == $c) | .id' <<<"$info")
if [ -z "$campo_id" ]; then
  echo "Campo \"$CAMPO\" não encontrado no projeto $PROJETO" >&2
  exit 1
fi

cursor=""
alterados=0
while :; do
  pagina=$(gh api graphql -f query='
    query($id:ID!,$campo:String!,$cursor:String){
      node(id:$id){
        ... on ProjectV2{
          items(first:100, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{
              id
              valor: fieldValueByName(name:$campo){ ... on ProjectV2ItemFieldNumberValue{ number } }
              content{ ... on Issue{ number issueDependenciesSummary{ blocking } } }
            }
          }
        }
      }
    }' -f id="$projeto_id" -f campo="$CAMPO" ${cursor:+-f cursor="$cursor"})

  while IFS=$'\t' read -r item numero atual novo; do
    [ "$atual" = "$novo" ] && continue
    [ "${DRY_RUN:-}" = "1" ] || gh api graphql -f query='
      mutation($p:ID!,$i:ID!,$f:ID!,$v:Float!){
        updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{number:$v}}){ clientMutationId }
      }' -f p="$projeto_id" -f i="$item" -f f="$campo_id" -F v="$novo" >/dev/null
    echo "#$numero: $atual -> $novo"
    alterados=$((alterados + 1))
  done < <(jq -r '.data.node.items.nodes[]
    | select(.content.issueDependenciesSummary != null)
    | [.id, .content.number, ((.valor.number // "-") | tostring), (.content.issueDependenciesSummary.blocking | tostring)]
    | @tsv' <<<"$pagina")

  [ "$(jq -r '.data.node.items.pageInfo.hasNextPage' <<<"$pagina")" = "true" ] || break
  cursor=$(jq -r '.data.node.items.pageInfo.endCursor' <<<"$pagina")
done

echo "$alterados item(ns) atualizado(s)"
