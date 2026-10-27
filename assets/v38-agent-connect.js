/* SECTION: v38-agent-connect（2026-10-18 业主指定）
 * 业主：「把 agent 联系（mcp，技能，工具，知识库）等做成卡片管理」+ 一张能力画廊截图。
 * 随后两条纠正（同一天，已落进本文件）：
 *   ① 「我们的白色就可以，人家是库所以有加，我们是按钮」—— 底色保持本页的白/浅，不照搬那套深色卡；
 *      右上的动作不是「＋」（那是能力商店"装一个"的语义），而是**开关**（我们是按钮）。
 *   ② 「点击卡片，详情，可编辑」—— 点卡片主体开详情抽屉，抽屉里能改这个 Agent 上的参数。
 *
 * 放在 Agent 详情 › 管理 › 「联系」（管理页的第一个二级分页）。
 * 这一页回答的是"这个 Agent 身上挂了谁"：接入了哪些 MCP 服务、能用哪些工具、
 * 装了哪些技能、读了哪些知识库 —— 四类合成**一面卡片墙**，按类筛选，开关即挂/摘。
 *
 * ── 为什么放在「管理」而不是编排配置 ──────────────────────────────
 *   编排配置讲的是"它怎么跑"（拓扑、超时、降级），联系讲的是"它和谁连"。
 *   挂在编排配置里会被拓扑吃掉注意力，单开一个分页才扫得清。
 *
 * ── 取数纪律（一条都不新造，全部 join 既有事实）─────────────────────
 *   MCP 服务 ← RENDERERS.agentUsedSvcs(a)（拓扑节点的 mcp 字段，与编排配置/工具授权同一份）
 *   技能     ← A2A 委派边里 from/to 命中本 Agent 的 e.skill → SKILLS（与技能清单页同一份）
 *   知识库   ← 上面这些技能 deps.kb 的并集（技能依赖是唯一的 agent↔kb 事实链）
 *   工具     ← 已接入服务的 tools（服务级 offTools 默认关 —— 与网关页 toolsOf 同一读法）
 *   工具的可编辑状态直接读写 state.agentToolGrant（key 规则 a.id|svcId|tool 与 v34 授权卡逐字一致），
 *   所以在这一页拨开关等于在「权限与工具」里授权，两处永远同步，不存在第二份状态。
 *
 * ── 详情里的"可编辑"改的是什么（这点必须说清，否则会被读成平台级配置）──
 *   改的是**这个 Agent 上的覆盖值**（state.awcCfg），不是服务/技能/知识库本身：
 *     MCP 服务 → 本 Agent 的调用上限 / 超时 / 失败策略（默认值取服务级 qpsCap 与编排节点的 8s·走降级）
 *     技能     → 调用方式 / 版本跟随还是固定（默认取 SKILLS 的 invocable）
 *     工具     → 授权开关 / 超时
 *     知识库   → 检索条数 / 置信度门槛 / 是否强制标出处（0.72 取自政策条款检索技能里写明的同一门槛）
 *   每一项改动都过 V10UI.audit 留痕；平台级配置仍在「能力与权限」与「企业知识库」里，两处不重叠。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, F = global.FACTS, APP = global.APP_DATA;
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  function UI() { return global.V10UI || {}; }

  /* MCP 服务的 tone（blue/cyan/teal/indigo/purple/pink…）收敛到本仓图标底色支持的五档，
     不然 data-tone 落不到任何 CSS 规则上，图标会变成没有底的裸字（v33 踩过）。 */
  var TONE = { blue: 'blue', cyan: 'blue', teal: 'blue', indigo: 'blue', purple: 'purple', pink: 'purple', amber: 'amber', green: 'green' };
  function tone(t) { return TONE[t] || 'gray'; }

  var TYPES = [
    { id: 'mcp', label: 'MCP 服务', icon: 'chip' },
    { id: 'skill', label: '技能', icon: 'cap' },
    { id: 'tool', label: '工具', icon: 'gear' },
    { id: 'kb', label: '知识库', icon: 'book' }
  ];
  var TYPE_NAME = { mcp: 'MCP 服务', skill: '技能', tool: '工具', kb: '知识库' };

  /* ── 联系开关的状态：基线是推导出来的，这里只记差异 ────────────────── */
  function store(h) { var s = h.state; return s.agentContact || (s.agentContact = {}); }
  function bucket(h, a) {
    var m = store(h);
    if (!m[a.id]) {
      var e = {};
      TYPES.forEach(function (t) { e[t.id] = { add: {}, rm: {} }; });
      m[a.id] = e;
    }
    TYPES.forEach(function (t) { if (!m[a.id][t.id]) m[a.id][t.id] = { add: {}, rm: {} }; });
    return m[a.id];
  }
  function isOn(a, type, id, h, base) {
    var b = bucket(h, a)[type];
    if (b.rm[id]) return false;
    if (b.add[id]) return true;
    return !!base[id];
  }

  /* ── 工具的授权状态（与 v34 同一 key、同一默认值）────────────────────── */
  function grantKey(a, svcId, tool) { return a.id + '|' + svcId + '|' + tool; }
  function isWriteTool(svc, tool) {
    if (svc.rw === 'write') return true;
    return /^(create|update|delete|batch|send|notify|refund|export|write|close|assign)/i.test(String(tool));
  }
  function toolOn(a, svc, tool, h) {
    var g = (h.state.agentToolGrant || {})[grantKey(a, svc.id, tool)];
    if (g === 'allow') return true;
    if (g === 'deny') return false;
    return (svc.offTools || []).indexOf(tool) < 0;
  }

  /* ── 本 Agent 上的参数覆盖（详情抽屉里可编辑）────────────────────────── */
  function cfgAll(h) { var s = h.state; return s.awcCfg || (s.awcCfg = {}); }
  function cfgOf(h, a, key) {
    var m = cfgAll(h);
    if (!m[a.id]) m[a.id] = {};
    return m[a.id][key] || (m[a.id][key] = {});
  }
  function val(h, a, key, f, src) {
    var c = cfgOf(h, a, key);
    return (c[f.k] != null) ? c[f.k] : f.def(src || {});
  }

  /* 可编辑项：全部**按钮化**（不用 input/select —— 抽屉里的表单控件在本仓没有统一皮肤，
     而"点一下就改"正是这一页既定的交互；每个字段给 3–4 个真实档位，不让人手打数字）。 */
  var FIELDS = {
    mcp: [
      { k: 'qps', label: '本 Agent 调用上限', def: function (s) { return String(s.qpsCap || 60); }, opts: ['30', '60', '120', '200'], unit: 'qps' },
      { k: 'timeout', label: '调用超时', def: function () { return '8000'; }, opts: ['5000', '8000', '15000', '30000'], unit: 'ms' },
      { k: 'fail', label: '失败策略', def: function () { return 'fallback'; }, opts: ['fallback', 'abort'], text: { fallback: '走降级分支', abort: '直接中断' } }
    ],
    skill: [
      { k: 'invocable', label: '调用方式', def: function (s) { return s.invocable || 'both'; }, opts: ['model', 'user', 'both'], text: { model: '模型可触发', user: '仅用户调用', both: '两者皆可' } },
      { k: 'pin', label: '版本', def: function () { return 'follow'; }, opts: ['follow', 'pin'], text: { follow: '跟随最新', pin: '固定当前版本' } }
    ],
    tool: [
      { k: 'timeout', label: '超时', def: function () { return '8000'; }, opts: ['3000', '8000', '15000'], unit: 'ms' }
    ],
    kb: [
      { k: 'topk', label: '检索条数', def: function () { return '5'; }, opts: ['3', '5', '8', '10'], unit: '条' },
      { k: 'minScore', label: '置信度门槛', def: function () { return '0.72'; }, opts: ['0.6', '0.72', '0.8', '0.85'] },
      { k: 'cite', label: '强制标注出处', def: function () { return 'yes'; }, opts: ['yes', 'no'], text: { yes: '是', no: '否' } }
    ]
  };

  /* ── 四类候选 + 基线 ──────────────────────────────────────────────────── */
  function mcpOf(a) {
    var fn = RENDERERS && RENDERERS.agentUsedSvcs;
    return fn ? (fn(a) || []) : [];
  }
  function skillsOf(a) {
    var edges = (APP && APP.a2aEdges) ? (APP.a2aEdges() || []) : [];
    var names = {};
    edges.forEach(function (e) { if (e.from === a.id || e.to === a.id) names[e.skill] = 1; });
    return (S.SKILLS || []).filter(function (k) { return names[k.name]; });
  }
  function kbOf(a, skills) {
    var set = {};
    (skills || []).forEach(function (k) {
      ((k.deps && k.deps.kb) || []).forEach(function (id) { set[id] = 1; });
    });
    return Object.keys(set);
  }
  /* 这个服务在本 Agent 的拓扑里被几个节点用到（详情里要说"摘掉会影响谁"） */
  function nodesUsing(a, svcId) {
    var key = F.AGENT_TOPO[a.id];
    var topo = F.TOPO[key] || F.TOPO['qa-rag'];
    return topo.filter(function (n) { return n.mcp === svcId; });
  }

  function collect(a, h) {
    var svcs = mcpOf(a), used = {};
    svcs.forEach(function (s) { used[s.id] = 1; });
    var skills = skillsOf(a), skUsed = {};
    skills.forEach(function (k) { skUsed[k.id] = 1; });
    var kbIds = kbOf(a, skills), kbUsed = {};
    kbIds.forEach(function (id) { kbUsed[id] = 1; });

    var out = { mcp: [], skill: [], tool: [], kb: [] };

    (S.MCP_SERVICES || []).forEach(function (m) {
      var nodes = nodesUsing(a, m.id);
      out.mcp.push({
        type: 'mcp', id: m.id, name: m.purpose || m.name, tone: tone(m.tone), icon: m.icon || 'chip',
        desc: m.name + ' · ' + (m.rw === 'write' ? '写操作' : '只读') + ' · ' + (m.tools || []).length + ' 个工具 · 配额 ' + m.qpsCap + ' qps',
        on: isOn(a, 'mcp', m.id, h, used), mono: true,
        raw: m, nodes: nodes,
        facts: [
          ['身份', m.name], ['方向', m.rw === 'write' ? '写（会改外部系统）' : '只读'],
          ['工具', (m.tools || []).length + ' 个' + ((m.offTools || []).length ? '（' + m.offTools.length + ' 个默认关闭）' : '')],
          ['服务级配额', m.qpsCap + ' qps · 错误偏置 ' + m.errorBias],
          ['来源', m.source === 'plugin' ? '随插件带入（' + (m.sourceName || '') + '）' : (m.source === 'external' ? '对接外部系统（' + (m.sourceName || '') + '）' : '平台自建')],
          ['编排里用到', nodes.length ? nodes.length + ' 个节点用到：' + nodes.map(function (n) { return n.name; }).join(' · ') : '暂无节点使用（挂上也不会有调用）']
        ]
      });
      (m.tools || []).forEach(function (t) {
        var w = isWriteTool(m, t);
        out.tool.push({
          type: 'tool', id: m.id + '::' + t, name: t, tone: tone(m.tone), icon: m.icon || 'gear',
          desc: (m.purpose || m.name) + ' · ' + (w ? '写动作' : '只读'),
          on: used[m.id] ? toolOn(a, m, t, h) : false,
          off: !used[m.id],
          write: w, svcId: m.id, svcName: m.purpose || m.name, mono: true, raw: m, tool: t,
          facts: [
            ['所属服务', m.name], ['方向', w ? '写动作（会改外部系统）' : '只读'],
            ['服务级开关', (m.offTools || []).indexOf(t) >= 0 ? '默认关闭（服务策略）' : '开启'],
            ['服务当前状态', used[m.id] ? '已接入本 Agent' : '服务未接入']
          ]
        });
      });
    });

    (S.SKILLS || []).forEach(function (k) {
      var edges = (APP && APP.a2aEdges) ? (APP.a2aEdges() || []) : [];
      var mine = edges.filter(function (e) { return e.skill === k.name && (e.from === a.id || e.to === a.id); });
      out.skill.push({
        type: 'skill', id: k.id, name: k.name, tone: tone(k.tone), icon: k.icon || 'cap',
        desc: k.purpose + ' · ' + k.version + ' · 依赖 ' + ((k.deps && k.deps.mcp) || []).length + ' 个服务 / ' + ((k.deps && k.deps.kb) || []).length + ' 个知识库',
        on: isOn(a, 'skill', k.id, h, skUsed), raw: k,
        facts: [
          ['版本', k.version + (k.status === 'gray' ? '（灰度中）' : (k.status === 'off' ? '（已停用）' : ''))],
          ['何时用', k.trigger],
          ['依赖服务', ((k.deps && k.deps.mcp) || []).join(' · ') || '无'],
          ['依赖知识库', ((k.deps && k.deps.kb) || []).join(' · ') || '无'],
          ['本 Agent 的委派', mine.length ? mine.length + ' 条 A2A 边（' + mine.map(function (e) { return (e.from === a.id ? '派出' : '接收'); }).join(' · ') + '）' : '未在委派边里出现']
        ]
      });
    });

    (S.KBS || []).forEach(function (k) {
      var users = (S.SKILLS || []).filter(function (s) { return ((s.deps && s.deps.kb) || []).indexOf(k.id) >= 0; });
      out.kb.push({
        type: 'kb', id: k.id, name: k.name, tone: tone(k.hue), icon: 'book',
        desc: k.docs + ' 份文档 · ' + k.chunks + ' 个切片 · ' + k.embed + ' · 最近同步 ' + Math.abs(k.lastSync) + ' 天前',
        on: isOn(a, 'kb', k.id, h, kbUsed), raw: k,
        facts: [
          ['文档 / 切片', k.docs + ' 份 / ' + k.chunks + ' 个'],
          ['切分', 'chunk ' + k.chunkSize + ' · overlap ' + k.overlap],
          ['向量模型', k.embed],
          ['最近同步', Math.abs(k.lastSync) + ' 天前'],
          ['被哪些技能依赖', users.length ? users.map(function (s) { return s.name; }).join(' · ') : '暂无技能依赖']
        ]
      });
    });

    /* 2026-10-18 业主：「位置固定，不要因为启动而移动」。
       此前这里做的是"已联系的排前面"——于是**拨一个开关，那张卡就跳到最前面，后面整墙跟着挪**。
       排序取消：一律按数据层原序固定，开关只改状态（颜色 / 开合），不改位置。
       代价是未联系的卡混在中间 —— 那正是开关颜色要承担的信息。 */
    return out;
  }

  /* ── 卡片：一行 + 就地展开（业主 2026-10-18 第三轮：「不要抽屉收纳，全部展开」）────
     上一版点卡片弹抽屉装详情 —— 业主否掉了：抽屉是把内容"收起来"，他不接受。
     现在点卡片**就地展开**（卡片自己变高），参数、事实全在卡里，再点收起。
     开关照旧只切"连不连"，不参与展开（点开关不该把卡撑开）。 */
  /* 参数行（展开区里用）：一行一个字段，档位是按钮，不打字。
     每个按钮带 awc-set 动作，data-id = type|id|field|value。 */
  function fieldsHtml(c, a, h) {
    var defs = FIELDS[c.type] || [];
    if (!defs.length) return '';
    return defs.map(function (f) {
      var cur = val(h, a, c.type + '|' + c.id, f, c.raw || {});
      var opts = f.opts.map(function (o) {
        var label = f.text ? f.text[o] : (o + (f.unit ? ' ' + f.unit : ''));
        return '<button class="awc-opt' + (String(o) === String(cur) ? ' on' : '') + '"' +
          ' data-act="awc-set" data-id="' + h.esc(c.type + '|' + c.id + '|' + f.k + '|' + o) + '">' + h.esc(label) + '</button>';
      }).join('');
      return '<div class="awc-fld"><i>' + h.esc(f.label) + '</i><span class="awc-opts">' + opts + '</span></div>';
    }).join('');
  }

  function openSet(h) { var s = h.state; return s.awcOpen || (s.awcOpen = {}); }
  function isOpen(h, key) { return !!openSet(h)[key]; }

  function cardHtml(c, h) {
    var on = c.on, off = !!c.off;
    var key = c.type + '|' + c.id;
    var open = isOpen(h, key);
    var swLabel = off
      ? '先接入「' + c.svcName + '」，才能单独开关这个工具'
      : (on ? '已联系 · 关掉即摘除（需确认）' : '未联系 · 打开即挂上');
    /* 展开区：事实一行 + 参数若干行，全部平铺，不再收进弹层 */
    var exp = '';
    if (open) {
      var facts = (c.facts || []).map(function (r) {
        return '<span class="awc-fact"><i>' + h.esc(r[0]) + '</i><b>' + h.esc(r[1]) + '</b></span>';
      }).join('');
      exp = '<div class="awc-exp">' +
        '<div class="awc-facts">' + facts + '</div>' +
        fieldsHtml(c, c._agent, h) +
        '<div class="awc-exp-foot">' +
        '<button class="btn-ghost sm" data-act="awc-toggle" data-id="' + h.esc(key) + '">' +
        (on ? '摘掉这条联系' : '挂上这条联系') + '</button>' +
        '<span class="awc-hint">参数只对 ' + h.esc(c._agent.name) + ' 生效 · 改动留审计</span>' +
        '</div></div>';
    }
    return '<div class="awc-card' + (on ? ' on' : '') + (off ? ' off' : '') + (open ? ' is-open' : '') + '">' +
      '<div class="awc-row">' +
      '<button type="button" class="awc-main" data-act="awc-open" data-id="' + h.esc(key) + '"' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' aria-label="' + h.esc((open ? '收起 ' : '展开 ') + c.name) + '">' +
      '<span class="cw-ico" data-tone="' + h.esc(c.tone) + '">' + h.icon(c.icon, 18) + '</span>' +
      '<span class="awc-txt">' +
      '<b' + (c.mono ? ' class="mono"' : '') + ' title="' + h.esc(c.name) + '">' + h.esc(c.name) + '</b>' +
      '<em title="' + h.esc(c.desc) + '">' + h.esc(c.desc) + '</em>' +
      '</span></button>' +
      '<button type="button" role="switch" class="awc-sw" aria-checked="' + (on ? 'true' : 'false') + '"' +
      (off ? ' aria-disabled="true"' : '') +
      ' data-act="awc-toggle" data-id="' + h.esc(key) + '"' +
      ' title="' + h.esc(swLabel) + '" aria-label="' + h.esc(swLabel) + '"><i aria-hidden="true"></i></button>' +
      '</div>' + exp +
      '</div>';
  }

  function page(a, h) {
    var all = collect(a, h);
    var onN = 0, total = 0;
    Object.keys(all).forEach(function (k) { all[k].forEach(function (c) { if (c.on) onN++; total++; }); });
    var writeOn = 0;
    Object.keys(all).forEach(function (k) {
      all[k].forEach(function (c) { if (c.type === 'tool' && c.on && c.write) writeOn++; });
    });
    /* 四类不分页、不筛选，从上到下依次铺开（业主：「全部展开，全部竖向分类排列」）。
       每类一个小标题 + 已联系/总数，下面就是卡片网格；类与类之间竖着排。 */
    var secs = TYPES.map(function (t) {
      var list = all[t.id] || [];
      if (!list.length) return '';
      var onCnt = list.filter(function (c) { return c.on; }).length;
      return '<div class="awc-sec"><h4>' + h.esc(t.label) + '</h4>' +
        '<em>已联系 ' + onCnt + ' / ' + list.length + '</em></div>' +
        '<div class="awc-grid">' + list.map(function (c) { c._agent = a; return cardHtml(c, h); }).join('') + '</div>';
    }).join('');

    return '<div class="card">' +
      '<div class="awc-stat">已联系 <b>' + onN + '</b> / ' + total + '　写工具已开 <b>' + writeOn + '</b></div>' +
      secs +
      '<div class="bt-note">来源：MCP 服务与知识库取自编排拓扑里的工具节点与检索节点，技能取自 A2A 委派边，' +
      '工具是已接入服务暴露的调用。这里的开关与参数只作用于<b>' + h.esc(a.name) + '</b>。</div>' +
      '</div>';
  }

  /* ── 动作 ────────────────────────────────────────────────────────────────
     2026-10-18：分类筛选的 awc-tab 已删 —— 四类现在全都铺在页面上，没有"切到哪一类"这回事。 */

  /* 展开区里改一个字段：写 state.awcCfg + 审计 + 就地重渲染（展开态保留在 state.awcOpen） */
  ACTIONS['awc-set'] = function (raw, btn, h) {
    var p = String(raw == null ? '' : raw).split('|');
    var type = p[0], id = p[1], field = p[2], value = p[3];
    var a = S.AGENTS[S.idx.agent[h.state.agentId]];
    if (!a) { h.toast('当前不在某个 Agent 的详情页', 'bad'); return; }
    var all = collect(a, h);
    var c = (all[type] || []).filter(function (x) { return x.id === id; })[0];
    if (!c) { h.toast('找不到这个条目', 'bad'); return; }
    var defs = FIELDS[type] || [];
    var f = defs.filter(function (x) { return x.k === field; })[0];
    if (!f) { h.toast('这个字段不可编辑', 'bad'); return; }
    var key = type + '|' + id;
    var prev = val(h, a, key, f, c.raw || {});
    if (String(prev) === String(value)) return;
    cfgOf(h, a, key)[field] = value;
    var win = UI();
    var shown = f.text ? f.text[value] : (value + (f.unit ? ' ' + f.unit : ''));
    var shownPrev = f.text ? f.text[prev] : (prev + (f.unit ? ' ' + f.unit : ''));
    if (win.audit) {
      win.audit({
        action: '调整 Agent 联系参数', target: c.name + ' · ' + f.label + ' → ' + a.name,
        impact: shownPrev + ' → ' + shown + '（仅本 Agent）', reason: '在 Agent 联系页的详情里改'
      });
    }
    h.toast(f.label + '：' + shownPrev + ' → ' + shown + '（已留审计）', 'ok');
    /* v39：同页状态改写 → 保持阅读位置（否则点一下档位，整墙滚回顶部） */
    h.navigate({}, { scroll: 'keep' });
  };

  /* 开关：挂上/摘掉。工具走 agentToolGrant（与 v34 同一份）；其余走 agentContact 差异集 */
  ACTIONS['awc-toggle'] = function (raw, btn, h) {
    var p = String(raw == null ? '' : raw).split('|');
    var type = p[0], id = p.slice(1).join('|');
    var a = S.AGENTS[S.idx.agent[h.state.agentId]];
    if (!a) { h.toast('当前不在某个 Agent 的详情页', 'bad'); return; }
    var win = UI();
    var all = collect(a, h);
    var cur = (all[type] || []).filter(function (c) { return c.id === id; })[0];
    if (!cur) { h.toast('找不到这个条目', 'bad'); return; }
    if (cur.off) { h.toast('先把「' + cur.svcName + '」接入，才能单独开关这个工具', 'info'); return; }

    var b = bucket(h, a);

    if (type === 'tool') {
      var svc = (S.MCP_SERVICES || []).filter(function (x) { return x.id === cur.svcId; })[0];
      var to = cur.on ? 'deny' : 'allow';
      var key = grantKey(a, cur.svcId, id.split('::')[1]);
      var g = (h.state.agentToolGrant || (h.state.agentToolGrant = {}));
      /* 审计只写一次：走确认层的路径由 dangerConfirm 自己 audit（v34 修过这条），
         这里再写一条就会出现"同一次操作两条审计"（实测踩到）。 */
      var doneTool = function (selfAudit, reason) {
        g[key] = to;
        if (selfAudit && win.audit) win.audit({ action: to === 'allow' ? '授予 Agent 工具' : '收回 Agent 工具', target: cur.name + ' → ' + a.name, impact: '仅本 Agent 的工具可见性', reason: reason || '在 Agent 联系页拨开关' });
        h.toast((to === 'allow' ? '已授权：' : '已收回：') + cur.name + '（已留审计）', 'ok');
        h.navigate({}, { scroll: 'keep' });
      };
      if (to === 'allow' && !cur.write) { doneTool(true, '在 Agent 联系页拨开关'); return; }
      if (to === 'deny') {
        win.dangerConfirm(h, {
          title: '收回工具', desc: svc.name + ' · ' + cur.name + ' → ' + a.name, tone: 'warn', danger: false,
          perm: 'agent:tool:revoke', action: '收回工具', target: svc.name + ' · ' + cur.name + ' → ' + a.name,
          impacts: [
            { label: '工具', value: cur.name, tone: '' },
            { label: '影响', value: '依赖它的编排节点会走降级分支，可能中断本次编排', tone: 'warn' },
            { label: '作用域', value: '仅本 Agent；服务的全局开关在「能力与权限 › 连接器」' }
          ],
          onConfirm: function (reason) { doneTool(false, reason); }
        });
        return;
      }
      win.dangerConfirm(h, {
        title: '授权写工具', desc: svc.name + ' · ' + cur.name + ' → ' + a.name, tone: 'danger', danger: true,
        perm: 'agent:tool:grant:write', requireReason: true, action: '授予写工具',
        target: svc.name + ' · ' + cur.name + ' → ' + a.name,
        impacts: [
          { label: '工具', value: cur.name + '（写动作）', tone: 'danger' },
          { label: '影响', value: '会改外部系统（建单 / 推送 / 退款一类），事后按轮回滚', tone: 'danger' }
        ],
        onConfirm: function (reason) { doneTool(false, reason); }
      });
      return;
    }

    var NAME = TYPE_NAME[type] || type;
    var perm = type === 'mcp' ? 'agent:tool:grant' : (type === 'skill' ? 'agent:skill:bind' : 'knowledge:kb:bind');
    var done = function (selfAudit, reason) {
      if (cur.on) { b[type].rm[id] = 1; delete b[type].add[id]; }
      else { b[type].add[id] = 1; delete b[type].rm[id]; }
      if (selfAudit && win.audit) win.audit({ action: (cur.on ? '摘掉' : '挂上') + NAME, target: cur.name + ' → ' + a.name, impact: '仅本 Agent 的' + NAME + '清单', reason: reason || '在 Agent 联系页拨开关' });
      h.toast((cur.on ? '已摘掉：' : '已挂上：') + cur.name + '（已留审计）', 'ok');
      h.navigate({}, { scroll: 'keep' });
    };
    if (!cur.on) { done(true, '在 Agent 联系页拨开关'); return; }
    win.dangerConfirm(h, {
      title: '摘掉' + NAME, desc: cur.name + ' → ' + a.name, tone: 'warn', danger: false,
      perm: perm, action: '摘掉' + NAME, target: cur.name + ' → ' + a.name,
      impacts: [
        { label: NAME, value: cur.name },
        { label: '影响', value: type === 'mcp' ? '该服务暴露的工具在本 Agent 上全部不可见（工具级授权保留，重新挂上即恢复）'
          : (type === 'skill' ? '本 Agent 不再按这件事派生委派；已发生的调用记录保留' : '本 Agent 后续检索不再命中这个库；索引与文档不动') },
        { label: '作用域', value: '仅本 Agent；平台级开关不在这里' }
      ],
      onConfirm: function (reason) { done(false, reason); }
    });
  };

  ACTIONS['awc-open'] = function (raw, btn, h) {
    var key = String(raw == null ? '' : raw);
    if (!key) return;
    var o = openSet(h);
    if (o[key]) delete o[key]; else o[key] = 1;
    /* v39：就地重渲染，展开态存 state.awcOpen，切分类/改参数都不会丢 ——
       阅读位置同理，不能因为展开一张卡就整页跳回顶部。 */
    h.navigate({}, { scroll: 'keep' });
  };
  global.V38CONNECT = { page: page, collect: collect };
})(window);
