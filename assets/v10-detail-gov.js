/* ============================================================================
 * v10 详情渲染器 · 治理类（审批单详情 / 合规详情）
 *
 * 对应 data.js 已就绪的 detailType：approval → approvalDetail · compliance → complianceDetail
 * 铁律：ES5 · 对象不存在走 detailMissing · 危险操作走 dangerConfirm（理由必填）· 禁自述腔
 * ==========================================================================*/
(function (global) {
  'use strict';
  var R = global.RENDERERS;

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ==================================================== 审批单详情 */
  /* 审批链卡片 —— 单据 → 逐级审批状态。
     类型 → 审批链的映射与「审批治理」页的审批流配置同源（APR_FLOW_BASE / state.aprFlow），
     改配置会同时改这里 —— 不给单据另存一份链路。 */
  function aprChainCard(s, typeText, state, h, fmt, stage2Waiting, cover, decided) {
    var S = global.DATA_SEED || {};
    /* 单据 type → 审批流配置里的「操作类型」 */
    var TYPE2OP = {
      'agent-publish': 'Agent 发布',
      'mcp-open': 'MCP 对外开放',
      'rule-publish': '合规规则发布',
      'sandbox-net': '沙盒网络放开',
      'export': '数据导出',
      'persona-change': 'Agent 发布',
      'prompt-update': 'Agent 发布',
      'prompt-batch': 'Agent 发布',
      'kb-sync': '数据导出',
      'exp-review': '合规规则发布'
    };
    var BASE = (global.APR_FLOW_BASE_SNAPSHOT || [
      { op: 'Agent 发布', chain: '技术负责人 → 业务负责人', cond: '影响用户 > 10万 时增加安全负责人', sla: 'P1 4h' },
      { op: '数据导出', chain: '数据安全负责人', cond: '含 PII 时必须双审', sla: 'P0 3h' },
      { op: 'MCP 对外开放', chain: '安全负责人 → 架构负责人', cond: '涉及订单/客户数据强制双审', sla: 'P0 3h' },
      { op: '合规规则发布', chain: '合规负责人', cond: '误报率 > 2% 时驳回并要求重灰度', sla: 'P1 4h' },
      { op: '沙盒网络放开', chain: '安全负责人', cond: '全开网络需 CTO 审批', sla: 'P2 8h' }
    ]);
    var op = TYPE2OP[s.type] || null;
    var cfg = op ? BASE.filter(function (x) { return x.op === op; })[0] : null;
    /* 配置里没有这个类型时，用「单人审批」兜底，并说明是默认链 */
    var chainTxt = cfg ? cfg.chain : '安全负责人';
    var levels = chainTxt.split('→').map(function (x) { return x.trim(); }).filter(Boolean);
    var isDefault = !cfg;

    /* 逐级状态：已处理 < 当前 < 待处理。
       会话内的二级态（stage2Waiting）优先 —— 它是刚发生的动作，比静态推断更真实。 */
    var rows = levels.map(function (who, i) {
      var st, sub;
      if (decided) {
        st = 'done'; sub = (s.decided === 'approved' ? '通过' : '驳回') + ' · ' + h.esc(s.decidedBy || '—');
      } else if (stage2Waiting) {
        if (i === 0) { st = 'done'; sub = '已通过 · ' + h.esc((cover && cover.by) || '我'); }
        else if (i === 1) { st = 'cur'; sub = '待审 · 当前卡在这一级'; }
        else { st = 'wait'; sub = '待前级通过'; }
      } else if (i === 0) {
        st = 'cur'; sub = '待审 · 当前卡在这一级';
      } else {
        st = 'wait'; sub = '待前级通过';
      }
      return { who: who, st: st, sub: sub, i: i };
    });
    var curIdx = rows.filter(function (x) { return x.st === 'cur'; })[0];
    var doneN = rows.filter(function (x) { return x.st === 'done'; }).length;
    var PILL = { done: ['ok', '已通过'], cur: ['warn', '审批中'], wait: ['idle', '待处理'] };
    var STEPS = { done: '✓', cur: '●', wait: '○' };

    return '<div class="card" data-static="1" title="只读说明：审批链是流程事实陈述；决定（通过/驳回/转交）的入口在页头动作区，不散落在卡片里。"><div class="card-h"><h3>审批链</h3>' +
      '<span class="card-sub">' + levels.length + ' 级 · ' +
      (decided ? '已办结' : (doneN + '/' + levels.length + ' 级已通过')) + '</span>' +
      (cfg ? '<span class="card-sub mono">来自审批流配置：' + h.esc(cfg.op) + '</span>'
        : '<span class="card-sub">该类型未单独配置，走默认单级链</span>') +
      '</div>' +
      '<div class="tbl-wrap"><table class="bt"><thead><tr><th>级次</th><th>审批角色</th><th>状态</th><th>说明</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td class="mono">' + STEPS[x.st] + ' 第 ' + (x.i + 1) + ' 级</td>' +
          '<td>' + h.esc(x.who) + '</td>' +
          '<td><span class="pill ' + PILL[x.st][0] + '">' + PILL[x.st][1] + '</span></td>' +
          '<td class="muted">' + x.sub + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="kv" style="margin-top:10px">' +
      '<div><i>触发条件</i><b>' + h.esc(cfg ? cfg.cond : '默认：无附加条件') + '</b></div>' +
      '<div><i>配置的 SLA</i><b>' + h.esc(cfg ? cfg.sla : '—') + '</b></div>' +
      '<div><i>当前状态</i><b>' + (decided
        ? h.pill(s.decided === 'approved' ? 'ok' : 'bad', s.decided === 'approved' ? '已通过' : '已驳回')
        : (curIdx ? '卡在「' + h.esc(curIdx.who) + '」' : '待处理')) + '</b></div>' +
      '</div>' +
      (curIdx && !decided ? '<div class="bt-note">还差 ' + (levels.length - curIdx.i) + ' 级；' +
        (levels.length - curIdx.i > 1 ? '后 ' + (levels.length - curIdx.i - 1) + ' 级要等本级通过才会流转。' : '本级通过即办结。') +
        '</div>' : '') +
      '</div>';
  }

  R.approvalDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var q = h.app.getQueues ? h.app.getQueues().approval : null;
    var items = (q && q.items) || [];
    var s = byId(items, state.objId || state.agentId);
    if (!s) return h.detailMissing(cap, state, h);
    var active = state.objTab || state.tab || 'review';

    var typeText = {
      'agent-publish': 'Agent 发布', 'mcp-open': 'MCP 开放', 'persona-change': '画像变更',
      'rule-publish': '规则发布', 'sandbox-net': '沙盒网络变更', 'prompt-batch': '提示词批量',
      'kb-sync': '知识库同步', 'exp-review': '经验复核'
    }[s.type] || s.type;

    var decided = !!s.decided;

    /* P0 覆盖层状态：与列表页共写 aprOps，v19-governance-fix.js 织入 getQueues 全局消费 */
    var st = (global.APP_SHELL && global.APP_SHELL.state) || (h.state || {});
    st.aprOps = st.aprOps || {};
    var cover = st.aprOps[s.id] || null;
    var stage2Waiting = !!(cover && cover.s === 'pending-stage2');

    /* 🔴 #3 用户拍板（2026-10-06）：**两级审批不变**；但**最高级（P0）保留一个独立按钮** ——
       当一方审批人异常（休假/长期离岗、离职或权限失效、超 SLA 未响应）时，
       允许「**一个人 + AI 联审**」把流程走完。
       要点：① 只在 P0 开放 ② 必须是显式按钮（**不自动降级**）③ 审计必须能一眼区分。
       口径登记在 decisions.js 的「权限」域（单人AI联审_*）。 */
    var isP0 = String(s.level || '').toUpperCase() === 'P0';
    var p0AiBtn = isP0
      ? '<button class="btn-warn" data-act="ap-single-ai" data-id="' + h.esc(s.id) + '">单人＋AI 联审（一方异常）</button>'
      : '';

    /* P1 自批拦截：申请人 = 当前登录用户时不得本人审批（V19GOV 优先，CURRENT_USER 兜底） */
    var isSelf = false;
    if (global.V19GOV && typeof global.V19GOV.isSelfApproval === 'function') {
      isSelf = !!global.V19GOV.isSelfApproval(s);
    } else {
      var cu = global.CURRENT_USER;
      var meName = (cu && typeof cu === 'object') ? (cu.name || cu.id) : cu;
      if (meName && s.applicant === meName) isSelf = true;
    }

    var body = '';
    if (active === 'review') {
      var actBtn;
      if (isSelf) {
        actBtn = '<div class="bt-note">本人发起的单据由他人审批</div>';
      } else if (stage2Waiting) {
        actBtn = '<div class="gray-acts">' +
          '<button class="btn-primary" data-act="ap-decide" data-id="' + h.esc(s.id) + '|approve">通过（二级终审）</button>' +
          '<button class="btn-ghost" data-act="ap-decide" data-id="' + h.esc(s.id) + '|reject">驳回</button>' +
          p0AiBtn +
          '</div>';
      } else if (decided) {
        actBtn = '';
      } else {
        actBtn = '<div class="gray-acts">' +
          '<button class="btn-primary" data-act="ap-decide" data-id="' + h.esc(s.id) + '|approve">通过</button>' +
          '<button class="btn-ghost" data-act="ap-decide" data-id="' + h.esc(s.id) + '|reject">驳回</button>' +
          '<button class="btn-ghost" data-act="ap-decide" data-id="' + h.esc(s.id) + '|escalate">转交上级</button>' +
          p0AiBtn +
          '</div>';
      }
      body =
        '<div class="card" data-static="1" title="只读说明：审批单字段是事实陈述；批准/驳回/转交的入口在页头动作区。影响面与关联对象各有独立出口。"><div class="card-h"><h3>审批单</h3>' +
        '<span class="card-sub">' + h.esc(typeText) + '</span>' +
        (stage2Waiting ? '<span class="card-sub">' + h.pill('warn', '一级已通过 · 等待二级审批') + '</span>' : '') +
        (decided ? '<span class="card-sub">已' + (s.decided === 'approved' ? '通过' : '驳回') + ' · ' + h.esc(s.decidedBy) + '</span>' : '') +
        '</div>' +
        '<div class="kv">' +
        '<div><i>标题</i><b>' + h.esc(s.title) + '</b></div>' +
        '<div><i>申请人</i><b>' + h.esc(s.applicant) + '</b></div>' +
        '<div><i>等级</i><b>' + h.pill(s.levelKind, s.level) + '</b></div>' +
        '<div><i>等待时长</i><b>' + fmt.wait(s.waitMin) + '</b></div>' +
        '<div><i>SLA</i><b>' + fmt.wait(s.slaMin) + '</b></div>' +
        '</div></div>' +

        /* 审批链：这张单**要批到第几级、现在卡在谁那里**。
           此前详情只有「等级/等待/SLA」三个孤立字段，看不出"还差几级"。
           级数由该操作类型的**审批流配置**决定（见审批治理页「审批流配置」），
           条件路由（如"影响用户 > 10万 时增加安全负责人"）也在这里显性化。 */
        aprChainCard(s, typeText, state, h, fmt, stage2Waiting, cover, decided) +

        (stage2Waiting ? '<div class="card"><div class="card-h"><h3>二级审批</h3>' +
          '<span class="card-sub">' + h.pill('warn', '待审') + '</span></div>' +
          '<div class="kv">' +
          '<div><i>一级结论</i><b>已通过 · ' + h.esc(cover.by || '我') + '</b></div>' +
          '<div><i>一级理由</i><b>' + h.esc(cover.reason || '—') + '</b></div>' +
          '<div><i>审批人</i><b>二级审批人</b></div>' +
          '</div></div>' : '') +

        '<div class="card"><div class="card-h"><h3>影响面</h3>' +
        '<span class="card-sub">' + (s.targetId ? '按关联对象的引用关系反查' : '文本描述 · 本单据未关联具体对象') + '</span></div>' +
        '<div class="bt-note">' + h.esc(s.impact) + '</div>' +
        /* v31：影响面此前是**有来源没有去向**的只读面板 —— 读完「影响 7 个引用方」，
           没有任何入口能知道是哪 7 个。这里补两个真出口：
             ① 受影响对象清单：APP_DATA.refsOf(targetId) 反查全站引用，逐行可跳到该对象；
             ② 打开关联对象：按单据类型映射到对应详情页（Agent / MCP / 画像 / 沙盒 / 知识库 / 经验）。
           两条都拿不到（无 targetId）时，按本仓惯例标「（…，只读）」，不挂假按钮。 */
        (function () {
          var refs = (global.V31REFS && s.targetId) ? global.V31REFS.impactRefs(s) : [];
          var acts = [];
          if (refs.length) {
            acts.push('<button class="btn-ghost sm" data-act="apr-impact-refs" data-id="' + h.esc(s.id) + '">看受影响对象清单（' + refs.length + '）→</button>');
          }
          if (s.targetId) {
            acts.push('<button class="btn-ghost sm" data-act="apr-open-target" data-id="' + h.esc(String(s.type || '') + '|' + s.targetId) + '">打开关联对象 →</button>');
          }
          if (!acts.length) {
            return '<div class="bt-note" style="margin-top:10px">（本单据未关联具体对象，影响面为文本描述，只读）</div>';
          }
          return '<div class="gray-acts" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' + acts.join('') +
            '<span class="pick-or">清单由全站引用反查得出，不含本单据自身</span></div>';
        })() +
        '</div>' +

        (s.targetId ? '<div class="card"><div class="card-h"><h3>关联对象</h3></div>' +
          '<div class="kv"><div><i>对象</i><b class="mono">' + h.esc(s.targetId) + '</b></div></div></div>' : '') +

        (decided ? '<div class="card"><div class="card-h"><h3>审批结果</h3></div>' +
          '<div class="kv">' +
          '<div><i>结论</i><b>' + h.pill(s.decided === 'approved' ? 'ok' : 'bad', s.decided === 'approved' ? '通过' : '驳回') + '</b></div>' +
          '<div><i>审批人</i><b>' + h.esc(s.decidedBy) + '</b></div>' +
          '<div><i>理由</i><b>' + h.esc(s.reason || '—') + '</b></div>' +
          '</div></div>' : '') +

        actBtn;
    } else if (active === 'audit') {
      /* P2 链路时间线：从单据字段 + 覆盖层推导，不再只有发起信息 */
      var line = '<div><i>发起</i><b>' + h.esc(s.applicant) + ' · ' + fmt.wait(s.waitMin) + ' 前</b></div>';
      if (stage2Waiting) {
        line += '<div><i>一级审批</i><b>' + h.pill('ok', '通过') + ' · ' + h.esc(cover.by || '我') +
          (cover.reason ? ' · ' + h.esc(cover.reason) : '') + '</b></div>';
        line += '<div><i>二级审批</i><b>' + h.pill('warn', '等待二级审批') + ' · 审批人：二级审批人</b></div>';
      } else if (decided) {
        line += '<div><i>结论</i><b>' + h.pill(s.decided === 'approved' ? 'ok' : 'bad', s.decided === 'approved' ? '通过' : '驳回') +
          ' · ' + h.esc(s.decidedBy) + '</b></div>';
        line += '<div><i>理由</i><b>' + h.esc(s.reason || '—') + '</b></div>';
      } else {
        line += '<div><i>状态</i><b>' + h.pill('warn', '待处理') + ' · 等待审批人处理</b></div>';
      }
      body = '<div class="card"><div class="card-h"><h3>审计记录</h3>' +
        '<span class="card-sub">审批流全程留痕</span></div>' +
        '<div class="kv">' + line + '</div></div>';
    }

    var TABS = [
      { key: 'review', label: '审批' },
      { key: 'audit', label: '审计' }
    ];
    var crumb = h.pageCrumb([cap.name, '审批']);
    return '<div class="page-head"><div class="ph-main">' + crumb +
      '<div class="ph-title">' + h.esc(s.title) + '</div>' +
      '<div class="ph-desc">' + h.esc(typeText) + ' · 申请人 ' + h.esc(s.applicant) + '</div></div></div>' +
      h.detailTabs(cap, { objTab: active }, TABS, h) + body +
      h.metaBar({}, []);
  };

  /* ==================================================== 合规详情 */
  R.complianceDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var q = h.app.getQueues ? h.app.getQueues().compliance : null;
    var items = (q && q.items) || [];
    var s = byId(items, state.objId || state.agentId);
    if (!s) return h.detailMissing(cap, state, h);
    var active = state.objTab || state.tab || 'review';

    var body = '';
    if (active === 'review') {
      body =
        '<div class="card"><div class="card-h"><h3>违规内容</h3>' +
        '<span class="card-sub">' + h.pill(s.levelKind, s.level) + '</span></div>' +
        '<div class="bt-note" style="font-size:14px">' + h.esc(s.summary) + '</div></div>' +

        '<div class="card"><div class="card-h"><h3>命中规则</h3>' +
        '<span class="card-sub">判定来自合规检查节点，命中可核</span></div>' +
        '<div class="kv">' +
        '<div><i>规则</i><b>' + h.esc(s.rule) + '</b></div>' +
        '<div><i>来源 Agent</i><b>' + h.esc(s.agentName) + '</b></div>' +
        '<div><i>等待时长</i><b>' + fmt.wait(s.waitMin) + '</b></div>' +
        '</div>' +
        /* v31：命中规则此前只有「规则名 + 来源 Agent」两个字段，看完没有任何去向。
           出口：到可观测的 Trace 检索里筛出「合规拦截（E_COMPLIANCE）× 该来源 Agent」的真实调用明细。
           诚实：检索页没有「按规则名筛选」的维度，所以按错误码 + Agent 收敛 —— 两个键都是
           traceSearchBlock 真读的 state.filters 键，不是写了个没人读的状态。 */
        '<div class="gray-acts" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn-ghost sm" data-act="cp-rule-hits" data-id="' + h.esc(s.id) + '">看该规则的命中调用 →</button>' +
        '<span class="pick-or">按错误码 E_COMPLIANCE ＋ 来源 Agent 收敛（检索页无「按规则名筛选」维度）</span>' +
        '</div></div>' +

        '<div class="gray-acts">' +
        '<button class="btn-ghost ok" data-act="cp-decide" data-id="' + h.esc(s.id) + '|pass">判误报 · 放行</button>' +
        '<button class="btn-danger" data-act="cp-decide" data-id="' + h.esc(s.id) + '|reject">判违规 · 拦截</button>' +
        '<button class="btn-ghost" data-act="cp-decide" data-id="' + h.esc(s.id) + '|escalate">转人工</button>' +
        '</div>';
    } else if (active === 'audit') {
      body = '<div class="card"><div class="card-h"><h3>复核记录</h3></div>' +
        '<div class="kv">' +
        '<div><i>级别</i><b>' + h.pill(s.levelKind, s.level) + '</b></div>' +
        '<div><i>来源</i><b>' + h.esc(s.agentName) + '</b></div>' +
        '<div><i>规则</i><b>' + h.esc(s.rule) + '</b></div>' +
        '</div></div>';
    }

    var TABS = [
      { key: 'review', label: '复核' },
      { key: 'audit', label: '记录' }
    ];
    var crumb = h.pageCrumb([cap.name, '复核']);
    return '<div class="page-head"><div class="ph-main">' + crumb +
      '<div class="ph-title">合规复核</div>' +
      '<div class="ph-desc">' + h.esc(s.rule) + ' · ' + h.esc(s.agentName) + '</div></div></div>' +
      h.detailTabs(cap, { objTab: active }, TABS, h) + body +
      h.metaBar({}, []);
  };

  /* 审批动作：通过 / 驳回 / 转交（走影响面确认，理由必填，写入 aprOps 覆盖层） */
  var A = global.ACTIONS;
  /* 🔴 #3「单人＋AI 联审」：仅在 P0 开放，且**必须显式选择**（不自动降级）。
     四项必填：异常方是谁 / 异常事由 / AI 预检结论 / 本人承担声明。
     AI 只做**合规预检与风险提示**，**不单独构成一票** —— 界面与审计都要写清这一点。 */
  A['ap-single-ai'] = function (id, btn, h) {
    var itemId = String(id).split('|')[0];
    var q = h.app.getQueues().approval;
    var s = byId(q.items, itemId);
    if (!s) { h.toast('未找到该审批单', 'bad'); return; }
    var lv = String(s.level || '').toUpperCase();
    if (lv !== 'P0') {
      h.toast('「单人＋AI 联审」仅在最高级（P0）开放 —— 本单是 ' + (s.level || '—') + '；P1–P3 按单级审批走', 'bad');
      return;
    }
    /* AI 预检：**确定性示例**（本原型无真实模型），逐项给出结论并标注 */
    var rng = (h.seed && h.seed.R && h.seed.R.of) ? h.seed.R.of('ap-ai|' + s.id) : function () { return 0.5; };
    var PRE = [
      { k: '金额/影响面是否越权', pass: rng() > 0.25 },
      { k: '是否命中不可逆操作', pass: rng() > 0.35 },
      { k: '是否缺关键附件或依据', pass: rng() > 0.30 },
      { k: '是否与既有政策冲突', pass: rng() > 0.20 }
    ];
    var fails = PRE.filter(function (x) { return !x.pass; });
    var verdict = fails.length ? ('预检发现 ' + fails.length + ' 项需人工确认：' + fails.map(function (x) { return x.k }).join('、'))
                              : '预检未发现阻断项';
    h.dangerConfirm(h, {
      title: '单人＋AI 联审（最高级 P0）',
      desc: '一方审批人异常时，由本人 + AI 预检完成本次审批。**AI 不单独构成一票**，决定由本人做出并承担。',
      tone: 'danger',
      perm: 'approval:decide:approve',
      impacts: [
        { label: '单据', value: s.title + '（' + lv + '）' },
        { label: '为什么可用此通道', value: '一方审批人异常：休假/长期离岗 · 离职或权限失效 · 超 SLA 未响应' },
        { label: 'AI 预检结论', value: verdict, tone: fails.length ? 'warn' : '' }
      ].concat(PRE.map(function (x) {
        return { label: '预检 · ' + x.k, value: x.pass ? '通过' : '需人工确认', tone: x.pass ? '' : 'warn' };
      })).concat([
        { label: '必填项 ①', value: '异常方是谁（一级 / 二级）' },
        { label: '必填项 ②', value: '异常事由（含时间与凭证）' },
        { label: '必填项 ③', value: 'AI 预检结论已阅（上方）' },
        { label: '必填项 ④', value: '本人承担声明 —— 请把四项一并写进下方理由' },
        { label: '留痕', value: '审计将标注「**单人＋AI 联审**」，与双人审批在审计上可区分', tone: 'warn' },
        { label: '数据性质', value: '⚠ AI 预检为**确定性示例**（非真实模型输出）' }
      ]),
      requireReason: true,
      confirmText: '确认以单人＋AI 完成',
      action: '单人＋AI 联审', target: s.id + ' · ' + s.title,
      auditImpact: 'P0 单人＋AI 联审：' + verdict,
      onConfirm: function (reason) {
        var st0 = (global.APP_SHELL && global.APP_SHELL.state) || (h.state || {});
        st0.aprOps = st0.aprOps || {};
        var me = (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me() : { name: '我', id: 'me' };
        /* 与普通审批**不同的标记**：singleAi 让审计与列表能一眼区分 */
        st0.aprOps[s.id] = {
          s: 'approved', reason: reason || '', by: me.name, byId: me.id,
          singleAi: { at: new Date().toISOString(), ai: verdict, aiFails: fails.length,
                      basis: '一方审批人异常；AI 预检为确定性示例' },
          stage1: null, stage2: null
        };
        if (global.V19GOV && global.V19GOV.auditDecide) {
          global.V19GOV.auditDecide({
            decision: '【单人＋AI 联审】通过',
            title: s.title + '（' + lv + ' · AI 预检：' + verdict + '）',
            target: s.id, reason: reason || ''
          });
        }
        h.toast('已以「单人＋AI 联审」完成 —— 审计已标注，可在审计抽屉核对', 'warn');
        h.navigate({}, { scroll: false });
      }
    });
  };

  A['ap-decide'] = function (id, btn, h) {
    var parts = String(id).split('|');
    var itemId = parts[0], decision = parts[1];
    var q = h.app.getQueues().approval;
    var s = byId(q.items, itemId);
    if (!s) { h.toast('未找到该审批单'); return; }
    var map = { approve: ['通过', 'ok', 'approval:decide:approve'], reject: ['驳回', 'bad', 'approval:decide:reject'], escalate: ['转交上级', 'warn', 'approval:decide:escalate'] };
    var label = map[decision][0], tone = map[decision][1];
    /* 权限点必须是注册表里的「叶子」名：角色持有的是 approval:decide:*（展开成 :approve/:reject/:escalate），
       写成父级 approval:decide 两者都匹配不上 → 5 个审批动作全被拦（列表页用的是叶子名，两处声明必须一致） */
    var needPerm = map[decision][2];
    /* 🔴 B3：SoD 校验在 handler 内 —— 此前只在 render 层隐藏按钮，从列表页/直接调用可绕过 */
    var _st0 = (global.APP_SHELL && global.APP_SHELL.state) || (h.state || {});
    var _cover = (_st0.aprOps || {})[s.id] || null;
    if (global.V19GOV && typeof global.V19GOV.checkSoD === 'function') {
      var _sod = global.V19GOV.checkSoD(s, decision, _cover);
      if (!_sod.ok) { h.toast(_sod.msg, 'bad'); return; }
    }
    h.dangerConfirm(h, {
      title: (label === '通过' ? '通过' : (label === '驳回' ? '驳回' : '转交')) + '「' + s.title + '」？',
      desc: '审批决定会写入审计，需说明理由。',
      impacts: [
        { label: '单据', value: s.title + ' · ' + s.level },
        { label: '影响面', value: s.impact, tone: decision === 'approve' ? 'warn' : '' },
        { label: '申请人', value: s.applicant }
      ],
      requireReason: true,
      confirmText: label, danger: decision !== 'escalate', perm: needPerm,
      action: (decision === 'approve' ? '通过审批单' : (decision === 'reject' ? '驳回审批单' : '转交上级')),
      target: s.id + ' · ' + s.title,
      auditImpact: '审批单 ' + s.id + ' 将变为「' + label + '」，决定写入审计日志',
      onConfirm: function (reason) {
        /* P0：与列表页共写 aprOps 覆盖层（renderers2.js 写入 / v19-governance-fix.js 织入消费） */
        var st = (global.APP_SHELL && global.APP_SHELL.state) || (h.state || {});
        st.aprOps = st.aprOps || {};
        var stages = (global.V19GOV && global.V19GOV.needStages) ? global.V19GOV.needStages(s.level) : 1;
        var isStage2Pass = stages > 1 && s.stage2;
        var meNow = (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me() : { name: '我', id: 'me' };
        var prev = st.aprOps[s.id] || {};
        /* 🔴 B3：stage1 记录**一级审批人身份与时间** —— 此前只有布尔 stage2 + 字面量 by:'我'，
           导致"双审"无法校验是否同一人（NIST AC-5 要求 different individuals） */
        st.aprOps[s.id] = (stages > 1 && !s.stage2 && decision === 'approve')
          ? { s: 'pending-stage2', reason: reason || '', by: meNow.name, byId: meNow.id,
              stage1: (global.V19GOV && global.V19GOV.stage1Record) ? global.V19GOV.stage1Record(reason) : null,
              stage2: 'pending' }
          : { s: decision, reason: reason || '', by: meNow.name, byId: meNow.id,
              stage1: prev.stage1 || null,
              stage2: (stages > 1) ? { byId: meNow.id, byName: meNow.name, at: new Date().toISOString() } : null };
        /* 审计结论 + 理由：V19GOV 优先，V10UI.audit 兜底 */
        if (global.V19GOV && typeof global.V19GOV.auditDecide === 'function') {
          global.V19GOV.auditDecide({ decision: label, title: s.title, target: s.id, reason: reason });
        } else if (global.V10UI && typeof global.V10UI.audit === 'function') {
          global.V10UI.audit('decision', { decision: label, title: s.title, target: s.id, reason: reason });
        }
        h.toast('已' + label + (stages > 1 && !s.stage2 ? '（一级）· 待二级审批' : ''), 'ok');
        if (h.navigate) h.navigate({}, { scroll: false });
      }
    });
  };

  /* 合规动作：判误报 / 判违规 / 转人工（写 aprOps 覆盖层，理由必填） */
  A['cp-decide'] = function (id, btn, h) {
    var parts = String(id).split('|');
    var itemId = parts[0], decision = parts[1];
    var q = h.app.getQueues().compliance;
    var s = byId(q.items, itemId);
    if (!s) { h.toast('未找到该复核项'); return; }
    var map = { pass: ['判误报 · 放行', 'ok', false], reject: ['判违规 · 拦截', 'bad', true], escalate: ['转人工', 'warn', false] };
    /* 🔴 形如 `cp-1`（少了 `|pass` / `|reject` / `|escalate`）的 id 此前直接走 `map[undefined][0]`
       → TypeError：控件点了没反应、控制台报错 —— 正是本仓最忌讳的一类。
       合规判定**不能替用户默认**（默认一个结论等于替人做决定），所以只有如实说清缺什么、不做任何变更。 */
    if (!map[decision]) {
      h.toast('缺少判定动作（应形如 cp-1|pass / cp-1|reject / cp-1|escalate）—— 未做任何变更', 'bad');
      return;
    }
    var label = map[decision][0], tone = map[decision][1], danger = map[decision][2];
    h.dangerConfirm(h, {
      title: label + '？',
      desc: '复核决定会写入合规审计。',
      impacts: [
        { label: '内容', value: s.summary },
        { label: '规则', value: s.rule },
        { label: '来源', value: s.agentName }
      ],
      requireReason: true,
      confirmText: label, danger: danger, perm: 'compliance:decide',
      action: (decision === 'pass' ? '判误报放行' : (decision === 'reject' ? '判违规拦截' : '转人工')),
      target: s.id + ' · ' + s.rule,
      auditImpact: '合规复核项 ' + s.id + ' 将变为「' + label + '」，决定写入合规审计日志',
      onConfirm: function (reason) {
        /* P0：与列表页共写 aprOps 覆盖层 */
        var st = (global.APP_SHELL && global.APP_SHELL.state) || (h.state || {});
        st.aprOps = st.aprOps || {};
        st.aprOps[s.id] = { s: decision, reason: reason || '', by: '我' };
        /* 审计结论 + 理由：V19GOV 优先，V10UI.audit 兜底 */
        if (global.V19GOV && typeof global.V19GOV.auditDecide === 'function') {
          global.V19GOV.auditDecide({ decision: label, title: s.rule, target: s.id, reason: reason });
        } else if (global.V10UI && typeof global.V10UI.audit === 'function') {
          global.V10UI.audit('decision', { decision: label, title: s.rule, target: s.id, reason: reason });
        }
        h.toast('已' + label, 'ok');
        if (h.navigate) h.navigate({}, { scroll: false });
      }
    });
  };

})(window);
