// Probe real MCP streamable-HTTP endpoints: initialize + tools/list.
// Evidence standard: only an endpoint that answers a JSON-RPC initialize is "installable".
const targets = [
  ['exa', 'https://mcp.exa.ai/mcp', {}],
  ['tavily', 'https://mcp.tavily.com/mcp/', {}],
  ['firecrawl', 'https://mcp.firecrawl.dev/v2/mcp', {}],
  ['context7', 'https://mcp.context7.com/mcp', {}],
  ['deepwiki', 'https://mcp.deepwiki.com/mcp', {}],
  ['sentry', 'https://mcp.sentry.dev/mcp', {}],
  ['github', 'https://api.githubcopilot.com/mcp/', {}],
  ['linear', 'https://mcp.linear.app/mcp', {}],
  ['notion', 'https://mcp.notion.com/mcp', {}],
  ['stripe', 'https://mcp.stripe.com', {}],
  ['supabase', 'https://mcp.supabase.com/mcp', {}],
  ['neon', 'https://mcp.neon.tech/mcp', {}],
  ['atlassian', 'https://mcp.atlassian.com/v1/sse', {}],
  ['atlassian-mcp', 'https://mcp.atlassian.com/v1/mcp', {}],
  ['vercel', 'https://mcp.vercel.com', {}],
  ['huggingface', 'https://huggingface.co/mcp', {}],
  ['microsoft-learn', 'https://learn.microsoft.com/api/mcp', {}],
  ['gitlab', 'https://gitlab.com/api/v4/mcp', {}],
  ['cloudflare-docs', 'https://docs.mcp.cloudflare.com/mcp', {}],
  ['cloudflare-observability', 'https://observability.mcp.cloudflare.com/mcp', {}],
  ['cloudflare-bindings', 'https://bindings.mcp.cloudflare.com/mcp', {}],
  ['cloudflare-radar', 'https://radar.mcp.cloudflare.com/mcp', {}],
  ['cloudflare-browser', 'https://browser.mcp.cloudflare.com/mcp', {}],
  ['airtable', 'https://mcp.airtable.com/mcp', {}],
  ['discord', 'https://mcp.discord.com/mcp', {}],
  ['slack', 'https://mcp.slack.com/mcp', {}],
  ['netlify', 'https://netlify-mcp.netlify.app/mcp', {}],
  ['paypal', 'https://mcp.paypal.com/mcp', {}],
  ['deepwiki-sse', 'https://mcp.deepwiki.com/sse', {}],
];

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dsh-market-probe', version: '1.0.0' },
  },
};

async function probe([id, url]) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify(INIT),
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let serverName = null, proto = null, bodyKind = 'raw';
    // Parse either plain JSON or SSE-framed JSON.
    const chunks = text.split(/\r?\n/).filter(Boolean);
    for (const line of chunks) {
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (!payload.startsWith('{')) continue;
      try {
        const j = JSON.parse(payload);
        if (j.result && j.result.serverInfo) {
          serverName = j.result.serverInfo.name + '@' + j.result.serverInfo.version;
          proto = j.result.protocolVersion;
          bodyKind = line.startsWith('data:') ? 'sse' : 'json';
        }
      } catch { /* ignore */ }
    }
    clearTimeout(t);
    return {
      id, url, status: res.status, contentType: ct.split(';')[0],
      ms: Date.now() - started,
      ok: Boolean(serverName),
      serverName, proto, bodyKind,
      wwwAuth: res.headers.get('www-authenticate'),
      snippet: text.slice(0, 220).replace(/\s+/g, ' '),
    };
  } catch (e) {
    clearTimeout(t);
    return { id, url, status: 0, error: String(e.message || e), ok: false, ms: Date.now() - started };
  }
}

const results = [];
for (const tg of targets) {
  const r = await probe(tg);
  results.push(r);
  const verdict = r.ok ? `HANDSHAKE OK  ${r.serverName} proto=${r.proto} [${r.bodyKind}]` : `no  status=${r.status} ${r.error || r.contentType} auth=${r.wwwAuth || '-'}`;
  console.log(`${r.id.padEnd(26)} ${verdict}`);
}
require('fs').writeFileSync(__dirname + '/http-probe.json', JSON.stringify(results, null, 2));
console.log('\nWROTE http-probe.json');
