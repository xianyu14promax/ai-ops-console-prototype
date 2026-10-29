/* SECTION: v29-gateway-tabs
 * 网关能力页拆成三个页内 Tab：MCP 服务 / LLM 路由 / Skill。
 *
 * 为什么拆：原先三类东西挤在一屏 —— 服务健康墙放的是 MCP 服务，下半区却摆着
 * 「模型用量分布」，密钥表里 mcp:// 与 llm:// 混着。看 MCP 的人被迫读模型成本，
 * 看模型的人找不到计价表。拆开后每页只回答一个问题，页头也各有各的主按钮：
 *   · MCP 服务 → 止血（全局降级）+ 密钥轮换
 *   · LLM 路由 → 档位、计价与按模型归因
 *   · Skill    → 技能包的引用方、触发量与依赖健康
 *
 * 状态存 state.gwPageTab，并写进 URL 的 ?gw=llm|skill —— 与 Agent 工作台的「网状关系」
 * 同一套做法：该能力的路径首段已被详情对象 id 占着，屏内 Tab 不能再占路径段
 * （#/platform/gateway/llm 会被解析成 objId='llm'，落到「网关服务不存在」的空详情页）。
 * 写进 URL 的另一个用途是能分享：「网关的 Skill 页」现在是一条可直达的链接。
 *
 * ⚠ 本文件**拥有**网关闭环：RENDERERS.gatewayPage（三个 Tab 的分发）、三个子页渲染器、
 *   密钥清单 GW_KEYS 与之上的「轮换 / 吊销」动作 gw-key，全在这里一处。
 *   renderers2.js 里原先那版 gatewayPage 与内联的 svc 健康计算已经删除，
 *   那里只留一条指过来的注释 —— 同一页两份实现，下次改的时候一定会改错那一份。
 *   取数一律走 QUERY 的 mcpHealth / llmRoutes / skillTable：页面不自己算数。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, C = global.CHARTS, APP = global.APP_DATA;
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  function UI() { return global.UI || {}; }
  /** 阈值一律走 decisions.js；取不到时给保守默认（不静默 undefined） */
  function DEC(domain, key, fb) {
    var d = global.DECISIONS;
    return (d && d.value) ? d.value(domain, key, fb) : fb;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }

  /* SECTION: gateway-keys
   * 网关密钥清单。kind 决定它出现在哪个 Tab：MCP 页只列 mcp:// 的密钥，
   * LLM 页只列 llm:// 的 —— 工具密钥与模型密钥的轮换节奏、影响面本来就不同。
   * name 是「轮换 / 吊销」（gw-key，本文件下方）查证密钥的键，改名要连动作一起看。 */
  var GW_KEYS = [
    { name: 'prod-gateway-main', svc: 'mcp://crm/query', tail: 'a3f9', lastUse: '2 分钟前', days: 214, kind: 'mcp' },
    { name: 'prod-gateway-backup', svc: 'mcp://order/detail', tail: '7c21', lastUse: '18 分钟前', days: 22, kind: 'mcp' },
    { name: 'llm-qwen-prod', svc: 'llm://qwen-max', tail: 'e08b', lastUse: '刚刚', days: 96, kind: 'llm' },
    { name: 'staging-test', svc: 'mcp://doc/parse', tail: '4d55', lastUse: '3 天前', days: 8, kind: 'mcp' }
  ];
  function keysOf(kind) { return GW_KEYS.filter(function (k) { return k.kind === kind; }); }
  function keyWindow() { return DEC('网关', '密钥_轮换窗口', 30); }
  function soonKeys(kind) {
    var win = keyWindow();
    return keysOf(kind).filter(function (k) { return k.days < win; })
      .sort(function (a, b) { return a.days - b.days; });
  }

  /* SECTION: tab-bar
   * 角标 = 该页需要动手的条数（与详情页 Tab 同一规则：0 不显示角标，
   * 挂一个「0」只是噪声）。口径与各页指标卡的「需关注」严格同一个数。 */
  var TABS = [
    { id: 'mcp', label: 'MCP 服务' },
    { id: 'llm', label: 'LLM 路由' },
    { id: 'skill', label: 'Skill' }
  ];
  function gwPageOf(state) {
    var p = state && state.gwPageTab;
    return (p === 'llm' || p === 'skill') ? p : 'mcp';
  }
  function tabBadges(h) {
    var out = {};
    var limited = Q.mcpHealth().filter(function (s) { return s.status !== 'ok'; }).length;
    if (limited) out.mcp = limited;
    var badRoute = Q.llmRoutes(h.state.range).filter(function (r) { return r.status === 'warn'; }).length;
    if (badRoute) out.llm = badRoute;
    var att = Q.skillTable().attention.length;
    if (att) out.skill = att;
    return out;
  }
  function gwTabs(h, active) {
    var b = tabBadges(h);
    var tips = {
      mcp: 'MCP 工具服务的健康、配额与密钥',
      llm: '模型路由的档位、计价与按模型归因',
      skill: '技能包：谁在引用、今天触发多少次、依赖是否健康'
    };
    return '<div class="tabs" role="tablist">' + TABS.map(function (t) {
      return '<button role="tab" class="tab' + (t.id === active ? ' on' : '') + '"' +
        ' data-act="gw-tab" data-id="' + t.id + '" data-tip="' + esc(tips[t.id]) + '"' +
        (t.id === active ? ' aria-selected="true"' : ' aria-selected="false"') + '>' + esc(t.label) +
        (b[t.id] ? '<i class="tab-badge">' + b[t.id] + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* SECTION: shared-bits
   * 密钥两件套（该轮换的密钥 / 密钥管理表）在 MCP 页与 LLM 页各出现一次 ——
   * 抽成函数，免得两处各画一套、下次只改一处。 */
  function keySoonCard(kind, h) {
    var win = keyWindow(), soon = soonKeys(kind);
    var head = '<div class="card-h"><h3>该轮换的密钥</h3><span class="card-sub">到期 &lt; ' + win + ' 天，按剩余天数排序</span></div>';
    if (!soon.length) {
      /* 没有临期密钥时也给一句有用的：最近一把是谁、还有多久。
         空态写「无到期密钥」与旁边密钥表底部那句是同一句话，并排摆着说两遍没有信息量。 */
      var next = keysOf(kind).slice().sort(function (a, b) { return a.days - b.days; })[0];
      return '<div class="card">' + head + '<div class="bt-note">' +
        (next ? '最近一把是 <b class="mono">' + esc(next.name) + '</b>（' + next.days + ' 天后到期 · 关联 ' + esc(next.svc) + '），本窗口内无需动作。'
              : '这个分类下还没有密钥。') + '</div></div>';
    }
    return '<div class="card">' + head + soon.map(function (x) {
      return '<div class="gw-key-row">' +
        '<b class="mono">' + esc(x.name) + '</b>' +
        '<span class="gw-key-svc">关联 ' + esc(x.svc) + '</span>' +
        '<span class="gw-key-due">' + x.days + ' 天后到期</span>' +
        '<button class="btn-ghost sm" data-act="gw-key" data-id="' + esc(x.name) + '|rotate">轮换</button>' +
        '</div>';
    }).join('') + '</div>';
  }
  function keyTableCard(kind, h) {
    var win = keyWindow(), keys = keysOf(kind), soon = soonKeys(kind);
    var has = (h.state.keyOps || {});
    return '<div class="card"><div class="card-h"><h3>密钥管理</h3>' +
      '<span class="card-sub">密钥永不回显明文，仅显示末 4 位</span></div>' +
      /* gw-key-tbl：这个表要挤进 628px 的并排卡片里（6 列 × .bt 默认 16px 内边距 = 192px
         只剩 400px 给内容，实测「prod-gateway-main」被折成 3 行、「214 天后」折成 2 行）。
         只收这一张表的单元格内边距与字号，不动全局 .bt —— 别的页表格宽得很。 */
      '<div class="gw-key-tbl">' +
      h.table({
        columns: [
          { key: 'name', label: '密钥' }, { key: 'svc', label: '关联服务', mono: true },
          { key: 'tail', label: '末四位', mono: true },
          { key: 'lastUse', label: '最近使用' },
          { key: 'expire', label: '到期', render: function (r) { return '<span class="' + (r.days < win ? 'warn' : '') + '">' + r.days + ' 天后</span>'; } },
          { key: 'act', label: '操作', render: function (r) {
            if (has[r.name]) return '<span class="pill idle">' + (has[r.name] === 'revoked' ? '已吊销（本会话）' : '已轮换（本会话）') + '</span>';
            return '<button class="lnk" data-act="gw-key" data-id="' + esc(r.name) + '|rotate">轮换</button> · <button class="lnk warn" data-act="gw-key" data-id="' + esc(r.name) + '|revoke">吊销</button>';
          } }
        ],
        rows: keys, noPaging: true
      }) + '</div>' +
      /* 这里只说**规则**（并行期、预警节奏、吊销后果），不再罗列哪几把要到期 ——
         旁边「该轮换的密钥」卡已经逐条列了名字和天数，并排摆着说两遍没有信息量。
         规则文案里的窗口天数取自 decisions.js，不写死。 */
      '<div class="bt-note">轮换支持新旧密钥并行期（到期前 30/7/1 天预警），吊销立即失效并通知所有引用方；' +
      '进入「该轮换的密钥」的窗口是剩余 ' + win + ' 天。' +
      (soon.length ? '' : '当前没有进入窗口的密钥。') + '</div>' +
      '</div>';
  }

  /* SECTION: mcp-tools
   * 工具清单与来源：成熟形态里「接入一个服务」先问的是"它给我哪些工具"，而不是"它 P99 多少"。
   * 工具状态 = 数据层 capability 清单（seed 的 tools / offTools）叠加本会话的开关（state.toolOps），
   * 与密钥、技能停用同一套做法：会话内可改，刷新还原。 */
  function srcTextOf(s) {
    if (s.source === 'plugin') return s.sourceName ? '来自插件 ' + s.sourceName : '来自插件';
    if (s.source === 'external') return s.sourceName ? '外部连接器 · ' + s.sourceName : '外部连接器';
    return '平台自建';
  }
  function toolsOf(s, h) {
    var ops = (h.state && h.state.toolOps) || {};
    return (s.tools || []).map(function (t) {
      var baseOff = (s.offTools || []).indexOf(t) >= 0;
      var ov = ops[s.id + '|' + t];
      var on = ov === 'on' ? true : (ov === 'off' ? false : !baseOff);
      return { name: t, on: on };
    });
  }
  function toolsOnCount(s, h) {
    return toolsOf(s, h).filter(function (t) { return t.on; }).length;
  }

  /* ══════════════════════════════════════════════════ Tab 1：MCP 服务 ══ */
  RENDERERS.gatewayMcp = function (cap, state, h) {
    var fmt = h.fmt;
    var svc = Q.mcpHealth();
    var limited = svc.filter(function (s) { return s.status !== 'ok'; });
    var sumQps = svc.reduce(function (a, s) { return a + s.qps; }, 0);
    var sumCap = svc.reduce(function (a, s) { return a + s.qpsCap; }, 0);
    var worstErr = svc.slice().sort(function (a, b) { return b.errRate - a.errRate; })[0];
    var slowest = svc.slice().sort(function (a, b) { return b.p99 - a.p99; })[0];
    var keys = keysOf('mcp'), soon = soonKeys('mcp'), win = keyWindow();

    /* 2026-10-21 业主：「删除这个」—— 顶部「N 个服务需要关注」横幅去掉。
       异常服务在下面的健康墙卡片上本来就有红标与状态文案，横幅只是把同一句话再说一遍，
       却占掉首屏最贵的一行。 */
    return '' +

      /* 指标全部由服务自身聚合 —— 不借平台级 KPI：
         这一页说的是 MCP 服务，头条挂全站调用量会让人以为那就是 MCP 的量。 */
      '<div class="metrics">' + [
        { label: 'MCP 服务', value: String(svc.length), alert: limited.length > 0,
          sub: (svc.length - limited.length) + ' 正常 / ' + limited.length + ' 异常',
          definition: '接入的 MCP 服务数（含只读与可写）。异常判定见健康墙卡片的副标题' },
        { label: '配额占用', value: fmt.pct1(sumCap ? sumQps / sumCap : 0),
          sub: sumQps + ' / ' + sumCap + ' QPS（合计）',
          definition: '各服务当前 QPS 之和 ÷ 各自配额之和。要看单个服务的真实余量，看健康墙卡片里的水位条' },
        { label: '错误率（最高）', value: fmt.pct2(worstErr ? worstErr.errRate : 0), alert: !!(worstErr && worstErr.errRate > 0.02),
          sub: worstErr ? worstErr.name : '',
          definition: '取单个服务的最高错误率，不是平均值 —— 平均会把一个坏服务摊平掉' },
        { label: 'P99（最慢）', value: fmt.dur(slowest ? slowest.p99 : 0), alert: !!(slowest && slowest.p99 > 4000),
          sub: slowest ? slowest.name : '',
          definition: '取单个服务最慢的 P99；超 4s 标红（与 Agent 列表同一阈值）' },
        { label: '密钥', value: String(keys.length), alert: soon.length > 0,
          sub: soon.length ? soon.length + ' 把 ' + win + ' 天内到期' : '无临期密钥',
          definition: '关联 mcp:// 服务的密钥数；到期窗口 ' + win + ' 天，唯一真源在 decisions.js' }
      ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>服务健康墙</h3><span class="card-sub">配额使用率超 80% 转琥珀，超 95% 转红 · 点卡片看详情</span></div>' +
      '<div class="svc-grid">' + svc.map(function (s) {
        /* 整卡可点（与 LLM / Skill 两页一致：卡片就是列表，点开是详情）。
           卡里的 日志/限流/熔断 仍是真链接 —— bindContent 给每个 [data-act] 都挂了
           stopPropagation，点内层链接不会顺带触发整卡跳转。 */
        return '<article class="svc ' + s.status + '" role="button" tabindex="0"' +
          ' data-act="gw-open" data-id="' + esc(s.id) + '|config"' +
          ' aria-label="打开 ' + esc(s.name) + ' 的配置详情">' +
          /* v24b：身份（图标 + 色相 + 中文用途）与状态（点 + pill）分开表达 ——
             6 个服务只有一串等宽的 mcp://xxx/yyy 时，整屏扫不出谁是谁。 */
          '<div class="svc-h">' + UI().svcTag(h, s.id) +
          /* ⚠ 这层必须是 div 不能是 span：里面装着服务名按钮，phrasing 元素里放 <button>
             会被 check-domrewrite.cjs 记成「解析器改写 DOM」的痕迹（本仓历史上真踩过）。 */
          '<div class="svc-hm">' +
          '<button class="lnk mono" data-act="gw-open" data-id="' + esc(s.id) + '|config" title="打开 ' + esc(s.name) + ' 的配置详情">' + esc(s.name) + '</button>' +
          (s.purpose ? '<span class="svc-purpose">' + esc(s.purpose) + '</span>' : '') +
          '</div>' +
          '<span class="svc-st"><span class="svc-dot"></span>' + h.pill(s.status, s.statusText) + '</span></div>' +
          '<div class="svc-kv"><span>当前 QPS</span><b>' + s.qps + ' / ' + s.qpsCap + '</b></div>' +
          C.gauge(s.usage, { title: '配额使用率' }) +
          '<div class="svc-kv"><span>错误率</span><b class="' + (s.errRate > 0.02 ? 'bad' : '') + '">' + fmt.pct2(s.errRate) + '</b></div>' +
          '<div class="svc-kv"><span>P99</span><b>' + fmt.dur(s.p99) + '</b></div>' +
          /* 来源与工具：接入一个服务时先要答的两问 —— 它是谁接进来的、它能干什么。
             工具是可点入口（本会话内可逐个停用），不是死文字。 */
          '<div class="svc-kv"><span>来源</span><b class="svc-src" title="' + esc(srcTextOf(s)) + '">' + esc(srcTextOf(s)) + '</b></div>' +
          '<div class="svc-kv"><span>工具</span><b><button class="lnk" data-act="gw-tools" data-id="' + esc(s.id) + '"' +
          ' title="查看这个服务暴露的工具，可逐个停用">' + toolsOnCount(s, h) + ' / ' + s.toolsTotal + ' 已启用</button></b></div>' +
          /* 事故条：只出现在压着未恢复事故的服务上。参考形态里"坏了"是就地给修的动作，
             而不是让人自己去别处找。 */
          (s.incident ? '<div class="svc-diag" title="' + esc(s.incident.rootCause || '') + '">' +
            '<b>' + esc(s.incident.level || 'P1') + ' 事故进行中</b>' +
            '<span>' + esc(s.incident.title) + '</span>' +
            (h.state.svcReconnects && h.state.svcReconnects[s.id] ? '<em>已发起重连</em>' : '') +
            '</div>' +
            '<div class="svc-acts svc-acts-diag">' +
            '<button class="lnk" data-act="svc-reconnect" data-id="' + esc(s.id) + '" title="对该服务发起重连（演示环境：记录在本会话）">重连</button>' +
            '<button class="lnk" data-act="svc-guide" data-id="' + esc(s.id) + '" title="按事故记录给出的处置步骤">操作指引</button>' +
            '<button class="lnk" data-act="svc-copy-log" data-id="' + esc(s.id) + '" title="复制该服务最近的错误日志">复制日志</button>' +
            '</div>' : '') +
          '<div class="svc-acts">' +
          '<button class="lnk" data-act="gw-open" data-id="' + esc(s.id) + '|logs" title="查看调用日志（含请求/响应，敏感字段脱敏）">日志</button>' +
          '<button class="lnk" data-act="gw-open" data-id="' + esc(s.id) + '|traffic" title="限流与降级规则">限流</button>' +
          '<button class="lnk warn" data-act="gw-open" data-id="' + esc(s.id) + '|traffic" title="止血操作在流量治理页（一键熔断，需确认影响面）">熔断</button>' +
          '<button class="lnk" data-act="gw-dep-skill" data-id="' + esc(s.id) + '" title="哪些技能依赖这个服务">依赖它的技能</button>' +
          '<span class="sk-go">详情 →</span>' +
          '</div></article>';
      }).join('') + '</div></div>' +

      /* 两张卡并排（.grid2-wide 的 minmax 480px 让「密钥管理」6 列表格塞得下，不再横滚） */
      '<div class="grid2-wide">' + keySoonCard('mcp', h) + keyTableCard('mcp', h) + '</div>';
  };

  /* ══════════════════════════════════════════════════ Tab 2：LLM 路由 ══ */
  RENDERERS.gatewayLlm = function (cap, state, h) {
    var fmt = h.fmt;
    var routes = Q.llmRoutes(state.range);
    var totalCalls = routes.reduce(function (a, r) { return a + (r.calls || 0); }, 0);
    var totalCost = routes.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    var slowest = routes.slice().sort(function (a, b) { return (b.p99 || 0) - (a.p99 || 0); })[0];
    var worstSr = routes.filter(function (r) { return r.successRate != null; })
      .sort(function (a, b) { return a.successRate - b.successRate; })[0];
    var embed = routes.filter(function (r) { return r.tier === 'embed'; }).length;
    var costPct = function (r) { return totalCost ? r.cost / totalCost : 0; };

    return '<div class="metrics">' + [
        { label: '模型路由', value: String(routes.length), sub: embed ? '含 ' + embed + ' 个向量模型' : '',
          definition: '已接入的模型路由数（含向量模型 text-embed-v3，它不出现在调用明细里）' },
        { label: '调用量', value: fmt.compact(totalCalls), sub: '按模型归因，全部路由合计',
          definition: '所选时间范围内、按模型维度聚合的调用次数；与成本页「按模型归因」同一口径' },
        { label: '总成本', value: fmt.money(totalCost), sub: '单价来自模型计价表',
          definition: '按各模型单价（元/千 token）与入/出 token 分别计价后求和' },
        { label: 'P99（最慢）', value: fmt.dur(slowest ? slowest.p99 : 0), alert: !!(slowest && slowest.p99 > 4000),
          sub: slowest ? slowest.name : '',
          definition: '取最慢的一条路由；超 4s 标红。模型侧时延受上游容量影响，看「可观测」页的事故区间' },
        { label: '成功率（最低）', value: worstSr ? fmt.pct2(worstSr.successRate) : '—', alert: !!(worstSr && worstSr.successRate < 0.99),
          sub: worstSr ? worstSr.name : '',
          definition: '取成功率最低的一条路由；低于 99% 标红（与 Agent 列表同一阈值）' }
      ].map(h.metricCard).join('') + '</div>' +

      /* 与 Skill 页同一条纪律：**卡片即列表**。这里原本还有一张「模型用量分布」表，
         4 行 8 列，说的就是这 4 条路由 —— 同一批对象在一屏里画两遍，改一处必忘另一处。
         单价 / token / 调用占比这些列已经收进卡片；要横向对比多列时去成本页「按模型归因」
         （同一套聚合、同样的口径），那里才是做报表的地方。 */
      '<div class="card"><div class="card-h"><h3>模型路由</h3>' +
      '<span class="card-sub">点任意一张卡看配置、监控与日志；要横向对比多列数字去成本页「按模型归因」</span></div>' +
      '<div class="svc-grid">' + routes.map(function (r) {
        /* 整卡可点（本仓 Agent 列表的 .ag-card 同一做法）。卡里的 监控/日志/限流 仍是真链接：
           bindContent 给每个 [data-act] 都挂了 stopPropagation，点内层链接不会顺带触发整卡跳转。 */
        return '<article class="svc ' + r.status + '" role="button" tabindex="0"' +
          ' data-act="gw-open" data-id="' + esc(r.id) + '|config"' +
          ' aria-label="打开 ' + esc(r.name) + ' 的配置详情">' +
          '<div class="svc-h">' + UI().svcTag(h, r.id) +
          '<div class="svc-hm">' +
          '<button class="lnk mono" data-act="gw-open" data-id="' + esc(r.id) + '|config" title="打开 ' + esc(r.name) + ' 的配置详情">' + esc(r.name) + '</button>' +
          '<span class="svc-purpose">' + esc(r.tierText || '') + '模型' + (r.calls ? '' : ' · 本期无调用') + '</span>' +
          '</div>' +
          '<span class="svc-st"><span class="svc-dot"></span>' + h.pill(r.status === 'warn' ? 'warn' : (r.calls ? 'ok' : 'idle'), r.statusText) + '</span></div>' +
          '<div class="sk-nums">' +
          '<span><i>调用</i><b>' + fmt.int(r.calls) + '</b></span>' +
          '<span><i>成本</i><b>' + fmt.money2(r.cost) + '</b></span>' +
          '<span><i>P99</i><b class="' + (r.p99 > 4000 ? 'bad' : '') + '">' + fmt.dur(r.p99) + '</b></span>' +
          '</div>' +
          C.gauge(costPct(r), { title: '成本占比' }) +
          '<div class="svc-kv"><span>token</span><b>' + fmt.int(r.tokens) + '</b></div>' +
          '<div class="svc-kv"><span>单价（入 / 出 每千 token）</span><b>¥' + r.inPer1k.toFixed(4) + ' / ¥' + r.outPer1k.toFixed(4) + '</b></div>' +
          '<div class="svc-acts">' +
          '<button class="lnk" data-act="gw-open" data-id="' + esc(r.id) + '|monitor" title="实时监控">监控</button>' +
          '<button class="lnk" data-act="gw-open" data-id="' + esc(r.id) + '|logs" title="调用日志">日志</button>' +
          '<button class="lnk warn" data-act="gw-open" data-id="' + esc(r.id) + '|traffic" title="限流与降级链（改之前先看影响面）">限流</button>' +
          '<span class="sk-go">详情 →</span>' +
          '</div></article>';
      }).join('') + '</div>' +
      '<div class="bt-note">「成本占比」按金额算（水位条）；卡片上的数字都随上方时间范围变。' +
      '要按模型横向对比多列（token / 单价 / 调用占比 / P99）时去 <b>成本与调用归因 ·「按模型归因」</b> —— 同一套聚合、同一口径。</div>' +
      '</div>' +

      '<div class="grid2-wide">' + keySoonCard('llm', h) + keyTableCard('llm', h) + '</div>';
  };

  /* ══════════════════════════════════════════════════ Tab 3：Skill ══ */
  /** 技能身份图标块。与 svcTag 同一套视觉，但取的是技能自己的 icon/tone ——
      技能不在 svcMeta 里（那是 MCP 服务与模型的注册表），这里不硬塞进去，
      免得「网关接入服务」这个概念被两拨不相干的东西撑大。 */
  function skTag(h, sk, size) {
    var sm = size === 'sm';
    return '<span class="svc-ico' + (sm ? ' sm' : '') + ' t-' + esc(sk.tone || 'blue') + '" title="' +
      esc(sk.name + '（' + sk.purpose + '）') + '">' + h.icon(sk.icon || 'cap', sm ? 12 : 15) + '</span>';
  }
  var TASK_TEXT = {
    submitted: '已提交', working: '进行中', 'input-required': '等待补充',
    completed: '已完成', canceled: '已取消', failed: '失败'
  };
  function statusOf(sk, h) {
    var ov = (h.state.skillOps || {})[sk.id];
    return ov === 'off' ? 'off' : (ov === 'on' ? 'on' : sk.status);
  }
  function statusTextOf(st, sk) {
    if (st === 'off') return '已停用（本会话）';
    return { on: '启用中', gray: '灰度中', off: '已停用' }[st] || st;
  }
  function chip(label, title, act, id) {
    /* 依赖缺失（资产表里查不到这个 id）时不给动作，但仍然渲染出来 ——
       缺一个依赖是**要修的问题**，把它藏起来等于掩盖。 */
    var asBtn = !!act;
    return '<button class="chip link' + (asBtn ? '' : ' on') + '"' +
      (asBtn ? ' data-act="' + esc(act) + '" data-id="' + esc(id) + '"' : ' aria-pressed="true"') +
      ' data-tip="' + esc(title) + '">' + esc(label) + '</button>';
  }
  /** 依赖标签：点到哪一层是设计决定 —— 工具跳到 MCP 页的服务详情，模型跳到 LLM 页的路由详情，
      知识库跳到知识库能力页。这样「这条技能现在最可能坏在哪」是一跳就能查的。 */
  function depChips(sk, h) {
    var out = [];
    (sk.deps.mcp || []).forEach(function (m) {
      var meta = UI().svcMeta ? UI().svcMeta(m.id) : null;
      out.push(chip(m.name, m.__missing ? '依赖缺失：资产表里没有 ' + m.id : (meta && meta.purpose ? meta.purpose : 'MCP 服务'),
        m.__missing ? '' : 'gw-open', m.__missing ? '' : m.id + '|config'));
    });
    (sk.deps.kb || []).forEach(function (k) {
      out.push(chip(k.name, k.__missing ? '依赖缺失：资产表里没有 ' + k.id : '知识库', k.__missing ? '' : 'goto-cap', 'knowledge'));
    });
    if (sk.deps.model) {
      var m = sk.deps.model;
      out.push(chip('llm://' + m.name, m.__missing ? '依赖缺失：资产表里没有 ' + m.id : '模型路由',
        m.__missing ? '' : 'gw-open', m.__missing ? '' : 'llm-' + m.id + '|config'));
    }
    if (!out.length) return '<span class="sk-none">无外部依赖（纯提示词技能）</span>';
    return out.join('');
  }
  function refText(sk) {
    if (!sk.refs.length) return '<span class="warn">未被任何 Agent 引用</span>';
    return sk.refs.map(function (r) {
      return esc(r.fromName) + ' → ' + esc(r.toName);
    }).join('、');
  }
  /** 严重度排序键：有 bad 的排最前，其次 warn，最后正常。 */
  function sevOf(x) {
    if (x.issues.some(function (i) { return i.level === 'bad'; })) return 0;
    if (x.issues.some(function (i) { return i.level === 'warn'; })) return 1;
    return 2;
  }

  /* SECTION: r-gateway-skills
   * 技能页只有**一种**列表：卡片网格。此前是「卡片网格 + 10 列表格 + 待处理清单」三份
   * 同一批技能的不同画法 —— 同一屏把同一件事说三遍，谁也说不清哪份是准的。
   * 现在的分工：
   *   卡片 = 摘要（身份 / 状态 / 三个数字 / 一句问题），整张可点；
   *   详情抽屉 = 全部字段（触发条件、依赖、调用方式、版本、SKILL.md、引用方）；
   *   筛选 chips = 「怎么找到要处理的那条」，是过滤而不是第二份列表。
   */
  RENDERERS.gatewaySkills = function (cap, state, h) {
    var fmt = h.fmt;
    var st = Q.skillTable();
    var on = st.rows.filter(function (x) { return statusOf(x, h) === 'on'; }).length;
    var gray = st.rows.filter(function (x) { return statusOf(x, h) === 'gray'; }).length;
    var off = st.rows.filter(function (x) { return statusOf(x, h) === 'off'; }).length;
    var newOnes = state.newSkills || [];
    var filter = state.skFilter || '';

    var FILTERS = [
      { id: '', label: '全部', n: st.total, tip: '全部技能（含灰度与停用）' },
      { id: 'attention', label: '需关注', n: st.attention.length, tip: '失败率 > ' + fmt.pct1(st.lines.fail) + '、P99 > ' + (st.lines.p99 / 1000) + 's，或上线满 ' + st.lines.idleDays + ' 天无引用' },
      { id: 'zero', label: '零引用', n: st.zeroRef.length, tip: '没有任何 Agent 引用，只能由用户显式调用' },
      { id: 'user', label: '仅用户可调用', n: st.userOnly, tip: '模型不会自动触发（DSH 的 disable-model-invocation）' }
    ];
    var list = st.rows.slice().sort(function (a, b) { return sevOf(a) - sevOf(b) || b.calls - a.calls; });
    if (filter === 'attention') list = list.filter(function (x) { return x.needsAttention; });
    else if (filter === 'zero') list = list.filter(function (x) { return !x.refs.length; });
    else if (filter === 'user') list = list.filter(function (x) { return x.invocable === 'user'; });

    return (newOnes.length ? '<div class="card v15-newblock"><div class="card-h"><h3>本会话新建的技能</h3>' +
        '<span class="card-sub">仅存于当前浏览器会话，刷新后还原</span></div>' +
        newOnes.map(function (o) {
          return '<div class="gw-key-row"><b>' + esc(o.name) + '</b>' +
            '<span class="gw-key-svc">' + esc(o.purpose) + '</span>' +
            '<span class="gw-key-due">' + esc(o.invocableText) + '</span>' +
            '<button class="btn-ghost sm" data-act="sk-new-undo" data-id="' + esc(o.id) + '">撤回</button></div>';
        }).join('') + '</div>' : '') +

      '<div class="metrics">' + [
        { label: '技能总数', value: String(st.total), sub: '启用 ' + on + ' · 灰度 ' + gray + ' · 停用 ' + off,
          act: 'sk-filter', actId: '', actTitle: '看全部技能',
          definition: '技能资产表全量（含灰度与停用 —— 停用不等于消失，历史引用仍需可见）' },
        { label: '有 Agent 引用', value: String(st.referenced),
          sub: st.total ? '占 ' + fmt.pct1(st.referenced / st.total) + ' · 零引用 ' + (st.total - st.referenced) + ' 个' : '',
          alert: st.referenced < st.total, act: 'sk-filter', actId: 'zero', actTitle: '只看零引用的技能',
          definition: '在 A2A 委派边里出现过（即某个 Agent 把它交给另一个 Agent 办）的技能数' },
        { label: '今日触发', value: fmt.int(st.calls), sub: '来自 ' + st.rows.reduce(function (a, x) { return a + x.refs.length; }, 0) + ' 条 A2A 委派边',
          definition: '全部技能今日被委派的次数之和；与「网状关系」页每条边标的次数逐条对得上' },
        { label: '需关注', value: String(st.attention.length), alert: st.attention.length > 0,
          sub: '失败率 / P99 超线，或零引用', act: 'sk-filter', actId: 'attention', actTitle: '只看需关注的技能',
          definition: '失败率 > ' + fmt.pct1(st.lines.fail) + '、P99 > ' + (st.lines.p99 / 1000) + 's，或上线满 ' + st.lines.idleDays + ' 天无任何引用（阈值见 decisions.js「技能」段）' },
        { label: '仅用户可调用', value: String(st.userOnly), sub: '模型不会自动触发，需在会话里显式调用',
          act: 'sk-filter', actId: 'user', actTitle: '只看仅用户可调用的技能',
          definition: '对应 DSH 的 disable-model-invocation：这一类的唯一入口是用户在会话里显式点名' }
      ].map(h.metricCard).join('') + '</div>' +

      '<div class="card"><div class="card-h"><h3>技能清单</h3>' +
      '<span class="card-sub">点任意一张卡看技能正文、触发条件、依赖与引用方</span></div>' +
      '<div class="chips sk-filters" role="group" aria-label="技能筛选">' + FILTERS.map(function (f) {
        var onF = filter === f.id;
        return '<button class="chip link' + (onF ? ' on' : '') + '" data-act="sk-filter" data-id="' + esc(f.id) + '"' +
          ' aria-pressed="' + (onF ? 'true' : 'false') + '" data-tip="' + esc(f.tip) + '">' +
          esc(f.label) + ' <b>' + f.n + '</b></button>';
      }).join('') + '</div>' +
      (list.length ? '<div class="svc-grid">' + list.map(function (sk) {
        var stat = statusOf(sk, h);
        var bad = sk.issues.filter(function (i) { return i.level !== 'info'; });
        /* 整张卡就是入口（与本仓 Agent 列表的 .ag-card 同一做法：role=button + tabindex）。
           ⚠ 卡里**不放**任何 <button> —— 嵌套可点控件既会被解析器判为可疑结构，
             也让"点卡片"和"点卡里的按钮"互相打架。所有动作都在详情抽屉里。 */
        return '<article class="svc sk-card' + (stat === 'off' ? ' idle' : stat === 'gray' ? ' warn' : '') +
          (bad.length ? ' sk-attn' : '') + '" role="button" tabindex="0"' +
          ' data-act="sk-open" data-id="' + esc(sk.id) + '"' +
          ' aria-label="打开技能详情：' + esc(sk.name) + '">' +
          '<div class="svc-h">' + skTag(h, sk) +
          '<div class="svc-hm">' +
          '<b class="sk-name">' + esc(sk.name) + '</b>' +
          '<span class="svc-purpose" title="' + esc(sk.purpose) + '">' + esc(sk.purpose) + '</span>' +
          '</div>' +
          '<span class="svc-st"><span class="svc-dot"></span>' +
          h.pill(stat === 'gray' ? 'warn' : (stat === 'off' ? 'idle' : 'ok'), statusTextOf(stat, sk)) + '</span></div>' +
          '<div class="sk-nums">' +
          '<span><i>今日触发</i><b' + (sk.calls ? '' : ' class="muted"') + '>' + fmt.int(sk.calls) + '</b></span>' +
          '<span><i>失败率</i><b class="' + (sk.failRate != null && sk.failRate > st.lines.fail ? 'bad' : '') + '">' + (sk.failRate == null ? '—' : fmt.pct2(sk.failRate)) + '</b></span>' +
          '<span><i>P99</i><b class="' + (sk.p99 != null && sk.p99 > st.lines.p99 ? 'bad' : '') + '">' + fmt.dur(sk.p99) + '</b></span>' +
          '</div>' +
          (bad.length ? '<div class="sk-issue">' + esc(bad[0].text) + (bad.length > 1 ? '；另有 ' + (bad.length - 1) + ' 项' : '') + '</div>' : '') +
          '<div class="sk-card-ft"><span>' + (sk.refs.length ? '被 ' + sk.refs.length + ' 个 Agent 引用' : '无人引用') +
          ' · ' + (sk.deps.mcp.length + sk.deps.kb.length + (sk.deps.model ? 1 : 0)) + ' 个依赖</span>' +
          '<span class="sk-go">详情 →</span></div>' +
          '</article>';
      }).join('') + '</div>'
        : '<div class="empty"><div class="empty-ico">' + h.icon('cap', 28) + '</div>' +
          '<div class="empty-title">这个筛选下没有技能</div>' +
          '<div class="empty-sub">换一个筛选条件，或看「全部」</div>' +
          '<button class="btn-ghost" data-act="sk-filter" data-id="">看全部技能</button></div>') +
      '</div>' +

      h.metaBar({ range: null, sampleNote: null }, [
        { k: '引用与触发口径', v: '引用方、今日触发次数、失败率与 P99 全部来自 A2A 委派边（与「网状关系」页同一份数据）；技能包字段（触发条件 / 依赖 / 调用方式 / 正文）来自技能资产表' },
        { k: '需关注判定', v: '失败率 > ' + fmt.pct1(st.lines.fail) + '、P99 > ' + (st.lines.p99 / 1000) + 's，或上线满 ' + st.lines.idleDays + ' 天仍无任何引用；阈值唯一真源是 decisions.js 的「技能」段', warn: true },
        { k: '调用方式', v: '模型可触发 = 描述命中即加载；仅用户可调用 = 模型不会自动触发，只能由用户在会话里点名（DSH 的 disable-model-invocation）' },
        { k: '完整链路', v: '引用方的边、Task 状态与信任分级在「Agent 工作台 · 网状关系」页 —— 同一份 A2A 边，那边改一条，这里的触发次数跟着变' }
      ]);
  };

  /* SECTION: page-dispatch
   * 三个 Tab 共用一个能力页头：能力只有一个（gateway），路径段被详情对象 id 占着，
   * 屏内 Tab 走 query。页头按 Tab 换副标题与主按钮 —— 三个 Tab 的主按钮本来就不是同一件事。
   * Skill 页刻意**不给**时间范围选择器：引用方与今日触发来自 A2A 边（配置态事实），
   * 与时间范围无关，放一个改了没反应的控件比不放更糟。 */
  RENDERERS.gatewayPage = function (cap, state, h) {
    var page = gwPageOf(state);
    var tabs = gwTabs(h, page);
    var pageHead = UI().pageHead;
    if (page === 'llm') {
      return pageHead(h, cap, {
        desc: '模型路由：档位、计价与配额 —— 调用量与成本按模型归因',
        side: h.rangePicker(state.range), action: 'create-open'
      }) + tabs + '<div class="gw-body">' + RENDERERS.gatewayLlm(cap, state, h) + '</div>' + h.metaBar(Q.kpi(state.range).meta);
    }
    if (page === 'skill') {
      /* 主按钮在这里自己画：pageHead 的按钮文案取自 cap.action（"新增路由"），
         而这一页的动作是「登记技能」。给 pageHead 加一个 actionLabel 选项要动共享文件、
         影响全站 40 处调用，这里用 side 直接把按钮给出去，语义一样、不波及别人。 */
      return pageHead(h, cap, {
        desc: '技能包：可被 Agent 引用，也可由用户在会话里显式调用的能力单元',
        action: false,
        side: '<button class="btn-primary" data-act="sk-new">登记技能</button>'
      }) + tabs + '<div class="gw-body">' + RENDERERS.gatewaySkills(cap, state, h) + '</div>';
    }
    return pageHead(h, cap, {
      desc: '统一接入 MCP 服务与模型路由，提供限流、熔断与密钥管理',
      side: h.rangePicker(state.range) + '<button class="btn-danger" data-act="gw-degrade">全局降级</button>',
      action: 'create-open'
    }) + tabs + '<div class="gw-body">' +
      UI().sessionNewBlock(state, h, 'gateway', { title: '本会话新建的路由' }) +
      RENDERERS.gatewayMcp(cap, state, h) + '</div>' + h.metaBar(Q.kpi(state.range).meta);
  };

  /* SECTION: actions */
  ACTIONS['gw-tab'] = function (id, btn, h) {
    h.state.gwPageTab = (id === 'llm' || id === 'skill') ? id : 'mcp';
    h.state.page = 1;              /* 换页后明细行数会变，回第 1 页免得停在空页 */
    h.navigate({}, { scroll: false });
  };
  /* 工具清单抽屉：这是「这个服务能干什么」的答案，也是唯一能改工具开关的地方。
     成熟形态（对照 Claude Desktop / Codex 的 MCP 面板）里，工具是接入服务的基本信息，
     不是藏在配置页深处的附属品。 */
  ACTIONS['gw-tools'] = function (id, btn, h) {
    var s = Q.mcpById(id);
    if (!s) { h.toast('服务不存在', 'bad'); return; }
    var list = toolsOf(s, h);
    var on = list.filter(function (t) { return t.on; }).length;
    var off = list.length - on;
    global.V10UI.openSheet({
      title: '工具 · ' + s.name,
      bodyHtml:
        '<div class="v10-sheet-desc">' + esc(s.purpose) + ' · ' + esc(srcTextOf(s)) + '。' +
        '工具清单来自服务的 capability 声明（真实系统里是 MCP 的 <span class="mono">tools/list</span>）；' +
        '停用一个工具等于把这项能力从模型的可调用列表里摘掉 —— 即使模型的工具策略允许调用。</div>' +
        '<div class="tool-sum">共 ' + list.length + ' 个工具 · <b class="ok">' + on + ' 已启用</b>' +
        (off ? ' · <b class="warn">' + off + ' 已停用</b>' : '') + '</div>' +
        '<div class="chips tool-chips">' + list.map(function (t) {
          return '<button class="chip link' + (t.on ? ' on' : '') + '" data-act="tool-toggle"' +
            ' data-id="' + esc(s.id + '|' + t.name) + '" aria-pressed="' + (t.on ? 'true' : 'false') + '"' +
            ' data-tip="' + esc(t.on ? '点击停用这个工具' : '点击启用这个工具') + '">' +
            '<span class="mono">' + esc(t.name) + '</span><i class="tool-st">' + (t.on ? '启用' : '停用') + '</i></button>';
        }).join('') + '</div>' +
        (s.incident ? '<div class="bt-warn">⚠ 该服务压着未恢复事故：' + esc(s.incident.level || 'P1') + ' ' + esc(s.incident.title) +
          '<br>根因：' + esc(s.incident.rootCause || '—') + '</div>' : ''),
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>' +
        '<button class="btn-ghost" data-act="gw-open" data-id="' + esc(s.id) + '|logs">看调用日志</button>' +
        '<button class="btn-ghost" data-act="gw-open" data-id="' + esc(s.id) + '|config">打开服务详情</button>'
    });
  };
  ACTIONS['tool-toggle'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var s = Q.mcpById(p[0]);
    if (!s) { h.toast('服务不存在', 'bad'); return; }
    var cur = toolsOf(s, h).filter(function (t) { return t.name === p[1]; })[0];
    if (!cur) { h.toast('工具不存在', 'bad'); return; }
    h.state.toolOps = h.state.toolOps || {};
    h.state.toolOps[p[0] + '|' + p[1]] = cur.on ? 'off' : 'on';
    h.toast('演示环境：已' + (cur.on ? '停用' : '启用') + '「' + p[1] + '」（仅本会话）', 'ok');
    /* 先重渲染页面（卡片上的 x/y 要跟着变），再把抽屉按新状态打开 ——
       开关的状态就在抽屉里，toggle 完把抽屉关掉，人得重新找入口才发现数字变了。 */
    h.navigate({}, { scroll: false });
    ACTIONS['gw-tools'](p[0], null, h);
  };

  /* 「重连 / 操作指引 / 复制日志」：参考形态里服务坏了就地给修的动作。
     三个都做真事 —— 重连记录在本会话、指引按事故记录生成、日志真的复制到剪贴板。 */
  ACTIONS['svc-reconnect'] = function (id, btn, h) {
    var s = Q.mcpById(id);
    if (!s) { h.toast('服务不存在', 'bad'); return; }
    h.state.svcReconnects = h.state.svcReconnects || {};
    h.state.svcReconnects[s.id] = true;
    h.toast('已向 ' + s.name + ' 发起重连（演示环境：只记录在本会话，不执行真实连接）', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['svc-guide'] = function (id, btn, h) {
    var s = Q.mcpById(id);
    if (!s) { h.toast('服务不存在', 'bad'); return; }
    var inc = s.incident;
    var errLine = DEC('网关', '熔断_错误率', 0.5);
    var halfOk = DEC('网关', '熔断_半开成功数', 3);
    var deps = Q.skillTable().rows.filter(function (x) {
      return (x.deps.mcp || []).some(function (m) { return m.id === s.id; });
    });
    var steps = [
      '先看影响面：' + (deps.length ? '有 ' + deps.length + ' 条技能依赖它（' + deps.map(function (x) { return x.name; }).join('、') + '）' : '当前没有技能依赖它') + '。',
      '到「可观测与评估 · 事故处理台」认领这条事故' + (inc ? '（' + esc(inc.level || 'P1') + ' · ' + esc(inc.title) + '，尚未恢复）' : '') + '，处理期间它不许被关闭。',
      '核对根因指向的变更：' + (inc && inc.rootCause ? esc(inc.rootCause) : '（事故记录未填根因，先补）'),
      '需要立即止血：在服务的「限流」页配熔断 —— 错误率阈值 ' + (errLine * 100) + '%，半开态连续 ' + halfOk + ' 次成功转闭合（阈值取自 decisions.js）。',
      '降级链：' + (s.fallback ? '切到 ' + esc(s.fallback) + '，功能降级但调用不中断。' : '该服务没有配 fallback 链，止血只能靠熔断/限流。'),
      '恢复后回到事故台标记「已恢复」并写处置说明 —— 事故记录不写恢复时间，下次还会被当成进行中。'
    ];
    global.V10UI.openSheet({
      title: '操作指引 · ' + s.name,
      bodyHtml:
        '<div class="v10-sheet-desc">按当前事故记录与服务依赖生成，不是通用话术：' +
        '改动前的下一步都指向本系统里真实存在的位置。</div>' +
        '<ol class="guide-list">' + steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
        '<div class="bt-note">当前状态：错误率 ' + h.fmt.pct2(s.errRate) + ' · P99 ' + h.fmt.dur(s.p99) +
        ' · ' + toolsOnCount(s, h) + '/' + s.toolsTotal + ' 个工具已启用 · ' + esc(srcTextOf(s)) + '</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>' +
        '<button class="btn-ghost" data-act="svc-copy-log" data-id="' + esc(s.id) + '">复制日志</button>' +
        '<button class="btn-primary" data-act="gw-open" data-id="' + esc(s.id) + '|traffic">去配熔断</button>'
    });
  };
  /** 该服务最近的错误日志（演示数据，但用的是登记过的错误码与真实时间轴口径） */
  function svcLogText(s) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var d = S.NOW, day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    var codes = ((s.incident && s.incident.affect && s.incident.affect.errorCodes) || ['E_TOOL_FAIL']);
    var lines = [];
    for (var i = 0; i < 8; i++) {
      var hh = 10 + Math.floor(i / 4), mm = (i % 4) * 7 + 3, ss = (i * 13) % 60;
      var code = codes[i % codes.length];
      var meta = (S.ERROR_CODES || []).filter(function (x) { return x.id === code; })[0] || { name: code, http: 500 };
      lines.push(day + ' ' + pad(hh) + ':' + pad(mm) + ':' + pad(ss) + '.' + (100 + i * 37) +
        ' ERROR ' + s.name + '  ' + code + ' (' + meta.name + ' / HTTP ' + meta.http + ')' +
        '  caller=' + (i % 3 === 0 ? '未标记来源' : 'ag-cs-refund') + '  p99=' + (s.p99 + i * 41) + 'ms');
    }
    lines.push('# 取最近 ' + lines.length + ' 行（脱敏：不含入参正文与个人信息）；数据集 dataset-v1');
    return lines.join('\n');
  }
  ACTIONS['svc-copy-log'] = function (id, btn, h) {
    var s = Q.mcpById(id);
    if (!s) { h.toast('服务不存在', 'bad'); return; }
    var text = svcLogText(s);
    var fallback = function () {
      /* 剪贴板拿不到（无权限 / 非安全上下文）时不能假装复制成功 —— 把日志摊开让人自己选 */
      global.V10UI.openSheet({
        title: '错误日志 · ' + s.name,
        wide: true,
        bodyHtml: '<div class="v10-sheet-desc">浏览器没给剪贴板权限，日志摊在这里，全选复制即可。</div>' +
          '<pre class="sk-md" id="svc-log-text">' + esc(text) + '</pre>',
        onOpen: function (el) {
          try {
            var pre = el.querySelector('#svc-log-text');
            if (pre && global.getSelection) {
              var r = global.document.createRange(); r.selectNodeContents(pre);
              var sel = global.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            }
          } catch (e) { /* 选不中也只是少一步便利 */ }
        },
        footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>'
      });
      h.toast('已把日志摊开，可直接复制', 'info');
    };
    try {
      var cb = global.navigator && global.navigator.clipboard;
      if (cb && cb.writeText) {
        cb.writeText(text).then(function () {
          h.toast('已复制 ' + text.split('\n').length + ' 行日志到剪贴板', 'ok');
        }, fallback);
        return;
      }
    } catch (e) { /* 落到下面的兜底 */ }
    fallback();
  };

  /* 技能筛选：与指标卡同一个入口 —— 「需关注 6」那张卡点下去，看的就该是那 6 条。
     再点同一个条件即取消（回到全部），免得筛完找不到回去的路。
     筛选状态不进 URL：它是本屏视图状态，不是可分享的对象（与用户运营页的反馈筛选同一口径）。 */
  ACTIONS['sk-filter'] = function (id, btn, h) {
    var want = id || '';
    h.state.skFilter = (h.state.skFilter === want) ? '' : want;
    h.navigate({}, { scroll: false });
  };
  /* 从 MCP 服务反查依赖它的技能：这是「这个服务要变更，谁会受影响」的直接答案，
     而答案本来就在技能表的 deps 里 —— 不新造一层依赖数据，就地过滤。 */
  ACTIONS['gw-dep-skill'] = function (id, btn, h) {
    var st = Q.skillTable();
    var hit = st.rows.filter(function (x) {
      return (x.deps.mcp || []).some(function (m) { return m.id === id; });
    });
    var svc = Q.mcpById(id);
    if (!hit.length) { h.toast('没有技能依赖 ' + (svc ? svc.name : id), 'info'); return; }
    global.V10UI.openSheet({
      title: '依赖 ' + (svc ? svc.name : id) + ' 的技能（' + hit.length + '）',
      bodyHtml: '<div class="v10-sheet-desc">这个服务一旦变更、熔断或轮换密钥，下面这些技能都会受影响。' +
        '依赖关系取自技能资产表的 deps 字段，不是现推的。</div>' +
        hit.map(function (x) {
          return '<div class="gw-key-row"><b>' + esc(x.name) + '</b>' +
            '<span class="gw-key-svc">' + esc(x.purpose) + '</span>' +
            '<span class="gw-key-due">' + (x.calls ? '今日 ' + x.calls + ' 次' : '今日 0 次') + '</span>' +
            '<button class="btn-ghost sm" data-act="sk-open" data-id="' + esc(x.id) + '">看正文</button></div>';
        }).join('')
    });
  };
  /* 技能正文抽屉：SKILL.md 正文 + 元信息 + 依赖 + 引用方 + 脚本。
     只读 —— 改正文是版本化写操作，不该在一个抽屉里悄悄完成。 */
  ACTIONS['sk-open'] = function (id, btn, h) {
    var st = Q.skillTable();
    var sk = st.rows.filter(function (x) { return x.id === id; })[0];
    if (!sk) { h.toast('技能不存在', 'bad'); return; }
    var stat = statusOf(sk, h);
    var rows = [
      ['版本', sk.version],
      ['调用方式', sk.invocableText + (sk.invocable === 'user' ? '（模型不会自动加载）' : '')],
      ['最近更新', Math.abs(sk.updatedDay) + ' 天前'],
      ['状态', statusTextOf(stat, sk)]
    ];
    var refHtml = sk.refs.length ? sk.refs.map(function (r) {
      return '<div class="sk-ref-row"><b>' + esc(r.fromName) + ' → ' + esc(r.toName) + '</b>' +
        '<span class="sk-ref-meta">今日 ' + r.calls + ' 次 · 失败率 ' + (r.fail * 100).toFixed(1) + '% · P99 ' + (r.p99 / 1000).toFixed(2) + 's</span>' +
        '<span class="sk-ref-meta">Task ' + esc(TASK_TEXT[r.task] || r.task) + ' · ' + (r.trust === 'claimed' ? '身份为声称级（跨节点）' : '身份已验证') + '</span></div>';
    }).join('') : '<div class="bt-note">没有任何 Agent 引用它 —— 只能由用户在会话里显式调用。</div>';
    global.V10UI.openSheet({
      wide: true,
      title: '技能正文 · ' + sk.name,
      bodyHtml:
        '<div class="sk-md-h"><span class="svc-ico t-' + esc(sk.tone || 'blue') + '">' + h.icon(sk.icon || 'cap', 15) + '</span>' +
        '<div><b>' + esc(sk.name) + '</b><div class="sk-md-sub">' + esc(sk.purpose) + '</div></div></div>' +
        '<div class="sk-kv-grid">' + rows.map(function (r) {
          return '<div class="sk-kv"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
        }).join('') + '</div>' +
        '<div class="sk-md-sec"><h4>触发条件</h4><div class="sk-md-txt">' + esc(sk.trigger) + '</div></div>' +
        '<div class="sk-md-sec"><h4>依赖</h4><div class="chips">' + depChips(sk, h) + '</div>' +
        (sk.scripts.length ? '<div class="sk-md-sub" style="margin-top:8px">技能包内脚本：<span class="mono">' + esc(sk.scripts.join('、')) + '</span></div>' : '') +
        '</div>' +
        '<div class="sk-md-sec"><h4>SKILL.md</h4><pre class="sk-md">' + esc(sk.body) + '</pre></div>' +
        '<div class="sk-md-sec"><h4>引用方（' + sk.refs.length + '）</h4>' + refHtml + '</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>' +
        (sk.refs.length ? '<button class="btn-ghost" data-act="sk-refs" data-id="' + esc(sk.id) + '">在网状关系页看链路</button>' : '') +
        '<button class="btn-' + (stat === 'off' ? 'primary' : 'danger') + '" data-act="sk-toggle" data-id="' + esc(sk.id) + '">' +
        (stat === 'off' ? '启用技能' : '停用技能') + '</button>'
    });
  };
  /* 引用方：直接切到「网状关系」页 —— 那边有完整的链路、口径开关与人工改边能力。
     这里不复制一份关系图：同一份 A2A 边在两个地方画两遍，迟早长得不一样。 */
  ACTIONS['sk-refs'] = function (id, btn, h) {
    var st = Q.skillTable();
    var sk = st.rows.filter(function (x) { return x.id === id; })[0];
    if (!sk || !sk.refs.length) { h.toast('这个技能没有任何 Agent 引用', 'info'); return; }
    h.navigate({ cap: 'agent-wb', agentPageTab: 'net', agentId: null, objId: null, tab: null, traceId: null });
    h.toast('已切到「网状关系」：' + sk.name + ' 的委派边在图上标着技能名', 'ok');
  };
  /* 停用 / 启用。技能是配置态资产，停用会让引用它的 Agent 在下一轮委派时找不到技能 ——
     所以要确认、要写影响面（哪些 Agent 依赖它），并且只写本会话状态（演示环境不落库）。 */
  ACTIONS['sk-toggle'] = function (id, btn, h) {
    var st = Q.skillTable();
    var sk = st.rows.filter(function (x) { return x.id === id; })[0];
    if (!sk) { h.toast('技能不存在', 'bad'); return; }
    var cur = statusOf(sk, h);
    var turnOff = cur !== 'off';
    h.dangerConfirm(h, {
      title: turnOff ? '停用技能' : '启用技能',
      desc: (turnOff ? '停用' : '启用') + '「' + sk.name + '」？',
      tone: turnOff ? 'danger' : 'warn', perm: 'gateway:skill:toggle',
      impacts: [
        { label: '调用方式', value: sk.invocableText },
        { label: '引用方', value: sk.refs.length ? sk.refs.map(function (r) { return r.fromName + ' → ' + r.toName; }).join('；') : '无（仅用户可调用）' },
        { label: '影响', value: turnOff ? '引用它的 Agent 下一轮委派将找不到该技能；' + sk.invocableText.replace('模型可触发', '模型侧将无法自动加载') : '重新对模型与用户开放', tone: turnOff ? 'danger' : '' },
        { label: '可回滚', value: '是 —— 再次点击即可恢复' }
      ],
      confirmText: '确认' + (turnOff ? '停用' : '启用'),
      onConfirm: function () {
        h.state.skillOps = h.state.skillOps || {};
        h.state.skillOps[sk.id] = turnOff ? 'off' : 'on';
        h.toast('演示环境：已' + (turnOff ? '停用' : '启用') + '「' + sk.name + '」（仅本会话）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* 登记技能：填完落进本会话的「新建」区，刷新还原。
     技能包不是一行标题，所以字段按技能包的最小可用集给：名称 / 用途 / 触发条件 / 调用方式。 */
  ACTIONS['sk-new'] = function (id, btn, h) {
    /* 输入控件用自包含样式（本仓 v26 侧边栏同一写法）：不引别的文件注入的类，
       否则那张样式表改一次、这里就跟着塌一次。 */
    var inp = 'style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:#fff"';
    global.V10UI.openSheet({
      title: '登记技能',
      bodyHtml:
        '<div class="v10-sheet-desc">技能是配置态资产：登记后还要挂到 Agent 的编排里，才会被委派调用。' +
        '这里先把技能包本身登记下来（仅本会话，刷新后还原）。</div>' +
        '<label class="sub-h" for="sk-n-name">技能名称</label>' +
        '<input id="sk-n-name" ' + inp + ' placeholder="例如：合同条款初审" maxlength="24">' +
        '<label class="sub-h" for="sk-n-purpose">一句话用途（会显示在清单卡片上）</label>' +
        '<input id="sk-n-purpose" ' + inp + ' placeholder="例如：标出合同里的风险条款并给出法规依据">' +
        '<label class="sub-h" for="sk-n-trigger">触发条件（什么时候该用它）</label>' +
        '<input id="sk-n-trigger" ' + inp + ' placeholder="例如：合同文本进入初审">' +
        '<label class="sub-h" for="sk-n-inv">调用方式</label>' +
        '<select id="sk-n-inv" ' + inp + '>' +
        '<option value="both">模型 + 用户（模型命中描述即加载）</option>' +
        '<option value="model">仅模型可触发</option>' +
        '<option value="user">仅用户可调用（模型不会自动加载）</option>' +
        '</select>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn-primary" data-act="sk-new-ok">登记</button>'
    });
  };
  ACTIONS['sk-new-ok'] = function (id, btn, h) {
    var val = function (sel) { var el = global.document.getElementById(sel); return el ? String(el.value || '').trim() : ''; };
    var name = val('sk-n-name'), purpose = val('sk-n-purpose'), trigger = val('sk-n-trigger');
    if (!name) { h.toast('技能名称必填', 'warn'); return; }
    if (S.SKILLS.some(function (x) { return x.name === name; })) { h.toast('已存在同名技能：' + name, 'warn'); return; }
    if (!purpose) { h.toast('一句话用途必填 —— 模型就是靠它判断该不该加载这个技能', 'warn'); return; }
    var inv = val('sk-n-inv') || 'both';
    if (!trigger) { h.toast('触发条件必填 —— 没有它，模型与用户都不知道什么时候该用', 'warn'); return; }
    var invText = { model: '模型可触发', user: '仅用户可调用', both: '模型 + 用户' }[inv];
    h.state.newSkills = h.state.newSkills || [];
    h.state.newSkills.push({
      id: 'sk-new-' + Date.now().toString(36), name: name, purpose: purpose, trigger: trigger,
      invocable: inv, invocableText: invText
    });
    global.V10UI.closeSheet();
    h.toast('已登记「' + name + '」（仅本会话，刷新后还原）', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['sk-new-undo'] = function (id, btn, h) {
    h.state.newSkills = (h.state.newSkills || []).filter(function (x) { return x.id !== id; });
    h.toast('已撤回该条登记', 'info');
    h.navigate({}, { scroll: false });
  };

  /* 密钥的轮换 / 吊销。密钥是安全资产，点了必须有后果、有确认、有影响面 ——
     这条动作原先在 renderers2.js，与它的 GW_KEYS 一起搬来这里：本文件拥有整页，
     密钥清单也在这里，两处分开必然漂移（改名只改了渲染那边，动作就查不到密钥了）。 */
  ACTIONS['gw-key'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var k = GW_KEYS.filter(function (x) { return x.name === p[0]; })[0];
    if (!k) { h.toast('密钥不存在', 'bad'); return; }
    var revoke = p[1] === 'revoke';
    var win = keyWindow();
    var isLlm = k.kind === 'llm';
    /* 影响面按密钥类型说清楚：「模型密钥吊销」断的是模型调用，与工具密钥的影响面不同 */
    h.dangerConfirm(h, {
      title: revoke ? '吊销密钥' : '轮换密钥',
      desc: (revoke ? '吊销' : '轮换') + '「' + k.name + '」？',
      tone: revoke ? 'danger' : 'warn', perm: 'gateway:key:' + (revoke ? 'revoke' : 'rotate'),
      impacts: [
        { label: '关联服务', value: k.svc + (isLlm ? '（模型路由）' : '（MCP 工具）') },
        { label: '到期', value: k.days + ' 天后' + (k.days < win ? '　已进入轮换窗口' : '') },
        { label: '影响', value: revoke
            ? (isLlm ? '立即失效：走这条模型路由的生成请求会中断，并通知所有引用方' : '立即失效并通知所有引用方，工具调用会中断')
            : '新旧密钥并行，调用方需在并行期内切换', tone: revoke ? 'danger' : '' },
        { label: '可回滚', value: revoke ? '否 —— 吊销不可撤销，只能重新签发' : '是 —— 并行期内可回退', tone: revoke ? 'danger' : '' }
      ],
      confirmText: '确认' + (revoke ? '吊销' : '轮换'),
      onConfirm: function () {
        h.state.keyOps = h.state.keyOps || {};
        h.state.keyOps[k.name] = revoke ? 'revoked' : 'rotated';
        h.toast('演示环境：已' + (revoke ? '吊销' : '轮换') + '「' + k.name + '」（仅本会话）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* SECTION: exports
     挂到 UI 上：Tab 条与「当前是哪一页」的判定。本文件自己用得到，也让别处
     （详情页返回、面包屑、将来的深链）读同一份判断 —— 页面有几种 Tab 只在这里定义一次。 */
  global.UI = global.UI || {};
  global.UI.gwTabs = gwTabs;
  global.UI.gwPageOf = gwPageOf;
})(window);
