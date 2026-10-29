/* 并行开发的边界守卫。
 * 用法：
 *   node _parallel/guard.cjs --list              看每一段样式归谁
 *   node _parallel/guard.cjs --files             看每个 js 文件归谁
 *   node _parallel/guard.cjs --lane assets       以 assets 泳道身份检查未提交改动
 *   node _parallel/guard.cjs --lane assets --base main
 *
 * 规则：一个泳道只能改自己 files 里的文件、自己 sections 里的样式段。
 * 串行区 core 不受这个限制，但一轮只允许一个分支改它 —— 流程约定，脚本管不了。
 * 判据是「改动落在哪一段」：段内哪怕改一个字符也算越界。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_NAME = 'AI运营中台原型.html';
const HTML = path.join(ROOT, HTML_NAME);
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'lanes.json'), 'utf8'));

const argv = process.argv.slice(2);
const has = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

const LANES = Object.keys(CFG.lanes);

/* ---------- 段落归属 ----------
 * 不按行号写死：主 HTML 的样式块里段落一动，行号全错。
 * 改用「段落标题」当锚：lanes.json 里配的每个 key 去 HTML 里找一条以它开头的注释行，
 * 找到的那行就是这一段的起点，终点是下一个已配置段落的起点 - 1。
 * 配了却找不到 = 段落被改名或删了，直接报错，防止归属悄悄失效。 */
function normComment(line) {
  return line.replace(/^\s*/, '').replace(/^\/\*+/, '').replace(/^[=\u2500\s]+/, '').trim();
}

function cssBounds(lines) {
  let from = 0, to = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^<style>\s*$/.test(lines[i])) from = i + 1;
    if (/^<\/style>\s*$/.test(lines[i])) to = i + 1;
  }
  return { from: from + 1, to: to };
}

function buildZones(lines) {
  const { from, to } = cssBounds(lines);
  const wanted = [];
  LANES.forEach(lane => (CFG.lanes[lane].sections || []).forEach(key => wanted.push({ key, lane })));

  const missing = [];
  const dup = [];
  const hits = [];
  for (const w of wanted) {
    let found = -1;
    for (let i = from - 1; i < to; i++) {
      if (normComment(lines[i]).startsWith(w.key)) { found = i + 1; break; }
    }
    if (found < 0) { missing.push(w.key); continue; }
    const clash = hits.find(h => h.line === found);
    if (clash) dup.push(w.key + ' 与 ' + clash.key + ' 同在第 ' + found + ' 行');
    hits.push({ key: w.key, lane: w.lane, line: found });
  }
  hits.sort((a, b) => a.line - b.line);
  hits.forEach((h, i) => {
    h.start = h.line;
    h.end = i + 1 < hits.length ? hits[i + 1].line - 1 : to - 1;
  });
  hits.unshift({ key: '(head 与 body 壳)', lane: 'core', line: 1, start: 1, end: hits.length ? hits[0].line - 1 : 0 });
  const { from: f2 } = cssBounds(lines);
  hits[0].end = f2 - 1;
  hits.push({ key: '(样式块收尾、body 壳、script 顺序与版本号)', lane: 'core', line: to, start: to, end: lines.length });
  return { zones: hits, missing, dup };
}

const fileOwner = file => {
  const base = path.basename(file);
  for (const name of LANES) if ((CFG.lanes[name].files || []).includes(base)) return name;
  return 'core';
};

/* ---------- list / files ---------- */
if (has('--list') || has('--files')) {
  const lines = fs.readFileSync(HTML, 'utf8').split(/\r?\n/);
  const { zones, missing, dup } = buildZones(lines);

  if (has('--files')) {
    const dir = path.join(ROOT, 'assets');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    const byLane = {};
    files.forEach(f => { const l = fileOwner(f); (byLane[l] = byLane[l] || []).push(f); });
    Object.keys(byLane).sort().forEach(l => console.log(l.padEnd(11) + String(byLane[l].length).padStart(2) + ' 个  ' + byLane[l].join(' ')));
    const unowned = files.filter(f => fileOwner(f) === 'core' && !(CFG.lanes.core.files || []).includes(f));
    if (unowned.length) console.log('\n没认领、默认落 core：' + unowned.join(' '));
  } else {
    console.log('行范围           泳道       段落锚点');
    zones.forEach(z => console.log(String(z.start).padStart(5) + '-' + String(z.end).padEnd(5) + '  ' + z.lane.padEnd(10) + ' ' + z.key.slice(0, 44)));
  }
  if (missing.length) console.log('\n⚠ 配置了但找不到的段落：' + missing.join(' / '));
  if (dup.length) console.log('\n⚠ 两个 key 落在同一行：' + dup.join('；'));
  process.exit(0);
}

/* ---------- 检查 ---------- */
const myLane = val('--lane') || 'core';
const base = val('--base') || 'HEAD';
if (!CFG.lanes[myLane]) {
  console.error('没有这个泳道：' + myLane + '。可选：' + LANES.join(' / '));
  process.exit(2);
}

let diff = '';
try {
  diff = execSync('git -c core.quotepath=false diff --unified=0 ' + base + ' -- .',
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.error('取不到 diff，base=' + base + '：' + String(e.message).split('\n')[0]);
  process.exit(2);
}
if (!diff.trim()) { console.log('工作区干净，没有改动可比。'); process.exit(0); }

const lines = fs.readFileSync(HTML, 'utf8').split(/\r?\n/);
const { zones } = buildZones(lines);
const laneOf = n => { for (const z of zones) if (n >= z.start && n <= z.end) return z; return { key: '(未归属)', lane: 'core', start: n, end: n }; };

const violations = [];
const touched = {};
let curFile = null;

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) { curFile = raw.slice(6).trim(); continue; }
  if (!raw.startsWith('@@') || !curFile) continue;
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
  if (!m) continue;
  const oldStart = +m[1], oldCount = m[2] === undefined ? 1 : +m[2];
  const newStart = +m[3], newCount = m[4] === undefined ? 1 : +m[4];

  if (!curFile.endsWith(HTML_NAME)) {
    const owner = fileOwner(curFile);
    touched[owner] = (touched[owner] || 0) + 1;
    if (owner !== myLane && myLane !== 'core') {
      violations.push({ file: curFile, where: '整个文件', detail: '归 ' + owner });
    }
    continue;
  }

  const seen = new Map();
  const hit = n => { if (!n) return; const z = laneOf(n); seen.set(z.key, z); };
  for (let i = 0; i < newCount; i++) hit(newStart + i);
  for (let i = 0; i < oldCount; i++) hit(oldStart + i);
  for (const z of seen.values()) {
    touched[z.lane] = (touched[z.lane] || 0) + 1;
    if (z.lane !== myLane && myLane !== 'core') {
      violations.push({ file: curFile, where: z.key + '（' + z.start + '-' + z.end + ' 行）', detail: '归 ' + z.lane });
    }
  }
}

/* 新增文件不在 git diff 里，单独查一遍 —— 否则开个新 js 谁都能往任何泳道塞 */
try {
  const untracked = execSync('git -c core.quotepath=false ls-files --others --exclude-standard',
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map(s => s.trim()).filter(Boolean);
  for (const f of untracked) {
    const owner = fileOwner(f);
    touched[owner + '(新增)'] = (touched[owner + '(新增)'] || 0) + 1;
    if (owner !== myLane && myLane !== 'core') {
      violations.push({ file: f, where: '新增文件', detail: '新文件默认归 core，要并行得先在 lanes.json 认领' });
    }
  }
} catch (e) { /* 拿不到就跳过 */ }

const uniq = [];
const dedup = new Set();
for (const v of violations) {
  const k = v.file + '|' + v.where;
  if (dedup.has(k)) continue;
  dedup.add(k);
  uniq.push(v);
}

console.log('身份：' + myLane + '　基线：' + base);
console.log('改动落在：' + (Object.keys(touched).map(l => l + ' ' + touched[l] + ' 处').join('，') || '无'));
if (!uniq.length) { console.log('✓ 全部在自己边界内'); process.exit(0); }
console.log('✗ 越界 ' + uniq.length + ' 处');
uniq.forEach(v => console.log('  · ' + v.file + ' › ' + v.where + '　' + v.detail));
console.log('\n越界不是错误，是提醒：要动别人的段落，先提一个契约变更，让那一段的泳道合完再继续。');
process.exit(1);
