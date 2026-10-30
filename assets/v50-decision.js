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
  var RAIL_W = 104, CARD_H = 104, ITEM_GAP = 7, LABEL_H = 18, GROUP_GAP = 14;
  /* 两侧空出「刚好一列的宽度」：104 卡 + 7 间距 + 7 呼吸。
     2026-10-28 业主「留的空要可以再塞一列 agent」—— 这个数是量出来的，不是拍的：
     以后每部加人、或左右各补一列，位置已经在那儿，卡片不用搬家。卡宽改了这行跟着变。 */
  var SIDE_X = RAIL_W + ITEM_GAP + 7;
  var GROUP_H = LABEL_H + ITEM_GAP + 3 * CARD_H + 2 * ITEM_GAP;
  var RAIL_H = 3 * GROUP_H + 2 * GROUP_GAP;
  var TOP = Math.round((H - RAIL_H) / 2);

  /* 六组十八个 Agent。name = 屏幕上显示的白话职名，src = 《王翼》原文叫什么（只出现在悬停提示里）。
     what = 这个 Agent 具体干什么，也只在悬停提示里。
     say = 本议题里的发言条数，就是卡右上角那个数。 */
  /* 六部十八职，名字一律用《王翼》原文 —— 业主看过白话版，说「算了，文言文」，
     所以卡片上写「腹心」「股肱」「羽翼」，不写「总协调」「落地执行」。
     gist = 名字底下那行白话（2026-10-28 业主「这个是文言文，后面加解释」）：
            职名不动，下面补一句四字左右的活话，一眼知道它干什么。
     what = 悬停提示里的完整解释（比 gist 详细，说清怎么做）。
     say  = 本议题里的发言条数，就是卡右上角那个数。 */
  /* ── 席卡四态（2026-10-30 业主纠正）──────────────────────────────
     业原话：「其他人不能沙盘推演？其他人不能思考？其他人不能搜索工具？」
     —— 状态是**此刻正在做什么**，不是角色属性。谁都可以推演、谁都可以查资料，
     同一状态也可以好几个人同时处于其中。所以这里不按职务分，是一张运行时快照。
     （旧版按名字一人钉一个状态，等于把状态当成了岗位，已废。）

     表现分两层，因为状态是轻的、人均一份，内容是重的、只有少数：
       · 轻的一层在卡里：图标按状态换形换色，18 个人各显示各的，谁也不占额外空间
       · 重的一层在卡外：只有「发言」冒气泡（有话要说才需要有内容可读）
       · 沙盘是「推演」的放大件，一次只放大一个（现在跟地利），其余推演者只留图标

     1 查询中 query —— 在调工具、查资料
     2 思考   think —— 拿到料，在算自己那份
     3 发言   speak —— 这一轮开口了
     4 沙盘推演 sand —— 在盘上推演算 */
  var AG_STATE = {
    /* 发言 3 席 —— 这一轮开口了 */
    '腹心': 'speak', '谋士': 'speak', '股肱': 'speak',
    /* 沙盘推演 1 席 —— 盘只有一块，一次只放大一个（多人同时推演时，其余落到气泡里说） */
    '地利': 'sand',
    /* 思考 5 席 */
    '天文': 'think', '通粮': 'think', '兵法': 'think', '羽翼': 'think', '法算': 'think',
    /* 查询中 9 席：搜资料、调工具、查进度，都算这一类，具体动作写在 act 里 */
  };
  var ST_TXT = { query: '查询中', think: '思考', speak: '发言', sand: '沙盘推演' };

  var DEPTS = [
    { id: 'plan', side: 'left', name: '决策中枢', brief: '出主意，最后收口', agents: [
      { name: '腹心', meta: '96% · 18条', say: 6, gist: '汇总收口', what: '把六部的结论汇总成一份，突发情况也归它兜' },
      { name: '谋士', meta: '88% · 14条', say: 5, gist: '推演走法', what: '推演几种走法各要多少投入、最坏会烂在哪' },
      { name: '通材', meta: '72% · 6条', say: 2, gist: '对外交涉', items: ['Böttcher 集团 · 年采购 2.4 亿欧', 'Kessler Handel · 品类重合 70%'], act: '搜：德国 B2B 渠道商名单', what: '跟外部谈条件，消化临时插进来的事' }
    ] },
    { id: 'intel', side: 'left', name: '情报研判', brief: '搞清外面什么情况', agents: [
      { name: '天文', meta: '81% · 11条', say: 3, gist: '看准时机', items: ['先拆德国线上渗透率的年增速', '再把我们的品类占比折进去', '半年窗口差 4 个月现金流'], act: '在算：现在进场比半年后早多少', what: '看现在是不是进场的时点，早半年晚半年差多少' },
      { name: '地利', meta: '84% · 13条', say: 4, gist: '算各国盘子', what: '算各个国家的盘子、距离、门槛和实际难度' },
      { name: '耳目', meta: '77% · 22条', say: 3, gist: '盯住舆情', items: ['Anker 德国站上新 3 款', '某家把账期从 60 天压到 30 天'], act: '搜：竞品最近三个月的动作', what: '盯住外头在说什么 —— 客户、同行、媒体' }
    ] },
    { id: 'supply', side: 'left', name: '保障支撑', brief: '钱、人、退路', agents: [
      { name: '通粮', meta: '86% · 8条', say: 2, gist: '排人排钱', items: ['合规 2 人、运营 3 人，仓配外包', '人力占首年预算 38%'], act: '在算：首年要几个人、多少钱', what: '排人、排钱、排时间，保证打得下去' },
      { name: '法算', meta: '91% · 16条', say: 4, gist: '算清投入', items: ['前半年几乎全压在合规和节点', '月均流出 66 万，峰值在第三季度'], act: '在算：800 万分摊到每个月', what: '一笔一笔算清投入、回本周期和现金压力' },
      { name: '方士', meta: '64% · 5条', say: 1, gist: '备好退路', items: ['撤出预案 v3 · 止损线 300 万', '汇率对冲条款'], act: '调：风险预案模板', what: '万一出事怎么收场，损失封在多少以内' }
    ] },
    { id: 'ops', side: 'right', name: '作战执行', brief: '定打法，推着走', agents: [
      { name: '兵法', meta: '83% · 12条', say: 4, gist: '拆解打法', items: ['先合规，再仓，后投放', '三步各设独立的止损点'], act: '在拆：单点验证先做哪三步', what: '把大目标拆成能落地的动作和先后顺序' },
      { name: '奋威', meta: '75% · 7条', say: 2, gist: '盯住进度', items: ['合规改造滞后 2 周', '海外仓签约还没回'], act: '查：项目进度和卡点', what: '盯进度、推卡点，谁慢了就催谁' },
      { name: '权士', meta: '61% · 4条', say: 1, gist: '换条路走', items: ['代运营试水 · 毛利低 12 点', '只做 B 端小单'], act: '搜：替代打法的案例', what: '常规打法走不通时，换一条路' }
    ] },
    { id: 'land', side: 'right', name: '工程守御', brief: '把事真正办成', agents: [
      { name: '股肱', meta: '89% · 10条', say: 3, gist: '合规落地', what: '合规改造、节点部署这些硬活归它' },
      { name: '爪牙', meta: '79% · 9条', say: 2, gist: '踩坑试跑', items: ['试跑环境已起', '首批样本 200 单'], act: '调：小范围试跑环境', what: '先小范围跑一遍，把坑提前踩出来' },
      { name: '伏鼓旗', meta: '93% · 6条', say: 2, gist: '统一口径', items: ['回本口径两套并存', '客单价口径已统一'], act: '查：六部口径有没有冲突', what: '保证六部说的是同一件事，口径不乱' }
    ] },
    { id: 'voice', side: 'right', name: '造势攻心', brief: '管外面怎么看我们', agents: [
      { name: '羽翼', meta: '70% · 8条', say: 2, gist: '对外讲清', items: ['对外说“试点”，不说“进军”', '口径要和股肱的合规说法对齐'], act: '在想：对外怎么讲这件事', what: '对外讲清楚我们在干什么，抢认知' },
      { name: '术士', meta: '55% · 3条', say: 1, gist: '剑走偏锋', items: ['展会代理 · 见效快但不稳', 'KOL 分销'], act: '搜：非常规渠道的路子', what: '不走正面的办法，能用，但不能常用' },
      { name: '游士', meta: '69% · 9条', say: 3, gist: '探对手底', items: ['A 家 €129', 'B 家 €149 含运费'], act: '搜：三家竞品的公开报价', what: '摸清对手的报价、动作和底牌' }
    ] }
  ];

  /* text = 画布气泡里显示的那段话（原话整段）。
     short 是 2026-10-29 那版压出来的摘要，现在**不用了** ——
     业主 2026-10-30 一句「你发言就发言一小段？」把它否了：
     发言就是发言，得是完整的一段，不是抽一句当标题。字段先留着，没删。 */
  var TALKS = [
    {
      who: '地利', line: '情报研判', stance: 'pro', round: 3,
      short: '德国客单 3.2 倍，首年不碰美国',
      text: '德国 B2B 采购决策链比美国短四成，客单价是我们国内的 3.2 倍。首年不碰美国：获客成本会把单位经济算死。',
      ev: '3 份渠道商访谈 · 2 组定价测试'
    },
    {
      who: '股肱', line: '工程守御', stance: 'con', round: 3,
      short: '欧盟数据必须留在境内',
      text: '画像库里的欧盟用户数据不能跨境回传，必须走 SCC 或在欧盟境内部署节点。这不是成本问题，是不做就开不了张。',
      ev: 'GDPR 第 44-49 条 · 2 份律所意见'
    },
    {
      who: '游士', line: '造势攻心', stance: 'con', round: 2,
      short: '本土前三占 61%，价格没护城河',
      text: '本土前三家占 61% 份额。我们的差异不在功能，在交付速度和价格。这两条在欧美都不是护城河，对手随时能跟。',
      ev: '7 家竞品公开报价 · 12 份客户评价'
    },
    {
      who: '法算', line: '保障支撑', stance: 'con', round: 2,
      short: 'HS 编码错一类差 20 个点',
      text: 'HS 编码一旦归错，综合税率能差 20 个点。退货率按欧美电商均值 18% 算，直邮模式每单要倒亏。',
      ev: '4 个 HS 编码试算 · 2 家货代报价'
    },
    {
      who: '谋士', line: '决策中枢', stance: 'con', round: 4,
      short: '首年 800 万，回本 26 个月',
      text: '首年投入 800 万，回本周期 26 个月，超过内部 18 个月红线。要么缩规模，要么改口径。改口径不改变现金。',
      ev: '3 套预算模型 · 敏感性分析'
    },
    {
      who: '腹心', line: '合议', stance: 'sum', round: 4,
      short: '小代价试德国，不达标就撤',
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

  /* 一席 = 一张方卡：图标 / 职名 / 白话解释（后面跟证据条数），右上角是发言条数。
     职名是文言（腹心），底下紧跟一行白话（汇总收口）—— 名古、解释白，两件事不冲突。
     2026-10-28 业主两轮意见：先「删除这个」（整行 96% · 18条 下卡），
     再「这个（11条）移动到 这个（看准时机）后面」—— 百分比不要了，
     证据条数留着，接在白话后面当后缀。 */
  function agentCard(h, a) {
    var cnt = (a.meta.match(/\d+\s*条/) || [''])[0];
    var st = AG_STATE[a.name] || 'query';
    return '<div class="hall-agent s-' + st + '" title="' + esc(a.name) + '：' + esc(a.what) +
      '\n当前状态：' + ST_TXT[st] + '">' +
      '<span class="hall-ico">' + h.icon('bot', 13) + '</span>' +
      '<b>' + esc(a.name) + '</b>' +
      '<span class="hall-gist">' + esc(a.gist) +
        (cnt ? '<i class="hall-cnt">' + esc(cnt) + '</i>' : '') + '</span>' +
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

  /* 沙盘边长：2026-10-29 业主「沙盘比 agent 卡片略小点」——
     原来 260 的方盘压在 104 的方卡旁边太抢眼，缩成 92（卡 104，刚好小一圈），
     半径、描边、棋盘格都跟着收，不再当成一块面板。 */
  var SB_SIZE = 92;
  /* 沙盘与席卡的间距，以及画布上聊天气泡的宽度/贴边距离 —— 三处都按这边量 */
  var SAND_GAP = 12, BUB_W = 250, BUB_GAP = 12;

  /* ── 沙盘（2026-10-28 业主三轮意见）──────────────────────────────
     ① 「做个沙盘放在地利右侧」—— 地利管「算各国盘子」，沙盘就挂在它右边；
     ② 「拿国际象棋黑白格，颜色用我们 log 色蓝白，表示沙盘推演」—— 底板是蓝白棋盘；
     ③ 「不要里面内容，直接加个模糊，加个加载动画，显示沙盘推演中」
        —— 这一版要的是**还没出结果的状态**：四块地和底注收起来，
        换成景深模糊 + 转圈 + 「沙盘推演中」。盘还在，格子还看得见，只是不清楚。
     ⚠ 不用左侧竖条上色（业主明令禁止），状态一律走药丸 + 整框描边。 */
  function sandbox() {
    /* 位置：左列第二组（情报研判）里的第二张卡（地利）。
       2026-10-29 起盘子和卡差不多高了（92 vs 104），改成**垂直居中对齐**：
       底边对齐会让它比卡高出 12px 挂在上面，看着像没落位；居中最稳，指向也清楚。
       横向「贴在地利右边 12px」（业主「放 agent 卡片旁边」）：
       这个 12 是相对席卡的，所以 .hsand 也吃 --rail-out 的位移（见 CSS），
       否则席卡被往边上推、沙盘原地不动，间距会莫名涨到 28。 */
    var intelY = TOP + (GROUP_H + GROUP_GAP);
    var diliY = intelY + LABEL_H + ITEM_GAP + (CARD_H + ITEM_GAP);
    var x = SIDE_X + RAIL_W + SAND_GAP;
    var y = diliY + Math.round((CARD_H - SB_SIZE) / 2);

    return '<div class="hsand hsand-run" style="left:' + x + 'px;top:' + y + 'px">' +
      '<div class="hsand-blur"></div>' +
      '<div class="hsand-load">' +
        '<span class="hsand-spin"></span>' +
        '<b>沙盘推演中</b>' +
        /* 副行断在「行情」后面，不用自动折行 —— 76px 宽自动折会把「门槛」劈成
           「门」/「槛与起量」，一个字挂在行首。这里写死语义断点。 */
        '<i>卜算列国行情<br>门槛与起量</i>' +
      '</div>' +
      '</div>';
  }

  /* ── 席卡旁边的聊天气泡（2026-10-29 业主「在这上面」）──────────────
     上一版把「堂上发言」改成了气泡，但业主指的是**画布上这十八席开会的样子**：
     气泡要长在发过言那张卡的边上，不是页面下方另开一块。
     所以这里按席卡坐标算：左列的气泡往堂里伸，右列的反向，尖角对着卡片。
     文案用 TALKS 里的 short（20 来字摘要），全文仍在下面的堂上发言里。 */
  function cardPos() {
    var map = {}, li = 0, ri = 0;
    for (var i = 0; i < DEPTS.length; i++) {
      var d = DEPTS[i];
      var gi = d.side === 'left' ? li++ : ri++;
      var x = d.side === 'left' ? SIDE_X : W - SIDE_X - RAIL_W;
      var gy = TOP + gi * (GROUP_H + GROUP_GAP);
      for (var j = 0; j < d.agents.length; j++) {
        map[d.agents[j].name] = {
          x: x, y: gy + LABEL_H + ITEM_GAP + j * (CARD_H + ITEM_GAP), side: d.side
        };
      }
    }
    return map;
  }

  /* ── 发言唯一的次序（2026-10-30 业主「画布上发言、下面逐条记录」）──
     一次发言 = 一个气泡 = 一条记录，两个位置读的是同一份数据。
     `i` 是它在 TALKS 里的原始下标，两处都写成 data-talk= 同一个值，
     以后要做"点记录、画布上高亮对应气泡"就有据可查。
     排序按轮次，同轮按原始顺序 —— 页头写的是「按轮次排」，得对得上。 */
  function talkList() {
    return TALKS.map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) { return a.t.round - b.t.round || a.i - b.i; });
  }

  function actOf(name) {
    for (var i = 0; i < DEPTS.length; i++) {
      for (var j = 0; j < DEPTS[i].agents.length; j++) {
        if (DEPTS[i].agents[j].name === name) return DEPTS[i].agents[j];
      }
    }
    return null;
  }

  /* 气泡左边那枚小图标（2026-10-30 业主「图标呢？看看友商怎么做」）：
     友商（Manus / Operator 那一类）每一步前面都挂着工具图标，
     一眼看出这条是在搜、在读、在调工具，还是在想 —— 不用读字。
     这里按动作前缀给图标：搜 / 查 / 调 / 想 / 说。 */
  var KIND_ICON = {
    search: '<circle cx="10.8" cy="10.8" r="5.6"/><path d="M15 15l4.6 4.6"/>',
    read: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4.2h4"/>',
    tool: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
    think: '<path d="M12 3.6a5.4 5.4 0 0 0-3.1 9.8v2.4h6.2v-2.4A5.4 5.4 0 0 0 12 3.6z"/><path d="M9.8 18.6h4.4"/>',
    speak: '<path d="M4.5 5.5h15v9.5h-9.6L4.5 19z"/>'
  };
  function actKind(txt, st) {
    if (st === 'speak') return 'speak';
    var head = String(txt).split('：')[0];
    if (head === '搜') return 'search';
    if (head === '查') return 'read';
    if (head === '调') return 'tool';
    return 'think';
  }
  function kindIcon(kind, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      (KIND_ICON[kind] || KIND_ICON.think) + '</svg>';
  }

  /* 气泡标题一律是状态词（2026-10-30 业主「把上面改为统一，正在发言，搜索中」）：
     之前标题各写各的 ——「搜：德国 B2B 渠道商名单」「在算：现在进场比…」「小代价试德国」， 
     一屏扫下来没有读法。现在上面一行只说"此刻在干什么"，五种状态五个词；
     具体在搜什么、算到哪一步、说了什么，全部降到下面那行正文里。
     图标与状态词一一对应：放大镜=搜索中、文档=查阅中、齿轮=调用中、灯泡=思考中、对话=正在发言。 */
  var STATE_TXT = {
    search: '搜索中', read: '查阅中', tool: '调用中', think: '思考中', speak: '正在发言'
  };

  /* ── 席卡旁边的聊天气泡（2026-10-30 业主「思考、搜索工具、使用工具、搜索资料
     用气泡框展示，部分在 agent 卡片里面展示」）────────────────────
     气泡不再是「发言」专属，而是**这个 agent 此刻在做的事**：
       · 发言的 —— 里面是那整段话
       · 思考的 —— 「在算：…」「在想：…」，说清在算什么
       · 查询中的 —— 「搜：…」「查：…」「调：…」，说清在搜什么、调什么
       · 沙盘推演的 —— 不冒气泡，它旁边就是盘（状态唯一，一种表现）
     "部分在卡片里面"指的是产出：卡里那行「13 条」就是它这轮捞到的条数，
     气泡说在干什么、卡片记捞了多少，两处分工，不重复。 */
  function bubbles() {
    var pos = cardPos(), out = '';
    var last = {};
    talkList().forEach(function (o) {
      if ((AG_STATE[o.t.who] || 'query') === 'speak') last[o.t.who] = o;
    });

    Object.keys(pos).forEach(function (name) {
      var st = AG_STATE[name] || 'query';
      if (st === 'sand') return;
      var p = pos[name], o = last[name];
      var ag = actOf(name) || {};
      var speak = (st === 'speak' && o);
      /* 标题只放状态词，正文放具体内容（见 STATE_TXT 那段注释）。
         发言：正文是整段话；动作：正文是「搜：xxx」冒号后面那截，前缀已经由状态词说了，
         留着就是「搜索中 · 搜：xxx」这种重复。 */
      var raw = speak ? o.t.text : (ag.act || '');
      var kind = actKind(raw || ST_TXT[st], st);
      var label = STATE_TXT[kind] || '处理中';
      var body = '';
      if (speak) body = o.t.text;
      else if (raw && (kind !== 'think' || !ag.items)) {
        /* 思考类只有在有推理链时才省掉正文：那条 items 本来就是它的推理链，
           再顶一句「在算：…」既重复又多一层，卡间距 111 装不下。
           没有 items 的思考（「在想：对外怎么讲这件事」）还是得把这句留着，否则只剩一个状态词。 */
        var seg = String(raw).split('：');
        body = seg.length > 1 ? seg.slice(1).join('：') : raw;
      }
      /* 动作下面挂它捞到的东西（2026-10-30 业主给的参考图：
         「放大镜 · 正在搜索网页」下面是缩进的「网页 1 / 网页 2」）。
         搜、查、调这三类有产出，思考和发言没有 —— 硬塞条目就成了编。 */
      var items = (st !== 'speak' && ag.items) ? ag.items : null;
      var left = p.side === 'left';
      var xy = left ? 'left:' + (p.x + RAIL_W + BUB_GAP) + 'px' : 'right:' + (W - p.x + BUB_GAP) + 'px';
      out += '<div class="hbub ' + (left ? 'l' : 'r') + ' k-' + kind + '"' +
        (o ? ' data-talk="' + o.i + '"' : '') +
        ' style="' + xy + ';top:' + (p.y + CARD_H / 2) + 'px">' +
        '<span class="hbub-ic">' + kindIcon(kind, 20) + '</span>' +
        '<div class="hbub-bd"><p>' + esc(label) +
          (items ? '<span class="hbub-cnt">' + items.length + ' 条</span>' : '') +
          '</p>' +
          (body ? '<p class="hbub-full' + (items ? '' : ' nr') + '">' + esc(body) + '</p>' : '') +
          (items ? '<ul class="hbub-list">' + items.map(function (x) {
            return '<li>' + esc(x) + '</li>';
          }).join('') + '</ul>' : '') +
        '</div></div>';
    });
    return out;
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
    out += sandbox() + bubbles() + '</div></div>' +
      /* 输入条就在堂里 —— 十八席沿两边竖排，中间这块是业主开口的位置。
         挂在视口上而不是世界层上：纸面怎么变，说话的地方不动。
         2026-10-28 业主「画布固定住，不可移动」：缩放条、拖动提示、以及平移缩放本身
         全部去掉了 —— 工具条一留就会让人以为还能挪，不如一起收走。 */
      composer() +
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

  /* 堂上发言：画布上的发言在这里逐条记账（2026-10-30 业主「下面卡片逐条记录」）。
     一条记录对应画布上一个气泡，两边 data-talk 是同一个值，顺序也一致 ——
     画布是现场，这里是账本；账本按轮次排，一条不删。 */
  function talks(h) {
    var rows = talkList().map(function (o) {
      var t = o.t, st = STANCE[t.stance];
      return '<div class="dec-talk" data-talk="' + o.i + '">' +
        '<span class="dec-av t-' + st.cls + '">' + h.icon(t.stance === 'sum' ? 'seal' : 'bot', 15) + '</span>' +
        '<div class="dec-body">' +
          '<div class="dec-meta">' +
            '<b>' + esc(t.who) + '</b>' +
            '<span class="dec-tag t-' + st.cls + '">' + st.label + '</span>' +
            '<span class="dec-line">' + esc(t.line) + '</span>' +
            '<span class="dec-round">第 ' + t.round + ' 轮</span>' +
          '</div>' +
          '<div class="dec-bub t-' + st.cls + '">' +
            '<p>' + esc(t.text) + '</p>' +
          '</div>' +
          '<div class="dec-ev"><u>依据</u>' + esc(t.ev) + '</div>' +
        '</div>' +
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

  /* ── 画布是张纸：只自适应，不能拖也不能缩 ──────────────────
     2026-10-28 业主「画布固定住，不可移动」。原来的平移/缩放/工具条全撤了。
     缩放在这里只剩一个用途：窗口装不下时自动缩到装得下（K_MIN 兜底），
     这样窄屏也不会把右边那列切掉。视图只是局部变量，不跨重渲染保留 ——
     没有"业主调过的看法"这回事了。 */
  var K_MIN = 0.45;
  /* 画布底部必须让出的高度：常驻输入条 110 + 底距 28 + 12 边距 */
  var DOCK_RESERVE = 150;

  function paint(el, world, v) {
    world.style.transform = 'translate(' + Math.round(v.tx) + 'px,' + Math.round(v.ty) + 'px) scale(' +
      (Math.round(v.k * 1000) / 1000) + ')';
    /* 画布比世界层宽的时候，居中的那点留白别白扔 —— 把它推给两列席卡，
       让左右两组贴着画布边框站（还留 SIDE_X 的空），中间的堂跟着变宽。
       2026-10-28 业主「这两个往边上靠点，但要留空」：贴边，但不贴死。 */
    var out = Math.max(0, ((el.clientWidth || 0) / v.k - W) / 2);
    el.style.setProperty('--rail-out', (Math.round(out * 10) / 10) + 'px');
    /* 堂内输入条不许压到两列席卡：宽度跟着缩放后的中间空档走
       （空档 = 画布宽 - 左右两列各 (SIDE_X + RAIL_W)）。 */
    var worldPx = Math.max(W * v.k, el.clientWidth || 0);
    var gap = worldPx - 2 * (SIDE_X + RAIL_W) * v.k;
    el.style.setProperty('--dock-w', Math.round(gap - 24) + 'px');
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

  /* 量"这张纸上到底有多少东西"。2026-10-30 业主「气泡过高是不是可以加长画布，规矩不是死的」：
     之前世界层高度写死 1121，气泡一长就只能截断或压缩 —— 那是拿内容迁就纸面。
     现在纸面跟着内容长：谁的底边最低，画布就长到那儿，多的部分让页面去滚。
     注意 .hbub 带 translateY(-50%)，offsetTop 不含这个位移，底边得按 offsetTop + h/2 算。 */
  function contentH(world) {
    var maxB = H;
    var nodes = world.querySelectorAll('.hall-agent, .hbub, .hsand');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var isBub = n.classList.contains('hbub');
      var b = n.offsetTop + n.offsetHeight;
      if (isBub) b = n.offsetTop + n.offsetHeight / 2;
      if (b > maxB) maxB = b;
      /* 气泡长到顶端以外就把它压回来：纸面只往下长，不从顶上补 ——
         顶部是页头，没有可长的地方。 */
      if (isBub) {
        var top = n.offsetTop - n.offsetHeight / 2;
        if (top < 4) n.style.top = Math.round(n.offsetHeight / 2 + 4) + 'px';
      }
    }
    return Math.ceil(maxB + 48);
  }

  function fit(el, world, v) {
    var cw = el.clientWidth || 0;
    var vh = global.innerHeight || 0;
    if (cw < 40) return;

    /* 缩放只由**宽度**决定，不再看高度 —— 高度不够就加长画布，不把卡片缩小。
       （宽度装不下仍然要缩，否则右边那列会被切掉，K_MIN 兜底。） */
    var k = Math.min((cw - 20) / W, 1);
    v.k = Math.max(k, K_MIN);

    /* 纸面高度 = 内容实际高度；画布视口 = 纸面缩放后 + 顶部留白 + 底部给输入条的位置 */
    var paperH = contentH(world);
    world.style.height = paperH + 'px';
    var inner = world.querySelector('.hall');
    if (inner) inner.style.height = paperH + 'px';
    var need = paperH * v.k + 24 + DOCK_RESERVE;
    el.style.height = Math.max(Math.round(need), vh - 296) + 'px';

    var ch = el.clientHeight || 0;
    v.tx = (cw - W * v.k) / 2;
    var spare = ch - paperH * v.k;
    v.ty = Math.min(spare / 2, Math.max(0, spare - DOCK_RESERVE));
    paint(el, world, v);
  }

  function boot() {
    var el = global.document.getElementById('hall-canvas');
    if (!el) return;
    var world = el.querySelector('.hall-world');
    if (!world) return;
    /* 每次重渲染都从头算：没有要复原的视图状态 */
    var v = { k: 0, tx: 0, ty: 0 };

    dockEl = el;
    if (!boot.bound) {
      boot.bound = 1;
      /* capture 捕全部滚动容器（这页滚的是 App 外壳里的主栏，不是 window） */
      global.document.addEventListener('scroll', onDockScroll, { capture: true, passive: true });
      global.addEventListener('resize', onDockScroll);
    }
    /* 窗口变宽变窄要重算：一是贴边距离，二是装不下时得跟着缩。
       放这里而不是上面的绑定块：上面的只绑一次，闭包里攥的是第一次的那张画布。 */
    if (!el.__hallRz) {
      el.__hallRz = 1;
      global.addEventListener('resize', function () {
        var e2 = global.document.getElementById('hall-canvas');
        if (!e2) return;
        var w2 = e2.querySelector('.hall-world');
        if (w2) fit(e2, w2, { k: 0, tx: 0, ty: 0 });
      });
    }

    fit(el, world, v);

    /* 气泡的条目点一下展开（见 CSS 里 .hbub-list 那段）。委托挂在画布上，
       重渲染把子节点整个换掉也不用重绑。展开只改这一下的类，不写回数据。 */
    if (!el.__hbubClk) {
      el.__hbubClk = 1;
      el.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.hbub') : null;
        if (b && b.querySelector('.hbub-list')) b.classList.toggle('open');
      });
    }

    /* 首屏的页头高度要等字体落位才定，boot 这一下算出来的画布顶是临时的：再量两次。
       字体落位后文字行高会变，纸面高度也得跟着重算 —— 否则长气泡会被截掉一截。 */
    global.requestAnimationFrame(placeDock);
    if (global.document.fonts && global.document.fonts.ready) {
      global.document.fonts.ready.then(function () {
        var e2 = global.document.getElementById('hall-canvas');
        if (!e2) return;
        var w2 = e2.querySelector('.hall-world');
        if (w2) fit(e2, w2, { k: 0, tx: 0, ty: 0 });
        placeDock();
      });
    }
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
