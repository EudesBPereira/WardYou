#!/usr/bin/env bash
# Configura o Firebase do WardYou para o package com.wardyou.app.
#
# RODAR NO GOOGLE CLOUD SHELL (ja autenticado). Usa a API REST do Firebase com o
# token do gcloud, entao NAO precisa autenticar o firebase CLI.
#
#   bash setup-firebase-qa.sh
#
# Produz:
#   ~/google-services.json  -> vai para apps/mobile/ (NAO e segredo: vai dentro do APK)
#   ~/wardyou-fcm.json      -> chave da service account do FCM (E SEGREDO: nao colar em chat)

set -euo pipefail

PROJECT="${PROJECT:-wardyou}"
PKG="${PKG:-com.wardyou.app}"
API="https://firebase.googleapis.com/v1beta1"

echo "==> Projeto: $PROJECT / package: $PKG"
gcloud config set project "$PROJECT" >/dev/null

echo "==> Habilitando APIs (pode levar ~1 min)"
gcloud services enable \
  firebase.googleapis.com \
  fcm.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --quiet

TOKEN="$(gcloud auth print-access-token)"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "==> Habilitando Firebase no projeto (ok se ja estiver)"
curl -s -X POST "$API/projects/$PROJECT:addFirebase" "${auth[@]}" -d '{}' \
  | head -c 400; echo
sleep 20

echo "==> Criando o app Android"
curl -s -X POST "$API/projects/$PROJECT/androidApps" "${auth[@]}" \
  -d "{\"displayName\":\"WardYou Android\",\"packageName\":\"$PKG\"}" \
  | head -c 400; echo
echo "    aguardando o app ficar disponivel..."
sleep 30

echo "==> Localizando o appId"
APPID="$(curl -s "$API/projects/$PROJECT/androidApps" "${auth[@]}" \
  | python3 -c "import sys,json; a=json.load(sys.stdin).get('apps',[]); m=[x for x in a if x.get('packageName')=='$PKG']; print(m[0]['appId'] if m else '')")"

if [ -z "$APPID" ]; then
  echo "!! Nao achei o app para $PKG. Rode de novo em ~30s (criacao e assincrona)."
  exit 1
fi
echo "    appId: $APPID"

echo "==> Baixando google-services.json"
curl -s "$API/projects/$PROJECT/androidApps/$APPID/config" "${auth[@]}" \
  | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['configFileContents']).decode())" \
  > ~/google-services.json

echo "==> Criando a service account do FCM (para a API enviar push via HTTP v1)"
SA="wardyou-fcm"
SA_EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts create "$SA" --display-name "WardYou FCM sender" --quiet 2>/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/firebasemessaging.admin" \
  --condition=None --quiet >/dev/null
gcloud iam service-accounts keys create ~/wardyou-fcm.json --iam-account="$SA_EMAIL" --quiet

echo
echo "======================================================================"
echo "PRONTO."
echo
echo "1) google-services.json (NAO e segredo — vai dentro do APK):"
echo "----------------------------------------------------------------------"
cat ~/google-services.json
echo "----------------------------------------------------------------------"
echo
echo "2) ~/wardyou-fcm.json  <-- SEGREDO. NAO cole no chat."
echo "   Baixe pelo menu do Cloud Shell: (tres pontinhos) > Download > ~/wardyou-fcm.json"
echo "======================================================================"
