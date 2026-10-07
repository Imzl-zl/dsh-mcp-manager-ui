$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

$terms = @(
  'github', 'gitlab', 'sentry', 'cloudflare', 'stripe', 'linear', 'notion',
  'vercel', 'supabase', 'neon', 'atlassian', 'netlify',
  'exa', 'tavily', 'firecrawl', 'brave-search', 'google-maps', 'perplexity',
  'context7', 'deepwiki', 'chrome-devtools', 'playwright', 'puppeteer', 'browserbase',
  'postgres', 'sqlite', 'redis', 'clickhouse', 'mongodb', 'kubernetes', 'docker',
  'aws', 'snowflake', 'bigquery', 'elasticsearch',
  'slack', 'discord', 'airtable', 'gdrive', 'obsidian', 'serena', 'memory',
  'sequential', 'everything', 'huggingface', 'microsoft-learn', 'fetch', 'filesystem',
  'time', 'git', 'arxiv', 'zenodo'
)

$out = @{}
foreach ($t in $terms) {
  $uri = "https://registry.modelcontextprotocol.io/v0/servers?search=$t&limit=8"
  $ok = $false
  for ($i = 0; $i -lt 3 -and -not $ok; $i++) {
    try {
      $r = Invoke-RestMethod -Uri $uri -TimeoutSec 60
      $rows = @()
      foreach ($item in $r.servers) {
        $s = $item.server
        $rows += [pscustomobject]@{
          name    = $s.name
          title   = $s.title
          desc    = $s.description
          version = $s.version
          website = $s.websiteUrl
          repo    = $s.repository.url
          remotes = @($s.remotes | ForEach-Object { "$($_.type)|$($_.url)" })
          pkgs    = @($s.packages | ForEach-Object { "$($_.registryType)|$($_.identifier)|$($_.version)" })
        }
      }
      $out[$t] = $rows
      $ok = $true
      Write-Host "[ok] $t -> $($rows.Count)"
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  if (-not $ok) { Write-Host "[FAIL] $t"; $out[$t] = @() }
}

$out | ConvertTo-Json -Depth 8 | Set-Content -Path "$PSScriptRoot\registry-dump.json" -Encoding utf8
Write-Host "WROTE $PSScriptRoot\registry-dump.json"
