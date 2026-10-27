/* ============================================================================
 * v36 · 按人头管权限（账号与权限页 · 成员视图）
 * ----------------------------------------------------------------------------
 * 业主原话：「如按人头管理的话，每个人做成一个卡片，点击卡片就可以管理每个权限」。
 *
 * 为什么卡片而不是表格：
 *   表格擅长"横向比较"（谁权限多、谁的复核快到期）；但这一屏真正要回答的是
 *   「这个人有什么问题、我要动哪一项」。卡片带一个"有事才亮"的标记，扫一遍就知道
 *   点谁；表格得逐列读。
 *
 * 卡片必须回答一个问题，否则不如表格：**一眼看出这个人有没有问题。**
 *   没问题的一律无标记 —— 有标记的才是待办。
 *
 * 点卡片 → 网格下方展开这个人的权限清单，分两组：
 *   单独授予（可以直接续/收） / 角色继承（也能单独收，但只影响本人）
 *   这个区分必须显性化：否则"收回一项权限"会被误解成"改了角色"，角色一改另外几个人跟着变。
 *
 * 加权限：不直接给，生成一张待批（state.mcPending），批完才生效。
 *
 * 约定：ES5 · 不注入样式表 · 会话态（state.mcOpen / mcOff / mcExt / mcPending）刷新还原。
 * 回退：本文件不存在时，renderers2 的 rbacPage 会落回原来的成员表（memberTableOld）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var ACTIONS = global.ACTIONS || (global.ACTIONS = {});
  function S() { return global.DATA_SEED || {}; }

  /* ── 卡片上的"有事"标记：只挑一种最要紧的显示，不堆三个 ──────────────
     顺序是刻意的：**长期未用 > 复核超期 > 将到期**。
     不用（reviewState 先判）的话，一个 95 天没登录的人会显示"复核超期"，
     而"他根本没在用"才是更该先看到的那个事实。 */
  function mark(m) {
    if (m.revoked) return null;
    if (m.lastAccessDays != null && m.lastAccessDays > 60) return { tone: 'bad', text: m.lastAccessDays + ' 天未用' };
    if (m.reviewState === 'overdue') {
      return { tone: 'warn', text: (m.nextReviewDays != null ? '复核超期 ' + Math.abs(m.nextReviewDays) + ' 天' : '复核超期') };
    }
    if (m.reviewState === 'warn') return { tone: 'warn', text: m.nextReviewDays + ' 天后复核' };
    return null;
  }
  function score(m) {
    if (m.revoked) return -100;
    var s = 0;
    if (m.reviewState === 'overdue') s += 100;
    if (m.lastAccessDays != null && m.lastAccessDays > 60) s += 60;
    if (m.reviewState === 'warn') s += 40;
    return s;
  }

  /* ── 一个人的权限明细：单独授予 与 角色继承 必须分开 ────────────────── */
  function permsOf(uid, state) {
    var D = S(), grants = D.GRANT_RECORDS || [];
    var extra = [], roleId = null;
    for (var i = 0; i < grants.length; i++) {
      var g = grants[i];
      if (g.member !== uid) continue;
      if (g.via === 'extra' && g.perm) extra.push(g);
      else if (g.via === 'role' && g.role) roleId = g.role;
    }
    if (!roleId && D.roleOfUser) roleId = D.roleOfUser(uid);
    var rolePerms = (roleId && D.rolePerms) ? (D.rolePerms(roleId) || []) : [];
    var roleObj = null;
    (D.ROLES || []).forEach(function (r) { if (r.id === roleId) roleObj = r; });
    var off = (state && state.mcOff) || {};
    var ext = (state && state.mcExt) || {};
    return {
      extra: extra.map(function (g) {
        var left = D.grantDaysLeft(g) + (ext[g.id] || 0);
        return { gid: g.id, key: g.perm, left: left, off: !!off[g.id] };
      }),
      roleId: roleId, roleName: roleObj ? roleObj.name : (roleId || '—'),
      role: rolePerms, extraOff: off
    };
  }

  function permLabel(key) {
    var D = S();
    var m = D.permMeta ? D.permMeta(key) : null;
    return (m && m.label) ? m.label : key;
  }
  function permRisk(key) {
    var D = S();
    var m = D.permMeta ? D.permMeta(key) : null;
    return (m && m.risk) || null;
  }

  /* ── 展开区 ──────────────────────────────────────────────────────── */
  function detailOf(h, m, state, fmt) {
    var p = permsOf(m.id, state);
    var pend = ((state.mcPending || {})[m.id]) || [];
    var more = state.mcMore === m.id;
    var roleShown = more ? p.role : p.role.slice(0, 6);

    function leftCell(rec) {
      if (rec.off) return '<span class="muted">已收回</span>';
      if (rec.left < 0) return '<span class="bad">超期 ' + Math.abs(rec.left) + ' 天</span>';
      if (rec.left <= 15) return '<span class="warn">剩 ' + rec.left + ' 天</span>';
      return '剩 ' + rec.left + ' 天';
    }

    var extraRows = p.extra.map(function (r) {
      return { id: r.gid, r: r };
    });
    var extraTable = extraRows.length
      ? h.table({
          columns: [
            { key: 'n', label: '权限', render: function (x) {
                var rk = permRisk(x.r.key);
                return '<b>' + h.esc(permLabel(x.r.key)) + '</b>' +
                  (rk === 'high' ? ' <span class="pill bad">高危</span>' : '') +
                  '<div class="td-sub mono">' + h.esc(x.r.key) + '</div>'; } },
            { key: 'left', label: '剩余', render: function (x) { return leftCell(x.r); } },
            { key: 'op', label: '', render: function (x) {
                if (x.r.off) return '<span class="muted">—</span>';
                return '<button class="lnk ok" data-act="mc-renew" data-id="' + h.esc(x.r.gid + '|' + m.id) + '">续期</button>' +
                  ' · <button class="lnk warn" data-act="mc-revoke-perm" data-id="' + h.esc(x.r.gid + '|' + m.id) + '">收回</button>'; } }
          ],
          rows: extraRows, noPaging: true
        })
      : '<div class="bt-note" style="margin:0 0 6px">没有单独授予的权限 —— 全部来自角色。</div>';

    var roleRows = roleShown.map(function (key, i) {
      return { id: 'rk-' + i, key: key };
    });
    var roleTable = h.table({
      columns: [
        { key: 'n', label: '权限', render: function (x) {
            var rk = permRisk(x.key);
            return h.esc(permLabel(x.key)) +
              (rk === 'high' ? ' <span class="pill bad">高危</span>' : '') +
              '<div class="td-sub mono">' + h.esc(x.key) + '</div>'; } },
        { key: 'src', label: '来源', render: function () {
            return '角色「' + h.esc(p.roleName) + '」<div class="td-sub">随角色变</div>'; } },
        { key: 'op', label: '', render: function (x) {
            return '<button class="lnk warn" data-act="mc-revoke-perm" data-id="' +
              h.esc('role:' + x.key + '|' + m.id) + '">单独收回</button>' +
              '<div class="td-sub">只影响本人</div>'; } }
      ],
      rows: roleRows, noPaging: true
    });

    return '<div class="card" style="margin-top:12px"><div class="card-h">' +
      '<h3>' + h.esc(m.name) + ' · ' + m.permCount + ' 项</h3>' +
      '<span class="card-sub">' + p.extra.length + ' 项单独授予 · ' + p.role.length + ' 项来自角色「' + h.esc(p.roleName) + '」' +
        (pend.length ? ' · ' + pend.length + ' 项待批' : '') + '</span>' +
      '<button class="btn-ghost sm" data-act="mc-add-perm" data-id="' + h.esc(m.id) + '">＋ 加一项权限</button>' +
      '<button class="lnk" data-act="mc-close" data-id="">收起</button>' +
      '</div>' +

      (pend.length
        ? '<div style="margin:0 0 10px;padding:8px 12px;background:var(--bg-subtle-2);border-radius:8px;' +
          'display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<span class="sub-h" style="margin:0">待批</span>' +
          pend.map(function (x) {
            var verb = x.kind === 'revoke' ? '收回 ' : (x.kind === 'renew' ? '续期 90 天 · ' : '加 ');
            return '<span>' + h.esc(verb + permLabel(x.key)) + '</span><span class="pill idle">待审批</span>';
          }).join('') + '</div>'
        : '') +

      '<div class="sub-h" style="margin:4px 0 6px">单独授予</div>' + extraTable +
      '<div class="sub-h" style="margin:14px 0 6px">角色继承</div>' + roleTable +
      (p.role.length > 6
        ? '<button class="lnk" data-act="mc-more" data-id="' + h.esc(m.id) + '">' +
          (more ? '只看前 6 项' : '还有 ' + (p.role.length - 6) + ' 项') + '</button>'
        : '') +
      '</div>';
  }

  /* ── 网格 ────────────────────────────────────────────────────────── */
  function grid(h, members, state, fmt) {
    var list = members.slice().sort(function (a, b) { return score(b) - score(a); });
    var open = state.mcOpen || null;
    var active = members.filter(function (m) { return !m.revoked; }).length;
    var openM = null;
    list.forEach(function (m) { if (m.id === open) openM = m; });

    var cards = list.map(function (m) {
      var mk = mark(m);
      var on = open === m.id;
      return '<div class="card" role="button" tabindex="0" data-act="mc-open" data-id="' + h.esc(m.id) + '"' +
        ' style="padding:12px 14px;margin:0;cursor:pointer;' +
        (on ? 'border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-weak)' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="av-face">' + h.avatar(m.name, { face: true }) + '</span>' +
        '<b style="font-size:14px">' + h.esc(m.name) + '</b>' +
        (m.isMe ? ' <span class="pill info">我</span>' : '') +
        (m.revoked ? ' <span class="pill bad">已停用</span>' : '') +
        '<span style="margin-left:auto">' + (mk ? h.pill(mk.tone, mk.text) : '') + '</span>' +
        '</div>' +
        '<div class="td-sub" style="margin-top:6px">' + h.esc(m.roleName) + ' · ' + h.esc(m.dept) + '</div>' +
        '<div style="display:flex;gap:12px;margin-top:8px;font-size:12px">' +
        '<span>' + m.permCount + ' 项' + (m.highCount ? ' · <b class="bad">' + m.highCount + ' 高危</b>' : '') + '</span>' +
        '<span class="muted" style="margin-left:auto">' +
        (m.revoked ? '会话已失效' : (m.lastAccessDays != null ? fmt.rel(-m.lastAccessDays) : '—')) + '</span>' +
        '</div></div>';
    }).join('');

    return '<div style="padding:6px var(--space-3) 0">' +
      '<div class="card-sub" style="padding:0 0 10px">' + members.length + ' 人 · ' +
      list.filter(function (m) { return !!mark(m); }).length + ' 个有待处理标记 · 有标记的排前面</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:12px">' + cards + '</div>' +
      (openM ? detailOf(h, openM, state, fmt) : '') +
      '</div>';
  }

  /* ── 动作 ────────────────────────────────────────────────────────── */
  function rerender(h) { h.navigate({}, { scroll: false }); }

  ACTIONS['mc-open'] = function (id, btn, h) {
    h.state.mcOpen = (h.state.mcOpen === id) ? null : id;
    h.state.mcMore = null;
    rerender(h);
  };
  ACTIONS['mc-close'] = function (id, btn, h) {
    h.state.mcOpen = null;
    rerender(h);
  };
  ACTIONS['mc-more'] = function (id, btn, h) {
    h.state.mcMore = (h.state.mcMore === id) ? null : id;
    stateMoreKeep(h, id);
    rerender(h);
  };
  function stateMoreKeep(h, id) { h.state.mcOpen = id; }

  ACTIONS['mc-revoke-perm'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var key = p[0], uid = p[1];
    var isRole = key.indexOf('role:') === 0;
    var perm = isRole ? key.slice(5) : key;

    h.dangerConfirm(h, {
      title: '申请收回「' + permLabel(perm) + '」',
      desc: isRole ? '这一项来自角色，收回只影响这个人' : '',
      tone: 'warn',
      /* 关键：个人页上只能「申请」，不能直接改。
         直接改要 rbac:role:write（平台管理员独占），而且绕过了审批 —— 那正是这套要堵的洞。
         所以这里走 approval:create，生成一张待批单；批完才真的失效。 */
      perm: 'approval:create',
      requireReason: true,
      impacts: [
        { label: '收回后', value: '本人下一次调用这项能力会被拦下', tone: 'danger' },
        isRole
          ? { label: '角色里其他人', value: '不受影响 —— 只给本人减这一项' }
          : { label: '来源', value: '单独授予（不随角色变）' },
        { label: '这一步', value: '提交申请，批完才生效', tone: 'warn' }
      ],
      confirmText: '提交审批',
      action: '申请收回权限', target: uid + ' · ' + perm,
      auditImpact: '生成一条待批的收回申请',
      onConfirm: function (reason) {
        h.state.mcPending = h.state.mcPending || {};
        var arr = (h.state.mcPending[uid] || []).slice();
        arr.push({ key: perm, kind: 'revoke', reason: reason || '', at: '刚刚' });
        h.state.mcPending[uid] = arr;
        h.state.mcOpen = uid;
        h.toast('已提交 · 待审批人处理', 'ok');
        rerender(h);
      }
    });
  };

  ACTIONS['mc-renew'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var gid = p[0], uid = p[1];
    h.dangerConfirm(h, {
      title: '申请续期 90 天',
      desc: '',
      tone: 'normal',
      perm: 'approval:create',
      requireReason: true,
      impacts: [
        { label: '续期', value: '在现有到期日上加 90 天' },
        { label: '性质', value: '这是一次新的决定，不是把旧的拖着走', tone: 'warn' },
        { label: '这一步', value: '提交申请，批完才生效' }
      ],
      confirmText: '提交审批',
      action: '申请续期', target: uid + ' · ' + gid,
      auditImpact: '生成一条待批的续期申请',
      onConfirm: function (reason) {
        h.state.mcPending = h.state.mcPending || {};
        var arr = (h.state.mcPending[uid] || []).slice();
        arr.push({ key: gid, kind: 'renew', reason: reason || '', at: '刚刚' });
        h.state.mcPending[uid] = arr;
        h.state.mcOpen = uid;
        h.toast('已提交 · 待审批人处理', 'ok');
        rerender(h);
      }
    });
  };

  ACTIONS['mc-add-perm'] = function (id, btn, h) {
    var uid = String(id == null ? '' : id).split('|')[0];
    var D = S();
    var mem = null;
    (D.OWNERS || []).forEach(function (o) { if (o.id === uid) mem = o; });
    var p = permsOf(uid, h.state);
    var have = {};
    p.extra.forEach(function (x) { have[x.key] = 1; });
    p.role.forEach(function (k) { have[k] = 1; });

    var CAND = ['agent:publish', 'approval:decide:approve', 'cost:export', 'gateway:key:rotate', 'knowledge:doc:delete'];
    var pick = null;
    for (var i = 0; i < CAND.length; i++) if (!have[CAND[i]]) { pick = CAND[i]; break; }
    if (!pick) { h.toast('常用权限点都已经有了', 'info'); return; }

    h.dangerConfirm(h, {
      title: '申请：给' + (mem ? mem.name : uid) + '加一项权限',
      desc: '',
      tone: 'danger',
      perm: 'approval:create',
      requireReason: true,
      impacts: [
        { label: '权限', value: permLabel(pick) + '（' + pick + '）', tone: permRisk(pick) === 'high' ? 'danger' : '' },
        { label: '给谁', value: (mem ? mem.name : uid) + ' · 单独授予，不随角色变' },
        { label: '期限', value: '90 天，到期自动失效' },
        { label: '批完之后', value: '这个人的权限从 ' + (p.extra.length + p.role.length) + ' 项变成 ' + (p.extra.length + p.role.length + 1) + ' 项', tone: 'warn' }
      ],
      confirmText: '提交审批',
      action: '申请加权限', target: uid + ' · ' + pick,
      auditImpact: '生成一条待批授权',
      onConfirm: function (reason) {
        h.state.mcPending = h.state.mcPending || {};
        var arr = (h.state.mcPending[uid] || []).slice();
        arr.push({ key: pick, reason: reason || '', at: '刚刚' });
        h.state.mcPending[uid] = arr;
        h.state.mcOpen = uid;
        h.toast('已提交 · 待审批人处理', 'ok');
        rerender(h);
      }
    });
  };

  global.V36MC = { grid: grid, permsOf: permsOf };

})(window);
