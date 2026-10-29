/* SECTION: v27-session-store
 * Agent 会话存储（「会话与干预」Tab 的数据层）。
 *
 * ── 三层数据，来源分开写清楚（不混着糊）──────────────────────────
 *  ① **结构**（轮次 / 动作 / 耗时 / 状态 / traceId / 写动作）—— 真实：
 *     由该 Agent 的真实调用记录（Q.searchTraces）与真实链路（FACTS.getTrace）派生，
 *     外加 AGENT_TOPO 的节点、MCP_SERVICES 的读写声明。每个动作都能点回链路页。
 *  ② **对话文本**（用户说了什么、Agent 回了什么）—— **示例内容**：
 *     原型不接真实模型、也没有真实会话库，所以这部分是按该 Agent 的业务与它真实
 *     命中的意图/人群写死的示例文本。界面上逐处标注，不冒充真实记录。
 *  ③ **人的提示（hint）** —— 真实：用户自己输入，写 localStorage，刷新不丢；
 *     每条提示记录生效起点（"从第 N 轮起"），后续轮次据此显示「已按提示调整」。
 *
 * 为什么要存储：DSH 那套的关键不是"好看"，是**人给的提示真的进会话、agent 接着往下做**。
 * 没有存储，提示就只是 toast，关掉页面就没了 —— 那不是干预，是自言自语。
 * ────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS;
  var VERSION = 1;
  var KEY = 'aiops:v27:sessions:v' + VERSION;

  /* ---------- 持久层：只存"人改过的那部分"（提示 / 回滚 / 处置），基准会话每次重算 ----------
     这样刷新不会出现"半新半旧的脏会话"，也不用把整棵会话树序列化进 localStorage。 */
  var cache = null;
  function load() {
    if (cache) return cache;
    cache = { hints: [], rolled: {}, decided: {}, mode: {}, status: {}, cleared: {}, read: {} };
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.v === VERSION) {
          cache.hints = o.hints || [];
          cache.rolled = o.rolled || {};
          cache.decided = o.decided || {};
          cache.mode = o.mode || {};
          cache.status = o.status || {};
          cache.cleared = o.cleared || {};
          cache.read = o.read || {};
        }
      }
    } catch (e) { /* 存储不可用（隐私模式/配额）→ 退化成会话内存储，功能不消失 */ }
    return cache;
  }
  function save() {
    try {
      var c = load();
      (global.localStorage) && global.localStorage.setItem(KEY, JSON.stringify({
        v: VERSION, hints: c.hints, rolled: c.rolled, decided: c.decided, mode: c.mode, status: c.status, cleared: c.cleared, read: c.read
      }));
    } catch (e) { /* 同上 */ }
  }
  function reset() {
    cache = { hints: [], rolled: {}, decided: {}, mode: {}, status: {}, cleared: {}, read: {} };
    try { (global.localStorage) && global.localStorage.removeItem(KEY); } catch (e) { }
  }

  /* ---------- 示例对话文本（按 Agent 业务写死；界面逐处标注"示例内容"）---------- */
  function intentOf(agentId, i) {
    var rows = Q.searchTraces('24h', { agentId: agentId }, 1, 6).rows;
    return rows[i % Math.max(1, rows.length)] || null;
  }
  /* 客服助手这类"业务闭环型"Agent 的示例脚本：能演示"人给提示 → agent 继续做" */
  var SCRIPTS = {
    'ag-cs-refund': [
      { user: '今天先把 VIP 客户里超七天退货的那批挑出来，按 v2.3 的赔付口径回。',
        /* v32：思考文本 —— 意图拆解 / 取数范围 / 口径依据 / 不确定处。
           ReasoningRow 的折叠摘要取「最后一段已完成段落的首行」（照 DSH 源码），
           所以每段首行要能独立成句，最后一段写成结论式短句。 */
        reasoning: '先把这句话拆成三件事：筛选范围（VIP + 超七天退货）、动作（挑出来）、口径（v2.3 赔付）。\n\n' +
          '取数走 order.query + logistics.track：VIP 看会员等级，超七天按签收时间算 —— 未签收的单不能算进"超七天"，这类先剔掉。\n\n' +
          '口径依据是 v2.3 的售后细则：超七天赔付运费全额 + 商品 80%，且 500 元以下才可由我直接生成回复。\n\n' +
          '有一单签收时间是空的，我按"未签收"处理并单独列出，不混进那 6 单里。',
        assistant: '已拉取近 24 小时 VIP 的退货类请求，命中 6 单，其中 3 单超过七天。按 v2.3 口径：超七天赔付运费全额 + 商品 80%。我先只做核对，暂不外发。' },
      { user: '金额超过 500 的先别回，挂给我确认。',
        reasoning: '这条是在给上一步加约束：按金额把 6 单切开，500 是阈值。\n\n' +
          '已经生成好的 4 单回复不用撤回 —— 它们都在 500 以下，本来就允许直接回。\n\n' +
          '阈值正好等于 500 的单按"超过"从严处理，挂确认。',
        assistant: '收到。把 6 单按金额切开：2 单 ≥ ¥500 已挂成待确认，其余 4 单按口径生成回复。' },
      { user: '物流延迟那两单改成主动赔付运费，别等客户来催。',
        reasoning: '从"等客户催"改成"主动赔付"，这是流程语义变化，不只是话术变化。\n\n' +
          '先确认这两单确实满足延迟判定（物流轨迹超过 48 小时无更新），再走赔付的写动作。\n\n' +
          '写动作会改订单库，属高危，按规则要先确认。\n\n' +
          '所以顺序是：先校验判定 → 再写赔付 → 最后回执客户。',
        assistant: '已改为主动赔付：2 单各赔运费，并推送到客服工作台；对应工单已建。' },
      { user: '把这次的口径差异记到经验库里，下次直接复用。',
        reasoning: '要沉淀的是"口径差异"而不是整段对话：触发条件（VIP + 超七天退货）+ 处置策略（运费全额 + 商品 80%）。\n\n' +
          '这条只在当前业务线验证过，先登记为私有经验、提交复核，不直接升级为共享。',
        assistant: '已整理一条候选经验（触发条件：VIP + 超七天退货；策略：运费全额 + 商品 80%），提交复核。' }
    ]
  };
  function scriptFor(a, r) {
    var s = SCRIPTS[a.id];
    /* ⚠ 这是一个数组（一个 Agent 有 4 段示例脚本），必须按轮次取一条 ——
       直接返回数组会让 r.user/r.assistant 变成 undefined（轨迹页读 r.user 就炸）。 */
    if (s && s.length) return s[r % s.length];
    /* 其他 Agent：用真实意图/人群拼一句不含引号的"任务陈述"，并明确标注示例 */
    var it = intentOf(a.id, r);
    return {
      user: '处理一次「' + ((it && it.intentName) || '常规') + '」请求（' + ((it && it.segmentName) || '默认人群') + '，来自 ' + ((it && it.callerName) || 'Workflow') + '）。',
      assistant: '按 ' + a.name + ' 的编排执行：' + ((it && it.intentName) || '常规意图') + ' 链路跑完，结果已写回。'
    };
  }

  /* ---------- 基准会话：结构与动作全部来自真实数据 ---------- */
  var MAX_ROUNDS = 8;
  function buildRounds(a, limit) {
    var res = Q.searchTraces('24h', { agentId: a.id }, 1, limit);
    var rows = (res && res.rows) || [];
    var out = [];
    for (var i = rows.length - 1; i >= 0; i--) {          /* 老的在前：对话顺序 */
      var row = rows[i];
      var tr = F.getTrace(row.traceId);
      var spans = (tr && tr.spans) || [];
      var no = rows.length - i;
      var sc = scriptFor(a, out.length);
      var acts = spans.filter(function (sp) { return sp.kind !== 'end'; }).map(function (sp) {
        var m = sp.mcp ? mcpMeta(sp.mcp) : null;
        return {
          kind: sp.kind, name: sp.name, ms: sp.duration, status: sp.status,
          mcp: sp.mcp || null, model: sp.model || null,
          label: labelOf(sp, m), detail: m ? m.purpose + ' · ' + m.name : (sp.model ? '模型 ' + sp.model : ''),
          write: !!(m && m.rw === 'write'),
          error: sp.error ? { name: sp.error.name, http: sp.error.http } : null
        };
      });
      out.push({
        no: no, traceId: row.traceId, ts: row.ts, when: hhmm(row.ts),
        intentName: row.intentName, segmentName: row.segmentName, callerName: row.callerName, version: row.version,
        status: row.status, errCode: row.errCode, errName: row.errName,
        latencyMs: row.latencyMs, tokens: row.tokens, cost: row.cost,
        user: sc.user, assistant: sc.assistant, reasoning: sc.reasoning || null,
        actions: acts,
        writes: acts.filter(function (x) { return x.write && x.status === 'ok'; }),
        needHuman: needHuman(row.errCode)
      });
    }
    return out;
  }
  function mcpMeta(id) {
    for (var i = 0; i < S.MCP_SERVICES.length; i++) if (S.MCP_SERVICES[i].id === id) return S.MCP_SERVICES[i];
    return null;
  }
  function labelOf(sp, m) {
    if (sp.kind === 'tool') return '已调用工具';
    if (sp.kind === 'llm') return '已生成';
    if (sp.kind === 'guard') return '已执行合规检查';
    if (sp.kind === 'start') return '已接收请求';
    return '已' + sp.kind;
  }
  function needHuman(code) {
    if (!code) return false;
    for (var i = 0; i < S.ERROR_CODES.length; i++) if (S.ERROR_CODES[i].id === code) return S.ERROR_CODES[i].retryable === false;
    return false;
  }
  function hhmm(ts) { var d = new Date(ts); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }

  /* ---------- 对外 API ---------- */
  function currentSession(agentId) {
    var a = S.AGENTS[S.idx.agent[agentId]];
    if (!a) return null;
    var st = load();
    var rounds = buildRounds(a, MAX_ROUNDS);
    var hints = st.hints.filter(function (x) { return x.agentId === agentId; });
    /* 提示生效点：提示落在第 K 轮之后 → 第 K+1 轮起算"已按提示调整" */
    hints.forEach(function (hn) { hn.fromRound = (hn.afterRound || 0) + 1; });
    rounds.forEach(function (r) {
      r.hints = hints.filter(function (hn) { return hn.afterRound < r.no; });     /* 该轮之前给过的提示 */
      r.adjustedBy = hints.filter(function (hn) { return hn.afterRound < r.no; }).slice(-1)[0] || null;
      r.rolled = !!st.rolled[r.traceId];
    });
    return {
      id: 'se-' + agentId + '-cur', agentId: agentId, agentName: a.name,
      startedAt: rounds.length ? rounds[0].ts : S.NOW_TS,
      status: statusOf(agentId),
      rounds: rounds, hints: hints,
      lastRound: rounds.length ? rounds[rounds.length - 1].no : 0
    };
  }

  /** 追加一条人工提示：不打断 agent，作为"从下一轮起生效"的引导 */
  function addHint(agentId, text, kind, afterRound) {
    var st = load();
    var se = currentSession(agentId);
    var hn = {
      id: 'hn-' + agentId + '-' + (st.hints.length + 1),
      agentId: agentId, text: String(text || '').trim(), kind: kind || 'hint',
      afterRound: afterRound != null ? afterRound : (se ? se.lastRound : 0),
      at: Date.now(), by: (S.ME && S.ME.name) || '我'
    };
    st.hints.push(hn);
    save();
    return hn;
  }
  function hintsOf(agentId) { return load().hints.filter(function (x) { return x.agentId === agentId; }); }
  /* 权限模式用 DSH 的档位名（dsh-client-ui-permission-presets：仅可查看 / 工作区内修改 / 完全权限） */
  function setMode(agentId, mode) { load().mode[agentId] = mode; save(); }
  function modeOf(agentId) { return load().mode[agentId] || 'write'; }
  /* 会话状态与权限模式分开存：暂停/接管是"谁在做"，模式是"Agent 能做多少" —— 混成一个字段会互相覆盖 */
  function setStatus(agentId, st) { load().status[agentId] = st; save(); }
  function statusOf(agentId) { return load().status[agentId] || 'running'; }
  function clearFinished(agentId) { load().cleared[agentId] = 1; save(); }
  function isCleared(agentId) { return !!load().cleared[agentId]; }
  function markRolled(traceId) { load().rolled[traceId] = 1; save(); }
  function isRolled(traceId) { return !!load().rolled[traceId]; }
  function decide(agentId, itemId, decision) { load().decided[itemId] = decision; save(); }
  function decidedOf(itemId) { return load().decided[itemId] || null; }
  function markRead(agentId, no) { load().read[agentId + ':' + no] = 1; save(); }
  function isRead(agentId, no) { return !!load().read[agentId + ':' + no]; }

  global.SESSION_STORE = {
    VERSION: VERSION, KEY: KEY,
    current: currentSession, addHint: addHint, hints: hintsOf,
    setMode: setMode, modeOf: modeOf, setStatus: setStatus, statusOf: statusOf,
    clearFinished: clearFinished, isCleared: isCleared,
    markRolled: markRolled, isRolled: isRolled,
    decide: decide, decidedOf: decidedOf,
    markRead: markRead, isRead: isRead,
    reset: reset, _load: load,
    /* 给 UI 用的口径文案（一处写，界面直接用） */
    DATA_NOTE: '结构（轮次/动作/耗时/traceId）来自真实调用记录与链路；对话文本为示例内容（原型不接真实模型）；你的提示与处置是真存储（localStorage），刷新不丢。'
  };
})(window);
