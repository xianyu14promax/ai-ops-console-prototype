/* SECTION: kol-domain
 * 网红营销领域事实层。
 *
 * 设计要点（对应「模拟数据当真数据处理」五条标准）：
 *  1. 主对象是「一次投放决策」，不是达人列表 —— 达人是决策的证据材料。
 *  2. 达人的 reachRate / ctr / cvr / avgOrderValue / roi 全部由历史合作明细聚合而来，
 *     不写死。因此「历史 ROI 4.2」与「预期 ROI」用的是同一套系数，口径一致、可对账。
 *  3. 没有历史合作的达人 → 明确标注「数据不足，无法给出可信预期」，绝不编造数字。
 *  4. 预期带置信区间，区间宽度随样本量变化（合作 1 次的达人区间必然很宽）。
 *  5. 组合方案在预算约束下求解，展示剩余预算与边际收益，可拖预算实时重算。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED;
  var R = S.R, DAY = S.DAY;

  /* SECTION: kol-dimension
   * 达人维度表。只放「客观属性」：粉丝数、报价、平台、类目、客群重合度。
   * 效果类系数一律不放这里 —— 它们必须从明细算，否则就是拍脑袋。
   */
  var KOLS = [
    { id: 'kol-zhou',  name: '科技老周',     platform: '视频',   followers: 860000,  quote: 42000, category: '科技数码', overlap: 0.71, authenticity: 0.94, region: '全国',   owner: 'u104', exclusivity: false },
    { id: 'kol-lin',   name: '小林聊数码',   platform: '短视频', followers: 1200000, quote: 55000, category: '科技数码', overlap: 0.64, authenticity: 0.88, region: '一二线', owner: 'u104', exclusivity: false },
    { id: 'kol-zhi',   name: '职场指南针',   platform: '图文',   followers: 450000,  quote: 18000, category: '职场商务', overlap: 0.58, authenticity: 0.96, region: '一二线', owner: 'u108', exclusivity: false },
    { id: 'kol-zhe',   name: '阿哲的日常',   platform: '短视频', followers: 680000,  quote: 26000, category: '生活泛娱', overlap: 0.33, authenticity: 0.61, region: '全国',   owner: 'u104', exclusivity: false },
    { id: 'kol-mei',   name: '美妆研究所',   platform: '短视频', followers: 2100000, quote: 88000, category: '美妆个护', overlap: 0.22, authenticity: 0.91, region: '一二线', owner: 'u104', exclusivity: true },
    { id: 'kol-qian',  name: '钱工说架构',   platform: '视频',   followers: 320000,  quote: 21000, category: '技术深度', overlap: 0.77, authenticity: 0.97, region: '一二线', owner: 'u102', exclusivity: false },
    { id: 'kol-sun',   name: '孙老板日记',   platform: '图文',   followers: 540000,  quote: 31000, category: '职场商务', overlap: 0.69, authenticity: 0.93, region: '全国',   owner: 'u108', exclusivity: false },
    { id: 'kol-new1',  name: '数码新观察',   platform: '短视频', followers: 180000,  quote: 9000,  category: '科技数码', overlap: 0.52, authenticity: 0.89, region: '下沉',   owner: 'u104', exclusivity: false },
    { id: 'kol-new2',  name: '采购圈老李',   platform: '图文',   followers: 96000,   quote: 7500,  category: '职场商务', overlap: 0.81, authenticity: 0.95, region: '一二线', owner: 'u102', exclusivity: false }
  ];

  /* SECTION: kol-campaigns
   * 历史合作明细 —— 唯一的效果数据来源。
   * 每行是一次真实投放的投入与产出，达人的所有系数都由它聚合。
   * 确定性生成：同一 seed 永远同一份明细。
   */
  var CONTENT_FORMS = [
    { id: 'review', name: '深度评测', cvrMul: 1.35, quoteMul: 1.00, note: '转化最高，适合决策链长的 B2B' },
    { id: 'embed', name: '植入提及', cvrMul: 0.72, quoteMul: 0.62, note: '成本低但转化弱，适合品牌曝光' },
    { id: 'live', name: '直播带货', cvrMul: 1.12, quoteMul: 1.18, note: '即时转化，客单价偏低' },
    { id: 'tutorial', name: '教程演示', cvrMul: 1.48, quoteMul: 1.06, note: '技术类转化最佳，制作周期长' }
  ];

  var CAMPAIGNS = (function () {
    var out = [];
    KOLS.forEach(function (k) {
      var r = R.of('kolcamp|' + k.id);
      // 合作次数按类目重合度与达人成熟度决定：重合度高的更愿意反复合作
      var n = k.overlap > 0.6 ? Math.floor(3 + r() * 4) : (k.overlap > 0.4 ? Math.floor(1 + r() * 3) : Math.floor(r() * 2));
      // 新达人 / 低重合达人可能从未合作
      if (k.id === 'kol-new1') n = 1;
      if (k.id === 'kol-new2') n = 0;
      if (k.id === 'kol-mei') n = 0;
      for (var i = 0; i < n; i++) {
        var form = CONTENT_FORMS[Math.floor(r() * CONTENT_FORMS.length)];
        var dayOffset = -Math.floor(20 + r() * 300);           // 20~320 天前
        var spend = Math.round(k.quote * form.quoteMul * (0.92 + r() * 0.16));
        // 曝光 = 粉丝 × 触达率；触达率受平台、内容形式、粉丝真实性影响
        var baseReach = k.platform === '图文' ? 0.16 : (k.platform === '短视频' ? 0.34 : 0.24);
        var reach = baseReach * k.authenticity * (0.78 + r() * 0.44);
        var exposure = Math.round(k.followers * reach);
        var ctr = (k.overlap * 0.038 + 0.006) * (0.8 + r() * 0.42);   // 重合度越高点击越好
        var clicks = Math.round(exposure * ctr);
        var cvr = (0.021 + k.overlap * 0.034) * form.cvrMul * (0.74 + r() * 0.52);
        var conv = Math.round(clicks * cvr);
        var aov = Math.round((k.category === '职场商务' ? 3200 : (k.category === '技术深度' ? 2600 : 980)) * (0.82 + r() * 0.36));
        var gmv = conv * aov;
        // 粉丝真实性低 → 曝光虚高但转化差，ROI 自然难看（数据自洽，不需要额外编造）
        out.push({
          id: 'cmp-' + k.id + '-' + (i + 1),
          kolId: k.id, kolName: k.name,
          formId: form.id, formName: form.name,
          dayOffset: dayOffset, date: global.FACTS.fmtDate(S.TODAY_START + dayOffset * DAY),
          spend: spend, exposure: exposure, clicks: clicks, conv: conv, aov: aov, gmv: gmv,
          grossMargin: 0.42,
          roi: spend ? (gmv * 0.42) / spend : 0,
          status: 'closed',
          note: i === 0 ? '最近一次合作' : null
        });
      }
    });
    out.sort(function (a, b) { return b.dayOffset - a.dayOffset; });
    return out;
  })();

  /* SECTION: kol-metrics
   * 由明细聚合出达人效果系数。页面显示的每个系数都能点开看它由哪几次合作算出。
   */
  var METRICS_CACHE = Object.create(null);
  function kolMetrics(kolId) {
    if (METRICS_CACHE[kolId]) return METRICS_CACHE[kolId];
    var k = KOLS.filter(function (x) { return x.id === kolId; })[0];
    var cs = CAMPAIGNS.filter(function (c) { return c.kolId === kolId; });
    if (!k) return null;
    if (!cs.length) {
      // 无历史合作：如实标注不可预测，绝不用类目均值冒充该达人的表现
      METRICS_CACHE[kolId] = {
        kol: k, campaigns: [], deals: 0, predictable: false,
        reason: '该达人尚无历史合作记录，无法从数据推导其转化能力。任何预期数字都只能是猜测。',
        reachRate: null, ctr: null, cvr: null, aov: null, roi: null,
        spend: 0, exposure: 0, clicks: 0, conv: 0, gmv: 0,
        confidence: 'none', lastDeal: null
      };
      return METRICS_CACHE[kolId];
    }
    var spend = 0, exposure = 0, clicks = 0, conv = 0, gmv = 0;
    cs.forEach(function (c) { spend += c.spend; exposure += c.exposure; clicks += c.clicks; conv += c.conv; gmv += c.gmv; });
    var rois = cs.map(function (c) { return c.roi; });
    rois.sort(function (a, b) { return a - b; });
    var m = {
      kol: k, campaigns: cs, deals: cs.length, predictable: true,
      reachRate: exposure / k.followers / cs.length,      // 平均单次触达率
      ctr: exposure ? clicks / exposure : 0,
      cvr: clicks ? conv / clicks : 0,
      aov: conv ? Math.round(gmv / conv) : 0,
      grossMargin: 0.42,
      roi: spend ? (gmv * 0.42) / spend : 0,
      roiMedian: rois[Math.floor(rois.length / 2)],
      roiMin: rois[0], roiMax: rois[rois.length - 1],
      spend: spend, exposure: exposure, clicks: clicks, conv: conv, gmv: gmv,
      costPerConv: conv ? spend / conv : null,
      confidence: cs.length >= 5 ? 'high' : (cs.length >= 3 ? 'medium' : 'low'),
      lastDeal: cs.reduce(function (a, b) { return a.dayOffset > b.dayOffset ? a : b; })
    };
    // 置信区间：样本越少区间越宽。用 ROI 的离散度 + 样本量共同决定
    var sd = cs.length > 1 ? Math.sqrt(rois.reduce(function (s, x) { return s + Math.pow(x - m.roi, 2); }, 0) / (cs.length - 1)) : m.roi * 0.45;
    var t = cs.length >= 5 ? 1.96 : (cs.length >= 3 ? 2.35 : 4.30);   // 小样本用更宽的 t 值
    var half = cs.length > 1 ? (t * sd / Math.sqrt(cs.length)) : m.roi * 0.6;
    m.roiLow = Math.max(0, m.roi - half);
    m.roiHigh = m.roi + half;
    m.roiSpread = half;
    METRICS_CACHE[kolId] = m;
    return m;
  }

  /* SECTION: kol-forecast
   * 单个达人的投放预期。每一步都保留中间量，页面上可展开看口径。
   */
  function forecast(kolId, formId) {
    var m = kolMetrics(kolId);
    if (!m) return null;
    if (!m.predictable) {
      return {
        kolId: kolId, name: m.kol.name, predictable: false, reason: m.reason,
        quote: m.kol.quote, formName: null
      };
    }
    var form = CONTENT_FORMS.filter(function (f) { return f.id === (formId || bestForm(kolId)); })[0] || CONTENT_FORMS[0];
    var quote = Math.round(m.kol.quote * form.quoteMul);
    // 触达率按该内容形式相对该达人历史平均做调整
    var formHist = m.campaigns.filter(function (c) { return c.formId === form.id; });
    var reach = m.reachRate * (formHist.length ? 1 : (form.cvrMul > 1 ? 1.05 : 0.95));
    var exposure = Math.round(m.kol.followers * reach);
    var ctr = m.ctr;
    var clicks = Math.round(exposure * ctr);
    var cvr = m.cvr * form.cvrMul / avgFormMul(kolId);   // 归一到该达人的历史平均形式
    var conv = Math.round(clicks * cvr);
    var gmv = conv * m.aov;
    var profit = gmv * m.grossMargin;
    var roi = quote ? profit / quote : 0;
    // 区间等比缩放：本次预期 ROI 相对该达人历史 ROI 的比例，
    // 乘到历史区间上。这样必然满足 low <= 点估计 <= high，
    // 且样本越少（历史区间越宽）本次预期区间也越宽。
    // 早前写成 m.roiLow * profit / (gmv*margin) * quote，多乘一个报价，
    // 会把区间放大到点估计的数千倍 —— 数字看着有区间，实际完全失真。
    var scale = m.roi ? roi / m.roi : 0;
    return {
      kolId: kolId, name: m.kol.name, predictable: true,
      formId: form.id, formName: form.name, formNote: form.note,
      quote: quote,
      reach: reach, exposure: exposure, ctr: ctr, clicks: clicks,
      cvr: cvr, conv: conv, aov: m.aov, gmv: gmv,
      grossMargin: m.grossMargin, profit: profit,
      roi: roi,
      roiLow: m.roiLow * scale,
      roiHigh: m.roiHigh * scale,
      confidence: m.confidence, deals: m.deals,
      costPerConv: conv ? quote / conv : null,
      overlap: m.kol.overlap, authenticity: m.kol.authenticity,
      steps: [
        { k: '预期曝光', v: exposure, formula: '粉丝 ' + m.kol.followers.toLocaleString('zh-CN') + ' × 触达率 ' + (reach * 100).toFixed(1) + '%' },
        { k: '预期点击', v: clicks, formula: '曝光 ' + exposure.toLocaleString('zh-CN') + ' × CTR ' + (ctr * 100).toFixed(2) + '%' },
        { k: '预期转化', v: conv, formula: '点击 ' + clicks.toLocaleString('zh-CN') + ' × CVR ' + (cvr * 100).toFixed(2) + '%' },
        { k: '预期 GMV', v: gmv, formula: '转化 ' + conv + ' × 客单价 ¥' + m.aov.toLocaleString('zh-CN') },
        { k: '预期毛利', v: Math.round(profit), formula: 'GMV × 毛利率 ' + (m.grossMargin * 100).toFixed(0) + '%' },
        { k: '预期 ROI', v: +(quote ? profit / quote : 0).toFixed(2), formula: '毛利 ¥' + Math.round(profit).toLocaleString('zh-CN') + ' ÷ 报价 ¥' + quote.toLocaleString('zh-CN') }
      ]
    };
  }
  function avgFormMul(kolId) {
    var m = kolMetrics(kolId);
    if (!m || !m.campaigns.length) return 1;
    var s = 0;
    m.campaigns.forEach(function (c) {
      var f = CONTENT_FORMS.filter(function (x) { return x.id === c.formId; })[0];
      s += f ? f.cvrMul : 1;
    });
    return s / m.campaigns.length;
  }
  function bestForm(kolId) {
    var m = kolMetrics(kolId);
    if (!m || !m.campaigns.length) return CONTENT_FORMS[0].id;
    var best = null;
    m.campaigns.forEach(function (c) { if (!best || c.roi > best.roi) best = c; });
    return best ? best.formId : CONTENT_FORMS[0].id;
  }

  /* SECTION: kol-plan
   * 投放决策器：给定预算与目标，在预算约束下求组合。
   *
   * 用贪心（按边际 ROI 排序）而非黑盒优化 —— 用户必须能理解为什么是这几个人。
   * 同时给出「未入选原因」，否则用户会怀疑漏掉了谁。
   */
  function buildPlan(opts) {
    opts = opts || {};
    var budget = opts.budget || 100000;
    var goal = opts.goal || 'roi';            // roi | exposure | conversion
    var minOverlap = opts.minOverlap || 0;
    var excludeIds = opts.exclude || [];

    var cands = KOLS.map(function (k) { return forecast(k.id); })
      .filter(function (f) { return f && excludeIds.indexOf(f.kolId) < 0; })
      .filter(function (f) { return f.kolId && kolMetrics(f.kolId).kol.overlap >= minOverlap; });

    var predictable = cands.filter(function (f) { return f.predictable; });
    var unpredictable = cands.filter(function (f) { return !f.predictable; });

    // 排序键：按目标选择，但一律用「每万元投入的产出」，保证跨达人可比
    function rank(f) {
      if (goal === 'exposure') return f.exposure / f.quote * 10000;
      if (goal === 'conversion') return f.conv / f.quote * 10000;
      return f.roi;   // roi：直接用 ROI，且用保守下界避免高估
    }
    function rankConservative(f) {
      if (goal === 'exposure') return f.exposure / f.quote * 10000;
      if (goal === 'conversion') return f.conv / f.quote * 10000;
      // ROI 目标下用区间下界排序：宁可少赚，不要按乐观值超投
      return f.roiLow || f.roi * 0.7;
    }
    predictable.sort(function (a, b) { return rankConservative(b) - rankConservative(a); });

    var picked = [], used = 0, skipped = [];
    predictable.forEach(function (f) {
      if (used + f.quote <= budget) { picked.push(f); used += f.quote; }
      else skipped.push({ f: f, reason: '报价 ¥' + f.quote.toLocaleString('zh-CN') + ' 超出剩余预算 ¥' + (budget - used).toLocaleString('zh-CN') });
    });

    var tot = { quote: 0, exposure: 0, clicks: 0, conv: 0, gmv: 0, profit: 0 };
    picked.forEach(function (f) {
      tot.quote += f.quote; tot.exposure += f.exposure; tot.clicks += f.clicks;
      tot.conv += f.conv; tot.gmv += f.gmv; tot.profit += f.profit;
    });
    var planRoi = tot.quote ? tot.profit / tot.quote : 0;
    // 组合层面的区间：各达人区间按投入加权（忽略相关性，需在口径中说明）
    var low = 0, high = 0;
    picked.forEach(function (f) {
      var w = tot.quote ? f.quote / tot.quote : 0;
      low += (f.roiLow || 0) * w; high += (f.roiHigh || 0) * w;
    });

    return {
      budget: budget, goal: goal, goalLabel: { roi: 'ROI 最大化', exposure: '曝光最大化', conversion: '转化最大化' }[goal],
      picked: picked, skipped: skipped, unpredictable: unpredictable,
      used: used, remaining: budget - used, utilization: budget ? used / budget : 0,
      total: tot, roi: planRoi, roiLow: low, roiHigh: high,
      weightedConfidence: picked.length ? (picked.filter(function (f) { return f.confidence === 'high'; }).length / picked.length) : 0,
      meta: {
        method: '按「每万元投入产出」贪心分配；ROI 目标下用区间下界排序，避免按乐观值超投',
        exclusion: unpredictable.length ? (unpredictable.length + ' 位达人因无历史合作数据被排除在组合之外（不参与排序）') : '全部候选达人均有历史数据',
        correlation: '组合区间按各达人投入加权合成，假设达人之间效果独立；实际存在人群重叠，真实区间可能更宽',
        overlapWarn: (function () {
          var hi = picked.filter(function (f) { return f.overlap >= 0.6; }).length;
          return hi >= 2 ? ('组合中有 ' + hi + ' 位达人客群重合度 ≥ 60%，人群可能重叠导致曝光重复计算，建议核对受众画像') : null;
        })()
      }
    };
  }

  /* SECTION: kol-pipeline
   * 进行中的合作看板：用户进来第一眼要看到「今天该推哪一步」。
   */
  var STAGES = [
    { id: 'negotiating', name: '洽谈中', order: 1 },
    { id: 'contracted', name: '已签约', order: 2 },
    { id: 'creating', name: '内容共创', order: 3 },
    { id: 'review', name: '待企业审核', order: 4 },
    { id: 'scheduled', name: '待发布', order: 5 },
    { id: 'live', name: '已发布·追踪中', order: 6 },
    { id: 'closed', name: '已结案', order: 7 }
  ];

  var ACTIVE_DEALS = [
    {
      id: 'deal-1', kolId: 'kol-zhou', kolName: '科技老周', stage: 'review', formName: '深度评测',
      budget: 42000, publishAt: -3, owner: '—', nextAction: '审核脚本终稿',
      blocker: '脚本第 3 段涉及「行业第一」表述，需过合规检查后才能发布',
      compliance: 'pending', briefVersion: 3, scriptVersion: 2,
      history: [
        { at: -18, text: '建立合作意向，确认档期' },
        { at: -12, text: '签约完成，报价 ¥42,000（深度评测）' },
        { at: -7, text: '收到脚本 v1，提出 4 处修改意见' },
        { at: -3, text: '收到脚本 v2，其中 1 处表述待合规确认' }
      ]
    },
    {
      id: 'deal-2', kolId: 'kol-qian', kolName: '钱工说架构', stage: 'creating', formName: '教程演示',
      budget: 21000, publishAt: -9, owner: '—', nextAction: '等待达人提交大纲',
      blocker: null, compliance: 'not_required', briefVersion: 2, scriptVersion: 0,
      history: [
        { at: -21, text: '签约完成，报价 ¥21,000（教程演示）' },
        { at: -14, text: '下发 brief v2，明确需覆盖私有化部署场景' }
      ]
    },
    {
      id: 'deal-3', kolId: 'kol-sun', kolName: '孙老板日记', stage: 'live', formName: '深度评测',
      budget: 31000, publishAt: 2, owner: '—', nextAction: '跟踪转化数据，第 7 天出中期报告',
      blocker: null, compliance: 'passed', briefVersion: 1, scriptVersion: 2,
      liveMetrics: { exposure: 168000, clicks: 5210, conv: 142, gmv: 412000, daysSince: 2, windowDays: 7 },
      history: [
        { at: -26, text: '签约完成，报价 ¥31,000' },
        { at: -10, text: '脚本 v2 审核通过，合规检查通过' },
        { at: 2, text: '内容已发布，开始效果追踪（7 天归因窗口）' }
      ]
    },
    {
      id: 'deal-4', kolId: 'kol-lin', kolName: '小林聊数码', stage: 'negotiating', formName: '植入提及',
      budget: 34100, publishAt: null, owner: '—', nextAction: '回复达人报价异议',
      blocker: '达人要求报价上浮 15%（¥55,000 → ¥63,250），需你确认',
      compliance: 'not_required', briefVersion: 1, scriptVersion: 0,
      history: [{ at: -5, text: '首次接触，达人反馈档期紧张并要求加价' }]
    },
    {
      id: 'deal-5', kolId: 'kol-zhi', kolName: '职场指南针', stage: 'scheduled', formName: '图文推广',
      budget: 18000, publishAt: -1, owner: '—', nextAction: '明天 10:00 发布，确认追踪链接已配置',
      blocker: null, compliance: 'passed', briefVersion: 2, scriptVersion: 3,
      history: [
        { at: -15, text: '签约完成，报价 ¥18,000' },
        { at: -6, text: '内容审核通过' },
        { at: -1, text: '约定明日 10:00 发布' }
      ]
    }
  ];

  /* SECTION: kol-alerts
   * 「今天要推进的事」—— 由合作状态推导，不是静态文案。
   */
  function todayActions() {
    var out = [];
    ACTIVE_DEALS.forEach(function (d) {
      var m = kolMetrics(d.kolId);
      if (d.blocker) {
        out.push({
          level: d.stage === 'review' ? 'P1' : 'P2',
          levelKind: d.stage === 'review' ? 'bad' : 'warn',
          text: d.kolName + '：' + d.blocker,
          action: d.nextAction, dealId: d.id, kind: 'blocker'
        });
      }
      if (d.publishAt != null && d.publishAt < 0 && Math.abs(d.publishAt) <= 2 && d.stage === 'scheduled') {
        out.push({ level: 'P1', levelKind: 'bad', text: d.kolName + '：' + Math.abs(d.publishAt) + ' 天后发布，需确认追踪链接与 UTM 参数', action: '检查发布配置', dealId: d.id, kind: 'upcoming' });
      }
      if (d.liveMetrics && d.liveMetrics.daysSince >= d.liveMetrics.windowDays - 1) {
        out.push({ level: 'P2', levelKind: 'info', text: d.kolName + '：归因窗口即将关闭，需产出结案报告', action: '生成结案报告', dealId: d.id, kind: 'closing' });
      }
      if (m && m.predictable && m.lastDeal && m.lastDeal.dayOffset < -180) {
        out.push({ level: 'P3', levelKind: 'info', text: d.kolName + '：上次合作已 ' + Math.abs(m.lastDeal.dayOffset) + ' 天前，历史转化数据可能已失效', action: '复核达人当前数据', dealId: d.id, kind: 'stale' });
      }
    });
    var order = { P1: 0, P2: 1, P3: 2 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  }

  /* SECTION: kol-roi-audit
   * ROI 计算透明化：把公式与每一项数据来源摊开，不让 ROI 变成黑盒数字。
   */
  function roiAudit(kolId) {
    var m = kolMetrics(kolId);
    if (!m || !m.predictable) return null;
    return {
      kolId: kolId, name: m.kol.name, deals: m.deals,
      formula: 'ROI = (GMV × 毛利率) ÷ 总投入',
      items: [
        { k: '总投入', v: m.spend, source: m.deals + ' 次合作的合同金额之和（含内容制作与平台服务费）' },
        { k: '总 GMV', v: m.gmv, source: '归因窗口内的成交金额，UTM 参数追踪' },
        { k: '毛利率', v: m.grossMargin, source: '财务口径固定值 42%，可按业务线配置' },
        { k: '毛利', v: Math.round(m.gmv * m.grossMargin), source: 'GMV × 毛利率' },
        { k: 'ROI', v: +m.roi.toFixed(2), source: '毛利 ÷ 总投入' }
      ],
      range: { low: +m.roiLow.toFixed(2), high: +m.roiHigh.toFixed(2), median: +m.roiMedian.toFixed(2), min: +m.roiMin.toFixed(2), max: +m.roiMax.toFixed(2) },
      perCampaign: m.campaigns.map(function (c) {
        return { date: c.date, form: c.formName, spend: c.spend, exposure: c.exposure, clicks: c.clicks, conv: c.conv, aov: c.aov, gmv: c.gmv, roi: +c.roi.toFixed(2) };
      })
    };
  }

  global.KOL = {
    KOLS: KOLS,
    CAMPAIGNS: CAMPAIGNS,
    CONTENT_FORMS: CONTENT_FORMS,
    STAGES: STAGES,
    ACTIVE_DEALS: ACTIVE_DEALS,
    metrics: kolMetrics,
    forecast: forecast,
    buildPlan: buildPlan,
    todayActions: todayActions,
    roiAudit: roiAudit,
    allMetrics: function () { return KOLS.map(function (k) { return kolMetrics(k.id); }); }
  };
})(window);
