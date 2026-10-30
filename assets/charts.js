/* SECTION: charts-core
 * 纯 SVG 图表组件，零外部依赖。
 * 每个图表都接受 data + meta，并把口径信息渲染出来 —— 图表不解释口径就是误导。
 */
(function (global) {
  'use strict';

  function el(tag, attrs, children) {
    var s = '<' + tag;
    for (var k in attrs) if (attrs[k] != null) s += ' ' + k + '="' + attrs[k] + '"';
    if (children == null) return s + '/>';
    return s + '>' + children + '</' + tag + '>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* SECTION: sparkline */
  /** 迷你趋势线，用于表格与指标卡。含末点高亮与异常标红 */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 88, h = opts.height || 26;
    if (!values || !values.length) return '<svg width="' + w + '" height="' + h + '"></svg>';
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var span = (max - min) || 1;
    var step = values.length > 1 ? w / (values.length - 1) : 0;
    var pts = values.map(function (v, i) {
      return (i * step).toFixed(1) + ',' + (h - 3 - ((v - min) / span) * (h - 6)).toFixed(1);
    });
    var color = opts.abnormal ? '#b91c1c' : (opts.color || '#2563eb');
    var last = pts[pts.length - 1].split(',');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      el('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', opacity: 0.85 }) +
      el('circle', { cx: last[0], cy: last[1], r: 2, fill: color }) +
      '</svg>';
  }

  /* SECTION: chart-width（v27 · 工作台走查）
     这张图的 viewBox 是定宽 760、又写着 width="100%" + preserveAspectRatio="none" ——
     在 1800px 宽的卡片里，**图内所有文字被横向拉胖 1.9 倍**（刻度字发宽、发虚，
     实测 1600 视口下拉伸 1.90×）。几何跟着拉伸是对的（柱子要占满宽度），
     但文字不该跟着变形 —— 所以按内容区**真实宽度**出图：viewBox 宽度 ≈ 卡片宽度，
     拉伸比接近 1，文字就是正常字宽；几何也顺带按真实宽度排版（柱子间距不再被拉伸放大）。
     拿不到 DOM 时退回原默认值，图表不会因此画不出来。 */
  function chartWidth() {
    try {
      var d = global.document;
      var box = d && d.getElementById ? d.getElementById('content') : null;
      var cw = (box && box.clientWidth) || (global.innerWidth ? global.innerWidth - 260 : 0);
      if (!cw) return 760;
      return Math.max(560, Math.min(2400, cw - 80));      /* 减 .content 内边距 48 + .card 内边距 32 */
    } catch (e) { return 760; }
  }

  /** 栅格里的**单列**画布宽度（DS 形态的两列小图用）。
      chartWidth() 给的是"整块内容区"；两列并排时若仍按整宽出 viewBox，
      SVG 会被等比缩小到一半 → 5 条刻度线压进 75px，字挤成一团（实测 qwen-plus 的
      「API 请求次数 / Tokens」两张图左侧刻度互相压字）。
      +32 是把 chartWidth() 里减掉的 .card 内边距补回来：.ds-groups 直接挂在内容区，
      不套 .card。 */
  function gridWidth(cols, gap) {
    var n = cols || 1, g = gap == null ? 14 : gap;
    return Math.round((chartWidth() + 32 - g * (n - 1)) / n);
  }

  /* SECTION: line-chart
   * 时序折线图。支持双序列（调用量柱 + 成功率线）、事故区间底纹、发布竖线标记。
   * v10b（走查 1.7★）：P99 不再与成功率挤同一个右轴 —— 旧写法把 P99 映射到 0-8s 却不画
   * 对应刻度，橙色虚线悬挂在两个轴之间无处读数（三序列双轴是误读重灾区）。
   * 现在 P99 拆到主图下方独立泳道：自带 0-8s 左轴、事故底纹同步、共享 X 轴。
   */
  function lineChart(points, opts) {
    opts = opts || {};
    var w = opts.width || chartWidth();
    var h = opts.height || 220;
    var padL = 46, padR = 46, padT = 14, padB = 26;
    /* P99 独立泳道（v27 修正）：这里的常数是**画布增量**，必须把三块都算进去 ——
       间距 6 + 泳道绘图高 + 共享 X 轴标签带（padB）。
       旧值 58 只算了「6 + 泳道 + 一点」，被 X 轴标签带吃掉 26 后泳道只剩 26px，
       5 个刻度（0/2/4/6/8s）挤在 26px 里、相邻只剩 6.5px（字高 11px）→ 叠成一团糊字。
       现在给泳道 56px 绘图高（刻度间距 14px），标签才读得出来。 */
    var P99_PLOT = 56;
    var p99H = opts.showP99 ? (6 + P99_PLOT + padB) : 0;
    var H = h + p99H;                   /* 画布总高 */
    var iw = w - padL - padR, ih = h - padT - padB;
    if (!points || points.length < 2) {
      return '<div class="chart-empty">数据点不足，无法绘制趋势</div>';
    }

    var maxCalls = Math.max.apply(null, points.map(function (p) { return p.calls; })) || 1;
    /* v27（对标 DeepSeek 控制台）：轴顶不再等于数据最大值 —— 步长取整、留 ~12% 头 */
    var _ax = axisTicks(maxCalls, 4);
    var axisMax = _ax.top, axisStep = _ax.step;
    var parts = [];
    var bw = Math.max(2, (iw / points.length) * 0.62);
    var P99_MAX = 8000;                 /* P99 泳道刻度上限 8s（与旧映射一致） */
    /* v27：index→x 的**唯一**换算，全图（柱、折线、P99、事故底纹、发布线、X 轴标签）都走它。
       旧写法把点中心铺满 padL..padL+iw，可柱子是有宽度的：首/末柱各探出半柱宽 ——
       实测 24h 首柱左沿 x=28.6（左轴文字右沿 x=40）压掉 11.4px；6h 首柱左沿 x=-23.7，
       整半截画到 viewBox 之外被裁掉（第一根柱子变半根）。现在两端各让出半柱，柱子落在绘图区内。 */
    var xInset = bw / 2, xSpan = Math.max(0, iw - bw);
    function xAt(i) { return padL + xInset + (i / (points.length - 1)) * xSpan; }

    // 事故区间底纹
    (opts.incidents || []).forEach(function (inc) {
      inc._ranges = [];
    });
    points.forEach(function (p, i) {
      (p.incidentIds || []).forEach(function (iid) {
        var inc = (opts.incidents || []).filter(function (x) { return x.id === iid; })[0];
        if (inc) inc._ranges.push(i);
      });
    });
    (opts.incidents || []).forEach(function (inc) {
      if (!inc._ranges || !inc._ranges.length) return;
      var i0 = Math.min.apply(null, inc._ranges), i1 = Math.max.apply(null, inc._ranges);
      var x0 = xAt(i0) - bw / 2;
      var x1 = xAt(i1) + bw / 2;
      parts.push(el('rect', {
        x: x0.toFixed(1), y: padT, width: Math.max(3, x1 - x0).toFixed(1), height: ih,
        fill: '#dc2626', opacity: 0.07
      }));
      parts.push(el('text', {
        x: ((x0 + x1) / 2).toFixed(1), y: padT + 10, 'text-anchor': 'middle',
        'font-size': 10.5, fill: '#b91c1c'
      }, esc(inc.level)));
      /* P99 泳道同步事故底纹：排障时延异常与事故区间本就该能对上 */
      if (p99H) parts.push(el('rect', {
        x: x0.toFixed(1), y: h + 6, width: Math.max(3, x1 - x0).toFixed(1), height: p99H - 6 - padB,
        fill: '#dc2626', opacity: 0.07
      }));
    });

    // 发布竖线
    (opts.deploys || []).forEach(function (d) {
      var idx = -1;
      points.forEach(function (p, i) { if ((p.deploys || []).indexOf(d.id) >= 0) idx = i; });
      if (idx < 0) return;
      var x = xAt(idx);
      parts.push(el('line', { x1: x.toFixed(1), y1: padT, x2: x.toFixed(1), y2: padT + ih, stroke: '#15803d', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 }));
      parts.push(el('text', { x: (x + 3).toFixed(1), y: padT + ih - 4, 'font-size': 10.5, fill: '#15803d' }, esc(d.version)));
    });

    // Y 轴网格与刻度（调用量）
    for (var g = 0; g <= 4; g++) {
      var y = padT + ih - (g / 4) * ih;
      parts.push(el('line', { x1: padL, y1: y.toFixed(1), x2: padL + iw, y2: y.toFixed(1), stroke: '#eef1f6', 'stroke-width': 1 }));
      parts.push(el('text', { x: padL - 6, y: (y + 3).toFixed(1), 'text-anchor': 'end', 'font-size': 11, fill: '#6b7484' }, fmtAxis(axisMax * g / 4, axisStep)));
    }

    // 调用量柱（按轴顶缩放：轴顶高于最大值，柱子就不会顶到天上）
    points.forEach(function (p, i) {
      var x = xAt(i);
      var bh = (p.calls / axisMax) * ih;
      parts.push(el('rect', {
        x: (x - bw / 2).toFixed(1), y: (padT + ih - bh).toFixed(1), width: bw.toFixed(1), height: Math.max(1, bh).toFixed(1),
        fill: '#dbe7ff', rx: 1.5, class: 'chart-bar', 'data-i': i
      }));
    });

    // 成功率折线（右轴 90%-100%）
    var srPts = [], srMin = 0.90;
    points.forEach(function (p, i) {
      if (p.successRate == null) return;
      var x = xAt(i);
      var ratio = Math.max(0, Math.min(1, (p.successRate - srMin) / (1 - srMin)));
      srPts.push(x.toFixed(1) + ',' + (padT + ih - ratio * ih).toFixed(1));
    });
    if (srPts.length > 1) {
      parts.push(el('polyline', { points: srPts.join(' '), fill: 'none', stroke: '#2563eb', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    }

    // P99 独立泳道（v10b）：有自己的左轴（0-8s）、网格与折线，不再悬挂在双轴之间
    if (opts.showP99) {
      var pTop = h + 6, pBot = pTop + P99_PLOT, pH = P99_PLOT;
      // 泳道标题 + 与主图的分隔线
      parts.push(el('line', { x1: padL, y1: (pTop - 6).toFixed(1), x2: padL + iw, y2: (pTop - 6).toFixed(1), stroke: '#e6e9f0', 'stroke-width': 1 }));
      parts.push(el('text', { x: padL, y: (pTop - 12).toFixed(1), 'font-size': 11, fill: '#b45309', 'font-weight': 600 }, 'P99 时延（独立轴 0–8s）'));
      // 左轴刻度与网格：0 / 2 / 4 / 6 / 8s
      [0, 2000, 4000, 6000, P99_MAX].forEach(function (v) {
        var yy = pBot - (v / P99_MAX) * pH;
        parts.push(el('line', { x1: padL, y1: yy.toFixed(1), x2: padL + iw, y2: yy.toFixed(1), stroke: '#f5e9dc', 'stroke-width': 1 }));
        parts.push(el('text', { x: padL - 6, y: (yy + 3).toFixed(1), 'text-anchor': 'end', 'font-size': 11, fill: '#6b7484' }, (v / 1000) + 's'));
      });
      var pPts = [];
      points.forEach(function (p, i) {
        if (!p.p99) return;
        var x = xAt(i);
        var ratio = Math.max(0, Math.min(1, p.p99 / P99_MAX));
        pPts.push(x.toFixed(1) + ',' + (pBot - ratio * pH).toFixed(1));
      });
      if (pPts.length > 1) parts.push(el('polyline', { points: pPts.join(' '), fill: 'none', stroke: '#b45309', 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }));
    }

    // X 轴标签（自动抽稀）—— 两泳道共用一套 X 轴，画在最底
    var labelStep = Math.max(1, Math.ceil(points.length / 7));
    points.forEach(function (p, i) {
      if (i % labelStep !== 0 && i !== points.length - 1) return;
      var x = xAt(i);
      parts.push(el('text', { x: x.toFixed(1), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#6b7484' }, esc(fmtTs(p.ts, opts.granularity))));
    });

    // 右轴刻度（成功率）
    [1, 0.975, 0.95, 0.925, 0.90].forEach(function (v, i) {
      var y = padT + (i / 4) * ih;
      parts.push(el('text', { x: w - padR + 6, y: (y + 3).toFixed(1), 'font-size': 11, fill: '#6b7484' }, (v * 100).toFixed(1) + '%'));
    });

    // 悬浮提示层（覆盖主图 + P99 泳道：排障时鼠标停在哪条线上都该读得到数）
    parts.push(el('rect', { x: padL, y: padT, width: iw, height: H - padT - padB, fill: 'transparent', class: 'chart-hit', 'data-chart': 'line' }));

    var legend = '<div class="chart-legend">' +
      '<span><i style="background:#dbe7ff"></i>调用量（左轴）</span>' +
      '<span><i style="background:#2563eb"></i>成功率（右轴 90–100%）</span>' +
      (opts.showP99 ? '<span><i style="background:#b45309"></i>P99 时延（下方独立轴 0–8s）</span>' : '') +
      ((opts.incidents || []).length ? '<span><i style="background:rgba(220,38,38,.18)"></i>事故区间</span>' : '') +
      ((opts.deploys || []).length ? '<span><i style="background:#15803d"></i>发布</span>' : '') +
      '</div>';

    /* 图表无障碍：图例在 SVG 外面（读屏能读到序列名），但图本身此前没有任何标签 ——
       加 role=img + aria-label，把「哪几个序列、几个点、什么粒度」一句话说清。 */
    var GRAN_CN = { '5m': '5 分钟', '1h': '小时', '3h': '3 小时', '1d': '天' };
    var aria = '调用量、成功率' + (opts.showP99 ? '、P99 时延' : '') + '趋势图：共 ' + points.length +
      ' 个数据点（' + (GRAN_CN[opts.granularity] || '小时') + '粒度）' +
      ((opts.incidents || []).length ? '，含 ' + opts.incidents.length + ' 段事故区间' : '');

    return '<div class="chart-wrap">' +
      '<svg class="chart" role="img" aria-label="' + esc(aria) + '" viewBox="0 0 ' + w + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" ' +
      'data-points=\'' + esc(JSON.stringify(points.map(function (p) { return { ts: p.ts, calls: p.calls, sr: p.successRate, p99: p.p99, cost: p.cost, inc: p.incidentIds }; }))) + '\' ' +
      /* 粒度也写进 DOM：悬浮提示的时间标签要和 x 轴用同一套格式（否则 5 分钟粒度会印成整点） */
      'data-gran="' + esc(opts.granularity || '1h') + '" ' +
      /* 悬浮提示的十字线要落在同一套 x 上（否则提示线会跟柱子错开）—— 把换算结果写进 DOM */
      'data-x0="' + xAt(0).toFixed(1) + '" data-dx="' + (xSpan / (points.length - 1)).toFixed(3) + '" ' +
      'data-padl="' + padL + '" data-padr="' + padR + '" data-padt="' + padT + '" data-ih="' + ih + '" data-iw="' + iw + '">' +
      parts.join('') + '</svg>' + legend + '</div>';
  }

  function fmtTs(ts, granularity) {
    var d = new Date(ts);
    var mm = d.getMonth() + 1, dd = d.getDate(), hh = d.getHours();
    if (granularity === '1d') return mm + '/' + dd;
    if (granularity === '3h') return mm + '/' + dd + ' ' + (hh < 10 ? '0' : '') + hh + 'h';
    /* 5 分钟粒度（近 1 小时窗口）：只印小时会 12 个点一个样，必须带分钟 */
    if (granularity === '5m') return (hh < 10 ? '0' : '') + hh + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    return (hh < 10 ? '0' : '') + hh + ':00';
  }

  /* SECTION: chart-tip
   * 悬浮提示的内容（纯字符串函数：探针里可以直接验，不必起 DOM）。
   * v27 对标 DeepSeek 控制台的 tooltip 结构：
   *   标题行 = 该点时间 + **该点合计**（他们写「2026-10-08 ¥22.54」）；
   *   下面每行 = **色块** + 序列名 + 值 —— 色块把数字对回图上的哪条线/哪根柱。
   * 我们比他们多两行（成功率、P99）与事故标记：这是排障图，不是消费构成图。
   * 时间标签直接用 x 轴那一套（fmtTs），不再印「10/8 14:00:00」这种带秒的噪声。 */
  var SERIES = [
    { key: 'calls', label: '调用量', color: '#dbe7ff' },
    { key: 'sr', label: '成功率', color: '#2563eb' },
    { key: 'p99', label: 'P99', color: '#b45309' }
  ];
  function tipHtml(p, granularity) {
    if (!p) return '';
    if (p.__html) return String(p.__html);      /* 兼容旧调用方直接塞 html 的情况 */
    var rows = '<div class="ct-row"><i style="background:' + SERIES[0].color + '"></i>' +
      '<span>调用量</span><b>' + fmtNum(p.calls) + '</b></div>';
    if (p.sr != null) rows += '<div class="ct-row"><i style="background:' + SERIES[1].color + '"></i>' +
      '<span>成功率</span><b>' + (Math.round(p.sr * 1000) / 10) + '%</b></div>';
    if (p.p99) rows += '<div class="ct-row"><i style="background:' + SERIES[2].color + '"></i>' +
      '<span>P99</span><b>' + fmtDur(p.p99) + '</b></div>';
    if (p.cost != null) rows += '<div class="ct-row"><i style="background:#15803d"></i>' +
      '<span>成本</span><b>¥' + Number(p.cost).toFixed(4) + '</b></div>';
    return '<div class="ct-hd"><span>' + esc(fmtTs(p.ts, granularity)) + '</span>' +
      '<b>' + fmtNum(p.calls) + ' 次</b></div>' + rows +
      (p.inc && p.inc.length ? '<div class="ct-row bad"><i style="background:#dc2626"></i>' +
        '<span>事故</span><b>' + esc(p.inc.join(', ')) + '</b></div>' : '');
  }
  /* 紧凑数字：全平台**唯一**的量级写法 = 亿 / 万（v28 起不再产出 'k'）。
     为什么砍掉 k：
       ① 同屏混量级。agent 监控一屏里「调用量 4.7k」与「token 667.4万」并存，
          读者要在脑内先做一次单位换算才能比大小；中文界面的母语量级是「万」。
       ② 同一个指标在不同屏换量级。触达人数在 user-ops 是「3.2万」，
          紧挨着的 holdout 对照却是「1.8k」—— 这两个数是**同一张对照表里的两行**，
          用两种单位写等于让读者自己发现"其实一样大"。
       ③ 1 万以下直接印千分位整数（1,800），不再出现"没有量级词的裸小数"（1.8k）。
     ⚠ 取整：一律 toFixed(1)。凡是用 toFixed(0) 手写量级的地方（如 kol 粉丝数）
       会把 9.6 万印成「10w」—— 多算出一万，属于会误导决策的错误。
     ⚠ 轴刻度也走这里（fmtAxis → fmtNum），所以刻度字宽一并受控：
       万以下最长 5 字（9,999），左轴给 46px 内 40px 可用宽，不会裁字。 */
  function fmtNum(n) {
    if (n == null) return '—';
    var v = Number(n);
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return Math.round(v).toLocaleString('zh-CN');
  }
  /* 轴刻度：只把**顶部**取整还不够 —— 顶取 250、四等分就出来 62.5，刻度印成 63/125/188，
     照样没法口算。所以取整的是**步长**：从 1/1.5/2/2.5/3/4/5/6/7.5/8 ×10^k 里挑第一个
     够用的，再乘以格数得顶部 —— 四个刻度都整（0/75/150/225/300），并自带 ~12% 留头，
     最高柱不会贴着顶格线（对标 DeepSeek 控制台 0/50/100 装最高约 80 的做法）。 */
  function axisTicks(max, intervals) {
    var n = intervals || 4;
    var top0 = (max > 0 ? max : 1);
    var need = top0 * 1.12 / n;
    var mag = Math.pow(10, Math.floor(Math.log10(need)));
    var mults = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
    for (var k = 0; k < 3; k++) {
      for (var i = 0; i < mults.length; i++) {
        var s = mults[i] * mag * Math.pow(10, k);
        if (s >= need) return { step: s, top: s * n };
      }
    }
    return { step: mag * 10, top: mag * 10 * n };
  }
  /** 轴刻度文字：非整数刻度就印一位小数（步长 2.5 要印 2.5，不能四舍五入成 3 —— 刻度就不准了），
      其它仍走 fmtNum（1.0万 / 9,999 这类紧凑写法；v28 起与全站同为「亿/万」量级，不混 k） */
  function fmtAxis(v, step) {
    if (Math.abs(v - Math.round(v)) > 1e-9) return v.toFixed(1);
    return fmtNum(v);
  }

  /* SECTION: bar-chart */
  /** 横向条形图，用于维度分布（错误码、意图、模型） */
  function barChart(rows, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var colorFn = opts.colorFn || function () { return '#2563eb'; };
    return '<div class="hbar-list">' + rows.map(function (r) {
      var pctv = (r.value / max) * 100;
      return '<div class="hbar-row" ' + (r.traceable ? 'data-drill="' + esc(r.drillKey || '') + '"' : '') + '>' +
        '<span class="hbar-label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<span class="hbar-track"><i style="width:' + pctv.toFixed(1) + '%;background:' + colorFn(r) + '"></i></span>' +
        '<span class="hbar-val">' + esc(r.display != null ? r.display : fmtNum(r.value)) +
        (r.share != null ? ' <em>' + (r.share * 100).toFixed(1) + '%</em>' : '') + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* SECTION: ds-usage-charts（v32，2026-10-15）
     业主清单第 ④ 项：运行监控要「参考 DS 控制台样子」（DeepSeek 平台的用量/账单页）。
     它那两张图这里各补一个原语：
       · stackedBar —— 按维度堆叠的柱（消费金额 / 请求次数），每段挂原生 tooltip；
       · areaChart  —— 单序列面积图（按模型的请求次数 / Tokens），浅填充 + 折线。
     ⚠ 两者都**不自己造 hover**：每段/每桶挂 data-tip，交给 app.js 既有的 tip 机制
       （一处实现、全站一致；自造一套 hover 会与图表的 tooltip 打架）。 */
  var DS_COLORS = ['#4d6bfe', '#7a5cff', '#22b8cf', '#f59e0b', '#0ea5e9', '#a855f7'];

  /** 取「好看的刻度上限 + 步长」（复用 axisTicks，避免与折线图两套算法） */
  function niceTop(max, intervals) {
    var ax = axisTicks(Math.max(1, max), intervals || 4);
    return { top: ax.top, step: ax.step };
  }

  function tsLabel(ts, granularity) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    /* 只有「按天」的粒度才显示日期；1h/5m/15m/6h 都显示时刻 ——
       24 小时窗口里若显示日期，24 个刻度会印出 24 个一模一样的 10/15（实测踩过）。 */
    if (granularity === '1d' || granularity === 'day') return p(d.getMonth() + 1) + '/' + p(d.getDate());
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 堆叠柱。points 为 timeseries 的桶，series[i].values 与 points 一一对应。
   * opts: { height, granularity, fmt(v), padL, barMax, width, colTips }
   *   colTips：按列的富浮层数据（每个点一份 { title, totalText, rows:[{label,sub,color,valueText}] }）。
   *     传了就切到「整列浮层」模式：段上不再挂 data-tip，改由 app.js 的 bindChartHover 接管，
   *     悬浮整列时给虚线指示线 + 其余列变淡 + 浮层列出当天各分组金额（对标 DeepSeek 控制台）。
   *     不传 = 老行为（每段一个原生 tooltip），监控页等调用方零变化。
   */
  function stackedBar(points, series, opts) {
    opts = opts || {};
    var w = opts.width || chartWidth();
    var h = opts.height || 240;
    /* opts.padL：Y 轴文字（金额 ¥ / token 的「万」）比默认 46px 宽时由调用方加宽，
       否则贴边的刻度会被 SVG 裁掉半截（实测「¥16.00」「466.8万」各溢出一截）。 */
    var padL = opts.padL || 46, padR = 16, padT = 12, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    if (!points || !points.length) return '<div class="ds-chart-empty">该范围内没有数据</div>';
    var totals = points.map(function (p, i) {
      return series.reduce(function (s, se) { return s + (se.values[i] || 0); }, 0);
    });
    var nt = niceTop(Math.max.apply(null, totals), 4);
    var top = nt.top || 1;
    var bw = iw / points.length;
    /* opts.barMax：柱宽上限（默认 26）。
       加它是因为「1 小时窗口」只有 1 个桶时，26px 的柱子戳在 800px 宽的图上像根牙签；
       调用方（成本页）按桶数传更大值。默认值不变，其余调用方不受影响。 */
    var barW = Math.max(3, Math.min(opts.barMax || 26, bw * 0.62));
    var fmt = opts.fmt || fmtNum;
    var rich = !!(opts.colTips && opts.colTips.length === points.length);
    var g = [];
    /* 悬浮指示线：先画（在柱底下），app.js 只改它的 x 与 opacity */
    if (rich) g.push('<line class="sb-guide" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" opacity="0"/>');
    /* Y 轴网格 + 刻度 */
    for (var t = 0; t <= top + 1e-9; t += nt.step) {
      var y = padT + ih - (t / top) * ih;
      g.push(el('line', { x1: padL, x2: w - padR, y1: y, y2: y, stroke: 'var(--line-soft)', 'stroke-width': 1 }));
      g.push('<text x="' + (padL - 8) + '" y="' + (y + 4) + '" class="ds-axis" text-anchor="end">' + esc(fmt(t)) + '</text>');
    }
    /* 柱：每个桶从下往上堆 */
    points.forEach(function (p, i) {
      var x = padL + i * bw + (bw - barW) / 2;
      var acc = 0, segs = [];
      series.forEach(function (se) {
        var v = se.values[i] || 0;
        if (v <= 0) return;
        var hh = (v / top) * ih;
        var y = padT + ih - ((acc + v) / top) * ih;
        var attrs = {
          x: x, y: y, width: barW, height: Math.max(1, hh), rx: 2, fill: se.color
        };
        /* rich 模式：段不挂 data-tip —— 整列浮层已经把这些数字全列出来了，
           再叠一层单段原生 tip，鼠标停在段上会先弹小的、再弹大的（两套浮层打架）。 */
        if (!rich) attrs['data-tip'] = tsLabel(p.ts, opts.granularity) + ' · ' + se.label + ' ' + fmt(v);
        segs.push(el('rect', attrs));
        acc += v;
      });
      g.push(rich ? '<g class="sb-col" data-col="' + i + '">' + segs.join('') + '</g>' : segs.join(''));
    });
    /* 覆盖整块绘图区的命中层：mousemove 按 x 反算列号（比给每列挂一个 1px 宽的命中区好点中） */
    if (rich) g.push(el('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent', class: 'chart-hit' }));
    /* X 轴标签：最多 8 个，避免挤成糊字。
       v42：**末点必须标出来** —— 30 天窗口按 i%4 抽样时最后一个是 10/28，
       而图上最后一根柱子其实是 10/29，读者会以为数据停在昨天。
       末点与前一个已标点太近时，去掉前一个、换上末点（不是两个都标，会叠字）。 */
    var every = Math.max(1, Math.ceil(points.length / 8));
    var marks = {}, lastI = points.length - 1;
    for (var mk = 0; mk <= lastI; mk += every) marks[mk] = 1;
    var prevMarked = Math.floor(lastI / every) * every;
    if (prevMarked !== lastI && lastI - prevMarked < every * 0.6) delete marks[prevMarked];
    marks[lastI] = 1;
    points.forEach(function (p, i) {
      if (!marks[i]) return;
      g.push('<text x="' + (padL + i * bw + bw / 2) + '" y="' + (h - 8) + '" class="ds-axis" text-anchor="middle">' + esc(tsLabel(p.ts, opts.granularity)) + '</text>');
    });
    var svgAttrs = ' class="ds-chart' + (rich ? ' chart-stack' : '') + '"' +
      (rich
        ? ' data-sb="' + esc(JSON.stringify(opts.colTips)) + '"' +
          ' data-x0="' + padL + '" data-dx="' + bw.toFixed(3) + '"' +
          ' data-padt="' + padT + '" data-ih="' + ih + '"'
        : '') +
      ' viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="' + esc(opts.aria || '堆叠柱状图') + '"';
    return '<svg' + svgAttrs + '>' + g.join('') + '</svg>';
  }

  /**
   * 面积图（单序列）。values[i] 对应 points[i]。
   * opts: { height, granularity, fmt(v), color, aria, width, padL, colTips }
   *   colTips：与 stackedBar 同名同构 —— 传了就切「整列浮层」模式：
   *   竖虚线落到该点、点上出现空心圆点、浮层给「日期 + 指标名 + 值」（对标 DeepSeek 用量页的面积图 hover）。
   *   圆的坐标由本函数算好写进 colTips 的 px/py，调用方不必知道图表几何。
   */
  function areaChart(points, values, opts) {
    opts = opts || {};
    var w = opts.width || chartWidth();
    var h = opts.height || 180;
    var padL = opts.padL || 46, padR = 16, padT = 12, padB = 24;   /* padL 理由同 stackedBar */
    var iw = w - padL - padR, ih = h - padT - padB;
    if (!points || !points.length) return '<div class="ds-chart-empty">该范围内没有数据</div>';
    var color = opts.color || DS_COLORS[0];
    var nt = niceTop(Math.max.apply(null, values), 4);
    var top = nt.top || 1;
    var step = points.length > 1 ? iw / (points.length - 1) : 0;
    var fmt = opts.fmt || fmtNum;
    var xy = values.map(function (v, i) {
      return [padL + i * step, padT + ih - (Math.min(v, top) / top) * ih];
    });
    var line = xy.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + (padL + (points.length - 1) * step).toFixed(1) + ' ' + (padT + ih) + ' L' + padL + ' ' + (padT + ih) + ' Z';
    var g = [];
    for (var t = 0; t <= top + 1e-9; t += nt.step) {
      var y = padT + ih - (t / top) * ih;
      g.push(el('line', { x1: padL, x2: w - padR, y1: y, y2: y, stroke: 'var(--line-soft)', 'stroke-width': 1 }));
      g.push('<text x="' + (padL - 8) + '" y="' + (y + 4) + '" class="ds-axis" text-anchor="end">' + esc(fmt(t)) + '</text>');
    }
    g.push(el('path', { d: area, fill: color, opacity: 0.16, stroke: 'none' }));
    g.push(el('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    var bw = iw / points.length;
    var rich = !!(opts.colTips && opts.colTips.length === points.length);
    if (rich) {
      /* 虚线在最上层（穿过面积与折线），圆点白心 + 序列色描边 —— 与参考图一致 */
      g.push('<line class="sb-guide" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" opacity="0"/>');
      g.push('<circle class="ac-dot" cx="0" cy="0" r="0" fill="#fff" stroke="' + color + '" stroke-width="2"/>');
      g.push(el('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent', class: 'chart-hit' }));
    } else {
      /* 每桶一个透明命中区，挂原生 tooltip（比在点上挂更好点中） */
      points.forEach(function (p, i) {
        g.push(el('rect', {
          x: padL + i * bw, y: padT, width: bw, height: ih, fill: 'transparent',
          'data-tip': tsLabel(p.ts, opts.granularity) + ' · ' + fmt(values[i] || 0)
        }));
      });
    }
    var every = Math.max(1, Math.ceil(points.length / 8));
    points.forEach(function (p, i) {
      if (i % every) return;
      g.push('<text x="' + (padL + i * bw + bw / 2) + '" y="' + (h - 6) + '" class="ds-axis" text-anchor="middle">' + esc(tsLabel(p.ts, opts.granularity)) + '</text>');
    });
    var svgAttrs = ' class="ds-chart' + (rich ? ' chart-area' : '') + '"' +
      (rich
        ? ' data-mode="point"' +
          ' data-sb="' + esc(JSON.stringify(opts.colTips.map(function (t, i) {
            return { title: t.title, totalText: t.totalText, rows: t.rows,
              px: +xy[i][0].toFixed(1), py: +xy[i][1].toFixed(1) };
          }))) + '"' +
          ' data-x0="' + padL + '" data-dx="' + step.toFixed(3) + '"' +
          /* padT / ih 必须一起给：app.js 的整列浮层靠它们算虚线的上下端。
             漏了这两个属性 → y1=y2=0 → 竖线长度为零，页面上"看不见"，
             但 opacity 仍是 1，只查 opacity 的测试会假通过（2026-10-28 实测踩过）。 */
          ' data-padt="' + padT + '" data-ih="' + ih + '"'
        : '') +
      ' viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="' + esc(opts.aria || '面积图') + '"';
    return '<svg' + svgAttrs + '>' + g.join('') + '</svg>';
  }

  /** 堆叠柱·整列浮层的内容（纯字符串函数，与 tipHtml 同一套 .ct-hd / .ct-row 结构）。
      标题行 = 该列时间 + 该列合计；下面每行 = 色块 + 分组名 + 占该列的比重 + 金额。 */
  function sbTipHtml(col) {
    if (!col) return '';
    /* 色块只在有 color 时画：单序列的面积图（请求次数 / Tokens）只有一行，
       前面挂个色块反而像"还有别的系列"。合计同理 —— 没有就整段不输出，不留空白 b。 */
    var rows = (col.rows || []).map(function (r) {
      return '<div class="ct-row">' +
        (r.color ? '<i style="background:' + r.color + '"></i>' : '') +
        '<span>' + esc(r.label) + (r.sub ? '<em class="ct-sub">' + esc(r.sub) + '</em>' : '') + '</span>' +
        '<b>' + esc(r.valueText) + '</b></div>';
    }).join('');
    return '<div class="ct-hd"><span>' + esc(col.title) + '</span>' +
      (col.totalText ? '<b>' + esc(col.totalText) + '</b>' : '') + '</div>' + rows;
  }

  /* SECTION: flame-chart
   * Trace 火焰图。宽度=耗时占比，缩进=嵌套层级，失败 span 标红。
   * 这是排障的核心视图：一眼看出瓶颈在哪个节点。
   */
  function flameChart(trace, opts) {
    opts = opts || {};
    var total = trace.latencyMs || 1;
    var rowH = 26, labelW = opts.labelWidth || 190, chartW = opts.chartWidth || 520;
    var rows = trace.spans.map(function (sp, i) {
      var leftPct = (sp.start / total) * 100;
      var wPct = Math.max(0.6, (sp.duration / total) * 100);
      var isFail = sp.status === 'failed';
      var color = isFail ? '#dc2626' : (KIND_COLOR[sp.kind] || '#93b4f5');
      return '<div class="fl-row' + (isFail ? ' fl-fail' : '') + '" data-span="' + esc(sp.id) + '" style="height:' + rowH + 'px">' +
        '<span class="fl-name"><i class="fl-dot" style="background:' + color + '"></i>' + esc(sp.name) +
        '<em>' + esc(KIND_LABEL[sp.kind] || sp.kind) + '</em></span>' +
        '<span class="fl-track"><i class="fl-bar" style="left:' + leftPct.toFixed(2) + '%;width:' + wPct.toFixed(2) + '%;background:' + color + '"></i></span>' +
        '<span class="fl-dur">' + fmtDur(sp.duration) + '</span>' +
        '</div>';
    }).join('');

    // 时间刻度
    var ticks = '';
    for (var t = 0; t <= 4; t++) {
      ticks += '<span style="left:' + (t * 25) + '%">' + fmtDur(total * t / 4) + '</span>';
    }

    return '<div class="flame" style="--label-w:' + labelW + 'px;--chart-w:' + chartW + 'px">' +
      '<div class="fl-axis">' + ticks + '</div>' + rows +
      '<div class="fl-total">端到端 ' + fmtDur(trace.latencyMs) + ' · ' + trace.spans.length + ' 个节点' +
      (trace.status === 'failed' ? ' · <b class="bad">失败于 ' + esc(failNodeName(trace)) + '</b>' : ' · <b class="ok">成功</b>') +
      '</div></div>';
  }
  var KIND_COLOR = { start: '#94a3b8', llm: '#3b82f6', tool: '#8b5cf6', guard: '#f59e0b', end: '#16a34a' };
  var KIND_LABEL = { start: '入口', llm: '模型', tool: '工具', guard: '合规', end: '输出' };
  function failNodeName(trace) {
    for (var i = 0; i < trace.spans.length; i++) if (trace.spans[i].status === 'failed') return trace.spans[i].name;
    return '—';
  }
  function fmtDur(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
    return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's';
  }

  /* SECTION: gauge */
  /** 配额/预算水位进度条，超阈值变色 */
  function gauge(ratio, opts) {
    opts = opts || {};
    var pctv = Math.max(0, Math.min(1.4, ratio)) * 100;
    var color = ratio > 0.95 ? '#b91c1c' : (ratio > 0.8 ? '#b45309' : '#2563eb');
    return '<div class="gauge" title="' + esc(opts.title || '') + '">' +
      '<div class="gauge-track"><i style="width:' + Math.min(100, pctv).toFixed(1) + '%;background:' + color + '"></i></div>' +
      '<span class="gauge-val" style="color:' + color + '">' + pctv.toFixed(1) + '%</span></div>';
  }

  /* SECTION: compare-bars */
  /** 灰度双组对比条，含显著性标注 */
  function compareBar(label, v1, v2, opts) {
    opts = opts || {};
    var max = Math.max(Math.abs(v1), Math.abs(v2)) || 1;
    var w1 = (Math.abs(v1) / max) * 100, w2 = (Math.abs(v2) / max) * 100;
    var better = opts.higherIsBetter === false ? v1 < v2 : v1 > v2;
    var diffColor = opts.noDiff ? '#5f6b7d' : (better ? '#15803d' : '#b91c1c');
    return '<div class="cmp-row">' +
      '<span class="cmp-label">' + esc(label) + '</span>' +
      '<span class="cmp-bars">' +
      '<i class="cmp-b1" style="width:' + w1.toFixed(1) + '%"></i>' +
      '<i class="cmp-b2" style="width:' + w2.toFixed(1) + '%"></i>' +
      '</span>' +
      '<span class="cmp-vals"><b>' + esc(opts.fmt1(v1)) + '</b> vs ' + esc(opts.fmt2 ? opts.fmt2(v2) : opts.fmt1(v2)) +
      ' <em style="color:' + diffColor + '">' + esc(opts.diffText) + '</em></span>' +
      '</div>';
  }

  /**
   * JSON 展示：null / undefined 渲染为占位符而非字面量。
   * 节点输入输出常有空值，直接 JSON.stringify 会在页面上出现「null」，
   * 用户会误以为是数据错误。真实 trace 系统一律显示为「（空）」。
   */
  function jsonView(v) {
    if (v === null || v === undefined) return '（空）';
    if (typeof v === 'string') return v;
    try {
      var s = JSON.stringify(v, null, 2);
      return (s === undefined || s === 'null') ? '（空）' : s;
    } catch (e) { return String(v); }
  }

  global.CHARTS = {
    sparkline: sparkline, lineChart: lineChart, barChart: barChart,
    flameChart: flameChart, gauge: gauge, compareBar: compareBar,
    /* v32：DS 控制台形态的两张图（运行监控用）——堆叠柱 + 面积图 + 它那套柱色 */
    stackedBar: stackedBar, areaChart: areaChart, DS_COLORS: DS_COLORS, sbTipHtml: sbTipHtml,
    chartWidth: chartWidth, gridWidth: gridWidth,
    fmtNum: fmtNum, fmtDur: fmtDur, fmtTs: fmtTs, tipHtml: tipHtml, esc: esc, jsonView: jsonView,
    KIND_COLOR: KIND_COLOR, KIND_LABEL: KIND_LABEL
  };
})(window);
