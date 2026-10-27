/* SECTION: app-core
 * 应用外壳：路由、导航、搜索、通用 UI 组件。
 * 页面渲染器见 renderers.js。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS, C = global.CHARTS, APP = global.APP_DATA;
  var DOMAINS = APP.domains, CAPS = APP.caps;
  var ME = S.ME;   /* 登录身份单一数据源：顶栏、审计、审批视角、账号菜单都读它 */

  /* SECTION: state */
  var state = {
    domain: 'platform',
    cap: 'agent-wb',
    agentId: null,
    tab: null,
    /* v24：Agent 工作台的屏内分页（'list' | 'net'）。与 tab 分开存 ——
       tab 在 agent-wb 上是**详情页**的 Tab（monitor/orchestrate/…），
       两个层级混用一个字段会把「网状关系」当成详情 Tab 塞进详情页。 */
    agentPageTab: 'list',
    /* v29：网关的屏内分页（'mcp' | 'llm' | 'skill'）。与 agentPageTab 同理：
       gateway 的路径首段留给详情对象 id，屏内 Tab 只能走 query（?gw=llm）。 */
    gwPageTab: 'mcp',
    traceId: null,
    range: '24h',
    page: 1,
    filters: {},
    route: null,
    simMode: 'single',
    user: ME.id,
    /* v32（2026-10-15）：Agent 详情 › 运行监控 的两个视图状态 —— 参考 DS 控制台的用量页：
       ① agentDim：堆叠柱与下方分解按哪个维度（model / intent）；
       ② agentVer：只看某一版本（all / online / gray）。 */
    agentDim: 'model',
    agentVer: 'all'
  };

  var els = {};
  function $(id) { return document.getElementById(id); }

  /* SECTION: route
   * hash 路由：#/platform/agent-wb/ag-cs-refund/monitor
   * 每个视图都有独立 URL，可直达、可分享、可后退 —— 生产系统的基本要求。
   */
  /* 能力 → 「详情对象 id」在 state 上的字段名。
     原来这段映射散在四处（capQuery / hydrateFromQuery / openDetailIfAny ×2），改一个能力要改四处、
     必漏。现在只此一份。 */
  var DETAIL_FIELDS = { persona: 'personaId', 'sim-user': 'simId', interview: 'interviewId', sandbox: 'sbxId' };
  /* 旧路由兼容：能力 id 从 survey 改名为 interview，老链接/收藏/分享仍要能用 */
  var LEGACY_CAPS = { survey: 'interview' };
  function rewriteLegacyHash(hash) {
    var h = String(hash || '');
    var m = /^#\/([a-z-]+)\/([a-z0-9-]+)(\/|$|\?)/.exec(h);
    if (!m) return h;
    var to = LEGACY_CAPS[m[2]];
    if (!to) return h;
    return h.replace('#/' + m[1] + '/' + m[2], '#/' + m[1] + '/' + to);
  }
  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    var q = {}, qIdx = raw.indexOf('?');
    if (qIdx >= 0) {
      raw.slice(qIdx + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = i >= 0 ? kv.slice(0, i) : kv;
        var v = i >= 0 ? decodeURIComponent(kv.slice(i + 1)) : '1';
        q[k] = v;
      });
      raw = raw.slice(0, qIdx);
    }
    if (!raw) return { domain: 'overview', cap: 'overview', rest: [], q: q };
    var parts = raw.split('/').filter(Boolean);
    return { domain: parts[0], cap: parts[1] || parts[0], rest: parts.slice(2), q: q };
  }
  function buildHash() {
    if (state.cap === 'overview') return '#/overview';
    /* v15：trace 只有一种规范 URL —— #/platform/obs/trace/{traceId}。
       此前从 Agent 详情点「最近调用」会生成 #/platform/agent-wb/{agentId}/trace/{traceId}，
       而解析侧只认 obs 段（rest[0]==='trace'），于是恢复成 tab='trace'、traceId=null，
       页面落到「未知的 Tab：trace」的半空页。统一从生成端收口，解析端另做兼容。 */
    if (state.traceId) return '#/platform/obs/trace/' + encodeURIComponent(state.traceId);
    var p = ['#', state.domain, state.cap];
    if (state.agentId) p.push(state.agentId);
    /* v17 方案乙：知识库详情页的 Tab 不进 hash，所有 Tab 共用同一 URL（防页签堆积）。
       解析端 parseHash 照旧识别 /docs /search 等段，老深链仍可直达。 */
    if (state.tab && state.cap !== 'knowledge') p.push(state.tab);
    var q = capQuery(), keys = Object.keys(q);
    if (keys.length) p.push('?' + keys.map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'));
    return p.join('/');
  }
  /** 当前能力页需写入 URL 的状态（仅当该页有可变状态时输出，保持 hash 干净） */
  function capQuery() {
    var out = {};
    if (state.cap === 'kol') {
      var k = state.kol || {};
      if (k.view) out.view = k.view;
      if (k.budget) out.budget = String(k.budget);
      if (k.goal) out.goal = k.goal;
      if (k.minOverlap) out.minOverlap = String(k.minOverlap);
      if (k.kolId) out.kolId = k.kolId;
      if (k.exclude && k.exclude.length) out.exclude = k.exclude.join(',');
    } else if (state.cap === 'knowledge') {
      /* v17 方案乙：知识库状态不进 URL（页签按完整 hash 去重 → 切 Tab/调参堆同名页签）。
         解析端 hydrateFromQuery / parseHash 保持不变，老链接（?kbView=test&topK=…）仍可直达。 */
    } else {
      var dm = DETAIL_FIELDS[state.cap];
      if (dm && state[dm]) out.detail = state[dm];
      /* v24：网状关系页写进 URL（capQuery 与 hydrateFromQuery 互为逆运算）。
         放在这里而不是给它在路径上开一段，理由见 hydrateFromQuery。
         只在列表层输出：详情页（有 agentId）的 URL 不带它，免得
         #/platform/agent-wb/ag-x/monitor?net=1 这种把两级状态叠在一起的脏链接。 */
      if (state.cap === 'agent-wb' && state.agentPageTab === 'net' && !state.agentId) out.net = '1';
      /* v29：网关的屏内 Tab（MCP 服务 / LLM 路由 / Skill）与网状关系同一套写法 ——
         网关的路径首段被详情对象 id 占着，Tab 不能占路径段（#/platform/gateway/llm 会被
         解析成 objId='llm'，落到「网关服务不存在」的空详情页）。
         只在列表层输出：详情页的 URL 不带它，免得两级状态叠在同一条链接里。 */
      if (state.cap === 'gateway' && !state.agentId && state.gwPageTab && state.gwPageTab !== 'mcp') out.gw = state.gwPageTab;
      /* v33：能力与权限页是**两级分页**，两级都进 URL —— 「沙盒 › 实例与执行明细」要能直达、能分享。 */
      if (state.cap === 'assets') {
        if (state.assetTab && state.assetTab !== 'mcp') out.at = state.assetTab;
        if (state.assetSub) out.as = state.assetSub;
      }
      // 模拟模式随 URL 走，刷新/分享直达后仍停在同一个 tab
      if (state.cap === 'sim-user' && state.simMode) out.simMode = state.simMode;
      /* 沙盒筛选与排序进 URL：「按拦截排序」「只看待处理」这类视图要能分享/刷新保持 */
      if (state.cap === 'sandbox' && state.sbxFilter) {
        var sf = state.sbxFilter;
        if (sf.q) out.sbq = sf.q;
        if (sf.kind) out.sbkind = sf.kind;
        if (sf.status) out.sbstatus = sf.status;
        if (sf.biz) out.sbbiz = sf.biz;
        /* v31：「看同等级的其他沙盒」会把隔离等级作为筛选条件带过来，同样要能分享/刷新保持 */
        if (sf.level) out.sblevel = sf.level;
        if (sf.sort) out.sbsort = sf.sort;
        if (sf.sortDir) out.sbsdir = sf.sortDir;
      }
      /* trace 列表与经验库的排序都进 URL：排障时「按时延倒序」、复核时「按收益分倒序」都是高频视图 */
      if ((state.cap === 'obs' || state.cap === 'llm-exp') && state.sortKey) {
        out.sort = state.sortKey;
        if (state.sortDir) out.dir = state.sortDir;
      }
      if (state.cap === 'obs' && state.page > 1) out.page = String(state.page);
    }
    return out;
  }
  /** 从 URL query 恢复可变状态（刷新/分享直达后保持） */
  function hydrateFromQuery(q) {
    if (!q) return;
    /* v24：Agent 工作台的屏内第二页（网状关系）走 query —— 该能力的路径首段已被 agentId 占用，
       屏内 Tab 不能占路径段（否则 #/platform/agent-wb/net 会被解析成 agentId='net'）。
       这一行同时是「离开该页就复位」的唯一收口：换能力后 q.net 不在，自然回 'list'。 */
    state.agentPageTab = (state.cap === 'agent-wb' && q.net === '1') ? 'net' : 'list';
    /* v29：网关屏内 Tab 的恢复（capQuery 的逆运算）。这一行同时是「离开该页就复位」的
       唯一收口：换能力后 q.gw 不在，自然回 'mcp'。非法值一律回落默认页，不留半空页。 */
    state.gwPageTab = (state.cap === 'gateway' && (q.gw === 'llm' || q.gw === 'skill')) ? q.gw : 'mcp';
    /* v33：能力与权限页的两级分页还原（白名单，与序列化对称）。
       二级 as 只做「小写字母」的形状校验，具体归属由渲染层按一级分页收口
       （给错组合时渲染层会退回该类第一项，不会渲染出空白页）。 */
    var AT_OK = { mcp: 1, skill: 1, kb: 1, sandbox: 1, policy: 1 };
    state.assetTab = (state.cap === 'assets' && AT_OK[q.at]) ? q.at : 'mcp';
    state.assetSub = (state.cap === 'assets' && /^[a-z]{2,12}$/.test(String(q.as || ''))) ? q.as : null;
    if (state.cap === 'kol') {
      if (q.view || q.budget || q.goal || q.minOverlap || q.exclude || q.kolId) {
        state.kol = {
          view: q.view || 'board', budget: q.budget ? Number(q.budget) : 100000,
          goal: q.goal || 'roi', minOverlap: q.minOverlap ? Number(q.minOverlap) : 0,
          kolId: q.kolId || null, exclude: q.exclude ? q.exclude.split(',').filter(Boolean) : []
        };
      }
    } else if (state.cap === 'knowledge') {
      state.kb = { view: q.kbView || 'list', q: q.kbq || '', kbId: q.kb || null, topK: q.topK ? Number(q.topK) : 5, th: q.th != null ? Number(q.th) : 0.72 };
    } else {
      state.personaId = state.cap === 'persona' ? (q.detail || null) : null;
      state.simId = state.cap === 'sim-user' ? (q.detail || null) : null;
      state.simMode = state.cap === 'sim-user' ? (q.simMode || 'single') : null;
      state.interviewId = state.cap === 'interview' ? (q.detail || null) : null;
      state.sbxId = state.cap === 'sandbox' ? (q.detail || null) : null;
      /* 恢复沙盒筛选/排序（capQuery 的逆操作，见上） */
      if (state.cap === 'sandbox' && (q.sbq || q.sbkind || q.sbstatus || q.sbbiz || q.sblevel || q.sbsort)) {
        state.sbxFilter = {
          q: q.sbq || '', kind: q.sbkind || '', status: q.sbstatus || '', biz: q.sbbiz || '',
          level: q.sblevel || '', sort: q.sbsort || '', sortDir: q.sbsdir || ''
        };
      }
      /* 恢复 trace 列表与经验库的排序；页码只有 trace 列表有 */
      if (state.cap === 'obs' || state.cap === 'llm-exp') {
        if (q.sort) { state.sortKey = q.sort; state.sortDir = q.dir || 'desc'; }
      }
      if (state.cap === 'obs' && q.page) state.page = Number(q.page) || 1;
    }
  }
  var lastDetailHash = null;
  /** 详情弹窗 deep-link：URL 带 detail 时渲染后自动弹开；同 URL 不重复弹，避免关闭后被其它重渲染再次唤起 */
  function openDetailIfAny() {
    /* v10：detailType 已接管的能力走真详情页（路由），不再叠弹窗 */
    var _c = capById(state.cap);
    if (state.agentId && _c && _c.detailType) { lastDetailHash = location.hash; return; }
    var map = { persona: 'persona-detail', 'sim-user': 'sim-test', interview: 'interview-result', sandbox: 'sbx-detail' };
    var dm = DETAIL_FIELDS[state.cap];
    var id = dm ? state[dm] : null;
    if (!id) { lastDetailHash = null; return; }
    if (lastDetailHash === location.hash) return;
    lastDetailHash = location.hash;
    try { if (document.querySelector && document.querySelector('.modal-mask')) return; } catch (e) {}
    var A = global.ACTIONS || {}, act = map[state.cap];
    if (act && A[act]) { try { A[act](id, null, helpers()); } catch (e) { lastDetailHash = null; } }
  }
  /* v39：**就地重渲染不换页**时的阅读位置保持。
     起因（2026-10-19）：Agent 详情 ›「管理 › 联系」页点卡片展开、拨开关、改参数，
     每次都 `navigate({})` 重画 —— 而 navigate 默认把 #content 的 scrollTop 归零，
     于是「点一张卡，整页跳回顶部」，用户得重新往下滚。那一页是 26 张卡片的长墙，
     这个跳顶等于每动一下就丢一次上下文。
     约定：动作为同一屏内的**状态改写**（不改 agentId / cap / tab）时传 `{scroll:'keep'}`，
     记下 #content 的当前位置，渲染完再写回；换屏/换页签仍归零（那本来就该从顶部看起）。
     ⚠ 必须走 pending + render 消费，不能"navigate 末尾直接写回"：
       若 hash 变了，render 是 hashchange 里异步跑的，那时写回的值会被再画一次抹掉。 */
  var pendingScrollKeep = null;
  function navigate(next, opts) {
    /* v37：换屏 / 换页签前先记下会话流的阅读位置 —— 必须在 Object.assign 之前，
       否则键已经换成新的 agentId|tab，记到的是"新位置"的名下。 */
    if (next && (next.agentId !== undefined || next.tab !== undefined)) {
      memoFeedScroll();
      feedRestorePending = true;
    }
    if (opts && opts.scroll === 'keep') {
      var _ctk = $('content');
      pendingScrollKeep = _ctk ? (_ctk.scrollTop || 0) : null;
    }
    Object.assign(state, next);
    /* v10b：域随能力走（域重划收口）—— 导航点里硬编码的 domain 可能落后于 CAPS 注册表
       （compliance 已从 engine 迁到 govern，旧调用还写 domain:'engine' 会高亮错域）。
       以注册表为准统一纠正，一处收口，胜过逐个调用点改字符串。 */
    if (state.cap) {
      var _nc = capById(state.cap);
      if (_nc && !_nc.__miss && _nc.domain !== 'overview' && state.domain !== _nc.domain) state.domain = _nc.domain;
    }
    var h = buildHash();
    /* 路由变了就先把残留弹层收掉：否则弹窗会盖在刚跳过去的页面上（用户还得自己再点一次 ×）。
       放在改 hash 之前 —— 渲染过程中新开的弹窗（如详情预览）不受影响。 */
    if (location.hash !== h) closeModals();
    if (location.hash === h) render();
    else location.hash = h;
    if (opts && opts.scroll === 'keep') {
      /* v39：位置由 render 末尾写回（pendingScrollKeep）—— 这里既不归零也不立刻写，
         免得把刚恢复好的值又抹成 0；异步 hashchange 那条路也由 render 接手。 */
    } else if (!opts || opts.scroll !== false) {
      var ct = $('content'); if (ct) ct.scrollTop = 0;
    }
  }

  /* 关闭所有残留弹层。详情预览弹窗与创建表单都是 DOM 注入，没有统一注册表，只能按选择器收。 */
  function closeModals() {
    try {
      if (!document.querySelectorAll) return;
      var nodes = document.querySelectorAll('.modal-mask, .v10-sheet-mask, .v10-sheet');
      for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].remove) nodes[i].remove();
      /* 顶栏通知面板也要收：它是常驻 DOM（不是动态插入的遮罩），靠 .hidden 开关，
         所以是"收起"而不是 remove —— 用 remove 会把顶栏铃铛的容器一起报销。
         它同样会被页签条切换那条路径留下：面板还开着，人已经到了另一屏。 */
      var notif = document.getElementById('v10-notif');
      if (notif && notif.classList) notif.classList.add('hidden');
    } catch (e) { /* 收不掉不影响导航 */ }
  }

  /* SECTION: icons */
  var PATHS = {
    /* v32：返回上一级用的左箭头。此前 registry 里没有方向类图标（43 个里最接近的只有 play/house），
       而「返回」是详情页最常用的动作之一 —— 补一个；图形仍是纯折线，可自证不会画歪。 */
    back: '<path d="M15 5l-7 7 7 7"/><path d="M8.6 12H21"/>',
    /* v32：筛选胶囊右侧的下拉指示（DS 控制台用量页的筛选长这样）。 */
    caret: '<path d="M6 9.5l6 6 6-6"/>',
    /* v32：思考行（DSH 的 IconThinkOutlineRegular 位置）用的灯泡。 */
    bulb: '<path d="M12 3.5a5.5 5.5 0 0 0-3.2 9.9c.5.4.7 1 .7 1.6v.5h5v-.5c0-.6.2-1.2.7-1.6A5.5 5.5 0 0 0 12 3.5z"/><path d="M9.5 18.5h5M10.5 21h3"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    house: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
    signal: '<path d="M4 18v-4M9 18V8M14 18v-7M19 18V4"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
    /* v24b：服务身份图标。6 个 MCP 服务此前在健康墙上只有一个绿点 + 等宽名字，
       整屏长得一模一样；这些图形按「这个服务干什么」选，配合 seed 里的 tone 色相使用。 */
    crm: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="M5 16.4c.9-1.9 5.1-1.9 6 0"/><path d="M13.5 9.5h4.5M13.5 13h3.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    ticket: '<path d="M4 8.5h16v2a1.5 1.5 0 0 0 0 3v2H4v-2a1.5 1.5 0 0 0 0-3z"/><path d="M9 8.5v7"/>',
    order: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
    parse: '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/><circle cx="11" cy="15" r="2.2"/><path d="M12.7 16.7l2 2"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 19a2 2 0 0 0 3 0"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
    /* v25c：企业与标签的身份图标（走查意见：「这个为什么没图标」→ 再「不要 emoji」）。
       行业 6 个（含兜底 building）+ 标签 16 个（含兜底 label）。
       图形只用 rect / circle / line / 简单折线 —— 不写自由曲线：这样每个图形的落点都能靠坐标
       推出来，没有浏览器也能自证不会画歪（渲染宽度统一 14px，见 .ico-i）。 */
    factory: '<path d="M3 20V11l5 3V11l5 3V8l8 4.5V20z"/><path d="M6.5 20v-3.2h3V20"/>',
    store: '<path d="M4 9.5V20h16V9.5"/><path d="M3 9.5l1.6-5h14.8L21 9.5z"/><path d="M9.5 20v-5.5h5V20"/>',
    bank: '<path d="M3 9.5l9-5 9 5"/><path d="M6 10.5v7M10 10.5v7M14 10.5v7M18 10.5v7"/><path d="M3 20h18"/>',
    seal: '<rect x="4.5" y="13.5" width="15" height="6.5" rx="1.5"/><path d="M9 13.5V9a3 3 0 0 1 6 0v4.5"/><path d="M12 4.2V2.5"/>',
    cart: '<path d="M3 4.5h2.4l2.6 11h9.6l1.9-8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
    building: '<rect x="5" y="4" width="14" height="16.5" rx="1.5"/><path d="M9 8.5h2M13 8.5h2M9 12.5h2M13 12.5h2"/><path d="M10.5 20.5v-4h3v4"/>',
    people: '<circle cx="9" cy="9" r="2.3"/><path d="M4.8 18c.9-2.9 6.3-2.9 8.4 0"/><circle cx="17" cy="9.5" r="1.9"/><path d="M14.4 18c.5-1.9 3.4-2.6 5.1-1.3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5"/>',
    server: '<rect x="4" y="4" width="16" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.5"/><circle cx="7.6" cy="7.2" r=".9"/><circle cx="7.6" cy="16.7" r=".9"/>',
    tag: '<path d="M12.6 3.5H5.5a2 2 0 0 0-2 2v7.1l9 9 9.1-9.1z"/><circle cx="8.2" cy="8.2" r="1.5"/>',
    pin: '<path d="M12 21c4-4.2 6-7.4 6-10a6 6 0 1 0-12 0c0 2.6 2 5.8 6 10z"/><circle cx="12" cy="11" r="2.2"/>',
    shield: '<path d="M12 3l7 2.8v6.1c0 4.3-2.9 7.5-7 9.1-4.1-1.6-7-4.8-7-9.1V5.8z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.2"/>',
    flask: '<path d="M9.5 3h5"/><path d="M10.5 3v6.2L5.9 17.6a2 2 0 0 0 1.7 2.9h8.8a2 2 0 0 0 1.7-2.9L13.5 9.2V3"/><path d="M7.6 15h8.8"/>',
    scales: '<path d="M12 3.5v17"/><path d="M5 6.5h14"/><path d="M5 6.5L2.5 13h5z"/><path d="M19 6.5L16.5 13h5z"/>',
    policy: '<path d="M6 3h7.5L18 7.5V21H6z"/><path d="M13.5 3v4.5H18"/><circle cx="11.5" cy="15" r="2.6"/>',
    checklist: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 9l1.4 1.4L12 8"/><path d="M14 9.5h3.5"/><path d="M8 15.5l1.4 1.4L12 14.5"/><path d="M14 16h3.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.6 2.1"/>',
    currency: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.6 10.5h4.8M9.6 13.2h4.8"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.6M12 17.9v2.6M4.9 7.6l2.2 1.3M16.9 15.1l2.2 1.3M4.9 16.4l2.2-1.3M16.9 8.9l2.2-1.3"/>',
    /* v40：一级导航底部的「设置」。
       v42（2026-10-22，业主：「图标换成齿轮」）：原先用滑杆，现换成齿轮。
       没复用上面的 gear —— 它是"圆环 + 六根外伸短齿"，缩到 21px 齿只剩 2.6px 的刺，
       看着像太阳；而 gear 已被「自助服务」标签和 Agent 联系页的「工具」用着，不能为此改形。
       v43（2026-10-24，业主：「齿轮中间歪了」）：第一版手写坐标，外轮廓纵向范围 3.2–23.2，
       中心在 13.2，而中心孔画在 12 —— 整体偏下 1.2，孔看着往上飘。
       现在不手写了：按角度算点，八齿、齿宽 ±11.5°、外径 9.4、根径 6.9，中心严格落在 12,12。
       外轮廓 bbox 与孔的 bbox 实测同心（都是 12,12），顺带消掉了手写版八颗齿大小不一的问题。
       六齿试过：齿距太大，齿显得又长又细，21px 下反而不如八齿结实。 */
    settings: '<path d="M10.13 2.79L13.87 2.79L13.61 5.29L15.81 6.25L17.19 4.16L19.84 6.81L17.88 8.39L18.76 10.62L21.21 10.13L21.21 13.87L18.71 13.61L17.75 15.81L19.84 17.19L17.19 19.84L15.61 17.88L13.38 18.76L13.87 21.21L10.13 21.21L10.39 18.71L8.19 17.75L6.81 19.84L4.16 17.19L6.12 15.61L5.24 13.38L2.79 13.87L2.79 10.13L5.29 10.39L6.25 8.19L4.16 6.81L6.81 4.16L8.39 6.12L10.62 5.24Z"/><circle cx="12" cy="12" r="3.2"/>',
    /* v46：设置新增「外观 / 快捷键 / 数据管理 / 安全中心」四屏，各配一枚图标 */
    /* 外观用「A a」而不是调色盘：调色盘缩到 16px 只剩一圈加三个点，像笑脸 */
    typeface: '<path d="M3 18.5L7.2 6l4.2 12.5"/><path d="M4.6 14.6h5.2"/><path d="M13.6 18.5L16.4 11l2.8 7.5"/><path d="M14.6 16.2h3.6"/>',
    keyboard: '<rect x="2.5" y="6.5" width="19" height="11" rx="2.2"/><path d="M6.2 10.2h.01M9.1 10.2h.01M12 10.2h.01M14.9 10.2h.01M17.8 10.2h.01M8.4 13.8h7.2"/>',
    /* 二级菜单底部的「收起侧边栏」：圆角方框 + 左侧竖线，与常见编辑器的 sidebar 图标同构 */
    sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9 4.5v15"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.8 18.6h2.4"/>',
    label: '<path d="M4 6.5h16v11H4z"/><path d="M8 10.5h8M8 14h5"/>',
    /* v25d：文档类型图标（原先是 emoji 📜📑📘📋📝📊💬🎓🗂，走查要求不用 emoji）。
       这几个只替换 emoji 的图标位；正文里的 ⚠ / ✓ / ✕ 是文字标记不是图标，保持不动。 */
    contract: '<path d="M6 3h7.5L18 7.5V21H6z"/><path d="M13.5 3v4.5H18"/><path d="M9 12h6M9 15.5h4"/><circle cx="15.5" cy="17.5" r="2"/>',
    book: '<path d="M4 5.5h6.5v15H4z"/><path d="M10.5 5.5H20v15h-9.5z"/><path d="M4 5.5c2-1 4.5-1 6.5 0"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9.5 4.5V3h5v1.5"/><path d="M8.5 10.5h7M8.5 14.5h4.5"/>',
    form: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M8 9.5h8M8 13h8M8 16.5h4"/>',
    cap: '<path d="M3 9.5l9-4 9 4-9 4z"/><path d="M7 11.5V16c0 1.6 10 1.6 10 0v-4.5"/><path d="M21 9.5V15"/>',
    folder: '<path d="M3.5 19V6h5l1.6 2h10.4v11z"/><path d="M3.5 9.5h17"/>'
  };
  function icon(name, size) {
    var p = PATHS[name] || PATHS.doc;
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }

  /* SECTION: fmt */
  var fmt = {
    int: function (n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); },
    num1: function (n) { return n == null ? '—' : Number(n).toFixed(1); },
    num2: function (n) { return n == null ? '—' : Number(n).toFixed(2); },
    pct1: function (n) { return n == null ? '—' : (n * 100).toFixed(1) + '%'; },
    pct2: function (n) { return n == null ? '—' : (n * 100).toFixed(2) + '%'; },
    pct0: function (n) { return n == null ? '—' : Math.round(n * 100) + '%'; },
    // 金额：< 100 保留两位小数，避免 ¥0.4 被显示成 ¥0 而误导
    money: function (n) {
      if (n == null) return '—';
      var v = Number(n);
      var d = Math.abs(v) < 100 ? 2 : 0;
      return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    money2: function (n) { return n == null ? '—' : '¥' + Number(n).toFixed(2); },
    money4: function (n) { return n == null ? '—' : '¥' + Number(n).toFixed(4); },
    dur: function (ms) { return C.fmtDur(ms); },
    compact: function (n) { return C.fmtNum(n); },
    dt: function (ts) {
      var d = new Date(ts);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    },
    date: function (ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    rel: function (dayOffset) {
      if (dayOffset === 0) return '今天';
      if (dayOffset === -1) return '昨天';
      return Math.abs(dayOffset) + ' 天前';
    },
    wait: function (min) {
      if (min == null) return '—';
      if (min < 0) return '—';
      if (min < 60) return min + ' 分钟';
      return (min / 60).toFixed(1) + ' 小时';
    },
    delta: function (v, opts) {
      opts = opts || {};
      if (v == null) return '<span class="m-delta flat">—</span>';
      var pct = (v * 100);
      var up = pct > 0.05, down = pct < -0.05;
      var good = opts.higherIsBetter === false ? down : up;
      var bad = opts.higherIsBetter === false ? up : down;
      var cls = Math.abs(pct) <= 0.05 ? 'flat' : (good ? 'up' : (bad ? 'down' : 'flat'));
      var arrow = Math.abs(pct) <= 0.05 ? '→' : (up ? '↑' : '↓');
      var isPp = opts.pp;
      var txt = isPp ? (arrow + ' ' + Math.abs(pct).toFixed(2) + 'pp') : (arrow + ' ' + Math.abs(pct).toFixed(1) + '%');
      return '<span class="m-delta ' + cls + '">' + txt + '</span>';
    }
  };
  function esc(s) { return C.esc(s); }
  /* 行内头像 —— 规格：用户用头像，不只给名字文字。
     颜色由姓名哈希决定：**同一人全站同色**，不随所在表格/位置变。
     首字取姓名最后一字（中文姓名"—"→"三"、"—"→"六"；英文取首字母大写）。 */
  /** 姓名 → 基色号（1..6）。与 avatar 同一套哈希，供调用方做「同屏去重」。 */
  function avColor(name) {
    var n = String(name == null ? '' : name).trim();
    var hash = 0;
    for (var i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) % 997;
    return 1 + (hash % 6);
  }
  function avatar(name, opts) {
    var n = String(name == null ? '' : name).trim();
    if (!n || n === '—') return '<span class="muted">—</span>';
    var ch = /^[\u4e00-\u9fa5]+$/.test(n) ? n.slice(-1) : n.slice(0, 1).toUpperCase();
    var hash = 0;
    for (var i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) % 997;
    /* opts.c 可强制色号（1..6）：给「同一屏内不重色」用 —— 详见 kbAccessCard。 */
    var ci = (opts && opts.c) ? opts.c : (1 + (hash % 6));
    var cls = 'av c' + ci + ((opts && opts.lg) ? ' lg' : '');
    /* face: true —— 只要圆形首字，不带名字（用于头像位只有 30px 的地方：
       带上名字会被圆框裁成一个孤字，看着像乱码） */
    if (opts && opts.face) return '<span class="' + cls + '" aria-hidden="true">' + esc(ch) + '</span>';
    return '<span class="av-wrap"><span class="' + cls + '" aria-hidden="true">' + esc(ch) + '</span>' +
      '<span>' + esc(n) + '</span></span>';
  }

  /* SECTION: metric-card
   * 指标卡。带 ⓘ 口径说明与数据新鲜度 —— 中台最容易失守的就是"这个数怎么算的"。
   */
  /* metricCard
   * 新增 m.act / m.actId：**异常指标卡可点下钻**。
   * 背景（第 1 屏硬伤②）：指标卡只有 alert 标记，红了也「只能看」——
   *   控制台的要求是「看见的异常要能变成动作」。
   * 纪律：只有真的带 act 时才渲染成 <button>，否则保持 <div>（不动既有布局）。 */
  function metricCard(m) {
    var info = m.definition ? '<button class="m-info" data-tip="' + esc(m.definition) + '" aria-label="口径说明">i</button>' : '';
    var approx = m.approximated ? '<span class="m-approx" data-tip="该指标按调用占比分摊计算，存在近似">≈</span>' : '';
    var inner =
      '<div class="m-label">' + esc(m.label) + info + approx + '</div>' +
      '<div class="m-value">' + esc(m.value) + (m.unit ? '<small>' + esc(m.unit) + '</small>' : '') + '</div>' +
      '<div class="m-foot">' + (m.deltaHtml || '') + (m.sub ? '<span class="m-sub">' + esc(m.sub) + '</span>' : '') + '</div>';
    var cls = 'metric' + (m.alert ? ' metric-alert' : '') + (m.act ? ' metric-act' : '');
    if (m.act) {
      /* 🔴 修复（HTML 内容模型）：这里此前渲染成 <button>…<div class="m-label">…，而 <button> 的
         内容模型是 phrasing content —— 放块级 <div> 不合法，浏览器会**改写 DOM**：同一 .metrics
         里最后一张卡片的 .m-value / .m-foot 被**提到 .ov-grid 这一层**，它们没有 grid-column
         声明 ⇒ 各占一整行 ⇒ "9.32s" 跑到卡片外、横向溢出视口（实测 right=1577 @ 1600 宽）。
         ⇒ 改为 <div role="button" tabindex="0"> ：保持"数字即动作"，
            不产生非法嵌套；键盘可达（Enter / Space 在 bindContent 里统一接）。
         ⚠ 不要再改回 <button>，除非 inner 里不再有块级元素。 */
      return '<div class="' + cls + '" role="button" tabindex="0" data-act="' + esc(m.act) + '"' +
        (m.actId != null ? ' data-id="' + esc(String(m.actId)) + '"' : '') +
        (m.actTitle ? ' title="' + esc(m.actTitle) + '"' : '') +
        ' aria-label="' + esc(m.label + '：' + m.value + (m.actTitle ? '（' + m.actTitle + '）' : '')) + '">' +
        inner + '</div>';
    }
    return '<div class="' + cls + '">' + inner + '</div>';
  }

  /* SECTION: table
   * 通用表格：排序、分页、行点击下钻、空态三分、近似标记。
   */
  function table(opts) {
    var cols = opts.columns, rows = opts.rows || [];
    var sortBy = opts.sortBy, sortDir = opts.sortDir || 'desc';

    if (!rows.length) {
      return '<div class="empty">' +
        '<div class="empty-ico">' + icon('doc', 28) + '</div>' +
        '<div class="empty-title">' + esc(opts.emptyTitle || '暂无数据') + '</div>' +
        '<div class="empty-sub">' + esc(opts.emptySub || '') + '</div>' +
        (opts.emptyAction
          /* create：空态里的主 CTA 往往就是「新建 X」，而 create-open 是从 data-create 取能力 id 的，
             只给 data-act 会让它拿到空 id，弹一句「该能力的新建入口暂未开放」。 */
          ? '<button class="btn-ghost" data-act="' + esc(opts.emptyAction.act) + '"' +
            (opts.emptyAction.create ? ' data-create="' + esc(opts.emptyAction.create) + '"' : '') +
            '>' + esc(opts.emptyAction.text) + '</button>'
          : '') +
        '</div>';
    }

    var sorted = rows.slice();
    if (sortBy) {
      sorted.sort(function (a, b) {
        var x = a[sortBy], y = b[sortBy];
        if (x == null) return 1; if (y == null) return -1;
        if (typeof x === 'string') return sortDir === 'asc' ? x.localeCompare(y) : y.localeCompare(x);
        return sortDir === 'asc' ? x - y : y - x;
      });
    }
    var pageSize = opts.pageSize || 20;
    var page = opts.page || 1;
    var total = sorted.length;
    var pageRows = opts.noPaging ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize);

    var h = '<div class="tbl-wrap"><table class="bt"><thead><tr>';
    cols.forEach(function (c) {
      var cls = (c.align === 'right' ? 'ta-r' : '') + (sortBy === c.key ? ' sorted' : '');
      var arrow = sortBy === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      var hint = c.hint ? '<button class="m-info" data-tip="' + esc(c.hint) + '" aria-label="说明">i</button>' : '';
      h += '<th class="' + cls + '"' + (c.sortable ? ' data-sort="' + esc(c.key) + '"' : '') + '>' + esc(c.label) + arrow + hint + '</th>';
    });
    h += '</tr></thead><tbody>';
    pageRows.forEach(function (r, i) {
      /* v10b（走查 3.1）：行是可点控件，必须键盘可达 —— tabindex + aria-label；
         Enter/Space 在 bindContent() 统一接线（tr 上 role=button 会破坏表格语义，不加）。 */
      var rowAttr = opts.rowAction ? ' class="row-link" tabindex="0" aria-label="查看详情" data-row-act="' + esc(opts.rowAction) + '" data-row-id="' + esc(r[opts.rowIdKey || 'id']) + '"' : '';
      /* row-detail：整行点开一段行内详情（handleRowAction 里已有该分支，但此前**没有任何调用方**
         给它写 data-detail-html —— 等于一个烂尾的接线点。现在由 opts.detailHtml(row) 提供内容。
         内容必须由调用方从**真实数据**里取，不要为了"能点"而编造说明。 */
      if (opts.rowAction === 'row-detail' && typeof opts.detailHtml === 'function') {
        var dh = opts.detailHtml(r);
        if (dh) rowAttr += ' data-detail-html="' + esc(dh) + '"';
      }
      h += '<tr' + rowAttr + '>';
      cols.forEach(function (c) {
        var v = r[c.key];
        var text;
        if (c.render) text = c.render(r, v);
        else if (c.fmt && fmt[c.fmt]) text = esc(fmt[c.fmt](v));
        else text = esc(v == null ? '—' : v);
        h += '<td class="' + (c.align === 'right' ? 'ta-r' : '') + (c.mono ? ' mono' : '') + '">' + text + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    /* 分页器。
       ⚠ total 之前取 `sorted.length`，而 rows 已被上游（如 searchTraces）切成本页那一份，
         于是 total 永远等于本页行数 → `total > pageSize` 恒为 false → 分页器永不渲染。
       所以：调用方若知道真实总数，用 opts.total 传进来，以它为准。 */
    var realTotal = (typeof opts.total === 'number' && opts.total >= 0) ? opts.total : sorted.length;
    if (!opts.noPaging && realTotal > pageSize) {
      var pages = Math.ceil(realTotal / pageSize);
      h += '<div class="pager"><span class="pager-info">共 ' + realTotal + ' 条 · 第 ' + page + '/' + pages + ' 页</span><span class="pager-btns">';
      h += '<button class="pager-btn' + (page <= 1 ? ' disabled' : '') + '" data-page="' + (page - 1) + '" aria-label="上一页">‹</button>';
      for (var p = 1; p <= pages; p++) {
        if (pages > 9 && Math.abs(p - page) > 3 && p !== 1 && p !== pages) { if (Math.abs(p - page) === 4) h += '<span class="pager-gap">…</span>'; continue; }
        h += '<button class="pager-btn' + (p === page ? ' on' : '') + '" data-page="' + p + '">' + p + '</button>';
      }
      h += '<button class="pager-btn' + (page >= pages ? ' disabled' : '') + '" data-page="' + (page + 1) + '" aria-label="下一页">›</button>';
      h += '</span></div>';
    } else if (!opts.noPaging && realTotal > 0 && opts.total != null) {
      h += '<div class="pager"><span class="pager-info">共 ' + realTotal + ' 条</span></div>';
    }
    return h;
  }

  /* SECTION: status-pill */
  var STATUS_MAP = {
    ok: { cls: 'ok', text: '正常' }, info: { cls: 'info', text: '运行中' },
    warn: { cls: 'warn', text: '待处理' }, bad: { cls: 'bad', text: '异常' },
    idle: { cls: 'idle', text: '已停止' }
  };
  /* SECTION: status-tone —— 状态 → 色 的**唯一**对照表（v28 一致性修复）
     为什么必须"唯一"：这不只是观感。同一句文案在不同屏配不同颜色时，
     红绿色盲用户判不出状态 —— 色相是他们拿不到的冗余通道，文字必须与颜色一一对应。
     修复前实测 4 组冲突（跨 46 屏）：
       P2 → .info / .ok / .warn（.ok 来自 data.js 里一条 levelKind 写错、.warn 来自另一屏的 P0/P1/P2 三元式）
       处理中 → .wip / .info（.wip 在 CSS 里根本没有定义 ⇒ 渲染成无底色裸文字）
       待处理 → .open / .idle（.open 同样没有 CSS 定义 ⇒ 无底色裸文字）
       业务运营管理员 → .warn / .info（角色卡对"我的角色"特判成 info）
     取色依据是"本平台既有用法"，不新造色：
       P0/P1/P2/P3 = bad/warn/info/idle —— 与 data.js 的 severity 表和 renderers2 的安全事件表一致；
       待处理 = idle（灰）—— 与 v10-detail-gov 审批阶梯里"尚未轮到的节点 = 灰"一致；
                            若改成琥珀，那一屏的"审批中(warn)"与"待处理"会撞成同色，反而更糟。
       处理中 = info（蓝）、已处理 = ok（绿）—— 与 badcase 队列的 处理中=info 一致。
     别名（wip / open / done）也要收：这三个类名在 CSS 里没有定义，
     走 STATUS_MAP 兜底会把它们原样写进 class，pill 就退化成"没有底色的纯文字"。 */
  var STATUS_TONE = {
    'P0': 'bad', 'P1': 'warn', 'P2': 'info', 'P3': 'idle',
    '待处理': 'idle', '处理中': 'info', '已处理': 'ok',
    wip: 'info', open: 'idle', done: 'ok'
  };
  function pillTone(kind, text) {
    var alias = STATUS_TONE[kind];
    if (alias) return alias;
    var t = String(text == null ? '' : text).trim();
    return STATUS_TONE[t] || kind;
  }
  function pill(kind, text) {
    kind = pillTone(kind, text);
    var m = STATUS_MAP[kind] || { cls: kind || 'info' };
    return '<span class="pill ' + (m.cls || kind) + '">' + esc(text || m.text) + '</span>';
  }

  /* SECTION: range-picker
   * 2026-10-21 业主：「界面不要出现这个」—— 近 1 小时 / 6 小时 / 24 小时 / 7 天 / 30 天 这排按钮全站移除。
   * 单人系统看的是"现在这套系统跑得怎么样"，不是审计员按窗口切报表；
   * 页面一律按默认窗口（state.range 初值）取数，口径写在页脚「数据口径与说明 › 统计范围」里，不再给人切。
   * 要恢复：把下面 return 换成原来的按钮组即可（data-range 的分发逻辑仍在 app.js bindShell 里，未删）。 */
  function rangePicker(current) {
    return '';
  }

  /* SECTION: meta-bar
   * 数据说明条：口径、时间范围、新鲜度、样本量、近似声明。
   * 每个数据页都必须有 —— 这是"当真数据处理"的可见证据。
   */
  function metaBar(meta, extra) {
    var items = [];
    if (meta && meta.range) {
      items.push({ k: '统计范围', v: meta.range.rangeLabel + '（' + fmt.date(meta.range.from) + ' ~ ' + fmt.date(meta.range.to - 1) + '）' });
      if (meta.range.note) items.push({ k: '完整性', v: meta.range.note, warn: true });
    }
    if (meta && meta.sampleNote) items.push({ k: '样本', v: meta.sampleNote });
    if (meta && meta.approximated && meta.approximationNote) items.push({ k: '近似说明', v: meta.approximationNote, warn: true });
    if (meta && meta.affectedRatio > 0) {
      items.push({ k: '受事故影响', v: (meta.affectedRatio * 100).toFixed(1) + '% 的调用处于事故区间内，指标含异常时段', warn: true });
    }
    if (meta && meta.attribution && meta.attribution.coverage < 1) {
      items.push({ k: '归因覆盖率', v: (meta.attribution.coverage * 100).toFixed(1) + '%（' + fmt.int(meta.attribution.unknown) + ' 次调用未标记来源）', warn: true });
    }
    if (extra) items = items.concat(extra);
    var fr = Q.freshness();
    items.push({ k: '数据截至', v: fr.text });
    items.push({ k: '数据集', v: fr.dataset });

    /* 标题的"N 项"只用来给**实质口径**计数。
       有 3 个详情屏（画像 / 知识库 / 合规详情）传进来的 extra 是空，整块只剩"数据截至 + 数据集"两行，
       标题却仍然写「数据口径与说明（2 项）」—— 承诺了口径，端上来的只有一句通用占位，比不写更容易被追问。
       这种情况下如实降级成「数据说明」，并在原有语义上加一句"本屏无额外口径"，
       而不是把这两行硬塞进"口径"里凑数。 */
    var GENERIC = { 数据截至: 1, 数据集: 1 };
    var substantive = items.filter(function (i) { return !GENERIC[i.k]; }).length;
    var head = substantive
      ? '数据口径与说明（' + items.length + ' 项）'
      : '数据说明（本屏无额外口径，仅标明数据时点与数据集）';
    /* 2026-10-20 走查修复：这块在总览页占 584px / 34.4% 屏高，LLM 经验库 22%、网红营销 20.7% ——
       它原本几乎全占在"给评审看的注释"上，把真正的内容挤到首屏之外。
       改成原生 <details> 默认收起：标题行仍写清有几项（不藏责任），点一下看全文。
       原生元素的好处是不用额外 JS，键盘 Enter/Space 天然可用。 */
    return '<details class="meta-bar"><summary class="meta-bar-h">' + esc(head) + '</summary><dl class="meta-list">' +
      items.map(function (i) {
        return '<div class="meta-row' + (i.warn ? ' warn' : '') + '"><dt>' + esc(i.k) + '</dt><dd>' + esc(i.v) + '</dd></div>';
      }).join('') + '</dl></details>';
  }

  /** 单个指标的口径浮层内容 */
  function definitionsBlock(defs) {
    if (!defs) return '';
    return '<div class="defs">' + Object.keys(defs).map(function (k) {
      return '<div class="def-row"><b>' + esc(k) + '</b><span>' + esc(defs[k]) + '</span></div>';
    }).join('') + '</div>';
  }

  /* SECTION: nav-render */
  function renderRail() {
    var h = '<button class="rail-item' + (state.cap === 'overview' ? ' active' : '') + '" data-nav="overview" title="工作台总览" aria-label="工作台总览">' +
      icon('grid', 22) + '<span class="rail-label">总览</span></button>';
    h += '<span class="rail-sep"></span>';
    h += DOMAINS.map(function (d) {
      return '<button class="rail-item' + (d.id === state.domain && state.cap !== 'overview' ? ' active' : '') + '" data-nav="' + d.id + '" title="' + esc(d.name) + '" aria-label="' + esc(d.name) + '">' +
        icon(d.icon, 22) + '<span class="rail-label">' + esc(d.name) + '</span></button>';
    }).join('');
    /* v40：底部设置入口。不进 DOMAINS —— 它是全局设置，点开是弹层不是切页，
       所以不给 active 态（否则会出现"切到平台域，设置却亮着"的错信号）。 */
    h += '<span class="rail-foot"><span class="rail-sep"></span>' +
      '<button class="rail-item" data-act="open-settings" title="设置" aria-label="设置">' +
      icon('settings', 22) + '<span class="rail-label">设置</span></button></span>';
    els.rail.innerHTML = h;
  }

  /* 二级菜单首行：「域 · N 项能力」+ 右侧的收起按钮。
     收起后按钮留在 44px 窄条的上端，原位还能点 —— 不给用户"收起来就找不回来"的坑。 */
  function smHead(labelHtml) {
    /* 收起状态挂在 body 上（v40 负责），这里读一次决定 aria 与提示文案，
       避免重渲染后 aria-expanded 又变回 true */
    var col = global.document && global.document.body.classList.contains('pf-sub-collapsed');
    return '<div class="sm-head"><div class="sm-title">' + labelHtml + '</div>' +
      '<button type="button" class="sm-collapse" data-act="toggle-sub"' +
      ' title="' + (col ? '展开侧边栏' : '收起侧边栏') + '"' +
      ' aria-label="' + (col ? '展开侧边栏' : '收起侧边栏') + '"' +
      ' aria-expanded="' + (col ? 'false' : 'true') + '">' +
      icon('sidebar', 16) + '</button></div>';
  }
  function renderSubmenu() {
    if (state.cap === 'overview') {
      els.submenu.innerHTML = smHead('总览') +
        '<button class="sm-item active">' + icon('grid', 16) + '<span>工作台总览</span></button>' +
        '<div class="sm-sep"></div><div class="sm-title">快捷入口</div>' +
        ['agent-wb', 'obs', 'cost', 'assets'].map(function (id) {
          var c = capById(id);
          return '<button class="sm-item" data-cap="' + id + '">' + icon(c.icon, 16) + '<span>' + esc(c.name) + '</span></button>';
        }).join('');
      return;
    }
    var d = DOMAINS.filter(function (x) { return x.id === state.domain; })[0] || DOMAINS[0];
    /* v33b：menu:false 的能力**不进侧栏** —— 内容已并进「能力与权限」页的二级分页
       （gateway → 连接器 › 服务健康与密钥 / LLM 路由；sandbox → 沙盒 › 实例与执行明细）。
       能力对象本身保留：详情路由 #/platform/gateway/{id}、#/platform/sandbox/{id} 与既有断言照旧成立。 */
    var caps = CAPS.filter(function (c) { return c.domain === d.id && c.menu !== false; });
    var h = smHead(esc(d.name) + '域 · ' + caps.length + ' 项能力');
    /* v10b（走查 2.2）：域内能力支持分组 —— 当时治理域 6 项拆「质量与进化 / 风险与权限」。
       v27 域划分回到三域后**没有任何域再声明 groups**，这条分支目前是空转（保留实现：
       将来某个域超 8 项时可给它加 groups，不必再改这里）。 */
    var smItem = function (c) {
      return '<button class="sm-item' + (c.id === state.cap ? ' active' : '') + '" data-cap="' + c.id + '">' + icon(c.icon, 16) + '<span>' + esc(c.name) + '</span></button>';
    };
    if (d.groups && d.groups.length) {
      d.groups.forEach(function (g) {
        var items = g.caps.map(function (id) { return capById(id); }).filter(function (c) { return c && !c.__miss; });
        if (!items.length) return;
        h += '<div class="sm-sep"></div><div class="sm-title">' + esc(g.label) + ' · ' + items.length + '</div>' + items.map(smItem).join('');
      });
      /* 分组之外的域内能力（防漏网） */
      var grouped = {};
      d.groups.forEach(function (g) { g.caps.forEach(function (id) { grouped[id] = 1; }); });
      var rest = caps.filter(function (c) { return !grouped[c.id]; });
      if (rest.length) h += '<div class="sm-sep"></div><div class="sm-title">其他 · ' + rest.length + '</div>' + rest.map(smItem).join('');
    } else {
      h += caps.map(smItem).join('');
    }
    els.submenu.innerHTML = h;
  }

  function capById(id) {
    for (var i = 0; i < CAPS.length; i++) if (CAPS[i].id === id) return CAPS[i];
    /* 路由未命中：不静默兜底（否则点错链接会莫名落到总览，用户以为自己在目标页）。
       标记出来，由 render() 决定是提示还是继续兜底。 */
    return { id: id, name: id, domain: 'overview', pageType: '__routeMiss__', desc: '', __miss: true };
  }

  /** 路由未命中提示条：说清「你要去的地址不存在」+ 给出正确入口，而不是默默把人丢到总览 */
  function routeMissBar(rawCap) {
    return '<div class="card" style="border-left:3px solid var(--amber)">' +
      '<div class="card-h pad"><h3>地址不存在：' + esc(rawCap) + '</h3>' +
      '<span class="card-sub">这个链接指向的能力已不存在或改名了。可能是旧书签、复制粘贴时的链接，或页面入口调整。</span></div>' +
      '<div class="pad" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<a class="btn-ghost" href="#/overview">回工作台总览</a>' +
      '<span class="muted">当前地址：' + esc(location.hash || '#/') + '</span>' +
      '</div></div>';
  }

  /* SECTION: breadcrumb —— 已下线：dsh 会话屏顶部只有一条 header，面包屑是信息重复的一层，压掉。
     保留函数外壳与调用点（render / v10Shell 仍会调用），不再产出面包屑 DOM。
     ⚠ 容器 #crumb 由 HTML 侧移除，init() 里 getElementById('crumb') 会拿到 null —— 渲染路径走 null 短路。 */
  function renderBreadcrumb() {
    if (els && els.crumb) els.crumb.innerHTML = '';
  }
  /* 对象名解析：交给 V10UI 的统一实现（按 CAPS 的 table/queue 取行），解析不到返回 '' */
  function objectNameOf(cap, id) {
    var V = global.V10UI;
    return (V && typeof V.objectNameOf === 'function') ? V.objectNameOf(cap, id) : '';
  }
  function tabLabel(t) {
    var M = { orchestrate: '编排配置', debug: '调试运行', monitor: '运行监控', versions: '版本与发布', quality: '质量与 badcase', cost: '成本', deps: '引用与依赖' };
    return M[t] || t;
  }

  /* SECTION: search */
  function searchIndex() {
    var idx = [];
    CAPS.forEach(function (c) {
      /* menu:false 的能力不在侧栏，也不进搜索 —— 否则搜到一个侧栏里没有的页面（审批已下线） */
      if (c.id === 'overview' || c.menu === false) return;
      idx.push({ kind: 'cap', name: c.name, desc: c.desc, icon: c.icon, domain: c.domain, nav: { domain: c.domain, cap: c.id, agentId: null, tab: null, traceId: null } });
    });
    idx.push({ kind: 'cap', name: '工作台总览', desc: '待办与健康总览', icon: 'grid', domain: 'overview', nav: { domain: 'overview', cap: 'overview', agentId: null, tab: null, traceId: null } });
    S.AGENTS.forEach(function (a) {
      idx.push({
        kind: 'agent', name: a.name, desc: a.desc, icon: 'bot', domain: capById('agent-wb').domain,
        nav: { domain: capById('agent-wb').domain, cap: 'agent-wb', agentId: a.id, tab: null, traceId: null },
        badge: a.retiredAt !== undefined ? '已下线' : (a.grayVersion ? '灰度 ' + Math.round(a.grayRatio * 100) + '%' : 'v' + a.online.slice(1))
      });
    });
    // 操作命令（v10b：域引用一律从 capById 取 —— 域重划后不再手写 domain 字符串）
    [
      { name: '创建 Agent', cap: 'agent-wb' },
      { name: '查看失败 trace', cap: 'obs' },
      { name: '成本归因分析', cap: 'cost' },
      { name: '能力与权限总览', cap: 'assets' }
    ].forEach(function (o) {
      var cc = capById(o.cap);
      idx.push({ kind: 'cmd', name: o.name, desc: '快捷操作', icon: 'play', nav: { domain: cc.domain, cap: o.cap, agentId: null, tab: null, traceId: null } });
    });
    return idx;
  }
  var SEARCH_IDX = null;
  function doSearch(kw) {
    if (!SEARCH_IDX) SEARCH_IDX = searchIndex();
    var q = kw.trim().toLowerCase();
    if (!q) { hideSearchPop(); return; }
    var hits = SEARCH_IDX.filter(function (it) {
      return it.name.toLowerCase().indexOf(q) > -1 || (it.desc || '').toLowerCase().indexOf(q) > -1;
    }).slice(0, 12);
    // traceId 直达
    var tp = F.parseTraceId(q);
    if (tp) {
      var t = F.getTrace(q.trim());
      if (t) hits.unshift({ kind: 'trace', name: q.trim(), desc: t.agentName + ' · ' + fmt.dt(t.ts) + ' · ' + (t.status === 'failed' ? '失败' : '成功'), icon: 'signal', nav: { domain: 'platform', cap: 'obs', agentId: null, tab: null, traceId: q.trim() } });
    }
    if (!hits.length) {
      els.searchPop.innerHTML = '<div class="sp-empty">未找到与「' + esc(kw) + '」匹配的能力、Agent 或 traceId</div>';
      els.searchPop._hits = null;
    } else {
      var KIND = { cap: '能力', agent: 'Agent', cmd: '操作', trace: 'Trace' };
      /* v10b（走查 3.3）：listbox 声明了 role 就得实现模式 —— 选项带 id 供
         aria-activedescendant 引用，上下键导航见 bindShell 里的 keydown。 */
      els.searchPop.innerHTML = hits.map(function (it, i) {
        return '<button class="sp-item" id="sp-opt-' + i + '" data-si="' + i + '" role="option" aria-selected="false">' + icon(it.icon, 16) +
          '<span class="sp-main"><span class="sp-name">' + esc(it.name) + '</span>' +
          '<span class="sp-desc">' + esc(it.desc || '') + '</span></span>' +
          '<span class="sp-dom">' + esc(it.badge || KIND[it.kind]) + '</span></button>';
      }).join('');
      els.searchPop._hits = hits;
    }
    els.searchPop.classList.remove('hidden');
    els.searchInput.setAttribute('aria-expanded', 'true');
    setSearchActive(-1);
  }
  function hideSearchPop() {
    els.searchPop.classList.add('hidden');
    els.searchPop._hits = null;
    els.searchPop._active = -1;
    els.searchInput.setAttribute('aria-expanded', 'false');
    els.searchInput.setAttribute('aria-activedescendant', '');
  }
  /* 高亮第 i 项（-1 = 无）：同步 aria-activedescendant 与视口滚动 */
  function setSearchActive(i) {
    var pop = els.searchPop;
    var hits = pop._hits || [];
    if (i >= hits.length) i = hits.length - 1;
    if (i < -1) i = -1;
    pop._active = i;
    var items = pop.querySelectorAll('.sp-item');
    for (var k = 0; k < items.length; k++) {
      items[k].classList.toggle('on', k === i);
      items[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
    }
    els.searchInput.setAttribute('aria-activedescendant', i >= 0 ? 'sp-opt-' + i : '');
    if (i >= 0) {
      var el = document.getElementById('sp-opt-' + i);
      if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }
  function pickSearch(i) {
    var pop = els.searchPop;
    var hit = pop._hits && pop._hits[i];
    if (!hit) return false;
    navigate(hit.nav);
    els.searchInput.value = '';
    hideSearchPop();
    els.searchInput.blur();
    return true;
  }

  /* SECTION: kbd
   * v10b（走查 3.3 / 跨平台快捷键标注）：全站快捷键提示统一出口。
   * 旧行为：搜索键帽写死 ⌘K、审阅台写死 ⌘↵ —— 但代码监听的是 metaKey||ctrlKey，
   * Windows 上 Ctrl+Enter 明明生效、提示却是陌生符号。
   * 规范（Apple HT201236 + kbd 标注通行做法）：
   *   - Mac 显示 ⌘/⌥/⌃ 符号，Windows 显示 Ctrl/Alt 文字，按平台检测输出
   *   - 用 <kbd> 语义标签，读屏器可正确朗读
   * 用法：h.kbd('mod+enter') → Mac: <kbd>⌘</kbd><kbd>↵</kbd> / Win: <kbd>Ctrl</kbd><kbd>↵</kbd> */
  function isMacPlatform() {
    try {
      return /mac/i.test(navigator.platform || '') ||
        (navigator.userAgentData && navigator.userAgentData.platform === 'macOS');
    } catch (e) { return false; }
  }
  var KBD_ALIAS = { enter: '↵', esc: 'esc', up: '↑', down: '↓' };
  function kbd(seq) {
    var isMac = isMacPlatform();
    return String(seq || '').split('+').filter(Boolean).map(function (key) {
      var t;
      if (key === 'mod') t = isMac ? '⌘' : 'Ctrl';
      else if (KBD_ALIAS[key]) t = KBD_ALIAS[key];
      else t = key.length === 1 ? key.toUpperCase() : key;
      return '<kbd class="kbd">' + esc(t) + '</kbd>';
    }).join('');
  }

  /* SECTION: toast */
  var toastTimer = null;
  /* v10b（走查 3.5）：Toast 分级 + 撤销。
     旧行为一律 3.2s —— 「已停用」「已删除」这类不可轻撤的写操作反馈与「已复制」同级待遇，
     扫一眼别处就错过。现在：warn/bad 类 6.4s；带 undo 时 8.2s 且提供撤销按钮；
     悬停暂停消失（写操作反馈不该被阅读速度惩罚）。 */
  function toast(msg, kind, opts) {
    opts = opts || {};
    var undo = opts.undo;   /* { label:'撤销', fn:function(){…} } */
    var dur = opts.duration || (undo ? 8200 : (kind === 'warn' || kind === 'bad' ? 6400 : 3200));
    els.toast.innerHTML = esc(msg) +
      (undo ? '<button class="toast-undo" type="button">' + esc(undo.label || '撤销') + '</button>' : '');
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '') + (undo ? ' has-undo' : '');
    els.toast._undoFn = undo ? undo.fn : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); els.toast._undoFn = null; }, dur);
  }
  function toastBaseMs() {
    return els.toast._undoFn ? 8200
      : (els.toast.classList.contains('warn') || els.toast.classList.contains('bad')) ? 6400 : 3200;
  }
  function bindToast() {
    els.toast.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.toast-undo')) return;
      var fn = els.toast._undoFn;
      els.toast.classList.remove('show');
      els.toast._undoFn = null;
      clearTimeout(toastTimer);
      if (typeof fn === 'function') { try { fn(); } catch (err) { if (global.console) console.error(err); } }
    });
    els.toast.addEventListener('mouseenter', function () { clearTimeout(toastTimer); });
    els.toast.addEventListener('mouseleave', function () {
      if (!els.toast.classList.contains('show')) return;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { els.toast.classList.remove('show'); els.toast._undoFn = null; }, toastBaseMs());
    });
  }

  /* SECTION: tooltip */
  function bindTips(root) {
    root.querySelectorAll('[data-tip]').forEach(function (b) {
      b.addEventListener('mouseenter', showTip);
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('focus', showTip);
      b.addEventListener('blur', hideTip);
    });
  }
  var tipEl = null;
  function showTip(e) {
    hideTip();
    var t = e.currentTarget.getAttribute('data-tip');
    if (!t) return;
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.textContent = t;
    document.body.appendChild(tipEl);
    var r = e.currentTarget.getBoundingClientRect();
    var tw = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tipEl.style.top = (r.bottom + 6) + 'px';
  }
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  /* SECTION: render-dispatch */
  /* C-1a：待办焦点横幅。state.todoFocus = { todoId, cap, label, text, at[, filtered] }
   * v30：`filtered` 由发起跳转的动作（v30-overview-links.js）**按实情**写入 ——
   *   只有真的改了目标列表的数据源（td-gray 收窄「灰度中」）或真的写了目标页读的筛选条件
   *   （td-exp 写 filters.expState）时才写「已…过滤」；没筛就不写，横幅照旧说「列表未过滤」。
   *   铁律：绝不允许文案说已筛选而数据没筛。 */
  function todoFocusBar(state) {
    var f = state && state.todoFocus;
    if (!f) return '';
    return '<div class="bt-note" style="border-color:var(--blue);display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<b>待办定位</b>：' + esc(f.label || '') +
      (f.text ? '<span>' + esc(f.text) + '</span>' : '') +
      '<span class="pill">' + esc(f.filtered || '列表未过滤') + '</span>' +
      '<button class="btn-ghost sm" data-act="todo-clear">清除定位</button>' +
      '</div>';
  }

  /* v37：会话流滚动位置记忆。切页签会把 #content 整个重画（innerHTML），正文列
     .as-feed-col 是 new 出来的节点 —— 读了一半的对话，切去「监控」看一眼再回来就回到顶部，
     这是"切页签怪"的第三块。只记会话正文列，键 = agentId|tab，别的屏不受影响。
     ⚠ 只在 navigate 里消费一次：页面内因别的原因重渲染（发消息、展开过程行）不恢复，
       否则会把人刚滚到底想看的新消息压回去。 */
  var feedScrollMemo = {};
  var feedRestorePending = false;
  /* ⚠ 不能直接用 state.tab：页签点击器是「先写 state.tab，再 navigate」，
     memo 跑在 navigate 里时 state.tab 已经是**目标**页签（实测记成了 agentId|monitor）。
     所以以 DOM 上高亮的那颗页签为准，取不到再退回 hash 末段。 */
  function currentTabKey() {
    try {
      var on = document.querySelector('.tabs [data-tab].on, .tabs [data-tab][aria-selected="true"]');
      if (on && on.getAttribute) {
        var t = on.getAttribute('data-tab');
        if (t) return t;
      }
      var seg = String(location.hash || '').split(/[\/?#]/).filter(Boolean);
      if (seg.length) return seg[seg.length - 1];
    } catch (e) { /* 下面兜底 */ }
    return state.tab || '';
  }
  function memoFeedScroll() {
    try {
      var f = document.querySelector('.as-feed-col');
      if (f && state.agentId) feedScrollMemo[state.agentId + '|' + currentTabKey()] = f.scrollTop || 0;
    } catch (e) { /* 取不到就忘，不影响导航 */ }
  }
  function restoreFeedScroll() {
    try {
      var y = feedScrollMemo[state.agentId + '|' + (state.tab || '')];
      if (!y) return;
      var f = document.querySelector('.as-feed-col');
      if (f) f.scrollTop = y;
    } catch (e) { /* 恢复失败保持顶部，不报错 */ }
  }

  function render() {
    renderRail();
    renderSubmenu();
    renderBreadcrumb();
    var c = state.cap === 'overview' ? capById('overview') : capById(state.cap);
    document.title = (c.name || '') + ' · AI 运营中台';
    var R = global.RENDERERS || {};
    /* 路由未命中：明确告知「地址不存在」，不再静默落到总览（见 capById 注释） */
    if (c.__miss) {
      try {
        els.content.innerHTML = routeMissBar(state.cap);
      } catch (e) {
        els.content.innerHTML = '<div class="fatal"><h2>地址不存在：' + esc(String(state.cap)) + '</h2></div>';
      }
      bindContent();
      v10Shell();
      return;
    }
    // 详情态优先于列表态：同一能力下按 state 选择渲染器
    var pageType = c.pageType;
    /* v15：trace 详情优先级最高。旧写法里 cap=agent-wb 且有 agentId 时会先命中 agentDetail，
       URL 上明明带着 traceId 却渲染成 Agent 页（配合路由修复前的 tab='trace' 就成了半空页）。 */
    if (state.traceId && (c.id === 'obs' || c.id === 'agent-wb')) pageType = 'traceDetail';
    /* v15：会话内新建的对象走统一轻量详情页 —— 既有详情渲染器按 id 从数据源取行，
       新建对象必然取不到，会显示「对象不存在」。这里优先拦一道，不碰任何既有渲染器。 */
    else if (state.agentId && global.V15 && global.V15.isNew && global.V15.isNew(state)) pageType = 'newObjDetail';
    else if (c.id === 'agent-wb' && state.agentId) pageType = 'agentDetail';
    /* v10：通用对象详情 —— cap 声明了 detailType 且有对象 id 时，走详情渲染器 */
    else if (c.detailType && state.agentId) pageType = c.detailType;
    var fn = R[pageType] || R.fallback;
    /* 作用域限定（输入条遮挡正文的根因修法）：只有**会话/轨迹那两屏**才把 #content 交给
       "会话区自己滚"。这一屏的根元素是 .as-view，CSS 规则全部挂在 .content--as 前缀下。
       ⚠ v35（2026-10-15）修正：此前判据是 `pageType === 'agentDetail'` —— **整页**都加，
       于是管理 / 监控 / 日志这些长页面也把 #content 变成 flex 列，子项被 flex 压缩：
       实测四页签条被压成 **1px 高**（量到的几何：`.tabs h=1 top=347`），页签整条看不见，
       用户看到的就是"分页没了"。判据改成"这一屏真会渲染 .as-view"，即会话页签。 */
    var needAs = (pageType === 'agentDetail' && state.tab === 'session');
    try {
      if (els.content && els.content.classList &&
        els.content.classList[needAs ? 'add' : 'remove']) {
        els.content.classList[needAs ? 'add' : 'remove']('content--as');
      }
    } catch (e) { /* classList 不可用不影响渲染 */ }
    try {
      /* 🔴 C-1a：把「从总览待办点进来」的**筛选语义**显示出来。
         此前只传 cap ⇒ 落到默认列表，用户还得自己再筛一遍（口径与落点不一致）。
         现在从总览点待办会带 state.todoFocus，这里在**页面顶部**如实告知
         "正在看的是哪一类"，并给一键清除。
         ⚠ 位置在 shell 层（而非各页内）—— 一处覆盖 approval / compliance / obs / agent-wb 等所有目标页，
           避免逐页加横幅（那种做法容易漏页）。
         ⚠ 诚实：本原型的目标页**尚未按该条件真正过滤数据**，所以横幅说的是
           "已定位到该类事项"，并明说"列表未过滤"—— 不假装已筛选。 */
      els.content.innerHTML = todoFocusBar(state) + fn(c, state, helpers());
    } catch (err) {
      els.content.innerHTML = '<div class="fatal"><h2>页面渲染失败</h2><p>' + esc(err && err.message) + '</p>' +
        '<pre>' + esc((err && err.stack || '').split('\n').slice(0, 4).join('\n')) + '</pre>' +
        '<p class="fatal-hint">traceId: ' + esc('ui-' + Date.now().toString(16)) + '（可复制用于报障）</p>' +
        '<button class="btn-primary" onclick="location.reload()">重新加载</button></div>';
      console.error(err);
    }
    bindContent();
    /* v52：决策会议室是一张画布（缩放 / 平移）。每次重渲染后把视图贴回去，
       并绑回工具条 —— 视图存在 state.hallView，重绘不丢。 */
    try { if (global.__hallBoot) global.__hallBoot(); } catch (e) { if (global.console) console.error(e); }
    /* 执行轨迹：失败节点在横向滚动区外时把它滚进来（renderers.js 注册） */
    try { if (global.__tfBoot) global.__tfBoot(); } catch (e) { if (global.console) console.error(e); }
    openDetailIfAny();
    v10Shell();
    /* v37：刚才是 navigate 进来的 → 把会话流放回原来的阅读位置（只消费一次） */
    if (feedRestorePending) { feedRestorePending = false; restoreFeedScroll(); }
    /* v39：同级页的就地重渲染（展开卡片 / 拨开关 / 改参数）→ 把整页阅读位置放回去 */
    if (pendingScrollKeep != null) {
      var _yk = pendingScrollKeep;
      pendingScrollKeep = null;
      try { var _ct3 = $('content'); if (_ct3) _ct3.scrollTop = _yk; } catch (e) { /* 取不到就保持原状 */ }
    }
  }

  /* 通知角标。抽成单独函数：面板一打开就「已读」，角标要能就地清零，
     不必为了一个数字重画面包屑和页签条。 */
  function refreshBellBadge() {
    var n = $('v10-bell-n');
    if (!n) return;
    var V = global.V10UI;
    var A = global.APP_DATA, st = null;
    try { st = A && typeof A.pendingStats === 'function' ? A.pendingStats() : null; } catch (e) { st = null; }
    var total = st ? ((st.approvals || 0) + (st.compliance || 0) + (st.badcase || 0) + (st.gray || 0)) : 0;
    /* 异步长任务的结果也算未读：重建索引是 4 分钟级的后台任务，跑完时人多半已经翻到别的屏，
       角标不亮就等于没有通知。 */
    if (V && typeof V.asyncUnread === 'function') total += V.asyncUnread();
    if (total > 0) { n.textContent = String(total); n.classList.remove('hidden'); }
    else n.classList.add('hidden');
  }

  /* v10：刷新壳层件（多页签条 + 通知角标） */
  function v10Shell() {
    var V = global.V10UI;
    /* 内容已渲染 → 各屏页签名已登记；此时重画面包屑才能显示页签中文名（首帧登记表还是空的） */
    renderBreadcrumb();
    var tb = $('v10-tabs');
    if (tb && V && typeof V.tabsBar === 'function') tb.innerHTML = V.tabsBar(helpers());
    refreshBellBadge();
  }

  /* SECTION: v10-hooks
   * 把 V10UI 的横切件透传给渲染层。V10UI 未加载时全部降级为空/安全值，
   * 保证 v10 新增文件缺失也不会把老页面弄崩。
   */
  function v10(name) {
    return function () {
      var V = global.V10UI;
      if (V && typeof V[name] === 'function') return V[name].apply(V, arguments);
      if (name === 'detailMissing') {
        var cap = arguments[0] || {};
        return '<div class="empty"><div class="empty-title">未找到该对象</div>' +
          '<div class="empty-sub">' + esc((cap.name || '页面') + ' · ' + (arguments[1] && arguments[1].agentId || '—')) + '</div></div>';
      }
      if (name === 'detailTabs') return '';
      return '';
    };
  }

  function helpers() {
    return {
      fmt: fmt, icon: icon, esc: esc, table: table, pill: pill, metricCard: metricCard,
    avatar: avatar, avColor: avColor,
      rangePicker: rangePicker, metaBar: metaBar, definitionsBlock: definitionsBlock,
      toast: toast, navigate: navigate, capById: capById, tabLabel: tabLabel, kbd: kbd,
      /* v29：渲染器保存后需要收掉弹窗并刷新列表。
         此前渲染器里用的是 h.rerender —— 那个东西**不存在**（helpers 返回对象里没有它），
         而且写在 `if (h.rerender)` 里，所以是静默失效：保存后弹窗不关、列表不刷新、也不报错。
         这里挂上两个真实存在的。 */
      closeModals: closeModals, render: render,
      charts: C, query: Q, facts: F, seed: S, app: APP, state: state,
      /* v10 横切件 */
      detailTabs: v10('detailTabs'), pageCrumb: v10('pageCrumb'), emptyFor: v10('emptyFor'),
      detailMissing: v10('detailMissing'), dangerConfirm: v10('dangerConfirm'), diffViewer: v10('diffViewer'),
      permTag: v10('permTag'), audit: v10('audit'), auditDrawer: v10('auditDrawer'),
      notificationBell: v10('notificationBell'), tabsBar: v10('tabsBar'),
      asyncResult: v10('asyncResult')
    };
  }

  /* SECTION: content-events
   * 统一事件委托：所有交互通过 data-* 属性驱动，避免每页重复绑定。
   */
  function bindContent() {
    bindTips(els.content);

    /* 网状关系页：节点可拖动、可右键（v25f）。
       对标 eNSP —— 拓扑图的拖动/右键是基本功，也是"线穿节点"最直接的解法：
       自动布局给初值，觉得不合适就自己拖。 */
    if (global.__anetDrag || global.__anetMenu) {
      var hh = helpers();
      /* 卡片下方的小字也要能拖动：它是 <button> 的兄弟节点，按它上面会落到画布平移上
         （实测「拖卡片没拖动、画布动了」就是这么来的）。 */
      els.content.querySelectorAll('.anet-tile[data-id], .anet-tile-note[data-drag]').forEach(function (n) {
        /* 拖动挂 pointer 事件：鼠标、触屏、手写笔同一套（原来只挂 mousedown，触屏完全用不了）。
           data-x/data-y 由渲染层直接写进标记（画布已是自然尺寸），这里不再估算坐标 ——
           旧代码按「虚拟画布宽 1000」反算，改自然尺寸后那段既是死代码也是误导。 */
        if (global.__anetDrag && !n.__anetDragBound) {
          n.__anetDragBound = 1;
          n.addEventListener('pointerdown', function (ev) {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            n.removeAttribute('data-dragged');       /* 每次按下先清，拖动结束再置上 */
            global.__anetDrag(ev, n.getAttribute('data-id') || n.getAttribute('data-drag'), hh);
          });
          n.style.cursor = 'grab';
          /* 键盘可达：卡片能 Tab 聚焦，菜单键 / Shift+F10 就应能打开同一份菜单 */
          n.addEventListener('keydown', function (ev) {
            if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
              ev.preventDefault();
              var r = n.getBoundingClientRect();
              global.__anetMenu({ target: n, clientX: r.right - 8, clientY: r.top + 8, preventDefault: function () {} }, hh);
              return;
            }
            /* 不拖也能做完：空格拿起 → 左右键选列 → 回车确认 → Esc 取消（并逐句播报） */
            var kid = n.getAttribute('data-id') || n.getAttribute('data-drag');
            if (global.__anetKbdKey && global.__anetKbdKey(ev, kid, hh)) ev.preventDefault();
          });
          n.addEventListener('click', function (ev) {
            if (n.getAttribute('data-dragged')) { ev.stopPropagation(); ev.preventDefault(); }
          }, true);
        }
      });
      /* 就地改名：双击标题 → 就地变输入框（不弹窗、不跳页）。回车提交、Esc 取消、失焦提交。 */
      els.content.querySelectorAll('[data-rename]').forEach(function (n) {
        if (n.__renameBound) return;
        n.__renameBound = 1;
        n.addEventListener('dblclick', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var host = n.closest('.anet-canvas') || els.content;
          var r = n.getBoundingClientRect(), cr = host.getBoundingClientRect();
          var inp = global.document.createElement('input');
          inp.className = 'anet-rename';
          inp.value = (n.textContent || '').replace(/\s*⇄\s*$/, '').trim();
          inp.style.left = Math.max(0, r.left - cr.left + (host.scrollLeft || 0) - 6) + 'px';
          inp.style.top = Math.max(0, r.top - cr.top - 7) + 'px';
          inp.style.minWidth = Math.max(96, r.width + 12) + 'px';
          host.appendChild(inp);
          inp.focus(); inp.select();
          var done = false;
          function commit(ok) {
            if (done) return; done = true;
            var v = inp.value;
            inp.remove();
            if (ok && global.__anetRename) global.__anetRename(n.getAttribute('data-rename'), v, hh);
          }
          inp.addEventListener('keydown', function (e2) {
            if (e2.key === 'Enter') { e2.preventDefault(); commit(true); }
            else if (e2.key === 'Escape') { e2.preventDefault(); commit(false); }
            e2.stopPropagation();                       /* 别让画布快捷键抢走打字 */
          });
          inp.addEventListener('blur', function () { commit(true); });
          inp.addEventListener('dblclick', function (e2) { e2.stopPropagation(); });
        });
      });
      var cvEl = els.content.querySelector('.anet-canvas');      var cvEl = els.content.querySelector('.anet-canvas');
      if (cvEl && global.__anetMenu && !cvEl.__anetMenuBound) {
        cvEl.__anetMenuBound = 1;
        cvEl.addEventListener('contextmenu', function (ev) {
          ev.preventDefault();
          global.__anetMenu(ev, hh);
        });
        /* 左键点一条线 = 打开同一份菜单：边的命中线（.anet-flowhit）是透明加粗的，
           不给左键反应的话，用户点上去只会觉得"点了没反应"。 */
        /* 悬停某条线 → 显示它的标签（标签默认可能被 CSS 藏起来） */
        cvEl.addEventListener('mouseover', function (ev) {
          var hit = ev.target && ev.target.closest ? ev.target.closest('.anet-flowhit[data-e]') : null;
          if (!hit) return;
          var g = cvEl.querySelector('.anet-flowlab-g[data-e="' + hit.getAttribute('data-e').replace(/"/g, '\\"') + '"]');
          if (g) g.classList.add('on');
        });
        cvEl.addEventListener('mouseout', function (ev) {
          var hit = ev.target && ev.target.closest ? ev.target.closest('.anet-flowhit[data-e]') : null;
          if (!hit) return;
          var g = cvEl.querySelector('.anet-flowlab-g[data-e="' + hit.getAttribute('data-e').replace(/"/g, '\\"') + '"]');
          if (g) g.classList.remove('on');
        });
        cvEl.addEventListener('click', function (ev) {
          var hit = ev.target && ev.target.closest ? ev.target.closest('.anet-flowhit[data-e]') : null;
          if (!hit) return;
          ev.preventDefault(); ev.stopPropagation();
          global.__anetMenu(ev, hh);
        }, true);
      }
      /* v26c：画布平移 + 滚轮缩放（挂在本次渲染的画布上，节点随渲染重建、不担心重复绑定）；
         快捷键挂的是 document，模块内部会先摘掉上一次的监听，只保留一份。 */
      if (cvEl && global.__anetPan) global.__anetPan(cvEl, hh);
      if (global.__anetKeys) global.__anetKeys(hh);
    }

    /* v26：企业知识库的桌面式管理（图标网格 / 文件夹 / 双击 / 右键 / 拖拽 / 框选）。
       与 anet 同款：渲染层只出结构，交互在**本次渲染之后**挂到新 DOM 上 ——
       每次 render 都重建内容，若把事件绑在渲染函数里就会重复叠加。 */
    if (global.__kbDesk) global.__kbDesk(els.content, helpers());

    // 排序
    els.content.querySelectorAll('[data-sort]').forEach(function (th) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = k; state.sortDir = 'desc'; }
        state.page = 1;
        navigate({}, { scroll: false });   // 写进 URL：排序是高频视图，要能刷新保持 / 分享
      });
    });
    // 分页
    els.content.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('disabled')) return;
        var n = Number(b.getAttribute('data-page'));
        if (!(n >= 1)) return;          // 上一页在第 1 页时是 0/负数，挡住
        state.page = n;
        navigate({}, { scroll: false });   // 页码进 URL：刷新/分享停在同一页
      });
    });
    // 时间范围
    els.content.querySelectorAll('[data-range]').forEach(function (b) {
      b.addEventListener('click', function () { state.range = b.getAttribute('data-range'); state.page = 1; render(); });
    });
    // 检索筛选器（下拉即时生效，文本框回车生效）
    els.content.querySelectorAll('select[data-f]').forEach(function (sel) {      sel.addEventListener('change', function () {
        var k = sel.getAttribute('data-f');
        var v = sel.value;
        state.filters = state.filters || {};
        if (v) state.filters[k] = v; else delete state.filters[k];
        state.page = 1;
        render();
      });
    });
    els.content.querySelectorAll('input[data-f]').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var k = inp.getAttribute('data-f');
        var v = inp.value.trim();
        state.filters = state.filters || {};
        if (v) state.filters[k] = v; else delete state.filters[k];
        state.page = 1;
        render();
      });
    });
    // 行下钻（v10b 走查 3.1：补键盘通道 —— 只有鼠标能进的行详情对键盘/读屏用户是功能缺失）
    els.content.querySelectorAll('[data-row-act]').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button') || e.target.closest('a')) return;
        var act = tr.getAttribute('data-row-act'), id = tr.getAttribute('data-row-id');
        handleRowAction(act, id, tr);
      });
      tr.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        /* 焦点在行内按钮/链接/输入框上时，Enter 属于那个控件，不归行 */
        if (e.target.closest('button,a,input,select,textarea')) return;
        e.preventDefault();
        var act = tr.getAttribute('data-row-act'), id = tr.getAttribute('data-row-id');
        handleRowAction(act, id, tr);
      });
    });
    // 投放规划器控件：预算滑块实时重算，条件下拉即时生效
    els.content.querySelectorAll('[data-kol]').forEach(function (el2) {
      var key = el2.getAttribute('data-kol');
      var isNum = key === 'budget' || key === 'minOverlap';
      el2.addEventListener('input', function () {
        state.kol = state.kol || {};
        var v = el2.value;
        state.kol[key] = isNum ? Number(v) : v;
        render(); // 拖拽过程实时重算（不碰 URL，避免每帧 hash 抖动）
      });
      el2.addEventListener('change', function () {
        state.kol = state.kol || {};
        var v = el2.value;
        state.kol[key] = isNum ? Number(v) : v;
        navigate({}, { scroll: false }); // 松手/选择后写入 URL，刷新保持
      });
    });
    // 知识库检索测试参数（state.kb 实时重算：下拉 change 即时生效，query 失焦生效）
    els.content.querySelectorAll('[data-kb]').forEach(function (el3) {
      var key = el3.getAttribute('data-kb');
      el3.addEventListener('change', function () {
        state.kb = state.kb || {};
        var v = el3.value;
        state.kb[key] = (key === 'topK' || key === 'th') ? Number(v) : v;
        /* v10b（对标 Dify hit-testing Records）：query 失焦时进历史（去重、留最近 8 条），
           「最近查询」chip 可点回填重跑 */
        if (key === 'q' && v && v.trim()) {
          var hist = (state.kb.history || []).filter(function (x) { return x !== v.trim(); });
          hist.push(v.trim());
          state.kb.history = hist.slice(-8);
        }
        navigate({}, { scroll: false });
      });
    });
    // 通用动作
    els.content.querySelectorAll('[data-act]').forEach(function (b) {
      if (b.classList.contains('m-info')) return;
      /* ⚠ 防重复绑定（跨文件）：v23-exp-agent-link.js 的 bindPatched() 会扫一遍
         #content 里的 [data-act]，给「它认为没绑过的」按钮再挂一次 ACTIONS 调用。
         它的判重标记是自己的 __v23Bound，感知不到这里已经 bindContent 绑过了
         —— 结果同一个按钮点一次跑两遍 handleAction（弹窗开两份、写操作登记两次）。
         这里绑完就补上同一个标记，让它的扫描跳过。语义与它注释里写的
         「给所有还没绑过的 [data-act] 手动挂上」一致，不影响它自己注入的按钮。 */
      /* ⚠ 这行不能删：删了 v23 的 bindPatched() 就会再挂一次 ACTIONS 调用，
         同一个按钮点一次跑两遍 —— 表现是「池卡片勾上又立刻取消，永远选不中人」。
         2026-10-05 实测回归，已恢复。 */
      b.__v23Bound = true;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        handleAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b);
      });
      /* 键盘可达：真正的 <button> 由浏览器把 Enter/Space 转成 click，**不需要也不该**再挂
         一次（加了会双击两次 —— 危险操作会弹两个确认层）。
         只有"非 button 但带 data-act"的元素（如指标卡改成的 div[role=button]）需要这里补。 */
      if (b.tagName !== 'BUTTON') {
        b.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
          e.preventDefault();          /* Space 默认滚屏，要挡掉 */
          e.stopPropagation();
          handleAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b);
        });
      }
    });
    // Tab
    els.content.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        navigate({ tab: state.tab });
      });
    });
    // 图表悬浮
    bindChartHover();
  }

  function handleRowAction(act, id, tr) {
    if (act === 'agent') {
      /* v32：默认落地页签跟随页签顺序 ——「会话与干预」排在第一个，见 renderers.js 的 AGENT_TABS。 */
      navigate({ agentId: id, tab: state.tab || 'session', traceId: null });
    } else if (act === 'trace') {
      navigate({ traceId: id, tab: null });
    } else if (act === 'row-member') {
      /* v27：账号与权限页成员表的整行点击 → 打开该成员详情弹窗。
         复用已有动作通道（rbacMember），键盘 Enter/Space 走同一条路（app.js:1081）。 */
      var A = global.ACTIONS || {};
      if (A['rbac-member']) A['rbac-member'](id, tr, helpers());
    } else if (act === 'row-detail') {
      tr.classList.toggle('expanded');
      var next = tr.nextElementSibling;
      if (next && next.classList.contains('row-detail')) { next.remove(); return; }
      var html = tr.getAttribute('data-detail-html');
      if (html) {
        var row = document.createElement('tr');
        row.className = 'row-detail';
        row.innerHTML = '<td colspan="' + tr.children.length + '">' + html + '</td>';
        tr.after(row);
      }
    }
  }

  function handleAction(act, id, btn) {
    var A = global.ACTIONS || {};
    if (A[act]) { A[act](id, btn, helpers()); return; }
    if (global.console) console.warn('[action] 未注册的动作：' + act);
    /* v15：兕底不再伪造「已提交」——未接线的写操作如实告知，不假装成功。
       若 v15-actions.js 已加载，交给它给出该操作的真实业务前置条件。 */
    if (global.V15 && typeof global.V15.blocked === 'function') { global.V15.blocked(btn); return; }
    /* v10b（走查 3.8）：静默失败 → 明说哪个动作没接线，可排查而不是“点了没反应” */
    toast('演示环境：该操作（' + act + '）未接线，不执行真实写操作', 'info');
  }

  function bindChartHover() {
    els.content.querySelectorAll('svg.chart[data-points]').forEach(function (svg) {
      var pts;
      try { pts = JSON.parse(svg.getAttribute('data-points')); } catch (e) { return; }
      var padL = +svg.getAttribute('data-padl'), iw = +svg.getAttribute('data-iw'), padT = +svg.getAttribute('data-padT'), ih = +svg.getAttribute('data-ih');
      var gran = svg.getAttribute('data-gran') || '1h';
      var hit = svg.querySelector('.chart-hit');
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', 'var(--blue)'); line.setAttribute('stroke-width', '1'); line.setAttribute('opacity', '0');
      svg.appendChild(line);
      var tipBox = document.createElement('div');
      tipBox.className = 'chart-tip hidden';
      svg.parentNode.appendChild(tipBox);
      if (!hit) return;
      hit.addEventListener('mousemove', function (e) {
        var rect = svg.getBoundingClientRect();
        var scale = rect.width / svg.viewBox.baseVal.width;
        var x = (e.clientX - rect.left) / scale;
        /* 十字线与柱子必须落同一套 x：charts.js 已把 index→x 的换算写进 DOM（data-x0/data-dx）。
           拿不到属性时退回旧公式（老图表仍然可用）。 */
        var x0 = +svg.getAttribute('data-x0'), dx = +svg.getAttribute('data-dx');
        var idx, px;
        if (isFinite(x0) && isFinite(dx) && dx > 0) {
          idx = Math.round((x - x0) / dx);
          px = x0 + idx * dx;
        } else {
          idx = Math.round(((x - padL) / iw) * (pts.length - 1));
          px = padL + (idx / (pts.length - 1)) * iw;
        }
        if (idx < 0 || idx >= pts.length) return;
        var p = pts[idx];
        line.setAttribute('x1', px); line.setAttribute('x2', px);
        line.setAttribute('y1', padT); line.setAttribute('y2', padT + ih);
        line.setAttribute('opacity', '0.35');
        tipBox.classList.remove('hidden');
        /* 内容交给 charts.js 的 tipHtml：标题行 = 该点时间 + 该点调用量，下面每行带色块
           —— 色块把数字对回图上的柱子/蓝线/棕虚线（对标 DeepSeek 控制台的 tooltip 结构）。
           时间标签与 x 轴同一套格式（data-gran），不再印带秒的 fmt.dt。 */
        var C0 = global.CHARTS;
        tipBox.innerHTML = (C0 && C0.tipHtml)
          ? C0.tipHtml(p, gran)
          : '<b>' + esc(fmt.dt(p.ts)) + '</b><span>调用 ' + fmt.int(p.calls) + '</span>';
        var wrapRect = svg.parentNode.getBoundingClientRect();
        tipBox.style.left = Math.min(wrapRect.width - 170, Math.max(0, (px * scale) - 80)) + 'px';
      });
      hit.addEventListener('mouseleave', function () { line.setAttribute('opacity', '0'); tipBox.classList.add('hidden'); });
    });

    /* ── 堆叠柱的整列浮层（2026-10-22）──────────────────────────────────
       业主看图后一句「自己看交互」：要的是 DeepSeek 用量页那种 hover ——
       整列命中、一条虚线落在该天、其余列变淡、浮层给出「日期 + 当天合计 + 各分组金额」。
       与上面折线图同一套做法（覆盖式命中层 + 自绘浮层 + 指示线），区别只是内容按**列**聚合：
       折线图的点是时间点，堆叠柱的点是一整根柱子。
       ⚠ 业务数字一个都不在这里算：colTips 由 charts.js 从 data-sb 带进来，这里只负责交互。
       ⚠ 只在 charts.js 传了 colTips 的图上生效（目前是成本归因页）；监控页的堆叠柱不受影响。 */
    els.content.querySelectorAll('svg.chart-stack[data-sb]').forEach(function (svg) {
      var cols;
      try { cols = JSON.parse(svg.getAttribute('data-sb')); } catch (e) { return; }
      if (!cols || !cols.length) return;
      var padT = +svg.getAttribute('data-padT'), ih = +svg.getAttribute('data-ih');
      var x0 = +svg.getAttribute('data-x0'), dx = +svg.getAttribute('data-dx');
      var hit = svg.querySelector('.chart-hit'), guide = svg.querySelector('.sb-guide');
      if (!hit || !guide || !(dx > 0)) return;
      var colEls = Array.prototype.slice.call(svg.querySelectorAll('.sb-col'));
      var tipBox = document.createElement('div');
      tipBox.className = 'chart-tip hidden';
      svg.parentNode.appendChild(tipBox);

      function reset() {
        svg.classList.remove('acting');
        for (var i = 0; i < colEls.length; i++) colEls[i].classList.remove('on');
        guide.setAttribute('opacity', '0');
        tipBox.classList.add('hidden');
      }
      hit.addEventListener('mousemove', function (e) {
        var rect = svg.getBoundingClientRect();
        var scale = rect.width / (svg.viewBox.baseVal.width || rect.width);
        var x = (e.clientX - rect.left) / scale;
        var idx = Math.floor((x - x0) / dx);
        if (idx < 0 || idx >= cols.length) { reset(); return; }
        var cx = x0 + idx * dx + dx / 2;
        guide.setAttribute('x1', cx); guide.setAttribute('x2', cx);
        guide.setAttribute('y1', padT); guide.setAttribute('y2', padT + ih);
        guide.setAttribute('opacity', '1');
        svg.classList.add('acting');
        for (var i = 0; i < colEls.length; i++) {
          colEls[i].classList.toggle('on', +colEls[i].getAttribute('data-col') === idx);
        }
        var C0 = global.CHARTS;
        tipBox.innerHTML = (C0 && C0.sbTipHtml) ? C0.sbTipHtml(cols[idx]) : '';
        tipBox.classList.remove('hidden');
        var wrapRect = svg.parentNode.getBoundingClientRect();
        /* 浮层放在该列**右侧**（对标图也是这个位置）：盖住相邻列比盖住正在看的那根好，
           右侧放不下就翻到左侧，两侧都放不下才夹到卡内。 */
        var tipW = tipBox.offsetWidth || 200;
        var left = cx * scale + 14;
        if (left + tipW > wrapRect.width - 8) left = cx * scale - tipW - 14;
        tipBox.style.left = Math.max(8, Math.min(wrapRect.width - tipW - 8, left)) + 'px';
        /* 纵向跟随鼠标、并夹在卡内：浮层比卡还高时贴顶（宁可盖住上半张图，也不让它跑出卡外） */
        var want = (e.clientY - wrapRect.top) - tipBox.offsetHeight / 2;
        tipBox.style.top = Math.max(6, Math.min(wrapRect.height - tipBox.offsetHeight - 6, want)) + 'px';
      });
      hit.addEventListener('mouseleave', reset);
    });
  }

  /* SECTION: account-menu
   * 顶栏账号区。此前是 <span class="avatar">运</span>：无 role / 无 tabindex / 无 title，
   * 点击零反应，键盘永远到不了 —— 全站唯一的「我是谁」入口是死的。
   *
   * 现在做成标准 profile menu：aria-haspopup=menu + aria-expanded、
   * Esc 关闭并把焦点还给触发器、↑↓ 在菜单项间移动（首尾环绕）、
   * 点外部关闭。菜单内容全部读 ME，不硬编码姓名。
   */
  var ACCT_KEY = 'aiops:acct:menuOpen';
  function acctMenuItems() {
    return [
      { k: 'profile', t: '个人信息', icon: 'person' },
      { k: 'perms', t: '我的权限', icon: 'grid', tag: (ME.perms || []).length + ' 项' },
      { k: 'audit', t: '我的操作记录', icon: 'doc' },
      { k: 'rbac', t: '能力与权限', icon: 'grid' }
    ];
  }
  function acctMenuHtml() {
    var sess = '<div class="acct-badges">' +
      '<span class="pill info">' + esc(ME.role) + '</span>' +
      '<span class="pill idle">' + esc(ME.dept) + '</span>' +
      '<span class="pill ok">会话 ' + fmt.wait(ME.session.ttlMin - ME.session.issuedMin) + '后过期</span>' +
      '</div>';
    var items = acctMenuItems().map(function (m) {
      return '<button class="acct-mi" role="menuitem" data-acct="' + m.k + '">' + icon(m.icon, 15) +
        '<span>' + esc(m.t) + '</span>' +
        (m.tag ? '<span class="acct-mi-tag">' + esc(m.tag) + '</span>' : '') + '</button>';
    }).join('');
    return '<div class="acct-hd">' +
      '<span class="avatar" aria-hidden="true">' + esc(ME.initials) + '</span>' +
      '<span class="acct-hd-main"><span class="acct-hd-name">' + esc(ME.name) + '</span>' +
      '<span class="acct-hd-mail">' + esc(ME.mail) + '</span></span></div>' +
      sess +
      '<div class="acct-sep"></div>' + items +
      '<div class="acct-sep"></div>' +
      '<button class="acct-mi danger" role="menuitem" data-acct="logout">' + icon('play', 15) + '<span>退出登录</span></button>' +
      '<div class="acct-ft">租户 ' + esc(ME.tenant) + ' · 单账号模式，退出仅清本会话标记<br>Agent 能用什么，在 Agent 详情 › 管理 › 联系里改</div>';
  }
  function setAcctOpen(open) {    var w = $('acct-wrap'), b = $('acct-btn'), m = $('acct-menu');
    if (!w || !b || !m) return;
    if (open) m.innerHTML = acctMenuHtml();
    w.classList.toggle('open', !!open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function bindAccount() {
    var w = $('acct-wrap'), b = $('acct-btn'), m = $('acct-menu');
    if (!w || !b || !m) return;
    /* 身份写进 DOM —— 顶栏显示的是真实 ME.name / ME.dept，不是硬编码字符串 */
    var av = $('acct-avatar'), nm = $('acct-name'), rl = $('acct-role');
    if (av) av.textContent = ME.initials;
    if (nm) nm.textContent = ME.name;
    if (rl) rl.textContent = ME.dept;

    b.addEventListener('click', function (e) {
      e.stopPropagation();
      setAcctOpen(!w.classList.contains('open'));
    });
    /* 点菜单外部关闭（标准下拉行为） */
    document.addEventListener('click', function (e) {
      if (!w.classList.contains('open')) return;
      if (w.contains(e.target)) return;
      setAcctOpen(false);
    });
    /* Esc 关闭并把焦点还给触发器 —— 否则键盘用户被关在虚空里 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && w.classList.contains('open')) {
        setAcctOpen(false); b.focus(); return;
      }
      if (!w.classList.contains('open')) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var nodes = Array.prototype.slice.call(m.querySelectorAll('.acct-mi'));
      if (!nodes.length) return;
      e.preventDefault();
      var i = nodes.indexOf(document.activeElement);
      var next = e.key === 'ArrowDown'
        ? (i < 0 ? 0 : (i + 1) % nodes.length)
        : (i < 0 ? nodes.length - 1 : (i - 1 + nodes.length) % nodes.length);
      nodes[next].focus();
    });
    /* 菜单项动作：原型内可自查的都做成真跳转/真反馈，不留空动作 */
    m.addEventListener('click', function (e) {
      var t = e.target.closest('[data-acct]');
      if (!t) return;
      e.stopPropagation();
      var k = t.getAttribute('data-acct');
      setAcctOpen(false); b.focus();
      if (k === 'profile') openAccountSheet('profile');
      else if (k === 'perms') openAccountSheet('perms');
      else if (k === 'roles') openAccountSheet('roles');
      else if (k === 'audit') openAccountSheet('audit');
      else if (k === 'rbac') navigate({ domain: 'platform', cap: 'assets', agentId: null, tab: null, traceId: null });
      else if (k === 'logout') logoutConfirm();
    });
  }
  /* 账号菜单用的模态框：与 bindShell 里已有的 data-act="close-modal" 委托配套。
     v10b：slide —— 查看型信息一律右侧滑出（与 openModal 同一规则）。 */
  function acctModal(title, body) {
    var host = document.createElement('div');
    host.innerHTML = '<div class="modal-mask slide" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-h"><h3>' + esc(title) + '</h3>' +
      '<button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>' +
      '<div class="modal-b">' + body + '</div></div></div>';
    document.body.appendChild(host.firstChild);
  }
  function openAccountSheet(kind) {
    var title = { profile: '个人信息', perms: '我的权限', roles: '角色与职责', audit: '我的操作记录' }[kind] || '账号';
    var body;
    if (kind === 'profile') {
      body = '<dl class="dl">' +
        '<dt>姓名</dt><dd>' + esc(ME.name) + '</dd>' +
        '<dt>工号</dt><dd class="mono">' + esc(ME.id) + '</dd>' +
        '<dt>部门</dt><dd>' + esc(ME.dept) + '</dd>' +
        '<dt>角色</dt><dd>' + esc(ME.role) + '</dd>' +
        '<dt>邮箱</dt><dd class="mono">' + esc(ME.mail) + '</dd>' +
        '<dt>租户</dt><dd class="mono">' + esc(ME.tenant) + '</dd>' +
        '<dt>会话</dt><dd>已登录 ' + fmt.wait(ME.session.issuedMin) + '，' + fmt.wait(ME.session.ttlMin - ME.session.issuedMin) + '后过期</dd>' +
        '</dl>' +
        '<div class="bt-note">单账号模式：这套系统只有这一个身份，不存在成员与部门字段的同步。</div>';
    } else if (kind === 'perms') {
      body = '<div class="bt-note" style="margin-bottom:8px">当前角色 <b>' + esc(ME.role) + '</b> 持有 <b>' + (ME.perms || []).length + '</b> / ' +
        esc((S.PERM_POINTS || []).length) + ' 个权限点，由角色矩阵推导、不是手工维护。' +
        '危险操作会真正校验这些权限点，未授权将被拦截并留审计。</div>' +
        '<div>' + (ME.perms || []).map(function (p) {
          var m = S.permMeta ? S.permMeta(p) : null;
          return '<span class="tag' + (m && m.risk === 'high' ? ' bad' : '') + '">' +
            esc(m ? m.label : p) + '<span class="mono muted"> ' + esc(p) + '</span></span>';
        }).join('') + '</div>' +
        '<div class="bt-note" style="margin-top:10px">高危动作点击即生效，每次都会写一条审计（谁、什么时候、改了什么、影响面多大）。这套系统只有你一个账号，不需要谁批准。</div>' +
        '<div class="bt-note">每个 Agent 能碰什么，在 <b>Agent 工作台 › Agent 详情 › 管理 › 联系</b>里改。</div>';
    } else if (kind === 'roles') {
      body = '<div class="bt-note">职责分离要求：<b>同一人不能既申请又审批同一张单据</b>；代理审批必须写明代理期与范围。</div>' +
        '<div class="v10-impacts" style="margin-top:8px">' +
        '<div class="v10-impacts-row"><span class="v10-impacts-k">可审批</span><span class="v10-impacts-v">平台发布 / MCP 开放 / 数据导出等高危单据</span></div>' +
        '<div class="v10-impacts-row"><span class="v10-impacts-k">不可自批</span><span class="v10-impacts-v">本人发起的单据一律不出现在「待我审批」</span></div>' +
        '<div class="v10-impacts-row"><span class="v10-impacts-k">越权留痕</span><span class="v10-impacts-v">越权尝试、危险操作、拦截与异常审批统一进安全事件</span></div>' +
        '</div>';
    } else {
      var list = (global.V10UI && global.V10UI.auditList) ? global.V10UI.auditList() : [];
      var mine = list.filter(function (r) { return r.actor === ME.name; });
      body = mine.length
        ? '<div class="bt-note" style="margin-bottom:8px">本会话共 ' + list.length + ' 条写操作，其中你本人 ' + mine.length + ' 条。</div>' +
          '<div class="v10-impacts">' + mine.slice().reverse().map(function (r) {
            return '<div class="v10-impacts-row"><span class="v10-impacts-k">' + esc(String(r.at).slice(5, 16).replace('T', ' ')) + '</span>' +
              '<span class="v10-impacts-v">' + esc(r.action) + ' · ' + esc(r.target) + '</span></div>';
          }).join('') + '</div>'
        : '<div class="empty"><div class="empty-title">本会话还没有你的操作记录</div>' +
          '<div class="empty-sub">做过写操作并确认后，这里会留下「谁 · 做了什么 · 对谁」</div></div>';
      body += '<div class="bt-note" style="margin-top:10px">演示环境记录存在浏览器会话存储，<b>刷新页面即清空</b>；生产环境须由后端审计服务留存 ≥ 3 年且不可篡改。</div>';
    }
    acctModal(title, body);
  }
  function logoutConfirm() {
    var h = helpers();
    h.dangerConfirm(h, {
      title: '退出登录', desc: '退出当前账号（' + ME.name + '）？',
      tone: 'warn', perm: 'session:logout', requireReason: false, confirmText: '确认退出',
      action: '退出登录', target: ME.name + ' · ' + ME.id,
      impacts: [
        { label: '当前身份', value: ME.name + '（' + ME.role + '）' },
        { label: '未提交的草稿', value: '表单内容会丢失', tone: 'warn' },
        { label: '演示环境说明', value: '仅清除本会话标记，不涉及真实凭证' }
      ],
      onConfirm: function () {
        sessionStorage.setItem('aiops:logout', JSON.stringify({ id: ME.id, at: new Date().toISOString() }));
        toast('演示环境：已退出「' + ME.name + '」（仅本会话标记，未清除任何业务数据）', 'info');
      }
    });
  }

  /* SECTION: top-events */
  function bindShell() {
    els.rail.addEventListener('click', function (e) {
      var t = e.target.closest('[data-nav]');
      if (!t) return;
      var v = t.getAttribute('data-nav');
      if (v === 'overview') navigate({ domain: 'overview', cap: 'overview', agentId: null, tab: null, traceId: null });
      else {
        var first = CAPS.filter(function (c) { return c.domain === v; })[0];
        navigate({ domain: v, cap: first ? first.id : v, agentId: null, tab: null, traceId: null });
      }
    });
    els.submenu.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cap]');
      if (!t) return;
      var c = capById(t.getAttribute('data-cap'));
      navigate({ domain: c.domain, cap: c.id, agentId: null, tab: null, traceId: null, page: 1 });
    });
    /* 面包屑已下线；容器可能已被移除，这里加 null guard，避免 els.crumb 为 null 时报错。 */
    if (els.crumb) els.crumb.addEventListener('click', function (e) {
      var t = e.target.closest('[data-crumb]');
      if (!t) return;
      var p = els.crumb._parts[Number(t.getAttribute('data-crumb'))];
      if (p && p.nav) navigate(p.nav);
    });
    els.searchInput.addEventListener('input', function () { doSearch(els.searchInput.value); });
    els.searchInput.addEventListener('focus', function () { if (els.searchInput.value.trim()) doSearch(els.searchInput.value); });
    /* v10b（走查 3.3）：listbox 方向键导航 —— ↑↓ 环绕、Enter 选中高亮项。
       Ctrl+K 的平台适配早就在（:metaKey||ctrlKey），但键帽提示写死 ⌘K ——
       Windows 用户看到的是陌生符号，init() 里按平台改写。 */
    els.searchInput.addEventListener('keydown', function (e) {
      var pop = els.searchPop;
      if (pop.classList.contains('hidden') || !pop._hits || !pop._hits.length) return;
      var n = pop._hits.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSearchActive(pop._active < 0 ? 0 : (pop._active + 1) % n);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchActive(pop._active < 0 ? n - 1 : (pop._active - 1 + n) % n);
      } else if (e.key === 'Enter') {
        if (pop._active >= 0) { e.preventDefault(); pickSearch(pop._active); }
      }
    });
    els.searchPop.addEventListener('click', function (e) {
      var t = e.target.closest('[data-si]');
      if (!t) return;
      pickSearch(Number(t.getAttribute('data-si')));
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#search-wrap')) hideSearchPop();
    });
    /* 弹窗挂载在 document.body（不在 els.content 内），而 bindContent 里的 [data-act] 委托
     * 只覆盖 els.content —— 结果弹窗内所有按钮都是「死的」（点了毫无反应，
     * 因为没有任何监听器）。这里补一条文档级委托，让弹窗里的 data-act 真正生效。
     * 已在 content 里绑过的按钮不重复处理（靠 closest('.content') 判断）。
     * close-modal 由下面那条专门处理，这里跳过，避免与「点遮罩关闭」逻辑打架。 */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.classList.contains('m-info')) return;
      var act = b.getAttribute('data-act');
      if (act === 'close-modal') return;                 // 交给下面的关闭逻辑
      if (b.closest('#content')) return;                 // content 内已绑过
      if (b.classList.contains('m-modal-x')) return;
      e.stopPropagation();                                // 别再冒泡到遮罩层把它关了
      handleAction(act, b.getAttribute('data-id'), b);
    });

    /* 弹窗挂载在 document.body（不在 els.content 内），关闭按钮需文档级委托才生效。
     * ⚠ 遮罩层自身带 data-act="close-modal"（点空白处关闭），而弹窗内所有按钮也在
     * document.body 里 —— 若不判「是否点在遮罩层本身」，点任何内部按钮都会冒泡到遮罩层
     * 把弹窗关掉（表单里点「提交」会连校验提示一起消失）。
     * 故要求：event.target 必须就是遮罩层（或其直接空白子节点），内部点击一律不关。 */
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act="close-modal"]');
      if (!t) return;
      var m = t.closest('.modal-mask');
      if (!m) return;
      // 命中遮罩层内部（表单/按钮/标题等）→ 不关
      if (m.contains(e.target) && e.target !== m && !m.classList.contains('bare-mask')) {
        // 显式的关闭控件（× 按钮 / 取消按钮）例外：它们语义就是关闭
        var isExplicit = e.target.closest('.modal-x, [data-act="close-modal"]:not(.modal-mask)');
        if (!isExplicit) return;
      }
      m.remove();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); els.searchInput.focus(); els.searchInput.select(); }
      if (e.key === 'Escape') { hideSearchPop(); hideTip(); }
      /* 模拟用户 · 单人回放的续聊框：回车 = 发送（走 click，与鼠标同一条委托链路） */
      if (e.key === 'Enter' && e.target && e.target.id === 'sim-chat-input') {
        var sendBtn = document.querySelector('[data-act="sim-chat-send"]');
        if (sendBtn) { e.preventDefault(); sendBtn.click(); }
      }
    });
    window.addEventListener('hashchange', function () {
      /* 旧链接兼容：老 hash 先重写成新能力名，再走正常解析（避免两套解析逻辑） */
      var fixed = rewriteLegacyHash(location.hash);
      if (fixed !== location.hash) { location.replace(fixed); return; }
      /* 收残留弹层 —— 这里是**唯一的收口点**，理由：
         navigate() 自己也会收一次，但那条路只覆盖"程序内部发起导航"；
         而多页签条点击、地址栏改 hash、浏览器前进/后退都**只**触发 hashchange、不经过 navigate()。
         此前正因为只在 navigate() 里收，「沙盒页打开高危确认层 → 点页签条切到成本归因」
         会让确认层原样留在成本页上，且仍可提交（破坏性动作在错误的页面上执行）。
         放在 parseHash 之前：先清干净，再按新 hash 渲染，渲染过程中新开的弹窗不受影响。 */
      closeModals();
      var r = parseHash();
      var c = capById(r.cap);
      state.domain = c.domain === 'overview' ? 'overview' : c.domain;
      state.cap = c.id;
      // obs 页 tab 位于路径首段：#/platform/obs/{trace|eval|badcase|alert}
      if (state.cap === 'obs') {
        if (r.rest[0] === 'trace') { state.agentId = null; state.tab = null; state.traceId = r.rest[1] || null; }
        else { state.agentId = null; state.tab = r.rest[0] || 'trace'; }
      }
      /* 2026-10-21：「账号与 Agent 权限」整页删除，这条视图名特判随之删除
         （能力对象已不在 CAPS 里，任何旧深链都会走兜底，不会再落到这一屏）。 */
      /* 审批存档：第二段可能是**页签名**（apr-flow 等），也可能是**审批单 id**（ap-1）。
         不特判的后果（业主截图那个「未找到该对象 · ID: apr-flow」）：
         点「审批流配置」→ 页签写进 URL → 刷新或复制链接 → apr-flow 被当成对象 id 走
         approvalDetail → 渲染「未找到该对象」。同理 apr-pending / apr-rules 全都会中。
         两路互斥：这一屏的 tab 就在第二段，没有 /{tab}/{id} 这种形态。 */
      else if (state.cap === 'approval') {
        var APR_TABS = ['apr-pending', 'apr-mine', 'apr-decided', 'apr-rules', 'apr-sec', 'apr-flow'];
        state.traceId = null;
        if (APR_TABS.indexOf(r.rest[0]) > -1) { state.agentId = null; state.tab = r.rest[0]; }
        else { state.agentId = r.rest[0] || null; state.tab = null; }
      }
      /* 2026-10-20 走查修复：成本页的四个视角也是「第二段 = 页签名」，
         但这里没有白名单 —— `#/platform/cost/cost-model` 里的 cost-model 被当成对象 id
         写进 state.agentId，下一次切页签 buildHash 会把两者都拼进去，变成
         `#/platform/cost/cost-model/cost-agent`，越切越长，刷新/分享落到错视图。 */
      else if (state.cap === 'cost') {
        var COST_TABS_A = ['cost-biz', 'cost-model', 'cost-agent', 'cost-caller'];
        state.agentId = null; state.traceId = null;
        state.tab = COST_TABS_A.indexOf(r.rest[0]) > -1 ? r.rest[0] : null;
      }
      else {
        state.agentId = r.rest[0] || null;
        // trace 路由：/platform/obs/trace/tr-xxx
        if (r.rest[0] === 'trace') { state.agentId = null; state.traceId = r.rest[1] || null; state.tab = null; }
        /* v15：兼容历史形态 /{cap}/{objId}/trace/{traceId}（旧链接/外部粘贴不断）。
           同时明确把非 trace 路由的 traceId 清空 —— 否则从 trace 页返回列表时
           会残留上一次的 traceId，被分发逻辑误判成 trace 详情。 */
        else if (r.rest[1] === 'trace') { state.traceId = r.rest[2] || null; state.tab = null; }
        /* v32：Agent 详情缺页签段时，**在路由层**落默认页签（会话与干预，见 renderers.js 的 AGENT_TABS 顺序）。
           为什么必须在路由层落而不是让渲染器兜底：多页签条标题、面包屑、V10 页签登记都读 state.tab，
           只在渲染器里默认会让「地址栏/页签名」与「实际渲染的屏」对不上（实测：内容已是会话屏，页签名还写运行监控）。 */
        else {
          state.tab = r.rest[1] || (c.id === 'agent-wb' && r.rest[0] ? 'session' : null);
          state.traceId = null;
        }
      }
      state.page = 1;
      /* 排序是「这张表的视图状态」，换表就清掉，否则会把 A 表的排序列带到 B 表。
         同一张表内的 hash 变化（翻页/改筛选）由 hydrateFromQuery 从 URL 恢复。
         obs（trace 列表）与 llm-exp（经验库）的排序写进 URL，所以这两个页面要保留。 */
      if (c.id !== 'obs' && c.id !== 'llm-exp') { state.sortKey = null; state.sortDir = 'desc'; }
      if (c.id !== 'sandbox') state.sbxFilter = {};
      /* v20 修复（P1-6）：批量勾选与 sbxFilter 同生命周期——离开沙盒页即清空。
       * 必须清在这里（hashchange），不能只清在 navigate()：
       * 用户点导航、改地址栏、前进后退都只触发 hashchange，不经过 navigate，
       * 只在 navigate 里清 ⇒ 「沙盒页勾选 → 去总览 → 回沙盒页」批量条原样还在。
       * 与上方 sbxFilter 一行同源，别拆开。*/
      if (c.id !== 'sandbox' && state.sbxSel && state.sbxSel.length) state.sbxSel = [];
      state.objId = state.agentId;
      state.objTab = state.tab;
      hydrateFromQuery(r.q);
      /* ?detail= 深链：带 detailType 的能力，把 query 里的对象 id 提到路由上。
         不提的话，重开/分享这种链接只渲染列表（旧链接等于死链）。 */
      if (c.detailType && !state.agentId) {
        var qid = state[DETAIL_FIELDS[c.id]];
        if (qid) { state.agentId = qid; state.objId = qid; }
      }
      render();
    });

    /* v10：顶栏通知面板 + 审计抽屉 */
    var bell = $('v10-bell'), notif = $('v10-notif'), auditBtn = $('v10-audit-btn');
    if (bell && notif) bell.addEventListener('click', function () {
      if (!notif.classList.contains('hidden')) { notif.classList.add('hidden'); return; }
      notif.innerHTML = global.V10UI ? global.V10UI.notificationBell(helpers()) : '<div class="empty-title">通知组件未加载</div>';
      notif.classList.remove('hidden');
      refreshBellBadge();   /* 面板已视为已读，角标同步清零 */
    });
    if (auditBtn) auditBtn.addEventListener('click', function () {
      var host = document.createElement('div');
      host.className = 'modal-mask';
      host.innerHTML = '<div class="modal"><div class="modal-h"><h3>审计记录</h3>' +
        '<button class="modal-x" aria-label="关闭">×</button></div>' +
        (global.V10UI ? global.V10UI.auditDrawer(helpers()) : '<div class="empty-title">审计组件未加载</div>') +
        '</div>';
      host.addEventListener('click', function (e) {
        if (e.target === host || (e.target.className || '').indexOf('modal-x') > -1) host.remove();
      });
      document.body.appendChild(host);
    });
  }

  /* SECTION: modal-focus
   * v10b（走查 3.2）：弹窗焦点管理 —— 全局 MutationObserver 方案。
   * 此前 .modal-mask 有 role=dialog / aria-modal 的「形」，但无焦点陷阱、无 ESC、
   * 关闭后焦点不归还；而账号菜单（bindAccount）早已是完整键盘闭环 —— 同一份代码两种标准。
   * 任何模块往 body 塞 .modal-mask 都自动获得：打开聚焦 / Tab 循环 / ESC 关闭 / 关闭归还。
   * 不逐个改 20+ 个渲染器 —— 那样必有漏网；观察器一处收口。
   * （.v10-sheet-mask 由 v10-ui.js 的 onSheetKey 自管 ESC，不在此重复接管。）
   */
  var FOCUS_SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusablesIn(root) {
    var nodes = root.querySelectorAll(FOCUS_SEL);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) out.push(el);
    }
    return out;
  }
  function topModal() {
    var masks = document.querySelectorAll('.modal-mask');
    return masks.length ? masks[masks.length - 1] : null;
  }
  var modalFocus = { prev: null, bound: false };
  function onModalKey(e) {
    var m = topModal();
    if (!m) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      m.remove();            /* 与 close-modal 点击委托同路径：纯移除 */
      return;
    }
    if (e.key !== 'Tab') return;
    var list = focusablesIn(m);
    if (!list.length) { e.preventDefault(); if (!m.getAttribute('tabindex')) m.setAttribute('tabindex', '-1'); m.focus(); return; }
    var first = list[0], last = list[list.length - 1];
    var cur = document.activeElement;
    if (!m.contains(cur)) { e.preventDefault(); first.focus(); return; }   /* 焦点已逃逸，拉回来 */
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  function watchModals() {
    var mo = new MutationObserver(function () {
      var m = topModal();
      if (m && !modalFocus.bound) {
        modalFocus.prev = document.activeElement;
        modalFocus.bound = true;
        document.addEventListener('keydown', onModalKey, true);
        var list = focusablesIn(m);
        if (list.length) list[0].focus();
        else { if (!m.getAttribute('tabindex')) m.setAttribute('tabindex', '-1'); m.focus(); }
      } else if (!m && modalFocus.bound) {
        document.removeEventListener('keydown', onModalKey, true);
        modalFocus.bound = false;
        if (modalFocus.prev && modalFocus.prev.focus) { try { modalFocus.prev.focus(); } catch (err) {} }
        modalFocus.prev = null;
      }
    });
    mo.observe(document.body, { childList: true });
  }

  /* SECTION: global-errors
   * v10b（走查 3.9）：全局错误兜底。页面级有 try-catch + fatal 页（render 内），
   * 但渲染外的异步回调抛错即静默 —— 控制台与 Toast 双通道留下线索。 */
  function bindGlobalErrors() {
    window.addEventListener('error', function (e) {
      if (global.console) console.error('[uncaught]', e.error || e.message);
      try { toast('脚本错误：' + String((e.error && e.error.message) || e.message || '未知').slice(0, 80), 'bad'); } catch (err) {}
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      if (global.console) console.error('[unhandledrejection]', r);
      try { toast('异步操作失败：' + String((r && r.message) || r || '未知').slice(0, 80), 'bad'); } catch (err) {}
    });
  }

  /* SECTION: init */
  function init() {
    /* 旧链接兼容：把 #/engine/survey… 改写成 #/engine/interview… 再解析（收藏/分享/历史页签都还在） */
    var bootFixed = rewriteLegacyHash(location.hash);
    if (bootFixed !== location.hash && location.replace) location.replace(bootFixed);
    els = {
      rail: $('rail'), submenu: $('submenu'), content: $('content'), crumb: $('crumb'),
      searchInput: $('search-input'), searchPop: $('search-pop'), toast: $('toast'),
      clock: $('clock')
    };
    bindShell();
    bindAccount();
    bindToast();
    bindGlobalErrors();
    watchModals();
    /* v10b（走查 3.3）：搜索键帽按平台显示 —— Windows 用户不该看到陌生的 ⌘ 符号 */
    try {
      var kbd = document.querySelector('.search-kbd');
      if (kbd) kbd.textContent = isMacPlatform() ? '⌘K' : 'Ctrl+K';
    } catch (e) {}
    var r = parseHash();
    if (location.hash && r.cap && capById(r.cap)) {
      var c = capById(r.cap);
      state.domain = c.domain; state.cap = c.id;
      if (state.cap === 'obs') {
        if (r.rest[0] === 'trace') { state.agentId = null; state.tab = null; state.traceId = r.rest[1] || null; }
        else { state.agentId = null; state.tab = r.rest[0] || 'trace'; }
      }
      /* 2026-10-21：account 页已删除，对应的视图名特判一并删除（见上） */
      /* 与 hashchange 分支同一规则（两处必须一致）：approval 的第二段可能是页签名 */
      else if (state.cap === 'approval') {
        var APR_TABS_B = ['apr-pending', 'apr-mine', 'apr-decided', 'apr-rules', 'apr-sec', 'apr-flow'];
        state.traceId = null;
        if (APR_TABS_B.indexOf(r.rest[0]) > -1) { state.agentId = null; state.tab = r.rest[0]; }
        else { state.agentId = r.rest[0] || null; state.tab = null; }
      }
      /* 与 hashchange 分支同一规则（两处必须一致）：cost 的第二段是视角名，不是对象 id */
      else if (state.cap === 'cost') {
        var COST_TABS_B = ['cost-biz', 'cost-model', 'cost-agent', 'cost-caller'];
        state.agentId = null; state.traceId = null;
        state.tab = COST_TABS_B.indexOf(r.rest[0]) > -1 ? r.rest[0] : null;
      }
      else if (r.rest[0] === 'trace') state.traceId = r.rest[1] || null;
      /* v15：兼容 /{cap}/{objId}/trace/{traceId}（与 hashchange 分支同一规则，两处必须一致） */
      else if (r.rest[1] === 'trace') { state.traceId = r.rest[2] || null; state.tab = null; }
      else {
        state.agentId = r.rest[0] || null;
        /* 与 hashchange 分支同一规则（两处必须一致）：Agent 详情缺页签时落「会话与干预」 */
        state.tab = r.rest[1] || (state.cap === 'agent-wb' && r.rest[0] ? 'session' : null);
        state.traceId = null;
      }
    } else {
      // 首次进入或 hash 无效：落到总览，并把默认路由写进地址栏，
      // 保证「每个视图都有独立 URL、可刷新、可分享」从第一屏就成立。
      state.domain = 'overview'; state.cap = 'overview';
      location.hash = '#/overview';
    }
    hydrateFromQuery(r.q);
    state.objId = state.agentId;
    state.objTab = state.tab;
    /* 同 hashchange 分支：?detail= 的对象 id 提到路由上，否则详情页打不开（两处必须一致） */
    var bootCap = capById(state.cap);
    if (bootCap && bootCap.detailType && !state.agentId) {
      var bootQid = state[DETAIL_FIELDS[bootCap.id]];
      if (bootQid) { state.agentId = bootQid; state.objId = bootQid; }
    }
    if (els.clock) {
      var tick = function () {
        var fr = Q.freshness();
        els.clock.textContent = fr.text;
        els.clock.setAttribute('data-tip', fr.delayNote + ' · 数据集 ' + fr.dataset);
      };
      tick(); setInterval(tick, 60000);
    }
    render();
  }

  global.APP_SHELL = { init: init, helpers: helpers, state: state, fmt: fmt, icon: icon, esc: esc, render: render, me: ME, refreshBellBadge: refreshBellBadge, toast: toast };
  global.CURRENT_USER = ME;   /* 单一身份源：任何渲染点要显示「我是谁」都读这里，不许硬编码 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
