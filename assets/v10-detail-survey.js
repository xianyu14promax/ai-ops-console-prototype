/* SECTION: r-survey-detail  (v10 · W2-C · Top 1)
 * AI 访谈问卷详情 —— 「三个阶段三种形态」：
 *   design 设计与投放（范式 B：结构树 + 题型 + 逻辑分支校验 + 预投放校验 + 投放配置 + 审批）
 *   live   进行中监控（范式 C：实时看板 + 放弃节点分布 + AI 访谈质量抽检 + 异常预警 + 暂停投放）
 *   review 回收与分析（范式 F+E：逐份审阅台(键盘 J/K/1-5/⌘S) + 聚合分析 + 开放题聚类树下钻 + 显著性检验 + 导出）
 *
 * 取数（不写死）：survey 资产表行（qcount / collected / quota / finishRate / avgDur / dropNode / status*）
 *   · 显著性只走 h.query.twoPropTest（单出口：运行指标只走 QUERY）
 *   · 人群/团队来自 seed 维度表 SEGMENTS；投诉反馈复用 userops.feedback
 *   · 逐题结构 / 跳转逻辑 / 放弃分布 / 访谈记录 / 主题聚类为确定性示例（种子固定 → 刷新不变），
 *     真值在底部 metaBar 里逐项标注来源，绝不把随机波动当结论。
 *
 * 本文件只注册：RENDERERS.surveyDetail 与 ACTIONS['sv-*']。不碰任何其它文件。
 */
(function (global) {
  'use strict';

  var R = global.RENDERERS, ACTIONS = global.ACTIONS, S = global.DATA_SEED;
  var V = global.V10UI || {};

  /* SECTION: consts */
  var TABS = [
    { id: 'design', label: '访谈设计' },
    { id: 'live', label: '触达与回收' },
    { id: 'review', label: '咨询结论与分析' }
  ];
  var TYPE_LABEL = { single: '单选', multi: '多选', scale: '量表', open: '开放题', ai: 'AI 追问题' };
  var TYPE_SEC = { single: 18, multi: 26, scale: 20, open: 45, ai: 35 };
  var SEGS = (S.SEGMENTS || []).slice(0, 4);
  var CH_LABEL = { im: 'IM', wecom: '企微', sms: '短信' };
  var CHANNELS = ['im', 'wecom', 'sms'];

  var TITLE_POOL = {
    single: ['最近一次使用发生在什么时候', '主要通过哪个渠道了解我们', '你目前使用的版本 / 套餐', '你所在的角色与团队规模'],
    multi: ['你最看重以下哪些能力', '过去一个月使用过哪些功能', '你通过哪些渠道获得支持', '影响你续费决策的因素'],
    scale: ['对整体体验打分（1–5）', '对响应速度打分（1–5）', '向同事推荐的可能性（0–10）'],
    open: ['还有什么我们没问到的建议', '请描述一次让你不满意的经历', '如果只能改一件事，你会改什么'],
    ai: ['展开说说刚才提到的困难（AI 追问）', '关于你选的渠道，能再具体一点吗（AI 追问）', '你提到的这个问题，能举个具体例子吗（AI 追问）']
  };
  var SINGLE_OPTS = ['每天', '每周几次', '每月几次', '几个月一次', '几乎不用', '官方渠道', '销售推荐', '同行介绍', '会议 / 展会'];
  var MULTI_OPTS = ['数据整合', '权限管理', '报表分析', '流程自动化', '移动端', '开放接口', '合规审计', '实施服务'];
  var AI_TRIGGERS = ['上一题回答少于 12 字', '识别到负面情绪（score < -0.35）', '未提及具体场景', '答案与所选选项矛盾'];
  var FUP_REASONS = [
    '回答停留在结论层，缺少可归因的事实 → 追问具体场景',
    '提及「不方便」但未说明是哪个环节 → 追问卡点位置',
    '情绪偏负但未给出原因 → 追问不满来源',
    '出现了未预期的产品名 → 追问是否在做竞品对比',
    '上一轮回答与所选选项不一致 → 澄清真实口径'
  ];
  var REC_ANS = [
    '上个月做季度复盘的时候用过一次，平时主要还是看报表。',
    '大概是销售在群里推的，后来我自己去官网查了文档。',
    '我们用的是标准版，团队十几个人，主要做数据这块。',
    '最烦的是导出要等很久，几十万行就得排队。',
    '集成那块文档写得太粗，试了两天没跑通，最后找的实施。',
    '价格倒不是最大问题，主要是模块捆得太死，用不上的也得买。'
  ];
  var REC_FUP = ['能具体说说是哪个报表吗？', '当时卡在哪一步？有报错信息吗？', '如果只能改一点，你最想改哪里？'];
  var REC_ANS2 = [
    '就是那个跨库汇总的口径，字段对不上。',
    '配置的时候一直提示权限不足，换了账号也不行。',
    '把导出做成异步的，发个通知就行，别让我干等。'
  ];
  var EXTRACT_POOL = {
    need: ['批量导出性能', '权限粒度', '实施支持', '套餐灵活性', '文档完整度'],
    mood: ['偏负', '中性', '偏正'],
    competitor: ['有（同类 SaaS）', '有（自研）', '未提及'],
    willing: ['高', '中', '低']
  };
  var THEME_DEFS = [
    { name: '价格与性价比', subs: ['折扣力度不足', '套餐不够灵活', '续费涨价'] },
    { name: '产品能力', subs: ['功能缺失', '集成困难', '性能不稳定'] },
    { name: '服务与支持', subs: ['响应慢', '答复不专业', '工单流转长'] },
    { name: '实施与上手', subs: ['培训不足', '文档难懂', '配置复杂'] },
    { name: '合规与安全', subs: ['数据出境顾虑', '权限粒度粗'] }
  ];
  var QUOTE_POOL = [
    '续费报价比去年高了不少，预算不好批', '折扣只能按季度给，我们想按年签', '套餐里的模块用不上，能不能拆开买',
    '导出几十万行要等很久，希望改成异步', '跨库汇总的字段对不上，只能手工拼', '移动端功能太弱，出差基本没法用',
    '接口文档写得太粗，试了两天没跑通', '和内部系统的对接要开发一大堆胶水代码', '高峰期偶尔超时，生产环境出现过两次',
    '提工单要等一天才回', '回复的人像是照着模板念，没解决我的问题', '一个问题转了三个人才对上',
    '上线前没有培训，全靠自己摸索', '文档里和图例对不上，越看越乱', '配置项太多了，不知道哪个是必填',
    '数据出境的合规说明拿不到', '权限只能到角色级，做不到字段级', '审计日志导不出来，合规检查过不了'
  ];

  /* SECTION: utils */
  function pad2(n) { var s = String(n); return s.length < 2 ? '0' + s : s; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function durSec(str) {
    if (str == null) return null;
    var m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(String(str).trim());
    if (!m) return null;
    var v = num(m[1], 0) * 3600 + num(m[2], 0) * 60 + num(m[3], 0);
    return v > 0 ? v : null;
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  /** 确定性份额：同一 key 恒得同一组归一化权重 */
  function shares(key, n) {
    var r = S.R.of(key), ws = [], tot = 0, i;
    for (i = 0; i < n; i++) { var w = 0.35 + r() * 1.0; ws.push(w); tot += w; }
    return ws.map(function (w) { return w / tot; });
  }
  function pickN(r, pool, k) {
    var idx = pool.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    var take = Math.min(k, idx.length), out = [];
    for (i = 0; i < take; i++) out.push(pool[idx[i]]);
    return out;
  }
  /** 最大余数法分配整数，保证合计 == total */
  function distribute(total, ws) {
    var out = [], acc = 0, i;
    for (i = 0; i < ws.length; i++) { var v = Math.floor(total * ws[i]); out.push(v); acc += v; }
    var rem = total - acc;
    var order = ws.map(function (w, k) { return { k: k, w: w }; }).sort(function (a, b) { return b.w - a.w; });
    for (i = 0; i < rem; i++) out[order[i % order.length].k]++;
    return out;
  }
  function dropNodeNum(s) { var m = /^Q(\d+)/.exec(String(s == null ? '' : s)); return m ? Number(m[1]) : null; }
  /** 人群权重归一化（seed 里 5 类人群，本页只用前 4 类 → 必须归一，否则配额合计对不上） */
  function segShares() {
    var tot = 0, i;
    for (i = 0; i < SEGS.length; i++) tot += num(SEGS[i].weight, 0);
    return SEGS.map(function (s) { return tot ? num(s.weight, 0) / tot : 1 / SEGS.length; });
  }
  function qShort(title, max) {
    var t = String(title || '').replace(/^Q\d+\s*/, '');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function segName(id) {
    var segs = [];
    try { var p = global.APP_DATA.getPipelines(); segs = (p && p.userops && p.userops.segments) || []; } catch (e) { segs = []; }
    for (var i = 0; i < segs.length; i++) if (segs[i].id === id) return segs[i].name;
    return id || '未指定';
  }
  function chLabels(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map(function (c) { return CH_LABEL[c] || c; }).join(' / ');
  }
  /** 名单来源 → 单行文案（分群取分群名，导入取文件名） */
  function sourceLabel(ls) {
    if (!ls) return '—';
    if (ls.kind === 'import') return '导入名单' + (ls.file ? '（' + ls.file + (ls.count ? ' · ' + num(ls.count, 0) + ' 人' : '') + '）' : '');
    if (ls.kind === 'segment') return '分群：' + segName(ls.segId);
    return '—';
  }
  /** 交付方式 → 单行文案 */
  function deliveryLabel(dl) {
    if (!dl) return '—';
    var out = [];
    if (dl.dispatch) out.push('AI 派发触达');
    if (dl.selfserve) out.push('自助入口');
    return out.length ? out.join(' + ') : '—';
  }
  /** 自助入口二维码占位：确定性方块阵（种子固定 → 刷新不变），不用 Math.random */
  function qrPlaceholder(seed) {
    var N = 21, cells = [], i, j, r = S.R.of('svqr|' + seed);
    function finder(x0, y0) {
      for (var a = 0; a < 7; a++) for (var b = 0; b < 7; b++) {
        var edge = a === 0 || a === 6 || b === 0 || b === 6;
        var core = a >= 2 && a <= 4 && b >= 2 && b <= 4;
        if (edge || core) cells.push([x0 + a, y0 + b]);
      }
    }
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      if ((i < 8 && j < 8) || (i < 8 && j >= N - 8) || (i >= N - 8 && j < 8)) continue;
      if (r() < 0.45) cells.push([i, j]);
    }
    var rects = cells.map(function (c) { return '<rect x="' + c[0] + '" y="' + c[1] + '" width="1" height="1"/>'; }).join('');
    return '<svg class="sv-qr" width="126" height="126" viewBox="0 0 ' + N + ' ' + N + '" role="img" aria-label="自助入口二维码">' +
      '<rect width="' + N + '" height="' + N + '" fill="#fff"/><g fill="#111">' + rects + '</g></svg>';
  }

  /* SECTION: data-access */
  var _a = null;
  function tables() {
    if (_a) return _a;
    try { _a = global.APP_DATA.getAssetTables() || {}; } catch (e) { _a = {}; }
    return _a;
  }
  function getSurvey(id) {
    if (!id) return null;
    var A = global.APP_DATA || {};
    if (typeof A.byId === 'function') { var r0 = A.byId('survey', id); if (r0) return r0; }
    var t = tables().survey;
    if (t && t.rows) {
      for (var i = 0; i < t.rows.length; i++) if (t.rows[i].id === id) return t.rows[i];
    }
    return null;
  }
  function personaRows() { var t = tables().persona; return t && t.rows ? t.rows : []; }
  function simRows() { var t = tables().persona_sim; return t && t.rows ? t.rows : []; }
  function feedbackItems() {
    try {
      var p = global.APP_DATA.getPipelines();
      return (p && p.userops && p.userops.feedback && p.userops.feedback.items) || [];
    } catch (e) { return []; }
  }
  function refsCount(id) {
    var A = global.APP_DATA || {};
    if (typeof A.refsOf !== 'function') return 0;
    try { return (A.refsOf(id) || []).length; } catch (e) { return 0; }
  }

  /* SECTION: frontend-only 落点
   * 本原型没有后端：人工校正的持久化只能到 sessionStorage（同一标签页刷新仍在，关掉即失效），
   * 导出只能靠 Blob 下载。界面上必须如实写"本会话"，不许写成"已保存/已入库"。 */
  function tagStoreKey(id) { return 'aiops:sv:tags:' + (id || 'unknown'); }
  function loadTags(id) {
    try {
      var raw = global.sessionStorage ? global.sessionStorage.getItem(tagStoreKey(id)) : null;
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function persistTags(id, tags) {
    try {
      if (!global.sessionStorage) return false;
      global.sessionStorage.setItem(tagStoreKey(id), JSON.stringify(tags || {}));
      return true;
    } catch (e) { return false; }
  }
  /** 纯前端下载：Blob + a[download]。返回 false 表示浏览器不支持，调用方必须如实报错 */
  function downloadFile(filename, text, mime) {
    try {
      var B = global.Blob, U = global.URL;
      if (!B || !U || typeof U.createObjectURL !== 'function') return false;
      if (typeof document === 'undefined' || !document.createElement) return false;
      var url = U.createObjectURL(new B([text], { type: mime || 'text/plain;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      if (a.remove) a.remove(); else if (a.parentNode) a.parentNode.removeChild(a);
      if (typeof setTimeout === 'function') setTimeout(function () { try { U.revokeObjectURL(url); } catch (e) {} }, 4000);
      return true;
    } catch (e) { return false; }
  }

  /* SECTION: V10UI 降级调用（签名已冻结，不在本文件重造同名实现） */
  function callV(name, args, fallback) {
    var f = V && V[name];
    if (typeof f === 'function') {
      try { var out = f.apply(V, args); if (out) return out; } catch (e) { /* 组件异常 → 走降级 */ }
    }
    return typeof fallback === 'function' ? fallback() : (fallback || '');
  }
  function vReady() { return !!(V && typeof V.detailTabs === 'function'); }

  /* SECTION: build-questions — 从 qcount 派生逐题结构（确定性） */
  function buildQuestions(row) {
    var n = Math.max(1, num(row.qcount, 0));
    var R2 = S.R, out = [], i;
    var grp = ['基本信息', '使用情况', '满意度', '开放与建议'];
    var b1 = Math.ceil(n * 0.25), b2 = Math.ceil(n * 0.5), b3 = Math.ceil(n * 0.8);
    for (i = 1; i <= n; i++) {
      var r = R2.of('svq|' + row.id + '|' + i);
      var type;
      if (i === 1) type = 'single';
      else if (i === n) type = 'open';
      else if (i === n - 1) type = 'scale';
      else if (i % 4 === 0) type = 'ai';
      else if (i % 3 === 0) type = 'multi';
      else if (i % 2 === 0) type = 'scale';
      else type = 'single';

      var pool = TITLE_POOL[type];
      var ti = Math.floor(r() * pool.length) % pool.length;
      var title = pool[ti];
      var q = {
        n: i, type: type, typeLabel: TYPE_LABEL[type],
        title: 'Q' + i + ' ' + title, baseTitle: title,
        group: i <= b1 ? grp[0] : (i <= b2 ? grp[1] : (i <= b3 ? grp[2] : grp[3])),
        required: i <= 2 || r() < 0.55,
        sensitive: (i <= b1) || r() < 0.14,
        options: [], jump: null, jumps: null, backJump: null, ai: null
      };
      if (type === 'single') q.options = pickN(r, SINGLE_OPTS, 3 + Math.floor(r() * 2));
      else if (type === 'multi') q.options = pickN(r, MULTI_OPTS, 4 + Math.floor(r() * 3));
      else if (type === 'scale') {
        if (i === n - 1 || title.indexOf('0–10') >= 0) {
          q.options = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
        } else q.options = ['1', '2', '3', '4', '5'];
      } else if (type === 'ai') {
        q.ai = { trigger: pick(r, AI_TRIGGERS), depthMax: 2 + Math.floor(r() * 2), model: 'qwen-plus', roundMs: 900 + Math.floor(r() * 600) };
      }
      out.push(q);
    }

    /* 顺跳分支：选某选项直接跳过中间题 */
    for (i = 2; i <= n && i + 2 <= n; i++) {
      var qq = out[i - 1];
      if (qq.type === 'single' && (i % 3 === 0)) qq.jump = { option: qq.options[0], to: Math.min(n, i + 2) };
    }
    /* 全分支跳转：若命中则中间若干题将不可达（逻辑缺陷，校验会如实报出） */
    if (n >= 16 && S.R.of('svskip|' + row.id)() < 0.6) {
      var s = Math.floor(n * 0.32), qs2 = out[s - 1];
      if (qs2 && qs2.type === 'single') {
        qs2.jumps = qs2.options.map(function (o, k) { return { option: o, to: Math.min(n, Math.min(n, s + 4) + (k % 2)) }; });
      }
    }
    /* 回跳（评分低则回问）：形成环路，校验会如实报出「循环」 */
    if (n >= 8 && S.R.of('svback|' + row.id)() < 0.5) {
      var bi = n - 1;
      out[bi - 1].backJump = { option: '评分 ≤ 2', to: Math.max(1, bi - 3) };
    }
    return out;
  }

  /* SECTION: flow-analysis — 真实图算法：可达性 BFS + 环检测 DFS */
  function buildEdges(qs) {
    var edges = [], i;
    for (i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (q.jumps) {
        for (var a = 0; a < q.jumps.length; a++) edges.push({ from: q.n, to: q.jumps[a].to, label: '选「' + q.jumps[a].option + '」' });
      } else {
        edges.push({ from: q.n, to: i + 1 < qs.length ? qs[i + 1].n : null, label: '（默认）下一题' });
      }
      if (q.jump) edges.push({ from: q.n, to: q.jump.to, label: '选「' + q.jump.option + '」' });
      if (q.backJump) edges.push({ from: q.n, to: q.backJump.to, label: q.backJump.option + ' · 回跳' });
    }
    var out = [];
    for (i = 0; i < edges.length; i++) if (edges[i].to != null) out.push(edges[i]);
    return out;
  }
  function analyzeFlow(qs) {
    var edges = buildEdges(qs), adj = {}, i, k;
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!adj[e.from]) adj[e.from] = [];
      adj[e.from].push(e);
    }
    /* 可达性 */
    var seen = {}, stack = qs.length ? [qs[0].n] : [];
    while (stack.length) {
      var cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = true;
      var as = adj[cur] || [];
      for (k = 0; k < as.length; k++) stack.push(as[k].to);
    }
    var reachable = 0;
    for (i = 0; i < qs.length; i++) if (seen[qs[i].n]) reachable++;
    var unreachable = [];
    for (i = 0; i < qs.length; i++) if (!seen[qs[i].n]) unreachable.push(qs[i].n);

    /* 环检测 */
    var color = {}, cycles = [];
    function dfs(u) {
      color[u] = 1;
      var as = adj[u] || [];
      for (var x = 0; x < as.length; x++) {
        var v = as[x].to;
        if (color[v] === 1) {
          var dup = false;
          for (var c = 0; c < cycles.length; c++) if (cycles[c].from === u && cycles[c].to === v) dup = true;
          if (!dup) cycles.push({ from: u, to: v, label: as[x].label });
        } else if (!color[v]) dfs(v);
      }
      color[u] = 2;
    }
    for (i = 0; i < qs.length; i++) if (!color[qs[i].n]) dfs(qs[i].n);

    return {
      edges: edges, reachable: reachable, total: qs.length,
      unreachable: unreachable, cycles: cycles,
      pass: cycles.length === 0 && unreachable.length === 0
    };
  }

  /* SECTION: abandonment — 放弃节点分布（锚定资产表的「主要流失题」） */
  function abandonDist(row, qs) {
    var finished = num(row.collected, 0);
    var fr = num(row.finishRate, 0);
    var entered = fr > 0 ? Math.round(finished / fr) : finished;
    if (entered < finished) entered = finished;
    var abandons = Math.max(0, entered - finished);
    var dropN = dropNodeNum(row.dropNode);
    var R2 = S.R.of('svdrop|' + row.id), ws = [], tot = 0, i;
    for (i = 0; i < qs.length; i++) {
      var base = 0.6 + (i / Math.max(1, qs.length - 1)) * 1.5;
      var w = base * (0.7 + R2() * 0.6);
      if (dropN != null && qs[i].n === dropN) w *= 3.4;
      ws.push(w); tot += w;
    }
    var norm = ws.map(function (w) { return w / tot; });
    var vals = distribute(abandons, norm);
    var rows = qs.map(function (q, idx) {
      return { n: q.n, label: 'Q' + q.n + ' ' + qShort(q.title, 12), value: vals[idx], share: abandons ? vals[idx] / abandons : 0, drop: dropN === q.n };
    });
    return { entered: entered, finished: finished, abandons: abandons, rows: rows, dropN: dropN };
  }

  /* SECTION: records — 逐份访谈记录（确定性示例，含 AI 追问链路） */
  function buildRecords(row, qs, n) {
    var out = [], i, k;
    var qpool = qs.filter(function (q) { return q.type !== 'ai'; });
    if (!qpool.length) qpool = qs;
    for (i = 0; i < n; i++) {
      var r = S.R.of('svrec|' + row.id + '|' + i);
      var seg = SEGS.length ? SEGS[Math.floor(r() * SEGS.length) % SEGS.length] : { id: 'na', name: '未分层' };
      var rounds = 1 + Math.floor(r() * 3);
      var base = qpool[Math.floor(r() * qpool.length) % qpool.length];
      var turns = [];
      turns.push({ role: 'q', text: base.title });
      turns.push({ role: 'a', text: pick(r, REC_ANS) });
      for (k = 1; k <= rounds; k++) {
        turns.push({ role: 'f', text: pick(r, REC_FUP), reason: pick(r, FUP_REASONS), depth: k, trigger: pick(r, AI_TRIGGERS) });
        turns.push({ role: 'a', text: pick(r, REC_ANS2) });
      }
      var durMin = Math.max(1, Math.round((durSec(row.avgDur) || 240) / 60 * (0.6 + r() * 0.9)));
      var q = {
        idx: i, id: row.id + '-R' + pad2(i + 1), seg: seg, finished: r() > 0.16,
        rounds: rounds, durMin: durMin, turns: turns,
        extracted: [
          { k: '核心诉求', v: pick(r, EXTRACT_POOL.need), c: (0.62 + r() * 0.33) },
          { k: '情绪', v: pick(r, EXTRACT_POOL.mood), c: (0.55 + r() * 0.4) },
          { k: '提及竞品', v: pick(r, EXTRACT_POOL.competitor), c: (0.5 + r() * 0.45) },
          { k: '意愿', v: pick(r, EXTRACT_POOL.willing), c: (0.58 + r() * 0.36) }
        ],
        offTopic: r() < 0.12, leading: r() < 0.09, repeat: r() < 0.10
      };
      q.quality = q.offTopic ? '偏题' : (q.leading ? '诱导' : (q.repeat ? '重复追问' : '通过'));
      out.push(q);
    }
    return out;
  }

  /* SECTION: aggregates */
  function singleDist(row, q) {
    var sh = shares('svans|' + row.id + '|q' + q.n, q.options.length);
    var rows = q.options.map(function (o, i) { return { option: o, share: sh[i] }; });
    var cross = SEGS.map(function (sg) {
      return { seg: sg, shares: shares('svseg|' + row.id + '|q' + q.n + '|' + sg.id, q.options.length) };
    });
    return { rows: rows, cross: cross };
  }
  function scaleStats(row, q) {
    var n = q.options.length;
    var sh = shares('svscale|' + row.id + '|q' + q.n, n);
    var mean = 0, pos = 0, neg = 0, top2 = 0, i;
    for (i = 0; i < n; i++) {
      var v = num(q.options[i], 0);
      mean += v * sh[i];
      if (v >= 9) pos += sh[i];
      if (v <= 6) neg += sh[i];
      if (v >= 4) top2 += sh[i];
    }
    return { shares: sh, mean: mean, nps: n === 11 ? (pos - neg) : null, top2: top2 };
  }
  function buildThemes(row) {
    var R2 = S.R.of('svtheme|' + row.id);
    var mentions = Math.max(12, Math.round(num(row.collected, 0) * (0.24 + R2() * 0.2)));
    var tw = THEME_DEFS.map(function (_, i) { return 0.6 + R2() * 1.2 + (i === 0 ? 1.4 : 0); });
    var tTot = tw.reduce(function (a, b) { return a + b; }, 0);
    var tCounts = distribute(mentions, tw.map(function (w) { return w / tTot; }));
    var themes = THEME_DEFS.map(function (t, ti) {
      var sw = t.subs.map(function () { return 0.5 + R2() * 1.3; });
      var sTot = sw.reduce(function (a, b) { return a + b; }, 0);
      var sc = distribute(tCounts[ti], sw.map(function (w) { return w / sTot; }));
      var subs = t.subs.map(function (name, si) {
        var cnt = sc[si];
        var quotes = [];
        for (var qi = 0; qi < Math.min(6, cnt); qi++) {
          var rq = S.R.of('svquote|' + row.id + '|' + ti + '|' + si + '|' + qi);
          quotes.push({
            text: QUOTE_POOL[Math.floor(rq() * QUOTE_POOL.length) % QUOTE_POOL.length],
            rec: row.id + '-R' + pad2(1 + Math.floor(rq() * 16))
          });
        }
        return { name: name, count: cnt, quotes: quotes };
      });
      return { idx: ti, name: t.name, count: tCounts[ti], subs: subs };
    });
    return { mentions: mentions, themes: themes };
  }
  function sentimentData(row) {
    var R2 = S.R.of('svsent|' + row.id);
    var sh = shares('svsent|' + row.id + '|mix', 3);
    var days = 7, trend = [];
    for (var d = 0; d < days; d++) {
      var r = S.R.of('svtrend|' + row.id + '|' + d);
      trend.push(28 + Math.round(r() * 22 + d * 1.4));
    }
    var kw = ['价格', '集成', '响应速度', '培训', '稳定性'];
    var kws = kw.map(function (name, i) {
      var r = S.R.of('svkw|' + row.id + '|' + i);
      var base = 20 + Math.floor(r() * 60);
      var series = [];
      for (var t = 0; t < 7; t++) { var rr = S.R.of('svkw|' + row.id + '|' + i + '|' + t); series.push(Math.max(4, base + Math.round((rr() - 0.5) * 16) + t)); }
      return { name: name, total: series[6], series: series, delta: series[6] - series[0] };
    });
    return { mix: { pos: sh[0], neu: sh[1], neg: sh[2] }, trend: trend, keywords: kws };
  }
  function compareGroups(h, row, id, tag, g1, g2, key) {
    var collected = num(row.collected, 0);
    var Q = h.query || global.QUERY;
    var w1 = g1.weight, w2 = g2.weight;
    var n1 = Math.round(collected * w1), n2 = Math.round(collected * w2);
    var r1 = S.R.of(key + '|' + id + '|' + g1.id)(), r2 = S.R.of(key + '|' + id + '|' + g2.id)();
    var p1 = 0.42 + r1 * 0.34, p2 = 0.40 + r2 * 0.30;
    var x1 = Math.round(n1 * p1), x2 = Math.round(n2 * p2);
    var sig;

    if (!Q || typeof Q.twoPropTest !== 'function') {
      sig = { p: null, significant: false, reason: '统计模块未就绪' };
    } else if (n1 < 30 || n2 < 30) {
      sig = { p: null, significant: false, reason: '样本不足（n < 30）' };
    } else {
      sig = Q.twoPropTest(x1, n1, x2, n2);
    }
    return { tag: tag, g1: g1, g2: g2, n1: n1, n2: n2, p1: p1, p2: p2, diff: p1 - p2, sig: sig };
  }

  /* SECTION: atoms */
  function pill(h, kind, text) { return typeof h.pill === 'function' ? h.pill(kind, text) : '<span class="pill ' + kind + '">' + h.esc(text) + '</span>'; }
  function crumb(h, cap, row) {
    return callV('pageCrumb', [[{ text: '引擎' }, { text: h.esc(cap.name) }, { text: row.name }]], function () {
      return '<div class="crumb" style="margin-bottom:10px">' + h.esc(cap.name) + ' / <b>' + h.esc(row.name) + '</b></div>';
    });
  }
  function tabsBar(h, cap, state, tab, badges) {
    var tabs = TABS.map(function (t) {
      return { id: t.id, label: t.label, badge: badges && badges[t.id] != null ? badges[t.id] : null };
    });
    return callV('detailTabs', [cap, state, tabs], function () {
      /* 降级：与 renderers.js 的 tabBar 同形，由 app.js 既有的 [data-tab] 委托驱动 → Tab 写入 URL */
      return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button role="tab" class="tab' + (t.id === tab ? ' on' : '') + '" data-tab="' + t.id + '">' + h.esc(t.label) +
          (t.badge != null ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
      }).join('') + '</div>';
    });
  }
  function head(h, cap, row) {
    var ls = row.listSource, dl = row.delivery || {};
    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('chat', 20) + ' ' + h.esc(row.name) + ' ' + pill(h, row.status, row.statusText) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div>' +
      '<div class="ph-tags">' +
      '<span>名单来源 ' + h.esc(sourceLabel(ls)) + '</span>' +
      '<span>交付方式 ' + h.esc(deliveryLabel(dl)) + '</span>' +
      '<span>已触达 ' + h.fmt.int(num(row.reached, 0)) + '</span>' +
      '<span>回复率 ' + h.fmt.pct1(num(row.replyRate, 0)) + '</span>' +
      '<span>有效咨询 ' + h.fmt.int(num(row.consulted, 0)) + '</span>' +
      '</div></div>' +
      '<div class="ph-side">' +
      (typeof V.permTag === 'function' ? V.permTag('survey:publish') : '<span class="pill idle">survey:publish</span>') +
      '<button class="btn-ghost" data-act="sv-back">← 访谈列表</button>' +
      '</div></div>';
  }
  function statusStrip(h, row, extra) {
    var reached = num(row.reached, 0), replied = num(row.replied, 0);
    var consulted = num(row.consulted, 0);
    var replyRate = num(row.replyRate, reached ? replied / reached : 0);
    return '<div class="verbar' + (row.status === 'ok' ? '' : ' offline') + '">' +
      '<span class="vb-item"><i>触达状态</i><b>' + h.esc(row.statusText) + '</b>' +
      (row.status === 'info' ? '<em class="vb-full">进行中</em>' : (row.status === 'warn' ? '<em class="vb-draft">未投放</em>' : '<em class="vb-gray">已结束</em>')) + '</span>' +
      '<span class="vb-sep"></span>' +
      '<span class="vb-item"><i>已触达 / 已回复</i><b>' + h.fmt.int(reached) + ' / ' + h.fmt.int(replied) + '</b></span>' +
      '<span class="vb-sep"></span>' +
      '<span class="vb-item"><i>有效咨询</i><b>' + h.fmt.int(consulted) + '</b></span>' +
      '<span class="vb-sep"></span>' +
      '<span class="vb-item" style="flex:1"><i>回复进度</i>' + h.charts.gauge(replyRate) + '</span>' +
      '<span class="vb-right">' + (extra || '') + '</span></div>';
  }

  /* SECTION: tab-design */
  function tabDesign(cap, state, h, row, qs, flow) {
    var fmt = h.fmt;
    var ls = row.listSource, dl = row.delivery || {};
    var chs = row.channels || dl.channels || [];
    var rounds = Math.max(1, num(row.qcount, 0));
    var reached = num(row.reached, 0), replied = num(row.replied, 0);
    var replyRate = num(row.replyRate, reached ? replied / reached : 0);

    /* ① 访谈目标与名单 */
    var goal = '<div class="card"><div class="card-h"><h3>访谈目标与名单</h3>' +
      '<span class="card-sub">拿到联系方式后由 AI 主动发起多轮咨询</span></div>' +
      '<div class="metrics">' + [
        { label: '访谈目标', value: row.target || '—', sub: '名单口径与分群 / 导入一致' },
        { label: '名单来源', value: sourceLabel(ls), sub: (ls && ls.kind === 'import' && ls.count) ? ('本次导入 ' + fmt.int(ls.count) + ' 人') : '复用运营分群圈人结果' },
        { label: '轮次规模', value: fmt.int(rounds) + ' 轮', sub: '含 AI 追问的多轮文本咨询' },
        { label: '回收目标', value: fmt.int(num(row.quota, 0)) + ' 份', sub: '已回收 ' + fmt.int(num(row.collected, 0)) }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="sub-h">触达渠道</div>' +
      '<div class="chips">' + (chs.length
        ? chs.map(function (c) { return '<span class="chip on">' + h.esc(CH_LABEL[c] || c) + '</span>'; }).join('')
        : '<span class="chip">未指定</span>') + '</div>' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn-ghost sm" data-act="sv-import-list" data-id="' + h.esc(row.id) + '">导入 / 更换名单</button>' +
      '<span class="pick-or">名单来自运营分群圈人或名单导入；下发前自动排除频控内已触达、已退订与黑名单。</span></div></div>';

    /* ② 交付方式 */
    var dlMode = state.svDelivery || (dl.dispatch && dl.selfserve ? 'both' : (dl.selfserve ? 'selfserve' : 'dispatch'));
    var showDisp = dlMode === 'dispatch' || dlMode === 'both';
    var showSelf = dlMode === 'selfserve' || dlMode === 'both';
    var link = state.svLink || dl.link || ('https://iv.example.com/s/' + row.id);
    var qr = qrPlaceholder((dl.qrSeed || row.id) + '|' + num(state.svQrN, 0));
    var delivery = '<div class="card"><div class="card-h"><h3>交付方式</h3>' +
      '<span class="card-sub">AI 派发触达 · 或 自助入口链接 / 二维码</span></div>' +
      '<div class="pick-row">' + [
        ['dispatch', 'AI 派发（IM / 企微 / 短信）'],
        ['selfserve', '自助入口（链接 / 二维码）'],
        ['both', '两者都要']
      ].map(function (m) {
        return '<button class="pick-btn' + (dlMode === m[0] ? ' on' : '') + '" data-act="sv-delivery" data-id="' + m[0] + '">' + h.esc(m[1]) + '</button>';
      }).join('') + '</div>' +
      (showDisp ? '<div class="sub-h">派发触达</div>' +
        '<div class="bt-note" style="margin-top:0">AI 依次通过 ' + h.esc(chLabels(chs)) + ' 发起首轮咨询；未回复的在 24h / 72h 各追一次，最多 3 次，每条含退订入口。</div>' : '') +
      (showSelf ? '<div class="sub-h">自助入口</div>' +
        '<div style="display:flex;gap:14px;align-items:center">' +
        '<div style="flex:0 0 auto;text-align:center">' + qr + '<div class="pick-or">扫码进入访谈</div></div>' +
        '<div style="flex:1;min-width:0">' +
        '<div class="mono" style="font-size:12.5px;word-break:break-all;margin-bottom:8px">' + h.esc(link) + '</div>' +
        '<div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn-ghost sm" data-act="sv-gen-link" data-id="' + h.esc(row.id) + '">重新生成入口</button>' +
        '<button class="btn-ghost sm" data-act="sv-copy-link" data-id="' + h.esc(link) + '">复制链接</button></div>' +
        '<div class="bt-note" style="margin-top:8px">入口长期有效；受访者通过链接进入后同样走多轮文本咨询，进度按首次进入去重。</div>' +
        '</div></div>' : '') +
      '</div>';

    /* ③ 多轮访谈策略 */
    var strategy = '<div class="card"><div class="card-h"><h3>多轮访谈策略</h3>' +
      '<span class="card-sub">轮次 / 追问 / 终止条件 / 频控</span></div>' +
      '<div class="metrics">' + [
        { label: '最大轮次', value: fmt.int(rounds) + ' 轮', sub: '达到即结束，不再追问' },
        { label: 'AI 追问', value: '开启', sub: '回答过短或未涉具体场景时深入追问' },
        { label: '单轮上限', value: '200 字', sub: '纯文本，不做语音' },
        { label: '触达频控', value: '14 天 ≤ 1 次', sub: '与用户运营统一执行' }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="sub-h">终止条件</div>' +
      '<div class="fc-steps">' +
      '<div class="fc-step"><i>■</i><span>受访者主动结束</span><span class="mono">立即</span><span>停止追问</span></div>' +
      '<div class="fc-step"><i>■</i><span>达到最大轮次</span><span class="mono">' + fmt.int(rounds) + ' 轮</span><span>结束并归档</span></div>' +
      '<div class="fc-step"><i>■</i><span>连续 2 轮未回复</span><span class="mono">24h</span><span>暂停触达</span></div>' +
      '</div></div>';

    /* ④ 合规准入（只读） */
    var compliance = [
      ['名单授权', '已确认（联系方式来源合规、可触达）'],
      ['禁发时段', '22:00–08:00 不触达，节假日不触达'],
      ['退订入口', '每条消息含「回 T 退订」，退订即时生效'],
      ['AIGC 标识', '外发话术自动附加生成式 AI 标识'],
      ['人审门控', 'P2 及以上结论须人工复核后方可外发']
    ];
    var compCard = '<div class="card"><div class="card-h"><h3>合规准入</h3>' +
      '<span class="card-sub">五项前置检查 · 只读</span>' + pill(h, 'ok', '通过') + '</div>' +
      '<div class="dl">' + compliance.map(function (x) {
        return '<dt>' + h.esc(x[0]) + '</dt><dd>' + h.esc(x[1]) + '</dd>';
      }).join('') + '</div>' +
      '<div class="bt-note">外发话术须携带生成式 AI 标识；命中缺失时在下发前拦截，不再进入触达队列。</div></div>';

    /* ⑤ 审批 */
    var needAppr = row.status === 'warn' || String(row.statusText).indexOf('审批') >= 0;
    var impact = [
      '影响对象与数量：已触达 ' + fmt.int(reached) + ' 人，回收目标 ' + fmt.int(num(row.quota, 0)) + ' 份',
      '影响的下游：' + refsCount(row.id) + ' 个对象引用本访谈（画像 / 策略 / Workflow）',
      '是否可回滚：审批通过并开始触达后不可撤回；未开始前可在交付方式中撤销'
    ];
    var appr = '<div class="card"><div class="card-h"><h3>投放确认</h3>' +
      '<span class="card-sub">开始触达前需要你确认</span>' + pill(h, needAppr ? 'warn' : 'ok', needAppr ? '待确认' : '已确认 / 无需确认') + '</div>' +
      '<div class="metrics">' + [
        { label: '已触达', value: fmt.int(reached) + ' 人', sub: '回复率 ' + fmt.pct1(replyRate) },
        { label: '有效咨询', value: fmt.int(num(row.consulted, 0)) + ' 人', sub: '回收目标 ' + fmt.int(num(row.quota, 0)) + ' 份' },
        { label: '被引用', value: refsCount(row.id) + ' 处', sub: '审批驳回会一并通知引用方' }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="act-list">' + impact.map(function (t, i) {
        return '<div class="act-item info"><span class="act-lv">影响' + (i + 1) + '</span><span class="act-main">' + h.esc(t) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="btn-row" style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn-primary" data-act="sv-submit-approval" data-id="' + h.esc(row.id) + '">提交投放审批</button>' +
      '<button class="btn-ghost" data-act="sv-ack-compliance" data-id="' + h.esc(row.id) + '">已确认合规前置</button>' +
      '<span class="pick-or">需要权限点 survey:publish。</span></div></div>';

    return statusStrip(h, row, '<button class="btn-ghost" data-act="sv-gen-link" data-id="' + h.esc(row.id) + '">生成自助入口</button>' +
      '<button class="btn-primary" data-act="sv-submit-approval" data-id="' + h.esc(row.id) + '">提交投放</button>') +
      goal + delivery + strategy +
      '<div class="grid2">' + compCard + appr + '</div>' +
      h.metaBar({}, [
        { k: '取数来源', v: 'survey 资产表行 ' + row.id + '：reached（已触达）/ replyRate（回复率）/ consulted（有效咨询）/ intent（意向分级）/ listSource（名单来源）/ delivery（交付方式）' },
        { k: '名单口径', v: '分群圈人取运营分群的实时覆盖；名单导入取本次上传名单。下发前统一排除频控内已触达、已退订与黑名单。' },
        { k: '触达口径', v: 'IM / 企微 / 短信均为纯文本多轮咨询，不做语音；单联系人最多 3 次触达，每条含退订入口。' },
        { k: '合规口径', v: '外发话术须携带生成式 AI 标识；禁发时段与频控由用户运营统一执行；P2 及以上结论需人工复核。' }
      ]);
  }

  /* SECTION: tab-live */
  function tabLive(cap, state, h, row, qs, flow) {
    var fmt = h.fmt;
    var reached = num(row.reached, 0), replied = num(row.replied, 0);
    var consulted = num(row.consulted, 0);
    var replyRate = num(row.replyRate, reached ? replied / reached : 0);
    var dl = row.delivery || {};
    var chs = row.channels || dl.channels || [];
    var intent = row.intent || {};
    var iH = num(intent.high, 0), iM = num(intent.mid, 0), iL = num(intent.low, 0);
    var iTot = iH + iM + iL;

    var recs = buildRecords(row, qs, Math.max(6, Math.min(16, Math.round(num(row.qcount, 12) / 2))));
    var bad = recs.filter(function (r) { return r.quality !== '通过'; });
    var offTopic = recs.filter(function (r) { return r.offTopic; }).length;
    var leading = recs.filter(function (r) { return r.leading; }).length;
    var repeat = recs.filter(function (r) { return r.repeat; }).length;

    /* 意向分级 */
    var iRows = [
      { label: '高意向', value: iH, share: iTot ? iH / iTot : 0, display: fmt.int(iH) },
      { label: '中意向', value: iM, share: iTot ? iM / iTot : 0, display: fmt.int(iM) },
      { label: '低意向', value: iL, share: iTot ? iL / iTot : 0, display: fmt.int(iL) }
    ];
    var intentCard = '<div class="card"><div class="card-h"><h3>意向分级</h3>' +
      '<span class="card-sub">按有效咨询 ' + fmt.int(consulted) + ' 人分级</span></div>' +
      h.charts.barChart(iRows, { colorFn: function (r) { return r.label === '高意向' ? '#16a34a' : (r.label === '低意向' ? '#dc2626' : '#60a5fa'); } }) +
      '<div class="bt-note">分级由访谈结论中的需求强度、预算与决策意愿综合判定；高意向占比 ' + fmt.pct1(iTot ? iH / iTot : 0) + '。</div></div>';

    /* 渠道进度 */
    var sh = shares('svchan|' + row.id, Math.max(1, chs.length));
    var chReached = distribute(reached, sh);
    var chReplied = distribute(replied, sh);
    var chCard = '<div class="card"><div class="card-h"><h3>渠道进度</h3>' +
      '<span class="card-sub">IM / 企微 / 短信 各自的触达与回复</span></div>' +
      (chs.length ? '<table class="bt"><thead><tr><th>渠道</th><th class="ta-r">已触达</th><th class="ta-r">已回复</th><th class="ta-r">回复率</th><th>进度</th></tr></thead><tbody>' +
        chs.map(function (c, i) {
          var rr = chReached[i] ? chReplied[i] / chReached[i] : 0;
          return '<tr><td>' + h.esc(CH_LABEL[c] || c) + '</td><td class="ta-r">' + fmt.int(chReached[i]) + '</td>' +
            '<td class="ta-r">' + fmt.int(chReplied[i]) + '</td><td class="ta-r">' + fmt.pct1(rr) + '</td>' +
            '<td>' + h.charts.gauge(rr) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<div class="bt-note">未配置触达渠道。</div>') +
      '<div class="bt-note">渠道量按触达总数与渠道份额拆分（种子 svchan|… 固定），回复率口径与整体一致（replied / reached）。</div></div>';

    /* 实时状态 */
    var dlSelf = !!dl.selfserve;
    var selfRate = S.R.of('svself|' + row.id)();
    var selfEnter = dlSelf ? Math.round(consulted * (0.22 + selfRate * 0.26)) : 0;
    var selfDone = dlSelf ? Math.round(selfEnter * (0.6 + selfRate * 0.3)) : 0;
    var liveCard = '<div class="card"><div class="card-h"><h3>实时状态</h3><span class="card-sub">触达与回收</span></div>' +
      '<div class="dl">' +
      '<dt>触达渠道</dt><dd>' + h.esc(chLabels(chs)) + '</dd>' +
      '<dt>名单来源</dt><dd>' + h.esc(sourceLabel(row.listSource)) + '</dd>' +
      '<dt>交付方式</dt><dd>' + h.esc(deliveryLabel(dl)) + '</dd>' +
      '<dt>自助入口进入</dt><dd>' + (dlSelf ? fmt.int(selfEnter) + ' 人' : '未开启') + '</dd>' +
      '<dt>自助入口完成</dt><dd>' + (dlSelf ? fmt.int(selfDone) + ' 人' : '未开启') + '</dd>' +
      '<dt>剩余回收目标</dt><dd>' + fmt.int(Math.max(0, num(row.quota, 0) - num(row.collected, 0))) + ' 份</dd></div>' +
      '<div class="bt-note">触达与回复取自 survey 资产表；自助入口进入按首次进入去重，完成指走完全部轮次。</div></div>';

    /* 质量抽检（AI 追问轮） */
    var qcCols = [
      { key: 'id', label: '访谈记录', render: function (r) { return '<span class="mono">' + h.esc(r.id) + '</span>'; } },
      { key: 'seg', label: '人群', render: function (r) { return h.esc(r.seg.name); } },
      { key: 'rounds', label: '追问轮数', align: 'right', render: function (r) { return String(r.rounds); } },
      { key: 'quality', label: '抽检结论', render: function (r) { return pill(h, r.quality === '通过' ? 'ok' : 'warn', r.quality); } },
      { key: 'ev', label: '证据片段', render: function (r) { var t = r.turns[r.turns.length - 1]; return h.esc(qShort(t ? t.text : '', 34)); } }
    ];
    var qcCard = '<div class="card"><div class="card-h"><h3>AI 追问质量抽检</h3>' +
      '<span class="card-sub">随机抽 ' + recs.length + ' 份 · 可疑 ' + bad.length + ' 份</span></div>' +
      '<div class="metrics">' + [
        { label: '偏题', value: String(offTopic), unit: '份', alert: offTopic > 0, sub: '追问偏离主问题主题' },
        { label: '诱导', value: String(leading), unit: '份', alert: leading > 0, sub: '提问含倾向性措辞' },
        { label: '重复追问', value: String(repeat), unit: '份', alert: repeat > 0, sub: '同一事实被追问 ≥ 2 次' }
      ].map(h.metricCard).join('') + '</div>' +
      h.table({ columns: qcCols, rows: recs.slice(0, 8), noPaging: true, emptyTitle: '暂无抽检记录' }) +
      '<div class="bt-note">抽检只针对 AI 追问轮：偏题 / 诱导 / 重复追问是访谈质量的三类硬伤，命中即需回看完整链路（见「咨询结论与分析 · 逐份审阅台」）。</div></div>';

    /* 异常预警（由触达字段与反馈派生） */
    var alerts = [];
    if (replyRate < 0.6) {
      alerts.push({ lv: replyRate < 0.5 ? 'bad' : 'warn', k: '回复率预警', t: '回复率 ' + fmt.pct1(replyRate) + ' 低于 60% 健康线', s: '已触达 ' + fmt.int(reached) + ' 人，仅 ' + fmt.int(replied) + ' 人回复；建议检查话术与触达时段' });
    }
    var fb = feedbackItems().filter(function (x) { return x.kind === 'complaint' || x.kind === 'unsub'; });
    fb.slice(0, 3).forEach(function (x) {
      alerts.push({ lv: 'bad', k: '投诉 / 退订', t: String(x.summary || x.kindText), s: '来源 ' + (x.channel || '—') + ' · ' + h.fmt.rel(num(x.dayOffset, 0)) + ' · 影响 ' + fmt.int(x.impact || 0) + ' 人', act: { act: 'feedback-detail', id: x.id, text: '查看反馈' } });
    });
    var alertCard = alerts.length
      ? '<div class="card"><div class="card-h"><h3>异常预警</h3><span class="card-sub">' + alerts.length + ' 条 · 全部由触达字段派生</span></div>' +
        '<div class="act-list">' + alerts.map(function (a) {
          return '<div class="act-item ' + a.lv + '"><span class="act-lv">' + h.esc(a.k) + '</span><span class="act-main"><b>' + h.esc(a.t) + '</b><i>' + h.esc(a.s) + '</i></span>' +
            (a.act ? '<button class="btn-ghost sm" data-act="' + a.act.act + '" data-id="' + h.esc(a.act.id) + '">' + h.esc(a.act.text) + '</button>' : '') +
            '</div>';
        }).join('') + '</div></div>'
      : (typeof V.emptyFor === 'function' ? V.emptyFor('暂无异常预警', '回复率与投诉 / 退订反馈均在阈值内') : '<div class="card"><div class="empty"><div class="empty-title">暂无异常预警</div><div class="empty-sub">回复率与投诉 / 退订反馈均在阈值内</div></div></div>');

    var paused = !!state.svPaused;
    var pauseCtrl = row.status === 'info'
      ? (paused
        ? '<button class="btn-primary" data-act="sv-resume" data-id="' + h.esc(row.id) + '">恢复触达</button>'
        : '<button class="btn-danger" data-act="sv-pause" data-id="' + h.esc(row.id) + '">暂停触达</button>')
      : '<span class="pick-or">该访谈当前非「进行中」，暂停 / 恢复不适用。</span>';

    return statusStrip(h, row, pauseCtrl) +
      (paused ? '<div class="bt-warn" style="margin-top:0">触达已暂停：已答数据全部保留，不再产生新触达；恢复后可继续。</div>' : '') +
      '<div class="metrics">' + [
        { label: '已触达', value: fmt.int(reached), sub: '名单来源 ' + sourceLabel(row.listSource) },
        { label: '回复率', value: fmt.pct1(replyRate), alert: replyRate < 0.6, sub: '低于 60% 需先优化话术' },
        { label: '有效咨询', value: fmt.int(consulted), sub: '回复中完成至少 1 轮实质回答' },
        { label: '高意向', value: fmt.int(iH), sub: '占有效咨询 ' + fmt.pct1(iTot ? iH / iTot : 0) }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="grid2">' + intentCard + chCard + '</div>' +
      '<div class="grid2">' + liveCard + alertCard + '</div>' +
      qcCard +
      h.metaBar({}, [
        { k: '取数来源', v: 'survey 资产表行 ' + row.id + '：reached（已触达）/ replied（已回复）/ replyRate（回复率）/ consulted（有效咨询）/ intent（意向分级）/ channels（触达渠道）' },
        { k: '派生口径', v: '回复率 = replied / reached（除零兜底）；渠道量按触达总数与渠道份额拆分（种子 svchan|… 固定）' },
        { k: '抽检口径', v: '抽检样本是固定种子的样本（种子 svrec|… 固定），三类硬伤：偏题 / 诱导 / 重复追问；真实生产由访谈引擎回传' },
        { k: '告警口径', v: '回复率 < 60% 告警；投诉 / 退订反馈直接上浮；暂停后不再产生新触达' }
      ]);
  }

  /* SECTION: tab-review */
  function tabReview(cap, state, h, row, qs, flow) {
    var fmt = h.fmt;
    var recs = buildRecords(row, qs, Math.max(6, Math.min(16, Math.round(num(row.qcount, 12) / 2))));
    var sel = num(state.svRec, 0);
    if (sel < 0 || sel >= recs.length) sel = 0;
    var rec = recs[sel];
    var tags = state.svTags || loadTags(row.id);
    state.svTags = tags;   /* 回填 state，键盘打标才看得到同一份 */
    var tagged = 0, kk;
    for (kk in tags) if (tags[kk]) tagged++;

    /* 左：记录列表 */
    var list = recs.map(function (r, i) {
      var on = i === sel;
      return '<button class="kb-card' + (r.finished ? '' : ' blocked') + '" data-act="sv-rec" data-id="' + i + '"' +
        (on ? ' style="border-color:var(--blue);background:var(--blue-weak)"' : '') + '>' +
        '<span style="font-size:12.5px;font-weight:600" class="mono">' + h.esc(r.id) + '</span>' +
        '<span style="display:flex;gap:6px;font-size:11.5px;color:var(--sub)">' + h.esc(r.seg.name) + ' · ' + r.rounds + ' 轮 · ' + r.durMin + ' 分钟</span>' +
        '<span style="display:flex;gap:6px;align-items:center">' +
        pill(h, r.finished ? 'ok' : 'warn', r.finished ? '完答' : '中途放弃') +
        (tags[i] ? '<span class="tag">已打标 ' + tags[i] + '</span>' : '') +
        '</span></button>';
    }).join('');

    /* 右：当前记录（含 AI 追问链路 + 结构化提取 + 人工校正） */
    var turnHtml = rec.turns.map(function (t) {
      if (t.role === 'q') return '<div class="msg"><i>主问题</i><div>' + h.esc(t.text) + '</div></div>';
      if (t.role === 'a') return '<div class="msg user"><i>受访者</i><div>' + h.esc(t.text) + '</div></div>';
      return '<div class="msg"><i>AI 追问 · 第 ' + t.depth + ' 轮</i><div>' + h.esc(t.text) + '</div>' +
        '<div class="bt-note" style="margin-top:6px">追问理由：' + h.esc(t.reason) + '　触发条件：' + h.esc(t.trigger) + '</div></div>';
    }).join('');

    var extracted = '<div class="fc-steps">' + rec.extracted.map(function (e) {
      return '<div class="fc-step"><i>•</i><span>' + h.esc(e.k) + '</span><span class="mono">' + fmt.pct0(e.c) + '</span><span>' + h.esc(e.v) + '</span></div>';
    }).join('') + '</div>';

    var tagRow = [1, 2, 3, 4, 5].map(function (n) {
      return '<button class="pick-btn' + (tags[sel] === n ? ' on' : '') + '" data-act="sv-tag" data-id="' + n + '">' + n + '</button>';
    }).join('');

    var detail = '<div class="card" style="margin:0"><div class="card-h"><h3 class="mono">' + h.esc(rec.id) + '</h3>' +
      pill(h, rec.finished ? 'ok' : 'warn', rec.finished ? '完答' : '中途放弃') +
      '<span class="card-sub">' + h.esc(rec.seg.name) + ' · ' + rec.rounds + ' 轮追问 · ' + rec.durMin + ' 分钟 · 质量 ' + h.esc(rec.quality) + '</span></div>' +
      '<div class="sub-h">完整访谈记录（含 AI 追问链路与每轮理由）</div>' + turnHtml +
      '<div class="sub-h">结构化提取结果</div>' + extracted +
      '<div class="sub-h">人工校正</div>' +
      '<div class="pick-row">' + tagRow + '<span class="pick-or">1 极差 · 5 极好；快捷键 1–5 打标，⌘S 保存到本会话</span></div>' +
      '<div class="bt-note">键盘：J / K 上下条，1–5 打标，⌘S（Ctrl+S）保存到本会话（刷新仍在，关闭标签页失效）；已打标 ' + tagged + ' / ' + recs.length + ' 份。</div>' +
      '</div>';

    var bench = '<div class="dbg-grid" data-sv-review="1">' +
      '<div class="card" style="margin:0"><div class="card-h"><h3>待审阅样本</h3><span class="card-sub">抽 ' + recs.length + ' / 共 ' + fmt.int(row.collected) + ' 份</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:7px">' + list + '</div></div>' +
      detail + '</div>';

    /* 聚合：单选分布 + 人群交叉 */
    var singles = qs.filter(function (q) { return q.type === 'single'; }).slice(0, 2);
    var scaleQ = qs.filter(function (q) { return q.type === 'scale' && q.options.length === 11; })[0] ||
      qs.filter(function (q) { return q.type === 'scale'; })[0];

    var agg = '';
    singles.forEach(function (q) {
      var d = singleDist(row, q);
      var bars = d.rows.map(function (r) { return { label: r.option, value: r.share, share: r.share, display: fmt.pct1(r.share) }; });
      agg += '<div class="card"><div class="card-h"><h3>' + h.esc(q.title) + '</h3><span class="card-sub">单选 · 分布 + 按人群交叉</span></div>' +
        h.charts.barChart(bars) +
        '<table class="bt" style="margin-top:12px"><thead><tr><th>选项</th>' +
        SEGS.map(function (s) { return '<th class="ta-r">' + h.esc(s.name) + '</th>'; }).join('') +
        '<th class="ta-r">总体</th></tr></thead><tbody>' +
        d.rows.map(function (r, oi) {
          return '<tr><td>' + h.esc(r.option) + '</td>' +
            d.cross.map(function (c) { return '<td class="ta-r">' + fmt.pct0(c.shares[oi]) + '</td>'; }).join('') +
            '<td class="ta-r"><b>' + fmt.pct1(r.share) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>';
    });

    var npsCard = '';
    if (scaleQ) {
      var ss = scaleStats(row, scaleQ);
      var rows = scaleQ.options.map(function (o, i) { return { label: o + ' 分', value: ss.shares[i], share: ss.shares[i], display: fmt.pct0(ss.shares[i]) }; });
      npsCard = '<div class="card"><div class="card-h"><h3>' + h.esc(scaleQ.title) + '</h3><span class="card-sub">量表（' + scaleQ.options.length + ' 级）</span></div>' +
        '<div class="metrics">' + [
          { label: '均值', value: ss.mean.toFixed(2), sub: '按分布加权' },
          { label: 'NPS', value: ss.nps == null ? '不适用' : (ss.nps >= 0 ? '+' : '') + (ss.nps * 100).toFixed(1), alert: ss.nps != null && ss.nps < 0, sub: ss.nps == null ? '该题非 0–10 量表' : '推荐者(≥9) − 贬损者(≤6)' },
          { label: 'Top2 占比', value: fmt.pct1(ss.top2), sub: '正向答案比例' }
        ].map(h.metricCard).join('') + '</div>' +
        h.charts.barChart(rows) + '</div>';
    }

    /* 开放题主题聚类树 + 下钻 */
    var th = buildThemes(row);
    var openTheme = state.svTheme;
    var treeHtml;
    if (openTheme != null && th.themes[openTheme]) {
      var t = th.themes[openTheme];
      var allQuotes = [];
      t.subs.forEach(function (s) { s.quotes.forEach(function (q) { allQuotes.push({ sub: s.name, text: q.text, rec: q.rec, count: s.count }); }); });
      treeHtml = '<div class="cluster-list">' +
        t.subs.map(function (s) {
          return '<div class="cl"><span class="cl-n">' + s.count + '</span><span class="cl-main"><b>' + h.esc(s.name) + '</b>' +
            '<span>' + s.quotes.map(function (q) { return '「' + h.esc(q.text) + '」'; }).join('　') + '</span>' +
            '<span>' + (s.count > s.quotes.length ? '本条主题共 ' + s.count + ' 条原话，此处列出来源明确的 ' + s.quotes.length + ' 条' : '共 ' + s.count + ' 条原话') + '</span></span></div>';
        }).join('') + '</div>' +
        '<div class="sub-h">全部原话（' + allQuotes.length + ' 条带记录号）</div>' +
        '<div class="fc-steps">' + allQuotes.map(function (q) {
          return '<div class="fc-step"><i>”</i><span class="mono">' + h.esc(q.rec) + '</span><span>' + h.esc(q.sub) + '</span><span>' + h.esc(q.text) + '</span></div>';
        }).join('') + '</div>';
    } else {
      treeHtml = '<div class="cluster-list">' + th.themes.map(function (t) {
        return '<button class="cl" data-act="sv-theme" data-id="' + t.idx + '" style="text-align:left;cursor:pointer">' +
          '<span class="cl-n">' + t.count + '</span>' +
          '<span class="cl-main"><b>' + h.esc(t.name) + ' · ' + h.esc(String((t.count / th.mentions * 100).toFixed(0))) + '%</b>' +
          '<span>' + t.subs.map(function (s) { return h.esc(s.name) + '(' + s.count + ')'; }).join('　') + '</span></span>' +
          '<span class="cl-pri">下钻 →</span></button>';
      }).join('') + '</div>';
    }
    var themeCard = '<div class="card"><div class="card-h"><h3>开放题 · AI 主题聚类树</h3>' +
      '<span class="card-sub">' + th.mentions + ' 条原话聚为 ' + th.themes.length + ' 个主题</span>' +
      (openTheme != null ? '<button class="btn-ghost sm" data-act="sv-theme-back">← 返回主题列表</button>' : '') + '</div>' +
      treeHtml +
      '<div class="bt-note">' + (openTheme != null ? '当前下钻到「' + h.esc(th.themes[openTheme].name) + '」，列出该主题全部原话与来源记录号。' : '点任一主题下钻到全部原话；主题 → 子主题 → 原话引用条数，实现“从结论回到证据”。') + '</div></div>';

    /* 情感与关键词趋势 */
    var sd = sentimentData(row);
    var sentCard = '<div class="card"><div class="card-h"><h3>情感与关键词趋势</h3><span class="card-sub">近 7 天 · 正面占比与关键词提及</span></div>' +
      '<div class="grid2">' +
      '<div><div class="sub-h">情感构成</div>' + h.charts.barChart([
        { label: '正面', value: sd.mix.pos, share: sd.mix.pos, display: fmt.pct1(sd.mix.pos) },
        { label: '中性', value: sd.mix.neu, share: sd.mix.neu, display: fmt.pct1(sd.mix.neu) },
        { label: '负面', value: sd.mix.neg, share: sd.mix.neg, display: fmt.pct1(sd.mix.neg) }
      ], { colorFn: function (r) { return r.label === '正面' ? '#16a34a' : (r.label === '负面' ? '#dc2626' : '#60a5fa'); } }) +
      '<div class="sub-h">正面占比趋势</div>' + h.charts.sparkline(sd.trend, { width: 260, height: 40, color: '#16a34a' }) + '</div>' +
      '<div><div class="sub-h">关键词提及（近 7 天）</div><table class="bt"><thead><tr><th>关键词</th><th class="ta-r">末值</th><th class="ta-r">环比</th><th>趋势</th></tr></thead><tbody>' +
      sd.keywords.map(function (k) {
        return '<tr><td>' + h.esc(k.name) + '</td><td class="ta-r">' + fmt.int(k.total) + '</td>' +
          '<td class="ta-r ' + (k.delta >= 0 ? 'bad' : 'ok') + '">' + (k.delta >= 0 ? '+' : '') + k.delta + '</td>' +
          '<td>' + h.charts.sparkline(k.series, { width: 90, height: 22, abnormal: k.delta > 0 }) + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    /* 显著性检验（走 h.query.twoPropTest） */
    /* 意向分级分布 */
    var intent = row.intent || {};
    var iH = num(intent.high, 0), iM = num(intent.mid, 0), iL = num(intent.low, 0);
    var iTot = iH + iM + iL;
    var intentRows = [
      { label: '高意向', value: iH, share: iTot ? iH / iTot : 0, display: fmt.int(iH) },
      { label: '中意向', value: iM, share: iTot ? iM / iTot : 0, display: fmt.int(iM) },
      { label: '低意向', value: iL, share: iTot ? iL / iTot : 0, display: fmt.int(iL) }
    ];
    var intentCard = '<div class="card"><div class="card-h"><h3>意向分级分布</h3>' +
      '<span class="card-sub">有效咨询 ' + fmt.int(num(row.consulted, 0)) + ' 人 · 高 / 中 / 低</span></div>' +
      h.charts.barChart(intentRows, { colorFn: function (r) { return r.label === '高意向' ? '#16a34a' : (r.label === '低意向' ? '#dc2626' : '#60a5fa'); } }) +
      '<div class="metrics">' + [
        { label: '高意向占比', value: fmt.pct1(iTot ? iH / iTot : 0), sub: '可直接转销售跟进' },
        { label: '中意向占比', value: fmt.pct1(iTot ? iM / iTot : 0), sub: '需持续培育' },
        { label: '低意向占比', value: fmt.pct1(iTot ? iL / iTot : 0), sub: '观望或暂无需求' }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="bt-note">分级由访谈结论中的需求强度、预算与决策意愿综合判定，高 / 中 / 低三项之和等于有效咨询人数。</div></div>';

    /* 导出 */
    var mask = !!state.svCsvMask;
    var exportCard = '<div class="card"><div class="card-h"><h3>导出</h3><span class="card-sub">报告 / 原始 CSV / 结论卡片</span></div>' +
      '<div class="btn-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn-primary" data-act="sv-export" data-id="report">导出分析报告</button>' +
      '<button class="btn-ghost" data-act="sv-export" data-id="csv">导出原始 CSV</button>' +
      '<button class="chip link' + (mask ? ' on' : '') + '" data-act="sv-csv-mask" aria-pressed="' + (mask ? 'true' : 'false') + '" title="切换 CSV 脱敏">脱敏' + (mask ? ' 已开' : ' 未开') + '</button>' +
      '<button class="btn-ghost" data-act="sv-export" data-id="card">生成结论卡片</button>' +
      '<span class="pick-or">CSV 含受访者标识；开启脱敏后仅保留人群与答案，不含可识别字段。</span></div></div>';

    return statusStrip(h, row, '<button class="btn-primary" data-act="sv-export" data-id="report">导出报告</button>') +
      '<div class="bt-note" style="margin-top:0">逐份审阅台支持键盘操作：<b>J / K</b> 上下条、<b>1–5</b> 打标、<b>⌘S / Ctrl+S</b> 保存校正。切页签或离开详情页会自动解绑快捷键。</div>' +
      bench +
      '<div class="grid2">' + agg + '</div>' +
      npsCard + themeCard + sentCard + intentCard + exportCard +
      h.metaBar({}, [
        { k: '取数来源', v: 'survey 资产表行 ' + row.id + '：reached / replied / replyRate / consulted（触达与咨询）与 collected（回收）用于聚合与分级；qcount 用于结构' },
        { k: '示例声明', v: '逐份访谈记录、结构化提取、主题聚类、情感与关键词为确定性示例（种子 svrec|… / svtheme|… 固定），真实生产由访谈引擎回传' },
        { k: '分级口径', v: '意向分级由访谈结论中的需求强度、预算与决策意愿综合判定，高 / 中 / 低三项之和等于有效咨询人数' },
        { k: '键盘绑定', v: 'document 级 keydown，仅在「咨询结论与分析」Tab 绑定；切 Tab / 离开详情（hashchange）或页面 DOM 被替换时自动解绑' }
      ]);
  }

  /* SECTION: keyboard — document 级快捷键（真绑定 + 真解绑） */
  var KEYS = { handler: null, scope: null, ctx: null, hooks: false };

  function disarmKeys() {
    if (KEYS.handler && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('keydown', KEYS.handler, false);
    }
    KEYS.handler = null; KEYS.scope = null; KEYS.ctx = null;
  }
  function onKey(e) {
    /* 自查：页面/Tab 已切换（锚点脱离 DOM）→ 立即解绑，避免快捷键在别的页面残留 */
    if (!KEYS.scope || typeof document === 'undefined' || !document.body || !document.body.contains(KEYS.scope)) {
      disarmKeys(); return;
    }
    if (document.querySelector && document.querySelector('.modal-mask')) return; /* 弹窗打开时不响应 */
    var t = e.target;
    var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;

    var ctx = KEYS.ctx || {};
    var mod = e.metaKey || e.ctrlKey;
    var key = e.key;

    if (mod && key && String(key).toLowerCase() === 's') { e.preventDefault(); saveTagged(ctx); return; }
    if (mod || e.altKey) return;

    if (key === 'j' || key === 'J' || key === 'ArrowDown') { e.preventDefault(); moveRec(ctx, 1); return; }
    if (key === 'k' || key === 'K' || key === 'ArrowUp') { e.preventDefault(); moveRec(ctx, -1); return; }
    if (key && key.length === 1 && key >= '1' && key <= '5') { e.preventDefault(); tagRec(ctx, Number(key)); return; }
  }
  function moveRec(ctx, d) {
    var total = ctx.total || 0;
    if (!total || !ctx.state) return;
    var cur = num(ctx.state.svRec, 0);
    ctx.state.svRec = (cur + d + total) % total;
    rerender(ctx);
  }
  function tagRec(ctx, n) {
    if (!ctx.state) return;
    ctx.state.svTags = ctx.state.svTags || {};
    ctx.state.svTags[num(ctx.state.svRec, 0)] = n;
    rerender(ctx);
  }
  function rerender(ctx) {
    if (ctx.h && typeof ctx.h.navigate === 'function') ctx.h.navigate({}, { scroll: false });
  }
  function saveTagged(ctx) {
    var tags = (ctx.state && ctx.state.svTags) || {};
    var cnt = 0, k;
    for (k in tags) if (tags[k]) cnt++;
    var ok = persistTags(ctx.surveyId, tags);
    if (ctx.h && typeof ctx.h.toast === 'function') {
      ctx.h.toast(ok
        ? '已保存到本会话：' + cnt + ' 条人工校正（刷新仍在，关闭标签页失效）'
        : '保存失败（会话存储不可用）：' + cnt + ' 条仅存在于当前页面', ok ? 'ok' : 'warn');
    }
  }
  function scheduleArm(h, state, total) {
    ensureHooks();
    if (typeof document === 'undefined' || !document.addEventListener) return;
    var run = function () {
      disarmKeys();
      var scope = document.querySelector ? document.querySelector('[data-sv-review]') : null;
      if (!scope) return;
      KEYS.scope = scope;
      KEYS.ctx = { state: state, h: h, total: total, surveyId: state.objId || state.surveyId || null };
      KEYS.handler = onKey;
      document.addEventListener('keydown', KEYS.handler, false);
    };
    if (typeof setTimeout === 'function') setTimeout(run, 0); else run();
  }
  function ensureHooks() {
    if (KEYS.hooks) return;
    KEYS.hooks = true;
    if (typeof global.addEventListener === 'function') {
      /* 路由变化（切 Tab / 离开详情）→ 立即解绑；详情页重渲染会按需重新绑定 */
      global.addEventListener('hashchange', function () { disarmKeys(); }, false);
    }
  }

  /* SECTION: register */
  R.surveyDetail = function (cap, state, h) {
    V = global.V10UI || V;             /* 若 v10-ui 后加载，这里刷新引用 */
    state = state || {};
    var id = state.objId || state.surveyId || null;
    var row = getSurvey(id);
    if (!row) {
      return callV('detailMissing', [cap, state, h], function () {
        return '<div class="fatal"><h2>访谈任务不存在</h2><p>标识「' + h.esc(id || '') + '」未找到，可能已被删除或链接有误。</p>' +
          '<button class="btn-primary" data-act="sv-back">返回访谈列表</button></div>';
      });
    }
    var tab = state.objTab || state.tab || 'design';
    if (tab !== 'design' && tab !== 'live' && tab !== 'review') tab = 'design';

    var qs = buildQuestions(row);
    var flow = analyzeFlow(qs);
    var recTotal = Math.max(6, Math.min(16, Math.round(num(row.qcount, 12) / 2)));

    /* Tab 徽标：全部由上面已算出的量派生 */
    var alertThreshold = num(row.replyRate, 1) < 0.6 ? 1 : 0;
    var badges = {
      live: alertThreshold + (flow.pass ? 0 : 1),
      review: recTotal
    };
    if (badges.live === 0) badges.live = null;

    var body;
    if (tab === 'live') { disarmKeys(); body = tabLive(cap, state, h, row, qs, flow); }
    else if (tab === 'review') { body = tabReview(cap, state, h, row, qs, flow); scheduleArm(h, state, recTotal); }
    else { disarmKeys(); body = tabDesign(cap, state, h, row, qs, flow); }

    return crumb(h, cap, row) + head(h, cap, row) +
      tabsBar(h, cap, state, tab, badges) + body;
  };

  /* SECTION: actions */
  ACTIONS['sv-back'] = function (id, btn, h) {
    if (h && h.navigate) h.navigate({ objId: null, objTab: null, agentId: null, tab: null });
  };
  ACTIONS['sv-pick-q'] = function (id, btn, h) {
    if (!h || !h.state) return;
    h.state.svQ = num(id, 1);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-save-design'] = function (id, btn, h) {
    var row = getSurvey(id || (h.state && (h.state.objId || h.state.surveyId)));
    if (!row) { h.toast('问卷不存在', 'bad'); return; }
    var res = analyzeFlow(buildQuestions(row));
    h.state.svSaved = num(h.state.svSaved, 0) + 1;
    var bad = res.cycles.length + res.unreachable.length;
    h.toast(bad
      ? '校验未通过：循环 ' + res.cycles.length + ' 处 · 不可达 ' + res.unreachable.length + ' 题；草稿已保存'
      : '校验通过：无循环、无不可达题目；草稿已保存', bad ? 'warn' : 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-submit-approval'] = function (id, btn, h) {
    var row = getSurvey(id || (h.state && (h.state.objId || h.state.surveyId)));
    if (!row) { h.toast('问卷不存在', 'bad'); return; }
    var reach = Math.ceil(num(row.quota, 0) / (num(row.finishRate, 0.5) || 0.5));
    var impacts = [
      '影响对象与数量：预计触达 ' + h.fmt.int(reach) + ' 人，回收目标 ' + h.fmt.int(row.quota) + ' 份',
      '影响的下游：' + refsCount(row.id) + ' 个对象引用本问卷（画像 / 策略 / Workflow）',
      '是否可回滚：审批通过并开始触达后不可撤回；未开始前可在投放配置中撤销'
    ];
    if (V && typeof V.dangerConfirm === 'function') {
      V.dangerConfirm(h, {
        title: '提交投放审批：' + row.name, perm: 'survey:publish',
        impacts: impacts, confirmText: '确认发布',
        onConfirm: function () {
          h.toast('投放审批已提交', 'ok');
        }
      });
    } else {
      h.toast('危险操作确认组件未就绪：未提交投放（组件未就绪）', 'warn');
    }
  };
  ACTIONS['sv-aud'] = function (id, btn, h) {
    var st = h.state; st.svAud = st.svAud || [];
    var i = st.svAud.indexOf(id);
    if (i >= 0) st.svAud.splice(i, 1); else st.svAud.push(id);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-ch'] = function (id, btn, h) {
    var st = h.state; st.svCh = st.svCh || [];
    var i = st.svCh.indexOf(id);
    if (i >= 0) st.svCh.splice(i, 1); else st.svCh.push(id);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-ab'] = function (id, btn, h) { h.state.svAb = num(id, 20); h.navigate({}, { scroll: false }); };
  ACTIONS['sv-rec'] = function (id, btn, h) { h.state.svRec = num(id, 0); h.navigate({}, { scroll: false }); };
  ACTIONS['sv-tag'] = function (id, btn, h) {
    var st = h.state; st.svTags = st.svTags || {};
    st.svTags[num(st.svRec, 0)] = num(id, 0);
    persistTags(st.objId || st.surveyId, st.svTags);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-theme'] = function (id, btn, h) { h.state.svTheme = num(id, 0); h.navigate({}, { scroll: false }); };
  ACTIONS['sv-theme-back'] = function (id, btn, h) { h.state.svTheme = null; h.navigate({}, { scroll: false }); };
  ACTIONS['sv-csv-mask'] = function (id, btn, h) { h.state.svCsvMask = !h.state.svCsvMask; h.navigate({}, { scroll: false }); };
  ACTIONS['sv-export'] = function (id, btn, h) {
    var row = getSurvey(h.state && (h.state.objId || h.state.surveyId));
    if (!row) { h.toast('访谈任务不存在', 'bad'); return; }
    var mask = !!h.state.svCsvMask;
    var NL = String.fromCharCode(10);
    var qs = buildQuestions(row);
    var recs = buildRecords(row, qs, Math.max(6, Math.min(16, Math.round(num(row.qcount, 12) / 2))));
    var intent = row.intent || {};
    var iH = num(intent.high, 0), iM = num(intent.mid, 0), iL = num(intent.low, 0);
    var iTot = iH + iM + iL;
    var SAMPLE_NOTE = '本文件内容为确定性示例（种子 svrec|… 固定），不是真实访谈产出；真实生产由访谈引擎回传。';
    var kind, body, mime, label;
    var th = buildThemes(row);   /* 报告与结论卡片都要用，提到分支外（此前只在 card 分支里定义 → 报告分支报错） */

    if (id === 'csv') {
      kind = 'csv'; mime = 'text/csv;charset=utf-8'; label = mask ? 'CSV（已脱敏）' : 'CSV（含记录号）';
      var head = (mask ? ['序号'] : ['记录号']).concat(['人群', '追问轮数', '时长(分)', '结束状态', '抽检结论', '主问题', '最后一轮追问', '追问理由', '最后一轮回答']);
      var lines = [head.join(',')];
      recs.forEach(function (r, i) {
        var lastF = null, lastA = null;
        r.turns.forEach(function (x) { if (x.role === 'f') lastF = x; if (x.role === 'a') lastA = x; });
        var cells = (mask ? [String(i + 1)] : [r.id]).concat([
          r.seg.name, String(r.rounds), String(r.durMin), r.finished ? '完答' : '中途放弃', r.quality,
          (r.turns[0] || {}).text || '', lastF ? lastF.text : '', lastF ? (lastF.reason || '') : '', lastA ? lastA.text : ''
        ]);
        lines.push(cells.map(function (x) { return '"' + String(x == null ? '' : x).split('"').join('""') + '"'; }).join(','));
      });
      lines.push('"示例说明","' + SAMPLE_NOTE + '"');
      if (mask) lines.push('"脱敏说明","已开启脱敏：不含记录号等可识别字段，仅保留人群与答案"');
      body = String.fromCharCode(0xFEFF) + lines.join(NL);
    } else if (id === 'card') {
      kind = 'json'; mime = 'application/json;charset=utf-8'; label = '结论卡片';
      body = JSON.stringify({
        访谈任务: row.name, 资产ID: row.id,
        触达与咨询: { 已触达: num(row.reached, 0), 已回复: num(row.replied, 0), 回复率: num(row.replyRate, 0), 有效咨询: num(row.consulted, 0) },
        意向分级: { 高: iH, 中: iM, 低: iL, 高意向占比: iTot ? +(iH / iTot).toFixed(4) : 0, 口径: '高/中/低之和 = 有效咨询人数' },
        主题聚类: th.themes.map(function (t) { return { 主题: t.name, 条数: t.count }; }),
        示例说明: SAMPLE_NOTE
      }, null, 2);
    } else {
      kind = 'txt'; mime = 'text/plain;charset=utf-8'; label = '分析报告';
      body = [
        'AI 访谈 · 分析报告（导出快照）',
        '访谈任务：' + row.name + '　资产 ID：' + row.id,
        '状态：' + (row.statusText || row.status || '—') + '　目标人群：' + (row.target || '—'),
        '',
        '一、触达与咨询（取自 survey 资产表行 ' + row.id + '）',
        '　已触达 ' + num(row.reached, 0) + '　已回复 ' + num(row.replied, 0) + '　回复率 ' + (num(row.replyRate, 0) * 100).toFixed(1) + '%　有效咨询 ' + num(row.consulted, 0),
        '',
        '二、意向分级（之和 = 有效咨询）',
        '　高意向 ' + iH + '（' + (iTot ? (iH / iTot * 100).toFixed(1) : '0.0') + '%）　中意向 ' + iM + '（' + (iTot ? (iM / iTot * 100).toFixed(1) : '0.0') + '%）　低意向 ' + iL + '（' + (iTot ? (iL / iTot * 100).toFixed(1) : '0.0') + '%）',
        '',
        '三、开放题主题聚类（示例）',
        th.themes.map(function (t) { return '　' + t.name + '：' + t.count + ' 条'; }).join(NL),
        '',
        '四、逐份样本（示例，共 ' + recs.length + ' 份；完整记录见页面「咨询结论与分析」）',
        recs.map(function (r) { return '　' + r.id + '　' + r.seg.name + '　' + r.rounds + ' 轮　' + (r.finished ? '完答' : '中途放弃') + '　质量：' + r.quality; }).join(NL),
        '',
        '口径：' + SAMPLE_NOTE
      ].join(NL);
    }

    var fname = 'AI访谈-' + row.name + '-' + label.split('（')[0] + '.' + kind;
    if (!downloadFile(fname, body, mime)) { h.toast('导出失败：当前浏览器不支持本地下载', 'bad'); return; }
    h.toast('已导出' + label + '：' + fname + '（文件已下载）', 'ok');
  };
  ACTIONS['sv-pause'] = function (id, btn, h) {
    var row = getSurvey(id || (h.state && (h.state.objId || h.state.surveyId)));
    if (!row) { h.toast('问卷不存在', 'bad'); return; }
    var paused = num(row.quota, 0) - num(row.collected, 0);
    var impacts = [
      '影响对象与数量：' + h.fmt.int(paused) + ' 份尚未回收的样本将被搁置（已答 ' + h.fmt.int(row.collected) + ' 份完整保留）',
      '影响的下游：' + refsCount(row.id) + ' 个对象依赖本问卷的回收结论',
      '是否可回滚：可恢复投放，恢复后未回收配额继续触达'
    ];
    if (V && typeof V.dangerConfirm === 'function') {
      V.dangerConfirm(h, {
        title: '暂停触达：' + row.name, perm: 'survey:publish',
        impacts: impacts, confirmText: '确认暂停',
        onConfirm: function (reason) {
          h.state.svPaused = true;
          h.toast('触达已暂停，已答数据保留', 'warn');
          h.navigate({}, { scroll: false });
        }
      });
    } else {
      h.toast('危险操作确认组件未就绪：未执行暂停（组件未就绪）', 'warn');
    }
  };
  ACTIONS['sv-resume'] = function (id, btn, h) {
    h.state.svPaused = false;
    h.toast('触达已恢复', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-delivery'] = function (id, btn, h) {
    h.state.svDelivery = id;
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-gen-link'] = function (id, btn, h) {
    var st = h.state;
    st.svQrN = num(st.svQrN, 0) + 1;
    h.toast('已重新生成自助入口（第 ' + st.svQrN + ' 版，旧链接仍有效）', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sv-copy-link'] = function (id, btn, h) {
    var link = id || '';
    var done = false;
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(link);
        done = true;
      }
    } catch (e) { done = false; }
    h.toast(done ? '自助入口链接已复制' : '自助入口链接：' + link, 'info');
  };
  ACTIONS['sv-import-list'] = function (id, btn, h) {
    h.toast('已打开名单导入（CSV / Excel）；导入后进入触达队列前会先去重与黑名单过滤', 'info');
  };
  ACTIONS['sv-ack-compliance'] = function (id, btn, h) {
    h.state.svAckCompliance = true;
    h.toast('已确认合规前置：名单授权 / 禁发时段 / 退订入口 / AIGC 标识 / 人审门控', 'ok');
  };
})(window);
