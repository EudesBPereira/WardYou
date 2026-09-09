# Deploy da API para o ambiente de QA (Azure Container Apps) — rodar da RAIZ do repo.
#
#   powershell -File apps/api/scripts/deploy-qa.ps1
#
# Faz: contexto limpo -> build da imagem no ACR -> update do Container App ->
# espera o /health -> smoke test (401 numa rota autenticada prova que a imagem
# nova subiu; 404 significaria imagem velha ou rota inexistente).
#
# POR QUE UM CONTEXTO LIMPO (e nao `az acr build ... .` da raiz):
# o empacotador do az percorre a arvore ANTES de aplicar o .dockerignore e
# estoura o MAX_PATH do Windows dentro de node_modules (visto em 2026-09-09 em
# expo-image-manipulator/prebuilds/.../SDWebImageWebPCoder.yml). Copiar so o que
# o Dockerfile precisa evita o problema e derruba o upload de 960 MB para ~1 MB.

$ErrorActionPreference = "Stop"

$az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
# A rede corporativa intercepta TLS; sem este bundle o az falha com
# CERTIFICATE_VERIFY_FAILED. Gerado por scripts/make-ca-bundle.ps1.
$env:REQUESTS_CA_BUNDLE = "$env:USERPROFILE\.azure\cacert-corp.pem"

$rg    = "wardyou"
$app   = "wardyou-qa-api"
$acr   = "cloudorinqaacr"
$img   = "wardyou-api:qa"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path

Write-Host "==> Montando contexto de build limpo"
$stage = Join-Path $env:TEMP "wardyou-acr-context"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "apps") | Out-Null
foreach ($f in @("package.json", "package-lock.json", ".npmrc", ".dockerignore")) {
  Copy-Item (Join-Path $repoRoot $f) $stage
}
$excl = @("node_modules", "dist", ".env", ".env.qa", ".env.local")
robocopy (Join-Path $repoRoot "apps\api") (Join-Path $stage "apps\api") /E /XD $excl /XF ".env*" /NFL /NDL /NJH /NJS /NP | Out-Null
Write-Host "    contexto: $([math]::Round((Get-ChildItem $stage -Recurse | Measure-Object Length -Sum).Sum / 1MB, 2)) MB"

Write-Host "==> Build da imagem no ACR (--no-logs: sem ele o az crasha no console cp1252 e mascara o exit code)"
Push-Location $stage
& $az acr build --no-logs -r $acr -t $img -f apps/api/Dockerfile . --only-show-errors
$buildOk = $?
Pop-Location
if (-not $buildOk) { throw "ACR build falhou — imagem NAO publicada." }

Write-Host "==> Atualizando o Container App"
& $az containerapp update -g $rg -n $app --image "$acr.azurecr.io/$img" --only-show-errors --output none
if (-not $?) { throw "Update do Container App falhou." }

$fqdn = & $az containerapp show -g $rg -n $app --query properties.configuration.ingress.fqdn -o tsv
$base = "https://$fqdn"
Write-Host "==> Aguardando $base/health"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 10 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}
if (-not $ok) { throw "A API nao voltou a responder 200 em /health." }
Write-Host "    health: 200 OK"

Write-Host "==> Smoke test (401 = rota existe e exige auth; 404 = imagem velha)"
try {
  Invoke-WebRequest -Uri "$base/api/v1/profile/me" -TimeoutSec 10 -UseBasicParsing | Out-Null
  Write-Warning "Esperava 401 e veio 2xx — verificar."
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) { Write-Host "    profile/me: 401 OK" }
  elseif ($code -eq 404) { throw "profile/me: 404 — a imagem no ar esta desatualizada." }
  else { Write-Warning "profile/me: $code (inesperado)" }
}

Write-Host ""
Write-Host "Deploy de QA concluido: $base"
