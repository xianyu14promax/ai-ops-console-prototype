/* ============================================================================
 * v19-governance-fix.js · 权限治理与审批修复补丁（2026-10-05）
 *
 * 走查依据：走查-权限与审批-v19.md；界面参考：知识-权限治理与审批-界面参考-v1.md
 * 铁律：ES5 · 全部 monkey-patch，不改 app.js / data.js / v10-ui.js / renderers2.js 本体
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ready(fn) {
    if (global.APP_DATA && global.APP_DATA.getQueues && global.V10UI) { fn(); return; }
    var t = global.setInterval(function () {
      if (global.APP_DATA && global.APP_DATA.getQueues && global.V10UI) { global.clearInterval(t); fn(); }
    }, 25);
  }

  ready(function () {
    var A = global.APP_DATA;

    /* ---------- 覆盖层读取：状态真源 = APP_SHELL.state（renderers2 写入的就是它） ---------- */
    function aprOpsOf() {
      var sh = global.APP_SHELL;
      var s = (sh && sh.state) || {};
      return (s && s.aprOps) || {};
    }

    /* 单条 item 套覆盖层：返回新对象，不污染 mock 数据 */
    function applyCover(it) {
      var o = aprOpsOf()[it.id];
      if (!o) return it;
      var x = {};
      var k;
      for (k in it) {
        if (Object.prototype.hasOwnProperty.call(it, k)) x[k] = it[k];
      }
      if (o.s === 'escalated') {
        x.escalated = true;
        x.approver = '上级审批人（已转交）';
        x.escalateN = (it.escalateN || 0) + 1;
        x.decided = null;
      } else {
        x.decided = o.s;
        x.decidedBy = o.by || '我';
        x.reason = o.reason || '—';
        x.handledMin = (it.waitMin > 0 ? it.waitMin : 30);
        x.decidedDays = 0;
      }
      if (o.stage2) x.stage2 = o.stage2;
      return x;
    }

    /* ---------- 合规覆盖层：把「只声明未定义」的桥接补上 ----------
     * 🔴 此前 getQueues 里只有一句 `typeof global.__v19_complianceCover === 'function'` 的 guard，
     *    而**全仓没有任何地方定义它** ⇒ 这个桥接从来没生效过：详情页 cp-decide 写 state.aprOps，
     *    列表页读模块私有变量，两边互不可见（「判定成功、条目还在」）。
     * 现在定义它，读的是与详情页/审阅台**同一个真源** state.aprOps（三态 pass|reject|escalate）。
     * 只认合规三态 —— 审批队列的 approved/rejected/escalated/pending-stage2 由上面的 applyCover 处理。 */
    var COMP_DECISION = { pass: 1, reject: 1, escalate: 1 };
    global.__v19_complianceCover = function (it) {
      var o = aprOpsOf()[it && it.id];
      if (!o || !COMP_DECISION[o.s]) return null;
      var x = {};
      var k;
      for (k in it) {
        if (Object.prototype.hasOwnProperty.call(it, k)) x[k] = it[k];
      }
      x.decided = o.s;
      x.decidedBy = o.by || '我';
      x.decidedReason = o.reason || '—';
      return x;
    };

    /* ---------- F1: 织入 getQueues ---------- */
    var rawGetQueues = A.getQueues;
    A.getQueues = function () {
      var q = rawGetQueues.apply(A, arguments);
      try {
        if (q && q.approval && q.approval.items && q.approval.items.length) {
          q.approval.items = q.approval.items.map(applyCover);
        }
        /* 合规队列：批3 会挂 global.__v19_complianceCover(it) 返回覆盖字段或 null */
        if (q && q.compliance && q.compliance.items && q.compliance.items.length && typeof global.__v19_complianceCover === 'function') {
          q.compliance.items = q.compliance.items.map(function (it) {
            var cov = global.__v19_complianceCover(it);
            return cov ? cov : it;
          });
        }
        return q;
      } catch (e) {
        if (global.console) global.console.error('[v19-gov]', e);
        return rawGetQueues.apply(A, arguments);
      }
    };
    A.getQueues._v19patched = true;

    /* ---------- F2: 铃铛口径对齐（排除 mine，与审批页 KPI 同口径） ---------- */
    if (typeof A.pendingStats === 'function') {
      var rawPendingStats = A.pendingStats;
      A.pendingStats = function () {
        var st = rawPendingStats.apply(A, arguments);
        try {
          var q = rawGetQueues.call(A);
          var ap = (q && q.approval.items) || [];
          st.approvals = ap.filter(function (x) { return !x.decided && !x.mine && !x.escalated; }).length;
          return st;
        } catch (e) {
          if (global.console) global.console.error('[v19-gov]', e);
          return st;
        }
      };
    }

    /* ---------- GOV 工具箱：统一动作与审计的公共入口 ---------- */
    global.V19GOV = {
      /* 当前用户（另一会话已在 app.js 建 CURRENT_USER 单一身份源，这里只读） */
      me: function () {
        return global.CURRENT_USER || { name: 'xianyu', id: 'u102', role: '管理员' };
      },
      /* 自批拦截：申请人 = 当前用户 → true */
      isSelfApproval: function (it) {
        var me = global.V19GOV.me();
        return !!(it && (it.mine || it.applicant === me.name));
      },
      /* 审计留痕：结论/理由/决策人全字段（底层走 V10UI.audit，另一会话已补 actor） */
      auditDecide: function (o) {
        if (!global.V10UI || typeof global.V10UI.audit !== 'function') return;
        global.V10UI.audit({
          action: (o.decision || '') + '「' + (o.title || '') + '」',
          target: o.target || '',
          /* 🔴 各归其位：结论与理由此前被拼进 impact（影响面）字段，语义混用，*/
          /*    且理由因此不可按字段检索。现改为 decision / reason 独立字段。 */
          decision: o.decision || '',
          reason: (o.reason != null && o.reason !== '') ? String(o.reason) : null,
          impact: null,
          /* 🔴 不再显式传 null（由 audit() 兜底生成时间戳），保留传入时的值 */
          at: o.at || null,
          actor: global.V19GOV.me().name
        });
      },
      /* 🔴 B3：职责分离（SoD）共享校验 —— **供 handler 调用，不只拦在 render 层**。
         依据 NIST SP 800-53 AC-5："dividing ... among **different individuals**"
         两条约束：
           ① 自批禁止：申请人不得审批自己的单据
           ② 双审须异人：二级审批人必须与一级**不同人**（AC-5 原文要求）
         返回 { ok, code, msg }（不 ok 时 handler 必须中断，不得进入确认弹层） */
      checkSoD: function (it, decision, cover) {
        var me = global.V19GOV.me();
        if (!it) return { ok: true };
        /* ① 自批 */
        if (it.mine || it.applicant === me.name) {
          return { ok: false, code: 'SELF_APPROVAL',
            msg: '本人发起的单据由他人审批（申请人：' + (it.applicant || '本人') + '）' };
        }
        /* ② 双审须异人（仅对"通过"校验；驳回是对上一级的否定，不属双审） */
        var st1 = cover && cover.stage1;
        if (st1 && decision === 'approve' && st1.byId && st1.byId === me.id) {
          return { ok: false, code: 'SAME_APPROVER_BOTH_STAGES',
            msg: '本单据需两级审批，两级须为**不同的人**。一级已由「' + st1.byName +
                 '」于 ' + String(st1.at || '').slice(0, 16).replace('T', ' ') +
                 ' 通过 —— 二级需由其他审批人完成。可「转交」或登记「单人会签」并说明理由。' };
        }
        return { ok: true };
      },
      /* 一级审批事实（供 stage1 落库；byId 用于"异人"校验） */
      stage1Record: function (reason) {
        var me = global.V19GOV.me();
        return { byId: me.id, byName: me.name, role: me.role, at: new Date().toISOString(), reason: reason || '' };
      },
      /* P0 单据双审两段：一级通过后进入 stage2，仍待二级审批人；两个不同人全过才算 approved */
      DUAL_LEVELS: { P0: 2, P1: 1, P2: 1, P3: 1 },
      needStages: function (level) {
        return (global.V19GOV.DUAL_LEVELS[String(level || '').toUpperCase()] || 1);
      }
    };
  });
})(window);
