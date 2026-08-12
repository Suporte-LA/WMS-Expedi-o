param(
  [Parameter(Mandatory = $true)][string]$CompanyCode,
  [Parameter(Mandatory = $true)][string]$EasylogEmail,
  [Parameter(Mandatory = $true)][securestring]$EasylogPassword,
  [Parameter(Mandatory = $true)][securestring]$SyncKey,
  [string]$ProductGroupsPath
)

$ErrorActionPreference = "Stop"
$syncDir = Join-Path $env:LOCALAPPDATA "WMS-Expedicao"
New-Item -ItemType Directory -Path $syncDir -Force | Out-Null
$config = [ordered]@{
  easylogUrl = "http://easylog.local"
  companyCode = $CompanyCode
  easylogEmail = $EasylogEmail
  easylogPassword = ConvertFrom-SecureString $EasylogPassword
  syncKey = ConvertFrom-SecureString $SyncKey
  wmsUrl = "https://wms.bemvindoalourencoalimentos.com"
  productGroupsPath = if ($ProductGroupsPath) { $ProductGroupsPath } else { Join-Path $syncDir "product-groups.json" }
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $syncDir "easylog-sync.json") -Encoding UTF8
Write-Output "Configuracao protegida criada em $syncDir"
