/* SECTION: v33-assets（2026-10-15）
 * 平台域「能力与权限」一页 —— 把三件事并成一页（业主定的信息架构）：
 *   ① 业主清单第 ⑤ 项：MCP / 技能 / 沙盒等做成卡片墙放在一个页面；
 *   ② 业主清单第 ⑥ 项：权限类控件要能直接编辑，不做只读陈列；
 *   ③ **整合**：业主原话「把旧的页面整合，换成 5、6，说实话像 MCP 和沙盒本身就是权限的一部分」。
 *
 * 所以这一页收拢了原来各自占一个侧栏项的「MCP / LLM 网关」与「沙盒隔离」：
 *   · 它们不再各占侧栏一项（cap 上标 menu:false），入口统一到这里；
 *   · 但**内容一行都没丢**：连接器分页嵌 gatewayMcp（服务健康墙 + 密钥）、
 *     LLM 路由分页嵌 gatewayLlm、技能分页嵌 gatewaySkills、沙盒分页嵌 sandboxPage ——
 *     嵌的是**原渲染器本体**（同一份实现），没有第二份抄写；
 *   · 原来指向这两个能力的跳转（goto-cap gateway / sandbox）由 app.js 统一改写到本页对应分页，
 *     老书签与老链接都不会撞进"页面不存在"。
 *
 * 为什么 MCP / 沙盒该和权限放一页（业主的判断，我认同）：
 *   「接入哪个服务」「Agent 能用哪些工具」「代码在什么隔离环境里跑、能不能出网」
 *   本质都是**授权决策**，只是对象不同（服务 / 工具 / 执行环境）。
 *   最后一张分页「权限策略」把这三类权限点连角色一起摊开成矩阵 ——
 *   这一页因此不只是资产目录，它也是"谁能动什么"的总账。
 *
 * ⚠ 取数纪律（一条都不新造）：
 *   连接器 → QUERY.mcpHealth()；技能 → QUERY.skillTable(range)；
 *   知识库/沙盒 → APP_DATA.getAssetTables().kb / .sandbox；
 *   权限点与角色 → DATA_SEED.PERM_POINTS + rolePerms()（与账号与权限页同一份）。
 */
(function (global) {
  'use strict';

  var APP = global.APP_DATA, Q = global.QUERY;
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  function UI() { return global.V10UI || {}; }

  /* 分页是**两层的**（业主：「分页下面再分页」「mcp、技能、沙盒等可以放在一页管理」）：
     一级 = 资产大类（连接器 / 技能 / 知识库 / 沙盒 / 权限策略）——"管哪一类"；
     二级 = 该大类下的管理视图（原网关页的 MCP 健康墙与 LLM 路由、原沙盒页的明细、权限矩阵的三组）——
            "在这一类里看什么"。
     两级都进 URL：?at=mcp&as=health。「能力与权限 › 沙盒 › 实例与执行明细」是一条可直达、可分享的链接。
     二级只有一项时**不渲染第二行**（一行只有一个按钮的页签栏是噪音）。 */
  var TABS = [
    {
      id: 'mcp', label: '连接器 (MCP)', icon: 'chip',
      subs: [
        { id: 'cards', label: '卡片总览' },
        { id: 'health', label: '服务健康与密钥' },
        { id: 'llm', label: 'LLM 路由' }
      ]
    },
    {
      id: 'skill', label: '技能', icon: 'cap',
      subs: [
        { id: 'cards', label: '卡片总览' },
        { id: 'table', label: '技能清单' }
      ]
    },
    { id: 'kb', label: '知识库', icon: 'book', subs: [{ id: 'cards', label: '卡片总览' }] },
    {
      id: 'sandbox', label: '沙盒', icon: 'flask',
      subs: [
        { id: 'cards', label: '卡片总览' },
        { id: 'detail', label: '实例与执行明细' }
      ]
    },
    {
      id: 'policy', label: '权限策略', icon: 'shield',
      subs: [
        { id: 'tools', label: '工具授权' },
        { id: 'gateway', label: '网关与密钥' },
        { id: 'sandbox', label: '沙盒隔离' }
      ]
    }
  ];
  var TONE = { blue: 'blue', purple: 'purple', green: 'green', amber: 'amber', red: 'red', gray: 'gray' };

  function defOf(state) {
    var t = state && state.assetTab;
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === t) return TABS[i];
    return TABS[0];
  }
  function tabOf(state) { return defOf(state).id; }
  /** 二级分页：给了无效 id 就退回该一级的第一项（不静默渲染空白） */
  function subOf(state) {
    var d = defOf(state), want = state && state.assetSub;
    for (var i = 0; i < d.subs.length; i++) if (d.subs[i].id === want) return d.subs[i].id;
    return d.subs[0].id;
  }
  function assets() { try { return APP.getAssetTables() || {}; } catch (e) { return {}; } }
  function rowsOf(t) { return (t && t.rows) || []; }
  function capOf(id) { return (APP.caps || []).filter(function (c) { return c.id === id; })[0] || {}; }

  /* 「谁在用」—— 从这个 Agent 的拓扑反查哪些 Agent 用到了这个服务。
     方向与网关页的 agentUsedSvcs 一致（FACTS.AGENT_TOPO → FACTS.TOPO 的 mcp 节点），
     再并上会话里刚接入的那些（h.state.assetBinds），否则刚接完「在用数」不变，像没生效。 */
  function agentsUsingMcpIds(mcpId, h) {
    var F = global.FACTS || {}, Sd = global.DATA_SEED || {};
    var TOPO = F.TOPO || {}, MAP = F.AGENT_TOPO || {};
    var seen = {}, out = [];
    (Sd.AGENTS || []).forEach(function (a) {
      if (a.retiredAt || seen[a.id]) return;
      var topo = TOPO[MAP[a.id]] || TOPO['qa-rag'] || [];
      for (var i = 0; i < topo.length; i++) {
        if (topo[i] && topo[i].mcp === mcpId) { seen[a.id] = 1; out.push(a.id); return; }
      }
    });
    ((h && h.state && h.state.assetBinds && h.state.assetBinds[mcpId]) || []).forEach(function (id) {
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }
  function agentsUsingMcp(mcpId, h) { return agentsUsingMcpIds(mcpId, h).length; }

  /* ── 四类资产 → 统一卡片视图模型（四类的差异只在这四个函数里收口）──────────── */
  function mcpCards(h) {
    var rows = [];
    try { rows = Q.mcpHealth() || []; } catch (e) { rows = []; }
    return rows.map(function (r) {
      return {
        id: r.id, kind: 'mcp',
        name: r.name, sub: r.purpose,
        icon: r.icon || 'chip', tone: TONE[r.tone] || 'blue',
        note: r.kind + (r.rw === 'read' ? ' · 只读' : ' · 读写'),
        state: r.incident ? { k: 'warn', t: '需关注' } : { k: 'ok', t: r.statusText || '正常' },
        metas: [
          ['工具', (r.toolsOn != null ? r.toolsOn : (r.tools || []).length) + '/' + (r.toolsTotal != null ? r.toolsTotal : (r.tools || []).length)],
          ['QPS', (r.qps != null ? r.qps : '—') + '/' + (r.qpsCap != null ? r.qpsCap : '—')],
          ['错误率', (r.errRate != null ? (r.errRate * 100).toFixed(2) + '%' : '—')],
          ['P99', r.p99 != null ? r.p99 + 'ms' : '—']
        ],
        /* ⚠ 字段实测：usage 是**配额使用率**（0~1 小数）不是调用次数；keys 是关联密钥**把数**。
           2026-10-19：脚注改成「谁在用」—— 配额使用率与上面的 QPS 当前/上限是同一个比值，
           再写一遍是重复；密钥把数在详情里还有，先让位给「几个 Agent 在用」（百炼的同款信息）。 */
        refs: (function () {
          var n = agentsUsingMcp(r.id, h);
          return n ? n + ' 个 Agent 在用' : '暂无 Agent 在用';
        })(),
        alert: !!r.incident,
        deep: { label: '本页 · 服务健康墙', act: 'assets-tab', id: 'mcp' },
        raw: r
      };
    });
  }
  function skillCards(state, h) {
    var res = null;
    try { res = Q.skillTable(state.range || '24h', {}); } catch (e) { res = null; }
    var rows = (res && res.rows) || [];
    /* ⚠ 字段实测：引用方在 **refs[]**（A2A 引用边），不是行上的 referenced（那是表级汇总）。
       行上另有 failRate / p99 / issues[] / needsAttention —— 这些才是"该不该管"的信号。 */
    var seen = {}, merged = [];
    rows.concat((res && res.zeroRef) || []).forEach(function (r0) {
      if (!r0 || seen[r0.id]) return;   /* zeroRef 与 rows 有重叠，直接 concat 会出现两张同 id 的卡 */
      seen[r0.id] = 1;
      merged.push(r0);
    });
    return merged.map(function (s) {
      var refs = s.refs || [];
      var issues = s.issues || [];
      return {
        id: s.id, kind: 'skill',
        name: s.name, sub: s.purpose,
        icon: s.icon || 'cap', tone: TONE[s.tone] || 'blue',
        note: '技能 · ' + (s.version || '—') + ' · ' + (s.invocableText || '—'),
        state: { k: s.status === 'on' ? 'ok' : 'idle', t: s.statusText || (s.status === 'on' ? '启用中' : '已停用') },
        metas: [
          ['调用', s.calls != null ? h.fmt.int(s.calls) : '—'],
          ['引用方', refs.length ? refs.length + ' 条引用' : '无'],
          ['失败率', s.failRate != null ? h.fmt.pct2(s.failRate) : '—'],
          ['P99', s.p99 != null ? h.fmt.dur(s.p99) : '—']
        ],
        refs: refs.length
          ? '引用链：' + refs.slice(0, 2).map(function (r) { return r.fromName + ' → ' + r.toName; }).join('；') +
            (refs.length > 2 ? ' 等 ' + refs.length + ' 条' : '')
          : (issues.length ? issues[0].text : '暂无 Agent 引用'),
        alert: !!s.needsAttention || !!issues.filter(function (x) { return x.level === 'bad'; }).length,
        deep: { label: '本页 · 技能清单', act: 'assets-tab', id: 'skill' },
        raw: s
      };
    });
  }
  function kbCards(h) {
    return rowsOf(assets().kb).map(function (k) {
      /* ⚠ 字段实测：refAgents 是**数字**；lastSyncText 也是数字（-2），配合 fmt.rel 读作"2 天前" ——
         与知识库详情页同一套读法。 */
      var refN = k.refAgents || 0;
      return {
        id: k.id, kind: 'kb',
        name: k.name, sub: (k.docs != null ? k.docs + ' 篇文档 · ' + (k.chunks != null ? k.chunks + ' 个切片' : '') : ''),
        icon: 'book', tone: 'green',
        note: '知识库 · ' + (k.embed || '—'),
        state: { k: k.status === 'on' ? 'ok' : 'idle', t: k.statusText || '—' },
        metas: [
          ['文档', k.docs != null ? k.docs : '—'],
          ['切片', k.chunks != null ? k.chunks : '—'],
          ['命中', k.hits != null ? k.hits : '—'],
          ['零命中率', k.zeroRate != null ? (k.zeroRate * 100).toFixed(1) + '%' : '—']
        ],
        refs: '被 ' + refN + ' 个 Agent 引用 · 最近同步 ' + (h.fmt && h.fmt.rel ? h.fmt.rel(k.lastSyncText) : k.lastSyncText),
        alert: false,
        deep: { label: '企业知识库', act: 'goto-cap', id: 'knowledge' },
        raw: k
      };
    });
  }
  function sandboxCards(h) {
    return rowsOf(assets().sandbox).map(function (s) {
      return {
        id: s.id, kind: 'sandbox',
        /* 名字用中文标签，机器令牌只做副行（v10-detail-sandbox 里踩过的坑） */
        name: s.kindText || s.name, sub: s.name + ' · ' + (s.image || '—'),
        icon: s.blocked ? 'shield' : 'flask', tone: s.blocked ? 'amber' : 'purple',
        note: '沙盒 · ' + (s.reuseModeText || s.reuseMode || '—') + ' · ' + (s.sLevel || ''),
        state: { k: s.blocked ? 'warn' : (s.status === 'ok' ? 'ok' : 'idle'), t: s.statusText || (s.blocked ? '已被拦' : '—') },
        metas: [
          ['规格', s.spec || '—'],
          ['并发', s.concurrency || '—'],
          ['网络', s.netPolicyText || '—'],
          ['到期', s.expiresInDays != null ? s.expiresInDays + ' 天后' : '—']
        ],
        /* ⚠ agentNames 是**字符串**（"知识问答 · 文档摘要"），不是数组 —— 按数组 join 会抛错 */
        refs: (s.agentNames ? '使用方：' + String(s.agentNames) : '') + (s.biz ? ' · ' + s.biz : ''),
        /* ⚠ 这里原写 !!s.blocked —— 但 blocked 是**24h 拦截次数**（7 / 23 / 0 / 3），不是布尔标记，
           结果四张卡全被判成告警。改成跟 status 走（warn 才是要盯的）。 */
        alert: s.status === 'warn',
        deep: { label: '本页 · 沙盒隔离', act: 'assets-tab', id: 'sandbox' },
        raw: s
      };
    });
  }
  function cardsFor(kind, state, h) {
    if (kind === 'skill') return skillCards(state, h);
    if (kind === 'kb') return kbCards(h);
    if (kind === 'sandbox') return sandboxCards(h);
    if (kind === 'mcp') return mcpCards(h);
    return [];
  }

  /* 2026-10-19 业主：「筛选」这排 chip 不要（全部/需关注/未启用/未被引用）。
     随之收掉的还有 assetFilter 状态与 matches()/orphan() —— 没有入口的筛选逻辑留着，
     下次改的人会以为它还在生效。 */

  /* ── 卡片 ──────────────────────────────────────────────────────────────── */
  /* ── 卡片（v36：形制学自能力画廊，**长相与动作都是我们自己的**）──────────────
     形制保留那三件事：图标 + 名称 + 一句话 + 关键数字 + 一个动作。
     长相全部换回本仓的设计语言，一条都不借腾讯云那版：
       · 浅底 + 1px 发丝线（不用深色卡、不堆投影）；
       · 状态只留文字（没有圆点、没有左色条）：需关注那行变红，其余走弱灰；
       · 名称下的 ID 用等宽体（mcp://crm/query 这类身份标识在本仓一律 mono）；
       · 关键数字用**发丝线分格**的 2×2，标签 11px、数值等宽数字（tabular-nums）——
         这是本仓读数的既定写法（KPI 卡、明细表都这样），扫一列数字时不会跳。
     ⚠ 动作语义（业主 2026-10-15 纠正）：**不用"＋"**。
       参考页那套是"能力商店"——加号 = 从市场里装别人做好的东西；
       我们的资产是**自己建的**（平台自建 / 自研技能 / 自建知识库 / 自建沙盒），
       所以这里给的是**有文字的按钮**：「接入」（挂到某个 Agent 上）＋「详情」。
       加号那种"轻点即装"的语义在我们这儿是错的，会让人以为是装第三方。 */
  function cardHtml(c, h) {
    var isId = /^[a-z]+:\/\//.test(c.name) || /^[a-z]+-/.test(c.name);
    /* 2026-10-19 业主：告警卡不要左侧色条、状态前不要圆点，需要关注时**这行字变红**就够了。
       所以状态只留文字：正常/未启用走弱灰，需关注走红（.cw-state.is-warn）。 */
    return '<div class="cwall-card">' +
      '<button type="button" class="cw-main" data-act="assets-open" data-id="' + h.esc(c.id) + '"' +
      ' aria-label="' + h.esc(c.name + ' · ' + (c.sub || '') + ' · 打开详情') + '">' +
      '<span class="cw-hd">' +
      '<span class="cw-ico" data-tone="' + h.esc(c.tone) + '">' + h.icon(c.icon, 18) + '</span>' +
      '<span class="cw-title">' +
      '<b' + (isId ? ' class="mono"' : '') + '>' + h.esc(c.name) + '</b>' +
      '<em>' + h.esc(c.note) + '</em>' +
      '</span>' +
      '</span>' +
      '<span class="cw-desc">' + h.esc(c.sub || '') + '</span>' +
      '<span class="cw-metas">' + c.metas.map(function (m) {
        return '<span class="cw-meta"><i>' + h.esc(m[0]) + '</i><b>' + h.esc(String(m[1])) + '</b></span>';
      }).join('') + '</span>' +
      '</button>' +
      '<span class="cw-foot">' +
      /* 红色只跟**状态词**走，不跟 c.state.k / c.alert 走：
         沙盒那边 blocked=true 时 k='warn'，但状态词写的是「运行中」（statusText 覆盖了），
         按 k 染红会出现「运行中」是红字这种读不懂的组合。 */
      '<span class="cw-state' + (/(需关注|已被拦)/.test(c.state.t) ? ' is-warn' : '') + '">' + h.esc(c.state.t) + '</span>' +
      (c.refs ? '<span class="cw-refs">' + h.esc(c.refs) + '</span>' : '<span class="cw-refs"></span>') +
      /* 动作是**两颗有文字的控件**（不是图标按钮）：主＝接入到 Agent，次＝看详情。
         整卡也可点（等同详情），三处入口同一个抽屉，不出现第二种行为。 */
      '<button type="button" class="btn-ghost sm cw-join" data-act="assets-open" data-id="' + h.esc(c.id) + '"' +
      ' title="接入到某个 Agent（在详情里选目标，写操作 + 留审计）">接入</button>' +
      '<span class="cw-open">详情<i aria-hidden="true">→</i></span>' +
      '</span>' +
      '</div>';
  }

  /* ── 详情抽屉（V10UI.openSheet 的选项名是 bodyHtml / footHtml：写错不报错，只得到空抽屉）── */
  function openCardSheet(card, h) {
    if (!UI().openSheet) { h.toast('弹层组件未加载', 'bad'); return; }
    var raw = card.raw || {};
    var defs = Object.keys(raw).filter(function (k) {
      return raw[k] != null && k !== 'raw' && typeof raw[k] !== 'object' && String(raw[k]) !== '';
    }).slice(0, 14);
    var agents = (global.DATA_SEED && global.DATA_SEED.AGENTS) || [];
    var binds = (h.state.assetBinds || {})[card.id] || [];
    var offMap = h.state.assetToolOff || {};
    var tools = (card.kind === 'mcp' && raw.tools && raw.tools.length) ? raw.tools : null;
    var SRC = { local: '平台自建', plugin: '插件自带', external: '外部对接' };
    /* v40：抽屉改**两栏**（业主截图：像文档查看器那样左右各一屏、各自滚）。
       原先是一根长条：信息块 → 8 张卡 → 说明 → 原始字段，滚到底才能对照，看「它现在什么状态」要来回翻。 */
    var runStat = card.kind === 'mcp'
      ? '<div class="sub-h" style="margin-top:16px">运行状态</div>' +
        '<div class="doc-stat">' + card.metas.map(function (m) {
          return '<span><i>' + h.esc(m[0]) + '</i><b>' + h.esc(String(m[1])) + '</b></span>';
        }).join('') + '</div>' +
        '<dl class="dl">' +
        '<dt>密钥</dt><dd>' + (raw.keys != null ? raw.keys + ' 把' : '—') + '</dd>' +
        '<dt>配额使用</dt><dd>' + (raw.usage != null ? (raw.usage <= 1 ? raw.usage * 100 : raw.usage).toFixed(1) + '%' : '—') + '</dd>' +
        '<dt>服务来源</dt><dd>' + h.esc(SRC[raw.source] || raw.sourceName || raw.source || '—') + '</dd>' +
        '</dl>'
      : '';
    /* 「在用它的 Agent」—— 右栏那块空白正好放这个：卡片上只有个数，这里给出是谁。 */
    var userIds = card.kind === 'mcp' ? agentsUsingMcpIds(card.id, h) : [];
    var nameOf = {};
    ((global.DATA_SEED || {}).AGENTS || []).forEach(function (a) { nameOf[a.id] = a.name; });
    var userBlock = card.kind === 'mcp'
      ? '<div class="sub-h" style="margin-top:16px">在用它的 Agent<span class="cw-hint">' + userIds.length + ' 个</span></div>' +
        (userIds.length
          ? '<div class="cw-users">' + userIds.map(function (id) {
              return '<span class="cw-user">' + h.esc(nameOf[id] || id) + '</span>';
            }).join('') + '</div>'
          : '<div class="cw-empty">还没有 Agent 用它</div>')
      : '';
    /* 左＝关于这份资产的事实（是什么、现在什么状态、谁在用），右＝要做的事（挂给谁、开哪些工具）。
       业主 2026-10-19 定：信息在左、动作在右。 */
    var infoPane =
      '<div class="cw-pane cw-pane-l">' +
      '<div class="sub-h">资产信息</div>' +
      '<dl class="dl">' +
      '<dt>类型</dt><dd>' + h.esc(card.note) + '</dd>' +
      '<dt>状态</dt><dd>' + h.esc(card.state.t) + '</dd>' +
      (card.sub ? '<dt>说明</dt><dd>' + h.esc(card.sub) + '</dd>' : '') +
      (card.refs ? '<dt>引用</dt><dd>' + h.esc(card.refs) + '</dd>' : '') +
      '<dt>ID</dt><dd><code>' + h.esc(card.id) + '</code></dd>' +
      '</dl>' +
      runStat +
      userBlock +
      (defs.length
        ? '<details class="cw-raw"><summary>原始字段（上游数据，未加工）· ' + defs.length + ' 项</summary>' +
          '<dl class="dl">' + defs.map(function (k) {
            return '<dt>' + h.esc(k) + '</dt><dd>' + h.esc(String(raw[k])) + '</dd>';
          }).join('') + '</dl></details>'
        : '') +
      '</div>';
    var agentPane =
      '<div class="cw-pane cw-pane-r">' +
      '<div class="sub-h">接入到 Agent<span class="cw-hint">接入即开通全部工具，可逐个关</span></div>' +
      '<div class="cw-agents">' + agents.slice(0, 8).map(function (a) {
        /* v39：行列表改卡片。已接入的目标直接显示「已接入」，不再给一个按了只会弹「已经接入过」的按钮。 */
        var bound = binds.indexOf(a.id) > -1;
        var meta = [a.model, a.dailyBase ? '日均 ' + h.fmt.int(a.dailyBase) : ''].filter(Boolean).join(' · ');
        /* 接入后就在这张卡上勾工具（百炼同款）：默认全开，服务侧原本停用的那几个保持关。
           存**关掉的清单**而不是开着的清单 —— 服务以后多出一个工具，默认就是可用的，不用回头补。 */
        var off = offMap[card.id + '|' + a.id] || (raw.offTools || []);
        var onN = tools ? tools.filter(function (t) { return off.indexOf(t) < 0; }).length : 0;
        var toolBlock = (bound && tools)
          ? '<div class="cw-ag-tools"><div class="cw-ag-tools-h">可用工具<b>' + onN + ' / ' + tools.length + '</b></div>' +
            '<div class="cw-ag-tools-l">' + tools.map(function (t) {
              var on = off.indexOf(t) < 0;
              return '<button type="button" class="cw-tool' + (on ? ' on' : '') + '" data-act="assets-tool" data-id="' +
                h.esc(card.id) + '|' + h.esc(a.id) + '|' + h.esc(t) + '" aria-pressed="' + on + '"' +
                ' title="' + (on ? '点击关闭' : '点击开启') + ' ' + h.esc(t) + '">' + h.esc(t) + '</button>';
            }).join('') + '</div></div>'
          : '';
        return '<div class="cw-ag' + (bound ? ' on' : '') + '">' +
          '<div class="cw-ag-hd">' + h.avatar(a.name, { face: true }) +
          '<span class="cw-ag-t"><b>' + h.esc(a.name) + '</b><em>' + h.esc(a.biz || '') +
          (a.grayVersion ? '<i class="cw-ag-tag">灰度 ' + h.esc(a.grayVersion) + '</i>' : '') + '</em></span>' +
          '</div>' +
          '<div class="cw-ag-desc">' + h.esc(a.desc || '') + '</div>' +
          toolBlock +
          '<div class="cw-ag-ft"><span class="cw-ag-m">' + h.esc(meta) + '</span>' +
          (bound
            ? '<span class="cw-ag-on"><i class="statedot-dot" data-state="done" aria-hidden="true"></i>已接入</span>'
            : '<button class="btn-ghost sm" data-act="assets-bind" data-id="' + h.esc(card.id) + '|' + h.esc(a.id) + '">接入</button>') +
          '</div></div>';
      }).join('') + '</div>' +
      '</div>';
    var body =
      '<div class="cw-2col">' + infoPane + agentPane + '</div>' +
      /* 说明放在两栏**外面**：放进栏内会被滚动边缘切掉半行字（实测），
         也正好对齐文档查看器「栏下一条通栏说明」的排法。 */
      (tools
        ? '<div class="cw-note"><b>接入是写操作</b>：建立绑定并写一条审计；接入后默认开通该服务的<b>全部工具</b>，' +
          '在右边那张卡上逐个关掉不用的（关掉会写审计，清单存在会话状态里，刷新回到初始态）。' +
          '真正生效的授权仍落到 Agent 详情 › 编排配置 › 工具授权。</div>'
        : '<div class="cw-note"><b>接入是写操作</b>：建立绑定并写一条审计，卡片的「已接入」即为结果；' +
          '原型里的绑定存在会话状态里，刷新回到初始态。</div>');
    UI().openSheet({
      title: card.name,
      wide: true,
      bodyHtml: body,
      footHtml: '<button class="btn-ghost sm" data-act="' + h.esc(card.deep.act) + '" data-id="' + h.esc(card.deep.id) + '">' +
        h.esc(card.deep.label) + ' →</button>' +
        '<button class="btn-ghost sm" data-act="assets-close">关闭</button>'
    });
  }

  /* ── 权限策略：三组各占一个**二级分页**（工具授权 / 网关与密钥 / 沙盒隔离）──
     业主的判断是"MCP 和沙盒本身就是权限的一部分"，这一页就是那句话的账本：
     每行一个权限点（含风险档与权限点 id），右侧是 6 个角色各自持不持有。
     数据全部来自 seed 的 PERM_POINTS 与 rolePerms()，与「账号与权限」页同一份。 */
  var POLICY_GROUPS = [
    { id: 'tools', g: '工具授权（Agent 能用什么）', why: '决定这个 Agent 能调用哪些工具 —— 只读授权低危、写授权高危', test: /^agent:(tool|rollback)/ },
    { id: 'gateway', g: 'MCP / 模型网关（外部能力接进来）', why: '接哪个服务、密钥怎么轮换、要不要全局降级', test: /^gateway:/ },
    { id: 'sandbox', g: '沙盒隔离（代码在哪跑、能不能出网）', why: '执行环境、网络出口、进程与销毁 —— 隔离边界就是权限边界', test: /^sandbox:/ }
  ];
  function policyTab(state, h, only) {
    var S = global.DATA_SEED;
    var pts = (S && S.PERM_POINTS) || [];
    var roles = (S && S.ROLES) || [];
    var mats = roles.map(function (r) {
      var list = [];
      try { list = (typeof S.rolePerms === 'function' ? S.rolePerms(r.id) : []) || []; } catch (e) { list = []; }
      var all = list.indexOf('*') >= 0;
      return { id: r.id, name: r.name, has: function (p) { return all || list.indexOf(p) >= 0; } };
    });
    var blocks = POLICY_GROUPS.filter(function (grp) { return !only || grp.id === only; }).map(function (grp) {
      var rows = pts.filter(function (p) { return grp.test.test(p.p); });
      if (!rows.length) return '';
      return '<div class="card"><div class="card-h"><h3>' + h.esc(grp.g) + '</h3>' +
        '<span class="card-sub">' + h.esc(grp.why) + '</span>' +
        '</div>' +
        '<table class="bt"><thead><tr><th>权限点</th><th>风险</th>' +
        mats.map(function (m) { return '<th class="ta-c">' + h.esc(m.name) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (p) {
          var risk = p.risk === 'high' ? '<span class="pill bad">高危</span>' : (p.risk === 'mid' ? '<span class="pill warn">中</span>' : '<span class="pill idle">低</span>');
          return '<tr><td>' + h.esc(p.label) + '<div class="td-sub mono">' + h.esc(p.p) + '</div></td>' +
            '<td>' + risk + '</td>' +
            mats.map(function (m) {
              var on = m.has(p.p);
              return '<td class="ta-c ' + (on ? '' : 'muted') + '">' + (on ? '✓' : '—') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
    return (only ? '' : '<div class="bt-note" style="margin-bottom:12px">' +
      '<b>接入一个服务</b>、<b>让某个 Agent 用某个工具</b>、<b>让代码在哪个隔离环境里跑、能不能连外网</b> —— ' +
      '这三件事都是授权决策，只是对象不同（服务 / 工具 / 执行环境）。' +
      '下表按角色摊开：谁能接、谁能改、谁只能看。</div>') +
      blocks +
      '<div class="bt-note">权限点取自 seed 的 PERM_POINTS，此处<b>只读</b>：' +
      '单人系统没有角色可分配，唯一账号持有全部权限点。' +
      '真正要管的是<b>每个 Agent 能用哪些工具</b> —— 在 Agent 详情 › 管理 › 联系里逐项开，写工具要填理由。</div>';
  }

  /* ── 页面 ──────────────────────────────────────────────────────────────── */
  RENDERERS.assetsPage = function (cap, state, h) {
    var kind = tabOf(state);
    var sub = subOf(state);
    var def = defOf(state);
    var all = {};
    TABS.forEach(function (t) { all[t.id] = cardsFor(t.id, state, h); });
    var cards = all[kind] || [];
    var total = 0;
    TABS.forEach(function (t) { total += (all[t.id] || []).length; });

    var head = '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + h.icon('shield', 20) + ' 能力与权限</div>' +
      '<div class="ph-desc">MCP 网关、模型路由、技能、知识库、沙盒与授权策略统一管理：' +
      '接入了什么能力、允许谁用、在什么隔离环境里跑。</div>' +
      '<div class="ph-tags">' +
      '<span>连接器 ' + (all.mcp || []).length + '</span><span>技能 ' + (all.skill || []).length + '</span>' +
      '<span>知识库 ' + (all.kb || []).length + '</span><span>沙盒 ' + (all.sandbox || []).length + '</span>' +
      '<span>合计 ' + total + ' 项</span></div>' +
      '</div><div class="ph-side">' +
      '<button class="btn-ghost" data-act="goto-cap" data-id="agent-wb">去 Agent 工作台 →</button>' +
      '</div></div>';

    var tabsBar = '<div class="cwall-tabs" role="tablist" aria-label="能力与权限分页">' +
      TABS.map(function (t) {
        var n = (all[t.id] && all[t.id].length) ? all[t.id].length : '';
        return '<button role="tab" class="cwall-tab' + (t.id === kind ? ' on' : '') + '"' +
          ' aria-selected="' + (t.id === kind) + '" data-act="assets-tab" data-id="' + t.id + '">' +
          h.icon(t.icon, 14) + '<span>' + h.esc(t.label) + '</span>' +
          (n !== '' ? '<i class="cwall-n">' + n + '</i>' : '') + '</button>';
      }).join('') + '</div>';

    /* 二级分页：只有一项时不渲染这一行（一行一个按钮是噪音） */
    var subBar = def.subs.length > 1
      ? '<div class="cwall-subtabs" role="tablist" aria-label="' + h.esc(def.label) + '下的管理视图">' +
        def.subs.map(function (s2) {
          return '<button role="tab" class="cwall-subtab' + (s2.id === sub ? ' on' : '') + '"' +
            ' aria-selected="' + (s2.id === sub) + '" data-act="assets-sub" data-id="' + h.esc(kind + '|' + s2.id) + '">' +
            h.esc(s2.label) + '</button>';
        }).join('') + '</div>'
      : '';

    var grid = cards.length
      ? '<div class="cwall">' + cards.map(function (c) { return cardHtml(c, h); }).join('') + '</div>'
      : h.emptyFor('这一类下还没有资产', '换一个分页或先接入一项服务', 'chip');

    /* ── 二级视图的内容 ────────────────────────────────────────────────────
       深水视图用的是原「MCP / LLM 网关」与「沙盒隔离」两页的**原渲染器本体**：
       那两页的取数、限流口径、密钥轮换与沙盒策略规则都在各自文件里收口，
       搬一份副本出来必然漂 —— 这一页只负责把它们的视图挂成自己的二级分页。 */
    var capGw = capOf('gateway'), capSbx = capOf('sandbox');
    var body;
    if (kind === 'policy') {
      body = policyTab(state, h, sub);
    } else if (sub === 'cards') {
      body = grid;
    } else if (kind === 'mcp' && sub === 'health') {
      body = RENDERERS.gatewayMcp ? RENDERERS.gatewayMcp(capGw, state, h) : '';
    } else if (kind === 'mcp' && sub === 'llm') {
      body = RENDERERS.gatewayLlm ? RENDERERS.gatewayLlm(capGw, state, h) : '';
    } else if (kind === 'skill' && sub === 'table') {
      body = RENDERERS.gatewaySkills ? RENDERERS.gatewaySkills(capGw, state, h) : '';
    } else if (kind === 'sandbox' && sub === 'detail') {
      /* sandboxPage 自带页头（它原本是独立能力页）—— 嵌进来时把页头降级成小节标题，
         但**不隐藏**：那几句话是它自己的口径说明，删掉就丢信息。 */
      body = '<div class="cwall-deep">' + (RENDERERS.sandboxPage ? RENDERERS.sandboxPage(capSbx, state, h) : '') + '</div>';
    } else {
      body = grid;
    }

    var src = {
      mcp: '连接器数字来自网关的服务健康表（QUERY.mcpHealth）：工具数=已启用/总数，QPS=当前/上限，错误率与 P99 取近 ' + h.esc(Q.RANGES[state.range] ? Q.RANGES[state.range].label : state.range) + '。',
      llm: 'LLM 路由的档位、计价与配额取自网关页的模型路由表（与成本页同一份数据）。',
      skill: '技能数字来自技能清单（QUERY.skillTable）：调用=该时间范围内的触发次数，引用方=引用了该技能的 Agent 数（refs 引用边）。',
      kb: '知识库数字来自资产表 kb：文档/切片/命中/零命中率均为上游登记值，引用方统计自 refAgents。',
      sandbox: '沙盒行来自资产表 sandbox：名字用中文标签（kindText），机器令牌只作副行；到期天数为登记值，已拦截的沙盒标「已被拦」。',
      policy: '权限点取自 seed 的 PERM_POINTS。单人系统没有角色分配，唯一账号持有全部；Agent 能用到哪些工具在 Agent 详情里逐项授权。'
    }[kind];

    return head + tabsBar + subBar + body + h.metaBar(null, [{ k: '本页口径', v: src }]);
  };

  /* ── 动作 ──────────────────────────────────────────────────────────────── */
  ACTIONS['assets-tab'] = function (id, btn, h) {
    h.state.assetTab = id;
    h.state.assetSub = null;      /* 换一级分页时二级回到该类的第一项（继承上一个类的二级 = 落到空白） */
    h.navigate({});
  };
  ACTIONS['assets-sub'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    h.state.assetTab = p[0];
    h.state.assetSub = p[1];
    h.navigate({});
  };
  /* 从别的页面直达本页某一级+二级分页（例：Agent 详情 › 管理 › 权限与工具 → 全局权限矩阵）。
     id = "一级|二级"。与 ?at=&as= 是同一套状态，所以跳过去之后地址栏也是对的。 */
  ACTIONS['assets-goto'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    h.state.assetTab = p[0] || 'mcp';
    h.state.assetSub = p[1] || null;
    h.navigate({ domain: 'platform', cap: 'assets', agentId: null, tab: null, traceId: null, page: 1, filters: {} });
  };
  ACTIONS['assets-open'] = function (id, btn, h) {
    var kind = tabOf(h.state);
    var card = cardsFor(kind, h.state, h).filter(function (c) { return c.id === id; })[0];
    if (!card) { h.toast('资产不存在', 'bad'); return; }
    openCardSheet(card, h);
  };
  ACTIONS['assets-close'] = function (id, btn, h) {
    if (UI().closeSheet) UI().closeSheet();
    else h.toast('弹层组件未加载', 'bad');
  };
  /* 按 id 反查卡片（四个分页都扫一遍）：接入与工具开关改完要拿**新算出来的**卡片重开抽屉，
     否则抽屉里还挂着改之前那份引用计数 / 状态。 */
  function findCard(assetId, h) {
    var card = null;
    TABS.forEach(function (t) {
      cardsFor(t.id, h.state, h).forEach(function (c) { if (c.id === assetId && !card) card = c; });
    });
    return card;
  }
  /* 接入 = 真写操作：建立绑定 → 写审计 → 抽屉**不关**，就地展开该 Agent 的工具清单。 */
  ACTIONS['assets-bind'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var assetId = p[0], agentId = p[1];
    var S = global.DATA_SEED || {};
    var agent = (S.AGENTS || []).filter(function (a) { return a.id === agentId; })[0];
    if (!assetId || !agent) { h.toast('资产或 Agent 不存在', 'bad'); return; }
    var bind = h.state.assetBinds || (h.state.assetBinds = {});
    var list = bind[assetId] || (bind[assetId] = []);
    if (list.indexOf(agentId) > -1) { h.toast('已经接入过「' + agent.name + '」', 'info'); return; }
    var card = findCard(assetId, h);
    var win = UI();
    if (win.audit) {
      win.audit({
        action: '接入资产',
        target: (card ? card.name : assetId) + ' → ' + agent.name,
        impact: '该 Agent 的编排中新增一项可用' + (card ? card.note.split(' · ')[0] : '能力'),
        reason: '在「能力与权限」页接入'
      });
    }
    list.push(agentId);
    var toolN = card && card.raw && card.raw.tools
      ? card.raw.tools.length - ((card.raw.offTools || []).length) : 0;
    h.toast('已接入：' + (card ? card.name : assetId) + ' → ' + agent.name +
      (toolN ? '（默认开通 ' + toolN + ' 个工具，可逐个关）' : '（已写审计）'), 'ok');
    /* 只重画内容，不走 navigate：navigate 一旦改变 hash，hashchange 里会 closeModals()，
       抽屉就被收掉了（首次进来 `#/platform/assets` 会被规范成 `.../assets/`，实测踩到）。
       这里没有地址状态要改，重画就够。 */
    var d = global.document;
    var prev = d && d.querySelector('.v10-sheet');
    var keepScroll = prev ? prev.scrollTop : 0;
    if (h.render) h.render();
    var fresh = findCard(assetId, h);
    if (fresh) openCardSheet(fresh, h);
    var now = d && d.querySelector('.v10-sheet');
    if (now && keepScroll) now.scrollTop = keepScroll;
  };
  /* 工具级授权就地改：关一个是收紧（写审计），开回来是恢复（只提示，不重复记账）。 */
  ACTIONS['assets-tool'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var assetId = p[0], agentId = p[1], tool = p.slice(2).join('|');
    if (!assetId || !agentId || !tool) return;
    var key = assetId + '|' + agentId;
    var card = findCard(assetId, h);
    var baseOff = (card && card.raw && card.raw.offTools) || [];
    var map = h.state.assetToolOff || (h.state.assetToolOff = {});
    var off = (map[key] || baseOff).slice();
    var i = off.indexOf(tool);
    var turningOff = i < 0;
    if (turningOff) off.push(tool); else off.splice(i, 1);
    map[key] = off;
    var agent = ((global.DATA_SEED || {}).AGENTS || []).filter(function (a) { return a.id === agentId; })[0];
    if (turningOff && UI().audit) {
      UI().audit({
        action: '关闭工具授权',
        target: (card ? card.name : assetId) + ' → ' + (agent ? agent.name : agentId) + ' · ' + tool,
        impact: '该 Agent 不能再调用这个工具',
        reason: '在「能力与权限」详情里逐个调整'
      });
    }
    h.toast((agent ? agent.name : agentId) + '：' + (turningOff ? '已关闭 ' : '已开启 ') + tool, turningOff ? 'info' : 'ok');
    /* 就地翻这颗 chip —— 重开整张抽屉会把滚动位置弹回顶部（一个服务七八个工具时很难用），
       所以只改自己 + 同一张卡上的「可用工具 n / m」。 */
    if (btn && btn.classList) {
      btn.classList.toggle('on', !turningOff);
      btn.setAttribute('aria-pressed', String(!turningOff));
      var wrap = btn.parentNode ? btn.parentNode.parentNode : null;
      if (wrap && wrap.querySelectorAll) {
        var total = wrap.querySelectorAll('.cw-tool').length;
        var onN = wrap.querySelectorAll('.cw-tool.on').length;
        var cnt = wrap.querySelector('.cw-ag-tools-h b');
        if (cnt) cnt.textContent = onN + ' / ' + total;
      }
    }
  };
})(window);
