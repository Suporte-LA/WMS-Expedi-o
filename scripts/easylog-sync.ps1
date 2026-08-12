param(
  [string]$ConfigPath = "$env:LOCALAPPDATA\WMS-Expedicao\easylog-sync.json"
)

$ErrorActionPreference = "Stop"
$syncDir = Split-Path -Parent $ConfigPath
$logPath = Join-Path $syncDir "easylog-sync.log"

function Write-SyncLog([string]$Message) {
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1MB) {
    Get-Content -LiteralPath $logPath -Tail 500 | Set-Content -LiteralPath $logPath -Encoding UTF8
  }
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Unprotect([string]$Value) {
  $secure = ConvertTo-SecureString $Value
  return [System.Net.NetworkCredential]::new("", $secure).Password
}

try {
  if (!(Test-Path -LiteralPath $ConfigPath)) { throw "Configuracao nao encontrada: $ConfigPath" }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $easylogPassword = Unprotect $config.easylogPassword
  $syncKey = Unprotect $config.syncKey
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $page = Invoke-WebRequest -UseBasicParsing -Uri "$($config.easylogUrl)/" -WebSession $session -TimeoutSec 30

  function Get-Token([string]$Id) {
    $match = [regex]::Match($page.Content, 'id="' + [regex]::Escape($Id) + '"[^>]*value="([^"]*)"')
    if (!$match.Success) { return "" }
    return $match.Groups[1].Value
  }

  $login = Invoke-RestMethod -Method Post -Uri "$($config.easylogUrl)/ajax/acesso.php" -WebSession $session -TimeoutSec 30 -Body @{
    f = Get-Token "f"; c = $config.companyCode; e = $config.easylogEmail; p = $easylogPassword
    m = Get-Token "m"; t = Get-Token "t"; s = Get-Token "s"
  }
  if ($login.status -ne 1) { throw "Login EasyLog recusado." }

  $download = Invoke-WebRequest -UseBasicParsing -Uri "$($config.easylogUrl)/admin/easylog/ajax/export_file_out.php" -WebSession $session -TimeoutSec 180
  if ($download.RawContentLength -lt 1000) { throw "Arquivo EasyLog vazio ou invalido." }
  $tempFile = Join-Path $syncDir "ExportFileOut.xls"
  [IO.File]::WriteAllBytes($tempFile, $download.Content)

  $response = & curl.exe -sS --fail-with-body -X POST -H "X-EasyLog-Sync-Key: $syncKey" -F "file=@$tempFile;filename=ExportFileOut-Automatico.xls" "$($config.wmsUrl)/api/imports/base"
  $result = $response | ConvertFrom-Json
  if ($result.unchanged) { Write-SyncLog "Sem alteracoes na base." }
  else { Write-SyncLog "Base importada: $($result.summary.processedRows) pedidos; $($result.summary.consolidatedDescents) descidas consolidadas." }
} catch {
  Write-SyncLog "ERRO: $($_.Exception.Message)"
  exit 1
} finally {
  if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
    Remove-Item -LiteralPath $tempFile -Force
  }
}
