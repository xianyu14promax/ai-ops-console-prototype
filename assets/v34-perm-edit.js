/* SECTION: v34-perm-edit（2026-10-15）
 * 业主清单第 ⑥ 项：「权限类控件改成可直接编辑（按风险分级确认），不做只读陈列」。
 * 起因是业主原话 —— 权限被做成了**陈列柜**：能读、不能改、也不能申请，
 * 而同一页里"角色"却有编辑表单。一个能办、一个不能办，没有道理。
 *
 * 本文件把 Agent 详情页上三处"只读陈列"改成**可编辑**，并且**按风险分档**：
 *
 *   ① 编排配置 › 工具授权（新）：这个 Agent 对每个 MCP 工具是"可用/不可用"。
 *      · 授权**只读**工具 → 低风险：即时生效（过权限门禁即可，不弹确认）；
 *      · 授权**写**工具   → 高风险：确认弹层 + **强制填理由**；
 *      · 收回任何工具     → 中风险：确认 + 影响面（会列出用到它的节点数）。
 *   ② 版本与发布 › 自动回滚条件（改）：条件从"印一行字"变成可调；
 *      · 收紧（成功率阈值调高 / P99 调低）→ 低风险，即时生效；
 *      · 放宽 → 高风险，强制理由。
 *   ③ 编排配置 › 「编辑草稿（未接入）」这个**死按钮**：改成能真跳到的入口
 *      （画布拖拽编辑确实属工程实现项，不假装能做；但工具授权与策略现在能编辑了，
 *      按钮就该把人带过去，而不是弹一句"后续版本开放"）。
 *
 * ⚠ 复用而非另造（本仓纪律）：
 *   · 门禁、风险档、强制理由全走 V10UI.dangerConfirm / checkPerm（一处收口）；
 *   · 风险级别不在这里自定，而是登记成**权限点**的 risk 字段（seed.js 的 PERM_POINTS 是唯一真源）；
 *   · 状态存 state.agentToolGrant / state.rollbackRule：会话内可改、刷新还原（与全站写操作一致）。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY;
  var RENDERERS = global.RENDERERS, ACTIONS = global.ACTIONS;
  function UI() { return global.V10UI || {}; }

  /* SECTION: perm-points
   * 风险分级放在**权限点**里（不是本文件自定一套）：这样"谁能改"和"要不要填理由"
   * 由同一份 PERM_POINTS 决定，角色矩阵、审批页也读得到。
   * ⚠ 已同步登记到 seed.js；这里的 push 是兜底（带 has 判断，且会重算 ME.perms）。 */
  var NEW_POINTS = [
    { p: 'agent:tool:grant', label: '授予 Agent 只读工具', grp: 'Agent', risk: 'low', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:tool:grant:write', label: '授予 Agent 写工具（高危）', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:tool:revoke', label: '收回 Agent 工具授权', grp: 'Agent', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'agent:rollback:rule', label: '调整自动回滚条件', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' }
  ];
  function registerPerms() {
    try {
      if (!S || !S.PERM_POINTS) return;
      NEW_POINTS.forEach(function (np) {
        if (!S.PERM_POINTS.some(function (x) { return x.p === np.p; })) S.PERM_POINTS.push(np);
      });
      /* ME.perms 是角色推导的一次性快照：新增权限点后必须重算，
         否则持 '*' 通配的角色也命中不了（v23 同样的坑）。 */
      if (S.ME && typeof S.rolePerms === 'function') S.ME.perms = (S.rolePerms(S.ME.roleId) || []).slice();
    } catch (e) { if (global.console) global.console.error('[v34-perm] registerPerms', e); }
  }
  registerPerms();

  /* ── 工具授权状态 ────────────────────────────────────────────────────────
     key = agentId|svcId|tool → 'allow' | 'deny'；未记录时取数据层默认
     （svc.offTools 里的工具默认不可用 —— 与网关页 toolsOf 同一读法，
       区别只在**作用域**：这里是"这个 Agent 能不能用"，不是"这个服务开不开"。） */
  function grantKey(a, svc, tool) { return a.id + '|' + svc.id + '|' + tool; }
  function isWriteTool(svc, tool) {
    /* 判据：服务级 rw==='write' 即写服务；另按名字兜底识别写动作动词。
       不猜更细的语义 —— 数据里没有逐工具的 rw 字段（seed 只给了服务级 rw）。 */
    if (svc.rw === 'write') return true;
    return /^(create|update|delete|batch|send|notify|refund|export|write|close|assign)/i.test(String(tool));
  }
  function grantsOf(h) { var s = h.state; return s.agentToolGrant || (s.agentToolGrant = {}); }
  function toolState(a, svc, tool, h) {
    var ov = grantsOf(h)[grantKey(a, svc, tool)];
    if (ov === 'allow') return 'on';
    if (ov === 'deny') return 'off';
    return (svc.offTools || []).indexOf(tool) >= 0 ? 'off' : 'on';
  }

  /* ── ① 工具授权卡片 ──────────────────────────────────────────────────────
     ⚠ 2026-10-18 起**本卡不再被任何页面挂载**（业主：「把 4 页合成一页，把重复的删了」）。
     它原先在「管理 › 编排配置」和「管理 › 权限与工具」各渲染一遍 —— 同一个函数、同一份
     state.agentToolGrant，分页时不同屏，所以一直没人发现是重复的。
     现在工具授权只在「管理 › 联系」的工具分类里逐条管（assets/v38-agent-connect.js），
     读写**仍是这一份 state**（key 规则 a.id|svcId|tool 逐字相同），所以逻辑没有第二套。
     函数保留而不删：它比卡片墙多两件事 —— 按服务分组的「已开 x/y · 写工具 n」统计、
     以及撤销上一次授权（state.permUndo）。将来若要恢复一个"按服务汇总"的视图，
     从这里接手即可；**但不要再把它和联系页同时挂出**，那就是这次的重复。
     ────────────────────────────────────────────────────────────────────────
     usedSvcs：由 renderers.js 的 agentOrchestrate 从**同一份拓扑**算出来后传进来 ——
     本文件不自己推一遍"这个 Agent 依赖哪些服务"，否则两处必然会漂。 */
  function toolCard(a, usedSvcs, state, h) {
    var GR = (state && state.agentToolGrant) || {};
    var undo = state && state.permUndo;
    var totalOn = 0, totalTools = 0, writeOn = 0;
    var rows = (usedSvcs || []).map(function (svc) {
      var tools = svc.tools || [];
      totalTools += tools.length;
      var chips = tools.map(function (t) {
        var st = toolState(a, svc, t, h);
        var isW = isWriteTool(svc, t);
        if (st === 'on') { totalOn++; if (isW) writeOn++; }
        var k = grantKey(a, svc, t);
        var undone = undo && undo.key === k;
        return '<span class="ptool' + (st === 'on' ? ' on' : '') + (isW ? ' is-write' : '') + '">' +
          '<button class="ptool-b" data-act="perm-tool" data-id="' + h.esc(k) + '|' + (st === 'on' ? 'off' : 'on') + '"' +
          ' title="' + (st === 'on' ? '已授权 · 点击收回（中风险：需确认）' : (isW ? '未授权 · 点击授权（高危：需填理由）' : '未授权 · 点击授权（低风险：即时生效）')) + '">' +
          (st === 'on' ? '✓ ' : '＋ ') + h.esc(t) + (isW ? ' <i class="ptool-w">写</i>' : '') + '</button>' +
          (undone ? '<button class="ptool-u" data-act="perm-undo" data-id="' + h.esc(k) + '" title="撤销刚才这次授权，回到上一个状态">撤销</button>' : '') +
          '</span>';
      }).join('');
      return '<div class="ptool-row" id="v34-svc-' + h.esc(svc.id) + '">' +
        '<div class="ptool-hd">' +
        '<span class="ptool-ico">' + h.icon(svc.icon || 'chip', 16) + '</span>' +
        '<b class="mono">' + h.esc(svc.name) + '</b>' +
        '<span class="ptool-src">' + h.esc(svc.purpose || '') + '</span>' +
        '<span class="pill ' + (svc.rw === 'write' ? 'warn' : '') + '">' + (svc.rw === 'write' ? '读写服务' : '只读服务') + '</span>' +
        '<span class="ptool-n">' + toolsOnOf(svc, a, h) + ' / ' + tools.length + ' 已授权</span>' +
        '</div>' +
        '<div class="ptool-chips">' + chips + '</div>' +
        '</div>';
    }).join('');

    return '<div class="card" id="v34-tools"><div class="card-h">' +
      '<h3>工具授权</h3>' +
      '<span class="card-sub">这个 Agent 能用哪些工具 · 点一下就能改</span>' +
      '<button class="btn-ghost sm" data-act="goto-cap" data-id="gateway" title="服务本身的启用/停用与配额在网关页（那是服务级，这里是 Agent 级）">服务级开关在网关 →</button>' +
      '</div>' +
      (rows || '<div class="bt-note">该 Agent 的编排里没有工具节点。</div>') +
      '<div class="text-row">' +
      '<span>已授权 <b>' + totalOn + '</b> / ' + totalTools + ' 个工具' + (writeOn ? '（含 <b class="bad">' + writeOn + '</b> 个写工具）' : '') + '</span>' +
      '</div>' +
      /* 风险分级写清在界面上：用户点之前就该知道这一下会不会弹理由框 */
      '<div class="bt-note">改授权的代价按风险分档：<b>只读工具</b>即时生效；' +
      '<b>写工具</b>要过一次确认并填写理由（高危动作不给"顺手就开"的机会）；' +
      '<b>收回</b>要确认影响面。授权是**本 Agent 级**的，不影响其它 Agent 与服务的全局开关。</div>' +
      /* 低风险改动的撤销入口（业主明确要求"提供撤销机制"）：只在刚改过时出现 */
      (undo && undo.kind === 'tool' ? '<div class="ptool-undo"><span>刚' + (undo.to === 'allow' ? '授权' : '收回') + '了 <b class="mono">' + h.esc(undo.tool) + '</b></span>' +
        '<button class="btn-ghost sm" data-act="perm-undo" data-id="' + h.esc(undo.key) + '">撤销这次改动</button></div>' : '') +
      '</div>';
  }
  function toolsOnOf(svc, a, h) {
    return (svc.tools || []).filter(function (t) { return toolState(a, svc, t, h) === 'on'; }).length;
  }

  /* ── ② 自动回滚条件（版本与发布页调用）────────────────────────────────────
     默认值取自 decisions.js 登记的那句规则（唯一真源），解析不出来才退回常量。 */
  function ruleDefault() {
    var out = { sr: 0.98, p99: 4000, on: false, from: 'decisions.js' };
    try {
      var D = global.DECISIONS;
      var s = D && D.value ? D.value('自进化', '自动回滚条件') : null;
      if (s) {
        var m1 = /成功率\s*<\s*([0-9.]+)\s*%/.exec(s);
        var m2 = /P99\s*>\s*([0-9.]+)\s*s/.exec(s);
        if (m1) out.sr = Number(m1[1]) / 100;
        if (m2) out.p99 = Number(m2[1]) * 1000;
      }
    } catch (e) { /* 取不到就用上面的常量，不静默 undefined */ }
    return out;
  }
  function ruleOf(state) { return (state && state.rollbackRule) || ruleDefault(); }
  function ruleLine(a, state, h) {
    var r = ruleOf(state), fmt = h.fmt;
    var undo = state && state.permUndo;
    return '<div class="gray-rules">自动回滚条件：' +
      '<b>成功率 &lt; ' + fmt.pct2(r.sr) + '</b> 或 <b>P99 &gt; ' + fmt.dur(r.p99) + '</b>' +
      (r.on ? ' <span class="pill warn">本会话已登记为启用</span>' : ' <span class="pill idle">未启用</span>') +
      '　<span class="rg-ctl">' +
      '<button class="btn-ghost sm" data-act="perm-rule-step" data-id="sr|0.005" title="收紧成功率阈值（低风险，即时生效）">成功率收紧</button>' +
      '<button class="btn-ghost sm" data-act="perm-rule-step" data-id="sr|-0.005" title="放宽成功率阈值（高风险，需填理由）">放宽</button>' +
      '<button class="btn-ghost sm" data-act="perm-rule-step" data-id="p99|-500" title="收紧 P99 阈值（低风险，即时生效）">P99 收紧</button>' +
      '<button class="btn-ghost sm" data-act="perm-rule-step" data-id="p99|500" title="放宽 P99 阈值（高风险，需填理由）">放宽</button>' +
      '<button class="btn-ghost sm" data-act="perm-rule-toggle">' + (r.on ? '取消启用登记' : '登记为启用') + '</button>' +
      (undo && undo.kind === 'rule' ? '<button class="btn-ghost sm" data-act="perm-undo" data-id="rule">撤销上次调整</button>' : '') +
      '</span></div>' +
      /* 2026-10-18（业主「自述腔」）：删掉"如实说明：本原型只把…不假装已接入执行"这种自我辩解，
         但**保留事实边界**——自动回滚确实只在这里登记、执行在流水线。事实照说，口气不解释。 */
      '<div class="bt-note"><b>收紧</b>即时生效，<b>放宽</b>需填理由；比例调整有 ' + minWatch() +
      ' 分钟最小观察期；回滚后不会自动重试灰度。自动回滚条件在这里登记（会话态），执行在发布流水线 —— ' +
      '要立即回滚，用上面的「立即回滚」。</div>';
  }
  function minWatch() {
    try {
      var D = global.DECISIONS;
      var v = D && D.value ? D.value('自进化', '灰度最小观察期') : null;
      if (v != null) return v;
    } catch (e) { /* 落空走下面的兜底 */ }
    return 60;
  }

  /* ── 动作 ──────────────────────────────────────────────────────────────── */
  /* 授权/收回一个工具。风险档由**权限点**决定（PERM_POINTS 的 risk 字段）。 */
  ACTIONS['perm-tool'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var svc = S.MCP_SERVICES.filter(function (x) { return x.id === p[1]; })[0];
    var a = S.AGENTS[S.idx.agent[h.state.agentId]];
    var tool = p[2], to = p[3] === 'on' ? 'allow' : 'deny';
    if (!svc || !a || !tool) { h.toast('工具或 Agent 不存在', 'bad'); return; }
    var win = UI();
    var isW = isWriteTool(svc, tool);
    var perm = to === 'allow' ? (isW ? 'agent:tool:grant:write' : 'agent:tool:grant') : 'agent:tool:revoke';
    var from = toolState(a, svc, tool, h) === 'on' ? '已授权' : '未授权';
    var key = grantKey(a, svc, tool);
    function commit(reason) {
      grantsOf(h)[key] = to;
      /* 撤销用的"上一个状态"：只看这一次改动，不累积历史（一条改动一次撤销机会） */
      h.state.permUndo = { kind: 'tool', key: key, tool: svc.name + ' · ' + tool, prev: to === 'allow' ? 'deny' : 'allow', to: to };
      h.toast((to === 'allow' ? '已授权：' : '已收回：') + svc.name + ' · ' + tool +
        '（可撤销）', 'ok');
      h.navigate({});
    }
    /* 低风险（只读授权）：过门禁后**即时生效** —— 业主明确要求"低风险可以立即保存"。
       门禁不过才走 dangerConfirm（它会渲染拒绝页）。 */
    if (to === 'allow' && !isW) {
      var chk = win.checkPerm ? win.checkPerm(perm) : { ok: true };
      if (chk && chk.ok) {
        commit(null);
        return;
      }
    }
    win.dangerConfirm(h, {
      title: (to === 'allow' ? '授权工具' : '收回工具授权'),
      desc: svc.name + ' · ' + tool + ' → ' + a.name,
      tone: isW && to === 'allow' ? 'danger' : 'warn',
      danger: !(isW && to === 'allow'),
      perm: perm,
      impacts: [
        { label: '工具', value: tool + (isW ? '（写动作）' : '（只读）'), tone: isW ? 'danger' : '' },
        { label: '变更', value: from + ' → ' + (to === 'allow' ? '已授权' : '未授权') },
        { label: '作用域', value: '仅本 Agent（' + a.name + '）；服务的全局开关在网关页' },
        { label: '风险档', value: to === 'allow' ? (isW ? '高危：写动作会改外部系统，需填理由' : '低风险：只读') : '中风险：会中断依赖该工具的节点' }
      ],
      onConfirm: function (reason) { commit(reason); }
    });
  };

  /* 撤销：把上一次改动改回去（低风险改动的回退入口；也顺带覆盖中/高风险的"反悔"）。 */
  ACTIONS['perm-undo'] = function (id, btn, h) {
    var u = h.state.permUndo;
    if (!u) { h.toast('没有可撤销的改动', 'info'); return; }
    if (u.kind === 'rule') {
      h.state.rollbackRule = u.prev;
    } else {
      grantsOf(h)[u.key] = u.prev;
    }
    h.state.permUndo = null;
    h.toast('已撤销，回到改动前状态', 'ok');
    h.navigate({});
  };

  /* 自动回滚条件的步进：方向决定风险档（收紧=低风险即时，放宽=高风险填理由）。 */
  ACTIONS['perm-rule-step'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var field = p[0] === 'p99' ? 'p99' : 'sr';
    var delta = Number(p[1] || 0);
    var cur = ruleOf(h.state);
    var next = { sr: cur.sr, p99: cur.p99, on: cur.on };
    next[field] = field === 'sr' ? Math.min(0.999, Math.max(0.80, Math.round((cur.sr + delta) * 1000) / 1000))
      : Math.min(20000, Math.max(500, cur.p99 + delta));
    if (next[field] === cur[field]) { h.toast('已经到边界了', 'info'); return; }
    /* 收紧 = 成功率阈值调高 或 P99 阈值调低 */
    var tighten = field === 'sr' ? next.sr > cur.sr : next.p99 < cur.p99;
    var win = UI();
    function commit(reason) {
      h.state.rollbackRule = next;
      h.state.permUndo = { kind: 'rule', prev: cur, tool: '自动回滚条件' };
      h.toast('自动回滚条件已更新为 ' + h.fmt.pct2(next.sr) + ' / ' + h.fmt.dur(next.p99) +
        '（可撤销）', 'ok');
      h.navigate({});
    }
    if (tighten) {
      var chk = win.checkPerm ? win.checkPerm('agent:rollback:rule') : { ok: true };
      if (chk && chk.ok) {
        commit(null);
        return;
      }
    }
    win.dangerConfirm(h, {
      title: '放宽自动回滚条件',
      desc: '把安全线往下挪 —— 出问题时更晚才会回滚。',
      tone: 'danger', perm: 'agent:rollback:rule',
      impacts: [
        { label: '变更', value: (field === 'sr' ? '成功率阈值' : 'P99 阈值') + '：' + (field === 'sr' ? h.fmt.pct2(cur.sr) + ' → ' + h.fmt.pct2(next.sr) : h.fmt.dur(cur.p99) + ' → ' + h.fmt.dur(next.p99)), tone: 'danger' },
        { label: '影响', value: '灰度期间若指标劣化，会更晚触发自动回滚（保护变弱）' },
        { label: '作用域', value: '全部灰度中的 Agent 发布（规则登记在 decisions 的口径上）' }
      ],
      onConfirm: function (reason) { commit(reason); }
    });
  };
  ACTIONS['perm-rule-toggle'] = function (id, btn, h) {
    var win = UI();
    var cur = ruleOf(h.state);
    var next = { sr: cur.sr, p99: cur.p99, on: !cur.on };
    function commit(reason) {
      h.state.rollbackRule = next;
      h.state.permUndo = { kind: 'rule', prev: cur, tool: '自动回滚条件' };
      h.toast(next.on ? '已登记为启用（仅登记，执行在流水线里）' : '已取消启用登记', 'ok');
      h.navigate({});
    }
    if (next.on) {
      win.dangerConfirm(h, {
        title: '登记启用自动回滚', desc: '把当前条件登记为该发布线的自动回滚规则。',
        tone: 'warn', perm: 'agent:rollback:rule',
        impacts: [{ label: '变更', value: '未启用 → 已登记启用' },
          { label: '如实说明', value: '本原型只登记规则；执行在发布流水线，页面上不会真的自动回滚' }],
        onConfirm: function (reason) { commit(reason); }
      });
    } else {
      var chk = win.checkPerm ? win.checkPerm('agent:rollback:rule') : { ok: true };
      if (chk && chk.ok) { commit(null); return; }
      win.dangerConfirm(h, { title: '取消启用自动回滚', tone: 'warn', perm: 'agent:rollback:rule', onConfirm: function (r) { commit(r); } });
    }
  };
  /* 「编辑草稿」原来是个死按钮（点了只弹"后续版本开放"）。现在它把人带到真正能编辑的地方：
     滚到工具授权卡并高亮一下。画布拖拽编辑仍是工程实现项，这一点不假装。 */
  ACTIONS['perm-goto-tools'] = function (id, btn, h) {
    var d = global.document;
    var el = d && d.getElementById ? d.getElementById('v34-tools') : null;
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('perm-flash');
      global.setTimeout(function () { el.classList.remove('perm-flash'); }, 1600);
      h.toast('能编辑的部分在这里：工具授权与策略（画布拖拽编辑仍属工程实现项）', 'info');
    } else {
      h.toast('工具授权卡在本页下方', 'info');
    }
  };

  global.V34PERM = {
    toolCard: toolCard,
    ruleLine: ruleLine,
    ruleOf: ruleOf,
    ruleDefault: ruleDefault,
    isWriteTool: isWriteTool,
    toolState: toolState,
    grantKey: grantKey
  };
})(window);
