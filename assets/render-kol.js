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
    var st = state.kol || {};
    var view = st.view || 'board';      // board（决策看板） | library（达人库） | detail（单达人）
    var detailId = st.kolId || null;

    var head = '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.esc(cap.name) + '</div>' +
      '<div class="ph-desc">' + h.esc(cap.desc) + '</div></div>' +
      '<div class="ph-side">' +
      '<div class="view-sw" role="group">' +
      '<button class="vs-btn' + (view === 'board' ? ' on' : '') + '" data-act="kol-view" data-id="board">投放决策</button>' +
      '<button class="vs-btn' + (view === 'library' ? ' on' : '') + '" data-act="kol-view" data-id="library">达人库（' + K.KOLS.length + '）</button>' +
      '</div>' +
      '<button class="btn-primary" data-act="create-open" data-create="kol" data-primary-action title="新建投放计划：定预算、目标与候选达人">' + h.esc(cap.action) + '</button>' +
      '</div></div>' + global.UI.sessionNewBlock(state, h, 'kol', { title: '本会话新建的投放计划' });

    if (view === 'library') return head + libraryView(h, fmt);
    if (view === 'detail' && detailId) return head + detailView(h, fmt, detailId);
    if (view === 'planner') return head + plannerView(h, fmt, st);
    return head + boardView(h, fmt, st);
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
   * ④ 达人库：降级为证据材料视图，仍保留但不再是首屏
   */
  function libraryView(h, fmt) {
    var ms = K.allMetrics();
    var rows = ms.map(function (m) {
      return {
        /* v28 单位统一：粉丝数走 fmt.compact（86.0万）。原写法 (followers/10000).toFixed(0)+'w'
           有两个毛病：① 单位是 'w'，全站唯一；② toFixed(0) 把 9.6 万印成「10w」——
           凭空多出一万粉，是会误导投放决策的取整错误。fmt.compact 用 toFixed(1)。 */
        id: m.kol.id, name: m.kol.name, platformText: m.kol.platform + ' · ' + fmt.compact(m.kol.followers),
        quote: m.kol.quote, category: m.kol.category, overlap: m.kol.overlap, authenticity: m.kol.authenticity,
        deals: m.deals, roi: m.predictable ? m.roi : null,
        roiRange: m.predictable ? (m.roiLow.toFixed(1) + '~' + m.roiHigh.toFixed(1)) : null,
        conf: m.confidence, predictable: m.predictable,
        costPerConv: m.costPerConv,
        risk: m.kol.authenticity < 0.7 ? '⚠ 粉丝增长异常' : (m.kol.overlap < 0.35 ? '客群重合度低' : (m.kol.exclusivity ? '有竞品排他协议' : '—')),
        status: !m.predictable ? 'idle' : (m.kol.authenticity < 0.7 ? 'bad' : (m.roi >= 3 ? 'ok' : 'warn')),
        statusText: !m.predictable ? '数据不足' : (m.kol.authenticity < 0.7 ? '不建议' : (m.roi >= 3 ? '推荐' : '可考虑'))
      };
    });

    return '<div class="card"><div class="card-h"><h3>达人库</h3>' +
      '<span class="card-sub">证据材料视图 · 全部效果系数由 ' + K.CAMPAIGNS.length + ' 条历史合作明细聚合</span>' +
      '<button class="btn-ghost sm" data-act="kol-view" data-id="board">← 返回投放决策</button></div>' +
      '<div class="bt-warn">⚠ 「数据不足」的达人没有历史合作记录，其 ROI 显示为空而不是用类目均值填充 —— ' +
      '用均值冒充会让投放决策建立在编造的数字上。要评估他们，只能先小额试投。</div>' +
      h.table({
        columns: [
          { key: 'name', label: '达人', sortable: true, render: function (r) { return '<button class="lnk" data-act="kol-detail" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button><div class="td-sub">' + h.esc(r.category) + '</div>'; } },
          { key: 'platformText', label: '平台 / 粉丝' },
          { key: 'quote', label: '报价', sortable: true, align: 'right', render: function (r) { return '¥' + r.quote.toLocaleString('zh-CN'); } },
          { key: 'overlap', label: '客群重合', sortable: true, align: 'right', fmt: 'pct0' },
          { key: 'authenticity', label: '粉丝真实性', sortable: true, align: 'right', render: function (r) { return '<span class="' + (r.authenticity < 0.7 ? 'bad' : '') + '">' + fmt.pct0(r.authenticity) + '</span>'; } },
          { key: 'deals', label: '合作次数', sortable: true, align: 'right', fmt: 'int' },
          { key: 'roi', label: '历史 ROI', sortable: true, align: 'right', render: function (r) { return r.predictable ? '<b class="' + (r.roi >= 3 ? 'ok' : (r.roi < 2 ? 'bad' : '')) + '">' + r.roi.toFixed(2) + '</b><div class="td-sub">' + h.esc(r.roiRange) + '</div>' : '<span class="muted" data-tip="无历史合作记录，无法推导">数据不足</span>'; } },
          { key: 'costPerConv', label: '获客成本', align: 'right', render: function (r) { return r.costPerConv ? '¥' + Math.round(r.costPerConv).toLocaleString('zh-CN') : '<span class="muted">—</span>'; } },
          { key: 'conf', label: '置信度', render: function (r) { return r.predictable ? '<span class="pill ' + (r.conf === 'high' ? 'ok' : (r.conf === 'medium' ? 'warn' : 'bad')) + '">' + confLabel(r.conf) + '</span>' : '<span class="muted">—</span>'; } },
          { key: 'risk', label: '风险标记', render: function (r) { return r.risk === '—' ? '<span class="muted">—</span>' : '<span class="warn">' + h.esc(r.risk) + '</span>'; } },
          { key: 'status', label: '结论', render: function (r) { return h.pill(r.status, r.statusText); } },
          { key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="kol-detail" data-id="' + h.esc(r.id) + '">详情</button>'; } }
        ],
        rows: rows, sortBy: 'roi', sortDir: 'desc', pageSize: 20, rowAction: null,
        emptyTitle: '达人库为空'
      }) + '</div>' +
      h.metaBar({}, [
        { k: '系数来源', v: '触达率 / CTR / CVR / 客单价 / ROI 全部由历史合作明细聚合，非人工填写' },
        { k: '置信度', v: '高 ≥5 次合作 / 中 3-4 次 / 低 1-2 次 / 无 0 次；置信度决定 ROI 区间宽度' },
        { k: '排序', v: '默认按历史 ROI 倒序；无数据达人排在末尾而非按 0 处理（按 0 会误导为"表现差"）' }
      ]);
  }

  /* SECTION: kol-detail */
  function detailView(h, fmt, kolId) {
    var m = K.metrics(kolId);
    if (!m) return '<div class="fatal"><h2>达人不存在</h2><button class="btn-primary" data-act="kol-view" data-id="library">返回达人库</button></div>';
    var audit = K.roiAudit(kolId);
    var deals = K.ACTIVE_DEALS.filter(function (d) { return d.kolId === kolId; });
    var f = K.forecast(kolId);

    var head = '<div class="card"><div class="card-h">' +
      '<h3>' + h.esc(m.kol.name) + '</h3>' +
      h.pill(!m.predictable ? 'idle' : (m.roi >= 3 ? 'ok' : 'warn'), !m.predictable ? '数据不足' : (m.roi >= 3 ? '推荐' : '可考虑')) +
      '<span class="card-sub">' + h.esc(m.kol.platform) + ' · ' + fmt.compact(m.kol.followers) + ' 粉丝 · ' + h.esc(m.kol.category) + ' · 报价 ' + fmt.money(m.kol.quote) + '</span>' +
      '<button class="btn-ghost sm" data-act="kol-view" data-id="library">← 返回达人库</button></div>' +
      '<div class="impact-grid">' +
      '<div class="imp"><i>客群重合度</i><b>' + fmt.pct0(m.kol.overlap) + '</b><span>与目标客群的匹配程度</span></div>' +
      '<div class="imp"><i>粉丝真实性</i><b class="' + (m.kol.authenticity < 0.7 ? 'bad' : '') + '">' + fmt.pct0(m.kol.authenticity) + '</b><span>互动率与增长曲线检测</span></div>' +
      '<div class="imp"><i>历史合作</i><b>' + m.deals + '</b><span>置信度' + confLabel(m.confidence) + '</span></div>' +
      '<div class="imp"><i>历史 ROI</i><b class="' + (m.predictable && m.roi < 2 ? 'bad' : '') + '">' + (m.predictable ? m.roi.toFixed(2) : '—') + '</b><span>' + (m.predictable ? '区间 ' + m.roiLow.toFixed(2) + '~' + m.roiHigh.toFixed(2) : '无数据') + '</span></div>' +
      '</div></div>';

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

  /* SECTION: kol-actions */
  var A = global.ACTIONS;
  A['kol-view'] = function (id, btn, h) {
    h.state.kol = h.state.kol || {};
    h.state.kol.view = id;
    if (id === 'planner' && !h.state.kol.budget) h.state.kol.budget = 100000;
    h.navigate({});
  };
  A['kol-detail'] = function (id, btn, h) {
    h.state.kol = h.state.kol || {};
    h.state.kol.view = 'detail';
    h.state.kol.kolId = id;
    h.navigate({});
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
  A['kol-plan'] = function (id, btn, h) {
    h.navigate({});
  };

  global.RENDERERS = R;
  global.ACTIONS = A;
})(window);
