#!/usr/bin/env bash
# Prepara o login com Google (SSO) para a API de QA do WardYou.
#
# RODAR NO GOOGLE CLOUD SHELL (projeto wardyou, ja autenticado):
#   bash setup-google-oauth-qa.sh
#
# LIMITE CONHECIDO: o Google NAO expoe API publica para criar OAuth client do
# tipo "Web application" com redirect URI proprio. O `gcloud alpha iap
# oauth-clients create` so cria clients do IAP, que nao aceitam redirect custom.
# Entao este script:
#   1. habilita as APIs necessarias
#   2. tenta criar a tela de consentimento (brand) via IAP — costuma exigir
#      organizacao; em projeto pessoal falha e cai para o console
#   3. imprime os valores EXATOS para colar no console
#   4. verifica no fim o que existe

set -uo pipefail

PROJECT="${PROJECT:-wardyou}"
API_URL="${API_URL:-https://wardyou-qa-api.orangesand-7bad7871.westus3.azurecontainerapps.io}"
REDIRECT="$API_URL/api/v1/auth/external/google/complete"
EMAIL="$(gcloud config get-value account 2>/dev/null)"

gcloud config set project "$PROJECT" >/dev/null 2>&1

echo "==> 1. Habilitando APIs"
gcloud services enable iap.googleapis.com iamcredentials.googleapis.com --quiet 2>&1 | tail -1

echo
echo "==> 2. Tentando criar a tela de consentimento (brand) via API"
if gcloud alpha iap oauth-brands create \
     --application_title="WardYou" --support_email="$EMAIL" --quiet 2>/tmp/brand.err; then
  echo "    brand criado via API"
else
  echo "    nao deu pela API (esperado em projeto pessoal):"
  sed 's/^/      /' /tmp/brand.err | head -3
fi

echo
echo "==> 3. Brands existentes no projeto:"
gcloud alpha iap oauth-brands list --format="value(name,applicationTitle)" 2>/dev/null || echo "    (nenhum / sem permissao)"

cat <<FIM

======================================================================
AGORA NO CONSOLE (esta parte nao tem API)

PASSO A - Tela de consentimento
  https://console.cloud.google.com/auth/overview?project=$PROJECT
  (se abrir a UI antiga: https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT)

  - Tipo de usuario: Externo
  - Nome do app:     WardYou
  - E-mail de suporte e contato do desenvolvedor: $EMAIL
  - Em "Usuarios de teste", ADICIONE: $EMAIL
    (em modo Teste so os usuarios listados conseguem entrar)

PASSO B - Credencial OAuth
  https://console.cloud.google.com/apis/credentials?project=$PROJECT

  Criar credenciais -> ID do cliente OAuth -> Aplicativo da Web
  Nome: WardYou QA API

  URIs de redirecionamento autorizados (colar EXATAMENTE esta linha):

$REDIRECT

  Salve e copie o "ID do cliente" e a "Chave secreta do cliente".

======================================================================
FIM
