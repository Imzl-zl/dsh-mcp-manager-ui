$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

$pkgs = @(
  'mcp-server-git', 'mcp-server-fetch', 'mcp-server-time', 'mcp-server-sqlite',
  'mcp-clickhouse', 'awslabs.core-mcp-server', 'serena-agent', 'postgres-mcp',
  'mcp-server-redis', 'redis-mcp-server', 'mcp-server-kubernetes',
  'aws-mcp-server', 'mcp-server-bigquery', 'mcp-server-elasticsearch',
  'mcp-server-filesystem', 'mcp-server-memory', 'mcp-server-sequential-thinking',
  'mcp-server-everything'
)

$results = @()
foreach ($p in $pkgs) {
  $uri = "https://pypi.org/pypi/$p/json"
  try {
    $r = Invoke-RestMethod -Uri $uri -TimeoutSec 45
    $info = $r.info
    $results += [pscustomobject]@{
      pkg       = $p
      exists    = $true
      version   = $info.version
      summary   = $info.summary
      homepage  = $info.home_page
      project   = $info.project_url
      requires  = $info.requires_python
    }
    Write-Host "[ok]   $p  v$($info.version)  :: $($info.summary)"
  } catch {
    $code = ''
    try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
    $results += [pscustomobject]@{ pkg = $p; exists = $false; version = ''; summary = "HTTP $code"; homepage = ''; project = ''; requires = '' }
    Write-Host "[MISS] $p (HTTP $code)"
  }
}
$results | ConvertTo-Json -Depth 5 | Set-Content -Path "$PSScriptRoot\pypi-dump.json" -Encoding utf8
Write-Host "WROTE pypi-dump.json"
