/* SECTION: facts-core
 * 事实数据层。
 *
 * 核心设计：所有指标都由明细聚合而来，而不是写死数字。
 *   小时桶 hourBucket()  ← 权威聚合单元（调用数、失败数、错误码分布、token、成本）
 *   日汇总 dailyRow()    ← 24 个小时桶求和
 *   区间查询 query.js    ← 日汇总再求和
 *   trace 明细 listTraces() / getTrace() ← 严格按所属桶的计数生成，逐条可追溯
 *
 * 三条硬约束（决定这份数据能否"当真数据用"）：
 *  1. 确定性：桶的内容由 hash(agentId, 日期, 小时) 派生，刷新页面数字不变。
 *  2. 可对账：某桶声明"42 次调用 / 3 次失败"，下钻必然得到 42 条 trace、其中恰好 3 条失败。
 *  3. 有生命周期与事故：Agent 有上线爬坡与下线衰减，窗口内植入 3 起事故与 4 次发布，
 *     曲线因此存在真实的突变点，而不是一条平滑噪声。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED;
  var R = S.R, AGENTS = S.AGENTS, MODELS = S.MODELS, DAY = S.DAY;
  var ERR = S.ERROR_CODES, INTENTS = S.INTENTS, SEGS = S.SEGMENTS, CALLERS = S.CALLER_TYPES;

  /* SECTION: topology
   * 每个 Agent 的节点拓扑。trace 的 span 树由此生成，
   * 因此"在火焰图里看到的节点"与"画布里的编排"是同一份定义。
   */
  var TOPO = {
    'qa-rag': [
      { id: 'start', name: '开始', kind: 'start', w: 0.03 },
      { id: 'intent', name: '意图识别', kind: 'llm', w: 0.10, model: 'qwen-turbo' },
      { id: 'retrieve', name: '知识检索', kind: 'tool', w: 0.14, mcp: 'mcp-kb-search' },
      { id: 'generate', name: 'LLM 生成', kind: 'llm', w: 0.60 },
      { id: 'compliance', name: '合规检查', kind: 'guard', w: 0.08 },
      { id: 'output', name: '输出', kind: 'end', w: 0.02 }
    ],
    'tool-heavy': [
      { id: 'start', name: '开始', kind: 'start', w: 0.02 },
      { id: 'intent', name: '意图识别', kind: 'llm', w: 0.08, model: 'qwen-turbo' },
      { id: 'crm', name: '查询客户', kind: 'tool', w: 0.16, mcp: 'mcp-crm-query' },
      { id: 'order', name: '查询订单', kind: 'tool', w: 0.22, mcp: 'mcp-order' },
      { id: 'generate', name: 'LLM 生成', kind: 'llm', w: 0.42 },
      { id: 'ticket', name: '创建工单', kind: 'tool', w: 0.06, mcp: 'mcp-ticket' },
      { id: 'output', name: '输出', kind: 'end', w: 0.02 }
    ],
    'doc-gen': [
      { id: 'start', name: '开始', kind: 'start', w: 0.02 },
      { id: 'parse', name: '文档解析', kind: 'tool', w: 0.24, mcp: 'mcp-doc-parse' },
      { id: 'outline', name: '大纲生成', kind: 'llm', w: 0.22 },
      { id: 'section', name: '章节撰写', kind: 'llm', w: 0.38 },
      { id: 'compliance', name: '合规检查', kind: 'guard', w: 0.10 },
      { id: 'output', name: '输出', kind: 'end', w: 0.02 }
    ],
    'score': [
      { id: 'start', name: '开始', kind: 'start', w: 0.04 },
      { id: 'feature', name: '特征抽取', kind: 'tool', w: 0.26, mcp: 'mcp-crm-query' },
      { id: 'scoring', name: '模型评分', kind: 'llm', w: 0.62 },
      { id: 'output', name: '输出', kind: 'end', w: 0.04 }
    ],
    'segment': [
      { id: 'start', name: '开始', kind: 'start', w: 0.05 },
      { id: 'parse', name: '条件解析', kind: 'llm', w: 0.34 },
      { id: 'estimate', name: '人群预估', kind: 'tool', w: 0.50, mcp: 'mcp-crm-query' },
      { id: 'output', name: '输出', kind: 'end', w: 0.05 }
    ],
    'contract': [
      { id: 'start', name: '开始', kind: 'start', w: 0.02 },
      { id: 'parse', name: '合同解析', kind: 'tool', w: 0.20, mcp: 'mcp-doc-parse' },
      { id: 'kb', name: '条款检索', kind: 'tool', w: 0.12, mcp: 'mcp-kb-search' },
      { id: 'risk', name: '风险识别', kind: 'llm', w: 0.44 },
      { id: 'advice', name: '修订建议', kind: 'llm', w: 0.16 },
      { id: 'output', name: '输出', kind: 'end', w: 0.02 }
    ]
  };
  var AGENT_TOPO = {
    'ag-cs-refund': 'tool-heavy', 'ag-cs-pre': 'qa-rag', 'ag-sales-bid': 'doc-gen',
    'ag-sales-lead': 'score', 'ag-legal-ctr': 'contract', 'ag-legal-comp': 'qa-rag',
    'ag-ops-copy': 'doc-gen', 'ag-ops-seg': 'segment', 'ag-kb-qa': 'qa-rag',
    'ag-kb-sum': 'doc-gen', 'ag-cs-qa': 'score', 'ag-new-onb': 'qa-rag', 'ag-legacy-faq': 'qa-rag'
  };
  /** 失败最可能发生在哪个节点（按类型权重），用于让 trace 的失败点分布合理 */
  var FAIL_AFFINITY = { tool: 0.46, llm: 0.34, guard: 0.14, start: 0.02, end: 0.04 };

  /* SECTION: lifecycle
   * 生命周期曲线：新 Agent 爬坡、老 Agent 缓降、下线归零。
   * 没有这条曲线，所有 Agent 的流量都会是一条水平线，一眼假。
   */
  function lifecycleFactor(a, dayOffset) {
    // dayOffset: 0=今天, -N=N天前。retiredAt 同为负数，表示"N 天前下线"。
    // dayOffset > retiredAt 意味着该日期在下线之后（更靠近今天）→ 无流量。
    // 早前写成 dayOffset < retiredAt，把下线前的正常历史日期全判成 0，
    // 结果是「已下线的 Agent 今天仍有流量、历史反而没数据」。
    if (a.retiredAt !== undefined && dayOffset > a.retiredAt) return 0;
    var age = dayOffset - a.publishedAt;   // 上线以来的天数（正数）
    if (age < 0) return 0;                                  // 尚未上线
    if (a.retiredAt !== undefined) {
      // 下线前 30 天流量迁移衰减
      var toRetire = a.retiredAt - dayOffset;
      if (toRetire < 30) return Math.max(0.05, toRetire / 30);
    }
    if (age < 21) return 0.18 + 0.82 * (age / 21);          // 爬坡期
    if (age > 150) return Math.max(0.72, 1 - (age - 150) * 0.0016); // 缓慢衰减
    return 1;
  }

  /* SECTION: incident-lookup */
  function incidentAt(dayOffset, hour) {
    for (var i = 0; i < S.INCIDENTS.length; i++) {
      var inc = S.INCIDENTS[i];
      if (inc.dayOffset === dayOffset && hour >= inc.hourStart && hour <= inc.hourEnd) return inc;
    }
    return null;
  }
  function deployAt(agentId, dayOffset, hour) {
    for (var i = 0; i < S.DEPLOYS.length; i++) {
      var d = S.DEPLOYS[i];
      if (d.agentId === agentId && d.dayOffset === dayOffset && d.hour === hour) return d;
    }
    return null;
  }

  /* SECTION: hour-bucket
   * 权威小时桶。所有上层聚合都来自这里。
   */
  var HOUR_CACHE = Object.create(null);
  var SAMPLES_PER_HOUR = 8;   // 每桶抽取的时延样本数，用于跨桶计算分位数

  function hourBucket(ai, dayOffset, hour) {
    var key = ai + '|' + dayOffset + '|' + hour;
    var hit = HOUR_CACHE[key];
    if (hit) return hit;

    var a = AGENTS[ai];
    var ts = S.TODAY_START + dayOffset * DAY + hour * 3600000;
    var empty = {
      ts: ts, dayOffset: dayOffset, hour: hour, agentIdx: ai,
      calls: 0, fails: 0, err: {}, ver: {}, model: {}, intent: {}, seg: {}, caller: {},
      tokIn: 0, tokOut: 0, cost: 0, lat: [], latMedian: 0, latSigma: 0,
      incident: null, deploy: null, gray: null
    };

    var life = lifecycleFactor(a, dayOffset);
    if (life <= 0 || ts > S.NOW_TS) { HOUR_CACHE[key] = empty; return empty; }

    var r = R.of('hb|' + a.id + '|' + dayOffset + '|' + hour);
    var dow = new Date(ts).getDay();
    var biz = S.BIZ_LINES[S.idx.biz[a.biz]];
    var curve = S.HOUR_CURVE[biz.peak] || S.HOUR_CURVE.workday;

    // 期望调用数 = 日基准 / 归一化日曲线 × 小时权重 × 星期系数 × 生命周期 × 噪声
    var dayWeightSum = 0, i;
    for (i = 0; i < 24; i++) dayWeightSum += curve[i];
    var expect = (a.dailyBase / dayWeightSum) * curve[hour] * S.weekdayFactor(biz.peak, dow) * life;
    // 泊松式抖动：用 gamma 近似，低流量时波动更明显（真实系统就是这样）
    var calls = Math.max(0, Math.round(expect * (0.72 + r() * 0.56)));
    if (calls === 0) { HOUR_CACHE[key] = empty; return empty; }

    var inc = incidentAt(dayOffset, hour);
    var dep = deployAt(a.id, dayOffset, hour);

    /* --- 版本切分：灰度期两个版本各自有独立表现 --- */
    var grayRatio = 0, grayVer = null;
    if (a.grayVersion && a.grayRatio > 0) {
      // 灰度从 dep 那天开始；之前全是线上版本
      var grayDeploy = null;
      for (i = 0; i < S.DEPLOYS.length; i++) {
        if (S.DEPLOYS[i].agentId === a.id && S.DEPLOYS[i].kind === 'gray') grayDeploy = S.DEPLOYS[i];
      }
      if (!grayDeploy || dayOffset >= grayDeploy.dayOffset) { grayRatio = a.grayRatio; grayVer = a.grayVersion; }
    }

    /* --- 错误率：基线 × Agent 固有偏差 × 事故放大 --- */
    var baseErr = 0.0085;                       // 全站基线失败率 0.85%
    var errRate = baseErr * a.errorBias;
    // 高峰时段略高（真实系统资源紧张）
    if (curve[hour] > 4) errRate *= 1.22;
    if (inc) errRate *= inc.affect.errorMul;
    // 灰度版本：新加了合规检查节点 → 合规拦截上升，但整体质量更好
    var grayErrRate = grayVer ? errRate * 0.78 : errRate;
    errRate = Math.min(errRate, 0.62);
    grayErrRate = Math.min(grayErrRate, 0.62);

    var onlineCalls = grayVer ? Math.round(calls * (1 - grayRatio)) : calls;
    var grayCalls = calls - onlineCalls;
    var onlineFails = Math.min(onlineCalls, Math.round(onlineCalls * errRate));
    var grayFails = Math.min(grayCalls, Math.round(grayCalls * grayErrRate));
    var fails = onlineFails + grayFails;

    /* --- 错误码分布 --- */
    var err = {}, pool = [];
    for (i = 0; i < ERR.length; i++) {
      var w = ERR[i].weight;
      if (inc && inc.affect.errorCodes.indexOf(ERR[i].id) >= 0) w *= 7;  // 事故期特定错误码激增
      pool.push({ e: ERR[i], w: w });
    }
    for (i = 0; i < fails; i++) {
      var picked = R.weighted(r, pool, function (x) { return x.w; }).e;
      err[picked.id] = (err[picked.id] || 0) + 1;
    }

    /* --- 时延：对数正态，中位数由 Agent 与模型决定；事故期整体右移 --- */
    var medModel = MODELS[S.idx.model[a.model]].baseLatency;
    var latMedian = medModel * a.latencyBias * (0.9 + r() * 0.2);
    if (curve[hour] > 4) latMedian *= 1.14;                 // 高峰期排队
    if (inc) latMedian *= inc.affect.latencyMul;
    // 灰度版本升级到更强的模型 → 更慢
    var grayLatMedian = grayVer ? latMedian * 1.34 : latMedian;
    var latSigma = 0.46;

    var lat = [], nS = Math.min(calls, SAMPLES_PER_HOUR);
    for (i = 0; i < nS; i++) {
      var isGraySample = grayVer && (i / nS) < grayRatio;
      lat.push(Math.round(R.logNormal(r, isGraySample ? grayLatMedian : latMedian, latSigma)));
    }
    lat.sort(function (x, y) { return x - y; });

    /* --- token 与成本：按意图与模型分布 --- */
    var model = {}, tokIn = 0, tokOut = 0, cost = 0;
    var intent = {}, seg = {}, caller = {};
    for (i = 0; i < calls; i++) {
      var it = R.weighted(r, INTENTS, function (x) { return x.weight; });
      var sg = R.weighted(r, SEGS, function (x) { return x.weight; });
      var ct = R.weighted(r, CALLERS, function (x) { return x.weight; });
      intent[it.id] = (intent[it.id] || 0) + 1;
      seg[sg.id] = (seg[sg.id] || 0) + 1;
      caller[ct.id] = (caller[ct.id] || 0) + 1;

      // 灰度流量走升级后的模型
      var useGray = grayVer && (i < grayCalls);
      var mid = useGray ? 'qwen-max' : a.model;
      if (mid === 'embed-v3') mid = 'qwen-plus';
      var m = MODELS[S.idx.model[mid]];
      var ti = Math.round(R.logNormal(r, 620, 0.5) * it.tokens);
      var to = Math.round(R.logNormal(r, 240, 0.62) * it.tokens * (it.id === 'doc-gen' ? 3.2 : 1));
      tokIn += ti; tokOut += to;
      var c = (ti / 1000) * m.inPer1k + (to / 1000) * m.outPer1k;
      cost += c;
      if (!model[mid]) model[mid] = { calls: 0, tokIn: 0, tokOut: 0, cost: 0, fails: 0 };
      model[mid].calls++; model[mid].tokIn += ti; model[mid].tokOut += to; model[mid].cost += c;
    }
    // 失败调用的成本按已消耗计入（真实计费如此），但标记出来便于成本页做浪费分析
    var retryWaste = 0;
    for (i = 0; i < fails; i++) {
      var ec = ERR[i % ERR.length];
      if (ec.retryable) retryWaste += (620 / 1000) * MODELS[S.idx.model[a.model]].inPer1k * 1.6;
    }

    var b = {
      ts: ts, dayOffset: dayOffset, hour: hour, agentIdx: ai,
      calls: calls, fails: fails, err: err,
      ver: grayVer ? {
        online: { version: a.online, calls: onlineCalls, fails: onlineFails, latMedian: Math.round(latMedian) },
        gray: { version: grayVer, calls: grayCalls, fails: grayFails, latMedian: Math.round(grayLatMedian) }
      } : { online: { version: a.online, calls: calls, fails: fails, latMedian: Math.round(latMedian) } },
      model: model, intent: intent, seg: seg, caller: caller,
      tokIn: tokIn, tokOut: tokOut, cost: cost, retryWaste: retryWaste,
      lat: lat, latMedian: Math.round(latMedian), latSigma: latSigma,
      incident: inc ? inc.id : null, deploy: dep ? dep.id : null,
      gray: grayVer ? { ratio: grayRatio, version: grayVer } : null
    };
    HOUR_CACHE[key] = b;
    return b;
  }

  /* SECTION: daily-rollup
   * 日汇总 = 24 个小时桶求和。分位数用样本池合并计算，不做算术平均
   * （平均 P99 是错的，这是真实数据平台的常见 bug）。
   */
  var DAY_CACHE = Object.create(null);
  function dailyRow(ai, dayOffset) {
    var key = ai + '|' + dayOffset;
    var hit = DAY_CACHE[key];
    if (hit) return hit;

    var d = {
      dayOffset: dayOffset, date: fmtDate(S.TODAY_START + dayOffset * DAY), agentIdx: ai,
      calls: 0, fails: 0, err: {}, model: {}, intent: {}, seg: {}, caller: {},
      tokIn: 0, tokOut: 0, cost: 0, retryWaste: 0, lat: [], hours: [],
      verOnline: { calls: 0, fails: 0 }, verGray: { calls: 0, fails: 0 },
      incidents: [], deploys: []
    };
    for (var h = 0; h < 24; h++) {
      var b = hourBucket(ai, dayOffset, h);
      if (!b.calls) continue;
      d.calls += b.calls; d.fails += b.fails;
      d.tokIn += b.tokIn; d.tokOut += b.tokOut; d.cost += b.cost; d.retryWaste += b.retryWaste;
      mergeCount(d.err, b.err); mergeCount(d.intent, b.intent);
      mergeCount(d.seg, b.seg); mergeCount(d.caller, b.caller);
      mergeModel(d.model, b.model);
      for (var i = 0; i < b.lat.length; i++) d.lat.push(b.lat[i]);
      d.hours.push({ hour: h, calls: b.calls, fails: b.fails, cost: b.cost, latMedian: b.latMedian, lat: b.lat });
      if (b.ver.gray) {
        d.verOnline.calls += b.ver.online.calls; d.verOnline.fails += b.ver.online.fails;
        d.verGray.calls += b.ver.gray.calls; d.verGray.fails += b.ver.gray.fails;
      } else { d.verOnline.calls += b.calls; d.verOnline.fails += b.fails; }
      if (b.incident && d.incidents.indexOf(b.incident) < 0) d.incidents.push(b.incident);
      if (b.deploy) d.deploys.push({ hour: h, id: b.deploy });
    }
    d.lat.sort(function (x, y) { return x - y; });
    // 降采样存储：保留 64 个分位点，跨日聚合时误差可忽略且内存可控
    d.latSample = downsample(d.lat, 64);
    delete d.lat;
    d.successRate = d.calls ? (d.calls - d.fails) / d.calls : null;
    d.p50 = pct(d.latSample, 0.50); d.p90 = pct(d.latSample, 0.90); d.p99 = pct(d.latSample, 0.99);
    DAY_CACHE[key] = d;
    return d;
  }

  function mergeCount(t, s) { for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = (t[k] || 0) + s[k]; }
  function mergeModel(t, s) {
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      if (!t[k]) t[k] = { calls: 0, tokIn: 0, tokOut: 0, cost: 0, fails: 0 };
      t[k].calls += s[k].calls; t[k].tokIn += s[k].tokIn; t[k].tokOut += s[k].tokOut; t[k].cost += s[k].cost;
    }
  }
  function downsample(sorted, n) {
    if (sorted.length <= n) return sorted.slice();
    var out = [], step = (sorted.length - 1) / (n - 1);
    for (var i = 0; i < n; i++) out.push(sorted[Math.round(i * step)]);
    return out;
  }
  /** 从升序样本数组取分位数（线性插值） */
  function pct(sorted, p) {
    if (!sorted || !sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
  }

  /* SECTION: trace-id
   * traceId 编码 (agentIdx, dayOffset, hour, seq)，因此可反解。
   * 这保证「从列表点进详情」和「直接粘贴 traceId 打开」得到同一条记录
   * —— 真实 trace 系统的基本性质。
   *
   * 位域布局（共 31 位，保证 enc 为正、可直接 hex 编码）：
   *   agentIdx  5 位 @26   → 0-31
   *   dayOffset 9 位 @17   → 偏置 256，可表示 -256..255 天
   *   hour      5 位 @12   → 0-23
   *   seq      12 位 @0    → 0-4095，单桶最大调用数
   *
   * 注意：偏置必须小于字段容量。早前版本用「偏置 512 塞进 9 位」，
   * 512 & 0x1ff === 0 使日期字段恒为 0，反解出的 dayOffset 永远是 -512。
   */
  function hex(n, len) {
    var s = (n >>> 0).toString(16);
    while (s.length < len) s = '0' + s;
    return s;
  }
  function makeTraceId(ai, dayOffset, hour, seq) {
    var enc = ((ai & 0x1f) << 26) | (((dayOffset + 256) & 0x1ff) << 17) | ((hour & 0x1f) << 12) | (seq & 0xfff);
    return 'tr-' + hex(enc, 8) + '-' + hex((ai * 7919 + seq * 131 + hour * 17) & 0xffff, 4);
  }
  function parseTraceId(id) {
    var m = /^tr-([0-9a-f]{8})-/.exec(String(id));
    if (!m) return null;
    var enc = parseInt(m[1], 16);
    return {
      agentIdx: (enc >>> 26) & 0x1f,
      dayOffset: ((enc >>> 17) & 0x1ff) - 256,
      hour: (enc >>> 12) & 0x1f,
      seq: enc & 0xfff
    };
  }

  /* SECTION: trace-list
   * 生成某桶内的 trace 列表。严格遵循桶的计数：
   * 总数 = bucket.calls，失败数 = bucket.fails，错误码分布 = bucket.err。
   * 这是"下钻能对账"的实现点。
   */
  /**
   * 失败位置映射：pos(0..calls-1) → errorCode。
   *
   * 用部分 Fisher-Yates 洗牌保证「单射」—— 每个失败占一个唯一位置，
   * 因此 sum(bucket.err) 恒等于实际失败条数，下钻必然对得上账。
   * （旧实现用"随机取位置+冲突重试"，冲突耗尽时会丢弃失败记录，
   *   导致桶声明 3 次失败但只能下钻到 2 条，这在真实数据里是不允许的。）
   *
   * 结果按 (ai, dayOffset, hour) 缓存，列表与详情共用同一份，
   * 保证「点进详情」和「粘贴 traceId 打开」看到完全一致的失败判定。
   */
  var FAILMAP_CACHE = Object.create(null);
  function failureMap(ai, dayOffset, hour) {
    var key = ai + '|' + dayOffset + '|' + hour;
    var hit = FAILMAP_CACHE[key];
    if (hit) return hit;

    var b = hourBucket(ai, dayOffset, hour);
    var map = {};
    if (!b.calls) { FAILMAP_CACHE[key] = map; return map; }

    var failSlots = [];
    Object.keys(b.err).forEach(function (code) {
      for (var i = 0; i < b.err[code]; i++) failSlots.push(code);
    });
    var nFail = Math.min(failSlots.length, b.calls);

    // 位置池洗牌取前 nFail 个，天然不重复
    var r = R.of('tf|' + ai + '|' + dayOffset + '|' + hour);
    var pool = new Array(b.calls);
    for (var i = 0; i < b.calls; i++) pool[i] = i;
    for (var j = 0; j < nFail; j++) {
      var k = j + Math.floor(r() * (b.calls - j));
      var tmp = pool[j]; pool[j] = pool[k]; pool[k] = tmp;
      map[pool[j]] = failSlots[j];
    }
    FAILMAP_CACHE[key] = map;
    return map;
  }

  /* SECTION: trace-row  —— 「同一 traceId 只有一份数」的唯一实现点。
   *
   * 为什么必须有这个函数：trace 的标量字段（意图 / 时延 / token / 成本 / 状态 / 版本 / 时间）
   * 原先由**两条互不相干的随机流**各算一遍 ——
   *   列表（bucketTraces）用 R.of('tr|ai|day|hour|seq')
   *   详情（getTrace）  用 R.of('td|' + traceId)
   * 于是同一个 traceId：列表写 739ms/产品咨询，点进详情变 1,391ms/投诉处理
   * （历史上实测某张实例表 12/12 行全不一致；Agent 工作台、可观测 trace 详情同病）。
   *
   * 关键性质：每条 trace 的随机流以**自己的 seq** 为 key ⇒ 逐条独立，
   * 不需要重放整个桶就能重建任意一条（因此列表分页、状态筛选、直接粘贴 traceId 打开，
   * 三条路拿到的都是同一份数 —— 筛选不改变已发出的随机值）。
   *
   * 返回**新对象**（不缓存、不共享）：调用方就地改字段时不会互相污染。
   */
  function traceRow(ai, dayOffset, hour, seq) {
    var b = hourBucket(ai, dayOffset, hour);
    if (!b.calls || seq < 0 || seq >= b.calls) return null;

    var code = failureMap(ai, dayOffset, hour)[seq] || null;
    var rr = R.of('tr|' + ai + '|' + dayOffset + '|' + hour + '|' + seq);
    var a = AGENTS[ai];
    var it = R.weighted(rr, INTENTS, function (x) { return x.weight; });
    var sg = R.weighted(rr, SEGS, function (x) { return x.weight; });
    var ct = R.weighted(rr, CALLERS, function (x) { return x.weight; });
    var isGray = b.gray && (rr() < b.gray.ratio);
    var lat = Math.round(R.logNormal(rr, isGray && b.ver.gray ? b.ver.gray.latMedian : b.latMedian, b.latSigma));
    var ec = code ? ERR[S.idx.err[code]] : null;
    // 超时类失败时延必然超过阈值，否则数据自相矛盾
    if (code === 'E_MODEL_TIMEOUT') lat = Math.max(lat, 30000 + Math.round(rr() * 5000));
    var tokens = Math.round(R.logNormal(rr, 860, 0.5) * it.tokens);
    // cost 用该 trace 的模型单价，口径与桶一致
    var mm = MODELS[S.idx.model[a.model]];
    var ti = Math.round(tokens * 0.72), to = tokens - ti;
    return {
      traceId: makeTraceId(ai, dayOffset, hour, seq),
      ts: b.ts + Math.round((seq / b.calls) * 3600000),
      agentId: a.id, agentName: a.name, version: isGray && b.ver.gray ? b.ver.gray.version : a.online,
      intent: it.id, intentName: it.name, segment: sg.id, segmentName: sg.name,
      callerType: ct.id, callerName: ct.name,
      status: code ? 'failed' : 'success', errCode: code, errName: ec ? ec.name : null,
      latencyMs: lat,
      tokens: tokens, tokIn: ti, tokOut: to,
      cost: (ti / 1000) * mm.inPer1k + (to / 1000) * mm.outPer1k,
      userId: 'u_' + hex(Math.floor(rr() * 0xffffff), 6),
      incidentId: b.incident,
      agentIdx: ai, dayOffset: dayOffset, hour: hour, seq: seq
    };
  }

  function bucketTraces(ai, dayOffset, hour, opts) {
    opts = opts || {};
    var b = hourBucket(ai, dayOffset, hour);
    if (!b.calls) return { total: 0, rows: [], bucket: b };

    var failIdx = failureMap(ai, dayOffset, hour);

    var rows = [], limit = opts.limit || 50, offset = opts.offset || 0;
    var statusFilter = opts.status || null, errFilter = opts.errCode || null;
    var matched = 0, scanned = 0;

    for (var seq = 0; seq < b.calls; seq++) {
      var code = failIdx[seq] || null;
      var status = code ? 'failed' : 'success';
      var pass = (!statusFilter || statusFilter === status) && (!errFilter || errFilter === code);
      if (!pass) continue;
      if (matched >= offset && rows.length < limit) {
        // 行内容一律由 traceRow 给 —— 列表与详情不可能再算出两个数
        var row = traceRow(ai, dayOffset, hour, seq);
        if (row) rows.push(row);
      }
      matched++;
      scanned++;
    }
    return { total: matched, rows: rows, bucket: b };
  }

  /* SECTION: trace-detail
   * 单条 trace 的 span 树。由 traceId 反解 + 确定性生成，
   * 因此不需要存储，且任何时候打开同一条都完全一致。
   */
  function getTrace(traceId) {
    var p = parseTraceId(traceId);
    if (!p || p.agentIdx >= AGENTS.length) return null;

    /* 标量字段（意图 / 时延 / token / 成本 / 状态 / 版本 / 时间）一律取**列表那一行** ——
       本函数只负责"列表里没有的东西"：span 树、节点 IO、错误栈。
       此前这里自己开了 R.of('td|' + traceId)，与列表的 'tr|…' 是两条独立随机流，
       于是同一 traceId 在列表与详情各说一套数（实测 12/12 行不一致）。 */
    var row = traceRow(p.agentIdx, p.dayOffset, p.hour, p.seq);
    if (!row) return null;

    var b = hourBucket(p.agentIdx, p.dayOffset, p.hour);
    var a = AGENTS[p.agentIdx];
    var topo = TOPO[AGENT_TOPO[a.id]] || TOPO['qa-rag'];
    var r = R.of('td|' + traceId);

    // 该条是否失败、失败码：与列表共用同一份失败映射（现在连判失败本身都取自 row）
    var code = row.errCode;
    var isGray = !!(b.gray && b.ver.gray && row.version === b.ver.gray.version);
    /* 意图对象按 row.intent 反查（seed 的 idx 表只给 agent/model/biz/err，没有 intent）——
       老实现是 R.weighted 随机抽一个，抽到的意图与列表行标的意图根本不是一回事。 */
    var it = INTENTS[0];
    for (var ii = 0; ii < INTENTS.length; ii++) if (INTENTS[ii].id === row.intent) { it = INTENTS[ii]; break; }

    // 失败节点：按 FAIL_AFFINITY 在拓扑中选，工具类节点最易失败
    var failNode = null;
    if (code) {
      var cand = [], tw = 0;
      topo.forEach(function (n) {
        var w = (FAIL_AFFINITY[n.kind] || 0.05) * (n.kind === 'tool' && code === 'E_TOOL_FAIL' ? 4 : 1) *
                (n.kind === 'llm' && (code === 'E_MODEL_TIMEOUT' || code === 'E_MODEL_ERROR' || code === 'E_CTX_OVERFLOW') ? 4 : 1) *
                (n.kind === 'guard' && code === 'E_COMPLIANCE' ? 12 : 1) *
                (n.kind === 'start' && code === 'E_BAD_PARAMS' ? 12 : 1);
        cand.push({ n: n, w: w }); tw += w;
      });
      var x = r() * tw, acc = 0;
      for (var ci = 0; ci < cand.length; ci++) { acc += cand[ci].w; if (x <= acc) { failNode = cand[ci].n.id; break; } }
      if (!failNode) failNode = cand[cand.length - 1].n.id;
    }

    /* span 的**相对**耗时：按拓扑权重 + 抖动分配，事故期工具节点放大。
       分配基数用 row.latencyMs（权威时延），最后再整体归一到它 ——
       这样「火焰图各段之和 + 间隔 = 该 trace 的时延」成立，详情页自己内部也不再对不上账。
       失败节点之后的节点不执行。 */
    var SPAN_GAP_MS = 2;
    var spans = [], stopped = false;
    var wSum = 0; topo.forEach(function (n) { wSum += n.w; });

    topo.forEach(function (n, ni) {
      if (stopped) return;
      var share = (n.w / wSum) * (0.75 + r() * 0.5);
      var dur = Math.max(3, Math.round(row.latencyMs * share));
      // 事故期工具节点显著变慢
      if (b.incident && n.kind === 'tool') dur = Math.round(dur * 2.6);
      var isFail = (n.id === failNode);
      var sp = {
        id: n.id, name: n.name, kind: n.kind, index: ni,
        start: 0, duration: isFail ? dur + Math.round(dur * 0.4) : dur,
        status: isFail ? 'failed' : 'ok',
        model: n.model || (n.kind === 'llm' ? (isGray ? 'qwen-max' : a.model) : null),
        mcp: n.mcp || null,
        // 先给相对的 token 量，最后统一归一到 row 的权威 token（见下）
        tokensIn: n.kind === 'llm' ? Math.round(R.logNormal(r, 520, 0.5) * it.tokens) : 0,
        tokensOut: n.kind === 'llm' ? Math.round(R.logNormal(r, 190, 0.6) * it.tokens) : 0,
        error: null, io: null
      };
      if (isFail) {
        var ec = ERR[S.idx.err[code]];
        sp.error = {
          code: code, name: ec.name, http: ec.http, retryable: ec.retryable,
          message: errMsg(code, n, r),
          stack: errStack(code, n, a),
          retries: ec.retryable ? R.int(r, 1, 3) : 0
        };
        sp.status = 'failed';
      }
      sp.io = makeIO(n, it, r, a, sp.error);
      spans.push(sp);
      if (isFail) stopped = true;
    });

    /* 归一化 ①：span 时长之和 + 固定间隔 = row.latencyMs（精确相等，余数由最后一段吸收）。
       间隔在时延过小时退化为 0，保证不会把总额顶到 row.latencyMs 之上。 */
    var gapMs = (spans.length * SPAN_GAP_MS > row.latencyMs) ? 0 : SPAN_GAP_MS;
    var budget = row.latencyMs - spans.length * gapMs;
    var durSum = 0; spans.forEach(function (sp) { durSum += sp.duration; });
    var durLeft = budget;
    spans.forEach(function (sp, si) {
      var d = (si === spans.length - 1) ? durLeft
        : (durSum > 0 ? Math.round(budget * (sp.duration / durSum)) : 0);
      if (d < 0) d = 0;
      if (d > durLeft) d = durLeft;
      sp.duration = d; durLeft -= d;
    });
    var tCursor = 0;
    spans.forEach(function (sp) { sp.start = tCursor; tCursor += sp.duration + gapMs; });

    /* 归一化 ②：llm 节点的 token 之和 = row.tokIn / row.tokOut（同样精确）。
       非 llm 节点本来就不消耗 token，不参与分摊。 */
    var llmSpans = spans.filter(function (sp) { return sp.kind === 'llm'; });
    if (llmSpans.length) {
      var rawIn = 0, rawOut = 0;
      llmSpans.forEach(function (sp) { rawIn += sp.tokensIn; rawOut += sp.tokensOut; });
      var leftIn = row.tokIn, leftOut = row.tokOut;
      llmSpans.forEach(function (sp, si) {
        var last = (si === llmSpans.length - 1);
        var di = last ? leftIn : (rawIn > 0 ? Math.round(row.tokIn * (sp.tokensIn / rawIn)) : 0);
        var dout = last ? leftOut : (rawOut > 0 ? Math.round(row.tokOut * (sp.tokensOut / rawOut)) : 0);
        if (di < 0) di = 0; if (di > leftIn) di = leftIn;
        if (dout < 0) dout = 0; if (dout > leftOut) dout = leftOut;
        sp.tokensIn = di; leftIn -= di;
        sp.tokensOut = dout; leftOut -= dout;
      });
    }

    var realTotal = spans.reduce(function (s, x) { return s + x.duration; }, 0) + spans.length * gapMs;
    var ti = 0, to = 0;
    spans.forEach(function (x) { ti += x.tokensIn; to += x.tokensOut; });

    return {
      traceId: traceId,
      ts: row.ts,
      agentId: a.id, agentName: a.name, agentIdx: p.agentIdx,
      dayOffset: p.dayOffset, hour: p.hour, seq: p.seq,
      version: row.version,
      biz: a.biz, bizName: S.BIZ_LINES[S.idx.biz[a.biz]].name,
      intent: row.intent, intentName: row.intentName,
      status: row.status,
      errCode: row.errCode, errName: row.errName,
      /* ⚠ 这三个字段（时延 / token / 成本）**必须等于列表行的同名字段** ——
         它们是"同一 id 两个数"的历史重灾区，也是 _check/_verify-single-source.js 守的东西。
         realTotal（span 之和）与 latencyMs 按上面的归一化精确相等，保留作对账用。 */
      latencyMs: row.latencyMs,
      declaredLatencyMs: row.latencyMs,
      spansTotalMs: realTotal,
      tokensIn: row.tokIn, tokensOut: row.tokOut, tokens: row.tokens,
      cost: row.cost,
      tokensInSpans: ti, tokensOutSpans: to,
      model: a.model,
      incidentId: row.incidentId,
      spans: spans,
      topo: AGENT_TOPO[a.id]
    };
  }

  function errMsg(code, n, r) {
    var M = {
      'E_MODEL_TIMEOUT': '模型响应超时：' + n.name + ' 节点等待超过 30000ms 未返回',
      'E_TOOL_FAIL': '工具调用失败：' + (n.mcp || 'upstream') + ' 返回 502 Bad Gateway',
      'E_RATE_LIMIT': '网关限流：当前 QPS 超过配额上限，请求被拒绝（429）',
      'E_COMPLIANCE': '合规拦截：输出命中规则包「敏感表述-广告法」第 3.2 条',
      'E_BAD_PARAMS': '入参校验失败：字段 order_id 格式不合法（期望 18 位数字）',
      'E_MODEL_ERROR': '模型服务异常：upstream 返回 500，已重试 ' + R.int(r, 1, 3) + ' 次仍失败',
      'E_CTX_OVERFLOW': '上下文超限：拼接后 34,812 tokens 超过模型上限 32,768'
    };
    return M[code] || '未知错误';
  }
  function errStack(code, n, a) {
    return [
      'at ' + n.name + '.execute (orchestrator/node-' + n.kind + '.ts:' + (120 + n.id.length * 7) + ':18)',
      'at AgentRunner.runStep (runtime/runner.ts:284:12)',
      'at ' + a.id + '.invoke (runtime/invoke.ts:96:5)',
      'cause: ' + code
    ].join('\n');
  }
  function makeIO(n, it, r, a, err) {
    if (n.kind === 'start') {
      return {
        input: null,
        output: { user_id: 'u_' + hex(Math.floor(r() * 0xffffff), 6), query: sampleQuery(it, r), session_id: 's_' + hex(Math.floor(r() * 0xfffffff), 7) }
      };
    }
    if (n.kind === 'llm') {
      return {
        input: { model: n.model || a.model, temperature: 0.3, messages: '[system + ' + R.int(r, 2, 8) + ' 轮上下文]' },
        output: err ? null : { text: sampleAnswer(it, r).slice(0, 120) + '…', finish_reason: 'stop' }
      };
    }
    if (n.kind === 'tool') {
      return {
        input: { service: n.mcp, params: toolParams(n.mcp, r) },
        output: err ? null : toolResult(n.mcp, r)
      };
    }
    if (n.kind === 'guard') {
      return {
        input: { rulepacks: ['敏感表述-广告法 v12', '数据出境校验 v3'], text_length: R.int(r, 180, 900) },
        output: err ? { hit: true, rule: '敏感表述-广告法 §3.2', matched: '「最佳」「国家级」等绝对化用语' } : { hit: false, checked: 2 }
      };
    }
    return { input: null, output: err ? null : { delivered: true, session_saved: true } };
  }
  function toolParams(mcp, r) {
    var P = {
      'mcp-crm-query': { customer_id: 'C' + R.int(r, 100000, 999999) },
      'mcp-kb-search': { query: '退换货政策 时限', top_k: 5, threshold: 0.72 },
      'mcp-order': { order_id: '2026' + R.int(r, 10000000, 99999999) },
      'mcp-ticket': { type: 'refund', priority: 'normal' },
      'mcp-doc-parse': { file: 'contract_' + R.int(r, 1000, 9999) + '.pdf', pages: R.int(r, 4, 60) },
      'mcp-notify': { channel: 'sms', template: 'TPL_' + R.int(r, 100, 999) }
    };
    return P[mcp] || {};
  }
  function toolResult(mcp, r) {
    var P = {
      'mcp-crm-query': { level: 'VIP', region: '华东', tags: ['高价值', '价格敏感'] },
      'mcp-kb-search': { hits: R.int(r, 1, 5), top_score: +(0.72 + r() * 0.26).toFixed(3), top_title: '退换货政策 v3' },
      'mcp-order': { status: '已签收', amount: R.int(r, 80, 9800), days_since: R.int(r, 1, 40) },
      'mcp-ticket': { ticket_id: 'T' + R.int(r, 100000, 999999) },
      'mcp-doc-parse': { pages: R.int(r, 4, 60), clauses: R.int(r, 12, 90) },
      'mcp-notify': { sent: true, msg_id: 'M' + R.int(r, 10000, 99999) }
    };
    return P[mcp] || { ok: true };
  }
  var QUERIES = {
    refund: ['我买的东西想退货，怎么操作', '退款多久能到账', '超过七天还能退吗', '商品有质量问题要退'],
    logistics: ['我的快递到哪了', '为什么物流三天没更新', '能改收货地址吗'],
    product: ['这两个型号有什么区别', '支持私有化部署吗', '有没有 API 文档'],
    invoice: ['怎么开增值税专用发票', '发票抬头写错了能改吗'],
    complaint: ['你们服务太差了要投诉', '客服一直不回复怎么回事'],
    'doc-gen': ['帮我生成这份招标文件的技术标章节', '把这份合同摘要成要点'],
    'data-query': ['上个月华东区的转化率是多少', '查一下这个客户的跟进记录'],
    other: ['你好', '在吗', '转人工']
  };
  function sampleQuery(it, r) { var arr = QUERIES[it.id] || QUERIES.other; return arr[Math.floor(r() * arr.length)]; }
  var ANSWERS = {
    refund: '根据《退换货政策 v3》，签收后 7 天内可申请无理由退货。您的订单在有效期内，我已为您创建退货单…',
    logistics: '您的包裹当前在杭州转运中心，预计明日送达。物流单号已同步至订单详情…',
    product: '两者的核心差异在于并发上限与部署形态：A 型号支持 500 并发…',
    invoice: '专票需在订单完成后 3 个工作日内申请，请提供纳税人识别号与开户行信息…',
    complaint: '非常抱歉给您带来不好的体验，我已将本次会话升级为投诉工单并通知主管…',
    'doc-gen': '已按招标文件 §4.2 要求生成技术标第三章，包含实施方案、进度计划与质量保障…',
    'data-query': '上月华东区转化率为 4.3%，环比提升 0.6pp，其中企业客户贡献主要增量…',
    other: '您好，请问有什么可以帮您？'
  };
  function sampleAnswer(it, r) { var s = ANSWERS[it.id] || ANSWERS.other; return s; }

  /* SECTION: format-helpers */
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  global.FACTS = {
    TOPO: TOPO,
    AGENT_TOPO: AGENT_TOPO,
    hourBucket: hourBucket,
    dailyRow: dailyRow,
    bucketTraces: bucketTraces,
    traceRow: traceRow,
    getTrace: getTrace,
    makeTraceId: makeTraceId,
    parseTraceId: parseTraceId,
    pct: pct,
    fmtDate: fmtDate,
    lifecycleFactor: lifecycleFactor,
    incidentAt: incidentAt,
    SAMPLES_PER_HOUR: SAMPLES_PER_HOUR
  };
})(window);
