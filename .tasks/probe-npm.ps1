$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

$pkgs = @(
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-slack',
  '@playwright/mcp',
  'chrome-devtools-mcp',
  '@brave/brave-search-mcp-server',
  'exa-mcp-server',
  'firecrawl-mcp',
  'tavily-mcp',
  '@upstash/context7-mcp',
  '@sentry/mcp-server',
  '@notionhq/notion-mcp-server',
  '@linear/mcp-server',
  'mcp-server-git',
  'mcp-server-fetch',
  'mcp-server-time',
  '@supabase/mcp-server-supabase',
  '@neondatabase/mcp-server-neon',
  '@cloudflare/mcp-server-cloudflare',
  '@stripe/mcp',
  '@vercel/mcp-adapter',
  '@elastic/mcp-server-elasticsearch',
  'mongodb-mcp-server',
  '@clickhouse/mcp-clickhouse',
  '@modelcontextprotocol/server-redis',
  'redis-mcp-server',
  '@browserbasehq/mcp-server-browserbase',
  'docker-mcp',
  '@zencoder/slack-mcp-server',
  'mcp-server-sqlite',
  'server-memory',
  '@modelcontextprotocol/server-everything'
)

$results = @()
foreach ($p in $pkgs) {
  $enc = $p -replace '/', '%2f'
  $uri = "https://registry.npmjs.org/$enc"
  try {
    $r = Invoke-RestMethod -Uri $uri -TimeoutSec 45
    $latest = $r.'dist-tags'.latest
    $pub = $r.time.$latest
    $results += [pscustomobject]@{
      pkg        = $p
      exists     = $true
      latest     = $latest
      published  = $pub
      desc       = $r.description
      deprecated = if ($r.versions.$latest.deprecated) { $r.versions.$latest.deprecated } else { '' }
      homepage   = $r.homepage
      repo       = if ($r.repository) { $r.repository.url } else { '' }
    }
    Write-Host "[ok]   $p  v$latest  ($pub)"
  } catch {
    $code = ''
    try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
    $results += [pscustomobject]@{
      pkg = $p; exists = $false; latest = ''; published = ''; desc = "HTTP $code"; deprecated = ''; homepage = ''; repo = ''
    }
    Write-Host "[MISS] $p  (HTTP $code)"
  }
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path "$PSScriptRoot\npm-dump.json" -Encoding utf8
Write-Host "WROTE $PSScriptRoot\npm-dump.json"
