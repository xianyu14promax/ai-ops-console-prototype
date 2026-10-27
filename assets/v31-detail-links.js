/* ============================================================================
 * v31-detail-links.js · 详情页「只读块」的出口（2026-10-12）
 *
 * 背景：9 处详情页的决策依据是**有来源、没有去向**的只读面板 —— 看完一个数字，
 *       没有任何办法走到「这个数字对应哪些对象 / 哪些调用」。
 * 本文件负责注册这些出口的动作。渲染层的挂载点分两类：
 *   · v10-detail-gov.js / v10-detail-asset.js / v10-detail-sandbox.js（本工程可改）——
 *     元素已在本文件之后由渲染层挂上（见各渲染器里的 data-act）；
 *   · renderers2.js（归 Agent 丙，**本工程不碰**）—— 只注册动作，挂载见交接清单。
 *
 * 铁律：全 ES5；只注册 ACTIONS，不改任何渲染器本体；每个出口都必须真的到东西 ——
 *       能筛就带上筛选条件，筛不了的如实说明，绝不做空的抽屉/弹层。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var A = (global.ACTIONS = global.ACTIONS || {});

  function ready(fn) {
    if (global.APP_DATA && global.ACTIONS) { fn(); return; }
    var t = global.setInterval(function () {
      if (global.APP_DATA && global.ACTIONS) { global.clearInterval(t); fn(); }
    }, 25);
  }

  ready(function () {
    var Q = global.QUERY || {};

    /* ---------------------------------------------------------------- 公共小件 */
    function esc(h, s) { return h && h.esc ? h.esc(s) : String(s == null ? '' : s); }
    function clip(s, n) {
      var t = String(s == null ? '' : s);
      return t.length > n ? (t.slice(0, n) + '…') : t;
    }
    function sheet(h, title, bodyHtml, footHtml) {
      if (!global.V10UI || typeof global.V10UI.openSheet !== 'function') {
        h.toast('弹层组件未加载，无法列出清单', 'bad');
        return null;
      }
      return global.V10UI.openSheet({
        title: title,
        bodyHtml: bodyHtml,
        footHtml: footHtml || '<button class="btn-ghost" data-v10="close">关闭</button>',
        /* 清单里的每一行都是跳转按钮：点了要先收起这个弹层 ——
           否则它会盖在刚跳过去的页面上（go-detail 只收 .modal-mask，不收 .v10-sheet-mask）。 */
        onOpen: function (root) {
          if (!root || !root.addEventListener) return;
          root.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
            if (b && global.V10UI && global.V10UI.closeSheet) global.V10UI.closeSheet();
          });
        }
      });
    }
    /* 引用方 → 可落地的跳转。找不到落点的一律返回 null（渲染成「只列出处」，不假装能点）。
       2026-10-20：Workflow 一页下线，映射表里的 workflow 一项删除 ——
       引用集合里若还出现 workflow，就按「没有详情页，只列出处」处理，不再拼一条死路由。 */
    var CAP_OF = {
      persona: 'persona', kb: 'knowledge', sandbox: 'sandbox',
      experience: 'llm-exp', approval: 'approval', compliance: 'compliance'
    };
    var SANDBOX_SUB = ['sandbox_execution', 'sandbox_event', 'sandbox_data_binding',
      'sandbox_tool_binding', 'sandbox_credential', 'sandbox_network_rule'];
    function refRoute(ref) {
      if (!ref) return null;
      var c = ref.collection, row = ref.row || {};
      if (c === 'agent') return { act: 'goto-agent', id: ref.id, to: 'Agent 详情' };
      if (c === 'incident') return { act: 'goto-cap', id: 'overview', to: '工作台总览 › 事故流水' };
      if (c === 'deploy') return { act: 'goto-cap', id: 'agent-wb', to: 'Agent 工作台' };
      if (c === 'badcase') return { act: 'goto-cap', id: 'obs', to: '可观测 › badcase 管理' };
      if (c === 'userops') return { act: 'goto-cap', id: 'user-ops', to: '用户运营' };
      if (c === 'evolution') return { act: 'goto-cap', id: 'evo', to: '自进化控制台' };
      if (SANDBOX_SUB.indexOf(c) > -1) {
        return row.sandboxId ? { act: 'go-detail', id: 'sandbox|' + row.sandboxId, to: '沙盒详情' } : null;
      }
      if (CAP_OF[c]) {
        /* 经验库 / 审批 / 合规 / 画像 / 知识库 / 沙盒都走对象详情（data.js 的 detailType 路由） */
        return { act: 'go-detail', id: CAP_OF[c] + '|' + ref.id, to: '对象详情' };
      }
      return null;
    }

    /* ---------------------------------------------------------------- ① 审批单 · 影响面 */
    /* 「受影响对象清单」= APP_DATA.refsOf(targetId) 去掉**本单据自己**（申请单自身也带 targetId 字段，
       不排除的话 ap-2 这种只有自己的单据会被算成「1 个引用方」，那是假数字）。 */
    function impactRefsOf(s) {
      if (!s || !s.targetId) return [];
      var A2 = global.APP_DATA;
      if (!A2 || typeof A2.refsOf !== 'function') return [];
      return A2.refsOf(s.targetId).filter(function (r) {
        return !(r.collection === 'approval' && r.id === s.id);
      });
    }
    /* 供渲染层（v10-detail-gov.js）决定要不要挂「受影响对象清单」按钮 —— 一条也不列就不挂 */
    global.V31REFS = { impactRefs: impactRefsOf, routeOf: refRoute };

    A['apr-impact-refs'] = function (id, btn, h) {
      var q = h.app.getQueues().approval;
      var s = null, items = (q && q.items) || [];
      for (var i = 0; i < items.length; i++) if (items[i].id === id) s = items[i];
      if (!s) { h.toast('未找到该审批单', 'bad'); return; }
      var refs = impactRefsOf(s);
      if (!refs.length) {
        h.toast('本单据的关联对象（' + (s.targetId || '—') + '）没有被其它对象引用，没有可列的引用方', 'info');
        return;
      }
      var rows = refs.map(function (r) {
        var rt = refRoute(r);
        var name = r.name || r.id;
        return '<div class="bt-note" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<b>' + esc(h, name) + '</b>' +
          '<span class="mono">' + esc(h, r.id) + '</span>' +
          '<span class="muted">' + esc(h, r.collection + ' · ' + r.field) + '</span>' +
          (rt
            ? '<button class="lnk" data-act="' + esc(h, rt.act) + '" data-id="' + esc(h, rt.id) + '">' + esc(h, rt.to) + ' →</button>'
            : '<span class="muted">（该集合没有详情页，只列出处）</span>') +
          '</div>';
      }).join('');
      sheet(h, '受影响对象清单 · ' + refs.length + ' 个引用方',
        '<div class="bt-note">对象 <b class="mono">' + esc(h, s.targetId) + '</b> 在下列集合里被引用（扫的是全站维度表 / 队列 / 流水线，'
        + '不含本单据自身）。引用一条不代表该引用一定受影响 —— 判断依据是它引用的字段语义。</div>' + rows,
        '<button class="btn-ghost" data-v10="close">关闭</button>');
    };

    /* 关联对象 → 该方向的详情页（渲染层只传 <type>|<targetId>，映射收在这一处） */
    A['apr-open-target'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var type = p[0] || '', target = p[1] || '';
      if (!target) { h.toast('本单据没有关联对象（影响面只有文本描述）', 'info'); return; }
      if (type === 'agent-publish' || type === 'prompt-update' || type === 'prompt-batch') {
        A['goto-agent'](target, btn, h); return;
      }
      if (type === 'mcp-open') { A['gw-open'](target + '|config', btn, h); return; }
      var MAP = {
        'persona-change': 'persona', 'kb-sync': 'knowledge', 'sandbox-net': 'sandbox',
        'exp-review': 'llm-exp', 'rule-publish': 'compliance'
      };
      var capId = MAP[type];
      if (!capId) { h.toast('该类型的关联对象没有可达的详情页（' + (type || '未知类型') + '）', 'info'); return; }
      A['go-detail'](capId + '|' + target, btn, h);
    };

    /* ---------------------------------------------------------------- ② 合规复核 · 命中规则 */
    /* 诚实口径：检索页**没有**「按规则名筛选」的维度，能真筛的是错误码 E_COMPLIANCE（合规拦截）
       + 该条目的来源 Agent（两者都是 traceSearchBlock 真读的 state.filters 键）。 */
    A['cp-rule-hits'] = function (id, btn, h) {
      var q = h.app.getQueues().compliance;
      var s = null, items = (q && q.items) || [];
      for (var i = 0; i < items.length; i++) if (items[i].id === id) s = items[i];
      if (!s) { h.toast('未找到该复核项', 'bad'); return; }
      h.state.filters = { errCode: 'E_COMPLIANCE', agentId: s.agentId || null };
      h.state.page = 1;
      h.navigate({ domain: 'platform', cap: 'obs', agentId: null, objId: null, tab: 'trace', objTab: null, traceId: null, page: 1 });
      h.toast('已筛出「合规拦截（E_COMPLIANCE）」× 来源 Agent「' + (s.agentName || s.agentId || '—') + '」的调用明细 —— '
        + '检索页没有按规则名筛选的维度，命中历史按错误码与 Agent 收敛；规则「' + clip(s.rule, 24) + '」的判定逻辑见合规规则的规则包', 'info');
    };

    /* ---------------------------------------------------------------- ③ 画像详情 · 命中构成 */
    /* 命中构成里的每一条（规模 / 省份 / 标签）= 企业清单的搜索词 —— 点一下就是**真筛选**
       （personaFirmsTab 读 state.filters.firmQ，与搜索框回车走同一个键）。id 传空串 = 清除。 */
    A['persona-firm-q'] = function (id, btn, h) {
      var v = String(id == null ? '' : id).trim();
      h.state.filters = h.state.filters || {};
      if (v) h.state.filters.firmQ = v;
      else delete h.state.filters.firmQ;
      h.navigate({}, { scroll: false });
      h.toast(v ? ('企业清单已按「' + v + '」过滤') : '已清除企业清单的筛选', v ? 'ok' : 'info');
    };

    /* ---------------------------------------------------------------- ④ 沙盒详情 · S0–S5 对照 */
    /* 沙盒列表页（v10-detail-sandbox.js）的筛选真正读 state.sbxFilter.level（本次同批加入），
       所以「看同等级的其他沙盒」是一次**真筛选**的跳转，不是一个假的入口。 */
    A['sbx-level-peers'] = function (id, btn, h) {
      var lv = String(id == null ? '' : id).trim();
      if (!lv) { h.toast('未指定隔离等级', 'bad'); return; }
      var rows = [];
      try { rows = h.app.getAssetTables().sandbox.rows || []; } catch (e) { rows = []; }
      var n = rows.filter(function (r) { return r.sLevel === lv; }).length;
      h.state.sbxFilter = { level: lv };
      h.navigate({ domain: 'platform', cap: 'sandbox', agentId: null, objId: null, tab: null, objTab: null, traceId: null, page: 1 });
      h.toast('沙盒列表已按隔离等级「' + lv + '」过滤（' + n + ' / ' + rows.length + ' 个）—— 清除按钮在当前条的右侧筛选行', 'ok');
    };

    /* ---------------------------------------------------------------- ⑤ 以下 4 个动作由 Agent 丙接线 ----
     * 渲染元素在 renderers2.js（本工程不允许改），动作在这里注册好，语义与 data-id 见交接清单。
     * --------------------------------------------------------------------------------------------- */

    /* (a) Agent 详情 › 成本 Tab › 节点级成本：节点级数字的落点是**该 Agent 的调用明细**。
       诚实：trace 检索没有「按节点筛选」维度，所以按 Agent 收敛；要看节点配置走既有的 goto-agent-tab "<agentId>|orchestrate"。 */
    A['agent-cost-traces'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var agentId = p[0] || '';
      if (!agentId) { h.toast('未指定 Agent', 'bad'); return; }
      h.state.filters = { agentId: agentId };
      h.state.page = 1;
      h.navigate({ domain: 'platform', cap: 'obs', agentId: null, objId: null, tab: 'trace', objTab: null, traceId: null, page: 1 });
      h.toast('已按 Agent 筛出调用明细' + (p[1] ? '（节点「' + clip(p[1], 16) + '」：检索页没有按节点筛选的维度，要看该节点的配置请用编排配置页）' : ''), 'info');
    };

    /* (b) trace 详情 › 逐节点输入输出：失败节点 → 同类失败调用。
       id = "<errCode>|<agentId>"（agentId 可省略）；两者都是 state.filters 里真生效的键。 */
    A['trace-node-traces'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var errCode = p[0] || '', agentId = p[1] || '';
      if (!errCode && !agentId) { h.toast('该节点没有可用于筛选的错误码', 'info'); return; }
      var f = { status: 'failed' };
      if (errCode) f.errCode = errCode;
      if (agentId) f.agentId = agentId;
      h.state.filters = f;
      h.state.page = 1;
      h.navigate({ domain: 'platform', cap: 'obs', agentId: null, objId: null, tab: 'trace', objTab: null, traceId: null, page: 1 });
      h.toast('已筛出同类失败调用：' + (errCode ? '错误码 ' + errCode : '仅失败') + (agentId ? ' · Agent ' + agentId : ''), 'info');
    };

    /* (c) 可观测 › 评估任务 › 版本对比（v2.3 vs v2.4）：采用 / 回滚。
       2026-10-21：审批下线 —— 原先这里建一张审批单再跳到「审批存档 › 我发起的审批」，
       现在系统只有一个人，建单等于自己给自己看。改为**二次确认 + 强制理由 + 直接生效**。
       id = "<版本>|<目标 Agent 名>|<adopt|rollback>"。 */
    A['eval-version-adopt'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var ver = p[0] || '', target = p[1] || '', mode = p[2] || 'adopt';
      if (!ver) { h.toast('未指定版本', 'bad'); return; }
      var isRollback = mode === 'rollback';
      var title = (isRollback ? '回滚到 ' : '采用 ') + ver;
      h.dangerConfirm(h, {
        title: title,
        desc: target ? '影响对象：' + target : '',
        tone: isRollback ? 'warn' : 'normal',
        perm: 'agent:publish',
        requireReason: true,
        impacts: [
          { label: '版本', value: ver + (target ? '（' + target + '）' : '') },
          { label: '影响', value: isRollback ? '流量切回上一版，当前版本保留可再切回' : '该版本承接线上流量', tone: isRollback ? 'warn' : '' },
          { label: '可回滚', value: '是 —— 上一版保留' },
          { label: '这一步', value: '确认后立即生效，理由写进审计' }
        ],
        confirmText: isRollback ? '确认回滚' : '确认采用',
        action: title, target: target || ver,
        auditImpact: '版本切换 · ' + ver,
        onConfirm: function (reason) {
          /* 审计由 dangerConfirm 统一写，这里不重复记 */
          h.toast('已' + (isRollback ? '回滚到 ' : '采用 ') + ver + ' · 已写审计', 'ok');
          h.navigate({}, { scroll: 'keep' });
        }
      });
    };

    /* (d) 成本 › 按业务线 / 按模型归因：预算使用率 → 该业务线的调用明细。
       诚实：trace 检索**没有**「按业务线或模型筛选」的维度，所以先用一张清单把口径摊开
       （该业务线的 Agent + 区间内调用/成本，全部来自 costBreakdown 与 agentTable 的真实聚合），
       再由清单逐行下钻到单个 Agent 的调用明细（那一跳是真筛）。 */
    A['cost-biz-drill'] = function (id, btn, h) {
      var p = String(id == null ? '' : id).split('|');
      var isModel = p[0] === 'model';
      var key = isModel ? (p[1] || '') : (p[0] || '');
      if (!key) { h.toast('未指定归因维度', 'bad'); return; }
      var S = global.DATA_SEED || {};
      var built = Q.costBreakdown ? Q.costBreakdown(h.state.range) : null;
      var bucket = null, rows = built ? (isModel ? built.byModel : built.byBiz) : [];
      for (var i = 0; i < (rows || []).length; i++) if (rows[i].key === key) bucket = rows[i];
      if (!bucket) { h.toast('该归因维度在当前区间没有数据', 'info'); return; }
      var agents = (S.AGENTS || []).filter(function (a) {
        return isModel ? (a.model === key) : (a.biz === key);
      });
      var per = {};
      try {
        (h.query.agentTable(h.state.range).rows || []).forEach(function (r) { per[r.id] = r; });
      } catch (e) { per = {}; }
      var label = bucket.label || key;
      var body = '<div class="bt-note">' + (isModel ? '模型' : '业务线') + ' <b>' + esc(h, label) + '</b> · '
        + (Q.RANGES[h.state.range] ? Q.RANGES[h.state.range].label : h.state.range)
        + '：调用 ' + h.fmt.int(bucket.calls) + ' 次 · 成本 ' + h.fmt.money2(bucket.cost)
        + (bucket.budget ? (' · 预算 ' + h.fmt.money(bucket.budget)) : '')
        + '。<br>trace 检索没有「按' + (isModel ? '模型' : '业务线') + '筛选」的维度，所以这里先列出该' + (isModel ? '模型' : '业务线')
        + '的 Agent（真实归属与真实聚合），再逐行下钻到该 Agent 的调用明细 —— 每一跳都是真筛选。</div>';
      body += agents.map(function (a) {
        var r = per[a.id] || {};
        return '<div class="bt-note" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<b>' + esc(h, a.name) + '</b>' +
          '<span class="muted">' + esc(h, a.id) + '</span>' +
          '<span>调用 ' + h.fmt.int(r.calls || 0) + ' · 成本 ' + h.fmt.money2(r.cost || 0) + '</span>' +
          '<button class="lnk" data-act="agent-traces" data-id="' + esc(h, a.id) + '">看调用明细 →</button>' +
          '<button class="lnk" data-act="goto-agent-tab" data-id="' + esc(h, a.id) + '|cost">看节点级成本 →</button>' +
          '</div>';
      }).join('') || '<div class="bt-note">该' + (isModel ? '模型' : '业务线') + '当前没有绑定的 Agent。</div>';
      sheet(h, '下钻 · ' + label + ' 的调用明细', body, '<button class="btn-ghost" data-v10="close">关闭</button>');
    };
  });
})(window);
