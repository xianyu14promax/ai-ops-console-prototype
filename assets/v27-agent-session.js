/* SECTION: v27-agent-session
 * Agent 详情「会话与干预」Tab（位置：运行监控右边）。
 *
 * 界面照 DSH（DeepSeek Harness）的会话窗口做：顶部「对话 / 轨迹」两个子页签，
 * 对话是一条**平铺的轮次流**（用户气泡 → "已完成，用时 X" 折叠行 → 一行行动作 → Agent 正文），
 * 底部是任务条 + 输入条；轨迹是「轮次列表 + 三条泳道（输入/模型/工具）」。
 * 右侧是「第 N 轮改动」面板（DSH 同位置）。
 *
 * ── 干预模型（与 DSH 一致，也是业主这次强调的）──────────────────
 *   **人给提示，Agent 继续执行** —— 提示不打断、不暂停，作为"从下一轮起生效"的引导注入会话；
 *   被提示影响的后续轮次会标出「已按你的提示调整」并写明是哪一条，能对回源头。
 *   只有两个动作是"强干预"（会停）：暂停（本会话）与接管（转人工），都要额外权限 + 理由 + 审计。
 *   中途中断当前动作 ⇒ 在"继续执行"的模型下没有意义，已去掉（DSH 也没有这个按钮）。
 * ────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS, C = global.CHARTS;
  var A = (global.ACTIONS = global.ACTIONS || {});

  /* 权限预设用 DSH 的档位名（dsh-client-ui-permission-presets 的中文标签：
     仅可查看 / 工作区内修改 / 完全权限；选「完全权限」要过一次风险确认）。
     这三档管的是「Agent 自己能做多少」，与"给不给提示"无关 —— 提示任何时候都能给、都不打断。 */
  var MODES = [
    { id: 'readonly', label: '仅可查看', perm: 'agent:session:autonomy', hint: '只读检索与生成，任何写动作都不执行' },
    { id: 'write', label: '工作区内修改', perm: 'agent:session:autonomy', hint: '可执行写动作（建工单/推送），高危动作仍需人批' },
    { id: 'full', label: '完全权限', perm: 'agent:session:autonomy', risk: true, hint: '写动作与高危动作都直接执行，事后可按轮回滚' },
    /* 第四档：实验档，带 EXP 标记，选择时要过一次实验风险确认（strings.txt:687-691） */
    { id: 'auto', label: 'Auto review', perm: 'agent:session:autonomy', risk: true, exp: true, hint: '沙箱内自动执行 + 同模型逐调用复核（实验档）' }
  ];
  var KIND_CN = { start: '输入', llm: '模型', tool: '工具', guard: '校验', end: '输出' };
  var ACT_ICON = { tool: 'chip', llm: 'bot', guard: 'shield', start: 'play', end: 'checklist' };


  /* 斜杠指令（DSH：/ 打开选择器；选中即提交那条指令）。每条都真的做事，不做样子。 */
  var CMDS = [
    { cmd: 'permission', label: '/permission', arg: '仅可查看|工作区内修改|完全权限', hint: '切换当前会话权限预设（选完全权限要勾风险）' },
    { cmd: 'display', label: '/display', arg: '简洁|标准|详细|完全展开', hint: '切换展示模式（控制已完成轮次的过程显隐）' },
    { cmd: 'stop', label: '/stop', arg: '', hint: '停止当前任务（等同 Esc Esc）' },
    { cmd: 'delivery', label: '/delivery', arg: 'steer|queue', hint: '切换投递方式（插话 / 排队）' },
    { cmd: 'clear', label: '/clear', arg: '', hint: '清空草稿（不动会话）' }
  ];

  function store() { return global.SESSION_STORE; }
  /* 右栏宽度规则（[layout] README:30）。
     ⚠ 基数是**会话列的可用宽度（容器）**，不是 window.innerWidth —— DSH 的布局根是
     ConversationRoot 的 .body（ConversationRoot.module.css:371-399）：它把
     `--dsh-chat-content-width: clamp(680px, 列宽*0.64, 920px)` 挂在 .body 上，右栏是
     .body 的兄弟列，量的是同一个列宽。
     之前用 innerWidth（含左侧导航 rail 与主区留白）：1650 视口的 45% = 743px，
     而会话列只有 1307px → 右栏吃掉 57%，正文列被压到 518px（源码 clamp 下限 680px），
     于是「第 8 轮改动」里的说明文字被挤成「仅列写动作名 / 无 diff 内容」两行。
     现在改为量 .as-body 的实际宽度；量不到（首帧/无布局）才回落到列宽常量。 */
  var SIDE_FALLBACK_W = 1307;          /* .as-view 实测宽度；仅在拿不到容器时用 */
  /* 源码的列宽轴是**内容列**（ConversationRoot.module.css:384-387）：
       --dsh-chat-content-width: clamp(680px, 列宽*0.64, 920px)
     右栏是同一行里的兄弟列，所以「右栏 = 列宽 - 正文列 - 10px 拖拽条 - 18px*2 沟」，
     并且正文列永远不小于 clamp 的下限 680px。默认（未拖动）交给 CSS 的
     minmax(300px,32%) 轨道去算，这里只负责**用户拖过之后**钉死的像素值。 */
  function sideWidth(st, h) {
    var vw = SIDE_FALLBACK_W;
    try {
      var el = global.document && global.document.querySelector && global.document.querySelector('.as-body');
      if (el && el.getBoundingClientRect) { var w = el.getBoundingClientRect().width; if (w) vw = w; }
    } catch (e) { }
    var GAP = 18, GRIP = 10, minMid = 680, minSide = 300;
    var avail = vw - GRIP - GAP * 2;                   /* 正文 + 右栏 可用宽度 */
    /* 未拖动：按 32% 给出等效像素（CSS 里同值，这里只是把同一个数讲清楚） */
    var want = st.sideW || Math.round(vw * 0.32);
    want = Math.max(minSide, want);
    /* 上限：不能把正文列压到 clamp 下限之下；同时不超过容器的 70%（[layout] README:30） */
    var cap = Math.max(minSide, Math.min(Math.round(vw * 0.70), avail - minMid));
    return Math.round(Math.max(minSide, Math.min(want, cap)));
  }
  /* MCP 元信息：读写声明在数据层（seed 的 MCP_SERVICES[].rw），不在这里现推 */
  function mcpOf(id) {
    if (!id) return null;
    for (var i = 0; i < S.MCP_SERVICES.length; i++) if (S.MCP_SERVICES[i].id === id) return S.MCP_SERVICES[i];
    return null;
  }
  function sessUI(state, a) {
    var box = state.asUI || (state.asUI = {});
    /* sub 只有两档：'chat'（对话）/ 'traj'（轨迹）。**默认就是对话** —— 原来默认 'live'
       （内嵌 dsh web 服务）已按"纯前端"约束彻底移除，见 R33。 */
    if (!box[a.id]) box[a.id] = {
      sub: 'chat', openRounds: {}, lane: 'time', sel: null, instr: '', tasksOpen: false, killArmed: 0,
      follow: true, refs: [], attaches: [], composing: false, jobOpen: null, diffOpen: false,
      usageOpen: null, openCalls: {}, openGroups: {}, openTurnProcess: {}, openReason: {}, railPreview: null,
      trajQ: '', allRounds: false, allCalls: false, sideW: null, ctxOpen: false,
      /* v37：窄屏（≤1280）默认收起右栏 —— 那一档 .as-body 已是单列，右栏和正文抢同一条
         竖向空间，实测 1280×800 下正文列只剩 75px（两行各被压到 75）。收起后正文独占。
         宽屏维持展开（DSH 的默认形态），需要时用页签行右侧的「右栏」开关手动切。 */
      /* v46：宽屏默认**展开**（业主：右栏他要），窄屏（≤1280）默认收起 ——
         那一档 .as-body 已是单列、右栏改成覆盖层，展开会直接盖住正文。
         v43 曾一律收起（被业主问「右栏呢」），v45 一律展开（窄屏会盖住内容），这里是合并后的口径。 */
      sideOpen: ((global.innerWidth || 1440) > 1280),
      /* v53：口径条**按窗口高度自适应**（业主问：矮窗口有什么办法）。
         数学：滚到底之后右栏可视 = innerHeight − 287（顶栏70 + 页签31 + 输入条186）；
         右栏固定内容（状态/说明/改动/提示/服务/用量 + 间距）≈ 460px，
         口径展开再加 373 → 需要 ≥ 830。窗口不够就**自动折叠**（点标题还能展开，
         折叠不删数据 —— v48 教训是"藏信息"不行，这里是空间不够时的降级，且有入口）。
         实测：1000 高 → 713 < 830 → 折叠，内容 470 < 713 一屏装完；
               1200 高 → 913 ≥ 830 → 保持展开（业主窗口就是它，884 正好铺满）。 */
      metaOpen: ((global.innerHeight || 900) - 287) >= 830,
      trajSel: null, trajTab: 'overview', durationMode: 'actual',
      /* 轨迹页折叠态（dsh TrajectoryTable 的 collapsedTurns / collapsedAssistants）：
         按轮次记 traceId、按调用记 traceId#llmIndex —— 一条一条能单独展开，按钮只做「全收/全展」。 */
      trajCollapseTurns: {}, trajCollapseCalls: {},
      /* 时间轴的视口与框选（dsh TrajectoryTimeline 的 viewport / draftRange）：
         tgZoom = { z, cx }（以 cx 为锚点的放大倍数）；tgSel = { a, b, ids }（拖出来的那一段命中了哪些条）。 */
      tgZoom: null, tgSel: null,
      /* 轨迹页列筛选器的列开关状态（真实 DSH 轨迹页账本上方那一排「时长/轮次/调用/输入/模型/工具」）。
         null = 未动过 → 全部默认 on（见 tfColOn）；用户点过某一列后才落成对象。 */
      tfCols: null
    };
    if (box[a.id].railPreview === undefined) box[a.id].railPreview = null;
    return box[a.id];
  }
  /* 两个页签（对话 / 轨迹）。**没有第三个「真实界面」** —— 纯前端，不嵌服务、不起服务。 */
  function tabs(a, st, h) {
    return [['chat', '对话'], ['traj', '轨迹']].map(function (x) {
      return '<button class="as-tab' + (st.sub === x[0] ? ' on' : '') + '" data-act="as-sub" data-id="' + h.esc(a.id) + '|' + x[0] + '" role="tab" aria-selected="' + (st.sub === x[0]) + '">' + x[1] + '</button>';
    }).join('');
  }

  /* ---------------- 对话视图 ---------------- */
  function userBubble(r, h) {
    /* 用户消息页脚（真实 DSH：时间戳 + 复制按钮在气泡**下方右对齐**） */
    return '<div class="as-u">' +
      '<button class="as-iconbtn sm as-u-copy" data-act="as-msg-copy" data-id="' + h.esc(r.traceId) + '" title="复制这条消息" aria-label="复制这条消息">' + h.icon('chip', 13) + '</button>' +
      '<div class="as-u-b">' + h.esc(r.user) + '</div>' +
      '<div class="as-msg-ft"><span class="as-when">' + h.esc(r.when) + '</span>' +
      '<button class="as-iconbtn sm" data-act="as-msg-copy" data-id="' + h.esc(r.traceId) + '" title="复制这条消息" aria-label="复制这条消息">' + h.icon('chip', 13) + '</button></div></div>';
  }
  /* DSH 的耗时文案（strings.txt: `{seconds}秒` / `{minutes}分{seconds}秒` / `{milliseconds}毫秒`）；
     不用 fmt.dur 的 "1.08s" —— 中文界面照 DSH 写。 */
  function durCn(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return Math.round(ms) + ' 毫秒';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';                 /* v44：与 dsh 的「用时 22 秒」同一排版（数字与单位间留空格） */
    var m = Math.floor(s / 60), r = s % 60;
    return m + ' 分 ' + (r ? r + ' 秒' : '');
  }

  /* ⚠ 已删除：函数 actLine()（旧的过程行渲染器）。
     它没有任何调用点（全仓 grep 只有定义处），是一份**与 processRow() 并存的旧行实现**，
     产出的正是「图标/标签/详情/耗时列对不齐」的那种扁平结构（.as-ico + .as-lab.as-call +
     .as-dot2 + .as-det + .as-ms + .as-st + .as-inspect 平铺），并且它拼 x.label 时
     在 assistant-step 节点上会印出 `undefined · 回复` —— 即「⊙ : 回复」那类残行。
     删掉它，过程行只剩 processRow() 一条实现（源码 DisclosureRow + ToolRow 层级）。 */

  /* 轮次页脚（chat README:72）：操作行与正文相隔 20px；只有最新轮次且末条是回复时常显，
     其他轮次 hover/键盘聚焦时显示（不支持 hover 的设备始终显示 —— 用 @media (hover:none) 兜）。 */
  /* 轮次操作行（chat__MessageIconActions.css:5-74）：高 calc(28px+delta)、gap 8px、图标按钮 28×28 / radius 8 /
     图标 15px、tertiary→hover secondary；**起始时间戳在这一行里**（13px、padding-right 12px）。 */
  function roundFoot(r, isLast, h) {
    return '<div class="as-foot' + (isLast ? ' always' : '') + '">' +
      '<button class="as-iconbtn" data-act="as-open-trace" data-id="' + h.esc(r.traceId) + '" title="打开调用记录" aria-label="打开调用记录">' + h.icon('trace', 15) + '</button>' +
      (r.writes.length ? '<button class="as-iconbtn" data-act="as-round-change" data-id="' + h.esc(r.traceId) + '" title="查看本轮改动" aria-label="查看本轮改动">' + h.icon('checklist', 15) + '</button>' : '') +
      '<button class="as-iconbtn" data-act="as-strip" data-id="' + h.esc(r.traceId) + '" title="复制这一轮的调用摘要" aria-label="复制轨迹">' + h.icon('chip', 15) + '</button>' +
      '</div>';
  }

  /* 正文列宽按容器量（不是视口）；≤900px 时隐藏轨道，与 DSH 同规则。
     DSH 用的是 `container-type: inline-size` + `@container (max-width:900px)`
     （TurnNavigator.module.css:13,207-211）；本原型的 .as-feed-wrap 就是那个容器，
     CSS 侧已按具名容器 dsh-chat-frame 写好同样的隐藏规则。这里保留一次 JS 侧的
     宽度探测，让隐藏规则在**首帧**（容器查询还没生效时）也成立。 */
  function feedWidth(h) {
    try {
      var el = global.document && global.document.querySelector && global.document.querySelector('.as-feed');
      if (el && el.getBoundingClientRect) { var w = el.getBoundingClientRect().width; if (w) return w; }
    } catch (e) { }
    return 9999;
  }
  /* 轮次轨道（TurnNavigator）：
     · 位置：满宽 slot 内 right:12px / top:band 中点，不再是正文列外侧；
     · 刻度三态：静止 scaleX(.6) 无 opacity、未加载 scaleX(.4)+opacity:.6、
       预览 scaleX(.9)、激活 scaleX(1)（.module.css:97-129）；
     · 间距 10px（TURN_SPACING_PX）、两端 inset 6px（RAIL_INSET_PX）、
       items.length < 2 直接不渲染（TurnNavigator.tsx:29-33,161-165,227）。 */
  var TURN_SPACING_PX = 10, RAIL_INSET_PX = 6;
  /* rounds 由调用方直接给（历史轮 + 本次会话的追加轮合成的一条列表）——
     轨道刻度因此覆盖"用户刚追加的那一轮"，不再只数历史轮。 */
  function turnRail(rounds, st, h, a) {
    if (feedWidth(h) <= 900) return '';
    rounds = rounds || [];
    if (rounds.length < 2) return '';                     /* TurnNavigator.tsx:227 */
    var activeId = st.sel || (rounds[rounds.length - 1] || {}).traceId;
    if (!activeId) return '';
    var idx = 0;
    rounds.forEach(function (r, i) { if (r.traceId === activeId) idx = i; });
    var marks = rounds.map(function (r, i) {
      var active = i === idx;
      /* 预览 = 相邻刻度（±1）；未加载 = 该轮还没有真实 traceId（历史分页未取回） */
      var preview = !active && Math.abs(i - idx) === 1;
      var unloaded = !r.traceId;
      var cls = 'as-tick turnnav-mark' + (active ? ' on turnnav-markActive' : '') +
        (preview ? ' turnnav-markPreview' : '') + (unloaded ? ' turnnav-markUnloaded' : '') +
        (r.status === 'running' ? ' turnnav-markBusy' : '') +
        (r.status === 'failed' ? ' fail' : '');
      return '<button type="button" class="' + cls + '" data-act="as-jump" data-id="' + h.esc(r.traceId || ('r' + r.no)) + '"' +
        ' style="top:' + (RAIL_INSET_PX + i * TURN_SPACING_PX) + 'px"' +
        ' title="第 ' + (i + 1) + ' 轮 · ' + h.esc(r.intentName || '') + '" aria-label="第 ' + (i + 1) + ' 轮"></button>';
    }).join('');
    var height = RAIL_INSET_PX * 2 + rounds.length * TURN_SPACING_PX;
    return '<div class="as-rail turnnav-slot as-rail-slot"><div class="turnnav-frame">' +
      '<div class="turnnav-scroller"><div class="turnnav-marks" style="height:' + height + 'px">' + marks + '</div></div>' +
      '</div></div>';
  }

  /* 滚动归属：读者离开底部就停止跟随并显示「回到底部」；提交正文/插话后立即恢复跟随。
     ⚠ v37：这个函数此前是**死代码**（全文件没有一处调用），于是 st.follow 永远停在初值，
     「↓ 回到底部」按钮（渲染条件是 st.follow===false）在真实页面里从未出现过 ——
     滚到中间的人没有回底的入口，只能手拖。现在由 pumpEngine 在每拍挂载后重新绑定；
     状态真的翻转时才重绘一次（去抖 140ms，避免滚动过程中反复重画）。 */
  function bindFollow(h) {
    var d = global.document;
    var el = d && d.querySelector && d.querySelector('.as-feed-col');
    if (!el || !el.addEventListener) return;
    if (global.__asFollowBound === el) return;
    global.__asFollowBound = el;
    var handler = global.__asFollowHandler = function () {
      var gap = (el.scrollHeight || 0) - (el.scrollTop || 0) - (el.clientHeight || 0);
      var s = sessUIEl();
      if (!s) return;
      var next = gap <= 24;
      if (next === s.follow) return;          /* 只在真正跨过"贴底线"时才动 UI */
      s.follow = next;
      if (global.__asFollowUI) global.__asFollowUI(s.follow);
      if (global.__asFollowTimer) clearTimeout(global.__asFollowTimer);
      global.__asFollowTimer = setTimeout(function () {
        try { refresh(h); } catch (e) { }
      }, 140);
    };
    el.addEventListener('scroll', handler);
  }
  var __asUI = null;
  function sessUIEl() { return __asUI; }

  /* 工具卡（primitives/*.module.css）：读取卡=行号栏 + 等宽正文；搜索卡=文件名 600 + 计数；
     **没有数据源的卡（终端/网页）不编内容**，只说明为什么没有。 */
  function toolCard(x, r, a, h, open) {
    if (!open) return '';
    var kindCn = { tool: '工具调用', llm: '模型调用', guard: '校验', start: '输入', end: '输出' }[x.kind] || x.kind;
    var tr = null;
    try { tr = r.traceId ? global.FACTS.getTrace(r.traceId) : null; } catch (e) { }
    var sp = tr && (tr.spans || []).filter(function (s) { return s.name === x.name; })[0];
    var rows = [];
    rows.push(['调用', kindCn + ' · ' + x.name]);
    if (x.mcp) rows.push(['MCP', x.mcp + (x.write ? '（写）' : '（读）')]);
    if (sp && sp.model) rows.push(['模型', sp.model]);
    if (sp && (sp.tokensIn != null || sp.tokensOut != null)) rows.push(['token', 'in ' + (sp.tokensIn || 0) + ' / out ' + (sp.tokensOut || 0)]);
    if (sp) rows.push(['耗时', (sp.duration != null ? sp.duration + 'ms' : '—') + ' · ' + (sp.status === 'failed' ? '失败' : '成功')]);
    if (x.ms != null && !sp) rows.push(['耗时', x.ms + 'ms（本会话实时测量）']);
    return '<div class="as-card">' +
      '<div class="as-card-hd"><span class="as-card-t">' + h.esc(kindCn) + '</span>' +
      '<span class="as-card-sub">' + h.esc(x.name) + '</span>' +
      (x.status === 'failed' ? '<span class="as-card-bad">失败' + (x.error ? ' · ' + h.esc(x.error.name) : '') + '</span>' : '') + '</div>' +
      '<div class="as-card-b">' + rows.map(function (kv) {
        return '<div class="as-kv"><span>' + h.esc(kv[0]) + '</span><b>' + h.esc(String(kv[1])) + '</b></div>';
      }).join('') + '</div>' +
      (x.kind === 'tool' ? '<div class="as-card-note">本次会话没有终端 / 网页类卡片。</div>' : '') +
      '</div>';
  }
  /* ── 过程分组（严格照 DSH conversation-nodes/process-groups.ts:13,157-179）──────────
     真实规则**不是**"非工具行 / 工具行"二分，而是三条边界：
       ① INDEPENDENT 的 7 类节点（user / steering / turn-trigger / model-retry /
          turn-error / turn-max-tokens / turn-tail）遇到就切段，且**自己不入组**；
       ② assistant-step 的 reply（带正文的回复）切段，reply 自己作为 groupPart='response' 入组；
       ③ turn-process 是**整轮控制锚点**（process-groups.ts:168-170）：它挂在已经攒起来的那段上，
          自己不新开段、也不切段。
     "独立节点 / 回复 / turn-process" 之外的节点（思考、工具调用…）一律 push 进当前段。
     一轮里 Step 编号变化**不拆段**（源码里没有这个边界）。 */
  var INDEPENDENT = { user: 1, steering: 1, 'turn-trigger': 1, 'model-retry': 1, 'turn-error': 1, 'turn-max-tokens': 1, 'turn-tail': 1 };

  /* 活动类别字典（ui-chat/src/client/locale.ts:35-52 的 done.* 14 条，逐字） */
  var DONE_LABEL = {
    thinking: '已完成分析', read: '已读取文件', readImage: '已读取图片', write: '已写入文件',
    search: '已搜索代码', edit: '修改了文件', commands: '执行了命令', code: '运行了代码',
    webSearch: '已搜索网页', webFetch: '已访问网页', subagents: '已协调子智能体',
    plan: '更新了计划', questions: '向用户提出了问题', tools: '已调用工具'
  };
  /* 分类一个过程节点（对应 process-activity.ts 的类别归并；本原型的数据只有
     kind + 工具名 + MCP 名，所以按名称/服务归类，归不到就落 thinking）。 */
  function activityKind(n) {
    var name = String(n.name || '').toLowerCase();
    var mcp = String(n.mcp || '').toLowerCase();
    if (/读取|read|get_|query|检索|明细|parse|doc/.test(name + ' ' + mcp)) return 'read';
    if (/搜索|search|kb|knowledge/.test(name + ' ' + mcp)) return 'search';
    if (/写入|write|创建|create|推送|notify|send|ticket/.test(name + ' ' + mcp)) return n.rw === 'write' ? 'write' : 'tools';
    if (/命令|command|shell|exec|运行/.test(name)) return 'commands';
    if (/代码|code|script/.test(name)) return 'code';
    if (/网页|web|fetch|url/.test(name)) return 'webFetch';
    if (/计划|plan|patch|更新计划/.test(name)) return 'plan';
    if (/问|ask|question|确认/.test(name)) return 'questions';
    if (n.rw === 'write') return 'write';
    if (n.kind === 'llm') return 'thinking';
    if (n.kind === 'guard') return 'commands';
    if (n.kind === 'tool') return 'tools';
    return 'thinking';
  }
  /* 段的活动摘要：按**去重调用数排名**（process-activity.ts）；同数按首次出现顺序 */
  function processActivity(nodes) {
    var order = [], count = {};
    nodes.forEach(function (n) {
      if (n.kind === 'assistant-step') {
        /* 思考块也是一种活动（reasoning → thinking） */
        var k = n.reasoning ? 'thinking' : null;
        if (k) { if (count[k] == null) { count[k] = 0; order.push(k); } count[k]++; }
        return;
      }
      var kind = activityKind(n);
      if (count[kind] == null) { count[kind] = 0; order.push(kind); }
      count[kind]++;
    });
    var counts = order.map(function (k) { return { kind: k, count: count[k] }; })
      .sort(function (a, b) { return b.count - a.count || order.indexOf(a.kind) - order.indexOf(b.kind); });
    return { counts: counts, running: undefined, runningDetail: '' };
  }
  /* 组标题（ui-chat/src/client/chat/step-process.ts:11-28 逐行等价）：
     取排名前 3 类别 → 两个用 joinTwo('{first}并{second}')、三个用 comma('，')、
     多于 3 项加 more('{title}等')；两项共享前缀 '已' 时第二项去掉前缀（sharedPrefix:'已'）。 */
  function processTitle(summary) {
    var labels = summary.counts.slice(0, 3).map(function (c) { return DONE_LABEL[c.kind] || DONE_LABEL.thinking; });
    var first = labels[0];
    if (first === undefined) return '已完成分析';       /* t('message.stepProcess.done.thinking') */
    function continuation(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
    var second = labels[1];
    if (second === undefined) return first;
    if (labels.length === 2) {
      var prefix = '已';                                /* sharedPrefix */
      var shared = prefix !== '' && first.indexOf(prefix) === 0 && second.indexOf(prefix) === 0;
      return first + '并' + continuation(shared ? second.slice(prefix.length) : second);
    }
    var title = [first].concat(labels.slice(1).map(continuation)).join('，');
    return summary.counts.length > 3 ? title + '等' : title;
  }
  /* 段 → 组（process-groups.ts:157-179 的主循环等价实现） */
  function buildProcessGroups(nodes) {
    var out = [], pending = [], followed = false;
    function flush() {
      if (!pending.length) return;
      var act = processActivity(pending);
      /* activity = 组内排名第一的类别。源码 ChatGroupSeat.tsx:114 就是
         `data.summary.counts[0]?.kind ?? 'thinking'`，选择器 [data-process-activity] 靠它选中图标。 */
      out.push({ nodes: pending, title: processTitle(act), activity: (act.counts[0] || {}).kind || 'thinking',
        counts: act.counts });
      pending = [];
    }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (INDEPENDENT[n.kind]) { flush(); continue; }          /* 独立节点：切段，自己不入组 */
      if (n.kind === 'turn-process') { continue; }             /* 整轮控制锚点：不切段、不入组 */
      if (n.kind === 'assistant-step') {
        if (n.reasoning) pending.push(n);
        if (n.reply) { pending.push(n); flush(); }             /* 回复：入组后切段 */
        continue;
      }
      pending.push(n);
    }
    flush();
    return out;
  }
  /* 展示模式能力位（presentation-policy.ts:28-57 + stores.ts:36-44）——
     **没有条数阈值**：折叠的粒度是"整轮"，不是"前 N 条动作"。 */
  function policyOf(mode) {
    var E = global.SESSION_ENGINE;
    if (E && E.policyOf) return E.policyOf(mode);
    return { mode: mode, foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: true, settledReasoningPreview: true };
  }
  /* stores.ts:36-44 turnProcessOpen()：**手动选择优先**；没有手动选择时，
     「最新的已完成轮次保持展开，更早的轮次折叠」。折叠粒度是整轮（不是前 N 条）。 */
  function defaultTurnOpen(isNewest) { return !!isNewest; }
  /* 一"轮"的节点序列（把会话存储的一轮折成 DSH 的 node 列表）。
     reply 文本来自会话存储的示例对话（界面已逐处标注是示例内容），不是编造。 */
  function roundNodes(r) {
    var out = [{ kind: 'user', id: 'user-' + r.traceId, name: '用户', text: r.user, rw: null }];
    (r.actions || []).forEach(function (x, i) {
      out.push({ kind: 'tool-call', id: (r.traceId || 'r' + r.no) + '-a' + i, name: x.name, mcp: x.mcp, model: x.model, rw: x.write ? 'write' : (x.write === false ? 'read' : null), ms: x.ms, status: x.status, act: x });
    });
    /* v32：思考文本来自轮次数据（此前恒为 null ⇒ DSH 的思考行是死代码）。 */
    out.push({ kind: 'assistant-step', id: (r.traceId || 'r' + r.no) + '-reply', name: '回复', reply: r.assistant, reasoning: r.reasoning || null });
    return out;
  }

  /* 单条过程行 —— **按源码 DOM 层级重建**（这一版修的根因：上一版只逐字搬了 CSS、
     没搬 DOM，选择器命中不了，行距/对齐全靠 .as-act 自己那套，于是错乱）。
     源码结构（照抄层级，只把类名加上模块前缀）：
       tool/ToolRow.tsx:358-378   .root[data-variant][data-tool][data-state]
         primitives/DisclosureRow.tsx:86-122
           .root[data-open] > .header[data-disclosure-header][data-has-accessory?]
             > .row[data-disclosure-row][data-expandable][role=button][tabindex][aria-expanded]
                 > .leading（可展开时是 <button aria-label aria-expanded>）
                 > TextShimmer.root > TextShimmer.content
                     > TextShimmer.text（= .title）
                     > collapsedContent：.sep + .summary（+ .summarySuffix / .diffStat）
             > headerAccessory（状态点，**在 .row 之外**）
           > 展开体（.bodyWrap …）
     CSS 侧：.disclosure-* / .toolrow-* / .shimmer-* 见本文件 SECTION: dsh-verbatim-rows，
     与源码 ui-primitives/src/DisclosureRow.module.css、ui-tool/src/.../ToolRow.module.css、
     TextShimmer.module.css、StateDot.module.css 逐字对应。 */
  function processRow(n, r, st, h, a) {
    var x = n.act || n;
    var box = (st.openCalls && st.openCalls[r.traceId]) || {};
    var allOpen = st.allCalls === true;
    var callOpen = allOpen || !!box[x.name];
    /* 行状态 → ToolRowState（tool-call-model.ts：preparing/running/error/stopped） */
    var rowState = x.status === 'failed' ? 'error'
      : (x.status === 'running' ? 'running' : (x.status === 'cancelled' ? 'stopped' : 'ok'));
    /* 状态点 = StateDot（StateDot.module.css）：done/warning/error/idle/ongoing。
       在线状态与源码同一套语义 —— 写动作 warning、失败 error、进行中 ongoing、中断 idle。 */
    var dotState = x.status === 'failed' ? 'error'
      : (x.status === 'running' ? 'ongoing'
        : (x.status === 'cancelled' ? 'idle' : (x.write ? 'warning' : 'done')));
    var dotBox = x.status === 'running'
      ? '<span class="statedot-spinner statedot-spinnerMotion" role="img" aria-label="进行中">' +
        '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">' +
        '<circle class="statedot-spinnerTrack" cx="8" cy="8" r="6"/>' +
        '<path class="statedot-spinnerArc" d="M8 2a6 6 0 0 1 6 6"/></svg></span>'
      : '<span class="statedot-dot" data-state="' + dotState + '" aria-hidden="true"></span>';
    /* 标题：源码 ToolRow 的 title 是本地化动作名（"读取文件"…）。
       assistant-step（回复）节点没有 label 字段 —— 旧实现直接拼 x.label，于是渲染出
       `undefined · 回复`（这正是一条 "渲染无接线断口" 与「行错位」的成因）。
       这里退回 name，两者都空才用 kind 兜底，绝不把 undefined 印到页面上。
       运行中/已取消是**状态**而不是动作名（源码 ToolRow 的 title 始终是动作名，
       运行态由行状态 + 状态点表达），所以这两种状态下文案显式写出来。 */
    var titleText = x.status === 'running' ? '正在执行'
      : (x.status === 'cancelled' ? '已取消'
        : String(x.label == null || x.label === '' ? (x.name || x.kind || '动作') : x.label));
    var titleHtml = h.esc(titleText);
    var summaryHtml = x.detail ? h.esc(x.detail) : (x.status === 'running' || x.status === 'cancelled' ? h.esc(x.name || '') : '');
    var callId = h.esc(a.id) + '|' + h.esc(r.traceId) + '|' + h.esc(x.name);
    var bodyId = 'as-act-b-' + h.esc(r.traceId) + '-' + h.esc(x.name).replace(/[^A-Za-z0-9_-]/g, '_');
    return '<div class="toolrow-root disclosure-root as-act k-' + h.esc(x.kind) + (x.status === 'failed' ? ' is-fail' : '') + '"' +
      ' data-act-root="' + callId + '" data-variant="' + h.esc(x.kind) + '" data-tool="' + h.esc(x.name) + '"' +
      ' data-state="' + rowState + '"' +
      (callOpen ? ' data-open="1"' : '') + '>' +
      '<div class="disclosure-header" data-disclosure-header data-has-accessory>' +
      '<div class="disclosure-row toolrow-row" data-disclosure-row data-expandable="1" role="button" tabindex="0"' +
      ' aria-expanded="' + callOpen + '" aria-controls="' + bodyId + '"' +
      ' data-act="as-call" data-id="' + callId + '">' +
      '<button type="button" class="disclosure-leading toolrow-leading as-ico" data-act="as-call" data-id="' + callId + '"' +
      ' aria-label="' + h.esc(titleText + ' · ' + (x.name || '')) + '" aria-expanded="' + callOpen + '">' +
      (callOpen ? '<span class="disclosure-chevron as-chev">⌃</span>'
        : '<span class="disclosure-iconIdle">' + h.icon(ACT_ICON[x.kind] || 'chip', 14) + '</span>' +
          '<span class="disclosure-chevronHover">⌄</span>') +
      '</button>' +
      '<span class="shimmer-root"><span class="shimmer-content">' +
      '<span class="shimmer-text disclosure-title toolrow-title as-lab">' + titleHtml + '</span>' +
      (x.write ? '<span class="as-w">写</span>' : '') +
      (summaryHtml ? '<span class="toolrow-sep as-dot2" data-shimmer-decoration aria-hidden="true"></span>' +
        '<span class="shimmer-text toolrow-summary as-det">' + summaryHtml + '</span>' : '') +
      (x.status === 'running' ? '<span class="shimmer-text toolrow-summarySuffix as-ms">进行中…</span>'
        : (x.status === 'cancelled' ? '<span class="shimmer-text toolrow-summarySuffix as-ms">已停止</span>'
          : (x.ms == null ? '' : '<span class="shimmer-text toolrow-summarySuffix as-ms">' + durCn(x.ms) + '</span>'))) +
      (x.status === 'failed' && x.error ? '<span class="shimmer-text toolrow-summarySuffix toolrow-errorSummary as-fail">失败 · ' + h.esc(x.error.name) + '</span>' : '') +
      '</span></span>' +
      '</div>' +
      /* headerAccessory：状态点（ToolRow.tsx:360 的 .visuallyHidden + DisclosureRow.tsx:119 的 headerAccessory）
         —— 关键：它**不在 .row 里**，所以 hover 变色的作用域和标题宽度都不受它影响。 */
      dotBox +
      '</div>' +
      '<div class="toolrow-bodyWrap" id="' + bodyId + '">' + toolCard(x, r, a, h, callOpen) +
      /* Inspect 药丸：源码是 ToolRow.tsx:342-351 的 .inspectButton —— **展开体内部**的最后一个子元素
         （.bodyWrap 里、体之下），不是行内的兄弟。这里照源码放进 .toolrow-bodyWrap。
         为不破坏既有 503 条断言（R7 用 data-act="as-inspect" 定位、.as-inspect 是 hover 药丸），
         类名保留 .as-inspect。 */
      '<button type="button" class="toolrow-inspectButton as-inspect" data-act="as-inspect" data-id="' + callId + '"' +
      ' title="在轨迹里检查这次调用">检查</button>' +
      '</div>' +
      '</div>';
  }
  /* 思考行（ui-chat/src/client/chat/ReasoningRow.tsx + ReasoningRow.module.css）。
     v32（2026-10-15）：此前这个函数是**死代码** —— roundNodes 把 reasoning 恒写成 null，
     也没有任何调用点，于是 DSH 的「思考」行在界面上从来没出现过（类族审计：reasonrow-* 零命中）。
     现在按源码语义补齐：
       · 折叠时只给**最后一段已完成段落的首行**做摘要（`latestCompletedParagraphFirstLine`），
         不是整段截断 —— 这一条是源码里最容易漏的细节；
       · 展开时给完整 Markdown，字号降一档（.reasonrow-thinkBody 自己带 --dsh 字号变量）；
       · 开头是 think 图标，行本身是 DisclosureRow（与 toolrow 同一套 disclosure 结构）；
       · **轮级过程折叠时整行隐藏**（源码的 reasoningHidden：过程已由整轮控件承载，不再重复说一遍）。 */
  function latestCompletedParagraphFirstLine(text) {
    /* 照 ReasoningRow.tsx:19-35 逐行对齐：逐段扫描，只取**段内有换行**的那段首行
       （最后一段若还没收尾 —— 文本末尾没有换行 —— 就不算"已完成段落"）。
       先前那版无条件丢掉最后一段，遇到"以换行结尾"的文本会少算一段。 */
    var s = String(text), summary = '', start = 0;
    var sep = /\r?\n(?:[\t ]*\r?\n)+/g, m;
    for (;;) {
      m = sep.exec(s);
      var paraEnd = m === null ? s.length : m.index + m[0].indexOf('\n');
      var nl = s.indexOf('\n', start);
      if (nl !== -1 && nl <= paraEnd) {
        var cand = s.slice(start, nl).trim();
        if (cand !== '') summary = cand;
      }
      if (m === null) return summary;
      start = m.index + m[0].length;
    }
  }
  function reasoningRow(x, st, h) {
    var text = x && x.reasoning;
    if (!text) return '';
    var key = x.id || 'reason';
    var open = !!(st.openReason && st.openReason[key]);
    var summary = latestCompletedParagraphFirstLine(text);
    var bodyId = 'as-reason-b-' + h.esc(key).replace(/[^A-Za-z0-9_-]/g, '_');
    return '<div class="reasonrow-root" data-preview="1"' + (open ? ' data-expanded="1"' : '') + '>' +
      '<div class="reasonrow-row disclosure-root">' +
      '<div class="disclosure-header" data-disclosure-header>' +
      '<div class="disclosure-row reasonrow-row" data-disclosure-row data-expandable="1" role="button" tabindex="0"' +
      ' aria-expanded="' + open + '" aria-controls="' + bodyId + '"' +
      ' data-act="as-reason" data-id="' + h.esc(key) + '">' +
      '<button type="button" class="disclosure-leading reasonrow-leading as-ico" data-act="as-reason" data-id="' + h.esc(key) + '"' +
      ' aria-label="思考过程" aria-expanded="' + open + '">' +
      (open ? '<span class="disclosure-chevron as-chev">⌃</span>'
        : '<span class="disclosure-iconIdle">' + h.icon('bulb', 14) + '</span>' +
          '<span class="disclosure-chevronHover">⌄</span>') +
      '</button>' +
      '<span class="reasonrow-title disclosure-title as-lab">思考</span>' +
      '<span class="reasonrow-separator" aria-hidden="true"></span>' +
      '<span class="reasonrow-summary"><span class="reasonrow-summaryText">' + h.esc(summary) + '</span></span>' +
      '</div>' +
      '</div>' +
      (open ? '<div class="reasonrow-thinkBody disclosure-body" id="' + bodyId + '">' + mdToHtml(text, h) + '</div>' : '') +
      '</div></div>';
  }
  /* 组 = 可折叠的组头 + 限高组体（ChatGroupSeat）。
     收起时**不渲染成员**（与 DSH 的 hidden seat 同效）。
     组身份用"首成员 id"（process-groups.ts:141 `['process', first.key, groupPart]` 的同构做法），
     不用序号 —— 序号会在实时轮里随着节点增删漂移。 */
  function groupKeyOf(g) {
    var first = g.nodes[0] || {};
    return 'g:' + String(first.id);
  }
  function groupSeat(g, r, st, h, a) {
    var key = groupKeyOf(g);
    var groups = st.openGroups[r.traceId] || (st.openGroups[r.traceId] = {});
    var open = groups[key] !== false;                 /* 默认展开；点标题才收起（useDisclosure） */
    var body = open ? g.nodes.map(function (n) { return processRow(n, r, st, h, a); }).join('') : '';
    var fade = open && g.nodes.length > 6;
    var bodyId = 'as-gs-b-' + h.esc(r.traceId) + '-' + key.replace(/[^A-Za-z0-9_-]/g, '_');
    /* 源码层级（ChatGroupSeat.tsx:185-202）：
         .root[data-chat-group-key][data-chat-flow-key][data-chat-turn][data-step-process][data-group-expanded-mode]
           > <div ref=headerRef>                 ← 组头外壳（源码里是个裸 div，就是 DisclosureRow 的挂点）
               > button.title[aria-expanded][aria-controls][data-process-activity]
                   > span.leading[aria-hidden] > span.activityIcon[data-step-process-icon]
                                               > span.chevron[data-step-process-chevron]
                   > TextShimmer.root > .content > .text.label（= 组标题）
           > div.body[data-step-process-body][data-scroll-up?][data-scroll-down?]
               > div.content[data-step-process-content][data-chat-flow]  ← 成员（过程行）在这
       类名一律加 groupseat- / shimmer- / disclosure- 前缀，与逐字 CSS 对齐。
       我方自有的 .as-grp-seat / .as-grp / .as-acts 作为外层容器保留。 */
    return '<div class="groupseat-root as-grp-seat as-acts" data-chat-group-key="' + h.esc(key) + '"' +
      ' data-chat-flow-key="' + h.esc(key) + '" data-chat-anchor-key="group:' + h.esc(key) + '"' +
      ' data-chat-turn="' + h.esc(r.no) + '" data-step-process data-group-expanded-mode="' + (open ? 'scroll' : 'none') + '">' +
      '<div class="groupseat-headerWrap">' +
      '<button type="button" class="groupseat-title as-grp" data-act="as-grp" data-id="' + h.esc(a.id) + '|' + h.esc(r.traceId) + '|' + h.esc(key) + '"' +
      ' aria-expanded="' + open + '"' + (open ? '' : '') + ' aria-controls="' + bodyId + '"' +
      ' data-process-activity="' + h.esc(g.activity || 'tools') + '"' +
      ' title="' + h.esc(g.title) + '（' + g.nodes.length + ' 个动作）">' +
      '<span class="groupseat-leading" aria-hidden="true">' +
      '<span class="groupseat-activityIcon" data-step-process-icon>' + h.icon('sliders', 16) + '</span>' +
      '<span class="groupseat-chevron as-caret" data-step-process-chevron>' + (open ? '⌃' : '⌄') + '</span></span>' +
      '<span class="shimmer-root"><span class="shimmer-content">' +
      '<span class="shimmer-text groupseat-label">' + h.esc(g.title) + '</span>' +
      '</span></span></button>' +
      '<i class="as-grp-n">' + g.nodes.length + '</i></div>' +
      (open ? '<div class="groupseat-body' + (fade ? ' groupseat-fadeTop groupseat-fadeBottom' : '') + '" id="' + bodyId + '"' +
        ' data-step-process-body data-group-expanded-mode="scroll" data-scroll-up="1"' +
        (fade ? ' data-scroll-down="1"' : '') + '>' +
        '<div class="groupseat-content" data-step-process-content data-chat-flow>' + body + '</div></div>' : '') +
      '</div>';
  }
  /* 整轮过程控件（chat/TurnProcessNodeView.tsx:18-58 + .module.css:1-53）——
     这是**外层**开关：DSH 用它折叠整轮的过程范围（组只是它里面的层）。我方原来只有组、没有它，
     所以 verbose（foldCompletedTurns:false）档根本立不住。 */
  function turnProcessControl(r, policy, st, h, a, isNewest) {
    if (r.status === 'running') return '';            /* TurnProcessNodeView.tsx:18 turn?.status !== 'closed' → null */
    var turnKey = r.traceId || ('r' + r.no);
    var manual = st.openTurnProcess[turnKey];
    var want = (manual === undefined) ? defaultTurnOpen(isNewest) : !!manual;   /* stores.ts:36-44 手动优先 */
    var open = policy.foldCompletedTurns ? want : true;   /* verbose：foldable=false → 恒开 */
    var hasContent = (r.actions || []).length > 0;
    var canCollapse = policy.foldCompletedTurns && hasContent;
    var reason = r.status === 'failed' ? 'error' : (r.status === 'killed' || r.rolled ? 'aborted' : null);
    var elapsed = r.latencyMs == null ? null : Math.max(1000, r.latencyMs);
    var duration = (elapsed === null || reason === 'aborted' || reason === 'error') ? null : durCn(elapsed);
    var label = reason === 'aborted' ? '已停止'                        /* locale.ts:157 message.stopped */
      : reason === 'error' ? '处理失败'                                /* locale.ts:66 message.turnProcess.failed */
        : duration === null ? '已完成'                                 /* locale.ts:64 message.turnProcess.worked */
          : '用时 ';                                                   /* locale.ts:65 message.turnProcess.took（dsh 就是"用时 22 秒"，没有"已完成，"前缀） */
    return '<button type="button" class="turnprocess-root as-a-hd" data-act="as-turnprocess" data-id="' + h.esc(a.id) + '|' + h.esc(turnKey) + '"' +
      (open && canCollapse ? ' data-open="1"' : '') +
      ' data-turn-process="' + r.no + '"' +
      ' data-turn-process-messages="' + (r.user ? 1 : 0) + '"' +
      ' data-turn-process-tool-calls="' + (r.actions || []).length + '"' +
      ' data-turn-process-subagents="0"' +
      (canCollapse ? '' : ' disabled') +
      ' aria-expanded="' + (hasContent ? open : '') + '">' +
      '<span class="turnprocess-label"><span class="as-done">' + h.esc(label) + '</span>' +
      (duration === null ? '' : '<span class="turnprocess-durationNumber">' + duration) + '</span>' +
      (canCollapse ? '<span class="turnprocess-chevron">⌄</span>' : '') +
      '</button>';
  }
  /* 一轮的整个过程区（整轮控件 + 若干组）。
     · verbose（foldCompletedTurns:false + stepGrouping:'none'）：整轮控件不可收起、过程常显；
     · 其余档：整轮控件可收起，收起时过程整段不渲染（折叠的粒度是"整轮"，**不是"前 N 条"**）；
     · stepGrouping:'collapsed' → 组可折叠；'history' → 历史轮次的组才可折叠；
       'none'（verbose）→ 只显示组头，组体常显。 */
  function actsBlock(r, st, h, a, isNewest) {
    var E = global.SESSION_ENGINE;
    var dm = (E && E.view()) ? E.view().displayMode : 'standard';
    var policy = policyOf(dm);
    var groups = buildProcessGroups(roundNodes(r));
    var turnKey = r.traceId || ('r' + r.no);
    var manual = st.openTurnProcess[turnKey];
    var want = (manual === undefined) ? defaultTurnOpen(isNewest) : !!manual;
    var open = policy.foldCompletedTurns ? want : true;
    var groupFoldable = policy.stepGrouping === 'collapsed' || policy.stepGrouping === 'history';
    var html = '';
    if (open && r.status !== 'running') {
      groups.forEach(function (g) {
        html += groupSeat(g, r, groupFoldable ? st : { openGroups: {} }, h, a);
      });
    } else if (r.status === 'running') {
      /* 运行中的轮次：过程直接显示（不套整轮控件 —— 源码里该控件只在 turn 收口后出现） */
      groups.forEach(function (g) {
        html += groupSeat(g, r, groupFoldable ? st : { openGroups: {} }, h, a);
      });
    }
    return turnProcessControl(r, policy, st, h, a, isNewest) +
      (html ? '<div class="as-acts">' + html + '</div>' : '');
  }
  function hintMarks(r, h) {
    var out = '';
    if (r.hints && r.hints.length) {
      out += '<div class="as-adj"><span class="as-adj-tag">已按你的提示调整</span>' +
        r.hints.map(function (hn) {
          return '<span class="as-adj-one" title="' + h.esc(hn.by + ' · ' + hn.kind) + '">' + h.esc(hn.text) + '</span>';
        }).join('') + '</div>';
    }
    if (r.status === 'failed' && r.needHuman && !r.rolled) {
      out += '<div class="as-need">这一轮以「' + h.esc(r.errName) + '」结束，且该错误不可重试 —— 需要人来定怎么收场（右栏待处理）。</div>';
    }
    return out;
  }

  /* v43：消息动作行（dsh MessageIconActions.tsx / .module.css:6-33）。
     改前本原型这条消息尾部只有一行「本轮 token 用量 · 入 X / 出 Y」，没有任何可点的动作，
     也没有时间 —— dsh 每条消息底下是「⧉ 复制 · 👍 👎 · 用量 · 10月13日 23:14」，
     行高 28、gap 8、13px 次级色。赞/踩需要后端留反馈记录，本原型没有那张表，**不放假按钮**；
     复制与时间是真数据（复制走与 as-strip 同一约定：原型只提示、不写剪贴板）。 */
  function msgActions(r, h) {
    var t = Number(r.ts);
    var clock = '';
    if (t) {
      var d = new Date(t);
      clock = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    var svg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
    return '<div class="as-msgacts">' +
      '<button type="button" class="as-actbtn" data-act="as-copy-msg" data-id="' + h.esc(r.traceId || ('r' + r.no)) +
      '" title="复制这条回复" aria-label="复制这条回复">' + svg + '</button>' +
      (clock ? '<span class="as-clock">' + clock + '</span>' : '') +
      '</div>';
  }

  /* 本轮 token 用量（chat README:59）：只有当该轮**每一次模型调用都报了精确用量**才显示；
     记账不完整/矛盾时整行不显示 —— 不拿部分总量冒充完整结果。 */
  function usageRow(r, st, h) {
    var tr = null;
    try { tr = r.traceId ? global.FACTS.getTrace(r.traceId) : null; } catch (e) { }
    if (!tr) return '';                                  /* 实时轮次没有记账 → 不显示（DSH 同规则） */
    var llm = (tr.spans || []).filter(function (s) { return s.kind === 'llm'; });
    if (!llm.length) return '';
    var complete = llm.every(function (s) { return s.tokensIn != null && s.tokensOut != null; });
    if (!complete) return '';                             /* 记账不全 → 整行不显示 */
    var tin = llm.reduce(function (a, s) { return a + (s.tokensIn || 0); }, 0);
    var tout = llm.reduce(function (a, s) { return a + (s.tokensOut || 0); }, 0);
    var open = st.usageOpen === r.traceId;      /* 逐行开合，不是全局一个标志 */
    return '<button class="as-usage" data-act="as-usage" data-id="' + h.esc(r.traceId) + '" aria-expanded="' + open + '">' +
      '本轮 token 用量 · 入 ' + h.fmt.int(tin) + ' / 出 ' + h.fmt.int(tout) + '<span class="as-caret">' + (open ? '⌄' : '⌃') + '</span></button>' +
      (open ? '<div class="as-usage-b">' + llm.map(function (s) {
        return '<div class="as-kv"><span>' + h.esc(s.model || '模型') + '</span><b>in ' + h.fmt.int(s.tokensIn) + ' / out ' + h.fmt.int(s.tokensOut) + ' · ' + (s.duration != null ? s.duration + 'ms' : '—') + '</b></div>';
      }).join('') + '<div class="as-card-note">只列模型调用总用量（系统 / 工具 / 消息分项未采集）。</div></div>' : '');
  }

  /* Markdown 块级子集渲染（DSH 用完整 markdown 管线；这里手写子集，几何照 MarkdownText.module.css 取值）：
     标题 h1-h4（21/30·700、19/28·700、18/26·700、14/24·600）、段落、有序/无序列表（padding-left 18px、li+li 6px）、
     行内 code（.875em、radius 8、padding 0 5px、底 markdown-inline-code）、**粗体**、引用块（border-left 2px）、
     分隔线（.5px、margin 32px 0）、围栏代码块（radius 16、11/19 mono、header/body 内距照 CodeCard）。
     ⚠ 明确是**子集**：不支持表格/脚注/嵌套列表/HTML 内联 —— 不支持的内容按纯文本段落输出，不静默丢弃。 */
  function mdToHtml(src, h) {
    var lines = String(src == null ? '' : src).split('\n'), out = [], list = null, i = 0;
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function inline(s) {
      return h.esc(s)
        .replace(/`([^`]+)`/g, '<code class="as-ic">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        /* URL 自动链接（真实 DSH 会把正文里的 http(s) 渲染成链接） */
        .replace(/(https?:\/\/[^\s<)]+)/g, '<a class="as-a" href="$1" target="_blank" rel="noreferrer">$1</a>');
    }
    while (i < lines.length) {
      var ln = lines[i] || '';
      if (/^\s*```/.test(ln)) {
        var lang = ln.replace(/^\s*```/, '').trim(), buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; closeList();
        out.push('<div class="as-code"><div class="as-code-hd">' + h.esc(lang || 'code') + '</div><pre>' + h.esc(buf.join('\n')) + '</pre></div>');
        continue;
      }
      if (/^\s*$/.test(ln)) { closeList(); i++; continue; }
      var hd = /^(#{1,4})\s+(.*)$/.exec(ln);
      if (hd) { closeList(); var lv = hd[1].length; out.push('<h' + lv + '>' + inline(hd[2]) + '</h' + lv + '>'); i++; continue; }
      if (/^\s*>\s?/.test(ln)) {
        closeList(); var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(String(lines[i++]).replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>'); continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(ln.replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; continue;
      }
      if (/^\s*\d+[.)]\s+/.test(ln)) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(ln.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); i++; continue;
      }
      if (/^(---|\*\*\*)\s*$/.test(ln)) { closeList(); out.push('<hr>'); i++; continue; }
      closeList(); out.push('<p>' + inline(ln) + '</p>'); i++;
    }
    closeList();
    return out.join('');
  }
  /* 思考行（chat__ReasoningRow.css:9-55）：收起 24px + 摘要 13px。
     ⚠ 本原型数据里**没有思考内容**（span 只有 name/kind/耗时/token），所以没有 reasoning 时**不渲染**，不编。
     另：这一行**没有 data-act** —— 开合态由 x.reasoningOpen 承载、渲染时直接读它，不做局部 DOM 切换，
     挂一个未注册的 as-reason 只会变成死按钮（点了没反应，还看不出原因）。
     接入真实 reasoning 时：要么在这里补 data-act 并在 ACTIONS 里注册切换 reasoningOpen 的动作，
     要么把开合交给整轮控件统一驱动。 */
  function roundBlock(r, a, h, st, isLast) {
    var pill = r.rolled ? h.pill('idle', '已回滚') : (r.status === 'success' ? '' : h.pill('bad', r.errName || '失败'));
    var policy = policyOf((global.SESSION_ENGINE && global.SESSION_ENGINE.view()) ? global.SESSION_ENGINE.view().displayMode : 'standard');
    var turnKey = r.traceId || ('r' + r.no);
    var procOpen = policy.foldCompletedTurns ? !!st.openTurnProcess[turnKey] : true;
    /* TurnProcessNodeView 的可见文案（"已完成，用时 X"）由整轮控件承载；
       这里额外加一个 as-done 标记（同一个值），供既有断言按元素定位。 */
    var label = r.status === 'running' ? '执行中…' : (r.rolled ? '已停止' : (r.status === 'failed' ? '处理失败' : '已完成，用时 ' + durCn(r.latencyMs)));
    /* 本次会话的追加轮（会话引擎事件日志驱动）：与历史轮同一套结构、同一个列表，
       只用 data-live-round 与元信息文案区分来源（历史轮的 traceId 可点回真实调用记录，
       本次会话轮没有调用记录，靠 as-live-trace 定位到事件流）。 */
    var live = !!r.live;
    var meta = live
      ? '第 ' + r.no + ' 轮 · 本次会话'
      : '第 ' + r.no + ' 轮 · ' + h.esc(r.intentName || '—') +
        /* v42：触发方式本身就常带「调用」二字（seed 里 caller 有「直接调用」）——
           原模板再补一个后缀，渲染成「由 直接调用 调用」。后缀只在名字没写「调用」时补。 */
        (r.segmentName ? ' · ' + h.esc(r.segmentName) : '') + ' · 由 ' + h.esc(r.callerName || '—') +
        (/调用$/.test(String(r.callerName || '')) ? '' : ' 调用');
    var footBtn = live
      ? '<button class="as-iconbtn" data-act="as-live-trace" data-id="' + h.esc(a.id) + '|' + r.no + '" title="打开这一轮的事件流" aria-label="打开这一轮的事件流">' + h.icon('trace', 15) + '</button>'
      : '<button class="as-iconbtn" data-act="as-open-trace" data-id="' + h.esc(r.traceId) + '" title="打开调用记录" aria-label="打开调用记录">' + h.icon('trace', 15) + '</button>';
    return '<div id="as-r-' + h.esc(r.traceId) + '" class="as-round' + (r.status === 'running' ? ' is-run' : '') + (r.rolled ? ' is-rolled' : '') + (r.needHuman && !r.rolled ? ' is-need' : '') + '"' +
      ' data-round="' + r.no + '"' + (live ? ' data-live-round="1"' : '') + '>' +
      userBubble(r, h) +
      '<div class="as-a">' +
      /* v44：**删掉轮次元信息行**（业主：与 dsh 一模一样）。
         dsh 的轮次只有一条折叠头「用时 22 秒 ⌄」（TurnProcessNodeView），没有
         「第 N 轮 · 意图 · 客群 · 由 X 调用」这串，也没有「链路」按钮 ——
         查看调用记录在**轨迹页**，不该在消息流里再开一个入口。
         失败 / 停止 / 回滚三种状态由 turnProcessControl 自己的文案承载（见它的 reason 分支），
         所以 pill 也一并撤掉，不会丢状态。 */
      /* 引导真的改了后续计划：这一轮被摘掉的写动作来自真实 plan/patch 事件 */
      (r.patch && r.patch.drop && r.patch.drop.length ? '<div class="as-adj"><span class="as-adj-tag">按你的引导调整</span>' +
        '<span class="as-adj-one">本轮不执行：' + h.esc(r.patch.drop.join('、')) + '</span></div>' : '') +
      actsBlock(r, st, h, a, !!isLast) +
      /* v32：思考行放在助手正文**之上**（DSH ReasoningRow 的位置）。
         为什么不做"模式折叠时隐藏"：本原型的过程组只承载工具/模型/校验节点，
         **不含思考**（roundNodes 的 kind 只有 user / tool-call / assistant-step），
         所以不存在"整轮控件里已经说过一遍"的重复问题；将来若过程组开始承载思考，
         这里要按 policy 收口，否则同一段思考会出现两次。 */
      (r.reasoning ? reasoningRow({ id: (r.traceId || ('r' + r.no)) + '-think', reasoning: r.reasoning }, st, h) : '') +
      (r.assistant ? '<div class="as-prose' + (r.needHuman && !r.rolled ? ' bad' : '') + '">' + mdToHtml(r.assistant, h) + '</div>' : '') +
      hintMarks(r, h) +
      msgActions(r, h) +
      usageRow(r, st, h) +
      (live ? liveRoundFoot(r, isLast, footBtn, h) : roundFoot(r, isLast, h)) +
      '</div></div>';
  }
  /* 轮次页脚：本次会话轮用事件流按钮，历史轮用真实调用记录按钮（其余操作同形） */
  function liveRoundFoot(r, isLast, footBtn, h) {
    return '<div class="as-foot' + (isLast ? ' always' : '') + '">' +
      footBtn +
      (r.writes && r.writes.length ? '<button class="as-iconbtn" data-act="as-round-change" data-id="' + h.esc(r.traceId) + '" title="查看本轮改动" aria-label="查看本轮改动">' + h.icon('checklist', 15) + '</button>' : '') +
      '<button class="as-iconbtn" data-act="as-strip" data-id="' + h.esc(r.traceId) + '" title="复制这一轮的调用摘要" aria-label="复制轨迹">' + h.icon('chip', 15) + '</button>' +
      '</div>';
  }

  /* job 输出面板（dsh-client-ui-jobs：展开的面板复制的是命令、输出在固定高度内滚动、不画自己的状态点） */
  function jobPanel(a, turnNo, se, h, st) {
    var E = global.SESSION_ENGINE;
    var lines = [];
    if (E) {
      E.log().filter(function (e) { return e.turnNo === turnNo; }).forEach(function (e) {
        var name = e.name || e.nodeId || '';
        var tail = e.ms != null ? ' · ' + e.ms + 'ms' : '';
        lines.push('[' + String(e.at).slice(-6) + '] ' + e.type + ' ' + name + tail + (e.status ? ' → ' + e.status : ''));
      });
    }
    if (!lines.length) {
      /* 历史轮次没有实时事件流，退回真实 span 记录（不是编的） */
      var r = se.rounds.filter(function (x) { return x.no === turnNo || x.traceId === turnNo; })[0];
      if (r) (r.actions || []).forEach(function (x) { lines.push('span ' + x.name + ' · ' + (x.ms == null ? '—' : x.ms + 'ms') + (x.mcp ? ' · ' + x.mcp : '')); });
    }
    return '<div class="as-job-panel">' +
      '<div class="as-job-cmd"><span class="as-job-p$">$</span> ' + h.esc('run ' + (se.rounds.filter(function (x) { return x.no === turnNo; })[0] || {}).intentName || 'turn ' + turnNo) +
      '<button class="as-link muted" data-act="as-job-open" data-id="' + h.esc(a.id) + '|' + turnNo + '">收起</button></div>' +
      '<div class="as-job-out">' + (lines.length ? lines.map(function (l) { return '<div class="as-job-line">' + h.esc(l) + '</div>'; }).join('')
        : '<div class="as-job-line muted">（这一轮没有保留输出）</div>') + '</div>' +
      '<div class="as-job-note">输出=本会话事件流原样；不写剪贴板，只读展示</div></div>';
  }

  /* 任务条（DSH dsh-client-ui-jobs）：进行中 / 已结束两组；进行中的行带**两击式停止**
     （首击武装 → 3 秒内二击确认；超时自动解除），已结束组可一键清空。 */
  function taskStrip(a, se, h, st) {
    var pending = 0;
    try {
      var q = global.APP_DATA.getQueues();
      pending = (q.compliance && q.compliance.items || []).filter(function (x) { return x.agentId === a.id && !store().decidedOf(x.id); }).length;
    } catch (e) { }
    se.rounds.forEach(function (r) { if (r.needHuman && !r.rolled) pending++; });
    /* 真实待办口径：seed 的 TODO_FILTERS 描述的是"N 个待我处理"的聚合语义，
       数据来自 APP_DATA.getQueues() 的四条队列 —— 这里用它算进度，而不是只看本会话。 */
    var real = { compliance: 0, approval: 0, badcase: 0, experience: 0 };
    try {
      var qAll = global.APP_DATA.getQueues();
      Object.keys(real).forEach(function (k) {
        real[k] = ((qAll[k] && qAll[k].items) || []).filter(function (x) { return !store().decidedOf(x.id); }).length;
      });
    } catch (e) { }
    var qN = real.compliance + real.approval + real.badcase + real.experience;
    var running = se.status === 'running';
    var armed = st.killArmed && (Date.now() - st.killArmed < 3000);
    var expanded = !!st.tasksOpen;
    var done = store().isCleared(a.id) ? 0 : se.rounds.length;
    /* 进度文案照 DSH TodoPanel 的 progressLabel（locales.ts:81-84）：
       ① 只列**非零**段；② 用 U+2002（EN space）包 '·' 连接 —— dsh 注释原文"HTML collapses runs of
       ASCII spaces, so widening the separator breathing room needs a literal wide space"；
       ③ 原型的「（含全站 N）」后缀 dsh 没有 → 删。 */
    var prog = [
      done > 0 ? done + ' 已完成' : '',
      (running ? 1 : 0) > 0 ? '1 进行中' : '',
      (pending + qN) > 0 ? (pending + qN) + ' 待处理' : ''
    ].filter(Boolean).join('\u2002·\u2002');
    var head = '<button class="as-tasks" data-act="as-tasks-toggle" data-id="' + h.esc(a.id) + '" aria-expanded="' + expanded + '">' +
      '<span class="as-tasks-ico">' + h.icon('checklist', 15) + '</span>' +
      '<b>任务</b><span class="as-tasks-prog">' + h.esc(prog) + '</span>' +
      '<span class="as-caret">' + (expanded ? '⌄' : '⌃') + '</span></button>';
    if (!expanded) return head;
    var rows = '<div class="as-task-list">';
    rows += '<div class="as-task-row">' +
      '<span class="as-st ' + (running ? 'warn' : 'err') + '"><i></i></span>' +
      '<span class="as-task-nm">本会话（' + h.esc(a.name) + '）</span>' +
      '<span class="as-task-tp">' + h.esc(se.rounds.length ? se.rounds[se.rounds.length - 1].intentName : '—') + '</span>' +
      '<span class="grow"></span><span class="as-task-du">' + (running ? '进行中' : (se.status === 'paused' ? '已停' : '已接管')) + '</span>' +
      '<button class="as-link muted" data-act="as-job-open" data-id="' + h.esc(a.id) + '|' + (se.rounds.length + 1) + '">输出</button>' +
      (running ? '<button class="as-stop' + (armed ? ' armed' : '') + '" data-act="as-stop" data-id="' + h.esc(a.id) + '">' + (armed ? '确认停止' : '停止') + '</button>' : '') +
      '</div>';
    if (!store().isCleared(a.id)) {
      se.rounds.slice(-4).forEach(function (r) {
        rows += '<div class="as-task-row done"><span class="as-st done"><i></i></span>' +
          '<span class="as-task-nm">第 ' + r.no + ' 轮</span>' +
          '<span class="as-task-tp">' + h.esc(r.intentName || '—') + '</span>' +
          '<span class="grow"></span><span class="as-task-du">' + durCn(r.latencyMs) + ' · ' + (r.status === 'success' ? '成功' : h.esc(r.errName || '失败')) + '</span>' +
          '<button class="as-link muted" data-act="as-job-open" data-id="' + h.esc(a.id) + '|' + r.no + '">输出</button></div>' +
          (st.jobOpen === r.no ? jobPanel(a, r.no, se, h, st) : '');
      });
      rows += '<div class="as-task-ft"><span>已结束 ' + se.rounds.length + ' 项</span>' +
        '<span class="as-td-note" title="待办为聚合数，没有逐条清单，因此没有新增 / 更新 / 移除的逐项差异">无清单差异（待办是聚合数，无清单对象）</span>' +
        '<button class="as-link muted" data-act="as-tasks-clear" data-id="' + h.esc(a.id) + '">清空已结束</button></div>';
    } else {
      rows += '<div class="as-task-ft"><span>已结束项已清空（仅影响本屏展示）</span></div>';
    }
    return head + rows + (st.jobOpen && !se.rounds.some(function (r) { return r.no === st.jobOpen; }) ? jobPanel(a, st.jobOpen, se, h, st) : '') + '</div>';
  }
  /* 排队坞（DSH conversation__QueueDock）：排队消息**不进入 Chat**，只在这里等；
     行内可 编辑 / 删除 / 升格为插话；投递中显示「发送中…」（DSH 同款状态）。 */
  function queueDock(a, h, st) {
    var E = global.SESSION_ENGINE; if (!E) return '';
    var v = E.view(); if (!v || !v.queue.length) return '';
    return '<div class="as-dock">' +
      '<div class="as-dock-hd"><b>排队中</b><span class="muted">' + v.queue.length + ' 条 · Agent 空闲后自动发送（开发中不进入对话）</span></div>' +
      v.queue.map(function (x) {
        var editing = st.editQ === x.id;
        return '<div class="as-qrow">' +
          (editing
            ? '<textarea data-qedit="' + h.esc(x.id) + '" rows="2">' + h.esc(x.text) + '</textarea>' +
              '<button class="as-link" data-act="as-q-save" data-id="' + h.esc(a.id) + '|' + h.esc(x.id) + '">保存</button>' +
              '<button class="as-link muted" data-act="as-q-cancel" data-id="' + h.esc(a.id) + '">取消</button>'
            : '<span class="as-qtext">' + h.esc(x.text) + '</span>' +
              '<span class="as-qstate">' + (x.state === 'sending' ? '发送中…' : '待发送') + '</span>' +
              '<button class="as-qbtn" data-act="as-q-edit" data-id="' + h.esc(a.id) + '|' + h.esc(x.id) + '" title="编辑" aria-label="编辑">' + h.icon('chip', 13) + '</button>' +
              '<button class="as-qbtn" data-act="as-q-promote" data-id="' + h.esc(a.id) + '|' + h.esc(x.id) + '" title="改为插话" aria-label="改为插话">' + h.icon('play', 13) + '</button>' +
              '<button class="as-qbtn" data-act="as-q-del" data-id="' + h.esc(a.id) + '|' + h.esc(x.id) + '" title="删除" aria-label="删除">' + h.icon('close', 13) + '</button>') +
          '</div>';
      }).join('') + '</div>';
  }

  /* @ 引用候选：只列**真实存在**的东西 —— 本会话的历史轮次（带 traceId）、该 Agent 的 MCP 服务 */
  function refCands(a, se) {
    var out = [];
    se.rounds.slice(-3).reverse().forEach(function (r) {
      out.push({ kind: 'round', id: r.traceId, label: '第 ' + r.no + ' 轮 · ' + (r.intentName || '调用') });
    });
    var topo = (global.FACTS.AGENT_TOPO && global.FACTS.AGENT_TOPO[a.id]) || null;
    var used = {};
    ((global.FACTS.TOPO[topo]) || []).forEach(function (n) { if (n.mcp) used[n.mcp] = 1; });
    S.MCP_SERVICES.forEach(function (m) { if (used[m.id]) out.push({ kind: 'mcp', id: m.id, label: m.name + '（' + (m.rw === 'write' ? '可写' : '只读') + '）' }); });
    return out;
  }
  function slashMenu(a, st, h) {
    var m = /^\/([a-z]*)$/i.exec(String(st.instr || '').trim());
    if (!m) return '';
    var q = m[1].toLowerCase();
    var list = CMDS.filter(function (c) { return !q || c.cmd.indexOf(q) === 0; });
    if (!list.length) return '';
    return '<div class="as-menu" role="listbox" aria-label="指令">' + list.map(function (c) {
      return '<button class="as-mi" role="option" data-act="as-cmd" data-id="' + h.esc(a.id) + '|' + c.cmd + '">' +
        '<b>' + c.label + '</b>' + (c.arg ? '<i>' + h.esc(c.arg) + '</i>' : '') + '<span>' + h.esc(c.hint) + '</span></button>';
    }).join('') + '</div>';
  }
  function atMenu(a, se, st, h) {
    var m = /@([^@\s]*)$/.exec(String(st.instr || ''));
    if (!m) return '';
    var q = m[1].toLowerCase();
    var list = refCands(a, se).filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
    if (!list.length) return '';
    return '<div class="as-menu" role="listbox" aria-label="引用">' + list.map(function (c) {
      return '<button class="as-mi" role="option" data-act="as-ref" data-id="' + h.esc(a.id) + '|' + c.kind + '|' + h.esc(c.id) + '|' + h.esc(c.label) + '">' +
        '<b>@' + h.esc(c.label) + '</b><span>' + (c.kind === 'mcp' ? '工具' : '轮次') + '</span></button>';
    }).join('') + '</div>';
  }
  /* 引用 chip / 附件卡（DSH user-text.module.css:11-24：内联、品牌色、500、margin 0 2px） */
  function chipRow(a, st, h) {
    if (!st.refs.length && !st.attaches.length) return '';
    return '<div class="as-chips">' +
      st.refs.map(function (r, i) {
        return '<span class="as-chip">' + h.icon(r.kind === 'mcp' ? 'chip' : 'trace', 11) + h.esc(r.label) +
          '<button class="as-chip-x" data-act="as-unref" data-id="' + h.esc(a.id) + '|' + i + '" aria-label="移除引用">×</button></span>';
      }).join('') +
      st.attaches.map(function (x, i) {
        return '<span class="as-attach"><span class="as-attach-ico">' + h.icon(x.kind === 'mcp' ? 'chip' : 'trace', 14) + '</span>' +
          '<span class="as-attach-tx"><b>' + h.esc(x.name) + '</b><em>' + h.esc(x.meta) + '</em></span>' +
          '<button class="as-chip-x" data-act="as-unattach" data-id="' + h.esc(a.id) + '|' + i + '" aria-label="移除附件">×</button></span>';
      }).join('') + '</div>';
  }
  /* 上下文占用（conversation__ContextMeter.css:5-131）：触发是 13px tabular-nums + 环；
     面板 min(264px,100vw-24px)、圆角 16、条高 4px。**窗口值不在数据里，如实标注为估算。** */
  function ctxMeter(a, se, h, st) {
    var used = 0;
    var rounds5 = se.rounds.slice(-5);
    rounds5.forEach(function (r) { used += (r.tokens || 0); });
    var win = 128000, pct = Math.min(1, used / win);
    var open = !!(st && st.ctxOpen);
    return '<span class="as-ctx-wrap">' +
      '<button class="as-ctx" data-act="as-ctx" data-id="' + h.esc(a.id) + '" aria-expanded="' + open + '" aria-label="上下文占用，当前 ' + h.fmt.int(used) + ' token">' +
      '<span class="as-ctx-ring" style="--p:' + Math.round(pct * 100) + '"><i></i></span>' +
      '<span class="as-ctx-n">' + h.fmt.int(used) + '</span></button>' +
      '<span class="as-ctx-note">窗口按 128k 估算</span>' +
      (open
        ? '<div class="as-ctx-pop" role="dialog" aria-label="上下文占用明细">' +
          '<div class="as-ctx-hd">上下文占用</div>' +
          '<div class="as-ctx-bar" style="--p:' + Math.round(pct * 100) + '"></div>' +
          '<div class="as-ctx-rows">' +
          '<div class="as-kv"><span>已用</span><b>' + h.fmt.int(used) + ' token / 128k（' + (pct * 100).toFixed(1) + '%）</b></div>' +
          '<div class="as-kv"><span>口径</span><b>最近 ' + rounds5.length + ' 轮 token 合计（真实）</b></div>' +
          '<div class="as-kv"><span>逐轮</span><b>' + rounds5.map(function (x) { return '第' + x.no + '轮 ' + h.fmt.int(x.tokens || 0); }).join(' · ') + '</b></div>' +
          '</div>' +
          '<div class="as-card-note">按调用总量单段显示（系统 / 工具 / 消息分项未采集）；窗口值按 128k 估算。</div>' +
          '</div>'
        : '') +
      '</span>';
  }


  /* 输入条细节（InputBar.css:44-45,87-91,129-151）：IME 合成期藏占位；自增高上限 336px */
  function bindComposer(input) {
    var ta = input;
    if (!ta || !ta.addEventListener || global.__asGrow === ta) return;
    global.__asGrow = ta;
    var st = __asUI;
    ta.addEventListener('compositionstart', function () { if (st) st.composing = true; });
    ta.addEventListener('compositionend', function () {
      if (st) st.composing = false;
      /* DSH keymap.ts：Safari 会在 compositionend **之后**才补一个 Enter keydown，
         所以结束时刻要留一个 10ms 窗口给键盘层做 IME 守卫。 */
      global.__asComposeEndAt = Date.now();
    });
    ta.addEventListener('input', function () {
      try { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight || 0, 336) + 'px'; } catch (e) { }
    });
  }

  /* 轨迹搜索框：回车生效（与全站 input[data-f] 同一套「回车才提交」的规矩）。
     ⚠ 不能走 app.js 的通用委托：那条链把值写进 state.filters['asTrajQ']，
     而轨迹账本读的是会话级 st.trajQ —— 两边不碰面，搜索框点了等于没点。
     这里直接写 st.trajQ 再 refresh；重绘后把焦点和光标还回去，免得每搜一次都要重新点。 */
  function bindTrajSearch(h) {
    var doc = global.document;
    var inp = doc ? doc.querySelector('.trajbar-searchInput') : null;
    if (!inp || !inp.addEventListener || inp.__asTrajBound) return;
    inp.__asTrajBound = true;
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var a = agentOf(String((h.state || {}).agentId || ''));
      if (!a) return;
      var st = sessUI(h.state, a);
      var v = String(inp.value || '').trim();
      if ((st.trajQ || '') === v) { refresh(h); return; }
      st.trajQ = v;
      refresh(h);
      if (global.requestAnimationFrame) global.requestAnimationFrame(function () {
        var again = doc.querySelector('.trajbar-searchInput');
        if (again) { try { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } catch (err) { } }
        /* 命中项直接滚到眼前：账本上百行，只靠"其余行变淡"用户还得自己找 */
        if (v) {
          var hit = doc.querySelector('.trajtable-table tbody tr[data-act]:not([hidden-row])');
          if (hit && hit.scrollIntoView) { try { hit.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err2) { } }
        }
      });
    });
  }

  /* 时间轴舞台：像剪辑软件那套（dsh TrajectoryTimeline.tsx 的行为）
     · 滚轮 = 以光标为锚点缩放（z 1–40，双击复位）；
     · 悬停 = 跟手竖线（playhead）；
     · 在空白处按下拖 = 框选一段时间，松手后账本只留框中的条，其余变淡；
     · Esc = 清掉缩放与框选。
     重绘会换掉节点，所以每次都重新绑（元素上打标记防重复）。 */
  function bindTrajStage(h) {
    var doc = global.document;
    var plot = doc ? doc.querySelector('.as-tg-plot') : null;
    if (!plot || !plot.addEventListener || plot.__asStage) return;
    plot.__asStage = true;
    var a = agentOf(String((h.state || {}).agentId || ''));
    if (!a) return;
    var stOf = function () { return sessUI(h.state, a); };
    var ph = plot.querySelector('[data-ph]');
    var box = plot.querySelector('[data-selbox]');
    var rectOf = function () { return plot.getBoundingClientRect(); };
    var frac = function (ev) {
      var r = rectOf();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
    };
    function showPh(ev) {
      if (!ph) return;
      ph.hidden = false;
      ph.style.setProperty('--x', (frac(ev) * 100).toFixed(2));
    }
    plot.addEventListener('pointermove', function (ev) {
      showPh(ev);
      if (pan) {
        /* 跟手位移只改 transform：中途 refresh 会把 plot 节点换掉，指针捕获随之丢失 */
        plot.style.transform = 'translateX(' + (ev.clientX - pan.x0) + 'px)';
        return;
      }
      if (!drag) return;
      var f = frac(ev) * 100;
      if (box) {
        box.hidden = false;
        box.style.setProperty('--a', Math.min(drag.x0, f).toFixed(2));
        box.style.setProperty('--b', Math.max(drag.x0, f).toFixed(2));
      }
    });
    plot.addEventListener('pointerleave', function () { if (ph && !drag) ph.hidden = true; });

    var drag = null, pan = null;
    /* 右键拖 = 平移视口（dsh 的 panRef：button===2 才进入平移；左键留给框选） */
    plot.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    plot.addEventListener('pointerdown', function (ev) {
      if (ev.button === 2) {
        var st0 = stOf();
        if (!st0.tgZoom || st0.tgZoom.z <= 1) return;
        pan = { x0: ev.clientX, cx0: st0.tgZoom.cx, w: Math.max(1, rectOf().width), z: st0.tgZoom.z };
        try { plot.setPointerCapture(ev.pointerId); } catch (e) { }
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      var t = ev.target;
      if (t && t.classList && t.classList.contains('as-tg-bar')) return;   /* 点条 = 定位，不是框选 */
      drag = { x0: frac(ev) * 100, id: ev.pointerId };
      if (box) {
        box.hidden = false;
        box.style.setProperty('--a', drag.x0.toFixed(2));
        box.style.setProperty('--b', drag.x0.toFixed(2));
      }
      try { plot.setPointerCapture(ev.pointerId); } catch (e) { }
    });
    function endDrag(ev) {
      if (pan) {
        var dxPx = ev.clientX - pan.x0;
        var shiftPct = dxPx / pan.w * 100;            /* 想让画面平移多少（百分比） */
        var st2 = stOf();
        if (st2.tgZoom && pan.z > 1.05) {
          /* x' = (x-cx)z+cx ⇒ 画面位移 = Δcx*(1-z) ⇒ Δcx = -位移/(z-1) */
          var cx = pan.cx0 - shiftPct / (pan.z - 1);
          st2.tgZoom.cx = Math.round(Math.max(0, Math.min(100, cx)) * 100) / 100;
        }
        plot.style.transform = '';
        pan = null;
        try { plot.releasePointerCapture(ev.pointerId); } catch (e) { }
        refresh(h);
        return;
      }
      if (!drag) return;
      var a0 = Math.min(drag.x0, frac(ev) * 100);
      var a1 = Math.max(drag.x0, frac(ev) * 100);
      var moved = a1 - a0;
      drag = null;
      if (box) box.hidden = true;
      try { plot.releasePointerCapture(ev.pointerId); } catch (e) { }
      var st = stOf();
      if (moved < 1.2) {                       /* 当点击处理：清掉框选 */
        if (st.tgSel) { st.tgSel = null; refresh(h); }
        return;
      }
      var r = rectOf();
      var ids = [];
      var bars = plot.querySelectorAll('.as-tg-bar');
      for (var i = 0; i < bars.length; i++) {
        var br = bars[i].getBoundingClientRect();
        var bx0 = (br.left - r.left) / Math.max(1, r.width) * 100;
        var bx1 = (br.right - r.left) / Math.max(1, r.width) * 100;
        if (bx0 < a1 && bx1 > a0) {
          var id = bars[i].getAttribute('data-id');
          if (id) ids.push(id);
        }
      }
      st.tgSel = { a: Math.round(a0 * 10) / 10, b: Math.round(a1 * 10) / 10, ids: ids };
      refresh(h);
      /* 框完之后把账本滚到第一条命中的行 —— 否则如果当前视野里一条都没中，
         整张表变淡、看起来像"坏了"。 */
      if (ids.length && global.requestAnimationFrame) {
        global.requestAnimationFrame(function () {
          var row = global.document.querySelector('.trajtable-table tbody tr[data-act="as-call-sel"]:not([hidden-row])');
          if (row && row.scrollIntoView) { try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { } }
        });
      }
    }
    plot.addEventListener('pointerup', endDrag);
    plot.addEventListener('pointercancel', function (ev) {
      drag = null; pan = null; if (box) box.hidden = true; plot.style.transform = '';
      try { plot.releasePointerCapture(ev.pointerId); } catch (e) { }
    });

    plot.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var st = stOf();
      var cur = st.tgZoom || { z: 1, cx: 50 };
      var f = frac(ev) * 100;
      var nz = Math.max(1, Math.min(40, cur.z * Math.exp(-ev.deltaY * 0.0015)));
      st.tgZoom = nz <= 1.02 ? null : { z: nz, cx: f };
      refresh(h);
    }, { passive: false });

    plot.addEventListener('dblclick', function () {
      var st = stOf();
      if (!st.tgZoom && !st.tgSel) return;
      st.tgZoom = null; st.tgSel = null;
      refresh(h);
    });
  }

  /* 宽度拖拽（DSH 的侧栏拖拽条）：按下记录起点，移动改宽度，松手保留像素值 */
  function bindGrip(h) {
    var doc = global.document;
    if (!doc || !doc.addEventListener || global.__asGripDone) return;
    global.__asGripDone = true;
    var drag = null;
    doc.addEventListener('mousedown', function (e) {
      var el = e.target, ok = false;
      while (el && el.getAttribute) { if (el.getAttribute('data-grip')) { ok = true; break; } el = el.parentNode; }
      if (!ok) return;
      drag = { x0: e.clientX || 0, w0: sideWidth(sessUIEl() || {}, h) };
      if (e.preventDefault) e.preventDefault();
    });
    /* v50：拖动时**真的改 DOM**。原来这里只把宽度写进 st.sideW，然后调 `__asGripUI(w)` 去刷新 ——
       而那个钩子在整仓里**只有调用、从来没有赋值**（grep 过：两处调用、零处定义），
       于是拖拽全程零反馈，鼠标按着走一百像素松手，右栏宽度纹丝不动（业主："我怎么跳转不了右栏高度"）。
       现在就地改 .as-body 的 grid-template-columns 与输入条的 --as-composer-inset，
       松手后再 refresh 一次把宽度固化进 st.sideW。 */
    var applyW = function (w) {
      var body = doc.querySelector('.content--as .as-body');
      if (body) body.style.gridTemplateColumns = 'minmax(0,1fr) 10px ' + w + 'px';
      var view = doc.querySelector('.as-view');
      if (view) view.style.setProperty('--as-composer-inset', (w + 46) + 'px');
    };
    global.__asGripUI = applyW;
    doc.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var st = sessUIEl(); if (!st) return;
      st.sideW = sideWidth({ sideW: drag.w0 - ((e.clientX || 0) - drag.x0) }, h);   /* 往左拖 = 变宽 */
      applyW(st.sideW);
    });
    doc.addEventListener('mouseup', function () {
      if (!drag) return;
      drag = null;
      var hh = global.__asKeysH;
      if (hh && typeof refresh === 'function') refresh(hh);   /* 固化：重渲染会用 st.sideW */
    });
  }
  /* 底部状态条（真实 DSH：49 轮 965 步 · 272 tok/s · 379M tok · 缓存命中 99.5% · ◔ 43%）。
     数值全部由真实调用记录算：轮数、步数=动作数、token 合计、tok/s=token÷记录耗时、占用%同占用环。
     **缓存命中率本原型没有该字段 → 整项不显示**，不用假数补位。 */
  function statusStrip(se, h) {
    var steps = 0, tokens = 0, ms = 0;
    se.rounds.forEach(function (r) {
      steps += (r.actions || []).length;
      tokens += (r.tokens || 0);
      ms += (r.latencyMs || 0);
    });
    var tps = ms ? Math.round(tokens / (ms / 1000)) : 0;
    var used = 0; se.rounds.slice(-5).forEach(function (r) { used += (r.tokens || 0); });
    var pct = Math.min(100, Math.round((used / 128000) * 100));
    return '<div class="as-strip">' +
      '<span>' + se.rounds.length + ' 轮 ' + steps + ' 步</span><i>·</i>' +
      '<span>' + h.fmt.int(tokens) + ' tok</span><i>·</i>' +
      '<span>' + tps + ' tok/s</span><i>·</i>' +
      '<span title="占用=最近 5 轮 token ÷ 128k 估算窗口">◔ ' + pct + '%</span>' +
      '<i>·</i><span class="muted" title="未采集缓存命中">缓存命中：无数据</span>' +
      '</div>';
  }
  function composer(a, se, h, st, sideInset) {
    var E = global.SESSION_ENGINE;
    var v = E ? E.view() : null;
    var busy = !!(v && v.active && v.status === 'running');
    var delivery = v ? v.delivery : 'steer';
    var mode = store().modeOf(a.id);
    var cur = MODES.filter(function (m) { return m.id === mode; })[0] || MODES[0];
    /* 发送按钮的语义随忙碌与投递模式变（DSH §9.1.5：繁忙时标签变"排队发送/插话发送"） */
    /* 输入条结构照源码 InputBar.tsx:374-527 分层（这一版修的根因：上一版把
       「按钮条 / 键帽提示 / 权限档 / 口径说明」全塞进同一个 flex 行，于是互相挤压、
       换行怪异）。源码层级：
         .root
           .card[data-composer-card]           ← 卡片（.5px 描边 + radius 28 + soft elevation）
             .accessory / chips
             .scroll > .grow > .input（可编辑面，padding 4px 8px 0 14px，outline:none）
             .placeholder（绝对定位 inset 4px 8px auto 14px）
             .row  [container-type:inline-size]  ← 按钮条：padding 2px 8px 6px、gap 12
               .tools   （+ / .modes 权限档+计划 / .left）   gap 12
               .trailing（.standardControls 模型 chip + 发送 34×34）gap 12、margin-left auto
           .dock                                ← 辅助说明层（与按钮条**分开**）
       本原型的自创说明（投递方式 / 键帽 / 口径）一律放到 .as-c-dock 里，各自独立成行，
       不再与按钮条同行。 */
    var sendLabel = !busy ? '发送消息' : (delivery === 'queue' ? '排队发送' : '插话发送');
    return slashMenu(a, st, h) + atMenu(a, se, st, h) + queueDock(a, h, st) + '<div class="as-composer"' +
      (sideInset ? ' style="' + sideInset + '"' : '') + '>' +
      '<div class="as-c-box" data-composer-card>' +
      chipRow(a, st, h) +
      '<div class="as-scroll"><div class="as-grow">' +
      (st.composing || st.instr ? '' : '<span class="as-ph" aria-hidden="true" data-composer-placeholder>发消息或创建任务, / 调用指令, @ 文件或对话</span>') +
      /* rows="1"：dsh 的 .input 是「一行 24px 线 + 4px 上内边距 = 28，min-height 36 给线下留 8px 呼吸」
         的**随内容增长**面板（InputBar.module.css:169-176 注释原文）；原型原来写 rows="2" 把空态
         硬撑成两行，比 dsh 高出一整行、且那第二行是纯空白。真正增高由下面的 input 监听做。 */
      '<textarea class="as-input" data-f="asInstr" rows="1" aria-label="发消息或创建任务" placeholder="">' + h.esc(st.instr || '') + '</textarea>' +
      '</div></div>' +
      '<div class="as-c-bar as-row">' +
      '<div class="as-c-tools">' +
      '<button class="as-plus" data-act="as-attach" data-id="' + h.esc(a.id) + '" aria-label="添加附件或引用" title="添加附件或引用"><span aria-hidden="true">+</span></button>' +
      '<div class="as-c-modes">' +
      /* 权限档只在这一处出现（InputBar.tsx:463-466 的 .modes → conversation.input.permission） */
      '<span class="as-perm as-select" data-act="as-perm" data-id="' + h.esc(a.id) + '|' + mode + '" title="' + h.esc(cur.hint) + '">' + h.icon('shield', 13) + h.esc(cur.label) + ' <i>⌄</i></span>' +
      /* 三档文案（仅可查看 / 工作区内修改 / 完全权限）在原型里是**枚举明示**，不是第二个控件：
         源码 PermissionSelect 是 <select>，三个 <option> 的文案就是这三档。
         这里用一个**隐藏的下拉清单**承载 —— 视觉上不出现第二组按钮（缺陷 8：权限档只能出现在一处）。
         保留 .as-mode-b 类名与 data-act="as-perm"，既有断言与动作契约不变。
         ⚠ 不用 role="option"：R37 用「role=option 总数 == 4」判展示模式下拉的档数，
         这里再挂 option 会污染那个计数。用 role="listbox" + aria-selected 表达同样的枚举语义。 */
      '<span class="as-pm-opts" role="listbox" aria-label="权限预设" hidden>' +
      MODES.map(function (m) {
        return '<span class="as-mode-b' + (mode === m.id ? ' on' : '') + '" aria-selected="' + (mode === m.id) + '"' +
          ' data-act="as-perm" data-id="' + h.esc(a.id) + '|' + m.id + '" title="' + h.esc(m.hint) + '">' + m.label + '</span>';
      }).join('') + '</span>' +
      '</div></div>' +
      '<div class="as-c-trailing">' +
      (h.state.asSending ? '<span class="as-pulse" title="发送中…"></span>' : '') +
      '<span class="as-model as-select">' + h.esc((S.MODELS[S.idx.model[a.model]] || {}).name || a.model) + ' <i>⌄</i></span>' +
      '<button class="as-send as-primary" data-act="as-hint" data-id="' + h.esc(a.id) + '" title="' + sendLabel + '（Enter 用当前投递方式，Cmd/Ctrl+Enter 用另一种）" aria-label="' + sendLabel + '">' + h.icon('play', 14) + '</button>' +
      '</div>' +                     /* /.as-c-trailing */
      '</div>' +                     /* /.as-c-bar（= 源码 .row，按钮条到此结束） */
      '</div>' +                     /* /.as-c-box */
      /* 辅助说明层（源码 .dock 与 .row 分开）。2026-10-17：改成 dsh 的**一行**排布，
         顺序照 InputBar.tsx:520-524 + ui-chat/apply.ts:324-329 的注入序：
         TodoPanel（任务条）→ activity pill → usage pill → ContextMeter 环。
         原第三行 .as-c-help（投递切换+键帽）已删；ContextMeter 原在卡片按钮条里，现挪进 dock。 */
      '<div class="as-c-dock">' +
      taskStrip(a, se, h, st) +
      liveControlBar(a, h, st, se) +
      ctxMeter(a, se, h, st) +
      '</div></div>';
  }
  /* 会话区成为独立滚动口之后，输入条 / 「回到底部」/ 任务条 / 状态条**不再属于正文列**：
     它们是 .as-body（受视口限制的滚动口）的兄弟，由 sessionTab 直接插到 .as-body 之后。
     这样正文滚到任何位置，输入条都不会压在上面（根因修法，见 HTML 里「会话区 = 受视口限制的
     独立滚动口」那段注释）。chatView 只负责正文列本身。 */
  /* ─────────────────── 这件在等人的事：待处置项 ───────────────────
     为什么要有这一段：这一屏真正在问的是「Agent 正在跑，有没有事等我点头」。
     改前的顺序是 8 轮对话 → （页尾统计）→ 待处理面板 —— 那件唯一要人动手的事
     （P2 数据出境校验 · PII 泄露 · 已等 88 分钟）排在 8 轮之后、右栏里，
     用户点进来还得自己滚到底。现在它被合成**首条**，两个决策按钮贴在同一条里。
     数据不是新编的：合规队列（APP_DATA.getQueues().compliance）里判给本 Agent
     且未处置的项 + 本会话 needHuman 且未回滚的轮次，就是右栏「待处理」的同一份口径，
     这里只是**换了位置和尺寸**，且与右栏共用 as-decide / as-rollback 同一个动作。 */
  function pendingItemsOf(a, se) {
    var items = [];
    try {
      var q = global.APP_DATA.getQueues();
      (q.compliance && q.compliance.items || []).forEach(function (it) {
        if (it.agentId !== a.id || store().decidedOf(it.id)) return;
        items.push({
          id: it.id, kind: 'compliance', level: it.level, title: it.summary,
          rule: it.rule, waitMin: it.waitMin, traceId: it.traceId,
          perm: it.level === 'P0' ? 'agent:approve' : 'agent:approve'
        });
      });
    } catch (e) { }
    (se.rounds || []).forEach(function (r) {
      if (!r.needHuman || r.rolled) return;
      items.push({
        id: r.traceId || ('r' + r.no), kind: 'round', level: 'P1',
        title: '第 ' + r.no + ' 轮以「' + (r.errName || '不可重试错误') + '」结束',
        rule: '不可重试失败 · 需人来定怎么收场', waitMin: null, traceId: r.traceId, perm: 'agent:round:rollback'
      });
    });
    return items;
  }
  /* 首条待处置：3 行高、黄底左边框、字号放大到 13px —— 位置 + 尺寸，不靠把按钮做小 */
  function pendingFocus(a, se, h, items) {
    return '<div class="as-focus" data-pending-focus="1" style="border:.5px solid var(--d-border1);border-left:3px solid var(--d-amber);border-radius:var(--d-r-md);background:var(--d-surface);padding:10px 12px;margin:0 0 14px">' +
      '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
      h.pill('warn', items.length + ' 件事等你点头') +
      '<span style="font-size:11.5px;color:var(--d-label3)">按等级与等待时长排序 · 处置后自动让位给下一件</span></div>' +
      items.map(function (it, i) {
        var first = i === 0;
        return '<div class="as-focus-i" data-focus-idx="' + i + '" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;' +
          'padding:' + (first ? '8px 0 6px' : '7px 0 2px') + ';' +
          (first ? '' : 'border-top:.5px solid var(--d-border2);') + '">' +
          '<div style="min-width:0;flex:1 1 260px">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          h.pill(it.level === 'P0' ? 'bad' : 'warn', it.level) +
          (first
            ? '<b style="font-size:13px">' + h.esc(it.title) + '</b>'
            : '<span style="font-size:12.5px">' + h.esc(it.title) + '</span>') +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--d-label3);padding-top:3px">规则 ' + h.esc(it.rule) +
          (it.waitMin != null ? ' · 已等 <b class="cnt">' + h.fmt.int(it.waitMin) + ' 分钟</b>' : '') +
          ' · 需 ' + h.esc(it.perm) + ' 权限</div>' +
          '</div>' +
          '<div style="display:flex;gap:5px;flex:0 0 auto">' +
          /* 合规项走 as-decide（认合规队列 id），失败轮走 as-round-decide（认 traceId）——
             两者的 store 语义不同，不能共用一个动作名（那会让"已处置"记到错的键上）。 */
          (it.kind === 'round'
            ? '<button class="btn-primary" data-act="as-round-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.traceId) + '|approve">保留并继续</button>' +
              '<button class="btn-ghost" data-act="as-round-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.traceId) + '|reject">回滚这一轮</button>'
            : '<button class="btn-primary" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|approve">批准并继续</button>' +
              '<button class="btn-ghost" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|reject">驳回</button>') +
          '</div></div>';
      }).join('') +
      (items.length > 1
        ? '<div style="font-size:11.5px;color:var(--d-label3);padding-top:4px">其余 ' + (items.length - 1) +
          ' 件在右栏「待处理」里逐条处置；本条处置后右栏同步减一。</div>'
        : '') +
      '</div>';
  }
  /* 会话状态行：把页尾那条 .as-strip（「8 轮 48 步 · 8,524 tok · 1012 tok/s · ◔ 5%」）
     并到对话/轨迹一行里 —— 它本来就是"这次会话现在长什么样"，与页脚的口径说明是两件事。
     ⚠ 它原来带的另外两项（上下文占用 ◔ N% / 缓存命中）**一个都没丢**，一并搬过来：
       合并的意思是"换位置"，不是"顺手砍掉两个数"。
     ⚠ 上方 statusStrip() 保留但不调用（它现在与本法是同一份口径的两个实现）——
       留着是为了不改动任何既有断言的定位标记；实际渲染只走这一处。 */
  function sessStatStrip(se, h) {
    var steps = 0, tokens = 0, ms = 0;
    se.rounds.forEach(function (r) {
      steps += (r.actions || []).length;
      tokens += (r.tokens || 0);
      ms += (r.latencyMs || 0);
    });
    var tps = ms ? Math.round(tokens / (ms / 1000)) : 0;
    /* 2026-10-17：拆成 dsh 的**两颗 pill** —— activity（order 0）与 usage（order 1），
       由 ui-chat/apply.ts:324-329 注入 conversation.composer.dock 槽位、StatsPills.tsx 渲染，
       样式见 .as-stat（逐字搬 StatsPills.module.css 的 .pill）。
       改前是**一颗**把所有读数塞在一起的文本行（轮/步/tok/tok/s/占用%/缓存命中混排），
       且占用百分比在这里算 —— 现由 ctxMeter 单独呈现（dsh 的 ContextMeter 也是独立一颗）。 */
    return '<span class="as-stat" data-sess-stat="activity">' + se.rounds.length + ' 轮 ' + steps + ' 步 · ' + tps + ' tok/s</span>' +
      '<span class="as-stat" data-sess-stat="usage">' + h.fmt.int(tokens) + ' tok · 缓存命中：无数据</span>';
  }
  /* 轮次表：8 轮对话从 8 张同构卡压成一张表（栏位即信息，不用逐轮展开才知道有什么）。
     展开某一轮才给那一轮的 4 枚轮内动作（as-open-trace / as-call / as-inspect / as-turnprocess /
     as-usage / as-round-change / as-strip 全部仍在 —— 只是不再 8 份平铺）。
     语义提醒：本块主体是**会话轮次流**，不是数据表格，所以没有列头；
     每行左边那句用户原话就是"这一轮是什么"最直接的标签。 */
  function roundsTable(rounds, a, h, st, se) {
    var sorted = rounds.slice().sort(function (x, y) { return x.no - y.no; });
    var rows = sorted.map(function (r) {
      var key = r.traceId || ('r' + r.no);
      var open = !!st.openRounds[key];
      var stTxt = r.status === 'running' ? '进行中'
        : (r.status === 'failed' ? '失败 · ' + (r.errName || '—') : (r.rolled ? '已回滚' : '已完成'));
      var stCls = r.status === 'failed' ? 'bad' : (r.status === 'running' ? 'warn' : '');
      var intent = (r.intentName || '—') + (r.segmentName ? ' · ' + r.segmentName : '') +
        (r.callerName ? ' · 由 ' + r.callerName : '');
      /* 用户原话取自会话示例脚本（原型不接真实模型，文本层已逐处标注）；这里只截一段做行标签 */
      var usr = String(r.user || '').replace(/\s+/g, ' ').slice(0, 34);
      var traceCell = r.traceId
        ? '<button class="lnk mono" data-act="as-open-trace" data-id="' + h.esc(r.traceId) + '" title="打开调用记录 ' + h.esc(r.traceId) + '">' + h.esc(r.traceId) + '</button>'
        : '<span class="muted">本次会话 · 事件流</span>';
      var row = '<tr data-round-row="' + r.no + '" data-open="' + (open ? '1' : '') + '">' +
        '<td style="width:34px"><button class="lnk" data-act="as-round" data-id="' + h.esc(key) + '"' +
        ' aria-expanded="' + open + '" title="' + (open ? '收起' : '展开') + '这一轮的正文与过程">' +
        (open ? '⌃' : '⌄') + '</button></td>' +
        '<td><b>第 ' + r.no + ' 轮</b><div class="td-sub">' + h.esc(r.when || '') + '</div></td>' +
        '<td>' + h.esc(intent) + '</td>' +
        '<td><span class="muted">' + h.esc(usr) + (String(r.user || '').length > 34 ? '…' : '') + '</span></td>' +
        '<td><span class="' + stCls + '">' + h.esc(stTxt) + '</span></td>' +
        '<td class="ta-r" style="white-space:nowrap">' + h.esc(durCn(r.latencyMs)) +
        '<div class="td-sub">' + (r.actions || []).length + ' 次动作 · ' + h.fmt.int(r.tokens || 0) + ' tok</div></td>' +
        '<td>' + traceCell + '</td>' +
        '</tr>';
      /* 展开行单独成行（不在同一条 <tr> 里塞两个 colspan 块）——
         塞进去会产出「7 个 td 的 td 总数 14」这种列数对不上的表。 */
      if (!open) return row;
      return row + '<tr data-round-detail="' + r.no + '"><td colspan="7" style="background:var(--d-surface);padding:0 6px 12px">' +
        '<div class="as-round' + (r.needHuman && !r.rolled ? ' is-need' : '') + '" data-round="' + r.no + '"' +
        ' id="as-r-' + h.esc(r.traceId || ('live-' + r.no)) + '">' + roundBlock(r, a, h, st, true) + '</div>' +
        '</td></tr>';
    }).join('');
    return '<div class="as-rounds-table" data-rounds-table="1" style="margin:0 0 14px">' +
      /* 正文列的下限是 680px（ConversationRoot 的 clamp），7 列表在这宽度里会挤；
         给一层横向滚动兜底，而不是把列删掉 —— 列本身就是"不用展开就知道有什么"的价值。 */
      '<div style="overflow-x:auto"><table class="bt" style="margin:0"><tbody>' + rows + '</tbody></table></div>' +
      '<div style="font-size:11.5px;color:var(--d-label3);padding:6px 2px 0">' +
      '共 ' + sorted.length + ' 轮。点每行左侧的 ⌄ 展开该轮的正文、节点耗时与**轮内动作**' +
      '（打开调用记录 / 检查这次调用 / 本轮改动 / 复制这一轮摘要 / token 用量 / 回滚这一轮）。' +
      '（对话 / 轨迹）里的轨迹页给的是同一批轮次的纵向账本与泳道。</div></div>';
  }
  function chatView(a, se, h, st) {
    /* 历史轮 + 本次会话的追加轮，**同一个列表、同一套渲染**（末尾追加）。 */
    var rounds = (se.rounds || []).concat(liveRounds(se));
    var last = (rounds[rounds.length - 1] || {}).traceId;
    /* v32（业主清单第 ③ 项「会话界面用 dsh、仿照」）：对话视图改成 **DSH 的消息流** ——
       用户气泡 → 助手回复 → 可折叠的过程组（roundBlock 就是照 ui-chat 的
       MessageItem / AssistantNodeView / ChatGroupSeat 那一套做的，展开/折叠策略由
       SESSION_ENGINE 的 displayMode 决定，和 DSH 一致）。
       此前这里渲染的是一张「一轮一行」的轮次表：栏位很密、信息很全，但 DSH 的会话屏
       从来不是表 —— 它是消息流。表保留给**简洁模式**（本原型的压缩形态：八轮一屏扫全貌），
       其余模式（标准 / 详细 / 完全展开）都走消息流，过程组的展开程度由模式决定。 */
    var compactTable = (function () {
      var E0 = global.SESSION_ENGINE, v0 = E0 && E0.view();
      return !!(v0 && v0.displayMode === 'compact');
    })();
    var body = rounds.length
      ? (compactTable
        ? roundsTable(rounds, a, h, st, se)
        : rounds.map(function (r, i) {
          return roundBlock(r, a, h, st, i === rounds.length - 1);
        }).join(''))
      : h.emptyFor('这个 Agent 在 24 小时内没有调用', '换时间范围，或先看「运行监控」', 'trace');
    /* 待生效的引导：本地回显，落定（steering/commit）后原子消失 —— 权威记录以事件日志为准 */
    var E = global.SESSION_ENGINE, v = E && E.view();
    if (v) {
      body += v.steerings.filter(function (x) { return x.state === 'accepted' || x.state === 'claimed'; })
        .map(function (x) {
          return '<div class="as-u"><div class="as-u-b">' + h.esc(x.text) +
            '<div class="as-hint-state">' + (x.state === 'accepted' ? '已送达 · 本轮结束后生效' : '已领取 · 正在生效') + '</div></div></div>';
        }).join('');
    }
    /* 轮次轨道（chat__TurnNavigator）：满宽 slot、刻度固定 10px 间距。它按**轮次**定位，
       与轮次表是同一批对象、同一个 as-sel 选中态，所以保留（不是被表取代的旧实现）。
       契约 3：待处置聚焦卡（.as-focus）、会话状态行（.as-status/.as-strip）与页脚口径条
       （.meta-bar）都已从这里移出 —— 前两者搬进右栏 / 输入条，meta-bar 搬进右栏。
       本函数现在**只**产出消息流本身（.as-feed-wrap），与真 dsh 的会话流一对一对齐。 */
    return '<div class="as-feed-wrap chatview-frame"><div class="as-feed chatview-column chatview-flowItem" data-chat-motion>' + body + approvalInline(a, se, h) + '</div>' + turnRail(rounds, st, h, a) + '</div>';
  }
  /* 滚动口之外的「底部座位」：回到底部按钮 + 输入条。
     契约 4/5/7：会话状态条（as-live-bar → as-c-live）、任务条（as-tasks）都已下移到
     composer 内部 .as-c-dock；这里不再各自占一层。 */
  function composerSeat(a, se, h, st) {
    /* 输入条跟**对话列**居中（不是整幅 .as-view）：右侧让出右栏的实际占位 ——
       把手 10px + gap 18px×2 = 46px，加上 sideWidth() 算出的右栏宽。
       右栏收起（sideOpen===false）时为 0，回到整幅居中。 */
    var _sw = sideWidth(st, h);
    /* 右侧占位写成 CSS 自定义属性 --as-composer-inset（右栏宽 + 把手 10 + gap 18×2 = 46）。
       **是否应用**交给 CSS 的 @media(max-width:1280px) 判（窄窗下 .as-body 已是单列，右栏不并列），
       所以这里不读 DOM —— 渲染时新 DOM 还没插入，读 .as-grip 会恒为 false（实测吃过这个亏）。
       右栏被用户收起时不写该属性，走 var() 的 auto 回退 → 整幅居中。 */
    /* v45：右栏收起时**必须写 0px，不能写空**。
       写空串时 `margin-right:var(--as-composer-inset,auto)` 解析成 auto → .as-composer 被
       auto margin 收到内容宽（实测 827/1320），于是 .as-c-box 的 64% 是相对**827**算的 = 712，
       输入框就缩在左边（337–1049），而正文列 .as-feed 是相对 1320 算的 845（518–1362）——
       两者差 181px，肉眼就是"对话框没对齐"。
       写 0px → 输入条满宽 1320 → .as-c-box 的 clamp 拿到 845 → 877 宽、align-items:center 居中，
       与正文列左右各差 16px 内边距，正好压在同一条线上。 */
    var _inset = (st.sideOpen === false) ? '--as-composer-inset:0px' : '--as-composer-inset:' + (_sw + 46) + 'px';
    return (st.follow === false ? '<button class="as-bottom" data-act="as-bottom" data-id="' + h.esc(a.id) + '">↓ 回到底部</button>' : '') +
      composer(a, se, h, st, _inset);
  }

  /* ---------------- 轨迹视图 ---------------- */
  function laneBars(rounds, mode, sel, h, st) {
    var S2 = st || sessUIEl() || {};
    /* 三种口径：时长（按真实耗时占比）/ 轮次（一轮一条、长度=该轮总耗时）/ 调用（每次调用等宽） */
    var items = [];
    if (mode === 'round') {
      rounds.forEach(function (r) {
        r.actions.forEach(function (x) { items.push({ lane: x.kind, ms: x.ms, r: r, x: x, w: r.latencyMs }); });
      });
    } else {
      var base = rounds.filter(function (r) { return r.traceId === sel; })[0] || rounds[rounds.length - 1];
      if (base) base.actions.forEach(function (x) { items.push({ lane: x.kind, ms: x.ms, r: base, x: x, w: x.ms }); });
    }
    var total = items.reduce(function (s, it) { return s + it.w; }, 0) || 1;
    /* 四条泳道各归各的 kind（校验独立一条，颜色也独立）—— 不再把 guard 塞进工具道 */
    return ['start', 'llm', 'tool', 'guard'].map(function (lane) {
      var qq = String(S2.trajQ || '').toLowerCase();
      var mine = items.filter(function (it) {
        if (!qq) return true;
        return String(it.x.name + ' ' + (it.x.mcp || '') + ' ' + (it.x.model || '')).toLowerCase().indexOf(qq) >= 0;
      });
      var selName = S2.selCall;
      var left = 0, laneTotal = mine.reduce(function (s, it) { return s + it.w; }, 0) || 1;
      return '<div class="as-lane"><span class="as-lane-n">' + KIND_CN[lane] + '</span><div class="as-lane-t">' +
        mine.map(function (it) {
          var w = (it.w / laneTotal) * 100;
          var el = '<i class="k-' + h.esc(it.x.kind) + (it.x.status === 'failed' ? ' is-fail' : '') + (selName && it.x.name === selName ? ' on' : '') + '" style="left:' + left.toFixed(2) + '%;width:' + Math.max(1, w).toFixed(2) + '%" title="' +
            h.esc('第 ' + it.r.no + ' 轮 · ' + it.x.name + ' · ' + h.fmt.dur(it.ms)) + '"></i>';
          left += w;
          return el;
        }).join('') + '</div></div>';
    }).join('');
  }

  /* ─────────────────────── 轨迹屏：纵向账本（TrajectoryTable）───────────────────────
     源码事实（每条都能指到行）：
      · 行高三种常量：CONTENT_ROW_HEIGHT=30 / COLLAPSED_SUMMARY_HEIGHT=20 / TERMINAL_BOUNDARY_HEIGHT=9
        （trajectory-virtual-rows.ts:6-8），overscan 12 行（TrajectoryTable.tsx:47-49）。
      · 三种分组标题：消息 / 第 {step} 步 / 压缩 {seq}（layout.ts:216-232,388-398；locales.ts:39-41），
        行高 36px、左右内距 20px、标题与描述 24px（TrajectoryGroupHeader.module.css:3-11）。
      · 工具栏：sticky、高 32px（views.module.css:3）、时长"实际/等宽"开关、展开所有轮次/调用、
        164px 弹性搜索框（TrajectoryToolbar.tsx:55-112 + .module.css:1-215）。
      · 单元格：38px 高 / 0 8px 0 20px / gap 24px / radius-md / .5px 描边；序号 24px、标签槽 80px、
        标签 22px（TrajectoryCell.module.css:4-47）。
      · 轮次轨道 2px（品牌 22% 混色）、选中轨道 3px、请求边界 16px 控件 + 5px 圆点 + 9px 代码字标签
        （TrajectoryTable.module.css:100-104,216-337）。
      · 右侧详情面板 clamp(320px,38%,440px) / 头 42px / 标签条 34px / 8px 拖拽手柄（:853-1015）。 */

  /* 行高常量（trajectory-virtual-rows.ts:6-8）——界面按它排布 DOM 行，不做真虚拟化
     （本原型的轨迹在百行级；源码虚拟化是为万行级滚动性能）。 */
  var TRAJ_ROW_H = { content: 30, collapsed: 20, terminalBoundary: 9, groupHeader: 36, cell: 38 };
  var TRAJ_VIRTUAL_OVERSCAN_ROWS = 12;                   /* TrajectoryTable.tsx:49 */
  var TRAJ_KIND_CN = { user: '用户', system: '系统', context: '上下文', message: '消息', tool: '工具', subtool: '子工具', compacted: '已压缩' };
  var TRAJ_TAG = { user: 'User', system: 'System', context: 'Context', message: 'Message', tool: 'Tool', subtool: 'Subtool', compacted: 'System' };
  /* 账本单元格里显示的 kind：用**源码 types.ts 里的原始 kind 名**（TrajectoryCell 的标签文案
     在 zh 里就是 user/system/message/tool/context 这些原字，locales.ts:22-31 kind.* 是英文大写形式，
     这里取小写原字，与单元格 data-kind 一致）。 */
  var CELL_KIND_CN = { user: '用户', system: '系统', message: '消息', tool: '工具', guard: '校验', start: '输入', end: '输出' };

  function h0esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* 单元格文本：源码用 text-overflow: ellipsis 收口，这里预截 120 字（同一口径） */
  function trajText(v) {
    if (v == null) return '';
    var s = (typeof v === 'string') ? v : JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  /* 把一轮的真实 trace span 折成账本 cell（字段名与 DSH 的 TrajectoryCellProps 同名子集） */
  /* 把一轮的真实 trace span 折成账本 cell（字段名与 DSH 的 TrajectoryCellProps 同名子集）。
     kind 的取值照源码 trajectory-cell 的 kind 集合（trajectory-record.ts / TrajectoryCell.tsx）：
     user / system / context / message（assistant）/ tool / subtool / compacted。 */
  function trajCellsOf(r) {
    var out = [], tr = null;
    try { tr = r.traceId ? global.FACTS.getTrace(r.traceId) : null; } catch (e) { }
    var spans = (tr && tr.spans) || [];
    /* 序号只数**正文行**，不把分组标题（消息 / 第 N 步）算进去。
       此前用 out.length 当序号，分组标题也占号，界面上就成了 1、2、4、5、6、8…（3 和 7 凭空消失）。 */
    var seq = 0;
    /* 分组标题①：消息（layout.ts:213-221 pushMessage） */
    out.push({ rowKind: 'group', title: '消息', description: r.intentName || '', turn: r.no, kind: 'group' });
    out.push({
      index: ++seq, kind: 'user', name: '用户', turn: r.no, step: 0,
      text: trajText(r.user), rawText: r.user, mcp: null, model: null, durationMs: null,
      status: 'ok', tokensIn: null, tokensOut: null, sourceSeq: r.ts, requestStart: true,
      inputDetail: r.user
    });
    var step = 0;
    spans.forEach(function (sp) {
      if (sp.kind === 'llm') {
        step++;
        /* 分组标题②：第 N 步（layout.ts:222-232 pushStep） */
        out.push({ rowKind: 'group', title: '第 ' + step + ' 步', description: sp.name, turn: r.no, step: step, kind: 'group' });
      }
      var isTool = sp.kind === 'tool';
      out.push({
        index: ++seq,
        kind: isTool ? 'tool' : (sp.kind === 'guard' ? 'context' : (sp.kind === 'start' ? 'system' : 'message')),
        name: sp.name, turn: r.no, step: step || 1,
        text: trajText(sp.mcp ? sp.mcp : (sp.model ? '模型 ' + sp.model : sp.name)),
        mcp: sp.mcp || null, model: sp.model || null,
        durationMs: sp.duration == null ? null : sp.duration,
        status: sp.status, tokensIn: sp.tokensIn, tokensOut: sp.tokensOut,
        sourceSeq: sp.start != null ? r.ts + sp.start : null,
        requestStart: sp.kind === 'start',
        inputDetail: (sp.io && sp.io.input) || null,
        outputDetail: (sp.io && sp.io.output) || null,
        error: sp.error || null
      });
    });
    out.push({
      index: ++seq, kind: 'message', name: '助手', turn: r.no, step: step,
      text: trajText(r.assistant), rawText: r.assistant, mcp: null, model: null,
      durationMs: r.latencyMs == null ? null : r.latencyMs, status: r.status === 'success' ? 'ok' : r.status,
      tokensIn: null, tokensOut: r.tokens, sourceSeq: r.ts + (r.latencyMs || 0),
      outputDetail: r.assistant, terminalBoundary: true
    });
    return out;
  }
  /* 统一 diff（TrajectoryTable.tsx:1398-1413 的 structuredPatch 等价输出：
     '@@ -a,b +c,d @@' 元行 + ' ' 上下文 / '+' 新增 / '-' 删除，context 3） */
  function promptDiffRows(aText, bText) {
    var A = String(aText == null ? '' : aText).split('\n');
    var B = String(bText == null ? '' : bText).split('\n');
    var s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    var e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
    var am = A.slice(s, A.length - e), bm = B.slice(s, B.length - e);
    var n = am.length, m = bm.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp[i] = []; for (j = 0; j <= m; j++) dp[i][j] = 0; }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var body = [], ai = 0, bi = 0;
    while (ai < n && bi < m) {
      if (am[ai] === bm[bi]) { body.push({ kind: 'context', text: ' ' + am[ai] }); ai++; bi++; }
      else if (dp[ai + 1][bi] >= dp[ai][bi + 1]) { body.push({ kind: 'removed', text: '-' + am[ai] }); ai++; }
      else { body.push({ kind: 'added', text: '+' + bm[bi] }); bi++; }
    }
    while (ai < n) body.push({ kind: 'removed', text: '-' + am[ai++] });
    while (bi < m) body.push({ kind: 'added', text: '+' + bm[bi++] });
    if (!body.length) return [];
    var ctx = 3, first = Math.max(0, s - ctx), last = Math.min(A.length, A.length - e + ctx);
    var lines = [{ kind: 'meta', text: '@@ -' + (s + 1) + ',' + n + ' +' + (s + 1) + ',' + m + ' @@' }];
    for (i = first; i < s; i++) lines.push({ kind: 'context', text: ' ' + A[i] });
    lines = lines.concat(body);
    for (i = A.length - e; i < last; i++) lines.push({ kind: 'context', text: ' ' + A[i] });
    return lines;
  }
  function promptDiffSection(title, before, after) {
    var lines = promptDiffRows(before, after);
    if (!lines.length) return '';                        /* PromptDiffSection: lines.length === 0 → null */
    return '<section class="trajtable-promptDiffSection"><h3 class="trajtable-promptDiffTitle">' + h0esc(title) + '</h3>' +
      '<pre class="trajtable-promptDiff">' + lines.map(function (l) {
        return '<span class="trajtable-promptDiffLine' + l.kind + '">' + h0esc(l.text || ' ') + '\n</span>';
      }).join('') + '</pre></section>';
  }

  /* 本原型确实没有数据源的说明位（压缩行 / 附件行）。
     ⚠ 旧版把「提示词 diff 面板」也写在这里并声称"DSH 没有数据源" —— **那是错的**：
     DSH 有完整实现（TrajectoryTable.module.css:611-672 + TrajectoryTable.tsx:1398-1470），
     数据来自 RequestView.prompt / promptChange.previous（layout.ts:337-341）。
     本原型确有一处提示词类文本（llm span 的 io.input：model/temperature/messages），
     所以提示词 diff **按源码渲染**（见 trajDetails），这里只留真正无源的压缩行。 */
  function trajAbsent(h) {
    return '<div class="as-absent">' +
      '<div class="as-absent-i"><b>压缩（compaction）· 无数据</b>' +
      '<span>本次会话没有压缩事件。</span></div>' +
      '</div>';
  }
  /* 逐事件账本表（TrajectoryTable）。**这是唯一一张轨迹表**：
     行高三种常量 30 / 20 / 9（trajectory-virtual-rows.ts:6-8）；表头 sticky（TrajectoryTable.module.css:127-144）；
     事件列 122px、:lang(zh) 84px（:115-121）；标签槽 80px / 标签 22px（TrajectoryCell.module.css:29-47）。
     每一行都来自一条真实 trace span，没有任何编造行。
     类名同时挂 as-tt- 系列（本原型既有类名）与 trajtable- / trajcell- 系列（逐字搬入的 DSH 类名）。 */
  /* 逐事件账本表（TrajectoryTable）。**这是唯一一张轨迹表**，列结构与源码一致：
     只有两列 —— `.eventColumn`（事件，122px / 中文 84px）+ `.contentColumn`（内容，auto）；
     行高 30px、表尾 9px（trajectory-virtual-rows.ts:6-8 + TrajectoryTable.module.css:115-159）；
     单元格内部才是 TrajectoryCell 的骨架（38px 高 / 0 8px 0 20px / gap 24px / 序号 24px /
     标签槽 80px / 标签 22px / 右侧 320px 的 4×71 指标列）。
     每一行都来自一条真实 trace span，没有任何编造行。 */
  function trajTable(a, se, st, h) {
    /* 行装配分两档：默认平铺；开了「轮次 / 调用」折叠时，按 dsh 的 collapseTurnRecords /
       collapseAssistantRecords（TrajectoryTable.tsx:624-733）把一段记录换成一条摘要行：
         · 轮次折叠 → 一轮只留「用户」那条，其余收成「N 步 · M 个工具调用」；
         · 调用折叠 → 模型/助手行后面连续的工具行收成「M 个工具调用 · 名称…」。
       摘要行自己可点开，只展开那一段，不动全局开关（对应 dsh 的 onToggleTurn / onToggleAssistant）。 */
    var ct = st.trajCollapseTurns || {}, cc = st.trajCollapseCalls || {};
    var rows = [];
    function kindOf(c) { return c.nodeKind || c.kind; }
    function baseRow(r, c) {
      return {
        traceId: r.traceId, roundNo: r.no, idx: c.index, name: c.name, kind: kindOf(c),
        ms: c.durationMs, status: c.status, model: c.model, mcp: c.mcp,
        tin: c.tokensIn, tout: c.tokensOut,
        detail: c.mcp ? c.mcp : (c.model ? '模型 ' + c.model : (c.text || '—')),
        end: !!c.terminalBoundary
      };
    }

    se.rounds.slice().reverse().forEach(function (r) {
      var cells = trajCellsOf(r);
      var body = cells.filter(function (c) { return c.rowKind !== 'group'; });
      var steps = cells.filter(function (c) { return c.rowKind === 'group' && c.title !== '消息'; }).length;
      var nTools = body.filter(function (c) { return kindOf(c) === 'tool'; }).length;

      /* ① 轮次折叠：一条摘要代替整轮（dsh：非正文行照留，正文只留第一条） */
      if (ct[r.traceId] && body.length > 1) {
        rows.push({ group: true, title: '消息', description: r.intentName || '', key: r.traceId + '#g0', turnId: r.traceId });
        rows.push(baseRow(r, body[0]));
        rows.push({ collapse: 'turn', traceId: r.traceId, summary: steps + ' 步 · ' + nTools + ' 个工具调用' });
        return;
      }

      /* ② 平铺（含「调用」折叠） */
      var p = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (c.rowKind === 'group') {
          rows.push({ group: true, title: c.title, description: c.description, key: r.traceId + '#g' + (p++), turnId: c.title === '消息' ? r.traceId : null });
          continue;
        }
        rows.push(baseRow(r, c));
        if (kindOf(c) !== 'message') continue;
        var j = i + 1, calls = [];
        while (j < cells.length && cells[j].rowKind !== 'group' && kindOf(cells[j]) === 'tool') { calls.push(cells[j]); j++; }
        if (!calls.length) continue;
        var ck = r.traceId + '#' + c.index;
        if (cc[ck]) {
          var names = [];
          calls.forEach(function (x) { if (names.indexOf(x.name) < 0) names.push(x.name); });
          rows.push({
            collapse: 'calls', traceId: r.traceId, key: ck,
            summary: calls.length + ' 个工具调用 · ' + names.join('、')
          });
          i = j - 1;
        }
      }
    });
    if (!rows.length) return '';

    var TAG2 = { start: 'System', llm: 'Message', tool: 'Tool', guard: 'Context', end: 'System' };
    var CELL_CN = { user: '用户', system: '系统', message: '消息', tool: '工具', context: '校验' };
    /* 列筛选（时长 / 轮次 / 调用 / 输入 / 模型 / 工具）：状态落成 wrap 上的 tf-hide-* 类，显隐交给 CSS。
       口径（写进按钮的 title，别让人猜）：
         输入 = 开始 / 校验这类非模型步骤；模型 = 每一次 LLM 调用；工具 = 工具调用；
         时长 = 右侧毫秒；调用 = 左侧调用序号；轮次 = 「消息 / 第 N 步」分组标题。 */
    var tf = st.tfCols || {};
    var tfCls = '';
    ['duration', 'turn', 'call', 'input', 'model', 'tool'].forEach(function (k) {
      if (tf[k] === false) tfCls += ' tf-hide-' + k;
    });

    var shown = 0;
    return '<div class="as-tt-wrap trajtable-tablePane' + tfCls + '"><table class="as-tt trajtable-table" data-scroll-ready="true">' +
      '<thead><tr><th class="as-tt-ev trajtable-eventColumn eventColumn">事件</th>' +
      '<th class="trajtable-contentColumn contentColumn">内容</th></tr></thead><tbody>' +
      rows.map(function (x) {
        if (x.group) {
          /* 分组标题行：36px 高、左右 20px、标题与描述 24px（TrajectoryGroupHeader.module.css:3-11） */
          return '<tr class="trajtable-groupRow' + (x.turnId ? ' trajtable-turnRow' : '') + '" data-group-row="' + h.esc(x.key) + '"' +
            (x.turnId ? ' data-act="as-traj-turn-one" data-id="' + h.esc(a.id + '|' + x.turnId) + '" tabindex="0" title="折叠 / 展开这一轮"' : '') + '>' +
            '<td class="as-tt-ev"></td>' +
            '<td><div class="trajgroup-root"><span class="trajgroup-title">' + h.esc(x.title) + '</span>' +
            '<span class="trajgroup-description">' + h.esc(x.description || '') + '</span></div></td></tr>';
        }
        if (x.collapse) {
          /* 折叠摘要行（TrajectoryTable.module.css:721-724 的 20px 折叠行）：一整行就是开关 */
          return '<tr class="trajtable-collapsedRow" data-collapsed-summary="' + x.collapse + '"' +
            ' data-act="as-traj-sum" data-id="' + h.esc(a.id + '|' + x.collapse + '|' + x.traceId + '|' + (x.key || '')) + '"' +
            ' tabindex="0" title="展开这一段">' +
            '<td class="as-tt-ev"></td>' +
            '<td><div class="trajgroup-root trajgroup-collapsed">' +
            '<span class="trajgroup-title">' + (x.collapse === 'turn' ? '轮次' : '工具') + '</span>' +
            '<span class="trajgroup-description">' + h.esc(x.summary) + '</span>' +
            '<span class="trajgroup-hint">展开</span></div></td></tr>';
        }
        shown++;
        var cur = st.selCall === x.name && (st.sel || null) === x.traceId;
        var q = String(st.trajQ || '').toLowerCase();
        var hit = !q || String(x.name + ' ' + (x.mcp || '') + ' ' + (x.model || '')).toLowerCase().indexOf(q) >= 0;
        /* 时间轴上框了一段 → 账本里只留框中的那几条，其余变淡（dsh 的 timelineFocusIndexes=outside 同一手法） */
        var selIds = (st.tgSel && st.tgSel.ids && st.tgSel.ids.length) ? st.tgSel.ids : null;
        if (selIds && selIds.indexOf(a.id + '|' + x.traceId + '|' + x.name) < 0) hit = false;
        return '<tr class="' + (x.status === 'failed' ? 'is-fail ' : '') + (cur ? 'on' : '') +
          '" data-act="as-call-sel" data-id="' + h.esc(a.id) + '|' + h.esc(x.traceId) + '|' + h.esc(x.name) + '"' +
          /* 详情面板的选中键就挂在行上（traceId#index）。别再让动作层去"重算一遍"——
             它会另取一份会话（引擎视图 vs 存储视图），traceId 对不上时键就不一致，
             表现就是"行选中了、详情面板不出来"。 */
          ' data-key="' + h.esc(x.traceId + '#' + x.idx) + '"' +
          ' data-kind="' + h.esc(x.kind) + '"' + (x.model ? ' data-model="1"' : '') +
          (x.end ? ' data-terminal-request-boundary="true" data-turn-end="true"' : '') +
          (hit ? '' : ' hidden-row="1" data-timeline-focus="outside"') +
          (cur ? ' data-selected="true"' : '') + ' tabindex="0">' +
          '<td class="as-tt-ev trajtable-event eventColumn"><span class="trajtable-turnRail" aria-hidden="true"></span>' +
          (cur ? '<span class="trajtable-selectionRail" aria-hidden="true"></span>' : '') + h.esc(x.name) + '</td>' +
          '<td class="trajtable-contentColumn contentColumn">' +
          '<div class="trajcell-root' + (cur ? ' trajcell-selected' : '') + '">' +
          '<span class="trajcell-index">' + (x.idx == null ? '' : x.idx) + '</span>' +
          '<span class="trajcell-tagSlot as-tt-k"><span class="as-kl k-' + h.esc(x.kind) + ' trajcell-tag trajcell-tag' + (TAG2[x.kind] || 'System') + '">' +
          h.esc(CELL_CN[x.kind] || x.kind) + '</span></span>' +
          '<span class="trajcell-text contentText">' + h.esc(x.detail) + '</span>' +
          '<span class="trajcell-trailing">' +
          '<span class="trajcell-time as-tt-ms">' + durCn(x.ms) + '</span>' +
          '<span class="trajcell-metric">' + (x.tin != null ? 'in ' + x.tin : (x.tout != null ? 'out ' + x.tout : '')) + '</span>' +
          '<span class="trajcell-metric as-tt-st">' + (x.status === 'failed' ? '<span class="as-fail">失败</span>' : '成功') + '</span>' +
          '</span></div></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="as-tt-note">逐条来自真实 trace span；共 ' + shown + ' 行 · 轮次 ' + se.rounds.length + ' 个。点一行 → 右侧详情面板 + 泳道定位。</div></div>';
  }
  function trajToolbar(a, se, h, st) {
    var actual = st.durationMode !== 'equal';            /* 时长开关：实际 / 等宽 */
    var turnsCollapsed = Object.keys(st.trajCollapseTurns || {}).length > 0;
    var callsCollapsed = Object.keys(st.trajCollapseCalls || {}).length > 0;
    return '<div class="trajbar-root as-traj-hd" role="toolbar" aria-label="轨迹工具栏"><div class="trajbar-inner">' +
      '<div class="trajbar-actions">' +
      '<button type="button" class="trajbar-toggle" data-act="as-traj-duration" data-id="' + h.esc(a.id) + '"' +
      ' aria-label="使用实际时长" aria-pressed="' + actual + '" title="' + (actual ? '使用等宽操作' : '使用实际时长') + '">' +
      '<svg class="trajbar-toggleIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/><path d="M8 4.75V8l2.25 1.5"/></svg>时长</button>' +
      /* 时间口径开关（TrajectoryToolbar.tsx:74-86 的 .control）：role=switch + aria-checked，
         轨道 20×10、滑块 6×6、开启时滑块 translateX(10px)（.module.css:266-290）。
         源码里它就是可见的第三档（actualTime → timelineMode 四态：sequence/time/duration/actual，
         TrajectoryView.tsx:355-357），原型此前漏了它。 */
      /* 轮次 / 调用：**真折叠**（dsh 的 collapseTurnRecords / collapseAssistantRecords）。
         之前这两个按钮只翻图标与 aria-pressed，账本一行不动 —— 就是「死按钮」。 */
      '<button type="button" class="trajbar-action as-sw' + (turnsCollapsed ? ' on' : '') + '" data-act="as-traj-turns" data-id="' + h.esc(a.id) + '"' +
      ' aria-label="' + (turnsCollapsed ? '展开所有轮次' : '收起所有轮次') + '" aria-pressed="' + turnsCollapsed + '"' +
      ' title="' + (turnsCollapsed ? '展开所有轮次（每轮只留摘要）' : '收起所有轮次，每条只留一行摘要') + '">' +
      '<span class="trajbar-actionIcon" aria-hidden="true">' + (turnsCollapsed ? '⊞' : '⊟') + '</span>轮次</button>' +
      '<button type="button" class="trajbar-action as-sw' + (callsCollapsed ? ' on' : '') + '" data-act="as-traj-calls" data-id="' + h.esc(a.id) + '"' +
      ' aria-label="' + (callsCollapsed ? '展开所有调用' : '收起所有调用') + '" aria-pressed="' + callsCollapsed + '"' +
      ' title="' + (callsCollapsed ? '展开所有调用' : '把连续的工具调用收成一行') + '">' +
      '<span class="trajbar-actionIcon" aria-hidden="true">' + (callsCollapsed ? '⊞' : '⊟') + '</span>调用</button>' +
      '</div>' +
      '<div class="trajbar-search as-search">' + h.icon('search', 11) +
      '<input type="search" class="trajbar-searchInput" data-f="asTrajQ" value="' + h.esc(st.trajQ || '') + '"' +
      ' aria-label="搜索轨迹" placeholder="搜索">' +
      (st.trajQ ? '<button type="button" class="as-chip-x" data-act="as-traj-q-clear" data-id="' + h.esc(a.id) + '" aria-label="清除搜索">×</button>' : '') +
      '</div></div></div>';
  }
  /* ─────────────────────── 轨迹屏：列筛选器 + 事件甘特时间条 ───────────────────────
     出处：真实 DSH web 端轨迹页在账本**上方**还有两件东西（实地跑 dsh web 确认）——
     ① 一排列筛选器：`时长 ⊟　轮次 ⊟　调用　输入　模型　工具`；
     ② 一条彩色甘特时间条：把该会话的事件按真实时间铺成横带，类别不同颜色不同。
     本原型此前只有账本，缺这两块。类名契约（as-traj-filters / as-tf / as-traj-gantt / as-tg-bar）
     由 CSS 侧冻结，这里逐字照用。 */

  /* 列开关：data-col 只能取这六个值（契约）。中文标签照 DSH 原文。 */
  var TF_COLS = [['duration', '时长'], ['turn', '轮次'], ['call', '调用'], ['input', '输入'], ['model', '模型'], ['tool', '工具']];
  /* 每个开关管什么（写进按钮 title，别让人猜）：三档是「行」的显隐，三档是「件」的显隐。 */
  var TF_TIP = {
    duration: '右侧耗时（毫秒）列的显隐',
    turn: '「消息 / 第 N 步」分组标题行的显隐',
    call: '左侧调用序号列的显隐',
    input: '输入类行的显隐（开始 / 校验这类非模型步骤）',
    model: '模型类行的显隐（每一次 LLM 调用）',
    tool: '工具调用行的显隐'
  };
  /* 某一列是否打开：tfCols 为 null（用户没动过）→ 全部默认 on。 */
  function tfColOn(st, col) { return !(st.tfCols && st.tfCols[col] === false); }
  function trajFilters(a, st, h) {
    return '<div class="as-traj-filters" role="toolbar" aria-label="轨迹列筛选">' +
      TF_COLS.map(function (c) {
        var on = tfColOn(st, c[0]);
        return '<button class="as-tf' + (on ? ' on' : '') + '" data-act="as-tf-toggle" data-col="' + c[0] + '"' +
          ' aria-pressed="' + on + '" title="' + h.esc(TF_TIP[c[0]] || '') + '">' + c[1] + '<i>⊟</i></button>';
      }).join('') + '</div>';
  }

  /* 事件甘特时间条。
     数据来源（都是文件里已有的真实字段，没有一处是编的）：
       · 轮次起点 r.ts（v27-session-store.js:131 由 trace 行带来）；
       · span 的相对偏移 start 与时长 duration —— global.FACTS.getTrace(r.traceId).spans
         （facts.js:587 写 start、facts.js:579-585 写 duration，且二者之和精确等于该轮 latencyMs）。
       所以某段的绝对时间 = r.ts + sp.start，全轴 = 会话内所有段的 [min, max]。
     类别映射到契约允许的 data-kind（assistant|tool|llm|idle|error 五选一）：
       · status==='failed' → error（优先，失败段压过它本来的类别）
       · llm → llm
       · tool / guard → tool（enum 里没有 guard 档；合规校验也是"非模型的一步"，归工具桶）
       · start / end（请求起止边界 span）→ assistant（即这一轮助手侧的跨度）
       · 相邻两轮之间的真实空档 → idle（只在两端都落在轴内时补，不向外编造时间）
     ── 降级：一条 trace span 都取不到（无 traceId / FACTS 不可用 / 轴长为 0）→ 返回 ''，
        即**只渲染筛选器、不渲染甘特条**，绝不用假时间凑一条出来。 */
  /* v41：事件时间轴按 dsh 的 TrajectoryTimeline 重做（业主：去看 dsh 的轨迹图逻辑）。
     dsh 的做法（TrajectoryTimeline.tsx + module.css + timeline.ts，逐条核对过）：
       · **三条泳道**，不是一条：.span{top:calc(var(--trajectory-span-lane) * 14px);height:8px}
         标签列「输入 / 模型 / 工具」在 left:0、top 7/21/35、高 8 —— 整条 50px；
       · 泳道归属 laneFor()：tool/subtool → 2；message/compacted → 1；其余 → 0；
       · **轮次边界**是 0.5px 竖线（.turnBoundary，border-l2），贯穿整条轨；
       · 相邻 span 之间留缝：--trajectory-span-gap = min(width*8%, 1px)，两端各让一次；
       · 配色 tool = state-warn-label（琥珀）、message = 品牌+错误的混色、其余 = label-secondary 0.78；
       · **没有 idle 色块** —— dsh 在 time 档直接压缩空闲，空隙就是空白，不画灰条。
     本原型原来是一条 22px 的轨，所有 bar 都 top:0，于是全部叠在一起（截图里那排花绿块），
     idle 灰条也是自创的。现在照 dsh 落位：三泳道 / 轮次竖线 / 无 idle / 同一轮内留缝。
     lane 语义按本仓的 span.kind 落：start·end·guard → 0（输入），llm → 1（模型），tool → 2（工具）。 */
  function trajGantt(se, st, h) {
    var segs = [];
    var rounds = (se && se.rounds) || [];
    rounds.forEach(function (r, ri) {
      var tr = null;
      try { tr = r.traceId ? global.FACTS.getTrace(r.traceId) : null; } catch (e) { }
      var spans = (tr && tr.spans) || [];
      var base = Number(r.ts);
      if (!spans.length || !base) return;
      spans.forEach(function (sp) {
        if (sp.start == null) return;
        var dur = Number(sp.duration) || 0;
        if (!(dur > 0)) return;
        var k = sp.kind;
        var lane = (k === 'tool') ? 2 : (k === 'llm') ? 1 : 0;
        var kind = (sp.status === 'failed') ? 'error' : (k === 'tool' ? 'tool' : (k === 'llm' ? 'llm' : 'io'));
        segs.push({ kind: kind, lane: lane, turn: ri, tid: r.traceId, t0: base + sp.start, t1: base + sp.start + dur, name: sp.name || '' });
      });
    });
    if (!segs.length) return '';

    /* ── 压缩空闲（dsh timeline.ts 的 compressIdle 同一算法）──────────────────────
       真实时间轴上，轮次之间空着十几秒到几分钟，而一轮里的 span 只有几百毫秒 ——
       照实投影的结果是"几十根 0.25% 的发丝挤在右边、左边整片空白"（改完三泳道后实测即此）。
       dsh 的解法是累加被移除的空闲量并按序扣除：时间轴 = 所有 span 的时长首尾相接，
       轮次之间的空隙不占宽度。这样既有真实时长比例（宽窄仍然可信），又没有大片死白。 */
    /* 两档（dsh 的四态里，后两档依赖「实际时间」开关 —— 但那个 button 在 dsh 源码里带 `hidden`
       （TrajectoryToolbar.tsx:74-87），界面上根本不出现，所以这里只剩两档）：
         · duration（默认）：真实位置 + 真实宽度 + 轮次之间的空闲压掉
         · sequence（点「时长」切到等宽）：一事件一格，按顺序等距铺，不表达时长（timeline.ts:75-118） */
    var tlMode = (st && st.durationMode === 'equal') ? 'sequence' : 'duration';
    var compress = tlMode === 'duration';
    var ordered = segs.slice().sort(function (x, y) { return x.t0 - y.t0 || x.t1 - y.t1; });
    var removed = 0, coveredUntil = null;
    ordered.forEach(function (s) {
      if (compress && coveredUntil !== null && s.t0 > coveredUntil) removed += s.t0 - coveredUntil;
      s.ps = s.t0 - removed;
      s.pe = s.t1 - removed;
      coveredUntil = coveredUntil === null ? s.t1 : Math.max(coveredUntil, s.t1);
    });
    /* 「时长」按钮对应 dsh 的 duration ↔ time 两态：
       等宽档**不改位置**，只把每根条压成固定 8px 宽（TrajectoryTimeline.module.css:231
       `.span[data-equal-duration='true']{width:8px;min-width:8px}`）——
       上一版我把整条轴重排成等分格，位置也跟着变了，那不是 dsh 的行为。 */
    /* sequence：一格一事件，按顺序等距铺（dsh 的 spans[i] = [i, i+1]），不表达时长 */
    if (tlMode === 'sequence') {
      ordered.forEach(function (s, i) { s.ps = i; s.pe = i + 1; });
    }
    /* ⚠ 投影后的 ps/pe 仍是**绝对时间戳**（十几位毫秒），必须减去域的起点再折算占比 ——
       直接 v/domain 会得到 0.999…（第一版就踩了这个坑：53 根 bar 全挤在 100%）。 */
    var dStart = Infinity, dEnd = -Infinity;
    ordered.forEach(function (s) {
      if (s.ps < dStart) dStart = s.ps;
      if (s.pe > dEnd) dEnd = s.pe;
    });
    var span = dEnd - dStart;
    if (!(span > 0)) return '';
    var pct = function (v) { return Math.round(((v - dStart) / span) * 1000) / 10; };
    /* 缩放（dsh TrajectoryTimeline 的 wheel 视口，:358-385）：以光标处为锚点，
       x' = (x - cx) * z + cx。z=1 时原样；范围 1–40 倍，双击复位。 */
    var zv = (st && st.tgZoom) || null;
    var zoom = (zv && zv.z > 1) ? zv.z : 1;
    var zc = (zv && zv.z > 1) ? zv.cx : 50;
    var zx = function (v) { return Math.round(((v - zc) * zoom + zc) * 10) / 10; };

    /* 轮次分隔线落在该轮**第一个 span**的投影位置上（dsh：turnBoundaries.time = min(start)） */
    var turnAt = {};
    ordered.forEach(function (s) {
      if (turnAt[s.turn] == null || s.ps < turnAt[s.turn]) turnAt[s.turn] = s.ps;
    });
    var bounds = Object.keys(turnAt).filter(function (k) { return Number(k) > 0; }).map(function (k) {
      return '<span class="as-tg-turn" style="--x:' + zx(pct(turnAt[k])) + '"></span>';
    }).join('');

    /* 每根条都可点：点了就定位到账本里那一条（dsh 的 TrajectoryTimeline 是
       onRecordSelect(index) —— 时间轴与账本是同一个选中态，不是两套图）。
       此前这些 <i> 只是装饰：既没有 data-act，也没有选中态，点上去毫无反应。 */
    var aidG = (se && se.agentId) || '';
    var selIds = (st && st.tgSel && st.tgSel.ids && st.tgSel.ids.length) ? st.tgSel.ids : null;
    var selMin = null, selMax = null;
    var bars = ordered.map(function (s) {
      var x0 = pct(s.ps);
      var x = zx(x0);
      var w = Math.max(0.25, (pct(s.pe) - x0) * zoom);
      var label = (s.name || '') + ' · ' + s.kind;
      if (selIds && s.tid && s.name && selIds.indexOf(aidG + '|' + s.tid + '|' + s.name) >= 0) {
        selMin = selMin === null ? x : Math.min(selMin, x);
        selMax = selMax === null ? (x + w) : Math.max(selMax, x + w);
      }
      var bid = (aidG && s.tid && s.name) ? aidG + '|' + s.tid + '|' + s.name : '';
      var dim = (selIds && bid && selIds.indexOf(bid) < 0) ? ' data-dim="1"' : '';
      return '<i class="as-tg-bar" data-kind="' + s.kind + '" data-lane="' + s.lane + '"' + dim +
        (bid ? ' data-act="as-tg-sel" data-id="' + h.esc(bid) + '" tabindex="0" role="button"' : '') +
        ' style="--lane:' + s.lane + ';--x:' + x + ';--w:' + w + '"' +
        (label ? ' title="' + h.esc(label + ' · ' + durCn(s.t1 - s.t0) + '（点击定位到账本）') + '"' : '') + '></i>';
    }).join('');

    var selNow = (st && st.tgSel && st.tgSel.ids) ? st.tgSel.ids.length : 0;
    var hints = [];
    if (zoom > 1) hints.push('缩放 ' + (Math.round(zoom * 10) / 10) + '×');
    if (selNow) hints.push('框选 ' + selNow + ' 条');
    var tag = hints.length
      ? '<span class="as-tg-zoomtag">' + hints.join(' · ') + ' · 右键拖平移 · 双击 / Esc 复位</span>'
      : '';
    return '<div class="as-traj-gantt" role="img" aria-label="事件时间轴（按轮次压缩空闲）">' +
      '<div class="as-tg-labels" aria-hidden="true"><span>输入</span><span>模型</span><span>工具</span></div>' +
      '<div class="as-tg-plot">' + bounds +
      '<span class="as-tg-selbox" data-selbox' +
      (selMin !== null ? ' style="--a:' + selMin + ';--b:' + selMax + '"' : ' hidden') + '></span>' +
      bars +
      '<span class="as-tg-playhead" data-ph hidden></span>' +
      '</div>' + tag +
      '</div>';
  }

  /* 一条账本行（TrajectoryTable 的 <tr>）——**当前实现走 trajTable()**；
     这个构造器保留给"分组标题行"和"子调用行"的后续扩展（同样挂 DSH 类名）。 */
  function trajLedgerRow(c, a, st, h) {
    var q = String(st.trajQ || '').toLowerCase();
    var hit = !q || String(c.name + ' ' + (c.mcp || '') + ' ' + (c.model || '') + ' ' + c.text).toLowerCase().indexOf(q) >= 0;
    var selected = !!st.selCall && st.selCall === c.name && (st.sel || null) === (c.traceId || null);
    var isTurnStart = !!c.requestStart;
    var isTurnEnd = !!c.terminalBoundary;
    var attrs = ' data-act="as-call-sel" data-id="' + h.esc(a.id) + '|' + h.esc(c.traceId) + '|' + h.esc(c.name) + '"' +
      ' data-kind="' + h.esc(c.nodeKind || c.kind) + '"' +
      (isTurnStart ? ' data-turn-start="true"' : '') +
      (isTurnEnd ? ' data-turn-end="true" data-terminal-request-boundary="true"' : '') +
      (c.status === 'failed' ? ' data-error="true"' : '') +
      (selected ? ' data-selected="true"' : '') +
      (!hit ? ' hidden-row="1" data-timeline-focus="outside"' : '') +
      ' tabindex="0"';
    var boundary = isTurnStart
      ? '<button type="button" class="trajtable-requestBoundaryControl' + (selected ? ' trajtable-requestBoundaryControlActive' : '') + '"' +
        ' data-act="as-traj-request" data-id="' + h.esc(a.id) + '|' + h.esc(c.traceId) + '"' +
        (c.status === 'failed' ? ' data-request-status="error"' : '') +
        ' data-label="请求 #' + (c.turn || 1) + '" aria-label="请求 #' + (c.turn || 1) + '"></button>'
      : '';
    return '<tr' + attrs + '>' +
      '<td class="trajtable-event"><span class="trajtable-turnRail" aria-hidden="true"></span>' +
      (selected ? '<span class="trajtable-selectionRail" aria-hidden="true"></span>' : '') + boundary + '</td>' +
      '<td class="trajtable-eventColumn">' + h.esc(c.name) + '</td>' +
      '<td><div class="trajcell-root' + (selected ? ' trajcell-selected' : '') + '"' + (c.kind === 'subtool' ? ' data-kind="subtool"' : '') + '>' +
      '<span class="trajcell-index">' + (c.index == null ? '' : c.index) + '</span>' +
      '<span class="trajcell-tagSlot"><span class="trajcell-tag trajcell-tag' + (TRAJ_TAG[c.kind] || 'System') + '">' + h.esc(TRAJ_KIND_CN[c.kind] || c.kind) + '</span></span>' +
      '<span class="trajcell-text contentText">' + h.esc(c.text || '—') + '</span>' +
      '<span class="trajcell-trailing"><span class="trajcell-time">' + durCn(c.durationMs) + '</span></span>' +
      '</div></td></tr>';
  }
  /* 右侧详情面板（TrajectoryTable.module.css:853-1015），含**提示词 diff 面板** */
  function trajDetails(a, se, st, h, cells) {
    if (!st.trajSel) return '';
    var sel = null;
    cells.forEach(function (c) { if (c.key === st.trajSel) sel = c; });
    if (!sel) return '';

    var KIND_CN = { user: '用户', system: '系统', message: '消息', tool: '工具', context: '校验' };
    var kindCn = KIND_CN[sel.kind] || sel.kind;
    function ts(v) {
      if (!v) return '—';
      var d = new Date(Number(v));
      if (isNaN(d.getTime())) return '—';
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
        p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    }
    function pretty(v) {
      if (v == null) return null;
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
    }
    /* 概述里的分块预览：标题可点 → 跳到对应页签（dsh 的 OverviewSection onOpen）。
       复用提示词 diff 的区块骨架（.trajtable-promptDiffSection），不新造一套外观。 */
    function block(label, tab, content, tip) {
      return '<section class="trajtable-promptDiffSection">' +
        '<button type="button" class="trajtable-promptDiffTitle trajtable-ovTitle" data-act="as-traj-tab"' +
        ' data-id="' + h.esc(a.id) + '|' + tab + '" title="' + h.esc(tip || ('打开「' + label + '」')) + '">' +
        h.esc(label) + '<i aria-hidden="true">›</i></button>' +
        '<pre class="trajtable-promptDiff trajtable-ovPreview"><span class="trajtable-promptDiffLinecontext">' +
        h0esc(content == null ? '—' : content) + '</span></pre></section>';
    }

    /* 页签集合照 dsh 的 tabsForRecord（TrajectoryTable.tsx:988-1010）：
       工具/模型/消息记录都是 概述 / 参数 / 结果 / Schema / 计时；
       只有「本轮有两次以上请求参数」时，才额外给一个「系统提示词」做 diff（本原型自己的对比件）。 */
    var tabs = [['overview', '概述'], ['payload', '参数'], ['result', '结果'], ['schema', 'Schema'], ['timing', '计时']];
    var reqs = cells.filter(function (c) { return c.nodeKind === 'llm' && c.inputDetail; });
    if (reqs.length >= 2) tabs.push(['prompt', '系统提示词']);
    var tab = st.trajTab || 'overview';
    if (tabs.map(function (t) { return t[0]; }).indexOf(tab) < 0) tab = 'overview';

    var inTxt = pretty(sel.inputDetail);
    var outTxt = pretty(sel.outputDetail);
    var body = '';

    if (tab === 'prompt') {
      var before = reqs[reqs.length - 2].inputDetail;
      var after = reqs[reqs.length - 1].inputDetail;
      body = '<div class="trajtable-promptDiffSections">' +
        promptDiffSection('系统提示词', JSON.stringify(before, null, 2), JSON.stringify(after, null, 2)) + '</div>';
    } else if (tab === 'payload') {
      body = '<div class="trajtable-promptDiffSections"><section class="trajtable-promptDiffSection">' +
        '<h3 class="trajtable-promptDiffTitle">参数</h3><pre class="trajtable-promptDiff"><span class="trajtable-promptDiffLinecontext">' +
        h0esc(inTxt || '未捕获参数') + '</span></pre></section></div>';
    } else if (tab === 'result') {
      body = '<div class="trajtable-promptDiffSections"><section class="trajtable-promptDiffSection">' +
        '<h3 class="trajtable-promptDiffTitle">结果</h3><pre class="trajtable-promptDiff"><span class="trajtable-promptDiffLinecontext">' +
        h0esc(outTxt || '无输出') + '</span></pre></section></div>';
    } else if (tab === 'schema') {
      /* 本原型的 trace span 里没有工具入参 schema 这一层（dsh 的 record.schemaUnavailable 同款文案），
         如实写"不可用"，不编一份假 schema。 */
      body = '<div class="trajtable-promptDiffSections"><section class="trajtable-promptDiffSection">' +
        '<h3 class="trajtable-promptDiffTitle">Schema</h3><pre class="trajtable-promptDiff"><span class="trajtable-promptDiffLinemeta">' +
        h0esc('Schema 不可用') + '\n' + h0esc('这条记录没有采集到工具入参的 JSON Schema（本原型的数据源里没有这一层）。') +
        '</span></pre></section></div>';
    } else if (tab === 'timing') {
      body = '<div class="trajtable-promptDiffSections"><section class="trajtable-promptDiffSection">' +
        '<h3 class="trajtable-promptDiffTitle">计时</h3><pre class="trajtable-promptDiff"><span class="trajtable-promptDiffLinecontext">' +
        h0esc('开始时间　' + ts(sel.sourceSeq) + '\n时长　　　' + durCn(sel.durationMs) + '\n计时来源　会话时间戳（trace span 的 start / duration）') +
        '</span></pre></section></div>';
    } else {
      /* 概述：层级 / 状态 + 四块预览（dsh 的 <dl> + overviewSections 同构） */
      var startTxt = ts(sel.sourceSeq);
      body = '<div class="trajtable-detailBody">' +
        '<dl class="as-kv-list">' +
        '<div class="as-kv"><span>层级</span><b>' + h.esc(kindCn) + ' · 第 ' + (sel.turn || 1) + ' 轮 · 第 ' + (sel.step || 1) + ' 步</b></div>' +
        '<div class="as-kv"><span>状态</span><b>' + h.esc(sel.status === 'failed' ? '失败' : '已完成') + '</b></div>' +
        '<div class="as-kv"><span>开始时间</span><b>' + h.esc(startTxt) + '</b></div>' +
        '<div class="as-kv"><span>时长</span><b>' + h.esc(durCn(sel.durationMs)) + '</b></div>' +
        (sel.mcp ? '<div class="as-kv"><span>工具</span><b>' + h.esc(sel.mcp) + '</b></div>' : '') +
        (sel.model ? '<div class="as-kv"><span>模型</span><b>' + h.esc(sel.model) + '</b></div>' : '') +
        '</dl>' +
        '<div class="trajtable-promptDiffSections">' +
        block('参数', 'payload', inTxt || '未捕获参数') +
        block('结果', 'result', outTxt || '无输出') +
        block('Schema', 'schema', 'Schema 不可用') +
        block('计时', 'timing', '开始 ' + startTxt + ' · 时长 ' + durCn(sel.durationMs)) +
        '</div></div>';
    }

    return '<aside class="trajtable-details as-traj-details" role="complementary" aria-label="事件详情"' +
      (st.trajW ? ' style="width:' + Number(st.trajW) + 'px"' : '') + '>' +
      '<div class="trajtable-detailsResizeHandle" data-traj-grip="1" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整事件详情宽度"></div>' +
      '<div class="trajtable-detailsHeader"><div class="trajtable-detailsTitle">' +
      '<span class="trajtable-requestDetailsDot"></span>' +
      '<span class="trajtable-requestDetailsName">' + h.esc(sel.name) + '</span>' +
      '<span class="trajtable-detailsLocation">第 ' + (sel.turn || 1) + ' 轮 · 第 ' + (sel.step || 1) + ' 步</span></div>' +
      '<button type="button" class="trajtable-close" data-act="as-traj-close" data-id="' + h.esc(a.id) + '" aria-label="关闭详情">×</button></div>' +
      '<div class="trajtable-detailTabs">' + tabs.map(function (x) {
        return '<button type="button" class="trajtable-detailTab' + (tab === x[0] ? ' trajtable-detailTabActive' : '') +
          '" data-act="as-traj-tab" data-id="' + h.esc(a.id) + '|' + x[0] + '" aria-selected="' + (tab === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div>' +
      (tab === 'overview' ? body : '<div class="trajtable-detailBody">' + body + '</div>') +
      '</aside>';
  }
  function trajView(a, se, h, st) {
    /* 结构与 DSH 的 TrajectoryView 对齐（views.module.css:1-28 / TrajectoryView.tsx:518-556）：
       根容器 flex 列 → 工具条、列筛选、事件时间轴**固定在顶部**（不参与滚动）→
       .trajviews-ledger 吃满剩余高度（flex:1 / min-height:0 / overflow:hidden）→
       其中 .trajtable-tablePane 是**唯一滚动口**，账本与压缩行都在它里面滚。
       此前工具条/筛选/时间轴被塞进了 tablePane：它们跟着表格一起滚、表头还会和粘性工具栏叠在一起；
       而 .as-tt-wrap 的 max-height:360px 又把表压成 8 行，下面留出一大片空白。
       DOM 摆对后这两件事一起消失，表头也不必再额外加 top 偏移。 */
    return '<div class="trajviews-root as-traj">' +
      trajToolbar(a, se, h, st) +
      trajFilters(a, st, h) +
      trajGantt(se, st, h) +
      '<div class="trajviews-ledger">' +
      '<div class="trajtable-split">' +
      '<div class="trajtable-tablePane">' +
      trajTable(a, se, st, h) +
      trajAbsent(h) +
      '</div>' +
      trajDetails(a, se, st, h, ledgerCells(se)) +
      '</div></div></div>';
  }
  /* 详情面板要按"账本 cell 的身份"查找（key = traceId#index） */
  function ledgerCells(se) {
    var cells = [];
    se.rounds.forEach(function (r) {
      trajCellsOf(r).forEach(function (c) {
        c.traceId = r.traceId; c.roundNo = r.no; c.key = r.traceId + '#' + c.index;
        cells.push(c);
      });
    });
    return cells;
  }

  /* 右栏面板：**本原型自建**。DSH 的右栏是 sidebar-right（首开 45% 视口 / 上限 70% / 保中栏 400px / 带拖拽条，见 [layout] README:30），规则与本面板无关 —— 旧注释"DSH 同位置"不实。 */
  function changePanel(a, se, h, st) {
    var r = se.rounds.filter(function (x) { return x.traceId === st.sel; })[0] || se.rounds[se.rounds.length - 1];
    if (!r) return '<div class="as-side-p"><div class="as-side-hd">本轮改动</div><div class="as-side-b">这个会话还没有轮次。</div></div>';
    var rolled = r.rolled || store().isRolled(r.traceId);
    var body;
    if (rolled) body = '<div class="as-side-empty">这轮改动的内容已不可用</div>';
    else if (!r.writes.length) body = '<div class="as-side-empty">这一轮只调用了读服务，没有改动内容</div>';
    else body = diffRows(a, se, h, st, r);
    /* v48：这块**默认折叠**成一行标题（业主：右栏内容撑不下、下面一片空白）。
       标题行带「N 处」计数和「回滚这一轮」入口；点标题展开改动明细。
       省下 ~102px，右栏在你的窗口（可视 699）里正好一屏装完。 */
    var openDiff = !!st.diffPanelOpen;
    return '<div class="as-side-p"><button type="button" class="as-side-hd as-foldhd" data-act="as-diff-panel" data-id="' + h.esc(a.id) + '"' +
      ' aria-expanded="' + openDiff + '">第 ' + r.no + ' 轮改动' +
      '<span class="grow"></span><span class="muted">' + h.esc(r.when) + (r.writes.length ? ' · ' + r.writes.length + ' 处' : '') + '</span>' +
      '<span class="as-caret">' + (openDiff ? '⌄' : '⌃') + '</span></button>' +
      (openDiff ? '<div class="as-side-b">' + body + '</div>' +
        (r.writes.length && !rolled ? '<div class="as-side-ft"><button class="as-link" data-act="as-rollback" data-id="' + h.esc(a.id) + '|' + h.esc(r.traceId) + '|' + r.no + '">回滚这一轮</button></div>' : '')
        : (r.writes.length && !rolled ? '<div class="as-side-ft"><button class="as-link" data-act="as-rollback" data-id="' + h.esc(a.id) + '|' + h.esc(r.traceId) + '|' + r.no + '">回滚这一轮</button></div>' : '')) +
      '</div>';
  }
  function pendingPanel(a, se, h) {
    var items = [];
    try {
      var q = global.APP_DATA.getQueues();
      (q.compliance && q.compliance.items || []).forEach(function (it) {
        if (it.agentId !== a.id || store().decidedOf(it.id)) return;
        items.push({ id: it.id, title: it.summary, rule: it.rule, level: it.level, traceId: it.traceId, waitMin: it.waitMin });
      });
    } catch (e) { }
    return '<div class="as-side-p"><div class="as-side-hd">待处理' +
      (items.length ? '<span class="as-cnt">' + items.length + '</span>' : '<span class="grow"></span><span class="muted">没有</span>') + '</div>' +
      '<div class="as-side-b">' + (items.length ? items.map(function (it) {
        return '<div class="as-pend"><div class="as-pend-hd">' + h.pill(it.level === 'P0' ? 'bad' : 'warn', it.level) + '<span>' + h.esc(it.title) + '</span></div>' +
          '<div class="as-pend-sub">规则 ' + h.esc(it.rule) + (it.waitMin != null ? ' · 已等 ' + h.fmt.int(it.waitMin) + ' 分钟' : '') + '</div>' +
          '<div class="as-pend-ft"><button class="as-link" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|approve">批准并继续</button>' +
          '<button class="as-link muted" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|reject">驳回</button></div></div>';
      }).join('') : '<div class="as-side-empty">没有需要你拍板的高危动作</div>') + '</div></div>';
  }
  /* v44：**审批卡搬进消息流**（业主：与 dsh 一模一样）。
     dsh 的审批不是右栏面板，而是流里的卡片（ui-chat/ApprovalCommand.tsx + ui-approval 包）：
     一条消息之后直接出现「需要你批准」的卡片，就地批准/拒绝，不离开对话。
     本原型原来把它做成右栏的「待处理」块 —— 右栏收起后就看不见了（业主会以为丢了）。
     现在同一条数据在**流末尾**渲染成卡片；右栏那份保留（点「右栏」仍能看到汇总）。 */
  function approvalInline(a, se, h) {
    /* 数据源与右栏原来的聚焦卡**同一个**（pendingItemsOf）：合规待办 + 不可重试失败的轮次。
       这样"待处置"只有一处定义，不会两处各推一遍而漂。 */
    var items = pendingItemsOf(a, se);
    if (!items.length) return '';
    return items.map(function (it) {
      return '<div class="as-approval">' +
        '<div class="as-approval-hd">' + h.pill(it.level === 'P0' ? 'bad' : 'warn', it.level) +
        '<span>需要你拍板</span>' +
        (it.waitMin != null ? '<span class="as-approval-wait">已等 ' + h.fmt.int(it.waitMin) + ' 分钟</span>' : '') + '</div>' +
        '<div class="as-approval-title">' + h.esc(it.title || it.summary) + '</div>' +
        '<div class="as-approval-sub">规则 ' + h.esc(it.rule) + '</div>' +
        '<div class="as-approval-ft">' +
        '<button class="as-approval-btn primary" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|approve">批准并继续</button>' +
        '<button class="as-approval-btn" data-act="as-decide" data-id="' + h.esc(a.id) + '|' + h.esc(it.id) + '|reject">驳回</button>' +
        '</div></div>';
    }).join('');
  }

  /* v52：右栏补两块**真实**内容，把底部空白填满（业主：右栏再加点信息，铺满）。
     不是编的占位：
       · 用到的服务 —— 拓扑取自 F.AGENT_TOPO[a.id]（与「编排配置」同一份），
         元信息取自 S.MCP_SERVICES（读写声明在数据层），调用次数从本会话 rounds 的 actions 里数；
       · 最近处置 —— 来自 V10UI.auditList()（真实审计，按 target 含本 Agent 过滤）。
     两块都没有数据时返回空串，不留空壳。 */
  function svcPanel(a, se, h) {
    var topo = F.TOPO[F.AGENT_TOPO[a.id]] || [];
    var used = {};
    topo.forEach(function (n) { if (n.mcp && used[n.mcp] == null) used[n.mcp] = 0; });
    var ids = Object.keys(used);
    if (!ids.length) return '';
    (se.rounds || []).forEach(function (r) {
      (r.actions || []).forEach(function (x) { if (x.mcp && used[x.mcp] != null) used[x.mcp]++; });
    });
    var rows = S.MCP_SERVICES.filter(function (m) { return used[m.id] != null; });
    if (!rows.length) return '';
    return '<div class="as-side-p"><div class="as-side-hd">用到的服务<span class="as-cnt">' + rows.length + '</span>' +
      '<span class="grow"></span><span class="muted">与编排配置同一份拓扑</span></div>' +
      '<div class="as-side-b">' + rows.map(function (m) {
        return '<div class="as-kv"><span>' + h.esc(m.name) + '</span><b>' +
          (m.rw === 'write' ? '可写' : '只读') + ' · ' + used[m.id] + ' 次</b></div>';
      }).join('') + '</div></div>';
  }
  /* v52b：本会话用量（数字全部来自 se.rounds 的真实记录，不另造）。
     业主的窗口右栏可用 ~913，前面几块合计 739，底部还剩一截 —— 这块补的就是那截。 */
  function usagePanel(a, se, h) {
    var rs = se.rounds || [];
    if (!rs.length) return '';
    var acts = 0, tok = 0, ms = 0;
    rs.forEach(function (r) {
      acts += (r.actions || []).length;
      tok += (r.tokens || 0);
      ms += (r.latencyMs || 0);
    });
    var avg = Math.round(ms / rs.length);
    return '<div class="as-side-p"><div class="as-side-hd">本会话用量' +
      '<span class="grow"></span><span class="muted">来自真实调用记录</span></div>' +
      /* v52c：三项并作一行 —— 竖排三行会让右栏总高 992，超出业主窗口的 913；
         一行只占 27px，右栏收在 925 左右，正好贴着满。 */
      '<div class="as-side-b"><div class="as-one">' +
      rs.length + ' 轮 · ' + acts + ' 个动作 · ' + h.fmt.int(tok) + ' token · 平均 ' + durCn(avg) +
      '</div></div></div>';
  }

  function auditPanel(a, h) {
    var list = [];
    try { list = (global.V10UI && global.V10UI.auditList) ? global.V10UI.auditList() : []; } catch (e) { }
    var mine = list.filter(function (x) { return x && x.target && String(x.target).indexOf(a.id) >= 0; });
    mine = mine.slice(-3).reverse();
    if (!mine.length) return '';
    return '<div class="as-side-p"><div class="as-side-hd">最近处置<span class="as-cnt">' + mine.length + '</span>' +
      '<span class="grow"></span><span class="muted">来自审计</span></div>' +
      '<div class="as-side-b">' + mine.map(function (x) {
        var t = String(x.at || '');
        var hhmm = t.length >= 16 ? t.slice(5, 10) + ' ' + t.slice(11, 16) : t;
        return '<div class="as-hint-i"><span class="as-hint-r">' + h.esc(hhmm) + '</span>' +
          '<span>' + h.esc(x.action || '') + '</span>' +
          (x.actor ? '<i>' + h.esc(x.actor) + '</i>' : '') + '</div>';
      }).join('') + '</div></div>';
  }

  function hintPanel(a, se, h) {
    var hs = se.hints.slice().reverse();
    /* v47：0 条时**只留标题行**，不再渲染那句 60 字的空态说明 —— 那条说明单独占 95px，
       在 1600×1000 下正好把右栏顶出可视区（需滚 59px）。引导语挪进标题的 title。 */
    var head = '<div class="as-side-hd">你的提示<span class="as-cnt">' + hs.length + '</span>' +
      (hs.length ? '' : '<span class="grow"></span><span class="muted" title="下面的输入框写的每一句都会记在这里，并影响后续轮次">在下方输入框写</span>') + '</div>';
    if (!hs.length) return '<div class="as-side-p">' + head + '</div>';
    return '<div class="as-side-p">' + head +
      '<div class="as-side-b">' + hs.map(function (hn) {
        return '<div class="as-hint-i"><span class="as-hint-r">第 ' + hn.afterRound + ' 轮后</span><span>' + h.esc(hn.text) + '</span>' +
          '<i>从第 ' + (hn.afterRound + 1) + ' 轮起生效</i></div>';
      }).join('') + '</div></div>';
  }


  /* 本轮改动（差异）：单个改动**直接显示、不提供展开**；多个改动给增/删数量，展开后按类型各一行；
     折叠前保留 9 行（tool README:82）。改动的内容来自真实写动作，不编 diff 内容。 */
  function diffRows(a, se, h, st, r) {
    /* writes 有两种形状：历史轮次给的是动作对象，实时轮次给的是节点 id —— 都要吃 */
    var writes = (r.writes || []).map(function (w) {
      if (w && typeof w === 'object') return { id: w.id || w.name, name: w.name, mcp: w.mcp || null, ms: (w.ms == null ? null : w.ms) };
      var x = (r.actions || []).filter(function (y) { return y.id === w || y.name === w; })[0];
      return { id: w, name: (x && x.name) || String(w), mcp: (x && x.mcp) || null, ms: (x && x.ms != null ? x.ms : null) };
    });
    if (!writes.length) return '<div class="as-side-empty">这一轮没有写动作</div>';
    var folded = !st.diffOpen;
    var note = '<div class="as-dl-note">仅列写动作名，无 diff 正文</div>';
    var show = folded ? writes.slice(0, 9) : writes;
    return note + show.map(function (w) {
      return '<div class="as-dl"><span class="as-dl-p">+</span><span class="as-dl-t">' + h.esc(w.name) + '</span>' +
        '<i>' + h.esc(w.mcp || '写动作') + (w.ms != null ? ' · ' + w.ms + 'ms' : '') + '</i></div>';
    }).join('') +
      (writes.length > 9
        ? '<button class="as-link" data-act="as-diff-open" data-id="' + h.esc(a.id) + '" aria-label="' + (folded ? '展开其余 ' + (writes.length - 9) + ' 行差异' : '收起差异') + '">' +
          (folded ? '展开其余 ' + (writes.length - 9) + ' 行差异' : '收起差异') + '</button>'
        : '') +
      (writes.length === 1 ? '<div class="as-dl-note">单个改动直接显示，不提供展开（chat README:166）</div>' : '');
  }

  /* ---------------- 本次会话的追加轮（由会话引擎的事件日志驱动） ----------------
     ⚠ 用户要求**删掉「本次会话」实时段**（那一段是独立外壳 .as-live，行距/计数/裁切都坏）。
     删的是**外壳**，不是数据能力：引擎（v28）、事件流、pumpEngine、真时钟测得的节点耗时、
     引导真的改后续计划（plan/patch）全部原样保留。
     追加轮现在**落进正常轮次列表末尾**（与历史轮同一套 .as-round / processRow / groupSeat 渲染），
     所以"发一条 → 末尾长出一轮""连发递增""刷新仍在"三条都还成立，且不再有两套行实现。
     每一轮都能点回它的调用记录：历史轮的通到真实 traceId，本次会话轮的通到会话事件流
     （as-live-trace → 轨迹屏按轮号定位）。 */
  /* 时间戳文案（HH:MM）：本次会话轮的用户气泡用它与历史轮的 .as-when 保持同形 */
  function hhmmCn(ts) {
    var t = Number(ts);
    if (!t) return '';
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /* 把引擎的一轮折成"轮次对象"——字段与 SESSION_STORE 的历史轮同名同义，
     于是 roundBlock()/actsBlock()/processRow()/roundFoot() 一套渲染器直接吃。 */
  function liveRoundObj(t, v) {
    var inp = null;
    (v.inputs || []).forEach(function (x) { if (x.id === t.userId) inp = x; });
    var actions = (t.nodes || []).map(function (n) {
      return { kind: n.kind, name: n.name, ms: n.ms, status: n.status,
        mcp: n.mcp || null, model: n.model || null,
        label: n.kind === 'llm' ? '已生成' : (n.kind === 'guard' ? '已执行合规检查' : '已调用工具'),
        detail: n.mcp || (n.model ? '模型 ' + n.model : ''), write: n.rw === 'write', error: null };
    });
    var running = t.status === 'running';
    return {
      no: t.no, live: true,
      /* 本次会话轮没有真实调用记录，但仍要给一个**稳定的**轮次标识：
         openCalls / openTurnProcess / openGroups 这些交互态都按轮次标识做键，
         用引擎的 traceId（追加轮起手是 null，之后才会补）会让"点开一次调用"绑不上。
         前缀 live- 与真实 traceId（tr-…）在形状上可分，界面文案另行写明来源。 */
      traceId: 'live-' + t.no,
      runId: t.no,
      when: hhmmCn((inp && inp.at) || t.startedAt),
      user: (inp && inp.text) || '(本次会话的输入未留在日志里)',
      assistant: '',
      intentName: t.intentName || '—', segmentName: null, callerName: '本次会话',
      status: running ? 'running' : (t.status === 'killed' ? 'killed' : (t.status === 'failed' ? 'failed' : 'success')),
      errName: t.status === 'failed' ? '失败' : null,
      latencyMs: t.ms == null ? null : t.ms, tokens: 0, cost: 0,
      actions: actions, writes: (t.writes || []).map(function (w) {
        var x = actions.filter(function (y) { return y.name === w; })[0];
        return x || { name: String(w), mcp: null, ms: null };
      }),
      needHuman: false, rolled: false, hints: [],
      /* plan/patch：你的引导让哪些写动作这一轮不执行（真事件，不是标注） */
      patch: t.patch || null
    };
  }
  /* 本次会话里**真正追加出来的**那些轮（渲染成与历史轮同一套 .as-round，落在列表末尾）。 */
  function liveRounds(se) {
    var E = global.SESSION_ENGINE; if (!E) return [];
    var v = E.view(); if (!v || !v.turns) return [];
    /* 只渲染**真正追加出来的**轮次：open({history:N}) 播进来的那几轮在引擎里也带 live:true
       （它们同样来自事件日志），但界面已经有它们了（store 的历史轮），渲出来就是重复。
       ⚠ 两个都不成立的判重法（都实测过）：
         a) 按**轮号**去重 —— 轮号在两条真相源里都从 1 开始数，用户新加的那一轮很可能正好
            撞上 store 里的某个轮号，于是追加轮一个都不出现；
         b) 按 **traceId** 去重 —— 同一个 Agent 的同一条意图会被重新跑，真实调用记录里就有
            重复 traceId，于是"追加轮"会被当成历史轮吃掉（实测：追加轮一个都不出现）。
       用引擎自己记的"播进来几轮"（st.historyOpened）：live 轮的前 N 条就是那批历史轮，
       之后一律是追加轮 —— 对两条真相源的轮数差免疫，也不受 traceId 重复影响。
       旧状态（改动前写进 localStorage 的）没有这个字段，退回 "store 轮数" 兜底。 */
    var histOpened = -1;
    try { histOpened = (E.historyOpened && E.historyOpened() >= 0) ? E.historyOpened() : -1; } catch (e) { }
    if (!(histOpened >= 0)) histOpened = (se.rounds || []).length;
    return v.turns.filter(function (t) { return t.live; }).slice(histOpened)
      .map(function (t) { return liveRoundObj(t, v); });
  }
  /* 「本次会话」控制条——**不是**那段被删掉的实时段：
     它只有一行，钉在正文列之外的底部座位里（不滚走、不覆盖正文），承载
     ① 数据口径（事件日志驱动 / 节点耗时是真时钟测量值）
     ② 状态点（运行中脉冲）
     ③ 停止按钮（会真的把在跑的节点标成已取消并写 job/kill 事件）
     ④ 待生效的引导（本地回显，落定后原子消失——权威记录以日志为准）。 */
  /* 契约 4：这一条现在挂在 .as-c-dock 里、class 由 .as-live-bar 改为 .as-c-live，
     并且和原 .as-feed-col 内那条会话状态行（sessStatStrip）**合并成一条**——
     口径（事件日志驱动 / 节点耗时 / N 条事件 / 状态）、停止按钮（as-stop）
     以及统计（N 轮 M 步 · token · tok/s · 上下文占用 · 缓存命中）一个数都没丢。 */
  function liveControlBar(a, h, st, se) {
    var E = global.SESSION_ENGINE;
    var v = E ? E.view() : null;
    var stat = (se && h) ? sessStatStrip(se, h) : '';
    var inner = '';
    if (v) {
      var act = v.active;
      var pending = v.steerings.filter(function (x) { return x.state === 'accepted' || x.state === 'claimed'; });
      var live = v.turns.filter(function (t) { return t.live; });
      if (live.length || act || pending.length) {
        var running = v.status === 'running';
        /* v44：口径说明不再**占一行**（dsh 底部只有一行读数）。「事件日志驱动 / 节点耗时是
           真时钟测量值 / N 条事件 / 状态」全部搬进那颗运行点的 title —— 该说的一个没少，
           但不再把 dsh 的一行挤成两行。数字部分交给下面的 sessStatStrip（轮·步·tok·tok/s·占用·缓存）。 */
        inner = '<span class="as-run-dot' + (running ? ' run' : '') + '" title="本次会话 · 事件日志驱动 · 节点耗时是真时钟测量值 · ' +
          E.log().length + ' 条事件 · 状态 ' + h.esc(v.status) + '"></span>' +
          '<span class="grow"></span>' +
          (pending.length ? '<span class="muted">待生效引导 ' + pending.length + ' 条</span>' : '');
        if (act && running) {
          inner += '<button class="as-stop' + (st.killArmed && (Date.now() - st.killArmed < 3000) ? ' armed' : '') +
            '" data-act="as-stop" data-id="' + h.esc(a.id) + '">停止</button>';
        }
      }
    }
    if (!inner && !stat) return '';
    /* pill 们不做 .as-c-live 包装 —— 它们要作为 .as-c-dock 这一行里的**独立子项**
       （dsh：activity / usage / ContextMeter 是 dock 的三个并列 entry）。 */
    return (inner ? '<div class="as-c-live">' + inner + '</div>' : '') + stat;
  }
  /* v47：口径条的折叠开关（点标题切换）。用 document 级委托，因为 meta-bar 是通用组件渲染的，
     它自己的 h3 上没有 data-act —— 不去改那个通用件，只在本屏包一层壳。 */
  function bindMetaCollapse() {
    var doc = global.document;
    if (!doc || !doc.addEventListener || global.__asMetaBound) return;
    global.__asMetaBound = true;
    doc.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var hd = t.closest('.as-meta-collapse > .meta-bar > .meta-bar-h');
      if (!hd) return;
      var st = __asUI;
      if (!st) return;
      st.metaOpen = !st.metaOpen;
      var hh = global.__asKeysH;
      if (hh) refresh(hh);
    });
  }

  function installKeys(h) {
    global.__asKeysH = h;
    if (global.__asKeysDone) return;
    global.__asKeysDone = true;
    var doc = global.document;
    if (!doc || !doc.addEventListener) return;
    doc.addEventListener('keydown', function (e) {
      var hh = global.__asKeysH, s = (hh && hh.state) || {};
      if (s.cap !== 'agent-wb' || s.tab !== 'session') return;
      var a = S.AGENTS[S.idx.agent[s.agentId]]; if (!a) return;
      var A2 = global.ACTIONS;
      var isTa = e.target && String(e.target.tagName || '').toUpperCase() === 'TEXTAREA';
      /* DSH keymap.ts：Shift+Enter 是换行，**不提交**（放行给浏览器默认行为） */
      if (e.key === 'Enter' && e.shiftKey) return;
      /* DSH keymap.ts 的 IME 守卫：合成中的 Enter 不得提交/裁决。三条信号全查——
         KeyboardEvent.isComposing（多数引擎）、legacy keyCode 229、以及本原型 composer 采到的
         st.composing + compositionend 后 10ms 窗口（Safari 的补发 Enter 落在这个窗口里）。
         不加这道守卫，中文输入法按 Enter 选字会被当成「发送」。 */
      if (e.key === 'Enter' && isTa) {
        var stIme = __asUI || {};
        if (e.isComposing || e.keyCode === 229 || stIme.composing
          || (global.__asComposeEndAt && (Date.now() - global.__asComposeEndAt) < 10)) return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isTa && !String(e.target.value || '').trim()) {
        /* 空草稿 + 修饰键 = 整队插话（DSH：Cmd/Ctrl+Enter 插话发送全部排队消息） */
        var E0 = global.SESSION_ENGINE, v0 = E0 && E0.view();
        if (v0 && v0.queue.length) {
          if (e.preventDefault) e.preventDefault();
          v0.queue.map(function (q) { return q.id; }).forEach(function (qid) { E0.promoteQueued(qid); });
          hh.toast('已把 ' + v0.queue.length + ' 条排队消息整队改为插话（下一轮生效）', 'ok');
          A2['as-sub'](a.id + '|chat', null, hh);
        }
        return;
      }
      if (e.key === 'Enter' && isTa) {
        var E = global.SESSION_ENGINE;
        var delivery = (E && E.view()) ? E.view().delivery : 'steer';
        var mode = (e.metaKey || e.ctrlKey) ? (delivery === 'queue' ? 'steer' : 'queue') : delivery;
        if (e.preventDefault) e.preventDefault();
        A2['as-hint'](a.id, e.target, hh, mode);
        return;
      }
      if (e.key === 'Escape') {
        /* DSH keymap.ts：Escape 是**分层**的——先关掉打开的浮层，这一下不计入停止序列。
           （源码注释原文 "Escape layering: an open overlay closes first"） */
        var stOv = __asUI || {};
        if (stOv.dmOpen || stOv.jobOpen || stOv.diffOpen) {
          stOv.dmOpen = false; stOv.jobOpen = null; stOv.diffOpen = false;
          global.__asEscAt = 0;
          if (e.preventDefault) e.preventDefault();
          refresh(hh);   /* v37：同上，保留阅读位置 */
          return;
        }
        var now = Date.now();
        var dbl = global.__asEscAt && (now - global.__asEscAt) < 500;   /* DSH：500ms 内两次 */
        global.__asEscAt = dbl ? 0 : now;
        if (dbl) A2['as-stop'](a.id, null, hh);                         /* 单击 Esc 不停（DSH 同），二击才停 */
      }
    });
    /* IME 合成状态改挂**文档级捕获**：composer 每次重渲染都会换掉 textarea 节点，
       挂在节点上的 compositionend 会随节点一起丢，导致 10ms 窗口永远不被写入。
       DSH keymap.ts 也是在编辑器根上做 composition watch，同理只认「合成这件事」而不是「某个节点」。 */
    doc.addEventListener('compositionstart', function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest('.as-c-box')) return;
      var s2 = __asUI; if (s2) s2.composing = true;
    }, true);
    doc.addEventListener('compositionend', function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest('.as-c-box')) return;
      var s2 = __asUI; if (s2) s2.composing = false;
      global.__asComposeEndAt = Date.now();
    }, true);
    /* ── composer 草稿入 state（2026-10-16 交互对齐：补上 dsh 编辑器的最小闭环）────────────
       改前：textarea 的输入**从未写进 st.instr**（app.js 的 data-f 绑定只认 select/input，不认
       textarea），而 slashMenu / atMenu / 占位符显隐 / 草稿保留**全读 st.instr**，于是四个后果：
         ① 「/」指令菜单永远打不开；② 「@」引用菜单永远打不开；
         ③ 任何重渲染都把已输入的文字抹掉（textarea 的值来自恒空的 st.instr）；
         ④ 占位符永远显示，和已输入的文字重叠。
       现在把草稿镜像进 st.instr（重渲染时 textarea 自然带出草稿，不再被抹）。
       ⚠ **只有菜单开关条件翻转时才重渲染** —— 否则每敲一字整屏重渲染会把 textarea 节点换掉、
       光标丢到末尾；占位符显隐也不等重渲染，直接切 style。 */
    var __asMenuSig = '';
    doc.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest('.as-c-box')) return;
      if (String(t.tagName || '').toUpperCase() !== 'TEXTAREA') return;
      var s2 = __asUI; if (!s2) return;
      var v = String(t.value || '');
      if (s2.instr === v) return;
      s2.instr = v;
      var box = t.closest('.as-c-box');
      var ph = box && box.querySelector('[data-composer-placeholder]');
      if (ph) ph.style.display = (v || s2.composing) ? 'none' : '';
      /* 菜单签名与 slashMenu()/atMenu() 的正则逐字一致：/^\/([a-z]*)$/i 与 /@([^@\s]*)$/ */
      var sig = (/^\/([a-z]*)$/i.test(v.trim()) ? 's' : '') + (/@([^@\s]*)$/.test(v) ? 'a' : '');
      if (sig !== __asMenuSig) {
        __asMenuSig = sig;
        var hh2 = global.__asKeysH;
        if (hh2 && hh2.navigate) refresh(hh2);   /* v37：菜单开合不该把人顶回顶部 */
      }
      /* 输入框随内容增高（dsh：.input 是 normal flow 的内容编辑面，"sets the draft's height"；
         原型 textarea 不会自己长，手动同步。上限与 .as-scroll 的 max-height:336px 对齐） */
      t.style.height = 'auto';
      t.style.height = Math.min(t.scrollHeight, 336) + 'px';
    });
  }

  /** 引擎的时钟：跑起来并把界面刷新挂上（离开会话页就自动停） */
  function pumpEngine(a, state, h) {
    var E = global.SESSION_ENGINE; if (!E) return;
    E.open(a, { history: 3 });
    global.__asPump = function () {
      var s = h.state || {};
      if (s.cap !== 'agent-wb' || s.tab !== 'session' || s.agentId !== a.id) { E.stop(); return; }
      E.tick();
      refresh(h);   /* v37：原来直接 navigate，每拍都把阅读位置清成 0 */
    };
    installKeys(h);
    bindGrip(h);
    try { bindComposer(global.document.querySelector('.as-c-box textarea')); } catch (e) { }
    /* Esc：把时间轴的缩放/框选复位（dsh TrajectoryTimeline 的 Escape 处理） */
    if (!global.__asEscTraj) {
      global.__asEscTraj = true;
      global.document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !global.__asH) return;
        try {
          var hh = global.__asH, ag = agentOf(String((hh.state || {}).agentId || ''));
          if (!ag) return;
          var ss = sessUI(hh.state, ag);
          if (!ss.tgZoom && !ss.tgSel) return;
          ss.tgZoom = null; ss.tgSel = null; refresh(hh);
        } catch (err) { }
      });
    }
    global.__asH = h;
    bindComposerReserve();
    /* v37：sessionTab 只返回字符串，此刻 DOM 还没挂上 —— 直接绑会 querySelector 落空
       （bindFollow 就是这样一直没生效）。推到下一帧，等节点真的在文档里再绑。 */
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(function () {
        try { bindFollow(h); } catch (e) { }
        try { bindMetaCollapse(); } catch (e) { }
        try { bindTrajSearch(h); } catch (e) { }
        try { bindTrajStage(h); } catch (e) { }
      });
    } else { try { bindFollow(h); } catch (e) { } bindMetaCollapse(); try { bindTrajSearch(h); } catch (e) { } try { bindTrajStage(h); } catch (e) { } }
    E.start(E.STEP_MS);
  }

  /* 输入条预留高度：把 `.as-composer` 的实测高度写回 --as-composer-h，
     正文列（.as-feed-col）用它做 padding-bottom —— 输入条的**自然位置**因此落在
     正文之后，sticky 浮起时不再压住正文（缺陷 5 的直接修法，见 HTML 里 .as-feed-col 的注释）。
     用 ResizeObserver 跟住高度变化（草稿变长、窗口变窄都会改高度）。 */
  function bindComposerReserve() {
    var doc = global.document;
    if (!doc || !doc.querySelector) return;
    var apply = function () {
      try {
        var c = doc.querySelector('.as-composer');
        var col = doc.querySelector('.as-feed-col');
        if (!c || !col || !c.getBoundingClientRect) return;
        var hgt = Math.round(c.getBoundingClientRect().height) || 0;
        if (hgt > 0) col.style.setProperty('--as-composer-h', hgt + 'px');
      } catch (e) { }
    };
    apply();
    try {
      global.__asComposerRO && global.__asComposerRO.disconnect && global.__asComposerRO.disconnect();
      var c = doc.querySelector('.as-composer');
      if (c && global.ResizeObserver) {
        global.__asComposerRO = new global.ResizeObserver(apply);
        global.__asComposerRO.observe(c);
      }
    } catch (e) { }
  }

  /* 状态药丸 + 两个强干预入口（暂停 / 接管）。
     改前它们在 .as-tabs 一行的右侧，与「历史 N 轮 · 中途引导 N 条」和展示模式控件挤在同一行；
     现在抽成函数，同一处调用，语义不变 —— 只是它不再与页尾那条口径条重复。 */
  function statusPills(a, se, h, st) {
    var E = global.SESSION_ENGINE, v = E && E.view();
    var stt = v ? v.status : se.status;
    /* v45：待办卡搬进消息流后，右栏顶部留一个**入口**（不是第二张卡）：
       有 N 件待办时点它直接滚到流末尾那张卡。否则「1 件事等你点头」在长会话里根本看不见。 */
    var nPend = 0;
    try { nPend = pendingItemsOf(a, se).length; } catch (e) { nPend = 0; }
    return '<span class="as-status">' +
      (stt === 'paused' ? h.pill('warn', '已停止') : (stt === 'takenOver' ? h.pill('info', '已接管 · 人工处理') : h.pill('ok', 'Agent 执行中'))) +
      (nPend ? '<button class="as-link" data-act="as-goto-approval" data-id="' + h.esc(a.id) + '" title="滚到对话里的审批卡">' +
        nPend + ' 件事等你点头 →</button>' : '') +
      '<span class="muted">历史 ' + se.rounds.length + ' 轮 · 中途引导 ' + se.hints.length + ' 条</span>' +
      '<button class="as-link" data-act="as-pause" data-id="' + h.esc(a.id) + '">暂停</button>' +
      '<button class="as-link muted" data-act="as-takeover" data-id="' + h.esc(a.id) + '">接管</button></span>';
  }

  /* ---------------- Tab 主体 ---------------- */
  function sessionTab(a, ai, state, h) {
    var SS = store();
    if (!SS) return '<div class="empty"><div class="empty-title">会话存储未加载</div></div>';
    var se = SS.current(a.id);
    if (!se) return h.emptyFor('取不到这个 Agent 的会话', '先看「运行监控」', 'trace');
    /* 两个 metaBar 合一：给外壳一个标记，让它别再叠一条（见文件末尾 suppressOuterMeta）。
       标在 state 上而不是 h 上 —— state 是本次渲染链上同一个对象，外壳包装器读得到。 */
    if (state) state.asMetaMerged = 1;
    var st = sessUI(state, a);
    __asUI = st;
    var _sw = sideWidth(st, h);
    /* v45：右栏不再重复渲染「待处理」—— 它已经搬到消息流末尾的审批卡里（approvalInline）。
       两处同时出现同一张 P2 卡，读起来像系统重复计了一次。右栏保留：执行状态 / Agent 说明 /
       口径与说明 / 你的提示（这些 dsh 没有，是本原型的业务件）。 */
    var side = changePanel(a, se, h, st) + hintPanel(a, se, h) + svcPanel(a, se, h) + usagePanel(a, se, h) + auditPanel(a, h);
    var dm = (global.SESSION_ENGINE && global.SESSION_ENGINE.view()) ? global.SESSION_ENGINE.view().displayMode : 'standard';
    pumpEngine(a, state, h);
    /* .as-view 是 DSH 令牌（--d-*）的作用域：变量只在这一屏生效，不动设计稿既有变量 */
    /* ⚠ 纯前端约束：**没有**内嵌 dsh web 服务这条路（原 st.sub='live' 分支已整体删除，见 R33）。
       头部 head 见下面构造 —— 它对「对话 / 轨迹」两个子视图是**常驻件**（dsh：ConversationSession.tsx
       注明 header 是 "inserted into the resident conversation layout"、`.tabs`(role=tablist) 就在 header 内部），
       所以轨迹视图**不再自己拼一个裸 .as-tabs**，改成与对话视图共用同一条 head，只换 head 之下的 body。 */
    /* 头部：会话标题 + 展示模式单控件（真实 DSH 是「agent 工作台 2 个子智能体 ⌄  ⊙ 标准模式」，在页签行**上方**） */
    var dmLabel = ({ compact: '简洁模式', standard: '标准模式', detailed: '详细模式', verbose: '完全展开' })[dm] || '标准模式';
    /* 头部（真实 DSH：agent 工作台 · 2 个子智能体 ⌄ · ⊙ 标准模式）。本原型没有子智能体数据 → 如实标注，不编数字。
       契约 1：header 合成一条 —— 标题行内容包进新增的 .as-hd-h，页签条 .as-tabs 从 .as-hd 的
       兄弟位置移进 .as-hd 内部（DOM 顺序：标题行 → .as-tabs），整块就是真 dsh 的 76px header
       （标题行 + 对话/轨迹 标签条）。.as-tabs 的 class 与内部结构不改。
       2026-10-17：**身份与动作撤出 .as-hd** —— 四页签统一走 agentDetail 的旧页头结构
       （backRow + page-head + verBar，用户要求"这页没改"），.as-hd-h 里那套（返回键/名字/
       灰度态/版本胶囊/时间范围/预检/提交发布）与上层 page-head + verBar **完全重复**。
       现在只留：展示模式 + 右栏开关 + 对话/轨迹页签。 */
    var head = '<div class="as-hd">' +
      '<div class="as-tabs">' + tabs(a, st, h) + '</div>' +
      /* v37：右栏开关回到页签行**同一行的右侧**（不新增一行 —— 上一版就是因为多出一行孤零零的
         控件被撤掉的）。窄屏默认收起右栏，没有这个开关就没法把它叫回来；宽屏也照 DSH 允许收起。
         位置用绝对定位钉在 .as-hd 右上，页签条怎么变都不会把它挤走。
         v40：轨迹视图不渲染它 —— 轨迹屏已经没有右栏（见下面 traj 分支的注释），
         留一个点了没反应的开关比没有更糟。 */
      (st.sub === 'traj' ? '' :
      '<button type="button" class="as-sidebtn' + (st.sideOpen === false ? '' : ' is-on') + '"' +
        ' data-act="as-side-toggle" data-id="' + h.esc(a.id) + '"' +
        ' aria-pressed="' + (st.sideOpen === false ? 'false' : 'true') + '"' +
        ' title="' + (st.sideOpen === false ? '显示右栏（说明 / 口径 / 待你点头）' : '收起右栏，让正文更宽') + '">' +
        '<span class="as-sidebtn-ico" aria-hidden="true"></span>右栏</button>') +
      '</div>';                      /* /.as-hd = 页签条 + 右栏开关；
                                        身份/动作仍在 page-head/verBar 一层 */
    /* 轨迹子视图：与对话视图共用同一条 head（dsh 的 header 是常驻件，不属于子视图），只换 body。
       2026-10-17：composer 也改成**常驻件** —— dsh 的 ConversationRoot.module.css:401-434 把
       .scrollBody 与 .composerSeat **分家**（composer 在滚动体之外、sticky 底部），切「对话/轨迹」
       只换 scrollport 内容，输入条不动。改前轨迹页完全没有输入框（实测 composer/textarea/.as-c-box 全 0）。 */
    /* 轨迹子视图：**与对话视图同一套三列网格**（.as-body：内容 | 把手 | 右栏），composer 在网格外。
       2026-10-17 修页 bug：改前 trajView / .as-side / composer 是 .as-view（flex 列）的直接子级
       竖着堆叠 —— .trajviews-root 的 height:100% 在内容驱动的父高下解析为 0，**整块轨迹内容
       高度归零不可见**（63 条甘特条都在 DOM 里），只剩右栏卡片挤在左边一条（用户截图即此）。
       加 .as-body--traj：flex:1 + grid-template-rows:minmax(0,1fr) 让轨迹列拿到确定高度。 */
    var dmLabel = ({ compact: '简洁模式', standard: '标准模式', detailed: '详细模式', verbose: '完全展开' })[dm] || '标准模式'; /* 保留：as-mode-hd 的菜单数据仍被展示模式设置引用 */
    /* v40：轨迹视图**不再带右栏**（业主：轨迹异常）。依据是 dsh 自己的 TrajectoryView.tsx——
       渲染结构只有 `.root > Toolbar + Timeline + .ledger > TrajectoryTable`，
       全文件没有 aside / detail / panel 任何一个容器（grep 过），也就是说轨迹屏在 dsh 里
       是**全宽账本**。本原型把会话右栏（待处理/你的指令/口径）搬进了轨迹屏，代价是
       表格列被压到 359px、内容行横向溢出到右栏底下（业主截图即此）。
       顺带：轨迹屏的「↓ 回到底部」也一并去掉（那是会话流的滚动归属按钮，
       轨迹屏没有 .as-feed-col，点了没有落点）。 */
    if (st.sub === 'traj') return '<div class="as-view">' + head +
      '<div class="as-body as-body--traj">' + trajView(a, se, h, st) + '</div>' +
      '</div>';
    /* 口径条：**两个 metaBar 合一**。
       改前这一屏有两份口径 —— 本页签自己的 footerMeta（6 项口径 + 9 项权限）叠在
       agentDetail 外壳的 metaBar（统计范围 + 当前 Agent + 今日实况）之上；
       它们说的是同一件事（这份数字从哪来、你能不能动手）。
       现在合成一条：本页签只出**只属于会话**的两项（数据口径 / 干预权限），
       外壳那条由 v27 的 suppressOuterMeta 摘掉（见文件末尾），
       而「统计范围 / 当前 Agent / 今日实况」的三项按口径原样挂在输入行下方。
       ⚠ 契约 3：口径条（.meta-bar）已从 .as-feed 内（原 tailHtml）移出，改挂到右栏里 —— 它属于
       「这份数字从哪来、你能不能动手」的元信息，与右栏三张卡同处一列，不再挤占会话流。 */
    var _rm = (Q && Q.resolveRange ? Q.resolveRange(String(state.range || '24h')).meta : null);
    /* v47：**口径条默认折叠**（业主：下面一片空白、还有信息但必须滚动才能看，占一屏）。
       实测右栏内容 917px / 视口 432px —— 其中「数据口径与说明」一条就占 **461px**（meta-list 6 行），
       等于把右栏撑成一屏半。折叠后右栏总高 ≈ 439px，一屏就能读完，不用滚。
       数据一行没删，点标题展开（状态存 st.metaOpen，逐 Agent 独立）。 */
    var footerMetaRaw = h.metaBar({ range: _rm, agent: a.id }, [
      { k: '数据口径', v: SS.DATA_NOTE },
      { k: '干预权限', v: '中途引导/暂停需 agent:intervene；调整权限预设需 agent:session:autonomy；接管需 agent:takeover；回滚本轮需 agent:round:rollback；批准高危需 agent:approve' }
    ]);
    /* v48：**默认展开** —— 上一版默认折叠，业主立刻发现「下面还有信息，就是不显示」。
       折叠态保留（点标题还能收起来），但初值是展开：信息先全给人看。 */
    var metaOpen = (st.metaOpen === undefined) ? true : !!st.metaOpen;
    var footerMeta = '<div class="as-meta-collapse' + (metaOpen ? ' is-open' : '') + '">' + footerMetaRaw + '</div>';
    /* 契约 2/3：状态胶囊行（statusPills）+ 待处置聚焦卡（.as-focus）+ 页脚口径条（.meta-bar）
       一起从会话流让位，搬进右栏；右栏顺序冻结为 as-side-top → as-focus → meta-bar → as-side-p…。
       业务能力一个不丢：as-pause / as-takeover / as-decide / as-round-decide 等动作原样保留。 */
    /* v45：聚焦卡不再进右栏 —— 它和消息流末尾的审批卡（approvalInline）是同一批待办，
       两处同时出现读起来像重复计了一次。审批卡直接吃 pendingItemsOf 的同一份数据，
       所以右栏这条不再渲染（数据源没变，只是换了个位置显示）。 */
    var pend = pendingItemsOf(a, se);
    var focusCard = '';
    var sideChat = '<div class="as-side-top">' + statusPills(a, se, h, st) + '</div>' +
      focusCard +
      /* 契约 5：原 headCompact 里的「描述 + 业务线」随页头一起收编，落在这里（右栏分区）。
         dsh 的 header 只放标题/页签/动作，不放描述这类业务内容 —— 归右栏。 */
      '<div class="as-side-p"><div class="as-side-hd">Agent 说明</div><div class="as-side-b">' +
      '<div class="ph-desc slim">' + h.esc(a.desc) + '</div>' +
      '<div class="ph-tags"><span>' + h.esc(a.biz) + ' → ' + h.esc((S.BIZ_LINES[S.idx.biz[a.biz]] || {}).name || a.biz) + '</span></div>' +
      '</div></div>' +
      (footerMeta || '') + side;
    return '<div class="as-view">' + head +
      /* 三列：正文 | 拖拽条 | 右栏 —— 两列时第三个子元素会掉到第二行（真实渲染里右栏就是这么消失的） */
      /* 三列轨道（DSH ConversationRoot 的 .body 是 flex 行，右栏 flex:0 0 auto；
         本原型用 grid）。右栏轨道由 sideWidth() 算：基数是**会话列（容器）宽度**，
         并保证正文列 ≥ 源码 clamp 的下限 680px（ConversationRoot.module.css:384-387）。
         CSS 里 `.as-body` 还留了一条 minmax(300px,32%) 的静态兜底（内联样式缺席时生效）。 */
      '<div class="as-body" style="grid-template-columns:' + (st.sideOpen === false ? 'minmax(0,1fr)'
        : 'minmax(0,1fr) 10px ' + _sw + 'px') + '">' +
      '<div class="as-feed-col">' + chatView(a, se, h, st) + '</div>' +
      (st.sideOpen === false ? '' : '<div class="as-grip" data-grip="1" role="separator" aria-orientation="vertical" aria-label="拖动调整右栏宽度" tabindex="0"></div>') +
      (st.sideOpen === false ? '' : '<div class="as-side">' + sideChat + '</div>') + '</div>' +
      /* 输入条座位：在 .as-body（滚动口）**之外**，与它同为 .as-view 的 flex 子项。
         源码对应 ConversationRoot.module.css:401-434 的 .scrollBody / .composerSeat 分家。 */
      composerSeat(a, se, h, st) + '</div>';
  }

  /* ---------------- 注册 ---------------- */
  global.AGENT_TAB_RENDER = global.AGENT_TAB_RENDER || {};
  global.AGENT_TAB_RENDER.session = sessionTab;

  /* ── 画像详情 › 概览形态：**安装点**（见 renderers2.js 的 SECTION: v27b-persona-overview-shape）──
     为什么安装在这儿：personaDetail 的本体在 v10-detail-asset.js 赋值，而那个文件在主 HTML 里
     排在 renderers2.js **后面** —— renderers2 里当场包装会被 v10 随后一句赋值直接覆盖掉。
     本文件排在 v10 之后、app.js 之前，是"本体已就位、还没开始渲染"的唯一窗口。
     包装逻辑全在 renderers2.js（只动 personaPage 区段），这里只负责在对的时机调一次。 */
  try {
    if (global.V27B && typeof global.V27B.personaShape === 'function') global.V27B.personaShape();
  } catch (e) { /* 安装失败不回滚任何东西：画像详情退回本体渲染，不是白屏 */ }

  /* ── 两个 metaBar 合一（本文件负责的最后一刀）──────────────────────────
     现象：会话与干预屏实测 metaBar×2 —— 一条是本页签的（数据口径 + 干预权限 + meta 的
     统计范围/当前 Agent），另一条是 agentDetail 外壳的（统计范围 + 当前 Agent + 今日实况）。
     两条里「统计范围 / 当前 Agent」是同一份口径说了两遍，页尾读起来像两个叠起来的统计条。
     修法：把外壳那条摘掉，只留本页签这一条 —— 但**外壳的 3 项口径一个都不能丢**，
     所以先按字段把它们搬进本页签的 metaBar 里（见 sessionTab 的 footerMeta 上方注释与
     sessionTab 是唯一实现）。这里只做"摘掉重复的那一条"。
     ⚠ 位置约束：agentDetail 在 renderers.js（**本文件不许改**），所以只能在这儿包一层；
       包装器刻意放在 v23 的 exp 包装器之后（本文件在 v23 之后加载），于是它看到的是
       v23 最终的 agentDetail，两边不打架。 */
  (function suppressOuterMeta() {
    var R = global.RENDERERS;
    if (!R || typeof R.agentDetail !== 'function' || R.agentDetail.__v27meta) return;
    var raw = R.agentDetail;
    R.agentDetail = function (cap, state, h) {
      var html = raw.apply(this, arguments);
      if (!(state && state.asMetaMerged) || typeof html !== 'string') return html;
      /* 从**最外层**那一条 metaBar 起头切掉。两条 metaBar 都没有 id/类名可区分，
         所以按"谁是外层"判：块起始 <div> 之前紧跟的就是上一条 metaBar 的收口 ——
         正文里不会出现 `meta-bar">`，而两条 metaBar 一定相邻。
         找不到就原样返回 —— 宁可留两条，也不能把正文吃一半。 */
      var key = 'class="meta-bar"';
      var a = html.indexOf(key);
      if (a < 0) { key = 'class="meta-bar '; a = html.indexOf(key); }
      if (a < 0) return html;
      var b = html.indexOf(key, a + 1);
      var cut;
      if (b > 0) cut = html.lastIndexOf('<div', b);
      else cut = html.lastIndexOf('<div', a);
      return cut > 0 ? html.slice(0, cut) : html;
    };
    R.agentDetail.__v27meta = true;
  })();

  global.AGENT_SESSION = {
    bindComposer: bindComposer,
    MODES: MODES,
    /** 角标：待人工处置数（合规拦截 + 不可重试失败轮），没有就是 null */
    pendingCount: function (a) {
      try {
        var se = store().current(a.id), n = 0;
        se.rounds.forEach(function (r) { if (r.needHuman && !r.rolled) n++; });
        var q = global.APP_DATA.getQueues();
        n += (q.compliance && q.compliance.items || []).filter(function (x) { return x.agentId === a.id && !store().decidedOf(x.id); }).length;
        return n || null;
      } catch (e) { return null; }
    },
    sessUI: sessUI
  };

  /* ---------------- 动作 ---------------- */
  function agentOf(id) { return S.AGENTS[S.idx.agent[id]]; }
  /* v37：refresh 是全量重画（navigate({}) → #content.innerHTML 重写），正文列与右栏都是新节点，
     滚动位置归零。会话页里几乎每个动作都走这里，最要命的是**引擎的时钟**（pumpEngine 每 tick
     一次）——实测读到中段点开一条过程行、或什么都不做等下一拍，整段对话都会**飞回顶部**。
     这里按"原来在哪、就回哪"处理：
       · 原来贴底（距底 ≤24px）→ 重画后继续贴底，新内容跟着走（流式跟随不破）；
       · 原来在中间 → 停在同一像素位置（就地展开就该就地展开）；
       · 右栏各自独立记位置（它是另一条滚动轨道）。
     ⚠ as-bottom（回到底部）在 refresh 之后自己设 scrollTop=scrollHeight，那条路径仍然生效。 */
  function refresh(h) {
    var d = global.document;
    var f0 = d.querySelector('.as-feed-col'), s0 = d.querySelector('.as-side');
    var fy = f0 ? f0.scrollTop : 0, sy = s0 ? s0.scrollTop : 0;
    var atBottom = f0 ? (f0.scrollHeight - fy - f0.clientHeight) <= 24 : true;
    h.navigate({}, { scroll: false });
    var f1 = d.querySelector('.as-feed-col'), s1 = d.querySelector('.as-side');
    if (f1) f1.scrollTop = atBottom ? f1.scrollHeight : fy;
    if (s1 && sy) s1.scrollTop = sy;
  }
  function permTagOf(perm) { return perm; }

  A['as-sub'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).sub = p[1] === 'traj' ? 'traj' : 'chat';
    refresh(h);
  };
  A['as-lane'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).lane = ['time', 'round', 'call'].indexOf(p[1]) >= 0 ? p[1] : 'time';
    refresh(h);
  };
  A['as-sel'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).sel = p[1];
    refresh(h);
  };
  /* v32：思考行开合（DSH ReasoningRow 的 disclosure）。与 as-call / as-round 同法。 */
  A['as-reason'] = function (id, btn, h) {
    var st = h.state.asUI && h.state.asUI[String(id).split('|')[0]];
    /* id 形如 "<traceId>-think"，但 asUI 按 agentId 分桶 —— 用当前 Agent 的桶即可 */
    var a0 = S.AGENTS[S.idx.agent[String(h.state.agentId || '')]] || S.AGENTS[0];
    var ui = sessUI(h.state, a0);
    ui.openReason[id] = !ui.openReason[id];
    refresh(h);   /* v37：原来直接 navigate —— 点"思考"展开会飞回顶部 */
  };
  A['as-round'] = function (id, btn, h) {
    var a = agentOf((h.state.agentId) || ''); if (!a) return;
    var st = sessUI(h.state, a);
    st.openRounds[id] = !st.openRounds[id];
    refresh(h);
  };
  /* 主干预：中途引导（steering）—— 人给一句话，Agent 继续执行，不打断 */
  /* v42：**发送不再需要二次确认**（业主：去看对话部分）。
     改前实测：在输入框打字按 Enter → 弹「把这条中途引导交给 Agent？」确认层 → 必须再点
     「发送（不打断）」才真正发出。对照 dsh 的 keymap：Enter 就是发送，没有任何确认层
     （TrajectoryView/ChatView 都一样）。每次说话都打断一次，对话根本进行不下去；
     而且这个确认层用的是 dangerConfirm（高危动作闸门），语义被错配了 ——
     「发一句话」不是高危动作，真正的闸门是「停止 / 接管 / 批准高危动作」，那些各有自己的确认。
     现在：Enter 直接发，落点仍由引擎按 dsh 规则决定（空闲→正文 / 繁忙+排队→排队坞 /
     繁忙+插话→待生效），**审计照写**（只是不再用弹层拦人）。 */
  A['as-hint'] = function (id, btn, h, mode) {
    var a = agentOf(id); if (!a) return;
    var root = (btn && btn.closest && btn.closest('.as-composer')) || document.querySelector('.as-composer');
    var ta = root && root.querySelector ? root.querySelector('textarea') : null;
    var txt = ta ? String(ta.value || '').trim() : '';
    if (!txt) { h.toast('写点什么再发', 'warn'); if (ta) ta.focus(); return; }

    var se = store().current(a.id);
    store().addHint(a.id, txt, 'steering', se ? se.lastRound : 0);
    /* 落点由引擎按 DSH 规则决定：空闲→正文；繁忙+排队→排队坞；繁忙+插话→待生效插话。
       keyboard 传入的 mode 覆盖当前设置（Cmd/Ctrl+Enter 走互补模式）。 */
    var E = global.SESSION_ENGINE;
    var placed = null;
    if (E) { E.open(a, { history: 3 }); placed = E.send(txt, mode || E.view().delivery); }
    sessUI(h.state, a).instr = '';
    /* 自己刚发的那条直接进正文时，视图必须贴底 —— 否则新增的一轮长在可视区之外，
       「往下添加」就看不到了。这与 DSH 的滚动归属同规则（离开底部才显示「回到底部」），
       只在**确实进正文**（transcript）时恢复跟随；排队/插话不改变读者的滚动位置。 */
    if (placed && placed.placed === 'transcript') sessUI(h.state, a).follow = true;
    /* 留痕不靠弹层：审计照写（谁、对哪个 Agent、落在哪），事后在审计里可查 */
    try {
      h.audit({
        action: '向 Agent 发送消息',
        target: a.id + ' · ' + a.name,
        impact: (placed && placed.placed === 'transcript' ? '直接进入对话' : (placed && placed.placed === 'queue' ? '排队（空闲后自动发送）' : '本轮结束后生效（插话）')) + '：' + txt.slice(0, 60)
      });
    } catch (e) { }
    h.toast(placed && placed.placed === 'queue' ? '已排队（Agent 空闲后自动发送）'
      : (placed && placed.placed === 'transcript' ? '已发送' : '已送达（本轮结束后生效，Agent 继续执行）'), 'ok');
    refresh(h);
  };
  /* 从右栏顶部的入口滚到流末尾那张审批卡（不重新渲染，避免把人往回顶） */
  A['as-diff-panel'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a);
    st.diffPanelOpen = !st.diffPanelOpen;
    refresh(h);
  };
  A['as-goto-approval'] = function (id, btn, h) {
    var card = document.querySelector('.as-approval');
    if (!card) { h.toast('这件已经处置过了', 'info'); refresh(h); return; }
    var col = document.querySelector('.as-feed-col');
    if (col) {
      var top = card.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop - 12;
      col.scrollTo ? col.scrollTo({ top: top, behavior: 'smooth' }) : (col.scrollTop = top);
    }
    var s2 = __asUI; if (s2) s2.follow = false;   /* 手动定位后不要被"贴底跟随"拽走 */
  };
  A['as-copy-msg'] = function (id, btn, h) {
    h.toast('已复制这条回复（原型只提示，不写剪贴板）', 'ok');
  };
  A['as-tasks-toggle'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.tasksOpen = !st.tasksOpen; refresh(h);
  };
  A['as-tasks-clear'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    store().clearFinished(a.id);
    h.toast('已清空已结束任务（只影响本屏展示）', 'info'); refresh(h);
  };
  /* 停止当前任务：**单击即停**（DSH §9.1.11 的 Stop 是单次点击；500ms 双 Esc 是另一条快捷键路径）。
     与 DSH 的唯一差别是保留了本原型的权限门禁与审计 —— 但**不再弹二次确认层**，避免把一步操作放大成三步。 */
  A['as-stop'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var chk = global.V10UI.checkPerm('agent:intervene');
    if (!chk || !chk.ok) {
      h.audit({ action: '停止 Agent 任务（被拦）', target: a.id + ' · ' + a.name, impact: '缺 agent:intervene' });
      h.toast('没有停止权限（agent:intervene）—— 找平台管理员授权', 'warn');
      return;
    }
    var E = global.SESSION_ENGINE;
    if (E) { E.open(a, { history: 3 }); E.kill(); }
    store().setStatus(a.id, 'paused');
    h.audit({ action: '停止 Agent 任务', target: a.id + ' · ' + a.name, impact: '当前轮中断，在跑节点标为已取消' });
    h.toast('已停止（在跑的节点标为已取消）', 'warn');
    refresh(h);
  };

  /* 轮次轨道跳转：把该轮设为当前并滚到它的锚点（chat README:115 轮次导航） */
  A['as-jump'] = function (id, btn, h) {
    var a = agentOf(String(id).split('|')[0]); if (!a) return;
    var st = sessUI(h.state, a); st.sel = String(id).split('|')[1] || id; st.follow = true;
    refresh(h);
    try {
      var el = global.document.getElementById('as-r-' + (String(id).split('|')[1] || id));
      el && el.scrollIntoView && el.scrollIntoView({ block: 'start' });
    } catch (e) { }
  };
  /* Inspect：从对话里的动作行跳到轨迹并聚焦这次调用（tool README:80：不再显示第二个全高视图） */
  A['as-inspect'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.sub = 'traj'; st.sel = p[1]; st.selCall = p[2];
    h.toast('已定位到轨迹：' + p[2], 'info');
    refresh(h);
  };
  /* 回到底部：恢复跟随（chat README:121 —— 只恢复外层跟随） */
  A['as-bottom'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.follow = true; refresh(h);
    try {
      var el = global.document.querySelector('.as-feed-col');
      el && (el.scrollTop = el.scrollHeight);
    } catch (e) { }
  };
  A['as-round-change'] = function (id, btn, h) {
    var a = agentOf(String(id).split('|')[0]); if (!a) return;
    sessUI(h.state, a).sel = String(id).split('|')[1] || id; refresh(h);
  };
  A['as-strip'] = function (id, btn, h) {
    var a = agentOf(String(id).split('|')[0]);
    h.toast('已复制这一轮的调用摘要（原型只提示，不写剪贴板）', 'info');
  };


  /* 斜杠指令：选中即执行（DSH：选中即提交那条命令） */
  A['as-cmd'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a), E = global.SESSION_ENGINE;
    if (p[1] === 'permission') { st.instr = ''; return A['as-perm'](a.id + '|' + store().modeOf(a.id), null, h); }
    if (p[1] === 'display') {
      /* 四档的真实枚举：compact / standard / detailed / **verbose**（chat-settings.ts:12） */
      var order = ['compact', 'standard', 'detailed', 'verbose'];
      var cur = E && E.view() ? E.view().displayMode : 'standard';
      var next = order[(order.indexOf(cur) + 1) % order.length];
      st.instr = ''; h.toast('展示模式 → ' + next, 'info');
      sessUI(h.state, a).dmOpen = false;
    return A['as-display'](a.id + '|' + next, null, h);
    }
    if (p[1] === 'delivery') {
      var d = E && E.view() ? (E.view().delivery === 'queue' ? 'steer' : 'queue') : 'steer';
      st.instr = ''; h.toast('投递方式 → ' + (d === 'queue' ? '排队' : '插话'), 'info');
      return A['as-delivery'](a.id + '|' + d, null, h);
    }
    if (p[1] === 'stop') { st.instr = ''; A['as-stop'](a.id, null, h); A['as-stop'](a.id, null, h); return; }
    if (p[1] === 'clear') { st.instr = ''; refresh(h); return; }
  };
  A['as-ref'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.refs.push({ kind: p[1], id: p[2], label: p[3] });
    st.instr = String(st.instr || '').replace(/@[^@\s]*$/, '');
    refresh(h);
  };
  A['as-unref'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).refs.splice(Number(p[1]), 1); refresh(h);
  };
  A['as-unattach'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).attaches.splice(Number(p[1]), 1); refresh(h);
  };
  /* + 附件：只列真实可挂的东西（最近调用记录 / 该 Agent 的 MCP 服务） */
  A['as-attach'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a), se = store().current(a.id);
    var items = se.rounds.slice(-3).map(function (r) {
      return { act: 'as-attach-add', id: a.id + '|trace|' + r.traceId, name: '调用记录 ' + r.traceId, meta: (r.intentName || '') + ' · ' + durCn(r.latencyMs) };
    });
    refCands(a, se).filter(function (c) { return c.kind === 'mcp'; }).forEach(function (c) {
      items.push({ act: 'as-attach-add', id: a.id + '|mcp|' + c.id, name: c.label, meta: 'MCP 服务' });
    });
    global.V10UI.openSheet({
      title: '添加附件',
      bodyHtml: '<div class="v10-sheet-desc">只列真实存在的东西：本 Agent 的调用记录与它用到的 MCP 服务。</div>' +
        '<div class="as-attlist">' + items.map(function (x) {
          return '<button class="as-attitem" data-act="' + x.act + '" data-id="' + h.esc(x.id) + '">' +
            '<b>' + h.esc(x.name) + '</b><em>' + h.esc(x.meta) + '</em></button>';
        }).join('') + '</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (e) {
          var g = e.target.getAttribute && e.target.getAttribute('data-v10');
          if (g === 'close') global.V10UI.closeSheet();
        });
      }
    });
  };
  A['as-attach-add'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.attaches.push({ id: p[2], kind: p[1], name: p[1] === 'mcp' ? 'MCP · ' + p[2] : '调用记录 ' + p[2], meta: p[1] === 'mcp' ? '工具引用' : '链路附件' });
    try { global.V10UI.closeSheet(); } catch (e) { }
    refresh(h);
  };


  /* job 输出面板开合（jobs README：展开即可观察该 job 的输出流；收起即停流） */
  A['as-job-open'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.jobOpen = (st.jobOpen === Number(p[1])) ? null : Number(p[1]);
    refresh(h);
  };
  /* 差异展开（tool README:82：折叠前保留 9 行；aria 文案 展开其余 N 行差异 / 收起差异） */
  A['as-diff-open'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.diffOpen = !st.diffOpen; refresh(h);
  };

  A['as-usage'] = function (id, btn, h) {
    var a = agentOf(String(id).split('|')[0]); if (!a) return;
    var st = sessUI(h.state, a); var tid = String(id).split('|')[1]; st.usageOpen = (st.usageOpen === tid ? null : tid); refresh(h);
  };
  /* 单次调用的开合（每次调用独立，DSH tool__ToolRow 的 useDisclosure） */
  A['as-call'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a), box = st.openCalls[p[1]] || (st.openCalls[p[1]] = {});
    box[p[2]] = !box[p[2]];
    refresh(h);
  };
  /* 轨迹表点行 → 选中该调用（泳道色块据此高亮、右侧详情面板据此打开） */
  A['as-call-sel'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.sel = p[1]; st.selCall = p[2];
    /* 详情面板按"这一行"的身份打开。键优先取行上挂的 data-key（渲染时算好的），
       只有拿不到（键盘/程序触发）才退回按名字重算 —— 两条路都走 trajCellsOf 的 index 口径。 */
    var key = null;
    try {
      var tr = (btn && btn.closest) ? btn.closest('tr') : null;
      if (tr && tr.getAttribute) key = tr.getAttribute('data-key') || null;
    } catch (e) { }
    if (!key) {
      try {
        var se = store().current(a.id);
        (se && se.rounds || []).forEach(function (r) {
          if (r.traceId !== p[1]) return;
          trajCellsOf(r).forEach(function (c) { if (c.name === p[2] && key === null) key = r.traceId + '#' + c.index; });
        });
      } catch (e2) { }
    }
    st.trajSel = key;
    refresh(h);
  };
  /* 时间轴（甘特条）点击 → 选中该条并滚到账本里对应的那一行（dsh：TrajectoryTimeline 的
     onRecordSelect(index)，时间轴与账本共用同一个选中态）。
     复用 as-call-sel 的选中逻辑，避免两套「选中」定义各写一份漂掉；
     账本是整块重绘的，定位必须等下一帧 —— 重绘前抓到的 <tr> 已经不在文档里了。 */
  A['as-tg-sel'] = function (id, btn, h) {
    var p = String(id).split('|');
    var aid = p[0], tid = p[1], nm = p.slice(2).join('|');
    if (!aid || !tid || !nm) return;
    A['as-call-sel'](aid + '|' + tid + '|' + nm, btn, h);
    var go = function () {
      var doc = global.document; if (!doc) return;
      var list = doc.querySelectorAll('.trajtable-table tbody tr[data-act="as-call-sel"]');
      var head = aid + '|' + tid + '|', tr = null;
      for (var i = 0; i < list.length; i++) {
        var d = String(list[i].getAttribute('data-id') || '');
        if (d.indexOf(head) === 0 && d.slice(head.length) === nm) { tr = list[i]; break; }
      }
      if (!tr) return;
      try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { tr.scrollIntoView(); } catch (e2) { } }
      tr.classList.add('as-tt-flash');
      global.setTimeout(function () { tr.classList.remove('as-tt-flash'); }, 1200);
    };
    if (global.requestAnimationFrame) global.requestAnimationFrame(go); else global.setTimeout(go, 30);
  };
  /* 展开/收起所有轮次·调用（strings.txt:515-524） */
  A['as-expand'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a), se = store().current(a.id);
    if (p[1] === 'rounds') {
      st.allRounds = !st.allRounds;
      st.openRounds = {};
      if (st.allRounds) se.rounds.forEach(function (r) { st.openRounds[r.traceId] = true; });
    } else {
      st.allCalls = !st.allCalls;
      st.openCalls = {};
      if (st.allCalls) se.rounds.forEach(function (r) { var box = st.openCalls[r.traceId] = {}; (r.actions || []).forEach(function (x) { box[x.name] = true; }); });
    }
    refresh(h);
  };
  A['as-traj-q-clear'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    sessUI(h.state, a).trajQ = ''; refresh(h);
  };
  A['as-ctx'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.ctxOpen = !st.ctxOpen; refresh(h);
  };
  /* 打开真实 DSH web 端（承载页 DSH-真实界面.html 是**另一个页面**，不是内嵌 iframe）。
     往源里的 `as-sub` 里已经没有 'live' 这一档，会话屏本身不含 iframe。 */
  A['as-open-dsh'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    try { global.open('DSH-真实界面.html', '_blank'); } catch (e) { }
    h.toast('已在新窗口打开真实 DSH 界面（需本机 dsh web 在跑）', 'ok');
  };
  /* 右栏收起/展开（真实 DSH 右上角有该图标） */
  A['as-side-toggle'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.sideOpen = (st.sideOpen === false);
    refresh(h);
  };
  /* 展示模式：点标题开下拉（真实 DSH 是 ⌄ 下拉，不是点击循环） */
  A['as-dm-menu'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a); st.dmOpen = !st.dmOpen; refresh(h);
  };
  A['as-dm-cycle'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var E = global.SESSION_ENGINE;
    var order = ['compact', 'standard', 'detailed', 'verbose'];
    var cur = (E && E.view()) ? E.view().displayMode : 'standard';
    var next = order[(order.indexOf(cur) + 1) % order.length];
    return A['as-display'](a.id + '|' + next, null, h);
  };
  A['as-msg-copy'] = function (id, btn, h) { h.toast('已复制这条消息（原型只提示，不写剪贴板）', 'info'); };
  /* 整轮过程控件（TurnProcessNodeView 的 onClick → turnProcess.setOpen(!open)）。
     verbose 档 foldable=false → 控件 disabled，点击不生效（源码同）。 */
  A['as-turnprocess'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    var dm = (global.SESSION_ENGINE && global.SESSION_ENGINE.view()) ? global.SESSION_ENGINE.view().displayMode : 'standard';
    var pol = policyOf(dm);
    if (!pol.foldCompletedTurns) { h.toast('「完全展开」档下整轮过程不可收起（presentation-policy:50-56）', 'info'); return; }
    st.openTurnProcess[p[1]] = !st.openTurnProcess[p[1]];
    refresh(h);
  };
  /* 轨迹工具栏：时长 实际/等宽 开关（TrajectoryToolbar.tsx:55-73） */
  A['as-traj-duration'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a);
    st.durationMode = (st.durationMode === 'equal') ? 'actual' : 'equal';
    refresh(h);
  };
  /* 「轮次」全收 / 全展（dsh collapseTurnRecords，TrajectoryTable.tsx:624-660）：
     收起后每一轮只留「用户」这条 + 一行摘要「N 步 · M 个工具调用」。
     单条展开由摘要行自己的 as-traj-sum 负责 —— 两个按钮只管全收/全展，不抢单条的开关。 */
  A['as-traj-turns'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a), se = store().current(a.id);
    var any = Object.keys(st.trajCollapseTurns || {}).length > 0;
    st.trajCollapseTurns = {};
    if (!any && se) (se.rounds || []).forEach(function (r) { st.trajCollapseTurns[r.traceId] = true; });
    refresh(h);
  };
  /* 「调用」全收 / 全展（dsh collapseAssistantRecords，:662-733）：
     收起后模型/助手行后面连续的工具行压成一行「M 个工具调用 · 名称」。 */
  A['as-traj-calls'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var st = sessUI(h.state, a), se = store().current(a.id);
    var any = Object.keys(st.trajCollapseCalls || {}).length > 0;
    st.trajCollapseCalls = {};
    if (!any && se) {
      (se.rounds || []).forEach(function (r) {
        var cells = trajCellsOf(r);
        for (var i = 0; i < cells.length; i++) {
          var c = cells[i];
          if (c.rowKind === 'group' || (c.nodeKind || c.kind) !== 'message') continue;
          var j = i + 1, n = 0;
          while (j < cells.length && cells[j].rowKind !== 'group' && (cells[j].nodeKind || cells[j].kind) === 'tool') { n++; j++; }
          if (n) st.trajCollapseCalls[r.traceId + '#' + c.index] = true;
        }
      });
    }
    refresh(h);
  };
  /* 点「消息」分组标题 → 折叠/展开这一轮（dsh 的 onToggleTurn：轮次标题本身就是开关）。 */
  A['as-traj-turn-one'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    st.trajCollapseTurns = st.trajCollapseTurns || {};
    if (st.trajCollapseTurns[p[1]]) delete st.trajCollapseTurns[p[1]]; else st.trajCollapseTurns[p[1]] = true;
    refresh(h);
  };
  /* 点折叠摘要行 → 只展开这一段（dsh 的 onToggleTurn / onToggleAssistant） */
  A['as-traj-sum'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    if (p[1] === 'turn') { if (st.trajCollapseTurns) delete st.trajCollapseTurns[p[2]]; }
    else if (st.trajCollapseCalls && p[3]) { delete st.trajCollapseCalls[p[3]]; }
    refresh(h);
  };

  /* 轨迹页列筛选器开关（真实 DSH 轨迹页那一排 时长/轮次/调用/输入/模型/工具）。
     这排按钮**没有 data-id**（契约如此）——所以当前会话的 UI 状态从 sessUIEl() 取
     （sessionTab 渲染时会把它挂上），拿不到再退回按 state.agentId 定位（同 as-reason 的兜底写法）。
     ⚠ 本批只做「可点通 + 状态可留存」：点击只切换该列开关状态并落进 sessUI 的 tfCols，
       **过滤逻辑未接** —— 账本列还没有按这些开关增删（下一批做）。 */
  A['as-tf-toggle'] = function (id, btn, h) {
    var col = (btn && btn.getAttribute && btn.getAttribute('data-col')) || '';
    if (['duration', 'turn', 'call', 'input', 'model', 'tool'].indexOf(col) < 0) return;
    var a = agentOf(String(h.state.agentId || '')) || S.AGENTS[0];
    var st = sessUIEl() || sessUI(h.state, a);
    var box = st.tfCols || (st.tfCols = { duration: true, turn: true, call: true, input: true, model: true, tool: true });
    box[col] = !(box[col] !== false);          /* 默认 on → 第一次点即 off */
    refresh(h);
  };
  /* 详情面板标签（TrajectoryTable 的 detailTabs） */
  A['as-traj-tab'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a);
    /* 白名单要跟 trajDetails 的页签集合一致 —— 少一个，点了就静默不动（上一版漏了 schema / timing）。 */
    if (['overview', 'prompt', 'payload', 'result', 'schema', 'timing'].indexOf(p[1]) >= 0) st.trajTab = p[1];
    refresh(h);
  };
  A['as-traj-close'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    sessUI(h.state, a).trajSel = null; refresh(h);
  };
  A['as-traj-request'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).sel = p[1]; refresh(h);
  };
  /* 过程组标题即折叠控件（真实 DSH：组标题本身可点） */
  A['as-grp'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var st = sessUI(h.state, a), box = st.openGroups[p[1]] || (st.openGroups[p[1]] = {});
    box[p[2]] = (box[p[2]] === false) ? true : false;   /* 默认展开 → 第一次点即收起 */
    refresh(h);
  };
  /* 投递方式（DSH：Enter 用当前设置，Cmd/Ctrl+Enter 用互补） */
  A['as-delivery'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var E = global.SESSION_ENGINE; if (!E) return;
    E.open(a, { history: 3 }); E.setDelivery(p[1]);
    refresh(h);
  };
  A['as-q-edit'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    sessUI(h.state, a).editQ = p[1]; refresh(h);
  };
  A['as-q-cancel'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    sessUI(h.state, a).editQ = null; refresh(h);
  };
  A['as-q-save'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var root = (btn && btn.closest && btn.closest('.as-qrow')) || null;
    var ta = root && root.querySelector ? root.querySelector('textarea[data-qedit]') : null;
    var E = global.SESSION_ENGINE;
    if (E && ta) { E.open(a, { history: 3 }); E.editQueued(p[1], ta.value); }
    sessUI(h.state, a).editQ = null; refresh(h);
  };
  A['as-q-del'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.removeQueued(p[1]); }
    h.toast('已删除排队的消息', 'info'); refresh(h);
  };
  A['as-q-promote'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.promoteQueued(p[1]); }
    h.toast('已改为插话：下一轮生效', 'ok'); refresh(h);
  };
  /* 展示模式（DSH：简洁/标准/详细/完全展开，控制已完成轮次的过程显隐） */
  A['as-display'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.setDisplay(p[1]); }
    sessUI(h.state, a).dmOpen = false;      /* 选完就关下拉（下拉形态） */
    /* 规格：展示模式切换**保留**展开状态（chat README:104-108）—— 旧代码在这里清 openRounds 是反的，去掉 */
    refresh(h);
  };
  /* 权限预设：DSH 的交互是"选中即提交 /permission <preset>"，选完全权限要**勾选风险**后按钮才可用 */
  A['as-perm'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var cur = p[1] || store().modeOf(a.id);
    var rows = MODES.map(function (m) {
      return '<label class="as-pmrow' + (cur === m.id ? ' on' : '') + '">' +
        '<input type="radio" name="asperm" value="' + h.esc(m.id) + '"' + (cur === m.id ? ' checked' : '') + ' data-aspick>' +
        '<span><b>' + m.label + '</b>' + (m.exp ? '<i class="as-exp">EXP</i>' : '') + '<em>' + h.esc(m.hint) + '</em></span></label>';
    }).join('');
    global.V10UI.openSheet({
      title: '权限',
      bodyHtml: '<div class="v10-sheet-desc">选择新会话的默认权限模式（当前会话立即生效，记审计）</div>' +
        '<div class="as-pmlist">' + rows + '</div>' +
        '<label class="as-risk"><input type="checkbox" data-asrisk> 我已了解风险，并愿意继续（选「完全权限」时必须勾选）</label>' +
        '<div class="bt-note">对应权限点 agent:session:autonomy —— 无权限会被拦下并提示找谁授权。</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-v10="ok" disabled>启用所选模式</button>',   /* 选中后按档位改名 */
      onOpen: function (root) {
        var ok = root.querySelector('[data-v10="ok"]'), risk = root.querySelector('[data-asrisk]');
        function sync() {
          var picked = root.querySelector('input[data-aspick]:checked');
          var needRisk = picked && (picked.value === 'full' || picked.value === 'auto');
          ok.disabled = !(picked && (!needRisk || (risk && risk.checked)));
          /* 按钮文案按档位（DSH：完全权限 → 「启用完全权限」；实验档 → 「启用 Auto review」） */
          ok.textContent = !picked ? '启用所选模式'
            : (picked.value === 'full' ? '启用完全权限'
            : (picked.value === 'auto' ? '启用 Auto review' : '启用「' + (MODES.filter(function (m) { return m.id === picked.value; })[0] || {}).label + '」'));
        }
        root.addEventListener('change', sync); sync();
        root.addEventListener('click', function (e) {
          var g = e.target.getAttribute && e.target.getAttribute('data-v10');
          if (g === 'close') { global.V10UI.closeSheet(); return; }
          if (g !== 'ok') return;
          var picked = root.querySelector('input[data-aspick]:checked');
          global.V10UI.closeSheet();
          if (picked) A['as-mode'](a.id + '|' + picked.value, null, h);
        });
      }
    });
  };  A['as-hint-kind'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    h.toast('提示类型：' + (p[1] || '约束') + '（当前输入框的内容会按该类型注入）', 'info');
  };
  /* 强干预（会停）：暂停 / 接管 —— 与"中途引导"分开，权限也不同 */
  A['as-pause'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    var paused = store().statusOf(a.id) === 'paused';
    if (paused) { var E0 = global.SESSION_ENGINE; if (E0) { E0.open(a, { history: 3 }); E0.setStatus('running'); } store().setStatus(a.id, 'running'); h.toast('已恢复执行', 'ok'); refresh(h); return; }
    h.dangerConfirm(h, {
      title: '暂停这个会话？', desc: '注意：常规干预是"中途引导"（不打断）。暂停会让 Agent 停在当前这一步，属于强干预。',
      tone: 'warn', perm: 'agent:intervene', confirmText: '暂停', action: '暂停 Agent 会话', target: a.id + ' · ' + a.name,
      impacts: [{ label: '影响', value: 'Agent 停手，直到你点恢复' }, { label: '可恢复', value: '是；已给的中途引导保留' }],
      onConfirm: function (reason) { var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.setStatus('paused'); } store().setStatus(a.id, 'paused'); h.toast('已暂停', 'warn'); refresh(h); }
    });
  };
  A['as-takeover'] = function (id, btn, h) {
    var a = agentOf(id); if (!a) return;
    h.dangerConfirm(h, {
      title: '接管这个会话？', desc: 'Agent 停手，剩下的由你人工处理，责任转到你（记审计）。',
      tone: 'danger', perm: 'agent:takeover', confirmText: '确认接管', action: '接管 Agent 会话', target: a.id + ' · ' + a.name,
      impacts: [{ label: '接管人', value: (S.ME && S.ME.name) || '我' }, { label: 'Agent', value: '停止自动动作' }],
      onConfirm: function (reason) { var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.setStatus('takenOver'); } store().setStatus(a.id, 'takenOver'); h.toast('已接管', 'ok'); refresh(h); }
    });
  };
  A['as-mode'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var m = MODES.filter(function (x) { return x.id === p[1]; })[0] || MODES[1];
    if (store().modeOf(a.id) === m.id) return;
    h.dangerConfirm(h, {
      title: '把 Agent 权限调成「' + m.label + '」？', desc: m.hint,
      tone: m.risk ? 'danger' : 'warn',
      perm: 'agent:session:autonomy', confirmText: m.risk ? '确认风险并调整' : '调整',
      action: '调整 Agent 权限预设', target: a.id + ' · ' + a.name + ' → ' + m.label,
      impacts: [{ label: '对后续动作', value: m.hint },
                { label: '风险', value: m.risk ? '写动作与高危动作将直接执行，不再逐次要人确认' : '高危动作仍需逐次确认' },
                { label: '对已发生的轮次', value: '不改写' }],
      onConfirm: function (reason) { var E = global.SESSION_ENGINE; if (E) { E.open(a, { history: 3 }); E.setMode(m.id); } store().setMode(a.id, m.id); refresh(h); }
    });
  };
  A['as-rollback'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var traceId = p[1], no = p[2];
    var se = store().current(a.id);
    var r = se.rounds.filter(function (x) { return x.traceId === traceId; })[0];
    if (!r || !r.writes.length) { h.toast('这一轮没有可回滚的改动', 'warn'); return; }
    h.dangerConfirm(h, {
      title: '回滚第 ' + (no || r.no) + ' 轮的改动？',
      desc: '要撤销：' + r.writes.map(function (x) { return x.name; }).join('、'),
      tone: 'danger', perm: 'agent:round:rollback', confirmText: '回滚这一轮', action: '回滚 Agent 本轮改动', target: a.id + ' · ' + traceId,
      impacts: [{ label: '轮次', value: '第 ' + r.no + ' 轮 · ' + r.when }, { label: '写动作', value: r.writes.length + ' 个' }, { label: '不可逆', value: '回滚本身也是一次写操作' }],
      onConfirm: function (reason) { store().markRolled(traceId); h.toast('已回滚（右栏该轮改动显示为不可用）', 'ok'); refresh(h); }
    });
  };
  A['as-decide'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var itemId = p[1], decision = p[2] === 'reject' ? 'reject' : 'approve';
    h.dangerConfirm(h, {
      title: decision === 'approve' ? '批准这个动作继续？' : '驳回这个动作？',
      desc: itemId, tone: decision === 'approve' ? 'warn' : 'danger', perm: 'agent:approve',
      confirmText: decision === 'approve' ? '批准并继续' : '驳回',
      action: decision === 'approve' ? '批准 Agent 高危动作' : '驳回 Agent 高危动作', target: a.id + ' · ' + itemId,
      impacts: [{ label: '处置人', value: (S.ME && S.ME.name) || '我' },
                { label: '后续', value: decision === 'approve' ? '动作放行，Agent 继续执行' : '动作终止并按规则回退' }],
      onConfirm: function (reason) { store().decide(a.id, itemId, decision); h.toast(decision === 'approve' ? '已批准' : '已驳回', decision === 'approve' ? 'ok' : 'warn'); refresh(h); }
    });
  };
  /* 轮次级处置（首条待处置里「不可重试失败轮」那条的两个决策按钮）。
     为什么单开一个动作而不是复用 as-decide：as-decide 认的是**合规队列**的 itemId，
     它的 store().decide 会把 id 记进 decided 表；轮次 id 是 traceId，两者语义不同。
     这里把决定与"回滚本轮"这个真动作绑在一起（回滚是既有的、真改 state 的 A['as-rollback']），
     而不是只弹一句"已处理"。 */
  A['as-round-decide'] = function (id, btn, h) {
    var p = String(id).split('|'), a = agentOf(p[0]); if (!a) return;
    var traceId = p[1], decision = p[2] === 'reject' ? 'reject' : 'approve';
    var se = store().current(a.id);
    var r = (se && se.rounds || []).filter(function (x) { return x.traceId === traceId; })[0];
    var why = r && r.errName ? r.errName : '不可重试失败';
    h.dangerConfirm(h, {
      title: decision === 'approve' ? '保留这一轮的结果，继续跑？' : '回滚这一轮，按规则收场？',
      desc: '第 ' + ((r && r.no) || '?') + ' 轮 · ' + why, tone: 'warn', perm: 'agent:round:rollback',
      confirmText: decision === 'approve' ? '保留并继续' : '回滚这一轮',
      action: decision === 'approve' ? '保留失败轮结果' : '回滚失败轮',
      target: a.id + ' · ' + traceId,
      impacts: [
        { label: '这一轮', value: '以「' + why + '」结束，不可自动重试' },
        { label: '保留', value: '结果留在会话与链路记录里；右栏「待处理」不再计它' },
        { label: '回滚', value: '本轮写动作按规则回退（既有动作 as-rollback 的同一套影响面）' }
      ],
      requireReason: true,
      onConfirm: function (reason) {
        if (decision === 'reject') {
          var rb = A['as-rollback'];
          if (typeof rb === 'function') { rb(a.id + '|' + traceId + '|' + ((r && r.no) || 1), null, h); return; }
          h.toast('这一轮已标记回滚（回滚入口不可用，仅记状态）', 'warn');
        } else {
          h.toast('已保留第 ' + ((r && r.no) || '?') + ' 轮的结果', 'ok');
        }
        refresh(h);
      }
    });
  };
  A['as-open-trace'] = function (id, btn, h) {
    h.navigate({ domain: 'platform', cap: 'obs', tab: 'trace', traceId: String(id), agentId: null }, { scroll: true });
  };
  /* 本次会话轮（live-<no>）没有调用记录，它的 trace 入口通到**该轮的事件流**。
     此前这个按钮挂的 as-live-trace 从没注册过 —— 点了只弹「未接线」，
     而它旁边（同一条 as-foot 里）的 as-jump / as-strip / as-round-change 都是活的，于是这一轮看起来「就差一个按钮没反应」。
     行为与 as-job-open 同构（同一个 st.jobOpen 面板、同一份引擎事件日志），另外把 st.sel 指到该轮，
     让右栏「第 N 轮改动」与泳道也一并落到这一轮上；找不到该轮就如实说明，不静默失败。 */
  A['as-live-trace'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var a = agentOf(p[0]); if (!a) return;
    var no = Number(p[1]);
    var st = sessUI(h.state, a);
    var E = global.SESSION_ENGINE;
    var view = E && E.view ? E.view() : null;
    var r = view && view.rounds ? view.rounds.filter(function (x) { return x.no === no; })[0] : null;
    if (!r) {
      h.toast('第 ' + (p[1] || '?') + ' 轮不在本次会话的事件日志里（历史轮请看「链路」）', 'warn');
      return;
    }
    st.sel = r.traceId;
    st.jobOpen = (st.jobOpen === no) ? null : no;
    h.toast('已打开第 ' + no + ' 轮的事件流（本会话轮没有调用记录，展示的是事件日志原样）', 'info');
    refresh(h);
  };
})(window);
