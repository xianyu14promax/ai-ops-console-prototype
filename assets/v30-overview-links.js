/* ============================================================================
 * v30-overview-links.js · 总览（第 1 屏）入口接线（2026-10-12）
 *
 * 职责：把 renderers.js 已经画出来、但**一直没有注册**的动作补上，并让每个入口
 *       落到「真正能处理这件事」的页签/视图上。
 *   · goto-todo   —— 待办条（data-id = "<cap>|<todoId>"）
 *   · goto-drill  —— 异常指标卡（data-id = "<metric>|<当前值>|<阈值>|<区间标签>"）
 *   · inc-ack     —— 事故「确认知悉」（data-id = "<incId>"）
 *   · inc-close   —— 事故「关闭并复盘」（data-id = "<incId>"）
 *   · todo-clear  —— 待办定位横幅的「清除定位」（shell 层按钮，无 data-id）
 *   · goto-obj    —— 运行中任务 → 流程详情（data-id = "<cap>|<objId>"，仅在无人注册时补）
 *
 * 铁律（本仓写死多处）：
 *   ① 全 ES5（var / function，禁箭头函数、模板串、let/const）；
 *   ② 不在 renderers.js / renderers2.js 里注册任何东西，本文件只读写 global.ACTIONS；
 *   ③ **诚实**：横幅说「已过滤」就必须真的改了数据源或写了目标页真读的筛选条件，
 *      否则照旧说「列表未过滤」，绝不假装已筛选。
 *   ④ 写操作只落**本会话状态**（state.incOps / state.incAck / state.incClosed），
 *      并如实说明「刷新还原、未提交后端」，不伪造成功。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var A = (global.ACTIONS = global.ACTIONS || {});
  var R = (global.RENDERERS = global.RENDERERS || {});

  function ready(fn) {
    if (global.APP_DATA && global.ACTIONS) { fn(); return; }
    var t = global.setInterval(function () {
      if (global.APP_DATA && global.ACTIONS) { global.clearInterval(t); fn(); }
    }, 25);
  }

  ready(function () {
    var Q = global.QUERY || {};
    var S = global.DATA_SEED || {};

    /* 事故表：优先用 QUERY 的取数口，取不到再扫种子数据（两条路都指向同一份 S.INCIDENTS） */
    function incidentOf(id) {
      if (Q.incident) return Q.incident(id);
      var list = S.INCIDENTS || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    /* 当前用户：与 v19-governance-fix.js / app.js 同一身份源，只读 */
    function meName() {
      if (global.V19GOV && global.V19GOV.me) return global.V19GOV.me().name;
      var cu = global.CURRENT_USER;
      if (cu && typeof cu === 'object') return cu.name || cu.id || '我';
      return cu || '我';
    }
    function clip(s, n) {
      var t = String(s == null ? '' : s);
      return t.length > n ? (t.slice(0, n) + '…') : t;
    }
    /* 「近 24 小时 / 近 7 天」这类**标签** → range key。指标卡带的是给人看的标签，
       不是 key；映射不上就保持当前区间（并如实说明），不猜。 */
    function rangeKeyOf(label) {
      var raw = String(label == null ? '' : label).trim();
      if (!raw) return null;
      var RANGES = (Q.RANGES || {});
      if (RANGES[raw]) return raw;
      var keys = Object.keys(RANGES);
      for (var i = 0; i < keys.length; i++) {
        var L = String(RANGES[keys[i]].label || '').replace(/\s+/g, '');
        if (L && L === raw.replace(/\s+/g, '')) return keys[i];
      }
      return null;
    }
    function rangeText(key) {
      var RANGES = (Q.RANGES || {});
      return (RANGES[key] && RANGES[key].label) || key || '当前区间';
    }
    function findTodo(todoId) {
      var list = (global.APP_DATA.getTodos ? global.APP_DATA.getTodos() : []) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === todoId) return list[i];
      return null;
    }

    /* ==================================================================
     * ① 待办条 → 目标屏 + **真正要处理的那个 Tab/视图**
     * data-id = "<cap>|<todoId>"（renderers.js 的待办聚合块写入）
     *
     * 五条待办各自的落点与「是否真筛」：
     *   td-appr    审批页（首表即「待我审批」）
     *   td-badcase obs 的 badcase 页签
     *   td-comp    合规页（首块即「待人工复核」）
     *   td-gray    Agent 工作台 —— **真筛**：只留 grayVersion 非空的 Agent（见文件尾部的数据源收窄）
     *   td-exp     经验库 —— **真筛**：写 state.filters.expState = 'warn'（该页真读它）
     * （2026-10-20：td-wf / Workflow 页下线，所以这里只剩五条）
     * ================================================================== */
    A['goto-todo'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var capId = p[0] || '', todoId = p[1] || '';
      var t = findTodo(todoId);
      /* cap 以 data-id 为准（渲染层已带），拿不到再退回待办自身的 target.cap */
      if (!capId && t && t.target) capId = t.target.cap || '';
      var c = capId ? h.capById(capId) : null;
      if (!c || c.__miss) {
        h.toast('该待办没有可达的目标屏（' + (capId || '未知') + '）—— 入口未接线', 'bad');
        return;
      }
      /* 横幅内容全部来自 getTodos()，不另造文案（kind / text / count 与总览待办条一字不差） */
      var f = {
        todoId: todoId, cap: c.id,
        label: t ? t.kind : '待办',
        text: t ? t.text : '',
        at: Date.now()
      };
      var next = {
        domain: c.domain, cap: c.id,
        agentId: null, objId: null, tab: null, objTab: null, traceId: null, page: 1
      };

      if (todoId === 'td-badcase') {
        next.domain = 'platform'; next.cap = 'obs'; next.tab = 'badcase';
        f.filtered = '已切到「badcase 管理」页签（列表未过滤）';
      } else if (todoId === 'td-exp') {
        /* **真筛**：经验库列表 viewItems 按 _ef.expState 过滤（renderers2 的 queuePage） */
        h.state.filters = Object.assign({}, h.state.filters, { expState: 'warn' });
        f.filtered = '已按状态「待复核」过滤';
      } else if (todoId === 'td-gray') {
        /* **真筛**：见文件尾部 —— 渲染期间把 Agent 列表的数据源临时收窄到 grayVersion 非空的那些 */
        var total = 0;
        try { total = (h.query.agentTable(h.state.range).rows || []).length; } catch (e) { total = 0; }
        f.filtered = '已按「灰度中」过滤：' + (t ? t.count : '—') + (total ? ' / ' + total : '') + ' 个 Agent';
      } else if (todoId === 'td-appr') {
        /* 审批页没有筛选控件，但它第一张表就是「待我审批」，过滤条件与 data.js buildTodos 同口径 */
        f.filtered = '目标页首表即「待我审批」（同口径）';
      } else if (todoId === 'td-comp') {
        f.filtered = '目标页首块即「待人工复核」（同口径）';
      } else {
        /* 未识别的待办：不做任何筛选，也不编造「已过滤」 */
        f.filtered = '';
      }
      h.state.todoFocus = f;
      h.navigate(next);
      h.toast('已定位到「' + f.label + '」：' + (f.filtered || '列表未过滤'), 'info');
    };

    /* ==================================================================
     * ② 指标卡下钻（C-1b）
     * data-id = "<metric>|<当前值>|<阈值>|<区间标签>"，兼容只传 "<metric>" 的旧写法。
     *   successRate → obs › Trace 检索，**真筛** status=failed（traceSearchBlock 读 state.filters）
     *   p99         → obs › Trace 检索，**真筛** minLatency=阈值档（下拉只有 2/4/8/30s 四档）
     *   cost/tokens → 成本页 + **带上该指标卡所在的区间**（成本页所有数字都按 state.range 重算）
     *   calls       → Agent 工作台并**按调用量倒序**（该页无「按调用量筛选」维度，只有排序）
     * 筛不了的一律如实说明，不说「已筛选」。
     * ================================================================== */
    var METRIC_NAME = { calls: '调用量', successRate: '成功率', p99: 'P99 时延', cost: '成本', tokens: 'token 消耗' };
    var LAT_OPTS = [2000, 4000, 8000, 30000];
    A['goto-drill'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var metric = p[0] || '';
      var threshold = p[2] != null ? String(p[2]) : '';
      var rk = rangeKeyOf(p[3]);
      var name = METRIC_NAME[metric] || metric || '该指标';
      var rangeNote = rk ? ('区间：' + rangeText(rk)) : '区间：维持当前选择';

      if (metric === 'successRate') {
        h.state.filters = { status: 'failed' };
        h.state.page = 1;
        h.navigate({ domain: 'platform', cap: 'obs', agentId: null, objId: null, tab: 'trace', objTab: null, traceId: null, page: 1, range: rk || h.state.range });
        h.toast('已下钻到 Trace 检索并筛出「仅失败」的调用' + (threshold ? '（告警阈值 ' + threshold + '）' : '') + ' · ' + rangeNote, 'info');
        return;
      }
      if (metric === 'p99') {
        /* 阈值可能不是下拉里的四档（4000 是），取「不超过阈值的最大档」，并把实际档位说清楚。
           阈值段为空（真源取不到）时**不臆造一条线**：按 4s 档筛，并在提示里说明阈值未知。 */
        var th = Number(threshold);
        if (!(isFinite(th) && th > 0)) th = null;
        var pick = LAT_OPTS[1];
        var i;
        for (i = 0; i < LAT_OPTS.length; i++) { if (th != null && LAT_OPTS[i] <= th) pick = LAT_OPTS[i]; }
        h.state.filters = { minLatency: pick };
        h.state.page = 1;
        h.navigate({ domain: 'platform', cap: 'obs', agentId: null, objId: null, tab: 'trace', objTab: null, traceId: null, page: 1, range: rk || h.state.range });
        h.toast('已下钻到 Trace 检索并筛出「时延 ≥ ' + h.fmt.dur(pick) + '」的调用'
          + (th != null && pick !== th ? '（阈值 ' + h.fmt.dur(th) + ' 不在检索下拉的档位里，取了不超过它的最大档 ' + h.fmt.dur(pick) + '）' : '')
          + (th == null ? '（指标卡未带阈值，按 4s 档展示）' : '')
          + ' · ' + rangeNote, 'info');
        return;
      }
      if (metric === 'cost' || metric === 'tokens') {
        h.state.page = 1;
        h.navigate({ domain: 'platform', cap: 'cost', agentId: null, objId: null, tab: null, objTab: null, traceId: null, page: 1, range: rk || h.state.range });
        h.toast('已下钻到成本归因（按业务线 / 模型 / Agent 归因）· ' + rangeNote
          + (metric === 'tokens' ? ' · token 消耗在本页按模型与 Agent 拆分' : ''), 'info');
        return;
      }
      if (metric === 'calls') {
        /* 诚实：Agent 工作台**没有**「按调用量筛选」维度，能做的真实动作是排序（h.table 读 state.sortKey） */
        h.state.sortKey = 'calls';
        h.state.sortDir = 'desc';
        h.state.page = 1;
        h.navigate({ domain: 'platform', cap: 'agent-wb', agentId: null, objId: null, tab: null, objTab: null, traceId: null, page: 1 });
        h.toast('已下钻到 Agent 工作台并按「调用量」倒序 —— 该页没有按调用量筛选的维度，只有排序；' + rangeNote, 'info');
        return;
      }
      /* 未知指标：不假装能筛，跳到归因页并说明 */
      h.navigate({ domain: 'platform', cap: 'cost', agentId: null, objId: null, tab: null, objTab: null, traceId: null, page: 1, range: rk || h.state.range });
      h.toast('「' + name + '」在检索与成本两页都没有对应的筛选维度，已跳到成本归因页；' + rangeNote, 'info');
    };

    /* ==================================================================
     * ③ 事故：确认知悉 / 关闭并复盘
     * data-id = "<incId>"（renderers.js 的事故流水块写入）
     * 只写**本会话状态**：state.incAck / state.incClosed 是渲染层读的那两个键
     * （renderers.js 用它算三态 open / ack / resolved），state.incOps 记完整留痕。
     * 不伪造「已提交后端」。
     * ================================================================== */
    A['inc-ack'] = function (id, btn, h) {
      var inc = incidentOf(id);
      if (!inc) { h.toast('未找到该事故', 'bad'); return; }
      var at = new Date().toISOString();
      var rec = { at: at, by: meName(), note: '本会话登记：已确认知悉' };
      h.state.incOps = h.state.incOps || {};
      h.state.incOps[id] = Object.assign({}, h.state.incOps[id] || {}, { ack: rec });
      h.state.incAck = h.state.incAck || {};
      h.state.incAck[id] = rec;
      h.toast('已登记「确认知悉」：' + inc.title + '（' + inc.level + '）· 仅本会话状态，刷新还原，未提交后端', 'warn');
      if (h.navigate) h.navigate({}, { scroll: false });
    };
    A['inc-close'] = function (id, btn, h) {
      var inc = incidentOf(id);
      if (!inc) { h.toast('未找到该事故', 'bad'); return; }
      var at = new Date().toISOString();
      /* 复盘依据取自该事故自己的根因与措施（不另编）；没有就如实写「待补」 */
      var rec = {
        at: at, by: meName(),
        basis: inc.rootCause || '',
        action: inc.action || '',
        note: '本会话登记：关闭并复盘（复盘依据取该事故的根因与措施字段，无独立复盘编辑器）'
      };
      h.state.incOps = h.state.incOps || {};
      h.state.incOps[id] = Object.assign({}, h.state.incOps[id] || {}, { closed: rec });
      h.state.incClosed = h.state.incClosed || {};
      h.state.incClosed[id] = rec;
      h.toast('已登记「关闭并复盘」：根因「' + clip(inc.rootCause || '待定位', 40) + '」· 措施「'
        + (inc.action ? clip(inc.action, 24) : '待补（该事故尚未给出处置措施）')
        + '」· 仅本会话状态，刷新还原，未提交后端', 'warn');
      if (h.navigate) h.navigate({}, { scroll: false });
    };

    /* ==================================================================
     * ④ 清除待办定位（shell 层横幅里的按钮，无 data-id）
     * 清掉 todoFocus 即同时解除 td-gray 的「灰度中」收窄 —— 横幅与筛选同生同灭，不会各行其是。
     * ================================================================== */
    A['todo-clear'] = function (id, btn, h) {
      h.state.todoFocus = null;
      if (h.navigate) h.navigate({}, { scroll: false });
    };

    /* ==================================================================
     * ⑤ 运行中任务 → 对象详情（renderers.js 的「运行中任务」块：
     *    data-act="goto-obj" data-id="<cap>|<id>"；当前已无调用方，保留通用实现）
     * 语义 = 「cap|对象 id」→ 该对象的详情页（走 data.js 的 detailType 路由）。
     * 只在没人注册时补：renderers.js 先于本文件加载，若那位已经在自己的文件里注册，
     * 这里不覆盖（同一动作名两处实现必然走偏一份）。
     * ================================================================== */
    if (!A['goto-obj']) {
      A['goto-obj'] = function (id, btn, h) {
        var p = String(id == null ? '' : id).split('|');
        var c = p[0] ? h.capById(p[0]) : null;
        if (!c || c.__miss || !p[1]) { h.toast('找不到对应的详情对象（' + String(id) + '）', 'bad'); return; }
        h.navigate({
          domain: c.domain, cap: c.id,
          agentId: p[1], objId: p[1],
          tab: p[2] || null, objTab: p[2] || null, traceId: null, page: 1
        });
      };
    }

    /* ==================================================================
     * ⑤-bis 账号与权限：成员权限编辑器里的「查看角色定义 ↗」
     *    （renderers2.js 的 data-perm-editor 摘要行：data-act="rbac-tab" data-id="roles"）
     * 走查把它列为死按钮，但 renderers2.js 归 Agent 丙；动作注册不受文件归属限制，
     * 所以在这里补上，并同样用「没人注册才补」的写法 —— 丙若在自己的文件里注册了，
     * 那份先加载、这里自动让位。
     * ================================================================== */
    if (!A['rbac-tab']) {
      A['rbac-tab'] = function (id, btn, h) {
        var view = String(id == null ? '' : id).trim() || 'roles';
        /* navigate 在 hash 变化时会收掉残留弹层（closeModals），编辑器是弹层/内联都能收干净 */
        /* 2026-10-21：「账号与 Agent 权限」整页下线，这里改成落到能力与权限的权限策略分页 */
        h.navigate({
          domain: 'platform', cap: 'assets',
          agentId: null, objId: 'policy', tab: null, objTab: null, traceId: null, page: 1
        });
        h.toast('权限点按能力归类在「能力与权限」里看', 'info');
      };
    }

    /* ==================================================================
     * ⑥ td-gray 的**真筛**：Agent 列表没有筛选状态（renderers.js 的 agentList
     *    只读 state.agentView / agentPageTab / sortKey / page），所以不硬编一个没人读的键，
     *    而是在渲染期间把它的数据源 Q.agentTable 临时收窄。
     *    · 收窄只发生在 R.agentList 调用栈内（同步、单线程），总览的「需关注的 Agent」
     *      虽然也调 agentTable，但走的是另一次渲染，不受影响；
     *    · 判据是 state.todoFocus.todoId === 'td-gray' —— 横幅消失（清除定位）即恢复全量。
     * ================================================================== */
    if (R.agentList && Q.agentTable) {
      var rawAgentTable = Q.agentTable;
      var rawAgentList = R.agentList;
      var narrowGray = false;
      Q.agentTable = function () {
        var res = rawAgentTable.apply(Q, arguments);
        if (!narrowGray || !res || !res.rows) return res;
        var only = res.rows.filter(function (a) { return !!a.grayVersion; });
        /* meta 原样带回（它只有 range，没有计数），避免页脚口径被改写 */
        return { rows: only, total: only.length, meta: res.meta, narrowedFrom: res.rows.length };
      };
      Q.agentTable.__v30patched = true;
      R.agentList = function (cap, state, h) {
        var f = state && state.todoFocus;
        if (!(f && f.todoId === 'td-gray')) return rawAgentList.apply(this, arguments);
        narrowGray = true;
        try {
          return rawAgentList.apply(this, arguments);
        } finally {
          narrowGray = false;
        }
      };
      R.agentList.__v30patched = true;
    }
  });
})(window);
