/* 脚本版本号门禁：主 HTML 里每条 <script src="assets/*.js?v=..."> 的版本必须跟得上文件改动。
 *
 *   node _parallel/ver-check.cjs          检查，不合格 exit 1
 *   node _parallel/ver-check.cjs --bump   把落后的对齐到文件 mtime
 *
 * 为什么要跟 git 联动：只看 mtime 会误报。git checkout / 恢复一个文件都会刷新 mtime，
 * 内容其实一个字没变（2026-10-29 踩过：回滚一个探针改动后 kol.js 被判"过期"）。
 * 所以只检查**相对 HEAD 有改动**的文件 —— 内容没变的，版本号本来就不用动。
 *
 * 这是一份单独的实现，和 _check/_ver-check.cjs 的区别只在这一点：
 * _check/ 没进仓库（.gitignore 只放行 HTML / assets / _parallel / .githooks），
 * 钩子在别的机器上跑不到它。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'AI运营中台原型.html');
const bump = process.argv.includes('--bump');

const pad = n => String(n).padStart(2, '0');
const stamp = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());

const html = fs.readFileSync(HTML, 'utf8');
const re = /<script src="(assets\/[^"]+?\.js)(\?v=([^"]*))?"><\/script>/g;

let dirty = new Set();
try {
  execSync('git -c core.quotepath=false status --porcelain -- assets',
    { cwd: ROOT, encoding: 'utf8' }).split('\n').forEach(l => {
    const f = l.slice(3).trim();
    if (f) dirty.add(f);
  });
} catch (e) { /* 不在 git 仓库里就退化成纯 mtime 检查 */ }

const changes = [];
const bad = [];
let total = 0;
let m;

while ((m = re.exec(html))) {
  total++;
  const rel = m[1];
  const ver = m[3];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { bad.push({ rel, why: '文件不存在' }); continue; }

  const want = stamp(fs.statSync(file).mtime);
  const touched = dirty.has(rel);

  if (!ver) { changes.push({ rel, from: '无', to: want }); continue; }
  if (!touched) continue;                       /* 内容没变，版本号不用动 */
  if (ver === want) continue;

  /* 只改没提交过的文件，但要区分两种情况：
     版本号比 mtime 新 = 有人手改过，不动；版本号比 mtime 旧 = 真落后，对齐。 */
  if (ver.replace(/-/g, '') < want) changes.push({ rel, from: ver, to: want });
}

if (bump) {
  if (!changes.length) { console.log('版本号无需调整，' + total + ' 条全部合格。'); process.exit(0); }
  let out = html;
  changes.forEach(c => {
    out = out.replace(
      new RegExp('<script src="' + c.rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[^"]*)?"><\\/script>'),
      '<script src="' + c.rel + '?v=' + c.to + '"></script>'
    );
  });
  fs.writeFileSync(HTML, out);
  console.log('调整 ' + changes.length + ' 条');
  changes.forEach(c => console.log('  ' + c.rel + '  ' + c.from + ' → ' + c.to));
  process.exit(0);
}

if (bad.length) {
  bad.forEach(b => console.log('  ✗ ' + b.rel + '  —— ' + b.why));
  process.exit(1);
}
if (changes.length) {
  console.log('脚本引用 ' + total + ' 条，落后 ' + changes.length + ' 条');
  changes.forEach(c => console.log('  ✗ ' + c.rel + '  —— 声明 ' + c.from + ' 落后于文件改动的 ' + c.to));
  console.log('\n修法：node _parallel/ver-check.cjs --bump');
  process.exit(1);
}
console.log('脚本引用 ' + total + ' 条，全部合格。');
