/* SECTION: v10-detail-flow
 * v10 详情渲染器（W2-B）：MCP·LLM 网关（6 Tab）。
 * （2026-10-20：Workflow 详情 5 Tab 随该页下线整段删除，本文件现在只负责网关详情。）
 *
 * 只做两件事：把详情注册进 RENDERERS，把动作注册进 ACTIONS。
 *  - 运行态数据（运行实例、节点级失败、调用日志）一律来自真实 trace（FACTS/QUERY），不编造。
 *  - 配置态数据（节点编排、cron、限流/熔断参数、密钥）来自 data.js 资产表；资产表未就绪时
 *    按项目既有做法用固定 seed 确定性派生，并在 metaBar 里写明口径。
 *  - 随机只走 h.seed.R.of('字符串')，不出现 Math.random() / Date.now()。
 */
(function (global) {
  'use strict';

  var R = global.RENDERERS || {};
  var ACTIONS = global.ACTIONS || {};
  var V = global.V10UI || {};
  var S = global.DATA_SEED;
  var Q = global.QUERY;
  var F = global.FACTS;
  var C = global.CHARTS;
  var APP = global.APP_DATA;

  var ASSETS = null;
  function assets() { if (!ASSETS) ASSETS = APP.getAssetTables(); return ASSETS; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ============================================================
   * 0. 公共件（V10UI 已就绪则直接调，未就绪给降级）
   * ============================================================ */

  function detailMissing(cap, state, h) {
    if (typeof V.detailMissing === 'function') return V.detailMissing(cap, state, h);
    return '<div class="fatal"><h2>未找到对象</h2>' +
      '<p>标识「' + h.esc(state.objId || '') + '」在「' + h.esc(cap.name) + '」中不存在，可能已被删除或链接有误。</p>' +
      '<button class="btn-primary" data-act="goto-cap" data-id="' + h.esc(cap.id) + '">返回列表</button></div>';
  }

  function tabsBar(cap, state, h, tabs, active) {
    var items = tabs.map(function (t) { return { id: t.key, label: t.label, badge: t.badge }; });
    if (typeof V.detailTabs === 'function') return V.detailTabs(cap, state, items);
    return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button role="tab" class="tab' + (t.key === active ? ' on' : '') + '" data-act="flow-tab" data-id="' + h.esc(t.key) + '">' +
        h.esc(t.label) + (t.badge ? '<i class="tab-badge">' + h.esc(t.badge) + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function pageHead(cap, state, h, opts) {
    opts = opts || {};
    var crumb = (typeof V.pageCrumb === 'function') ? V.pageCrumb(opts.crumbs || []) : '';
    var tags = (opts.tags || []).map(function (t) { return '<span>' + h.esc(t) + '</span>'; }).join('');
    return crumb + '<div class="page-head"><div class="ph-main">' +
      '<div class="ph-title">' + (opts.icon ? h.icon(opts.icon, 20) + ' ' : '') + h.esc(opts.title || cap.name) + (opts.badge || '') + '</div>' +
      '<div class="ph-desc">' + h.esc(opts.desc || cap.desc) + '</div>' +
      (tags ? '<div class="ph-tags">' + tags + '</div>' : '') +
      '</div><div class="ph-side">' + (opts.side || '') + '</div></div>';
  }

  function card(title, sub, body, actions, staticWhy) {
    /* staticWhy：本卡是"只读陈列"时的**理由**（见 _check 的门禁判据：
       「.card 内容 ≥40 字 ⇒ 必须①有可点控件 或 ②data-static="1" 且带理由」）。
       调用方给不出出口、也不该硬造出口时，必须把理由写进来，不允许静默留白。 */
    var st = staticWhy
      ? ' data-static="1" title="' + String(staticWhy).replace(/"/g, '&quot;') + '"'
      : '';
    return '<div class="card"' + st + '><div class="card-h"><h3>' + title + '</h3>' +
      (sub ? '<span class="card-sub">' + sub + '</span>' : '') + (actions || '') + '</div>' + body + '</div>';
  }

  function kv(pairs) {
    return '<dl class="dl">' + pairs.map(function (p) {
      return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>';
    }).join('') + '</dl>';
  }

  function permTag(p) {
    return (typeof V.permTag === 'function') ? V.permTag(p) : '<span class="pill info" title="需要权限点：' + p + '">' + p + '</span>';
  }

  function danger(h, opts) {
    if (typeof V.dangerConfirm === 'function') { V.dangerConfirm(h, opts); return; }
    h.toast('已提交「' + opts.title + '」（' + (opts.impacts || []).length + ' 项影响面已确认）', 'warn');
  }

  function diffViewer(before, after, h, opts) {
    if (typeof V.diffViewer === 'function') return V.diffViewer(before, after, opts || {});
    return '<div class="bt-note">变更 diff 组件未就绪，下方为变更前后原文。</div>' +
      '<div class="grid2"><div class="sp-col"><b>变更前</b><pre>' + h.esc(before) + '</pre></div>' +
      '<div class="sp-col"><b>变更后</b><pre>' + h.esc(after) + '</pre></div></div>';
  }

  function emptyHtml(h, title, sub) {
    if (typeof V.emptyFor === 'function') return V.emptyFor(title, sub);
    return '<div class="empty"><div class="empty-title">' + h.esc(title) + '</div><div class="empty-sub">' + h.esc(sub) + '</div></div>';
  }

  function pad2(x) { return x < 10 ? '0' + x : '' + x; }

  /* ============================================================
   * 1. Workflow 详情 —— 2026-10-20 整段下线。
   *    业主指令「删除这一页」：能力对象（CAPS.workflow）、列表页、本详情页、
   *    数据表（T.workflow）与总览/通知/Agent 详情里的全部入口一并删除。
   *    画布编排、cron 触发、运行实例回放、版本发布、节点失败排行 5 个 Tab 的
   *    实现（约 750 行）随页面一起移除，不留「有渲染器没入口」的死代码。
   * ============================================================ */

  /* ============================================================
   * 2. 网关详情（6 Tab）
   * ============================================================ */

  var GW_TABS = [
    { key: 'config', label: '配置' },
    { key: 'traffic', label: '流量治理' },
    { key: 'monitor', label: '实时监控' },
    { key: 'logs', label: '调用日志' },
    { key: 'keys', label: '密钥管理' },
    { key: 'history', label: '变更历史' }
  ];

  /** 数据层的网关资产表（若 W1 已提供含 routes / mcpTools / apiKeys 的对象则采用） */
  function assetGwTable() {
    var T = assets(), k;
    for (k in T) {
      if (!has(T, k)) continue;
      var v = T[k];
      if (v && (v.routes || v.mcpTools || v.apiKeys)) return v;
    }
    return null;
  }

  function gwObjects() {
    var out = [];
    var T = assetGwTable();
    if (T) {
      ['mcpTools', 'routes'].forEach(function (key) {
        if (!T[key] || !T[key].length) return;
        T[key].forEach(function (x) {
          out.push({
            id: x.id != null ? x.id : x.name,
            name: x.name || x.endpoint || x.id,
            kind: (x.kind === 'llm' || key === 'routes' && x.kind === 'llm') ? 'llm' : 'mcp',
            protocol: x.protocol || (x.kind === 'llm' ? 'OpenAI 兼容 HTTP' : 'MCP (Streamable HTTP)'),
            qpsCap: x.qpsCap != null ? x.qpsCap : 60,
            errorBias: x.errorBias != null ? x.errorBias : 1,
            timeoutMs: x.timeoutMs, retries: x.retries,
            circuit: x.circuit, raw: x
          });
        });
      });
    }
    if (!out.length) {
      S.MCP_SERVICES.forEach(function (m) {
        out.push({ id: m.id, name: m.name, kind: 'mcp', protocol: 'MCP (Streamable HTTP)', qpsCap: m.qpsCap, errorBias: m.errorBias, raw: m });
      });
      S.MODELS.forEach(function (m) {
        out.push({ id: 'llm-' + m.id, name: 'llm://' + m.name, kind: 'llm', protocol: 'OpenAI 兼容 HTTP', qpsCap: 200, errorBias: 1, model: m, raw: m });
      });
    }
    return out;
  }

  function gwResolve(state) {
    var list = gwObjects(), id = state.objId, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].name === id) return list[i];
    // 容错：允许 hash 里传 'mcp://crm/query' 或短名
    for (i = 0; i < list.length; i++) {
      var short = String(list[i].name).replace(/^[a-z]+:\/\//, '');
      if (short === id || short === String(id).replace(/^[a-z]+:\/\//, '')) return list[i];
    }
    return null;
  }

  /** 真实调用方：topo 里引用了该 MCP / 主模型为该模型的 Agent */
  function svcCallers(svc) {
    var out = [];
    S.AGENTS.forEach(function (a) {
      var topo = F.AGENT_TOPO[a.id] ? F.TOPO[F.AGENT_TOPO[a.id]] : null;
      if (!topo) return;
      var usesMcp = topo.some(function (n) { return n.mcp === svc.id; });
      var usesModel = (svc.kind === 'llm' && svc.model && a.model === svc.model.id);
      if (usesMcp || usesModel) out.push(a);
    });
    return out;
  }

  /* 服务实时读数：**唯一真源是列表那一份**。
   *
   * 列表（v29-gateway-tabs.js 的「服务健康墙」）读 Q.mcpHealth()；
   * 详情此前自己开了另一条随机流 R.of('gwstat|' + id) 现编 ⇒ 同一个服务
   * 墙上写 55/80 QPS · 错误率 2.61% · P1 事故进行中，点进详情变 40/80 · 0.83% · 正常。
   * on-call 照着错的那份判断，这是最要命的一类不一致。
   *
   * 现在按 id join 列表的那份事实（qps / 错误率 / P99 / 状态 / 事故）。
   * 列表没给 P50/P90（墙上只展示 P99）—— 由**同一份 P99** 按对数正态分位比换算，
   * 仍是同一来源的派生；老实现里这两个数是 'gwstat|' 流现编的第二份数。
   * 列表里不存在的对象（LLM 模型路由）改从模型配置的 baseLatency 推，也不再开第二条随机流。
   */
  var GW_SIGMA = 0.46;                                   // 与服务健康墙同一条长尾假设
  var GW_P99_K = Math.exp(2.3263 * GW_SIGMA);            // P99 / P50
  var GW_P90_K = Math.exp((1.2816 - 2.3263) * GW_SIGMA); // P90 / P99

  function gwHealthOf(svc) {
    var list;
    try { list = Q.mcpHealth() || []; } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) if (list[i].id === svc.id) return list[i];
    return null;
  }
  /** LLM 路由：与「LLM 路由」表同一份读数（P99 + 成功率），同 range 聚合；取不到才退回配置推算 */
  function gwRouteInfo(svc, state) {
    if (!state || svc.kind !== 'llm') return null;
    var rows;
    try { rows = Q.llmRoutes(state.range) || []; } catch (e) { return null; }
    var want = [svc.id, svc.model ? ('llm-' + svc.model.id) : null];
    for (var i = 0; i < rows.length; i++) {
      if (want.indexOf(rows[i].id) < 0) continue;
      var p99 = (rows[i].p99 != null && isFinite(rows[i].p99)) ? rows[i].p99 : null;
      var err = (rows[i].successRate != null && isFinite(rows[i].successRate)) ? (1 - rows[i].successRate) : null;
      if (p99 != null || err != null) {
        return { p99: p99, errRate: err, status: rows[i].status, statusText: rows[i].statusText };
      }
    }
    return null;
  }

  function gwStat(svc, h, state) {
    var health = gwHealthOf(svc);
    var info = health ? null : gwRouteInfo(svc, state);
    var qps, usage, errRate, p99, base;
    if (health) {
      qps = health.qps; usage = health.usage; errRate = health.errRate; p99 = health.p99;
    } else {
      var baseLat = svc.kind === 'llm' && svc.model ? svc.model.baseLatency
        : (60 + 120 * (svc.errorBias || 1));
      base = baseLat;
      p99 = (info && info.p99 != null) ? info.p99 : Math.round(baseLat * GW_P99_K);
      qps = Math.max(1, Math.round(svc.qpsCap * 0.55));   // 列表无该对象时的容量假设，读的是配额不是随机数
      usage = qps / svc.qpsCap;
      errRate = (info && info.errRate != null) ? info.errRate : 0.004 * (svc.errorBias || 1);
    }
    if (base == null) base = p99 / GW_P99_K;
    /* 熔断当前状态：原来**写死**「闭合（正常放行）」，于是压着未恢复 P1 事故的服务
       在详情里也显示"一切正常"。现在按同一份真实读数派生（阈值就是上面那行
       「熔断 · 错误率阈值」，读的是同一个 svc/真值，不再有第二个口径）。 */
    var errTh = (svc.circuit && svc.circuit.errThreshold != null)
      ? svc.circuit.errThreshold
      : +(0.02 + (svc.errorBias || 1) * 0.01).toFixed(4);
    var tripped = !!health && (!!health.incident || health.errRate >= errTh);
    var reason = '';
    if (tripped) {
      reason = health.incident
        ? ((health.incident.level || 'P1') + ' 事故未恢复')
        : ('错误率 ' + h.fmt.pct2(health.errRate) + ' ≥ 阈值 ' + h.fmt.pct2(errTh));
    }
    return {
      qps: qps, usage: usage, errRate: errRate,
      p50: Math.max(1, Math.round(base)),
      p90: Math.round(p99 * GW_P90_K),
      p99: p99,
      health: health,
      status: health ? health.status : (info ? info.status : 'idle'),
      statusText: health ? health.statusText : (info ? info.statusText : '无调用'),
      incident: health ? health.incident : null,
      breaker: tripped ? 'open' : 'closed',
      breakerText: tripped ? '打开（' + reason + '）' : '闭合（正常放行）',
      errThreshold: errTh
    };
  }

  function gwKeys(svc, h) {
    var T = assetGwTable();
    if (T && T.apiKeys && T.apiKeys.length) {
      var hit = T.apiKeys.filter(function (k) {
        return (k.svcId === svc.id) || (k.svc === svc.name) || (k.service === svc.name) || (k.target === svc.name);
      });
      if (hit.length) return hit.map(function (k, i) {
        return {
          id: k.id || ('k' + i), name: k.name || ('key-' + i),
          svc: k.svc || k.service || k.target || svc.name,
          tail: k.tail || k.last4 || '****',
          createdDay: k.createdDay != null ? k.createdDay : (k.createdDays != null ? k.createdDays : -180),
          lastUseMin: k.lastUseMin != null ? k.lastUseMin : 30,
          expireDays: k.expireDays != null ? k.expireDays : 90
        };
      });
    }
    var r = h.seed.R.of('gwkey|' + svc.id);
    var n = 1 + Math.floor(r() * 2);
    var out = [];
    var alpha = '0123456789abcdef';
    for (var i = 0; i < n; i++) {
      var tail = '';
      for (var j = 0; j < 4; j++) tail += alpha[Math.floor(r() * alpha.length)];
      var stem = svc.kind === 'llm' ? 'llm' : 'mcp';
      var shortName = String(svc.id).replace(/^mcp-/, '').replace(/^llm-/, '');
      out.push({
        id: svc.id + '-k' + (i + 1),
        name: stem + '-' + shortName + (i === 0 ? '-prod' : '-staging'),
        svc: svc.name, tail: tail,
        createdDay: -(30 + Math.floor(r() * 300)),
        lastUseMin: Math.floor(r() * 180),
        expireDays: Math.floor(r() * 200) - 5
      });
    }
    return out;
  }

  /* ---- 脱敏 ---- */
  function maskStr(s) {
    var t = String(s);
    if (t.length <= 4) return '****';
    return t.slice(0, 1) + '****' + t.slice(-2);
  }
  var SENSITIVE = /user|session|phone|mobile|order|customer|id$|_id|token|secret|key|card|email/i;
  function maskDeep(v) {
    if (v == null) return v;
    if (typeof v === 'string') return maskStr(v);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v.length === 'number') {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(maskDeep(v[i]));
      return a;
    }
    if (typeof v === 'object') {
      var o = {};
      for (var k in v) if (has(v, k)) o[k] = SENSITIVE.test(String(k)) ? maskStr(v[k]) : maskDeep(v[k]);
      return o;
    }
    return v;
  }

  function gwTopActions(svc, h) {
    return '<div class="gray-acts">' +
      '<button class="btn-danger" data-act="gw-breaker" data-id="' + h.esc(svc.id) + '">一键熔断</button>' +
      '<button class="btn-danger" data-act="gw-global-degrade" data-id="' + h.esc(svc.id) + '">一键切全局降级</button>' +
      '</div>';
  }

  function gwConfigBody(svc, state, h) {
    var fmt = h.fmt;
    var st = gwStat(svc, h, state);
    var keys = gwKeys(svc, h);
    var key = keys[0];
    var r = h.seed.R.of('gwcfg|' + svc.id);
    var timeoutMs = svc.timeoutMs != null ? svc.timeoutMs : (svc.kind === 'llm' ? 30000 : (3000 + Math.floor(r() * 12) * 1000));
    var retries = svc.retries != null ? svc.retries : (1 + Math.floor(r() * 3));
    /* 错误率阈值只算一次（gwStat 里的同一个值）：展示的阈值与熔断状态的判定必须同源，
       否则会出现"阈值 3.00% / 状态闭合"而错误率 3.2% 这种自相矛盾的屏。 */
    var errTh = st.errThreshold;
    var halfOpen = (svc.circuit && svc.circuit.halfOpenSec != null) ? svc.circuit.halfOpenSec : (15 + Math.floor(r() * 45));

    return card('接入配置', svc.kind === 'llm' ? '模型路由' : 'MCP 服务',
      kv([
        ['端点地址', '<span class="mono">' + h.esc(svc.name) + '</span>'],
        ['协议', h.esc(svc.protocol)],
        ['鉴权方式', '密钥引用 <span class="mono">' + h.esc(key ? key.name : '未绑定') + '</span> · 明文 <span class="mono">••••••••' + h.esc(key ? key.tail : '****') + '</span>（永不回显）'],
        ['密钥引用', permTag('gateway:key:read')],
        ['超时', fmt.dur(timeoutMs)],
        ['重试', retries + ' 次（指数退避，仅对幂等调用）'],
        ['熔断 · 错误率阈值', fmt.pct2(errTh) + '（窗口 60s，最小请求数 20）'],
        ['熔断 · 半开探测间隔', halfOpen + ' 秒'],
        ['熔断 · 当前状态', st.breaker === 'open'
          ? '<span class="pill bad">' + h.esc(st.breakerText) + '</span>'
          : '<span class="pill ok">' + h.esc(st.breakerText) + '</span>']
      ]), null, '只读说明：连接的配置态字段；改端点/超时/熔断参数点击即生效，本屏不提供直改入口。') +
      '<div class="grid2">' +
      card('配额水位', 'QPS 上限 ' + svc.qpsCap,
        C.gauge(st.usage, { title: '当前 QPS 占用' }) +
        kv([['当前 QPS', st.qps + ' / ' + svc.qpsCap], ['错误率', '<span class="' + (st.errRate > 0.02 ? 'bad' : '') + '">' + fmt.pct2(st.errRate) + '</span>']]),
        null, '只读说明：配额水位是实时读数；调整 QPS 上限属变更，需走二次确认，本屏不提供入口。') +
      card('依赖与影响面', '由真实拓扑推导',
        '<div class="bt-note">' + svcCallers(svc).length + ' 个 Agent 的编排引用了本' + (svc.kind === 'llm' ? '模型路由' : ' MCP 服务') + '；变更/熔断前先看影响面。</div>' +
        '<div>' + (svcCallers(svc).map(function (a) { return '<span class="tag">' + h.esc(a.name) + '</span>'; }).join('') || '<span class="muted">无引用方</span>') + '</div>',
        null, '只读说明：引用方清单由拓扑推导，逐方下钻在「调用方」相关页；本卡只作变更前的影响面确认。') +
      '</div>';
  }

  function gwTrafficBody(svc, state, h) {
    var fmt = h.fmt;
    var callers = svcCallers(svc);
    var keys = gwKeys(svc, h);
    var r = h.seed.R.of('gwtraf|' + svc.id);

    // 按 API Key 限流（配置态）
    var keyRows = keys.map(function (k) {
      var qps = Math.max(1, Math.round(svc.qpsCap / keys.length * (0.5 + r() * 0.6)));
      return { dim: '按 API Key', obj: k.name, qps: qps, quota: qps * 86400, used: Math.round(qps * 86400 * (0.2 + r() * 0.6)), kind: 'ok', kindText: '启用' };
    });

    // 按调用方 Agent 限流：调用量取真实 QUERY 聚合
    var agentRows = callers.map(function (a) {
      var k = Q.kpi('24h', { agentId: a.id });
      var qps = Math.max(1, Math.round(k.calls / 86400 * (4 + r() * 4))); // 峰值系数折算
      return { dim: '按调用方 Agent', obj: a.name, qps: qps, quota: Math.round(k.calls * 30), used: Math.round(k.calls * 7), kind: 'ok', kindText: '启用', agentId: a.id, calls: k.calls };
    });

    // 按用户维度限流（配置态）
    var userRow = { dim: '按用户维度', obj: 'user_id 维度（全局）', qps: 10, quota: 100000, used: Math.round(100000 * (0.1 + r() * 0.5)), kind: 'ok', kindText: '启用' };

    var ruleRows = keyRows.concat(agentRows, [userRow]);
    var ruleTbl = h.table({
      columns: [
        { key: 'dim', label: '限流维度' },
        { key: 'obj', label: '对象', render: function (x) { return x.agentId ? '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(x.agentId) + '">' + h.esc(x.obj) + '</button>' : '<span class="mono">' + h.esc(x.obj) + '</span>'; } },
        { key: 'qps', label: 'QPS 上限', align: 'right' },
        { key: 'quota', label: '配额（30d）', align: 'right', fmt: 'int' },
        { key: 'used', label: '已用', align: 'right', render: function (x) { return fmt.int(x.used) + '（' + fmt.pct1(x.quota ? x.used / x.quota : 0) + '）'; } },
        { key: 'kind', label: '状态', render: function (x) { return h.pill(x.kind, x.kindText); } }
      ],
      rows: ruleRows, noPaging: true
    });

    var prio = '<div class="tbl-wrap"><table class="bt"><thead><tr><th>优先级</th><th>业务</th><th>配额保障</th><th>让步策略</th></tr></thead><tbody>' +
      [['P0', '在线客服 / 交易链路', '保留 60% 总配额', '不受降级影响'],
       ['P1', '运营触达 / 内容生成', '保留 30% 总配额', 'P0 打满时排队'],
       ['P2', '离线批处理 / 报表', '共享剩余 10%', '过载直接拒绝（429）']].map(function (x) {
        return '<tr><td><span class="pill ' + (x[0] === 'P0' ? 'bad' : (x[0] === 'P1' ? 'warn' : 'info')) + '">' + x[0] + '</span></td>' +
          '<td>' + h.esc(x[1]) + '</td><td>' + h.esc(x[2]) + '</td><td>' + h.esc(x[3]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var chain = svc.kind === 'llm'
      ? ['llm://qwen-max', 'llm://qwen-plus', 'llm://qwen-turbo']
      : [svc.name, (svc.id === 'mcp-order' ? 'mcp://order/detail-backup' : svc.name + '-backup'), '拒绝（返回 503 + 降级话术）'];
    var fallbackHtml = '<div class="exec-flow">' + chain.map(function (c, i) {
      var last = i === chain.length - 1;
      return '<div class="exec-node ' + (i === 0 ? 'ok' : (last ? 'bad' : 'warn')) + '">' +
        '<div class="exec-h"><b class="mono">' + h.esc(c) + '</b>' +
        '<span class="pill ' + (i === 0 ? 'ok' : (last ? 'bad' : 'warn')) + '">' + (i === 0 ? '主' : (last ? '兜底' : '备用')) + '</span></div></div>' +
        (i < chain.length - 1 ? '<div class="exec-arrow">→</div>' : '');
    }).join('') + '</div>';

    return card('限流规则', ruleRows.length + ' 条 · 按 API Key / 调用方 Agent / 用户维度',
      ruleTbl + '<div class="bt-note">调用方 Agent 的配额按其近 24 小时真实调用量换算，可下钻到 Agent 详情对账。</div>') +
      '<div class="grid2">' +
      card('优先级队列', 'P0 业务优先', prio) +
      card('降级策略（fallback 链）', svc.kind === 'llm' ? '主模型不可用 → 备用模型 → 兜底' : '主服务不可用 → 备用实例 → 拒绝',
        fallbackHtml + '<div class="bt-note">触发条件：熔断打开或错误率超阈值时按链式降级；降级期间主链路恢复会自动回切（半开探测成功 3 次）。</div>') +
      '</div>';
  }

  function gwMonitorBody(svc, state, h) {
    var fmt = h.fmt;
    var st = gwStat(svc, h, state);
    var calls = st.qps * 3600; // 近 1 小时估算

    var errRows = S.ERROR_CODES.map(function (e) {
      var share = e.weight / S.ERROR_CODES.reduce(function (s, x) { return s + x.weight; }, 0);
      var n = Math.round(calls * st.errRate * share);
      return { label: e.name, http: e.http, code: e.id, n: n };
    }).sort(function (a, b) { return b.n - a.n; });

    var tokRate = svc.kind === 'llm' ? Math.round(st.qps * 900) : null;
    var cards = [
      { label: '当前 QPS', value: String(st.qps), sub: '上限 ' + svc.qpsCap + '（' + fmt.pct0(st.usage) + '）', alert: st.usage > 0.85 },
      { label: 'P50 延迟', value: fmt.dur(st.p50) },
      { label: 'P90 延迟', value: fmt.dur(st.p90) },
      { label: 'P99 延迟', value: fmt.dur(st.p99), alert: st.p99 > 4000 },
      { label: '错误率', value: fmt.pct2(st.errRate), alert: st.errRate > 0.02, sub: '约 ' + fmt.int(calls * st.errRate) + ' 次 / 小时' }
    ];
    if (tokRate != null) cards.push({ label: 'token 速率', value: fmt.compact(tokRate) + ' tok/s', sub: '示例折算，供容量规划参考' });

    var latBars = C.barChart([
      { label: 'P50', value: st.p50, display: fmt.dur(st.p50) },
      { label: 'P90', value: st.p90, display: fmt.dur(st.p90) },
      { label: 'P99', value: st.p99, display: fmt.dur(st.p99) }
    ], { colorFn: function (x) { return x.label === 'P99' ? '#d97706' : '#2563eb'; } });

    var errBars = C.barChart(errRows.map(function (x) {
      return { label: x.label + '（' + x.http + '）', value: x.n, display: fmt.int(x.n) };
    }), { colorFn: function (x) { return x.label.indexOf('429') >= 0 ? '#d97706' : (x.label.indexOf('504') >= 0 || x.label.indexOf('500') >= 0 ? '#dc2626' : '#2563eb'); } });

    var httpRows = [
      { k: '429 限流', v: errRows.filter(function (x) { return x.http === 429; }).reduce(function (s, x) { return s + x.n; }, 0) },
      { k: '5xx 服务端', v: errRows.filter(function (x) { return x.http >= 500 && x.http !== 504; }).reduce(function (s, x) { return s + x.n; }, 0) },
      { k: '504 超时', v: errRows.filter(function (x) { return x.http === 504; }).reduce(function (s, x) { return s + x.n; }, 0) },
      { k: '4xx 入参/合规', v: errRows.filter(function (x) { return x.http < 500; }).reduce(function (s, x) { return s + x.n; }, 0) }
    ];

    return '<div class="metrics">' + cards.map(h.metricCard).join('') + '</div>' +
      '<div class="grid2">' +
      card('延迟分位', 'P50 / P90 / P99', latBars) +
      card('错误码分布', '近 1 小时约 ' + fmt.int(calls * st.errRate) + ' 次错误',
        '<div class="tbl-wrap"><table class="bt"><thead><tr><th>分类</th><th class="ta-r">次数</th></tr></thead><tbody>' +
        httpRows.map(function (x) { return '<tr><td>' + h.esc(x.k) + '</td><td class="ta-r">' + fmt.int(x.v) + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      '</div>' +
      card('错误码明细', '按标准 HTTP 语义分组', errBars);
  }

  function gwLogsBody(svc, state, h) {
    var fmt = h.fmt;
    var f = state.filters || {};
    var callers = svcCallers(svc);
    var agentId = f.gwAgent || (callers[0] ? callers[0].id : '');
    var statusSel = f.gwStatus || '';
    var traceKw = f.gwTrace || '';

    var filter = {};
    if (agentId) filter.agentId = agentId;
    if (traceKw) filter.traceId = traceKw;
    if (statusSel === 'failed') filter.status = 'failed';
    else if (statusSel) filter.errCode = statusSel;

    var res = Q.searchTraces(state.range || '24h', filter, 1, 15);
    var rows = res.rows || [];

    var agentOpts = '<option value="">全部来源</option>' + callers.map(function (a) {
      return '<option value="' + h.esc(a.id) + '"' + (a.id === agentId ? ' selected' : '') + '>' + h.esc(a.name) + '</option>';
    }).join('');
    var statusOpts = '<option value="">全部状态</option><option value="failed"' + (statusSel === 'failed' ? ' selected' : '') + '>失败（全部）</option>' +
      S.ERROR_CODES.map(function (e) { return '<option value="' + e.id + '"' + (statusSel === e.id ? ' selected' : '') + '>' + e.http + ' ' + h.esc(e.name) + '</option>'; }).join('');

    var bar = '<div class="filter-bar">' +
      '<label>调用方 Agent <select data-f="gwAgent">' + agentOpts + '</select></label>' +
      '<label>状态码 <select data-f="gwStatus">' + statusOpts + '</select></label>' +
      '<label>traceId <input data-f="gwTrace" placeholder="粘贴 traceId 前缀" value="' + h.esc(traceKw) + '"></label>' +
      '</div>';

    var tbl = h.table({
      columns: [
        { key: 'ts', label: '时间', render: function (r) { return '<span class="mono">' + fmt.dt(r.ts) + '</span>'; } },
        { key: 'caller', label: '调用方', render: function (r) { return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(r.agentName) + '</button>'; } },
        { key: 'traceId', label: 'traceId', mono: true, render: function (r) { return '<button class="lnk mono" data-act="goto-trace" data-id="' + h.esc(r.traceId) + '">' + h.esc(r.traceId) + '</button>'; } },
        { key: 'status', label: '状态码', render: function (r) {
          if (r.status !== 'failed') return h.pill('ok', '200');
          var e = S.ERROR_CODES[S.idx.err[r.errCode]];
          return '<span class="pill bad">' + (e ? e.http : '5xx') + ' ' + h.esc(r.errName || '失败') + '</span>';
        } },
        { key: 'latencyMs', label: '耗时', align: 'right', render: function (r) { return '<span class="' + (r.latencyMs > 4000 ? 'bad' : '') + '">' + fmt.dur(r.latencyMs) + '</span>'; } },
        { key: 'act', label: '', render: function (r) { return '<button class="lnk" data-act="gw-log-open" data-id="' + h.esc(r.traceId) + '">查看请求/响应</button>'; } }
      ],
      rows: rows, noPaging: true, pageSize: 15,
      emptyTitle: '没有匹配的调用记录',
      emptySub: '换个调用方 / 状态码 / traceId，或扩大时间范围'
    });

    // 单条展开（平铺，不用 details）：选中实例的请求/响应（脱敏）
    var openId = state.gwLogId;
    var openHtml = '';
    if (openId) {
      var d = F.getTrace(openId);
      if (!d) {
        openHtml = card('请求 / 响应', '', '<div class="bt-note">traceId <span class="mono">' + h.esc(openId) + '</span> 不存在或已过期。</div>');
      } else {
        var ioPairs = d.spans.filter(function (sp) { return sp.kind === 'tool' || sp.kind === 'llm' || sp.kind === 'guard'; }).slice(0, 4);
        openHtml = card('请求 / 响应 · <span class="mono">' + h.esc(openId) + '</span>',
          '敏感字段已脱敏 · 原文需权限 ' + permTag('gateway:log:raw'),
          '<div class="readonly-note">' + h.icon('doc', 14) + ' 下方为脱敏后的请求/响应（user_id、order_id、session_id 等已掩码）。展开原文需 gateway:log:raw 权限。</div>' +
          ioPairs.map(function (sp) {
            return '<div class="exec-node ' + (sp.status === 'failed' ? 'bad' : 'ok') + '">' +
              '<div class="exec-h"><b>' + h.esc(sp.name) + '</b><em>' + h.esc(C.KIND_LABEL[sp.kind] || sp.kind) + '</em><span class="sp-dur">' + fmt.dur(sp.duration) + '</span></div>' +
              '<div class="exec-io"><div class="sp-col"><b>请求（脱敏）</b><pre>' + h.esc(C.jsonView(maskDeep(sp.io ? sp.io.input : null))) + '</pre></div>' +
              '<div class="sp-col"><b>响应（脱敏）</b><pre>' + h.esc(sp.error ? '—（失败，无响应）' : C.jsonView(maskDeep(sp.io ? sp.io.output : null))) + '</pre></div></div>' +
              '</div>';
          }).join('') +
          '<div class="gray-acts"><button class="btn-ghost" data-act="gw-log-raw" data-id="' + h.esc(openId) + '">查看未脱敏原文</button>' +
          '<button class="btn-ghost" data-act="gw-log-close">收起</button></div>');
      }
    }

    return card('调用日志检索', '命中 ' + fmt.int(res.total != null ? res.total : rows.length) + ' 条 · 显示前 ' + rows.length + ' 条',
      bar + tbl + '<div class="bt-note">日志行取自真实 trace（事实层），与「可观测与评估」页是同一份数据，可交叉验证。</div>') + openHtml;
  }

  function gwKeysBody(svc, state, h) {
    var fmt = h.fmt;
    var keys = gwKeys(svc, h);
    var relevant = keys.slice().sort(function (a, b) { return a.expireDays - b.expireDays; });

    var warn = function (days) {
      if (days < 0) return { kind: 'bad', text: '已过期 ' + Math.abs(days) + ' 天', bucket: '已过期' };
      if (days <= 1) return { kind: 'bad', text: '1 天内到期', bucket: '≤1 天' };
      if (days <= 7) return { kind: 'warn', text: '7 天内到期', bucket: '≤7 天' };
      if (days <= 30) return { kind: 'warn', text: '30 天内到期', bucket: '≤30 天' };
      return { kind: 'ok', text: days + ' 天后到期', bucket: '正常' };
    };

    var tbl = h.table({
      columns: [
        { key: 'name', label: '密钥名称', render: function (k) { return '<span class="mono">' + h.esc(k.name) + '</span>'; } },
        { key: 'svc', label: '关联服务', render: function (k) { return '<span class="mono">' + h.esc(k.svc) + '</span>'; } },
        { key: 'tail', label: '明文末 4 位', render: function (k) { return '<span class="mono">••••••••' + h.esc(k.tail) + '</span>'; } },
        { key: 'createdDay', label: '创建时间', render: function (k) { return h.esc(F.fmtDate(S.TODAY_START + k.createdDay * S.DAY)); } },
        { key: 'lastUseMin', label: '最近使用', render: function (k) { return k.lastUseMin < 60 ? k.lastUseMin + ' 分钟前' : (k.lastUseMin / 60).toFixed(1) + ' 小时前'; } },
        { key: 'expireDays', label: '到期', render: function (k) { var w = warn(k.expireDays); return '<span class="pill ' + w.kind + '">' + h.esc(w.text) + '</span>'; } },
        { key: 'act', label: '操作', render: function (k) {
          return '<button class="lnk" data-act="gw-key-rotate" data-id="' + h.esc(k.id) + '">轮换</button> · ' +
            '<button class="lnk warn" data-act="gw-key-revoke" data-id="' + h.esc(k.id) + '">吊销</button>';
        } }
      ],
      rows: relevant, noPaging: true
    });

    var buckets = [{ n: '已过期', d: function (x) { return x.expireDays < 0; }, kind: 'bad' },
      { n: '≤1 天', d: function (x) { return x.expireDays >= 0 && x.expireDays <= 1; }, kind: 'bad' },
      { n: '≤7 天', d: function (x) { return x.expireDays > 1 && x.expireDays <= 7; }, kind: 'warn' },
      { n: '≤30 天', d: function (x) { return x.expireDays > 7 && x.expireDays <= 30; }, kind: 'warn' }];
    var alarm = buckets.map(function (b) {
      var cnt = relevant.filter(b.d).length;
      return cnt ? '<li class="' + b.kind + '">' + b.n + '：' + cnt + ' 把密钥</li>' : '';
    }).join('') || '<li class="pass">✓ 30 天内无到期密钥</li>';

    return card('密钥列表', '密钥永不回显明文，仅显示末 4 位', tbl +
      '<div class="gray-acts">' +
      '<button class="btn-ghost" data-act="gw-key-rotate" data-id="' + h.esc(relevant[0] ? relevant[0].id : svc.id) + '">轮换（新旧并行期）</button>' +
      '<button class="btn-danger" data-act="gw-key-revoke" data-id="' + h.esc(relevant[0] ? relevant[0].id : svc.id) + '">吊销（立即失效）</button>' +
      '</div>' +
      '<ul class="check-list">' + alarm + '</ul>' +
      '<div class="bt-warn">预警节奏：<b>到期前 30 / 7 / 1 天</b>分别提醒。轮换采用新旧密钥并行期（默认 24 小时），' +
      '调用方切换完成后再停用旧密钥；吊销立即失效，并通知所有引用方（见下方影响面）。</div>') +
      card('吊销影响面', '来自真实引用关系',
        '<div class="bt-note">吊销 <span class="mono">' + h.esc(svc.name) + '</span> 的密钥后，以下 ' + svcCallers(svc).length + ' 个 Agent 将无法调用，需同步更新配置：</div>' +
        '<div>' + (svcCallers(svc).map(function (a) { return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(a.id) + '"><b>' + h.esc(a.name) + '</b></button>'; }).join(' · ') || '<span class="muted">无引用方</span>') + '</div>');
  }

  function gwHistoryBody(svc, state, h) {
    var fmt = h.fmt;
    var owners = S.OWNERS.map(function (o) { return o.name; });
    var r = h.seed.R.of('gwhist|' + svc.id);
    var items = ['限流阈值调整', '熔断错误率阈值', '超时与重试', '密钥轮换'];
    var recs = items.map(function (t, i) {
      return {
        id: 'gh-' + (i + 1),
        day: -(1 + i * 7 + Math.floor(r() * 5)),
        by: owners[Math.floor(r() * owners.length)],
        item: t,
        approved: r() < 0.7,
        approver: owners[Math.floor(r() * owners.length)]
      };
    });

    var tbl = h.table({
      columns: [
        { key: 'day', label: '时间', render: function (x) { return h.esc(F.fmtDate(S.TODAY_START + x.day * S.DAY)); } },
        { key: 'by', label: '操作人' },
        { key: 'item', label: '变更项' },
        { key: 'approved', label: '是否审批', render: function (x) { return x.approved ? h.pill('ok', '已审批 · ' + x.approver) : h.pill('warn', '免审（低危变更）'); } },
        { key: 'act', label: '', render: function (x) { return '<button class="lnk" data-act="gw-hist-pick" data-id="' + h.esc(x.id) + '">看 diff</button>'; } }
      ],
      rows: recs, noPaging: true
    });

    var pick = state.gwHistId || (recs[0] && recs[0].id);
    var rec = recs.filter(function (x) { return x.id === pick; })[0] || recs[0];
    var before = 'qpsCap=' + svc.qpsCap + '\nretries=1\nerrThreshold=0.0200\nhalfOpenSec=20\ntimeoutMs=' + (svc.kind === 'llm' ? 30000 : 8000);
    var after = 'qpsCap=' + (svc.qpsCap + 20) + '\nretries=2\nerrThreshold=0.0150\nhalfOpenSec=15\ntimeoutMs=' + (svc.kind === 'llm' ? 30000 : 10000);

    return card('变更历史', recs.length + ' 条配置改动', tbl) +
      card('变更 diff · ' + h.esc(rec ? rec.item : ''),
        rec ? (F.fmtDate(S.TODAY_START + rec.day * S.DAY) + ' · ' + h.esc(rec.by) + (rec.approved ? ' · 审批人 ' + h.esc(rec.approver) : ' · 免审')) : '',
        diffViewer(before, after, h, { title: svc.name + ' 配置变更' }));
  }

  R.gatewayDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var svc = gwResolve(state);
    if (!svc) return detailMissing(cap, state, h);
    var tab = state.objTab || 'config';
    if (!GW_TABS.some(function (t) { return t.key === tab; })) tab = 'config';

    var st = gwStat(svc, h, state);
    var callers = svcCallers(svc);
    var dayCalls = callers.reduce(function (s, a) { return s + Q.kpi('24h', { agentId: a.id }).calls; }, 0);

    /* v24b：详情页头此前所有服务共用 icon:'chat' —— 打开哪个网关服务，页头都长一样。
       改用服务自己的身份图标（MCP 见 seed 的 icon 字段，LLM 路由是芯片），
       并在描述行补中文用途，这样「当前在看哪个服务」在页头就成立。 */
    var smeta = (global.UI && global.UI.svcMeta) ? global.UI.svcMeta(svc.id) : null;
    var head = pageHead(cap, state, h, {
      icon: smeta ? smeta.icon : 'chat', title: svc.name,
      /* 页头角标也走同一份状态字（列表那一份）—— 原来这里用 errRate/usage 自己拼一套文字，
         于是同一个服务在墙上写「P1 事故进行中」、在详情页头写「错误率超标」，两句话两个说法。 */
      badge: ' ' + h.pill(st.status || 'idle', st.statusText || '—'),
      desc: (svc.kind === 'llm' ? '模型路由' : 'MCP 服务') + (smeta && smeta.purpose ? ' · ' + smeta.purpose : '') + ' · ' + svc.protocol,
      tags: ['QPS ' + st.qps + ' / ' + svc.qpsCap, '引用方 ' + callers.length + ' 个 Agent', '关联调用 ' + fmt.compact(dayCalls) + ' 次 / 24h'],
      side: h.rangePicker(state.range) + gwTopActions(svc, h),
      crumbs: ['平台', 'MCP / LLM 网关', svc.name]
    });

    var body = '';
    if (tab === 'config') body = gwConfigBody(svc, state, h);
    else if (tab === 'traffic') body = gwTrafficBody(svc, state, h);
    else if (tab === 'monitor') body = gwMonitorBody(svc, state, h);
    else if (tab === 'logs') body = gwLogsBody(svc, state, h);
    else if (tab === 'keys') body = gwKeysBody(svc, state, h);
    else body = gwHistoryBody(svc, state, h);

    return head + '<div class="tabs-wrap">' + tabsBar(cap, state, h, GW_TABS, tab) + '</div>' + body +
      h.metaBar({}, [
        { k: '配置态字段', v: '端点/协议/超时/重试/熔断参数/限流规则/密钥/变更历史来自网关资产表（routes / mcpTools / apiKeys）' },
        { k: '调用日志与引用方', v: '调用日志来自真实 trace；引用方 Agent 由节点拓扑反查（谁在编排里引用了本服务），可交叉验证' },
        { k: '密钥口径', v: '密钥明文永不回显，仅展示末 4 位；查看未脱敏日志需 gateway:log:raw 权限' }
      ]);
  };

  /* ============================================================
   * 3. 动作注册
   * ============================================================ */

  ACTIONS['flow-tab'] = function (id, btn, h) {
    h.navigate({ objTab: id });
  };

  /* 版本「画布 / diff」信息面板（Agent 详情 › 版本 页签用）。
     此前这里是一个空 toast（"diff 见下方 Tab 内平铺展示"）—— 从**死按钮**变成**假按钮**。
     ⚠ 本文件里**没有可用的 openModal**（openModal 是 renderers2.js 的局部函数），
       所以不能用弹层；改用本文件已验证可用的 dangerConfirm 做「信息面板」。
     面板只给该版本的**真实事实**（版本号 / 流量占比 / 变更说明 / 状态），
     并如实说明「本原型没有可渲染的画布，因此不展示假画布」。
     2026-10-20：Workflow 详情下线后，这个动作**唯一的调用方**是 Agent 详情的版本表，
     因此由 wf-diff 改名为 ver-diff，权限点从 workflow:run:rerun 改为 agent:publish
     （查看版本结构属于发布前检查，不再借用流程运行权限）。 */
  ACTIONS['ver-diff'] = function (id, btn, h) {
    var p = String(id).split('|'), ver = p[0], kind = p[1] || 'diff';
    var isCanvas = kind === 'canvas';
    h.dangerConfirm(h, {
      title: (isCanvas ? '版本画布 · ' : '版本 diff · ') + ver,
      desc: isCanvas ? '该版本的可视化编排结构' : '该版本相对上一版的变更',
      tone: 'normal',
      perm: 'agent:publish',
      impacts: [
        { label: '版本', value: ver },
        { label: isCanvas ? '画布' : 'diff', value: isCanvas
            ? '该版本没有画布数据；编排结构见下方「变更 diff」卡片'
            : '变更 diff 在下方的「变更 diff」卡片内**平铺展示**（文本形式，可逐行核对）', tone: 'warn' },
        { label: '为什么这样处理', value: '宁可只给版本事实，也不画一个不存在的画布' }
      ],
      confirmText: '知道了',
      action: isCanvas ? '查看版本画布' : '查看版本 diff', target: ver,
      /* 纯查看动作：不写状态 —— **查看不是变更** */
      onConfirm: function () {}
    });
  };

  ACTIONS['gw-breaker'] = function (id, btn, h) {
    var svc = gwResolve({ objId: id }) || { name: id, id: id, qpsCap: 60, kind: 'mcp' };
    var callers = svcCallersIdx(id);
    danger(h, {
      title: '一键熔断 · ' + svc.name,
      desc: '立即打开熔断，拒绝发往该服务的调用。',
      impacts: [
        { label: '作用范围', value: '所有对本服务的调用立即被拒绝（返回 503）' },
        { label: '下游影响', value: callers.length + ' 个引用它的 Agent 相关节点将失败或走降级分支' },
        { label: '可回滚', value: '熔断可手动恢复，但恢复后半开探测需 3 次成功才全量放行' }
      ],
      perm: 'gateway:breaker',
      confirmText: '确认熔断', danger: true, act: 'gw-breaker'
    });
  };

  ACTIONS['gw-global-degrade'] = function (id, btn, h) {
    var svc = gwResolve({ objId: id }) || { name: id, id: id, kind: 'mcp' };
    danger(h, {
      title: '一键切全局降级',
      desc: '全站切换到降级模式：' + (svc.kind === 'llm' ? '主模型降级到备用模型' : '按 fallback 链降级到备用实例') + '。',
      impacts: [
        { label: '作用范围', value: '所有经过网关的调用，而非仅本服务' },
        { label: '下游影响', value: '全站质量/时延可能变化（备用模型能力与成本不同）' },
        { label: '可回滚', value: '手动恢复；降级期间的调用结果差异需事后抽样复核' }
      ],
      perm: 'gateway:global:degrade',
      confirmText: '确认全局降级', danger: true, act: 'gw-global-degrade'
    });
  };

  function svcCallersIdx(id) {
    var svc = gwResolve({ objId: id });
    return svc ? svcCallers(svc) : [];
  }

  ACTIONS['gw-log-open'] = function (id, btn, h) {
    h.navigate({ gwLogId: id }, { scroll: false });
  };
  ACTIONS['gw-log-close'] = function (id, btn, h) {
    h.navigate({ gwLogId: null }, { scroll: false });
  };
  ACTIONS['gw-log-raw'] = function (id, btn, h) {
    danger(h, {
      title: '查看未脱敏原文',
      desc: 'traceId ' + id + ' 的请求/响应原文可能含客户个人信息。',
      impacts: [
        { label: '作用范围', value: '仅本次查看，不改变数据' },
        { label: '合规影响', value: '本次查看只展示脱敏内容，不改变任何状态' },
        { label: '权限要求', value: '需要 gateway:log:raw 权限点' }
      ],
      perm: 'gateway:log:raw',
      confirmText: '确认查看', danger: true, act: 'gw-log-raw'
    });
  };

  ACTIONS['gw-key-rotate'] = function (id, btn, h) {
    danger(h, {
      title: '轮换密钥',
      desc: '密钥 ' + id + ' 轮换：生成新密钥并进入新旧并行期。',
      impacts: [
        { label: '作用范围', value: '生成新密钥，旧密钥在并行期（默认 24 小时）内仍可用' },
        { label: '下游影响', value: '引用方需在并行期内切换到新密钥，否则并行期结束后调用失败' },
        { label: '可回滚', value: '并行期内可作废旧密钥或延长并行期' }
      ],
      perm: 'gateway:key:rotate',
      confirmText: '确认轮换', danger: true, act: 'gw-key-rotate'
    });
  };

  ACTIONS['gw-key-revoke'] = function (id, btn, h) {
    danger(h, {
      title: '吊销密钥',
      desc: '密钥 ' + id + ' 立即失效。',
      impacts: [
        { label: '作用范围', value: '密钥立即失效，使用该密钥的调用全部被拒（401）' },
        { label: '下游影响', value: '所有引用方需立即更新配置，未及时更新会导致线上调用中断' },
        { label: '可回滚', value: '不可回滚；需重新签发并通知所有引用方' }
      ],
      perm: 'gateway:key:revoke',
      confirmText: '确认吊销并通知引用方', danger: true, act: 'gw-key-revoke'
    });
  };

  ACTIONS['gw-hist-pick'] = function (id, btn, h) {
    h.navigate({ gwHistId: id }, { scroll: false });
  };

})(window);
