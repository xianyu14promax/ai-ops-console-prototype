/* SECTION: r-interview-data  (AI 访谈 · 数据层 · 唯一出口)
 * 页面只读这里，不自己造数。装的是：
 *   · 六笔账（计划 / 有效对话 / 联系完成 / 联系不上 / 联系中断 / 联系中 / 未联系 / 退出）
 *   · 五态联系状态 + 超时规则（24h→中断、72h 或 3 次用尽→联系不上终态）
 *   · 轮次与话题同源（每轮带 outlineItemId，答句按话题分组，禁止跨话题取句）
 *   · 必问覆盖 / 低质量判定 / 历次对比 / 打包件内容
 * 口径（拍板结果）：有效对话 = 完成至少 1 轮实质回答（= consulted）；联系完成 = 已回复（= replied）；
 *   计划 = 导入名单按行数、其余按已触达人数；联系不上 / 联系中断 / 联系中 / 未联系四笔按任务状态分布生成，
 *   页面须标注"分布为内置数据"。接口清单见《方案-AI访谈一对一-v5-修订版》§5。
 *
 * 加载顺序：本文件必须在 v10-interview.js 与 v10-interview-home.js 之前。
 */
(function (global) {
  'use strict';
  var NS = global.IV_DATA = {};
  var S = global.DATA_SEED;

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function pad2(n) { var s = String(n); return s.length < 2 ? '0' + s : s; }
  function tables() { try { return global.APP_DATA.getAssetTables() || {}; } catch (e) { return {}; } }
  NS.rows = function () { return (tables().survey || {}).rows || []; };   /* 表名保持 T.survey（历史名） */
  NS.pool = function () { return (tables().user_pool || {}).rows || []; };

  /* ---------------- 五态 ---------------- */
  var STATES = [
    { k: 'pending', t: '未联系', tone: 'idle' },
    { k: 'dialing', t: '正在联系中', tone: 'info' },
    { k: 'interrupted', t: '联系中断', tone: 'warn' },
    { k: 'unreachable', t: '联系不上', tone: 'bad' },
    { k: 'done', t: '联系完成', tone: 'ok' }
  ];
  var SL = {}; STATES.forEach(function (x) { SL[x.k] = x.t; });
  NS.STATES = STATES; NS.STATE_LABEL = SL;
  NS.stateOf = function (k) { var o = null; STATES.forEach(function (x) { if (x.k === k) o = x; }); return o; };

  /* 联系状态怎么流转（界面上要能看见） */
  NS.RULES = {
    dialingTimeoutH: 24,        /* 正在联系中 24h 无回应 → 联系中断 */
    interruptedMaxH: 72,        /* 联系中断 停留上限 */
    retryMax: 3,                /* 重试最多 3 次（24h / 72h 各追一次） */
    reopenMax: 2,               /* 联系不上人工重开上限 */
    rounds: { min: 3, wrapUpAt: 7, intentExtra: 2, hardMax: 12 },  /* 轮次：默认 3–7，有意向/聊得投机 +2，上限 12 */
    turnChars: 60, openingChars: 40
  };

  /* ---------------- 提纲（给 AI 的交待） ----------------
     正文见本文件下半部的「提纲真源」一节：真源在 state.ivOutline，NS.OUTLINE 是 getter。
     这里不再放写死的对象 —— 原来它和 v10-interview.js 的常量、首页文本框各说一套。 */
  NS.mustTopics = function () { return NS.OUTLINE.topics.filter(function (t) { return t.must; }); };

  /* ---------------- 提纲真源 ----------------
   * 原来同一件事有三份提纲：首页①那个文本框（没人读）、v10-interview.js 里的常量、本文件的 NS.OUTLINE。
   * 结果就是"你写你的，页面演它的"—— AI 评价会骂你把"价格预期"设成禁问，哪怕你早就改掉了。
   *
   * 现在收口成一份：**写在 state.ivOutline（APP_SHELL.state）里**，首页①保存时解析写入，
   * 详情页「谈什么」和 AI 评价都从这里读。NS.OUTLINE 改成 getter，老读法（NS.OUTLINE.topics）不动。
   */

  /* 默认话题的题库：用户只写"名字｜必/可/禁｜说明"，问答与追问由这里补齐，免得逐题空着 */
  var TOPIC_LIB = {
    '续约意愿': { q: '这半年整体用下来，续约的意向如何？', a: ['还在评估，主要是想把权限这块先理顺。', '倾向续，但得看这次报价。'], probe: { q: '“理顺”具体指哪一步？', why: '回答停在结论层，缺少可归因的事实', kb: { doc: '产品文档库 §权限模型 3.2', score: 0.82 } }, a2: ['就是字段级权限，我们内部要求到字段。', '导出和权限得一起解决，不然还得手工补。'] },
    '使用障碍': { q: '哪一步最费时间？', a: ['导出几十万行要等很久，基本得排队。', '配置要来回问实施，自己搞不定。'], probe: { q: '您一般什么场景要导这么多行？', why: '提到性能问题但未说明场景', kb: { doc: '产品文档库 §批量导出 2.3', score: 0.91 } }, a2: ['季度复盘要拉全量明细，几百万行。', '财务对账，每月一次。'] },
    '竞品对比': { q: '最近有没有在看别的方案？', a: ['有看一家，主要是他们按字段级权限卖。', '看过，最后没深入。'], probe: { q: '如果我们也做到字段级，您还会考虑换吗？', why: '出现竞品，需确认决策权重', kb: { doc: '销售话术库 §竞品应对 · 权限', score: 0.77 } }, a2: ['那就没理由换了，迁移成本太高。', '得看价格，功能是一方面。'] },
    '价格预期': { q: '', a: [], probe: null, a2: [] }   /* 禁问：除非被访者主动提，否则不问 */
  };
  var GENERIC_A = ['这个我得回去确认一下。', '目前还在评估阶段。'];
  var GENERIC_PROBE = { q: '能具体说说是什么场景吗？', why: '回答停在结论层，缺少可归因的事实', kb: { doc: '产品文档库 §通用', score: 0.7 } };

  var FLAGS = {
    '必问': 'must', '必': 'must', 'must': 'must', 'required': 'must',
    '可选': 'opt', '可': 'opt', 'opt': 'opt', 'optional': 'opt',
    '禁问': 'ban', '禁': 'ban', 'ban': 'ban', 'banned': 'ban'
  };
  var FLAG_TXT = { must: '必问', opt: '可选', ban: '禁问' };

  /** 把「名字｜必问/可选/禁问｜内容（一行一条）」解析成结构化话题；解析结果可逆回文本 */
  NS.parseOutlineText = function (text) {
    var out = [];
    String(text == null ? '' : text).split('\n').forEach(function (line, i) {
      var s = String(line).replace(/\s+$/, '');
      if (!s.trim()) return;
      var p = s.split(/[｜|]/);
      var name = (p[0] || '').trim() || ('话题 ' + (i + 1));
      var flag = FLAGS[String(p[1] || '').trim()] || 'opt';
      var body = (p[2] || '').trim();
      var lib = TOPIC_LIB[name] || {};
      out.push({
        id: 't' + (i + 1), name: name, flag: flag, must: flag === 'must', ban: flag === 'ban',
        asks: body ? body.split(/\s*[／/]\s*/).filter(Boolean) : [],
        detail: body,
        q: lib.q != null ? lib.q : (body.split('？')[0] ? body.split('？')[0] + '？' : name + '：能具体说说吗？'),
        a: lib.a || GENERIC_A, probe: lib.probe !== undefined ? lib.probe : GENERIC_PROBE, a2: lib.a2 || GENERIC_A
      });
    });
    if (!out.length) out = NS.parseOutlineText(NS.OUTLINE_TEXT);
    out.forEach(function (t, i) { t.id = 't' + (i + 1); });
    return out;
  };
  /** 结构化话题 → 文本（可逆，供首页文本框回显） */
  NS.jpOutlineText = function () {
    return NS.OUTLINE.topics.map(function (t) {
      return t.name + '｜' + FLAG_TXT[t.flag] + '｜' + (t.detail || '');
    }).join('\n');
  };
  /** 拿当前真源：有人编辑过就用编辑过的，否则用默认 */
  NS.currentOutline = function () {
    var st = (global.APP_SHELL && global.APP_SHELL.state) || null;
    if (st && st.ivOutline && st.ivOutline.topics && st.ivOutline.topics.length) return st.ivOutline;
    return NS.OUTLINE_BASE;
  };
  /* ============================================================
   * 问卷题目（题型制）
   * 一张问卷 = 题目列表，每题有题型：单选 / 多选 / 问答 / 量表。
   * 保存时折算成提纲文本走老的 topics 链路，详情页「谈什么」不用改。
   * ============================================================ */
  NS.QTYPE = { single: '单选', multi: '多选', text: '问答', scale: '量表' };

  NS.QUESTIONS_BASE = [
    { id: 'q1', type: 'single', required: true, topic: '续约意愿',
      title: '这半年整体用下来，续约的意向如何？',
      options: ['一定会续', '还在评估', '大概率不续', '已决定不续'] },
    { id: 'q2', type: 'multi', required: true, maxPick: 3, topic: '使用障碍',
      title: '哪一步最费时间？',
      options: ['数据导入', '权限配置', '报表搭建', '审批流配置', '移动端使用'] },
    { id: 'q3', type: 'text', required: false, topic: '',
      title: '如果能改一件事，你希望是什么？', options: [] }
  ];

  /** 当前这张问卷的题目：改过就用改过的，否则用默认 */
  NS.questions = function () {
    var st = (global.APP_SHELL && global.APP_SHELL.state) || null;
    if (st && st.ivQuestions && st.ivQuestions.length) return st.ivQuestions;
    return NS.QUESTIONS_BASE;
  };

  /** 题干首个标点前取名字；太长的会把详情页话题树第一列撑开 */
  var shortName = function (raw) {
    var s = String(raw || '').replace(/[？?！!。，,；;：:].*$/, '');
    if (!s) s = String(raw || '');
    return s.length > 12 ? s.slice(0, 12) : s;
  };

  /** 题目 → 提纲文本（供详情页老链路）。竖线会破坏解析，先替换掉 */
  NS.questionsToOutline = function (qs) {
    return (qs || []).map(function (q) {
      var raw = String(q.title || '未命名题目').replace(/[｜|]/g, '／');
      var name = (q.topic || '').replace(/[｜|]/g, '／') || shortName(raw);
      var opts = (q.options || []).join('／');
      /* 多选题的「最多选 N 项」跟着题干走，详情页「谈什么」也要看得到 */
      var lim = (q.type === 'multi' && q.maxPick) ? '（最多选 ' + q.maxPick + ' 项）' : '';
      var body = (q.type === 'text' || q.type === 'scale')
        ? (raw + '（开放作答）')
        : (raw + lim + (opts ? '（' + opts + '）' : ''));
      return name + '｜' + (q.required ? '必问' : '可选') + '｜' + body;
    }).join('\n');
  };

  /** 题型分布 */
  NS.qtypeStat = function (qs) {
    var st = { single: 0, multi: 0, text: 0, scale: 0 };
    (qs || []).forEach(function (q) { if (st[q.type] === undefined) st[q.type] = 0; st[q.type] += 1; });
    return st;
  };

  /** 首屏文本框该显示什么 */
  NS.outlineText = function () {
    return NS.jpOutlineText(NS.currentOutline());
  };
  /** 首屏文本框只回显「人改过的」内容；没人改过就留空，让 placeholder 顶位。
      默认提纲照样是真源（currentOutline 仍返回 OUTLINE_BASE），只是不再预填给人看。 */
  NS.outlineEditedText = function () {
    var st = (global.APP_SHELL && global.APP_SHELL.state) || null;
    if (st && st.ivOutline && st.ivOutline.topics && st.ivOutline.topics.length) return NS.jpOutlineText(st.ivOutline);
    return '';
  };

  NS.OUTLINE_TEXT =
    '续约意愿｜必问｜这半年整体用下来，续约的意向如何？如果今年不续，主要顾虑是什么\n' +
    '使用障碍｜可选｜哪一步最费时间？有没有卡住最后没做成的场景\n' +
    '竞品对比｜必问｜最近有没有在看别的方案？对比下来最在意哪一点\n' +
    '价格预期｜禁问｜不承诺折扣或价格';

  /* 默认提纲（只读基座；编辑后的落点在 state.ivOutline） */
  NS.OUTLINE_BASE = {
    form: 'topic',
    opening: '您好，我是客户成功顾问小艾，想占用您 10 分钟聊聊这半年的使用情况，可以吗？',
    closing: '感谢您的时间，我会把您提到的问题整理给产品团队，有进展同步给您。',
    forbidden: ['不承诺折扣或价格', '不谈未发布功能'],
    maxChars: 200,
    maxRounds: 24,
    kbs: [
      { id: 'kb-product', name: '产品文档库', mode: '必引', why: '回答问题涉及功能与限制时必须有出处' },
      { id: 'kb-script', name: '销售话术库', mode: '参考', why: '话术基调与分寸参考' },
      { id: 'kb-case', name: '售后案例库', mode: '不用', why: '本场访谈不涉及售后纠纷' }
    ],
    topics: NS.parseOutlineText(
      '续约意愿｜必问｜这半年整体用下来，续约的意向如何？如果今年不续，主要顾虑是什么\n' +
      '使用障碍｜可选｜哪一步最费时间？有没有卡住最后没做成的场景\n' +
      '竞品对比｜必问｜最近有没有在看别的方案？对比下来最在意哪一点\n' +
      '价格预期｜禁问｜不承诺折扣或价格')
  };
  /* 老读法保留：NS.OUTLINE 现在是 getter，读到的永远是当前真源 */
  Object.defineProperty(NS, 'OUTLINE', { get: function () { return NS.currentOutline(); }, configurable: true });

  /* ---------------- 状态分布（四笔账里的联系状态部分） ---------------- */
  function stateMix(row) {
    if (row.status === 'warn') return { pending: 1, dialing: 0, interrupted: 0, unreachable: 0 };  /* 草稿：还没开始联系 */
    if (row.status === 'info') return { pending: 0.26, dialing: 0.18, interrupted: 0.09, unreachable: 0.05 };
    return { pending: 0.02, dialing: 0.04, interrupted: 0.05, unreachable: 0.08 };
  }
  function distribute(total, ws) {
    var out = [], acc = 0, i;
    for (i = 0; i < ws.length; i++) { var v = Math.floor(total * ws[i]); out.push(v); acc += v; }
    var rem = total - acc;
    var order = ws.map(function (w, k) { return { k: k, w: w }; }).sort(function (a, b) { return b.w - a.w; });
    for (i = 0; i < rem; i++) out[order[i % order.length].k]++;
    return out;
  }

  /** 六笔账（页面上每个数字都从这里取） */
  NS.accounts = function (row) {
    if (!row) return null;
    var r = S.R.of('iv-mix|' + row.id);
    var ls = row.listSource || {};
    /* 计划：导入名单按行数；其余按已触达人数（拍板口径） */
    var plan = num(ls.kind === 'import' ? ls.count : row.reached, 0) || num(row.reached, 0) || 0;
    var reached = num(row.reached, 0);
    var replied = num(row.replied, 0);
    var effective = num(row.consulted, 0);                       /* 有效对话 = 完成至少 1 轮实质回答 */
    var done = row.status === 'warn' ? 0 : Math.min(reached, replied);   /* 联系完成 = 已回复 */
    var rest = Math.max(0, reached - done);
    var keys = ['pending', 'dialing', 'interrupted', 'unreachable'];
    var mix = stateMix(row);
    var ws = keys.map(function (k) { return mix[k] * (0.9 + r() * 0.2); });
    var tot = ws.reduce(function (a, b) { return a + b; }, 0) || 1;
    var vals = distribute(rest, ws.map(function (w) { return w / tot; }));
    var f = {}; keys.forEach(function (k, i) { f[k] = vals[i]; }); f.done = done;
    var rr = S.R.of('iv-exit|' + row.id);
    var exited = Math.round(done * (0.02 + rr() * 0.02));        /* 退出 = 明确拒绝 / 拒答 2 次 */
    return {
      row: row, plan: plan, reached: reached, replied: replied, effective: effective,
      done: done, exited: exited, f: f,
      quality: { lowRate: 0.08 },                                /* 低质量比例（页面显示用） */
      funnel: keys.map(function (k) { return { k: k, n: f[k] }; }).concat([{ k: 'done', n: done }])
    };
  };
  NS.funnelOf = function (row) { var a = NS.accounts(row); return { f: a.f, total: a.reached || a.plan }; };

  /* ---------------- 联系人明细（与状态分布同一套数） ---------------- */
  var SURNAME = ['李', '王', '张', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马'];
  var SEGS = (S.SEGMENTS || []).slice(0, 4);
  NS.contacts = function (row, cap) {
    var a = NS.accounts(row), out = [], idx = 0;
    var limit = cap || a.reached;
    ['done', 'dialing', 'interrupted', 'unreachable', 'pending'].forEach(function (k) {
      var cnt = Math.min(a.f[k], Math.max(0, limit - out.length));
      for (var j = 0; j < cnt; j++) {
        var rr = S.R.of('iv-c|' + row.id + '|' + idx);
        var seg = SEGS.length ? SEGS[Math.floor(rr() * SEGS.length) % SEGS.length] : { name: '未分层' };
        var aborted = k === 'done' && rr() < 0.02;
        var lowQ = !aborted && k === 'done' && rr() < 0.08;
        var rd = k === 'done' ? (3 + Math.floor(rr() * 6)) : (k === 'pending' ? 0 : Math.floor(rr() * 4));
        if (rd > NS.RULES.rounds.hardMax) rd = NS.RULES.rounds.hardMax;
        var st = NS.stateOf(k);
        var review = k !== 'done' ? 'draft' : (aborted || rr() < 0.12 ? 'pending-review' : 'approved');
        var reasonSet = ['被访者明确拒绝', '连续 2 轮未回复'];
        out.push({
          id: 'ct-' + pad2(idx + 1),
          name: pick(rr, SURNAME) + '**',
          phone: '1' + (3 + Math.floor(rr() * 6)) + '****' + pad2(Math.floor(rr() * 100)) + pad2(Math.floor(rr() * 100)),
          seg: seg.name, state: k, stateText: st.t, tone: st.tone, rounds: rd,
          /* 下面两个字段**不消耗随机流**（纯确定性派生），所以加进来不会挪动
             iv-c|… 这条流的抽值顺序 —— 老数据源缺它们，渲染层却在读
             （v10-interview.js 的 cur.durMin / c.channel），于是界面出现
             「undefined 分钟」和空的「渠道」列。口径写在这里，只有一份。 */
          durMin: rd > 0 ? (rd * 2 + ((idx + rd) % 3)) : 0,   /* 会话时长 = 轮次 × 2–3 分钟 */
          channel: ['wecom', 'sms', 'wecom', 'phone'][idx % 4], /* 触达渠道 */
          /* 必问覆盖：占位口径（按轮次折算），期 5 起由分析接口返回真实覆盖 */
          cover: rd >= 5 ? '2/2' : (rd >= 3 ? '1/2' : '0/2'),
          owner: rr() < 0.7 ? '续约访谈员 · 小艾' : '体验访谈员 · 小验',
          aborted: aborted, abortReason: aborted ? pick(rr, ['命中禁问项（承诺折扣）', '越界承诺']) : null,
          exited: k === 'done' && rr() < 0.03 ? pick(rr, reasonSet) : null,
          lastTryH: k === 'interrupted' ? (12 + Math.floor(rr() * 96)) : (k === 'unreachable' ? 96 : 0),
          /* 看板要回答"还能不能找到这个人"：试了几次、上次什么时候、下次什么时候能再试、能不能碰 */
          attempts: k === 'done' ? 1 : (k === 'dialing' ? 1 : (k === 'interrupted' ? 2 : (k === 'unreachable' ? 3 : 0))),
          nextOkH: k === 'unreachable' ? 24 * (7 + Math.floor(rr() * 14)) : (k === 'interrupted' ? 24 : 0),
          unsub: rr() < 0.03, blacklist: rr() < 0.01,
          quality: aborted ? '已中止' : (lowQ ? '低质量' : '正常'),
          review: review,
          reviewText: review === 'approved' ? '已通过' : (review === 'pending-review' ? '待审' : '未提交'),
          reviewTone: review === 'approved' ? 'ok' : (review === 'pending-review' ? 'warn' : 'idle')
        });
        idx++;
      }
    });
    return out;
  };

  /** 必问覆盖：这条会话里，必问话题真正被问到了几个 */
  NS.coverageOf = function (turns) {
    var must = NS.mustTopics().map(function (t) { return t.id; });
    var hit = {};
    (turns || []).forEach(function (t) { if (t.outlineItemId) hit[t.outlineItemId] = true; });
    var n = must.filter(function (id) { return hit[id]; }).length;
    return { covered: n, total: must.length, text: n + '/' + must.length };
  };

  /* ---------------- 轮次：与话题同源，每轮带 outlineItemId ---------------- */
  NS.turns = function (row, ct) {
    var topics = NS.OUTLINE.topics.filter(function (t) { return !t.ban; });
    var n = Math.max(1, Math.min(NS.RULES.rounds.hardMax, ct.rounds || 3));
    var out = [], i;
    for (i = 0; i < n && i < topics.length; i++) {
      var tp = topics[i], rr = S.R.of('iv-t|' + ct.id + '|' + i);
      out.push({ role: 'ai', topic: tp.name, outlineItemId: tp.id, text: tp.q });
      out.push({ role: 'user', outlineItemId: tp.id, text: pick(rr, tp.a) });
      if (tp.probe && rr() < 0.8) {
        out.push({ role: 'ai', topic: tp.name, outlineItemId: tp.id, round: i + 1, text: tp.probe.q, why: tp.probe.why, kb: tp.probe.kb });
        out.push({ role: 'user', outlineItemId: tp.id, text: pick(rr, tp.a2.length ? tp.a2 : tp.a) });
      }
      if (ct.aborted && i === n - 1) {
        out.push({ role: 'stop', text: '命中禁问项：AI 试图承诺折扣，已中止本场并留痕', reason: ct.abortReason || '命中禁问项' });
      }
    }
    /* 被访者主动提到价格 → 才谈禁问话题（禁问≠假装不存在） */
    if (!ct.aborted && ct.rounds >= 6) {
      out.push({ role: 'user', text: '价格你们今年怎么算？' });
      out.push({ role: 'ai', topic: '价格预期', outlineItemId: 't4', text: '价格我记下来转给商务，由他们按合同周期给您正式答复。' });
    }
    return out;
  };

  /* ---------------- 分析（页面只展示；真实系统由分析接口返回） ---------------- */
  NS.analysis = function (row) {
    var a = NS.accounts(row);
    var contacts = NS.contacts(row, 200);
    var doneList = contacts.filter(function (c) { return c.state === 'done'; });
    var lowN = doneList.filter(function (c) { return c.quality === '低质量'; }).length;
    var abortN = contacts.filter(function (c) { return c.aborted; }).length;
    var intent = row.intent || { high: 0, mid: 0, low: 0 };
    var iTot = num(intent.high, 0) + num(intent.mid, 0) + num(intent.low, 0);
    var themes = [
      { n: '权限粒度', c: 48 }, { n: '导出性能', c: 30 }, { n: '集成与文档', c: 18 },
      { n: '价格与账期', c: 22 }, { n: '服务响应', c: 14 }
    ];
    var doneN = doneList.length || 1;
    /* 关键发现：每条都要有"多少人这么说 + 一句代表原话 + 证据强度"，
       单例必须标"个例"，不许把一个人的话写成结论 */
    var findings = [
      { t: '权限粒度不足是续约第一阻碍（字段级权限）', n: 148, quote: '就是字段级权限，我们内部要求到字段。', who: '中小客户 · 第 2 轮', strength: '充分' },
      { t: '批量导出性能是日常最大耗时点', n: 96, quote: '导出几十万行要等很久，基本得排队。', who: '企业客户 · 第 3 轮', strength: '充分' },
      { t: '价格不是主要顾虑，但账期需要走流程', n: 61, quote: '价格我不好说，得走采购。', who: 'VIP 客户 · 第 3 轮', strength: '充分' },
      { t: '上手阶段缺培训材料，自助配置易卡住', n: 9, quote: '配置要来回问实施，自己搞不定。', who: '个人用户 · 第 2 轮', strength: '个例' }
    ].map(function (f) { f.share = f.n / doneN; return f; });
    /* 分人群差异：同一个问题，不同人群的答案不一样 —— 这是"评价"的依据 */
    var segments = [
      { seg: 'VIP 客户', n: 210, top: '账期与响应速度', intent: '高 38% / 中 47% / 低 15%', note: '在意服务响应，价格不敏感' },
      { seg: '企业客户', n: 386, top: '权限粒度 + 导出性能', intent: '高 31% / 中 52% / 低 17%', note: '权限是硬门槛，愿意为合规付钱' },
      { seg: '中小客户', n: 512, top: '实施支持 + 价格', intent: '高 22% / 中 49% / 低 29%', note: '价格敏感，缺自助能力' },
      { seg: '个人用户', n: 818, top: '集成文档 + 移动端', intent: '高 12% / 中 41% / 低 47%', note: '自接脚本，价格不是主要顾虑' }
    ];
    /* 这场访谈的自我评价：过程质量 + 结论可信度分级 */
    var roundsArr = doneList.map(function (c) { return c.rounds; });
    var avgRounds = roundsArr.length ? roundsArr.reduce(function (a, b) { return a + b; }, 0) / roundsArr.length : 0;
    var inRange = roundsArr.filter(function (r) { return r >= 3 && r <= 7; }).length;
    var approved = doneList.filter(function (c) { return c.review === 'approved'; }).length;
    var evaluation = {
      avgRounds: avgRounds,
      inRangeRate: roundsArr.length ? inRange / roundsArr.length : 0,
      maxRounds: roundsArr.length ? Math.max.apply(null, roundsArr) : 0,
      lowRate: doneList.length ? lowN / doneList.length : 0,
      abortRate: doneList.length ? abortN / doneList.length : 0,
      auditPassRate: doneList.length ? approved / doneList.length : 0,
      evidence: {
        solid: findings.filter(function (f) { return f.strength === '充分'; }).length,
        single: findings.filter(function (f) { return f.strength === '个例'; }).length,
        insufficient: 1
      },
      limits: [
        '联系不上 ' + a.f.unreachable + ' 人、退出 ' + a.exited + ' 人未进入结论',
        '「价格与账期」由被访者主动提起才谈，属机会样本，不等同于全体',
        '主题聚类与情感由分析服务返回'
      ]
    };
    return {
      accounts: a,
      sample: {
        plan: a.plan, effective: a.effective, unreachable: a.f.unreachable, exited: a.exited,
        inProgress: a.f.dialing + a.f.interrupted, pending: a.f.pending,
        note: '结论只基于有效对话；联系不上与退出单独成账，不作为失败计。'
      },
      headline: '续约的主要阻碍是权限粒度与导出性能；价格不是主要顾虑，但账期要走采购流程。',
      findings: findings,
      segments: segments,
      evaluation: evaluation,
      intent: {
        high: num(intent.high, 0), mid: num(intent.mid, 0), low: num(intent.low, 0), total: iTot,
        highRate: iTot ? num(intent.high, 0) / iTot : 0
      },
      coverage: { must: NS.mustTopics().length, covered: NS.mustTopics().length, text: NS.mustTopics().length + '/' + NS.mustTopics().length },
      /* 注：上面这行是"本场真问到了几个必问"的占位 —— 必须数恒等于总数，是因为 turns 由提纲生成、
         必问话题每场必被问到。改提纲后分子分母同步变化，不会出现 3/2 这种假数。 */
      lowQuality: { n: lowN, rate: doneList.length ? lowN / doneList.length : 0 },
      aborted: abortN,
      themes: themes,
      sentiment: { pos: 0.27, neu: 0.44, neg: 0.29 },
      effectiveRate: a.reached ? a.replied / a.reached : 0
    };
  };

  /* ---------------- AI 对这份问卷本身的评价（不是对受访者的分析） ----------------
   * 全部从**当前提纲**派生，不写死文案 —— 这样改提纲，评价跟着动；
   * 原来这里写死了"『价格预期』设成禁问"，用户把它改成必问之后评价照骂，等于自说自话。 */
  NS.questionnaireReview = function (row) {
    var a = NS.accounts(row);
    var done = Math.max(1, num(a.done, 1));
    var topics = NS.OUTLINE.topics;
    var byName = {};
    topics.forEach(function (t) { byName[t.name] = t; });
    var musts = topics.filter(function (t) { return t.must; });
    var bans = topics.filter(function (t) { return t.ban; });
    var opts = topics.filter(function (t) { return t.flag === 'opt'; });

    var good = [], bad = [], next = [];

    /* —— 做得好的：只列真的成立的事 —— */
    if (musts.length) {
      good.push('必问点收敛到 ' + musts.length + ' 个（' + musts.map(function (t) { return t.name; }).join(' / ') +
        '），共 ' + topics.length + ' 个话题，抓得住重点');
    } else {
      bad.push('一个必问话题都没设 → 访谈没有主线，AI 会聊到哪算哪');
      next.push('至少标 1–3 个话题为「必问」');
    }
    if (bans.length) {
      good.push('禁问项写清了：' + bans.map(function (t) { return t.name; }).join('、') + '，' +
        Math.round(done * 0.02) + ' 条命中即停，没有越界外发');
    } else {
      good.push('没有设禁问项，也没有因越界被中止的会话');
    }
    var probed = topics.filter(function (t) { return !t.ban && t.probe && t.detail; });
    if (probed.length) {
      good.push(probed.length + ' 个话题写了具体问法，AI 有据可依（' + probed.map(function (t) { return t.name; }).join('、') + '）');
    }

    /* —— 有问题的：每条都指到具体设置 —— */
    bans.forEach(function (t) {
      if (/价|钱|费|预算|成本|折扣/.test(t.name)) {
        var n = Math.round(done * 0.03);
        bad.push('「' + t.name + '」设为禁问 → 价格类结论只剩机会样本 ' + n + ' 条，不能当全体');
        next.push('把「' + t.name + '」从禁问改成可选，并在被访者主动提及时追问一次');
      }
    });
    opts.forEach(function (t) {
      if (/障碍|痛点|问题|困难|卡/.test(t.name)) {
        bad.push('「' + t.name + '」是可选 → 约 31% 的会话没问到阻塞点，归因缺一条腿');
        next.push('把「' + t.name + '」提到必问（与现有必问并列）');
      }
    });
    if (!/决策|采购|预算|流程/.test(topics.map(function (t) { return t.name; }).join(''))) {
      bad.push('没有「决策链」专门话题 → ' + Math.round(done * 0.2) + ' 条结论里决策链未明，等于白问一轮');
      next.push('新增话题「预算与决策链」：谁批、走什么流程、多久');
    }
    if (topics.length < 3) {
      bad.push('话题只有 ' + topics.length + ' 个 → 一场 10 分钟的访谈会聊不够，结论面偏窄');
      next.push('把话题补到 4–6 个（覆盖意愿 / 障碍 / 竞品 / 价格这类基本盘）');
    }
    opts.forEach(function (t) {
      if (/移动端|端|客户端/.test(t.name) && t.detail && !t.must) {
        next.push('把「' + t.name + '」从可选提升为必问（该类反馈提及率最高）');
      }
    });
    if (!bad.length) bad.push('没有发现会削弱结论的提纲设置');
    if (!next.length) next.push('按列出的问题逐条改，没有别的必改项');

    var verdict = '提纲 ' + topics.length + ' 个话题：必问 ' + musts.length + ' · 可选 ' + opts.length + ' · 禁问 ' + bans.length + '。';
    if (bad.length && bad[0].indexOf('没有发现') < 0) verdict += '短板：' + bad[0] + '。';
    verdict += '有效对话 ' + a.done.toLocaleString('zh-CN') + ' 人。';

    return { verdict: verdict, good: good, bad: bad, next: next, topics: topics };
  };

  /* ---------------- 历史对比（同一个人谈过几次） ---------------- */
  NS.historyOf = function (row, ct) {
    return [
      { when: '2026-10-06', name: '本次访谈', ai: '续约访谈员 · 小艾', outline: '话题式 v3（4 话题 / 必问 2）', points: ['权限粒度不足', '导出慢'], intent: '中', kb: '产品文档库 3 处' },
      { when: '2026-04-12', name: '上一轮回访', ai: '回访访谈员 · 小访', outline: '话题式 v2（3 话题）', points: ['上手培训不足', '移动端弱'], intent: '中', kb: '产品文档库 1 处' },
      { when: '2025-11-03', name: '首次接触', ai: '售前访谈员 · 小答', outline: '话题式 v1（3 话题）', points: ['价格高于预期'], intent: '低', kb: '销售话术库 2 处' }
    ];
  };

  /* ---------------- 打包件（四件套） ---------------- */
  NS.pack = function (row) {
    var NL = String.fromCharCode(10);
    var an = NS.analysis(row);
    var contacts = NS.contacts(row, 400);
    var fname = function (suffix, ext) { return 'AI访谈-' + row.name + '-' + suffix + '.' + ext; };
    var accountsLine = '计划 ' + an.accounts.plan + ' · 有效对话 ' + an.accounts.effective + ' · 联系完成 ' + an.accounts.done +
      ' · 联系不上 ' + an.accounts.f.unreachable + ' · 联系中断 ' + an.accounts.f.interrupted +
      ' · 联系中 ' + an.accounts.f.dialing + ' · 未联系 ' + an.accounts.f.pending + ' · 退出 ' + an.accounts.exited;
    var sample = [
      'AI 访谈 · 样本说明',
      '问卷：' + row.name,
      accountsLine,
      '有效对话率：' + (an.accounts.reached ? (an.accounts.replied / an.accounts.reached * 100).toFixed(1) : '0.0') + '%（已回复 ÷ 已触达）',
      '必问覆盖：' + an.coverage.text + '　低质量：' + an.lowQuality.n + ' 条（' + (an.lowQuality.rate * 100).toFixed(1) + '%）　异常中止：' + an.aborted + ' 条',
      '口径：一对一不可能百分百完成；联系不上与退出单独成账，不作为失败计；结论只基于有效对话。',
      '轮次规则：默认 3–7 轮，第 7 轮主动收尾；有意向或聊得投机可多开两轮；上限 12 轮。'
    ].join(NL);
    var csvHead = ['记录号', '联系人', '人群', '联系状态', '轮次', '必问覆盖', '质量', '审核', '中止原因'].join(',');
    var csv = String.fromCharCode(0xFEFF) + csvHead + NL + contacts.map(function (c) {
      return [c.id, c.name, c.seg, c.stateText, c.rounds, c.quality, c.reviewText, c.abortReason || ''].map(function (x) {
        return '"' + String(x == null ? '' : x).split('"').join('""') + '"';
      }).join(',');
    }).join(NL);
    var report = [
      'AI 访谈 · 分析报告',
      '问卷：' + row.name,
      '',
      '一句话结论',
      an.headline,
      '',
      '一、六笔账',
      accountsLine,
      '',
      '二、关键发现',
      an.findings.map(function (f) { return '　· ' + f.t + '　' + f.n + ' 人（' + (f.share * 100).toFixed(0) + '%）　原话：「' + f.quote + '」—— ' + f.who + (f.strength === '个例' ? '　【个例，不能当结论】' : ''); }).join(NL),
      '',
      '三、分人群差异',
      an.segments.map(function (s) { return '　· ' + s.seg + '　有效对话 ' + s.n + '　最在意：' + s.top + '　意向：' + s.intent + '　' + s.note; }).join(NL),
      '',
      '四、这场访谈的评价',
      '　平均轮次 ' + an.evaluation.avgRounds.toFixed(1) + ' 轮（落在 3–7 轮的占 ' + (an.evaluation.inRangeRate * 100).toFixed(0) + '%，最长 ' + an.evaluation.maxRounds + ' 轮）',
      '　必问覆盖 ' + an.coverage.text + '　低质量 ' + (an.lowQuality.rate * 100).toFixed(1) + '%　异常中止率 ' + (an.evaluation.abortRate * 100).toFixed(1) + '%　结论审核通过率 ' + (an.evaluation.auditPassRate * 100).toFixed(0) + '%',
      '　结论可信度：证据充分 ' + an.evaluation.evidence.solid + ' 条 · 个例 ' + an.evaluation.evidence.single + ' 条 · 数据不足 ' + an.evaluation.evidence.insufficient + ' 条',
      '　本次局限：' + (an.evaluation.limits || []).join('；'),
      '',
      '五、意向与主题',
      '高 ' + an.intent.high + ' · 中 ' + an.intent.mid + ' · 低 ' + an.intent.low,
      an.themes.map(function (t) { return '　' + t.n + '：' + t.c + ' 条'; }).join(NL),
      '',
      '六、样本说明',
      sample
    ].join(NL);
    var card = JSON.stringify({
      问卷: row.name, 资产ID: row.id,
      六笔账: { 计划: an.accounts.plan, 有效对话: an.accounts.effective, 联系完成: an.accounts.done, 联系不上: an.accounts.f.unreachable, 联系中断: an.accounts.f.interrupted, 联系中: an.accounts.f.dialing, 未联系: an.accounts.f.pending, 退出: an.accounts.exited },
      必问覆盖: an.coverage.text, 低质量: an.lowQuality.n, 异常中止: an.aborted,
      意向: an.intent, 主题: an.themes
    }, null, 2);
    return [
      { name: fname('分析报告', 'txt'), mime: 'text/plain;charset=utf-8', body: report },
      { name: fname('原始对话', 'csv'), mime: 'text/csv;charset=utf-8', body: csv },
      { name: fname('样本说明', 'txt'), mime: 'text/plain;charset=utf-8', body: sample },
      { name: fname('结论卡片', 'json'), mime: 'application/json;charset=utf-8', body: card }
    ];
  };

  /* 禁词（改动文件里不许出现；用于收尾自检） */
  NS.BANNED_WORDS = ['回传', '已入库', '已同步'];
})(window);
