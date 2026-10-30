/* SECTION: renderer-kol
 * 网红营销页 —— 任务视角重构。
 *
 * 旧版：达人表格（用户点开是为了做投放决定，列表只是证据材料）。
 * 新版结构，按用户进入页面的真实顺序：
 *   ① 今天要推进的事      —— 被阻塞的合作、临期发布、窗口即将关闭
 *   ② 进行中的合作看板    —— 我的合作各自卡在哪一步，下一步做什么
 *   ③ 规划新投放（决策器）—— 给预算和目标，得到组合方案与可解释的预期
 *   ④ 达人库（抽屉）      —— 证据材料，在决策过程中被检索，也可独立浏览
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, C = global.CHARTS, K = global.KOL;
  var R = global.RENDERERS;

  R.kolPage = function (cap, state, h) {
    var fmt = h.fmt;
    var st = state.kol = state.kol || {};
    if (!st.__libReady) {
      var saved = libLoad();
      if (saved.libF) st.libF = saved.libF;
      if (saved.libSort) st.libSort = saved.libSort;
      if (saved.libView) st.libView = saved.libView;
      if (saved.libFav) st.libFav = saved.libFav;
      if (saved.libFavOnly) st.libFavOnly = saved.libFavOnly;
      st.__libReady = true;
    }

    var head = '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div></div>' +
      '<div class="ph-side">' +
      '<button class="btn-primary" data-act="create-open" data-create="kol" data-primary-action title="新建投放计划：定预算、目标与候选达人">' + h.esc(cap.action) + '</button>' +
      '</div></div>' + global.UI.sessionNewBlock(state, h, 'kol', { title: '本会话新建的投放计划' });

    /* 2026-10-30 业主：「默认达人库，投放决策删了」。
       这一屏只剩达人库；单达人不再是独立视图，点卡片在右侧抽屉里看（见 openKolSheet）。
       boardView / plannerView / detailView 的渲染代码留在本文件备回滚，但已经没有入口，
       ⚠ 不要再往这两个视图里加功能 —— 它们不可达。 */
    return '<div class="kol-v2">' + head + libraryView(h, fmt, st) + '</div>';
  };

  /* SECTION: kol-board
   * ① + ②：今天该做什么 + 合作卡在哪
   */
  function boardView(h, fmt, st) {
    var acts = K.todayActions();
    var deals = K.ACTIVE_DEALS;

    // 在跑合作的投入与已回收（来自明细，不是编的）
    var running = deals.filter(function (d) { return d.stage !== 'closed'; });
    var committed = running.reduce(function (s, d) { return s + d.budget; }, 0);
    var liveGmv = deals.reduce(function (s, d) { return s + (d.liveMetrics ? d.liveMetrics.gmv : 0); }, 0);
    var blocked = deals.filter(function (d) { return d.blocker; }).length;

    var actHtml = '<div class="card today-card"><div class="card-h"><h3>今天要推进的事</h3>' +
      '<span class="card-sub">' + acts.length + ' 项 · 按优先级排序 · 由合作状态推导</span></div>';
    if (!acts.length) {
      actHtml += '<div class="empty"><div class="empty-title">没有需要今天处理的事项</div>' +
        '<div class="empty-sub">全部合作正常推进中</div></div>';
    } else {
      actHtml += '<div class="act-list">' + acts.map(function (a) {
        return '<div class="act-item ' + a.levelKind + '">' +
          '<span class="act-lv">' + h.esc(a.level) + '</span>' +
          '<span class="act-main"><b>' + h.esc(a.text) + '</b>' +
          '<i>建议动作：' + h.esc(a.action) + '</i></span>' +
          '<button class="btn-ghost sm" data-act="kol-deal" data-id="' + h.esc(a.dealId || '') + '">去处理</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    actHtml += '</div>';

    // 阶段看板：按 STAGES 分列
    var boardHtml = '<div class="card"><div class="card-h"><h3>进行中的合作</h3>' +
      '<span class="card-sub">点击卡片看合作全周期与历史数据</span></div>' +
      '<div class="kanban">';
    K.STAGES.filter(function (s) { return s.id !== 'closed'; }).forEach(function (s) {
      var items = deals.filter(function (d) { return d.stage === s.id; });
      boardHtml += '<div class="kb-col"><div class="kb-h"><b>' + h.esc(s.name) + '</b>' +
        '<span class="kb-n">' + items.length + '</span></div>' +
        (items.length ? items.map(function (d) {
          var m = K.metrics(d.kolId);
          return '<button class="kb-card' + (d.blocker ? ' blocked' : '') + '" data-act="kol-deal" data-id="' + h.esc(d.id) + '">' +
            '<b>' + h.esc(d.kolName) + '</b>' +
            /* v28 单位统一：金额走 fmt.money（¥34,000），不再手写 ¥3.4w ——
               'w' 是西文口径，全平台只有这一屏用，与「万/km」都不同源。 */
            '<span class="kb-form">' + h.esc(d.formName) + ' · ' + fmt.money(d.budget) + '</span>' +
            (d.publishAt != null ? '<span class="kb-date">' + (d.publishAt < 0 ? Math.abs(d.publishAt) + ' 天后发布' : '已发布 ' + d.publishAt + ' 天') + '</span>' : '') +
            (m && m.predictable ? '<span class="kb-roi">历史 ROI ' + m.roi.toFixed(1) + '</span>' : '<span class="kb-roi none">无历史数据</span>') +
            /* 2026-10-20 走查修复：原来这里是 `d.blocker.slice(0, 26) + '…'` —— 程序硬截断，
               「¥55,000 → ¥63,…」这种半句话在界面上没法补全（也没 title）。改成完整文本，
               卡内自然换行；hover 仍给全文。 */
            (d.blocker ? '<span class="kb-block" title="' + h.esc(d.blocker) + '">⚠ ' + h.esc(d.blocker) + '</span>' : '') +
            (d.liveMetrics ? '<span class="kb-live">转化 ' + d.liveMetrics.conv + ' · GMV ' + fmt.money(d.liveMetrics.gmv) + '</span>' : '') +
            '</button>';
        }).join('') : '<div class="kb-empty">—</div>') +
        '</div>';
    });
    boardHtml += '</div></div>';

    // 预算与产出：从明细聚合
    var allM = K.allMetrics().filter(function (m) { return m.predictable; });
    var histSpend = allM.reduce(function (s, m) { return s + m.spend; }, 0);
    var histGmv = allM.reduce(function (s, m) { return s + m.gmv; }, 0);
    var histRoi = histSpend ? (histGmv * 0.42) / histSpend : 0;
    var best = allM.slice().sort(function (a, b) { return b.roi - a.roi; })[0];
    var worst = allM.slice().sort(function (a, b) { return a.roi - b.roi; })[0];
    var noData = K.allMetrics().filter(function (m) { return !m.predictable; });

    var kpiHtml = '<div class="metrics">' + [
      { label: '在跑合作投入', value: fmt.money(committed), sub: running.length + ' 个合作 · ' + blocked + ' 个被阻塞', alert: blocked > 0, definition: '已签约但未结案的合作合同金额之和' },
      { label: '追踪中 GMV', value: fmt.money(liveGmv), sub: '来自 ' + deals.filter(function (d) { return d.liveMetrics; }).length + ' 个已发布合作', definition: '归因窗口内 UTM 追踪到的成交金额，窗口未关闭前为中间值' },
      { label: '历史累计 ROI', value: histRoi.toFixed(2), sub: fmt.money(histSpend) + ' 投入 → ' + fmt.money(Math.round(histGmv * 0.42)) + ' 毛利', definition: 'ROI = (GMV × 毛利率 42%) ÷ 总投入；口径可在单个达人的 ROI 审计中逐项核对' },
      { label: '数据不可预测的达人', value: String(noData.length), alert: noData.length > 0, sub: noData.map(function (m) { return m.kol.name; }).join('、') || '—', definition: '无历史合作记录的达人不参与组合排序，系统不会为其编造预期数字' }
    ].map(h.metricCard).join('') + '</div>';

    var insightHtml = '<div class="card"><div class="card-h"><h3>从历史合作里能看出什么</h3>' +
      '<span class="card-sub">全部由 ' + K.CAMPAIGNS.length + ' 条合作明细聚合 · 点达人名看其档案</span></div>' +
      '<div class="ins-grid">' +
      /* 出口：两个"达人"结论能落到该达人的详情（kol-detail 按 kolId 查）； */
      '<div class="ins"><i>ROI 最高</i><b><button class="lnk" data-act="kol-detail" data-id="' + h.esc(best.kol.id) + '">' + h.esc(best.kol.name) + '</button></b><span>' + best.roi.toFixed(2) + ' · ' + best.deals + ' 次合作 · 置信度' + confLabel(best.confidence) + '</span></div>' +
      '<div class="ins"><i>ROI 最低</i><b><button class="lnk" data-act="kol-detail" data-id="' + h.esc(worst.kol.id) + '">' + h.esc(worst.kol.name) + '</button></b><span>' + worst.roi.toFixed(2) + ' · ' + whyWorst(worst) + '</span></div>' +
      /* 「内容形式」「客群重合度相关性」是**跨达人的整体结论**，没有单个可跳对象 —— 保持只读陈述。 */
      '<div class="ins" data-static="1" title="只读说明：这是跨达人的整体结论（哪种内容形式更优），不对应单个达人对象，因此没有可跳入口。"><i>内容形式</i><b>' + bestFormLabel() + '</b><span>' + bestFormNote() + '</span></div>' +
      '<div class="ins" data-static="1" title="只读说明：这是统计相关性结论（重合度与 ROI 的关系），不对应单个达人对象。"><i>客群重合度相关性</i><b>' + overlapCorr() + '</b><span>重合度与 ROI 的关系</span></div>' +
      '</div>' +
      '</div></div>';

    return kpiHtml + actHtml + boardHtml + insightHtml +
      h.metaBar({}, [
        { k: 'ROI 口径', v: 'ROI = (GMV × 毛利率 42%) ÷ 投入；GMV 为归因窗口内 UTM 追踪成交额' },
        { k: '预期口径', v: '曝光 = 粉丝 × 触达率；点击 = 曝光 × CTR；转化 = 点击 × CVR；所有系数由该达人历史合作明细聚合，不使用类目均值冒充' },
        { k: '数据边界', v: noData.length + ' 位达人无历史合作记录，标记为「无法预测」，不参与组合排序' },
        { k: '样本量', v: '共 ' + K.CAMPAIGNS.length + ' 条合作明细，覆盖 ' + allM.length + ' 位达人；单达人 ' + Math.min.apply(null, allM.map(function (m) { return m.deals; })) + '~' + Math.max.apply(null, allM.map(function (m) { return m.deals; })) + ' 条' }
      ]);
  }

  function confLabel(c) { return { high: '高（≥5 次）', medium: '中（3-4 次）', low: '低（1-2 次）', none: '无' }[c] || c; }
  /* 卡片底部只有一格位置，置信度用单字（完整写法在详情页与列表视图里） */
  function confShort(c) { return { high: '高', medium: '中', low: '低', none: '无' }[c] || '无'; }
  function whyWorst(m) {
    if (m.kol.authenticity < 0.7) return '粉丝真实性仅 ' + Math.round(m.kol.authenticity * 100) + '%，曝光虚高但转化差';
    if (m.kol.overlap < 0.4) return '客群重合度仅 ' + Math.round(m.kol.overlap * 100) + '%，人群不匹配';
    return '客单价偏低（¥' + m.aov + '）';
  }
  function bestFormLabel() {
    var agg = {};
    K.CAMPAIGNS.forEach(function (c) {
      if (!agg[c.formId]) agg[c.formId] = { name: c.formName, spend: 0, gmv: 0, n: 0 };
      agg[c.formId].spend += c.spend; agg[c.formId].gmv += c.gmv; agg[c.formId].n++;
    });
    var best = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) {
      return (b.gmv * 0.42 / b.spend) - (a.gmv * 0.42 / a.spend);
    })[0];
    global._bestFormAgg = agg;
    return best ? best.name : '—';
  }
  function bestFormNote() {
    var agg = global._bestFormAgg || {};
    var arr = Object.keys(agg).map(function (k) { return { name: agg[k].name, roi: agg[k].spend ? (agg[k].gmv * 0.42 / agg[k].spend) : 0, n: agg[k].n }; });
    arr.sort(function (a, b) { return b.roi - a.roi; });
    if (arr.length < 2) return '样本不足';
    return 'ROI ' + arr[0].roi.toFixed(1) + '，最低为「' + arr[arr.length - 1].name + '」' + arr[arr.length - 1].roi.toFixed(1) + '（差 ' + (arr[0].roi - arr[arr.length - 1].roi).toFixed(1) + '）';
  }
  function overlapCorr() {
    var ms = K.allMetrics().filter(function (m) { return m.predictable; });
    if (ms.length < 3) return '样本不足';
    var xs = ms.map(function (m) { return m.kol.overlap; }), ys = ms.map(function (m) { return m.roi; });
    var n = xs.length, mx = xs.reduce(function (a, b) { return a + b; }, 0) / n, my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var num = 0, dx = 0, dy = 0;
    for (var i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += Math.pow(xs[i] - mx, 2); dy += Math.pow(ys[i] - my, 2); }
    var r = (dx && dy) ? num / Math.sqrt(dx * dy) : 0;
    return 'r = ' + r.toFixed(2) + (r > 0.5 ? '（强正相关）' : (r > 0.2 ? '（弱正相关）' : '（无明显相关）'));
  }

  /* SECTION: kol-planner
   * ③ 规划新投放：这是本页的主任务
   */
  function plannerView(h, fmt, st) {
    var budget = st.budget || 100000;
    var goal = st.goal || 'roi';
    var minOverlap = st.minOverlap || 0;
    var plan = K.buildPlan({ budget: budget, goal: goal, minOverlap: minOverlap, exclude: st.exclude || [] });

    var controls = '<div class="card"><div class="card-h"><h3>投放规划器</h3>' +
      '<span class="card-sub">调整条件，组合与预期实时重算</span>' +
      '<button class="btn-ghost sm" data-act="kol-view" data-id="board">← 返回看板</button></div>' +
      '<div class="plan-ctl">' +
      '<label class="pc-grow"><i>总预算</i>' +
      '<input type="range" min="20000" max="300000" step="5000" value="' + budget + '" data-kol="budget">' +
      '<b>¥' + budget.toLocaleString('zh-CN') + '</b></label>' +
      '<label><i>投放目标</i><select data-kol="goal">' +
      ['roi', 'exposure', 'conversion'].map(function (g) {
        return '<option value="' + g + '"' + (g === goal ? ' selected' : '') + '>' + { roi: 'ROI 最大化', exposure: '曝光最大化', conversion: '转化最大化' }[g] + '</option>';
      }).join('') + '</select></label>' +
      '<label><i>最低客群重合度</i><select data-kol="minOverlap">' +
      [0, 0.4, 0.55, 0.7].map(function (v) {
        return '<option value="' + v + '"' + (v === minOverlap ? ' selected' : '') + '>' + (v === 0 ? '不限' : '≥ ' + Math.round(v * 100) + '%') + '</option>';
      }).join('') + '</select></label>' +
      '</div>' +
      '<div class="budget-bar"><i>预算使用</i>' +
      '<span class="bb-track"><b style="width:' + Math.min(100, plan.utilization * 100).toFixed(1) + '%"></b></span>' +
      '<span class="bb-txt">已分配 ¥' + plan.used.toLocaleString('zh-CN') + ' / 剩余 ¥' + plan.remaining.toLocaleString('zh-CN') + '</span></div>' +
      '</div>';

    var summary = '<div class="metrics">' + [
      { label: '组合预期 ROI', value: plan.roi.toFixed(2), sub: '区间 ' + plan.roiLow.toFixed(2) + ' ~ ' + plan.roiHigh.toFixed(2), alert: plan.roi < 2, definition: '组合毛利 ÷ 组合投入；区间按各达人 ROI 区间以投入加权合成' },
      { label: '预期曝光', value: fmt.compact(plan.total.exposure), definition: '各达人预期曝光之和（存在人群重叠，实际去重后会更低）' },
      { label: '预期转化', value: fmt.int(plan.total.conv), sub: '获客成本 ¥' + (plan.total.conv ? Math.round(plan.total.quote / plan.total.conv).toLocaleString('zh-CN') : '—') + ' / 人' },
      { label: '预期 GMV', value: fmt.money(plan.total.gmv), sub: '毛利 ' + fmt.money(Math.round(plan.total.profit)) },
      { label: '入选达人', value: String(plan.picked.length), sub: '排除 ' + plan.unpredictable.length + ' 位无数据达人' }
    ].map(h.metricCard).join('') + '</div>';

    if (!plan.picked.length) {
      return controls + '<div class="card"><div class="empty"><div class="empty-ico">' + h.icon('person', 28) + '</div>' +
        '<div class="empty-title">当前条件下没有可组合的达人</div>' +
        '<div class="empty-sub">' + (minOverlap > 0 ? '客群重合度门槛 ≥ ' + Math.round(minOverlap * 100) + '% 过滤掉了全部候选；' : '') +
        (budget < 20000 ? '预算低于最低达人报价；' : '') + '试着放宽条件</div>' +
        '<button class="btn-ghost" data-act="kol-reset">重置条件</button></div></div>';
    }

    var rows = plan.picked.map(function (f, i) {
      return {
        idx: i + 1, f: f,
        share: plan.used ? f.quote / plan.used : 0
      };
    });

    var pickedHtml = '<div class="card pad0"><div class="card-h pad"><h3>推荐组合</h3>' +
      '<span class="card-sub">按「' + h.esc(rankLabel(goal)) + '」倒序入选 · ' + h.esc(plan.meta.method) + '</span></div>' +
      h.table({
        columns: [
          { key: 'idx', label: '#', align: 'right' },
          { key: 'name', label: '达人', render: function (r) { return '<button class="lnk" data-act="kol-detail" data-id="' + h.esc(r.f.kolId) + '"><b>' + h.esc(r.f.name) + '</b></button><div class="td-sub">' + h.esc(r.f.formName) + ' · 客群重合 ' + Math.round(r.f.overlap * 100) + '% · 粉丝真实 ' + Math.round(r.f.authenticity * 100) + '%</div>'; } },
          { key: 'quote', label: '投入', align: 'right', render: function (r) { return '<b>¥' + r.f.quote.toLocaleString('zh-CN') + '</b><div class="td-sub">' + (r.share * 100).toFixed(0) + '% 预算</div>'; } },
          { key: 'exposure', label: '预期曝光', align: 'right', render: function (r) { return fmt.compact(r.f.exposure); } },
          { key: 'conv', label: '预期转化', align: 'right', render: function (r) { return fmt.int(r.f.conv); } },
          { key: 'gmv', label: '预期 GMV', align: 'right', render: function (r) { return fmt.money(r.f.gmv); } },
          { key: 'roi', label: '预期 ROI', align: 'right', render: function (r) { return '<b class="' + (r.f.roi < 2 ? 'bad' : 'ok') + '">' + r.f.roi.toFixed(2) + '</b><div class="td-sub">区间 ' + r.f.roiLow.toFixed(1) + '~' + r.f.roiHigh.toFixed(1) + '</div>'; } },
          // 排序依据列：让「为什么 ROI 9.3 的排在 7.1 后面」可被理解 ——
          // 贪心用的是保守下界而非点估计，不显示这一列用户会以为顺序是错的。
          { key: 'rank', label: '排序依据', align: 'right', render: function (r) {
            return '<b class="rank-v">' + h.esc(rankValue(r.f, goal, fmt)) + '</b><div class="td-sub">' + h.esc(rankLabel(goal)) + '</div>';
          } },
          { key: 'conf', label: '置信度', render: function (r) { return '<span class="pill ' + (r.f.confidence === 'high' ? 'ok' : (r.f.confidence === 'medium' ? 'warn' : 'bad')) + '">' + confLabel(r.f.confidence) + '</span><div class="td-sub">' + r.f.deals + ' 次合作</div>'; } },
          { key: 'act', label: '', render: function (r) { return '<button class="lnk warn" data-act="kol-exclude" data-id="' + h.esc(r.f.kolId) + '">移除</button>'; } }
        ],
        rows: rows, noPaging: true
      }) +
      '<div class="rank-note">' + h.esc(rankNote(goal, plan)) + '</div></div>';

    var explainHtml = '<div class="card"><div class="card-h"><h3>为什么是这几个人</h3>' +
      '<span class="card-sub">组合必须可解释，否则用户无法判断该不该信</span></div>' +
      '<div class="why-list">' + plan.picked.map(function (f, i) {
        return '<div class="why-item"><b>' + (i + 1) + '. ' + h.esc(f.name) + '</b>' +
          '<span>' + h.esc(whyPicked(f, goal, plan)) + '</span></div>';
      }).join('') + '</div>' +
      (plan.skipped.length ? '<div class="sub-h">未入选的达人（' + plan.skipped.length + '）</div>' +
        '<div class="why-list">' + plan.skipped.map(function (s) {
          return '<div class="why-item skip"><b>' + h.esc(s.f.name) + '</b><span>' + h.esc(s.reason) + '</span></div>';
        }).join('') + '</div>' : '') +
      (plan.unpredictable.length ? '<div class="sub-h">因数据不足被排除（' + plan.unpredictable.length + '）</div>' +
        '<div class="why-list">' + plan.unpredictable.map(function (f) {
          return '<div class="why-item skip"><b>' + h.esc(f.name) + '</b><span>' + h.esc(f.reason) + '</span></div>';
        }).join('') + '</div>' : '') +
      '</div>';

    var warnHtml = '';
    if (plan.meta.overlapWarn) warnHtml += '<div class="bt-warn">⚠ ' + h.esc(plan.meta.overlapWarn) + '</div>';
    var lowConf = plan.picked.filter(function (f) { return f.confidence === 'low'; });
    if (lowConf.length) warnHtml += '<div class="bt-warn">⚠ 组合中 ' + lowConf.length + ' 位达人仅有 1-2 次历史合作（' +
      lowConf.map(function (f) { return h.esc(f.name); }).join('、') + '），其 ROI 区间很宽，预期数字参考价值有限。建议先小额试投。</div>';
    if (plan.remaining > budget * 0.15) warnHtml += '<div class="bt-note">剩余预算 ¥' + plan.remaining.toLocaleString('zh-CN') +
      '（占 ' + ((plan.remaining / budget) * 100).toFixed(0) + '%）未分配 —— 因为没有更多达人的报价能落在剩余额度内。可提高预算或放宽重合度门槛。</div>';

    return controls + summary + pickedHtml + warnHtml + explainHtml +
      '<div class="card"><div class="card-h"><h3>口径与边界</h3></div>' +
      '<div class="bt-note">' +
      '<b>计算方法：</b>' + h.esc(plan.meta.method) + '<br>' +
      '<b>数据排除：</b>' + h.esc(plan.meta.exclusion) + '<br>' +
      '<b>区间假设：</b>' + h.esc(plan.meta.correlation) + '<br>' +
      '<b>下一步：</b>确认组合后可生成立项单，进入洽谈 → 签约 → 内容共创流程；' +
      '投放前需过合规检查，发布后进入 7 天归因窗口，结案时把实际 ROI 回写到达人历史，用于修正下一次的预期。' +
      '</div></div>' +
      h.metaBar({}, [
        { k: '组合口径', v: '组合 ROI = Σ毛利 ÷ Σ投入；曝光/转化为各达人相加（未做人群去重，存在重复计算，见下方相关性说明）' },
        { k: '排序依据', v: h.esc(plan.meta.method) },
        { k: '区间假设', v: h.esc(plan.meta.correlation) },
        { k: '数据排除', v: h.esc(plan.meta.exclusion) },
        { k: '样本量', v: '组合含 ' + plan.picked.length + ' 位达人，共 ' + plan.picked.reduce(function (s, f) { return s + f.deals; }, 0) + ' 次历史合作支撑预期' }
      ]);
  }

  /* SECTION: kol-rank-explain
   * 排序依据可视化。决策器按「保守值」排序（ROI 目标下用区间下界），
   * 但表格默认展示的是点估计 —— 两者不一致时用户会以为顺序排错了。
   * 因此必须把实际参与排序的值单独列出来，并说明为什么用它。
   */
  function rankLabel(goal) {
    if (goal === 'exposure') return '每万元曝光';
    if (goal === 'conversion') return '每万元转化';
    return 'ROI 保守下界';
  }
  function rankValue(f, goal, fmt) {
    if (goal === 'exposure') return Math.round(f.exposure / f.quote * 10000).toLocaleString('zh-CN');
    if (goal === 'conversion') return (f.conv / f.quote * 10000).toFixed(1);
    return f.roiLow.toFixed(2);
  }
  function rankNote(goal, plan) {
    if (goal === 'roi') {
      return '排序用「ROI 保守下界」而非点估计：区间下界 = 点估计 − t 分布半宽，合作次数越少下界越低。' +
        '这样宁可少赚也不会按乐观值超投 —— 若按点估计排序，一个只有 1 次合作、ROI 偶然很高的达人会挤掉稳定达人。' +
        '因此表中「预期 ROI」列可能出现 9.3 排在 7.1 之后：前者的下界更低（样本少、不确定性大）。';
    }
    if (goal === 'exposure') {
      return '排序用「每万元投入带来的曝光」，使不同报价的达人可比。曝光未做人群去重，' +
        '若组合中存在客群高度重合的达人，实际触达人数会低于相加值。';
    }
    return '排序用「每万元投入带来的转化」，等价于按获客成本倒序。转化预期依赖达人历史 CVR，' +
      '置信度低的达人其 CVR 波动大，建议结合「置信度」列一起判断。';
  }

  function whyPicked(f, goal, plan) {
    if (goal === 'exposure') return '每万元投入带来 ' + Math.round(f.exposure / f.quote * 10000).toLocaleString('zh-CN') + ' 次曝光，在候选中排名第 ' + (plan.picked.indexOf(f) + 1);
    if (goal === 'conversion') return '每万元投入带来 ' + (f.conv / f.quote * 10000).toFixed(1) + ' 个转化，获客成本 ¥' + Math.round(f.quote / Math.max(1, f.conv)).toLocaleString('zh-CN');
    return 'ROI ' + f.roi.toFixed(2) + '（保守下界 ' + f.roiLow.toFixed(2) + '），' + f.deals + ' 次历史合作，置信度' + confLabel(f.confidence) + '；' + (f.overlap >= 0.6 ? '客群重合度高（' + Math.round(f.overlap * 100) + '%）' : '客群重合度 ' + Math.round(f.overlap * 100) + '%');
  }

  /* SECTION: kol-library
   * ④ 达人库 —— 2026-10-30 按业主提供的「网红筛选」界面 1:1 搬过来（结构照搬，样式用本站令牌）。
   *    左：搜索 / 平台 / 风格标签 / 地区 / 粉丝量级（双滑块）/ 合作状态 / 重置
   *    右：工具条（结果数 + 排序 + 卡片列表切换 + 收藏 + 导出）+ 卡片网格（或表格）
   *    卡片：星标收藏、头像、名字 + 分数、类目·地区、平台徽标、粉丝/客群/报价/真粉、
   *          标签行、合作状态、更多信息
   *    · 所有数值来自 K.allMetrics()；「数据不足」的达人 ROI 位显示 —，不补数字
   *    · 筛选/排序/收藏都不写 URL：页签按完整 hash 去重，写一次就多一个同名页签
   */
  /* 达人库的筛选 / 排序 / 视图 / 收藏存在本地：刷新不丢，但不写进地址栏 ——
     页签按完整 hash 去重，写一次就往页签条上多一个同名页签。 */
  var LIB_KEY = 'kolLibView';

  function libLoad() {
    try {
      return JSON.parse((global.localStorage && global.localStorage.getItem(LIB_KEY)) || '{}');
    } catch (e) { return {}; }
  }
  function libSave(st) {
    if (!st) return;
    try {
      if (!global.localStorage) return;
      global.localStorage.setItem(LIB_KEY, JSON.stringify({
        libF: st.libF || {}, libSort: st.libSort || 'roi', libView: st.libView || 'grid',
        libFav: st.libFav || [], libFavOnly: !!st.libFavOnly
      }));
    } catch (e) { /* 隐私模式写不进去也不影响用 */ }
  }

  var AVA_COLORS = ['#2563eb', '#7c3aed', '#0e7490', '#b45309', '#15803d', '#be185d', '#4f46e5', '#0f766e', '#9333ea'];

  var FANS_MIN = 0, FANS_MAX = 2200000, FANS_STEP = 50000;

  var DEAL_STATE = {
    active: { text: '合作中', tone: 'ok' },
    done: { text: '已合作', tone: 'info' },
    none: { text: '未联系', tone: 'idle' }
  };

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function libRows() {
    return K.allMetrics().map(function (m) {
      var bad = m.kol.authenticity < 0.7;
      var live = K.ACTIVE_DEALS.filter(function (d) { return d.kolId === m.kol.id && d.stage !== 'closed'; })[0];
      return {
        id: m.kol.id, kol: m.kol, m: m,
        roi: m.predictable ? m.roi : null,
        deals: m.deals, conf: m.confidence, pred: m.predictable,
        risk: bad ? '粉丝增长异常' : (m.kol.overlap < 0.35 ? '客群重合度低' : (m.kol.exclusivity ? '竞品排他' : '')),
        status: !m.predictable ? 'idle' : (bad ? 'bad' : (m.roi >= 3 ? 'ok' : 'warn')),
        statusText: !m.predictable ? '数据不足' : (bad ? '不建议' : (m.roi >= 3 ? '推荐' : '可考虑')),
        /* 合作状态：有在跑的合作用「合作中」，只有历史用「已合作」，一条都没有是「未联系」 */
        deal: live ? 'active' : (m.deals > 0 ? 'done' : 'none')
      };
    });
  }

  function libFilterRows(rows, f) {
    var tags = f.tags || [];
    return rows.filter(function (r) {
      if (f.platform && r.kol.platform !== f.platform) return false;
      if (tags.length && tags.indexOf(r.kol.category) < 0) return false;
      if (f.region && r.kol.region !== f.region) return false;
      if (f.deal && r.deal !== f.deal) return false;
      var fMin = f.fMin == null ? FANS_MIN : f.fMin;
      var fMax = f.fMax == null ? FANS_MAX : f.fMax;
      if (r.kol.followers < fMin || r.kol.followers > fMax) return false;
      if (f.q) {
        var q = String(f.q).trim().toLowerCase();
        if (q && (r.kol.name + r.kol.category + r.kol.region + r.kol.platform).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function libSortRows(rows, key) {
    var arr = rows.slice();
    arr.sort(function (a, b) {
      if (key === 'fans') return b.kol.followers - a.kol.followers;
      if (key === 'quote') return a.kol.quote - b.kol.quote;
      if (key === 'overlap') return b.kol.overlap - a.kol.overlap;
      /* 无数据达人一律排在末尾：当 0 处理会被读成「表现最差」，与「没测过」是两件事 */
      var va = a.roi == null ? -1 : a.roi, vb = b.roi == null ? -1 : b.roi;
      return vb - va;
    });
    return arr;
  }

  /* 当前视图下的结果集：页面渲染与 CSV 导出共用，避免两处算出口径不一致 */
  function libCurrentRows(st) {
    st = st || {};
    var favs = st.libFav || [];
    var all = libRows();
    var pool = st.libFavOnly ? all.filter(function (r) { return favs.indexOf(r.id) >= 0; }) : all;
    return libSortRows(libFilterRows(pool, st.libF || {}), st.libSort || 'roi');
  }

  function libraryView(h, fmt, st) {
    st = st || {};
    var view = st.libView || 'grid';
    var f = st.libF || {};
    var sortKey = st.libSort || 'roi';
    var favs = st.libFav || [];
    var favOnly = !!st.libFavOnly;

    var rows = libCurrentRows(st);

    var plats = uniq(K.KOLS.map(function (k) { return k.platform; }));
    var cats = uniq(K.KOLS.map(function (k) { return k.category; }));
    var regions = uniq(K.KOLS.map(function (k) { return k.region; }));
    var tags = f.tags || [];

    function chip(group, val, text, on) {
      return '<button class="k2-chip' + (on ? ' on' : '') + '" data-act="kol-lib-filter" data-k="' + group +
        '" data-v="' + h.esc(val) + '">' + h.esc(text) + '</button>';
    }

    var fMin = f.fMin == null ? FANS_MIN : f.fMin;
    var fMax = f.fMax == null ? FANS_MAX : f.fMax;

    var side = '<aside class="k2-side">' +
      '<div class="k2-sgroup"><div class="k2-slabel">搜索</div>' +
        '<input class="k2-sinput" type="text" data-kolq="1" value="' + h.esc(f.q || '') +
        '" placeholder="昵称或类目关键词">' +
      '</div>' +
      '<div class="k2-sgroup"><div class="k2-slabel">平台</div><div class="k2-schips">' +
        chip('platform', '', '全部', !f.platform) +
        plats.map(function (p) { return chip('platform', p, p, f.platform === p); }).join('') +
      '</div></div>' +
      '<div class="k2-sgroup"><div class="k2-slabel">风格标签</div><div class="k2-schips">' +
        cats.map(function (c) { return chip('tags', c, c, tags.indexOf(c) >= 0); }).join('') +
      '</div></div>' +
      '<div class="k2-sgroup"><div class="k2-slabel">地区</div><div class="k2-schips">' +
        chip('region', '', '全部', !f.region) +
        regions.map(function (r) { return chip('region', r, r, f.region === r); }).join('') +
      '</div></div>' +
      '<div class="k2-sgroup"><div class="k2-slabel">粉丝量级</div>' +
        '<div class="k2-ranrow"><span class="k2-ranl">最低</span>' +
          '<input type="range" min="' + FANS_MIN + '" max="' + FANS_MAX + '" step="' + FANS_STEP +
            '" value="' + fMin + '" data-kolfans="min" aria-label="粉丝下限">' +
          '<b class="k2-ranv">' + fmt.compact(fMin) + '</b></div>' +
        '<div class="k2-ranrow"><span class="k2-ranl">最高</span>' +
          '<input type="range" min="' + FANS_MIN + '" max="' + FANS_MAX + '" step="' + FANS_STEP +
            '" value="' + fMax + '" data-kolfans="max" aria-label="粉丝上限">' +
          '<b class="k2-ranv">' + fmt.compact(fMax) + '</b></div>' +
      '</div>' +
      '<div class="k2-sgroup"><div class="k2-slabel">合作状态</div><div class="k2-schips">' +
        chip('deal', '', '全部', !f.deal) +
        chip('deal', 'active', '合作中', f.deal === 'active') +
        chip('deal', 'done', '已合作', f.deal === 'done') +
        chip('deal', 'none', '未联系', f.deal === 'none') +
      '</div></div>' +
      '<button class="k2-sreset" data-act="kol-lib-reset">重置所有筛选</button>' +
    '</aside>';

    function stat(k, v) {
      return '<span class="k2-stat"><i>' + k + '</i><b>' + v + '</b></span>';
    }

    var grid = rows.length ? '<div class="k2-libgrid">' + rows.map(function (r, i) {
      var fav = favs.indexOf(r.id) >= 0;
      var ds = DEAL_STATE[r.deal];
      return '<div class="k2-lcard" role="button" tabindex="0" data-act="kol-detail" data-id="' + h.esc(r.id) + '"' +
        ' aria-label="查看 ' + h.esc(r.kol.name) + ' 的完整档案">' +
        '<button class="k2-fav' + (fav ? ' on' : '') + '" data-act="kol-lib-fav" data-id="' + h.esc(r.id) + '"' +
          ' aria-label="' + (fav ? '取消收藏' : '收藏') + '">' + (fav ? '★' : '☆') + '</button>' +
        '<span class="k2-ltop">' +
          '<span class="k2-lava" style="background:' + AVA_COLORS[i % AVA_COLORS.length] + '">' + h.esc(r.kol.name.slice(0, 2)) + '</span>' +
          '<span class="k2-lid">' +
            '<span class="k2-lnm"><b>' + h.esc(r.kol.name) + '</b>' +
              '<em class="k2-score ' + r.status + '">' + (r.pred ? r.roi.toFixed(2) : '—') + '</em></span>' +
            '<i>' + h.esc(r.kol.platform) + ' · ' + h.esc(r.kol.region) + '</i>' +
          '</span>' +
        '</span>' +
        '<span class="k2-lstats">' +
          stat('粉丝', fmt.compact(r.kol.followers)) +
          stat('客群重合', fmt.pct0(r.kol.overlap)) +
          stat('参考报价', fmt.money(r.kol.quote)) +
          stat('真实粉丝', fmt.pct0(r.kol.authenticity)) +
        '</span>' +
        '<span class="k2-ltags">' +
          '<i>' + h.esc(r.kol.category) + '</i>' +
          (r.kol.exclusivity ? '<i>竞品排他</i>' : '') +
          (r.risk ? '<i class="bad">' + h.esc(r.risk) + '</i>' : '') +
        '</span>' +
        '<span class="k2-lfoot">' +
          '<span class="k2-deal ' + r.deal + '"><i></i>' + ds.text + '</span>' +
          '<b>更多信息 →</b>' +
        '</span>' +
      '</div>';
    }).join('') + '</div>' : '<div class="k2-lempty"><b>没有符合条件的达人</b>' +
      '<span>放宽筛选条件，或重置后重新选</span></div>';

    /* 列表视图：原表格保留（排序、下钻都在） */
    var tableRows = rows.map(function (r) {
      return {
        id: r.id, name: r.kol.name, platformText: r.kol.platform + ' · ' + fmt.compact(r.kol.followers),
        quote: r.kol.quote, category: r.kol.category, overlap: r.kol.overlap, authenticity: r.kol.authenticity,
        deals: r.deals, roi: r.roi, predictable: r.pred,
        roiRange: r.pred ? (r.m.roiLow.toFixed(1) + '~' + r.m.roiHigh.toFixed(1)) : null,
        conf: r.conf,
        risk: r.risk || '—', status: r.status, statusText: r.statusText
      };
    });

    var list = h.table({
      columns: [
        { key: 'name', label: '达人', sortable: true, render: function (r) { return '<button class="lnk" data-act="kol-detail" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button><div class="td-sub">' + h.esc(r.category) + '</div>'; } },
        { key: 'platformText', label: '平台 / 粉丝' },
        { key: 'quote', label: '报价', sortable: true, align: 'right', render: function (r) { return '¥' + r.quote.toLocaleString('zh-CN'); } },
        { key: 'overlap', label: '客群重合', sortable: true, align: 'right', fmt: 'pct0' },
        { key: 'authenticity', label: '粉丝真实性', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.authenticity < 0.7 ? 'bad' : '') + '">' + fmt.pct0(r.authenticity) + '</span>'; } },
        { key: 'deals', label: '合作次数', sortable: true, align: 'right', fmt: 'int' },
        { key: 'roi', label: '历史 ROI', sortable: true, align: 'right', render: function (r) { return r.predictable ? '<b class="' + (r.roi >= 3 ? 'ok' : (r.roi < 2 ? 'bad' : '')) + '">' + r.roi.toFixed(2) + '</b><div class="td-sub">' + h.esc(r.roiRange) + '</div>' : '<span class="muted" data-tip="无历史合作记录，无法推导">数据不足</span>'; } },
        /* 置信度并进 ROI 单元格的副行（区间 + 次数就是置信度的来源），风险并进结论列 ——
           带侧栏后表格只有 876px，12 列会把「结论」「详情」挤出可视区 */
        { key: 'status', label: '结论', render: function (r) {
          return h.pill(r.status, r.statusText) +
            (r.risk === '—' ? '' : '<div class="td-sub warn">' + h.esc(r.risk) + '</div>');
        } },
        { key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="kol-detail" data-id="' + h.esc(r.id) + '">详情</button>'; } }
      ],
      /* 整行点击也打开同一个档案抽屉（参考图的列表视图就是这样：点行不点字） */
      rows: tableRows, sortBy: 'roi', sortDir: 'desc', pageSize: 20, rowAction: 'kol-detail',
      emptyTitle: '没有符合条件的达人'
    });

    var bar = '<div class="k2-lbar">' +
      '<span class="k2-lcount">' + rows.length + ' 位达人</span>' +
      '<label class="k2-sortsel">排序<select data-kolsort="1">' +
        [['roi', '历史 ROI ↓'], ['fans', '粉丝量 ↓'], ['quote', '报价 ↑'], ['overlap', '客群重合 ↓']].map(function (o) {
          return '<option value="' + o[0] + '"' + (sortKey === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select></label>' +
      '<div class="k2-bright">' +
        '<div class="view-sw">' +
          '<button class="vs-btn' + (view === 'grid' ? ' on' : '') + '" data-act="kol-lib-view" data-id="grid">卡片</button>' +
          '<button class="vs-btn' + (view === 'table' ? ' on' : '') + '" data-act="kol-lib-view" data-id="table">列表</button>' +
        '</div>' +
        '<button class="k2-bbtn' + (favOnly ? ' on' : '') + '" data-act="kol-lib-favonly" title="只看已收藏">★ 收藏' +
          (favs.length ? '<i>' + favs.length + '</i>' : '') + '</button>' +
        '<button class="k2-bbtn" data-act="kol-lib-export" title="导出当前筛选结果">导出 CSV</button>' +
      '</div>' +
    '</div>';

    /* 两种视图都保留左筛选栏：参考界面的侧栏独立于视图，切到列表也能继续筛 */
    return '<div class="k2-lib">' + bar +
      '<div class="k2-lbody">' + side + '<div class="k2-lmain">' +
        (view === 'table' ? '<div class="k2-ltable">' + list + '</div>' : grid) +
      '</div></div></div>' +
      h.metaBar({}, [
        { k: '系数来源', v: '触达率 / CTR / CVR / 客单价 / ROI 全部由历史合作明细聚合，非人工填写' },
        { k: '置信度', v: '高 ≥5 次合作 / 中 3-4 次 / 低 1-2 次 / 无 0 次；置信度决定 ROI 区间宽度' },
        { k: '排序', v: '默认按历史 ROI 倒序；无数据达人排在末尾而非按 0 处理（按 0 会误导为"表现差"）' },
        { k: '筛选', v: '筛选与收藏只在本页生效，不改任何达人系数，也不写进地址栏' }
      ]);
  }

  /* SECTION: kol-detail */
  function detailView(h, fmt, kolId, inSheet) {
    var m = K.metrics(kolId);
    if (!m) return '<div class="fatal"><h2>达人不存在</h2><button class="btn-primary" data-act="kol-view" data-id="library">返回达人库</button></div>';
    var audit = K.roiAudit(kolId);
    var deals = K.ACTIVE_DEALS.filter(function (d) { return d.kolId === kolId; });
    var f = K.forecast(kolId);

    /* 顶部一排关键数字：对齐参考界面的详情面板 —— 一眼看到结论，不用先读表 */
    var head = '<div class="k2-kpis-row">' + [
      {
        v: m.predictable ? m.roi.toFixed(2) : '—', label: '历史 ROI',
        tone: m.predictable ? (m.roi >= 3 ? 'g' : (m.roi < 2 ? 'r' : 'a')) : 'mu',
        sub: m.predictable ? '区间 ' + m.roiLow.toFixed(2) + '~' + m.roiHigh.toFixed(2) : '无历史合作'
      },
      { v: fmt.compact(m.kol.followers), label: '粉丝量', tone: 'b', sub: m.deals + ' 次合作' },
      { v: fmt.pct0(m.kol.overlap), label: '客群重合', tone: 'v', sub: m.kol.overlap >= 0.6 ? '人群匹配' : '人群偏散' },
      { v: fmt.pct0(m.kol.authenticity), label: '真实粉丝', tone: m.kol.authenticity < 0.7 ? 'r' : 'b', sub: m.kol.authenticity < 0.7 ? '低于 70%' : '正常' },
      { v: fmt.money(m.kol.quote), label: '参考报价', tone: 'n', sub: m.kol.exclusivity ? '有竞品排他' : '无排他' }
    ].map(function (k) {
      return '<div class="k2-kpi"><b class="' + k.tone + '">' + k.v + '</b>' +
        '<span>' + k.label + '</span><i>' + k.sub + '</i></div>';
    }).join('') + '</div>';

    if (!m.predictable) {
      return head + '<div class="card"><div class="empty"><div class="empty-ico">' + h.icon('chart', 28) + '</div>' +
        '<div class="empty-title">' + h.esc(m.reason) + '</div>' +
        '<div class="empty-sub">系统不会用类目均值或其他达人的数据来填补 —— 那会让投放决策建立在编造的数字上。<br>' +
        '如需评估该达人，建议先以小额（≤ ¥10,000）试投一次，用真实结果建立基线。</div>' +
        /* 🔴 F 批：本原型没有「试投执行 + 结果回写」能力（无后端、无真实投放通道）。
       如实禁用并说明，同时保留上面那句"用真实结果建立基线"的正确建议。 */
        '<button class="btn-ghost btn-off" aria-disabled="true" data-act="blocked-why" data-id="试投需要接入投放平台并回写结果后才能发起">发起小额试投（未接入）</button></div></div>';
    }

    var campaignRows = m.campaigns.slice().sort(function (a, b) { return b.dayOffset - a.dayOffset; });

    return head +
      /* 先给一张图：逐次合作的 ROI 高低一眼可见，比先读表格快 */
      '<div class="card"><div class="card-h"><h3>逐次合作 ROI</h3>' +
      '<span class="card-sub">' + m.deals + ' 次合作，条形越长越好</span></div>' +
      C.barChart(m.campaigns.slice().sort(function (a, b) { return a.dayOffset - b.dayOffset; }).map(function (c) {
        return { label: fmt.rel(c.dayOffset), value: c.roi, display: c.roi.toFixed(2) };
      }), { colorFn: function (x) { return x && x.value >= 3 ? '#2563eb' : '#c7cdd8'; } }) +
      '<div class="bt-note">同一达人的 ROI 波动越大，预期区间越宽 —— ' +
      '单次高低说明不了什么，看的是能不能重复。</div></div>' +

      '<div class="card"><div class="card-h"><h3>投放预期（可展开每一步口径）</h3>' +
      '<span class="card-sub">推荐形式：' + h.esc(f.formName) + '</span></div>' +
      '<div class="fc-steps">' + f.steps.map(function (s, i) {
        return '<div class="fc-step"><i>' + (i + 1) + '</i>' +
          '<span class="fc-k">' + h.esc(s.k) + '</span>' +
          '<b class="fc-v">' + (s.k === '预期 ROI' ? s.v.toFixed(2) : (s.k === '预期 GMV' || s.k === '预期毛利' ? fmt.money(s.v) : fmt.int(s.v))) + '</b>' +
          '<span class="fc-f">' + h.esc(s.formula) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="bt-note">预期 ROI ' + f.roi.toFixed(2) + '，区间 ' + f.roiLow.toFixed(2) + '~' + f.roiHigh.toFixed(2) +
      '（置信度' + confLabel(f.confidence) + '，基于 ' + f.deals + ' 次历史合作）。' +
      '区间宽度反映样本量：合作次数越少，区间越宽，预期越不可信。' +
      (f.confidence === 'low' ? '当前仅 ' + f.deals + ' 次合作，建议小额试投而非全额投入。' : '') + '</div></div>' +

      (deals.length ? '<div class="card"><div class="card-h"><h3>进行中的合作</h3></div>' +
        deals.map(function (d) {
          var stage = K.STAGES.filter(function (s) { return s.id === d.stage; })[0];
          return '<div class="deal-block"><div class="deal-h"><b>' + h.esc(stage ? stage.name : d.stage) + '</b>' +
            '<span>' + h.esc(d.formName) + ' · ¥' + d.budget.toLocaleString('zh-CN') + '</span></div>' +
            '<div class="deal-next">下一步：' + h.esc(d.nextAction) + '</div>' +
            (d.blocker ? '<div class="bt-warn">⚠ 阻塞：' + h.esc(d.blocker) + '</div>' : '') +
            (d.liveMetrics ? '<div class="deal-live">已发布 ' + d.liveMetrics.daysSince + ' 天（归因窗口 ' + d.liveMetrics.windowDays + ' 天）：曝光 ' +
              fmt.compact(d.liveMetrics.exposure) + ' · 点击 ' + fmt.int(d.liveMetrics.clicks) + ' · 转化 ' + d.liveMetrics.conv + ' · GMV ' + fmt.money(d.liveMetrics.gmv) + '</div>' : '') +
            '<div class="deal-hist">' + d.history.map(function (x) {
              return '<span><i>' + h.esc(fmt.rel(x.at)) + '</i>' + h.esc(x.text) + '</span>';
            }).join('') + '</div></div>';
        }).join('') + '</div>' : '') +

      '<div class="card"><div class="card-h"><h3>ROI 核算</h3>' +
      '<span class="card-sub">ROI 不能是黑盒数字 —— 公式与每项来源都摊开</span></div>' +
      '<div class="audit-formula">' + h.esc(audit.formula) + '</div>' +
      h.table({
        columns: [
          { key: 'k', label: '项' },
          { key: 'v', label: '值', align: 'right', render: function (r) { return r.k === 'ROI' ? '<b>' + r.v + '</b>' : (r.k === '毛利率' ? fmt.pct0(r.v) : (r.k === '总投入' || r.k === '总 GMV' || r.k === '毛利' ? fmt.money(r.v) : fmt.int(r.v))); } },
          { key: 'source', label: '数据来源' }
        ],
        rows: audit.items, noPaging: true
      }) +
      '<div class="sub-h">逐次合作明细（' + audit.perCampaign.length + ' 次）</div>' +
      h.table({
        columns: [
          { key: 'date', label: '时间', mono: true },
          { key: 'form', label: '内容形式' },
          { key: 'spend', label: '投入', align: 'right', render: function (r) { return fmt.money(r.spend); } },
          { key: 'exposure', label: '曝光', align: 'right', fmt: 'int' },
          { key: 'clicks', label: '点击', align: 'right', fmt: 'int' },
          { key: 'conv', label: '转化', align: 'right', fmt: 'int' },
          { key: 'aov', label: '客单价', align: 'right', render: function (r) { return fmt.money(r.aov); } },
          { key: 'gmv', label: 'GMV', align: 'right', render: function (r) { return fmt.money(r.gmv); } },
          { key: 'roi', label: 'ROI', align: 'right', sortable: true, render: function (r) { return '<b class="' + (r.roi >= 3 ? 'ok' : (r.roi < 2 ? 'bad' : '')) + '">' + r.roi.toFixed(2) + '</b>'; } }
        ],
        rows: audit.perCampaign, noPaging: true
      }) +
      '<div class="bt-note">这 ' + audit.perCampaign.length + ' 行明细就是上方所有系数的唯一来源。' +
      '页面上任何一个 ROI 数字，都能在这里逐次核对到具体某一次合作 —— 这是「可对账」的含义。</div></div>' +

      '<div class="card"><div class="card-h"><h3>内容形式效果对比</h3>' +
      '<span class="card-sub">同一达人不同形式的表现差异</span></div>' +
      C.barChart(K.CONTENT_FORMS.map(function (cf) {
        var cs = m.campaigns.filter(function (c) { return c.formId === cf.id; });
        if (!cs.length) return { label: cf.name, value: 0, display: '未合作过' };
        var sp = cs.reduce(function (s, c) { return s + c.spend; }, 0);
        var gm = cs.reduce(function (s, c) { return s + c.gmv; }, 0);
        return { label: cf.name + '（' + cs.length + ' 次）', value: sp ? gm * 0.42 / sp : 0, display: (sp ? (gm * 0.42 / sp).toFixed(2) : '—') };
      }).filter(function (x) { return x.value > 0; }), { colorFn: function () { return '#8b5cf6'; } }) +
      '<div class="bt-note">' + h.esc(f.formNote) + '</div></div>' +
      h.metaBar({}, [
        { k: '样本量', v: m.deals + ' 次合作，最早 ' + fmt.rel(Math.min.apply(null, m.campaigns.map(function (c) { return c.dayOffset; }))) + '，最近 ' + fmt.rel(m.lastDeal.dayOffset) },
        { k: '数据时效', v: m.lastDeal.dayOffset < -180 ? '⚠ 最近一次合作已 ' + Math.abs(m.lastDeal.dayOffset) + ' 天前，达人数据可能已变化，预期仅供参考' : '最近合作在 ' + Math.abs(m.lastDeal.dayOffset) + ' 天内，数据较新' },
        { k: '区间方法', v: '基于 ' + m.deals + ' 次合作 ROI 的标准差与 t 分布（小样本用更宽 t 值），非正态假设' }
      ]);
  }

  /* SECTION: kol-sheet
   * 达人档案抽屉。内容复用 detailView（同一套系数与 ROI 核算表），只是换成浮层：
   *   · 点卡片 / 列表里的达人名 → 从右侧滑出，遮罩 + × + ESC 都能关
   *   · 「全屏」把宽度放到 1180，长表格（逐次明细）看得下
   *   · 抽屉里的 [data-act] 要手动派发 —— bindContent 只在整页渲染时绑一次
   */
  var kolSheetEsc = null;
  var kolSheetHash = null;

  function openKolSheet(h, id, full) {
    closeKolSheet();
    var m = K.metrics(id);
    if (!m) return;

    var mask = document.createElement('div');
    mask.className = 'k2-mask';

    var box = document.createElement('div');
    box.className = 'k2-drawer' + (full ? ' full' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', m.kol.name + ' 的档案');
    var fav = (h.state.kol && h.state.kol.libFav || []).indexOf(id) >= 0;
    var idx = 0;
    for (var i = 0; i < K.KOLS.length; i++) { if (K.KOLS[i].id === id) { idx = i; break; } }
    var avaBg = AVA_COLORS[idx % AVA_COLORS.length];

    box.innerHTML =
      '<div class="k2-drawer-h">' +
        '<span class="k2-dh-av" style="background:' + avaBg + '">' + h.esc(m.kol.name.slice(0, 2)) + '</span>' +
        '<div class="k2-dh-t"><b>' + h.esc(m.kol.name) + '</b>' +
          '<span>' + h.esc(m.kol.platform) + ' · ' + h.esc(m.kol.region) + ' · ' + h.esc(m.kol.category) + '</span></div>' +
        '<div class="k2-dh-act">' +
          '<button class="k2-hbtn" data-sheet="full">' + (full ? '还原' : '全屏') + '</button>' +
          '<button class="k2-hbtn k2-x" data-sheet="close" aria-label="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="k2-drawer-b kol-v2">' + detailView(h, h.fmt, id, true) + '</div>' +
      '<div class="k2-drawer-f">' +
        '<button class="k2-fbtn primary" data-sheet-act="kol-sheet-fav" data-id="' + h.esc(id) + '">' +
          (fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
        '<button class="k2-fbtn" data-sheet-act="kol-sheet-export" data-id="' + h.esc(id) + '"' +
          (m.deals ? '' : ' disabled title="该达人没有历史合作明细可导出"') + '>导出合作明细</button>' +
        '<button class="k2-fbtn" data-sheet="close">关闭</button>' +
      '</div>';

    document.body.appendChild(mask);
    document.body.appendChild(box);
    /* 背景整块 inert：Tab 键不会跑到后面的列表里，读屏也读不到。
       遮罩本来就挡点击，这里补的是键盘。 */
    var shell = document.querySelector('.shell');
    if (shell && shell.setAttribute) shell.setAttribute('inert', '');
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        mask.classList.add('on');
        box.classList.add('on');
      });
    } else {
      mask.classList.add('on');
      box.classList.add('on');
    }

    box.addEventListener('click', function (e) {
      var t = e.target;
      var sheetBtn = t.closest ? t.closest('[data-sheet]') : null;
      if (sheetBtn) {
        var c = sheetBtn.getAttribute('data-sheet');
        if (c === 'close') closeKolSheet();
        if (c === 'full') openKolSheet(h, id, !full);
        return;
      }
      /* ⚠ 抽屉里的按钮用 data-sheet-act，不要用 data-act：
         全局那圈 [data-act] 扫描会把新注入的节点也挂一次（v23 的 bindPatched），
         加上这里自己的委托，同一次点击跑两遍 —— 收藏「加了又删」，表现为点了没反应。 */
      var actEl = t.closest ? t.closest('[data-sheet-act], [data-act]') : null;
      if (actEl) {
        var act = actEl.getAttribute('data-sheet-act') || actEl.getAttribute('data-act');
        var A2 = global.ACTIONS || {};
        if (A2[act]) A2[act](actEl.getAttribute('data-id'), actEl, h);
        /* 与整页里的 handleAction 一致：没接线就明说，不要点了没反应 */
        else h.toast('演示环境：该操作（' + act + '）未接线，不执行真实写操作', 'info');
      }
    });
    mask.addEventListener('click', closeKolSheet);

    kolSheetEsc = function (e) { if (e.key === 'Escape') closeKolSheet(); };
    document.addEventListener('keydown', kolSheetEsc);
    /* 抽屉挂在 body 下，不随 #content 重绘消失：切到别的屏时它会盖在新页面上。
       路由一变就收掉（同一 hash 的原地重绘不触发 hashchange，不影响收藏/全屏）。 */
    kolSheetHash = function () { closeKolSheet(); };
    window.addEventListener('hashchange', kolSheetHash);
  }

  function closeKolSheet() {
    var shell = document.querySelector('.shell');
    if (shell && shell.removeAttribute) shell.removeAttribute('inert');
    var nodes = document.querySelectorAll('.k2-mask, .k2-drawer');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
    if (kolSheetEsc) { document.removeEventListener('keydown', kolSheetEsc); kolSheetEsc = null; }
    if (kolSheetHash) { window.removeEventListener('hashchange', kolSheetHash); kolSheetHash = null; }
  }

  /* 抽屉底部的两个动作：收藏（同步列表星标）与导出该达人的逐次合作明细 */
  function kolFavToggle(h, id) {
    h.state.kol = h.state.kol || {};
    var arr = h.state.kol.libFav = h.state.kol.libFav || [];
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    return i < 0;
  }
  function kolRepaint(h) {
    /* 与 libRerender 同一件事：原地重画并接回滚动位置，只是不需要改 state */
    libRerender(h, function () {});
  }
  function kolDownload(name, rows) {
    var blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  /* SECTION: kol-actions */
  var A = global.ACTIONS;
  A['kol-view'] = function (id, btn, h) {
    h.state.kol = h.state.kol || {};
    h.state.kol.view = id;
    if (id === 'planner' && !h.state.kol.budget) h.state.kol.budget = 100000;
    h.navigate({});
  };
  /* 2026-10-30：单达人改成右侧抽屉（与「网红筛选」一致：点卡片就地看档案，不换页）。
     不 navigate，所以页签不增加，列表的筛选与滚动位置都还在。 */
  A['kol-detail'] = function (id, btn, h) {
    openKolSheet(h, id, false);
  };
  A['kol-deal'] = function (id, btn, h) {
    var d = K.ACTIVE_DEALS.filter(function (x) { return x.id === id; })[0];
    if (d) A['kol-detail'](d.kolId, btn, h);
  };
  A['kol-exclude'] = function (id, btn, h) {
    h.state.kol = h.state.kol || {};
    h.state.kol.exclude = (h.state.kol.exclude || []).concat([id]);
    h.navigate({});
    h.toast('已移除该达人，组合已重算', 'info');
  };
  A['kol-reset'] = function (id, btn, h) {
    h.state.kol = { view: 'planner', budget: 100000, goal: 'roi', minOverlap: 0, exclude: [] };
    h.navigate({});
  };
  /* 达人库（2026-10-30）：卡片 / 列表切换、筛选、重置。
     ⚠ 这里**不用 navigate**，只用 h.render() 原地重画 —— 页签是按完整 hash 去重的
     （见 app.js 知识库那条约 v17 方案乙），每改一次筛选就往页签条上堆一个「网红营销」。
     实测点 5 次筛选出 5 个同名页签。原地重渲染不写 hash，页签数量不变。
     代价是 #content 会被重画，滚动位置要自己接回去。 */
  function libRerender(h, patch, toTop) {
    h.state.kol = h.state.kol || {};
    patch(h.state.kol);
    libSave(h.state.kol);
    var ct = document.getElementById('content');
    var top = ct ? ct.scrollTop : 0;
    h.render();
    ct = document.getElementById('content');
    if (ct) ct.scrollTop = toTop ? 0 : top;
  }

  A['kol-lib-view'] = function (id, btn, h) {
    libRerender(h, function (k) { k.libView = id === 'table' ? 'table' : 'grid'; }, true);
  };
  A['kol-lib-filter'] = function (id, btn, h) {
    var k = btn && btn.getAttribute ? btn.getAttribute('data-k') : null;
    var v = btn && btn.getAttribute ? btn.getAttribute('data-v') : '';
    if (!k) return;
    libRerender(h, function (kk) {
      kk.libF = kk.libF || {};
      if (k === 'tags') {
        /* 风格标签可多选：点一次加入，再点取消；清空就回到「不限」 */
        var arr = kk.libF.tags || [];
        var i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else arr.push(v);
        kk.libF.tags = arr;
        return;
      }
      /* 其余分组单选：点同一个 chip 再点一次 = 取消该条筛选 */
      kk.libF[k] = (kk.libF[k] === v) ? '' : v;
    });
  };
  A['kol-lib-reset'] = function (id, btn, h) {
    libRerender(h, function (k) { k.libF = {}; k.libFavOnly = false; });
  };
  A['kol-lib-fav'] = function (id, btn, h) {
    libRerender(h, function (k) {
      var arr = k.libFav = k.libFav || [];
      var i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
    });
  };
  A['kol-sheet-fav'] = function (id, btn, h) {
    var full = !!document.querySelector('.k2-drawer.full');
    var added = kolFavToggle(h, id);
    openKolSheet(h, id, full);   // 重开一次，按钮文案跟着变
    kolRepaint(h);               // 列表上的星标同步
    h.toast(added ? '已收藏' : '已取消收藏', 'ok');
  };
  A['kol-sheet-export'] = function (id, btn, h) {
    var m = K.metrics(id);
    if (!m) return;
    var audit = K.roiAudit(id);
    if (!audit.perCampaign.length) { h.toast(m.kol.name + ' 没有历史合作明细可导出', 'info'); return; }
    var rows = [['时间', '内容形式', '投入', '曝光', '点击', '转化', '客单价', 'GMV', 'ROI'].join(',')].concat(
      audit.perCampaign.map(function (c) {
        return [c.date, c.form, c.spend, c.exposure, c.clicks, c.conv, c.aov, c.gmv, c.roi.toFixed(2)].join(',');
      })
    );
    kolDownload('达人-' + m.kol.name + '-合作明细.csv', rows);
    h.toast('已导出 ' + m.kol.name + ' 的 ' + audit.perCampaign.length + ' 次合作明细', 'ok');
  };
  A['kol-lib-favonly'] = function (id, btn, h) {
    libRerender(h, function (k) { k.libFavOnly = !k.libFavOnly; });
  };
  /* 导出当前筛选结果。真下载（Blob），不是假按钮；带 BOM 免 Excel 中文乱码。 */
  A['kol-lib-export'] = function (id, btn, h) {
    var st = h.state.kol || {};
    var rows = libCurrentRows(st);
    if (!rows.length) { h.toast('当前筛选没有可导出的达人', 'info'); return; }
    var head = ['达人', '平台', '地区', '类目', '粉丝', '参考报价', '客群重合', '真实粉丝', '合作次数', '历史ROI', '结论', '合作状态'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [
        r.kol.name, r.kol.platform, r.kol.region, r.kol.category,
        r.kol.followers, r.kol.quote,
        Math.round(r.kol.overlap * 100) + '%', Math.round(r.kol.authenticity * 100) + '%',
        r.deals, r.roi == null ? '' : r.roi.toFixed(2), r.statusText, DEAL_STATE[r.deal].text
      ].join(',');
    }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '达人库-' + rows.length + '位.csv';
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    h.toast('已导出 ' + rows.length + ' 位达人', 'ok');
  };
  A['kol-plan'] = function (id, btn, h) {
    h.navigate({});
  };

  global.RENDERERS = R;
  global.ACTIONS = A;
})(window);
