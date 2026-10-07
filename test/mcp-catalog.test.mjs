// MCP 市场目录的数据闸门。
//
// 为什么目录值得单独一套测试：它是这批改动引入的**新真相源**，而它的错误形态全是
// 「面板看着正常、装上去失败」——jsdom 渲染得出来、测试也全绿，只有真机点安装才炸。
// 所以这里校验的是「一条目录项是否自洽」，而不是任何 UI 行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { MCP_CATALOG, catalogById } from '../lib/mcp-catalog.js'
import { MCP_CATEGORIES, MCP_CATEGORY_LABELS, BUILTIN_MCP_SERVERS, builtinMcpCatalog } from '../lib/mcp-config.js'

test('every catalog entry is structurally complete for its transport', () => {
  for (const entry of MCP_CATALOG) {
    const where = `目录项 ${entry.id}`
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/, `${where}: id 必须是小写连字符`);
    for (const field of ['label', 'summary', 'access', 'vendor']) {
      assert.equal(typeof entry[field], 'string', `${where}: ${field} 必须是字符串`);
      assert.ok(entry[field].trim().length > 0, `${where}: ${field} 不能为空`);
    }
    assert.ok(MCP_CATEGORIES.includes(entry.category), `${where}: 未知分类 ${entry.category}`);
    assert.ok(['streamable-http', 'stdio'].includes(entry.transport), `${where}: 未知传输 ${entry.transport}`);

    if (entry.transport === 'streamable-http') {
      assert.equal(typeof entry.url, 'string', `${where}: HTTP 型必须有 url`);
      assert.ok(/^https?:\/\//.test(entry.url), `${where}: url 必须是 http(s) 绝对地址`);
      // 反过来也要挡住：HTTP 型带 command 会写出一条既不是 HTTP 也不是 stdio 的配置。
      assert.equal(entry.command, undefined, `${where}: HTTP 型不能带 command`);
    } else {
      assert.equal(typeof entry.command, 'string', `${where}: stdio 型必须有 command`);
      assert.ok(Array.isArray(entry.args), `${where}: stdio 型必须有 args 数组`);
      assert.equal(entry.url, undefined, `${where}: stdio 型不能带 url`);
    }
    // homepage 是详情页唯一的排障出口，缺了用户只能自己去搜。
    assert.ok(/^https?:\/\//.test(entry.homepage || ''), `${where}: homepage 必须是 http(s) 地址`);
  }
})

test('catalog ids are unique and never change meaning', () => {
  const seen = new Map()
  for (const entry of MCP_CATALOG) {
    assert.equal(seen.has(entry.id), false, `id 重复：${entry.id}`);
    seen.set(entry.id, entry);
  }
  // id 会变成 serverName（`BUILTIN_MCP_SERVERS` 里 name = id），而 serverName 决定工具名
  // `mcp__<serverName>__<tool>`。所以 id 必须满足配置格式，否则安装时会校验失败。
  for (const entry of MCP_CATALOG) {
    assert.match(entry.id, /^[A-Za-z0-9_-]{1,32}$/, `${entry.id} 不符合 serverName 格式`);
  }
  assert.equal(catalogById().size, MCP_CATALOG.length);
})

test('every category has a label and at least one entry', () => {
  // 分类标签是 Host 通过 RPC 带给面板的（bundle 读不到这些常量），少一个就显示成英文 key。
  const used = new Set(MCP_CATALOG.map((entry) => entry.category))
  for (const category of used) {
    assert.ok(MCP_CATEGORIES.includes(category), `未知分类：${category}`);
    assert.ok(MCP_CATEGORY_LABELS[category], `分类 ${category} 缺中文标签`);
  }
  // 声明了分类却一条都没有，会让市场的 chips 出现空分组。
  for (const category of MCP_CATEGORIES) {
    assert.ok(used.has(category), `分类 ${category} 声明了但目录里没有条目`);
  }
})

test('entries that also ship a local package declare it for identity matching', () => {
  // 「已装过」的识别靠 url 的 host 或包名。纯远端服务（GitHub / Sentry / Linear 这类）只有
  // endpoint，没有本地包——那就只能靠 host 认，这是对的。
  // 但**同时提供本地包**的服务必须把包名写出来：同一服务两种装法（Firecrawl 既有
  // mcp.firecrawl.dev 也有 firecrawl-mcp），用户在本地装过一份，市场不该再提示可安装。
  // 这层知识推不出来（url 里没有包名），所以只对「确实有本地包」的条目要求显式声明。
  const withLocalPackage = ['exa', 'tavily', 'firecrawl'];
  for (const id of withLocalPackage) {
    const entry = MCP_CATALOG.find((item) => item.id === id);
    assert.ok(entry, `目录里应有 ${id}`);
    assert.ok(Array.isArray(entry.packages) && entry.packages.length > 0,
      `${id}: 同时有本地包，必须声明 packages`);
  }
  // 反过来：任何 HTTP 条目都不该凭空带一个可疑的包名——要么不写，要么写下真实存在的。
  for (const entry of MCP_CATALOG) {
    if (entry.packages === undefined) continue;
    assert.ok(Array.isArray(entry.packages) && entry.packages.length > 0, `${entry.id}: packages 若存在必须非空`);
    for (const name of entry.packages) {
      assert.match(name, /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/i, `${entry.id}: 包名 ${name} 形态可疑`);
    }
  }
  // 每个条目都得有可认领的身份：host 或包名，至少一个。两者都空就等于永远认不出「已装过」。
  for (const entry of MCP_CATALOG) {
    const hasHost = typeof entry.url === 'string' && /^https?:\/\//.test(entry.url);
    assert.ok(hasHost || (entry.packages && entry.packages.length) || (entry.args && entry.args.length),
      `${entry.id}: 既没有可用 url 也没有包名/参数，身份识别会永远失败`);
  }
})

test('builtin catalog carries every field the market UI reads', () => {
  // 面板是预构建 bundle，读不到 lib/ 的常量：这里少带一个字段，市场就显示 undefined，
  // 而那是 jsdom 测不出来、真机才看得见的。
  const catalog = builtinMcpCatalog([])
  assert.equal(catalog.length, BUILTIN_MCP_SERVERS.length)
  for (const item of catalog) {
    const where = `builtin ${item.id}`
    assert.equal(typeof item.category, 'string', `${where}: 缺 category`);
    assert.equal(typeof item.categoryLabel, 'string', `${where}: 缺 categoryLabel（面板的 chips 靠它）`);
    assert.equal(typeof item.vendor, 'string', `${where}: 缺 vendor`);
    assert.ok(/^https?:\/\//.test(item.homepage || ''), `${where}: 缺 homepage（详情页的文档链接）`);
    assert.ok(Array.isArray(item.envKeys), `${where}: 缺 envKeys（「需密钥」徽章靠它）`);
    assert.ok(Array.isArray(item.placeholders), `${where}: 缺 placeholders（含占位符的条目要提示先改）`);
  }
})

test('every entry stays recognisable after the user renames it', () => {
  // 这条来自一次真实缺陷：serena 的 `packages` 写的是 PyPI 包名 `serena-agent`，而用户配置里
  // 出现的字符串是命令名 `serena`——身份识别拿包名比对 token，于是永远匹配不上。后果是
  // 用户自己装过之后，市场仍显示「可安装」，再点一次就插进重复条目。
  //
  // 判据：把每条目录项「以别的 serverName 装好」，`builtinMcpCatalog` 必须认出它已配置。
  // 这条覆盖全部 46 条，比逐条人工核对可靠，也是「加新条目」时最容易漏掉的一环。
  const alt = (builtin) => {
    const spec = { name: 'my-' + builtin.id }
    for (const field of ['transport', 'url', 'headers', 'command', 'args']) {
      if (builtin[field] !== undefined) spec[field] = builtin[field]
    }
    return spec
  }
  const failures = []
  for (const builtin of BUILTIN_MCP_SERVERS) {
    const installed = builtinMcpCatalog([alt(builtin)]).find((item) => item.id === builtin.id)
    if (!installed?.installed) failures.push(builtin.id)
  }
  assert.deepEqual(failures, [], `这些条目换名后认不出，会重复安装：${failures.join(', ')}`)
})

test('credentials and connection settings stay in separate fields', () => {
  // envKeys 的语义是「要申请一个密钥」，市场据此显示「需密钥」；configKeys 是「要填连接信息」。
  // 两者混在一起会误导用户：Redis / ClickHouse 是本机服务，标成「需密钥」会让人以为要去
  // 注册账号。这条钉住分离，防止后来者图省事把 HOST/PORT 塞回 envKeys。
  const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|URI|URL|CONNECTION|CREDENTIAL|AUTH)/i;
  for (const entry of MCP_CATALOG) {
    for (const name of entry.envKeys || []) {
      assert.match(name, SECRET, `${entry.id}: ${name} 不像凭据，应放进 configKeys`);
    }
    for (const name of entry.configKeys || []) {
      assert.doesNotMatch(name, /(PASSWORD|PASSWD|PWD|SECRET|TOKEN)/i,
        `${entry.id}: ${name} 是凭据，应放进 envKeys`);
    }
    // 同一个变量不该同时出现在两边。
    const both = (entry.envKeys || []).filter((name) => (entry.configKeys || []).includes(name));
    assert.deepEqual(both, [], `${entry.id}: ${both.join(', ')} 同时被当成凭据和连接参数`);
  }
  // 反向下限：这两个字段确实在用（否则上面的循环空转也会通过）。
  assert.ok(MCP_CATALOG.some((entry) => (entry.envKeys || []).length), '没有条目声明凭据，疑似字段名写错');
  assert.ok(MCP_CATALOG.some((entry) => (entry.configKeys || []).length), '没有条目声明连接参数，疑似字段没接上');
})

test('entries that need user-supplied arguments are marked', () => {
  // 含 `<占位符>` 的条目装完**不能直接用**：拿 `<仓库路径>` 当真实参数去启动一定失败。
  // 这个标记必须由目录如实给出，否则市场会说「安装成功」而用户拿到一个连不上的 server。
  const marked = new Set(MCP_CATALOG.filter((entry) => (entry.placeholders || []).length).map((e) => e.id));
  for (const id of ['filesystem', 'git']) {
    assert.ok(marked.has(id), `${id} 的参数含占位符，必须标出来`);
  }
  // 被标出的占位符确实出现在它的 command/args 里（而不是凭空多出一个标记）。
  for (const entry of MCP_CATALOG) {
    for (const token of entry.placeholders || []) {
      const haystack = [entry.command, ...(entry.args || [])].filter(Boolean).join(' ');
      assert.ok(haystack.includes(token), `${entry.id}: 标了占位符 ${token}，但参数里找不到它`);
    }
  }
})

test('builtin projection keeps the config fields the installer writes', () => {
  // 目录 → 内置清单这一跳曾经丢过知识：把 packages 从显式字段改成从 args 推导，
  // 结果 HTTP 型条目失去包名、`appendSelectedBuiltinMcpServers` 认不出「已装过」。
  // 这里钉住投影不丢配置字段。
  const byId = new Map(BUILTIN_MCP_SERVERS.map((server) => [server.id, server]))
  for (const entry of MCP_CATALOG) {
    const server = byId.get(entry.id)
    assert.ok(server, `内置清单里没有 ${entry.id}`)
    assert.equal(server.name, entry.id, `${entry.id}: name 必须等于 id（工具名按它生成）`)
    assert.equal(server.transport, entry.transport)
    if (entry.transport === 'streamable-http') {
      assert.equal(server.url, entry.url, `${entry.id}: url 丢了`)
      assert.deepEqual(server.headers, entry.headers, `${entry.id}: headers 丢了`)
    } else {
      assert.equal(server.command, entry.command, `${entry.id}: command 丢了`)
      assert.deepEqual(server.args, entry.args, `${entry.id}: args 丢了`)
    }
  }
})
