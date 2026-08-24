# Deploy da API para o Azure — rodar da RAIZ do repo.
#
# Criado em 2026-07-26, quando a assinatura Azure estava desabilitada e o deploy
# ficou pendente: com isto, assim que a assinatura voltar, publicar é UM comando.
#
#   powershell -File apps/api/scripts/deploy-prod.ps1
#
# Faz: build da imagem no ACR -> restart do Web App -> espera o /health -> smoke
# test de um endpoint autenticado (deve responder 401, provando que a rota nova
# existe; 404 significaria imagem velha no ar).

$ErrorActionPreference = "Stop"
$az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$app = "wityu-api-96164"
$rg = "mvp-sf"
$acr = "wityuacr96164"
$base = "https://$app.azurewebsites.net"

Write-Host "==> Build da imagem no ACR (--no-logs: sem ele o az crasha no console cp1252 e mascara o exit code)"
& $az acr build --no-logs -r $acr -t wityu-api:latest -f apps/api/Dockerfile .
if (-not $?) { throw "ACR build falhou — imagem NAO publicada." }

Write-Host "==> Restart do Web App (re-puxa :latest)"
& $az webapp restart -n $app -g $rg
if (-not $?) { throw "Restart falhou." }

Write-Host "==> Aguardando /health responder 200 (swap leva ~45-60s)"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 10 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}
if (-not $ok) { throw "A API nao voltou a responder 200 em /health." }
Write-Host "health: 200 OK"

Write-Host "==> Smoke test das rotas novas (401 = existe e exige auth; 404 = imagem velha)"
$zero = "00000000-0000-0000-0000-000000000000"
try {
  Invoke-WebRequest -Uri "$base/api/v1/parental/children/$zero/requests" -TimeoutSec 10 -UseBasicParsing | Out-Null
  Write-Warning "Esperava 401 e veio 2xx — verificar."
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) { Write-Host "requests: 401 (rota nova no ar) OK" }
  elseif ($code -eq 404) { throw "requests: 404 — a imagem no ar NAO tem as rotas novas." }
  else { Write-Warning "requests: $code (inesperado)" }
}

Write-Host ""
Write-Host "Deploy concluido. Proximo passo sugerido: e2e contra producao"
Write-Host "  cd apps/api; node --env-file=.env scripts/e2e-kids.mjs   # E2E_BASE=$base"
Write-Host "  node --env-file=.env scripts/cleanup-e2e-users.mjs        # limpar contas @test.local"
