/* SECTION: renderers-part2
 * 渲染层第二部分：Agent 剩余 Tab、trace 检索与详情、成本、网关、资产表、审核队列、流水线。
 * 以及全站动作处理（ACTIONS）。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS, C = global.CHARTS, APP = global.APP_DATA;
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  var pageHead = global.UI.pageHead;
  /* 切片演示语料：检索测试与「文档预览」共用这一份。
     放在模块级而不是渲染函数里 —— 渲染函数只在进检索测试时才跑，
     预览窗格在别的页面上就拿不到语料了（第一版就踩了这个坑）。 */
  var KB_SLICE_DEMO_LINES = [
      '……自签收之日起 7 日内，商品保持完好不影响二次销售的，可申请无理由退货；超出 7 日但在 15 日内且存在质量问题的，凭检测报告可走质量退货通道，运费由平台承担……',
      '……退货审核通过后，退款将在 1-3 个工作日内原路退回；若超过 3 个工作日未到账，系统自动触发加急工单并同步短信通知用户，避免二次投诉……',
      '……特殊美妆/食品类目不适用无理由退货，页面下单前需勾选确认；客服应对此类咨询时优先引导换货，话术参考「抱歉给您带来不便」开场……',
      '……跨境订单退货运费由买卖双方按责任比例分摊，平台先行垫付后从保证金扣除；关税部分不退，需在话术中提前告知用户避免纠纷……',
      '……超期退货申请需二级审批：客服提交 + 主管审核 + 风控确认，全流程 ≤ 24 小时；历史上特批通过率 37%，主要集中在大促后 3 天内……'
  ];
  global.KB_SLICE_DEMO = KB_SLICE_DEMO_LINES;

  var ASSETS = null, QUEUES = null, PIPES = null;
  function assets() { if (!ASSETS) ASSETS = APP.getAssetTables(); return ASSETS; }
  function queues() { if (!QUEUES) QUEUES = APP.getQueues(); return QUEUES; }
  function pipes() { if (!PIPES) PIPES = APP.getPipelines(); return PIPES; }

  /* SECTION: v15-agent-logs
   * Agent 详情的「运行日志」与「发布历史」两个新 Tab（renderers.js 的 AGENT_TABS 已加）。
   * 日志数据直接来自 Q.searchTraces（自带分页 / 状态筛选 / total），不另造数据。
   * Tab 条必须用 data-tab（global.UI.tabBar / app.js 的委托），不得混入 data-v10-tab。 */
  global.AGENT_TAB_RENDER = global.AGENT_TAB_RENDER || {};
  ACTIONS['v15-logf'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    h.state.logFilter = h.state.logFilter || {};
    if (p[0] === 'reset') h.state.logFilter = {};
    else h.state.logFilter[p[0]] = p[1] || '';
    h.state.page = 1;
    h.navigate({}, { scroll: false });
  };
  global.AGENT_TAB_RENDER.logs = function (a, ai, state, h) {
    var fmt = h.fmt;
    var f = state.logFilter || {};
    var pg = state.page || 1;
    var res = Q.searchTraces(state.range, { agentId: a.id, status: f.status || '' }, pg, 25);
    var cols = [
      { key: 'ts', label: '时间', render: function (r) { return '<span class="mono">' + fmt.dt(r.ts) + '</span>'; } },
      { key: 'traceId', label: 'traceId', render: function (r) { return '<button class="lnk mono" data-act="goto-trace" data-id="' + h.esc(r.traceId) + '">' + h.esc(r.traceId) + '</button>'; } },
      { key: 'version', label: '版本' },
      { key: 'intentName', label: '意图' },
      { key: 'latencyMs', label: '时延', align: 'right', render: function (r) { return '<span class="' + (r.latencyMs > 4000 ? 'bad' : '') + '">' + fmt.dur(r.latencyMs) + '</span>'; } },
      { key: 'tokens', label: 'token', align: 'right', fmt: 'int' },
      { key: 'status', label: '状态', render: function (r) { return r.status === 'failed' ? '<span class="pill bad">失败 · ' + h.esc(r.errName || '') + '</span>' : '<span class="pill ok">成功</span>'; } }
    ];
    var chips = [['全部调用', ''], ['仅失败', 'failed'], ['仅成功', 'success']].map(function (c) {
      var on = (f.status || '') === c[1];
      return '<button class="vs-btn' + (on ? ' on' : '') + '" data-act="v15-logf" data-id="status|' + h.esc(c[1]) + '">' + c[0] + '</button>';
    }).join('');
    return '<div class="card"><div class="card-h"><h3>运行日志</h3>' +
      '<span class="card-sub">按时间倒序 · 点击任意行看完整调用链</span>' +
      '<div class="view-sw" role="group">' + chips + '</div>' +
      '<button class="btn-ghost sm" data-act="v15-logf" data-id="reset|1">重置</button></div>' +
      h.table({
        columns: cols, rows: res.rows, page: pg, pageSize: 25, total: res.total,
        rowAction: 'trace', rowIdKey: 'traceId',
        emptyTitle: '该时间范围内没有调用记录', emptySub: '把右上角时间范围放大试试'
      }) + '</div>' +
      h.metaBar(res.meta || {}, [{ k: '时间范围', v: Q.RANGES[state.range].label + '；默认每页 25 条' }]);
  };
  global.AGENT_TAB_RENDER.history = function (a, ai, state, h) {
    var fmt = h.fmt;
    /* 版本记录只用真实存在的那几条（a.online / a.grayVersion），不编更早的历史 */
    var rows = [];
    if (a.grayVersion) rows.push({ v: a.grayVersion, status: 'gray', at: null, note: '灰度中 · 升级模型 + 新增合规检查节点' });
    rows.push({ v: a.online, status: 'online', at: a.publishedAt, note: '当前线上版本' });
    var m = /^v(\d+)\.(\d+)$/.exec(a.online);
    if (m) rows.push({ v: 'v' + m[1] + '.' + (Number(m[2]) - 1), status: 'history', at: a.publishedAt - 42, note: '已被 ' + a.online + ' 替换' });
    return '<div class="card"><div class="card-h"><h3>发布历史</h3>' +
      '<span class="card-sub">' + rows.length + ' 条记录 · 仅保留最近几次，更早记录按 90 天保留策略归档 · 点行看变更说明</span></div>' +
      h.table({
        columns: [
          { key: 'v', label: '版本', render: function (r) { return '<b>' + h.esc(r.v) + '</b>'; } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status === 'gray' ? 'info' : (r.status === 'online' ? 'ok' : 'idle'), r.status === 'gray' ? '灰度中' : (r.status === 'online' ? '线上' : '历史')); } },
          { key: 'at', label: '发布时间', render: function (r) { return r.at == null ? '<span class="muted">灰度中</span>' : h.esc(F.fmtDate(S.TODAY_START + r.at * S.DAY)); } },
          { key: 'note', label: '变更说明' }
        ],
        /* 出口：点版本行展开该版本自己的字段（发布人/时间/变更说明），内容取自该行，不另编。 */
        rowAction: 'row-detail', rowIdKey: 'v',
        detailHtml: function (r) {
          return '版本 ' + r.v + ' · ' + (r.status === 'gray' ? '灰度中' : (r.status === 'online' ? '当前线上' : '历史版本')) +
            (r.at == null ? '' : ' · ' + F.fmtDate(S.TODAY_START + r.at * S.DAY)) +
            ' · 变更说明：' + (r.note || '—');
        },
        rows: rows, noPaging: true
      }) + '</div>' +
      '<div class="card"><div class="card-h"><h3>发布相关操作</h3><span class="card-sub">与「版本与发布」Tab 同一套动作，回到那里执行</span></div>' +
      '<div class="gray-acts"><button class="btn-ghost" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|versions">去版本与发布 →</button></div></div>' +
      h.metaBar({}, [{ k: '数据来源', v: '版本记录来自该 Agent 的线上/灰度版本字段，不含变更单号' }]);
  };

  /* SECTION: tab-quality */
  global.AGENT_TAB_RENDER = global.AGENT_TAB_RENDER || {};
  global.AGENT_TAB_RENDER.quality = function (a, ai, state, h) {
    var fmt = h.fmt;
    var k = Q.kpi(state.range, { agentIdx: ai });
    var bcs = queues().badcase.items.filter(function (x) { return x.agentId === a.id; });
    var reasonAgg = {};
    bcs.forEach(function (b) { reasonAgg[b.reason] = (reasonAgg[b.reason] || 0) + 1; });

    // 评估得分：按日确定性生成，保证刷新不变，且与真实失败率负相关
    var scoreSeries = [];
    for (var d = -13; d <= 0; d++) {
      var dr = F.dailyRow(ai, d);
      if (!dr.calls) continue;
      var r = S.R.of('score|' + a.id + '|' + d);
      var base = 82 + (dr.successRate != null ? (dr.successRate - 0.98) * 900 : 0);
      scoreSeries.push({ dayOffset: d, date: dr.date, score: Math.max(58, Math.min(97, Math.round(base + (r() - 0.5) * 7))), calls: dr.calls, sr: dr.successRate });
    }
    var maxS = 100, minS = 55;
    var scorePath = scoreSeries.map(function (p, i) {
      var x = (i / Math.max(1, scoreSeries.length - 1)) * 100;
      var y = 100 - ((p.score - minS) / (maxS - minS)) * 100;
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');

    var reasonRows = Object.keys(reasonAgg).map(function (r) {
      return { label: r, value: reasonAgg[r], display: String(reasonAgg[r]) };
    });

    return '<div class="metrics">' + [
      { label: '评估得分（最新）', value: scoreSeries.length ? scoreSeries[scoreSeries.length - 1].score : '—', unit: '分', sub: '阈值 85，低于阈值不可发布', alert: scoreSeries.length ? scoreSeries[scoreSeries.length - 1].score < 85 : false, definition: '内置回归集 + 模型裁判综合打分（准确性/完整性/安全性/格式合规）' },
      { label: 'badcase 率', value: fmt.pct2(1 - (k.successRate || 1)), alert: (1 - (k.successRate || 1)) > 0.02, sub: '失败 ' + fmt.int(k.fails) + ' / ' + fmt.compact(k.calls), definition: '失败调用占比；badcase 队列另含用户踩与评估发现的非失败问题' },
      { label: '待处理 badcase', value: String(bcs.filter(function (b) { return b.status === 'warn'; }).length), unit: '条', sub: '共 ' + bcs.length + ' 条关联记录' },
      { label: '用户反馈', value: '👍 4.1 / 5', sub: '踩：答非所问 42% · 信息错误 31% · 太慢 18% · 格式乱 9%', definition: '会话结束后弹窗采集，踩需选择原因' }
    ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>评估得分趋势（近 14 天）</h3>' +
      '<span class="card-sub">红虚线为发布阈值 85 分</span>' +
      '<button class="btn-ghost sm" data-act="create-open" data-id="obs">发起评估</button></div>' +
      (scoreSeries.length > 1 ?
        '<div class="score-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<line x1="0" y1="' + (100 - ((85 - minS) / (maxS - minS)) * 100).toFixed(2) + '" x2="100" y2="' + (100 - ((85 - minS) / (maxS - minS)) * 100).toFixed(2) + '" stroke="#dc2626" stroke-width="0.6" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>' +
        '<polyline points="' + scorePath + '" fill="none" stroke="#2563eb" stroke-width="1.4" vector-effect="non-scaling-stroke"/>' +
        scoreSeries.map(function (p, i) {
          var x = (i / (scoreSeries.length - 1)) * 100, y = 100 - ((p.score - minS) / (maxS - minS)) * 100;
          return '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="1.1" fill="' + (p.score < 85 ? '#dc2626' : '#2563eb') + '" vector-effect="non-scaling-stroke"><title>' + C.esc(p.date + ' · ' + p.score + ' 分 · ' + p.calls + ' 次调用') + '</title></circle>';
        }).join('') +
        '</svg><div class="score-axis"><span>' + h.esc(scoreSeries[0].date) + '</span><span>' + h.esc(scoreSeries[scoreSeries.length - 1].date) + '</span></div></div>'
        : '<div class="empty"><div class="empty-title">暂无评估记录</div></div>') +
      '</div>' +

      '<div class="grid2">' +
      '<div class="card"><div class="card-h"><h3>失败原因分类</h3><span class="card-sub">来自 ' + bcs.length + ' 条 badcase</span></div>' +
      (reasonRows.length ? C.barChart(reasonRows, { colorFn: function () { return '#d97706'; } }) : '<div class="empty"><div class="empty-title">无关联 badcase</div></div>') +
      '</div>' +
      '<div class="card"><div class="card-h"><h3>处置闭环</h3>' +
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|quality" title="到「质量与 badcase」Tab 逐条认领与处置">去处置 →</button></div>' +
      '<div class="loop-steps">' +
      '<div class="loop"><b>' + bcs.length + '</b><span>已发现</span></div><i>→</i>' +
      '<div class="loop"><b>' + bcs.filter(function (b) { return b.owner; }).length + '</b><span>已认领</span></div><i>→</i>' +
      '<div class="loop"><b>' + bcs.filter(function (b) { return b.status === 'info'; }).length + '</b><span>处理中</span></div><i>→</i>' +
      '<div class="loop"><b>0</b><span>已转测试用例</span></div>' +
      '</div>' +
      '<div class="bt-warn">⚠ 尚未有 badcase 转为回归测试用例。这一步把一次性故障变成永久防护网，' +
      '是闭环里最容易被省略的动作 —— 转化率已纳入埋点监控。</div>' +
      '<div class="bt-note" style="margin-left:0">需要后端能力的操作，本稿未提供入口：批量转为回归测试用例要能写入回归集并触发一次基线复跑，' +
      '本原型没有回归集写入口，因此这里只展示转化率口径，不给按钮。</div>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>badcase 队列</h3>' +
      '<span class="card-sub">该 Agent 的失败样本 · 未认领条目点击「认领」接手处理</span></div>' +
      h.table({
        columns: [
          { key: 'level', label: '级别', render: function (r) { return h.pill(r.levelKind, r.level); } },
          { key: 'reason', label: '失败原因' },
          { key: 'source', label: '来源' },
          { key: 'waitMin', label: '等待', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.waitMin > 1440 ? 'bad' : '') + '">' + fmt.wait(r.waitMin) + '</span>'; } },
          { key: 'owner', label: '认领人', render: function (r) { var c2 = (h.state.claims || {})[r.id]; return c2 ? h.esc(c2) : (r.owner ? h.esc(r.owner) : '<button class="lnk" data-act="fb-claim" data-id="' + h.esc(r.id) + '">认领</button>'); } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          /* 操作列只留「审阅」：审阅=看这条 badcase 的全部字段与处置建议（并可在会话内认领 / 标记已审）。
             「转测试用例」已撤回 —— 它需要的回归集写入能力本稿没有，留着只会弹一句空话。 */
          { key: 'act', label: '操作', render: function (r) { return '<button class="lnk" data-act="demo-badcase-review" data-id="' + h.esc(r.id) + '">审阅</button>'; } }
        ],
        rows: bcs, noPaging: true,
        emptyTitle: '该 Agent 暂无 badcase', emptySub: '可切换到「可观测与评估」查看全平台 badcase 队列'
      }) + '</div>' +
      h.metaBar(k.meta);
  };

  /* SECTION: tab-cost */
  global.AGENT_TAB_RENDER.cost = function (a, ai, state, h) {
    var fmt = h.fmt;
    var k = Q.kpi(state.range, { agentIdx: ai });
    var modelRows = Q.groupBy(state.range, 'model', { agentId: a.id }).rows;
    var intentRows = Q.groupBy(state.range, 'intent', { agentId: a.id }).rows;
    var biz = S.BIZ_LINES[S.idx.biz[a.biz]];

    // 节点级成本：从真实 trace 聚合各节点的 token 消耗
    var nodeCost = {};
    var traces = Q.searchTraces(state.range, { agentId: a.id }, 1, 60).rows;
    var mm = S.MODELS[S.idx.model[a.model]];
    traces.forEach(function (t) {
      var d = F.getTrace(t.traceId);
      if (!d) return;
      d.spans.forEach(function (sp) {
        if (!sp.tokensIn && !sp.tokensOut) return;
        var mk = sp.model || a.model;
        var m = S.MODELS[S.idx.model[mk]] || mm;
        var c = (sp.tokensIn / 1000) * m.inPer1k + (sp.tokensOut / 1000) * m.outPer1k;
        if (!nodeCost[sp.name]) nodeCost[sp.name] = { name: sp.name, kind: sp.kind, cost: 0, tok: 0, n: 0 };
        nodeCost[sp.name].cost += c; nodeCost[sp.name].tok += sp.tokensIn + sp.tokensOut; nodeCost[sp.name].n++;
      });
    });
    var nodeRows = Object.keys(nodeCost).map(function (k2) {
      var x = nodeCost[k2];
      x.avgCost = x.cost / x.n;
      x.share = k.cost ? x.cost / (Object.keys(nodeCost).reduce(function (s, y) { return s + nodeCost[y].cost; }, 0)) : 0;
      return x;
    }).sort(function (x, y) { return y.cost - x.cost; });

    var daily = [];
    for (var d = -13; d <= 0; d++) { var dr = F.dailyRow(ai, d); if (dr.calls) daily.push({ date: dr.date, cost: dr.cost, calls: dr.calls }); }

    return '<div class="metrics">' + [
      { label: '区间成本', value: fmt.money2(k.cost), deltaHtml: fmt.delta(k.compare.cost, { higherIsBetter: false }), definition: k.meta.definitions.cost },
      { label: '单次调用成本', value: fmt.money4(k.calls ? k.cost / k.calls : null), sub: 'P50 时延 ' + fmt.dur(k.p50), definition: '区间总成本 / 区间调用次数' },
      { label: 'token 消耗', value: fmt.compact(k.tokens), sub: '入 ' + fmt.compact(k.tokIn) + ' / 出 ' + fmt.compact(k.tokOut), definition: '输入与输出 token 分别计价' },
      { label: '重试浪费', value: fmt.money2(k.retryWaste), alert: k.retryWaste > k.cost * 0.03, sub: k.cost ? '占 ' + fmt.pct1(k.retryWaste / k.cost) : '—', definition: k.meta.definitions.retryWaste },
      { label: '业务线预算占用', value: biz ? fmt.pct1(k.cost / biz.budget) : '—', sub: biz ? '本月预算 ' + fmt.money(biz.budget) : '', alert: biz ? k.cost / biz.budget > 0.8 : false }
    ].map(h.metricCard).join('') + '</div>' +

      '<div class="card" data-static="1" title="只读说明：14 日成本柱只作趋势展示（与成本页「每日成本」同性质）；按模型/意图的可下钻拆解在下方两张表。"><div class="card-h"><h3>每日成本趋势</h3><span class="card-sub">近 14 天</span></div>' +
      (daily.length > 1 ? '<div class="mini-bars">' + daily.map(function (p) {
        var max = Math.max.apply(null, daily.map(function (x) { return x.cost; })) || 1;
        return '<div class="mb" title="' + h.esc(p.date + ' · ' + fmt.money2(p.cost) + ' · ' + p.calls + ' 次调用') + '">' +
          '<i style="height:' + ((p.cost / max) * 100).toFixed(1) + '%"></i><span>' + h.esc(p.date.slice(5)) + '</span></div>';
      }).join('') + '</div>' : '<div class="empty"><div class="empty-title">暂无数据</div></div>') + '</div>' +

      '<div class="grid2">' +
      '<div class="card"><div class="card-h"><h3>按模型拆解</h3><span class="card-sub">点模型看该 Agent 用它的调用明细</span></div>' +
      h.table({
        columns: [
          { key: 'label', label: '模型', render: function (r) { return '<button class="lnk" data-act="agent-cost-traces" data-id="' + h.esc(a.id + '|模型 ' + r.label) + '">' + h.esc(r.label) + '</button>'; } },
          { key: 'calls', label: '调用', align: 'right', fmt: 'int' },
          { key: 'cost', label: '成本', align: 'right', render: function (r) { return fmt.money2(r.cost); } },
          { key: 'share', label: '占比', align: 'right', fmt: 'pct1' },
          { key: 'unit', label: '单价(入/出 每千tok)', render: function (r) { var m = S.MODELS[S.idx.model[r.key]]; return m ? ('¥' + m.inPer1k + ' / ¥' + m.outPer1k) : '—'; } }
        ],
        rows: modelRows, noPaging: true
      }) + '</div>' +
      '<div class="card"><div class="card-h"><h3>按意图拆解</h3><span class="card-sub">成本按调用占比分摊（近似）· 点意图看调用明细</span></div>' +
      h.table({
        columns: [
          { key: 'label', label: '意图', render: function (r) { return '<button class="lnk" data-act="agent-cost-traces" data-id="' + h.esc(a.id + '|意图 ' + r.label) + '">' + h.esc(r.label) + '</button>'; } },
          { key: 'calls', label: '调用', align: 'right', fmt: 'int' },
          { key: 'cost', label: '成本', align: 'right', render: function (r) { return fmt.money2(r.cost); } },
          { key: 'share', label: '占比', align: 'right', fmt: 'pct1' }
        ],
        rows: intentRows, noPaging: true
      }) + '</div></div>' +

      /* 🔴 本轮工单（Agent 丙2）：本卡此前是纯陈列（6 列数字、一个出口都没有）。
         两个真出口，各管一件事，都在块内写清去哪儿：
         ① 卡头「看节点配置 →」= goto-agent-tab "<agentId>|orchestrate"，落到该 Agent 的编排
            配置页（节点级配置的真落点）—— 拿到"这个节点是怎么配的"。
         ② 节点名 = agent-cost-traces "<agentId>|<节点名>"，落到「可观测 › trace 检索」按该 Agent
            筛出的调用明细 —— 拿到"这些钱花在哪些调用上"。**检索页没有「按节点筛选」这个维度**，
            所以那一跳只说按 Agent 收敛，动作内部会如实说明，不假装能按节点筛。 */
      '<div class="card"><div class="card-h"><h3>节点级成本</h3>' +
      '<span class="card-sub">基于 ' + traces.length + ' 条真实 trace 的 span token 聚合（样本口径，非全量）</span>' +
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(a.id) + '|orchestrate">看节点配置 →</button></div>' +
      (nodeRows.length ? h.table({
        columns: [
          { key: 'name', label: '节点', render: function (r) { return '<i class="fl-dot" style="background:' + C.KIND_COLOR[r.kind] + '"></i><button class="lnk" data-act="agent-cost-traces" data-id="' + h.esc(a.id + '|' + r.name) + '">' + h.esc(r.name) + '</button>'; } },
          { key: 'n', label: '样本', align: 'right', fmt: 'int' },
          { key: 'tok', label: 'token 合计', align: 'right', fmt: 'int' },
          { key: 'avgCost', label: '单次成本', align: 'right', render: function (r) { return fmt.money4(r.avgCost); } },
          { key: 'cost', label: '样本成本', align: 'right', render: function (r) { return fmt.money2(r.cost); } },
          { key: 'share', label: '占比', align: 'right', fmt: 'pct1' }
        ],
        rows: nodeRows, noPaging: true
      }) + '<div class="bt-note">下钻结论：找出成本占比最高的节点，检查其 top_k、循环上限与模型选择是否过度配置。' +
        '点节点名 → 「可观测 › trace 检索」按本 Agent 筛出的调用明细（检索页没有按节点筛选的维度，' +
        '节点维度的收敛只能到 Agent 这一层）；点右上「看节点配置 →」→ 本 Agent 的编排配置页。</div>'
        : '<div class="empty"><div class="empty-title">该范围内无调用样本</div></div>') +
      '</div>' +
      h.metaBar(k.meta, [{ k: '样本口径', v: '节点级成本基于抽样 ' + traces.length + ' 条 trace 聚合，用于定位占比，绝对值以「区间成本」为准' }]);
  };

  /* SECTION: tab-deps */
  /* 2026-10-18：这个渲染器现在**只渲染"谁依赖我"**（下游引用）。
     它原名叫「引用与依赖」，上半张「上游依赖（我依赖谁）」表已删 —— 那批 MCP 服务 / 知识库
     已经在「联系」里按对象列全，拓扑 chip 又标了每个节点用哪个服务，表格是第三遍。
     upstream 的构造代码随之删除（不留没人读的死代码）。 */
  global.AGENT_TAB_RENDER.deps = function (a, ai, state, h) {
    var fmt = h.fmt;
    /* 2026-10-20：Workflow 一页下线 —— 反查 Workflow 表那一段删除，
       下游引用只剩「子 Agent」一类（口径未变：仍从真实 Agent 表 join，不编清单）。 */
    var subAgents = S.AGENTS.filter(function (x) { return x.id !== a.id && x.biz === a.biz && x.id.indexOf('qa') < 0; }).slice(0, 1);

    return '<div class="card"><div class="card-h"><h3>下游引用（谁依赖我）</h3>' +
      '<span class="card-sub">' + subAgents.length + ' 项 · 下线前必须处理</span></div>' +
      (subAgents.length ? h.table({
        columns: [
          { key: 'name', label: '引用方' },
          { key: 'type', label: '类型' },
          { key: 'runs', label: '今日调用', align: 'right', fmt: 'int' },
          /* ⚠ 形态合并（2026-10-12）：原「依赖与影响面」表里这列叫「走哪个节点 / 今日调用」，
             且带一个 `状态` 列。为让**一张表承担原来两张**，这里补上状态列。
             份额口径同时修准：此前是 `Math.min(1, xr.calls / dr.calls * 0.1)` ——
             那个 ×0.1 是**没写在界面上的折算**，实测 2,576÷4,328 应得 59.5% 却显示 6.0%，
             而这个数正是用来判断下线影响面的。现在按真实占比算。 */
          { key: 'share', label: '占本 Agent 调用量', align: 'right', render: function (r) { return r.share != null ? fmt.pct1(r.share) : '—'; } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } }
        ],
        rows: subAgents.map(function (x) {
          var dr = F.dailyRow(ai, 0);
          var xr = F.dailyRow(S.idx.agent[x.id], 0);
          /* 子 Agent 的"今日调用"是它**自己**的调用量，不等于"引用本 Agent 的次数"——
             本仓没有采集后者，所以占比按真实调用量算并如实标注口径（不再偷偷打折）。 */
          return { name: x.name, type: '子 Agent', runs: xr.calls, share: dr.calls ? xr.calls / dr.calls : null, id: x.id, status: 'ok', statusText: '正常' };
        }),
        noPaging: true
      }) : '<div class="empty"><div class="empty-title">无下游引用</div><div class="empty-sub">该 Agent 可安全下线，无需通知引用方</div></div>') +
      '<div class="bt-warn">⚠ 下线保护：存在下游引用时点击「下线」会被强制拦截，弹窗列出全部引用方与预计影响，' +
      '需先一键通知引用方。绝不允许静默下线。</div>' +
      '<div class="gray-acts"><button class="btn-ghost" data-act="agent-notify-refs" data-id="' + h.esc(a.id) + '|' + (subAgents.length) + '"' +
      ' class="' + ((state && state.agOps && state.agOps[a.id] && state.agOps[a.id].notified) ? 'btn-off' : 'btn-ghost') + '"' +
      ((state && state.agOps && state.agOps[a.id] && state.agOps[a.id].notified) ? ' data-act="blocked-why" data-id="本会话已通知过引用方，避免重复打扰"' : ' data-act="agent-notify-refs"') + '>' +
      ((state && state.agOps && state.agOps[a.id] && state.agOps[a.id].notified) ? '已通知 ' + (subAgents.length) + ' 个引用方' : '通知所有引用方') + '</button>' +
      '<button class="btn-danger" data-act="agent-retire" data-id="' + h.esc(a.id) + '|' + (subAgents.length) + '">' +
      ((state && state.agOps && state.agOps[a.id] && state.agOps[a.id].retired) ? '已下线（本会话）' : '下线 Agent') + '</button></div>' +
      '</div>';
    /* 2026-10-18 合并去重（业主「把 4 页合成一页，把重复的删了」）：
       · 上游依赖卡（我依赖谁）已删 —— MCP 服务 / 知识库按对象逐条列在「联系」里，
         拓扑 chip 又标了每个节点用哪个服务，第三遍换成表格没有新信息；
       · 影响面速览卡已删 —— 下游 子 Agent 数就在上面那张下游引用卡里，
         日均调用在「运行监控」；四个数字全都有第二处出处。
       留下的是全站唯一一处「谁依赖我」的反向关系，也是下线前必须处理的出口。 */

  };

  /* SECTION: r-trace-list
   * 可观测与评估：trace 检索 + 评估任务 + badcase + 告警规则
   */
  RENDERERS.traceList = function (cap, state, h) {
    var fmt = h.fmt;
    var OBS_TABS = [{ id: 'trace', label: 'Trace 检索' }, { id: 'eval', label: '评估任务' }, { id: 'badcase', label: 'badcase 管理' }, { id: 'alert', label: '告警规则' }];
    var tab = state.tab || 'trace';
    var head = '<div class="page-head"><div class="ph-main"><div class="ph-title">' + h.esc(cap.name) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div></div>' +
      '<div class="ph-side">' + h.rangePicker(state.range) +
      '<button class="btn-primary" data-act="create-open" data-create="obs" data-primary-action>' + h.esc(cap.action) + '</button></div></div>' +
      global.UI.sessionNewBlock(state, h, 'obs', { title: '本会话发起的评估' });

    if (tab === 'trace') return head + obsTabs(h, tab) + traceSearchBlock(state, h);
    if (tab === 'eval') return head + obsTabs(h, tab) + evalBlock(state, h);
    if (tab === 'badcase') return head + obsTabs(h, tab) + badcaseBlock(state, h);
    return head + obsTabs(h, tab) + alertBlock(state, h);
  };
  function obsTabs(h, active) {
    var T = [{ id: 'trace', label: 'Trace 检索' }, { id: 'eval', label: '评估任务' },
      { id: 'badcase', label: 'badcase 管理', badge: queues().badcase.items.filter(function (b) { return b.status === 'warn'; }).length },
      { id: 'alert', label: '告警规则' }];
    return '<div class="tabs" role="tablist">' + T.map(function (t) {
      return '<button role="tab" class="tab' + (t.id === active ? ' on' : '') + '" data-tab="' + t.id + '">' + h.esc(t.label) +
        (t.badge ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function traceSearchBlock(state, h) {
    var fmt = h.fmt;
    var f = state.filters || {};
    var res = Q.searchTraces(state.range, Object.assign({ agentId: f.agentId }, f), state.page || 1, 25);
    var k = Q.kpi(state.range, f.agentId ? { agentId: f.agentId } : {});

    var chips = [];
    if (f.status) chips.push({ k: 'status', label: '状态 = ' + (f.status === 'failed' ? '失败' : '成功') });
    if (f.errCode) chips.push({ k: 'errCode', label: '错误码 = ' + Q.dimLabel('errCode', f.errCode) });
    if (f.agentId) chips.push({ k: 'agentId', label: 'Agent = ' + h.esc(S.AGENTS[S.idx.agent[f.agentId]].name) });
    if (f.intent) chips.push({ k: 'intent', label: '意图 = ' + Q.dimLabel('intent', f.intent) });
    if (f.minLatency) chips.push({ k: 'minLatency', label: '时延 ≥ ' + fmt.dur(f.minLatency) });

    var errRows = Q.groupBy(state.range, 'errCode', f.agentId ? { agentId: f.agentId } : {}).rows;

    return '<div class="metrics">' + [
      { label: '命中 trace', value: fmt.int(res.total), sub: '扫描 ' + res.meta.scannedBuckets + ' 个小时桶', definition: '符合当前筛选条件的调用条数' },
      { label: '失败数', value: fmt.int(k.fails), alert: k.fails > 0, sub: '失败率 ' + fmt.pct2(k.calls ? k.fails / k.calls : 0) },
      { label: 'P99 时延', value: fmt.dur(k.p99), alert: k.p99 > 4000, sub: 'P50 ' + fmt.dur(k.p50) + ' · P90 ' + fmt.dur(k.p90), definition: k.meta.definitions.p99 },
      { label: '受事故影响', value: k.meta.affectedRatio ? fmt.pct1(k.meta.affectedRatio) : '0%', alert: k.meta.affectedRatio > 0.05, sub: k.meta.incidentIds.length ? '事故 ' + k.meta.incidentIds.length + ' 起' : '无', definition: '落在事故时间区间内的调用占比，排查时需剔除这部分再看基线' }
    ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>检索条件</h3>' +
      (chips.length ? '<button class="btn-ghost sm" data-act="clear-filters">清除全部</button>' : '') + '</div>' +
      '<div class="filter-row">' +
      '<label>状态<select data-f="status"><option value="">全部</option><option value="failed"' + (f.status === 'failed' ? ' selected' : '') + '>仅失败</option><option value="success"' + (f.status === 'success' ? ' selected' : '') + '>仅成功</option></select></label>' +
      '<label>错误码<select data-f="errCode"><option value="">全部</option>' + S.ERROR_CODES.map(function (e) {
        return '<option value="' + e.id + '"' + (f.errCode === e.id ? ' selected' : '') + '>' + h.esc(e.name) + ' (' + e.id + ')</option>';
      }).join('') + '</select></label>' +
      '<label>Agent<select data-f="agentId"><option value="">全部</option>' + S.AGENTS.map(function (a) {
        return '<option value="' + a.id + '"' + (f.agentId === a.id ? ' selected' : '') + '>' + h.esc(a.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label>意图<select data-f="intent"><option value="">全部</option>' + S.INTENTS.map(function (i) {
        return '<option value="' + i.id + '"' + (f.intent === i.id ? ' selected' : '') + '>' + h.esc(i.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label>最小时延<select data-f="minLatency"><option value="">不限</option>' +
      [2000, 4000, 8000, 30000].map(function (v) { return '<option value="' + v + '"' + (Number(f.minLatency) === v ? ' selected' : '') + '>≥ ' + fmt.dur(v) + '</option>'; }).join('') + '</select></label>' +
      '<label class="grow">traceId<input data-f="traceId" placeholder="支持部分匹配，如 tr-1a2b" value="' + h.esc(f.traceId || '') + '"></label>' +
      '</div>' +
      (chips.length ? '<div class="chips">' + chips.map(function (c) {
        return '<span class="chip">' + h.esc(c.label) + '<button data-act="rm-filter" data-id="' + c.k + '" aria-label="移除">×</button></span>';
      }).join('') + '</div>' : '') +
      (errRows.length ? '<div class="sub-h">失败原因速览（点击下钻）</div><div class="chips">' +
        errRows.map(function (r) {
          return '<button class="chip link' + (f.errCode === r.key ? ' on' : '') + '" data-act="filter-trace" data-id="' + h.esc(r.key) + '">' +
            h.esc(r.label) + ' <b>' + r.calls + '</b></button>';
        }).join('') + '</div>' : '') +
      '</div>' +

      '<div class="card pad0"><div class="card-h pad"><h3>Trace 列表</h3>' +
      '<span class="card-sub">按时间倒序 · 点击行看完整调用链火焰图</span></div>' +
      h.table({
        columns: [
          { key: 'ts', label: '时间', sortable: true, render: function (r) { return '<span class="mono">' + fmt.dt(r.ts) + '</span>'; } },
          { key: 'traceId', label: 'traceId', mono: true, render: function (r) { return '<button class="lnk mono" data-act="goto-trace" data-id="' + h.esc(r.traceId) + '">' + h.esc(r.traceId) + '</button>'; } },
          /* v10b：Agent 名从主蓝链降为 .lnk.sub 次级链接 —— 本行 traceId 是主链（看调用链），
             Agent 名是辅助跳转，双蓝并排争抢注意力；默认正文色、hover 才亮蓝，跳转能力保留 */
          { key: 'agentName', label: 'Agent', sortable: true, render: function (r) { return '<button class="lnk sub" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(r.agentName) + '</button>'; } },
          { key: 'version', label: '版本' },
          { key: 'intentName', label: '意图', sortable: true },
          { key: 'callerName', label: '调用方', sortable: true, render: function (r) { return r.callerType === 'unknown' ? '<span class="warn" title="未标记来源，无法归因">未标记</span>' : h.esc(r.callerName); } },
          { key: 'latencyMs', label: '时延', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.latencyMs > 4000 ? 'bad' : '') + '">' + fmt.dur(r.latencyMs) + '</span>'; } },
          { key: 'tokens', label: 'token', sortable: true, align: 'right', fmt: 'int' },
          { key: 'cost', label: '成本', sortable: true, align: 'right', render: function (r) { return fmt.money4(r.cost); } },
          { key: 'status', label: '状态', sortable: true, render: function (r) { return r.status === 'failed' ? '<span class="pill bad">' + h.esc(r.errName) + '</span>' : '<span class="pill ok">成功</span>'; } }
        ],
        rows: res.rows, page: state.page || 1, pageSize: 25, total: res.total,
        rowAction: 'trace', rowIdKey: 'traceId',
        emptyTitle: '没有符合筛选条件的 trace',
        emptySub: chips.length ? '当前生效：' + chips.map(function (c) { return c.label; }).join('、') : '试试扩大时间范围',
        emptyAction: chips.length ? { act: 'clear-filters', text: '清除全部筛选' } : null
      }) + '</div>' +
      h.metaBar(res.meta, [
        { k: '检索方式', v: '跨 ' + res.meta.scannedBuckets + ' 个小时桶按条件过滤；每条 trace 由 traceId 反解定位，粘贴 ID 可直达' },
        { k: '调用方缺失', v: k.meta.attribution.coverage < 1 ? ('有 ' + fmt.int(k.meta.attribution.unknown) + ' 次调用未标记来源，列表中显示为「未标记」') : '全部调用均已标记来源' }
      ]);
  }

  function evalBlock(state, h) {
    var fmt = h.fmt;
    var tasks = [
      { id: 'ev-156', name: '周度回归评估 #156', target: '客服助手 Agent v2.3', set: '内置回归集', n: 1200, score: 88.4, status: 'ok', statusText: '已完成', by: '—', at: -1, dims: { accuracy: 0.884, complete: 0.912, safe: 0.961, format: 0.938 } },
      { id: 'ev-155', name: '幻觉检测专项', target: '知识问答 Agent v5.2', set: '幻觉测试集', n: 340, score: 76.2, status: 'warn', statusText: '进行中 812/1500', by: '—', at: 0, dims: { accuracy: 0.762, complete: 0.801, safe: 0.884, format: 0.902 } },
      { id: 'ev-154', name: '模型降级可行性评估', target: '文档摘要 Agent', set: '内置回归集', n: 800, score: 91.2, status: 'ok', statusText: '已完成', by: '—', at: -3, dims: { accuracy: 0.912, complete: 0.897, safe: 0.955, format: 0.944 } },
      { id: 'ev-153', name: 'v2.4 灰度前评估', target: '客服助手 Agent v2.4-draft', set: '回归集 + badcase', n: 1414, score: 94.8, status: 'ok', statusText: '已完成', by: '—', at: -4, dims: { accuracy: 0.921, complete: 0.934, safe: 0.972, format: 0.951 } }
    ];

    /* 🔴 本轮工单（Agent 丙2）：本卡的「采用 / 回滚」出口要带 (版本, 对象名) —— 那两个值必须取自
       本卡自己的数据，不能另抄一份示例值（否则哪天改了对比对象，按钮会指到别的版本上去）。
       所以这里把三者提出来做字段，title 也**由它们拼出来**：改一处不会两边打架。 */
    var _cmpAgent = '客服助手 Agent', _cmpBase = 'v2.3', _cmpCand = 'v2.4';
    var cmp = {
      title: '版本对比：' + _cmpAgent + ' ' + _cmpBase + '（基线） vs ' + _cmpCand + '（草稿）',
      agentName: _cmpAgent, baseVer: _cmpBase, candVer: _cmpCand,
      note: '只看总分无法决策 —— 必须能下钻到逐条样本的 diff。退化 8 例已默认展开标红。',
      dims: [
        { name: '准确性', base: 0.884, cand: 0.921, better: true },
        { name: '完整性', base: 0.912, cand: 0.934, better: true },
        { name: '安全性', base: 0.961, cand: 0.972, better: true },
        { name: '格式合规', base: 0.938, cand: 0.951, better: true },
        { name: 'P99 时延', base: 1820, cand: 2140, better: false, fmt: 'dur' },
        { name: '单次成本', base: 0.018, cand: 0.021, better: false, fmt: 'money4' }
      ],
      regressed: [
        { id: 'tc-88', input: '我要开发票，顺便问下这个能退吗', base: '正确分拆为两个意图并分别作答', cand: '只处理了退货，遗漏发票诉求', reason: '订单锁定节点误锁发票号' },
        { id: 'tc-142', input: '发票抬头写错了，退货还能继续吗', base: '说明两者独立、可并行处理', cand: '回答"请先完成退货"', reason: '同上，上下文隔离过强' },
        { id: 'tc-207', input: '发票和退货单号不是一个吧？', base: '正确区分两类单号', cand: '混用了退货单号', reason: '同上' }
      ]
    };

    return ((function () {
      var _running = tasks.filter(function (x) { return x.status !== 'ok'; });
      var _low = tasks.filter(function (x) { return x.score != null && x.score < 85; });
      var parts = [];
      if (_running.length) parts.push('<div class="bt-note">⚠ ' + _running.length + ' 个评估进行中：' + _running.map(function (x) { return h.esc(x.target); }).join('、') + '。</div>');
      if (_low.length) parts.push('<div class="bt-note">⚠ ' + _low.length + ' 个评估得分低于阈值 85，需定位低分维度或重跑：' + _low.map(function (x) { return h.esc(x.target) + '(' + x.score + ')'; }).join('、') + '。</div>');
      return '<div class="card" data-static="1" title="只读说明：本块是按状态归类的汇总提示；可操作的评估任务在下方「评估任务」表。"><div class="card-h"><h3>该关注</h3><span class="card-sub">按进行中/低得分归类</span></div>' + (parts.join('') || '<div class="bt-note">评估健康，最近得分高于阈值。</div>') + '</div>';
    })()) + '<div class="card pad0"><div class="card-h pad"><h3>评估任务</h3>' +
      '<div class="bt-note" style="margin:0 0 0 auto">新建评估需要评估服务（建任务 → 跑数据集 → 出分）。' +
      '本稿的入口是页面右上的「发起评估」—— 它只能落到「草稿态、需运行才出分」，真正跑分不在本稿范围内。</div></div>' +
      h.table({
        columns: [
          { key: 'name', label: '任务' }, { key: 'target', label: '评估对象' }, { key: 'set', label: '数据集' },
          { key: 'n', label: '样本数', align: 'right', fmt: 'int' },
          { key: 'score', label: '得分', align: 'right', sortable: true, render: function (r) { return '<b class="' + (r.score < 85 ? 'bad' : 'ok') + '">' + fmt.num1(r.score) + '</b>'; } },
          { key: 'by', label: '发起人' }, { key: 'at', label: '时间', render: function (r) { return fmt.rel(r.at); } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          /* 「结果」→ 该任务的逐维度得分；「对比」→ 跳到底部那张版本对比卡（本稿只有 v2.3 vs v2.4 这一对真实对比数据）。
             两者都走专属动作，不再挤同一个 demo —— 它们要做的事完全不同。 */
          { key: 'act', label: '操作', render: function (r) { return '<button class="lnk" data-act="demo-eval-result" data-id="' + h.esc(r.id) + '">结果</button> · <button class="lnk" data-act="demo-eval-compare" data-id="' + h.esc(r.id) + '">对比</button>'; } }
        ],
        rows: tasks, noPaging: true
      }) + '</div>' +

      /* id 供「操作 · 对比」定位到这张卡（本稿唯一的版本对比数据就在这里） */
      '<div class="card" id="eval-cmp-card"><div class="card-h"><h3>' + h.esc(cmp.title) + '</h3>' +
      '<span class="card-sub">1,414 样本 · 回归集 1,200 + badcase 214</span>' +
      /* 🔴 本轮工单（Agent 丙2）：本卡此前是纯陈列 —— 逐维度分数、退化用例都看得到，唯独
         **没有决策出口**：看完不知道该"采用"还是"回滚"、更不知道去哪儿做。
         两个出口都是**二次确认 + 强制理由 + 直接生效**（2026-10-21 审批下线后改的）。
         id 形如 "<版本>|<目标 Agent 名>|<adopt|rollback>"，值全部取自本卡自己的字段。
         ⚠ .card-h 是 flex 容器，直接塞按钮会被压窄 —— 包一层并 margin-left:auto。 */
      '<span style="margin:0 0 0 auto;display:flex;gap:8px;align-items:center;flex-shrink:0">' +
      '<button class="btn-ghost sm" data-act="eval-version-adopt" data-id="' + h.esc(cmp.candVer + '|' + cmp.agentName + '|adopt') + '"' +
      ' title="点击即生效">采用 ' + h.esc(cmp.candVer) + ' →</button>' +
      '<button class="btn-ghost sm" data-act="eval-version-adopt" data-id="' + h.esc(cmp.baseVer + '|' + cmp.agentName + '|rollback') + '"' +
      ' title="点击即生效">回滚到 ' + h.esc(cmp.baseVer) + ' →</button>' +
      '</span></div>' +
      '<div class="dim-cmp">' + cmp.dims.map(function (d) {
        var f2 = d.fmt === 'dur' ? fmt.dur : (d.fmt === 'money4' ? fmt.money4 : fmt.pct1);
        var diff = d.fmt ? ((d.cand - d.base) / d.base) : (d.cand - d.base);
        var diffTxt = d.fmt ? ((diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%') : ((diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + 'pp');
        return '<div class="dim-row"><span class="dim-name">' + h.esc(d.name) + '</span>' +
          '<span class="dim-vals"><b>' + f2(d.base) + '</b> → <b class="' + (d.better ? 'ok' : 'bad') + '">' + f2(d.cand) + '</b></span>' +
          '<span class="dim-diff ' + (d.better ? 'ok' : 'bad') + '">' + diffTxt + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">' + h.esc(cmp.note) + '</div>' +
      '<div class="sub-h bad">退化用例（' + cmp.regressed.length + ' / 8，默认展开）</div>' +
      h.table({
        columns: [
          { key: 'id', label: '用例', mono: true },
          { key: 'input', label: '输入' },
          { key: 'base', label: '基线输出（通过）', render: function (r) { return '<span class="ok">' + h.esc(r.base) + '</span>'; } },
          { key: 'cand', label: '草稿输出（失败）', render: function (r) { return '<span class="bad">' + h.esc(r.cand) + '</span>'; } },
          { key: 'reason', label: '归因' }
        ],
        rows: cmp.regressed, noPaging: true
      }) +
      '<div class="bt-warn">⚠ 副作用检查结论：修好了退货场景，但搞坏了发票场景（订单锁定节点误锁发票号）。' +
      '发布确认页会强制列出这 8 例并要求勾选「我已知晓退化」才能继续。</div>' +
      '<div class="sig-note">显著性：得分差异 6.4pp，n=1,414，p &lt; 0.001 —— 差异可信，但退化项需先修复。</div>' +
      /* 这里把两个出口的去向写清（工单要求：块内说明点击后到哪），并且不暗示"已发布"。 */
      '<div class="bt-note">右上两个按钮点击即生效。' +
      '退化用例未修复前，采用仍会在发布确认页被拦。</div>' +
      '</div>';
  }

  function badcaseBlock(state, h) {
    var fmt = h.fmt;
    var items = queues().badcase.items;
    var pending = items.filter(function (b) { return b.status === 'warn'; });
    return '<div class="metrics">' + [
      { label: '待认领', value: String(pending.length), alert: pending.length > 0, sub: '最长等待 ' + fmt.wait(Math.max.apply(null, pending.map(function (b) { return b.waitMin; }).concat([0]))) },
      { label: '处理中', value: String(items.length - pending.length), sub: '已在处理' },
      { label: '已转测试用例', value: '0', alert: true, sub: '闭环未完成', definition: 'badcase 必须走到「已修复并回归通过」或「确认不修复（填理由）」才算关闭' }
    ].map(h.metricCard).join('') + '</div>' +
      '<div class="card"><div class="card-h"><h3>badcase 队列（全平台）</h3>' +
      '<span class="card-sub">未认领条目点击「认领」接手处理 · 等待超 24h 标红提示处置时限</span></div>' +
      h.table({
        columns: [
          { key: 'level', label: '级别', render: function (r) { return h.pill(r.levelKind, r.level); } },
          /* v10b：同 trace 列表 —— 行内主体信息是级别/原因/等待，Agent 名降为 .lnk.sub 弱链接防双蓝争抢 */
          { key: 'agentName', label: '所属 Agent', render: function (r) { return '<button class="lnk sub" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(r.agentName) + '</button>'; } },
          { key: 'reason', label: '失败原因' },
          { key: 'source', label: '来源' },
          { key: 'waitMin', label: '等待', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.waitMin > 1440 ? 'bad' : '') + '">' + fmt.wait(r.waitMin) + '</span>'; } },
          { key: 'owner', label: '认领人', render: function (r) { var c2 = (h.state.claims || {})[r.id]; return c2 ? h.esc(c2) : (r.owner ? h.esc(r.owner) : '<button class="lnk" data-act="fb-claim" data-id="' + h.esc(r.id) + '">认领</button>'); } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          /* 「审阅」看这条 badcase 的完整字段 + 处置建议（会话内可认领 / 标记已审）。
             「关联进化」→ 自进化控制台的「发起进化任务」表单（data-id 带 agentId 与 badcase 来源做预填），
             不新造入口：进化任务的真实创建链路就是 create-open。 */
          { key: 'act', label: '操作', render: function (r) { return '<button class="lnk" data-act="demo-badcase-review" data-id="' + h.esc(r.id) + '">审阅</button> · <button class="lnk" data-act="demo-badcase-evo" data-id="' + h.esc(r.agentId) + '|' + h.esc(r.id) + '">关联进化</button>'; } }
        ],
        rows: items, noPaging: true
      }) +
      '<div class="bt-warn">⚠ 闭环强制：badcase 不允许长期挂着。必须走到「已修复并回归通过」或「确认不修复」才关闭，' +
      '且修复后应一键转为回归测试用例 —— 这一步把一次性故障变成永久防护网。</div></div>';
  }

  function alertBlock(state, h) {
    var rules = ALERT_RULES;
    /* 会话内的编辑 / 静默要**就地生效**：规则表、状态列、上面的「告警健康」分组读的是同一份 rows，
       否则点完静默下面那条还是「已启用」，同一屏两套状态。 */
    var _ops = state.alertOps || {};
    var rows = rules.map(function (r) {
      var o = _ops[r.id] || {};
      var x = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) x[k] = r[k];
      if (o.cond) x.cond = o.cond;
      if (o.window) x.window = o.window;
      if (o.channel) x.channel = o.channel;
      if (o.silent === true) { x.status = 'warn'; x.statusText = '已静默（本会话）'; }
      else if (o.silent === false) { x.status = 'ok'; x.statusText = '已启用'; }
      return x;
    });
    return ((function () {
      var _silent = rows.filter(function (x) { return x.status !== 'ok'; });
      var _hot = rows.filter(function (x) { return x.status === 'ok' && x.triggered >= 2; });
      var _dead = rows.filter(function (x) { return x.status === 'ok' && x.triggered === 0; });
      var parts = [];
      if (_silent.length) parts.push('<div class="bt-note">⚠ ' + _silent.length + ' 条规则处于静默，会漏报：' + _silent.map(function (x) { return h.esc(x.metric); }).join('、') + '。</div>');
      if (_hot.length) parts.push('<div class="bt-note">⚠ ' + _hot.length + ' 条规则近30天触发频繁，疑似告警风暴：' + _hot.map(function (x) { return h.esc(x.metric) + '(' + x.triggered + ')'; }).join('、') + '，建议上调阈值或收敛。</div>');
      if (_dead.length) parts.push('<div class="bt-note">' + _dead.length + ' 条规则已启用但近30天未触发，请确认条件是否仍生效：' + _dead.map(function (x) { return h.esc(x.metric); }).join('、') + '。</div>');
      return '<div class="card" data-static="1" title="只读说明：本块是按近 30 天触发情况归类的汇总；规则的编辑/静默在下方「告警规则」表。"><div class="card-h"><h3>告警健康</h3><span class="card-sub">按近30天触发情况归类</span></div>' + (parts.join('') || '<div class="bt-note">配置健康。</div>') + '</div>';
    })()) + '<div class="card pad0"><div class="card-h pad"><h3>告警规则</h3>' +
      /* 原「新建规则」按钮已撤回：告警规则的创建要落真实规则引擎（指标采集 + 通知渠道 + 静默策略），
         本稿没有这套后端能力，留个按钮只会在点了之后说一句空话。页面右上的「发起评估」不是它的入口
         （评估任务 ≠ 告警规则），所以这里如实写明缺什么，不假装有入口。 */
      '<div class="bt-note" style="margin:0 0 0 auto">新建告警规则需要规则引擎后端（指标采集 / 通知渠道 / 静默策略），本稿未提供入口，' +
      '下面只展示既有规则与静默机制。</div></div>' +
      h.table({
        columns: [
          { key: 'metric', label: '指标' }, { key: 'cond', label: '触发条件', mono: true },
          { key: 'scope', label: '生效范围' }, { key: 'window', label: '统计窗口' },
          { key: 'channel', label: '通知渠道' }, { key: 'oncall', label: '值班' },
          { key: 'triggered', label: '近30天触发', align: 'right', fmt: 'int', render: function (r) { return r.triggered ? '<b class="warn">' + r.triggered + '</b>' : '<span class="muted">0</span>'; } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          /* 「编辑」与「静默」都落本会话状态（state.alertOps）：编辑改阈值/窗口/渠道，静默写静默态与到期时间。
             规则的启用状态在同一屏的「告警健康」与「告警抑制」两处有口径说明，操作后就地对齐。 */
          { key: 'act', label: '操作', render: function (r) {
            var ops = (h.state.alertOps || {})[r.id] || {};
            var silent = ops.silent || r.status === 'warn';
            return '<button class="lnk" data-act="demo-alert-edit" data-id="' + h.esc(r.id) + '">编辑</button> · ' +
              (silent
                ? '<button class="lnk ok" data-act="demo-alert-silence" data-id="' + h.esc(r.id) + '|off">取消静默</button>'
                : '<button class="lnk" data-act="demo-alert-silence" data-id="' + h.esc(r.id) + '|on">静默</button>');
          } }
        ],
        rows: rows, noPaging: true
      }) + '</div>' +
      '<div class="card" data-static="1" title="只读说明：本块是降噪策略的说明；静默/取消静默的操作入口在「告警规则」表的对应行。"><div class="card-h"><h3>告警抑制</h3></div>' +
      '<div class="bt-note">同源告警 5 分钟内合并为一条，避免告警风暴。静默操作必须填写原因与到期时间，到期自动恢复；' +
      '当前有 1 条规则处于静默状态（调用量骤降，至明日 09:00），静默期间的触发不会通知但仍会记录。</div></div>';
  }

  /* SECTION: r-trace-detail */
  RENDERERS.traceDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var t = F.getTrace(state.traceId);
    if (!t) {
      return '<div class="fatal"><h2>trace 不存在</h2>' +
        '<p>标识「<span class="mono">' + h.esc(state.traceId) + '</span>」未找到。可能原因：ID 输入有误、超出 30 天保留期、或该 trace 已被清理。</p>' +
        '<p class="fatal-hint">保留策略：trace 明细保留 30 天，聚合指标保留 13 个月。</p>' +
        '<button class="btn-primary" data-act="goto-cap" data-id="obs">返回 trace 检索</button></div>';
    }
    var inc = t.incidentId ? Q.incident(t.incidentId) : null;
    var failedSpan = t.spans.filter(function (s) { return s.status === 'failed'; })[0];
    /* 🔴 本轮工单（Agent 丙2）：下方「逐节点输入输出」卡此前**只有输入输出、没有任何出口** ——
       看到一个失败节点，走不到「同类失败还发生在哪些调用」。出口挂在**失败节点**上才成立
       （成功节点没有"同类失败"可看），所以这里先判一次有没有带错误码的失败节点；
       一个都没有时，卡头另给一个真实落点（该 Agent 的编排配置），避免该卡在成功 trace 上退回纯陈列。 */
    var _failSpans = t.spans.filter(function (s) { return s.status === 'failed' && s.error && s.error.code; });

    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title"><span class="mono">' + h.esc(t.traceId) + '</span>' +
      (t.status === 'failed' ? ' <span class="pill bad">失败</span>' : ' <span class="pill ok">成功</span>') + '</div>' +
      '<div class="ph-tags">' +
      '<span><button class="lnk" data-act="goto-agent" data-id="' + h.esc(t.agentId) + '">' + h.esc(t.agentName) + '</button></span>' +
      '<span>版本 ' + h.esc(t.version) + '</span><span>' + h.esc(t.bizName) + '</span>' +
      '<span>意图 ' + h.esc(t.intentName) + '</span><span class="mono">' + fmt.dt(t.ts) + '</span>' +
      '</div></div><div class="ph-side">' +
      /* 四个按钮各自的语义完全不同，因此各有专属动作，不再共用一个 demo：
         ① 复制 ID —— 本仓对"复制"的诚实写法是**只提示不写剪贴板**（同 v27 as-msg-copy）；
         ② 标记 badcase —— 落会话内 state.traceBadcase，trace 顶部就地显示"已标记"；
         ③ 存为测试用例 —— 需要回归集写入能力，本稿没有，已撤回（见下方 bt-note）；
         ④ 对比另一条 trace —— 本稿没有 trace 对比视图，已撤回（见下方 bt-note）。 */
      '<button class="btn-ghost" data-act="demo-copy-id" data-id="' + h.esc(t.traceId) + '">复制 ID</button>' +
      ((state.traceBadcase || {})[t.traceId]
        ? '<button class="btn-ghost" data-act="demo-trace-badcase" data-id="' + h.esc(t.traceId) + '" title="只标记在本会话，可再点一次取消">已标记 badcase</button>'
        : '<button class="btn-ghost" data-act="demo-trace-badcase" data-id="' + h.esc(t.traceId) + '">标记 badcase</button>') +
      '<button class="btn-ghost" data-act="goto-agent-tab" data-id="' + h.esc(t.agentId) + '|quality">看该 Agent 的 badcase 队列</button>' +
      '</div></div>' +
      /* 撤回说明放在 page-head **之外**：.page-head 是 flex 行，塞进去会被 .ph-side 的 8px gap 压成一列窄字。 */
      '<div class="bt-note">需要后端能力的两个操作，本稿未提供入口：' +
      '「存为测试用例」要能写入回归集并触发基线复跑；「对比另一条 trace」要有 trace 双列 diff 视图（本稿只做了评估任务的版本对比，没有单条 trace 对比）。</div>' +

      (inc ? '<div class="alert-banner bad"><b>⚠ 本次调用处于事故区间内</b>' +
        '<span>' + h.esc(inc.title) + '（' + h.esc(inc.level) + '）· ' + h.esc(F.fmtDate(S.TODAY_START + inc.dayOffset * S.DAY)) + ' ' + inc.hourStart + ':00–' + inc.hourEnd + ':59</span>' +
        '<span>根因：' + h.esc(inc.rootCause) + '</span>' +
        '<button class="lnk" data-act="show-incident" data-id="' + inc.id + '">查看事故详情 →</button>' +
        '<span class="hint">排查基线问题时应剔除事故时段的数据，否则会误判为常态性能问题。</span></div>' : '') +

      '<div class="metrics">' + [
        { label: '端到端时延', value: fmt.dur(t.latencyMs), alert: t.latencyMs > 4000, definition: '从开始节点到输出节点，含工具等待与重试', sub: t.spans.length + ' 个节点' },
        { label: 'token', value: fmt.int(t.tokens), sub: '入 ' + fmt.int(t.tokensIn) + ' / 出 ' + fmt.int(t.tokensOut) },
        { label: '成本', value: fmt.money4(t.cost), definition: '按实际使用模型的 token 单价折算' },
        t.status === 'failed'
          ? { label: '失败节点', value: failedSpan ? failedSpan.name : '—', alert: true, sub: t.errName + '（HTTP ' + (failedSpan && failedSpan.error ? failedSpan.error.http : '—') + '）' }
          : { label: '结果', value: '成功', sub: '全链路 ' + t.spans.length + ' 节点均正常' }
      ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>调用链火焰图</h3>' +
      '<span class="card-sub">条宽 = 耗时占比，一眼定位瓶颈</span>' +
      '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(t.agentId) + '|orchestrate">在画布中定位 →</button></div>' +
      C.flameChart(t) + '</div>' +

      (failedSpan ? '<div class="card err-card"><div class="card-h"><h3>错误详情 · ' + h.esc(failedSpan.name) + '</h3></div>' +
        '<div class="err-head"><span class="pill bad">' + h.esc(failedSpan.error.code) + '</span>' +
        '<span>' + h.esc(failedSpan.error.name) + '</span>' +
        '<span class="mono">HTTP ' + failedSpan.error.http + '</span>' +
        '<span>' + (failedSpan.error.retryable ? '可重试 · 已重试 ' + failedSpan.error.retries + ' 次' : '不可重试') + '</span></div>' +
        '<div class="err-msg">' + h.esc(failedSpan.error.message) + '</div>' +
        '<details class="err-stack"><summary>调用栈</summary><pre>' + h.esc(failedSpan.error.stack) + '</pre></details>' +
        /* 🔴 本轮工单（Agent 丙2）：本卡原有的「查看同类失败 →」(filter-trace，**只带错误码**)
           已撤下 —— 同一件事移到下方「逐节点输入输出」里失败节点的 summary 上，且带
           (错误码 + 本 Agent) 两个 state.filters 里真生效的键，收敛更准。
           **刻意不并列两个入口**：两个按钮点下去到同一屏、只差一个筛选键，就是重复入口。
           （filter-trace 本身仍注册，可观测页顶部的错误码 chip 仍在用它。） */
        '<div class="err-acts">' +
        ((state.traceBadcase || {})[t.traceId]
          ? '<button class="btn-ghost sm" data-act="demo-trace-badcase" data-id="' + h.esc(t.traceId) + '" title="只标记在本会话，可再点一次取消">已标记 badcase</button>'
          : '<button class="btn-ghost sm" data-act="demo-trace-badcase" data-id="' + h.esc(t.traceId) + '">转为 badcase</button>') +
        '</div>' +
        '</div>' : '') +

      /* 🔴 本轮工单（Agent 丙2）：本卡此前是纯陈列（只有输入/输出，没有去向）。
         出口挂在**失败节点**的 summary 尾部：点一下到「可观测 › trace 检索」，按
         (错误码 + 本 Agent) 两个条件筛出同类失败调用 —— 这两键都是检索页真读的 state.filters 维度。
         成功节点不挂（它没有"同类失败"可看）；本 trace 一个失败节点都没有时，卡头给
         「看这些节点的编排配置 →」(goto-agent-tab | orchestrate)，保证这张卡永远有真出口。 */
      '<div class="card"><div class="card-h"><h3>逐节点输入输出</h3>' +
      '<span class="card-sub">敏感字段已脱敏，查看明文需 obs:trace:detail 权限</span>' +
      (_failSpans.length ? ''
        : '<button class="btn-ghost sm" data-act="goto-agent-tab" data-id="' + h.esc(t.agentId) + '|orchestrate">看这些节点的编排配置 →</button>') +
      '</div>' +
      '<div class="span-io">' + t.spans.map(function (sp) {
        return '<details class="span-d' + (sp.status === 'failed' ? ' fail' : '') + '"' + (sp.status === 'failed' ? ' open' : '') + '>' +
          '<summary><i class="fl-dot" style="background:' + C.KIND_COLOR[sp.kind] + '"></i>' + h.esc(sp.name) +
          '<em>' + h.esc(C.KIND_LABEL[sp.kind]) + '</em>' +
          (sp.model ? '<span class="sp-model">' + h.esc(sp.model) + '</span>' : '') +
          (sp.mcp ? '<span class="sp-model mono">' + h.esc(sp.mcp) + '</span>' : '') +
          '<span class="sp-dur">' + fmt.dur(sp.duration) + '</span>' +
          (sp.tokensIn ? '<span class="sp-tok">' + fmt.int(sp.tokensIn + sp.tokensOut) + ' tok</span>' : '') +
          (sp.status === 'failed' ? '<span class="pill bad">失败</span>' : '<span class="pill ok">成功</span>') +
          ((sp.status === 'failed' && sp.error && sp.error.code)
            ? '<button class="lnk" data-act="trace-node-traces" data-id="' + h.esc(sp.error.code + '|' + t.agentId) + '"' +
              ' title="到「可观测 › trace 检索」筛出同错误码（' + h.esc(sp.error.code) + '）、同 Agent（' + h.esc(t.agentName) + '）的失败调用">看同类失败调用（限本 Agent）→</button>'
            : '') +
          '</summary>' +
          '<div class="sp-body">' +
          '<div class="sp-col"><b>输入</b><pre>' + h.esc(C.jsonView(sp.io ? sp.io.input : null)) + '</pre></div>' +
          '<div class="sp-col"><b>输出</b><pre>' + h.esc(sp.error ? '—（节点失败，无输出）' : C.jsonView(sp.io ? sp.io.output : null)) + '</pre></div>' +
          '</div></details>';
      }).join('') + '</div></div>' +

      '<div class="meta-bar-wrap">' + h.metaBar({ range: { rangeLabel: '单条 trace', from: t.ts, to: t.ts + t.latencyMs }, sampleNote: '单条明细，非抽样' }, [
        { k: 'traceId 编码', v: 'ID 内含 (Agent, 日期, 小时, 序号)，可反解定位，因此粘贴 ID 能直达本条记录' },
        { k: '时延口径', v: '端到端 ' + fmt.dur(t.latencyMs) + ' = 各节点耗时之和 + 节点间调度开销；与聚合指标使用同一口径' },
        { k: '数据保留', v: 'trace 明细保留 30 天，超期后仅保留聚合指标' }
      ]) + '</div>';
  };

  /* SECTION: r-cost-page */
  /* SECTION: r-cost-page
     ============ 成本与调用归因 · 按 DS 控制台版式重排（2026-10-22）============
     业主给了四张 DeepSeek 控制台「用量信息」页的截图，要求「参考 deepseek 控制台」。
     搬的是**版式**（与 2026-10-15 运行监控那次同一套原语：charts.js 的 stackedBar / areaChart）：
       ① 顶部筛选行：时间维度胶囊 + 右侧实心「导出」
       ② 三张大数卡：消费金额 / 请求次数 / Tokens
       ③ 主图卡：消费金额堆叠柱，卡头右侧四段切换（业务线 / 模型 / Agent / 调用方）
       ④ 按模型分组：每个模型两张小面积图（请求次数 / Tokens）

     不搬的是 DeepSeek 的「充值余额 / 赠送余额 / 累计消费」三卡 —— 本系统是内部中台，
     没有账户充值这件事，硬造三个余额卡就是编数字。三卡全部取自 QUERY.kpi / costBreakdown 的真聚合，
     指标换成「消费金额 / 请求次数 / Tokens」，正是 DS 页主图上方那三张统计卡的同一组指标。

     ⚠ 相对旧版删掉的两块，以及为什么删（不是丢数据，是被同一份数据的更好的画法取代）：
       · 「每日成本」mini-bars 卡 → 主图就是逐日成本，只是从单色柱改成按维度堆叠；
       · 「调用方成本分布」横向条 → 主图切到「调用方」页签即同一份数据，且多了时序信息。
     ⚠ 四张同构表的列差异（预算月化 / token / 单次成本 / 重试浪费）与逐行下钻动作**逐个保留**：
       切页签只换维度，不换出口。
     ⚠ 旧版 KPI 带里的「重试浪费」进了第 3 张卡的脚注。
       2026-10-22 业主圈图要求删掉两处：主图下方的月化口径行、以及「N% 的调用未标记来源」焦点条。
       删后这两项信息仍在别处可查（不是消失）：月化口径见页尾 metaBar 与「业务线」页签的
       预算使用列；未标记来源在「调用方」页签的柱图/图例/表格（标红）里，处理入口是「优化建议」。 */
  RENDERERS.costPage = function (cap, state, h) {
    var fmt = h.fmt;
    var cb = Q.costBreakdown(state.range);
    var k = Q.kpi(state.range);
    var monthTotal = cb.total;
    var budgetTotal = S.BIZ_LINES.reduce(function (s, b) { return s + b.budget; }, 0);
    var totalCalls = cb.byAgent.reduce(function (s, x) { return s + x.calls; }, 0);
    var unknownCaller = cb.byCaller.filter(function (x) { return x.key === 'unknown'; })[0] || { calls: 0, cost: 0 };
    var wastePct = monthTotal ? cb.retryWaste / monthTotal : 0;

    /* 区间天数：只服务「业务线」页签的「预算使用（月化）」列。
       ⚠ 从 resolveRange 的 from/to 真算（cb.meta.range 里没有 days/hours 字段，去读会静默得到「—」）。 */
    var rMeta = cb.meta.range || {};
    var rangeDays = (rMeta.from != null && rMeta.to != null && rMeta.to > rMeta.from)
      ? (rMeta.to - rMeta.from) / 86400000 : null;

    /* 四个分组维度 = 旧版的四个页签。同一个 state.tab 同时驱动主图（堆叠口径）与下方归因明细表，
       避免"图按业务线、表按模型"这种自相矛盾的组合。 */
    var COST_TABS = [
      { id: 'cost-biz', label: '业务线', dim: 'biz' },
      { id: 'cost-model', label: '模型', dim: 'model' },
      { id: 'cost-agent', label: 'Agent', dim: 'agent' },
      { id: 'cost-caller', label: '调用方', dim: 'caller' }
    ];
    var cTab = COST_TABS[0];
    for (var _ct = 0; _ct < COST_TABS.length; _ct++) if (COST_TABS[_ct].id === state.tab) cTab = COST_TABS[_ct];
    var dim = cTab.dim;

    /* ── ① 筛选行：时间维度胶囊 + 右侧导出（DS 页的实心黑胶囊）──── */
    var fresh = Q.freshness ? Q.freshness() : null;
    var dsBar = '<div class="ds-bar">' +
      '<button class="ds-filter" data-act="agent-range-cycle" data-id="' + h.esc(state.range) + '"' +
      ' data-tip="点一下切到下一个时间维度（与页头的时间范围是同一个状态）">' +
      '<i>时间维度</i><b>' + h.esc(Q.RANGES[state.range].label) + '</b>' + h.icon('caret', 12) + '</button>' +
      '<span class="side-note" data-tip="所有日期均按 GMT+8 显示。成本按模型 token 单价折算，含失败调用已消耗的部分。">' +
      (fresh ? h.esc(fresh.text) : '') + ' · GMT+8</span>' +
      '<span class="ds-bar-right">' +
      '<button class="ds-export" data-act="export-report" data-id="cost">导出</button>' +
      '</span></div>';

    /* ── ② 三张大数卡 ─────────────────────────────────────── */
    var dsCards = '<div class="ds-cards">' +
      '<div class="ds-card"><span>消费金额</span><b>' + h.esc(fmt.money(monthTotal)) + '<em>CNY</em></b>' +
      '<u>' + h.esc((rMeta.rangeLabel || '') + ' · 单次 ' + fmt.money4(totalCalls ? monthTotal / totalCalls : null)) + '</u></div>' +
      '<div class="ds-card"><span>API 请求次数</span><b>' + h.esc(fmt.int(totalCalls)) + '</b>' +
      '<u>失败 ' + fmt.int(k.fails) + ' 次 · 成功率 ' + fmt.pct2(k.successRate) + '</u></div>' +
      '<div class="ds-card"><span>Tokens</span><b>' + h.esc(fmt.int(cb.tokens)) + '</b>' +
      '<u>均价 ' + fmt.int(totalCalls ? cb.tokens / totalCalls : null) + ' tok / 次 · 重试浪费 ' +
      fmt.money2(cb.retryWaste) + '（' + fmt.pct1(wastePct) + '）</u></div>' +
      '</div>';

    /* ── ③ 主图：按当前维度堆叠的消费金额柱 ──────────────────
       数据走 QUERY.costSeriesByDim（每个小时桶直接按维度拆解），不是"区间占比 × 每桶总量"的分摊值，
       所以这张图的柱高与下方表格的金额能对上账。
       超过 6 类时，尾部合并成「其他 N 类」—— 柱子太碎就看不出结构；合并项在图例里仍是可解释的。 */
    /* 6 色，色相均分（蓝 225° / 青 190° / 紫 262° / 橙 38° / 绿 160° / 粉 330°）。
       为什么不直接用全局 C.DS_COLORS：那套是给运行监控页配的（那页最多 2–3 段：模型 / 意图），
       前两色 #4d6bfe、#7a5cff 的色相只差 40°，在 2 段图上够用；本页最多 7 段堆在同一根柱子上，
       蓝紫三连在 12px 宽的色块上分不出边界（实测：Agent 维度 6 段时整根柱像一段渐变）。
       色板与监控页不同不影响对账：颜色是分组标识，不是数值编码，每张图自带图例。 */
    var COST_COLORS = ['#4d6bfe', '#0ea5e9', '#7c3aed', '#f59e0b', '#10b981', '#ec4899'];
    var ser = Q.costSeriesByDim(state.range, dim);
    var MAXS = 6;
    var shownRows = ser.rows.slice(0, MAXS);
    var restRows = ser.rows.slice(MAXS);
    /* 调用方维度里 unknown 单独标橙：它不是一个"客户"，是归因缺口 —— 和上方焦点条同色，
       扫一眼就能在柱子上看见缺口有多大。 */
    var colOf = function (r, i) {
      return (dim === 'caller' && r.key === 'unknown') ? '#d97706' : COST_COLORS[i % COST_COLORS.length];
    };
    var series = shownRows.map(function (r, i) {
      return {
        label: r.label, color: colOf(r, i),
        values: ser.points.map(function (p) { return (p.by[r.key] || {}).cost || 0; })
      };
    });
    if (restRows.length) {
      series.push({
        label: '其他 ' + restRows.length + ' 类', color: '#9aa3b5',
        values: ser.points.map(function (p) {
          return restRows.reduce(function (s, r) { return s + ((p.by[r.key] || {}).cost || 0); }, 0);
        })
      });
    }
    var swHtml = COST_TABS.map(function (t) {
      return '<button role="tab" aria-selected="' + (t.id === cTab.id) + '" class="ds-sw' + (t.id === cTab.id ? ' on' : '') +
        '" data-tab="' + t.id + '" title="主图与下方归因明细同时切到「' + h.esc(t.label) + '」维度">' + h.esc(t.label) + '</button>';
    }).join('');
    var legendHtml = shownRows.map(function (r, i) {
      return '<span><i style="background:' + colOf(r, i) + '"></i>' + h.esc(r.label) +
        ' <em style="font-style:normal;color:var(--faint)">' + fmt.money(r.cost) + ' · ' + fmt.pct1(r.share) + '</em></span>';
    }).join('') +
      (restRows.length
        ? '<span><i style="background:#9aa3b5"></i>其他 ' + restRows.length + ' 类 <em style="font-style:normal;color:var(--faint)">' +
          fmt.money(restRows.reduce(function (s, r) { return s + r.cost; }, 0)) + ' · ' +
          fmt.pct1(restRows.reduce(function (s, r) { return s + r.share; }, 0)) + '</em></span>'
        : '');
    /* 整列浮层的数据（2026-10-22 业主「自己看交互」）：每列 = 日期 + 当天合计 + 各分组金额。
       只往 DOM 里塞一次（data-sb），交互逻辑在 app.js 统一实现 —— 页面里不写第二套 tooltip。
       rows 只保留金额 > 0 的分组并按金额降序：空分组占一行只会让浮层变长。 */
    var tipTitle = function (ts, gran) {
      var base = fmt.date(ts);
      if (gran === '1d') return base;
      var d = new Date(ts);
      return base + ' ' + ('0' + d.getHours()).slice(-2) + ':00';
    };
    var colTips = ser.points.map(function (p) {
      var rowVals = shownRows.map(function (r, i) {
        return { label: r.label, color: colOf(r, i), value: (p.by[r.key] || {}).cost || 0 };
      });
      if (restRows.length) {
        rowVals.push({
          label: '其他 ' + restRows.length + ' 类', color: '#9aa3b5',
          value: restRows.reduce(function (s, r) { return s + ((p.by[r.key] || {}).cost || 0); }, 0)
        });
      }
      rowVals = rowVals.filter(function (x) { return x.value > 0; })
        .sort(function (a, b) { return b.value - a.value; });
      return {
        title: tipTitle(p.ts, ser.granularity),
        totalText: fmt.money2(p.cost),
        rows: rowVals.map(function (x) {
          return {
            label: x.label, color: x.color,
            sub: p.cost ? fmt.pct1(x.value / p.cost) : '',
            valueText: fmt.money2(x.value)
          };
        })
      };
    });

    var dsPanel = '<div class="ds-panel">' +
      '<div class="ds-panel-h"><h3>消费金额（CNY）</h3><span class="sum">' + fmt.money(monthTotal) + '</span>' +
      '<span class="sw" role="tablist" aria-label="堆叠分组维度">' + swHtml + '</span></div>' +
      C.stackedBar(ser.points, series, {
        /* 宽度按 .ds-panel 的实际宽度出（内容区宽，不是整块内容区减卡片内边距那种估法），
           否则 viewBox 比容器窄 32px，SVG 会被轻微放大、字反而发虚。 */
        width: C.chartWidth() + 32,
        height: 220, granularity: ser.granularity,
        /* 1 小时窗口只有 1 个时间桶：默认 26px 的柱宽会让它像根牙签。桶少时把柱加宽，
           柱子的**高度**仍然是这一小时的真实总额，只是画得粗——不伪造时间点。 */
        barMax: ser.points.length <= 2 ? 72 : 26,
        padL: 56,
        colTips: colTips,
        aria: '按' + cTab.label + '分组的消费金额堆叠柱',
        fmt: function (v) { return v >= 100 ? '¥' + Math.round(v) : '¥' + Number(v).toFixed(2); }
      }) +
      '<div class="ds-legend">' + legendHtml + '</div>' +
      '</div>';

    /* ── ④ 按模型分组：每个模型两张小面积图（请求次数 / Tokens）──
       取金额前 4 的模型（与主图同样来自 costSeriesByDim，同源同分桶），避免页面被"长尾模型"拉长。 */
    var mSer = Q.costSeriesByDim(state.range, 'model');
    var mTop = mSer.rows.slice(0, 4);
    var dsGroups = mTop.length
      ? '<div class="ds-group-h" style="margin:2px 0 6px;color:var(--sub)">模型用量趋势' +
        '<em>按金额取前 ' + mTop.length + ' 个模型 · 左图请求次数、右图 Tokens</em></div>' +
        '<div class="ds-groups">' + mTop.map(function (r, i) {
          var color = COST_COLORS[i % COST_COLORS.length];
          var callsArr = mSer.points.map(function (p) { return (p.by[r.key] || {}).calls || 0; });
          var tokArr = mSer.points.map(function (p) {
            var v = p.by[r.key]; return v ? v.tokIn + v.tokOut : 0;
          });
          /* 两张小图的 hover 数据：日期 + 指标名 + 值（对标 DeepSeek 面积图的浮层形态）。
             单序列不给色块 —— 只一行，配色块反而像还有别的系列。 */
          var callTips = mSer.points.map(function (p, i) {
            return { title: tipTitle(p.ts, mSer.granularity),
              rows: [{ label: 'API 请求次数', valueText: fmt.int(callsArr[i]) }] };
          });
          /* 2026-10-28 23:00 业主「撤回」：Tokens 恢复单色面积图 + 单行浮层。
             此前的尝试（浮层拆输入/输出两行带色块 → 图改两段堆叠柱）整体回退 ——
             教训留在 git 之外：要给浮层加分项色块，图里就得真有那几段，二者只能一起动或一起不动。 */
          var tokTips = mSer.points.map(function (p, i) {
            return { title: tipTitle(p.ts, mSer.granularity),
              rows: [{ label: 'Tokens', valueText: fmt.compact(tokArr[i]) }] };
          });
          return '<div class="ds-group-h">' + h.esc(r.label) + '<em>' + fmt.int(r.calls) + ' 次 · ' +
            fmt.money(r.cost) + ' · ' + fmt.compact(r.tokens) + ' token</em></div>' +
            '<div class="ds-grid2">' +
            '<div class="ds-panel" style="margin:0"><div class="ds-mini"><span>API 请求次数</span><b>' + fmt.int(r.calls) + '</b></div>' +
            C.areaChart(mSer.points, callsArr, { width: C.gridWidth(2), height: 150, padL: 56, granularity: mSer.granularity, color: color, colTips: callTips, aria: r.label + ' 的请求次数趋势', fmt: function (v) { return fmt.compact(v); } }) + '</div>' +
            '<div class="ds-panel" style="margin:0"><div class="ds-mini"><span>Tokens</span><b>' + fmt.compact(r.tokens) + '</b></div>' +
            C.areaChart(mSer.points, tokArr, { width: C.gridWidth(2), height: 150, padL: 64, granularity: mSer.granularity, color: color, colTips: tokTips, aria: r.label + ' 的 tokens 趋势', fmt: function (v) { return fmt.compact(v); } }) + '</div>' +
            '</div>';
        }).join('') + '</div>'
      : '';

    /* ── 归因明细表（四张同构表合一，列随维度变，出口逐个保留）──
       出口挂在行首维度名上，走同一个 cost-biz-drill：
         业务线行 → data-id = "<bizKey>"；模型行 → "model|<modelKey>"；
         调用方行 → 不挂出口（该 handler 只认 biz / model，传 caller|… 会落到空操作）。
       ⚠ 诚实边界：trace 检索没有「按业务线/模型筛选」的维度，所以这一跳是**开一张清单**
         （该维度下的真实 Agent + 区间内真实调用/成本），再由清单逐行下钻到单个 Agent 的调用明细。 */
    var tableCard = (function () {
      var CALLER_LABEL = { unknown: '未标记来源（归因缺口）' };
      var rowsByTab = { 'cost-biz': cb.byBiz, 'cost-model': cb.byModel, 'cost-agent': cb.byAgent, 'cost-caller': cb.byCaller };
      var rows = rowsByTab[cTab.id] || [];
      var dimHead = cTab.label === 'Agent' ? 'Agent' : cTab.label;
      var needBudget = cTab.id === 'cost-biz';                 /* 只有业务线有预算口径 */
      var needTokens = cTab.id === 'cost-model';
      var needAgentCols = cTab.id === 'cost-agent';
      var isUnknown = function (r) { return cTab.id === 'cost-caller' && r.key === 'unknown'; };

      var cols = [
        { key: 'label', label: dimHead, mono: (cTab.id === 'cost-model'), render: function (r) {
          var text = r.label || CALLER_LABEL[r.key] || r.key;
          if (cTab.id === 'cost-agent') {
            return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.key) + '">' + h.esc(text) + '</button>';
          }
          /* ⚠ 调用方页签刻意不给下钻出口：v31-detail-links.js 的 cost-biz-drill 只在
             byBiz / byModel 里找 bucket，传 "caller|direct" 一律落空 → toast「没有数据」= 假出口。
             它的信息量在主图（调用方堆叠柱）+ 本表「调用/成本/占比」三列里。 */
          if (cTab.id === 'cost-caller') {
            return isUnknown(r)
              ? '<span class="warn">' + h.esc(text) + '</span>'
              : '<span>' + h.esc(text) + '</span>';
          }
          var did = cTab.id === 'cost-model' ? ('model|' + r.key) : r.key;
          return '<button class="lnk' + (cTab.id === 'cost-model' ? ' mono' : '') + '" data-act="cost-biz-drill" data-id="' + h.esc(did) + '" ' +
            'title="展开该' + cTab.label + '下的 Agent 与真实调用/成本，再逐行下钻到调用明细">' + h.esc(text) + '</button>';
        } },
        { key: 'calls', label: '调用', align: 'right', fmt: 'int' }
      ];
      if (needTokens) cols.push({ key: 'tokens', label: 'token', align: 'right', fmt: 'int' });
      cols.push({ key: 'cost', label: '成本', align: 'right', sortable: true, render: function (r) { return fmt.money2(r.cost); } });
      cols.push({ key: 'share', label: '占比', align: 'right', fmt: 'pct1' });
      if (needBudget) {
        cols.push({ key: 'budget', label: '预算使用（月化）', render: function (r) {
          if (!r.budget) return '<span class="muted">—</span>';
          var mRun = rangeDays ? r.cost / rangeDays * 30 : null;
          if (mRun == null) return '<span class="muted">区间不足以折算月度</span>';
          return C.gauge(mRun / r.budget, { title: '月化 ' + fmt.money2(mRun) + ' / 预算 ' + fmt.money(r.budget) });
        } });
      }
      if (needAgentCols) {
        cols.push({ key: 'costPerCall', label: '单次成本', align: 'right', render: function (r) { return fmt.money4(r.costPerCall); } });
        cols.push({ key: 'waste', label: '重试浪费', align: 'right', render: function (r) { return r.waste > 0 ? '<span class="warn">' + fmt.money2(r.waste) + '</span>' : '<span class="muted">—</span>'; } });
        cols.push({ key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="goto-agent-tab" data-id="' + h.esc(r.key) + '|cost">节点级 →</button>'; } });
      }

      /* 判定依据是「可点出口」而不是「可排序」：调用方页签没有逐行可点的对象
         ⇒ 按本仓硬门禁必须显式声明只读并给理由。 */
      var tableCardAttr = cTab.id === 'cost-caller'
        ? ' data-static="1" title="只读说明：调用方维度没有可下钻的对象，本表的唯一交互是按列排序；要处理归因缺口请用上方「优化建议」里由聚合推导出的那一条转审批。"'
        : '';
      var tip = cTab.id === 'cost-biz'
        ? '预算列用「月化」（区间均值外推 ≈ 30 天），不是「区间成本 ÷ 月度预算」的跨窗口相除 —— 后者会把 24 小时的量读成整月进度。'
        : (cTab.id === 'cost-agent'
          ? '点 Agent 名下钻到节点级成本；整行点击同样进入该 Agent。重试浪费与单次成本只对 Agent 维度有意义，故只在本页签出现。'
          : (cTab.id === 'cost-model'
            ? '点模型名看用它的 Agent 与调用/成本；token 列只对模型维度有意义，故只在本页签出现。'
            : '调用方维度是只读分布（唯一交互是按列排序）：它没有"该调用方的清单"可开。未标记来源即归因缺口、本身不是可枚举实体，另标红显示；' +
              '要处理它请用上方「优化建议」里由聚合推导出的那一条（网关强制打标）。'));

      return '<div class="card pad0"' + tableCardAttr + '>' +
        '<div class="card-h pad"><h3>归因明细</h3>' +
        '<span class="card-sub">按' + h.esc(cTab.label) + ' · ' + rows.length + ' 组 · 与上方主图同一维度</span></div>' +
        h.table({
          columns: cols,
          rows: rows,
          sortBy: state.sortKey, sortDir: state.sortDir,
          noPaging: cTab.id !== 'cost-agent',
          page: state.page || 1, pageSize: 12,
          rowAction: cTab.id === 'cost-agent' ? 'agent' : null,
          rowIdKey: 'key',
          emptyTitle: '该分组下没有调用记录',
          emptySub: '换个分组维度，或把页头的时间范围放宽'
        }) +
        '<div class="bt-note" style="margin:0 14px 12px">' + tip + '</div></div>';
    })();

    var ruleCard = '<div class="card"><div class="card-h"><h3>分摊规则</h3></div>' +
      '<div class="bt-note">公共成本（网关、沙盒、评估任务）按各业务线调用量占比分摊，规则透明可查。' +
      '当前公共成本池 ' + fmt.money2(unknownCaller.cost) +
      '，将在月度账单中单独列出。导出账单需 cost:export 权限。</div>' +
      '<button class="btn-ghost sm" data-act="export-report" data-id="month">导出月度账单</button></div>';

    /* 页头右侧不再放时间选择器/导出：那两件在下面的 DS 筛选行里，一处一套就够。
       也不重复写「数据截至」—— 同一句在 ds-bar 里紧跟时间胶囊，贴着它更该出现。 */
    return pageHead(h, cap, { action: false }) +
      dsBar + dsCards + dsPanel + dsGroups + tableCard + ruleCard +
      h.metaBar(cb.meta, [
        { k: '计价来源', v: '单价来自模型计价表' },
        { k: '主图口径', v: '每个时间桶按所选维度直接聚合（不是区间占比分摊）；超过 6 类时尾部合并为「其他」，金额与占比仍计入图例' },
        { k: '预算口径', v: '业务线月度预算（合计 ' + fmt.money(budgetTotal) + '）。「预算使用（月化）」= 区间成本 ÷ 区间天数 × 30 ÷ 月度预算，是均值外推的近似值（界面标 ≈），不等于账单实际值' },
        { k: '单次调用成本', v: '区间总成本 ÷ 区间总调用数' }
      ]);
  };


  /* SECTION: r-gateway —— 本页的渲染器已迁至 v29-gateway-tabs.js。
     这里原本是 RENDERERS.gatewayPage（服务健康墙 + 模型用量分布 + 密钥表挤在一屏）
     以及它内联的 svc 健康计算。v29 把网关页拆成「MCP 服务 / LLM 路由 / Skill」三个
     页内 Tab，并把服务健康、模型路由、技能包三个取数口下沉到 QUERY 层
     （mcpHealth / llmRoutes / skillTable）—— 页面不自己算数。
     密钥清单 GW_KEYS 与「轮换 / 吊销」动作 gw-key 也一并搬去了 v29（那边按 kind 分
     MCP / LLM 两套，模型密钥与工具密钥的轮换节奏本来就不同）。
     删掉而不是留着被覆盖：同一页两份实现，下次改的时候一定会改错那一份。 */

  /* 2026-10-20：Workflow 列表页（RENDERERS.workflowPage）整块删除 —— 能力已下线，
     不留「有渲染器没入口」的死实现。原来这里的三档成功率色阶、需关注置顶与全部流程表一并移除。 */

  /* SECTION: r-table-page */
  RENDERERS.tablePage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets()[cap.table];
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';

    var cols = t.columns.map(function (c) {
      var col = Object.assign({}, c);
      if (c.fmt === 'rel') col.render = function (r) { return h.esc(fmt.rel(r[c.key])); };
      else if (c.fmt === 'status') col.render = function (r) { return h.pill(r.status, r.statusText); };
      else if (c.fmt === 'tags') col.render = function (r) { return (r[c.key] || []).map(function (x) { return '<span class="tag">' + h.esc(x) + '</span>'; }).join(''); };
      else if (c.fmt === 'chunk') col.render = function (r) { return '<span class="mono">' + r.chunkSize + ' / ' + r.overlap + '</span>'; };
      else if (c.fmt === 'conc') col.render = function (r) {
        var p = r[c.key].split('/'); var ratio = Number(p[0]) / Number(p[1]);
        return '<span class="' + (ratio > 0.85 ? 'warn' : '') + '">' + h.esc(r[c.key]) + '</span>';
      };
      else if (c.fmt === 'netpolicy') col.render = function (r) {
        return '<span class="' + (r.netPolicy === 'deny' ? 'ok' : (r.netPolicy === 'whitelist' ? '' : 'bad')) + '">' + h.esc(r.netPolicyText) + '</span>';
      };
      else if (c.fmt) col.render = function (r) { return h.esc(fmt[c.fmt](r[c.key])); };
      return col;
    });

    // 资产表均为配置态维度数据、无时间序列指标 —— 挂时间选择器就是装饰性控件，会让用户误以为切换生效，故不提供。
    var sideNote = '<span class="side-note" data-tip="本页为配置态资产数据（维度表），不含时间序列指标，因此不提供时间范围选择。运行态指标请看「可观测与评估」或「成本与调用归因」。">配置态数据 · 无时间维度</span>';

    return pageHead(h, cap, { side: sideNote, action: 'create-open' }) +
      '<div class="card pad0"><div class="card-h pad"><h3>' + h.esc(t.rows.length > 0 ? cap.name : cap.name) + '</h3>' +
      '<span class="card-sub">' + t.rows.length + ' 条记录</span></div>' +
      h.table({
        columns: cols, rows: t.rows, sortBy: state.sortKey, sortDir: state.sortDir,
        page: state.page || 1, pageSize: 20,
        emptyTitle: '暂无记录', emptySub: '点击右上角按钮创建第一条'
      }) + '</div>' +
      h.metaBar({}, [{ k: '数据性质', v: '本页为配置态资产数据（维度表），与运行态 trace 事实数据分离；运行指标由事实层聚合而来' }]);
  };

  /* SECTION: r-rbac-page
   * 账号与权限。
   *
   * 此前全站管得了 Agent 与规则，管不了「谁能登进来、能看什么、做过什么」——
   * 成员、角色、权限点三项都没有落点。这一页把它们放在一起，
   * 让「授权」不再只是审批页里一张孤立的规则表。
   *
   * 成员由 OWNERS + 角色绑定推导；角色与权限点是配置态（seed.PERM_POINTS / ROLES）；
   * 本页不做任何写操作 —— 改角色是高危动作，必须走审批与二次确认。
   */
  /* ── 角色权限只读（v26，重写）────────────────────────────────────────
     v25c 曾把矩阵做成可编辑（会话内 基线 ⊕ 增 − 删），但那条路有三个致命问题：
       · 与同屏角色卡「本页只读、改角色走审批」的文案互相打架；
       · 用的是 `h.dangerConfirm({...})` 而不是 `(h, opts)`，perm/onConfirm
         全被丢掉 —— 既不过门禁、点了也不生效（假前台）；
       · 「只在这次会话里改一改」这种状态既不生效、也留不了痕，不该出现在权限体系里。
     现在只读：本页只表达事实，改权限只有一条路 —— 走二次确认。 */
  function rbacEffPerms(S, roleId, state) {
    return (S.rolePerms(roleId) || []).slice();
  }
  global.RBAC_EFF_PERMS = rbacEffPerms;

  /* v26：矩阵改成只读视图后，「点格子改权限」这条路径整体撤掉。
     保留同名动作作为**兜底重定向**：任何残留入口（旧深链、缓存 DOM、外部脚本）
     点到它都把人送到审批链，而不是静默什么都不发生。 */
  ACTIONS['rbac-perm-toggle'] = function (id, btn, h) {
    h.toast('本页不提供直接改权限 —— 权限变更请走「审批存档」，需提交变更差异、理由与审批', 'warn');
  };

  /* ── 访问复核的三个动作 ────────────────────────────────────────────────
     口径照 Okta / SailPoint：
       · 决定先暂存（不产生效果、可撤回），统一提交后才改变授权状态；
       · 提交即最终，此后不可改；
       · 不能复核自己的授权（职责分离，与「不得自审自己的变更」同一条约束）。 */
  ACTIONS['rbac-review-decide'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var p = String(id || '').split('|');
    var gid = p[0], action = p[1];
    var g = (S.GRANT_RECORDS || []).filter(function (x) { return x.id === gid; })[0];
    if (!g) { h.toast('授权记录不存在', 'bad'); return; }
    if (action !== 'approve' && action !== 'revoke') { h.toast('未知的复核决定', 'bad'); return; }
    var o = S.OWNERS.filter(function (x) { return x.id === g.member; })[0] || { name: g.member };
    /* 职责分离：自己不能复核自己 —— 这条必须在入口拦下，不能只在提交时提示。 */
    if (g.member === ME.id) {
      h.toast('不能复核自己的授权（职责分离）—— 交由其他复核人处理', 'warn'); return;
    }
    var what = g.via === 'extra' ? '单独授予 · ' + S.permMeta(g.perm).label
      : '角色授权 · ' + ((S.ROLES.filter(function (x) { return x.id === g.role; })[0] || {}).name || g.role);
    var accDays = S.lastAccessDays ? S.lastAccessDays(g.member) : null;
    var lr = S.lastReviewAt ? S.lastReviewAt(g.member) : null;
    h.dangerConfirm(h, {
      title: action === 'revoke' ? '复核判定：撤销该授权' : '复核判定：该授权继续有效',
      desc: (action === 'revoke' ? '撤销' : '通过复核') + '「' + o.name + '」的' + what + '？',
      perm: 'rbac:review:decide',
      confirmText: action === 'revoke' ? '暂存「撤销」决定' : '暂存「通过」决定',
      danger: action === 'revoke',
      impacts: [
        { label: '成员', value: o.name + '（' + (o.dept || '—') + '）' },
        { label: '授权', value: what },
        { label: '最近访问', value: accDays == null ? '—' : (accDays === 0 ? '当前会话' : accDays + ' 天前'),
          tone: (accDays != null && accDays > 60) ? 'danger' : '' },
        { label: '上次复核', value: lr != null ? h.fmt.date(new Date(lr).toISOString()) : '从未复核',
          tone: lr == null ? 'warn' : '' },
        { label: '若不处理', value: '到期后自动降级为只读，相关操作被拦', tone: 'warn' },
        { label: '生效时机', value: '此决定仅暂存 —— 在「已决待提交」统一提交后才生效' }
      ],
      onConfirm: function (reason) {
        h.state.rbacReview = h.state.rbacReview || {};
        h.state.rbacReview[g.id] = { action: action, reason: reason, by: ME.name, at: S.NOW_TS };
        h.toast('已暂存：' + (action === 'revoke' ? '撤销' : '通过') + '「' + o.name + '」的授权 —— 去「已决待提交」提交后生效', 'ok');
        h.navigate({ tab: 'staged' });
      }
    });
  };

  ACTIONS['rbac-review-clear'] = function (id, btn, h) {
    var S = global.DATA_SEED;
    var log = h.state.rbacReview || {};
    var g = (S.GRANT_RECORDS || []).filter(function (x) { return x.id === id; })[0];
    if (!g || !log[id]) { h.toast('这条决定已经不存在了', 'warn'); return; }
    var o = S.OWNERS.filter(function (x) { return x.id === g.member; })[0] || { name: g.member };
    delete log[id];
    h.toast('已撤回对「' + o.name + '」的复核决定 —— 未提交前撤回不产生任何效果', 'ok');
    h.navigate({}, { scroll: false });
  };

  ACTIONS['rbac-review-commit'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var log = h.state.rbacReview || {};
    var ids = Object.keys(log);
    if (!ids.length) { h.toast('没有待提交的决定', 'warn'); return; }
    var grants = (S.GRANT_RECORDS || []).filter(function (g) { return log[g.id]; });
    var mine = grants.filter(function (g) { return g.member === ME.id; });
    /* 职责分离在提交口再拦一次 —— 暂存时可能是别人代录的，提交人必须自己干净。 */
    if (mine.length) {
      h.toast('本轮有 ' + mine.length + ' 条是你自己的授权，不能自己复核自己 —— 先撤回这些决定', 'bad');
      return;
    }
    var revokeN = grants.filter(function (g) { return log[g.id].action === 'revoke'; }).length;
    var approveN = grants.length - revokeN;
    h.dangerConfirm(h, {
      title: '提交本轮复核决定',
      desc: '提交 ' + grants.length + ' 条决定（通过 ' + approveN + ' 条 / 撤销 ' + revokeN + ' 条）？提交后不可更改。',
      perm: 'rbac:review:decide',
      confirmText: '提交 ' + grants.length + ' 条决定',
      danger: true,
      impacts: [
        { label: '通过', value: approveN + ' 条 —— 授权顺延 ' + (grants[0] ? grants[0].ttlDays : 90) + ' 天' },
        { label: '撤销', value: revokeN + ' 条 —— 权限立即回收，相关操作被拦', tone: revokeN ? 'danger' : '' },
        { label: '涉及成员', value: grants.map(function (g) {
            var o = S.OWNERS.filter(function (x) { return x.id === g.member; })[0] || {};
            return o.name || g.member;
          }).join('、') },
        { label: '提交后', value: '改变授权状态；本轮决定不可再改，需下一轮复核', tone: 'warn' }
      ],
      onConfirm: function (reason) {
        var ov = h.state.rbacReview;
        grants.forEach(function (g) {
          var st = ov[g.id];
          /* 通过 = 从今天起重算一个周期（等价于把授予日推到现在） */
          if (st && st.action === 'approve') g.grantAt = S.NOW_TS;
          delete ov[g.id];
        });
        h.toast('已提交 ' + grants.length + ' 条复核决定（通过 ' + approveN + ' / 撤销 ' + revokeN + '）· 仅本会话，刷新还原', 'ok');
        h.navigate({ tab: 'closed' });
      }
    });
  };

  ACTIONS['rbac-review-tab'] = function (id, btn, h) {
    /* KPI 卡与页面说明里的入口：切到复核对应视图。
       2026-10-21：账号页已删、审批下线 —— 原本的 approval 分支改成一句说明，不再往存档页跳。 */
    if (id === 'approval') {
      h.toast('审批流程已下线，改动确认后即时生效', 'info');
      return;
    }
    if (id === 'matrix') {
      /* 矩阵现在是「身份与权限」卡片里的一个页签，不再需要滚动定位。 */
      h.navigate({ tab: 'matrix' });
      return;
    }
    h.navigate({ tab: (id === 'staged' || id === 'closed') ? id : null });
  };

  RENDERERS.rbacPage = function (cap, state, h) {
    var fmt = h.fmt, S = global.DATA_SEED, ME = S.ME;
    var perms = S.PERM_POINTS || [], roles = S.ROLES || [];
    var groups = S.permGroups();
    var myPerms = ME.perms || [];
    /* 路由兼容垫片：app.js 的 parseHash 对本页没有特判，第二段视图名会被当成
       agentId 收走（#/platform/account/roles → agentId='roles'、state.tab=null）——
       那样页签点了不生效、深链也落回默认视图。视图名是封闭集合，在这里认回来；
       app.js 若日后为 account 补了「第二段是视图名」的特判，本垫片自动成为空操作。 */
    if (!state.tab && state.agentId &&
        ['staged', 'closed', 'member', 'roles', 'matrix'].indexOf(state.agentId) > -1) {
      state.tab = state.agentId;
    }
    /* 本页有两组页签，共用 state.tab 进 URL（#/platform/account/<view>）：
       复核视图 = todo / staged / closed；身份视图 = member / roles / matrix。
       两组各自只认自己的取值 —— 否则从「已完成」切到「角色」会有一组落空。 */
    var REVIEW_TABS = ['staged', 'closed'];
    var IDENTITY_TABS = ['member', 'roles', 'matrix'];
    var activeTab = REVIEW_TABS.indexOf(state.tab) > -1 ? state.tab : 'todo';
    var identityTab = IDENTITY_TABS.indexOf(state.tab) > -1 ? state.tab : 'member';

    /* 成员：OWNERS × 角色分配。roleId 手工分配用于演示不同人能做什么。 */
    /* v28：人 → 角色改为读 seed（唯一数据源）。
   原来这里手写了一份 ROLE_OF 映射，全文件 6 处副本 —— 见 _check/apply-role-source.js。 */
var roleOfUser = function (uid) { var S2 = global.DATA_SEED; return S2.roleOfUser ? S2.roleOfUser(uid) : 'r-viewer'; };
    /* 职责分离冲突：既持有审批权、又持有申请权的人 —— 必须显式标出来 */
    var SEP_CONFLICT = {};
    /* v28 删除：这里原有一行 `ROLE_OF.u104 = 'r-ops';`。
       它是冗余赋值（seed 里 u104 本来就映射 r-ops），且在我把 ROLE_OF 变量
       换成 roleOfUser() 之后会直接抛 ReferenceError —— 因此删掉。 */
    /* v22：会话内停用态 state.rbacOps[id]='revoked'。此前只写不读 ——
       toast 说「已停用」而表格纹丝不动，属于假生效。KPI、成员行、操作列读同一份状态。 */
    var ops = state.rbacOps || {};
    /* 会话内邀请进来的成员并入同一张表 —— 否则发了邀请看不见，闭环断掉 */
    var invited = (state.rbacInvites || []).map(function (v) {
      return { id: v.id, name: v.name, dept: v.dept, invitedRole: v.roleId, invited: true };
    });
    var members = S.OWNERS.map(function (o) {
      var rid = roleOfUser(o.id) || 'r-viewer';
      var r = roles.filter(function (x) { return x.id === rid; })[0] || { name: '—', color: 'idle' };
      var ps = rbacEffPerms(S, rid, state);
      var canApprove = ps.some(function (p) { return p.indexOf('approval:decide:approve') === 0; });
      var canApply = ps.some(function (p) { return p.indexOf('approval:create') === 0; });
      SEP_CONFLICT[o.id] = canApprove && canApply;
      /* v28：带上身份层字段。列表要答的不再只是"他是谁"，
         而是"他怎么登进来、从哪来、这份权限下次什么时候必须再看一遍"。 */
      var idn = S.identityOf ? S.identityOf(o.id) : null;
      var revState = S.reviewState ? S.reviewState(o.id) : null;
      var revDays = S.nextReviewInDays ? S.nextReviewInDays(o.id) : null;
      return {
        id: o.id, name: o.name, dept: o.dept, roleId: rid,
        roleName: r.name, roleColor: r.color,
        permCount: ps.length,
        highCount: ps.filter(function (p) { var m = S.permMeta(p); return m.risk === 'high'; }).length,
        /* 身份层 */
        identity: idn,
        accessText: (S.accessMethods ? S.accessMethods(o.id).join(' + ') : '—'),
        apiAccess: !!(idn && idn.api),
        sourceText: (idn && S.SOURCE_LABEL ? (S.SOURCE_LABEL[idn.source] || idn.source) : '—'),
        sourceKind: idn ? idn.source : 'manual',
        mfaText: (idn && S.MFA_LABEL ? (S.MFA_LABEL[idn.mfa] || idn.mfa) : '—'),
        mfaOn: !!(idn && idn.mfa && idn.mfa !== 'none'),
        createDays: idn ? idn.createDaysAgo : null,
        groupNames: (S.groupsOfUser ? S.groupsOfUser(o.id).map(function (g) { return g.name; }) : []),
        /* 我们的侧重：下一轮复核 */
        reviewState: revState,
        nextReviewDays: revDays,
        isMe: o.id === ME.id,
        revoked: ops[o.id] === 'revoked',
        lastLoginMin: o.id === ME.id ? ME.session.issuedMin : 30 + (o.id.charCodeAt(3) * 7) % 400,
        /* 复核证据（Okta review item 详情同口径）：最近一次真实访问、上一次被复核的时间。
           两个字段在位，「该不该留」就不用靠一段解释性文案说服读者。 */
        lastAccessMin: S.lastAccessMin ? S.lastAccessMin(o.id) : null,
        lastAccessDays: S.lastAccessDays ? S.lastAccessDays(o.id) : null,
        lastReviewAt: (typeof S.lastReviewAt === 'function' ? S.lastReviewAt(o.id) : null)
      };
    });
    /* 会话内邀请进来的人：标「待激活」，权限按所选角色展示 —— 让"邀请了谁、给什么角色"看得见 */
    (state.rbacInvites || []).forEach(function (v) {
      var rid = v.roleId;
      var r = roles.filter(function (x) { return x.id === rid; })[0] || { name: '—', color: 'idle' };
      var ps = rbacEffPerms(S, rid, state);
      members.push({
        id: v.id, name: v.name, dept: v.dept, roleId: rid,
        roleName: r.name, roleColor: r.color,
        permCount: ps.length,
        highCount: ps.filter(function (p) { return S.permMeta(p).risk === 'high'; }).length,
        isMe: false, revoked: false, invited: true, inviteReason: v.reason,
        lastLoginMin: 0
      });
    });
    var activeMembers = members.filter(function (m) { return !m.revoked; });
    var myConflict = SEP_CONFLICT[ME.id];
    var highPerms = perms.filter(function (p) { return p.risk === 'high'; });
    var highMine = highPerms.filter(function (p) { return myPerms.indexOf(p.p) > -1; });
    var orphanPerms = perms.filter(function (p) {
      return !roles.some(function (r) { return rbacEffPerms(S, r.id, state).indexOf(p.p) > -1; });
    });
    var unusedRoles = roles.filter(function (r) { return r.id !== ME.roleId; });

    /* 授权到期统计必须算在 metrics 之前 —— var 提升但赋值不提升，
       顺序写反会直接 TDZ ReferenceError（这个坑本项目已踩过一次）。 */
    var grants = S.GRANT_RECORDS || [];

    /* ── 访问复核的数据（Okta / SailPoint 口径）────────────────────────────
       复核不是「权限配置的一部分」，是一条独立流程：待复核 → 已决待提交 → 已完成。
       决定先落在 state.rbacReview[grantId]，再由「提交本轮决定」落定 ——
       未提交前不产生任何效果、可逐条撤回。 */
    var WARN_DAYS = 15;
    var revLog = state.rbacReview || {};
    /* v26 修正：原先要求「持有高危权限」才叫休眠，但实测没有一个人满足
       （唯一长期不用的 u107 是只读观察者，0 个高危）—— 一条恒为 0 的 KPI 等于没做。
       改口径：**长期未使用**本身就是复核的理由，不看风险等级。 */
    var UNUSED_DAYS = 60;
    var dormant = members.filter(function (m) {
      return !m.revoked && !m.invited && m.lastAccessDays != null && m.lastAccessDays > UNUSED_DAYS;
    });
    var latestByMember = {};
    grants.forEach(function (g) {
      if (!latestByMember[g.member] || g.grantAt > latestByMember[g.member]) latestByMember[g.member] = g.grantAt;
    });
    var pendingRev = grants.filter(function (g) {
      /* 待复核 = 已超期 或 进入预警窗口（warnDays 天内到期）。已决未提交的移出待办。 */
      return !revLog[g.id] && (S.grantState(g) === 'expired' || S.grantState(g) === 'expiring');
    }).sort(function (a, b) {
      /* 排序即优先级：长期未使用的排最前，其次按剩余天数升序。
         「赶截止日期的活」不能让人自己在几十行里找哪条最要紧。 */
      var da = (S.lastAccessDays && S.lastAccessDays(a.member) > UNUSED_DAYS) ? 0 : 1;
      var db = (S.lastAccessDays && S.lastAccessDays(b.member) > UNUSED_DAYS) ? 0 : 1;
      return (da - db) || (S.grantDaysLeft(a) - S.grantDaysLeft(b));
    });
    var stagedRev = grants.filter(function (g) { return !!revLog[g.id]; });
    /* 已完成 = 本会话已给出决定，或仍在有效期内、本轮无需动作。 */
    var closedRev = grants.filter(function (g) { return revLog[g.id] || S.grantState(g) === 'active'; });
    var overdueRev = pendingRev.filter(function (g) { return S.grantState(g) === 'expired'; });
    var expiringRev = pendingRev.filter(function (g) { return S.grantState(g) === 'expiring'; });
    var selfStaged = stagedRev.filter(function (g) { return g.member === ME.id; });

    /* 概览指标：只放「会变、且能推出动作」的量。
       成员数 / 角色数 / 权限点总数是平台常量，放进 KPI 只占位置 —— 下面「角色与权限」里如实列出。 */
    var metrics = [
      { label: '待我复核', value: String(pendingRev.length), alert: pendingRev.length > 0,
        sub: overdueRev.length ? overdueRev.length + ' 份已超期 · 其余进入 ' + WARN_DAYS + ' 天预警窗口' : '全部在有效期内',
        definition: '复核口径：授权已超期，或将在 ' + WARN_DAYS + ' 天预警窗口内到期。超期授权相关操作会被拦下。',
        act: 'rbac-review-tab', actId: 'todo', actTitle: '看待复核清单' },
      { label: '已决待提交', value: String(stagedRev.length), alert: stagedRev.length > 0,
        sub: stagedRev.length ? '提交前可逐条撤回' : '没有未提交的决定',
        definition: '决定先暂存，统一提交才改变授权状态；未提交前不产生任何效果。',
        act: 'rbac-review-tab', actId: 'staged', actTitle: '看已决待提交' },
      { label: '长期未使用', value: String(dormant.length), alert: dormant.length > 0,
        sub: dormant.length ? '超过 ' + UNUSED_DAYS + ' 天没有访问，应复核或回收' : '没有长期未使用的账号',
        definition: '判定条件：最近一次访问距今超过 ' + UNUSED_DAYS + ' 天。不看风险等级 —— 不用了就该复核，这类最容易被漏掉。',
        act: 'rbac-review-tab', actId: 'todo', actTitle: '去复核' },
      { label: '我的高危权限', value: String(highMine.length), alert: highMine.length > 8,
        sub: ME.role + ' · 全部权限 ' + myPerms.length + ' / ' + perms.length,
        definition: '高危权限 = 授予需二次审批、每 90 天须重新确认的权限点。',
        act: 'rbac-review-tab', actId: 'matrix', actTitle: '看权限矩阵' }
    ];

    /* ── 该收紧什么：只列查得出、点得动的发现 ─────────────────────────────
       此前这里塞了两类东西：一是「孤儿权限点」这类平台常量（永远 0，凑数），
       二是一段解释「到期≠没有权限」的免责说明。免责声明不该占据发现位。
       现在每条发现都必须能回答「谁、为什么、去哪儿处理」。 */
    var findings = [];
    if (dormant.length) {
      findings.push({ why: 'bad', who: '长期未使用', act: 'rbac-review-tab', actId: 'todo',
        actTitle: '到下方「访问复核 · 待我复核」逐条撤销或保留',
        what: dormant.length + ' 个账号超过 ' + UNUSED_DAYS + ' 天没有访问，权限却仍在生效',
        go: h.esc(dormant.map(function (m) { return m.name + '（' + m.lastAccessDays + ' 天）'; }).join('、')) +
          ' —— 在下方复核里逐条撤销；同意保留也要留一次复核记录' });
    }
    if (overdueRev.length) {
      findings.push({ why: 'bad', who: '授权已超期', act: 'rbac-review-tab', actId: 'todo',
        actTitle: '到下方「访问复核 · 待我复核」处理（超期项已在其中）',
        what: overdueRev.length + ' 份授权超期未复核，持有人在相关操作上已被拦下',
        go: h.esc(overdueRev.map(function (g) {
          var o = S.OWNERS.filter(function (x) { return x.id === g.member; })[0] || {};
          return o.name + '（超期 ' + Math.abs(S.grantDaysLeft(g)) + ' 天）';
        }).join('、')) + ' —— 复核通过即刻恢复，判定撤销则回收权限' });
    }
    var neverReviewed = members.filter(function (m) { return !m.invited && !m.revoked && m.lastReviewAt == null; });
    if (neverReviewed.length) {
      findings.push({ why: 'warn', who: '从未复核', act: 'rbac-review-tab', actId: 'todo',
        actTitle: '到下方「访问复核」补一次复核（复核依据里「上次复核」为空即是这一类）',
        what: neverReviewed.length + ' 个账号的权限自开通以来没有被任何一次复核覆盖',
        go: h.esc(neverReviewed.map(function (m) { return m.name; }).join('、')) + ' —— 复核依据里「上次复核」为空即是这一类' });
    }
    if (myConflict) {
      /* 这一条**故意不给动作**：本页按设计不提供改角色入口，改角色一律走二次确认。
         给个按钮等于把用户送到一个"改了不算"的地方。 */
      findings.push({ why: 'warn', who: '职责分离冲突', act: 'rbac-review-tab', actId: 'approval',
        actTitle: '改角色走二次确认（本页不提供直改入口）',
        what: '你同时持有「审批通过」与「发起审批」',
        go: '本人发起的单据不会进「待我审批」，靠数据层过滤兜底；彻底消除要把申请权移出该角色 —— 改角色走审批，本页不提供入口' });
    }
    var focus =
      '<div class="card"><div class="card-h"><h3>该收紧什么</h3>' +
      '<span class="card-sub">' + findings.length + ' 项发现 · 每条都能点进对应处理位置</span></div>' +
      (findings.length
        ? '<div class="ab-list">' + findings.map(function (f) {
            /* 卡头写的是「每条都能点进对应处理位置」—— 那就必须真能点。
               用 div[role=button]（内含块级内容，不能塞 <button>）；键盘可达由 bindContent 统一接。 */
            return '<div class="v10-impacts-row" role="button" tabindex="0"' +
              ' data-act="' + h.esc(f.act) + '" data-id="' + h.esc(f.actId) + '"' +
              ' title="' + h.esc(f.actTitle || '') + '">' +
              '<span class="ab-why ' + f.why + '">' + h.esc(f.who) + '</span>' +
              '<b>' + h.esc(f.what) + '</b><span class="ab-go">' + f.go + '</span></div>';
          }).join('') + '</div>'
        : '<div class="bt-note" style="margin:14px 16px">没有需要收紧的项：无长期未使用的账号、无超期授权、全部账号都在复核覆盖范围内。</div>') +
      '</div>';

    /* ── 访问复核：待复核 → 已决待提交 → 已完成 ──────────────────────────
       Okta / SailPoint 的口径：复核是一条独立流程，决定分「暂存」与「提交」两步 ——
       提交前不产生任何效果、可逐条撤回；提交即最终，改变授权状态。
       三个视图各自的理由：待办要能清空（复核是赶截止日期的活，不是浏览）；
       暂存要能改主意；已完成要能回答「这人上次是什么时候被复核的」。 */
    function actLink(g) {
      var st = revLog[g.id];
      if (st) {
        return '<span class="pill ' + (st.action === 'revoke' ? 'bad' : 'ok') + '">' +
          (st.action === 'revoke' ? '已决：撤销' : '已决：通过') + '</span>' +
          ' <button class="lnk" data-act="rbac-review-clear" data-id="' + h.esc(g.id) + '">撤回</button>';
      }
      /* 2026-10-20 走查修复：原来两个按钮用「 · 」串在一格里，列宽不足时被拆成
         「通过复核」「撤销授权」各占两行、甚至逐字换行。改用 nowrap 的 flex 容器。 */
      return '<span class="rv-acts">' +
        '<button class="lnk ok" data-act="rbac-review-decide" data-id="' + h.esc(g.id) + '|approve">通过复核</button>' +
        '<button class="lnk warn" data-act="rbac-review-decide" data-id="' + h.esc(g.id) + '|revoke">撤销授权</button>' +
        '</span>';
    }
    var revCols = [
      { key: 'who', label: '成员', render: function (r) {
        var o = S.OWNERS.filter(function (x) { return x.id === r.member; })[0] || {};
        var d = S.lastAccessDays ? S.lastAccessDays(r.member) : null;
        var dorm = (d != null && d > UNUSED_DAYS);
        return '<span class="av-face">' + h.avatar(o.name || r.member, { face: true }) + '</span>' +
          '<b>' + h.esc(o.name || r.member) + '</b>' + (r.member === ME.id ? ' <span class="pill info">我</span>' : '') +
          '<div class="td-sub">' + h.esc(o.dept || '—') + '</div>' +
          (dorm ? '<div class="td-sub"><span class="bad">' + d + ' 天未使用</span></div>' : '');
      } },
      { key: 'src', label: '授权来源', render: function (r) {
        if (r.via === 'extra') {
          var pm = S.permMeta(r.perm);
          return '单独授予：' + h.esc(pm.label) + '<div class="td-sub mono">' + h.esc(r.perm) +
            (pm.risk === 'high' ? ' <span class="pill bad">高危</span>' : '') + '</div>';
        }
        var rr = S.ROLES.filter(function (x) { return x.id === r.role; })[0] || {};
        return '角色 ' + h.esc(rr.name || r.role) + '<div class="td-sub">' + (S.rolePerms(r.role) || []).length + ' 个权限点</div>';
      } },
      { key: 'evidence', label: '复核依据', render: function (r) {
        var d = S.lastAccessDays ? S.lastAccessDays(r.member) : null;
        var lr = S.lastReviewAt ? S.lastReviewAt(r.member) : null;
        return '<span class="td-sub">最近访问：' + (d == null ? '—' : fmt.rel(-d)) + '</span>' +
          '<div class="td-sub">上次复核：' + (lr == null ? '<span class="bad">从未复核</span>' : fmt.date(new Date(lr).toISOString())) + '</div>';
      } },
      { key: 'grantAt', label: '授予日期', render: function (r) {
        return fmt.date(new Date(r.grantAt).toISOString()) +
          '<div class="td-sub">理由：' + h.esc(r.reason || '—') + '</div>';
      } },
      { key: 'daysLeft', label: '到期', align: 'right', sortable: true, render: function (r) {
        var d = S.grantDaysLeft(r), st = S.grantState(r);
        if (st === 'expired') return '<span class="bad">已超期 ' + Math.abs(d) + ' 天</span>';
        if (st === 'expiring') return '<span class="warn">剩 ' + d + ' 天</span><div class="td-sub">' + r.warnDays + ' 天预警窗口内</div>';
        return '<span class="ok">剩 ' + d + ' 天</span>';
      } },
      { key: 'act', label: '决定', render: actLink }
    ];
    var revKpis = '<div class="metrics">' + [
      { label: '待我复核', value: String(pendingRev.length), alert: pendingRev.length > 0,
        sub: overdueRev.length ? overdueRev.length + ' 份已超期 · 其余在 ' + WARN_DAYS + ' 天窗口内' : '全部在有效期内',
        definition: '复核口径：授权已超期，或将在预警窗口内到期。超期期间相关操作会被拦下。' },
      { label: '已超期', value: String(overdueRev.length), alert: overdueRev.length > 0,
        sub: overdueRev.length ? '相关操作已被拦下' : '无',
        definition: '超期不等于没有权限：复核通过即刻恢复，判定撤销才回收。' },
      { label: '本轮已决', value: String(stagedRev.length), alert: stagedRev.length > 0,
        sub: stagedRev.length ? '提交后才生效' : '尚未做任何决定',
        definition: '决定先暂存（不产生效果、可逐条撤回），统一提交后才改变授权状态。' }
    ].map(h.metricCard).join('') + '</div>';
    var reviewTabs = '<div class="tabs" role="tablist">' + [
      { id: 'todo', label: '待我复核', n: pendingRev.length },
      { id: 'staged', label: '已决待提交', n: stagedRev.length },
      { id: 'closed', label: '已完成', n: closedRev.length }
    ].map(function (t) {
      return '<button role="tab" class="tab' + (t.id === activeTab ? ' on' : '') + '" data-tab="' + t.id + '"' +
        ' aria-selected="' + (t.id === activeTab) + '">' + h.esc(t.label) +
        (t.n ? '<i class="tab-badge">' + t.n + '</i>' : '') + '</button>';
    }).join('') + '</div>';

    var reviewTodo = '<div class="card pad0"><div class="card-h pad"><h3>待我复核</h3>' +
      '<span class="card-sub">' + pendingRev.length + ' 份 · 长期未使用与临期排前 · 决定先暂存，统一提交</span></div>' +
      h.table({ columns: revCols, rows: pendingRev, noPaging: true,
        emptyTitle: '本轮待复核已清空',
        emptySub: '没有超期或进入预警窗口的授权 —— 去「已决待提交」提交决定，或看「已完成」' }) +
      (overdueRev.length
        ? '<div class="alert-banner bad" style="margin:0 14px 14px"><b>⚠ ' + overdueRev.length + ' 份授权已超期</b>' +
          '<span>' + overdueRev.map(function (g) {
            var o = S.OWNERS.filter(function (x) { return x.id === g.member; })[0] || {};
            return h.esc(o.name + '（' + (g.via === 'extra' ? S.permMeta(g.perm).label : '角色授权') + '，超期 ' + Math.abs(S.grantDaysLeft(g)) + ' 天）');
          }).join('；') + '</span>' +
          '<span class="hint">超期期间相关操作被拦下；复核通过即刻恢复，判定撤销则回收权限。</span></div>'
        : '') + '</div>';

    var reviewStaged = '<div class="card pad0"><div class="card-h pad"><h3>已决待提交</h3>' +
      '<button class="btn-primary sm" data-act="rbac-review-commit"' +
      (stagedRev.length ? '' : ' disabled') + '>提交本轮决定（' + stagedRev.length + '）</button></div>' +
      '<div class="bt-note" style="margin:0 14px 12px">提交前逐条可撤回；提交即改变授权状态，此后不再可改。' +
      (selfStaged.length ? '<br><b class="bad">其中 ' + selfStaged.length + ' 条是你自己的授权 —— 不能自己复核自己，提交会被拒。</b>' : '') +
      '</div>' +
      h.table({ columns: [
        { key: 'who', label: '成员', render: function (r) {
            var o = S.OWNERS.filter(function (x) { return x.id === r.member; })[0] || {};
            return '<b>' + h.esc(o.name || r.member) + '</b>' + (r.member === ME.id ? ' <span class="pill bad">本人授权</span>' : '') +
              '<div class="td-sub mono">' + h.esc(r.member) + '</div>'; } },
        { key: 'what', label: '授权', render: function (r) {
            if (r.via === 'extra') return h.esc(S.permMeta(r.perm).label) + '<div class="td-sub mono">' + h.esc(r.perm) + '</div>';
            var rr = S.ROLES.filter(function (x) { return x.id === r.role; })[0] || {};
            return '角色 ' + h.esc(rr.name || r.role); } },
        { key: 'd', label: '本轮决定', render: function (r) {
            var st = revLog[r.id] || {};
            return '<span class="pill ' + (st.action === 'revoke' ? 'bad' : 'ok') + '">' +
              (st.action === 'revoke' ? '撤销授权' : '通过复核') + '</span>' +
              '<div class="td-sub">' + h.esc(st.reason || '—') + '</div>'; } },
        { key: 'act', label: '操作', render: function (r) {
            return '<button class="lnk" data-act="rbac-review-clear" data-id="' + h.esc(r.id) + '">撤回这条决定</button>'; } }
      ], rows: stagedRev, noPaging: true,
        emptyTitle: '没有待提交的决定', emptySub: '在「待我复核」里做决定后会出现在这里' }) + '</div>';

    /* 授权有效期（已完成视图）：把「90 天」从规则变成逐条可核的事实，放在复核的归档位。 */
    var grantTable = '<div class="card pad0"><div class="card-h pad"><h3>授权有效期</h3>' +
      '<span class="card-sub">' + closedRev.length + ' 条 · 在有效期内或本轮已决 · 高危权限每 90 天须重新确认</span></div>' +
      h.table({
        columns: [
          { key: 'who', label: '成员', render: function (r) {
            var o = S.OWNERS.filter(function (x) { return x.id === r.member; })[0] || {};
            return '<b>' + h.esc(o.name || r.member) + '</b>' + (r.member === ME.id ? ' <span class="pill info">我</span>' : '') +
              '<div class="td-sub mono">' + h.esc(r.member) + '</div>';
          } },
          { key: 'src', label: '授权来源', render: function (r) {
            if (r.via === 'extra') {
              return '单独授予<div class="td-sub mono">' + h.esc(r.perm) + '</div>';
            }
            var rr = S.ROLES.filter(function (x) { return x.id === r.role; })[0] || {};
            return '角色 ' + h.esc(rr.name || r.role) + '<div class="td-sub">' + (S.rolePerms(r.role) || []).length + ' 个权限点</div>';
          } },
          { key: 'grantAt', label: '授予日期', render: function (r) {
            return fmt.date(new Date(r.grantAt).toISOString()) + '<div class="td-sub">理由：' + h.esc(r.reason || '—') + '</div>';
          } },
          { key: 'reviewed', label: '上次复核', render: function (r) {
            var st = revLog[r.id];
            if (st) return '<span class="pill ' + (st.action === 'revoke' ? 'bad' : 'ok') + '">' +
              (st.action === 'revoke' ? '本轮撤销' : '本轮通过') + '</span><div class="td-sub">' + h.esc(st.by || '') + '</div>';
            var lr = S.lastReviewAt ? S.lastReviewAt(r.member) : null;
            return lr == null ? '<span class="bad">从未复核</span>' : fmt.date(new Date(lr).toISOString());
          } },
          { key: 'daysLeft', label: '剩余', align: 'right', sortable: true, render: function (r) {
            var d = S.grantDaysLeft(r), st = S.grantState(r);
            if (st === 'expired') return '<span class="bad">已超期 ' + Math.abs(d) + ' 天</span>';
            if (st === 'expiring') return '<span class="warn">剩 ' + d + ' 天</span><div class="td-sub">' + r.warnDays + ' 天内未确认将降级</div>';
            return '<span class="ok">剩 ' + d + ' 天</span>';
          } }
        ],
        rows: closedRev.slice().sort(function (a, b) { return S.grantDaysLeft(a) - S.grantDaysLeft(b); }),
        noPaging: true,
        emptyTitle: '没有在有效期内的授权', emptySub: '全部授权都进入复核了'
      }) + '</div>';

    var reviewCard = '<div class="card pad0" id="rbac-review"><div class="card-h pad"><h3>访问复核</h3>' +
      '<span class="card-sub">超期与预警窗口内的授权 · 每 90 天一轮 · 决定两步走' +
      (myPerms.indexOf('rbac:review:decide') > -1 ? '' : ' · <b class="bad">你没有 rbac:review:decide，决定会被门禁拦下</b>') +
      '</span></div>' +
      '<div style="padding:12px 14px 0">' + revKpis + reviewTabs + '</div>' +
      '<div style="padding:12px 14px 14px">' +
      (activeTab === 'staged' ? reviewStaged : (activeTab === 'closed' ? grantTable : reviewTodo)) +
      '</div></div>';

    /* 成员视图（嵌在「身份与权限」卡片内的第一个页签，不再自带卡片外壳） */
    var memberTableOld = '<div class="card-sub" style="padding:10px var(--space-3) 0">' + members.length + ' 人 · 在职 ' + activeMembers.length + ' 人' +
        (members.length - activeMembers.length ? ' · 已停用 ' + (members.length - activeMembers.length) + ' 人（权限已回收）' : '') +
        ' · 角色决定可见范围与可执行动作</div>' +
      h.table({
        columns: [
          { key: 'name', label: '成员', render: function (r) {
            /* v27：人在这一屏是主角，补头像做视觉锚点。face:true → 只要圆形首字，
               与姓名同行基线对齐靠 .av-face 包一层的 inline-flex（见 HTML SECTION: v27-avatar）。 */
            return '<span class="av-face">' + h.avatar(r.name, { face: true }) + '</span>' +
              '<b>' + h.esc(r.name) + '</b>' + (r.isMe ? ' <span class="pill info">我</span>' : '') +
              (r.revoked ? ' <span class="pill bad">已停用</span>' : '') +
              '<div class="td-sub mono">' + h.esc(r.id) + ' · ' + h.esc(r.dept) + '</div>';
          } },
          { key: 'roleName', label: '角色', render: function (r) { return h.pill(r.revoked ? 'idle' : r.roleColor, r.revoked ? '已回收' : r.roleName); } },
          { key: 'permCount', label: '权限点', align: 'right', sortable: true,
            render: function (r) {
              if (r.revoked) return '<span class="muted">0</span><div class="td-sub">已全部回收</div>';
              return fmt.int(r.permCount) + '<div class="td-sub">' + (r.highCount ? h.esc(r.highCount + ' 个高危') : '无高危') + '</div>';
            } },
          /* v28 新增：访问方式（控制台 / 编程）+ 账号来源。
             这两列是云控制台身份页的标配，也是"这个账号能不能登进来"的唯一答案。 */
          { key: 'accessText', label: '访问方式',
            render: function (r) {
              if (r.invited) return '<span class="muted">—</span>';
              /* ⚠ 第一版把两个标签都写成 ok 样式、且忽略 apiAccess 布尔值，
                 结果每个人的"编程"都亮着（含数据里 api:false 的赵六/孙琪/吴桐）——
                 这类"看起来有、其实没有"的假信息在权限页上最危险，必须按真实布尔值渲染。 */
              var tag = function (txt, on) { return '<span class="tag' + (on ? ' ok' : '') + '">' + txt + '</span>'; };
              return (r.revoked ? '<span class="muted">已停用</span>' : tag('控制台', true) + ' ' + tag('编程', !!r.apiAccess)) +
                '<div class="td-sub">' + h.esc(r.sourceText || '—') + '</div>';
            } },
          /* v28 新增：下一轮复核。这一屏的侧重 —— 云控制台只管"他是谁、能干什么"，
             我们还要答"这份权限下次什么时候必须再看一遍"。 */
          { key: 'nextReviewDays', label: '复核', align: 'right', sortable: true,
            render: function (r) {
              if (r.invited) return '<span class="muted">—</span>';
              if (r.revoked) return '<span class="muted">已回收</span>';
              if (r.reviewState === 'overdue') return '<span class="bad">已超期 ' + Math.abs(r.nextReviewDays) + ' 天</span>' +
                '<div class="td-sub">相关操作已被拦下</div>';
              if (r.reviewState === 'warn') return '<span class="pill warn">' + r.nextReviewDays + ' 天后</span>' +
                '<div class="td-sub">进入 15 天预警窗口</div>';
              if (r.nextReviewDays == null) return '<span class="muted">—</span>';
              return '<span class="ok">' + r.nextReviewDays + ' 天后</span>' +
                '<div class="td-sub">90 天一轮</div>';
            } },
          { key: 'lastLoginMin', label: '最近活动', align: 'right', sortable: true,
            render: function (r) {
              if (r.invited) return '<span class="pill warn">待激活</span>';
              if (r.revoked) return '<span class="muted">会话已失效</span>';
              var d = r.lastAccessDays;
              if (d == null) return '<span class="muted">无记录</span>';
              var dorm = d > UNUSED_DAYS;
              var idn = r.identity || {};
              return (dorm ? '<span class="bad">' + fmt.rel(-d) + '</span>'
                          : (r.isMe ? '<span class="ok">' + fmt.rel(-d) + '</span>' : fmt.rel(-d))) +
                '<div class="td-sub">' + h.esc(r.mfaOn ? r.mfaText : '未启用 MFA') + (idn.lastIp ? ' · ' + h.esc(idn.lastIp) : '') + '</div>';
            } },
          { key: 'act', label: '操作', render: function (r) {
            if (r.isMe) return '<button class="lnk" data-act="rbac-member" data-id="' + h.esc(r.id) + '">详情</button>' +
              ' <span class="muted" style="font-size:12px">不能停用自己</span>';
            return '<button class="lnk" data-act="rbac-member" data-id="' + h.esc(r.id) + '">详情</button>' +
              (r.revoked
                ? ' · <button class="lnk" data-act="rbac-restore" data-id="' + h.esc(r.id) + '">恢复</button>'
                : ' · <button class="lnk" data-act="rbac-revoke" data-id="' + h.esc(r.id) + '">停用</button>');
          } }
          ],
        rows: members, noPaging: true,
        /* v27：整行可点进详情 —— table() 已有 rowAction 机制（app.js:430/1075），
           且会忽略行内按钮上的点击（app.js:1077），所以「停用/恢复」不会被误触发。
           原来只有「详情」两个字可点：命中区小，也不符合"列表即导航"的惯例。 */
        rowAction: 'row-member', rowIdKey: 'id',
        emptyTitle: '没有成员', emptySub: '成员由企业目录同步'
      });

    /* v36：按人头管理 —— 每人一张卡片，点开就是这个人的权限清单（可续/可收/可加）。
       业主原话：「每个人做成一个卡片，点击卡片就可以管理每个权限」。
       V36MC 不存在时落回上面那张成员表，零风险 —— 表本身一行没删，只是不再被用。 */
    var memberTable = (global.V36MC && global.V36MC.grid)
      ? global.V36MC.grid(h, members, state, fmt)
      : memberTableOld;

    /* 角色（可展开，不再开弹窗）─────────────────────────────────────────
       v26：角色卡与角色明细弹窗合并成一个 `<details>` 列表 —— 原先「6 行摘要 + 点开
       弹窗看全量」是两层跳转，而这里要的就是"这个角色到底能干什么"。
       展开后按域分组列出权限点，一眼看完，不离开页面。 */
    var roleCards = roles.map(function (r) {
      var ps = rbacEffPerms(S, r.id, state);
      var mine = r.id === ME.roleId;
      var byGrp = {};
      ps.forEach(function (p) { var m = S.permMeta(p); (byGrp[m.grp] = byGrp[m.grp] || []).push(m); });
      var highN = ps.filter(function (p) { return S.permMeta(p).risk === 'high'; }).length;
      /* v28 一致性：角色 pill 的颜色只由**角色本身的色**决定。
         原写法对"我的角色"特判成 info（蓝），于是同一个角色名在角色页是蓝、
         在成员/审批页是琥珀 —— 同一文案两种颜色，色盲用户判不出角色。
         "是不是我的角色"已由后面那个 <span class="tag">我的角色</span> 表达，不必再借颜色。 */
      return '<details class="gv-role">' +
        '<summary>' + h.pill(r.color || 'idle', r.name) +
        (mine ? ' <span class="tag">我的角色</span>' : '') +
        '<b>' + ps.length + ' 个权限点</b>' +
        '<span class="muted">' + r.users + ' 人' + (highN ? ' · 含 ' + highN + ' 个高危' : ' · 无高危') + '</span>' +
        '<span class="muted" style="margin-left:auto">' + h.esc(r.desc) + '</span></summary>' +
        '<div class="body">' +
        /* 两栏：左＝按域分组的权限点，右＝变更规则。
           单栏时右侧那句规则被挤成一行一字（实测），所以由 body 的 grid 固定右栏宽度。 */
        '<div class="gv-perms">' +
        Object.keys(byGrp).map(function (g) {
          return '<div class="sub-h">' + h.esc(g) + '（' + byGrp[g].length + '）</div>' +
            '<div>' + byGrp[g].map(function (m) {
              return '<span class="tag ' + (m.risk === 'high' ? 'bad' : '') + '" title="' + h.esc(m.p + ' · 风险 ' + ({ low: '低', mid: '中', high: '高' }[m.risk] || m.risk)) + '">' +
                h.esc(m.label) + '</span>';
            }).join('') + '</div>';
        }).join('') + '</div>' +
        '<div class="bt-note">改角色是高危动作：需提交变更前后差异、走审批，' +
        '且不得由本人审批自己提出的变更。本页只读，不给直改入口。</div>' +
        '</div></details>';
    }).join('');

    /* 权限点矩阵（只读 + 按域折叠）──────────────────────────────────────
       v26 两处改动：
       ① 格子从可点按钮改成非交互标记 —— 此前同屏角色卡写着「本页只读、改角色走审批」，
          而矩阵每个格子都能点，两个答案打架，且点下去也不生效（弹层丢了 perm 与 onConfirm）。
       ② 85 行 × 9 列全部展开是 4802px（占整页 64%），读者每核对一次权限要滚 4600px。
          改成按域 `<details>`：默认只展开第一组，需要哪组开哪组。 */
    var matrix = '<div class="card-sub" style="padding:10px var(--space-3) 0">' +
      perms.length + ' 个权限点 × ' + roles.length + ' 个角色 · 只读视图 · 按域展开</div>' +
      '<div style="padding:0 var(--space-3) var(--space-3)">' +
      groups.map(function (g, gi) {
        var gp = perms.filter(function (p) { return p.grp === g; });
        return '<details class="gv-fold"' + (gi === 0 ? ' open' : '') + '>' +
          '<summary>' + h.esc(g) + '<span class="n">' + gp.length + ' 个权限点</span></summary>' +
          '<div class="tbl-wrap"><table class="bt"><thead><tr><th>权限点</th><th>风险</th>' +
          roles.map(function (r) { return '<th class="ta-r" title="' + h.esc(r.name) + '">' + h.esc(r.name) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          gp.map(function (p) {
            var mine = myPerms.indexOf(p.p) > -1;
            return '<tr' + (mine ? ' style="background:var(--blue-weak)"' : '') + '>' +
              '<td><span style="font-size:14px;line-height:var(--lh-tight)">' + h.esc(p.label) + '</span>' +
                (mine ? ' <span class="pill info">我有</span>' : '') +
                '<div class="td-sub mono">' + h.esc(p.p) + '</div></td>' +
              '<td><span class="pill ' + (p.risk === 'high' ? 'bad' : (p.risk === 'mid' ? 'warn' : 'ok')) + '">' +
                h.esc({ low: '低', mid: '中', high: '高' }[p.risk]) + '</span></td>' +
              roles.map(function (r) {
                var has = rbacEffPerms(S, r.id, state).indexOf(p.p) > -1;
                /* 非交互标记，不进 tab 序列：它是「事实陈述」，不是控件。 */
                return '<td class="ta-r"><span class="mono" role="img" aria-label="' +
                  h.esc(r.name + (has ? '持有' : '不持有') + p.label) + '" title="' +
                  h.esc(r.name + (has ? '持有' : '不持有') + '：' + p.label + '（' + p.p + '）') + '">' +
                  (has ? '<span class="ok">●</span>' : '<span class="muted">—</span>') + '</span></td>';
              }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div></details>';
      }).join('') +
      '<div class="bt-note">高亮行为你持有的权限点。' +
      '<b>本页不提供任何改权限的入口</b>：权限变更一律走「审批存档」，需提交变更前后差异、填理由，' +
      '且不得由本人审批自己提出的变更。高危权限每 90 天须重新确认，逾期自动降级为只读。<br>' +
      '访问复核由独立权限点 <span class="mono">rbac:review:decide</span> 把门 —— ' +
      '复核的对象是「授权实例」，配置的对象是「角色模板」，两者不是同一个动作，因此不共用权限点。' +
      '当前持有该权限的角色：' +
      h.esc(roles.filter(function (r) { return rbacEffPerms(S, r.id, state).indexOf('rbac:review:decide') > -1; })
        .map(function (r) { return r.name; }).join(' / ') || '（无）') +
      (myPerms.indexOf('rbac:review:decide') > -1 ? '；你有，可以在上方做复核。' : '；你当前没有，上方复核按钮会被门禁拦下。') +
      '</div></div>';

    /* 身份区：成员 / 角色 / 权限点矩阵并成一张卡片的三个视图 ──────────────
       v26：此前它们是三张全宽卡依次堆叠（成员 493 + 角色 382 + 矩阵 4802 = 5677px，
       占整页 76%），但它们是**同一件事（谁有什么权限）的三个视角** ——
       分屏看要来回滚，对照时还得靠脑子记。现在同一张卡片内切视图，切换进 URL。 */
    var identityTabs = '<div class="tabs gv-tabs" role="tablist">' + [
      { id: 'member', label: '成员', n: members.length },
      { id: 'roles', label: '角色与权限', n: roles.length },
      { id: 'matrix', label: '权限点矩阵', n: perms.length }
    ].map(function (t) {
      return '<button role="tab" class="tab' + (t.id === identityTab ? ' on' : '') + '" data-tab="' + t.id + '"' +
        ' aria-selected="' + (t.id === identityTab) + '">' + h.esc(t.label) +
        '<i class="tab-badge">' + t.n + '</i></button>';
    }).join('') + '</div>';
    var identityBody =
      identityTab === 'member' ? memberTable
        : (identityTab === 'roles'
          ? '<div class="card-sub" style="padding:10px var(--space-3) 0">' + roles.length +
            ' 个角色 · 权限随角色授予，不随人授予 · 点开看该角色的全部权限点</div><div>' + roleCards + '</div>' +
            '<div class="bt-note" style="margin:0 var(--space-3) var(--space-3)">' +
            '改角色是高危动作：需提交变更前后差异、走审批，且不得由本人审批自己提出的变更。</div>'
          : matrix);
    var identityCard = '<div class="card pad0"><div class="card-h pad"><h3>身份与权限</h3>' +
      '<span class="card-sub">谁在这个租户里、什么角色、能做什么 · 三个视角同一份口径</span></div>' +
      '<div style="padding:0 var(--space-3) var(--space-3)">' + identityTabs +
      '<div style="margin-top:12px">' + identityBody + '</div></div></div>';

    /* 口径条压成一行：说明性内容不该排在操作之前，也不该占一张卡。 */
    var stance = '<div class="card"><div class="bt-note" style="margin:0;border:0;background:none;padding:10px var(--space-4)">' +
      '<b>本页三件事</b>：看身份 · 做复核 · 不在这里改权限 —— 改角色/加权限走 ' +
      '<button class="lnk" data-act="rbac-review-tab" data-id="approval">审批存档</button>，' +
      '停用成员在本页发起但同样要过强制理由与审批链。' +
      '<br><span class="muted">口径：成员与角色是配置态（来自企业目录与平台配置）；' +
      '最近访问与到期倒计时是运行态事实，页脚分别标注。</span>' +
      '</div></div>';

    /* 页面分布（v26）──────────────────────────────────────────────────
       改前实测：整页 7451px，其中「权限点矩阵」一张卡就 4802px（64%），
       而真正要动手的「待我复核」挤在第 579px 处那 448px 里；首屏只能看到 KPI + 复核顶部。
       改后：复核与「该收紧什么」并排（宽侧 60% 给表格，窄侧 40% 给发现），
       身份三视图折进一张卡 → 页面主体从 ~5680px 收到 ~700px，矩阵按域折叠。 */
    return pageHead(h, cap, { action: 'rbac-member-add', actionText: '邀请成员',
      side: '<span class="side-note" data-tip="身份与角色是配置态维度（来自企业目录与平台配置），访问复核是运行态事实（最近访问、到期倒计时）。两者共用本页但不混口径，页脚分别标注。">身份 + 复核 · 双口径</span>' }) +
      '<div class="metrics">' + metrics.map(h.metricCard).join('') + '</div>' +
      stance +
      /* v36：身份区（按人头）提到复核区之前 —— 业主的方向是"按人头管理"，
         进这一页先看到人；复核是需要赶的事，排在后面仍然看得到。 */
      identityCard +
      '<div class="gv-duo">' +
        '<div>' + focus + '</div>' +
        '<div>' + reviewCard + '</div>' +
      '</div>' +
      h.metaBar({}, [
        { k: '数据来源', v: '成员来自企业目录（OWNERS 维度表），角色与权限点为平台配置（PERM_POINTS / ROLES），' + ME.name + ' 的权限由角色「' + ME.role + '」推导，不是手工维护' },
        { k: '权限口径', v: 'perms 由 rolePerms(roleId) 展开通配得出（如 approval:decide:* 命中该前缀全部）；' + ME.role + ' 当前持有 ' + myPerms.length + ' 个' },
        { k: '复核口径', v: '待复核 = 授权已超期，或落在 ' + WARN_DAYS + ' 天预警窗口内。决定分两步：先暂存（不产生效果、可撤回），提交后改变授权状态；提交即最终' },
        { k: '复核依据字段', v: '最近访问（lastAccessDays）与上次复核（lastReviewAt）按工号确定性生成，刷新与重放一致；「上次复核」为空表示该账号从未被任何一次复核覆盖' },
        { k: '门禁口径', v: '复核走独立权限点 rbac:review:decide（复用 rbac:role:write 会把「谁能复核」绑死在超管身上），' +
            '权限变更的唯一入口是审批链，本页不提供直改入口；checkPerm 在危险操作确认弹层入口校验，未授权直接拦截' },
        { k: '职责分离', v: '同一人不得既申请又审批同一单据，也不得复核自己的授权。' + (myConflict ? '⚠ 你当前同时持有申请权与审批权，靠数据层过滤兜底，建议移交申请权' : '你当前不冲突') },
        { k: '演示边界', v: '本页的判定与门禁都必须由服务端完成 —— 前端置灰只是体验，前端可写即门禁可绕过。此处改动仅本会话，刷新还原' }
      ]);
  };

  /* SECTION: rbac-actions
   * 账号与权限页的动作。停用成员与改角色都是高危，走 dangerConfirm → checkPerm 真门禁。 */
  /* 成员操作历史（v25c，事故后重写）——
     口径：操作类型**取自该成员的权限点** —— 没有某权限就不会出现那类操作，
     与权限矩阵、角色卡三处自洽。时间按工号确定性生成（刷新/重放一致）。 */
  function rbacMemberAudit(m, rid, ps, r, revoked, isMe, S, h) {
    var OP_OF = [
      { perm: 'approval:decide', label: '审批决策' },
      { perm: 'agent:publish', label: 'Agent 发布' },
      { perm: 'compliance:rule', label: '合规规则' },
      { perm: 'rbac:role:write', label: '权限变更' },
      { perm: 'kb:doc', label: '知识库文档' },
      { perm: 'gateway:model', label: '模型接入' },
      { perm: 'llm-exp:entry:edit', label: '经验库' },
      { perm: 'sandbox:operate', label: '沙盒操作' }
    ];
    var mine = OP_OF.filter(function (o) {
      return ps.some(function (p) { return p.indexOf(o.perm) === 0; });
    });
    if (revoked) {
      return '<div class="sub-h">操作历史</div><div class="bt-note">账号已停用，权限全部回收。</div>';
    }
    var AG = (S.AGENTS || []).slice(0, 6);
    var RULES = [{ name: '敏感表述-广告法 v12' }, { name: '数据出境-个人信息 v5' }, { name: '金融宣传-收益承诺 v3' }];
    var DOCS = [{ name: '售后政策手册 v4' }, { name: '产品参数规范' }, { name: 'FAQ 合集' }];
    var MODELS = [{ name: 'qwen-max' }, { name: 'deepseek-v3' }, { name: 'embed-v3' }];
    var APPR = (h.state && (h.state.approvalList || h.state.apprList)) || [];
    function pick(r2, arr, fb) { return arr.length ? arr[S.R.int(r2, 0, arr.length - 1)] : fb; }
    var rows = [];
    var n = Math.max(3, Math.min(9, 3 + mine.length));
    for (var i = 0; i < n; i++) {
      var r2 = S.R.of('maudit|' + m.id + '|' + i);
      var o = mine[i % mine.length];
      if (!o) break;
      var dayAgo = (i * 3) + S.R.int(r2, 0, 2);
      var min = dayAgo * 1440 + S.R.int(r2, 8, 20) * 60 + S.R.int(r2, 0, 59);
      var what;
      if (o.perm === 'approval:decide') {
        var a = pick(r2, APPR, { title: 'Agent 发布申请', decided: i % 3 ? 'approved' : 'rejected' });
        what = (a.decided === 'approved' ? '通过了审批' : '驳回了审批') + '「' + a.title + '」';
      } else if (o.perm === 'agent:publish') {
        var ag = pick(r2, AG, { name: '客服助手 Agent', version: 'v2.3' });
        what = '发布了版本「' + ag.name + ' ' + (ag.version || 'v1.0') + '」';
      } else if (o.perm === 'compliance:rule') {
        what = '修改了规则「' + pick(r2, RULES, { name: '规则包' }).name + '」';
      } else if (o.perm === 'rbac:role:write') {
        what = '调整了角色权限「' + pick(r2, (S.ROLES || []), { name: '运营' }).name + '」';
      } else if (o.perm === 'kb:doc') {
        what = '更新了文档「' + pick(r2, DOCS, { name: '文档' }).name + '」';
      } else if (o.perm === 'gateway:model') {
        what = '调整了模型配额「' + pick(r2, MODELS, { name: '模型' }).name + '」';
      } else if (o.perm === 'llm-exp:entry:edit') {
        what = '编辑了经验条目「' + pick(r2, [{ name: '退款时效说明' }, { name: '发票开具口径' }], { name: '经验条目' }).name + '」';
      } else {
        what = '执行了沙盒操作「' + pick(r2, [{ name: 'MCP 出网连通性' }, { name: '订单接口压测' }], { name: '沙盒任务' }).name + '」';
      }
      rows.push({ min: min, label: o.label, what: what, risk: (S.permMeta(o.perm + ':x') || {}).risk || 'low' });
    }
    /* 越权尝试：只给确有过高危权限的成员 —— 没有高危权限的人不会出现这条 */
    var highs = ps.filter(function (p) { return S.permMeta(p).risk === 'high'; });
    if (highs.length && !isMe) {
      var denied = pick(S.R.of('maudit|' + m.id + '|deny'), highs, highs[0]);
      rows.push({ min: 2 * 1440 + 552, label: '越权尝试',
        what: '尝试执行「' + S.permMeta(denied).label + '」被拦截（角色未授权）', risk: 'high', blocked: true });
    }
    rows.sort(function (a, b) { return a.min - b.min; });
    function agoText(min) {
      if (min < 60) return min + ' 分钟前';
      if (min < 1440) return (min / 60).toFixed(1).replace(/\.0$/, '') + ' 小时前';
      var d = min / 1440;
      return (d < 10 ? d.toFixed(1).replace(/\.0$/, '') : String(Math.round(d))) + ' 天前';
    }
    return '<div class="sub-h">操作历史' +
      '<span class="card-sub" style="font-weight:400;margin-left:6px">近 ' + rows.length + ' 条 · 按工号确定性生成</span></div>' +
      '<div class="tbl-wrap" style="max-height:230px;overflow:auto"><table class="bt"><thead><tr>' +
      '<th>时间</th><th>类型</th><th>做了什么</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr' + (x.blocked ? ' style="background:#fff7f7"' : '') + '>' +
          '<td class="muted" style="white-space:nowrap">' + agoText(x.min) + '</td>' +
          '<td><span class="pill ' + (x.blocked ? 'bad' : (x.risk === 'high' ? 'warn' : 'info')) + '">' + h.esc(x.label) + '</span></td>' +
          '<td>' + h.esc(x.what) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="bt-note">操作类型取自该成员的权限点 —— <b>没有某权限就不会出现那类操作</b>，' +
      '与上方权限矩阵、角色卡三处自洽。</div>';
  }
  /* ── v29 权限编辑器接线 ────────────────────────────────────────────────
     待提交的勾选状态**只存在 DOM 上**，不进 state —— 保存前不产生任何状态变更，
     "勾了又取消"不留痕迹，只有"保存"是提交点。这才叫"能编辑"的手感：
     保存前可以随便反悔。
     保存分级（方案 A）：
       本次改动全是低危 → 保存即生效
       含高危            → 强制理由 + 生成变更单，页面标「待审批」 */
  function bindPermEditor(root, mid, h) {
    var S = global.DATA_SEED;
    var box = root.querySelector('[data-perm-editor]');
    if (!box) return;
    var diffEl = box.querySelector('[data-perm-diff]');
    var saveBtn = box.querySelector('[data-perm-save]');
    var revertBtn = box.querySelector('[data-perm-revert]');
    var boxes = function () { return [].slice.call(box.querySelectorAll('input[data-perm]')); };
    /* 初始快照：用于算差异与"还原" */
    var initial = {};
    boxes().forEach(function (b) { initial[b.getAttribute('data-perm')] = b.checked; });
    function diff() {
      var add = [], rm = [], addHigh = 0, rmHigh = 0;
      boxes().forEach(function (b) {
        var k = b.getAttribute('data-perm'), hi = b.getAttribute('data-risk') === 'high';
        var was = initial[k], now = b.checked;
        if (now === was) return;
        if (now) { add.push(k); if (hi) addHigh++; } else { rm.push(k); if (hi) rmHigh++; }
      });
      return { add: add, rm: rm, addHigh: addHigh, rmHigh: rmHigh, n: add.length + rm.length };
    }
    function paint() {
      var d = diff();
      if (!d.n) {
        diffEl.innerHTML = '未做改动';
        diffEl.className = 'pe-diff';
        saveBtn.disabled = true; revertBtn.disabled = true;
        return;
      }
      var hi = d.addHigh + d.rmHigh;
      diffEl.className = 'pe-diff' + (hi ? ' is-high' : ' is-changed');
      diffEl.innerHTML = '待保存：' +
        (d.add.length ? '新增 <b>' + d.add.length + '</b> 个' + (d.addHigh ? '（<span class="bad">含高危 ' + d.addHigh + '</span>）' : '') : '') +
        (d.add.length && d.rm.length ? ' · ' : '') +
        (d.rm.length ? '收回 <b>' + d.rm.length + '</b> 个' + (d.rmHigh ? '（含高危 ' + d.rmHigh + '）' : '') : '') +
        (hi ? ' <span class="pe-warn">高危改动保存时需填理由并生成变更单</span>' : ' <span class="pe-ok">保存后立即生效</span>');
      saveBtn.disabled = false; revertBtn.disabled = false;
      saveBtn.textContent = hi ? '保存并提交变更单' : '保存变更';
    }
    box.addEventListener('change', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-perm')) paint();
    });
    revertBtn.addEventListener('click', function () {
      boxes().forEach(function (b) { b.checked = initial[b.getAttribute('data-perm')]; });
      paint();
    });
    saveBtn.addEventListener('click', function () {
      var d = diff();
      if (!d.n) return;
      var m = S.OWNERS.filter(function (o) { return o.id === mid; })[0] || { name: mid };
      var hi = d.addHigh + d.rmHigh;
      var apply = function (reason) {
        var map = {};
        boxes().forEach(function (b) { map[b.getAttribute('data-perm')] = b.checked; });
        if (S.setPermsOverride) S.setPermsOverride(mid, map);
        h.state.rbacPermChanges = h.state.rbacPermChanges || {};
        h.state.rbacPermChanges[mid] = {
          at: new Date().toISOString().slice(0, 16).replace('T', ' '), by: S.ME.name,
          add: d.add.length, rm: d.rm.length, addHigh: d.addHigh, rmHigh: d.rmHigh,
          reason: reason || null, mode: hi ? 'ticket' : 'direct'
        };
        h.toast(hi ? '已提交权限变更单（高危 ' + hi + ' 个，待审批）'
                   : '已保存：新增 ' + d.add.length + ' 个、收回 ' + d.rm.length + ' 个', 'ok');
        if (h.closeModals) h.closeModals();
        if (h.render) h.render();
      };
      if (!hi) { apply(null); return; }   /* 全低危 → 保存即生效 */
      global.V10UI.dangerConfirm(h, {
        title: '提交权限变更单',
        desc: '对「' + m.name + '」的权限改动含高危项，需要二次确认。',
        tone: 'danger', perm: 'rbac:role:write',
        confirmText: '提交变更单',
        impacts: [
          { label: '新增权限', value: d.add.length ? d.add.length + ' 个' + (d.addHigh ? '（含高危 ' + d.addHigh + '）' : '') : '无', tone: d.addHigh ? 'danger' : '' },
          { label: '收回权限', value: d.rm.length ? d.rm.length + ' 个' + (d.rmHigh ? '（含高危 ' + d.rmHigh + '）' : '') : '无', tone: d.rmHigh ? 'warn' : '' },
          { label: '生效条件', value: '审批通过后生效；每 90 天重新确认' },
          { label: '不得自审', value: mid === S.ME.id ? '本人不可发起' : '发起人不能同时是审批人' }
        ],
        onConfirm: function (reason) { apply(reason); }
      });
    });
    paint();
  }

  function rbacMember(id, h) {
    var state = h.state || {};
    var S = global.DATA_SEED, ME = S.ME;
    /* v28：人 → 角色改为读 seed（唯一数据源）。
   原来这里手写了一份 ROLE_OF 映射，全文件 6 处副本 —— 见 _check/apply-role-source.js。 */
var roleOfUser = function (uid) { var S2 = global.DATA_SEED; return S2.roleOfUser ? S2.roleOfUser(uid) : 'r-viewer'; };
    var m = S.OWNERS.filter(function (o) { return o.id === id; })[0];
    if (!m) { h.toast('成员不存在', 'bad'); return; }
    var rid = roleOfUser(m.id) || 'r-viewer';
    var r = S.ROLES.filter(function (x) { return x.id === rid; })[0] || { name: '—', desc: '' };
    var ps = rbacEffPerms(S, rid, state);
    var grp = {};
    ps.forEach(function (p) { var m2 = S.permMeta(p); grp[m2.grp] = (grp[m2.grp] || 0) + 1; });
    var high = ps.filter(function (p) { return S.permMeta(p).risk === 'high'; });
    var isMe = m.id === ME.id;
    var revoked = ((state.rbacOps || {})[m.id] === 'revoked');
    /* ── v28 身份层 ──────────────────────────────────────────────────────
       这一块回答三个原来答不出来的问题：
         ① 这个人从哪来、能不能改？ → identityOf.source + isSourceAuthoritative
         ② 这个账号怎么登进来？     → accessMethods / MFA / Passkey / AccessKey
         ③ 他这些权限是哪来的？     → permissionSources（角色 / 用户组 / 直接授予）
       另外加上我们的侧重：下一轮复核什么时候到期（云控制台不管这件事）。 */
    var idn = S.identityOf ? S.identityOf(m.id) : {};
    var auth = S.isSourceAuthoritative ? S.isSourceAuthoritative(m.id) : false;
    var accM = S.accessMethods ? S.accessMethods(m.id) : [];
    var grps = S.groupsOfUser ? S.groupsOfUser(m.id) : [];
    var keys = S.keysOf ? S.keysOf(m.id) : [];
    var tags = S.tagsOf ? S.tagsOf(m.id) : [];
    var srcs = S.permissionSources ? S.permissionSources(m.id, rid) : [];
    var revDays = S.nextReviewInDays ? S.nextReviewInDays(m.id) : null;
    var revState = S.reviewState ? S.reviewState(m.id) : null;
    var kindLabel = (S.ACCOUNT_KINDS || []).filter(function (k) { return k.id === (idn.kind || 'sub'); })[0] || {};
    var byVia = { role: [], group: [], direct: [] };
    /* ── v29 可编辑权限集合 ────────────────────────────────────────────────
       合并三个来源 + 叠加"本会话里已改过的"(S.permsOverrideOf)。
       每个权限点带：来源 / 是否高危 / 当前是否勾选 / 最近使用（复核时最该看的一项）。
       注意：**待提交的勾选状态存在 DOM 上，不存 state** —— 保存前不产生任何状态变更，
       这样"勾了又取消"不会留下痕迹，"保存"才是唯一的提交点。 */
    var permOverride = (S.permsOverrideOf ? S.permsOverrideOf(m.id) : null) || null;
    var allPerms = [];
    var groupCovered = {};
    var seenPerm = {};
    (function () {
      var push = function (p, via, refName) {
        if (seenPerm[p]) return; seenPerm[p] = 1;
        var meta = S.permMeta(p);
        var on = permOverride && permOverride[p] != null ? !!permOverride[p]
                 : ((via === 'direct') ? true : true);   /* 默认：现有权限都算已勾 */
        allPerms.push({ p: p, label: meta.label, risk: meta.risk, grp: meta.grp,
                        via: via, refName: refName, on: on,
                        lastUse: (S.lastAccessMin ? null : null) });
      };
      (S.rolePerms(rid) || []).forEach(function (p) { push(p, 'role', r.name); });
      grps.forEach(function (g) {
        ((S.GROUP_PERM_MAP || {})[g.id] || []).forEach(function (p) {
          var before = allPerms.length;
          push(p, 'group', g.name);
          /* 组权限若与角色重复会被去重 —— 记下来，渲染时要说明，否则「经用户组」整段消失，
             看上去像这个人不在任何组里，把真实的组织关系藏掉了。 */
          if (allPerms.length === before) groupCovered[g.name] = (groupCovered[g.name] || 0) + 1;
        });
      });
      ((S.DIRECT_GRANTS || {})[m.id] || []).forEach(function (p) { push(p, 'direct', '直接授予'); });
    })();
    var onCount = allPerms.filter(function (x) { return x.on; }).length;
    var editHtml = function () {
      var chk = function (x) {
        return '<label class="pe-item' + (x.risk === 'high' ? ' is-high' : '') + '">' +
          '<input type="checkbox" data-perm="' + h.esc(x.p) + '" data-risk="' + h.esc(x.risk) + '"' +
            (x.on ? ' checked' : '') + ' />' +
          '<span class="pe-label">' + h.esc(x.label) +
            (x.risk === 'high' ? '<span class="pe-high">高危</span>' : '') + '</span>' +
          '<span class="pe-via">' + h.esc(x.via === 'role' ? '经角色' : (x.via === 'group' ? '经用户组' : '直接授予')) + '</span>' +
          '</label>';
      };
      var pick = function (via) { return allPerms.filter(function (x) { return x.via === via; }); };
      var roleList = pick('role'), grpList = pick('group'), dirList = pick('direct');
      return '<div class="pe" data-perm-editor data-mid="' + h.esc(m.id) + '">' +
        /* 经角色：折叠成一行摘要 —— 这是"角色的定义"，不是"这个人的信息"，
           每个持有该角色的人都在自己的详情里重复一遍同样的几十个标签，纯噪音。
           要改角色定义，去「角色与权限」；要改这个人，改下面两段。 */
        '<details class="pe-sec"><summary>' +
          '<span class="pe-sec-h">经角色</span><span class="tag">' + roleList.length + '</span>' +
          '<span class="pe-sec-hint">由「' + h.esc(r.name) + '」决定 · 换岗时自动跟着变 · 展开可微调</span>' +
          '' +
        '</summary><div class="pe-list">' + roleList.map(chk).join('') + '</div></details>' +
        /* 用户组与直接授予：这个人独有的，全量列出 */
        /* ⚠ 原来这里用 grpList.length 作条件 —— 组权限被角色覆盖后 grpList 为空，整段就不渲染，
           看上去像"此人不在任何用户组里"，把真实的组织关系藏掉了。
           现在只要他确实在组里，这一段就出现，并说明覆盖情况。 */
        (grps.length ? '<div class="pe-sec is-open"><div class="pe-sec-hd">' +
          '<span class="pe-sec-h">经用户组</span><span class="tag">' + grpList.length + '</span>' +
          '<span class="pe-sec-hint">' + h.esc(grps.map(function (g) { return g.name; }).join('、')) +
            ' · 临时职责，职责结束应退组</span></div>' +
          (grpList.length ? '<div class="pe-list">' + grpList.map(chk).join('') + '</div>'
            : '<div class="bt-note">在组：' + h.esc(grps.map(function (g) { return g.name; }).join('、')) +
              '。该组的权限已由角色覆盖，<strong>未新增</strong>权限点 —— 但仍应在职责结束时退组，' +
              '否则将来角色调整会让组权限意外放大。</div>') + '</div>' : '') +
        (dirList.length ? '<div class="pe-sec is-open is-direct"><div class="pe-sec-hd">' +
          '<span class="pe-sec-h">直接授予</span><span class="tag bad">' + dirList.length + '</span>' +
          '<span class="pe-sec-hint">例外授权 · 必须单独复核，越少越好</span></div>' +
          '<div class="pe-list">' + dirList.map(chk).join('') + '</div></div>' : '') +
        /* 常驻保存条：不需要先找按钮才知道能改 */
        '<div class="pe-bar" data-perm-bar>' +
          '<span class="pe-diff" data-perm-diff>未做改动</span>' +
          '<span class="pe-bar-btns">' +
            '<button class="btn-ghost sm" data-perm-revert disabled>还原</button>' +
            '<button class="btn-primary sm" data-perm-save disabled>保存变更</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    };
    srcs.forEach(function (x) { if (byVia[x.via]) byVia[x.via].push(x); });
    var relDays = function (d) {
      if (d == null) return '—';
      if (d < 1) return '今天';
      if (d === 1) return '昨天';
      if (d < 30) return d + ' 天前';
      if (d < 365) return Math.round(d / 30) + ' 个月前';
      return (d / 365).toFixed(1) + ' 年前';
    };
    var tagHtml = function (list) {
      return list.length ? list.map(function (x) {
        return '<span class="tag">' + h.esc(x.label) + '：' + h.esc(String(x.value)) + '</span>';
      }).join('') : '<span class="muted">无标签</span>';
    };
    var srcBlock = function (title, arr, hint) {
      if (!arr.length) return '';
      return '<div class="p-src-h">' + h.esc(title) + ' <span class="tag">' + arr.length + '</span>' +
        (hint ? '<span class="p-src-hint">' + h.esc(hint) + '</span>' : '') + '</div>' +
        '<div class="p-src-list">' + arr.map(function (x) {
          var meta = S.permMeta(x.p);
          return '<span class="tag mono' + (meta.risk === 'high' ? ' bad' : '') + '" title="' + h.esc(x.refName || '') + '">' +
            h.esc(meta.label) + (meta.risk === 'high' ? ' · 高危' : '') + '</span>';
        }).join('') + '</div>';
    };
    /* 顶部一句话：让"该不该留这份权限"不用读完所有块才能判断 */
    var headLine = revoked
      ? '账号已停用，权限全部回收'
      : (idn.mfa === 'none'
          ? '未启用多因素认证 · 这是本账号最大的风险点'
          : (revState === 'overdue'
              ? '授权复核已超期 ' + Math.abs(revDays) + ' 天 · 期间相关操作会被拦下'
              : '登录方式与复核状态正常'));
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal wide" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(m.name) + (isMe ? '（我）' : '') + (revoked ? '（已停用）' : '') + '</h3>' +
      '<button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      /* 顶部摘要：身份一句话 + 复核状态 */
      '<div class="p-head">' +
        '<span class="av-face">' + h.avatar(m.name, { face: true }) + '</span>' +
        '<span class="p-head-main"><b>' + h.esc(idn.display || m.name) + '</b>' +
          '<span class="mono p-head-upn">' + h.esc(idn.upn || '—') + '</span></span>' +
        '<span class="p-head-state">' +
          (revoked ? '<span class="pill idle">已停用</span>'
            : (revState === 'overdue' ? '<span class="pill bad">复核超期</span>'
              : (revState === 'warn' ? '<span class="pill warn">复核预警</span>' : '<span class="pill ok">复核正常</span>'))) +
          (idn.mfa === 'none' && !revoked ? ' <span class="pill bad">无 MFA</span>' : '') +
        '</span>' +
      '</div>' +
      (revoked ? '' : '<div class="bt-note">' + h.esc(headLine) + '</div>') +
      /* 这一屏原来只有"看"，没有"改" —— 因为身份层不存在、改角色没有落点。
         现在身份层立起来了，给出唯一一个可写动作，且它走审批而不是直接改。 */
      (revoked ? '' :
        '<div class="p-actions">' +
        '<button class="btn-ghost sm" data-act="rbac-role-change" data-id="' + h.esc(m.id) + '"' +
          (isMe ? ' disabled title="不能调整自己的角色（职责分离）"' : '') + '>调整角色</button>' +
        (S.roleOverrideOf && S.roleOverrideOf(m.id)
          ? '<span class="tag warn">已提交变更单，待审批</span>' : '') +
        '<span class="td-sub">角色决定岗位权限；临时职责请用用户组</span>' +
        '</div>') +
      '<div class="p-cols">' +
      '<div class="p-col p-col-id">' +
            /* ① 基本信息 */
      '<div class="sub-h">基本信息</div>' +
      '<dl class="dl">' +
      '<dt>登录名称</dt><dd class="mono">' + h.esc(idn.upn || '—') + '</dd>' +
      '<dt>显示名称</dt><dd>' + h.esc(idn.display || m.name) + '</dd>' +
      '<dt>系统 ID</dt><dd class="mono">' + h.esc(idn.uid || '—') + '</dd>' +
      '<dt>账号类型</dt><dd>' + h.esc(kindLabel.name || '子用户') +
        (kindLabel.desc ? '<div class="td-sub">' + h.esc(kindLabel.desc) + '</div>' : '') + '</dd>' +
      '<dt>账号来源</dt><dd>' + h.esc((S.SOURCE_LABEL || {})[idn.source] || idn.source || '—') +
        (auth ? ' <span class="tag">上游权威 · 本页只读</span>' : ' <span class="tag ok">本页可改</span>') +
        (idn.idp ? '<div class="td-sub">' + h.esc(idn.idp) +
          (idn.syncedMinAgo != null ? ' · ' + idn.syncedMinAgo + ' 分钟前同步' : '') + '</div>' : '') + '</dd>' +
      '<dt>创建时间</dt><dd>' + (idn.createDaysAgo == null ? '—' : relDays(idn.createDaysAgo)) + '</dd>' +
      '<dt>标签</dt><dd>' + tagHtml(tags) + '</dd>' +
      '</dl>' +
      /* ② 认证与凭证 */
      '<div class="sub-h">认证与凭证</div>' +
      '<dl class="dl">' +
      '<dt>访问方式</dt><dd>' + (accM.length ? accM.map(function (x) {
          return '<span class="tag ok">' + h.esc(x) + '</span>';
        }).join(' ') : '<span class="bad">无（该账号类型不支持登录）</span>') + '</dd>' +
      '<dt>多因素认证</dt><dd>' + (idn.mfa === 'none'
          ? '<span class="bad">未启用</span> <span class="tag">建议 7 天内完成绑定</span>'
          : h.esc((S.MFA_LABEL || {})[idn.mfa] || idn.mfa)) +
        (idn.passkey ? ' <span class="tag ok">已绑定 Passkey</span>' : '') + '</dd>' +
      '<dt>最后登录</dt><dd>' + (revoked ? '会话已失效' : relDays(idn.lastLoginMin == null ? null : Math.round(idn.lastLoginMin / 1440))) +
        (idn.lastIp ? ' <span class="mono td-sub">' + h.esc(idn.lastIp) + '</span>' : '') + '</dd>' +
      '<dt>AccessKey</dt><dd>' + (keys.length
          ? keys.map(function (k) {
              return '<div>' + '<span class="mono">' + h.esc(k.id) + '</span> ' +
                (k.status === 'active' ? '<span class="tag ok">启用</span>' : '<span class="tag">已禁用</span>') +
                ' <span class="td-sub">创建于 ' + relDays(k.createdDaysAgo) + ' · 最近使用 ' +
                relDays(k.lastUsedMin == null ? null : Math.round(k.lastUsedMin / 1440)) + '</span>' +
                (k.stale ? ' <span class="pill bad">超过 ' + k.rotateWarnDays + ' 天未轮换</span>' : '') + '</div>';
            }).join('')
          : '<span class="muted">无长期密钥</span>' +
            (idn.api ? ' <span class="tag warn">已开编程访问但未建密钥</span>' : '')) + '</dd>' +
      '</dl>' +
      /* ③ 加入的用户组 */
      '<div class="sub-h">加入的用户组</div>' +
      (grps.length
        ? '<div>' + grps.map(function (g) {
            var perms = (S.GROUP_PERM_MAP || {})[g.id] || [];
            return '<div class="p-grp"><b>' + h.esc(g.name) + '</b>' +
              '<span class="td-sub">' + h.esc(g.desc) + '</span>' +
              (perms.length ? '<div class="p-src-list">' + perms.map(function (p) {
                return '<span class="tag mono">' + h.esc(S.permMeta(p).label) + '</span>';
              }).join('') + '</div>' : '') + '</div>';
          }).join('') + '</div>' +
          '<div class="bt-note">经用户组继承的权限属于<strong>临时职责</strong>（值班、专项），职责结束应当退出该组；' +
          '角色上的权限属于<strong>岗位</strong>，换岗时才变。</div>'
        : '<div class="bt-note">未加入任何用户组 —— 全部权限都来自角色，没有临时职责带来的额外权限。</div>') +
      '</div>' +                        /* 左栏结束 */
      '<div class="p-col-sep" aria-hidden="true"></div>' +
      '<div class="p-col p-col-perm">' +
            /* ④ 权限管理 —— v29：改成可编辑的勾选清单（方案 A 风险分级保存）
           取代原来那面只读标签墙。原来那版：67 个标签平铺 + 按域分布 + 高危再列一遍，
           三块内容互相重复，且**只有"看"没有任何"办"** —— 用户读完只能走人。
           现在：勾选框直接点，底部常驻变更预览与保存；低危保存即生效，高危强制理由+变更单。 */
        '<div class="sub-h">权限管理</div>' +
        '<div class="bt-note">共 ' + allPerms.length + ' 个权限点（当前勾选 ' + onCount +
          ' · 高危 ' + allPerms.filter(function (x) { return x.risk === 'high' && x.on; }).length +
          '）· 按<strong>来源</strong>分组。勾选后需点底部「保存变更」才生效。</div>' +
        (revoked ? '<div class="bt-note">账号已停用，权限全部回收，此处不可编辑。</div>' : editHtml()) +
        /* 高危单独成表：复核时真正要判断的就是这几个，"有高危但从未使用"最该被一眼看到 */
        (revoked ? '' : (function () {
          var hi = allPerms.filter(function (x) { return x.risk === 'high'; });
          if (!hi.length) return '';
          /* ⚠ 这里原来给 27 个高危权限**每个**都印一句「最近使用 N 天前」，
             而那个 N 是**该成员整体**的最近访问天数，不是每个权限各自的使用时间。
             逐权限的使用数据我们手里没有 —— 把整体数字复印到每一项上是编造，
             而且会让人误以为每个高危权限都在被使用（正好与复核要判断的相反）。
             现在只显示确实拿得到的：来源，以及授权是否已超出复核周期。 */
          var revOverdue = (revState === 'overdue');
          return '<div class="sub-h bad">高危权限 · ' + hi.length + ' 个（授予需二次审批，每 90 天重新确认）</div>' +
            '<div class="bt-note">说明：本原型<strong>没有逐权限的使用记录数据源</strong>，' +
              '因此这里不显示每个权限各自的最近使用时间，也不用近似值填空。' +
              '该成员整体：' + (revDays != null ? (revState === 'overdue' ? '<span class="bad">复核已超期 ' + Math.abs(revDays) + ' 天</span>' : revDays + ' 天后需复核') : '—') + '</div>' +
            '<div class="pe-high-table">' + hi.map(function (x) {
              return '<div class="pe-high-row">' +
                '<span class="pe-high-name">' + h.esc(x.label) + '</span>' +
                '<span class="pe-high-via">' + h.esc(x.via === 'role' ? '经角色' : (x.via === 'group' ? '经用户组' : '直接授予')) + '</span>' +
                /* 逐行不再重复"这个成员的复核状态"—— 27 行印同一句就是废话。
                   该成员整体的情况放到块首说明里说一次。 */
                '' +
              '</div>';
            }).join('') + '</div>';
        })()) +
      '<div class="bt-note">' + h.esc(r.desc) + (isMe ? '<br>这是你自己的账号 —— 不能停用自己。' : '') + '</div>' +
        rbacMemberAudit(m, rid, ps, r, revoked, isMe, S, h) +
      '</div>' +   /* 右栏结束 */
      '</div>' +   /* 双栏容器结束 */
      '</div></div></div>',
      { onOpen: function (root) { bindPermEditor(root, m.id, h); } });
  }
  ACTIONS['rbac-member'] = function (id, btn, h) { rbacMember(id, h); };

  /* 邀请成员（v26）——
     账号页的主按钮此前是空的，邀请入口整个丢失；v25c 补回了表单，但它**不过门禁**，
     是本页唯一能被任何角色直接打开的写入口。现在两件事分开：
     先过 dangerConfirm → checkPerm，通过了再填成员信息。 */
  ACTIONS['rbac-member-add'] = function (id, btn, h) {
    var S = global.DATA_SEED;
    h.dangerConfirm(h, {
      title: '邀请成员加入平台',
      desc: '邀请一个账号进入本租户：他的可见范围与可执行动作由所选角色决定，不单独授权。',
      perm: 'rbac:member:write',
      confirmText: '下一步：填写成员信息',
      danger: false,
      impacts: [
        { label: '角色决定什么', value: '可见范围（看谁的数据）与可执行动作（能做什么）都由角色决定' },
        { label: '本页口径', value: '只给角色、不给单独授权 —— 避免「某人特批」这种事后说不清的口子' },
        { label: '生效条件', value: '邀请后需管理员在角色上二次确认才生效', tone: 'warn' }
      ],
      onConfirm: function () { openInviteSheet(h); }
    });
  };

  /* 邀请成员的信息表单。先过门禁（见上），再填信息 —— 两件事分开：
     门禁失败时不该先让人填半天表。 */
  function openInviteSheet(h) {
    var S = global.DATA_SEED, ME = S.ME;
    var roles = S.ROLES || [];
    var permN = function (rid) { return rbacEffPerms(S, rid, h.state).length; };
    var highN = function (rid) {
      return rbacEffPerms(S, rid, h.state).filter(function (p) { return S.permMeta(p).risk === 'high'; }).length;
    };
    global.V10UI.openSheet({
      title: '邀请成员加入平台',
      bodyHtml:
        '<div class="sub-h">姓名</div>' +
        '<input class="inp" data-rb="name" placeholder="例如：李思远" />' +
        '<div class="sub-h" style="margin-top:12px">工号</div>' +
        '<input class="inp mono" data-rb="uid" placeholder="例如：u109" />' +
        '<div class="sub-h" style="margin-top:12px">部门</div>' +
        '<input class="inp" data-rb="dept" placeholder="例如：客服线" />' +
        '<div class="sub-h" style="margin-top:12px">角色（决定他能看什么、能做什么）</div>' +
        '<select class="inp" data-rb="role">' + roles.map(function (r) {
          var hn = highN(r.id);
          return '<option value="' + h.esc(r.id) + '">' + h.esc(r.name) + ' · ' + permN(r.id) + ' 个权限点'
            + (hn ? '（高危 ' + hn + '）' : '') + '</option>';
        }).join('') + '</select>' +
        '<div class="sub-h" style="margin-top:12px">说明（必填）</div>' +
        '<input class="inp" data-rb="reason" placeholder="例如：新入职客服组长，接手售后工单审批" />' +
        '<div class="bt-note" style="margin-top:10px">' +
        '<b>只给角色、不给单独授权</b> —— 授权一律走角色，避免出现"某人特批"这种事后说不清的口子。' +
        '高危权限（发放与回收记录、导出脱敏、模型调用配额、MCP 开通）在角色里已标出，' +
        '邀请后仍需管理员在角色上二次确认才会生效。</div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn" data-v10="ok">发出邀请</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') { global.V10UI.closeSheet(); return; }
          if (g !== 'ok') return;
          var q = function (k) { var e = root.querySelector('[data-rb="' + k + '"]'); return e ? String(e.value || '').trim() : ''; };
          var name = q('name'), uid = q('uid'), reason = q('reason');
          if (name.length < 2) { h.toast('姓名必填', 'warn'); return; }
          if (!/^u\d{3,4}$/.test(uid)) { h.toast('工号格式应为 u + 3~4 位数字（与现有 u101~u108 一致）', 'warn'); return; }
          if (S.OWNERS.some(function (o) { return o.id === uid; })) { h.toast('工号 ' + uid + ' 已存在', 'warn'); return; }
          if (reason.length < 4) { h.toast('说明必填（至少 4 个字）—— 邀请要能回答"为什么给这个人这个角色"', 'warn'); return; }
          var st = h.state;
          st.rbacInvites = st.rbacInvites || [];
          st.rbacInvites.push({ id: uid, name: name, dept: q('dept') || '—', roleId: q('role'), reason: reason, by: ME.name, at: S.NOW_TS });
          global.V10UI.closeSheet();
          h.toast('已邀请 ' + name + '（' + uid + '）· 待管理员在角色上二次确认后生效', 'ok');
          h.navigate({}, { scroll: false });
        });
      }
    });
  }

  ACTIONS['rbac-role'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var r = S.ROLES.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('角色不存在', 'bad'); return; }
    var ps = rbacEffPerms(S, r.id, h.state);
    var byGrp = {};
    ps.forEach(function (p) { var m = S.permMeta(p); (byGrp[m.grp] = byGrp[m.grp] || []).push(m); });
    var missing = S.PERM_POINTS.filter(function (p) { return ps.indexOf(p.p) < 0; });
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal wide" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>角色 · ' + h.esc(r.name) + '</h3>' +
      '<button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>角色说明</dt><dd>' + h.esc(r.desc) + '</dd>' +
      '<dt>成员数</dt><dd>' + r.users + ' 人</dd>' +
      '<dt>持有权限</dt><dd>' + ps.length + ' / ' + S.PERM_POINTS.length + ' 个' +
        '（覆盖 ' + (ps.length / S.PERM_POINTS.length * 100).toFixed(0) + '%）</dd>' +
      '<dt>是否我的角色</dt><dd>' + (r.id === ME.roleId ? '<span class="ok">是</span>' : '否') + '</dd>' +
      '</dl>' +
      Object.keys(byGrp).map(function (g) {
        return '<div class="sub-h">' + h.esc(g) + '（' + byGrp[g].length + '）</div>' +
          '<div>' + byGrp[g].map(function (m) {
            return '<span class="tag ' + (m.risk === 'high' ? 'bad' : '') + '">' + h.esc(m.label) + '</span>';
          }).join('') + '</div>';
      }).join('') +
      (missing.length
        ? '<div class="sub-h">该角色不含（' + missing.length + ' 个）</div>' +
          '<div class="muted" style="font-size:12px;line-height:var(--lh-body)">' +
          missing.map(function (m) { return h.esc(m.label) + '<span class="mono muted"> ' + h.esc(m.p) + '</span>'; }).join('　·　') + '</div>'
        : '<div class="bt-note">该角色已覆盖全部权限点。</div>') +
      '<div class="bt-note">改角色需二次确认：需提交变更前后差异，且不得由本人审批自己提出的变更。</div>' +
      '</div></div></div>');
  };

  /* v28：调整角色 —— 上一轮"没有入口"的那个死结，正式解法。
   要点：这不是"改一下"就完事，而是**发起一张权限变更单**：
     ① 过门禁（rbac:role:write，只有平台管理员有）
     ② 强制理由
     ③ 必须看清差异：多出来的权限（尤其高危）、失去的权限
     ④ 不得自审：不能给自己改角色
     ⑤ 写进 rbacOps：弹窗里"调整角色"变成"已提交变更单"
   直接改存档听起来更省事，但那样就绕过了审批链 —— 权限体系里
   "谁改的、凭什么改"必须能回答，"省事"不是理由。 */
ACTIONS['rbac-role-change'] = function (id, btn, h) {
  var S = global.DATA_SEED, ME = S.ME;
  var m = S.OWNERS.filter(function (o) { return o.id === id; })[0];
  if (!m) { h.toast('成员不存在', 'bad'); return; }
  /* 职责分离：不能给自己改角色 —— 这是权限体系里最先要守的一条 */
  if (m.id === ME.id) { h.toast('不能调整自己的角色（职责分离）', 'bad'); return; }
  var curRid = S.roleOfUser ? S.roleOfUser(m.id) : 'r-viewer';
  var idn = S.identityOf ? S.identityOf(m.id) : {};
  var curPs = rbacEffPerms(S, curRid, h.state);
  var curName = (S.ROLES.filter(function (r) { return r.id === curRid; })[0] || {}).name || '—';
  var highOf = function (arr) { return arr.filter(function (p) { return S.permMeta(p).risk === 'high'; }); };
  /* 每个候选角色的差异预先算好，挂在 option 上；切换时由 onOpen 里的小逻辑换文案 */
  var diffs = {};
  (S.ROLES || []).forEach(function (r) {
    var toPs = rbacEffPerms(S, r.id, h.state);
    var added = toPs.filter(function (p) { return curPs.indexOf(p) < 0; });
    var removed = curPs.filter(function (p) { return toPs.indexOf(p) < 0; });
    diffs[r.id] = {
      n: toPs.length, added: added.length, removed: removed.length,
      addHigh: highOf(added).length, rmHigh: highOf(removed).length,
      addNames: highOf(added).map(function (p) { return S.permMeta(p).label; }).slice(0, 4),
      same: r.id === curRid
    };
  });
  if (!global.V10UI || !global.V10UI.openSheet) { h.toast('弹层不可用', 'bad'); return; }
  global.V10UI.openSheet({
    title: '调整成员角色 · ' + m.name,
    bodyHtml:
      '<div class="bt-note">角色决定<strong>岗位权限</strong>。临时职责（值班、专项）请改用用户组，' +
        '不要为了一个临时需求把角色调高 —— 那会让这份权限永久留在岗位上。</div>' +
      '<div class="sub-h">当前角色</div>' +
      '<div><span class="tag">' + h.esc(curName) + '</span> <span class="td-sub">' + curPs.length + ' 个权限点 · 高危 ' + highOf(curPs).length + ' 个</span></div>' +
      '<div class="sub-h" style="margin-top:12px">调整为（默认停在当前角色，即不变更）</div>' +
      '<select class="inp" data-rb-role>' +
        (S.ROLES || []).map(function (r) {
          return '<option value="' + h.esc(r.id) + '"' + (r.id === curRid ? ' selected' : '') + '>' +
            h.esc(r.name) + ' · ' + diffs[r.id].n + ' 个权限点</option>';
        }).join('') +
      '</select>' +
      '<div class="p-diff" data-rb-diff></div>' +
      '<div class="sub-h" style="margin-top:12px">理由（必填）</div>' +
      '<textarea class="inp" data-rb-reason rows="3" placeholder="例如：岗位已调整为数据合规，按最小权限原则随之变更"></textarea>' +
      '<div class="bt-note" data-rb-err style="display:none;color:var(--red)"></div>' +
      '<div class="bt-note">人事字段（姓名 / 部门 / 工号）来自' +
        (S.isSourceAuthoritative && S.isSourceAuthoritative(m.id) ? '<strong>上游权威系统</strong>，本页只读；' : '<strong>本页</strong>，可改；') +
        '角色由本租户授予，可在此调整。评审要求：发起人不得同时是审批人；' +
        '高危权限变更需二次审批，且每 90 天重新确认。</div>',
    footHtml:
      '<button class="btn-ghost" data-v10="cancel">取消</button>' +
      '<button class="btn-primary" data-rb-role-submit data-id="' + h.esc(m.id) + '">提交变更单</button>',
    onOpen: function (sheet) {
      var sel = sheet.querySelector('[data-rb-role]');
      var diffBox = sheet.querySelector('[data-rb-diff]');
      var errBox = sheet.querySelector('[data-rb-err]');
      function paint() {
        var d2 = diffs[sel.value] || {};
        errBox.style.display = 'none';
        if (d2.same) {
          diffBox.innerHTML = '<div class="bt-note">与当前角色相同 —— 不会产生任何权限变化。' +
            '若只是想调整临时职责，请改用用户组。</div>';
          return;
        }
        var tone = d2.addHigh ? 'bad' : (d2.added || d2.removed ? 'warn' : '');
        diffBox.innerHTML =
          '<div class="p-diff-in ' + (tone === 'bad' ? 'is-danger' : (tone === 'warn' ? 'is-warn' : '')) + '">' +
          '<div><b>新增权限</b> ' + (d2.added ? d2.added + ' 个' +
            (d2.addHigh ? '（<span class="bad">含高危 ' + d2.addHigh + '</span>）' : '') : '无') +
            (d2.addNames && d2.addNames.length ? '<div class="td-sub">例如：' + h.esc(d2.addNames.join('、')) + '</div>' : '') +
          '</div>' +
          '<div><b>失去权限</b> ' + (d2.removed ? d2.removed + ' 个' +
            (d2.rmHigh ? '（含高危 ' + d2.rmHigh + '）' : '') : '无') + '</div>' +
          '<div class="td-sub">变更后共 ' + d2.n + ' 个权限点</div>' +
          '</div>';
      }
      paint();
      sel.addEventListener('change', paint);
      /* 提交：过门禁 → 生效 */
      sheet.querySelector('[data-rb-role-submit]').addEventListener('click', function () {
        var toRid = sel.value;
        var reason = (sheet.querySelector('[data-rb-reason]').value || '').trim();
        if (toRid === curRid) {
          errBox.textContent = '目标角色与当前角色相同，无需提交变更单。';
          errBox.style.display = 'block'; return;
        }
        /* 2026-10-21：理由改选填（单账号模式，直接执行并留记录） */
        var d3 = diffs[toRid] || {};
        var toName = (S.ROLES.filter(function (r) { return r.id === toRid; })[0] || {}).name || toRid;
        /* 门禁走统一的 dangerConfirm（它一处收口了 20+ 个写操作的门禁） */
        global.V10UI.dangerConfirm(h, {
          title: '提交角色变更单',
          desc: '把「' + m.name + '」从「' + curName + '」调整为「' + toName + '」？',
          tone: d3.addHigh ? 'danger' : 'warn',
          perm: 'rbac:role:write',
          confirmText: '确认提交',
          impacts: [
            { label: '角色变更', value: curName + ' → ' + toName, tone: 'warn' },
            { label: '新增权限', value: d3.added ? d3.added + ' 个' + (d3.addHigh ? '（含高危 ' + d3.addHigh + '）' : '') : '无', tone: d3.addHigh ? 'danger' : '' },
            { label: '失去权限', value: d3.removed ? d3.removed + ' 个' + (d3.rmHigh ? '（含高危 ' + d3.rmHigh + '）' : '') : '无', tone: d3.rmHigh ? 'warn' : '' },
            { label: '变更理由', value: reason.slice(0, 60) },
            { label: '不得自审', value: '发起人不能同时是审批人' }
          ],
          onConfirm: function () {
            h.state.rbacRoleChanges = h.state.rbacRoleChanges || {};
            h.state.rbacRoleChanges[m.id] = {
              from: curRid, fromName: curName, to: toRid, toName: toName,
              at: new Date().toISOString().slice(0, 16).replace('T', ' '),
              by: ME.name, reason: reason,
              added: d3.added, removed: d3.removed, high: d3.addHigh
            };
            if (S.setRoleOfUser) S.setRoleOfUser(m.id, toRid);
            if (global.V10UI.closeSheet) global.V10UI.closeSheet();
            h.toast('已提交角色变更单：' + curName + ' → ' + toName + '（待审批）', 'ok');
            if (h.render) h.render();
          }
        });
      });
    }
  });
};

ACTIONS['rbac-revoke'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var m = S.OWNERS.filter(function (o) { return o.id === id; })[0];
    if (!m) { h.toast('成员不存在', 'bad'); return; }
    if (m.id === ME.id) { h.toast('不能停用自己的账号', 'bad'); return; }
    /* v28：人 → 角色改为读 seed（唯一数据源）。
   原来这里手写了一份 ROLE_OF 映射，全文件 6 处副本 —— 见 _check/apply-role-source.js。 */
var roleOfUser = function (uid) { var S2 = global.DATA_SEED; return S2.roleOfUser ? S2.roleOfUser(uid) : 'r-viewer'; };
    var rid = roleOfUser(m.id) || 'r-viewer';
    var r = S.ROLES.filter(function (x) { return x.id === rid; })[0] || { name: '—' };
    var ps = rbacEffPerms(S, rid, h.state);
    var owned = [];
    S.AGENTS.forEach(function (a) { if (a.owner === m.id) owned.push(a.name); });
    h.dangerConfirm(h, {
      title: '停用成员账号', desc: '停用「' + m.name + '」？',
      tone: 'danger', perm: 'rbac:member:write', confirmText: '确认停用',
      impacts: [
        { label: '成员', value: m.name + '（' + m.dept + '）' },
        { label: '角色', value: r.name + ' · ' + ps.length + ' 个权限点', tone: 'danger' },
        { label: '名下 Agent', value: owned.length ? owned.length + ' 个：' + owned.join('、') : '无', tone: owned.length ? 'warn' : '' },
        { label: '会话', value: '立即失效，未提交的草稿会丢失' },
        { label: '可恢复', value: '是 —— 重新启用后原角色与权限原样恢复' }
      ],
      onConfirm: function (reason) {
        h.state.rbacOps = h.state.rbacOps || {};
        h.state.rbacOps[m.id] = 'revoked';
        h.toast('演示环境：已停用「' + m.name + '」（权限已回收，仅本会话，刷新还原）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* v22：恢复入口。确认弹层承诺「重新启用后原角色与权限原样恢复」，那就得真能恢复 ——
     没有恢复入口的「可恢复」承诺是空头支票。 */
  ACTIONS['rbac-restore'] = function (id, btn, h) {
    var S = global.DATA_SEED;
    var m = S.OWNERS.filter(function (o) { return o.id === id; })[0];
    if (!m) { h.toast('成员不存在', 'bad'); return; }
    h.state.rbacOps = h.state.rbacOps || {};
    delete h.state.rbacOps[id];
    h.toast('已恢复「' + m.name + '」：' + m.dept + ' · 角色与权限原样恢复（仅本会话）', 'ok');
    h.navigate({}, { scroll: false });
  };

  /* v26：单条「重新确认」并入访问复核流程，旧的独立动作保留为兼容入口 ——
     它直接改 grantAt 并立即生效，与「决定两步走」冲突，所以只做重定向。 */
  ACTIONS['grant-reconfirm'] = function (id, btn, h) {
    h.toast('「重新确认」已并入访问复核：请在「待我复核」里逐条做决定，再统一提交', 'warn');
    h.navigate({ tab: 'todo' });
  };

  /* SECTION: r-queue-page */
  RENDERERS.queuePage = function (cap, state, h) {
    var fmt = h.fmt;
    var q = queues()[cap.queue];
    if (!q) return '<div class="fatal"><h2>未配置的队列</h2><p>' + h.esc(cap.queue) + '</p></div>';

    if (cap.queue === 'approval') return approvalPage(cap, state, h, q);
    if (cap.queue === 'compliance') return compliancePage(cap, state, h, q);

    // 经验库
    /* v15：经验条目的「通过 / 驳回 / 弃用」此前全是空动作 —— 弃用不生效等于噪声永远清不掉。
       会话内状态 state.expOps[id]：deprecated → 移出列表与检索池；verified / rejected → 改状态列。
       KPI、建议弃用卡片、表格三处都读同一份 items，天然一起回收。 */
    /* v16：把这一屏从「经验目录」改成「经验库」——
       正文四段、归属（单 Agent 私有 / 多 Agent 共享）、已弃用视图与恢复、
       收益证据（支持 / 反例 / 补充）、反馈（第二条淘汰依据）。
       会话内状态 state.expOps[id] ∈ verified | rejected | deprecated：
       deprecated 不再"人间蒸发"，进「已弃用」视图可恢复（此前确认框承诺可恢复、页面上却没入口）。 */
    var _expOv = (state && state.expOps) || {};
    var _ef = (state && state.filters) || {};
    var allItems = q.items.map(function (i) {
      var st = _expOv[i.id];
      if (st === 'verified') return Object.assign({}, i, { status: 'ok', statusText: '已复核通过' });
      if (st === 'rejected') return Object.assign({}, i, { status: 'bad', statusText: '已驳回' });
      if (st === 'deprecated') return Object.assign({}, i, { status: 'deprecated', statusText: '已弃用' });
      return i;
    });
    var live = allItems.filter(function (i) { return i.status !== 'deprecated'; });
    var dead = allItems.filter(function (i) { return i.status === 'deprecated'; });

    /* 筛选是「视图状态」，跟着 state.filters 走（app.js 的 select[data-f] 委托写入） */
    var fState = _ef.expState || '', fScope = _ef.expScope || '', fSrc = _ef.expSource || '';
    var viewItems = (fState === 'deprecated' ? dead : live).filter(function (i) {
      if (fState && fState !== 'deprecated' && i.status !== fState) return false;
      if (fScope && i.scope !== fScope) return false;
      if (fSrc && i.source !== fSrc) return false;
      return true;
    });

    var pending = live.filter(function (i) { return i.status === 'warn'; });
    var abandon = live.filter(function (i) { return i.gain != null && i.gain < 2; });
    function expJudgement(r) {
      /* 待复核 + 收益分 < 2 的两处结论必须一致：此前卡片说"建议弃用"、表格说"待复核"，
         同一条经验在两个地方给两个答案，用户不知道该做哪个动作。
         已弃用 / 已驳回的条目不再给"建议继续用"这类结论 —— 状态已经定了，再叠一个建议是自相矛盾。 */
      if (r.status === 'deprecated') return { kind: 'idle', text: '已弃用（可恢复）' };
      if (r.status === 'bad') return { kind: 'bad', text: '已驳回（不进检索池）' };
      if (r.status === 'warn') {
        return (r.gain != null && r.gain < 2) ? { kind: 'bad', text: '待复核 · 建议弃用' } : { kind: 'warn', text: '待复核' };
      }
      if (r.gain != null && r.gain < 2) return { kind: 'bad', text: '建议弃用' };
      if (r.gain != null && r.gain >= 5) return { kind: 'ok', text: '建议继续用' };
      return { kind: 'ok', text: '可继续用' };
    }
    function expScopeCell(r) {
      if (r.scope === 'shared') {
        return h.pill('info', '共享') + '<div class="td-sub">' + ((r.agents || []).length) + ' 个 Agent 可用</div>';
      }
      var a = S.AGENTS.filter(function (x) { return x.id === r.ownerAgent; })[0] || {};
      return h.pill('idle', '私有') + '<div class="td-sub">' + h.esc(a.name || r.ownerAgent || '未指定归属') + '</div>';
    }
    /* 僵尸信号：超过 30 天没被检索过 —— 经验库不做淘汰就会退化成噪声库 */
    function expLastUsedCell(r) {
      if (r.lastUsedDay == null) return '<span class="muted">—</span>';
      return r.lastUsedDay <= -30
        ? '<span class="bad">' + fmt.rel(r.lastUsedDay) + ' · 久未使用</span>'
        : fmt.rel(r.lastUsedDay);
    }
    /* KPI 只算「在池内」的条目；命中率按检索次数加权（6 条等权平均会把只检索 18 次的条目抬到和 214 次同等） */
    var _srch = live.reduce(function (s, i) { return s + i.searches; }, 0);
    var _wHit = _srch ? live.reduce(function (s, i) { return s + i.searches * i.hitRate; }, 0) / _srch : 0;
    var _privN = live.filter(function (i) { return i.scope !== 'shared'; }).length;
    /* 排序接线：此前列声明了 sortable 却没把 sortBy 传进表格器 → 表头能点、点了没反应 */
    var _SORTABLE = { searches: 1, hitRate: 1, gain: 1, lastUsedDay: 1 };
    var _sk = (state && _SORTABLE[state.sortKey]) ? state.sortKey : null;
    var _sd = (state && state.sortDir) || 'desc';
    var _rows = viewItems.slice();
    if (!_sk) {
      _rows.sort(function (a, b) {
        var pa = a.status === 'warn' ? 0 : 1, pb = b.status === 'warn' ? 0 : 1;
        return pa - pb || b.gain - a.gain;
      });
    }
    var _opts = function (pairs, cur) {
      return pairs.map(function (o) {
        return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('');
    };
    var _filterBar = '<div class="filters">' +
      '<select data-f="expState" aria-label="按状态筛选">' + _opts([['', '全部状态'], ['warn', '待复核'], ['info', '灰度验证中'], ['ok', '已验证'], ['bad', '已驳回'], ['deprecated', '已弃用' + (dead.length ? '（' + dead.length + '）' : '')]], fState) + '</select>' +
      '<select data-f="expScope" aria-label="按归属筛选">' + _opts([['', '全部归属'], ['private', '单 Agent 私有'], ['shared', '多 Agent 共享']], fScope) + '</select>' +
      '<select data-f="expSource" aria-label="按来源筛选">' + _opts([['', '全部来源'], ['人工录入', '人工录入'], ['badcase 提炼', 'badcase 提炼'], ['自进化产出', '自进化产出']], fSrc) + '</select>' +
      '</div>';
    // 经验条目是配置态数据，检索次数/命中率为累计值而非区间值，
    // 时间范围切换不影响任何数字，故不提供该控件。
    /* 经验条目的视图：默认**网格**（卡片管理，与知识库/画像库同一套外壳），列表用于按列排序核对。
       这一屏**不加分类条** —— 经验没有"分类"这个维度，状态/归属/来源三个下拉就是它的筛选。 */
    var eview = (state && state.expView) === 'list' ? 'list' : 'grid';
    /* 卡片图标按**状态**给色 —— 这一屏要回答的是"这条经验该不该留"，状态是最该一眼看见的信号 */
    function expFace(r) {
      if (r.status === 'deprecated') return ['slate', 'trash'];
      if (r.status === 'bad') return ['rose', 'x'];
      if (r.status === 'warn') return ['amber', 'alert'];
      if (r.status === 'info') return ['cyan', 'activity'];
      return ['green', 'check'];
    }
    function expScopeText(r) {
      if (r.scope === 'shared') return '共享 · ' + ((r.agents || []).length) + ' 个 Agent 可用';
      var a = S.AGENTS.filter(function (x) { return x.id === r.ownerAgent; })[0] || {};
      return '私有 · ' + (a.name || r.ownerAgent || '未指定归属');
    }
    var _head = '<div class="card pad0"><div class="card-h pad"><h3>' + h.esc(q.title) + '</h3>' +
      '<span class="card-sub">' + (_sk
        ? '按「' + ({ searches: '被检索', hitRate: '命中率', gain: '收益分', lastUsedDay: '最近使用' }[_sk]) + '」' + (_sd === 'asc' ? '升序' : '降序')
        : '待复核优先 · 收益分倒序') +
      (fState === 'deprecated' ? ' · 只看已弃用' : (dead.length ? ' · 已弃用 ' + dead.length + ' 条，见「状态」筛选' : '')) + '</span>' +
      '<div class="view-sw kb-layout" role="group" aria-label="查看方式">' +
      '<button class="vs-btn' + (eview === 'grid' ? ' on' : '') + '" data-act="exp-view" data-id="grid"' +
      ' aria-pressed="' + (eview === 'grid') + '" title="网格：像卡片一样管">网格</button>' +
      '<button class="vs-btn' + (eview === 'list' ? ' on' : '') + '" data-act="exp-view" data-id="list"' +
      ' aria-pressed="' + (eview === 'list') + '" title="列表：按列排序、密集核对">列表</button>' +
      '</div>' +
      _filterBar + '</div>';

    var _grid = '<div class="kb-items kb-items-exp">' + _rows.map(function (r) {
      var fc = expFace(r), j = expJudgement(r);
      var cf = (r.conflicts || []).length;
      return '<div class="kb-item kb-exp" role="button" tabindex="0" data-act="exp-detail" data-id="' + h.esc(r.id) + '"' +
        ' aria-label="' + h.esc(r.title) + '，' + h.esc(r.statusText || '') + '">' +
        '<span class="kb-ico h-' + fc[0] + '">' + h.icon(fc[1], 30) + '</span>' +
        '<span class="kb-nm">' + h.esc(r.title) + (cf ? ' <span class="bad">⚠</span>' : '') + '</span>' +
        '<span class="kb-mt">' + h.esc(r.scene) + '</span>' +
        /* 卡面不再印「被检索 / 命中率 / 收益分」——这三个累计值在顶部 KPI 和列表视图里都有，
           卡面重复一遍只会挤掉"该不该留"的判断。收益分 < 2 的条目仍由「建议淘汰」区点名。 */
        '<span class="kb-mt">' + h.esc(expScopeText(r)) + ' · ' + h.esc(r.source) + '</span>' +
        '<span class="pill ' + (r.status || 'idle') + '">' + h.esc(r.statusText || '—') + '</span>' +
        '</div>';
    }).join('') + '</div>';

    var _list = h.table({
        columns: [
          { key: 'title', label: '经验', render: function (r) {
            var cf = (r.conflicts || []).length;
            return '<b>' + h.esc(r.title) + '</b>' + (cf ? ' <button class="lnk warn" data-act="exp-detail" data-id="' + h.esc(r.id) + '">⚠ 冲突</button>' : '') +
              '<div class="td-sub">' + h.esc(r.scene) + '</div>';
          } },
          { key: 'source', label: '来源' },
          { key: 'scope', label: '归属', render: expScopeCell },
          { key: 'searches', label: '被检索', align: 'right', sortable: true, fmt: 'int' },
          { key: 'hitRate', label: '命中率', align: 'right', sortable: true, fmt: 'pct0' },
          { key: 'gain', label: '收益分', align: 'right', sortable: true, fmt: 'num1', render: function (r) { return '<b class="' + (r.gain >= 5 ? 'ok' : (r.gain < 2 ? 'bad' : '')) + '">' + fmt.num1(r.gain) + '</b>'; } },
          { key: 'lastUsedDay', label: '最近使用', align: 'right', sortable: true, render: expLastUsedCell },
          { key: 'status', label: '状态 / 结论', render: function (r) {
            var j = expJudgement(r), st = r.statusText || '';
            /* 结论与状态同一句话时不重复印第二遍（原来「待复核」+「待复核 · 复核人未分配」写了两遍） */
            var dup = j.text.indexOf(st) === 0 && st;
            return h.pill(r.status, st) + '<div class="td-sub">' + (dup ? j.text : (st ? st + ' · ' + j.text : j.text)) +
              (r.reviewer ? ' · 复核人 ' + h.esc(r.reviewer) : ' · 复核人未分配') + '</div>';
          } },
          { key: 'act', label: '操作', render: function (r) {
            var out = [];
            if (r.status === 'warn') out.push('<button class="lnk" data-act="go-detail" data-id="llm-exp|' + h.esc(r.id) + '|review">去复核</button>');
            out.push('<button class="lnk" data-act="exp-detail" data-id="' + h.esc(r.id) + '">详情</button>');
            if (r.status === 'deprecated') out.push('<button class="lnk ok" data-act="exp-restore" data-id="' + h.esc(r.id) + '">恢复</button>');
            else out.push('<button class="lnk warn" data-act="exp-decide" data-id="' + h.esc(r.id) + '|deprecate">弃用</button>');
            return out.join('<span style="display:inline-block;width:14px;text-align:center;opacity:.4">·</span>');
          } }
        ],
        rows: _rows,
        sortBy: _sk, sortDir: _sd,
        noPaging: true,
        emptyTitle: '这个筛选下没有经验',
        emptySub: '换个筛选条件，或点右上角「登记经验」录入第一条'
      });

    return pageHead(h, cap, {
      side: '<span class="side-note" data-tip="本页为经验条目（配置态）与累计效果数据，不按时间区间切片，因此不提供时间范围选择。">仅累计值</span>',
      action: 'create-open'
    }) + global.UI.sessionNewBlock(state, h, 'llm-exp', { title: '本会话登记的经验' }) +
      '<div class="metrics">' + [
        { label: '在池经验', value: String(live.length), sub: '私有 ' + _privN + ' / 共享 ' + (live.length - _privN) + (dead.length ? ' · 已弃用 ' + dead.length + ' 条' : '') },
        { label: '待复核', value: String(pending.length), alert: pending.length > 0, sub: '复核通过后才进检索池' },
        { label: '累计检索次数', value: fmt.int(_srch), definition: '被 Agent 检索复用的累计次数。本页是配置态数据，不做时间切片，所以这里是累计值而不是周值', sub: '检索次数长期不涨 = 僵尸经验' },
        { label: '命中率', value: fmt.pct1(_wHit), definition: '按检索次数加权：Σ(检索次数 × 该条命中率) ÷ Σ检索次数。等权平均会被低频条目带偏', sub: '检索到该经验后，回答被采纳的比例' },
        { label: '平均收益分', value: fmt.num1(live.length ? live.reduce(function (s, i) { return s + i.gain; }, 0) / live.length : 0), sub: '各条等权平均 · 来自 A/B 对照的转化提升折算' }
      ].map(h.metricCard).join('') + '</div>' +
      (abandon.length ? '<div class="card"><div class="card-h"><h3>建议淘汰</h3>' +
        '<span class="card-sub">收益分 &lt; 2，或反向反馈多于采纳 —— 留着会干扰检索复用</span></div>' +
        '<div class="ab-list">' + abandon.map(function (i) {
          var fb = i.feedback || {};
          var why = '收益分 ' + fmt.num1(i.gain) + (fb.wrong ? ' · 被判定用错 ' + fb.wrong + ' 次' : '');
          return '<button class="ab-item" data-act="exp-decide" data-id="' + h.esc(i.id) + '|deprecate">' +
            '<b>' + h.esc(i.title) + '</b><span>' + h.esc(i.scene) + '</span>' +
            '<span class="ab-why">' + why + '</span>' +
            '<span class="ab-go">弃用 →</span></button>';
        }).join('') + '</div></div>' : '') +
      _head + (eview === 'list' ? _list : _grid) + '</div>' +
      h.metaBar({}, [
        { k: '数据性质', v: '经验条目为配置态数据；检索次数、命中率、最近使用来自运行态聚合，均为累计值（本页不做时间切片）' },
        { k: '生命周期', v: '草稿 → 待复核 → 灰度验证 → 已验证 → 已弃用。弃用后移出检索池，可在「状态」筛选里切到「已弃用」恢复' },
        { k: '归属', v: '单 Agent 私有：只服务它自己，由该 Agent 的 owner 复核；多 Agent 共享：跨 Agent 复用，需在其它 Agent 上重新验证（经验不因存在即适用）' },
        { k: '引用 Agent 表现', v: '详情弹窗内引用 Agent 的调用量/成功率/P99 为 QUERY 近 7 天聚合；收益分趋势为配置态字段，末位 = 当前收益分可对账' }
      ]);
  };

  ACTIONS['exp-detail'] = function (id, btn, h) {
    var q = queues().experience;
    var r = q && q.items.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('经验条目不存在', 'bad'); return; }
    var fmt = h.fmt;
    /* 与列表「状态 / 结论」同口径（列表里那个叫 expJudgement） */
    var j = r.status === 'warn'
      ? ((r.gain != null && r.gain < 2) ? { kind: 'bad', text: '待复核 · 建议弃用' } : { kind: 'warn', text: '待复核' })
      : (r.gain != null && r.gain < 2 ? { kind: 'bad', text: '建议弃用' } : (r.gain != null && r.gain >= 5 ? { kind: 'ok', text: '建议继续用' } : { kind: 'ok', text: '可继续用' }));
    var trend = r.gainTrend || [];
    modalDetail('llm-exp', id);
    var agentsById = {};
    S.AGENTS.forEach(function (a) { agentsById[a.id] = a; });
    var agRows = (r.agents || []).map(function (aid) {
      var a = agentsById[aid]; if (!a) return null;
      var k = Q.kpi('7d', { agentId: aid });
      return { id: aid, name: a.name, calls: k.calls, sr: k.successRate, p99: k.p99 };
    }).filter(function (x) { return x; });
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(r.title) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>适用场景</dt><dd>' + h.esc(r.scene) + '</dd>' +
      '<dt>归属</dt><dd>' + (r.scope === 'shared'
        ? h.pill('info', '共享') + ' · ' + ((r.agents || []).length) + ' 个 Agent 可用'
        : h.pill('idle', '私有') + ' · ' + h.esc((agentsById[r.ownerAgent] || {}).name || r.ownerAgent || '未指定')) + '</dd>' +
      '<dt>来源</dt><dd>' + h.esc(r.source) + '</dd>' +
      '<dt>被检索 / 命中率</dt><dd>' + fmt.int(r.searches) + ' 次 · 命中率 ' + fmt.pct1(r.hitRate) + '</dd>' +
      '<dt>最近使用</dt><dd>' + (r.lastUsedDay == null ? '—' : fmt.rel(r.lastUsedDay) + (r.lastUsedDay <= -30 ? '　<span class="bad">久未使用，考虑淘汰</span>' : '')) + '</dd>' +
      '<dt>状态 / 复核人</dt><dd>' + h.pill(r.status, r.statusText) + ' · ' + (r.reviewer ? h.esc(r.reviewer) : '<span class="muted">未分配</span>') + '</dd>' +
      '<dt>结论</dt><dd><span class="pill ' + j.kind + '">' + j.text + '</span></dd>' +
      '</dl>' +
      /* 经验正文：这才是这个库存在的理由，弹窗里至少给出前两段 */
      '<div class="sub-h">触发条件</div><div class="bt-note">' + h.esc(r.trigger || '—') + '</div>' +
      '<div class="sub-h">处置策略</div><div class="bt-note">' + h.esc(r.policy || '—') + '</div>' +
      '<div class="sub-h">证据（支持 / 反例 / 补充）</div><div>' +
      '<span class="pill ok">支持 ' + ((r.evidence || {}).support || 0) + '</span> ' +
      '<span class="pill bad">反例 ' + ((r.evidence || {}).contradict || 0) + '</span> ' +
      '<span class="pill info">补充 ' + ((r.evidence || {}).supplement || 0) + '</span>' +
      (((r.feedback || {}).down || (r.feedback || {}).wrong) ? ' <span class="muted">· 反向反馈 ' + (((r.feedback || {}).down || 0) + ((r.feedback || {}).wrong || 0)) + ' 条（第二条淘汰依据）</span>' : '') +
      '</div>' +
      (trend.length ? '<div class="sub-h">收益分趋势（近 8 周，末位 = 当前 ' + fmt.num1(r.gain) + '）</div><div>' + C.sparkline(trend, { width: 300, height: 48, color: '#2563eb' }) + '</div>' : '') +
      '<div class="sub-h">绑定它的 Agent（近 7 天运行表现）</div>' +
      (agRows.length ? '<div class="tbl-wrap"><table class="bt"><thead><tr><th>Agent</th><th class="ta-r">调用量</th><th class="ta-r">成功率</th><th class="ta-r">P99</th></tr></thead><tbody>' +
        agRows.map(function (x) {
          return '<tr><td><button class="lnk" data-act="goto-agent" data-id="' + h.esc(x.id) + '"><b>' + h.esc(x.name) + '</b></button></td>' +
            '<td class="ta-r">' + fmt.int(x.calls) + '</td>' +
            '<td class="ta-r">' + fmt.pct1(x.sr) + '</td>' +
            '<td class="ta-r">' + fmt.dur(x.p99) + '</td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="bt-note">暂无 Agent 引用记录。</div>') +
      '<div class="bt-note">收益分趋势与引用 Agent 列表为配置态字段；Agent 调用量/成功率/P99 来自 QUERY 近 7 天聚合，可到可观测页交叉验证。</div>' +
      '</div></div></div>');
  };

  function authRulesBlock(q, h, fmt, state) {
    var _arOv = (state && state.arOps) || {};
    var rules = (q.authRules || []).map(function (r) {
      var s = _arOv[r.id];
      return s ? Object.assign({}, r, { status: s, statusText: s === 'off' ? '已停用（本会话）' : '已启用（本会话）' }) : r;
    });
    if (!rules.length) return '';
    var on = rules.filter(function (x) { return x.status === 'on'; }).length;
    var _highOn = rules.filter(function (x) { return x.status === 'on' && x.risk === '高'; });
    var focusHtml = '<div class="card"><div class="card-h"><h3>该收紧什么</h3>' +
      (_highOn.length ? '<button class="btn-ghost sm" data-act="ar-toggle" data-id="' + h.esc(_highOn[0].id) + '|off" title="就在下方本页签的规则表里处置这些高风险授权">去处置 →</button>' : '') +
      '</div>' +
      '<div class="bt-note">' + (_highOn.length ? '⚠ ' + _highOn.length + ' 条高风险授权正在启用：' + _highOn.map(function (x) { return h.esc(x.subject + '→' + x.agentCap); }).join('、') + '。建议限缩数据范围或降低授权等级。' : '无启用中的高风险授权；仍应定期复核停用规则。') + '</div></div>';
    return focusHtml + '<div class="card pad0"><div class="card-h pad"><h3>授权规则</h3>' +
      '<span class="card-sub">谁能让 Agent 在什么条件下做什么 · ' + rules.length + ' 条（启用 ' + on + ' / 停用 ' + (rules.length - on) + '）</span>' +
      '<button class="btn-ghost sm" data-act="create-open" data-create="approval-rule">新建规则</button></div>' +
      h.table({
        columns: [
          { key: 'subject', label: '主体' },
          { key: 'agentCap', label: 'Agent 能力' },
          { key: 'action', label: '动作' },
          { key: 'scope', label: '数据范围', render: function (r) { return '<span class="mono">' + h.esc(r.scope) + '</span>'; } },
          { key: 'cond', label: '条件' },
          { key: 'risk', label: '风险', render: function (r) { return '<span class="pill ' + (r.risk === '高' ? 'bad' : (r.risk === '中' ? 'warn' : 'ok')) + '">' + h.esc(r.risk) + '</span>'; } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status === 'on' ? 'ok' : 'idle', r.statusText); } },
          { key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="auth-rule-detail" data-id="' + h.esc(r.id) + '">详情</button>' + (r.status === 'on' ? ' · <button class="lnk warn" data-act="ar-toggle" data-id="' + h.esc(r.id) + '|off">停用</button>' : ' · <button class="lnk ok" data-act="ar-toggle" data-id="' + h.esc(r.id) + '|on">启用</button>'); } }
        ],
        rows: rules, noPaging: true
      }) + '</div>';
  }

  function secEventsBlock(q, h, fmt) {
    var evs = q.secEvents || [];
    if (!evs.length) return '';
    var pending = evs.filter(function (x) { return x.result === '待处置'; });
    var p0 = pending.filter(function (x) { return x.level === 'P0'; });
    var warnBar = p0.length ? '<div class="alert-banner bad"><b>⚠ ' + p0.length + ' 个 P0 越权事件待处置</b>' +
      '<span>' + p0.map(function (x) { return h.esc(x.action) + '（' + h.esc(x.actor) + '）'; }).join('；') + '</span></div>' : '';
    var rows = evs.slice().sort(function (a, b) { return a.dayOffset - b.dayOffset; }).map(function (x) {
      return {
        id: x.id, day: x.dayOffset, kind: x.kindText, level: x.level, actor: x.actor,
        action: x.action, target: x.target, result: x.result, impact: x.impact
      };
    });
    var _orders = pending.slice().sort(function (a, b) { var o = { P0: 0, P1: 1, P2: 2 }; return (o[a.level] === undefined ? 9 : o[a.level]) - (o[b.level] === undefined ? 9 : o[b.level]); }).slice(0, 4);
    var focusHtml = '<div class="card"><div class="card-h"><h3>先处置什么</h3><span class="card-sub">' + pending.length + ' 条待处置 · 按级别排序</span></div><div class="ab-list">' +
      _orders.map(function (x) { return '<button class="ab-item" data-act="sec-act" data-id="' + h.esc(x.id) + '"><span class="ab-why">' + h.esc(x.level) + ' · ' + h.esc(x.kindText) + '</span><b>' + h.esc(x.actor) + '：' + h.esc(x.action) + '</b><span class="ab-go">处置</span></button>'; }).join('') + '</div></div>';
    return focusHtml + '<div class="card pad0"><div class="card-h pad"><h3>安全事件</h3>' +
      '<span class="card-sub">近 14 天 ' + evs.length + ' 条 · 待处置 ' + pending.length + ' · 已阻断 ' + evs.filter(function (x) { return x.result === '已阻断'; }).length + '</span></div>' +
      warnBar +
      h.table({
        columns: [
          { key: 'day', label: '时间', render: function (r) { return fmt.rel(r.day); } },
          { key: 'kind', label: '类型', render: function (r) { return '<span class="pill ' + (r.kind === '越权尝试' ? 'bad' : (r.kind === '异常审批' ? 'warn' : 'info')) + '">' + h.esc(r.kind) + '</span>'; } },
          { key: 'level', label: '级别', render: function (r) { return '<span class="pill ' + (r.level === 'P0' ? 'bad' : (r.level === 'P1' ? 'warn' : 'info')) + '">' + h.esc(r.level) + '</span>'; } },
          { key: 'actor', label: '主体' },
          { key: 'action', label: '动作' },
          { key: 'impact', label: '影响', align: 'right', render: function (r) { return r.impact + ' 项'; } },
          { key: 'result', label: '结果', render: function (r) { return h.pill(r.result === '待处置' ? 'warn' : (r.result === '已阻断' ? 'info' : 'ok'), r.result); } },
          { key: 'act', label: '处置', render: function (r) { return '<button class="lnk" data-act="sec-act" data-id="' + h.esc(r.id) + '">' + (r.result === '待处置' ? '处理' : '查看') + '</button>'; } }
        ],
        rows: rows, noPaging: true
      }) + '</div>';
  }

      /* ── 审批流配置可编辑（v25c，事故后重写）──────────────────────────
     此前这张表是**写死的 5 行字面量**：改不了、加不了、删不了 —— 而"审批流配置"本身
     就该是这一屏的「改」。
     口径：审批链路的变更要能回答「当时配的是什么」，**硬删会丢掉这个答案**。
     所以会话内状态是 state.aprFlow = { base, edit:{op:{...}}, added:[...], del:{op:{reason,by,at}} }，
     删除做**软删**（留原因 + 可恢复），不是从数组里抹掉。 */
  /* 2026-10-28：审批链改「单人」—— 原先是「技术负责人 → 业务负责人」这类多人链路，
     但这套系统只服务一个账号，那些角色根本不存在，链路永远走不通（点下去没人可审）。
     现在每条链路都是「你一个人能走完」的路：提交 → 冷静期或二次确认 → 留痕生效。
     敏感度靠两道东西区分，而不是靠加人：① 冷静期长短 ② 是否要写理由/附依据。 */
  var APR_FLOW_BASE = [
    { op: 'Agent 发布', chain: '本人提交 → 冷静期 24h 后生效', cond: '影响用户 > 10万 时二次确认并附影响评估', sla: 'P1 4h' },
    { op: '数据导出', chain: '本人二次确认', cond: '含 PII 时必须附脱敏说明', sla: 'P0 3h' },
    { op: 'MCP 对外开放', chain: '本人二次确认 + 冷静期 24h', cond: '涉及订单/客户数据必须说明访问范围', sla: 'P0 3h' },
    { op: '合规规则发布', chain: '本人确认（附合规依据）', cond: '误报率 > 2% 时自动打回重灰度', sla: 'P1 4h' },
    { op: '沙盒网络放开', chain: '本人确认', cond: '全开网络需附风险评估', sla: 'P2 8h' }
  ];
  function aprFlowState(state) {
    var st = state || {};
    st.aprFlow = st.aprFlow || {};
    st.aprFlow.edit = st.aprFlow.edit || {};
    st.aprFlow.added = st.aprFlow.added || [];
    st.aprFlow.del = st.aprFlow.del || {};
    return st.aprFlow;
  }
  /** 配置行 = 基线 + 会话内新增，叠加编辑覆盖；软删掉的仍在数组里（带 del 标记） */
  function aprFlowRows(state) {
    var f = aprFlowState(state);
    var rows = APR_FLOW_BASE.concat(f.added).map(function (r) {
      var e = f.edit[r.op] || {};
      return { op: r.op, chain: e.chain !== undefined ? e.chain : r.chain,
               cond: e.cond !== undefined ? e.cond : r.cond,
               sla: e.sla !== undefined ? e.sla : r.sla,
               isNew: f.added.indexOf(r) >= 0, del: f.del[r.op] || null };
    });
    return rows;
  }
  global.APR_FLOW_BASE = APR_FLOW_BASE;
  global.aprFlowRows = aprFlowRows;

  /* 审批流配置的三个动作：改链路 / 停用（软删）/ 恢复 / 新增。
     停用走 dangerConfirm；改/恢复/新增各写一条自己的变更日志（f.log）。 */
  ACTIONS['apr-flow-edit'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var op = String(id == null ? '' : id);
    var row = aprFlowRows(h.state).filter(function (r) { return r.op === op; })[0];
    if (!row) { h.toast('找不到该操作类型', 'bad'); return; }
    /* 可选链路全部是「一个人能走完」的形态：不加人，只调冷静期与确认强度 */
    var chainOpts = [
      '本人提交 → 冷静期 24h 后生效', '本人二次确认', '本人二次确认 + 冷静期 24h',
      '本人确认（附合规依据）', '本人确认', '本人提交 → 12h 冷静期 → 生效',
      '本人二次确认 + 冷静期 72h'
    ];
    global.V10UI.openSheet({
      title: '改「' + op + '」的审批链路',
      bodyHtml:
        '<dl class="dl">' +
        '<dt>操作类型</dt><dd>' + h.esc(op) + '</dd>' +
        '<dt>当前链路</dt><dd>' + h.esc(row.chain) + '</dd>' +
        '</dl>' +
        '<div class="sub-h" style="margin-top:12px">新的审批链路</div>' +
        '<select class="inp" data-apr="chain">' + chainOpts.map(function (c) {
          return '<option value="' + h.esc(c) + '"' + (c === row.chain ? ' selected' : '') + '>' + h.esc(c) + '</option>';
        }).join('') + '</select>' +
        '<div class="sub-h" style="margin-top:12px">条件路由</div>' +
        '<input class="inp" data-apr="cond" value="' + h.esc(row.cond) + '" />' +
        '<div class="sub-h" style="margin-top:12px">SLA</div>' +
        '<select class="inp" data-apr="sla">' + ['P0 3h', 'P1 4h', 'P2 8h', 'P3 24h'].map(function (s) {
          return '<option value="' + s + '"' + (s === row.sla ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select>' +
        '<div class="sub-h" style="margin-top:12px">变更原因（必填）</div>' +
        '<input class="inp" data-apr="reason" placeholder="例如：影响面扩大，需要加一道二次确认" />' +
        '<div class="bt-note" style="margin-top:10px">改动**影响此后所有该类单据的路由**；' +
        '已进入链路的在途单据按原链路走完，不追溯重排 —— 否则「谁批的」会说不清。</div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn" data-v10="ok">保存</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') { global.V10UI.closeSheet(); return; }
          if (g !== 'ok') return;
          var q = function (k) { var e = root.querySelector('[data-apr="' + k + '"]'); return e ? e.value : ''; };
          var reason = String(q('reason') || '').trim();
          if (reason.length < 4) { h.toast('变更原因必填（至少 4 个字）—— 链路改动要能回答"当时为什么改"', 'warn'); return; }
          var f = aprFlowState(h.state);
          f.edit[op] = { chain: q('chain'), cond: q('cond'), sla: q('sla') };
          f.log = f.log || [];
          f.log.push({ action: 'edit', op: op, before: row.chain + ' / ' + row.cond + ' / ' + row.sla,
            after: q('chain') + ' / ' + q('cond') + ' / ' + q('sla'), reason: reason, by: ME.name, at: S.NOW_TS });
          global.V10UI.closeSheet();
          h.toast('已更新「' + op + '」的审批链路', 'ok');
          h.navigate({}, { scroll: false });
        });
      }
    });
  };

  ACTIONS['apr-flow-del'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var op = String(id == null ? '' : id);
    var row = aprFlowRows(h.state).filter(function (r) { return r.op === op; })[0];
    if (!row) { h.toast('找不到该操作类型', 'bad'); return; }
    /* ⚠ 这一处曾经同时有 5 个错，导致「停用审批流」整条链路是断的（2026-10-12 修）：
       ① 写成 `h.dangerConfirm({...})` 单参 —— 签名是 `(h, opts)`，opts 收不到 ⇒ 弹层只剩标题
       ② 键名 `items` —— dangerConfirm 读 `impacts`（`v10-ui.js:496`），影响面 4 行渲染成空白
       ③ 键名 `warn`  —— dangerConfirm 不读它，那段"为什么不是删除"的解释整段丢失
       ④ 键名 `onOk`  —— dangerConfirm 只调 `onConfirm`（`v10-ui.js:551`）⇒ **确认后什么都不发生**
          （实测：state.aprFlow.del 仍为 {} —— 审批流没停用）
       ⑤ `perm:'approval:flow:write'` 未在 seed.js 登记 ⇒ 门禁必拦、风险等级回落"低"
       实测修前弹层可见文本只有：`确认操作？ 取消 确认` */
    h.dangerConfirm(h, {
      title: '停用「' + op + '」的审批流',
      /* 原来那段"为什么不是删除"写在 `warn:` 键里（dangerConfirm 不读它，整段丢失）。
         现在并入 desc —— **只用实现真正会渲染的键**，不再自造键名。 */
      desc: '停用后该类操作不再走审批（或回落默认链路）—— 这是放行能力的变更，不是界面开关。' +
        '为什么不是「删除」：审批链路的变更要能回答「当时配的是什么」，硬删会把这个答案丢掉。' +
        '所以只停用，配置留在表里，可随时恢复。',
      perm: 'approval:flow:write',
      impacts: [
        { label: '操作类型', value: op },
        { label: '现有链路', value: row.chain },
        { label: '条件路由', value: row.cond },
        { label: '影响面', value: '此后所有该类单据的路由；在途单据按原链路走完' }
      ],
      onConfirm: function (reason) {
        var f = aprFlowState(h.state);
        f.del[op] = { reason: reason, by: ME.name, at: S.NOW_TS };
        f.log = f.log || [];
        f.log.push({ action: 'disable', op: op, reason: reason, by: ME.name, at: S.NOW_TS });
        h.toast('已停用「' + op + '」的审批流（配置仍在，可恢复）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  ACTIONS['apr-flow-restore'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var op = String(id == null ? '' : id);
    var f = aprFlowState(h.state);
    if (!f.del[op]) { h.toast('该条并未停用', 'warn'); return; }
    var why = f.del[op].reason;
    delete f.del[op];
    f.log = f.log || [];
    f.log.push({ action: 'restore', op: op, reason: '恢复（原停用原因：' + why + '）', by: ME.name, at: S.NOW_TS });
    h.toast('已恢复「' + op + '」的审批流', 'ok');
    h.navigate({}, { scroll: false });
  };

  ACTIONS['apr-flow-add'] = function (id, btn, h) {
    var S = global.DATA_SEED, ME = S.ME;
    var opts = ['Agent 发布', '数据导出', 'MCP 对外开放', '合规规则发布', '沙盒网络放开',
      '知识库停用', '模型接入', 'Prompt 全量', '账号角色变更'];
    var used = aprFlowRows(h.state).map(function (r) { return r.op; });
    var avail = opts.filter(function (o) { return used.indexOf(o) < 0; });
    if (!avail.length) { h.toast('可选操作类型都已配置', 'warn'); return; }
    global.V10UI.openSheet({
      title: '新增审批流配置',
      bodyHtml:
        '<div class="sub-h">操作类型</div>' +
        '<select class="inp" data-apr="op">' + avail.map(function (o) {
          return '<option value="' + h.esc(o) + '">' + h.esc(o) + '</option>';
        }).join('') + '</select>' +
        '<div class="sub-h" style="margin-top:12px">审批链路</div>' +
        '<input class="inp" data-apr="chain" placeholder="例如：本人提交 → 冷静期 24h 后生效" />' +
        '<div class="sub-h" style="margin-top:12px">条件路由</div>' +
        '<input class="inp" data-apr="cond" placeholder="例如：影响用户 > 10万 时二次确认并附影响评估" />' +
        '<div class="sub-h" style="margin-top:12px">SLA</div>' +
        '<select class="inp" data-apr="sla"><option>P0 3h</option><option selected>P1 4h</option><option>P2 8h</option><option>P3 24h</option></select>' +
        '<div class="sub-h" style="margin-top:12px">新增原因（必填）</div>' +
        '<input class="inp" data-apr="reason" placeholder="例如：该类操作此前无审批，属越权风险" />',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn" data-v10="ok">新增</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') { global.V10UI.closeSheet(); return; }
          if (g !== 'ok') return;
          var q = function (k) { var e = root.querySelector('[data-apr="' + k + '"]'); return e ? e.value : ''; };
          var chain = String(q('chain') || '').trim(), reason = String(q('reason') || '').trim();
          if (chain.length < 3) { h.toast('审批链路必填', 'warn'); return; }
          if (reason.length < 4) { h.toast('新增原因必填（至少 4 个字）', 'warn'); return; }
          var f = aprFlowState(h.state);
          var row = { op: q('op'), chain: chain, cond: String(q('cond') || '').trim() || '无条件路由', sla: q('sla') };
          f.added.push(row);
          f.log = f.log || [];
          f.log.push({ action: 'add', op: row.op, after: chain, reason: reason, by: ME.name, at: S.NOW_TS });
          global.V10UI.closeSheet();
          h.toast('已新增「' + row.op + '」的审批流', 'ok');
          h.navigate({}, { scroll: false });
        });
      }
    });
  };

  function approvalPage(cap, state, h, q) {
    var fmt = h.fmt;
    /* v15：本会话发起的审批并入同一个数组 —— 「我发起的」KPI 与该表读同一份数据，天然一致。 */
    var _aprOv = (state && state.aprOps) || {};
    var all = q.items.map(function (i) {
      var o = _aprOv[i.id];
      if (!o) return i;
      /* 2026-10-28：删掉「已转交上级」「待二级终审」两个状态 —— 单人系统里没有上级可转、
         也没有第二个人能做二级。留着这两个状态，单据会永远卡在 stage2 出不去。 */
      return Object.assign({}, i, {
        decided: o.s, decidedBy: '我', decidedDays: 0, handledMin: i.waitMin,
        reason: o.reason || '—'
      });
    }).concat(((state && state.newObjs && state.newObjs['approval']) || []).map(function (o) {
      return {
        id: o.id, level: 'P2', levelKind: 'info', title: o.name,
        type: o.type || '自建单据', targetId: o.targetId || null,
        applicant: '我', impact: '影响 ' + (o.affect || '-') + ' 个对象 · 可回滚：' + (o.rollback || '-'),
        waitMin: 0, slaMin: 480, decided: null, mine: true, approver: null, reason: null, isNew: true
      };
    }));
    var mine = all.filter(function (i) { return i.mine; });
    var pending = all.filter(function (i) { return !i.decided && !i.mine && !i.escalated; });
    var decided = all.filter(function (i) { return i.decided; });
    var overSla = pending.filter(function (i) { return i.waitMin > i.slaMin; });
    var approvedN = decided.filter(function (i) { return i.decided === 'approved'; }).length;
    var rejectedN = decided.length - approvedN;
    var handledList = decided.filter(function (i) { return i.handledMin != null; }).map(function (i) { return i.handledMin; });
    var avgHandled = handledList.length ? handledList.reduce(function (s, x) { return s + x; }, 0) / handledList.length : null;

    /* ============ 审批屏重排（2026-10-12 · 本轮工单 ①）============
       旧排法：**16 张卡 · 6 张结构互不相同的表**（6/6/6/7/8/5 列）· **73 个按钮** 全挤一屏。
       六件事（待我审批 / 已处理 / 我发起的 / 授权规则 / 安全事件 / 审批流配置）彼此同权，
       用户看不出"现在要我干什么"，而 73 个按钮等于把"该点哪个"交给用户自己扫。
       新排法（重排，不是减功能 —— 下面 if/else 每条分支都是**原封不动**的既有区块）：
         ① 按任务分 6 个页签（角标带数量），默认落「待我审批」；页签机制复用原型既有实现
            （`.tabs > button[data-tab]` → app.js:1231 的委托写 state.tab → 进 URL hash，
             与可观测页的 obsTabs / 账号页的 reviewTabs 同一套，不新造）
         ② 超 SLA 的审批单独置顶一条（ov-focus 焦点条），不再只压在一张 KPI 卡的副标题里
         ③ 全屏共用的 5 张 KPI 卡拆成「页签内指标带」（ov-strip，与总览屏健康带同一套类名）
         ④ 表内操作**保留原有动作与 data-id 语义**：待我审批的 通过/驳回 逐行仍在
            （apr-decide，73→约 24 个按钮，降的是同屏密度而不是能力）
       风险提示（诚实边界）：五个页签**同屏不可见**是这次重排的代价 ——
       原来的"一屏扫全部"变成"一次看一件事"。判断依据是同屏互斥，而不是信息丢失：
       每类数据仍在同一页、同一张表、同一批动作里。 */
    var AP_TABS = [
      { id: 'apr-pending', label: '待我审批', n: pending.length },
      { id: 'apr-mine', label: '我发起的', n: mine.length },
      { id: 'apr-decided', label: '已处理', n: decided.length },
      { id: 'apr-rules', label: '授权规则', n: (q.authRules || []).filter(function (x) { return x.risk === '高'; }).length },
      { id: 'apr-sec', label: '安全事件', n: (q.secEvents || []).filter(function (x) { return x.result === '待处置'; }).length },
      { id: 'apr-flow', label: '审批流配置' }
    ];
    /* 页签是全局 state.tab：从别的屏带过来的旧值会落空 —— 白名单收口，落空即回「待我审批」 */
    var aTab = 'apr-pending';
    for (var _at = 0; _at < AP_TABS.length; _at++) if (AP_TABS[_at].id === state.tab) aTab = state.tab;
    var apTabsHtml = '<div class="tabs" role="tablist">' + AP_TABS.map(function (t) {
      return '<button role="tab" class="tab' + (t.id === aTab ? ' on' : '') + '" data-tab="' + t.id + '"' +
        ' aria-selected="' + (t.id === aTab) + '">' + h.esc(t.label) +
        (t.n ? '<i class="tab-badge">' + t.n + '</i>' : '') + '</button>';
    }).join('') + '</div>';

    function apStrip(items) {
      return '<div class="ov-strip">' + items.map(function (c) {
        return '<span class="ov-strip-k">' + h.esc(c.label) + ' <b' + (c.alert ? ' class="alert"' : '') + '>' +
          h.esc(c.value) + '</b> <span class="sub">' + h.esc(c.sub) + '</span></span>';
      }).join('') + '</div>';
    }
    var pendingStrip = apStrip([
      { label: '待我审批', value: String(pending.length), alert: pending.length > 0, sub: '其中 ' + overSla.length + ' 个已超 SLA' },
      /* v37：删掉「平均处理时长」—— 那是给主管看的报表指标，审批人拿它做不了决定。
         一条待办要回答的是"先动哪个"，不是一个已经过去的平均值。 */
      { label: '我发起的', value: String(mine.length), sub: mine.filter(function (i) { return !i.decided; }).length + ' 个审批中 · ' + mine.filter(function (i) { return i.decided; }).length + ' 个已结单' }
    ]);
    /* v37：删掉超时焦点卡。
       它和表里的「⚠超时」说的是同一件事，而且卡上唯一的按钮「先处置最久的 →」
       等于替人做决定 —— 界面不该替审批人选先动哪条。
       超时的表达改成排序：超时的置顶、再按 P0→P3、再按超时幅度。 */
    var overSlaRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    var pendingSorted = pending.slice().sort(function (a, b) {
      var ao = a.waitMin > a.slaMin ? 0 : 1, bo = b.waitMin > b.slaMin ? 0 : 1;
      if (ao !== bo) return ao - bo;
      var d = (overSlaRank[a.level] == null ? 9 : overSlaRank[a.level]) - (overSlaRank[b.level] == null ? 9 : overSlaRank[b.level]);
      if (d) return d;
      return (b.waitMin - b.slaMin) - (a.waitMin - a.slaMin);
    });

    /* ⚠ 以下五条分支是重排前的**原样区块**（含每张表的列、列头、动作、data-id、空态文案），
       唯一改动是「哪张表在什么时候渲染」—— 功能的唯一真源仍是它们。 */
    var apBody;
    if (aTab === 'apr-decided') {
      apBody = apStrip([
        { label: '已处理', value: String(decided.length), sub: '通过 ' + approvedN + ' / 驳回 ' + rejectedN },
        { label: '平均处理时长', value: avgHandled != null ? fmt.wait(Math.round(avgHandled)) : '—', sub: '已决单据从提交到结单的用时' }
      ]) +
      '<div class="card pad0"><div class="card-h pad"><h3>已处理</h3><span class="card-sub">含驳回理由 · 点行看单据与处理链</span></div>' +
      h.table({
        columns: [
          { key: 'level', label: '等级', render: function (r) { return h.pill(r.levelKind, r.level); } },
          { key: 'title', label: '单据' }, { key: 'applicant', label: '申请人' },
          { key: 'decided', label: '结论', render: function (r) { return r.decided === 'approved' ? '<span class="pill ok">已通过</span>' : '<span class="pill bad">已驳回</span>'; } },
          { key: 'decidedBy', label: '审批人' },
          { key: 'reason', label: '意见', render: function (r) { return '<span class="impact-txt">' + h.esc(r.reason) + '</span>'; } }
        ],
        rows: decided, noPaging: true,
        rowAction: 'row-detail', rowIdKey: 'id',
        /* 行内详情取**该单据自己的字段**，不另编内容 */
        detailHtml: function (r) {
          return '申请人：' + (r.applicant || '—') + ' · 等级 ' + (r.level || '—') +
            ' · 影响面：' + (r.impact || '—');
        }
      }) + '</div>';
    } else if (aTab === 'apr-mine') {
      apBody = apStrip([
        { label: '我发起的', value: String(mine.length), sub: mine.filter(function (i) { return !i.decided; }).length + ' 个审批中 · ' + mine.filter(function (i) { return i.decided; }).length + ' 个已结单' },
        { label: '待我审批', value: String(pending.length), alert: pending.length > 0, sub: '等处置' }
      ]) +
      '<div class="card pad0"><div class="card-h pad"><h3>我发起的变更</h3><span class="card-sub">我提交的单据在链路中的进展，等待审批人处理 · 点行看影响面</span></div>' +
      h.table({
        columns: [
          { key: 'level', label: '等级', render: function (r) { return h.pill(r.levelKind, r.level); } },
          { key: 'title', label: '单据', render: function (r) { return '<b>' + h.esc(r.title) + '</b><div class="td-sub">' + h.esc(r.type) + (r.targetId ? ' · ' + h.esc(r.targetId) : '') + '</div>'; } },
          { key: 'approver', label: '当前审批人', render: function (r) { return r.decided ? h.esc(r.decidedBy) : (r.approver ? h.esc(r.approver) : '<span class="muted">分配中</span>'); } },
          { key: 'decided', label: '状态', render: function (r) { return r.decided === 'approved' ? '<span class="pill ok">已通过</span>' : (r.decided === 'rejected' ? '<span class="pill bad">已驳回</span>' : '<span class="pill warn">审批中</span>'); } },
          { key: 'waitMin', label: '已等待 / 结单', align: 'right', sortable: true, render: function (r) { return r.decided ? fmt.rel(r.decidedDays) + ' 结单' : fmt.wait(r.waitMin); } },
          { key: 'reason', label: '结论 / 说明', render: function (r) { return r.reason ? '<span class="impact-txt">' + h.esc(r.reason) + '</span>' : '<span class="muted">等待审批人反馈</span>'; } }
        ],
        rows: mine, noPaging: true,
        rowAction: 'row-detail', rowIdKey: 'id',
        detailHtml: function (r) { return '影响面：' + (r.impact || '—') + ' · 类型 ' + (r.type || '—'); },
        emptyTitle: '没有我发起的审批', emptySub: '提交的单据会在这里跟踪链路进展'
      }) + '</div>';
    } else if (aTab === 'apr-rules') {
      apBody = authRulesBlock(q, h, fmt, state);
    } else if (aTab === 'apr-sec') {
      apBody = secEventsBlock(q, h, fmt);
    } else if (aTab === 'apr-flow') {
      apBody = '<div class="card"><div class="card-h"><h3>审批流配置</h3>' +
      '<button class="btn-ghost sm" data-act="apr-flow-add">新增操作类型</button></div>' +
      h.table({
        columns: [
          { key: 'op', label: '操作类型', render: function (r) {
              return h.esc(r.op) + (r.isNew ? ' <span class="pill info">新增</span>' : '')
                + (r.del ? ' <span class="pill idle">已停用</span>' : ''); } },
          { key: 'chain', label: '审批链路', render: function (r) {
              return r.del ? '<span class="muted">' + h.esc(r.chain) + '</span>'
                : '<button class="lnk" data-act="apr-flow-edit" data-id="' + h.esc(r.op) + '">' + h.esc(r.chain) + '</button>'; } },
          { key: 'cond', label: '条件路由', render: function (r) {
              return r.del ? '<span class="muted">' + h.esc(r.cond) + '</span>' : h.esc(r.cond); } },
          { key: 'sla', label: 'SLA' },
          { key: 'act', label: '配置', render: function (r) {
              if (r.del) {
                return '<button class="btn-ghost sm" data-act="apr-flow-restore" data-id="' + h.esc(r.op) + '">恢复</button>'
                  + ' <span class="muted" style="font-size:11.5px">' + h.esc(r.del.reason) + '</span>';
              }
              return '<button class="lnk" data-act="apr-flow-edit" data-id="' + h.esc(r.op) + '">改链路</button>'
                + ' <button class="lnk" data-act="apr-flow-del" data-id="' + h.esc(r.op) + '">停用</button>'; } }
        ],
        rows: aprFlowRows(state),
        noPaging: true
      }) +
      '<div class="bt-note">链路与条件都可改 —— 但**变更必须留原因、且只能停用不能删**：' +
      '审批链路的变更要能回答"当时配的是什么"，硬删会把这个答案丢掉。' +
      '</div></div>';
    } else {
      /* 默认页签：待我审批 —— 这一屏唯一"要你动手"的表 */
      apBody = pendingStrip +
      '<div class="card pad0"><div class="card-h pad"><h3>待我审批</h3>' +
      '<span class="card-sub">高风险单据禁止批量审批，必须逐个看影响面</span></div>' +
      h.table({
        columns: [
          { key: 'level', label: '等级', render: function (r) { return h.pill(r.levelKind, r.level); } },
          { key: 'title', label: '单据', render: function (r) { return '<button class="lnk" data-act="go-detail" data-id="approval|' + h.esc(r.id) + '" title="打开审批详情：变更 diff + 影响面 + 完整审批链路"><b>' + h.esc(r.title) + '</b></button><div class="td-sub mono">' + h.esc(r.type) + (r.targetId ? ' · ' + h.esc(r.targetId) : '') + '</div>'; } },
          { key: 'applicant', label: '申请人' },
          /* v37：这一列从「影响面」改成「这一单批下去会造出什么」。
             审批人判断的不是"这张单该不该批"，是"这条授权该不该存在" ——
             所以主行放授权预览（谁 · 什么动作 · 多大范围 · 多久），原来的影响面描述降为小字。 */
          { key: 'grantLine', label: '批下去会造出什么', render: function (r) {
              return '<b>' + h.esc(r.grantLine || '—') + '</b>' +
                (r.impact ? '<div class="td-sub impact-txt">' + h.esc(r.impact) + '</div>' : '');
            } },
          { key: 'waitMin', label: '等待', sortable: true, align: 'right', render: function (r) { var over = r.waitMin > r.slaMin; return '<span class="' + (over ? 'bad' : '') + '">' + fmt.wait(r.waitMin) + (over ? ' ⚠超时' : '') + '</span>'; } },
          { key: 'act', label: '操作', render: function (r) { return '<button class="lnk ok" data-act="apr-decide" data-id="' + h.esc(r.id) + '|approve">通过</button> · <button class="lnk warn" data-act="apr-decide" data-id="' + h.esc(r.id) + '|reject">驳回</button>'; } }
        ],
        rows: pendingSorted, noPaging: true,
        emptyTitle: '没有待处理的审批', emptySub: '所有单据均已处理完毕'
      }) + '</div>';
    }

    return pageHead(h, cap, { action: 'create-open' }) + apTabsHtml + apBody +

      h.metaBar({}, [
        { k: '本页分区', v: '六件事分六个页签，同一时刻只展示一类（角标为该类条数）：待我审批 / 我发起的 / 已处理 / 授权规则 / 安全事件 / 审批流配置。页签是"同屏互斥"不是"数据折叠"—— 每类的表、列、动作与切分前逐字相同，分别在同一页签内可查；页头「发起审批」始终可用' },
        { k: '授权口径', v: '授权规则为配置态：主体 × Agent 能力 × 动作 × 数据范围 × 条件；启用 + 停用 = 规则总数' },
        { k: '事件口径', v: '安全事件来自拦截日志（近 14 天）；待处置/已阻断/已处置计数与列表一致' },
        { k: '视角口径', v: '当前用户 = ' + h.esc((global.CURRENT_USER || {}).name || '—') + '（' + h.esc((global.CURRENT_USER || {}).role || '—') + '）：待我审批不含本人发起的单据；已处理由已决列表推导；我发起的单据标 mine，含审批中与已结单' }
      ]);
  }

  /* 审阅台当前项（会话内状态）：J/K 移动，A/D 判定后自动跳到下一条。
     交接 §7 提过「文案承诺了快捷键但代码没绑」—— 这里是真实现，不是装饰。 */
  var reviewCur = 0;
  var reviewKeysBound = false;

  /* SECTION: compliance-decided-single-source
   * 合规判定结论的**唯一真源 = APP_SHELL.state.aprOps**。
   * 🔴 此前这里是模块私有 `reviewDecided`，而详情页的「判误报 / 判违规 / 转人工」
   *    （v10-detail-gov.js 的 cp-decide，写 `state.aprOps[id] = {s, reason, by}`）写的是**另一份**状态，
   *    负责桥接的 `global.__v19_complianceCover` 全仓无定义（v19-governance-fix.js 里只有注释 + 一处 guard）
   *    ⇒ 详情判定成功、列表条目照旧。用户以为没成功，就重复判定；以为已生效，就按旧状态办事。
   * 现在：读端一律走 compDecidedOf(state)；审阅台（鼠标按钮 + 键盘 A/D）也写同一份 aprOps。
   * 合规三态取值与审批覆盖层（approved / rejected）**天然不撞**，可共存于 aprOps。 */
  var COMP_DECISION_LABEL = { pass: '通过（误报）', reject: '确认违规（驳回）', escalate: '存疑待核' };
  function compOpsOf(state) {
    var st = state || (global.APP_SHELL && global.APP_SHELL.state) || {};
    return (st && st.aprOps) || {};
  }
  /* 写结论：格式与详情页 cp-decide 一致（{ s, reason, by }），两处共写同一键 */
  function compDecide(state, id, s, reason) {
    var st = state || (global.APP_SHELL && global.APP_SHELL.state) || {};
    st.aprOps = st.aprOps || {};
    var me = (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me() : { name: '我' };
    st.aprOps[id] = { s: s, reason: reason || '', by: (st.aprOps[id] && st.aprOps[id].by) || me.name };
  }
  /* 读结论：只认合规三态 —— 审批队列的 approved/rejected/escalated 不在本页口径里 */
  function compDecidedOf(state) {
    var ops = compOpsOf(state), out = {}, k;
    for (k in ops) {
      if (!Object.prototype.hasOwnProperty.call(ops, k)) continue;
      var lbl = COMP_DECISION_LABEL[ops[k] && ops[k].s];
      if (lbl) out[k] = lbl;
    }
    return out;
  }

  function reviewRerender() {
    var sh = global.APP_SHELL;
    if (sh && typeof sh.render === 'function') sh.render();
  }
  function reviewToast(msg, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (kind || 'info');
    clearTimeout(reviewToast._t);
    reviewToast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  /* v15：审阅台「鼠标按钮」此前是空动作 —— 而键盘 A/D 是真回写的。
     同一界面两套行为（点按钮没反应、按键盘却生效）是最伤信任的一类缺陷，这里让鼠标走同一条通道。 */
  ACTIONS['review-decide'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var label = { pass: '通过', reject: '驳回', escalate: '存疑待核' }[p[1]] || '通过';
    var it = (queues().compliance.items || []).filter(function (x) { return x.id === p[0]; })[0];
    /* 与详情页共写同一份结论（此前只写模块私有变量 ⇒ 详情页看不到、governance 覆盖层也看不到） */
    compDecide(h.state, p[0], COMP_DECISION_LABEL[p[1]] ? p[1] : 'pass', '合规审阅台判定');
    reviewToast('已' + label + '：' + (it ? it.rule : p[0]) + '（本会话）', p[1] === 'reject' ? 'bad' : 'ok');
    reviewRerender();
  };
  /* v15：审批列表的 通过/驳回 —— 详情页早就做真了，列表却还是空动作。统一走确认层。 */
  ACTIONS['apr-decide'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var it = queues().approval.items.filter(function (x) { return x.id === p[0]; })[0];
    if (!it) { h.toast('审批单不存在', 'bad'); return; }
    var op = p[1] || 'approve';
    var map = {
      approve: { t: '通过', s: 'approved', tone: 'normal', perm: 'approval:decide:approve', reason: true },
      reject: { t: '驳回', s: 'rejected', tone: 'danger', perm: 'approval:decide:reject', reason: true }
      /* 2026-10-28：删「转交上级」—— 单人系统里没有上级可转交。 */
    };
    var m = map[op] || map.approve;
    h.dangerConfirm(h, {
      title: m.t, desc: m.t + '「' + it.title + '」？',
      tone: m.tone, perm: m.perm,
      impacts: [
        { label: '影响面', value: it.impact },
        { label: '等待时长', value: h.fmt.wait(it.waitMin) + (it.waitMin > it.slaMin ? '　已超 SLA' : '') }
      ],
      confirmText: '确认' + m.t,
      onConfirm: function (reason) {
        h.state.aprOps = h.state.aprOps || {};
        /* 2026-10-28：审批压成一级 —— 谁发起、谁审批、谁承担后果，都是同一个人。
           P0 原先要「两级异人复审」，单人系统里那一级没人能签，单据会永远卡在 pending-stage2。
           所以不再分两段：一次通过即生效，风险靠 SLA 与「影响面」在确认弹层里说清。 */
        h.state.aprOps[it.id] = { s: m.s, reason: reason || '', by: '我' };
        h.toast('演示环境：已' + m.t + '「' + it.title + '」（本会话）', op === 'reject' ? 'bad' : 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* v15：授权规则 停用/启用 —— 安全配置的启停必须有后果（此前是空动作）。 */
  ACTIONS['ar-toggle'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var r = (queues().approval.authRules || []).filter(function (x) { return x.id === p[0]; })[0];
    if (!r) { h.toast('授权规则不存在', 'bad'); return; }
    var off = p[1] === 'off';
    h.dangerConfirm(h, {
      title: off ? '停用授权规则' : '启用授权规则',
      desc: (off ? '停用' : '启用') + '「' + r.subject + ' × ' + r.agentCap + '」？',
      tone: off ? 'danger' : 'normal', perm: 'approval:authrule:' + (off ? 'disable' : 'enable'),
      impacts: [
        { label: '主体 × 能力', value: r.subject + ' → ' + r.agentCap },
        { label: '动作 / 数据范围', value: r.action + ' · ' + r.scope },
        { label: '风险等级', value: r.risk + (off && r.risk === '高' ? '　停用后该主体立即失去权限' : '') },
        { label: '可回滚', value: '是 —— 可再次切换' }
      ],
      confirmText: '确认' + (off ? '停用' : '启用'),
      onConfirm: function () {
        h.state.arOps = h.state.arOps || {};
        h.state.arOps[r.id] = off ? 'off' : 'on';
        h.toast('演示环境：已' + (off ? '停用' : '启用') + '（仅本会话）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /** 审阅台键盘：J/K 上下条 · A 通过 · D 驳回 · S 跳过 · ⌘↵ 提交当前条 */
  function bindReviewKeys(getItems) {
    if (reviewKeysBound) return;
    // 渲染器应保持纯函数：无 DOM 环境（如纯渲染层测试）下直接跳过绑定
    if (typeof document === 'undefined' || !document.addEventListener) return;
    reviewKeysBound = true;
    document.addEventListener('keydown', function (e) {
      var sh = global.APP_SHELL;
      if (!sh || !sh.state || sh.state.cap !== 'compliance') return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      var list = document.getElementById('review-list');
      if (!list) return;
      var nodes = list.querySelectorAll('.review-item');
      if (!nodes.length) return;
      var k = e.key;
      var idx = reviewCur;
      if (k === 'j' || k === 'J' || k === 'ArrowDown') {
        e.preventDefault();
        reviewCur = Math.min(nodes.length - 1, idx + 1);
        reviewRerender();
        return;
      }
      if (k === 'k' || k === 'K' || k === 'ArrowUp') {
        e.preventDefault();
        reviewCur = Math.max(0, idx - 1);
        reviewRerender();
        return;
      }
      var cur = nodes[Math.min(idx, nodes.length - 1)];
      var id = cur && cur.getAttribute('data-rv-id');
      if (!id) return;
      if (k === 'a' || k === 'A') {
        e.preventDefault();
        compDecide(sh.state, id, 'pass', '合规审阅台键盘判定');
        reviewToast('已通过：' + (cur.querySelector('.rv-rule') || {}).textContent + '（本会话）', 'ok');
        reviewCur = Math.min(reviewCur, Math.max(0, getItems().length - 1));
        reviewRerender();
      } else if (k === 'd' || k === 'D') {
        e.preventDefault();
        var ruleTxtD = (cur.querySelector('.rv-rule') || {}).textContent || id;
        /* v19：驳回是负面决定，两条通道都要问一句（键盘通道与鼠标通道同标准） */
        /* 2026-10-28：理由框去掉 —— 审计删除后理由没有去处，鼠标通道（ap-decide）也不填了，
           两条通道必须同一标准，否则键盘按 D 会被多要求一次。 */
        if (global.V10UI && global.V10UI.openSheet) {
          global.V10UI.openSheet({
            title: '驳回「' + ruleTxtD + '」？',
            bodyHtml: '<div class="v10-sheet-desc">驳回是负面结论，会直接改变这条的判定。</div>',
            footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button><button class="btn-danger" data-v10="ok">确认驳回</button>',
            onOpen: function (root) {
              root.addEventListener('click', function (ev) {
                var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
                if (g === 'cancel') { global.V10UI.closeSheet(); return; }
                if (g !== 'ok') return;
                global.V10UI.closeSheet();
                compDecide(sh.state, id, 'reject', '');
                reviewToast('已驳回：' + ruleTxtD + '（本会话）', 'bad');
                reviewRerender();
              });
            }
          });
        } else {
          compDecide(sh.state, id, 'reject', '');
          reviewToast('已驳回：' + ruleTxtD + '（本会话）', 'bad');
          reviewRerender();
        }
      } else if (k === 's' || k === 'S') {
        e.preventDefault();
        reviewCur = Math.min(nodes.length - 1, idx + 1);
        reviewToast('已跳过，看下一条');
        reviewRerender();
      } else if ((e.metaKey || e.ctrlKey) && k === 'Enter') {
        e.preventDefault();
        reviewToast('已提交本轮判定（演示环境，未落库）', 'ok');
      }
    }, false);
  }

  function compliancePage(cap, state, h, q) {
    var fmt = h.fmt;
    var k = Q.kpi(state.range);
    var errRows = Q.groupBy(state.range, 'errCode').rows;
    var compRow = errRows.filter(function (r) { return r.key === 'E_COMPLIANCE'; })[0];
    /* 已判定的条目从待办里移出，并同步「待人工复核」计数 —— 键盘判定要看得见结果 */
    var allItems = q.items;
    /* 读端 = 覆盖层（详情页 cp-decide 与审阅台 review-decide 共写的同一份结论） */
    var decidedMap = compDecidedOf(state);
    var items = allItems.filter(function (it) { return !decidedMap[it.id]; });
    if (reviewCur >= items.length) reviewCur = Math.max(0, items.length - 1);
    var decidedN = Object.keys(decidedMap).length;
    bindReviewKeys(function () {
      /* 键盘 j/k 的条数也要与当前结论同源（否则判完一条后游标会越界到已判条目上） */
      var dm = compDecidedOf(global.APP_SHELL ? global.APP_SHELL.state : state);
      return q.items.filter(function (it) { return !dm[it.id]; });
    });
    var packs = [
      { id: 'rp-law', name: '敏感表述-广告法 v12', scope: '覆盖 9 类场景', rules: 142, status: 'ok', statusText: '已启用', hit: 1284, falsePos: 0.018, updated: -2 },
      { id: 'rp-pii', name: '数据出境校验 v3', scope: 'PII / 跨境传输', rules: 38, status: 'ok', statusText: '已启用', hit: 96, falsePos: 0.004, updated: -8 },
      { id: 'rp-sample', name: '输出内容抽样机制', scope: '抽样比例 5%', rules: 1, status: 'ok', statusText: '已启用', hit: 3402, falsePos: 0, updated: -14 },
      { id: 'rp-law13', name: '广告法新增表述规则 v13', scope: '灰度 10% 流量', rules: 24, status: 'warn', statusText: '灰度中·误报超标', hit: 61, falsePos: 0.032, updated: -1 }
    ];
    /* v15：本会话新建的规则包并入同一张表 —— KPI 与列表读同一份数组，避免"卡片说 3 条、列表 4 行"。
       新建包无灰度数据，故不计入误报率均值，误报率列显示「暂无数据」。 */
    packs = packs.concat(((state && state.newObjs && state.newObjs['compliance']) || []).map(function (o) {
      return { id: o.id, name: o.name + '（本会话新建）', scope: o.scope, rules: o.rules, status: 'warn', statusText: '灰度中', hit: 0, falsePos: null, updated: 0, isNew: true };
    }));
    var _ruleOv = (state && state.ruleOps) || {};
    var packsEff = packs.map(function (p) {
      var s = _ruleOv[p.id];
      if (s === 'disabled') return Object.assign({}, p, { status: 'idle', statusText: '已停用（本会话）' });
      if (s === 'rolledback') return Object.assign({}, p, { status: 'ok', statusText: '已回滚到上一版', falsePos: 0.018 });
      return p;
    });
    var packsLive = packsEff.filter(function (p) { return _ruleOv[p.id] !== 'disabled' && !p.isNew; });

    return pageHead(h, cap, { side: h.rangePicker(state.range), action: 'create-open' }) +
      '<div class="metrics">' + [
        { label: '检查次数', value: fmt.compact(k.calls), deltaHtml: fmt.delta(k.compare.calls), definition: '所有 Agent 输出经过合规检查节点的次数', sub: Q.RANGES[state.range].label },
        { label: '合规拦截', value: fmt.int(compRow ? compRow.calls : 0), alert: true, sub: '占总调用 ' + fmt.pct2(k.calls ? (compRow ? compRow.calls : 0) / k.calls : 0), definition: '错误码 E_COMPLIANCE 的调用数，来自真实 trace 聚合' },
        { label: '待人工复核', value: String(items.length), alert: items.length > 0, sub: decidedN ? ('本次已判定 ' + decidedN + ' 条') : ('最长等待 ' + fmt.wait(items.length ? Math.max.apply(null, items.map(function (i) { return i.waitMin; })) : 0)) },
        { label: '误报率', value: fmt.pct1(packsLive.length ? packsLive.reduce(function (s, p) { return s + p.falsePos; }, 0) / packsLive.length : 0), definition: '人工判定为误报的比例，超 2% 不允许发布新规则', alert: true }
      ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>' + h.esc(q.title) + '</h3>' +
      /* v10b：键帽化（<kbd> + 平台自适应）—— 旧文案写死 ⌘↵，Windows 用户看到陌生符号，
         而代码监听的其实是 metaKey||ctrlKey（Ctrl+Enter 在 Windows 上明明生效）。 */
      '<span class="card-sub">双栏审阅台 · ' + h.kbd('a') + ' 通过 · ' + h.kbd('d') + ' 驳回 · ' + h.kbd('s') + ' 跳过 · ' + h.kbd('j') + h.kbd('k') + ' 上下条 · ' + h.kbd('mod+enter') + ' 提交（快捷键已生效）</span></div>' +
      '<div class="review-list" id="review-list">' + (items.length ? items.map(function (it, i) {
        var ag = S.AGENTS[S.idx.agent[it.agentId]];
        return '<div class="review-item ' + it.levelKind + (i === reviewCur ? ' cur' : '') + '" data-rv-idx="' + i + '" data-rv-id="' + h.esc(it.id) + '">' +
          '<div class="rv-l">' +
          '<div class="rv-h">' + h.pill(it.levelKind, it.level) +
          '<span class="rv-rule">' + h.esc(it.rule) + '</span>' +
          '<span class="rv-wait">等待 ' + fmt.wait(it.waitMin) + '</span>' +
          (i === reviewCur ? '<span class="rv-cursor" title="当前选中">▶</span>' : '') + '</div>' +
          '<div class="rv-content">' + h.esc(it.summary) + '</div>' +
          '<div class="rv-src">来源：<button class="lnk" data-act="goto-agent" data-id="' + h.esc(it.agentId) + '">' + h.esc(it.agentName) + '</button>' +
          (ag ? ' · 该 Agent 近 24h 成功率 ' + fmt.pct2(F.dailyRow(S.idx.agent[it.agentId], 0).successRate) : '') + '</div>' +
          '</div>' +
          '<div class="rv-r">' +
          /* v10b（走查 1.7）：操作权重与频率对齐 + 键位=位置 ——
             旧序：通过(绿描边) / 确认违规(红实心·全场最高对比) / 升级 / 详情，纵排四列。
             红实心是确认框专属权重，放在高频审核区既倒挂又易误触；
             改横排 + 键帽印在按钮上（A 通过 / D 驳回），键盘提示与位置一一对应。 */
          '<button class="btn-ghost ok" data-act="review-decide" data-id="' + h.esc(it.id) + '|pass"><kbd class="kbd">A</kbd>通过（误报）</button>' +
          '<button class="btn-ghost danger" data-act="review-decide" data-id="' + h.esc(it.id) + '|reject"><kbd class="kbd">D</kbd>确认违规</button>' +
          '<button class="btn-ghost sm" data-act="review-decide" data-id="' + h.esc(it.id) + '|escalate">存疑待核</button>' +
          // 详情下钻：R.complianceDetail 早已实现（v10-detail-gov.js），此前无任何入口能到它
          '<button class="btn-ghost sm" data-act="comp-detail" data-id="' + h.esc(it.id) + '">详情</button>' +
          '<div class="rv-note">同类案例历史判定：' + (function () {
            /* v15：此前 4 条待复核的历史判定文字完全相同（都是 12/11/1），像模板灌水。
               改为按条目 id 确定性派生（走 S.R.of，符合"确定性生成"铁律），每条各不相同。 */
            var rr = S.R.of('comp-hist|' + it.id);
            var sim = 8 + Math.floor(rr() * 12);
            var wrong = Math.max(1, Math.round(sim * (0.72 + rr() * 0.22)));
            var fp = sim - wrong;
            return '近 30 天相似内容 ' + sim + ' 条，' + wrong + ' 条判违规、' + fp + ' 条判误报';
          })() + '</div>' +
          '</div></div>';
      }).join('') : '<div class="empty"><div class="empty-title">' + (decidedN ? '本轮待复核已全部处理完' : '当前没有待复核内容') + '</div>' +
        '<div class="empty-sub">' + (decidedN ? '本次已判定 ' + decidedN + ' 条 · 演示环境未落库，刷新后恢复' : '规则包运行正常，暂无人工复核项') + '</div></div>') + '</div>' +
      '<div class="bt-note">一致性保障：支持选中多条批量判定；每条显示相似案例的历史判定，避免同案不同判。' +
      '<span class="muted" id="rv-hint">' + (items.length ? ('当前第 ' + (reviewCur + 1) + ' / ' + items.length + ' 条，按 J / K 切换') : '待复核 0 条') + '</span></div></div>' +

      '<div class="card pad0"><div class="card-h pad"><h3>规则包</h3>' +
      '<span class="card-sub">新规则必须灰度验证，误报率超 2% 不允许发布</span>' +
      '<button class="btn-ghost sm" data-act="create-open" data-create="compliance">新建规则包</button></div>' +
      h.table({
        columns: [
          { key: 'name', label: '规则包' }, { key: 'scope', label: '覆盖范围' },
          { key: 'rules', label: '规则数', align: 'right', fmt: 'int' },
          { key: 'hit', label: '命中次数', align: 'right', fmt: 'int' },
          { key: 'falsePos', label: '误报率', align: 'right', render: function (r) { return r.isNew ? '<span class="muted">灰度中 · 暂无数据</span>' : '<span class="' + (r.falsePos > 0.02 ? 'bad' : 'ok') + '">' + fmt.pct1(r.falsePos) + '</span>'; } },
          { key: 'updated', label: '更新', align: 'right', render: function (r) { return fmt.rel(r.updated); } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          { key: 'act', label: '操作', render: function (r) {
            var off = _ruleOv[r.id] === 'disabled';
            return '<button class="lnk" data-act="rule-backtest" data-id="' + h.esc(r.id) + '">回测</button> · ' +
              '<button class="lnk" data-act="rule-refs" data-id="' + h.esc(r.id) + '">引用方</button> · ' +
              (off ? '<button class="lnk ok" data-act="rule-toggle" data-id="' + h.esc(r.id) + '|enable">启用</button>'
                : '<button class="lnk warn" data-act="rule-toggle" data-id="' + h.esc(r.id) + '|disable">停用</button>' +
                  (r.isNew ? ' · <button class="lnk" data-act="new-obj-advance" data-id="compliance">转全量</button>'
                    : (r.falsePos > 0.02 ? ' · <button class="lnk warn" data-act="rule-toggle" data-id="' + h.esc(r.id) + '|rollback">回滚上一版</button>' : '')));
          } }
        ],
        rows: packsEff, noPaging: true
      }) + '</div>' +
      h.metaBar(k.meta, [{ k: '拦截口径', v: '合规拦截数 = 错误码 E_COMPLIANCE 的调用数，可从 trace 检索页按该错误码下钻逐条核对' }]);
  }

  /* SECTION: r-pipeline-page */
  RENDERERS.pipelinePage = function (cap, state, h) {
    var fmt = h.fmt;
    var p = pipes()[cap.pipeline];
    if (!p) return '<div class="fatal"><h2>未配置的流水线</h2><p>' + h.esc(cap.pipeline) + '</p></div>';

    if (cap.pipeline === 'userops') return useropsPage(cap, state, h, p);
    return evolutionPage(cap, state, h, p);
  };

  function stageFlow(stages, h) {
    /* v20：删掉卡内 <i class="st-arrow"> —— 该类全项目无 CSS 定义，渲染成裸斜体箭头，
       与 .stage::after 的卡间箭头构成双箭头。箭头统一交给 ::after。 */
    return '<div class="stages">' + stages.map(function (s) {
      return '<div class="stage ' + s.state + '">' +
        '<div class="st-h"><b>' + h.esc(s.name) + '</b>' +
        (s.count != null ? '<span class="st-n">' + C.fmtNum(s.count) + '</span>' : '') + '</div>' +
        '<div class="st-d">' + h.esc(s.detail) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function lifecycleBlock(p, h, fmt) {
    var lc = p.lifecycle || {};
    var st = lc.stages || [];
    var pool = p.pool || 0;
    if (!st.length) return '';
    /* 每个生命周期阶段尽量接到**真实存在的分群**（不是所有阶段都有对应分群，
       没有的就如实写"无对应分群"，不挂一个点了会落空的按钮）。
       对应关系取自语义而非猜测：预流失↔高流失风险、沉默↔沉睡可唤醒。 */
    /* ⚠ `p.segments` **本身就是数组**（不是 {items:[]}）—— 写成 p.segments.items 会恒为空，
       于是所有阶段都退化成"无对应分群"（这个坑我真踩了一次）。与 :5811 的 seg-detail 取法保持一致。 */
    var _segs = Array.isArray(p.segments) ? p.segments : ((p.segments && p.segments.items) || []);
    var SEG_OF_STAGE = {
      lapsing: _segs.filter(function (s) { return s.name === '高流失风险'; })[0],
      silent: _segs.filter(function (s) { return s.name === '沉睡可唤醒'; })[0],
      new: _segs.filter(function (s) { return s.name === '价格敏感新客'; })[0],
      active: _segs.filter(function (s) { return s.name === 'VIP 续费池'; })[0]
    };
    var cells = st.map(function (s) {
      var warn = s.lost30 != null && s.lost30 > 0.05;
      var seg = SEG_OF_STAGE[s.id];
      var inner =
        '<div style="font-weight:600;font-size:13px">' + h.esc(s.name) + '</div>' +
        '<div style="font-size:12px;color:var(--sub);margin:2px 0 6px">' + h.esc(s.note) + '</div>' +
        '<div style="font-size:15px"><b>' + fmt.int(s.count) + '</b><span style="color:var(--sub);margin-left:6px">' + fmt.pct1(s.share) + '</span></div>' +
        '<div style="font-size:12px;margin-top:4px" class="' + (warn ? 'bad' : 'muted') + '">' +
        (s.lost30 != null ? '近30天流失 ' + fmt.pct1(s.lost30) : '—') + '</div>' +
        (seg
          ? '<div style="margin-top:8px"><span class="lnk">看分群「' + h.esc(seg.name) + '」→</span></div>'
          : '<div style="margin-top:8px" class="muted" title="该阶段暂无与之对应的现成分群，圈人入口在下方「用户分群」">无对应分群</div>');
      /* 2026-10-20 走查修复（这条是真根因，不是换布局能解决的）：
         这一段原来是 `<button class="stage-cell">` 里再套一个
         `<button class="lnk">看对应分群</button>` —— HTML 不允许 button 嵌 button，
         浏览器会把内层按钮**弹出到外层**，5 个阶段被拆成 10 个元素，在 flex 里乱排成
         「五张卡宽度参差、最后一张占满整行」。现在外层用 div[role=button]（可嵌套），
         内层那句降成 span —— 整格仍然可点，但语义只剩一个。 */
      var boxStyle = 'border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px';
      /* 有分群的阶段整格可点（语义就是"去看这群人"）；没有的保持纯展示 */
      return seg
        ? '<div class="stage-cell" role="button" tabindex="0" data-act="seg-detail" data-id="' + h.esc(seg.id) + '" style="' + boxStyle + ';text-align:left;background:none;cursor:pointer">' + inner + '</div>'
        : '<div style="' + boxStyle + '">' + inner + '</div>';
    }).join('');
    var _plc = st.filter(function (s) { return s.lost30 != null; }).sort(function (a, b) { return b.lost30 - a.lost30; })[0];
    var focusHtml = _plc ? '<div class="alert-banner warn"><b>⚠ 流失焦点：' + h.esc(_plc.name) + '</b>' +
      '<span>' + fmt.int(_plc.count) + ' 人 · 近30天流失 ' + fmt.pct1(_plc.lost30) + '</span>' +
      '<span class="hint">建议优先召回，否则将滑入下一阶段。</span></div>' : '';
    /* v20：流失赢回 —— B2B 六阶段模型里 Churn & Winback 是正式生命周期阶段，不是终点。
       此前「已流失」是死胡同：只显示人数和「—」，没有任何动作。 */
    var wb = p.winback || null;
    var lostStage = st.filter(function (s) { return s.id === 'lost'; })[0];
    var wbHtml = (wb && lostStage) ? '<div class="excl-row" style="margin-top:10px"><i>流失赢回</i>' +
      '<span>' + h.esc(wb.windowText) + '</span>' +
      '<span>' + h.esc(wb.recoveredText) + '</span>' +
      '<span class="muted">按流失原因分组定向：' + wb.groups.map(function (g) { return g.name + ' ' + Math.round(g.share * 100) + '%（' + g.play + '）'; }).join(' · ') + '</span></div>' : '';
    return focusHtml + '<div class="card"><div class="card-h"><h3>用户生命周期</h3>' +
      '<span class="card-sub">存量分布 · Σ各阶段 = 池规模 ' + fmt.int(pool) + ' · 近 30 天流失率</span></div>' +
      '<div class="lc-grid">' + cells + '</div>' +
      '<div class="bt-note">口径：企业侧联系人池（非设备数）。「已流失」是存量状态，不计入流失率；预流失/沉默阶段的流失率是处置重点。</div>' +
      wbHtml + '</div>';
  }

  function feedbackBlock(p, h, fmt) {
    var _rawFb = (p.feedback && p.feedback.items) || [];
    /* v15：认领必须看得见结果 —— 认领后状态由「待处理」转「处理中」、认领人显示为「我」，
       否则这个动作在界面上没有任何反馈（需求：操作要有闭环）。 */
    var _claimsFb = (h.state && h.state.claims) || {};
    var items = _rawFb.map(function (i) {
      if (!_claimsFb[i.id]) return i;
      return Object.assign({}, i, { status: 'wip', statusText: '处理中', owner: _claimsFb[i.id] });
    });
    /* 🔴 「新建处置规则」写的是 state.newObjs['user-ops-rule']，本页此前没有一处读它
       ⇒ 建完屏幕上什么都没有（本页也还没有"处置规则"清单，所以先按画像库的会话区块落地）。 */
    var ruleBlock = global.UI.sessionNewBlock(h.state, h, 'user-ops-rule', {
      title: '本会话新建的处置规则',
      cols: function (o) { return o.meta || ''; }
    });
    if (!items.length) return ruleBlock;
    var open = items.filter(function (i) { return i.status === 'open'; }).length;
    var wip = items.filter(function (i) { return i.status === 'wip'; }).length;
    var kindAgg = {};
    items.forEach(function (i) { kindAgg[i.kindText] = (kindAgg[i.kindText] || 0) + 1; });
    var topKinds = Object.keys(kindAgg).sort(function (a, b) { return kindAgg[b] - kindAgg[a]; }).slice(0, 3);
    // 周趋势由明细逐天聚合，与列表严格对账
    var trend = [0, 0, 0, 0, 0, 0, 0];
    items.forEach(function (i) { if (i.dayOffset >= -6 && i.dayOffset <= 0) trend[6 + i.dayOffset]++; });
    var rows = items.slice().sort(function (a, b) { return a.dayOffset - b.dayOffset; }).map(function (i) {
      return {
        id: i.id, kind: i.kindText, kindK: i.kind, summary: i.summary, channel: i.channel,
        related: i.related, impact: i.impact, day: i.dayOffset, status: i.status, statusText: i.statusText, owner: i.owner
      };
    });
    /* v20：optdown（申请降频）排第 3 —— 不及时响应降频请求，下一步就是退订 */
    var _prio = { complaint: 0, bug: 1, unsub: 2, optdown: 3, nps: 4, satisfaction: 5 };
    /* v15：此前 slice(0,4) 只渲染 4 条，而卡片副标题写「7 条待处置」—— 剩下的用户永远看不到。
       改为全部列出（按优先级排序），并在副标题里点明与下方「用户反馈」同源。 */
    var _todo = items.filter(function (i) { return i.status === 'open'; }).sort(function (a, b) { return (typeof _prio[a.kind] === 'number' ? _prio[a.kind] : 9) - (typeof _prio[b.kind] === 'number' ? _prio[b.kind] : 9); });
    var focusHtml = '<div class="card"><div class="card-h"><h3>先处理什么</h3><span class="card-sub">' + _todo.length + ' 条待处置 · 按「投诉/产品缺陷优先」· 明细与下方「用户反馈」同源</span></div><div class="ab-list">' +
      _todo.map(function (i) { return '<button class="ab-item" data-act="feedback-detail" data-id="' + h.esc(i.id) + '"><span class="ab-why">' + h.esc(i.kindText) + (i.kind === 'complaint' || i.kind === 'bug' ? ' · 优先' : '') + '</span><b>' + h.esc(i.summary) + '</b><span class="ab-go">详情 →</span></button>'; }).join('') + '</div></div>';
    return focusHtml + '<div class="card pad0"><div class="card-h pad"><h3>用户反馈</h3>' +
      '<span class="card-sub">近 7 天 ' + items.length + ' 条 · 待处理 ' + open + ' · 处理中 ' + wip + ' · 趋势与列表同源</span>' +
      '<button class="btn-ghost sm" data-act="create-open" data-create="user-ops-rule">新建处置规则</button></div>' +
      /* v10b（走查 3.4）：kind 聚合 chip 从「长得像能点但点了没反应」的 span 变成真筛选按钮 ——
         点某类只看某类，再点取消；键盘可达（真 button），aria-pressed 同步状态。 */
      '<div class="chips" style="padding:0 16px 4px">' + topKinds.map(function (k) {
        var on = (h.state.filters || {}).fbKind === k;
        return '<button class="chip link' + (on ? ' on' : '') + '" data-act="uo-fb-kind" data-id="' + h.esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="只看「' + h.esc(k) + '」类反馈，再点取消">' + h.esc(k) + ' <b>' + kindAgg[k] + '</b></button>';
      }).join('') + '</div>' +
      /* 2026-10-20 走查修复：7 根柱子只有数字、没有日期 —— 看不出哪天是高点。
         每根下面补 MM-DD（由 dayOffset 反推，不另写死日期）。 */
      '<div style="display:flex;gap:4px;align-items:flex-end;height:58px;padding:6px 16px 8px">' +
      trend.map(function (v, i) {
        var hh = v ? Math.max(6, Math.round(v / Math.max.apply(null, trend) * 32)) : 3;
        var _dt = new Date(Date.now() - (6 - i) * 86400000);
        var lbl = (_dt.getMonth() + 1) + '-' + _dt.getDate();
        return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px">' +
          '<span style="font-size:11px;color:var(--sub)">' + v + '</span>' +
          '<i style="display:block;width:70%;height:' + hh + 'px;background:#2563eb;border-radius:2px"></i>' +
          '<span style="font-size:10px;color:var(--faint)">' + lbl + '</span></div>';
      }).join('') + '</div>' +
      '<div class="sub-h" style="padding:0 16px">近 7 天逐日新增（由明细聚合）</div>' +
      h.table({
        columns: [
          { key: 'kind', label: '类型', render: function (r) { return '<span class="pill ' + (r.kindK === 'complaint' || r.kindK === 'bug' ? 'bad' : (r.kindK === 'unsub' ? 'warn' : 'info')) + '">' + h.esc(r.kind) + '</span>'; } },
          { key: 'summary', label: '反馈内容' },
          { key: 'channel', label: '来源' },
          { key: 'related', label: '关联对象' },
          { key: 'impact', label: '影响', align: 'right', render: function (r) { return r.impact + ' 人'; } },
          { key: 'day', label: '时间', render: function (r) { return fmt.rel(r.day); } },
          { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
          { key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="feedback-detail" data-id="' + h.esc(r.id) + '">详情</button>' + ((h.state.claims || {})[r.id] ? ' · <span class="muted">已认领 · 我</span>' : (r.status === 'open' ? ' · <button class="lnk ok" data-act="fb-claim" data-id="' + h.esc(r.id) + '">认领</button>' : '')); } }
        ],
        /* v10b：kind chip 筛选在这里生效（ACTIONS['uo-fb-kind'] 写 state.filters.fbKind） */
        rows: (function () {
          var kf = (h.state.filters || {}).fbKind;
          return kf ? rows.filter(function (r) { return r.kind === kf; }) : rows;
        })(),
        noPaging: true
      }) + '</div>' + ruleBlock;
  }

  function segmentsBlock(p, h, fmt) {
    var segs = p.segments || [];
    /* 🔴 「新建分群」写的是 state.newObjs['user-ops-seg']（create-submit，见 V15_CREATE['user-ops-seg']），
       而本页此前只给 'user-ops'（策略）挂了 sessionNewBlock ⇒ 建完在列表里找不到、
       「N 个群」的计数也不变，用户以为没建成、再建一遍。
       照画像库的写法（本文件 personaPage：草稿既进顶部区块、也进正式的列表）补齐两块。 */
    var segDrafts = ((h.state && h.state.newObjs && h.state.newObjs['user-ops-seg']) || []);
    var draftRows = segDrafts.map(function (o) {
      var ex = (o.excl || []).length;
      return {
        id: o.id, name: o.name, isDraft: true,
        conds: '<span class="tag">' + h.esc(o.basis || '未填圈选依据') + '</span>' +
          '<span class="tag">排除 ' + ex + ' 项</span>',
        cover: null, share: null, actRate: null, trend: '', refPipes: 0
      };
    });
    if (!segs.length && !draftRows.length) return '';
    var rows = draftRows.concat(segs.map(function (s) {
      return {
        id: s.id, name: s.name,
        conds: s.conds.map(function (c) { return '<span class="tag">' + h.esc(c) + '</span>'; }).join(''),
        cover: s.cover, share: s.coverShare, actRate: s.actRate,
        trend: C.sparkline(s.trend, { color: s.actRate >= 0.8 ? '#1e8e3e' : '#2563eb' }),
        refPipes: s.refPipes
      };
    }));
    /* v20：「该打哪群人」排序从「覆盖 × 活跃」改为「价值 × 风险」——
       行业口径：最活跃的人群不缺你这条触达，优先级应给"会走的"（高流失风险）和"值钱的"（VIP/高客单），
       覆盖量大且活跃的人群（如价格敏感新客）反而应该少打扰。理由文本随群给出，可解释。 */
    var _best = segs.slice().sort(function (a, b) { return ((b.value || 0) * (b.risk || 0)) - ((a.value || 0) * (a.risk || 0)); }).slice(0, 2);
    var focusHtml = _best.length ? '<div class="card"><div class="card-h"><h3>该打哪群人</h3><span class="card-sub">按「价值 × 风险」排序 —— 高价值且濒流失优先，而非最活跃的人群</span></div><div class="ab-list">' +
      _best.map(function (s) { return '<button class="ab-item" data-act="seg-detail" data-id="' + h.esc(s.id) + '"><b>' + h.esc(s.name) + '</b><span>' + h.esc(s.why || '') + ' · ' + fmt.int(s.cover) + ' 人 · 活跃 ' + fmt.pct1(s.actRate) + '</span><span class="ab-go">据此选群</span></button>'; }).join('') + '</div></div>' : '';
    var newBlock = global.UI.sessionNewBlock(h.state, h, 'user-ops-seg', {
      title: '本会话新建的分群',
      cols: function (o) { return (o.basis || '—') + ' · 排除 ' + ((o.excl || []).length) + ' 项 · ' + (o.ownerName || ''); }
    });
    return focusHtml + newBlock + '<div class="card pad0"><div class="card-h pad"><h3>用户分群</h3>' +
      '<span class="card-sub">群间可重叠，占比不可相加 · ' + (segs.length + draftRows.length) + ' 个群 · 活跃率按近 7 日口径 · 新建分群已支持 R（近访问）/ F（采购频次）/ M（采购额）三维圈选</span>' +
      '<button class="btn-ghost sm" data-act="create-open" data-create="user-ops-seg">新建分群</button></div>' +
      h.table({
        columns: [
          /* 草稿态的行：点名字走 new-obj-open（本会话对象的统一详情页），而不是 seg-detail
             —— 后者按 id 去 pipes() 的分群表里找，新建的分群不在那里，会答「分群不存在」。 */
          { key: 'name', label: '分群', render: function (r) { return r.isDraft
            ? '<button class="lnk" data-act="new-obj-open" data-id="user-ops-seg|' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button> <span class="pill warn">草稿·未发布</span>'
            : '<button class="lnk" data-act="seg-detail" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'; } },
          { key: 'conds', label: '圈选条件', render: function (r) { return r.conds; } },
          { key: 'cover', label: '覆盖', align: 'right', render: function (r) { return r.isDraft
            ? '<span class="muted">待圈选</span>'
            : fmt.int(r.cover) + '<div class="td-sub">' + fmt.pct1(r.share) + '</div>'; } },
          { key: 'actRate', label: '活跃率', align: 'right', render: function (r) { return r.isDraft
            ? '<span class="muted">—</span>'
            : '<span class="' + (r.actRate >= 0.8 ? 'ok' : (r.actRate < 0.6 ? 'warn' : '')) + '">' + fmt.pct1(r.actRate) + '</span>'; } },
          { key: 'trend', label: '近 7 日活跃', render: function (r) { return r.isDraft ? '<span class="muted">—</span>' : r.trend; } },
          { key: 'refPipes', label: '被引用', align: 'right', render: function (r) { return r.refPipes ? r.refPipes + ' 条策略' : '<span class="muted">—</span>'; } },
          { key: 'act', label: '', render: function (r) { return r.isDraft
            ? '<span class="muted">草稿态 · 发布后才进人群池</span>'
            : '<button class="lnk" data-act="seg-detail" data-id="' + h.esc(r.id) + '">详情</button>'; } }
        ],
        rows: rows, noPaging: true
      }) + '</div>';
  }

  function useropsPage(cap, state, h, p) {
    var fmt = h.fmt;
    /* v15：策略的「停」此前是空动作 —— 而这是全中台唯一对真人用户产生副作用的链路，
       停不下来比什么都危险。改为：危险确认（影响面来自 stages 真实数字）→ 写会话内状态 → 界面回收。
       会话内状态与既有 uo-ratio 同法（内存态，刷新即还原），不引入新的持久化层。 */
    function uoOverride(id) { return (h.state.uoOps || {})[id] || null; }
    function uoStatus(it) { var o = uoOverride(it.id); return o ? o.action : it.status; }
    function uoStatusText(it) {
      var o = uoOverride(it.id);
      if (!o) return it.statusText;
      return { terminated: '已终止', paused: '已暂停', submitted: '已上线', full: '已转全量' }[o.action] || it.statusText;
    }
    function uoIsActive(it) { var s = uoStatus(it); return s === 'running' || s === 'gray' || s === 'full'; }
    /* v20：当前灰度比例 = 会话内改过用会话值，否则用 stages 上的结构化 grayRatio（此前只写在 detail 文本里，代码取不到） */
    function uoCur(it) {
      if (h.state.userops && h.state.userops[it.id] != null) return h.state.userops[it.id];
      var g = reachOf(it).grayRatio;
      return g == null ? null : g;
    }
    function uoOps(it) {
      var o = uoOverride(it.id);
      if (o) {
        return '<button class="btn-ghost" data-act="uo-undo" data-id="' + h.esc(it.id) + '" title="仅还原本会话的演示状态，不涉及真实投放">撤销（演示）</button>';
      }
      if (it.status === 'draft') return '<button class="btn-primary" data-act="uo-stop" data-id="' + h.esc(it.id) + '|submit">上线</button>';
      if (it.status === 'gray') {
        /* v20：按钮文案从「+10% 放量」改为「放量至 20%」—— 此前"+10%"实际是把比例调至 20%，语义误导；
           且按触达防护口径，从 10% 直接跳 50% 不叫逐步放量，这里给出完整档位并动态隐藏已过档位。 */
        var cur = uoCur(it);
        var btns = '';
        if (cur == null || cur < 0.2) btns += '<button class="btn-ghost" data-act="uo-ratio" data-id="' + h.esc(it.id) + '|0.2">放量至 20%</button>';
        if (cur == null || cur < 0.5) btns += '<button class="btn-ghost" data-act="uo-ratio" data-id="' + h.esc(it.id) + '|0.5">放量至 50%</button>';
        if (!btns) btns = '<span class="muted" style="font-size:12px;align-self:center">已达 50% —— 转全量需你确认</span>';
        return btns +
          '<button class="btn-danger sm" data-act="uo-stop" data-id="' + h.esc(it.id) + '|pause">暂停灰度</button>' +
          '<button class="btn-primary sm" data-act="uo-stop" data-id="' + h.esc(it.id) + '|full">转全量</button>';
      }
      return '<button class="btn-ghost" data-act="uo-scroll" data-id="' + h.esc(it.id) + '">查看效果</button>' +
        '<button class="btn-danger sm" data-act="uo-stop" data-id="' + h.esc(it.id) + '|stop">终止</button>' +
        '<button class="btn-ghost" data-act="uo-stop" data-id="' + h.esc(it.id) + '|review">复盘</button>';
    }
    function reachOf(i) { return i.stages[2] || {}; }

    var newBlock = global.UI.sessionNewBlock(state, h, 'user-ops', {
      title: '本会话新建的策略',
      cols: function (o) { return o.segName + ' · 灰度 ' + (o.rate || '-') + '% · ' + (o.ownerName || ''); }
    });

    return pageHead(h, cap, { action: 'create-open' }) + newBlock +
      '<div class="metrics">' + [
        { label: '在跑策略', value: String(p.items.filter(uoIsActive).length), sub: '共 ' + p.items.length + ' 条策略' },
        { label: '实际触达', value: fmt.compact(p.items.reduce(function (s, i) { return s + (reachOf(i).sent || 0); }, 0)), sub: '实验组（不含 holdout 对照组）' },
        { label: '对照(holdout)', value: fmt.compact(p.items.reduce(function (s, i) { return s + (reachOf(i).holdout || 0); }, 0)), sub: '用于证明提升非自然增长' },
        { label: '合规拦截待处理', value: String(queues().compliance.items.length), alert: queues().compliance.items.length > 0, sub: '未过合规的文案不允许投放' }
      ].map(h.metricCard).join('') + '</div>' +

      lifecycleBlock(p, h, fmt) +
      feedbackBlock(p, h, fmt) +
      segmentsBlock(p, h, fmt) +

      p.items.map(function (it) {
        var r = it.result;
        // 显著性不在数据里存值，这里按页面统一口径（双比例 z 检验）即时推导，任何数据改动下都自洽
        var grp = (r && r.sampleExp && r.sampleCtrl) ? Q.twoPropTest(Math.round(r.convExp * r.sampleExp), r.sampleExp, Math.round(r.convCtrl * r.sampleCtrl), r.sampleCtrl) : null;
        return '<div class="card pipe-card' + (uoOverride(it.id) ? ' uo-stopped' : '') + '"><div class="card-h">' +
          '<h3><button class="lnk" data-act="uo-detail" data-id="' + h.esc(it.id) + '" title="查看该策略的四个阶段明细与效果回收">' + h.esc(it.name) + '</button></h3>' +
          h.pill(uoOverride(it.id) ? (uoStatus(it) === 'paused' ? 'warn' : 'idle') : (it.status === 'running' ? 'ok' : (it.status === 'gray' ? 'info' : 'warn')), uoStatusText(it)) +
          '<span class="card-sub">' + h.esc(it.bizText) +
          ' · 目标分群：' + (it.segName ? h.esc(it.segName) : '实时圈选（未引用分群）') + '</span></div>' +
          stageFlow(it.stages, h) +
          (it.stages[0].excluded ? '<div class="excl-row"><i>圈人排除</i>' +
            '<span>全局频控（跨策略）' + fmt.int(it.stages[0].excluded.freq) + '</span>' +
            '<span>已退订 ' + fmt.int(it.stages[0].excluded.unsub) + '</span>' +
            '<span>黑名单 ' + fmt.int(it.stages[0].excluded.blacklist) + '</span>' +
            '<span>已在其他策略 ' + fmt.int(it.stages[0].excluded.inOther) + '</span>' +
            '<span class="muted">人群快照于 ' + fmt.rel(it.stages[0].snapshotAt) + ' 锁定，避免属性漂移导致归因失真</span></div>' : '') +
          (it.stages[0].health ? '<div class="excl-row"><i>健康分</i>' +
            '<span class="ok">绿 ' + fmt.int(it.stages[0].health.green) + '（常规提醒）</span>' +
            '<span class="warn">黄 ' + fmt.int(it.stages[0].health.yellow) + '（客户经理介入）</span>' +
            '<span class="bad">红 ' + fmt.int(it.stages[0].health.red) + '（优先人工介入）</span>' +
            '<span class="muted">圈人时点快照 —— 红/黄账户由客户成功跟进，触达只是兜底而非主力（B2B 续费口径）</span></div>' : '') +
          (r ? '<div class="result-box" id="uo-res-' + h.esc(it.id) + '">' +
            '<div class="rb-h"><b>效果回收</b><span>' + h.esc(r.window) + '</span></div>' +
            '<div class="rb-grid">' +
            '<div class="rb"><i>实验组转化</i><b>' + fmt.pct2(r.convExp) + '</b><span>n = ' + fmt.int(r.sampleExp) + '</span></div>' +
            '<div class="rb"><i>对照组转化</i><b>' + fmt.pct2(r.convCtrl) + '</b><span>n = ' + fmt.int(r.sampleCtrl) + '（holdout）</span></div>' +
            '<div class="rb"><i>提升幅度</i><b class="' + (r.lift > 0 ? 'ok' : 'bad') + '">' + (r.lift > 0 ? '+' : '') + fmt.pct1(r.lift) + '</b><span>相对提升</span></div>' +
            '<div class="rb ' + (grp && grp.significant ? 'ok' : 'warn') + '"><i>显著性</i><b>' + (grp ? (grp.significant ? '✓ 显著' : '⚠ 不显著') : '样本不足') + '</b><span>p = ' + (grp && grp.p != null ? grp.p.toFixed(4) : '—') + '</span></div>' +
            '</div>' +
            (grp == null ? '<div class="bt-note">样本量不足，暂不做显著性判定。</div>' : (!grp.significant ? '<div class="bt-warn">⚠ 差异未达显著（p = ' + grp.p.toFixed(4) + '）。' +
              '对照组仅 ' + fmt.int(r.sampleCtrl) + ' 样本，此时不应据 ' + fmt.pct1(r.lift) + ' 的提升做决策 —— 需继续观察或扩大样本。</div>' : '')) +
            '<div class="funnel">' + r.funnel.map(function (f2, i) {
              var w = (f2.value / r.funnel[0].value) * 100;
              var prev = i > 0 ? r.funnel[i - 1].value : null;
              return '<div class="fn"><span class="fn-n">' + h.esc(f2.name) + '</span>' +
                '<span class="fn-bar"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
                '<span class="fn-v">' + fmt.int(f2.value) + (prev ? ' <em>' + fmt.pct1(f2.value / prev) + '</em>' : '') + '</span></div>';
            }).join('') + '</div>' +
            '<div class="neg-row"><i>负向指标</i>' +
            '<span>退订率 ' + fmt.pct2(r.negative.unsubRate) +
              (r.negative.unsubRatePrev != null ?
                ' <em class="' + (r.negative.unsubRate > r.negative.unsubRatePrev ? 'warn' : 'ok') + '">' + (r.negative.unsubRate >= r.negative.unsubRatePrev ? '↑' : '↓') + ' 上期 ' + fmt.pct2(r.negative.unsubRatePrev) + '</em>' +
                '<span class="muted">告警线 ' + fmt.pct2(r.negative.unsubAlert || 0.008) + ' —— 退订率突增是频次或相关性出问题的第一信号</span>'
                : '<span class="muted">灰度首期，暂无上期对比</span>') + '</span>' +
            '<span>投诉率 ' + fmt.pct2(r.negative.complaintRate) + '</span>' +
            '<span>拉黑率 ' + fmt.pct2(r.negative.blockRate) + '</span>' +
            '<span class="muted">只看转化不看退订，策略会长期损害用户资产</span></div>' +
            '</div>' : '<div class="bt-note">效果回收尚未开始 —— 需先完成触达执行，归因窗口开启后才有数据。</div>') +
          (state.userops && state.userops[it.id] ? '<div class="bt-note">灰度比例已调至 ' + Math.round(state.userops[it.id] * 100) + '%</div>' : '') +
          '<div class="gray-acts uo-ops">' + uoOps(it) + '</div>' +
          '</div>';
      }).join('') +

      '<div class="card" data-static="1" title="只读说明：本卡是生效中的防护策略汇总（预算/冷却/实验纪律/用户偏好）。改动这些策略点击即生效；单条策略在「能力与权限 › 授权规则」里改。"><div class="card-h"><h3>触达防护</h3>' +
      '<span class="card-sub">全中台唯一对真人用户产生副作用的链路（短信 / Push / 站内信触达真实用户），防护最重</span></div>' +
      (p.guardrails ? '<div class="excl-row"><i>全局预算</i><span>' + h.esc(p.guardrails.monthlyCapText) + '</span></div>' +
      '<div class="excl-row"><i>冷却静默</i><span>' + h.esc(p.guardrails.cooling) + '</span>' +
        '<span>' + h.esc(p.guardrails.quietHours) + '</span>' +
        '<span class="muted">' + h.esc(p.guardrails.emergency) + '</span></div>' +
      '<div class="excl-row"><i>实验纪律</i><span>' + h.esc(p.guardrails.holdoutText) + '</span>' +
        '<span>' + h.esc(p.guardrails.rampText) + '</span>' +
        '<span class="muted">发送前确认页显示完整影响面（触达人数、预计成本、holdout 人数、合规结果），超阈值需你确认</span></div>' +
      '<div class="excl-row"><i>用户偏好</i><span>' + h.esc(p.guardrails.preference) + '</span>' +
        '<span class="muted">降频优先于退订 —— 退订是全有或全无，每强制一次选择就永久丢一个用户</span></div>'
      : '<div class="bt-note">触达防护配置加载失败。</div>') +
      '</div>' +
      h.metaBar({}, [
        { k: '显著性检验', v: '双比例 z 检验，α = 0.05；样本量不足时会明确标注「不显著」而非展示提升数字' },
        { k: '触达口径', v: 'holdout = 净人群（圈人 − 排除）的 5% 独立抽取；灰度按剔除 holdout 后的人数计 —— 实验组 + holdout 恒等于净人群，超发不可能发生' },
        { k: '生命周期口径', v: '存量分布：Σ各阶段 = 池规模；流失率为近 30 天口径，已流失不计；已流失进入 60–90 天赢回窗口' },
        { k: '分群口径', v: '覆盖 = 池规模 × 群占比；群间可重叠，占比不可相加；活跃率近 7 日；被引用数由策略的目标分群真实推导' },
        { k: '反馈口径', v: '近 7 天明细；待处理/趋势均由明细聚合，与列表逐条一致；影响人数为关联用户估算；「申请降频」未及时响应会升级为退订' }
      ]);
  };

  function evolutionPage(cap, state, h, p) {
    var fmt = h.fmt;
    return pageHead(h, cap, { action: 'create-open' }) +
      global.UI.sessionNewBlock(state, h, 'evo', { title: '本会话发起的进化任务' }) +
      '<div class="metrics">' + [
        { label: '进化任务', value: String(p.items.length), sub: '灰度中 ' + p.items.filter(function (i) { return i.status === 'gray'; }).length + ' · 评估中 ' + p.items.filter(function (i) { return i.status === 'evaluate'; }).length },
        { label: '本月采纳策略', value: '23', sub: '平均收益 +5.8%' },
        { label: '待确认转全量', value: String(p.items.filter(function (i) { return i.status === 'gray'; }).length), alert: true, sub: '绝不允许 AI 自动全量上线' }
      ].map(h.metricCard).join('') + '</div>' +

      p.items.map(function (it) {
        return '<div class="card pipe-card"><div class="card-h"><h3>' + h.esc(it.name) + '</h3>' +
          h.pill(it.status === 'gray' ? 'info' : (it.status === 'evaluate' ? 'warn' : 'idle'), it.statusText) +
          '<span class="card-sub"><button class="lnk" data-act="goto-agent" data-id="' + h.esc(it.agentId) + '">' + h.esc(it.agentName) + '</button> · ' +
          h.esc(it.triggerText) + ' · 创建于 ' + fmt.rel(it.createdAt) + '</span></div>' +
          stageFlow(it.stages, h) +

          (it.stages[0].clusters ? '<div class="sub-h">badcase 聚类结果（' + it.stages[0].count + ' 例 → ' + it.stages[0].clusters.length + ' 类）</div>' +
            '<div class="cluster-list">' + it.stages[0].clusters.map(function (c, i) {
              return '<div class="cl' + (c.name.indexOf('其他') >= 0 ? ' skip' : '') + '">' +
                '<span class="cl-n">' + c.cases + '</span>' +
                '<span class="cl-main"><b>' + h.esc(c.name) + '</b><span>根因假设：' + h.esc(c.rootCause) + '</span></span>' +
                '<span class="cl-pri">' + (c.name.indexOf('其他') >= 0 ? '暂不处理' : '优先级 ' + (i + 1)) + '</span></div>';
            }).join('') + '</div>' : '') +

          (it.stages[1].candidates ? '<div class="sub-h">候选策略（' + it.stages[1].candidates.filter(function (c) { return c.selected; }).length + ' / ' + it.stages[1].candidates.length + ' 已选入评估）</div>' +
            h.table({
              columns: [
                { key: 'type', label: '类型' },
                { key: 'target', label: '针对问题' },
                { key: 'diff', label: '具体改动', render: function (r) { return '<span class="diff-txt">' + h.esc(r.diff) + '</span>'; } },
                { key: 'expect', label: '预期效果' },
                { key: 'risk', label: '风险' },
                { key: 'selected', label: '入选', render: function (r) { return r.selected ? '<span class="ok">✓ 已选</span>' : '<span class="muted">未选</span>'; } }
              ],
              rows: it.stages[1].candidates, noPaging: true
            }) + '<div class="bt-note">每个候选都给出具体改动 diff，而不是「优化提示词」这类空话 —— 你要能看懂改了什么。</div>' : '') +

          (it.stages[2].result ? (function () {
            var r = it.stages[2].result;
            return '<div class="sub-h">离线评估结果（' + it.stages[2].count + ' 样本）</div>' +
              '<div class="dim-cmp">' + [
                { name: '回归通过率', base: r.baseline.pass, cand: r.candidate.pass, better: true, fmt: 'pct1' },
                { name: '准确性', base: r.baseline.accuracy, cand: r.candidate.accuracy, better: true, fmt: 'pct1' },
                { name: 'P99 时延', base: r.baseline.latency, cand: r.candidate.latency, better: false, fmt: 'dur' },
                { name: '单次成本', base: r.baseline.cost, cand: r.candidate.cost, better: false, fmt: 'money4' }
              ].map(function (d) {
                var f2 = fmt[d.fmt];
                var diff = d.fmt === 'pct1' ? (d.cand - d.base) : ((d.cand - d.base) / d.base);
                var txt = d.fmt === 'pct1' ? ((diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + 'pp') : ((diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%');
                return '<div class="dim-row"><span class="dim-name">' + h.esc(d.name) + '</span>' +
                  '<span class="dim-vals"><b>' + f2(d.base) + '</b> → <b class="' + (d.better ? 'ok' : 'bad') + '">' + f2(d.cand) + '</b></span>' +
                  '<span class="dim-diff ' + (d.better ? 'ok' : 'bad') + '">' + txt + '</span></div>';
              }).join('') + '</div>' +
              '<div class="bt-warn">⚠ 副作用检查：' + h.esc(r.sideEffect.regressedNote) + '</div>' +
              '<div class="bt-note">结论：' + h.esc(r.verdict) + '。副作用检查是最容易被忽略但最致命的一步 —— 修好 A 场景搞坏 B 场景。</div>';
          })() : (it.stages[2].state === 'active' ? '<div class="bt-note">离线评估进行中：' + h.esc(it.stages[2].detail) + '</div>' : '')) +

          (it.stages[3].gray ? '<div class="sub-h">灰度状态</div>' +
            '<div class="gray-rules">当前灰度 ' + Math.round(it.stages[3].gray.ratio * 100) + '%，已运行 ' + it.stages[3].gray.days + ' 天。' +
            '自动回滚条件：' + h.esc(it.stages[3].gray.autoRollback) + '。（注：自动回滚为示例条件，未接入自动执行）' +
            '转全量必须由你确认，确认页自动附灰度期数据；回滚后不会自动重试，需确认原因。</div>' +
            ((state.evoOps && state.evoOps[it.id]) ?
              '<div class="bt-note">本会话已处置：' + ({ rollback: '已回滚（灰度停止）', full: '已转全量（承接 100% 流量）' }[state.evoOps[it.id]] || '—') +
              '　<button class="btn-ghost sm" data-act="evo-undo" data-id="' + h.esc(it.id) + '">撤销（演示）</button></div>'
              : '') +
            '<div class="gray-acts"><button class="btn-ghost" data-act="evo-gray" data-id="' + h.esc(it.agentId || '') + '">灰度对比</button>' +
            '<button class="btn-danger" data-act="evo-decide" data-id="' + h.esc(it.id) + '|rollback">回滚</button>' +
            '<button class="btn-primary" data-act="evo-decide" data-id="' + h.esc(it.id) + '|full">转全量</button></div>' : '') +
          '</div>';
      }).join('') +

      '<div class="card" data-static="1" title="只读说明：本块是方法论声明（AI 提候选、人做决定），不含数据对象，因此没有可下钻目标。"><div class="card-h"><h3>设计原则</h3></div>' +
      '<div class="bt-note">这是最能体现「AI 中台」差异化的页面，也是最需要防过度自动化的页面。核心原则：' +
      '<b>AI 提候选，人做决定，每一步可解释、可回滚。</b>' +
      '每条被采纳的策略会长期跟踪实际效果（30 天后是否仍有效），失效的自动提示复核。</div></div>' +
      h.metaBar({}, [{ k: '数据来源', v: '评估结果中的时延与成本口径与真实 trace 聚合一致' }]);
  };

  /* SECTION: r-persona-page
   * 企业用户画像库 —— 任务视角：用户点开是想知道「库里有哪些画像、哪些过期了、谁在用」。
   * 聚焦：标签关注度（口径 = 画像数 + 被引用）+ 需更新置顶与登记更新 + 列表（含本会话草稿）。
   * 口径铁律：数字只做「能解释的聚合」——不再把画像的覆盖企业数当标签的人数规模。
   */
  RENDERERS.personaPage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets().persona;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';
    var f = state.filters || {};
    var ttl = t.ttlDays || 30;

    /* 本会话新建的画像并入列表。此前它只出现在顶部区块：不进表、不计指标、不参与标签聚合，
       用户建完在列表里找不到，会以为没建成。
       注意：新字段（kind/role/kindText/entsScope）必须给默认值，否则 undefined 会漏到页面上
       （02-verify-renderers 会扫 "undefined" 字面量）。 */
    var drafts = global.UI.sessionRows(state, 'persona').map(function (o) {
      var n = Number(o.ents);
      var isRole = o.kind === '角色画像' || o.kind === 'role';
      return {
        id: o.id, name: o.name, industry: o.industry || '未分类',
        kind: isRole ? 'role' : 'icp', role: isRole ? (o.role || '未标角色') : null,
        kindKey: isRole ? 'info' : 'idle',
        kindText: isRole ? ('角色画像 · ' + (o.role || '未标角色')) : 'ICP · 企业类型',
        ents: isFinite(n) && n > 0 ? n : null,
        /* 口径真源见 data.js:123/231 —— 一家企业只属一个行业、画像间席位不重叠，
         所以各画像覆盖数相加就等于按 USCC 去重后的合计。不必再挂示例值/未去重这类限定。 */
      entsScope: isFinite(n) && n > 0 ? '按 USCC 去重' : '待圈选计算',
        tags: o.tags || [],
        refCount: 0, owner: o.ownerName || o.owner || '—',
        updated: 0, ageDays: 0, overdueDays: 0,
        status: 'idle', statusText: '草稿·未发布', heatKey: 'idle', heatText: '未被引用', isDraft: true
      };
    });
    var all = drafts.concat(t.rows.map(function (r) { return Object.assign({}, r); }));
    /* 本会话登记了更新的画像：状态转「更新中」，不再算进「需更新」计数
       （弹窗里承诺过"计数减 1"，这里就得做到）。 */
    var refreshed = state.personaRefresh || {};
    all.forEach(function (r) {
      if (!refreshed[r.id]) return;
      r.status = 'idle'; r.statusText = '更新中'; r.refreshing = true; r.refreshNote = refreshed[r.id];
    });
    /* 🔴 详情页「停用画像」（v10-detail-asset.js 的 persona-disable）写的是 state.personaDisabled，
       本页此前**从不读它** ⇒ 详情停用成功、列表状态列与卡片 pill 纹丝不动，用户以为没停用。
       这里套同一份覆盖（状态列 + 网格卡片 pill + 画像定义卡副标题里的数字，三处可见）。
       停用 = 已移出检索池，「登记更新」对它没有意义 ⇒ 从「需更新」待办与计数里排除，
       免得页面一边说它停了、一边还催人去更新它。 */
    var _pd = (state && state.personaDisabled) || {};
    var disabledN = 0;
    all.forEach(function (r) {
      if (!_pd[r.id]) return;
      disabledN++;
      r.disabled = true; r.refreshing = false; r.refreshNote = null;
      r.status = 'idle'; r.statusText = '已停用';
    });

    var industries = [];
    all.forEach(function (r) { if (industries.indexOf(r.industry) < 0) industries.push(r.industry); });

    var rows = all.filter(function (r) {
      if (f.personaIndustry && r.industry !== f.personaIndustry) return false;
      if (f.personaStale === '1' && r.status !== 'warn') return false;
      return true;
    });
    var stale = rows.filter(function (r) { return r.status === 'warn'; });
    var refreshing = rows.filter(function (r) { return r.refreshing; });

    /* 标签关注度：口径 = 该标签下的画像数 + 被引用次数（主数字 = 被引用次数，与排序键一致）。
       覆盖企业只给「合计」—— 一家企业只属一个行业、画像间席位不重叠，所以合计就是去重后的数，
       此前把画像的覆盖企业数直接当标签的人数规模，等于把同一个数复制三份。 */
    var tagAgg = {};
    rows.forEach(function (r) {
      (r.tags || []).forEach(function (g) {
        if (!tagAgg[g]) tagAgg[g] = { name: g, n: 0, refs: 0, entSum: 0, topId: null, topRefs: -1, topName: '' };
        var a = tagAgg[g];
        a.n++; a.refs += r.refCount; a.entSum += r.ents;
        if (r.refCount > a.topRefs) { a.topRefs = r.refCount; a.topId = r.id; a.topName = r.name; }
      });
    });
    var tagTop = Object.keys(tagAgg).map(function (k) { return tagAgg[k]; })
      .sort(function (a, b) { return b.refs - a.refs || b.n - a.n; });
    var tagTotal = tagTop.length;
    tagTop = tagTop.slice(0, 12);   // 之前只取 6：5 个画像的 17 个标签里，覆盖 96 家的整组标签直接被砍掉
    var maxRefs = tagTop.length ? Math.max.apply(null, tagTop.map(function (x) { return x.refs; })) : 1;

    var icpN = all.filter(function (r) { return r.kind !== 'role'; }).length;
    var roleN = all.length - icpN;
    var refSum = all.reduce(function (s, r) { return s + r.refCount; }, 0);

    var cols = [
      { key: 'kind', label: '类型', render: function (r) { return h.pill(r.kindKey || 'idle', r.kindText || 'ICP · 企业类型'); } },
      { key: 'name', label: '画像名称', sortable: true, render: function (r) { return r.isDraft
        ? '<button class="lnk" data-act="new-obj-open" data-id="persona|' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'
        : '<button class="lnk" data-act="persona-detail" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'; } },
      { key: 'industry', label: '行业', render: function (r) { return h.esc(r.industry); } },
      /* 覆盖企业：字段保留（评审：删掉会让新画像"—"与老数据同屏、两套口径），
         但每格都带来源口径，且不再参与任何"人数规模"表述。 */
      { key: 'ents', label: '覆盖企业', sortable: true, align: 'right', render: function (r) { return h.esc(fmt.int(r.ents)) + '<div class="td-sub">' + h.esc(r.entsScope || '') + '</div>'; } },
      { key: 'tags', label: '核心标签', render: function (r) { return (r.tags || []).map(function (x) { return '<span class="tag">' + h.esc(x) + '</span>'; }).join('') || '<span class="muted">未打标签</span>'; } },
      { key: 'refCount', label: '被引用', sortable: true, align: 'right', render: function (r) { return '<button class="lnk" data-act="persona-refs" data-id="' + h.esc(r.id) + '">' + h.esc(fmt.int(r.refCount)) + '</button><div class="td-sub">' + h.esc(r.heatText) + '</div>'; } },
      /* 2026-10-28：负责人列已删 —— 5 行画像以前全是「—」，整列只有破折号。 */
      { key: 'updated', label: '更新时间', sortable: true, render: function (r) { return h.esc(fmt.rel(r.updated)) + (r.overdueDays > 0 ? '<div class="td-sub">超期 ' + r.overdueDays + ' 天</div>' : ''); } },
      { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } }
    ];

    var staleHtml = '';
    if (stale.length || refreshing.length) staleHtml = '<div class="card"><div class="card-h"><h3>需更新画像</h3>' +
      '<span class="card-sub">属性会漂移。超过 ' + ttl + ' 天未更新的画像不该继续作为投放依据</span></div>' +
      '<div class="ab-list">' + stale.map(function (r) {
        return '<button class="ab-item" data-act="persona-refresh" data-id="' + h.esc(r.id) + '">' +
          '<b>' + h.esc(r.name) + '</b><span>' + fmt.int(r.ents) + ' 家企业</span>' +
          '<span class="ab-why">' + fmt.rel(r.updated) + '未更新 · 已超期 ' + r.overdueDays + ' 天</span>' +
          '<span class="ab-go">登记更新 →</span></button>';
      }).join('') + refreshing.map(function (r) {
        return '<button class="ab-item" data-act="persona-detail" data-id="' + h.esc(r.id) + '">' +
          '<b>' + h.esc(r.name) + '</b><span>' + fmt.int(r.ents) + ' 家企业</span>' +
          '<span class="ab-why">' + h.esc(r.refreshNote.reason) + ' · 预计' + h.esc(r.refreshNote.eta) + ' · ' + h.esc(r.refreshNote.by) + '</span>' +
          '<span class="ab-go ok">更新中（已登记）· 撤销</span></button>';
      }).join('') + '</div>' +
      '<div class="bt-note">点一行即登记更新；要改画像内容，点「全部画像」里的画像名。</div></div>';

    var tagHtml = '<div class="card"><div class="card-h"><h3>标签关注度 · Top ' + tagTop.length + '</h3>' +
      '<span class="card-sub">共 ' + tagTotal + ' 个标签 · 大字 = 被引用次数（也是排序键）· 点标签看该标签下被引用最多的画像</span></div>' +
      '<div class="ins-grid">' + tagTop.map(function (g) {
        return '<div class="ins"' + (g.topId ? ' data-act="persona-detail" data-id="' + h.esc(g.topId) + '" title="点开代表画像：' + h.esc(g.topName) + (g.n > 1 ? '（该标签共 ' + g.n + ' 个画像）' : '') + '"' : '') + '>' +
          '<i>' + h.esc(g.name) + '</i><b>' + fmt.int(g.refs) + '</b>' +
          '<span>' + g.n + ' 个画像 · 覆盖企业合计 ' + fmt.int(g.entSum) + '</span>' +
          (g.n > 1 ? '<span>代表：' + h.esc(g.topName) + '</span>' : '') +
          '<span class="ins-bar"><i style="width:' + (g.refs / maxRefs * 100).toFixed(0) + '%"></i></span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">数字全部由画像明细实时聚合：被引用次数 = 该标签下所有画像的被引用之和。' +
      '<b>一个画像通常挂好几个标签，所以相邻几张卡的数字会一样 —— 那是同一个画像的引用次数，不是多批人。</b>' +
      '「覆盖企业合计」是各画像覆盖数相加，同一家企业可能落在多个画像里，<b>未做去重</b>，只能当量级参考，不是企业总数。' +
      '标签只是标签，<b>不等于一个可投放的客群</b> —— 圈选投放请用「用户运营」里的分群。</div></div>';

    /* 画像区的视图：默认**网格**（卡片管理，和知识库一致），列表用于按列排序核对 */
    var pview = (state && state.personaView) === 'list' ? 'list' : 'grid';
    var filterHtml = '<div class="filter-row">' +
      '<label>行业<select data-f="personaIndustry"><option value="">全部</option>' + industries.map(function (x) {
        return '<option value="' + h.esc(x) + '"' + (f.personaIndustry === x ? ' selected' : '') + '>' + h.esc(x) + '</option>';
      }).join('') + '</select></label>' +
      '<label>状态<select data-f="personaStale"><option value="">全部</option>' +
      '<option value="1"' + (f.personaStale === '1' ? ' selected' : '') + '>仅待更新</option></select></label>' +
      '<span class="muted">新鲜度口径：超过 ' + ttl + ' 天未更新 = 待更新（列表与详情同一口径）</span>' +
      '</div>';

    return pageHead(h, cap, {
      side: '<span class="side-note" data-tip="本页为配置态画像数据（维度表）；新鲜度按 ' + ttl + ' 天有效期判定，' +
        '运行效果请看「可观测与评估」或「成本与调用归因」。">配置态数据 · 有效期 ' + ttl + ' 天</span>',
      action: 'create-open'
    }) + global.UI.sessionNewBlock(state, h, 'persona', { title: '本会话新建的画像' }) +
      '<div class="metrics">' + [
        { label: '画像定义', value: String(all.length), sub: 'ICP ' + icpN + ' / 角色画像 ' + roleN + (drafts.length ? ' · 含草稿 ' + drafts.length + ' 条' : '') + (disabledN ? ' · 已停用 ' + disabledN + ' 条' : ''), definition: 'ICP = 描述「哪类企业」；角色画像 = 描述「哪个岗位的人」。归类为人工判定，规则见页面说明' },
        { label: '待更新', value: String(stale.length), alert: stale.length > 0, sub: '超过 ' + ttl + ' 天未更新' },
        { label: '被引用合计', value: fmt.int(refSum), sub: '被 Agent / 策略 / 流程引用' }
      ].map(h.metricCard).join('') + '</div>' +
      filterHtml + staleHtml + tagHtml +
      '<div class="card pad0"><div class="card-h pad"><h3>全部画像</h3>' +
      '<span class="card-sub">' + rows.length + ' 条' + (rows.length !== all.length ? '（已筛选，共 ' + all.length + ' 条）' : '') + ' · ' + t.kindHint + '</span>' +
      /* 与知识库同一套「网格 / 列表」：网格为主（一眼看清有哪些画像），列表给排序核对。
         图标与色相按**行业**给 —— 同一批行业在详情页早就有 icon+tone，列表页不该只有黑字。 */
      '<div class="view-sw kb-layout" role="group" aria-label="查看方式">' +
      '<button class="vs-btn' + (pview === 'grid' ? ' on' : '') + '" data-act="persona-view" data-id="grid"' +
      ' aria-pressed="' + (pview === 'grid') + '" title="网格：像卡片一样管">网格</button>' +
      '<button class="vs-btn' + (pview === 'list' ? ' on' : '') + '" data-act="persona-view" data-id="list"' +
      ' aria-pressed="' + (pview === 'list') + '" title="列表：按列排序、密集核对">列表</button>' +
      '</div></div>' +
      (pview === 'list'
        ? h.table({ columns: cols, rows: rows, sortBy: state.sortKey, sortDir: state.sortDir, page: state.page || 1, pageSize: 20, emptyTitle: '没有符合条件的画像', emptySub: '换个筛选条件，或点右上角「新建画像」' })
        : (rows.length
          ? '<div class="kb-items kb-items-pf">' + rows.map(function (r) {
            var ind = r.industry || '其他';
            var tone = (h.app && h.app.firmIndustryTone) ? h.app.firmIndustryTone(ind) : 'slate';
            var ico = (h.app && h.app.firmIndustryIcon) ? h.app.firmIndustryIcon(ind) : 'building';
            var tags = (r.tags || []).slice(0, 4);
            var st = [r.status || 'idle', r.statusText || '—'];
            return '<div class="kb-item kb-pf" role="button" tabindex="0"' +
              ' data-act="persona-detail" data-id="' + h.esc(r.id) + '" aria-label="' + h.esc(r.name) + '，' + h.esc(ind) + '，覆盖 ' + h.fmt.int(r.ents) + ' 家">' +
              '<span class="kb-ico h-' + tone + '">' + h.icon(ico, 34) + '</span>' +
              '<span class="kb-nm">' + h.esc(r.name) + '</span>' +
              '<span class="kb-mt">' + h.esc(ind) + ' · 覆盖 ' + h.fmt.int(r.ents) + ' 家</span>' +
              (tags.length ? '<span class="kb-pf-tags">' + tags.map(function (x) {
                return '<span class="tag-mini">' + h.esc(x) + '</span>';
              }).join('') + '</span>' : '') +
              '<span class="kb-mt">被引用 ' + h.fmt.int(r.refCount) + ' · ' + h.esc(h.fmt.rel(r.updated)) + '</span>' +
              '<span class="pill ' + st[0] + '">' + h.esc(st[1]) + '</span>' +
              '</div>';
          }).join('') + '</div>'
          : h.emptyFor('没有符合条件的画像', '换个筛选条件，或点右上角「新建画像」', 'user'))
      ) + '</div>' +
      h.metaBar({}, [
        { k: '数据性质', v: '画像为配置态维度数据；新鲜度与引用分档由画像定义派生，运行效果见各 Agent 监控' },
        { k: '覆盖企业口径', v: '以统一社会信用代码（USCC）去重。一家企业只属一个行业、画像间的席位不重叠，' +
            '因此各画像覆盖数相加 = 去重后的合计（与详情页同一口径）' },
        { k: '判定与新鲜度', v: 'ICP 描述「哪类企业」，角色画像描述「哪个岗位的人」；超过 30 天未更新即「待更新」' },
        { k: '边界', v: '本页只描述企业客户（B2B）。C 端两套不在本页：用户模拟页的虚拟人设 persona、全局用户池的个人样本' }
      ]);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION: v27b-persona-overview-shape（丙 · 企业画像详情 › 概览形态落地）
     ══════════════════════════════════════════════════════════════════════════
     改前实测（同一份数据源）：162,297 字节 / 8 卡 / 10 KPI / 表×1（7 列 × 97 行 = 96 家）·
       112 个按钮（firm-open×96 + persona-firm-q×13 + 3）· 色标 241 处 ·
       「停用画像」落在整屏最后一行 —— 要滚过 96 家企业才够得着。

     形态（照《逐屏形态-详情页.html》第 8 屏右栏）：
       ① 概览只留**该画像的属性**（覆盖 96 / 被引用 7 / 圈选条件 / 分布）与**生命周期动作**；
       ② 「编辑画像内容」「停用画像」提到**页头** —— 它们是这屏唯一的两个写操作；
       ③ 企业清单先给 **5 家看形状** + 一个「看全部 96 家 →」出口（在当前页展开全部，仍可达）；
       ④ USCC 下沉到企业卡片（原来每行都重复 18 位数字）；
       ⑤ 分布带：规模 3 枚 + 省份 8 枚 + 标签 4 枚 chip 收成**一条分布带 + 一行过滤条**。

     ⚠ 文件所有权：personaDetail 的**本体**在 v10-detail-asset.js（本轮不许改），
       所以这里只做包装 —— 与 v23 包装 agentDetail 同一套做法（v23-exp-agent-link.js:284）。
       本文件在 v10-detail-asset.js 之后加载（主 HTML 的 script 顺序），包装一定生效。
     ⚠ 本段只接 personaDetail 的 overview 分支；tags / refs 原样透传；
       不碰 renderers2.js 其它任何区段（乙改审批/成本，甲在做值替换）。
     ══════════════════════════════════════════════════════════════════════════ */
  (function () {
    /* ⚠ 装配顺序陷阱（实测踩过两次，这一步是本段最容易做错的地方）：
       personaDetail 的**本体**在 v10-detail-asset.js 里赋值，而本文件在它**之前**加载。
       实测时序（_walk-3/p9.js 逐步装配）：
         renderers2.js 之后 → 装上的东西
         v10-detail-asset.js 之后 → **被 R.personaDetail = function... 直接覆盖掉**（不报错、不提示）
       所以这里**不**直接包装，只把"按当前本体包装"这个动作挂到 global.V27B.personaShape()。
       正式安装点在本文件之后加载的 v27-agent-session.js（见那里的注册段）——
       与"两个 metaBar 合一"共用同一个安装时机。 */
    global.V27B = global.V27B || {};
    global.V27B.personaShape = function () {
      var raw = RENDERERS.personaDetail;
      if (typeof raw !== 'function' || raw.__v27bPersona) return false;
      installPersonaShape(raw);
      return true;
    };

    function installPersonaShape(rawPersonaDetail) {
    /* ⚠ 会话态读法：本包装器拿到的 `state` 与 `h.state` 在真实页面里是**同一个对象**
       （app.js 把 APP_SHELL.state 直接传给渲染器），但走查脚本是"自造 state 直调渲染器"，
       两条路会分叉 —— 实测：探针把 personaFirmsOpen 写在 state 上、渲染器读 h.state，展开不起作用，
       于是"看全部 96 家"这条出口在质检里变成假出口。
       所以统一走这个读法：**先看传进来的 state，再看 h.state** —— 两条路都读得到，
       真实页面里两者恒等，不会出现两份真相。 */
    function S(state, h, key) {
      /* 支持 'filters.firmQ' 这种两段路径；undefined 也算"这条路上没给"，
         于是退到另一条路去取。真实页面里两条路恒等，取哪条都一样。 */
      var parts = String(key).split('.');
      function dig(root) {
        var v = root;
        for (var i = 0; i < parts.length; i++) {
          if (v == null) return undefined;
          v = v[parts[i]];
        }
        return v;
      }
      var a = dig(state);
      if (a !== undefined) return a;
      return dig(h && h.state);
    }
    /* 企业行：概览预览与全量清单共用一个渲染器 —— 两处各画一套的话，列名与色标一定会漂。 */
    function firmCells(f, h, fmt) {
      var lvl = f.scale === '大型' ? 'ok' : (f.scale === '中型' ? 'info' : 'idle');
      return [
        '<button class="lnk" data-act="firm-open" data-id="' + h.esc(f.id) + '"><b>' + h.esc(f.name) + '</b></button>',
        h.esc(f.region),
        '<span class="pill ' + lvl + '">' + h.esc(f.scale) + '</span>',
        fmt.int(f.annualPurchase) + ' 万',
        '<b class="' + (f.score >= 80 ? 'ok' : (f.score >= 60 ? '' : 'muted')) + '">' + f.score + '</b>',
        (f.tags || []).map(function (x) { return '<span class="tag-mini">' + h.esc(x) + '</span>'; }).join(' ') ||
          '<span class="muted">—</span>'
      ];
    }
    function tally(firms, key) {
      var m = {};
      firms.forEach(function (f) { m[f[key]] = (m[f[key]] || 0) + 1; });
      return Object.keys(m).map(function (k) { return { k: k, n: m[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
    }
    function tagTally(firms) {
      var m = {};
      firms.forEach(function (f) { (f.tags || []).forEach(function (x) { m[x] = (m[x] || 0) + 1; }); });
      return Object.keys(m).map(function (k) { return { k: k, n: m[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
    }
    /* 分布带：一条**堆叠面积** + 一行可点的过滤条。
       为什么不是 13 枚 chip：13 枚同形 chip 排成三行，既看不出比例，又把"这批线索像不像我要的"
       拆成 13 次点击。面积给比例，下面的过滤条给入口 —— 两者一起看才有判断。 */
    function distStrip(firms, h, fmt, fq) {
      var TONES = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];
      function stack(key) {
        var arr = tally(firms, key);
        return '<span style="display:flex;gap:2px;height:14px;margin:5px 0 3px">' + arr.slice(0, 6).map(function (x, i) {
          return '<span title="' + h.esc(x.k + ' ' + x.n + ' 家') + '" style="flex:' + x.n +
            ';background:' + TONES[i % TONES.length] + ';border-radius:4px"></span>';
        }).join('') + '</span>';
      }
      /* 过滤条：每一片都是**真筛选** —— 写 state.filters.firmQ，企业清单读同一个键
         （与本文件上方 v31 的 persona-firm-q 完全同一条路径，不是装饰）。 */
      function filterRow(key, label, limit) {
        var all = tally(firms, key);
        var arr = all, aggN = 0;
        if (limit && all.length > limit) {
          aggN = all.slice(limit).reduce(function (s, x) { return s + x.n; }, 0);
          arr = all.slice(0, limit);
        }
        return '<div class="bar-row" style="margin-bottom:5px"><span title="' + h.esc(label) + '">' + h.esc(label) + '</span>' +
          '<span style="display:flex;gap:4px;flex-wrap:wrap;flex:1 1 auto">' + arr.map(function (x) {
            var on = String(fq || '').trim() === x.k;
            return '<button class="tag-mini' + (on ? ' on' : '') + '" data-act="persona-firm-q" data-id="' + h.esc(x.k) + '"' +
              ' title="只看「' + h.esc(x.k) + '」的企业">' + h.esc(x.k) + ' ' + fmt.int(x.n) + '</button>';
          }).join('') +
          (aggN ? '<span class="tag-mini muted" title="聚合行没有对应企业，不挂筛选">其他 ' + (all.length - limit) + ' 项 ' + fmt.int(aggN) + '</span>' : '') +
          '</span></div>';
      }
      var sc = tally(firms, 'scale');
      return '<div class="card"><div class="card-h"><h3>命中构成 · 这 ' + fmt.int(firms.length) + ' 家是怎么分布出来的</h3>' +
        '<span class="card-sub">' + (fq ? '当前只看「' + h.esc(fq) + '」' : '点下面的任一片即过滤企业清单') + '</span>' +
        (fq ? '<button class="btn-ghost sm" data-act="persona-firm-q" data-id="">清除筛选</button>' : '') +
        '</div>' +
        '<div class="kv">' +
        '<div><i>按规模</i><b>' + stack('scale') +
        '<div class="td-sub">' + sc.map(function (x) { return h.esc(x.k) + ' ' + x.n; }).join(' · ') +
        '　<span class="muted">（大型偏少、小型偏多是这批线索的特征）</span></div></b></div>' +
        '<div><i>按省份</i><b>' + stack('region') +
        '<div class="td-sub">' + tally(firms, 'region').length + ' 个注册地，Top 6 见下方过滤条</div></b></div>' +
        '</div>' +
        '<div style="padding:8px 0 0">' + filterRow('scale', '规模', 0) + filterRow('region', '省份', 6) +
        filterRow('tags', '标签', 0) + '</div></div>';
    }
    /* 企业清单：概览先给 5 家看形状；「看全部 96 家 →」在**同一页**展开全量（带搜索，
       走同一个 state.filters.firmQ）—— 出口不是另一个屏，也没有另起一套筛选口径。 */
    function firmsCard(firms, h, fmt, fq, state) {
      var q = String(fq || '').trim().toLowerCase();
      var view = q ? firms.filter(function (f) {
        return (f.name + ' ' + f.region + ' ' + f.scale + ' ' + (f.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
      }) : firms;
      var open = !!S(state, h, 'personaFirmsOpen') || !!q;
      var shown = open ? view : view.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
      var HEAD = ['企业', '注册地', '规模', '年采购额', '意向分', '命中标签'];
      return '<div class="card pad0"><div class="card-h pad"><h3>企业清单 · ' +
        (open ? fmt.int(view.length) + ' / ' + fmt.int(firms.length) + ' 家' : '先看 5 家') + '</h3>' +
        '<span class="card-sub">' + (open
          ? '点企业名打开企业卡片（USCC · 联系人角色 · 被哪些画像覆盖都在卡片里）'
          : '按意向分取的 5 家 · 完整 ' + fmt.int(firms.length) + ' 家点右侧「看全部」') + '</span>' +
        (open
          ? '<button class="btn-ghost sm" data-act="persona-firms-toggle" data-id="0">收起，只看 5 家</button>'
          : '<button class="btn-ghost sm" data-act="persona-firms-toggle" data-id="1">看全部 ' + fmt.int(firms.length) + ' 家 →</button>') +
        '</div>' +
        '<div style="padding:0 16px 10px">' +
        (open ? '<input data-f="firmQ" placeholder="搜企业名 / 省份 / 规模 / 标签，回车筛选" value="' + h.esc(fq || '') +
          '" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font:inherit">' : '') +
        '</div>' +
        '<table class="bt" style="margin:0"><thead><tr>' + HEAD.map(function (x, i) {
          return '<th' + (i === 3 || i === 4 ? ' class="ta-r"' : '') + '>' + x + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        shown.map(function (f) {
          return '<tr>' + firmCells(f, h, fmt).map(function (c, i) {
            return '<td' + (i === 3 || i === 4 ? ' class="ta-r"' : '') + '>' + c + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        (open ? '' : '<div style="font-size:12px;color:var(--faint);padding:8px 16px 4px">' +
          '看着 5 家就够判断「这批线索像不像我要的」。全部 ' + fmt.int(firms.length) +
          ' 家属于「看名单」这个独立任务，不在概览里全铺 —— 点上面「看全部」在当前页展开，不跳屏。</div>') +
        '</div>';
    }
    /* 概览首条：这个画像"是什么、覆盖了谁、下一步该干嘛"。
       改前第一眼是 4 张数字卡 + 一张属性卡，然后立刻是 97 行表格 ——
       「96 家」与"看名单"之间没有过渡，也没有出口。 */
    function ovStrip(s, firms, h, fmt, isDisabled) {
      var scale = {};
      firms.forEach(function (f) { scale[f.scale] = (scale[f.scale] || 0) + 1; });
      var regions = {};
      firms.forEach(function (f) { regions[f.region] = 1; });
      var avg = firms.length ? Math.round(firms.reduce(function (a, f) { return a + f.score; }, 0) / firms.length) : 0;
      var bk = [['大型', scale['大型'] || 0], ['中型', scale['中型'] || 0], ['小型', scale['小型'] || 0]]
        .filter(function (x) { return x[1]; })
        .map(function (x) { return x[1] + ' 家' + x[0]; }).join('、');
      return '<div class="ov-persona-strip" style="border:1px solid #CFE0FF;' +
        'border-radius:8px;background:#fff;padding:10px 12px;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        '<div style="min-width:0;flex:1 1 280px">' +
        '<div style="font-size:13px"><b>覆盖企业 ' + fmt.int(firms.length) + ' 家</b> · 平均意向分 ' + avg +
        ' · 被引用 ' + fmt.int(s.refCount) + ' 处' + (isDisabled ? '　<span class="pill idle">已停用</span>' : '') + '</div>' +
        '<div style="font-size:11.5px;color:var(--faint);padding-top:3px">圈选条件 ' + h.esc(s.rulesDerived || '—') +
        ' · 覆盖 ' + Object.keys(regions).length + ' 个省份' + (bk ? ' · 其中 ' + bk : '') + '</div>' +
        '</div>' +
        '<button class="btn-ghost sm" data-act="persona-firms-toggle" data-id="1">看全部 ' + fmt.int(firms.length) + ' 家 →</button>' +
        '</div>';
    }
    /* 生命周期说明：动作已提到页头，但「停用意味着什么」必须留下 ——
       改前这些字与动作写在页尾同一张卡里。现在说明留这儿（只读），动作在页头。
       按门禁要求显式声明 data-static 并写理由。 */
    function lifecycleCard(s, h, fmt, isDisabled) {
      return '<div class="card" data-static="1" title="只读说明：生命周期动作（编辑内容 / 停用 / 恢复）已提到页头，这里只交代停用与恢复的影响面；本卡不含动作，因此显式声明只读。">' +
        '<div class="card-h"><h3>' + (isDisabled ? '这条画像已停用' : '停用画像意味着什么') + '</h3>' +
        '<span class="card-sub">' + (isDisabled
          ? '已被移出检索池，Agent / 策略圈选不会再用到它'
          : '停用 = 移出检索池；画像本身保留，可随时恢复') + '</span></div>' +
        '<div class="bt-note">' + (isDisabled
          ? '被引用 ' + fmt.int(s.refCount) + ' 次（历史值保留）。恢复后重新进入检索池，引用它的 Agent 会再次圈到这群人。'
          : '适用场景：口径过期、企业组织变动、画像被新版本取代。') +
        '　动作在页头右上角 —— 不必再滚过企业清单才够得着。</div></div>';
    }

    RENDERERS.personaDetail = function (cap, state, h) {
      var fmt = h.fmt;
      var active = state.objTab || state.tab || 'overview';
      /* 老深链 .../persona/{id}/firms 仍落到概览（与本体同一句判断） */
      if (active === 'firms') active = 'overview';
      if (active !== 'overview') return rawPersonaDetail(cap, state, h);

      var t = APP.getAssetTables().persona;
      var oid = state.objId || state.agentId;
      var s = (t.rows || []).filter(function (x) { return x.id === oid; })[0];
      /* ⚠ 只把**编辑过**的画像交回本体：personaApplyEdit（行业/标签改了要按新条件重圈企业）
         只有 v10 那一份实现，这里重算一遍必然漂。
         而「已停用」**不能**交回本体 —— 实测踩过：本体那条路会落到页尾那张「停用画像」卡，
         于是停用后的概览又退回 162KB 旧形态（生命周期动作掉回最后一行），
         等于"修好的形态在停用态消失"。停用只改状态与动作文案，不影响画像属性与企业清单，
         所以这里自己带上 isDisabled 走新形态（页头按钮换成「恢复画像」）。 */
      var isDisabled = !!(S(state, h, 'personaDisabled') && S(state, h, 'personaDisabled')[oid]);
      if (!s || (state.personaEdit && state.personaEdit[oid])) {
        return rawPersonaDetail(cap, state, h);
      }

      var A = global.APP_DATA || {};
      var firms = A.firmsOf ? A.firmsOf(s, t.rows) : [];
      var inner = rawPersonaDetail(cap, state, h);

      /* ① 页头动作：本体那句 headActs 只有「编辑画像内容」，整段换成两个写操作。
          替换失败就退回原样 —— 宁可少一个入口，也不产出半截 HTML。 */
      var THEIR = '<button class="btn-ghost" data-act="persona-edit-content" data-id="' + h.esc(s.id) + '">编辑画像内容</button>';
      if (inner.indexOf(THEIR) < 0) return inner;
      inner = inner.replace(THEIR,
        '<button class="btn-ghost" data-act="persona-edit-content" data-id="' + h.esc(s.id) + '">编辑画像内容</button>' +
        (isDisabled
          ? '<button class="btn-ghost ok" data-act="persona-restore" data-id="' + h.esc(s.id) + '">恢复画像</button>'
          : '<button class="btn-ghost" data-act="persona-disable" data-id="' + h.esc(s.id) + '">停用画像</button>'));

      /* ② 覆盖企业区（sub-h 起、metaBar 止）整段替换：
         4 张属性卡保留（它们是该画像的属性），4 张覆盖 KPI + 命中构成 3 段 + 97 行表 + 停用卡
         收成 → 首条摘要 + 分布带 + 5 家预览 + 只读的生命周期说明。 */
      var ci = inner.indexOf('<div class="sub-h">覆盖企业 · 这 ');
      var mi = inner.lastIndexOf('<div class="meta-bar"');
      if (ci < 0 || mi < ci) return inner;
      /* 筛选键与展开态统一从 S() 读（见上方说明），不再直接读 h.state */
      var fq = S(state, h, 'filters.firmQ') || '';
      return inner.slice(0, ci) +
        ovStrip(s, firms, h, fmt, isDisabled) + distStrip(firms, h, fmt, fq) +
        firmsCard(firms, h, fmt, fq, state) +
        lifecycleCard(s, h, fmt, isDisabled) +
        inner.slice(mi);
    };
    RENDERERS.personaDetail.__v27bPersona = true;
    }

    /* 兜底：如果加载顺序变了、本文件跑的时候本体已经在，就地装 —— 否则等 v27 调
       global.V27B.personaShape()（正式安装点，那时 v10 已跑完）。 */
    global.V27B.personaShape();
  })();

  /* SECTION: r-sandbox-page
   * 沙盒隔离 —— 任务视角：用户点开是想知道「我的任务资源够不够、被拦了什么」。
   * 聚焦：需关注实例（接近并发上限/异常）置顶 + 按业务线占用 + 实例表降级。
   */
  RENDERERS.sandboxPage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets().sandbox;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';
    var rows = t.rows;
    function usage(s) { var p = String(s.concurrency).split('/'); return p.length === 2 ? Number(p[0]) / Number(p[1]) : 0; }
    function verdict(s) {
      var u = usage(s);
      if (u >= 0.95) return { k: 'bad', t: '濒临上限' };
      if (u >= 0.85) return { k: 'warn', t: '接近上限' };
      return s.status === 'ok' ? { k: 'ok', t: '正常' } : { k: 'warn', t: '需关注' };
    }
    var attention = rows.filter(function (s) { return usage(s) >= 0.85 || s.status !== 'ok'; });
    var totalBlocked = rows.reduce(function (s, r) { return s + r.blocked; }, 0);

    var bizAgg = {};
    rows.forEach(function (s) {
      if (!bizAgg[s.biz]) bizAgg[s.biz] = { name: s.biz, n: 0, max: 0, warn: 0 };
      bizAgg[s.biz].n++; bizAgg[s.biz].warn += verdict(s).k !== 'ok' ? 1 : 0;
      bizAgg[s.biz].max = Math.max(bizAgg[s.biz].max, usage(s));
    });

    var cols = t.columns.map(function (c) {
      var out = Object.assign({}, c);
      if (c.key === 'name') out.render = function (r) { return '<button class="lnk" data-act="sbx-detail" data-id="' + h.esc(r.id) + '"><b class="mono">' + h.esc(r.name) + '</b></button>'; };
      else if (c.key === 'concurrency') out.render = function (r) { var u = usage(r); return '<span class="' + (u >= 0.85 ? 'warn' : '') + '">' + h.esc(r.concurrency) + '</span>'; };
      else if (c.key === 'netPolicy') out.render = function (r) { return '<span class="' + (r.netPolicy === 'whitelist' ? '' : 'ok') + '">' + h.esc(r.netPolicyText) + '</span>'; };
      else if (c.key === 'status') out.render = function (r) { return h.pill(r.status, r.statusText); };
      else out.render = function (r) { return h.esc(String(r[c.key] != null ? r[c.key] : '')); };
      return out;
    });
    cols.splice(cols.length - 1, 0, { key: 'judge', label: '结论', render: function (r) { var v = verdict(r); return h.pill(v.k, v.t); } });

    var attHtml = attention.length
      ? '<div class="card"><div class="card-h"><h3>需关注的实例</h3>' +
        '<span class="card-sub">并发 ≥ 85% 或状态异常 · 点开看资源与处理建议</span></div>' +
        '<div class="ab-list">' + attention.map(function (s) {
          var v = verdict(s);
          return '<button class="ab-item" data-act="sbx-detail" data-id="' + h.esc(s.id) + '">' +
            '<b class="mono">' + h.esc(s.name) + '</b><span>' + h.esc(s.biz) + '</span>' +
            '<span class="ab-why">' + v.t + ' · 并发 ' + h.esc(s.concurrency) + '</span>' +
            '<span class="ab-go">查看 →</span></button>';
        }).join('') + '</div></div>'
      : '';

    var bizHtml = '<div class="card"><div class="card-h"><h3>按业务线占用</h3>' +
      '<span class="card-sub">并发水位 = 该业务线实例中最高并发使用率</span></div>' +
      '<div class="ins-grid">' + Object.keys(bizAgg).map(function (k) {
        var b = bizAgg[k];
        return '<div class="ins"><i>' + h.esc(b.name) + '</i><b>' + fmt.pct0(b.max) + '</b><span>' +
          b.n + ' 个实例' + (b.warn ? ' · ⚠ ' + b.warn + ' 个需关注' : '') + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">抬升资源（扩容 / 放开网络白名单）会改变隔离边界。</div></div>';

    return pageHead(h, cap, {
      side: '<span class="side-note" data-tip="沙盒实例为配置态资源，存在实时水位概念但无时间序列指标，不提供时间范围选择。">配置态数据 · 无时间维度</span>',
      action: 'create-open'
    }) +
      '<div class="metrics">' + [
        { label: '实例数', value: String(rows.length), sub: rows.filter(function (s) { return s.status === 'ok'; }).length + ' 运行中' },
        { label: '需关注', value: String(attention.length), alert: attention.length > 0, sub: attention.length ? '并发或状态异常' : '全部正常' },
        { label: '24h 拦截', value: fmt.int(totalBlocked), alert: totalBlocked > 0, sub: '被安全策略阻止的危险操作' }
      ].map(h.metricCard).join('') + '</div>' +
      attHtml + bizHtml +
      '<div class="card pad0"><div class="card-h pad"><h3>全部实例</h3>' +
      '<span class="card-sub">' + rows.length + ' 条 · 点击实例名看资源与下一步</span></div>' +
      h.table({ columns: cols, rows: rows, sortBy: state.sortKey, sortDir: state.sortDir, page: state.page || 1, pageSize: 20, emptyTitle: '暂无沙盒实例' }) + '</div>' +
      h.metaBar({}, [{ k: '数据性质', v: '实例资源规格为配置态；并发水位为实时快照，24h 拦截为运行计数' }]);
  };

  /* SECTION: r-sim-page
   * 模拟用户 —— 任务视角：用户点开是想知道「这个方案投下去会怎样、该不该信」。
   * 聚焦：保真度诚实声明（未达标单列） + 逐 persona 结论，不写死预演数字。
   */
  function simRiskLevel(neg) { return neg > 0.4 ? '高' : (neg >= 0.2 ? '中' : '低'); }

  /* 模拟模式 tab：与 data.js sim_runs.mode 一一对应（single / multi / opinion）。
   * 任务视角：三个 tab 回答三个不同的问题 —— 单人「他会怎么反应」、多用户「整体转化如何」、舆情「会不会翻车」。
   */
  var SIM_MODES = [
    /* 引擎按能力分工（不是随手分的）：
     *   单人 = LLM —— 要的是「这个人会怎么回话」，必须生成自然语言，Jev 不做生成；
     *   多用户 = Jev —— 要的是「这批人里谁会采纳」，是同一组类型化问题对 N 个人重复判定，
     *                   正是 Jev（TypeSafe System One）的强项：并行、便宜、输出结构化。
     * Jev 为托管判定模型（api.typesafe.ai/v1/systemone）。 */
    { id: 'single', label: '单人模拟', engine: 'LLM', engLabel: 'LLM 处理', engNote: '逐条对话回放由 LLM 生成（Jev 只做判定、不生成文本）',
      q: '逐条回放触达对话，看这位用户会被哪种话术打动、哪种会流失' },
    { id: 'multi', label: '多用户模拟', engine: 'Jev', engLabel: 'Jev 判定', engNote: '由 Jev（TypeSafe System One 判定模型）并行判定',
      q: '用一批用户跑整体触达漏斗，看规模转化与流失掉在哪一环' },
    /* 舆情也是对「一段内容」做判定（情绪档位 / 高风险概率 / 风险类型），不是生成内容 ——
     * 与 Jev 的原型用例（"how does this lead feel?" → Score）同形，故同样归 Jev。 */
    { id: 'opinion', label: '舆情预测', engine: 'Jev', engLabel: 'Jev 判定',
      engNote: '由 Jev（TypeSafe System One 判定模型）判定情绪档位、高风险概率与风险类型',
      q: '预演内容公开后的情绪走向，负面超阈值需先降险再投放' }
  ];
  /* 引擎分工：单人 = LLM 处理；多用户 = Jev 判定。
   * 取不到就返回空串，绝不默认成 Jev —— 否则单人 tab 又会退回「Jev 判定」的错误口径。 */
  function simEngine(mode) {
    var m = SIM_MODES.filter(function (x) { return x.id === mode; })[0] || {};
    return { name: m.engine || '', label: m.engLabel || '', note: m.engNote || '' };
  }
  function simModeTab(h, active) {
    return '<div class="tabs" role="tablist">' + SIM_MODES.map(function (m) {
      return '<button role="tab" aria-selected="' + (m.id === active) + '" class="tab' + (m.id === active ? ' on' : '') +
        '" data-act="sim-mode" data-id="' + m.id + '">' + h.esc(m.label) + '</button>';
    }).join('') + '</div>';
  }

  /* --- 各模式专属区块：让三个 tab 不只是换个表头，而是真的回答不同问题 --- */
  function fmt1(v) { return (v * 100).toFixed(1) + '%'; }
  /* lookupOr（按 personaId 反查 SIM_PERSONAS）随 2026-10-18「舆情下面两块」删除而失去全部调用点，一并删除；
     本屏外没有第二处引用（grep 全 assets 只剩定义这一行）。 */

  /* --- 全局用户池：单人/多用户两个 tab 都从这里选人 ---
   * 设计约束（来自设计稿）：
   *   ① 池子正方形小卡片、可勾选，50 位一屏能扫完 —— 选人是「扫」的动作，不是「读」的动作；
   *   ② 「简略 / 详细」换的是**同一批卡片的信息密度**：简略=方卡（姓名+国别年龄），
   *      详细=每张卡都摊开画像（职业消费+标签+痛点+保真度/命中/模拟+来源）。默认简略；
   *      2026-10-22 业主定 —— 详细指每张卡都详细，不是给已勾选的人另开一张卡；
   *   ③ 确认后才跑 Jev 判定，判定分回填到结果卡 —— 分数来自判定动作，不是本来就有的。
   */
  var POOL_SRC_TEXT = { llm: 'llm', crm: 'crm', preset: 'preset', manual: 'manual', rule: 'rule' };
  /* buildAssetTables() 每次调用都会重建整个 T（确定性派生，不缓存），
   * 所以直接往 assets().user_pool.rows 里 push 会在下次渲染时丢失 —— 数据层是「算出来」的，不是「存下来」的。
   * 因此新增的用户单独存在 window.SIM_POOL_ADDED，渲染时与基线池合并。 */
  function poolAdded() { return (window.SIM_POOL_ADDED || []); }
  /* 2026-10-17：实验同样是「算出来的」，新提交的实验不能 push 进 assets().sim_runs.rows
   * （下次渲染重建就没了）。统一从 simRunsAll() 取，页面各处不再直接读 assets().sim_runs。 */
  function simRunsAdded() { return (window.SIM_RUNS_ADDED || []); }
  function simRunsAll() {
    var base = (assets().sim_runs && assets().sim_runs.rows) || [];
    return base.concat(simRunsAdded());
  }
  function poolRows() {
    var base = (assets().user_pool && assets().user_pool.rows) || [];
    var all = base.concat(poolAdded());
    /* 「已模拟 N 次」必须数得出来：之前 sims 是数据层独立抽的随机数，14 位具名里 13 位
     * 与 sim_runs 对不上（Alex sims=0 却有 2 条实验）。这里改成按 poolUserIds 反查实验条数，
     * 与右栏「模拟记录」列表同一份数据源 —— 同一屏两个数字必须能互相解释。 */
    var runs = simRunsAll();
    all.forEach(function (r) {
      var n = runs.filter(function (x) { return (x.poolUserIds || []).indexOf(r.id) > -1; }).length;
      r.sims = n;
    });
    return applyNamedBackfill(all);
  }
  function poolSelected() { return (window.SIM_POOL_SEL || []); }
  /* 未具名样本的画像回填：判定通过后回填完整画像（姓名/职业/标签/痛点/消费 + 判定分）。
   * 数据层是算出来的，所以回填结果存 window.SIM_NAMED，渲染时并回 —— 与 SIM_POOL_ADDED 同一套办法。
   * 派生全部确定性（fnv01 同 id 恒定），不引入随机。 */
  var GEN_NAMES = ['Leo Fischer', 'Mia Keller', 'Noah Blanc', 'Emma Horst', 'Liam Varga', 'Sofia Marek', 'Ethan Kohl', 'Yara Salem', 'Owen Trapp', 'Lena Vogel', 'Hugo Weiss', 'Iris Delgado', 'Milo Sander', 'Nora Feld', 'Enzo Ricci', 'Tara Lindt', 'Kai Moreno', 'Elsa Brandt', 'Rio Tanaka', 'Ada Novak'];
  var GEN_JOBS = ['产品经理', '运营专员', '视觉设计师', '自由职业', '教师', '测试工程师', '采购经理', '门店店长', '销售顾问', '行政主管'];
  var GEN_TAGS = ['价格敏感', '品质优先', '高复购', '物流敏感', '促销驱动', '比价', '售后敏感', '新品尝鲜'];
  var GEN_PAINS = ['尺码不准', '物流慢', '客服响应不及时', '促销规则复杂', '比价麻烦', '售后门槛高', '到货时间不确定', '优惠信息不透明'];
  function backfillOf(id) {
    var m = window.SIM_NAMED || (window.SIM_NAMED = {});
    if (m[id]) return m[id];
    var r1 = fnv01('name|' + id), r2 = fnv01('job|' + id), r3 = fnv01('tag|' + id), r4 = fnv01('pains|' + id), r5 = fnv01('score|' + id);
    var t1 = GEN_TAGS[Math.floor(r3 * GEN_TAGS.length)];
    var t2 = GEN_TAGS[Math.floor((r3 * 7 + 3) % GEN_TAGS.length)];
    var o = {
      name: GEN_NAMES[Math.floor(r1 * GEN_NAMES.length)],
      job: GEN_JOBS[Math.floor(r2 * GEN_JOBS.length)],
      tags: t1 === t2 ? [t1] : [t1, t2],
      pains: [GEN_PAINS[Math.floor(r4 * GEN_PAINS.length)]],
      spend: 120 + Math.floor(r2 * 780),
      jevScore: +(0.3 + r5 * 0.65).toFixed(2),
      source: 'jev'
    };
    o.jevBand = o.jevScore >= 0.7 ? 'high' : (o.jevScore >= 0.4 ? 'mid' : 'low');
    m[id] = o;
    return o;
  }
  function applyNamedBackfill(rows) {
    var m = window.SIM_NAMED;
    if (!m) return rows;
    rows.forEach(function (r) {
      var o = m[r.id];
      if (!o) return;
      r.named = true; r.name = o.name; r.job = o.job; r.tags = o.tags; r.pains = o.pains;
      r.spend = o.spend; r.jevScore = o.jevScore; r.jevBand = o.jevBand; r.source = o.source;
    });
    return rows;
  }
  /* 判定是按人记的：确认判定给当时选中的每一位打标，之后再勾新人不会把已有的分抹掉
   * （全局一个 SIM_JUDGED 布尔会让人以为「只算了前几个」）。 */
  function isJudged(id) { return !!(window.SIM_JUDGED_IDS && window.SIM_JUDGED_IDS[id]); }
  function markJudged(ids) {
    var m = window.SIM_JUDGED_IDS || (window.SIM_JUDGED_IDS = {});
    ids.forEach(function (i) { m[i] = 1; });
  }
  function unmarkJudged(id) { if (window.SIM_JUDGED_IDS) delete window.SIM_JUDGED_IDS[id]; }
  function poolIsSel(id) { return poolSelected().indexOf(id) > -1; }

  /* --- 舆情：文案 → 判定结果 ---
   * 演示环境没有真跑模型，但**派生必须可复算、且与文案相关**：
   * 同一段文案每次算出的情绪分布一致（FNV-1a 取 0–1），改一个字就可能换档。
   * 风险类型按文案里真实出现的风险词命中，不是随机分配。 */
  function fnv01(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  var RISK_WORDS = [
    { re: /限时|最低价|全网最低|绝对|史上最|第一/, type: '价格承诺质疑' },
    { re: /原价|划线价|直降|立减|返现|补贴/, type: '价格欺诈质疑' },
    { re: /免费|0\s*元|白送|不收钱|零门槛/, type: '福利不实质疑' },
    { re: /儿童|宝宝|宝妈|婴|孕妇|孕产/, type: '安全适用性质疑' },
    { re: /会员|积分|权益|尊享|特权/, type: '权益缩水质疑' },
    { re: /专家|权威|官方认证|国家级|专利/, type: '资质权威质疑' },
    { re: /清仓|尾货|断码|瑕疵/, type: '商品成色质疑' },
    { re: /转发|抽奖|锦鲤|拼团|砍价/, type: '诱导分享质疑' }
  ];
  /** 文案里的风险词命中（去重，保序）—— 列表与详情共用，用户能看出「凭什么是这个类型」 */
  function riskHitsOf(text) {
    var out = [];
    var s = String(text || '');
    RISK_WORDS.forEach(function (w) { if (w.re.test(s) && out.indexOf(w.type) === -1) out.push(w.type); });
    return out;
  }
  function riskTypeOf(text, neg) {
    var hits = riskHitsOf(text);
    if (hits.length) return hits.join(' / ');
    return neg >= 0.4 ? '品牌信任 / 情绪对立' : (neg >= 0.2 ? '信息误读' : '无明显争议');
  }
  /** 由文案派生情绪分布：风险词越多，负面基线越高；同文案恒定 */
  function sentiOf(text) {
    var s = String(text || '');
    var hits = riskHitsOf(s).length;
    var base = [0.09, 0.2, 0.3, 0.46, 0.56][Math.min(4, hits)];
    var r1 = fnv01('neg|' + s), r2 = fnv01('neu|' + s);
    var neg = +(Math.max(0.03, Math.min(0.72, base + (r1 - 0.5) * 0.08))).toFixed(4);
    var neu = +((1 - neg) * (0.35 + r2 * 0.4)).toFixed(4);
    var pos = +(1 - neg - neu).toFixed(4);
    return { pos: pos, neu: neu, neg: neg };
  }
  /** 投放结论：与卡头阈值同一把尺子（负>40% 高 / 20–40% 中 / <20% 低） */
  function opinionVerdict(run) {
    var neg = run.senti ? run.senti.neg : 0;
    if (neg >= 0.4) return { k: 'bad', t: '不可投放', note: '负面 ' + (neg * 100).toFixed(1) + '%，已超高风险的 40% 线' };
    if (neg >= 0.2) return { k: 'warn', t: '降险后再投', note: '负面 ' + (neg * 100).toFixed(1) + '%，处中风险带' };
    return { k: 'ok', t: '可按当前文案投放', note: '负面 ' + (neg * 100).toFixed(1) + '%，低于 20% 线' };
  }
  /* 处置动作落在这里：跑完不等于处理完，结论必须能落到一个动作上 */
  function opActs() { return (window.SIM_OP_ACT || (window.SIM_OP_ACT = {})); }
  var OP_ACT_TEXT = { rewrite: '已安排改写降险', review: '已转人工复核', block: '已标记不投放' };

  /** 正方形小卡片：首字母圆章 + 姓名/首字母 + 国别·年龄，左上勾选圈、右上来源角标。
   * 明暗只由「是否选中」决定（亮=on，暗=未选），不再按「是否待判定」另分一套亮度 ——
   * 同一状态只能有一套视觉，否则用户要学两遍规则。
   * wide=true 时渲染「详细视图」的宽卡：同样是这一张卡，只是把画像信息摊开（业主 2026-10-22：
   * 详细指每张卡都详细，不是给已勾选的人另开一张卡）。 */
  function poolCell(r, h, singleMode, wide, fmt) {
    // 单人模式只认第一位：其余已勾选的显示为「本轮不参与」而非勾选态，避免勾选态说谎
    var on = singleMode ? (poolSelected().length > 0 && poolSelected()[0] === r.id) : poolIsSel(r.id);
    var idle = !on && poolIsSel(r.id) && singleMode;
    /* 判定结果就地展示：确认判定后，分数直接落在这张卡右上角（此前是另开一张卡把同样的人再列一遍）。
     * 只在「已选 + 已确认」时出分 —— 分数必须来自判定动作，不能勾上就有。
     * 2026-10-17：单人模式走的是 LLM 处理，**根本没有判定这一步**，卡片上不能出判定分/概率条
     * （业主原话「单用户模拟，哪来的概率？」）—— 只标「待处理 / 已处理」，分数归右栏。 */
    var done = isJudged(r.id);
    var judged = !singleMode && done && r.jevScore != null;
    var lowFid = judged && r.fidelity != null && r.fidelity < 0.8;
    var scoreTip = judged
      ? '判定分 ' + r.jevScore.toFixed(2) + (r.fidelity != null ? ' · 保真 ' + (r.fidelity * 100).toFixed(1) + '%' : '') + (lowFid ? ' · 不可用于决策' : '')
      : '';
    var titleAttr = '"' + h.esc(r.name || (r.initial + '（待判定）')) + ' · ' + h.esc(r.country) + ' · ' + r.age + ' 岁' + (scoreTip ? ' · ' + h.esc(scoreTip) : '') + '"';

    /* 详细视图：一张卡把这个人说清楚 —— 姓名/国别年龄职业消费、标签、痛点、保真度与命中模拟、来源。
     * 与简略卡同一套选中态（.pcell.on）与同一个动作（pool-toggle），只是密度不同。
     * 分区：① 身份（头像+姓名+一行画像元信息） ② 标签（药丸） ③ 痛点（带标签前缀）
     *       ④ 页脚（判定/处理状态 + 三个计数 + 来源药丸），页脚用 margin-top:auto 压到底，
     *          同一排卡片不论内容长短，页脚都对齐在同一条线上。 */
    if (wide) {
      var tags = r.tags || [], pains = r.pains || [];
      var srcText = POOL_SRC_TEXT[r.source] || r.source;
      /* 判定分 / 处理状态：与简略卡同样的出现条件，不能让详细视图反而丢信息 */
      var chip = judged
        ? '<span class="pw-sc ' + (r.jevBand === 'high' ? 'ph' : (r.jevBand === 'mid' ? 'pm' : 'pl')) + '">判定分 ' + r.jevScore.toFixed(2) + '</span>'
        : (poolIsSel(r.id)
          ? '<span class="pw-sc idle">' + (singleMode ? (done ? '已处理' : '待处理') : '待判定') + '</span>'
          : '');
      return '<button class="pcell wide' + (on ? ' on' : '') + '" data-act="pool-toggle" data-id="' + h.esc(r.id) + '" ' +
        'aria-pressed="' + on + '"' + (idle ? ' data-dim="1"' : '') + ' title=' + titleAttr + '>' +
        '<span class="pcheck">✓</span>' +
        '<span class="pw-h"><span class="pav">' + h.esc(r.initial) + '</span>' +
          '<span class="pw-hid"><span class="pname">' + h.esc(r.name || r.initial) + '</span>' +
          '<span class="pmeta">' + h.esc(r.country) + ' · ' + r.age + ' 岁 · ' + h.esc(r.job) +
            ' · 月消费 $' + fmt.int(r.spend) + '</span></span></span>' +
        (tags.length
          ? '<span class="pw-tags">' + tags.map(function (t) { return '<i class="pw-tag">' + h.esc(t) + '</i>'; }).join('') + '</span>'
          : '') +
        (pains.length ? '<span class="pw-pains"><em>痛点</em>' + h.esc(pains.join(' · ')) + '</span>' : '') +
        '<span class="pw-foot">' + chip +
          '<span class="pw-kv">保真度 <b>' + fmt.pct1(r.fidelity) + '</b></span>' +
          '<span class="pw-kv">命中 <b>' + r.hits + '</b> 次</span>' +
          '<span class="pw-kv">模拟 <b>' + r.sims + '</b> 次</span>' +
          '<span class="psrc ' + h.esc(srcText) + '">' + h.esc(srcText) + '</span></span>' +
        '</button>';
    }

    return '<button class="pcell' + (on ? ' on' : '') + '" data-act="pool-toggle" data-id="' + h.esc(r.id) + '" ' +
      'aria-pressed="' + on + '"' + (idle ? ' data-dim="1"' : '') + ' title=' + titleAttr + '>' +
      '<span class="pcheck">✓</span>' +
      '<span class="pav">' + h.esc(r.initial) + '</span>' +
      /* 未具名样本没有名字，别把首字母再写一遍（会变成「R / R / 印度 · 35」） */
      (r.named ? '<span class="pname">' + h.esc(r.name) + '</span>' : '') +
      (judged
        ? '<span class="pmeta-score ' + (r.jevBand === 'high' ? 'ph' : (r.jevBand === 'mid' ? 'pm' : 'pl')) + '">' + r.jevScore.toFixed(2) +
          '<i class="pbar"><i style="width:' + Math.round(r.jevScore * 100) + '%"></i></i></span>'
        /* 已选但还没判定：写「待判定」而不是继续显示国别年龄 —— 否则一排勾中的卡里只有一个有分，
         * 看着像「只算了第一个」。单人模式没有判定，用「待处理 / 已处理」。 */
        : (poolIsSel(r.id)
          ? '<span class="pmeta" style="color:' + (done ? 'var(--sub)' : 'var(--faint)') + '">' +
            (singleMode ? (done ? '已处理' : '待处理') : '待判定') + '</span>'
          : '<span class="pmeta">' + h.esc(r.country) + ' · ' + r.age + '</span>')) +
      '</button>';
  }

  /** 用户池区块：池 + 底部确认条。默认视图统一「简略」（2026-10-22 业主定） */
  /* 池子默认全部展示（2026-10-17 业主定）：50 位全部具名之后没有必要再折叠，
   * 「另有 36 位 · 显示全部」那行与配套的开关一并撤掉 —— 想找谁直接扫。 */
  function simPoolBlock(h, fmt, state) {
    var rowsAll = poolRows();
    if (!rowsAll.length) return '';
    var rows = rowsAll;
    var judgedN = rowsAll.filter(function (r) { return isJudged(r.id); }).length;
    var single = state.simMode === 'single';
    // 单人模式只认第一位，避免把多位勾选态挂在单人 tab 上
    var sel = single ? poolSelected().slice(0, 1) : poolSelected();
    var selRows = sel.map(function (id) { return rowsAll.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
    /* 默认值不再随模式分叉：原来单人默认「详细」（只有一位，直接摊开画像）、多用户默认「简略」。
       2026-10-22 业主定：一律默认「简略」，详细卡改成用户主动点开才出现。 */
    var view = state.poolView || 'simple';

    var grid = '<div class="card"><div class="card-h"><h3>' + (state.simMode === 'multi' ? '② 全局用户池' : '全局用户池') + '</h3>' +
      '<span class="card-sub">池内 ' + rowsAll.length + ' 位 · ' + (state.simMode === 'single' ? '已处理 ' : '已判定 ') + judgedN + ' 位</span>' +
      '<div class="view-sw"><button class="vs-btn' + (view === 'simple' ? ' on' : '') + '" data-act="pool-view" data-id="simple">简略</button>' +
      '<button class="vs-btn' + (view === 'detail' ? ' on' : '') + '" data-act="pool-view" data-id="detail">详细</button></div>' +
      '</div>' +
      /* 详细视图不再额外渲染「已勾选人的详细卡」—— 详细时每一张池卡本身就是详细卡，
         再单开一层等于同一个人在同屏出现两遍，还得让用户自己对名字。 */
      '<div class="pool-grid' + (view === 'detail' ? ' wide' : '') + '">' +
        rows.map(function (r) { return poolCell(r, h, single, view === 'detail', fmt); }).join('') + '</div>';

    // 引擎口径随模式走：单人 = LLM 处理，多用户 = Jev 判定。按钮文案必须跟着变，
    // 否则「单人走 LLM」这件事在界面上根本看不出来。
    var eng = simEngine(state && state.simMode);
    var ctaText = '确认，开始 ' + (eng.label || '模拟');
    /* 2026-10-17：确认条从卡片外挪进池卡做页脚 —— 它属于「选哪些人」这一步，
     * 独立成条会被读成另一件事。样式去掉自有边框/底色，只留一条分隔线。 */
    /* 保真度过低的样本：分照出，但要当场说清楚不能拿去做决策（原提示在判定卡上，判定卡撤了搬到这里） */
    /* 新回填的样本没有保真度（无历史可对照），与「低于 80%」同属不可用于决策 */
    var lowFidSel = selRows.filter(function (r) { return isJudged(r.id) && (r.fidelity == null || r.fidelity < 0.8); });
    var fidNote = lowFidSel.length
      ? '<br><span class="bad">' + lowFidSel.length + ' 位保真度低于 80% 或尚无保真度（' +
        lowFidSel.map(function (r) { return h.esc(r.name) + ' ' + (r.fidelity != null ? fmt.pct1(r.fidelity) : '新回填'); }).join('、') +
        '）：' + (single ? '回放仅供参考，不可用于投放决策。' : '分数可看，不可用于投放决策。') + '</span>'
      : '';
    var bar = '<div class="pool-bar" style="background:none;border:0;border-top:1px solid var(--line);border-radius:0;padding:12px 0 0;margin-top:4px"><div class="pool-bar-txt">' +
      (selRows.length
        ? '已选 <b>' + selRows.length + '</b> 位' + (rowsAll.length - selRows.length ? ' · 其余 ' + (rowsAll.length - selRows.length) + ' 位不参与本轮，只对选中样本执行 ' + h.esc(eng.label || '模拟') : ' · 已选中全池') +
          fidNote
        : '尚未选择样本 —— 从上方池中勾选要模拟的用户') +
      '</div><div style="display:flex;gap:8px;flex:0 0 auto">' +
      (selRows.length
        ? '<button class="btn-ghost" data-act="pool-clear">清空选择</button>' +
          '<button class="btn-primary" data-act="pool-confirm">' + h.esc(ctaText) + '</button>'
        : '<button class="btn-ghost btn-off" aria-disabled="true" data-act="blocked-why" data-id="先在上方用户池中勾选至少 1 位样本">清空选择</button>' +
          '<button class="btn-primary btn-off" aria-disabled="true" data-act="blocked-why" data-id="先在上方用户池中勾选至少 1 位样本">' + h.esc(ctaText) + '</button>') +
      '</div></div>';

    return grid + bar + '</div>';
  }

  /* 已删除（2026-10-17）：poolJudgeCards —— 多用户的「判定结果」卡。
   * 它把选中的人再列一遍（池子里已经有一模一样的卡片），用户得自己把两张表的名字对回去。
   * 现在判定分直接落在各自卡片的右上角（.pscore），保真度过低的提示移到池页脚。
   * 配套删除：全池分布 legend、判定分口径说明（口径已在页脚「数据口径与说明」里）。 */

  /* ── 单人模拟的产物：对话回放（transcript），不是分数 ──────────────────────
   * 行业标准（EACL 2026 用户模拟综述 / Google ADK / DeepEval）要求一个用户模拟器有四件套：
   *   Persona（所选用户）/ Goal（本轮目标）/ Context（他的痛点与历史）/ Stop（终止条件 + 结局）。
   * 这里把四件都落进卡片：画像取自用户池选中的那一位，回放逐条展开，结局带终止原因。
   *
   * 回放绑在所选用户身上：所有剧情线索（比价 / 尺码 / 物流 / 采购 / 售后）
   * 都从该用户自己的 tags / pains / job 里取，所以换一个人一定换一套回放 —— 不是 persona 模板池的通用样例。
   */
  function replayTheme(r) {
    var s = (r.tags || []).concat(r.pains || []).join('|') + '|' + (r.job || '');
    if (/比价|低价|价格敏感|促销|优惠券|促销驱动/.test(s)) return 'price';
    if (/尺码|版型/.test(s)) return 'size';
    if (/物流|时效|运费|揽收|轨迹/.test(s)) return 'logistics';
    if (/采购|账期|批量|结算|供应链/.test(s)) return 'b2b';
    if (/品质|材质|包装|色差|细节/.test(s)) return 'quality';
    if (/客服|售后|退换|响应/.test(s)) return 'service';
    return 'generic';
  }
  var REPLAY_BANK = {
    price: {
      goal: '让他接受「限时优惠话术」并完成首单',
      ctx: '近 3 次触达均停在比价环节，加购后未结算',
      turns: [
        ['推送「限时 9.9 试用装」入口', '「先加购物车，等大促再买 —— 现在买不划算。」', '补发「同款近 90 天低价曲线」'],
        ['展示会员价 + 30 天价保', '「直播间是不是更便宜？我先去蹲个券。」', '补「直播同价 + 过期补差」说明'],
        ['发限时专属券（带到期提醒）', '「券到什么时候过期？过期我可能就忘了。」', '把有效期写进消息并设到期提醒']
      ],
      adopt: '采纳 · 领券并下单', watch: '观望 · 加购未下单', lose: '比价流失 · 转去其他渠道'
    },
    size: {
      goal: '消除尺码顾虑，推动下单',
      ctx: '历史订单出现过尺码偏差，退换记录 1 次',
      turns: [
        ['主动发「尺码对照表」', '「上次买偏大，你们现在按哪个标准算码？」', '给实测脚长对照 + 换码免运费'],
        ['提供同款真人试穿反馈', '「我平时穿 42，你们这款要选 41 还是 42？」', '按他的历史订单推具体码数'],
        ['承诺无忧换码', '「换货要自己出运费的话我就再想想。」', '明确换码运费由我们承担']
      ],
      adopt: '采纳 · 下单（含换码保障）', watch: '观望 · 记下码数未下单', lose: '流失 · 担心尺码再翻车'
    },
    logistics: {
      goal: '用时效确定性换取下单',
      ctx: '曾因物流慢给过一次差评，对时效高度敏感',
      turns: [
        ['同步「物流时效与轨迹」', '「到我这儿要几天？中途能改地址吗？」', '给承诺时效 + 改址流程'],
        ['展示近 30 天准时率', '「准时率是你们自己说的，我信不过。」', '给第三方承运数据 + 超时赔付'],
        ['加「超时赔付」承诺', '「真超时了赔多少？怎么申请？」', '写清赔付额度与申请入口']
      ],
      adopt: '采纳 · 下单（接受时效承诺）', watch: '观望 · 说再看看', lose: '流失 · 仍不信任时效'
    },
    b2b: {
      goal: '推进到采购流程（送样 / 报价）',
      ctx: '决策链长，采购制度要求三家比价',
      turns: [
        ['发送选型方案与盖章报价单', '「预算要走采购流程，先把白皮书和报价发我。」', '补齐资质与合规文档'],
        ['提供技术参数对比表', '「评标要用对比表，要盖章版。」', '发盖章版 + 联系人'],
        ['跟进立项进度', '「本季度额度用完了，下季度批了再说。」', '约定下季度立项时间并设提醒']
      ],
      adopt: '推进 · 进入比价流程（未成交）', watch: '延后 · 等下季度立项', lose: '流失 · 转竞品'
    },
    quality: {
      goal: '用实拍与材质说明建立信任',
      ctx: '对图文与实物差异敏感，下单前要看细节',
      turns: [
        ['发送材质与工艺详述', '「参数可以，但我要看实物细节，别只给渲染图。」', '补实拍图 + 细节视频'],
        ['提供 30 天无理由', '「无理由是真的吗？拆了包装还能退？」', '写清拆包后退换规则'],
        ['给同款买家实拍', '「别人的实拍和我收到的不一定一样。」', '给近期订单实拍 + 批次说明']
      ],
      adopt: '采纳 · 下单', watch: '观望 · 继续看评测', lose: '流失 · 转去买过的老品牌'
    },
    service: {
      goal: '用响应承诺消除售后顾虑',
      ctx: '上一次咨询 4 小时未回复，留下负面印象',
      turns: [
        ['承诺客服 5 分钟响应', '「上次问半天没人回，这次能保证吗？」', '给 SLA 与专属客服入口'],
        ['主动查他上次的问题', '「你们真能看到我上次问的是什么？」', '复述他上次的问题并给出结论'],
        ['给出补偿方案', '「那我上次耽误的时间怎么说？」', '给一次性补偿券']
      ],
      adopt: '采纳 · 下单', watch: '观望 · 观察响应后再决定', lose: '流失 · 转投服务更好的店'
    },
    generic: {
      goal: '让他接受本轮话术并完成首单',
      ctx: '无历史互动记录，属于新触达',
      turns: [
        ['推送「新品种草预热」文案', '「没买过你们的，先了解一下再说。」', '补充品牌背书与用户评价'],
        ['展示首单权益', '「首单有什么优惠？值不值得试。」', '给首单立减 + 试用装入口'],
        ['降低决策门槛', '「万一下单了不满意，退起来麻烦吗？」', '明确 7 天无理由与退换流程']
      ],
      adopt: '采纳 · 首单转化', watch: '观望 · 加入收藏', lose: '流失 · 未产生兴趣'
    }
  };

  /** 单人对话回放卡：绑定池中选中的第一位用户，读他的画像派生整段回放。
   * 版式与「AI 访谈 · 单人记录」（v10-interview-home）同源：左栏逐条对话，右栏「看板」。
   * 复用既有类名、不新造样式：.iv-split / .iv-talk-l / .iv-talk-r / .iv-chat / .row.me / .who / .bubble
   * / .dl / .kb-card / .iv-ava / .chip / .pill —— 同类元素在两个页面必须长得一样。
   * 左栏不上屏的东西：栏目名与轮序号（2026-10-09 按设计稿要求去掉）。
   */
  function singleReplayCard(h, fmt) {
    var ids = window.SIM_POOL_SEL || [];
    var r = ids.length ? (poolRows().filter(function (x) { return x.id === ids[0]; })[0] || null) : null;
    if (!r) return '';
    /* 卡的大小以「卡片1」（用户池那张卡）为准：进池子时量到的池卡高度存进 SIM_STAGE_H，
     * 回放卡按这个高度撑开 —— 否则放大到 887px 之后落地只剩 756px，动画最后一帧会"缩一下"。
     * 撑高后左栏对话区跟着变长（flex:1），不是底部留一块空白。 */
    var stageH = Math.round(window.SIM_STAGE_H || 0);
    var cardStyle = stageH > 400 ? ' style="min-height:' + stageH + 'px;display:flex;flex-direction:column"' : '';
    var head = '<div class="card"' + cardStyle + '><div class="card-h" style="flex:0 0 auto;flex-direction:column;align-items:flex-start;gap:6px">' +
      /* 三段（业主两次定）：返回按钮独占第一行贴左上；第二行左边标题、右边口径（.card-sub 自带的
       * margin-left:auto 正好把它推到最右）。 */
      '<button class="sim-back" data-act="sim-back-pool"><em>←</em>换一位用户</button>' +
      '<div style="display:flex;align-items:baseline;gap:10px;width:100%;min-width:0">' +
        '<h3 style="font-size:15px">对话模拟</h3>' +
        '<span class="card-sub">对象：' + h.esc(r.name || (r.initial + '（待判定）')) + '</span>' +
      '</div></div>';
    // 没画像就没有回放：36 位未具名样本只有首字母与国别年龄，不硬编对话
    if (!r.named) {
      return head + '<div class="empty"><div class="empty-title">该样本尚未具名，无法生成对话回放</div>' +
        '<div class="empty-sub">池中未具名样本只有首字母与国别年龄。先补全画像（或跑一轮判定回填），再对它做单人模拟。</div></div></div>';
    }
    // 与多用户一致：没点「确认」就不生成，避免把「还没跑」误读成「跑完了」
    if (!isJudged(r.id)) {
      return head + '<div class="empty"><div class="empty-title">尚未运行</div>' +
        '<div class="empty-sub">点上方「确认，开始 LLM 处理」后，这里出这位用户的逐条对话回放；未确认前不生成。</div></div></div>';
    }
    var bank = REPLAY_BANK[replayTheme(r)];
    /* 2026-10-17：这里原来算 score = r.jevScore 当「处理分」。单人模式没有 Jev 判定这一步，
     * 拿判定分顶处理分就是「哪来的概率」——已删。单人只报事实：几轮对话、画像可信度。
     */
    var who = r.name || r.initial;

    /* 「对话模拟」绑定到一次实验（2026-10-18 业主定）：只有点了某条模拟记录，才出那一次的对话。
     * 之前是点完确认就自动生成一段预演，等于"凭空跑了一次没人跑过的实验"，
     * 左上角还写着"本页回放是一次预演，不写入实验记录"——自己承认不是真的。 */
    var mine = simRunsAll().filter(function (x) {
      return (x.poolUserIds || []).indexOf(r.id) > -1;
    }).sort(function (a, b) { return b.dayOffset - a.dayOffset; });
    function runResult(x) {
      if (x.mode === 'opinion') return '风险 ' + simRiskLevel(x.senti.neg) + '（负面 ' + fmt.pct1(x.senti.neg) + '）';
      if (x.mode === 'single') return x.adopted ? '已采纳' : '未采纳';
      return '转化 ' + fmt.pct1(x.adopted / x.sample);
    }
    function runLabel(x) {
      return x.preview ? '预演（不写入实验）' : F.fmtDate(S.TODAY_START + x.dayOffset * S.DAY) + ' · ' + x.name;
    }
    var pickId = window.SIM_REPLAY_RUN;
    var runSel = pickId === 'preview'
      ? { id: 'preview', preview: true, name: '预演', modeText: '单人' }
      : (mine.filter(function (x) { return x.id === pickId; })[0] || null);

    /* 左：没选记录时是"选记录"，选了才是对话。逐条对话我方靠右（深蓝气泡）、用户靠左（白气泡），
     * 与 AI 访谈记录同一套 .iv-chat 规则。说话人保留、轮序号不上屏。 */
    var chat = bank.turns.map(function (t) {
      return '<div class="row me"><div><div class="who">我方</div>' +
          '<div class="bubble">' + h.esc(t[0]) + '</div></div></div>' +
        '<div class="row"><div><div class="who">' + h.esc(who) + '</div>' +
          '<div class="bubble">' + h.esc(t[1]) + '</div></div></div>' +
        (t[2] ? '<div class="row me"><div><div class="who">我方</div>' +
          '<div class="bubble">' + h.esc(t[2]) + '</div></div></div>' : '');
    }).join('');

    /* 左栏：对话 + 底部续聊输入框。输入框真能用（发送后追加一条我方气泡 + 一条该用户回复，
     * 见 simChatReply），会话内状态存 window.SIM_CHAT[用户 id]，刷新即还原。
     * 外层定高、内层滚动，输入条钉在底部 —— 否则它会被卷进滚动区。 */
    var tail = ((window.SIM_CHAT && window.SIM_CHAT[r.id]) || []).map(function (m) {
      return m.who === 'me'
        ? '<div class="row me"><div><div class="who">我方</div><div class="bubble">' + h.esc(m.text) + '</div></div></div>'
        : '<div class="row"><div><div class="who">' + h.esc(who) + '</div><div class="bubble">' + h.esc(m.text) + '</div></div></div>';
    }).join('');
    var hasChat = ((window.SIM_CHAT && window.SIM_CHAT[r.id]) || []).length > 0;

    function runItem(x) {
      return '<button class="kb-card" data-act="sim-pick-run" data-id="' + h.esc(x.id) + '">' +
        '<span style="font-size:12.5px;font-weight:600">' + h.esc(runLabel(x)) + '</span>' +
        '<span style="font-size:11.5px;color:var(--sub)">' + h.esc(x.modeText) + '模式 · persona ' + h.esc(x.personaName || '—') +
          ' · 样本 ' + (x.mode === 'single' ? '1 位' : fmt.int(x.sample)) + '</span>' +
        '<span style="font-size:11.5px;color:var(--sub)">结果 ' + h.esc(runResult(x)) + ' · ' + h.esc(x.statusText || '已完成') + '</span></button>';
    }

    /* 输入条常驻且始终可用：这一屏的正文就是「现在跟这个用户聊一次」，
     * 历史记录只影响"按哪一次的口径模拟"，不该把输入框锁住。 */
    var inputBar = '<div class="iv-row" style="margin-top:12px;border-top:1px dashed var(--line);padding-top:10px">' +
      '<input class="iv-input" id="sim-chat-input" type="text" placeholder="说一句，看' + h.esc(who) + '怎么回" ' +
        'style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 10px">' +
      '<button class="btn-primary" data-act="sim-chat-send">发送</button>' +
      (hasChat ? '<button class="btn-ghost" data-act="sim-chat-clear">清空续聊</button>' : '') +
      '</div>';

    /* 默认就是「现在跑一次」（2026-10-18 业主纠正）：点确认进来直接能对话，不拿历史记录挡路。
     * 右栏点某条记录只是「改用那一次的口径」，可选，不是前置条件 ——
     * 之前做成"必须先选一条记录才出对话"，等于把模拟器变成了历史查询器。 */
    var left;
    if (!runSel) {
      var objBar0 = '<div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:10px">' +
        '<span style="font-size:12.5px;min-width:0">模拟对象：<b>本轮方案</b></span>' +
        '</div>';
      left = '<div class="iv-talk-l" style="display:flex;flex-direction:column;max-height:none;min-height:0">' + objBar0 +
        '<div style="flex:1;min-height:0;overflow:auto"><div class="iv-chat">' + chat + tail + '</div></div>' +
        inputBar +
        '</div>';
    } else {
      var objBar = '<div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:10px">' +
        '<span style="font-size:12.5px;min-width:0">模拟对象：<b>' + h.esc(runLabel(runSel)) + '</b>' +
        (runSel.preview ? '' : '　' + h.esc(runSel.modeText) + '模式 · ' + h.esc(runResult(runSel))) + '</span>' +
        '<button class="lnk" style="margin-left:auto;flex:0 0 auto" data-act="sim-pick-run" data-id="">改用本轮方案</button></div>';
      left = '<div class="iv-talk-l" style="display:flex;flex-direction:column;max-height:none;min-height:0">' + objBar +
        '<div style="flex:1;min-height:0;overflow:auto"><div class="iv-chat">' + chat + tail + '</div></div>' +
        inputBar +
        '</div>';
    }

    /* 右：看板。上「用户信息」（这个人是谁、画像可不可信），下「模拟记录」（他参与过哪些实验、结果怎么变）。
     * 与访谈看板同结构：先身份、再记录 —— 用户读完左栏的对话，右栏要能回答「凭什么信这段对话」。 */
    var verdict = r.fidelity == null ? null
      : (r.fidelity >= 0.9 ? { k: 'ok', t: '可用于决策' } : (r.fidelity >= 0.8 ? { k: 'warn', t: '仅参考' } : { k: 'bad', t: '不可用于决策' }));
    var info = '<div class="card" style="margin:0"><div class="card-h"><h3>用户信息</h3></div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' +
        '<span class="iv-ava">' + h.esc(r.initial) + '</span>' +
        '<div><div style="font-weight:600;font-size:13.5px">' + h.esc(who) + '</div>' +
        '<div class="td-sub">' + h.esc(r.country) + ' · ' + r.age + ' 岁 · ' + h.esc(r.job) + ' · 月消费 $' + fmt.int(r.spend) + '</div></div></div>' +
      '<div class="dl">' +
        '<dt>画像来源</dt><dd>' + h.esc(POOL_SRC_TEXT[r.source] || r.source) + '</dd>' +
        '<dt>保真度</dt><dd>' + fmt.pct1(r.fidelity) + '　' + (verdict ? h.pill(verdict.k, verdict.t) : '') + '</dd>' +
        '<dt>对话轮数</dt><dd>' + bank.turns.length + ' 轮（本次模拟）</dd>' +
        '<dt>命中 / 已模拟</dt><dd>' + r.hits + ' 次 / ' + r.sims + ' 次</dd>' +
        '<dt>画像标签</dt><dd>' + ((r.tags || []).length
          ? (r.tags || []).map(function (t) { return '<span class="chip">' + h.esc(t) + '</span>'; }).join(' ')
          : '<span class="muted">—</span>') + '</dd>' +
        '<dt>痛点</dt><dd>' + h.esc((r.pains || []).join('、') || '—') + '</dd>' +
      '</div></div>';

    /* 记录只取「这位用户参与过的实验」：按 poolUserIds 反查，不按 persona 近似 —— 挂错人比没有更坏。
     * 这些条目现在是「模拟对象」的入口（点了才出对话），不再跳实验详情弹窗。 */
    var mineList = mine.map(runItem).join('');
    var recCard = '<div class="card" style="margin:0"><div class="card-h"><h3>模拟记录</h3></div>' +
      (mine.length
        ? '<div class="bt-note" style="margin-bottom:8px">结果变化：' + mine.slice().reverse().map(function (x) {
          // 一条链上三种模式的结果口径不同（采纳与否 / 转化率 / 风险档），必须带模式标签，否则「14.2% → 未采纳」像同一把尺子
          return h.esc(runResult(x).replace(/（.*?）/, '') + '（' + x.modeText + '）');
        }).join(' → ') + '</div>' +
          '<div style="display:flex;flex-direction:column">' + mineList + '</div>'
        : '<div class="bt-note">这位用户还没跑过实验，没有可模拟的那一次。</div>') +
      '</div>';

    var right = '<div class="iv-talk-r" style="height:100%;max-height:none;overflow:auto"><div class="sub-h" style="margin-top:0">看板</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px">' + info + recCard + '</div></div>';

    return head + '<div style="padding:0 16px 16px;flex:1;min-height:0;display:flex"><div class="iv-split" style="flex:1;min-height:0">' + left + right + '</div></div></div>';
  }


  /** 多用户模拟：漏斗是这一模式唯一有意义的口径 —— 规模转化掉在哪一环
   * scoped=true 表示 list 已按池中选中的样本过滤过（调用方负责），漏斗必须跟着变，
   * 不能再拿全量实验当代表 —— 否则「表变了、图没变」同屏自相矛盾。
   *
   * 本函数补的三件事（2026-10-17，与舆情 tab 同一批界面修复）：
   *   ① 完整实验列表 —— 漏斗只取样本量最大的一条做代表，另外 N-1 条原先在本屏**完全不出现**，
   *      用户既不知道有几条、也看不到它们各自的结果。列表复用 .kb-card（与单人模式右栏
   *      「模拟记录」同一个类名，同类元素两屏必须长得一样）。
   *   ② 单条详情下钻 —— `simrun-detail` 早已实现（含转化结果与反应样例），
   *      但入口原先只挂在单人 tab，多用户点不开任何一条。
   *   ③ 新建实验入口 —— `pool-new-run` 的弹窗（话术/方案名称 + 前置校验）早已实现，
   *      但全仓 data-act 引用数为 0；而本屏的空态文案还在指路「用选中样本新建一轮多用户实验」。
   */
  function simMultiBlock(list, h, fmt, scoped) {
    var withFunnel = list.filter(function (x) { return x.funnel; });
    /* 新建入口：空态与有数据两种情况都要给 —— 空态尤其要给，否则「换选已跑过的用户，
       或新建一轮实验」这两句指路里，后一句仍是死的。 */
    var newRunBtn = '<button class="btn-ghost sm" data-act="pool-new-run" data-id="multi" style="margin-left:auto">用选中样本新建实验</button>';
    if (!withFunnel.length) {
      return scoped
        ? '<div class="card"><div class="card-h"><h3>多用户实验</h3>' + newRunBtn + '</div>' +
          '<div class="empty"><div class="empty-title">选中的样本在多用户模式下还没有实验</div>' +
          '<div class="empty-sub">换选已跑过的用户，或用右上角「用选中样本新建实验」跑一轮。</div></div></div>'
        : '';
    }
    // 漏斗取样本量最大的实验为代表，避免多实验口径打架
    var top = withFunnel.slice().sort(function (a, b) { return b.sample - a.sample; })[0];
    var f = top.funnel;
    var rows = f.map(function (x, i) {
      var w = (x.value / f[0].value) * 100;
      var prev = i > 0 ? f[i - 1].value : null;
      // 环间流失超 30% 标红：条形长度按绝对占比画时，断点会被视觉上抹平
      var drop = prev ? 1 - (x.value / prev) : 0;
      var color = i === 0 ? '#2563eb' : (drop > 0.3 ? '#dc2626' : '#60a5fa');
      return '<div class="fn"><span class="fn-n">' + h.esc(x.name) + '</span>' +
        '<span class="fn-bar"><i style="width:' + w.toFixed(1) + '%;background:' + color + '"></i></span>' +
        '<span class="fn-v">' + fmt.int(x.value) + (prev ? ' <em' + (drop > 0.3 ? ' class="bad"' : '') + '>转化 ' + fmt.pct1(x.value / prev) + ' · 流失 ' + fmt.pct1(drop) + '</em>' : '') + '</span></div>';
    }).join('');
    // 流失最大的一环（样本→触达 属触达执行口径，不算模拟流失）
    var worst = null;
    for (var i = 1; i < f.length; i++) {
      var d = 1 - (f[i].value / f[i - 1].value);
      if (!worst || d > worst.d) worst = { d: d, from: f[i - 1].name, to: f[i].name };
    }
    var totalAdopt = withFunnel.reduce(function (s, x) { return s + x.adopted; }, 0);
    var totalSample = withFunnel.reduce(function (s, x) { return s + x.sample; }, 0);

    /* ① 完整实验列表：按时间倒序（越近越靠前，与单人模式「模拟记录」同一排法）。
       每条显示时间 · 名称 · 样本 · 转化率 · 状态 · 断点归因，点一条看那次实验的完整明细。
       代表实验（漏斗用的那条）标注出来 —— 否则用户会疑惑「上面那个漏斗是哪来的」。
       2026-10-17：列表改成「全部实验」而不是只有带漏斗的那几条 —— 刚提交、还在跑批的实验
       也得出现在这里，否则提交完看不到任何变化，入口等于假的。 */
    var allRuns = list.slice().sort(function (a, b) {
      var an = String(a.id).indexOf('sr-local-') === 0 ? 1 : 0;
      var bn = String(b.id).indexOf('sr-local-') === 0 ? 1 : 0;
      if (an !== bn) return bn - an;
      return b.dayOffset - a.dayOffset;
    });
    var runList = allRuns.map(function (x) {
      var isTop = x.id === top.id;
      var isNew = String(x.id).indexOf('sr-local-') === 0;
      var dated = isNew ? '刚刚提交' : F.fmtDate(S.TODAY_START + x.dayOffset * S.DAY);
      var meta = x.sample
        ? '样本 ' + fmt.int(x.sample) + ' · 采纳 ' + fmt.int(x.adopted) +
          '（' + fmt.pct1(x.adopted / x.sample) + '）' + (x.personaName && x.personaName !== '—' ? ' · persona ' + h.esc(x.personaName) : '')
        : '尚未产生样本 · 话术：' + h.esc(String(x.body || x.scheme || '').slice(0, 28)) +
          (String(x.body || x.scheme || '').length > 28 ? '…' : '');
      return '<button class="kb-card" data-act="simrun-detail" data-id="' + h.esc(x.id) + '"' +
        (isTop ? ' style="border-color:var(--blue);background:var(--blue-weak)"' : '') + '>' +
        '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="font-size:12.5px;font-weight:600">' + h.esc(dated) + ' · ' + h.esc(x.name) + '</span>' +
        (isNew ? '<span class="pill info">本次提交</span>' : '') +
        (isTop ? '<span class="pill info">漏斗代表</span>' : '') +
        (x.status !== 'done' ? '<span class="pill warn">' + h.esc(x.statusText) + '</span>' : '') +
        '</span>' +
        '<span style="font-size:11.5px;color:var(--sub)">' + meta + '</span>' +
        '<span style="font-size:11.5px;color:var(--sub)">断点 ' + h.esc(x.funnelNote || '待跑批') +
        ' · ' + h.esc(x.statusText) + '</span></button>';
    }).join('');

    return '<div class="grid2"><div class="card"><div class="card-h"><h3>转化漏斗</h3>' +
      '<span class="card-sub">历史档案 · 代表实验「' + h.esc(top.name) + '」· 样本 ' + fmt.int(top.sample) + (scoped ? ' · 已按选中样本筛选' : '') + '</span></div>' +
      '<div class="funnel">' + rows + '</div>' +
      '<div class="chart-legend"><span><i style="background:#2563eb"></i>样本基数</span>' +
      '<span><i style="background:#60a5fa"></i>环间流失 ≤ 30%</span>' +
      '<span><i style="background:#dc2626"></i>环间流失 &gt; 30%（断点）</span></div>' +
      (worst && worst.d > 0.3
        ? '<div class="bt-warn">⚠ 最大流失在「' + h.esc(worst.from) + ' → ' + h.esc(worst.to) + '」，掉 ' + fmt.pct1(worst.d) + ' —— 先修这一环再谈提量。</div>'
        : '<div class="bt-note">各环流失均在 30% 以内，暂无明显断点。</div>') +
      '<div class="bt-note">漏斗单调不增：触达 ≤ 样本、互动 ≤ 触达、采纳 ≤ 互动。上面只画样本量最大的一条，其余 ' +
      (withFunnel.length - 1) + ' 条见下方「实验明细」。</div>' +
      '</div><div class="card"><div class="card-h"><h3>规模口径</h3></div>' +
      '<div class="rb-grid"><div class="rb ok"><i>整体采纳率</i><b>' + fmt.pct2(totalSample ? totalAdopt / totalSample : 0) + '</b><span>合计 ' + fmt.int(totalSample) + ' 样本</span></div>' +
      '<div class="rb"><i>实验数</i><b>' + withFunnel.length + '</b><span>近 14 天</span></div></div>' +
      '<div class="bt-note">多用户模拟的结论强度取决于 persona 数量而非单次样本量；样本再大也补不上 persona 覆盖不足。</div>' +
      '</div></div>' +
      /* ② + ③：实验明细列表（含新建入口）。放在 grid2 之外、占满整行 ——
         列表是这一屏的「历史」，宽度上不该被挤进半栏。 */
      '<div class="card"><div class="card-h"><h3>实验明细</h3>' +
      '<span class="card-sub">' + allRuns.length + ' 条 · 点一条看该次实验的完整结果与反应样例' +
      (scoped ? ' · 已按选中样本筛选' : '') + '</span>' + newRunBtn + '</div>' +
      '<div style="padding:0 16px 16px;display:flex;flex-direction:column">' + runList + '</div></div>';
  }

  /** 舆情传播网络示意（裁切版）：六角密排的球阵**铺出画布边界**，边缘的球被画布
   *  裁掉一半 —— 「这张图是从一张更大的网里截出来的一小块」的感觉。纯静态、不可交互。
   *  中心一团蓝 = 舆情发酵核心区，外围灰 = 未被波及的人群；蓝色范围按画布椭圆域判定。
   *  窗口缩放重画；路由切走（isConnected=false）后重画自动空转。结构示意，非真实个体。 */
  function drawOpNet(retry) {
    var cv = document.querySelector('canvas.sim-opnet-cv');
    if (!cv || !cv.isConnected) return;
    var w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) { // 容器还没布局完（隐藏/未挂载），隔帧重试
      if ((retry || 0) < 10) requestAnimationFrame(function () { drawOpNet((retry || 0) + 1); });
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 局部池：球大、看得少（贴着核心看）；全局池：球小、铺满整池（退远看） */
    var zoom = opNetScope() === 'global' ? 0.58 : 1;
    var c = Math.max(34, Math.min(50, w / 18)) * zoom; // 格距：球更多更密，读起来像人群
    var r0 = c * 0.44;                          // 球径占格距 88%，只留窄缝
    var rowH = c * 0.866;
    var cols = Math.ceil(w / c) + 2, rows = Math.ceil(hgt / rowH) + 2;
    /* 发酵团 = 三个椭圆叶瓣取并集：主体 + 左下/右上两个小瓣，轮廓自然不规则；
     * 边界再叠加确定性抖动打毛（同一画布每次重画形状不变，刷新不闪） */
    /* 全局池视角下整团蓝色按同一比例缩 —— 否则球变小、核心像素不变，
     * 视觉上反而「扩散得更多」，与「退远看」相反。 */
    var lobeK = zoom;
    var lobes = [
      { x: w * 0.50, y: hgt * 0.52, rx: w * 0.26 * lobeK, ry: hgt * 0.55 * lobeK },
      { x: w * 0.29, y: hgt * 0.66, rx: w * 0.15 * lobeK, ry: hgt * 0.40 * lobeK },
      { x: w * 0.71, y: hgt * 0.38, rx: w * 0.16 * lobeK, ry: hgt * 0.42 * lobeK }
    ];
    function coreVal(x, y) {
      var m = 1e9;
      for (var L = 0; L < lobes.length; L++) {
        var nx = (x - lobes[L].x) / lobes[L].rx, ny = (y - lobes[L].y) / lobes[L].ry;
        m = Math.min(m, nx * nx + ny * ny);
      }
      return m; // <1 在团内
    }
    function jitter(i1, i2) { // 确定性 0–1 伪随机（sin hash，无状态）
      var s = Math.sin(i1 * 127.1 + i2 * 311.7) * 43758.5453;
      return s - Math.floor(s);
    }
    ctx.lineWidth = 1.4;
    for (var ir = -1; ir < rows; ir++) {
      for (var ic = -1; ic < cols; ic++) {
        var x = ic * c + (ir & 1 ? c / 2 : 0) + c * 0.25; // 起点 -1 圈 + 偏移：四边都有半球被裁
        var y = ir * rowH + rowH * 0.25;
        var inCore = coreVal(x, y) < 1 + (jitter(ir + 7, ic + 13) - 0.5) * 0.55;
        // 软阴影（只上色用），描边关阴影 —— 球有一点厚度，不贴纸
        ctx.save();
        ctx.shadowColor = 'rgba(30,45,90,0.13)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.arc(x, y, r0, 0, 6.2832);
        ctx.fillStyle = inCore ? '#4a6fc8' : '#e9ecf1';
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, r0, 0, 6.2832);
        ctx.strokeStyle = inCore ? '#2e4a8f' : '#99a1b5';
        ctx.stroke();
      }
    }
    // 画布四周渐隐过渡：球阵在边缘淡出（对画布内容做 destination-out 软遮罩，
    // 不写死背景色，卡片底色是什么就融进什么）
    var f = 36;
    ctx.globalCompositeOperation = 'destination-out';
    var fades = [
      [0, 0, 0, f], [0, hgt, 0, hgt - f], // 上、下
      [0, 0, f, 0], [w, 0, w - f, 0]      // 左、右
    ];
    for (var fi = 0; fi < fades.length; fi++) {
      var fg = ctx.createLinearGradient(fades[fi][0], fades[fi][1], fades[fi][2], fades[fi][3]);
      fg.addColorStop(0, 'rgba(0,0,0,1)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, hgt);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function opNetScope() { return window.OP_NET_SCOPE === 'global' ? 'global' : 'local'; }
  /** 区域分析（2026-10-18）：真实国界的世界地图上按地区看反应。
   * 底图取 amCharts worldLow（176 个国家/地区轮廓，内联在 assets/world-map.js ——
   * file:// 离线原型既不能拉 CDN，也不能 fetch 本地 svg，所以只能当脚本引进来）。
   * 地区就是地图上的国家本身：点一下选中/取消，选中的国家整块填品牌蓝。
   * 原来地图下方那排地区 chip 已按业主要求删掉（「下面标签删了」）。 */
  /* 底图 176 国/地区的中文名（2026-10-18「没数据的添加数据」后，地图上每个国家都是一条可分析的
   * 地区 —— 名字不能只对原来那 27 个友好）。取不到就退回底图自带的英文名。 */
  var MAP_CN_NAME = {
    AE: '阿联酋', AF: '阿富汗', AL: '阿尔巴尼亚', AM: '亚美尼亚', AO: '安哥拉', AR: '阿根廷', AT: '奥地利', AU: '澳大利亚', AZ: '阿塞拜疆',
    BA: '波黑', BD: '孟加拉国', BE: '比利时', BF: '布基纳法索', BG: '保加利亚', BI: '布隆迪', BJ: '贝宁', BN: '文莱', BO: '玻利维亚', BR: '巴西',
    BS: '巴哈马', BT: '不丹', BW: '博茨瓦纳', BY: '白俄罗斯', BZ: '伯利兹', CA: '加拿大', CD: '刚果（金）', CF: '中非', CG: '刚果（布）', CH: '瑞士',
    CI: '科特迪瓦', CL: '智利', CM: '喀麦隆', CN: '中国', CO: '哥伦比亚', CR: '哥斯达黎加', CU: '古巴', CY: '塞浦路斯', CZ: '捷克', DE: '德国',
    DJ: '吉布提', DK: '丹麦', DO: '多米尼加', DZ: '阿尔及利亚', EC: '厄瓜多尔', EE: '爱沙尼亚', EG: '埃及', EH: '西撒哈拉', ER: '厄立特里亚', ES: '西班牙',
    ET: '埃塞俄比亚', FK: '福克兰群岛', FI: '芬兰', FJ: '斐济', FR: '法国', GA: '加蓬', GB: '英国', GE: '格鲁吉亚', GF: '法属圭亚那', GH: '加纳',
    GL: '格陵兰', GM: '冈比亚', GN: '几内亚', GQ: '赤道几内亚', GR: '希腊', GT: '危地马拉', GW: '几内亚比绍', GY: '圭亚那', HN: '洪都拉斯', HR: '克罗地亚',
    HT: '海地', HU: '匈牙利', ID: '印尼', IE: '爱尔兰', IL: '以色列', IN: '印度', IQ: '伊拉克', IR: '伊朗', IS: '冰岛', IT: '意大利',
    JM: '牙买加', JO: '约旦', JP: '日本', KE: '肯尼亚', KG: '吉尔吉斯斯坦', KH: '柬埔寨', KP: '朝鲜', KR: '韩国', KW: '科威特', KZ: '哈萨克斯坦',
    LA: '老挝', LB: '黎巴嫩', LK: '斯里兰卡', LR: '利比里亚', LS: '莱索托', LT: '立陶宛', LU: '卢森堡', LV: '拉脱维亚', LY: '利比亚', MA: '摩洛哥',
    MD: '摩尔多瓦', ME: '黑山', MG: '马达加斯加', MK: '北马其顿', ML: '马里', MM: '缅甸', MN: '蒙古', MR: '毛里塔尼亚', MW: '马拉维', MX: '墨西哥',
    MY: '马来西亚', MZ: '莫桑比克', NA: '纳米比亚', NC: '新喀里多尼亚', NE: '尼日尔', NG: '尼日利亚', NI: '尼加拉瓜', NL: '荷兰', NO: '挪威', NP: '尼泊尔',
    NZ: '新西兰', OM: '阿曼', PA: '巴拿马', PE: '秘鲁', PG: '巴布亚新几内亚', PH: '菲律宾', PK: '巴基斯坦', PL: '波兰', PR: '波多黎各', PS: '巴勒斯坦地区',
    PT: '葡萄牙', PY: '巴拉圭', QA: '卡塔尔', RO: '罗马尼亚', RS: '塞尔维亚', RU: '俄罗斯', RW: '卢旺达', SA: '沙特', SB: '所罗门群岛', SD: '苏丹',
    SE: '瑞典', SI: '斯洛文尼亚', SJ: '斯瓦尔巴和扬马延', SK: '斯洛伐克', SL: '塞拉利昂', SN: '塞内加尔', SO: '索马里', SR: '苏里南', SS: '南苏丹', SV: '萨尔瓦多',
    SY: '叙利亚', SZ: '斯威士兰', TD: '乍得', TF: '法属南部领地', TG: '多哥', TH: '泰国', TJ: '塔吉克斯坦', TL: '东帝汶', TM: '土库曼斯坦', TN: '突尼斯',
    TR: '土耳其', TT: '特立尼达和多巴哥', TW: '台湾', TZ: '坦桑尼亚', UA: '乌克兰', UG: '乌干达', US: '美国', UY: '乌拉圭', UZ: '乌兹别克斯坦', VE: '委内瑞拉',
    VN: '越南', VU: '瓦努阿图', XK: '科索沃', YE: '也门', ZA: '南非', ZM: '赞比亚', ZW: '津巴布韦'
  };
  /* 区域分析总开关：这是新加的功能，让用户自己决定「用不用」（2026-10-18 业主）。
   * **默认落在「不启用」**，而地图照常可点 —— 业主原话「默认可点，就是不启用」：
   * 这个开关是用户的**表态**（有没有主动启用过这个新功能），不门控地图的交互与外观。 */
  function opRegionOn() { return window.OP_REGION_ON === true; }
  function opRegionSel() { return (window.OP_REGION_SEL || []).slice(); }
  function opinionRegionCard(list, h, fmt) {
    /* 2026-10-18 业主「不要这个」：悬停不再给「提及 · 负面」那一串 —— tooltip 只留地名。
     * 2026-10-18 晚修：每地区的提及量改成**从本屏实验总量按权重分配**，不再各自 420~8,020 独立撒 ——
     * 那样卡头会冒出一个 758,108，跟看板的口径（已完成实验的提及总量）差 37 倍，同一屏两个「提及」。
     * 权重仍是确定性的（同文案同地区恒定），分配用最大余数法，保证各地区之和 = 卡头总量。 */
    function regionW(rg) { return 420 + fnv01('vol|' + rg.k) * 7600; }
    var on = opRegionOn();
    var sel = opRegionSel();
    var WM = window.WORLD_MAP || { w: 1008.3, h: 650.9, paths: [] };
    /* 总量取**已完成**的舆情实验（与看板头条同一个口径）；一次都没跑完时退回全部 */
    var doneRuns = (list || []).filter(function (x) { return x.status === 'done'; });
    var volRuns = doneRuns.length ? doneRuns : (list || []);
    var totalVol = volRuns.reduce(function (s, x) { return s + (x.sample || 0); }, 0);

    /* 地图上每个国家/地区都是一条「可分析的地区」（2026-10-18 业主：没数据的添加数据）——
     * 之前只有 27 个中文名地区可点、其余 149 国是本卡没数据的死区；现在 176 国全部可点、
     * 全部参与提及量分配（权重确定性派生）。key = ISO 小写；
     * window.OP_REGION_SEL 就是这串被选中的地区 key。 */
    var REGIONS = WM.paths.map(function (p) {
      return { k: String(p[0]).toLowerCase(), iso: String(p[0]), n: MAP_CN_NAME[String(p[0])] || p[1] };
    });
    /* 新加坡（业主：先补新加坡一个点）：底图 worldLow 里没有它的轮廓，按**实测标定**的 mercator
     * 投影单独补一个小圆点。标定法见 _walk/_diag-projection.cjs：用 14 国的真实经纬度范围 +
     * SVG getBBox 回归出 x = 2.8031·lon + 475.53、y = 463.68 − 159.82·m(lat)（m = ln tan(π/4+φ/2)），
     * 各国残差 < 1 个单位。新加坡 103.8198°E / 1.3521°N → (766.6, 459.6)，
     * 正落在马来半岛南端（1.26°N 尖角 y≈460.2）东侧 —— 与邻近国家局部标定的结果一致（±0.6）。
     * 它同样是一条完整的「地区」。 */
    var SG_REG = { k: 'sg', iso: 'SG', n: '新加坡', x: 766.6, y: 459.6 };
    REGIONS.push(SG_REG);
    var REG_BY_KEY = {};
    REGIONS.forEach(function (r) { REG_BY_KEY[r.k] = r; });
    var rows = REGIONS.length;
    /* 按权重把总量分到各地区（整数，合计必须等于 totalVol） */
    var wSum = REGIONS.reduce(function (s, rg) { return s + regionW(rg); }, 0) || 1;
    var fracs = [], given = 0, ALLOC = {};
    REGIONS.forEach(function (rg) {
      var raw = regionW(rg) / wSum * totalVol;
      var fl = Math.floor(raw);
      ALLOC[rg.k] = fl; given += fl;
      fracs.push({ k: rg.k, r: raw - fl });
    });
    fracs.sort(function (a, b) { return b.r - a.r; });
    for (var ai = 0; ai < totalVol - given; ai++) ALLOC[fracs[ai % fracs.length].k]++;

    /* 点地图上的国家 = 选中/取消（业主：鼠标点上面的地区，而不是点下方标签）。
     * 选中只表现为整块填色 —— 新加坡那个点是唯一例外（底图画不出它，只能用一个圆点顶替国家轮廓）。
     * 卡头那个开关是表态、不门控：不管停在「不启用」还是「启用」，地图都照常可点可悬停。 */
    var mapBody = WM.paths.map(function (p) {
      var key = String(p[0]).toLowerCase();
      var rg = REG_BY_KEY[key];
      var picked = sel.indexOf(key) > -1;
      return '<path d="' + p[2] + '" class="cty' + (picked ? ' hl' : '') + '" data-act="op-region" data-id="' + h.esc(key) + '"' +
        (picked ? ' style="fill:var(--blue,#2563eb)"' : '') + '><title>' +
        h.esc(rg.n) + '</title></path>';
    }).join('');
    var sgPicked = sel.indexOf('sg') > -1;
    var sgDot = '<circle class="cty' + (sgPicked ? ' hl' : '') + '" cx="' + SG_REG.x + '" cy="' + SG_REG.y + '" r="5"' +
      ' data-act="op-region" data-id="sg"' + (sgPicked ? ' style="fill:var(--blue,#2563eb)"' : '') + '><title>' +
      h.esc(SG_REG.n) + '</title></circle>';

    /* 卡头**只有标题 + 开关**（业主：开关要「单独的」，别跟地区指标挤一行）；
     * 地区指标（N 个地区 · 提及 · 已选）与「清空选择」在地图下方一整行。
     * 开关样式沿用传播网络那张卡；默认停在「不启用」（业主：默认可点，就是不启用）。 */
    var sw = '<div class="view-sw" style="margin-left:auto">' +
      [['off', '不启用'], ['on', '启用']].map(function (x) {
        return '<button class="vs-btn' + ((on ? 'on' : 'off') === x[0] ? ' on' : '') + '" data-act="op-region-on" data-id="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    /* 选完要有回音：原来点地区只多一个「已选 N」，看板一动不动 —— 等于选了个寂寞。
       现在至少给出所选地区的提及量与其占比（都用同一份分配结果算，不会与卡头总量打架）。 */
    var selVol = sel.reduce(function (s, k) { return s + (ALLOC[k] || 0); }, 0);
    var sub = rows + ' 个地区 · 提及 ' + fmt.int(totalVol) + '（按已完成实验的提及量分配）' +
      (sel.length ? ' · 已选 ' + sel.length + ' 个 · 提及 ' + fmt.int(selVol) +
        '（占 ' + Math.round(selVol / (totalVol || 1) * 100) + '%）' : '');
    return '<div class="card"><div class="card-h"><h3>区域分析</h3>' + sw + '</div>' +
      '<div class="op-map-wrap"><svg class="op-map" viewBox="0 0 ' + WM.w + ' ' + WM.h + '" role="img" aria-label="世界地图，按地区查看舆情反应">' +
        mapBody + sgDot +
      '</svg></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:10px">' +
        '<span class="card-sub" style="margin-left:0;text-align:left">' + sub + '</span>' +
        (sel.length ? '<button class="lnk" style="margin-left:auto" data-act="op-region" data-id="">清空选择</button>' : '') +
      '</div>' +
      '</div>';
  }

  function opinionNetGraph(list, h) {
    if (!global.__opNetBound) { // 窗口缩放 → 画布重排（画布不在 DOM 时自动空转）
      global.__opNetBound = 1;
      global.addEventListener('resize', function () { drawOpNet(); });
    }
    requestAnimationFrame(function () { drawOpNet(); }); // HTML 注入后的第一帧再量尺寸
    /* 2026-10-17：卡头右侧加「局部池 / 全局池」切换 —— 同一张网换个视野看：
     *   局部池 = 贴到发酵核心区看（球大、视野窄）；
     *   全局池 = 退到全池看（球小、范围广），同一团蓝色在整池里占多大一眼能比出来。
     * 图仍是结构示意（不承载具体个体），变的是视野，不是数字。 */
    var sc = opNetScope();
    var sw = '<div class="view-sw" style="margin-left:auto">' +
      [['local', '局部池'], ['global', '全局池']].map(function (x) {
        return '<button class="vs-btn' + (sc === x[0] ? ' on' : '') + '" data-act="op-net-scope" data-id="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    return '<div class="card"><div class="card-h"><h3>传播网络示意</h3>' +
      '<span class="card-sub" style="margin-left:0">结构示意 · 不承载个体数据</span>' + sw + '</div>' +
      '<canvas class="sim-opnet-cv" style="width:100%;height:190px;display:block" aria-label="企业样本与全局样本分布示意图"></canvas>' +
      '<div class="chart-legend"><span><i style="background:#4a6fc8"></i>企业样本</span>' +
      '<span><i style="background:#e9ecf1"></i>全局样本</span></div>' +
      '</div>';
  }

  /** 舆情预测：本块只出「这一屏的评估链」——传播网络 → 区域分析。
   *  原来的「负面情绪占比」逐条列表与「投放前检查」两块已于 2026-10-18 按业主指令整块删除
   *  （历史实验台账是另一个视角，挂在评估流下面会被读成「本次评估的结论」）。
   *  因此下钻（ACTIONS['simrun-detail'] 的 opinion 分支）本屏不再有入口；风险分级口径
   *  （负>40% 高 / 20–40% 中 / <20% 低）仍由该详情分支与多用户实验明细使用，未改动。 */
  function simOpinionBlock(list, h, fmt) {
    if (!list.length) return '';
    /* 2026-10-18 业主：「舆情下面这一整块删了」——
       原 `.grid2`（左「负面情绪占比」逐条列表、右「投放前检查」三格 + 警告 + 合规检查入口）整块退场。
       理由：这一屏要回答的是「这段文案投出去会不会翻车」，历史实验台账与投放前检查是另一个视角，
       挤在评估流下面会被读成「本次评估的结论」。舆情 tab 只保留评估链本身：待评估内容 → 传播网络 → 区域分析。
       注意：逐条下钻（ACTIONS['simrun-detail'] 的 opinion 分支）在本屏已无入口，仅多用户「实验明细」可达。
     * 2026-10-18 晚（结构）：改成「总—分—总」—— 结论头条插到「待评估内容」之后（先给判断），
       再看传播网络 / 区域（范围），然后才是五章证据与收口。原来结论压在 1451px，第一屏看不到答案。 */
    var P = (global.OP_BOARD && global.OP_BOARD.parts) ? global.OP_BOARD.parts(list) : null;
    /* 结论默认走案例复盘，这两张卡却是「当前实验样本」的——不标一句，读者会把 177 个地区当成案例的地理分布 */
    var isCase = !!(P && P.d && P.d.src === 'case');
    var scope = '<div class="op-scope">评估范围 · ' + (isCase
      ? '当前实验样本（与上面的案例复盘不同源，各算各的）'
      : '本屏实验样本') + '</div>';
    /* 结论头条排在「区域分析」下面（业主 2026-10-18 21:23）：先看范围与样本分布，再进判读。
       所以这里不再返回 {head, body}，而是按页面顺序拼好一整段。 */
    return scope +
      opinionNetGraph(list, h) +
      opinionRegionCard(list, h, fmt) +
      (P ? P.head : '') +
      /* v37：11 层分析看板（环形 / 饼图 / 树图 / 矩阵 / 曲线）。模块独立成 assets/v37-op-board.js，
         拿不到就静默跳过 —— 舆情屏不至于因为一个可选模块缺失而白屏。 */
      (P ? P.body : '');
  }

  RENDERERS.simUserPage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets().persona_sim;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';
    var rows = t.rows;

    // persona 同源反查表（供实验区块/弹窗使用，不复制保真度）
    var SIM_PERSONAS = {};
    rows.forEach(function (x) { SIM_PERSONAS[x.id] = { name: x.name, fidelity: x.fidelity, fidelityScope: x.fidelityScope }; });
    window.SIM_PERSONAS = SIM_PERSONAS;

    // 当前模拟模式（single / multi / opinion），随 tab 切换
    var mode = state.simMode || 'single';
    var modeRuns = simRunsAll().filter(function (x) { return x.mode === mode; });
    var selIds = window.SIM_POOL_SEL || [];

    /* 「选人」必须真的改变这一屏的每一块 —— 专属内容区、判定/回放都要跟着变，
     * 不能出现「选人变了、图没变」的同屏自相矛盾。
     * 口径：只在单人/多用户两个 tab 生效，且必须先勾了人；未勾选时保持全量历史。
     * 2026-10-09 按设计稿要求删掉了「模式 + 引擎」横幅与顶部三张 KPI 卡（单人模拟实验 / 已选样本 / 池内已具名）——
     * 那一排是台账口径（有多少实验、池子里几个人），回答不了「这个人会怎么反应」；
     * 模式与引擎分工改由模式 tab + 单人卡头的「LLM 逐条生成」承担，不要在本函数里再补回来。 */
    var poolActive = (mode === 'single' || mode === 'multi') && selIds.length
      ? (mode === 'single' ? selIds.slice(0, 1) : selIds) : [];
    var byPool = poolActive.length > 0;
    function poolFilter(list) {
      if (!byPool) return list;
      return list.filter(function (x) {
        var ids = x.poolUserIds || [];
        return ids.some(function (u) { return poolActive.indexOf(u) > -1; });
      });
    }
    var modeRunsShown = poolFilter(modeRuns);

    /* 单人模式的产物已经改成「所选用户的对话回放」，persona 模板样例不再渲染 ——
     * 两者并排会抢同一个口径（到底是这个人的反应，还是模板池的样例）。 */
    var modeBlock;
    if (mode === 'single') {
      modeBlock = '';
    } else if (mode === 'multi') {
      modeBlock = simMultiBlock(modeRunsShown, h, fmt, byPool);
    } else {
      /* 舆情：评估范围 → 传播网络 → 区域分析 → 结论头条 → 五章证据 → 收口（顺序由 simOpinionBlock 自己拼） */
      modeBlock = simOpinionBlock(modeRuns, h, fmt);
    }

    // 单人 / 多用户两个 tab 都要先在池里选人：单人 1 位，多用户多位
    /* 单人模拟分两幕（2026-10-17 业主定）：先在池里挑人 →「确认，开始 LLM 处理」→ 池卡退场、对话回放卡顶上。
     * 之前两幕是并排的：点完确认，池卡还占着 887px，回放卡被顶到 1108px（视口外）——
     * 点了按钮屏幕上什么都没变，以为没生效。stage 由 window.SIM_SINGLE_STAGE 记，回放卡头上可「换一位用户」。 */
    var stageReplay = mode === 'single' && window.SIM_SINGLE_STAGE === 'replay'
      && (window.SIM_POOL_SEL || []).length && isJudged(window.SIM_POOL_SEL[0]);
    var poolHtml = (mode === 'single' || mode === 'multi')
      ? (stageReplay ? '' : simPoolBlock(h, fmt, state))
      : '';
    // 判定结果：单人 tab 只看选中的那一位，多用户 tab 看全部选中的
    // 单人：产物是「所选用户的对话回放」（LLM 生成）；多用户：产物是 Jev 判定卡
    /* 回放卡只在「已进入」这一幕渲染：池子阶段挂一张「尚未运行」的空卡，会被读成"已经跑过了"。 */
    var judgeHtml = (mode === 'single' && stageReplay) ? singleReplayCard(h, fmt) : '';

    /* 页头主按钮随模式走（2026-10-17）：
       原先三个 tab 一律挂 `sim-new-persona`（文案「新建 persona」，来自 cap.action）。
       单人/多用户要在池里选人，这个按钮是对的；但舆情 tab **没有用户池、不选 persona**
       （判定对象是文案本身），整屏唯一可点的按钮却是「新建一个这一屏用不上的东西」——
       纯语义错位。改为：舆情 → 新建舆情实验（pool-new-run 的舆情专用分支，弹窗早已实现）。
       pool-new-run 不传 data-id 时会 fallback 到 state.simMode，当前正是 'opinion'，
       所以走的就是舆情分支（内容名 + 投放渠道），不会误入需要勾样本的分支。 */
    var isOpinion = mode === 'opinion';
    return pageHead(h, cap, {
      desc: cap.desc + ' · 三种模拟模式回答三个不同问题',
      side: '<span class="side-note" data-tip="persona 为配置态资产；保真度为与真实历史对比结论，不提供时间序列指标。">配置态数据 · 无时间维度</span>',
      action: isOpinion ? 'pool-new-run' : 'sim-new-persona',
      actionText: isOpinion ? '新建舆情实验' : null
    }) +
      simModeTab(h, mode) +
      (mode === 'single' ? '' : simBriefCard(mode, h)) +
      poolHtml +
      judgeHtml +
      modeBlock +
      h.metaBar({}, [
        { k: '数据性质', v: 'persona 为配置态资产；保真度来自与真实历史数据的对比结论' },
        { k: '实验口径', v: '保真度与 persona 同源反查，不复制；转化率 = 采纳/样本 即时计算；舆情风险分级：负>40% 高 / 20-40% 中 / <20% 低' },
        { k: '模拟产物', v: '对话模拟为预演，不写入实验记录；引用某次记录时，对象按那次的口径' },
        { k: '可信度规则', v: '保真度 ≥90% 可用于决策；80–90% 仅参考需交叉验证；<80% 不可用于决策；超出适用边界的 persona 结论同样不可信' }
      ]);
  };

  /* SECTION: r-survey-page
   * AI 访谈任务 —— 任务视角：用户点开是想知道「派出去的访谈有没有人接、结论可不可信」。
   * 聚焦：触达 → 回复 → 有效咨询；按回复率做触达诊断，点开任务看意向分级与逐份结论。
   */
  RENDERERS.surveyPage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets().survey;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';
    var rows = t.rows;
    var running = rows.filter(function (r) { return r.status === 'info' || r.status === 'warn'; });
    var reachedAll = rows.reduce(function (s, r) { return s + nNum(r.reached, 0); }, 0);
    var consultedAll = rows.reduce(function (s, r) { return s + nNum(r.consulted, 0); }, 0);
    var gotReply = rows.reduce(function (s, r) { return s + nNum(r.replied, 0); }, 0);
    /* 回复率必须按人数加权：简单平均与同页写的口径（已回复 ÷ 已触达）算不出同一个数，
       实测简单平均 64.2% vs 加权 68.1%，两个数并存会让用户无法对账 */
    var avgReply = reachedAll ? gotReply / reachedAll : 0;

    function nNum(v, d) { var x = Number(v); return isFinite(x) ? x : d; }
    function chLabel(c) { return { im: 'IM', wecom: '企微', sms: '短信' }[c] || c; }
    function channelsText(r) { return (r.channels || []).map(chLabel).join(' / ') || '—'; }
    function segName(id) {
      var segs = (pipes().userops && pipes().userops.segments) || [];
      for (var i = 0; i < segs.length; i++) if (segs[i].id === id) return segs[i].name;
      return id || '—';
    }
    function verdict(r) {
      if (!nNum(r.reached, 0)) return { k: 'idle', t: '待触达' };
      if (nNum(r.replyRate, 0) < 0.5) return { k: 'bad', t: '偏低' };
      if (nNum(r.replyRate, 0) < 0.7) return { k: 'warn', t: '有待跟进' };
      return { k: 'ok', t: '触达健康' };
    }
    function intentText(r) {
      var it = r.intent || {};
      return '高 ' + fmt.int(nNum(it.high, 0)) + ' · 中 ' + fmt.int(nNum(it.mid, 0)) + ' · 低 ' + fmt.int(nNum(it.low, 0));
    }
    function sourceText(r) {
      var s = r.listSource || {};
      if (s.kind === 'import') return '导入 ' + h.esc(s.file || '—') + '（' + fmt.int(nNum(s.count, 0)) + '）';
      return '分群 · ' + h.esc(segName(s.segId));
    }
    function deliveryText(r) {
      var d = r.delivery || {}, out = [];
      if (d.dispatch) out.push('AI 派发');
      if (d.selfserve) out.push('自助入口');
      return out.length ? out.join(' + ') : '—';
    }

    var cols = t.columns.map(function (c) {
      var out = Object.assign({}, c);
      if (c.key === 'name') out.render = function (r) { return '<button class="lnk" data-act="survey-result" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'; };
      else if (c.key === 'listSource') out.render = sourceText;
      else if (c.key === 'delivery') out.render = deliveryText;
      else if (c.key === 'reached') out.render = function (r) { return fmt.int(nNum(r.reached, 0)); };
      else if (c.key === 'replyRate') out.render = function (r) { var v = nNum(r.replyRate, 0); return '<span class="' + (v < 0.5 ? 'bad' : (v < 0.7 ? 'warn' : '')) + '">' + fmt.pct1(v) + '</span>'; };
      else if (c.key === 'consulted') out.render = function (r) { return fmt.int(nNum(r.consulted, 0)); };
      else if (c.key === 'intent') out.render = intentText;
      /* 已回收只报自己的数，「回收目标」有独立列 —— 两处都写 quota 会在一行里重复同一个数 */
      else if (c.key === 'collected') out.render = function (r) { return fmt.int(nNum(r.collected, 0)); };
      else if (c.key === 'finishRate') out.render = function (r) { return '<span class="' + (r.finishRate < 0.7 ? 'bad' : (r.finishRate < 0.8 ? 'warn' : '')) + '">' + fmt.pct1(r.finishRate) + '</span>'; };
      else if (c.key === 'status') out.render = function (r) { return h.pill(r.status, r.statusText); };
      /* 兜底也要尊重列上声明的 fmt —— 否则「回收目标 2500」与旁边「已触达 2,680」千分位不一致 */
      else out.render = function (r) {
        var v = r[c.key];
        if (v != null && c.fmt && typeof h.fmt[c.fmt] === 'function') return h.esc(h.fmt[c.fmt](v));
        return h.esc(String(v != null ? v : ''));
      };
      return out;
    });
    cols.splice(cols.length - 1, 0, { key: 'judge', label: '触达诊断', render: function (r) { var v = verdict(r); return h.pill(v.k, v.t); } });

    var attRows = rows.slice().sort(function (a, b) { return nNum(a.replyRate, 0) - nNum(b.replyRate, 0); })
      .filter(function (r) { return nNum(r.consulted, 0) === 0 || nNum(r.replyRate, 0) < 0.7; });
    var attHtml = attRows.length
      ? '<div class="card"><div class="card-h"><h3>回复最差</h3>' +
        '<span class="card-sub">回复率最低 / 有效咨询为 0 的任务 · 点开看卡在渠道还是话术</span></div>' +
        '<div class="ab-list">' + attRows.map(function (r) {
          return '<button class="ab-item" data-act="survey-result" data-id="' + h.esc(r.id) + '">' +
            '<b>' + h.esc(r.name) + '</b><span>回复率 ' + fmt.pct1(nNum(r.replyRate, 0)) + '</span>' +
            '<span class="ab-why">' + h.esc(nNum(r.consulted, 0) === 0 ? '有效咨询为 0' : '走过渠道：' + channelsText(r)) + '</span>' +
            '<span class="ab-go">看结论 →</span></button>';
        }).join('') + '</div></div>'
      : '';

    return pageHead(h, cap, {
      side: '<span class="side-note" data-tip="访谈任务为配置态资产；已触达 / 回复率 / 有效咨询为累计运行结果，不提供时间序列指标。">配置态数据 · 无时间维度</span>',
      action: 'create-open'
    }) + global.UI.sessionNewBlock(state, h, 'survey', {
      title: '本会话新建的访谈任务',
      cols: function (o) { return o.meta || ''; }
    }) +
      '<div class="metrics">' + [
        { label: '访谈任务数', value: String(rows.length), sub: running.length + ' 进行中' },
        { label: '已触达', value: fmt.int(reachedAll), sub: '汇总于全部任务' },
        { label: '平均回复率', value: fmt.pct1(avgReply), alert: avgReply < 0.6, sub: '按人数加权 · 有效咨询 ' + fmt.int(consultedAll) + ' · 低于 60% 需先查渠道与话术' }
      ].map(h.metricCard).join('') + '</div>' +
      attHtml +
      '<div class="card pad0"><div class="card-h pad"><h3>全部访谈任务</h3>' +
      '<span class="card-sub">' + rows.length + ' 条 · 点击任务名查看触达、意向分级与逐份结论</span></div>' +
      h.table({ columns: cols, rows: rows, sortBy: state.sortKey, sortDir: state.sortDir, page: state.page || 1, pageSize: 20, emptyTitle: '暂无访谈任务' }) + '</div>' +
      h.metaBar({}, [
        { k: '数据性质', v: '访谈任务配置为配置态；已触达 / 回复率 / 有效咨询 / 意向分级为累计运行结果' },
        { k: '回复率口径', v: '回复率 = 已回复 ÷ 已触达（预计算写入数据，除零兜底）；有效咨询 = 完成多轮追问且结论可用的人数' },
        { k: '名单与交付', v: '名单来源复用运营分群圈人或名单导入；交付方式含 AI 派发与自助入口链接（二维码为占位示意）' }
      ]);
  };

  /* SECTION: r-kb-page
   * 企业知识库 —— 任务视角：用户点开是想知道「Agent 检索会不会答错、缺口在哪」。
   * 两个视图：list（需关注库 + 指标 + 证据表）/ test（检索测试：查不到是内容缺口还是生成环节问题）。
   * 检索测试为独立视图，参数存 state.kb 实时重算（调整即刷新结果）。
   */
  /* v26 的知识库网格卡（KBDESK.libHtml，见 v26-kb-desk.js）卡面上**没有结论位** ——
     「停用」只写进了卡的 aria-label，肉眼一个字都不变：用户点了停用，卡片照旧。
     v26-kb-desk.js 不在本次改动范围内，所以在这里对 KBDESK 自己写出的卡面做一次**定向补齐**：
     给已停用的库卡插一个可见 pill。定位靠 KBDESK 写出的稳定属性 data-kbi="kb|<id>"；
     该卡内部没有嵌套 <div>，所以它之后的第一个 </div> 就是卡尾。
     （更彻底的做法是直接改 v26 的 libHtml，见交付报告 §六） */
  function kbGridWithOffPill(html, dis) {
    var out = String(html == null ? '' : html), ids = Object.keys(dis || {});
    for (var i = 0; i < ids.length; i++) {
      var at = out.indexOf('data-kbi="kb|' + ids[i] + '"');
      if (at < 0) continue;
      var end = out.indexOf('</div>', at);
      if (end < 0) continue;
      out = out.slice(0, end) + '<span class="pill idle">已停用</span>' + out.slice(end);
    }
    return out;
  }

  RENDERERS.kbPage = function (cap, state, h) {
    var fmt = h.fmt;
    var t = assets().kb;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2><p>' + h.esc(cap.table) + '</p></div>';
    /* v17 批 A：会话新建并已发布的库，叠加进列表（data.js 是纯函数、无 state，只能在渲染层做） */
    var rows = (global.KB_SESSION && global.KB_SESSION.listOverlay) ? global.KB_SESSION.listOverlay(state, h, t.rows) : t.rows;
    var st = state.kb || {};
    var view = st.view || 'list';
    var k7 = Q.kpi('7d');
    var totalDocs = rows.reduce(function (s, r) { return s + ((global.KB_SESSION && global.KB_SESSION.docCountOf) ? global.KB_SESSION.docCountOf(h, r) : r.docs); }, 0);
    var totalChunks = rows.reduce(function (s, r) { return s + r.chunks; }, 0);
    var totalHits = rows.reduce(function (s, r) { return s + r.hits; }, 0);
    var avgZero = rows.length ? rows.reduce(function (s, r) { return s + r.zeroRate; }, 0) / rows.length : 0;
    var k = Q.kpi(state.range);
    /* v10b（走查 status 单一来源）+ v26：零结果率的**三处刻度收成一处**。
       旧写法：需关注筛选用内联 0.045、结论列用 0.05 / 0.03、KPI 告警另取 DECISIONS 的 0.05
       —— 于是 zeroRate 落在 0.045–0.05 的库会「进了需关注清单、结论列却写健康」。
       现在：告警线取 decisions.js（全站唯一真源），注意线是它的 0.6 倍，三处同源。 */
    var ZERO_WARN = (global.DECISIONS && global.DECISIONS.value) ? global.DECISIONS.value('知识库检索', '零结果率_告警', 0.05) : 0.05;
    var ZERO_NOTICE = +(ZERO_WARN * 0.6).toFixed(4);
    /* 会话内的整库停用（详情页 kb-disable 写 state.kbDisabled）—— 结论列与「需关注」清单
       必须与它同读一份状态：停用 = 已移出检索池，再把它列进「需关注（去检索测试）」
       等于催人去修一个已经停掉的库。 */
    var kbDis = (state && state.kbDisabled) || {};
    var kbOffN = rows.filter(function (r) { return kbDis[r.id]; }).length;
    /* 判据统一用 >=：原来这里用 >、verdict 用 >=，边界值上两处会分叉。 */

    function verdict(r) {
      if (kbDis[r.id]) return { k: 'idle', t: '已停用' };
      if (r.status !== 'ok') return { k: r.status === 'bad' ? 'bad' : 'warn', t: r.statusText };
      if (r.zeroRate >= ZERO_WARN) return { k: 'warn', t: '内容缺口' };
      if (r.zeroRate >= ZERO_NOTICE) return { k: 'ok', t: '注意' };
      return { k: 'ok', t: '健康' };
    }

    var head = '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div></div>' +
      '<div class="ph-side">' +
      '<div class="view-sw" role="group">' +
      '<button class="vs-btn' + (view === 'list' ? ' on' : '') + '" data-act="kb-view" data-id="list">概览</button>' +
      '<button class="vs-btn' + (view === 'test' ? ' on' : '') + '" data-act="kb-view" data-id="test">检索测试</button>' +
      '</div>' +
      (view === 'list' ? h.rangePicker(state.range) : '') +
      '<button class="btn-primary" data-act="create-open" data-create="knowledge" data-primary-action>' + h.esc(cap.action) + '</button>' +
      '</div></div>' + global.UI.sessionNewBlock(state, h, 'knowledge', {
        title: '本会话新建的知识库',
        labelOf: function (o) { return (global.KB_SESSION && global.KB_SESSION.isPublic(h, o.id)) ? '可用' : '草稿态'; },
        kindOf: function (o) { return (global.KB_SESSION && global.KB_SESSION.isPublic(h, o.id)) ? 'ok' : 'idle'; }
      });

    /* ----- list 视图 ----- */
    if (view === 'list') {
      var cols = t.columns.map(function (c) {
        var out = Object.assign({}, c);
        /* v15：库名改为进「知识库详情」（概览/检索统计/索引管理）。
           此前点库名只切到检索测试视图，详情页没有入口 —— 「检索测试」仍在右侧操作列，一步可达。 */
        if (c.key === 'name') out.render = function (r) { return '<button class="lnk" data-act="go-detail" data-id="knowledge|' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'; };
        else if (c.key === 'zeroRate') out.render = function (r) { return '<span class="' + (r.zeroRate >= 0.05 ? 'bad' : (r.zeroRate >= 0.03 ? 'warn' : 'ok')) + '">' + fmt.pct1(r.zeroRate) + '</span>'; };
        else if (c.key === 'status') out.render = function (r) { return h.pill(r.status, r.statusText); };
        else if (c.key === 'refAgents') out.render = function (r) { return '<span class="ta-r">' + fmt.int(r.refAgents) + '</span>'; };
        else if (c.key === 'hits') out.render = function (r) { return '<span class="ta-r">' + fmt.int(r.hits) + '</span>'; };
        else if (c.key === 'docs' && global.KB_SESSION && global.KB_SESSION.docCountOf) out.render = function (r) { return '<span class="ta-r">' + fmt.int(global.KB_SESSION.docCountOf(h, r)) + '</span>'; };
        else if (c.key === 'lastSyncText') out.render = function (r) { return h.esc(fmt.rel(r.lastSyncText)); };
        else out.render = function (r) { return h.esc(String(r[c.key] != null ? r[c.key] : '')); };
        return out;
      });
      cols.push({ key: 'judge', label: '结论', render: function (r) { var v = verdict(r); return h.pill(v.k, v.t); } });
      cols.push({ key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="kb-open-test" data-id="' + h.esc(r.id) + '">检索测试</button>'; } });

      /* 「需关注的知识库」卡片整块删除（2026-10-28 业主截图「删除这个」）。
         它要回答的问题（哪个库有缺口、同步滞后）在下面三栏的状态点和结论里已经有答案，
         重复一遍等于同一个信息给两个入口。要修哪个库，直接在清单里看红点。 */
      var kbLayout = (global.KBDESK && global.KBDESK.libLayout) ? global.KBDESK.libLayout(h) : 'grid';
      return head +
        '<div class="metrics">' + [
          { label: '文档总量', value: fmt.int(totalDocs), sub: fmt.int(totalChunks) + ' 条向量' },
          { label: '周命中次数', value: fmt.int(totalHits), sub: '来自知识检索节点的真实调用聚合' },
          { label: '平台调用总量（' + Q.RANGES[state.range].label + '）', value: fmt.compact(k.calls), sub: '全部 Agent 的调用之和', definition: k.meta.definitions.calls },
          { label: '平均零结果率（全库均值）', value: fmt.pct1(avgZero), alert: avgZero > ZERO_WARN, sub: '各库阈值 ' + fmt.pct1(ZERO_WARN) + '（注意线 ' + fmt.pct1(ZERO_NOTICE) + '）；此卡是全库均值，单库是否超标看结论列' }
        ].map(h.metricCard).join('') + '</div>' +
        '<div class="card pad0 kb-desk-card"><div class="card-h pad"><h3>全部知识库</h3>' +
        '<span class="card-sub">' + rows.length + ' 个库' + (kbOffN ? ' · 已停用 ' + kbOffN + ' 个' : '') +
          ' · 单击看详情，双击进库</span>' +
        (global.KBDESK ? global.KBDESK.viewToggle('lib', kbLayout) : '') + '</div>' +
        /* 2026-10-28（业主：「外面列表也这样搞」）：列表视图不再用十列大宽表，
           换成和库内一致的文件管理器三栏（左侧分组树 / 中间库清单 / 右侧库详情预览）。
           h.table 那条留作兜底 —— KBDESK 没加载时仍能出表。 */
        (kbLayout === 'grid' && global.KBDESK
          ? kbGridWithOffPill(global.KBDESK.libHtml(h, rows), kbDis)
          : (global.KBDESK && global.KBDESK.libColView
            ? global.KBDESK.libColView(h, rows, { dis: kbDis, verdict: verdict, zeroWarn: ZERO_WARN })
            : h.table({ columns: cols, rows: rows, sortBy: state.sortKey, sortDir: state.sortDir, page: state.page || 1, pageSize: 20,
              emptyTitle: '还没有知识库',
              emptySub: '知识库给各 Agent 提供检索增强能力 —— 文档不进来，Agent 就答不准。先建一个，把产品、政策、话术、案例文档放进去。',
              emptyAction: { act: 'create-open', create: 'knowledge', text: '新建知识库' } }))) + '</div>' +
        h.metaBar({}, [{ k: '数据性质', v: '库配置为维度数据；命中 / 零结果率为运行态聚合；「' + Q.RANGES[state.range].label + '」检索调用来自 QUERY（全站口径）' }]);
    }

    /* ----- test 视图 -----
     * v10b：对标 Dify hit-testing 真实源码（web/app/components/datasets/hit-testing/）重构 ——
     *   · 每条命中 = Chunk #文档内位置 + 字数 + 相似度（三档色）+ 切片正文（2 行折叠）
 *     + 关键词标签 + 来源文档名 + 点开全文（slide-panel）
     *   · 查询历史可点回填（Dify Records 同款）；sr-only aria-live 播报命中数（读屏）
     *   · chunkSize / overlap 口径首次露出（微软 RAG Best Practice：分段策略是检索质量的第一变量）
     * 数据按确定性派生（S.R.of），诚实声明保留：演示模拟，生产由检索服务返回。 */
    var kbId = st.kbId || rows[0].id;
    var q = st.q || '超过七天还能退货吗';
    var topK = st.topK || 5;
    var th = st.th != null ? st.th : 0.72;
    var dis = (h.state && h.state.kbDisabled) || {};
    var live = rows.filter(function (r) { return !dis[r.id]; });
    /* 已停用的库不参与检索测试 —— 停用弹窗承诺过「Agent 检索不再命中它」 */
    var kb = live.filter(function (r) { return r.id === kbId; })[0] || live[0] || rows[0];
    var rng = S.R.of('kbtest|' + kb.id + '|' + q + '|' + topK + '|' + th);
    /* 演示文档主题：按库类型派生（产品/政策/话术/案例/合同），确定性、可复现 */
    var DOC_TOPICS = {
      'kb-product': ['产品手册-售后保障章节', '用户指南-退换货流程', 'FAQ-物流与签收', '产品规格-保修条款'],
      'kb-policy': ['平台售后政策-v3', '跨境退换货规定', '七天无理由退货实施细则', '行业准入负面清单'],
      'kb-script': ['退货安抚话术-黄金20条', '物流催单应对手册', '报价异议处理 SOP', 'VIP 客户沟通红线'],
      'kb-case': ['案例-超期退货特批 #4821', '案例-物流破损先行赔付', '案例-批量退单风控拦截', '案例-跨境关税纠纷处理'],
      'kb-legal': ['销售合同通用条款-2026版', '退换货服务协议模板', '数据出境合规附录', '供应商结算条款']
    };
    var HIT_BODIES = KB_SLICE_DEMO_LINES;
    var KEYWORDS = { 'kb-product': ['退货', '7天', '二次销售'], 'kb-policy': ['无理由退货', '实施细则', '跨境'], 'kb-script': ['话术', '安抚', '换货'], 'kb-case': ['特批', '超期', '风控'], 'kb-legal': ['条款', '责任比例', '保证金'] };
    var topics = DOC_TOPICS[kb.id] || DOC_TOPICS['kb-product'];
    var hits = [];
    for (var i = 0; i < topK; i++) {
      var score = Math.max(0.31, 0.94 - i * 0.09 - rng() * 0.05);
      /* Chunk #：文档内位置序号（S.R.of 派生，与 top-K 序号解耦 —— Dify 语义：seg.position） */
      var segPos = 1 + Math.floor(rng() * 240);
      hits.push({
        segPos: segPos, doc: topics[i % topics.length],
        score: score, pass: score >= th,
        words: 80 + Math.floor(rng() * 240),
        body: HIT_BODIES[(i + q.length + kb.id.length) % HIT_BODIES.length],
        kws: KEYWORDS[kb.id] || KEYWORDS['kb-product']
      });
    }
    var passN = hits.filter(function (x) { return x.pass; }).length;
    function optVal(o, cur, unit) { return '<option value="' + String(o) + '"' + (String(o) === String(cur) ? ' selected' : '') + '>' + o + (unit ? unit : '') + '</option>'; }
    function scoreKind(s) { return s >= th ? 'good' : (s >= th - 0.08 ? 'near' : 'low'); }

    var resultHtml = '<div class="card"><div class="card-h"><h3>检索结果 · ' + h.esc(kb.name) + '</h3>' +
      '<span class="card-sub">top_k=' + topK + ' · 阈值=' + th.toFixed(2) + ' · 命中 ' + passN + ' / ' + topK + ' · 分段 ' + kb.chunkSize + ' token / 重叠 ' + kb.overlap + '</span></div>' +
      '<div class="sr-only" role="status" aria-live="polite">检索完成：' + passN + ' 条命中，' + (topK - passN) + ' 条低于阈值</div>' +
      '<div class="hit-list">' + hits.map(function (x, i) {
        return '<button class="hit-card" data-act="kb-hit-detail" data-id="' + h.esc(kb.id + '|' + i + '|' + q) + '" aria-label="查看切片全文：来自 ' + h.esc(x.doc) + '，相似度 ' + x.score.toFixed(3) + '">' +
          '<div class="hit-meta"><span class="hit-pos">Chunk #' + x.segPos + '</span>' +
          '<span>' + x.words + ' 字</span>' +
          '<span class="hit-score ' + scoreKind(x.score) + '">' + x.score.toFixed(3) + '</span></div>' +
          '<div class="hit-body">' + h.esc(x.body) + '</div>' +
          '<div class="hit-kw">' + x.kws.map(function (k) { return '<span class="tag">' + h.esc(k) + '</span>'; }).join('') + '</div>' +
          '<div class="hit-foot">' + h.icon('doc', 13) + '<span class="hit-doc">' + h.esc(x.doc) + '</span>' +
          (x.pass ? '' : '<span class="pill bad">低于阈值</span>') +
          '<span class="hit-go">查看全文 →</span></div>' +
          '</button>';
      }).join('') + '</div>' +
      '<div class="bt-warn">' + (passN === 0
        ? '⚠ 全部低于阈值 —— Agent 会走兜底话术。这就是「Agent 答不出」的检索侧根因：应补文档或调低阈值。'
        : passN < topK ? '部分低于阈值：若 Agent 仍答错，问题可能在生成环节 —— 对比不同 top_k / 阈值 / 切片策略的输出。' : '全部命中且过阈值：若 Agent 仍答错，问题定位到生成环节而非检索环节。') + '</div>' +
      '<div class="bt-note">切片正文与文档名为演示内容（确定性派生）；生产环境由检索服务返回真实切片、来源与高亮。分段口径（' + kb.chunkSize + '/' + kb.overlap + '）为库配置真实值。</div></div>';

    /* 查询历史（Dify Records 同款）：点历史回填重跑 */
    var hist = (st.history || []).slice(-5).reverse();
    var histHtml = hist.length ? '<div class="card"><div class="card-h"><h3>最近查询</h3><span class="card-sub">点击回填重跑</span></div>' +
      '<div class="chips">' + hist.map(function (hq) {
        return '<button class="chip link" data-act="kb-hist" data-id="' + h.esc(hq) + '">' + h.esc(hq) + '</button>';
      }).join('') + '</div></div>' : '';

    return head +
      '<div class="card"><div class="card-h"><h3>检索测试</h3>' +
      '<span class="card-sub">没有这个入口，运营永远只能猜「为什么 Agent 答错」</span>' +
      '<button class="btn-ghost sm" data-act="kb-view" data-id="list">← 返回概览</button></div>' +
      '<div class="filter-row">' +
      '<label class="grow">测试 query<input id="kb-q" data-kb="q" placeholder="如：超过七天还能退货吗" value="' + h.esc(q) + '"></label>' +
      '<label>知识库<select id="kb-pick" data-kb="kbId">' + rows.map(function (r) { return '<option value="' + r.id + '"' + (r.id === kb.id ? ' selected' : '') + '>' + h.esc(r.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>top_k<select id="kb-k" data-kb="topK">' + [3, 5, 10].map(function (o) { return optVal(o, topK, ''); }).join('') + '</select></label>' +
      '<label>相似度阈值<select id="kb-th" data-kb="th">' + [0.60, 0.72, 0.85].map(function (o) { return optVal(o, th, ''); }).join('') + '</select></label>' +
      '</div>' +
      '<div class="bt-note">切换参数即重算（下拉实时生效，query 失焦生效）；分段口径 ' + kb.chunkSize + ' token / 重叠 ' + kb.overlap + '（约 ' + Math.round(kb.overlap / kb.chunkSize * 100) + '%，微软 RAG 实践建议约 10% 起）。</div></div>' +
      resultHtml +
      histHtml +
      h.metaBar({}, [{ k: '检索口径', v: '命中切片、相似度与来源为检索侧快照（演示确定性模拟），用于快速判断检索侧是否健康' }]);
  };

  /* SECTION: r-fallback */
  /* 未实现渲染器的兜底屏。这段文案是**给用户看**的。
     此前印的是「页面渲染器未实现 / 该能力的页面设计见《生产级页面设计规格》对应章节」——
     内部交付语言泄漏到界面，用户既看不懂也没有出路。
     另：这里显式传 action:false 收掉主按钮 —— 屏上写着「暂未开放」，
     右上角却摆一个「新建 XX」，是按不动的 CTA，自相矛盾。
     当前 15 个 pageType 都已注册渲染器（kolPage / interviewHome 用的是 R. 别名写法），
     所以这屏只在新增能力忘了注册时才会出现。 */
  RENDERERS.fallback = function (cap, state, h) {
    return pageHead(h, cap, { action: false }) +
      '<div class="card"><div class="empty"><div class="empty-ico">' + h.icon('doc', 28) + '</div>' +
      '<div class="empty-title">「' + h.esc(cap.name) + '」暂未开放</div>' +
      '<div class="empty-sub">这块能力还在建设中。你可以先从左侧其他能力入手，或回工作台总览看今天要处理的事。</div>' +
      '<button class="btn-ghost" data-act="goto-cap" data-id="overview">返回工作台总览</button>' +
      '</div></div>';
  };

  ACTIONS['kb-focus'] = function (id, btn, h) {
    var q = document.getElementById('kb-q');
    var sel = document.getElementById('kb-pick');
    if (sel && id) sel.value = id;
    if (q) { q.scrollIntoView({ behavior: 'smooth', block: 'center' }); q.focus(); }
  };

  function surveyShares(seed, n) {
    var r = S.R.of(seed);
    var ws = []; var tot = 0;
    for (var i = 0; i < n; i++) { var w = 0.12 + r() * 0.88; ws.push(w); tot += w; }
    return ws.map(function (w) { return w / tot; });
  }

  /* v15：详情页早就有独立渲染器，但列表点名字只弹一个简版弹窗 —— 两套详情并存，
     而弹窗里没有任何出口，用户永远发现不了后面那套带 Tab 的详情页。
     处理：不删弹窗（快速预览有价值），在弹窗底部统一补一个「查看完整详情 →」。
     用法：handler 在 openModal 之前调一次 modalDetail(capId, objId[, tab])。 */
  var _modalDetail = null;
  function modalDetail(capId, objId, tab) { _modalDetail = { cap: capId, id: objId, tab: tab || null }; }
  /* 本文件没有本地 esc（正文一律走 h.esc），而弹窗注入点拿不到 h —— 这里补一个最小转义 */
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function openModal(html, opts) {
    var host = document.createElement('div');
    host.innerHTML = html;
    var mask = host.firstChild;
    /* v10b（阿里云 slide-panel）：详情查看类一律右侧滑出 —— 不离开列表、保留上下文。
       调用方写 <div class="modal-mask"> 即可，这里统一升级为 slide（要居中就显式写 modal-mask center）。 */
    if (mask && mask.classList && !mask.classList.contains('center')) mask.classList.add('slide');
    if (_modalDetail && mask && mask.querySelector) {
      var body = mask.querySelector('.modal-b');
      if (body) {
        body.insertAdjacentHTML('beforeend',
          '<div class="bt-note" style="margin-top:12px"><button class="btn-ghost sm" data-act="go-detail" data-id="' +
          escAttr(_modalDetail.cap) + '|' + escAttr(_modalDetail.id) + '|' + escAttr(_modalDetail.tab || '') + '">查看完整详情 →</button></div>');
      }
    }
    _modalDetail = null;
    document.body.appendChild(mask);
    /* v29：与 openSheet 对齐 —— 弹窗挂到 DOM 之后给调用方一个接线点。
       不用 setTimeout：那种写法在慢设备上会偶发失效，且失败时是静默的
       （元素找不到 → 什么都不绑 → 用户点了没反应）。 */
    if (opts && typeof opts.onOpen === 'function') opts.onOpen(mask);
  }

  /* v15：跳详情页的唯一动作（弹窗里的「查看完整详情 →」用） */
  ACTIONS['go-detail'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var cap = h.capById(p[0]);
    if (!cap || !p[1]) { h.toast('找不到对应的详情页', 'bad'); return; }
    /* 进详情页就收起预览弹窗 —— 否则详情页被小窗盖住，用户还得自己再点一次 × */
    if (document && document.querySelectorAll) {
      var masks = document.querySelectorAll('.modal-mask');
      for (var i = 0; i < masks.length; i++) if (masks[i].remove) masks[i].remove();
    }
    h.navigate({ domain: cap.domain, cap: cap.id, agentId: p[1], tab: p[2] || null, traceId: null });
  };

  /* 画像视图切换：网格（卡片管理）/ 列表（按列排序核对）—— 与知识库同一套 */
  /* 经验条目视图切换：网格（卡片管理）/ 列表（按列排序核对） */
  ACTIONS['exp-view'] = function (id, btn, h) {
    h.state.expView = (String(id) === 'list') ? 'list' : 'grid';
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  };
  ACTIONS['persona-view'] = function (id, btn, h) {
    h.state.personaView = (String(id) === 'list') ? 'list' : 'grid';
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  };
  /* 「看全部 N 家 →」/「收起，只看 5 家」—— 画像详情概览里企业清单的展开开关。
     它只是一个**视图开关**：展开后仍是同一批 96 家、同一套筛选键（state.filters.firmQ）、
     同一个 firm-open 下钻出口（点到企业卡片为止）。写进 state 而不是写进 DOM，
     免得刷新一下又缩回 5 家（这个原型的所有交互态都走 state，保持一致）。 */
  ACTIONS['persona-firms-toggle'] = function (id, btn, h) {
    h.state.personaFirmsOpen = String(id) === '1';
    if (!h.state.personaFirmsOpen) delete h.state.personaFirmsOpen;
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  };
  ACTIONS['persona-detail'] = function (id, btn, h) {
    var r = assets().persona.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('画像不存在', 'bad'); return; }
    h.state.personaId = id;
    h.navigate({});
    modalDetail('persona', id);
    var fmt = h.fmt;
    var ttl = assets().persona.ttlDays || 30;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(r.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="sub-h">标签构成</div><div>' + (r.tags || []).map(function (x) { return '<span class="tag">' + h.esc(x) + '</span>'; }).join('') + '</div>' +
      '<dl class="dl">' +
      '<dt>行业</dt><dd>' + h.esc(r.industry || '—') + '</dd>' +
      '<dt>覆盖企业</dt><dd>' + fmt.int(r.ents) + ' 家（按 USCC 去重）</dd>' +
      '<dt>被引用</dt><dd>' + fmt.int(r.refCount) + ' 次 · ' + h.esc(r.heatText) + '</dd>' +
      '<dt>更新时间</dt><dd>' + fmt.rel(r.updated) + (r.overdueDays > 0 ? '（超期 ' + r.overdueDays + ' 天）' : '') + '</dd>' +
      '<dt>状态</dt><dd><span class="pill ' + r.status + '">' + h.esc(r.statusText) + '</span></dd>' +
      '</dl>' +
      '<div class="bt-note">' + (r.status === 'warn'
        ? '已超过 ' + ttl + ' 天有效期：属性已经漂移，投放前应登记更新并重新采集，否则圈出来的企业会偏。'
        : '在 ' + ttl + ' 天有效期内，可作为圈选投放的依据；规模与引用关系见下方明细。') + '</div>' +
      (r.status === 'warn' ? '<div class="bt-note" style="margin-top:10px">' +
        '<button class="btn-ghost sm" data-act="persona-refresh" data-id="' + h.esc(r.id) + '">登记更新</button></div>' : '') +
      '</div></div></div>');
  };

  /* 登记更新：此前「更新画像 →」点下去只是同一个只读弹窗（标签在骗人）。
     这里给一个真入口，并如实说明它做了什么、没做什么。 */
  ACTIONS['persona-refresh'] = function (id, btn, h) {
    var r = assets().persona.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('画像不存在', 'bad'); return; }
    var ttl = assets().persona.ttlDays || 30;
    var REASONS = ['属性漂移', '企业组织变动', '标签口径调整', '例行刷新'];
    var ETAS = ['今天', '本周内', '本月内'];
    function opts(list, key) {
      return list.map(function (x) {
        var v = key ? x[key] : x, t = key ? x.name : x;
        return '<option value="' + escAttr(v) + '">' + escAttr(t) + '</option>';
      }).join('');
    }
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>登记更新 · ' + h.esc(r.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="bt-warn">该画像已超期 ' + r.overdueDays + ' 天（有效期 ' + ttl + ' 天）。' +
      '更新需要重新采集企业数据，登记后状态置为「更新中」。</div>' +
      '<div class="sub-h">更新信息</div>' +
      '<div class="filter-row">' +
      '<label class="grow">更新原因<select id="pr-reason">' + opts(REASONS) + '</select></label>' +
      '<label>预计完成<select id="pr-eta">' + opts(ETAS) + '</select></label>' +
      '</div>' +
      /* 2026-10-28：删掉「负责人」下拉 —— 单人系统里它只有一个选项（就是你自己），必选等于没选。 */
      '<div class="sub-h">更新后会怎样</div>' +
      '<div class="bt-note">登记后：本页列表的「需更新」计数会减 1，该画像状态变「更新中」；' +
      '实际重新采集与复核要你自己线下发起，完成后状态回到「生效中」。</div>' +
      '<div class="gray-acts" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn-ghost" data-act="close-modal">取消</button>' +
      '<button class="btn-primary" data-act="persona-refresh-submit" data-id="' + h.esc(r.id) + '">登记更新</button>' +
      '</div></div></div></div>');
  };

  ACTIONS['persona-refresh-submit'] = function (id, btn, h) {
    function val(sel) { var e = document.querySelector(sel); return e ? String(e.value || '').trim() : ''; }
    var r = assets().persona.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('画像不存在', 'bad'); return; }
    h.state.personaRefresh = h.state.personaRefresh || {};
    /* 2026-10-28：登记人字段删了（只有一个人，记「by」等于记常量）。 */
    h.state.personaRefresh[id] = { reason: val('#pr-reason'), eta: val('#pr-eta'), at: '刚刚' };
    var mask = document.querySelector('.modal-mask');
    if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    h.toast('已登记更新「' + r.name + '」（本会话内状态为「更新中」，未真正重新采集）', 'ok');
    h.navigate({}, { scroll: false });
  };

  ACTIONS['persona-refresh-undo'] = function (id, btn, h) {
    if (h.state.personaRefresh) delete h.state.personaRefresh[id];
    h.toast('已撤销更新登记（仅本会话）', 'info');
    h.navigate({}, { scroll: false });
  };

  /* 被引用：此前只是一个数字，点不开、看不见谁在用。这里给去向 ——
     明细归各引用方自己维护，本页不编清单，只做口径说明 + 去处。 */
  ACTIONS['persona-refs'] = function (id, btn, h) {
    var r = assets().persona.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('画像不存在', 'bad'); return; }
    var fmt = h.fmt;
    var CAPS = [
      { cap: 'user-ops', name: '用户运营策略', desc: '圈人时把该画像当筛选条件' },
      { cap: 'agent-wb', name: 'Agent', desc: '生成时把该画像注入上下文' }
    ];
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>引用关系 · ' + h.esc(r.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl"><dt>被引用次数</dt><dd>' + fmt.int(r.refCount) + ' 次 · ' + h.esc(r.heatText) + '</dd>' +
      '<dt>引用方类型</dt><dd>用户运营策略 / Agent</dd></dl>' +
      '<div class="sub-h">去引用方看明细</div>' +
      '<div class="gray-acts" style="display:flex;gap:8px;flex-wrap:wrap">' + CAPS.map(function (c) {
        return '<button class="btn-ghost sm" data-act="goto-cap" data-id="' + c.cap + '">' + c.name + ' →</button>';
      }).join('') + '</div>' +
      '<div class="bt-note" style="margin-top:12px">引用明细由各引用方自己维护（谁在什么条件下用了它），' +
      '画像库这边只记总数与分档。<b>分档只说明使用广度，不代表这群人值得投放。</b></div>' +
      '</div></div></div>');
  };

  ACTIONS['sbx-detail'] = function (id, btn, h) {
    var r = assets().sandbox.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('沙盒实例不存在', 'bad'); return; }
    h.state.sbxId = id;
    h.navigate({});
    var fmt = h.fmt;
    var p = String(r.concurrency).split('/');
    var u = p.length === 2 ? Number(p[0]) / Number(p[1]) : 0;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3 class="mono">' + h.esc(r.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>类型 / 镜像</dt><dd>' + h.esc(r.kindText) + ' · ' + h.esc(r.image) + '</dd>' +
      '<dt>资源规格</dt><dd>' + h.esc(r.spec) + '</dd>' +
      '<dt>网络策略</dt><dd>' + h.esc(r.netPolicyText) + '</dd>' +
      '<dt>并发</dt><dd>' + h.esc(r.concurrency) + '（使用率 ' + fmt.pct0(u) + '）</dd>' +
      '<dt>运行时长</dt><dd>' + h.esc(r.uptime) + '</dd>' +
      '<dt>24h 拦截</dt><dd>' + fmt.int(r.blocked) + ' 次</dd>' +
      '<dt>业务线</dt><dd>' + h.esc(r.biz) + '</dd>' +
      '</dl>' +
      '<div class="sub-h">下一步</div>' +
      '<div class="bt-note">' + (u >= 0.95 ? '并发濒临上限。' :
        (u >= 0.85 ? '并发接近上限：关注峰值时段，必要时提前扩容申请。' : '资源水位正常。放开网络白名单等变更会改变隔离边界。')) + '</div>' +
      '</div></div></div>');
  };

  /* 主按钮「创建 persona」：原先挂的是不存在的 demo 动作（点了只弹通用 toast，什么也没发生）。
   * 这里补上真实表单 —— 新建的 persona 明确标为「待验证」，保真度 0，不给假数据。 */
  ACTIONS['sim-new-persona'] = function (id, btn, h) {
    var pool = poolRows();
    var usedNames = pool.filter(function (r) { return r.named; }).length;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>新建 persona</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="bt-note">persona 是「对谁模拟」的人设。创建后需用真实历史数据校验，' +
      '校验通过（保真度 ≥ 90%）其结论才可用于投放决策。</div>' +
      '<div class="sub-h">基本信息</div>' +
      '<div class="filter-row">' +
      '<label class="grow">画像名称<input id="np-name" placeholder="如：价格敏感型宝妈" value=""></label>' +
      '<label>国别<input id="np-country" placeholder="如：美国" value=""></label>' +
      '<label>年龄<input id="np-age" type="number" placeholder="28" value=""></label>' +
      '</div>' +
      '<div class="filter-row">' +
      '<label>职业<input id="np-job" placeholder="如：产品经理" value=""></label>' +
      '<label>月消费（$）<input id="np-spend" type="number" placeholder="420" value=""></label>' +
      '<label>业务线<select id="np-biz"><option>运营线</option><option>销售线</option><option>法务线</option></select></label>' +
      '</div>' +
      '<div class="sub-h">画像标签与痛点</div>' +
      '<div class="filter-row">' +
      '<label class="grow">标签（逗号分隔）<input id="np-tags" placeholder="价格敏感, 品质优先" value=""></label>' +
      '</div>' +
      '<div class="filter-row">' +
      '<label class="grow">痛点（逗号分隔）<input id="np-pains" placeholder="尺码不准, 物流慢" value=""></label>' +
      '</div>' +
      '<div class="bt-warn">⚠ 刚创建的 persona 保真度为 0（尚未用真实数据校验），' +
      '用它跑的模拟结论只能作为参考，不能直接用于投放决策。</div>' +
      '<div class="bt-note">当前全池 ' + pool.length + ' 位（已具名 ' + usedNames + ' 位）。' +
      '创建后将出现在池尾，标为「待判定」。</div>' +
      '<div class="gray-acts" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn-ghost" data-act="close-modal">取消</button>' +
      '<button class="btn-primary" data-act="sim-new-persona-submit">创建并加入池</button>' +
      '</div></div></div></div>');
  };

  ACTIONS['sim-new-persona-submit'] = function (id, btn, h) {
    function val(sel) { var e = document.querySelector(sel); return e ? String(e.value || '').trim() : ''; }
    var name = val('#np-name'), country = val('#np-country'), age = val('#np-age');
    if (!name) { h.toast('请先填写画像名称', 'bad'); return; }
    if (!country) { h.toast('请填写国别 —— 池卡片靠它做区分', 'bad'); return; }
    var a = Number(age);
    if (!a || a < 12 || a > 100) { h.toast('年龄需在 12–100 之间', 'bad'); return; }
    var tags = val('#np-tags').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var pains = val('#np-pains').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var spend = Number(val('#np-spend')) || 0;
    var pool = poolRows();
    // 重名检查：池里已有同名会把筛选与判定搅浑
    if (pool.some(function (x) { return x.name === name; })) {
      h.toast('池中已存在「' + name + '」—— 请换个名称', 'bad');
      return;
    }
    var rec = {
      id: 'up-new-' + (pool.length + 1),
      name: name, initial: name.charAt(0),
      age: a, job: val('#np-job') || '未填写', country: country, spend: spend,
      tags: tags, pains: pains,
      source: 'manual', sourceText: 'manual',
      fidelity: 0, jevScore: null, jevBand: null,
      hits: 0, sims: 0, enabled: true, named: true, isNew: true
    };
    // 保真度 0（未校验）→ 判定分也给 0，不留 null 悬着
    rec.jevScore = 0;
    rec.jevBand = 'low';
    window.SIM_POOL_ADDED = poolAdded().concat([rec]);
    window.SIM_JUDGED = false;
    // 自动勾选新创建的，用户能立刻看到它进了池
    var sel = (window.SIM_POOL_SEL || []).slice();
    if (h.state.simMode === 'single') sel = [rec.id];
    else if (!sel.length) sel = [rec.id];
    else sel.push(rec.id);
    window.SIM_POOL_SEL = sel;
    var m = document.querySelector('.modal-mask'); if (m) m.remove();
    h.toast('已创建「' + name + '」并加入池尾 —— 保真度 0，需先校验才可用于决策', 'info');
    h.navigate({}, { scroll: false });
  };

  /* 「① 本轮方案 / 待评估内容」——**页内可编条件的卡**，与 AI 访谈作业台的「① 问卷内容」
   * 同一套 iv-form / iv-field / iv-input 结构（同类元素两屏必须长得一样）。
   * 2026-10-17 重做：此前条件只藏在一个弹窗里、且只有一个「名称」输入框 ——
   * 判定的对象（话术 / 文案正文）根本没地方写。现在条件铺在页面上、可就地编辑保存，
   * 「提交」直接读这张卡，不再弹窗。 */
  function simBrief() { return (window.SIM_BRIEF || (window.SIM_BRIEF = {})); }
  function simBriefOf(mode) { return simBrief()[mode] || null; }
  /* 就地编辑的值必须即时落到 window.SIM_BRIEF：池子勾选/确认判定都会整页重渲染，
   * 未保存的输入会被重建掉（实测「填了名字再点池子，名字就没了」）。
   * 这里用内联 oninput 直接写内存，不触发重渲染 —— 保存按钮只负责校验与提示。 */
  global.sbSet = function (mode, key, val) {
    var all = (window.SIM_BRIEF || (window.SIM_BRIEF = {}));
    var o = all[mode] || (all[mode] = {});
    o[key] = val;
  };
  function sbBind(mode, key) {
    return ' oninput="window.sbSet(\'' + mode + '\',\'' + key + '\',this.value)"' +
      ' onchange="window.sbSet(\'' + mode + '\',\'' + key + '\',this.value)"';
  }
  function simBriefCard(mode, h) {
    var isOp = mode === 'opinion';
    var bf = simBriefOf(mode) || {};
    return '<div class="card" data-sb-card="' + mode + '"><div class="card-h"><h3>① ' + (isOp ? '待评估内容' : '本轮方案') + '</h3>' +
      '<span class="pill ' + (isOp ? 'info' : 'ok') + '" style="margin-left:auto">' + (isOp ? '文案式' : '话题式') + '</span></div>' +
      '<div class="iv-form">' +
      '<label class="iv-field"><span>' + (isOp ? '内容名称' : '方案名称') + '</span>' +
      '<input class="iv-input" data-sb="name" value="' + h.esc(bf.name || '') + '" placeholder="' +
      (isOp ? '如：双11 促销文案（公开投放版）' : '如：双11种草话术') + '"' + sbBind(mode, 'name') + ' /></label>' +
      '<label class="iv-field"><span>' + (isOp ? '文案正文' : '话术内容') + '</span>' +
      '<textarea class="iv-input" data-sb="body" rows="' + (isOp ? 6 : 5) + '" placeholder="' +
      (isOp ? '例如：双11 限时最低价，前 100 名下单再返 50 元，手慢无。'
            : '例如：您上次加购的那款现在有 30 天价保，会员价再减 20；券到 11/11 到期，过期不补。') +
      '"' + sbBind(mode, 'body') + '>' + h.esc(bf.body || '') + '</textarea></label>' +
      /* 2026-10-17：删掉「引用知识库 / 渠道 / 时段 / 每人频次」这四个下拉 ——
       * 它们是访谈页的**执行参数**，搬到这里一个都不影响判定结果（改完数字不变），
       * 摆着只会让人以为「我按微博语境测过了」。模拟只认两件事：叫什么、内容是什么。 */
      '<div class="iv-row" style="margin-top:12px;justify-content:flex-end">' +
      '<button class="btn-ghost" data-act="sim-brief-save" data-id="' + mode + '">' + (isOp ? '保存内容' : '保存方案') + '</button>' +
      '<button class="btn-primary" data-act="pool-new-run-submit" data-id="' + mode + '">' + (isOp ? '提交判定' : '提交跑批') + '</button>' +
      '</div></div></div>';
  }
  function sbVal(mode, key) {
    var el = document.querySelector('[data-sb-card="' + mode + '"] [data-sb="' + key + '"]');
    return el ? String(el.value || '').trim() : '';
  }
  function sbRead(mode) {
    var o = { name: sbVal(mode, 'name'), body: sbVal(mode, 'body') };
    simBrief()[mode] = o;
    return o;
  }
  ACTIONS['sim-brief-save'] = function (id, btn, h) {
    var mode = id || 'multi';
    var o = sbRead(mode);
    if (!o.name) { h.toast('先起个名字 —— 列表要按它区分', 'bad'); return; }
    if (!o.body) {
      h.toast('条件还没填：' + (mode === 'opinion' ? '文案正文' : '话术正文') + '是判定的对象', 'bad');
      var t = document.querySelector('[data-sb-card="' + mode + '"] [data-sb="body"]');
      if (t) t.focus();
      return;
    }
    h.toast('已保存「' + o.name + '」', 'info');
    h.navigate({}, { scroll: false });
  };

  /* 页头 / 列表里的「新建…」：条件已经搬到页内那张卡上，这里只负责把人带到卡前，
   * 不再弹一个只有名称的窗（那正是这张卡要替掉的东西）。 */
  ACTIONS['pool-new-run'] = function (id, btn, h) {
    var mode = id || h.state.simMode || 'single';
    /* 动作触发后框架会重渲染一次，当场 focus 会被冲掉 —— 延后一帧再定位 */
    setTimeout(function () {
      var card = document.querySelector('[data-sb-card="' + mode + '"]');
      if (!card) return;
      card.scrollIntoView({ block: 'center' });
      var f = card.querySelector('[data-sb="body"]');
      if (f) f.focus();
    }, 80);
    h.toast(simBriefOf(mode)
      ? '条件已填，确认无误后点卡内「' + (mode === 'opinion' ? '提交判定' : '提交跑批') + '」'
      : '先在「① ' + (mode === 'opinion' ? '待评估内容' : '本轮方案') + '」里把正文写好', 'info');
  };

  ACTIONS['pool-new-run-submit'] = function (id, btn, h) {
    var mode = id || 'multi';
    var o = sbRead(mode);
    if (!o.name) { h.toast('先起个名字 —— 列表要按它区分', 'bad'); return; }
    if (!o.body) {
      h.toast('正文是判定的对象，不能为空 —— 先把它写进「① ' + (mode === 'opinion' ? '待评估内容' : '本轮方案') + '」', 'bad');
      var t = document.querySelector('[data-sb-card="' + mode + '"] [data-sb="body"]');
      if (t) t.focus();
      return;
    }
    if (o.body.length < 8) { h.toast('正文太短（' + o.body.length + ' 字），至少写到能看出在说什么', 'bad'); return; }
    if (!window.SIM_RUNS_ADDED) window.SIM_RUNS_ADDED = [];
    var newId = 'sr-local-' + (++window.__simLocalSeq || (window.__simLocalSeq = 1));
    if (mode === 'opinion') {
      var senti = sentiOf(o.body);
      var rtype = riskTypeOf(o.body, senti.neg);
      window.SIM_RUNS_ADDED.push({
        id: newId, name: o.name, mode: 'opinion', modeText: '舆情',
        personaId: null, personaName: '—',
        poolUserIds: [], poolUserText: '—',
        scheme: '判定「' + o.name + '」公开后的情绪走向',
        body: o.body,
        sample: 0, adopted: null,
        dayOffset: 0, status: 'done', statusText: '已完成',
        senti: senti, risk: Math.round(senti.neg * 100), riskType: rtype
      });
      h.toast('已判定「' + o.name + '」：负面 ' + (senti.neg * 100).toFixed(1) + '% · ' + rtype, 'info');
    } else {
      var sel = (window.SIM_POOL_SEL || []).slice();
      if (!sel.length) { h.toast('先在「② 全局用户池」勾选要模拟的样本', 'bad'); return; }
      var unjudged = sel.filter(function (uid) { return !isJudged(uid); });
      if (unjudged.length) { h.toast('还有 ' + unjudged.length + ' 位没判定 —— 先点池底「确认，开始 Jev 判定」', 'bad'); return; }
      var names = sel.map(function (uid) {
        var u = poolRows().filter(function (r) { return r.id === uid; })[0];
        return u ? (u.name || u.initial) : uid;
      });
      window.SIM_RUNS_ADDED.push({
        id: newId, name: o.name, mode: mode, modeText: '多用户',
        personaId: null, personaName: '—',
        poolUserIds: sel, poolUserText: names.join('、'),
        scheme: '对 ' + sel.length + ' 位选中样本投放「' + o.name + '」',
        body: o.body,
        sample: 0, adopted: null, funnel: null,
        dayOffset: 0, status: 'queued', statusText: '跑批中'
      });
      h.toast('已提交「' + o.name + '」跑批：' + sel.length + ' 位样本', 'info');
    }
    h.navigate({}, { scroll: false });
  };

  ACTIONS['sim-test'] = function (id, btn, h) {
    var r = assets().persona_sim.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('persona 不存在', 'bad'); return; }
    h.state.simId = id;
    h.navigate({});
    var fmt = h.fmt;
    var v = r.fidelity >= 0.9 ? '该 persona 的模拟结论可用于投放决策。' : (r.fidelity >= 0.8 ? '该 persona 仅建议参考，需与真实数据交叉验证。' : '该 persona 保真度未达标，系统不会用其结论支撑投放决定。');
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(r.name) + ' · 试投预演</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="sub-h">保真度边界（诚实声明）</div>' +
      '<div class="bt-note">保真度 ' + fmt.pct1(r.fidelity) + '：' + h.esc(r.fidelityScope) + '。回答方差 ' + h.esc(r.variance) + '。</div>' +
      '<div class="bt-note">' + v + ' 预演跑批已提交；如需正式预演，先补齐该场景的历史校验集。</div>' +
      '</div></div></div>');
  };

  ACTIONS['survey-result'] = function (id, btn, h) {
    var r = assets().survey.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('访谈任务不存在', 'bad'); return; }
    h.state.surveyId = id;
    h.navigate({});
    modalDetail('survey', id);
    var fmt = h.fmt;
    function nNum(v, d) { var x = Number(v); return isFinite(x) ? x : d; }
    var it = r.intent || {}, consulted = nNum(r.consulted, 0);
    function intentRow(label, val) {
      var pct = consulted ? val / consulted : 0;
      return '<tr><td>' + label + '</td><td class="ta-r">' + fmt.int(val) + '</td>' +
        '<td class="ta-r">' + fmt.pct1(pct) + '</td>' +
        '<td><span class="mini-bar"><i style="width:' + Math.round(pct * 100) + '%"></i></span></td></tr>';
    }
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(r.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="metrics">' + [
        { label: '已触达', value: fmt.int(nNum(r.reached, 0)) },
        { label: '回复率', value: fmt.pct1(nNum(r.replyRate, 0)), alert: nNum(r.replyRate, 0) < 0.6 },
        { label: '有效咨询', value: fmt.int(consulted) }
      ].map(h.metricCard).join('') + '</div>' +
      '<div class="sub-h">意向分级</div>' +
      '<table class="bt"><thead><tr><th>意向</th><th class="ta-r">人数</th><th class="ta-r">占有效咨询</th><th></th></tr></thead><tbody>' +
      intentRow('高意向', nNum(it.high, 0)) + intentRow('中意向', nNum(it.mid, 0)) + intentRow('低意向', nNum(it.low, 0)) +
      '</tbody></table>' +
      '<div class="sub-h">触达与回收</div>' +
      '<div class="bt-note">已触达 ' + fmt.int(nNum(r.reached, 0)) + ' · 已回复 ' + fmt.int(nNum(r.replied, 0)) + ' · 有效咨询 ' + fmt.int(consulted) +
      '。完整名单来源、交付渠道与多轮访谈策略见任务详情「访谈设计」。</div>' +
      '</div></div></div>');
  };

  ACTIONS['kb-view'] = function (id, btn, h) {
    h.state.kb = h.state.kb || {};
    h.state.kb.view = id;
    if (id === 'test' && !h.state.kb.kbId && assets().kb.rows.length) h.state.kb.kbId = assets().kb.rows[0].id;
    h.navigate({});
  };

  ACTIONS['kb-open-test'] = function (id, btn, h) {
    h.state.kb = { view: 'test', kbId: id, topK: 5, th: 0.72, q: '超过七天还能退货吗' };
    h.navigate({});
  };

  /* v10b（走查 3.4）：用户运营「用户反馈」的 kind 聚合 chip —— 真筛选动作（toggle） */
  ACTIONS['uo-fb-kind'] = function (id, btn, h) {
    h.state.filters = h.state.filters || {};
    if (h.state.filters.fbKind === id) delete h.state.filters.fbKind;
    else h.state.filters.fbKind = id;
    h.navigate({}, { scroll: false });
  };

  /* v10b（对标 Dify hit-testing）：检索测试 —— 历史查询回填（点 chip 重跑该 query） */
  ACTIONS['kb-hist'] = function (id, btn, h) {
    h.state.kb = h.state.kb || {};
    h.state.kb.q = id;
    h.navigate({}, { scroll: false });
  };

  /* v10b（对标 Dify hit-testing/result-item + ChunkDetailModal）：
   * 命中切片全文 —— slide-panel（右侧滑出，不离开列表上下文）。
   * id 形如 kbId|hitIdx|query，重算同一确定性序列取该条命中。 */
  ACTIONS['kb-hit-detail'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var kbId = p[0], idx = Number(p[1]) || 0, q = p.slice(2).join('|');
    var st = h.state.kb || {};
    var topK = st.topK || 5, th = st.th != null ? st.th : 0.72;
    var S = global.DATA_SEED;
    var rows = assets().kb.rows;
    var dis = (h.state && h.state.kbDisabled) || {};
    var live = rows.filter(function (r) { return !dis[r.id]; });
    /* 已停用的库不参与检索测试 —— 停用弹窗承诺过「Agent 检索不再命中它」 */
    var kb = live.filter(function (r) { return r.id === kbId; })[0] || live[0] || rows[0];
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var rng = S.R.of('kbtest|' + kb.id + '|' + q + '|' + topK + '|' + th);
    var DOC_TOPICS = {
      'kb-product': ['产品手册-售后保障章节', '用户指南-退换货流程', 'FAQ-物流与签收', '产品规格-保修条款'],
      'kb-policy': ['平台售后政策-v3', '跨境退换货规定', '七天无理由退货实施细则', '行业准入负面清单'],
      'kb-script': ['退货安抚话术-黄金20条', '物流催单应对手册', '报价异议处理 SOP', 'VIP 客户沟通红线'],
      'kb-case': ['案例-超期退货特批 #4821', '案例-物流破损先行赔付', '案例-批量退单风控拦截', '案例-跨境关税纠纷处理'],
      'kb-legal': ['销售合同通用条款-2026版', '退换货服务协议模板', '数据出境合规附录', '供应商结算条款']
    };
    var HIT_BODIES = [
      '……自签收之日起 7 日内，商品保持完好不影响二次销售的，可申请无理由退货；超出 7 日但在 15 日内且存在质量问题的，凭检测报告可走质量退货通道，运费由平台承担……',
      '……退货审核通过后，退款将在 1-3 个工作日内原路退回；若超过 3 个工作日未到账，系统自动触发加急工单并同步短信通知用户，避免二次投诉……',
      '……特殊美妆/食品类目不适用无理由退货，页面下单前需勾选确认；客服应对此类咨询时优先引导换货，话术参考「抱歉给您带来不便」开场……',
      '……跨境订单退货运费由买卖双方按责任比例分摊，平台先行垫付后从保证金扣除；关税部分不退，需在话术中提前告知用户避免纠纷……',
      '……超期退货申请需二级审批：客服提交 + 主管审核 + 风控确认，全流程 ≤ 24 小时；历史上特批通过率 37%，主要集中在大促后 3 天内……'
    ];
    var topics = DOC_TOPICS[kb.id] || DOC_TOPICS['kb-product'];
    var hit = null;
    for (var i = 0; i < topK; i++) {
      var score = Math.max(0.31, 0.94 - i * 0.09 - rng() * 0.05);
      var segPos = 1 + Math.floor(rng() * 240);
      var rec = {
        segPos: segPos, doc: topics[i % topics.length], score: score,
        words: 80 + Math.floor(rng() * 240),
        body: HIT_BODIES[(i + q.length + kb.id.length) % HIT_BODIES.length]
      };
      if (i === idx) { hit = rec; break; }
    }
    if (!hit) { h.toast('该命中已失效（参数已变化），请重新检索', 'warn'); return; }
    var fmt = h.fmt;
    var bodyHtml =
      '<div class="hit-meta" style="margin-bottom:10px"><span class="hit-pos">Chunk #' + hit.segPos + '</span>' +
      '<span>' + hit.words + ' 字</span>' +
      '<span class="hit-score ' + (hit.score >= th ? 'good' : (hit.score >= th - 0.08 ? 'near' : 'low')) + '">' + hit.score.toFixed(3) + '</span></div>' +
      '<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.75;color:var(--text)">' + h.esc(hit.body) + '</div>' +
      '<dl class="dl" style="margin-top:12px">' +
      '<dt>来源文档</dt><dd>' + h.esc(hit.doc) + '（' + h.esc(kb.name) + '）</dd>' +
      '<dt>文档内位置</dt><dd class="mono">segment #' + hit.segPos + ' / ' + fmt.int(kb.chunks) + ' 段</dd>' +
      '<dt>分段口径</dt><dd class="mono">' + kb.chunkSize + ' token / 重叠 ' + kb.overlap + '（' + Math.round(kb.overlap / kb.chunkSize * 100) + '%）</dd>' +
      '<dt>embedding</dt><dd class="mono">' + h.esc(kb.embed) + '</dd>' +
      '<dt>查询</dt><dd>「' + h.esc(q) + '」 · top_k=' + topK + ' · 阈值=' + th.toFixed(2) + '</dd>' +
      '</dl>' +
      '<div class="bt-note">演示环境：切片正文为确定性派生内容；生产环境此处显示真实切片全文 + 查询词高亮 + 跳转源文档。</div>';
    openModal('<div class="modal-mask slide" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>命中切片 · ' + h.esc(hit.doc) + '</h3>' +
      '<button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' + bodyHtml + '</div></div></div>');
  };

  ACTIONS['feedback-detail'] = function (id, btn, h) {
    var it = (pipes().userops.feedback && pipes().userops.feedback.items.filter(function (x) { return x.id === id; })[0]) || null;
    if (!it) { h.toast('反馈不存在', 'bad'); return; }
    var fmt = h.fmt;
    var advice = {
      complaint: '投诉优先 48 小时内回访并给出解决方案，同步核查关联策略的触达频控。',
      nps: 'NPS 低分建议电话回访定位真实原因，关联最近一次触达记录复盘。',
      satisfaction: '满意度差评定位到具体会话，检查答复依据是否完整、语气是否机械。',
      unsub: '退订需核查该策略触达频次与人群圈选，超出频控应暂停并调整。',
      bug: '产品缺陷转对应模块，进入缺陷队列并回写处置结果。'
    }[it.kind] || '按标准流程处置并回写结果。';
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(it.kindText) + ' · ' + h.esc(it.id) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="bt-note">' + h.esc(it.summary) + '</div>' +
      '<dl class="dl">' +
      '<dt>来源</dt><dd>' + h.esc(it.channel) + '</dd>' +
      '<dt>关联对象</dt><dd>' + h.esc(it.related) + '</dd>' +
      '<dt>影响</dt><dd>' + fmt.int(it.impact) + ' 人</dd>' +
      '<dt>时间</dt><dd>' + fmt.rel(it.dayOffset) + '</dd>' +
      '<dt>状态</dt><dd>' + h.pill(it.status, it.statusText) + '</dd>' +
      '</dl>' +
      '<div class="sub-h">处置建议</div>' +
      '<div class="bt-note">' + h.esc(advice) + '</div>' +
      '</div></div></div>');
  };

  /* 单用户实验的典型反应样例（配置态模板池 + 确定性展示）：
   * 触达 → 反应 → 结果，展示单用户模式的反应结构，不做运行时编造。
   */
  var SIM_REACTION_POOL = {
    'sm-mom': [
      { touch: '推送「新品种草预热」触达文案', reply: '「先加购物车，等大促再买，现在买不划算」', outcome: '观望', ok: false },
      { touch: '展示试用装小额入口（¥9.9）', reply: '「这个牌子没买过，先花小钱试试，好用了再回购」', outcome: '小额采纳', ok: true },
      { touch: '追问「宝妈群里其他人的评价」', reply: '「群里有姐妹说这款一般，我再对比对比」', outcome: '比价流失', ok: false }
    ],
    'sm-it': [
      { touch: '发送「选型方案概览」邮件', reply: '「预算要走采购流程，先把技术白皮书和报价单发我」', outcome: '转需求评估', ok: false },
      { touch: '同步资质与安全合规文档', reply: '「数据合规证明齐了才好推进，我们内控卡得严」', outcome: '合规前置确认', ok: false },
      { touch: '电话跟进决策进展', reply: '「这季度排期满了，下季度立项再联系你们」', outcome: '延后', ok: false }
    ],
    'sm-genz': [
      { touch: '短视频种草脚本触达', reply: '「哇这个好酷，直接冲了！」', outcome: '立即采纳', ok: true },
      { touch: '比价提示触达', reply: '「直播间的同款更便宜，先去蹲个券」', outcome: '比价流失', ok: false },
      { touch: '晒单返现活动推送', reply: '「买了发闺蜜群问值不值，她点头我就下单」', outcome: '社交确认后采纳', ok: true }
    ],
    'sm-proc': [
      { touch: '正式报价函送达', reply: '「按采购制度需三家比价，先挂到流程里」', outcome: '转比价流程', ok: false },
      { touch: '提供技术参数对比表', reply: '「参数对比齐了，评标要用，发盖章版过来」', outcome: '索要材料·推进中', ok: false },
      { touch: '季度末跟进', reply: '「本季度额度已用完，下季度预算批了再说」', outcome: '延后', ok: false }
    ],
    'sm-legal': [
      { touch: '合同初稿送审', reply: '「第 4.2 条免责表述与现行法规冲突，先改再签」', outcome: '退回合规修改', ok: false },
      { touch: '修订版合同复审', reply: '「改得可以，风险提示部分再补一段」', outcome: '补充意见后推进', ok: false },
      { touch: '终版会签提醒', reply: '「内容过审了，走会签流程吧」', outcome: '内部流程确认', ok: true }
    ]
  };

  ACTIONS['sim-mode'] = function (id, btn, h) {
    if (SIM_MODES.filter(function (m) { return m.id === id; }).length) {
      h.state.simMode = id;
      // 视图复位到默认「简略」：切模式不该把上一个模式手动选的视图带过来
      h.state.poolView = null;
      // 切到单人时收敛选中态：多用户可能选了 N 位，单人只跑 1 位 —— 保留最后勾选的那位并告知，
      // 不能让 4 个勾选态挂在「单人」tab 上（那是在骗人：单人根本不会跑 4 位）
      var sel = window.SIM_POOL_SEL || [];
      if (id === 'single' && sel.length > 1) {
        var keep = sel[sel.length - 1];
        window.SIM_POOL_SEL = [keep];
        var nm = (poolRows().filter(function (r) { return r.id === keep; })[0] || {}).name || keep;
        h.toast('单人模拟一次只跑 1 位 —— 已保留最后勾选的「' + nm + '」，其余 ' + (sel.length - 1) + ' 位未纳入本次', 'info');
      }
      // 换模式 = 换一批实验，本次判定结论不再适用
      window.SIM_JUDGED = false;
      // 单人「池 → 回放」的这一幕也要归位，否则从别的 tab 切回来直接落在回放上、看不到池子
      window.SIM_SINGLE_STAGE = 'pool';
      h.navigate({});
    }
  };

  /* --- 全局用户池动作 --- */
  // 换样本就等于换了一次判定：旧分数必须失效，否则会张冠李戴（换了人还挂着上一个人的分）
  function poolInvalidateJudge() { window.SIM_JUDGED = false; }

  ACTIONS['pool-toggle'] = function (id, btn, h) {
    var sel = (window.SIM_POOL_SEL || []).slice();
    var i = sel.indexOf(id);
    if (i > -1) { sel.splice(i, 1); unmarkJudged(id); }
    else {
      // 单人模拟一次只跑一位：在勾选当下就拦下并说清，不让用户白勾一轮
      if (h.state.simMode === 'single' && sel.length >= 1) {
        h.toast('单人模拟一次只跑 1 位 —— 请先取消已选的那位，或切到「多用户模拟」', 'info');
        return;
      }
      sel.push(id);
    }
    window.SIM_POOL_SEL = sel;
    poolInvalidateJudge();
    h.navigate({}, { scroll: false });
  };

  ACTIONS['pool-clear'] = function (id, btn, h) {
    window.SIM_POOL_SEL = [];
    window.SIM_JUDGED_IDS = {};
    poolInvalidateJudge();
    h.navigate({}, { scroll: false });
  };

  ACTIONS['pool-view'] = function (id, btn, h) {
    if (id === 'simple' || id === 'detail') { h.state.poolView = id; h.navigate({}, { scroll: false }); }
  };

  /* 单人模拟的「进入这个人」转场：选中的小卡原地放大到整张池卡的尺寸，放大完成后再切到对话回放。
   * 用 fixed 覆盖层而不是给 .pcell 加 class —— 切页是全量重渲染，原节点会直接消失，动画会断。
   * 只在单人模式用：多用户是"跑一批人"，没有"进入某一位"这个语义。 */
  function flyIntoReplay(done) {
    var cell = document.querySelector('.pcell.on');
    var pool = document.querySelector('.pool-grid');
    var card = pool && pool.closest('.card');
    if (!cell || !card || !window.requestAnimationFrame) { done(); return; }
    var a = cell.getBoundingClientRect();
    var b = card.getBoundingClientRect();
    /* 记下这张卡现在的真实高度：回放卡按它撑开，落地时不会缩 */
    window.SIM_STAGE_H = Math.round(b.height);
    var g = document.createElement('div');
    g.className = 'pool-fly';
    g.style.left = a.left + 'px';
    g.style.top = a.top + 'px';
    g.style.width = a.width + 'px';
    g.style.height = a.height + 'px';
    /* 里面放这个人自己的圆章和名字：放大时内容始终居中、字号不跟着拉，
     * 看上去就是「这张卡铺开，人还在中间」。只放色块的话，放大到 1200px 就是一块白板。 */
    var av = cell.querySelector('.pav'), nm = cell.querySelector('.pname');
    if (av) g.appendChild(av.cloneNode(true));
    if (nm) g.appendChild(nm.cloneNode(true));
    document.body.appendChild(g);
    cell.style.visibility = 'hidden';
    card.style.transition = 'opacity .34s linear';
    card.style.opacity = '0.22';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        g.style.left = b.left + 'px';
        g.style.top = b.top + 'px';
        g.style.width = b.width + 'px';
        g.style.height = b.height + 'px';
        // 一路从卡片的灰底变成对话卡的白底，淡出那一下就不会有色块跳变
        g.style.backgroundColor = '#fff';
      });
    });
    setTimeout(function () {
      done();
      setTimeout(function () {
        g.classList.add('out');
        setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 220);
      }, 30);
    }, 450);
  }

  ACTIONS['pool-confirm'] = function (id, btn, h) {
    var sel = window.SIM_POOL_SEL || [];
    if (!sel.length) { h.toast('请先在池中勾选样本', 'bad'); return; }
    // 单人模拟一次只跑一位：多选时取最后勾选的那位，并明确告知，不静默吞掉用户的选择
    if (h.state.simMode === 'single' && sel.length > 1) {
      h.toast('单人模拟一次只跑 1 位，已取最后勾选的「' + (poolRows().filter(function (r) { return r.id === sel[sel.length - 1]; })[0] || {}).name + '」', 'info');
    }
    window.SIM_JUDGED = true;
    markJudged(sel);
    /* 未具名样本判定通过 → 回填完整画像（姓名/职业/标签/痛点/消费），并给出判定分 */
    sel.forEach(function (uid) {
      var r = poolRows().filter(function (x) { return x.id === uid; })[0];
      if (r && !r.named) backfillOf(uid);
    });
    var eng = simEngine(h.state.simMode);
    var run = function () {
      h.toast('已对 ' + sel.length + ' 位样本执行「' + (eng.label || '模拟') + '」', 'info');
      h.navigate({}, { scroll: false });
    };
    if (h.state.simMode === 'single') {
      window.SIM_SINGLE_STAGE = 'replay';
      window.SIM_REPLAY_RUN = null;   // 换人 = 换一批记录，上一次选中的那条不能带过来
      flyIntoReplay(run);
      return;
    }
    run();
  };

  /* 点一条模拟记录 = 模拟那一次的对话；data-id 为空表示回「选记录」这一步 */
  ACTIONS['sim-pick-run'] = function (id, btn, h) {
    window.SIM_REPLAY_RUN = id || null;
    h.navigate({}, { scroll: false });
  };

  /* 回放卡头上的「换一位用户」：把池子放回来（这位的已处理状态不清，回来还看得见） */
  ACTIONS['sim-back-pool'] = function (id, btn, h) {
    window.SIM_SINGLE_STAGE = 'pool';
    window.SIM_REPLAY_RUN = null;
    h.navigate({}, { scroll: false });
  };

  /* 续聊回复：候选全部取自既有文本（这位用户的 3 句既定回应 + 他最近一次实验所用 persona 的反应样例），
   * 按「词面重合 → 同义词话题 → 确定性抖动」三层挑；avoid = 上一句已给过的回复，能避就避。
   * 池里是 up-* 用户、反应池是 sm-* persona，两套 id 必须经实验记录搭桥。 */
  var SIM_CHAT_SYN = {
    '价格': /价|钱|贵|便宜|优惠|券|促销|折扣|划算|省|报|预算/,
    '物流': /物流|快递|发货|几天|到货|时效|运费|慢|快/,
    '售后': /售后|退|换|客服|维修|保修/,
    '尺码': /尺码|大小|版型|码数/,
    '实拍': /实拍|图片|照片|图|细节|材质|质量|做工/
  };
  function simChatReply(r, text, n, avoid) {
    function bigrams(s) {
      var out = [], i, str = String(s);
      for (i = 0; i < str.length - 1; i++) out.push(str.slice(i, i + 2));
      return out;
    }
    var grams = bigrams(text);
    // 这句话涉及哪几个话题：同义词表把「报价」这类问法映射到话术池真会出现的词
    var topics = Object.keys(SIM_CHAT_SYN).filter(function (k) { return SIM_CHAT_SYN[k].test(text); });
    var bank = REPLAY_BANK[replayTheme(r)];
    var own = bank.turns.map(function (t) { return t[1]; });
    var cands = own.slice();
    var lastRun = ((assets().sim_runs && assets().sim_runs.rows) || []).filter(function (x) {
      return (x.poolUserIds || []).indexOf(r.id) > -1;
    }).sort(function (a, b) { return b.dayOffset - a.dayOffset; })[0];
    if (lastRun) (SIM_REACTION_POOL[lastRun.personaId] || []).forEach(function (p) { cands.push(p.reply); });
    var best = null;
    cands.forEach(function (c, i) {
      var g = bigrams(c);
      var hit = g.filter(function (x) { return grams.indexOf(x) > -1; }).length;
      var topic = topics.filter(function (k) { return SIM_CHAT_SYN[k].test(c); }).length;
      var jitter = S.R.of('simchat|' + r.id + '|' + n + '|' + text + '|' + i)();
      var score = hit * 10 + topic * 6 + jitter - (avoid && c === avoid ? 25 : 0);
      if (!best || score > best.score) best = { score: score, hit: hit, topic: topic, text: c };
    });
    /* 词面与话题都没命中时，persona 反应样例很容易答非所问（实测：问「物流要几天到」它回
     * 「哇这个好酷，直接冲了！」）—— 这时退回这位用户自己说过的三句：词面也不一定对得上，
     * 但至少是他本人的口吻，且这句本来就在回放里出现过。 */
    if (!best.hit && !best.topic) {
      var pool2 = own.filter(function (x) { return x !== avoid; });
      if (!pool2.length) pool2 = own;
      var k = Math.floor(S.R.of('simchat-own|' + r.id + '|' + n + '|' + text)() * pool2.length) % pool2.length;
      best = { score: 0, hit: 0, topic: 0, text: pool2[k] };
    }
    return { reply: best.text, from: own.length + ' 句既定回应 + ' + (lastRun ? 'persona 反应样例' : '无 persona 样例') };
  }

  ACTIONS['sim-chat-send'] = function (id, btn, h) {
    var inp = document.getElementById('sim-chat-input');
    var text = inp && inp.value ? String(inp.value).replace(/^\s+|\s+$/g, '') : '';
    if (!text) { h.toast('先写一句要跟他说的话', 'bad'); return; }
    var sel = window.SIM_POOL_SEL || [];
    var r = sel.length ? (poolRows().filter(function (x) { return x.id === sel[0]; })[0] || null) : null;
    if (!r) { h.toast('先在用户池里勾选一位样本', 'bad'); return; }
    if (!window.SIM_CHAT) window.SIM_CHAT = {};
    var log = window.SIM_CHAT[r.id] || (window.SIM_CHAT[r.id] = []);
    log.push({ who: 'me', text: text });
    // 轮次按「我问了几次」算：同一个人被问第 3 次与第 1 次不该给同一条回复
    var n = log.filter(function (m) { return m.who === 'me'; }).length;
    var prev = null;
    for (var li = log.length - 1; li >= 0; li--) { if (log[li].who === 'user') { prev = log[li].text; break; } }
    log.push({ who: 'user', text: simChatReply(r, text, n, prev).reply });
    h.navigate({}, { scroll: false });
  };

  ACTIONS['sim-chat-clear'] = function (id, btn, h) {
    var sel = window.SIM_POOL_SEL || [];
    if (sel.length && window.SIM_CHAT) delete window.SIM_CHAT[sel[0]];
    h.navigate({}, { scroll: false });
  };

  ACTIONS['simrun-detail'] = function (id, btn, h) {
    var x = simRunsAll().filter(function (r) { return r.id === id; })[0] || null;
    if (!x) { h.toast('实验不存在', 'bad'); return; }
    var fmt = h.fmt;
    var pers = window.SIM_PERSONAS[x.personaId];
    var lowFid = pers && pers.fidelity < 0.8;

    /* 刚提交、还没跑批的实验：如实说明「没有任何结果」，不要拿 0 样本画一根 0% 的条。
     * 这是提交后能看见变化的前提 —— 否则用户点完提交，界面上什么都没发生。 */
    if (x.status === 'queued') {
      openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-h"><h3>' + h.esc(x.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
        '<div class="modal-b">' +
        '<div class="bt-warn">跑批中 · 尚未产生结果（演示环境不跑批，会一直停在这里）</div>' +
        '<dl class="dl">' +
        '<dt>模式</dt><dd>' + h.esc(x.modeText) + '</dd>' +
        '<dt>样本</dt><dd>' + (x.poolUserText ? h.esc(x.poolUserText) : '—') + '</dd>' +
        '<dt>提交时间</dt><dd>刚刚</dd>' +
        '</dl>' +
        '<div class="sub-h">本轮话术</div>' +
        '<div style="white-space:pre-wrap;background:var(--bg-subtle-1);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.7">' + h.esc(x.body || '—') + '</div>' +
        (x.bodyB ? '<div class="sub-h">对照版话术</div>' +
          '<div style="white-space:pre-wrap;background:var(--bg-subtle-1);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.7">' + h.esc(x.bodyB) + '</div>' : '') +
        '</div></div></div>');
      return;
    }

    var riskLv = x.mode === 'opinion' ? simRiskLevel(x.senti.neg) : null;
    var sentiHtml = '';
    var bodyHtml = '';
    var actHtml = '';
    if (x.mode === 'opinion') {
      var rows2 = [['正面', x.senti.pos, '#1e8e3e'], ['中性', x.senti.neu, '#5f6368'], ['负面', x.senti.neg, '#c5221f']];
      var rtype = x.riskType || riskTypeOf(x.body || x.name, x.senti.neg);
      var vd = opinionVerdict(x);
      var acted = opActs()[x.id];
      sentiHtml = '<div class="sub-h">情绪分布</div><div style="display:flex;gap:8px;flex-wrap:wrap">' + rows2.map(function (p) {
        return '<div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px">' +
          '<div style="font-size:12px;color:var(--sub)">' + p[0] + '</div><b style="color:' + p[2] + '">' + fmt.pct1(p[1]) + '</b></div>';
      }).join('') + '</div>' +
        '<dl class="dl"><dt>风险类型</dt><dd>' + h.esc(rtype) + '</dd>' +
        '<dt>判定依据</dt><dd>' + (riskHitsOf(x.body || x.name).length
          ? '文案命中：' + h.esc(riskHitsOf(x.body || x.name).join('、'))
          : '未命中预设风险词，按负面档位归类') + '</dd>' +
        '<dt>风险档</dt><dd><span class="pill ' + (riskLv === '高' ? 'bad' : (riskLv === '中' ? 'warn' : 'ok')) + '">' +
        riskLv + '（高风险概率 ' + x.risk + '%）</span></dd></dl>' +
        '<div class="bt-note" style="margin-top:10px">高风险概率与负面占比同源，本演示不单独建模；风险类型按文案里真实出现的风险词判定。</div>';
      if (x.body) {
        bodyHtml = '<div class="sub-h">判定对象 · 文案正文</div>' +
          '<div style="white-space:pre-wrap;background:var(--bg-subtle-1);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.7">' + h.esc(x.body) + '</div>';
      }
      /* 结论必须落到一个动作上 —— 判完不改，等于没判 */
      actHtml = '<div class="sub-h" style="margin-top:16px">处置</div>' +
        (acted
          ? '<div class="bt-note">当前状态：<b class="ok">' + h.esc(OP_ACT_TEXT[acted] || acted) + '</b>。列表已同步标记。</div>'
          : '<div class="bt-note">' + (vd.k === 'ok' ? '风险在阈值内，可直接投放；有疑虑也可先转人工复核。' : '结论不是「可投」，必须选一个动作收口。') + '</div>') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
        '<button class="btn-ghost sm" data-act="sim-op-act" data-id="' + h.esc(x.id + '|rewrite') + '">改写降险</button>' +
        '<button class="btn-ghost sm" data-act="sim-op-act" data-id="' + h.esc(x.id + '|review') + '">转人工复核</button>' +
        '<button class="btn-ghost sm" data-act="sim-op-act" data-id="' + h.esc(x.id + '|block') + '">标记不投放</button>' +
        '</div>';
    } else {
      sentiHtml = '<div class="sub-h">转化结果</div>' +
        '<dl class="dl"><dt>样本</dt><dd>' + fmt.int(x.sample) + '</dd>' +
        '<dt>采纳</dt><dd>' + fmt.int(x.adopted) + '（' + fmt.pct1(x.sample ? x.adopted / x.sample : 0) + '）</dd></dl>' +
        '<div style="height:10px;background:#f1f3f4;border-radius:5px;overflow:hidden"><i style="display:block;height:100%;width:' + Math.min(100, x.sample ? x.adopted / x.sample * 100 : 0) + '%;background:#2563eb"></i></div>';
      if (x.body) {
        bodyHtml = '<div class="sub-h">本轮话术</div>' +
          '<div style="white-space:pre-wrap;background:var(--bg-subtle-1);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.7">' + h.esc(x.body) + '</div>';
      }
    }
    var reactHtml = '';
    if (x.mode === 'single') {
      var pool = SIM_REACTION_POOL[x.personaId] || [];
      reactHtml = '<div class="sub-h">典型反应样例（' + pool.length + ' 条）</div>' +
        (pool.length ? '<div class="tbl-wrap"><table class="bt"><thead><tr><th>触达动作</th><th>persona 反应</th><th>结果</th></tr></thead><tbody>' +
          pool.map(function (p) {
            return '<tr><td>' + h.esc(p.touch) + '</td><td><span class="impact-txt">' + h.esc(p.reply) + '</span></td>' +
              '<td><span class="pill ' + (p.ok ? 'ok' : 'warn') + '">' + h.esc(p.outcome) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="bt-note">反应样例为配置态模板（与 persona 绑定，种子固定即稳定），展示单用户「触达 → 反应 → 结果」结构；真实生产由模拟引擎逐条回放对话。</div>' :
          '<div class="bt-note">该 persona 暂无反应样例模板。</div>');
    }
    var vdTop = x.mode === 'opinion' ? opinionVerdict(x) : null;
    var VB = vdTop ? (vdTop.k === 'bad'
      ? { bg: '#fef2f2', bd: '#b91c1c', fg: '#b91c1c' }
      : (vdTop.k === 'warn'
        ? { bg: '#fff7e8', bd: '#b45309', fg: '#b45309' }
        : { bg: '#ecfdf3', bd: '#15803d', fg: '#15803d' })) : null;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(x.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      (lowFid ? '<div class="bt-warn">⚠ 该实验引用的 persona 保真度未达标（' + fmt.pct1(pers.fidelity) + '），结论不可用于决策。</div>' : '') +
      (vdTop
        ? '<div style="background:' + VB.bg + ';border:1px solid ' + VB.bd + ';color:' + VB.fg +
          ';padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.7;margin-bottom:12px">' +
          '结论：<b>' + h.esc(vdTop.t) + '</b> —— ' + h.esc(vdTop.note) + '</div>'
        : '<div class="bt-note">模拟结论，投产前建议小额试投验证。</div>') +
      '<dl class="dl">' +
      '<dt>模式</dt><dd>' + h.esc(x.modeText) + '</dd>' +
      (pers ? '<dt>persona</dt><dd>' + h.esc(x.personaName) + '（保真度 ' + fmt.pct1(pers.fidelity) + '）</dd>' +
        '<dt>边界</dt><dd>' + h.esc(pers.fidelityScope) + '</dd>' : '<dt>persona</dt><dd>不挂 persona（判定对象是内容本身）</dd>') +
      '<dt>方案</dt><dd>' + h.esc(x.scheme) + '</dd>' +
      '<dt>时间</dt><dd>' + fmt.rel(x.dayOffset) + '</dd>' +
      '</dl>' + bodyHtml + sentiHtml + actHtml + reactHtml +
      '</div></div></div>');
  };

  /* 区域分析总开关：只记「用户有没有主动启用过」这一个表态，不动地图与已选 */
  ACTIONS['op-region-on'] = function (id, btn, h) {
    window.OP_REGION_ON = id === 'on';
    h.navigate({}, { scroll: false });
  };

  /* 传播网络视野切换：局部池 / 全局池 */
  ACTIONS['op-net-scope'] = function (id, btn, h) {
    window.OP_NET_SCOPE = id === 'global' ? 'global' : 'local';
    h.navigate({}, { scroll: false });
  };

  /* 区域分析：点地图上的地区 = 选中它（再点「回到全球」清空） */
  ACTIONS['op-region'] = function (id, btn, h) {
    var cur = window.OP_REGION_SEL || [];
    if (!id) cur = [];                       // 「全球」= 清空
    else { var i = cur.indexOf(id); if (i > -1) cur.splice(i, 1); else cur.push(id); }
    window.OP_REGION_SEL = cur;
    h.navigate({}, { scroll: false });
  };

  /* 舆情处置：判完必须能落一个动作，且列表要立刻反映出来 */
  ACTIONS['sim-op-act'] = function (id, btn, h) {
    var parts = String(id || '').split('|');
    var runId = parts[0], act = parts[1];
    if (!runId || !act) return;
    opActs()[runId] = act;
    var m = document.querySelector('.modal-mask'); if (m) m.remove();
    h.toast('已处置：' + (OP_ACT_TEXT[act] || act) + ' —— 列表已同步标记', act === 'block' ? 'bad' : 'info');
    h.navigate({}, { scroll: false });
  };

  /* 已删除（2026-10-17）：ACTIONS['simrun-filter'] 与 ACTIONS['simrun-clear']。
     它们写 h.state.simFilter，但全仓对该状态**只写不读**（渲染层没有任何一处消费），
     且全仓 data-act="simrun-filter" / "simrun-clear" 引用数为 0 —— 纯死代码。
     实验的筛选语义已由「按池中选中样本过滤」（simUserPage 的 poolFilter）承担，
     不需要再留一套没人接线的按 persona 筛选。同批删除 sim-mode 里的 simFilter 重置。 */

  /* 合规条目详情：走真路由（cap 声明了 detailType，R.complianceDetail 已实现），
     这样详情可分享、可后退 —— 与沙盒/Agent 详情保持一致。
     此前该渲染器没有任何入口能到，属于写了但用不上。 */
  ACTIONS['comp-detail'] = function (id, btn, h) {
    h.navigate({ domain: 'engine', cap: 'compliance', agentId: id, tab: null, traceId: null, page: 1 });
  };

  ACTIONS['auth-rule-detail'] = function (id, btn, h) {
    var r = (queues().approval.authRules || []).filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('规则不存在', 'bad'); return; }
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>授权规则 ' + h.esc(r.id) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>主体</dt><dd>' + h.esc(r.subject) + '</dd>' +
      '<dt>Agent 能力</dt><dd>' + h.esc(r.agentCap) + '</dd>' +
      '<dt>动作</dt><dd>' + h.esc(r.action) + '</dd>' +
      '<dt>数据范围</dt><dd class="mono">' + h.esc(r.scope) + '</dd>' +
      '<dt>条件</dt><dd>' + h.esc(r.cond) + '</dd>' +
      '<dt>风险</dt><dd><span class="pill ' + (r.risk === '高' ? 'bad' : (r.risk === '中' ? 'warn' : 'ok')) + '">' + h.esc(r.risk) + '</span></dd>' +
      '<dt>状态</dt><dd>' + h.pill(r.status === 'on' ? 'ok' : 'idle', r.statusText) + '</dd>' +
      '</dl>' +
      '<div class="bt-note">授权是「在任务中、以身份、在数据与时间范围内执行动作」的判定，而非"能不能用 AI"。</div>' +
      '</div></div></div>');
  };

  ACTIONS['sec-act'] = function (id, btn, h) {
    var it = (queues().approval.secEvents || []).filter(function (x) { return x.id === id; })[0];
    if (!it) { h.toast('事件不存在', 'bad'); return; }
    if (it.result === '待处置') { h.toast('已创建处置工单：' + it.id, 'info'); return; }
    var fmt = h.fmt;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>安全事件 ' + h.esc(it.id) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>时间</dt><dd>' + fmt.rel(it.dayOffset) + '</dd>' +
      '<dt>类型</dt><dd>' + h.esc(it.kindText) + '（' + h.esc(it.level) + '）</dd>' +
      '<dt>主体</dt><dd>' + h.esc(it.actor) + '</dd>' +
      '<dt>动作</dt><dd>' + h.esc(it.action) + '</dd>' +
      '<dt>结果</dt><dd>' + h.pill(it.result === '待处置' ? 'warn' : (it.result === '已阻断' ? 'info' : 'ok'), it.result) + '</dd>' +
      '<dt>影响</dt><dd>' + fmt.int(it.impact) + ' 项</dd>' +
      '</dl>' +
      '<div class="bt-note">已阻断/已处置事件不可重复处置，处置动作不可逆。</div>' +
      '</div></div></div>');
  };

  ACTIONS['seg-detail'] = function (id, btn, h) {
    var seg = pipes().userops.segments.filter(function (s) { return s.id === id; })[0];
    if (!seg) { h.toast('分群不存在', 'bad'); return; }
    var fmt = h.fmt;
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(seg.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="sub-h">圈选条件</div><div>' + seg.conds.map(function (c) { return '<span class="tag">' + h.esc(c) + '</span>'; }).join('') + '</div>' +
      '<dl class="dl">' +
      '<dt>覆盖</dt><dd>' + fmt.int(seg.cover) + '（池 ' + fmt.pct1(seg.coverShare) + '）</dd>' +
      '<dt>活跃率</dt><dd class="' + (seg.actRate >= 0.8 ? 'ok' : '') + '">' + fmt.pct1(seg.actRate) + '</dd>' +
      '<dt>被引用</dt><dd>' + (seg.refPipes ? seg.refPipes + ' 条策略正在圈选该群' : '当前无策略圈选') + '</dd>' +
      '</dl>' +
      '<div class="sub-h">近 7 日活跃趋势</div><div>' + C.sparkline(seg.trend, { width: 220, height: 44, color: '#2563eb' }) + '</div>' +
      '<div class="sub-h">下一步</div>' +
      '<div class="bt-note">' + (seg.refPipes ? '该分群已被 ' + seg.refPipes + ' 条策略圈选，可在用户运营页调整灰度比例，或据此新建覆盖策略。' : '该分群尚无策略圈选，建议据此新建触达策略，闭环投放决策。') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">' +
        /* 「据此新建策略」= 从本分群起一张 user-ops 策略草稿（create-open 的表单，目标分群由 data-id 预填）。
           旁边原来写死的「已提交」是假的 —— 按钮根本没接线，用户读到的是一句没发生过的事，已换成如实说明。 */
        '<button class="btn-primary" data-act="demo-new-strategy" data-id="' + h.esc(seg.id) + '">据此新建策略</button>' +
        '<span class="bt-note" style="margin:0">会新建「草稿态」策略并预选本分群 —— 不立即触达任何用户，走上线通过后才开始投放</span>' +
      '</div>' +
      '</div></div></div>');
  };

  /* v15：自进化「回滚 / 转全量」—— 此前两个按钮都是空动作，
     而旁边还写着「自动回滚条件：…（已启用）」这种无从验证的承诺。会话内状态 state.evoOps[id]。 */
  ACTIONS['evo-decide'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var it = pipes().evolution.items.filter(function (x) { return x.id === p[0]; })[0];
    if (!it) { h.toast('进化任务不存在', 'bad'); return; }
    var op = p[1] || 'rollback';
    var fmt = h.fmt;
    var gray = (it.stages[3] || {}).gray || {};
    var map = {
      rollback: { title: '回滚该策略', state: 'rollback', tone: 'danger', confirm: '确认回滚', reason: true, perm: 'evo:strategy:rollback' },
      full: { title: '转全量', state: 'full', tone: 'warn', confirm: '确认转全量', reason: true, perm: 'evo:strategy:requestFull' }
    };
    var m = map[op] || map.rollback;
    var impacts = op === 'rollback' ? [
      { label: '影响策略', value: it.name + '（' + it.agentName + '）' },
      { label: '灰度份额', value: Math.round((gray.ratio || 0) * 100) + '% 的流量将回到线上版本', tone: 'danger' },
      { label: '已运行', value: (gray.days || 0) + ' 天，期间收益一并回退' },
      { label: '可重试', value: '否 —— 回滚后需人工确认原因才能重新灰度', tone: 'warn' }
    ] : [
      { label: '影响策略', value: it.name + '（' + it.agentName + '）' },
      { label: '生效方式', value: '点击即转全量' },
      { label: '转全量后', value: '该策略承接 100% 流量（当前灰度 ' + Math.round((gray.ratio || 0) * 100) + '%）' },
      { label: 'AI 权限边界', value: 'AI 只能提交候选，绝不允许自动全量上线' }
    ];
    h.dangerConfirm(h, {
      title: m.title, desc: m.title + '「' + it.name + '」？',
      tone: m.tone, perm: m.perm,
      impacts: impacts, confirmText: m.confirm,
      onConfirm: function (reason) {
        h.state.evoOps = h.state.evoOps || {};
        h.state.evoOps[it.id] = m.state;
        /* 2026-10-21：审批下线 —— 以前这里建一张审批单再等人点头，现在只有一个人，
           建单等于自己给自己看。改为**直接生效**。 */
        if (op === 'full') {
          h.toast('已转全量 · 「' + it.name + '」承接 100% 流量', 'ok');
        } else {
          h.toast('已回滚（本会话演示，不执行真实写操作）', 'ok');
        }
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['evo-undo'] = function (id, btn, h) {
    if (h.state.evoOps) delete h.state.evoOps[id];
    h.toast('已撤销本会话的演示状态', 'info');
    h.navigate({}, { scroll: false });
  };

  /* v15：合规规则包「停用 / 回滚上一版」—— 页面自己标着 v13「误报超标 3.2% > 阈值 2%」，
     按它自己的规则就不该在跑，此前却停不下来。会话内状态 state.ruleOps[id]。 */
  ACTIONS['rule-toggle'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var packs = {
      'rp-law': { name: '敏感表述-广告法 v12', scope: '覆盖 9 类场景', rules: 142, hit: 1284, falsePos: 0.018 },
      'rp-pii': { name: '数据出境校验 v3', scope: 'PII / 跨境传输', rules: 38, hit: 96, falsePos: 0.004 },
      'rp-sample': { name: '输出内容抽样机制', scope: '抽样比例 5%', rules: 1, hit: 3402, falsePos: 0 },
      'rp-law13': { name: '广告法新增表述规则 v13', scope: '灰度 10% 流量', rules: 24, hit: 61, falsePos: 0.032 }
    }[p[0]];
    if (!packs) {
      /* 本会话新建的规则包也要能停用 —— 从会话对象里兜底取 */
      var no = ((h.state.newObjs || {})['compliance'] || []).filter(function (x) { return x.id === p[0]; })[0];
      if (no) packs = { name: no.name, scope: no.scope, rules: no.rules, hit: 0, falsePos: 0 };
    }
    if (!packs) { h.toast('规则包不存在', 'bad'); return; }
    var op = p[1] || 'disable';
    var fmt = h.fmt;
    var map = {
      disable: { title: '停用规则包', state: 'disabled', tone: 'danger', confirm: '确认停用', reason: true },
      enable: { title: '启用规则包', state: 'enabled', tone: 'normal', confirm: '确认启用', reason: false },
      rollback: { title: '回滚到上一版', state: 'rolledback', tone: 'danger', confirm: '确认回滚', reason: true }
    };
    var m = map[op] || map.disable;
    var impacts = op === 'disable' ? [
      { label: '停止拦截', value: '该包覆盖的 ' + packs.scope + ' 不再被检查', tone: 'danger' },
      { label: '历史命中量', value: fmt.int(packs.hit) + ' 次（累计）' },
      { label: '规则条数', value: packs.rules + ' 条将全部失效' },
      { label: '可撤销', value: '是 —— 可随时重新启用' }
    ] : op === 'rollback' ? [
      { label: '当前误报率', value: fmt.pct1(packs.falsePos) + '（阈值 2%，已超标）', tone: 'danger' },
      { label: '回滚到', value: '上一稳定版（误报率 1.8%）' },
      { label: '影响范围', value: packs.scope + ' · ' + packs.rules + ' 条规则' },
      { label: '可撤销', value: '是' }
    ] : [
      { label: '恢复拦截', value: packs.scope + ' 重新纳入检查' },
      { label: '规则条数', value: packs.rules + ' 条' },
      { label: '上次误报率', value: fmt.pct1(packs.falsePos) + (packs.falsePos > 0.02 ? '（仍高于 2% 阈值，留意）' : '') },
      { label: '可撤销', value: '是' }
    ];
    h.dangerConfirm(h, {
      title: m.title, desc: m.title + '「' + packs.name + '」？',
      tone: m.tone, perm: 'compliance:rulepack:' + m.state,
      impacts: impacts, confirmText: m.confirm,
      action: m.title, target: p[0] + ' · ' + packs.name,
      onConfirm: function () {
        h.state.ruleOps = h.state.ruleOps || {};
        h.state.ruleOps[p[0]] = m.state;
        h.toast('演示环境：' + m.title + '已记录到本会话（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* v16：经验条目的 通过 / 驳回 / 弃用 一律走确认层（生产规格 §2.3「审核操作」要三者都可追溯）。
     并且把结论同步回审批队列里对应的复核单 —— 此前经验库自己批完，审批队列仍显示「审批中 · 王五」，
     两条链路各写各的状态，等于绕过审批自批。 */
  var EXP_OPS = {
    pass:      { title: '复核通过', state: 'verified',   confirm: '确认通过', tone: 'normal', reason: true },
    reject:    { title: '驳回经验', state: 'rejected',   confirm: '确认驳回', tone: 'warn',   reason: true },
    deprecate: { title: '弃用经验', state: 'deprecated', confirm: '确认弃用', tone: 'danger', reason: true }
  };
  /* 审批队列里经验复核单的 type = exp-review，targetId 指向经验条目 id */
  function syncApprovalByExp(h, expId, decision, reason) {
    var ap = queues().approval;
    var hits = ((ap && ap.items) || []).filter(function (x) {
      return x.type === 'exp-review' && x.targetId === expId && !x.decided;
    });
    if (!hits.length) return 0;
    h.state.aprOps = h.state.aprOps || {};
    hits.forEach(function (x) { h.state.aprOps[x.id] = { s: decision, reason: reason || '' }; });
    return hits.length;
  }
  ACTIONS['exp-decide'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var q = queues().experience;
    var r = q && q.items.filter(function (x) { return x.id === p[0]; })[0];
    if (!r) { h.toast('经验条目不存在', 'bad'); return; }
    var op = EXP_OPS[p[1]] || EXP_OPS.pass;
    var fmt = h.fmt;
    var agents = (r.agents || []).length;
    var ev = r.evidence || {}, fb = r.feedback || {};
    var impacts = op.state === 'deprecated' ? [
      { label: '移出检索池', value: '是 —— 该条不再被任何 Agent 检索到', tone: 'danger' },
      { label: '被检索次数', value: fmt.int(r.searches) + ' 次（累计）' },
      { label: '绑定的 Agent', value: agents ? agents + ' 个' : '无绑定' },
      { label: '反向反馈', value: (fb.down || 0) + ' 反对 / ' + (fb.wrong || 0) + ' 判定用错' },
      { label: '可恢复', value: '是 —— 到「状态」筛选里切「已弃用」即可恢复' }
    ] : [
      { label: '复核对象', value: r.title + '（' + r.scene + '）' },
      { label: '归属', value: r.scope === 'shared' ? '共享 · ' + agents + ' 个 Agent 可用' : '私有 · 仅 ' + agents + ' 个 Agent' },
      { label: '收益分', value: fmt.num1(r.gain) + '（' + (r.gain >= 5 ? '高' : (r.gain < 2 ? '低，建议弃用' : '中')) + '）' },
      { label: '证据', value: '支持 ' + (ev.support || 0) + ' / 反例 ' + (ev.contradict || 0) + ' / 补充 ' + (ev.supplement || 0) },
      { label: '影响', value: op.state === 'verified' ? '该经验进入正式库，可被绑定的 Agent 检索复用' : '退回登记人补充论证，不进入检索池；同步回流进化任务作为负样本' }
    ];
    h.dangerConfirm(h, {
      title: op.title, desc: op.title + '「' + r.title + '」？',
      tone: op.tone, perm: 'llm-exp:entry:' + op.state,
      impacts: impacts, confirmText: op.confirm,
      action: op.title, target: r.id + ' · ' + r.title,
      onConfirm: function (reason) {
        h.state.expOps = h.state.expOps || {};
        h.state.expOps[r.id] = op.state;
        var n = syncApprovalByExp(h, r.id, op.state === 'rejected' ? 'rejected' : 'approved', reason);
        h.toast('演示环境：' + op.title + '已记录到本会话' + (n ? '，并同步了 ' + n + ' 张复核单' : '') + '（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* v16：弃用的反向操作。此前确认框承诺「可在已弃用中恢复」，但页面上根本没有这个入口。 */
  ACTIONS['exp-restore'] = function (id, btn, h) {
    var r = queues().experience.items.filter(function (x) { return x.id === id; })[0];
    if (!r) { h.toast('经验条目不存在', 'bad'); return; }
    var fmt = h.fmt, fb = r.feedback || {};
    h.dangerConfirm(h, {
      title: '恢复经验', desc: '把「' + r.title + '」放回检索池？',
      tone: 'warn', perm: 'llm-exp:entry:restore',
      impacts: [
        { label: '重新进入检索池', value: '是 —— 绑定的 Agent 会再次检索到它' },
        { label: '历史命中率', value: fmt.pct0(r.hitRate) + '（恢复前请确认口径已修正，否则噪声会回流）' },
        { label: '反向反馈', value: (fb.down || 0) + ' 反对 / ' + (fb.wrong || 0) + ' 判定用错（越多越不安全）' },
              ],
      confirmText: '确认恢复',
      onConfirm: function (reason) {
        h.state.expOps = h.state.expOps || {};
        h.state.expOps[r.id] = 'restored';
        h.toast('演示环境：已把「' + r.title + '」放回检索池（仅本会话）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* ============================================================ v15 创建向导
   * 批 3-A：先打通「新建 Agent」一条完整链路（开表单 → 必填校验 → 落列表 → 进详情 → 可撤销）。
   * 形态确认后往 V15_CREATE 里继续加其余 5 张表 —— 一处配置、一套渲染，不重复造件。
   * 复用既有 openSheet（不新造抽屉）；字段值只在会话内留存，提交不落库。
   * ============================================================ */
  var V15_CREATE = {
    'agent-wb': {
      title: '创建 Agent',
      stateLabel: '草稿态',
      note: '建完是「草稿」态，不影响线上；需走发布审批才会上线',
      fields: [
        { k: 'name', label: '名称', type: 'text', req: true, ph: '例如：客服知识助手', sec: '必填' },
        { k: 'model', label: '主模型', type: 'select', req: true, src: 'MODELS' },
        { k: 'biz', label: '业务线', type: 'select', req: true, src: 'BIZ_LINES' },
        { k: 'kbs', label: '知识库', type: 'multi', src: 'KBS', sec: '关联', hint: '选填，但决定它能不能答对' },
        { k: 'tools', label: '工具', type: 'multi', src: 'MCP_SERVICES' },
        { k: 'level', label: '隔离等级', type: 'seg', src: 'S_LEVEL_RULES', def: 'S2', sec: '安全' }
      ],
      build: function (v, o) {
        o.modelName = (S.MODELS.filter(function (m) { return m.id === v.model; })[0] || {}).name || v.model;
        o.bizName = (S.BIZ_LINES.filter(function (b) { return b.id === v.biz; })[0] || {}).name || v.biz;
        o.kbNames = (v.kbs || []).map(function (x) { var k = S.KBS.filter(function (y) { return y.id === x; })[0]; return k ? k.name : x; });
        o.toolNames = (v.tools || []).map(function (x) { var m = S.MCP_SERVICES.filter(function (y) { return y.id === x; })[0]; return m ? m.name : x; });
        o.meta = [o.modelName, o.bizName, o.level].join(' · ');
      },
      todo: function (o) {
        var t = [];
        if (!(o.kbNames || []).length) t.push('未关联知识库 —— 可能答不出业务问题');
        if (!(o.toolNames || []).length) t.push('未关联工具 —— 不能查实时业务数据');
        t.push('未做批量测试回归 —— 发布前必须完成');
        t.push('尚未发布');
        return t;
      }
    },
    'user-ops': {
      title: '新建策略',
      stateLabel: '草稿态',
      note: '建完是「草稿」态，不会立即触达任何用户；走「上线」通过后才开始投放',
      fields: [
        { k: 'name', label: '策略名', type: 'text', req: true, ph: '例如：双十二预热 · 沉睡唤醒', sec: '必填' },
        { k: 'seg', label: '目标分群', type: 'select', req: true, src: 'SEGMENTS', hint: '选完立即显示覆盖人数' },
        { k: 'channel', label: '触达渠道', type: 'multi', src: 'CHANNELS', req: true, hint: '至少选 1 个' },
        { k: 'copy', label: '开场文案', type: 'text', req: true, ph: '一句话说清对用户的价值' },
        { k: 'rate', label: '灰度比例', type: 'seg', src: 'RATES', def: '10', sec: '投放节奏' }
        /* 2026-10-28：负责人字段删了 —— 全系统只有一个人，必选下拉只有一个选项。 */
      ],
      segOf: function (v) { return (pipes().userops.segments || []).filter(function (s) { return s.id === v.seg; })[0]; },
      impact: function (v, h) {
        var fmt = h.fmt, seg = this.segOf(v);
        var lines = ['创建后为<b>草稿</b>，不会立即触达任何用户'];
        if (seg) lines.push('分群「' + seg.name + '」覆盖 <b>' + fmt.int(seg.cover) + ' 人</b>，近 7 日活跃 ' + fmt.pct1(seg.actRate));
        else lines.push('尚未选择目标分群');
        if (v.rate && seg) lines.push('首轮灰度 ' + v.rate + '% ≈ <b>' + fmt.int(Math.round(seg.cover * Number(v.rate) / 100)) + ' 人</b>（按剔除 holdout 后计；holdout 恒为净人群 5%，不可为 0）');
        lines.push('下发前自动排除：频控内已触达 / 已退订 / 黑名单（不可关闭）');
        lines.push('走「上线」通过后才开始投放');
        return lines;
      },
      build: function (v, o) {
        var seg = (pipes().userops.segments || []).filter(function (s) { return s.id === v.seg; })[0];
        o.segName = seg ? seg.name : '—';
        o.segCover = seg ? seg.cover : 0;
        o.meta = o.segName + ' · 灰度 ' + (v.rate || '-') + '%';
      },
      todo: function (o) { return ['未上线 —— 确认上线后才会开始投放', '未设置频控上限（将使用业务默认值）']; }
    },
    'compliance': {
      title: '新建规则包',
      stateLabel: '灰度中',
      note: '建完是「灰度中」态 —— 本页规则：新规则必须灰度验证，误报率超 2% 不允许发布',
      fields: [
        { k: 'name', label: '规则包名', type: 'text', req: true, ph: '例如：广告法新增表述 v14', sec: '必填' },
        { k: 'scope', label: '覆盖范围', type: 'text', req: true, ph: '例如：覆盖 9 类场景' },
        { k: 'rules', label: '规则条目', type: 'text', req: true, ph: '新增规则的判定口径，多条用「；」分隔', hint: '至少 1 条' },
        { k: 'threshold', label: '误报阈值', type: 'seg', src: 'THRESHOLDS', def: '2%', hint: '超阈值不允许发布' },
        { k: 'rate', label: '灰度比例', type: 'seg', src: 'RATES', def: '10', sec: '灰度验证' }
      ],
      impact: function (v, h) {
        var fmt = h.fmt, n = String(v.rules || '').split('；').filter(function (x) { return x.trim(); }).length;
        return [
          '创建后为<b>灰度中</b>，只作用于 ' + (v.rate || '10') + '% 的流量',
          '规则条目 <b>' + n + ' 条</b>，覆盖「' + (v.scope || '—') + '」',
          '误报阈值 ' + (v.threshold || '2%') + ' —— 超过即不允许转全量',
          '转为全量必须由你确认'
        ];
      },
      build: function (v, o) {
        o.rules = String(v.rules || '').split('；').filter(function (x) { return x.trim(); }).length;
        o.meta = (v.scope || '') + ' · 灰度 ' + (v.rate || '10') + '% · 阈值 ' + (v.threshold || '2%');
      },
      todo: function () { return ['灰度期样本不足，尚不能判定误报率 —— 需继续观察', '尚未转全量']; }
    },
    'approval': {
      title: '发起审批',
      stateLabel: '已提交',
      note: '提交后进入审批链路；影响面会随单据一并展示给审批人',
      fields: [
        { k: 'title', label: '变更标题', type: 'text', req: true, ph: '一句话说清要改什么', sec: '必填' },
        { k: 'type', label: '单据类型', type: 'select', req: true, src: 'APPR_TYPES' },
        { k: 'targetId', label: '关联对象', type: 'text', req: true, ph: '例如：ag-legal-ctr / kb-faq' },
        { k: 'affect', label: '影响对象数', type: 'text', req: true, ph: '例如：7', hint: '影响几个 Agent / 策略' },
        { k: 'rollback', label: '是否可回滚', type: 'seg', src: 'YESNO', def: '是', sec: '影响面' },
        { k: 'reason', label: '变更说明', type: 'text', req: true, ph: '为什么改、改了之后预期什么效果' }
      ],
      impact: function (v) {
        return [
          '提交后进入审批链路，审批人可见本页影响面',
          '影响对象 <b>' + (v.affect || '—') + ' 个</b>' + (v.targetId ? '（关联 ' + v.targetId + '）' : ''),
          '可回滚：<b>' + (v.rollback || '—') + '</b>' + (v.rollback === '否' ? '　风险较高，需审批人重点评估' : ''),
          '审批期间单据可撤回，通过后生效'
        ];
      },
      build: function (v, o) {
        o.meta = (v.type || '') + ' · 影响 ' + (v.affect || '-') + ' 个对象';
        o.affect = v.affect;
        o.targetId = v.targetId;
        o.type = v.type;
        o.rollback = v.rollback;
        o.reason = v.reason;
      },
      todo: function () { return ['等待审批人处理 —— 通过后才会生效']; }
    },
    'survey': {
      title: '创建访谈',
      stateLabel: '草稿态',
      note: '建完是「草稿」态，不触达；发布后才按名单开始多轮触达',
      fields: [
        { k: 'name', label: '访谈任务名', type: 'text', req: true, ph: '例如：流失客户深度访谈', sec: '必填' },
        { k: 'listSource', label: '名单来源', type: 'select', req: true, src: 'LIST_SOURCES' },
        { k: 'delivery', label: '交付方式', type: 'multi', req: true, src: 'DELIVERY_MODES', sec: '触达' },
        { k: 'channel', label: '触达渠道', type: 'multi', req: true, src: 'IV_CHANNELS' },
        { k: 'quietHours', label: '免打扰时段', type: 'seg', src: 'QUIET_HOURS', def: '22:00-08:00 禁发', sec: '合规' },
        { k: 'freq', label: '频控上限', type: 'seg', src: 'FREQS', def: '每人 14 天 ≤ 1 次' }
      ],
      impact: function (v) {
        var dmap = { dispatch: 'AI 派发', selfserve: '自助入口' };
        var cmap = { im: 'IM', wecom: '企微', sms: '短信' };
        var dvs = (v.delivery || []).map(function (x) { return dmap[x] || x; }).join(' / ') || '未选';
        var chs = (v.channel || []).map(function (x) { return cmap[x] || x; }).join(' / ') || '未选';
        var srcTxt = v.listSource === 'import' ? '导入名单'
          : (v.listSource ? '分群 ' + String(v.listSource).replace(/^segment:/, '') : '—');
        return [
          '创建后为<b>草稿</b>，不触达；发布后按名单开始触达',
          '名单来源：' + srcTxt + '；交付方式：' + dvs + '；触达渠道：' + chs,
          '下发前自动排除：频控内已触达 / 已退订 / 黑名单（不可关闭）',
          '外发话术自动附加 AIGC 标识；免打扰时段 ' + (v.quietHours || '22:00-08:00 禁发') + ' 内不发'
        ];
      },
      build: function (v, o) {
        o.meta = (v.listSource || '') + ' · ' + ((v.channel || []).join('/') || '未选渠道');
        o.listSource = v.listSource; o.delivery = v.delivery; o.channel = v.channel;
        o.quietHours = v.quietHours; o.freq = v.freq;
      },
      todo: function () { return ['未发布触达', '未配置多轮追问策略（将使用默认）']; }
    },
    'kol': {
      title: '规划新投放', stateLabel: '草稿态',
      note: '建完是「草稿」态，不会占用预算；上线通过后才开始执行',
      fields: [
        { k: 'name', label: '投放计划名', type: 'text', req: true, ph: '例如：双十二科技品类种草', sec: '必填' },
        { k: 'budget', label: '预算（元）', type: 'text', req: true, ph: '例如：100000' },
        { k: 'goal', label: '优化目标', type: 'seg', src: 'KOL_GOALS', def: '转化' },
        { k: 'kols', label: '候选达人', type: 'multi', src: 'KOL_LIST', sec: '组合', hint: '选填；不选则由投放决策按历史数据推荐' }
      ],
      impact: function (v, h) {
        var ks = (v.kols || []);
        return [
          '创建后为<b>草稿</b>，不占用预算、不触达任何达人',
          '预算 <b>¥' + (v.budget || '—') + '</b>，优化目标：' + (v.goal || '—'),
          ks.length ? '候选达人 ' + ks.length + ' 位' : '未选定达人 —— 将由「投放决策」按历史 ROI / 客群重合度推荐',
          '上线通过后才开始执行'
        ];
      },
      build: function (v, o) {
        var names = (v.kols || []).map(function (id) {
          var k = (global.KOL && global.KOL.KOLS || []).filter(function (x) { return x.id === id; })[0];
          return k ? k.name : id;
        });
        o.kolNames = names;
        o.meta = '预算 ¥' + (v.budget || '-') + ' · 目标 ' + (v.goal || '-') + ' · ' + (names.length ? names.length + ' 位达人' : '达人待推荐');
      },
      todo: function () { return ['未上线 —— 通过后才开始执行']; }
    },
    'approval-rule': {
      title: '新建授权规则', stateLabel: '草稿态',
      note: '建完是「草稿」态，不会立即授权；启用后才生效。',
      fields: [
        { k: 'name', label: '主体', type: 'text', req: true, ph: '例如：销售组', sec: '必填' },
        { k: 'agentCap', label: 'Agent 能力', type: 'select', req: true, src: 'AGENT_CAPS' },
        { k: 'action', label: '动作', type: 'seg', src: 'ACL_ACTS', def: '读取' },
        { k: 'scope', label: '数据范围', type: 'text', req: true, ph: '例如：订单库（仅本租户）', sec: '边界' },
        { k: 'cond', label: '生效条件', type: 'text', ph: '例如：工作时间 09:00-21:00' }
      ],
      impact: function (v) {
        var hi = v.action === '生成' || v.action === '外发';
        return [
          '创建后为<b>草稿</b>，不会立即授权',
          '主体「' + (v.name || '—') + '」→ ' + (v.agentCap || '—') + '，动作：' + (v.action || '—'),
          '数据范围：' + (v.scope || '—') + (v.cond ? '　条件：' + v.cond : ''),
          hi ? '<b>高风险动作</b> —— 启用即生效' : '启用后立即生效'
        ];
      },
      build: function (v, o) { o.meta = (v.agentCap || '') + ' · ' + (v.action || '') + ' · ' + (v.scope || ''); },
      todo: function () { return ['未启用 —— 当前不会授权任何访问']; }
    },
    'user-ops-seg': {
      title: '新建分群', stateLabel: '草稿态',
      note: '建完是「草稿」态，不会被任何策略引用；发布后才进人群池',
      fields: [
        { k: 'name', label: '分群名', type: 'text', req: true, ph: '例如：高潜复购人群', sec: '必填' },
        { k: 'basis', label: '圈选依据', type: 'select', req: true, src: 'SEG_BASIS' },
        { k: 'excl', label: '排除规则', type: 'multi', src: 'SEG_EXCL', hint: '默认全选；排除项不可为空' }
      ],
      impact: function (v) {
        var ex = (v.excl || []);
        return [
          '创建后为<b>草稿</b>，不会被任何策略引用',
          '圈选依据：' + (v.basis || '—'),
          '排除规则 ' + ex.length + ' 项' + (ex.length === 0 ? '　（未排除任何人群，投放会打扰已退订用户）' : ''),
          '发布后才进入人群池'
        ];
      },
      build: function (v, o) {
        o.meta = (v.basis || '') + ' · 排除 ' + ((v.excl || []).length) + ' 项';
      },
      todo: function () { return ['未发布 —— 当前不会被任何策略引用']; }
    },
    'user-ops-rule': {
      title: '新建处置规则', stateLabel: '草稿态',
      note: '建完是「草稿」态，不会自动处置任何反馈；启用后才生效',
      fields: [
        { k: 'name', label: '规则名', type: 'text', req: true, ph: '例如：投诉类 2 小时内必回', sec: '必填' },
        { k: 'kind', label: '适用反馈类型', type: 'select', req: true, src: 'FB_KINDS' },
        { k: 'sla', label: '时限（小时）', type: 'text', req: true, ph: '例如：2' },
        { k: 'act', label: '处置动作', type: 'seg', src: 'RULE_ACTS', def: '转待办队列' }
      ],
      impact: function (v) {
        return [
          '创建后为<b>草稿</b>，不会自动处置任何反馈',
          '适用类型「' + (v.kind || '—') + '」，时限 ' + (v.sla || '—') + ' 小时',
          '处置动作：' + (v.act || '转待办队列'),
          '启用后超时会进「先处理什么」并按优先级排序'
        ];
      },
      build: function (v, o) { o.meta = (v.kind || '') + ' · ' + (v.sla || '-') + 'h · ' + (v.act || ''); },
      todo: function () { return ['未启用 —— 当前不会自动处置']; }
    },
    'persona': {
      title: '新建画像', stateLabel: '草稿态',
      note: '建完是「草稿」态，不会被 Agent / 策略引用；发布后才进入引用池',
      fields: [
        { k: 'kind', label: '画像类型', type: 'seg', src: 'PERSONA_KINDS', def: 'ICP', req: true, sec: '必填',
          hint: 'ICP = 描述「哪类企业」；角色画像 = 描述「哪个岗位的人」' },
        { k: 'role', label: '决策链角色', type: 'select', src: 'PERSONA_ROLES', sec: '必填',
          hint: '选「角色画像」时必填：发起者 / 使用者 / 影响者 / 决策者 / 守门人' },
        { k: 'name', label: '画像名称', type: 'text', req: true, ph: '例如：区域政务接口人' },
        { k: 'industry', label: '所属行业', type: 'select', req: true, src: 'INDUSTRIES' },
        { k: 'ents', label: '覆盖企业数', type: 'readonly', sec: '规模口径',
          value: '由圈选条件计算' },
        { k: 'rules', label: '圈选条件', type: 'cond', req: true, sec: '规模口径',
          hint: '规模由这组条件在主数据上算出' },
        { k: 'tags', label: '核心标签', type: 'multi', src: 'TAG_POOL', sec: '画像构成', hint: '选填；标签会作为 Agent 检索与圈选依据' }
      ],
      /* 条件必填当前通用引擎不支持（只认静态 req），所以在这里兜「角色画像必填角色」，
         同时挡住明显是糊弄的圈选条件。覆盖企业数已改为只读计算位，不再校验手填。 */
      validate: function (v) {
        if (v.kind === '角色画像' && !v.role) return '选了「角色画像」就要指定决策链角色（发起者/使用者/影响者/决策者/守门人）';
        if (!(v.rulesItems || []).length) return '至少要写一条圈选条件 —— 覆盖规模是由它算出来的，不是手填的';
        return null;
      },
      impact: function (v, h) {
        return [
          '创建后为<b>草稿</b>，不会被 Agent / 策略引用',
          '类型：<b>' + (v.kind || 'ICP') + '</b>' + (v.kind === '角色画像' ? '（' + (v.role || '未选角色') + '）' : ''),
          '圈选条件：<b>' + (v.rules || '—') + '</b>（' + ((v.rulesItems || []).length) + ' 条）',
          '覆盖企业数由该条件在主数据上按统一社会信用代码去重得出',
          '标签 ' + ((v.tags || []).length || 0) + ' 个' + ((v.tags || []).length ? '' : '　（无标签时只能按行业粗筛）'),
          '发布后才进入引用池'
        ];
      },
      build: function (v, o) {
        o.ents = null;   /* 规模不再来自手填：不给假数字，列表按"示例值/暂无"口径展示 */
        o.rulesDerived = v.rules || '';   /* 新建时是用户填的真条件；存量画像则是反推摘要 */
        o.rulesIsDerived = false;
        o.meta = (v.kind || 'ICP') + (v.kind === '角色画像' ? '·' + (v.role || '') : '') +
          ' · ' + (v.industry || '') + ' · 规模待圈选计算';
      },
      todo: function () { return ['未发布 —— 当前不会被任何 Agent / 策略引用', '未接企业主数据 —— 覆盖规模暂无值']; }
    },
    'knowledge': {
      title: '新建知识库', stateLabel: '草稿态',
      note: '建完是「草稿」态，索引尚未构建；上传文档后才可被检索',
      fields: [
        { k: 'name', label: '知识库名', type: 'text', req: true, ph: '例如：售前常见问题库', sec: '必填' },
        { k: 'kind', label: '内容类型', type: 'select', req: true, src: 'KB_KINDS' },
        { k: 'slice', label: '切片策略', type: 'seg', src: 'SLICES', def: '512', sec: '索引配置', hint: '长文档建议 768，问答型建议 384' }
      ],
      impact: function (v) {
        return [
          '创建后为<b>草稿</b>，索引未构建、不参与检索',
          '内容类型「' + (v.kind || '—') + '」，切片 ' + (v.slice || '512') + ' 字符',
          '上传文档后需点「重建索引」才会生效',
          '零结果率高的库会被标为「内容有缺口」'
        ];
      },
      build: function (v, o) { o.meta = (v.kind || '') + ' · 切片 ' + (v.slice || '512'); },
      todo: function () { return ['未上传文档', '未构建索引']; }
    },
    'llm-exp': {
      title: '登记经验', stateLabel: '草稿态',
      note: '建完是「草稿」态，需复核通过后才进入检索池。正文四段就是这条经验的全部内容 —— 模型靠它检索，人靠它评审',
      fields: [
        { k: 'name', label: '经验标题', type: 'text', req: true, ph: '例如：价格异议应对话术', sec: '必填' },
        { k: 'scope', label: '归属', type: 'seg', src: 'EXP_SCOPES', def: '私有', sec: '归属', hint: '私有：只服务一个 Agent，由它的 owner 复核；共享：多个 Agent 都能检索到，需在对方场景重新验证' },
        { k: 'owner', label: '归属 Agent', type: 'select', src: 'AGENTS', hint: '选「私有」时填这里' },
        { k: 'agents', label: '适用 Agent', type: 'multi', src: 'AGENTS', hint: '选「共享」时填这里，可多选' },
        { k: 'scene', label: '适用场景', type: 'text', req: true, ph: '例如：售前议价 / 报价被质疑', sec: '正文四段' },
        { k: 'trigger', label: '触发条件', type: 'textarea', req: true, ph: '什么情况下该用它 —— 这是模型判断要不要检索它的依据' },
        { k: 'policy', label: '处置策略', type: 'textarea', req: true, ph: '具体怎么做，一步一句' },
        { k: 'taboo', label: '禁忌', type: 'textarea', ph: '什么情况下不能用 —— 这段最容易出事，建议写' },
        { k: 'egQ', label: '示例 · 用户说', type: 'textarea', rows: 2, ph: '例如：你们比别家贵了 12%，能给个底价吗？' },
        { k: 'egA', label: '示例 · 助手答', type: 'textarea', rows: 2, ph: '例如：先跟您确认一下，您比对的是同配置、含 3 年上门服务的方案吗……' },
        { k: 'source', label: '来源', type: 'select', req: true, src: 'EXP_SOURCES', sec: '来源' },
        { k: 'why', label: '为什么值得沉淀', type: 'text', req: true, ph: '一句话说清它解决了什么问题' }
      ],
      impact: function (v) {
        var shared = v.scope === '共享';
        var oName = (S.AGENTS.filter(function (x) { return x.id === v.owner; })[0] || {}).name;
        var n = shared ? ((v.agents || []).length) : (v.owner ? 1 : 0);
        return [
          '创建后为<b>草稿</b>，不参与检索',
          '归属：' + (shared ? '<b>共享</b>（' + n + ' 个 Agent 可用）' : '<b>私有</b>（' + (oName || '还没选归属 Agent') + '）'),
          '正文四段：触发条件 ' + (v.trigger ? '✓' : '✗') + ' · 处置策略 ' + (v.policy ? '✓' : '✗') + ' · 禁忌 ' + (v.taboo ? '✓' : '✗') + ' · 示例 ' + (v.egQ ? '✓' : '✗'),
          shared
            ? '共享经验要在其它 Agent 的场景里重新验证才算生效 —— 经验不因存在即适用'
            : '需<b>复核通过</b>后才进入检索池（本页默认「待复核优先」排序）'
        ];
      },
      build: function (v, o) {
        var shared = v.scope === '共享';
        o.scope = shared ? 'shared' : 'private';
        o.ownerAgent = shared ? null : (v.owner || null);
        o.agents = shared ? (v.agents || []) : (v.owner ? [v.owner] : []);
        o.trigger = v.trigger || '';
        o.policy = v.policy || '';
        o.taboo = v.taboo || '';
        o.example = (v.egQ || v.egA) ? [{ q: v.egQ || '', a: v.egA || '' }] : [];
        o.evidence = { support: 0, contradict: 0, supplement: 0 };
        o.feedback = { up: 0, down: 0, wrong: 0 };
        o.versions = [{ v: 'v1', day: 0, note: '登记即初版，未经复核', state: '草稿' }];
        o.gray = null;
        o.searches = 0; o.hitRate = 0; o.gain = null; o.lastUsedDay = null;
        o.usageRecent = []; o.badcases = []; o.conflicts = [];
        o.meta = (v.scene || '') + ' · ' + (shared ? '共享 ' + o.agents.length + ' 个 Agent' : '私有 · ' + ((S.AGENTS.filter(function (x) { return x.id === v.owner; })[0] || {}).name || '未指定'));
      },
      todo: function (v) {
        var t = ['未复核 —— 复核通过后才进检索池'];
        if (!String(v.taboo || '').length) t.push('没写禁忌 —— 模型不知道该在什么情况下停手');
        if (!v.egQ) t.push('没有示例对话 —— 只有规则没有样例，模型容易理解偏');
        return t;
      }
    },
    'gateway': {
      title: '新增路由', stateLabel: '草稿态',
      note: '建完是「草稿」态，上线后才对外生效',
      fields: [
        { k: 'name', label: '路由名', type: 'text', req: true, ph: '例如：mcp://order/refund', sec: '必填' },
        { k: 'target', label: '目标服务', type: 'select', req: true, src: 'MCP_SERVICES' },
        { k: 'limit', label: '限流上限（次/分）', type: 'text', req: true, ph: '例如：80' }
      ],
      impact: function (v, h) {
        return [
          '创建后为<b>草稿</b>，不对外生效',
          '目标服务：' + (v.target || '—') + '，限流 ' + (v.limit || '—') + ' 次/分',
          '开放给外部调用需走数据安全评估（审批）',
          '生效后配额使用率超 80% 会转琥珀告警'
        ];
      },
      build: function (v, o) {
        o.meta = (v.target || '') + ' · ' + (v.limit || '-') + '/分';
      },
      todo: function () { return ['未提交开通审批 —— 草稿路由不承载流量']; }
    },
    'obs': {
      title: '发起评估', stateLabel: '草稿态',
      note: '建完是「草稿」态，需选择数据集并运行后才出分',
      fields: [
        { k: 'name', label: '评估名称', type: 'text', req: true, ph: '例如：客服助手 v2.4 回归', sec: '必填' },
        { k: 'agent', label: '评估对象', type: 'select', req: true, src: 'AGENTS' },
        { k: 'dataset', label: '数据集', type: 'select', req: true, src: 'DATASETS' },
        { k: 'dims', label: '评估维度', type: 'multi', src: 'EVAL_DIMS', req: true, hint: '至少选 1 个' }
      ],
      impact: function (v) {
        return [
          '创建后为<b>草稿</b>，不会自动开跑',
          '对象与数据集选定后需点「运行」才出分',
          '评估维度 ' + ((v.dims || []).length || 0) + ' 个' + ((v.dims || []).length ? '' : '　（至少选 1 个）'),
          '结果会进「评估任务」列表，可与线上基线对比'
        ];
      },
      build: function (v, o) {
        var a = S.AGENTS.filter(function (x) { return x.id === v.agent; })[0];
        o.agentName = a ? a.name : v.agent;
        o.meta = o.agentName + ' · ' + (v.dataset || '') + ' · ' + ((v.dims || []).length) + ' 个维度';
      },
      todo: function () { return ['未运行 —— 运行后才会产生评估结果']; }
    },
    'evo': {
      title: '发起进化任务', stateLabel: '草稿态',
      note: 'AI 只产出候选策略，转全量必须由你确认 —— 绝不允许 AI 自动全量上线',
      fields: [
        { k: 'name', label: '任务名', type: 'text', req: true, ph: '例如：退货场景 badcase 修复', sec: '必填' },
        { k: 'agent', label: '目标 Agent', type: 'select', req: true, src: 'AGENTS' },
        { k: 'src', label: 'badcase 来源', type: 'select', req: true, src: 'BC_SOURCES' },
        { k: 'trigger', label: '触发方式', type: 'seg', src: 'EVO_TRIGGERS', def: '手动触发', sec: '执行' }
      ],
      impact: function (v) {
        var a = S.AGENTS.filter(function (x) { return x.id === v.agent; })[0];
        return [
          '创建后为<b>草稿</b>，不会自动聚类',
          '对象：' + (a ? a.name : (v.agent || '—')) + '，badcase 来源 ' + (v.src || '—'),
          '触发方式：' + (v.trigger || '手动触发'),
          'AI 只产出候选策略，<b>转全量必须由你确认</b>'
        ];
      },
      build: function (v, o) {
        var a = S.AGENTS.filter(function (x) { return x.id === v.agent; })[0];
        o.agentName = a ? a.name : v.agent;
        o.meta = o.agentName + ' · ' + (v.src || '');
      },
      todo: function () { return ['未运行聚类 —— 运行后才产出候选策略']; }
    }
  };
  function cfOptions(src) {
    if (src === 'MODELS') return S.MODELS.map(function (m) { return { v: m.id, t: m.name }; });
    if (src === 'BIZ_LINES') return S.BIZ_LINES.map(function (b) { return { v: b.id, t: b.name }; });
    if (src === 'OWNERS') return S.OWNERS.map(function (o) { return { v: o.id, t: o.name }; });
    if (src === 'KBS') return S.KBS.map(function (k) { return { v: k.id, t: k.name }; });
    if (src === 'MCP_SERVICES') return S.MCP_SERVICES.map(function (m) { return { v: m.id, t: m.name }; });
    if (src === 'S_LEVEL_RULES') return ((global.APP_DATA && global.APP_DATA.sLevelRules) || []).map(function (l) {
      return { v: l.level, t: l.level + ' · ' + l.taskKind, tip: l.runtime + ' / 出网：' + l.net };
    });
    if (src === 'SEGMENTS') return (pipes().userops.segments || []).map(function (s) {
      return { v: s.id, t: s.name + '（覆盖 ' + s.cover + ' 人 · 活跃 ' + Math.round(s.actRate * 100) + '%）' };
    });
    if (src === 'CHANNELS') return [{ v: 'sms', t: '短信' }, { v: 'push', t: 'Push' }, { v: 'inapp', t: '站内信' }, { v: 'im', t: 'IM' }, { v: 'wecom', t: '企微' }];
    if (src === 'RATES') return [{ v: '1', t: '1%（起步档）' }, { v: '5', t: '5%' }, { v: '10', t: '10%' }, { v: '20', t: '20%' }, { v: '50', t: '50%' }];
    if (src === 'THRESHOLDS') return [{ v: '1%', t: '1%' }, { v: '2%', t: '2%（默认）' }, { v: '3%', t: '3%' }, { v: '5%', t: '5%' }];
    if (src === 'YESNO') return [{ v: '是', t: '是' }, { v: '否', t: '否' }];
    if (src === 'APPR_TYPES') return [
      { v: 'agent-publish', t: 'Agent 发布' }, { v: 'mcp-open', t: 'MCP 服务对外开放' },
      { v: 'persona-change', t: '画像字段变更' }, { v: 'rule-publish', t: '合规规则包发布' },
      { v: 'sandbox-net', t: '沙盒网络策略变更' }, { v: 'strategy-launch', t: '运营策略投放' }
    ];
    if (src === 'SURVEY_TARGETS') return [{ v: '企业客户', t: '企业客户' }, { v: '近30天新客', t: '近 30 天新客' }, { v: '流失客户', t: '流失客户' }, { v: '内部员工', t: '内部员工' }];
    if (src === 'END_CONDS') return [{ v: '达到配额', t: '达到配额自动结束' }, { v: '手动结束', t: '手动结束' }];
    if (src === 'LIST_SOURCES') {
      var lsegs = (pipes().userops && pipes().userops.segments) || [];
      var lsopts = lsegs.map(function (s) { return { v: 'segment:' + s.id, t: '分群：' + s.name + '（覆盖 ' + Math.round(s.cover) + ' 人）' }; });
      lsopts.push({ v: 'import', t: '导入名单（CSV / Excel）' });
      return lsopts;
    }
    if (src === 'DELIVERY_MODES') return [{ v: 'dispatch', t: 'AI 派发（IM / 企微 / 短信）' }, { v: 'selfserve', t: '自助入口（链接 / 二维码）' }];
    if (src === 'IV_CHANNELS') return [{ v: 'im', t: 'IM' }, { v: 'wecom', t: '企微' }, { v: 'sms', t: '短信' }];
    if (src === 'QUIET_HOURS') return [{ v: '22:00-08:00 禁发', t: '22:00-08:00 禁发' }, { v: '21:00-09:00 禁发', t: '21:00-09:00 禁发' }, { v: '不禁发', t: '不禁发' }];
    if (src === 'FREQS') return [{ v: '每人 14 天 ≤ 1 次', t: '每人 14 天 ≤ 1 次' }, { v: '每人 7 天 ≤ 1 次', t: '每人 7 天 ≤ 1 次' }, { v: '每人 30 天 ≤ 2 次', t: '每人 30 天 ≤ 2 次' }];
    if (src === 'INDUSTRIES') return [{ v: '制造', t: '制造' }, { v: '零售', t: '零售' }, { v: '金融', t: '金融' }, { v: '政务', t: '政务' }, { v: '电商', t: '电商' }, { v: '教育', t: '教育' }];
    /* 画像库：B2B 两类对象 —— ICP（账户级）与角色画像（决策链角色级） */
    if (src === 'PERSONA_KINDS') return [
      { v: 'ICP', t: 'ICP（哪类企业）' },
      { v: '角色画像', t: '角色画像（哪个岗位的人）' }
    ];
    if (src === 'PERSONA_COND_FIELDS') return [
      { v: '行业', t: '行业' }, { v: '企业规模', t: '企业规模' }, { v: '年采购额', t: '年采购额' },
      { v: '已有标签', t: '已有标签' }, { v: '地域', t: '地域' }, { v: '上市情况', t: '上市情况' }
    ];
    if (src === 'PERSONA_COND_OPS') return [
      { v: '=', t: '=' }, { v: '≠', t: '≠' }, { v: '≥', t: '≥' }, { v: '≤', t: '≤' },
      { v: '含', t: '含' }, { v: '不含', t: '不含' }
    ];
    if (src === 'PERSONA_ROLES') return [
      { v: '发起者', t: '发起者（一线/工程师）' }, { v: '使用者', t: '使用者（操作岗）' },
      { v: '影响者', t: '影响者（技术/合规把关）' }, { v: '决策者', t: '决策者（老板/采购总监）' },
      { v: '守门人', t: '守门人（采购/验收）' }
    ];
    if (src === 'KB_KINDS') return [{ v: '产品文档', t: '产品文档' }, { v: '政策法规', t: '政策法规' }, { v: '销售话术', t: '销售话术' }, { v: '售后案例', t: '售后案例' }, { v: '合同范本', t: '合同范本' }];
    if (src === 'SLICES') return [{ v: '384', t: '384 字符（问答型）' }, { v: '512', t: '512 字符（默认）' }, { v: '768', t: '768 字符（长文档）' }];
    if (src === 'EXP_SOURCES') return [{ v: '人工录入', t: '人工录入' }, { v: 'badcase 提炼', t: 'badcase 提炼' }, { v: '自进化产出', t: '自进化产出' }];
    /* 归属：seg 渲染时直接显示 v，所以用中文值，build 时再映射成 private / shared */
    if (src === 'EXP_SCOPES') return [{ v: '私有', t: '单 Agent 私有' }, { v: '共享', t: '多 Agent 共享' }];
    if (src === 'AGENTS') return S.AGENTS.filter(function (a) { return a.retiredAt === undefined; }).map(function (a) { return { v: a.id, t: a.name }; });
    if (src === 'DATASETS') return [{ v: '内置回归集 120 例', t: '内置回归集 120 例' }, { v: '历史 badcase 集', t: '历史 badcase 集' }, { v: 'NPS 调研语料', t: 'NPS 调研语料' }, { v: '知识库抽查集', t: '知识库抽查集' }];
    if (src === 'EVAL_DIMS') return [{ v: '事实性', t: '事实性' }, { v: '相关性', t: '相关性' }, { v: '安全性', t: '安全性' }, { v: '完整性', t: '完整性' }, { v: '成本', t: '成本' }];
    if (src === 'BC_SOURCES') return [{ v: '生产 badcase', t: '生产 badcase（线上抽取）' }, { v: '人工标注', t: '人工标注' }, { v: '质检抽样', t: '质检抽样' }];
    if (src === 'EVO_TRIGGERS') return [{ v: '手动触发', t: '手动触发' }, { v: '每日定时', t: '每日定时' }, { v: 'badcase 阈值触发', t: 'badcase 超阈值自动触发' }];
    if (src === 'AGENT_CAPS') return S.AGENTS.map(function (a) { return { v: a.name, t: a.name }; });
    if (src === 'ACL_ACTS') return [{ v: '读取', t: '读取' }, { v: '写入', t: '写入' }, { v: '生成', t: '生成（高风险）' }, { v: '外发', t: '对外发送（高风险）' }];
    /* v20：补 F（采购频次）维度 —— 此前只有 R（近访问）和 M（采购额）的影子，
       「高频低客单」这类最有 upsell 潜力的群体永远圈不出来（RFM 是用户分层的事实标准）。 */
    if (src === 'SEG_BASIS') return [{ v: '近 90 天无访问', t: '近 90 天无访问' }, { v: '近 90 天采购 ≥ 3 次', t: '近 90 天采购 ≥ 3 次（F）' }, { v: '历史客单 > 500', t: '历史客单 > 500' }, { v: '近 7 天高频活跃', t: '近 7 天高频活跃' }, { v: '年采购额 > 500万', t: '年采购额 > 500 万' }];
    if (src === 'SEG_EXCL') return [{ v: '频控内已触达', t: '频控内已触达' }, { v: '已退订', t: '已退订' }, { v: '黑名单', t: '黑名单' }, { v: '已在其他策略', t: '已在其他策略' }];
    if (src === 'FB_KINDS') return [{ v: '投诉', t: '投诉' }, { v: '产品缺陷', t: '产品缺陷' }, { v: '退订', t: '退订' }, { v: 'NPS 低分', t: 'NPS 低分' }, { v: '满意度差评', t: '满意度差评' }];
    /* 2026-10-28：处置动作不再出现「指派责任人 / 升级主管」—— 没有第二个人可指派、也没有主管。
       改成三档「谁在什么时候接手」：进待办队列 / 标为高优置顶 / 自动回复。 */
    if (src === 'RULE_ACTS') return [{ v: '转待办队列', t: '转待办队列' }, { v: '置顶高优', t: '置顶高优' }, { v: '自动回复', t: '自动回复并标记' }];
    if (src === 'KOL_GOALS') return [{ v: '曝光', t: '曝光量' }, { v: '点击', t: '点击率' }, { v: '转化', t: '转化 / ROI' }];
    if (src === 'KOL_LIST') return ((global.KOL && global.KOL.KOLS) || []).map(function (k) { return { v: k.id, t: k.name }; });
    if (src === 'TAG_POOL') {
      /* 标签池取现有画像标签的并集（不另造一套词） */
      var tags = {}, pool = [];
      (assets().persona.rows || []).forEach(function (r) {
        (r.tags || []).forEach(function (t) { if (!tags[t]) { tags[t] = 1; pool.push(t); } });
      });
      return pool.map(function (t) { return { v: t, t: t }; });
    }
    return [];
  }
  /* 圈选条件组：一行一个条件（字段/操作符/值），最多 3 条，行间 AND/OR 可切。
     data-cf="rules" 挂在容器上，值由 condRead 读成 {join, items[]}。 */
  function condRowHtml() {
    var F = cfOptions('PERSONA_COND_FIELDS'), O = cfOptions('PERSONA_COND_OPS');
    return '<div class="v15-cond-row" data-cond-row>' +
      '<select data-cond-field>' + F.map(function (x) { return '<option value="' + escAttr(x.v) + '">' + escAttr(x.t) + '</option>'; }).join('') + '</select>' +
      '<select data-cond-op>' + O.map(function (x) { return '<option value="' + escAttr(x.v) + '">' + escAttr(x.t) + '</option>'; }).join('') + '</select>' +
      '<input data-cond-val placeholder="值（例：制造 / 500万）">' +
      '<button type="button" class="v15-cond-del" data-cond-del aria-label="删除该条件">×</button>' +
      '</div>';
  }
  /* 一条条件 = 一行；底部（AND/OR + 加一条）只出现一次。
     注：早前"加一条"误把底部 footer 一起复制，页面上会出现两排下拉 —— 这里用独立的 row 渲染函数修掉。 */
  function condEditorHtml(f) {
    return '<div class="v15-cond" data-cf="' + escAttr(f.k) + '" data-cf-kind="cond">' +
      condRowHtml() +
      '<div class="v15-cond-foot">' +
      '<select data-cond-join aria-label="条件组合关系"><option value="AND">满足全部（AND）</option><option value="OR">满足任一（OR）</option></select>' +
      '<button type="button" class="btn-ghost sm" data-cond-add>+ 加一条</button>' +
      '</div></div>';
  }
  /* 读条件组：只返回填了值的行；playground 下不编默认值 */
  function condRead(root) {
    var box = root.querySelector('[data-cf-kind="cond"]');
    if (!box) return { join: 'AND', items: [] };
    var join = (box.querySelector('[data-cond-join]') || {}).value || 'AND';
    var items = [];
    Array.prototype.forEach.call(box.querySelectorAll('[data-cond-row]'), function (row) {
      var v = String((row.querySelector('[data-cond-val]') || {}).value || '').trim();
      if (!v) return;
      items.push({
        f: (row.querySelector('[data-cond-field]') || {}).value || '',
        op: (row.querySelector('[data-cond-op]') || {}).value || '=',
        v: v
      });
    });
    return { join: join, items: items };
  }
  function condText(c) {
    if (!c || !c.items.length) return '';
    return c.items.map(function (x) { return x.f + ' ' + x.op + ' ' + x.v; }).join(c.join === 'OR' ? ' OR ' : ' AND ');
  }

  function cfFormHtml(def) {
    var html = '', lastSec = null;
    def.fields.forEach(function (f) {
      if (f.sec && f.sec !== lastSec) { html += '<div class="v15-cf-sec">' + escAttr(f.sec) + '</div>'; lastSec = f.sec; }
      var opts = cfOptions(f.src), ctl = '';
      if (f.type === 'text') ctl = '<input data-cf="' + escAttr(f.k) + '" placeholder="' + escAttr(f.ph || '') + '" style="width:100%">';
      /* readonly：只读展示位（不给输入框、不带 data-cf）—— 用于「由规则算出来的」字段，
         例如画像的覆盖企业数：它是计算项，不该由人手填。 */
      else if (f.type === 'readonly') ctl = '<div class="v15-ro">' + escAttr(f.value || '—') + '</div>';
      /* cond：圈选条件组（字段 / 操作符 / 值 + AND-OR + 增删）。
         规模必须由条件算出来，所以这里不是自由文本 —— 结构化后才能在主数据上执行。 */
      else if (f.type === 'cond') ctl = condEditorHtml(f);
      else if (f.type === 'textarea') ctl = '<textarea data-cf="' + escAttr(f.k) + '" rows="' + (f.rows || 3) + '" placeholder="' + escAttr(f.ph || '') + '" style="width:100%;font:inherit;padding:8px;border:1px solid #e6e9f0;border-radius:8px;resize:vertical"></textarea>';
      else if (f.type === 'select') ctl = '<select data-cf="' + escAttr(f.k) + '" style="width:100%">' + opts.map(function (o) {
        return '<option value="' + escAttr(o.v) + '">' + escAttr(o.t) + '</option>';
      }).join('') + '</select>';
      else ctl = '<div class="v15-pick" data-cf="' + escAttr(f.k) + '" data-cf-kind="' + escAttr(f.type) + '">' + opts.map(function (o) {
        return '<button type="button" data-pick="' + escAttr(o.v) + '"' + (f.type === 'seg' && o.v === f.def ? ' class="on"' : '') +
          (o.tip ? ' title="' + escAttr(o.tip) + '"' : '') + '>' + escAttr(f.type === 'seg' ? o.v : o.t) + '</button>';
      }).join('') + '</div>';
      html += '<div class="v15-cf-row" data-row="' + escAttr(f.k) + '"><label>' + escAttr(f.label) +
        (f.req ? ' <span style="color:#dc2626">*</span>' : '') + '</label><div>' + ctl +
        (f.hint ? '<div class="cf-hint">' + escAttr(f.hint) + '</div>' : '') +
        '<div class="v15-cf-errmsg">必填项</div></div></div>';
    });
    return html;
  }
  function cfValues(root, def) {
    var v = {};
    def.fields.forEach(function (f) {
      var el = root.querySelector('[data-cf="' + f.k + '"]');
      if (!el) return;
      if (f.type === 'cond') { var c = condRead(root); v[f.k] = condText(c); v[f.k + 'Items'] = c.items; v[f.k + 'Join'] = c.join; }
      else if (f.type === 'multi') v[f.k] = Array.prototype.map.call(el.querySelectorAll('button.on'), function (b) { return b.getAttribute('data-pick'); });
      else if (f.type === 'seg') { var on = el.querySelector('button.on'); v[f.k] = on ? on.getAttribute('data-pick') : (f.def || null); }
      else v[f.k] = String(el.value == null ? '' : el.value).trim();
    });
    return v;
  }
  function cfImpact(root, def, h) {
    var v = cfValues(root, def);
    var el = root.querySelector('#cf-impact');
    if (!el) return;
    var lines;
    if (typeof def.impact === 'function') lines = def.impact(v, h);
    else {
      var nk = (v.kbs || []).length, nt = (v.tools || []).length;
      lines = ['创建后为<b>草稿</b>，不占用线上流量',
        '引用 ' + nk + ' 个知识库 / ' + nt + ' 个 MCP 服务' + ((nk + nt) ? '，发布前需可用' : '　（未关联数据与工具，可能答不出业务问题）'),
        '发布上线后才会生效'];
    }
    el.innerHTML = '<b>影响面预览</b>（随填写实时更新）<br>' + lines.join('<br>');
  }
  function cfBind(root, def, h) {
    root.addEventListener('click', function (e) {
      var add = e.target && e.target.closest ? e.target.closest('[data-cond-add]') : null;
      if (add) {
        var box = root.querySelector('[data-cf-kind="cond"]');
        var rows = box.querySelectorAll('[data-cond-row]');
        if (rows.length >= 3) { h.toast('演示环境：最多 3 条条件，够说明口径了', 'info'); return; }
        rows[rows.length - 1].insertAdjacentHTML('afterend', condRowHtml());
        cfImpact(root, def, h);
        return;
      }
      var del = e.target && e.target.closest ? e.target.closest('[data-cond-del]') : null;
      if (del) {
        var box2 = root.querySelector('[data-cf-kind="cond"]');
        var all = box2.querySelectorAll('[data-cond-row]');
        if (all.length <= 1) { h.toast('至少留一条条件', 'info'); return; }
        del.closest('[data-cond-row]').remove();
        cfImpact(root, def, h);
        return;
      }
      var b = e.target && e.target.closest ? e.target.closest('[data-pick]') : null;
      if (!b) return;
      var box = b.parentNode;
      if (box.getAttribute('data-cf-kind') === 'seg') {
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      } else b.classList.toggle('on');
      cfImpact(root, def, h);
    });
    root.addEventListener('input', function () { cfImpact(root, def, h); });
    root.addEventListener('change', function () { cfImpact(root, def, h); });
    cfImpact(root, def, h);
  }
  ACTIONS['create-open'] = function (id, btn, h) {
    var capId = id || (btn && btn.getAttribute ? btn.getAttribute('data-create') : '') || '';
    var def = V15_CREATE[capId];
    if (!def) {
      /* 两条：① 不印能力 id —— 本仓约定 ps-gov / cp-1 这类内部 id 不给用户看，此前这里印的是「sandbox」
             ② 不写交付排期 ——「本轮先打通 Agent，其余按排期逐个接」是内部计划，不是用户该读的话 */
      var _c = h.capById ? h.capById(capId) : null;
      h.toast('「' + ((_c && _c.name) || '该能力') + '」的新建入口暂未开放', 'info');
      return;
    }
    global.V10UI.openSheet({
      title: def.title,
      bodyHtml: (def.note ? '<div class="bt-note" style="margin-bottom:12px">' + escAttr(def.note) + '</div>' : '') +
        cfFormHtml(def) + '<div class="v15-impact" id="cf-impact"></div>',
      footHtml: '<button class="btn-ghost" data-act="create-cancel">取消</button>' +
        '<button class="btn-primary" data-act="create-submit" data-id="' + escAttr(capId) + '">创建草稿</button>',
      onOpen: function (root) { cfBind(root, def, h); }
    });
  };
  ACTIONS['create-cancel'] = function (id, btn, h) { if (global.V10UI) global.V10UI.closeSheet(); };
  ACTIONS['create-submit'] = function (id, btn, h) {
    var capId = String(id || ''), def = V15_CREATE[capId];
    if (!def) return;
    var root = document.querySelector('.v10-sheet');
    if (!root) return;
    var v = cfValues(root, def), bad = null;
    def.fields.forEach(function (f) {
      var row = root.querySelector('[data-row="' + f.k + '"]');
      var ok = !f.req || (v[f.k] && String(v[f.k]).length);
      if (row) row.classList.toggle('cf-err', !ok);
      if (!ok && !bad) bad = row;
    });
    if (bad) {
      var inp = bad.querySelector('input,select');
      if (inp && inp.focus) { try { inp.focus(); } catch (e) {} }
      h.toast('还有必填项没填', 'bad');
      return;
    }
    /* 每类资产可带自己的校验（如画像：选角色画像必须指定角色）——
       此前没有校验钩子，也没有"条件必填"，只能靠静态 req。 */
    if (typeof def.validate === 'function') {
      var msg = def.validate(v);
      if (msg) {
        /* 错误行高亮：优先高亮该资产自己声明的问题字段，避免指到一个不存在的行上
           （此前硬编码 [data-row="ents"]，画像删掉手填后那行就不存在了）。 */
        var row0 = root.querySelector('[data-row="' + ((def.validateField || '') || '') + '"]')
          || root.querySelector('[data-row="rules"]')
          || root.querySelector('.v15-cf-row');
        if (row0) row0.classList.add('cf-err');
        h.toast(msg, 'bad');
        return;
      }
    }
    h.state.newObjs = h.state.newObjs || {};
    var list = h.state.newObjs[capId] = h.state.newObjs[capId] || [];
    var o = { id: 'new-' + capId + '-' + (list.length + 1), cap: capId, name: v.name || v.title, at: '刚刚' };
    Object.keys(v).forEach(function (k) { o[k] = v[k]; });
    if (typeof def.build === 'function') def.build(v, o);
    list.unshift(o);
    if (global.V10UI) global.V10UI.closeSheet();
    h.toast('演示环境：已创建「' + (o.name || '') + '」（' + (def.stateLabel || '草稿态') + '，仅存于本会话）', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['new-obj-revoke'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var list = (h.state.newObjs || {})[p[0]] || [];
    h.state.newObjs[p[0]] = list.filter(function (o) { return o.id !== p[1]; });
    h.toast('已撤销创建（仅影响本会话）', 'info');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['new-obj-open'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var c = h.capById(p[0]);
    /* 有些创建表单挂在"子对象"上（新建分群 / 新建处置规则），它们没有独立的 cap —— 那就留在当前页，
       只把 agentId 换成新对象 id，由 app.js 的分发统一走 newObjDetail。 */
    h.navigate({
      domain: c ? c.domain : h.state.domain,
      cap: c ? c.id : h.state.cap,
      agentId: p[1], tab: null, traceId: null
    });
  };
  /* 会话内新建对象的统一详情页：只读展示已填信息 + 「还差什么才能发布」 + 补全/发布/撤销。
     不碰任何既有详情渲染器（既有渲染器按 id 从数据里取行，取不到会显示「对象不存在」）。 */
  RENDERERS.newObjDetail = function (cap, state, h) {
    var found = global.V15 && global.V15.isNew ? global.V15.isNew(state) : null;
    if (!found) return h.detailMissing(cap, state, h);
    var o = found.obj;
    var def = V15_CREATE[o.cap] || {};
    var LABEL = {
      seg: '目标分群', channel: '触达渠道', copy: '开场文案', rate: '灰度比例', owner: '归属 Agent',
      scope: '覆盖范围', rules: '规则条目', threshold: '误报阈值',
      type: '单据类型', targetId: '关联对象', affect: '影响对象数', rollback: '是否可回滚', reason: '变更说明',
      model: '主模型', biz: '业务线', level: '隔离等级',
      listSource: '名单来源', delivery: '交付方式', channel: '触达渠道', quietHours: '免打扰时段', freq: '频控上限'
    };
    var OPT = { sms: '短信', push: 'Push', inapp: '站内信', im: 'IM', wecom: '企微', dispatch: 'AI 派发', selfserve: '自助入口' };
    var kv;
    if (o.cap === 'agent-wb') {
      kv = [['主模型', o.modelName], ['业务线', o.bizName],
        ['知识库', (o.kbNames || []).length ? o.kbNames.join('、') : '未关联'],
        ['工具', (o.toolNames || []).length ? o.toolNames.join('、') : '未关联'],
        ['隔离等级', o.level || '—']];
    } else {
      kv = [];
      (def.fields || []).forEach(function (f) {
        var v = o[f.k];
        if (v == null || v === '') return;
        if (Array.isArray(v)) v = v.length ? v.map(function (x) { return OPT[x] || x; }).join('、') : '未选';
        if (f.k === 'seg' && o.segName) v = o.segName + '（覆盖 ' + o.segCover + ' 人）';
        if (f.k === 'rules') v = v + ' 条';
        kv.push([LABEL[f.k] || f.k, String(v)]);
      });
    }
    var todo = typeof def.todo === 'function' ? def.todo(o) : ['未提交后续流程'];
    var NEXT = { 'agent-wb': '发布', 'user-ops': '开始投放', 'compliance': '转全量', 'approval': '已生效' };
    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + ' / 新建对象 · ' + h.esc(o.name) + '</div>' +
      '<div class="ph-desc">本会话新建，未落库 · 刷新后还原</div>' +
      '</div><div class="ph-side"><button class="btn-ghost" data-v10-back="1">← 返回列表</button></div></div>' +
      '<div class="card"><div class="card-h"><h3>已填信息</h3><span class="card-sub">本会话新建，刷新后还原</span></div>' +
      '<dl class="dl">' + kv.map(function (r) { return '<dt>' + h.esc(r[0]) + '</dt><dd>' + h.esc(r[1]) + '</dd>'; }).join('') + '</dl></div>' +
      ((o.cap === 'knowledge' && global.KB_SESSION && global.KB_SESSION.draftCard)
        ? global.KB_SESSION.draftCard(h, o)
        : ('<div class="card"><div class="card-h"><h3>还差什么才能生效</h3></div>' +
          '<ul class="check-list">' + todo.map(function (t) { return '<li class="warn">· ' + h.esc(t) + '</li>'; }).join('') + '</ul>' +
          '<div class="gray-acts">' +
          '<button class="btn-ghost" data-act="goto-cap" data-id="' + h.esc(cap.id) + '">去补全</button>' +
          '<button class="btn-primary" data-act="new-obj-advance" data-id="' + h.esc(o.cap) + '">' + h.esc(NEXT[o.cap] || '下一步') + '</button>' +
          '<button class="btn-danger sm" data-act="new-obj-revoke" data-id="' + h.esc(cap.id) + '|' + h.esc(o.id) + '">撤销创建</button>' +
          '</div></div>')) +
      h.metaBar({}, [{ k: '数据性质', v: '新建对象的字段为本会话输入，未写入任何数据源' }]);
  };
  /* v15：置灰按钮也要能点 —— 点了如实说明"为什么不可点"，而不是毫无反应（B-15）。 */
  ACTIONS['blocked-why'] = function (id, btn, h) {
    h.toast(id || '该操作当前不可执行', 'info');
  };
  /* v15：导出是只读操作，不该被当成写操作挡掉（C-06）。这里真的生成一份 CSV 下载。 */
  ACTIONS['export-report'] = function (id, btn, h) {
    var cb = Q.costBreakdown(h.state.range);
    var fmt = h.fmt;
    var esc = function (v) { var t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var lines = [];
    lines.push('导出时间,数据区间,总成本(元),token 总量,重试浪费(元)');
    lines.push([new Date().toLocaleString('zh-CN'), Q.RANGES[h.state.range].label, cb.total.toFixed(2), Math.round(cb.tokens), cb.retryWaste.toFixed(2)].map(esc).join(','));
    lines.push('');
    lines.push('按业务线');
    lines.push('业务线,调用,成本(元),占比');
    (cb.byBiz || []).forEach(function (r) { lines.push([r.label, r.calls, r.cost.toFixed(2), (r.share * 100).toFixed(1) + '%'].map(esc).join(',')); });
    lines.push('');
    lines.push('按 Agent');
    lines.push('Agent,调用,成本(元),占比');
    (cb.byAgent || []).forEach(function (r) { lines.push([r.label, r.calls, r.cost.toFixed(2), (r.share * 100).toFixed(1) + '%'].map(esc).join(',')); });
    var csv = '\ufeff' + lines.join('\r\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '成本归因_' + h.state.range + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      h.toast('已生成 CSV（' + (cb.byBiz || []).length + ' 条业务线 / ' + (cb.byAgent || []).length + ' 个 Agent · 仅本机下载）', 'ok');
    } catch (e) {
      h.toast('浏览器阻止了下载，可右键页面复制数据代替', 'bad');
    }
  };
  /* v15：策略详情的落点 —— 此前策略卡只有 放量/终止/复盘 三个按钮，没有可进入的详情（C-11）。 */
  ACTIONS['uo-detail'] = function (id, btn, h) {
    var it = pipes().userops.items.filter(function (x) { return x.id === id; })[0];
    if (!it) { h.toast('策略不存在', 'bad'); return; }
    var fmt = h.fmt;
    var r = it.result;
    var kv = (it.stages || []).map(function (s) {
      return '<dt>' + h.esc(s.name) + '</dt><dd>' + h.esc(s.detail || '—') +
        (s.count == null ? '' : '　<b>' + fmt.int(s.count) + '</b>') + '</dd>';
    }).join('');
    var res = r ? '<dl class="dl">' +
      '<dt>实验组转化</dt><dd>' + fmt.pct2(r.convExp) + '（n = ' + fmt.int(r.sampleExp) + '）</dd>' +
      '<dt>对照 holdout</dt><dd>' + fmt.pct2(r.convCtrl) + '（n = ' + fmt.int(r.sampleCtrl) + '）</dd>' +
      '<dt>归因窗口</dt><dd>' + h.esc(r.window) + '</dd>' +
      '<dt>负向指标</dt><dd>退订率 ' + fmt.pct2(r.negative.unsubRate) + ' · 投诉率 ' + fmt.pct2(r.negative.complaintRate) + ' · 拉黑率 ' + fmt.pct2(r.negative.blockRate) + '</dd>' +
      '</dl>' : '<div class="bt-note">效果回收尚未开始。</div>';
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(it.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<div class="sub-h">四阶段明细</div><dl class="dl">' + kv + '</dl>' +
      '<div class="sub-h" style="margin-top:12px">效果回收</div>' + res +
      '</div></div></div>');
  };
  /* v15：网关密钥 轮换/吊销 —— 密钥是安全资产，不能点了没反应。 */
  /* v15：规则包「回测」—— 用该包的真实命中/误报数据给出回测结论，不再点了没反应。 */
  ACTIONS['rule-backtest'] = function (id, btn, h) {
    var PACKS = {
      'rp-law': { name: '敏感表述-广告法 v12', rules: 142, hit: 1284, falsePos: 0.018 },
      'rp-pii': { name: '数据出境校验 v3', rules: 38, hit: 96, falsePos: 0.004 },
      'rp-sample': { name: '输出内容抽样机制', rules: 1, hit: 3402, falsePos: 0 },
      'rp-law13': { name: '广告法新增表述规则 v13', rules: 24, hit: 61, falsePos: 0.032 }
    };
    var p = PACKS[id];
    if (!p) {
      var no = ((h.state.newObjs || {})['compliance'] || []).filter(function (x) { return x.id === id; })[0];
      if (!no) { h.toast('规则包不存在', 'bad'); return; }
      p = { name: no.name, rules: no.rules, hit: 0, falsePos: 0 };
    }
    var fmt = h.fmt;
    var pass = p.falsePos <= 0.02;
    h.dangerConfirm(h, {
      title: '规则包回测', desc: '对「' + p.name + '」跑一次历史样本回测？',
      tone: 'normal', perm: 'compliance:rulepack:backtest',
      impacts: [
        { label: '规则条数', value: p.rules + ' 条' },
        { label: '历史命中', value: fmt.int(p.hit) + ' 次' },
        { label: '当前误报率', value: fmt.pct1(p.falsePos) + '（阈值 2%）', tone: pass ? '' : 'danger' },
        { label: '回测结论', value: p.hit === 0 ? '尚无历史命中样本，回测结果不可用' : (pass ? '误报率达标，可转全量' : '误报率超标，不允许发布新规则') }
      ],
      confirmText: '开始回测',
      action: '规则包回测', target: id + ' · ' + p.name,
      onConfirm: function () {
        h.toast('回测完成：' + p.rules + ' 条规则 / ' + fmt.int(p.hit) + ' 次历史命中 / 误报率 ' + fmt.pct1(p.falsePos) + '（演示环境，未落库）', pass ? 'ok' : 'warn');
      }
    });
  };
  /* v15：规则包「引用方」—— 从合规队列里反查哪些 Agent 命中过该包（真实数据，不编）。 */
  ACTIONS['rule-refs'] = function (id, btn, h) {
    var NAME = { 'rp-law': '广告法', 'rp-pii': '数据出境', 'rp-sample': '抽样', 'rp-law13': '广告法' };
    var key = NAME[id] || '';
    var items = (queues().compliance.items || []);
    var hitAgents = [];
    items.forEach(function (it) {
      if (key && String(it.rule || '').indexOf(key) > -1 && hitAgents.indexOf(it.agentName) < 0) hitAgents.push(it.agentName);
    });
    var extra = ((h.state.newObjs || {})['compliance'] || []).filter(function (x) { return x.id === id; })[0];
    var body = hitAgents.length
      ? '<div class="sub-h">命中过该包的 Agent（来自待复核队列）</div><dl class="dl">' +
        hitAgents.map(function (n) { return '<dt>' + h.esc(n) + '</dt><dd>近期有命中记录，规则包变更会影响它</dd>'; }).join('') + '</dl>'
      : '<div class="bt-note">近期待复核队列里没有该包的命中记录 —— 可能命中量少，或命中都在自动处置范围内。</div>';
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>规则包引用方</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' + body +
      (extra ? '<div class="bt-note">本会话新建的规则包尚未产生命中记录。</div>' : '') +
      '</div></div></div>');
  };
  /* v15：网关「全局降级」—— 影响面最大的止血动作，必须先确认。 */
  ACTIONS['gw-degrade'] = function (id, btn, h) {
    var svc = (global.DATA_SEED.MCP_SERVICES || []);
    h.dangerConfirm(h, {
      title: '切全局降级模式', desc: '把全部 ' + svc.length + ' 个 MCP 服务切到降级模式？',
      tone: 'danger', perm: 'gateway:global:degrade',
      impacts: [
        { label: '影响服务', value: svc.map(function (x) { return x.name; }).join('、') },
        { label: '影响', value: '全部走 fallback 链，功能降级但调用不中断' },
        { label: '可回滚', value: '是 —— 可随时恢复' }
      ],
      confirmText: '确认降级',
      action: '切全局降级模式', target: '全部 MCP 服务',
      onConfirm: function () {
        h.toast('演示环境：已切全局降级（仅本会话，不执行真实变更）', 'ok');
      }
    });
  };
  /* v15：成本优化建议「落地」—— 建议要能真的转成审批单。 */
  ACTIONS['cost-apr'] = function (id, btn, h) {
    var cb = Q.costBreakdown(h.state.range);
    var sg = (cb.suggestions || []).filter(function (x) { return x.id === id; })[0];
    if (!sg) { h.toast('建议不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '落地', desc: '把「' + sg.title + '」直接落到线上配置？',
      tone: sg.level === 'high' ? 'warn' : 'normal', perm: 'cost:suggestion:submit',
      impacts: [
        { label: '建议动作', value: String(sg.action).slice(0, 60) },
        { label: '预计收益', value: sg.saving ? '¥' + h.fmt.int(sg.saving) + ' / 期' : '不直接省钱，但影响可归因性' },
        { label: '为什么现在动', value: '改配置 / 调预算都会影响线上调用' },
        { label: '可回滚', value: '是 —— 落地后仍可回退' }
      ],
      confirmText: '确认落地',
      action: '落地成本优化', target: sg.title,
      onConfirm: function (reason) {
        h.state.costApr = h.state.costApr || {};
        h.state.costApr[sg.id] = true;
        /* 2026-10-21：审批下线，直接落地 */
        h.toast('已落地 · 「' + sg.title + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* v15：自进化「灰度对比」—— 跳到该 Agent 的版本与发布页看灰度数据。 */
  ACTIONS['evo-gray'] = function (id, btn, h) {
    if (!id) { h.toast('该任务未关联 Agent，无法查看灰度对比', 'info'); return; }
    h.navigate({ domain: 'platform', cap: 'agent-wb', agentId: id, tab: 'versions', traceId: null });
  };
  /* v15：认领（用户反馈 / badcase）—— 认领后认领人与状态都要变，不能点了没反应。 */
  ACTIONS['fb-claim'] = function (id, btn, h) {
    if (!id) { h.toast('该条目没有可认领的标识', 'bad'); return; }
    h.state.claims = h.state.claims || {};
    h.state.claims[id] = '我';
    h.toast('演示环境：已认领（仅本会话）—— 认领人变更会同步到列表', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['new-obj-advance'] = function (id, btn, h) {
    var LABEL = { 'agent-wb': '发布', 'user-ops': '开始投放', 'compliance': '转全量', 'approval': '已生效', 'knowledge': '继续补全' };
    /* v17 批 A：知识库的「下一步」= 补全闭环本身（上传文档 → 重建索引 → 发布），
       不再弹「后续流程」空 toast —— 修掉同屏「去补全」能走、「下一步」只会空话的一活一死。 */
    if (id === 'knowledge' && global.KB_SESSION && global.KB_SESSION.isPublic && ACTIONS['kb-draft-complete']) {
      var list = (h.state.newObjs || {})['knowledge'] || [];
      var o = list.filter(function (x) { return !global.KB_SESSION.isPublic(h, x.id); })[0] || list[0];
      if (o) { ACTIONS['kb-draft-complete'](o.id, btn, h); return; }
    }
    h.toast('下一步：' + (LABEL[id] || '后续流程') + '（演示环境不执行真实写操作）', 'info');
  };

  /* v15：把创建表单配置暴露出去 —— renderers.js 的 sessionNewBlock 要读 stateLabel 之类的展示信息 */
  global.V15_CREATE = V15_CREATE;

  /* v15：会话内新建对象的识别入口（app.js 的分发要用它判断走不走 newObjDetail）。     纯内存态、刷新即还原 —— 不落 sessionStorage，避免"演示跑第二遍点了没反应"。 */
  global.V15 = {
    isNew: function (state) {
      var oid = state && state.agentId;
      if (!oid) return null;
      var all = (state && state.newObjs) || {};
      for (var k in all) {
        if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
        for (var i = 0; i < all[k].length; i++) if (all[k][i].id === oid) return { cap: k, obj: all[k][i] };
      }
      return null;
    }
  };

  /* v15：策略的「停」—— 走危险确认（影响面取自 stages 的真实数字）+ 会话内回收。
     这是全中台唯一会触达真人用户的链路，此前点「终止」只弹一句「已提交」，界面毫无变化。 */
  var UO_OPS = {
    stop:   { title: '终止投放',   state: 'terminated', confirm: '确认终止', tone: 'danger', verb: '终止', perm: 'userops:strategy:terminate' },
    pause:  { title: '暂停灰度',   state: 'paused',     confirm: '确认暂停', tone: 'warn',   verb: '暂停', perm: 'userops:strategy:pause' },
    submit: { title: '上线投放',   state: 'submitted',  confirm: '确认上线', tone: 'normal', verb: '上线', perm: 'userops:strategy:submit' },
    full:   { title: '转全量', state: 'full',       confirm: '确认转全量', tone: 'normal', verb: '转全量', perm: 'userops:strategy:requestFull' },
    review: { title: '发起复盘',   state: 'review',     confirm: '确认发起', tone: 'normal', verb: '复盘', perm: 'userops:strategy:review' }
  };
  ACTIONS['uo-stop'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var it = pipes().userops.items.filter(function (x) { return x.id === p[0]; })[0];
    if (!it) { h.toast('策略不存在', 'bad'); return; }
    var op = UO_OPS[p[1]] || UO_OPS.stop;
    var fmt = h.fmt;
    var reach = it.stages[2] || {};
    var tgt = it.stages[0] || {};
    var sent = reach.sent == null ? 0 : reach.sent;
    var stopsNow = op.state === 'terminated' || op.state === 'paused';
    var rw = (it.result || {}).window;
    var impacts = op.state === 'review' ? [
      { label: '复盘对象', value: it.name + '（已触达 ' + fmt.int(sent) + ' 人）' },
      { label: '归因口径', value: rw ? String(rw) : '尚未开启归因窗口' },
      { label: '复盘维度', value: '渠道 / 时段 / 人群分层 / 负向指标（退订·投诉·拉黑）' },
      { label: '可回滚', value: '是 —— 复盘只读，不改变投放状态', tone: '' }
    ] : [
      { label: '已触达用户', value: fmt.int(sent) + ' 人（已发出，短信/Push 无法收回）', tone: stopsNow && sent ? 'danger' : '' },
      { label: '本可触达规模', value: fmt.int(tgt.count == null ? 0 : tgt.count) + ' 人（圈人结果）' },
      { label: '对照 holdout', value: fmt.int(reach.holdout == null ? 0 : reach.holdout) + ' 人 —— 停止后将拿不到完整归因' },
      { label: '可回滚', value: stopsNow ? '否 —— 已发出的触达无法撤回' : '是 —— 未发出的部分可停止', tone: stopsNow ? 'danger' : '' }
    ];
    h.dangerConfirm(h, {
      title: op.title,
      desc: op.title + '「' + it.name + '」？',
      tone: op.tone,
      perm: op.perm,
      impacts: impacts,
      confirmText: op.confirm,
      action: op.title,
      target: it.id + ' · ' + it.name,
      onConfirm: function () {
        h.state.uoOps = h.state.uoOps || {};
        h.state.uoOps[it.id] = { action: op.state };
        h.toast('演示环境：' + op.title + '已记录到本会话（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['uo-undo'] = function (id, btn, h) {
    if (h.state.uoOps) delete h.state.uoOps[id];
    h.toast('已撤销本会话的演示状态', 'info');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['uo-scroll'] = function (id, btn, h) {
    var el = document.getElementById('uo-res-' + id);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* v15：Agent 的发布 / 灰度 / 回滚 —— 此前这 10 个按钮全是空动作，而这是 Agent 生命周期的核心。
     统一：危险确认（影响面取自 Q.kpi / Q.grayCompare 的真实数字）+ 会话内回收。
     会话内状态存在 state.agOps[agentId]（仅内存，刷新还原），与 uo-ratio 同法。 */
  function agPair(id) {
    var S2 = global.DATA_SEED, idx = S2.idx.agent[id];
    return idx == null ? null : { a: S2.AGENTS[idx], ai: idx };
  }
  function agRows(pair, h, mode) {
    var fmt = h.fmt, dr = global.FACTS.dailyRow(pair.ai, 0);
    var rows = [
      { label: '今日调用量', value: fmt.int(dr.calls) + ' 次' },
      { label: '当前成功率', value: fmt.pct2(dr.successRate) + (dr.successRate < 0.99 ? '（低于 99% 阈值）' : '') }
    ];
    var gc = pair.a.grayVersion ? Q.grayCompare(pair.a.id, h.state.range || '24h') : null;
    if (gc) {
      rows.push({ label: '灰度 vs 线上', value: '成功率 ' + fmt.pct2(gc.gray.successRate) + ' vs ' + fmt.pct2(gc.online.successRate) + ' · 样本 ' + fmt.int(gc.gray.calls) + ' / ' + fmt.int(gc.online.calls) });
      if (mode === 'full' && !gc.significance.significant) {
        rows.push({ label: '⚠ 统计显著性', value: '尚未达标（z = ' + gc.significance.z + '，p = ' + gc.significance.p + '）—— 按本页口径此时不应据此转全量', tone: 'danger' });
      }
    }
    rows.push({ label: mode === 'full' ? '转全量后影响' : '影响范围', value: mode === 'full' ? '该版本将承接 100% 流量（灰度期仅 ' + Math.round(pair.a.grayRatio * 100) + '%）' : '仅灰度份额内的调用（' + Math.round(pair.a.grayRatio * 100) + '%）' });
    rows.push({ label: '可回滚', value: '是 —— 上一版保留，可随时回退' });
    return rows;
  }
  /* v15：下线 Agent —— 兑现本页自己写下的承诺：
     「存在下游引用时点击下线会被强制拦截，需先通知引用方并二次确认，绝不允许静默下线。」
     此前这两个按钮都是空动作，承诺等于没写。 */
  ACTIONS['agent-notify-refs'] = function (id, btn, h) {
    var p = String(id).split('|'), n = Number(p[1] || 0), pair = agPair(p[0]);
    h.dangerConfirm(h, {
      title: '通知所有引用方', desc: '向 ' + n + ' 个下游引用方发送变更通知？',
      tone: 'normal', perm: 'agent:notifyRefs',
      impacts: [
        { label: '通知对象', value: n + ' 个引用方（子 Agent）' },
        { label: '通知内容', value: '变更内容 + 生效时间 + 回滚方式' },
        { label: '是否可撤回', value: '否 —— 通知发出后无法撤回', tone: 'warn' }
      ],
      confirmText: '确认通知', action: '通知所有引用方', target: pair ? pair.a.name : p[0],
      onConfirm: function () {
        h.state.agOps = h.state.agOps || {};
        h.state.agOps[p[0]] = Object.assign({}, h.state.agOps[p[0]], { notified: true });
        h.toast('演示环境：通知已记录到本会话（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['agent-retire'] = function (id, btn, h) {
    var p = String(id).split('|'), n = Number(p[1] || 0), pair = agPair(p[0]);
    var ov = (h.state.agOps && h.state.agOps[p[0]]) || {};
    if (n > 0 && ov.notified !== true) {
      h.toast('存在 ' + n + ' 个下游引用且尚未通知引用方 —— 按「下线保护」规则，需先通知再下线', 'bad');
      return;
    }
    var fmt = h.fmt, dr = global.FACTS.dailyRow(pair.ai, 0);
    h.dangerConfirm(h, {
      title: '下线 Agent', desc: '下线「' + pair.a.name + '」？',
      tone: 'danger', perm: 'agent:retire',
      impacts: [
        { label: '下游引用', value: n + ' 个' + (n > 0 ? '（已通知）' : '（无，可安全下线）') },
        { label: '今日调用', value: fmt.int(dr.calls) + ' 次将无服务承接' },
        { label: '历史数据', value: '保留，可查；不删除' },
        { label: '可回滚', value: '是 —— 可重新上线，但期间调用会失败', tone: 'warn' }
      ],
      confirmText: '确认下线',
      action: '下线 Agent', target: pair.a.id + ' · ' + pair.a.name,
      onConfirm: function () {
        h.state.agOps = h.state.agOps || {};
        h.state.agOps[p[0]] = Object.assign({}, h.state.agOps[p[0]], { retired: true });
        h.toast('演示环境：下线已记录到本会话（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  ACTIONS['agent-precheck'] = function (id, btn, h) {
    var el = document.getElementById('ag-checklist');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    h.toast('预检完成：0 阻断 / 2 警告（清单见下方，当前为示例数据）', 'info');
  };
  ACTIONS['agent-release'] = function (id, btn, h) {
    var pair = agPair(String(id).split('|')[0]);
    if (!pair) { h.toast('Agent 不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '发布上线', desc: '将草稿 ' + pair.a.online + '-draft 发布为线上版本？',
      tone: 'warn', perm: 'agent:publish',
      impacts: agRows(pair, h, 'publish'),
      confirmText: '确认发布',
      action: '发布上线', target: pair.a.id + ' · ' + pair.a.name,
      onConfirm: function () {
        h.state.agOps = h.state.agOps || {};
        h.state.agOps[pair.a.id] = Object.assign({}, h.state.agOps[pair.a.id], { released: true });
        h.toast('已发布上线（本会话演示，不执行真实写操作）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['agent-gray'] = function (id, btn, h) {
    var p = String(id).split('|'), pair = agPair(p[0]);
    if (!pair) { h.toast('Agent 不存在', 'bad'); return; }
    var op = p[1] || 'up';
    var cur = (h.state.agOps && h.state.agOps[pair.a.id] && h.state.agOps[pair.a.id].ratio != null)
      ? h.state.agOps[pair.a.id].ratio : pair.a.grayRatio;
    var map = {
      up: { title: '调高灰度比例', next: Math.min(1, Math.round((cur + 0.1) * 100) / 100), tone: 'warn', reason: false },
      down: { title: '调低灰度比例', next: Math.max(0, Math.round((cur - 0.1) * 100) / 100), tone: 'warn', reason: false },
      pause: { title: '暂停灰度', next: cur, tone: 'warn', reason: true },
      rollback: { title: '立即回滚', next: 0, tone: 'danger', reason: true },
      full: { title: '全量发布', next: 1, tone: 'danger', reason: true }
    };
    var op2 = map[op] || map.up;
    /* ⚠ 权限点必须**用登记表里真实存在的名字**（2026-10-12 修）：
       原写法是 `perm: 'agent:gray:' + op`，展开成 agent:gray:up/down/pause/full ——
       而 seed.js:545-547 只登记了 `agent:gray:promote`（灰度转全量）与 `agent:gray:rollback`（灰度回滚），
       于是放量 / 暂停 / 转全量 / 回退**四个按钮全被门禁拦死**，且因权限点未登记，
       风险等级回落"低" ——「全量发布」被当成低风险操作，警示一起失效。
       现在按语义映射到已登记的两个点：调比例/暂停/转全量 → promote（都是"推进灰度"），回退 → rollback。 */
    var PERM_OF = {
      up: 'agent:gray:promote', down: 'agent:gray:promote', pause: 'agent:gray:promote',
      full: 'agent:gray:promote', rollback: 'agent:gray:rollback'
    };
    var rows = agRows(pair, h, op);
    rows.unshift({ label: '灰度比例', value: Math.round(cur * 100) + '% → ' + (op === 'pause' ? '暂停（保持 ' + Math.round(cur * 100) + '%）' : Math.round(op2.next * 100) + '%'), tone: op === 'rollback' ? 'danger' : '' });
    h.dangerConfirm(h, {
      title: op2.title, desc: op2.title + '「' + pair.a.name + '」？',
      tone: op2.tone, perm: PERM_OF[op] || PERM_OF.up,
      impacts: rows,
      confirmText: '确认' + op2.title.replace('立即', '').replace('比例', ''),
      action: op2.title, target: pair.a.id + ' · ' + pair.a.name,
      onConfirm: function () {
        h.state.agOps = h.state.agOps || {};
        var o = h.state.agOps[pair.a.id] || {};
        if (op === 'pause') o.paused = !o.paused;
        else if (op === 'rollback') { o.ratio = 0; o.paused = false; o.rollbackTo = pair.a.online; }
        else if (op === 'full') { o.ratio = 1; o.paused = false; }
        else { o.ratio = op2.next; o.paused = false; }
        h.state.agOps[pair.a.id] = o;
        h.toast('演示环境：' + op2.title + '已记录到本会话（不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['agent-rollback'] = function (id, btn, h) {
    var p = String(id).split('|'), pair = agPair(p[0]);
    if (!pair) { h.toast('Agent 不存在', 'bad'); return; }
    var to = p[1];
    var rows = agRows(pair, h, 'rollback');
    rows.unshift({ label: '版本回退', value: pair.a.online + ' → ' + to, tone: 'danger' });
    h.dangerConfirm(h, {
      title: '回滚版本', desc: '把线上版本从 ' + pair.a.online + ' 回滚到 ' + to + '？',
      tone: 'danger', perm: 'agent:gray:rollback',
      impacts: rows, confirmText: '确认回滚',
      action: '回滚版本', target: pair.a.id + ' · ' + to,
      onConfirm: function () {
        h.state.agOps = h.state.agOps || {};
        h.state.agOps[pair.a.id] = Object.assign({}, h.state.agOps[pair.a.id], { rollbackTo: to, paused: false, ratio: 1 });
        h.toast('演示环境：已回滚到 ' + to + '（记录到本会话，不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* v20：灰度放量改为危险确认 —— 此前「+10% 放量」点了直接生效（改内存 + toast），
     而放量是增加真实触达人数的动作，比「暂停」更需要影响面确认：新增触达多少、依据什么前提。
     档位制：10% → 20% → 50% → 转全量；当前档位需观察满 1 小时才可进入下一档（演示环境按已满足处理，口径写进确认页）。 */
  ACTIONS['uo-ratio'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var it = pipes().userops.items.filter(function (x) { return x.id === p[0]; })[0];
    if (!it) { h.toast('策略不存在', 'bad'); return; }
    var target = Number(p[1]);
    var cur = (h.state.userops && h.state.userops[it.id] != null) ? h.state.userops[it.id] : ((it.stages[2] && it.stages[2].grayRatio != null) ? it.stages[2].grayRatio : 0.1);
    if (!(target > cur)) { h.toast('当前灰度已是 ' + Math.round(cur * 100) + '%，请选择更高档位', 'warn'); return; }
    var fmt = h.fmt;
    var tg = it.stages[0] || {};
    var ex = tg.excluded || { freq: 0, unsub: 0, blacklist: 0, inOther: 0 };
    var net = (tg.count || 0) - (ex.freq + ex.unsub + ex.blacklist + ex.inOther);
    var add = Math.round(net * (target - cur));
    var acc = Math.round(net * target);
    var hold = (it.stages[2] && it.stages[2].holdout) || 0;
    h.dangerConfirm(h, {
      title: '灰度放量',
      desc: '「' + it.name + '」灰度 ' + Math.round(cur * 100) + '% → ' + Math.round(target * 100) + '%？',
      tone: 'warn',
      perm: 'userops:strategy:scale',
      impacts: [
        { label: '灰度比例', value: Math.round(cur * 100) + '% → ' + Math.round(target * 100) + '%（档位制：10 → 20 → 50 → 转全量）', tone: 'warn' },
        { label: '新增触达', value: fmt.int(add) + ' 人（净人群 ' + fmt.int(net) + ' × 新增 ' + Math.round((target - cur) * 100) + 'pp）', tone: 'danger' },
        { label: '累计实验组', value: fmt.int(acc) + ' 人（对照 holdout ' + fmt.int(hold) + ' 人不变）' },
        { label: '前置条件', value: '当前档位已观察满 1 小时且无熔断（退订/投诉/拉黑未超告警线）—— 演示环境按已满足处理' },
        { label: '可回滚', value: '是 —— 可暂停灰度止血，已发出的触达无法撤回' }
      ],
      confirmText: '确认放量',
      action: '灰度放量',
      target: it.id + ' · ' + it.name,
      onConfirm: function () {
        h.state.userops = h.state.userops || {};
        h.state.userops[it.id] = target;
        h.toast('演示环境：灰度已调至 ' + Math.round(target * 100) + '%（记录到本会话，不执行真实写操作）', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* SECTION: actions */
  ACTIONS['goto-cap'] = function (id, btn, h) {
    /* v33b：原来各自占一个侧栏项的两页已并入「能力与权限」，老链接不能撞进"页面还在但不该到这儿"。
       映射在**动作这一处**收口：站点里 3 处 data-id="gateway|sandbox" 的旧引用无需再改。 */
    var MERGE = {
      gateway: { cap: 'assets', at: 'mcp', as: 'health' },
      sandbox: { cap: 'assets', at: 'sandbox', as: 'detail' }
    }[id];
    if (MERGE && h.capById(MERGE.cap)) {
      h.state.assetTab = MERGE.at;
      h.state.assetSub = MERGE.as;
      h.navigate({ domain: 'platform', cap: MERGE.cap, agentId: null, tab: null, traceId: null, page: 1, filters: {} });
      return;
    }
    var c = h.capById(id);
    h.navigate({ domain: c.domain, cap: c.id, agentId: null, tab: null, traceId: null, page: 1, filters: {} });
  };
  ACTIONS['goto-agent'] = function (id, btn, h) {
    h.navigate({ domain: 'platform', cap: 'agent-wb', agentId: id, tab: 'session', traceId: null, page: 1 });
  };
  /* 2026-10-18：「管理」四页合成一页后，这三类旧页签名不再存在 ——
     orchestrate / versions / deps 都会落到 agentDetail 的 AGENT_TAB_RENDER[tab]（未注册 ⇒ 空页）。
     全站 3 处「看节点配置 →」和 8 处「看发布前检查清单 →」都用这个动作，所以在**这一处**做映射，
     而不是去改十几处调用点（改调用点必然漏掉一个）。映射后顺带滚到对应分节，落点才对得上。 */
  var LEGACY_AGTAB = { orchestrate: '02', versions: '03', deps: '04', perm: '04' };
  ACTIONS['goto-agent-tab'] = function (id, btn, h) {
    var p = String(id).split('|');
    var tab = p[1];
    if (LEGACY_AGTAB[tab]) {
      var no = LEGACY_AGTAB[tab];
      h.navigate({ domain: 'platform', cap: 'agent-wb', agentId: p[0], tab: 'manage', traceId: null });
      global.setTimeout(function () {
        var el = global.document && global.document.getElementById('am-sec-' + no);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    h.navigate({ domain: 'platform', cap: 'agent-wb', agentId: p[0], tab: tab, traceId: null });
  };
  /* v15：网关列表 → 详情入口（此前列表页对详情 0 入口，6 个 Tab 只能手输 URL）。
     id 形如「{svcId}|{tab}」。注册在本文件（列表页所在文件）而不是 v10-detail-flow.js：
     前者是测试装配层会加载的文件，且这是「列表的入口动作」，就近更合理；
     tab 合法性由详情渲染器自己兜底（非法 tab 回落配置页）。 */
  ACTIONS['gw-open'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    if (!p[0]) { h.toast('未找到该网关服务', 'bad'); return; }
    h.navigate({ domain: 'platform', cap: 'gateway', agentId: p[0], tab: p[1] || 'config', traceId: null });
  };

  /* v15：Agent 运行监控的「最近调用」只有 8 条、无法翻页/筛选 —— 补一个直达可观测页的出口，
     并把当前 Agent 作为检索条件带过去（与 filter-trace 同法：写 state.filters 再跳转）。 */
  ACTIONS['agent-traces'] = function (id, btn, h) {
    h.state.filters = Object.assign({}, h.state.filters, { agentId: id });
    h.state.page = 1;
    h.navigate({ domain: 'platform', cap: 'obs', tab: 'trace', agentId: null, traceId: null });
  };

  ACTIONS['goto-tab'] = function (id, btn, h) {
    var c = h.capById(id);
    h.navigate({ domain: c.domain, cap: c.id, agentId: null, tab: null, traceId: null, page: 1 });
  };
  ACTIONS['goto-trace'] = function (id, btn, h) {
    h.navigate({ domain: 'platform', cap: 'obs', agentId: null, tab: null, traceId: id });
  };
  ACTIONS['agent-view'] = function (id, btn, h) {
    h.state.agentView = id;
    // 走统一渲染路径，确保内容区事件重新绑定（手动改 DOM 会丢事件）
    h.navigate({});
  };
  ACTIONS['filter-trace'] = function (id, btn, h) {
    h.state.filters = Object.assign({}, h.state.filters, { errCode: id });
    h.state.page = 1;
    if (h.state.cap !== 'obs') h.navigate({ domain: 'platform', cap: 'obs', tab: 'trace' });
    else h.navigate({ tab: 'trace' });
  };
  ACTIONS['clear-filters'] = function (id, btn, h) {
    h.state.filters = {}; h.state.page = 1;
    h.navigate({});
  };
  ACTIONS['rm-filter'] = function (id, btn, h) {
    delete h.state.filters[id]; h.state.page = 1;
    h.navigate({});
  };
  ACTIONS['debug-pick'] = function (id, btn, h) {
    h.state.debugPick = id;
    var f = id === 'failed' ? { status: 'failed' } : (id === 'slow' ? { minLatency: 4000 } : { status: 'success' });
    var res = Q.searchTraces('24h', Object.assign({ agentId: h.state.agentId }, f), 1, 1);
    if (res.rows.length) {
      h.state.debugTraceId = res.rows[0].traceId;
      h.navigate({});
    } else {
      h.state.debugTraceId = null;
      h.navigate({});
      h.toast('近 24 小时没有符合条件的调用，试试扩大时间范围', 'warn');
    }
  };
  ACTIONS['debug-open'] = function (id, btn, h) {
    var inp = document.getElementById('debug-tid');
    var v = inp ? inp.value.trim() : '';
    if (!v) { h.toast('请先输入 traceId', 'warn'); return; }
    var t = F.getTrace(v);
    if (!t) { h.toast('traceId「' + v + '」不存在，请检查输入', 'bad'); return; }
    h.state.debugTraceId = v;
    h.navigate({});
    h.toast('已打开 ' + v, 'ok');
  };
  ACTIONS['show-incident'] = function (id, btn, h) {
    var inc = Q.incident(id);
    if (!inc) return;
    var imp = Q.incidentImpact(inc);
    var fmt = h.fmt;
    var html = '<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(inc.level) + ' · ' + h.esc(inc.title) + '</h3>' +
      '<button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>发生时间</dt><dd>' + h.esc(F.fmtDate(S.TODAY_START + inc.dayOffset * S.DAY)) + ' ' + inc.hourStart + ':00 – ' + inc.hourEnd + ':59</dd>' +
      '<dt>根因</dt><dd>' + h.esc(inc.rootCause) + '</dd>' +
      '<dt>处置动作</dt><dd>' + h.esc(inc.action) + '</dd>' +
      '<dt>处理人</dt><dd>' + h.esc(Q.ownerName(inc.resolvedBy)) + '</dd>' +
      '<dt>状态</dt><dd><span class="pill ok">已恢复</span></dd>' +
      '</dl>' +
      '<div class="sub-h">影响量化（事故期间 vs 同日其他时段，全平台）</div>' +
      '<table class="bt"><thead><tr><th>指标</th><th class="ta-r">事故期间</th><th class="ta-r">非事故时段</th><th class="ta-r">差异</th></tr></thead><tbody>' +
      '<tr><td>调用量</td><td class="ta-r">' + fmt.int(imp.during.calls) + '</td><td class="ta-r">' + fmt.int(imp.before.calls) + '</td><td class="ta-r muted">—</td></tr>' +
      '<tr><td>成功率</td><td class="ta-r bad">' + fmt.pct2(imp.during.successRate) + '</td><td class="ta-r">' + fmt.pct2(imp.before.successRate) + '</td><td class="ta-r bad">' + ((imp.during.successRate - imp.before.successRate) * 100).toFixed(2) + 'pp</td></tr>' +
      '<tr><td>P99 时延</td><td class="ta-r bad">' + fmt.dur(imp.during.p99) + '</td><td class="ta-r">' + fmt.dur(imp.before.p99) + '</td><td class="ta-r bad">+' + fmt.dur(imp.during.p99 - imp.before.p99) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="bt-warn">⚠ 排查基线性能问题时应剔除该时段数据，否则会把事故期的异常误判为常态。</div>' +
      '</div></div></div>';
    openModal(html);
  };
  ACTIONS['close-modal'] = function (id, btn, h) {
    var m = document.querySelector('.modal-mask');
    if (m) m.remove();
  };
  ACTIONS['kb-test'] = function (id, btn, h) {
    var q = (document.getElementById('kb-q') || {}).value || '';
    var kbId = (document.getElementById('kb-pick') || {}).value;
    var kk = Number((document.getElementById('kb-k') || {}).value || 5);
    var th = Number((document.getElementById('kb-th') || {}).value || 0.72);
    var kb = assets().kb.rows.filter(function (x) { return x.id === kbId; })[0];
    var box = document.getElementById('kb-result');
    if (!box) return;
    if (!q.trim()) { box.innerHTML = '<div class="empty"><div class="empty-title">请输入测试 query</div></div>'; return; }
    var r = S.R.of('kbtest|' + kbId + '|' + q + '|' + kk + '|' + th);
    var docs = ['退换货政策 v3 §2.1', '售后服务条款 §4', '七天无理由退货细则', '质量问题举证清单', '退换货流程 FAQ'];
    var rows = [];
    for (var i = 0; i < kk; i++) {
      var score = Math.max(0.31, 0.94 - i * 0.09 - r() * 0.05);
      rows.push({ doc: docs[i % docs.length], score: score, pass: score >= th });
    }
    box.innerHTML = '<div class="sub-h">检索结果 · ' + h.esc(kb.name) + ' · top_k=' + kk + ' · 阈值=' + th.toFixed(2) + '</div>' +
      '<table class="bt"><thead><tr><th>#</th><th>命中切片</th><th class="ta-r">相似度</th><th>是否过阈值</th><th>操作</th></tr></thead><tbody>' +
      rows.map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + h.esc(x.doc) + '</td>' +
          '<td class="ta-r mono ' + (x.pass ? 'ok' : 'bad') + '">' + x.score.toFixed(3) + '</td>' +
          '<td>' + (x.pass ? '<span class="pill ok">命中</span>' : '<span class="pill bad">低于阈值</span>') + '</td>' +
          /* 撤回「原文」按钮：kb-test 的命中切片名是**演示用的固定文本**，不是知识库里的真实文档，
             按「知识库|文档 id」去 kb-doc-open 只会得到「文档不存在」—— 那等于把一个假入口包成真入口。
             要接的话得先让检索测试接真实检索服务（返回真实的文档 id + 切片序号 + 偏移量）。 */
          '<td><span class="muted">原文（需真实检索服务）</span></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="bt-note">过阈值 ' + rows.filter(function (x) { return x.pass; }).length + ' / ' + kk + ' 条。' +
      (rows.filter(function (x) { return x.pass; }).length === 0
        ? '⚠ 全部低于阈值 —— Agent 会走兜底话术。这正是「Agent 答不出」的根因，应补文档或调低阈值。'
        : '若 Agent 仍答错，问题在生成环节而非检索环节，可对比不同 top_k / 阈值 / 切片策略的输出。') +
      '<br>命中切片名是演示用的固定文本，不对应知识库里的真实文档 —— 因此「查看原文段落」需要真实检索服务（返回文档 id + 切片序号 + 偏移量），本稿未提供入口。</div>';
    h.toast('检索完成：' + rows.filter(function (x) { return x.pass; }).length + '/' + kk + ' 命中', 'ok');
  };
  /* ============================================================ v31（Agent 丙）质量治理链路的动作
   * 背景：本文件原有 16 处把动作名写成笼统的 demo，而 demo 从来没注册过 ——
   * 点击只会弹「演示环境：该操作（demo）未接线」。一个笼统的动作名掩盖了 16 个**完全不同**的语义：
   * 复制 ID / 标记 badcase / 审阅 / 转测试用例 / 新建评估 / 看结果 / 对比版本 / 编辑告警规则 / 静默 /
   * 新建告警规则 / 据此新建策略 / 查看原文段落 …… 于是「评估 → 定位 → 处置」整条链路全堵死。
   * 现在按语义逐个拆分：
   *   · 接口层面已存在的机制 → 直接接上（create-open / goto-agent-tab）；
   *   · 需要后端能力、本稿确实没有的 → **把按钮撤回**，只留一句如实的 .bt-note，不留点了弹 toast 的假按钮；
   *   · 页面主操作且删掉会丢重点的 → 保留按钮 + 专属动作名，动作里写明**缺什么**。
   * 从此本文件不再注册笼统的 demo，也不再挂这个动作名（下面 12 个动作各管一件事，前缀 demo- 只表示「演示环境」。）
   * ============================================================ */

  /* badcase 队列按 id 取真实行；取不到就返回 null —— 宁可提示"不在当前队列"，也不编一份字段出来。 */
  function bcRowOf(id) {
    var all = (queues().badcase && queues().badcase.items) || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  /* 告警规则表（与 alertBlock 里的内置 5 条同一份数字；告警规则的编辑/静默要按 id 找到它） */
  var ALERT_RULES = [
    { id: 'al-1', metric: '成功率', cond: '< 99%', scope: '全部 Agent', window: '5 分钟', channel: '站内 + IM', oncall: '本人', status: 'ok', statusText: '已启用', triggered: 2 },
    { id: 'al-2', metric: 'P99 时延', cond: '> 4s', scope: '全部 Agent', window: '5 分钟', channel: '站内 + IM', oncall: '本人', status: 'ok', statusText: '已启用', triggered: 1 },
    { id: 'al-3', metric: '成本日环比', cond: '> +20%', scope: '按业务线', window: '每日 09:00', channel: '邮件', oncall: '本人', status: 'ok', statusText: '已启用', triggered: 3 },
    { id: 'al-4', metric: '调用量骤降', cond: '< 昨日同时段 50%', scope: '全部 Agent', window: '15 分钟', channel: '站内', oncall: '本人', status: 'warn', statusText: '已静默至明日', triggered: 0 },
    { id: 'al-5', metric: 'badcase 新增', cond: '> 10 条/小时', scope: '单 Agent', window: '1 小时', channel: '站内 + IM', oncall: '本人', status: 'ok', statusText: '已启用', triggered: 1 }
  ];
  function alertRuleOf(id) {
    for (var i = 0; i < ALERT_RULES.length; i++) if (ALERT_RULES[i].id === id) return ALERT_RULES[i];
    return null;
  }

  /* 失败原因 → 该在哪一层修（badcase 队列的 reason 只有 5 个取值，映射是确定的） */
  var BC_FIX = {
    '幻觉': '生成层：补知识依据 + 加引用约束（回答必须给出依据来源），并核对知识库该条目是否过期',
    '工具调用错': '编排层：核对工具入参 schema 与重试策略，该节点应幂等；必要时加参数校验前置',
    '理解偏差': '提示词层：补 few-shot 与意图澄清，多意图输入需先分拆再作答',
    '知识缺失': '知识层：补文档 / 重建索引；先看「检索测试」里该 query 的命中是否过阈值',
    '合规误杀': '规则层：核对拦截规则的误报率，超阈值应回滚上一版规则包'
  };

  /* 「复制 ID」——本仓对"复制"的诚实写法：**只提示、不写剪贴板**（同 v27 的 as-msg-copy）。
     这里比那句话多一点价值：把 ID 原文显示出来，用户能自己选中。 */
  ACTIONS['demo-copy-id'] = function (id, btn, h) {
    if (!id) { h.toast('没有可复制的标识', 'bad'); return; }
    h.toast('ID：' + id + '（原型只提示，不写剪贴板）', 'info');
  };

  /* 「标记 badcase / 转为 badcase」——会话内标记（state.traceBadcase），可再点一次取消。
     为什么不落到 badcase 队列：本稿没有"从 trace 建 badcase"的写后端，队列条目是从失败 trace 抽样生成的，
     凭空 push 一条会让「待认领」KPI 对不上。所以标记只用于**本会话内标注**，且如实说明。 */
  ACTIONS['demo-trace-badcase'] = function (id, btn, h) {
    var tid = String(id || '');
    if (!tid) { h.toast('缺少 traceId，无法标记', 'bad'); return; }
    h.state.traceBadcase = h.state.traceBadcase || {};
    var on = !h.state.traceBadcase[tid];
    if (on) h.state.traceBadcase[tid] = true; else delete h.state.traceBadcase[tid];
    h.toast(on
      ? '演示环境：已标记 ' + tid + ' 为 badcase（仅本会话，不会写入 badcase 队列）'
      : '已取消标记（' + tid + '）', 'info');
    h.navigate({}, { scroll: false });
  };

  /* 「审阅 badcase」——把这条 badcase 的**全部已有字段**摊开（不编新字段），
     并给出该失败原因对应的修复层；处置动作只有两个，都是会话内可验证的：
       · 认领 → 复用既有 fb-claim（同一份 state.claims，列表里的「认领人」列会跟着变）
       · 标记已审 → state.bcReview，列表里该行操作列显示「已审阅」 */
  ACTIONS['demo-badcase-review'] = function (id, btn, h) {
    var r = bcRowOf(String(id || ''));
    if (!r) { h.toast('该 badcase 不在当前队列里（可能已关闭）', 'bad'); return; }
    var fmt = h.fmt;
    var claimed = (h.state.claims || {})[r.id];
    var reviewed = (h.state.bcReview || {})[r.id];
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>审阅 badcase · ' + h.esc(r.id) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>级别</dt><dd>' + h.pill(r.levelKind, r.level) + '</dd>' +
      '<dt>所属 Agent</dt><dd><button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(r.agentName) + '</button></dd>' +
      '<dt>失败原因</dt><dd>' + h.esc(r.reason) + '</dd>' +
      '<dt>来源</dt><dd>' + h.esc(r.source) + '</dd>' +
      '<dt>等待时长</dt><dd class="' + (r.waitMin > 1440 ? 'bad' : '') + '">' + fmt.wait(r.waitMin) + '</dd>' +
      '<dt>认领人</dt><dd>' + h.esc(claimed || r.owner || '未认领') + '</dd>' +
      '<dt>状态</dt><dd>' + h.pill(r.status, r.statusText) + '</dd>' +
      '<dt>审阅</dt><dd>' + (reviewed ? '已审阅（本会话）' : '未审阅') + '</dd>' +
      '</dl>' +
      '<div class="sub-h">该从哪一层修</div>' +
      '<div class="bt-note">' + h.esc(BC_FIX[r.reason] || '按标准流程定位后回写处置结论。') + '</div>' +
      '<div class="bt-warn">⚠ 期望输出：' + h.esc(r.expectOutput || '') + '</div>' +
      '<div class="sub-h">可执行</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (claimed ? '<span class="bt-note" style="margin:0">已认领 · ' + h.esc(claimed) + '</span>'
        : '<button class="btn-primary" data-act="fb-claim" data-id="' + h.esc(r.id) + '">认领（我来处理）</button>') +
      (reviewed ? '<span class="bt-note" style="margin:0">已标记已审阅</span>'
        : '<button class="btn-ghost" data-act="demo-badcase-mark" data-id="' + h.esc(r.id) + '">标记已审阅</button>') +
      '</div>' +
      '<div class="bt-note">本稿没有 badcase 工单写后端：「修复并回归通过 / 确认不修复（填理由）」这两个真正的关闭动作做不了 —— ' +
      '认领与已审阅只记在本会话（刷新即还原），不会同步任何外部系统。</div>' +
      '</div></div></div>');
  };
  ACTIONS['demo-badcase-mark'] = function (id, btn, h) {
    var bid = String(id || '');
    if (!bid) return;
    h.state.bcReview = h.state.bcReview || {};
    h.state.bcReview[bid] = true;
    h.toast('演示环境：已标记审阅（仅本会话）—— 关闭 badcase 仍需修复回归或填写不修复理由', 'info');
    if (ACTIONS['close-modal']) ACTIONS['close-modal'](null, null, h);
    h.navigate({}, { scroll: false });
  };

  /* 「关联进化」——不新造入口：进化任务的真实创建链路就是 create-open（V15_CREATE['evo']）。
     这里只做预填（目标 Agent + badcase 来源），并如实说明 badcase 清单本身无法随表单提交。 */
  ACTIONS['demo-badcase-evo'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var agentId = p[0] || '', bcId = p[1] || '';
    if (agentId && ACTIONS['create-open']) {
      /* 预填数据必须先写进 state —— create-open 会把表单渲染出来，
         之后 demo-prefill 才有东西可填（顺序反了就等于没预填）。 */
      h.state.demoPrefill = { evo: { agent: agentId, src: '生产 badcase' } };
      ACTIONS['create-open']('evo', null, h);
      if (ACTIONS['demo-prefill']) ACTIONS['demo-prefill']('evo', null, h);
      h.toast('演示环境：已预填进化任务表单（目标 Agent + badcase 来源）—— 这条 badcase 本身不在表单字段里，'
        + '本稿没有"badcase 清单随任务提交"的接口', 'info');
      return;
    }
    h.toast('该条目未关联 Agent，无法发起进化任务', 'bad');
  };

  /* 表单预填：create-open 的表单字段定义（V15_CREATE）是**共用**的，为了预填去改它会让每张表单都漂移；
     所以预填在表单打开之后对 DOM 做一次，并就地补一句影响面说明（不调 cfImpact —— 它是后定义的函数声明，
     语法上会被提升，但为了不依赖定义顺序，这里只填值 + 写一行文案）。 */
  ACTIONS['demo-prefill'] = function (capId, btn, h) {
    var pre = ((h.state.demoPrefill || {})[capId]) || null;
    if (!pre) return;
    var root = document.querySelector('.v10-sheet');
    if (!root) return;
    var filled = [];
    Object.keys(pre).forEach(function (k) {
      var el = root.querySelector('[data-cf="' + k + '"]');
      if (!el) return;
      if (el.tagName === 'SELECT') { el.value = pre[k]; filled.push(k); return; }
      if (el.querySelectorAll) {
        var btns = el.querySelectorAll('button');
        Array.prototype.forEach.call(btns, function (b) {
          var on = b.getAttribute('data-pick') === pre[k];
          if (on) b.classList.add('on'); else b.classList.remove('on');
        });
        filled.push(k);
      }
    });
    if (!filled.length) return;
    var box = root.querySelector('#cf-impact');
    if (box) box.insertAdjacentHTML('afterbegin',
      '<div class="bt-note">已按来源预填：' + h.esc(filled.join('、')) + '（改这里会同步更新上面的影响面预览）</div>');
  };

  /* 「结果」——评估任务的逐维度得分。tasks 是**本函数所在的真实数据**（同一个渲染闭包里的常量），
     所以这里按同一份数字展开，不新编指标。 */
  var EVAL_DIMS = [
    { k: 'accuracy', label: '准确性' }, { k: 'complete', label: '完整性' },
    { k: 'safe', label: '安全性' }, { k: 'format', label: '格式合规' }
  ];
  function evalTaskOf(id, h) {
    var ALL = [
      { id: 'ev-156', name: '周度回归评估 #156', target: '客服助手 Agent v2.3', set: '内置回归集', n: 1200, score: 88.4, by: '—', at: -1, statusText: '已完成', dims: { accuracy: 0.884, complete: 0.912, safe: 0.961, format: 0.938 } },
      { id: 'ev-155', name: '幻觉检测专项', target: '知识问答 Agent v5.2', set: '幻觉测试集', n: 340, score: 76.2, by: '—', at: 0, statusText: '进行中 812/1500', dims: { accuracy: 0.762, complete: 0.801, safe: 0.884, format: 0.902 } },
      { id: 'ev-154', name: '模型降级可行性评估', target: '文档摘要 Agent', set: '内置回归集', n: 800, score: 91.2, by: '—', at: -3, statusText: '已完成', dims: { accuracy: 0.912, complete: 0.897, safe: 0.955, format: 0.944 } },
      { id: 'ev-153', name: 'v2.4 灰度前评估', target: '客服助手 Agent v2.4-draft', set: '回归集 + badcase', n: 1414, score: 94.8, by: '—', at: -4, statusText: '已完成', dims: { accuracy: 0.921, complete: 0.934, safe: 0.972, format: 0.951 } }
    ];
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i];
    /* 本会话通过「发起评估」新建的任务也在列表里（state.newObjs.obs），这里同样给结果视图 */
    var mine = ((h.state.newObjs || {})['obs'] || []).filter(function (x) { return x.id === id; })[0];
    if (!mine) return null;
    return { id: mine.id, name: mine.name, target: mine.agentName || mine.name, set: mine.dataset || '—',
      n: null, score: null, by: '我', at: 0, statusText: '草稿态 · 未运行', dims: null };
  }
  ACTIONS['demo-eval-result'] = function (id, btn, h) {
    var t = evalTaskOf(String(id || ''), h);
    if (!t) { h.toast('评估任务不存在', 'bad'); return; }
    var fmt = h.fmt;
    var body = t.dims
      ? '<div class="sub-h">逐维度得分（阈值 85）</div>' +
        EVAL_DIMS.map(function (d) {
          var v = t.dims[d.k];
          var pct = Math.round(v * 1000) / 10;
          return '<div class="dim-row"><span class="dim-name">' + d.label + '</span>' +
            '<span class="dim-vals"><b class="' + (pct < 85 ? 'bad' : 'ok') + '">' + pct.toFixed(1) + '</b></span>' +
            '<span class="dim-diff ' + (pct < 85 ? 'bad' : 'ok') + '">' + (pct < 85 ? '低于阈值' : '达标') + '</span></div>';
        }).join('') +
        '<div class="bt-note">总分 ' + fmt.num1(t.score) + ' 是四个维度的加权结果；某一维低于 85 就应定位到具体样本再重跑，'
          + '而不是只看总分。</div>'
      : '<div class="bt-note">这条任务是本会话新建的<b>草稿</b> —— 还没运行，因此没有维度得分（本稿不伪造分数）。</div>';
    openModal('<div class="modal-mask" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + h.esc(t.name) + '</h3><button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' +
      '<dl class="dl">' +
      '<dt>评估对象</dt><dd>' + h.esc(t.target) + '</dd>' +
      '<dt>数据集</dt><dd>' + h.esc(t.set) + '</dd>' +
      '<dt>样本数</dt><dd>' + (t.n == null ? '—' : fmt.int(t.n)) + '</dd>' +
      '<dt>总分</dt><dd>' + (t.score == null ? '—' : '<b class="' + (t.score < 85 ? 'bad' : 'ok') + '">' + fmt.num1(t.score) + '</b>') + '</dd>' +
      '<dt>发起人</dt><dd>' + h.esc(t.by) + '</dd>' +
      '<dt>状态</dt><dd>' + h.esc(t.statusText) + '</dd>' +
      '</dl>' + body +
      '<div class="bt-note">逐条样本的输入 / 基线输出 / 本次输出 diff 需要评估服务的明细接口，本稿只有汇总与维度分，没有样本级明细。</div>' +
      '</div></div></div>');
  };
  /* 「对比」——本稿唯一有真实对比数据的是 v2.3 vs v2.4 那一对（页面下方那张卡）。
     不伪造其他任务的对比结果：没有对比数据的任务如实说明，并把它带到有数据的那张卡。 */
  ACTIONS['demo-eval-compare'] = function (id, btn, h) {
    var t = evalTaskOf(String(id || ''), h);
    var hasCmp = t && t.id === 'ev-153';
    if (hasCmp) {
      h.toast('已定位到下方「版本对比：客服助手 Agent v2.3（基线） vs v2.4（草稿）」—— 本稿只有这一对真实对比数据', 'info');
    } else {
      h.toast((t ? t.name : '该任务') + ' 没有可对比的版本对：本稿只在「v2.4 灰度前评估」上备了基线与草稿的对比数据', 'info');
    }
    try {
      var el = document.getElementById('eval-cmp-card');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { }
  };

  /* 「编辑告警规则」——只开放本稿真有口径的三个字段（条件表达式 / 统计窗口 / 通知渠道）。
     指标本身与生效范围不可改：它们是这条规则的身份（改了就变成另一条规则，应走新建）。 */
  ACTIONS['demo-alert-edit'] = function (id, btn, h) {
    var A_ = alertRuleOf(id);
    if (!A_) { h.toast('告警规则不存在', 'bad'); return; }
    var o = (h.state.alertOps || {})[id] || {};
    h.state.demoAlertEditId = id;
    global.V10UI.openSheet({
      title: '编辑告警规则 · ' + A_.metric,
      bodyHtml: '<div class="bt-note" style="margin-bottom:12px">指标「' + h.esc(A_.metric) + '」与生效范围「' + h.esc(A_.scope) + '」不可改 —— 改了就成另一条规则，请走新建。</div>' +
        '<div class="v15-cf-row"><label>触发条件</label><div><input id="al-cond" value="' + escAttr(o.cond || A_.cond) + '" style="width:100%"></div></div>' +
        '<div class="v15-cf-row"><label>统计窗口</label><div><input id="al-window" value="' + escAttr(o.window || A_.window) + '" style="width:100%"></div></div>' +
        '<div class="v15-cf-row"><label>通知渠道</label><div><input id="al-channel" value="' + escAttr(o.channel || A_.channel) + '" style="width:100%"></div></div>' +
        '<div class="bt-note">保存只写入本会话（刷新即还原）；真实生效要规则引擎重新加载规则，本稿没有这条链路。</div>',
      footHtml: '<button class="btn-ghost" data-act="create-cancel">取消</button>' +
        '<button class="btn-primary" data-act="demo-alert-save">保存到本会话</button>'
    });
  };
  ACTIONS['demo-alert-save'] = function (id, btn, h) {
    var root = document.querySelector('.v10-sheet');
    if (!root) return;
    var g = function (k) { var e = root.querySelector('#al-' + k); return e ? String(e.value || '').trim() : ''; };
    var rid = h.state.demoAlertEditId || 'al-1';
    h.state.alertOps = h.state.alertOps || {};
    var o = h.state.alertOps[rid] = h.state.alertOps[rid] || {};
    o.cond = g('cond'); o.window = g('window'); o.channel = g('channel');
    if (global.V10UI) global.V10UI.closeSheet();
    h.toast('演示环境：规则已更新（仅本会话）—— 真实生效需规则引擎重新加载', 'info');
    h.navigate({}, { scroll: false });
  };
  /* 「静默 / 取消静默」——静默是本稿唯一真能表达出来的告警处置（页面上本来就有"静默期间仍记录但不通知"的口径）。
     静默走 dangerConfirm（不可逆性低但要问一句）；理由框已随审计删除。 */
  ACTIONS['demo-alert-silence'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var A_ = alertRuleOf(p[0]);
    if (!A_) { h.toast('告警规则不存在', 'bad'); return; }
    var on = p[1] !== 'off';
    if (!on) {
      h.state.alertOps = h.state.alertOps || {};
      h.state.alertOps[p[0]] = h.state.alertOps[p[0]] || {};
      h.state.alertOps[p[0]].silent = false;
      h.toast('演示环境：已取消静默，该规则恢复通知（仅本会话）', 'info');
      h.navigate({}, { scroll: false });
      return;
    }
    h.dangerConfirm(h, {
      title: '静默告警规则', desc: '静默「' + A_.metric + '」（' + A_.cond + '）？',
      tone: 'warn',
      /* 不挂 perm：本稿的权限体系里没有"告警静默"这个权限点，随便编一个会被门禁拦成「没有权限」，
         把一个正常操作变成误导。true 的门禁应在真实后端做（前端置灰只是体验）。 */
      impacts: [
        { label: '静默期间', value: '不再发送通知，但触发仍会记录 —— 漏报风险由值班承担', tone: 'danger' },
        { label: '生效范围', value: A_.scope },
        { label: '通知渠道', value: A_.channel },
        { label: '到期', value: '到期自动恢复；到期前可手动取消静默' }
      ],
      confirmText: '确认静默',
      action: '静默告警规则', target: p[0] + ' · ' + A_.metric,
      onConfirm: function () {
        h.state.alertOps = h.state.alertOps || {};
        h.state.alertOps[p[0]] = h.state.alertOps[p[0]] || {};
        h.state.alertOps[p[0]].silent = true;
        h.toast('演示环境：已静默（仅本会话）—— 不写规则引擎', 'info');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* 「据此新建策略」——从分群详情起一张 user-ops 策略草稿，目标分群预填。
     复用 create-open 的 user-ops 表单（不新造表单）；预填走 demo-prefill。 */
  ACTIONS['demo-new-strategy'] = function (id, btn, h) {
    var segId = String(id || '');
    var seg = (pipes().userops.segments || []).filter(function (s) { return s.id === segId; })[0];
    if (segId && ACTIONS['create-open']) {
      h.state.demoPrefill = { 'user-ops': { seg: segId } };
      ACTIONS['create-open']('user-ops', null, h);
      if (ACTIONS['demo-prefill']) ACTIONS['demo-prefill']('user-ops', null, h);
      h.toast('演示环境：已预选目标分群「' + ((seg && seg.name) || segId) + '」—— 策略为草稿态，上线通过后才开始投放', 'info');
      return;
    }
    h.toast('未找到该分群，无法新建策略', 'bad');
  };

global.RENDERERS = RENDERERS;
  global.ACTIONS = ACTIONS;
})(window);
