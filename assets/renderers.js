/* SECTION: renderers-core
 * 页面渲染器。所有数值一律来自 QUERY/FACTS 聚合，页面内不出现写死的业务数字。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS, C = global.CHARTS, APP = global.APP_DATA;
  var RENDERERS = {}, ACTIONS = {};
  var ASSETS = null, QUEUES = null, PIPES = null;
  function assets() { if (!ASSETS) ASSETS = APP.getAssetTables(); return ASSETS; }
  function queues() { if (!QUEUES) QUEUES = APP.getQueues(); return QUEUES; }
  function pipes() { if (!PIPES) PIPES = APP.getPipelines(); return PIPES; }

  /* SECTION: shared-page-head */
  function pageHead(h, cap, opts) {
    opts = opts || {};
    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + (opts.badge || '') + '</div>' +
      '<div class="ph-desc">' + h.esc(opts.desc || cap.desc) + '</div>' +
      '</div><div class="ph-side">' + (opts.side || '') +
      /* 默认动作是 create-open，不是 'demo'。这里 button 已经带了 data-create="cap.id"，
         能力自己的 action 也都是「新建 X」—— 默认值只能是 create-open。
         此前默认 'demo'（没人注册的 data-act），凡是调用方漏传 action 的页面，
         主按钮按下去都只会弹一句「演示环境：该操作不执行真实写操作」—— 假话。
         传 action:false 可显式不要主按钮（例如尚未实现的能力，不该给一个按不动的 CTA）。 */
      /* opts.actionText：主按钮文案可被调用方覆盖（不传就用 cap.action）。
         加它是因为「模拟用户」页的主按钮必须随模式 tab 变 ——
         舆情 tab 没有用户池、不选 persona，挂一个「新建 persona」是纯语义错位；
         而 cap.action 是能力级常量，改它会连带影响单人/多用户两个 tab。 */
      (cap.action && opts.action !== false ? '<button class="btn-primary" data-act="' + h.esc(opts.actionAct || opts.action || 'create-open') + '" data-create="' + h.esc(cap.id) + '" data-primary-action>' + h.esc(opts.actionText || cap.action) + '</button>' : '') +
      '</div></div>';
  }

  function tabBar(h, tabs, active) {
    return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button role="tab" class="tab' + (t.id === active ? ' on' : '') + '" data-tab="' + t.id + '"' +
        (t.badge ? ' data-badge="' + t.badge + '"' : '') + '>' + h.esc(t.label) +
        (t.badge ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* SECTION: r-overview
   * 工作台总览：待办聚合 + 健康指标 + 告警流水 + 运行中任务 + 快捷入口
   */
  /* SECTION: v15-agent-ops
   * Agent 发布/灰度/回滚的会话内状态读取（写入在 renderers2.js 的 ACTIONS 里）。
   * 仅内存态、刷新还原 —— 与既有 uo-ratio 同一做法，不引入新的持久化层。 */
  function agOv(state, id) { return (state && state.agOps && state.agOps[id]) || {}; }
  function agRatio(state, a) { var o = agOv(state, a.id); return o.ratio == null ? a.grayRatio : o.ratio; }
  function agOnline(state, a) { var o = agOv(state, a.id); return o.rollbackTo || a.online; }

  /* SECTION: v15-session-new
   * 本会话新建的对象（内存态，刷新还原；创建表单与动作在 renderers2.js）。
   * 只渲染成列表顶部一条独立区块，**不塞进 QUERY 的 rows** —— 免得污染「运行指标单出口」的口径
   * （KPI 说的是真实运行数据，新对象还没有任何运行数据）。 */
  function sessionRows(state, capId) { return (state && state.newObjs && state.newObjs[capId]) || []; }
  function sessionNewBlock(state, h, capId, opts) {
    var rows = sessionRows(state, capId);
    if (!rows.length) return '';
    opts = opts || {};
    var CFG = (global.V15_CREATE || {})[capId] || {};
    var label = opts.stateLabel || CFG.stateLabel || '草稿';
    return '<div class="card v15-newblock"><div class="card-h"><h3>' + h.esc(opts.title || '本会话新建') + '</h3>' +
      '<span class="card-sub">仅存于当前浏览器会话，刷新后还原</span></div>' +
      rows.map(function (o) {
        /* v17：允许调用方按单个对象覆盖状态标签/色调（如知识库发布后 草稿态 → 可用）；不传则维持原行为 */
        var lbl = (typeof opts.labelOf === 'function') ? (opts.labelOf(o) || label) : label;
        var kid = (typeof opts.kindOf === 'function') ? (opts.kindOf(o) || 'idle') : 'idle';
        return '<div class="v15-newrow">' +
          '<span class="v15-newdot"></span>' +
          '<b>' + h.esc(o.name) + '</b>' + h.pill(kid, lbl) +
          '<span class="v15-newmeta">' + h.esc(opts.cols ? opts.cols(o) : (o.meta || '')) + '</span>' +
          '<span class="v15-newacts">' +
          '<button class="lnk" data-act="new-obj-open" data-id="' + h.esc(capId) + '|' + h.esc(o.id) + '">继续配置 →</button>' +
          '<button class="lnk warn" data-act="new-obj-revoke" data-id="' + h.esc(capId) + '|' + h.esc(o.id) + '">撤销创建</button>' +
          '</span></div>';
      }).join('') + '</div>';
  }

  RENDERERS.overview = function (cap, state, h) {
    var fmt = h.fmt;
    // 跟随所选时间范围。此前硬编码 '24h'：选择器给了 5 档，
    // 用户选「近 30 天」看到的仍是 24 小时数据 —— 控件在说谎。
    var rg = state.range || '24h';
    var rgLabel = Q.RANGES[rg] ? Q.RANGES[rg].label : rg;
    var k24 = Q.kpi(rg);
    var k7 = Q.kpi('7d');
    var agents = Q.agentTable(rg);
    var todos = APP.getTodos();
    var ts = Q.timeseries(rg);

    /* --- ① 待办聚合 --- */
    var todoHtml = '<div class="card"><div class="card-h"><h3>待我处理</h3><span class="card-sub">' + todos.length + ' 类事项</span></div><div class="todo-list">';
    todos.forEach(function (t) {
      /* 🔴 C-1a（第1屏硬伤①）：此前只传 `t.target.cap` —— 点进去是**该页的默认列表**，
         而待办说的是"N 个审批待我处理"。**口径与落点不一致**，用户还要自己再筛一遍。
         改为传 `cap|todoId`：由 goto-todo 把该待办的**筛选语义**带到目标页。
         ⚠ 待办是**聚合数**（不存在"单个对象"），所以带的是**筛选条件**而不是对象 id。 */
      todoHtml += '<button class="todo-item ' + t.kindColor + '" data-act="goto-todo" data-id="' + h.esc(t.target.cap + '|' + t.id) + '">' +
        '<span class="todo-n">' + t.count + '</span>' +
        '<span class="todo-main"><b>' + h.esc(t.kind) + '</b><span>' + h.esc(t.text) + '</span></span>' +
        (t.urgent ? '<span class="todo-urgent">' + t.urgent + ' 紧急</span>' : '') +
        '</button>';
    });
    todoHtml += '</div></div>';

    /* --- ② 健康指标 --- */
    var sr = k24.successRate;
    /* 🔴 修复（阈值真源）：下面两条告警线此前**内联在本文件的这两张卡里**（0.99 / 4000），
       而 decisions.js「可观测.成功率_需关注 / 可观测.P99_告警」的登记项，来源栏写的就是这两处
       —— 总览判红与 Agent 工作台判红必须是同一条线，所以这里改为**引用真源**，不再内联字面量。
       真源取不到时**不臆造数字**：本屏不判红（宁可不标，也不偷偷退回一个可能与真源漂移的值）。 */
    var DECI = global.DECISIONS;
    var TH_SR = (DECI && DECI.value) ? DECI.value('可观测', '成功率_需关注') : null;
    var TH_P99 = (DECI && DECI.value) ? DECI.value('可观测', 'P99_告警') : null;
    /* 指标卡下钻参数的分段格式化：null / 非数字一律**留空段**，绝不把 'NaN' / 'undefined' 写进 data-id。
       dp 为 null ⇒ 原样输出（阈值 0.99 就是 '0.99'，不能被四舍五入成 '1'）。 */
    function numSeg(v, dp) {
      if (v == null || typeof v !== 'number' || !isFinite(v)) return '';
      if (dp == null) return String(v);
      return dp > 0 ? v.toFixed(dp) : String(Math.round(v));
    }
    /* 阈值**文案**也必须来自同一份真源：卡片判红用 TH_SR / TH_P99，卡头副标题若另手写一份
       「99% / 4s」，改了 decisions.js 之后两边就会互相打架（本批修的就是这类"同一根线两处写"）。
       单位换算：P99 真源单位是 **ms（4000）**，界面上要显示成 **4s** ⇒ 必须 ÷1000，
       不能把毫秒数直接当秒写成 "4000s"；换算后去掉多余的 .0（4 而不是 4.0），非整数毫秒保留一位（1500 → 1.5s）。 */
    function secText(ms) { return (Math.round((ms / 1000) * 10) / 10) + 's'; }
    function pctText(ratio) { return (Math.round(ratio * 10000) / 100) + '%'; }
    var healthCards = [
      { label: rgLabel + '调用量', value: fmt.compact(k24.calls), deltaHtml: fmt.delta(k24.compare.calls), definition: k24.meta.definitions.calls, sub: '近 7 天 ' + fmt.compact(k7.calls) },
      { label: '成功率', value: fmt.pct2(sr), alert: TH_SR != null && sr != null && sr < TH_SR, deltaHtml: fmt.delta(k24.compare.successRate, { pp: true }), definition: k24.meta.definitions.successRate, sub: '失败 ' + fmt.int(k24.fails) + ' 次' },
      { label: 'P99 时延', value: fmt.dur(k24.p99), alert: TH_P99 != null && k24.p99 != null && k24.p99 > TH_P99, deltaHtml: fmt.delta(k24.compare.p99, { higherIsBetter: false }), definition: k24.meta.definitions.p99, sub: 'P50 ' + fmt.dur(k24.p50) },
      { label: rgLabel + '成本', value: fmt.money(k24.cost), deltaHtml: fmt.delta(k24.compare.cost, { higherIsBetter: false }), definition: k24.meta.definitions.cost, sub: '重试浪费 ' + fmt.money2(k24.retryWaste) },
      { label: 'token 消耗', value: fmt.compact(k24.tokens), deltaHtml: '', sub: '入 ' + fmt.compact(k24.tokIn) + ' / 出 ' + fmt.compact(k24.tokOut) }
    ].map(function (m, i) {
      /* C-1b：异常指标卡可点下钻 —— 把「这个数不正常」接到「哪些对象不正常」。 */
      /* 🔴 修复（下钻参数）：此前 m.actId 只传**字段名**（'calls' / 'successRate' / 'p99' / 'cost' / 'tokens'），
         目标页据此筛不出「受影响对象清单」—— 既不知道"这个数是多少"，也不知道"该跟哪条线比"，
         只能退回该页默认列表，口径与落点又一次不一致。
         现按本仓既有 `a|b` 分段惯例（如 renderers2.js 的 data-id="a|b"）扩成四段：
             <指标>|<当前值>|<阈值>|<口径范围>
           · 当前值：一律取 k24 / sr 的**真实聚合值**（不另造数字；null 留空段）
           · 阈值  ：只认 decisions.js 这一份真源（成功率 / P99）。该卡在真源里没有对应阈值的，
                     **段留空** —— 目标页见空段就按"按值排序取前 N"处理，不要自己编一条线；
                     阈值原样输出（'0.99' 不能变成 '1'）
           · 末段  ：本屏当前时间范围标签，下钻清单必须与卡片同口径（否则又是一个"控件在说谎"）
         例：successRate|0.9895|0.99|近 24 小时    calls|120453||近 24 小时
         ⚠ 只改 data-id 的**内容**：动作名仍是 goto-drill、data-act 不变（注册在别的文件里，本文件不注册动作）。 */
      var drill = [
        { id: 'calls' },
        { id: 'successRate', when: m.alert },
        { id: 'p99', when: m.alert },
        { id: 'cost' },
        { id: 'tokens' }
      ][i];
      if (drill && (drill.when === undefined || drill.when)) {
        /* 当前值与真源阈值按下标取，避免在每个卡对象里重复写一遍字段名 */
        var DEC_OF = { calls: 0, successRate: 4, p99: 0, cost: 2, tokens: 0 };
        var MV = [
          { v: k24.calls, th: null },
          { v: sr, th: TH_SR },
          { v: k24.p99, th: TH_P99 },
          { v: k24.cost, th: null },
          { v: k24.tokens, th: null }
        ][i] || { v: null, th: null };
        m.act = 'goto-drill';
        m.actId = drill.id + '|' + numSeg(MV.v, DEC_OF[drill.id]) + '|' + numSeg(MV.th, null) + '|' + rgLabel;
        m.actTitle = '下钻：查看该指标受影响的对象清单';
      }
      return h.metricCard(m);
    }).join('');

    /* --- ③ 告警流水 --- */
    var incHtml = '<div class="card"><div class="card-h"><h3>近 30 天事故</h3><span class="card-sub">点击看影响与根因</span></div><div class="inc-list">';
    S.INCIDENTS.slice().reverse().forEach(function (inc) {
      var impact = Q.incidentImpact(inc);
      /* 🔴 修复（HTML 内容模型，与 app.js metricCard 同一类问题）：
         此前这里是 <button class="inc-item"> 里面又放 <button>（确认知悉 / 关闭并复盘 / 看根因）
         —— 交互内容模型**不允许嵌套 button**，解析器会把内层按钮**提出去**：
         实测 .inc-acts 变成空 <span>，两个按钮被甩成 .inc-item 的兄弟节点
         （所以它们看起来"掉到标题下面"）。改为 div[role=button]，
         行点击看影响/根因仍然成立，行内按钮回到 .inc-acts 里。 */
      incHtml += '<div class="inc-item lv-' + inc.level + '" role="button" tabindex="0" data-act="show-incident" data-id="' + inc.id + '">' +
        '<span class="inc-lv">' + inc.level + '</span>' +
        '<span class="inc-main"><b>' + h.esc(inc.title) + '</b>' +
        '<span>' + h.esc(F.fmtDate(S.TODAY_START + inc.dayOffset * S.DAY)) + ' ' + inc.hourStart + ':00–' + inc.hourEnd + ':59 · ' +
        '期间成功率 ' + fmt.pct2(impact.during.successRate) + '（事前 ' + fmt.pct2(impact.before.successRate) + '）</span></span>' +
        (function () {
          /* C-1c：状态**从数据算**，不再写死为"已恢复"。
             开放事件给真动作（ack / 关闭），已恢复的只留"看根因"。
             🔴 修复（控件在说谎）：此前 `closed` 被**并进** resolved ——
                `st = (inc.resolvedAt != null || closed) ? 'resolved' : (ack ? 'ack' : 'open')`。
                后果①：用户点「关闭并复盘」，这条事故在界面上就显示成**「已恢复」**；
                后果②（更糟）：本就没恢复的事故（resolvedAt == null，如进行中的 P1）
                也会因为一次"关闭"动作被说成"已恢复"。
                「关闭并复盘」是**处置动作**，「已恢复」是**数据事实** —— 两者不是一回事，不能互相顶替。
             现在拆成四档，各自如实：
                resolved  数据层 resolvedAt != null → 已恢复          （真实恢复 · 色阶 ok）
                closed    人工关闭并复盘（本会话态） → 已关闭 · 已复盘  （色阶 idle，**不出现"恢复"字样**）
                ack       已确认知悉（本会话态）     → 已知悉·处理中    （色阶 warn）
                open      无任何处置                → 未处理          （色阶 bad）
             样式沿用本仓既有 pill 色阶（h.pill 的 ok/idle/warn/bad ⇒ .pill.* 规则），不新增 CSS。 */
          var ack = (h.state.incAck || {})[inc.id];
          var closed = (h.state.incClosed || {})[inc.id];
          var st = inc.resolvedAt != null ? 'resolved' : (closed ? 'closed' : (ack ? 'ack' : 'open'));
          var ST = {
            resolved: { label: '已恢复', tone: 'ok' },
            closed: { label: '已关闭 · 已复盘', tone: 'idle' },
            ack: { label: '已知悉·处理中', tone: 'warn' },
            open: { label: '未处理', tone: 'bad' }
          }[st];
          /* 动作：已恢复 / 已关闭都只留只读的「看根因」—— 已关闭的不该再给「关闭并复盘」，
             点下去什么都不会变，那还是一个假动作。 */
          var acts = (st === 'resolved' || st === 'closed')
            ? '<button class="btn-ghost sm" data-act="show-incident" data-id="' + inc.id + '">看根因</button>'
            : (st === 'open'
              ? '<button class="btn-ghost sm" data-act="inc-ack" data-id="' + inc.id + '">确认知悉</button>' +
                '<button class="btn-primary sm" data-act="inc-close" data-id="' + inc.id + '">关闭并复盘</button>'
              : '<button class="btn-primary sm" data-act="inc-close" data-id="' + inc.id + '">关闭并复盘</button>');
          /* .inc-state 保留为外层：它只有 flex:0 0 auto / font-size 两条既有规则，
             用它维持本行布局不变；色与文案都在内层 pill 上（不新增 CSS）。 */
          return '<span class="inc-state">' + h.pill(ST.tone, ST.label) + '</span>' +
            '<span class="inc-acts">' + acts + '</span>';
        })() + '</div>';
    });
    incHtml += '</div></div>';

    /* --- ④ 运行中任务 --- */
    /* 🔴 此前这里是**纯 <div>，零动作** —— 而总览是全站唯一允许的看板，
       判据是「每块要么可点要么是证据」，纯摆设不允许。
       改为同款可点条目：进化任务 → 自进化控制台。
       2026-10-20：Workflow 一页下线，原「流程 → 该 Workflow 详情」那三条条目一并删除；
       本块现在只列进化任务，仍是可点条目，判据不变。 */
    var evs = pipes().evolution.items;
    var runHtml = '<div class="card"><div class="card-h"><h3>运行中任务</h3>' +
      '<div class="ab-list">';
    evs.forEach(function (e) {
      var st = e.stages.filter(function (s) { return s.state === 'active'; })[0];
      runHtml += '<button class="ab-item" data-act="goto-cap" data-id="evo">' +
        '<span class="ab-why">进化</span><b>' + h.esc(e.name) + '</b>' +
        '<span>' + h.esc(st ? st.name + '：' + st.detail : e.statusText) + '</span>' +
        '<span class="ab-go">去控制台 →</span></button>';
    });
    runHtml += '</div></div>';

    /* --- ⑤ 异常 Agent --- */
    var abnormal = agents.rows.filter(function (a) { return a.abnormal; });
    /* 卡头副标题「阈值：成功率 < 99% 或 P99 > 4s」此前是内联字面量 —— 与上面卡片判红用的
       TH_SR / TH_P99 是同一根线，必须是同一份来源（decisions.js 可观测域）。 */
    var abTh = (TH_SR != null && TH_P99 != null)
      ? '阈值：成功率 &lt; ' + pctText(TH_SR) + ' 或 P99 &gt; ' + secText(TH_P99)
      : '阈值未在 decisions.js 登记（可观测.成功率_需关注 / 可观测.P99_告警）';
    var abHtml = '';
    if (abnormal.length) {
      abHtml = '<div class="card"><div class="card-h"><h3>需关注的 Agent</h3><span class="card-sub">' + abTh + '</span></div>' +
        '<div class="ab-list">' + abnormal.map(function (a) {
          return '<button class="ab-item" data-act="goto-agent" data-id="' + a.id + '">' +
            '<b>' + h.esc(a.name) + '</b><span class="ab-ver">' + h.esc(a.version) + '</span>' +
            '<span class="ab-why ' + (a.severity === 'bad' ? 'bad' : 'warn') + '">' + h.esc(a.abnormalReasons.join('；')) + '</span>' +
            '<span class="ab-go">查看监控 →</span></button>';
        }).join('') + '</div></div>';
    }

    /* --- ⑥ 快捷入口 --- */
    /* 2026-10-21：审批下线，快捷入口换成「账号与 Agent 权限」（一个人真正天天要看的是 Agent 能干什么） */
    var quick = ['agent-wb', 'obs', 'cost', 'compliance', 'assets'];
    var quickHtml = '<div class="card"><div class="card-h"><h3>快捷入口</h3></div><div class="quick-grid">' +
      quick.map(function (id) {
        var c = h.capById(id);
        return '<button class="quick-item" data-act="goto-cap" data-id="' + id + '">' + h.icon(c.icon, 20) + '<span>' + h.esc(c.name) + '</span></button>';
      }).join('') + '</div></div>';

    /* ============ 总览屏重排（2026-10-12）============
       旧排法把六块（待办/健康/事故/运行中/需关注/快捷）丢进同一个 2 列网格 ⇒ **全部同权**，
       用户看不出先干什么（实测 14 卡 · 6 KPI · 13 待办 · 30 按钮）。
       新排法分三层，**信息一个不丢**：
         ① 焦点区（全宽）：「待我处理」—— 这一屏唯一要用户动手的事
         ② 健康带（一行）：5 个只读指标压成一条，不再占一整块卡
         ③ 折叠区（原生 <details>，键盘可达）：事故 / 运行中 / 需关注 / 快捷
       判红条件与阈值仍取自 decisions.js 真源（TH_SR / TH_P99），未改动。 */
    var todoTotal = todos.reduce(function (n, t) { return n + (t.count || 0); }, 0);
    var todoUrgent = todos.filter(function (t) { return t.urgent; }).length;
    var focusCard =
      '<div class="card"><div class="card-h"><h3>待我处理</h3>' +
      '<span class="card-sub">' + todos.length + ' 类 · 合计 ' + todoTotal + ' 件' +
      (todoUrgent ? ' · <b class="bad">' + todoUrgent + ' 类紧急</b>' : '') + '</span></div>' +
      '<div class="todo-list">' +
      todos.map(function (t) {
        return '<button class="todo-item ' + t.kindColor + '" data-act="goto-todo" data-id="' + h.esc(t.target.cap + '|' + t.id) + '">' +
          '<span class="todo-n">' + t.count + '</span>' +
          '<span class="todo-main"><b>' + h.esc(t.kind) + '</b><span>' + h.esc(t.text) + '</span></span>' +
          (t.urgent ? '<span class="todo-urgent">' + t.urgent + ' 紧急</span>' : '') +
          '</button>';
      }).join('') + '</div></div>';

    /* 健康带：把 5 张 KPI 卡压成一行「标签 数值 副注」；判红沿用同一份真源，样式从整卡红框降为数值变红
       （原 .metric-alert 是卡片级红框，一屏多个红框会造成告警疲劳；这里只在异常的那个数上标红）。
       ⚠ **下钻必须保留**：旧版这 5 张卡都能点（data-act="goto-drill"，四段 data-id
       `<指标>|<当前值>|<阈值>|<口径范围>`）。压成一行条后仍逐项可点 —— 重排不能减功能。
       阈值只认 decisions.js 真源（成功率为 TH_SR、P99 为 TH_P99），真源取不到就留空段，不臆造。 */
    var stripSrc = [
      { id: 'calls', label: rgLabel + '调用量', value: fmt.compact(k24.calls), sub: '近 7 天 ' + fmt.compact(k7.calls), v: k24.calls, th: null, dp: 0 },
      { id: 'successRate', label: '成功率', value: fmt.pct2(sr), sub: '失败 ' + fmt.int(k24.fails) + ' 次', v: sr, th: TH_SR, dp: 4, alert: TH_SR != null && sr != null && sr < TH_SR },
      { id: 'p99', label: 'P99 时延', value: fmt.dur(k24.p99), sub: 'P50 ' + fmt.dur(k24.p50), v: k24.p99, th: TH_P99, dp: 0, alert: TH_P99 != null && k24.p99 != null && k24.p99 > TH_P99 },
      { id: 'cost', label: rgLabel + '成本', value: fmt.money(k24.cost), sub: '重试浪费 ' + fmt.money2(k24.retryWaste), v: k24.cost, th: null, dp: 2 },
      { id: 'tokens', label: 'token 消耗', value: fmt.compact(k24.tokens), sub: '入 ' + fmt.compact(k24.tokIn) + ' / 出 ' + fmt.compact(k24.tokOut), v: k24.tokens, th: null, dp: 0 }
    ];
    var stripHtml = '<div class="ov-strip">' + stripSrc.map(function (c) {
      /* 与旧版完全相同的四段下钻参数；例外口径：successRate/p99 只有在**判红**时才给下钻
         （旧版 `when: m.alert` 就是这个语义 —— 正常值点进去没有"受影响对象"可看）。 */
      var canDrill = (c.id === 'successRate' || c.id === 'p99') ? !!c.alert : true;
      var inner = h.esc(c.label) + ' <b' + (c.alert ? ' class="alert"' : '') + '>' + h.esc(c.value) + '</b>' +
        ' <span class="sub">' + h.esc(c.sub) + '</span>';
      if (!canDrill) return '<span class="ov-strip-k">' + inner + '</span>';
      var did = c.id + '|' + numSeg(c.v, c.dp) + '|' + numSeg(c.th, null) + '|' + rgLabel;
      return '<button class="ov-strip-k as-link" data-act="goto-drill" data-id="' + h.esc(did) + '" ' +
        'title="下钻：查看该指标受影响的对象清单">' + inner + '</button>';
    }).join('') +
      '<span class="tail">' + h.esc(Q.freshness().text) + ' · 只读，可下钻</span></div>';

    /* 折叠标签上的数字：让收起状态也能看出"里面有多少事" */
    var foldN = [];
    if (S.INCIDENTS.length) foldN.push('事故 ' + S.INCIDENTS.length + ' 起');
    if (runHtml) foldN.push('运行中任务');
    if (abHtml) foldN.push('需关注的 Agent');
    var foldHtml = '<details class="ov-fold"><summary>其他信息' +
      (foldN.length ? '　<span class="n">' + h.esc(foldN.join(' · ')) + '</span>' : '') +
      '</summary><div class="ov-fold-body"><div class="ov-grid">' +
      incHtml + runHtml + abHtml + quickHtml +
      '</div></div></details>';

    /* v10b（Top12#4）：总览重排 —— 旧顺序 todo → 健康(span2) → inc → … 在 CSS Grid
       sparse 自动放置下，span2 卡放不进 row1 右列会把游标推过它，右列整行留白
       （实测首屏右半 ~45% 纯背景，门面页信息密度砍半）。
       ⚠ 本轮再次重排（见上）：放弃"六块同权"，改为焦点区 + 健康带 + 折叠区。
       密度不降（六块内容全在），但**主次建立起来** —— 这一屏先回答"现在要我干什么"。 */
    return pageHead(h, cap, {
      desc: '今日待办、系统健康与运行中任务的统一入口',
      side: h.rangePicker(rg)
    }) +
      '<div class="ov-focus' + (todoUrgent ? ' crit' : '') + '">' + focusCard + '</div>' +
      stripHtml +
      foldHtml +
      /* 只读声明（数据静态块判据）：趋势图本身没有可下钻的**对象**维度
         （它画的是全站调用量与成功率的时序，不是某一批对象），所以本卡不给动作 ——
         如实声明 data-static="1" + 一句理由，而不是挂一个点了也不知道去哪的空出口。
         想下钻的路径已经在同屏别处：上方指标卡 → goto-drill（受影响对象清单）。 */
      '<div class="card" data-static="1" title="只读说明：曲线由时序聚合直接绘制，本卡没有可下钻维度；时间范围由上方选择器控制。"><div class="card-h"><h3>调用量与成功率（' + h.esc(rgLabel) + '，只读）</h3>' +
      '<span class="card-sub">灰底为事故区间，绿虚线为发布事件</span></div>' +
      C.lineChart(ts.points, { granularity: ts.granularity, incidents: ts.meta.incidents, deploys: ts.meta.deploys, showP99: false }) +
      '<div class="bt-note">只读视图：曲线由时序聚合直接绘制，趋势图没有可下钻的对象维度 ⇒ 本卡无动作；要看明细请用上方指标卡下钻，或到「可观测与评估」按 trace 检索。</div>' +
      '</div>' +
      /* 总览是全站入口屏，此前是**唯一没有任何 meta-bar 的页面**（34 个数字裸陈）。
         下面三条各自回答一个追问：数字哪来的 / 时间戳是什么意思 / 哪些块只作展示。
         「数据截至」「数据集」两行由 h.metaBar 自动追加，这里不重复写（app.js 的 metaBar）。 */
      h.metaBar(k24.meta, [
        { k: '对比区间', v: '环比对比 ' + fmt.date(k24.compare.prevRange.from) + ' ~ ' + fmt.date(k24.compare.prevRange.to - 1) + '（上一等长周期）' },
        { k: '数据集与生成方式', v: '确定性种子生成的模拟数据集（' + Q.freshness().dataset + '，主随机流种子 aiops-dataset-v1，见 seed.js）；同一 seed 每次刷新产出的数字完全一致 —— 本屏每个数都可复现，不是随机占位' },
        { k: '新鲜度语义', v: '「数据截至」按本机时钟锚定（seed.js 的 NOW = new Date()），不是真实采集：' + Q.freshness().delayNote + '。换台机器或换一天打开，时间戳跟着变、数值序列不变' },
        { k: '只读边界', v: '「系统健康」指标与「调用量与成功率」趋势图只作展示：可下钻查看受影响对象，但没有任何写入口（改指标、改阈值、改标注都不在本屏）。本屏动作只有「跳转 / 下钻 / 看事故影响」与事故的「确认知悉 / 关闭并复盘」' },
        { k: '阈值来源', v: '成功率与 P99 的告警线取自 decisions.js（可观测.成功率_需关注 = ' + TH_SR + '、可观测.P99_告警 = ' + TH_P99 + ' ms），卡片下钻带上与卡片同口径的时间范围，目标页据此筛受影响对象' }
      ]);
  };

  /* SECTION: r-agent-list */
  RENDERERS.agentList = function (cap, state, h) {
    var fmt = h.fmt;
    var res = Q.agentTable(state.range);
    var rows = res.rows;
    var view = state.agentView || 'card';
    /* v24：Agent 工作台拆成两页 —— 「Agent 列表」（本页原有内容）与「网状关系」
       （渲染器在 v24-agent-net.js，Tab 条也由它提供 —— 它要算隔离数画角标）。
       屏内 Tab 状态存 state.agentPageTab，并写进 URL 的 ?net=1：
       agent-wb 的路径首段已经被 agentId 占着，屏内 Tab 不能再占路径段 ——
       否则 #/platform/agent-wb/net 会被 app.js 解析成 agentId='net'，
       落到「Agent 不存在」的空详情页（见 app.js 的 capQuery / hydrateFromQuery）。 */
    var page = (state && state.agentPageTab === 'net' && RENDERERS.agentNet) ? 'net' : 'list';
    var tabs = (global.UI && global.UI.agentWbTabs) ? global.UI.agentWbTabs(h, page) : '';

    var cards = '<div class="agent-grid">' + rows.map(function (a) {
      /* 2026-10-20：颜色分两档 —— bad（<97% 或 P99>8s）标红「异常」，其余异常标琥珀「观察」。
         计数口径没动（仍是 <99% 算需关注），只让红色重新变得稀少。 */
      var stKind = a.status === 'offline' ? 'idle' : (a.abnormal ? (a.severity === 'bad' ? 'bad' : 'warn') : (a.status === 'gray' ? 'info' : 'ok'));
      var stText = a.status === 'offline' ? '已下线' : (a.abnormal ? (a.severity === 'bad' ? '异常' : '观察') : (a.status === 'gray' ? '灰度 ' + Math.round(a.grayRatio * 100) + '%' : '运行中'));
      return '<article class="ag-card' + (a.severity === 'bad' ? ' ag-alert' : '') + '" data-act="goto-agent" data-id="' + a.id + '" tabindex="0" role="button">' +
        '<header><span class="ag-ico">' + h.icon('bot', 18) + '</span>' +
        '<span class="ag-name">' + h.esc(a.name) + '</span>' + h.pill(stKind, stText) + '</header>' +
        '<p class="ag-desc">' + h.esc(a.desc) + '</p>' +
        '<div class="ag-meta"><span>' + h.esc(a.version) + (a.grayVersion ? ' <em class="ag-gray">灰度 ' + h.esc(a.grayVersion) + ' ' + Math.round(a.grayRatio * 100) + '%</em>' : '') + '</span>' +
        '<span>' + ((S.nameOf && S.nameOf(a.owner)) ? h.esc(S.nameOf(a.owner)) + ' · ' : '') + h.esc(a.bizName) + '</span></div>' +
        '<div class="ag-kpi">' +
        '<span><i>调用</i><b>' + fmt.compact(a.calls) + '</b></span>' +
        '<span><i>成功率</i><b class="' + (a.successRate < 0.99 ? 'bad' : '') + '">' + fmt.pct2(a.successRate) + '</b></span>' +
        '<span><i>P99</i><b class="' + (a.p99 > 4000 ? 'bad' : '') + '">' + fmt.dur(a.p99) + '</b></span>' +
        '<span class="ag-spark">' + C.sparkline(a.spark, { abnormal: a.abnormal }) + '</span>' +
        '</div>' +
        /* 2026-10-21：底行由「阈值判决」换成「Agent 事件 · 此刻在做什么」。
           判决文字移到 title（悬停可见），红数字仍标在成功率/P99 上，信息没丢。 */
        (a.now ? '<div class="ag-ev" title="' +
          h.esc(a.abnormal ? a.abnormalReasons.join('；') : a.now.text) + '">' +
          '<span class="ag-ev-dot ' + a.now.kind + '"></span>' +
          '<span class="ag-ev-t">' + h.esc(a.now.text) + '</span>' +
          (a.now.ms != null ? '<span class="ag-ev-t2">' + fmt.dur(a.now.ms) + '</span>' : '') +
          '</div>' : '') +
        (a.status === 'offline' ? '<div class="ag-off">已于 ' + h.esc(a.retiredAt) + ' 下线，历史数据保留</div>' : '') +
        '</article>';
    }).join('') + '</div>';

    var tbl = h.table({
      columns: [
        { key: 'name', label: 'Agent', sortable: true, render: function (r) { return '<button class="lnk" data-act="goto-agent" data-id="' + r.id + '">' + h.esc(r.name) + '</button>' + (r.grayVersion ? ' <em class="tag-mini">灰度 ' + Math.round(r.grayRatio * 100) + '%</em>' : ''); } },
        { key: 'version', label: '线上版本' },
        { key: 'bizName', label: '业务线', sortable: true },
        { key: 'owner', label: '负责人', sortable: true },
        { key: 'calls', label: '调用量', sortable: true, align: 'right', fmt: 'int' },
        { key: 'successRate', label: '成功率', sortable: true, align: 'right', fmt: 'pct2', render: function (r) { return '<span class="' + (r.successRate < 0.99 ? 'bad' : '') + '">' + fmt.pct2(r.successRate) + '</span>'; } },
        { key: 'p99', label: 'P99', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.p99 > 4000 ? 'bad' : '') + '">' + fmt.dur(r.p99) + '</span>'; } },
        { key: 'cost', label: '成本', sortable: true, align: 'right', fmt: 'money' },
        { key: 'spark', label: '7 日趋势', render: function (r) { return C.sparkline(r.spark, { abnormal: r.abnormal }); } },
        { key: 'statusText', label: '状态', render: function (r) { return h.pill(r.status === 'offline' ? 'idle' : (r.abnormal ? 'bad' : (r.status === 'gray' ? 'info' : 'ok')), r.status === 'offline' ? '已下线' : (r.abnormal ? '需关注' : (r.status === 'gray' ? '灰度中' : '运行中'))); } }
      ],
      rows: rows, sortBy: state.sortKey, sortDir: state.sortDir, page: state.page, pageSize: 20,
      rowAction: 'agent', rowIdKey: 'id',
      emptyTitle: '没有符合条件的 Agent', emptySub: '调整筛选条件或创建新的 Agent'
    });

    /* v15（批 3-A）：主按钮接真创建表单 —— 之前点「创建 Agent」只弹一句「已提交」，
       中台连一个 Agent 都建不出来。 */
    var newBlock = sessionNewBlock(state, h, 'agent-wb', {
      title: '本会话新建的 Agent',
      cols: function (o) {
        return (o.modelName || o.model) + ' · ' + (o.bizName || o.biz) + ' · ' + (o.ownerName || o.owner) + (o.level ? ' · ' + o.level : '');
      }
    });

    /* 网状关系页：页头保留主按钮（两个 Tab 是同一屏的两页，「创建 Agent」到哪一页都成立），
       但不放卡片/表格切换与时间范围 —— 关系是配置态事实，与时间范围无关（口径写在页脚 metaBar 里）。
       ⚠ action 必须显式传：pageHead 的默认值是 'demo'，那是个没人注册的 data-act，
       按下去只会弹一句兜底 toast —— 就是本项目一直在清的「死按钮」。 */
    if (page === 'net') {
      return pageHead(h, cap, { action: 'create-open' }) + tabs + RENDERERS.agentNet(cap, state, h);
    }

    return pageHead(h, cap, {
      action: 'create-open',
      side: '<div class="view-sw" role="group">' +
        '<button class="vs-btn' + (view === 'card' ? ' on' : '') + '" data-act="agent-view" data-id="card">卡片</button>' +
        '<button class="vs-btn' + (view === 'table' ? ' on' : '') + '" data-act="agent-view" data-id="table">表格</button></div>' +
        h.rangePicker(state.range)
    }) + tabs + newBlock +
      (view === 'card' ? cards : '<div class="card pad0">' + tbl + '</div>') +
      h.metaBar(res.meta, [
        { k: '事件行', v: '卡片底行是这个 Agent 当前小时最后一条调用的事件：正常显示「正在处理 意图 · 客户分群」，失败显示「重试中 意图 · 失败原因」，右侧是该次调用耗时；没有调用则显示空闲。悬停卡片底行可见该 Agent 的阈值判定' },
        { k: '异常判定', v: '成功率 < 99% 或 P99 > 4s 标记为「需关注」（数字标红、状态标观察/异常）；阈值可在告警规则中调整' },
        { k: '趋势口径', v: '卡片 sparkline 为近 7 个自然日的调用量，与上方所选时间范围无关' }
      ]);
  };

  /* SECTION: r-agent-detail */
  /* v10b（走查 2.4 / Top12#8）：Tab 从 10 收敛到 7 —— 舒适区 5–7。
   * 合并规则（职能不丢，只收导航）：
   *   运行日志 → 并入「调试与日志」（调试台与历史输出同屏，上下呼应）
   *   发布历史 → 并入「版本与发布」（历史本来就是版本时间线的一部分）
   *   引用与依赖 → 并入「编排配置」（依赖是编排的事实基础）
   * 「经验」Tab（v23）保留独立 —— 它回答“这个 Agent 沉淀了什么”，归属语义不同于 badcase。
   * 旧深链 #/…/logs|history|deps 在下方 legacyTab() 里归并，老链接不断。 */
  /* v35（2026-10-15 业主指定）：Agent 详情只留**四页**
      会话 / 监控 / 管理 / 日志
     业主原话：「我只要会话，监控，管理，日志这四页就可以，其他无关的数据可以清出去」。
     所以原「编排配置 / 版本与发布 / 质量与 badcase / 成本 / 经验」五个页签从这一页清掉，
     其中**属于"管理"职能的并入「管理」页**（页内再分两级：编排配置 / 版本与发布 / 权限与工具），
     因为"配这个 Agent、发这个版本、给谁什么权限"本来就是同一件事的三个面；
     质量与成本不在这四页的职能里，从本页移除（数据与渲染器仍在各自文件里，
     可观测与评估页、成本与调用归因页照旧用它们 —— 这次清的是**这一页上的入口**，不是数据源本身）。
     默认落地仍是「会话」（业主要求的第一页）。 */
  var AGENT_TABS = [
    { id: 'session', label: '会话' },
    { id: 'monitor', label: '监控' },
    { id: 'manage', label: '管理' },
    { id: 'debug', label: '日志' },
    /* 2026-10-21 业主指定：「把编排放置在 agent 详情第五页」。
       它讲的是本 Agent 被编进哪条业务旅程（第几棒、交给谁、卡了谁兜底），
       与管理页「02 编排」的内部链路不是同一件事，见 v41-agent-journey.js 文件头。 */
    { id: 'journey', label: '编排' }
  ];
  /* 老深链一律收进这几页，老书签不断：
       orchestrate / versions / exp → 管理（这五个里前两个本来就并在「管理」里）
       quality / cost              → 监控（成功率、失败明细、消费金额与 tokens 都在监控页上）
       logs / history / deps       → 日志 / 管理 / 管理（历史沿用）
       flow / canvas               → 编排（2026-10-21：flow 曾是"编排配置"的旧名，
                                     收进监控只是当年的权宜；现在有了正式编排页，落这里更对） */
  function legacyTab(t) {
    var M = {
      logs: 'debug', history: 'manage', deps: 'manage',
      orchestrate: 'manage', versions: 'manage', exp: 'manage',
      quality: 'monitor', cost: 'monitor',
      flow: 'journey', canvas: 'journey', orch: 'journey'
    };
    return M[t] || t;
  }

  RENDERERS.agentDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var ai = S.idx.agent[state.agentId];
    if (ai == null) {
      return '<div class="fatal"><h2>Agent 不存在</h2><p>标识「' + h.esc(state.agentId) + '」未找到，可能已被删除或链接有误。</p>' +
        '<button class="btn-primary" data-act="goto-cap" data-id="agent-wb">返回 Agent 列表</button></div>';
    }
    var a = S.AGENTS[ai];
    var tab = legacyTab(state.tab || 'session');
    var life = F.lifecycleFactor(a, 0);
    var dr = F.dailyRow(ai, 0);
    var k = Q.kpi(state.range, { agentIdx: ai });

    var _ov = agOv(state, a.id);
    var _ratio = agRatio(state, a);
    /* 版本相关的动作抽成一处：会话屏的扁头也要挂「预检 / 提交发布」——
       两处各写一份必然会漂（这是本仓反复踩过的坑）。 */
    var verActions = (life <= 0 ? '<span class="vb-off">已于 ' + h.esc(F.fmtDate(S.TODAY_START + a.retiredAt * S.DAY)) + ' 下线</span>'
      : (_ov.retired ? '<span class="vb-off">本会话已下线（演示，刷新还原）</span>' : '')) +
      '<button class="btn-ghost" data-act="agent-precheck" data-id="' + h.esc(a.id) + '">预检</button>' +
      (_ov.released
        ? '<button class="btn-primary btn-off" data-act="blocked-why" data-id="本次会话已经发布过这个版本">已发布</button>'
        : '<button class="btn-primary" data-act="agent-release" data-id="' + h.esc(a.id) + '|publish">发布上线</button>');
    /* 2026-10-17：三屏页头**恢复旧结构**（用户要求"上面改为旧的"）。上一轮收编把 verSummary
       变成死代码，监控/管理/日志三屏的版本信息（线上/灰度/草稿）与预检/提交发布**整个丢了**。
       现恢复 verBar（版本条）与 backRow（返回行），逐字来自 _bak/20261016-0405-three-tabs。
       「优化返回上一页按钮」= backRow **去掉 ph-back-crumb**：`biz → 线路名 · Agent 名` 与
       .ph-tags 第一项（biz → 线路名）完全重复、Agent 名就在标题里 —— 零信息损失，行更轻。 */
    var verBar = '<div class="verbar ' + (life > 0 ? 'online' : 'offline') + '">' +
      '<span class="vb-item"><i>线上运行</i><b>' + h.esc(agOnline(state, a)) + '</b>' +
      (_ov.rollbackTo ? '<em class="vb-full">已回滚 · 全量</em>'
        : (_ov.paused ? '<em class="vb-gray">灰度已暂停' + (a.grayVersion ? ' · ' + h.esc(a.grayVersion) : '') + '</em>'
        : (a.grayVersion ? '<em class="vb-gray">灰度 ' + h.esc(a.grayVersion) + ' · ' + Math.round(_ratio * 100) + '%</em>' : '<em class="vb-full">全量 100%</em>'))) + '</span>' +
      (_ov.rollbackTo ? '<span class="vb-sep"></span><span class="vb-item"><i>本会话已回滚</i><b>' + h.esc(a.online) + ' → ' + h.esc(_ov.rollbackTo) + '</b><em class="vb-draft">仅本会话</em></span>' : '') +
      '<span class="vb-sep"></span>' +
      '<span class="vb-item"><i>草稿</i><b>' + h.esc(a.online) + '-draft</b><em class="vb-draft">未发布 · 与线上隔离</em></span>' +
      '<span class="vb-right">' + verActions + '</span></div>';
    var backRow =
      '<div class="ph-backrow">' +
      '<button class="ph-back" data-act="goto-cap" data-id="agent-wb" title="回到 Agent 列表">' +
      h.icon('back', 14) + '<span>返回 Agent 列表</span></button>' +
      '</div>';
    var head = backRow +
      '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('bot', 20) + ' ' + h.esc(a.name) +
      (life <= 0 ? ' <span class="ph-off">已下线</span>' : (a.grayVersion ? ' <span class="ph-gray">灰度中</span>' : '')) + '</div>' +
      '<div class="ph-desc">' + h.esc(a.desc) + '</div>' +
      '<div class="ph-tags"><span>' + h.esc(a.biz) + ' → ' + h.esc(S.BIZ_LINES[S.idx.biz[a.biz]].name) + '</span>' +
      /* 2026-10-21：责任人字段已清空（单人系统）——没人就整项不显示，不留「负责人 — · 」这种半截 */
      (Q.ownerName(a.owner) && Q.ownerName(a.owner) !== '—'
        ? '<span>负责人 ' + h.esc(Q.ownerName(a.owner)) + '</span>'
        : '') +
      '<span>上线于 ' + h.esc(F.fmtDate(S.TODAY_START + a.publishedAt * S.DAY)) + '</span>' +
      '<span>主模型 ' + h.esc((S.MODELS[S.idx.model[a.model]] || {}).name || a.model) + '</span></div>' +
      '</div><div class="ph-side">' + h.rangePicker(state.range) + verActions + '</div></div>';

    var body = '';
    /* 四页签的分发（v35）。「管理」页自己再分两级，见 agentManage。 */
    if (tab === 'monitor') body = agentMonitor(a, ai, state, h, k);
    else if (tab === 'manage') body = agentManage(a, ai, state, h);
    else if (tab === 'debug') {
      body = agentDebug(a, ai, state, h);
      /* 🔴 形态重排（2026-10-12）：原「运行日志」区块（renderers2.js 的 AGENT_TAB_RENDER.logs）
         是 25 行 / 184 页的 7 列表，**首行与「运行监控 › 调用明细」逐字同构** —— 同一份调用记录
         在同一个详情页的两个页签各渲染一遍，还自带第二个 metaBar。
         明细已统一由运行监控承担；本页签只留「换一条回放」的选择器 + 出口（见 agentDebug 的 logsExit）
         ⇒ 这里**跳过**第二次渲染。⚠ 只跳渲染，不动那个渲染器本身（它在 renderers2.js）。 */
    }
    else {
      // session 由 v27 注册（AGENT_TAB_RENDER.session）；v35 后只剩这一个走注册表
      var fn = (global.AGENT_TAB_RENDER || {})[tab];
      body = fn ? fn(a, ai, state, h) : '<div class="empty"><div class="empty-title">未知的 Tab：' + h.esc(tab) + '</div></div>';
    }


    /* ── v32 扁头方案已于 2026-10-17 撤销（用户要求四页签统一走旧页头结构）──────────
       原因：三屏恢复 backRow + page-head + verBar 后，会话页签若仍走扁头，四屏页头形态
       不一致（用户："这页没改"）。统一后几何收益让位于一致性；.as-hd 只保留
       展示模式 + 右栏开关 + 对话/轨迹页签，身份/动作全部在 page-head/verBar 一层。 */
    /* 2026-10-17：**四个页签统一走同一套页头**（backRow + page-head + verBar）——
       用户指出会话页签在恢复旧结构后没跟着改（"这页没改"），四屏必须一致。
       verSummary 一并恢复使用：挂在 page-head 的 .ph-title 里（版本胶囊，比 verBar 的长条轻），
       verBar 保留（它是旧结构的绿色版本条，含预检/提交发布）。 */
    var verSummary =
      '<span class="vh-ver">线上 <b>' + h.esc(agOnline(state, a)) + '</b></span>' +
      (_ov.rollbackTo ? '<span class="vh-ver full">已回滚 · 全量（' + h.esc(a.online) + ' → ' + h.esc(_ov.rollbackTo) + '，仅本会话）</span>'
        : (_ov.paused ? '<span class="vh-ver gray">灰度已暂停' + (a.grayVersion ? ' · ' + h.esc(a.grayVersion) : '') + '</span>'
          : (a.grayVersion ? '<span class="vh-ver gray">灰度 ' + h.esc(a.grayVersion) + ' · ' + Math.round(_ratio * 100) + '%</span>'
            : '<span class="vh-ver full">全量 100%</span>'))) +
      (life <= 0 ? '<span class="vh-ver draft">已于 ' + h.esc(F.fmtDate(S.TODAY_START + a.retiredAt * S.DAY)) + ' 下线</span>'
        : '<span class="vh-ver draft">草稿 ' + h.esc(a.online) + '-draft · 未发布</span>');
    var head = backRow +
      '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('bot', 20) + ' ' + h.esc(a.name) +
      (life <= 0 ? ' <span class="ph-off">已下线</span>' : (a.grayVersion ? ' <span class="ph-gray">灰度中</span>' : '')) +
      verSummary + '</div>' +
      '<div class="ph-desc">' + h.esc(a.desc) + '</div>' +
      '<div class="ph-tags"><span>' + h.esc(a.biz) + ' → ' + h.esc(S.BIZ_LINES[S.idx.biz[a.biz]].name) + '</span>' +
      /* 2026-10-21：责任人字段已清空（单人系统）——没人就整项不显示，不留「负责人 — · 」这种半截 */
      (Q.ownerName(a.owner) && Q.ownerName(a.owner) !== '—'
        ? '<span>负责人 ' + h.esc(Q.ownerName(a.owner)) + '</span>'
        : '') +
      '<span>上线于 ' + h.esc(F.fmtDate(S.TODAY_START + a.publishedAt * S.DAY)) + '</span>' +
      '<span>主模型 ' + h.esc((S.MODELS[S.idx.model[a.model]] || {}).name || a.model) + '</span></div>' +
      '</div><div class="ph-side">' + h.rangePicker(state.range) + verActions + '</div></div>';
    var pageHead = head;

    /* v41：Agent 详情 › 编排 —— 这一屏是**工作区**（左工具箱 / 中画布 / 右概览），不是介绍页。
       参照图里页头只有一条工具带，而详情页的「返回行 + 标题 + 描述 + 标签 + 版本条 + 时间范围」
       一共 440px，把画布压到 363px（参照图是 462）。所以这一屏收掉正文件：
       描述 / 标签 / 版本条 / 时间范围 都不出，只留 返回行 + 标题（含版本胶囊）+ 预检/发布。
       其它四屏不变。 */
    var slim = (tab === 'journey');
    if (slim) {
      pageHead = backRow +
        '<div class="page-head slim"><div class="ph-main">' +
        '<div class="ph-title">' + h.icon('bot', 20) + ' ' + h.esc(a.name) + verSummary + '</div>' +
        '</div><div class="ph-side">' + verActions + '</div></div>';
    }

    /* verBar 对四个页签都出（旧结构）；会话页签的 .as-hd 已撤掉与这里重复的身份/动作件，
       只留 展示模式 + 右栏开关 + 对话/轨迹页签（见 v27-agent-session.js 的 sessionTab）。 */
    /* 编排页（slim）自己带一条本页口径条（v41 的 jr-foot），这里不再挂全局 metaBar ——
       上一个版本两边都挂，页尾出现两条"数据口径"块（v41 文件头也写了这件事）。 */
    return pageHead + (slim ? '' : verBar) + agentTabBar(h, a, ai, state, tab, null) + body +
      (slim ? '' : h.metaBar(k.meta, [
        { k: '当前 Agent', v: a.name + '（' + a.id + '），线上 ' + a.online + (a.grayVersion ? '，灰度 ' + a.grayVersion + ' ' + Math.round(a.grayRatio * 100) + '%' : '') },
        { k: '今日实况', v: '今日 ' + fmt.int(dr.calls) + ' 次调用，成功率 ' + fmt.pct2(dr.successRate) + '，P99 ' + fmt.dur(dr.p99) }
      ]));
  };

  /* v27：Agent 详情 Tab 条的**唯一实现**。
     为什么单列出来：v23-exp-agent-link.js 的「经验」包装器会整条替换 Tab 条，而它自带一份
     AGENT_TAB_DEFS 副本 —— 后果有两个，第二个是静默的：
       ① 往 AGENT_TABS 里加 Tab 不生效（本文件改了，页面上还是它那份）；
       ② 质量角标、灰度角标在真实页面上被丢掉（它只算自己的经验角标）。
     现在把「列表 + 角标」都收在这个函数里，包装器通过 global.AGENT_TAB_BAR 取用。
     expN = 经验角标数（由包装器算好传进来，因为经验的统计逻辑在它那边）。 */
  function agentTabBar(h, a, ai, state, active, expN) {
    return tabBar(h, AGENT_TABS.map(function (t) {
      var badge = null;
      if (t.id === 'quality') {
        var bc = queues().badcase.items.filter(function (x) { return x.agentId === a.id && x.status === 'warn'; }).length;
        badge = bc || null;
      }
      if (t.id === 'versions' && a.grayVersion) badge = '灰度';
      /* v27：会话页角标 = 待人工处置数（合规拦截 + 不可重试失败轮）。没有就是 null —— 不硬凑数字。 */
      if (t.id === 'session' && global.AGENT_SESSION) badge = global.AGENT_SESSION.pendingCount(a, ai, state);
      if (t.id === 'exp' && expN) badge = expN;
      return { id: t.id, label: t.label, badge: badge };
    }), active);
  }
  global.AGENT_TAB_BAR = agentTabBar;

  /* SECTION: agent-monitor */
  /* 运行监控 / 调试与日志共用的私有动作（本文件内部登记，不导出）：
     形态稿的筛选 chip 必须**就地生效**才叫 chip —— 用既有的 filter-trace 会跳到可观测页
     （那是"下钻"，不是"筛选"）。只写一个本页读的键，再走统一渲染路径重画。 */
  ACTIONS['agent-trace-filter'] = function (id, btn, h) {
    h.state.monStatus = (id === 'failed' || id === 'gray') ? id : 'all';
    h.navigate({});
  };
  /* 版本时间线的列开关：只切「流量占比 / 操作」两列的显隐（同构合并的代价），动作不丢。 */
  ACTIONS['agent-ver-cols'] = function (id, btn, h) {
    h.state.verCols = !h.state.verCols;
    h.navigate({});
  };
  /* ============ v32 · 运行监控的 DS 控制台式筛选（2026-10-15）============
     这三个动作只改 state 再走统一渲染 —— 与既有的 agent-trace-filter 同一套做法：
     不手改 DOM（手改会丢事件绑定），也不自己写一套筛选逻辑。 */
  ACTIONS['agent-dim'] = function (id, btn, h) {
    h.state.agentDim = id === 'intent' ? 'intent' : 'model';
    h.navigate({});
  };
  ACTIONS['agent-dim-cycle'] = function (id, btn, h) {
    h.state.agentDim = (h.state.agentDim === 'intent') ? 'model' : 'intent';
    h.navigate({});
  };
  ACTIONS['agent-range-cycle'] = function (id, btn, h) {
    /* 时间维度：与页头的时间范围是**同一个 state.range**，这里只是把它做成 DS 那样的胶囊筛选。 */
    var keys = Object.keys(Q.RANGES);
    var i = keys.indexOf(h.state.range);
    h.state.range = keys[(i + 1) % keys.length];
    h.navigate({});
  };
  /* 监控二级页签：花费 / 操作（2026-10-25 业主：「将监控下面也划分两个 tab 页，一个是花费，一个是操作」）。 */
  ACTIONS['agent-mon-tab'] = function (id, btn, h) {
    h.state.agentMonTab = id === 'ops' ? 'ops' : 'cost';
    h.navigate({});
  };
  /* 执行轨迹换一条：只换"看哪一次 trace"，不改筛选、不改场景。 */
  /* 2026-10-25 第三轮：chip 选择器改成「一次一行」（业主贴四行流水图「懂？」）——
     点 chip 换一条的方式撤掉，改成把最近几次调用直接按行铺开。 */
  /* 导出：真的生成一份 CSV 下载（与 export-report 同一做法）。 */
  ACTIONS['agent-usage-export'] = function (id, btn, h) {
    var a = S.AGENTS[S.idx.agent[id]];
    if (!a) { h.toast('Ag' + 'ent 不存在', 'bad'); return; }
    var fmt = h.fmt;
    var ts = Q.timeseries(h.state.range, { agentId: a.id });
    var k = Q.kpi(h.state.range, { agentIdx: S.idx.agent[a.id] });
    var dim = h.state.agentDim === 'intent' ? 'intent' : 'model';
    var dimRows = Q.groupBy(h.state.range, dim, { agentId: a.id }).rows;
    var lines = [];
    lines.push('Agent,' + a.name + ' (' + a.id + ')');
    lines.push('时间维度,' + Q.RANGES[h.state.range].label + ',生成时间,' + new Date().toISOString());
    lines.push('');
    lines.push('汇总,调用次数,失败次数,成功率,P99(ms),成本(CNY),tokens');
    lines.push(['汇总', k.calls, k.fails, (k.successRate * 100).toFixed(2) + '%', k.p99, k.cost.toFixed(2), k.tokens].join(','));
    lines.push('');
    lines.push('时间,调用次数,失败次数,成功率,成本(CNY)');
    ts.points.forEach(function (p) {
      lines.push([new Date(p.ts).toISOString(), p.calls, p.fails, (p.successRate * 100).toFixed(2) + '%', p.cost.toFixed(4)].join(','));
    });
    lines.push('');
    lines.push('按' + (dim === 'intent' ? '意图' : '模型') + '分解,调用次数,成本(CNY),tokens,占比');
    dimRows.forEach(function (r) {
      lines.push([r.label, r.calls, r.cost.toFixed(2), r.tokens, (r.share * 100).toFixed(1) + '%'].join(','));
    });
    lines.push('');
    lines.push('口径说明,"' + (fmt ? '' : '') + (Q.groupBy(h.state.range, dim, { agentId: a.id }).meta.approximationNote || '') + '"');
    var csv = '\ufeff' + lines.join('\r\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var el = document.createElement('a');
      el.href = url;
      el.download = 'Agent用量_' + a.id + '_' + h.state.range + '.csv';
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      h.toast('已生成 CSV：' + ts.points.length + ' 个时间桶 + ' + dimRows.length + ' 行维度分解（按' + (dim === 'intent' ? '意图' : '模型') + '）', 'ok');
    } catch (e) {
      h.toast('浏览器不支持本地下载，可复制口径自行导出（本稿不假装已保存到服务器）', 'info');
    }
  };
  /* ============ 运行监控重排（形态稿第 1 屏，2026-10-12）============
     旧排法（实测 27KB / 3 表 / 43 按钮）：6 张等权 KPI + 3 张表挤在一屏，其中
     「最近失败调用」与「最近调用」**列名逐字同构**（8 列，只差 where 条件），
     各占一块；行内每枚 traceId 又是一个 <button>（14 枚），把「看哪一次」变成 14 次点击决策。
     ⇒ 新排法三层，**信息一个不丢**：
       ① 焦点条（置顶、整行）：这一屏唯一要你动手的事 —— 「哪里坏了」；
          用**位置 + 行高 + 字号**做层级，不叠颜色。          —— 2026-10-25 摘除
       ② 摘要带（一行 3 指标）：调用量 / P99 / 成本。        —— 2026-10-25 摘除
       ③ 调用明细 / 失败原因分布两张表 —— **2026-10-25 业主「这个先删掉，但页面先留着」整块摘除**；
          同一日补上「执行轨迹」：一条真实 trace 的节点流水（见 agentTraceFlow），
          它接替那两张表回答"到底哪一步坏了"—— 表给的是聚合，卡片给的是现场。
          随后业主又贴 ①② 的截图「删除这个」：操作屏只剩轨迹卡，聚合结论回花费屏看。
       ④ 趋势图与意图/模型构成原折在 <details> 里 —— **2026-10-19 业主截图要求删除**，整块已移除
          （调用量与成功率在大数卡、按模型的请求/Tokens 趋势仍在上面 DS 用量区，信息不丢）。 */
  function agentMonitor(a, ai, state, h, k) {
    var fmt = h.fmt;
    var ts = Q.timeseries(state.range, { agentId: a.id });

    /* 二级页签：花费 / 操作（2026-10-25 业主：「将监控下面也划分两个 tab 页，一个是花费，一个是操作」）。
       花费答「钱和 tokens 花在哪」（DS 控制台式用量区：筛选 + 三张大数 + 堆叠柱 + 逐模型趋势）；
       操作答「到底是哪一步坏了」（一条真实 trace 的节点流水）—— 同日两轮摘除后只剩它：
       先是两张明细表，后是焦点条 + 摘要带（业主贴截图「删除这个」），聚合结论改由花费屏与轨迹卡承担。
       分组维度只作用于花费的图 —— 它是这一屏唯一的维度筛选。 */
    var monTab = state.agentMonTab === 'ops' ? 'ops' : 'cost';
    var monSubBar = '<div class="cwall-subtabs" role="tablist" aria-label="监控下的视图">' +
      [['cost', '花费'], ['ops', '操作']].map(function (t) {
        var on = monTab === t[0];
        return '<button role="tab" class="cwall-subtab' + (on ? ' on' : '') + '"' +
          ' aria-selected="' + on + '" data-act="agent-mon-tab" data-id="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';

    /* 2026-10-25 第二轮：焦点条 + 摘要带也摘除（业主贴这两块截图「删除这个」）。
       操作屏不再复述"成功率多少、失败几次"—— 那是花费屏三张大数与轨迹卡脚注已经在说的话；
       这一屏只留一条真实 trace 的现场。`k` 仍给花费屏用，errCode 聚合（原 topErr）随之不再需要。 */


    /* ── DS 控制台形态的用量区（v32 · 业主清单第 ④ 项「监控参考 DS 控制台样子」）────────
       版式照平台用量页：筛选行（左筛选 / 右实心导出）→ 三张大数卡 → 柱图卡（可切维度）
       → 每个模型两张小图（请求次数 / Tokens）。运维结论不在这一屏（操作屏是轨迹卡，
       2026-10-25 两轮摘除后连焦点条 / 摘要带都收走了）——「花了多少」在花费，「坏在哪步」在操作。
       ⚠ 口径：金额与 tokens 是 QUERY 的真聚合；**按维度的逐桶序列是分摊出来的**
         （groupBy 自己就带 approximated + approximationNote，卡脚注照抄它的说明），不假装逐笔记账。 */
    var dimKey = state.agentDim === 'intent' ? 'intent' : 'model';
    var dimRes = Q.groupBy(state.range, dimKey, { agentId: a.id });
    var dimRows = dimRes.rows.slice(0, 4);
    var perBucketTokens = ts.points.map(function (p) { return k.calls ? p.calls * (k.tokens / k.calls) : 0; });
    var costSeries = dimRows.map(function (r, i) {
      return {
        key: r.key, label: r.label, color: C.DS_COLORS[i % C.DS_COLORS.length],
        values: ts.points.map(function (p) { return p.cost * r.share; })
      };
    });
    var groups = dimRows.map(function (r, i) {
      return {
        key: r.key, label: r.label, row: r, color: C.DS_COLORS[i % C.DS_COLORS.length],
        calls: ts.points.map(function (p) { return p.calls * r.share; }),
        tokens: perBucketTokens.map(function (v) { return v * r.share; })
      };
    });
    var dimLabel = dimKey === 'intent' ? '意图' : '模型';
    function dsCard(label, valueHtml, unit, sub) {
      return '<div class="ds-card"><span>' + h.esc(label) + '</span><b>' + valueHtml +
        (unit ? '<em>' + h.esc(unit) + '</em>' : '') + '</b>' +
        (sub ? '<u>' + sub + '</u>' : '') + '</div>';
    }
    var dsFilter = function (label, value, act, id, tip) {
      return '<button class="ds-filter" data-act="' + act + '" data-id="' + h.esc(id) + '"' +
        (tip ? ' data-tip="' + h.esc(tip) + '"' : '') + '>' +
        '<i>' + h.esc(label) + '</i><b>' + h.esc(value) + '</b>' + h.icon('caret', 12) + '</button>';
    };
    /* 筛选行只挂在花费屏（时间维度与页头共用同一个 state.range）。 */
    var dsTimeFilter = dsFilter('时间维度', Q.RANGES[state.range].label, 'agent-range-cycle', state.range,
      '点一下换到下一个时间维度（与页头的时间范围是同一个状态）');
    var dsMoreBtn = '<button class="ds-more" data-act="agent-traces" data-id="' + h.esc(a.id) + '" title="去可观测 · trace 检索看全部调用" aria-label="更多">···</button>';
    var dsBarCost = '<div class="ds-bar">' + dsTimeFilter +
      dsFilter('分组维度', dimLabel, 'agent-dim-cycle', dimKey, '堆叠柱与下方分解按这个维度分组') +
      '<span class="ds-bar-right">' +
      '<button class="ds-export" data-act="agent-usage-export" data-id="' + h.esc(a.id) + '">导出</button>' +
      dsMoreBtn + '</span></div>';
    var dsCards = '<div class="ds-cards">' +
      dsCard('消费金额', fmt.money(k.cost), 'CNY', '环比 ' + fmt.delta(k.compare.cost, { higherIsBetter: false }) + ' · 均价 ' + fmt.money4(k.calls ? k.cost / k.calls : null) + '/次') +
      dsCard('API 请求次数', fmt.int(k.calls), '', '失败 ' + fmt.int(k.fails) + ' 次 · 成功率 ' + fmt.pct2(k.successRate)) +
      dsCard('Tokens', fmt.int(k.tokens), '', '均价 ' + fmt.int(k.calls ? k.tokens / k.calls : 0) + ' tok / 次 · 成本 ' + fmt.money4(k.tokens ? k.cost / (k.tokens / 10000) : null) + ' / 万 token') +
      '</div>';
    var dsPanel = '<div class="ds-panel"><div class="ds-panel-h">' +
      '<h3>消费金额（CNY）</h3><span class="sum">' + fmt.money(k.cost) + '</span>' +
      '<span class="sw" role="group" aria-label="堆叠口径">' +
      '<button class="ds-sw' + (dimKey === 'model' ? ' on' : '') + '" data-act="agent-dim" data-id="model">模型</button>' +
      '<button class="ds-sw' + (dimKey === 'intent' ? ' on' : '') + '" data-act="agent-dim" data-id="intent">意图</button>' +
      '</span></div>' +
      C.stackedBar(ts.points, costSeries, { width: C.chartWidth() + 32, granularity: ts.granularity, aria: '按' + dimLabel + '的消费金额堆叠柱', fmt: function (v) { return '¥' + Number(v).toFixed(v < 10 ? 2 : 0); } }) +
      '<div class="ds-legend">' + dimRows.map(function (r, i) {
        /* 图例上的占比用**金额占比**（与柱高同口径）；调用占比在下方分组标题里已经给了次数 */
        return '<span><i style="background:' + C.DS_COLORS[i % C.DS_COLORS.length] + '"></i>' + h.esc(r.label) +
          ' <em style="font-style:normal;color:var(--faint)">' + fmt.money(r.cost) + ' · ' + (k.cost ? (r.cost / k.cost * 100).toFixed(1) : '0') + '%</em></span>';
      }).join('') + '</div>' +
      '<div class="ds-note">口径：' + h.esc(dimRes.meta && dimRes.meta.approximationNote ? dimRes.meta.approximationNote : '按维度占比分摊到时间桶，存在近似') + '</div></div>';
    var dsGroups = '<div class="ds-groups">' + groups.map(function (g) {
      return '<div class="ds-group-h">' + g.label + '<em>' + fmt.int(g.row.calls) + ' 次 · ' + fmt.money(g.row.cost) + ' · ' + fmt.compact(g.row.tokens) + ' token</em></div>' +
        '<div class="ds-grid2">' +
        '<div class="ds-panel" style="margin:0"><div class="ds-mini"><span>API 请求次数</span><b>' + fmt.int(g.row.calls) + '</b></div>' +
        C.areaChart(ts.points, g.calls, { width: C.gridWidth(2), granularity: ts.granularity, color: g.color, fmt: function (v) { return fmt.compact(v); }, aria: g.label + ' 的请求次数趋势' }) + '</div>' +
        '<div class="ds-panel" style="margin:0"><div class="ds-mini"><span>Tokens</span><b>' + fmt.compact(g.row.tokens) + '</b></div>' +
        C.areaChart(ts.points, g.tokens, { width: C.gridWidth(2), padL: 56, granularity: ts.granularity, color: g.color, fmt: function (v) { return fmt.compact(v); }, aria: g.label + ' 的 tokens 趋势' }) + '</div>' +
        '</div>';
    }).join('') + '</div>';
    /* 花费屏到上面为止（筛选 + 三张大数 + 堆叠柱 + 逐模型趋势）——「钱花在哪」在 DS 用量区里答完。 */
    if (monTab === 'cost') return monSubBar + dsBarCost + dsCards + dsPanel + dsGroups;

    /* 操作屏：只剩执行轨迹（明细表 → 焦点条 / 摘要带 同日两轮按业主截图摘除，页签保留）。 */
    return monSubBar + agentTraceFlow(a, state, h);
  }

  /* ============ 执行轨迹（2026-10-25，业主：「将轨迹翻译成，懂？放在操作里」）============
     会话 › 轨迹那边是一本逐行事件账本（轮次 / 消息 / 系统 / 工具…），回答"发生了什么"；
     这一张是同一件事在本屏的译法：把一条 trace 的 spans 按执行顺序排成横向节点流水 ——
     一个节点一张卡（类型 + 名称 + 耗时 / token），节点之间是流转箭头；失败节点标红并成为终点，
     拓扑里它后面的节点画虚线卡标「未执行」（它们**真的没跑**，不是缺数据）。
     ⚠ 数据全部取自 FACTS.getTrace(traceId).spans —— 与 trace 列表同一份 row；
       节点耗时之和 + 间隔 == 端到端时延、llm 节点 token 之和 == 该次 token，两边已由 facts.js 归一对齐。
     ⚠ 不做假的"重跑 / 编辑"：唯一出口是卡头的「完整 trace 详情 →」。
     默认看"最近一次失败"，本范围没有失败才退回最近一次成功（操作页问的是"跑得怎么样"）。 */
  function agentTraceFlow(a, state, h) {
    var fmt = h.fmt;
    var res = Q.searchTraces(state.range, { agentId: a.id }, 1, 12);
    var rows = (res.rows || []).slice().sort(function (x, y) { return y.ts - x.ts; });
    /* 失败单独查：最近 12 条里可能一条失败都没有（失败率 ~1%），
       而这一屏默认要看的恰恰是失败那一次 —— 用 status 过滤再取，不靠"翻运气"。 */
    var failRes = Q.searchTraces(state.range, { agentId: a.id, status: 'failed' }, 1, 2);
    var failRows = (failRes.rows || []).slice().sort(function (x, y) { return y.ts - x.ts; });
    var okRows = rows.filter(function (r) { return r.status !== 'failed'; });
    if (!rows.length) {
      return '<div class="tf-card"><div class="tf-head"><div><h3>执行轨迹</h3>' +
        '<span class="tf-sub">范围 ' + h.esc(Q.RANGES[state.range] ? Q.RANGES[state.range].label : state.range) +
        ' 内没有可展示的调用</span></div></div>' +
        '<div class="tf-note">该 Agent 在这个时间范围内没有 trace。换一个时间范围，或去「可观测」按 traceId 直接打开。</div></div>';
    }

    /* 业主 2026-10-25 贴四行流水图问「懂？」：不是一条 trace 换个 chip 看，
       而是**一次一行** —— 每条 trace 一行：行首时间与成败，行下是这条 trace 的横向节点流水。
       取哪几行沿用 chip 时代的取舍：失败在前（排障先看坏的那次），同组内按时间倒序。
       searchTraces 给的是摘要行，spans 要用 getTrace 取回同一份完整 trace。 */
    var list = failRows.slice(0, 2).concat(okRows.slice(0, 2));
    if (!list.length) list = rows.slice(0, 4);
    list = list.map(function (r) { return F.getTrace(r.traceId); }).filter(Boolean);

    var KIND_ICON = { start: 'play', llm: 'chip', guard: 'shield', end: 'doc' };
    var MCP_ICON = {
      'mcp-crm-query': 'crm', 'mcp-order': 'order', 'mcp-ticket': 'ticket',
      'mcp-kb-search': 'search', 'mcp-doc-parse': 'doc', 'mcp-notify': 'bell'
    };
    function nodeIcon(n) {
      if (n.kind === 'tool') return MCP_ICON[n.mcp] || 'chip';
      return KIND_ICON[n.kind] || 'doc';
    }
    /* 工具名去掉 mcp- 前缀：1440 视口下 7 节点拓扑每张卡只有 ~133px，
       「工具 · mcp-crm-query」放不下会截掉最有辨识度的尾巴。完整服务名在卡头 title 与 trace 详情里。 */
    function kindLine(n) {
      if (n.kind === 'llm') return '模型 · ' + (n.model || a.model);
      if (n.kind === 'tool') return '工具 · ' + String(n.mcp || 'upstream').replace(/^mcp-/, '');
      if (n.kind === 'guard') return '合规 · 规则检查';
      if (n.kind === 'start') return '入口 · 接收请求';
      if (n.kind === 'end') return '输出 · 投递结果';
      return C.KIND_LABEL[n.kind] || n.kind;
    }
    /* 工具节点的"返回了什么"：只取输出对象的第一个标量字段（level=VIP / status=已签收…），
       避免把整段 JSON 塞进一张 176px 的卡；完整 IO 在「完整 trace 详情 →」里。 */
    function toolBrief(o) {
      if (!o) return '';
      var ks = Object.keys(o);
      for (var i = 0; i < ks.length; i++) {
        var k = ks[i], v = o[k];
        if (v == null || typeof v === 'object') continue;
        /* status / *_id 这类键名不带信息量（卡上的类型行已说明是哪个工具），只留值。 */
        return (k === 'status' || /_id$/.test(k) ? '' : k + '=') + String(v).slice(0, 12);
      }
      return '';
    }
    function nodeTok(v) {
      if (v == null) return '—';
      return v >= 1e4 ? fmt.compact(v) : String(Math.round(v));
    }
    function metaHtml(n) {
      var b = '<b>' + fmt.dur(n.duration) + '</b>';
      /* 失败读的是错误**中文名**（4~5 字，133px 的卡放得下）；错误码 E_BAD_PARAMS 这类 12 字符
         在 1440 下必被截成「E_BAD_PA…」。码与重试次数进卡头 title 和下方 note。 */
      if (n.status === 'failed') return b + '<span class="bad">' + h.esc(n.error ? n.error.name : '失败') + '</span>';
      /* 卡内 token 数：4 位数去掉千分位（1,033 → 1033），1440 下「入1,033·出214」连同时长
         会溢出 ~10px 被截成「出2…」；上万才折成「1.2万」。精确值在行首元信息与 trace 详情里。 */
      if (n.kind === 'llm') return b + '<span>入' + nodeTok(n.tokensIn) + '·出' + nodeTok(n.tokensOut) + '</span>';
      if (n.kind === 'tool') {
        var q = toolBrief(n.io ? n.io.output : null);
        return b + (q ? '<span>' + h.esc(q) + '</span>' : '');
      }
      if (n.kind === 'guard') {
        var hit = n.io && n.io.output && n.io.output.hit;
        return b + '<span>' + (hit ? '命中' : '通过') + '</span>';
      }
      if (n.kind === 'end') return b + '<span>已投递</span>';
      return b;
    }
    function flowNode(n) {
      var fail = n.status === 'failed';
      var tip = fail && n.error
        ? n.error.code + ' · ' + n.error.message + (n.error.retries ? '（已重试 ' + n.error.retries + ' 次）' : '')
        : (kindLine(n) + ' · 耗时 ' + fmt.dur(n.duration));
      return '<div class="tf-node k-' + h.esc(n.kind) + (fail ? ' is-fail' : '') + '" title="' + h.esc(tip) + '">' +
        '<div class="tf-n-top"><span class="tf-n-ico">' + h.icon(nodeIcon(n), 14) + '</span>' +
        '<span class="tf-n-name">' + h.esc(n.name) + '</span></div>' +
        '<div class="tf-n-kind">' + h.esc(kindLine(n)) + '</div>' +
        '<div class="tf-n-meta">' + metaHtml(n) + '</div></div>';
    }
    function offNode(n) {
      return '<div class="tf-node k-' + h.esc(n.kind) + ' is-off" title="本次执行在失败节点处中断，该节点未运行">' +
        '<div class="tf-n-top"><span class="tf-n-ico">' + h.icon(nodeIcon(n), 14) + '</span>' +
        '<span class="tf-n-name">' + h.esc(n.name) + '</span></div>' +
        '<div class="tf-n-kind">' + h.esc(kindLine(n)) + '</div>' +
        '<div class="tf-n-meta"><b>—</b><span>未执行</span></div></div>';
    }

    /* 把一条 trace 的 spans 铺成流水；失败后拓扑里没跑的节点画虚线。
       返回 {html, off}，off 给行脚注判断要不要提「未执行」。 */
    function rowFlow(t) {
      var topoNodes = F.TOPO[t.topo] || [];
      var ranIds = {};
      t.spans.forEach(function (sp) { ranIds[sp.id] = 1; });
      var stopAt = -1;
      for (var ni = 0; ni < topoNodes.length; ni++) {
        if (!ranIds[topoNodes[ni].id]) continue;
        stopAt = ni;
      }
      var off = [];
      if (t.status === 'failed' && stopAt >= 0) {
        off = topoNodes.slice(stopAt + 1).filter(function (n) { return !ranIds[n.id]; });
      }
      var html = '';
      t.spans.forEach(function (sp, i) {
        if (i) html += '<div class="tf-link"></div>';
        html += flowNode(sp);
      });
      if (off.length) {
        html += '<div class="tf-link off"><span>中断</span></div>';
        off.forEach(function (n, i) {
          if (i) html += '<div class="tf-link off"></div>';
          html += offNode(n);
        });
      }
      return { html: html, off: off.length };
    }

    function rowHtml(t) {
      var bad = t.status === 'failed';
      var failSp = null;
      t.spans.forEach(function (sp) { if (sp.status === 'failed') failSp = sp; });
      var q = t.spans[0] && t.spans[0].io && t.spans[0].io.output
        ? t.spans[0].io.output.query : '';
      var meta = '<span class="mono">' + h.esc(t.traceId) + '</span> · 意图 ' + h.esc(t.intentName) +
        ' · ' + h.esc(t.version) + ' · 端到端 ' + fmt.dur(t.latencyMs) + ' · ' + t.spans.length + ' 个节点' +
        ' · token 入 ' + fmt.int(t.tokensIn) + ' / 出 ' + fmt.int(t.tokensOut) +
        (bad
          ? ' · <b class="bad">失败于 ' + h.esc(failName(t)) + '</b>' +
            (failSp && failSp.error ? '（' + h.esc(failSp.error.code) +
              (failSp.error.retries ? ' · 重试 ' + failSp.error.retries + ' 次' : '') + '）' : '')
          : '');
      var f = rowFlow(t);
      return '<div class="tf-row' + (bad ? ' is-bad' : '') + '">' +
        '<div class="tf-row-head">' +
        '<span class="tf-chip ' + (bad ? 'is-bad' : 'is-ok') + '"><i></i>' + fmt.dt(t.ts) +
        '<em>' + (bad ? '失败' : '成功') + '</em></span>' +
        '<span class="tf-row-meta">' + meta + '</span>' +
        '<button class="btn-ghost sm tf-row-act" data-act="goto-trace" data-id="' + h.esc(t.traceId) +
        '">完整 trace 详情 →</button></div>' +
        (q ? '<div class="tf-row-q">用户输入「' + h.esc(q) + '」</div>' : '') +
        '<div class="tf-scroll"><div class="tf-flow">' + f.html + '</div></div>' +
        '</div>';
    }

    return '<div class="tf-card"><div class="tf-head"><div style="min-width:0">' +
      '<h3>执行轨迹</h3>' +
      '<span class="tf-sub">本范围共 ' + fmt.int(res.total) + ' 条 trace · 这里按时间往下铺最近 ' +
      list.length + ' 次（失败在前，同组内按时间倒序）</span></div>' +
      '<span class="tf-act"><button class="btn-ghost sm" data-act="agent-traces" data-id="' + h.esc(a.id) +
      '">查看全部调用 →</button></span></div>' +
      '<div class="tf-list">' + list.map(rowHtml).join('') + '</div>' +
      '<div class="tf-note">虚线节点 = 那次执行在失败处中断，拓扑里它后面的节点没有运行。' +
      '节点、顺序、耗时、token、错误码全部取自同一份 trace（与「完整 trace 详情」同源）。</div></div>';
  }

  /* SECTION: agent-orchestrate
   * 只读拓扑视图。诚实处理：画布拖拽编辑属于工程实现项，
   * 这里展示当前版本的真实节点拓扑与各节点配置，不做假的"可拖拽"。
   */
  /* ============ 编排配置重排（形态稿第 3 屏，2026-10-12）============
     旧排法（实测 12KB / 3 表 / 27 按钮 / 12 卡）：7 个节点**竖着铺成 4 列表**（等于用表格画流程图，
     一屏只放得下 7 行的一半）；「上游依赖」与「下游引用」是同一张关系图的两个方向却拆成
     两张**异构**表（5 列 / 4 列）；真正会伤人的两条 ——「2 个工具节点未配降级分支」与
     「下线 Agent 影响日均 4.0k 调用」—— 分别藏在第 2 块与第 12 块。
     ⇒ 新排法：
       ① 危险行独立置顶（两条各占一条，位置即区分，不叠颜色）；
       ② 拓扑 → **横向 chip 带**（百分比＝耗时占比；⚠ 直接标在节点上；点节点展开它的配置）；
       ③ 上游/下游合成**一张带「方向」列**的表；
       ④ 未接线按钮按本仓规矩保留：btn-off + aria-disabled + 一句为什么，
          权重压到区块末位，不与真能用的动作并列。
     功能一个不少：静态校验 / 节点实测表现 / agent-traces / goto-agent-tab 全部保留。 */
  function agentOrchestrate(a, ai, h) {
    var fmt = h.fmt;
    var topoKey = F.AGENT_TOPO[a.id];
    var topo = F.TOPO[topoKey] || F.TOPO['qa-rag'];
    var totalW = topo.reduce(function (s, n) { return s + n.w; }, 0);
    /* 「输出前已接入合规检查」的旧判据（tool-heavy / qa-rag）原样保留，不新增口径 */
    var hasGuard = (topoKey === 'tool-heavy' || topoKey === 'qa-rag');

    /* 每个工具节点的配置 + 它的 mcp 服务（要拿去算 qpsCap / errorBias） */
    function nodeCfg(n) {
      var cfg = [];
      if (n.kind === 'llm') cfg.push(['模型', n.model || a.model], ['温度', '0.3'], ['超时', '30000ms'], ['重试', '2 次（指数退避）']);
      if (n.kind === 'tool') cfg.push(['服务', n.mcp], ['超时', '8000ms'], ['重试', '1 次'], ['失败策略', '走降级分支']);
      if (n.kind === 'guard') cfg.push(['规则包', '敏感表述-广告法 v12'], ['规则包', '数据出境校验 v3'], ['命中动作', '阻断']);
      if (n.kind === 'start') cfg.push(['入参', 'user_id, query, session_id'], ['校验', 'query 非空且 ≤ 2000 字']);
      if (n.kind === 'end') cfg.push(['出参', 'answer, references'], ['写入会话历史', '是']);
      return cfg;
    }
    function nodeSvc(n) {
      if (!n.mcp) return null;
      return S.MCP_SERVICES.filter(function (m) { return m.id === n.mcp; })[0] || null;
    }

    /* --- ① 危险行（置顶两条）--- */
    var toolNodes = topo.filter(function (n) { return n.kind === 'tool'; });
    /* 判据与旧版**同一份**：旧版静态校验最后一条写死「2 个工具节点未配置失败降级分支」，
       且只对 tool-heavy / qa-rag 模板成立（nodeCfg 里工具节点统一写着「走降级分支」，
       那是模板文案，不是逐节点的真实接线状态 —— 这里不臆造第三种口径）。 */
    var riskyTools = (topoKey === 'tool-heavy' || topoKey === 'qa-rag') ? toolNodes.slice(-2) : [];
    var riskyTool = riskyTools.length > 0;
    var riskyNames = riskyTools.map(function (n) { return n.name; }).join(' · ');
    var riskySvc = null;
    topo.forEach(function (n) { if (!riskySvc) { var s = nodeSvc(n); if (s && s.errorBias > 1.5) riskySvc = s; } });
    /* 2026-10-20：Workflow 一页下线 —— 影响面里的「引用方」只剩子 Agent 一类，
       原来那条 wfs（按 agentId 反查 Workflow 表）随之删除；口径未变：数与名单都从真实数据 join。 */
    var subAgents = S.AGENTS.filter(function (x) { return x.id !== a.id && x.biz === a.biz && x.id.indexOf('qa') < 0; }).slice(0, 1);
    var refN = subAgents.length;
    var refRuns = subAgents.reduce(function (s, x) { return s + F.dailyRow(S.idx.agent[x.id], 0).calls; }, 0);
    var refList = subAgents.map(function (x) { return '子 Agent ' + x.name; }).join(' · ');

    function riskRow(kind, title, sub, act, actId, actLabel) {
      var color = kind === 'crit' ? 'var(--red)' : 'var(--amber)';
      return '<div class="ov-focus ' + kind + '" style="border:1px solid ' +
        (kind === 'crit' ? '#f3c9c9' : '#f0dcae') + ';border-left:3px solid ' + color + ';' +
        'border-radius:var(--dsw-radius-md);padding:11px 15px;background:#fff;display:flex;' +
        'align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px">' +
        '<span style="flex:1;min-width:300px">' +
        '<span style="display:block;font-size:14px;font-weight:600;line-height:1.5">' + title + '</span>' +
        '<span style="display:block;font-size:12px;color:var(--sub);line-height:1.6;margin-top:2px">' + sub + '</span></span>' +
        (act ? '<button class="btn-ghost" data-act="' + act + '" data-id="' + h.esc(actId) + '">' + h.esc(actLabel) + '</button>' : '') +
        '</div>';
    }
    var dangerHtml = '';
    if (riskyTool) {
      dangerHtml += riskRow('crit', '⚠ ' + riskyTools.length + ' 个工具节点未配置失败降级分支',
        h.esc(riskyNames) + ' — ' +
        (riskySvc ? '上游 ' + riskySvc.name + ' 当前「错误率偏高」（errorBias ' + riskySvc.errorBias + '）' : '上游服务未在 MCP 清单中登记') +
        '，失败将直接中断本次编排',
        'goto-agent-tab', a.id + '|versions', '看发布前检查 →');
    } else {
      dangerHtml += riskRow('crit', '⚠ 输出前无合规检查节点', '发布前需你确认；其余 6 项静态校验通过',
        'goto-agent-tab', a.id + '|versions', '看发布前检查 →');
    }
    dangerHtml += riskRow('warn', '下线 Agent 会中断日均 ' + fmt.compact(refRuns) + ' 次调用',
      '影响 ' + refN + ' 个引用方' + (refList ? '（' + h.esc(refList) + '）' : '') +
      ' · 下线后无法回滚，需先「通知所有引用方」',
      'goto-agent-tab', a.id + '|versions', '看影响清单 →');

    /* --- ② 拓扑：横向 chip 带 --- */
    var chips = topo.map(function (n, i) {
      var pct = ((n.w / totalW) * 100).toFixed(0) + '%';
      var risky = !!riskyTools.filter(function (x) { return x.name === n.name; }).length;
      var cfg = nodeCfg(n);
      var title = n.name + ' · ' + (C.KIND_LABEL[n.kind] || n.kind) + ' · 耗时占比 ' + pct +
        (risky ? ' · ⚠ 未配失败降级分支' : '') + '\n' + cfg.map(function (c) { return c[0] + '：' + c[1]; }).join('\n');
      return '<details style="display:inline-block"><summary style="list-style:none;cursor:pointer;display:inline-flex;' +
        'align-items:center;gap:6px;font-size:12px;background:' + (risky ? '#fef3c7' : '#f1f3f7') + ';color:' +
        (risky ? '#92400e' : 'var(--sub)') + ';border-radius:var(--dsw-radius-pill);padding:4px 12px" title="' +
        h.esc(title) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + C.KIND_COLOR[n.kind] + ';display:inline-block"></span>' +
        h.esc(n.name) + '<b style="font-weight:600">' + pct + '</b>' + (risky ? '⚠' : '') + '</summary>' +
        '<div style="font-size:12px;color:var(--sub);background:#fbfcfe;border:1px solid var(--line);' +
        'border-radius:var(--dsw-radius-sm);padding:8px 12px;margin:6px 0;line-height:1.7">' +
        '<b>' + h.esc(n.name) + '</b> · ' + h.esc(C.KIND_LABEL[n.kind] || n.kind) + ' · 耗时占比 ' + pct +
        cfg.map(function (c) { return '<br>' + h.esc(c[0]) + '：<span class="mono">' + h.esc(String(c[1])) + '</span>'; }).join('') +
        '</div></details>' + (i < topo.length - 1 ? '<span style="color:#c9d1e0;font-size:12px;margin:0 4px">→</span>' : '');
    }).join('');
    /* 静态校验的 7 项里，恒定的 5 项通过（无孤立节点 / 无环路 / 有输出节点 / 必填配置完整 / 循环上限），
       另外两项由 hasGuard 与 riskyTool 决定 —— 数字从这里来，不再手写"5 通过 2 警告"。 */
    var passN = 5 + (hasGuard ? 1 : 0);
    var warnN = 7 - passN;

    var topoCard = '<div class="card"><div class="card-h"><h3>节点拓扑 · ' + h.esc(a.online) + '（线上版本，只读）</h3>' +
      '<span class="card-sub">编排模板 ' + h.esc(topoKey) + ' · ' + topo.length + ' 个节点</span></div>' +
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:4px 0">' + chips + '</div>' +
      '<div class="bt-note">百分比＝该节点耗时占比；带 ⚠ 的节点未配置失败降级分支。点一枚展开它的模型 / 超时 / 重试 / 失败策略。</div>' +
      /* 未接线按钮：保留入口（灰态 + aria-disabled + 一句为什么），权重压到区块末位。
         不用原生 disabled —— 本仓既定做法是「仍可聚焦、点了说明原因」，见 _verify-fix 的判据。 */
      /* 2026-10-18 合并：原先这里挂「编辑授权与策略 ↓」跳到工具授权卡 —— 工具授权卡已删（与「权限与工具」
         里那张是同一份，重复渲染），工具开关现在在页首「联系」里逐条管，所以按钮换成静态校验的出口。
         静态校验原来独占一张卡（7 条勾选），它的结论其实只剩两件事：几项通过、哪几项警告；
         而"2 个工具节点未配降级"这一条**顶部危险行已经置顶说过**，不再第二次铺开。 */
      '<div class="readonly-note" style="margin:12px 0 0">' + h.icon('doc', 14) +
      ' 静态校验 7 项 · <b>0 阻断</b>' + (warnN ? ' / <b class="bad">' + warnN + ' 警告</b>' : ' / 0 警告') +
      (warnN ? '（' + [
        riskyTool ? riskyTools.length + ' 个工具节点未配失败降级，见顶部危险行' : '',
        hasGuard ? '' : '输出前无合规检查节点，发布需你确认'
      ].filter(Boolean).join('；') + '）' : '') +
      '　画布拖拽编辑（连线 / 增删节点 / 输入映射）属工程实现项，线上版本只读；' +
      '服务与工具的开关在本页上方「联系」里管。' +
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|versions" title="静态校验的结论记录在「发布前检查清单」里">看发布前检查清单 →</button>' +
      '</div></div>';

    

    /* 节点聚合结果要在**主 return 之前**算出来：下面「节点实测表现」卡的按钮 title 要用它的节点数。
       此前那里直接写 `keys.length` —— keys 是 nodePerf() 的内部变量，在此外既未定义、也不同作用域，
       导致 agent:deps 整屏抛 `keys is not defined`。 */
    var _np = nodePerf(a, ai, h);

    /* 2026-10-18 合并：工具授权卡（V34PERM.toolCard）不再在这里渲染。
       它原先与「管理 › 权限与工具」是同一个函数、同一份 state.agentToolGrant 的两遍渲染 ——
       分页时看不见，合成一页后就是两块一模一样的表。工具授权现在只在「联系」的工具分类里管，
       读写仍是同一份 state（同 key），所以 v34 的授权逻辑一行没丢，只是不再重复铺。 */
    return dangerHtml + topoCard +
      /* 节点实测表现是**从这个 Agent 的真实 trace 聚合出来的** ⇒ 真出口：
         agent-traces 写 state.filters.agentId，可观测页检索块真读该键。
         诚实交代：检索页没有"按节点筛选"的维度，所以收敛到 Agent 级（节点配置见上方编排拓扑）。 */
      '<div class="card"><div class="card-h"><h3>节点实测表现</h3><span class="card-sub">来自真实 trace 聚合（近 24 小时）</span>' +
      '<button class="btn-ghost sm" data-act="agent-traces" data-id="' + h.esc(a.id) + '" title="这 ' + _np.n + ' 个节点的数字聚合自该 Agent 的真实 trace；检索页没有按节点筛选的维度，故按 Agent 收敛（节点配置见上方编排拓扑）">看调用明细 →</button></div>' +
      _np.html + '</div>';
    }

  /** 从真实 trace 里聚合各节点的实际耗时占比与失败次数。
   *  返回 { html, n }：n = 聚合到的节点数。调用方要用 n 写按钮 title，
   *  不能再引用本函数内部的 keys（那是另一个作用域，且未初始化 —— 曾导致 agent:deps 整屏渲染失败）。 */
  function nodePerf(a, ai, h) {
    var fmt = h.fmt;
    var agg = {};
    var traces = Q.searchTraces('24h', { agentId: a.id }, 1, 40).rows;
    traces.forEach(function (t) {
      var d = F.getTrace(t.traceId);
      if (!d) return;
      d.spans.forEach(function (sp) {
        if (!agg[sp.id]) agg[sp.id] = { name: sp.name, kind: sp.kind, n: 0, dur: 0, fail: 0 };
        agg[sp.id].n++; agg[sp.id].dur += sp.duration;
        if (sp.status === 'failed') agg[sp.id].fail++;
      });
    });
    var keys = Object.keys(agg);
    if (!keys.length) return { html: '<div class="empty"><div class="empty-title">近 24 小时无调用样本</div></div>', n: 0 };
    var out = '<table class="bt"><thead><tr><th>节点</th><th class="ta-r">样本</th><th class="ta-r">平均耗时</th><th class="ta-r">失败</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var x = agg[k];
        return '<tr><td><i class="fl-dot" style="background:' + C.KIND_COLOR[x.kind] + '"></i>' + h.esc(x.name) + '</td>' +
          '<td class="ta-r">' + x.n + '</td><td class="ta-r">' + fmt.dur(Math.round(x.dur / x.n)) + '</td>' +
          '<td class="ta-r ' + (x.fail ? 'bad' : 'muted') + '">' + (x.fail || 0) + '</td></tr>';
      }).join('') + '</tbody></table>';
    return { html: out, n: keys.length };
  }

  /* SECTION: agent-manage（v35 建，2026-10-18 改为「一页到底」）
   * 「管理」页 = 联系 + 编排 + 版本与发布 + 影响与权限，**一条连续长页**，四枚分节标分段。
   *
   * 演变：v35 先把「编排配置 / 版本与发布 / 权限与工具」并成一页、页内再分两级（业主当时说
   * 「分页下面再分页」）；2026-10-18 业主看过后说「把 4 页合成一页，把重复的删了」——
   * 于是二级分页取消，四个面直接铺在同一条流上。
   *
   * 为什么这次合并是对的（不只是少点几下的问题）：
   *   分页把**同一块内容渲染了两遍**却永远不同屏 —— 工具授权卡既在「编排配置」又在「权限与工具」，
   *   同一个函数、同一份 state，谁都没发现。合并后这类重复才看得见，也才删得掉
   *   （具体删了哪四类重复，见 agentManage 上方的注释）。
   *
   * ⚠ 本页仍**不新写渲染逻辑**：联系走 v38 的 V38CONNECT.page，编排走 agentOrchestrate，
   *   版本走 agentVersions，下游引用走 AGENT_TAB_RENDER.deps，权限边界是本文件的一张小卡。
   */
  /* 这个 Agent 的拓扑用到了哪些 MCP 服务 —— 「联系」页与工具授权同源的那一处。
     两处各推一遍必然会漂（本仓反复踩过的坑），所以只此一处。 */
  function agentUsedSvcs(a) {
    var topoKey = F.AGENT_TOPO[a.id];
    var topo = F.TOPO[topoKey] || F.TOPO['qa-rag'];
    var out = [];
    topo.forEach(function (n) {
      if (!n.mcp) return;
      var sv = S.MCP_SERVICES.filter(function (m) { return m.id === n.mcp; })[0];
      if (sv && out.indexOf(sv) < 0) out.push(sv);
    });
    return out;
  }
  /* v37：Agent「联系」页（管理 › 联系）要用同一份推导 —— 显式导出，禁止那边再推一遍 */
  RENDERERS.agentUsedSvcs = agentUsedSvcs;

  /* ── 「管理」一页到底（2026-10-18 业主）──────────────────────────────────
     业主：「把 4 页合成一页，把重复的删了」。
     原先的四个二级分页（联系 / 编排配置 / 版本与发布 / 权限与工具）合成**一条连续长页**，
     用四枚不可点的分节标（01–04）分段落。为什么不留页签：
       · 这四件事是同一次判断的四个面（它连了谁 → 它怎么跑 → 线上哪一版 → 谁会被影响/谁能动它），
         分页签会让"为了回答一个问题点四次"；
       · 更关键的是分页造成了**同一块内容被渲染两次**：工具授权卡在「编排配置」和「权限与工具」
         各出现一遍（同一个函数、同一份数据），而这两页又不能同时看见，所以一直没人察觉。
     ⇒ 合并后删掉的重复（都是同一事实的第二遍渲染）：
       ① 工具授权卡 ×2 —— 改为只在「联系」的工具分类里管（同一份 state.agentToolGrant）
       ② 上游依赖表（MCP 服务 / 知识库 / 规则包）—— 「联系」已按对象列全，且拓扑 chip 已标节点
       ③ 静态校验卡里的「2 个工具节点未配降级」—— 顶部危险行置顶说的就是这一条
       ④ 影响面速览 4 个数字 —— 下游数在下游引用卡里、日均调用在运行监控、负责人在页头
     保留下来的都是有唯一出口的东西：版本时间线、下游引用与下线保护、权限边界。 */
  /* 2026-10-18（业主「自述腔」）：分节标只留编号 + 标题 + 右侧一个真出口。
     原先每节下面挂一句"它连了谁 —— 开关即挂上/摘除，点卡片看详情并改这个 Agent 上的参数"，
     那是在解释界面自己怎么工作，不是产品对用户说的话 —— 删。
     一个分节标如果需要解释才能看懂，该改的是下面那块内容，不是加一句话。 */
  function amSec(no, title, right) {
    return '<div class="am-sec" id="am-sec-' + no + '"><span class="am-no">' + no + '</span>' +
      '<h2>' + title + '</h2>' + (right ? '<span class="am-side">' + right + '</span>' : '') + '</div>';
  }
  function agentManage(a, ai, state, h) {
    var out = '';
    var v38 = global.V38CONNECT;

    out += amSec('01', '联系',
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|monitor">看运行监控 →</button>');
    out += (v38 && v38.page) ? v38.page(a, h) : '<div class="empty"><div class="empty-title">联系页未加载</div></div>';

    /* 这一段讲的是「Agent 内部的节点链路」；它在业务旅程里排第几棒、交给谁，在第五页「编排」。
       两处都叫"编排"容易混，所以这里直接给一个出口，别让人在两个同名的段之间找差别。 */
    out += amSec('02', '编排',
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|journey" ' +
      'title="在业务旅程里它是第几棒、上一步交给它什么、卡住谁兜底">看它在旅程里的位置 →</button>');
    out += agentOrchestrate(a, ai, h);

    out += amSec('03', '版本与发布',
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|monitor">看这版的运行表现 →</button>');
    out += agentVersions(a, ai, state, h);

    out += amSec('04', '影响与权限',
      '<button class="btn-ghost sm" data-act="assets-goto" data-id="policy|tools" title="角色级权限在「能力与权限 › 权限策略」里">看全局权限矩阵 →</button>' +
      '<button class="btn-ghost sm" data-act="goto-cap" data-id="assets" title="MCP / 模型 / 技能 / 知识库与它们的权限">看能力与权限 →</button>');
    var deps = (global.AGENT_TAB_RENDER || {}).deps;
    if (deps) out += deps(a, ai, state, h);
    return out;
  }

  /* SECTION: agent-debug
   * 调试运行 = 回放真实调用。不做假的"输入框跑一次"，
   * 而是从事实数据里取一条真实 trace 展示完整执行轨迹 —— 这才是可验证的。
   */
  /* ============ 调试与日志重排（形态稿第 5 屏，2026-10-12）============
     旧排法（实测 24KB / 1 表 / 37 按钮 / 8 卡 / 332 行 = 8 个页签里最长，且 0 张 KPI）：
       · 唯一带结论的「批量测试（基线 91.7% → 草稿 88.3% · 8 例退化）」被压在 25 行日志表**上面**；
       · ~150 行是输入/输出 JSON 铺在明面（每个 span 展开一行行的 pre）；
       · 页尾那张 7 列日志表与「运行监控 › 调用明细」**结构逐字同构**（同一份调用记录、
         同一个详情页的两个页签各渲染一遍，还多出 184 页分页），并自带第二个 metaBar。
     ⇒ 新排法：
       ① 「草稿退化 8 例」提到首条（它同时是「版本与发布 › 发布前检查清单」的第 1 项阻断
          —— 同一件事不再在两处各说一遍：这里给结论，那里给勾选确认）；
       ② 节点结构改成**横向 chip 带**（耗时直接标在节点上），~150 行 JSON 默认收起
          （只有失败节点默认展开 —— 排障时最需要的那个）；
       ③ 与运行监控重复的日志表**不再重复渲染**（agentDetail 里跳过 AGENT_TAB_RENDER.logs），
          只留「本次：tr-… ▾」选择器 + 「去运行监控看全部 →」出口。
     ⚠ 功能一个不少：debug-pick / debug-open / goto-trace / agent-traces / blocked-why
       以及 batchTestBlock 的四象限与全部数字都还在（只是位置与默认展开态变了）。 */
  function agentDebug(a, ai, state, h) {
    var fmt = h.fmt;
    var picked = state.debugTraceId ? F.getTrace(state.debugTraceId) : null;
    if (!picked) {
      var recent = Q.searchTraces('24h', { agentId: a.id }, 1, 1);
      if (recent.rows.length) picked = F.getTrace(recent.rows[0].traceId);
    }
    var variants = [
      { id: null, label: '随机成功调用', filter: { status: 'success' } },
      { id: 'failed', label: '随机失败调用', filter: { status: 'failed' } },
      { id: 'slow', label: '最慢调用（P99 尾部）', filter: { minLatency: 4000 } }
    ];

    /* 「本次看哪一条」选择器：原「选择要回放的调用」整卡压成 <details> 里的一行 + 一个行内下拉。
       三个随机按钮与「粘贴 traceId 直接打开」都保留（debug-pick / debug-open 未变）。 */
    var pickRow = '<div class="pick-row">' +
      variants.map(function (v) {
        return '<button class="pick-btn' + ((v.id || 'ok') === (state.debugPick || 'ok') ? ' on' : '') + '" data-act="debug-pick" data-id="' + h.esc(v.id || 'ok') + '">' + h.esc(v.label) + '</button>';
      }).join('') +
      '<span class="pick-or">或</span>' +
      '<input class="pick-input" id="debug-tid" placeholder="粘贴 traceId 直接打开，如 tr-xxxxxxxx-xxxx" value="' + h.esc(state.debugTraceId || '') + '">' +
      '<button class="btn-ghost" data-act="debug-open">打开</button>' +
      '</div>';

    /* ① 结论置顶：这一屏唯一带结论的那张卡（批量测试）提到第一眼。
       数字与 batchTestBlock 同源（同一个 d 的字面量口径：内置回归集 120 例），不另算一套。 */
    var B = { total: 120, bothPass: 102, fixed: 4, regressed: 8, bothFail: 6 };
    B.baseRate = (B.bothPass + B.regressed) / B.total;
    B.candRate = (B.bothPass + B.fixed) / B.total;
    var focusHtml = '<div class="ov-focus crit" style="border:1px solid #f3c9c9;border-left:3px solid var(--red);' +
      'border-radius:var(--dsw-radius-md);padding:12px 16px;background:#fff;display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">' +
      '<span style="flex:1;min-width:340px">' +
      '<span style="display:block;font-size:15px;font-weight:600;line-height:1.5">草稿比线上基线退化 ' + B.regressed + ' 例（' + B.total + ' 例回归集）</span>' +
      '<span style="display:block;font-size:12px;color:var(--sub);line-height:1.65;margin-top:3px">' +
      '基线 ' + h.esc(a.online) + ' <b>' + fmt.pct1(B.baseRate) + '</b>（' + (B.bothPass + B.regressed) + ' / ' + B.total + '）→ ' +
      '草稿 ' + h.esc(a.online) + '-draft <b>' + fmt.pct1(B.candRate) + '</b>（' + (B.bothPass + B.fixed) + ' / ' + B.total + '）· ↓ <span class="bad">' +
      fmt.pct1(Math.abs(B.candRate - B.baseRate)) + '</span><br>' +
      B.bothPass + ' 两者都通过 · ' + B.fixed + ' 草稿修好了 · <b>' + B.regressed + ' 草稿搞坏了</b> · ' + B.bothFail + ' 两者都失败' +
      '　｜　这 ' + B.regressed + ' 例同时是「版本与发布 › 发布前检查清单」的第 1 项阻断 —— 发布时需勾选「我已知晓退化」</span></span>' +
      '<span style="display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap">' +
      '<button class="btn-ghost" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|versions" title="到版本与发布看发布前检查清单的第 1 项阻断">看发布前检查 →</button>' +
      '<button class="btn-ghost sm btn-off" aria-disabled="true" data-act="blocked-why" data-id="真实回归需在沙盒内跑完整测试集，演示环境不执行；下方为示例结果">运行批量测试</button>' +
      '</span></div>';

    if (!picked) {
      return focusHtml + '<div class="card"><div class="card-h"><h3>本次回放</h3>' +
        '<span class="card-sub">调试轨迹来自真实 trace 数据，不是模拟动画</span></div>' + pickRow +
        '<div class="empty"><div class="empty-ico">' + h.icon('signal', 28) + '</div>' +
        '<div class="empty-title">近 24 小时没有可回放的调用</div>' +
        '<div class="empty-sub">该 Agent 可能刚上线或已下线；试试把时间范围扩大到近 7 天</div></div></div>' +
        '<div class="card"><div class="card-h"><h3>批量测试（回归对比）</h3><span class="card-sub">草稿 vs 线上基线 · 四象限为示例数据</span></div>' +
        batchTestBlock(a, h) + '</div>';
    }

    /* ② 节点：横向 chip 带（耗时直接标在节点上）。点某枚才展开它的输入/输出 JSON —— 
       原来 ~150 行 JSON 铺在明面，现在默认只有**失败节点**展开（排障时最需要的那个）。
       ⚠ 会话与火焰图另放一张卡：展开的 JSON 若落在同一个 flex 行里，会把旁边那一列撑得极长。 */
    var totalSpans = picked.spans.length;
    var sumDur = picked.spans.reduce(function (s, sp) { return s + sp.duration; }, 0);
    var jsonChars = picked.spans.reduce(function (n, sp) {
      return n + C.jsonView(sp.io ? sp.io.input : null).length +
        C.jsonView(sp.error ? '' : (sp.io ? sp.io.output : null)).length +
        (sp.error ? String(sp.error.message + sp.error.stack || '').length : 0);
    }, 0);
    var strip = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:4px 0">' +
      picked.spans.map(function (sp, i) {
        var risky = sp.status === 'failed';
        return '<details' + (risky ? ' open' : '') + ' style="display:inline-block"><summary style="list-style:none;cursor:pointer;' +
          'display:inline-flex;align-items:center;gap:6px;font-size:12px;background:' + (risky ? '#fee2e2' : '#f1f3f7') +
          ';color:' + (risky ? '#991b1b' : 'var(--sub)') + ';border-radius:var(--dsw-radius-pill);padding:4px 12px">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + C.KIND_COLOR[sp.kind] + ';display:inline-block"></span>' +
          h.esc(sp.name) + '<b style="font-weight:600">' + fmt.dur(sp.duration) + '</b>' +
          (sp.tokensIn ? '<span style="color:var(--faint)">' + fmt.int(sp.tokensIn + sp.tokensOut) + ' tok</span>' : '') +
          (risky ? '<span class="pill bad">失败</span>' : '') + '</summary>' +
          '<div class="sp-body">' +
          '<div class="sp-col"><b>输入</b><pre>' + h.esc(C.jsonView(sp.io ? sp.io.input : null)) + '</pre></div>' +
          '<div class="sp-col"><b>输出</b><pre>' + h.esc(sp.error ? '— （节点失败，无输出）' : C.jsonView(sp.io ? sp.io.output : null)) + '</pre></div>' +
          (sp.error ? '<div class="sp-col sp-err"><b>错误</b><pre>' + h.esc(sp.error.message + '\n\nHTTP ' + sp.error.http + ' · 可重试: ' + (sp.error.retryable ? '是' : '否') + ' · 已重试 ' + sp.error.retries + ' 次\n\n' + sp.error.stack) + '</pre></div>' : '') +
          '</div></details>' +
          (i < picked.spans.length - 1 ? '<span style="color:#c9d1e0;font-size:12px;margin:0 4px">→</span>' : '');
      }).join('') + '</div>';

    var traceCard = '<div class="card"><div class="card-h"><h3>本次轨迹 · <span class="mono">' + h.esc(picked.traceId) + '</span></h3>' +
      '<span class="card-sub">' + fmt.dt(picked.ts) + ' · ' + h.esc(picked.version) + ' · ' + h.esc(picked.intentName) +
      ' · ' + totalSpans + ' 个节点 · 端到端 ' + fmt.dur(picked.latencyMs) + '</span>' +
      '<button class="btn-ghost sm" data-act="goto-trace" data-id="' + h.esc(picked.traceId) + '">完整 trace 详情 →</button></div>' +
      strip +
      '<div class="bt-note">点节点展开它的输入 / 输出 JSON（默认只有失败节点展开：这条 trace 的 ' + totalSpans +
      ' 个节点一共 ' + fmt.int(jsonChars) + ' 字符 JSON，原来全部铺在明面，现在按需展开）。' +
      '节点耗时合计 ' + fmt.dur(sumDur) + '（端到端 ' + fmt.dur(picked.latencyMs) + '）。</div></div>' +
      '<div class="card" data-static="1" title="只读说明：本卡是这一条 trace 的会话与执行火焰图（证据呈现），不含可下钻对象 —— 「完整 trace 详情 →」在上一张卡头、「去运行监控看全部」在下一张卡里，本卡不重复挂出口。" style="margin-top:12px"><div class="card-h"><h3>会话与执行火焰图</h3>' +
      '<span class="card-sub">同一条 trace · 只读呈现</span></div><div class="dbg-grid">' +
      '<div class="dbg-conv"><div class="conv-h">会话</div>' +
      '<div class="msg user"><i>用户</i><div>' + h.esc((picked.spans[0] && picked.spans[0].io && picked.spans[0].io.output ? picked.spans[0].io.output.query : '—')) + '</div></div>' +
      (picked.status === 'failed'
        ? '<div class="msg bot fail"><i>' + h.esc(a.name) + '</i><div class="conv-err">本次运行失败于「' + h.esc(failName(picked)) + '」<br><span class="mono">' + h.esc(picked.errName) + '</span></div></div>'
        : '<div class="msg bot"><i>' + h.esc(a.name) + '</i><div>' + h.esc(lastAnswer(picked)) + '</div></div>') +
      '<div class="conv-stat"><span>耗时 ' + fmt.dur(picked.latencyMs) + '</span><span>token ' + fmt.int(picked.tokens) + '（入 ' + fmt.int(picked.tokensIn) + ' / 出 ' + fmt.int(picked.tokensOut) + '）</span><span>成本 ' + fmt.money4(picked.cost) + '</span></div>' +
      '</div>' +
      '<div class="dbg-trace">' + C.flameChart(picked) + '</div>' +
      '</div></div>';

    /* ③ 明细不退化成第二张同构表：原页尾 7 列日志表与「运行监控 › 调用明细」逐字同构，
       这里只留「看哪一条」的入口 + 一条出口；完整明细统一在运行监控（那里有筛选 chip）。 */
    var logsExit = '<div class="card"><div class="card-h"><h3>其他调用</h3>' +
      '<span class="card-sub">本页签不重复渲染调用明细表 —— 它与「运行监控 › 调用明细」是同一张表</span></div>' +
      '<div class="pick-row">' +
      '<button class="btn-ghost" data-act="agent-trace-filter" data-id="failed">只看失败 →</button>' +
      '<button class="btn-ghost" data-act="agent-trace-filter" data-id="all">看全部调用 →</button>' +
      '<button class="btn-ghost" data-act="agent-traces" data-id="' + h.esc(a.id) + '" title="在可观测页按该 Agent 检索全部 trace（可翻页、可按状态筛）">去运行监控 / 可观测看全部 →</button>' +
      '</div>' +
      '<div class="bt-note">原来这里还有一张 25 行 / 184 页的日志表，首行与「运行监控 › 调用明细」逐字相同 —— ' +
      '同一份调用记录在同一个详情页的两个页签各渲染一遍。现在只在这里留「换一条回放」的选择器，' +
      '明细统一由运行监控页签承担（那里有「全部 / 只看失败 / 只看灰度」筛选 chip）。</div>' +
      '<details class="ov-fold" style="margin-top:12px"><summary>换一条回放：随机成功 / 随机失败 / 最慢（P99 尾部）/ 打开指定 traceId</summary>' +
      '<div class="ov-fold-body">' + pickRow + '</div></details></div>';

    return focusHtml + traceCard +
      '<div class="card"><div class="card-h"><h3>批量测试（回归对比）</h3><span class="card-sub">草稿 vs 线上基线 · 下方四象限为示例数据</span>' +
      '<button class="btn-ghost sm btn-off" aria-disabled="true" data-act="blocked-why" data-id="真实回归需在沙盒内跑完整测试集，演示环境不执行；下方为示例结果">运行批量测试</button></div>' +
      batchTestBlock(a, h) + '</div>' +
      logsExit;
  }
  function failName(t) { for (var i = 0; i < t.spans.length; i++) if (t.spans[i].status === 'failed') return t.spans[i].name; return '—'; }
  function lastAnswer(t) {
    for (var i = t.spans.length - 1; i >= 0; i--) {
      var o = t.spans[i].io && t.spans[i].io.output;
      if (o && o.text) return o.text;
      if (o && o.delivered) continue;
    }
    return '（输出节点未记录文本内容）';
  }

  /** 回归对比四象限：数据来自真实评估口径，退化项默认展开标红 */
  function batchTestBlock(a, h) {
    var fmt = h.fmt;
    var d = { total: 120, bothPass: 102, fixed: 4, regressed: 8, bothFail: 6 };
    d.baseRate = (d.bothPass + d.regressed) / d.total;
    d.candRate = (d.bothPass + d.fixed) / d.total;
    return '<div class="bt-sum">' +
      '<div class="bt-rate"><i>基线 ' + h.esc(a.online) + '</i><b>' + fmt.pct1(d.baseRate) + '</b><span>' + (d.bothPass + d.regressed) + ' / ' + d.total + ' 通过</span></div>' +
      '<div class="bt-arrow">→</div>' +
      '<div class="bt-rate cand"><i>草稿 ' + h.esc(a.online) + '-draft</i><b>' + fmt.pct1(d.candRate) + '</b><span>' + (d.bothPass + d.fixed) + ' / ' + d.total + ' 通过</span></div>' +
      '<div class="bt-delta ' + (d.candRate < d.baseRate ? 'bad' : 'ok') + '">' + (d.candRate >= d.baseRate ? '↑' : '↓') + ' ' + fmt.pct1(Math.abs(d.candRate - d.baseRate)) + '</div>' +
      '</div>' +
      '<div class="bt-quad">' +
      '<div class="q ok"><b>' + d.bothPass + '</b><span>两者都通过</span></div>' +
      '<div class="q up"><b>' + d.fixed + '</b><span>草稿修好了</span></div>' +
      '<div class="q down" data-open="1"><b>' + d.regressed + '</b><span>草稿搞坏了 ⚠</span></div>' +
      '<div class="q bad"><b>' + d.bothFail + '</b><span>两者都失败</span></div>' +
      '</div>' +
      (d.regressed > 0 ? '<div class="bt-warn">⚠ 存在 ' + d.regressed + ' 例退化用例（原通过、现失败）。发布时需勾选「我已知晓退化」才能继续，' +
        '且这 ' + d.regressed + ' 例会默认展开在退化清单顶部。</div>' : '') +
      '<div class="bt-note">测试集：内置回归集 120 例（含 34 例由历史 badcase 转入）。对比为同一输入下的输出差异，逐条可看 diff。</div>';
  }

  /* ============ 版本与发布重排（形态稿第 4 屏，2026-10-12）============
     旧排法（实测 8KB / 2 表 / 28 按钮 / 10 卡 / **2 个 metaBar**）：
     「版本历史」（6 列）与「发布历史」（5 列）是**同一份 3 行版本数据渲染两遍**，
     两块加起来不到 8 行的信息占了一屏的一半；而三条会直接卡住「全量发布」的判断
     ——「灰度 +0.46pp 不显著（p=0.2582）」「批量测试 8 例退化」「成本 +36% 超日均阈值」
     —— 全是卡内小字，跟 5 个平铺的动作按钮不在一个视线上。
     ⇒ 新排法：
       ① 结论置顶成一条（含样本量与 z 值 + 两项阻断），危险度决定按钮位置：
          「调高比例 / 全量发布」留在首条，「暂停 / 回滚」折进展开区；
       ② 版本时间线**合一**（「流量占比 / 操作」用右上角列开关控制显隐，同构合并）；
       ③ 灰度对比明细折进展开区（三根对比条 + 全部动作一个不少）；
       ④ 2 个 metaBar 合一（版本记录来源 + 统计范围）。
     ⚠ 被吸收的「发布历史」渲染器（renderers2.js 的 AGENT_TAB_RENDER.history）在
       agentDetail 里**跳过调用**：它就是同一份版本数据的第二遍渲染，且自带第二个 metaBar。 */
  function agentVersions(a, ai, state, h) {
    var fmt = h.fmt;
    var gray = a.grayVersion ? Q.grayCompare(a.id, state.range) : null;
    /* 两列**默认显示**：形态稿强调"重排不能弄丢出口" —— 画布 / diff / 回滚是本页签唯一的
       版本级出口，不能靠一个默认关着的开关把它们藏起来。关（state.verCols===false）后表格回到
       5 列紧凑形态（版本/状态/发布时间/发布人/变更说明），动作一键可找回。 */
    var showCols = state.verCols !== false;
    var versions = [
      { v: a.online, status: a.grayVersion ? 'partial' : 'online', ratio: a.grayVersion ? (1 - a.grayRatio) : 1, date: F.fmtDate(S.TODAY_START + a.publishedAt * S.DAY), by: Q.ownerName(a.owner), note: '当前线上版本', gray: false },
      { v: prevVer(a.online), status: 'history', ratio: 0, date: F.fmtDate(S.TODAY_START + (a.publishedAt - 42) * S.DAY), by: Q.ownerName(a.owner), note: '已被 ' + a.online + ' 替换', gray: false }
    ];
    if (a.grayVersion) versions.unshift({ v: a.grayVersion, status: 'gray', ratio: a.grayRatio, date: '灰度中', by: Q.ownerName(a.owner), note: '升级模型 + 新增合规检查节点', gray: true });

    /* 每条版本三类动作全保留：画布 / diff 人人有，回滚只给历史版本 —— 这三枚是本页签唯一的
       版本级出口，所以「操作」列**默认显示**（见上），开关（agent-ver-cols）只负责在
       「7 列 / 5 列」两种形态间切换，不承担"藏出口"的职责。 */
    var verCols = [
      { key: 'v', label: '版本', render: function (r) { return '<b>' + h.esc(r.v) + '</b>'; } },
      { key: 'statusText', label: '状态', render: function (r) { return h.pill(r.status === 'gray' ? 'info' : (r.status === 'online' ? 'ok' : (r.status === 'partial' ? 'warn' : 'idle')), r.status === 'gray' ? '灰度中' : (r.status === 'online' ? '线上' : (r.status === 'partial' ? '线上 ' + Math.round(r.ratio * 100) + '%' : '历史'))); } },
      { key: 'date', label: '发布时间' },
      { key: 'by', label: '发布人' },
      { key: 'note', label: '变更说明' }
    ];
    if (showCols) {
      verCols.splice(4, 0, { key: 'ratio', label: '流量占比', align: 'right', render: function (r) { return fmt.pct1(r.ratio); } });
      verCols.push({ key: 'act', label: '操作', render: function (r) {
        return '<button class="lnk" data-act="ver-diff" data-id="' + h.esc(r.v) + '|canvas">画布</button> · ' +
          '<button class="lnk" data-act="ver-diff" data-id="' + h.esc(r.v) + '|diff">diff</button>' +
          (r.status === 'history' ? ' · <button class="lnk warn" data-act="agent-rollback" data-id="' + h.esc(a.id) + '|' + h.esc(r.v) + '">回滚</button>' : '');
      } });
    }
    var vHtml = h.table({ columns: verCols, rows: versions, noPaging: true });

    var sg = gray ? gray.significance : null;
    /* 自动回滚线**已登记**在 decisions.js（自进化.自动回滚条件，值 '成功率<98% 或 P99>4s'）
       —— 这里继续引用它，不再内联一份手写副本（同一根线两处写必然漂移）。
       ⚠ 取不到时如实说"未登记"，**不退回字面量**：宁可在界面上暴露缺口，也不偷偷造一条线。 */
    var _DECI2 = global.DECISIONS;
    var RB = (_DECI2 && _DECI2.value) ? _DECI2.value('自进化', '自动回滚条件') : null;
    var MINW = (_DECI2 && _DECI2.value) ? _DECI2.value('灰度', '最小观察期') : 60;

    /* --- ① 结论置顶：这一屏唯一的问题「现在能不能全量发」 --- */
    var blockers = ['批量测试 8 例退化用例', '成本预估 +36%（已超业务线日均阈值）'];
    var focusHtml;
    if (gray) {
      var verdict = sg.significant ? '可以全量发布：灰度差异达到统计显著' : '暂不建议全量：灰度样本量不足，差异不显著';
      var focusSub = h.esc(gray.meta.grayVersion) + ' <b>' + fmt.pct2(gray.gray.successRate) + '</b> vs ' +
        h.esc(gray.meta.onlineVersion) + ' <b>' + fmt.pct2(gray.online.successRate) + '</b>（' +
        (gray.diff.successRate >= 0 ? '+' : '') + (gray.diff.successRate * 100).toFixed(2) + 'pp）· ' +
        'P99 ' + fmt.dur(gray.gray.p99) + ' vs ' + fmt.dur(gray.online.p99) + ' · ' +
        'n(灰度)=' + fmt.int(gray.gray.calls) + ' / n(对照)=' + fmt.int(gray.online.calls) +
        ' · z=' + h.esc(sg.z) + ' · <b>p=' + h.esc(sg.p) + '</b><br>' +
        '另有 ' + blockers.length + ' 项发布阻断项：' + h.esc(blockers.join(' · '));
      focusHtml = '<div class="ov-focus ' + (sg.significant ? '' : 'crit') + '" style="border:1px solid ' +
        (sg.significant ? 'var(--line)' : '#f3c9c9') + ';border-left:3px solid ' +
        (sg.significant ? 'var(--green)' : 'var(--red)') + ';border-radius:var(--dsw-radius-md);' +
        'padding:12px 16px;background:#fff;display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">' +
        '<span style="flex:1;min-width:340px">' +
        '<span style="display:block;font-size:15px;font-weight:600;line-height:1.5">' + h.esc(verdict) + '</span>' +
        '<span style="display:block;font-size:12px;color:var(--sub);line-height:1.65;margin-top:3px">' + focusSub + '</span></span>' +
        '<span style="display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap">' +
        '<button class="btn-ghost" data-act="agent-gray" data-id="' + h.esc(a.id) + '|up">调高比例</button>' +
        '<button class="btn-primary" data-act="agent-gray" data-id="' + h.esc(a.id) + '|full">全量发布</button>' +
        '</span></div>';
    } else {
      focusHtml = '<div class="ov-focus" style="border:1px solid var(--line);border-left:3px solid var(--green);' +
        'border-radius:var(--dsw-radius-md);padding:12px 16px;background:#fff;display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">' +
        '<span style="flex:1;min-width:340px">' +
        '<span style="display:block;font-size:15px;font-weight:600;line-height:1.5">当前无灰度版本 · 线上全量 ' + h.esc(a.online) + '</span>' +
        '<span style="display:block;font-size:12px;color:var(--sub);line-height:1.65;margin-top:3px">' +
        '没有灰度在跑，因此没有「能不能转全量」的决策；要发新版本请走「发布上线」。</span></span>' +
        '<button class="btn-ghost" data-act="agent-precheck" data-id="' + h.esc(a.id) + '">预检</button></div>';
    }

    /* --- ② 版本时间线（合一） --- */
    var verCard = '<div class="card"><div class="card-h"><h3>版本时间线</h3>' +
      '<span class="card-sub">' + versions.length + ' 条 · 草稿保存不产生新版本号，仅提交发布才固化</span>' +
      '<div class="view-sw" role="group"><button class="vs-btn' + (showCols ? ' on' : '') + '" data-act="agent-ver-cols" data-id="1" aria-pressed="' +
      (showCols ? 'true' : 'false') + '" title="显示/隐藏「流量占比」与「操作（画布 / diff / 回滚）」两列">' +
      (showCols ? '显示：流量占比 + 操作 ☑' : '显示：流量占比 + 操作 ☐') + '</button></div></div>' + vHtml +
      /* 2026-10-18（业主「自述腔」）：这里原来写着"原来「版本历史」与「发布历史」是同一份 3 行数据渲染两遍…
         现在合成一条时间线"——那是给改版过程留的说明，用户不需要知道我们合并过什么。只留来源口径。 */
      '<div class="bt-note">版本记录来自该 Agent 的线上 / 灰度版本字段，不含变更单号。</div></div>';

    /* --- ③ 灰度对比明细 + 全部动作（折进展开区）--- */
    var grayHtml = '';
    if (gray) {
      grayHtml = '<details class="ov-fold"' + (sg.significant ? '' : ' open') + '><summary>灰度对比明细与全部灰度操作　<span class="n">' +
        h.esc(gray.meta.grayVersion) + ' vs ' + h.esc(gray.meta.onlineVersion) + ' · 灰度比例 ' + Math.round(gray.ratio * 100) +
        '% · ' + h.esc(gray.meta.range.rangeLabel) + '</span></summary><div class="ov-fold-body">' +
        '<div class="gray-wrap">' +
        '<div class="gray-bars">' +
        C.compareBar('成功率', gray.gray.successRate, gray.online.successRate, { fmt1: fmt.pct2, diffText: (gray.diff.successRate >= 0 ? '+' : '') + (gray.diff.successRate * 100).toFixed(2) + 'pp' }) +
        C.compareBar('P99 时延', gray.gray.p99, gray.online.p99, { fmt1: fmt.dur, higherIsBetter: false, diffText: (gray.diff.p99 >= 0 ? '+' : '') + (gray.diff.p99 * 100).toFixed(1) + '%' }) +
        C.compareBar('调用量', gray.gray.calls, gray.online.calls, { fmt1: fmt.compact, noDiff: true, diffText: '样本量' }) +
        '</div>' +
        '<div class="gray-sig ' + (sg.significant ? 'ok' : 'warn') + '">' +
        '<b>' + (sg.significant ? '✓ 差异达到统计显著' : '⚠ 差异尚未达到统计显著') + '</b>' +
        '<span>' + h.esc(sg.reason) + '</span>' +
        '<span class="sig-detail">z = ' + h.esc(sg.z) + ' · p = ' + h.esc(sg.p) + ' · ' + h.esc(sg.sampleNote) + '</span>' +
        '<span class="sig-hint">灰度组样本量仅 ' + fmt.int(gray.gray.calls) + '，对照组 ' + fmt.int(gray.online.calls) + '。' +
        (sg.significant ? '可基于此数据做转全量决策。' : '此时不建议据成功率差异做决策 —— 需继续观察或提高灰度比例。') + '</span>' +
        '</div></div>' +
        '<div class="gray-acts">' +
        '<button class="btn-ghost" data-act="agent-gray" data-id="' + h.esc(a.id) + '|down">调低比例</button>' +
        '<button class="btn-ghost" data-act="agent-gray" data-id="' + h.esc(a.id) + '|up">调高比例</button>' +
        '<button class="btn-ghost" data-act="agent-gray" data-id="' + h.esc(a.id) + '|pause">' + (agOv(state, a.id).paused ? '恢复灰度' : '暂停灰度') + '</button>' +
        '<button class="btn-danger" data-act="agent-gray" data-id="' + h.esc(a.id) + '|rollback">立即回滚</button>' +
        '<button class="btn-primary" data-act="agent-gray" data-id="' + h.esc(a.id) + '|full">全量发布</button>' +
        '</div>' +
        /* v34（业主清单第 ⑥ 项）：这一行原先是**只读陈列** —— 条件只当提示印出来，
           写着"未接入自动执行"却没有编辑入口。现在条件可调，方向决定风险档
           （收紧 = 低风险即时生效；放宽 = 高危，强制填理由），并明确"只登记规则、
           不假装已接入执行"。规则默认值仍取自 decisions.js（唯一真源）。 */
        ((global.V34PERM && global.V34PERM.ruleLine)
          ? global.V34PERM.ruleLine(a, state, h)
          : '<div class="gray-rules">自动回滚条件：' + (RB ? h.esc(RB) : '未在 decisions.js 登记') +
            '（当前为示例条件，未接入自动执行）。比例调整有 ' + (MINW != null ? h.esc(String(MINW)) : '未登记') +
            ' 分钟最小观察期，防止直接拉到 100%。回滚后不会自动重试灰度，需人工确认原因。</div>') +
        '</div></div></details>';
    }

    return focusHtml + verCard + grayHtml +
      '<div class="card" id="ag-checklist" data-static="1" title="只读说明：本清单是**示例数据**（见卡头「未接入真实校验」），非真实校验结果，因此不给出口 —— 接了会把示例结论当成事实。真实校验入口在编排 Tab 的「静态校验」。"><div class="card-h"><h3>发布前检查清单</h3><span class="card-sub">示例数据 · 未接入真实校验</span></div>' +
      '<ul class="check-list">' +
      '<li class="pass">✓ 静态校验通过（0 阻断 / 2 警告）</li>' +
      '<li class="pass">✓ 依赖可用性：3 个知识库、2 个 MCP 服务均可访问</li>' +
      '<li class="warn">⚠ 批量测试存在 8 例退化用例，发布时需勾选确认（同一件事在「调试与日志」首条已给结论，这里不重复展开）</li>' +
      '<li class="pass">✓ 必备评估：安全维度 91 分 ≥ 阈值 85</li>' +
      '<li class="warn">⚠ 成本预估 +36%（模型升级导致），已超业务线日均阈值</li>' +
      '</ul>' +
      '<div class="bt-note">发布后草稿固化为新版本，要改再开一份新草稿。</div></div>';
    /* ⚠ metaBar：本函数**不再**输出任何 meta-bar。
       原来这里还有一个「版本记录来源」的独立 meta-bar（stats.metaBar(res.meta, …)），
       与本函数上方的口径块叠成两块 —— 实测该页签有 2 个 metaBar。
       现在版本记录来源已并入「版本时间线」卡的脚注（见上），页脚只剩 agentDetail 主分发器
       那一条（9 项）。它在本函数之外、本函数拿不到也不能删 —— 要真正"合成一条"需主分发器配合
       （见交付报告「需拍板」）。 */
  }
  function prevVer(v) {
    var m = /^v(\d+)\.(\d+)$/.exec(v);
    if (!m) return v;
    var minor = Number(m[2]) - 1;
    return minor >= 0 ? 'v' + m[1] + '.' + minor : 'v' + (Number(m[1]) - 1) + '.0';
  }

  /* SECTION: svc-identity
   * 网关接入服务的**身份标记**（MCP 服务 + LLM 路由）。
   * 单一真源是 seed：MCP_SERVICES[i] 的 icon/tone/purpose、MODELS[i] 的 tier/tierText。
   * 这里只负责把它渲染成一个带色相的图标块 —— 健康墙、Agent 详情的依赖表、
   * 网关详情页头、模型清单四处共用，免得各画一套、长得还不一样。 */
  var TIER_TONE = { flagship: 'purple', balance: 'blue', economy: 'teal', embed: 'indigo' };
  var TIER_TEXT = { flagship: '旗舰', balance: '均衡', economy: '经济', embed: '向量' };
  var SVC_META = null;
  function svcMeta(id) {
    if (!SVC_META) {
      SVC_META = {};
      (S.MCP_SERVICES || []).forEach(function (m) { SVC_META[m.id] = m; });
      /* 网关详情页给模型分配的对象 id 是 'llm-' + modelId（见 v10-detail-flow.js 的 gwObjects） */
      (S.MODELS || []).forEach(function (m) {
        SVC_META['llm-' + m.id] = {
          id: 'llm-' + m.id, name: 'llm://' + m.name, icon: 'chip',
          tone: TIER_TONE[m.tier] || 'blue', purpose: (m.tierText || TIER_TEXT[m.tier] || '') + '模型'
        };
      });
    }
    return SVC_META[id] || null;
  }
  /** 详情页头要的是图标名（它自己调 h.icon），所以单独给一个取名的口子 */
  function svcIconName(id) { var m = svcMeta(id); return (m && m.icon) || 'chat'; }
  /** 带色相的图标块。size='sm' 用于表格行内（20px），默认 26px 用于卡片头 */
  function svcTag(h, id, size) {
    var m = svcMeta(id);
    if (!m) return '<span class="svc-ico' + (size === 'sm' ? ' sm' : '') + ' t-idle">' + h.icon('chat', size === 'sm' ? 12 : 15) + '</span>';
    return '<span class="svc-ico' + (size === 'sm' ? ' sm' : '') + ' t-' + h.esc(m.tone || 'blue') + '"' +
      ' title="' + h.esc((m.purpose || m.name) + '（' + m.name + '）') + '">' + h.icon(m.icon, size === 'sm' ? 12 : 15) + '</span>';
  }

  /* 渲染后钩子（app.js 在 bindContent 之后调用，与 __hallBoot 同一模式）：
     执行轨迹的链路比中栏宽 —— 7 个节点在 1440 视口下放不进 1078px，
     默认停在最左边看到的是一条绿色链路，真正要看的红色终点反而在滚动区外。
     这里只做"失败节点不在视口内就把它滚进来"，不动数据、不改顺序。 */
  /* 执行轨迹是一叠横排流水（一次一行）：每行失败卡若被横向滚出视野，把它滚进来。 */
  global.__tfBoot = function () {
    var boxes = document.querySelectorAll('.tf-scroll');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var hot = box.querySelector('.tf-node.is-fail');
      if (!hot) continue;
      var b = box.getBoundingClientRect(), n = hot.getBoundingClientRect();
      if (n.right > b.right - 12) box.scrollLeft += (n.right - b.right) + 24;
      else if (n.left < b.left + 12) box.scrollLeft -= (b.left - n.left) + 24;
    }
  };

  global.RENDERERS = RENDERERS;
  global.ACTIONS = ACTIONS;
  // 供 renderers2.js 复用的公共构造器（跨文件闭包不可见，必须显式导出）
  global.UI = {
    pageHead: pageHead, tabBar: tabBar, sessionNewBlock: sessionNewBlock, sessionRows: sessionRows,
    svcMeta: svcMeta, svcIconName: svcIconName, svcTag: svcTag,
    tierText: function (tier) { return TIER_TEXT[tier] || tier || ''; }
  };
  global._R_PART1 = true;
})(window);
