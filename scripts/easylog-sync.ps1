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

function Normalize-Text([string]$Value) {
  if (!$Value) { return "" }
  $decoded = [System.Net.WebUtility]::HtmlDecode(($Value -replace '<[^>]+>', ' '))
  $formD = $decoded.Normalize([Text.NormalizationForm]::FormD)
  $builder = New-Object Text.StringBuilder
  foreach ($char in $formD.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($char) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($char)
    }
  }
  return (($builder.ToString().Normalize([Text.NormalizationForm]::FormC)) -replace '\s+', ' ').Trim()
}

function Get-ProductGroup([string]$ItemCode, $Groups) {
  $digits = $ItemCode -replace '\D', ''
  if ($Groups.PSObject.Properties.Name -contains $digits) { return [string]$Groups.$digits }
  if ($digits.Length -gt 2) {
    $baseCode = $digits.Substring(0, $digits.Length - 2)
    if ($Groups.PSObject.Properties.Name -contains $baseCode) { return [string]$Groups.$baseCode }
  }
  return ""
}

function Classify-EasyLogOrder([string]$OrderNumber, $Session, $Config, $Groups) {
  $response = Invoke-RestMethod -Method Post -Uri "$($Config.easylogUrl)/admin/easylog/modal/mapadecarga_buscapedido.php" `
    -WebSession $Session -TimeoutSec 30 -Body @{ pedido = $OrderNumber }
  if ($response.status -ne 1 -or !$response.html) { throw "Pedido $OrderNumber nao retornado pelo Mapa de Carga." }

  $dry = 0; $frozen = 0; $unknown = 0
  foreach ($row in [regex]::Matches([string]$response.html, '<tr[^>]*>(.*?)</tr>', 'Singleline')) {
    $cells = [regex]::Matches($row.Groups[1].Value, '<td[^>]*>(.*?)</td>', 'Singleline')
    if ($cells.Count -lt 7) { continue }
    $itemCode = Normalize-Text $cells[1].Groups[1].Value
    $status = (Normalize-Text $cells[6].Groups[1].Value).ToUpperInvariant()
    if (!$itemCode -or $status -notmatch '^NAO LIDO$') { continue }
    $group = (Get-ProductGroup $itemCode $Groups).Trim().ToUpperInvariant()
    if ($group.StartsWith('PASTA1')) { $dry++ }
    elseif ($group.StartsWith('PASTA2')) { $frozen++ }
    else { $unknown++ }
  }
  $unread = $dry + $frozen + $unknown
  $classification = if ($unread -gt 0 -and $dry -eq 0 -and $unknown -eq 0 -and $frozen -eq $unread) { 'frozen' }
    elseif ($dry -gt 0) { 'dry' } else { 'unknown' }
  return [ordered]@{
    orderNumber = $OrderNumber; classification = $classification; unreadCount = $unread
    dryUnreadCount = $dry; frozenUnreadCount = $frozen; unknownUnreadCount = $unknown
  }
}

try {
  if (!(Test-Path -LiteralPath $ConfigPath)) { throw "Configuracao nao encontrada: $ConfigPath" }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $easylogPassword = Unprotect $config.easylogPassword
  $syncKey = Unprotect $config.syncKey
  $groupsPath = if ($config.productGroupsPath) { [string]$config.productGroupsPath } else { Join-Path $syncDir "product-groups.json" }
  if (!(Test-Path -LiteralPath $groupsPath)) { throw "Mapa de grupos de produtos nao encontrado: $groupsPath" }
  $productGroups = Get-Content -LiteralPath $groupsPath -Raw | ConvertFrom-Json
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

  $workDate = Get-Date -Format 'yyyy-MM-dd'
  $headers = @{ 'X-EasyLog-Sync-Key' = $syncKey }
  $candidates = Invoke-RestMethod -Uri "$($config.wmsUrl)/api/imports/easylog/candidates?date=$workDate" -Headers $headers -TimeoutSec 60
  $classifications = New-Object System.Collections.Generic.List[object]
  $failures = 0
  foreach ($orderNumber in $candidates.orderNumbers) {
    try { $classifications.Add((Classify-EasyLogOrder ([string]$orderNumber) $session $config $productGroups)) }
    catch {
      $failures++
      $classifications.Add([ordered]@{
        orderNumber = [string]$orderNumber; classification = 'unknown'; unreadCount = 0
        dryUnreadCount = 0; frozenUnreadCount = 0; unknownUnreadCount = 0
      })
      Write-SyncLog "Aviso ao consultar pedido $orderNumber`: $($_.Exception.Message)"
    }
  }
  if ($classifications.Count -gt 0) {
    $body = @{ workDate = $workDate; items = @($classifications) } | ConvertTo-Json -Depth 5 -Compress
    $classificationResult = Invoke-RestMethod -Method Post -Uri "$($config.wmsUrl)/api/imports/easylog/classifications" `
      -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
    Write-SyncLog "Itens conferidos: $($classificationResult.processed) pedidos; CG automatico: $($classificationResult.frozen); falhas: $failures."
  }
} catch {
  Write-SyncLog "ERRO: $($_.Exception.Message)"
  exit 1
} finally {
  if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
    Remove-Item -LiteralPath $tempFile -Force
  }
}
