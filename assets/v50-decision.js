/* v52b · 决策会议室（朝堂制 · 方卡 · 职名用原文）
 *
 * 2026-10-24 业主三轮意见（第 ③ 轮覆盖第 ② 轮，别再改回去）：
 *   ① 「决策会议室是 Agent 集群，依照股肱羽翼，布局参考大厅、古代上朝、分部讨论，不被 Agent 工作台管理」
 *   ② 「方形卡片，讲人话，不要文言文」
 *   ③ 「算了，… + 文言文」—— 全白话那版（腹心→总协调、股肱→落地执行、拟旨→结论草案）
 *      业主看过就否了，**名字回到原文**。
 *
 * 定稿的规矩：**职名用原文，解释用人话。**
 *   · 卡片写「腹心」「股肱」「羽翼」，不写「总协调」「落地执行」；
 *   · 六部照旧：决策中枢 / 情报研判 / 保障支撑 / 作战执行 / 工程守御 / 造势攻心，左文右武；
 *   · 「拟旨」「业主席」「堂上」「席」一并回到原文腔；
 *   · 悬停提示、页头说明、堂内副标仍说白话 —— 名字是古的，得让人看懂它干什么。
 *
 * 版式：方卡 104×104，左右两条竖列、每部三张；世界层 1112×1121，视口可缩放可拖动。
 *
 * 与 Agent 工作台的关系：这十八席是会议室自建的常设班底，
 * 不进 agent-wb 的名单、不走它的版本发布与成本归因。页头挂着标签，堂底也写了一句。
 */
(function (global) {
  'use strict';
  var R = global.RENDERERS || (global.RENDERERS = {});

  /* 画布固定 1112×1121：两列各三组、每组三席，方卡 104×104。 */
  var W = 1112, H = 1121;
  /* 左右各一条竖列（2026-10-25 业主「左右竖向排列」+「方形卡片」）：
     一组 = 部名一行 + 三方卡，三组一列；两列之间整块留白给堂中央的输入条。 */
  var SIDE_X = 18, RAIL_W = 104, CARD_H = 104, ITEM_GAP = 7, LABEL_H = 18, GROUP_GAP = 14;
  var GROUP_H = LABEL_H + ITEM_GAP + 3 * CARD_H + 2 * ITEM_GAP;
  var RAIL_H = 3 * GROUP_H + 2 * GROUP_GAP;
  var TOP = Math.round((H - RAIL_H) / 2);

  /* 六组十八个 Agent。name = 屏幕上显示的白话职名，src = 《王翼》原文叫什么（只出现在悬停提示里）。
     what = 这个 Agent 具体干什么，也只在悬停提示里。
     say = 本议题里的发言条数，就是卡右上角那个数。 */
  /* 六部十八职，名字一律用《王翼》原文 —— 业主看过白话版，说「算了，文言文」，
     所以卡片上写「腹心」「股肱」「羽翼」，不写「总协调」「落地执行」。
     what 是悬停提示里的人话解释：名字是古的，解释得让人看懂，两件事不冲突。
     say = 本议题里的发言条数，就是卡右上角那个数。 */
  var DEPTS = [
    { id: 'plan', side: 'left', name: '决策中枢', brief: '出主意，最后收口', agents: [
      { name: '腹心', meta: '96% · 18条', say: 6, what: '把六部的结论汇总成一份，突发情况也归它兜' },
      { name: '谋士', meta: '88% · 14条', say: 5, what: '推演几种走法各要多少投入、最坏会烂在哪' },
      { name: '通材', meta: '72% · 6条', say: 2, what: '跟外部谈条件，消化临时插进来的事' }
    ] },
    { id: 'intel', side: 'left', name: '情报研判', brief: '搞清外面什么情况', agents: [
      { name: '天文', meta: '81% · 11条', say: 3, what: '看现在是不是进场的时点，早半年晚半年差多少' },
      { name: '地利', meta: '84% · 13条', say: 4, what: '算各个国家的盘子、距离、门槛和实际难度' },
      { name: '耳目', meta: '77% · 22条', say: 3, what: '盯住外头在说什么 —— 客户、同行、媒体' }
    ] },
    { id: 'supply', side: 'left', name: '保障支撑', brief: '钱、人、退路', agents: [
      { name: '通粮', meta: '86% · 8条', say: 2, what: '排人、排钱、排时间，保证打得下去' },
      { name: '法算', meta: '91% · 16条', say: 4, what: '一笔一笔算清投入、回本周期和现金压力' },
      { name: '方士', meta: '64% · 5条', say: 1, what: '万一出事怎么收场，损失封在多少以内' }
    ] },
    { id: 'ops', side: 'right', name: '作战执行', brief: '定打法，推着走', agents: [
      { name: '兵法', meta: '83% · 12条', say: 4, what: '把大目标拆成能落地的动作和先后顺序' },
      { name: '奋威', meta: '75% · 7条', say: 2, what: '盯进度、推卡点，谁慢了就催谁' },
      { name: '权士', meta: '61% · 4条', say: 1, what: '常规打法走不通时，换一条路' }
    ] },
    { id: 'land', side: 'right', name: '工程守御', brief: '把事真正办成', agents: [
      { name: '股肱', meta: '89% · 10条', say: 3, what: '合规改造、节点部署这些硬活归它' },
      { name: '爪牙', meta: '79% · 9条', say: 2, what: '先小范围跑一遍，把坑提前踩出来' },
      { name: '伏鼓旗', meta: '93% · 6条', say: 2, what: '保证六部说的是同一件事，口径不乱' }
    ] },
    { id: 'voice', side: 'right', name: '造势攻心', brief: '管外面怎么看我们', agents: [
      { name: '羽翼', meta: '70% · 8条', say: 2, what: '对外讲清楚我们在干什么，抢认知' },
      { name: '术士', meta: '55% · 3条', say: 1, what: '不走正面的办法，能用，但不能常用' },
      { name: '游士', meta: '69% · 9条', say: 3, what: '摸清对手的报价、动作和底牌' }
    ] }
  ];

  var TALKS = [
    {
      who: '地利', line: '情报研判', stance: 'pro', round: 3,
      text: '德国 B2B 采购决策链比美国短四成，客单价是我们国内的 3.2 倍。首年不碰美国 —— 美国市场的获客成本会把单位经济算死。',
      ev: '3 份渠道商访谈 · 2 组定价测试'
    },
    {
      who: '股肱', line: '工程守御', stance: 'con', round: 3,
      text: '画像库里的欧盟用户数据不能跨境回传，必须走 SCC 或在欧盟境内部署节点。这不是成本问题，是不做就开不了张。',
      ev: 'GDPR 第 44-49 条 · 2 份律所意见'
    },
    {
      who: '游士', line: '造势攻心', stance: 'con', round: 2,
      text: '本土前三家占 61% 份额。我们的差异不在功能，在交付速度和价格 —— 但这两条在欧美都不是护城河，对手随时能跟。',
      ev: '7 家竞品公开报价 · 12 份客户评价'
    },
    {
      who: '法算', line: '保障支撑', stance: 'con', round: 2,
      text: 'HS 编码一旦归错，综合税率能差 20 个点。退货率按欧美电商均值 18% 算，直邮模式每单要倒亏。',
      ev: '4 个 HS 编码试算 · 2 家货代报价'
    },
    {
      who: '谋士', line: '决策中枢', stance: 'con', round: 4,
      text: '首年投入 800 万，回本周期 26 个月，超过内部 18 个月红线。要么缩规模，要么改口径 —— 但改口径不改变现金。',
      ev: '3 套预算模型 · 敏感性分析'
    },
    {
      who: '腹心', line: '合议', stance: 'sum', round: 4,
      text: '结论不是「做不做」，是「用多小的代价试」。合规先行的德国单点验证，18 个月不达标就撤，损失封在 300 万以内。',
      ev: '六组合议 · 第 4 轮'
    }
  ];

  var STANCE = {
    pro: { label: '支持', cls: 'pro' },
    con: { label: '反对', cls: 'con' },
    sum: { label: '拍板建议', cls: 'sum' }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); }

  /* 一席 = 一张方卡：图标 / 职名 / 把握与证据条数，右上角是发言条数。 */
  function agentCard(h, a) {
    return '<div class="hall-agent" title="' + esc(a.name) + '：' + esc(a.what) + '">' +
      '<span class="hall-ico">' + h.icon('bot', 13) + '</span>' +
      '<b>' + esc(a.name) + '</b>' +
      '<u>' + esc(a.meta) + '</u>' +
      '<em class="hall-n">' + a.say + '</em>' +
      '</div>';
  }

  function deptBlock(h, d, x, y) {
    var head = '<div class="hall-dept-h" title="' + esc(d.brief) + '">' +
      '<span class="hall-side">' + (d.side === 'left' ? '文' : '武') + '</span>' +
      '<b>' + esc(d.name) + '</b><i>' + d.agents.length + ' 席</i></div>';
    var body = d.agents.map(function (a) { return agentCard(h, a); }).join('');
    return '<div class="hall-dept ' + d.side + '" style="left:' + x + 'px;top:' + y + 'px;width:' + RAIL_W + 'px">' +
      head + '<div class="hall-dept-body">' + body + '</div></div>';
  }

  /* 画布：一个固定尺寸的世界层塞进一个视口，视口高度吃满一屏。
     为什么不做成「按页面宽度排死的 div」—— 那是排版，不是画布：
     往下加内容页面就越拉越长，缩不回去也拖不动。这里世界层永远是 W×H，
     缩放与平移只改外层 transform，纸面不动。 */
  function hall(h) {
    var out = '<div class="hall-canvas" id="hall-canvas">' +
      '<div class="hall-world" style="width:' + W + 'px;height:' + H + 'px">' +
      '<div class="hall" style="width:' + W + 'px;height:' + H + 'px">';
    var li = 0, ri = 0;
    for (var i = 0; i < DEPTS.length; i++) {
      var d = DEPTS[i];
      var x = d.side === 'left' ? SIDE_X : W - SIDE_X - RAIL_W;
      var y = TOP + (d.side === 'left' ? li++ : ri++) * (GROUP_H + GROUP_GAP);
      out += deptBlock(h, d, x, y);
    }
    out += '</div></div>' +
      /* 输入条就在堂里 —— 十八席沿两边竖排，中间这块是业主开口的位置。
         挂在视口上而不是世界层上：缩放平移只动席卡，说话的地方不动。 */
      composer() +
      '<div class="hall-bar">' +
        '<button type="button" data-hall="out" title="缩小">−</button>' +
        '<span class="hall-zoomv">100%</span>' +
        '<button type="button" data-hall="in" title="放大">+</button>' +
        '<button type="button" data-hall="fit" title="适应窗口">适应</button>' +
        '<button type="button" data-hall="one" title="原始大小">1:1</button>' +
      '</div>' +
      '<div class="hall-hint">Ctrl + 滚轮缩放 · 空白处拖动平移</div>' +
      '</div>';
    return out;
  }

  /* 业主开口的地方（2026-10-25 起就摆在堂里，见 hall()）。
     截图给的是一个「大框 + 左下加号 + 右下发送」的样子，照做。
     占位文案就一个字面标准：像「腹心」那样 —— 文言词，但不用查字典。业主原话
     「这个（腹心）是大白话加文言文」，所以不写「一切从这里开始……有事请奏」那种
     前半句白、后半句文硬拼的句子。
     原型里不接后端：点发送只把这句话收下并给个提示，不假装已经发给了十八席。 */
  function composer() {
    return '<div class="cmp cmp-dock" id="dec-cmp">' +
      '<textarea class="cmp-ta" id="dec-cmp-ta" rows="1" spellcheck="false" ' +
        'placeholder="但说无妨"></textarea>' +
      '<div class="cmp-bar">' +
        '<button type="button" class="cmp-plus" title="添加附件（原型未接）" aria-label="添加附件">' +
          '<span>+</span></button>' +
        '<button type="button" class="cmp-send" id="dec-cmp-send" title="发送（Ctrl + Enter）" aria-label="发送">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 19.5V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/></svg></button>' +
      '</div>' +
    '</div>';
  }

  function talks(h) {
    var rows = TALKS.map(function (t) {
      var st = STANCE[t.stance];
      return '<div class="dec-talk">' +
        '<div class="dec-talk-h">' +
          '<span class="dec-av t-' + st.cls + '">' + h.icon(t.stance === 'sum' ? 'seal' : 'bot', 13) + '</span>' +
          '<b>' + esc(t.who) + '</b>' +
          '<span class="dec-tag t-' + st.cls + '">' + st.label + '</span>' +
          '<span class="dec-line">' + esc(t.line) + '</span>' +
          '<span class="dec-round">第 ' + t.round + ' 轮</span>' +
        '</div>' +
        '<p>' + esc(t.text) + '</p>' +
        '<div class="dec-ev">' + esc(t.ev) + '</div>' +
      '</div>';
    }).join('');

    return '<section class="dec-sec">' +
      '<div class="dec-sec-h"><h2>堂上发言</h2>' +
        '<span>六条真正改变了结论的发言，按轮次排</span></div>' +
      '<div class="dec-talks">' + rows + '</div>' +
    '</section>';
  }

  function verdict(h) {
    return '<section class="dec-sec">' +
      '<div class="dec-sec-h"><h2>决策收敛</h2>' +
        '<span>第 4 轮合议产出 · 待业主确认</span></div>' +
      '<div class="dec-verdict">' +

        '<div class="dec-vd main">' +
          '<h3>结论</h3>' +
          '<p><b>用最小的代价试，不做全面进军。</b>德国单点验证，合规先行，18 个月不达标即撤。</p>' +
          '<ol class="dec-steps">' +
            '<li><b>阶段一 · 0-6 个月</b>欧盟节点 + GDPR 合规改造，不投市场费用</li>' +
            '<li><b>阶段二 · 6-12 个月</b>德国单一市场，海外仓起量到 3000 单/月</li>' +
            '<li><b>阶段三 · 12-18 个月</b>达标就复制到荷兰、奥地利，不达标撤</li>' +
          '</ol>' +
        '</div>' +

        '<div class="dec-vd">' +
          '<h3>前提条件</h3>' +
          '<ul class="dec-facts">' +
            '<li>欧盟境内数据节点落地，没落地之前不许碰真实用户数据</li>' +
            '<li>海外仓要到 3000 单/月，低于这条线走直邮必然倒亏</li>' +
            '<li>HS 编码找第三方复核，归错类能吃掉 20 个点利润</li>' +
            '<li>首年投入封顶 800 万，超支就重新议一遍</li>' +
          '</ul>' +
        '</div>' +

        '<div class="dec-vd">' +
          '<h3>未解分歧</h3>' +
          '<ul class="dec-facts warn">' +
            '<li><b>先造势还是先筑垒</b>：造势攻心主张先打认知，工程守御要求先跑通履约，两边都没让</li>' +
            '<li><b>回本口径</b>：法算咬死 26 个月，地利认为按客户终身价值折算该算 19 个月，口径没统一</li>' +
            '<li><b>美国是不是彻底不做</b>：只是这一轮的共识，没写成决议</li>' +
          '</ul>' +
        '</div>' +

      '</div>' +
    '</section>';
  }

  function head(h, cap) {
    return '<div class="dec-head">' +
      '<div class="dec-head-l">' +
        '<div class="dec-kicker">决策议题 · 战略级</div>' +
        '<h1>决策会议室</h1>' +
        '<p>十八席常驻，循《六韬·王翼》十八职排班：左文右武，部内先议，分歧上堂当面说清。</p>' +
      '</div>' +
      '<div class="dec-head-r">' +
        '<span class="dec-own">' + h.icon('seal', 12) + '自建班底 · 不进 Agent 工作台</span>' +
        '<span class="dec-state"><i></i>合议已收敛</span>' +
        '<span class="dec-meta">18 席 · 4 轮 · 86 条证据</span>' +
      '</div>' +
    '</div>';
  }

  /* ── 画布的缩放与平移 ─────────────────────────────────────
     视图只存在 state.hallView 里（k/tx/ty），不进 URL、不进历史：
     缩放是看法，不是状态。重渲染后靠 __hallBoot 把它原样贴回去。
     ⚠ 普通滚轮不拦 —— 鼠标停在画布上照样能滚页面；Ctrl/⌘ + 滚轮才缩放，
       和关系图（v24）同一套约定，省得两页两种手感。 */
  var K_MIN = 0.45, K_MAX = 1.8;

  function hallView() {
    var st = global.APP_SHELL && global.APP_SHELL.state;
    if (!st) return null;
    if (!st.hallView) st.hallView = { k: 0, tx: 0, ty: 0 };
    return st.hallView;
  }

  function paint(el, world, v) {
    world.style.transform = 'translate(' + Math.round(v.tx) + 'px,' + Math.round(v.ty) + 'px) scale(' +
      (Math.round(v.k * 1000) / 1000) + ')';
    var zv = el.querySelector('.hall-zoomv');
    if (zv) zv.textContent = Math.round(v.k * 100) + '%';
    /* 堂内输入条不许压到两列席卡：宽度跟着缩放后的中间空档走（空档 = 1112 - 左右两列 244）。 */
    el.style.setProperty('--dock-w', Math.round((W - 2 * (SIDE_X + RAIL_W)) * v.k - 24) + 'px');
    placeDock();
  }

  /* ── 输入条跟着滚动走 ────────────────────────────────────
     画布 1121 高、一屏装不下。输入条贴在视口底部往上 28px（常驻输入栏），
     下面不再留一大片空；上下按画布收口：画布底边上来就贴住画布、跟着一起滚走，
     不滑到画布外面去盖「堂上发言」。锚点是底边，输入框长高时往上长。 */
  var dockEl = null, dockRaf = 0, DOCK_BOTTOM = 28;

  function placeDock() {
    dockRaf = 0;
    var cmp = dockEl && global.document.getElementById('dec-cmp');
    if (!cmp) return;
    var r = dockEl.getBoundingClientRect();
    var vh = global.innerHeight || 0;
    var h = cmp.offsetHeight;
    var want = vh - DOCK_BOTTOM - h - r.top;
    var top = Math.max(12, Math.min(dockEl.clientHeight - h - 12, want));
    cmp.style.top = Math.round(top) + 'px';
  }

  function onDockScroll() {
    if (!dockRaf) dockRaf = global.requestAnimationFrame(placeDock);
  }

  function fit(el, world, v) {
    var cw = el.clientWidth || 0, ch = el.clientHeight || 0;
    if (cw < 40 || ch < 40) return;
    /* 一屏能装下就不放大（不把 88 的方卡撑成 110）—— 装不下才缩，且缩不过 0.45 */
    var k = Math.min((cw - 20) / W, (ch - 20) / H, 1);
    v.k = Math.max(k, K_MIN);
    v.tx = (cw - W * v.k) / 2;
    v.ty = (ch - H * v.k) / 2;
    paint(el, world, v);
  }

  function zoomAt(el, world, v, k2, px, py) {
    k2 = Math.min(K_MAX, Math.max(K_MIN, k2));
    var r = k2 / v.k;
    v.tx = px - (px - v.tx) * r;
    v.ty = py - (py - v.ty) * r;
    v.k = k2;
    paint(el, world, v);
  }

  function boot() {
    var el = global.document.getElementById('hall-canvas');
    if (!el) return;
    var world = el.querySelector('.hall-world');
    var v = hallView();
    if (!world || !v) return;

    dockEl = el;
    if (!boot.bound) {
      boot.bound = 1;
      /* capture 捕全部滚动容器（这页滚的是 App 外壳里的主栏，不是 window） */
      global.document.addEventListener('scroll', onDockScroll, { capture: true, passive: true });
      global.addEventListener('resize', onDockScroll);
    }

    if (v.k) paint(el, world, v); else fit(el, world, v);

    /* 首屏的页头高度要等字体落位才定，boot 这一下算出来的画布顶是临时的：再量两次 */
    global.requestAnimationFrame(placeDock);
    if (global.document.fonts && global.document.fonts.ready) global.document.fonts.ready.then(placeDock);

    var btn = el.querySelectorAll('[data-hall]');
    for (var i = 0; i < btn.length; i++) {
      btn[i].addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var act = this.getAttribute('data-hall');
        var cx = el.clientWidth / 2, cy = el.clientHeight / 2;
        if (act === 'fit') return fit(el, world, v);
        if (act === 'one') return zoomAt(el, world, v, 1, cx, cy);
        if (act === 'in') return zoomAt(el, world, v, v.k * 1.15, cx, cy);
        if (act === 'out') return zoomAt(el, world, v, v.k / 1.15, cx, cy);
      });
    }

    /* 空白处拖动 = 平移。落在方卡上不接管 —— 卡片以后要能点开看发言 */
    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest('.hall-agent, .hall-bar, .cmp')) return;
      var x0 = ev.clientX, y0 = ev.clientY, tx0 = v.tx, ty0 = v.ty, moved = false;
      el.classList.add('panning');
      try { if (el.setPointerCapture) el.setPointerCapture(ev.pointerId); } catch (e) {}
      function mv(e2) {
        if (e2.buttons === 0) { up(); return; }
        var dx = e2.clientX - x0, dy = e2.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        v.tx = tx0 + dx; v.ty = ty0 + dy;
        paint(el, world, v);
      }
      function up() {
        global.document.removeEventListener('pointermove', mv);
        global.document.removeEventListener('pointerup', up);
        el.classList.remove('panning');
      }
      global.document.addEventListener('pointermove', mv);
      global.document.addEventListener('pointerup', up);
      ev.preventDefault();
    });

    el.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey && !ev.metaKey) return;      /* 不按 Ctrl 就放行，页面照常滚 */
      ev.preventDefault();
      var r = el.getBoundingClientRect();
      zoomAt(el, world, v, v.k * Math.pow(1.0015, -ev.deltaY), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
  }

  function bootAll() {
    boot();
    bootComposer();
  }

  /* 输入框的交互：自动长高、Ctrl+Enter 发送、点加号给一句实话。
     没接后端，所以发送只做「收下并提示」，不伪造一条已发送的发言。 */
  function bootComposer() {
    var cmp = global.document.getElementById('dec-cmp');
    if (!cmp || cmp.__bound) return;
    cmp.__bound = 1;
    var ta = cmp.querySelector('.cmp-ta');
    var send = cmp.querySelector('.cmp-send');
    var plus = cmp.querySelector('.cmp-plus');

    function grow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(132, Math.max(26, ta.scrollHeight)) + 'px';
      placeDock();
    }
    function fire() {
      var v = (ta.value || '').trim();
      if (!v) { ta.focus(); return; }
      ta.value = '';
      grow();
      var T = global.APP_SHELL && global.APP_SHELL.toast;
      if (T) T('收下了 · 原型未接后端，暂不派给十八席', 'info');
    }
    ta.addEventListener('input', grow);
    send.addEventListener('click', fire);
    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); fire(); }
    });
    if (plus) plus.addEventListener('click', function () {
      var T = global.APP_SHELL && global.APP_SHELL.toast;
      if (T) T('附件入口还没接 · 先在这儿写着', 'info');
    });
  }

  global.__hallBoot = bootAll;

  R.renderers = R.renderers || {};
  R.decisionPage = function (cap, state, h) {
    return '<div class="dec-wrap">' + head(h, cap) +
      hall(h) + talks(h) + verdict(h) + '</div>';
  };

})(window);
