/* ============================================================================
 * v26 · 企业知识库「桌面式」管理
 * ----------------------------------------------------------------------------
 * 走查意见：「我要的是布局跟桌面一样方便管理」。
 *   表格是"查数据"的形状；管文档要的是桌面的形状 ——
 *   图标 + 文件夹 + 双击打开 + 右键菜单 + 拖拽归类 + 框选多选 + 状态栏。
 *
 * 落点两处，同一套交互、同一份实现（不写两遍）：
 *   ① 知识库列表页「全部知识库」：每个库 = 一个文件夹图标；顶部可切回表格
 *   ② 知识库详情「文档」Tab：库内就是桌面 —— 根目录是按文档类型自动归类的文件夹，
 *      进文件夹看文档图标；用户新建的文件夹是会话态
 *
 * 三条与全站既有约定对齐的约束：
 *   · 会话态只挂 state.kbDesk（内存，刷新还原）—— 与 v17 批 A 的知识库会话态同款；
 *     资产表 data.js 是纯函数、加载时无 state，绝不往里写
 *   · 图标一律走 h.icon() 的内联 SVG（全站不用 emoji：跨平台字形不一致、不跟主题换色）
 *   · 交互由 app.js 的 bindContent 在**本次渲染之后**调 __kbDesk(root, h) 挂到新 DOM 上
 *     （与 v24 网状关系页的 __anetDrag / __anetMenu 同款，不在渲染层里绑事件）
 *
 * 诚实声明：库内文档清单是确定性派生的**示例数据**（12,840 篇不能真渲染 12,840 个图标），
 *   网格按每页 24 项分页；文件夹篇数、切片数、状态都来自同一份清单，不是另造一套数。
 * ========================================================================== */
(function (global) {
  'use strict';
  if (!global || !global.document) return;

  var ACTIONS = global.ACTIONS || (global.ACTIONS = {});
  /* 网格每页项数 = **4 行 × 当前列数**（列数自适应）。
     固定 24 项在不同宽度下会变成 3 行或 8 行 —— "一页看多少"该由**行数**说，
     列数交给 CSS 自适应。这里按容器宽度估算列数（与 .kb-items-doc 的 236px 对齐）；
     估算不必像素精确：差一列只是每页多/少 4 篇，不影响对齐。 */
  var DOC_ROWS = 4;
  function pageSizeFor() {
    var W = 0;
    try { var el = document.getElementById('content'); if (el) W = el.clientWidth; } catch (e) { W = 0; }
    if (!W) W = 1200;
    var inner = W - 48;                                   /* 卡片区左右内边距 */
    var cols = Math.max(2, Math.floor((inner + 12) / (236 + 12)));
    return cols * DOC_ROWS;
  }
  var PAGE = 24;              /* 兜底值（拿不到 DOM 时用） */
  var MENU_ID = 'kb-desk-menu';

  /* ========================================================== 会话状态 */
  /* 全部挂在 state.kbDesk 下，按 kbId 分键 —— 跨库不串数据是 v17 批 A 踩过的坑 */
  function S(h) {
    var st = h.state;
    if (!st.kbDesk) st.kbDesk = {};
    var d = st.kbDesk;
    if (!d.lib) d.lib = { layout: 'grid', sel: [] };
    if (!d.docs) d.docs = {};
    if (!d.folders) d.folders = {};
    if (!d.assign) d.assign = {};
    return d;
  }
  function libS(h) {
    var s = S(h).lib;
    if (!s.layout) s.layout = 'grid';
    if (!s.sel) s.sel = [];
    return s;
  }
  function docS(h, kbId) {
    var m = S(h).docs;
    if (!m[kbId]) m[kbId] = { layout: 'grid', folder: null, sel: [], page: 1, cur: null };
    var s = m[kbId];
    if (!s.layout) s.layout = 'grid';
    if (!s.sel) s.sel = [];
    if (!s.page) s.page = 1;
    return s;
  }
  function foldersS(h, kbId) {
    var m = S(h).folders;
    if (!m[kbId]) m[kbId] = [];
    return m[kbId];
  }
  function assignS(h, kbId) {
    var m = S(h).assign;
    if (!m[kbId]) m[kbId] = {};
    return m[kbId];
  }

  /* ========================================================== 数据访问 */
  /* 数据一律经 KB_SESSION（v10-detail-asset.js 的对外接口）——
     文档类型判定、文档清单、状态口径都只有一份实现，这里不再抄第二份 */
  function KB() { return global.KB_SESSION || {}; }
  function types() { return (KB().docTypes && KB().docTypes()) || []; }
  function docsOf(h, kbLike) { return (KB().docsOf ? KB().docsOf(h, kbLike) : []); }
  function typeOf(h, d) {
    var t = KB().docTypeOf ? KB().docTypeOf(h, d) : null;
    return t || { key: 'spec', label: '其他', icon: 'doc' };
  }
  function statusOf(h, d) {
    return (KB().docStatus ? KB().docStatus(h, d) : null) || { k: 'ok', t: '已索引' };
  }
  /* 文档 → 所在文件夹 key：用户手动归的优先，否则按类型自动归类 */
  function keyOf(h, kbId, d) {
    var a = assignS(h, kbId);
    return a[d.id] || typeOf(h, d).key;
  }
  function nameOfFolder(h, kbLike, key) {
    if (key === '__auto') return '自动归类';
    var f = foldersOf(h, kbLike).folders.filter(function (x) { return x.key === key; })[0];
    return f ? f.name : key;
  }
  /* 文件夹清单 + 在服务文档清单，一趟算完（大库 12,840 篇只走一次，不重复遍历） */
  function foldersOf(h, kbLike) {
    var id = kbLike.id, all = docsOf(h, kbLike);
    var counts = {}, latest = {}, onShelf = 0, offline = 0;
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      if (d.offline) { offline++; continue; }
      onShelf++;
      var k = keyOf(h, id, d);
      counts[k] = (counts[k] || 0) + 1;
      /* 分类的「最近更新」：取该分类下最新的一篇（updatedDay 越接近 0 越新）——
         副标题要写成 `N 篇 | X 天前`，得有这个数才算得出 */
      if (latest[k] == null || (d.updatedDay != null && d.updatedDay > latest[k])) latest[k] = d.updatedDay;
    }
    var out = [];
    types().forEach(function (t) {
      if (counts[t.key] > 0) out.push({ key: t.key, name: t.label, icon: t.icon, hue: t.hue, count: counts[t.key], updatedDay: latest[t.key], user: false });
    });
    foldersS(h, id).forEach(function (f) {
      /* 用户新建的空文件夹也要在（否则"建了看不见"），带 0 篇 */
      out.push({ key: f.id, name: f.name, icon: 'doc', hue: 'slate', count: counts[f.id] || 0, updatedDay: latest[f.id], user: true });
    });
    return { folders: out, counts: counts, total: onShelf, offline: offline };
  }
  function docsIn(h, kbLike, key) {
    var all = docsOf(h, kbLike), out = [];
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      if (d.offline) continue;
      if (keyOf(h, kbLike.id, d) === key) out.push(d);
    }
    return filterByName(h, out);
  }
  /* 按文档名搜。12,840 篇的库里"知道名字、不知道在哪个文件夹"是常态 ——
     没有搜索的桌面只能靠逐个文件夹点开找，那不叫方便管理。
     输入框走 app.js 的通用筛选委托（input[data-f]，回车生效），写进 state.filters.kbDocQ。 */
  function docQuery(h) {
    var f = h.state.filters || {};
    return String(f.kbDocQ == null ? '' : f.kbDocQ).trim();
  }
  function nameHit(name, q) {
    if (!q) return true;
    var n = String(name || '').replace(/[《》\s]/g, '').toLowerCase();
    return n.indexOf(q.replace(/\s/g, '').toLowerCase()) >= 0;
  }
  function filterByName(h, list) {
    var q = docQuery(h);
    if (!q) return list;
    return list.filter(function (d) { return nameHit(d.name, q); });
  }

  /* 零结果率告警线：全站唯一真源在 decisions.js。
     ⚠ 这里**不写新的魔法数** —— 列表页此前 0.045 / 0.05 / 0.03 三处两刻度就是这么来的。 */
  function zeroWarn() {
    var D = global.DECISIONS;
    return (D && D.value) ? D.value('知识库检索', '零结果率_告警', 0.05) : 0.05;
  }
  function kbVerdict(h, r) {
    if (h.state && h.state.kbDisabled && h.state.kbDisabled[r.id]) return { k: 'idle', t: '已停用' };
    if (r.status && r.status !== 'ok') return { k: r.status === 'bad' ? 'bad' : 'warn', t: r.statusText || '待同步' };
    if (r.zeroRate >= zeroWarn()) return { k: 'warn', t: '内容缺口' };
    if (r.zeroRate >= 0.03) return { k: 'ok', t: '注意' };
    return { k: 'ok', t: '健康' };
  }

  /* ========================================================== 片段工具 */
  function e(h, s) { return h.esc(s == null ? '' : String(s)); }
  function safe(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_\u4e00-\u9fa5\-:.]/g, ''); }
  function viewToggle(scope, cur) {
    return '<div class="view-sw kb-layout" role="group" aria-label="查看方式">' +
      '<button class="vs-btn' + (cur === 'grid' ? ' on' : '') + '" data-act="kb-desk-layout" data-id="' + safe(scope) + '|grid"' +
      ' aria-pressed="' + (cur === 'grid') + '" title="网格：像桌面一样管">网格</button>' +
      '<button class="vs-btn' + (cur === 'list' ? ' on' : '') + '" data-act="kb-desk-layout" data-id="' + safe(scope) + '|list"' +
      ' aria-pressed="' + (cur === 'list') + '" title="列表：按列排序、密集浏览">列表</button>' +
      '</div>' 
  }

  /* ========================================================== ① 知识库桌面 */
  function libHtml(h, rows) {
    var st = libS(h), sel = st.sel || [];
    /* 库卡片：颜色同样要**稳定** —— 人工指定的 hue 优先（库是长期认脸的容器），
       没指定的按库名哈希推一个。不顺延、不看旁边有什么。 */
    var _lm = {};
    rows.forEach(function (r) {
      if (r.hue) { _lm[r.id] = r.hue; return; }
      var hh = 0, s0 = String(r.name || r.id);
      for (var i0 = 0; i0 < s0.length; i0++) hh = (hh * 31 + s0.charCodeAt(i0)) % 997;
      _lm[r.id] = DOC_HUES[hh % DOC_HUES.length];
    });
    var totalDocs = 0, totalHits = 0;
    rows.forEach(function (r) { totalDocs += Number(r.docs) || 0; totalHits += Number(r.hits) || 0; });
    var items = rows.map(function (r) {
      var v = kbVerdict(h, r), on = sel.indexOf(r.id) >= 0;
      return '<div class="kb-item kb-fld' + (on ? ' on' : '') + '" role="button" tabindex="0"' +
        ' aria-pressed="' + on + '" data-kbi="kb|' + e(h, r.id) + '"' +
        ' aria-label="' + e(h, r.name) + '，' + h.fmt.int(r.docs) + ' 篇文档，' + e(h, v.t) + '，双击进入">' +
        /* 库也要有类型色相 —— 原来写死 kb-ico-kb（恒蓝），五个库在列表上一模一样，
           扫一屏分不清谁是谁；文档类型与文件夹早就按 h-{hue} 上色了，唯独库这一层没有。 */
        '<span class="kb-ico h-' + (r.hue || _lm[r.id] || 'slate') + '">' + h.icon('doc', 34) + '</span>' +
        '<span class="kb-nm" title="' + e(h, r.name) + '">' + e(h, r.name) + '</span>' +
        '<span class="kb-mt">' + h.fmt.int(r.docs) + ' 篇 · ' + h.fmt.int(r.chunks) + ' 向量</span>' +
        '<span class="kb-mt">周命中 ' + h.fmt.int(r.hits) + ' · ' + h.fmt.rel(r.lastSyncText) + '同步</span>' +
        '</div>';
    }).join('');
    return '<div class="kb-desk" data-kbdesk="lib">' +
      '<div class="kb-canvas" data-kbdesk-canvas>' +
      '<div class="kb-items kb-items-fld">' + items + '</div>' +
      '<div class="kb-marquee hidden" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="kb-status" data-kbdesk-status>' +
      '<span>共 <b>' + rows.length + '</b> 个知识库</span>' +
      '<span>文档合计 <b>' + h.fmt.int(totalDocs) + '</b> 篇</span>' +
      '<span>周命中 <b>' + h.fmt.int(totalHits) + '</b></span>' +
      (sel.length ? '<span class="kb-st-sel">已选中 <b>' + sel.length + '</b> 项</span>' : '') +
      '<span class="kb-st-hint">单击选中 · 双击进入 · 右键更多 · 空白处框选</span>' +
      '</div></div>';
  }

  /* ========================================================== ② 库内桌面 */
  /* 文档图标取色：**按「方案」取，不按文档类型**。
     同一份文档的不同版本（《退货政策 v1 / v2 / v3》）必须同色 —— 它们是一个方案的迭代；
     不同方案必须不同色 —— 否则一屏 24 张卡全一个颜色，扫不出"有哪几份东西"。
     所以色键是**去掉版本号的基名**，不是 type。 */
  var DOC_HUES = ['blue', 'purple', 'teal', 'slate', 'amber', 'green', 'rose', 'indigo', 'cyan'];
  /* 取色**只由方案名决定**（KB_SESSION.planHue：按方案在名册里的固定序号）。
     不做同屏去重 —— 去重会让同一份方案因为"旁边放了什么"而变色，那就不是认方案了
     （走查：颜色应该稳定）。 */
  function planHueOf(h, d) {
    /* 优先级：**用户自定义 > 名册序号 > 哈希**。
       自定义按「方案」存 —— 改一次，这份方案的所有版本一起变。 */
    var store = planHueStore(h);
    var base = String((d && d.name) || '').replace(/[》\s]*v\d+[》\s]*$/, '').replace(/[《》]/g, '');
    if (store[base]) return store[base];
    var KB = global.KB_SESSION;
    return (KB && KB.planHue) ? KB.planHue(d && d.name) : 'slate';
  }
  function planKey(d) {
    return String((d && d.name) || '').replace(/[》\s]*v\d+[》\s]*$/, '').replace(/[《》]/g, '');
  }
  function planHue(d) {
    var n = planKey(d), hash = 0;
    for (var i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) % 997;
    return DOC_HUES[hash % DOC_HUES.length];
  }

  /* 文档图标：文件夹内与搜索结果共用同一份 —— 两处各写一遍必然走形（一处有状态点、一处没有） */
  /* 实心浅蓝文件夹：参考产品的左栏用的是彩色实心图标，不是线性 outline。
     两段式（后片 #7db8f0 / 前片 #a9d1f7），16px 下也能看出是文件夹而不是方块。 */
  function folderIco(size) {
    var w = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" aria-hidden="true">' +
      '<path d="M3 6.6A2.6 2.6 0 0 1 5.6 4h3.1c.7 0 1.3.26 1.8.72L11.7 6h6.7A2.6 2.6 0 0 1 21 8.6v2.2H3V6.6z" fill="#7db8f0"/>' +
      '<path d="M3 9.4h18v8A2.6 2.6 0 0 1 18.4 20H5.6A2.6 2.6 0 0 1 3 17.4v-8z" fill="#a9d1f7"/>' +
      '</svg>';
  }

  /* 列表视图 = 文件管理器：左栏两级树（库 → 分类）/ 中栏带表头的清单 / 右栏预览 + 详细信息。
     照 Windows 资源管理器的分区做，但数据全部来自这一屏已有的 slice，不另造字段。 */
  function colView(h, kbLike, fx, cur, slice, st) {
    var pick = null, i;
    if (st.cur) { for (i = 0; i < slice.length; i++) if (slice[i].id === st.cur) pick = slice[i]; }
    if (!pick) pick = slice[0];
    var open = st.tree !== 0;

    /* —— 左栏：库是根，分类挂在下面。根上那个三角是真的能收 —— 不是装饰。 */
    var c1 = '<button class="kb-tree-row kb-tree-root" data-act="kb-desk-tree" data-id="' + e(h, kbLike.id) + '"' +
      ' aria-expanded="' + open + '">' +
      '<span class="kb-tw" aria-hidden="true">' + (open ? '\u25be' : '\u25b8') + '</span>' +
      folderIco(16) +
      '<span class="kb-tree-nm">' + e(h, kbLike.name) + '</span>' +
      '<b>' + h.fmt.int(fx.total) + '</b>' +
      '<span class="kb-cv" aria-hidden="true">›</span></button>';
    if (open) {
      c1 += '<div class="kb-tree-kids">' +
        '<button class="kb-col-row' + (cur === '__all' ? ' on' : '') + '"' +
        ' data-act="kb-desk-cat" data-id="' + e(h, kbLike.id) + '|__all">' +
        folderIco(16) + '<span>全部文档</span><b>' + h.fmt.int(fx.total) + '</b>' +
        '<span class="kb-cv" aria-hidden="true">›</span></button>';
      fx.folders.forEach(function (f) {
        c1 += '<button class="kb-col-row' + (cur === f.key ? ' on' : '') + '"' +
          ' data-act="kb-desk-cat" data-id="' + e(h, kbLike.id) + '|' + e(h, f.key) + '"' +
          ' data-drop="' + e(h, f.key) + '" title="' + e(h, f.name) + ' · ' + f.count + ' 篇">' +
          folderIco(16) +
          '<span>' + e(h, f.name) + '</span><b>' + h.fmt.int(f.count) + '</b>' +
          '<span class="kb-cv" aria-hidden="true">›</span></button>';
      });
      c1 += '</div>';
    }

    /* —— 中栏：表头 + 行。表头与行用同一套 grid 列宽，否则永远对不齐。 */
    var c2 = '<div class="kb-col-h"><span></span><span>名称</span>' +
      '<span class="kb-ch-r">修改时间</span><span class="kb-ch-r">大小</span><span></span></div>' +
      slice.map(function (d) {
        var t = typeOf(h, d), s2 = statusOf(h, d), on = pick && d.id === pick.id;
        return '<button class="kb-col-doc' + (on ? ' on' : '') + '"' +
          ' data-act="kb-desk-pick" data-id="' + e(h, kbLike.id) + '|' + e(h, d.id) + '"' +
          ' aria-pressed="' + on + '" title="' + e(h, d.name) + '">' +
          '<span class="kb-tico ico-i' + (t.hue ? ' t-' + t.hue : '') + '">' + h.icon(t.icon, 15) + '</span>' +
          '<span class="kb-col-nm">' + e(h, d.name) + '</span>' +
          '<span class="kb-ch-r">' + e(h, h.fmt.rel(d.updatedDay)) + '</span>' +
          '<span class="kb-ch-r">' + e(h, Math.round(d.sizeKB) + ' KB') + '</span>' +
          '<i class="kb-col-dot ' + e(h, s2.k) + '" title="' + e(h, s2.t) + '"></i>' +
          '</button>';
      }).join('');

    /* —— 右栏：大预览页 + 标题 + 元数据（照资源管理器/网盘的详情区） */
    var d3 = pick, t3 = typeOf(h, d3), s3 = statusOf(h, d3);
    var demo = global.KB_SLICE_DEMO || [];
    var totalS = Math.max(1, Number(d3.slices) || 1);
    var key = String(d3.id || d3.name), hash = 0;
    for (i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 997;
    var lines = '';
    if (demo.length) {
      for (i = 0; i < 2; i++) lines += '<p>' + e(h, demo[(hash + i * 2) % demo.length]) + '</p>';
    }
    var c3 = '<div class="kb-pv">' +
        '<div class="kb-pv-page">' +
          lines +
          '<span class="kb-pv-pg">第 1 / ' + h.fmt.int(totalS) + ' 片</span>' +
        '</div>' +
      '</div>' +
      '<div class="kb-pv-body">' +
        '<div class="kb-pv-nm"><span class="kb-tico ico-i' + (t3.hue ? ' t-' + t3.hue : '') + '">' +
          h.icon(t3.icon, 16) + '</span>' + e(h, d3.name) + '</div>' +
        '<div class="kb-pv-sub">' + e(h, t3.label) + ' · ' + e(h, d3.source) + '</div>' +
        '<dl class="kb-pv-dl">' +
        '<dt>文件大小</dt><dd>' + e(h, Math.round(d3.sizeKB)) + ' KB</dd>' +
        '<dt>切片</dt><dd>' + h.fmt.int(d3.slices) + ' 片</dd>' +
        '<dt>索引状态</dt><dd>' + h.pill(s3.k, s3.t) + '</dd>' +
        '<dt>更新时间</dt><dd>' + e(h, h.fmt.rel(d3.updatedDay)) + '</dd>' +
        '<dt>有效期</dt><dd>' + e(h, d3.validUntil) + '</dd>' +
        '<dt>责任人</dt><dd>' + h.avatar(d3.owner) + '</dd>' +
        '</dl>' +
        '<div class="kb-pv-note">预览正文为确定性派生演示内容，与「检索测试」同一套语料；生产环境这里是真实文档页。</div>' +
        '<div class="kb-col-3act">' +
          '<button class="btn-ghost sm" data-act="kb-doc-open" data-id="' + e(h, kbLike.id) + '|' + e(h, d3.id) + '">打开</button>' +
          '<button class="btn-ghost sm" data-act="kb-doc-offline" data-id="' + e(h, kbLike.id) + '|' + e(h, d3.id) + '">下线</button>' +
        '</div>' +
      '</div>';

    return '<div class="kb-cols">' +
      '<div class="kb-col kb-col-1">' + c1 + '</div>' +
      '<div class="kb-col kb-col-2">' + c2 + '</div>' +
      '<div class="kb-col kb-col-3">' + c3 + '</div>' +
      '</div>' 
  }

  function docTileHtml(h, kbLike, d, on, showFolder, hue) {
    var t = typeOf(h, d), s = statusOf(h, d);
    var meta = showFolder
      ? e(h, nameOfFolder(h, kbLike, keyOf(h, kbLike.id, d))) + ' · ' + h.fmt.int(d.slices) + ' 切片'
      : h.fmt.int(d.slices) + ' 切片 · ' + e(h, h.fmt.rel(d.updatedDay));
    return '<div class="kb-item kb-doc' + (on ? ' on' : '') + '" role="button" tabindex="0" draggable="true"' +
      ' aria-pressed="' + on + '" data-kbi="doc|' + e(h, kbLike.id) + '|' + e(h, d.id) + '"' +
      ' aria-label="' + e(h, d.name) + '，' + e(h, t.label) + '，' + h.fmt.int(d.slices) + ' 个切片，' + e(h, s.t) + '，双击打开">' +
      /* 色相由调用方按「方案」给（见 planHueMap）—— 同方案的不同版本同色，不同方案不同色。
         文档**类型**仍在 aria-label 与详情弹层里说明，卡片颜色不再兼任"类型"的职责。 */
      '<span class="kb-ico' + (hue ? ' h-' + hue : (t.hue ? ' h-' + t.hue : '')) + '">' + h.icon(t.icon, 34) +
      (s.k === 'ok' ? '' : '<i class="kb-dot ' + e(h, s.k) + '" title="' + e(h, s.t) + '"></i>') + '</span>' +
      '<span class="kb-nm" title="' + e(h, d.name) + '">' + e(h, d.name) + '</span>' +
      '<span class="kb-mt">' + meta + '</span>' +
      /* 2026-10-21 业主：「删除这个」—— 卡片上的「版本 N」小按钮去掉。
         版本不是文档卡要回答的问题：一张卡只答"这是什么、多大、什么时候更新"，
         底下再挂个版本号会把四列网格的底边撑得不齐。
         要看历史版本仍可从文档详情弹层进（kb-versions 动作与其抽屉都还在，只是卡片上不再挂入口）。 */
      '</div>' 
  }

  function docsDeskHtml(h, kbLike) {
    var st = docS(h, kbLike.id);
    var fx = foldersOf(h, kbLike);
    var root = !st.folder;
    var sel = st.sel || [];
    var q = docQuery(h);
    var search = root && !!q;         /* 根目录 + 有关键词 = 全库按名搜索 */
    var head = barHtml(h, kbLike, fx, root, st, search);
    var canvas = '', status = '';

    /* ============ 一屏两层：分类在上、文档在下 ============
       原来点开库先看到**分类网格**、双击分类才进**文档** —— 两层嵌套，
       看一篇文档要"进分类 → 找到 → 返回"。而分类本质是**筛选维度**，不是层级。
       现在：分类做成**横向筛选条**（点一下换下面的文档），文档直接显示在下面。
       默认「全部」，所以"点开知识库就是文档"。 */
    var cur = st.folder || '__all';
    var isList = st.layout === 'list';   /* 必须早于 PAGE_ 的计算（var 提升会把它变成 undefined） */
    var list = search
      ? filterByName(h, docsOf(h, kbLike).filter(function (d) { return !d.offline; }))
      : (cur === '__all'
        ? docsOf(h, kbLike).filter(function (d) { return !d.offline; })
        : docsIn(h, kbLike, cur));
    var PAGE_ = isList ? PAGE : (st.pageSize || pageSizeFor());   /* 网格：4 行 × 实测列数；列表：固定页长 */
    var pages = Math.max(1, Math.ceil(list.length / PAGE_));
    var page = Math.min(Math.max(1, st.page), pages);
    st.page = page;
    var slice = list.slice((page - 1) * PAGE_, page * PAGE_);
    var tiles2 = slice.map(function (d) {
      return docTileHtml(h, kbLike, d, sel.indexOf(d.id) >= 0, search, planHueOf(h, d));
    }).join('');

    /* 分类筛选条：第一个「全部」，后面按篇数排序。
       （2026-10-21 曾按业主一句「把这个删了」撤掉过，当天又「撤回」——已恢复。） */
    var chips = '<button class="kb-cat' + (cur === '__all' ? ' on' : '') + '"' +
      ' data-act="kb-desk-cat" data-id="' + e(h, kbLike.id) + '|__all"' +
      ' aria-pressed="' + (cur === '__all') + '">全部<span>' + h.fmt.int(fx.total) + '</span></button>' +
      fx.folders.map(function (f) {
        var on = cur === f.key;
        return '<button class="kb-cat' + (on ? ' on' : '') + (f.user ? ' kb-cat-new' : '') + '"' +
          ' data-act="kb-desk-cat" data-id="' + e(h, kbLike.id) + '|' + e(h, f.key) + '"' +
          ' data-drop="' + e(h, f.key) + '" aria-pressed="' + on + '"' +
          ' title="' + e(h, f.name) + ' · ' + f.count + ' 篇">' +
          (f.hue ? '<i class="kb-cat-dot h-' + f.hue + '"></i>' : '') +
          e(h, f.name) + '<span>' + h.fmt.int(f.count) + '</span></button>';
      }).join('');
    var catRow = '<div class="kb-cats" role="group" aria-label="按分类筛选">' + chips + '</div>';

    var empty = search
      ? h.emptyFor('没有名字匹配「' + q + '」的文档',
        '换个关键词，或清空搜索框（已下线 ' + h.fmt.int(fx.offline) + ' 篇不在搜索范围）', 'doc')
      : h.emptyFor('这个分类是空的', '把文档拖到上面的分类，或右键任意文档「移动到…」', 'doc');

    /* 列表与网格**共用同一套外壳**（同一个工具条、同一条分类筛选、同一个状态栏），
       只有内容区不同 —— 网格是瓦片、列表是表格。
       原来 list 走的是另一套组件（自带「文档」标题卡 + 自己的状态筛选条），
       切视图像换了一屏 —— 这就是"割裂"。现在以网格为主，列表只是它的另一种呈现。 */
    /* 列表视图里分类已经在左栏了，上面那条分类 chip 再去放一遍就是两套入口 */
    canvas = (isList ? '' : catRow) +
      (isList
        ? (slice.length ? colView(h, kbLike, fx, cur, slice, st) : empty)
        : (slice.length ? '<div class="kb-items kb-items-doc">' + tiles2 + '</div>' : empty)) +
      (pages > 1 ? pagerHtml(h, kbLike.id, page, pages, list.length) : '');

    status = (search ? '<span>搜索「<b>' + e(h, q) + '</b>」命中 <b>' + h.fmt.int(list.length) + '</b> 篇</span>'
      : (cur === '__all' ? '<span>全部 <b>' + h.fmt.int(list.length) + '</b> 篇</span>'
        : '<span>分类「<b>' + e(h, nameOfFolder(h, kbLike, cur)) + '</b>」 <b>' + h.fmt.int(list.length) + '</b> 篇</span>')) +
      '<span>第 <b>' + page + '</b> / ' + pages + ' 页</span>' +
      (sel.length ? '<span class="kb-st-sel">已选中 <b>' + sel.length + '</b> 项</span>' : '') +
      (fx.offline ? '<span>已下线 <b>' + h.fmt.int(fx.offline) + '</b> 篇（不计入在服务）</span>' : '') +
      '<span class="kb-st-hint">单击选中 · Ctrl 多选 · 双击打开 · 拖到分类归类 · 搜索框可按名跨分类找</span>';

    return '<div class="kb-desk" data-kbdesk="docs" data-kb="' + e(h, kbLike.id) + '">' +
      head +
      '<div class="kb-canvas" data-kbdesk-canvas>' + canvas +
      '<div class="kb-marquee hidden" aria-hidden="true"></div>' +
      '</div>' +
      batchSlotHtml(h, kbLike, fx, root ? [] : sel) +
      '<div class="kb-status" data-kbdesk-status>' + status + '</div>' +
      '</div>' +
      verDrawerHtml(h, kbLike);
  }

  /* 工具条：面包屑 + 搜索 + 查看方式 + 主要动作（Explorer 的形状） */
  function barHtml(h, kbLike, fx, root, st, search) {
    var f = root ? null : fx.folders.filter(function (x) { return x.key === st.folder; })[0];
    var q = docQuery(h);
    var crumb;
    if (search) {
      crumb = '<span class="kb-crumb-cur" aria-current="page">' + e(h, kbLike.name) + '</span>' +
        '<span class="kb-crumb-sep" aria-hidden="true">›</span>' +
        '<span class="kb-crumb-cur">搜索「' + e(h, q) + '」</span>';
    } else if (root) {
      crumb = '<span class="kb-crumb-cur" aria-current="page">' + e(h, kbLike.name) + '</span>';
    } else {
      crumb = '<button class="kb-crumb-lnk" data-act="kb-desk-root" data-id="' + e(h, kbLike.id) + '"' +
        ' data-drop="__auto" title="回到根目录；把文档拖到这里 = 交回自动归类">' + e(h, kbLike.name) + '</button>' +
        '<span class="kb-crumb-sep" aria-hidden="true">›</span>' +
        '<span class="kb-crumb-cur" aria-current="page">' + e(h, f ? f.name : '—') + '</span>';
    }
    return '<div class="kb-bar">' +
      ((root && !search) ? '' : '<button class="kb-back" data-act="kb-desk-root" data-id="' + e(h, kbLike.id) + '" aria-label="返回根目录">← 返回</button>') +
      '<nav class="kb-crumb" aria-label="当前位置">' + crumb + '</nav>' +
      /* 搜索框走 app.js 的通用筛选委托（input[data-f]，回车生效）——
         不在渲染层自己绑键盘，与全站筛选行为一致。
         ⚠ 用 span 不用 label：.filter-row label 是全站纵向排布的筛选格，
           套上去会把图标和输入框叠成两行（列表视图里就长歪了） */
      '<span class="kb-search">' + h.icon('search', 14) +
      '<input data-f="kbDocQ" value="' + e(h, q) + '" placeholder="按文档名搜，回车" aria-label="按文档名搜索"></span>' +
      '<span class="grow"></span>' +
      '<button class="btn-ghost sm" data-act="kb-desk-selall" data-id="' + e(h, kbLike.id) + '">全选</button>' +
      '<button class="btn-ghost sm" data-act="kb-desk-newfolder" data-id="' + e(h, kbLike.id) + '">新建分类</button>' +
      '<button class="btn-primary sm" data-act="kb-doc-upload" data-id="' + e(h, kbLike.id) + '">上传文档</button>' +
      /* 视图切换钉在最右端：它是"看的方式"，不是动作，和左边那排动作分开 */
      viewToggle(kbLike.id, st.layout) +
      '</div>' 
  }
  function pagerHtml(h, kbId, page, pages, total) {
    return '<div class="kb-pager">' +
      '<button class="btn-ghost sm" data-act="kb-desk-page" data-id="' + e(h, kbId) + '|' + (page - 1) + '"' +
      (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<span>第 ' + page + ' / ' + pages + ' 页 · 共 ' + h.fmt.int(total) + ' 篇</span>' +
      '<button class="btn-ghost sm" data-act="kb-desk-page" data-id="' + e(h, kbId) + '|' + (page + 1) + '"' +
      (page >= pages ? ' disabled' : '') + '>下一页</button>' +
      '</div>' 
  }
  /* 批量条 + 拖动落点条：桌面靠"把文件拖到文件夹上"，而网页里文件夹常不在同一屏 →
     这一排既是拖拽落点（data-drop），也是"选中后一键移动"的入口 */
  function batchSlotHtml(h, kbLike, fx, sel) {
    var chips = fx.folders.map(function (f) {
      return '<button class="kb-chip" data-act="kb-desk-move-pick" data-id="' + e(h, kbLike.id) + '|' + e(h, f.key) + '"' +
        ' data-drop="' + e(h, f.key) + '" title="把选中的文档移到这里（也可以直接把文档拖上来）">' +
        h.icon(f.icon || 'folder', 13) + e(h, f.name) + '</button>';
    }).join('');
    var drops = '<div class="kb-drops">' +
      '<span class="kb-drops-k">' + (sel.length ? '移动选中 →' : '拖动文档到分类') + '</span>' +
      '<div class="kb-chips">' + chips +
      '<button class="kb-chip kb-chip-auto" data-act="kb-desk-move-pick" data-id="' + e(h, kbLike.id) + '|__auto"' +
      ' data-drop="__auto" title="交回按文档类型自动归类">' + h.icon('checklist', 13) + '自动归类</button>' +
      '</div></div>';
    var batch = sel.length
      ? '<div class="kb-batch" role="group" aria-label="批量操作">' +
        '<span class="kb-batch-n">已选 <b>' + sel.length + '</b> 项</span>' +
        '<button class="btn-ghost sm" data-act="kb-desk-move-to" data-id="' + e(h, kbLike.id) + '">移动到…</button>' +
        '<button class="btn-ghost sm" data-act="kb-desk-batch" data-id="' + e(h, kbLike.id) + '|offline">批量下线</button>' +
        '<button class="btn-ghost danger sm" data-act="kb-desk-batch" data-id="' + e(h, kbLike.id) + '|delete">批量删除</button>' +
        '<button class="btn-ghost sm" data-act="kb-desk-clearsel" data-id="' + e(h, kbLike.id) + '">取消选择</button>' +
        '</div>'
      : '';
    return '<div class="kb-batchslot">' + batch + drops + '</div>';
  }

  /* ========================================================== 选择 */
  function deskItems(desk) {
    return Array.prototype.slice.call(desk.querySelectorAll('[data-kbi]'));
  }
  /* 知识库桌面当前渲染出的所有库 id（"全选"用） */
  function libIdsInDom() {
    var desk = document.querySelector('.kb-desk[data-kbdesk="lib"]');
    if (!desk) return [];
    return deskItems(desk).map(function (el) {
      var p = String(el.getAttribute('data-kbi') || '').split('|');
      return p[1];
    }).filter(Boolean);
  }
  function itemSelId(el) {
    var p = String(el.getAttribute('data-kbi') || '').split('|');
    if (p[0] === 'kb') return p[1];
    if (p[0] === 'folder') return 'F:' + p[1];
    if (p[0] === 'doc') return p[2];
    return '';
  }
  function deskSelS(h, desk) {
    return desk.getAttribute('data-kbdesk') === 'lib' ? libS(h) : docS(h, desk.getAttribute('data-kb'));
  }
  function paintSel(desk, ids) {
    deskItems(desk).forEach(function (el) {
      var on = ids.indexOf(itemSelId(el)) >= 0;
      if (on) el.classList.add('on'); else el.classList.remove('on');
      el.setAttribute('aria-pressed', String(on));
    });
  }
  function statusSelHtml(n) { return '<span class="kb-st-sel">已选中 <b>' + n + '</b> 项</span>'; }
  function refreshLibStatus(h, desk) {
    var box = desk.querySelector('[data-kbdesk-status]');
    if (!box) return;
    var n = (libS(h).sel || []).length;
    var old = box.querySelector('.kb-st-sel');
    if (old) old.remove();
    if (!n) return;
    var sp = document.createElement('span');
    sp.className = 'kb-st-sel';
    sp.innerHTML = '已选中 <b>' + n + '</b> 项';
    var hint = box.querySelector('.kb-st-hint');
    box.insertBefore(sp, hint || null);
  }
  /* 选择落定。
     · 知识库桌面：就地更新类与状态栏（无批量动作，不值得重渲染整页）
     · 文档桌面：批量条要跟着选中集出现/消失 —— 直接重渲染一次，
       与全站"每个动作都 navigate"的做法一致，不在渲染层与 DOM 之间维护两份真相 */
  function applySel(h, desk, ids) {
    var st = deskSelS(h, desk);
    st.sel = ids.slice();
    if (desk.getAttribute('data-kbdesk') === 'lib') { paintSel(desk, ids); refreshLibStatus(h, desk); return; }
    h.navigate({}, { scroll: false });
  }
  /* 框选过程中只改 DOM 类：一次拖动可能命中几十项，每一步都重渲染会掉帧 */
  function paintSelQuiet(desk, ids) {
    paintSel(desk, ids);
    desk.__kbPending = ids.slice();
  }

  /* ========================================================== 右键菜单 */
  var menuBound = null;
  function closeMenu() {
    var m = document.getElementById(MENU_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
    if (menuBound) {
      document.removeEventListener('mousedown', menuBound.down, true);
      document.removeEventListener('keydown', menuBound.key, true);
      window.removeEventListener('scroll', menuBound.scroll, true);
      menuBound = null;
    }
  }
  function openMenu(h, ev, items) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'kb-menu';
    m.id = MENU_ID;
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="kb-mi-sep" role="separator"></div>';
      return '<button class="kb-mi' + (it.tone ? ' ' + it.tone : '') + '" role="menuitem" data-mi="' + i + '"' +
        (it.dis ? ' disabled' : '') + '>' +
        (it.icon ? '<span class="kb-mi-i">' + h.icon(it.icon, 14) + '</span>' : '') +
        '<span class="kb-mi-t">' + e(h, it.t) + '</span>' +
        (it.k ? '<span class="kb-mi-k">' + e(h, it.k) + '</span>' : '') + '</button>';
    }).join('');
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    var vw = global.innerWidth || 1200, vh = global.innerHeight || 800;
    m.style.left = Math.max(8, Math.min(ev.clientX, vw - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(ev.clientY, vh - r.height - 8)) + 'px';
    m.addEventListener('click', function (ev2) {
      var t = ev2.target;
      var b = (t && t.closest) ? t.closest('[data-mi]') : null;
      if (!b) return;
      ev2.stopPropagation();
      var it = items[Number(b.getAttribute('data-mi'))];
      closeMenu();
      if (it && !it.dis && typeof it.fn === 'function') it.fn();
    });
    var bound = {
      down: function (ev2) { if (!m.contains(ev2.target)) closeMenu(); },
      key: function (ev2) { if (ev2.key === 'Escape') closeMenu(); },
      scroll: function () { closeMenu(); }
    };
    menuBound = bound;
    setTimeout(function () {
      if (menuBound !== bound) return;
      document.addEventListener('mousedown', bound.down, true);
      document.addEventListener('keydown', bound.key, true);
      window.addEventListener('scroll', bound.scroll, true);
    }, 0);
  }

  function kbMenu(h, id) {
    var off = h.state.kbDisabled && h.state.kbDisabled[id];
    return [
      { t: '打开', k: 'Enter', icon: 'folder', fn: function () { openKb(h, id); } },
      { t: '检索测试', icon: 'search', fn: function () { run(h, 'kb-open-test', id); } },
      { sep: true },
      off
        ? { t: '恢复知识库', icon: 'shield', fn: function () { run(h, 'kb-restore', id); } }
        : { t: '停用知识库', icon: 'shield', fn: function () { run(h, 'kb-disable', id); } },
      { t: '复制链接', icon: 'label', fn: function () { copyLink(h, kbHref(h, id)); } }
    ];
  }
  function folderMenu(h, kbLike, f) {
    var items = [{ t: '打开', k: 'Enter', icon: f.icon || 'folder', fn: function () { openFolder(h, kbLike.id, f.key); } }];
    if (f.user) {
      items.push({ sep: true });
      items.push({ t: '重命名', icon: 'form', fn: function () { run(h, 'kb-desk-rename-folder', kbLike.id + '|' + f.key); } });
      items.push({ t: '删除分类', tone: 'danger', fn: function () { run(h, 'kb-desk-rm-folder', kbLike.id + '|' + f.key); } });
    }
    items.push({ sep: true });
    items.push({ t: '查看方式：列表', icon: 'list', fn: function () { run(h, 'kb-desk-layout', kbLike.id + '|list'); } });
    return items;
  }
  function docMenu(h, kbLike, d) {
    var a = assignS(h, kbLike.id);
    var items = [
      { t: '打开', k: 'Enter', icon: 'doc', fn: function () { run(h, 'kb-doc-open', kbLike.id + '|' + d.id); } },
      { t: '移动到…', icon: 'folder', fn: function () { moveSheet(h, kbLike, [d.id]); } }
    ];
    if (a[d.id]) items.push({ t: '恢复自动归类', icon: 'checklist', fn: function () { applyMove(h, kbLike, [d.id], '__auto'); } });
    items.push({ sep: true });
    items.push({ t: '下线', icon: 'shield', fn: function () { run(h, 'kb-doc-offline', kbLike.id + '|' + d.id); } });
    items.push({ t: '删除', tone: 'danger', fn: function () { run(h, 'kb-doc-delete', kbLike.id + '|' + d.id); } });
    return items;
  }
  function blankMenu(h, desk, kbLike) {
    var kind = desk.getAttribute('data-kbdesk');
    var scope = kind === 'lib' ? 'lib' : kbLike.id;
    var items = [
      { t: '查看方式：网格', icon: 'grid', fn: function () { run(h, 'kb-desk-layout', scope + '|grid'); } },
      { t: '查看方式：列表', icon: 'list', fn: function () { run(h, 'kb-desk-layout', scope + '|list'); } },
      { sep: true },
      { t: '全选', icon: 'checklist', fn: function () { run(h, 'kb-desk-selall', scope); } },
      { t: '刷新', icon: 'play', fn: function () { h.navigate({}, { scroll: false }); } },
      { sep: true }
    ];
    if (kind === 'lib') items.push({ t: '新建知识库', icon: 'folder', fn: function () { run(h, 'create-open', 'knowledge'); } });
    else {
      items.push({ t: '上传文档', icon: 'doc', fn: function () { run(h, 'kb-doc-upload', kbLike.id); } });
      items.push({ t: '新建分类', icon: 'folder', fn: function () { run(h, 'kb-desk-newfolder', kbLike.id); } });
    }
    return items;
  }

  /* ========================================================== 动作调用 */
  /* 走 global.ACTIONS 而不是自己重写一遍 —— 权限门禁、确认层、审计都在那些实现里 */
  function run(h, act, id) {
    var A = global.ACTIONS || {};
    if (A[act]) { A[act](id, null, h); return true; }
    if (global.console) console.warn('[kb-desk] 未注册的动作：' + act);
    return false;
  }
  function openKb(h, id) { run(h, 'go-detail', 'knowledge|' + id); }
  function openFolder(h, kbId, key) {
    var st = docS(h, kbId);
    st.folder = key; st.page = 1; st.sel = [];
    h.navigate({}, { scroll: false });
  }
  function kbHref(h, id) {
    var c = (h.capById ? h.capById('knowledge') : null) || {};
    return '#/' + (c.domain || 'insight') + '/' + (c.id || 'knowledge') + '/' + id;
  }
  function copyLink(h, text) {
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(text);
        h.toast('链接已复制：' + text, 'ok');
        return;
      }
    } catch (err) { /* 剪贴板被拒（非 https / 无权限）→ 退化为展示 */ }
    h.toast('本页链接：' + text, 'info');
  }
  function applyMove(h, kbLike, ids, key) {
    var a = assignS(h, kbLike.id);
    ids.forEach(function (id) { if (key === '__auto') delete a[id]; else a[id] = key; });
    var nm = nameOfFolder(h, kbLike, key);
    h.toast('已把 ' + ids.length + ' 篇移到「' + nm + '」', 'ok');
    docS(h, kbLike.id).sel = [];
    h.navigate({}, { scroll: false });
  }
  /* 移动目标选择层（右键 / 批量条用；拖拽走 data-drop，不开层） */
  function moveSheet(h, kbLike, ids) {
    var fx = foldersOf(h, kbLike);
    var opts = fx.folders.map(function (f) {
      return '<option value="' + e(h, f.key) + '">' + e(h, f.name) + '（' + f.count + ' 篇）</option>';
    }).join('');
    global.V10UI.openSheet({
      title: '移动 ' + ids.length + ' 篇文档',
      bodyHtml: '<div class="v10-sheet-desc">移动只改变文档在库内的归类，<b>检索范围不变</b>（仍在同一个库里、仍可被检索）。</div>' +
        '<label class="sub-h" style="display:block;margin-top:10px">目标分类</label>' +
        '<select id="kb-mv-folder" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px">' +
        opts + '<option value="__auto">自动归类（按文档类型）</option></select>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-act="kb-desk-move-ok" data-id="' + e(h, kbLike.id) + '|' + ids.join(',') + '">移动</button>'
    });
  }

  /* ========================================================== 注册动作 */
  ACTIONS['kb-desk-layout'] = function (id, btn, h) {
    var p = String(id || '').split('|'), scope = p[0], lay = p[1] === 'list' ? 'list' : 'grid';
    if (scope === 'lib') libS(h).layout = lay; else docS(h, scope).layout = lay;
    h.navigate({}, { scroll: false });
  };
  /* 左栏树根的展开 / 收起：只影响这一屏的左栏，不进 URL */
  ACTIONS['kb-desk-tree'] = function (id, btn, h) {
    var st = docS(h, id);
    st.tree = st.tree === 0 ? 1 : 0;
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-pick'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    docS(h, p[0]).cur = p[1];
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-root'] = function (id, btn, h) {
    var st = docS(h, id);
    st.folder = null; st.page = 1; st.sel = [];
    /* 顺带清掉搜索词：从文件夹点「返回」的预期是"回到文件夹层"，
       若此时搜索词还挂着，回去看到的是搜索结果而不是文件夹 —— 与按下的按钮不是一回事 */
    if (h.state.filters && h.state.filters.kbDocQ) delete h.state.filters.kbDocQ;
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-page'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    docS(h, p[0]).page = Math.max(1, Number(p[1]) || 1);
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-selall'] = function (id, btn, h) {
    if (id === 'lib') {
      /* 从**当前渲染出来的项**取，而不是资产表 —— 会话新建并已发布的库不在资产表里，
         从表里取会让"全选"漏掉屏幕上明明看得见的那几个。屏幕上有什么就选什么。 */
      libS(h).sel = libIdsInDom();
      h.navigate({}, { scroll: false });
      return;
    }
    var kb = KB().resolve ? KB().resolve(h, id) : null;
    if (!kb) return;
    var st = docS(h, id);
    if (!st.folder) { h.toast('要先选一个分类：进分类后再全选文档', 'info'); return; }
    st.sel = docsIn(h, kb, st.folder).map(function (d) { return d.id; });
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-clearsel'] = function (id, btn, h) {
    if (id === 'lib') libS(h).sel = []; else docS(h, id).sel = [];
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-newfolder'] = function (id, btn, h) {
    global.V10UI.openSheet({
      title: '新建分类',
      bodyHtml: '<div class="v10-sheet-desc">分类只影响库内归类，不改变检索范围。建好后把文档拖进去即可。</div>' +
        '<label class="sub-h" style="display:block;margin-top:10px">分类名</label>' +
        '<input id="kb-fld-name" placeholder="例如：待复核 / 大促专场" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px">' +
        '<div class="err" id="kb-fld-err" style="display:none">分类名必填</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-act="kb-desk-newfolder-ok" data-id="' + e(h, id) + '">创建</button>'
    });
  };
  function sheetInput(sel) {
    var root = document.querySelector('.v10-sheet');
    var el = root ? root.querySelector(sel) : null;
    return { root: root, el: el, val: el ? String(el.value || '').trim() : '' };
  }
  ACTIONS['kb-desk-newfolder-ok'] = function (id, btn, h) {
    var inp = sheetInput('#kb-fld-name');
    if (!inp.val) { var er = inp.root && inp.root.querySelector('#kb-fld-err'); if (er) er.style.display = 'block'; return; }
    var list = foldersS(h, id);
    if (list.some(function (f) { return f.name === inp.val; })) { h.toast('已有同名分类', 'warn'); return; }
    list.push({ id: 'uf-' + (list.length + 1) + '-' + Date.now().toString(36), name: inp.val });
    global.V10UI.closeSheet();
    h.toast('已新建分类「' + inp.val + '」', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-rename-folder'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var f = foldersS(h, p[0]).filter(function (x) { return x.id === p[1]; })[0];
    if (!f) { h.toast('分类不存在', 'bad'); return; }
    global.V10UI.openSheet({
      title: '重命名分类',
      bodyHtml: '<label class="sub-h" style="display:block">分类名</label>' +
        '<input id="kb-fld-name" value="' + e(h, f.name) + '" style="width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px">' +
        '<div class="err" id="kb-fld-err" style="display:none">分类名必填</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-act="kb-desk-rename-ok" data-id="' + e(h, p[0]) + '|' + e(h, p[1]) + '">保存</button>'
    });
  };
  ACTIONS['kb-desk-rename-ok'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var f = foldersS(h, p[0]).filter(function (x) { return x.id === p[1]; })[0];
    if (!f) { h.toast('分类不存在', 'bad'); return; }
    var inp = sheetInput('#kb-fld-name');
    if (!inp.val) { var er = inp.root && inp.root.querySelector('#kb-fld-err'); if (er) er.style.display = 'block'; return; }
    f.name = inp.val;
    global.V10UI.closeSheet();
    h.toast('已重命名为「' + inp.val + '」', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-desk-rm-folder'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var kb = KB().resolve ? KB().resolve(h, p[0]) : null;
    if (!kb) return;
    var f = foldersOf(h, kb).folders.filter(function (x) { return x.key === p[1]; })[0];
    if (!f) { h.toast('分类不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '删除分类',
      desc: '删除「' + f.name + '」？里面的文档不会被删除，会回到按类型自动归类。',
      danger: false, confirmText: '删除分类',
      impacts: [
        { label: '分类', value: f.name },
        { label: '其中文档', value: h.fmt.int(f.count) + ' 篇（保留，改回自动归类）' },
        { label: '可恢复', value: '分类本身不可恢复，需重建' }
      ],
      action: '删除知识库分类', target: p[0] + ' · ' + f.name,
      onConfirm: function () {
        var list = foldersS(h, p[0]);
        for (var i = list.length - 1; i >= 0; i--) if (list[i].id === p[1]) list.splice(i, 1);
        var a = assignS(h, p[0]);
        Object.keys(a).forEach(function (k) { if (a[k] === p[1]) delete a[k]; });
        var st = docS(h, p[0]);
        if (st.folder === p[1]) st.folder = null;
        h.toast('已删除分类「' + f.name + '」，其中文档回到自动归类', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['kb-desk-move-to'] = function (id, btn, h) {
    var kb = KB().resolve ? KB().resolve(h, id) : null;
    if (!kb) return;
    var sel = docS(h, id).sel || [];
    if (!sel.length) { h.toast('先选中要移动的文档', 'info'); return; }
    moveSheet(h, kb, sel);
  };
  ACTIONS['kb-desk-move-pick'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var kb = KB().resolve ? KB().resolve(h, p[0]) : null;
    if (!kb) return;
    var sel = docS(h, p[0]).sel || [];
    /* 没选中东西时，点文件夹 chip = 进这个文件夹（不让按钮看着能点却没反应） */
    if (!sel.length) { openFolder(h, p[0], p[1]); return; }
    applyMove(h, kb, sel, p[1]);
  };
  ACTIONS['kb-desk-move-ok'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var kb = KB().resolve ? KB().resolve(h, p[0]) : null;
    if (!kb) return;
    var inp = sheetInput('#kb-mv-folder');
    var ids = String(p[1] || '').split(',').filter(Boolean);
    global.V10UI.closeSheet();
    if (!ids.length) return;
    applyMove(h, kb, ids, inp.el ? inp.el.value : '__auto');
  };
  ACTIONS['kb-desk-batch'] = function (id, btn, h) {
    var p = String(id || '').split('|'), kbId = p[0], op = p[1];
    var kb = KB().resolve ? KB().resolve(h, kbId) : null;
    if (!kb) return;
    var sel = (docS(h, kbId).sel || []).slice();
    if (!sel.length) { h.toast('先选中要处理的文档', 'info'); return; }
    var isDel = op === 'delete';
    h.dangerConfirm(h, {
      title: isDel ? '批量删除文档' : '批量下线文档',
      desc: isDel
        ? '删除选中的 ' + sel.length + ' 篇文档？删除后不可检索、也不可在清单中恢复。'
        : '把选中的 ' + sel.length + ' 篇文档从检索范围下线？',
      tone: isDel ? 'danger' : 'warn',
      perm: isDel ? 'knowledge:doc:delete' : 'knowledge:doc:offline',
      requireReason: true, confirmText: isDel ? '确认删除' : '确认下线',
      impacts: [
        { label: '文档数', value: sel.length + ' 篇' },
        { label: '所属知识库', value: kb.name },
        { label: isDel ? '删除后' : '下线后', value: isDel ? '不可恢复，检索不再命中' : '不再被检索到，可在列表视图查看', tone: isDel ? 'danger' : 'warn' }
      ],
      action: isDel ? '批量删除文档' : '批量下线文档',
      target: kbId + ' · ' + sel.length + ' 篇', auditImpact: sel.length + ' 篇',
      onConfirm: function () {
        /* 逐条走 KB_SESSION 的唯一写入口（与单篇下线/删除同一个函数），不在这里另开一份会话态写入 */
        var applied = 0;
        sel.forEach(function (docId) { if (KB().applyDocOp && KB().applyDocOp(h, kbId, docId, isDel ? 'delete' : 'offline')) applied++; });
        docS(h, kbId).sel = [];
        h.toast((isDel ? '已删除 ' : '已下线 ') + applied + ' 篇文档', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* ========================================================== 交互挂载 */
  function bindDesk(desk, h) {
    if (desk.__kbDeskBound) return;
    desk.__kbDeskBound = true;
    var kind = desk.getAttribute('data-kbdesk');
    var kbId = desk.getAttribute('data-kb');
    var kbLike = null;
    function kb() {
      if (!kbLike && kbId) kbLike = KB().resolve ? KB().resolve(h, kbId) : null;
      return kbLike;
    }
    function items() { return deskItems(desk); }
    function selNow() { return (deskSelS(h, desk).sel || []).slice(); }

    function openItem(parts) {
      if (parts[0] === 'kb') openKb(h, parts[1]);
      else if (parts[0] === 'folder') openFolder(h, kbId, parts[1]);
      else if (parts[0] === 'doc') run(h, 'kb-doc-open', kbId + '|' + parts[2]);
    }

    items().forEach(function (el) {
      var parts = String(el.getAttribute('data-kbi') || '').split('|');
      var kindOfItem = parts[0];

      el.addEventListener('click', function (ev) {
        ev.stopPropagation();                       /* 别让画布的"空白单击=清空"接走 */
        if (el.getAttribute('data-dragged')) return;
        var id = itemSelId(el);
        var cur = selNow();
        if (ev.shiftKey && desk.__kbAnchor != null) {
          var all = items(), ia = -1, ib = -1;
          all.forEach(function (x, i) { if (itemSelId(x) === desk.__kbAnchor) ia = i; if (itemSelId(x) === id) ib = i; });
          if (ia >= 0 && ib >= 0) {
            var lo = Math.min(ia, ib), hi = Math.max(ia, ib), rng = [];
            for (var i = lo; i <= hi; i++) rng.push(itemSelId(all[i]));
            applySel(h, desk, rng);
            return;
          }
        }
        if (ev.ctrlKey || ev.metaKey) {
          var ix = cur.indexOf(id);
          if (ix >= 0) cur.splice(ix, 1); else cur.push(id);
          applySel(h, desk, cur);
        } else {
          applySel(h, desk, [id]);
        }
        desk.__kbAnchor = id;
      });
      el.addEventListener('dblclick', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openItem(parts);
      });
      el.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        ev.preventDefault();
        ev.stopPropagation();
        applySel(h, desk, [itemSelId(el)]);
        openItem(parts);
      });
      el.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var id = itemSelId(el);
        if (selNow().indexOf(id) < 0) applySel(h, desk, [id]);
        if (kindOfItem === 'kb') {
          openMenu(h, ev, kbMenu(h, parts[1]));
        } else if (kindOfItem === 'folder') {
          var k = kb();
          if (!k) return;
          var f = foldersOf(h, k).folders.filter(function (x) { return x.key === parts[1]; })[0];
          if (f) openMenu(h, ev, folderMenu(h, k, f));
        } else if (kindOfItem === 'doc') {
          var k2 = kb();
          var d = docsOf(h, k2).filter(function (x) { return x.id === parts[2]; })[0];
          if (d) openMenu(h, ev, docMenu(h, k2, d));
        }
      });

      /* 拖拽源：文档图标（多选时整批一起搬） */
      if (kindOfItem === 'doc') {
        el.addEventListener('dragstart', function (ev) {
          var id = itemSelId(el), sel = selNow();
          if (sel.indexOf(id) < 0) { sel = [id]; }
          desk.__kbDrag = sel.slice();
          el.classList.add('dragging');
          try {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', desk.__kbDrag.join(','));
          } catch (err) { /* 个别浏览器不给 dataTransfer，忽略 */ }
        });
        el.addEventListener('dragend', function () {
          el.classList.remove('dragging');
          desk.__kbDrag = null;
          clearDrops(desk);
          /* 拖完紧接着还会来一次 click（拖了但没落点）——挡掉，否则会变成"选中" */
          el.setAttribute('data-dragged', '1');
          setTimeout(function () { el.removeAttribute('data-dragged'); }, 0);
        });
      }
    });

    /* 拖拽落点：文件夹图标 / 移动条上的 chip / 面包屑根 */
    function clearDrops(scope) {
      (scope || desk).querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
    }
    desk.querySelectorAll('[data-drop]').forEach(function (zone) {
      zone.addEventListener('dragover', function (ev) {
        if (!desk.__kbDrag || !desk.__kbDrag.length) return;
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (err) {}
        zone.classList.add('drop-on');
      });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drop-on'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.remove('drop-on');
        var ids = desk.__kbDrag || [];
        desk.__kbDrag = null;
        if (!ids.length) return;
        var k = kb();
        if (k) applyMove(h, k, ids, zone.getAttribute('data-drop'));
      });
    });

    /* 画布：空白单击清空 / 拖动框选 / 空白右键 */
    var canvas = desk.querySelector('[data-kbdesk-canvas]');
    if (canvas) {
      canvas.addEventListener('mousedown', function (ev) {
        if (ev.button !== 0) return;
        if (ev.target.closest && ev.target.closest('[data-kbi]')) return;
        /* 列表视图的三栏不参与框选：画布一旦接管 mousedown，行上的 click 就不会再来 ——
           实测点一行没有任何反应。框选只在网格视图有意义。 */
        if (ev.target.closest && ev.target.closest('.kb-cols')) return;
        var box = canvas.getBoundingClientRect();
        var sx = ev.clientX, sy = ev.clientY, moved = false;
        var mq = canvas.querySelector('.kb-marquee');
        var base = (ev.ctrlKey || ev.metaKey) ? selNow() : [];
        ev.preventDefault();                       /* 别顺手选中文字/图标 */
        function onMove(e2) {
          if (!moved && (Math.abs(e2.clientX - sx) > 4 || Math.abs(e2.clientY - sy) > 4)) moved = true;
          if (!moved) return;
          var x1 = Math.min(sx, e2.clientX), y1 = Math.min(sy, e2.clientY);
          var x2 = Math.max(sx, e2.clientX), y2 = Math.max(sy, e2.clientY);
          if (mq) {
            mq.classList.remove('hidden');
            mq.style.left = (x1 - box.left) + 'px';
            mq.style.top = (y1 - box.top) + 'px';
            mq.style.width = (x2 - x1) + 'px';
            mq.style.height = (y2 - y1) + 'px';
          }
          var merged = base.slice();
          items().forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
              var id = itemSelId(el);
              if (merged.indexOf(id) < 0) merged.push(id);
            }
          });
          paintSelQuiet(desk, merged);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (mq) mq.classList.add('hidden');
          if (!moved) applySel(h, desk, []);                    /* 空白单击 = 取消选择 */
          else applySel(h, desk, desk.__kbPending || []);       /* 框选落定（顺带刷新批量条） */
          desk.__kbPending = null;
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      canvas.addEventListener('contextmenu', function (ev) {
        if (ev.target.closest && ev.target.closest('[data-kbi]')) return;
        ev.preventDefault();
        openMenu(h, ev, blankMenu(h, desk, kb()));
      });
    }
  }

  /* app.js 的 bindContent 在每次渲染后调用（与 __anetDrag 同款的位置） */
  global.__kbDesk = function (root, h) {
    if (!root || !root.querySelectorAll) return;
    closeMenu();                    /* 重渲染后旧菜单指向的已是消失的节点，一律先收 */
    Array.prototype.forEach.call(root.querySelectorAll('[data-kbdesk]'), function (desk) { bindDesk(desk, h); });
    /* 渲染后按**实测列数**校正每页项数 = 列数 × 4 行。
       JS 按容器宽度估算列数会与 CSS 实际差一列（实测 2560px 下估 9 列、实际 8 列），
       差一列就多出半行 —— 4 行变 5 行。以 DOM 实测为准，校正后重渲染一次即稳定。 */
    var g = root.querySelector('.kb-items-doc');
    if (!g) return;
    var cols = (global.getComputedStyle(g).gridTemplateColumns || '').split(' ').filter(Boolean).length;
    if (!cols) return;
    var box = root.querySelector('[data-kbdesk="docs"]');
    var kbId = box && box.getAttribute('data-kb');
    if (!kbId) return;
    var st = docS(h, kbId);
    var want = cols * DOC_ROWS;
    if (st.pageSize === want) return;
    st.pageSize = want;
    st.page = 1;
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') hh.render();
  };

  /* ========================================================== 对外接口 */
  /* ============================================ 右侧「版本历史」抽屉 + 方案配色自定义
     用户要的两件事：
       ① 点一份文档 → 右侧看它的**历史版本**（同一方案的其他版本，v1..vN）
       ② **颜色可自定义** —— 自动取色只是默认值，人可以改；改完写进会话态，
          优先级高于名册序号与哈希（见 planHueOf）。
     抽屉放在文档区右侧，不遮住网格 —— 所以不用居中弹层。 */
  function planOf(d) {
    return String((d && d.name) || '').replace(/[》\s]*v\d+[》\s]*$/, '').replace(/[《》]/g, '');
  }
  function verNumOf(d) {
    var m = String((d && d.name) || '').match(/v(\d+)/);
    return m ? Number(m[1]) : 1;
  }
  function planHueStore(h) {
    var st = kstate(h);
    st.kbPlanHue = st.kbPlanHue || {};
    return st.kbPlanHue;
  }
  function kstate(h) { return (h && h.state) || {}; }

  /** 同一方案的**全部版本**（含已下线/已删除之外的全部态，便于回看历史） */
  function versionsOf(h, kbLike, d) {
    var base = planOf(d), all = docsOf(h, kbLike), out = [];
    for (var i = 0; i < all.length; i++) {
      if (planOf(all[i]) === base) out.push(all[i]);
    }
    out.sort(function (a, b) { return verNumOf(a) - verNumOf(b); });
    return out;
  }

  function verDrawerHtml(h, kbLike) {
    var st = kstate(h), cur = st.kbVersions;
    if (!cur || cur.kbId !== kbLike.id) return '';
    var all = docsOf(h, kbLike);
    var d = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === cur.docId) { d = all[i]; break; }
    if (!d) return '';
    var base = planOf(d), vers = versionsOf(h, kbLike, d);
    var store = planHueStore(h), curHue = store[base] || planHueOf(h, d);
    var curV = verNumOf(d);

    return '<aside class="kb-ver" role="complementary" aria-label="版本历史">' +
      '<div class="kb-ver-h"><b>' + e(h, base) + '</b>' +
      '<span class="muted">共 ' + vers.length + ' 个版本</span>' +
      '<button class="kb-ver-x" data-act="kb-versions-close" aria-label="关闭">×</button></div>' +

      /* 配色自定义：9 个色板，点一下就改；改完这份方案的所有版本一起变 */
      '<div class="kb-ver-sec"><span class="kb-ver-t">配色</span>' +
      '<div class="kb-ver-hues" role="group" aria-label="方案配色">' +
      DOC_HUES.map(function (hz) {
        return '<button class="kb-hue h-' + hz + (hz === curHue ? ' on' : '') +
          '" data-act="kb-plan-hue" data-id="' + e(h, base) + '|' + hz + '"' +
          ' aria-pressed="' + (hz === curHue) + '" title="' + hz + '"></button>';
      }).join('') +
      (store[base] ? '<button class="kb-ver-reset" data-act="kb-plan-hue" data-id="' + e(h, base) + '|__auto">恢复默认</button>' : '') +
      '</div></div>' +

      '<div class="kb-ver-sec"><span class="kb-ver-t">历史版本</span>' +
      '<div class="kb-ver-list">' +
      vers.map(function (v) {
        var vs = statusOf(h, v), vn = verNumOf(v), on = vn === curV;
        var gone = v.offline ? ' is-gone' : '';
        return '<button class="kb-ver-row' + (on ? ' on' : '') + gone + '"' +
          ' data-act="kb-versions-open" data-id="' + e(h, kbLike.id) + '|' + e(h, v.id) + '"' +
          ' aria-current="' + on + '">' +
          '<span class="kb-ver-v">v' + vn + '</span>' +
          '<span class="kb-ver-m">' + h.fmt.int(v.slices) + ' 切片 · ' + e(h, h.fmt.rel(v.updatedDay)) + '</span>' +
          '<span class="pill ' + vs.k + '">' + e(h, vs.t) + '</span>' +
          (on ? '<span class="kb-ver-cur">当前</span>' : '') +
          '</button>';
      }).join('') +
      '</div>' +
      '<div class="bt-note">同方案的版本共用一套配色；改配色会同时作用于全部版本。</div>' +
      '</div></aside>';
  }
  /* ============ 版本历史 / 配色自定义 的动作 ============ */
  function rerender(h) {
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  }
  /* 打开抽屉：只改状态，不碰 hash（知识库的 tab 不进 URL，走 navigate 会冲掉 tab） */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-versions'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var all = docsOf(h, KB().resolve(h, p[0]) || {});
    var d = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === p[1]) { d = all[i]; break; }
    if (!d) { h.toast('找不到这篇文档', 'warn'); return; }
    h.state.kbVersions = { kbId: p[0], docId: p[1], name: d.name };
    rerender(h);
  };
  (global.ACTIONS || (global.ACTIONS = {}))['kb-versions-close'] = function (id, btn, h) {
    h.state.kbVersions = null;
    rerender(h);
  };
  /* 版本行 → 换成看那一版（抽屉不关，方便在版本间跳） */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-versions-open'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var s = KB().resolve(h, p[0]);
    var all = s ? docsOf(h, s) : [];
    var d = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === p[1]) { d = all[i]; break; }
    if (!d) return;
    h.state.kbVersions = { kbId: p[0], docId: p[1], name: d.name };
    rerender(h);
  };
  /* 配色：data-id = 方案基名|色相；色相为 __auto 表示恢复默认 */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-plan-hue'] = function (id, btn, h) {
    var p = String(id || '').split('|'), base = p[0], hz = p[1];
    /* ⚠ 此处原本无论输入什么都弹「已把「」的配色改为 undefined」——
       id 缺段或 hz 不在允许色板里时不写任何东西，却照样报"已改"。现在按实情分三档。 */
    if (!base || !hz) { h.toast('未指定要改配色的分类或配色值', 'bad'); return; }
    var store = planHueStore(h);
    if (hz === '__auto') {
      delete store[base];
      h.toast('已恢复默认配色', 'ok');
    } else if (DOC_HUES.indexOf(hz) >= 0) {
      store[base] = hz;
      h.toast('已把「' + base + '」的配色改为 ' + hz, 'ok');
    } else {
      h.toast('不支持的配色值：' + hz + '（允许：' + DOC_HUES.join(' / ') + ' / __auto）', 'bad');
      return;
    }
    rerender(h);
  };
  /* 分类筛选：点一下换下面的文档（不是"进入"一个新层级）。
     原来靠双击进分类、再点返回出来，一进一出两次跳转。 */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-desk-cat'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var st = docS(h, p[0]);
    st.folder = (p[1] === '__all') ? null : p[1];
    st.page = 1;
    st.sel = [];
    var hh = global.APP_SHELL;
    if (hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  };

  global.KBDESK = {
    libHtml: libHtml,
    docsDeskHtml: docsDeskHtml,
    foldersOf: foldersOf,
    libLayout: function (h) { return libS(h).layout; },
    docLayout: function (h, kbId) { return docS(h, kbId).layout; },
    viewToggle: viewToggle,
    /* 列表视图共用同一份"按名搜" —— 两种视图对同一个词给同一个结果，不各写一套 */
    docQuery: docQuery,
    filterByName: filterByName,
    closeMenu: closeMenu
  };
})(window);
