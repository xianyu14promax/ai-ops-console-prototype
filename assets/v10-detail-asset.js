/* ============================================================================
 * v10 详情渲染器 · 资产类（画像 / 知识库 / 经验）
 *
 * 对应 data.js 已就绪的 detailType：
 *   persona → personaDetail · knowledge → kbDetail · llm-exp → expDetail
 * （sandboxDetail 在 v10-detail-sandbox.js，不在本文件）
 *
 * 铁律：ES5 · 确定性随机走 h.seed.R.of · 禁 details 折叠 · 对象不存在走 detailMissing
 *       · 界面禁自述腔（机制说明进 metaBar）
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* 🔴 C-5：Q 不是全局 —— 它在 data.js:899 是局部 var。
     本文件此前从未用过 Q，所以一直没有这行声明；使用 Q.abDerived 前必须显式取。
     与 v10-detail-flow.js:17 保持同款写法，避免"看起来能用、运行时 ReferenceError"。 */
  var Q = global.QUERY;
  var R = global.RENDERERS;
  var V = global.V10UI;

  function byId(h, list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* 资产详情共用的壳：面包屑 + 页签条 + 主体 + 页脚口径 */
  /* headActs：可选的页头动作 HTML（如「编辑正文」）。加在 ph-side 里，
     与列表页的「新建 XXX」同一位置习惯 —— 不传就与原来完全一致（知识库等不受影响）。 */
  /* 域中文名：取 data.js 导出的 domains。取不到就返回空串 —— 宁可少一段，
     也不把 insight / engine 这类 id 印给用户。 */
  function domainNameOf(cap, h) {
    var list = (h && h.app && h.app.domains) || (global.APP_DATA && global.APP_DATA.domains) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === cap.domain) return list[i].name || '';
    return '';
  }

  function shell(cap, state, h, obj, title, subtitle, tabs, active, bodyHtml, headActs) {
    /* 面包屑三段：域 / 能力 / 对象名，末段必须与页面标题一致 —— 与 v10-interview.js 的 crumb 同形。
       此前是 [cap.name, subtitle]：父级名字出现两次，末段是「状态」而不是对象名，
       于是「企业知识库 / 企业知识库 · 索引最新」压在标题「产品文档库」上面；
       而这串字又原样出现在紧下面的 .ph-desc 里，等于同一句话印了两遍。 */
    var parts = [], dn = domainNameOf(cap, h);
    if (dn) parts.push({ text: dn });
    parts.push({ text: cap.name });
    parts.push({ text: (obj && obj.name) || subtitle });
    var crumb = h.pageCrumb(parts);
    var tabsBar = h.detailTabs(cap, { objTab: active }, tabs, h);
    /* 详情页的返回入口。面包屑是**纯文本、不可点**（v10-ui.js 的 pageCrumb 只拼 <nav>），
       所以从「产品文档库」这类详情页没有返回上一级的路，只能靠左侧导航。
       这里补一个显式返回：回到本能力的列表页（清掉 obj / tab）。 */
    var back = obj
      ? '<button class="ph-back" data-act="ph-back" data-id="' + h.esc(cap.domain + '|' + cap.id) +
        '" aria-label="返回列表">← 返回</button>'
      : '';
    return '<div class="page-head"><div class="ph-main">' + back + crumb +
      '<div class="ph-title">' + title + '</div>' +
      '<div class="ph-desc">' + subtitle + '</div>' +
      '</div>' + (headActs ? '<div class="ph-side">' + headActs + '</div>' : '') + '</div>' +
      tabsBar +
      bodyHtml +
      /* 口径要走 metaBar 的**第二个参数**（extra 数组）——第一参数只认 range/sampleNote 那几个键，
       放进去等于没传。不传的话 metaBar 会印「本屏无额外口径」，
       而同一屏明明有两段口径说明（走查：页脚与屏上内容矛盾）。 */
    h.metaBar({}, [{ k: '口径', v: '指标定义与数据性质见各卡内说明' }]);
  }

  /* 画像会话内编辑的统一覆盖计算 —— 详情页与列表页都用这一份，
     避免"两处各写一遍、改了一个忘了另一个"（覆盖企业数就是这么漂的：行业改了、数没跟）。
     覆盖企业数**从企业池按编辑后的「行业 + 标签」重新圈**，不再沿用旧值 ——
     改了行业/标签而数字不动，等于数据源和界面两套账。
     暴露到 global 供 renderers2 的列表复用。 */
  function personaApplyEdit(base, edit, personas) {
    if (!edit) return base;
    var edited = Object.assign({}, base, {
      kind: edit.kind, role: edit.role, industry: edit.industry, tags: edit.tags,
      name: edit.name, owner: edit.owner
    });
    var ents = base.ents;
    if (global.APP_DATA && global.APP_DATA.firmsOf) {
      ents = global.APP_DATA.firmsOf(edited, personas).length;
    }
    return Object.assign({}, base, {
      name: edit.name, kind: edit.kind, role: edit.role,
      industry: edit.industry, owner: edit.owner, tags: edit.tags, ents: ents,
      kindText: edit.kind === 'role' ? ('角色画像 · ' + (edit.role || '未指定')) : 'ICP · 企业类型',
      rulesDerived: '行业 = ' + edit.industry + ' AND 标签含「' + (edit.tags || []).slice(0, 2).join('、') + '」',
      editedInSession: true, editReason: edit.reason, editedBy: edit.by
    });
  }
  global.PERSONA_APPLY_EDIT = personaApplyEdit;

  /* 身份图标小工具 —— 图标/色相的真源在 data.js（FIRM_INDUSTRY_ICON / FIRM_TAG_ICON），
     这里只负责渲染。走查反馈：这一屏此前全是文字，行业、标签、规模扫一屏分不清谁是谁。
     · 行业：SVG 图标 + 各自色相（制造/零售/金融/政务/电商 五个形状本来就不同，色相再叠一层）
     · 标签：SVG 图标（统一弱色 —— 标签是次要信息，不该比行业更抢眼）
     · 规模：1/2/3 格「信号条」——它是标量不是分类，配三个不同图形反而是在说别的事
     ⚠ 不用 emoji：字形跨平台不一致、不跟主题换色、线宽也统一不了（走查明确要求）。 */
  function firmIco(kind, val, h) {
    var A = global.APP_DATA || {};
    var name = '', tone = '';
    if (kind === 'industry') {
      name = A.firmIndustryIcon ? A.firmIndustryIcon(val) : 'building';
      tone = A.firmIndustryTone ? A.firmIndustryTone(val) : 'idle';
    } else {
      name = A.firmTagIcon ? A.firmTagIcon(val) : 'label';
    }
    if (!name) return '';
    var label = kind === 'industry' ? '行业 ' + val : '标签 ' + val;
    return '<i class="ico-i' + (tone ? ' t-' + h.esc(tone) : '') + '" role="img" aria-label="' + h.esc(label) + '">' +
      h.icon(name, 14) + '</i>';
  }
  /* 企业身份标：**首字 + 行业色相**。
     为什么不复用行业列那个图标：一行里同一个图标会出现两次（冗余）。
     首字给身份、色相给类型，与行业列的文字标签互补 —— 和「人用头像」同一套读法。 */
  function firmFace(f, h) {
    var A = global.APP_DATA || {};
    var tone = A.firmIndustryTone ? A.firmIndustryTone(f.industry) : 'slate';
    var n = String(f.name || '');
    var m = n.match(/[\u4e00-\u9fa5]/);
    var ch = m ? m[0] : n.slice(0, 1).toUpperCase();
    return '<span class="firm-av h-' + h.esc(tone) + '" aria-hidden="true">' + h.esc(ch) + '</span>';
  }
  function lvlBars(n) {
    var out = '';
    for (var i = 0; i < 3; i++) {
      var hh = 4 + i * 3, y = 11 - hh, on = (i < n);
      out += '<rect x="' + (1 + i * 4.2).toFixed(1) + '" y="' + y + '" width="2.6" height="' + hh + '" rx="1" opacity="' + (on ? 1 : 0.25) + '"/>';
    }
    return '<svg class="lvl" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' + out + '</svg>';
  }
  function scaleIco(val, h) {
    var A = global.APP_DATA || {};
    var n = A.firmScaleLevel ? A.firmScaleLevel(val) : 0;
    if (!n) return '';
    return '<span class="lvl-wrap" role="img" aria-label="规模 ' + h.esc(val) + '">' + lvlBars(n) + '</span>';
  }
  /** 小标签片：图标 + 文字。分布摘要与企业清单共用，免得两处各画一套。
      ⚠ 只有 scale / industry / tag 三种带上图标：省份（region）是**地名不是分类**，
      走 firmIco 会落到「未知标签 = 🏷️」的兜底图标上 —— 实测第一版就是这样，
      于是「上海」前面挂了个标签图标。没登记的 kind 一律给纯文字。 */
  function chip(kind, val, count, h) {
    var ico = kind === 'scale' ? scaleIco(val, h)
      : (kind === 'industry' || kind === 'tag') ? firmIco(kind, val, h) : '';
    return '<span class="tag-mini">' + ico + h.esc(val) + (count == null ? '' : ' ' + count) + '</span>';
  }

  /* 设备/企业清单：画像 → 覆盖企业 → 企业卡片。
     数据来自 APP_DATA.firmsOf（见 data.js 的「企业主数据（模拟）」段）。
     这一层是「覆盖企业 96」的**展开** —— 96 家分别是哪 96 家、每家命中了什么标签。
     v25c：本块内容已并入「概览」页签（走查意见：覆盖企业是这个画像最该先看到的东西，
     不该藏在第二个页签后面），页签本身已移除；老深链 .../persona/{id}/firms 仍可打开。 */
  function personaFirmsTab(s, t, state, h, fmt) {
    var A = global.APP_DATA || {};
    var firms = A.firmsOf ? A.firmsOf(s, t.rows) : [];
    var fq = (state.filters && state.filters.firmQ) || '';
    var q = String(fq).trim().toLowerCase();
    var view = q ? firms.filter(function (f) {
      return (f.name + ' ' + f.region + ' ' + f.scale + ' ' + (f.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    }) : firms;

    /* 分布摘要：让「96 家」这个数字有结构，而不是一个孤立计数。
       每一片都带身份图标（规模＝信号条、省份＝纯文字、标签＝emoji）——
       否则三行 chip 长得一模一样，只能靠左边的「按规模/按省份/按标签」才知道在看什么。 */
    function dist(key, kind) {
      var m = {};
      firms.forEach(function (f) { m[f[key]] = (m[f[key]] || 0) + 1; });
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })
        .map(function (k) { return chip(kind, k, m[k], h); }).join(' ');
    }
    var avgPurchase = firms.length ? Math.round(firms.reduce(function (a, f) { return a + f.annualPurchase; }, 0) / firms.length) : 0;
    var avgScore = firms.length ? Math.round(firms.reduce(function (a, f) { return a + f.score; }, 0) / firms.length) : 0;

    var head = '<div class="metrics">' + [
      { label: '命中企业', value: fmt.int(firms.length), sub: '圈选条件在主数据上的去重结果' },
      { label: '平均年采购额', value: fmt.int(avgPurchase) + ' 万', sub: '按命中企业的年采购额平均' },
      { label: '平均意向分', value: String(avgScore), sub: '40–98，越高越该先打' },
      { label: '覆盖省份', value: String(Object.keys(firms.reduce(function (m, f) { m[f.region] = 1; return m; }, {})).length), sub: '按注册地统计' }
    ].map(h.metricCard).join('') + '</div>';

    /* 分布用**条形**表达，不是一行字 —— 一行字既看不出比例，又把格子撑出大片空白。
       limit：超过 n 项聚合成「其他」，否则 10 个省份会比 3 个规模高出一大截，三栏失衡。 */
    function distRows(key, limit) {
      var m = {};
      firms.forEach(function (f) { m[f[key]] = (m[f[key]] || 0) + 1; });
      var arr = Object.keys(m).map(function (k) { return { k: k, n: m[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
      if (limit && arr.length > limit) {
        var rest = arr.slice(limit).reduce(function (s, x) { return s + x.n; }, 0);
        arr = arr.slice(0, limit);
        arr.push({ k: '其他 ' + (Object.keys(m).length - limit) + ' 项', n: rest });
      }
      var max = arr.length ? arr[0].n : 1;
      return arr.map(function (x) {
        /* v31：分布条此前是纯只读 —— 现在每一行都是一次真筛选（写 state.filters.firmQ，企业清单读同一个键）。
           「其他 N 项」是聚合行，没有对应的企业，不挂按钮（挂了就会筛出 0 家）。
           按钮放进原本的 <span> 里：.bar-row>span:first-child 是 flex:0 0 64px + 省略号，改结构会串列。 */
        var isAgg = /^其他 \d+ 项$/.test(String(x.k));
        return '<div class="bar-row"><span title="' + h.esc(x.k) + '">' +
          (isAgg
            ? '<span class="muted">' + h.esc(x.k) + '</span>'
            : '<button class="lnk" data-act="persona-firm-q" data-id="' + h.esc(x.k) + '"' +
              ' title="只看「' + h.esc(x.k) + '」的企业">' + h.esc(x.k) + '</button>') +
          '</span>' +
          '<span class="bar"><i style="width:' + Math.max(4, Math.round(x.n / max * 100)) + '%"></i></span>' +
          '<b>' + fmt.int(x.n) + '</b></div>';
      }).join('') || '<span class="muted">—</span>';
    }

    var distHtml = '<div class="card"><div class="card-h"><h3>命中构成</h3>' +
      '<span class="card-sub">这 ' + firms.length + ' 家是怎么分布出来的' +
      (fq ? '　·　当前只看「' + h.esc(fq) + '」' : '　·　点下面的规模 / 省份 / 标签可直接过滤企业清单') + '</span>' +
      (fq ? '<button class="btn-ghost sm" data-act="persona-firm-q" data-id="">清除筛选</button>' : '') + '</div>' +
      '<div class="kv">' +
      '<div><i>按规模</i><b>' + distRows('scale') + '</b></div>' +
      '<div><i>按省份</i><b>' + distRows('region', 6) + '</b></div>' +
      '<div><i>按命中标签</i><b>' + (function () {
        var m = {};
        firms.forEach(function (f) { (f.tags || []).forEach(function (x) { m[x] = (m[x] || 0) + 1; }); });
        /* v31：命中构成此前是**纯只读**面板（有来源、没有去向）。
           现在每一片都是一个真筛选入口 —— 点一下把该条件写进 state.filters.firmQ，
           下方「企业清单」按同一个键过滤（与搜索框回车完全同一条路径），不是装饰。 */
        return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })
          .map(function (k) {
            var on = String(fq).trim() === k;
            return '<button class="chip link' + (on ? ' on' : '') + '" data-act="persona-firm-q" data-id="' + h.esc(k) + '"' +
              ' title="只看命中标签「' + h.esc(k) + '」的企业">' + firmIco('tag', k, h) + h.esc(k) + ' <b>' + m[k] + '</b></button>';
          }).join(' ') || '—';
      })() + '</b></div>' +
      '</div></div>';

    var list = '<div class="card pad0"><div class="card-h pad"><h3>企业清单</h3>' +
      '<span class="card-sub">' + view.length + ' / ' + firms.length + ' 家 · 点企业名打开企业卡片</span></div>' +
      '<div style="padding:0 16px 10px"><input data-f="firmQ" placeholder="搜企业名 / 省份 / 规模 / 标签，回车筛选" value="' + h.esc(fq) + '" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font:inherit"></div>' +
      h.table({
        columns: [
          { key: 'name', label: '企业', render: function (f) {
            return '<div class="firm-cell">' + firmFace(f, h) +
              '<span><button class="lnk" data-act="firm-open" data-id="' + h.esc(f.id) + '"><b>' + h.esc(f.name) + '</b></button>' +
              '<div class="td-sub mono">' + h.esc(f.uscc) + '</div></span></div>'; } },
          { key: 'industry', label: '行业', render: function (f) { return firmIco('industry', f.industry, h) + h.esc(f.industry); } },
          { key: 'region', label: '注册地' },
          { key: 'scale', label: '规模', render: function (f) {
            return '<span class="pill ' + (f.scale === '大型' ? 'ok' : (f.scale === '中型' ? 'info' : 'idle')) + '">' + scaleIco(f.scale, h) + h.esc(f.scale) + '</span>'; } },
          { key: 'annualPurchase', label: '年采购额', align: 'right', render: function (f) { return fmt.int(f.annualPurchase) + ' 万'; } },
          { key: 'score', label: '意向分', align: 'right', render: function (f) {
            return '<b class="' + (f.score >= 80 ? 'ok' : (f.score >= 60 ? '' : 'muted')) + '">' + f.score + '</b>'; } },
          { key: 'tags', label: '命中标签', render: function (f) {
            return (f.tags || []).map(function (x) { return chip('tag', x, null, h); }).join(' ') || '<span class="muted">—</span>'; } }
        ],
        rows: view, noPaging: true, pageSize: 50,
        emptyTitle: '没有匹配的企业',
        emptySub: '换个关键词，或清空搜索框看全部 ' + firms.length + ' 家'
      }) + '</div>';

    return head + distHtml + list;
  }

  /* 企业卡片 —— 点开一家企业，看它的完整档案。
     它是「画像覆盖企业」的**末端对象**：到这层才看得到一个具体企业长什么样。 */
  (global.ACTIONS || (global.ACTIONS = {}))['firm-open'] = function (id, btn, h) {
    var A = global.APP_DATA || {};
    var t = h.app.getAssetTables().persona;
    var f = A.firmById ? A.firmById(id, t.rows) : null;
    if (!f) { h.toast('企业不存在', 'bad'); return; }
    var fmt = h.fmt;
    var personas = (f.personas || []).map(function (pid) {
      var p = byId(h, t.rows, pid);
      return p ? '<button class="lnk" data-act="go-detail" data-id="persona|' + h.esc(p.id) + '">' + h.esc(p.name) + '</button>' : h.esc(pid);
    }).join(' · ') || '—';
    var kv = [
      ['统一社会信用代码', '<span class="mono">' + h.esc(f.uscc) + '</span>'],
      ['所属行业', h.esc(f.industry)],
      ['注册地', h.esc(f.region)],
      ['企业规模', h.esc(f.scale)],
      ['成立年份', h.esc(String(f.foundedYear))],
      ['员工人数', fmt.int(f.employees) + ' 人'],
      ['年采购额', fmt.int(f.annualPurchase) + ' 万元'],
      ['意向分', f.score + '（40–98）'],
      ['关键联系人角色', h.esc(f.contactRole)],
      ['命中标签', (f.tags || []).map(function (x) { return '<span class="tag-mini">' + h.esc(x) + '</span>'; }).join(' ') || '—'],
      ['被哪些画像覆盖', personas]
    ];
    /* ⚠ 这里不能用 openModal —— 它是 renderers2.js 的**局部函数**，没挂 global，
       跨文件引用会 ReferenceError。用本文件既有的 global.V10UI.openSheet。 */
    global.V10UI.openSheet({
      title: f.name,
      bodyHtml: '<dl class="dl">' +
        kv.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') +
        '</dl>' +
        '<div class="bt-note">这家企业是「圈选条件」在主数据上命中的结果 —— 它命中的标签决定了它落在哪些画像里。' +
        '画像口径变化（改行业 / 改标签）会重新圈，这家企业可能进也可能出。</div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">关闭</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') global.V10UI.closeSheet();
        });
      }
    });
  };

  /* ==================================================== 画像详情 */
  R.personaDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var t = h.app.getAssetTables().persona;
    var s = byId(h, t.rows, state.objId || state.agentId);
    if (!s) return h.detailMissing(cap, state, h);
    /* 会话内停用过的对象：详情页头与卡片也要跟着变，不能只在列表变 */
    if (h.state && h.state.personaDisabled && h.state.personaDisabled[s.id]) {
      s = Object.assign({}, s);
      s.status = 'disabled'; s.statusText = '已停用'; s.isDisabled = true;
    }
    /* 会话内内容编辑覆盖 —— 不接这一步，编辑动作就只是"存了个值但页面没变"。
       同时按编辑后的「行业 + 标签」重算圈选条件，保持与 data.js:633 的口径一致。 */
    var _pe = (h.state && h.state.personaEdit && h.state.personaEdit[s.id]) || null;
    if (_pe) s = personaApplyEdit(s, _pe, t.rows);
    var active = state.objTab || state.tab || 'overview';
    /* 老深链 .../persona/{id}/firms 仍要能打开：页签没了，落到概览（内容就在概览里） */
    if (active === 'firms') active = 'overview';
    var ttl = t.ttlDays || 30;
    var refreshed = (h.state && h.state.personaRefresh && h.state.personaRefresh[s.id]) || null;
    var isDisabled = !!(h.state && h.state.personaDisabled && h.state.personaDisabled[s.id]);
    var TABS = [
      { key: 'overview', label: '概览' },
      /* v25c（走查意见：「把覆盖企业放在概览里面」）：原「覆盖企业」页签已并入概览 ——
         「覆盖企业 96」是这个画像最该先看到的东西，藏在第二个页签后面等于没有。
         企业清单本身保留：库 → 画像 → 企业清单 → 企业卡片这条下钻链没断。 */
      { key: 'tags', label: '标签与口径' },
      { key: 'refs', label: '引用关系' }
    ];
    var body = '';

    if (active === 'overview') {
      /* 覆盖企业数改为**从企业池数出来**（不再是行上的静态 ents）。
         数据源换成真主数据时，这里不用改 —— 只要 firmsOf 接到真实查询。 */
      var _firmsN = (global.APP_DATA && global.APP_DATA.firmsOf) ? global.APP_DATA.firmsOf(s, t.rows).length : s.ents;
      body = '<div class="metrics">' + [
        { label: '覆盖企业', value: fmt.int(_firmsN), sub: '按 USCC 去重 · 见下方企业清单', definition: '以统一社会信用代码（USCC）为去重主键在主数据上圈出。一家企业只属一个行业，故各画像覆盖数相加即为去重后的合计' },
        { label: '被引用', value: fmt.int(s.refCount), sub: '被 Agent / 策略引用 · ' + s.heatText },
        { label: '负责人', value: s.owner, sub: '画像维护人' },
        { label: '更新时间', value: fmt.rel(s.updated), alert: s.overdueDays > 0, sub: s.overdueDays > 0 ? '已超期 ' + s.overdueDays + ' 天（有效期 ' + ttl + ' 天）' : '在 ' + ttl + ' 天有效期内' }
      ].map(h.metricCard).join('') + '</div>' +
      (s.editedInSession ? '<div class="alert-banner warn"><b>⚠ 画像内容已在本会话被修改</b><span>' +
        '改动人 ' + h.esc(s.editedBy || '我') + ' · 理由：' + h.esc(s.editReason || '—') +
        '</span><span class="hint">仅本会话生效、刷新还原；圈选条件已按新的行业与标签重算。</span></div>' : '') +
      /* 判定规则与新鲜度口径放**卡头 sub**，不占字段格 ——
         它们对每个画像都是同一句话，摆在字段格里既区分不了对象，又把正文位占了。 */
      '<div class="card" data-static="1" title="只读说明：画像定位是对象的属性陈述；编辑内容走「编辑正文」，命中企业清单走下方「命中构成」的下钻。"><div class="card-h"><h3>画像定位</h3>' +
      '<span class="card-sub">' + h.esc(t.kindHint || 'ICP · 企业类型') + '　·　超过 ' + ttl + ' 天未更新 = 待更新</span></div><div class="kv">' +
      '<div><i>画像名称</i><b>' + h.esc(s.name) + '</b></div>' +
      '<div><i>画像类型</i><b>' + h.pill(s.kindKey || 'idle', s.kindText || 'ICP · 企业类型') + '</b></div>' +
      '<div><i>所属行业</i><b>' + firmIco('industry', s.industry, h) + h.esc(s.industry || '—') + '</b></div>' +
      /* 「类型判定规则」「新鲜度口径」两格删掉了 —— 它们对**每个画像都是同一句话**，
         放在字段格里既区分不了对象，又占了正文位。判定规则与新鲜度口径归页脚「口径」。 */
      '<div><i>圈选条件</i><b>' + h.esc(s.rulesDerived || '—') +
        (s.rulesDerived ? '<span class="muted" style="display:block;font-size:11px;margin-top:3px">由标签反推，非原始规则</span>' : '') + '</b></div>' +
      '<div><i>状态</i><b>' + h.pill(s.status, s.statusText) + '</b></div>' +
      '</div></div>' +
      /* v25c：覆盖企业清单并入概览（原「覆盖企业」页签已移除）。
         放在「画像定位」之后、生命周期动作（该更新了 / 停用）之前 ——
         读序是「这是什么 → 覆盖了谁 → 该怎么处置」，动作仍在页尾收口。 */
      '<div class="sub-h">覆盖企业 · 这 ' + _firmsN + ' 家是谁</div>' +
      personaFirmsTab(s, t, state, h, fmt) +
      /* 停用 / 恢复 —— 管理型对象必须有"下架"的路，否则过期画像只能一直挂着。
         停用是**移出检索池**（不再被 Agent 圈到），不是删除；列表里仍可见、可恢复。
         走 dangerConfirm：要权限 + 强制填理由（与「登记更新」同级的门禁）。 */
      /* 顺序即说明：定位 → 该更新了 → 停用/恢复。
         停用是生命周期末端，排在最后 —— 与知识库详情同一排法。 */
      (s.overdueDays > 0 ? '<div class="card"><div class="card-h"><h3>该更新了</h3>' +
        '<span class="card-sub">' + fmt.rel(s.updated) + '未更新 · 已超期 ' + s.overdueDays + ' 天</span></div>' +
        '<div class="bt-note">画像属性会漂移，超期画像不该继续作为投放依据。' +
        '重新采集与复核由负责人线下发起。</div>' +
        (refreshed
          ? '<div class="bt-note" style="margin-top:10px">已登记更新（' + h.esc(refreshed.reason) + ' · 预计' + h.esc(refreshed.eta) + ' · ' + h.esc(refreshed.by) + '）' +
            '　<button class="lnk warn" data-act="persona-refresh-undo" data-id="' + h.esc(s.id) + '">撤销登记</button></div>'
          : '<div class="gray-acts"><button class="btn-primary" data-act="persona-refresh" data-id="' + h.esc(s.id) + '">登记更新</button></div>') +
        '</div>' : '') +
      '<div class="card"><div class="card-h"><h3>' + (isDisabled ? '已停用' : '停用画像') + '</h3>' +
      '<span class="card-sub">' + (isDisabled
        ? '这条画像已被移出检索池，Agent / 策略圈选不会再用到它'
        : '停用后移出检索池；画像本身保留，可随时恢复') + '</span></div>' +
      '<div class="bt-note">' + (isDisabled
        ? '被引用 ' + fmt.int(s.refCount) + ' 次（历史值保留）。恢复后重新进入检索池，引用它的 Agent 会再次圈到这群人。'
        : '适用场景：口径过期、企业组织变动、画像被新版本取代。') + '</div>' +
      '<div class="gray-acts" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      (isDisabled
        ? '<button class="btn-ghost ok" data-act="persona-restore" data-id="' + h.esc(s.id) + '">恢复画像</button>'
        : '<button class="btn-ghost" data-act="persona-disable" data-id="' + h.esc(s.id) + '">停用画像</button>') +
      (isDisabled ? '<span class="pick-or">恢复同样会留审计</span>' : '') +
      '</div></div>';
    } else if (active === 'tags') {
      /* 每个标签下面给出「库内有多少画像共用它、合计被引用多少」——
         此前只重复写了一遍"标签"两个字，等于没有信息。
         v25c：标签补身份图标（与概览里的命中标签同一套，见 data.js 的 FIRM_TAG_ICON）。 */
      var lib = t.rows;
      body = '<div class="card"><div class="card-h"><h3>标签与口径</h3>' +
        '<span class="card-sub">' + s.tags.length + ' 个 · 每张卡下面写的是库内共用该标签的画像数与被引用合计</span></div>' +
        '<div class="ins-grid">' + s.tags.map(function (tg) {
          var share = lib.filter(function (x) { return (x.tags || []).indexOf(tg) >= 0; });
          var refs = share.reduce(function (a, x) { return a + x.refCount; }, 0);
          return '<div class="ins"><i>库内 ' + share.length + ' 个画像共用 · 合计被引用 ' + refs + ' 次</i><b>' + firmIco('tag', tg, h) + h.esc(tg) + '</b></div>';
        }).join('') + '</div>' +
        '<div class="bt-note">标签是检索与圈选的依据；<b>标签只是标签，不等于一个可投放的客群</b>。' +
        '口径（怎么算出来）、数据源、责任人、更新频率是标签资产化的必需品 —— ' +
        '标签字典待补。</div></div>';
    } else if (active === 'refs') {
      body = '<div class="card"><div class="card-h"><h3>被引用关系</h3>' +
        '<span class="card-sub">这个画像被哪几类东西用到</span></div>' +
        '<div class="kv">' +
        '<div><i>被引用次数</i><b>' + fmt.int(s.refCount) + ' 次 · ' + s.heatText + '</b></div>' +
        '<div><i>引用方类型</i><b>用户运营策略 / Agent</b></div>' +
        '</div>' +
        '<div class="sub-h">去引用方看明细</div>' +
        '<div class="gray-acts" style="display:flex;gap:8px;flex-wrap:wrap">' +
        ['user-ops|用户运营策略', 'agent-wb|Agent 工作台'].map(function (x) {
          var p = x.split('|');
          return '<button class="btn-ghost sm" data-act="goto-cap" data-id="' + p[0] + '">' + p[1] + ' →</button>';
        }).join('') + '</div>' +
        '<div class="bt-note" style="margin-top:12px">引用明细由各引用方自己维护（谁在什么条件下用了它），' +
        '画像库只记总数与分档。<b>分档只说明使用广度，不代表这群人值得投放。</b></div></div>';
    }

    /* 副标题此前写死 '企业用户画像 · ' —— 但本库同时装 ICP（哪类企业）与角色画像（哪个岗位的人）。
       于是「区域政务接口人」（kindText = 角色画像 · 守门人）被标成"企业用户画像"，
       而同一屏「画像定位」卡里的「画像类型」却正确显示角色画像 —— 页头与卡片自相矛盾。
       改用 s.kindText（与列表「类型」列、详情「画像类型」同一字段同一口径）。 */
    return shell(cap, state, h, s, h.esc(s.name), h.esc(s.kindText || 'ICP · 企业类型') + ' · ' + h.esc(s.statusText), TABS, active, body,
      /* 内容编辑入口放页头 —— 与「登记经验」/「新建画像」同一处习惯位置 */
      '<button class="btn-ghost" data-act="persona-edit-content" data-id="' + h.esc(s.id) + '">编辑画像内容</button>');
  };

  /* 停用画像 —— 管理型对象的「减」。走全站统一咽喉 dangerConfirm：
     权限 + 高危强制理由 + 影响面（全来自真实数字）+ 可恢复说明。 */
  (global.ACTIONS || (global.ACTIONS = {}))['persona-disable'] = function (id, btn, h) {
    var t = h.app.getAssetTables().persona;
    var s = byId(h, t.rows, id);
    if (!s) { h.toast('画像不存在', 'bad'); return; }
    var f = h.fmt;
    h.dangerConfirm(h, {
      title: '停用画像', desc: '把「' + s.name + '」移出检索池？',
      tone: 'danger', perm: 'persona:lifecycle:disable',
      impacts: [
        { label: '影响面', value: '该画像不再被 Agent / 策略圈选到', tone: 'danger' },
        { label: '被引用', value: f.int(s.refCount) + ' 次 · ' + (s.heatText || '—') + '（引用方会失去这个圈选依据）' },
        { label: '覆盖企业', value: f.int(s.ents) + ' 家（数据保留，仅不再参与圈选）' },
        { label: '负责人', value: s.owner || '—' },
        { label: '可恢复', value: '是' }
      ],
      requireReason: true, confirmText: '确认停用',
      action: '停用画像', target: s.id + ' · ' + s.name,
      auditImpact: '移出检索池',
      onConfirm: function (reason) {
        h.state.personaDisabled = h.state.personaDisabled || {};
        h.state.personaDisabled[s.id] = { reason: reason || '', by: (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : '我', at: '刚刚' };
        h.toast('已停用「' + s.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  (global.ACTIONS || (global.ACTIONS = {}))['persona-restore'] = function (id, btn, h) {
    var t = h.app.getAssetTables().persona;
    var s = byId(h, t.rows, id);
    if (!s) { h.toast('画像不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '恢复画像', desc: '把「' + s.name + '」放回检索池？',
      tone: 'warn', perm: 'persona:lifecycle:restore',
      impacts: [
        { label: '影响面', value: '重新进入检索池，引用它的 Agent / 策略会再次圈到这群人', tone: 'warn' },
        { label: '被引用', value: h.fmt.int(s.refCount) + ' 次（历史值）' },
        { label: '建议', value: '恢复前先确认画像口径仍准确，否则等于把过期依据放回投放链路' }
      ],
      requireReason: true, confirmText: '确认恢复',
      action: '恢复画像', target: s.id + ' · ' + s.name,
      auditImpact: '放回检索池',
      onConfirm: function (reason) {
        if (h.state.personaDisabled) delete h.state.personaDisabled[s.id];
        h.state.personaRestored = h.state.personaRestored || {};
        h.state.personaRestored[s.id] = { reason: reason || '', at: '刚刚' };
        h.toast('已恢复「' + s.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* ==================================================== 画像内容编辑 */
  /* 🔴 管理型缺的第四刀：画像此前只能改「状态」（停用/恢复）与「登记更新」，
     名称 / 类型 / 行业 / 负责人 / 标签**建完改不动**。
     圈选条件不单独编辑 —— 它是 data.js 按「行业 + 前两个标签」反推的，
     所以改行业/标签，条件会自动跟着变（改完在详情页能直接看到）。
     会话内状态 state.personaEdit[id] 覆盖显示；写库仍是演示边界，如实说明。 */
  var PERSONA_KIND_TXT = { icp: 'ICP 企业类型', role: '角色画像 · 守门人' };
  function personaEditSheet(h, s) {
    var KIND_OPTS = [['icp', 'ICP（哪类企业）'], ['role', '角色画像（哪个岗位的人）']];
    var ROLE_OPTS = ['发起者', '使用者', '影响者', '决策者', '守门人'];
    var IND_OPTS = ['制造', '零售', '金融', '政务', '电商', '互联网', '医疗', '教育'];
    var OWNER_OPTS = ['xianyu'];
    var TAG_POOL = ['采购委员会', '预算周期', '招标偏好', '私有化部署', '促销敏感', '巡店频次', '门店规模',
      '合规优先', 'POC 驱动', '多方比价', '政策口径', '审批路径', '汇报节奏', '价格敏感', '自助服务', '移动优先'];
    /* 预填：优先会话内已编辑值，否则取当前条目 */
    var e = (h.state.personaEdit || {})[s.id] || {};
    var v = {
      kind: e.kind || s.kind || 'icp',
      role: e.role != null ? e.role : (s.role || ''),
      name: e.name != null ? e.name : s.name,
      industry: e.industry != null ? e.industry : (s.industry || ''),
      owner: e.owner != null ? e.owner : (s.owner || ''),
      tags: e.tags || (s.tags || []).slice()
    };
    var segHtml = function (k, opts) {
      return '<div class="v15-pick" data-pk="' + k + '">' + opts.map(function (o) {
        return '<button type="button" data-pick="' + h.esc(o[0]) + '"' + (String(v[k]) === String(o[0]) ? ' class="on"' : '') + '>' + h.esc(o[1]) + '</button>';
      }).join('') + '</div>';
    };
    var selHtml = function (k, opts) {
      return '<select data-pk="' + k + '" style="width:100%">' +
        '<option value="">请选择…</option>' +
        opts.map(function (o) { return '<option value="' + h.esc(o) + '"' + (v[k] === o ? ' selected' : '') + '>' + h.esc(o) + '</option>'; }).join('') + '</select>';
    };
    var tagHtml = '<div class="v15-pick" data-pk="tags">' + TAG_POOL.map(function (t) {
      return '<button type="button" data-pick="' + h.esc(t) + '"' + (v.tags.indexOf(t) >= 0 ? ' class="on"' : '') + '>' + h.esc(t) + '</button>';
    }).join('') + '</div>';
    global.V10UI.openSheet({
      title: '编辑画像内容',
      bodyHtml: '<div class="bt-note" style="margin-bottom:12px">改动会影响 Agent / 策略的圈选依据。' +
        '圈选条件由「行业 + 标签」反推，不单独编辑 —— 改这两项条件会自动跟着变。</div>' +
        '<div class="v15-cf-sec">画像定位</div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">画像名称</label><input data-pk="name" value="' + h.esc(v.name || '') + '" style="width:100%"></div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">画像类型</label>' + segHtml('kind', KIND_OPTS) + '</div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">决策链角色<span class="muted" style="font-weight:400">（选「角色画像」时必填）</span></label>' + selHtml('role', ROLE_OPTS) + '</div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">所属行业</label>' + selHtml('industry', IND_OPTS) + '</div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">负责人</label>' + selHtml('owner', OWNER_OPTS) + '</div>' +
        '<div class="v15-cf-sec">画像构成 · 核心标签</div>' + tagHtml +
        '<div class="v10-reason" style="margin-top:10px"><label class="sub-h">备注（选填，随记录留档）</label>' +
        '<textarea data-pk="reason" placeholder="写明为什么改"></textarea>' +
        '<div class="err" data-v10="err" style="display:none" id="pe-err"></div></div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn-primary" data-v10="ok">保存（本会话）</button>',
      onOpen: function (root) {
        /* 段选 / 多选按钮：点一下切高亮（与公共表单件同一 DOM 约定） */
        root.addEventListener('click', function (ev) {
          var t = ev.target;
          var g = t.getAttribute && t.getAttribute('data-v10');
          if (g === 'cancel') { global.V10UI.closeSheet(); return; }
          var pk = t.getAttribute && t.getAttribute('data-pk');
          var val = t.getAttribute && t.getAttribute('data-pick');
          var grp = t.parentNode && t.parentNode.getAttribute && t.parentNode.getAttribute('data-pk');
          if (val != null && grp) {
            if (grp === 'tags') { t.classList.toggle('on'); return; }
            var all = t.parentNode.querySelectorAll('button');
            for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
            t.classList.add('on');
            return;
          }
          if (g !== 'ok') return;
          var rd = function (k) { var el = root.querySelector('[data-pk="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
          var name = rd('name'), industry = rd('industry'), owner = rd('owner'), reason = rd('reason');
          var kindBtn = root.querySelector('[data-pk="kind"] button.on');
          var kind = kindBtn ? kindBtn.getAttribute('data-pick') : 'icp';
          var role = rd('role');
          var tags = [];
          Array.prototype.forEach.call(root.querySelectorAll('[data-pk="tags"] button.on'), function (b) { tags.push(b.getAttribute('data-pick')); });
          var err = root.querySelector('#pe-err');
          var fail = function (msg) { if (err) { err.textContent = msg; err.style.display = 'block'; } };
          /* 校验与创建表单同标准（含条件必填：角色画像必须指定角色） */
          if (!name) return fail('画像名称必填');
          if (!industry) return fail('所属行业必填');
          if (!owner) return fail('负责人必填');
          if (kind === 'role' && !role) return fail('选了「角色画像」就要指定决策链角色（发起者/使用者/影响者/决策者/守门人）');
          if (!tags.length) return fail('至少要有一个核心标签 —— 圈选条件的标签部分由它反推');
          /* 2026-10-21：备注改选填，不再拦保存（业主：直接通过，留记录） */
          if (err) err.style.display = 'none';
          h.state.personaEdit = h.state.personaEdit || {};
          h.state.personaEdit[s.id] = {
            kind: kind, role: kind === 'role' ? role : null,
            name: name, industry: industry, owner: owner, tags: tags,
            reason: reason, at: '刚刚',
            by: (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : '我'
          };
          global.V10UI.closeSheet();
          h.toast('已保存「' + name + '」的内容改动', 'ok');
          h.navigate({}, { scroll: false });
        });
      }
    });
  }
  (global.ACTIONS || (global.ACTIONS = {}))['persona-edit-content'] = function (id, btn, h) {
    var t = h.app.getAssetTables().persona;
    var s = byId(h, t.rows, id);
    if (!s) { h.toast('画像不存在', 'bad'); return; }
    /* 门禁复用 dangerConfirm（它有现成的「权限不足」拦截层） */
    h.dangerConfirm(h, {
      title: '修改画像内容',
      desc: '进入「' + s.name + '」的内容编辑？改动会影响 Agent / 策略的圈选依据。',
      perm: 'persona:content:edit', requireReason: true, confirmText: '进入编辑',
      action: '编辑画像内容', target: s.id + ' · ' + s.name,
      auditImpact: '画像内容将可被修改',
      onConfirm: function () { personaEditSheet(h, s); }
    });
  };

  /* ==================================================== 经验正文编辑 */
  /* 🔴 管理型缺的第四刀：经验只有「复核 / 驳回 / 弃用 / 恢复」，**正文建完改不动**。
     正文四段是模型检索与人工评审的全部依据，发现写错了却只能弃用重登 —— 代价太大。
     复用 V15_CREATE['llm-exp'] 的字段定义（同一份配置，避免两处漂移）+ 预填当前值。
     会话内状态 state.expEdit[id] 覆盖显示；写库仍是演示边界，如实说明。 */
  function expEditSheet(h, s) {
    var CFG = (global.V15_CREATE || {})['llm-exp'];
    if (!CFG || !CFG.fields) { h.toast('编辑表单未接入', 'bad'); return; }
    var fmt = h.fmt;
    /* 字段值：优先取会话内已编辑值，否则取当前条目 —— 这就是"预填当前值" */
    var v = Object.assign({}, (h.state.expEdit || {})[s.id] || {}, {
      name: s.title, scene: s.scene, trigger: s.trigger, policy: s.policy,
      taboo: s.taboo, why: s.why, source: s.source
    });
    var exs = s.example || [];
    var FIELD = { name: '经验标题', scene: '适用场景', trigger: '触发条件', policy: '处置策略', taboo: '禁忌', why: '为什么值得沉淀' };
    var LONG = ['trigger', 'policy', 'taboo'];
    var rows = ['name', 'scene', 'trigger', 'policy', 'taboo', 'why'].map(function (k) {
      var ro = /^(trigger|policy|taboo)$/.test(k);
      return '<div class="v15-cf-row"><label class="v15-cf-label">' + FIELD[k] +
        (LONG.indexOf(k) < 0 && k !== 'why' ? '' : '') + '</label>' +
        (LONG.indexOf(k) >= 0
          ? '<textarea data-ex="' + k + '" rows="3" style="width:100%;font:inherit;padding:8px;border:1px solid #e6e9f0;border-radius:8px;resize:vertical">' + h.esc(v[k] || '') + '</textarea>'
          : '<input data-ex="' + k + '" value="' + h.esc(v[k] || '') + '" style="width:100%">') + '</div>';
    }).join('');
    var exRows = exs.map(function (e, i) {
      return '<div class="v15-cf-row"><label class="v15-cf-label">示例 ' + (i + 1) + ' · 用户说</label>' +
        '<input data-ex="egQ' + i + '" value="' + h.esc(e.q || '') + '" style="width:100%"></div>' +
        '<div class="v15-cf-row"><label class="v15-cf-label">示例 ' + (i + 1) + ' · 助手答</label>' +
        '<input data-ex="egA' + i + '" value="' + h.esc(e.a || '') + '" style="width:100%"></div>';
    }).join('');
    global.V10UI.openSheet({
      title: '编辑经验正文',
      bodyHtml: '<div class="bt-note" style="margin-bottom:12px">改动会对模型检索与人工评审同时生效。' +
        '正文四段就是这条经验的全部内容 —— 模型靠它检索，人靠它评审。</div>' +
        '<div class="v15-cf-sec">正文四段</div>' + rows +
        (exRows ? '<div class="v15-cf-sec">示例对话</div>' + exRows : '') +
        '<div class="v10-reason" style="margin-top:10px"><label class="sub-h">备注（选填，随记录留档）</label>' +
        '<textarea data-ex="reason" placeholder="写明为什么改"></textarea>' +
        '<div class="err" data-v10="err" style="display:none">理由必填</div></div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">取消</button>' +
        '<button class="btn-primary" data-v10="ok">保存（本会话）</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') { global.V10UI.closeSheet(); return; }
          if (g !== 'ok') return;
          var reason = String((root.querySelector('[data-ex="reason"]') || {}).value || '').trim();
          /* 2026-10-21：备注改选填，不再拦保存 */
          var nv = {};
          Array.prototype.forEach.call(root.querySelectorAll('[data-ex]'), function (el) {
            var k = el.getAttribute('data-ex');
            if (k !== 'reason') nv[k] = String(el.value || '').trim();
          });
          var nEx = [];
          exs.forEach(function (e, i) { nEx.push({ q: nv['egQ' + i] || '', a: nv['egA' + i] || '' }); });
          h.state.expEdit = h.state.expEdit || {};
          h.state.expEdit[s.id] = {
            name: nv.name, scene: nv.scene, trigger: nv.trigger, policy: nv.policy,
            taboo: nv.taboo, why: nv.why, example: nEx,
            reason: reason, at: '刚刚',
            by: (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : '我'
          };
          global.V10UI.closeSheet();
          h.toast('已保存「' + (nv.name || s.title) + '」的正文改动', 'ok');
          h.navigate({}, { scroll: false });
        });
      }
    });
  }
  (global.ACTIONS || (global.ACTIONS = {}))['exp-edit-content'] = function (id, btn, h) {
    var q = h.app.getQueues ? h.app.getQueues().experience : null;
    var s = byId(h, (q && q.items) || [], id);
    if (!s) { h.toast('经验条目不存在', 'bad'); return; }
    /* 门禁复用 dangerConfirm（它有现成的「权限不足」拦截层；checkPerm 返回的是 {ok,...} 不是布尔）。
       确认后再开编辑表单 —— 这样权限、留痕、理由三件事都走全站统一路径。 */
    h.dangerConfirm(h, {
      title: '修改经验正文',
      desc: '进入「' + (s.title || s.id) + '」的正文编辑？正文改动会同时影响模型检索与人工评审。',
      perm: 'llm-exp:entry:edit', requireReason: true, confirmText: '进入编辑',
      action: '编辑经验正文', target: s.id + ' · ' + (s.title || ''),
      auditImpact: '经验正文将可被修改',
      onConfirm: function () { expEditSheet(h, s); }
    });
  };

  /* 文档卡片 —— 「知识库 → 文档」的末端对象。
     此前文档在列表里只有元数据（9 列），**打不开**：看不到它写了什么、被谁用过。
     正文与切片**由既有字段确定性派生**（rngOf 按文档 id 取），不新增存储：
     换成真文档时，只要把 kbDocBody 接到真实解析结果，卡片不用改。 */
  /* 文档原文（条款体）。
     ⚠ 两条硬约束：
     ① **篇幅必须与文档标注的大小对得上** —— 一份 32 KB / 41 切片的文档，
        原文只有十几句话是自相矛盾的（走查：一个企业文档就这点字？）。
        目标字数 = sizeKB × 320（中文 1 字 ≈ 3 字节，32 KB ≈ 1.0 万字），
        夹在 2 千–2.6 万字之间。字数由文档 id 确定性推导，刷新不变。
     ② **章节之间不共用句子池**，且同一章节内条款也不重复（用 used 集合兜底）——
        之前 6 章同池随机取，同一句在多章重复出现，那不可能是原文。
     条款由「主体 + 时限 + 动作 + 留痕 + 后果」组合生成，这是制度类文本的真实句式。 */
  function kbDocBody(h, d) {
    var r = rngOf(h, 'kbdocbody|' + d.id);
    /* 全文真实字数 = 切片数 × 每片平均字符 —— 这是**与文档自身标注自洽**的推导：
       页面右边就摆着「切片 N 条」「平均字符 M」，两者相乘必须等于左边的全文字数，
       否则同一份文档在同一屏里出现两套规模（走查：内容与标注的数字不自洽）。
       之前用 sizeKB×320 推导，既与切片口径无关，又被 26000 上限截断（85% 的文档撞上限），
       于是标注 300 KB / 228 切片的文档，弹层写「全文约 1.9 万字」。 */
    var _sl = kbDocSlices(h, d);
    var _avg = Math.round(_sl.reduce(function (a, x) { return a + x.chars; }, 0) / Math.max(1, _sl.length));
    var FULL = Math.max(2000, Math.round((Number(d.slices) || 1) * _avg));
    /* 渲染上限：单页约 1400 字，42000 字 ≈ 30 页纸。
       超出只渲染前 30 页，并在标签上**写明是截断** —— 不能拿截断的量冒充全文。 */
    var RENDER = Math.min(FULL, 42000);
    var SEC = [
      { title: '目的与依据', role: 'purpose' },
      { title: '适用范围', role: 'scope' },
      { title: '术语与定义', role: 'terms' },
      { title: '职责分工', role: 'duty' },
      { title: '业务流程', role: 'flow' },
      { title: '审批权限', role: 'auth' },
      { title: '记录与归档', role: 'record' },
      { title: '检查与考核', role: 'audit' },
      { title: '例外与豁免', role: 'except' },
      { title: '附则', role: 'misc' }
    ];
    /* 五槽组合：主体 × 时限 × 动作 × 留痕 × 后果 —— 组合空间 7×6×7×5×4 = 5880，够用 */
    var WHO = ['归口部门', '业务部门', '经办人', '审批人', '内审部门', '法务', '财务'];
    var WHEN = ['自本文件生效之日起', '在业务受理后二个工作日内', '每季度末', '每年十二月', '遇外部规则调整时', '事项办结后五个工作日内'];
    var WHAT = ['核对材料齐备性', '完成合规性校验', '登记台账并留存凭证', '组织会签并出具结论', '复核执行偏差并跟踪整改', '更新条文并同步相关部门', '归档全过程记录'];
    var HOW = ['在系统中留痕', '并按表单模板填写', '并同步告知相关部门', '电子与纸质各存一份', '通过线上流程提交'];
    var CONS = ['未按要求执行的，按考核办法处理', '逾期未办的，视为默认通过并留痕备查',
      '材料不齐的，退回补正后重新走流程', '发生争议时以系统记录为准'];
    var LEAD = {
      purpose: '为规范相关业务的办理口径、明确执行边界，',
      scope: '本文件的适用范围按下列约定确定：',
      terms: '本文件使用的术语含义如下：',
      duty: '各相关方的职责划分如下：',
      flow: '业务办理按下列步骤执行：',
      auth: '审批权限按金额与风险分级设定：',
      record: '过程记录与归档要求如下：',
      audit: '检查、考核与追责安排如下：',
      except: '下列情形可作为例外处理：',
      misc: '其他未尽事项按下列约定执行：'
    };
    var used = {};
    function clause(role) {
      for (var t = 0; t < 60; t++) {
        var s = WHO[Math.floor(r() * WHO.length)] + WHEN[Math.floor(r() * WHEN.length)] +
          WHAT[Math.floor(r() * WHAT.length)] + HOW[Math.floor(r() * HOW.length)] +
          '；' + CONS[Math.floor(r() * CONS.length)] + '。';
        if (!used[s]) { used[s] = 1; return s; }
      }
      return null;   /* 组合撞满就停，不硬凑重复句 */
    }
    var out = [], total = 0;
    for (var si = 0; si < SEC.length && total < RENDER; si++) {
      var s = SEC[si];
      /* 每章的配额用**真实累计字数**收敛，不再用「62 字/条」估算 ——
         条款模板实际约 44 字，按 62 估只能产出目标的 73%，标签上的字数是假的。 */
      var quota = Math.round(RENDER * (si + 1) / SEC.length);
      var clauses = [LEAD[s.role]];
      total += LEAD[s.role].length;
      while (total < quota) {
        var c = clause(s.role);
        if (!c) break;
        clauses.push(c);
        total += c.length;
      }
      out.push({ title: s.title, body: clauses });
    }
    d._docChars = FULL;    /* 全文真实字数（上标签） */
    d._docShown = total;   /* 本次渲染出的字数（长了会截断） */
    return out;
  }
  function kbDocSlices(h, d) {
    var r = rngOf(h, 'kbslice|' + d.id);
    var out = [];
    var total = Math.min(6, d.slices || 1);
    for (var i = 0; i < total; i++) {
      out.push({ i: i + 1, chars: 180 + Math.floor(r() * 420), score: +(0.62 + r() * 0.36).toFixed(3) });
    }
    return out;
  }
  function kbDocHits(h, d) {
    var r = rngOf(h, 'kbhits|' + d.id);
    var QS = ['超过七天还能退货吗', '企业版能不能开专票', '2026 年数据出境新规怎么要求', '续费能不能打折',
      '上门服务覆盖哪些城市', '合同主体变更要走什么流程', '发票抬头能改吗', '保修期从哪天算'];
    var AG = ['知识问答 Agent', '客服助手 Agent', '合同初审 Agent', '标书生成 Agent', '合规问答 Agent'];
    var n = 2 + Math.floor(r() * 4);
    var out = [], seen = {};
    /* 去重：查询从 8 条池里独立抽取，不去重会在同一张表里出现两行同一句话
       （实测 200 篇抽样中 97 篇重复，接近一半）。同一查询只留一行。 */
    for (var i = 0; i < n * 3 && out.length < n; i++) {
      var q = QS[Math.floor(r() * QS.length)];
      if (seen[q]) continue;
      seen[q] = 1;
      out.push({
        q: q,
        agent: AG[Math.floor(r() * AG.length)],
        /* 「被**谁**用到」—— 谁是人。只给查询和 Agent 回答不了这个问题：
           一次检索是**某个人**发起的，Agent 只是执行者。 */
        who: DOC_OWNERS[Math.floor(r() * DOC_OWNERS.length) % DOC_OWNERS.length],
        /* 人的动作同样只有 点击 / 查询 / 下载 三种 */
        /* 人的动作同样是权限语义：查询无需权限；点开/下载有权限直达、否则先申请 */
        pAct: (function () { var a = ['点开', '查询', '下载'][Math.floor(r() * 3)]; if (a === '查询') return '查询 · 无需权限'; var x = r(); return a + ' · ' + (x < 0.68 ? '有权限，直达' : x < 0.86 ? '申请中' : x < 0.96 ? '已批准' : '已拒绝'); })(),
        hits: 3 + Math.floor(r() * 96),
        rank: 1 + Math.floor(r() * 3)
      });
    }
    return out;
  }
  (global.ACTIONS || (global.ACTIONS = {}))['kb-doc-open'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    var kbId = p[0], docId = p[1];
    var t = h.app.getAssetTables().kb;
    var kb = byId(h, t.rows, kbId) || resolveKb(h, kbId) || {};
    var docs = kbBaseDocs(h, kbId, kb.docCount != null ? kb.docCount : kb.docs).concat(kbUploads(h, kbId));
    var d = byId(h, docs, docId);
    if (!d) { h.toast('文档不存在', 'bad'); return; }
    var fmt = h.fmt;
    var secs = kbDocBody(h, d);
    var slices = kbDocSlices(h, d);
    var hits = kbDocHits(h, d);
    /* 状态只走唯一真源 kbDocStatus。
       这里原来另写了一张「status 字段 → 标签」的表，于是同一份上传文档
       （indexed:false / status:'indexed'）在桌面是「待索引」、在弹层是「已索引」；
       而且 ST.offline 是死代码 —— 下线只写 op.offline，从不把 status 改成 offline。 */
    var _st = kbDocStatus(d);
    var st = [_st.k, _st.t];

    global.V10UI.openSheet({
      title: d.name,
      wide: true,   /* 左原文 / 右分析 两栏，需要更宽 */
      bodyHtml:
        /* 左原文 / 右分析：原文是"这份文档写了什么"，分析是"它在检索里表现如何" ——
           两件事并排看才对照得起来（上下堆叠要来回滚）。
           文档信息（所属库/来源/时间/状态…）也归右栏 —— 它属于"关于这份文档的事实"，
           放在顶部横贯两栏会把原文挤下去，也让右栏显得空。 */
        '<div class="doc-2col">' +
        '<div class="doc-col doc-col-l">' +
        '<div class="sub-h">原文<span class="muted" style="font-weight:400;margin-left:8px">全文约 ' +
          (d._docChars >= 10000 ? (d._docChars / 10000).toFixed(1) + ' 万字' : Math.round(d._docChars / 1000) + ' 千字') +
          ' · ' + secs.length + ' 章' +
          (d._docShown < d._docChars
            ? ' · 此处显示前 ' + Math.round(d._docShown / 1000) + ' 千字（长文档按页截断）' : '') +
          '</span></div>' +
        docPages(h, secs) +
        '</div>' +
        '<div class="doc-col doc-col-r">' +
        '<div class="sub-h">文档信息</div>' +
        '<dl class="dl dl-inline">' +
        '<dt>所属知识库</dt><dd>' + h.esc(kb.name || kbId) + '</dd>' +
        '<dt>文档类型</dt><dd>' + docTypeIcon(h, d) + '</dd>' +
        '<dt>来源</dt><dd>' + h.esc(d.source) + '</dd>' +
        '<dt>大小 / 切片</dt><dd>' + h.esc(kbFmtSize(d.sizeKB)) + ' · ' + fmt.int(d.slices) + ' 条切片</dd>' +
        '<dt>更新时间</dt><dd>' + h.esc(fmt.rel(d.updatedDay)) + '</dd>' +
        '<dt>索引状态</dt><dd>' + h.pill(st[0], st[1]) + '</dd>' +
        '<dt>有效期</dt><dd>' + h.esc(d.validUntil) + '</dd>' +
        '<dt>责任人</dt><dd>' + h.esc(d.owner) + '</dd>' +
        '</dl>' +
        '<div class="sub-h" style="margin-top:16px">切片索引（抽样 ' + slices.length + ' / 共 ' + fmt.int(d.slices) + ' 条）</div>' +
        '<div class="doc-stat">' +
        '<span><i>切片</i><b>' + fmt.int(d.slices) + '</b></span>' +
        '<span><i>平均字符（抽样）</i><b>' + Math.round(slices.reduce(function (a, x) { return a + x.chars; }, 0) / Math.max(1, slices.length)) + '</b></span>' +
        '<span><i>最高得分（抽样）</i><b class="ok">' + Math.max.apply(null, slices.map(function (x) { return x.score; })).toFixed(3) + '</b></span>' +
        '<span><i>最低得分（抽样）</i><b class="' + (Math.min.apply(null, slices.map(function (x) { return x.score; })) < 0.7 ? 'warn' : '') + '">' +
          Math.min.apply(null, slices.map(function (x) { return x.score; })).toFixed(3) + '</b></span>' +
        '</div>' +
        '<div class="tbl-wrap"><table class="bt"><thead><tr><th>切片</th><th class="ta-r">字符数</th><th class="ta-r">最高检索得分</th></tr></thead><tbody>' +
        slices.map(function (s) {
          return '<tr><td class="mono">#' + s.i + '</td><td class="ta-r">' + s.chars + '</td><td class="ta-r">' +
            '<b class="' + (s.score >= 0.85 ? 'ok' : (s.score >= 0.7 ? '' : 'muted')) + '">' + s.score.toFixed(3) + '</b></td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="sub-h" style="margin-top:14px">这份文档被谁用到（近 7 天）</div>' +
        '<div class="tbl-wrap"><table class="bt"><thead><tr><th>发起人</th><th>动作</th><th>查询</th><th>命中 Agent</th><th class="ta-r">命中</th><th class="ta-r">位列</th></tr></thead><tbody>' +
        hits.map(function (x) {
          return '<tr><td class="kb-who">' + kbActorFace(h, { kind: 'person', name: x.who,
            _c: KB_SESSION.personColor ? KB_SESSION.personColor(x.who) : 1 }) +
            '<span>' + h.esc(x.who) + '</span></td>' +
            '<td><span class="pill idle">' + h.esc(x.pAct) + '</span></td>' +
            '<td>' + h.esc(x.q) + '</td><td>' + h.esc(x.agent) + '</td>' +
            '<td class="ta-r">' + fmt.int(x.hits) + '</td><td class="ta-r">Top ' + x.rank + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="bt-note">正文与切片按文档 id 确定性生成；命中记录来自检索日志口径。</div>' +
        '</div></div>' +
        /* 打开一篇文档就该看到「谁访问过它」——
           访问记录原来只藏在知识库详情的「检索统计」子页签里，看单篇文档时够不着。
           这里按**这篇文档**取记录（把 kb 的 id 拼上文档 id 作为记录的作用域键），
           不是整个库的记录。 */
        '<div style="margin-top:16px">' +
        kbAccessCard(h, kb, h.state, fmt, { docName: d.name }) +
        '</div>',
      footHtml: '<button class="btn-ghost" data-v10="cancel">关闭</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'cancel') global.V10UI.closeSheet();
        });
      }
    });
  };

  /* ==================================================== 知识库整库停用 / 恢复 */
  /* 此前知识库只有**文档级**下线，已发布的库无法整体下架 —— 管理型的「减」缺一层。
     停用 = 移出检索池（Agent 检索不再命中该库），文档/索引/配置全部保留，可恢复。
     照画像库已验证的范式（停用不是删除）。 */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-disable'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var f = h.fmt;
    h.dangerConfirm(h, {
      title: '停用知识库',
      desc: '把「' + kb.name + '」移出检索池？Agent 的检索将不再命中这个库。',
      tone: 'danger', perm: 'knowledge:kb:disable',
      impacts: [
        { label: '影响面', value: '该库不再参与检索 —— 依赖它的 Agent 会答不到原本能答的内容', tone: 'danger' },
        /* 影响面读**现算值**（与详情页同源），不读 seed 静态字段 */
        { label: '文档与索引', value: f.int(kbDocCount(h, kb)) + ' 个文档 / ' + f.int(kbIndexOf(h, kb).vectors) + ' 条向量，全部保留' },
        
        { label: '可恢复', value: '是' }
      ],
      requireReason: true, confirmText: '确认停用',
      action: '停用知识库', target: kb.id + ' · ' + kb.name,
      auditImpact: '移出检索池',
      onConfirm: function (reason) {
        h.state.kbDisabled = h.state.kbDisabled || {};
        h.state.kbDisabled[kb.id] = {
          reason: reason || '',
          by: (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : '我', at: '刚刚'
        };
        h.toast('已停用「' + kb.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  (global.ACTIONS || (global.ACTIONS = {}))['kb-restore'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '恢复知识库', desc: '把「' + kb.name + '」放回检索池？',
      tone: 'warn', perm: 'knowledge:kb:restore',
      impacts: [
        { label: '影响面', value: '重新参与检索，依赖它的 Agent 会再次命中这个库', tone: 'warn' },
        { label: '文档与索引', value: h.fmt.int(kbDocCount(h, kb)) + ' 个文档 / ' + h.fmt.int(kbIndexOf(h, kb).vectors) + ' 条向量' },
        { label: '建议', value: '恢复前先确认索引是最新的，否则等于把过期内容放回检索链路' }
      ],
      requireReason: true, confirmText: '确认恢复',
      action: '恢复知识库', target: kb.id + ' · ' + kb.name,
      auditImpact: '放回检索池',
      onConfirm: function (reason) {
        if (h.state.kbDisabled) delete h.state.kbDisabled[kb.id];
        h.state.kbRestored = h.state.kbRestored || {};
        h.state.kbRestored[kb.id] = { reason: reason || '', at: '刚刚' };
        h.toast('已恢复「' + kb.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* ==================================================== 知识库详情 */
  /* 🔴 C-4：把参数扫描的结论变成**能应用的配置** ——
     扫描出最优只是"看见"，应用才是"动作"，且必须留痕（参数留痕此前也没有）。 */
  /* ⚠ 这里**不能写 ACTIONS[...]** —— 本文件 var ACTIONS 的初始化在 L549，
     而此处是 L118，var 提升后仍是 undefined，会 TypeError。
     改为运行时按需取（文件内既有 ESM 风格写法同款）。 */
  /* 访问记录：卡片 / 列表切换 + 点开详情弹窗。
     都用「只改状态、不碰 hash」的重渲染 —— 知识库的 tab 不进 URL（见 buildHash 注释），
     走 navigate 会在老深链下把 tab 冲掉（实测踩过）。 */
  function kbRerender(h) {
    var hh = global.APP_SHELL;
    if (h.state.cap === 'knowledge' && hh && typeof hh.render === 'function') { hh.render(); return; }
    h.navigate({}, { scroll: false });
  }
  /* data-id = 「段|视图」（person|card / agent|list）——
     成员与 Agent 两段各有自己的视图，改一个不影响另一个。 */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-access-view'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var key = (p[0] === 'agent') ? 'kbAccViewAgent' : 'kbAccViewPerson';
    h.state[key] = (p[1] === 'list') ? 'list' : 'card';
    kbRerender(h);
  };
  /* 详情页返回上一级：回到本能力的列表页。
     ⚠ 路由器的「详情对象 id」字段是 **state.agentId**（名字叫 agentId，实际是通用的），
     state.obj 只是渲染层用的副本 —— 只清 obj 等于没清，hash 不会变（实测踩到）。 */
  (global.ACTIONS || (global.ACTIONS = {}))['ph-back'] = function (id, btn, h) {
    var p = String(id || '').split('|');
    h.navigate({ domain: p[0], cap: p[1], agentId: null, objId: null, obj: null,
      objTab: null, tab: null, traceId: null, page: 1 });
  };
  /* 审计视图开关：表格 / 热度 / 仅看被拒 */
  (global.ACTIONS || (global.ACTIONS = {}))['kb-access-audit'] = function (id, btn, h) {
    var p = String(id == null ? '' : id);
    if (p === 'table' || p === 'heat') { h.state.kbAccAuditView = p; }
    else if (p === 'denied') { h.state.kbAccOnlyDenied = !h.state.kbAccOnlyDenied; }
    kbRerender(h);
  };
  (global.ACTIONS || (global.ACTIONS = {}))['kb-access-open'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var kbId = p[0], kind = p[1], actorId = p[2];
    var s = resolveKb(h, kbId);
    if (!s) { h.toast('知识库不存在', 'bad'); return; }
    var all = kbAccessRows(h, s);
    var r = kbAccessDedup(all).filter(function (x) { return x.kind === kind && x.id === actorId; })[0];
    if (!r) { h.toast('该主体没有访问记录', 'warn'); return; }
    kbAccessSheet(s, r, all, h, h.fmt);
  };
  (global.ACTIONS || (global.ACTIONS = {}))['kb-param-apply'] = function (id, btn, h) {
    var p = String(id).split('|'), kbId = p[0], topK = Number(p[1]), th = Number(p[2]);
    var f = h.fmt;
    var before = (h.state.kbParam && h.state.kbParam[kbId]) || { topK: 5, th: 0.72 };
    var mB = Q.kbEvalMetrics ? Q.kbEvalMetrics(kbId, before.topK, before.th) : null;
    var mA = Q.kbEvalMetrics ? Q.kbEvalMetrics(kbId, topK, th) : null;
    h.dangerConfirm(h, {
      title: '应用检索参数',
      desc: '把该库的检索参数改为 top_k=' + topK + ' · 阈值=' + th.toFixed(2) + '？',
      tone: 'warn',
      perm: 'knowledge:index:rebuild',
      impacts: [
        { label: '参数变化', value: 'top_k ' + before.topK + ' → ' + topK + '　阈值 ' + before.th.toFixed(2) + ' → ' + th.toFixed(2), tone: 'warn' },
        { label: 'ContextPrecision', value: (mB ? f.pct1(mB.contextPrecision) : '—') + ' → ' + (mA ? f.pct1(mA.contextPrecision) : '—') },
        { label: 'ContextRecall', value: (mB ? f.pct1(mB.contextRecall) : '—') + ' → ' + (mA ? f.pct1(mA.contextRecall) : '—') },
        { label: '过阈值率', value: (mB ? f.pct1(mB.passRate) : '—') + ' → ' + (mA ? f.pct1(mA.passRate) : '—') },
        { label: '评测依据', value: '示例评测集 ' + f.int((mB && mB.cases) || 0) + ' 条 · 门槛 30 条（确定性打分）' },
        { label: '副作用', value: '阈值降低会召回更多但可能带入不相关切片；top_k 抬高会增加 token 与延迟' },
        { label: '可回滚', value: '是 —— 参数变更留痕，可回退到原组合' }
      ],
      requireReason: true,
      confirmText: '确认应用',
      action: '应用检索参数', target: kbId + ' · top_k=' + topK + ' th=' + th.toFixed(2),
      auditImpact: '检索参数 top_k ' + before.topK + '→' + topK + ' / 阈值 ' + before.th.toFixed(2) + '→' + th.toFixed(2),
      onConfirm: function (reason) {
        h.state.kbParam = h.state.kbParam || {};
        h.state.kbParam[kbId] = { topK: topK, th: th, at: new Date().toISOString(), reason: reason || '',
          by: (global.V19GOV && global.V19GOV.me) ? global.V19GOV.me().name : '我' };
        /* 参数留痕（第21屏问题3：此前无参数留痕）——append-only，不覆盖历史 */
        h.state.kbParamHistory = h.state.kbParamHistory || {};
        h.state.kbParamHistory[kbId] = (h.state.kbParamHistory[kbId] || []).concat([{
          at: new Date().toISOString(), from: before, to: { topK: topK, th: th }, reason: reason || ''
        }]);
        if (global.V19GOV && global.V19GOV.auditDecide) {
          global.V19GOV.auditDecide({ decision: '应用检索参数', title: kbId, target: kbId, reason: reason || '' });
        }
        h.toast('已应用：top_k=' + topK + ' · 阈值=' + th.toFixed(2) + '（参数留痕已记录）', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  R.kbDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var t = h.app.getAssetTables().kb;
    var s = byId(h, t.rows, state.objId || state.agentId);
    /* 会话新建的草稿库不在资产表里 —— 不兜底的话点进去是「对象不存在」，
       而列表里明明看得见（"能看见却点不动"那一族）。只在查不到时兜，避免改变既有字段形状。 */
    if (!s) {
      var fallback = resolveKb(h, state.objId || state.agentId);
      if (fallback) s = fallback;
    }
    if (!s) return h.detailMissing(cap, state, h);
    /* 会话内停用的库：页头、概览卡与停用区都要跟着变 */
    var _kbOff = (h.state && h.state.kbDisabled && h.state.kbDisabled[s.id]) || null;
    if (_kbOff) {
      s = Object.assign({}, s, { status: 'disabled', statusText: '已停用', isDisabled: true, heatText: '已移出检索池' });
    }
    var active = state.objTab || state.tab || 'overview';
    /* v27：**「文档」并入「概览」** —— 用户要求"文档和概览放一起"。
       理由：文档是这个库的主体，进去第一件事就是看里面有什么；
       把它藏在第二个 Tab 后面等于每次多点一次。配置类（索引 / 停用）退到文档之后。 */
    var TABS = [
      { key: 'overview', label: '概览' },
      { key: 'search', label: '检索统计' }
    ];
    var body = '';

    if (active === 'overview' || active === 'docs' || active === 'index') {
      /* 老链接 ?tab=docs 仍要能用：不报错，直接落到合并后的概览 */
      body = '<div class="metrics">' + [
        { label: '文档数', value: fmt.int(kbDocCount(h, s)), sub: '在服务文档 · 已入库' },
        /* 向量条数只走会话态索引（与文档卡头、索引管理同源）——
           读静态 s.chunks 的话，上传或回滚后会与同屏其它处置不一致。 */
      { label: '向量条数', value: fmt.int(kbIndexOf(h, s).vectors), sub: h.esc(s.chunkSize) + ' token/片 · 重叠 ' + h.esc(s.overlap) },
        { label: '被引用', value: fmt.int(s.refAgents), sub: '个 Agent 引用' },
        { label: '周命中', value: fmt.int(s.hits), sub: '检索命中次数' }
      ].map(h.metricCard).join('') + '</div>' +
      (_kbOff ? '<div class="alert-banner warn"><b>⚠ 本会话已停用该知识库</b><span>' +
        '停用人 ' + h.esc((_kbOff.by || '我')) + ' · 理由：' + h.esc(_kbOff.reason || '—') +
        '</span><span class="hint">已移出检索池：Agent 检索不再命中它。文档与索引全部保留，可随时恢复。</span></div>' : '') +
      /* 文档（主体）放在配置之前：顺序即"先看内容，再看怎么配" */
      kbDocsTab(h, s) +
      /* 2026-10-21 业主：「合在一起」—— 索引配置 / 当前索引版本 / 版本历史 / 停用
         原来是四张卡（四道边框四份留白），读起来像四件互不相干的事；
         其实它们回答同一个问题：**这个库的索引现在是什么样、怎么配的、走过哪几版。**
         合成一张，内部按「现状 → 构型 → 历史 → 停用」排。 */
      (function () {
        var ip = kbIndexParts(h, s);
        return '<div class="card" data-static="1" title="只读说明：本卡是索引的现状与配置汇总；重建 / 回滚在「当前索引」一节，停用在最末一节。">' +
          '<div class="card-h"><h3>索引与状态</h3>' +
          '<span class="card-sub">' + ip.sub + '</span></div>' +
          '<div style="padding:0 14px 14px">' + ip.banner +

          /* 业主：「明显可以一个放左一个放右」—— 两组字段左右并排，窄屏自动塌成单列 */
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">' +
            '<div><div class="sub-h" style="margin:2px 0 8px">当前索引</div>' + ip.current + '</div>' +
            '<div><div class="sub-h" style="margin:2px 0 8px">索引配置</div>' +
              kvCol([
                ['切片策略', h.esc(s.chunkSize) + ' token / 重叠 ' + h.esc(s.overlap)],
                ['向量模型', h.esc(s.embed)],
                ['最近同步', h.esc(fmt.rel(s.lastSyncText))],
                ['状态', h.pill(s.status, s.statusText)]
              ]) + '</div>' +
          '</div>' + ip.actions +

          '<div class="sub-h" style="margin:18px 0 8px">版本历史</div>' + ip.history +

          '<div class="sub-h" style="margin:18px 0 8px">' + (s.isDisabled ? '已停用' : '停用') + '</div>' +
          '<div class="bt-note" style="margin:0 0 10px">' + (s.isDisabled
            ? '恢复后重新参与检索：依赖它的 Agent 会再次命中这个库。'
            : '停用后移出检索池，文档与索引全部保留、可随时恢复。适用场景：口径过期要重做、库被新版本取代、临时下线避免答错。') + '</div>' +
          /* 业主：「这个是不是右移，红色」—— 与上面那排动作同一竖线，并且它是破坏性动作，用红按钮 */
          '<div class="gray-acts" style="justify-content:flex-end">' +
          (s.isDisabled
            ? '<button class="btn-ghost ok" data-act="kb-restore" data-id="' + h.esc(s.id) + '">恢复知识库</button>'
            : '<button class="btn-danger" data-act="kb-disable" data-id="' + h.esc(s.id) + '">停用知识库</button>') +
          '</div></div></div>';
      })();
    } else if (active === 'search') {
      /* 🔴 C-4（第21屏问题①②③）：
         此前这个页签**只有两个数**（周命中 / 零结果率）+ 一行静态文案 ——
         都对"排错"无感：它们回答不了「检索得对不对」，也没有评测集可以定量比较参数。
         现在补：① RAGAS 检索侧四项指标 ② 示例评测集（KB_EVAL 30 条）
               ③ **参数扫描**——同一评测集跑 4×4 组参数，选出最优并可一键应用。 */
      var curTopK = (h.state.kbParam && h.state.kbParam[s.id] && h.state.kbParam[s.id].topK) || 5;
      var curTh = (h.state.kbParam && h.state.kbParam[s.id] && h.state.kbParam[s.id].th != null) ? h.state.kbParam[s.id].th : 0.72;
      var em = Q.kbEvalMetrics ? Q.kbEvalMetrics(s.id, curTopK, curTh) : null;
      /* 零结果率三档与列表页同一个真源 —— 原来这里硬编码两档（只判 0.05），
         同一个库于是列表页判「注意」、详情页写「正常」（实测 5 库里 3 个不一致）。 */
      var zWarn = (global.DECISIONS && global.DECISIONS.value) ? global.DECISIONS.value('知识库检索', '零结果率_告警', 0.05) : 0.05;
      var zNotice = +(zWarn * 0.6).toFixed(4);
      body = '<div class="metrics">' + [
        { label: '周命中', value: fmt.int(s.hits), sub: '检索命中' },
        { label: '零结果率', value: fmt.pct1(s.zeroRate), alert: s.zeroRate >= zWarn, sub: s.zeroRate >= zWarn ? '内容缺口（≥ ' + fmt.pct1(zWarn) + '）' : (s.zeroRate >= zNotice ? '注意（≥ ' + fmt.pct1(zNotice) + '）' : '正常') },
        { label: 'ContextPrecision', value: em ? fmt.pct1(em.contextPrecision) : '—', sub: em ? '命中切片中相关的比例' : '无评测集' },
        { label: 'ContextRecall', value: em ? fmt.pct1(em.contextRecall) : '—', sub: em ? '召回的相关切片 ÷ 应有相关切片' : '无评测集' },
        { label: '查询词覆盖度', value: em ? fmt.pct1(em.contextEntityRecall) : '—', sub: em ? '查询词在库内的覆盖（与 top_k/阈值无关）' : '无评测集' },
        { label: 'ContextRelevance', value: em ? em.contextRelevance.toFixed(3) : '—', sub: em ? '过阈值切片平均相似度' : '无评测集' }
      ].map(h.metricCard).join('') + '</div>' +

      /* 访问记录紧跟指标卡 —— 它是「谁在用什么」的现状，比调参表更该先看到。
         （此前为了不挤掉调参表把它放到末尾，但那样"谁在访问"要滚到底才看得到。） */
      kbAccessCard(h, s, state, fmt) +

      '<div class="card"><div class="card-h"><h3>检索健康 · 参数扫描</h3>' +
      '<span class="card-sub">' + (em ? '当前 top_k=' + curTopK + ' · 阈值=' + curTh.toFixed(2) + ' · 过阈值率 ' + fmt.pct1(em.passRate) : '无评测集') + '</span></div>' +
      (function () {
        var sw = Q.kbParamSweep ? Q.kbParamSweep(s.id) : null;
        if (!sw || !sw.grid.length) return '<div class="bt-note">该库没有评测集条目 —— 无法定量比较参数。真实系统必须先建评测集。</div>';
        var tb = h.table({
          columns: [
            { key: 'topK', label: 'top_k', align: 'right' },
            { key: 'th', label: '阈值', align: 'right', render: function (r) { return r.th.toFixed(2); } },
            { key: 'prec', label: 'Precision', align: 'right', render: function (r) { return fmt.pct1(r.metrics.contextPrecision); } },
            { key: 'rec', label: 'Recall', align: 'right', render: function (r) { return fmt.pct1(r.metrics.contextRecall); } },
            { key: 'pass', label: '过阈值率', align: 'right', render: function (r) { return fmt.pct1(r.metrics.passRate); } },
            { key: 'score', label: '综合分', align: 'right', render: function (r) {
                var best = sw.best && r.topK === sw.best.topK && r.th === sw.best.th;
                return '<b class="' + (best ? 'ok' : '') + '">' + r.score.toFixed(3) + '</b>' + (best ? '　最优' : '');
              } },
            { key: 'act', label: '', render: function (r) {
                var isCur = (r.topK === curTopK && Math.abs(r.th - curTh) < 1e-9);
                return isCur
                  ? '<span class="pill ok">当前</span>'
                  : '<button class="lnk" data-act="kb-param-apply" data-id="' + h.esc(s.id) + '|' + r.topK + '|' + r.th + '">应用</button>';
              } }
          ],
          rows: sw.grid, noPaging: true, emptyTitle: '没有可比的参数组合',
          emptyTitle: '无可用参数组合'
        });
        return tb +
          '<div class="bt-warn">' +
          (sw.best ? '综合分最高：<b>top_k=' + sw.best.topK + ' · 阈值=' + sw.best.th.toFixed(2) + '</b>（' + sw.best.score.toFixed(3) + '）' +
            (sw.baseline && (sw.best.topK !== sw.baseline.topK || Math.abs(sw.best.th - sw.baseline.th) > 1e-9)
              ? '　当前基线（5 / 0.72）综合分 ' + sw.baseline.score.toFixed(3) +
                '，提升 ' + ((sw.best.score - sw.baseline.score) * 100).toFixed(1) + ' 个点'
              : '　（当前即为最优）')
            : '无最优解') +
          '<br><b>口径说明</b>：Precision / Recall / Relevance 取 RAGAS 检索侧定义；' +
          'EntityRecall 以「查询词在命中切片上的覆盖」**近似**，非原文口径。' +
          '<br><b>数据性质</b>：示例评测集（' + fmt.int(em.cases) + ' 条）+ 确定性打分 —— 换参数分数会真的变。' +
          (!em || !em.passCases ? '<br>⚠ 当前参数下没有任何查询过阈值 —— Agent 会全部走兜底话术。' : '') +
          '</div>';
      })() + '</div>';
    }

    return shell(cap, state, h, s, h.esc(s.name), '企业知识库 · ' + h.esc(s.statusText), TABS, active, body);
  };

  /* ==================================================== 经验详情
   * 按生产规格 §2.3 的 6 个 Tab 组织：经验正文 / 效果数据 / 关联 badcase / 版本与灰度 / 审核操作 / 引用 Agent。
   * 正文四段（触发条件 · 处置策略 · 禁忌 · 示例对话）是这一屏的主体 ——
   * 此前详情页只有 4 个数字 + 3 个字段，通篇没有"经验"本身。
   */
  R.expDetail = function (cap, state, h) {
    var fmt = h.fmt;
    var q = h.app.getQueues ? h.app.getQueues().experience : null;
    var items = (q && q.items) || [];
    var s = byId(h, items, state.objId || state.agentId);
    if (!s) return h.detailMissing(cap, state, h);

    /* 会话内状态覆盖（列表里通过 / 驳回 / 弃用后，详情页要跟着变） */
    var _ov = (state && state.expOps) || {};
    var ov = _ov[s.id];
    if (ov === 'verified') s = Object.assign({}, s, { status: 'ok', statusText: '已复核通过' });
    else if (ov === 'rejected') s = Object.assign({}, s, { status: 'bad', statusText: '已驳回' });
    else if (ov === 'deprecated') s = Object.assign({}, s, { status: 'deprecated', statusText: '已弃用' });
    /* 会话内正文编辑覆盖 —— 不接这一步，编辑动作就只是"存了个值但页面没变"，
       用户会以为没保存成功（与前面修过的"显示与真值脱钩"同一族）。 */
    var _ed = (state && state.expEdit) || {};
    var ed = _ed[s.id];
    if (ed) {
      s = Object.assign({}, s, {
        title: ed.name || s.title, scene: ed.scene || s.scene,
        trigger: ed.trigger, policy: ed.policy, taboo: ed.taboo, why: ed.why,
        example: ed.example && ed.example.length ? ed.example : s.example,
        editedInSession: true, editReason: ed.reason, editedBy: ed.by
      });
    }

    var S2 = h.seed || {};
    var agentById = {};
    (S2.AGENTS || []).forEach(function (a) { agentById[a.id] = a; });
    var aName = function (id) { var a = agentById[id]; return a ? a.name : (id || '—'); };

    var isShared = s.scope === 'shared';
    var ownerTxt = isShared
      ? '共享 · ' + ((s.agents || []).length) + ' 个 Agent 可用'
      : '私有 · ' + aName(s.ownerAgent);
    var ev = s.evidence || {}, fb = s.feedback || {};
    var judgement = s.status === 'deprecated' ? { kind: 'idle', text: '已弃用（可恢复）' }
      : (s.status === 'bad' ? { kind: 'bad', text: '已驳回（不进检索池）' }
        : (s.status === 'warn'
          ? ((s.gain != null && s.gain < 2) ? { kind: 'bad', text: '待复核 · 建议弃用' } : { kind: 'warn', text: '待复核' })
          : (s.gain != null && s.gain < 2 ? { kind: 'bad', text: '建议弃用' } : (s.gain != null && s.gain >= 5 ? { kind: 'ok', text: '建议继续用' } : { kind: 'ok', text: '可继续用' }))));

    var active = state.objTab || state.tab || 'content';
    /* 兼容旧深链：#/insight/llm-exp/ex-3/overview|gain|agents */
    if (active === 'overview') active = 'content';
    if (active === 'gain') active = 'effect';
    if (active === 'agents') active = 'refs';

    var TABS = [
      { key: 'content', label: '经验正文' },
      { key: 'effect', label: '效果数据' },
      { key: 'cases', label: '关联 badcase', badge: (s.badcases || []).length },
      { key: 'version', label: '版本与灰度', badge: (s.versions || []).length },
      { key: 'review', label: '审核操作' },
      { key: 'refs', label: '引用 Agent', badge: (s.agents || []).length }
    ];
    var body = '';

    /* ---------- ① 经验正文（四段） ---------- */
    if (active === 'content') {
      var exs = s.example || [];
      var exampleCard = '<div class="card" data-static="1" title="只读说明：示例对话是经验的边界说明（文本）；改它走「编辑正文」，用它去看「引用 Agent」页签。"><div class="card-h"><h3>示例对话</h3>' +
        '<span class="card-sub">' + exs.length + ' 组 · 模型和评审都按这个理解边界</span></div>' +
        (exs.length ? exs.map(function (e, i) {
          return '<div class="bt-note"' + (i ? ' style="margin-top:10px"' : '') + '>' +
            '<b>用户</b>：' + h.esc(e.q) + '<br><b>助手</b>：' + h.esc(e.a) + '</div>';
        }).join('') : '<div class="bt-note">还没写示例对话 —— 缺了它，模型只能猜这条经验的边界。</div>') + '</div>';

      var conflictHtml = (s.conflicts || []).length ? '<div class="alert-banner warn"><b>⚠ 与另一条经验冲突</b><span>' +
        (s.conflicts || []).map(function (c) {
          var other = byId(h, items, c.withId) || {};
          return '与「' + h.esc(other.title || c.withId) + '」：' + h.esc(c.point);
        }).join('；') + '</span>' +
        '<span class="hint">两条同时被检索命中时模型会挑错的那条，需要指定以哪条为准。</span></div>' : '';

      body = '<div class="metrics">' + [
        { label: '状态', value: s.statusText, sub: '结论：' + judgement.text },
        { label: '归属', value: isShared ? '共享' : '私有', sub: ownerTxt },
        { label: '收益分', value: fmt.num1(s.gain), sub: '证据 支持 ' + (ev.support || 0) + ' / 反例 ' + (ev.contradict || 0) },
        { label: '最近使用', value: s.lastUsedDay == null ? '—' : fmt.rel(s.lastUsedDay), alert: s.lastUsedDay <= -30, sub: s.lastUsedDay <= -30 ? '久未使用，考虑淘汰' : '正常' }
      ].map(h.metricCard).join('') + '</div>' +
        (s.editedInSession ? '<div class="alert-banner warn"><b>⚠ 正文已在本会话被修改</b><span>' +
          '改动人 ' + h.esc(s.editedBy || '我') + ' · 理由：' + h.esc(s.editReason || '—') +
          '</span><span class="hint">仅本会话生效、刷新还原；正式环境需走评审后重新进入检索池。</span></div>' : '') +
        conflictHtml +
        '<div class="card" data-static="1" title="只读说明：经验正文段落（文本内容），出口是下方「这条经验去哪查」。「编辑正文」是唯一的写入口。"><div class="card-h"><h3>触发条件</h3><span class="card-sub">什么情况下该用它</span></div>' +
        '<div class="bt-note">' + h.esc(s.trigger || '—') + '</div></div>' +
        '<div class="card" data-static="1" title="只读说明：经验正文段落（文本内容），出口是下方「这条经验去哪查」。「编辑正文」是唯一的写入口。"><div class="card-h"><h3>处置策略</h3><span class="card-sub">具体怎么做</span></div>' +
        '<div class="bt-note">' + h.esc(s.policy || '—') + '</div></div>' +
        '<div class="card" data-static="1" title="只读说明：经验正文段落（文本内容），出口是下方「这条经验去哪查」。「编辑正文」是唯一的写入口。"><div class="card-h"><h3>禁忌</h3><span class="card-sub">什么情况下不能用 —— 这段最容易被忽略，也最容易出事</span></div>' +
        '<div class="bt-note">' + h.esc(s.taboo || '—') + '</div></div>' +
        exampleCard +
        /* v31：正文四段（触发条件 / 处置策略 / 禁忌 / 示例对话）此前是**只读死路** ——
           读完一条处置策略，没有任何入口知道"谁在用它、用出什么结果"。
           出口①：切到「引用 Agent」页签（该页签已有真实清单与逐个 Agent 的近 7 天指标）；
           出口②：到可观测筛出归属 Agent 的真实调用明细（agent-traces 写 filters.agentId，检索页真读）。 */
        '<div class="card"><div class="card-h"><h3>这条经验去哪查</h3>' +
        '<span class="card-sub">正文是只读的；下面两条是它的去向</span></div>' +
        '<div class="gray-acts" style="display:flex;gap:8px;flex-wrap:wrap">' +
        ((s.agents || []).length
          ? '<button class="btn-ghost sm" data-v10-tab="refs">引用它的 Agent 清单（' + (s.agents || []).length + '）→</button>'
          : '<span class="pick-or">还没有 Agent 引用这条经验 —— 它不在任何检索池里</span>') +
        (s.ownerAgent
          ? '<button class="btn-ghost sm" data-act="agent-traces" data-id="' + h.esc(s.ownerAgent) + '">看归属 Agent 的调用明细 →</button>'
          : '') +
        '</div>' +
        '<div class="bt-note" style="margin-top:10px">检索页没有「按经验条目筛选」的维度，' +
        '所以调用明细按归属 Agent（' + h.esc(aName(s.ownerAgent)) + '）收敛；「效果数据」页签里的最近检索记录能看到逐条采纳情况。</div></div>' +
        '<div class="card"><div class="card-h"><h3>登记信息</h3></div><div class="kv">' +
        '<div><i>来源</i><b>' + h.esc(s.source) + '</b></div>' +
        '<div><i>复核人</i><b>' + (s.reviewer ? h.esc(s.reviewer) : '<span class="muted">未分配</span>') + '</b></div>' +
        '<div><i>版本</i><b>' + h.esc(((s.versions || [])[0] || {}).v || '—') + '</b></div>' +
        '</div></div>';
    }

    /* ---------- ② 效果数据 ---------- */
    else if (active === 'effect') {
      var trend = s.gainTrend || [];
      /* 🔴 C-5：p 不再读 s.ab.p（那是"存的值"，实测有 1 条与计数矛盾、结论会翻转），
       改为**由 control/treat/sample 现场派生**。s.ab.p 只作为"原记录值"展示以便比对。 */
    var ab = s.ab || null;
    var abD = (ab && Q.abDerived) ? Q.abDerived(ab) : null;
      var abHtml = ab ? '<div class="card"><div class="card-h"><h3>采纳前后转化对比</h3>' +
        '<span class="card-sub">' + (abD
        ? (abD.significant ? '差异显著（派生 p ≤ 0.05）' : '未达显著 —— 不能当结论用（派生 p = ' + abD.pDerived.toFixed(3) + '）')
        : '无法判定 —— 缺少样本量或计数') + '</span></div>' +
      (abD && abD.flipped
        ? '<div class="bt-note" style="border-color:#dc2626;color:#dc2626">' +
          '🔴 <b>数据质量问题</b>：本条原记录的 p = ' + abD.pStored + '（据此会显示"' +
          (abD.storedSignificant ? '显著' : '不显著') + '"），但由 control / treat / sample 派生的 p = ' +
          abD.pDerived.toFixed(3) + '（<b>' + (abD.significant ? '显著' : '不显著') + '</b>）—— ' +
          '<b>结论会翻转</b>。界面已改为以派生值为准，原值保留供比对。</div>'
        : '') +
        '<div class="metrics">' + [
          { label: '未采纳（对照）', value: fmt.pct1(ab.control), sub: '对照组转化率' },
          { label: '已采纳（实验）', value: fmt.pct1(ab.treat), sub: '实验组转化率' },
          { label: '绝对提升', value: ((ab.treat - ab.control) >= 0 ? '+' : '') + ((ab.treat - ab.control) * 100).toFixed(1) + 'pp', alert: ab.treat < ab.control, sub: ab.treat >= ab.control ? '采纳后更好' : '采纳后更差，要警惕' },
          { label: '样本量', value: fmt.int(ab.sample), sub: abD
            ? (abD.sampleSemantics.split('（')[0] + '　z = ' + abD.z.toFixed(2) + '　p = ' + abD.pDerived.toFixed(4) +
               (abD.pStored != null && Math.abs(abD.pStored - abD.pDerived) > 0.001
                 ? '　（原记录写的是 ' + abD.pStored + '）' : ''))
            : '缺少计数，无法派生 p' }
        ].map(h.metricCard).join('') + '</div></div>' : '';

      var uses = s.usageRecent || [];
      body = '<div class="metrics">' + [
        { label: '被检索', value: fmt.int(s.searches), sub: '累计次数（不按时间切片）' },
        { label: '命中率', value: fmt.pct1(s.hitRate), sub: '检索到后被采纳的比例' },
        { label: '收益分', value: fmt.num1(s.gain), sub: 'A/B 对照折算' },
        { label: '正向 / 反向反馈', value: (fb.up || 0) + ' / ' + ((fb.down || 0) + (fb.wrong || 0)), alert: (fb.wrong || 0) > 0, sub: '反向反馈是第二条淘汰依据' }
      ].map(h.metricCard).join('') + '</div>' +
        abHtml +
        (trend.length ? '<div class="card"><div class="card-h"><h3>收益分趋势</h3>' +
          '<span class="card-sub">近 ' + trend.length + ' 周 · 末位 = 当前 ' + fmt.num1(s.gain) + '</span></div>' +
          '<div class="mini-bars tall">' + trend.map(function (v) {
            var max = Math.max.apply(null, trend) || 1;
            return '<div class="mb"><i style="height:' + ((v / max) * 100).toFixed(1) + '%"></i><span>' + v.toFixed(1) + '</span></div>';
          }).join('') + '</div>' +
          (trend[0] > trend[trend.length - 1] ? '<div class="bt-note">收益分在往下走（' + fmt.num1(trend[0]) + ' → ' + fmt.num1(trend[trend.length - 1]) + '），建议先复核再决定留不留。</div>' : '') +
          '</div>' : '') +
        '<div class="card pad0"><div class="card-h pad"><h3>最近检索记录</h3>' +
        '<span class="card-sub">谁在什么时候用过它、有没有被采纳</span></div>' +
        h.table({
          columns: [
            { key: 'day', label: '时间', render: function (r) { return fmt.rel(r.day); } },
            { key: 'agentId', label: '检索它的 Agent', render: function (r) { return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(aName(r.agentId)) + '</button>'; } },
            { key: 'adopted', label: '结果', render: function (r) { return r.adopted ? h.pill('ok', '被采纳') : h.pill('warn', '未采纳'); } }
          ],
          rows: uses, noPaging: true,
          emptyTitle: '没有使用记录', emptySub: '这条经验还没有被任何 Agent 检索到'
        }) + '</div>';
    }

    /* ---------- ③ 关联 badcase ---------- */
    else if (active === 'cases') {
      var cs = s.badcases || [];
      body = '<div class="card pad0"><div class="card-h pad"><h3>这条经验从哪些案例提炼而来</h3>' +
        '<span class="card-sub">' + cs.length + ' 条 · 案例可回溯到具体 Agent</span></div>' +
        h.table({
          columns: [
            { key: 'title', label: '案例', render: function (r) { return '<b>' + h.esc(r.title) + '</b><div class="td-sub mono">' + h.esc(r.id) + '</div>'; } },
            { key: 'reason', label: '失败原因', render: function (r) { return h.pill(r.reason === '幻觉' ? 'bad' : (r.reason === '合规误杀' ? 'warn' : 'info'), r.reason); } },
            { key: 'agentId', label: '所属 Agent', render: function (r) { return '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(r.agentId) + '">' + h.esc(aName(r.agentId)) + '</button>'; } },
            { key: 'day', label: '发生时间', render: function (r) { return fmt.rel(r.day); } }
          ],
          rows: cs, noPaging: true,
          emptyTitle: '这条经验不是从 badcase 提炼的',
          emptySub: '它的来源是「' + s.source + '」，没有关联案例'
        }) + '</div>' +
        '<div class="card"><div class="card-h"><h3>证据构成</h3>' +
        '<span class="card-sub">经验与证据不是一对一：按关系类型分开计数</span></div>' +
        '<div class="metrics">' + [
          { label: '支持证据', value: String(ev.support || 0), sub: '证明这条经验有效' },
          { label: '反例', value: String(ev.contradict || 0), alert: (ev.contradict || 0) > 0, sub: '证明它在某些场景不成立' },
          { label: '补充说明', value: String(ev.supplement || 0), sub: '限定适用范围' }
        ].map(h.metricCard).join('') + '</div>' +
        ((ev.contradict || 0) > (ev.support || 0) ? '<div class="bt-note">反例已经多于支持证据 —— 这条经验大概率该收紧适用范围或直接弃用。</div>' : '') +
        '</div>';
    }

    /* ---------- ④ 版本与灰度 ---------- */
    else if (active === 'version') {
      var vs = s.versions || [];
      var grayHtml = s.gray != null
        ? '<div class="alert-banner warn"><b>灰度 ' + s.gray + '% 流量验证中</b>' +
          '<span>当前版本只对部分流量生效，效果数据是灰度内的观测值，不能当成全量结论。</span></div>'
        : '<div class="bt-note">当前版本已全量生效，没有进行中的灰度。</div>';
      body = '<div class="metrics">' + [
        { label: '当前版本', value: h.esc((vs[0] || {}).v || '—'), sub: (vs[0] || {}).state || '—' },
        { label: '灰度比例', value: s.gray != null ? s.gray + '%' : '全量', alert: s.gray != null, sub: s.gray != null ? '灰度期内效果仅供参考' : '已全量生效' },
        { label: '版本数', value: String(vs.length), sub: '每次改动都留版本' }
      ].map(h.metricCard).join('') + '</div>' +
        grayHtml +
        '<div class="card pad0"><div class="card-h pad"><h3>版本记录</h3>' +
        '<span class="card-sub">改过哪几版、现在哪版在线上</span></div>' +
        h.table({
          columns: [
            { key: 'v', label: '版本', render: function (r) { return '<b>' + h.esc(r.v) + '</b>'; } },
            { key: 'day', label: '时间', render: function (r) { return fmt.rel(r.day); } },
            { key: 'note', label: '变更说明' },
            { key: 'state', label: '状态', render: function (r) { return h.pill(r.state === '线上' ? 'ok' : (r.state === '灰度中' ? 'warn' : 'idle'), r.state); } }
          ],
          rows: vs, noPaging: true,
          emptyTitle: '没有版本记录', emptySub: '这条经验还没改过'
        }) + '</div>';
    }

    /* ---------- ⑤ 审核操作 ---------- */
    else if (active === 'review') {
      var apAll = (h.app.getQueues ? (h.app.getQueues().approval || {}) : {}).items || [];
      var apItems = apAll.filter(function (x) { return x.type === 'exp-review' && x.targetId === s.id; });
      var apHtml = '<div class="card pad0"><div class="card-h pad"><h3>关联的变更单</h3>' +
        '<span class="card-sub">历史单据只读存档（审批已下线，新复核不再建单）</span></div>' +
        h.table({
          columns: [
            { key: 'title', label: '单据' },
            { key: 'applicant', label: '申请人' },
            { key: 'approver', label: '确认人', render: function (r) { return r.decided ? h.esc(r.decidedBy) : (r.approver ? h.esc(r.approver) : '<span class="muted">分配中</span>'); } },
            { key: 'waitMin', label: '状态', render: function (r) {
              return r.decided === 'approved' ? h.pill('ok', '已通过')
                : (r.decided === 'rejected' ? h.pill('bad', '已驳回')
                  : h.pill('warn', '审批中 · 已等 ' + fmt.wait(r.waitMin)));
            } }
          ],
          rows: apItems, noPaging: true,
          emptyTitle: '没有关联的变更单', emptySub: '这条经验没有走过审批流程，是直接复核通过的'
        }) + '</div>';

      body = '<div class="card"><div class="card-h"><h3>审核操作</h3>' +
        '<span class="card-sub">通过 / 驳回 / 弃用都会留一条审计</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn-primary" data-act="exp-decide" data-id="' + h.esc(s.id) + '|pass">复核通过</button>' +
        '<button class="btn-ghost" data-act="exp-decide" data-id="' + h.esc(s.id) + '|reject">驳回</button>' +
        '<button class="btn-danger" data-act="exp-decide" data-id="' + h.esc(s.id) + '|deprecate">弃用</button>' +
        (s.status === 'deprecated' ? '<button class="btn-ghost ok" data-act="exp-restore" data-id="' + h.esc(s.id) + '">恢复</button>' : '') +
        '</div>' +
        '<div class="bt-note" style="margin-top:12px">这条经验的结论会同步写回审批队列里对应的复核单 —— 此前经验库自己批完，审批队列还显示「审批中」，两条链路各写各的状态。</div>' +
        '</div>' +
        '<div class="metrics">' + [
          { label: '当前状态', value: s.statusText, sub: '结论：' + judgement.text },
          { label: '复核人', value: s.reviewer || '未分配', sub: s.reviewer ? '对该条负责的人' : '待分配' },
          { label: '正向 / 反向反馈', value: (fb.up || 0) + ' / ' + ((fb.down || 0) + (fb.wrong || 0)), alert: (fb.wrong || 0) > 0, sub: '反向反馈多说明该收紧或淘汰' }
        ].map(h.metricCard).join('') + '</div>' +
        apHtml +
        '<div class="card"><div class="card-h"><h3>复核要点</h3></div><div class="bt-note">' +
        '支持证据 ' + (ev.support || 0) + ' 条、反例 ' + (ev.contradict || 0) + ' 条；' +
        '「' + h.esc(s.scene) + '」场景下收益分 ' + fmt.num1(s.gain) + '。' +
        (s.gray != null ? '当前处于灰度 ' + s.gray + '% 验证期，通过前请确认灰度内效果是否可外推。' : '') +
        (s.status === 'warn' ? '通过后该条进入检索池，绑定的 Agent 会开始检索到它。' : '') +
        '</div></div>';
    }

    /* ---------- ⑥ 引用 Agent ---------- */
    else if (active === 'refs') {
      var ags = s.agents || [];
      body = '<div class="card"><div class="card-h"><h3>' + (isShared ? '可检索这条经验的 Agent' : '绑定的 Agent') + '</h3>' +
        '<span class="card-sub">' + ags.length + ' 个 · ' + (isShared ? '共享经验，跨 Agent 复用需在对方场景重新验证' : '私有经验，只服务它自己') + '</span></div>' +
        '<div class="ins-grid">' + (ags.length ? ags.map(function (aid) {
          var a = agentById[aid] || {};
          var k = h.query.kpi('7d', { agentId: aid });
          return '<div class="ins"><i>' + (aid === s.ownerAgent ? '归属 Agent' : '可检索') + '</i>' +
            '<b>' + h.esc(a.name || aid) + '</b>' +
            '<span>近 7 天 ' + fmt.int(k.calls) + ' 次调用 · 成功率 ' + fmt.pct1(k.successRate) + ' · P99 ' + fmt.dur(k.p99) + '</span>' +
            '<span class="ins-bar"><i style="width:' + Math.round(k.successRate * 100) + '%"></i></span>' +
            '<button class="lnk" data-act="goto-agent" data-id="' + h.esc(aid) + '" style="margin-top:6px">查看 Agent →</button>' +
            '</div>';
        }).join('') : '<div class="bt-note">还没有 Agent 绑定这条经验 —— 它不会出现在任何检索池里。</div>') + '</div></div>' +
        '<div class="card"><div class="card-h"><h3>归属说明</h3></div><div class="bt-note">' +
        (isShared
          ? '这是<b>多 Agent 共享经验</b>：变更会同时影响上面所有 Agent，改之前要想清楚它们在哪些场景下会检索到它。'
          : '这是<b>单 Agent 私有经验</b>：只服务「' + h.esc(aName(s.ownerAgent)) + '」，改动的影响面可控；如果要给别的 Agent 用，走「升级为共享」并重新验证。') +
        '</div></div>';
    }

    return '<div class="page-head"><div class="ph-main">' +
      h.pageCrumb([cap.name, s.title]) +
      '<div class="ph-title">' + h.esc(s.title) + ' ' + h.pill(s.status, s.statusText) + '</div>' +
      '<div class="ph-desc">' + h.esc(s.scene) + ' · ' + h.esc(ownerTxt) + ' · 来源 ' + h.esc(s.source) + '</div>' +
      '</div>' +
      /* 正文编辑入口放页头：与「登记经验」同一处习惯位置（卡头放会与「什么情况下该用它」副标题挤在一起） */
      '<div class="ph-side"><button class="btn-ghost" data-act="exp-edit-content" data-id="' + h.esc(s.id) + '">编辑正文</button></div>' +
      '</div>' +
      h.detailTabs(cap, { objTab: active }, TABS, h) +
      body +
      h.metaBar({}, [
        { k: '正文四段', v: '触发条件 / 处置策略 / 禁忌 / 示例对话 —— 结构化是为了让模型可检索、让人可评审' },
        { k: '证据口径', v: '经验与证据不是一对一：按支持 / 反例 / 补充分别计数，不做「N 条证据」的笼统展示' },
        { k: '效果数据', v: 'A/B 对照、转化率、使用记录来自运行态聚合；周级检索曲线目前只有累计值' },
        { k: '审核', v: '通过 / 驳回 / 弃用都会留一条审计；结论写回这条经验自己的记录' },
        { k: '归属', v: '私有经验由该 Agent 的 owner 复核；共享经验跨 Agent 复用，需在其它 Agent 上重新验证（经验不因存在即适用）' }
      ]);
  };

  /* ============================================================================
   * 知识库 · 会话态（v17 批 A）
   *   上传文档 / 重建索引 / 回滚 / 发布 —— 会话态模拟（纯内存，刷新还原）。
   *   状态按 kbId 分键，避免跨库串数据：
   *     state.newDocs[kbId]      本次上传的文档
   *     state.kbIndex[kbId]      索引版本与历史
   *     state.kbDocOps[kbId]     下线 / 删除
   *     state.kbDocFilter[kbId]  文档清单筛选
   *     state.kbDraft[objId]     草稿页当前展开的补全步骤
   *     state.kbPublic[kbId]     已发布的会话新建库
   *   ⚠️ 一律在渲染层叠加 —— buildAssetTables() 是纯函数、加载时无 state，不能写进 data.js。
   * ========================================================================== */
  var ACTIONS = global.ACTIONS || (global.ACTIONS = {});
  var DOC_POOL = [
    '退货政策', '售前话术', '保修说明', '合同模板', '产品白皮书', '安装部署指南',
    '售后服务规范', '报价单样张', '行业政策汇编', '常见问题 FAQ', '验收标准', '渠道培训手册',
    '价格审批流程', '合规话术红线', '实施交付清单', '产品变更记录', '客户案例集', '故障处置手册',
    '数据字段字典', '接口对接说明'
  ];
  var DOC_SOURCES = ['手动上传', '飞书同步', '语雀同步', 'SharePoint 同步', '邮件归档'];
  var DOC_OWNERS = ['xianyu', '系统'];

  /* ==================================================== 取色：稳定优先
     用户规则：**颜色应该稳定** —— 同一个方案 / 同一个人，在任何屏、任何时候都是同一个颜色。
     所以不能做「同屏去重」（那会让同一实体按旁边有什么而变色），只能让颜色**纯由名字决定**。
     但纯哈希分布很差：18 个方案在 9 色板上只用掉 6 色，4 个共用 indigo。
     于是改成**按名册里的固定序号取色** —— 名册顺序是常量，所以既稳定、又让前 9 个互不撞。
     名册里没有的（如用户新建）再退回哈希。 */
  var DOC_HUE_LIST = ['blue', 'purple', 'teal', 'slate', 'amber', 'green', 'rose', 'indigo', 'cyan'];
  function basePlanName(name) {
    return String(name || '').replace(/[》\s]*v\d+[》\s]*$/, '').replace(/[《》]/g, '').trim();
  }
  function strHash(s) {
    var hash = 0;
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 997;
    return hash;
  }
  /** 文档方案 → 色相（稳定） */
  function planHue(name) {
    var base = basePlanName(name);
    var i = DOC_POOL.indexOf(base);
    if (i < 0) i = strHash(base);
    return DOC_HUE_LIST[i % DOC_HUE_LIST.length];
  }
  /** 人名 → 头像色号 1..6（稳定，按 OWNERS 序号；不在名册则哈希） */
  function personColor(name) {
    var n = String(name || '').trim();
    var i = DOC_OWNERS.indexOf(n);
    if (i < 0) i = strHash(n);
    return 1 + (i % 6);
  }
  /* 文档类型 —— 此前文档只有名字与来源，**看不出这是什么类型的东西**。
     类型按文档名的语义判定（政策/合同/手册/表单/记录/培训），
     拿不到语义时按文档 id 确定性兜底，同一篇文档每次一致。
     v25d：图标由 emoji 换成 SVG（源：app.js PATHS）—— 走查要求全站不用 emoji：
     emoji 跨平台字形不一致、不跟主题换色、线宽也统一不了，在一排类型标签里看着最杂。 */
  /* 文档类型 = 图标形状 + **一个色相**。
     依据 Fluent 2 图标规范：「File type icons indicate specific files or file formats」
     「only use one color」。原来 9 类全是同一个灰 —— 等于没传达类型，
     走查说"图标就是文档类型"，那就得让类型**看得出来**。 */
  var DOC_TYPES = [
    { key: 'policy', label: '制度政策', icon: 'policy', tone: 'ok', hue: 'blue' },
    { key: 'contract', label: '合同协议', icon: 'contract', tone: 'info', hue: 'purple' },
    { key: 'manual', label: '手册指南', icon: 'book', tone: 'info', hue: 'teal' },
    { key: 'spec', label: '说明规范', icon: 'clipboard', tone: 'idle', hue: 'slate' },
    { key: 'form', label: '表单样张', icon: 'form', tone: 'idle', hue: 'amber' },
    { key: 'record', label: '记录清单', icon: 'chart', tone: 'idle', hue: 'green' },
    { key: 'faq', label: '问答 FAQ', icon: 'chat', tone: 'ok', hue: 'rose' },
    { key: 'train', label: '培训材料', icon: 'cap', tone: 'idle', hue: 'indigo' },
    { key: 'case', label: '案例集', icon: 'doc', tone: 'idle', hue: 'cyan' }
  ];
  var DOC_TYPE_BY_KEY = {};
  DOC_TYPES.forEach(function (t) { DOC_TYPE_BY_KEY[t.key] = t; });
  /* 按文档名判类型。
     ⚠ 规则顺序会决定结果，这里踩过一次：原来 `合同|协议|报价|价格审批` 一条把
     「报价单样张」和「价格审批流程」都归成了合同协议 —— 三类文档拿到同一个 key，
     桌面上就是同一个颜色（走查：颜色不要一样的，要根据文档类型）。
     现在的顺序与理由：
       ① 合同/协议 在前 —— 「合同模板」是合同，不该因为带"模板"被当成表单
       ② 报价 不再归合同，交给「样张|模板|表单」判 → 报价单样张 = 表单样张
       ③ 价格审批 不再归合同，交给「流程|制度|规范」判 → 价格审批流程 = 制度政策 */
  function docTypeOf(h, d) {
    var n = String((d && d.name) || '');
    if (/FAQ|常见问题/i.test(n)) return DOC_TYPE_BY_KEY.faq;
    if (/培训/.test(n)) return DOC_TYPE_BY_KEY.train;
    if (/合同|协议/.test(n)) return DOC_TYPE_BY_KEY.contract;
    if (/样张|模板|表单/.test(n)) return DOC_TYPE_BY_KEY.form;
    if (/指南|手册|白皮书/.test(n)) return DOC_TYPE_BY_KEY.manual;
    if (/政策|红线|制度|标准|规范|流程/.test(n)) return DOC_TYPE_BY_KEY.policy;
    /* 话术/售后/售前/处置 放在「政策」之后：「合规话术红线」带"红线"应先判成合规政策，
       而「售前话术」只命中这一条 → 说明规范。这两条的顺序不能对调。 */
    if (/话术|售后|售前|处置/.test(n)) return DOC_TYPE_BY_KEY.spec;
    if (/案例集|案例库|复盘/.test(n)) return DOC_TYPE_BY_KEY.case;
    if (/记录|清单|变更/.test(n)) return DOC_TYPE_BY_KEY.record;
    if (/说明|字典|接口/.test(n)) return DOC_TYPE_BY_KEY.spec;
    /* 兜底：**不再按 id 随机分配类型**。
       随机兜底会让一条没写判据的名字（如原来的「售前话术」）拿到任意类型，
       于是它顶着别的类型的图标 —— 桌面上一眼就是错的。
       判不出就老实归「说明规范」，不做猜测。 */
    return DOC_TYPE_BY_KEY.spec;
  }
  /* 类型图标：列表与卡片共用同一份，不各写一套。
     ⚠ 必须带色相类（t-{hue}）—— 不带的话这里仍是单色，与桌面视图的颜色对不上：
     同一个文档在网格里是紫的、在表格/详情弹层里是灰的（走查：其他呢）。 */
  function docTypeIcon(h, d) {
    var t = docTypeOf(h, d);
    return '<span class="doc-type" title="' + h.esc(t.label) + '"><i class="ico-i' +
      (t.hue ? ' t-' + t.hue : '') + '">' + h.icon(t.icon, 14) + '</i>' +
      '<span>' + h.esc(t.label) + '</span></span>';
  }
  var DOC_CACHE = {};

  function kstate(h) { return (h && h.state) || {}; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function rngOf(h, k) { return (h && h.seed && h.seed.R && h.seed.R.of) ? h.seed.R.of(k) : function () { return 0.5; }; }
  function kbDur(chunks) { var sec = Math.max(25, Math.round((Number(chunks) || 0) / 730)); return Math.floor(sec / 60) + 'm' + pad2(sec % 60) + 's'; }
  function kbFmtSize(kb) { return kb < 1024 ? Math.round(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB'; }
  function kbDraftList(h) { var st = kstate(h); return (st.newObjs || {})['knowledge'] || []; }
  function kbDraftById(h, id) { return byId(h, kbDraftList(h), id); }
  function kbUploads(h, id) { var st = kstate(h); st.newDocs = st.newDocs || {}; st.newDocs[id] = st.newDocs[id] || []; return st.newDocs[id]; }
  function kbOps(h, id) { var st = kstate(h); st.kbDocOps = st.kbDocOps || {}; st.kbDocOps[id] = st.kbDocOps[id] || { offline: {}, deleted: {} }; return st.kbDocOps[id]; }
  /* 文档级会话态的**唯一写入口** —— 单篇下线/删除、批量下线/删除、恢复都走这里。
     此前每个动作各自写 kbOps，批量动作就得再抄一份；两处一旦分叉，
     表现就是「批量删了但清单还在」这类对不上的状态。 */
  function applyDocOp(h, kbId, docId, op) {
    if (!kbId || !docId) return false;
    var ops = kbOps(h, kbId);
    if (op === 'delete') { ops.deleted[docId] = true; delete ops.offline[docId]; return true; }
    if (op === 'offline') { ops.offline[docId] = true; return true; }
    if (op === 'restore') { delete ops.offline[docId]; return true; }
    return false;
  }
  /* 整库的文档清单（含已下线、不含已删除）—— v26 桌面视图的数据源。
     返回的每一项都带 offline 标记，调用方不必再去问 kbOps。 */
  function kbDocsOf(h, kbLike) {
    var id = kbLike && kbLike.id;
    if (!id) return [];
    var ops = kbOps(h, id);
    var out = kbBaseDocs(h, id, kbLike.docs).concat(kbUploads(h, id)).filter(function (d) { return !ops.deleted[d.id]; });
    out.forEach(function (d) { d.offline = !!ops.offline[d.id]; });
    return out;
  }
  function kbDocFilterOf(h, id) { var st = kstate(h); st.kbDocFilter = st.kbDocFilter || {}; return st.kbDocFilter[id] || 'all'; }
  function kbDraftState(h, id) { var st = kstate(h); st.kbDraft = st.kbDraft || {}; st.kbDraft[id] = st.kbDraft[id] || { step: null }; return st.kbDraft[id]; }
  function kbIsPublic(h, id) { var st = kstate(h); return !!(st.kbPublic && st.kbPublic[id]); }
  function kbPubAgents(h, id) { return 2 + Math.floor(rngOf(h, 'kbpub|' + id)() * 4); }

  /* 把「S.KBS 表内的库」与「会话新建的草稿库」统一成一个 kb 视图对象 */
  function resolveKb(h, id) {
    var t = h.app.getAssetTables().kb;
    var row = byId(h, t.rows, id);
    if (row) return { id: id, name: row.name, docs: row.docs, chunks: row.chunks, chunkSize: row.chunkSize, embed: row.embed, lastSync: row.lastSync, status: row.status, statusText: row.statusText, isDraft: false };
    var o = kbDraftById(h, id);
    if (o) return { id: id, name: o.name, docs: 0, chunks: 0, chunkSize: o.slice || '512', embed: 'text-embedding-v3', lastSync: 0, lastSyncText: 0, status: kbIsPublic(h, id) ? 'ok' : 'idle', statusText: kbIsPublic(h, id) ? '可用' : '草稿态', isDraft: true, obj: o };
    return null;
  }

  /* 存量库的文档清单：条数等于该库 docs，确定性派生（不落库），只在渲染层叠加会话增删 */
  function kbBaseDocs(h, kbId, docs) {
    var n = Number(docs) || 0;
    if (n <= 0) return [];
    var key = kbId + '@' + n;
    if (DOC_CACHE[key]) return DOC_CACHE[key];
    var rng = rngOf(h, 'kbdocs|' + kbId);
    /* 每篇切片数的**均值必须等于该库的 chunks ÷ docs**。
       原来是 18 + rng*420（均值 228 片/篇），而五个库的 chunks÷docs 只有 8.8–16.6，
       于是文档清单逐篇相加比「向量条数」大 16 倍 —— 合计 ≠ 各行之和，
       这是数学上不可能自洽的（走查：差一个量级）。
       现在按均值上下浮动，Σslices ≈ chunks。 */
    var _t = h.app.getAssetTables().kb;
    var _lib = byId(h, _t.rows, kbId);
    var _mean = (_lib && Number(_lib.docs) > 0) ? (Number(_lib.chunks) || 0) / Number(_lib.docs) : 20;
    if (!(_mean > 0)) _mean = 20;
    var out = [];
    /* 文档名 = **方案 + 限定 + 版本**，三个维度都要有界：
         · 方案：DOC_POOL 的 18 个基名
         · 限定：9 个范围 × 5 个年份 = 45 个（企业库里的文档本来就是这样按范围/年度分的）
         · 版本：**封顶 5**（v1–v5），一改再改最多也才 v5
       容量 = 18 × 45 × 5 = 4,050 ≥ 各库最大文档数（产品文档库 12,840？
       —— 不够的话限定再进位，见下面 QUAL 的构造，它是按 slot 连续取用的）。
       原来只有「18 个基名 × 无限加版本号」，3,852 篇就摊到 v160 ——
       企业里不存在 v160 的文档，版本号是实体属性，不该由"这个文件夹有多少篇"决定。 */
    var PER = 5;                                   /* 每个方案最多几个版本 */
    /* 限定只用一个维度（范围）。库的文档数已降到几百篇，
       18 基名 × 8 范围 = 144 个方案 × 5 版本 = 720 篇容量，够用。
       原来堆三个限定词（范围+年份+业务线）才装得下上万篇，
       名字变成《退货政策 集团 2022 总部 v1》那样又长又假。 */
    var SCOPE = ['集团', '华东区', '华北区', '华南区', '西南区', '海外', '渠道', '直营'];
    for (var i = 0; i < n; i++) {
      var slices = Math.max(2, Math.round(_mean * (0.55 + rng() * 0.9)));
      var exp = rng() < 0.055;
      var slot = Math.floor(i / PER);              /* 第几个「方案实例」 */
      var ver = 1 + (i % PER);                     /* v1..v5 */
      var docBase = DOC_POOL[slot % DOC_POOL.length];
      var docQual = SCOPE[Math.floor(slot / DOC_POOL.length) % SCOPE.length];
      out.push({
        id: kbId + '-d' + i,
        name: '《' + docBase + '（' + docQual + '） v' + ver + '》',
        _plan: docBase + '（' + docQual + '）',    /* 版本归组用的方案键 */
        source: DOC_SOURCES[Math.floor(rng() * DOC_SOURCES.length) % DOC_SOURCES.length],
        sizeKB: slices * (0.5 + rng() * 1.3),
        updatedDay: -(1 + Math.floor(rng() * 90)),
        slices: slices,
        status: exp ? 'expired' : 'indexed',
        indexed: true,
        /* 有效期一律给**具体年月**，过期也给过去的年月。
           原来过期文档写死字符串 '已过期'，于是详情里「索引状态」和「有效期」两行
           同一屏写着同一句话（走查：同屏重复）。过期与否交给状态标签表达。 */
        validUntil: exp
          ? ('20' + (24 + Math.floor(rng() * 2)) + '-' + pad2(1 + Math.floor(rng() * 12)))
          : ('20' + (27 + Math.floor(rng() * 2)) + '-' + pad2(1 + Math.floor(rng() * 12))),
        owner: DOC_OWNERS[Math.floor(rng() * DOC_OWNERS.length) % DOC_OWNERS.length]
      });
    }
    DOC_CACHE[key] = out;
    return out;
  }

  function kbDocList(h, kbId, docs, filter) {
    var op = kbOps(h, kbId);
    var src = kbBaseDocs(h, kbId, docs).concat(kbUploads(h, kbId));
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var d = src[i];
      if (op.deleted[d.id]) continue;
      var off = !!op.offline[d.id];
      if (filter === 'offline') { if (off) out.push(d); continue; }
      if (off) continue;
      if (filter === 'indexed' && !(d.indexed && d.status === 'indexed')) continue;
      if (filter === 'pending' && d.indexed) continue;
      if (filter === 'expired' && d.status !== 'expired') continue;
      out.push(d);
    }
    return out;
  }

  /* 在服务文档数（不含已下线 / 已删除）—— KPI、清单表头、列表页「文档数」列三处同源 */
  function kbDocCount(h, kbLike) {
    var id = kbLike && kbLike.id;
    if (!id) return 0;
    var op = kbOps(h, id);
    var base = kbBaseDocs(h, id, kbLike.docs);
    var n = 0;
    for (var i = 0; i < base.length; i++) { var d = base[i]; if (!op.deleted[d.id] && !op.offline[d.id]) n++; }
    var ups = kbUploads(h, id);
    for (var j = 0; j < ups.length; j++) { var u = ups[j]; if (!op.deleted[u.id] && !op.offline[u.id]) n++; }
    return n;
  }

  function kbDocStatus(d) {
    /* 下线要判在最前：下线写的是 op.offline，不改 status，
       所以「已下线」只有在读 d.offline 时才判得出来。 */
    if (d.offline) return { k: 'idle', t: '已下线' };
    if (!d.indexed) return { k: 'warn', t: '待索引' };
    if (d.status === 'expired') return { k: 'bad', t: '已过期' };
    return { k: 'ok', t: '已索引' };
  }
  function kbFilterLabel(f) { return { all: '在服务', indexed: '已索引', pending: '待索引', expired: '已过期', offline: '已下线' }[f] || f; }

  /* 索引版本（会话态）。存量库按 lastSync/chunks 确定性派生 v3/v2/v1；草稿库从 v0 起。 */
  function kbIndexOf(h, kbLike) {
    var st = kstate(h); st.kbIndex = st.kbIndex || {};
    var id = kbLike.id;
    if (!st.kbIndex[id]) {
      var rng = rngOf(h, 'kbindex|' + id);
      var by = DOC_OWNERS[Math.floor(rng() * DOC_OWNERS.length) % DOC_OWNERS.length];
      var base = Number(kbLike.chunks) || 0;
      if (base <= 0) {
        st.kbIndex[id] = { version: 0, builtDay: null, dur: '—', vectors: 0, by: by, status: 'draft', history: [], rolled: {}, building: false };
      } else {
        var d1 = Math.max(1, Math.round(base * (0.004 + rng() * 0.004)));
        var d2 = Math.max(1, Math.round(d1 * 1.6));
        var bd = kbLike.lastSync != null ? kbLike.lastSync : 0;
        st.kbIndex[id] = {
          version: 3, builtDay: bd, dur: kbDur(base), vectors: base, by: by, status: 'ok', building: false, rolled: {},
          history: [
            { v: 3, builtDay: bd, vectors: base, kind: '增量 +' + (h.fmt ? h.fmt.int(d1) : d1), by: by },
            { v: 2, builtDay: bd - 7, vectors: base - d1, kind: '全量重建', by: by },
            { v: 1, builtDay: bd - 29, vectors: Math.max(1, base - d1 - d2), kind: '首次构建', by: by }
          ]
        };
      }
    }
    return st.kbIndex[id];
  }
  function kbPrevVersion(ix) {
    var prev = null;
    for (var i = 0; i < ix.history.length; i++) { var r = ix.history[i]; if (r.v < ix.version && !ix.rolled[r.v] && (prev == null || r.v > prev)) prev = r.v; }
    return prev;
  }

  /* -------------------------------------------------- A2 · 「文档」Tab
   * v26：文档管理改成**桌面式** —— 图标网格 + 文件夹 + 双击打开 + 右键菜单 +
   * 拖拽归类 + Ctrl/Shift/框选多选。表格视图保留（按列排序、密集核对时列表更顺手），
   * 顶部一键切换，默认网格。
   * 这里只出外壳（工具条 + 容器），桌面本身由 v26-kb-desk.js 渲染并挂交互。 */
  /* ── 知识库访问记录（v27）──────────────────────────────────────────
     用户要求：「增加大头照，那个人看了，哪个 agent 看了，谁动了，按时间顺序排序，
     不重复出现，点开看详细信息」。
     四条要求逐条落实：
       ① 大头照 —— 人用 h.avatar（与全站同一个人同一色），Agent 用 bot 图标块
       ② 那个人看了 / 哪个 Agent 看了 —— 两类主体分开标（人 / Agent 徽章 + 身份行）
       ③ 按时间倒序、**同一个人或同一个 Agent 只出现一次**（取他最近那次的记录）
       ④ 点开看详细信息 —— 每人可展开：最近几次逐条 + 该主体合计
     数据性质：records 按 kbId 确定性生成（刷新不跳），口径为
     这一点写在卡底，不写成"真实访问日志"。 */
  /* 检索侧可用的查询词池 —— 访问流水里的"访问了什么"要用它 */
  var QUERY_POOL = ['超过七天还能退货吗', '企业版能不能开专票', '2026 年数据出境新规怎么要求',
    '续费能不能打折', '上门服务覆盖哪些城市', '合同主体变更要走什么流程', '发票抬头能改吗', '保修期从哪天算'];
  function kbAccessRows(h, s) {
    var S = global.DATA_SEED;
    if (!S) return [];
    var rng = function (k) { return S.R.of('kbacc|' + s.id + '|' + k); };
    var nA = Math.max(2, Math.min(5, s.refAgents || 2));
    var agents = (S.AGENTS || []).slice().sort(function (a, b) {
      var ka = rng('sa|' + a.id)(), kb = rng('sb|' + b.id)();
      return ka - kb;
    }).slice(0, nA);
    var people = (S.OWNERS || []).slice(0, 5);
    var out = [];
    /* 人的**访问**行为由权限状态决定：
         · 查询 —— 检索本来就开放，无需权限
         · 点开 / 下载 —— **有权限就直达；没权限必须先申请**
       所以人的记录不能只写动作，必须带**权限状态**：
       光写"点击"看不出他是直接点开了，还是卡在申请上。 */
    var PERSON_ACT = ['点开', '查询', '下载'];
    var ACT = {
      agent: ['调用检索', '命中 ' + 3 + ' 条切片', '回退兜底话术'],
      person: PERSON_ACT
    };
    function push(kind, id, name, extra, i) {
      var r = rng(kind + '|' + id + '|' + i);
      var hit = r() > 0.22;
      var min = Math.round(8 + r() * 10080);           /* 近 7 天 */
      var acts = ACT[kind];
      var act = acts[Math.floor(r() * acts.length)];
      /* 状态标签按主体类型分两种口径 —— 这是两件不同的事：
         · Agent：**命中 / 未命中**（检索结果）
         · 人：**权限状态**（有权限直达 / 申请中 / 已批准 / 已拒绝 / 无需权限）
         原来人在"下载"这种动作上也挂"命中/未命中" —— 那是检索概念，下载哪来的命中。 */
      var permK, permT, action;
      if (kind === 'agent') {
        permK = hit ? 'ok' : 'warn';
        permT = hit ? '命中' : '未命中';
        action = hit ? '调用检索 · 命中 ' + (1 + Math.floor(r() * 8)) + ' 条切片'
                     : '调用检索 · 未命中，回退兜底';
      } else if (act === '查询') {
        permK = 'idle'; permT = '无需权限';
        action = '查询 · 无需权限';
      } else {
        var px = r();
        if (px < 0.68) { permK = 'ok'; permT = '有权限'; action = act + ' · 有权限，直达'; }
        else if (px < 0.86) { permK = 'warn'; permT = '申请中'; action = act + ' · 申请中'; }
        else if (px < 0.96) { permK = 'ok'; permT = '已批准'; action = act + ' · 已批准'; }
        else { permK = 'bad'; permT = '已拒绝'; action = act + ' · 已拒绝'; }
      }
      /* 「谁最近访问了**什么**」—— 只写动作回答不了这个问题。
         点开/下载 → 具体哪篇文档；查询/Agent 检索 → 具体哪个查询词。 */
      var _docs = kbDocsOf(h, s);
      var _obj = (kind === 'person' && act !== '查询')
        ? ((_docs.length ? _docs[Math.floor(r() * _docs.length)].name : '（无文档）'))
        : QUERY_POOL[Math.floor(r() * QUERY_POOL.length)];
      /* 审计四要素补齐（对照企业级审计日志的六个维度）：
          · When —— **绝对时间戳**，审计要精确时间，不是"3.4 天前"（相对时间排不了序）
          · Where —— 来源 IP + 客户端，识别异常访问靠它
          · 结果 —— 成功 / 申请中 / 被拒 / 异常，出事的信号在这一列
          · Agent 行还要记**引用切片 + 模型版本**（RAG 审计要求"记录用户、问题、引用来源、模型版本和时间"） */
      var _now = Date.now();
      var AT = new Date(_now - min * 60000);
      var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
      var atText = (AT.getMonth() + 1) + '-' + p2(AT.getDate()) + ' ' +
        p2(AT.getHours()) + ':' + p2(AT.getMinutes()) + ':' + p2(AT.getSeconds());
      var SRC = ['10.12.3.7 · Web', '10.12.9.31 · Web', '10.12.4.22 · 客户端',
        '10.12.7.15 · API', '10.13.2.8 · 移动端'];
      var srcText = kind === 'agent' ? '服务账号 · RAG' : SRC[Math.floor(r() * SRC.length)];
      /* 结果：申请的三种终态 + 异常（非工作时间或批量导出） */
      var resK, resT;
      if (permT === '已拒绝') { resK = 'bad'; resT = '被拒'; }
      else if (permT === '申请中') { resK = 'warn'; resT = '申请中'; }
      else if (permT === '已批准') { resK = 'ok'; resT = '已批准'; }
      else if (permT === '无需权限' || permT === '命中') { resK = 'ok'; resT = '成功'; }
      else if (permT === '未命中') { resK = 'warn'; resT = '未命中'; }
      else { resK = 'ok'; resT = '成功'; }
      out.push({
        kind: kind, id: id, name: name, extra: extra || '',
        hit: hit, min: min,
        action: action,
        permK: permK, permT: permT,
        obj: _obj,
        at: atText, src: srcText,
        resK: resK, resT: (kind === 'agent' && hit && permT === '命中')
          ? ('命中 ' + (1 + Math.floor(r() * 8)) + ' 片')
          : resT,
        model: kind === 'agent' ? 'embed-v3' : ''
      });
    }
    /* 每个主体生成 3–8 条记录。
       原来每个主体只 push 一次，于是弹窗里「近 7 天 N 次 · 命中 X / 未命中 Y」
       恒为「1 次 · 命中 1 / 未命中 0」，底下「逐条记录」表恒为一行 ——
       文案承诺了界面上不存在的东西，kbAccessDedup 也永远没有可合并项。 */
    function many(kind, id, name, extra, base) {
      var r0 = rng(kind + '|' + id + '|n');
      var cnt = 3 + Math.floor(r0() * 6);
      for (var k = 0; k < cnt; k++) push(kind, id, name, extra, base + '|' + k);
    }
    agents.forEach(function (a, i) { many('agent', a.id, a.name, a.bizName || '', i); });
    people.forEach(function (p, i) { many('person', p.id, p.name, p.dept || '', i); });
    return out;
  }
  /** 去重：同一主体只留最近一次（用户要求"不重复出现"），再按时间倒序 */
  function kbAccessDedup(rows) {
    var by = {};
    rows.forEach(function (r) { if (!by[r.kind + '|' + r.id] || r.min < by[r.kind + '|' + r.id].min) by[r.kind + '|' + r.id] = r; });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.min - b.min; });
  }
  function kbAgo(min) {
    if (min < 60) return min + ' 分钟前';
    if (min < 1440) return (min / 60).toFixed(1).replace(/\.0$/, '') + ' 小时前';
    var d = min / 1440;
    return (d < 10 ? d.toFixed(1).replace(/\.0$/, '') : String(Math.round(d))) + ' 天前';
  }
  function kbAccessCard(h, s, state, fmt, opts) {
    var all = kbAccessRows(h, s);
    /* 文档级视图 = 同一份流水**按对象过滤**。
       以前是拿 `库id/文档id` 另起一个随机键重新生成一份，于是：
       库级说「孙琪访问了《X》」，打开《X》却未必有孙琪 —— 两处对不上。
       审计追溯的价值全在**自洽**：顺着人查到对象、顺着对象查到人，必须是同一条记录。
       所以只有一份流水，库级按主体看、文档级按对象看。 */
    if (opts && opts.docName) {
      all = all.filter(function (r) { return r.obj === opts.docName; });
    }
    if (!all.length) {
      if (!opts || !opts.docName) return '';
      return '<div class="card"><div class="card-h"><h3>访问记录</h3>' +
        '<span class="card-sub">近 7 天</span></div>' +
        '<div class="bt-note">近 7 天无人访问这篇文档 —— 是「该不该保留」的管理信号。</div></div>';
    }
    /* 默认**卡片**，可切列表 —— 与文档区同一套「网格 / 列表」模式。
       视图按主体类型分开存：成员想用列表、Agent 想看卡片是很正常的组合。 */
    /* 头像色**稳定**：只由名字决定（KB_SESSION.personColor 按员工名册的固定序号取号）。
       不做同屏去重 —— 同一个人在这里是蓝的、换个库变青的，那就不叫"同一个人同色"了。
       撞色仍然可能（调色板只有 6 号），但撞的永远是固定那两人，可预期。 */
    function stableColor(rows) {
      rows.forEach(function (r) {
        r._c = (r.kind === 'person' && KB_SESSION.personColor)
          ? KB_SESSION.personColor(r.name)
          : (h.avColor ? h.avColor(r.name) : 1);
      });
      return rows;
    }
    /* 成员 / Agent 两段各有自己的视图，互不影响 */
    var vPerson = (state && state.kbAccViewPerson) === 'list' ? 'list' : 'card';
    var vAgent = (state && state.kbAccViewAgent) === 'list' ? 'list' : 'card';
    var people = stableColor(kbAccessDedup(all.filter(function (r) { return r.kind === 'person'; })));
    var agents = kbAccessDedup(all.filter(function (r) { return r.kind === 'agent'; }));

    function actor(r, view) {
      if (view === 'list') {
        return '<button class="kb-acc-rowitem" data-act="kb-access-open" data-id="' +
          h.esc(s.id) + '|' + h.esc(r.kind + '|' + r.id) + '">' +
          kbActorFace(h, r) +
          '<span class="kb-acc-main">' +
            '<span class="kb-acc-nm">' + h.esc(r.name) + '</span>' +
            '<span class="kb-acc-sub">' + (r.extra ? '<span class="muted">' + h.esc(r.extra) + '</span>' : '') +
              '<span class="kb-acc-obj" title="' + h.esc(r.obj) + '">' + h.esc(r.obj) + '</span>' +
            '<span class="kb-acc-act">' + h.esc(r.action) + '</span></span>' +
          '</span>' +
          '<span class="kb-acc-when">' + kbAgo(r.min) + '</span>' +
          '<span class="pill ' + (r.permK || (r.hit ? 'ok' : 'warn')) + '">' +
            h.esc(r.permT || (r.hit ? '命中' : '未命中')) + '</span>' +
          '<span class="kb-acc-chev">详情</span></button>';
      }
      return '<button class="kb-acc-card' + (r.kind === 'agent' ? ' is-agent' : '') +
        '" data-act="kb-access-open" data-id="' +
        h.esc(s.id) + '|' + h.esc(r.kind + '|' + r.id) + '">' +
        kbActorFace(h, r, true) +
        '<span class="kb-acc-nm">' + h.esc(r.name) + '</span>' +
        (r.extra ? '<span class="kb-acc-sub"><span class="muted">' + h.esc(r.extra) + '</span></span>' : '') +
        '<span class="kb-acc-obj" title="' + h.esc(r.obj) + '">' + h.esc(r.obj) + '</span>' +
        '<span class="kb-acc-act">' + h.esc(r.action) + '</span>' +
        '<span class="kb-acc-meta">' + kbAgo(r.min) + ' · ' +
          h.pill(r.permK || (r.hit ? 'ok' : 'warn'), r.permT || (r.hit ? '命中' : '未命中')) + '</span>' +
        '</button>';
    }
    /* 一段 = 小标题（谁 · 几个 · 视图切换）+ 该段的卡片网格或列表。
       两段各自独立倒序、各自计数 —— 不再把人和 Agent 混在一排。 */
    function section(key, label, rows, view) {
      if (!rows.length) return '';
      return '<div class="kb-acc-sec' + (key === 'agent' ? ' is-agent' : '') + '">' +
        '<div class="kb-acc-sec-h">' +
        '<span class="kb-acc-sec-t">' + label + '</span>' +
        '<span class="kb-acc-sec-n">' + rows.length + ' 个</span>' +
        '<div class="view-sw kb-layout" role="group" aria-label="' + label + '查看方式">' +
        '<button class="vs-btn' + (view === 'card' ? ' on' : '') + '" data-act="kb-access-view"' +
        ' data-id="' + key + '|card" aria-pressed="' + (view === 'card') + '" title="卡片">卡片</button>' +
        '<button class="vs-btn' + (view === 'list' ? ' on' : '') + '" data-act="kb-access-view"' +
        ' data-id="' + key + '|list" aria-pressed="' + (view === 'list') + '" title="列表">列表</button>' +
        '</div></div>' +
        '<div class="' + (view === 'card' ? 'kb-acc-cards' : 'kb-acc-list') + '">' +
        rows.map(function (r) { return actor(r, view); }).join('') + '</div></div>';
    }

    /* ============ 审计视图 ============
       企业级系统的访问记录是**审计日志**，不是看板：
         · 一次操作一行 → 只能是对齐的**表格**（卡片装不下时间戳/来源/结果/引用）
         · 列 = 审计六维度：时间(When) · 主体(Who) · 来源(Where) · 动作(Action) · 对象(What) · 结果
         · 顶部给规模与异常（好管理），底部给留存声明（不可篡改 + 年限）
       卡片视图降级为「热度」（按主体聚合，看谁用得多）—— 那是管理概览，不是审计。 */
    var onlyDenied = !!(state && state.kbAccOnlyDenied);
    var auditView = (state && state.kbAccAuditView) === 'heat' ? 'heat' : 'table';
    var rows2 = all.slice().sort(function (a, b) { return a.min - b.min; });
    var deniedN = all.filter(function (r) { return r.resT === '被拒'; }).length;
    var actorSeen = {};
    all.forEach(function (r) { actorSeen[r.kind + '|' + r.id] = 1; });
    var actorN = Object.keys(actorSeen).length;
    if (onlyDenied) rows2 = rows2.filter(function (r) { return r.resT === '被拒'; });

    var head = '<div class="card"><div class="card-h"><h3>访问记录</h3>' +
      '<span class="card-sub">近 7 天 · ' + fmt.int(all.length) + ' 次访问 · ' + actorN + ' 个主体' +
      (deniedN ? ' · <b class="bad">被拒 ' + deniedN + ' 次</b>' : '') + '</span>' +
      '<div class="view-sw kb-layout" role="group" aria-label="审计视图">' +
      '<button class="vs-btn' + (auditView === 'table' ? ' on' : '') + '" data-act="kb-access-audit"' +
      ' data-id="table" aria-pressed="' + (auditView === 'table') + '" title="审计表格：一次操作一行">表格</button>' +
      '<button class="vs-btn' + (auditView === 'heat' ? ' on' : '') + '" data-act="kb-access-audit"' +
      ' data-id="heat" aria-pressed="' + (auditView === 'heat') + '" title="热度：按主体聚合">热度</button>' +
      '</div>' +
      /* 没有「被拒」记录时不显示这个按钮 —— 点了只会看到一张空表 */
      (deniedN ? '<button class="btn-ghost sm' + (onlyDenied ? ' on' : '') + '" data-act="kb-access-audit" data-id="denied"' +
      ' aria-pressed="' + onlyDenied + '">' + (onlyDenied ? '看全部' : '仅看被拒') + '</button>' : '') +
      '</div>';

    if (auditView === 'heat') {
      return head +
        section('person', '成员', people, vPerson) +
        section('agent', 'Agent', agents, vAgent) +
        '<div class="bt-note">留存：只可追加、不可修改删除，制度留存期 3 年。' +
        '按库 id 确定性生成，对接检索服务与账号审计日志流。</div></div>';
    }

    /* 人与 Agent **分两张表** —— 两类主体的动作语义不同：
       人的结果是权限状态（成功 / 申请中 / 被拒），Agent 的结果是检索命中。
       混在一张表里，"被拒"到底是被权限挡住、还是 Agent 没命中，就分不清了。 */
    function auditTable(list, label) {
      if (!list.length) return '';
      return '<div class="kb-audit-cap">' + label + '（' + fmt.int(list.length) + ' 次）</div>' +
        '<div class="tbl-wrap"><table class="bt kb-audit"><thead><tr>' +
        '<th>时间</th><th>主体</th><th>来源</th><th>动作</th><th>对象</th><th>结果</th>' +
        '</tr></thead><tbody>' +
        list.map(function (r) {
          return '<tr>' +
            '<td class="mono" style="white-space:nowrap">' + h.esc(r.at) + '</td>' +
            '<td class="kb-who">' + kbActorFace(h, { kind: r.kind, name: r.name,
              _c: r.kind === 'person' && KB_SESSION.personColor ? KB_SESSION.personColor(r.name) : 1 }) +
              '<span>' + h.esc(r.name) + '</span>' +
              (r.extra ? '<span class="muted">' + h.esc(r.extra) + '</span>' : '') + '</td>' +
            '<td class="muted">' + h.esc(r.src) + '</td>' +
            '<td>' + h.esc(r.action) + '</td>' +
            '<td>' + h.esc(r.obj) + '</td>' +
            '<td><span class="pill ' + r.resK + '">' + h.esc(r.resT) + '</span>' +
              (r.model ? ' <span class="muted">' + h.esc(r.model) + '</span>' : '') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    var pRows = rows2.filter(function (r) { return r.kind === 'person'; });
    var aRows = rows2.filter(function (r) { return r.kind === 'agent'; });

    return head +
      (rows2.length
        ? auditTable(pRows, '成员') + auditTable(aRows, 'Agent')
        : '<div class="bt-note">没有符合条件的记录。</div>') +
      '<div class="bt-note">留存：只可追加、不可修改删除，制度留存期 3 年。' +
      '按库 id 确定性生成，对接检索服务与账号审计日志流。</div></div>';
  }
  /** 原文按「纸」分页渲染。
      用户给的参照（成熟产品的文件预览）是**白纸 + 页边距 + 页码 + 分页**，
      不是把条款堆在一串灰卡里。所以这里：
        · 每页一张白纸（白底、页边距、轻投影），宽度固定 = 阅读行宽
        · 章节标题用「一、二、三」中文序号（正式文件的样子）
        · 页脚 `第 N 页 / 共 M 页`
        · 每页约 1400 字（≈ 一份 A4 的正文容量），按内容均分，不按字符硬切
      分页只在**章节边界之间**切，不把一章劈成两页 —— 那样读起来断气。 */
  function docPages(h, secs) {
    var items = [];
    secs.forEach(function (s) {
      items.push({ h: s.title });
      s.body.forEach(function (c) { items.push({ p: c }); });
    });
    var CHARS_PER_PAGE = 1400;
    var pages = [], cur = [], n = 0;
    items.forEach(function (it) {
      var len = it.h ? 40 : (String(it.p || '').length + 24);
      /* 该翻页了就翻，但别让页面以「章节标题」结尾（标题落单很难看） */
      if (n && n + len > CHARS_PER_PAGE && !(cur.length && cur[cur.length - 1].h)) {
        pages.push(cur); cur = []; n = 0;
      }
      cur.push(it); n += len;
    });
    if (cur.length) pages.push(cur);
    var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五'];
    var ci = 0;
    return pages.map(function (pg, pi) {
      var inner = pg.map(function (it) {
        if (it.h) return '<h4 class="doc-h">' + CN[ci++] + '、' + h.esc(it.h) + '</h4>';
        return '<p>' + h.esc(it.p) + '</p>';
      }).join('');
      return '<div class="doc-page">' + inner +
        '<div class="doc-pgno">第 ' + (pi + 1) + ' 页 / 共 ' + pages.length + ' 页</div></div>';
    }).join('');
  }


  /** 点开一个主体的详情弹窗。
      用弹窗而不是行内展开：卡片视图下行内展开会把网格撑得参差不齐。 */
  function kbAccessSheet(s, r, all, h, fmt) {
    var mine = all.filter(function (x) { return x.kind === r.kind && x.id === r.id; })
      .sort(function (a, b) { return a.min - b.min; });
    var hitN = mine.filter(function (x) { return x.hit; }).length;
    global.V10UI.openSheet({
      title: (r.kind === 'agent' ? 'Agent：' : '成员：') + r.name,
      bodyHtml:
        '<dl class="dl">' +
        '<dt>' + (r.kind === 'agent' ? 'Agent' : '成员') + '</dt><dd>' + h.esc(r.name) +
          (r.extra ? ' <span class="muted">· ' + h.esc(r.extra) + '</span>' : '') + '</dd>' +
        '<dt>最近一次</dt><dd>' + kbAgo(r.min) + ' · ' + h.esc(r.action) + ' ' +
          h.pill(r.permK || (r.hit ? 'ok' : 'warn'), r.permT || (r.hit ? '命中' : '未命中')) + '</dd>' +
        '<dt>近 7 天</dt><dd>' + mine.length + ' 次 · 命中 <b class="ok">' + hitN +
          '</b> / 未命中 <b class="' + (mine.length - hitN ? 'warn' : '') + '">' + (mine.length - hitN) + '</b></dd>' +
        '<dt>涉及知识库</dt><dd>' + h.esc(s.name) + '</dd>' +
        '</dl>' +
        '<div class="sub-h" style="margin-top:12px">逐条记录</div>' +
        '<div class="tbl-wrap"><table class="bt"><thead><tr><th>时间</th><th>访问对象</th><th>动作</th><th>状态</th></tr></thead><tbody>' +
        mine.map(function (x) {
          return '<tr><td class="muted" style="white-space:nowrap">' + kbAgo(x.min) + '</td>' +
            '<td>' + h.esc(x.obj) + '</td>' +
            '<td>' + h.esc(x.action) + '</td>' +
            '<td><span class="pill ' + (x.permK || (x.hit ? 'ok' : 'warn')) + '">' +
              h.esc(x.permT || (x.hit ? '命中' : '未命中')) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="bt-note">记录只可追加、不可修改删除；按库 id 确定性生成。</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">关闭</button>',
      onOpen: function (root) {
        root.addEventListener('click', function (ev) {
          var g = ev.target.getAttribute && ev.target.getAttribute('data-v10');
          if (g === 'close') global.V10UI.closeSheet();
        });
      }
    });
  }
  /** 主体头像：人用全站头像（同一个人同色），Agent 用 bot 图标块 */
  function kbActorFace(h, r, lg) {
    return '<span class="kb-acc-face' + (lg ? ' lg' : '') + (r.kind === 'agent' ? ' is-agent' : '') + '">' +
      (r.kind === 'agent'
        ? h.icon('bot', lg ? 26 : 20)
        : h.avatar(r.name, { face: true, c: r._c })) + '</span>';
  }
  function kbDocsTab(h, s) {
    /* 网格与列表**同属一套外壳**，都走 docsDeskHtml（它内部按 layout 只换内容区）。
       以前 layout==='list' 会落到另一套组件 kbDocsList（自带标题卡与筛选条），
       于是切视图像换一屏。kbDocsList 保留作兜底，正常不再走到。 */
    if (global.KBDESK) {
      return '<div class="card pad0 kb-desk-card">' + global.KBDESK.docsDeskHtml(h, s) + '</div>';
    }
    return kbDocsList(h, s);
  }

  /* 列表视图（原表格形态 + 查看方式切换）：需要按列排序、一屏核对上百条时用它 */
  function kbDocsList(h, s) {
    var fmt = h.fmt;
    var total = kbDocCount(h, s);
    var ix = kbIndexOf(h, s);
    var filter = kbDocFilterOf(h, s.id);
    var list = kbDocList(h, s.id, s.docs, filter);
    /* 与网格视图共用同一套按名搜索（KBDESK.filterByName）—— 同一个词在两种视图里必须同一批结果 */
    var q = (global.KBDESK && global.KBDESK.docQuery) ? global.KBDESK.docQuery(h) : '';
    if (q && global.KBDESK && global.KBDESK.filterByName) list = global.KBDESK.filterByName(h, list);
    var page = (h.state && h.state.page) || 1;
    var off = kbOps(h, s.id).offline;
    var fbtns = [['all', '在服务'], ['indexed', '已索引'], ['pending', '待索引'], ['expired', '已过期'], ['offline', '已下线']];

    var head = '<div class="card pad0"><div class="card-h pad"><h3>文档</h3>' +
      '<span class="card-sub">共 ' + fmt.int(total) + ' 篇 · ' + fmt.int(ix.vectors) + ' 个向量</span>' +
      (global.KBDESK ? global.KBDESK.viewToggle(s.id, 'list') : '') + '</div>' +
      '<div class="filter-row" style="padding:0 12px 8px"><div class="seg-group">' +
      fbtns.map(function (x) {
        return '<button class="vs-btn' + (filter === x[0] ? ' on' : '') + '" data-act="kb-doc-filter" data-id="' + h.esc(s.id) + '|' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<span class="kb-search">' + h.icon('search', 14) +
      '<input data-f="kbDocQ" value="' + h.esc(q) + '" placeholder="按文档名搜，回车" aria-label="按文档名搜索"></span>' +
      '<span class="grow"></span>' +
      '<button class="btn-ghost sm" data-act="kb-desk-newfolder" data-id="' + h.esc(s.id) + '">新建分类</button>' +
      '<button class="btn-primary" data-act="kb-doc-upload" data-id="' + h.esc(s.id) + '">上传文档</button></div>';

    if (!list.length) {
      /* 空态要分场景：库里一篇都没有、筛到空、搜不到，是三件事 */
      var empty = q
        ? h.emptyFor('没有名字匹配「' + q + '」的文档', '换个关键词，或清空搜索框', 'doc')
        : (filter === 'all')
          ? h.emptyFor('尚未上传文档', '上传文档并重建索引后，内容才会被检索到', 'doc')
          : h.emptyFor('「' + kbFilterLabel(filter) + '」下没有文档',
                       '这个库当前没有处于该状态的文档；切回「在服务」可看全部 ' + fmt.int(total) + ' 篇',
                       'doc');
      return head + '<div style="padding:4px 12px 12px">' + empty + '</div></div>';
    }

    var cols = [
      /* 文档名可点 —— 此前文档只有元数据、打不开，看不到它写了什么、被谁用过 */
      { key: 'name', label: '文档名', render: function (r) {
        return '<button class="lnk" data-act="kb-doc-open" data-id="' + h.esc(s.id) + '|' + h.esc(r.id) + '"><b>' + h.esc(r.name) + '</b></button>'; } },
      /* 文档类型：图标 + 标签，一眼分清这是制度、合同还是手册 */
      { key: 'dtype', label: '类型', render: function (r) { return docTypeIcon(h, r); } },
      { key: 'source', label: '来源' },
      { key: 'sizeKB', label: '大小', align: 'right', render: function (r) { return h.esc(kbFmtSize(r.sizeKB)); } },
      { key: 'updatedDay', label: '更新时间', render: function (r) { return h.esc(fmt.rel(r.updatedDay)); } },
      { key: 'slices', label: '切片数', align: 'right', render: function (r) { return fmt.int(r.slices); } },
      { key: 'status', label: '索引状态', render: function (r) { var k = kbDocStatus(r); return h.pill(k.k, k.t); } },
      /* 有效期列按**状态**上色，而不是拿字符串跟「已过期」比 ——
         validUntil 现在是具体年月，跟字面比永远不会真。 */
      { key: 'validUntil', label: '有效期', render: function (r) { var k = kbDocStatus(r); return '<span class="' + (k.t === '已过期' ? 'bad' : '') + '">' + h.esc(r.validUntil) + '</span>'; } },
      { key: 'owner', label: '责任人', render: function (r) { return h.avatar(r.owner); } },
      { key: 'ops', label: '', render: function (r) {
        /* 已下线的行给「恢复」—— 否则下线是单向的，放不回检索池 */
        var isOff = !!off[r.id];
        return (isOff
          ? '<button class="lnk ok" data-act="kb-doc-restore" data-id="' + h.esc(s.id) + '|' + h.esc(r.id) + '">恢复</button>'
          : '<button class="lnk warn" data-act="kb-doc-offline" data-id="' + h.esc(s.id) + '|' + h.esc(r.id) + '">下线</button>') +
          ' <button class="lnk warn" data-act="kb-doc-delete" data-id="' + h.esc(s.id) + '|' + h.esc(r.id) + '">删除</button>';
      } }
    ];
    return head + h.table({ columns: cols, rows: list, page: page, pageSize: 20, total: list.length, emptyTitle: '尚无文档' }) + '</div>';
  }

  /* -------------------------------------------------- A1 · 索引：现状 / 配置 / 历史 / 停用
   * 2026-10-21 业主：「合在一起」。
   * 原来「索引配置」「停用知识库」「当前索引版本」「版本历史」是四张独立卡片 ——
   * 四道边框、四份留白，读起来像四件互不相干的事；而它们回答的是同一个问题：
   * **这个库的索引现在是什么样、怎么配的、走过哪几版。**
   * 现在合成一张卡，内部按「现状 → 构型 → 历史 → 停用」四节排。
   *
   * kbIndexParts 只产出**裸内容**（不带 card 外壳），由概览页统一包卡；
   * kbIndexTab 保留给可能的独立入口，行为与以前一致。
   */
  /* 一栏字段表：左标签、右值，一块四行，行间细线。
     为什么不用 .kv：那个类是 auto-fit 网格 + 每格独立描边（一屏最多四格并排），
     业主「一栏」要的是**一条线读下来**，不是八个各自带边框的小块。 */
  function kvCol(rows) {
    return '<div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">' +
      rows.map(function (r, i) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;' +
          'padding:9px 12px;' + (i ? 'border-top:1px solid var(--line);' : '') + '">' +
          '<span style="color:var(--sub);font-size:12.5px">' + r[0] + '</span>' +
          '<b style="text-align:right">' + r[1] + '</b></div>';
      }).join('') + '</div>';
  }

  function kbIndexParts(h, s) {
    var fmt = h.fmt;
    var ix = kbIndexOf(h, s);
    var cur = ix.version;
    var pub = kbIsPublic(h, s.id);
    var docs = kbDocCount(h, s);
    var prev = kbPrevVersion(ix);
    /* 可用性必须把**停用态**算进去 —— 停用后这一屏原来仍显示绿色「可用」，
       而同屏页头与概览卡都已是「已停用」，且停用弹窗承诺「Agent 检索不再命中」。 */
    var usable = (pub || !s.isDraft) && !s.isDisabled;

    var banner = ix.building
      ? '<div class="alert-banner warn" style="margin-bottom:12px"><b>构建中…</b><span>正在对「' + h.esc(s.name) + '」做全量重建（' + fmt.int(docs) + ' 篇 · 约 ' + h.esc(kbDur(s.chunks)) + '）。期间检索仍走旧索引 v' + cur + '，不会中断。</span></div>'
      : '';

    var sub = cur
      ? ('构建于 ' + h.esc(fmt.rel(ix.builtDay)) + ' · 耗时 ' + h.esc(ix.dur) + ' · ' + fmt.int(ix.vectors) + ' 个向量')
      : '索引尚未构建 —— 上传文档后重建索引才会生效';

    /* 一栏到底（业主「一栏」）：四行竖排，一行一个字段 */
    /* 字段与动作分开：字段左右并排（左「当前索引」右「索引配置」），
       动作统一落到两栏下方一行 —— 否则左栏比右栏多个按钮，两栏底边不齐。 */
    var current = kvCol([
      ['当前版本', (cur ? ('v' + cur) : '—') + ' ' + (cur ? h.pill('ok', '当前') : h.pill('idle', '未构建'))],
      ['构建人', h.esc(ix.by)],
      ['文档数', fmt.int(docs) + ' 篇'],
      ['状态', h.pill(s.isDisabled ? 'idle' : (usable ? 'ok' : 'idle'),
        s.isDisabled ? '已停用' : (usable ? '可用' : '草稿态'))]
    ]);
    /* 业主：「这个是不是可以右移」—— 字段的值都右对齐，动作跟着靠右，
       视线从「状态 可用」往下落到按钮，不用再横跨整行往左找。 */
    var actions = '<div class="gray-acts" style="margin-top:12px;justify-content:flex-end">' +
      '<button class="btn-primary" data-act="kb-rebuild" data-id="' + h.esc(s.id) + '"' + (ix.building ? ' disabled' : '') + '>' + (ix.building ? '构建中…' : '重建索引') + '</button>' +
      (prev != null ? '<button class="btn-ghost" data-act="kb-rollback" data-id="' + h.esc(s.id) + '">回滚到 v' + prev + '</button>' : '') +
      ((s.isDraft && !pub) ? '<button class="btn-ghost" data-act="kb-publish" data-id="' + h.esc(s.id) + '">发布</button>' : '') +
      '</div>';

    var hist = ix.history.slice().sort(function (a, b) { return b.v - a.v; });
    var cols = [
      { key: 'v', label: '版本', render: function (r) { return '<b>v' + r.v + '</b>'; } },
      { key: 'state', label: '状态', render: function (r) {
        if (ix.rolled[r.v]) return h.pill('bad', '已回滚');
        if (r.v === cur) return h.pill('ok', '当前');
        return h.pill('idle', '历史');
      } },
      { key: 'builtDay', label: '构建时间', render: function (r) { return h.esc(fmt.rel(r.builtDay)); } },
      { key: 'vectors', label: '向量数', align: 'right', render: function (r) { return fmt.int(r.vectors); } },
      { key: 'kind', label: '构建方式' },
      { key: 'by', label: '构建人' }
    ];
    var history = '<div class="card-sub" style="margin:0 0 8px">共 ' + hist.length + ' 个版本 · 回滚后当前版本会标「已回滚」· 点行看该版本详情</div>' +
      h.table({
        columns: cols, rows: hist, noPaging: true, emptyTitle: '暂无索引版本',
        /* 出口：点版本行展开该版本自己的字段（向量数/构建方式/构建人/是否被回滚过），
           内容全部取自该行数据，不另编；回滚动作仍在页头（kb-rollback）。 */
        rowAction: 'row-detail', rowIdKey: 'v',
        detailHtml: function (r) {
          return '第 v' + r.v + ' 版 · 向量 ' + r.vectors + ' · 构建方式 ' + (r.kind || '—') +
            ' · 构建人 ' + (r.by || '—') + ' · ' + fmt.rel(r.builtDay) +
            (ix.rolled[r.v] ? ' · 该版本已被回滚' : (r.v === cur ? ' · 当前生效版本' : ''));
        }
      });

    return { banner: banner, sub: sub, current: current, actions: actions, history: history };
  }

  /* 兼容旧入口：两段内容各包一张卡，与合并前一致 */
  function kbIndexTab(h, s) {
    var p = kbIndexParts(h, s);
    return p.banner +
      '<div class="card"><div class="card-h"><h3>当前索引版本</h3><span class="card-sub">' + p.sub + '</span></div>' + p.current + p.actions + '</div>' +
      '<div class="card pad0"><div class="card-h pad"><h3>版本历史</h3></div><div style="padding:0 14px 14px">' + p.history + '</div></div>';
  }

  /* -------------------------------------------------- A3 · 草稿页「还差什么才能生效」（页内展开） */
  function kbDraftCard(h, o) {
    var kb = resolveKb(h, o.id) || { id: o.id, name: o.name, docs: 0, chunks: 0, chunkSize: o.slice || '512', isDraft: true };
    var ds = kbDraftState(h, o.id);
    var ix = kbIndexOf(h, kb);
    var ups = kbUploads(h, o.id);
    var upActive = kbDocCount(h, kb);
    var pub = kbIsPublic(h, o.id);
    var fmt = h.fmt;
    var docDone = upActive > 0, idxDone = ix.version > 0, pubDone = pub;
    var allDone = docDone && idxDone && pubDone;

    function stepRow(step, done, label, hint) {
      var open = ds.step === step;
      return '<li class="' + (done ? '' : 'warn') + '" style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
        '<span>' + (done ? '<b class="ok">✓</b> ' : '○ ') + h.esc(label) + (hint ? ' <span class="muted">· ' + h.esc(hint) + '</span>' : '') + '</span>' +
        (done ? '' : '<button class="lnk" data-act="kb-draft-step" data-id="' + h.esc(o.id) + '|' + step + '">' + (open ? '收起' : '展开') + '</button>') +
        '</li>';
    }

    var inner = '';
    if (ds.step === 'docs') {
      inner = '<div class="bt-note" style="margin-top:8px">上传后需重建索引，文档才会被检索到。</div>' +
        (ups.length ? '<div class="sub-h">本次已上传 ' + ups.length + ' 篇</div><ul class="check-list">' + ups.map(function (d) {
          return '<li>· ' + h.esc(d.name) + '（' + fmt.int(d.slices) + ' 切片 · ' + (d.indexed ? '已索引' : '待索引') + '）</li>';
        }).join('') + '</ul>' : '') +
        '<div class="gray-acts"><button class="btn-primary" data-act="kb-doc-upload" data-id="' + h.esc(o.id) + '">上传文档</button></div>';
    } else if (ds.step === 'index') {
      inner = '<div class="bt-note" style="margin-top:8px">全量重建：' + fmt.int(upActive || ups.length) + ' 篇文档 · 约 ' + h.esc(kbDur(kb.chunks || ups.length * 200)) + '，构建期间检索走旧索引。</div>' +
        '<div class="gray-acts"><button class="btn-primary" data-act="kb-rebuild" data-id="' + h.esc(o.id) + '">' + (ix.building ? '构建中…' : '重建索引') + '</button></div>';
    } else if (ds.step === 'publish') {
      inner = '<div class="bt-note" style="margin-top:8px">发布后本库对引用它的 ' + fmt.int(kbPubAgents(h, o.id)) + ' 个 Agent 生效，可被检索到。</div>' +
        '<div class="gray-acts"><button class="btn-primary" data-act="kb-publish" data-id="' + h.esc(o.id) + '">确认发布</button></div>';
    }

    return '<div class="card"><div class="card-h"><h3>还差什么才能生效</h3>' +
      '<span class="card-sub">' + (allDone ? h.pill('ok', '可用') : h.pill('idle', '草稿态')) + '</span></div>' +
      '<ul class="check-list">' +
      stepRow('docs', docDone, '上传文档', docDone ? ('已上传 ' + fmt.int(upActive) + ' 篇') : '未上传文档') +
      stepRow('index', idxDone, '重建索引', idxDone ? ('当前 v' + ix.version) : '未构建索引') +
      stepRow('publish', pubDone, '发布生效', pubDone ? '已发布，可被检索到' : '未发布') +
      '</ul>' + inner +
      '<div class="gray-acts">' +
      '<button class="btn-primary" data-act="kb-draft-complete" data-id="' + h.esc(o.id) + '">' + (allDone ? '已完成，查看全部知识库 →' : '继续补全') + '</button>' +
      '<button class="btn-danger sm" data-act="new-obj-revoke" data-id="knowledge|' + h.esc(o.id) + '">撤销创建</button>' +
      '</div></div>';
  }

  /* -------------------------------------------------- 动作层（两条路径共用） */
  ACTIONS['kb-draft-step'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var ds = kbDraftState(h, p[0]);
    ds.step = (ds.step === p[1]) ? null : p[1];
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-draft-complete'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('草稿不存在', 'bad'); return; }
    var ix = kbIndexOf(h, kb);
    var ds = kbDraftState(h, id);
    if (kbDocCount(h, kb) <= 0) ds.step = 'docs';
    else if (ix.version <= 0) ds.step = 'index';
    else if (!kbIsPublic(h, id)) ds.step = 'publish';
    else ds.step = null;
    h.toast(ds.step ? '继续补全：上传文档 → 重建索引 → 发布' : '该库已可用，可在「全部知识库」中检索', ds.step ? 'info' : 'ok');
    h.navigate({}, { scroll: false });
  };

  ACTIONS['kb-doc-upload'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    global.V10UI.openSheet({
      title: '上传文档 · ' + kb.name,
      bodyHtml: '<div class="v10-sheet-desc">上传后需重建索引，文档才会被检索到。</div>' +
        '<label class="sub-h">文档名</label><input id="kb-up-name" placeholder="例如：退货政策 v4">' +
        '<label class="sub-h" style="margin-top:10px;display:block">来源</label>' +
        '<select id="kb-up-src">' + DOC_SOURCES.map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('') + '</select>' +
        '<div class="err" id="kb-up-err" style="display:none">文档名必填</div>',
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-act="kb-doc-upload-ok" data-id="' + h.esc(id) + '">上传</button>'
    });
  };
  ACTIONS['kb-doc-upload-ok'] = function (id, btn, h) {
    var root = document.querySelector('.v10-sheet');
    var nameEl = root ? root.querySelector('#kb-up-name') : null;
    var srcEl = root ? root.querySelector('#kb-up-src') : null;
    var name = nameEl ? String(nameEl.value || '').trim() : '';
    if (!name) { var e = root && root.querySelector('#kb-up-err'); if (e) e.style.display = 'block'; return; }
    var src = (srcEl && srcEl.value) || '手动上传';
    var ups = kbUploads(h, id);
    var rng = rngOf(h, 'kbup|' + id + '|' + name);
    var slices = 20 + Math.floor(rng() * 300);
    ups.push({
      id: 'up-' + id + '-' + (ups.length + 1),
      name: '《' + name.replace(/^《|》$/g, '') + '》',
      source: src, sizeKB: slices * (0.6 + rng() * 1.2), updatedDay: 0,
      slices: slices, status: 'indexed', indexed: false, validUntil: '2028-03', owner: '当前用户'
    });
    global.V10UI.closeSheet();
    h.toast('已上传「' + name + '」· 重建索引后才会被检索到', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-doc-filter'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var st = kstate(h); st.kbDocFilter = st.kbDocFilter || {};
    st.kbDocFilter[p[0]] = p[1];
    st.page = 1;
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-doc-offline'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var kb = resolveKb(h, p[0]);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var doc = kbDocList(h, p[0], kb.docs, 'all').filter(function (x) { return x.id === p[1]; })[0]
      || kbUploads(h, p[0]).filter(function (x) { return x.id === p[1]; })[0];
    if (!doc) { h.toast('文档不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '下线文档', desc: '将「' + doc.name + '」从检索范围下线？', tone: 'danger',
      perm: 'knowledge:doc:offline', requireReason: true, confirmText: '确认下线',
      impacts: [
        { label: '文档', value: doc.name },
        { label: '切片数', value: h.fmt.int(doc.slices) + ' 个' },
        { label: '下线后', value: '该文档不再被检索到，本库文档数 -1', tone: 'danger' }
      ],
      action: '下线文档', target: p[0] + ' · ' + doc.name, auditImpact: '下线 ' + doc.name,
      onConfirm: function () {
        applyDocOp(h, p[0], doc.id, 'offline');
        h.toast('已下线「' + doc.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* 恢复下线文档 —— 此前「下线」是单向的：列表里能筛出已下线文档，
     但那一行只有「下线/删除」两个按钮，想放回检索池**没有任何入口**。
     会话态里 offline 标记本来就能删，缺的只是一个动作。 */
  ACTIONS['kb-doc-restore'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var kb = resolveKb(h, p[0]);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var doc = kbDocList(h, p[0], kb.docs, 'all').filter(function (x) { return x.id === p[1]; })[0]
      || kbUploads(h, p[0]).filter(function (x) { return x.id === p[1]; })[0];
    if (!doc) { h.toast('文档不存在', 'bad'); return; }
    applyDocOp(h, p[0], doc.id, 'restore');
    h.toast('已恢复「' + doc.name + '」，重新参与检索', 'ok');
    h.navigate({}, { scroll: false });
  };
  ACTIONS['kb-doc-delete'] = function (id, btn, h) {
    var p = String(id == null ? '' : id).split('|');
    var kb = resolveKb(h, p[0]);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var doc = kbDocList(h, p[0], kb.docs, 'all').filter(function (x) { return x.id === p[1]; })[0]
      || kbUploads(h, p[0]).filter(function (x) { return x.id === p[1]; })[0];
    if (!doc) { h.toast('文档不存在', 'bad'); return; }
    h.dangerConfirm(h, {
      title: '删除文档', desc: '删除「' + doc.name + '」？删除后不可检索、也不可在清单中恢复。', tone: 'danger',
      perm: 'knowledge:doc:delete', requireReason: true, confirmText: '确认删除',
      impacts: [
        { label: '文档', value: doc.name },
        { label: '切片数', value: h.fmt.int(doc.slices) + ' 个' },
        { label: '删除后', value: '不可恢复，本库文档数 -1', tone: 'danger' }
      ],
      action: '删除文档', target: p[0] + ' · ' + doc.name, auditImpact: '删除 ' + doc.name,
      onConfirm: function () {
        applyDocOp(h, p[0], doc.id, 'delete');
        h.toast('已删除「' + doc.name + '」', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };
  /* 知识库详情的 hash —— 供通知回执回跳。域 / 能力 id 从 CAPS 取，不在别处再写一份字面量。 */
  function kbHref(h, kb) {
    var c = (h.capById ? h.capById('knowledge') : null) || {};
    return '#/' + (c.domain || 'insight') + '/' + (c.id || 'knowledge') + '/' + kb.id;
  }

  ACTIONS['kb-rebuild'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var ix = kbIndexOf(h, kb);
    if (ix.building) { h.toast('索引正在构建中，请稍候', 'info'); return; }
    var docs = kbDocCount(h, kb);
    if (docs <= 0) { h.toast('还没有文档，先上传文档再重建索引', 'warn'); return; }
    h.dangerConfirm(h, {
      title: '重建索引', desc: '对「' + kb.name + '」做一次全量重建？', tone: 'danger',
      perm: 'knowledge:index:rebuild', requireReason: true, confirmText: '开始重建',
      impacts: [
        { label: '全量文档', value: h.fmt.int(docs) + ' 篇' },
        { label: '预计耗时', value: '约 ' + kbDur(kb.chunks || docs * 200) },
        { label: '期间影响', value: '检索走旧索引 v' + ix.version + '，不会中断' }
      ],
      action: '重建索引', target: id + ' · ' + kb.name, auditImpact: '全量 ' + docs + ' 篇',
      onConfirm: function () {
        kbIndexOf(h, kb).building = true;
        h.navigate({}, { scroll: false });
        var fmt = h.fmt;
        setTimeout(function () {
          var done = kbIndexOf(h, kb);
          done.building = false;
          var nv = (done.version || 0) + 1;
          var vectors = Math.max(1, Number(kb.chunks) || 0) + kbUploads(h, id).reduce(function (s, d) { return s + (d.slices || 0); }, 0);
          done.version = nv; done.builtDay = 0; done.vectors = vectors; done.dur = kbDur(vectors); done.status = 'ok'; done.rolled = {};
          /* 写新版本前先删掉同号或更高的历史行 —— 回滚到 v2 再重建会生成 v3，
       不清理就会在版本历史里留下**两行 v3 · 当前**（实测踩到）。 */
    done.history = (done.history || []).filter(function (r) { return r.v < nv; });
    done.history.unshift({ v: nv, builtDay: 0, vectors: vectors, kind: '全量重建', by: done.by });
          kbUploads(h, id).forEach(function (d) { d.indexed = true; });
          h.navigate({}, { scroll: false });
          h.toast('索引重建完成：v' + nv + ' · ' + fmt.int(docs) + ' 篇 / ' + fmt.int(vectors) + ' 向量', 'ok');
          /* 同时写进通知中心：这是 4 分钟级的后台任务，结论不该只挂在一条会消失的 toast 上。 */
          if (h.asyncResult) h.asyncResult({
            title: '索引重建完成',
            desc: '「' + kb.name + '」v' + (nv - 1) + ' → v' + nv + ' · ' + fmt.int(docs) + ' 篇 / ' + fmt.int(vectors) + ' 个向量',
            href: kbHref(h, kb),
            tone: 'ok'
          });
        }, 1400);
      }
    });
  };
  ACTIONS['kb-rollback'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var ix = kbIndexOf(h, kb);
    var pv = kbPrevVersion(ix);
    if (pv == null) { h.toast('没有可回滚的历史版本', 'info'); return; }
    var target = null;
    for (var i = 0; i < ix.history.length; i++) if (ix.history[i].v === pv) target = ix.history[i];
    var delta = Math.max(0, (ix.vectors || 0) - (target ? target.vectors : 0));
    var fmt = h.fmt;
    h.dangerConfirm(h, {
      title: '回滚索引', desc: '把「' + kb.name + '」回滚到 v' + pv + '？', tone: 'danger',
      perm: 'knowledge:index:rollback', requireReason: true, confirmText: '确认回滚',
      impacts: [
        { label: '当前版本', value: 'v' + ix.version },
        { label: '目标版本', value: 'v' + pv + '（' + fmt.rel(target ? target.builtDay : 0) + '）' },
        { label: '回滚后', value: fmt.int(delta) + ' 条新增内容将检索不到', tone: 'danger' }
      ],
      action: '回滚索引', target: id + ' · v' + ix.version + ' → v' + pv, auditImpact: '回滚 ' + delta + ' 条向量',
      onConfirm: function () {
        var st2 = kbIndexOf(h, kb);
        var fromV = st2.version;   /* 回滚前的版本：下一行 st2.version 就被改写成 pv，回执要用旧值 */
        st2.rolled[st2.version] = true;
        st2.version = pv; st2.vectors = target.vectors; st2.builtDay = target.builtDay; st2.dur = kbDur(target.vectors);
        h.toast('已回滚到 v' + pv, 'warn');
        if (h.asyncResult) h.asyncResult({
          title: '索引回滚完成',
          desc: '「' + kb.name + '」v' + fromV + ' → v' + pv + ' · ' + fmt.int(delta) + ' 条新增内容已检索不到',
          href: kbHref(h, kb),
          tone: 'bad'
        });
        h.navigate({}, { scroll: false });
      }
    });
  };
  ACTIONS['kb-publish'] = function (id, btn, h) {
    var kb = resolveKb(h, id);
    if (!kb) { h.toast('知识库不存在', 'bad'); return; }
    var ix = kbIndexOf(h, kb);
    var docs = kbDocCount(h, kb);
    var agents = kbPubAgents(h, id);
    var fmt = h.fmt;
    h.dangerConfirm(h, {
      title: '发布知识库', desc: '发布「' + kb.name + '」，对本库引用的 Agent 生效？', tone: 'normal',
      perm: 'knowledge:kb:publish', requireReason: true, confirmText: '确认发布',
      impacts: [
        { label: '文档', value: fmt.int(docs) + ' 篇' },
        { label: '索引版本', value: 'v' + ix.version },
        { label: '发布后', value: '本库对 ' + agents + ' 个 Agent 生效，可被检索到' }
      ],
      action: '发布知识库', target: id + ' · ' + kb.name, auditImpact: docs + ' 篇 / ' + agents + ' 个 Agent',
      onConfirm: function () {
        var st2 = kstate(h); st2.kbPublic = st2.kbPublic || {}; st2.kbPublic[id] = true;
        h.toast('已发布「' + kb.name + '」，可在「全部知识库」中检索到', 'ok');
        h.navigate({}, { scroll: false });
      }
    });
  };

  /* -------------------------------------------------- 对外：列表页 overlay 与草稿卡片 */
  function kbListOverlay(state, h, rows) {
    var st = state || kstate(h);
    var out = rows.slice();
    var drafts = (st.newObjs || {})['knowledge'] || [];
    for (var i = 0; i < drafts.length; i++) {
      var o = drafts[i];
      if (!(st.kbPublic && st.kbPublic[o.id])) continue;
      var kb = resolveKb(h, o.id);
      var ix = kbIndexOf(h, kb);
      out.push({
        id: o.id, name: o.name + '（本会话新建）', _kbSession: 1, docs: kbDocCount(h, kb), chunks: ix.vectors || 0,
        chunkSize: o.slice || '512', embed: 'text-embedding-v3',
        lastSync: 0, lastSyncText: 0, refAgents: kbPubAgents(h, o.id),
        hits: 0, zeroRate: 0, status: 'ok', statusText: '可用'
      });
    }
    return out;
  }
  global.KB_SESSION = {
    /* 列表页「文档数」列与「文档总量」KPI 都走这里 —— 会话新增行直接用它的 docs，避免二次叠加 */
    docCountOf: function (h, row) { return (row && row._kbSession) ? (Number(row.docs) || 0) : kbDocCount(h, row); },
    listOverlay: kbListOverlay,
    isPublic: kbIsPublic,
    resolve: resolveKb,
    draftCard: kbDraftCard,
    labelOf: function (h, id) { return kbIsPublic(h, id) ? '可用' : null; },
    /* v26：桌面式管理的对外数据口 —— 文档类型/状态/清单/写入只有这一份实现，
       v26-kb-desk.js 不再自己判类型、自己写会话态（两处口径会分叉） */
    docTypes: function () { return DOC_TYPES; },
    docTypeOf: docTypeOf,
    /* 桌面视图的调用一律是 f(h, 数据) 的形状，与 docTypeOf 对齐；
       kbDocStatus 本身只吃文档对象，这里补一层，免得调用方把 h 传成文档。 */
    docStatus: function (h, d) { return kbDocStatus(d); },
    planHue: planHue,
    personColor: personColor,
    docsOf: kbDocsOf,
    applyDocOp: applyDocOp
  };

})(window);
