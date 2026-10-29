/* SECTION: query-core
 * 聚合查询层 —— 唯一的指标出口。
 *
 * 设计原则：页面不自己算数，全部经由 QUERY 提供的口径明确的函数。
 * 这样「总览页的成功率」与「Agent 详情页的成功率」必然一致，
 * 因为它们调用的是同一个函数、同一批小时桶。
 *
 * 每个返回结果都携带 meta：口径说明、时间范围、数据新鲜度、样本量、
 * 是否受事故影响。真实数据平台必须能回答"这个数怎么算的、什么时候的"。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, F = global.FACTS;
  var AGENTS = S.AGENTS, DAY = S.DAY;

  /* SECTION: range-resolve
   * 时间范围解析：所有查询统一从这里拿 dayOffset 列表。
   * 支持相对范围（近1h/24h/7d/30d）与绝对日期区间。
   */
  var RANGES = {
    '1h':  { label: '近 1 小时',  days: 1, hours: 1 },
    '6h':  { label: '近 6 小时',  days: 1, hours: 6 },
    '24h': { label: '近 24 小时', days: 1, hours: 24 },
    '7d':  { label: '近 7 天',    days: 7 },
    '30d': { label: '近 30 天',   days: 30 }
  };

  /** 当前小时数（今天已过去多少小时），用于"近 N 小时"的截断 */
  function currentHour() { return S.NOW.getHours(); }

  /**
   * 解析范围为需要遍历的桶列表（惰性生成器，避免一次性算太多桶）
   * @returns {{days:number[], hourFilter:function|null, meta:object}}
   */
  /**
   * @param {string} rangeKey
   * @param {object} [opts] opts.shift = 往回偏移几个等长周期（1 = 上一周期，用于环比）
   */
  function resolveRange(rangeKey, opts) {
    opts = opts || {};
    var r = RANGES[rangeKey] || RANGES['7d'];
    var shift = opts.shift || 0;
    var days = [], i;

    if (r.hours) {
      // 小时级：从今天当前小时往回推；shift 用于取上一等长周期
      var pairs = [];
      var curDay = 0, curHour = S.NOW.getHours() - 1 - shift * r.hours;   // 不含当前未完成小时
      for (i = 0; i < r.hours; i++) {
        while (curHour < 0) { curHour += 24; curDay -= 1; }
        pairs.push({ dayOffset: curDay, hour: curHour });
        curHour -= 1;
      }
      return {
        kind: 'hourly', pairs: pairs, days: null,
        meta: {
          rangeKey: rangeKey, rangeLabel: r.label + (shift ? '（前 ' + shift + ' 周期）' : ''),
          from: S.TODAY_START + pairs[pairs.length - 1].dayOffset * DAY + pairs[pairs.length - 1].hour * 3600000,
          to: S.TODAY_START + pairs[0].dayOffset * DAY + (pairs[0].hour + 1) * 3600000,
          partial: true,
          note: shift ? null : '不含当前未完成的小时（' + S.NOW.getHours() + ':00-' + S.NOW.getHours() + ':59 仍在累积）'
        }
      };
    }

    for (i = 0; i < r.days; i++) days.push(-i - shift * r.days);
    days.reverse();
    return {
      kind: 'daily', pairs: null, days: days,
      meta: {
        rangeKey: rangeKey, rangeLabel: r.label + (shift ? '（前 ' + shift + ' 周期）' : ''),
        from: S.TODAY_START + days[0] * DAY,
        to: S.TODAY_START + (days[days.length - 1] + 1) * DAY,
        partial: true,
        note: days[days.length - 1] === 0 ? '今日数据截至 ' + pad(currentHour()) + ':59，尚未完整' : null
      }
    };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* SECTION: bucket-iterate */
  /** 遍历范围内的所有小时桶（统一入口，保证口径一致） */
  function eachBucket(range, agentIdxFilter, fn) {
    var i, h;
    if (range.kind === 'hourly') {
      for (i = 0; i < range.pairs.length; i++) {
        var p = range.pairs[i];
        if (agentIdxFilter == null) {
          for (var ai = 0; ai < AGENTS.length; ai++) fn(F.hourBucket(ai, p.dayOffset, p.hour), ai, p.dayOffset, p.hour);
        } else {
          fn(F.hourBucket(agentIdxFilter, p.dayOffset, p.hour), agentIdxFilter, p.dayOffset, p.hour);
        }
      }
    } else {
      for (i = 0; i < range.days.length; i++) {
        var dOff = range.days[i];
        for (h = 0; h < 24; h++) {
          if (agentIdxFilter == null) {
            for (var aj = 0; aj < AGENTS.length; aj++) fn(F.hourBucket(aj, dOff, h), aj, dOff, h);
          } else {
            fn(F.hourBucket(agentIdxFilter, dOff, h), agentIdxFilter, dOff, h);
          }
        }
      }
    }
  }

  /* SECTION: kpi
   * 核心指标计算。返回对象同时带 meta，页面直接渲染即可。
   */
  function kpi(rangeKey, opts) {
    opts = opts || {};
    var range = resolveRange(rangeKey);
    var aiFilter = opts.agentIdx != null ? opts.agentIdx : null;
    if (opts.agentId != null && aiFilter == null) aiFilter = S.idx.agent[opts.agentId];

    var calls = 0, fails = 0, tokIn = 0, tokOut = 0, cost = 0, retryWaste = 0;
    var latPool = [], errAgg = {}, modelAgg = {}, intentAgg = {}, callerAgg = {}, segAgg = {};
    var affectedByIncident = {}, bucketCount = 0;

    eachBucket(range, aiFilter, function (b) {
      if (!b.calls) return;
      bucketCount++;
      calls += b.calls; fails += b.fails;
      tokIn += b.tokIn; tokOut += b.tokOut; cost += b.cost; retryWaste += b.retryWaste;
      for (var i = 0; i < b.lat.length; i++) latPool.push(b.lat[i]);
      countInto(errAgg, b.err); countInto(modelAgg, b.model, true);
      countInto(intentAgg, b.intent); countInto(callerAgg, b.caller); countInto(segAgg, b.seg);
      if (b.incident) affectedByIncident[b.incident] = (affectedByIncident[b.incident] || 0) + b.calls;
    });
    latPool.sort(function (a, b) { return a - b; });

    var prevRange = previousRange(rangeKey);
    var prev = kpiRaw(prevRange, aiFilter, 1);
    var prevMeta = resolveRange(prevRange, { shift: 1 }).meta;

    var affectedCalls = 0;
    Object.keys(affectedByIncident).forEach(function (k) { affectedCalls += affectedByIncident[k]; });

    return {
      calls: calls,
      fails: fails,
      successRate: calls ? (calls - fails) / calls : null,
      cost: cost,
      tokens: tokIn + tokOut,
      tokIn: tokIn, tokOut: tokOut,
      retryWaste: retryWaste,
      p50: F.pct(latPool, 0.5), p90: F.pct(latPool, 0.9), p99: F.pct(latPool, 0.99),
      avgLatency: latPool.length ? Math.round(latPool.reduce(function (s, x) { return s + x; }, 0) / latPool.length) : null,
      errAgg: errAgg, modelAgg: modelAgg, intentAgg: intentAgg, callerAgg: callerAgg, segAgg: segAgg,
      compare: {
        calls: delta(calls, prev.calls),
        cost: delta(cost, prev.cost),
        successRate: calls && prev.calls ? ((calls - fails) / calls) - ((prev.calls - prev.fails) / prev.calls) : null,
        p99: delta(F.pct(latPool, 0.99), prev.p99),
        prevLabel: '上一等长周期',
        prevRange: { from: prevMeta.from, to: prevMeta.to },
        prevRaw: prev
      },
      meta: {
        range: range.meta,
        sampleSize: latPool.length,
        sampleNote: '分位数基于每桶抽样 ' + F.SAMPLES_PER_HOUR + ' 条时延样本（共 ' + latPool.length + ' 条），非全量',
        affectedByIncident: affectedCalls,
        affectedRatio: calls ? affectedCalls / calls : 0,
        incidentIds: Object.keys(affectedByIncident),
        bucketCount: bucketCount,
        attribution: attributionCoverage(callerAgg),
        definitions: {
          calls: '统计范围内的 Agent 调用总次数，含失败与重试',
          successRate: '(调用数 − 失败数) / 调用数；失败定义为流程未正常产出结果（超时、工具失败、限流、合规拦截、入参错误）',
          p99: '端到端时延 99 分位，从开始节点到输出节点，含工具等待',
          cost: '按各模型输入/输出 token 单价折算；失败调用的已消耗 token 计入',
          retryWaste: '可重试错误码产生的重试消耗，属可优化成本'
        }
      }
    };
  }

  function kpiRaw(rangeKey, aiFilter, shift) {
    var range = resolveRange(rangeKey, { shift: shift || 0 });
    var calls = 0, fails = 0, cost = 0, latPool = [];
    eachBucket(range, aiFilter, function (b) {
      if (!b.calls) return;
      calls += b.calls; fails += b.fails; cost += b.cost;
      for (var i = 0; i < b.lat.length; i++) latPool.push(b.lat[i]);
    });
    latPool.sort(function (a, b) { return a - b; });
    return { calls: calls, fails: fails, cost: cost, p99: F.pct(latPool, 0.99) };
  }

  /** 环比：同一个 rangeKey，但整体往回偏移 1 个等长周期 */
  function previousRange(rangeKey) {
    return RANGES[rangeKey] ? rangeKey : '7d';
  }

  function countInto(target, src, isModel) {
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (isModel) {
        if (!target[k]) target[k] = { calls: 0, tokIn: 0, tokOut: 0, cost: 0 };
        target[k].calls += src[k].calls; target[k].tokIn += src[k].tokIn;
        target[k].tokOut += src[k].tokOut; target[k].cost += src[k].cost;
      } else target[k] = (target[k] || 0) + src[k];
    }
  }
  function delta(cur, prev) {
    if (cur == null || prev == null || prev === 0) return null;
    return (cur - prev) / prev;
  }
  /** 归因覆盖率：未标记来源的调用占比即缺口 */
  function attributionCoverage(callerAgg) {
    var total = 0, unknown = 0;
    for (var k in callerAgg) { if (Object.prototype.hasOwnProperty.call(callerAgg, k)) { total += callerAgg[k]; if (k === 'unknown') unknown += callerAgg[k]; } }
    return { total: total, unknown: unknown, coverage: total ? (total - unknown) / total : 1 };
  }

  /* SECTION: timeseries
   * 时序数据。粒度随范围自动降采样（长时间范围降精度，避免点过密）。
   * 同时附带事故区间与发布事件，供图表画标记。
   */
  /* v27（Agent 工作台走查）：近 1 小时原来也按小时切桶 → 只有 1 个点，
     主图只能显示「数据点不足，无法绘制趋势」，而同一屏的指标卡却照常给数（766 次调用 / 98.96%…）
     —— 同屏两种说法。1 小时窗口改切 **5 分钟桶**：把这一小时的量按确定性权重分到 12 个子桶，
     并保证 Σ子桶 = 该小时总量（**总数守恒**，不是多造流量）。
     诚实边界：子桶的 P50/P90/P99 直接沿用该小时的分位值（没有子桶级样本，就不编分位），
     事故区间整小时都标上（"这一小时处于事故区间"是已知的，落到哪 5 分钟是未知的）。 */
  function splitHourTo5m(p) {
    var N = 12, out = [], i;
    var rng = S.R.of('ts5m|' + p.ts);
    var w = [], sum = 0;
    for (i = 0; i < N; i++) {
      var v = 0.55 + 0.75 * Math.sin(Math.PI * (i + 0.5) / N) + rng() * 0.35;
      w.push(v); sum += v;
    }
    var cAcc = 0, fAcc = 0, $Acc = 0;
    for (i = 0; i < N; i++) {
      var last = (i === N - 1), share = w[i] / sum;
      var c = last ? Math.max(0, p.calls - cAcc) : Math.max(0, Math.round(p.calls * share));
      var f = last ? Math.max(0, p.fails - fAcc) : Math.max(0, Math.round(p.fails * share));
      var co = last ? Math.max(0, p.cost - $Acc) : Math.max(0, p.cost * share);
      cAcc += c; fAcc += f; $Acc += co;
      out.push({
        ts: p.ts + i * 300000,
        calls: c, fails: f, cost: co,
        p50: p.p50, p90: p.p90, p99: p.p99,
        successRate: c ? (c - f) / c : null,
        incidentIds: (p.incidentIds || []).slice(),
        deploys: i === 0 ? (p.deploys || []).slice() : []
      });
    }
    return out;
  }
  function timeseries(rangeKey, opts) {
    opts = opts || {};
    var range = resolveRange(rangeKey);
    var aiFilter = opts.agentId != null ? S.idx.agent[opts.agentId] : (opts.agentIdx != null ? opts.agentIdx : null);
    var points = [], map = {};
    var gran = '1h';

    eachBucket(range, aiFilter, function (b, ai, dOff, hour) {
      var key;
      if (range.kind === 'hourly') key = dOff + '|' + hour;
      else if (rangeKey === '7d') key = dOff + '|' + Math.floor(hour / 3) * 3;  // 3 小时粒度
      else key = String(dOff);                                                     // 天粒度
      if (!map[key]) {
        var ts = range.kind === 'hourly'
          ? S.TODAY_START + dOff * DAY + hour * 3600000
          : (rangeKey === '7d' ? S.TODAY_START + dOff * DAY + Math.floor(hour / 3) * 3 * 3600000 : S.TODAY_START + dOff * DAY);
        map[key] = { ts: ts, calls: 0, fails: 0, cost: 0, lat: [], incidents: {}, deploys: [] };
        points.push(map[key]);
      }
      var p = map[key];
      p.calls += b.calls; p.fails += b.fails; p.cost += b.cost;
      for (var i = 0; i < b.lat.length; i++) p.lat.push(b.lat[i]);
      if (b.incident) p.incidents[b.incident] = true;
      if (b.deploy) p.deploys.push(b.deploy);
    });

    points.sort(function (a, b) { return a.ts - b.ts; });
    points.forEach(function (p) {
      p.lat.sort(function (a, b) { return a - b; });
      p.p50 = F.pct(p.lat, 0.5); p.p90 = F.pct(p.lat, 0.9); p.p99 = F.pct(p.lat, 0.99);
      p.successRate = p.calls ? (p.calls - p.fails) / p.calls : null;
      p.incidentIds = Object.keys(p.incidents);
      delete p.lat;
    });
    /* 1 小时窗口：小时级只有 1 个点 → 落到 5 分钟桶（见 splitHourTo5m 的说明） */
    if (range.kind === 'hourly' && points.length === 1) {
      points = splitHourTo5m(points[0]);
      gran = '5m';
    }

    return {
      points: points,
      granularity: range.kind === 'hourly' ? gran : (rangeKey === '7d' ? '3h' : '1d'),
      meta: { range: range.meta, incidents: incidentsInRange(range), deploys: deploysInRange(range, opts.agentId) }
    };
  }

  function incidentsInRange(range) {
    var out = [];
    S.INCIDENTS.forEach(function (inc) {
      var inRange = range.days ? range.days.indexOf(inc.dayOffset) >= 0
        : range.pairs.some(function (p) { return p.dayOffset === inc.dayOffset && inc.hourStart <= p.hour && inc.hourEnd >= p.hour; });
      if (inRange) out.push(inc);
    });
    return out;
  }
  function deploysInRange(range, agentId) {
    var out = [];
    S.DEPLOYS.forEach(function (d) {
      if (agentId && d.agentId !== agentId) return;
      var inRange = range.days ? range.days.indexOf(d.dayOffset) >= 0
        : range.pairs.some(function (p) { return p.dayOffset === d.dayOffset && p.hour === d.hour; });
      if (inRange) out.push(d);
    });
    return out;
  }

  /* SECTION: groupby
   * 维度聚合。支持按 Agent / 业务线 / 模型 / 意图 / 错误码 / 调用方 / 人群 / 日期 分组。
   * 返回值带占比与环比，供表格与柱状图直接使用。
   */
  /* 真正按桶累加过 token 的维度（见下方 eachBucket 分支）：只有这几维能给出 tokens 总量 */
  var TOKEN_DIMS = { model: 1, agent: 1, biz: 1, date: 1 };

  function groupBy(rangeKey, dim, opts) {
    opts = opts || {};
    var range = resolveRange(rangeKey);
    var aiFilter = opts.agentId != null ? S.idx.agent[opts.agentId] : null;
    var acc = {};

    function slot(k) {
      if (!acc[k]) acc[k] = { key: k, calls: 0, fails: 0, cost: 0, tokIn: 0, tokOut: 0, lat: [] };
      return acc[k];
    }

    eachBucket(range, aiFilter, function (b, ai) {
      if (!b.calls) return;
      var keys = [];
      if (dim === 'agent') keys = [AGENTS[ai].id];
      else if (dim === 'biz') keys = [AGENTS[ai].biz];
      else if (dim === 'model') keys = Object.keys(b.model);
      else if (dim === 'intent') keys = Object.keys(b.intent);
      else if (dim === 'errCode') keys = Object.keys(b.err);
      else if (dim === 'caller') keys = Object.keys(b.caller);
      else if (dim === 'segment') keys = Object.keys(b.seg);
      else if (dim === 'date') keys = [b.dayOffset];

      keys.forEach(function (k) {
        var s = slot(k);
        if (dim === 'model') {
          var m = b.model[k];
          s.calls += m.calls; s.cost += m.cost; s.tokIn += m.tokIn; s.tokOut += m.tokOut;
          // 模型维度的失败数按调用占比分摊（桶内不按模型记录失败）
          s.fails += Math.round(b.fails * (m.calls / b.calls));
        } else if (dim === 'errCode') {
          s.calls += b.err[k]; s.fails += b.err[k];
        } else if (dim === 'intent') {
          s.calls += b.intent[k];
          s.fails += Math.round(b.fails * (b.intent[k] / b.calls));
          s.cost += b.cost * (b.intent[k] / b.calls);
        } else if (dim === 'caller') {
          s.calls += b.caller[k];
          s.fails += Math.round(b.fails * (b.caller[k] / b.calls));
          s.cost += b.cost * (b.caller[k] / b.calls);
        } else if (dim === 'segment') {
          s.calls += b.seg[k];
          s.fails += Math.round(b.fails * (b.seg[k] / b.calls));
          s.cost += b.cost * (b.seg[k] / b.calls);
        } else if (dim === 'date') {
          s.calls += b.calls; s.fails += b.fails; s.cost += b.cost; s.tokIn += b.tokIn; s.tokOut += b.tokOut;
        } else {
          s.calls += b.calls; s.fails += b.fails; s.cost += b.cost; s.tokIn += b.tokIn; s.tokOut += b.tokOut;
        }
        for (var i = 0; i < b.lat.length; i++) s.lat.push(b.lat[i]);
      });
    });

    var rows = Object.keys(acc).map(function (k) {
      var s = acc[k];
      s.lat.sort(function (a, b) { return a - b; });
      s.p50 = F.pct(s.lat, 0.5); s.p90 = F.pct(s.lat, 0.9); s.p99 = F.pct(s.lat, 0.99);
      s.successRate = s.calls ? (s.calls - s.fails) / s.calls : null;
      s.label = dimLabel(dim, k);
      s.approximated = (dim === 'intent' || dim === 'caller' || dim === 'segment' || dim === 'model');
      /* token 总量。此前只累加了 tokIn/tokOut 两个分项，行上没有 tokens ——
         而表格列要的是 tokens ⇒ 网关「模型用量分布」的 token 列三行全是「—」。
         只对真的按桶累加过 token 的维度给值：errCode / intent / caller / segment
         这几维只按调用占比分摊了失败数与成本，token 无从分摊，给了反而是编数。 */
      if (TOKEN_DIMS[dim]) s.tokens = s.tokIn + s.tokOut;
      delete s.lat;
      return s;
    });
    var total = rows.reduce(function (sum, x) { return sum + x.calls; }, 0);
    rows.forEach(function (x) { x.share = total ? x.calls / total : 0; });
    var sortBy = opts.sortBy || 'calls';
    rows.sort(function (a, b) { return (b[sortBy] || 0) - (a[sortBy] || 0); });

    return {
      dim: dim, rows: rows, total: total,
      meta: {
        range: range.meta,
        approximated: (dim === 'intent' || dim === 'caller' || dim === 'segment' || dim === 'model'),
        approximationNote: (dim === 'intent' || dim === 'caller' || dim === 'segment' || dim === 'model')
          ? '该维度的失败数与成本按调用占比分摊到各组（数据源未按此维度独立记录失败），存在近似'
          : null
      }
    };
  }

  function dimLabel(dim, k) {
    var i;
    if (dim === 'agent') { var a = AGENTS[S.idx.agent[k]]; return a ? a.name : k; }
    if (dim === 'biz') return S.BIZ_LINES[S.idx.biz[k]] ? S.BIZ_LINES[S.idx.biz[k]].name : k;
    if (dim === 'model') { var m = S.MODELS[S.idx.model[k]]; return m ? m.name : k; }
    if (dim === 'intent') { for (i = 0; i < S.INTENTS.length; i++) if (S.INTENTS[i].id === k) return S.INTENTS[i].name; return k; }
    if (dim === 'errCode') { for (i = 0; i < S.ERROR_CODES.length; i++) if (S.ERROR_CODES[i].id === k) return S.ERROR_CODES[i].name; return k; }
    if (dim === 'caller') { for (i = 0; i < S.CALLER_TYPES.length; i++) if (S.CALLER_TYPES[i].id === k) return S.CALLER_TYPES[i].name; return k; }
    if (dim === 'segment') { for (i = 0; i < S.SEGMENTS.length; i++) if (S.SEGMENTS[i].id === k) return S.SEGMENTS[i].name; return k; }
    if (dim === 'date') return F.fmtDate(S.TODAY_START + Number(k) * DAY);
    return String(k);
  }

  /* SECTION: agent-table
   * Agent 列表页数据。每行都来自真实聚合，卡片上的 sparkline 用 7 日序列。
   */
  function agentTable(rangeKey) {
    var range = resolveRange(rangeKey);
    var out = [];
    for (var ai = 0; ai < AGENTS.length; ai++) {
      var a = AGENTS[ai];
      var calls = 0, fails = 0, cost = 0, lat = [];
      eachBucket(range, ai, function (b) {
        if (!b.calls) return;
        calls += b.calls; fails += b.fails; cost += b.cost;
        for (var i = 0; i < b.lat.length; i++) lat.push(b.lat[i]);
      });
      lat.sort(function (x, y) { return x - y; });
      // 7 日 sparkline
      var spark = [];
      for (var d = -6; d <= 0; d++) {
        var dr = F.dailyRow(ai, d);
        spark.push(dr.calls);
      }
      var life = F.lifecycleFactor(a, 0);
      out.push({
        id: a.id, name: a.name, desc: a.desc, biz: a.biz,
        bizName: S.BIZ_LINES[S.idx.biz[a.biz]].name,
        owner: ownerName(a.owner), ownerDept: ownerDept(a.owner),
        version: a.online, grayVersion: a.grayVersion, grayRatio: a.grayRatio,
        status: life <= 0 ? 'offline' : (a.grayVersion ? 'gray' : 'online'),
        publishedAt: F.fmtDate(S.TODAY_START + a.publishedAt * DAY),
        retiredAt: a.retiredAt !== undefined ? F.fmtDate(S.TODAY_START + a.retiredAt * DAY) : null,
        calls: calls, fails: fails, cost: cost,
        successRate: calls ? (calls - fails) / calls : null,
        p99: F.pct(lat, 0.99), p50: F.pct(lat, 0.5),
        spark: spark
      });
    }
    // 异常判定：成功率低于 99% 或 P99 超 4s
    /* 2026-10-20 走查修复：原来 98.96% 和 93% 都叫「需关注」，9 张卡 6 张红 → 红色没有信息量。
       abnormal 的含义与计数口径保持不变（<99% 或 P99>4s，跨屏数字不能变），
       另加 severity 只用于**显示分层**：<97% 或 P99>8s 才算 bad（红），其余异常算 warn（琥珀）。 */
    out.forEach(function (r, ai) {
      r.abnormal = r.calls > 0 && (r.successRate < 0.99 || r.p99 > 4000);
      r.severity = !r.abnormal ? 'ok' : ((r.successRate < 0.97 || r.p99 > 8000) ? 'bad' : 'warn');
      r.abnormalReasons = [];
      if (r.calls > 0 && r.successRate < 0.99) r.abnormalReasons.push('成功率 ' + (r.successRate * 100).toFixed(2) + '% 低于 99% 阈值');
      if (r.calls > 0 && r.p99 > 4000) r.abnormalReasons.push('P99 ' + (r.p99 / 1000).toFixed(1) + 's 超过 4s 阈值');
      r.now = nowEvent(ai, r);
    });
    out.sort(function (a, b) { return b.calls - a.calls; });
    return { rows: out, meta: { range: range.meta } };
  }
  /* SECTION: agent-now
   * 卡片底行「此刻在做什么」。2026-10-21 xianyu 拍板：不要那行阈值判决
   * （"成功率 98.62% 低于 99% 阈值"），换成 Agent 事件。
   *
   * 文案来自 seed.js 每个 Agent 的 nowDoing（业务事实：客服在处理售后工单、
   * 标书在写技术标第 3 章）——**不在渲染里按名字猜**，否则会出现
   * 「线索评分 Agent 正在处理退货退款」这种瞎话。
   * 右侧耗时取该 Agent 当前小时最后一条 trace 的真实 latencyMs，可点进调用明细核对。
   *
   * 阈值判定没被删掉：它退到卡片 title（悬停才出现），数字仍由 abnormalReasons 供。
   */
  function nowEvent(ai, r) {
    if (r.status === 'offline') return null;          // 已下线走卡片原有的 ag-off 行
    var a = AGENTS[ai];
    if (!a.nowDoing) return { kind: 'idle', text: '本小时还没有接到调用', ms: null };
    var b = F.hourBucket(ai, 0, currentHour());
    var last = (b && b.calls) ? F.traceRow(ai, 0, currentHour(), b.calls - 1) : null;
    return { kind: 'run', text: a.nowDoing, ms: last ? last.latencyMs : null };
  }

  /* 2026-10-21：删掉的账号不再回退成 uid —— 查不到人就返回「—」，不把内部 id 当人名显示 */
  function ownerName(id) { for (var i = 0; i < S.OWNERS.length; i++) if (S.OWNERS[i].id === id) return S.OWNERS[i].name; return (id ? '—' : ''); }
  function ownerDept(id) { for (var i = 0; i < S.OWNERS.length; i++) if (S.OWNERS[i].id === id) return S.OWNERS[i].dept; return ''; }

  /* SECTION: gateway-assets
   * 网关三个 Tab（MCP 服务 / LLM 路由 / Skill）的取数口。
   *
   * 放在这一层而不是各自的渲染器里，理由是本仓的第一条纪律：**页面不自己算数**。
   * 尤其是 MCP 服务健康 —— MCP 页的服务健康墙与 Skill 页的「依赖是否健康」
   * 必须读同一个函数，否则同一屏的两个 Tab 会对同一个服务给出两种状态。
   */
  /* 未恢复事故：resolvedAt 为 null 的才算「进行中」。
     事故窗口（hourRange）只用于往那一时段注入错误，不表示事故已经结束 ——
     一条没填 resolvedAt 的事故就是还没恢复，理应持续影响健康状态。 */
  function openIncidents() {
    return (S.INCIDENTS || []).filter(function (i) { return i.resolvedAt == null; });
  }
  /** 某个服务当前压着的事故（取第一条未恢复的） */
  function incidentOf(svcId) {
    var list = openIncidents();
    for (var i = 0; i < list.length; i++) {
      if ((list[i].services || []).indexOf(svcId) >= 0) return list[i];
    }
    return null;
  }

  /** MCP 服务健康：配额使用率超 85% 转「接近配额」，错误率超 2% 转「错误率超标」。
   *  v30：有未恢复事故的服务**直接标异常**，并把错误率/时延按事故倍数放大 ——
   *  此前健康墙 6/6 全绿，而同屏之外躺着一条未恢复的 P1 事故，两条信息互相打脸。 */
  function mcpHealth() {
    return (S.MCP_SERVICES || []).map(function (m) {
      var r = S.R.of('svc|' + m.id);
      var qps = Math.round(m.qpsCap * (0.32 + r() * 0.5));
      var baseErr = 0.004 * m.errorBias * (0.8 + r() * 0.4);
      var baseP99 = Math.round(180 + r() * 620 * m.errorBias);
      var keys = 1 + Math.floor(r() * 3);
      var inc = incidentOf(m.id);
      var errRate = inc ? baseErr * ((inc.affect && inc.affect.errorMul) || 1) : baseErr;
      var p99 = inc ? Math.round(baseP99 * ((inc.affect && inc.affect.latencyMul) || 1)) : baseP99;
      var limited = qps > m.qpsCap * 0.85;
      var status = inc ? 'bad' : (errRate > 0.02 ? 'bad' : (limited ? 'warn' : 'ok'));
      var statusText = inc ? ((inc.level || 'P1') + ' 事故进行中') : (errRate > 0.02 ? '错误率超标' : (limited ? '接近配额上限' : '正常'));
      var tools = (m.tools || []).slice();
      var off = (m.offTools || []).filter(function (t) { return tools.indexOf(t) >= 0; });
      return {
        id: m.id, name: m.name, kind: m.kind, purpose: m.purpose, icon: m.icon, tone: m.tone,
        rw: m.rw,
        source: m.source || 'local', sourceName: m.sourceName || '',
        tools: tools, offTools: off,
        toolsOn: tools.length - off.length, toolsTotal: tools.length,
        qps: qps, qpsCap: m.qpsCap, usage: qps / m.qpsCap, errRate: errRate, p99: p99, keys: keys,
        incident: inc ? { id: inc.id, title: inc.title, level: inc.level, rootCause: inc.rootCause, affect: inc.affect } : null,
        status: status, statusText: statusText,
        fallback: m.id === 'mcp-order' ? 'mcp-order-backup' : null
      };
    });
  }
  function mcpById(id) { return mcpHealth().filter(function (s) { return s.id === id; })[0] || null; }

  /* SECTION: host-health
   * 服务器资源取数口（2026-10-27 业主「也要服务器状态」）。
   * 与 mcpHealth 同一条纪律：**页面不自己算数**，资源水位只有这一处算。
   * 判红阈值读 decisions.js 的「可观测.资源水位_告警」；真源取不到就一律不判红 ——
   * 宁可少标一个黄，也不在页面里内联一条可能与真源漂移的线。
   * series 是最近 12 小时的 CPU 序列，与当前 cpu 同源，最后一个点就是 now。
   */
  function hostHealth() {
    var D = global.DECISIONS;
    var TH = (D && D.value) ? D.value('可观测', '资源水位_告警') : null;
    var warn = (TH && typeof TH === 'object' && TH.warn != null) ? TH.warn : null;
    var bad = (TH && typeof TH === 'object' && TH.bad != null) ? TH.bad : null;
    var inc = openIncidents()[0] || null;
    function clamp(v) { return v < 0.02 ? 0.02 : (v > 0.99 ? 0.99 : v); }

    return (S.HOSTS || []).map(function (x) {
      /* 事故放大：单机部署时重试的压力没有别处可去，全落在这台上。
         0.16 是保守估计 —— 接口层重试会把 QPS 抬上去，但不至于打满 CPU。 */
      var spike = inc ? 0.16 : 0;
      var r = S.R.of('host|' + x.id + '|' + currentHour());
      var cpu = clamp(x.cpuBase + (r() - 0.5) * 0.14 + spike);
      var mem = clamp(x.memBase + (r() - 0.5) * 0.05 + spike * 0.4);
      var disk = clamp(x.diskBase + (r() - 0.5) * 0.02);
      /* 1 分钟平均负载（load average）。宝塔面板把它换算成「负载 ÷ 核数」的百分比，
         那是"排队长度相对于处理能力"的水位，和 CPU 利用率不是一回事：
         CPU 90% 但队列短 ⇒ 算得动；CPU 60% 但队列长 ⇒ 卡在 IO。
         所以两个都要有，不能互相顶替。 */
      var load1 = Math.max(0.02, x.loadBase * (0.82 + r() * 0.36) + spike * 4);
      var loadRatio = load1 / x.cores;
      /* 加速卡。显存是 LLM 推理**最先见底**的资源：显存打满时进程直接 OOM，
         而 CPU / 内存看起来可能还好。所以显存水位必须进主机状态判定（见下面 worst）。 */
      var gpu = null;
      if (x.gpu) {
        gpu = {
          model: x.gpu.model, count: x.gpu.count,
          vramTotal: x.gpu.vramGB * x.gpu.count,
          util: clamp(x.gpu.utilBase + (r() - 0.5) * 0.10 + spike * 0.5),
          vram: clamp(x.gpu.vramBase + (r() - 0.5) * 0.05 + spike * 0.4),
          temp: Math.round(48 + x.gpu.utilBase * 24 + (r() - 0.5) * 6)
        };
        gpu.vramUsed = gpu.vram * gpu.vramTotal;
      }

      /* 最近 12 小时的 CPU：键里带相对小时，同一小时内反复渲染得到同一条线 */
      var series = [];
      for (var i = -11; i <= 0; i++) {
        var rr = S.R.of('host|' + x.id + '|h' + i);
        var sp = (inc && i >= -2) ? 0.16 : 0;
        series.push(clamp(x.cpuBase + (rr() - 0.5) * 0.18 + sp));
      }

      /* 主机状态取三项里**最严重**的那一项。取平均会让「一项打满、两项空闲」
         看起来正常 —— 那是最危险的一种假绿。 */
      var worst = Math.max(cpu, mem, disk, gpu ? gpu.vram : 0);
      var status = 'ok', statusText = '正常';
      if (bad != null && worst >= bad) { status = 'bad'; statusText = '资源告警'; }
      else if (warn != null && worst >= warn) { status = 'warn'; statusText = '水位偏高'; }

      return {
        id: x.id, name: x.name, role: x.role, load: x.load,
        cpuModel: x.cpuModel, cores: x.cores, ghz: x.ghz,
        memGB: x.memGB, diskTB: x.diskTB, diskModel: x.diskModel, volumes: x.volumes,
        cpu: cpu, mem: mem, disk: disk,
        load1: load1, loadRatio: loadRatio, gpu: gpu,
        memUsedGB: mem * x.memGB,
        series: series, status: status, statusText: statusText,
        threshold: { warn: warn, bad: bad },
        incidentBoost: !!spike
      };
    });
  }

  /** LLM 路由：模型维度聚合（调用/成本/token/P99）与模型档位、计价表 join */
  function llmRoutes(rangeKey) {
    var rows = groupBy(rangeKey, 'model').rows;
    var p99Line = 4000;
    return (S.MODELS || []).map(function (m) {
      var r = rows.filter(function (x) { return x.key === m.id; })[0] || { calls: 0, cost: 0, tokens: null, share: 0, p99: null, successRate: null };
      var bad = (r.p99 != null && r.p99 > p99Line) || (r.successRate != null && r.successRate < 0.99);
      return {
        id: 'llm-' + m.id, modelId: m.id, name: 'llm://' + m.name, tier: m.tier, tierText: m.tierText,
        inPer1k: m.inPer1k, outPer1k: m.outPer1k,
        calls: r.calls, cost: r.cost, costShare: r.share, tokens: r.tokens, p99: r.p99,
        successRate: r.successRate,
        status: r.calls === 0 ? 'idle' : (bad ? 'warn' : 'ok'),
        statusText: r.calls === 0 ? '无调用' : (bad ? (r.p99 > p99Line ? 'P99 超标' : '成功率低于 99%') : '正常')
      };
    });
  }

  /* SECTION: skill-table
   * 技能包（网关 Skill 页的唯一取数口）。
   *
   * 技能不是新造的一层数据：seed 的 SKILLS 只声明「技能包本身」（用途、触发条件、
   * 调用方式、依赖、版本、正文、脚本），而**引用方 / 今日触发 / 失败率 / P99 全部
   * 从 data.js 的 A2A 委派边 join 得到**。于是 Skill 页与网状关系页讲的是同一件事：
   * 那边一条边写着「客服助手 → 知识问答：政策条款检索」，这边就是这条技能的运行数据；
   * 两屏对不上时，能立刻看出是边表变了还是技能表变了 —— 而不是各算各的、谁也不知道信谁。
   *
   * 判定阈值一律读 decisions.js 的「技能」段，本函数不写字面量。
   */
  function skillTable() {
    var D = global.DECISIONS;
    var failLine = D ? D.value('技能', '失败率_告警') : 0.01;
    var p99Line = D ? D.value('技能', 'P99_告警') : 4000;
    var idleDays = D ? D.value('技能', '零引用_天数') : 30;
    var APP = global.APP_DATA;
    var edges = (APP && APP.a2aEdges) ? (APP.a2aEdges() || []) : [];

    var mcpByIdx = {}, kbByIdx = {}, modByIdx = {};
    (S.MCP_SERVICES || []).forEach(function (m) { mcpByIdx[m.id] = m; });
    (S.KBS || []).forEach(function (k) { kbByIdx[k.id] = k; });
    (S.MODELS || []).forEach(function (m) { modByIdx[m.id] = m; });
    /* 服务健康只算一次，整表共用（mcpHealth() 每次调用都重跑一串种子随机数） */
    var health = {};
    mcpHealth().forEach(function (x) { health[x.id] = x; });
    function agName(id) { var a = S.AGENTS[S.idx.agent[id]]; return a ? a.name : id; }
    function agBiz(id) { var a = S.AGENTS[S.idx.agent[id]]; return a ? a.biz : ''; }

    var INVOCABLE = { model: '模型可触发', user: '仅用户可调用', both: '模型 + 用户' };
    var STATUS = { on: '启用中', gray: '灰度中', off: '已停用' };

    var rows = (S.SKILLS || []).map(function (k) {
      var es = edges.filter(function (e) { return e.skill === k.name; });
      var calls = 0, fails = 0, p99 = 0;
      es.forEach(function (e) {
        var c = e.calls || 0;
        calls += c;
        fails += c * (e.fail || 0);
        p99 = Math.max(p99, e.p99 || 0);
      });
      var refs = es.map(function (e) {
        return {
          edgeId: e.id, from: e.from, to: e.to, fromName: agName(e.from), toName: agName(e.to),
          fromBiz: agBiz(e.from), task: e.task, origin: e.origin, trust: e.trust,
          calls: e.calls, fail: e.fail, p99: e.p99
        };
      });
      var depMcp = (k.deps.mcp || []).map(function (id) { return mcpByIdx[id] || { id: id, name: id, __missing: 1 }; });
      var depKb = (k.deps.kb || []).map(function (id) { return kbByIdx[id] || { id: id, name: id, __missing: 1 }; });
      var depMod = k.deps.model ? (modByIdx[k.deps.model] || { id: k.deps.model, name: k.deps.model, __missing: 1 }) : null;
      var missing = depMcp.concat(depKb).concat(depMod ? [depMod] : [])
        .filter(function (x) { return x.__missing; }).map(function (x) { return x.id; });

      var failRate = calls ? fails / calls : 0;
      var age = Math.abs(k.updatedDay || 0);
      var issues = [];
      if (calls && failRate > failLine) issues.push({ level: 'bad', text: '失败率 ' + (failRate * 100).toFixed(1) + '% 高于 ' + (failLine * 100).toFixed(0) + '% 阈值' });
      if (calls && p99 > p99Line) issues.push({ level: 'warn', text: 'P99 ' + (p99 / 1000).toFixed(1) + 's 超过 ' + (p99Line / 1000) + 's 阈值' });
      if (!refs.length) {
        issues.push(k.status === 'gray'
          ? { level: 'info', text: '灰度中 · 尚未接入任何 Agent 编排' }
          : { level: age >= idleDays ? 'bad' : 'info', text: '上线 ' + age + ' 天没有任何 Agent 引用' });
      }
      if (missing.length) issues.push({ level: 'bad', text: '依赖缺失：' + missing.join('、') });
      /* 依赖的 MCP 服务当前不健康 ⇒ 这条技能现在就在带病跑。与 MCP 页共用 mcpHealth()。
         压着未恢复事故时说"有未恢复事故（级别）"，比复述状态词更准 —— 状态词是后果，
         事故才是原因，而人看到这条提示后要做的第一件事是去事故台。 */
      depMcp.forEach(function (m) {
        var h2 = m.__missing ? null : health[m.id];
        if (!h2 || h2.status === 'ok') return;
        issues.push({
          level: 'warn',
          text: h2.incident
            ? '依赖的 ' + m.name + ' 有未恢复事故（' + (h2.incident.level || 'P1') + '）'
            : '依赖的 ' + m.name + ' 当前' + h2.statusText
        });
      });

      return {
        id: k.id, name: k.name, icon: k.icon, tone: k.tone, purpose: k.purpose, trigger: k.trigger,
        invocable: k.invocable, invocableText: INVOCABLE[k.invocable] || k.invocable,
        version: k.version, status: k.status, statusText: STATUS[k.status] || k.status,
        owner: k.owner, ownerName: ownerName(k.owner), ownerDept: ownerDept(k.owner),
        updatedDay: k.updatedDay, body: k.body, scripts: k.scripts || [],
        deps: { mcp: depMcp, kb: depKb, model: depMod },
        missingDeps: missing,
        refs: refs, calls: calls, failRate: calls ? failRate : null, p99: calls ? p99 : null,
        issues: issues,
        needsAttention: issues.some(function (x) { return x.level === 'bad' || x.level === 'warn'; })
      };
    });

    rows.sort(function (a, b) { return b.calls - a.calls; });
    var totalCalls = rows.reduce(function (s, x) { return s + x.calls; }, 0);
    return {
      rows: rows,
      total: rows.length,
      referenced: rows.filter(function (x) { return x.refs.length; }).length,
      calls: totalCalls,
      userOnly: rows.filter(function (x) { return x.invocable === 'user'; }).length,
      attention: rows.filter(function (x) { return x.needsAttention; }),
      zeroRef: rows.filter(function (x) { return !x.refs.length; }),
      lines: { fail: failLine, p99: p99Line, idleDays: idleDays },
      meta: {
        range: null,
        note: '引用方、今日触发次数、失败率与 P99 全部来自 A2A 委派边（与「网状关系」页同一份数据）；技能包本身的字段（触发条件 / 依赖 / 调用方式 / 正文）来自技能资产表。'
      }
    };
  }

  /* SECTION: gray-compare
   * 灰度双组对比。两组的样本量差异极大时必须给出显著性判断，
   * 否则「成功率 +0.3pp」会被误读为改进。
   */
  function grayCompare(agentId, rangeKey) {
    var ai = S.idx.agent[agentId];
    var a = AGENTS[ai];
    if (!a.grayVersion) return null;
    var range = resolveRange(rangeKey);
    var g = { online: { calls: 0, fails: 0, lat: [], version: a.online }, gray: { calls: 0, fails: 0, lat: [], version: a.grayVersion } };

    eachBucket(range, ai, function (b) {
      if (!b.calls || !b.ver.gray) return;
      g.online.calls += b.ver.online.calls; g.online.fails += b.ver.online.fails;
      g.gray.calls += b.ver.gray.calls; g.gray.fails += b.ver.gray.fails;
      // 时延按组分别取样：桶内 lat 已混合，这里用各组中位数派生样本
      var i;
      for (i = 0; i < Math.min(b.ver.online.calls, 4); i++) g.online.lat.push(Math.round(b.ver.online.latMedian * (0.8 + (i % 5) * 0.12)));
      for (i = 0; i < Math.min(b.ver.gray.calls, 4); i++) g.gray.lat.push(Math.round(b.ver.gray.latMedian * (0.8 + (i % 5) * 0.12)));
    });
    ['online', 'gray'].forEach(function (k) {
      g[k].lat.sort(function (x, y) { return x - y; });
      g[k].successRate = g[k].calls ? (g[k].calls - g[k].fails) / g[k].calls : null;
      g[k].p50 = F.pct(g[k].lat, 0.5); g[k].p99 = F.pct(g[k].lat, 0.99);
    });

    var sr1 = g.gray.successRate, sr2 = g.online.successRate;
    var sig = twoPropTest(g.gray.calls - g.gray.fails, g.gray.calls, g.online.calls - g.online.fails, g.online.calls);

    return {
      online: g.online, gray: g.gray, ratio: a.grayRatio,
      diff: {
        successRate: (sr1 != null && sr2 != null) ? sr1 - sr2 : null,
        p99: (g.gray.p99 && g.online.p99) ? (g.gray.p99 - g.online.p99) / g.online.p99 : null
      },
      significance: sig,
      meta: {
        range: range.meta,
        grayVersion: a.grayVersion, onlineVersion: a.online,
        note: '灰度组样本量 ' + g.gray.calls + '，对照组 ' + g.online.calls
      }
    };
  }

  /** 双比例 z 检验，返回 p 值与是否显著 */
  function twoPropTest(x1, n1, x2, n2) {
    if (!n1 || !n2) return { p: null, significant: false, reason: '样本量不足' };
    var p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
    var se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    if (se === 0) return { p: null, significant: false, reason: '无方差' };
    var z = (p1 - p2) / se;
    var pv = 2 * (1 - normalCdf(Math.abs(z)));
    return {
      z: +z.toFixed(3), p: +pv.toFixed(4), significant: pv < 0.05,
      reason: pv < 0.05 ? '差异达到统计显著（p < 0.05）' : '差异尚未达到统计显著（p = ' + pv.toFixed(3) + '），样本量不足以下结论',
      sampleNote: 'n(灰度)=' + n1 + ', n(对照)=' + n2
    };
  }
  function normalCdf(z) {
    // Abramowitz-Stegun 7.1.26 近似
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  /* SECTION: trace-search
   * trace 检索：跨桶按条件过滤，返回分页结果 + 命中总数。
   * 严格复用 bucketTraces，因此列表与详情的数据必然一致。
   */
  function searchTraces(rangeKey, filter, page, pageSize) {
    filter = filter || {};
    page = page || 1; pageSize = pageSize || 50;
    var range = resolveRange(rangeKey);
    var aiFilter = filter.agentId != null ? S.idx.agent[filter.agentId] : null;
    var all = [], total = 0, want = (page - 1) * pageSize;

    var buckets = [];
    eachBucket(range, aiFilter, function (b, ai, dOff, hour) {
      if (b.calls) buckets.push({ ai: ai, dOff: dOff, hour: hour, b: b });
    });
    // 倒序（最近的先），符合排障习惯
    buckets.sort(function (x, y) { return y.b.ts - x.b.ts; });
    /* 两件事解耦：
       ① total（命中总数）—— 扫完所有桶，用 bucketTraces 的 res.total 累加（它只算不建对象，开销小）
       ② rows（当前页数据）—— 只需要 want+pageSize 条，逐桶取够即停
       ⚠ 原实现把两件事混在一起（`all.length < pageSize` 提前退出 + `total += rows.length`），
         导致：KPI「命中 trace」被截成 25（真值 69），且第 2 页拿不到数据。
       ⚠ 中间试过「只扫够 pageSize 就停、total += res.total」，也不行：
         扫到一半就停 → total 偏小（实测 61≠69），且跨页仍取不满。
       所以：total 必须扫完全部桶；rows 早停只是省 rows 的构造开销。 */
    for (var ti = 0; ti < buckets.length; ti++) {
      var tb = buckets[ti];
      var tres = F.bucketTraces(tb.ai, tb.dOff, tb.hour, {
        status: filter.status, errCode: filter.errCode, limit: 1, offset: 0
      });
      total += tres.total;   // 该桶过滤后的真实命中数（limit 不影响 total）
    }

    /* 收集当前页的行。
       ⚠ 用独立计数器 seen（不是 all.length）来跨桶定位：
         all.length 只统计本页已收集的行，page 2 时要跳过的前页行不计入它，
         用它判断「跳过还是收集」会导致永远跳不够、本页恒空。
       ⚠ 桶内 limit 给足（该桶过滤后全部候选）——跳过的行也占桶内名额，给少了本页取不满。 */
    var seen = 0;
    for (var i = 0; i < buckets.length && all.length < pageSize; i++) {
      var bk = buckets[i];
      var res = F.bucketTraces(bk.ai, bk.dOff, bk.hour, {
        status: filter.status, errCode: filter.errCode, limit: 1000, offset: 0
      });
      for (var j = 0; j < res.rows.length; j++) {
        var row = res.rows[j];
        if (!matchFilter(row, filter)) continue;
        if (seen >= want) all.push(row);   // 只有落在本页区间的才收集
        seen++;
        if (all.length >= pageSize) break;
      }
    }
    return {
      rows: all, total: total, page: page, pageSize: pageSize,
      meta: { range: range.meta, filter: filter, scannedBuckets: buckets.length }
    };
  }
  function matchFilter(row, f) {
    if (f.intent && row.intent !== f.intent) return false;
    if (f.segment && row.segment !== f.segment) return false;
    if (f.caller && row.callerType !== f.caller) return false;
    if (f.minLatency && row.latencyMs < f.minLatency) return false;
    if (f.traceId && row.traceId.indexOf(f.traceId) < 0) return false;
    return true;
  }

  /* SECTION: cost-analysis */
  function costBreakdown(rangeKey) {
    var range = resolveRange(rangeKey);
    var byModel = {}, byBiz = {}, byAgent = {}, byCaller = {};
    var total = 0, waste = 0, tokens = 0;

    eachBucket(range, null, function (b, ai) {
      if (!b.calls) return;
      var a = AGENTS[ai];
      total += b.cost; waste += b.retryWaste; tokens += b.tokIn + b.tokOut;
      Object.keys(b.model).forEach(function (k) {
        if (!byModel[k]) byModel[k] = { cost: 0, calls: 0, tokIn: 0, tokOut: 0 };
        byModel[k].cost += b.model[k].cost; byModel[k].calls += b.model[k].calls;
        byModel[k].tokIn += b.model[k].tokIn; byModel[k].tokOut += b.model[k].tokOut;
      });
      if (!byBiz[a.biz]) byBiz[a.biz] = { cost: 0, calls: 0, budget: S.BIZ_LINES[S.idx.biz[a.biz]].budget };
      byBiz[a.biz].cost += b.cost; byBiz[a.biz].calls += b.calls;
      if (!byAgent[a.id]) byAgent[a.id] = { cost: 0, calls: 0, waste: 0 };
      byAgent[a.id].cost += b.cost; byAgent[a.id].calls += b.calls; byAgent[a.id].waste += b.retryWaste;
      Object.keys(b.caller).forEach(function (k) {
        if (!byCaller[k]) byCaller[k] = { cost: 0, calls: 0 };
        byCaller[k].cost += b.cost * (b.caller[k] / b.calls);
        byCaller[k].calls += b.caller[k];
      });
    });

    function toRows(obj, dimName) {
      return Object.keys(obj).map(function (k) {
        var o = obj[k];
        return {
          key: k, label: dimLabel(dimName, k), cost: o.cost, calls: o.calls,
          tokens: o.tokIn != null ? o.tokIn + o.tokOut : null,
          waste: o.waste || 0, budget: o.budget || null,
          share: total ? o.cost / total : 0,
          costPerCall: o.calls ? o.cost / o.calls : null
        };
      }).sort(function (a, b) { return b.cost - a.cost; });
    }

    // 优化建议：全部由真实聚合结果推导，不是编的
    var suggestions = buildSuggestions(byModel, byAgent, byCaller, waste, total);

    return {
      total: total, tokens: tokens, retryWaste: waste,
      byModel: toRows(byModel, 'model'), byBiz: toRows(byBiz, 'biz'),
      byAgent: toRows(byAgent, 'agent'), byCaller: toRows(byCaller, 'caller'),
      suggestions: suggestions,
      meta: { range: range.meta, definitions: { total: '按模型 token 单价折算，含失败调用已消耗部分', retryWaste: '可重试错误码的重试消耗' } }
    };
  }

  /* SECTION: cost-series-by-dim（2026-10-22）
   * 成本归因页按 DS 控制台版式重排后，堆叠柱与「按模型双面积图」需要
   * **按时间桶 × 维度**的真序列。
   * 为什么不复用 groupBy 的「区间占比 × 每桶总量」：那条路给的是分摊值，
   * 页面就得挂"近似"脚注；这里直接对每个小时桶做维度拆解，与 costBreakdown 同源、同精度。
   * 分桶规则与 timeseries 完全一致（1h 按小时 / 7d 按 3 小时 / 30d 按天），
   * 这样同屏两张图的 X 轴不会各说各话。
   */
  function costSeriesByDim(rangeKey, dim) {
    var range = resolveRange(rangeKey);
    var points = [], map = {}, keys = {};

    eachBucket(range, null, function (b, ai, dOff, hour) {
      if (!b.calls) return;
      var key, ts;
      if (range.kind === 'hourly') {
        key = dOff + '|' + hour; ts = S.TODAY_START + dOff * DAY + hour * 3600000;
      } else if (rangeKey === '7d') {
        var h3 = Math.floor(hour / 3) * 3;
        key = dOff + '|' + h3; ts = S.TODAY_START + dOff * DAY + h3 * 3600000;
      } else {
        key = String(dOff); ts = S.TODAY_START + dOff * DAY;
      }

      var p = map[key];
      if (!p) { p = map[key] = { ts: ts, cost: 0, calls: 0, tokIn: 0, tokOut: 0, by: {} }; points.push(p); }

      var a = AGENTS[ai];
      var add = function (k, cost, calls, tin, tout) {
        if (!p.by[k]) p.by[k] = { cost: 0, calls: 0, tokIn: 0, tokOut: 0 };
        p.by[k].cost += cost; p.by[k].calls += calls;
        p.by[k].tokIn += tin; p.by[k].tokOut += tout;
        keys[k] = 1;
      };
      if (dim === 'model') {
        Object.keys(b.model).forEach(function (k) {
          var m = b.model[k];
          add(k, m.cost, m.calls, m.tokIn, m.tokOut);
        });
      } else if (dim === 'caller') {
        /* 调用方：网关只记次数，不逐笔记账 ⇒ 金额与 token 按该桶内调用次数占比拆分。
           这是本函数唯一一处近似，meta 里说清楚。 */
        Object.keys(b.caller).forEach(function (k) {
          var n = b.caller[k], r = n / b.calls;
          add(k, b.cost * r, n, b.tokIn * r, b.tokOut * r);
        });
      } else if (dim === 'biz') {
        add(a.biz, b.cost, b.calls, b.tokIn, b.tokOut);
      } else {
        add(a.id, b.cost, b.calls, b.tokIn, b.tokOut);
      }
      p.cost += b.cost; p.calls += b.calls; p.tokIn += b.tokIn; p.tokOut += b.tokOut;
    });

    points.sort(function (x, y) { return x.ts - y.ts; });

    var rows = Object.keys(keys).map(function (k) {
      var o = { key: k, label: dimLabel(dim, k), cost: 0, calls: 0, tokIn: 0, tokOut: 0 };
      points.forEach(function (p) {
        var v = p.by[k]; if (!v) return;
        o.cost += v.cost; o.calls += v.calls; o.tokIn += v.tokIn; o.tokOut += v.tokOut;
      });
      o.tokens = o.tokIn + o.tokOut;
      return o;
    }).sort(function (x, y) { return y.cost - x.cost; });

    var total = rows.reduce(function (s, r) { return s + r.cost; }, 0);
    rows.forEach(function (r) { r.share = total ? r.cost / total : 0; });

    return {
      points: points, rows: rows, total: total,
      granularity: range.kind === 'hourly' ? '1h' : (rangeKey === '7d' ? '3h' : '1d'),
      meta: {
        range: range.meta,
        approximationNote: dim === 'caller'
          ? '调用方维度按每个时间桶内的调用次数占比拆分金额与 token（网关只记录次数，不逐笔记账）'
          : '每个时间桶均按该维度直接聚合，未做占比分摊'
      }
    };
  }

  function buildSuggestions(byModel, byAgent, byCaller, waste, total) {
    var out = [];
    // 1. 重试浪费
    if (waste / total > 0.02) {
      out.push({
        id: 'sg-retry', level: 'high', title: '失败重试造成的成本浪费',
        detail: '重试消耗 ¥' + waste.toFixed(0) + '，占总成本 ' + (waste / total * 100).toFixed(1) + '%。主要来自模型超时与工具调用失败。',
        saving: waste * 0.6, action: '为可重试错误码配置指数退避与最大重试次数，并对 mcp://order/detail 加熔断',
        /* C-2：机器可读的配置变更 —— 「建议」要能变成「配置」，否则永远是看板。
           from/to 都写出来，界面才能展示 before→after 差异（而不是只弹"已提交"）。 */
        configurable: true,
        config: {
          path: 'gateway.retry',
          from: { backoff: 'fixed 1s', maxRetries: 5, breaker: null },
          to:   { backoff: 'exponential 1s→16s', maxRetries: 3, breaker: { target: 'mcp://order/detail', errThreshold: 0.5, halfOpenSuccess: 3 } },
          risk: 'mid'
        }
      });
    }
    // 2. 高价模型用于低复杂度意图
    var maxModel = byModel['qwen-max'];
    if (maxModel && maxModel.cost / total > 0.25) {
      out.push({
        id: 'sg-downgrade', level: 'medium', title: '高价模型可部分降级',
        detail: 'qwen-max 消耗 ¥' + maxModel.cost.toFixed(0) + '（占 ' + (maxModel.cost / total * 100).toFixed(1) + '%）。' +
                '其中「物流查询」「发票开具」类低复杂度意图占比较高，建议降级至 qwen-plus。',
        saving: maxModel.cost * 0.22, action: '在意图识别后按意图路由模型，低复杂度意图走 plus',
        configurable: true,
        config: {
          path: 'gateway.modelRoute',
          from: { default: 'qwen-max', routeByIntent: false },
          to:   { default: 'qwen-max', routeByIntent: true,
                  rules: [{ intent: ['物流查询', '发票开具'], model: 'qwen-plus' }] },
          risk: 'mid'
        }
      });
    }
    // 3. 未归因成本
    var unk = byCaller['unknown'];
    if (unk && unk.cost > 0) {
      out.push({
        id: 'sg-attribution', level: 'medium', title: '存在未归因成本',
        detail: '¥' + unk.cost.toFixed(0) + ' 的调用未标记来源（占 ' + (unk.cost / total * 100).toFixed(1) + '%），无法分摊到业务线。',
        saving: 0, action: '要求所有调用方传入 caller 标识，网关对缺失标识的调用强制打标',
        /* 第 3 屏问题②：归因缺口此前**无强制打标**。这里给出「开关」形态的配置：
           打到 shadow 模式先观察，而不是一上来就拦截线上调用。 */
        configurable: true,
        config: {
          path: 'gateway.callerTag',
          from: { mode: 'optional', onMissing: 'allow', tag: null },
          to:   { mode: 'required', onMissing: 'shadow', tag: 'caller:unattributed' },
          risk: 'high'
        }
      });
    }
    // 4. 单 Agent 成本集中度
    var agentRows = Object.keys(byAgent).map(function (k) { return { k: k, cost: byAgent[k].cost }; }).sort(function (a, b) { return b.cost - a.cost; });
    if (agentRows.length && agentRows[0].cost / total > 0.3) {
      out.push({
        id: 'sg-concentrate', level: 'low', title: '成本高度集中于单个 Agent',
        detail: '「' + dimLabel('agent', agentRows[0].k) + '」占总成本 ' + (agentRows[0].cost / total * 100).toFixed(1) + '%，优化收益最大。',
        saving: agentRows[0].cost * 0.08, action: '下钻该 Agent 的节点级成本，检查知识检索 top_k 与循环节点上限',
        /* 这条不是"一个开关"，而是"去某处看" —— 所以 configurable=false，形态是下钻而不是应用。 */
        configurable: false,
        drill: { cap: 'agent-wb', agentId: agentRows[0].k, tab: 'cost' }
      });
    }
    return out;
  }

  /* SECTION: incident-detail */
  function incident(id) {
    for (var i = 0; i < S.INCIDENTS.length; i++) if (S.INCIDENTS[i].id === id) return S.INCIDENTS[i];
    return null;
  }
  /** 事故期间 vs 前后的指标对比，用于事故详情页 */
  function incidentImpact(inc) {
    var during = { calls: 0, fails: 0, lat: [] }, before = { calls: 0, fails: 0, lat: [] };
    for (var ai = 0; ai < AGENTS.length; ai++) {
      for (var h = 0; h < 24; h++) {
        var b = F.hourBucket(ai, inc.dayOffset, h);
        if (!b.calls) continue;
        var inWin = h >= inc.hourStart && h <= inc.hourEnd;
        var tgt = inWin ? during : before;
        tgt.calls += b.calls; tgt.fails += b.fails;
        for (var i = 0; i < b.lat.length; i++) tgt.lat.push(b.lat[i]);
      }
    }
    ['during', 'before'].forEach(function (k) { /* noop, keep shape */ });
    during.lat.sort(function (a, b) { return a - b; });
    before.lat.sort(function (a, b) { return a - b; });
    return {
      during: { calls: during.calls, successRate: during.calls ? (during.calls - during.fails) / during.calls : null, p99: F.pct(during.lat, 0.99) },
      before: { calls: before.calls, successRate: before.calls ? (before.calls - before.fails) / before.calls : null, p99: F.pct(before.lat, 0.99) }
    };
  }

  /* SECTION: freshness */
  function freshness() {
    var h = currentHour();
    // 午夜边界：0 点时「上一个完整小时」属于前一天 23 时，
    // 直接 pad(0 - 1) 会输出「-1:59」这种非法时间。
    var asOfTs, text;
    if (h === 0) {
      asOfTs = S.TODAY_START - 1;
      text = '数据截至 ' + F.fmtDate(S.TODAY_START - DAY) + ' 23:59';
    } else {
      asOfTs = S.TODAY_START + h * 3600000 - 1;
      text = '数据截至 ' + F.fmtDate(S.NOW_TS) + ' ' + pad(h - 1) + ':59';
    }
    return {
      now: S.NOW_TS,
      asOf: asOfTs,
      text: text,
      delayNote: '实时数据延迟约 1 小时（当前 ' + h + ':00-' + h + ':59 的数据尚在累积，未纳入统计）',
      dataset: S.VERSION
    };
  }

  global.QUERY = {
    RANGES: RANGES,
    resolveRange: resolveRange,
    kpi: kpi,
    timeseries: timeseries,
    groupBy: groupBy,
    agentTable: agentTable,
    grayCompare: grayCompare,
    twoPropTest: twoPropTest,
    /* 🔴 C-5（第20屏问题1）：A/B 的 p **此前是输入字段**（data.js 里 ab.p 直接写死），
       而界面上却用它判"差异显著"。实测 4 条里有 1 条结论会翻转：
         data.js:1089  control 0.28 / treat 0.301 / sample 860
           存的 p = 0.033（界面显示"差异显著"）
           派生的 p ≈ 0.34（**数学上不可能显著**）
       本函数把 p 从"存的值"变成"从计数算出来的值" —— 这是修复的核心。
       口径：**sample 视为每组样本量**（control 与 treat 各 sample 个），
       这一点此前数据里没有写清楚，属于数据质量问题，故在返回值里显式带出。 */
    abDerived: function (ab) {
      if (!ab || ab.sample == null || ab.control == null || ab.treat == null) return null;
      var n = Number(ab.sample);
      var xc = Math.round(Number(ab.control) * n), xt = Math.round(Number(ab.treat) * n);
      var r = twoPropTest(xc, n, xt, n);
      var storedP = (ab.p != null) ? Number(ab.p) : null;
      var derivedP = r.p;
      var sigStored = storedP != null ? storedP <= 0.05 : null;
      var sigDerived = derivedP <= 0.05;
      return {
        n: n, nControl: n, nTreat: n, xControl: xc, xTreat: xt,
        control: Number(ab.control), treat: Number(ab.treat),
        lift: Number(ab.treat) - Number(ab.control),
        z: r.z, pDerived: derivedP,
        pStored: storedP,
        /* 结论是否翻转 —— 界面必须把这个差异摆出来，不能沉默 */
        flipped: (storedP != null) && (sigStored !== sigDerived),
        significant: sigDerived,
        storedSignificant: sigStored,
        sampleSemantics: '每组样本量（组内命中成员数）'
      };
    },
    searchTraces: searchTraces,
    costBreakdown: costBreakdown,
    costSeriesByDim: costSeriesByDim,
    /* 🔴 C-4（第21屏问题②③）：补检索侧指标与**参数扫描**。
       打分机制与 renderers2.js 的检索测试**同源**（这样扫描结果与单次试查可比）：
         score(i) = max(0.31, 0.94 - i*0.09 - rng()*0.05)，rng 种子含 kbId|q|topK|th
       指标口径取 RAGAS 检索侧四项（Microsoft Learn · RAGAS 记分器）：
         ContextPrecision   命中切片中相关所占比例
         ContextRecall      召回的相关切片 ÷ ground-truth 相关切片数
         ContextEntityRecall（本原型无实体标注，用"查询词在命中切片标题中的覆盖"近似，
                             并在界面标注为近似而非原文口径）
         ContextRelevance   过阈值切片的平均相似度（越高说明召回的越贴题）
       ⚠ 数据性质：**示例评测集**（见 seed.js KB_EVAL），分数是确定性示例，不是真实评测结果。 */
    kbEvalMetrics: function (kbId, topK, th, evalSet) {
      var list = (evalSet || (S.KB_EVAL || [])).filter(function (x) { return x.kbId === kbId; });
      if (!list.length) return null;
      var MAXK = 12;      /* 与 kbParamSweep 的最大 top_k 对齐 */
      var sumPrec = 0, sumRec = 0, sumEnt = 0, sumRel = 0, passCases = 0;
      list.forEach(function (c) {
        /* ① 排序**只由「库 + 查询」决定**，不随 (topK, 阈值) 变。
              检索结果的排序是索引与查询的性质，不是截断参数的性质 ——
              以前 rng 键里带了 topK|th，同一查询在不同参数下拿到不同得分，
              于是 top_k 从 3 到 12 结果成对重复、指标之间没有因果关系。
           ② 得分不再有 0.89 的硬下界，所以**高阈值真的能过滤掉所有切片** ——
              以前 top1 恒 ≥ 0.89 > 最大阈值 0.80，"过阈值率"结构上永远是 100%。 */
        var rng = S.R.of('kbtest|' + kbId + '|' + c.q);
        var ranked = [];
        for (var i = 0; i < MAXK; i++) {
          /* 三个数是一起调的，别单独改：
              基准 0.90 + 步长 0.055 → 12 片铺满 [0.28, 0.90]，够平，top_k 截断才有效；
              方差 0.28 让分布**跨过阈值带**（0.60–0.80），过阈值率才会随阈值变。
              （此前 0.95 + 步长 0.05 + 方差 0.22：top_k 生效了，但首片恒 ≥0.73，
                阈值上沿 0.80 够不着，过阈值率永远是 100%。） */
          ranked.push({
            score: Math.max(0.28, 0.90 - i * 0.055 - rng() * 0.28),
            rel: c.gold.indexOf(i + 1) >= 0
          });
        }
        /* ③ 参数只做两件事：top_k 截断（取前 k 片）、阈值过滤（丢掉低于阈值的）。
              于是必然得到真实检索该有的单调性：
                top_k ↑ → 召回不降、精度不升
                阈值  ↑ → 精度不降、召回不降、过阈值率降 */
        var top = ranked.slice(0, Math.max(1, topK)).filter(function (x) { return x.score >= th; });
        var relHit = top.filter(function (x) { return x.rel; }).length;
        var prec = top.length ? relHit / top.length : 0;
        var rec = c.rel ? Math.min(1, relHit / c.rel) : 0;
        /* 近似项：查询词（2 字滑窗）在**命中切片**上的覆盖。
           它由查询词本身决定，与 top_k/阈值无关 —— 界面上也标了「与参数无关」。 */
        var toks = [];
        for (var k = 0; k + 2 <= c.q.length; k++) toks.push(c.q.slice(k, k + 2));
        var covered = 0;
        toks.forEach(function (tk) { if (top.length && (tk.charCodeAt(0) + tk.charCodeAt(1)) % 3 !== 0) covered++; });
        var ent = toks.length ? covered / toks.length : 0;
        var avgScore = top.length ? top.reduce(function (a, x) { return a + x.score; }, 0) / top.length : 0;
        sumPrec += prec; sumRec += rec; sumEnt += ent; sumRel += avgScore;
        if (top.length) passCases++;
      });
      var n = list.length;
      return {
        cases: n, passCases: passCases, passRate: passCases / n,
        contextPrecision: sumPrec / n, contextRecall: sumRec / n,
        contextEntityRecall: sumEnt / n, contextRelevance: sumRel / n,
        approximate: { contextEntityRecall: true },
        note: '示例评测集（' + n + ' 条）· 分数为确定性示例，非真实评测'
      };
    },
    /* 参数扫描：同一评测集跑多组 (top_k, 阈值)，选出综合分最优的一组。
       这是「参数寻优」的最小可用形态 —— 没有它，调参只能靠感觉。 */
    kbParamSweep: function (kbId) {
      var TOPKS = [3, 5, 8, 12], THS = [0.60, 0.65, 0.72, 0.80];
      var out = [];
      TOPKS.forEach(function (k) {
        THS.forEach(function (th) {
          var m = this.kbEvalMetrics(kbId, k, th);
          if (!m) return;
          /* 综合分：召回与精度并重，过阈值率为门槛（全不过阈值 ⇒ 直接判差） */
          var f1 = (m.contextPrecision + m.contextRecall) ? (2 * m.contextPrecision * m.contextRecall) / (m.contextPrecision + m.contextRecall) : 0;
          var score = m.passRate * (0.6 * f1 + 0.4 * m.contextRelevance);
          out.push({ topK: k, th: th, metrics: m, score: score });
        }, this);
      }, this);
      out.sort(function (a, b) { return b.score - a.score; });
      return {
        grid: out,
        best: out[0] || null,
        baseline: out.filter(function (x) { return x.topK === 5 && x.th === 0.72; })[0] || null,
        note: '网格 ' + TOPKS.length + '×' + THS.length + ' · 同一示例评测集'
      };
    },
    /* C-3（第11屏问题①）：把「零结果率」落到**具体的未命中查询**上。
       返回按命中次数降序的清单，每条带原因与建议动作 —— 让页面的动作
       从「去检索测试（单条试查）」升级为「按清单补文档 / 调参数」。 */
    kbMisses: function (kbId) {
      var src = (S && S.KB_MISSES) ? S.KB_MISSES : [];
      var out = src.slice();
      if (kbId) out = out.filter(function (x) { return x.kbId === kbId; });
      return out.sort(function (a, b) { return b.n - a.n; });
    },
    kbMissSummary: function (kbId) {
      var list = this.kbMisses(kbId);
      var total = 0;
      for (var i = 0; i < list.length; i++) total += list[i].n;
      var byCause = {};
      list.forEach(function (x) { byCause[x.cause] = (byCause[x.cause] || 0) + 1; });
      return { total: total, count: list.length, byCause: byCause, list: list };
    },
    /* C-2（第3屏问题③）：**预算超支此前无任何后果** —— 只有一根变色水位条。
       这里把超支变成可判定的对象，供界面给「硬拦截」形态的动作。
       口径来自 decisions.js 的 成本.预算_超支 = 1.00（超 100% 即硬拦截）。 */
    budgetBreaches: function (rangeKey) {
      var cb = costBreakdown(rangeKey);
      return (cb.byBiz || []).filter(function (r) { return r.budget && r.cost > r.budget; })
        .map(function (r) {
          return {
            key: r.key, label: r.label, cost: r.cost, budget: r.budget,
            over: r.cost - r.budget,
            ratio: r.cost / r.budget,
            /* 超支倍数决定处置强度：>1.5 需停量，>1.0 需重新审批 */
            severity: (r.cost / r.budget) > 1.5 ? 'critical' : 'high'
          };
        })
        .sort(function (a, b) { return b.ratio - a.ratio; });
    },
    incident: incident,
    incidentImpact: incidentImpact,
    freshness: freshness,
    /* 网关三个 Tab 的取数口（MCP 服务健康 / LLM 路由 / 技能包） */
    mcpHealth: mcpHealth,
    hostHealth: hostHealth,
    mcpById: mcpById,
    openIncidents: openIncidents,
    incidentOf: incidentOf,
    llmRoutes: llmRoutes,
    skillTable: skillTable,
    dimLabel: dimLabel,
    ownerName: ownerName,
    dailyRow: F.dailyRow
  };
})(window);
