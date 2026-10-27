/* ============================================================================
 * v10 · 沙盒隔离（参考 Docker Desktop 的交互范式）
 *
 * 本文件做两件事（都不改 renderers2.js，靠**覆盖注册**实现）：
 *   ① 覆盖 R.sandboxPage  —— 列表页改成 Docker Desktop 风：
 *        搜索/筛选 · 资源水位大盘 · 安全事件条 · 行内快捷操作 · 多选 + 批量操作
 *   ② 新增 R.sandboxDetail —— 实例详情 5 Tab：
 *        配置 / 安全边界 / 实时监控（曲线+进程表）/ 执行日志 / 任务队列
 *
 * 对齐 Docker Desktop 的三个关键范式：
 *   · 列表行上直接给操作（不必点进详情才能停）
 *   · Resources / Stats 的资源水位与实时曲线（进程表可强杀）
 *   · 多选 + 批量操作（危险批量需确认并给出影响面）
 *
 * 铁律：ES5 · 确定性随机走 h.seed.R.of · 禁 details 折叠 · 口径入 metaBar
 * ==========================================================================*/
(function (global) {
  'use strict';

  var R = global.RENDERERS;

  /* 本文件自带的样式（避免动 html 的 <style>） */
  function injectCss() {
    if (!global.document || global.document.getElementById('v10-sbx-css')) return;
    var css = [
      '.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}',
      '.kv>div{border:1px solid #e6e9f0;border-radius:9px;padding:9px 11px;background:#fbfcfe}',
      '.kv i{display:block;font-style:normal;font-size:11.5px;color:var(--faint);margin-bottom:4px}',
      '.kv b{font-size:13px;color:#1f2733;font-weight:600;word-break:break-all}',
      'tr.row-sel{background:#eff6ff}',
      'button.ins{text-align:left;cursor:pointer;font:inherit;border:1px solid #e6e9f0;background:#fff;border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;width:100%}',
      'button.ins:hover{border-color:#93c5fd;background:#f8fbff}',
      '.net-tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.net-tier{display:flex;flex-direction:column;gap:3px;align-items:flex-start;border:1px solid #e6e9f0;border-radius:9px;padding:10px 12px;background:#fff;cursor:pointer;font:inherit;text-align:left}',
      '.net-tier.on{border-color:#2563eb;background:#eff6ff;box-shadow:inset 0 0 0 1px #2563eb}',
      '.net-tier b{font-size:13px}',
      '.net-tier span{font-size:11.5px;color:var(--faint)}',
      '.net-tier .cur{font-style:normal;font-size:10.5px;color:#2563eb;font-weight:600}',
      '.sbx-log{border:1px solid #e6e9f0;border-radius:9px;overflow:hidden;background:#fbfcfe;max-height:430px;overflow-y:auto}',
      '.sbx-log-line{display:flex;gap:10px;padding:4px 12px;font-size:12px;line-height:1.6;border-bottom:1px solid #f0f2f7}',
      '.sbx-log-line .t{color:var(--faint);flex:0 0 112px}',
      '.sbx-log-line .lv{flex:0 0 48px;font-weight:700;font-size:10.5px}',
      '.sbx-log-line.info .lv{color:#2563eb}',
      '.sbx-log-line.warn .lv{color:#d97706}',
      '.sbx-log-line.error .lv{color:#dc2626}',
      '.sbx-log-line .msg{color:#1f2733;word-break:break-all;flex:1}',
      '.sbx-log-line.error{background:#fef2f2}',
      '.reuse-seg{display:inline-flex;border:1px solid #e6e9f0;border-radius:7px;overflow:hidden;background:#fff}',
      '.reuse-btn{border:0;background:none;font:inherit;font-size:11.5px;padding:3px 8px;cursor:pointer;color:var(--sub);border-right:1px solid #f0f2f7;white-space:nowrap}',
      '.reuse-btn:last-child{border-right:0}',
      '.reuse-btn:hover{background:#f8fbff;color:#2563eb}',
      '.reuse-btn.on{background:#2563eb;color:#fff;font-weight:500}',
      '.lvl-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #f0f2f7}',
      '.lvl-row:first-child{border-top:0}',
      '.lvl-row.on{background:#eff6ff}',
      '.lvl-tag{flex:0 0 44px;font-weight:700;font-size:12.5px}',
      '.lvl-kind{flex:0 0 108px;font-size:12.5px}',
      '.lvl-meta{flex:1;font-size:12px;color:var(--sub)}',
      '.lvl-reuse{flex:0 0 76px;font-size:11.5px;color:var(--faint);text-align:right}',
      '.touch{display:inline-flex;align-items:baseline;gap:3px;border:1px solid #e6e9f0;border-radius:6px;padding:1px 6px;margin-right:4px;background:#fbfcfe}',
      '.touch i{font-style:normal;font-size:10.5px;color:var(--faint)}',
      '.touch b{font-size:12px;color:#1f2733}',
      '.touch b.bad{color:#dc2626}',
      '.ro-mode{display:inline-block;font-size:12px;color:#1f2733;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:1px 7px}',
      '.u-note{font-size:12px;color:#475569}',
      '.u-note.warn{color:#d97706}',
      '.u-note.bad{color:#dc2626}',
      /* ---------- 界面规整（作用域 .sbx-page，不影响其他页） ---------- */
      '.sbx-page>.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}',
      '.sbx-page .metric{padding:13px 15px;border-radius:10px}',
      '.sbx-page .metric .m-label{font-size:12px;color:var(--faint);margin-bottom:7px;font-weight:400}',
      '.sbx-page .metric .m-value{font-size:23px;line-height:1.05;font-weight:600;letter-spacing:-.5px}',
      '.sbx-page .metric .m-foot,.sbx-page .metric .m-sub{font-size:11.5px;color:var(--faint);margin-top:5px;line-height:1.4}',
      '.sbx-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;background:#fff;border:1px solid #e6e9f0;border-radius:10px;margin-bottom:12px}',
      '.sbx-toolbar .lbl{font-size:12px;color:var(--faint)}',
      '.sbx-toolbar input,.sbx-toolbar select{height:31px;border:1px solid #e6e9f0;border-radius:8px;padding:0 9px;font-size:12.5px;background:#fbfcfe;color:#1f2733}',
      '.sbx-toolbar input{min-width:210px}',
      '.sbx-toolbar input:focus,.sbx-toolbar select:focus{outline:0;border-color:#2563eb;background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.08)}',
      '.sbx-toolbar .sp{margin-left:auto;font-size:12px;color:var(--faint)}',
      '.sbx-toolbar.in-card{border:0;border-bottom:1px solid #f0f2f7;border-radius:0;margin-bottom:0;padding:9px 16px;background:#fcfdfe}',
      '.sbx-toolbar.in-card .sp{display:none}',
      '.sbx-duo{display:grid;grid-template-columns:1.06fr 1fr;gap:12px;margin-bottom:12px;align-items:start}',
      '@media (max-width:1240px){.sbx-duo{grid-template-columns:1fr}}',
      '.sbx-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:9px;padding:12px 14px}',
      '.sbx-chip{background:#fbfcfe;border:1px solid #eef1f6;border-radius:9px;padding:10px 12px;text-align:left;cursor:pointer;font:inherit}',
      '.sbx-chip:hover{border-color:#bfdbfe;background:#f8fbff}',
      /* 🔴 修复：原来这里是 nowrap + ellipsis，1440px 宽下「策略拒绝（Denied）」被裁成
         「策略拒绝（Denied」（实测 scrollWidth 108 vs clientWidth 101，末尾缺一个右括号）。
         计量口径的名字被截断会失去意义，且 hover 才给 title 不算补偿 ⇒ 改为允许换行。 */
      '.sbx-chip i{display:block;font-style:normal;font-size:11.5px;color:var(--faint);margin-bottom:5px;line-height:1.35;overflow-wrap:anywhere}',
      '.sbx-chip b{font-size:18px;font-weight:600;line-height:1.1;color:#1f2733}',
      '.sbx-chip b.bad{color:#dc2626}.sbx-chip b.warn{color:#d97706}.sbx-chip b.ok{color:#16a34a}',
      '.sbx-chip span{display:block;font-size:11px;color:var(--faint);margin-top:4px;line-height:1.4}',
      '.sbx-gauges{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;padding:11px 14px}',
      '@media (max-width:1100px){.sbx-gauges{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.sbx-gauge{background:#fbfcfe;border:1px solid #eef1f6;border-radius:9px;padding:10px 12px}',
      '.sbx-gauge i{display:block;font-style:normal;font-size:11.5px;color:var(--faint);margin-bottom:7px}',
      '.sbx-gauge .v{font-size:12px;color:var(--sub);margin-top:6px;letter-spacing:-.2px}',
      /* 它能碰什么：4 枚紧凑纵排小徽标（label 上 / 数字下），比横排更好扫 */
      '.touch{display:inline-block;border:0;background:transparent;padding:0;margin:0 12px 0 0;text-align:center;vertical-align:middle}',
      '.touch i{display:block;font-style:normal;font-size:10.5px;color:var(--faint);line-height:1.2}',
      '.touch b{display:block;font-size:14px;font-weight:600;line-height:1.25}',
      '.touch.k-data b{color:#2563eb}.touch.k-tool b{color:#7c3aed}',
      '.touch.k-cred b{color:#d97706}.touch.k-net b{color:#0d9488}',
      '.touch b.bad{color:#dc2626!important}',
      '.sbx-page table.bt td{vertical-align:middle}',
      '.sbx-page .tbl-head{display:flex;align-items:baseline;gap:8px;padding:13px 16px;border-bottom:1px solid #f0f2f7}',
      '.sbx-page .tbl-head h3{font-size:14px;margin:0}',
      '.sbx-page .tbl-head .sub{font-size:12px;color:var(--faint)}',
      '.sbx-page .tbl-head .n{margin-left:auto;font-size:12px;color:var(--faint)}',
      /* 向导 / 表单 */
      '.v10-wiz-steps{display:flex;gap:0;padding:12px 20px 0;border-bottom:1px solid #f0f2f7}',
      '.v10-wiz-step{flex:1;text-align:center;font-size:12px;color:var(--faint);padding:0 6px 10px;position:relative}',
      '.v10-wiz-step.on{color:#2563eb;font-weight:500}',
      '.v10-wiz-step .dot{display:inline-flex;width:22px;height:22px;border-radius:50%;border:1.5px solid #d6dbe4;align-items:center;justify-content:center;font-size:11px;margin-right:5px}',
      '.v10-wiz-step.on .dot{border-color:#2563eb;background:#eff6ff}',
      '.v10-wiz-step.done .dot{border-color:#16a34a;background:#f0fdf4;color:#16a34a}',
      '.v10-field{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f7f8fa}',
      '.v10-field:last-child{border-bottom:0}',
      '.v10-field i{flex:0 0 96px;font-style:normal;font-size:12.5px;color:var(--sub)}',
      '.v10-field input,.v10-field select{flex:1;height:33px;border:1px solid #e6e9f0;border-radius:8px;padding:0 10px;font-size:13px;background:#fbfcfe;color:#1f2733}',
      '.v10-field input:focus,.v10-field select:focus{outline:0;border-color:#2563eb;background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.08)}',
      '.v10-seg{display:inline-flex;border:1px solid #e6e9f0;border-radius:8px;overflow:hidden;background:#fff}',
      '.v10-seg button{border:0;background:none;font:inherit;font-size:12.5px;padding:7px 14px;cursor:pointer;color:var(--sub);border-right:1px solid #f0f2f7}',
      '.v10-seg button:last-child{border-right:0}',
      '.v10-seg button.on{background:#2563eb;color:#fff;font-weight:500}',
      '.v10-img-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:4px 0}',
      '.v10-img{display:flex;align-items:center;gap:10px;border:1px solid #e6e9f0;border-radius:9px;padding:10px 12px;cursor:pointer;background:#fff;font:inherit;text-align:left}',
      '.v10-img:hover{border-color:#93c5fd;background:#f8fbff}',
      '.v10-img.on{border-color:#2563eb;background:#eff6ff;box-shadow:inset 0 0 0 1px #2563eb}',
      '.v10-img b{font-size:13px;color:#1f2733;font-family:"SF Mono",Consolas,monospace}',
      '.v10-img span{font-size:11.5px;color:var(--faint)}',
      '.sbx-page table.bt td{white-space:nowrap}',
      '.sbx-page table.bt td .td-sub{font-size:11px;line-height:1.45}',
      '.sbx-page table.bt td .lnk b{white-space:nowrap}',
      '.sbx-page table.bt td:last-child .btn-ghost,.sbx-page table.bt td:last-child .btn-danger{padding:4px 9px;font-size:12px;margin-left:4px}',
      '.sbx-page table.bt td:last-child .btn-ghost:first-child,.sbx-page table.bt td:last-child .btn-danger:first-child{margin-left:0}',
      '.sbx-page table.bt tbody tr:hover{background:#fafbfe}'
    ].join('\n');
    var st = global.document.createElement('style');
    st.id = 'v10-sbx-css';
    st.textContent = css;
    global.document.head.appendChild(st);
  }
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', injectCss);
    else injectCss();
  }


  /* ------------------------------------------------------------------ 工具 */
  function usage(s) {
    var p = String(s.concurrency || '0 / 1').split('/');
    return p.length === 2 ? Number(p[0]) / Math.max(1, Number(p[1])) : 0;
  }
  function parseSpec(spec) {
    // '4C / 8G' 或 '8C / 32G / A10'
    var cpu = /([\d.]+)C/.exec(spec), mem = /([\d.]+)G/.exec(spec);
    return { cpu: cpu ? Number(cpu[1]) : 2, mem: mem ? Number(mem[1]) : 4, gpu: /A10|GPU|A100/.test(spec) };
  }
  function verdict(s) {
    var u = usage(s);
    if (u >= 0.95) return { k: 'bad', t: '濒临上限' };
    if (u >= 0.85) return { k: 'warn', t: '接近上限' };
    if (s.status === 'idle') return { k: 'idle', t: '已停止' };
    return s.status === 'ok' ? { k: 'ok', t: '正常' } : { k: 'warn', t: '需关注' };
  }
  function rowsOf(h) {
    var t = h.app.getAssetTables().sandbox;
    return (t && t.rows) || [];
  }
  /* 给人看的实例名。
   * 坑：沙盒行的 name 是**机器令牌**（sbx-code-exec / runtime-py311:v4.2 这一族），
   * 界面上把它当"名字"印在页头、面包屑、确认层标题里，等于把内部的 pod 名交给用户。
   * 中文标签在同行的 kindText（代码执行池 / 文档解析 / 无头浏览器 / 实验评估）。
   * 令牌不是没用 —— 它是**唯一身份**，所以列表格里保留成次要的等宽副行，只是不再当标题。 */
  function sbxLabel(s) {
    if (!s) return '';
    var nm = s.name || '';
    if (!/[\u4e00-\u9fa5\u3040-\u30ff]/.test(nm) && /[\u4e00-\u9fa5]/.test(s.kindText || '')) return s.kindText;
    return nm;
  }
  function byId(h, id) {
    var r = h.app.byId ? h.app.byId('sandbox', id) : null;
    /* 读端之二：详情取到的也套会话态覆盖 —— 否则「停止」后详情页头仍写「运行中」，
       与列表状态列自相矛盾（同一 id 两处状态不一致，是本轮在四处修过的同一毛病）。 */
    if (r) return withOpOverride((h && h.state) || {}, r);
    var rows = rowsOf(h), i;
    for (i = 0; i < rows.length; i++) if (rows[i].id === id) return withOpOverride((h && h.state) || {}, rows[i]);
    /* 本会话新建的沙盒不在资产表里 —— 不查这里，新行上的「详情/启动/重启/销毁」会报「未找到该沙盒」，
       出现"能看见却点不动"的行。 */
    var made = (h.state && h.state.sbxNew) || [];
    for (i = 0; i < made.length; i++) if (made[i].id === id) return made[i];
    return null;
  }
  function rnd(h, key) { return h.seed.R.of('sbx|' + key); }
  /** 按等级取判级规则行（判级按可枚举的对照表推导；原文未规定判定方式） */
  function ruleByLevel(h, lv) {
    var t = (h.app && h.app.sLevelRules) || [];
    for (var i = 0; i < t.length; i++) if (t[i].level === lv) return t[i];
    return t[3] || null;
  }
  /** 这个沙盒上的执行记录（原文表名 sandbox_execution；「任务 → 沙盒」的关联键是 sandboxId） */
  function executionsOf(h, sandboxId) {
    var t = h.app.getAssetTables().sandbox_execution;
    var rows = (t && t.rows) || [];
    return rows.filter(function (r) { return r.sandboxId === sandboxId; });
  }
  /** 这个沙盒上的安全事件（原文表名 sandbox_event） */
  function eventsOf(h, sandboxId) {
    var t = h.app.getAssetTables().sandbox_event;
    var rows = (t && t.rows) || [];
    return rows.filter(function (r) { return r.sandboxId === sandboxId; });
  }
  /** 取某张绑定表里属于该沙盒的行（用来交叉校验沙盒行上的 4 个计数） */
  function bindingsOf(h, table, sandboxId) {
    var t = h.app.getAssetTables()[table];
    var rows = (t && t.rows) || [];
    return rows.filter(function (r) { return r.sandboxId === sandboxId; });
  }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    return out;
  }
  function chip(label, on, act, id) {
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' + id + '">' + label + '</button>';
  }

  /* 资源水位大盘：把各实例的资源规格汇总成 5 条水位（Docker Desktop 的 Resources 视图范式） */
  function resourcePool(h) {
    /* 本会话新建的沙盒也要进水位 —— 否则新建后列表多一行、水位条却说"4 个沙盒"，两处对不上 */
    var rows = rowsOf(h).concat((h.state && h.state.sbxNew) || []), agg = { cpu: 0, mem: 0, gpu: 0, disk: 0, net: 0 };
    rows.forEach(function (s) {
      var p = parseSpec(s.spec);
      agg.cpu += p.cpu;
      agg.mem += p.mem;
      if (p.gpu) agg.gpu += 1;
      var r = rnd(h, s.id + '|pool');
      agg.disk += 10 + Math.round(r() * 40);
      agg.net += 5 + Math.round(r() * 25);
    });
    // 集群总量（示例口径，见 metaBar）
    var total = { cpu: 64, mem: 256, gpu: 4, disk: 1024, net: 200 };
    return [
      { key: 'CPU', used: agg.cpu, total: total.cpu, unit: ' 核' },
      { key: '内存', used: agg.mem, total: total.mem, unit: ' GB' },
      { key: 'GPU', used: agg.gpu, total: total.gpu, unit: ' 卡' },
      { key: '磁盘', used: agg.disk, total: total.disk, unit: ' GB' },
      { key: '网络出流量', used: agg.net, total: total.net, unit: ' MB/s' }
    ];
  }

  /* 24h 安全事件（越权尝试 / 异常网络请求 / 资源超限被杀），条数由实例的 blocked 派生 */
  /* v20 修复（P0-3）：拦截数原来三套口径互相对不上 ——
   *列表 blocked(合计33) / sandbox_event 行数(16) / sandbox_execution.denied 合计(27)，
   * 且 sbx-exp-eval 声明 blocked=0 却有 4 条事件（含 2 条 CRITICAL）。
   * 现在定sandbox_event 为唯一事实源：所有拦截数都从这张表数出来，不再手写、不再乘系数。
   * 执行记录里的 denied 语义不同（单次执行内的拒绝次数），单独取，不混叫「安全拦截」。*/
  function eventRowsOf(h) {
    var t = h.app.getAssetTables().sandbox_event;
    return (t && t.rows) || [];
  }
  /** 按策略判定分类计数（唯一事实源=sandbox_event） */
  function blockedByDecision(h) {
    var out = { syscall: 0, egress: 0, metadata: 0, limit: 0, tool: 0, total: 0 };
    eventRowsOf(h).forEach(function (e) {
      out.total++;
      if (e.policyDecision === 'syscall_denied') out.syscall++;
      else if (e.policyDecision === 'egress_denied') out.egress++;
      else if (e.policyDecision === 'metadata_denied') out.metadata++;
      else if (e.policyDecision === 'limit_enforced') out.limit++;
      else if (e.policyDecision === 'tool_denied') out.tool++;
    });
    return out;
  }
  /** 某沙盒的拦截数：从事件表数，不读行上手写的 blocked */
  function blockedOf(h, sandboxId) {
    return eventRowsOf(h).filter(function (e) { return e.sandboxId === sandboxId; }).length;
  }
  function secEvents(h) {
    var rows = rowsOf(h);
    var over = rows.reduce(function (a, r) { return a + (usage(r) >= 0.95 ? 1 : 0); }, 0);
    var blocked = rows.reduce(function (a, r) { return a + r.blocked; }, 0);
    var net = rows.reduce(function (a, r) { var f = rnd(h, r.id + '|net'); return a + Math.round(f() * 6); }, 0);
    /* 全部从 sandbox_event 数出，不再有 0.42 这种凭空系数 */
    var bd = blockedByDecision(h);
    var denied = bd.egress + bd.metadata;
    /* 2026-10-20 走查修复：四类事件加起来是 14，而 KPI「安全拦截」是 16 —— 差的 2 条是
       limit_enforced（资源超限被强制终止）。这一格原来算的是「并发 ≥95% 的实例数」，
       是**实例数**不是**事件数**，所以跟 KPI 永远差一截。改回事件表里的 limit 计数，
       四类之和 = KPI 总数（同一张 sandbox_event 表，可对账）。 */
    return [
      { k: '越权访问尝试', v: bd.syscall, tone: bd.syscall > 8 ? 'bad' : 'warn', tip: '尝试访问宿主路径 / 提权调用被隔离层拦截' },
      { k: '异常网络请求', v: bd.egress + bd.metadata, tone: (bd.egress + bd.metadata) ? 'warn' : 'ok', tip: '非白名单地址的外连 / 元数据端点尝试' },
      { k: '资源超限被杀', v: bd.limit, tone: bd.limit ? 'bad' : 'ok', tip: '超出 CPU / 内存配额被强制终止的执行次数（另：' + over + ' 个实例并发 ≥95%）' },
      { k: '策略拒绝（Denied）', v: bd.tool, tone: bd.tool ? 'warn' : 'ok', tip: '按安全策略直接拒绝、未进入执行的操作' }
    ];
  }

  /* ================================================================ ① 列表页 */
  R.sandboxPage = function (cap, state, h) {
    var fmt = h.fmt;
    var rows = rowsOf(h);
    /* 🔴 本会话新建的沙盒此前**只弹一个 toast，哪都不落地**（向导提交处只有 el.remove() + toast），
       用户建完在列表里找不到，会以为没建成 —— 与画像库/经验库修过的是同一个毛病。
       这里把它并进列表；KPI/聚合仍只用基础数据（rows），否则「四个沙盒合计」会被新建项污染。 */
    var sessionSbx = (state && state.sbxNew) || [];
    var allRows = sessionSbx.length ? rows.concat(sessionSbx) : rows;
    /* 读端之一：列表/筛选/KPI 全部走套了会话态覆盖的行（停用后状态列与筛选下拉同步可见） */
    allRows = allRows.map(function (r) { return withOpOverride(state, r); });
    var f = state.sbxFilter || {};
    var sel = state.sbxSel || [];

    /* —— 筛选（Docker Desktop 的搜索 + 筛选行） —— */
    var kinds = uniq(allRows.map(function (r) { return r.kindText; }));
    var bizs = uniq(allRows.map(function (r) { return r.biz; }));
    var stat = uniq(allRows.map(function (r) { return r.statusText; }));
    /* v31：隔离等级也是一条筛选维度 —— 详情页「S0–S5 六级对照」里的「看该等级的其他沙盒」
       要真的落到这里（此前列表没有这个筛选，那种入口就是假的）。 */
    var levels = uniq(allRows.map(function (r) { return r.sLevel; }).filter(Boolean)).sort();
    var q = (f.q || '').trim().toLowerCase();
    var view = allRows.filter(function (r) {
      if (q && (r.name + ' ' + r.image + ' ' + r.kindText).toLowerCase().indexOf(q) < 0) return false;
      if (f.kind && r.kindText !== f.kind) return false;
      if (f.status && r.statusText !== f.status) return false;
      if (f.biz && r.biz !== f.biz) return false;
      if (f.level && r.sLevel !== f.level) return false;
      return true;
    });
    /* 排序：排障时最先问「哪个最忙 / 哪个拦截最多 / 哪个快到期」。
       这张表是手写 <table>（不走 h.table），所以 sortable 要自己接。 */
    var SBX_SORTS = {
      sessions: { label: '近 24h', get: function (r) { return r.sessions24h || 0; } },
      blocked: { label: '拦截', get: function (r) { return r.blocked || 0; } },
      expire: { label: '到期', get: function (r) { return r.expiresInDays == null ? 1e9 : r.expiresInDays; } },
      name: { label: '沙盒', get: function (r) { return sbxLabel(r); } }
    };
    var sk = f.sort, sdir = f.sortDir === 'asc' ? 'asc' : 'desc';
    if (sk && SBX_SORTS[sk]) {
      var g = SBX_SORTS[sk].get;
      view = view.slice().sort(function (a, b) {
        var x = g(a), y = g(b);
        if (typeof x === 'string') return sdir === 'asc' ? x.localeCompare(y) : y.localeCompare(x);
        return sdir === 'asc' ? x - y : y - x;
      });
    } else {
      view = view.slice().sort(function (a, b) { return (b.sessions24h || 0) - (a.sessions24h || 0); });
    }

    var filterBar =
      '<div class="sbx-toolbar">' +
      '<span class="lbl">筛选</span>' +
      '<input data-sbx="q" placeholder="搜索实例名 / 镜像 / 类型" value="' + h.esc(f.q || '') + '">' +
      '<select data-sbx="kind"><option value="">类型：全部</option>' + kinds.map(function (k) {
        return '<option value="' + h.esc(k) + '"' + (f.kind === k ? ' selected' : '') + '>' + h.esc(k) + '</option>';
      }).join('') + '</select>' +
      '<select data-sbx="status"><option value="">状态：全部</option>' + stat.map(function (k) {
        return '<option value="' + h.esc(k) + '"' + (f.status === k ? ' selected' : '') + '>' + h.esc(k) + '</option>';
      }).join('') + '</select>' +
      '<select data-sbx="biz"><option value="">业务方：全部</option>' + bizs.map(function (k) {
        return '<option value="' + h.esc(k) + '"' + (f.biz === k ? ' selected' : '') + '>' + h.esc(k) + '</option>';
      }).join('') + '</select>' +
      /* v31：隔离等级筛选（详情页「S0–S5 对照」的落点） */
      '<select data-sbx="level"><option value="">等级：全部</option>' + levels.map(function (k) {
        return '<option value="' + h.esc(k) + '"' + (f.level === k ? ' selected' : '') + '>' + h.esc(k) + '</option>';
      }).join('') + '</select>' +
      ((f.kind || f.status || f.biz || f.level || q) ? '<button class="btn-ghost sm" data-act="sbx-clear">清除</button>' : '') +
      '<span class="sp">' + view.length + ' / ' + allRows.length + ' 个沙盒</span>' +
      '</div>';

    /* —— 近 24h 安全事件（可下钻） —— */
    var evs = secEvents(h);
    var evHtml = '<div class="card pad0"><div class="tbl-head"><h3>近 24 小时安全事件</h3>' +
      '</div>' +
      '<div class="sbx-chips">' + evs.map(function (e) {
        var cls = e.tone === 'bad' ? 'bad' : (e.tone === 'ok' ? 'ok' : 'warn');
        return '<button class="sbx-chip" data-act="sbx-ev" data-id="' + h.esc(e.k) + '" title="' + h.esc(e.tip) + '">' +
          '<i>' + h.esc(e.k) + '</i><b class="' + cls + '">' + e.v + '</b></button>';
      }).join('') + '</div></div>';

    /* —— 资源水位（Docker Desktop › Resources 的范式） —— */
    var pool = resourcePool(h);
    var poolHtml = '<div class="card pad0" data-static="1" title="只读说明：这是资源池的汇总水位（集群总量），不是单个沙盒的属性，因此没有可筛选/可下钻维度；单实例用量见下方实例列表每行的规格。"><div class="tbl-head"><h3>资源水位</h3>' +
      '<span class="sub">超 80% 琥珀 · 超 95% 红</span>' +
      '<span class="n">规格汇总</span></div>' +
      '<div class="sbx-gauges">' + pool.map(function (pp) {
        var ratio = pp.used / pp.total;
        return '<div class="sbx-gauge"><i>' + h.esc(pp.key) + '</i>' +
          h.charts.gauge(ratio, { title: pp.used + ' / ' + pp.total + pp.unit }) +
          '<div class="v">' + pp.used + ' / ' + pp.total + h.esc(pp.unit) + '</div></div>';
      }).join('') + '</div></div>';

    var duoHtml = '<div class="sbx-duo">' + evHtml + poolHtml + '</div>';

    /* —— 实例列表（行内操作 + 多选 + 批量） —— */
    function sortTh(key, label, cls) {
      var on = sk === key;
      return '<th' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<button class="sbx-sort' + (on ? ' on' : '') + '" data-act="sbx-sort" data-id="' + key + '">' +
        h.esc(label) + (on ? (sdir === 'asc' ? ' ↑' : ' ↓') : '') + '</button></th>';
    }
    var head = '<thead><tr>' +
      '<th style="width:34px"><input type="checkbox" data-act="sbx-all"' + (sel.length && sel.length === view.length ? ' checked' : '') + ' aria-label="全选"></th>' +
      sortTh('name', '沙盒', '') +
      '<th>服务的 Agent</th>' +
      '<th>它能碰什么</th><th>隔离 / 复用</th>' +
      '<th>运行态</th>' + sortTh('sessions', '近 24h', 'ta-r') + '<th>状态</th><th class="ta-r">操作</th>' +
      '</tr></thead>';
    var body = view.map(function (s) {
      var v = verdict(s), u = usage(s), on = sel.indexOf(s.id) > -1;
      /* 会话态覆盖先套上：让**状态成为唯一真源** —— 否则「停止」后会出现
         "状态列写已停止、操作列还写着停止按钮"的自相矛盾（running 是第二处派生）。 */
      s = withOpOverride(state, s);
      var running = s.status !== 'idle';
      var rule = ruleByLevel(h, s.sLevel);
      var actual = h.app.resolveReuse ? h.app.resolveReuse(s.reuseMode, s.sLevel) : s.reuseMode;
      var p = parseSpec(s.spec);
      /* 4 个计数与绑定表行数交叉校验（对不上就把差标出来，不粉饰） */
      var nData = bindingsOf(h, 'sandbox_data_binding', s.id).length;
      var nTool = bindingsOf(h, 'sandbox_tool_binding', s.id).length;
      var nCred = bindingsOf(h, 'sandbox_credential', s.id).length;
      var nNet = bindingsOf(h, 'sandbox_network_rule', s.id).length;
      function cnt(declared, actual2, label, k) {
        var ok = declared === actual2;
        return '<span class="touch k-' + k + '" title="' + label + '：声明 ' + declared + ' / 绑定表 ' + actual2 + (ok ? '' : '（对不上）') + '">' +
          '<i>' + label + '</i><b class="' + (ok ? '' : 'bad') + '">' + actual2 + '</b></span>';
      }
      return '<tr' + (on ? ' class="row-sel"' : '') + '>' +
        '<td><input type="checkbox" data-act="sbx-sel" data-id="' + h.esc(s.id) + '"' + (on ? ' checked' : '') + ' aria-label="选择"></td>' +
        '<td><button class="lnk" data-act="sbx-open" data-id="' + h.esc(s.id) + '"><b>' + h.esc(sbxLabel(s)) + '</b></button>' +
        '<div class="td-sub mono">' + h.esc(s.name) + ' · ' + h.esc(s.image) + '</div></td>' +
        '<td>' + h.esc(s.agentNames || '—') + '<div class="td-sub">' + h.esc(s.biz) + '</div></td>' +
        '<td style="white-space:nowrap">' + cnt(s.dataSources, nData, '数据', 'data') + cnt(s.tools, nTool, '工具', 'tool') +
        cnt(s.creds, nCred, '凭证', 'cred') + cnt(s.netRules, nNet, '网络', 'net') + '</td>' +
        /* 隔离等级 与 复用模式 都是「这个沙盒被怎么定的」⇒ 合并成一列，省一列宽度 */
        '<td style="white-space:nowrap">' + h.pill(s.sLevel === 'S4' || s.sLevel === 'S5' ? 'bad' : (s.sLevel === 'S3' ? 'warn' : 'info'), s.sLevel) +
        '<span class="ro-mode" style="margin-left:6px">' + h.esc(s.reuseModeText || '—') + '</span>' +
        '<div class="td-sub">→ ' + h.esc(h.app.reuseLabel ? h.app.reuseLabel[actual] : actual) + ' · 在「隔离等级」改</div></td>' +
        '<td style="min-width:118px">' + h.charts.gauge(u, { title: '并发 ' + s.concurrency }) +
        '<div class="td-sub">' + p.cpu + 'C/' + p.mem + 'G · ' + h.esc(s.concurrency) +
        (s.expiresAt && s.expiresAt !== '—' ? ' · 到期 ' + h.esc(s.expiresAt) : '') + '</div></td>' +
        /* 近 24h：执行数 + Denied 合到一列 */
        '<td class="ta-r">' + h.esc(String(s.sessions24h != null ? s.sessions24h : '—')) +
        '<div class="td-sub ' + (s.blocked > 10 ? 'warn' : '') + '">拦截 ' + h.esc(String(s.blocked)) + '</div></td>' +
        '<td>' + h.pill(s.status, s.statusText) + '</td>' +
        '<td class="ta-r" style="white-space:nowrap">' +
        (running
          ? '<button class="btn-ghost sm" data-act="sbx-op" data-id="' + h.esc(s.id) + '|stop">停止</button>'
          : '<button class="btn-ghost sm ok" data-act="sbx-op" data-id="' + h.esc(s.id) + '|start">启动</button>') +
        '<button class="btn-ghost sm" data-act="sbx-op" data-id="' + h.esc(s.id) + '|restart">重启</button>' +
        '<button class="btn-danger sm" data-act="sbx-op" data-id="' + h.esc(s.id) + '|destroy">销毁</button>' +
        '</td></tr>';
    }).join('');
    /* 筛选条并进列表卡（它本来就是列表的工具）—— 少一层卡片外壳，列表能再上移 65px */
    var listBlock =
      '<div class="card pad0"><div class="tbl-head"><h3>沙盒实例</h3>' +
      '<span class="n">' + view.length + ' 个</span></div>' +
      filterBar.replace('class="sbx-toolbar"', 'class="sbx-toolbar in-card"') +
      (view.length
        ? '<div class="tbl-wrap"><table class="bt">' + head + '<tbody>' + body + '</tbody></table></div>'
        : '<div class="empty"><div class="empty-title">没有符合条件的沙盒</div>' +
        '<div class="empty-sub">调整筛选条件，或创建一个新沙盒</div>' +
        '<button class="btn-ghost" data-act="sbx-clear">清除全部筛选</button></div>') +
      '</div>';

    /* —— 批量操作条（选中后出现） —— */
    var bulk = sel.length
      ? '<div class="card"><div class="card-h"><h3>已选 ' + sel.length + ' 个实例</h3>' +
        '<span class="card-sub">批量操作会影响这些实例上正在跑的任务</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn-ghost" data-act="sbx-bulk" data-id="restart">批量重启</button>' +
        '<button class="btn-danger" data-act="sbx-bulk" data-id="stop">批量停止</button>' +
        '<button class="btn-ghost" data-act="sbx-bulk" data-id="clear">取消选择</button>' +
        '</div></div>'
      : '';

    return '<div class="sbx-page">' +
      '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div></div>' +
      '<div class="ph-side">' +
      '<button class="btn-ghost" data-act="sbx-images">镜像</button>' +
      '<button class="btn-ghost" data-act="sbx-import">导入</button>' +
      '<button class="btn-primary" data-act="sbx-create" data-primary-action>' + h.esc(cap.action || '创建沙盒') + '</button></div></div>' +

      /* KPI 照原文「沙盒工作台」口径：运行中 / 暂停 / 异常 / 今日执行 / 安全拦截（不是待处理卡） */
      '<div class="metrics">' + [
        { label: '运行中', value: String(rows.filter(function (s) { return s.status === 'ok'; }).length), sub: '共 ' + rows.length + ' 个沙盒' },
        { label: '暂停', value: String(rows.filter(function (s) { return s.status === 'idle'; }).length), sub: '已停止但配置保留' },
        { label: '异常', value: String(rows.filter(function (s) { var k = verdict(s).k; return k === 'bad' || k === 'warn'; }).length), alert: rows.filter(function (s) { return verdict(s).k === 'bad'; }).length > 0, sub: '并发 ≥ 85% 或状态异常' },
        { label: '今日执行', value: fmt.int(rows.reduce(function (a, r) { return a + (r.sessions24h || 0); }, 0)), sub: rows.length + ' 个沙盒合计' + (sessionSbx.length ? '（本会话新建 ' + sessionSbx.length + ' 个未计入）' : '') },
        { label: '安全拦截', value: fmt.int(rows.reduce(function (a, r) { return a + (r.blocked || 0); }, 0)), sub: '被策略阻止的危险操作' }
      ].map(h.metricCard).join('') + '</div>' +

      /* 运行状态（安全事件 + 资源水位）放 KPI 之后、筛选条之前 ——
         原先夹在筛选与列表之间，把「沙盒实例」挤到首屏外（实测表格顶 665px）。 */
      duoHtml + bulk + listBlock +
      h.metaBar({ range: null, definitions: null }, [
        { k: '资源水位口径', v: 'CPU / 内存由各实例资源规格汇总；磁盘与网络出流量为集群分配配额' },
        { k: '并发水位', v: '= 当前并发 ÷ 并发上限；≥ 85% 标黄、≥ 95% 标红' },
        { k: '启停与销毁', v: '危险操作须先确认影响面，确认后留审计记录' }
      ]) +
      '</div>';
  };


  /* ============================================================== ② 详情页 */
  var TABS = [
    { key: 'level', label: '隔离等级' },
    { key: 'touch', label: '它能碰什么' },
    { key: 'events', label: '安全事件' },
    { key: 'security', label: '禁用清单' },
    { key: 'sessions', label: '执行记录' },
    { key: 'config', label: '配置' },
    { key: 'stats', label: '实时监控' },
    { key: 'logs', label: '执行日志' },
    { key: 'queue', label: '任务队列' }
  ];

  /* 确定性派生的进程列表（Docker Desktop › Containers › Stats 的进程表） */
  var PROC_NAMES = [
    ['python3', '/opt/runtime/main.py --job {j}'],
    ['node', 'agent-worker.js --queue {j}'],
    ['chromium', '--headless --remote-debugging-port={p} --no-sandbox'],
    ['docparse', 'parse --input /tmp/in/{j}.pdf --out /tmp/out'],
    ['llm-proxy', 'sidecar --upstream gateway.internal:443'],
    ['sh', '-c tail -f /var/log/task.log']
  ];
  function procsOf(h, s) {
    if (s.status === 'idle') return [];
    var f = rnd(h, s.id + '|procs');
    var n = 3 + Math.floor(f() * 4);
    var out = [];
    for (var i = 0; i < n; i++) {
      var p = PROC_NAMES[i % PROC_NAMES.length];
      var g = rnd(h, s.id + '|p' + i);
      var cpu = +(g() * 42).toFixed(1), mem = +(g() * 21 + 3).toFixed(1);
      out.push({
        pid: 1000 + Math.floor(g() * 8000),
        cmd: p[1].replace('{j}', String(100 + Math.floor(g() * 900))).replace('{p}', String(9000 + Math.floor(g() * 900))),
        bin: p[0], cpu: cpu, mem: mem,
        dangerous: i === PROC_NAMES.length - 1 && g() > 0.6
      });
    }
    return out;
  }
  function trendOf(h, s, kind) {
    var f = rnd(h, s.id + '|' + kind + '|trend'), base = kind === 'cpu' ? 42 : (kind === 'mem' ? 55 : 22), out = [];
    for (var i = 0; i < 24; i++) {
      var v = base + (f() - 0.45) * (kind === 'cpu' ? 46 : 24);
      out.push(Math.max(2, Math.min(98, Math.round(v))));
    }
    return out;
  }
  function logsOf(h, s) {
    if (s.status === 'idle') return [];
    var f = rnd(h, s.id + '|logs');
    var n = 14 + Math.floor(f() * 8);
    var kinds = [
      { lv: 'info', txt: 'task {j} started · image {img}' },
      { lv: 'info', txt: 'workspace mounted: /workspace (ro) + /tmp (rw)' },
      { lv: 'warn', txt: 'cgroup memory pressure 82% · throttling applied' },
      { lv: 'info', txt: 'tool call mcp://{mcp} ok · {ms}ms' },
      { lv: 'error', txt: 'DENIED: attempted connect to {bad_ip}:443 (not in whitelist)' },
      { lv: 'error', txt: 'DENIED: attempted open /host/etc/passwd' },
      { lv: 'info', txt: 'task {j} finished · exit 0 · {ms}ms' }
    ];
    var bad = ['185.199.108.153:443', 'api.unknown-vendor.io:443', '169.254.169.254:80'];
    var mcps = ['doc/parse', 'crm/query', 'ticket/create'];
    var out = [];
    for (var i = 0; i < n; i++) {
      var g = rnd(h, s.id + '|log' + i);
      var k = kinds[Math.floor(g() * kinds.length)];
      var deny = k.lv === 'error';
      out.push({
        at: '10-0' + (3 - (i % 4)) + ' ' + String(23 - Math.floor(i / 3)).padStart(2, '0') + ':' + String(Math.floor(g() * 60)).padStart(2, '0') + ':' + String(Math.floor(g() * 60)).padStart(2, '0'),
        lv: k.lv, denied: deny,
        txt: k.txt.replace('{j}', String(100 + Math.floor(g() * 900)))
          .replace('{img}', s.image).replace('{ms}', String(Math.round(60 + g() * 2600)))
          .replace('{mcp}', mcps[Math.floor(g() * mcps.length)])
          .replace('{bad_ip}', bad[Math.floor(g() * bad.length)])
      });
    }
    return out;
  }
  function queueOf(h, s) {
    var f = rnd(h, s.id + '|queue');
    var n = s.status === 'idle' ? 0 : 2 + Math.floor(f() * 5);
    var names = ['docparse 批量解析', 'prompt 回归跑批', 'embedding 重建索引', '达人脚本合规预检', '工单分类回溯', '成本预测脚本', '问卷语料抽取'];
    var out = [];
    for (var i = 0; i < n; i++) {
      var g = rnd(h, s.id + '|q' + i);
      out.push({
        id: 'job-' + (2500 + Math.floor(g() * 900)),
        name: names[Math.floor(g() * names.length)],
        prio: i < 2 ? 'P0' : (i < 4 ? 'P1' : 'P2'),
        wait: Math.round(20 + g() * 900),
        eta: Math.round(60 + g() * 1800),
        biz: s.biz
      });
    }
    return out;
  }

  R.sandboxDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var s = byId(h, state.objId || state.agentId);
    /* 对象不存在 ⇒ 走统一的「未找到该对象」空态。
       ⚠️ 不能退回 R.fallback —— 那会说「渲染器未实现」，而实际情况是**对象不存在**，
       信息是错的（这里踩过一次）。 */
    if (!s) return h.detailMissing(cap, state, h);
    var active = state.objTab || state.tab || 'level';
    var v = verdict(s), u = usage(s), p = parseSpec(s.spec);
    var running = s.status !== 'idle';
    var body = '';

    /* ---- Tab: 隔离等级（判级按可枚举的对照表推导；原文未规定判定方式） ---- */
    if (active === 'level') {
      var rules = h.app.sLevelRules || [];
      /* v31：同级沙盒计数用（对照表上的「看该等级的其他沙盒」）—— 直接读资产表，不另算一套 */
      var _allSbx = (h.app && h.app.getAssetTables) ? (h.app.getAssetTables().sandbox.rows || []) : [];
      var cur = ruleByLevel(h, s.sLevel) || {};
      var actualMode = h.app.resolveReuse ? h.app.resolveReuse(s.reuseMode, s.sLevel) : s.reuseMode;
      var REUSE_OPTS = [
        ['reuse', '常驻复用', '多任务共用一个池，省冷启动；上一位任务的残留可能串味'],
        ['ephemeral', '用完即毁', '每次任务新建实例、跑完销毁，隔离最干净；冷启动与资源峰值更高'],
        ['auto', '按风险自动', 'S0–S3 复用、S4–S5 新建 —— 跟随等级']
      ];
      /* 🔴 #7/#8 用户拍板（2026-10-06）：对外只用**轻隔离 / 中隔离 / 重隔离**三档。
         这三档**不是新造的编号** —— 它对应 data.js 里既有的 preset 字段：
           Standard（S0–S2）→ 轻隔离 · Restricted（S3–S4）→ 中隔离 · Highly Restricted（S5）→ 重隔离
         所以这里只做**中文命名**，不改动等级与预设本身。 */
      var TIER_ZH = { 'Standard': '轻隔离', 'Restricted': '中隔离', 'Highly Restricted': '重隔离' };
      body = '<div class="card" data-static="1" title="只读说明：本卡是「该沙盒为什么被判成这个等级」的推导结果；改等级走上方操作区（sbx-op），同级横向对照见下方 S0–S5 表。"><div class="card-h"><h3>当前隔离等级</h3>' +
        '<span class="card-sub">按任务场景定级 · 对外三档：轻隔离 / 中隔离 / 重隔离</span></div>' +
        '<div class="kv">' +
        '<div><i>等级</i><b>' + h.esc(s.sLevel) + ' · ' + h.esc(cur.taskKind || '') +
          '　<span class="pill">' + h.esc(TIER_ZH[cur.preset] || '') + '</span></b></div>' +
        '<div><i>Runtime</i><b>' + h.esc(cur.runtime || '') + '</b></div>' +
        '<div><i>网络</i><b>' + h.esc(cur.net || '') + '</b></div>' +
        '<div><i>数据</i><b>' + h.esc(cur.data || '') + '</b></div>' +
        '</div>' +
        '<div class="bt-note">场景「' + h.esc(cur.taskKind || '') + '」→ 等级表第 ' +
        (rules.indexOf(cur) + 1) + ' 行 → 判为 ' + h.esc(s.sLevel) + '。</div></div>' +

        '<div class="card"><div class="card-h"><h3>S0–S5 六级对照</h3>' +
        '<span class="card-sub">对外归为三档 · 不得所有任务用同一种 Sandbox · 点等级可看同级的其他沙盒</span></div><div>' +
        rules.map(function (r) {
          var on = r.level === s.sLevel;
          /* v31：对照表此前是纯只读 —— 现在每个等级都通向**真的会筛**的沙盒列表
             （列表页按 state.sbxFilter.level 过滤，本次同批加入该维度）。
             同级一个都没有时如实写出来，不挂一个筛出空列表的按钮。
             入口挂在 .lvl-meta 里（它是 flex:1 的那一格），不新增 flex 子项 —— 四列栅格不动。 */
          var peers = _allSbx.filter(function (x) { return x.sLevel === r.level && x.id !== s.id; }).length;
          var peerLink = on ? ''
            : (peers
              ? '　<button class="lnk" data-act="sbx-level-peers" data-id="' + h.esc(r.level) + '">看该等级的其他沙盒（' + peers + '）→</button>'
              : '　<span class="muted">该等级暂无其他沙盒</span>');
          return '<div class="lvl-row' + (on ? ' on' : '') + '">' +
            '<span class="lvl-tag' + (on ? '' : ' muted') + '">' + h.esc(r.level) + '</span>' +
            '<span class="lvl-kind">' + h.esc(r.taskKind) +
              (TIER_ZH[r.preset] ? '　<span class="pill">' + h.esc(TIER_ZH[r.preset]) + '</span>' : '') + '</span>' +
            '<span class="lvl-meta">' + h.esc(r.runtime) + ' · 网络 ' + h.esc(r.net) + ' · 数据 ' + h.esc(r.data) + ' · 预设 ' + h.esc(r.preset) + peerLink + '</span>' +
            '<span class="lvl-reuse">' + h.esc((h.app.reuseLabel || {})[r.reuseMode] || r.reuseMode) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="bt-note">预设三档：<b>轻隔离</b>（Standard · S0–S2） / ' +
        '<b>中隔离</b>（Restricted · S3–S4） / <b>重隔离</b>（Highly Restricted · S5）。' +
        '等级判定仍按任务场景对照上表；<b>L0–L3 那套编号未采用</b>。</div></div>' +

        '<div class="card"><div class="card-h"><h3>复用模式</h3>' +
        '<span class="card-sub">这个沙盒怎么用由你定：省钱，还是干净</span></div>' +
        '<div class="net-tiers">' + REUSE_OPTS.map(function (m) {
          var on = (s.reuseMode || 'auto') === m[0];
          var eff = m[0] === 'auto' ? (h.app.resolveReuse ? h.app.resolveReuse('auto', s.sLevel) : 'reuse') : m[0];
          return '<button class="net-tier' + (on ? ' on' : '') + '" data-act="sbx-reuse" data-id="' + h.esc(s.id) + '|' + m[0] + '">' +
            '<b>' + m[1] + '</b><span>' + m[2] + '</span>' +
            '<i class="cur">' + (on ? '当前' : '实际 ' + h.esc((h.app.reuseLabel || {})[eff] || eff)) + '</i></button>';
        }).join('') + '</div>' +
        '<div class="bt-note">当前 ' + h.esc(s.reuseModeText || '') + ' → 实际 ' + h.esc((h.app.reuseLabel || {})[actualMode] || actualMode) +
        '。24h 内这个池跑了 ' + h.esc(String(s.sessions24h || 0)) + ' 次会话，' +
        (s.reuseSaved > 0 ? '复用省下 ' + h.esc(String(s.reuseSaved)) + ' 次冷启动' : '因为是一次性模式，没有省下冷启动') + '。</div></div>';
    }

    /* ---- Tab: 它能碰什么（原文：不要只显示 CPU/内存；这是并列的 4 类边界，不是 4 个入口） ---- */
    if (active === 'touch') {
      var bData = bindingsOf(h, 'sandbox_data_binding', s.id);
      var bTool = bindingsOf(h, 'sandbox_tool_binding', s.id);
      var bNet = bindingsOf(h, 'sandbox_network_rule', s.id);
      var bCred = bindingsOf(h, 'sandbox_credential', s.id);
      function mini(title, sub, cols, rows, note) {
        return '<div class="card pad0"><div class="card-h pad"><h3>' + title + '</h3><span class="card-sub">' + sub + '</span></div>' +
          (rows.length
            ? '<div class="tbl-wrap"><table class="bt"><thead><tr>' +
            cols.map(function (c) { return '<th' + (c.r ? ' class="ta-r"' : '') + '>' + c.t + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rows.map(function (r) {
              return '<tr>' + cols.map(function (c) { return '<td' + (c.r ? ' class="ta-r ' + (c.cls ? c.cls(r) : '') + '"' : '') + '>' + r[c.k] + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>'
            : h.emptyFor('这一类没有绑定', '沙盒在这一层是关着的')) +
          (note ? '<div class="bt-note">' + note + '</div>' : '') + '</div>';
      }
      body =
        '<div class="card"><div class="card-h"><h3>这个沙盒能碰什么</h3>' +
        '<span class="card-sub">四类边界并列，由外侧策略定；沙盒自己说了不算</span></div>' +
        '<div class="ins-grid">' +
        '<div class="ins"><i>数据</i><b>' + bData.length + '</b><span>个数据集（投影后）</span></div>' +
        '<div class="ins"><i>工具</i><b>' + bTool.length + '</b><span>个 MCP 工具</span></div>' +
        '<div class="ins"><i>网络</i><b>' + bNet.length + '</b><span>条出网规则</span></div>' +
        '<div class="ins"><i>凭证</i><b>' + bCred.length + '</b><span>个运行时注入</span></div>' +
        '</div>' +
        '<div class="bt-note">这 4 个数 = 下方四张绑定表各自的<b>行数</b>（列表页的同名列也是这样数出来的，可交叉校验）。</div></div>' +

        mini('① 数据投影（Data Proxy）', '不是"挂库"：先过 Data Access Gateway 按权限裁剪，投影成临时数据集',
          [{ k: 'n', t: '数据集' }, { k: 'p', t: '权限' }, { k: 'sc', t: '投影范围（Task Scope）' }],
          bData.map(function (r) { return { n: '<b>' + h.esc(r.datasetName) + '</b><div class="td-sub mono">' + h.esc(r.datasetId) + '</div>', p: h.pill('info', r.permission), sc: h.esc(r.scope) }; }),
          '沙盒里<b>没有出现</b>的数据，AI 不可能知道它存在。') +

        mini('② 工具授权（Tool Proxy）', '不是"安装工具"：绑定 + 风险档 + 审批模式 + 限流',
          [{ k: 'n', t: '工具' }, { k: 'a', t: '动作' }, { k: 'rk', t: '风险档' }, { k: 'am', t: '审批模式' }, { k: 'rl', t: '限流', r: true }],
          bTool.map(function (r) {
            return {
              n: '<span class="mono">' + h.esc(r.toolId) + '</span>',
              a: h.esc(r.permission),
              rk: h.pill(r.riskLevel === 'CRITICAL' ? 'bad' : (r.riskLevel === 'HIGH' ? 'warn' : 'info'), r.riskLevel),
              am: h.esc(r.approvalMode), rl: h.esc(r.rateLimit)
            };
          }),
          '四档风险：LOW 自动 / MEDIUM 自动+Audit / HIGH 需你确认 / <b>CRITICAL 需两次确认</b>。') +

        mini('③ 网络规则（Egress Proxy）', '不是"开个白名单"：逐条 destination / protocol / port / action / 是否需审批。<b>匹配顺序 = 优先级升序，deny 全段先于 allow 段</b>，所以 deny 必胜；末条 0.0.0.0/0 deny 兜底。',
          [{ k: 'pr', t: '优先级', r: true }, { k: 'd', t: '目的地' }, { k: 'pro', t: '协议' }, { k: 'po', t: '端口', r: true }, { k: 'ac', t: '动作' }, { k: 'ap', t: '审批' }],
          bNet.slice().sort(function (x, y) { return (x.priority || 0) - (y.priority || 0); }).map(function (r) {
            return { pr: '<span class="mono">' + h.esc(r.priorityText || '—') + '</span>', d: '<span class="mono">' + h.esc(r.destination) + '</span>', pro: h.esc(r.protocol), po: h.esc(String(r.port)),
              ac: h.pill(r.action === 'allow' ? 'ok' : 'bad', r.action), ap: h.pill(r.approvalRequired ? 'warn' : 'ok', r.approvalRequiredText) };
          }),
          '恒为拒绝：<span class="mono">169.254.169.254</span>（元数据）· <span class="mono">10.0.0.0/8</span>（内网段）。') +

        mini('④ 凭证注入（Credential Proxy）', '不是"配置密钥"：运行时注入、不落盘、不出现在日志',
          [{ k: 's', t: '服务' }, { k: 'r', t: '凭证引用' }, { k: 'im', t: '注入方式' }, { k: 'tt', t: '生命周期' }],
          bCred.map(function (r) {
            return { s: '<span class="mono">' + h.esc(r.forService) + '</span>', r: '<span class="mono">' + h.esc(r.credRef) + '</span>', im: h.esc(r.injectMode), tt: h.esc(r.ttl) };
          }),
          '<b>密钥不落盘</b>：运行时注入、不出现在日志；禁止写入环境变量或打进镜像层。') +

        '<div class="card"><div class="card-h"><h3>爆炸半径</h3>' +
        '<span class="card-sub">Tenant → User → Task → Sandbox，四级各自独立边界</span></div>' +
        '<div class="kv"><div><i>当前链路</i><b class="mono">' + h.esc(s.blastScope || '—') + '</b></div>' +
        '<div><i>最坏波及</i><b class="warn">本 Tenant 内的该 User 名下任务（不跨 Tenant、不跨 User）</b></div>' +
        '<div><i>越界动作</i><b class="ok">已由四级边界阻断并记入安全事件</b></div></div></div>';
    }

    /* ---- Tab: 安全事件（从列表页的 4 个数字下钻到这里，能到具体 Denied 记录） ---- */
    if (active === 'events') {
      var evs = eventsOf(h, s.id);
      var byKind = {};
      evs.forEach(function (e) { byKind[e.eventType] = (byKind[e.eventType] || 0) + 1; });
      body = '<div class="card"><div class="card-h"><h3>安全事件</h3>' +
        '<span class="card-sub">' + evs.length + ' 条 · 按 sandboxId 过滤 · 可看到命中的具体系统调用</span></div>' +
        '<div class="ins-grid">' + Object.keys(byKind).map(function (k) {
          return '<div class="ins"><i>' + h.esc(k) + '</i><b>' + byKind[k] + '</b><span>条</span></div>';
        }).join('') + '</div>' +
        (evs.length
          ? '<div class="tbl-wrap"><table class="bt"><thead><tr>' +
          '<th>时间</th><th>类型</th><th>级别</th><th>发起方</th><th>对象</th><th>动作</th><th>策略判定</th><th>命中项</th>' +
          '</tr></thead><tbody>' + evs.map(function (e) {
            return '<tr><td class="mono">' + h.esc(e.at) + '</td>' +
              '<td>' + h.esc(e.eventType) + '</td>' +
              '<td>' + h.pill(e.severity, e.severityText) + '</td>' +
              '<td class="mono">' + h.esc(e.actor) + '</td>' +
              '<td class="mono">' + h.esc(e.resource) + '</td>' +
              '<td class="mono">' + h.esc(e.action) + '</td>' +
              '<td><span class="pill info">' + h.esc(e.policyDecision) + '</span></td>' +
              '<td class="mono ' + (e.deniedSyscall !== '—' ? 'bad' : 'muted') + '">' + h.esc(e.deniedSyscall) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          : h.emptyFor('这个沙盒没有被拦截的事件', '策略层面它是干净的')) + '</div>';
    }

    /* ---- Tab: 执行记录（原文表 sandbox_execution；任务 → 沙盒 的关联键是 sandboxId） ---- */
    if (active === 'sessions') {
      var execs = executionsOf(h, s.id);
      body = '<div class="card pad0"><div class="card-h pad"><h3>这个沙盒执行过哪些任务</h3>' +
        '<span class="card-sub">' + execs.length + ' 条执行记录 · 关联键 sandboxId</span></div>' +
        (execs.length
          ? '<div class="tbl-wrap"><table class="bt"><thead><tr>' +
          '<th>执行</th><th>任务</th><th>Agent</th><th>等级</th><th>启动方式</th><th>开始</th><th class="ta-r">资源占用</th><th class="ta-r">Denied</th><th>状态</th>' +
          '<th>业务用户会看到什么</th>' +
          '</tr></thead><tbody>' + execs.map(function (x) {
            /* 文案完全由状态驱动（不是常量映射）；且**不含路径 / 系统调用名** —— 那些只对管理员可见 */
            var note = x.status === 'bad'
              ? { k: 'bad', t: '该操作被安全策略拒绝' }
              : (x.denied > 0
                ? { k: 'warn', t: '该操作需要审批：本次将影响 ' + (x.denied * 250) + ' 个对象' }
                : { k: '', t: '本次数据已按你的权限裁剪（未投影的数据 AI 不可知）' });
            return '<tr><td class="mono">' + h.esc(x.id) + '</td>' +
              '<td>' + h.esc(x.taskName) + '<div class="td-sub mono">' + h.esc(x.taskId) + '</div></td>' +
              '<td>' + h.esc(x.agentName) + '</td>' +
              '<td>' + h.pill(x.sLevel === 'S4' || x.sLevel === 'S5' ? 'bad' : (x.sLevel === 'S3' ? 'warn' : 'info'), x.sLevel) + '</td>' +
              '<td>' + h.esc(x.startKindText) + '</td>' +
              '<td class="mono">' + h.esc(x.startedAt) + '</td>' +
              '<td class="ta-r mono">' + h.esc(x.resourceUsage) + '</td>' +
              '<td class="ta-r ' + (x.denied > 0 ? 'warn' : '') + '">' + h.esc(String(x.denied)) + '</td>' +
              '<td>' + h.pill(x.status, x.statusText) + '</td>' +
              '<td class="u-note ' + note.k + '">' + h.esc(note.t) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          + '<div class="bt-note">业务用户只会看到一句提示；<b>不显示内部路径与系统调用名</b>。同类提示也出现在 Agent 会话的运行回放里。</div>'
          : h.emptyFor('还没有执行记录', '有任务跑进来后这里会出现')) + '</div>' +
        '<div class="card"><div class="card-h"><h3>复用收益</h3>' +
        '<span class="card-sub">复用 vs 一次性的取舍，用数字说话</span></div>' +
        '<div class="kv">' +
        '<div><i>24h 执行数</i><b class="mono">' + h.esc(String(s.sessions24h || 0)) + '</b></div>' +
        '<div><i>省下冷启动</i><b class="mono ok">' + h.esc(String(s.reuseSaved || 0)) + ' 次</b></div>' +
        '<div><i>当前模式</i><b>' + h.esc(s.reuseModeText || '') + '</b></div>' +
        '<div><i>若改为一次性</i><b class="warn">需新建 ' + h.esc(String(s.sessions24h || 0)) + ' 个实例</b></div>' +
        '</div></div>';
    }

    /* ---- Tab: 配置（对齐 Docker Desktop 的 Inspect：分节展示，不糊成一张表） ---- */
    if (active === 'config') {
      var fsRo = rnd(h, s.id + '|fsro')() > 0.15;
      body = '<div class="card"><div class="card-h"><h3>镜像</h3>' +
        '<span class="card-sub">镜像来源与漏洞扫描状态</span>' +
        '<button class="btn-ghost sm" data-act="sbx-config-edit" data-id="' + h.esc(s.id) + '" style="margin-left:auto">编辑配置</button></div>' +
        '<div class="kv">' +
        '<div><i>镜像</i><b class="mono">' + h.esc(s.image) + '</b></div>' +
        '<div><i>来源</i><b>' + (s.kindText === '实验评估' ? '自定义构建（内部 registry）' : '内置镜像（平台维护）') + '</b></div>' +
        '<div><i>扫描状态</i><b class="ok">已扫描 · 0 高危</b></div>' +
        '<div><i>拉取策略</i><b>if-not-present</b></div>' +
        '</div></div>' +

        '<div class="card"><div class="card-h"><h3>资源与超时</h3></div><div class="kv">' +
        '<div><i>CPU / 内存</i><b class="mono">' + p.cpu + ' 核 / ' + p.mem + ' GB' + (p.gpu ? ' / 1 × A10' : '') + '</b></div>' +
        '<div><i>并发上限</i><b class="mono">' + h.esc(String(s.concurrency).split('/')[1] || '—') + '</b></div>' +
        '<div><i>当前并发</i><b class="mono ' + (u >= 0.85 ? 'warn' : '') + '">' + h.esc(String(s.concurrency).split('/')[0] || '0') + '</b></div>' +
        '<div><i>执行超时</i><b class="mono">' + (10 + Math.round(rnd(h, s.id + '|to')() * 50)) + ' min</b></div>' +
        '</div></div>' +

        '<div class="card"><div class="card-h"><h3>网络策略</h3>' +
        '<span class="card-sub">三档，默认最严格；放开需二次确认</span></div>' +
        '<div class="net-tiers">' +
        ['禁止出网', '白名单域名', '全开'].map(function (t, i) {
          var cur = (s.netPolicy === 'deny' && i === 0) || (s.netPolicy === 'whitelist' && i === 1);
          return '<button class="net-tier' + (cur ? ' on' : '') + '" data-act="sbx-net" data-id="' + h.esc(s.id) + '|' + i + '">' +
            '<b>' + t + '</b><span>' + ['最严格 · 推荐', '仅放行白名单', '需安全审批'][i] + '</span>' +
            (cur ? '<i class="cur">当前</i>' : '') + '</button>';
        }).join('') + '</div></div>' +

        '<div class="card"><div class="card-h"><h3>文件系统策略</h3></div><div class="kv">' +
        '<div><i>根文件系统</i><b>' + (fsRo ? '只读（ro）' : '可写（rw）') + '</b></div>' +
        '<div><i>可写目录</i><b class="mono">/tmp · /workspace/out</b></div>' +
        '<div><i>重启行为</i><b>清空 /tmp（不保留临时数据）</b></div>' +
        '<div><i>宿主挂载</i><b class="ok">无（不挂载宿主路径）</b></div>' +
        '</div></div>';
    }

    /* ---- Tab: 安全边界（规格标 ⭐，也是 Docker Desktop 没有而我们独有的） ---- */
    if (active === 'security') {
      /* v20 修复（P0-2）：原先用 netPolicy 反推等级 ⇒ sbx-doc（S3 但 deny 出网）
       * 在「隔离等级」Tab 显示 S3、在本 Tab 显示 S4，同页两套判级打架。
       * 现在统一读权威的 s.sLevel，与列表页徽标、隔离等级 Tab 完全一致。
       * 运行时强度同样取自规则表，不再用 kindText 二次推导
       *（否则 S3 代码执行显示 Container、而 S4 才显示 MicroVM —— 等级越高反而越弱）。*/
      var sRule = ruleByLevel(h, s.sLevel) || {};
      var lvl = h.esc(s.sLevel) + ' · ' + h.esc(sRule.taskKind || '—');
      /* 运行时文案带出依据，比孤立一个名词更可信 */
      var runtimeText = (sRule.runtime || '—') + (s.sLevel === 'S3' ? '（代码执行属不可信输入，按 microVM 隔离）' : '');
      var denies = [
        'ptrace / process_vm_readv（禁止读他进程内存）',
        'mount / umount（禁止挂载）',
        'reboot / kexec_load（禁止重启内核）',
        'open_by_handle_at（Docker 逃逸经典面）',
        'AF_PACKET socket（禁止原始套接字）',
        'setns / unshare 到宿主命名空间'
      ];
      body = '<div class="card"><div class="card-h"><h3>隔离级别</h3>' +
        '<span class="card-sub">等级取自该实例的隔离等级，与列表页一致</span></div>' +
        '<div class="kv"><div><i>当前级别</i><b>' + lvl + '</b></div>' +
        '<div><i>运行时隔离</i><b>' + h.esc(runtimeText) + '</b></div>' +
        '<div><i>网络档位</i><b>' + h.esc(s.netPolicyText) + '</b></div>' +
        '<div><i>与合规联动</i><b>数据出境校验已接入</b></div></div></div>' +

        '<div class="card"><div class="card-h"><h3>禁止的系统调用</h3>' +
        '<span class="card-sub">命中即 Denied 并记入执行日志 · 默认档位依据 seccomp RuntimeDefault</span></div>' +
        '<div class="ab-list">' + denies.map(function (d, i) {
          var hit = rnd(h, s.id + '|deny' + i)() > 0.72;
          return '<div class="ab-item" style="cursor:default"><span class="ab-why mono">' + h.esc(d.split('（')[0]) + '</span>' +
            '<b>' + h.esc(d.split('（')[1] ? d.split('（')[1].replace('）', '') : '') + '</b>' +
            (hit ? '<span class="ab-go warn">近 24h 命中 ' + (1 + Math.floor(rnd(h, s.id + '|dh' + i)() * 3)) + ' 次</span>' : '<span class="ab-go muted">未命中</span>') +
            '</div>';
        }).join('') + '</div></div>' +

        '<div class="card"><div class="card-h"><h3>密钥注入</h3></div>' +
        '<div class="kv"><div><i>注入方式</i><b>运行时注入（tmpfs），不落盘</b></div>' +
        '<div><i>日志可见性</i><b class="ok">不出现在日志与 stdout</b></div>' +
        '<div><i>生命周期</i><b>任务结束即销毁，不跨任务复用</b></div>' +
        '<div><i>禁止做法</i><b class="bad">禁止写入环境变量持久化 / 禁止落镜像层</b></div></div>' +
        '<div class="bt-warn">⚠ 在沙盒环境变量里塞 Secret 属于 30 行红线之一 —— 该做法已在平台层禁用，不提供开关。</div></div>';
    }

    /* ---- Tab: 实时监控（对齐 Docker Desktop › Stats：曲线 + 进程表 + 强杀） ---- */
    if (active === 'stats') {
      if (!running) {
        body = '<div class="card">' + h.emptyFor('实例已停止', '启动后可查看 CPU / 内存 / 网络曲线与进程列表') + '</div>';
      } else {
        var cpuT = trendOf(h, s, 'cpu'), memT = trendOf(h, s, 'mem'), netT = trendOf(h, s, 'net');
        var procs = procsOf(h, s);
        body = '<div class="metrics">' + [
          { label: 'CPU', value: String(cpuT[cpuT.length - 1]) + '%', sub: '配额 ' + p.cpu + ' 核 · 近 24 点' },
          { label: '内存', value: String(memT[memT.length - 1]) + '%', sub: '配额 ' + p.mem + ' GB' },
          { label: '网络出流量', value: String(netT[netT.length - 1]), unit: 'MB/s', sub: '策略 ' + h.esc(s.netPolicyText) },
          { label: '进程数', value: String(procs.length), sub: '含 1 个 sidecar' }
        ].map(h.metricCard).join('') + '</div>' +

          '<div class="card"><div class="card-h"><h3>资源曲线</h3>' +
          '<span class="card-sub">近 24 个采样点</span></div>' +
          '<div class="ins-grid">' + [
            { k: 'CPU', v: cpuT }, { k: '内存', v: memT }, { k: '网络', v: netT }
          ].map(function (x) {
            return '<div class="ins"><i>' + x.k + '</i>' + h.charts.sparkline(x.v) +
              '<span class="mono">最新 ' + x.v[x.v.length - 1] + (x.k === '网络' ? ' MB/s' : '%') + '</span></div>';
          }).join('') + '</div></div>' +

          '<div class="card pad0"><div class="card-h pad"><h3>进程列表</h3>' +
          '<span class="card-sub">' + procs.length + ' 个 · 可强制结束单个进程（需确认）</span></div>' +
          '<div class="tbl-wrap"><table class="bt"><thead><tr>' +
          '<th>PID</th><th>命令</th><th class="ta-r">CPU</th><th class="ta-r">内存</th><th>风险</th><th class="ta-r">操作</th>' +
          '</tr></thead><tbody>' + procs.map(function (pr) {
            return '<tr><td class="mono">' + pr.pid + '</td>' +
              '<td><span class="mono">' + h.esc(pr.bin) + '</span> <span class="td-sub">' + h.esc(pr.cmd) + '</span></td>' +
              '<td class="ta-r ' + (pr.cpu > 30 ? 'warn' : '') + '">' + pr.cpu + '%</td>' +
              '<td class="ta-r">' + pr.mem + '%</td>' +
              '<td>' + (pr.dangerous ? h.pill('warn', '曾触发 Denied') : '<span class="muted">—</span>') + '</td>' +
              '<td class="ta-r"><button class="btn-danger sm" data-act="sbx-kill" data-id="' + h.esc(s.id) + '|' + pr.pid + '">结束进程</button></td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }
    }

    /* ---- Tab: 执行日志（对齐 Docker Desktop › Logs：时间戳 + 级别色 + 拦截行） ---- */
    if (active === 'logs') {
      var logs = logsOf(h, s);
      var denied = logs.filter(function (l) { return l.denied; }).length;
      body = '<div class="card"><div class="card-h"><h3>执行日志</h3>' +
        '<span class="card-sub">' + logs.length + ' 条 · 其中 ' + denied + ' 条为安全策略拒绝（DENIED）</span></div>' +
        (logs.length
          ? '<div class="sbx-log">' + logs.map(function (l) {
            return '<div class="sbx-log-line ' + l.lv + '">' +
              '<span class="t mono">' + h.esc(l.at) + '</span>' +
              '<span class="lv">' + (l.lv === 'error' ? 'ERROR' : (l.lv === 'warn' ? 'WARN' : 'INFO')) + '</span>' +
              '<span class="msg mono">' + h.esc(l.txt) + '</span></div>';
          }).join('') + '</div>'
          : h.emptyFor('实例已停止', '启动后这里会显示每次任务的输入摘要、输出、退出码与被拦截的危险操作')) +
        '</div>' +
        '<div class="card"><div class="card-h"><h3>任务汇总（近 7 天）</h3></div>' +
        '<div class="kv"><div><i>总任务数</i><b class="mono">' + (240 + Math.round(rnd(h, s.id + '|tot')() * 900)) + '</b></div>' +
        '<div><i>成功率</i><b class="mono ok">' + (95 + rnd(h, s.id + '|sr')() * 4.5).toFixed(1) + '%</b></div>' +
        '<div><i>平均耗时</i><b class="mono">' + (12 + Math.round(rnd(h, s.id + '|avg')() * 80)) + 's</b></div>' +
        '<div><i>被拦截操作</i><b class="mono warn">' + s.blocked + ' 次</b></div></div></div>';
    }

    /* ---- Tab: 任务队列 ---- */
    if (active === 'queue') {
      var q = queueOf(h, s);
      body = '<div class="card pad0"><div class="card-h pad"><h3>任务队列</h3>' +
        '<span class="card-sub">' + q.length + ' 个排队中 · 优先级可调（P0 业务优先）</span></div>' +
        (q.length
          ? '<div class="tbl-wrap"><table class="bt"><thead><tr>' +
          '<th>任务</th><th>名称</th><th>优先级</th><th class="ta-r">已等待</th><th class="ta-r">预计耗时</th><th>业务方</th><th class="ta-r">操作</th>' +
          '</tr></thead><tbody>' + q.map(function (job) {
            return '<tr><td class="mono">' + h.esc(job.id) + '</td><td>' + h.esc(job.name) + '</td>' +
              '<td>' + h.pill(job.prio === 'P0' ? 'bad' : (job.prio === 'P1' ? 'warn' : 'info'), job.prio) + '</td>' +
              '<td class="ta-r mono">' + fmt.dur(job.wait * 1000) + '</td>' +
              '<td class="ta-r mono">≈ ' + fmt.dur(job.eta * 1000) + '</td>' +
              '<td>' + h.esc(job.biz) + '</td>' +
              '<td class="ta-r"><button class="btn-ghost sm" data-act="sbx-prio" data-id="' + h.esc(s.id) + '|' + h.esc(job.id) + '">提优先级</button></td></tr>';
          }).join('') + '</tbody></table></div>'
          : h.emptyFor('队列为空', '当前没有排队的任务')) + '</div>';
    }

    if (!body) body = h.emptyFor('未知 Tab', '该 Tab 不存在，请从上方 Tab 条选择');

    return '<div class="sbx-page">' +
      '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title"><button class="lnk" data-act="sbx-back">← 沙盒列表</button> &nbsp;' +
      '<b>' + h.esc(sbxLabel(s)) + '</b>' +
      '<span class="mono muted" style="font-weight:400">' + h.esc(s.name) + '</span>' + h.pill(s.status, s.statusText) + '</div>' +
      '<div class="ph-desc">' + h.esc(s.kindText) + ' · ' + h.esc(s.image) + ' · ' + h.esc(s.biz) +
      ' · 存活 ' + h.esc(s.uptime) + '</div></div>' +
      '<div class="ph-side">' +
      (running
        ? '<button class="btn-ghost" data-act="sbx-op" data-id="' + h.esc(s.id) + '|stop">停止</button>'
        : '<button class="btn-ghost ok" data-act="sbx-op" data-id="' + h.esc(s.id) + '|start">启动</button>') +
      '<button class="btn-ghost" data-act="sbx-op" data-id="' + h.esc(s.id) + '|restart">重启</button>' +
      '<button class="btn-danger" data-act="sbx-op" data-id="' + h.esc(s.id) + '|destroy">销毁</button>' +
      '</div></div>' +

      h.detailTabs(cap, { objTab: active }, TABS, h) +
      '<div class="metrics">' + [
        { label: '隔离等级', value: s.sLevel, sub: (ruleByLevel(h, s.sLevel) || {}).taskKind || '' },
        { label: '复用模式', value: s.reuseModeText || '—', sub: '实际 ' + ((h.app.reuseLabel || {})[h.app.resolveReuse ? h.app.resolveReuse(s.reuseMode, s.sLevel) : s.reuseMode] || '') },
        { label: '24h 会话', value: String(s.sessions24h != null ? s.sessions24h : '—'), sub: s.reuseSaved > 0 ? '复用省下 ' + s.reuseSaved + ' 次冷启动' : '一次性模式' },
        { label: '并发水位', value: fmt.pct0(u), alert: u >= 0.85, sub: s.concurrency + ' · ' + v.t }
      ].map(h.metricCard).join('') + '</div>' +
      body +
      h.metaBar(null, [
        { k: '数据性质', v: '配置项为配置态数据；曲线、进程、日志、队列为运行态采样' },
        { k: '进程与日志', v: '「结束进程」「提优先级」等操作需先确认影响面，确认后留审计记录' },
        { k: '判级口径', v: '按任务场景对照等级表推导；三档预设是创建时的快捷选择' },
        { k: '复用模式', v: '原型扩展项 —— 等级表默认要求沙盒临时且自动销毁；复用模式与之并存，便于权衡冷启动成本与串味风险' },
        { k: '业务用户侧', v: '只给结论性提示，不暴露内部路径与系统调用名；诊断细节仅管理员可见' }
      ]) +
      '</div>';
  };


  /* ================================================================ 动作 */
  var A = global.ACTIONS;

  /* ==================================================== 管理闭环：创建 / 导入 / 镜像 / 配置 */
  /* 说明：纯前端原型 —— 这些是**界面闭环**：有完整可点的流程，提交后弹「已提交」。
   * 不做数据真改（用户明确：只补界面，不真生效）。 */

  function imgRows(h) {
    var t = h.app.getAssetTables().sandbox_image;
    return (t && t.rows) || [];
  }
  function field(label, controlHtml) {
    return '<div class="v10-field"><i>' + label + '</i>' + controlHtml + '</div>';
  }
  function segHtml(name, opts, cur) {
    var s = '<span class="v10-seg">';
    opts.forEach(function (o) {
      s += '<button data-wiz="' + name + '" data-val="' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '">' + o[1] + '</button>';
    });
    return s + '</span>';
  }

  /* 创建向导：4 步 —— 基础 → 镜像 → 隔离 → 确认
   *
   * v20 修复（P0-1）：确认页原本把用户的选择全丢掉 ——
   * 前 3 步选什么都不影响第 4 步，确认页永远是写死的
   * 「sbx-new-agent / images[0] / S3·按风险自动·白名单 / 4C/8G」，提交后还弹「沙盒已创建」。
   * 用户核对不了自己建的到底是什么。
   * 现在引入 form 表单态：每步选择实时写回 form，确认页与提交提示都读 form。
   */
  A['sbx-create'] = function (id, btn, h) {
    var images = imgRows(h);
    var steps = ['基础', '镜像', '隔离', '确认'];
    var cur = 0;
    /* 表单态：默认值与原实现一致，不改变首屏观感 */
    var KIND_OPTS = [['code', '代码执行'], ['browser', '无头浏览器'], ['doc', '文档解析'], ['eval', '实验评估']];
    /* #7/#8：选项文案带上对外三档名，选等级时能看出它属于轻/中/重哪一档 */
    var SLEVEL_OPTS = [
      ['S1', '轻隔离 · S1 文本'], ['S2', '轻隔离 · S2 Python'],
      ['S3', '中隔离 · S3 代码'], ['S4', '中隔离 · S4 企业'],
      ['S5', '重隔离 · S5 高危']
    ];
    var REUSE_OPTS = [['auto', '按风险自动'], ['reuse', '常驻复用'], ['ephemeral', '用完即毁']];
    var NET_OPTS = [['whitelist', '白名单'], ['deny', '禁止出网']];
    var SPEC_OPTS = ['2C / 4G', '4C / 8G', '8C / 32G / A10'];
    var BIZ_OPTS = ['平台共享', '运营线', '法务线', '市场线'];
    var form = {
      name: 'sbx-new-agent', kind: 'code', biz: BIZ_OPTS[0],
      img: images.length ? images[0].id : null,
      slevel: 'S3', reuse: 'auto', net: 'whitelist', spec: SPEC_OPTS[1]
    };
    function imgOf(imgId) {
      for (var i = 0; i < images.length; i++) if (images[i].id === imgId) return images[i];
      return images[0] || { name: '—', version: '', sizeText: '', scanText: '' };
    }
    function labelOf(opts, val) {
      for (var i = 0; i < opts.length; i++) if (opts[i][0] === val) return opts[i][1];
      return val;
    }
    /* 取该等级对应的运行时，使确认页显示与规则表一致的话 */
    function ruleOf(lv) {
      var rules = (h.app && h.app.sLevelRules) || [];
      for (var i = 0; i < rules.length; i++) if (rules[i].level === lv) return rules[i];
      return null;
    }
    function wizHtml() {
      var bar = '<div class="v10-wiz-steps">' + steps.map(function (t, i) {
        return '<span class="v10-wiz-step' + (i === cur ? ' on' : (i < cur ? ' done' : '')) + '">' +
          '<span class="dot">' + (i < cur ? '✓' : (i + 1)) + '</span>' + t + '</span>';
      }).join('') + '</div>';
      var body = '';
      if (cur === 0) {
        body = field('名称', '<input data-wiz="name" placeholder="如 sbx-new-agent" value="' + h.esc(form.name) + '">') +
          field('用途', segHtml('kind', KIND_OPTS, form.kind)) +
          field('所属业务方', '<select data-wiz="biz">' + BIZ_OPTS.map(function (b) {
            return '<option' + (b === form.biz ? ' selected' : '') + '>' + b + '</option>';
          }).join('') + '</select>');
      } else if (cur === 1) {
        body = '<div class="v10-img-grid">' + images.map(function (im) {
          return '<button class="v10-img' + (im.id === form.img ? ' on' : '') + '" data-wiz="img" data-val="' + h.esc(im.id) + '">' +
            '<b>' + h.esc(im.name + ':' + im.version) + '</b>' +
            '<span>' + h.esc(im.sizeText) + ' · ' + h.esc(im.scanText) + '</span></button>';
        }).join('') + '</div>';
      } else if (cur === 2) {
        body = field('隔离等级', segHtml('slevel', SLEVEL_OPTS, form.slevel)) +
          field('复用模式', segHtml('reuse', REUSE_OPTS, form.reuse)) +
          field('网络', segHtml('net', NET_OPTS, form.net)) +
          field('资源规格', '<select data-wiz="spec">' + SPEC_OPTS.map(function (sp) {
            return '<option' + (sp === form.spec ? ' selected' : '') + '>' + h.esc(sp) + '</option>';
          }).join('') + '</select>');
      } else {
        /* 确认页：全部读 form，如实反映前 3 步的选择 */
        var im = imgOf(form.img);
        var rule = ruleOf(form.slevel);
        var netText = form.net === 'deny' ? '禁止出网' : '白名单';
        body = '<div class="v10-sheet-desc">将创建沙盒实例，配置如下（与上面三步所选一致）：</div>' +
          '<div class="v10-field"><i>名称</i><b class="mono" style="flex:1">' + h.esc(form.name || '（未填）') + '</b></div>' +
          '<div class="v10-field"><i>用途</i><b style="flex:1">' + h.esc(labelOf(KIND_OPTS, form.kind)) + ' · ' + h.esc(form.biz) + '</b></div>' +
          '<div class="v10-field"><i>镜像</i><b style="flex:1">' + h.esc(im.name + ':' + im.version) +
            '<span class="muted" style="font-weight:400;margin-left:6px">' + h.esc(im.sizeText) + ' · ' + h.esc(im.scanText) + '</span></b></div>' +
          '<div class="v10-field"><i>隔离</i><b style="flex:1">' + h.esc(form.slevel + ' · ' + labelOf(REUSE_OPTS, form.reuse) + ' · ' + netText) +
            '<span class="muted" style="font-weight:400;margin-left:6px">运行时 ' + h.esc(rule ? rule.runtime : '—') + '</span></b></div>' +
          '<div class="v10-field"><i>规格</i><b style="flex:1">' + h.esc(form.spec) + '</b></div>';
      }
      return bar + '<div class="v10-sheet-b" style="padding-top:14px">' + body + '</div>';
    }
    /* 整块重画：换 step 时重渲染。监听器绑在 el（遮罩）上，不随 innerHTML 重建而丢失 */
    function paint(el) {
      el.innerHTML = '<div class="v10-sheet" style="width:min(620px,100%)"><div class="v10-sheet-h"><h3>创建沙盒</h3>' +
        '<button class="v10-sheet-x" data-c="x">×</button></div>' +
        wizHtml() +
        '<div class="v10-sheet-f"><button class="btn-ghost" data-c="back"' + (cur === 0 ? ' style="visibility:hidden"' : '') + '>上一步</button>' +
        '<button class="btn-primary" data-c="next">' + (cur < 3 ? '下一步' : '创建') + '</button></div></div>';
    }
    function build() {
      var el = global.document.createElement('div');
      el.className = 'v10-sheet-mask';
      paint(el);
      el.addEventListener('click', function (e) {
        var t = e.target;
        var c = t.getAttribute && t.getAttribute('data-c');
        var wv = t.getAttribute && t.getAttribute('data-wiz');
        if (wv) {
          var grp = t.getAttribute('data-wiz');
          if (grp === 'img') {
            /* 镜像：先记 form 再切高亮 */
            form.img = t.getAttribute('data-val');
            var all = el.querySelectorAll('.v10-img');
            for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
            t.classList.add('on');
          } else if (grp === 'kind' || grp === 'slevel' || grp === 'reuse' || grp === 'net') {
            /* 段选：值写回 form，高亮随之（重绘前先改 form，避免丢失） */
            form[grp] = t.getAttribute('data-val');
            var seg = t.parentNode.querySelectorAll('button');
            for (var j = 0; j < seg.length; j++) seg[j].classList.remove('on');
            t.classList.add('on');
          }
          return;
        }
        if (c === 'x' || (e.target === el)) { el.remove(); return; }
        if (c === 'back') { if (cur > 0) { cur--; paint(el); } return; }
        if (c === 'next') {
          if (cur === 0 && !String(form.name || '').trim()) {
            h.toast('请先填写沙盒名称', 'bad');
            return;
          }
          if (cur < 3) { cur++; paint(el); return; }
          el.remove();
          /* 建完必须**落地到列表**（此前只弹 toast，列表不动 —— 用户会以为没建成）。
             写进 state.sbxNew，由 sandboxPage 并入表格；草稿不计入 KPI 聚合。
             形状对齐 assets 表里的沙盒行，让列表/筛选/排序/操作都能正常处理它。 */
          var _im = imgOf(form.img);
          h.state.sbxNew = h.state.sbxNew || [];
          var _n = h.state.sbxNew.length + 1;
          h.state.sbxNew.push({
            id: 'sbx-new-' + _n,
            name: form.name || ('sbx-new-' + _n),
            kindText: labelOf(KIND_OPTS, form.kind),
            image: (_im.name || '—') + ':' + (_im.version || ''),
            biz: form.biz,
            status: 'idle', statusText: '已停止',
            sessions24h: 0, blocked: 0,
            /* 字段名与 assets 表的沙盒行对齐：列表按 sLevel/reuseMode 渲染「隔离 / 复用」列 */
            sLevel: form.slevel,
            reuseMode: form.reuse,
            reuseModeText: labelOf(REUSE_OPTS, form.reuse),
            netPolicyText: form.net === 'deny' ? '禁止出网' : '白名单',
            agentNames: null,
            usage: 0, spec: form.spec, concurrency: '0 / 6', expiresInDays: null,
            isNew: true
          });
          h.toast('已创建「' + h.esc(form.name || '未命名') + '」· ' + h.esc(form.slevel) + ' · ' + h.esc(form.spec) + '（仅本会话，已加入下方列表）', 'ok');
          h.navigate({}, { scroll: false });
        }
      });
      /* 输入类控件（input / select）走 input/change 事件写回 form —— 它们不冒泡成 data-wiz 点击
       * v20 修复：用 dataset 打标记做幂等绑定。原先每收到一次 DOM 变更就重新 addEventListener，
       * MutationObserver 会在每次切步时触发 ⇒ 监听器逐次叠加（4 步下来同一个 input 挂 5 个）。*/
      function syncInputs(root) {
        var bind = function (sel, ev, fn) {
          var e = root.querySelector(sel);
          if (!e) return;
          var flag = 'wizBound';
          if (e[flag]) return;
          e[flag] = 1;
          e.addEventListener(ev, fn);
        };
        bind('[data-wiz="name"]', 'input', function () { form.name = this.value; });
        bind('[data-wiz="biz"]', 'change', function () { form.biz = this.value; });
        bind('[data-wiz="spec"]', 'change', function () { form.spec = this.value; });
      }
      syncInputs(el);
      /* 只在弹层被移除时断开观察，避免节点留在内存里 */
      var mo = new global.MutationObserver(function () {
        if (!el.parentNode) { try { mo.disconnect(); } catch (e) {} return; }
        syncInputs(el);
      });
      mo.observe(el, { childList: true, subtree: true });
      global.document.body.appendChild(el);
    }
    build();
  };


  /* 导入沙盒：选镜像 → 起实例 */
  A['sbx-import'] = function (id, btn, h) {
    var images = imgRows(h);
    var el = global.document.createElement('div');
    el.className = 'v10-sheet-mask';
    el.innerHTML = '<div class="v10-sheet" style="width:min(560px,100%)"><div class="v10-sheet-h"><h3>导入沙盒</h3>' +
      '<button class="v10-sheet-x" data-c="x">×</button></div>' +
      '<div class="v10-sheet-b" style="padding-top:14px">' +
      '<div class="v10-sheet-desc">从已有镜像拉取一个实例。</div>' +
      '<div class="v10-img-grid" style="grid-template-columns:1fr;margin-top:10px">' +
      images.map(function (im) {
        return '<button class="v10-img" data-c="pick" data-id="' + h.esc(im.id) + '"><b>' + h.esc(im.name + ':' + im.version) + '</b>' +
          '<span style="margin-left:auto">' + h.esc(im.sizeText) + ' · ' + h.esc(im.scanText) + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="v10-sheet-f"><button class="btn-ghost" data-c="x">取消</button></div></div>';
    el.addEventListener('click', function (e) {
      var t = e.target;
      var c = t.getAttribute && t.getAttribute('data-c');
      if (c === 'x' || e.target === el) { el.remove(); return; }
      if (c === 'pick') {
        var im = imgRows(h).filter(function (x) { return x.id === t.getAttribute('data-id'); })[0];
        el.remove();
        h.dangerConfirm(h, {
          title: '从「' + (im ? im.name + ':' + im.version : '') + '」导入沙盒？',
          desc: '将拉取镜像并创建一个沙盒实例。',
          impacts: [
            { label: '镜像', value: im ? im.name + ':' + im.version + ' · ' + im.sizeText : '—' },
            { label: '扫描状态', value: im ? im.scanText : '—', tone: im && im.scan === 'warn' ? 'warn' : '' },
            { label: '隔离等级', value: '按用途自动判级' }
          ],
          confirmText: '导入', danger: false, perm: 'sandbox:create',
          onConfirm: function () { h.toast('沙盒已导入', 'ok'); }
        });
      }
    });
    global.document.body.appendChild(el);
  };

  /* 镜像视图：列表 + 拉取 */
  A['sbx-images'] = function (id, btn, h) {
    var images = imgRows(h);
    var el = global.document.createElement('div');
    el.className = 'v10-sheet-mask';
    el.innerHTML = '<div class="v10-sheet" style="width:min(680px,100%)"><div class="v10-sheet-h"><h3>沙盒镜像</h3>' +
      '<button class="v10-sheet-x" data-c="x">×</button></div>' +
      '<div class="v10-sheet-b" style="padding-top:14px">' +
      '<div class="tbl-wrap"><table class="bt"><thead><tr><th>镜像</th><th>版本</th><th class="ta-r">大小</th><th>扫描</th><th>用途</th><th class="ta-r">引用</th><th></th></tr></thead><tbody>' +
      images.map(function (im) {
        return '<tr><td class="mono">' + h.esc(im.name) + '</td><td>' + h.esc(im.version) + '</td>' +
          '<td class="ta-r mono">' + h.esc(im.sizeText) + '</td>' +
          '<td>' + h.pill(im.scan, im.scanText) + '</td><td>' + h.esc(im.kindText) + '</td>' +
          '<td class="ta-r">' + h.esc(String(im.refCount)) + '</td>' +
          '<td class="ta-r"><button class="btn-ghost sm" data-c="import" data-id="' + h.esc(im.id) + '">导入</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div class="v10-sheet-f"><button class="btn-ghost" data-c="x">关闭</button></div></div>';
    el.addEventListener('click', function (e) {
      var t = e.target;
      var c = t.getAttribute && t.getAttribute('data-c');
      if (c === 'x' || e.target === el) { el.remove(); return; }
      if (c === 'import') {
        var im = imgRows(h).filter(function (x) { return x.id === t.getAttribute('data-id'); })[0];
        el.remove();
        h.dangerConfirm(h, {
          title: '从「' + (im ? im.name + ':' + im.version : '') + '」导入沙盒？',
          desc: '将拉取镜像并创建一个沙盒实例。',
          impacts: [
            { label: '镜像', value: im ? im.name + ':' + im.version : '—' },
            { label: '扫描状态', value: im ? im.scanText : '—', tone: im && im.scan === 'warn' ? 'warn' : '' }
          ],
          confirmText: '导入', danger: false, perm: 'sandbox:create',
          onConfirm: function () { h.toast('沙盒已导入', 'ok'); }
        });
      }
    });
    global.document.body.appendChild(el);
  };

  /* 配置编辑：改规格 / 网络 / 复用模式（表单，提交弹「已保存」） */
  A['sbx-config-edit'] = function (id, btn, h) {
    var s = byId(h, id);
    if (!s) { h.toast('未找到该沙盒'); return; }
    var el = global.document.createElement('div');
    el.className = 'v10-sheet-mask';
    el.innerHTML = '<div class="v10-sheet" style="width:min(560px,100%)"><div class="v10-sheet-h"><h3>编辑配置 · ' + h.esc(sbxLabel(s)) + '</h3>' +
      '<button class="v10-sheet-x" data-c="x">×</button></div>' +
      '<div class="v10-sheet-b" style="padding-top:14px">' +
      field('资源规格', '<select data-c="spec"><option selected>' + h.esc(s.spec) + '</option><option>2C / 4G</option><option>4C / 8G</option><option>4C / 16G</option><option>8C / 32G / A10</option></select>') +
      field('网络策略', segHtml('net2', [['whitelist', '白名单'], ['deny', '禁止出网']], s.netPolicy)) +
      field('复用模式', segHtml('reuse2', [['auto', '按风险自动'], ['reuse', '常驻复用'], ['ephemeral', '用完即毁']], s.reuseMode || 'auto')) +
      field('执行超时', '<input data-c="timeout" value="30 min">') +
      '</div>' +
      '<div class="v10-sheet-f"><button class="btn-ghost" data-c="x">取消</button>' +
      '<button class="btn-primary" data-c="save">保存</button></div></div>';
    el.addEventListener('click', function (e) {
      var t = e.target;
      var c = t.getAttribute && t.getAttribute('data-c');
      if (c === 'x' || e.target === el) { el.remove(); return; }
      if (t.getAttribute && t.getAttribute('data-wiz')) {
        var seg = t.parentNode.querySelectorAll('button');
        for (var j = 0; j < seg.length; j++) seg[j].classList.remove('on');
        t.classList.add('on');
        return;
      }
      if (c === 'save') {
        el.remove();
        h.dangerConfirm(h, {
          title: '保存「' + sbxLabel(s) + '」的配置变更？',
          desc: '变更会影响之后新建的会话，不影响已运行的实例。',
          impacts: [
            { label: '沙盒', value: sbxLabel(s) + ' · ' + s.name + ' · ' + s.sLevel },
            { label: '变更范围', value: '资源规格 / 网络策略 / 复用模式', tone: 'warn' },
            { label: '影响', value: '运行中的会话不受影响，新会话按新配置' }
          ],
          confirmText: '保存', danger: true, perm: 'sandbox:config:write',
          onConfirm: function () { h.toast('配置已保存', 'ok'); }
        });
      }
    });
    global.document.body.appendChild(el);
  };


  function opMeta(h, s, op) {
    /* 确认层标题用可读名，令牌留在「实例」一行里 —— 用户要能对上自己刚点的那一行，
       但标题不应该是一个内部 pod 名。 */
    var label = sbxLabel(s);
    if (op === 'stop') return {
      title: '停止「' + label + '」？', desc: '停止后该沙盒不再接新任务。',
      impacts: [
        { label: '实例', value: label + ' · ' + s.name },
        { label: '在跑并发', value: String(s.concurrency).split('/')[0] + ' 个任务将被中断', tone: 'danger' },
        { label: '业务方', value: s.biz, tone: 'warn' },
        { label: '可回滚', value: '可重新启动，但被中断的任务不自动续跑', tone: 'warn' }
      ], confirmText: '停止', danger: true,
      audit: '停止沙盒'
    };
    if (op === 'restart') return {
      title: '重启「' + label + '」？', desc: '重启会清空 /tmp，未落盘的任务输出将丢失。',
      impacts: [
        { label: '实例', value: label + ' · ' + s.name },
        { label: '在跑并发', value: String(s.concurrency).split('/')[0] + ' 个任务将被中断', tone: 'danger' },
        { label: '文件系统', value: '/tmp 将被清空（策略：重启即清）', tone: 'warn' }
      ], confirmText: '重启', danger: true,
      audit: '重启沙盒'
    };
    if (op === 'destroy') return {
      title: '销毁「' + label + '」？', desc: '销毁不可撤销，实例配置与执行记录一并删除。',
      impacts: [
        { label: '实例', value: label + ' · ' + s.name + ' · ' + s.image, tone: 'danger' },
        { label: '将中断', value: String(s.concurrency).split('/')[0] + ' 个在跑任务 + ' + queueOf(h, s).length + ' 个排队任务', tone: 'danger' },
        { label: '下游影响', value: '引用方 ' + (h.app.refsOf ? h.app.refsOf(s.id).length : 0) + ' 处（含 Workflow / 策略）', tone: 'danger' },
        { label: '可回滚', value: '不可回滚', tone: 'danger' }
      ], confirmText: '确认销毁', danger: true,
      audit: '销毁沙盒'
    };
    return { title: '启动「' + label + '」？', desc: '启动后按配置的资源与网络策略开始接任务。',
      impacts: [
        { label: '实例', value: label + ' · ' + s.name },
        { label: '资源占用', value: s.spec + ' 计入平台资源池', tone: 'warn' },
        { label: '网络策略', value: s.netPolicyText }
      ], confirmText: '启动', danger: false, audit: '启动沙盒' };
  }

  function doOp(id, op, h) {
    var s = byId(h, id);
    if (!s) { h.toast('未找到该沙盒'); return; }
    var m = opMeta(h, s, op);
    h.dangerConfirm(h, {
      title: m.title, desc: m.desc, impacts: m.impacts, confirmText: m.confirmText, danger: m.danger,
      perm: op === 'destroy' ? 'sandbox:destroy' : 'sandbox:operate',
      auditImpact: m.impacts[1] ? (m.impacts[1].label + '：' + m.impacts[1].value) : '',
      onConfirm: function () {
        /* 🔴 此前这里**只有一句 toast、不写任何状态**（2026-10-12 修）。
           症状：点「停止」→ 确认层 → 提示"已提交" → 列表状态列仍是「运行中」，
           渲染逐字不变 ⇒ 用户以为没成功、重复操作（与画像/知识库/用户运营修过的是同一类"写入/读取脱节"）。
           现在把结果写进会话态 `state.sbxOps[id]`，列表/详情四处读端同读（见 opStatusOf）。 */
        h.state.sbxOps = h.state.sbxOps || {};
        h.state.sbxOps[id] = { op: op, at: '刚刚' };
        h.toast('已提交「' + h.esc(m.title.replace(/[「」]/g, '')) + '」（本会话态，刷新还原）');
        h.navigate({}, { scroll: false });
      }
    });
  }

  /* 会话态覆盖：把 op 映射到操作后的状态（status 用既有的 pill 色名，statusText 用界面既有叫法）。
     与列表筛选下拉、KPI、详情头同源 —— 一处定义、四处读。 */
  function opStatusOf(state, id) {
    var o = (state && state.sbxOps && state.sbxOps[id]) || null;
    if (!o) return null;
    if (o.op === 'stop') return { status: 'idle', statusText: '已停止' };
    if (o.op === 'start' || o.op === 'restart') return { status: 'ok', statusText: '运行中' };
    if (o.op === 'destroy') return { status: 'idle', statusText: '已销毁' };
    return null;
  }
  /* 给一行套上会话态覆盖（返回新对象，不污染数据层） */
  function withOpOverride(state, r) {
    var ov = opStatusOf(state, r.id);
    if (!ov) return r;
    var x = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) x[k] = r[k];
    x.status = ov.status; x.statusText = ov.statusText; x._opOverride = true;
    return x;
  }

  A['sbx-open'] = function (id, btn, h) { h.navigate({ agentId: id, objId: id, tab: null, objTab: null }); };
  A['sbx-back'] = function (id, btn, h) { h.navigate({ agentId: null, objId: null, tab: null, objTab: null }); };
  A['sbx-op'] = function (id, btn, h) { var p = String(id).split('|'); doOp(p[0], p[1], h); };

  A['sbx-kill'] = function (id, btn, h) {
    var p = String(id).split('|');
    h.dangerConfirm(h, {
      title: '强制结束进程 PID ' + p[1] + '？',
      desc: 'SIGKILL 立即终止，进程持有的临时数据会丢失。',
      impacts: [
        { label: '进程', value: 'PID ' + p[1], tone: 'danger' },
        { label: '所属沙盒', value: p[0] },
        { label: '影响', value: '该进程正在处理的任务将失败并进入重试队列', tone: 'warn' }
      ], confirmText: '结束进程', danger: true, perm: 'sandbox:process:kill', auditImpact: 'PID ' + p[1],
      onConfirm: function () { h.toast('已结束进程 PID ' + p[1]); }
    });
  };

  A['sbx-prio'] = function (id, btn, h) {
    var p = String(id).split('|');
    h.dangerConfirm(h, {
      title: '把 ' + p[1] + ' 提到 P0 优先？',
      desc: 'P0 任务会插到队列最前，后排队任务的等待时间将变长。',
      impacts: [
        { label: '任务', value: p[1] },
        { label: '抢占影响', value: '其他排队任务预计各延后 1~3 分钟', tone: 'warn' },
        { label: '业务方', value: '不变（P0 仅影响调度顺序）' }
      ], confirmText: '提优先级', danger: false, perm: 'sandbox:queue:write',
      onConfirm: function () { h.toast('已提交优先级调整'); }
    });
  };

  A['sbx-net'] = function (id, btn, h) {
    var p = String(id).split('|'), s = byId(h, p[0]);
    var tiers = ['禁止出网（最严格）', '白名单域名', '全开'];
    var t = tiers[Number(p[1])] || tiers[0];
    if (s && ((s.netPolicy === 'deny' && Number(p[1]) === 0) || (s.netPolicy === 'whitelist' && Number(p[1]) === 1))) {
      h.toast('已经是「' + t + '」档，无需变更');
      return;
    }
    h.dangerConfirm(h, {
      title: '把网络策略切到「' + t + '」？',
      desc: '放开网络会改变隔离边界，属于必须二次确认的变更。',
      impacts: [
        { label: '沙盒', value: p[0], tone: 'warn' },
        { label: '变更', value: s ? (s.netPolicyText + ' → ' + t) : t, tone: 'danger' },
        { label: '风险', value: '放开后该沙盒可外连非白名单地址，数据出境需合规校验', tone: 'danger' },
        { label: '流程', value: '提交后进入审批链路，通过前不生效', tone: 'warn' }
      ], confirmText: '提交变更', danger: true, perm: 'sandbox:network:write',
      onConfirm: function () {
        /* v19：承诺了「进入审批」就要真的建单 —— 写入 newObjs['approval']，审批队列立即可见 */
        try {
          var st = (global.APP_SHELL && global.APP_SHELL.state) || h.state || {};
          st.newObjs = st.newObjs || {};
          st.newObjs['approval'] = st.newObjs['approval'] || [];
          var nid = 'ap-sbx-' + (st.newObjs['approval'].length + 1) + '-' + Math.floor(Math.random() * 900 + 100);
          st.newObjs['approval'].push({
            id: nid, name: '沙盒 ' + p[0] + ' 网络策略变更', type: 'sandbox-net',
            targetId: p[0], affect: '1', rollback: '是'
          });
          if (global.V19GOV && global.V19GOV.auditDecide) {
            global.V19GOV.auditDecide({ decision: '上线', title: '沙盒 ' + p[0] + ' 网络策略变更', target: nid, reason: '网络档位切换：' + t });
          }
          h.toast('已建审批单 ' + nid + ' · 进入审批队列，通过前不生效', 'ok');
        } catch (e) {
          if (global.console) global.console.error('[v19-gov]', e);
          h.toast('网络策略变更已提交（建单失败，演示环境）');
        }
      }
    });
  };

  /* 复用模式：把"省钱还是干净"的选择权交给用户（默认按风险自动，可覆盖） */
  A['sbx-reuse'] = function (id, btn, h) {
    var parts = String(id).split('|'), s = byId(h, parts[0]), mode = parts[1];
    if (!s) { h.toast('未找到该沙盒'); return; }
    var LBL = h.app.reuseLabel || { reuse: '常驻复用', ephemeral: '用完即毁', auto: '按风险自动' };
    if ((s.reuseMode || 'auto') === mode) { h.toast('已经是「' + (LBL[mode] || mode) + '」模式'); return; }
    var eff = mode === 'auto' ? (h.app.resolveReuse ? h.app.resolveReuse('auto', s.sLevel) : 'reuse') : mode;
    var sessions = s.sessions24h || 0;
    var willNew = eff === 'ephemeral' ? sessions : 0;
    h.dangerConfirm(h, {
      title: '把「' + sbxLabel(s) + '」改成' + (LBL[mode] || mode) + '？',
      desc: '复用模式决定这个池是「省钱」还是「干净」——两者的成本与串味风险不同。',
      impacts: [
        { label: '沙盒', value: sbxLabel(s) + ' · ' + s.name + ' · ' + s.sLevel + ' · ' + s.biz },
        { label: '变更', value: (s.reuseModeText || '') + ' → ' + (LBL[mode] || mode) + '（实际 ' + (LBL[eff] || eff) + '）' },
        { label: '24h 影响', value: willNew ? (willNew + ' 次会话将各新建 1 个实例 —— 冷启动与成本上升') : ('省下约 ' + sessions + ' 次冷启动'), tone: willNew ? 'warn' : 'normal' },
        { label: '风险', value: mode === 'reuse' ? '任务间共享实例，上一位任务的残留可能串味' : '每次新建，隔离最干净', tone: mode === 'reuse' ? 'warn' : 'normal' },
        { label: '可回滚', value: '随时可改回，只影响之后的会话' }
      ],
      confirmText: '改模式', danger: true, perm: 'sandbox:policy:write',
      auditImpact: (LBL[mode] || mode) + '（实际 ' + (LBL[eff] || eff) + '）',
      onConfirm: function () {
        h.toast('复用模式已改为 ' + (LBL[mode] || mode));
      }
    });
  };

  A['sbx-ev'] = function (id, btn, h) {
    var rows = rowsOf(h);
    var detail = {
      '越权访问尝试': eventRowsOf(h).filter(function (e) { return e.policyDecision === 'syscall_denied'; }).map(function (e) {
        return e.sandboxName + '：' + e.action + ' ' + e.resource + ' 被拒（命中 ' + e.deniedSyscall + '，' + e.severityText + '）';
      }),
      '异常网络请求': eventRowsOf(h).filter(function (e) {
        return e.policyDecision === 'egress_denied' || e.policyDecision === 'metadata_denied';
      }).map(function (e) {
        return e.sandboxName + '：' + e.action + ' ' + e.resource + ' 出网被拒（' + e.severityText + '）';
      }),
      '资源超限被杀': eventRowsOf(h).filter(function (e) { return e.policyDecision === 'limit_enforced'; }).map(function (e) {
        return e.sandboxName + '：' + e.action + ' ' + e.resource + '（' + e.severityText + '）';
      }),
      '策略拒绝（Denied）': eventRowsOf(h).filter(function (e) { return e.policyDecision === 'tool_denied'; }).map(function (e) {
        return e.sandboxName + '：' + e.action + ' ' + e.resource + ' 未进入执行';
      })
    }[id] || [];
    h.dangerConfirm(h, {
      title: '「' + h.esc(id) + '」明细', desc: '按沙盒逐条列出',
      impacts: (detail.length ? detail : ['暂无记录']).slice(0, 8).map(function (t) { return { label: '明细', value: t }; }),
      confirmText: '知道了', danger: false, perm: 'sandbox:audit:read',
      onConfirm: function () { }
    });
  };

  A['sbx-sel'] = function (id, btn, h) {
    var cur = h.state.sbxSel || [], i = cur.indexOf(id);
    if (i > -1) cur.splice(i, 1); else cur.push(id);
    h.state.sbxSel = cur;
    h.navigate({}, { scroll: false });
  };
  A['sbx-all'] = function (id, btn, h) {
    var rows = rowsOf(h).map(function (r) { return r.id; });
    h.state.sbxSel = (h.state.sbxSel || []).length === rows.length ? [] : rows;
    h.navigate({}, { scroll: false });
  };
  A['sbx-bulk'] = function (id, btn, h) {
    var sel = h.state.sbxSel || [];
    if (id === 'clear') { h.state.sbxSel = []; h.navigate({}, { scroll: false }); return; }
    var tasks = 0, tokens = [], labels = [];
    sel.forEach(function (sid) {
      var s = byId(h, sid);
      if (!s) return;
      tokens.push(s.name);        /* 令牌：用于反查业务方（下面按 r.name 比对） */
      labels.push(sbxLabel(s));   /* 可读名：给用户看的那一份 */
      tasks += Number(String(s.concurrency).split('/')[0]) + queueOf(h, s).length;
    });
    var stop = id === 'stop';
    h.dangerConfirm(h, {
      title: (stop ? '批量停止 ' : '批量重启 ') + sel.length + ' 个沙盒？',
      desc: '批量操作不可逐个撤销，请确认影响面。',
      impacts: [
        { label: '选中实例', value: labels.join('、'), tone: 'danger' },
        { label: '将中断', value: tasks + ' 个在跑 / 排队任务', tone: 'danger' },
        { label: '涉及业务方', value: uniq(tokens.map(function (n) { var s = null; rowsOf(h).forEach(function (r) { if (r.name === n) s = r; }); return s ? s.biz : '—'; })).join('、'), tone: 'warn' },
        { label: '可回滚', value: stop ? '可重新启动；被中断任务不自动续跑' : '重启后 /tmp 清空', tone: 'warn' }
      ], confirmText: stop ? '批量停止' : '批量重启', danger: true, perm: 'sandbox:operate',
      auditImpact: sel.length + ' 个实例 / ' + tasks + ' 个任务',
      onConfirm: function () {
        h.state.sbxSel = [];
        h.toast('批量操作已提交');
        h.navigate({}, { scroll: false });
      }
    });
  };

  A['sbx-rm'] = function (id, btn, h) {
    var f = h.state.sbxFilter || {};
    delete f[id];
    h.state.sbxFilter = f;
    h.navigate({}, { scroll: false });
  };
  A['sbx-clear'] = function (id, btn, h) {
    h.state.sbxFilter = {};
    h.navigate({}, { scroll: false });
  };

  /* 表头排序：同一列再点一次反向；点别的列则默认降序（排障场景「最忙/最多」优先） */
  A['sbx-sort'] = function (id, btn, h) {
    var f = h.state.sbxFilter || {};
    f.sort = id;
    f.sortDir = (f.sort === id && f.sortDir === 'desc') ? 'asc' : 'desc';
    h.state.sbxFilter = f;
    h.navigate({}, { scroll: false });
  };

  /* 筛选控件：input / select 的委托（app.js 的通用委托只认 data-act，这里自己接） */
  if (global.document && !global.document.__sbxFilterBound) {
    global.document.__sbxFilterBound = true;
    function readFilters() {
      var f = {};
      var els = global.document.querySelectorAll('[data-sbx]');
      for (var i = 0; i < els.length; i++) {
        var k = els[i].getAttribute('data-sbx');
        if (els[i].value) f[k] = els[i].value;
      }
      return f;
    }
    var timer = null;
    global.document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || !t.getAttribute('data-sbx')) return;
      var f = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (!f) return;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        f.state.sbxFilter = readFilters();
        f.navigate({}, { scroll: false });
      }, 320);
    }, false);
  }
})(window);
