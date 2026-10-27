/* SECTION: v28-session-engine
 * 会话引擎 —— 让「会话与干预」这一屏由**真实发生过的事件流**驱动，而不是每次渲染现编。
 *
 * ── 为什么要有它 ───────────────────────────────────────────────
 * 上一版的会话是"渲染期从调用记录推导 + 现写示例文本"：结构是真的，但**没有运行**，
 * 所以"给提示、agent 继续跑"只能靠标记演出来。这一版换成事件溯源（event sourcing）：
 *   · 一切状态来自一份 **append-only 事件日志**；界面只读日志，不自己造；
 *   · 引擎用**真时钟**推进：一轮里每个节点真的花掉那段时间（耗时 = 真实测量值，不是编的）；
 *   · steering 走 DSH 同款三步：accept（本地回显立刻可见）→ claim（领取）→ commit（落定，
 *     回显原子消失、进入下一轮计划），**当前轮不重启**；
 *   · 停止走两击式，会真的把在跑的节点标成 cancelled，并写 job/kill 事件；
 *   · 日志持久化（localStorage；配了 __SESSION_API 就走 HTTP），**刷新接着跑**。
 *
 * ── 事件形状（与真实会话后端的形状对齐，将来换后端＝换 transport，不改界面）──
 *   { seq, at, type, ...payload }
 *   session/start  { sessionId, agentId, plan }
 *   turn/start     { turnNo, traceId?, intentName, plan: [nodeId…] }
 *   node/start     { turnNo, nodeId, name, kind, mcp? , model? }
 *   node/end       { turnNo, nodeId, status: 'ok'|'failed'|'cancelled', ms }
 *   turn/end       { turnNo, status, ms, writes: [nodeId…] }
 *   steering/accept{ id, text, afterTurn, by }      ← 本地回显立刻可见
 *   steering/claim { id }
 *   steering/commit{ id, affectsTurn }              ← 回显原子消失，进下一轮计划
 *   plan/patch     { turnNo, drop: [nodeId…], reason: steeringId }  ← 提示真的改了后续计划
 *   job/kill       { turnNo, nodeId, by }
 *   status/set     { status }
 *   permission/set { mode }
 * ────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, Q = global.QUERY, F = global.FACTS;
  var VERSION = 2;
  var KEY = 'aiops:v28:session-log:v' + VERSION;
  var STEP_MS = 1400;                 /* 一个节点的"工作时长"（真时钟里真的走这么久） */

  /* ---------- 传输层：默认 localStorage；配了 __SESSION_API 就走 HTTP ---------- */
  var transport = {
    kind: 'local',
    read: function () {
      try {
        var raw = global.localStorage && global.localStorage.getItem(KEY);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return (o && o.v === VERSION) ? o : null;
      } catch (e) { return null; }
    },
    write: function (state) {
      try {
        (global.localStorage) && global.localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: VERSION }, state)));
      } catch (e) { /* 存储不可用就退化成会话内存，功能不消失 */ }
      if (global.__SESSION_API && global.fetch) {
        try { global.fetch(global.__SESSION_API + '/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) }); } catch (e) { }
      }
    },
    clear: function () { try { (global.localStorage) && global.localStorage.removeItem(KEY); } catch (e) { } }
  };


  /* ---------- Inbox（DSH §9.1.9：跨客户端顺序、去重、权威记录到达即替换本地回显） ----------
     三态：accepted（已接受，本地回显可见）→ claimed（已被某轮领取）→ projected（权威记录到达）。
     · 顺序：一律按 seq 先进先出领取（claim 取 seq 最小的 accepted）
     · 去重：同 id 重复提交直接忽略（跨客户端重复提交同一份提交身份）
     · 替换：宿主回执（hostAck）到达时把本地回显原子换掉 —— 此刻起以日志为准，回显消失 */
  function inboxAdd(st, id, text, mode) {
    var i;
    for (i = 0; i < st.inbox.length; i++) if (st.inbox[i].id === id) return null;   /* 去重 */
    var it = { id: id, text: text, mode: mode || 'steer', state: 'accepted', seq: ++st.seq, at: Date.now() };
    st.inbox.push(it);
    st.events.push({ seq: st.seq, at: it.at, type: 'inbox/accept', id: id, text: text, mode: it.mode });
    return it;
  }
  function inboxClaimNext(st) {
    var cand = st.inbox.filter(function (x) { return x.state === 'accepted'; })
      .sort(function (a, b) { return a.seq - b.seq; })[0];               /* 顺序：seq 最小先领 */
    if (!cand) return null;
    cand.state = 'claimed';
    st.events.push({ seq: ++st.seq, at: Date.now(), type: 'inbox/claim', id: cand.id });
    return cand;
  }
  function inboxProject(st, id, by) {
    var it = null, i;
    for (i = 0; i < st.inbox.length; i++) if (st.inbox[i].id === id) it = st.inbox[i];
    if (!it) {   /* 跨客户端：别的客户端的提交身份，本端没存过，也要按权威记录入档 */
      it = { id: id, text: '', mode: 'steer', state: 'accepted', seq: ++st.seq, at: Date.now() };
      st.inbox.push(it);
    }
    it.state = 'projected';
    /* 权威记录到达 → 本地回显**原子消失**：同步把对应的 steering 收口，
       否则界面还按 accepted/claimed 渲染那条回显（DSH：此刻起以权威记录为准） */
    st.steerings.forEach(function (x) {
      if (x.id === id && x.state !== 'committed') {
        x.state = 'committed'; x.affectsTurn = x.affectsTurn || null;
        /* 视图是从**事件**重算的（project()），所以必须补一条 steering/commit ——
           否则状态改了、投影还是按 accepted 渲染，回显不会消失（断言就是这么抓到的） */
        st.events.push({ seq: ++st.seq, at: Date.now(), type: 'steering/commit', id: id, affectsTurn: x.affectsTurn, by: by || 'host' });
      }
    });
    st.events.push({ seq: ++st.seq, at: Date.now(), type: 'inbox/projected', id: id, by: by || 'host' });
    return it;
  }

  /* ---------- 计划：从该 Agent 的**真实拓扑**派生这一轮要走的节点 ---------- */
  function planOf(a) {
    var topo = F.TOPO[F.AGENT_TOPO[a.id]] || F.TOPO['qa-rag'] || [];
    return topo.filter(function (n) { return n.kind !== 'end'; }).map(function (n) {
      var m = n.mcp ? mcpOf(n.mcp) : null;
      return { id: n.id, name: n.name, kind: n.kind, mcp: n.mcp || null, model: n.model || (n.kind === 'llm' ? a.model : null), rw: m ? m.rw : null };
    });
  }
  function mcpOf(id) {
    for (var i = 0; i < S.MCP_SERVICES.length; i++) if (S.MCP_SERVICES[i].id === id) return S.MCP_SERVICES[i];
    return null;
  }

  /* ---------- 状态：从日志**重放**出来（唯一的真相来源） ---------- */
  /* ---------- 展示模式（DSH chat-settings.ts:12 / :21 / :24）----------
     可选四档 = TRANSCRIPT_VIEW_MODES ['compact','standard','detailed','verbose']；
     'normal'（旧两档代）与 'expanded'（旧的第四档名）都只是**只能读、不再写回**的历史值，
     读到就按 'detailed' 解释（LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE 的读映射）。
     ⚠ 源码里**没有**任何"条数阈值"常量（不是 1/3/5/99），折叠是布尔策略，见 presentation-policy.ts:28-57。 */
  var TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'];
  var LEGACY_TRANSCRIPT_VIEW_MODES = { normal: 'detailed', expanded: 'detailed' };
  function normalizeDisplayMode(m) {
    var s = String(m == null ? '' : m);
    if (TRANSCRIPT_VIEW_MODES.indexOf(s) >= 0) return s;
    if (LEGACY_TRANSCRIPT_VIEW_MODES[s]) return LEGACY_TRANSCRIPT_VIEW_MODES[s];   /* 旧值只读 */
    return 'standard';
  }
  /* 由展示模式派生的能力位（presentation-policy.ts:28-57 的四档取值，一字不差） */
  var PRESENTATION_POLICIES = {
    compact:  { foldCompletedTurns: true,  stepGrouping: 'collapsed', liveProcessDetail: false, settledReasoningPreview: false },
    standard: { foldCompletedTurns: true,  stepGrouping: 'collapsed', liveProcessDetail: true,  settledReasoningPreview: true },
    detailed: { foldCompletedTurns: true,  stepGrouping: 'history',   liveProcessDetail: true,  settledReasoningPreview: true },
    verbose:  { foldCompletedTurns: false, stepGrouping: 'none',      liveProcessDetail: false, settledReasoningPreview: true }
  };
  function policyOf(m) { return PRESENTATION_POLICIES[normalizeDisplayMode(m)]; }
  function emptyState(agentId) {
    return { agentId: agentId, seq: 0, events: [], turns: [], steerings: [], inbox: [], inputs: [], queue: [], status: 'running', mode: 'write', delivery: 'steer', displayMode: 'standard', sessionId: 'se-' + agentId + '-' + Date.now().toString(36) };
  }
  function replay(agentId) {
    var st = transport.read();
    if (!st || st.agentId !== agentId) return null;
    return st;
  }
  /** 把事件流折成界面要用的结构：轮次、进行中的节点、待领取/已落定的 steering */
  function project(st) {
    var out = { turns: [], active: null, steerings: st.steerings.slice(), inputs: (st.inputs || []).slice(), queue: (st.queue || []).slice(), inbox: (st.inbox || []).slice(), status: st.status, mode: st.mode, delivery: st.delivery || 'steer', displayMode: normalizeDisplayMode(st.displayMode), sessionId: st.sessionId };
    st.events.forEach(function (e) {
      if (e.type === 'turn/start') {
        /* inputId：这一轮由哪条用户输入触发（send() 里记在 turn/start 事件上）。
           UI 靠它把"用户自己说的话"渲染成该轮的气泡 —— 追加的内容因此能随事件日志一起
           持久化、刷新后仍挂在正确的那一轮上。 */
        out.turns.push({ no: e.turnNo, intentName: e.intentName, traceId: e.traceId || null, userId: e.inputId || null, startedAt: e.at, status: 'running', nodes: [], live: true });
        out.active = out.turns[out.turns.length - 1];
      } else if (e.type === 'node/start' && out.active) {
        out.active.nodes.push({ id: e.nodeId, name: e.name, kind: e.kind, mcp: e.mcp || null, model: e.model || null, rw: e.rw || null, startedAt: e.at, status: 'running', ms: null });
      } else if (e.type === 'node/end' && out.active) {
        var n = pick(out.active.nodes, e.nodeId);
        if (n) { n.status = e.status; n.ms = e.ms; n.endedAt = e.at; }
      } else if (e.type === 'plan/patch' && out.active) {
        out.active.patch = { drop: e.drop || [], reason: e.reason || null, at: e.at };
      } else if (e.type === 'turn/end') {
        var t = pick(out.turns, e.turnNo, 'no');
        if (t) { t.status = e.status; t.ms = e.ms; t.endedAt = e.at; t.writes = e.writes || []; t.running = false; }
        out.active = null;
      } else if (e.type === 'steering/accept') {
        var hn = pick(out.steerings, e.id, 'id');
        if (hn) { hn.state = 'accepted'; hn.acceptedAt = e.at; }
      } else if (e.type === 'steering/claim') {
        var h2 = pick(out.steerings, e.id, 'id'); if (h2) h2.state = 'claimed';
      } else if (e.type === 'steering/commit') {
        var h3 = pick(out.steerings, e.id, 'id'); if (h3) { h3.state = 'committed'; h3.affectsTurn = e.affectsTurn; }
      } else if (e.type === 'job/kill' && out.active) {
        out.active.killedAt = e.at;
      }
    });
    return out;
  }
  function pick(arr, v, k) {
    for (var i = 0; i < arr.length; i++) if ((k ? arr[i][k] : arr[i].id) === v) return arr[i];
    return null;
  }
  /** 轮号**从事件流里数**（不另存计数器：日志是唯一真相，重放/续跑不会错位） */
  function turnCount(st) {
    var n = 0;
    for (var i = 0; i < st.events.length; i++) if (st.events[i].type === 'turn/start') n++;
    return n;
  }

  /* ---------- 引擎：真时钟推进（tick 可显式调用，便于测试） ---------- */
  var engine = {
    st: null,
    /** 开一个会话：把该 Agent 最近几轮**真实调用记录**作为历史，然后开始实时跑 */
    open: function (a, opts) {
      opts = opts || {};
      var st = replay(a.id);
      if (!st) {
        st = emptyState(a.id);
        /* 历史：取自真实调用记录（traceId 可点回链路），标 live:false */
        var rows = Q.searchTraces('24h', { agentId: a.id }, 1, opts.history || 3).rows;
        rows.reverse().forEach(function (row, i) {
          var tr = F.getTrace(row.traceId);
          var nodes = ((tr && tr.spans) || []).filter(function (sp) { return sp.kind !== 'end'; }).map(function (sp) {
            var m = sp.mcp ? mcpOf(sp.mcp) : null;
            return { id: sp.id, name: sp.name, kind: sp.kind, mcp: sp.mcp || null, model: sp.model || null, rw: m ? m.rw : null, status: sp.status === 'failed' ? 'failed' : 'ok', ms: sp.duration };
          });
          /* v27：回放的历史事件必须**整轮**带 historical 标记。
             此前只有 turn/end 打了这个标记，它的 node/start、node/end 没有 ——
             消费方就无法区分「历史里那次失败」与「本轮真的失败了」，
             实测导致断言「没有凭空造出失败态」误报（历史节点的 failed 被算成本轮）。
             语义上 historical 修饰的是整轮，不该只落在最后一个事件上。 */
          st.events.push({ seq: ++st.seq, at: row.ts, type: 'turn/start', turnNo: i + 1, intentName: row.intentName, traceId: row.traceId, historical: true });
          nodes.forEach(function (n) { st.events.push({ seq: ++st.seq, at: row.ts, type: 'node/start', turnNo: i + 1, nodeId: n.id, name: n.name, kind: n.kind, mcp: n.mcp, model: n.model, rw: n.rw, historical: true }); });
          nodes.forEach(function (n) { st.events.push({ seq: ++st.seq, at: row.ts + (n.ms || 0), type: 'node/end', turnNo: i + 1, nodeId: n.id, status: n.status, ms: n.ms, historical: true }); });
          st.events.push({ seq: ++st.seq, at: row.ts + row.latencyMs, type: 'turn/end', turnNo: i + 1, status: row.status, ms: row.latencyMs, writes: nodes.filter(function (n) { return n.rw === 'write' && n.status === 'ok'; }).map(function (n) { return n.id; }), historical: true });
        });
        /* 播进来的历史轮数（落进状态里，供界面区分"历史轮"与"用户刚追加的轮"）。
           ⚠ 界面不能用 traceId 去认亲：同一个 Agent 的同一条意图会被重新跑，
           真实调用记录里就有重复 traceId —— 用 traceId 判重会把追加轮当历史轮吃掉。
           也不能用 store 的轮数当这个数：那是另一条真相源（8 轮历史 vs 这里播 2 轮）。 */
        st.historyOpened = rows.length;
        transport.write(st);
      }
      engine.st = st;
      return st;
    },
    /** 推进：把"当前该发生的事"写进日志。真时钟下由 start() 定时调用 */
    tick: function (nowMs) {
      var st = engine.st; if (!st) return null;
      var now = nowMs == null ? Date.now() : nowMs;
      var p = project(st);
      if (st.status !== 'running') return st;
      if (!p.active) {
        /* 该开新一轮了：计划 = 真实拓扑 − 上一条 steering 要求丢弃的节点 */
        var a = S.AGENTS[S.idx.agent[st.agentId]]; if (!a) return st;
        var plan = planOf(a);
        var pendingSteer = st.steerings.filter(function (x) { return x.state === 'accepted' || x.state === 'claimed'; })[0] || null;
        var drop = [];
        if (pendingSteer) {
          /* 真实语义：人说过"先别动手" → 写动作节点从这一轮计划里摘掉（不是标记，是不做） */
          if (/别|不要|先别|暂不|等我|确认/.test(pendingSteer.text)) drop = plan.filter(function (n) { return n.rw === 'write'; }).map(function (n) { return n.id; });
        }
        var turnNo = turnCount(st) + 1;
        var _in = st._pendingInput || null; delete st._pendingInput;
        var _inId = st._pendingInputId || null; delete st._pendingInputId;
        st.events.push({ seq: ++st.seq, at: now, type: 'turn/start', turnNo: turnNo, intentName: plan.length ? plan[0].name : '—', input: _in, inputId: _inId });
        if (pendingSteer) {
          inboxClaimNext(st);
          st.events.push({ seq: ++st.seq, at: now, type: 'steering/claim', id: pendingSteer.id });
          if (drop.length) st.events.push({ seq: ++st.seq, at: now, type: 'plan/patch', turnNo: turnNo, drop: drop, reason: pendingSteer.id });
        }
        st._plan = plan.filter(function (n) { return drop.indexOf(n.id) < 0; });
        st._drop = drop;
        transport.write(st);
        return st;
      }
      var act = p.active;
      var running = act.nodes.filter(function (n) { return n.status === 'running'; })[0];
      var plan = st._plan || [];
      if (running) {
        /* 一个节点干完了：耗时 = 真时钟差值 */
        var ms = Math.max(1, now - running.startedAt);
        var failed = running.kind === 'tool' && /失败|超时/.test('') ;   /* 保留：不编造失败 */
        st.events.push({ seq: ++st.seq, at: now, type: 'node/end', turnNo: act.no, nodeId: running.id, status: failed ? 'failed' : 'ok', ms: ms });
        transport.write(st);
        return st;
      }
      var done = act.nodes.map(function (n) { return n.id; });
      var next = null;
      for (var i = 0; i < plan.length; i++) { if (done.indexOf(plan[i].id) < 0) { next = plan[i]; break; } }
      if (next) {
        st.events.push({ seq: ++st.seq, at: now, type: 'node/start', turnNo: act.no, nodeId: next.id, name: next.name, kind: next.kind, mcp: next.mcp, model: next.model, rw: next.rw });
        transport.write(st);
        return st;
      }
      /* 计划走完 → 收轮 */
      var writes = act.nodes.filter(function (n) { return n.rw === 'write' && n.status === 'ok'; }).map(function (n) { return n.id; });
      var ms2 = Math.max(1, now - act.startedAt);
      st.events.push({ seq: ++st.seq, at: now, type: 'turn/end', turnNo: act.no, status: 'success', ms: ms2, writes: writes });
      /* 该轮的 steering 落定：回显原子消失。affectsTurn = **它真正改过计划的那一轮** ——
         引导是在 act.no 这一轮开头被 claim、并用 plan/patch 改掉该轮计划的，
         所以它影响的是 act.no（写成 act.no+1 会把轮次指错一格）。 */
      st.steerings.filter(function (x) { return x.state === 'claimed'; }).forEach(function (x) {
        st.events.push({ seq: ++st.seq, at: now, type: 'steering/commit', id: x.id, affectsTurn: act.no });
        inboxProject(st, x.id, 'host');
      });
      delete st._plan; delete st._drop;
      transport.write(st);
      engine.flushQueue();          /* 空闲即把排队消息投出去（DSH 行为） */
      return st;
    },
    start: function (intervalMs) {
      engine.stop();
      engine._timer = (global.setInterval || setInterval)(function () { engine.tick(); }, intervalMs || STEP_MS);
      return engine._timer;
    },
    stop: function () { if (engine._timer) { (global.clearInterval || clearInterval)(engine._timer); engine._timer = null; } },
    /** 投递：按 DSH 的规则决定落点（空闲→正文；繁忙+queue→排队坞；繁忙+steer→插话）
     *  @param mode 'steer' | 'queue' —— 由 composer 的当前设置给出；互补模式由快捷键切换 */
    send: function (text, mode, by) {
      var st = engine.st; if (!st) return null;
      text = String(text || '').trim(); if (!text) return null;
      var p = project(st);
      var busy = !!p.active && st.status === 'running';
      if (!busy) {
        /* 空闲：直接进正文并开一轮（输入就是你说的话） */
        var id0 = 'in-' + (st.inputs.length + 1);
        st.inputs.push({ id: id0, text: text, at: Date.now(), by: by || (S.ME && S.ME.name) || '我', mode: 'direct' });
        st.events.push({ seq: ++st.seq, at: Date.now(), type: 'input/accept', id: id0, text: text, mode: 'direct' });
        st._pendingInput = text;
        /* 把输入 id 一路带到 turn/start 事件上：这一轮的气泡文案因此可从日志还原 */
        st._pendingInputId = id0;
        transport.write(st);
        return { placed: 'transcript', id: id0 };
      }
      if (mode === 'queue') {
        var idq = 'q-' + (st.queue.length + 1);
        st.queue.push({ id: idq, text: text, state: 'queued', at: Date.now(), by: by || (S.ME && S.ME.name) || '我' });
        st.events.push({ seq: ++st.seq, at: Date.now(), type: 'queue/add', id: idq, text: text });
        transport.write(st);
        return { placed: 'queue', id: idq };      /* 排队中的消息**不进入 Chat** */
      }
      var id = engine.steer(text, by);
      return { placed: 'steering', id: id };
    },
    removeQueued: function (id) {
      var st = engine.st; if (!st) return null;
      st.queue = st.queue.filter(function (x) { return x.id !== id; });
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'queue/remove', id: id });
      transport.write(st);
      return st;
    },
    editQueued: function (id, text) {
      var st = engine.st; if (!st) return null;
      st.queue.forEach(function (x) { if (x.id === id) x.text = String(text || ''); });
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'queue/edit', id: id, text: String(text || '') });
      transport.write(st);
      return st;
    },
    /** 排队 → 插话：升格到可抢跑的位置（QueueDock 行的 Steer 操作） */
    promoteQueued: function (id) {
      var st = engine.st; if (!st) return null;
      var it = null;
      st.queue.forEach(function (x) { if (x.id === id) it = x; });
      if (!it) return null;
      st.queue = st.queue.filter(function (x) { return x.id !== id; });
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'queue/promote', id: id });
      engine.steer(it.text);
      return st;
    },
    /** 会话空闲时把队首发出去（DSH：Agent 一空闲，排队消息自动投递，且失败会移除回显并报错） */
    flushQueue: function () {
      var st = engine.st; if (!st) return null;
      var p = project(st);
      if (p.active) return null;
      var it = st.queue[0]; if (!it) return null;
      it.state = 'sending';
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'queue/sending', id: it.id });
      st.queue = st.queue.slice(1);
      st._pendingInput = it.text;
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'input/accept', id: it.id, text: it.text, mode: 'queue' });
      transport.write(st);
      return it;
    },
    /** 中途引导：accept 立刻写（本地回显立刻可见），claim 在下一轮开始时发生 */
    steer: function (text, by, clientId) {
      var st = engine.st; if (!st) return null;
      /* 提交身份由**客户端**给出（DSH：去重按提交身份，不是按文本）——
         同一个 id 重复提交（重试/回显）只算一次；不传则本地生成。 */
      var id = clientId || ('st-' + (st.steerings.length + 1));
      if (st.inbox.some(function (x) { return x.id === id; })) return id;   /* 去重：已存在直接返回 */
      var lastTurn = turnCount(st);
      inboxAdd(st, id, String(text || '').trim(), 'steer');
      st.steerings.push({ id: id, text: String(text || '').trim(), by: by || (S.ME && S.ME.name) || '我', afterTurn: lastTurn, state: 'accepted', at: Date.now() });
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'steering/accept', id: id, text: text, afterTurn: lastTurn });
      transport.write(st);
      return id;
    },
    kill: function (by) {
      var st = engine.st; if (!st) return null;
      var p = project(st);
      if (!p.active) return null;
      var running = p.active.nodes.filter(function (n) { return n.status === 'running'; })[0];
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'job/kill', turnNo: p.active.no, nodeId: running ? running.id : null, by: by || (S.ME && S.ME.name) || '我' });
      if (running) st.events.push({ seq: ++st.seq, at: Date.now(), type: 'node/end', turnNo: p.active.no, nodeId: running.id, status: 'cancelled', ms: Math.max(1, Date.now() - running.startedAt) });
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'turn/end', turnNo: p.active.no, status: 'killed', ms: Math.max(1, Date.now() - p.active.startedAt), writes: [] });
      st.status = 'paused';
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'status/set', status: 'paused' });
      transport.write(st);
      return st;
    },
    setStatus: function (status) {
      var st = engine.st; if (!st) return null;
      st.status = status;
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'status/set', status: status });
      transport.write(st);
      return st;
    },
    /** 宿主回执：权威记录到达 → 本地回显原子替换（多客户端里另一端也能看到） */
    hostAck: function (id) {
      var st = engine.st; if (!st) return null;
      inboxProject(st, id);
      transport.write(st);
      return st;
    },
    setDelivery: function (d) {
      var st = engine.st; if (!st) return null;
      st.delivery = d === 'queue' ? 'queue' : 'steer';
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'delivery/set', delivery: st.delivery });
      transport.write(st); return st;
    },
    setDisplay: function (m) {
      var st = engine.st; if (!st) return null;
      /* 只写回当前四档；旧值（normal / expanded）读进来时按 detailed 解释，但不再写回 */
      st.displayMode = TRANSCRIPT_VIEW_MODES.indexOf(String(m)) >= 0 ? String(m) : normalizeDisplayMode(m);
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'display/set', mode: st.displayMode });
      transport.write(st); return st;
    },
    setMode: function (mode) {
      var st = engine.st; if (!st) return null;
      st.mode = mode;
      st.events.push({ seq: ++st.seq, at: Date.now(), type: 'permission/set', mode: mode });
      transport.write(st);
      return st;
    },
    reset: function () { transport.clear(); engine.stop(); engine.st = null; },
    /* 对外只读视图 */
    view: function () { return engine.st ? project(engine.st) : null; },
    /* 播进来的历史轮数：界面靠它把"引擎里播的历史轮"与"用户刚追加的轮"分开
       （不能用 traceId 判重：同一意图会被重跑，真实记录里就有重复 traceId）。 */
    historyOpened: function () { return engine.st && engine.st.historyOpened != null ? Number(engine.st.historyOpened) : -1; },
    log: function () { return engine.st ? engine.st.events.slice() : []; }
  };

  global.SESSION_ENGINE = {
    VERSION: VERSION, KEY: KEY, STEP_MS: STEP_MS,
    /* 展示模式的真实枚举与能力位（给界面/断言用；单一事实来源在 chat-settings.ts:12 与 presentation-policy.ts:28-57） */
    TRANSCRIPT_VIEW_MODES: TRANSCRIPT_VIEW_MODES,
    LEGACY_TRANSCRIPT_VIEW_MODES: LEGACY_TRANSCRIPT_VIEW_MODES,
    normalizeDisplayMode: normalizeDisplayMode,
    policyOf: policyOf,
    open: engine.open, tick: engine.tick, start: engine.start, stop: engine.stop,
    steer: engine.steer, send: engine.send, kill: engine.kill, setStatus: engine.setStatus, setMode: engine.setMode,
    setDelivery: engine.setDelivery, setDisplay: engine.setDisplay,
    hostAck: engine.hostAck, inboxOf: function () { return engine.st ? engine.st.inbox.slice() : []; },
    removeQueued: engine.removeQueued, editQueued: engine.editQueued, promoteQueued: engine.promoteQueued, flushQueue: engine.flushQueue,
    reset: engine.reset, view: engine.view, log: engine.log, project: project, planOf: planOf,
    /* 界面区分"引擎播进来的历史轮"与"用户刚追加的轮"要用它（见 v27 liveRounds 的注释） */
    historyOpened: engine.historyOpened,
    transport: transport
  };
})(window);
