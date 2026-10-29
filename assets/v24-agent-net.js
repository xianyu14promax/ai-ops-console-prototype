/* SECTION: v24-agent-net
 * Agent 工作台第二页「网状关系」：把 Agent 之间的**直接联系**画成网，
 * 并把当前口径下一条边都没有的 Agent 收进左侧灰色「隔离区」。
 *
 * 纪律：关系不编。四类关系全部从现有数据推导，每条边都能指回源字段 ——
 * 页面下方「关系明细」逐条列出依据与出处，并可点进对应页面自行核对：
 *   exp      共用经验 —— LLM 经验库里同一条经验的 agents[] 同时覆盖两个 Agent
 *   conflict 经验冲突 —— 经验 A 的 conflicts[].withId 指向经验 B，且 A、B 归属不同 Agent
 *   mcp      共用 MCP 工具 —— 两个 Agent 的节点拓扑（FACTS.TOPO）里出现同一个 mcp:// 服务
 *
 * 口径可切换（默认只开经验层的两类「强关系」）。切换后**图与隔离区实时重算**：
 * 隔离区是「当前口径下一条边都没有」，不是一份写死的名单 —— 这正是这个页面要暴露的东西。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, F = global.FACTS, APP = global.APP_DATA;
  var C = global.CHARTS, Q = global.QUERY;   /* 卡片上的 sparkline 与指标走与列表页同一个出口 */
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  if (!RENDERERS || !ACTIONS || !S || !F) return;   /* 装配顺序不对就别硬跑 */

  /* SECTION: rules */
  var RULES = [
    { id: 'a2a', label: 'A2A 委派', desc: '一个 Agent 把任务交给另一个 Agent 办（有方向、跨业务线为主）' },
    { id: 'exp', label: '共用经验', desc: '同一条经验被两个 Agent 采纳 —— 一处改动，两边同时受影响' },
    { id: 'conflict', label: '经验冲突', desc: '两条经验互相冲突、分属不同 Agent —— 引用它们会给出互相矛盾的产出' },
    { id: 'mcp', label: '共用 MCP 工具', desc: '两个 Agent 的编排拓扑里出现同一个 mcp:// 服务，下游依赖一起挂' }
  ];
  var DEFAULT_ON = { a2a: true, exp: true, conflict: true, mcp: false };
  var TYPE_LABEL = { a2a: 'A2A 委派', exp: '共用经验', conflict: '经验冲突', mcp: '共用 MCP 工具' };
  var TYPE_CAP = { exp: 'llm-exp', conflict: 'llm-exp', mcp: 'gateway' };
  var TYPE_CAP_TEXT = { exp: '经验库 · 该条经验', conflict: '经验库 · 冲突双方', mcp: '网关 · 该 MCP 服务' };
  /* A2A 的核对目标不是某个能力页，而是「这条边的两端在 Agent 详情里怎么写的」 */
  var TYPE_EV = { a2a: { act: 'goto-agent-tab', text: 'Agent 详情 ·「引用与依赖」的 A2A 卡片' } };
  var TASK_TEXT = {
    submitted: '已提交', working: '执行中', 'input-required': '等对方补输入',
    completed: '已完成', canceled: '已取消', failed: '失败'
  };

  function stateRules(state) {
    var saved = (state && state.agentNetRules) || {}, out = {};
    RULES.forEach(function (r) { out[r.id] = saved[r.id] === undefined ? DEFAULT_ON[r.id] : !!saved[r.id]; });
    return out;
  }

  /* SECTION: lookups */
  function idxOf(id) { var i = S.idx.agent[id]; return (i == null) ? -1 : i; }
  function aOf(id) { var i = idxOf(id); return i < 0 ? null : S.AGENTS[i]; }
  function aName(id) { var a = aOf(id); return a ? a.name : id; }
  function aBiz(id) { var a = aOf(id); if (!a) return '—'; var b = S.BIZ_LINES[S.idx.biz[a.biz]]; return b ? b.name : a.biz; }
  function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }
  function pct1(x) { return x == null ? '—' : (Math.round(x * 1000) / 10) + '%'; }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  var _exps = null;
  function experiences() {
    if (_exps) return _exps;
    var q = (APP && APP.getQueues && APP.getQueues().experience) || {};
    _exps = q.items || [];
    return _exps;
  }

  /* SECTION: edge-builders
   * 四个 builder 各自返回边数组：{ type, a, b, basis, scale, cap, capText }
   * a / b 是 Agent id，basis 是「为什么算一条联系」，scale 是这条联系的规模（可核对的具体数字）。
   */
  function pairs(ids, make) {
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) out.push(make(ids[i], ids[j]));
    }
    return out;
  }

  function expEdges() {
    var out = [];
    experiences().forEach(function (ex) {
      var ids = (ex.agents || []).filter(function (id) { return idxOf(id) >= 0; });
      if (ids.length < 2) return;                       /* 私有经验只有归属 Agent，构不成「两个 Agent 的联系」 */
      out = out.concat(pairs(ids, function (x, y) {
        return {
          type: 'exp', a: x, b: y,
          basis: '共用经验「' + ex.title + '」',
          scale: '该经验被检索 ' + num(ex.searches) + ' 次 · 命中率 ' + pct1(ex.hitRate) + ' · ' + ids.length + ' 个 Agent 共用'
        };
      }));
    });
    return out;
  }

  function conflictEdges() {
    var list = experiences(), byId = {};
    list.forEach(function (ex) { byId[ex.id] = ex; });
    var out = [];
    list.forEach(function (ex) {
      (ex.conflicts || []).forEach(function (c) {
        var other = byId[c.withId];
        if (!other) return;
        var as = (ex.agents || []).filter(function (id) { return idxOf(id) >= 0; });
        var bs = (other.agents || []).filter(function (id) { return idxOf(id) >= 0; });
        as.forEach(function (x) {
          bs.forEach(function (y) {
            if (x === y) return;
            out.push({
              type: 'conflict', a: x, b: y,
              basis: '经验冲突：「' + ex.title + '」↔「' + other.title + '」',
              scale: clip(c.point, 46)
            });
          });
        });
      });
    });
    return out;
  }

  function mcpEdges() {
    var byMcp = {}, svcName = {};
    (S.MCP_SERVICES || []).forEach(function (m) { svcName[m.id] = m; });
    S.AGENTS.forEach(function (a) {
      var topo = F.TOPO[F.AGENT_TOPO[a.id]] || [];
      var seen = {};
      topo.forEach(function (n) {
        if (!n.mcp || seen[n.mcp]) return;
        seen[n.mcp] = 1;
        (byMcp[n.mcp] = byMcp[n.mcp] || []).push(a.id);
      });
    });
    var out = [];
    Object.keys(byMcp).forEach(function (mid) {
      var ids = byMcp[mid];
      if (ids.length < 2) return;
      var svc = svcName[mid] || { name: mid, qpsCap: null };
      out = out.concat(pairs(ids, function (x, y) {
        return {
          type: 'mcp', a: x, b: y,
          basis: '共用 MCP 服务 ' + svc.name,
          scale: '该服务 QPS 上限 ' + (svc.qpsCap == null ? '—' : svc.qpsCap) + ' · ' + ids.length + ' 个 Agent 共用'
        };
      }));
    });
    return out;
  }

  /* A2A：真实的对等委派边。data.js 已按 A2A v1.0.0 建好（Agent Card / Task / Message / Artifact），
     这里只取「谁委派给谁、办什么技能、任务进行到哪一步、量有多大」。
     与其余三类不同，它是**有向**的（对等但有方向），所以 dedupe 与渲染都要保方向。 */
  function a2aEdges() {
    var list = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
    var out = [];
    (list || []).forEach(function (e) {
      if (idxOf(e.from) < 0 || idxOf(e.to) < 0) return;
      /* v26c（C 批）：人工新增的边在数据里带 manual 标记 ——
         它必须**在界面上自证是人工加的**，不能和推导出来的边长得一样
         （这个页面从第一行注释起的纪律就是"每条边都能指回源字段"）。 */
      var isM = !!e.manual;
      out.push({
        type: 'a2a', a: e.from, b: e.to, dir: true,
        manual: isM, by: e.by || '', reason: e.reason || '',
        basis: (isM ? '人工新增 · ' : '') + 'A2A 委派：「' + e.skill + '」（' + aName(e.from) + ' → ' + aName(e.to) + '）',
        scale: isM
          ? '人工标注' + (e.by ? ' · ' + e.by : '') + ' · ' + clip(e.reason || '未填理由', 44) + ' · 尚未产生真实流量'
          : '任务' + (TASK_TEXT[e.task] || e.task) + ' · 今日互通 ' + num(e.calls) + ' 次 · 失败率 '
            + pct1(e.fail) + ' · P99 ' + (Math.round(e.p99 / 10) / 100) + 's',
        why: e.why || '',
        calls: isM ? null : e.calls, fail: isM ? null : e.fail,
        /* 边上的芯片文字：把「今日互通」压成一句话（资料里边就带吞吐量，不必悬停才知道）。
           人工边没有真实流量 → 不画芯片，免得凭空出现一个「0 次」。 */
        rpmText: isM ? '' : (num(e.calls) + ' 次'),
        evAct: 'goto-agent-tab', evId: e.from + '|deps'
      });
    });
    return out;
  }

  var BUILDERS = { a2a: a2aEdges, exp: expEdges, conflict: conflictEdges, mcp: mcpEdges };

  /* SECTION: graph
   * 建图 + 连通分量（并查集）。隔离区 = 分量为 1 的那些 Agent。
   */
  function buildGraph(state) {
    var on = stateRules(state), edges = [];
    RULES.forEach(function (r) { if (on[r.id]) edges = edges.concat(BUILDERS[r.id]()); });

    /* 同类型同一对 Agent 只留一条（保留首次出现的依据）。
       有向边（A2A）按「A→B」作键：A→B 与 B→A 是两条不同的委派，不能合并。 */
    var seen = {}, uniq = [];
    edges.forEach(function (e) {
      var k = e.type + '|' + (e.dir ? e.a + '>' + e.b : (e.a < e.b ? e.a + '~' + e.b : e.b + '~' + e.a));
      if (seen[k]) return;
      seen[k] = 1;
      e.cap = TYPE_CAP[e.type];
      e.capText = TYPE_CAP_TEXT[e.type];
      e.typeLabel = TYPE_LABEL[e.type];
      uniq.push(e);
    });

    var parent = {};
    S.AGENTS.forEach(function (a) { parent[a.id] = a.id; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    uniq.forEach(function (e) {
      var ra = find(e.a), rb = find(e.b);
      if (ra !== rb) parent[ra] = rb;
    });
    var bucket = {};
    S.AGENTS.forEach(function (a) { var r = find(a.id); (bucket[r] = bucket[r] || []).push(a.id); });
    var all = Object.keys(bucket).map(function (k) { return bucket[k]; });
    var linked = all.filter(function (g) { return g.length > 1; })
      .sort(function (x, y) { return y.length - x.length || (x[0] < y[0] ? -1 : 1); });
    var isolated = all.filter(function (g) { return g.length === 1; })
      .map(function (g) { return g[0]; })
      .sort(function (x, y) { return aName(x) < aName(y) ? -1 : 1; });

    var deg = {};
    uniq.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });

    var byType = {};
    uniq.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + 1; });

    var connected = linked.reduce(function (n, g) { return n + g.length; }, 0);
    return {
      rules: on, edges: uniq, linked: linked, isolated: isolated, deg: deg, byType: byType,
      connected: connected, total: S.AGENTS.length,
      retired: S.AGENTS.filter(function (a) { return a.retiredAt !== undefined; }).length
    };
  }

  /* ============================================================ SECTION: org-layout
   * 组织架构 × 流程 的几何（列 = 业务线、行 = 调用深度，卡片上下移动、箭头直连下层）。
   *
   * ⚠ 坐标一律用**像素**，画布 = 自然尺寸 W×H，由视图 transform:scale(k) 整体缩放。
   *    旧代码是「1000 单位虚拟宽 + 估算 _SCALE」，实测两个 bug 都出在这个估算上
   *    （隐藏隔离区后画布宽 226px、1101–1200 窗口段 CSS 已竖排而 JS 仍减 226）。
   *    自然尺寸下连线与卡片同一坐标系，不需要任何单位换算。
   * ========================================================================== */
  var AZ = {
    CW: 118, CH: 92, BIZ_W: 118, BIZ_H: 42, ROOT_W: 176, ROOT_H: 44,
    PAD: 24, SIB: 18, BLOCK: 46, Y_TITLE: 20, Y_ROOT: 70, Y_BIZ: 184, Y_ROW0: 264,
    /* ROWGAP 64：行距原来 82，配上 92 高的卡，一层里一半是空气 —— 13 张卡要滚两屏。
       64 仍容得下两层标签车道（有标签的行走 max(ROWGAP, 车道数×20+26)，自动长高，不会相碰）。
       LANE_H 必须 > 标签高 14，否则相邻车道差 13px 时标签差 1px 相碰；提到 20 给足 6px 缝。 */
    TAG_DY: 12, ROWGAP: 64, LANE_H: 20, ROW_LAB_W: 112, LABEL_BASE: 20,
    /* 隔离区在**画布里面**（世界层里的一块），所以它的宽度要算进布局，否则图表会压在面板上。
       它在世界层里，缩放/平移时和连线、卡片一起走 —— 位置是同一个坐标系。 */
    ISO_X: 24, ISO_Y: 70, ISO_W: 210, ISO_GAP: 26, ISO_CARD_GAP: 28, ISO_HEAD: 126
  };
  AZ.ROW_PITCH = AZ.CH + AZ.TAG_DY + 4 + AZ.ROWGAP;

  /* 每列宽度的缓存：key = 业务线 id，{ n: 该列卡数, wid: 同层最大卡数 }。
     只在「卡数变了」时重算 —— 上下拖改层级不改列宽，否则整图横向平移（见 anetLayout 里的说明）。 */
  var _COLW = {};
  /* 列内槽位缓存：id → 第几格（跨行稳定）。
     业主三次指出"位置变了"，最后这次是**同层邻居补位** —— 拖走第 1 格，第 2 格横移过来。
     槽位固定后，拖走就留空，谁都不补。跨列拖动时删掉该卡的缓存，让它在新列重新落格。 */
  var _SLOT = {};

  /* 隔离区文案：**单一事实来源** —— 引擎按它估行数、渲染按它出内容，两处必须同一份字符串，
     否则"量的"和"画的"不一致，卡片又会压到文字上。 */
  /* 连线标签的默认模式：**只在这里定义一处** —— 引擎、工具条高亮、action 都取它。
     三个地方各写一个字符串的话，改一个漏一个就会出现"按钮高亮和实际行为不一致"。 */
  var DEF_LABEL_MODE = 'hover';

  var ISO_COPY = {
    /* 2026-10-28 业主指出这段是"自述腔"（产品在自言自语解释自己的设计），改成人话：
       只说**图上是什么情况**，不解释"口径"，也不发表"孤岛不是错"这种议论。 */
    sub: '图上跟其他 Agent 没有任何连线：没人调用它们，也没有共用经验或工具。',
  };
  /**
   * 隔离区头部高度：按文案**实际换行行数**算。
   * ⚠ 面板是 HTML 流式排版，头部高度写死（原来 126）时，文案一长，第一张卡的绝对坐标就落到
   *   说明文字里 —— 实测「质检评分 Agent」正好压住了落点提示框。行数用 azTw 估宽后向上取整。
   */
  function isoHeadHeight(width) {
    var lw = (width || AZ.ISO_W) - 24;                       /* 面板 padding 12×2 */
    /* 行数要按"每行能放几个字"算，不能拿总宽除以行宽：
       总宽 350 ÷ 行宽 186 = 1.9 → 向上取整 2 行，但断行是按**字数**发生的 ——
       33 个字每行只放得下 16 个，实际要 3 行。少算一行，面板就压住最后一张卡
       （实测隔离区那段说明被切掉一截）。 */
    function lines(t, size) {
      var perLine = Math.max(1, Math.floor(lw / size));
      var chars = 0;
      for (var i = 0; i < t.length; i++) chars += (t.charCodeAt(i) > 0x2e80 ? 1 : 0.55);
      return Math.max(1, Math.ceil(chars / perLine));
    }
    return 30                                                /* 标题行 */
      + lines(ISO_COPY.sub, 11.5) * 18 + 10
      + 10;                                                  /* 与首张卡的间距 */
  }
  /* 根节点副标题：**引擎按它撑框宽、渲染按它出文字**（同一份字符串）。
     只写在渲染里的话引擎不知道它多宽 —— 实测 176px 的框装了 230px 的文案，两侧各溢出 27px。 */
  function rootSubText(nCols, nAgents, nIso) {
    return nCols + ' 条业务线 · ' + nAgents + ' 个 Agent' + (nIso ? ' · 另有 ' + nIso + ' 个在隔离区' : '');
  }
  /* 行号只说语义，不写「第 N 层」：深度由描述词表达，编号是重复的。
     但自定义层级之后层号可以跳（用户把卡放到第 5 层而第 3、4 层空着），
     这时语义词就不够用了 —— 超过第 3 层直接报层号，别拿"三级下游"糊弄。 */
  var ROW_LAB = { 0: '无上游委派', 1: '被上游委派', 2: '二级下游', 3: '三级下游' };
  function rowLabel(r) { return ROW_LAB[r] || ('第 ' + r + ' 层'); }

  /** 一段文本在给定字号下的估算宽度（只用于标签底色块，不必精确） */
  function azTw(s, size) {
    s = String(s == null ? '' : s); var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? size : size * 0.55;
    return w;
  }

  /** 当前口径下的关系集合：a2a 有向（决定流程与层数）、rel 无向（其余各类）、all 是否有任何关系（决定隔离区） */
  function azRels(g) {
    var a2a = {}, rel = {}, ref = {}, all = {};
    g.edges.forEach(function (e) {
      all[e.a] = 1; all[e.b] = 1;          /* ⚠ 隔离区看**所有类型**：只看 A2A 会把
                                              全开口径下已被「共用经验/共用 MCP」连上的 Agent 仍当成孤岛 */
      if (e.type === 'a2a') { (a2a[e.a] = a2a[e.a] || []).push(e.b); }
      else { (rel[e.a] = rel[e.a] || []).push(e.b); (rel[e.b] = rel[e.b] || []).push(e.a); }
    });
    Object.keys(rel).forEach(function (k) { rel[k] = rel[k].filter(function (v, i, s) { return s.indexOf(v) === i; }); });
    Object.keys(a2a).forEach(function (k) { a2a[k].forEach(function (b) { (ref[b] = ref[b] || []).push(k); }); });
    return { a2a: a2a, rel: rel, ref: ref, all: all };
  }

  /**
   * 布局。返回画布尺寸、列、行、卡片坐标、正交走线与标签。
   * 隔离区 = 当前口径下**任何一类关系都没有**的 Agent（推导，不是名单）——
   * 只按 A2A 判会把「营销文案」误判成孤岛（它没有 A2A，但有共用经验与经验冲突）。
   */
  function anetLayout(g, h) {
    var R = azRels(g), a2a = R.a2a, rel = R.rel, ref = R.ref;
    var linked = {}, isolated = [];
    S.AGENTS.forEach(function (a) {
      if (R.all[a.id]) linked[a.id] = 1; else isolated.push(a.id);
    });
    var tree = S.AGENTS.filter(function (a) { return linked[a.id]; });

    /* 行 = 调用深度（沿 A2A 取最长路径） */
    var DEP = {};
    function depth(i, seen) {
      if (DEP[i] !== undefined) return DEP[i];
      seen = seen || {};
      if (seen[i]) return 0;
      var ps = ref[i] || [];
      if (!ps.length) { DEP[i] = 0; return 0; }
      seen[i] = 1;
      DEP[i] = 1 + Math.max.apply(null, ps.map(function (p) { return depth(p, seen); }));
      return DEP[i];
    }
    tree.forEach(function (a) { depth(a.id); });

    /* ── 层级是「自定义」的一部分（2026-10-24 业主明确）────────────────────
       默认层由 A2A 深度推导；但用户把卡片拖到某一层，就是**他定了这一层**，
       系统不能替他改委派、不能替他挑一张上游，**也不能动别人**。
       做法：覆盖表只管"这张卡显示在第几层"，A2A 边一条都不动；
       其余卡一律停在推导层 —— 拖一张就只有这一张会动（业主第二次强调："你看，位置变了"）。
       代价：上游被拖到下游下面时，边上会出现同层/朝上的走线。这是用户自己摆的，
       比"替他重排整张图"更可接受；真要修正，他自己把下游也摆下去即可。 */
    var OV = (h && h.state && h.state.anetRowOverride) || {};
    _AUTOROW = {};
    Object.keys(DEP).forEach(function (k) { _AUTOROW[k] = DEP[k]; });
    Object.keys(OV).forEach(function (id) {
      var v = OV[id];
      if (DEP[id] === undefined || typeof v !== 'number' || v < 0) return;
      if (v === DEP[id]) return;                 /* 手动值恰好等于推导值 → 等同自动，别留"手动"痕迹 */
      DEP[id] = v;
    });

    var rows = Object.keys(DEP).map(function (k) { return DEP[k]; })
      .filter(function (v, i, s) { return s.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    /* Y_ROW 挪到车道分配之后算：行高要按该行实际用掉的车道数长出来 */
    /* 全关口径下没有任何关系 → 没有列也没有行。这里必须提前返回：
       rows 为空时 Y_ROW[undefined] 会把画布尺寸算成 NaN（实测「全关」就是这么炸的）。 */
    if (!rows.length) {
      var e2 = AZ.ISO_X, e3 = AZ.ISO_W, e4 = AZ.ISO_GAP, e5 = AZ.ROW_LAB_W;
      var eHead = isoHeadHeight(isoW);
      var eH = Math.max(180, eHead + isolated.length * (AZ.CH + AZ.ISO_CARD_GAP) - AZ.ISO_CARD_GAP + 16);
      return { w: e2 + e3 + e4 + e5 + 200, h: AZ.ISO_Y + eH + AZ.PAD, cols: [], rows: [], yRow: {}, rowBottom: 0,
               rowLab: ROW_LAB, cards: [], pos: {}, cxOf: {}, isoIds: isolated, edges: [], crossings: 0,
               isoX: e2, isoY: AZ.ISO_Y, isoW: e3, isoH: eH, isoHead: eHead, isoOn: true, rowStripL: e2 + e3 + e4,
               isoCards: isolated.map(function (id, k) {
                 return { id: id, x: e2 + e3 / 2, y: AZ.ISO_Y + eHead + k * (AZ.CH + AZ.ISO_CARD_GAP) + AZ.CH / 2,
                          row: -1, biz: aOf(id) ? aOf(id).biz : null, iso: true };
               }),
               chartL: e2 + e3 + e4 + e5, chartR: e2 + e3 + e4 + e5,
               rootCx: e2 + e3 + e4 + e5, cxs: [], rowCount: [] };
    }

    /* 隔离区占位：面板关掉时不占（旧代码无条件减 226px，隐藏后白留一大片 */
    var isoOn = !(h && h.state && h.state.agentNetIso === false);
    /* 宽度可由用户拖（state.anetIsoW）：夹在 180–420，太小装不下卡片、太大把图挤没 */
    var isoWish = (h && h.state && h.state.anetIsoW) || AZ.ISO_W;
    var isoX = AZ.ISO_X, isoW = isoOn ? Math.max(180, Math.min(420, isoWish)) : 0;
    var rowStripL = isoX + isoW + (isoOn ? AZ.ISO_GAP : 0);
    var chartL = rowStripL + AZ.ROW_LAB_W;
    var isoHead = isoHeadHeight(isoW);
    var isoH = Math.max(180, isoHead + isolated.length * (AZ.CH + AZ.ISO_CARD_GAP) - AZ.ISO_CARD_GAP + 16);

    /* 列 = 业务线（按 S.BIZ_LINES 的既有顺序，空的业务线不出现） */
    var COLS = [], x = chartL;
    S.BIZ_LINES.forEach(function (bl) {
      var inCol = tree.filter(function (a) { return a.biz === bl.id; });
      if (!inCol.length) return;
      var per = {}, tag = {};
      inCol.forEach(function (a) {
        (per[DEP[a.id]] = per[DEP[a.id]] || []).push(a.id);
        var t = rel[a.id] && rel[a.id].length ? '关系' + rel[a.id].length : '';
        tag[a.id] = t;
      });
      Object.keys(per).forEach(function (r) { per[r].sort(function (p, q) { return aName(p) < aName(q) ? -1 : 1; }); });

      /* ── 列内槽位固定（2026-10-24 业主第三次指出「还是会变」）───────────────
         旧写法：每行都从第一格开始顺排。拖走第 1 格那张，第 2 格的邻居就"补位"横移一格 ——
         用户看到的就是"我只拖了一张，旁边那张也跟着横着动了"。
         现在：每张卡记住自己在列内的格号（跨行稳定），拖走了就空着，谁也不补。
         没缓存的卡（新出现的 / 刚跨列过来的）按"同行最小空闲格"落位。 */
      var slotOf = {}, rowUsed = {};
      Object.keys(per).forEach(function (r) {
        per[r].forEach(function (id) {
          var want = _SLOT[id], ru = rowUsed[r] = rowUsed[r] || {};
          if (typeof want === 'number' && want >= 0 && !ru[want]) { slotOf[id] = want; ru[want] = 1; }
        });
      });
      Object.keys(per).forEach(function (r) {
        var ru = rowUsed[r] = rowUsed[r] || {};
        per[r].forEach(function (id) {
          if (slotOf[id] != null) return;
          var k = 0; while (ru[k]) k++;
          slotOf[id] = k; ru[k] = 1; _SLOT[id] = k;
        });
      });
      var maxSlot = 0;
      Object.keys(slotOf).forEach(function (id) { if (slotOf[id] > maxSlot) maxSlot = slotOf[id]; });

      var maxPerRow = Math.max.apply(null, Object.keys(per).map(function (r) { return per[r].length; }));
      var need = Math.max(maxPerRow, maxSlot + 1);   /* 列宽必须容得下最靠右的槽位 */
      var nCards = inCol.length;
      var cached = _COLW[bl.id];
      var wid;
      if (cached && cached.n === nCards) wid = Math.max(cached.wid, need);   /* 只许变宽，不许变窄：窄了卡片会溢到隔壁列 */
      else { wid = need; _COLW[bl.id] = { n: nCards, wid: wid }; }
      COLS.push({ biz: bl.id, name: bl.name, x: x, w: wid * AZ.CW + (wid - 1) * AZ.SIB, per: per,
                  slot: slotOf, n: inCol.length });
      x += (wid * AZ.CW + (wid - 1) * AZ.SIB) + AZ.BLOCK;
    });
    var chartR = x - AZ.BLOCK;
    var W = chartR + AZ.PAD;

    /* 卡片先只定 x（列内居中）：x 只依赖列与行序号、与 y 无关，先定下来才谈得上按标签宽度排车道 */
    var cards = [], pos = {}, cxOf = {}, rowOf = {};
    COLS.forEach(function (c, ci) {
      Object.keys(c.per).forEach(function (r) {
        var list = c.per[r];
        /* x 用**槽位**，不再用行内序号 k：拖走一张，同层邻居原地不动（2026-10-24）。
           槽位是跨行共享的，所以同一张卡换层时只改 y、不改 x —— 竖着下去，不会斜着跳。 */
        list.forEach(function (i, k) {
          var slot = (c.slot && c.slot[i] != null) ? c.slot[i] : k;
          var cx = c.x + slot * (AZ.CW + AZ.SIB) + AZ.CW / 2;
          cxOf[i] = cx; rowOf[i] = +r;
          pos[i] = { id: i, x: cx, y: 0, row: +r, col: ci, biz: c.biz };
          cards.push(pos[i]);
        });
      });
    });

    /* 边：同层走行间空隙（区间图着色压轨道），跨层走列间空隙（按交叉数×120+绕行选通道） */
    var E = [];
    Object.keys(a2a).forEach(function (a) {
      a2a[a].forEach(function (b) { if (pos[a] && pos[b]) E.push([a, b]); });
    });
    var tgt = {};
    E.forEach(function (e) { (tgt[e[1]] = tgt[e[1]] || []).push(e[0]); });
    var entry = {};
    Object.keys(tgt).forEach(function (b) {
      var srcs = tgt[b].slice().sort(function (p, q) { return cxOf[p] - cxOf[q]; });
      srcs.forEach(function (a, k) { entry[a + '>' + b] = cxOf[b] + (k - (srcs.length - 1) / 2) * 16; });
    });
    /* ── 出口分槽（2026-10-28）──────────────────────────────────────────────
       同一张卡的多条边原来**都从底边正中出**，出卡后的竖线完全重合，看起来像
       "只有一条线从这儿走"；而卡片底下又写着「汇聚3」，两边对不上。
       按目标 x 排序均分，每条边占一个槽；步长夹在 0–12px —— 卡宽 118，
       4 条边也只占 ±18，不会跑出卡边。 */
    var exitOff = {};
    var bySrc = {};
    E.forEach(function (e) { (bySrc[e[0]] = bySrc[e[0]] || []).push(e); });
    Object.keys(bySrc).forEach(function (a) {
      var list = bySrc[a].slice().sort(function (p, q) { return cxOf[p[1]] - cxOf[q[1]]; });
      if (list.length < 2) { exitOff[list[0].join('>')] = 0; return; }
      var step = Math.min(12, (AZ.CW - 40) / (list.length - 1));
      list.forEach(function (e, k) { exitOff[e.join('>')] = (k - (list.length - 1) / 2) * step; });
    });
    var labelMode = (h && h.state && h.state.anetLabelMode) || DEF_LABEL_MODE;
    var byRow = {}, laneY = {}, laneOf = {}, lanesPerRow = {}, labelText = {};
    E.forEach(function (e) { labelText[e.join('>')] = (e3Skill(e.join('>')) || '委派') + (e3Calls(e.join('>')) || ''); });
    /* ⚠ **所有**边都按"源卡所在行"分组排车道，不只是同层边：
       跨层边原来不参加分配，标签 y 固定落在车道 0 基线上，于是和同层的车道 0 标签撞（实测 19px 重叠）。 */
    E.forEach(function (e) {
      (byRow[rowOf[e[0]]] = byRow[rowOf[e[0]]] || []).push(e);
    });
    Object.keys(byRow).forEach(function (rr) {
      var lanes = [];
      /* 先排**同层边**（路线短、受行高影响大），再让跨层边挑剩下的车道：
         跨层边路线本来就长，多占一个车道对交叉数的代价小得多 ——
         反过来的话同层边会被顶到更高车道，交叉数从 6 涨到 11（实测）。 */
      byRow[rr].slice().sort(function (p, q) {
        var sp = (rowOf[p[1]] === rowOf[p[0]] + 1) ? 0 : 1, sq = (rowOf[q[1]] === rowOf[q[0]] + 1) ? 0 : 1;
        if (sp !== sq) return sp - sq;
        return Math.min(cxOf[p[0]], entry[p.join('>')]) - Math.min(cxOf[q[0]], entry[q.join('>')]);
      }).forEach(function (e) {
        var key = e.join('>'), x1 = cxOf[e[0]], x2 = entry[key], put = -1;
        /* ⚠ 占用区间必须**并上标签跨度**：标签从源卡右边起、宽 120–140px，比线段区间宽得多。
           只按线段排车道时同一车道里两条标签必然叠（实测 6 对重叠、11 处压在卡片上）。 */
        /* 只有"全部显示"模式才给标签留宽度：悬停/隐藏模式下标签不常驻，
           线就不必为它让路 —— 交叉数能从 11 退回 6（先前为标签抬线付的账）。 */
        var lw = (labelMode === 'all') ? (azTw(labelText[key], 9.5) + 9) : 0;
        /* 标签落点与渲染完全同一套判定（贴右缘时翻到源卡左侧）：
           只算右侧区间的话，翻过去的标签仍会互相叠 —— 实测清了右侧后还剩 4 对重叠。 */
        var flip = (x1 + 6 + lw > chartR + 4);
        var lx0 = flip ? (x1 - 3 - lw) : (x1 + 3);
        var lo = Math.min(x1, x2, lx0), hi = Math.max(x2, lx0 + lw);
        for (var li = 0; li < lanes.length; li++) {
          if (lanes[li].every(function (iv) { return hi + 10 < iv[0] || lo - 10 > iv[1]; })) { lanes[li].push([lo, hi]); put = li; break; }
        }
        if (put < 0) { lanes.push([[lo, hi]]); put = lanes.length - 1; }
        laneOf[key] = put;
      });
      lanesPerRow[rr] = lanes.length;
    });

    /* ── 行高：**全图统一且定死**（2026-10-28 业主"12"改）────────────────────
       原来"每行按自己用掉的车道数长高"。拖一张卡到别的层，那一行的车道数可能 +1，
       行高 +20，**它下面的每一行整排下移** —— 业主看到的就是"我只拖了一张，
       另外三张也跟着挪"。实测：拖「标书生成」上移一层，线索评分 / 合规问答 /
       知识问答 各下移 19px。
       现在直接按"预留 3 条车道"定死一个行距，谁都不许改它；某行真需要更多车道时
       不是涨行高，而是**压缩车道间距**（见 laneStep，20px 起，最窄 12px）。
       代价：车道少的那几行底下留白，整图高约 60px —— 换来拖动时"除了我拖的那张，
       一个像素都不动"。 */
    var LANE_ROOM = 3;
    var rowPitch = AZ.CH + AZ.TAG_DY + 4 + Math.max(AZ.ROWGAP, LANE_ROOM * AZ.LANE_H + 26);
    var Y_ROW = {}, _yy = AZ.Y_ROW0;
    rows.forEach(function (rr) { Y_ROW[rr] = _yy; _yy += rowPitch; });
    /* 每行的车道间距：够装就 20px，车道挤不下就压窄（下限 12px），绝不撑破行距 */
    var laneStep = {};
    rows.forEach(function (rr) {
      var n = lanesPerRow[rr] || 0;
      var room = rowPitch - AZ.CH - AZ.TAG_DY - 4 - AZ.LABEL_BASE - 16;
      laneStep[rr] = (n > 1) ? Math.max(12, Math.min(AZ.LANE_H, room / (n - 1))) : AZ.LANE_H;
    });
    cards.forEach(function (c) { c.y = Y_ROW[c.row] + AZ.CH / 2; });
    E.forEach(function (e) {
      var key = e.join('>');
      if (laneOf[key] !== undefined) laneY[key] = Y_ROW[rowOf[e[0]]] + AZ.CH + AZ.TAG_DY + 4 + AZ.LABEL_BASE + laneOf[key] * (laneStep[rowOf[e[0]]] || AZ.LANE_H);
    });
    var rowBottom = Y_ROW[rows[rows.length - 1]] + AZ.CH + AZ.TAG_DY;
    /* 画布高度要同时容得下图表和隔离区：全关口径下 13 个孤岛全堆在面板里，它会比图表高得多 */
    var H = Math.max(isoOn ? AZ.ISO_Y + isoH : 0, AZ.Y_ROW0 + 260, rowBottom + 116) + AZ.PAD;
    var isoCards = isolated.map(function (id, k) {
      return { id: id, x: isoX + isoW / 2, y: AZ.ISO_Y + isoHead + k * (AZ.CH + AZ.ISO_CARD_GAP) + AZ.CH / 2,
               row: -1, biz: aOf(id) ? aOf(id).biz : null, iso: true };
    });
    /* 业务线表头框宽度按内容撑开：固定 118px 装不下较长的业务线名（实测被切） */
    var bizW = AZ.BIZ_W;
    COLS.forEach(function (c) {
      var sub = c.n + ' 个 Agent';
      bizW = Math.max(bizW, Math.round(azTw(c.name + ' ⇄', 12)) + 22, Math.round(azTw(sub, 9.5)) + 22);
    });
    var rootSub = rootSubText(COLS.length, cards.length, isolated.length);
    var rootW = Math.max(AZ.ROOT_W, Math.round(azTw(rootSub, 10)) + 28);
    var GUT = [];
    for (var gi = 0; gi + 1 < COLS.length; gi++) GUT.push((COLS[gi].x + COLS[gi].w + COLS[gi + 1].x) / 2);

    var segsAll = [], usedCh = [], multi = 0, edges = [];
    E.slice().sort(function (p, q) {
      return (pos[p[0]].row - pos[q[0]].row) || (cxOf[p[0]] - cxOf[q[0]]);
    }).forEach(function (e) {
      var a = e[0], b = e[1], key = a + '>' + b;
      var xa = cxOf[a], xo = xa + (exitOff[key] || 0), xb = entry[key], ra = pos[a].row, rb = pos[b].row;
      var ybot = pos[a].y + AZ.CH / 2, ly, segs = [];
      var tTop = pos[b].y - AZ.CH / 2, tBot = pos[b].y + AZ.CH / 2;
      /* 箭头落在**哪条边、朝哪边**由"最后一段线从哪来"决定，不能一律贴顶边朝下。
         一律朝下的话，把上游拖到下游下面（rb < ra）或同层走车道时，线明明是从卡片
         **下方**爬上来的，箭头却扎在顶边朝下 —— 看起来像"从天上掉下来一条线"，
         方向和真实的委派方向是反的。 */
      var arrowPt = { x: xb, y: tTop - 1, dir: 'down' };
      function seg(x1, y1, x2, y2) { segs.push([x1, y1, x2, y2]); segsAll.push([x1, y1, x2, y2]); }
      if (laneY[key] !== undefined) {
        ly = laneY[key];
        if (ly >= tBot + 1) arrowPt = { x: xb, y: tBot + 1, dir: 'up' };   /* 车道在目标卡下方 → 从下往上进卡 */
        seg(xo, ybot, xo, ly); seg(xo, ly, xb, ly); seg(xb, ly, xb, arrowPt.y);
      } else {
        /* 跨层边走列间空隙，但它的**标签**同样要在本行的车道里排（否则压同层标签） */
        ly = (laneY[key] !== undefined) ? laneY[key] : (pos[a].y + AZ.CH / 2 + AZ.TAG_DY + 4 + AZ.LABEL_BASE);
        var preY = pos[b].y - AZ.CH / 2 - 20 - multi * 13, best = null;
        GUT.forEach(function (gg) {
          if (usedCh.some(function (u) { return Math.abs(gg - u) < 14; })) return;
          var n = 0;
          segsAll.forEach(function (s) {
            if (Math.abs(s[1] - s[3]) < 0.5 && Math.min(s[1], s[3]) < preY && Math.max(s[1], s[3]) > ly &&
              Math.min(s[0], s[2]) + 0.5 < gg && gg < Math.max(s[0], s[2]) - 0.5) n++;
          });
          var sc = n * 120 + Math.abs(gg - xb);
          if (!best || sc < best.sc) best = { g: gg, sc: sc };
        });
        var xc = best ? best.g : (GUT[0] || xb);
        usedCh.push(xc); multi++;
        seg(xo, ybot, xo, ly); seg(xo, ly, xc, ly); seg(xc, ly, xc, preY);
        seg(xc, preY, xb, preY); seg(xb, preY, xb, arrowPt.y);
      }
      var lab = labelText[key] || '委派';
      var showLab = (labelMode !== 'off');
      var lw = azTw(lab, 9.5) + 9, flip = (xa + 6 + lw > chartR + 4);
      edges.push({
        a: a, b: b, segs: segs, type: 'a2a', manual: !!key_manual(key),
        calls: e3CallsNum(key),
        label: { text: lab, w: lw, y: ly - 8, x: flip ? xa - 3 - lw : xa + 3, anchor: flip ? 'end' : 'start',
                 tx: flip ? xa - 8 : xa + 8 },
        arrow: arrowPt
      });
    });
    /* 边都建完了才知道量级范围，这里统一算宽度（相对刻度，见 edgeWidth 注释） */
    if (edges.length) {
      var callArr = edges.map(function (e) { return e.calls || 0; });
      var cMin = Math.min.apply(null, callArr), cMax = Math.max.apply(null, callArr);
      edges.forEach(function (e) { e.width = edgeWidth(e.calls, cMin, cMax); });
    }
    /* 交叉数（正交线段内部相交；拐角相接不算）——布局质量的唯一硬指标，每次都算出来 */
    var inter = 0;
    for (var p1 = 0; p1 < segsAll.length; p1++) {
      for (var p2 = p1 + 1; p2 < segsAll.length; p2++) {
        var s = segsAll[p1], t = segsAll[p2];
        if ((Math.abs(s[1] - s[3]) < 0.5) === (Math.abs(t[1] - t[3]) < 0.5)) continue;
        var hz = Math.abs(s[1] - s[3]) < 0.5 ? s : t, vt = hz === s ? t : s;
        if (Math.min(hz[0], hz[2]) + 0.5 < vt[0] && vt[0] < Math.max(hz[0], hz[2]) - 0.5 &&
            Math.min(vt[1], vt[3]) + 0.5 < hz[1] && hz[1] < Math.max(vt[1], vt[3]) - 0.5) inter++;
      }
    }
    var cxs = COLS.map(function (c) { return c.x + c.w / 2; });
    return {
      labelMode: labelMode,
      w: W, h: H, cols: COLS, rows: rows, yRow: Y_ROW, rowPitch: rowPitch, rowBottom: rowBottom, rowLab: ROW_LAB,
      cards: cards, pos: pos, cxOf: cxOf, isoIds: isolated, edges: edges, crossings: inter,
      isoX: isoX, isoY: AZ.ISO_Y, isoW: isoW, isoH: isoH, isoHead: isoHead, isoOn: isoOn,
      rowStripL: rowStripL, isoCards: isoCards,
      chartL: chartL, chartR: chartR,
      rootW: rootW, rootSub: rootSub, bizW: bizW,
      rootCx: cxs.length ? (cxs[0] + cxs[cxs.length - 1]) / 2 : W / 2, cxs: cxs,
      rowCount: rows.map(function (r) { return cards.filter(function (c) { return c.row === r; }).length; })
    };
  }
  /* 边上要显示的两样东西（技能名、今日互通次数）——从真实边数据取 */
  function e3Skill(key) {
    var ab = key.split('>'), list = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
    for (var i = 0; i < list.length; i++) if (list[i].from === ab[0] && list[i].to === ab[1]) return '「' + list[i].skill + '」';
    return '';
  }
  function e3Calls(key) {
    var ab = key.split('>'), list = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
    for (var i = 0; i < list.length; i++) if (list[i].from === ab[0] && list[i].to === ab[1]) return ' · 今日 ' + num(list[i].calls) + ' 次';
    return '';
  }
  /** 今日互通次数（数值）—— 边粗按它来：粗细是"不用读字就看出主链路"的表达 */
  function e3CallsNum(key) {
    var ab = key.split('>'), list = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
    for (var i = 0; i < list.length; i++) if (list[i].from === ab[0] && list[i].to === ab[1]) return Number(list[i].calls || 0);
    return 0;
  }
  /**
   * 线宽：按**当前视图内的相对量级**映射到 1.4–3.8px。
   * ⚠ 绝对对数刻度会饱和：calls ≥ 100 就顶到上限，实测 8 条边（512–4820 次）全被算成一样粗，
   *   "粗细体现量级"就成了空话。相对刻度才让范围内的差异真的显示出来。
   */
  function edgeWidth(calls, minCalls, maxCalls) {
    var lmn = Math.log(1 + (minCalls || 0)), lmx = Math.log(1 + (maxCalls || 0));
    var r = (lmx > lmn) ? (Math.log(1 + (calls || 0)) - lmn) / (lmx - lmn) : 0.5;
    return Math.round((1.4 + 2.4 * r) * 100) / 100;
  }
  /**
   * 环检测：把 from→to 这条 A2A 接上后，会不会让 from 成为自己的下游？
   * 返回 {ok:true} 或 {ok:false, chain:[ids]} —— chain 是**环上的节点序列**。
   * 成熟做法（Lattice 的 CyclicOrgTreeError）不是笼统说"无效"，而是点名环从哪里开始：
   * 只报"不能这样连"，用户不知道是哪条链路绕回来了。
   */
  function anetCycleChain(from, to, h) {
    if (from === to) return [from, to];
    var adj = {};
    (APP && APP.a2aEdges ? APP.a2aEdges() : []).forEach(function (e) { (adj[e.from] = adj[e.from] || []).push(e.to); });
    var q = [[to]], seen = {};
    seen[to] = 1;
    while (q.length) {
      var path = q.shift(), last = path[path.length - 1];
      var nxt = adj[last] || [];
      for (var i = 0; i < nxt.length; i++) {
        if (nxt[i] === from) return path.concat([from]);       /* to → … → from ⇒ 接上 from→to 就成环 */
        if (!seen[nxt[i]]) { seen[nxt[i]] = 1; q.push(path.concat([nxt[i]])); }
      }
    }
    return null;
  }
  global.__anetCycleChain = anetCycleChain;      /* 测试缝：回归要在 Node 里直接验这条规则 */

  function key_manual(key) {
    var ab = key.split('>'), list = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
    for (var i = 0; i < list.length; i++) if (list[i].from === ab[0] && list[i].to === ab[1]) return !!list[i].manual;
    return false;
  }
  function _near(id) { return !_FOCUS || !!_NBR[id]; }

  /* ============================================================ SECTION: v26c-view
   * 视图变换（平移/缩放）+ 统一操作历史
   * ----------------------------------------------------------------------------
   * 视图是**纯显示状态**：不改布局、不改数据。做法是把画布内容包进 .anet-world，
   * 只对那一层加 CSS transform（translate + scale）——
   * 于是所有既有几何（收边、芯片避让、箭头、拖动换算）都还在"未变换的画布坐标"里，
   * 一处都不用改；需要反变换的只有"鼠标屏幕坐标 → 画布坐标"那几处（拖动、平移、缩放锚点）。
   *
   * 历史用**整份快照**而不是逆操作：四类边分别来自 data.js 的 A2A_EDGES、经验队列的 agents[]、
   * FACTS.TOPO 的节点表 —— 逆操作要按类型各写一套，写错一处就是"回退不干净"。
   * 快照只存**引用 + 浅拷贝**（几个 KB），换整份最稳，也最容易被核对。
   * ⚠ 经验类边只改到本页缓存（v24 的 experiences() 首次取到队列后一直复用）；
   *    经验库页面每次都重新现算队列，看不到这个改动 —— 界面里如实标注，不假装是全局生效。
   * ========================================================================== */
  var VIEW_MIN = 0.4, VIEW_MAX = 2.5, HIST_MAX = 60;

  function viewS(h) {
    var st = h.state;
    if (!st.agentNetView || typeof st.agentNetView !== 'object') st.agentNetView = { k: 1, tx: 0, ty: 0 };
    var v = st.agentNetView;
    if (!(v.k > 0)) v.k = 1;
    if (typeof v.tx !== 'number') v.tx = 0;
    if (typeof v.ty !== 'number') v.ty = 0;
    return v;
  }
  function clampK(k) { return Math.max(VIEW_MIN, Math.min(VIEW_MAX, k)); }
  function worldStyle(h) {
    var v = viewS(h);
    return 'transform:translate(' + r1(v.tx) + 'px,' + r1(v.ty) + 'px) scale(' + (Math.round(v.k * 1000) / 1000) +
      ');transform-origin:0 0';
  }

  /* ---- 关系源数据快照（引用 + 浅拷贝）---- */
  function snapRel() {
    return {
      a2a: (APP && APP.a2aEdges ? APP.a2aEdges() : []).slice(),
      exps: experiences().map(function (ex) {
        return { ex: ex, had: !!ex.agents, agents: (ex.agents || []).slice() };
      }),
      /* 组织架构视图里「横向拖到别的业务线列」改的是 a.biz，快照必须带上，否则撤销回不去 */
      bizs: S.AGENTS.map(function (a) { return { a: a, biz: a.biz }; }),
      /* 名字也要能回退：就地改名改的是 a.name / 业务线 name，撤销必须能还原 */
      names: S.AGENTS.map(function (a) { return { o: a, name: a.name }; })
        .concat(S.BIZ_LINES.map(function (b) { return { o: b, name: b.name }; })),
      topos: Object.keys(F.TOPO || {}).map(function (k) {
        return { arr: F.TOPO[k], nodes: (F.TOPO[k] || []).slice() };
      }),
      /* 编排模板的映射也要存：断 MCP 时是"复制专属模板 + 改指向"，
         只还原模板数组不还原指向，等于没回退 */
      topoMap: Object.keys(F.AGENT_TOPO || {}).map(function (k) { return { k: k, v: F.AGENT_TOPO[k] }; })
    };
  }
  function applyRel(snap) {
    if (!snap) return;
    var arr = (APP && APP.a2aEdges) ? APP.a2aEdges() : null;
    if (arr) { arr.length = 0; snap.a2a.forEach(function (e) { arr.push(e); }); }
    snap.exps.forEach(function (r) {
      if (r.had) {
        if (!r.ex.agents) r.ex.agents = [];
        r.ex.agents.length = 0;
        r.agents.forEach(function (id) { r.ex.agents.push(id); });
      } else if (r.ex.agents) { delete r.ex.agents; }
    });
    (snap.bizs || []).forEach(function (r) { r.a.biz = r.biz; });
    (snap.names || []).forEach(function (r) { r.o.name = r.name; });
    snap.topos.forEach(function (r) { r.arr.length = 0; r.nodes.forEach(function (n) { r.arr.push(n); }); });
    (snap.topoMap || []).forEach(function (r) { F.AGENT_TOPO[r.k] = r.v; });
  }

  function snapshot(h) {
    var v = viewS(h);
    var pos = {};
    Object.keys(h.state.agentNetPos || {}).forEach(function (k) {
      var p = h.state.agentNetPos[k];
      if (p) pos[k] = { x: p.x, y: p.y };
    });
    return { pos: pos, view: { k: v.k, tx: v.tx, ty: v.ty }, rel: snapRel(),
      /* 手动层级也是编辑结果：撤销/重做必须能把它一起带回，
         否则"撤销"只还了关系、层还留在用户摆的位置，两步就对不上。 */
      rowOv: Object.assign({}, h.state.anetRowOverride || {}) };
  }
  function restoreSnap(h, snap) {
    var pos = {};
    Object.keys(snap.pos || {}).forEach(function (k) { pos[k] = { x: snap.pos[k].x, y: snap.pos[k].y }; });
    h.state.agentNetPos = pos;
    global.__anetManual = pos;                     /* 拖动路径读的是它（整屏重渲染时坐标才不丢） */
    /* ⚠ **视图（缩放/平移）不进撤销**：页面进来会自动"适应窗口"（k 0.72），
       而初始快照是在 fit 之前拍的（k=1）—— 以前撤销一次就把画面放大回 1 倍，
       看着像"整张图突然跳了"。撤销是撤**内容**的，缩放不是内容。 */
    h.state.anetRowOverride = Object.assign({}, snap.rowOv || {});
    applyRel(snap.rel);
  }
  function histS(h) {
    var st = h.state;
    if (!st.agentNetHist || !st.agentNetHist.steps || !st.agentNetHist.steps.length) {
      st.agentNetHist = {
        steps: [{ id: 'h0', at: Date.now(), label: '自动布局（初始）', kind: 'init', snap: snapshot(h) }],
        cur: 0
      };
    }
    var H = st.agentNetHist;
    if (H.cur == null || H.cur < 0 || H.cur >= H.steps.length) H.cur = H.steps.length - 1;
    return H;
  }
  /* 记一步：新动作会截断"未来"分支（与所有编辑器一致：撤销后再操作，redo 链作废） */
  function pushStep(h, label, kind) {
    var H = histS(h);
    H.steps = H.steps.slice(0, H.cur + 1);
    H.steps.push({
      id: 'h' + H.steps.length + '-' + Date.now().toString(36),
      at: Date.now(), label: label, kind: kind || 'edit', snap: snapshot(h)
    });
    if (H.steps.length > HIST_MAX) { H.steps.splice(1, 1); }
    H.cur = H.steps.length - 1;
    return H;
  }
  /* 连续同类小动作（方向键连按）合并成一步，否则一次微调就刷十几条历史 */
  function pushStepCoalesce(h, label, kind, key, gapMs) {
    var H = histS(h);
    var last = H.steps[H.cur];
    if (last && last.kind === kind && last.key === key && (Date.now() - last.at) < (gapMs || 1500)) {
      last.at = Date.now();
      last.label = label;
      last.snap = snapshot(h);                     /* 覆盖成最新状态：撤销回到"这一串"之前 */
      return H;
    }
    var out = pushStep(h, label, kind);
    H.steps[H.cur].key = key;
    return out;
  }
  function goStep(h, i) {
    var H = histS(h);
    var t = Math.max(0, Math.min(H.steps.length - 1, i));
    if (t === H.cur) return false;
    restoreSnap(h, H.steps[t].snap);
    H.cur = t;
    return true;
  }

  function zoomTo(h, k, anchorX, anchorY) {
    var v = viewS(h);
    var nk = clampK(k);
    if (Math.abs(nk - v.k) < 1e-4) return false;
    /* 以锚点为中心缩放：锚点下方那个"世界坐标"缩放前后必须停在原地 */
    var f = nk / v.k;
    v.tx = anchorX - f * (anchorX - v.tx);
    v.ty = anchorY - f * (anchorY - v.ty);
    v.k = nk;
    return true;
  }

  /* ============================================================ SECTION: v26c-rels
   * 关系变更：把一条边"真断开"要改哪份数据
   * ----------------------------------------------------------------------------
   * 四类边的来源各不相同（见 edge-builders），所以"断开"必须按类型各写一份 ——
   * 这也是为什么变更要配**整份快照**：逆操作散在四处，靠快照兜底才不会出现"回退不干净"。
   *   a2a      → data.js 的 A2A 边表（全站共享，删了别处也变）
   *   exp      → 经验对象的 agents[]（⚠ 经验队列每次现算，只改到本页缓存）
   *   conflict → 由 experiences 的 agents[] 派生，跟着 exp 一起解
   *   mcp      → F.TOPO 的编排模板节点表；模板是共用的，所以先**复制一份专属模板**再删节点，
   *              这样不会连带影响同模板的其它 Agent
   * ========================================================================== */
  function planDetach(h, id) {
    var rules = stateRules(h.state);
    var patches = [], blocked = [];
    if (rules.a2a && APP && APP.a2aEdges) {
      var arr = APP.a2aEdges() || [];
      arr.filter(function (e) { return e.from === id || e.to === id; }).forEach(function (e) {
        patches.push({
          type: 'a2a', typeLabel: 'A2A 委派',
          detail: aName(e.from) + ' → ' + aName(e.to) + '（技能 ' + (e.skill || '—') + '）',
          verify: 'Agent 详情 ·「引用与依赖」的 A2A 卡片',
          apply: function () { var i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1); }
        });
      });
    }
    if (rules.exp) {
      experiences().forEach(function (ex) {
        var ids = ex.agents || [];
        if (ids.indexOf(id) < 0) return;
        patches.push({
          type: 'exp', typeLabel: '共用经验',
          detail: '《' + ex.title + '》把它从采纳名单里移除（' + ids.length + ' → ' + (ids.length - 1) + ' 个 Agent 采纳）',
          verify: '经验库 · 该条经验的「被哪些 Agent 采纳」',
          warn: '改动只在本次会话生效，经验库里的采纳名单不变',
          apply: function () { var i = ex.agents.indexOf(id); if (i >= 0) ex.agents.splice(i, 1); }
        });
      });
    }
    if (rules.mcp) {
      var tplKey = F.AGENT_TOPO ? F.AGENT_TOPO[id] : null;
      var tpl = (tplKey && F.TOPO) ? F.TOPO[tplKey] : null;
      if (tpl) {
        var seen = {};
        tpl.forEach(function (n) { if (n && n.mcp && !seen[n.mcp]) seen[n.mcp] = 1; });
        Object.keys(seen).forEach(function (mid) {
          var siblings = S.AGENTS.filter(function (x) { return x.id !== id && F.AGENT_TOPO[x.id] === tplKey; });
          patches.push({
            type: 'mcp', typeLabel: '共用 MCP 工具',
            detail: '复制专属编排模板并从副本里去掉 ' + mid + (siblings.length ? '（原模板还有 ' + siblings.length + ' 个 Agent 共用，它们不受影响）' : ''),
            verify: '网关 · 该 MCP 服务 / Agent 编排',
            apply: function () {
              var key2 = String(tplKey) + '-only-' + id;
              if (!F.TOPO[key2]) {
                var src = F.TOPO[F.AGENT_TOPO[id]] || [];
                var copy = src.map(function (n) { return Object.assign({}, n); }).filter(function (n) { return !(n && n.mcp === mid); });
                F.TOPO[key2] = copy;
              }
              F.AGENT_TOPO[id] = key2;
            }
          });
        });
      }
    }
    return { patches: patches, blocked: blocked, rules: rules };
  }

  /** 当前口径下这个 Agent 的直接联系（用于"断的是哪些"的确认层） */
  function curEdgesOf(h, id) {
    var g = buildGraph(h.state);
    return g.edges.filter(function (e) { return e.a === id || e.b === id; });
  }

  /* ---- C 批：手动删一条边 / 手动加一条边（都改真实数据）---- */
  /* 删单条边：按类型找到"这条边为什么存在"，把它拆掉。
     ⚠ 经验/冲突两类是**团**：一条边由"N 个 Agent 共用同一条经验"派生，
       摘掉一个 Agent 会同时断掉它与另外 N-2 个的所有边 —— 这一点必须在确认层写清楚，
       否则用户以为只删了一条线，实际断了一片。 */
  function planEdgeDelete(h, e) {
    var patches = [], blocked = [];
    if (!e) return { patches: patches, blocked: blocked };
    if (e.type === 'a2a') {
      var arr = (APP && APP.a2aEdges) ? APP.a2aEdges() : [];
      var hit = arr.filter(function (x) { return x.from === e.a && x.to === e.b; })[0] ||
        arr.filter(function (x) { return x.from === e.b && x.to === e.a; })[0];
      if (hit) {
        patches.push({
          type: 'a2a', typeLabel: 'A2A 委派',
          detail: aName(hit.from) + ' → ' + aName(hit.to) + (hit.manual ? '（人工新增的那条）' : '（技能 ' + hit.skill + '）'),
          verify: 'Agent 详情 ·「引用与依赖」的 A2A 卡片',
          apply: function () { var i = arr.indexOf(hit); if (i >= 0) arr.splice(i, 1); }
        });
      }
    } else if (e.type === 'exp' || e.type === 'conflict') {
      experiences().forEach(function (ex) {
        var ids = ex.agents || [];
        if (ids.indexOf(e.a) < 0 || ids.indexOf(e.b) < 0) return;
        var others = ids.filter(function (x) { return x !== e.a && x !== e.b; });
        patches.push({
          type: 'exp', typeLabel: e.type === 'conflict' ? '经验冲突（随经验解）' : '共用经验',
          detail: '《' + ex.title + '》移除「' + aName(e.a) + '」：这条边断开' +
            (others.length ? '，同时会断开它与 ' + others.map(aName).join('、') + ' 的 ' + others.length + ' 条边' : ''),
          verify: '经验库 · 该条经验的「被哪些 Agent 采纳」',
          warn: others.length ? '这条经验被 N 个 Agent 共用：摘掉它就同时断开这些 Agent' : '',
          apply: function () { var i = ex.agents.indexOf(e.a); if (i >= 0) ex.agents.splice(i, 1); }
        });
      });
    } else if (e.type === 'mcp') {
      var mid = null;
      var tplK = F.AGENT_TOPO ? F.AGENT_TOPO[e.a] : null;
      var tpl0 = (tplK && F.TOPO) ? F.TOPO[tplK] : [];
      var aMcp = {}, bMcp = {};
      tpl0.forEach(function (n) { if (n && n.mcp) aMcp[n.mcp] = 1; });
      ((F.TOPO[F.AGENT_TOPO[e.b]] || [])).forEach(function (n) { if (n && n.mcp) bMcp[n.mcp] = 1; });
      Object.keys(aMcp).forEach(function (k) { if (bMcp[k] && !mid) mid = k; });
      if (mid) {
        patches.push({
          type: 'mcp', typeLabel: '共用 MCP 工具',
          detail: '复制「' + aName(e.a) + '」的专属编排模板并去掉 ' + mid + '（共用模板不动）',
          verify: '网关 · 该 MCP 服务 / Agent 编排',
          apply: function () {
            var key2 = String(F.AGENT_TOPO[e.a]) + '-only-' + e.a;
            if (!F.TOPO[key2]) {
              var src = F.TOPO[F.AGENT_TOPO[e.a]] || [];
              F.TOPO[key2] = src.map(function (n) { return Object.assign({}, n); }).filter(function (n) { return !(n && n.mcp === mid); });
            }
            F.AGENT_TOPO[e.a] = key2;
          }
        });
      }
    }
    return { patches: patches, blocked: blocked };
  }
  ACTIONS['anet-edge-del'] = function (id, btn, h) {
    var it = _GEO[id];
    if (!it) { h.toast('这条边已经不在当前视图里了', 'info'); return; }
    var e = it.e;
    var plan = planEdgeDelete(h, e);
    if (!plan.patches.length) {
      h.toast(plan.blocked.length ? plan.blocked[0].why : '这条边不是可编辑的类型', 'info');
      return;
    }
    var impacts = plan.patches.map(function (p) { return { label: p.typeLabel, value: p.detail, tone: 'warn' }; });
    plan.patches.forEach(function (p) { if (p.warn) impacts.push({ label: '注意', value: p.warn, tone: 'danger' }); });
    impacts.push({ label: '类型', value: TYPE_LABEL[e.type] || e.type });
    impacts.push({ label: '可还原', value: '是 —— 历史里可回退（Ctrl+Z）' });
    h.dangerConfirm(h, {
      title: '删除这条边？',
      desc: '删的是**真实数据**里让这条边成立的那一项，不是只把它藏起来。',
      tone: 'danger', perm: 'agent:rel:detach', confirmText: '确认删除',
      impacts: impacts,
      onConfirm: function (reason) {
        var done = 0;
        plan.patches.forEach(function (p) { try { p.apply(); done++; } catch (err) { if (global.console) global.console.error(err); } });
        pushStep(h, '删除一条 ' + (TYPE_LABEL[e.type] || e.type) + '（' + aName(e.a) + ' ↔ ' + aName(e.b) + '）', 'rel-del');
        h.toast('已删除 · ' + done + ' 项数据改动 · Ctrl+Z 可还原', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* 手动加一条边：A2A 直接写进边表；共用经验 = 让源 Agent 采纳一条目标 Agent 已在用的经验 */
  ACTIONS['anet-link-open'] = function (id, btn, h) {
    /* id 允许是 "源|预选目标"：从画布上把卡片拖到另一张卡上松手时，
       落点那张卡要直接预选好 —— 否则用户拖了半天，表单还让他从头选一遍目标。 */
    var parts = String(id).split('|');
    var src = parts[0], pre = parts[1] || null;
    if (pre && (pre === src || !aOf(pre))) pre = null;
    var a = aOf(src);
    if (!a) return;
    var g = buildGraph(h.state);
    var others = Object.keys(g.deg).filter(function (x) { return x !== src; });
    if (pre && others.indexOf(pre) < 0) pre = null;
    if (!others.length) { h.toast('当前口径下没有别的 Agent 可连', 'info'); return; }
    global.V10UI.openSheet({
      title: '给「' + a.name + '」新增一条联系',
      bodyHtml: '<div class="v10-sheet-desc">人工新增的关系会写进真实数据（会话内），并在关系明细里带 <b>人工</b> 标记 ——' +
        '出处会写清是谁、为什么加的。</div>' +
        '<label class="sub-h" style="display:block;margin-top:10px">关系类型</label>' +
        '<select id="anet-lk-type" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px">' +
        '<option value="a2a">A2A 委派（有方向：它 → 目标）</option>' +
        '<option value="exp">共用经验（它开始采纳一条目标已在用的经验）</option></select>' +
        '<label class="sub-h" style="display:block;margin-top:10px">目标 Agent</label>' +
        '<select id="anet-lk-to" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px">' +
        others.map(function (x) { return '<option value="' + h.esc(x) + '"' + (x === pre ? ' selected' : '') + '>' +
          h.esc(aName(x)) + '（' + h.esc(aBiz(x)) + '）' + (x === pre ? ' · 你拖到的就是它' : '') + '</option>'; }).join('') +
        '</select>' +
        '<div id="anet-lk-a2a"><label class="sub-h" style="display:block;margin-top:10px">委派技能名（会写进 A2A 边的 skill）</label>' +
        '<input id="anet-lk-skill" placeholder="例如：合同条款初审" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px"></div>' +
        '<div id="anet-lk-exp" style="display:none"><label class="sub-h" style="display:block;margin-top:10px">选一条目标已在用、它还没采纳的经验</label>' +
        '<select id="anet-lk-pick" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px"></select>' +
        '<div class="bt-note" id="anet-lk-exp-note" style="margin-top:6px"></div></div>' +
        '<label class="sub-h" style="display:block;margin-top:10px">理由（选填）</label>' +
        '<textarea id="anet-lk-reason" placeholder="例如：招标流程要求合同先过初审，已在流程里生效" ' +
        'style="width:100%;height:56px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></textarea>' +
        '<div class="err" id="anet-lk-err" style="display:none">理由必填</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-act="anet-link-ok" data-id="' + h.esc(src) + '">新增联系</button>',
      onOpen: function (root) {
        var typeEl = root.querySelector('#anet-lk-type');
        var toEl = root.querySelector('#anet-lk-to');
        var pickEl = root.querySelector('#anet-lk-pick');
        var noteEl = root.querySelector('#anet-lk-exp-note');
        function expCands() {
          var to = toEl.value;
          return experiences().filter(function (ex) {
            var ids = ex.agents || [];
            return ids.indexOf(to) >= 0 && ids.indexOf(id) < 0;
          });
        }
        function sync() {
          var isExp = typeEl.value === 'exp';
          root.querySelector('#anet-lk-a2a').style.display = isExp ? 'none' : '';
          root.querySelector('#anet-lk-exp').style.display = isExp ? '' : 'none';
          if (!isExp) return;
          var cands = expCands();
          if (!pickEl) return;
          pickEl.innerHTML = cands.length
            ? cands.map(function (ex) { return '<option value="' + h.esc(ex.id) + '">《' + h.esc(ex.title) + '》 · 已 ' + (ex.agents || []).length + ' 个 Agent 采纳</option>'; }).join('')
            : '<option value="">（目标没有任何"它还没采纳"的经验）</option>';
          if (noteEl) noteEl.textContent = cands.length
            ? '采纳后它与' + '该经验覆盖的每个 Agent' + '都产生一条共用经验边 —— 这是经验的语义，不是只连目标一个。'
            : '换一个目标，或先去经验库给目标登记经验。';
        }
        if (typeEl) typeEl.addEventListener('change', sync);
        if (toEl) toEl.addEventListener('change', sync);
        sync();
      }
    });
  };
  /* A2A 建边前先查环。Lattice 的 CyclicOrgTreeError 会点名"环从谁开始"，
     只报"不能这样连"用户不知道是哪条链路绕回来了。 */
  function anetLinkGuard(from, to, h) {
    var chain = anetCycleChain(from, to, h);
    if (!chain) return true;
    h.toast('不能这样连：会让「' + aName(from) + '」成为自己的下游 —— ' +
      chain.map(aName).join(' → ') + '（改层级请直接调委派关系，不要绕回来）', 'bad');
    return false;
  }
  global.__anetLinkGuard = anetLinkGuard;

  ACTIONS['anet-link-ok'] = function (id, btn, h) {
    var root = global.document.querySelector('.v10-sheet');
    function val(sel) { var el = root && root.querySelector(sel); return el ? String(el.value || '').trim() : ''; }
    var type = val('#anet-lk-type') || 'a2a';
    var to = val('#anet-lk-to');
    var reason = val('#anet-lk-reason');
    var skill = val('#anet-lk-skill');
    /* 2026-10-21：理由改选填，不再拦提交 */
    if (!to || to === id) { h.toast('目标 Agent 不合法', 'bad'); return; }
    var by = (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : ((S.ME && S.ME.name) || '我');

    if (type === 'a2a') {
      if (!skill) { h.toast('A2A 委派要写清技能名（否则这条边没有"办什么"）', 'warn'); return; }
      var arr = APP.a2aEdges();
      if (arr.some(function (x) { return x.from === id && x.to === to; })) { h.toast('这条 A2A 边已经存在', 'warn'); return; }
      arr.push({
        id: 'a2a-manual-' + Date.now().toString(36), from: id, to: to, skill: skill,
        task: 'working', calls: null, fail: null, p99: null, why: reason,
        manual: true, by: by, reason: reason
      });
      global.V10UI.closeSheet();
      pushStep(h, '人工新增 A2A：' + aName(id) + ' → ' + aName(to), 'rel-add');
      h.toast('已新增（人工标记） · 数据写在 A2A 边表 · Ctrl+Z 可还原', 'ok');
      h.navigate({}, { scroll: false });
      return;
    }
    /* 共用经验：把源 Agent 加进那条经验的 agents[] */
    var pick = val('#anet-lk-pick');
    var ex = experiences().filter(function (x) { return x.id === pick; })[0];
    if (!ex) { h.toast('选中的经验不存在（换个目标试试）', 'bad'); return; }
    if ((ex.agents || []).indexOf(id) >= 0) { h.toast('它已经采纳了这条经验', 'warn'); return; }
    if (!ex.agents) ex.agents = [];
    ex.agents.push(id);
    global.V10UI.closeSheet();
    pushStep(h, '人工新增共用经验：《' + ex.title + '》+ ' + aName(id), 'rel-add');
    h.toast('已把「' + aName(id) + '」加进《' + ex.title + '》的采纳名单 · Ctrl+Z 可还原', 'ok');
    h.navigate({}, { scroll: false });
  };


  /* ── 边的几何：初始渲染与拖动重绘**共用同一份实现**（v26b 收口）──────────
     这三段原本是 canvasHtml 里的闭包，而 anetDrag 的 redraw 把同样的收边与芯片避让
     **又抄了一遍** —— 两处一旦改口径就会分叉（"改一处漏第二份"是这个文件反复出现的
     bug 类型）。改成接受"当前坐标表"的模块级纯函数：
       · 初始渲染传 lay.pos；
       · 拖动传拖动中的实时坐标。
     两个轴各按各的口径：x 用 tileHalfX()（随画布真实宽变），y 用 tileHalfY()（1 单位 = 1px）。 */

  /* 芯片不能压节点：沿边扫描，在中点附近左右各试若干偏移，取第一个四周都不碰节点框的位置。
     分辨率 2 单位，足够且不至于让芯片离中点太远。
     已放下的芯片也算障碍 —— 否则两条边的中点靠近时两个芯片会叠在一起（实测 1 处）。 */
  function cardData() {
    if (_CARD_BY_ID) return _CARD_BY_ID;
    _CARD_BY_ID = {};
    try {
      (Q.agentTable('24h').rows || []).forEach(function (r) { _CARD_BY_ID[r.id] = r; });
    } catch (e) { /* 取不到就退回基本信息，不让整页挂掉 */ }
    return _CARD_BY_ID;
  }

  /** 群里最近的两个节点中心距（环的弧长够、弦长不一定够 —— 椭圆两端被压扁处弦最短） */
  function r1(n) { return Math.round(n * 10) / 10; }
  function px(x, h) { return r1(x / CANVAS_W * 100) + '%'; }
  function py(y, h) { return r1(y / h * 100) + '%'; }

  /** 有向边（A2A）的箭头。
      v26b：端点从"节点中心"改成**收边到卡片边缘**之后，箭头再回退 92 单位就会飘在
      离卡片 40–50px 的半空（92 是按 chip 节点的 150px 宽标的，磁贴只有 118px）——
      现在箭头就落在收边端点上。
      另外 viewBox 是 preserveAspectRatio="none"：x 方向的偏移要按 _SCALE 反算，
      否则横向边上的箭头会被拉成扁三角（线与箭头本来就不等比）。 */
  function arrowPoints(a1, a2) {
    var dx = a2.x - a1.x, dy = a2.y - a1.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 14) return '';
    var ux = dx / len, uy = dy / len, s = _SCALE || 1;
    var L = 11, W = 5.5;
    var tipX = a2.x, tipY = a2.y;
    var bx = tipX - ux * L / s, by = tipY - uy * L;
    var nx = -uy / s, ny = ux;
    return r1(tipX) + ',' + r1(tipY) + ' ' + r1(bx + nx * W) + ',' + r1(by + ny * W) + ' ' + r1(bx - nx * W) + ',' + r1(by - ny * W);
  }
  function arrowSvg(ei, a1, a2) {
    var pts = arrowPoints(a1, a2);
    return pts ? '<polygon class="anet-arrow t-a2a" data-ei="' + ei + '" points="' + pts + '"/>' : '';
  }

  /* SECTION: render */
  function tabsHtml(h, active, g) {
    var T = [
      { id: 'list', label: 'Agent 列表' },
      { id: 'net', label: '网状关系', badge: g.isolated.length }
    ];
    return '<div class="tabs" role="tablist">' + T.map(function (t) {
      var tip = t.id === 'net'
        ? (g.isolated.length ? g.isolated.length + ' 个 Agent 跟谁都没有连线' : '没有孤立的 Agent')
        : '卡片 / 表格两种视图的 Agent 清单';
      return '<button role="tab" class="tab' + (t.id === active ? ' on' : '') + '" data-act="agentw-tab" data-id="' + t.id + '"' +
        ' data-tip="' + h.esc(tip) + '"' + (t.id === active ? ' aria-selected="true"' : ' aria-selected="false"') + '>' + h.esc(t.label) +
        (t.id === 'net' && t.badge ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function metricsHtml(g, h) {
    var t = g.total || 1;
    return '<div class="metrics">' + [
      {
        label: 'Agent 总数', value: String(g.total),
        sub: (g.retired ? g.retired + ' 个已下线 · ' : '') + '全部纳入计算，下线不等于关系消失',
        definition: '数据源为 Agent 资产表全量（含已下线 —— 下线不等于关系消失，历史引用仍需可见）'
      },
      {
        label: '有关联', value: String(g.connected),
        sub: '占 ' + pct1(g.connected / t) + ' · 分属 ' + g.linked.length + ' 个关系群',
        definition: '在当前口径下至少有一条边的 Agent 数；关系群 = 图的连通分量'
      },
      {
        label: '孤立隔离', value: String(g.isolated.length), alert: g.isolated.length > 0,
        sub: g.isolated.length ? '一条联系都没有' : '没有孤立的 Agent',
        act: 'agentw-iso', actId: '1', actTitle: '定位到左侧隔离区',
        definition: '当前口径下一条联系都没有的 Agent；切换口径后这个数字会变'
      },
      {
        label: '关系边', value: String(g.edges.length),
        sub: RULES.filter(function (r) { return g.rules[r.id]; }).map(function (r) { return r.label + ' ' + (g.byType[r.id] || 0); }).join(' · ') || '未启用任何口径',
        definition: '当前启用的口径下、去重后的直接联系条数（同一对 Agent 的同类关系只计一条）'
      }
    ].map(h.metricCard).join('') + '</div>';
  }

  function rulesCard(g, h) {
    /* Filter 降噪（v25c）—— 依据 SkyWalking Horizon UI 的拓扑 Filter：
       真实拓扑很吵，要能把「解析不出来的对端 / 当前口径下无边」的对象**一键关掉**，
       但不影响真实依赖的显示。这里是「隔离区」这一项。 */
    var isoOn = h.state.agentNetIso !== false;   /* 默认显示 */
    return '<div class="card"><div class="card-h"><h3>关系口径</h3>' +
      '<span class="card-sub">切换后关系图与隔离区实时重算</span></div>' +
      '<div class="chips">' + RULES.map(function (r) {
        var on = !!g.rules[r.id], n = g.byType[r.id] || 0;
        return '<button class="chip link' + (on ? ' on' : '') + '" data-act="agentw-rel" data-id="' + r.id + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '" data-tip="' + h.esc(r.desc) + '">' +
          '<i class="anet-dot t-' + r.id + '"></i>' + h.esc(r.label) + ' <b>' + n + '</b></button>';
      }).join('') +
      /* 降噪开关：与规则 chips 同一行，但语义不同（前者改口径，这个只改显示） */
      '<button class="chip link' + (isoOn ? ' on' : '') + '" data-act="agentw-isotoggle" ' +
        'aria-pressed="' + (isoOn ? 'true' : 'false') + '"' +
        ' data-tip="关掉后不显示隔离区 —— 只影响显示，不改变口径与关系总数">' +
        '隔离区 <b>' + ((g.isolated || []).length) + '</b>' + (isoOn ? ' 显示中' : ' 已隐藏') + '</button>' +
      '</div>' +
      '<div class="anet-legend">' + RULES.map(function (r) {
        return '<span><i class="t-' + r.id + '"></i>' + h.esc(r.label) + '</span>';
      }).join('') +
      '<span class="muted">线只表示「有一条直接联系」，粗细长短不代表强弱</span></div></div>';
  }

  /* ============================================================ SECTION: org-render
   * 渲染组织架构 × 流程。背景层（列底纹、部门框、根、母线、层号条、连线和标签）走 SVG，
   * 卡片走 HTML 按钮（复用现网 .anet-tile，健康边框/图标/指标都还在）。
   * 世界层是**自然尺寸**（W×H 像素）—— 连线和卡片同一坐标系，不需要任何单位换算。
   * ========================================================================== */
  var _L = null, _DEG = {}, _SCALE = 1, _FOCUS = null, _NBR = {}, _CONTENT_BB = null, _GEO = {}, _CARD_BY_ID = null;
  /* 纯按委派推导出来的层（不含用户手摆的覆盖值）—— 只用于提示文案：
     "手动指定，按委派应在第 N 层"，让用户一眼看出自己把它挪了几层。 */
  var _AUTOROW = {};
  /* "这一层确实是用户改过的"：覆盖值 == 推导值等于没改（比如把卡拖回原位再松手），
     不该在卡片上留「层级手动」，也不该占一个"恢复层级"按钮的名额。 */
  function rowManual(h, id) {
    var ov = (h && h.state && h.state.anetRowOverride) || {};
    if (ov[id] == null) return null;
    if (_AUTOROW[id] != null && ov[id] === _AUTOROW[id]) return null;
    return ov[id];
  }
  function manualRowCount(h) {
    var ov = (h && h.state && h.state.anetRowOverride) || {};
    return Object.keys(ov).filter(function (id) { return rowManual(h, id) != null; }).length;
  }

  function pxv(x) { return r1(x) + 'px'; }

  /** 背景层 SVG：底纹 → 母线 → 层号条 → 连线 → 标签（标签最后画，免得被线穿过） */
  function azBgSvg(L, g, h) {
    var s = '';
    /* 列底纹（归属靠它表达，不给卡片连线）
       底边只多留 12：卡片下方那行小字 2026-10-28 已按业主要求删除，不需要再为它预留。 */
    L.cols.forEach(function (c) {
      s += '<rect x="' + r1(c.x - 13) + '" y="' + (AZ.Y_BIZ + AZ.BIZ_H + 12) + '" width="' + r1(c.w + 26) +
        '" height="' + r1(L.rowBottom - (AZ.Y_BIZ + AZ.BIZ_H + 12) + 12) + '" rx="12" class="anet-lane"/>';
    });
    /* 根 + 直角母线 */
    var bus = AZ.Y_ROOT + AZ.ROOT_H + 22;
    s += '<rect x="' + r1(L.rootCx - (L.rootW || AZ.ROOT_W) / 2) + '" y="' + AZ.Y_ROOT + '" width="' + (L.rootW || AZ.ROOT_W) +
      '" height="' + AZ.ROOT_H + '" rx="10" class="anet-root"/>';
    s += '<line class="anet-bus" x1="' + r1(L.rootCx) + '" y1="' + (AZ.Y_ROOT + AZ.ROOT_H) + '" x2="' + r1(L.rootCx) + '" y2="' + bus + '"/>';
    if (L.cxs.length > 1) s += '<line class="anet-bus" x1="' + r1(L.cxs[0]) + '" y1="' + bus + '" x2="' + r1(L.cxs[L.cxs.length - 1]) + '" y2="' + bus + '"/>';
    L.cols.forEach(function (c, i) {
      s += '<line class="anet-bus" x1="' + r1(L.cxs[i]) + '" y1="' + bus + '" x2="' + r1(L.cxs[i]) + '" y2="' + AZ.Y_BIZ + '"/>';
      s += '<rect x="' + r1(L.cxs[i] - (L.bizW || AZ.BIZ_W) / 2) + '" y="' + AZ.Y_BIZ + '" width="' + (L.bizW || AZ.BIZ_W) + '" height="' + AZ.BIZ_H +
        '" rx="8" class="anet-biz"/>';
    });
    /* 层号条 */
    var sy = L.yRow[L.rows[0]] - 12;
    s += '<rect x="' + r1(L.rowStripL) + '" y="' + r1(sy) + '" width="' + (AZ.ROW_LAB_W - 14) +
      '" height="' + r1(L.rowBottom + 12 - sy) + '" rx="10" class="anet-rowstrip"/>';
    L.rows.forEach(function (r, k) {
      if (k) {
        /* 行分隔线落在两行卡片的正中：行高现在是全图统一的 rowPitch，不能再用 ROWGAP 估 */
        var ys = L.yRow[r] - ((L.rowPitch || (AZ.CH + AZ.TAG_DY + 4 + AZ.ROWGAP)) - AZ.CH) / 2;
        s += '<line class="anet-rowsep" x1="' + r1(L.rowStripL + 8) + '" y1="' + r1(ys) + '" x2="' + r1(L.rowStripL + AZ.ROW_LAB_W - 22) + '" y2="' + r1(ys) + '"/>';
      }
    });
    /* 图标外环 = 失败占比（Grafana 节点 arc__* 的等价物）：
       占比用环形分段表达，比"99.2% · 1.8s"一眼 —— 环上的红色部分就是失败份额。 */
    var rb = cardData();
    L.cards.concat(L.isoCards || []).forEach(function (c) {
      var cd = rb[c.id] || {};
      var sr = cd.successRate;
      if (sr == null || sr >= 1) return;
      var rr = 21, C = 2 * Math.PI * rr, errLen = C * Math.min(1, Math.max(0, 1 - sr));
      s += '<circle class="anet-arc" cx="' + r1(c.x) + '" cy="' + r1(c.y - AZ.CH / 2 + 26) + '" r="' + rr +
        '" stroke-dasharray="' + r1(errLen) + ' ' + r1(C - errLen) + '" transform="rotate(-90 ' +
        r1(c.x) + ' ' + r1(c.y - AZ.CH / 2 + 26) + ')"/>';
    });
    /* 连线（含 10px 宽的透明命中线，右键/点击用） */
    L.edges.forEach(function (e) {
      var ab = e.segs, d = '';
      for (var i = 0; i < ab.length; i++) d += (i ? 'L' : 'M') + r1(ab[i][0]) + ',' + r1(ab[i][1]) +
        'L' + r1(ab[i][2]) + ',' + r1(ab[i][3]);
      s += '<path class="anet-flow' + (e.manual ? ' manual' : '') + (h.state.agentNetFocus && !(_near(e.a) && _near(e.b)) ? ' far' : '') +
        '" stroke-width="' + (e.width || 1.6) + '" d="' + d + '" data-e="' + h.esc(e.a + '>' + e.b) + '"/>';
      s += '<path class="anet-flowhit" d="' + d + '" data-e="' + h.esc(e.a + '>' + e.b) + '"/>';
      /* 箭头按 dir 翻转：up = 尖端朝上（线从下方进卡），down = 尖端朝下（线从上方进卡） */
      var ab = (e.arrow && e.arrow.dir === 'up') ? 5 : -5;
      s += '<polygon class="anet-flowarrow" points="' + r1(e.arrow.x) + ',' + r1(e.arrow.y) + ' ' +
        r1(e.arrow.x - 3.6) + ',' + r1(e.arrow.y + ab) + ' ' + r1(e.arrow.x + 3.6) + ',' + r1(e.arrow.y + ab) + '"/>';
    });
    /* 边的标签 */
    if (L.labelMode !== 'off') {
      L.edges.forEach(function (e) {
        s += '<g class="anet-flowlab-g" data-e="' + h.esc(e.a + '>' + e.b) + '">';
        s += '<rect class="anet-flowlab" x="' + r1(e.label.x) + '" y="' + r1(e.label.y - 7) + '" width="' + r1(e.label.w) +
          '" height="14" rx="7"/>';
        s += '<text class="anet-flowlabt" x="' + r1(e.label.tx) + '" y="' + r1(e.label.y) + '" text-anchor="' + e.label.anchor +
          '">' + h.esc(e.label.text) + '</text></g>';
      });
    }
    return s;
  }

  /* 健康判据：**只在这里定义一处** —— 卡片边框、数字染色、图例说明全取它。
     「错」和「慢」分两个档：正常 / 关注（琥珀）/ 异常（红）。
     ⚠ 99% 不是分界线：98.x% 在业务上还叫"能用"，只有掉到 97% 以下才值得停手。 */
  var HEALTH = { srWarn: 0.99, srBad: 0.97, p99Warn: 4000, p99Bad: 8000 };

  /** 卡片（HTML 按钮，绝对像素定位；.anet-tile 的结构与现网一致） */
  function azCardHtml(a, c, h, iso) {
    var card = cardData()[a.id] || {};
    var retired = a.retiredAt !== undefined;
    /* ── 健康判据（2026-10-28 改）────────────────────────────────────────────
       原来一条线：成功率 < 99% **或** P99 > 4s 就算"异常"，红框一刀切。结果 9 张卡
       4 张红 —— 售前咨询 98.8% 和合同初审 13.86s 是两种完全不同的病，却同一个颜色，
       扫一眼像"全线出事"，红色就此失效。
       现在：错和慢**分开判**，各自一个档位，边框取两者中更严重的那个；
       哪一项的数字变色，就是哪一维出事（成功率变色 = 答错，P99 变色 = 答慢）。
       ⚠ 档位优先取 query.js 已经算好的 card.severity（ok/warn/bad），
       跨屏口径必须同源 —— 这里只保留一份**同阈值的**本地兜底，不另立标准。 */
    var srIss = (card.successRate == null) ? 0
      : (card.successRate < HEALTH.srBad ? 2 : (card.successRate < HEALTH.srWarn ? 1 : 0));
    var p99Iss = (card.p99 == null) ? 0
      : (card.p99 > HEALTH.p99Bad ? 2 : (card.p99 > HEALTH.p99Warn ? 1 : 0));
    var sev = (card.severity === 'bad' || card.severity === 'warn' || card.severity === 'ok')
      ? card.severity : (Math.max(srIss, p99Iss) === 2 ? 'bad' : (Math.max(srIss, p99Iss) === 1 ? 'warn' : 'ok'));
    var health = retired || a.status === 'offline' ? 'off'
      : (sev === 'bad' ? 'bad' : (sev === 'warn' ? 'warn' : (a.status === 'gray' ? 'gray' : 'ok')));
    /* 隔离区卡片不参与聚焦淡化：它不在聚焦图里是常态，不该看起来像被禁用 */
    var isFocus = (_FOCUS === a.id), dim = !!(_FOCUS && !_near(a.id) && !iso);
    var deg = _DEG[a.id] || 0;
    var tip = a.name + '\n' + (a.desc || '') + '\n版本 ' + (a.online || '—') +
      ' · ' + aBiz(a.id) + '\n调用 ' + (card.calls == null ? '—' : h.fmt.compact(card.calls)) +
      ' · 成功率 ' + (card.successRate == null ? '—' : h.fmt.pct2(card.successRate)) +
      ' · P99 ' + (card.p99 == null ? '—' : h.fmt.dur(card.p99)) + '\n当前口径下 ' + deg + ' 条联系 · 第 ' + c.row + ' 层' +
      (rowManual(h, a.id) != null ? '（手动指定，按委派应在第 ' + (_AUTOROW[a.id] == null ? '?' : _AUTOROW[a.id]) + ' 层）' : '');
    return '<button class="anet-tile ' + health + (iso ? ' iso' : '') + (isFocus ? ' focus' : '') + (dim ? ' dim' : '') +
      '" style="left:' + pxv(c.x) + ';top:' + pxv(c.y) + '"' +
      ' data-act="net-focus" data-id="' + h.esc(a.id) + '" data-x="' + r1(c.x) + '" data-y="' + r1(c.y) + '"' +
      ' data-biz="' + h.esc(a.biz) + '" data-tip="' + h.esc(tip) + '">' +
      (isFocus ? '<span class="anet-tile-go" data-act="goto-agent" data-id="' + h.esc(a.id) + '" data-tip="进入该 Agent 详情">详情 →</span>' : '') +
      '<span class="anet-tile-ico">' + h.icon('bot', 22) + '</span>' +
      '<span class="anet-tile-nm" data-rename="agent|' + h.esc(a.id) + '" title="双击改名">' + h.esc(a.name) + '</span>' +
      /* 已下线的卡片不写「— · —」：灰色虚线边框已经表达了"没数据"，再写两个破折号是重复。
         两个数字各自按自己的档位染色：只有一个数字变色，才看得出是"答错"还是"答慢"。 */
      '<span class="anet-tile-m">' + ((retired || a.status === 'offline') ? '已下线'
        : (card.successRate == null ? '—' : '<i class="' + (srIss ? ' hz' + srIss : '') + '">' + h.fmt.pct2(card.successRate) + '</i>') + ' · ' +
          (card.p99 == null ? '—' : '<i class="' + (p99Iss ? ' hz' + p99Iss : '') + '">' + h.fmt.dur(card.p99) + '</i>')) + '</span>' +
      /* 联系数为 0 不显示徽标：孤立卡片上挂个「0」既没信息量，还会让人以为"这是它的编号" */
      (deg > 0 ? '<span class="anet-tile-deg" title="当前口径下的直接联系数">' + deg + '</span>' : '') +
      '</button>';
  }


  function canvasHtml(g, h) {
    var L = _L = anetLayout(g, h);
    _DEG = {};
    L.cards.forEach(function (c) {
      var d = 0;
      g.edges.forEach(function (e) { if (e.a === c.id || e.b === c.id) d++; });
      _DEG[c.id] = d;
    });
    _GEO = {}; L.edges.forEach(function (e) { _GEO[e.a + '>' + e.b] = { e: e, a1: e.segs[0], a2: e.arrow }; });
    _CONTENT_BB = { x1: 0, y1: 0, x2: L.w, y2: L.h };
    _FOCUS = (h.state && h.state.agentNetFocus) || null;
    _NBR = {};
    if (_FOCUS) {
      g.edges.forEach(function (e) { if (e.a === _FOCUS) _NBR[e.b] = 1; if (e.b === _FOCUS) _NBR[e.a] = 1; });
      _NBR[_FOCUS] = 1;
    }
    /* 隔离区是画布里面的一块，所以**空态也要把它 rendering 出来**：
       全关口径下 13 个 Agent 全是孤岛，若这里提前返回，界面上会一个都不显示（实测就是这个 bug）。 */
    var isoBox = '';
    if (L.isoW) {
      isoBox = '<div class="anet-iso anet-iso-inworld" style="left:' + pxv(L.isoX) + ';top:' + pxv(L.isoY) +
        ';width:' + pxv(L.isoW) + ';height:' + pxv(L.isoH) + '">' +
        '<div class="anet-iso-h"><b>隔离区</b><span class="muted">' + L.isoIds.length + ' 个</span></div>' +
        /* ⚠ 文案只从 ISO_COPY 取（引擎估行高也用它）——原来这里又硬写了一份，
           改一处漏一处就会「量的高度」和「画出来的文字」对不上。 */
        '<div class="anet-iso-sub">' + h.esc(ISO_COPY.sub) + '</div>' +
        (L.isoIds.length ? '' : '<div class="anet-iso-sub" style="margin-top:8px">现在没有孤岛。</div>') +
        '<div class="anet-iso-grip" title="拖我调整隔离区宽度"></div></div>';
    }
    /* 孤岛卡片要在这里拼：空态（全关口径）走的是下面的提前返回，
       放在返回之后拼就会出现「只有面板框、一张卡都没有」。 */
    var isoTiles = '';
    L.isoCards.forEach(function (c) {
      var a = aOf(c.id); if (!a) return;
      isoTiles += azCardHtml(a, c, h, true);
    });
    if (!L.cards.length) {
      return '<div class="anet-canvas anet-canvas-empty" style="height:' + r1(L.h * (viewS(h).k || 1)) + 'px">' +
        '<div class="anet-dragtip"></div><div class="anet-sr" role="status" aria-live="polite"></div>' + '<div class="anet-world" style="' + worldStyle(h) + ';width:' + r1(L.w) + 'px;height:' + r1(L.h) + 'px">' +
        isoBox + isoTiles +
        '<div class="anet-empty-note" style="left:' + pxv(L.chartL) + ';top:' + pxv(AZ.Y_ROW0) + '">' +
        '<div class="empty-title">当前口径下没有任何直接联系</div>' +
        '<div class="empty-sub">四类关系都被关掉了，所以 ' + L.isoIds.length +
        ' 个 Agent 全在隔离区。打开任意一类就能看到图。</div>' +
        /* 空态不能是死路：原来这里只有一句话，除了撤销没有别的出口 */
        '<div class="anet-empty-acts">' + RULES.map(function (r) {
          return '<button class="btn-ghost sm" data-act="agentw-rel" data-id="' + h.esc(r.id) + '">打开「' +
            h.esc(r.label) + '」</button>';
        }).join('') + '</div></div></div></div>';
    }
    var cards = '';
    L.cards.forEach(function (c) { var a = aOf(c.id); if (a) cards += azCardHtml(a, c, h); });
    var caps = '';
    L.cols.forEach(function (c, i) {
      caps += '<text class="anet-cap" data-rename="biz|' + h.esc(c.biz) + '" x="' + r1(L.cxs[i]) + '" y="' + (AZ.Y_BIZ + 15) +
        '" text-anchor="middle" style="cursor:text">' + h.esc(c.name) + ' ⇄</text>';      /* ⇄ = 这一列可以拖进来（列 = 归属，可改） */
      caps += '<text class="anet-cap2" x="' + r1(L.cxs[i]) + '" y="' + (AZ.Y_BIZ + 30) + '" text-anchor="middle">' +
        h.esc(c.n + ' 个 Agent') + '</text>';
    });
    caps += '<text class="anet-root-t" x="' + r1(L.rootCx) + '" y="' + (AZ.Y_ROOT + 15) + '" text-anchor="middle">Agent 平台</text>';
    caps += '<text class="anet-root-s" x="' + r1(L.rootCx) + '" y="' + (AZ.Y_ROOT + 32) + '" text-anchor="middle">' +
      h.esc(L.rootSub || '') + '</text>';
    L.rows.forEach(function (r, k) {
      caps += '<text class="anet-rowlab" x="' + r1(L.rowStripL + 12) + '" y="' + r1(L.yRow[r] + AZ.CH / 2 - 9) + '" text-anchor="start">' +
        h.esc(rowLabel(r)) + '</text>';
      caps += '<text class="anet-rowlab2" x="' + r1(L.rowStripL + 12) + '" y="' + r1(L.yRow[r] + AZ.CH / 2 + 9) + '" text-anchor="start">' +
        h.esc(L.rowCount[k] + ' 个 Agent') + '</text>';
    });
    return '<div class="anet-canvas" data-cols="' + h.esc(L.cols.map(function (c) { return c.name + c.n; }).join(',')) +
      '" data-rows="' + h.esc(L.rows.join(',')) + '" data-crossings="' + L.crossings +
      '" data-iso-head="' + r1(L.isoHead || 0) + '" data-label-mode="' + h.esc(L.labelMode || DEF_LABEL_MODE) + '"' +
      ' style="height:' + r1(L.h * (viewS(h).k || 1)) + 'px">' +
      '<div class="anet-dragtip"></div>' + '<div class="anet-world" style="' + worldStyle(h) + ';width:' + r1(L.w) + 'px;height:' + r1(L.h) + 'px">' +
      '<div class="anet-sr" role="status" aria-live="polite"></div>' +
      '<svg class="anet-edges" viewBox="0 0 ' + r1(L.w) + ' ' + r1(L.h) + '" width="' + r1(L.w) + '" height="' + r1(L.h) + '">' +
      azBgSvg(L, g, h) + caps + '</svg>' + isoBox + isoTiles + cards + '</div></div>';
  }

  /** 内容包围盒（供「适应窗口」）：现在世界是自然尺寸，直接用画布尺寸 */
  function contentBBox(pos) {
    if (!_L) return null;
    return { x1: 0, y1: 0, x2: _L.w, y2: _L.h };
  }
  function nbrOf(g, id) {
    var out = {};
    out[id] = 1;
    g.edges.forEach(function (e) {
      if (e.a === id) out[e.b] = 1;
      if (e.b === id) out[e.a] = 1;
    });
    return out;
  }

  function graphCard(g, h) {
    var f = (h.state && h.state.agentNetFocus) || null;
    var fa = f ? aOf(f) : null;
    /* 聚焦提示条：明确说"现在只亮了一跳"并给取消入口 —— 降噪不能让人以为关系变少了 */
    var total = Object.keys(g.deg).length;
    var bar = (f && fa) ? '<div class="anet-focus-bar">' +
      '<span>已聚焦 <b>' + h.esc(fa.name) + '</b> —— 只亮出它的一跳邻居，其余 ' +
      Math.max(0, total - Object.keys(nbrOf(g, f)).length) + ' 个已淡出。</span>' +
      '<button class="lnk" data-act="net-focus" data-id="' + h.esc(f) + '">取消聚焦</button>' +
      '<span class="muted">看全部 ' + total + ' 个</span></div>' : '';
    return '<div class="card"><div class="card-h"><h3>Agent 关系图</h3>' +
      '<span class="card-sub"><b>实线 = A2A 委派</b> · <b>虚线 = 共用关系</b> · <b>图标外环 = 失败占比</b></span></div>' +
      (h.state.anetHelp ? anetHelpHtml(h) : '') + bar + toolsHtml(h) +
      /* Filter 降噪：关掉时不渲染隔离区（只影响显示，口径与关系总数不变） */
      /* 隔离区现在画在画布世界层里面（跟着缩放/平移走），所以这里只剩画布 */
      '<div class="anet-shell">' + canvasHtml(g, h) + '</div></div>';
  }

  /* SECTION: tools（v26c）
     画布上方的操作条：撤销 / 重做 / 历史 / 缩放。此前这一屏只有"拖动摆位 + 右键"`
     —— 动过之后回不去、看不见现在缩放多少、也没有任何键盘通道。 */
  /**
   * 视图切换用**现成的标签页组件**（.tabs / .tab / .tab.on，与「Trace 检索 / 评估任务 / badcase 管理」
   * 那一排同一个外观），不再自造一排按钮。
   * 网格的排序控件也放在这里（标签行右侧）而**不在画布世界里** —— 放里面会跟着缩放平移一起变，
   * 缩小之后字都看不清，也没有"控件在画布外"这个通行分工。
   */
  /* 操作说明与图例：默认收起，点 `?` 才出 —— 常显的长说明会和数据抢注意力，
     但"藏起来"必须配一个能看见的入口，否则用户不知道有这份说明。 */
  function anetHelpHtml(h) {
    var rows = [
      ['图例', '<b>实线</b> = A2A 委派（有方向，越粗 = 今日互通越多）· <b>虚线</b> = 共用关系（无方向）· ' +
        '<b>图标外环</b> = 失败占比 · <b>右上角数字</b> = 直接联系数'],
      ['边框颜色', '<b>绿</b> 正常（成功率 ≥ 99% 且 P99 ≤ 4 秒）· <b>琥珀</b> 关注（成功率 97–99% 或 P99 4–8 秒）· ' +
        '<b>红</b> 异常（成功率 < 97% 或 P99 > 8 秒）· <b>灰</b> 已下线 / 停用。<br>' +
        '卡片上两个数字各自染色：<b>成功率变色 = 答错</b>，<b>P99 变色 = 答慢</b> —— 哪种病，看哪个数字红。'],
      ['看连线细节', '鼠标移到线上，显示技能名与今日互通次数（工具条「标签」可切成常显 / 隐藏）'],
      ['平移 / 缩放', '空白处或中键拖动平移 · Ctrl + 滚轮缩放（触控板捏合同理）'],
      ['改归属', '把卡片横向拖到别的业务线列'],
      ['断联系', '把卡片拖进左侧隔离区（会断开它在当前口径下的全部联系）'],
      ['建联系', '把卡片拖到另一张卡片上'],
      ['删边', '点一条线，或右键'],
      ['改层级', '把卡片<b>上下拖到目标层</b> = 自定义它放在第几层，<b>委派关系一条都不动</b>。默认层由 A2A 委派推导（谁叫它，它就在谁下面一层）；' +
        '手动摆过的卡底下标「层级手动」，右键可「恢复自动层级」。要改"谁叫它"，把卡片拖到那张卡上建立联系。'],
    ];
    return '<div class="anet-help"><b class="ah-t">操作说明</b>' + rows.map(function (r) {
      return '<div class="ah-row"><span class="ah-k">' + h.esc(r[0]) + '</span><span class="ah-v">' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }

  /**
   * 就地改名：id 形如 "agent|ag-cs-pre" / "biz|support"。改的是**数据**（a.name / 业务线 name），
   * 所以全站展示（aName、列头、明细）自动同步；并进历史，可撤销。
   * 名字不参与布局，只有列头框宽度按文案重算 —— 所以改名不会让图跳。
   */
  /**
   * 把某个 Agent 放到指定层（纵向拖动的落点）。
   *
   * 2026-10-24 改口径（业主原话：「自定义层级是自定义的一部分，用户在自定义的时候，
   * 关系变了是你的问题」）：
   *   旧行为 = 拖到第 R 层就**改数据** —— 删掉原上游、再凭空新建一条「第 R-1 层最近的一张 → 它」，
   *            技能记「待补充」。结果是用户只想摆位置，回来发现图上多了一条没人认领的委派，
   *            下游整条链跟着沉一层，且这条边会进全站（引用与依赖）。
   *   新行为 = 只写**层级覆盖**（state.anetRowOverride），A2A 边一条不增、一条不减。
   *            要改"谁叫它"就去拖到具体那张卡上建联系 —— 那条路有输入、有理由，是显式动作。
   * 覆盖是内存态（和其它编辑一样进撤销栈），刷新回自动推导。
   */
  ACTIONS['anet-setrow'] = function (id, btn, h) {
    var parts = String(id).split('|'), aid = parts[0], row = +parts[1];
    var a = aOf(aid);
    if (!a || !(row >= 0)) return;
    var cur = (_L && _L.pos[aid]) ? _L.pos[aid].row : null;
    if (cur === row) { h.toast('它已经在第 ' + row + ' 层了', 'info'); return; }
    var ov = Object.assign({}, h.state.anetRowOverride || {});
    var auto = _AUTOROW[aid];
    if (auto != null && row === auto) {
      /* 拖回了推导层 = 等于没改，把覆盖项删掉，别在卡片上留个"层级手动" */
      delete ov[aid];
    } else {
      ov[aid] = row;
    }
    h.state.anetRowOverride = ov;
    pushStep(h, '把「' + a.name + '」放到第 ' + row + ' 层（只改层级，委派未变）', 'row');
    h.navigate({}, { scroll: false });
    h.toast('已把「' + a.name + '」放到第 ' + row + ' 层 —— 委派关系一条没动，其它卡片也没动' +
      (auto != null && row === auto ? '，这一层和自动推导一致，标记已撤掉' : '') + '（可撤销）', 'ok');
  };

  /* 恢复自动层级：撤掉这一张卡的手动层，回到"由委派推导" */
  ACTIONS['anet-rowreset'] = function (id, btn, h) {
    var ov = h.state.anetRowOverride || {};
    if (ov[id] == null) return;
    var next = Object.assign({}, ov);
    delete next[id];
    h.state.anetRowOverride = next;
    pushStep(h, '把「' + aName(id) + '」的层级恢复为按委派推导', 'row');
    h.navigate({}, { scroll: false });
    h.toast('「' + aName(id) + '」已回到自动层级', 'ok');
  };

  /* 全部恢复：一次性清掉所有手动层 */
  ACTIONS['anet-rowreset-all'] = function (id, btn, h) {
    var ov = h.state.anetRowOverride || {};
    if (!Object.keys(ov).length) return;
    h.state.anetRowOverride = {};
    pushStep(h, '恢复全部自动层级', 'row');
    h.navigate({}, { scroll: false });
    h.toast('所有层级已回到按委派推导', 'ok');
  };

  global.__anetRename = function (id, value, h) {
    var parts = String(id).split('|'), kind = parts[0], key = parts[1];
    var v = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    if (!v) { h.toast('名字不能为空', 'warn'); return false; }
    if (v.length > 24) { h.toast('名字最多 24 个字', 'warn'); return false; }
    if (kind === 'agent') {
      var a = aOf(key);
      if (!a) return false;
      if (a.name === v) return false;
      var old = a.name;
      a.name = v;
      pushStep(h, '把「' + old + '」改名为「' + v + '」', 'rename');
      h.navigate({}, { scroll: false });
      h.toast('已改名：' + old + ' → ' + v + '（历史记录里仍是旧名，可撤销）', 'ok');
      return true;
    }
    if (kind === 'biz') {
      var b = S.BIZ_LINES.filter(function (x) { return x.id === key; })[0];
      if (!b || b.name === v) return false;
      var oldB = b.name;
      b.name = v;
      pushStep(h, '把业务线「' + oldB + '」改名为「' + v + '」', 'rename');
      h.navigate({}, { scroll: false });
      h.toast('已改名：' + oldB + ' → ' + v + '（可撤销）', 'ok');
      return true;
    }
    return false;
  };

  ACTIONS['anet-help'] = function (id, btn, h) {
    h.state.anetHelp = !h.state.anetHelp;
    h.navigate({}, { scroll: false });
  };

  function toolsHtml(h) {
    var v = viewS(h);
    var hist = histS(h);
    var pct = Math.round(v.k * 100);
    var canU = hist.cur > 0, canR = hist.cur >= 0 && hist.cur < hist.steps.length - 1;
    return '<div class="anet-tools" role="toolbar" aria-label="画布操作">' +
      '<div class="view-sw">' +
      '<button class="vs-btn" data-act="anet-zoom" data-id="out" title="缩小（-）" aria-label="缩小">−</button>' +
      '<button class="vs-btn anet-zoomv" data-act="anet-zoom" data-id="reset" title="回到 1:1（0）">' + pct + '%</button>' +
      '<button class="vs-btn" data-act="anet-zoom" data-id="in" title="放大（+）" aria-label="放大">+</button>' +
      '</div>' +
      '<button class="btn-ghost sm" data-act="anet-fit" title="缩放到刚好装下全部节点">适应窗口</button>' +
      '<span class="anet-tools-sep"></span>' +
      '<span class="anet-labels">标签' + [['all', '全部'], ['hover', '悬停'], ['off', '隐藏']].map(function (x) {
        return '<button class="btn-ghost sm' + (((h.state.anetLabelMode || DEF_LABEL_MODE) === x[0]) ? ' on' : '') +
          '" data-act="anet-labels" data-id="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</span>' +
      '<span class="anet-tools-sep"></span>' +
      '<button class="btn-ghost sm" data-act="anet-undo"' + (canU ? '' : ' disabled') +
      ' title="撤销上一步（Ctrl+Z）">撤销</button>' +
      '<button class="btn-ghost sm" data-act="anet-redo"' + (canR ? '' : ' disabled') +
      ' title="重做（Ctrl+Shift+Z）">重做</button>' +
      '<button class="btn-ghost sm" data-act="anet-history"' +
      (hist.steps.length > 1 ? '' : ' disabled') + ' title="回退到任意一步">历史 ' +
      (hist.steps.length > 1 ? hist.cur + '/' + (hist.steps.length - 1) : '') + '</button>' +
      /* 只在真有手动层时才出现：没有手动层时多一个按钮只会让人以为漏了什么 */
      (manualRowCount(h)
        ? '<button class="btn-ghost sm" data-act="anet-rowreset-all" title="把手动摆过的层恢复为按委派推导（撤销也能回来）">恢复层级 ' +
          manualRowCount(h) + '</button>'
        : '') +
      '<span class="anet-tools-hint muted"><b>Ctrl + 滚轮</b>缩放 · 拖动卡片：横拖改归属 / <b>上下拖改层级</b> / 拖进隔离区断联系 / 拖到卡上建联系</span>' +
      '<button class="btn-ghost sm anet-help-btn" data-act="anet-help" title="操作说明与图例">?</button>' +
      '</div>';
  }

  function detailCard(g, state, h) {
    var order = { a2a: 0, exp: 1, conflict: 2, mcp: 3 };
    var rows = g.edges.slice().sort(function (x, y) {
      return (order[x.type] - order[y.type]) || (aName(x.a) < aName(y.a) ? -1 : 1);
    }).map(function (e) {
      return {
        type: e.type, typeLabel: e.typeLabel, basis: e.basis, scale: e.scale,
        a: e.a, b: e.b, dir: !!e.dir, why: e.why || '', evId: e.evId || '',
        manual: !!e.manual, by: e.by || '',
        aName: aName(e.a), bName: aName(e.b),
        aBiz: aBiz(e.a), bBiz: aBiz(e.b), cap: e.cap, capText: e.capText
      };
    });
    var manualN = rows.filter(function (r) { return r.manual; }).length;
    return '<div class="card"><div class="card-h"><h3>关系明细</h3>' +
      '<span class="card-sub">共 ' + rows.length + ' 条 · 每条都能点进来源页核对' +
      (manualN ? ' · <b>其中 ' + manualN + ' 条是人工新增</b>（带「人工」标记，不代表推导出的依赖）' : '') +
      '</span></div>' +
      h.table({
        columns: [
          {
            key: 'typeLabel', label: '关系类型', render: function (r) {
              return '<span class="anet-tag t-' + r.type + '">' + h.esc(r.typeLabel) + '</span>' +
                (r.manual ? '<span class="anet-tag anet-tag-manual" title="人工新增：' + h.esc(r.by || '—') + '">人工</span>' : '');
            }
          },
          {
            key: 'aName', label: 'Agent A', render: function (r) {
              return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.a) + '">' + h.esc(r.aName) + '</button>' +
                '<span class="muted"> · ' + h.esc(r.aBiz) + '</span>';
            }
          },
          {
            key: 'bName', label: 'Agent B', render: function (r) {
              /* A2A 是有向的：B 前面带箭头，读出来才是「A 委派给 B 办什么」 */
              return (r.dir ? '<span class="muted" title="委派方向">→ </span>' : '') +
                '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.b) + '">' + h.esc(r.bName) + '</button>' +
                '<span class="muted"> · ' + h.esc(r.bBiz) + '</span>';
            }
          },
          { key: 'basis', label: '依据' },
          { key: 'scale', label: '规模与证据' },
          {
            key: 'cap', label: '核对', render: function (r) {
              var ev = TYPE_EV[r.type];
              if (ev) {
                return '<button class="lnk" data-act="' + h.esc(ev.act) + '" data-id="' + h.esc(r.evId || '') + '"' +
                  ' data-tip="' + h.esc(ev.text + (r.why ? '：' + r.why : '')) + '">看这条边 →</button>';
              }
              return '<button class="lnk" data-act="goto-cap" data-id="' + h.esc(r.cap) + '"' +
                ' data-tip="' + h.esc(r.capText) + '">去核对 →</button>';
            }
          }
        ],
        rows: rows, page: state.page, pageSize: 20,
        emptyTitle: '当前口径下没有直接联系',
        emptySub: '把上面任意一类关系打开再看 —— 空白本身就是结论：这些 Agent 之间没有可核对的关系'
      }) + '</div>';
  }

  /* SECTION: page */
  RENDERERS.agentNet = function (cap, state, h) {
    var g = buildGraph(state);
    return metricsHtml(g, h) + rulesCard(g, h) + graphCard(g, h) + detailCard(g, state, h) +
      h.metaBar(null, [
        {
          k: '关系口径',
          v: RULES.filter(function (r) { return g.rules[r.id]; }).map(function (r) { return r.label + '（' + (g.byType[r.id] || 0) + ' 条）'; }).join('；') +
            ' —— 未启用的口径不计入联系，也不计入隔离区'
        },
        {
          k: '关系来源',
          v: 'Agent 委派日志、LLM 经验库、编排拓扑里的 MCP 服务'
        },
        {
          k: '隔离区口径',
          v: '当前口径下一条联系都没有的 Agent（' + g.isolated.length + ' 个）'
        },
        {
          k: '时间范围',
          v: '关系是配置态事实（谁委派给谁、谁跟谁共用经验/工具），与所选时间范围无关，本屏不提供时间筛选'
        }
      ]);
  };

  /* SECTION: actions */
  ACTIONS['agentw-tab'] = function (id, btn, h) {
    h.state.agentPageTab = (id === 'net') ? 'net' : 'list';
    h.navigate({}, { scroll: false });
  };
  ACTIONS['agentw-rel'] = function (id, btn, h) {
    var on = stateRules(h.state);
    if (on[id] === undefined) return;
    on[id] = !on[id];
    h.state.agentNetRules = on;
    h.state.page = 1;          /* 切口径后明细行数会变，回到第 1 页免得停在空页 */
    h.navigate({}, { scroll: false });
  };
  /* 逐跳展开：点节点聚焦 / 再点取消（v25d）。
     依据 SkyWalking Horizon UI —— 聚焦时只拉进直接上下游，一次走一跳。
     不改图的结构，只改透明度与提示条：**降噪不等于改依赖**。 */
  /* 恢复自动布局（v25f）：拖动了就得不让我回去 —— 否则"微调"变成"回不去" */
  /* 改归属（横向拖到别的业务线列）：写 a.biz —— 组织调整，是真实字段，
     和历史快照里的 bizs 对应，可撤销。 */
  ACTIONS['anet-rebiz'] = function (id, btn, h) {
    var parts = String(id).split('|'), aid = parts[0], biz = parts[1];
    var a = aOf(aid);
    if (!a || !biz || a.biz === biz) return;
    var fromName = aBiz(aid);
    a.biz = biz;
    delete _SLOT[aid];                 /* 换了列，旧列里的格号作废：到新列重新落格 */
    pushStep(h, '把「' + a.name + '」从 ' + fromName + ' 调到 ' + aBiz(aid), 'biz');
    h.navigate({}, { scroll: false });
    h.toast('已把「' + a.name + '」的归属改为 ' + aBiz(aid) + '（Ctrl+Z 可撤销）', 'ok');
  };

  /* 右键边的「看依据与规模」：不新造内容，直接把该行在下方明细表里定位高亮 */
  ACTIONS['net-edge'] = function (id, btn, h) {
    var it = _GEO[id];
    if (!it) return;
    var el = global.document.querySelector('#content .anet-detail tr[data-ei="' + h.esc(String(id)) + '"]');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('anet-flash');
      global.setTimeout(function () { el.classList.remove('anet-flash'); }, 1400);
    } else {
      h.toast(aName(it.e.a) + ' → ' + aName(it.e.b) + '：' + it.e.scale, 'info');
    }
  };
  /* SECTION: v26c-actions —— 视图、历史与快捷键
     命名统一用 anet- 前缀（老的 net-* 保持不变，避免动到既有回执与埋点）。 */
  function canvasEl() {
    return global.document && global.document.querySelector ? global.document.querySelector('#content .anet-canvas') : null;
  }
  function canvasRect() {
    var el = canvasEl();
    return (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
  }
  function applyWorldStyle(h) {
    var el = canvasEl();
    var w = el && el.querySelector ? el.querySelector('.anet-world') : null;
    /* ⚠ 只改 transform / transformOrigin，**不能** setAttribute('style', …) 整体替换：
       世界层的 width/height 是 canvasHtml 写在同一个 style 上的，整体替换会把自然尺寸抹掉 ——
       jsdom 实跑的证据：渲染后 style 带 width:1714px;height:924px，**平移一帧后就只剩 transform**。
       世界层的盒子随之变化，视觉上就是"一跳"，而且每次重渲染尺寸又回来 → 下次平移再跳一次。 */
    if (w) {
      var v = viewS(h);
      w.style.transform = 'translate(' + r1(v.tx) + 'px,' + r1(v.ty) + 'px) scale(' +
        (Math.round(v.k * 1000) / 1000) + ')';
      w.style.transformOrigin = '0 0';
    }
    /* 世界层是自然尺寸、由 transform 缩放，所以画布容器的高度要跟着 k 走，
       否则缩小后下面留一大片空白、放大后内容被 overflow:hidden 切掉。 */
    if (el && _L) {
      var _hh = r1(_L.h * (viewS(h).k || 1)) + 'px';
      if (el.style.height !== _hh) el.style.height = _hh;   /* 只在真变了才写：逐帧写会触发布局/滚动锚定 */
    }
    return w;
  }

  ACTIONS['anet-zoom'] = function (id, btn, h) {
    var r = canvasRect();
    var ax = r ? r.width / 2 : 500, ay = r ? r.height / 2 : 200;
    if (id === 'reset') {
      h.state.agentNetView = { k: 1, tx: 0, ty: 0 };
      /* 缩放/平移是**纯显示**，不进历史：撤销是撤内容，不是撤"我把图放大了" */
      h.navigate({}, { scroll: false });
      return;
    }
    var f = (id === 'in') ? 1.25 : 1 / 1.25;
    zoomTo(h, viewS(h).k * f, ax, ay);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['anet-fit'] = function (id, btn, h) {
    var r = canvasRect(), bb = _CONTENT_BB;
    if (!r || !bb) { h.toast('还没有可适配的内容', 'info'); return; }
    var pad = 26;
    var cw = Math.max(1, bb.x2 - bb.x1), ch = Math.max(1, bb.y2 - bb.y1);
    var k = clampK(Math.min((r.width - pad * 2) / cw, (r.height - pad * 2) / ch, 1.6));
    var v = viewS(h);
    v.k = k;
    v.tx = (r.width - cw * k) / 2 - bb.x1 * k;
    v.ty = (r.height - ch * k) / 2 - bb.y1 * k;
    h.navigate({}, { scroll: false });
  };
  ACTIONS['anet-undo'] = function (id, btn, h) {
    var H = histS(h);
    if (H.cur <= 0) { h.toast('已经在最初状态了', 'info'); return; }
    var label = H.steps[H.cur].label;
    goStep(h, H.cur - 1);
    h.toast('已撤销「' + label + '」' + (reportCaveat(H.steps[H.cur]) || ''), 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['anet-redo'] = function (id, btn, h) {
    var H = histS(h);
    if (H.cur >= H.steps.length - 1) { h.toast('没有可重做的步骤', 'info'); return; }
    var label = H.steps[H.cur + 1].label;
    goStep(h, H.cur + 1);
    h.toast('已重做「' + label + '」', 'ok');
    h.navigate({}, { scroll: false });
  };
  /* 经验类改动只落在本页缓存：撤销时也要说清楚"改的是哪一层"，免得以为全局都回退了 */
  function reportCaveat(step) {
    return (step && step.kind === 'rel-exp') ? '（经验类改动只作用于本页缓存）' : '';
  }
  ACTIONS['anet-step-goto'] = function (id, btn, h) {
    var H = histS(h);
    var i = Number(id);
    if (!(i >= 0) || i >= H.steps.length) return;
    if (i === H.cur) { global.V10UI.closeSheet(); return; }
    var discards = Math.max(0, H.steps.length - 1 - i);
    global.V10UI.closeSheet();
    if (discards) {
      h.dangerConfirm(h, {
        title: '回到「' + H.steps[i].label + '」？',
        desc: '这一步之后还有 ' + discards + ' 步，回退会把它们丢弃（不是隐藏，是作废）。',
        danger: false, confirmText: '回退到这里',
        impacts: [
          { label: '目标状态', value: '第 ' + i + ' 步 · ' + H.steps[i].label },
          { label: '丢弃步骤', value: discards + ' 步' },
          { label: '涉及', value: '节点位置 / 关系改动（A2A、经验、MCP）' }
        ],
        action: '回退操作历史', target: 'step ' + i,
        onConfirm: function () {
          restoreSnap(h, H.steps[i].snap);
          h.state.agentNetHist.steps = H.steps.slice(0, i + 1);
          h.state.agentNetHist.cur = i;
          h.toast('已回到「' + H.steps[i].label + '」', 'ok');
          h.navigate({}, { scroll: false });
        }
      });
      return;
    }
    goStep(h, i);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['anet-history'] = function (id, btn, h) {
    var H = histS(h);
    var relKinds = { 'rel-a2a': 1, 'rel-exp': 1, 'rel-mcp': 1 };
    var rows = H.steps.map(function (s, i) {
      var t = new Date(s.at);
      var hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') +
        ':' + String(t.getSeconds()).padStart(2, '0');
      var isCur = i === H.cur;
      return '<div class="anet-hist-row' + (isCur ? ' on' : '') + '">' +
        '<span class="anet-hist-i">' + i + '</span>' +
        '<span class="anet-hist-t">' + hh + '</span>' +
        '<span class="anet-hist-l">' + h.esc(s.label) + (relKinds[s.kind] ? ' <i class="anet-hist-tag">改数据</i>' : '') +
        (isCur ? ' <i class="anet-hist-tag now">当前</i>' : '') + '</span>' +
        (isCur ? '' : '<button class="lnk" data-act="anet-step-goto" data-id="' + i + '">回退到这</button>') +
        '</div>';
    }).reverse().join('');
    global.V10UI.openSheet({
      title: '操作历史（共 ' + H.steps.length + ' 步）',
      bodyHtml: '<div class="v10-sheet-desc">每一步都是**整份快照**（节点位置 + 四类关系的源数据）。' +
        '回退到某一步 = 把当时那份快照整体写回，不是"反向执行一遍"—— 所以能落到任意版本，不留中间态。</div>' +
        '<div class="anet-hist">' + rows + '</div>' +
        '<div class="bt-note">节点位置只在本会话有效（刷新回自动布局）；缩放平移不进历史 —— 撤销只撤内容，不动你现在的视角；' +
        'A2A / MCP 两类关系取自种子数据，改动在本次会话内对全站生效；' +
        '经验类边改的是本页缓存，经验库页面重新取数看不到（原型里经验队列每次现算）。</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>'
    });
  };

  /* ---- B 批：把节点拖进隔离区 = 断开关系（真改数据，可回退）---- */
  ACTIONS['anet-detach'] = function (id, btn, h) {
    var a = aOf(id);
    if (!a) return;
    var plan = planDetach(h, id);
    var edges = curEdgesOf(h, id);
    /* 四类关系都是可断开的数据事实，没有"只能去别处改"的不可断开项 */
    if (!plan.patches.length) {
      h.toast('「' + a.name + '」当前口径下本来就没有直接联系', 'info');
      return;
    }
    var byType = {};
    plan.patches.forEach(function (p) { byType[p.typeLabel] = (byType[p.typeLabel] || 0) + 1; });
    var impacts = Object.keys(byType).map(function (k) { return { label: k, value: byType[k] + ' 条' }; });
    impacts.push({ label: '当前口径下的联系', value: edges.length + ' 条' });
    impacts.push({ label: '改的数据', value: plan.patches.map(function (p) { return p.typeLabel; }).filter(function (v, i, s) { return s.indexOf(v) === i; }).join(' / ') });
    impacts.push({ label: '可还原', value: '是 —— 操作历史里可回退到任意一步（Ctrl+Z）' });
    plan.patches.slice(0, 4).forEach(function (p) { impacts.push({ label: '将断开', value: p.detail, tone: 'warn' }); });
    if (plan.patches.length > 4) impacts.push({ label: '还有', value: '另外 ' + (plan.patches.length - 4) + ' 条（确认后在关系明细里逐条核对）' });

    h.dangerConfirm(h, {
      title: '把「' + a.name + '」在当前口径下断开？',
      desc: '会按联系类型改动对应的真实数据（委派关系、经验采纳名单、编排模板里的 MCP 节点）。' +
        '断开后它在当前口径下成为孤岛、进入左侧隔离区；随时可在操作历史里回退。',
      tone: 'danger', perm: 'agent:rel:detach', confirmText: '确认断开',
      impacts: impacts,
      onConfirm: function () {
        var done = 0;
        plan.patches.forEach(function (p) { try { p.apply(); done++; } catch (e) { if (global.console) global.console.error(e); } });
        var H = pushStep(h, '断开「' + a.name + '」的 ' + done + ' 条关系', 'rel-detach');
        H.steps[H.cur].detached = [id];
        h.toast('已断开 ' + done + ' 条关系 · Ctrl+Z 可还原', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* 撤销"这一次断开"（只在当前步就是那次断开时给） */
  ACTIONS['anet-detach-undo'] = function (id, btn, h) {
    var H = histS(h);
    var cur = H.steps[H.cur];
    if (!cur || !cur.detached || cur.detached.indexOf(id) < 0) { h.toast('当前这一步不是断开操作', 'info'); return; }
    ACTIONS['anet-undo'](null, null, h);
  };
  /* ---- 平移与缩放（app.js 的 anet 块在每次渲染后调用 __anetPan 挂一次）：
     空白处左键拖 / 中键拖 = 平移；Ctrl + 滚轮 = 缩放；不按 Ctrl 时滚轮照常滚页面 ---- */
  var _wheelTimer = 0;
  function anetPan(el, h) {
    var world = el.querySelector('.anet-world');
    if (!world) return;
    /* 打开这一屏先「适应宽度」：世界层是自然尺寸，k=1 时在画布容器里只能看到左边一半。
       只在首次自适应，之后尊重用户自己的缩放。 */
    if (!h.state.agentNetFitOnce && _L && _L.w) {
      var cw = el.clientWidth || 0;
      if (cw > 40) {
        var v0 = viewS(h);
        v0.k = clampK(Math.min(1, (cw - 2) / _L.w));
        v0.tx = 0; v0.ty = 0;
        h.state.agentNetFitOnce = 1;
        applyWorldStyle(h);
      }
    }

    el.addEventListener('pointerdown', function (ev) {
      /* 中键拖动也平移（编辑器通行约定：Figma / CAD 都是中键拖）。
         中键在任何位置都能拖；左键落在卡片上仍留给"拖动卡片"。 */
      /* 拖隔离区右缘的抓手 = 改它宽度。拖动中只画一条参考线，松手才落定并重渲染 ——
         每帧重渲染整个 SVG + 卡片会明显卡顿。 */
      var grip = ev.target.closest ? ev.target.closest('.anet-iso-grip') : null;
      if (grip && _L && _L.isoOn) {
        ev.preventDefault();
        var r0 = canvasRect(), baseW = _L.isoW, x00 = ev.clientX;
        var guide = global.document.createElement('div');
        guide.className = 'anet-iso-guide';
        el.appendChild(guide);
        function gm(e2) {
          if (e2.buttons === 0) { gu(); return; }
          var wpx = Math.max(180, Math.min(420, baseW + (e2.clientX - x00)));
          guide.style.left = r1(AZ.ISO_X + wpx) + 'px';
        }
        function gu() {
          global.document.removeEventListener('pointermove', gm);
          global.document.removeEventListener('pointerup', gu);
          var wpx = guide.style.left ? parseFloat(guide.style.left) - AZ.ISO_X : baseW;
          guide.remove();
          h.state.anetIsoW = Math.max(180, Math.min(420, wpx));
          h.navigate({}, { scroll: false });
        }
        guide.style.left = r1(AZ.ISO_X + baseW) + 'px';
        global.document.addEventListener('pointermove', gm);
        global.document.addEventListener('pointerup', gu);
        return;
      }
      var mid = (ev.button === 1);
      if (!mid && ev.button !== 0) return;
      if (!mid && ev.target.closest && ev.target.closest('.anet-tile')) return;   /* 落在节点上 → 交给拖节点/聚焦 */
      if (mid) ev.preventDefault();                                        /* 避免触发浏览器的中键自动滚动 */
      var x0 = ev.clientX, y0 = ev.clientY, v = viewS(h);
      var tx0 = v.tx, ty0 = v.ty, moved = false;
      /* 先摘掉上一对监听：只要有一次 pointerup 没收到（在窗口外松手、松到别的浮层上），
         残留的 mv 就会让画布"跟着鼠标自己动"，再拖一次又多一对 → 抖动。 */
      if (el.__panMv) {
        global.document.removeEventListener('pointermove', el.__panMv);
        global.document.removeEventListener('pointerup', el.__panUp);
      }
      try { if (el.setPointerCapture && ev.pointerId != null) el.setPointerCapture(ev.pointerId); } catch (e2) {}
      el.classList.add('panning');
      function mv(e2) {
        if (e2.buttons === 0) { up(); return; }      /* 双保险：没按键了就当抬手 */
        var dx = e2.clientX - x0, dy = e2.clientY - y0;
        if (!moved && (Math.abs(dx) + Math.abs(dy)) < 4) return;
        moved = true;
        v.tx = tx0 + dx; v.ty = ty0 + dy;
        applyWorldStyle(h);                       /* 拖动中只改 style：不重渲染，才跟得住手 */
      }
      function up() {
        global.document.removeEventListener('pointermove', mv);
        global.document.removeEventListener('pointerup', up);
        el.__panMv = null; el.__panUp = null;
        el.classList.remove('panning');
        if (!moved) return;
        /* 平移是纯显示，不进历史（撤销只撤内容） */
        h.navigate({}, { scroll: false });        /* 落定后重渲染一次，工具栏与几何基准同步 */
      }
      el.__panMv = mv; el.__panUp = up;
      global.document.addEventListener('pointermove', mv);
      global.document.addEventListener('pointerup', up);
      ev.preventDefault();
    });

    el.addEventListener('wheel', function (ev) {
      /* Ctrl / ⌘ + 滚轮 = 缩放（浏览器通行约定，Grafana 也是这个默认）。
         ⚠ 不能无条件 preventDefault：那样鼠标停在画布上就滚不动页面，等于把滚轮抢走了。
         触控板双指捏合在浏览器里就是"带 ctrlKey 的 wheel"，所以捏合缩放一并可用。 */
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!r) return;
      /* 以光标为锚点缩放（地图的习惯）：滚一格约 ±1.15 倍 */
      zoomTo(h, viewS(h).k * Math.pow(1.0015, -ev.deltaY), ev.clientX - r.left, ev.clientY - r.top);
      applyWorldStyle(h);
      global.clearTimeout(_wheelTimer);
      _wheelTimer = global.setTimeout(function () {
        /* 滚轮缩放也是纯显示，不进历史 */
        h.navigate({}, { scroll: false });        /* 手势停下来才重渲染一次 */
      }, 260);
    }, { passive: false });
  }
  global.__anetPan = anetPan;

  /* ---- 快捷键（app.js 的 anet 块在每次渲染后调用；模块级只保留一份监听）---- */
  var _keyBound = null;
  function anetKeys(h) {
    if (_keyBound) { global.document.removeEventListener('keydown', _keyBound, true); _keyBound = null; }
    function onKey(ev) {
      if (!canvasEl()) return;                                   /* 只在网状页生效 */
      if (global.document.querySelector('.v10-sheet-mask')) return;   /* 弹层里打字不抢键 */
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var mod = ev.ctrlKey || ev.metaKey;
      var focused = (h.state && h.state.agentNetFocus) || null;

      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        (ev.shiftKey ? ACTIONS['anet-redo'] : ACTIONS['anet-undo'])(null, null, h);
        return;
      }
      if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); ACTIONS['anet-redo'](null, null, h); return; }
      if (mod && ev.key.toLowerCase() === 'h') { ev.preventDefault(); ACTIONS['anet-history'](null, null, h); return; }
      if (mod) return;

      if (ev.key === '+' || ev.key === '=' ) { ev.preventDefault(); ACTIONS['anet-zoom']('in', null, h); return; }
      if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); ACTIONS['anet-zoom']('out', null, h); return; }
      if (ev.key === '0') { ev.preventDefault(); ACTIONS['anet-zoom']('reset', null, h); return; }
      if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); ACTIONS['anet-fit'](null, null, h); return; }
      if (ev.key === 'Escape') {
        if (focused) { h.state.agentNetFocus = null; h.navigate({}, { scroll: false }); }
        return;
      }
      /* v30：位置由布局推导（列 = 业务线、行 = 调用深度），
         方向键微调与 Delete 复位位置已无意义，整段移除 —— 留着就是按了没反应的死键。 */
    }
    _keyBound = onKey;
    global.document.addEventListener('keydown', onKey, true);
  }
  global.__anetKeys = anetKeys;

  /* 连线标签三态：全部 / 悬停 / 隐藏。常显的标签会和线争空间 ——
     所以非"全部"时车道不再给标签留宽度，线回到基线，交叉数回落。 */
  ACTIONS['anet-labels'] = function (id, btn, h) {
    h.state.anetLabelMode = (id === 'hover' || id === 'off') ? id : 'all';
    /* 注：'all' 显式写进 state，切回"全部"时不再落回默认值 */
    h.navigate({}, { scroll: false });
    h.toast('连线标签：' + ({ all: '全部显示', hover: '悬停时显示', off: '隐藏' }[h.state.anetLabelMode]), 'ok');
  };

  ACTIONS['net-focus'] = function (id, btn, h) {
    var cur = (h.state && h.state.agentNetFocus) || null;
    h.state.agentNetFocus = (cur === id) ? null : String(id);
    h.navigate({}, { scroll: false });
  };
  /* 隔离区显示开关（Filter 降噪，v25c）——
     与下面的 agentw-iso 不同：那个是「滚动定位到隔离区」，这个是「显示 / 隐藏隔离区」。
     依据 SkyWalking Horizon UI 的拓扑 Filter：真实拓扑很吵，要能把无边对象一键关掉，
     但不影响真实依赖的呈现。只改显示，不改口径（关系总数与隔离数都不变）。 */
  ACTIONS['agentw-isotoggle'] = function (id, btn, h) {
    h.state.agentNetIso = (h.state.agentNetIso === false);
    h.navigate({}, { scroll: false });
  };

  /* ══ 拖动 / 右键（v25f）══════════════════════════════════════════
     对标 eNSP：拓扑图能**拖动摆位**、能**右键出菜单**。
     关系本身仍然不编（设计稿口径：A2A 边来自 data.js，不提供"手动连线"）——
     所以这里给的是"摆位置 + 对着某个节点／某条边做事"，不是"自己画关系"。

     拖动实现要点：
     ① 位置存 state.agentNetPos（虚拟坐标），layout 读它覆盖自动布局 —— 整屏重渲染不丢
     ② 线/箭头/芯片按同一套几何函数重算，只改属性不重建 DOM（不闪、不丢焦点）
     ③ 拖动结束才写 state（避免每次 mousemove 都触发导航重渲） */
  /* ══ 拖动 = 吸附 + 改数据 ══════════════════════════════════════════════
     位置现在有语义：列 = 业务线、行 = 调用深度。所以拖动**不是自由摆位**：
       横向拖到别的业务线列 → 改 a.biz（组织调整，吸附到该列）
       拖进左侧隔离区       → 断开它在当前口径下的全部联系
       拖到另一张卡片上     → 建立一条联系（人工标注 + 理由必填）
       纵向拖到别的行       → 不允许：行是 A2A 委派**推导**出来的深度，不是可编辑字段
     旧版是「自由摆位 + __anetManual 覆盖自动布局」—— 位置没有含义时成立；
     位置一旦编码语义就不能再用它，否则图上的位置和它对外的承诺会互相矛盾。 */
  function anetDropHl(h, t) {
    var cv = canvasEl();
    var svg = cv && cv.querySelector ? cv.querySelector('.anet-edges') : null;
    if (!svg) return;
    var el = svg.querySelector('.anet-drophl');
    if (!el) {
      el = global.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('class', 'anet-drophl');
      el.setAttribute('rx', '12');
      svg.appendChild(el);
    }
    function hide() { el.setAttribute('width', 0); el.setAttribute('height', 0); }
    if (!t || t.k === 'none' || t.k === 'iso') { hide(); return; }
    if (t.k === 'row') {
      el.setAttribute('x', _L.chartL); el.setAttribute('y', _L.yRow[t.row] - 12);
      el.setAttribute('width', _L.chartR - _L.chartL + 20); el.setAttribute('height', AZ.CH + AZ.TAG_DY + 24);
      return;
    }
    if (t.k === 'col') {
      el.setAttribute('x', t.col.x - 13); el.setAttribute('y', AZ.Y_BIZ + AZ.BIZ_H + 12);
      el.setAttribute('width', t.col.w + 26);
      el.setAttribute('height', _L.rowBottom - (AZ.Y_BIZ + AZ.BIZ_H + 12) + 10);
    } else if (t.k === 'card') {
      var c = _L.pos[t.id];
      if (!c) { hide(); return; }
      el.setAttribute('x', c.x - AZ.CW / 2 - 6); el.setAttribute('y', c.y - AZ.CH / 2 - 6);
      el.setAttribute('width', AZ.CW + 12); el.setAttribute('height', AZ.CH + 12);
    } else hide();
  }
  /**
   * 落点规则集中在这里（yFiles 把约束做成 ConstrainedDragHandler 而不是散落的 if）：
   * 返回 { ok, kind, reason, tone, note }，交互代码只负责调用与提示。
   * 集中之后才谈得上单测与复用：拖动、键盘移动、菜单三处走的是同一套规则。
   */
  function anetDropRules(id, t, ctx) {
    var inTree = ctx.inTree, a = ctx.a;
    /* 纵向落点：按"层 = 谁叫它"落地。
       拖到第 0 层 = 断开全部上游（当入口）；拖到第 R 层 = 让它被第 R-1 层的某张卡叫。
       先删掉它原有上游，所以结果深度必然 = R（可预测，不是试出来的）。 */
    var curRow = _L.pos[id] ? _L.pos[id].row : -1;
    /* 纵/横只看主方向：横拖时落点也会带一个 row（吸附），不区分的话
       "把卡拖到隔壁列"会被先判成"改层级"，归属反而改不掉。 */
    var vertical = Math.abs(ctx.dy) > Math.abs(ctx.dx) * 1.2;
    if (inTree && vertical && t.row != null && t.row !== curRow && (t.k === 'col' || t.k === 'row')) {
      /* 层级 = 用户自定义的一部分，落点只改**它自己这一层**：
         不删上游、不新建上游、不挑「谁来叫它」。要改委派就拖到具体那张卡上（有输入、有理由）。 */
      return { ok: true, kind: 'setrow', row: t.row,
        text: '松手 = 把「' + aName(id) + '」放到第 ' + t.row + ' 层（只改层级，委派关系不动）' };
    }
    if (t.k === 'iso') {
      if (!inTree) return { ok: false, reason: '它已经在隔离区里了 —— 想让它回来，就把它拖到树上某张卡片上建立一条联系' };
      return { ok: true, kind: 'detach' };
    }
    if (t.k === 'card') return { ok: true, kind: 'link' };
    if (t.k === 'col') {
      if (!inTree) return { ok: false, tone: 'warn', reason: '归属不是它孤立的原因：隔离区看的是"有没有联系"。把它拖到树上某张卡片上建立联系，它就会回到图上' };
      if (t.biz === a.biz) {
        if (vertical) return { ok: false, tone: 'warn', reason: '没落进某一层 —— 上下再挪一点，让它贴住目标行再松手' };
        return { ok: false, reason: '列 = 业务线，横向要拖到**别的**列才算改归属' };
      }
      return { ok: true, kind: 'rebiz', biz: t.biz };
    }
    if (vertical) {
      return { ok: false, tone: 'warn', reason: '没落进某一层 —— 上下再挪一点，让它贴住目标行再松手' };
    }
    return { ok: true, kind: 'none', note: '拖动规则：横拖到别的业务线列 = 改归属；拖进左侧隔离区 = 断全部联系；拖到另一张卡上 = 建立联系' };
  }

  /* ── F 键盘拖动 + 播报 ──────────────────────────────────────────────
     无障碍的底线是"必须有不拖也能做完的路径"。拖动对键盘用户等于不存在，
     所以给一条等价通道：空格拿起 → ←/→ 在业务线列之间移动 → 回车确认 → Esc 取消，
     每一步都用 live region 播报（aria-grabbed 已废弃，改用 live region 是当前做法）。 */
  var KBD = null;
  function srSay(h, msg) {
    var el = canvasEl() && canvasEl().querySelector ? canvasEl().querySelector('.anet-sr') : null;
    if (el) el.textContent = msg || '';
  }
  function kbdClear() {
    var el = global.document.querySelector('#content .anet-tile.kbd-grab');
    if (el) el.classList.remove('kbd-grab');
    KBD = null;
  }
  function anetKbdKey(ev, id, h) {
    if (!_L || !aOf(id)) return false;
    if (KBD && KBD.id === id) {
      if (ev.key === 'Escape') { kbdClear(); anetDropHl(h, null); srSay(h, '已取消，位置没变'); return true; }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        var i = KBD.ci + (ev.key === 'ArrowRight' ? 1 : -1);
        if (i < 0 || i >= _L.cols.length) { srSay(h, '已经到头了'); return true; }
        KBD.ci = i;
        var col = _L.cols[i];
        anetDropHl(h, { k: 'col', col: col });
        srSay(h, '目标：' + col.name + '，回车确认，Esc 取消');
        return true;
      }
      /* ↑/↓ 也要吃掉：浏览器默认会用方向键**滚动页面**，
         画布会跟着往上/下跳（实测按一下 ↓ 整块画布移了 40px）——
         拿着卡片的时候页面不该动。上下换层目前只有鼠标纵向拖，键盘给个说明。 */
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        srSay(h, '左右方向键换业务线，回车确认，Esc 取消；上下换层请用鼠标纵向拖动');
        return true;
      }
      if (ev.key === 'Enter' || ev.key === ' ') {
        var col2 = _L.cols[KBD.ci], a = aOf(id), same = (col2.biz === a.biz);
        kbdClear(); anetDropHl(h, null);
        if (same) { srSay(h, '位置没变'); return true; }
        srSay(h, '已把「' + a.name + '」放到' + col2.name);
        ACTIONS['anet-rebiz'](id + '|' + col2.biz, null, h);
        return true;
      }
      return false;
    }
    if (ev.key === ' ' || ev.key === 'Enter') {
      var a2 = aOf(id), ci = -1;
      for (var k = 0; k < _L.cols.length; k++) if (_L.cols[k].biz === a2.biz) ci = k;
      if (ci < 0) return false;
      KBD = { id: id, ci: ci };
      var nodeEl = global.document.querySelector('#content .anet-tile[data-id="' + id + '"]');
      if (nodeEl) nodeEl.classList.add('kbd-grab');
      anetDropHl(h, { k: 'col', col: _L.cols[ci] });
      srSay(h, '已拿起「' + a2.name + '」（当前 ' + _L.cols[ci].name + '）。左右方向键选择业务线，回车确认，Esc 取消');
      return true;
    }
    return false;
  }
  global.__anetKbdKey = anetKbdKey;

  function anetDragTip(h, txt) {
    var el = global.document.querySelector('#content .anet-dragtip');
    if (!el) return;
    el.textContent = txt || '';
    el.style.display = txt ? 'block' : 'none';
  }

  function anetDrag(ev, id, h) {
    var canvas = ev.currentTarget && ev.currentTarget.closest ? ev.currentTarget.closest('.anet-canvas') : null;
    if (!canvas || !_L) return;
    /* 隔离区里的卡片也要能拖：它不在 _L.pos（树上）而在 _L.isoCards。
       旧判断 `!_L.pos[id]` 直接 return，于是「拖进隔离区」有进无出 —— 孤岛再也拖不动，
       只能靠撤销回去。现在可以从隔离区拖到树上某张卡上建立联系，从而回到图上。 */
    var inTree = !!_L.pos[id], isoPos = null;
    for (var _i = 0; _i < _L.isoCards.length; _i++) if (_L.isoCards[_i].id === id) isoPos = _L.isoCards[_i];
    if (!inTree && !isoPos) return;
    var rect = canvas.getBoundingClientRect();
    var nodeEl = ev.currentTarget, sx = ev.clientX, sy = ev.clientY, moved = false;
    /* 捕获指针：触屏/笔滑出卡片后仍然收得到 move，否则手一移出卡片拖动就断了 */
    try { if (nodeEl.setPointerCapture && ev.pointerId != null) nodeEl.setPointerCapture(ev.pointerId); } catch (e) {}
    var a = aOf(id);
    function toWorld(cx, cy) {
      var v = viewS(h);
      return { x: (cx - rect.left - v.tx) / (v.k || 1), y: (cy - rect.top - v.ty) / (v.k || 1) };
    }
    /* 落点在第几层：取最近的层（卡片中心 ±(半高+24) 内算命中），用于纵向拖 */
    function rowAt(p) {
      if (!_L.rows.length) return null;
      var best = null;
      for (var i = 0; i < _L.rows.length; i++) {
        var rr = _L.rows[i], yc = _L.yRow[rr] + AZ.CH / 2, d = Math.abs(p.y - yc);
        if (!best || d < best.d) best = { row: rr, d: d };
      }
      if (!best) return null;
      /* 吸附到最近一行，不再只认「卡中心 ±68px」的窄带（2026-10-24）。
         旧写法的后果：行与行之间有标签车道，空隙比容差宽 —— 拖到空隙就返回 row=null，
         于是纵拖被当成"横拖改归属"，弹一句「横向要拖到别的列」的文不对题提示。
         现在只要落点在行区范围内就吸到更近的那行，拖到哪儿都不落空。 */
      var top = _L.yRow[_L.rows[0]] - AZ.CH * 0.8;
      var bot = _L.yRow[_L.rows[_L.rows.length - 1]] + AZ.CH * 1.6 + 40;
      if (p.y < top || p.y > bot) return null;
      return best.row;
    }
    function hit(cx, cy, p) {
      var iso = global.document.querySelector('#content .anet-iso');
      if (iso && iso.getBoundingClientRect) {
        var r = iso.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return { k: 'iso' };
      }
      /* 先看孤岛卡片：落在一张孤岛上，等价于放进隔离区（不必非要对准面板空白） */
      for (var q = 0; q < _L.isoCards.length; q++) {
        var ic = _L.isoCards[q];
        if (ic.id === id) continue;
        if (Math.abs(p.x - ic.x) <= AZ.CW / 2 && Math.abs(p.y - ic.y) <= AZ.CH / 2) return { k: 'iso' };
      }
      for (var i = 0; i < _L.cards.length; i++) {
        var t = _L.cards[i];
        if (t.id === id) continue;
        if (Math.abs(p.x - t.x) <= AZ.CW / 2 && Math.abs(p.y - t.y) <= AZ.CH / 2) return { k: 'card', id: t.id, row: rowAt(p) };
      }
      for (var j = 0; j < _L.cols.length; j++) {
        var col = _L.cols[j];
        if (p.x >= col.x - 13 && p.x <= col.x + col.w + 13) return { k: 'col', col: col, biz: col.biz, name: col.name, row: rowAt(p) };
      }
      var r0 = rowAt(p);
      if (r0 != null) return { k: 'row', row: r0 };
      return { k: 'none' };
    }
    function onMove(e2) {
      if (e2.buttons === 0) { onUp(e2); return; }    /* 没按键了就当抬手（防残留监听） */
      var dx = e2.clientX - sx, dy = e2.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      nodeEl.classList.add('dragging');
      nodeEl.style.transform = 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px)';
      var t = hit(e2.clientX, e2.clientY, toWorld(e2.clientX, e2.clientY));
      /* 纵拖要看得见"会落到第几层"：hit 先命中列（列范围覆盖整个图表区），
         直接拿 t 去高亮就只能亮整列，用户根本看不出落点在哪一层。
         所以纵拖时把落点降级成"行"，高亮那条行带 + 提示第 N 层。 */
      var vdrag = Math.abs(dy) > Math.abs(dx) * 1.2;
      var hl = (vdrag && t.row != null && t.k !== 'iso' && t.k !== 'card') ? { k: 'row', row: t.row } : t;
      anetDropHl(h, hl);
      anetDragTip(h, t.k === 'iso' ? '松手 = 断开「' + a.name + '」的全部联系'
        : t.k === 'card' ? '松手 = 给「' + a.name + '」建立一条联系（人工标注）'
        : (vdrag && t.row != null) ? '松手 = 把「' + a.name + '」放到第 ' + t.row + ' 层（只改层级，委派不变）'
        : (t.k === 'col' && t.biz !== a.biz) ? '松手 = 把「' + a.name + '」的归属改到 ' + t.name
        : '');
    }
    function onUp(e2) {
      global.document.removeEventListener('pointermove', onMove);
      global.document.removeEventListener('pointerup', onUp);
      nodeEl.classList.remove('dragging');
      nodeEl.style.transform = '';
      anetDropHl(h, null); anetDragTip(h, '');
      if (!moved) return;
      /* 拖完置 data-dragged：app.js 的 click 捕获靠它屏蔽尾随的那次点击，
         否则"挪一下"会顺带把卡片选中（旧拖动会设，新拖动漏了，等于屏蔽失效）。 */
      nodeEl.setAttribute('data-dragged', '1');
      var dx = e2.clientX - sx, dy = e2.clientY - sy;
      var t = hit(e2.clientX, e2.clientY, toWorld(e2.clientX, e2.clientY));
      var rule = anetDropRules(id, t, { inTree: inTree, a: a, h: h, dy: dy, dx: dx });
      /* 调试用：设了 window.__anetDbg 才写（回归脚本靠它看"为什么这一拖没落地"） */
      if (global.__anetDbg) {
        try { global.__anetDbg({ id: id, t: t, rule: rule, curRow: _L.pos[id] && _L.pos[id].row, dx: dx, dy: dy }); } catch (e) {}
      }
      if (!rule.ok) return h.toast(rule.reason, rule.tone || 'info');
      if (rule.kind === 'setrow') return ACTIONS['anet-setrow'](id + '|' + rule.row, null, h);
      if (rule.kind === 'detach') return ACTIONS['anet-detach'](id, null, h);
      if (rule.kind === 'link') return ACTIONS['anet-link-open'](id + '|' + t.id, null, h);
      if (rule.kind === 'rebiz') return ACTIONS['anet-rebiz'](id + '|' + t.biz, null, h);
      anetDragTip(h, '');
      h.toast(rule.note, 'info');
    }
    global.document.addEventListener('pointermove', onMove);
    global.document.addEventListener('pointerup', onUp);
  }
  global.__anetDrag = anetDrag;

  /* 右键菜单（对标 eNSP 的右键）：对着节点给"聚焦 / 进详情 / 断开 / 新增联系"，对着边给"看依据 / 删除"。
     ⚠ 旧代码用 t.closest('line[data-ei]') 找边，而 .anet-edges{pointer-events:none} 让整层边都不可命中 ——
     那个分支恒为 null，「删除这条边」在界面上根本没有入口。现在边有独立的透明命中线（.anet-flowhit），
     并在这里按 data-e 取键。 */
  function anetMenu(ev, h) {
    var t = ev.target;
    var nodeEl = t.closest ? t.closest('.anet-tile[data-id]') : null;
    var lineEl = t.closest ? t.closest('[data-e]') : null;
    var items = [];
    if (nodeEl) {
      var id = nodeEl.getAttribute('data-id');
      var a = aOf(id);
      var H0 = histS(h);
      var curD = (H0.steps[H0.cur] || {}).detached || [];
      items = [
        { t: '聚焦到「' + (a ? a.name : id) + '」（只看一跳）', act: 'net-focus', id: id },
        { t: '进入 Agent 详情', act: 'goto-agent', id: id },
        { t: '断开它在当前口径下的全部联系…', act: 'anet-detach', id: id },
        { t: '新增委派 / 共用关系…（会改变它的层级）', act: 'anet-link-open', id: id }
      ];
      if (curD.indexOf(id) >= 0) items.push({ t: '还原刚才这次断开', act: 'anet-detach-undo', id: id });
      /* 手动摆过层的卡才给"恢复自动"：没摆过就别摆一个点了没反应的入口 */
      if (rowManual(h, id) != null) {
        items.unshift({ t: '恢复自动层级（第 ' + (_AUTOROW[id] == null ? '?' : _AUTOROW[id]) + ' 层）', act: 'anet-rowreset', id: id });
      }
      if ((h.state.agentNetFocus || null) === id) items.splice(0, 1, { t: '取消聚焦', act: 'net-focus', id: id });
    } else if (lineEl) {
      var key = lineEl.getAttribute('data-e');
      var it = _GEO[key];
      if (it) {
        items = [
          { t: '看这条边的依据与规模', act: 'net-edge', id: key },
          { t: '删除这条边（改数据）…', act: 'anet-edge-del', id: key },
          { t: '聚焦「' + aName(it.e.a) + '」', act: 'net-focus', id: it.e.a },
          { t: '进「' + aName(it.e.a) + '」的引用与依赖', act: 'goto-agent-tab', id: it.e.a + '|deps' },
          { t: '进「' + aName(it.e.b) + '」的引用与依赖', act: 'goto-agent-tab', id: it.e.b + '|deps' }
        ];
      }
    } else {
      items = [{ t: '适应窗口（f）', act: 'anet-fit', id: '*' }];
      if (manualRowCount(h)) {
        items.push({ t: '恢复全部自动层级（' + manualRowCount(h) + ' 张手动摆过）', act: 'anet-rowreset-all', id: '*' });
      }
    }
    if (!items.length) return;
    /* 同一时刻只允许一个菜单：开新的先把旧的摘掉。
       ⚠ 旧写法每次都 new 一个追加到 body，关旧的靠 setTimeout 之后才挂上的 outside-mousedown，
         右键连点两条边就会叠出两个菜单（实测就是这样）。 */
    var _olds = global.document.querySelectorAll('.anet-menu');
    for (var _oi = 0; _oi < _olds.length; _oi++) _olds[_oi].remove();
    var box = global.document.createElement('div');
    box.className = 'anet-menu';
    box.innerHTML = items.map(function (x, i) {
      return '<button data-mi="' + i + '">' + h.esc(x.t) + '</button>';
    }).join('');
    global.document.body.appendChild(box);
    var bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.min(ev.clientX, global.innerWidth - bw - 8) + 'px';
    box.style.top = Math.min(ev.clientY, global.innerHeight - bh - 8) + 'px';
    function close() {
      box.remove();
      global.document.removeEventListener('mousedown', onDoc, true);
      global.document.removeEventListener('keydown', onKey, true);
    }
    function onDoc(e2) { if (!box.contains(e2.target)) close(); }
    function onKey(e2) { if (e2.key === 'Escape') close(); }
    box.addEventListener('click', function (e2) {
      var b = e2.target.closest ? e2.target.closest('button[data-mi]') : null;
      if (!b) return;
      var it2 = items[+b.getAttribute('data-mi')];
      close();
      if (it2) ACTIONS[it2.act] && ACTIONS[it2.act](it2.id, null, h);
    });
    global.setTimeout(function () {
      global.document.addEventListener('mousedown', onDoc, true);
      global.document.addEventListener('keydown', onKey, true);
    }, 0);
  }
  global.__anetMenu = anetMenu;

  /* 指标卡「孤立隔离」下钻：把隔离区滚到眼前（隔离区始终在屏上，这里只做定位强调） */
  ACTIONS['agentw-iso'] = function (id, btn, h) {
    var el = global.document && global.document.querySelector ? global.document.querySelector('#content .anet-iso') : null;
    if (!el) return;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('anet-flash');
    global.setTimeout(function () { el.classList.remove('anet-flash'); }, 1200);
  };

  /* SECTION: tab-bar（renderers.js 的 agentList 调用；放在这里是因为它要算隔离数做角标） */
  global.UI = global.UI || {};
  global.UI.agentWbTabs = function (h, active) {
    return tabsHtml(h, active, buildGraph(h.state));
  };
})(window);
