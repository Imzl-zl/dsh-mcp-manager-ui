const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'mcp-servers-verified.yaml');
const text = fs.readFileSync(file, 'utf8');

const YAML = require('yaml');

const fence = String.fromCharCode(96).repeat(3);
const start = text.indexOf(fence + 'yaml');
const end = text.indexOf(fence, start + 6);
if (start < 0 || end < 0) {
  console.log('NO YAML BLOCK FOUND');
  process.exit(1);
}
const block = text.slice(start + 7, end);

const arr = YAML.parse(block);
console.log('parsed entries:', arr.length);

const cats = {};
let problems = 0;
const ids = [];

for (const e of arr) {
  ids.push(e.id);
  const isHttp = e.transport === 'streamable-http';
  const isStdio = e.transport === 'stdio';

  if (!['search','dev','data','browser','cloud','productivity','ai','files','comms'].includes(e.category)) {
    console.log('BAD category:', e.id, e.category); problems++;
  }
  if (!isHttp && !isStdio) { console.log('BAD transport:', e.id, e.transport); problems++; }
  if (isHttp && !e.url) { console.log('MISSING url:', e.id); problems++; }
  if (isHttp && e.command) { console.log('HTTP should not have command:', e.id); problems++; }
  if (isStdio && !e.command) { console.log('MISSING command:', e.id); problems++; }
  if (isStdio && e.url) { console.log('stdio should not have url:', e.id); problems++; }
  if (!e.homepage) { console.log('MISSING homepage:', e.id); problems++; }
  if (!e.summary) { console.log('MISSING summary:', e.id); problems++; }
  if (e.summary && e.summary.length > 20) { console.log('summary >20 chars:', e.id, `(${e.summary.length})`); problems++; }
  if (!/^[a-z0-9-]+$/.test(e.id)) { console.log('BAD id format:', e.id); problems++; }

  cats[e.category] = (cats[e.category] || 0) + 1;
}

const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('duplicate ids:', dup.length ? dup : 'none');
console.log('categories:', JSON.stringify(cats));
console.log('category count:', Object.keys(cats).length);
console.log('total:', arr.length);
console.log('problems:', problems);
