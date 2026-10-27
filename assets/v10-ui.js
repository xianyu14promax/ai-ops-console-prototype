/* ============================================================================
 * v10 横切 UI 件：详情 Tab / 面包屑 / 空态 / 危险操作确认 / 变更 diff /
 *                权限点标签 / 审计 / 通知中心 / 多页签
 *
 * 加载位置：assets/render-kol.js 之后、assets/app.js 之前
 * 依赖：global.APP_SHELL（由 app.js 暴露的 esc/icon），但 app.js 在其后加载
 *       —— 因此这里对 SHELL 做**延迟取值**（每次调用时才读），不能缓存。
 *
 * 主持人需在 app.js 的 helpers() 里挂：detailTabs / pageCrumb / emptyFor /
 * detailMissing / dangerConfirm / diffViewer / permTag / audit / auditDrawer /
 * notificationBell / tabsBar   （已在 v10 接线里完成）
 * ==========================================================================*/
(function (global) {
  'use strict';

  var AUDIT_KEY = 'aiops:v10:audit';
  var TABS_KEY = 'aiops:v10:tabs';
  /* 页签 key → 中文名（各详情屏渲染时登记）。多页签条据此显示「能力 · 对象 · 页签」，
     否则同一屏的每个页签都顶着一模一样的标签，用户无法区分。 */
  var TAB_LABELS = {};
  var CSS_ID = 'v10-ui-css';

  function SHELL() { return global.APP_SHELL || {}; }
  function esc(s) {
    var S = SHELL();
    if (typeof S.esc === 'function') return S.esc(s);
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function icon(name, size) {
    var S = SHELL();
    return typeof S.icon === 'function' ? S.icon(name, size || 16) : '';
  }
  function safeGet(key) {
    try { return global.sessionStorage ? global.sessionStorage.getItem(key) : null; } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { if (global.sessionStorage) global.sessionStorage.setItem(key, val); } catch (e) { /* 隐私模式 */ }
  }

  /* ---------------------------------------------------------------- 样式注入 */
  function injectCss() {
    if (!global.document || global.document.getElementById(CSS_ID)) return;
    var css = [
      '.v10-sheet-mask{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:80;padding:24px}',
      '.v10-sheet{background:#fff;border-radius:12px;width:min(680px,100%);max-height:86vh;overflow:auto;box-shadow:0 24px 64px rgba(15,23,42,.28)}',
      '.v10-sheet-h{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 10px}',
      '.v10-sheet-h h3{font-size:15.5px;margin:0}',
      '.v10-sheet-x{margin-left:auto;border:0;background:none;font-size:18px;line-height:1;color:var(--faint,#6b7484);cursor:pointer}',
      '.v10-sheet-b{padding:0 20px 8px}',
      '.v10-sheet-desc{color:var(--sub,#5f6b7d);font-size:13px;line-height:1.65}',
      '.v10-impacts{margin:12px 0 0;border:1px solid #e6e9f0;border-radius:10px;overflow:hidden}',
      '.v10-impacts-row{display:flex;gap:12px;padding:9px 12px;font-size:13px;border-top:1px solid #f0f2f7}',
      '.v10-impacts-row:first-child{border-top:0}',
      '.v10-impacts-k{color:var(--faint,#6b7484);flex:0 0 96px}',
      '.v10-impacts-v{color:#1f2733;font-weight:500}',
      '.v10-impacts-v.warn{color:var(--amber,#b45309)}.v10-impacts-v.danger{color:var(--red,#b91c1c)}',
      '.v10-reason{margin-top:12px}',
      '.v10-reason textarea{width:100%;min-height:64px;border:1px solid #e6e9f0;border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;resize:vertical}',
      '.v10-reason .err{color:var(--red,#b91c1c);font-size:12px;margin-top:4px}',
      '.v10-sheet-f{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 18px}',
      /* v42：panel 模式（设置面板）。尺寸与圆角照 dsh 的设置面板：800×800 封顶，
         高度取视口而不是内容 —— 内容撑高的话，每次点左侧分区面板都会跟着跳一下。
         阴影三层：0.5px 极限描边 + 近距 3/8 + 远距 0/20，与 Modal 用同一档 elevation-prominent。 */
      '.v10-sheet.v10-panel{position:relative;width:800px;max-width:calc(100vw - 48px);height:min(800px,calc(100vh - 48px));max-height:none;' +
        'padding:0;overflow:hidden;display:flex;border-radius:var(--dsw-radius-panel,28px);' +
        'box-shadow:0 0 0 .5px rgba(15,23,42,.10),0 3px 8px rgba(15,23,42,.05),0 0 20px rgba(15,23,42,.06)}',
      /* v10b：footer 按钮布局对齐 XConsole slide-panel 真实规范（ISlidePanelProps）——
         「footer 左侧按钮(cancel) / 右侧按钮(ok)」：取消沉到左端、确认留右端，
         主推进动作与逃生口分立两端、距离最大化，防连点误触。
         只对显式 data-v10="cancel" 生效；无取消按钮的 sheet 仍整体靠右。 */
      '.v10-sheet-f [data-v10="cancel"]{margin-right:auto}',
      '.v10-diff{border:1px solid #e6e9f0;border-radius:10px;overflow:hidden;font-family:"SF Mono",Consolas,monospace;font-size:12px;line-height:1.7}',
      '.v10-diff div{padding:1px 10px;white-space:pre-wrap;word-break:break-all}',
      '.v10-diff .same{color:#475569;background:#fff}',
      '.v10-diff .add{color:#15803d;background:#f0fdf4}',
      '.v10-diff .del{color:#b91c1c;background:#fef2f2}',
      '.v10-perm{display:inline-block;font-family:"SF Mono",Consolas,monospace;font-size:11px;color:#475569;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:1px 6px;margin-left:6px}',
      '.v10-note{display:flex;gap:10px;align-items:flex-start;background:#fff7e8;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#8a5a06;line-height:1.6}',
      '.v10-tabsbar{display:flex;gap:4px;overflow-x:auto;padding:3px 16px 0;line-height:1.15;background:#fff;border-bottom:1px solid #e6e9f0}',
      '.v10-tabsbar-item{display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e6e9f0;border-bottom:0;border-radius:6px 6px 0 0;background:#f8fafc;font-size:12px;line-height:1.15;color:#475569;cursor:pointer;white-space:nowrap}',
      '.v10-tabsbar-item.on{background:#fff;color:#1f2733;font-weight:500;box-shadow:inset 0 2px 0 #2563eb}',
      '.v10-tabsbar-item .x{color:var(--decor,var(--faint));font-size:13px}',
      '.v10-tabsbar-item .x:hover{color:var(--red,#b91c1c)}',
      '.v10-notif{position:absolute;top:44px;right:0;width:340px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #e6e9f0;border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.16);z-index:70}',
      '.v10-notif-h{padding:11px 14px;border-bottom:1px solid #f0f2f7;display:flex;align-items:center;gap:8px}',
      '.v10-notif-h b{font-size:13.5px}.v10-notif-h .n{margin-left:auto;font-size:12px;color:var(--faint,#6b7484)}',
      '.v10-notif-g{padding:9px 14px 3px;font-size:11.5px;color:var(--faint,#6b7484);font-weight:600}',
      /* color 不能省：这里是 <a>，不写就会吃 UA 的链接色（实测 rgb(0,0,238)），
         整个通知面板的条目文字一直渲染成浏览器默认蓝，而不是调色板里的任何一色。
         用 var(--text) 而不是 inherit —— 面板挂在 .top-right（color:var(--sub)）下，
         inherit 会拿到次级灰；同级的账号菜单 .acct-mi 就是 --text，两者要一致。
         于是这一层是 头部(--sub) / 标题(--text) / 说明(.sub-h → --faint) 三级。 */
      '.v10-notif-i{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:9px 14px;border:0;background:none;cursor:pointer;font:inherit;color:var(--text,#1f2733)}',
      '.v10-bell-wrap{position:relative;display:inline-flex}',
      '.v10-bell{position:relative;border:0;background:none;cursor:pointer;color:var(--sub,#68738a);padding:4px;display:inline-flex;border-radius:6px}',
      '.v10-bell:hover{background:#f1f3f7;color:var(--text,#1f2733)}',
      '.v10-bell-n{position:absolute;top:-2px;right:-2px;min-width:15px;height:15px;border-radius:99px;background:var(--red,#b91c1c);color:#fff;font-size:10.5px;line-height:15px;text-align:center;font-style:normal;padding:0 3px}',
      '.v10-audit{font-size:12.5px;color:var(--sub,#68738a);cursor:pointer;padding:3px 8px;border-radius:6px}',
      '.v10-audit:hover{background:#f1f3f7;color:var(--text,#1f2733)}',
      /* 改为真 <button> 后需要可见焦点环，键盘用户才找得到 */
      '.v10-audit:focus-visible{outline:2px solid var(--blue,#2563eb);outline-offset:2px}',
      '.v10-tabsbar:empty{display:none}'
    ].join('\n');
    var st = global.document.createElement('style');
    st.id = CSS_ID;
    st.textContent = css;
    global.document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ 弹窗壳 */
  var sheetEl = null, sheetPrevFocus = null;
  function closeSheet() {
    if (sheetEl && sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl);
    sheetEl = null;
    if (global.document) global.document.removeEventListener('keydown', onSheetKey, false);
    /* v10b（走查 3.2）：关闭后把焦点还给触发元素 —— 与账号菜单同一标准 */
    if (sheetPrevFocus && sheetPrevFocus.focus) { try { sheetPrevFocus.focus(); } catch (e) {} }
    sheetPrevFocus = null;
  }
  function onSheetKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    /* v10b：Tab 焦点循环（陷阱）—— aria-modal 声明了就得做到 */
    if (e.key !== 'Tab' || !sheetEl) return;
    var d = global.document;
    var nodes = sheetEl.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) list.push(el);
    }
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1];
    var cur = d.activeElement;
    if (!sheetEl.contains(cur)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  function openSheet(opts) {
    injectCss();
    closeSheet();
    var d = global.document;
    if (!d) return;
    sheetPrevFocus = d.activeElement;
    sheetEl = d.createElement('div');
    sheetEl.className = 'v10-sheet-mask';
    sheetEl.innerHTML = opts.panel
      /* v42：panel 模式 —— 外壳由调用方自己给（设置面板要"左导航 + 右内容"两栏，
         默认那个「标题 + 正文 + 底栏」的 sheet 壳套不进去）。此时不走 .v10-sheet-h/-b/-f，
         bodyHtml 直接铺满整块；关闭仍走 data-v10="close"，Esc / 遮罩 / Tab 陷阱沿用本壳。 */
      ? '<div class="v10-sheet v10-panel" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || '') + '">' +
          (opts.bodyHtml || '') +
        '</div>'
      : /* opts.wide：两栏内容（如文档「左原文 / 右分析」）需要更宽的弹层 */
        '<div class="v10-sheet' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
        '<div class="v10-sheet-h"><h3>' + esc(opts.title || '') + '</h3>' +
        '<button class="v10-sheet-x" data-v10="close" aria-label="关闭">×</button></div>' +
        '<div class="v10-sheet-b">' + (opts.bodyHtml || '') + '</div>' +
        (opts.footHtml ? '<div class="v10-sheet-f">' + opts.footHtml + '</div>' : '') +
      '</div>';
    sheetEl.addEventListener('click', function (e) {
      if (e.target === sheetEl || (e.target.getAttribute && e.target.getAttribute('data-v10') === 'close')) closeSheet();
    });
    d.body.appendChild(sheetEl);
    d.addEventListener('keydown', onSheetKey, false);
    /* 打开即聚焦：危险确认默认落在「取消」上（安全动作优先），无则首个可聚焦控件 */
    var prefer = sheetEl.querySelector('[data-v10="cancel"]');
    var firstCtl = prefer || (function () {
      var ns = sheetEl.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      for (var i = 0; i < ns.length; i++) {
        var el = ns[i];
        if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return el;
      }
      return null;
    })();
    if (firstCtl) firstCtl.focus();
    if (opts.onOpen) opts.onOpen(sheetEl);
    return sheetEl;
  }

  /* -------------------------------------------------------------------- 审计 */
  function auditList() {
    var raw = safeGet(AUDIT_KEY);
    if (!raw) return [];
    try { var a = JSON.parse(raw); return Object.prototype.toString.call(a) === '[object Array]' ? a : []; } catch (e) { return []; }
  }
  /* 演示环境没有真实会话，取全局身份源；生产环境应由后端从 token 注入，前端不得自行填写。
     ⚠ 落进审计的操作人必须由服务端认定，前端可写 = 审计可伪造。 */
  function currentActor() {
    var me = global.CURRENT_USER;
    if (me) return { actor: me.name, actorId: me.id, actorRole: me.role };
    return { actor: '未知用户', actorId: '—', actorRole: '—' };
  }
  /* 展示上限（仅 UI 渲染用，不是丢弃阈值） */
  var AUDIT_UI_CAP = 2000;
  var AUDIT_ARCHIVE_KEY = 'aiops:v10:audit:archive';
  function auditArchive() {
    var raw = safeGet(AUDIT_ARCHIVE_KEY);
    if (!raw) return [];
    try { var a = JSON.parse(raw); return Object.prototype.toString.call(a) === '[object Array]' ? a : []; }
    catch (e) { return []; }
  }

  /* configDiff：把 { from, to } 渲染成 before → after 的差异行。
     用途：应用配置前必须让用户**看见自己改了什么** —— 只弹"已应用"是假成功。 */
  function configDiff(from, to, path) {
    function flat(o, pre) {
      var out = [];
      if (o == null || typeof o !== 'object') { out.push([pre || '', o]); return out; }
      Object.keys(o).forEach(function (k) {
        var v = o[k], key = pre ? pre + '.' + k : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) out = out.concat(flat(v, key));
        else out.push([key, Array.isArray(v) ? JSON.stringify(v) : v]);
      });
      return out;
    }
    var A = flat(from), B = flat(to), keys = [];
    A.forEach(function (r) { if (keys.indexOf(r[0]) < 0) keys.push(r[0]); });
    B.forEach(function (r) { if (keys.indexOf(r[0]) < 0) keys.push(r[0]); });
    function get(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return undefined; }
    return keys.map(function (k) {
      var a = get(A, k), b = get(B, k);
      var shown = function (v) { return v === undefined ? '（无）' : (v === null ? '无' : String(v)); };
      var changed = shown(a) !== shown(b);
      return { label: k, value: shown(a) + (changed ? '  →  ' + shown(b) : '（不变）'), tone: changed ? 'warn' : '' };
    });
  }

  function audit(entry) {
    var who = currentActor();
    var row = {
      action: (entry && entry.action) || '未命名操作',
      target: (entry && entry.target) || '—',
      impact: (entry && entry.impact) || '',
      at: (entry && entry.at) || new Date().toISOString(),
      /* 操作人：此前缺失，导致「谁做的」查不到 —— 权限体系的硬伤 */
      actor: (entry && entry.actor) || who.actor,
      actorId: (entry && entry.actorId) || who.actorId,
      actorRole: (entry && entry.actorRole) || who.actorRole,
      /* 🔴 补：调用方传了 reason 却曾被静默丢弃（校验 11 首个实例） */
      reason:   (entry && entry.reason != null) ? String(entry.reason) : null,
      decision: (entry && entry.decision) || null,
      policyDigest: (entry && entry.policyDigest) || null
    };
    var list = auditList();
    list.push(row);
    /* 🔴 纪律：状态历史只追加、不改写（校验 7）。此前 slice 丢弃最早记录，*/
    /*    违反本原型自己声明的 append-only 不变量 —— 改为归档，绝不丢。   */
    if (list.length > AUDIT_UI_CAP) {
      var spill = list.slice(0, list.length - AUDIT_UI_CAP);
      var arch = auditArchive();
      for (var ai = 0; ai < spill.length; ai++) arch.push(spill[ai]);
      safeSet(AUDIT_ARCHIVE_KEY, JSON.stringify(arch));
      list = list.slice(list.length - AUDIT_UI_CAP);
    }
    safeSet(AUDIT_KEY, JSON.stringify(list));
    refreshAuditBadge();
    return row;
  }

  /* 顶栏「审计」显示条数 —— 「直接执行、留记录」里的"记录"必须看得见，
     否则点完只有一句 toast，用户没法确认自己真的留下了一条。 */
  function refreshAuditBadge() {
    try {
      var btn = global.document && global.document.getElementById('v10-audit-btn');
      if (!btn) return;
      var n = auditList().length;
      btn.textContent = n ? ('审计 · ' + n) : '审计';
      btn.setAttribute('title', '审计记录 · 本次会话 ' + n + ' 条');
    } catch (e) { /* 顶栏未就绪 */ }
  }
  function fmtAt(iso) {
    var s = String(iso || '');
    return s.length >= 16 ? s.slice(5, 16).replace('T', ' ') : s;
  }
  function auditDrawer(h) {
    var list = auditList();
    var body;
    if (!list.length) {
      body = '<div class="empty"><div class="empty-title">暂无审计记录</div>' +
        '<div class="empty-sub">在本页做过写操作（且已确认）后，这里会留痕</div></div>';
    } else {
      body = list.slice().reverse().map(function (r) {
        /* 操作人放最前 —— 审计要先回答「谁」，再回答「做了什么」 */
        return '<div class="v10-impacts-row"><span class="v10-impacts-k">' + esc(fmtAt(r.at)) + '</span>' +
          '<span class="v10-impacts-v"><b>' + esc(r.actor || '未知用户') + '</b>' +
          (r.actorRole ? '<span class="v10-impacts-k" style="display:inline;margin:0 6px">' + esc(r.actorRole) + '</span>' : '') +
          ' · ' + esc(r.action) + ' · ' + esc(r.target) +
          (r.impact ? '<span class="v10-impacts-k" style="flex:0 0 auto;margin-left:8px">' + esc(r.impact) + '</span>' : '') +
          /* 🔴 理由单独显示（此前被拼进 impact，与影响面语义混用） */
          (r.reason ? '<span class="v10-impacts-k" style="flex:0 0 auto;margin-left:8px">理由：' + esc(r.reason) + '</span>' : '') +
          '</span></div>';
      }).join('');
      var _arch = auditArchive();
      body = '<div class="bt-note">共 ' + (list.length + _arch.length) + ' 条' +
        (_arch.length ? '（展示最近 ' + list.length + ' 条，更早 ' + _arch.length + ' 条<b>已归档、未删除</b>）' : '') +
        '；仅存于浏览器会话存储，<b>刷新即清空</b>，非真实审计</div>' +
        '<div class="v10-impacts">' + body + '</div>';
    }
    return '<div class="v10-sheet-b">' + body + '</div>';
  }

  /* ------------------------------------------------------------------ 详情件 */
  function detailTabs(cap, state, tabs, h) {
    injectCss();
    var E = h || (global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null);
    var nav = E && E.navigate ? E.navigate : function () {};
    /* 入参兼容：调用方历史上传过 key（asset/sandbox/gov/flow）也传过 id（survey），
       统一取 key || id —— 否则页签渲染成 data-v10-tab=""，点了 URL 变内容不变、且会全部高亮。 */
    function tabKey(t) { return t && (t.key != null ? t.key : t.id); }
    var active = (state && (state.objTab || state.tab)) || (tabs[0] && tabKey(tabs[0]));
    var html = '<div class="tabs" role="tablist">';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i], k = tabKey(t);
      if (cap && cap.id != null) TAB_LABELS[cap.id + '|' + k] = t.label;
      /* 徽标只在该有内容时才出现。此前判据是 `typeof t.badge === 'number'` ——
         传 0 也会渲染出一个「0」徽标（实测经验详情「关联 badcase 0」）。
         数字 0 意味着这一栏没东西可看，挂个 0 只是噪声；非空字符串徽标（如 Agent 的「灰度 20%」）照常渲染。 */
      var showBadge = (typeof t.badge === 'number' && t.badge > 0) ||
                      (typeof t.badge === 'string' && t.badge.trim() !== '');
      html += '<button role="tab" class="tab' + (k === active ? ' on' : '') + '" data-v10-tab="' + esc(k) + '">' +
        esc(t.label) + (showBadge ? '<i class="tab-badge">' + t.badge + '</i>' : '') + '</button>';
    }
    html += '</div>';
    /* 委托：一次性绑在 document 上，避免每次重渲染丢事件 */
    if (!global.document.__v10TabBound) {
      global.document.__v10TabBound = true;
      global.document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-v10-tab]') : null;
        if (!el) return;
        var f = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
        if (f && f.navigate) f.navigate({ tab: el.getAttribute('data-v10-tab'), objTab: el.getAttribute('data-v10-tab') });
      }, false);
    }
    return html;
  }

  function pageCrumb(items) {
    var arr = [];
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      arr.push(esc(typeof it === 'string' ? it : (it && (it.text || it.label)) || ''));
    }
    if (!arr.length) return '';
    return '<nav class="crumb" aria-label="面包屑">' + arr.join(' <span class="crumb-sep">/</span> ') + '</nav>';
  }

  function emptyFor(title, sub, iconName) {
    return '<div class="empty">' + (iconName ? '<div class="empty-ico">' + icon(iconName, 28) + '</div>' : '') +
      '<div class="empty-title">' + esc(title || '暂无数据') + '</div>' +
      '<div class="empty-sub">' + esc(sub || '') + '</div></div>';
  }

  function detailMissing(cap, state, h) {
    var E = h || (global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null);
    var nav = E && E.navigate ? E.navigate : function () {};
    var id = (state && (state.objId || state.agentId)) || '—';
    return '<div class="empty">' +
      '<div class="empty-ico">' + icon('doc', 28) + '</div>' +
      '<div class="empty-title">未找到该对象</div>' +
      '<div class="empty-sub">' + esc((cap && cap.name) || '页面') + ' · ID：' + esc(id) + '</div>' +
      '<button class="btn-ghost" data-v10-back="1">返回列表</button></div>' +
      '<div class="v10-back-init" data-v10-back-init="1"></div>';
  }

  /* -------------------------------------------------------- 权限门禁 checkPerm
   * 此前全站 perm 只是一个「展示标签」—— 弹层写着「所需权限 agent:publish」，
   * 但没有任何一处校验，点谁都能过。给人虚假的安全感，比没有门禁更危险。
   *
   * 现在 dangerConfirm 是所有危险操作的唯一咽喉（20+ 个写操作全走它），
   * 在入口处校验即可一处收口，不必回到每个渲染点去改。
   *
   * ⚠ 生产实现要点：权限判定必须由服务端做，前端置灰只是体验。
   *   前端可写 = 门禁可绕过。所以这里是「演示真实交互」，不是安全边界。
   */
  function checkPerm(perm) {
    if (!perm) return { ok: true };
    var S = global.DATA_SEED;
    if (!S || !S.ME) return { ok: true, note: '未接入权限系统' };
    var me = S.ME;
    var meta = S.permMeta ? S.permMeta(perm) : null;

    /* v23 第三批：到期校验。
       页面上一早就承诺「90 天到期未确认自动降级为只读」—— 如果代码里不拦，
       那句话就是空的。这里把「持有但已过期」单独识别出来，给出不同的拦截理由：
       不是「你从没这个权限」，而是「你有过，但到期了，重新确认就能用」。 */
    var expiredGrant = null;
    if (S.GRANT_RECORDS && S.grantState) {
      expiredGrant = S.GRANT_RECORDS.filter(function (g) {
        if (g.member !== me.id) return false;
        if (g.perm) return g.perm === perm;
        return (S.rolePerms(g.role) || []).indexOf(perm) > -1;
      }).filter(function (g) { return S.grantState(g) === 'expired'; })[0] || null;
    }

    if (me.perms && me.perms.indexOf(perm) > -1) {
      /* 持有但已过期 → 拦下，并说明是到期而非缺失 */
      if (expiredGrant) {
        return {
          ok: false, perm: perm, meta: meta, role: me.role || '当前角色',
          owners: (S.ROLES || []).filter(function (r) {
            return (S.rolePerms(r.id) || []).indexOf(perm) > -1;
          }).map(function (r) { return r.name; }),
          highRisk: !!(meta && meta.risk === 'high'),
          expired: true, grant: expiredGrant,
          daysLeft: S.grantDaysLeft(expiredGrant)
        };
      }
      var expiring = null;
      if (S.GRANT_RECORDS && S.grantState) {
        expiring = S.GRANT_RECORDS.filter(function (g) {
          if (g.member !== me.id) return false;
          if (g.perm) return g.perm === perm;
          return (S.rolePerms(g.role) || []).indexOf(perm) > -1;
        }).filter(function (g) { return S.grantState(g) === 'expiring'; })[0] || null;
      }
      return { ok: true, meta: meta, grant: expiring, expiring: !!expiring };
    }

    var roleName = me.role || '当前角色';
    /* 找出该权限应该归谁 —— 让用户知道去哪儿申请，而不是只被拒 */
    var owners = (S.ROLES || []).filter(function (r) {
      return (S.rolePerms(r.id) || []).indexOf(perm) > -1;
    }).map(function (r) { return r.name; });
    return {
      ok: false, perm: perm, meta: meta, role: roleName,
      owners: owners,
      /* 高危权限未授予要单独提示：越权意味的不是「点不了」，而是「有人盯着」 */
      highRisk: !!(meta && meta.risk === 'high')
    };
  }

  /** 无权限时的替代弹层：说清「缺哪个权限 / 谁能给 / 怎么申请」，而不是静默失败 */
  function permDeniedSheet(h, chk, opts) {
    var E = h || (global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null);
    var meta = chk.meta || { label: chk.perm, grp: '—', risk: 'low' };

    /* v23：到期 与 从未持有 是两回事，文案必须分开。
       说成「未包含该权限点」等于告诉用户去申请 —— 而他其实该做的是重新确认。
       这类「把一种原因说成另一种」的错，比拦截本身更容易误导人。 */
    if (chk.expired) {
      var g = chk.grant || {};
      var days = Math.abs(chk.daysLeft || 0);
      openSheet({
        title: '授权已到期',
        bodyHtml:
          '<div class="v10-sheet-desc"><b style="color:#dc2626">授权已到期，操作被拦截</b></div>' +
          '<div class="v10-impacts" style="margin-top:10px">' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">要做的操作</span><span class="v10-impacts-v">' + esc((opts && opts.title) || '危险操作') + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">涉及权限</span><span class="v10-impacts-v">' + permTag(chk.perm) + '　' + esc(meta.label) + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">授权来源</span><span class="v10-impacts-v">' +
          esc(g.via === 'extra' ? '单独授予（' + g.perm + '）' : '角色「' + ((global.DATA_SEED.ROLES || []).filter(function (r) { return r.id === g.role; })[0] || {}).name + '」') + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">授予日期</span><span class="v10-impacts-v">' + fmtAt(new Date(g.grantAt).toISOString()) + '</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">有效期</span><span class="v10-impacts-v danger">' + g.ttlDays + ' 天，已超期 ' + days + ' 天</span></div>' +
          '<div class="v10-impacts-row"><span class="v10-impacts-k">原授予理由</span><span class="v10-impacts-v">' + esc(g.reason || '—') + '</span></div>' +
          '</div>' +
          '<div class="bt-note" style="margin-top:10px"><b>这不等于你没有这个权限，而是授权需要重新确认。</b><br>' +
          '确认后立即恢复；若原授权理由已不成立，应走重新申请而不是续期。<br>' +
          '生产环境：到期前 N 天应自动提醒审批人，逾期未确认自动降级为只读。</div>' +
          '<div class="bt-note" style="margin-top:8px">本次拦截已留审计。</div>',
        footHtml: '<button class="btn-ghost" data-v10="cancel">知道了</button>' +
          '<button class="btn-primary" data-v10="reconfirm">发起重新确认</button>',
        onOpen: function (root) {
          root.addEventListener('click', function (e) {
            var v = e.target.getAttribute && e.target.getAttribute('data-v10');
            if (v === 'cancel') { closeSheet(); return; }
            if (v !== 'reconfirm') return;
            closeSheet();
            audit({ action: '发起权限重新确认', target: (meta.label || chk.perm) + ' · 原授权已超期 ' + days + ' 天', impact: '进入审批队列', at: null });
            if (E && E.toast) E.toast('已提交重新确认：' + (meta.label || chk.perm) + '（演示环境，不改变实际权限）', 'ok');
          });
          audit({
            action: '到期拦截', target: ((opts && opts.title) || '危险操作') + ' · ' + chk.perm + ' 授权超期',
            impact: '操作未执行', at: null
          });
        }
      });
      return;
    }

    var body =
      '<div class="v10-sheet-desc"><b style="color:#dc2626">权限不足，操作已被拦截</b></div>' +
      '<div class="v10-impacts" style="margin-top:10px">' +
      '<div class="v10-impacts-row"><span class="v10-impacts-k">要做的操作</span><span class="v10-impacts-v">' + esc((opts && opts.title) || '危险操作') + '</span></div>' +
      '<div class="v10-impacts-row"><span class="v10-impacts-k">缺失权限</span><span class="v10-impacts-v">' + permTag(chk.perm) + '　' + esc(meta.label) + '</span></div>' +
      '<div class="v10-impacts-row"><span class="v10-impacts-k">权限域</span><span class="v10-impacts-v">' + esc(meta.grp) + '</span></div>' +
      '<div class="v10-impacts-row"><span class="v10-impacts-k">风险等级</span><span class="v10-impacts-v' + (meta.risk === 'high' ? ' danger' : '') + '">' +
      esc({ low: '低', mid: '中', high: '高' }[meta.risk] || meta.risk) + '</span></div>' +
      '<div class="v10-impacts-row"><span class="v10-impacts-k">当前角色</span><span class="v10-impacts-v">' + esc(chk.role) + ' —— 未包含该权限点</span></div>' +
      '</div>' +
      (chk.owners.length
        ? '<div class="bt-note" style="margin-top:10px">该权限由 <b>' + esc(chk.owners.join(' / ')) + '</b> 持有，需向其申请授权。' +
          (chk.highRisk ? '<br><b class="bad">高危权限授予需二次审批，且每 90 天须重新确认。</b>' : '') + '</div>'
        : '<div class="bt-note" style="margin-top:10px">当前无任何角色持有该权限点 —— 需平台管理员先在角色矩阵中配置。</div>') +
      '<div class="bt-note" style="margin-top:8px">本次拦截已留审计（谁尝试了什么、缺哪个权限）。</div>';
    openSheet({
      title: '权限不足',
      bodyHtml: body,
      footHtml: '<button class="btn-ghost" data-v10="cancel">知道了</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (e) {
          if (e.target.getAttribute && e.target.getAttribute('data-v10') === 'cancel') closeSheet();
        });
        /* 拦截本身入审计 —— 「有人尝试越权」是安全事件里最该留痕的一类 */
        audit({
          action: '越权拦截', target: ((opts && opts.title) || '危险操作') + ' · 缺 ' + chk.perm,
          impact: '操作未执行', at: null
        });
      }
    });
  }

  /* -------------------------------------------------------- 操作执行：普通静默、高危问一句
   * 2026-10-21 业主两句话定下来的：
   *   ①「这么麻烦干什么，直接通过，留记录」
   *   ②「底下写已记录就可以，不要弹窗，除非高危操作要弹窗二次操作，其他接近无感」
   *
   * 于是分两档，判据是**这次操作能不能撤回**：
   *   · 普通（发布、上线、落地、授权、改配置）→ 点下去就生效，底部一句「已记录」，不打断；
   *   · 高危（下线、终止、删除、回滚、吊销、停用）→ 弹一次确认（只问"做不做"，不问理由）。
   * 判据取 opts.tone === 'danger'（作者标 danger 的本来就是最危险那批），
   * 再用标题关键词兜底，防止哪次调用忘了标 tone。
   *
   * 无论哪档，执行完都写一条审计（谁/何时/对谁/做了什么/影响面），顶栏数字实时 +1。
   * 调用方自己发的长 toast（"已落地 · 「xxx」，已写审计"）会被吞掉，统一成「已记录」——
   * 否则每处文案都要跟着改，且长短不一。
   */
  var HIGH_RISK_RE = /下线|终止|删除|删除|回滚|吊销|撤销|停用|弃用|清空|移除|解绑|摘掉/;

  function dangerConfirm(h, opts) {
    opts = opts || {};
    var E = h || (global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null);

    /* 门禁：权限不足直接换拦截弹层，绝不执行 */
    var chk = checkPerm(opts.perm);
    if (!chk.ok) { permDeniedSheet(h, chk, opts); return; }

    var titleTxt = String(opts.title || opts.action || '');
    var isHigh = opts.tone === 'danger' || HIGH_RISK_RE.test(titleTxt);

    /* 🔴 2026-10-22：`requireReason` 此前**只是被接收、从未被实现** ——
       调用方（v34 的授权、v41 的发布旅程）传了 requireReason: true，弹层里却没有理由输入框，
       onConfirm 收到的也永远是空字符串，审计里的 reason 一律是 null。
       「高危操作要填理由」这句话在 UI 上等于没说过。现在补上：
       弹层里放一个必填的 textarea，没填时确认键置灰，填了才放行，理由一并进审计。 */
    var doIt = function (reason) {
      /* 吞掉调用方自己的 toast，统一成一句「已记录」 */
      var hadToast = (h && typeof h.toast === 'function');
      var origToast = hadToast ? h.toast : null;
      if (hadToast) h.toast = function () {};
      try {
        if (typeof opts.onConfirm === 'function') opts.onConfirm(reason || '');
      } catch (err) { if (global.console) global.console.error(err); }
      if (hadToast) h.toast = origToast;

      audit({
        action: opts.action || String(opts.title || '确认操作').replace(/[？?]\s*$/, ''),
        target: opts.target || opts.desc || '—',
        impact: opts.auditImpact || '',
        reason: reason || null,
        at: null
      });
      if (hadToast) origToast('已记录', 'ok');
    };

    if (!isHigh) { doIt(); return; }

    /* 高危：只确认，不问理由 */
    var impacts = opts.impacts || [];
    var rows = impacts.map(function (it) {
      var tone = it.tone === 'danger' ? ' danger' : (it.tone === 'warn' ? ' warn' : '');
      return '<div class="v10-impacts-row"><span class="v10-impacts-k">' + esc(it.label) + '</span>' +
        '<span class="v10-impacts-v' + tone + '">' + esc(it.value) + '</span></div>';
    }).join('');
    openSheet({
      title: opts.title || '确认操作？',
      bodyHtml: (opts.desc ? '<div class="v10-sheet-desc">' + esc(opts.desc) + '</div>' : '') +
        (rows ? '<div class="v10-impacts">' + rows + '</div>' : '') +
        (opts.requireReason
          ? '<div class="v10-reason"><label for="v10-reason">理由（必填，会记进审计）</label>' +
            '<textarea id="v10-reason" data-v10="reason" rows="2" placeholder="' +
            esc(opts.reasonPlaceholder || '一句话说明为什么现在做这件事') + '"></textarea></div>'
          : '') +
        '<div class="bt-note" style="margin-top:8px">这一下改不回来，所以问一句；其它操作都是点了就生效。</div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn-danger" data-v10="ok"' + (opts.requireReason ? ' disabled' : '') + '>' +
        esc(opts.confirmText || '确认') + '</button>',
      onOpen: function (root) {
        var ta = root.querySelector('[data-v10="reason"]');
        var ok = root.querySelector('[data-v10="ok"]');
        if (ta && ok) {
          ta.addEventListener('input', function () {
            if (ta.value.trim()) ok.removeAttribute('disabled');
            else ok.setAttribute('disabled', 'disabled');
          });
        }
        root.addEventListener('click', function (e) {
          var g = e.target.getAttribute && e.target.getAttribute('data-v10');
          if (g === 'cancel') { closeSheet(); return; }
          if (g !== 'ok') return;
          /* 必填理由：空着就不放行（按钮置灰之外再挡一道，防键盘回车绕过） */
          if (opts.requireReason && ta && !ta.value.trim()) {
            ta.focus();
            return;
          }
          var reason = ta ? ta.value.trim() : '';
          closeSheet();
          doIt(reason);
        });
      }
    });
  }

  /* ------------------------------------------------------------ 变更 diff */
  function diffViewer(before, after, opts) {
    injectCss();
    opts = opts || {};
    var a = String(before == null ? '' : before).split('\n');
    var b = String(after == null ? '' : after).split('\n');
    var max = Math.max(a.length, b.length);
    var out = [], changed = 0;
    for (var i = 0; i < max; i++) {
      var x = a[i], y = b[i];
      if (x === y) { out.push('<div class="same">  ' + esc(x == null ? '' : x) + '</div>'); }
      else {
        if (x != null) out.push('<div class="del">- ' + esc(x) + '</div>');
        if (y != null) out.push('<div class="add">+ ' + esc(y) + '</div>');
        changed++;
      }
    }
    return '<div class="sub-h">' + esc(opts.title || '变更对比') +
      '（' + changed + ' 处不同' + (opts.note ? ' · ' + esc(opts.note) : '') + '）</div>' +
      '<div class="v10-diff">' + out.join('') + '</div>';
  }

  function permTag(perm) { injectCss(); return '<span class="v10-perm">' + esc(perm) + '</span>'; }

  /* -------------------------------------------------------------- 通知中心 */
  function pendingStats() {
    var A = global.APP_DATA;
    if (!A || typeof A.pendingStats !== 'function') return null;
    try { return A.pendingStats(); } catch (e) { return null; }
  }
  /* -------------------------------------------------- 异步长任务结果（会话级台账）
   * 重建 / 回滚索引是后台长任务，结果记在这里供回看 —— toast 会消失，承担不了回看。
   * 与顶栏其它数字一致：会话内派生，刷新即清空 —— 原型无后端，不做持久化。 */
  var ASYNC_SEQ = 0;
  var ASYNC_RESULTS = [];

  function asyncResult(entry) {
    if (!entry) return null;
    var item = {
      id: 'ar-' + (++ASYNC_SEQ),
      title: String(entry.title || ''),
      desc: String(entry.desc || ''),
      href: String(entry.href || ''),
      tone: entry.tone || 'info',
      read: false
    };
    ASYNC_RESULTS.unshift(item);
    if (ASYNC_RESULTS.length > 20) ASYNC_RESULTS.length = 20;
    /* 角标归壳层管，这里主动喊一声 —— 别让调用方记得"写完回执还要再刷一次角标"。
       重建索引那条路就是先 navigate（刷角标）后写回执，靠调用顺序必漏。 */
    var S = global.APP_SHELL;
    if (S && typeof S.refreshBellBadge === 'function') S.refreshBellBadge();
    return item;
  }
  function asyncUnread() {
    var n = 0;
    for (var i = 0; i < ASYNC_RESULTS.length; i++) if (!ASYNC_RESULTS[i].read) n++;
    return n;
  }
  /* 面板一打开就算读过 —— 由 notificationBell 在渲染末尾调用（它只在铃铛被点时执行） */
  function asyncMarkRead() {
    for (var i = 0; i < ASYNC_RESULTS.length; i++) ASYNC_RESULTS[i].read = true;
  }

  function notificationBell(h) {
    injectCss();
    var st = pendingStats();
    var E = (global.APP_SHELL && global.APP_SHELL.state) || {};
    if (!st) {
      return '<div class="v10-sheet-desc">数据未就绪</div>';
    }
    var groups = [
      { name: '需我处理', items: [
        /* 2026-10-21：单人系统，审批下线 —— 这一项不再出现（指向的页面已只剩历史存档） */
        { label: '合规待复核', n: st.compliance, href: '#/engine/compliance', desc: '未过合规不允许投放' },
        { label: 'badcase 待跟进', n: st.badcase, href: '#/platform/obs/badcase', desc: '按严重级别排序' }
      ] },
      { name: '异步结果', items: [
        { label: '灰度待决策转全量', n: st.gray, href: '#/platform/agent-wb', desc: '灰度版本等待人工决策' }
      ] }
    ];
    /* 2026-10-20：Workflow 一页下线 —— 原「系统告警 › Workflow 运行失败」一项与其计数
       （st.workflowFail）一并删除；该项的 href 指向的页面已不存在。组没了就不留空组头。 */
    var total = (st.compliance || 0) + (st.badcase || 0) + (st.gray || 0);
    var unread = asyncUnread();
    var html = '<div class="v10-notif-h"><b>通知</b><span class="n">待处理 ' + total + ' 项' +
      (unread ? ' · 新结果 ' + unread + ' 项' : '') + '</span></div>';
    /* 本会话真实跑完的后台操作回执，挂在既有「异步结果」组下面。
       那个组本来只有一条「灰度待决策转全量」（由队列派生），语义相同 ——
       另起一个同名组头会看到并排两个「异步结果」，所以并进去而不是新增。 */
    function asyncItems() {
      return ASYNC_RESULTS.map(function (x) {
        var pk = x.read ? 'idle' : (x.tone === 'ok' ? 'ok' : (x.tone === 'bad' ? 'bad' : 'info'));
        return '<a class="v10-notif-i" href="' + esc(x.href || '#') + '">' +
          '<span class="pill ' + pk + '">' + (x.read ? '已读' : '新') + '</span>' +
          '<span><b>' + esc(x.title) + '</b><div class="sub-h" style="margin:2px 0 0">' + esc(x.desc) + '</div></span>' +
          '</a>';
      }).join('');
    }
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var live = g.items.filter(function (x) { return x.n > 0; });
      var withResults = (g.name === '异步结果') && ASYNC_RESULTS.length > 0;
      if (!live.length && !withResults) continue;
      html += '<div class="v10-notif-g">' + g.name + '</div>';
      html += live.map(function (x) {
        return '<a class="v10-notif-i" href="' + x.href + '">' +
          '<span class="pill ' + (g.name === '需我处理' ? 'warn' : (g.name === '系统告警' ? 'bad' : 'info')) + '">' + x.n + '</span>' +
          '<span><b>' + esc(x.label) + '</b><div class="sub-h" style="margin:2px 0 0">' + esc(x.desc) + '</div></span>' +
          '</a>';
      }).join('');
      if (withResults) html += asyncItems();
    }
    asyncMarkRead();
    html += '<div class="v10-notif-g" style="padding-bottom:10px">待处理事项由当前队列实时派生；异步结果为本会话真实产生的记录，刷新即清空</div>';
    return html;
  }

  /* ---------------------------------------------------------------- 多页签 */
  function tabsList() {
    var raw = safeGet(TABS_KEY);
    if (!raw) return [];
    try {
      var a = JSON.parse(raw);
      if (Object.prototype.toString.call(a) !== '[object Array]') return [];
      /* 能力改名后，历史页签里存的还是旧 hash —— 在这里就地改写，免得留下一排点不开的死页签 */
      a.forEach(function (t) {
        if (t && typeof t.hash === 'string' && t.hash.indexOf('/engine/survey') >= 0) {
          t.hash = t.hash.replace('/engine/survey', '/engine/interview');
        }
      });
      /* 2026-10-20：Workflow 一页下线 —— 本地存着的死页签就地剔除（hash 指向已不存在的能力）。
         不剔除的话，顶栏会留一个点开就「地址不存在」的页签。 */
      a = a.filter(function (t) { return !(t && typeof t.hash === 'string' && /^#\/platform\/workflow(?:[\/?#]|$)/.test(t.hash)); });
      return a;
    } catch (e) { return []; }
  }
  /* v37：页签去重用的 key。Agent 详情的 hash 是
     `#/<domain>/agent-wb/<agentId>/<session|monitor|manage|debug>`，页内页签写在末段 ——
     一个 Agent 的四个页内页签应当共用一条顶栏页签，所以把末段摘掉。
     其它 hash 原样返回（列表页、别的详情页不受影响）。 */
  function tabKeyOf(hash) {
    var m = /^#\/([^\/]+)\/agent-wb\/([^\/?#]+)\/(?:session|monitor|manage|debug)(?:[?#]|$)/.exec(String(hash || ''));
    return m ? '#/' + m[1] + '/agent-wb/' + m[2] : String(hash || '');
  }
  /* 解析「能力 + 对象 id」→ 对象名；解析不到返回 ''。集合名取自 CAPS 声明的 table/queue。
     这里刻意**不回落打印 id** —— 面包屑/页签条此前会把 ps-gov、cp-1、mcp-crm-query 印给用户。
     另有一类：行有 name，但那个 name 是**机器令牌**（沙盒的 sbx-code-exec）。
     判据是"含中日韩字符"，因为这类行都另有一个给人看的 kindText（代码执行池）。
     name 本身可读时（mcp://crm/query 是服务名）不动它 —— 服务名就是它的名字。 */
  function objectNameOf(cap, id) {
    if (!cap || !id) return '';
    var C = global.APP_DATA, seed = global.DATA_SEED || {};
    var coll = cap.table || cap.queue;
    if (!coll) coll = cap.id === 'agent-wb' ? 'agent' : (cap.id === 'gateway' ? 'services' : null);
    var row = null;
    if (coll && C && typeof C.byId === 'function') { try { row = C.byId(coll, id); } catch (e) { row = null; } }
    var lists = [seed.AGENTS, seed.MCP_SERVICES];
    for (var L = 0; !row && L < lists.length; L++) {
      var arr = lists[L] || [];
      for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) { row = arr[i]; break; }
    }
    if (!row) return '';
    var nm = row.name || row.title || '';
    if (!nm) return row.kindText || '';
    if (!/[\u4e00-\u9fa5\u3040-\u30ff]/.test(nm) && /[\u4e00-\u9fa5]/.test(row.kindText || '')) return row.kindText;
    return nm;
  }
  function tabsBar(h) {
    injectCss();
    var hash = (global.location && global.location.hash) || '#/overview';
    var E = (global.APP_SHELL && global.APP_SHELL.state) || {};
    var A = global.APP_DATA;
    var label = hash;
    if (hash === '#/overview' || hash === '') label = '工作台总览';
    else if (A && A.caps) {
      /* 2026-10-20 走查修复：正则原来只认两段 `#/<domain>/<cap>`，而侧栏跳转与
         app.js 的 navigate 生成的是**单段** `#/knowledge` —— 匹配失败后 label 直接
         回落到 hash 原串，于是顶栏页签显示成 `#/knowledge`，而同页详情页（三段 hash）
         显示的却是「企业知识库 · 产品文档库」。同一条页签栏两种文字。
         现在把段拆开、逐个比对 cap id，一段两段都认。 */
      var segs = (hash.replace(/^#\//, '').split('?')[0] || '').split('/').filter(Boolean);
      var cap = null;
      for (var si = 0; si < segs.length && !cap; si++) {
        for (var i = 0; i < A.caps.length; i++) { if (A.caps[i].id === segs[si]) { cap = A.caps[i]; break; } }
      }
      if (cap) {
          var nm = objectNameOf(cap, E.agentId);
          label = cap.name + (nm ? ' · ' + nm : '');
          /* 页签段在 hash 里的位置不固定（有对象时是第 4 段、无对象时是第 3 段），
             所以按位置取会取错 —— 统一从 state 取，并以当前渲染出的屏内页签条文字兜底
             （Agent 详情走 data-tab，不经过 detailTabs，登记表里没有它）。 */
          var tk = E.objTab || E.tab, tl = '';
          if (tk) tl = TAB_LABELS[cap.id + '|' + tk] || '';
          /* v24：兜底不再要求 tk 存在 —— 屏内分页不一定写在 state.tab 上
             （Agent 工作台的「网状关系」走 state.agentPageTab，tab 留给详情页用），
             它同样只能靠渲染出来的页签条文字识别。否则多页签条里
             「Agent 列表」与「网状关系」会显示成两个一模一样的「Agent 工作台」。 */
          if (!tl && global.document) {
            var onTab = global.document.querySelector('#content .tab.on');
            if (onTab) tl = String(onTab.innerText || '').replace(/\s+/g, ' ').replace(/\s*\d+$/, '').trim();
          }
          if (tl) label += ' · ' + tl;
      }
    }
    var list = tabsList();
    /* v37：同一个 Agent 详情的 4 个页内页签（会话/监控/管理/日志）在顶栏各占一条 ——
       页签 key 原来是**完整 hash**，切一次 tab 就多一条，文字只差末两个字，看起来像点重了。
       这里把「对象页签」的 key 收敛到对象本身（去掉末尾页内段），一条页签代表一个 Agent，
       文字随当前页内页签更新，点它回到最后停留的那一页。
       历史数据里已经堆出来的重复项一并折叠：保留最后一条（= 最后停留的页），
       位置沿用最早出现处，免得整条页签条重排。 */
    var merged = [], at = {};
    for (var mi = 0; mi < list.length; mi++) {
      var mk = tabKeyOf(list[mi] && list[mi].hash);
      if (at[mk] == null) { at[mk] = merged.length; merged.push(list[mi]); }
      else { merged[at[mk]] = list[mi]; }
    }
    list = merged;
    var key = tabKeyOf(hash);
    var found = -1;
    for (var j = 0; j < list.length; j++) if (tabKeyOf(list[j].hash) === key) found = j;
    if (found < 0) {
      list.push({ hash: hash, label: label });
      /* v10b（走查 3.7）：超出上限不再静默丢弃 —— 明说发生了什么，
         否则用户回头找最早那个页签，只觉得“它自己没了”。 */
      if (list.length > 12) {
        var dropped = list[0].label;
        list = list.slice(list.length - 12);
        var S2 = SHELL();
        if (S2 && typeof S2.toast === 'function') S2.toast('页签已达 12 个上限，已移除最早的「' + dropped + '」', 'warn');
      }
    }
    /* 命中同一条：hash 跟着走（下次点它回到最后停留的页内页签）、文字跟着更新 */
    else { list[found].hash = hash; list[found].label = label; }
    safeSet(TABS_KEY, JSON.stringify(list));
    return list.map(function (t) {
      var on = t.hash === hash;
      /* v10b：关闭钮不再只给当前页签 —— 想关别的页签不该被迫先切过去 */
      return '<span class="v10-tabsbar-item' + (on ? ' on' : '') + '" data-v10-go="' + esc(t.hash) + '">' +
        esc(t.label) + ' <span class="x" data-v10-close="1" title="关闭" role="button" aria-label="关闭页签 ' + esc(t.label) + '">×</span></span>';
    }).join('');
  }
  function bindTabs() {
    if (!global.document || global.document.__v10TabsBound) return;
    global.document.__v10TabsBound = true;
    global.document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var closer = t.closest('[data-v10-close]');
      if (closer && closer.parentNode) {
        var item = closer.parentNode;
        var hh = item.getAttribute('data-v10-go');
        var list = tabsList().filter(function (x) { return x.hash !== hh; });
        safeSet(TABS_KEY, JSON.stringify(list));
        e.stopPropagation();
        if (global.location) global.location.hash = (list.length ? list[list.length - 1].hash : '#/overview');
        return;
      }
      var go = t.closest('[data-v10-go]');
      if (go && global.location) global.location.hash = go.getAttribute('data-v10-go');
    }, false);
  }

  /* ------------------------------------------------ 返回列表的委托（详情空态） */
  function bindBack() {
    if (!global.document || global.document.__v10BackBound) return;
    global.document.__v10BackBound = true;
    global.document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[data-v10-back]');
      if (!el) return;
      var f = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (f && f.navigate) f.navigate({ agentId: null, objId: null, tab: null, objTab: null, traceId: null });
    }, false);
  }

  global.V10UI = {
    detailTabs: detailTabs,
    pageCrumb: pageCrumb,
    emptyFor: emptyFor,
    detailMissing: detailMissing,
    dangerConfirm: dangerConfirm,
    checkPerm: checkPerm,
    diffViewer: diffViewer,
    permTag: permTag,
    audit: audit,
    auditList: auditList,
    refreshAuditBadge: refreshAuditBadge,
    auditDrawer: auditDrawer,
    auditList: auditList,
    notificationBell: notificationBell,
    asyncResult: asyncResult,
    asyncUnread: asyncUnread,
    tabsBar: tabsBar,
    objectNameOf: objectNameOf,
    tabLabelOf: function (capId, key) { return TAB_LABELS[capId + '|' + key] || ''; },
    openSheet: openSheet,
    closeSheet: closeSheet
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () { injectCss(); bindTabs(); bindBack(); refreshAuditBadge(); });
    } else { injectCss(); bindTabs(); bindBack(); refreshAuditBadge(); }
  }
})(window);
