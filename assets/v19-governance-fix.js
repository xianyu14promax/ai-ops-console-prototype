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
        x.approver = '已标记外部处理';   /* 2026-10-28：原「上级审批人（已转交）」—— 没有上级 */
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

    /* ---------- GOV 工具箱：统一的审批/权限公共入口 ---------- */
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
      /* 2026-10-28：原来的「审计落库」方法随审计一起删除（业主：这系统只负责一个账号） */
      /* 2026-10-28 改：单人系统里「职责分离」不再是**禁止**，而是**如实标记**。
         原实现两条约束都建立在「存在第二个人」的前提上；单账号下它们会让**每一张单据都无人可批**
         （申请人恒等于审批人）—— 那不是合规，是死锁。现在：
           ① 自批：允许，但返回值带 selfApproval，调用方须在界面上写明「本人审批」；
           ② 双审异人：整条删除 —— 同一个人不可能「不是同一个人」。
         真正替代多人的是「确认强度」：P0 要确认两次（see needStages）。 */
      checkSoD: function (it, decision, cover) {
        var me = global.V19GOV.me();
        if (!it) return { ok: true, selfApproval: false };
        var self = !!(it.mine || it.applicant === me.name);
        if (self) return { ok: true, selfApproval: true, note: '本人审批（本系统只有这一个账号）' };
        return { ok: true, selfApproval: false };
      },
      /* 一次确认的事实记录（供 stage1 落库） */
      stage1Record: function (reason) {
        var me = global.V19GOV.me();
        return { byId: me.id, byName: me.name, role: me.role, at: new Date().toISOString(), reason: reason || '' };
      },
      /* P0 单据要确认两次：第一次通过后进 stage2，等**本人**再确认一次才算 approved。
         这不是「两个人」，是同一件事看两遍 —— 单人系统里唯一能加的强度。 */
      DUAL_LEVELS: { P0: 2, P1: 1, P2: 1, P3: 1 },
      needStages: function (level) {
        return (global.V19GOV.DUAL_LEVELS[String(level || '').toUpperCase()] || 1);
      }
    };
  });
})(window);
