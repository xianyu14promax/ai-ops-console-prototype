/* v37 · 舆情分析看板（11 层）
 * 业主 2026-10-18：把「舆情分析到底分析什么」那套 11 层框架做成**看板**，不要列表 ——
 * 环形图 / 饼图 / 树图 / 矩阵 / 曲线，一层一张卡。
 *
 * 数据口径（重要，别在这里编造与别处打架的数）：
 *   · 总量、正面/中性/负面占比 = 本屏已有的舆情实验（sim_runs.mode==='opinion'）按 sample 加权，
 *     与页面其它地方同源，可逐项对账（20,245 提及 / 正 45.4% 中 26.8% 负 27.8%）。
 *   · 细分维度（平台份额、情绪类型、议题结构、风险落点、圈层态度、趋势斜率）= 由 stably 哈希
 *     从同一份数据确定性派生 —— 刷新不变、改实验才变，不引入外部随机。
 *   · 边界：这是「模拟推演看板」，只读，不写回实验记录；每张卡右上角写明该层口径。
 *
 * 2026-10-18 追加：业主贴了 2024-06 胖东来擀面皮事件，要求 11 层框架拿它当标准样例跑一遍。
 *   案例的事实、时间线、金额、份数取自公开报道；百分比与圈层/风险落点是**结构性示意**，页脚写死了这句。
 * 2026-10-18 晚（业主）：默认就分析胖东来，标题行那个「当前实验 / 案例」开关删掉 ——
 *   看板固定走案例（OP_BOARD_SRC === 'runs' 只是留的代码级后门，界面上没有入口）。
 *   实验口径的 build() 保留不动：以后要切回来，改这一行默认值即可。
 *
 * 2026-10-18 晚（结构）：改成「范围 → 总 → 分 → 总」——
 *   评估范围（网络 / 区域，当前实验样本）→ 结论头条（判读）→ 五章 11 层证据（案例多一章「判读」）
 *   → 收口（案例 ⑦ 合起来判断 / 实验 ⑥ 还缺什么才能投）。
 *   位置由 renderers2 的 simOpinionBlock 拼接：scope + 网络 + 区域 + head + body。
 *   对外导出 `OP_BOARD.parts(list) → { head, body }`；`OP_BOARD.html(list)` 仍是完整一块。
 */
(function (global) {
  'use strict';

  var C = {
    blue: '#2563eb', blue2: '#3b82f6', blue3: '#60a5fa', blue4: '#93c5fd',
    red: '#dc2626', amber: '#d97706', green: '#16a34a', purple: '#7c3aed',
    cyan: '#0e7490', slate: '#94a3b8', ink: '#1f2430', faint: '#8a93a6', track: '#eef1f6'
  };

  /* ---------- 工具 ---------- */
  function h01(s) {
    var h = 2166136261 >>> 0; s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 8) / 16777216;
  }
  function jit(k, amp) { return (h01(k) - 0.5) * 2 * amp; }
  function nf(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function p1(v) { return (v * 100).toFixed(1) + '%'; }
  function p0(v) { return Math.round(v * 100) + '%'; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function norm(a) { var s = sum(a) || 1; return a.map(function (v) { return v / s; }); }
  /* 整数百分比，合计必须正好 100 —— 八个 1 位小数四舍五入后会出现 100.1%，
     读者一加就发现「这张卡自己没合上」。用最大余数法分配。 */
  function p100(vals) {
    var s = sum(vals) || 1;
    var raw = vals.map(function (v) { return v / s * 100; });
    var fl = raw.map(Math.floor);
    var rest = 100 - sum(fl);
    var order = raw.map(function (v, i) { return { i: i, r: v - Math.floor(v) }; })
      .sort(function (a, b) { return b.r - a.r; });
    for (var k = 0; k < rest; k++) fl[order[k % order.length].i]++;
    return fl;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function f1(n) { return Math.round(n * 10) / 10; }
  function xy(p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }
  function at(cx, cy, r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }

  /* ---------- SVG 原语 ---------- */
  function annulus(cx, cy, r, ir, a0, a1) {
    var lg = (a1 - a0) > Math.PI ? 1 : 0;
    var p0 = at(cx, cy, r, a0), p1 = at(cx, cy, r, a1), p2 = at(cx, cy, ir, a1), p3 = at(cx, cy, ir, a0);
    return 'M' + xy(p0) + ' A' + r + ' ' + r + ' 0 ' + lg + ' 1 ' + xy(p1) +
      ' L' + xy(p2) + ' A' + ir + ' ' + ir + ' 0 ' + lg + ' 0 ' + xy(p3) + 'Z';
  }

  /** 单值环（口径环）：中心写数，环长 = 百分比 */
  function ring(pct, color, big, small) {
    var r = 42, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct));
    return '<svg viewBox="0 0 100 100" class="opb-ring" role="img">' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + C.track + '" stroke-width="9"/>' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + f1(c * v) + ' ' + f1(c) + '" transform="rotate(-90 50 50)"/>' +
      '<text x="50" y="48" text-anchor="middle" class="opb-ring-v">' + big + '</text>' +
      '<text x="50" y="63" text-anchor="middle" class="opb-ring-s">' + small + '</text></svg>';
  }

  /** 多片环（饼图）：slices = [{n,v,c}] */
  function donut(slices, big, small) {
    var tot = sum(slices.map(function (s) { return s.v; })) || 1, a = -Math.PI / 2;
    var body = slices.map(function (s) {
      var a2 = a + (s.v / tot) * Math.PI * 2;
      var d = annulus(50, 50, 40, 26, a, a2 - 0.014);
      a = a2;
      return '<path d="' + d + '" fill="' + s.c + '"><title>' + esc(s.n) + ' ' + p1(s.v / tot) + '</title></path>';
    }).join('');
    return '<svg viewBox="0 0 100 100" class="opb-donut" role="img">' + body +
      (big ? '<text x="50" y="49" text-anchor="middle" class="opb-dv">' + big + '</text>' : '') +
      (small ? '<text x="50" y="62" text-anchor="middle" class="opb-ds">' + small + '</text>' : '') + '</svg>';
  }

  /** 双层树图：parents = [{n,w,ch:[{n,w}]}]，w 为相对份额（自动归一） */
  function treemap(parents, W, H) {
    var tw = sum(parents.map(function (p) { return p.w; })) || 1, x = 0, out = '';
    /* 树图底色必须够深：白字在 #60a5fa 上只有 2.6:1，实测第三块「补偿标准」几乎读不出来。
       改用 深蓝→靛→紫 四档（白字都在 6:1 以上），仍然是一个色系里的递进。 */
    var cols = ['#1e40af', '#1d4ed8', '#4f46e5', '#7c3aed'];
    parents.forEach(function (p, pi) {
      var w = p.w / tw * W, base = cols[pi % cols.length];
      out += '<rect x="' + f1(x) + '" y="0" width="' + f1(Math.max(0, w - 3)) + '" height="' + H + '" rx="4" fill="' + base + '"/>';
      out += '<text x="' + f1(x + 10) + '" y="19" class="opb-tm-p">' + esc(p.n) + '</text>';
      out += '<text x="' + f1(x + 10) + '" y="34" class="opb-tm-pv">' + p0(p.w / tw) + '</text>';
      var y = 46, rest = H - 52, cw = sum(p.ch.map(function (c) { return c.w; })) || 1;
      p.ch.forEach(function (ch) {
        var hh = ch.w / cw * rest;
        out += '<rect x="' + f1(x + 6) + '" y="' + f1(y) + '" width="' + f1(Math.max(0, w - 15)) + '" height="' + f1(Math.max(0, hh - 4)) + '" rx="3" fill="#fff" fill-opacity=".18"/>';
        if (hh > 22) {
          out += '<text x="' + f1(x + 13) + '" y="' + f1(y + 15) + '" class="opb-tm-c">' + esc(ch.n) + '</text>';
        }
        y += hh;
      });
      x += w;
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opb-svg opb-tm" role="img">' + out + '</svg>';
  }

  /** 议题树（HTML 版）：宽度 = 份额、子块高度 = 子份额，整块铺满卡片宽度 ——
   *  SVG 版会被 viewBox 等比缩放，卡片一宽就留白、一窄字就变小，改成 DOM 就不存在这个问题。 */
  function treemapHtml(parents) {
    var cols = ['#1e40af', '#1d4ed8', '#4f46e5', '#7c3aed'];
    var tw = sum(parents.map(function (p) { return p.w; })) || 1;
    return '<div class="opb-tmf">' + parents.map(function (p, pi) {
      var cw = sum(p.ch.map(function (c) { return c.w; })) || 1;
      return '<div class="opb-tmc" style="flex:' + (p.w / tw * 100).toFixed(2) + ';background:' + cols[pi % cols.length] + '">' +
        '<div class="opb-tmh"><b>' + esc(p.n) + '</b><span>' + p0(p.w / tw) + '</span></div>' +
        '<div class="opb-tmb">' + p.ch.map(function (ch) {
          return '<div class="opb-tms" style="flex:' + (ch.w / cw).toFixed(3) + '"><span>' + esc(ch.n) + '</span></div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  /** 双序列曲线：s1 面积（左轴）、s2 折线（右轴） */
  function curve(labels, s1, s2) {
    var W = 640, H = 196, pl = 30, pr = 34, pt = 16, pb = 30;
    var iw = W - pl - pr, ih = H - pt - pb;
    var m1 = Math.max.apply(null, s1.vals) * 1.15 || 1;
    var m2 = Math.max.apply(null, s2.vals) * 1.3 || 1;
    var X = function (i) { return pl + (i / (labels.length - 1)) * iw; };
    var Y1 = function (v) { return pt + ih - (v / m1) * ih; };
    var Y2 = function (v) { return pt + ih - (v / m2) * ih; };
    var grid = [0, .25, .5, .75, 1].map(function (k) {
      var y = pt + ih * k;
      return '<line x1="' + pl + '" y1="' + f1(y) + '" x2="' + (W - pr) + '" y2="' + f1(y) + '" stroke="#eef1f6" stroke-width="1"/>' +
        '<text x="' + (pl - 6) + '" y="' + f1(y + 3) + '" text-anchor="end" class="opb-ax">' + nf(m1 * (1 - k)) + '</text>' +
        '<text x="' + (W - pr + 6) + '" y="' + f1(y + 3) + '" class="opb-ax">' + (m2 * (1 - k) * 100).toFixed(0) + '%</text>';
    }).join('');
    var area = s1.vals.map(function (v, i) { return (i ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y1(v)); }).join(' ') +
      ' L' + f1(X(s1.vals.length - 1)) + ' ' + (pt + ih) + ' L' + f1(X(0)) + ' ' + (pt + ih) + 'Z';
    var line2 = s2.vals.map(function (v, i) { return (i ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y2(v)); }).join(' ');
    var dots = s2.vals.map(function (v, i) {
      return '<circle cx="' + f1(X(i)) + '" cy="' + f1(Y2(v)) + '" r="3" fill="#fff" stroke="' + s2.color + '" stroke-width="2">' +
        '<title>' + labels[i] + ' · 负面 ' + p1(v) + '</title></circle>';
    }).join('');
    var xs = labels.map(function (l, i) {
      return '<text x="' + f1(X(i)) + '" y="' + (H - 8) + '" text-anchor="middle" class="opb-ax">' + esc(l) + '</text>';
    }).join('');
    var marks = (s2.marks || []).map(function (m) {
      var x = f1(X(m.i));
      return '<line x1="' + x + '" y1="' + pt + '" x2="' + x + '" y2="' + (pt + ih) + '" stroke="#d9e1ee" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<text x="' + x + '" y="' + (pt - 4) + '" text-anchor="middle" class="opb-mark">' + esc(m.t) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opb-svg" role="img">' + grid +
      '<path d="' + area + '" fill="' + s1.color + '" fill-opacity=".12"/>' +
      '<path d="' + s1.vals.map(function (v, i) { return (i ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y1(v)); }).join(' ') + '" fill="none" stroke="' + s1.color + '" stroke-width="2" stroke-linejoin="round"/>' +
      marks +
      '<path d="' + line2 + '" fill="none" stroke="' + s2.color + '" stroke-width="2.2" stroke-linejoin="round"/>' + dots + xs + '</svg>';
  }

  /** 前后对比（哑铃图）：rows = [{n, a, b}]，a/b 已归一到 0–1 */
  function dumbbell(rows) {
    var W = 640, rowH = 44, H = rows.length * rowH + 10, pl = 108, pr = 58;
    var iw = W - pl - pr;
    var X = function (v) { return pl + v * iw; };
    var body = rows.map(function (r, i) {
      var y = 20 + i * rowH;
      /* 颜色判「变好/变坏」，不是判「变大/变小」：负面占比、议题发散度下降 = 好（绿），
         信任度上升 = 好（绿）。第一版按 b>=a 判，把「负面 42.2%→27.8%」画成了红的。 */
      var col = (r.b - r.a) * (r.dir || 1) > 0 ? C.green : C.red;
      /* 标签往两端放：a<b 时「前」在左、「后」在右；a>b 时反过来。
         否则两个值会并排挤在两点之间 —— 实测 a=.42 / b=.28 时「27.8%」直接压在灰点上。 */
      var aLeft = r.a >= r.b;
      return '<text x="0" y="' + (y + 4) + '" class="opb-db-n">' + esc(r.n) + '</text>' +
        '<line x1="' + f1(X(Math.min(r.a, r.b))) + '" y1="' + y + '" x2="' + f1(X(Math.max(r.a, r.b))) + '" y2="' + y + '" stroke="#dfe6f2" stroke-width="6" stroke-linecap="round"/>' +
        '<line x1="' + f1(X(Math.min(r.a, r.b))) + '" y1="' + y + '" x2="' + f1(X(Math.max(r.a, r.b))) + '" y2="' + y + '" stroke="' + col + '" stroke-width="6" stroke-linecap="round" stroke-opacity=".34"/>' +
        '<circle cx="' + f1(X(r.a)) + '" cy="' + y + '" r="4.5" fill="#fff" stroke="' + C.slate + '" stroke-width="2"><title>回应前 ' + r.av + '</title></circle>' +
        '<circle cx="' + f1(X(r.b)) + '" cy="' + y + '" r="5.5" fill="' + col + '"><title>回应后 ' + r.bv + '</title></circle>' +
        '<text x="' + f1(X(r.a) + (aLeft ? 10 : -10)) + '" y="' + (y + 4) + '"' + (aLeft ? '' : ' text-anchor="end"') + ' class="opb-db-v">' + r.av + '</text>' +
        '<text x="' + f1(X(r.b) + (aLeft ? -10 : 10)) + '" y="' + (y + 4) + '"' + (aLeft ? ' text-anchor="end"' : '') + ' class="opb-db-vb">' + r.bv + '</text>';
    }).join('');
    /* 不在两端写「回应前 / 回应后」：横轴是**数值轴**（0–100%），点往左移也可能表示「变好」，
       那两个端点标签会被读成方向箭头。改为图例：空心 = 回应前，实心 = 回应后。 */
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opb-svg" role="img">' + body + '</svg>';
  }

  /* ---------- 数据：全部从舆情实验派生 ---------- */
  /* 口径（2026-10-18 修）：均值只算**已完成**的实验 —— 头条原来写着「只按已完成算」，
     代码却把 4 次全加权（27.8% / 20,245），而真正跑完的 2 次是 20.7% / 6,190。
     未跑完的只计入进度，不进任何一个百分比、也不进总量。 */
  function build(list) {
    var all = list || [];
    var done = all.filter(function (x) { return x.status === 'done'; });
    var base = done.length ? done : all;
    var tot = 0, wp = 0, wn = 0, wg = 0, totAll = 0;
    all.forEach(function (x) { totAll += (x.sample || 0); });
    base.forEach(function (x) {
      var s = x.sample || 0;
      tot += s;
      wp += s * (x.senti.pos || 0); wn += s * (x.senti.neu || 0); wg += s * (x.senti.neg || 0);
    });
    var d = {
      /* tot 可能是 0（实验存在但样本为 0）—— 除零会让整屏出现 NaN%，这里兜一下 */
      n: base.length, tot: tot, pos: wp / (tot || 1), neu: wn / (tot || 1), neg: wg / (tot || 1),
      runsAll: all.length, runsDone: done.length, runsPend: all.length - done.length,
      doneRate: totAll ? tot / totAll : 1
    };
    var key = base.map(function (x) { return x.id + ':' + x.sample; }).join('|');
    d.key = key;
    d.metaText = '已完成 ' + d.runsDone + ' / 共 ' + d.runsAll + ' 次实验';

    /* ④ 平台 */
    var PLAT = ['微博', '抖音', '小红书', '微信', '知乎', 'B 站', '其他'];
    var pw = norm([0.30, 0.23, 0.15, 0.12, 0.09, 0.07, 0.04].map(function (v, i) {
      return v * (1 + jit(key + '|plat' + i, 0.34));
    }));
    var cols7 = [C.blue, C.blue2, C.blue3, C.purple, C.cyan, C.amber, C.slate];
    var acc = 0;
    d.plat = PLAT.map(function (n, i) {
      var v = i === PLAT.length - 1 ? Math.max(0, 1 - acc) : pw[i];
      acc += v;
      return { n: n, v: v, c: cols7[i], m: Math.round(v * tot) };
    });
    d.platTop = d.plat[0];
    d.platSub = platSubMap(d.plat, key);

    /* ④ 路径：实验口径没有具体案例，只保留「该怎么读」的三问 */
    d.path = {
      pace: '短视频把窗口压到几小时：阶段没少，过渡变快',
      rewrite: '每换一次平台都可能被重新定义，盯「说法被谁改了」那一下',
      emo: '个人情绪 → 群体愤怒 → 道德共鸣，看现在停在哪一环',
      verdict: '三阶段全走完方为收口；仅完成两项时，声量未见顶亦可能高烈度爆发'
    };

    /* ② 主体分层：账号数按提及量派生（不写死）——核心 = 首发 1 + 媒体 2（固定 3 个账号），
       次级 ≈ 每 480 次提及 1 个 KOL/媒体号，长尾 ≈ 每 16 次提及 1 个账号。
       原来写 core = 3 + 实验数，把「跑了几次实验」加进了「几个账号」，两种量纲不能相加。 */
    d.nodes = {
      core: 3,
      mid: Math.max(6, Math.round(tot / 480)),
      tail: Math.max(50, Math.round(tot / 16))
    };
    /* 每层是谁必须写出来，否则「核心节点 3」等于没信息 */
    d.nodesHelp = {
      core: '首发 1 · 品牌官方 1 · 头部媒体 1',
      mid: '媒体号 / KOL（按提及量推演）',
      tail: '转评账号（按提及量推演）'
    };

    /* ⑤ 情绪八类（三组内分配，合计 = 1，与 d.pos/neu/neg 对得上） */
    function split(base, names) {
      var w = norm(base.map(function (v, i) { return v * (1 + jit(key + '|emo' + names[i], 0.3)); }));
      return w;
    }
    var nw = split([0.34, 0.27, 0.23, 0.16], ['怒', '疑', '嘲', '失']);
    var pw2 = split([0.72, 0.28], ['支', '同']);
    var uw = split([0.63, 0.37], ['旁', '麻']);
    d.emo = [
      { n: '愤怒', v: d.neg * nw[0], c: C.red },
      { n: '质疑', v: d.neg * nw[1], c: '#e2571f' },
      { n: '嘲讽', v: d.neg * nw[2], c: C.amber },
      { n: '失望', v: d.neg * nw[3], c: '#b45309' },
      { n: '支持', v: d.pos * pw2[0], c: C.blue },
      { n: '同情', v: d.pos * pw2[1], c: C.blue3 },
      { n: '旁观', v: d.neu * uw[0], c: C.slate },
      { n: '麻木', v: d.neu * uw[1], c: '#c3cad8' }
    ];
    d.emoTop = d.emo.slice(0, 3).slice().sort(function (a, b) { return b.v - a.v; })[0];
    /* 极化指数 = 负面前两类占比 / 负向总量（越集中越极化） */
    d.polar = (d.emo[0].v + d.emo[1].v) / (d.neg || 1);
    d.emoNeg = d.neg;

    /* ③ 议题树 */
    var TP = [
      { n: '权益与价格', w: 0.34, ch: [{ n: '权益缩水质疑', w: 0.42 }, { n: '退订代价', w: 0.33 }, { n: '续费话术', w: 0.25 }] },
      { n: '事实追问', w: 0.27, ch: [{ n: '是否自动续费', w: 0.45 }, { n: '优惠口径', w: 0.3 }, { n: '到账时间', w: 0.25 }] },
      { n: '信息误读', w: 0.22, ch: [{ n: '条款截图', w: 0.58 }, { n: '第三方转述', w: 0.42 }] },
      { n: '情绪与梗', w: 0.17, ch: [{ n: '模板嘲讽', w: 0.62 }, { n: '表情包二创', w: 0.38 }] }
    ];
    d.topic = TP.map(function (p, i) { return { n: p.n, w: p.w * (1 + jit(key + '|tp' + i, 0.18)), ch: p.ch }; });
    var tsum = sum(d.topic.map(function (p) { return p.w; }));
    d.topic = d.topic.map(function (p) { return { n: p.n, w: p.w / tsum, ch: p.ch }; });
    d.topicTop = d.topic.slice().sort(function (a, b) { return b.w - a.w; })[0];

    /* ⑦ 风险矩阵：p = 概率档 0–3，i = 影响档 0–3 */
    d.risk = [
      { n: '品牌声誉', p: 3, i: 3 }, { n: '监管问询', p: 2, i: 3 }, { n: '法务投诉', p: 1, i: 3 },
      { n: '竞品借势', p: 3, i: 2 }, { n: '次生舆情', p: 2, i: 2 }, { n: '客诉升级', p: 2, i: 1 }
    ];
    function lv(r) { var s = r.p + r.i; return s >= 6 ? '红' : (s >= 5 ? '橙' : (s >= 4 ? '黄' : '蓝')); }
    d.risk.forEach(function (r) { r.lv = lv(r); });

    /* ⑧ 趋势：T+0 … T+72 */
    var tk = [0, 3, 6, 12, 24, 48, 72];
    d.trendX = tk.map(function (t) { return t ? 'T+' + t + 'h' : '当前'; });
    var volBase = [100, 118, 146, 139, 112, 78, 58].map(function (v, i) { return v * (1 + jit(key + '|vol' + i, 0.16)); });
    var negBase = [d.neg, d.neg * 1.06, d.neg * 1.16, d.neg * 1.12, d.neg * 0.99, d.neg * 0.9, d.neg * 0.84];
    d.trendVol = volBase;
    d.trendNeg = negBase;
    d.trendPeak = 6;                                  /* 峰值出现在 T+6h */
    /* 只标「声量峰」：原来还标了「媒体跟进」，那是编出来的未来事件，不是数据。 */
    d.trendMarks = [{ i: 2, t: '声量峰' }];
    d.peakText = '声量峰 T+6h（预判）';
    d.trendDir = negBase[6] < d.neg ? '降' : '升';
    d.reversal = 0.28 + jit(key + '|rev', 0.06);      /* 反转概率（推演，没有可用模型） */

    /* ⑥ 圈层态度：每行合计 100% */
    var SEG = ['核心利益相关方', '围观网民', '行业从业者', '媒体 / KOL', '监管 / 决策者'];
    var supBase = [0.18, 0.32, 0.41, 0.36, 0.44];
    var oppBase = [0.62, 0.41, 0.28, 0.33, 0.22];
    d.seg = SEG.map(function (n, i) {
      var o = Math.min(0.9, Math.max(0.05, oppBase[i] * (1 + jit(key + '|opp' + i, 0.2))));
      var s = Math.min(0.9 - o + 0.6, Math.max(0.03, supBase[i] * (1 + jit(key + '|sup' + i, 0.2))));
      if (s + o > 0.94) s = 0.94 - o;
      /* 取整必须收在一行里：三格分别 Math.round 会出现 19+16+66=101% 这种「矩阵行不闭合」 */
      var si = Math.round(s * 100), oi = Math.round(o * 100);
      if (si + oi > 100) oi = 100 - si;
      return { n: n, s: s, o: o, m: 1 - s - o, si: si, oi: oi, mi: 100 - si - oi };
    });
    d.segOpp = d.seg.slice().sort(function (a, b) { return b.o - a.o; })[0];

    /* ⑨ 应对效果（回应前 → 回应后）
       **推演值**：没有做过「回应前 / 回应后」两次实测，前值是按本轮负面率反推的，
       另两项是基准假设（不是这份数据算出来的）。卡片与注脚都标了「推演」，别当实测读。 */
    d.resp = [
      { n: '负面占比', a: Math.min(0.95, d.neg * 1.52), b: d.neg, av: p1(Math.min(0.95, d.neg * 1.52)), bv: p1(d.neg), dir: -1 },
      { n: '议题发散度', a: 0.62, b: 0.41, av: '0.62', bv: '0.41', dir: -1 },
      { n: '信任度', a: 0.38, b: 0.56, av: p0(0.38), bv: p0(0.56), dir: 1 }
    ];
    d.respNote = '回应前的数是按本轮负面率反推的，另两项为基准假设 —— 本屏没有做过前后两次实测，只能读方向。';

    /* ① 事实基线 / ⑩ 数据方法 / ⑪ 报告交付 */
    d.facts = [
      { t: 'T-6d', n: '首发', s: '首发', c: C.slate },
      { t: 'T-4d', n: '首次回应', s: '回应', c: C.blue },
      { t: 'T-2d', n: '媒体跟进', s: '跟进', c: C.amber },
      { t: 'T-8h', n: '议题迁移', s: '迁移', c: C.red },
      { t: '现在', n: '判定', s: '判定', c: C.green }
    ];
    d.factGap = 0.174 + jit(key + '|gap', 0.02);       /* 信息缺口：未确认 / 全部要素 */
    /* 事实构成按**条数**给，环上百分比由条数算（6:2:1 → 67/22/11，合计正好 100）。
       原来四个环写死 66/22/11/17 并排，加起来 116% —— 前三个是构成、第四个是缺口率，分母不同。 */
    d.factCounts = { ok: 6, mid: 2, rumor: 1 };
    d.sources = [
      { n: '公开平台', on: 1 }, { n: '媒体', on: 1 }, { n: '评论区', on: 1 }, { n: '热搜', on: 1 },
      { n: '问卷', on: 1 }, { n: '访谈', on: 0 }, { n: '投诉数据', on: 0 }
    ];
    d.cover = sum(d.sources.map(function (s) { return s.on; })) / d.sources.length;
    d.report = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
    d.reportDone = sum(d.report);
    /* 结论头条：这屏只回答一件事 —— 能不能据此投放 */
    var highN = base.filter(function (x) { return x.senti.neg > 0.4; }).length;
    if (!done.length) {
      /* 一次都没跑完：下面的百分比全是未完成实验的数，不能拿来说结论 */
      d.verdict = {
        text: '0 次已完成 —— 下面的数值取自未完成实验，只能当预演',
        sub: '跑完之前，任何百分比都不作投放依据；补样本后这一屏的数字会整体变。',
        kpis: [{ v: nf(tot), l: '次提及（预演）' }, { v: p1(d.neg), l: '负面占比（预演）' }, { v: String(highN), l: '高风险实验' }]
      };
    } else {
      d.verdict = {
        text: d.runsPend
          ? ('已完成 ' + d.runsDone + '/' + d.runsAll + ' 次 —— 未跑完的不进均值，也不作投放结论')
          : ('已完成 ' + d.runsDone + ' 次，负面 ' + p1(d.neg) + '，可小步试投'),
        sub: d.runsPend
          ? ('均值为已完成 ' + d.runsDone + ' 次的样本加权（' + nf(tot) + ' 次提及）；其余 ' + d.runsPend + ' 次未完成，只列进度。')
          : ('已完成 ' + d.runsDone + ' 次的样本加权（' + nf(tot) + ' 次提及），可与实验记录逐项对账。'),
        kpis: [{ v: nf(tot), l: '次提及（已完成）' }, { v: p1(d.neg), l: '负面占比' }, { v: String(highN), l: '高风险实验' }]
      };
    }
    return d;
  }

  /* ---------- 卡片外壳 ---------- */
  function card(span, layer, title, sub, body, note) {
    return '<section class="opb-card w' + span + '">' +
      '<div class="opb-h">' + (layer ? '<i class="opb-l">' + layer + '</i>' : '') + '<h4>' + title + '</h4>' +
      (sub ? '<span class="opb-cs">' + sub + '</span>' : '') + '</div>' +
      body + (note ? '<div class="opb-note">' + note + '</div>' : '') + '</section>';
  }
  function leg(rows) {
    return '<div class="opb-leg">' + rows.map(function (r) {
      return '<span><i style="background:' + r.c + '"></i>' + esc(r.n) + '<b>' + r.v + '</b></span>';
    }).join('') + '</div>';
  }
  /* 可点的图例：点一行 = 往下细分（④ 用）。data-act 由 app.js 的通用绑定接管 */
  function legBtn(rows) {
    return '<div class="opb-leg">' + rows.map(function (r) {
      return '<span class="opb-leg-btn" role="button" tabindex="0" data-act="opb-plat" data-id="' + esc(r.id || r.n) + '">' +
        '<i style="background:' + r.c + '"></i>' + esc(r.n) +
        (r.role ? '<u class="opb-role">' + esc(r.role) + '</u>' : '') +
        '<b>' + r.v + '</b><s>›</s></span>';
    }).join('') + '</div>';
  }

  /* ④ 每个平台「抓了什么 / 放大了什么 / 盖住了什么」+ 它在路径里的角色。
     业主 2026-10-19 的口径：渠道决定「这事被改成什么样」，路径决定「这个改法怎么一路传下去」。 */
  var ROLE_RANK = { '点火': 0, '站队': 1, '收口': 2, '定型': 3, '长尾': 4 };
  var TELL_CASE = {
    '抖音': { role: '点火', grab: '加工车间画面', amp: '恶心、心疼 → 愤怒', cover: '个别摊点与联营管理的界线', read: '悲情与愤怒' },
    '微博': { role: '站队', grab: '企业身份（高信任、高福利）', amp: '道德指责、双标质疑', cover: '整改路径、赔偿标准', read: '道德问责' },
    '知乎': { role: '收口', grab: '责任与法律边界', amp: '联营用工关系、责任主体', cover: '顾客当下体验', read: '责任界定' },
    '微信': { role: '定型', grab: '调查报告、赔偿标准', amp: '8,833 份 × 1,000 元', cover: '联营制度本身', read: '教科书级公关' },
    '新闻客户端': { role: '定型', grab: '通报与官方表态', amp: '「教科书级公关」', cover: '收口速度的成因', read: '官方定调' },
    '公众号 / 新闻端': { role: '定型', grab: '调查报告、通报、赔偿标准', amp: '8,833 份 × 1,000 元、10 万奖励', cover: '联营制度本身', read: '教科书级公关' },
    '小红书': { role: '长尾', grab: '探店、避雷笔记', amp: '本地口碑', cover: '事件时间线', read: '本地口碑' },
    '其他': { role: '长尾', grab: '论坛转帖、群聊截图', amp: '地域情绪', cover: '信息出处', read: '转帖素材' },
    'B 站': { role: '长尾', grab: '二创与解说', amp: '情绪共鸣', cover: '原始出处', read: '二创素材' }
  };
  var TELL_GEN = {
    '抖音': { role: '点火', grab: '情绪峰值画面', amp: '愤怒、同情', cover: '事实细节', read: '情绪优先' },
    '微博': { role: '站队', grab: '身份与立场', amp: '道德对立', cover: '整改细节', read: '立场对立' },
    '知乎': { role: '收口', grab: '责任与证据', amp: '责任主体', cover: '个体感受', read: '责任界定' },
    '微信': { role: '定型', grab: '完整叙事', amp: '定性结论', cover: '未解问题', read: '完整叙事' },
    '新闻客户端': { role: '定型', grab: '官方通报', amp: '权威口径', cover: '质疑空间', read: '官方定调' },
    '公众号 / 新闻端': { role: '定型', grab: '完整叙事与官方通报', amp: '定性结论、权威口径', cover: '未解问题', read: '完整叙事' },
    '小红书': { role: '长尾', grab: '体验笔记', amp: '口碑', cover: '时间线', read: '本地口碑' },
    '其他': { role: '长尾', grab: '转帖与截图', amp: '地域情绪', cover: '事实出处', read: '转帖素材' },
    'B 站': { role: '长尾', grab: '二创与解说', amp: '情绪共鸣', cover: '原始出处', read: '二创素材' }
  };

  /* ④ 的第二层：平台里的账号构成（官方 / 媒体 / 自媒体 / 网民）。
     这一层没有采集源，和平台份额一样是**结构性示意** —— 卡头右上角已写明，别当实测引用。 */
  var SUB_N = ['官方号', '媒体号', '自媒体 / KOL', '网民转评'];
  var SUB_C = [C.blue, C.cyan, C.amber, C.slate];
  var SUB_BASE = {
    '抖音': [5, 8, 12, 75], '微博': [4, 24, 32, 40], '微信': [16, 18, 41, 25],
    '新闻客户端': [4, 64, 22, 10], '小红书': [4, 8, 22, 66], '知乎': [3, 10, 47, 40],
    'B 站': [5, 8, 42, 45], '其他': [6, 10, 20, 64]
  };
  function platSubMap(plats, key) {
    var out = {};
    plats.forEach(function (p) {
      var base = SUB_BASE[p.n] || [10, 25, 25, 40];
      var w = base.map(function (v, i) { return Math.max(2, v * (1 + jit(key + '|sub|' + p.n + i, 0.2))); });
      var t = sum(w);
      out[p.n] = w.map(function (v, i) { return { n: SUB_N[i], v: v / t, c: SUB_C[i] }; });
    });
    return out;
  }
  /* 谁在推 —— 把第一名的账号类型翻成一句人话 */
  function subWho(n) {
    if (n === '网民转评') return '情绪靠素人转发放大，不是媒体稿在推';
    if (n === '媒体号') return '是媒体稿在定义口径';
    if (n === '自媒体 / KOL') return '是 KOL 在带节奏';
    return '官方在直接发声';
  }

  /* 章节条：给 14 张同尺寸卡切开层次。不做成卡片，否则又多一层框 */
  function chapter(no, title, sub) {
    return '<div class="opb-ch"><i>' + no + '</i><h4>' + title + '</h4><span>' + sub + '</span></div>';
  }

  /* 结论头条：先给判读，再给证据。看板的价值在「一句话能签字」，不在图多 */
  function hero(d) {
    var v = d.verdict || {};
    return '<div class="opb-hero"><div class="hr-l">' +
      '<div class="hr-k">舆情判读 · ' + esc(d.metaText || ('本屏 ' + d.n + ' 次实验')) + '</div>' +
      '<div class="hr-v">' + (v.text || '') + '</div>' +
      '<div class="hr-sub">' + (v.sub || '') + '</div>' +
      '</div><div class="hr-kpis">' + (v.kpis || []).map(function (k) {
        return '<div><b>' + esc(k.v) + '</b><span>' + esc(k.l) + '</span></div>';
      }).join('') + '</div></div>';
  }

  /* ---------- 案例复盘数据（2024-06 胖东来擀面皮事件）----------
   * 业主 2026-10-18 贴了这套 11 层框架的真实案例，要求同一块看板能拿它当「标准样例」跑一遍。
   * 事实与时间线取自公开报道（6/25 顾客短视频、6/26 关停联营、6/27 凌晨调查报告、
   * 6/9–6/19 期间 8,833 份退款各 1,000 元、投诉顾客奖励 10 万元、辞退免职解约）。
   * **百分比一律是结构性示意**（不是该企业的数据），卡片与页脚都写明了，别当引用看。 */
  function buildCase() {
    var d = {
      src: 'case',
      n: 1, tot: 8833, pos: 0.37, neu: 0.10, neg: 0.53,
      metaText: '案例复盘 · 2024-06 胖东来擀面皮 · 结构性示意'
    };
    /* 2026-10-19 业主：这条轴讲的是「舆论怎么发酵」，不是「企业怎么处理」——
       原来五条全是企业动作（关停 / 报告 / 赔偿），读起来像处置台账。改成舆论侧的五段变化：
       内容从哪来 → 怎么扩散 → 谁把话题掰向哪 → 焦点迁到哪 → 外溢到哪。 */
    d.facts = [
      { t: '6/25', n: '视频流出', d: '顾客拍下加工环境发到短视频平台，先在本地转', c: C.slate },
      { t: '6/26', n: '全国扩散', d: '媒体跟进、登上热搜，外地网民开始围观', c: C.blue },
      { t: '6/27 凌晨', n: '回应入场', d: '调查报告公布，话题从「骂企业」转向「怎么处理」', c: C.amber },
      { t: '6/27 起', n: '焦点迁移', d: '8,833 份各赔 1,000 元、举报奖 10 万成了新的争论点', c: C.green },
      { t: '6/28–', n: '议题外溢', d: '讨论转向联营怎么管、补偿能不能持续', c: C.purple }
    ];
    d.factCounts = { ok: 5, mid: 2, rumor: 1 };
    d.factGap = 0.17;
    d.nodes = { core: 3, mid: 61, tail: 2300 };
    /* 「核心节点是什么」原来只有个 3，谁也不知道指谁 —— 每层都写清是谁；
       次级 61 = 本地民生号 6 + 全国媒体 34 + KOL 21，跟「放大」那一行对得上。 */
    d.nodesHelp = {
      core: '首发顾客 1 · 企业官方 1 · 通报 1',
      mid: '本地民生号 6 · 全国媒体 34 · KOL 21',
      tail: '转评账号'
    };
    d.kvFirst = '顾客短视频 · 1 位';
    d.kvAmp = '本地民生号 6 · 全国媒体 34 · KOL 21';
    d.topic = [
      { n: '食品安全', w: 0.32, ch: [{ n: '加工环境', w: 0.62 }, { n: '联营监管', w: 0.38 }] },
      { n: '企业责任', w: 0.27, ch: [{ n: '是否知情', w: 0.55 }, { n: '收租式背书', w: 0.45 }] },
      { n: '补偿标准', w: 0.24, ch: [{ n: '10 万奖励', w: 0.4 }, { n: '1000 元补偿', w: 0.35 }, { n: '是否营销', w: 0.25 }] },
      { n: '商业模式', w: 0.17, ch: [{ n: '高福利', w: 0.52 }, { n: '联营怎么改', w: 0.48 }] }
    ];
    d.topicTop = d.topic[0];
    /* 中心数不能写成「次提及」：8,833 是涉及退款的份数，不是声量（案例没有可引用的提及量） */
    d.center = { big: '8,833 份', small: '涉及退款' };
    d.peakText = '峰值 6/27 12:00';
    var PLAT = ['抖音', '微博', '微信', '新闻客户端', '小红书', '知乎', '其他'];
    var pv = [0.36, 0.28, 0.14, 0.12, 0.06, 0.03, 0.01];
    var pc = [C.blue, C.red, C.green, C.slate, C.amber, C.cyan, '#c3cad8'];
    d.plat = PLAT.map(function (n, i) { return { n: n, v: pv[i], c: pc[i], m: Math.round(pv[i] * d.tot) }; });
    d.platTop = d.plat[0];
    d.platSub = platSubMap(d.plat, 'case');
    d.emo = [
      { n: '质疑', v: 0.24, c: C.red }, { n: '愤怒', v: 0.12, c: '#e2571f' },
      { n: '失望', v: 0.05, c: C.amber }, { n: '审视', v: 0.12, c: '#b45309' },
      { n: '赞赏', v: 0.24, c: C.blue }, { n: '惊讶', v: 0.13, c: C.blue3 },
      { n: '旁观', v: 0.06, c: C.slate }, { n: '麻木', v: 0.04, c: '#c3cad8' }
    ];
    d.emoNeg = 0.53;
    d.polar = 0.68;
    d.worstEmo = d.emo[0];
    var SEG = [
      { n: '消费者', s: 44, o: 24 }, { n: '行业从业者', s: 58, o: 12 }, { n: '媒体', s: 46, o: 14 },
      { n: '竞品 / 同行', s: 30, o: 25 }, { n: '监管 / 主管部门', s: 52, o: 10 }
    ];
    d.seg = SEG.map(function (x) {
      return { n: x.n, s: x.s / 100, o: x.o / 100, m: 1 - (x.s + x.o) / 100, si: x.s, oi: x.o, mi: 100 - x.s - x.o };
    });
    d.segOpp = d.seg.slice().sort(function (a, b) { return b.o - a.o; })[0];
    d.risk = [
      { n: '食品安全', p: 3, i: 3 }, { n: '管理责任', p: 3, i: 2 }, { n: '补偿示范', p: 2, i: 2 },
      { n: '职业投诉', p: 2, i: 1 }, { n: '行业模仿', p: 1, i: 2 }
    ];
    d.risk.forEach(function (r) {
      var s = r.p + r.i;
      r.lv = s >= 6 ? '红' : (s >= 5 ? '橙' : (s >= 4 ? '黄' : '蓝'));
    });
    d.trendX = ['6/25', '6/26', '6/27 02:00', '6/27 12:00', '6/28', '6/30', '7/2'];
    d.trendVol = [38, 76, 100, 148, 124, 74, 48];
    d.trendNeg = [0.44, 0.62, 0.55, 0.33, 0.24, 0.19, 0.17];
    d.trendMarks = [{ i: 1, t: '负面峰' }, { i: 2, t: '报告发布' }, { i: 3, t: '声量峰' }];
    d.peakText = '声量峰 6/27 12:00';
    d.trendDir = '降';
    d.reversal = 0.12;
    d.resp = [
      { n: '负面占比', a: 0.61, b: 0.18, av: '61%', bv: '18%', dir: -1 },
      { n: '议题发散度', a: 0.78, b: 0.34, av: '0.78', bv: '0.34', dir: -1 },
      { n: '信任度', a: 0.32, b: 0.71, av: '32%', bv: '71%', dir: 1 }
    ];
    d.sources = [
      { n: '公开平台', on: 1 }, { n: '媒体', on: 1 }, { n: '评论区', on: 1 }, { n: '热搜', on: 1 },
      { n: '问卷', on: 0 }, { n: '访谈', on: 0 }, { n: '投诉数据', on: 1 }
    ];
    d.cover = sum(d.sources.map(function (s) { return s.on; })) / d.sources.length;
    d.report = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    d.reportDone = 10;
    d.strip = {
      plat: '<b>抖音</b> 首发（视觉冲击）· 微博放大成全国议题 · 微信长文沉淀成行业案例',
      resp: '回应时效 <b>约 27h</b>（6/25 曝光 → 6/27 凌晨报告）· 渠道：官方账号 + 媒体转载 · 后续：关停 / 辞退免职 / 解约',
      src: '多平台交叉 <b>3/3</b> · 事实核查 <b>通过</b> · 异常账号剔除 <b>未做</b>（评论区水军未单独剥离）',
      rep: '十项齐 —— 事实够硬时，报告不用靠话术补。'
    };
    /* ④ 路径：节奏 / 换说法 / 情绪阶段 —— 业主 2026-10-19 给的三问 */
    d.path = {
      pace: '原本能拖 2–3 天，这次 6/25 晚 → 6/26 上午就全国化，缓冲只剩一夜',
      rewrite: '在微博那一跳被改写：「卫生问题」→「这么大的企业也这样」→ 问责',
      emo: '已到群体愤怒，还差一步「道德共鸣」',
      verdict: '点火与站队已完成、理性承接缺失；声量未见顶，高烈度风险未解'
    };
    d.note = {
      fact: '报告用「时间 / 数量 / 责任人 / 补偿标准」把事实真空一次填满 —— 缺口压到 17%，这是反转的前提。',
      subj: '议题定义权三次易手：顾客 → 企业 → 行业圈。',
      topic: '四轮迁移：食品安全 → 企业责任 → 补偿标准 → 商业模式，每一轮的定义者都换了人。',
      chan: '抖音负责「看见」，微博负责「站队」，微信负责「定性」。',
      emo: '「教科书级公关」是正面但带审视 —— 统计成正向会高估修复程度。',
      seg: '消费者在意「我能不能赔到」，行业人在意「这套能不能学」。',
      risk: '食品安全在右上；把讨论拖长的是补偿标准那一格，不是卫生本身。',
      trend: '负面率先见顶（6/26），声量在报告落地当天中午才见顶 —— 拐点不是热搜第一。',
      resp: '有效的是「事实回应 + 责任切割 + 制度整改」，不是「赔 1000 元」这个数字。',
      src: '缺问卷与访谈 —— 消费者真实感受只能从评论区推断。',
      rep: '案例能十项齐，是因为企业把事实交足了；换个只发声明的，缺的正是前六项。'
    };
    d.verdict = {
      text: '用 893 万买情绪拐点 —— 止损成功，制度问号未解',
      sub: '事实、责任、补偿、整改四件事同时答了：约 27 小时出调查报告，6 天内负面从 61% 压到 18%；联营管理与补偿可持续仍是开口。',
      kpis: [{ v: '61%→18%', l: '负面占比' }, { v: '约 27h', l: '出调查报告' }, { v: '893 万', l: '补偿 + 奖励' }]
    };
    d.foot = '案例复盘口径 · 事实、时间线、金额与份数（8,833 份 / 1,000 元 / 10 万元）取自公开报道；' +
      '百分比、圈层态度、风险落点为结构性示意，<b>不是对该企业的数据引用</b>，仅用于演示 11 层怎么读。';
    return d;
  }

  /* ---------- 看板主体 ---------- */
  function N(d, k, def) { return (d.note && d.note[k]) || def; }
  function ST(d, k, def) { return (d.strip && d.strip[k]) || def; }

  /* ---------- 看板主体：拆成 head（结论）+ body（证据 + 收口）----------
   * 2026-10-18 晚（结构）：业主问「结构是不是总分总」—— 原来不是：
   *   页面是「三张素材卡 → 结论 → 五章 → 判读」，结论被压在 1451px；实验模式还止于交付清单，没有收口。
   *   现在 head = 结论（由页面上层插到「待评估内容」之后，先给判断），body = 五章证据 + 收口；
   *   案例：六 判读（两个视角）→ 七 收口；实验：六 收口。 */
  function board(list) {
    /* 默认案例（胖东来 6·25）。界面上不再有数据源开关；只有代码里显式置
       window.OP_BOARD_SRC = 'runs' 才回实验口径。 */
    var src = global.OP_BOARD_SRC === 'runs' ? 'runs' : 'case';
    if (src === 'runs' && (!list || !list.length)) return null;
    var d = src === 'case' ? buildCase() : build(list);

    /* ① 事实基线 —— 只讲先后（业主：只要展示事情发展顺序，别塞别的） */
    /* ① 事实基线 —— 每个节点三层：阶段号 · 事件 · 关键说明（业主给的样式） */
    var flow = '<div class="opb-flow">' + d.facts.map(function (n, i) {
      return '<div class="opb-fl"><i style="background:' + n.c + '"></i>' +
        '<div class="tx">' +
        '<span class="k">阶段 ' + (i < 9 ? '0' : '') + (i + 1) + ' · ' + esc(n.t) + '</span>' +
        '<b>' + esc(n.n) + '</b>' +
        (n.d ? '<em>' + esc(n.d) + '</em>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    var factCard = card(6, '①', '事实基线', '舆论发酵顺序', flow, '');

    /* ② 传播主体 —— 数字标在图上：3 留圆心，61 / 2,300 用引线拉到环外右侧；
       右边一列只说「这层是谁」，整体右对齐（业主 2026-10-19 标注稿）。 */
    var rings = '<svg viewBox="0 0 240 170" class="opb-con opb-con-call" role="img">' +
      '<circle cx="75" cy="88" r="63" fill="' + C.blue + '" fill-opacity=".10" stroke="' + C.blue + '" stroke-opacity=".20"/>' +
      '<circle cx="75" cy="88" r="45" fill="' + C.blue + '" fill-opacity=".18" stroke="' + C.blue + '" stroke-opacity=".32"/>' +
      '<circle cx="75" cy="88" r="26" fill="' + C.blue + '" fill-opacity=".88" stroke="#fff" stroke-opacity=".9" stroke-width="2"/>' +
      '<text x="75" y="86" text-anchor="middle" class="opb-call-c">' + nf(d.nodes.core) + '</text>' +
      '<text x="75" y="100" text-anchor="middle" class="opb-call-l">传播主体</text>' +
      /* 外环 → 2,300，中环 → 61：线从环带**中间**起笔（不是外沿），斜出后折一段横线，
         数字压在横段上方。业主 2026-10-19：不要端点圆点，起笔落在环带厚度中线上 */
      '<path class="opb-call" d="M119 57 L145 26 H197"/>' +
      '<path class="opb-call" d="M109 77 L145 58 H169"/>' +
      '<text x="149" y="21" class="opb-call-n">' + nf(d.nodes.tail) + '</text>' +
      '<text x="149" y="53" class="opb-call-n">' + nf(d.nodes.mid) + '</text>' +
      '</svg>';
    var nh = d.nodesHelp || {};
    var subjCard = card(6, '②', '传播主体', '核心 / 次级 / 长尾',
      '<div class="opb-split opb-split-v">' + rings +
      '<div class="opb-leg opb-leg-v opb-leg-2">' +
      '<span><i style="background:' + C.blue + '"></i><b>核心节点</b><em>' + esc(nh.core || '首发 1 · 官方 1 · 头部媒体 1') + '</em></span>' +
      '<span><i style="background:' + C.blue + ';opacity:.55"></i><b>次级节点</b><em>' + esc(nh.mid || '媒体号 / KOL') + '</em></span>' +
      '<span><i style="background:' + C.blue4 + '"></i><b>长尾账号</b><em>' + esc(nh.tail || '转评账号') + '</em></span>' +
      '</div></div>', '');

    /* ② 上半张：把「谁在传」翻成「企业管不管得住」（业主：拆成两个卡片，上面展示对企业影响）
       表现方式（业主 2026-10-18 22:40）：程度词 + 小黄人表情 —— 能管住的笑，管不住的皱眉 */
    function face(kind) {
      var mouth = kind === 'good' ? 'M9 16.5 Q15 22 21 16.5'
        : kind === 'bad' ? 'M9 20 Q15 14.5 21 20' : 'M9 18.5 H21';
      return '<svg viewBox="0 0 30 30" class="opb-face" aria-hidden="true">' +
        '<circle cx="15" cy="15" r="13.6" fill="#f7c948"/>' +
        '<circle cx="10.6" cy="12" r="1.7" fill="#3b2f0b"/>' +
        '<circle cx="19.4" cy="12" r="1.7" fill="#3b2f0b"/>' +
        '<path d="' + mouth + '" fill="none" stroke="#3b2f0b" stroke-width="1.7" stroke-linecap="round"/></svg>';
    }
    /* 2026-10-19 业主：这张卡只留一个结论 —— 「对企业影响很大」。
       原来三条（很强/一般/很弱）讲的是「企业能施加多少影响」，把结论稀释掉了；
       真正压在企业身上的是长尾那 2,300 个转评账号：企业插不上手，情绪与周期由它们决定。 */
    var impactCard = card(6, '', '对企业影响', '压力来自最管不住的那一层',
      '<div class="opb-big">' + face('bad') +
      '<div class="tx"><b>影响很大</b>' +
      '<span>长尾 ' + nf(d.nodes.tail) + ' 个转评账号在放大情绪、拉长周期 —— 企业插不上手</span></div>' +
      '</div>', '');

    /* ③ 议题树 —— 业主 2026-10-19：这张要回答「舆论集中在哪」，不是罗列议题分类。
       标题直接换成问句；条带补一句集中度结论（前两块合计），别让人自己加。 */
    var topicCard = card(6, '③', '内容议题', '议题树 · 面积 = 份额',
      treemapHtml(d.topic),
      '');

    /* ④ 渠道与路径 —— 2026-10-19 重构（业主口径）：
       「渠道决定这事被改成什么样，路径决定这个改法怎么一路传下去、在哪拐弯」，两件事不拆开看。
       上：路径条 —— 点火 → 站队 → 收口 → 定型，标出「说法在哪一跳被改写」；
       下：四个渠道块 —— 每个写「抓了什么 / 放大了什么 / 盖住了什么」；
       底：一句判断，顺带交代长尾为什么不改说法。 */
    var tell = d.src === 'case' ? TELL_CASE : TELL_GEN;
    var GROUP = { '微信': '公众号 / 新闻端', '新闻客户端': '公众号 / 新闻端' };
    var gmap = {}, gorder = [];
    d.plat.forEach(function (p) {
      var key = GROUP[p.n] || p.n;
      var t = tell[key] || tell[p.n] || { role: '长尾', grab: '转帖与截图', amp: '情绪续温', cover: '原始出处' };
      if (!gmap[key]) {
        gmap[key] = { n: key, v: 0, c: p.c, role: t.role, grab: t.grab, amp: t.amp, cover: t.cover };
        gorder.push(key);
      }
      gmap[key].v += p.v;
    });
    var chans = gorder.map(function (k) { return gmap[k]; })
      .filter(function (c) { return c.role !== '长尾'; })
      .sort(function (a, b) { return ROLE_RANK[a.role] - ROLE_RANK[b.role]; });
    var tailV = gorder.reduce(function (a, k) { return a + (gmap[k].role === '长尾' ? gmap[k].v : 0); }, 0);

    var rail = d.src === 'case' ? [
      { t: '6/25 晚', role: '点火', n: '抖音', d: '加工环境视频首发' },
      { t: '6/26 上午', role: '站队', n: '微博', d: '议题转向「企业人品」', mark: 1 },
      { t: '6/27 凌晨', role: '收口', n: '知乎', d: '报告落地，转向责任界定' },
      { t: '6/28 起', role: '定型', n: '公众号 / 客户端', d: '定性「教科书级公关」' }
    ] : [
      { t: '第 1 跳', role: '点火', n: '短视频', d: '情绪素材先行' },
      { t: '第 2 跳', role: '站队', n: '微博', d: '立场对立' },
      { t: '第 3 跳', role: '收口', n: '知乎', d: '责任与证据' },
      { t: '第 4 跳', role: '定型', n: '公众号 / 客户端', d: '完整叙事' }
    ];

    var railHtml = '<div class="opb-rail">' + rail.map(function (r) {
      return '<div class="opb-st' + (r.mark ? ' on' : '') + '"><i></i>' +
        '<p class="t">' + esc(r.t) + ' · ' + esc(r.role) + '</p>' +
        '<p class="n">' + esc(r.n) + '</p>' +
        '<p class="d">' + esc(r.d) + '</p>' +
        (r.mark ? '<span class="mk">说法在这跳被改写</span>' : '') +
        '</div>';
    }).join('') + '</div>';

    var blocks = chans.map(function (c) {
      return '<div class="opb-cb">' +
        '<h5><i style="background:' + c.c + '"></i>' + esc(c.n) +
        '<u class="opb-role">' + esc(c.role) + '</u><span>' + p0(c.v) + '</span></h5>' +
        '<p><b>抓</b>' + esc(c.grab) + '</p>' +
        '<p><b>放大</b>' + esc(c.amp) + '</p>' +
        '<p><b>盖住</b>' + esc(c.cover) + '</p>' +
        '</div>';
    }).join('');

    var chanCard = card(6, '④', '渠道与路径', '被改成什么样 · 怎么一路传下去',
      railHtml +
      '<div class="opb-cg">' + blocks + '</div>' +
      '<div class="opb-strip">结论：' + esc((d.path || {}).verdict || '') + '</div>',
      '');

    /* ⑤ 情绪 */
    var worst = d.worstEmo || d.emo.slice(0, 4).slice().sort(function (a, b) { return b.v - a.v; })[0];
    var ep = p100(d.emo.map(function (e) { return e.v; }));
    var emoCard = card(5, '⑤', '情绪与态度', '八类细分 · 不看正负两极',
      '<div class="opb-split">' + donut(d.emo, p1(d.emoNeg), '负面') +
      leg(d.emo.map(function (e, i) { return { n: e.n, v: ep[i] + '%', c: e.c }; })) + '</div>' +
      '<div class="opb-strip">极化指数 <b>' + d.polar.toFixed(2) + '</b> · 最伤的是 <b>' + esc(worst.n) + '</b>（' + p1(worst.v) + '）</div>',
      '');

    /* ⑥ 圈层态度 —— 100% 堆叠条（业主：五格热力块颜色太淡，看不出对立强弱） */
    var segRows = d.seg.map(function (s) {
      return '<div class="opb-sr"><span>' + esc(s.n) + '</span>' +
        '<b><i class="s" style="width:' + s.si + '%">' + s.si + '%</i>' +
        '<i class="m" style="width:' + s.mi + '%">' + s.mi + '%</i>' +
        '<i class="o" style="width:' + s.oi + '%">' + s.oi + '%</i></b></div>';
    }).join('');
    var segCard = card(7, '⑥', '受众与圈层', '圈层 × 态度（每行 = 100%）',
      '<div class="opb-srs"><div class="opb-sr opb-sr-h"><span></span><b class="h">' +
      '<em>支持</em><em>中间</em><em>反对</em></b></div>' + segRows + '</div>' +
      '<div class="opb-strip">反对最高：<b>' + esc(d.segOpp.n) + '</b> ' + Math.round(d.segOpp.o * 100) + '%</div>',
      '');

    /* ⑦ 风险矩阵 4×4 */
    var cells = '';
    for (var i = 3; i >= 0; i--) {
      for (var p = 0; p < 4; p++) {
        var items = d.risk.filter(function (r) { return r.i === i && r.p === p; });
        var sc = i + p;
        var bg = sc >= 6 ? 'rgba(220,38,38,.12)' : (sc >= 5 ? 'rgba(217,119,6,.12)' : (sc >= 4 ? 'rgba(234,179,8,.13)' : 'rgba(37,99,235,.06)'));
        cells += '<div class="opb-mc" style="background:' + bg + '">' + items.map(function (r) {
          var col = r.lv === '红' ? C.red : (r.lv === '橙' ? C.amber : (r.lv === '黄' ? '#ca8a04' : C.blue));
          return '<i class="opb-dot" style="background:' + col + '" title="' + esc(r.n) + ' · ' + r.lv + '"></i>' +
            '<span>' + esc(r.n) + '</span>';
        }).join('') + '</div>';
      }
    }
    /* 风险档不能只靠颜色：红橙黄蓝四个点，色弱读不出差别 —— 条带里把最高档的名字写出来 */
    var topRisk = d.risk.slice().sort(function (a, b) { return (b.p + b.i) - (a.p + a.i); })[0];
    var riskCard = card(6, '⑦', '影响与风险', '概率 × 影响 · 红橙黄蓝',
      '<div class="opb-mxg">' +
      '<div class="opb-mx-y">影响<b>高</b><b></b><b></b><b>低</b></div>' +
      '<div class="opb-mx-body">' + cells + '</div>' +
      '<div class="opb-mx-x"><b>低</b><b></b><b></b><b>高</b><span>发生概率</span></div>' +
      '</div>' +
      '<div class="opb-strip">红 <b>' + d.risk.filter(function (r) { return r.lv === '红'; }).length + '</b> · 橙 <b>' + d.risk.filter(function (r) { return r.lv === '橙'; }).length + '</b> · 黄 <b>' + d.risk.filter(function (r) { return r.lv === '黄'; }).length + '</b> · 蓝 <b>' + d.risk.filter(function (r) { return r.lv === '蓝'; }).length + '</b> —— 最高档：<b>' + esc(topRisk.n) + '</b>（' + topRisk.lv + '）</div>',
      '');

    /* ⑧ 趋势（双轴：面积 = 声量指数，折线 = 负面占比。图例必须给，否则读者要猜哪根是哪根） */
    var trendCard = card(6, '⑧', '趋势预判', '未来 72h · 声量 / 负面率',
      '<div class="opb-lgd"><span><i class="area"></i>声量指数（左轴，当前 = 100）</span>' +
      '<span><i class="line"></i>负面占比（右轴）</span></div>' +
      curve(d.trendX,
        { vals: d.trendVol, color: C.blue },
        { vals: d.trendNeg, color: C.red, marks: d.trendMarks || [] }) +
      '<div class="opb-strip">方向 <b>' + d.trendDir + '</b> · ' + esc(d.peakText || '声量峰 T+6h（预判）') +
      ' · 反转概率 <b>' + p0(d.reversal) + '</b>（推演值，靠新证据 / 官方表态触发）</div>',
      '');

    /* ⑨ 应对：卡头就写「推演」——没有前后两次实测，不能当效果证据读 */
    var respCard = card(7, '⑨', '应对与效果', '回应前后对比 · 推演',
      '<div class="opb-lgd"><span><i class="hollow"></i>回应前</span><span><i class="solid"></i>回应后</span>' +
      '<span class="opb-lgd-n">横轴 = 指标值；离中心越远不代表越糟</span></div>' +
      dumbbell(d.resp) +
      '<div class="opb-strip">' + ST(d, 'resp', '回应时效 <b>4.2h</b>（假设值，非本屏实测）—— 已超黄金 4h 窗口') + '</div>',
      d.respNote || '');

    /* ⑩ 数据与方法 */
    var srcCard = card(5, '⑩', '数据与方法', '覆盖度 · 交叉校验',
      '<div class="opb-split">' + ring(d.cover, C.cyan, p0(d.cover), '源覆盖') +
      '<div class="opb-chips">' + d.sources.map(function (s) {
        return '<span class="' + (s.on ? 'on' : '') + '">' + (s.on ? '✓ ' : '· ') + esc(s.n) + '</span>';
      }).join('') + '</div></div>' +
      '<div class="opb-strip">' + ST(d, 'src', '多平台交叉 <b>3/3</b> · 事实核查 <b>通过</b> · 异常账号剔除 <b>3 个</b>') + '</div>',
      '');

    /* ⑪ 只留两个能算的环：报告项、源覆盖 */
    var seg = d.report.map(function (v, i) {
      return '<i class="' + (v ? 'on' : '') + '" title="第 ' + (i + 1) + ' 项">' + (v ? '✓' : '') + '</i>';
    }).join('');
    var repCard = card(12, '⑪', '输出与交付', '十项报告 · 完成 ' + d.reportDone + '/10',
      '<div class="opb-rep"><div class="opb-seg">' + seg + '</div>' +
      '<div class="opb-rings opb-rings-s">' +
      ring(d.reportDone / 10, C.blue, d.reportDone + '/10', '报告项') +
      ring(d.cover, C.cyan, p0(d.cover), '源覆盖') +
      '</div></div>' +
      '<div class="opb-strip">' + ST(d, 'rep', '缺 <b>沟通切口建议 / 附录证据链 / 效果监测指标</b> 三项 —— 要等访谈与投诉数据接入后填，不能先写死。') + '</div>',
      '');

    var cv = d.src === 'case' ? caseViews(d) : null;
    var chapters =
      chapter('一', '事实与传播', '缺口在哪 · 谁首发 · 谁定调') + factCard +
      '<div class="opb-col">' + impactCard + subjCard + '</div>' +
      chapter('二', '议题与渠道', '舆论集中在哪 · 被改成什么样 · 怎么传下去') + topicCard + chanCard +
      chapter('三', '情绪与受众', '情绪不能只分正负 · 圈层不是一个人') + emoCard + segCard +
      chapter('四', '风险与走向', '风险落点 · 未来 72 小时') + riskCard + trendCard +
      chapter('五', '应对与交付', '回应有没有用 · 数据够不够 · 报告交没交') + respCard + srcCard + repCard +
      (cv
        ? chapter('六', '判读', '两个视角怎么读这组数') + cv.views +
          chapter('七', '收口', '一句话收口') + cv.end
        : chapter('六', '收口', '还缺什么才能投') + endCardRun(d));

    var foot = '<div class="opb-foot">' + (d.foot ||
      ('口径 · 正/中/负占比与总量只取<b>已完成</b>的 ' + d.runsDone + ' 次舆情实验（' + nf(d.tot) +
        ' 次提及），可与实验记录逐项对账；' + (d.runsPend ? '未完成的 ' + d.runsPend + ' 次只列进度，不进任何百分比。' : '') +
        '平台份额、情绪八类、议题结构、风险落点、圈层态度、趋势斜率由同一份数据确定性派生，' +
        '只用于推演，<b>不写回实验记录</b>；⑨ 为推演值。已完成实验不足 3 次时，风险档只作参考、不用于投放决策。')) + '</div>';

    /* head 会被页面插到「待评估内容」之后（先给判断），body 落在地图/网络之后（再给证据） */
    return {
      head: '<div class="opb opb-head">' + hero(d) + '</div>',
      body: '<div class="opb opb-body"><div class="opb-grid">' + chapters + '</div>' + foot + '</div>',
      d: d
    };
  }

  function html(list) {
    var b = board(list);
    return b ? b.head + b.body : '';
  }

  /* ---------- 六维雷达（⑫ 企业视角）---------- */
  function radar(items) {
    var W = 236, H = 216, cx = 118, cy = 108, R = 72, n = items.length;
    function pt(i, r) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    var grid = [0.25, 0.5, 0.75, 1].map(function (k) {
      return '<polygon points="' + items.map(function (it, i) { return xy(pt(i, R * k)); }).join(' ') +
        '" fill="none" stroke="#e6ecf7" stroke-width="1"/>';
    }).join('');
    var axes = items.map(function (it, i) {
      var q = pt(i, R);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + f1(q[0]) + '" y2="' + f1(q[1]) + '" stroke="#e6ecf7"/>';
    }).join('');
    var shape = items.map(function (it, i) { return xy(pt(i, R * it.v)); }).join(' ');
    var labels = items.map(function (it, i) {
      var q = pt(i, R + 20);
      return '<text x="' + f1(q[0]) + '" y="' + f1(q[1] + 3.5) + '" text-anchor="middle" font-size="10.5" fill="#7b8798">' +
        esc(it.n) + ' ' + p0(it.v) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opb-radar" role="img">' + grid + axes +
      '<polygon points="' + shape + '" fill="' + C.blue + '" fill-opacity=".16" stroke="' + C.blue + '" stroke-width="2" stroke-linejoin="round"/>' +
      labels + '</svg>';
  }

  /* 议题定义权四轮：雪佛龙阶梯。第一版把「拐点…」整句写在图底、还右对齐到第 4 段，
     结果整句溢出被裁 —— 改成第 3 段下方一个小 pill。 */
  function ladder(steps, hot) {
    var W = 520, H = 100, w = W / steps.length;
    var body = steps.map(function (st, i) {
      var x = i * w, on = i === hot;
      var d = 'M' + f1(x + 6) + ' 16 L' + f1(x + w - 18) + ' 16 L' + f1(x + w - 2) + ' 44 L' + f1(x + w - 18) + ' 72 L' + f1(x + 6) + ' 72 L' + f1(x + 18) + ' 44 Z';
      return '<path d="' + d + '" fill="' + (on ? C.blue : '#eef4ff') + '" stroke="' + (on ? C.blue : '#dbe7ff') + '"/>' +
        '<text x="' + f1(x + w / 2 + 4) + '" y="41" text-anchor="middle" class="' + (on ? 'opb-lad-on' : 'opb-lad') + '">' + esc(st.n) + '</text>' +
        '<text x="' + f1(x + w / 2 + 4) + '" y="57" text-anchor="middle" class="' + (on ? 'opb-lad-on2' : 'opb-lad2') + '">' + esc(st.who) + '</text>';
    }).join('');
    var hx = hot * w + w / 2;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opb-svg" role="img">' + body +
      '<rect x="' + f1(hx - 24) + '" y="80" width="48" height="16" rx="8" fill="' + C.blue + '" fill-opacity=".10"/>' +
      '<text x="' + f1(hx) + '" y="91" text-anchor="middle" class="opb-lad-hot">拐点</text></svg>';
  }

  /* ---------- 双视角判断（只在案例模式出）----------
   * 这两张卡不进 11 层，因为它们是**对这套数据的判读**，不是又一层指标。 */
  function caseViews(d) {
    /* ⑫ 企业视角：六维评分 + 影响三档 + 成本三数 + 关键人群优先级 */
    var six = [
      { n: '时效', v: 0.80 }, { n: '事实', v: 0.95 }, { n: '态度', v: 0.90 },
      { n: '补偿', v: 0.92 }, { n: '责任', v: 0.88 }, { n: '渠道', v: 0.85 }
    ];
    var imp = [
      { t: '短期', v: 0.85, c: C.red, d: '信任冲击', tip: '客流与复购受冲击，核心顾客失望最真' },
      { t: '中期', v: 0.55, c: C.amber, d: '模式质疑', tip: '收租式背书：出事能不能只处理商户' },
      { t: '长期', v: 0.45, c: C.blue, d: '看整改', tip: '整改不透明会变成「高信任也会翻车」的长期标签' }
    ];
    var impHtml = '<div class="opb-imp">' + imp.map(function (x) {
      return '<div class="opb-imp-r" title="' + esc(x.tip) + '"><span>' + x.t + '</span>' +
        '<b><i style="width:' + Math.round(x.v * 100) + '%;background:' + x.c + '"></i></b>' +
        '<em>' + esc(x.d) + '</em></div>';
    }).join('') + '</div>';
    /* 成本不做单根条：10 万对 883 万只有 1.1%，画出来看不见，还容易被读成「奖励占比很小」 */
    var kpi3 = '<div class="opb-kpi3">' +
      '<div><b>883<span>万</span></b><i>退款补偿</i></div>' +
      '<div><b>10<span>万</span></b><i>奖励投诉</i></div>' +
      '<div><b>893<span>万</span></b><i>合计成本</i></div></div>';
    var prio = ['购买过相关产品的消费者', '新乡本地核心顾客', '联营商户与员工', '监管部门', '全国围观与媒体']
      .map(function (n, i) {
        return '<span class="' + (i < 2 ? 'p1' : '') + '"><i>' + (i + 1) + '</i>' + n + '</span>';
      }).join('');
    var bizCard = card(7, '⑫', '企业视角', '止损账 · 决策依据',
      '<div class="opb-split">' + radar(six) +
      '<div class="opb-biz">' + impHtml + kpi3 + '</div></div>' +
      '<div class="opb-prio">' + prio + '</div>',
      '判断：处置有效，但不是「赔得多」—— 它同时答了事实、谁负责、消费者怎么办、以后怎么改。');

    /* ⑬ 全局视角：定义权四轮 + 外溢四向 */
    var steps = [
      { n: '食品安全', who: '顾客视频' },
      { n: '品牌失责', who: '媒体 + 网民' },
      { n: '企业担当', who: '调查报告' },
      { n: '公关样本', who: '行业 / 营销圈' }
    ];
    var quad = [
      { n: '行业', d: '联营模式怎么管 · 品牌与商户责任怎么切', c: C.blue },
      { n: '监管', d: '食品安全检查会不会加码 · 同类企业被对比', c: C.amber },
      { n: '公关伦理', d: '「谁赔得多谁有理」会不会成新标准', c: C.purple },
      { n: '消费者维权', d: '重奖投诉会否鼓励拍摄、索赔', c: C.red }
    ];
    var globCard = card(5, '⑬', '全局视角', '公共性 · 议题与外溢',
      ladder(steps, 2) +
      '<div class="opb-quad">' + quad.map(function (q) {
        return '<div style="border-left-color:' + q.c + '"><b>' + esc(q.n) + '</b><span>' + esc(q.d) + '</span></div>';
      }).join('') + '</div>',
      '判断：主事件会快速回落，但次生议题（联营整改、补偿可持续）长期存在。');

    /* ⑭ 两个角度合起来（收口，单独成章） */
    var mergeCard = card(12, '⑭', '合起来判断', '止损 ≠ 过关',
      '<div class="opb-merge">' +
      '<div class="biz"><i>企业</i>用「快速调查 + 重奖监督 + 超额补偿 + 责任处理 + 商户切割」买到信任止损窗口；' +
      '短期过关，不等于食品安全管理过关，真正的考验是联营整改与日常管理。</div>' +
      '<div class="glob"><i>全局</i>食品安全高压线撞上高信任品牌反差，议题从「质疑企业」转为「讨论担当」，' +
      '但公众对食品安全与联营模式的审视没有消失。</div>' +
      '<div class="core">赢在用事实和补偿<b>关闭情绪窗口</b>；留下的问号是 —— ' +
      '高信任品牌如何用<b>日常管理</b>证明信任，而不是靠一次高额赔偿修复信任。</div>' +
      '</div>', '');

    return { views: bizCard + globCard, end: mergeCard };
  }

  /* ---------- 实验模式的收口 ----------
   * 之前实验模式走完 ⑪ 输出与交付 就没了 —— 那是交付清单，不是判断，
   * 所以「总—分—总」的第二个总只在案例模式存在。这里补一张同位置的收口卡：
   * 先给能不能投，再给还差哪几步。所有数字都从同一份数据取，不新增口径。 */
  function endCardRun(d) {
    var verdict, why;
    if (d.runsPend || d.runsDone < 3) {
      verdict = '先别投';
      why = '已完成 ' + d.runsDone + ' 次，均值只代表这 ' + d.runsDone + ' 次；补到 3 次以前，投放结论不成立。';
    } else if (d.neg > 0.4) {
      verdict = '先降险再投';
      why = '负面 ' + p1(d.neg) + ' 已过 40% 高风险线，先改主议题里的表述，再谈投放。';
    } else {
      verdict = '可小步试投';
      why = '负面 ' + p1(d.neg) + '，风险档最高只到橙；先小流量验证，再放量。';
    }
    var miss = d.sources.filter(function (s) { return !s.on; }).map(function (s) { return s.n; });
    var todo = [];
    if (d.runsPend) todo.push('<b>再补 ' + d.runsPend + ' 次实验</b> —— 现在 ' + d.runsDone + '/' + d.runsAll + ' 已完成，其余不进均值');
    if (miss.length) todo.push('<b>接上 ' + miss.join(' / ') + '</b> —— 源覆盖现在只有 ' + p0(d.cover));
    todo.push('<b>改主议题的表述</b> —— 「' + esc(d.topicTop.n) + '」占 ' + p0(d.topicTop.w) + '，先把这一块改掉再投');
    return card(12, '⑫', '收口', '还缺什么才能投',
      '<div class="opb-end"><div class="v"><b>' + verdict + '</b><span>' + why + '</span></div>' +
      '<ol>' + todo.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol></div>', '');
  }

  /* ④ 平台往下钻：点图例一行 → 换成本平台的账号构成；点卡头「‹ 全平台」→ 退回。
     状态放 window，因为看板是纯字符串渲染、回不到页面 state —— 重绘走 app 的 navigate。 */
  var ACTIONS = global.ACTIONS || (global.ACTIONS = {});
  ACTIONS['opb-plat'] = function (id, btn, h) {
    global.OPB_PLAT = (id === 'all' || global.OPB_PLAT === id) ? null : id;
    if (h && h.navigate) h.navigate({}, { scroll: false });
  };

  global.OP_BOARD = {
    html: html,
    /* parts：页面要把「结论」提到素材卡前面，所以拆成 head / body 两段，各自闭包完整 */
    parts: function (list) { var b = board(list); return b || { head: '', body: '' }; }
  };
})(window);
