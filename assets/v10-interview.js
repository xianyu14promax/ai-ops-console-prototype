/* SECTION: r-interview-workbench  (v10 · AI 访谈作业台)
 * 设计稿：作业台首页 + 六视图（访谈编排 / 过程监控 / 访谈记录 / 访谈审核 / 结论与分析 / 历史访谈）
 *
 * 原则（按需求定的）：
 *   · 每个页都是工作台：进来就知道该干什么、在这儿就能干完、干完看得见、干不成说清为什么
 *   · 模拟数据当真数据用：状态、流转、口径都按真实产品的说法写；分析类数字留分析接口（见 metaBar）
 *   · 只做前端：导出用 Blob 真下载；会话内的处置写 sessionStorage；不假装写进服务端
 *
 * 本文件只注册 RENDERERS.interviewHome / RENDERERS.interviewDetail 与 ACTIONS['iv-*']。
 */
(function (global) {
  'use strict';

  var R = global.RENDERERS, A = global.ACTIONS, S = global.DATA_SEED;
  var V = global.V10UI || {};

  /* ---------------- 常量：联系状态就按用户给的五个字 ---------------- */
  var STATES = [
    { k: 'pending',     t: '未联系',     tone: 'idle' },
    { k: 'dialing',     t: '正在联系中', tone: 'info' },
    { k: 'interrupted', t: '联系中断',   tone: 'warn' },
    { k: 'unreachable', t: '联系不上',   tone: 'bad'  },
    { k: 'done',        t: '联系完成',   tone: 'ok'   }
  ];
  var STATE_LABEL = {};
  STATES.forEach(function (x) { STATE_LABEL[x.k] = x.t; });

  var CH_LABEL = { wecom: '企微', sms: '短信', im: 'IM', phone: '电话' };
  var ABORT_REASONS = ['命中禁问项（承诺折扣）', '被访者明确拒绝', '连续 2 轮未回复', '越界承诺', '超时', '人工中止'];
  var SEGS = (S.SEGMENTS || []).slice(0, 4);

  /* 标签字典（设计稿里的示例数据；口径/来源/责任人/更新频率都写出来，
     且不拿画像的"覆盖企业数"当人数 —— 那是工程里明令禁止的旧错） */
  var TAGS = [
    { g: '合同与商务', n: '合同到期前 60 天', c: 2982, src: 'CRM 合同表', own: '—', freq: '每日', d: '合同结束日期 − 今天 ≤ 60 天' },
    { g: '合同与商务', n: '年采购额 > 1000 万', c: 1140, src: 'CRM 订单表', own: '—', freq: '每日', d: '近 12 个月已回款金额 > 1000 万' },
    { g: '合同与商务', n: '账期敏感', c: 640, src: '合同条款解析', own: '—', freq: '每周', d: '条款中含账期诉求或曾提账期' },
    { g: '使用与健康', n: '近 30 天活跃下降 > 40%', c: 1876, src: '产品埋点', own: '—', freq: '每小时', d: '近 30 日活跃天数较前 30 日下降 > 40%' },
    { g: '使用与健康', n: '工单未闭环 ≥ 2 条', c: 402, src: '工单系统', own: '—', freq: '每小时', d: '未结工单数 ≥ 2' },
    { g: '声音与反馈', n: '近 90 天有负面反馈', c: 733, src: '客服会话 + 投诉', own: '—', freq: '每日', d: '情感判定偏负或投诉工单 > 0' }
  ];

  /* 话题树（这就是"给 AI 的交待"） */
  var OUTLINE = {
    form: 'topic',
    opening: '您好，我是客户成功顾问小艾，想占用您 10 分钟聊聊这半年的使用情况，可以吗？',
    closing: '感谢您的时间，我会把您提到的问题整理给产品团队，有进展同步给您。',
    forbidden: ['不承诺折扣或价格', '不谈未发布功能'],
    maxChars: 200,
    maxRounds: 24,
    topics: [
      { id: 't1', name: '续约意愿', must: true, ban: false, asks: ['这半年整体用下来，续约的意向如何', '如果今年不续，主要顾虑是什么'] },
      { id: 't2', name: '使用障碍', must: false, ban: false, asks: ['哪一步最费时间', '有没有卡住最后没做成的场景'] },
      { id: 't3', name: '竞品对比', must: true, ban: false, asks: ['最近有没有在看别的方案', '对比下来最在意哪一点'] },
      { id: 't4', name: '价格预期', must: false, ban: true, asks: [] }
    ],
    kbs: [
      { id: 'kb-product', name: '产品文档库', mode: '必引', why: '回答问题涉及功能与限制时必须有出处' },
      { id: 'kb-script', name: '销售话术库', mode: '参考', why: '话术基调与分寸参考' },
      { id: 'kb-case', name: '售后案例库', mode: '不用', why: '本场访谈不涉及售后纠纷' }
    ]
  };

  var INTERVIEWERS = [
    { id: 'ai-1', name: '续约访谈员 · 小艾', model: 'qwen-plus', ver: 'v3', seats: 2, good: '续约 / 价格', bind: true },
    { id: 'ai-2', name: '体验访谈员 · 小验', model: 'qwen-max', ver: 'v2', seats: 1, good: '使用障碍 / 体验', bind: false }
  ];

  /* ---------------- 工具 ---------------- */
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function pad2(n) { var s = String(n); return s.length < 2 ? '0' + s : s; }
  function esc(h, s) { return h.esc(s == null ? '' : s); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  function pill(h, kind, text) {
    return typeof h.pill === 'function' ? h.pill(kind, text) : '<span class="pill ' + kind + '">' + h.esc(text) + '</span>';
  }
  function segName(id) {
    for (var i = 0; i < SEGS.length; i++) if (SEGS[i].id === id) return SEGS[i].name;
    return id || '未分层';
  }

  /* ---------------- 生成"当真数据用"的示例数据（确定性） ---------------- */
  var SURNAME = ['李', '王', '张', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马'];
  function maskName(r) { return pick(r, SURNAME) + '**'; }
  function maskPhone(r) { return '1' + (3 + Math.floor(r() * 6)) + '****' + pad2(Math.floor(r() * 100)) + pad2(Math.floor(r() * 100)); }

  /** 联系状态怎么分：按任务真实状态给（草稿=还没联系；进行中=各种都有；已完成=绝大多数谈完），
   *  并且**用最大余数法凑到刚好等于计划人数** —— 免得首页汇总与详情页面各说一套。 */
  function stateMix(row) {
    var st = row.status;
    if (st === 'warn') return { pending: 1, dialing: 0, interrupted: 0, unreachable: 0, done: 0 };   /* 草稿 = 还没开始联系 */
    if (st === 'info') return { pending: 0.26, dialing: 0.18, interrupted: 0.09, unreachable: 0.05, done: 0.42 };
    return { pending: 0.02, dialing: 0.04, interrupted: 0.05, unreachable: 0.08, done: 0.81 };
  }
  function distribute(total, ws) {
    var out = [], acc = 0, i;
    for (i = 0; i < ws.length; i++) { var v = Math.floor(total * ws[i]); out.push(v); acc += v; }
    var rem = total - acc;
    var order = ws.map(function (w, k) { return { k: k, w: w }; }).sort(function (a, b) { return b.w - a.w; });
    for (i = 0; i < rem; i++) out[order[i % order.length].k]++;
    return out;
  }

  /** 一场访谈的联系人清单 + 联系状态分布（人群规模取任务真实字段 reached） */
  function buildContacts(row, cap) {
    var r = S.R.of('iv-mix|' + row.id);
    var reached = num(row.reached, 0) || 620;
    var mix = stateMix(row);
    var keys = ['pending', 'dialing', 'interrupted', 'unreachable'];
    /* 联系完成 = 已回复（同一个口径，不另造一个数）：草稿态还没开始联系，所以是 0 */
    var done = row.status === 'warn' ? 0 : Math.min(reached, Math.max(0, num(row.replied, 0)));
    var rest = Math.max(0, reached - done);
    var ws = keys.map(function (k) { return mix[k] * (0.9 + r() * 0.2); });
    var tot = ws.reduce(function (a, b) { return a + b; }, 0);
    var vals = distribute(rest, ws.map(function (w) { return w / tot; }));
    var funnel = keys.map(function (k, i) { return { k: k, n: vals[i] }; });
    funnel.push({ k: 'done', n: done });

    /* 明细行按同一份分布生成（表里就是这个规模，分页看；不再另造 40 条样本） */
    var maxRows = reached, out = [], idx = 0;
    funnel.forEach(function (f, ki) {
      var k = f.k, cnt = Math.min(f.n, Math.max(0, maxRows - out.length));
      for (var j = 0; j < cnt; j++) {
      var rr = S.R.of('iv-c|' + row.id + '|' + idx);
        var seg = SEGS.length ? SEGS[Math.floor(rr() * SEGS.length) % SEGS.length] : { id: 'na', name: '未分层' };
        var aborted = k === 'done' && rr() < 0.02;
        var rounds = k === 'done' ? (3 + Math.floor(rr() * 6)) : (k === 'pending' ? 0 : Math.floor(rr() * 4));
        var rv = k !== 'done' ? 'draft' : (aborted ? 'pending-review' : (rr() < 0.12 ? 'pending-review' : 'approved'));
        out.push({
          id: 'ct-' + pad2(idx + 1), name: maskName(rr), phone: maskPhone(rr), seg: seg,
          channel: pick(rr, ['wecom', 'sms', 'wecom', 'phone']),
          state: k, rounds: rounds, durMin: 2 + Math.floor(rr() * 9),
          owner: INTERVIEWERS[Math.floor(rr() * INTERVIEWERS.length) % INTERVIEWERS.length].name,
          lastAt: k === 'interrupted' ? -(12 + Math.floor(rr() * 96)) : -(Math.floor(rr() * 72)),
          tryN: k === 'unreachable' ? 3 : (k === 'interrupted' ? 1 + Math.floor(rr() * 2) : 1),
          aborted: aborted, abortReason: aborted ? pick(rr, ABORT_REASONS.slice(0, 4)) : null,
          review: rv, flags: aborted ? ['命中禁问'] : (rr() < 0.12 ? ['负面情绪'] : [])
        });
        idx++;
      }
    });
    return { rows: out, funnel: funnel, total: reached, replied: num(row.replied, 0), consulted: num(row.consulted, 0) };
  }

  /** 待审 = 待审结论 + 异常中止（口径只写一次，角标/队列/表格都用它） */
  /** 待审队列：**关键人群全审**（命中禁问 / 低质量 / 负面 / 被接管 / 中断超时），并按优先级置顶 */
  function auditQueue(wb) {
    var must = wb.rows.filter(function (c) {
      return c.review === 'pending-review' || c.aborted || c.quality === '低质量' || (c.flags && c.flags.length);
    });
    function prio(c) {
      if (c.aborted) return 0;
      if (c.quality === '低质量') return 1;
      if (c.flags && c.flags.length) return 2;
      if (c.state === 'interrupted' && c.lastTryH >= 72) return 3;
      return 4;
    }
    return must.sort(function (a, b) { return prio(a) - prio(b) || b.rounds - a.rounds; });
  }
  /* 人工校正（1–5 打标）落在本会话：刷新还在，关标签页失效 —— 前端只能保证到这儿 */
  function starKey(id) { return 'aiops:iv:stars:' + (id || 'unknown'); }
  function loadStars(id) {
    try {
      var raw = global.sessionStorage ? global.sessionStorage.getItem(starKey(id)) : null;
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveStars(id, obj) {
    try { if (global.sessionStorage) global.sessionStorage.setItem(starKey(id), JSON.stringify(obj || {})); return true; } catch (e) { return false; }
  }
  function abortList(wb) { return wb.rows.filter(function (c) { return c.aborted; }); }

  /** 逐人会话时间线（每轮带：谁说的 / 追问理由 / 引用的知识库片段） */
  function buildTurns(row, ct) {
    var r = S.R.of('iv-turn|' + row.id + '|' + ct.id);
    var QA = [
      { t: '续约意愿', q: '这半年整体用下来，续约的意向如何？', a: '还在评估，主要是想把权限这块先理顺。', fup: '“理顺”具体指哪一步？', why: '回答停留在结论层，缺少可归因的事实', kb: { doc: '产品文档库 §权限模型 3.2', score: 0.82 } },
      { t: '使用障碍', q: '哪一步最费时间？', a: '导出几十万行要等很久，基本得排队。', fup: '您一般什么场景要导这么多行？', why: '提到性能问题但未说明场景', kb: { doc: '产品文档库 §批量导出 2.3', score: 0.91 } },
      { t: '竞品对比', q: '最近有没有在看别的方案？', a: '有看一家，主要是他们按字段级权限卖。', fup: '如果我们也做到字段级，您还会考虑换吗？', why: '出现竞品，需要确认决策权重', kb: { doc: '销售话术库 §竞品应对 · 权限', score: 0.77 } },
      { t: '价格预期', q: '预算上大概是什么节奏？', a: '这个我不好说，得走采购。', fup: '采购一般卡在哪一步？', why: '未提及具体决策链', kb: null }
    ];
    var n = Math.max(1, Math.min(QA.length, ct.rounds || 3));
    var out = [], i;
    for (i = 0; i < n; i++) {
      var q = QA[i], rr = S.R.of('iv-t|' + ct.id + '|' + i);
      out.push({ role: 'ai', topic: q.t, text: q.q, kb: null });
      out.push({ role: 'user', text: q.a });
      if (rr() < 0.75) {
        out.push({ role: 'ai', topic: q.t, text: q.fup, why: q.why, kb: q.kb, round: i + 1 });
        out.push({ role: 'user', text: pick(rr, ['就是刚才说的那个口径问题。', '我们内部流程比较长，得先过安全。', '这个我记不太清了，回头问下同事。']) });
      }
      if (ct.aborted && i === n - 1) out.push({ role: 'stop', text: '命中禁问项：AI 试图承诺折扣，已中止本场并留痕', reason: ct.abortReason });
    }
    return out;
  }

  /* 审计：走工程既有抽屉（V10UI.audit）。不可用时不阻断操作 —— 但绝不假装记了。 */
  function audit(log) {
    var u = global.V10UI || {};
    if (typeof u.audit === 'function') { try { u.audit(log); } catch (e) { /* 审计不可用 */ } }
  }

  /* ---------- 数据层（唯一出口）：明细、分布、会话都从 IV_DATA 取，本页不再自己造数 ---------- */
  var IVD = global.IV_DATA || {};
  function workbench(row) {
    var a = IVD.accounts ? IVD.accounts(row) : null;
    return {
      rows: IVD.contacts ? IVD.contacts(row) : [],
      funnel: a ? a.funnel : [],
      total: a ? a.plan : 0,
      replied: a ? a.done : 0,
      consulted: a ? a.effective : 0,
      accounts: a
    };
  }
  function dataTurns(row, ct) { return IVD.turns ? IVD.turns(row, ct) : []; }

  /* ---------------- 原子组件 ---------------- */
  function crumb(h, cap, row) {
    /* v10b：修复域段错误 —— 原来硬编码 {text:'引擎'}，是 interview 旧 IA（引擎域）的残留；
       现按 CAPS 注册表的 domain 从 APP_DATA.domains 反查域标签（v27 起 interview 归「引擎」域，
       中间那版曾归 growth/运营 —— 标签一律从注册表反查，不写死）。 */
    var dn = '';
    try {
      (global.APP_DATA.domains || []).forEach(function (d) { if (d.id === cap.domain) dn = d.name; });
    } catch (e) { /* APP_DATA 不可用时退回显示 id，总比硬编码错的强 */ }
    return typeof V.pageCrumb === 'function'
      ? V.pageCrumb([{ text: dn || (cap.domain || '') }, { text: cap.name }, { text: row.name }])
      : '<nav class="crumb">' + esc(h, cap.name) + ' / <b>' + esc(h, row.name) + '</b></nav>';
  }
  function tabsBar(cap, state, h, tabs, active, badges) {
    var items = tabs.map(function (t) { return { key: t.id, label: t.label, badge: badges && badges[t.id] != null ? badges[t.id] : null }; });
    if (typeof V.detailTabs === 'function') return V.detailTabs(cap, state, items, h);
    return '<div class="tabs" role="tablist">' + items.map(function (t) {
      return '<button role="tab" class="tab' + (t.key === active ? ' on' : '') + '" data-v10-tab="' + esc(h, t.key) + '">' + esc(h, t.label) +
        (t.badge != null ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function statePill(h, k) {
    var m = null;
    STATES.forEach(function (x) { if (x.k === k) m = x; });
    return pill(h, m ? m.tone : 'idle', m ? m.t : k);
  }
  function funnelBar(h, funnel, total) {
    var seg = funnel.map(function (f) {
      var w = total ? (f.n / total * 100) : 0;
      if (w <= 0) return '';
      return '<span class="iv-seg iv-' + f.k + '" style="width:' + w.toFixed(2) + '%" title="' + esc(h, STATE_LABEL[f.k]) + ' ' + f.n + ' 人"></span>';
    }).join('');
    return '<div class="iv-bar">' + seg + '</div>';
  }

  /* ============================================================
   * 一、作业台首页
   * ============================================================ */
  /* 旧首页（v4 之前的"进行中/全部任务"版）。已被 v10-interview-home.js 的主工作台取代，
     改名停用以免两个文件注册同一个 RENDERERS.interviewHome（后者会覆盖前者，改错地方）。
     待清理：确认无引用后可整段删除。 */
  R.interviewHomeLegacyUnused = function (cap, state, h) {
    var t = global.APP_DATA && global.APP_DATA.getAssetTables ? (global.APP_DATA.getAssetTables() || {}).survey : null;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2></div>';
    var rows = t.rows || [];

    var boards = rows.map(function (r) { return { row: r, wb: workbench(r) }; });
    var needReview = 0, aborted = 0, interruptedOver = 0, pendingAll = 0, dialingAll = 0, doneAll = 0;
    boards.forEach(function (b) {
      b.wb.rows.forEach(function (c) {
        if (c.review === 'pending-review') needReview++;
        if (c.aborted) aborted++;
        if (c.state === 'interrupted' && c.lastTryH >= 72) interruptedOver++;
        if (c.state === 'pending') pendingAll++;
        if (c.state === 'dialing') dialingAll++;
        if (c.state === 'done') doneAll++;
      });
    });
    /* 今日已联系 = 正在谈的 + 今日谈完的估计（确定性，不用随机数） */
    var todayReached = dialingAll + Math.round(doneAll * 0.08);

    var todo = '<div class="card"><div class="card-h"><h3>需我处理</h3><span class="card-sub">点进去就是待办清单</span></div>' +
      '<div class="metrics">' + [
        { label: '待审结论', value: String(needReview), unit: '条', sub: '访谈结论需人工复核', alert: needReview > 0 },
        { label: '异常中止', value: String(aborted), unit: '条', sub: '命中禁问 / 越界，已留痕' },
        { label: '联系中断超 72h', value: String(interruptedOver), unit: '人', sub: '将转"联系不上"' },
        { label: '待联系', value: String(pendingAll), unit: '人', sub: '按计划时段排队中' }
      ].map(h.metricCard).join('') + '</div></div>';

    var running = boards.filter(function (b) { return b.row.status === 'info' || b.row.status === 'warn'; });
    var runningHtml = running.length ? '<div class="card"><div class="card-h"><h3>进行中的访谈</h3><span class="card-sub">' + running.length + ' 场 · 联系状态分布与进度</span></div>' +
      '<div class="ab-list">' + running.map(function (b) {
        var f = b.wb.funnel, doneN = 0;
        f.forEach(function (x) { if (x.k === 'done') doneN = x.n; });
        return '<button class="ab-item" data-act="iv-open" data-id="' + esc(h, b.row.id) + '">' +
          '<b>' + esc(h, b.row.name) + '</b>' +
          '<span>' + esc(h, b.row.target || '') + ' · ' + f.length + ' 个联系状态</span>' +
          '<span class="ab-why">联系完成 ' + doneN + ' / ' + b.wb.total + ' 人</span>' +
          '<span class="ab-go">进作业台 →</span></button>';
      }).join('') + '</div></div>' : '';

    var cols = [
      { key: 'name', label: '访谈任务', render: function (b) { return '<button class="lnk" data-act="iv-open" data-id="' + esc(h, b.row.id) + '"><b>' + esc(h, b.row.name) + '</b></button>'; } },
      { key: 'target', label: '访谈谁', render: function (b) { return esc(h, b.row.target || '—'); } },
      { key: 'people', label: '计划 / 联系完成', align: 'right', render: function (b) { var doneN = 0; b.wb.funnel.forEach(function (x) { if (x.k === 'done') doneN = x.n; }); return b.wb.total.toLocaleString('zh-CN') + ' / ' + doneN.toLocaleString('zh-CN'); } },
      { key: 'funnel', label: '联系状态分布', render: function (b) { return funnelBar(h, b.wb.funnel, b.wb.total); } },
      { key: 'ai', label: '访谈员', render: function (b) { return esc(h, INTERVIEWERS[0].name + (INTERVIEWERS[1].bind ? ' 等' : '')); } },
      { key: 'review', label: '待审', align: 'right', render: function (b) { var n = b.wb.rows.filter(function (c) { return c.review === 'pending-review'; }).length; return n ? '<span class="warn">' + n + '</span>' : '0'; } },
      { key: 'status', label: '状态', render: function (b) { return pill(h, b.row.status, b.row.statusText); } }
    ];

    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('chat', 20) + ' AI 访谈作业台</div>' +
      '<div class="ph-desc">为一场访谈<b>挑人</b> → <b>交待清楚</b>（问什么、禁问什么、引哪本知识库）→ 派 AI 去做 1 对 1 多轮访谈 → <b>谈完审核归档</b>。每个页都是工作台：进来就知道该干什么。</div>' +
      '</div><div class="ph-side">' +
      (typeof V.permTag === 'function' ? V.permTag('interview:create') : '') +
      '<button class="btn-primary" data-act="iv-create">新建访谈</button></div></div>' +
      todo +
      '<div class="metrics">' + [
        { label: '进行中', value: String(running.length), unit: '场', sub: '共 ' + rows.length + ' 场访谈' },
        { label: '今日已联系', value: String(todayReached), unit: '人', sub: '正在谈 ' + dialingAll + ' + 今日谈完' },
        { label: '联系完成', value: String(doneAll), unit: '人', sub: '谈完并出结论' }
      ].map(h.metricCard).join('') + '</div>' +
      runningHtml +
      '<div class="card pad0"><div class="card-h pad"><h3>全部访谈任务</h3><span class="card-sub">' + rows.length + ' 场 · 点任务名进作业台</span></div>' +
      h.table({ columns: cols, rows: boards, emptyTitle: '暂无访谈任务' }) + '</div>' +
      h.metaBar({}, [
        { k: '视图划分', v: '六个视图各对应一段完整工作：挑人 → 交待 → 派单 → 过程 → 审核 → 归档' },
        { k: '数据性质', v: '联系人、联系状态与会话由访谈服务返回；当前为内置数据（种子 iv-* 固定，刷新不变）' },
        { k: '联系状态口径', v: '未联系 / 正在联系中 / 联系中断 / 联系不上 / 联系完成 五态；联系完成 ≠ 访谈完成（进度另有字段）' }
      ]);
  };

  /* ============================================================
   * 二、访谈详情（六个视图）
   * ============================================================ */
  R.interviewDetail = function (cap, state, h) {
    var id = state.objId || state.interviewId || null;
    var table = (global.APP_DATA.getAssetTables() || {}).survey;
    var row = null;
    (table && table.rows || []).forEach(function (x) { if (x.id === id) row = x; });
    if (!row) {
      return '<div class="fatal"><h2>访谈任务不存在</h2><p>标识「' + esc(h, id || '') + '」未找到。</p>' +
        '<button class="btn-primary" data-act="iv-home">返回作业台</button></div>';
    }
    var wb = workbench(row);
    var tab = state.objTab || state.tab || 'plan';
    var ok = false;
    TABS.forEach(function (x) { if (x.id === tab) ok = true; });
    if (!ok) tab = 'plan';

    var badges = {
      live: abortList(wb).length || null,
      audit: auditQueue(wb).length || null
    };

    var body = tab === 'plan' ? tabPlan(cap, state, h, row, wb)
      : tab === 'live' ? tabLive(cap, state, h, row, wb)
      : tab === 'records' ? tabRecords(cap, state, h, row, wb)
      : tab === 'audit' ? tabAudit(cap, state, h, row, wb)
      : tab === 'history' ? tabHistory(cap, state, h, row, wb)
      : tab === 'survey' ? tabSurvey(cap, state, h, row, wb)
      : tabResult(cap, state, h, row, wb);

    var doneN = 0;
    wb.funnel.forEach(function (x) { if (x.k === 'done') doneN = x.n; });
    var headLine = doneN > 0
      ? '计划联系 ' + wb.total.toLocaleString('zh-CN') + ' 人 · 联系完成 ' + doneN.toLocaleString('zh-CN') + ' 人'
      : '计划联系 ' + wb.total.toLocaleString('zh-CN') + ' 人 · 尚未开始联系';

    return crumb(h, cap, row) +
      '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('chat', 20) + ' ' + esc(h, row.name) + ' ' + pill(h, row.status, row.statusText) + '</div>' +
      '<div class="ph-desc">' + esc(h, row.target || '') + ' · ' + headLine + ' · 访谈员 ' + esc(h, INTERVIEWERS[0].name) + '</div>' +
      '</div><div class="ph-side">' +
      /* v10b：去掉页头裸显的原始权限点 id 徽标（interview:dispatch）—— 全站页头均无权限徽标，
         此为孤例且对业务用户是英文噪音；真实校验由动作触发时的 checkPerm / dangerConfirm 机制承载 */
      '<button class="btn-ghost" data-act="iv-home">← 返回作业台</button></div></div>' +
      tabsBar(cap, state, h, TABS, tab, badges) + body;
  };

  var TABS = [
    { id: 'plan', label: '访谈编排' },
    { id: 'live', label: '过程监控' },
    { id: 'records', label: '访谈记录' },
    { id: 'audit', label: '访谈审核' },
    { id: 'result', label: '结论与分析' },
    { id: 'history', label: '历史访谈' },
    { id: 'survey', label: '问卷评价' }
  ];

  /* ---------------- ① 访谈编排 ---------------- */
  function tabPlan(cap, state, h, row, wb) {
    var src = state.ivSrc || 'tag';
    var bind = state.ivBind || '1to1';
    var picked = state.ivTags || ['合同到期前 60 天', '年采购额 > 1000 万'];

    function srcBtn(k, label, hint) {
      /* 同 app.js metricCard 的修复：<button> 内不得放块级 <div>（内容模型是 phrasing content），
         否则浏览器会改写 DOM。改为 div[role=button] + tabindex，键盘由 bindContent 统一接。 */
      return '<div class="pick-btn' + (src === k ? ' on' : '') + '" role="button" tabindex="0" data-act="iv-src" data-id="' + k + '">' + esc(h, label) +
        '<div class="pick-or" style="margin-top:4px">' + esc(h, hint) + '</div></div>';
    }
    var bid = state.ivTags || ['合同到期前 60 天', '年采购额 > 1000 万'];
    var est = 0;
    var pickedTags = TAGS.filter(function (t) { return bid.indexOf(t.n) >= 0; });
    if (pickedTags.length) {
      /* 交集只能取"最小的那个覆盖数"作为上限 —— 之前取最大值，等于把交集当成并集 */
      est = pickedTags.reduce(function (m, t) { return Math.min(m, t.c); }, pickedTags[0].c);
    }
    var excluded = { freq: 300, unsub: 40, black: 4, other: 312 };
    var net = Math.max(0, est - excluded.freq - excluded.unsub - excluded.black - excluded.other);

    /* ① 找谁谈 */
    var who = '<div class="card"><div class="card-h"><h3>① 找谁谈</h3><span class="card-sub">四种挑人方式 · 人数按各自口径给</span></div>' +
      '<div class="pick-row">' +
      srcBtn('tag', '标签组合', '按标签交集挑人') +
      srcBtn('pool', '用户池选人', '从池子里勾人') +
      srcBtn('segment', '运营分群', '复用运营圈的分群') +
      srcBtn('import', '导入名单', 'CSV / Excel') +
      '</div>' +
      (src === 'tag'
        ? '<div class="sub-h">标签（分类好的六个，点选做交集）</div>' +
          '<div class="chips">' + TAGS.map(function (t) {
            var on = picked.indexOf(t.n) >= 0;
            return '<span class="chip' + (on ? ' link on' : '') + '" data-act="iv-tag" data-id="' + esc(h, t.n) + '">' + esc(h, t.n) +
              '<b style="margin-left:6px">' + t.c.toLocaleString('zh-CN') + '</b></span>';
          }).join('') + '</div>' +
          '<div class="bt-note" style="margin-top:8px">口径随标签走 —— 例：<b>合同到期前 60 天</b>＝合同结束日期 − 今天 ≤ 60 天（来源 CRM 合同表 · 责任人 xianyu · 每日更新）。标签人数是标签自己的口径，不拿画像的"覆盖企业数"顶替。</div>'
        : src === 'pool'
          ? '<div class="sub-h">用户池</div><div class="dl">' +
            '<dt>池子</dt><dd>B2B 决策人池 · 全池 1,240 人（已具名 862 / 待判定 378）</dd>' +
            '<dt>已勾选</dt><dd>' + esc(h, String(state.ivPoolN || 24)) + ' 人　<button class="btn-ghost sm" data-act="iv-pool-more">再勾 12 人</button></dd>' +
            '<dt>勾选规则</dt><dd>同一企业最多勾 1 位决策人；已退订与黑名单不可勾</dd></div>'
          : src === 'segment'
            ? '<div class="sub-h">运营分群</div><div class="chips">' +
              ['合同到期池', '沉睡可唤醒', 'VIP 续费池', '高流失风险'].map(function (x, i) {
                return '<span class="chip' + (i === 2 ? ' link on' : '') + '">' + esc(h, x) + '</span>';
              }).join('') + '</div><div class="bt-note">分群覆盖数取运营圈人的最新圈选结果。</div>'
            : '<div class="sub-h">导入名单</div><div class="dl"><dt>文件</dt><dd>访谈名单_20261006.csv · 1,240 行</dd><dt>校验</dt><dd>手机号格式 ✓ · 重复行 12（已去重）· 缺联系方式 3（已剔除）</dd></div>') +
      '<div class="metrics" style="margin-top:12px">' + [
        { label: '预估人数', value: (src === 'tag' ? est : (src === 'pool' ? 24 : 1240)).toLocaleString('zh-CN'), unit: '人', sub: src === 'tag' ? '标签交集上限（取所选标签最小覆盖数）' : (src === 'pool' ? '已勾选' : '导入条数') },
        { label: '排除', value: (excluded.freq + excluded.unsub + excluded.black + excluded.other).toLocaleString('zh-CN'), unit: '人', sub: '频控 ' + excluded.freq + ' · 退订 ' + excluded.unsub + ' · 黑名单 ' + excluded.black + ' · 已在其他访谈 ' + excluded.other },
        { label: '实际可联系', value: net.toLocaleString('zh-CN'), unit: '人', sub: '预估 − 排除' }
      ].map(h.metricCard).join('') + '</div></div>';

    /* ② 谈什么 —— **读提纲真源**（首页①保存的就是它），不再用本地写死的常量。
       原来 OUTLINE 是这个文件里的常量，和首页文本框、数据层各一份，互不相干。 */
    var OL = (IVD.currentOutline ? IVD.currentOutline() : OUTLINE);
    var mustN = OL.topics.filter(function (x) { return x.must; }).length;
    var banN = OL.topics.filter(function (x) { return x.ban; }).length;
    var talk = '<div class="card" data-static="1" title="只读说明：本卡是「给 AI 的交待」的内容呈现（话题树 / 开场结束语 / 禁忌 / 引用库）。改它去首页「① 问卷内容」，本页不重复入口。"><div class="card-h"><h3>② 谈什么（给 AI 的交待）</h3>' +
      '<span class="card-sub">话题 ' + OL.topics.length + ' · 必问 ' + mustN + ' · 禁问 ' + banN +
      '　·　来自首页①的问卷内容</span>' +
      pill(h, 'ok', OL.form === 'topic' ? '话题式' : '问卷式') + '</div>' +
      '<div class="pick-row">' +
      /* ⚠ 此前这两个是 `<button class="pick-btn">`，看着能点、既无 data-act 也无任何状态可写
         （全仓没有任何地方赋值 OL.form）—— 是纯装饰的假控件。
         按本仓规矩：「宁可如实展示，也不留点了没反应的控件」，改为只读徽章 + 说明去哪改。 */
      '<span class="pill ' + (OL.form === 'topic' ? 'ok' : 'idle') + '">当前：' + (OL.form === 'topic' ? '话题式（AI 顺着聊）' : '问卷式（固定题目）') + '</span>' +
      '<span class="pick-or">形态在首页「① 问卷内容」里设定；两种都是"提纲"，话题式更适合 1 对 1 深访</span></div>' +
      '<div class="sub-h">话题树</div><div class="fc-steps">' +
      OL.topics.map(function (t) {
        return '<div class="fc-step"><i>' + (t.must ? '必' : (t.ban ? '禁' : '·')) + '</i><span>' + esc(h, t.name) + '</span>' +
          '<span class="mono">' + (t.must ? '必须问到' : (t.ban ? '不问' : '可选')) + '</span>' +
          '<span>' + esc(h, t.detail || (t.asks && t.asks.length ? t.asks.join('　/　') : '') || '（本场不问）') + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">改提纲去首页「① 问卷内容」：改完点「保存问卷内容」，这一页和「问卷评价」页签会一起更新。</div>' +
      '<div class="sub-h">开场 / 结束 / 禁忌</div><div class="dl">' +
      '<dt>开场白</dt><dd>' + esc(h, OL.opening || '') + '</dd>' +
      '<dt>结束语</dt><dd>' + esc(h, OL.closing || '') + '</dd>' +
      '<dt>禁忌</dt><dd>' + (OL.forbidden || []).map(function (x) { return '<span class="tag">' + esc(h, x) + '</span>'; }).join('') + '　命中即中止本场</dd>' +
      '<dt>单轮上限</dt><dd>' + (OL.maxChars || 200) + ' 字 · 纯文本</dd>' +
      '</div>' +
      '<div class="sub-h">引用哪些知识库</div><div class="fc-steps">' +
      (OL.kbs || []).map(function (k) {
        return '<div class="fc-step"><i>库</i><span>' + esc(h, k.name) + '</span><span class="mono">' + esc(h, k.mode) + '</span><span>' + esc(h, k.why) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">引用需给出处：回答涉及功能与限制时，结论里必须带【来源：库 §章节】；每一轮对话右侧会显示实际引用的片段与相关度。</div></div>';

    /* ③ 谁去谈 */
    var who2 = '<div class="card"><div class="card-h"><h3>③ 谁去谈</h3><span class="card-sub">' + INTERVIEWERS.length + ' 个 AI 访谈员 · 共 ' +
      INTERVIEWERS.reduce(function (s, x) { return s + x.seats; }, 0) + ' 个并发席位</span></div>' +
      '<div class="fc-steps">' + INTERVIEWERS.map(function (a) {
        return '<div class="fc-step"><i>AI</i><span>' + esc(h, a.name) + '</span><span class="mono">' + esc(h, a.model + ' ' + a.ver) + '</span><span>' + a.seats + ' 席 · 擅长 ' + esc(h, a.good) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="pick-row" style="margin-top:10px">' +
      '<button class="pick-btn' + (bind === '1to1' ? ' on' : '') + '" data-act="iv-bind" data-id="1to1">1 对 1（一个联系人固定一个 AI 谈到底）</button>' +
      '<button class="pick-btn' + (bind === 'pool' ? ' on' : '') + '" data-act="iv-bind" data-id="pool">池化轮转（谁空谁接）</button>' +
      '</div><div class="bt-note">中断续谈默认<b>不换人</b>（同一个 AI 记得上下文）；要换需人工指定。</div></div>';

    /* ④ 怎么谈 */
    var how = '<div class="card"><div class="card-h"><h3>④ 怎么谈</h3><span class="card-sub">渠道 / 时段 / 频控 / 重试 / 终止</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>渠道</i><span>企微 → 短信</span><span class="mono">按顺序</span><span>企微 24h 未回再发短信</span></div>' +
      '<div class="fc-step"><i>时段</i><span>09:00–20:00</span><span class="mono">免打扰</span><span>22:00–08:00 与节假日不发</span></div>' +
      '<div class="fc-step"><i>频控</i><span>每人 14 天 ≤ 1 次</span><span class="mono">全局</span><span>与用户运营统一执行</span></div>' +
      '<div class="fc-step"><i>重试</i><span>24h / 72h 各追一次</span><span class="mono">最多 3 次</span><span>用尽转「联系不上」，只能人工重开</span></div>' +
      '<div class="fc-step"><i>终止</i><span>主动结束 / 轮次上限 ' + (OL.maxRounds || 24) + ' / 拒答 2 次</span><span class="mono">立即</span><span>命中禁问 → 中止并留痕</span></div>' +
      '</div></div>';

    /* ⑤ 校验与审批 —— 结论按当前提纲算，不写死"4 个话题" */
    var olBan = OL.topics.filter(function (t) { return t.ban; }).length;
    var olOpt = OL.topics.filter(function (t) { return t.flag === 'opt'; }).length;
    var checkOk = OL.topics.length > 0;
    var check = '<div class="card"><div class="card-h"><h3>⑤ 校验与审批</h3><span class="card-sub">不通过就说明缺什么</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>' + (checkOk ? '✓' : '!') + '</i><span>提纲可答性</span><span class="mono">' + (checkOk ? '通过' : '待补') + '</span><span>' +
      (checkOk
        ? OL.topics.length + ' 个话题都有追问路径（必问 ' + mustN + ' · 可选 ' + olOpt + ' · 禁问 ' + olBan + '），无死循环'
        : '提纲还是空的 —— 去首页「① 问卷内容」写一条') + '</span></div>' +
      '<div class="fc-step"><i>✓</i><span>禁问项与知识库不冲突</span><span class="mono">通过</span><span>' + (OL.forbidden || []).length + ' 个禁忌词未被知识库片段触发</span></div>' +
      '<div class="fc-step"><i>✓</i><span>知识库可用</span><span class="mono">通过</span><span>产品文档库 12,840 篇 · 索引最新</span></div>' +
      '<div class="fc-step"><i>!</i><span>合规五项</span><span class="mono">待确认</span><span>名单授权 / 禁发时段 / 退订入口 / AIGC 标识 / 人审门控</span></div>' +
      '</div>' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn-primary" data-act="iv-submit" data-id="' + esc(h, row.id) + '">发布并生效</button>' +
      '<button class="btn-ghost" data-act="iv-save">保存草稿</button>' +
      '<span class="pick-or">提交后立即生效，并记入操作记录。</span></div></div>';

    /* 折叠设置：谁去谈 / 怎么谈 / 合规 —— 从主位收起来，需要时才展开 */
    var fold = state.ivFold || null;
    function foldCard(key, title, sub, body) {
      var on = fold === key;
      return '<div class="card"><div class="card-h"><h3>' + esc(h, title) + '</h3><span class="card-sub">' + esc(h, sub) + '</span>' +
        '<button class="btn-ghost sm" data-act="iv-fold" data-id="' + key + '">' + (on ? '收起 ▴' : '展开 ▾') + '</button></div>' +
        (on ? body : '') + '</div>';
    }

    var roundsCard = '<div class="card" data-static="1" title="只读说明：本卡是话术规矩（轮次上限 / 字数上限 / 收尾条件）的既定口径，属策略声明；改它属产品决策，本页不提供编辑入口。"><div class="card-h"><h3>轮次与话术规矩</h3><span class="card-sub">克制：到点就收，不硬拉长</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>3–7</i><span>默认轮次</span><span class="mono">第 7 轮主动收尾</span><span>致谢 + 说明后续</span></div>' +
      '<div class="fc-step"><i>+2</i><span>有意向 / 聊得投机</span><span class="mono">可多开两轮</span><span>只加两轮，不无限延长</span></div>' +
      '<div class="fc-step"><i>≤12</i><span>总上限</span><span class="mono">到顶即收尾归档</span><span>超 12 轮要人工放行并留痕</span></div>' +
      '<div class="fc-step"><i>60 字</i><span>每条消息上限</span><span class="mono">一次只问一件事</span><span>开场白 / 结束语各 ≤ 40 字</span></div>' +
      '<div class="fc-step"><i>明确影响</i><span>才允许继续谈</span><span class="mono">必问点没问全 / 发现风险</span><span>被访者主动追问 / 结论缺证据</span></div>' +
      '</div></div>';

    var flowCard = '<div class="card"><div class="card-h"><h3>状态流转</h3><span class="card-sub">联系不上是常态，可人工重开</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>→</i><span>未联系</span><span class="mono">到时段</span><span>进入「正在联系中」</span></div>' +
      '<div class="fc-step"><i>→</i><span>正在联系中</span><span class="mono">24h 无回应</span><span>转「联系中断」并排下一次重试</span></div>' +
      '<div class="fc-step"><i>→</i><span>联系中断</span><span class="mono">72h / 3 次用尽</span><span>转「联系不上」（终态）</span></div>' +
      '<div class="fc-step"><i>→</i><span>联系不上</span><span class="mono">人工重开 ≤ 2 次</span><span>回到「未联系」排队尾，不延续上次会话</span></div>' +
      '</div>' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:10px">' +
      '<button class="btn-ghost sm" data-act="iv-goto-live" data-id="' + esc(h, row.id) + '">去看联系不上的人（过程监控）</button></div></div>';

    return statusStrip(h, wb, '访谈编排：提纲细修 → 派单设置 → 校验') +
      '<div class="bt-note" style="margin-bottom:10px">找谁谈（标签 / 用户池 / 运营分群 / 导入名单）在<b>作业台首页</b>挑人；这一页只改"给 AI 的交待"。</div>' +
      talk + roundsCard +
      '<div class="grid2">' +
      foldCard('who', '谁去谈', '席位与绑定（折叠）', who2) +
      foldCard('how', '怎么谈', '渠道 / 时段 / 频控 / 重试（折叠）', how) +
      '</div>' +
      foldCard('compliance', '合规与审核前置', '五项合规检查 + 上线（折叠）', check) +
      flowCard +
      h.metaBar({}, [
        { k: '找谁谈', v: '在作业台首页：标签人数按标签自己的口径；分群取运营圈人最新圈选结果；导入取文件行数；用户池取勾选数' },
        { k: '谈什么', v: '话题树 + 必问点 + 禁问项构成"给 AI 的交待"；知识库引用分必引 / 参考 / 不用，必引时结论须带出处' },
        { k: '轮次', v: '默认 3–7 轮，第 7 轮收尾；有意向或聊得投机 +2；上限 12；每条消息 ≤ 60 字 —— 目的是克制、不打扰' }
      ]);
  }

  function statusStrip(h, wb, extra) {
    var f = {};
    wb.funnel.forEach(function (x) { f[x.k] = x.n; });
    /* v10b：状态数字可点（Oracle Universal Work Queue 模式：计数是导航入口，不是终态数字）——
       点击任一状态数字 = 切到「过程监控」并按该状态过滤联系人列表（联系人为主体、可接管/重开），
       用户从「看着一串数字」变成「直达这批人」。计划联系 = 全部（不过滤）。 */
    function num(label, k, val) {
      return '<span class="vb-item link" data-act="iv-drill-state" data-id="' + (k || '') + '" title="到「过程监控」看' + (k ? '该状态的联系人' : '全部联系人') + '"><i>' + label + '</i><b>' + val + '</b></span>';
    }
    return '<div class="verbar">' + num('计划联系', '', wb.total.toLocaleString('zh-CN') + ' 人') +
      '<span class="vb-sep"></span>' +
      num('未联系', 'pending', (f.pending || 0)) +
      num('正在联系中', 'dialing', (f.dialing || 0)) +
      num('联系中断', 'interrupted', (f.interrupted || 0)) +
      num('联系不上', 'unreachable', (f.unreachable || 0)) +
      num('联系完成', 'done', (f.done || 0)) +
      '<span class="vb-item" style="flex:1"><i>状态分布</i>' + funnelBar(h, wb.funnel, wb.total) + '</span>' +
      '<span class="vb-right">' + esc(h, extra || '') + '</span></div>';
  }

  /* ---------------- ② 过程监控 ---------------- */
  function tabLive(cap, state, h, row, wb) {
    /* 默认选中"已经谈起来的人"——未联系的人没有会话，选中他会让时间线凭空长出来 */
    var talkable = wb.rows.filter(function (c) { return c.rounds > 0; });
    var pool = talkable.length ? talkable : wb.rows;
    var sel = state.ivSel || (pool[0] && pool[0].id);
    var cur = null;
    wb.rows.forEach(function (c) { if (c.id === sel) cur = c; });
    if (!cur || cur.rounds === 0) cur = pool[0] || wb.rows[0];

    var aborts = abortList(wb);
    var alerts = '<div class="card"><div class="card-h"><h3>异常与中止</h3><span class="card-sub">命中禁问 / 越界即停，留痕可追溯</span></div>' +
      (aborts.length ? '<div class="act-list">' + aborts.slice(0, 4).map(function (c) {
        /* ⚠ 这里原来打印 c.lastAt（老 buildContacts 的字段，那个函数已不被使用）+ c.seg.name
           （数据源里 seg 是**字符串**名，不是对象）⇒ 界面出现「NaN 小时前」和空的人群名。
           生效数据源 IV_DATA.contacts 只有 lastTryH（上次联系距今小时数），
           而中止的都是 state=done 的联系人（lastTryH 恒为 0），所以"几小时前"这件事
           在数据源里本就无处可取 —— 改为渲染它真有的字段：已尝试次数 + 中止轮次。 */
        return '<div class="act-item bad"><span class="act-lv">' + esc(h, c.abortReason || '异常') + '</span>' +
          '<span class="act-main"><b>' + esc(h, c.name) + ' · ' + esc(h, c.seg) + '</b><i>' + esc(h, c.owner) +
          ' · 已尝试 ' + esc(h, String(c.attempts)) + ' 次 · 第 ' + esc(h, String(c.rounds)) + ' 轮中止</i></span>' +
          '<button class="btn-ghost sm" data-act="iv-sel" data-id="' + esc(h, c.id) + '">看会话</button></div>';
      }).join('') + '</div>' : '<div class="bt-note">暂无异常中止。</div>') + '</div>';

    /* 联系人列表：默认五态各取几条（不然头 14 条全是"联系完成"，看不到联系不上的人），
       筛选项真的能筛 */
    var sf = state.ivStateFilter || null;
    var mixed = [];
    STATES.forEach(function (st) {
      mixed = mixed.concat(wb.rows.filter(function (c) { return c.state === st.k; }).slice(0, 6));
    });
    var listed = sf ? wb.rows.filter(function (c) { return c.state === sf; }).slice(0, 30) : mixed;
    var list = '<div class="card pad0"><div class="card-h pad"><h3>联系人</h3><span class="card-sub">共 ' + wb.rows.length + ' 人 · 当前显示 ' + listed.length + ' 人</span></div>' +
      '<div style="padding:0 12px 12px"><div class="chips">' +
      '<span class="chip' + (sf ? '' : ' link on') + '" data-act="iv-state-filter" data-id="">全部</span>' +
      STATES.map(function (s) {
        return '<span class="chip' + (sf === s.k ? ' link on' : '') + '" data-act="iv-state-filter" data-id="' + s.k + '">' + esc(h, s.t) +
          ' <b>' + (wb.funnel.filter(function (x) { return x.k === s.k; })[0] || { n: 0 }).n + '</b></span>';
      }).join('') +
      '</div></div><div style="display:flex;flex-direction:column;gap:7px;padding:0 12px 12px">' +
      listed.map(function (c) {
        return '<button class="kb-card" data-act="iv-sel" data-id="' + esc(h, c.id) + '"' +
          (c.id === sel ? ' style="border-color:var(--blue);background:var(--blue-weak)"' : '') + '>' +
          '<span style="font-size:12.5px;font-weight:600">' + esc(h, c.name) + '　' + esc(h, c.phone) + '</span>' +
          '<span style="display:flex;gap:6px;font-size:11.5px;color:var(--sub)">' + esc(h, c.seg) + ' · 第 ' + c.rounds + ' 轮 · ' + esc(h, c.owner) + '</span>' +
          '<span style="display:flex;gap:6px;align-items:center">' + pill(h, c.tone, c.stateText) + pill(h, c.reviewTone, c.reviewText) + '</span></button>';
      }).join('') + '</div></div>';

    var turns = cur.rounds > 0 ? dataTurns(row, cur) : [];
    var timeline = turns.length ? '<div class="iv-chat">' + turns.map(function (t) {
      if (t.role === 'ai') {
        /* AI 访谈员靠右（我方），受访者靠左 */
        return '<div class="row me"><div><div class="who">AI 访谈员' + (t.round ? ' · 第 ' + t.round + ' 轮追问' : '') + '</div>' +
          '<div class="bubble">' + esc(h, t.text) + '</div>' +
          (t.why ? '<div class="note">追问理由：' + esc(h, t.why) + '</div>' : '') +
          (t.kb ? '<div class="note">引用：<b>' + esc(h, t.kb.doc) + '</b>（相关度 ' + t.kb.score + '）</div>' : '') + '</div></div>';
      }
      if (t.role === 'user') return '<div class="row"><div><div class="who">受访者</div><div class="bubble">' + esc(h, t.text) + '</div></div></div>';
      return '<div class="row"><div class="note" style="color:#dc2626">已中止：' + esc(h, t.text) + '</div></div>';
    }).join('') + '</div>' : '';

    var detail = '<div class="card" style="margin:0"><div class="card-h"><h3>' + esc(h, cur.name) + ' · ' + esc(h, cur.seg) + '</h3>' +
      statePill(h, cur.state) + '<span class="card-sub">' + esc(h, CH_LABEL[cur.channel] || cur.channel) + ' · 第 ' + cur.rounds + ' 轮 · ' + esc(h, String(cur.durMin)) + ' 分钟 · 访谈员 ' + esc(h, cur.owner) + '</span></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      /* 三个动作都写会话态（ivTaken / ivAbnormal / ivPaused）⇒ 这里按状态回显，别让用户重复点。
         ⚠ 「标记异常」按钮此前**没有 data-id** —— handler 收到空 id 却照样报"已标记"，属谎报；
         现在补上 id，并在已标记时改文案。 */
      ((state.ivTaken || {})[cur.id]
        ? '<span class="pill ok">已人工接管</span>'
        : '<button class="btn-ghost sm" data-act="iv-takeover" data-id="' + esc(h, cur.id) + '">人工接管</button>') +
      ((state.ivAbnormal || {})[cur.id]
        ? '<span class="pill bad">已标记异常</span>'
        : '<button class="btn-ghost sm" data-act="iv-mark" data-id="' + esc(h, cur.id) + '">标记异常</button>') +
      (cur.state === 'unreachable'
        ? '<button class="btn-ghost sm" data-act="iv-reopen" data-id="' + esc(h, cur.id) + '">人工重开' + ((state.ivReopened || {})[cur.id] ? '（已重开 ' + (state.ivReopened || {})[cur.id] + ' 次）' : '') + '</button>'
        : ((state.ivPaused || {})[cur.id]
          ? '<span class="pill warn">已暂停该人</span>'
          : '<button class="btn-ghost sm" data-act="iv-pause-one" data-id="' + esc(h, cur.id) + '">暂停这个人</button>')) + '</div>' +
      '<div class="sub-h">会话时间线</div>' + (timeline || '<div class="bt-note">这个人还没谈起来（联系状态：' + esc(h, STATE_LABEL[cur.state] || cur.state) + '）。谈起来以后这里会显示每一轮：AI 问什么、为什么追问、引用了哪段知识库。</div>') + '</div>';

    return statusStrip(h, wb, '过程监控：谁在谈、谈到哪、出事怎么办') +
      '<div class="grid2">' + alerts +
      '<div class="card"><div class="card-h"><h3>联系状态怎么流转</h3><span class="card-sub">五态 + 超时规则</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>→</i><span>未联系</span><span class="mono">到时段</span><span>进入「正在联系中」</span></div>' +
      '<div class="fc-step"><i>→</i><span>正在联系中</span><span class="mono">24h</span><span>没回应转「联系中断」并排下一次重试</span></div>' +
      '<div class="fc-step"><i>→</i><span>联系中断</span><span class="mono">72h / 3 次</span><span>重试用尽转「联系不上」（终态，只能人工重开）</span></div>' +
      '<div class="fc-step"><i>→</i><span>联系完成</span><span class="mono">谈完</span><span>进入访谈记录与审核</span></div>' +
      '</div></div></div>' +
      '<div class="dbg-grid" data-iv-live="1">' + list + detail + '</div>' +
      h.metaBar({}, [
        { k: '联系状态', v: '未联系 / 正在联系中 / 联系中断 / 联系不上 / 联系完成；与访谈进度（第 n 轮、完答、中止）分开记' },
        { k: '会话内容', v: '由访谈引擎返回；每轮带追问理由与实际引用的知识库片段与相关度' },
        { k: '异常中止', v: '命中禁问项或越界即中止本场，落三处：时间线 / 联系人状态 / 审计记录；可人工接管续谈' }
      ]);
  }

  /* ---------------- ③ 访谈记录 ---------------- */
  function tabRecords(cap, state, h, row, wb) {
    var filter = state.ivRecFilter || null;
    var rows = wb.rows.filter(function (c) {
      if (filter === 'abort') return !!c.aborted;
      if (filter === 'lowq') return c.quality === '低质量';
      if (filter === 'audit') return c.review === 'pending-review';
      if (filter === 'done') return c.state === 'done';
      if (filter === 'interrupted') return c.state === 'interrupted';
      if (filter === 'unreachable') return c.state === 'unreachable';
      return true;
    });
    var cols = [
      { key: 'id', label: '记录', render: function (c) { return '<span class="mono">' + esc(h, c.id) + '</span>'; } },
      { key: 'who', label: '联系人', render: function (c) { return esc(h, c.name) + '<div class="td-sub">' + esc(h, c.phone) + '</div>'; } },
      { key: 'seg', label: '人群', render: function (c) { return esc(h, c.seg); } },
      { key: 'state', label: '联系状态', render: function (c) { return pill(h, c.tone, c.stateText); } },
      { key: 'rounds', label: '轮次', align: 'right', render: function (c) { return String(c.rounds); } },
      { key: 'cover', label: '必问覆盖', render: function (c) { return esc(h, c.cover); } },
      { key: 'quality', label: '质量', render: function (c) { return pill(h, c.quality === '正常' ? 'ok' : (c.quality === '已中止' ? 'bad' : 'warn'), c.quality); } },
      { key: 'review', label: '审核', render: function (c) { return pill(h, c.reviewTone, c.reviewText); } },
      { key: 'abort', label: '异常', render: function (c) { return c.aborted ? pill(h, 'bad', c.abortReason) : '<span class="muted">—</span>'; } }
    ];
    /* 整行可点：点记录这一行就进这个人的记录与看板（不再摆一个"看记录"按钮）。
       h.table 的 rowAction 走 data-row-act/data-row-id 那一套，行 id 用 "__rid" 传。 */
    rows = rows.map(function (c) { c.__rid = row.id + '|' + c.id; return c; });
    function chip(k, t) {
      return '<span class="chip' + ((filter || '') === (k || '') ? ' link on' : '') + '" data-act="iv-rec-filter" data-id="' + (k || '') + '">' + t + '</span>';
    }
    return statusStrip(h, wb, '访谈记录：全部，不只抽检') +
      /* v10b：副标题口径修正 —— 「当前显示 X 条」容易被读成「这一页渲染了 X 条」（实际分页 20 条/页）；
         改为只在筛选时展示命中数，无筛选时只给总数 */
      '<div class="card pad0"><div class="card-h pad"><h3>全部记录</h3><span class="card-sub">共 ' + wb.rows.length + ' 条' + (rows.length !== wb.rows.length ? ' · 筛选命中 ' + rows.length + ' 条' : '') + '</span></div>' +
      '<div style="padding:0 12px 10px"><div class="chips">' +
      chip('', '全部') + chip('done', '联系完成') + chip('interrupted', '联系中断') + chip('unreachable', '联系不上') +
      chip('abort', '有异常中止') + chip('lowq', '低质量') + chip('audit', '待审') +
      '</div></div>' +
      h.table({ columns: cols, rows: rows, page: state.page || 1, pageSize: 20, rowAction: 'iv-user', rowIdKey: '__rid', emptyTitle: '没有符合条件的记录' }) + '</div>' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn-primary" data-act="iv-pack" data-id="' + esc(h, row.id) + '">打包 4 件套</button>' +
      '<button class="btn-ghost" data-act="iv-export" data-id="csv">导出记录 CSV</button>' +
      '<button class="btn-ghost" data-act="iv-export" data-id="report">导出分析报告</button>' +
      '</div>' +
      h.metaBar({}, [
        { k: '记录范围', v: '全部联系记录（含未接通与中止），不是抽检样本；抽检只是审核的一种策略' },
        { k: '必问覆盖', v: '这条会话里必问话题被问到几个（口径：必须真问到，不是"提过"）' },
        { k: '质量', v: '正常 / 低质量（胡填、答非所问、单轮过短）/ 已中止（命中禁问即停）' }
      ]);
  }

  /* ---------------- ④ 访谈审核 ---------------- */
  function tabAudit(cap, state, h, row, wb) {
    var queue = auditQueue(wb);
    var sel = state.ivAudit || (queue[0] && queue[0].id);
    var cur = null;
    queue.forEach(function (c) { if (c.id === sel) cur = c; });
    if (!cur) cur = queue[0];
    if (cur) state.ivAudit = cur.id;                 /* 打标要知道打的是哪一份 */
    var stars = state.ivStars || loadStars(row.id);
    state.ivStars = stars;
    var starN = 0, sk; for (sk in stars) if (stars[sk]) starN++;

    var queueHtml = queue.length ? '<div class="card pad0" style="margin:0"><div class="card-h pad"><h3>待审队列</h3><span class="card-sub">' + queue.length + ' 条 · 命中禁问 / 低质量 / 负面情绪 必须全审，已置顶</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:7px;padding:0 12px 12px">' + queue.slice(0, 20).map(function (c) {
        var tag = c.aborted ? '命中禁问 · 高优' : (c.quality === '低质量' ? '低质量 · 高优' : '负面情绪');
        var tone = (c.aborted || c.quality === '低质量') ? 'bad' : 'warn';
        return '<button class="kb-card" data-act="iv-audit" data-id="' + esc(h, c.id) + '"' + (c.id === sel ? ' style="border-color:var(--blue);background:var(--blue-weak)"' : '') + '>' +
          '<span style="font-size:12.5px;font-weight:600">' + esc(h, c.name) + ' · ' + esc(h, c.seg) + '</span>' +
          '<span style="display:flex;gap:6px;font-size:11.5px;color:var(--sub)">' + esc(h, tag) + ' · ' + c.rounds + ' 轮' + (stars[c.id] ? ' · 已打标 ' + stars[c.id] : '') + '</span>' +
          '<span>' + pill(h, tone, c.aborted || c.quality === '低质量' ? '必须全审' : '抽样审') + '</span></button>';
      }).join('') + '</div></div>' : '<div class="card"><div class="bt-note">当前没有待审结论。</div></div>';

    var view = cur ? '<div class="card" style="margin:0"><div class="card-h"><h3>' + esc(h, cur.name) + ' 的访谈结论</h3>' +
      pill(h, 'warn', '待审') + '<span class="card-sub">' + cur.rounds + ' 轮 · 引用 ' + Math.max(1, Math.round(cur.rounds * 0.6)) + ' 处知识库</span></div>' +
      '<div class="dl">' +
      '<dt>结论</dt><dd>权限粒度不足与批量导出慢是续约的主要阻碍（置信 0.93）</dd>' +
      '<dt>原文依据</dt><dd>第 2 轮「导出几十万行要等很久，基本得排队」</dd>' +
      '<dt>知识库出处</dt><dd>产品文档库 §批量导出 2.3（相关度 0.91）<span class="tag">引用有效</span></dd>' +
      '<dt>意向分级</dt><dd>中意向 · 需求强度中 / 预算待定 / 决策链未明</dd>' +
      (cur.aborted ? '<dt>异常</dt><dd><span class="pill bad">' + esc(h, cur.abortReason) + '</span>　已中止本场并留痕</dd>' : '') +
      '</div>' +
      '<div class="sub-h">人工校正</div><div class="pick-row">' +
      [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="pick-btn' + (stars[cur.id] === n ? ' on' : '') + '" data-act="iv-star" data-id="' + n + '">' + n + '</button>';
      }).join('') +
      '<span class="pick-or">1 极差 · 5 极好 · 已打标 ' + starN + ' / ' + queue.length + ' 份（保存到本会话）</span>' +
      '<button class="btn-ghost sm" data-act="iv-star-save">保存校正</button></div>' +
      '<div class="sub-h">审核意见（退回必填）</div>' +
      '<input class="iv-input" data-iv="opinion" placeholder="为什么通过 / 为什么退回补充" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px" />' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn-primary" data-act="iv-pass" data-id="' + esc(h, cur.id) + '">通过并归档</button>' +
      '<button class="btn-ghost" data-act="iv-reject" data-id="' + esc(h, cur.id) + '">退回补充</button>' +
      '<span class="pick-or">通过后结论归档到本页「已审结论」，并记引用关系。</span></div></div>' : '';

    return statusStrip(h, wb, '访谈审核：结论能不能用，谁签字') +
      '<div class="dbg-grid">' + queueHtml + (view || '<div class="card"><div class="bt-note">队列为空。</div></div>') + '</div>' +
      h.metaBar({}, [
        { k: '谁必须全审', v: '命中禁问项 / 出现负面情绪 / 触发过越界中止 / 经人工接管 / 联系中断累计超 72h' },
        { k: '审完去哪', v: '通过 → 结论归档（本会话）并记录被谁引用；退回 → 回到草稿，由访谈员补充后再审' },
        { k: '和对外投放的关系', v: '这里只审"内容质量"；对外投放与碰预算另走二次确认，两者状态互不覆盖' }
      ]);
  }

  /* ---------------- ⑤ 结论与分析 ---------------- */
  function tabResult(cap, state, h, row, wb) {
    var an = (IVD.analysis ? IVD.analysis(row) : null);
    if (!an) return statusStrip(h, wb, '结论与分析') + '<div class="card"><div class="bt-note">分析数据层不可用。</div></div>';
    var a = an.accounts;
    var intent = an.intent;
    var iTot = intent.total || 0;
    var rows = [
      { label: '高意向', value: intent.high, share: iTot ? intent.high / iTot : 0, display: String(intent.high) },
      { label: '中意向', value: intent.mid, share: iTot ? intent.mid / iTot : 0, display: String(intent.mid) },
      { label: '低意向', value: intent.low, share: iTot ? intent.low / iTot : 0, display: String(intent.low) }
    ];
    var themes = an.themes;
    var tMax = themes.length ? themes[0].c : 1;
    var six = [
      { label: '计划', value: a.plan.toLocaleString('zh-CN'), unit: '人', sub: '这次要谈的人' },
      { label: '有效对话', value: a.effective.toLocaleString('zh-CN'), unit: '人', sub: '完成至少 1 轮实质回答' },
      { label: '联系完成', value: a.done.toLocaleString('zh-CN'), unit: '人', sub: '对方回过消息' },
      { label: '联系不上', value: a.f.unreachable.toLocaleString('zh-CN'), unit: '人', sub: '终态 · 可人工重开' },
      { label: '联系中断 / 联系中', value: a.f.interrupted + ' / ' + a.f.dialing, unit: '人', sub: '按 24h / 72h / 3 次规则流转' },
      { label: '未联系', value: a.f.pending.toLocaleString('zh-CN'), unit: '人', sub: '排队中' },
      { label: '退出', value: a.exited.toLocaleString('zh-CN'), unit: '人', sub: '明确拒绝 / 拒答 2 次' }
    ];
    /* 情感：数据层只给比例，条数按有效对话折算 —— 左边条数、右边占比，与「意向分级」同一套读法。
       原来 display 和 share 都传的比例，图上就成了「27.0% 27.0%」两遍。 */
    var sTot = a.effective || 0;
    var sPos = Math.round(sTot * an.sentiment.pos);
    var sNeu = Math.round(sTot * an.sentiment.neu);
    var sNeg = Math.max(0, sTot - sPos - sNeu);
    var sentRows = [
      { label: '正面', value: sPos, share: an.sentiment.pos, display: String(sPos) },
      { label: '中性', value: sNeu, share: an.sentiment.neu, display: String(sNeu) },
      { label: '负面', value: sNeg, share: an.sentiment.neg, display: String(sNeg) }
    ];
    return statusStrip(h, wb, '结论与分析') +
      /* 一、总结：这场访谈谈出了什么 */
      '<div class="card"><div class="card-h"><h3>一句话结论</h3><span class="card-sub">这场访谈谈出了什么</span></div>' +
      '<div style="font-size:15px;font-weight:600;line-height:1.8;margin:2px 0 10px">' + esc(h, an.headline || '—') + '</div>' +
      '<div class="metrics g4">' + six.map(h.metricCard).join('') + '</div>' +
      '<div class="bt-note">' + esc(h, an.sample.note) + '　一对一不可能百分百完成。</div></div>' +
      '<div class="card"><div class="card-h"><h3>关键发现</h3><span class="card-sub">每条都要有"多少人这么说 + 代表原话"；单例必须标出来</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' + (an.findings || []).map(function (f) {
        return '<div class="act-item' + (f.strength === '个例' ? ' bad' : '') + '">' +
          '<span class="act-lv">' + f.n + ' 人 · ' + (f.share * 100).toFixed(0) + '%</span>' +
          '<span class="act-main"><b>' + esc(h, f.t) + '</b>' +
          '<i>代表原话：「' + esc(h, f.quote) + '」—— ' + esc(h, f.who) + '　' +
          (f.strength === '充分' ? '证据充分' : '<b>个例</b>') + '</i></span></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>分人群差异</h3><span class="card-sub">同一个问题，不同人群答案不一样</span></div>' +
      '<table class="bt"><thead><tr><th>人群</th><th class="ta-r">有效对话</th><th>最在意</th><th>意向分布</th><th>备注</th></tr></thead><tbody>' +
      (an.segments || []).map(function (s) {
        return '<tr><td><b>' + esc(h, s.seg) + '</b></td><td class="ta-r">' + s.n + '</td><td>' + esc(h, s.top) + '</td><td>' + esc(h, s.intent) + '</td><td class="td-sub">' + esc(h, s.note) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      /* 二、评价：这场访谈做得怎么样、结论能不能用 */
      '<div class="card"><div class="card-h"><h3>本次访谈执行质量</h3><span class="card-sub">这场访谈做得怎么样 —— 决定结论能否成立，评的是执行不是提纲</span></div>' +
      '<div class="metrics g3">' +
      h.metricCard({ label: '平均轮次', value: (an.evaluation.avgRounds || 0).toFixed(1), unit: '轮', sub: '落在 3–7 轮的占 ' + ((an.evaluation.inRangeRate || 0) * 100).toFixed(0) + '%（最长 ' + an.evaluation.maxRounds + ' 轮）' }) +
      h.metricCard({ label: '必问覆盖', value: an.coverage.text, unit: '', sub: '必问话题实际问到' }) +
      h.metricCard({ label: '低质量比例', value: (an.lowQuality.rate * 100).toFixed(1) + '%', unit: '', sub: an.lowQuality.n + ' 条（胡填 / 答非所问 / 单轮过短）' }) +
      h.metricCard({ label: '异常中止率', value: (an.evaluation.abortRate * 100).toFixed(1) + '%', unit: '', sub: an.aborted + ' 条命中禁问即停' }) +
      h.metricCard({ label: '结论审核通过率', value: (an.evaluation.auditPassRate * 100).toFixed(0) + '%', unit: '', sub: '未通过的已退回补充' }) +
      h.metricCard({ label: '有效对话率', value: ((an.effectiveRate || 0) * 100).toFixed(1) + '%', unit: '', sub: '已回复 ÷ 已触达' }) +
      '</div>' +
      '<div class="dl" style="margin-top:12px">' +
      '<dt>结论可信度</dt><dd>证据充分 ' + an.evaluation.evidence.solid + ' 条 · 个例 ' + an.evaluation.evidence.single + ' 条 · 数据不足 ' + an.evaluation.evidence.insufficient + ' 条</dd>' +
      '<dt>轮次规则</dt><dd>默认 3–7 轮 · 有意向或聊得投机可多开两轮 · 上限 12 轮 · 每条消息 ≤ 60 字（克制，不打扰）</dd>' +
      '<dt>局限</dt><dd>' + (an.evaluation.limits || []).join('　·　') + '</dd>' +
      '</div></div>' +
      '<div class="grid2">' +
      '<div class="card"><div class="card-h"><h3>意向分级</h3><span class="card-sub">按有效对话 ' + iTot + ' 人分级，三项之和 = 有效对话人数</span></div>' +
      h.charts.barChart(rows, { colorFn: function (r) { return r.label === '高意向' ? '#16a34a' : (r.label === '低意向' ? '#dc2626' : '#60a5fa'); } }) + '</div>' +
      '<div class="card"><div class="card-h"><h3>主题聚类</h3><span class="card-sub">' + themes.reduce(function (s, x) { return s + x.c; }, 0) + ' 条原话聚为 ' + themes.length + ' 个主题</span></div>' +
      '<div class="cluster-list">' + themes.map(function (t) {
        return '<button class="cl" data-act="iv-theme" data-id="' + esc(h, t.n) + '" style="text-align:left;cursor:pointer">' +
          '<span class="cl-n">' + t.c + '</span><span class="cl-main"><b>' + esc(h, t.n) + ' · ' + Math.round(t.c / tMax * 100) + '%</b></span>' +
          '<span class="cl-pri">下钻 →</span></button>';
      }).join('') + '</div></div></div>' +
      '<div class="grid2">' +
      '<div class="card"><div class="card-h"><h3>情感构成</h3><span class="card-sub">有效对话 ' + sTot.toLocaleString('zh-CN') + ' 人，按原话情绪分类</span></div>' +
      h.charts.barChart(sentRows, { colorFn: function (r) { return r.label === '正面' ? '#16a34a' : (r.label === '负面' ? '#dc2626' : '#60a5fa'); } }) + '</div>' +
      '<div class="card"><div class="card-h"><h3>下一步与打包</h3><span class="card-sub">都是真下载</span></div>' +
      '<div class="btn-row" style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn-primary" data-act="iv-pack" data-id="' + esc(h, row.id) + '">打包 4 件套</button>' +
      '<button class="btn-ghost" data-act="iv-export" data-id="report">导出分析报告</button>' +
      '<button class="btn-ghost" data-act="iv-export" data-id="csv">导出原始 CSV</button>' +
      '<button class="chip link" data-act="iv-mask" aria-pressed="false" title="切换导出脱敏">脱敏</button></div>' +
      '<div class="bt-note">打包 = 分析报告（含一句话结论 / 关键发现 / 分人群差异 / 这场访谈的评价）+ 原始对话 + 样本说明 + 结论卡片。脱敏只影响联系人标识列。</div></div></div>' +
      h.metaBar({}, [
        { k: '取数', v: '六笔账 / 关键发现 / 分人群差异 / 过程质量 / 可信度分级 全部来自 IV_DATA 数据层（唯一出口），页面不自己算' },
        { k: '接口', v: 'POST /interviews/{id}/analysis → { accounts, headline, findings[], segments[], evaluation, intent, themes[], sentiment, coverage, lowQuality }' },
        { k: '报告口径', v: '每条发现必须带"多少人这么说 + 代表原话"；单例标个例；数据不足不下结论；样本说明随结论一起走' }
      ]);
  }

  /* ---------------- ⑥ 历史访谈 ---------------- */
  function tabHistory(cap, state, h, row, wb) {
    var persons = wb.rows.slice(0, 6);
    var rounds = [
      { when: '2026-10-06', name: '本次访谈', ai: INTERVIEWERS[0].name, outline: '话题式 v3（4 话题 / 必问 2）', points: ['权限粒度不足', '导出慢'], intent: '中', kb: '产品文档库 3 处' },
      { when: '2026-04-12', name: '上一轮回访', ai: '回访访谈员 · 小访', outline: '问卷式 v2（12 题）', points: ['上手培训不足', '移动端弱'], intent: '中', kb: '产品文档库 1 处' },
      { when: '2025-11-03', name: '首次接触', ai: '售前访谈员 · 小答', outline: '话题式 v1（3 话题）', points: ['价格高于预期'], intent: '低', kb: '销售话术库 2 处' }
    ];
    var p = persons[0];
    return statusStrip(h, wb, '历史访谈：同一个人前后怎么变') +
      '<div class="card"><div class="card-h"><h3>' + esc(h, p.name) + ' · 历次访谈对照</h3><span class="card-sub">同一联系人 3 次 · 结论与意向变化</span></div>' +
      '<div class="fc-steps">' + rounds.map(function (r) {
        return '<div class="fc-step"><i>' + esc(h, r.when) + '</i><span>' + esc(h, r.name) + '</span><span class="mono">' + esc(h, r.ai) + '</span>' +
          '<span>' + esc(h, r.outline) + ' · 要点：' + esc(h, r.points.join('、')) + ' · 意向 <b>' + esc(h, r.intent) + '</b> · ' + esc(h, r.kb) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">意向：低 → 中 → 中；关注点从"价格"转到"权限与性能"。</div></div>' +
      '<div class="grid2">' +
      '<div class="card"><div class="card-h"><h3>提纲版本历史</h3><span class="card-sub">谁改的、改了什么</span></div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>v3</i><span>今天 · xianyu</span><span class="mono">本次</span><span>新增话题「竞品对比」为必问；禁问项加"不承诺折扣"</span></div>' +
      '<div class="fc-step"><i>v2</i><span>09-28 · xianyu</span><span class="mono">上版</span><span>把话题式改为问卷式（12 题），配额 1,000</span></div>' +
      '<div class="fc-step"><i>v1</i><span>09-20 · 创建</span><span class="mono">首版</span><span>3 个话题骨架</span></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>结论被谁引用</h3><span class="card-sub">归档后去了哪</span></div>' +
      '<div class="act-list">' +
      '<div class="act-item info"><span class="act-lv">画像</span><span class="act-main"><b>国企制造决策链</b><i>新增标签「权限粒度关注」来源：本次访谈 iv-1</i></span></div>' +
      '<div class="act-item info"><span class="act-lv">策略</span><span class="act-main"><b>续费挽回策略 v4</b><i>把"导出性能"纳入话术要点</i></span></div>' +
      '<div class="act-item info"><span class="act-lv">知识库</span><span class="act-main"><b>产品文档库</b><i>缺口：批量导出章节被引用 12 次，建议补文档</i></span></div>' +
      '</div></div></div>' +
      h.metaBar({}, [
        { k: '对照口径', v: '同一联系人（按手机号归并）历次访谈并列；提纲不同版本会标注，避免把两套问题混着比' },
        { k: '引用关系', v: '结论归档后记录被哪些画像 / 策略 / 知识库缺口引用' }
      ]);
  }

  /* ---------------- ⑦ 问卷评价 ----------------
   * 评的是「这份提纲设计得好不好、下一版怎么改」—— 不是「这场访谈做得怎么样」。
   * 后者（平均轮次 / 必问覆盖 / 低质量比例）是执行质量，归「结论与分析」那一页，
   * 因为它决定结论能不能用。两件事同名会让人分不清，所以这里只在文中对比，不改名。
   * 依据：AI 问卷系统的问卷质量评估发生在回收之后，产出的是下一版改进项（试点式复盘）。 */
  function tabSurvey(cap, state, h, row, wb) {
    var an = (IVD.analysis ? IVD.analysis(row) : null);
    var rv = (IVD.questionnaireReview ? IVD.questionnaireReview(row) : null);
    if (!rv) return statusStrip(h, wb, '问卷评价') + '<div class="card"><div class="bt-note">评价数据层不可用。</div></div>';
    var adopted = state.ivAdopted || {};
    var out = rv.next.filter(function (x, i) { return adopted[i]; }).length;
    /* 提纲口径从数据层取，不在这页自己再写一份 */
    var topics = (IVD.OUTLINE && IVD.OUTLINE.topics) || [];
    var mustN = IVD.mustTopics ? IVD.mustTopics().length : topics.filter(function (x) { return x.must; }).length;
    var banN = topics.filter(function (x) { return x.ban; }).length;

    return statusStrip(h, wb, '问卷评价：提纲设计质量，不评受访者') +
      '<div class="card"><div class="card-h split"><h3>提纲评价</h3>' +
      '<span class="card-sub">' + topics.length + ' 个话题 · 必问 ' + mustN + ' · 禁问 ' + banN +
      ' · 有效对话 ' + (an ? an.accounts.done.toLocaleString('zh-CN') : '—') + ' 人</span>' +
      '<div class="card-act">' + pill(h, out ? 'warn' : 'ok', out ? ('已采纳 ' + out + ' 条建议') : '待复盘') + '</div></div>' +
      '<div style="font-size:14.5px;font-weight:600;line-height:1.8;background:#f8fafc;border:1px solid var(--line);border-left:3px solid #2563eb;border-radius:8px;padding:10px 12px">' +
      esc(h, rv.verdict) + '</div>' +
      '<div class="grid2 why-cols" style="margin-top:14px">' +
      '<div><div class="sub-h">保持</div>' + rv.good.map(function (x) {
        return '<div class="why-item"><span>✔ ' + esc(h, x) + '</span></div>';
      }).join('') + '</div>' +
      '<div><div class="sub-h bad">需要修改</div>' + rv.bad.map(function (x) {
        return '<div class="why-item"><span>✕ ' + esc(h, x) + '</span></div>';
      }).join('') + '</div>' +
      '</div>' +
      '<div class="sub-h">下一版建议</div>' +
      '<div class="why-list why-next">' + rv.next.map(function (x, i) {
        var on = !!adopted[i];
        return '<div class="why-item' + (on ? ' skip' : '') + '">' +
          '<div style="display:flex;align-items:center;gap:9px">' +
          '<button class="btn-ghost sm" data-act="iv-adopt" data-id="' + i + '"' + (on ? ' disabled' : '') + '>' + (on ? '已采纳' : '采纳') + '</button>' +
          '<b' + (on ? ' style="color:var(--decor);text-decoration:line-through"' : '') + '>' + esc(h, x) + '</b></div></div>';
      }).join('') + '</div>' +
      h.metaBar({}, [
        { k: '评价对象', v: '提纲设计质量：话题设置 / 必问禁问 / 覆盖度' },
        { k: '区别于执行质量', v: '「结论与分析」页的平均轮次 / 必问覆盖 / 低质量比例 / 中止率' },
        { k: '取数', v: 'POST /interviews/{id}/questionnaire-review，与结论同源' },
        { k: '采纳的落地', v: '采纳项写入提纲版本，下次发布带变更说明' }
      ]) +
      '</div>';
  }

  /* ============================================================
   * 动作
   * ============================================================ */
  A['iv-open'] = function (id, btn, h) { h.navigate({ domain: 'engine', cap: 'interview', agentId: id, objId: id, tab: 'plan', objTab: 'plan', traceId: null }); };
  A['iv-home'] = function (id, btn, h) { h.navigate({ objId: null, objTab: null, tab: null, agentId: null }); };
  A['iv-src'] = function (id, btn, h) { h.state.ivSrc = id; h.navigate({}, { scroll: false }); };
  A['iv-tag'] = function (id, btn, h) {
    var st = h.state, cur = (st.ivTags || ['合同到期前 60 天', '年采购额 > 1000 万']).slice();
    var i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else cur.push(id);
    st.ivTags = cur; h.navigate({}, { scroll: false });
  };
  A['iv-pool-more'] = function (id, btn, h) { h.state.ivPoolN = num(h.state.ivPoolN, 24) + 12; h.navigate({}, { scroll: false }); };
  A['iv-bind'] = function (id, btn, h) { h.state.ivBind = id; h.navigate({}, { scroll: false }); };
  A['iv-sel'] = function (id, btn, h) { h.state.ivSel = id; h.navigate({}, { scroll: false }); };
  A['iv-audit'] = function (id, btn, h) { h.state.ivAudit = id; h.navigate({}, { scroll: false }); };
  /* ── 这四个此前是"谎报成功"：只弹一句「已接管 / 已暂停 / 已标记 / 已保存」，
       却**不写任何 state**，界面因此毫无变化 —— 用户以为做成了，其实什么都没发生。
       现在各自写真实会话态，并且渲染处按状态回显（见上面的按钮与 detail 区），
       与 `iv-reopen`（原本就写 state.ivReopened）保持同一套做法。 */
  A['iv-takeover'] = function (id, btn, h) {
    if (!id) { h.toast('未指定要接管的联系人', 'bad'); return; }
    h.state.ivTaken = h.state.ivTaken || {};
    h.state.ivTaken[id] = true;
    h.toast('已接管 ' + id + '：AI 停止发言，接下来由人工回复（本会话态，刷新还原）', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-mark'] = function (id, btn, h) {
    if (!id) { h.toast('未指定要标记的联系人', 'bad'); return; }
    h.state.ivAbnormal = h.state.ivAbnormal || {};
    h.state.ivAbnormal[id] = true;
    h.toast('已标记异常：' + id + ' 进入异常队列待复核（本会话态，刷新还原）', 'warn');
    h.navigate({}, { scroll: false });
  };
  A['iv-pause-one'] = function (id, btn, h) {
    if (!id) { h.toast('未指定要暂停的联系人', 'bad'); return; }
    h.state.ivPaused = h.state.ivPaused || {};
    h.state.ivPaused[id] = true;
    h.toast('已暂停 ' + id + ' 的触达（其他人不受影响；本会话态，刷新还原）', 'warn');
    h.navigate({}, { scroll: false });
  };
  /* 草稿保存：写会话态并回显「已保存」，否则「保存草稿」是一句空话。 */
  A['iv-save'] = function (id, btn, h) {
    h.state.ivDraftSaved = Date.now();
    h.toast('草稿已保存到本会话（刷新还原）', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-submit'] = function (id, btn, h) {
    var st = h.state;
    st.ivApprovals = st.ivApprovals || [];
    st.ivApprovals.push({ id: id, at: '刚刚', by: '我' });
    h.toast('已发布并生效，操作已记入记录', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-state-filter'] = function (id, btn, h) { h.state.ivStateFilter = id || null; h.navigate({}, { scroll: false }); };
  /* v10b：状态数字下钻 —— 顶部状态条的数字可点了：设过滤状态并切到「过程监控」（联系人为主体）。
     问卷 id 不用传：详情页 state.objId 已是当前问卷，navigate 是 Object.assign 合并，只覆盖传入字段。 */
  A['iv-drill-state'] = function (id, btn, h) {
    h.state.ivStateFilter = id || null;
    h.navigate({ objTab: 'live', tab: 'live' }, { scroll: false });
  };
  A['iv-fold'] = function (id, btn, h) { h.state.ivFold = (h.state.ivFold === id ? null : id); h.navigate({}, { scroll: false }); };
  A['iv-goto-live'] = function (id, btn, h) { h.navigate({ agentId: id, objId: id, tab: 'live', objTab: 'live' }, { scroll: false }); };
  A['iv-reopen'] = function (id, btn, h) {
    var st = h.state;
    st.ivReopened = st.ivReopened || {};
    var n = num(st.ivReopened[id], 0);
    if (n >= 2) { h.toast('这个人已经重开过 2 次，建议换渠道或线下联系', 'warn'); return; }
    st.ivReopened[id] = n + 1;
    audit({ action: 'interview.reopen', target: id, detail: '第 ' + (n + 1) + ' 次人工重开' });
    h.toast('已人工重开（第 ' + (n + 1) + ' 次）：回到「未联系」排队尾，不延续上次会话', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-rec-filter'] = function (id, btn, h) { h.state.ivRecFilter = id || null; h.navigate({}, { scroll: false }); };
  A['iv-star'] = function (n, btn, h) {
    var rid = h.state.objId || h.state.interviewId;
    var stars = h.state.ivStars || loadStars(rid);
    stars[h.state.ivAudit || ''] = num(n, 0);
    h.state.ivStars = stars;
    saveStars(rid, stars);
    var cnt = 0, k; for (k in stars) if (stars[k]) cnt++;
    h.toast('已打标 ' + num(n, 0) + ' 分 · 已保存到本会话（共 ' + cnt + ' 条，刷新仍在）', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-star-save'] = function (id, btn, h) {
    var rid = h.state.objId || h.state.interviewId;
    var ok = saveStars(rid, h.state.ivStars || {});
    var cnt = 0, k; for (k in (h.state.ivStars || {})) if (h.state.ivStars[k]) cnt++;
    h.toast(ok ? ('校正已保存到本会话：' + cnt + ' 条（刷新仍在，关闭标签页失效）') : '保存失败：会话存储不可用', ok ? 'ok' : 'bad');
  };
  /* 打包：四件套依次真下载（分析报告 / 原始对话 / 样本说明 / 结论卡片），内容全部来自数据层 */
  A['iv-pack'] = function (id, btn, h) {
    var t = (global.APP_DATA.getAssetTables() || {}).survey;
    var row = null;
    (t && t.rows || []).forEach(function (x) { if (x.id === (id || h.state.objId || h.state.interviewId)) row = x; });
    if (!row) { h.toast('问卷不存在', 'bad'); return; }
    var files = (global.IV_DATA && global.IV_DATA.pack) ? global.IV_DATA.pack(row) : [];
    if (!files.length) { h.toast('打包失败：数据层不可用', 'bad'); return; }
    files.forEach(function (f, i) {
      if (typeof setTimeout !== 'function') return;
      setTimeout(function () {
        try {
          var url = global.URL.createObjectURL(new global.Blob([f.body], { type: f.mime }));
          var a = document.createElement('a');
          a.href = url; a.download = f.name;
          (document.body || document.documentElement).appendChild(a);
          a.click();
          if (a.remove) a.remove();
        } catch (e) { /* 单个文件失败不阻断其余 */ }
      }, i * 350);
    });
    h.toast('打包中：' + files.length + ' 个文件（分析报告 / 原始对话 / 样本说明 / 结论卡片）依次下载', 'ok');
    audit({ action: 'interview.pack', target: row.id, detail: files.length + ' 个文件' });
  };
  A['iv-pass'] = function (id, btn, h) { h.state.ivPassed = (h.state.ivPassed || []).concat([id]); h.toast('已通过并归档：结论已写入本会话', 'ok'); h.navigate({}, { scroll: false }); };
  A['iv-reject'] = function (id, btn, h) {
    var box = document.querySelector('[data-iv="opinion"]');
    var txt = box ? String(box.value || '').trim() : '';
    if (!txt) { h.toast('退回必须写意见', 'bad'); return; }
    h.toast('已退回补充：' + txt.slice(0, 20), 'warn');
    h.navigate({}, { scroll: false });
  };
  A['iv-mask'] = function (id, btn, h) { h.state.ivMask = !h.state.ivMask; h.toast(h.state.ivMask ? '已开启脱敏导出' : '已关闭脱敏导出', 'info'); h.navigate({}, { scroll: false }); };
  A['iv-theme'] = function (id, btn, h) { h.state.ivTheme = id; h.toast('下钻到「' + id + '」：原话与来源记录在访谈记录里可点回', 'info'); };
  /* ⚠ 此前只弹一句「新建访谈：选人 → 交待提纲 → 派 AI」——**描述流程却不执行**，
     而本仓早就有真实的访谈创建表单（V15_CREATE['survey'] = 「创建访谈」，业界已验证的一套 cf 表单）。
     典型的"该接没接"：把它接到真实入口上。 */
  A['iv-create'] = function (id, btn, h) {
    if (ACTIONS['create-open']) { ACTIONS['create-open']('survey', null, h); return; }
    h.toast('创建入口不可用（create-open 未注册）', 'bad');
  };
  A['iv-export'] = function (id, btn, h) {
    var NL = String.fromCharCode(10);
    var row = null;
    var t = (global.APP_DATA.getAssetTables() || {}).survey;
    (t && t.rows || []).forEach(function (x) { if (x.id === (h.state.objId || h.state.interviewId)) row = x; });
    var name = row ? row.name : '访谈';
    var csv = id === 'csv';
    var head = csv ? ['记录号', '联系人', '人群', '渠道', '联系状态', '轮次', '时长(分)', '审核状态'].join(',') : null;
    var body = csv
      ? String.fromCharCode(0xFEFF) + head + NL + (function () {
          var wb = workbench(row), lines = [];
          wb.rows.forEach(function (c) {
            lines.push([c.id, c.name, c.seg, CH_LABEL[c.channel] || c.channel, STATE_LABEL[c.state], c.rounds, c.durMin, c.review].map(function (x) {
              return '"' + String(x == null ? '' : x).split('"').join('""') + '"';
            }).join(','));
          });
          return lines.join(NL);
        })()
      : ['AI 访谈 · 分析报告', '任务：' + name, '', '计划联系 ' + (row ? row.reached : 0) + ' 人 · 已回复 ' + (row ? row.replied : 0) + ' 人', '', '联系状态分布：未联系 / 正在联系中 / 联系中断 / 联系不上 / 联系完成', '', '意向分级：高 / 中 / 低 = 有效咨询人数', '', '取数：分析服务（当前为内置数据）'].join(NL);
    var fname = 'AI访谈-' + name + (csv ? '-记录.csv' : '-分析报告.txt');
    var ok = false;
    try {
      var url = global.URL.createObjectURL(new global.Blob([body], { type: csv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url; a.download = fname;
      (document.body || document.documentElement).appendChild(a); a.click();
      if (a.remove) a.remove();
      ok = true;
    } catch (e) { ok = false; }
    h.toast(ok ? ('已导出：' + fname) : '导出失败：浏览器不支持本地下载', ok ? 'ok' : 'bad');
  };
})(window);
