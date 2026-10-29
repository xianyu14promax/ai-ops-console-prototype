/* SECTION: v39-retired（2026-10-21 业主定）
 * 两条业主决定，合成一个补丁：
 *   ①「去掉其他账号，这系统以后只为一个账号服务」→ 8 人 6 角色收敛成 xianyu 一个人（改在 seed.js 数据层）
 *   ②「这一页直接删了吧」→「账号与 Agent 权限」整页下线（能力对象已从 CAPS 删除）
 *
 * 本文件只做一件事：**审批页的收尾**。
 *   审批已下线（没有第二个人可以批），但那 8 张历史单据是历史证据，不能凭空消失；
 *   深链 #/platform/approval 也仍然可能从旧书签、旧链接进来。
 *   所以这一页保留一个只读存档落点，把「为什么不再产生审批单」讲清楚，而不是给一张空表。
 *
 * 为什么不把 approval 能力也删掉：
 *   删了就只剩 404 兜底，旧链接进来看到的是「页面不存在」，读者会以为系统坏了；
 *   而这里要传达的恰恰是**这套流程被有意取消**，不是坏掉。
 *
 * 回退：删掉 HTML 里那一行引用即可回到原审批页（renderers2 的 queuePage 一行未改）。
 */
(function (global) {
  'use strict';

  var R = global.RENDERERS;
  if (!R) return;

  var oldQueue = R.queuePage;
  R.queuePage = function (cap, state, h) {
    if (!cap || cap.id !== 'approval') return oldQueue.apply(this, arguments);

    var q = (h.app && h.app.getQueues) ? h.app.getQueues()
      : ((global.APP_DATA && global.APP_DATA.getQueues) ? global.APP_DATA.getQueues() : {});
    var rows = ((q.approval && q.approval.items) || []);

    return '<div style="padding:0 var(--space-3)">' +
      '<div class="card"><div class="card-h"><h3>审批已下线</h3>' +
        '<span class="card-sub">单人系统：没有第二个人可以批，审批单不再产生</span></div>' +
        '<div class="bt-note" style="margin:0 14px 14px">' +
        '以前每次发布、开放 MCP、改规则都要"发起审批 → 别人点头"。系统只有你一个账号，' +
        '这一步的审批人只能是你自己 —— 那就不叫审批，叫多点一次。<br>' +
        '现在这些动作<b>直接生效</b>。' +
        '真正需要拦的东西没有放松：写工具仍要单独授权，越权调用仍会被拦下。</div></div>' +
      (rows.length
        ? '<div class="card pad0" style="margin-top:12px"><div class="card-h pad"><h3>历史审批单</h3>' +
          '<span class="card-sub">' + rows.length + ' 张 · 只读存档，不再流转</span></div>' +
          h.table({
            columns: [
              { key: 'title', label: '单据', render: function (r) { return h.esc(r.title || '—'); } },
              { key: 'level', label: '级别', render: function (r) { return h.pill(r.levelKind || 'idle', r.level || '—'); } },
              { key: 'impact', label: '影响', render: function (r) {
                  return '<span class="td-sub" style="margin:0">' + h.esc(r.impact || '—') + '</span>'; } },
              { key: 'statusText', label: '状态', render: function (r) {
                  return '<span class="pill idle">' + h.esc(r.statusText || (r.decided ? '已归档' : '未决 · 已随流程下线关闭')) + '</span>'; } }
            ],
            rows: rows.slice(0, 12), noPaging: true
          }) + '</div>'
        : '') +
      h.metaBar({}, [
        { k: '为什么下线', v: '审批的价值来自"另一个人独立判断"。单人系统里审批人就是发起人，这一步只剩形式，去掉之后改动直接生效，不再多一道空转' },
        { k: '现在靠什么兜底', v: '写操作单独授权 + 越权拦截 + 危险动作的二次确认。高危动作的护栏一条没少，少的是"等另一个人点头"' },
        { k: '历史单据', v: '8 张保留为只读存档，不再流转；"曾经有审批"这件事本身就是事实，单据不因流程下线而消失' }
      ]) +
      '</div>';
  };

  global.V39RETIRED = { page: 'approval-offline' };
})(window);
