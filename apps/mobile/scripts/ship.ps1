# Ciclo completo de entrega do APK de QA: build -> Blob -> Firebase App Distribution.
#
#   powershell -File apps/mobile/scripts/ship.ps1
#   powershell -File apps/mobile/scripts/ship.ps1 -Notas "o que mudou" -Testers "a@x.com,b@y.com"
#
# ASCII PURO (PowerShell 5.1 le .ps1 como ANSI sem BOM; um travessao quebra o parser).
#
# Publica nos DOIS canais de proposito. Ter so um atualizado faz testadores
# rodarem versoes diferentes e reportarem bugs ja corrigidos.
param(
  [string]$Notas = "",
  [string]$Testers = "",
  [switch]$PularBuild
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$apk  = Join-Path $repo "apps\mobile\android\app\build\outputs\apk\release\app-release.apk"
$sa   = "$env:USERPROFILE\.wardyou\wardyou-fcm.json"

$jdk = (Get-ChildItem "C:\Program Files\Microsoft\jdk-17*" -Directory | Select-Object -First 1).FullName
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = "C:\Android"
$env:ANDROID_SDK_ROOT = "C:\Android"
$env:PATH = "$jdk\bin;C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:PATH
$env:REQUESTS_CA_BUNDLE = "$env:USERPROFILE\.azure\cacert-corp.pem"
# Mantidos por seguranca: se o SSL scanning do Norton for religado, o Gradle
# volta a falhar sem eles. Ver CLAUDE.md.
$tls = "-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djdk.tls.client.protocols=TLSv1.2"
$env:JAVA_OPTS = $tls
$env:GRADLE_OPTS = $tls

if (-not $PularBuild) {
  Write-Host "==> 1/3 Build do APK"
  Push-Location (Join-Path $repo "apps\mobile\android")
  if (Test-Path "app\.cxx") { Remove-Item -Recurse -Force "app\.cxx" }
  # NAO usar `2>&1` aqui. No PowerShell 5.1 isso envolve cada linha de stderr
  # do executavel nativo num ErrorRecord; com ErrorActionPreference = Stop o
  # script aborta num simples AVISO. Pego em 2026-09-11: o Expo so avisou sobre
  # NODE_ENV e o build inteiro foi cancelado. O sucesso e conferido pelo APK no
  # disco logo abaixo, que e mais confiavel que exit code de qualquer jeito.
  $ErrorActionPreference = "Continue"
  & .\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2 `
    "-Djavax.net.ssl.trustStoreType=Windows-ROOT" "-Djdk.tls.client.protocols=TLSv1.2" |
    Select-String "BUILD SUCCESSFUL|BUILD FAILED|error:" | Select-Object -Last 5
  $ErrorActionPreference = "Stop"
  Pop-Location
  if (-not (Test-Path $apk)) { throw "APK nao foi gerado." }
  Write-Host "    OK ($([math]::Round((Get-Item $apk).Length/1MB,2)) MB)"
}

Write-Host "==> 2/3 Publicando no Blob (link estavel do WhatsApp)"
$key = az storage account keys list -g wardyou -n wardyouqaapk --query "[0].value" -o tsv
az storage blob upload --account-name wardyouqaapk --account-key $key `
  --container-name apk --name wardyou-qa.apk --file $apk --overwrite `
  --content-type "application/vnd.android.package-archive" --only-show-errors --output none
if (-not $?) { throw "Upload para o Blob falhou." }
Write-Host "    https://wardyouqaapk.blob.core.windows.net/apk/wardyou-qa.apk"

Write-Host "==> 3/3 Publicando no Firebase App Distribution"
$env:SA_PATH = $sa
$env:APK = $apk
if ($Notas)   { $env:NOTAS = $Notas }
if ($Testers) { $env:TESTERS = $Testers }
Push-Location (Join-Path $repo "apps\api")
node scripts/distribute-apk.mjs
Pop-Location

Write-Host ""
Write-Host "Entregue nos dois canais."
