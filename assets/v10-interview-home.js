/* SECTION: r-interview-home-v2  (AI 访谈作业台 · 首页按需求重排)
 * 布局（自上而下 / 右侧固定历史问卷）—— 顺序即作业顺序：
 *   ① 填问卷内容（在上方填入）—— 名称 + 访谈内容 + 派发设置
 *   ② 选人 —— 搜索 / 标签筛选 / JEV 筛选 / AI 筛选 / 勾选
 *   ③ 发送 —— 派几个 AI、1 对 1、发送按钮（发送后才谈得上"列表"）
 *   ④ 问卷列表 —— 每个任务的进度，点「用户列表」就地展开
 *   右侧：历史问卷 —— 点开切换当前问卷
 *   ⑤ 问卷评价 —— 不在这页：搬去详情页第七个页签，这里只留入口
 * 弹窗：先给用户列表；点某个人 → 左「谈话内容·原始记录」/ 右「对内容的分析」
 *
 * 只做前端；模拟数据当真数据用（不贴"示例"免责标签）。本文件覆盖 RENDERERS.interviewHome，
 * 必须在 v10-interview.js 之后加载。
 */
(function (global) {
  'use strict';
  var R = global.RENDERERS, A = global.ACTIONS, S = global.DATA_SEED;
  var V = global.V10UI || {};

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function esc(h, s) { return h.esc(s == null ? '' : s); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function tables() { try { return global.APP_DATA.getAssetTables() || {}; } catch (e) { return {}; } }
  function pill(h, kind, text) { return typeof h.pill === 'function' ? h.pill(kind, text) : '<span class="pill ' + kind + '">' + h.esc(text) + '</span>'; }

  var STATES = [
    { k: 'pending', t: '未联系', tone: 'idle' },
    { k: 'dialing', t: '正在联系中', tone: 'info' },
    { k: 'interrupted', t: '联系中断', tone: 'warn' },
    { k: 'unreachable', t: '联系不上', tone: 'bad' },
    { k: 'done', t: '联系完成', tone: 'ok' }
  ];
  var SL = {}; STATES.forEach(function (x) { SL[x.k] = x.t; });

  /* ---------- 与详情页同一套口径（这里只要分布，不生成明细行，保证首页够快） ---------- */
  function stateMix(row) {
    if (row.status === 'warn') return { pending: 1, dialing: 0, interrupted: 0, unreachable: 0, done: 0 };
    if (row.status === 'info') return { pending: 0.26, dialing: 0.18, interrupted: 0.09, unreachable: 0.05, done: 0.42 };
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
  /* ---------- 数据层（唯一出口）：本页只读 IV_DATA，不自己造数 ---------- */
  var IVD = global.IV_DATA || {};
  function funnelOf(row) {
    if (IVD.funnelOf) return IVD.funnelOf(row);
    return { f: { pending: 0, dialing: 0, interrupted: 0, unreachable: 0, done: 0 }, total: 0 };
  }
  function contactRows(row, cap) { return IVD.contacts ? IVD.contacts(row, cap) : []; }
  function turnsOf(row, person) { return IVD.turns ? IVD.turns(row, person) : []; }
  function bar(h, f, total, small) {
    var order = ['pending', 'dialing', 'interrupted', 'unreachable', 'done'];
    var seg = order.map(function (k) {
      var w = total ? (f[k] / total * 100) : 0;
      if (w <= 0) return '';
      return '<span class="iv-seg iv-' + k + '" style="width:' + w.toFixed(2) + '%" title="' + esc(h, SL[k]) + ' ' + f[k] + ' 人"></span>';
    }).join('');
    return '<div class="iv-bar' + (small ? ' sm' : '') + '">' + seg + '</div>';
  }

  /* 标签字典（示例数据，但口径 / 来源 / 责任人 / 更新频率都写出来；人数按标签自己的口径，
     不拿画像的"覆盖企业数"顶替 —— 那是工程里明令禁止的旧错） */
  var TAGS = [
    { n: '合同到期前 60 天', c: 2982, src: 'CRM 合同表', own: '—', freq: '每日' },
    { n: '年采购额 > 1000 万', c: 1140, src: 'CRM 订单表', own: '—', freq: '每日' },
    { n: '账期敏感', c: 640, src: '合同条款解析', own: '—', freq: '每周' },
    { n: '近 30 天活跃下降 > 40%', c: 1876, src: '产品埋点', own: '—', freq: '每小时' },
    { n: '工单未闭环 ≥ 2 条', c: 402, src: '工单系统', own: '—', freq: '每小时' },
    { n: '近 90 天有负面反馈', c: 733, src: '客服会话 + 投诉', own: '—', freq: '每日' }
  ];

  /* ---------- 历史问卷：往期几场（点开切换） ---------- */
  var HISTORY = [
    { id: 'h1', name: '续约意愿深访', when: '2026-09-18', n: 420, done: 388, note: '结论已归档 · 高意向 31%' },
    { id: 'h2', name: '流失原因回访', when: '2026-08-30', n: 360, done: 341, note: '结论已归档 · 主因：集成难度' },
    { id: 'h3', name: '新人上手体验访谈', when: '2026-08-02', n: 210, done: 205, note: '结论已归档 · 缺口：培训材料' }
  ];

  /* ---------------- 搜索框：本地实时过滤（不重渲染，输入即筛） ---------------- */
  global.IV_POOL_FILTER = function (q) {
    var s = String(q || '').trim().toLowerCase();
    var cards = document.querySelectorAll('.iv-person');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var hit = !s || String(cards[i].innerText || '').toLowerCase().indexOf(s) >= 0;
      cards[i].style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    var sub = document.querySelector('.iv-pool-count');
    if (sub) sub.innerHTML = '当前显示 <b>' + shown + '</b> 位';
  };

  /* ---------- 问卷列表下面：这份问卷的看板（卡片网格，不是列表） ---------- */
  function summaryCard(row, h) {
    var an = (IVD.analysis ? IVD.analysis(row) : null);
    if (!an) return '';
    var ev = an.evaluation || {};
    var rv = (IVD.questionnaireReview ? IVD.questionnaireReview(row) : null);
    return '<div class="card"><div class="card-h split"><h3>问卷看板</h3>' +
      /* 卡头必须说清卡里到底是哪两件事 —— 这四个 KPI（平均轮次 / 必问覆盖 / 低质量比例 / 结论审核通过率）
         是**执行质量**（这场访谈做得怎么样、结论能不能用），归「结论与分析」页；
         下面的「问卷评价」才是**设计质量**（这份提纲怎么改）。
         此前卡头只写「AI 怎么评这份提纲」，等于把执行质量的数字挂在了设计质量的承诺下。 */
      '<span class="card-sub">' + esc(h, row.name) + ' · 结论 · 执行质量 · 提纲评价</span>' +
      '<div class="card-act">' +
      '<button class="btn-ghost sm" data-act="iv-pack" data-id="' + esc(h, row.id) + '">打包 4 件套</button>' +
      '<button class="btn-ghost sm" data-act="iv-open-plan" data-id="' + esc(h, row.id) + '">看完整分析 →</button></div></div>' +
      /* 结论条 */
      '<div style="font-size:14.5px;font-weight:600;line-height:1.8;background:#f8fafc;border:1px solid #CFE0FF;border-radius:8px;padding:10px 12px;margin-bottom:12px">' +
      esc(h, an.headline || '—') + '</div>' +
      /* KPI 块 —— 这四个是**执行质量**，与「结论与分析」页同名同口径（那一页叫「本次访谈执行质量」） */
      '<div class="sub-h">执行质量</div>' +
      '<div class="metrics g4" style="margin-bottom:14px">' +
      h.metricCard({ label: '平均轮次', value: (ev.avgRounds || 0).toFixed(1), unit: '轮', sub: '3–7 轮的占 ' + ((ev.inRangeRate || 0) * 100).toFixed(0) + '%' }) +
      h.metricCard({ label: '必问覆盖', value: an.coverage.text, unit: '', sub: '必问话题实际问到' }) +
      h.metricCard({ label: '低质量比例', value: (an.lowQuality.rate * 100).toFixed(1) + '%', unit: '', sub: an.lowQuality.n + ' 条' }) +
      h.metricCard({ label: '结论审核通过率', value: ((ev.auditPassRate || 0) * 100).toFixed(0) + '%', unit: '', sub: '未过审已退回补充' }) +
      '</div>' +
      /* 关键发现：卡片网格 */
      '<div class="sub-h">关键发现</div>' +
      '<div class="iv-board" style="margin-bottom:14px">' + (an.findings || []).map(function (f) {
        return '<div class="iv-tile' + (f.strength === '个例' ? ' bad' : '') + '">' +
          /* 证据等级右上角 —— 原来挂在引语末尾，卡宽不同会让 pill 一会儿在行末一会儿掉到下一行 */
          '<div class="iv-tile-h"><span class="iv-tile-n">' + f.n + '<em>人 · ' + (f.share * 100).toFixed(0) + '%</em></span>' +
          (f.strength === '充分' ? '<span class="pill ok">证据充分</span>' : '<span class="pill bad">个例</span>') + '</div>' +
          '<div class="iv-tile-t">' + esc(h, f.t) + '</div>' +
          '<div class="iv-tile-q">「' + esc(h, f.quote) + '」—— ' + esc(h, f.who) + '</div></div>';
      }).join('') + '</div>' +
      /* 分人群：卡片网格 */
      '<div class="sub-h">分人群差异</div>' +
      '<div class="iv-board" style="margin-bottom:14px">' + (an.segments || []).map(function (s) {
        return '<div class="iv-tile"><div class="iv-tile-n">' + s.n + '<em>人有效对话</em></div>' +
          '<div class="iv-tile-t">' + esc(h, s.seg) + '　最在意：' + esc(h, s.top) + '</div>' +
          '<div class="iv-tile-q">意向 ' + esc(h, s.intent) + '　·　' + esc(h, s.note) + '</div></div>';
      }).join('') + '</div>' +
      /* AI 对这份问卷的评价 —— 直接铺开，不藏在入口卡后面。
         内容与详情页第七个页签「问卷评价」同源同文（都取 IVD.questionnaireReview），
         这里只是不用点开就看得见；点「采纳」在本会话留痕，两处状态一致。 */
      (rv ? '<div class="sub-h">问卷评价</div>' +
        '<div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:#fbfcfe;margin-bottom:14px">' +
        '<div style="font-size:13.5px;font-weight:600;line-height:1.8;background:#fff;border:1px solid #CFE0FF;border-radius:8px;padding:9px 11px">' +
        esc(h, rv.verdict) + '</div>' +
        '<div class="grid2 why-cols" style="margin-top:12px">' +
        '<div><div class="sub-h">保持</div>' + rv.good.map(function (x) {
          return '<div class="why-item"><span>✔ ' + esc(h, x) + '</span></div>';
        }).join('') + '</div>' +
        '<div><div class="sub-h bad">需要修改</div>' + rv.bad.map(function (x) {
          return '<div class="why-item"><span>✕ ' + esc(h, x) + '</span></div>';
        }).join('') + '</div>' +
        '</div>' +
        '<div class="sub-h">下一版建议</div>' +
        '<div class="why-list why-next">' + rv.next.map(function (x, i) {
          var on = !!(state0().ivAdopted || {})[i];
          return '<div class="why-item' + (on ? ' skip' : '') + '">' +
            '<div style="display:flex;align-items:center;gap:9px">' +
            '<button class="btn-ghost sm" data-act="iv-adopt" data-id="' + i + '"' + (on ? ' disabled' : '') + '>' + (on ? '已采纳' : '采纳') + '</button>' +
            '<b' + (on ? ' style="color:var(--decor);text-decoration:line-through"' : '') + '>' + esc(h, x) + '</b></div></div>';
        }).join('') + '</div>' +
        '</div>' : '') +
      /* 可信度与局限 */
      '<div class="dl" style="margin-top:12px">' +
      '<dt>结论可信度</dt><dd>证据充分 ' + (ev.evidence || {}).solid + ' 条 · 个例 ' + (ev.evidence || {}).single + ' 条 · 数据不足 ' + (ev.evidence || {}).insufficient + ' 条</dd>' +
      '<dt>局限</dt><dd>' + ((ev.limits || []).join('　·　')) + '</dd>' +
      '</div></div>';
  }
  function state0() { return (global.APP_SHELL && global.APP_SHELL.state) || {}; }

  /* ============================================================
   * 首页
   * ============================================================ */
  R.interviewHome = function (cap, state, h) {
    var t = tables().survey;
    if (!t) return '<div class="fatal"><h2>未配置的数据表</h2></div>';
    var rows = t.rows || [];
    var pool = (tables().user_pool || {}).rows || [];

    var activeId = state.ivActive || (rows[0] && rows[0].id);
    var row = null;
    rows.forEach(function (x) { if (x.id === activeId) row = x; });
    if (!row) row = rows[0];
    var wb = funnelOf(row);

    var picked = state.ivPicked || [];
    var screen = state.ivScreen || null;               /* 'jev' | 'ai' | null */
    var tagFilter = state.ivTagFilter || null;

    /* ---------- 用户池筛选 ---------- */
    var allTags = {};
    pool.forEach(function (p) { (p.tags || []).forEach(function (g) { allTags[g] = (allTags[g] || 0) + 1; }); });
    var topTags = Object.keys(allTags).sort(function (a, b) { return allTags[b] - allTags[a]; }).slice(0, 10);

    var shown = pool.filter(function (p) {
      if (tagFilter && (p.tags || []).indexOf(tagFilter) < 0) return false;
      if (screen === 'jev') return p.named && num(p.jevScore, 0) >= 0.7;
      if (screen === 'ai') return p.named && (p.tags || []).length > 0 && num(p.fidelity, 0) >= 0.8;
      return true;
    });
    var namedShown = shown.filter(function (p) { return p.named; }).length;

    /* 2026-10-19 业主：搜索 / 标签 chips / JEV 筛选 / AI 筛选 这一整行撤掉 ——
       挑人区只剩人名网格，不再用筛选器做二次收窄。 */
    var toolbar = '';

    function personBtn(p) {
      var on = picked.indexOf(p.id) >= 0;
      var can = !!p.named;
      return '<button class="iv-person' + (on ? ' on' : '') + (can ? '' : ' off') + '" data-act="iv-pick" data-id="' + esc(h, p.id) + '">' +
        '<span class="iv-check">' + (on ? '✓' : '') + '</span>' +
        '<span class="iv-ava">' + esc(h, p.initial || '?') + '</span>' +
        '<b>' + esc(h, p.name || '待判定') + '</b>' +
        '<i>' + esc(h, p.country || '—') + ' · ' + esc(h, String(p.age == null ? '—' : p.age)) + '</i>' +
        /* 2026-10-19 业主：卡片上的 JEV 分数去掉 —— 挑人看的是这个人，不是分数。 */
        (can
          ? '<span class="iv-meta">' + (p.job ? esc(h, p.job) : '—') + '</span>'
          : '<span class="iv-meta">未具名 · 需先判定</span>') +
        '</button>';
    }
    /* 默认全部展示（2026-10-17 业主定）：50 位都具名了，不再折叠，
       「另有 36 位 · 显示全部」那行与开关一并撤掉。 */
    var grid = '<div class="iv-pool">' + shown.map(personBtn).join('') + '</div>' +
      (shown.length ? '' : '<div class="bt-note">没有符合筛选条件的样本。换个标签，或点「清空筛选」。</div>');

    /* 挑人四种方式（标签组合 / 用户池 / 运营分群 / 导入名单）——入口已撤（2026-10-19），
       但分支代码保留：将来要恢复来源卡，把 srcPick 与 src 这两处改回来即可。 */
    var src = 'pool';
    var segs = [];
    try { segs = (global.APP_DATA.getPipelines().userops || {}).segments || []; } catch (e) { segs = []; }
    function srcBtn(k, t, sub) {
      /* 同 app.js metricCard 的修复：<button> 内不得放块级 <div>，改 div[role=button]。 */
      return '<div class="pick-btn' + (src === k ? ' on' : '') + '" role="button" tabindex="0" data-act="iv-src" data-id="' + k + '">' + esc(h, t) +
        '<div class="pick-or" style="margin-top:4px">' + esc(h, sub) + '</div></div>';
    }
    /* 2026-10-19 业主：四张来源卡（标签组合 / 用户池 / 运营分群 / 导入名单）撤掉 ——
       挑人只走「池子里勾人」这一条路，不再让人先选来源。 */
    var srcPick = '';

    var srcBody;
    if (src === 'tag') {
      var tagList = TAGS.map(function (t) {
        var on = tagFilter === t.n;
        return '<span class="chip' + (on ? ' link on' : '') + '" data-act="iv-tagfilter" data-id="' + esc(h, t.n) + '">' + esc(h, t.n) +
          ' <b>' + t.c.toLocaleString('zh-CN') + '</b></span>';
      }).join('');
      var est = tagFilter ? ((TAGS.filter(function (t) { return t.n === tagFilter; })[0] || {}).c || 0) : 0;
      srcBody = '<div class="sub-h">标签（带覆盖数与口径）</div><div class="chips">' + tagList + '</div>' +
        '<div class="bt-note" style="margin-top:8px">标签人数是标签自己的口径（来源 / 更新频率随标签展示），<b>不拿画像的"覆盖企业数"顶替</b>。' +
        (tagFilter ? '当前选中「' + esc(h, tagFilter) + '」覆盖 ' + est.toLocaleString('zh-CN') + ' 位，可派发 ' + est.toLocaleString('zh-CN') + ' 位。' : '选一个标签看覆盖数。') + '</div>';
    } else if (src === 'segment') {
      srcBody = '<div class="sub-h">运营分群（复用圈人结果）</div><div class="fc-steps">' +
        segs.map(function (s) {
          return '<div class="fc-step"><i>群</i><span>' + esc(h, s.name) + '</span><span class="mono">' + Math.round(s.cover || 0).toLocaleString('zh-CN') + ' 人</span>' +
            '<span><button class="btn-ghost sm" data-act="iv-use-seg" data-id="' + esc(h, s.id) + '">用这个分群</button></span></div>';
        }).join('') + '</div>' +
        '<div class="bt-note">分群覆盖数取运营圈人的最新圈选结果；下发前自动排除频控内、已退订与黑名单。</div>';
    } else if (src === 'import') {
      srcBody = '<div class="dl">' +
        '<dt>文件</dt><dd>访谈名单_20261006.csv · 1,240 行</dd>' +
        '<dt>校验</dt><dd>手机号格式 ✓ · 重复 12 行（已去重）· 缺联系方式 3 行（已剔除）</dd>' +
        '<dt>可用</dt><dd><b>1,225</b> 位（去重去缺后）</dd>' +
        '</div><div class="bt-note">导入的是"联系方式名单"，进来后仍是 1 对 1 谈，不是发问卷。</div>';
    } else {
      srcBody = toolbar + grid;
    }

    var poolCard = '<div class="card"><div class="card-h"><h3>② 挑人</h3>' +
      /* 2026-10-19：筛选入口撤掉后「当前显示 / 池内」是同一个数，不再并列写两遍。 */
      '<span class="card-sub">池内 <b>' + pool.length + '</b> 位 · 可派发 ' + namedShown + ' · 已选 <b>' + picked.length + '</b> 位</span></div>' +
      srcPick + srcBody +
      '<div class="bt-note" style="margin-top:6px">退订 / 黑名单 / 频控按规则剔除，不占用派发名额。</div></div>';

    /* ---------- ③ 发送（从「挑人」里独立出来：填完问卷、挑完人，第三步就是发出去） ---------- */
    var dispF = funnelOf(row);
    var sendCard = '<div class="card"><div class="card-h"><h3>③ 发送</h3>' +
      /* v10b：把「发给已选的 X 位」改为「追加进该问卷队列」—— iv-dispatch 的真实语义就是
       追加（toast 已说「到该问卷：进入联系队列」），卡头口径与动作对齐，消除「新建还是追加」歧义 */
      '<span class="card-sub">确认派发设置，把已选的 <b>' + picked.length + '</b> 位追加进「' + esc(h, row.name) + '」的联系队列</span>' +
      '<span style="margin-left:auto">' + pill(h, picked.length ? 'ok' : 'idle', picked.length ? '可派发' : '还没挑人') + '</span></div>' +
      '<div class="iv-dispatchbar">' +
      '<div class="iv-ai"><span>派几个 AI</span>' +
      /* v10b（走查 3.4）：这两组是写死的演示配置，不是可点选项 ——
         旧的 chip.link 长得像能点但点了没反应。改为纯展示 chip.on（当前配置态）。 */
      '<span class="chip on">2 个访谈员</span><span class="chip">3 个</span><span class="chip">4 个</span>' +
      '<span class="chip on">1 对 1（一个联系人固定一个 AI）</span><span class="chip">池化轮转</span></div>' +
      '<button class="btn-primary" data-act="iv-dispatch" data-id="' + esc(h, row.id) + '">发送到「' + esc(h, row.name) + '」</button>' +
      '</div>' +
      '<div class="dl" style="margin-top:10px">' +
      '<dt>发给谁</dt><dd>' + (picked.length ? ('已选 ' + picked.length + ' 位 · 追加进「' + esc(h, row.name) + '」队列，与存量进度合并展示') : '还没挑人 —— 回上面「② 挑人」勾选') + '</dd>' +
      '<dt>怎么发</dt><dd>企微 → 短信（失败降级）· 09:00–20:00 · 每人 14 天 ≤ 1 次</dd>' +
      '<dt>发送后</dt><dd>进入「④ 问卷列表」看进度；每人一个 AI 1 对 1 谈，谈完进「访谈记录 / 访谈审核」</dd>' +
      '</div>' +
      '<div class="bt-note">派发时自动剔除已退订、黑名单与频控内的样本。' +
      (dispF.total ? ('当前这份问卷计划 <b>' + dispF.total.toLocaleString('zh-CN') + '</b> 位，已联系完成 <b>' + dispF.f.done.toLocaleString('zh-CN') + '</b> 位。') : '') +
      '</div></div>';

    /* ---------- ① 问卷内容（上方填入） ---------- */
    /* v10b：副标题点明编辑对象 —— 原来只说「把要问的写在这里」，用户分不清是在编辑存量问卷
       还是新建一份（④ 列表里同名存量问卷 2,680 人正在跑）。把对象说清，③④ 的对象关系才接得上。 */
    /* 卡头只留标题 + 类型标签（标签靠右），与模拟页「① 本轮方案 / ① 待评估内容」同一套卡型 */
    var qCard = '<div class="card"><div class="card-h"><h3>① 问卷内容</h3>' +
      '<span style="margin-left:auto">' + pill(h, 'ok', '话题式') + '</span></div>' +
      '<div class="iv-form">' +
      '<label class="iv-field"><span>问卷名称</span>' +
      '<input class="iv-input" data-iv="q-name" value="' + esc(h, row.name) + '" /></label>' +
      '<label class="iv-field"><span>访谈内容（话题 / 必问 / 禁问，一行一条）</span>' +
      '<textarea class="iv-input" data-iv="q-body" rows="6">' + esc(h, (IVD.outlineText ? IVD.outlineText() : '')) + '</textarea></label>' +
      '<div class="iv-row">' +
      '<label class="iv-field sm"><span>引用知识库</span>' +
      '<select class="iv-input" data-iv="q-kb"><option>产品文档库（必引 · 须给出处）</option><option>销售话术库（参考）</option><option>不用知识库</option></select></label>' +
      '<label class="iv-field sm"><span>派发渠道</span>' +
      '<select class="iv-input" data-iv="q-ch"><option>企微 → 短信</option><option>仅企微</option><option>仅短信</option></select></label>' +
      '<label class="iv-field sm"><span>时段</span>' +
      '<select class="iv-input" data-iv="q-time"><option>09:00–20:00</option><option>10:00–18:00</option></select></label>' +
      '<label class="iv-field sm"><span>每人频次</span>' +
      '<select class="iv-input" data-iv="q-freq"><option>14 天 ≤ 1 次</option><option>7 天 ≤ 1 次</option></select></label>' +
      /* 两个动作贴到卡片右下角，与模拟页「保存方案 / 提交跑批」同一位置 */
      '<button class="btn-ghost" style="margin-left:auto" data-act="iv-save-q">保存问卷内容</button>' +
      /* 主行动给蓝色：保存是留在此页，进详细编排是往前走（与模拟页「保存方案/提交跑批」同一主次） */
      '<button class="btn-primary" data-act="iv-open-plan" data-id="' + esc(h, row.id) + '">进详细编排 →</button>' +
      '</div></div></div>';

    /* ---------- ③ 问卷列表（左栏 · 可点开原地展开用户列表） ---------- */
    /* 默认展开：最上方（当前选中）那份问卷的用户列表先摆出来 —— 打开就能看到人；
       用户手动收起后就记住收起（ivOpenTask = null） */
    var openId = (state.ivOpenTask === undefined) ? row.id : state.ivOpenTask;
    var listRows = rows.map(function (r) {
      var w = funnelOf(r);
      var pct = w.total ? Math.round((w.f.done / w.total) * 100) : 0;
      var reviewN = Math.round(w.f.done * 0.14);
      var isOpen = openId === r.id;
      var main = '<tr' + (r.id === row.id ? ' class="iv-cur"' : '') + '>' +
        '<td><button class="lnk" data-act="iv-active" data-id="' + esc(h, r.id) + '"><b>' + esc(h, r.name) + '</b></button>' +
        '<div class="td-sub">' + esc(h, r.target || '') + ' · 话题式</div></td>' +
        '<td style="width:236px"><div class="iv-bar-wrap">' + bar(h, w.f, w.total, true) + '</div>' +
        '<div class="td-sub">完成 ' + w.f.done.toLocaleString('zh-CN') + ' · 联系不上 ' + w.f.unreachable + ' · 联系中 ' + w.f.dialing + ' · 未联系 ' + w.f.pending + '</div></td>' +
        '<td class="ta-r">' + w.total.toLocaleString('zh-CN') + '</td>' +
        '<td class="ta-r">' + (reviewN ? '<span class="warn">' + reviewN + '</span>' : '0') + '</td>' +
        '<td>' + pill(h, r.status, r.statusText) + '</td>' +
        '<td><button class="btn-ghost sm" data-act="iv-toggle-users" data-id="' + esc(h, r.id) + '">用户列表 ' + (isOpen ? '▴' : '▾') + '</button></td>' +
        '</tr>';
      if (!isOpen) return main;
      /* 展开：这份问卷的用户列表（原地，不弹窗） */
      /* 2026-10-20 走查修复：原来硬取 40 条、页面也没有任何"看更多"的出口 ——
         「共 2,680 位」但第 41 位之后在界面上根本拿不到。现在按 state 分页，默认 40、
         每次 +80，并在表尾给一行明确的"还有多少人没展开"。 */
      var shownN = (state.ivShown && state.ivShown[r.id]) || 40;
      var list = contactRows(r, shownN);
      /* 整行可点：点用户列表里的这一行就进他的详情（不是找"看记录"按钮） */
      var detailRows = list.map(function (c) {
        return '<tr data-act="iv-user" data-id="' + esc(h, r.id + '|' + c.id) + '" style="cursor:pointer">' +
          '<td class="c1"><span class="iv-a"><span class="iv-ava sm">' + esc(h, String(c.name || '?').charAt(0)) + '</span>' + esc(h, c.name) +
          '<span class="iv-ph">' + esc(h, c.phone) + '</span></span></td>' +
          '<td class="c2">' + esc(h, c.seg) + '</td>' +
          '<td class="c3">' + pill(h, c.tone, c.stateText) + '</td>' +
          '<td class="c4 ta-r">' + c.rounds + '</td>' +
          '<td class="c5">' + esc(h, c.cover) + '</td>' +
          '<td class="c6">' + pill(h, c.quality === '正常' ? 'ok' : (c.quality === '已中止' ? 'bad' : 'warn'), c.quality) + '</td>' +
          '<td class="c7">' + pill(h, c.reviewTone, c.reviewText) + '</td>' +
          '<td class="c8"></td>' +
          '</tr>';
      }).join('');
      return main + '<tr><td colspan="6" style="background:#fbfcfe;padding:0 12px 12px">' +
        '<div class="card-sub" style="margin:6px 0 8px">' + esc(h, r.name) + ' · 用户列表（显示前 ' + list.length + ' 位 / 共 ' + w.total.toLocaleString('zh-CN') + ' 位）· 点一行看这个人的谈话与分析</div>' +
        '<table class="bt iv-ul"><thead><tr><th class="c1">联系人</th><th class="c2">人群</th><th class="c3">联系状态</th><th class="c4 ta-r">轮次</th><th class="c5">必问覆盖</th><th class="c6">质量</th><th class="c7">审核</th><th class="c8"></th></tr></thead><tbody>' +
        detailRows +
        (w.total > list.length
          ? '<tr><td colspan="8" style="text-align:center;padding:14px">' +
            '<span class="td-sub" style="margin-right:12px">还有 ' + (w.total - list.length).toLocaleString('zh-CN') + ' 位未展开</span>' +
            '<button class="btn-ghost sm" data-act="iv-more" data-id="' + esc(h, r.id) + '">再看 80 位 →</button>' +
            (w.total - list.length > 80 ? ' <button class="lnk" data-act="iv-more" data-id="' + esc(h, r.id) + '|all">展开全部（' + w.total.toLocaleString('zh-CN') + ' 位，较慢）</button>' : '') +
            '</td></tr>'
          : '') +
        '</tbody></table></td></tr>';
    }).join('');

    var listCard = '<div class="card pad0" id="iv-list"><div class="card-h pad"><h3>④ 问卷列表</h3>' +
      '<span class="card-sub">' + rows.length + ' 份 · 点「用户列表」在下面就地展开每个人谈到哪</span></div>' +
      '<table class="bt"><thead><tr><th>问卷</th><th>进度（完成 / 联系不上 / 联系中 / 未联系）</th><th class="ta-r">计划</th><th class="ta-r">待审</th><th>状态</th><th></th></tr></thead>' +
      '<tbody>' + listRows + '</tbody></table></div>';

    /* ---------- 右侧：历史问卷 + 名单来源 + 过程监控 ---------- */
    var ls = row.listSource || {};
    var srcText = ls.kind === 'import'
      ? ('导入名单：' + esc(h, ls.file || '—') + '（' + (ls.count || 0).toLocaleString('zh-CN') + ' 行）')
      : (ls.kind === 'segment'
        ? ('运营分群：' + esc(h, ((segs.filter(function (s) { return s.id === ls.segId; })[0] || {}).name || ls.segId || '—')))
        : '标签组合：合同到期前 60 天 ∧ 年采购额 > 1000 万');
    var w0 = funnelOf(row);
    var aborts0 = contactRows(row, 60).filter(function (c) { return c.aborted; }).slice(0, 3);
    var aside = '<div class="iv-side">' +
      '<div class="card"><div class="card-h"><h3>历史问卷</h3><span class="card-sub">点开切换</span></div>' +
      '<div class="iv-hist">' +
      rows.map(function (r) {
        return '<button class="iv-hist-item' + (r.id === row.id ? ' on' : '') + '" data-act="iv-active" data-id="' + esc(h, r.id) + '">' +
          '<b>' + esc(h, r.name) + '</b><i>' + esc(h, r.statusText) + '</i></button>';
      }).join('') +
      HISTORY.map(function (x) {
        return '<button class="iv-hist-item" data-act="iv-hist" data-id="' + esc(h, x.id) + '">' +
          '<b>' + esc(h, x.name) + '</b><i>' + esc(h, x.when) + ' · ' + x.done + '/' + x.n + ' 完成</i>' +
          '<span class="iv-hist-note">' + esc(h, x.note) + '</span></button>';
      }).join('') +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>名单来源</h3><span class="card-sub">这份问卷谈谁</span></div>' +
      '<div class="dl"><dt>来源</dt><dd>' + srcText + '</dd>' +
      '<dt>计划</dt><dd>' + w0.total.toLocaleString('zh-CN') + ' 位</dd>' +
      '<dt>排除</dt><dd>频控内 300 · 已退订 40 · 黑名单 4</dd></div>' +
      /* 复检（死面板工单）：本卡原来只自述"谈谁"，一个出口都没有 —— 而"排除"这四个数
         恰恰是别处维护的规则：退订 / 黑名单 / 频控在用户运营的「触达防护」里改。
         给真跳转（goto-cap 已在 renderers2.js 注册，data-id 就是能力 id user-ops），
         不写"点这里设置"却点不动的空控件。改来源本身在下面「② 挑人」里选，不在这里重复入口。 */
      '<div class="bt-note" style="margin-top:8px">排除口径不在这里改：' +
      '<button class="lnk" data-act="goto-cap" data-id="user-ops">退订 / 黑名单 / 频控在「用户运营 · 触达防护」维护 →</button></div></div>' +
      '<div class="card"><div class="card-h"><h3>过程监控</h3><span class="card-sub">当前这份的最新状态</span>' +
      '<button class="btn-ghost sm" data-act="iv-goto-live" data-id="' + esc(h, w0.id) + '" title="到实时作业台看正在进行的访谈">看实时进度 →</button></div>' +
      '<div>' +
      '<div class="iv-flow-item"><div class="iv-flow-h"><b>未联系</b><span>' + w0.f.pending + ' 人</span></div><div class="iv-flow-d">到计划时段自动进入联系</div></div>' +
      '<div class="iv-flow-item"><div class="iv-flow-h"><b>正在联系中</b><span>' + w0.f.dialing + ' 人</span></div><div class="iv-flow-d">24h 无回应转「联系中断」</div></div>' +
      '<div class="iv-flow-item"><div class="iv-flow-h"><b>联系中断</b><span>' + w0.f.interrupted + ' 人</span></div><div class="iv-flow-d">72h / 3 次用尽 → 联系不上</div></div>' +
      '<div class="iv-flow-item"><div class="iv-flow-h"><b>联系不上</b><span>' + w0.f.unreachable + ' 人</span></div><div class="iv-flow-d">终态，可人工重开（≤2 次）</div></div>' +
      '<div class="iv-flow-item"><div class="iv-flow-h"><b>联系完成</b><span>' + w0.f.done.toLocaleString('zh-CN') + ' 人</span></div><div class="iv-flow-d">进入记录与审核</div></div>' +
      '</div>' +
      (aborts0.length
        ? '<div class="sub-h">异常中止</div><div class="act-list">' + aborts0.map(function (c) {
            return '<div class="act-item bad"><span class="act-lv">已中止</span><span class="act-main"><b>' + esc(h, c.name) + '</b><i>' + esc(h, c.quality) + ' · 命中禁问即停，已留痕</i></span></div>';
          }).join('') + '</div>'
        : '<div class="bt-note" style="margin-top:8px">暂无异常中止。</div>') +
      '</div></div>';

    /* 2026-10-17：删掉顶部流程条（① 问卷内容 → … → ⑤ 问卷评价）。
     * 它是一条写死的 span 串：永远高亮「①」，既不随滚动也不随操作变化，还点不动，
     * 却长得像导航。卡片标题本身已经带 ①②③④⑤ 的次序，这条纯属重复且会误导。 */

    return '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('chat', 20) + ' AI 访谈作业台</div>' +
      '<div class="ph-desc">派发 AI 访谈、回收过程记录与审核结论。</div>' +
      '</div><div class="ph-side">' +
      /* v10b：去掉页头裸显的原始权限点 id 徽标（interview:create）—— 全站页头均无权限徽标，
         此为孤例且对业务用户是英文噪音；权限校验由动作触发时的 checkPerm / dangerConfirm 机制承载 */
      '<button class="btn-primary" data-act="iv-create-q">创建问卷</button></div></div>' +
      qCard +
      poolCard +
      sendCard +
      /* 2026-10-24：去掉「左内容 + 右 300px 侧栏」两列包裹（.iv-main）——
         看板在左列时右侧整列空白、右半屏没铺满。改全宽流式：
         列表 → 侧栏三卡横排一行 → 看板独占整行（宽屏内部网格 4 列铺满）。 */
      listCard + aside + summaryCard(row, h) +
      h.metaBar({}, [
        { k: '数据性质', v: '用户池取「全局用户池」（池内 ' + pool.length + ' 位）；联系与进度由访谈服务返回，当前为内置数据' },
        /* 2026-10-19：JEV / AI 筛选入口已撤，口径不再提这两个筛选器。 */
        { k: '可派发样本', v: '池内 ' + pool.length + ' 位全部具名可派发，挑人即加入本轮' },
        { k: '派发口径', v: '派发时自动剔除已退订、黑名单与频控内的样本；每人 14 天 ≤ 1 次' }
      ]) +
      modalHtml(state, h, rows);
  };

  /* ============================================================
   * 弹窗：先用户列表 → 点人换成「左记录 / 右分析」
   * ============================================================ */
  function modalHtml(state, h, rows) {
    var m = state.ivModal;
    if (!m) return '';
    var row = null;
    rows.forEach(function (x) { if (x.id === m.task) row = x; });
    if (!row) return '';
    var person = m.person ? findPerson(row, m.person) : null;

    var body;
    if (!person) {
      var list = contactRows(row, 60);
      body = '<div class="iv-modal-hint">' + esc(h, row.name) + ' · ' + list.length + ' 位（列表显示前 60）· <b>点一行</b>看这个人的谈话记录与看板</div>' +
        '<table class="bt iv-ul"><thead><tr><th class="c1">联系人</th><th class="c2">人群</th><th class="c3">联系状态</th><th class="c4 ta-r">轮次</th><th class="c7">审核</th><th class="c8"></th></tr></thead><tbody>' +
        list.map(function (c) {
          return '<tr data-act="iv-user" data-id="' + esc(h, row.id + '|' + c.id) + '" style="cursor:pointer">' +
            '<td class="c1"><span class="iv-a"><span class="iv-ava sm">' + esc(h, String(c.name || '?').charAt(0)) + '</span>' + esc(h, c.name) +
            '<span class="iv-ph">' + esc(h, c.phone) + '</span></span></td>' +
            '<td class="c2">' + esc(h, c.seg) + '</td>' +
            '<td class="c3">' + pill(h, c.tone, c.stateText) + '</td>' +
            '<td class="c4 ta-r">' + c.rounds + '</td>' +
            '<td class="c7">' + pill(h, c.reviewTone, c.reviewText) + '</td><td class="c8"></td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      var hist = (IVD.historyOf ? IVD.historyOf(row, person) : []);
      var hi = (state.ivHist === undefined || state.ivHist === null) ? 0 : state.ivHist;
      if (hi >= hist.length) hi = 0;
      var isCur = hi === 0;
      /* 左边：本人这次（或点开的那次）的原始记录 */
      var src = isCur ? person : { id: person.id + '-h' + hi, rounds: Math.max(3, person.rounds - hi * 2) };
      var turns = src.rounds > 0 ? turnsOf(row, src) : [];
      var left = '<div class="iv-talk-l"><div class="sub-h">谈话内容 · 原始记录' +
        (isCur ? '' : '　<span class="pill info">历史：' + esc(h, (hist[hi] || {}).when || '') + ' ' + esc(h, (hist[hi] || {}).name || '') + '</span>') +
        (isCur ? '' : '　<button class="btn-ghost sm" data-act="iv-hist-sel" data-id="0">回到本次</button>') + '</div>' +
        (turns.length ? '<div class="iv-chat">' + turns.map(function (t) {
          if (t.role === 'ai') {
            /* AI 访谈员靠右（我方），受访者靠左 */
            return '<div class="row me"><div><div class="who">AI 访谈员' + (t.round ? ' · 第 ' + t.round + ' 轮追问' : '') + '</div>' +
              '<div class="bubble">' + esc(h, t.text) + '</div>' +
              (t.why ? '<div class="note">追问理由：' + esc(h, t.why) + '</div>' : '') +
              (t.kb ? '<div class="note">引用：<b>' + esc(h, t.kb.doc) + '</b>（相关度 ' + t.kb.score + '）</div>' : '') + '</div></div>';
          }
          if (t.role === 'user') {
            return '<div class="row"><div><div class="who">受访者</div><div class="bubble">' + esc(h, t.text) + '</div></div></div>';
          }
          return '<div class="row"><div class="note" style="color:#dc2626">已中止：' + esc(h, t.text) + '</div></div>';
        }).join('') + '</div>' : '<div class="bt-note">这个人还没谈起来（' + esc(h, person.stateText) + '）。谈起来以后这里显示每一轮原始记录。</div>') +
        '</div>';

      /* 右边：看板 —— 上「用户信息」，中「对内容的分析」，下「最近访谈记录」 */
      var pTags = [TAGS[(person.rounds + 1) % TAGS.length].n, TAGS[(person.rounds + 4) % TAGS.length].n];
      var info = '<div class="card" style="margin:0"><div class="card-h"><h3>用户信息</h3><span class="card-sub">这个人是谁</span></div>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' +
        '<span class="iv-ava">' + esc(h, String(person.name || '?').charAt(0)) + '</span>' +
        '<div><div style="font-weight:600;font-size:13.5px">' + esc(h, person.name) + '</div>' +
        '<div class="td-sub">' + esc(h, person.phone) + ' · ' + esc(h, person.seg) + '</div></div></div>' +
        '<div class="dl">' +
        '<dt>名单来源</dt><dd>' + esc(h, row.name) + '（' + esc(h, (row.listSource || {}).kind === 'import' ? '导入名单' : ((row.listSource || {}).kind === 'segment' ? '运营分群' : '标签组合')) + '）</dd>' +
        '<dt>联系状态</dt><dd>' + pill(h, person.tone, person.stateText) + '</dd>' +
        '<dt>谈话进度</dt><dd>第 ' + person.rounds + ' 轮 · 必问覆盖 ' + esc(h, person.cover) + '</dd>' +
        '<dt>访谈员</dt><dd>' + esc(h, person.owner) + '（1 对 1，谈到底不换人）</dd>' +
        '<dt>标签</dt><dd>' + pTags.map(function (t) { return '<span class="chip">' + esc(h, t) + '</span>'; }).join(' ') + '</dd>' +
        '</div></div>';

      /* 分析要能审：每条结论挂原文依据；必问覆盖明细；判不出来的标"数据不足"；给出下一步 */
      var mustAll = (IVD.mustTopics ? IVD.mustTopics() : []);
      var mustTxt = mustAll.map(function (t) { return t.name; }).join(' / ') || '—';
      var gaps = [];
      if (person.chain && String(person.chain).indexOf('未明') >= 0) gaps.push('决策链');
      if (person.rival && String(person.rival).indexOf('未') === 0) gaps.push('竞品对比');
      if ((person.kbN || 0) === 0) gaps.push('知识库出处');
      var nextStep = person.intent === '高意向'
        ? '转商务按合同周期跟进；同时把「' + esc(h, person.need) + '」转产品排期'
        : (person.intent === '中意向'
          ? '把这条结论转产品排期，30 天后再约一轮确认意向'
          : '先解决阻塞项（' + esc(h, person.need) + '）再回访');
      function evBtn(r) { return '　<button class="lnk" data-act="iv-jump" data-id="' + r + '">依据：第 ' + r + ' 轮</button>'; }
      var evMap = { need: 1, mood: 2, intent: 1, rival: 3, chain: 3 };
      var analysis = '<div class="card" style="margin:0"><div class="card-h"><h3>对内容的分析</h3><span class="card-sub">' + (isCur ? '本次' : esc(h, (hist[hi] || {}).when || '')) + '</span></div>' +
        '<div class="dl">' +
        '<dt>核心诉求</dt><dd>' + esc(h, person.need) + '（置信 ' + person.needC + '）' + evBtn(evMap.need) + '</dd>' +
        '<dt>情绪</dt><dd>' + esc(h, person.mood) + '（' + person.moodC + '）' + evBtn(evMap.mood) + '</dd>' +
        '<dt>意向分级</dt><dd>' + esc(h, person.intent) + evBtn(evMap.intent) + '</dd>' +
        '<dt>提及竞品</dt><dd>' + esc(h, person.rival) + (String(person.rival).indexOf('未') === 0 ? '' : evBtn(evMap.rival)) + '</dd>' +
        '<dt>决策链</dt><dd>' + esc(h, person.chain) + (String(person.chain).indexOf('未明') >= 0 ? '　<span class="pill warn">数据不足</span>' : evBtn(evMap.chain)) + '</dd>' +
        '<dt>风险</dt><dd>' + (person.risk ? '<span class="pill bad">' + esc(h, person.risk) + '</span>' : '未发现') + '</dd>' +
        '<dt>必问覆盖</dt><dd>' + esc(h, person.cover) + ' · ' + esc(h, mustTxt) + '</dd>' +
        '<dt>知识库引用</dt><dd>' + person.kbN + ' 处 · 出处核对 ' + (person.risk ? '<span class="pill warn">待核对</span>' : '<span class="pill ok">有效</span>') + '</dd>' +
        '<dt>需要补的</dt><dd>' + (gaps.length ? gaps.map(function (g) { return '<span class="pill warn">' + esc(h, g) + '</span>'; }).join(' ') : '无') + '</dd>' +
        '<dt>结论</dt><dd>' + esc(h, person.conclusion) + '</dd>' +
        '<dt>下一步</dt><dd>' + nextStep + '</dd>' +
        '<dt>审核</dt><dd>' + pill(h, person.reviewTone, person.reviewText) + '</dd>' +
        '</div>' +
        '<div class="btn-row" style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn-ghost sm" data-act="iv-takeover" data-id="' + esc(h, person.id) + '">人工接管</button>' +
        '<button class="btn-ghost sm" data-act="iv-tag-good" data-id="' + esc(h, person.id) + '">标记结论可用</button>' +
        '</div></div>';

      var histCard = '<div class="card" style="margin:0"><div class="card-h"><h3>最近访谈记录</h3><span class="card-sub">点一条看那次原始记录；意向怎么变的</span></div>' +
        '<div class="bt-note" style="margin-bottom:8px">意向变化：' +
        hist.slice().reverse().map(function (x) { return esc(h, x.intent); }).join(' → ') +
        '（越往后越近）· 本次诉求：' + esc(h, person.need) + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px">' +
        hist.map(function (x, i) {
          return '<button class="kb-card" data-act="iv-hist-sel" data-id="' + i + '"' + (i === hi ? ' style="border-color:var(--blue);background:var(--blue-weak)"' : '') + '>' +
            '<span style="font-size:12.5px;font-weight:600">' + esc(h, x.when) + ' · ' + esc(h, x.name) + '</span>' +
            '<span style="font-size:11.5px;color:var(--sub)">' + esc(h, x.ai) + ' · ' + esc(h, x.outline) + ' · 意向 ' + esc(h, x.intent) + '</span>' +
            '<span style="font-size:11.5px;color:var(--sub)">' + esc(h, (x.points || []).join(' / ')) + ' · 引用 ' + esc(h, x.kb) + '</span></button>';
        }).join('') + '</div></div>';

      /* 看板第三块：还能不能找到这个人 + 合规（退订/黑名单/免打扰/重开次数） */
      var reach = '<div class="card" style="margin:0"><div class="card-h"><h3>联系与合规</h3><span class="card-sub">还能不能找到他</span></div>' +
        '<div class="dl">' +
        '<dt>已尝试</dt><dd>' + person.attempts + ' 次 · ' + (person.state === 'done' ? '已谈完，最近一次是本次会话' : (person.lastTryH ? ('上次 ' + person.lastTryH + ' 小时前') : '尚未触达')) + '</dd>' +
        '<dt>下次可联系</dt><dd>' + (person.state === 'done' || person.state === 'dialing' ? '14 天后（频控 14 天 ≤ 1 次）' : (person.nextOkH ? (person.nextOkH + ' 小时后（频控 14 天 ≤ 1 次）') : '现在就可以')) + '</dd>' +
        '<dt>可联系性</dt><dd>' + (person.blacklist ? '<span class="pill bad">黑名单 · 不可联系</span>' : (person.unsub ? '<span class="pill bad">已退订 · 不可联系</span>' : '<span class="pill ok">可联系</span>')) + '</dd>' +
        '<dt>免打扰</dt><dd>22:00–08:00 不发；外发话术带 AIGC 标识</dd>' +
        '<dt>重开</dt><dd>' + ((state.ivReopened || {})[person.id] ? ('已重开 ' + state.ivReopened[person.id] + ' 次（上限 2 次）') : '未重开') + '</dd>' +
        '</div></div>';

      /* 看板第四块：关键原话（结论的证据，点一条跳左边那一轮） */
      var quotes = [], qi;
      for (qi = 0; qi < turns.length && quotes.length < 3; qi++) {
        if (turns[qi].role === 'user' && turns[qi].text && turns[qi].text.length >= 8) quotes.push({ t: turns[qi].text, r: Math.max(1, Math.ceil((qi + 1) / 2)) });
      }
      var quotesCard = '<div class="card" style="margin:0"><div class="card-h"><h3>关键原话</h3><span class="card-sub">结论的依据（点一条跳原文）</span></div>' +
        (quotes.length ? '<div style="display:flex;flex-direction:column;gap:6px">' + quotes.map(function (q) {
          return '<button class="kb-card" data-act="iv-jump" data-id="' + q.r + '" style="text-align:left">' +
            '<span style="font-size:12.5px">「' + esc(h, q.t) + '」</span>' +
            '<span style="font-size:11.5px;color:var(--sub)">第 ' + q.r + ' 轮 · 点这里定位</span></button>';
        }).join('') + '</div>' : '<div class="bt-note">这次还没谈到可引用的原话。</div>') + '</div>';

      var right = '<div class="iv-talk-r">' +
        '<div class="sub-h">看板</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' + info + histCard + analysis + quotesCard + reach + '</div>' +
        '</div>';

      body = '<div class="iv-modal-hint">' + esc(h, person.name) + ' · ' + esc(h, person.seg) + ' · ' + esc(h, SL[person.state] || person.state) + ' · 第 ' + person.rounds + ' 轮 · ' + esc(h, person.owner) + '</div>' +
        '<div class="iv-split">' + left + right + '</div>';
    }

    return '<div class="modal-mask" data-act="iv-modal-close"><div class="modal iv-modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + esc(h, row.name) + (person ? ' · ' + esc(h, person.name) : ' · 用户列表') + '</h3>' +
      '<button class="modal-x" data-act="iv-modal-close" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' + body + '</div></div></div>';
  }

  /* ⚠ 这里曾有一份**自造的 contactRows**（约 20 行，自带 SURNAME/SEGS/REASONS/pad2），
     与本文件第 54 行的转发版本重名 —— 函数声明提升，后定义的这份把转发版覆盖了，
     于是首页「④问卷列表」用的是自造流 S.R.of('iv-c|…') 的另一套派生抽值，
     详情「访谈记录」用的是 IV_DATA.contacts ⇒ 同一个联系人 ct-06
     在首页是「正常 / 待审」、在记录页是「低质量 / 已通过」（实测 3 份问卷 60 行里 12 行打架）。
     两份明细的差别只在**抽值顺序**（lowQ/review/rd 谁先抽），肉眼极难发现。
     现在只留一份：第 54 行的 contactRows 直接转发 IV_DATA.contacts —— 数据层是唯一出口。 */

  function findPerson(row, id) {
    var list = contactRows(row, 60), f = null;
    list.forEach(function (c) { if (c.id === id) f = c; });
    if (!f) f = list[0];
    if (!f) return null;
    var r = S.R.of('iv-ana|' + row.id + '|' + f.id);
    var needs = ['权限粒度', '批量导出性能', '集成与文档', '实施支持', '价格与账期'];
    var moods = ['偏负', '中性', '偏正'];
    f.need = pick(r, needs); f.needC = (0.62 + r() * 0.33).toFixed(2);
    f.mood = pick(r, moods); f.moodC = (0.55 + r() * 0.4).toFixed(2);
    f.intent = pick(r, ['高意向', '中意向', '低意向']);
    f.rival = pick(r, ['有（同类 SaaS）', '有（自研）', '未提及']);
    f.chain = pick(r, ['已明确预算与决策人', '预算待定', '决策链未明']);
    f.risk = f.aborted ? (f.rounds ? '命中禁问（承诺折扣）' : null) : (r() < 0.12 ? '情绪激烈，需人工回访' : null);
    f.kbN = Math.max(1, Math.round(f.rounds * 0.6));
    /* 联系与合规：缺了就显示 undefined —— 这里是"还能不能找到这个人"的依据，必须有值 */
    f.attempts = (typeof f.attempts === 'number') ? f.attempts
      : (f.state === 'done' ? 1 : (f.state === 'dialing' ? 1 : (f.state === 'interrupted' ? 2 : (f.state === 'unreachable' ? 3 : 0))));
    f.lastTryH = (typeof f.lastTryH === 'number') ? f.lastTryH : (f.state === 'interrupted' ? 24 : (f.state === 'unreachable' ? 96 : 0));
    f.nextOkH = (typeof f.nextOkH === 'number') ? f.nextOkH : (f.state === 'unreachable' ? 24 * 7 : (f.state === 'interrupted' ? 24 : 0));
    f.unsub = !!f.unsub || r() < 0.03;
    f.blacklist = !!f.blacklist;
    f.conclusion = pick(r, [
      '权限粒度不足与导出慢是续约的主要阻碍，愿意在补齐字段级权限后继续评估',
      '上手阶段缺培训材料，导致自助配置卡住，倾向先看实施支持方案',
      '对集成文档不满，已自行接了部分脚本，价格不是主要顾虑'
    ]);
    return f;
  }
  var QA = [
    { t: '续约意愿', q: '这半年整体用下来，续约的意向如何？', a: '还在评估，主要是想把权限这块先理顺。', fup: '"理顺"具体指哪一步？', why: '回答停留在结论层，缺少可归因的事实', kb: { doc: '产品文档库 §权限模型 3.2', score: 0.82 } }
  ];
  /* 旧版会话生成（没有 outlineItemId，答句与话题不同源）已由 IV_DATA.turns 取代，
     这里只留一段占位说明，避免后来人改错地方。 */

  /* ============================================================
   * 动作
   * ============================================================ */
  A['iv-active'] = function (id, btn, h) { h.state.ivActive = id; h.state.ivModal = null; h.state.ivOpenTask = undefined; h.navigate({}, { scroll: false }); };
  A['iv-adopt'] = function (i, btn, h) {
    h.state.ivAdopted = h.state.ivAdopted || {};
    h.state.ivAdopted[i] = true;
    h.toast('已采纳：下一份问卷的提纲里会带着这条建议', 'ok');
    h.navigate({}, { scroll: false });
    /* 评价块在首页长页靠下：重渲染后把用户滚回他刚点的那条建议，
       否则页面跳回顶部，人得自己再翻下来找（点一次跳一次 = 没法连着采纳几条）。
       详情页「问卷评价」页签本身很短，不需要。 */
    if (h.state.objTab !== 'survey' && h.state.tab !== 'survey') {
      var back = function () {
        var el = document.querySelector('[data-act="iv-adopt"][data-id="' + i + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      };
      if (global.requestAnimationFrame) global.requestAnimationFrame(back); else back();
    }
  };
  A['iv-src'] = function (id, btn, h) { h.state.ivSrc = id; h.state.ivScreen = null; h.state.ivTagFilter = null; h.navigate({}, { scroll: false }); };
  /* 2026-10-20：「共 2,680 位」原来只给看 40 位、没有出口。这里按 80 递增；
     「展开全部」只在真的还有 80 位以上时出现。滚动位置保持不动，否则点一次跳回页顶。 */
  A['iv-more'] = function (id, btn, h) {
    var raw = String(id || '');
    var planId = raw.split('|')[0];
    h.state.ivShown = h.state.ivShown || {};
    h.state.ivShown[planId] = raw.indexOf('|all') > -1 ? 100000 : ((h.state.ivShown[planId] || 40) + 80);
    h.navigate({}, { scroll: 'keep' });
  };
  A['iv-toggle-users'] = function (id, btn, h) {
    /* 默认展开时 state 里是 undefined（等于"跟着当前问卷走"）——
       判定要用"当前实际显示的那一份"（与渲染同一规则：ivActive 优先，否则第一份），
       否则第一次点击会变成"再打开一次" */
    var rows = (global.IV_DATA && global.IV_DATA.rows) ? global.IV_DATA.rows() : [];
    var defOpen = h.state.ivActive || (rows[0] && rows[0].id) || null;
    var cur = (h.state.ivOpenTask === undefined) ? defOpen : h.state.ivOpenTask;
    h.state.ivOpenTask = (cur === id ? null : id);
    h.navigate({}, { scroll: false });
    /* 展开后把问卷列表滚进视野：点了「用户列表」却看不到展开内容，等于没点 */
    if (typeof setTimeout === 'function') setTimeout(function () {
      var el = document.querySelector('#iv-list');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    }, 0);
  };
  /* 名单来源：写会话态（state.ivUsedSeg），渲染处据此回显"当前用哪个分群"，
     否则「用这个分群」只是一句话，界面看不出到底选没选。 */
  A['iv-use-seg'] = function (id, btn, h) {
    if (!id) { h.toast('未指定分群', 'bad'); return; }
    h.state.ivUsedSeg = id;
    h.toast('已选用该分群作为名单来源，可派发人数按分群覆盖算（本会话态，刷新还原）', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-hist'] = function (id, btn, h) {
    var x = null, idx = -1;
    HISTORY.forEach(function (v, i) { if (v.id === id) { x = v; idx = i; } });
    if (!x) { h.toast('历史问卷不存在', 'bad'); return; }
    /* ⚠ 此前只弹一句「已切到历史问卷…」却**不写 state** —— 界面看不出到底切没切，
       而旁边同族的 iv-hist-sel 早就写 state.ivHist 了。这里走同一条路，让选中态真回显。 */
    h.state.ivHist = idx + 1;
    h.toast('已切到历史问卷「' + x.name + '」（' + x.when + '）· ' + x.note, 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-screen'] = function (id, btn, h) {
    h.state.ivScreen = (h.state.ivScreen === id) ? null : id;
    h.state.ivTagFilter = null;        /* 筛选只留一个 */
    h.navigate({}, { scroll: false });
  };
  A['iv-tagfilter'] = function (id, btn, h) {
    h.state.ivTagFilter = (h.state.ivTagFilter === id) ? null : id;
    h.state.ivScreen = null;           /* 筛选只留一个 */
    h.navigate({}, { scroll: false });
  };
  A['iv-pick'] = function (id, btn, h) {
    var st = h.state, cur = (st.ivPicked || []).slice(), i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else cur.push(id);
    st.ivPicked = cur;
    h.navigate({}, { scroll: false });
  };
  A['iv-dispatch'] = function (id, btn, h) {
    var n = (h.state.ivPicked || []).length;
    if (!n) { h.toast('先在用户池里勾人，再派发', 'warn'); return; }
    h.toast('已派发 ' + n + ' 位到该问卷：进入联系队列（剔除退订 / 黑名单 / 频控内样本）', 'ok');
    h.state.ivPicked = [];
    h.navigate({}, { scroll: false });
  };
  /* 同 iv-create：接到真实的访谈创建表单，而不是只描述流程。 */
  A['iv-create-q'] = function (id, btn, h) {
    if (ACTIONS['create-open']) { ACTIONS['create-open']('survey', null, h); return; }
    h.toast('创建入口不可用（create-open 未注册）', 'bad');
  };
  /* 保存问卷内容：**真的解析并写入提纲真源**（state.ivOutline）。
     原来这个动作只弹一句"已保存到本会话"，文本框里的字没人读 ——
     详情页「谈什么」和 AI 评价都在用各自写死的常量，所以怎么写都不会变。 */
  A['iv-save-q'] = function (id, btn, h) {
    var ta = null;
    try { ta = document.querySelector('[data-iv="q-body"]'); } catch (e) { ta = null; }
    if (!ta) { h.toast('找不到问卷内容输入框', 'bad'); return; }
    var texts = String(ta.value || '').split('\n').filter(function (x) { return x.trim(); });
    if (!texts.length) { h.toast('问卷内容是空的：至少写一条「话题｜必问/可选/禁问｜问什么」', 'bad'); return; }
    var base = (IVD.currentOutline ? IVD.currentOutline() : {});
    var topics = (IVD.parseOutlineText ? IVD.parseOutlineText(ta.value) : []);
    h.state.ivOutline = {
      form: base.form || 'topic',
      opening: base.opening, closing: base.closing, forbidden: base.forbidden || [],
      maxChars: base.maxChars || 200, maxRounds: base.maxRounds || 24,
      kbs: base.kbs || [],
      topics: topics
    };
    var mustN = topics.filter(function (t) { return t.must; }).length;
    var banN = topics.filter(function (t) { return t.ban; }).length;
    h.toast('已保存 ' + topics.length + ' 个话题（必问 ' + mustN + ' · 禁问 ' + banN + '）：详情页「谈什么」与 AI 问卷评价已按这份提纲更新', 'ok');
    h.navigate({}, { scroll: false });
  };
  A['iv-open-plan'] = function (id, btn, h) { h.navigate({ agentId: id, objId: id, tab: 'plan', objTab: 'plan' }); };
  A['iv-users'] = function (id, btn, h) { h.state.ivModal = { task: id, person: null }; h.navigate({}, { scroll: false }); };
  A['iv-user'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    h.state.ivModal = { task: p[0], person: p[1] };
    h.state.ivHist = 0;                 /* 打开某人默认看本次 */
    h.navigate({}, { scroll: false });
  };
  A['iv-hist-sel'] = function (i, btn, h) { h.state.ivHist = num(i, 0); h.navigate({}, { scroll: false }); };
  /* 结论 → 原文依据：跳到左边对应的那一轮并闪一下（分析和记录必须能对上） */
  A['iv-jump'] = function (r, btn, h) {
    if (typeof document === 'undefined') return;
    var rows = document.querySelectorAll('.iv-talk-l .iv-chat .row');
    var ais = [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].className.indexOf('me') >= 0) ais.push(rows[i]);
    var t = ais[num(r, 0)];
    if (!t) { h.toast('这次会话里没有这一轮（可能被中止或未谈到）', 'warn'); return; }
    if (t.scrollIntoView) t.scrollIntoView({ block: 'center' });
    t.classList.add('iv-flash');
    if (typeof setTimeout === 'function') setTimeout(function () { t.classList.remove('iv-flash'); }, 1600);
  };
  A['iv-modal-close'] = function (id, btn, h) { h.state.ivModal = null; h.navigate({}, { scroll: false }); };
  /* 标记结论可用：写会话态（state.ivTagGood），渲染处按状态回显，否则是一次"说了没做"。 */
  A['iv-tag-good'] = function (id, btn, h) {
    if (!id) { h.toast('未指定要标记的联系人', 'bad'); return; }
    h.state.ivTagGood = h.state.ivTagGood || {};
    h.state.ivTagGood[id] = true;
    h.toast('已标记结论可用：' + id + ' 进入「结论归档」待写库（本会话态，刷新还原）', 'ok');
    h.navigate({}, { scroll: false });
  };
})(window);
