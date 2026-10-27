/* ============================================================================
 * v23-exp-agent-link.js · 经验库「单 Agent 私有」口径落地补丁（2026-10-05）
 *
 * 做两件事，都是遗留清单里点名的断头路：
 *   ① 升级为共享（遗留 1）—— 详情页「引用 Agent」里写着"走「升级为共享」并重新验证"，
 *      但全站根本没有这个入口，属于承诺了做不到的断头路。
 *   ② Agent 详情页看自己的经验（遗留 5）—— 经验库说"归属谁"，却没法从 Agent 反查"我有哪些经验"，
 *      单向可见；单 Agent 私有这条口径只在经验库侧成立，在 Agent 侧落不了地。
 *
 * 铁律：ES5 · 全部 monkey-patch，不改 app.js / data.js / renderers.js / renderers2.js / v10-detail-asset.js 本体。
 * 加载位置与 v19-governance-fix.js 相同（app.js 之前），故用 ready() 轮询等依赖就绪。
 * 后处理不走 APP_DATA.render（不存在），改用 MutationObserver 监听 #content —— 每次 innerHTML 替换都触发。
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ready(fn) {
    var need = ['DATA_SEED', 'RENDERERS', 'APP_DATA', 'ACTIONS', 'V10UI'];
    function ok() {
      for (var i = 0; i < need.length; i++) { if (!global[need[i]]) return false; }
      return true;
    }
    if (ok()) { fn(); return; }
    var t = global.setInterval(function () { if (ok()) { global.clearInterval(t); fn(); } }, 25);
  }

  ready(function () {
    var S = global.DATA_SEED;
    var A = global.APP_DATA;
    var ACTIONS = global.ACTIONS;

    /* ------------------------------------------------------------------ 公共口径
     * 会话内状态真源 = APP_SHELL.state（renderers2 写的就是它）。
     * 经验的所有覆盖都走 state.expOps[id]，与列表页 / 详情页同一份，不许各写一份。
     * 取值域：verified | rejected | deprecated | restored | shared-pending | shared
     */
    function st() { var sh = global.APP_SHELL; return (sh && sh.state) || {}; }
    function expOps() { return (st().expOps) || {}; }
    function expTargets() { return (st().expTargets) || {}; }

    function cover(it) {
      var o = expOps()[it.id];
      if (!o) return it;
      var x = {}, k;
      for (k in it) { if (Object.prototype.hasOwnProperty.call(it, k)) x[k] = it[k]; }
      if (o === 'verified') { x.status = 'ok'; x.statusText = '已复核通过'; }
      else if (o === 'rejected') { x.status = 'bad'; x.statusText = '已驳回'; }
      else if (o === 'deprecated') { x.status = 'deprecated'; x.statusText = '已弃用'; }
      else if (o === 'restored') { x.status = 'info'; x.statusText = '已恢复（待复核）'; }
      else if (o === 'shared' || o === 'shared-pending') {
        /* 共享出去的目标要真的进检索池名单，否则「共享给谁」只是一个被记下来的字串、没有任何效果 */
        var tg = expTargets()[it.id] || [];
        var merged = (x.agents || []).slice();
        tg.forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
        x.agents = merged;
        x.sharedTo = tg;
        x.scope = 'shared';
        if (o === 'shared-pending') { x.scopePending = true; x.status = 'info'; x.statusText = '已提共享 · 待重验'; }
        else { x.status = 'ok'; x.statusText = '已验证'; }
      }
      return x;
    }
    function allItems() {
      var q = A.getQueues && A.getQueues().experience;
      return ((q && q.items) || []).map(cover);
    }
    function liveItems() { return allItems().filter(function (x) { return x.status !== 'deprecated'; }); }

    /* ------------------------------------------------------------------ 状态同步（关键）
     * 经验的三处视图（列表页 renderers2 / 详情页 v10-detail-asset / Agent 页本补丁）
     * 此前各读各的：在某一处改了状态，另一处不认。
     * 这是 v16 修过的「复核与审批队列双写不同步」的同类病 —— 换了个载体又犯一次。
     * 正解：把覆盖层织进 getQueues（与 v19-governance-fix.js 同一手法，monkey-patch 数据出口），
     * 让所有消费方拿到的是同一份带会话覆盖的数据，而不是各自 applyPojo 一份。
     */
    if (typeof A.getQueues === 'function') {
      var rawGetQueues = A.getQueues;
      /* ⚠ renderers2 的 queues() 是「首调用缓存」：if (!QUEUES) QUEUES = APP.getQueues()。
         如果 patch 每次返回一个新对象，那么被缓存住的永远是第一次那份 —— 之后再改状态，
         列表页看到的还是旧数据。这跟上面的绑监听器是同一类病：注入方拿不到消费方的私有引用。
         解法：返回一个**稳定的外壳对象**，每次调用把新鲜内容写回这个外壳再套覆盖层。 */
      var shell = null;
      A.getQueues = function () {
        var q = rawGetQueues.apply(A, arguments);
        if (!q) return q;
        try {
          if (!shell) {
            shell = q;
          } else {
            Object.keys(q).forEach(function (k) {
              if (shell[k] && shell[k].items && q[k] && q[k].items) shell[k].items = q[k].items;
              else shell[k] = q[k];
            });
          }
          if (shell.experience && shell.experience.items && shell.experience.items.length) {
            shell.experience.items = shell.experience.items.map(cover);
          }
          return shell;
        } catch (e) {
          if (global.console) global.console.error('[v23-exp]', e);
          return q;
        }
      };
      A.getQueues._v23patched = true;
    }

    function agentById(id) {
      return (S.AGENTS || []).filter(function (a) { return a.id === id; })[0] || null;
    }
    function agentName(id) { var a = agentById(id); return a ? a.name : (id || '—'); }

    /* ------------------------------------------------------------------ 权限点登记
     * 「改经验的适用域」是一个独立的高危动作：它把一条只对某 Agent 验证过的东西，
     * 放进了其它 Agent 的检索池。既有的 llm-exp:entry:* 里没有这一条，
     * 不登记的话 checkPerm 会走到「 Razwei 无此权限」的拒绝页 —— 动作装了等于没装。
     * 登记成 high：强制填理由 + 留审计。
     *
     * ⚠ 该权限点已登记在 seed.js 的 PERM_POINTS；这里的 push 是兜底（带 has 判断，不会重复）。
     */
    function registerPerm() {
      try {
        if (!S.PERM_POINTS) return;
        var has = S.PERM_POINTS.some(function (p) { return p.p === 'llm-exp:entry:share'; });
        if (!has) {
          S.PERM_POINTS.push({ p: 'llm-exp:entry:share', label: '经验升级为共享', grp: '知识经验', risk: 'high' });
        }
        /* ME.perms 是角色推导的一次性快照；新增权限点后必须重算，否则角色持有 '*' 通配也命中不了 */
        if (S.ME && typeof S.rolePerms === 'function') {
          S.ME.perms = (S.rolePerms(S.ME.roleId) || []).slice();
        }
        /* 角色/权限点矩阵等相关派生结构如有缓存，一并失效重算 */
        if (typeof S.permGroups === 'function') S.permGroups();
      } catch (e) { if (global.console) global.console.error('[v23-exp] registerPerm', e); }
    }

    /* ------------------------------------------------------------------ ① 升级为共享
     * 单 Agent 私有 → 多 Agent 共享。
     * 关键约束（硬约束「经验不因存在即适用」）：升级不是"复制一份给所有人用"，
     * 而是**换一个适用域**——原 Agent 的验证结论不能直接搬到别的 Agent 场景。
     * 所以升级后必须重新验证，不能立刻全池生效。
     *
     * dangerConfirm 只支持单个 reason 输入，所以目标 Agent 选择用一个独立的 sheet 承接，
     * 两段各自校验、各自留痕；不硬塞 form（本体没这能力）。
     */
    ACTIONS['exp-upgrade-shared'] = function (id, btn, h) {
      var fmt = h.fmt;
      var r = allItems().filter(function (x) { return x.id === id; })[0];
      if (!r) { h.toast('经验条目不存在', 'bad'); return; }
      if (r.scope === 'shared' && !r.scopePending) { h.toast('这条已经是共享经验了', 'info'); return; }
      if (r.status === 'deprecated' || r.status === 'bad') {
        h.toast('已弃用 / 已驳回的经验不能升级为共享，先恢复并通过复核', 'bad'); return;
      }
      pickShareTargets(r, h, fmt);
    };

    function pickShareTargets(r, h, fmt) {
      var others = (S.AGENTS || []).filter(function (a) {
        return a.retiredAt === undefined && a.id !== r.ownerAgent;
      });
      var ownerA = agentById(r.ownerAgent);
      var ownerBiz = ownerA ? ownerA.biz : null;
      /* 默认候选：同业务线优先 —— 场景最像，但默认不等于验证过 */
      var sameBiz = others.filter(function (a) { return a.biz === ownerBiz; });
      var pool = sameBiz.length ? sameBiz : others;
      var pre = {};
      pool.slice(0, 2).forEach(function (a) { pre[a.id] = true; });

      var listHtml = others.map(function (a) {
        var cz = a.biz === ownerBiz;
        return '<label class="v23-pick" style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer">' +
          '<input type="checkbox" data-v23="tgt" value="' + h.esc(a.id) + '"' + (pre[a.id] ? ' checked' : '') + ' style="margin-top:3px">' +
          '<span style="flex:1"><b>' + h.esc(a.name) + '</b>' +
          (cz ? ' <span class="pill info">同业务线</span>' : '') +
          '<div class="td-sub">' + h.esc(a.desc || '') + '</div></span></label>';
      }).join('');

      var ev = r.evidence || {}, fb = r.feedback || {};
      global.V10UI.openSheet({
        title: '升级为多 Agent 共享 · 第 1 步：选共享给谁',
        bodyHtml:
          '<div class="v10-sheet-desc">把「' + h.esc(r.title) + '」从单 Agent 私有改成多 Agent 共享。</div>' +
          '<div class="v10-impacts">' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">适用域</span><span class="v10-impacts-v danger">私有（仅 ' + h.esc(agentName(r.ownerAgent)) + '）→ 共享</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">当前验证结论</span><span class="v10-impacts-v danger">只对「' + h.esc(agentName(r.ownerAgent)) + '」有效，不能直接搬到别的场景</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">升级后状态</span><span class="v10-impacts-v warn">回到「待重验」—— 在新场景验证通过才全池生效</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">历史效果</span><span class="v10-impacts-v">被检索 ' + fmt.int(r.searches) + ' 次 · 命中率 ' + fmt.pct1(r.hitRate) + ' · 收益分 ' + fmt.num1(r.gain) + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">证据</span><span class="v10-impacts-v">支持 ' + (ev.support || 0) + ' / 反例 ' + (ev.contradict || 0) + ' / 补充 ' + (ev.supplement || 0) + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">反向反馈</span><span class="v10-impacts-v' + (((fb.down || 0) + (fb.wrong || 0)) > 0 ? ' warn' : '') + '">' + (fb.down || 0) + ' 反对 / ' + (fb.wrong || 0) + ' 判定用错</span></div>' +
          '</div>' +
          '<div class="sub-h" style="margin-top:14px">共享给哪些 Agent</div>' +
          listHtml +
          '<div class="err" data-v23="err" style="display:none;color:#dc2626;font-size:12.5px;margin-top:6px">至少选一个 Agent</div>' +
          '<div class="bt-note" style="margin-top:10px">默认勾的是同业务线的 Agent（场景最像），但这只是默认值、不是验证结论 —— ' +
          '每一步「升级」都必须由原 owner 提交理由并留审计。</div>',
        footHtml: '<button class="btn-ghost" data-v23="cancel">取消</button>' +
          '<button class="btn-primary" data-v23="next">下一步：填升级理由</button>',
        onOpen: function (root) {
          root.addEventListener('click', function (e) {
            var g = e.target.getAttribute && e.target.getAttribute('data-v23');
            if (g === 'cancel') { global.V10UI.closeSheet(); return; }
            if (g !== 'next') return;
            var picked = Array.prototype.filter.call(root.querySelectorAll('input[data-v23="tgt"]'), function (x) { return x.checked; })
              .map(function (x) { return x.value; });
            if (!picked.length) {
              var er = root.querySelector('[data-v23="err"]');
              if (er) er.style.display = 'block';
              return;
            }
            global.V10UI.closeSheet();
            fillShareReason(r, h, fmt, picked);
          });
        }
      });
    }

    function fillShareReason(r, h, fmt, picked) {
      var names = picked.map(agentName);
      h.dangerConfirm(h, {
        title: '升级为多 Agent 共享 · 第 2 步：理由',
        desc: '把「' + r.title + '」共享给 ' + names.join('、') + '？',
        tone: 'warn', perm: 'llm-exp:entry:share',
        impacts: [
          { label: '共享给', value: names.join('、') + '（' + names.length + ' 个 Agent）', tone: 'danger' },
          { label: '升级后状态', value: '回到「待重验」—— 需在新场景重新验证通过才全池生效' },
          { label: '影响面', value: '这些 Agent 的检索池会包含它 —— 改一条动一片，后续变更要走共享经验复核流程' },
          { label: '留痕', value: '升级理由与目标 Agent 写入审计' }
        ],
        requireReason: true, confirmText: '确认升级为共享',
        action: '升级为共享', target: r.id + ' · ' + r.title,
        reasonLabel: '升级理由（必填，留审计）',
        auditImpact: '归属：私有（' + agentName(r.ownerAgent) + '）→ 共享给 ' + names.join('、') + '（待重验）',
        onConfirm: function (reason) {
          h.state.expOps = h.state.expOps || {};
          h.state.expOps[r.id] = 'shared-pending';
          h.state.expTargets = h.state.expTargets || {};
          h.state.expTargets[r.id] = picked;
          h.toast('已把「' + r.title + '」提交为共享经验（共享给 ' + names.join('、') + '），状态回到「待重验」（仅本会话）', 'ok');
          h.navigate({}, { scroll: false });
        }
      });
    }

    /* ------------------------------------------------------------------ ② Agent 详情页「经验」Tab */
    /* v10b（Top12#8）：同步 renderers.js 的 7-Tab 收敛 ——
       运行日志→调试与日志、发布历史→版本与发布、引用与依赖→编排配置。
       这里必须同步，否则本文件的 tabBar 替换会把收敛后的导航盖回 10 个。 */
    var AGENT_TAB_DEFS = [
      /* v35：与 renderers.js 的 AGENT_TABS 保持一致 —— Agent 详情只剩四页
         （会话 / 监控 / 管理 / 日志）。这只是**兜底副本**：AGENT_TAB_BAR 取不到时才用，
         角标（经验条数）也随之不再有意义（经验页签已从这一页移除）。 */
      { id: 'session', label: '会话' },
      { id: 'monitor', label: '监控' },
      { id: 'manage', label: '管理' },
      { id: 'debug', label: '日志' }
    ];
    var TAB_MERGE = { logs: 'debug', history: 'versions', deps: 'orchestrate' };
    function expTabBar(h, a, state, active, mineN) {
      /* v27：Tab 条不再自带副本 —— 从 renderers.js 导出的唯一实现取（global.AGENT_TAB_BAR）。
         旧副本 AGENT_TAB_DEFS 的两个后果：新 Tab 加不进来；质量/灰度角标被静默丢掉。
         取不到时退回旧实现（加载顺序变化也不至于白屏，只是角标少）。 */
      if (global.AGENT_TAB_BAR) {
        var aiIdx = (global.DATA_SEED && global.DATA_SEED.idx && global.DATA_SEED.idx.agent) ? global.DATA_SEED.idx.agent[(a && a.id) || ''] : undefined;
        return global.AGENT_TAB_BAR(h, a || { id: '', name: '', grayVersion: null }, aiIdx, state || {}, active, mineN);
      }
      active = TAB_MERGE[active] || active;   /* 旧深链 #tab=logs 等归并后仍有高亮 */
      return '<div class="tabs" role="tablist">' + AGENT_TAB_DEFS.map(function (t) {
        var badge = t.id === 'exp' ? (mineN || null) : null;
        return '<button role="tab" class="tab' + (t.id === active ? ' on' : '') + '" data-tab="' + t.id + '"' +
          (badge ? ' data-badge="' + badge + '"' : '') + '>' + h.esc(t.label) +
          (badge ? '<i class="tab-badge">' + badge + '</i>' : '') + '</button>';
      }).join('') + '</div>';
    }

    function myExpSummary(agentId) {
      var live = liveItems();
      var mine = live.filter(function (x) { return x.scope !== 'shared' && x.ownerAgent === agentId; });
      var shared = live.filter(function (x) {
        return x.scope === 'shared' && ((x.agents || []).indexOf(agentId) > -1 ||
          (expTargets()[x.id] || []).indexOf(agentId) > -1 || x.ownerAgent === agentId);
      });
      return { mine: mine, shared: shared };
    }

    var rawAgentDetail = global.RENDERERS.agentDetail;
    if (typeof rawAgentDetail === 'function') {
      global.RENDERERS.agentDetail = function (cap, state, h) {
        /* v35（2026-10-15 业主指定）：Agent 详情只留四页（会话/监控/管理/日志），
           「经验」页签已从这一页移除 ⇒ 本包装器原先只为注入它而存在，现在**纯透传**。
           老深链 #/…/exp 由 renderers.js 的 legacyTab 归并进「管理」，不再渲染经验页。
           ⚠ 文件其余部分（权限点登记、V23EXP 导出）仍被别的页面使用，不能删。 */
        return rawAgentDetail(cap, state, h);
      };
    }

    function expAgentBody(h, agentId) {
      var fmt = h.fmt;
      var a = agentById(agentId) || { name: agentId, id: agentId };
      var sum = myExpSummary(agentId);
      var mine = sum.mine, shared = sum.shared;

      if (!mine.length && !shared.length) {
        return '<div class="card"><div class="empty"><div class="empty-ico">' + h.icon('doc', 28) + '</div>' +
          '<div class="empty-title">这个 Agent 还没有可用的经验</div>' +
          '<div class="empty-sub">私有经验由它的 owner 在经验库登记；共享经验需要有人把私有经验升级为共享后重新验证通过。</div>' +
          '<button class="btn-primary" data-act="go-cap" data-id="llm-exp" style="margin-top:12px">去经验库登记 →</button></div></div>';
      }

      var mineGain = mine.length ? mine.reduce(function (s2, x) { return s2 + (x.gain || 0); }, 0) / mine.length : 0;
      var srch = mine.reduce(function (s2, x) { return s2 + (x.searches || 0); }, 0);
      var wHit = srch ? mine.reduce(function (s2, x) { return s2 + (x.searches || 0) * (x.hitRate || 0); }, 0) / srch : 0;
      var zombie = mine.filter(function (x) { return x.lastUsedDay != null && x.lastUsedDay <= -30; });
      var pendingMine = mine.filter(function (x) { return x.status === 'warn' || x.scopePending; });

      function statusCell(r) {
        var j;
        if (r.isDraft || r.status === 'draft') j = { kind: 'idle', text: '草稿·未进池' };
        else if (r.scopePending) j = { kind: 'warn', text: '共享待重验' };
        else if (r.status === 'warn') j = (r.gain != null && r.gain < 2) ? { kind: 'bad', text: '待复核 · 建议弃用' } : { kind: 'warn', text: '待复核' };
        else if (r.gain != null && r.gain < 2) j = { kind: 'bad', text: '建议弃用' };
        else if (r.gain != null && r.gain >= 5) j = { kind: 'ok', text: '建议继续用' };
        else j = { kind: 'ok', text: '可继续用' };
        return h.pill(r.status, r.statusText) + '<div class="td-sub">' + j.text +
          (r.reviewer ? ' · 复核人 ' + h.esc(r.reviewer) : ' · 复核人未分配') + '</div>';
      }
      function lastUsedCell(r) {
        if (r.lastUsedDay == null) return '<span class="muted">—</span>';
        return r.lastUsedDay <= -30
          ? '<span class="bad">' + fmt.rel(r.lastUsedDay) + ' · 久未使用</span>'
          : fmt.rel(r.lastUsedDay);
      }

      var rowSort = function (p, q2) {
        var pa = p.status === 'warn' ? 0 : 1, pb = q2.status === 'warn' ? 0 : 1;
        return pa - pb || q2.gain - p.gain;
      };

      var mineTable = '<div class="card pad0"><div class="card-h pad"><h3>我自己的经验（单 Agent 私有）</h3>' +
        '<span class="card-sub">' + mine.length + ' 条 · 只服务「' + h.esc(a.name) + '」，改动影响面可控' +
        (pendingMine.length ? ' · ' + pendingMine.length + ' 条待复核' : '') + '</span>' +
        '<button class="btn-ghost sm" data-act="go-cap" data-id="llm-exp">在经验库管理 →</button></div>' +
        (mine.length ? h.table({
          columns: [
            { key: 'title', label: '经验', render: function (r) {
              return '<button class="lnk" data-act="exp-open" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.title) + '</b></button>' +
                '<div class="td-sub">' + h.esc(r.scene) + '</div>';
            } },
            { key: 'source', label: '来源' },
            { key: 'searches', label: '被检索', align: 'right', fmt: 'int' },
            { key: 'hitRate', label: '命中率', align: 'right', fmt: 'pct0' },
            { key: 'gain', label: '收益分', align: 'right', fmt: 'num1',
              /* 草稿没有收益分（gain=null）：此前会打印出字面量 "null" 并按 <2 标红，
                 等于给一条还没进池、还没有任何运行数据的经验判了"差"。改为如实说「—」。 */
              render: function (r) { return r.isDraft || r.gain == null
                ? '<span class="muted">—</span>'
                : '<b class="' + (r.gain >= 5 ? 'ok' : (r.gain < 2 ? 'bad' : '')) + '">' + fmt.num1(r.gain) + '</b>'; } },
            { key: 'lastUsedDay', label: '最近使用', align: 'right', render: lastUsedCell },
            { key: 'status', label: '状态 / 结论', render: statusCell },
            { key: 'act', label: '操作', render: function (r) {
              var out = ['<button class="lnk" data-act="exp-open" data-id="' + h.esc(r.id) + '">详情</button>'];
              if (r.scope !== 'shared' && r.status !== 'deprecated' && r.status !== 'bad' && r.status !== 'draft') {
                out.push('<button class="lnk" data-act="exp-upgrade-shared" data-id="' + h.esc(r.id) + '">升级为共享</button>');
              } else if (r.scopePending) {
                out.push('<span class="muted" style="font-size:11.5px">已提共享 · 待重验</span>');
              }
              return out.join('<span style="display:inline-block;width:14px;text-align:center;opacity:.4">·</span>');
            } }
          ],
          rows: mine.slice().sort(rowSort),
          noPaging: true,
          emptyTitle: '这个 Agent 还没有私有经验',
          emptySub: '它的私有经验只能在经验库里登记，登记时归属选它'
        }) : '<div class="bt-note" style="padding:14px 16px">这个 Agent 还没有私有经验。经验不是自动攒出来的 —— 要有人从 badcase 或人工判断里提炼后登记。</div>') +
        '</div>';

      var sharedTable = '<div class="card pad0"><div class="card-h pad"><h3>我能检索到的共享经验</h3>' +
        '<span class="card-sub">' + shared.length + ' 条 · 别的 Agent 贡献的，我能用但不等于适用' +
        '（经验不因存在即适用 —— 在「' + h.esc(a.name) + '」的场景下要先验证）</span></div>' +
        (shared.length ? h.table({
          columns: [
            { key: 'title', label: '经验', render: function (r) {
              return '<button class="lnk" data-act="exp-open" data-id="' + h.esc(r.id) + '"><b>' + h.esc(r.title) + '</b></button>' +
                '<div class="td-sub">' + h.esc(r.scene) + '</div>';
            } },
            { key: 'fromAgents', label: '来自哪些 Agent', render: function (r) {
              var others = (r.agents || []).filter(function (x) { return x !== agentId; });
              if (!others.length) others = [r.ownerAgent].filter(Boolean);
              return h.esc(others.map(agentName).join('、') || '—') +
                '<div class="td-sub">共 ' + (r.agents || []).length + ' 个 Agent 可检索</div>';
            } },
            { key: 'gain', label: '收益分', align: 'right',
              render: function (r) { return '<b class="' + (r.gain >= 5 ? 'ok' : (r.gain < 2 ? 'bad' : '')) + '">' + fmt.num1(r.gain) + '</b>'; } },
            { key: 'hitRate', label: '命中率', align: 'right', fmt: 'pct0' },
            { key: 'lastUsedDay', label: '最近使用', align: 'right', render: lastUsedCell },
            { key: 'status', label: '状态', render: function (r) { return h.pill(r.status, r.statusText); } },
            { key: 'act', label: '', render: function (r) {
              return '<button class="lnk" data-act="exp-open" data-id="' + h.esc(r.id) + '">详情</button>';
            } }
          ],
          rows: shared.slice().sort(function (p, q2) { return (q2.gain || 0) - (p.gain || 0); }),
          noPaging: true,
          emptyTitle: '没有可用的共享经验',
          emptySub: '把私有经验升级为共享后，其它 Agent 才能检索到'
        }) : '<div class="bt-note" style="padding:14px 16px">没有共享经验能被它检索到。共享经验的入口是：某条私有经验在经验库里升级为共享、并在新场景重新验证通过。</div>') +
        '</div>';

      return '<div class="metrics">' + [
        { label: '我的私有经验', value: String(mine.length), sub: '只服务它自己 · 由 owner 复核' +
            (pendingMine.length ? ' · ' + pendingMine.length + ' 条待复核' : '') },
        { label: '可用共享经验', value: String(shared.length), sub: '跨 Agent 复用 · 需在本场景验证' },
        { label: '我的经验 · 平均收益分', value: fmt.num1(mineGain), sub: '各条等权平均 · A/B 对照折算' },
        { label: '我的经验 · 加权命中率', value: fmt.pct1(wHit), alert: mine.length > 0 && wHit < 0.7,
          sub: '按检索次数加权 · 低说明检索到了却用不上' },
        { label: '僵尸经验', value: String(zombie.length), alert: zombie.length > 0,
          sub: zombie.length ? '超 30 天没被检索到，考虑淘汰' : '全部在近 30 天被用过' }
      ].map(h.metricCard).join('') + '</div>' +
        '<div class="alert-banner info"><b>这一屏回答的是「这个 Agent 靠什么经验干活」</b>' +
        '<span>私有经验是它自己的沉淀，只有它用；共享经验是别人贡献的，它能检索到但不代表适用 —— ' +
        '两条来源分开列，是因为责任人不同：私有经验出问题找它的 owner，共享经验出问题要找原贡献方重新验证。</span></div>' +
        mineTable + sharedTable +
        h.metaBar({}, [
          { k: '归属口径', v: '单 Agent 私有：owner 为该 Agent 的经验，只进它的检索池；多 Agent 共享：可被多个 Agent 检索，需在各场景分别验证' },
          { k: '与 badcase 的关系', v: '这一屏是「沉淀」侧（有哪些经验可用）；「质量与 badcase」那一屏是「问题」侧（哪些地方答错了）。两端靠经验详情里的「关联 badcase」打通' },
          { k: '数字口径', v: '检索次数 / 命中率 / 收益分为累计值（配置态资产不按时间切片）；加权命中率 = Σ(检索次数 × 命中率) ÷ Σ检索次数' },
          { k: '演示边界', v: '本屏只读。「升级为共享」会回到「待重验」而不是直接生效 —— 这是硬约束「经验不因存在即适用」的前端体现' }
        ]);
    }

    /* Agent 侧打开经验详情 / 回能力页 */
    ACTIONS['exp-open'] = function (id, btn, h) {
      if (global.location) global.location.hash = '#/insight/llm-exp/' + encodeURIComponent(id);
    };
    ACTIONS['go-cap'] = function (id, btn, h) {
      if (global.location) global.location.hash = '#/' + id;
    };

    /* ------------------------------------------------------------------ ③ DOM 后处理
     * 列表页操作列 / 详情页「引用 Agent」文案都是本体写死的，没法从外部插按钮。
     * 用 MutationObserver 监听 #content：每次页面重渲染（innerHTML 替换）后跑一遍。
     */
    function hashHas(p) { return ((global.location && global.location.hash) || '').indexOf(p) === 0; }

    function injectListUpgrade() {
      var doc = global.document;
      if (!doc || !hashHas('#/insight/llm-exp')) return;
      if (hashHas('#/insight/llm-exp/')) return;   // 详情页不处理（详情页有专有入口）
      var nodes = doc.querySelectorAll('[data-act="exp-detail"]');
      Array.prototype.forEach.call(nodes, function (n) {
        var row = n.closest ? n.closest('tr') : null;
        if (!row || row.getAttribute('data-v23-upg')) return;
        var id = n.getAttribute('data-id');
        if (!id) return;
        var item = allItems().filter(function (x) { return x.id === id; })[0];
        row.setAttribute('data-v23-upg', '1');
        if (!item) return;
        if (item.scope === 'shared' || item.status === 'deprecated' || item.status === 'bad') return;
        var cell = n.parentNode;
        if (!cell) return;
        var sep = doc.createElement('span');
        sep.textContent = '·';
        sep.style.cssText = 'display:inline-block;width:14px;text-align:center;opacity:.4';
        var a = doc.createElement('button');
        a.className = 'lnk';
        a.setAttribute('data-act', 'exp-upgrade-shared');
        a.setAttribute('data-id', id);
        a.textContent = '升级为共享';
        cell.appendChild(sep);
        cell.appendChild(a);
      });
    }

    function injectDetailUpgrade() {
      var doc = global.document;
      if (!doc || !hashHas('#/insight/llm-exp/')) return;
      var root = doc.getElementById('content') || doc.body;
      if (!root || root.getAttribute('data-v23-detail')) return;
      var notes = root.querySelectorAll('.bt-note');
      var hitAny = false;
      Array.prototype.forEach.call(notes, function (el) {
        if (el.getAttribute('data-v23-upg')) return;
        var tx = el.textContent || '';
        if (tx.indexOf('升级为共享') < 0 || !/单 Agent 私有经验/.test(tx)) return;
        hitAny = true;
        el.setAttribute('data-v23-upg', '1');
        var segs = (global.location.hash || '').split('/');
        var id = decodeURIComponent(segs[segs.length - 2] || '');
        var item = allItems().filter(function (x) { return x.id === id; })[0];
        if (!item || item.status === 'deprecated' || item.status === 'bad') return;
        var wrap = doc.createElement('div');
        wrap.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
        if (item.scope === 'shared') {
          var done = doc.createElement('span');
          done.className = 'pill info';
          done.textContent = item.scopePending ? '已提共享 · 待重验' : '已是共享经验';
          wrap.appendChild(done);
        } else {
          var b = doc.createElement('button');
          b.className = 'btn-primary';
          b.setAttribute('data-act', 'exp-upgrade-shared');
          b.setAttribute('data-id', id);
          b.textContent = '升级为共享';
          wrap.appendChild(b);
        }
        var hint = doc.createElement('span');
        hint.className = 'muted';
        hint.style.fontSize = '12px';
        hint.textContent = '升级后回到「待重验」，需在新场景重新验证才全池生效。';
        wrap.appendChild(hint);
        el.parentNode.insertBefore(wrap, el.nextSibling);
      });
      if (hitAny) root.setAttribute('data-v23-detail', '1');
    }

    /* ⚠ 关键：app.js 的 bindContent() 是「渲染那一刻」用 querySelectorAll 逐个 addEventListener。
       补丁在渲染之后追加的按钮从未被绑过监听器 —— 点了毫无反应。
       这里补一层：给所有还没绑过的 [data-act] 手动挂上 ACTIONS 调用。
       标记 __v23Bound 防重复绑（MutationObserver 每次都会跑）。 */
    function bindPatched(doc) {
      var nodes = doc.querySelectorAll('#content [data-act]');
      Array.prototype.forEach.call(nodes, function (n) {
        if (n.__v23Bound) return;
        var act = n.getAttribute('data-act');
        if (!(act && ACTIONS[act])) return;
        if (n.classList.contains('m-info')) return;
        n.__v23Bound = true;
        n.addEventListener('click', function (e) {
          e.stopPropagation();
          var sh = global.APP_SHELL;
          var hh = (sh && typeof sh.helpers === 'function') ? sh.helpers() : null;
          if (!hh) return;
          try { ACTIONS[act](n.getAttribute('data-id'), n, hh); }
          catch (err) { if (global.console) global.console.error('[v23-exp] action ' + act, err); }
        });
      });
    }

    function post() {
      try { injectListUpgrade(); } catch (e) { if (global.console) global.console.error('[v23-exp]', e); }
      try { injectDetailUpgrade(); } catch (e) { if (global.console) global.console.error('[v23-exp]', e); }
      try { bindPatched(global.document); } catch (e) { if (global.console) global.console.error('[v23-exp]', e); }
    }

    var start = function () {
      var doc = global.document;
      if (!doc) return;
      var root = doc.getElementById('content');
      if (root && global.MutationObserver) {
        var mo = new global.MutationObserver(function () { post(); });
        mo.observe(root, { childList: true, subtree: false });
      }
      global.addEventListener('hashchange', function () { global.setTimeout(post, 0); }, false);
      /* 首次进入：等 app.js init 渲染完 */
      var tries = 0;
      var t2 = global.setInterval(function () {
        tries++;
        post();
        if (tries > 40) global.clearInterval(t2);
      }, 100);
    };
    if (global.document && global.document.readyState !== 'loading') start();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', start);

    registerPerm();

    global.V23EXP = {
      cover: cover, allItems: allItems, liveItems: liveItems,
      myExpSummary: myExpSummary, meta: { version: 'v23' }
    };
  });
})(window);
