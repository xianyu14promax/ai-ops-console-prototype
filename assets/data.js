/* SECTION: nav-registry
 * 导航与页面注册表。
 *
 * 注意：本文件只描述"有哪些页面、什么类型、需要什么参数"，
 * 不含任何写死的指标数字 —— 所有数值一律由 FACTS/QUERY 在渲染时聚合得出。
 * 这是与上一版的本质区别：上一版 data.js 里的 1,286 / 87.5% 都是凭空写的，
 * 无法下钻、无法对账；现在每个数字都能追溯到具体 trace。
 */
(function (global) {
  'use strict';

  /* 2026-10-20 走查修复：沙盒的到期时间原来写死 '10-16 04:00'，而同一行的 expiresInDays 写 12，
     两处互相矛盾；更严重的是硬编码日期会随"今天"推移变成「已过期 4 天，状态还是运行中」。
     统一由 expiresInDays 推出：到期 = 今天 + N 天（MM-DD HH:00）。 */
  function mmddPlus(days, hh) {
    var d = new Date(Date.now() + days * 86400000);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(hh) + ':00';
  }

  /* v27：域划分回到三域（洞察 / 引擎 / 平台；侧栏顺序 2026-10-24 改为 平台 / 引擎 / 洞察）
   *   —— 与 v23 基线、以及本文件 CAPS 里的分段注释一致。
   * v10b 曾按"业务任务"把域拆成四域（洞察/运营/引擎/治理），但：
   *   ① CAPS 的分段注释一直写着旧三域归位（洞察域=画像/知识库/经验库 …），代码与注释自相矛盾；
   *   ② app.js 的初始 state 写的是 domain:'platform'，renderers2 里 7 处导航也硬编码 domain:'platform'
   *      —— 都是三域时代留下的，四域下靠 navigate() 纠正才没出错；
   *   ③ 深链 #/platform/agent-wb 这类老链接要能对得上。
   * 归位（共 17 项能力对象）：洞察 3 / 引擎 6 / 平台 8。
   *   侧栏上看到的比这少 —— gateway / sandbox / approval 三项标了 menu:false（内容已并进别的页），
   *   所以平台域侧栏只列 5 项。别拿侧栏条数去改这里的计数，两套数说的不是同一件事。
   *   （2026-10-24：决策会议室从平台域移入引擎域 —— 它跑的都是业务线的事，放在引擎里
   *     与「用户模拟 / 访谈 / 运营 / 营销 / 合规」同域才是一件事走到黑；平台域只留底座与治理。）
   *   洞察 = 理解用户与内容的资产（画像库/知识库/LLM 经验库）
   *   引擎 = 业务场景执行（模拟用户/AI 访谈/用户运营/网红营销/合规检查）
   *   平台 = 底座与治理（Agent 工作台/网关/可观测/审批/账号/自进化/沙盒/成本）
   *   （2026-10-20：Workflow 一页整条下线 —— 能力对象、数据表、详情页与全部入口一并删除）
   * hash 的域段只做显示，路由按 cap 全局解析（#/growth/kol → 引擎），旧链接不会断。 */
  /* 2026-10-24（业主）：平台与洞察换位 —— rail 自上而下改为 平台 / 引擎 / 洞察。
     理由：平台是每天要开的底座（Agent、能力、成本），先于"看数据"；洞察是查资料时才进的地方，沉到最后。
     ⚠ 顺序即 DOMAINS 数组顺序，renderRail() 直接按它 map，别在别处再写死一套。 */
  var DOMAINS = [
    /* 2026-10-24（业主）：「平台和洞察图标一起互换」—— 图标不跟位置绑定，跟着域走：
       平台（Agent 工作台 / 网关 / 能力 / 成本）用 bot；洞察（画像 / 知识 / 经验这些"原料"）用 server 机架。
       两条来历留在注释里，免得下次有人照旧版本改回去：
         · bot 原属洞察、server 原属平台（v27 起的分配），本次对调；
         · 两者都不能用 grid —— rail 上「总览」已经是四宫格 grid，两个一模一样并排分不清（走查 2.5 记过）。 */
    { id: 'platform', name: '平台', icon: 'bot' },
    { id: 'engine',   name: '引擎', icon: 'chart' },
    { id: 'insight',  name: '洞察', icon: 'server' }
  ];

  /**
   * pageType 决定渲染器：
   *  overview      总览（待办 + 健康指标 + 告警 + 运行中任务）
   *  agentList     Agent 卡片墙/表格
   *  agentDetail   Agent 详情（7 个 Tab：监控/编排/调试与日志/版本/质量/成本/经验）
   *  traceList     trace 检索
   *  traceDetail   单条 trace 火焰图
   *  costPage      成本归因
   *  gatewayPage   网关服务健康
   *  tablePage     通用资产库（知识库/经验库/画像库…）
   *  queuePage     审核处置队列（合规/审批/badcase）
   *  pipelinePage  流水线工作区（用户运营/自进化）
   */
  var CAPS = [
    /* ===== 总览：跨域入口，不属于三个业务域 ===== */
    { id: 'overview', domain: 'overview', name: '工作台总览', icon: 'grid', pageType: 'overview',
      desc: '系统与 Agent 的实时状态：组件健康、依赖服务水位、每个 Agent 此刻在做什么' },

    /* ===== 洞察域 ===== */
    { id: 'persona', domain: 'insight', name: '企业用户画像库', icon: 'house', pageType: 'personaPage',
      detailType: 'personaDetail',
      table: 'persona', desc: '汇聚企业客户的组织、角色与偏好标签，为运营与 Agent 提供统一画像视图',
      action: '新建画像' },
    { id: 'knowledge', domain: 'insight', name: '企业知识库', icon: 'chat', pageType: 'kbPage',
      detailType: 'kbDetail',
      table: 'kb', desc: '统一管理产品、政策、话术与案例文档，向各 Agent 提供检索增强能力',
      action: '新建知识库' },
    { id: 'llm-exp', domain: 'insight', name: 'LLM 经验库', icon: 'person', pageType: 'queuePage',
      detailType: 'expDetail',
      queue: 'experience', desc: '沉淀被验证有效的处置经验，供模型检索复用并持续迭代',
      action: '登记经验' },

    /* ===== 引擎域 ===== */
    { id: 'sim-user', domain: 'engine', name: '用户模拟', icon: 'house', pageType: 'simUserPage',
      table: 'persona_sim', desc: '用高保真虚拟 persona 预演触达与转化路径，降低真实投放试错成本',
      action: '新建 persona' },
    /* 能力 id 与路由已改名为 interview（旧的 #/engine/survey 由 app.js 的兼容层重写过来）；
       数据表键仍叫 T.survey —— 历史名，别按字面理解，改它要连带动生成内容。 */
    { id: 'interview', domain: 'engine', name: 'AI 访谈作业台', icon: 'chat', pageType: 'interviewHome',
      detailType: 'interviewDetail',
      table: 'survey', desc: '挑人 → 交待清楚（问什么、禁问什么、引哪本知识库）→ 派 AI 做 1 对 1 多轮访谈 → 谈完审核归档',
      action: '创建问卷' },
    /* v50 建页，2026-10-24 业主：「将决策会议室搬到引擎」——
       原来挂在平台域，理由是"它不属于任何一条业务线"；但那恰恰说明它是业务的收口：模拟、访谈、运营、投放在
       各自的线里跑出结论，最后都在这里对质、取舍。放进平台域反而像基础设施，没人会去那儿开会。
       2026-10-25（业主）：「将决策放到第三个」—— 从引擎域末尾挪到第三位，紧跟「用户模拟 / AI 访谈」：
       先用模拟和访谈把人和话搞清，再开会定夺；运营 / 营销 / 合规 是定夺之后的具体执行。
       与总览的区别仍然成立：总览回答「现在发生了什么」，这页回答「该不该做、代价多大」。
       icon 从 signal 换成 seal：同域里合规检查已经是 signal，并排两个一样的图标分不清。 */
    { id: 'decision', domain: 'engine', name: '决策会议室', icon: 'seal', pageType: 'decisionPage',
      desc: '十八席常驻（循《六韬·王翼》分六部，左文右武），重大议题在此分列对质、合议收敛；不归 Agent 工作台管', action: null },
    { id: 'user-ops', domain: 'engine', name: '用户运营', icon: 'person', pageType: 'pipelinePage',
      pipeline: 'userops', desc: '从圈人到策略生成、触达执行与效果回收的运营闭环',
      action: '新建策略' },
    { id: 'kol', domain: 'engine', name: '网红营销', icon: 'play', pageType: 'kolPage',
      desc: '按历史合作数据评价达人，判断谁值得进投放组合',
      action: '规划新投放' },
    { id: 'compliance', domain: 'engine', name: '合规检查', icon: 'signal', pageType: 'queuePage',
      detailType: 'complianceDetail',
      queue: 'compliance', desc: '对生成内容与外发动作进行规则拦截、抽样复核与出境校验',
      action: '新建规则包' },

    /* ===== 平台域 ===== */
    { id: 'agent-wb', domain: 'platform', name: 'Agent 工作台', icon: 'house', pageType: 'agentList',
      desc: 'Agent 的创建、编排、发布与运行监控一体化工作台', action: '创建 Agent' },
    /* menu:false = 不再列进侧栏：内容已并入「能力与权限」页的二级分页（gatewayMcp / gatewayLlm / gatewaySkills）。
     保留这个能力对象是为了详情路由（gatewayDetail）与既有断言继续成立。 */
  { id: 'gateway', menu: false, domain: 'platform', name: 'MCP / LLM 网关', icon: 'chat', pageType: 'gatewayPage',
      detailType: 'gatewayDetail',
      desc: '统一接入 MCP 服务与模型路由，提供限流、熔断与密钥管理', action: '新增路由' },
    /* v33（2026-10-15）：业主清单第 ⑤ 项 —— MCP / 技能 / 沙盒等做成卡片放在一页。
     单起一页而不是塞进网关页：网关回答「服务此刻健不健康」，这一页回答「我有哪些能力可挂给 Agent」。 */
  /* v33b（2026-10-15，业主：「mcp、技能、沙盒等可以放在一页管理」「像 mcp 和沙盒本身就是权限的一部分」）：
     这一页把 MCP 网关 / 模型路由 / 技能 / 知识库 / 沙盒 / 它们的权限**合成一处管理**（页内两级分页）。
     原来各占一个侧栏项的 gateway 与 sandbox 就此退出侧栏（cap 上标 menu:false，仍保留能力对象本身，
     所以详情路由 #/platform/sandbox/{id} 与既有门禁断言都不受影响），入口统一到本页对应分页。 */
  { id: 'assets', domain: 'platform', name: '能力与权限', icon: 'shield', pageType: 'assetsPage',
    desc: 'MCP 网关 / 模型路由 / 技能 / 知识库 / 沙盒与它们的权限：一处管理，页内两级分页' },
  { id: 'obs', domain: 'platform', name: '可观测与评估', icon: 'person', pageType: 'traceList',
      desc: '全链路 trace、在线评测与 badcase 管理，量化每一次生成质量', action: '发起评估' },
    /* 2026-10-21 单人系统：审批下线（没有第二个人可以批）。
       menu:false 让它退出侧栏；能力对象保留，是为了历史审批单的深链还能落地（页内改为只读存档）。 */
    { id: 'approval', menu: false, domain: 'platform', name: '审批存档', icon: 'play', pageType: 'queuePage',
      detailType: 'approvalDetail',
      queue: 'approval', desc: '面向发布、开通与变更的分级审批流（单人系统已下线，仅保留历史存档）', action: null },
    /* 2026-10-21 业主：「这一页直接删了吧」—— 账号与 Agent 权限整页下线。
       单账号系统里它想说的两件事都已各有归处：我是谁在顶栏账号菜单里，
       每个 Agent 能碰什么在 Agent 详情 › 管理 › 联系里。留一页只做转场没有意义。 */
    { id: 'evo', domain: 'platform', name: '自进化控制台', icon: 'signal', pageType: 'pipelinePage',
      pipeline: 'evolution', desc: '本轮改动的对象与幅度：工具调用、流程编排、经验记忆、提示词与知识；每处附依据、验证与回滚方式',
      action: '发起进化任务' },
    /* menu:false：内容已并入「能力与权限」页（沙盒 › 卡片总览 / 实例与执行明细）。 */
  { id: 'sandbox', menu: false, domain: 'platform', name: '沙盒隔离', icon: 'doc', pageType: 'sandboxPage',
      detailType: 'sandboxDetail',
      table: 'sandbox', desc: '为代码执行、浏览器与实验任务提供资源隔离的运行环境', action: '创建沙盒' },
    { id: 'cost', domain: 'platform', name: '成本与调用归因', icon: 'doc', pageType: 'costPage',
      desc: '按业务线、Agent 与任务维度归因 token 消耗与费用', action: '导出报表' }
  ];

  /* SECTION: asset-tables
   * 非 trace 类资产表（知识库、沙盒、问卷等）。
   * 这些是维度型数据：字段固定、行数量有限、可增删改。
   * 与 trace 类事实数据的区别在于 —— 它们是"配置态"，不是"运行态"。
   */
  var S = global.DATA_SEED;

/* ============================================================ 企业主数据（模拟）
 * 「企业用户画像库」此前只有 `覆盖企业 96` 这样一个**数字**，点不进去 ——
 * 因为源数据里没有企业表，注释也写着"不在行上写事实字段（源数据不支持）"。
 * 现在把这一层建起来：企业按**真数据**处理 ——
 *   · 稳定 id（f-001…）+ USCC 去重键
 *   · 行业归属唯一（一家企业只属一个行业）→ 各画像覆盖数相加就是去重后的合计
 *   · 每个画像的命中集合数量**等于该画像现有的 ents**（96/154/61/43/312）
 *     ⇒ 不破坏现有对账：画像覆盖数不变、去重合计 = 666
 *   · 用 R.of() 确定性生成，同一 key 每次一致，可刷新、可复现
 * 换成真主数据时删掉这一段、把 firmsOf 接到真实查询即可，UI 不用动。
 */
var FIRM_INDUSTRIES = ['制造', '零售', '金融', '政务', '电商'];
var FIRM_PREFIX = {
  '制造': ['恒远', '中工', '力合', '长风', '汉邦', '振华', '通宇', '精工'],
  '零售': ['惠购', '悦邻', '万佳', '联华', '好又多', '优鲜', '佳选', '客都'],
  '金融': ['汇金', '中泰', '弘信', '瑞和', '安泰', '鼎盛', '富通', '华信'],
  '政务': ['政务', '公共', '市民', '城市', '数字', '政通'],
  '电商': ['拓维', '云集', '微链', '品致', '星选', '直通', '全渠', '易购']
};
var FIRM_SUFFIX = {
  '制造': ['重工', '智能装备', '精密机械', '材料科技', '工业集团'],
  '零售': ['商业', '连锁超市', '百货集团', '商贸', '便利'],
  '金融': ['银行', '证券', '保险', '资产管理', 'fintech'],
  '政务': ['服务中心', '大数据局', '信息中心', '服务平台'],
  '电商': ['电子商务', '数字科技', '网络科技', '供应链']
};
var FIRM_REGION = ['北京', '上海', '深圳', '杭州', '广州', '成都', '武汉', '南京', '苏州', '西安'];
var FIRM_SCALE = ['大型', '中型', '小型'];
/* 企业与标签的**身份图标**（走查反馈：这一屏从头到尾只有文字，行业/标签/规模扫一屏分不清谁是谁）。
   值 = app.js PATHS 里的图标名（行业另带一个色相），**不用 emoji** ——
   走查明确要求全站不用 emoji：字形跨平台不一致、无法跟着主题换色、也没法统一线宽。
   规模**不配三个图形**：它是标量不是分类，用「1/2/3 格信号条」表达（见 FIRM_SCALE_LEVEL）。
   ⚠ 新增行业或标签必须在这里补一条，否则会落到兜底图标（building / label）——
   兜底能保证不空，但兜底多了本身就是缺口，走查时应该能被一眼看出来。 */
var FIRM_INDUSTRY_ICON = {
  '制造': { icon: 'factory', tone: 'blue' },
  '零售': { icon: 'store', tone: 'purple' },
  '金融': { icon: 'bank', tone: 'indigo' },
  '政务': { icon: 'seal', tone: 'cyan' },
  '电商': { icon: 'cart', tone: 'teal' },
  '其他': { icon: 'building', tone: 'idle' }
};
var FIRM_TAG_ICON = {
  '采购委员会': 'people', '预算周期': 'calendar', '招标偏好': 'doc', '私有化部署': 'server',
  '促销敏感': 'tag', '巡店频次': 'pin', '门店规模': 'chart',
  '合规优先': 'shield', 'POC 驱动': 'flask', '多方比价': 'scales',
  '政策口径': 'policy', '审批路径': 'checklist', '汇报节奏': 'clock',
  '价格敏感': 'currency', '自助服务': 'gear', '移动端为主': 'phone'
};
var FIRM_TAG_ICON_FALLBACK = 'label';
var FIRM_SCALE_LEVEL = { '大型': 3, '中型': 2, '小型': 1 };
function firmIndustryMeta(k) { return FIRM_INDUSTRY_ICON[k] || FIRM_INDUSTRY_ICON['其他']; }
function firmIndustryIcon(k) { return firmIndustryMeta(k).icon; }
function firmIndustryTone(k) { return firmIndustryMeta(k).tone; }
function firmTagIcon(k) { return FIRM_TAG_ICON[k] || FIRM_TAG_ICON_FALLBACK; }
function firmScaleLevel(k) { return FIRM_SCALE_LEVEL[k] || 0; }
function buildFirms(personas) {
  personas = personas || [];
  var r = S.R.of('firms|pool|v1');
  var byInd = {}, n = 0;
  personas.forEach(function (p) {
    var k = p.industry || '其他';
    if (!byInd[k]) byInd[k] = 0;
    byInd[k] += (p.ents || 0);
    n += (p.ents || 0);
  });
  /* ⚠ 名字必须**构造上唯一**，不能靠 while 重试去撞：
     每行业前缀×后缀只有 30–40 种组合，而单行业最多要造 312 家 ——
     靠重试会**死循环**（实测直接把页面挂死，window 上所有全局都变 undefined）。
     所以用「字号 + 后缀 + 三位序号」构造，天然不重。 */
  var used = {}, list = [], i = 0;
  var wantByInd = {};
  FIRM_INDUSTRIES.forEach(function (k) { wantByInd[k] = byInd[k] || 0; });
  while (list.length < n) {
    if (FIRM_INDUSTRIES.every(function (k) { return (wantByInd[k] || 0) <= 0; })) break;
    i++;
    var industry = FIRM_INDUSTRIES[(i - 1) % FIRM_INDUSTRIES.length];
    if ((wantByInd[industry] || 0) <= 0) continue;
    var pre = FIRM_PREFIX[industry] || ['联合'], suf = FIRM_SUFFIX[industry] || ['集团'];
    var seq = String(list.length + 1); while (seq.length < 3) seq = '0' + seq;
    var name = S.R.pick(r, pre) + S.R.pick(r, suf) + seq;
    if (used[name]) continue;
    used[name] = 1;
    wantByInd[industry]--;
    list.push({
      id: 'f-' + seq,
      name: name,
      /* USCC 去重键：18 位统一社会信用代码形态（91 + 行政区划 + 组织代码 + 校验位） */
      uscc: '91' + String(110000 + (list.length * 137) % 899999) + String(100000000 + (list.length * 7919) % 899999999) + String(list.length % 10),
      industry: industry,
      region: S.R.pick(r, FIRM_REGION),
      scale: S.R.pick(r, FIRM_SCALE),
      foundedYear: 1998 + Math.floor(r() * 24),
      annualPurchase: 300 + Math.floor(r() * 12000),      /* 万元 */
      employees: 50 + Math.floor(r() * 4000),
      contactRole: S.R.pick(r, ['采购经理', 'IT 总监', '财务负责人', '运营总监', '技术负责人']),
      score: 40 + Math.floor(r() * 59)                      /* 意向分 40–98 */
    });
  }
  var out = {}, order = [];
  FIRM_INDUSTRIES.forEach(function (k) {
    var rows = list.filter(function (x) { return x.industry === k; });
    var want = byInd[k] || 0;
    if (rows.length < want) {
      console.warn('[firms] 行业 ' + k + ' 企业不足：' + rows.length + ' < ' + want);
    }
    order = order.concat(rows.slice(0, want));
  });
  order.forEach(function (f) {
    out[f.id] = Object.assign({}, f, { tags: [] });
  });
  /* 按画像的「行业 + 标签」分配命中集合，数量正好等于该画像的 ents ——
     同一行业内的多个画像不重叠（依次取未被占用的席位），
     所以各画像覆盖数相加 = 去重后的合计，现有 KPI 全部对得上。 */
  var slotsOf = {};
  personas.forEach(function (p) {
    var rows = order.filter(function (x) { return x.industry === (p.industry || ''); });
    var usedIds = Object.keys(slotsOf).reduce(function (acc, k) {
      slotsOf[k].forEach(function (id) { acc[id] = 1; }); return acc; }, {});
    var slots = rows.filter(function (x) { return !usedIds[x.id]; }).slice(0, p.ents || 0);
    slotsOf[p.id] = slots.map(function (x) { return x.id; });
    slots.forEach(function (x) {
      var f = out[x.id];
      /* 每个命中企业从该画像的标签里取 1–2 个，作为「它命中了哪些标签」的事实来源 */
      var ts = (p.tags || []).slice();
      var take = ts.length > 1 ? (1 + Math.floor(r() * 2)) : ts.length;
      for (var j = 0; j < take && ts.length; j++) {
        var idx = Math.floor(r() * ts.length);
        var t = ts.splice(idx, 1)[0];
        if (f.tags.indexOf(t) < 0) f.tags.push(t);
      }
      f.personas = (f.personas || []).concat([p.id]);
    });
  });
  return out;
}
/* ============================================================ Agent↔Agent 通信边（模拟）
 * 此前系统只有 MCP（Agent↔工具）那一层，「下游引用」里的"子 Agent"是**硬凑的**：
 *   S.AGENTS.filter(x => x.id !== a.id && x.biz === a.biz && x.id.indexOf('qa') < 0).slice(0, 1)
 *   —— 同业务线里随便挑一个，且默认了**上下级**。
 * 按 A2A v1.0.0（Agent2Agent，Linux Foundation，2026-03 达 v1.0.0）的四个原语建模：
 *   Agent Card（身份/技能/能力）· Task（**持久单元 + 状态机**）· Message（对话轮次）· Artifact（产物）
 * 要点：
 *   · **对等**，不是上下级 —— 边有方向，但两侧读同一份边、互相看得见
 *   · **跨业务线为主**（客服↔知识、标书↔合规）—— 同业务线反而不是典型场景
 *   · 边是真实的 A2A 委派：带技能、传什么/回什么、Task 态、流式与推送能力
 * 换成真实 A2A 网络时，只要把 a2aEdges() 接到实际调用日志即可，UI 不用改。
 */
var A2A_TASK_STATES = ['submitted', 'working', 'input-required', 'completed', 'canceled', 'failed'];
var A2A_EDGES_BASE = [
  {
    from: 'ag-cs-refund', to: 'ag-kb-qa', skill: '政策条款检索', dir: 'call', origin: 'local',
    task: 'completed', inMode: 'text/plain', outMode: 'application/json',
    streaming: true, push: false, calls: 4820, fail: 0.004, p99: 1240,
    send: '用户原话 + 已识别意图（退货/换货）+ 会话上下文 id',
    back: '命中条款（含文档名与切片号）+ 置信度 + 兜底话术',
    why: '退款政策版本多，客服 Agent 不内置条款，一律向知识 Agent 索取带出处的答案。'
  },
  {
    from: 'ag-cs-refund', to: 'ag-legal-comp', skill: '对外话术合规预检', dir: 'call', origin: 'remote',
    task: 'completed', inMode: 'text/plain', outMode: 'application/json',
    streaming: false, push: true, calls: 3910, fail: 0.011, p99: 880,
    send: '即将发送给用户的回复全文',
    back: '是否放行 + 命中规则 id + 建议改写',
    why: '回复含承诺性表述时必须先过合规，被拦的走人工复核队列。'
  },
  {
    from: 'ag-cs-pre', to: 'ag-sales-bid', skill: '方案素材生成', dir: 'call', origin: 'remote',
    task: 'working', inMode: 'text/plain', outMode: 'text/markdown',
    streaming: true, push: false, calls: 640, fail: 0.021, p99: 8400,
    send: '客户行业 + 规模 + 需求要点',
    back: '章节骨架 + 可引用案例（artifactId 回传）',
    why: '售前不带方案库，方案素材统一由标书 Agent 产出，避免两份模板不一致。'
  },
  {
    from: 'ag-legal-ctr', to: 'ag-legal-comp', skill: '风险条款标注', dir: 'call', origin: 'local',
    task: 'completed', inMode: 'application/pdf+text', outMode: 'application/json',
    streaming: false, push: true, calls: 1180, fail: 0.007, p99: 2600,
    send: '合同文本切片 + 条款编号',
    back: '风险条款清单 + 风险等级 + 对应法规条目',
    why: '合规 Agent 维护法规库，合同 Agent 只做抽取，判定权归合规。'
  },
  {
    from: 'ag-sales-bid', to: 'ag-legal-comp', skill: '标书合规预检', dir: 'call', origin: 'local',
    task: 'completed', inMode: 'text/markdown', outMode: 'application/json',
    streaming: false, push: false, calls: 512, fail: 0.016, p99: 1500,
    send: '标书章节文本',
    back: '违规段落 + 命中规则 + 替换建议',
    why: '投标文件一旦出现绝对化用语会被废标，必须在提交前拦。'
  },
  {
    from: 'ag-kb-sum', to: 'ag-kb-qa', skill: '长文切片与索引', dir: 'call', origin: 'local',
    task: 'completed', inMode: 'application/pdf', outMode: 'application/json',
    streaming: false, push: false, calls: 2260, fail: 0.003, p99: 5400,
    send: '原始文档（PDF 二进制）+ 目标知识库 id',
    back: '切片数 + 索引状态 + 向量条数',
    why: '摘要 Agent 负责解析长文，解析完把切片交给知识 Agent 入库。'
  },
  {
    from: 'ag-ops-seg', to: 'ag-sales-lead', skill: '线索价值评分', dir: 'call', origin: 'remote',
    task: 'input-required', inMode: 'application/json', outMode: 'application/json',
    streaming: false, push: true, calls: 1180, fail: 0.042, p99: 3200,
    send: '候选企业列表（USCC + 行业 + 行为特征）',
    back: '评分 + 分档（高/中/低）+ 缺失字段清单',
    why: '圈选只解决"谁符合条件"，值不值得打要问评分 Agent —— 它拿不到年采购额时会回问。'
  },
  {
    from: 'ag-new-onb', to: 'ag-kb-qa', skill: '新人常见问题检索', dir: 'call', origin: 'local',
    task: 'completed', inMode: 'text/plain', outMode: 'text/plain',
    streaming: true, push: false, calls: 3040, fail: 0.006, p99: 900,
    send: '新人提问原话',
    back: '答案 + 出处链接',
    why: '新人问题覆盖全公司制度，不内置在引导 Agent 里，一律走知识检索。'
  }
];
var A2A_EDGES = null;
function a2aEdges() {
  if (A2A_EDGES) return A2A_EDGES;
  var r = S.R.of('a2a|edges|v1');
  A2A_EDGES = A2A_EDGES_BASE.map(function (e, i) {
    return Object.assign({}, e, {
      id: 'a2a-' + (i + 1),
      /* 每边给一个稳定任务号，便于从通信下钻到单次委派 */
      taskId: 'task-' + String(1000 + i * 17),
      lastCallMin: Math.round(2 + r() * 900),
      /* 被委派方的 Agent Card 版本与技能 id —— A2A 靠卡片发现能力 */
      cardVersion: (1 + (i % 3)) + '.' + (i % 5) + '.0',
      /* A2A 的信任分级：跨节点委派的身份只是**声称级** —— 必须让用户看见，不能埋在日志里 */
      trust: (e.origin === 'remote') ? 'claimed' : 'verified',
      originText: (e.origin === 'remote') ? '跨节点委派 · 远端智能体' : '本机受理 · 同节点执行体',
      skillId: e.skill.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '-').toLowerCase()
    });
  });
  return A2A_EDGES;
}
/* 某个 Agent 的对等通信边：我调用的 / 调用我的 —— 同一份边，两侧对称可读 */
function a2aOf(agentId) {
  var es = a2aEdges();
  return {
    out: es.filter(function (e) { return e.from === agentId; }),
    in: es.filter(function (e) { return e.to === agentId; }),
    all: es.filter(function (e) { return e.from === agentId || e.to === agentId; })
  };
}
function a2aEdgeById(id) {
  return a2aEdges().filter(function (e) { return e.id === id; })[0] || null;
}
var FIRMS = null;
var FIRM_PERSONAS = null;/* 画像行由 buildAssetTables 里 T.persona.rows 提供（模块加载时还没有），所以惰性接收：
   首次调用把画像行传进来建池；之后按 id 集合判断是否需要重建。 */
function firmPool(personas) {
  if (personas && personas.length) {
    var key = personas.map(function (p) { return p.id + ':' + (p.ents || 0); }).join(',');
    if (!FIRMS || key !== FIRM_PERSONAS) { FIRMS = buildFirms(personas); FIRM_PERSONAS = key; }
  }
  return FIRMS || (FIRMS = {});
}
function firmsOf(persona, personas) {
  if (!persona) return [];
  var pool = firmPool(personas);
  return Object.keys(pool).map(function (k) { return pool[k]; })
    .filter(function (f) { return (f.personas || []).indexOf(persona.id) >= 0; });
}
function firmById(id, personas) { var p = firmPool(personas); return p[id] || null; }

  var R = S.R;

  function buildAssetTables() {
    var T = {};

    /* --- 知识库：直接来自维度表，并派生运行指标 --- */
    T.kb = {
      columns: [
        { key: 'name', label: '知识库', sortable: true },
        { key: 'docs', label: '文档数', sortable: true, align: 'right', fmt: 'int' },
        { key: 'chunks', label: '向量条数', sortable: true, align: 'right', fmt: 'int' },
        { key: 'chunkSize', label: '切片策略', fmt: 'chunk' },
        { key: 'lastSyncText', label: '最近同步', sortable: true, fmt: 'rel' },
        { key: 'refAgents', label: '被引用', align: 'right', fmt: 'int' },
        { key: 'hits', label: '周命中', sortable: true, align: 'right', fmt: 'int' },
        { key: 'zeroRate', label: '零结果率', align: 'right', fmt: 'pct1', hint: '检索无命中的比例，高说明内容有缺口' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: S.KBS.map(function (k, i) {
        var r = R.of('kb|' + k.id);
        var refAgents = S.AGENTS.filter(function (a) {
          var topo = global.FACTS ? global.FACTS.AGENT_TOPO[a.id] : 'qa-rag';
          return topo === 'qa-rag' || topo === 'contract';
        }).length;
        return {
          id: k.id, name: k.name, docs: k.docs, chunks: k.chunks,
          /* hue 必须显式带出来 —— 建行是逐字段列的，seed 里加了字段这里不带就等于没有。 */
          hue: k.hue,
          chunkSize: k.chunkSize, overlap: k.overlap, embed: k.embed,
          lastSync: k.lastSync, lastSyncText: k.lastSync,
          refAgents: i === 0 ? 6 : (i === 1 ? 3 : (i === 3 ? 4 : 2)),
          hits: Math.round(k.chunks * (2.4 + r() * 3.6)),
          zeroRate: +(0.018 + r() * 0.06).toFixed(4),
          /* 状态按「距今天数」判 —— seed 里 lastSync 是**负的偏移量**（-2 = 2 天前）。
             此前写的是 k.lastSync <= 2，负数恒成立 → 五个库**全部**显示「索引最新」，
             连 7 天没同步的合同条款库也是，状态列等于没有信息。
             阈值与列里那句提示一致：≤2 天 最新 / 3–6 天 待同步 / ≥7 天 滞后。 */
          status: (-k.lastSync) <= 2 ? 'ok' : ((-k.lastSync) < 7 ? 'warn' : 'bad'),
          statusText: (-k.lastSync) <= 2 ? '索引最新' : ((-k.lastSync) < 7 ? '待同步' : '同步滞后')
        };
      })
    };

    /* --- 沙盒池（配置态 · 常驻实例） ---
     * reuseMode 复用模式（**用户可选**，创建时定、之后可改）：
     *   reuse     常驻复用 —— 多任务共用一个池，省冷启动；适合低风险
     *   ephemeral 用完即毁 —— 每次任务新建实例、跑完销毁，隔离最干净；适合高风险
     *   auto      按风险自动 —— 跟随该池的隔离等级：S0–S2 复用 / S3 auto / S4–S5 新建
     */
    T.sandbox = {
      columns: [
        { key: 'name', label: '沙盒 / 池', sortable: true },
        { key: 'agentNames', label: '服务的 Agent' },
        { key: 'biz', label: '业务方' },
        { key: 'sLevel', label: '隔离等级', sortable: true, hint: '按任务场景对照原文 S0–S5 表推导（原文只给对照表，未规定判定方式）' },
        { key: 'reuseModeText', label: '复用模式', hint: '常驻复用省钱、用完即毁最干净，可按风险自动' },
        { key: 'sessions24h', label: '24h 会话', align: 'right', fmt: 'int' },
        { key: 'reuseSaved', label: '省下冷启动', align: 'right', fmt: 'int', hint: '复用相对「每个任务新建」省下的沙盒启动次数' },
        { key: 'blocked', label: '24h 拦截', align: 'right', fmt: 'int' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: [
        { id: 'sbx-code', name: 'sbx-code-exec', kindText: '代码执行池', image: 'runtime-py311:v4.2', templateId: 'tpl-py-code', spec: '4C / 8G', netPolicy: 'whitelist', netPolicyText: '白名单', concurrency: '18 / 40', uptime: '12d 4h', expiresAt: mmddPlus(12, 4), expiresInDays: 12, blocked: 7, status: 'ok', statusText: '运行中', biz: '平台共享',
          agentNames: '知识问答 · 文档摘要', sLevel: 'S3', reuseMode: 'auto', reuseModeText: '按风险自动', sessions24h: 214, reuseSaved: 186,
          dataSources: 3, tools: 7, creds: 2, netRules: 9,
          blastScope: 'Tenant:company_A → User:xianyu → Task:退货政策检索 → Sandbox:sbx-code-exec' },
        { id: 'sbx-browser', name: 'sbx-browser', kindText: '无头浏览器', image: 'chromium-headless:v128', templateId: 'tpl-browser', spec: '2C / 4G', netPolicy: 'whitelist', netPolicyText: '白名单', concurrency: '11 / 20', uptime: '6d 19h', expiresAt: mmddPlus(6, 23), expiresInDays: 6, blocked: 23, status: 'ok', statusText: '运行中', biz: '运营线',
          agentNames: '网红营销 · 竞品巡检', sLevel: 'S2', reuseMode: 'reuse', reuseModeText: '常驻复用', sessions24h: 96, reuseSaved: 91,
          dataSources: 1, tools: 4, creds: 1, netRules: 14,
          blastScope: 'Tenant:company_A → User:xianyu → Task:达人脚本合规预检 → Sandbox:sbx-browser' },
        { id: 'sbx-eval', name: 'sbx-exp-eval', kindText: '实验评估', image: 'eval-gpu:v2.1', templateId: 'tpl-gpu-eval', spec: '8C / 32G / A10', netPolicy: 'deny', netPolicyText: '禁止出网', concurrency: '0 / 6', uptime: '—', expiresAt: '—', expiresInDays: null, blocked: 0, status: 'idle', statusText: '已停止', biz: '平台共享',
          agentNames: '自进化 · 离线评估', sLevel: 'S4', reuseMode: 'ephemeral', reuseModeText: '用完即毁', sessions24h: 8, reuseSaved: 0,
          dataSources: 2, tools: 2, creds: 0, netRules: 0,
          blastScope: 'Tenant:company_A → User:xianyu → Task:离线评估 → Sandbox:sbx-exp-eval' },
        { id: 'sbx-doc', name: 'sbx-doc-parse', kindText: '文档解析', image: 'docparse:v3.6', templateId: 'tpl-docparse', spec: '4C / 16G', netPolicy: 'deny', netPolicyText: '禁止出网', concurrency: '22 / 25', uptime: '31d 2h', expiresAt: mmddPlus(1, 6), expiresInDays: 1, blocked: 3, status: 'warn', statusText: '接近并发上限', biz: '法务线',
          agentNames: '标书生成 · 合同初审', sLevel: 'S3', reuseMode: 'auto', reuseModeText: '按风险自动', sessions24h: 158, reuseSaved: 121,
          dataSources: 4, tools: 3, creds: 1, netRules: 0,
          blastScope: 'Tenant:company_A → User:xianyu → Task:合同初审 → Sandbox:sbx-doc-parse' }
      ]
    };

    /* --- 沙盒镜像（供「导入沙盒 / 镜像视图」用） ---
     * 纯前端：镜像作为配置态资产，供创建/导入向导选择。
     */
    T.sandbox_image = {
      columns: [
        { key: 'name', label: '镜像' },
        { key: 'version', label: '版本' },
        { key: 'sizeText', label: '大小', align: 'right' },
        { key: 'scanText', label: '扫描', fmt: 'status' },
        { key: 'kindText', label: '用途' },
        { key: 'refCount', label: '引用', align: 'right', fmt: 'int' }
      ],
      rows: [
        { id: 'img-py', name: 'runtime-py311', version: 'v4.2', sizeText: '812 MB', scan: 'ok', scanText: '0 高危', kindText: '代码执行', refCount: 1 },
        { id: 'img-browser', name: 'chromium-headless', version: 'v128', sizeText: '1.6 GB', scan: 'ok', scanText: '0 高危', kindText: '无头浏览器', refCount: 1 },
        { id: 'img-gpu', name: 'eval-gpu', version: 'v2.1', sizeText: '3.2 GB', scan: 'ok', scanText: '0 高危', kindText: '实验评估', refCount: 1 },
        { id: 'img-doc', name: 'docparse', version: 'v3.6', sizeText: '540 MB', scan: 'ok', scanText: '0 高危', kindText: '文档解析', refCount: 1 },
        { id: 'img-py-old', name: 'runtime-py311', version: 'v4.1', sizeText: '806 MB', scan: 'warn', scanText: '2 中危', kindText: '代码执行', refCount: 0 },
        { id: 'img-custom', name: 'custom-legal-parse', version: 'v1.2', sizeText: '920 MB', scan: 'warn', scanText: '1 中危', kindText: '文档解析', refCount: 0 }
      ]
    };

    /* --- 沙盒执行（原文 7 表之第 6 张：sandbox_execution） ---
     * 一次任务在一个沙盒上的执行记录（运行时文档称其为 SandboxSession，此处用扩充版的表名）。
     * 会话/任务侧的载体；持 sandboxId —— 这是「任务 → 沙盒」的关联键。
     * ⚠️ 隔离等级、启动方式、Denied 数 是我方在原文字段之外补的展示字段（标注为扩展）。
     */
    T.sandbox_execution = {
      columns: [
        { key: 'id', label: '执行' },
        { key: 'sandboxName', label: '沙盒' },
        { key: 'agentName', label: 'Agent' },
        { key: 'taskName', label: '任务' },
        { key: 'sLevel', label: '等级' },
        { key: 'startedAt', label: '开始' },
        { key: 'endedAt', label: '结束' },
        { key: 'resourceUsage', label: '资源占用', align: 'right' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: (function () {
        /* v20 修复（P0-4）：Agent 归属沙盒。原先 Agent 用 i % 8 独立轮转、沙盒用 i % 4 轮转，
         * 两个周期不同步 ⇒ 执行记录里的 Agent 不属于该沙盒。现在按沙盒各取自己的 Agent 池。*/
        var AGENT_POOL = {
          'sbx-code': ['知识问答 Agent', '文档摘要 Agent'],
          'sbx-browser': ['网红营销 Agent', '竞品巡检 Agent'],
          'sbx-eval': ['自进化 Agent', '离线评估 Agent'],
          'sbx-doc': ['标书生成 Agent', '合同初审 Agent']
        };
        var AGENT_ID = { '知识问答 Agent': 'ag-001', '文档摘要 Agent': 'ag-002', '标书生成 Agent': 'ag-003', '合同初审 Agent': 'ag-004', '网红营销 Agent': 'ag-005', '竞品巡检 Agent': 'ag-006', '自进化 Agent': 'ag-007', '离线评估 Agent': 'ag-008' };
        var TASK_POOL = {
          'sbx-code': ['退货政策检索', '知识库问答'],
          'sbx-browser': ['达人脚本合规预检', '竞品价格巡检'],
          'sbx-eval': ['离线评估', 'badcase 回放'],
          'sbx-doc': ['合同初审', '风险条款比对']
        };
        var tasks = ['退货政策检索', '长文档摘要', '技术标章节生成', '风险条款比对', '达人脚本合规预检', '工单分类', '线索意向分层', '广告法问答'];
        var pools = ['sbx-code', 'sbx-browser', 'sbx-eval', 'sbx-doc'];
        var poolName = { 'sbx-code': 'sbx-code-exec', 'sbx-browser': 'sbx-browser', 'sbx-eval': 'sbx-exp-eval', 'sbx-doc': 'sbx-doc-parse' };
        var lv = { 'sbx-code': 'S3', 'sbx-browser': 'S2', 'sbx-eval': 'S4', 'sbx-doc': 'S3' };
        var out = [];
        var sbxSeq = { 'sbx-code': 0, 'sbx-browser': 0, 'sbx-eval': 0, 'sbx-doc': 0 };
        for (var i = 0; i < 14; i++) {
          var rr = R.of('sbxsess|' + i);
          var pi = i % 4;
          var sbxId = pools[pi];
          /* v20 修复（P0-4）：Agent 从本沙盒池内取，不再跨沙盒乱串。
           * 用「沙盒内自增序号」选池内下标——早前写成 (i + pi) % len，
           * 而 i 与 pi 同奇偶，取模恒为 0，导致每个沙盒永远只出现池内第 1 个 Agent。*/
          var agPool = AGENT_POOL[sbxId], tkPool = TASK_POOL[sbxId];
          var ai = sbxSeq[sbxId] % agPool.length, ti = sbxSeq[sbxId] % tkPool.length;
          sbxSeq[sbxId]++;
          var ephem = pi === 2;
          var durMs = Math.round((3 + rr() * 90) * 1000);
          var hh = String(23 - (i % 6)).padStart(2, '0');
          var mm = String(Math.floor(rr() * 60)).padStart(2, '0');
          out.push({
            id: 'exec-' + (4100 + i),
            sandboxId: pools[pi],
            sandboxName: poolName[pools[pi]],
            agentId: AGENT_ID[agPool[ai]],
            agentName: agPool[ai],
            taskId: 'task-' + (82000 + i * 7),
            taskName: tkPool[ti],
            sLevel: lv[pools[pi]],
            startKind: ephem ? 'ephemeral' : 'reuse',
            startKindText: ephem ? '新建实例' : '复用实例',
            startedAt: '10-04 ' + hh + ':' + mm,
            endedAt: '10-04 ' + hh + ':' + String((Number(mm) + 1) % 60).padStart(2, '0'),
            resourceUsage: (0.4 + rr() * 2.6).toFixed(1) + ' GB',
            denied: Math.round(rr() * 4),
            durMs: durMs,
            durText: (durMs / 1000).toFixed(1) + 's',
            status: i === 5 ? 'bad' : 'ok',
            statusText: i === 5 ? '被拦截' : '已完成'
          });
        }
        return out;
      })()
    };

    /* --- 沙盒安全事件（原文 7 表之第 7 张：sandbox_event） ---
     * 字段照原文 §十八：sandbox_id / event_type / severity / actor / resource / action / policy_decision / timestamp
     * + deniedSyscall（我方补：命中的具体系统调用，用于"下钻到 Denied 明细"）
     */
    T.sandbox_event = {
      columns: [
        { key: 'at', label: '时间' },
        { key: 'sandboxName', label: '沙盒' },
        { key: 'eventType', label: '事件类型' },
        { key: 'severity', label: '级别', fmt: 'status' },
        { key: 'actor', label: '发起方' },
        { key: 'resource', label: '对象' },
        { key: 'action', label: '动作' },
        { key: 'policyDecision', label: '策略判定' },
        { key: 'deniedSyscall', label: '命中项' }
      ],
      rows: (function () {
        var pools = [['sbx-code', 'sbx-code-exec'], ['sbx-browser', 'sbx-browser'], ['sbx-eval', 'sbx-exp-eval'], ['sbx-doc', 'sbx-doc-parse']];
        /* 安全事件 4 级（原文口径：CRITICAL / HIGH / MEDIUM / LOW）—— 不是我原来那套 bad/warn/info */
        var kinds = [
          { t: '越权访问尝试', a: 'open', r: '/host/etc/passwd', s: 'syscall_denied', sys: 'open_by_handle_at', sev: 'bad', sevText: 'CRITICAL' },
          { t: '越权访问尝试', a: 'mount', r: '/mnt/host', s: 'syscall_denied', sys: 'mount', sev: 'bad', sevText: 'CRITICAL' },
          { t: '异常网络请求', a: 'connect', r: 'api.unknown-vendor.io:443', s: 'egress_denied', sys: '—', sev: 'warn', sevText: 'HIGH' },
          { t: '异常网络请求', a: 'connect', r: '169.254.169.254:80', s: 'metadata_denied', sys: '—', sev: 'bad', sevText: 'CRITICAL' },
          { t: '资源超限被杀', a: 'kill', r: 'cgroup.memory', s: 'limit_enforced', sys: '—', sev: 'warn', sevText: 'MEDIUM' },
          { t: '策略拒绝', a: 'exec', r: 'curl', s: 'tool_denied', sys: 'execve', sev: 'info', sevText: 'LOW' }
        ];
        var out = [];
        for (var i = 0; i < 16; i++) {
          var rr = R.of('sbxev|' + i);
          var p = pools[i % 4], k = kinds[Math.floor(rr() * kinds.length)];
          var hh = String(16 - (i % 9)).padStart(2, '0');
          var mm = String(Math.floor(rr() * 60)).padStart(2, '0');
          out.push({
            id: 'ev-' + (900 + i),
            sandboxId: p[0],
            sandboxName: p[1],
            at: '10-04 ' + hh + ':' + mm,
            eventType: k.t,
            severity: k.sev,
            severityText: k.sevText,
            /* 原文「批准需绑定 Actor / Tool / 目标 / 参数」——四项齐备才是一条可审的事件 */
            approvalBinding: k.sev === 'bad' || k.sev === 'warn'
              ? ('Actor:安全值班 · Tool:' + k.a + ' · 目标:' + k.r + ' · 参数:' + (k.sys !== '—' ? k.sys : '—'))
              : '—',
            actor: 'task-' + (82000 + (i % 14) * 7),
            resource: k.r,
            action: k.a,
            policyDecision: k.s,
            deniedSyscall: k.sys
          });
        }
        return out;
      })()
    };

    /* --- 原文七表之 3 张绑定表（**字段各不相同，照原文拆，不并成一张带 kind 的表**） ---
     * sandbox_data_binding : dataset_id / permission / scope
     * sandbox_tool_binding : tool_id / permission / approval_mode / rate_limit
     * sandbox_network_rule : destination / protocol / port / action / approval_required
     * sandbox_credential   : 凭证注入（原文属 sandbox_policy 的 credential_policy，此处单列便于展示）
     * 沙盒行上的 dataSources / tools / creds / netRules 四个计数由这几张表**数出来**，可交叉校验。
     */
    (function buildBindings() {
      var SBX = [
        { id: 'sbx-code', name: 'sbx-code-exec' },
        { id: 'sbx-browser', name: 'sbx-browser' },
        { id: 'sbx-eval', name: 'sbx-exp-eval' },
        { id: 'sbx-doc', name: 'sbx-doc-parse' }
      ];
      var DATASETS = [
        ['ds-crm', 'CRM 客户表', 'read', '列级：名称 / 等级（不含手机号）'],
        ['ds-order', '订单明细', 'read', '行级：华东区 2026'],
        ['ds-kb', '产品知识库', 'read', '全量'],
        ['ds-policy', '政策文档', 'read', '字段级：条款号 / 生效日'],
        ['ds-ticket', '工单摘要', 'read', '去 PII'],
        ['ds-contract', '合同库', 'read', '仅本租户 + 脱敏签署方'],
        ['ds-market', '竞品公开库', 'read', '仅公开字段']
      ];
      var TOOLS = [
        ['mcp://crm/query', 'read', 'LOW', 'auto', '60/min'],
        ['mcp://order/detail', 'read', 'LOW', 'auto', '80/min'],
        ['mcp://ticket/create', 'write', 'MEDIUM', 'audit', '40/min'],
        ['mcp://doc/parse', 'write', 'MEDIUM', 'audit', '25/min'],
        ['mcp://notify/send', 'external_action', 'HIGH', 'approval', '100/min'],
        ['mcp://crm/update', 'write', 'HIGH', 'approval', '20/min'],
        ['mcp://crm/delete', 'delete', 'CRITICAL', 'dual_approval', '5/min']
      ];
      /* v20 修复（P1-5）：补齐到 14 条唯一目的地。原先只有 5 条，
       * take() 靠取模回绕把 5 条重复成 9 条（sbx-code 声明 9 条网络规则、实为 5 条唯一），
       * 而交叉校验因「声明数 = 表行数 = 9」反而通过，恰好把重复掩盖了。*/
      var NETS = [
        ['gateway.internal', 'HTTPS', 443, 'allow', false],
        ['api.vendor-a.com', 'HTTPS', 443, 'allow', false],
        ['*.amazonaws.com', 'HTTPS', 443, 'allow', true],
        ['169.254.169.254', 'HTTP', 80, 'deny', false],
        ['10.0.0.0/8', 'ANY', 0, 'deny', false],
        ['registry.internal', 'HTTPS', 443, 'allow', false],
        ['oss-cn-beijing.aliyuncs.com', 'HTTPS', 443, 'allow', false],
        ['pypi.org', 'HTTPS', 443, 'allow', false],
        ['files.pythonhosted.org', 'HTTPS', 443, 'allow', false],
        ['mirrors.aliyun.com', 'HTTPS', 443, 'allow', false],
        ['api.openai.com', 'HTTPS', 443, 'allow', true],
        ['cdn.jsdelivr.net', 'HTTPS', 443, 'allow', false],
        ['0.0.0.0/0', 'ANY', 0, 'deny', false]
        /* ↑ 默认拒绝兜底：显式 allow 之外的目的地都命中它，所以它必须声明在最后 */
      ];
      var CREDS = [
        ['mcp://crm/query', 'ref:crm-readonly', 'runtime_inject', 'task'],
        ['llm://qwen', 'ref:llm-prod', 'runtime_inject', 'session'],
        ['mcp://notify/send', 'ref:webhook-sign', 'runtime_inject', 'task'],
        ['oss://invoices', 'ref:oss-rw-contract', 'runtime_inject', 'task'],
        ['http://vendor-b.com', 'ref:vendor-b-key', 'runtime_inject', 'session']
      ];
      /* v20 修复（P1-5）：原来用 % arr.length 取模回绕，n 超过池子长度时静默产生重复项。
       * 现在不足即抛错——宁可构建失败，也不让重复数据混进「唯一事实源」。*/
      function take(arr, n, off) {
        if (n > arr.length - off) throw new Error('take() 请求 ' + n + ' 条，但池子从 off=' + off + ' 起只剩 ' + (arr.length - off) + ' 条——请补池子，不要靠取模凑数');
        var o = []; for (var i = 0; i < n; i++) o.push(arr[off + i]); return o;
      }

      T.sandbox_data_binding = { columns: [
        { key: 'datasetName', label: '数据集' }, { key: 'permission', label: '权限' },
        { key: 'scope', label: '投影范围（Task Scope）' }, { key: 'sandboxName', label: '沙盒' }
      ], rows: [] };
      T.sandbox_tool_binding = { columns: [
        { key: 'toolId', label: '工具' }, { key: 'permission', label: '动作' },
        { key: 'riskLevel', label: '风险档' }, { key: 'approvalMode', label: '审批模式' },
        { key: 'rateLimit', label: '限流', align: 'right' }, { key: 'sandboxName', label: '沙盒' }
      ], rows: [] };
      T.sandbox_network_rule = { columns: [
        { key: 'priorityText', label: '优先级', hint: '数值小者先匹配；deny 段整体先于 allow 段，末条 0.0.0.0/0 deny 为兜底' },
        { key: 'destination', label: '目的地' }, { key: 'protocol', label: '协议' },
        { key: 'port', label: '端口', align: 'right' }, { key: 'action', label: '动作' },
        { key: 'approvalRequiredText', label: '审批' }, { key: 'sandboxName', label: '沙盒' }
      ], rows: [] };
      T.sandbox_credential = { columns: [
        { key: 'forService', label: '服务' }, { key: 'credRef', label: '凭证引用' },
        { key: 'injectMode', label: '注入方式' }, { key: 'ttl', label: '生命周期' }, { key: 'sandboxName', label: '沙盒' }
      ], rows: [] };

      var COUNTS = { 'sbx-code': [3, 4, 2, 9], 'sbx-browser': [1, 3, 1, 5], 'sbx-eval': [2, 2, 0, 0], 'sbx-doc': [4, 2, 1, 0] };
      SBX.forEach(function (s, si) {
        var c = COUNTS[s.id];
        take(DATASETS, c[0], si).forEach(function (d) {
          T.sandbox_data_binding.rows.push({ id: s.id + '|d|' + d[0], sandboxId: s.id, sandboxName: s.name, datasetId: d[0], datasetName: d[1], permission: d[2], scope: d[3] });
        });
        take(TOOLS, c[1], si).forEach(function (t) {
          T.sandbox_tool_binding.rows.push({ id: s.id + '|t|' + t[0], sandboxId: s.id, sandboxName: s.name, toolId: t[0], permission: t[1], riskLevel: t[2], approvalMode: t[3], rateLimit: t[4] });
        });
        take(CREDS, c[2], si).forEach(function (k) {
          T.sandbox_credential.rows.push({ id: s.id + '|c|' + k[0], sandboxId: s.id, sandboxName: s.name, forService: k[0], credRef: k[1], injectMode: k[2], ttl: k[3] });
        });
        /* v20 修复（P1-5）：补 priority 列，写明「deny 优先」的匹配顺序。
         * 数值小 = 先匹配。deny 取靠前一段、allow 取靠后一段，
         * 同段内按 NETS 声明顺序，保证匹配结果确定且 deny 必胜。*/
        take(NETS, c[3], si).forEach(function (n, ni) {
          var prio = (n[3] === 'deny') ? (ni + 1) : (100 + ni);
          T.sandbox_network_rule.rows.push({ id: s.id + '|n|' + n[0], sandboxId: s.id, sandboxName: s.name, destination: n[0], protocol: n[1], port: n[2], action: n[3], priority: prio, priorityText: 'P' + (prio < 10 ? '0' : '') + prio, approvalRequired: n[4], approvalRequiredText: n[4] ? '需审批' : '免审批' });
        });
      });
      /* 把计数回写到沙盒行，保证「页面上的 4 个数」= 「绑定表里的行数」 */
      T.sandbox.rows.forEach(function (r) {
        var c = COUNTS[r.id] || [0, 0, 0, 0];
        r.dataSources = c[0]; r.tools = c[1]; r.creds = c[2]; r.netRules = c[3];
      });
      /* v20 修复（P0-3）：「24h 拦截」不再手写常数，改为从 sandbox_event 逐条推导。
       * 原先是 7/23/0/3 四个手填数字，与事件表的 16 条对不上，
       * 于是列表页、详情页、下钻明细出现三套互相打架的拦截口径。
       * 现在事件表是唯一事实源：sandbox_event 有几条，这个沙盒就是几次。*/
      (function () {
        var cnt = {}, bySev = {};
        T.sandbox_event.rows.forEach(function (e) {
          cnt[e.sandboxId] = (cnt[e.sandboxId] || 0) + 1;
          if (e.policyDecision === 'syscall_denied' || e.policyDecision === 'egress_denied'
            || e.policyDecision === 'metadata_denied' || e.policyDecision === 'tool_denied') {
            bySev[e.sandboxId] = (bySev[e.sandboxId] || 0) + 1;
          }
        });
        T.sandbox.rows.forEach(function (r) {
          r.blocked = cnt[r.id] || 0;
          /* denied = 策略实际拒绝（syscall/出网/元数据/工具），与 blocked 的差额是「资源超限」等非拒绝类事件 */
          r.denied = bySev[r.id] || 0;
          r.blockedTotal = cnt[r.id] || 0;
        });
      })();
    })();

    /* --- 问卷 --- */
    /* --- AI 访谈任务 ---
     * 范式：拿到联系方式后由 AI 通过 IM / 企微 / 短信做多轮详细咨询（纯文本，不做语音）。
     * 口径：reached（已触达）≥ replied（已回复）≥ consulted（有效咨询）；
     *   replyRate = replied / reached（预计算写入数据，除零兜底）；
     *   intent 高/中/低三项之和 = consulted。
     * 名单来源 listSource 复用运营分群圈人（segment）或名单导入（import）。
     * 交付方式 delivery：dispatch（AI 派发触达）+ selfserve（自助入口链接/二维码）。
     * 说明：qcount/collected/quota/finishRate/dropNode/avgDur 为既有字段，保留供其它读取点使用。
     */
    T.survey = {
      columns: [
        { key: 'name', label: '访谈任务', sortable: true },
        { key: 'listSource', label: '名单来源' },
        { key: 'delivery', label: '交付方式' },
        { key: 'qcount', label: '轮次规模', align: 'right', fmt: 'int' },
        { key: 'reached', label: '已触达', sortable: true, align: 'right', fmt: 'int' },
        { key: 'replyRate', label: '回复率', sortable: true, align: 'right', fmt: 'pct1' },
        { key: 'consulted', label: '有效咨询', sortable: true, align: 'right', fmt: 'int' },
        { key: 'intent', label: '意向分级' },
        { key: 'collected', label: '已回收', align: 'right', fmt: 'int' },
        { key: 'quota', label: '回收目标', align: 'right', fmt: 'int' },
        { key: 'finishRate', label: '完答率', sortable: true, align: 'right', fmt: 'pct1' },
        { key: 'avgDur', label: '平均时长', align: 'right' },
        { key: 'dropNode', label: '主要流失题', hint: '放弃比例最高的题目，优化访谈的直接依据' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: [
        { id: 'sv-nps', name: 'NPS 季度调研', qcount: 12, collected: 2310, quota: 2500, finishRate: 0.842, avgDur: '3m12s', dropNode: 'Q7 开放式建议', status: 'ok', statusText: '已完成', target: '企业客户',
          reached: 2680, replied: 1926, consulted: 1580, replyRate: 0.7187,
          intent: { high: 560, mid: 720, low: 300 },
          channels: ['im', 'wecom', 'sms'],
          listSource: { kind: 'segment', segId: 'sg-2' },
          delivery: { dispatch: true, selfserve: true, channels: ['im', 'wecom', 'sms'], link: 'https://iv.example.com/s/sv-nps', qrSeed: 'sv-nps' } },
        { id: 'sv-csat', name: '新客户满意度回访', qcount: 32, collected: 1204, quota: 2000, finishRate: 0.681, avgDur: '8m40s', dropNode: 'Q18 使用频次', status: 'info', statusText: '进行中', target: '近30天新客',
          reached: 1560, replied: 1020, consulted: 780, replyRate: 0.6538,
          intent: { high: 240, mid: 380, low: 160 },
          channels: ['im', 'sms'],
          listSource: { kind: 'import', file: '访谈名单_20261005.csv', count: 1240 },
          delivery: { dispatch: true, selfserve: true, channels: ['im', 'sms'], link: 'https://iv.example.com/s/sv-csat', qrSeed: 'sv-csat' } },
        { id: 'sv-churn', name: '功能弃用原因调研', qcount: 18, collected: 862, quota: 1000, finishRate: 0.754, avgDur: '5m06s', dropNode: 'Q11 竞品对比', status: 'ok', statusText: '已完成', target: '流失客户',
          reached: 1180, replied: 902, consulted: 730, replyRate: 0.7644,
          intent: { high: 300, mid: 300, low: 130 },
          channels: ['im', 'wecom'],
          listSource: { kind: 'segment', segId: 'sg-5' },
          delivery: { dispatch: true, selfserve: false, channels: ['im', 'wecom'], link: 'https://iv.example.com/s/sv-churn', qrSeed: 'sv-churn' } },
        { id: 'sv-price', name: '定价敏感度测试', qcount: 24, collected: 455, quota: 1500, finishRate: 0.612, avgDur: '6m22s', dropNode: 'Q9 价格区间', status: 'warn', statusText: '草稿', target: '企业客户',
          reached: 620, replied: 268, consulted: 190, replyRate: 0.4323,
          intent: { high: 60, mid: 80, low: 50 },
          channels: ['im'],
          listSource: { kind: 'segment', segId: 'sg-1' },
          delivery: { dispatch: true, selfserve: true, channels: ['im'], link: 'https://iv.example.com/s/sv-price', qrSeed: 'sv-price' } }
      ]
    };

    /* --- 画像库（B2B · 企业客户）---
     * 边界：本表只描述 **企业客户**（行业 / 企业账户 / 决策链角色）。
     *   C 端的另外两套见下方 `T.persona_sim`（「模拟用户」的虚拟人设）与 `T.user_pool`（「全局用户池」
     *   的个人样本）—— 三个都叫 persona/画像，但对象完全不同，禁止互相引用或聚合。
     *
     * 新鲜度是单一口径：TTL 30 天，超过即「待更新」。状态、引用分档都在这里派生 ——
     * 此前是种子数据手写 status、列表页写一套阈值（>=9/>=5）、详情页又写另一套（>=7 叫核心画像），
     * 同一个概念三个说法。现在渲染层只读派生字段，保证「列表 / 详情 / 弹窗」说的是同一件事。
     *
     * 「引用热度」只说被多少策略/Agent 用到，不是「这群人值不值得投放」的建议。
     *
     * kind：ICP（描述"哪类企业"）/ role（描述"哪个岗位的人"）。
     *   这是**人工归类**，不是从数据派生的 —— 判定规则见下方注释，界面 tooltip 同步展示。
     * 覆盖企业数（ents）的口径见界面页脚：主数据 + 统一社会信用代码去重；本原型未接主数据，
     *   数值为示例值，**不参与任何"人数规模"表述**。
     */
    T.persona = {
      ttlDays: 30,
      nearDays: 24,
      kindHint: 'ICP = 描述「哪类企业」；角色画像 = 描述「哪个岗位的人」',
      columns: [
        { key: 'kind', label: '类型' },
        { key: 'role', label: '角色' },
        { key: 'name', label: '画像名称', sortable: true },
        { key: 'industry', label: '行业' },
        { key: 'ents', label: '覆盖企业', sortable: true, align: 'right', fmt: 'int' },
        { key: 'tags', label: '核心标签', fmt: 'tags' },
        { key: 'refCount', label: '被引用', sortable: true, align: 'right', fmt: 'int', hint: '被 Agent / 运营策略引用的次数；分档只说明使用广度，不代表人群价值' },
                { key: 'updated', label: '更新时间', sortable: true, fmt: 'rel' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      /* role 只对角色画像有值；ICP 行显式 null（不是 undefined —— 数据层校验按列逐行查 undefined） */
      rows: [
        { id: 'ps-mfg', kind: 'icp', role: null, name: '国企制造决策链', industry: '制造', ents: 96, tags: ['采购委员会', '预算周期', '招标偏好', '私有化部署'], refCount: 7, updated: -2, status: 'ok', statusText: '生效中' },
        { id: 'ps-retail', kind: 'icp', role: null, name: '连锁零售运营层', industry: '零售', ents: 154, tags: ['促销敏感', '巡店频次', '门店规模'], refCount: 12, updated: -3, status: 'ok', statusText: '生效中' },
        { id: 'ps-fin', kind: 'icp', role: null, name: '金融 IT 评估组', industry: '金融', ents: 61, tags: ['合规优先', 'POC 驱动', '多方比价'], refCount: 5, updated: -5, status: 'ok', statusText: '生效中' },
        { id: 'ps-gov', kind: 'role', role: '守门人', name: '区域政务接口人', industry: '政务', ents: 43, tags: ['政策口径', '审批路径', '汇报节奏'], refCount: 2, updated: -37, status: 'warn', statusText: '待更新' },
        { id: 'ps-smb', kind: 'icp', role: null, name: '中小电商卖家', industry: '电商', ents: 312, tags: ['价格敏感', '自助服务', '移动端为主'], refCount: 9, updated: -1, status: 'ok', statusText: '生效中' }
      ]
    };
    T.persona.rows.forEach(function (r) {
      var age = Math.abs(r.updated);          // updated 记的是负数天数
      r.ageDays = age;
      r.overdueDays = Math.max(0, age - T.persona.ttlDays);
      if (age >= T.persona.ttlDays) { r.status = 'warn'; r.statusText = '待更新'; }
      else if (age >= T.persona.nearDays) { r.status = 'warn'; r.statusText = '临近过期'; }
      else { r.status = 'ok'; r.statusText = '生效中'; }
      if (r.refCount >= 9) { r.heatKey = 'ok'; r.heatText = '高频引用'; }
      else if (r.refCount >= 5) { r.heatKey = 'idle'; r.heatText = '常规引用'; }
      else { r.heatKey = 'idle'; r.heatText = '低引用'; }
      /* 类型文案：ICP / 角色画像（+角色）。派生而非另存字段，避免两处各写一套措辞。 */
      r.kindKey = r.kind === 'role' ? 'info' : 'idle';
      r.kindText = r.kind === 'role' ? ('角色画像 · ' + (r.role || '未标角色')) : 'ICP · 企业类型';
      /* 规模口径：一家企业只属一个行业、画像间席位不重叠 ⇒ 覆盖数就是按 USCC 去重后的数
         （见本文件 L123 / L231）。所以不再挂示例值这类自述 —— 它就是去重后的数。 */
      r.entsScope = '按 USCC 去重';
      /* 圈选条件摘要：**由现有字段反推**，不是原始圈选规则（源数据没有条件表）。
         命名带 Derived 就是为了让渲染层能明说"这是反推的"，且永不可执行。 */
      r.rulesDerived = '行业 = ' + r.industry + ' AND 标签含「' + (r.tags || []).slice(0, 2).join('、') + '」';
    });

    /* --- 模拟用户 persona（C 端 · 非画像库数据）---
     * 边界：这是「模拟用户」页的**虚拟人设**（用于预演触达），不是「企业用户画像库」的对象；
     *   两者都叫 persona 但主体不同（这里是人设，那边是企业客户），不要互相聚合、不要互相引用。
     */
    T.persona_sim = {
      columns: [
        { key: 'name', label: 'persona', sortable: true },
        { key: 'bizText', label: '业务线' },
        { key: 'fidelity', label: '保真度', sortable: true, align: 'right', fmt: 'pct1', hint: '与真实历史数据对比得出；低于 80% 不建议用于转化预测' },
        { key: 'fidelityScope', label: '适用边界', hint: '保真度只在特定场景成立，超出范围结论不可信' },
        { key: 'sessions', label: '本周会话', sortable: true, align: 'right', fmt: 'int' },
        { key: 'variance', label: '回答方差', align: 'right', hint: '同一问题跑 20 次的输出离散度，过高说明人设不收敛' },
        { key: 'usedBy', label: '被引用', align: 'right', fmt: 'int' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: [
        { id: 'sm-mom', name: '价格敏感型宝妈', bizText: '运营线', fidelity: 0.912, fidelityScope: '促销场景 91% / 日常场景 62%', sessions: 412, variance: '低（σ=0.14）', usedBy: 5, status: 'ok', statusText: '已验证' },
        { id: 'sm-it', name: '保守型企业 IT 主管', bizText: '销售线', fidelity: 0.864, fidelityScope: '选型场景 86% / 售后场景 71%', sessions: 268, variance: '中（σ=0.27）', usedBy: 3, status: 'ok', statusText: '已验证' },
        { id: 'sm-genz', name: '冲动型 Z 世代用户', bizText: '运营线', fidelity: 0.738, fidelityScope: '仅短视频种草场景，其他场景不适用', sessions: 156, variance: '高（σ=0.51）', usedBy: 1, status: 'warn', statusText: '保真度未达标' },
        { id: 'sm-proc', name: '国企采购流程负责人', bizText: '销售线', fidelity: 0.891, fidelityScope: '招投标场景 89%', sessions: 194, variance: '低（σ=0.11）', usedBy: 4, status: 'ok', statusText: '已验证' },
        { id: 'sm-legal', name: '法务合规审核员', bizText: '法务线', fidelity: 0.944, fidelityScope: '合同审查场景 94%', sessions: 88, variance: '低（σ=0.08）', usedBy: 2, status: 'ok', statusText: '已验证' }
      ]
    };

    /* --- 全局用户池（C 端 · 非画像库数据）（正方形小卡片 + 可勾选）---
     * 规格来自设计稿：全池 50 位，卡片显示「首字母圆章 + 姓名 + 国别·年龄」，
     * 勾选后进入「确认，开始 Jev 判定」。区分两种来源：
   *   具名（14 位）= 已跑过判定的样本，字段完整，可看详细卡；
   *   未具名（36 位）= 待判定占位，只给首字母 + 国别年龄，判定后回填。
     * 字段口径：
     *   jevScore 判定得分 0-1（详细卡与结果卡同源，不复制）；
     *   presign  预选标记（图中角标 preset / llm / crm / manual / rule）；
     *   hits     命中次数、sims 已模拟次数。
     */
    T.user_pool = (function () {
      var r = S.R.of('user-pool-v1');
      /* 具名样本：对应设计稿中的详细卡（前 6 位为图中已勾选并已判定的那批） */
      var named = [
        { n: 'Alex Chen', ag: 34, job: '产品经理', c: '美国', spend: 420, tags: ['价格敏感', '品质优先', '高复购'], pain: ['尺码不准', '物流慢', '客服响应不及时'], src: 'llm', fid: 0.86 },
        { n: 'Mia Torres', ag: 28, job: '社交运营', c: '西班牙', spend: 180, tags: ['颜值驱动', '冲动消费', '种草易感'], pain: ['图文与实物色差', '退换流程繁琐'], src: 'preset', fid: 0.74 },
        { n: 'Jin Park', ag: 41, job: '供应链主管', c: '韩国', spend: 760, tags: ['品质优先', '低价价格敏感', '长决策周期'], pain: ['批次一致性差', '售后响应速度'], src: 'crm', fid: 0.91 },
        { n: 'Sara Ahmed', ag: 25, job: '大学生', c: '阿联酋', spend: 90, tags: ['极致低价', '重度比价', '优惠券依赖'], pain: ['运费高', '无学生优惠', '结算步骤长'], src: 'llm', fid: 0.68 },
        { n: 'Tom Becker', ag: 52, job: '全科医生', c: '德国', spend: 310, tags: ['品牌忠诚', '谨慎决策', '低退货率'], pain: ['退换政策不透明', '缺少积分/材质说明'], src: 'manual', fid: 0.93 },
        { n: 'Mei Lin', ag: 31, job: '跨境电商商家', c: '新加坡', spend: 540, tags: ['效率优先', '多平台运营', '批量采购'], pain: ['账期节奏慢', '跨境结算与关税不透明'], src: 'rule', fid: 0.82 },
        { n: 'Ben Carter', ag: 40, job: '物流运营', c: '加拿大', spend: 260, tags: ['时效敏感', '可追溯'], pain: ['揽收慢', '轨迹更新滞后'], src: 'crm', fid: 0.79 },
        { n: 'Lucas Silva', ag: 29, job: '健身教练', c: '巴西', spend: 150, tags: ['促销驱动', '复购低'], pain: ['尺码偏差', '退货运费'], src: 'llm', fid: 0.71 },
        { n: 'Emma Wilson', ag: 37, job: '市场经理', c: '英国', spend: 480, tags: ['口碑敏感', '看评测'], pain: ['评论不足', '交期不确定'], src: 'preset', fid: 0.83 },
        { n: 'Yuki Tanaka', ag: 26, job: '设计师', c: '日本', spend: 220, tags: ['细节控', '包装要求高'], pain: ['包装破损', '说明不全'], src: 'llm', fid: 0.76 },
        { n: 'Omar Haddad', ag: 44, job: '采购经理', c: '沙特', spend: 690, tags: ['批量采购', '账期敏感'], pain: ['账期条款', '售后响应'], src: 'rule', fid: 0.8 },
        { n: 'Nina Petrova', ag: 33, job: '市场分析师', c: '俄罗斯', spend: 300, tags: ['比价', '数据驱动'], pain: ['跨境运费', '税费不透明'], src: 'crm', fid: 0.77 },
        { n: 'Carlos Ruiz', ag: 30, job: '摄影师', c: '墨西哥', spend: 340, tags: ['品质优先', '内容创作者'], pain: ['包装保护', '色差'], src: 'llm', fid: 0.72 },
        { n: 'Sophie Martin', ag: 39, job: '教师', c: '法国', spend: 210, tags: ['口碑推荐', '季节性'], pain: ['退换麻烦', '价格波动'], src: 'preset', fid: 0.85 }
      ];
      /* 未具名占位：只给首字母 + 国别年龄，判定后回填姓名 */
      /* 其余 36 位：同样给**完整画像**（姓名 / 职业 / 标签 / 痛点 / 月消费 / 来源 / 保真度）。
       * 2026-10-17：此前这里是「只给首字母 + 国别年龄」的占位，展开全部时一整片字母灰卡，
       * 既认不出是谁、也没法勾选/判定/做单人回放。现在 50 位全部具名。
       * 约束：池内 (国别,年龄) 两两不同 —— 不要抄上面 named 的组合造克隆。 */
      var extra = [
        { n: 'Maud de Vries', c: '荷兰', ag: 30, job: '品牌策划', spend: 380, tags: ['品质优先', '看评测'], pain: ['尺码不准', '退换流程繁琐'], src: 'llm', fid: 0.84 },
        { n: 'Pablo Serrano', c: '西班牙', ag: 45, job: '建筑师', spend: 520, tags: ['品牌忠诚', '细节控'], pain: ['交期不确定', '包装破损'], src: 'crm', fid: 0.88 },
        { n: 'Tyler Brooks', c: '美国', ag: 41, job: '电商运营', spend: 610, tags: ['效率优先', '批量采购'], pain: ['物流慢', '账期节奏慢'], src: 'rule', fid: 0.86 },
        { n: 'Jonas Berger', c: '德国', ag: 36, job: '机械工程师', spend: 440, tags: ['谨慎决策', '低退货率'], pain: ['说明不全', '缺少材质说明'], src: 'manual', fid: 0.91 },
        { n: 'Giulia Ferrari', c: '意大利', ag: 29, job: '时尚买手', spend: 330, tags: ['颜值驱动', '新品尝鲜'], pain: ['图文与实物色差', '尺码偏差'], src: 'llm', fid: 0.8 },
        { n: 'Andre Costa', c: '巴西', ag: 51, job: '个体店主', spend: 260, tags: ['促销驱动', '价格敏感'], pain: ['运费高', '结算步骤长'], src: 'crm', fid: 0.81 },
        { n: 'Emre Yilmaz', c: '土耳其', ag: 34, job: '物流经理', spend: 290, tags: ['时效敏感', '可追溯'], pain: ['揽收慢', '轨迹更新滞后'], src: 'crm', fid: 0.83 },
        { n: 'Erik Lindqvist', c: '瑞典', ag: 40, job: '产品设计', spend: 470, tags: ['品质优先', '细节控'], pain: ['包装破损', '退换政策不透明'], src: 'llm', fid: 0.87 },
        { n: 'Rohan Mehta', c: '印度', ag: 35, job: '软件工程师', spend: 210, tags: ['极致低价', '重度比价'], pain: ['运费高', '结算步骤长'], src: 'llm', fid: 0.76 },
        { n: 'Felix Bauer', c: '奥地利', ag: 27, job: '健身教练', spend: 190, tags: ['促销驱动', '复购低'], pain: ['尺码偏差', '退货运费'], src: 'llm', fid: 0.79 },
        { n: 'Marco Colombo', c: '意大利', ag: 46, job: '餐厅老板', spend: 560, tags: ['批量采购', '账期敏感'], pain: ['账期条款', '售后响应'], src: 'rule', fid: 0.85 },
        { n: 'Kuba Nowak', c: '波兰', ag: 32, job: '摄影助理', spend: 170, tags: ['颜值驱动', '冲动消费'], pain: ['图文与实物色差', '包装保护'], src: 'llm', fid: 0.82 },
        { n: 'Dewi Putri', c: '印尼', ag: 24, job: '客服专员', spend: 130, tags: ['价格敏感', '优惠券依赖'], pain: ['运费高', '无学生优惠'], src: 'llm', fid: 0.78 },
        { n: 'Aisyah Rahman', c: '马来西亚', ag: 36, job: '财务主管', spend: 400, tags: ['数据驱动', '比价'], pain: ['税费不透明', '售后门槛高'], src: 'crm', fid: 0.86 },
        { n: 'Matias Rojas', c: '智利', ag: 28, job: '咖啡师', spend: 160, tags: ['种草易感', '冲动消费'], pain: ['物流慢', '客服响应不及时'], src: 'llm', fid: 0.83 },
        { n: 'Noa Ben-Ami', c: '以色列', ag: 41, job: '产品经理', spend: 530, tags: ['效率优先', '口碑敏感'], pain: ['评论不足', '交期不确定'], src: 'preset', fid: 0.9 },
        { n: 'Claire Dubois', c: '法国', ag: 55, job: '中学教师', spend: 240, tags: ['口碑推荐', '季节性'], pain: ['退换麻烦', '价格波动'], src: 'preset', fid: 0.84 },
        { n: 'Mika Santos', c: '菲律宾', ag: 23, job: '社媒运营', spend: 120, tags: ['极致低价', '促销驱动'], pain: ['运费高', '结算步骤长'], src: 'llm', fid: 0.74 },
        { n: 'Nikos Papas', c: '希腊', ag: 38, job: '船员', spend: 200, tags: ['时效敏感', '价格敏感'], pain: ['到货时间不确定', '物流慢'], src: 'llm', fid: 0.8 },
        { n: 'Laszlo Nagy', c: '匈牙利', ag: 45, job: '工厂主管', spend: 310, tags: ['批量采购', '账期敏感'], pain: ['账期条款', '批次一致性差'], src: 'rule', fid: 0.82 },
        { n: 'Elin Jonsdottir', c: '冰岛', ag: 31, job: '导游', spend: 280, tags: ['品质优先', '新品尝鲜'], pain: ['包装破损', '说明不全'], src: 'llm', fid: 0.85 },
        { n: 'Kenji Sato', c: '日本', ag: 34, job: '零售店员', spend: 230, tags: ['细节控', '包装要求高'], pain: ['包装破损', '说明不全'], src: 'llm', fid: 0.83 },
        { n: 'Amani Otieno', c: '肯尼亚', ag: 29, job: '教师', spend: 140, tags: ['价格敏感', '优惠券依赖'], pain: ['运费高', '无学生优惠'], src: 'llm', fid: 0.81 },
        { n: 'Ruta Kazlauskaite', c: '立陶宛', ag: 42, job: '会计', spend: 350, tags: ['谨慎决策', '比价'], pain: ['税费不透明', '退换政策不透明'], src: 'crm', fid: 0.84 },
        { n: 'Yasmine Alaoui', c: '摩洛哥', ag: 27, job: '翻译', spend: 180, tags: ['颜值驱动', '看评测'], pain: ['图文与实物色差', '物流慢'], src: 'llm', fid: 0.8 },
        { n: 'Beat Meier', c: '瑞士', ag: 50, job: '银行顾问', spend: 720, tags: ['品牌忠诚', '低退货率'], pain: ['缺少材质说明', '退换政策不透明'], src: 'manual', fid: 0.92 },
        { n: 'Lena Gruber', c: '奥地利', ag: 36, job: '护士', spend: 220, tags: ['促销驱动', '高复购'], pain: ['价格波动', '优惠信息不透明'], src: 'llm', fid: 0.83 },
        { n: 'Ingrid Dahl', c: '挪威', ag: 33, job: '海洋工程', spend: 590, tags: ['品质优先', '谨慎决策'], pain: ['批次一致性差', '售后响应速度'], src: 'crm', fid: 0.88 },
        { n: 'Mads Jensen', c: '丹麦', ag: 44, job: '家具买手', spend: 480, tags: ['效率优先', '批量采购'], pain: ['揽收慢', '账期节奏慢'], src: 'rule', fid: 0.85 },
        { n: 'Tiago Sousa', c: '葡萄牙', ag: 25, job: '学生', spend: 110, tags: ['极致低价', '重度比价'], pain: ['运费高', '无学生优惠'], src: 'llm', fid: 0.79 },
        { n: 'Kostas Vlachos', c: '希腊', ag: 47, job: '船务代理', spend: 410, tags: ['账期敏感', '批量采购'], pain: ['账期条款', '跨境结算与关税不透明'], src: 'rule', fid: 0.82 },
        { n: 'Ji-hoon Park', c: '韩国', ag: 31, job: '平面设计', spend: 300, tags: ['颜值驱动', '细节控'], pain: ['图文与实物色差', '包装破损'], src: 'llm', fid: 0.86 },
        { n: 'Tomas Novak', c: '捷克', ag: 39, job: '汽修技师', spend: 190, tags: ['价格敏感', '可追溯'], pain: ['尺码偏差', '退货运费'], src: 'llm', fid: 0.81 },
        { n: 'Aigerim Sadykova', c: '哈萨克', ag: 28, job: '市场专员', spend: 210, tags: ['种草易感', '促销驱动'], pain: ['物流慢', '客服响应不及时'], src: 'llm', fid: 0.8 },
        { n: 'Janis Berzins', c: '拉脱维亚', ag: 43, job: '木材贸易', spend: 360, tags: ['账期敏感', '批量采购'], pain: ['账期条款', '售后响应'], src: 'crm', fid: 0.81 },
        { n: 'Ivan Horvat', c: '克罗地亚', ag: 35, job: '民宿房东', spend: 270, tags: ['季节性', '口碑敏感'], pain: ['交期不确定', '退换麻烦'], src: 'llm', fid: 0.83 }
      ];
      var rows = [];
      /* 50 位一律按同一形状建行：都有姓名、职业、标签、痛点、消费、来源、保真度。
       * 「未具名」这个状态在池子里已经不存在了（2026-10-17），别再给 named:false 开分支。 */
      named.concat(extra).forEach(function (p, ix) {
        rows.push({
          id: 'up-' + (ix + 1), name: p.n, initial: p.n.charAt(0),
          age: p.ag, job: p.job, country: p.c, spend: p.spend,
          tags: p.tags, pains: p.pain, source: p.src, sourceText: p.src,
          fidelity: p.fid, jevScore: null, hits: Math.floor(r() * 4), sims: Math.floor(r() * 5),
          enabled: true, named: true
        });
      });
      /* Jev 判定得分：确定性派生（种子固定即稳定），50 位全部有分 */
      rows.forEach(function (x, ix) {
        if (!x.named) return;
        var base = 0.25 + r() * 0.6;
        // 手动维护的 persona 更可信，判定分略高；llm 合成的方差更大
        if (x.source === 'manual') base = Math.min(0.95, base + 0.12);
        if (x.source === 'rule') base = Math.min(0.95, base + 0.06);
        if (x.source === 'llm') base = base * 0.92;
        // 判定分与保真度同向，但不等同（保真度=对历史数据吻合，判定分=本次选中样本的响应强度）
        x.jevScore = Math.round(Math.max(0.05, Math.min(0.98, base * 0.75 + x.fidelity * 0.25)) * 100) / 100;
        x.jevBand = x.jevScore >= 0.7 ? 'high' : (x.jevScore >= 0.4 ? 'mid' : 'low');
      });
      return { rows: rows, total: rows.length, namedCount: rows.length };
    })();

    /* user_pool 以卡片渲染（正方形小卡 + 详细卡），不走表格；
     * 但资产表契约要求每张表有 columns，故补一份与 rows 字段对齐的列定义（渲染层不用它）。
     * 注意：未具名样本的 name/job/spend/tags 为 null，这是「待判定」的真实状态，不填假值。 */
    T.user_pool.columns = [
      { key: 'name', label: '姓名' }, { key: 'initial', label: '首字母' },
      { key: 'age', label: '年龄', align: 'right', fmt: 'int' },
      { key: 'job', label: '职业' }, { key: 'country', label: '国别' },
      { key: 'spend', label: '月消费', align: 'right', fmt: 'int' },
      { key: 'tags', label: '画像标签' }, { key: 'pains', label: '痛点' },
      { key: 'source', label: '来源' }, { key: 'fidelity', label: '保真度', align: 'right', fmt: 'pct1' },
      { key: 'jevScore', label: '判定分', align: 'right', fmt: 'num2' },
      { key: 'hits', label: '命中', align: 'right', fmt: 'int' },
      { key: 'sims', label: '已模拟', align: 'right', fmt: 'int' },
      { key: 'enabled', label: '启用' }, { key: 'named', label: '已具名' }
    ];

    /* --- 模拟实验结果（近 14 天）---
     * 确定性派生，可对账：
     * 情绪分布 pos+neu+neg=1；adopted ≤ sample；risk = round(neg*100)；
     * 保真度不复制，personaId 反查 persona_sim（渲染时同源）。
     */
    T.sim_runs = (function () {
      var r = S.R.of('sim-runs-v1');
      var personas = T.persona_sim.rows;
      // 池中已具名用户（sim_runs 挂这些人，勾选池卡才能筛出对应实验 —— 两套 id 靠 poolUserId 打通）
      var poolNamed = (T.user_pool && T.user_pool.rows || []).filter(function (x) { return x.named; });
      var modes = [
        { id: 'single', name: '单用户', result: 'reaction' },
        { id: 'multi', name: '多用户', result: 'conv' },
        { id: 'opinion', name: '舆情', result: 'senti' }
      ];
      var names = ['双11种草话术', '续费提醒改写', '新品种草预热', '价格异议应对', '新客首单引导', '退订挽回话术', '展会邀约话术', '竞品对比应答', '会员日邀约', '差评挽回话术', '新客首单引导', '续费提醒改写', '价格异议应对', '竞品对比应答'];
      // 14 条 = 覆盖 14 位已具名池用户（i 轮流挂），并按 i%3 轮流分配模式，
      // 保证三种模式都有实验、每位具名用户都能被筛出结果
      var n = 14, out = [];
      // 分档必须用「模式内序号」：模式本身按 i%3 分配，若分档也用 i%3，
      // 同一模式的 i%3 恒定 → 每种模式只落到一个档，分层就成了死代码
      var seqInMode = { single: 0, multi: 0, opinion: 0 };
      for (var i = 0; i < n; i++) {
        var p = personas[Math.floor(r() * personas.length)];
        // 模式按 i 轮转而非纯随机 —— 否则某模式可能一条都没有（tab 进来是空的）
        var mode = modes[i % 3];
        var seq = seqInMode[mode.id]++;
        // 单人模式语义是「1 位用户」，不该有规模样本；多用户/舆情才是批量预演
        var singleRun = mode.id === 'single';
        var sample = singleRun ? 1 : 100 + Math.floor(r() * 9900);
        var st = r();
        var status = st < 0.75 ? 'done' : (st < 0.92 ? 'run' : 'draft');
        // 挂池中用户：单人实验一对一挂一位；多用户/舆情挂 2–4 位（群体实验本就覆盖多人）。
        // 必须保证每位已具名用户至少被 1 条实验覆盖 —— 否则用户在池里勾到他，
        // 筛选后得到空表，会以为「这人没数据」而白勾一轮。
        var poolUsers = [];
        if (singleRun) {
          // 单人实验按顺序轮流覆盖前 N 位具名用户，保证覆盖不漏（i 从 0 开始）
          var one = poolNamed[i % poolNamed.length];
          if (one) poolUsers = [one.id];
        } else {
          var k = 2 + Math.floor(r() * 3);
          var used = {};
          for (var j = 0; j < k; j++) {
            var pu = poolNamed[Math.floor(r() * poolNamed.length)];
            if (pu && !used[pu.id]) { used[pu.id] = 1; poolUsers.push(pu.id); }
          }
          // 群体实验额外带上第 i 位与第 i+1 位具名用户，兜住随机漏掉的人
          [i % poolNamed.length, (i + 1) % poolNamed.length].forEach(function (ix) {
            var u2 = poolNamed[ix];
            if (u2 && poolUsers.indexOf(u2.id) === -1 && poolUsers.length < 6) poolUsers.push(u2.id);
          });
        }
        var rec = {
          id: 'sr-' + (i + 1),
          name: names[i % names.length],
          mode: mode.id, modeText: mode.name,
          personaId: p.id, personaName: p.name,
          poolUserIds: poolUsers,
          poolUserText: poolUsers.map(function (uid) {
            var u = poolNamed.filter(function (x) { return x.id === uid; })[0];
            return u ? u.name : uid;
          }).join('、'),
          scheme: '对「' + p.name + '」投放「' + names[i % names.length] + '」' + (mode.id === 'opinion' ? '，观察公开讨论走向' : (mode.id === 'multi' ? '，评估整体转化' : '，观察单用户反应')),
          sample: sample,
          dayOffset: -Math.floor(r() * 14),
          status: status, statusText: status === 'done' ? '已完成' : (status === 'run' ? '运行中' : '草稿')
        };
        if (mode.id === 'opinion') {
          /* 负面占比必须覆盖到高风险档（>0.4），否则「需先降险」分支永远走不到。
           * 按 i 轮转三档基准（低/中/高）再叠加小抖动，保证每档都有样本。 */
          var bandBase = [0.12, 0.28, 0.52][seq % 3];
          var a = Math.max(0.02, Math.min(0.75, bandBase + (r() - 0.5) * 0.1));
          var c = r() * 0.6;
          var neu = c * (1 - a), pos = (1 - a) * (1 - c);
          rec.senti = { pos: +(pos).toFixed(4), neu: +(neu).toFixed(4), neg: +a.toFixed(4) };
          rec.risk = Math.round(a * 100);
        } else {
          // 单人：1 位用户 → 采纳只能是 0/1（逐条回放的结果），不按比例派生
          if (singleRun) {
            rec.adopted = r() < 0.5 ? 1 : 0;
            rec.adoptText = rec.adopted ? '采纳' : '未采纳';
          } else {
            rec.adopted = Math.floor(r() * sample * (0.02 + r() * 0.18));
          }
          // 多用户模式额外给漏斗（确定性派生，单调不增，可与 sim_runs 逐层对账）
          if (mode.id === 'multi') {
            /* 断点位置按 i 轮转（触达流失重 / 互动流失重 / 采纳流失重），
             * 否则最大流失永远落在同一环，「先修这一环」的提示就没有指向意义。 */
            var shape = seq % 3;
            var reachRate = [0.42, 0.72, 0.85][shape];   // 样本→触达
            var engRate = [0.30, 0.55, 0.80][shape];     // 触达→互动
            var adoptRate = [0.12, 0.35, 0.70][shape];   // 互动→采纳
            var reached = Math.floor(sample * reachRate);
            var engaged = Math.max(rec.adopted, Math.floor(reached * engRate));
            rec.funnel = [
              { name: '样本', value: sample },
              { name: '触达', value: reached },
              { name: '互动', value: engaged },
              { name: '采纳', value: rec.adopted }
            ];
            rec.funnelNote = ['触达不足', '互动不足', '采纳转化低'][shape];
          }
        }
        out.push(rec);
      }
      return {
        columns: [
          { key: 'id', label: 'ID', mono: true }, { key: 'name', label: '实验' },
          { key: 'modeText', label: '模式' }, { key: 'personaId', label: 'persona' },
          { key: 'personaName', label: 'persona 名' }, { key: 'sample', label: '样本', align: 'right', fmt: 'int' },
          { key: 'dayOffset', label: '时间', fmt: 'rel' }, { key: 'status', label: '状态' }
        ],
        rows: out
      };
    })();

    /* --- 达人 --- */
    T.kol = {
      columns: [
        { key: 'name', label: '达人', sortable: true },
        { key: 'platformText', label: '平台 / 粉丝' },
        { key: 'authenticity', label: '粉丝真实性', align: 'right', fmt: 'pct0', hint: '基于互动率与粉丝增长曲线异常检测' },
        { key: 'engagement', label: '互动率', sortable: true, align: 'right', fmt: 'pct2' },
        { key: 'overlap', label: '客群重合度', align: 'right', fmt: 'pct0', hint: '与企业目标客群的重合程度' },
        { key: 'deals', label: '合作次数', align: 'right', fmt: 'int' },
        { key: 'roi', label: '历史 ROI', sortable: true, align: 'right', fmt: 'num1' },
        { key: 'risk', label: '风险标记' },
        { key: 'status', label: '状态', fmt: 'status' }
      ],
      rows: [
        { id: 'kol-zhou', name: '科技老周', platformText: '视频 · 86w', authenticity: 0.94, engagement: 0.062, overlap: 0.71, deals: 4, roi: 4.2, risk: '—', status: 'ok', statusText: '合作中' },
        { id: 'kol-lin', name: '小林聊数码', platformText: '短视频 · 120w', authenticity: 0.88, engagement: 0.054, overlap: 0.64, deals: 2, roi: 3.8, risk: '—', status: 'ok', statusText: '合作中' },
        { id: 'kol-zhi', name: '职场指南针', platformText: '图文 · 45w', authenticity: 0.96, engagement: 0.081, overlap: 0.58, deals: 0, roi: null, risk: '—', status: 'info', statusText: '洽谈中' },
        { id: 'kol-zhe', name: '阿哲的日常', platformText: '短视频 · 68w', authenticity: 0.61, engagement: 0.019, overlap: 0.33, deals: 1, roi: 2.9, risk: '⚠ 粉丝增长异常', status: 'bad', statusText: '已结束' },
        { id: 'kol-mei', name: '美妆研究所', platformText: '短视频 · 210w', authenticity: 0.91, engagement: 0.047, overlap: 0.22, deals: 0, roi: null, risk: '客群重合度低', status: 'idle', statusText: '不推荐' }
      ]
    };

    return T;
  }

  /* SECTION: queues
   * 审核处置类队列：合规复核、审批、经验复核。
   * 队列项带等待时长与风险级别，用于排序与超时标红。
   */
  function buildQueues() {
    var Q = {};
    var r = R.of('queues-v1');

    Q.compliance = {
      title: '待复核内容',
      emptyText: '没有待复核内容，规则拦截全部自动放行',
      columns: ['级别', '内容摘要', '命中规则', '来源 Agent', '等待时长', '操作'],
      items: [
        { id: 'cp-1', level: 'P0', levelKind: 'bad', summary: '「本产品是全网最佳选择，国家级技术认证」', rule: '敏感表述-广告法 §3.2 绝对化用语', agentId: 'ag-ops-copy', agentName: '营销文案 Agent', waitMin: 14, traceId: null, action: 'pass|reject|escalate' },
        { id: 'cp-2', level: 'P1', levelKind: 'warn', summary: '「保证 100% 通过审批，无需担心合规问题」', rule: '敏感表述-承诺类 §1.4', agentId: 'ag-legal-comp', agentName: '合规问答 Agent', waitMin: 42, traceId: null, action: 'pass|reject|escalate' },
        { id: 'cp-3', level: 'P2', levelKind: 'info', summary: '客户名单片段（含手机号）出现在生成结果中', rule: '数据出境校验 §2.1 PII 泄露', agentId: 'ag-cs-refund', agentName: '客服助手 Agent', waitMin: 88, traceId: null, action: 'pass|reject|escalate' },
        { id: 'cp-4', level: 'P2', levelKind: 'info', summary: '「建议直接跳过内部评审流程」', rule: '流程合规 §4.3', agentId: 'ag-sales-bid', agentName: '标书生成 Agent', waitMin: 126, traceId: null, action: 'pass|reject|escalate' },
        { id: 'cp-5', level: 'P2', levelKind: 'info', summary: 'AI 访谈外发话术未携带生成式 AI 标识', rule: '生成式内容标识 §1.2', agentId: 'ag-ops-copy', agentName: '营销文案 Agent', waitMin: 56, traceId: null, action: 'pass|reject|escalate' }
      ]
    };

    Q.approval = {
      title: '审批队列',
      emptyText: '没有待处理的审批',
      columns: ['等级', '单据', '申请人', '影响面', '等待时长', '操作'],
      items: [
        /* grantLine：「这一单批下去会造出什么」—— 一行能读完的授权预览。
           审批人判断的不是"这张单该不该批"，是"这条授权该不该存在"；
           impact 是描述（读不出量级），grantLine 是那件事本身（谁 · 什么动作 · 多大范围 · 多久）。 */
        { id: 'ap-1', level: 'P1', levelKind: 'warn', title: 'Agent「合同初审」v1.5 全量发布', applicant: '—', impact: '日均 260 次调用 · 影响 2 个下游引用方 · 成本 +¥86/日', grantLine: '合同初审 Agent · 全量发布 v1.5 · 长期', waitMin: 96, slaMin: 240, type: 'agent-publish', targetId: 'ag-legal-ctr' },
        { id: 'ap-2', level: 'P0', levelKind: 'bad', title: 'MCP 服务 mcp://order/detail 对外开放', applicant: '—', impact: '外部可调用 · 涉及订单数据 · 需数据安全评估', grantLine: '外部调用方 · 调用 order/detail · 订单数据 · 90 天', waitMin: 210, slaMin: 180, type: 'mcp-open', targetId: 'mcp-order' },
        { id: 'ap-3', level: 'P2', levelKind: 'info', title: '画像库字段变更：新增「年采购额」', applicant: '—', impact: '影响 7 个引用方 · 需回填 428 家企业', grantLine: '画像库 · 新增「年采购额」字段 · 7 个引用方', waitMin: 34, slaMin: 480, type: 'persona-change', targetId: 'ps-mfg' },
        { id: 'ap-4', level: 'P1', levelKind: 'warn', title: '合规规则包 v13 发布（新增广告法表述）', applicant: '—', impact: '灰度 10% 期间误报率 3.2%，高于阈值 2%', grantLine: '规则包 v13 · 全量生效 · 新增广告法表述', waitMin: 402, slaMin: 240, type: 'rule-publish', targetId: null },
        { id: 'ap-5', level: 'P2', levelKind: 'info', title: '沙盒 sbx-doc-parse 放开网络白名单', applicant: '—', impact: '新增 2 个域名 · 影响法务线文档解析', grantLine: 'sbx-doc-parse · 新增 2 个域名出网 · 90 天', waitMin: 58, slaMin: 480, type: 'sandbox-net', targetId: 'sbx-doc' },
        { id: 'ap-done-1', level: 'P2', levelKind: 'ok', title: '提示词模板批量更新', applicant: '—', impact: '影响面过大（涉及 12 个 Agent），需拆分提交', waitMin: -1440, slaMin: 240, type: 'prompt-batch', targetId: null, decided: 'rejected', decidedBy: '—', decidedAt: -1440, reason: '影响面过大且未提供回归测试结果，请拆分为单 Agent 提交', mine: true, decidedDays: -1, handledMin: 420 },
        { id: 'ap-done-2', level: 'P3', levelKind: 'ok', title: '知识库「销售话术库」同步频率调整', applicant: '—', impact: '同步频率 每日 → 每 6 小时', waitMin: -2880, slaMin: 480, type: 'kb-sync', targetId: 'kb-script', decided: 'approved', decidedBy: '—', decidedAt: -2760, reason: '同意，注意同步任务对网关的压力', mine: true, decidedDays: -2, handledMin: 300 },
        { id: 'ap-mine-1', level: 'P2', levelKind: 'info', title: '经验库登记「交付风险预警清单」复核申请', applicant: '—', impact: '申请将待复核经验 ex-3 复核后转入正式库 · 供标书/摘要 Agent 检索复用', waitMin: 26, slaMin: 480, type: 'exp-review', targetId: 'ex-3', mine: true, approver: '—' }
      ],
      // 授权规则（配置态）：启用数 + 停用数 = 总数（可对账）
      authRules: [
        { id: 'ar-1', subject: '销售组', agentCap: '客服助手 Agent', action: '读取', scope: '订单库', cond: '工作时间 09:00-21:00', risk: '低', status: 'on', statusText: '启用' },
        { id: 'ar-2', subject: '销售组', agentCap: '客服助手 Agent', action: '回复', scope: '订单 + 售后案例库', cond: '需在会话上下文内', risk: '中', status: 'on', statusText: '启用' },
        { id: 'ar-3', subject: '—', agentCap: '标书生成 Agent', action: '生成', scope: '客户名单 + 方案库', cond: '高风险：须写明数据用途与范围，越权调用由网关拦截', risk: '高', status: 'on', statusText: '启用' },
        { id: 'ar-4', subject: '合规组', agentCap: '合规问答 Agent', action: '判定', scope: '规则包库', cond: '仅已发布规则', risk: '中', status: 'on', statusText: '启用' },
        { id: 'ar-5', subject: '运营组', agentCap: '用户运营策略', action: '触达', scope: '圈人分群', cond: '免打扰时段 22:00-08:00 禁发', risk: '高', status: 'on', statusText: '启用' },
        { id: 'ar-6', subject: '法务组', agentCap: '合同初审 Agent', action: '生成', scope: '合同库', cond: '草案仅只读输出', risk: '中', status: 'off', statusText: '停用' },
        { id: 'ar-7', subject: '任何角色', agentCap: 'MCP 服务', action: '调用', scope: 'mcp://order/detail', cond: '禁止（灰度待评估）', risk: '高', status: 'off', statusText: '停用' },
        { id: 'ar-8', subject: '数据分析师', agentCap: '知识问答 Agent', action: '检索', scope: '产品文档库', cond: '无', risk: '低', status: 'on', statusText: '启用' },
        { id: 'ar-9', subject: '运营组', agentCap: 'AI 访谈作业台', action: '触达', scope: '访谈名单', cond: '免打扰时段 22:00-08:00 禁发 · 外发话术须含 AIGC 标识', risk: '高', status: 'on', statusText: '启用' }
      ],
      // 安全事件（近 14 天，确定性派生）：Σkind = 总数；待处置 = result 计数
      secEvents: (function () {
        var r = S.R.of('approval-sec-v1');
        var kinds = [
          { k: 'overreach', name: '越权尝试', level: 'P0', actions: ['导出客户名单', '读取他组订单', '调用未授权 MCP'] },
          { k: 'danger', name: '危险操作', level: 'P1', actions: ['批量删除知识条目', '放开沙盒网络白名单', '全量发布未评估版本'] },
          { k: 'blocked', name: '拦截记录', level: 'P2', actions: ['高频调用触发限流', '输出含 PII 被阻断'] },
          { k: 'abnormal', name: '异常审批', level: 'P1', actions: ['审批链缺失签名', 'SLA 超时未处理'] }
        ];
        var actors = ['xianyu', '系统'];
        var n = 12, out = [];
        for (var i = 0; i < n; i++) {
          var k = kinds[Math.floor(r() * kinds.length)];
          var res = r();
          out.push({
            id: 'se-' + (i + 1),
            dayOffset: -Math.floor(r() * 14),
            actor: actors[Math.floor(r() * actors.length)],
            action: k.actions[Math.floor(r() * k.actions.length)],
            target: 'approval 审批链',
            kind: k.k, kindText: k.name, level: k.level,
            result: res < 0.5 ? '待处置' : (res < 0.85 ? '已阻断' : '已处置'),
            impact: 1 + Math.floor(r() * 30)
          });
        }
        return out;
      })()
    };

    /* 经验条目（配置态）。
     * 字段对齐生产规格 §2.3 与「LLM经验库-前后端设计」：
     *   scope/ownerAgent  ← experience_agent（单 Agent 私有 / 多 Agent 共享）
     *   trigger/policy/taboo/example ← 经验正文四段（结构化才能既被模型检索、又被人评审）
     *   evidence.support/contradict/supplement ← 硬约束「经验与证据不得一对一」
     *   versions/gray ← experience_version（版本与灰度）
     *   feedback ← experience_feedback（反向反馈是第二条淘汰依据）
     *   badcases ← 可回溯的原始案例
     *   usageRecent/lastUsedDay ← experience_usage（谁在什么时候用过、有没有被采纳）
     */
    Q.experience = {
      title: '经验条目',
      emptyText: '没有经验条目',
      columns: ['经验', '适用场景', '来源', '归属', '被检索', '命中率', '收益分', '最近使用', '状态'],
      items: [
        { id: 'ex-1', title: '价格异议应对话术', scene: '售前议价 / 报价被质疑', source: '人工录入',
          scope: 'private', ownerAgent: 'ag-cs-pre', agents: ['ag-cs-pre'],
          searches: 214, hitRate: 0.92, gain: 6.2, status: 'ok', statusText: '已验证', reviewer: '—',
          gainTrend: [3.1, 3.8, 4.5, 5.0, 5.3, 5.8, 6.0, 6.2],
          lastUsedDay: -1,
          trigger: '客户在收到报价后 24 小时内提出「太贵 / 别家更低 / 能不能再优惠」。',
          policy: '先确认客户比对的方案配置与预算区间，再用交期、质保、账期三处配置差异回应；给限时方案但不直接降价，把锚点放在总持有成本上。',
          taboo: '不得承诺「全网最低价」；不得在首轮报价主动让价；客户没说清比对对象时不主动解释差异。',
          example: [
            { q: '你们比别家贵了 12%，能给个底价吗？',
              a: '先跟您确认一下：您比对的是同配置、含 3 年上门服务的方案吗？我们的报价里包含……（列配置差异），如果按同样口径折算，差距是……' }
          ],
          badcases: [],
          evidence: { support: 18, contradict: 3, supplement: 7 },
          feedback: { up: 42, down: 3, wrong: 1 },
          versions: [
            { v: 'v3', day: -12, note: '补「总持有成本」锚点，删掉直接让价话术', state: '线上' },
            { v: 'v2', day: -40, note: '加入首轮不让价的约束', state: '已归档' },
            { v: 'v1', day: -95, note: '初版，来自售前 badcase 提炼', state: '已归档' }
          ],
          gray: null,
          ab: { control: 0.312, treat: 0.387, sample: 1240, p: 0.008 },
          conflicts: [{ withId: 'ex-5', point: '话术里的「限时优惠」属于诱导性表述，与合规替换表的规则冲突 —— 对外发送前需按替换表改写' }],
          usageRecent: [
            { day: -1, agentId: 'ag-cs-pre', adopted: true },
            { day: -2, agentId: 'ag-cs-pre', adopted: true },
            { day: -4, agentId: 'ag-cs-pre', adopted: false }
          ] },
        { id: 'ex-2', title: '技术方案框架模板', scene: '标书撰写 / 方案设计', source: '人工录入',
          scope: 'shared', ownerAgent: null, agents: ['ag-sales-bid', 'ag-legal-ctr'],
          searches: 186, hitRate: 0.88, gain: 5.4, status: 'ok', statusText: '已验证', reviewer: '—',
          gainTrend: [4.2, 4.4, 4.6, 4.9, 5.0, 5.2, 5.3, 5.4],
          lastUsedDay: -3,
          trigger: '需要输出面向客户的技术方案正文或标书技术标章节。',
          policy: '按「现状与痛点 → 方案架构 → 实施路径 → 交付与验收 → 报价口径」五段写，每段先给结论再给论据。',
          taboo: '不得出现未经确认的性能指标承诺；不得引用尚未发布的产品路线图。',
          example: [
            { q: '帮我起一版××项目的技术标章节框架。',
              a: '按五段结构来：①现状与痛点是招标文件里的三条硬约束……②方案架构对齐这三条……（逐段给结论句）' }
          ],
          badcases: [],
          evidence: { support: 12, contradict: 2, supplement: 5 },
          feedback: { up: 28, down: 1, wrong: 2 },
          versions: [
            { v: 'v2', day: -33, note: '新增「报价口径」段，避免商务与技术脱节', state: '线上' },
            { v: 'v1', day: -150, note: '初版四段结构', state: '已归档' }
          ],
          gray: null,
          ab: { control: 0.44, treat: 0.472, sample: 380, p: 0.061 },
          conflicts: [],
          usageRecent: [
            { day: -3, agentId: 'ag-sales-bid', adopted: true },
            { day: -6, agentId: 'ag-legal-ctr', adopted: false },
            { day: -8, agentId: 'ag-sales-bid', adopted: true }
          ] },
        { id: 'ex-3', title: '交付风险预警清单', scene: '项目交付 / 排期评估', source: 'badcase 提炼',
          scope: 'private', ownerAgent: 'ag-sales-bid', agents: ['ag-sales-bid'],
          searches: 97, hitRate: 0.81, gain: 3.8, status: 'warn', statusText: '待复核', reviewer: null,
          gainTrend: [5.6, 5.4, 5.1, 4.8, 4.5, 4.2, 4.0, 3.8],
          lastUsedDay: -9,
          trigger: '项目排期评审、交付前评估，或客户对交付时间提出书面确认要求时。',
          policy: '按「依赖外部接口 / 客户侧数据未就绪 / 双方人力重叠」三类逐项打标，每项给出触发信号与预案，排期结论必须写清依据哪几条。',
          taboo: '不得把风险清单原文直接发给客户（内部先定处置口径）。',
          example: [
            { q: '这个项目下个月能上线吗？',
              a: '先看三条前置依赖……（逐条给信号与预案），在第二条未关闭前，只能承诺××节点。' }
          ],
          badcases: [
            { id: 'bc-71', agentId: 'ag-sales-bid', reason: '知识缺失', day: -9, title: '投标文件漏掉交付里程碑，客户质询后排期重议' }
          ],
          evidence: { support: 6, contradict: 4, supplement: 3 },
          feedback: { up: 11, down: 6, wrong: 5 },
          versions: [
            { v: 'v1', day: -58, note: '由「交付延期」类 badcase 提炼，未经复核', state: '草稿' }
          ],
          gray: null,
          ab: { control: 0.51, treat: 0.478, sample: 210, p: 0.14 },
          conflicts: [],
          usageRecent: [
            { day: -9, agentId: 'ag-sales-bid', adopted: false },
            { day: -15, agentId: 'ag-sales-bid', adopted: false }
          ] },
        { id: 'ex-4', title: '关键客户跟进节奏', scene: '客户运营 / 商机推进', source: 'badcase 提炼',
          scope: 'private', ownerAgent: 'ag-sales-lead', agents: ['ag-sales-lead'],
          searches: 64, hitRate: 0.76, gain: 4.1, status: 'ok', statusText: '已验证', reviewer: '—',
          gainTrend: [2.8, 3.0, 3.3, 3.5, 3.8, 3.9, 4.0, 4.1],
          lastUsedDay: -4,
          trigger: '商机进入「方案确认」之后的客户，且决策链上有两个以上角色。',
          policy: '按角色分层触达：决策人 7 天一次、执行层 3 天一次；每次触达必须带新信息（进展、案例、数据），不带新信息就不发。',
          taboo: '不得连续两次追问同一问题；不得在下一个交付节点之前催单。',
          example: [
            { q: '客户三天没回了，要不要再催一下？',
              a: '先看上次触达带的是新信息还是纯催促……如果是纯催促，换成一条进展同步再发。' }
          ],
          badcases: [
            { id: 'bc-72', agentId: 'ag-sales-lead', reason: '理解偏差', day: -16, title: '连续三次追问同一问题，客户明确表达反感' }
          ],
          evidence: { support: 9, contradict: 1, supplement: 4 },
          feedback: { up: 19, down: 2, wrong: 1 },
          versions: [
            { v: 'v2', day: -25, note: '加入「不带新信息就不发」的约束', state: '线上' },
            { v: 'v1', day: -88, note: '初版触达频率表', state: '已归档' }
          ],
          gray: null,
          ab: { control: 0.28, treat: 0.301, sample: 860, p: 0.033 },
          conflicts: [],
          usageRecent: [
            { day: -4, agentId: 'ag-sales-lead', adopted: true },
            { day: -11, agentId: 'ag-sales-lead', adopted: false }
          ] },
        { id: 'ex-5', title: '合规边界表述替换表', scene: '文案生成 / 对外话术', source: '自进化产出',
          scope: 'shared', ownerAgent: null, agents: ['ag-ops-copy', 'ag-legal-comp'],
          searches: 42, hitRate: 0.94, gain: 7.1, status: 'info', statusText: '灰度 10%', reviewer: null,
          gainTrend: [1.8, 2.5, 3.2, 4.0, 4.9, 5.8, 6.6, 7.1],
          lastUsedDay: -1,
          trigger: '生成任何对外文案、宣传物料或销售话术时。',
          policy: '把绝对化与诱导性表述按替换表逐条换成可验证表述（例：「全网最低」→「同口径下具备价格竞争力」）。',
          taboo: '不得使用「第一 / 最 / 100% / 保证收益」；不得用限时制造紧迫感诱导下单。',
          example: [
            { q: '帮我写一条促销文案，强调价格最低。',
              a: '「最低」会触发绝对化用语，替换为「同配置下报价更具竞争力」，并补上可比口径说明。' }
          ],
          badcases: [],
          evidence: { support: 7, contradict: 0, supplement: 2 },
          feedback: { up: 9, down: 0, wrong: 0 },
          versions: [
            { v: 'v2', day: -6, note: '灰度 10%：新增「限时/紧迫感」类替换项', state: '灰度中' },
            { v: 'v1', day: -47, note: '初版，覆盖 32 条替换规则', state: '灰度中' }
          ],
          gray: 10,
          ab: { control: 0.52, treat: 0.548, sample: 120, p: 0.22 },
          conflicts: [{ withId: 'ex-1', point: '价格话术里的「限时优惠」与替换表的诱导性表述规则直接冲突，两条同时命中时以本条为准' }],
          usageRecent: [
            { day: -1, agentId: 'ag-ops-copy', adopted: true },
            { day: -2, agentId: 'ag-legal-comp', adopted: true }
          ] },
        { id: 'ex-6', title: '退货政策口径统一', scene: '客服应答 / 政策解释', source: '自进化产出',
          scope: 'private', ownerAgent: 'ag-cs-refund', agents: ['ag-cs-refund'],
          searches: 18, hitRate: 0.61, gain: 1.2, status: 'warn', statusText: '待复核', reviewer: null,
          gainTrend: [0.8, 0.9, 1.0, 0.9, 1.1, 1.0, 1.1, 1.2],
          lastUsedDay: -46,
          trigger: '客户咨询退货、换货或退款到账时间时。',
          policy: '统一按「7 天无理由（未拆封）→ 15 天质量问题换货 → 退款 3-5 个工作日」回答，并说明需要客户提供的凭证。',
          taboo: '不得承诺加急退款；不得向客户解释内部审批流程。',
          example: [
            { q: '多久能退到钱？',
              a: '资料齐全后 3-5 个工作日到账，具体到账时间以银行为准（不承诺加急）。' }
          ],
          badcases: [
            { id: 'bc-73', agentId: 'ag-cs-refund', reason: '幻觉', day: -5, title: '承诺「24 小时内退款」与政策不符，产生客诉' },
            { id: 'bc-74', agentId: 'ag-cs-refund', reason: '合规误杀', day: -21, title: '把正常换货请求判为超期' }
          ],
          evidence: { support: 2, contradict: 5, supplement: 1 },
          feedback: { up: 5, down: 9, wrong: 6 },
          versions: [
            { v: 'v1', day: -74, note: '自进化产出，未经复核直接进池（口径与最新政策不一致）', state: '草稿' }
          ],
          gray: null,
          ab: { control: 0.36, treat: 0.341, sample: 90, p: 0.71 },
          conflicts: [],
          usageRecent: [
            { day: -46, agentId: 'ag-cs-refund', adopted: false }
          ] }
      ]
    };

    Q.badcase = {
      title: 'badcase 队列',
      emptyText: '没有待处理 badcase',
      columns: ['级别', '所属 Agent', '失败原因', '来源', '等待时长', '状态'],
      items: (function () {
        // 从真实失败 trace 中抽样生成，保证 badcase 能下钻到 trace
        var out = [], reasons = ['幻觉', '工具调用错', '理解偏差', '知识缺失', '合规误杀'];
        var sources = ['用户踩', '评估发现', '合规拦截', '人工上报'];
        var sev = [{ k: 'P0', kind: 'bad' }, { k: 'P1', kind: 'warn' }, { k: 'P2', kind: 'info' }];
        for (var i = 0; i < 12; i++) {
          var a = S.AGENTS[i % S.AGENTS.length];
          if (a.retiredAt !== undefined) continue;
          var sv = sev[Math.floor(r() * sev.length)];
          out.push({
            id: 'bc-' + (i + 1), level: sv.k, levelKind: sv.kind,
            agentId: a.id, agentName: a.name,
            reason: reasons[Math.floor(r() * reasons.length)],
            source: sources[Math.floor(r() * sources.length)],
            waitMin: Math.round(20 + r() * 2600),
            status: i % 4 === 0 ? 'warn' : 'info',
            statusText: i % 4 === 0 ? '待认领' : '处理中',
            owner: i % 4 === 0 ? null : S.OWNERS[i % S.OWNERS.length].name,
            expectOutput: '应给出明确的政策依据与操作路径，而非泛泛安抚'
          });
        }
        return out;
      })()
    };

    return Q;
  }

  /* SECTION: pipelines
   * 流水线型能力：用户运营、自进化。
   * 阶段带真实数据支撑（人数、样本数、指标对比）。
   */
  function buildPipelines() {
    var P = {};

    /* 独立站客单价（USD）—— site 与 social 两个区块共用，只在这里定义一次。
       社媒「带动成交」与搜索「带动成交」都靠它把订单折成金额，
       两处各写一个 38.4 迟早会改漏一处，出现"社媒成交额对不上 GMV 占比"。 */
    var UO_AOV = 38.4;

    // 用户池 / 生命周期 / 分群：确定性派生，保证可对账 ——
    // Σ(阶段人数) === pool；每个分群 cover ≤ pool；trend 末点 === round(cover * actRate)
    var _lc = (function () {
      var r = S.R.of('userops-lc-v1');
      var pool = Math.round(400000 + r() * 250000);
      var defs = [
        { id: 'new', name: '新客', note: '注册 ≤ 30 天', baseW: 0.16, lost: [0.004, 0.02] },
        { id: 'active', name: '活跃', note: '近 30 天有活跃', baseW: 0.42, lost: [0.01, 0.04] },
        { id: 'lapsing', name: '预流失', note: '活跃度连续下降', baseW: 0.14, lost: [0.06, 0.15] },
        { id: 'silent', name: '沉默', note: '近 60 天无活跃', baseW: 0.18, lost: [0.03, 0.08] },
        { id: 'lost', name: '已流失', note: '近 90 天无活跃', baseW: 0.10, lost: [0, 0] }
      ];
      var ws = defs.map(function (d) { return d.baseW * (0.7 + r() * 0.6); });
      var wsum = ws.reduce(function (a, b) { return a + b; }, 0);
      var counts = ws.map(function (w) { return Math.floor(pool * w / wsum); });
      counts[0] = pool - counts.slice(1).reduce(function (a, b) { return a + b; }, 0);
      var stages = defs.map(function (d, i) {
        return {
          id: d.id, name: d.name, note: d.note,
          count: counts[i], share: +(counts[i] / pool).toFixed(4),
          lost30: d.lost[1] > 0 ? +(d.lost[0] + r() * (d.lost[1] - d.lost[0])).toFixed(4) : null
        };
      });
      return { pool: pool, stages: stages };
    })();

    P.userops = {
      title: '运营策略',
      pool: _lc.pool,
      lifecycle: { stages: _lc.stages },
      segments: (function () {
        var r = S.R.of('userops-seg-v1');
        /* v20：coverShare 显式定义 —— 此前随机 0.02–0.30，出现「VIP 续费池占 23%」这类失真，
           且与策略圈人数对不上（uo-1 圈 42,860 vs sg-2 覆盖 23,602）。
           sg-2 的 coverShare 精确对齐 uo-1 圈人 42,860；sg-5 = 60 天内到期的 VIP 联系人体量。
           value/risk（1–3）驱动「该打哪群人」排序：高价值 × 高风险优先，而非覆盖 × 活跃
           （行业口径：最活跃的人群不缺触达，该优先打"会走的"和"值钱的"）。 */
        var defs = [
          { id: 'sg-1', name: '高客单企业决策人', conds: ['年采购额 > 500万', '职位：决策层', '私有化意向'], coverShare: 0.048, value: 3, risk: 1, why: '高客单决策人 · 低流失风险，适合培育与扩展', actRange: [0.5, 0.7] },
          { id: 'sg-2', name: '沉睡可唤醒', conds: ['近 90 天无访问', '历史客单 > 500', '未退订'], coverShare: 0.070708, value: 2, risk: 2, why: '沉睡可唤醒 · 有历史价值，唤醒窗口随时间收窄', actRange: [0.45, 0.6] },
          { id: 'sg-3', name: '价格敏感新客', conds: ['注册 ≤ 30 天', '比价行为 ≥ 3 次'], coverShare: 0.065, value: 1, risk: 1, why: '价格敏感新客 · 量大但价值待验证，不建议优先打扰', actRange: [0.55, 0.75] },
          { id: 'sg-4', name: '高流失风险', conds: ['活跃度连续下降', '近 60 天登录 < 2 次'], coverShare: 0.11, value: 2, risk: 3, why: '高流失风险 · 活跃度持续下滑，须尽快干预', actRange: [0.25, 0.45] },
          { id: 'sg-5', name: 'VIP 续费池', conds: ['年采购额 > 1000万', '合同到期 ≤ 60 天'], coverShare: 0.03, value: 3, risk: 3, why: 'VIP 续费池 · 合同即将到期，直接影响收入', actRange: [0.55, 0.85] }
        ];
        /* 子集关系（严格的圈选条件包含）——决定活跃率的下限。
           sg-5 的「年采购额 > 1000万」是 sg-1「> 500万」的子集：
           筛选条件更严，人群不可能反而更不活跃。
           此前 actRate 是各群**独立随机**（0.45 + r()*0.47），实测出现
           sg-5 = 65.0% 而 sg-1 = 65.7% —— 子集比父集低，逻辑上说不通。
           与上面 coverShare 的处理同一原则：能推出约束的字段就不交给随机。
           两趟：先给每群抽一个基准活跃率，再把子集抬到不低于其父集。 */
        var SUBSET_OF = { 'sg-5': 'sg-1' };
        var baseRate = {};
        /* 每群先落在自己的合理区间 —— 活跃率必须与圈选条件自洽：
           否则会出现「近 60 天登录 < 2 次」的高流失风险群活跃率 86%（实测踩过）。
           区间依据各自的 conds 定，不是随手写的。 */
        defs.forEach(function (d) {
          var rg = d.actRange || [0.45, 0.92];
          baseRate[d.id] = +(rg[0] + r() * (rg[1] - rg[0])).toFixed(3);
        });
        /* 再把子集抬到不低于其父集的下限，同时不越过自己的上限 */
        defs.forEach(function (d) {
          var pid = SUBSET_OF[d.id];
          if (!pid) return;
          var rg = d.actRange || [0.45, 0.92];
          var lo = Math.max(rg[0], baseRate[pid]);
          if (baseRate[d.id] < lo) baseRate[d.id] = +Math.min(rg[1], lo + r() * 0.05).toFixed(3);
        });
        return defs.map(function (d) {
          var cover = Math.round(_lc.pool * d.coverShare);
          var actRate = baseRate[d.id];
          var end = Math.max(1, Math.round(cover * actRate));
          var trend = [];
          for (var k = 0; k < 7; k++) {
            trend.push(Math.max(1, Math.round(end * (0.58 + k * 0.07) + (r() - 0.5) * end * 0.18)));
          }
          trend[6] = end;
          return {
            id: d.id, name: d.name, conds: d.conds,
            cover: cover, coverShare: +(cover / _lc.pool).toFixed(4),
            actRate: actRate, trend: trend,
            value: d.value, risk: d.risk, why: d.why,
            refPipes: 0  /* v20：构建后由策略 segId 真实回填，不再随机 */
          };
        });
      })(),
      feedback: (function () {
        var r = S.R.of('userops-fb-v1');
        var kinds = [
          { k: 'nps', name: 'NPS 低分', channels: ['NPS 季度调研'], summaries: ['调研评分 1/5：售前方案太泛', 'NPS 1 分：回复慢，等待 4 小时', '调研反馈：功能找不到入口'] },
          { k: 'complaint', name: '投诉', channels: ['400 工单', '客服会话'], summaries: ['投诉：推送频次过高，一天 3 条短信', '400 投诉：账单金额与预估不符', '投诉：客服答复与政策不一致'] },
          { k: 'satisfaction', name: '满意度差评', channels: ['会话后评价'], summaries: ['会话差评：答非所问，未解决退货问题', '差评：多轮追问后仍给不出依据', '会话后 1 星：语气机械'] },
          { k: 'unsub', name: '退订', channels: ['退订页'], summaries: ['退订：不需要此类营销', '退订：内容与实际不相关', '退订：频控后仍频繁'] },
          /* v20：行业标配 opt-down —— 退订是全有或全无，偏好中心先给降频/换渠道出口，每强制一次选择就永久丢一个用户 */
          { k: 'optdown', name: '申请降频', channels: ['偏好中心', '退订页'], summaries: ['申请降频：内容可以，一周别超 1 条', '偏好设置：只收账单类，停推广', '换渠道：短信太吵，改站内信'] },
          { k: 'bug', name: '产品缺陷', channels: ['工单', '客服会话'], summaries: ['反馈：导出报表 Excel 打不开', '反馈：筛选条件刷新后丢失', '工单：画像标签无法多选'] }
        ];
        var related = ['双十一预热·沉睡客户唤醒', '企业客户续费提醒', '新客首单优惠推送', '客服助手 Agent', '知识问答 Agent'];
        var n = 16, items = [];
        /* 2026-10-20 走查修复：summary 原来是独立随机抽，同类会抽到同一条 ——
           列表里出现两条一模一样的「工单：画像标签无法多选」，一眼看出是假数据。
           改成同类内按序号轮转（抽完一遍再从头发），同类条目必然互不相同。 */
        var _sumIdx = {};
        for (var i = 0; i < n; i++) {
          var k = kinds[Math.floor(r() * kinds.length)];
          var st = r();
          var status = st < 0.5 ? 'open' : (st < 0.75 ? 'wip' : 'done');
          var _si = (_sumIdx[k.k] = (_sumIdx[k.k] == null ? 0 : _sumIdx[k.k] + 1));
          items.push({
            id: 'fb-' + (i + 1),
            kind: k.k, kindText: k.name,
            summary: k.summaries[_si % k.summaries.length],
            channel: k.channels[Math.floor(r() * k.channels.length)],
            related: related[Math.floor(r() * related.length)],
            dayOffset: -Math.floor(r() * 7),
            impact: 1 + Math.floor(r() * 40),
            status: status,
            statusText: status === 'open' ? '待处理' : (status === 'wip' ? '处理中' : '已处理')
          });
        }
        return { items: items };
      })(),
      items: [
        {
          /* v20 对账修正：净人群 = 42,860 − 9,666 = 33,194；holdout = 净人群 5% = 1,660；
             实验组（全量）= 33,194 − 1,660 = 31,534。此前实验组 38,214 超过净人群上限，属超发。 */
          id: 'uo-1', name: '双十一预热·沉睡客户唤醒', status: 'running', statusText: '全量投放中', bizText: '运营线',
          segId: 'sg-2', segName: '沉睡可唤醒',
          stages: [
            { id: 'targeting', name: '圈人', state: 'done', detail: '条件：近90天无访问 ∧ 历史客单>500 ∧ 未退订（对应分群「沉睡可唤醒」）', count: 42860, excluded: { freq: 3120, unsub: 892, blacklist: 14, inOther: 5640 }, snapshotAt: -2, health: { green: 26254, yellow: 10286, red: 6320 } },
            { id: 'strategy', name: '策略生成', state: 'done', detail: 'AI 产出 12 套文案 × 3 渠道 × 2 时段 = 34 条候选，人工选定 6 条', count: 6, compliance: 'passed' },
            { id: 'reach', name: '触达执行', state: 'active', detail: '短信 60% / Push 30% / 站内信 10%，灰度已完成，当前全量；实验组 31534 已触达，对照组 holdout 1660（净人群 5% 独立抽取）', count: 31534, sent: 31534, delivered: 31028, holdout: 1660, grayRatio: 1 },
            { id: 'attribution', name: '效果回收', state: 'wait', detail: '归因窗口 7 天点击归因，将于 3 天后关闭', count: null }
          ],
          result: {
            window: '7d 点击归因', sampleExp: 31534, sampleCtrl: 1660,
            convExp: 0.0486, convCtrl: 0.0312, lift: 0.5577,
            // 显著性由页面按 twoPropTest 即时推导，不存可复算值
            negative: { unsubRate: 0.0042, complaintRate: 0.0006, blockRate: 0.0011, unsubRatePrev: 0.0031, unsubAlert: 0.008 },
            funnel: [
              { name: '触达', value: 31534 }, { name: '送达', value: 31028 },
              { name: '打开', value: 10595 }, { name: '点击', value: 3479 },
              { name: '转化', value: 1533 }, { name: '复购', value: 282 }
            ]
          }
        },
        {
          /* v20 对账修正：圈人对齐分群 sg-5（VIP 联系人 18,185 × 60 天到期占 16.4% ≈ 2,982）；
             净人群 = 2,982 − 656 = 2,326；holdout = 净 5% = 116；灰度 10% 按剔除 holdout 后 2,210 计 = 221。
             此前 holdout 64 / 实验 128 均按未排除的 1,284 计算，口径混用。
             续费按 B2B 行业口径补齐：健康分（绿/黄/红）+ T-90/60/30 节奏 + 按决策角色分三套文案。 */
          id: 'uo-2', name: '企业客户续费提醒', status: 'gray', statusText: '灰度 10%', bizText: '销售线',
          segId: 'sg-5', segName: 'VIP 续费池',
          stages: [
            { id: 'targeting', name: '圈人', state: 'done', detail: '条件：合同到期前 60 天 ∧ 年采购额>1000万（对应分群「VIP 续费池」）', count: 2982, excluded: { freq: 300, unsub: 40, blacklist: 4, inOther: 312 }, snapshotAt: -1, health: { green: 1908, yellow: 746, red: 328 } },
            { id: 'strategy', name: '策略生成', state: 'done', detail: '健康分驱动：绿 64% 常规提醒 / 黄 25% 人工跟进 / 红 11% 优先人工介入；续费节奏 T-90 需求确认 → T-60 方案对齐（当前）→ T-30 商务谈判；文案按角色分三套（CFO·ROI / 使用方·功能 / 采购·条款），已过合规', count: 3, compliance: 'passed' },
            { id: 'reach', name: '触达执行', state: 'active', detail: '灰度 10% 观察中（' + (window.DECISIONS ? DECISIONS.value('灰度', '最小观察期') : 60) + '）；实验组 221 已触达，对照组 holdout 116（净人群 5% 独立抽取；灰度按剔除 holdout 后的 2,210 人计）', count: 221, sent: 221, delivered: 218, holdout: 116, grayRatio: 0.10 },
            { id: 'attribution', name: '效果回收', state: 'wait', detail: '归因窗口 30 天（续费周期长）', count: null }
          ],
          result: {
            window: '30d 续费归因（进行中）', sampleExp: 221, sampleCtrl: 116,
            convExp: 0.1875, convCtrl: 0.1406, lift: 0.3335,
            // 显著性由页面按 twoPropTest 即时推导，不存可复算值
            negative: { unsubRate: 0.0045, complaintRate: 0, blockRate: 0, unsubRatePrev: null, unsubAlert: 0.008 },
            funnel: [{ name: '触达', value: 221 }, { name: '送达', value: 218 }, { name: '打开', value: 152 }, { name: '回复', value: 53 }, { name: '续费', value: 41 }]
          }
        },
        {
          id: 'uo-3', name: '新客首单优惠推送', status: 'draft', statusText: '草稿', bizText: '运营线',
          segId: null, segName: null,  /* 注册≤7天实时圈选，不引用分群 —— 行业常态：策略可不走分群，用实时条件圈人 */
          stages: [
            { id: 'targeting', name: '圈人', state: 'done', detail: '条件：注册≤7天 ∧ 未下单', count: 8420, excluded: { freq: 0, unsub: 4, blacklist: 2, inOther: 1240 }, snapshotAt: 0 },
            { id: 'strategy', name: '策略生成', state: 'active', detail: 'AI 已产出 8 条候选，待人工选定', count: 8, compliance: 'pending' },
            { id: 'reach', name: '触达执行', state: 'wait', detail: '需先通过合规检查', count: null },
            { id: 'attribution', name: '效果回收', state: 'wait', detail: '—', count: null }
          ],
          result: null
        }
      ],
      /* SECTION: userops-site
       * v42（2026-10-29 业主）：这一屏要能回答「人在站里干了什么」——
       * 活跃度、站内搜索、点击、AI 命中四件事，各自有量、有率、有 Top 明细。
       * 与 CRM 联系人池（pool）**不设固定倍数关系**：独立站访客可能没有留资（0 个联系人），
       * 也可能一个公司多人共用一个账号（1 个联系人对应多个访客）。
       * 强行对齐是评审时最容易被问住的地方，宁可两个口径各自独立、各自对账。
       * 对账纪律：daily 序列 → 30 天合计 → 指标卡 / Top 表全部由同一份序列推出，不另写数字。 */
      site: (function () {
        var r = S.R.of('userops-site-v1');
        var DAYS = 30;
        var base = 8200 + r() * 2400;
        var days = [];
        for (var i = 0; i < DAYS; i++) {
          var dt = new Date(Date.now() - (DAYS - 1 - i) * 86400000);
          var dow = dt.getDay();
          /* 周末回落 12% —— 内容型独立站的常态；周六日的大盘靠社媒引流补，站内自然访问偏低 */
          var weekDip = (dow === 0 || dow === 6) ? 0.88 : 1;
          var drift = 1 + (i / DAYS) * (0.08 + r() * 0.12);
          var uv = Math.max(1, Math.round(base * weekDip * drift * (0.95 + r() * 0.11)));
          var newUv = Math.round(uv * (0.33 + r() * 0.12));
          var pv = Math.round(uv * (3.7 + r() * 1.2));
          var aiS = Math.round(uv * (0.055 + r() * 0.02));
          days.push({
            ts: dt.getTime(),
            label: (dt.getMonth() + 1) + '/' + dt.getDate(),
            uv: uv,
            newUv: newUv,
            retUv: uv - newUv,
            pv: pv,
            search: Math.round(uv * (0.30 + r() * 0.10)),
            clicks: Math.round(pv * (0.19 + r() * 0.05)),
            aiSessions: aiS,
            aiHit: Math.round(aiS * (0.64 + r() * 0.15))
          });
        }
        function sum(k) { var t = 0; for (var i = 0; i < days.length; i++) t += days[i][k]; return t; }
        function avgOf(arr, k) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i][k]; return t / arr.length; }
        var last = days[DAYS - 1];
        var w7 = days.slice(-7), p7 = days.slice(-14, -7);
        var dau = last.uv;
        /* WAU / MAU 不是 7×DAU、30×DAU —— 去重后要打折。独立站的经验系数：4.3 / 14 */
        var wau = Math.round(avgOf(w7, 'uv') * 4.3);
        var mau = Math.round(avgOf(days, 'uv') * 14);
        var pv30 = sum('pv'), clicks30 = sum('clicks'), search30 = sum('search');
        var ai30 = sum('aiSessions'), aiHit30 = sum('aiHit');
        var funnel = (function () {
          var v = [mau, Math.round(mau * 0.62), Math.round(mau * 0.212), Math.round(mau * 0.094), Math.round(mau * 0.068)];
          return [
            { name: '访问', value: v[0] }, { name: '看商品', value: v[1] },
            { name: '加购', value: v[2] }, { name: '结账', value: v[3] }, { name: '支付', value: v[4] }
          ];
        })();
        /* 搜索词：**手写权重不随机** —— 这张表是给人做决策的（哪个词没结果、哪个词 AI 接不住），
           随机生成只会得到一张永远看不出问题的表。权重合计 31.6%，其余 68.4% 明确标为长尾。
           prev = 上期（前 7 天）名次。热搜是榜单，要看的是「谁在前、谁在往上冲」，
           不是看这个月搜了几次 —— 所以名次与名次变化都要有据可查。 */
        var termDefs = [
          { q: 'silver ring', tag: '商品 · 戒指', w: 0.061, noResult: 0.118, aiHit: 0.58, prev: 1 },
          { q: 'waterproof necklace', tag: '商品 · 项链', w: 0.048, noResult: 0.041, aiHit: 0.71, prev: 4 },
          { q: 'size guide', tag: '帮助 · 尺码', w: 0.041, noResult: 0.007, aiHit: 0.92, prev: 2 },
          { q: 'shipping to canada', tag: '帮助 · 物流', w: 0.036, noResult: 0.163, aiHit: 0.44, prev: 3 },
          { q: 'gift for girlfriend', tag: '场景 · 送礼', w: 0.031, noResult: 0.022, aiHit: 0.66, prev: 7 },
          { q: 'sterling vs stainless', tag: '内容 · 材质', w: 0.026, noResult: 0.034, aiHit: 0.79, prev: 5 },
          { q: 'rings', tag: '类目 · 宽泛', w: 0.024, noResult: 0.011, aiHit: 0.51, prev: 6 },
          { q: 'custom engraving', tag: '服务 · 刻字', w: 0.019, noResult: 0.052, aiHit: 0.63, prev: 0 },
          { q: 'hoop earrings small', tag: '商品 · 耳环', w: 0.016, noResult: 0.077, aiHit: 0.69, prev: 8 },
          { q: 'return policy', tag: '帮助 · 退换', w: 0.014, noResult: 0.019, aiHit: 0.88, prev: 9 }
        ];
        /* 点击率按词性给区间：宽泛词 ctr 高（点得散、转化低），帮助类词 ctr 低但结束会话 */
        var termCtr = { 'silver ring': 0.412, 'waterproof necklace': 0.386, 'size guide': 0.207,
          'shipping to canada': 0.164, 'gift for girlfriend': 0.298, 'sterling vs stainless': 0.231,
          'rings': 0.476, 'custom engraving': 0.341, 'hoop earrings small': 0.358, 'return policy': 0.188 };
        var topTerms = termDefs.map(function (d, i) {
          var n = Math.round(search30 * d.w);
          return {
            q: d.q, tag: d.tag, n: n,
            rank: i + 1, prevRank: d.prev,   /* prevRank 0 = 本期新进榜 */
            ctr: termCtr[d.q] || 0.3,
            noResult: d.noResult, noResultN: Math.round(n * d.noResult),
            aiHit: d.aiHit
          };
        });
        var covered = topTerms.reduce(function (a, t) { return a + t.n; }, 0);
        return {
          days: days,
          dau: dau,
          dauPrevDay: p7[6].uv,
          wau: wau,
          mau: mau,
          sticky: dau / mau,
          newRatio: last.newUv / last.uv,
          pv30: pv30,
          clicks30: clicks30,
          clickRate: clicks30 / pv30,
          search30: search30,
          searchPerUv: search30 / dau / 30,
          ai30: ai30,
          aiHit30: aiHit30,
          aiHitRate: aiHit30 / ai30,
          aiPerUv: ai30 / dau / 30,
          funnel: funnel,
          aov: UO_AOV,
          /* 搜索带动成交 —— 对齐 Klevu 的 Search Led Sales / Search Led Contribution 口径。
             这是搜索这件事最该被看见的数：搜了几次不重要，搜索带来了多少单才重要。
             搜索用户 = 搜索次数 ÷ 人均 4.5 次（Klevu 的 avg queries per search user 就在 3–5）；
             转化率 9.8% 相对站均约 1.4 倍 —— 行业说搜索用户转化是站均 1.5–3 倍，这里取下沿。 */
          searchUsers: (function () { return Math.round(search30 / 4.5); })(),
          searchOrders: (function () { return Math.round(Math.round(search30 / 4.5) * 0.098); })(),
          searchRevenue: (function () { return Math.round(Math.round(search30 / 4.5) * 0.098) * UO_AOV; })(),
          /* 站均 UV 转化率（用漏斗末档 ÷ MAU，与漏斗同源），搜索转化相对它的倍数由页面即时算 */
          convRate: funnel[4].value / mau,
          /* 不只看支付率，还要能看到「哪一步漏得最多」—— 由漏斗相邻两档即时推导，不写死 */
          topTerms: topTerms,
          termCovered: covered,
          termLongTail: 1 - covered / search30,
          noResultTotal: topTerms.reduce(function (a, t) { return a + t.noResultN; }, 0),
          /* 点击落点：与 clicks30 对得上（前 6 个入口占 71%，其余归「其他页面」）。
             同样是榜单 —— 名次 + 上期名次，运营关心的是"哪个入口在往上走"。 */
          clickPaths: [
            { path: '/collections/rings', label: '类目 · 戒指', w: 0.214, prev: 1 },
            { path: '/products/s925-hoop', label: '商品 · 925 耳环', w: 0.148, prev: 3 },
            { path: '/collections/necklaces', label: '类目 · 项链', w: 0.121, prev: 2 },
            { path: '/blogs/material-guide', label: '内容 · 材质指南', w: 0.094, prev: 5 },
            { path: '/pages/size-guide', label: '帮助 · 尺码表', w: 0.071, prev: 4 },
            { path: '/pages/shipping', label: '帮助 · 物流', w: 0.062, prev: 0 }
          ].map(function (p, i) {
            return { path: p.path, label: p.label, n: Math.round(clicks30 * p.w), rank: i + 1, prevRank: p.prev };
          }),
          /* AI 没接住的问题：Top5 合计只占未命中的一小部分，明确写「其余为长尾」 */
          aiMiss: [
            { q: 'can i shower with it on', n: 268, why: '防水说明只写在商品页 Tab 里，知识库没有独立条目' },
            { q: 'do you ship to brazil', n: 214, why: '可配送国家表未同步，AI 只能答「部分地区」' },
            { q: 'difference between 925 and 999', n: 186, why: '材质对比有内容但未结构化，检索命中错章节' },
            { q: 'exchange size after 30 days', n: 121, why: '退换政策分两处（帮助中心 / 商品页），条款不一致' },
            { q: 'engraving in another language', n: 96, why: '无对应条目，AI 直接答「不支持」（实际支持 8 种语言）' }
          ],
          /* 知识条目表现 —— 对齐 Intercom Fin 的 content performance 表。
             只看「哪些问题没接住」会让人一直往里加新条目，却不知道已有的哪一条根本不在解决事：
             刻字说明被引用 410 次、只解决 48%，问题不在"没有条目"，在这条本身写得不对。
             Σresolved 必须 ≤ 命中会话数，否则口径就穿了。 */
          knowledgeTop: [
            { title: '尺码对照表 v3', kind: '帮助页', cited: 1840, resolved: 1693 },
            { title: '925 银饰保养须知', kind: '文章', cited: 1215, resolved: 1046 },
            { title: '配送时效与关税', kind: '帮助页', cited: 980, resolved: 617 },
            { title: '退换货政策（30 天）', kind: '帮助页', cited: 742, resolved: 668 },
            { title: '刻字服务说明', kind: '商品页片段', cited: 410, resolved: 197 }
          ].map(function (k) { return Object.assign({}, k, { rate: k.resolved / k.cited }); })
        };
      })(),

      /* SECTION: userops-social
       * 社媒阵地：粉丝是**存量资产**，净增是**当期结果**，互动是**内容质量**。
       * 三者分开看 —— 只看粉丝总数会把「买粉/刷量」和「内容起飞」混为一谈；
       * 只看净增会在掉粉的平台上误判（粉丝基数大、净增小但互动很好 = 存量在活跃）。
       * 对账：每平台 30 天序列「末点 − 首点 === net30」，Σ平台 === 汇总，不另存汇总值。 */
      social: (function () {
        var defs = [
          { id: 'tt', name: 'TikTok', handle: '@aurora.jewelry', followers: 186400, net30: 12860, posts30: 42,
            views30: 3200000, likes: 214000, comments: 21800, shares: 32400, saves: 0,
            clicks: 34000, sessions: 26400, orders: 760,
            note: '主战场 · 短视频带站内搜索' },
          { id: 'yt', name: 'YouTube', handle: 'Aurora Jewelry', followers: 64200, net30: 3140, posts30: 8,
            views30: 890000, likes: 31200, comments: 4100, shares: 2600, saves: 3900,
            clicks: 10200, sessions: 8400, orders: 400,
            note: '长视频 · 材质科普拉搜索' },
          { id: 'ig', name: 'Instagram', handle: '@aurora.jewelry', followers: 92800, net30: 2260, posts30: 36,
            views30: 1100000, likes: 48600, comments: 5200, shares: 7400, saves: 0,
            clicks: 7600, sessions: 5600, orders: 160,
            note: '图文种草 · 收藏率高' },
          { id: 'fb', name: 'Facebook', handle: 'Aurora Jewelry', followers: 38500, net30: -420, posts30: 18,
            views30: 240000, likes: 6400, comments: 900, shares: 800, saves: 0,
            clicks: 1900, sessions: 1400, orders: 36,
            note: '35+ 客群 · 自然触达衰减' },
          { id: 'x', name: 'X', handle: '@aurorajewelry', followers: 12600, net30: 180, posts30: 54,
            views30: 320000, likes: 3900, comments: 620, shares: 680, saves: 0,
            clicks: 1300, sessions: 800, orders: 8,
            note: '品牌发声 · 不承担拉新' }
        ];
        /* 30 天粉丝序列：首末两端锁死，中间在线性插值上做小幅波动（真实涨粉也不是每天匀速） */
        function series(start, end, key) {
          var rr = S.R.of(key), out = [start];
          for (var i = 1; i < 29; i++) {
            var target = start + (end - start) * (i / 29);
            out.push(Math.round(target * (1 + (rr() - 0.5) * 0.012)));
          }
          out.push(end);
          return out;
        }
        var platforms = defs.map(function (d) {
          var eng = d.likes + d.comments + d.shares + d.saves;
          var rate = eng / d.views30;
          /* 互动率与上周的差（百分点）—— 涨粉快但互动率掉，是「内容迎合算法、丢品牌」的早期信号。
             反过来存一份上周值，界面上要给的是「变化」，不是只给一个"本周掉了"的结论。 */
          var dPt = (d.id === 'tt') ? -0.6 : (d.id === 'fb') ? -0.2 : 0.3;
          return Object.assign({}, d, {
            eng30: eng,
            engRate: rate,
            engRateDelta: dPt,
            engRatePrev: rate - dPt / 100,
            /* 社媒这边真正该被看见的三件事：点进来的人、真的到了站内的人、买了的人。
               viewToSession（点击→站内会话的匹配率）低，说明是落地页或追踪断了，不是内容不行 ——
               行业实测这条在 60–85%，掉到 60% 以下先查 UTM 与重定向，别急着换内容。 */
            revenue: d.orders * UO_AOV,
            convRate: d.orders / d.sessions,
            viewToSession: d.sessions / d.clicks,
            viewsPerPost: Math.round(d.views30 / d.posts30),
            trend: series(d.followers - d.net30, d.followers, 'userops-social|' + d.id)
          });
        });
        var sumBy = function (k) { return platforms.reduce(function (a, p) { return a + p[k]; }, 0); };
        var totViews = sumBy('views30');
        var totClicks = sumBy('clicks'), totSessions = sumBy('sessions'), totOrders = sumBy('orders');
        /* 社媒流量的加购率取 14%（站内整体 21%）：社媒来的意图更浅，加购少是常态，不是异常 */
        var totAddCart = Math.round(totSessions * 0.14);
        return {
          platforms: platforms,
          totalFollowers: sumBy('followers'),
          totalNet30: sumBy('net30'),
          totalViews: totViews,
          totalEng: sumBy('eng30'),
          /* 汇总互动率 = Σ互动 / Σ播放（不是各平台互动率的平均 —— 平均会把 6 万粉的号和小号等权）。
             上期同理按播放加权，播放取本周值（周与周播放量级接近，只让率变）—— 只为给一个可读的环比。 */
          engRate: sumBy('eng30') / totViews,
          engRatePrev: platforms.reduce(function (a, p) { return a + p.engRatePrev * p.views30; }, 0) / totViews,
          /* 社媒 → 站内 → 成交：五段链路，逐段转化率由相邻两档算，不另存。
             这条链是「社媒到底值多少钱」的唯一诚实答案 —— 粉丝和播放都是中间量。 */
          totalClicks: totClicks,
          totalSessions: totSessions,
          totalOrders: totOrders,
          totalRevenue: totOrders * UO_AOV,
          matchRate: totSessions / totClicks,
          funnel: [
            { name: '社媒曝光', value: totViews },
            { name: '链接点击', value: totClicks },
            { name: '站内访问', value: totSessions },
            { name: '加购', value: totAddCart },
            { name: '成交', value: totOrders }
          ],
          posts30: sumBy('posts30'),
          /* 内容 Top：涨粉归因用「这条内容带来的新粉」，不是播放量 —— 播放高但涨粉低说明内容不带品牌记忆。
             prev = 上期名次（0 = 本期新上榜）：内容榜的价值一半在"谁冲上来了"。 */
          contentTop: [
            { platform: 'TikTok', title: '925 银项链 · 30 秒防水实测', type: '短视频', views: 1280000, eng: 96400, follows: 4120, day: -2, prev: 3 },
            { platform: 'TikTok', title: '手作刻字过程 ASMR', type: '短视频', views: 860000, eng: 71200, follows: 2860, day: -5, prev: 1 },
            { platform: 'YouTube', title: 'S925 vs S999：到底差在哪', type: '长视频', views: 342000, eng: 18900, follows: 1460, day: -8, prev: 2 },
            { platform: 'Instagram', title: '夏日叠戴 5 种搭法', type: '图文', views: 268000, eng: 22400, follows: 980, day: -4, prev: 0 },
            { platform: 'TikTok', title: '客户实拍：戴了半年的氧化程度', type: '短视频', views: 214000, eng: 15600, follows: 640, day: -11, prev: 5 },
            { platform: 'YouTube', title: '尺码怎么量 · 3 分钟看懂', type: '长视频', views: 96000, eng: 6100, follows: 420, day: -14, prev: 0 }
          ]
        };
      })(),

      /* v20：触达治理（行业标准口径）—— 全局预算、冷却静默、偏好中心、紧急例外。
         此前只有策略内频控排除与免打扰一句话，缺跨策略的中心化抑制与用户偏好出口。 */
      guardrails: {
        monthlyCap: 4,
        monthlyCapText: '每人每月促销触达 ≤ 4 条 —— 跨所有策略的中心化抑制层，两个策略抢同一人时边际提升高者先发',
        cooling: '48h 促销冷却 · 购买成功后 72h 静默 · 投诉后 5 天冷却',
        quietHours: '22:00–08:00 禁发（按用户本地时区）',
        emergency: '紧急例外仅限：账户安全 / 欺诈 / 服务中断，且需事后复核',
        holdoutText: 'holdout ≥ 5% 且不可为 0 —— 否则无法证明提升来自策略而非自然增长',
        rampText: '灰度 1% → ' + (window.DECISIONS ? DECISIONS.value('灰度', '最小观察期') : 60) + ' → 逐步放量，每步异常自动熔断',
        preference: '偏好中心：降频（每月 ≤ 2 条）/ 换渠道 / 按类型退订；退订立即生效并全策略同步，降频优先于退订'
      },
      /* v20：流失赢回（B2B 六阶段模型：Churn & Winback 是正式生命周期阶段，不是终点）——
         行业基准：流失后 60–90 天定向赢回可挽回 15–25% 流失账户。 */
      winback: {
        windowText: '流失后 60–90 天启动定向赢回',
        recoveredText: '行业基准可挽回 15–25% 流失账户',
        groups: [
          { name: '价格流失', share: 0.38, play: '竞品对比方案 + 限时迁移权益' },
          { name: '服务流失', share: 0.27, play: '客户成功一对一 + 问题整改闭环' },
          { name: '自然流失', share: 0.35, play: '低频月报 + 重大版本上线唤醒' }
        ]
      }
    };

    /* v20：refPipes 真实回填 —— 由策略的 segId 推导，不再随机。
       此前 refPipes = Math.floor(r()*3)，与实际策略无关（sg-3 显示被引用但没有任何策略圈它的条件）。 */
    (function () {
      var c = {};
      P.userops.items.forEach(function (it) { if (it.segId) c[it.segId] = (c[it.segId] || 0) + 1; });
      P.userops.segments.forEach(function (s) { s.refPipes = c[s.id] || 0; });
    })();

    P.evolution = {
      title: '进化任务',
      items: [
        {
          id: 'ev-1', name: '客服助手·退货场景 badcase 修复', agentId: 'ag-cs-refund', agentName: '客服助手 Agent',
          status: 'gray', statusText: '灰度 20% 观察中', triggerText: 'badcase 阈值触发', createdAt: -4,
          /* v53（2026-10-29 业主：「这个页面应该显示 agent 改进了什么，工具调用？流程优化？经验记忆改进？」）：
             流水线四阶段（聚类→生成→评估→灰度）回答的是「怎么来的」，不是「改了什么」。
             这里补一层**改动清单**：每一处改动都写清 对象 / 前后 diff / 依据哪类 badcase / 改完的效果 / 当前状态。
             face 只有四个取值（tool 工具调用 / flow 流程编排 / memory 经验记忆 / prompt 提示词与知识），
             页面的分组、计数、筛选全部由它派生 —— 不要在这里造第五种「改进面」。 */
          changes: [
            { id: 'ch-1-1', face: 'tool', kindText: '工具调用',
              title: '物流问答改用混合检索 + 重排，召回从 3 条放宽到 5 条',
              obj: 'search_chunks → hybrid_search + rerank', objSub: 'mcp://knowledge/search',
              diff: [
                { k: '调用方法', b: 'search_chunks（单路）', a: 'hybrid_search + rerank' },
                { k: 'top_k', b: '3', a: '5' },
                { k: '相似度阈值', b: '0.72', a: '0.65' }
              ],
              cause: { name: '物流信息答非所问', cases: 47 },
              effect: [
                { k: '检索命中', b: '84.2%', a: '95.6%', d: '+11.4pp', good: true },
                { k: '引用准确', b: '71.0%', a: '93.4%', d: '+22.4pp', good: true },
                { k: 'P50 时延', b: '1.82s', a: '2.14s', d: '+320ms', good: false },
                { k: '单次成本', b: '¥0.018', a: '¥0.021', d: '+18%', good: false }
              ],
              verify: '回归 1,200 例通过率 91.7% → 94.8%；灰度样本中物流类 47 例修复 43 例',
              state: 'gray', stateText: '灰度 20%' },

            { id: 'ch-1-2', face: 'flow', kindText: '流程编排',
              title: '在意图识别之后插入「订单锁定」节点，多轮对话绑定订单号',
              obj: '售后工单流程 r12 → r13', objSub: '新增 1 个节点 · 改 1 个节点',
              diff: [
                { k: '节点数', b: '5 个', a: '6 个' },
                { k: '新增节点', b: '—', a: '订单锁定（意图识别之后）' },
                { k: '模型调用', b: '2 次 / 工单', a: '3 次 / 工单' }
              ],
              flow: {
                name: '售后工单流程', from: 'r12', to: 'r13',
                nodes: [
                  { kind: '触发器', name: '工单受理', sub: '退货 / 物流 / 发票', st: 'base' },
                  { kind: '判断', name: '意图识别', sub: '三类意图分流', st: 'base' },
                  { kind: '动作', name: '订单锁定', sub: '绑订单号，隔离多轮上下文', st: 'new' },
                  { kind: '工具', name: '知识检索', sub: 'hybrid + rerank', st: 'chg' },
                  { kind: '模型', name: '生成回复', sub: 'qwen-plus', st: 'base' },
                  { kind: '校验', name: '合规预检', sub: '对外话术过一遍', st: 'base' }
                ],
                note: '发票、报销类意图不进入订单锁定；该例外于灰度第 2 天补充'
              },
              cause: { name: '跨订单混淆', cases: 28 },
              effect: [
                { k: '跨订单混淆', b: '28 例 / 14 天', a: '0 例（灰度样本）', d: '归零', good: true },
                { k: '发票误锁', b: '8 例退化', a: '0 例（补例外后复测）', d: '已修复', good: true },
                { k: 'P50 时延', b: '2.14s', a: '2.51s', d: '+370ms', good: false }
              ],
              verify: '离线评估报告「发票咨询 8 例退化」，原因为订单锁定将发票号误判为订单号；加入发票类例外后复测，退化 0 例',
              state: 'gray', stateText: '灰度 20%' },

            { id: 'ch-1-3', face: 'memory', kindText: '经验记忆',
              title: '新增经验：退货时限以物流签收日起算',
              obj: '经验库 · 售后线（新增第 7 条）', objSub: '私有于客服助手 Agent',
              mem: {
                action: '新增', entry: '退货时限以物流签收日起算',
                trigger: '客户问「还能退吗 / 是不是超期了」',
                before: '旧口径按下单日起算，在途 2~3 天计入有效期，客户常被告知已超期',
                after: '按物流签收日起算，签收当天不计入；无签收记录时按「发货 +3 天」兜底',
                searches: 412, adopt: 0.78, hit: 0.91
              },
              cause: { name: '退货时限判断错误', cases: 68 },
              effect: [
                { k: '该类问题', b: '68 例 / 14 天', a: '6 例（灰度样本）', d: '-91%', good: true },
                { k: '被召回', b: '—', a: '412 次', d: '近 14 天', good: null }
              ],
              verify: '经验条目按经验库生效流程发布，不随 Agent 版本灰度；当前命中 91%、采纳 78%，命中低于 70% 时自动退出检索池',
              state: 'live', stateText: '已生效' },

            { id: 'ch-1-4', face: 'prompt', kindText: '提示词',
              title: '系统提示词加一条硬约束：时效只答政策区间，不承诺具体日期',
              obj: '系统提示词 · 第 4 段', objSub: '2,140 → 2,186 tokens',
              diff: [
                { k: '新增约束', b: '—', a: '不得承诺「N 小时内到账 / 一定退」' },
                { k: '改写示例', b: '「24 小时内退款到账」', a: '「审核通过后 1~3 个工作日，以银行入账为准」' },
                { k: '约束位置', b: '靠后（第 6 段）', a: '前置到第 4 段' }
              ],
              cause: { name: '承诺退款时效与政策不符（含 bc-73）', cases: 34 },
              effect: [
                { k: '承诺类违规', b: '34 例 / 14 天', a: '1 例（灰度样本）', d: '-97%', good: true },
                { k: '平均回复长度', b: '312 字', a: '286 字', d: '-8%', good: true }
              ],
              verify: '违规口径：回复中出现「N 小时内到账」「保证退」等承诺性表述，由合规规则包判定，非人工抽检',
              state: 'gray', stateText: '灰度 20%' },

            { id: 'ch-1-5', face: 'prompt', kindText: '知识库',
              title: '售后案例库新增 3 条举证材料清单',
              obj: '售后案例库 · §质量问题举证', objSub: '3 条新增条目 · 索引已重建',
              diff: [
                { k: '该章节条目', b: '0 条（空章节）', a: '3 条：照片要求 / 检测报告 / 时间窗' },
                { k: '生效日期', b: '未标注', a: '2026-10-01 起，按签收日判定' }
              ],
              cause: { name: '质量问题举证要求缺失', cases: 39 },
              effect: [
                { k: '该类问题', b: '39 例 / 14 天', a: '4 例（灰度样本）', d: '-90%', good: true },
                { k: '检索命中', b: '未命中', a: '93.1%', d: '+93.1pp', good: true }
              ],
              verify: '3 条均标注生效日期与出处；政策更新后按日期过滤旧口径',
              state: 'gray', stateText: '灰度 20%' }
          ],
          stages: [
            { id: 'cluster', name: 'badcase 聚类', state: 'done', detail: '纳入近 14 天 214 例 badcase，聚为 6 类', count: 214,
              clusters: [
                { name: '退货时限判断错误', cases: 68, rootCause: '提示词未明确"签收日"与"下单日"的区别' },
                { name: '物流信息答非所问', cases: 47, rootCause: '知识检索 top_k=3 召回不足，未命中最新政策' },
                { name: '质量问题举证要求缺失', cases: 39, rootCause: '知识库缺少举证材料清单条目' },
                { name: '跨订单混淆', cases: 28, rootCause: '多轮上下文未隔离订单号' },
                { name: '发票与退货混合咨询', cases: 19, rootCause: '意图识别阈值过低（0.62）' },
                { name: '其他零散', cases: 13, rootCause: '未形成有效聚类，暂不处理' }
              ] },
            { id: 'generate', name: '策略生成', state: 'done', detail: '产出 6 条候选，人工筛选 4 条进入评估', count: 4,
              candidates: [
                { id: 'c1', type: '改提示词', target: '退货时限判断', diff: '在系统提示词中增加「时限计算以物流签收日为准，非下单日」', expect: '该类 badcase 下降 80%', risk: '低', selected: true },
                { id: 'c2', type: '调参数', target: '知识检索', diff: 'top_k: 3 → 5，相似度阈值 0.72 → 0.65', expect: '召回率提升，但成本 +18%', risk: '中（成本上升）', selected: true },
                { id: 'c3', type: '补知识', target: '举证材料清单', diff: '新增 3 条知识条目至售后案例库', expect: '该类 badcase 下降 90%', risk: '低', selected: true },
                { id: 'c4', type: '改编排', target: '订单上下文隔离', diff: '在意图识别后新增「订单锁定」节点', expect: '跨订单混淆归零', risk: '中（增加 1 次模型调用）', selected: true },
                { id: 'c5', type: '调参数', target: '意图识别阈值', diff: '0.62 → 0.75', expect: '混合咨询准确率提升', risk: '高（可能降低整体召回）', selected: false },
                { id: 'c6', type: '改提示词', target: '语气优化', diff: '增加共情表述', expect: '满意度提升', risk: '低', selected: false }
              ] },
            { id: 'evaluate', name: '离线评估', state: 'done', detail: '回归集 1,200 例 + 本次 badcase 214 例', count: 1414,
              result: {
                baseline: { pass: 0.917, accuracy: 0.884, latency: 1820, cost: 0.018 },
                candidate: { pass: 0.948, accuracy: 0.921, latency: 2140, cost: 0.021 },
                sideEffect: { regressed: 8, regressedNote: '在「发票咨询」场景有 8 例退化（原通过现失败），原因：订单锁定节点误锁发票号' },
                verdict: '4 条候选合并后整体通过，但需修复发票场景退化'
              } },
            { id: 'gray', name: '灰度上线', state: 'active', detail: '灰度 20%，已运行 3 天，等待确认转全量', count: null,
              gray: { ratio: 0.20, days: 3, autoRollback: '成功率<98% 或 P99>4s' } }
          ]
        },
        {
          id: 'ev-2', name: '知识问答·幻觉抑制', agentId: 'ag-kb-qa', agentName: '知识问答 Agent',
          status: 'evaluate', statusText: '离线评估中', triggerText: '每周定时', createdAt: -2,
          changes: [
            { id: 'ch-2-1', face: 'prompt', kindText: '提示词',
              title: '输出强制带引用，无来源时回答「未找到」',
              obj: '系统提示词 · 输出版式段', objSub: '新增 2 条硬约束',
              diff: [
                { k: '引用格式', b: '不要求', a: '必附 [来源: 文档名 §章节]' },
                { k: '无来源时', b: '照常生成（编造）', a: '只回答「知识库中未找到」' },
                { k: '约束强度', b: '建议语气', a: '硬约束 + 输出校验' }
              ],
              cause: { name: '引用不存在的政策条款', cases: 41 },
              effect: [
                { k: '幻觉率', b: '32.0%', a: '9.2%', d: '-22.8pp', good: true },
                { k: '引用覆盖率', b: '0%', a: '100%', d: '+100pp', good: true },
                { k: '答案完整度', b: '—', a: '略有下降', d: '待全量', good: null }
              ],
              verify: '评估中：全量 1,500 例已完成 812 例；上表为 120 例小样本回放结果，全量完成前不作为结论',
              state: 'eval', stateText: '评估中 · 812/1,500' },

            { id: 'ch-2-2', face: 'flow', kindText: '流程编排',
              title: '检索相似度低于 0.6 时进入兜底分支，不进入生成',
              obj: '知识问答流程 r7 → r8', objSub: '新增 1 个判断节点 · 1 条分支',
              diff: [
                { k: '判断节点', b: '—', a: '相似度 ≥ 0.6 ？（检索之后）' },
                { k: '兜底分支', b: '无（继续生成）', a: '直接走兜底话术 + 转人工' },
                { k: '模型调用', b: '每次都调', a: '命中兜底时省一次生成' }
              ],
              flow: {
                name: '知识问答流程', from: 'r7', to: 'r8',
                head: [
                  { kind: '触发器', name: '用户提问', sub: '站内 / 企业微信', st: 'base' },
                  { kind: '工具', name: '多库检索', sub: '按库分组召回', st: 'chg' },
                  { kind: '判断', name: '相似度 ≥0.6 ？', sub: '低于阈值不进入生成', st: 'new' }
                ],
                split: [
                  { label: '够', tone: 'ok', nodes: [
                    { kind: '模型', name: '生成答案', sub: '带来源引用', st: 'base' } ] },
                  { label: '不够', tone: 'no', nodes: [
                    { kind: '兜底', name: '转人工 + 兜底话术', sub: '不消耗生成调用', st: 'new' },
                    { kind: '动作', name: '生成知识缺口单', sub: '进知识库待补清单', st: 'new' } ] }
                ],
                note: '经判断节点分流：无可用来源时不进入生成，直接转人工并生成缺口单'
              },
              cause: { name: '数字类回答编造', cases: 27 },
              effect: [
                { k: '数字编造', b: '27 例 / 周', a: '3 例', d: '-89%', good: true },
                { k: '转人工率', b: '4.2%', a: '6.8%', d: '+2.6pp', good: true },
                { k: 'P50 时延', b: '1.40s', a: '1.10s', d: '-300ms', good: true }
              ],
              verify: '转人工率上升为预期结果，非退化；灰度结论需注明该项，否则会被判为指标退步',
              state: 'eval', stateText: '评估中 · 812/1,500' },

            { id: 'ch-2-3', face: 'tool', kindText: '工具调用',
              title: '多库检索按库分组后再合并，避免两个库的条款被拼接',
              obj: 'hybrid_search + group_by_collection', objSub: 'mcp://knowledge/search',
              diff: [
                { k: '检索参数', b: 'group_by_collection = false', a: 'true（按库分组）' },
                { k: '合并顺序', b: '全局按分数排', a: '每库先出 top2，再合并重排' },
                { k: '返回条数', b: '5 条（可能全是同一个库）', a: '5 条（每库至少 2 条）' }
              ],
              cause: { name: '跨库信息混淆', cases: 18 },
              effect: [
                { k: '跨库混淆', b: '18 例 / 周', a: '5 例', d: '-72%', good: true },
                { k: '检索时延', b: '180ms', a: '207ms', d: '+15%', good: false }
              ],
              verify: '待全量评估确认；时延 +15% 在 SLO 内（P99 上限 4s）',
              state: 'eval', stateText: '评估中 · 812/1,500' }
          ],
          stages: [
            { id: 'cluster', name: 'badcase 聚类', state: 'done', detail: '纳入 96 例，聚为 4 类', count: 96, clusters: [
              { name: '引用不存在的政策条款', cases: 41, rootCause: '未强制要求引用来源' },
              { name: '数字类回答编造', cases: 27, rootCause: '检索无结果时未走兜底' },
              { name: '跨库信息混淆', cases: 18, rootCause: '多库检索未按库隔离' },
              { name: '其他', cases: 10, rootCause: '—' }
            ] },
            { id: 'generate', name: '策略生成', state: 'done', detail: '产出 3 条候选', count: 3, candidates: [
              { id: 'c1', type: '改提示词', target: '强制引用', diff: '输出必须附 [来源: 文档名 §章节]，无来源则回答"知识库中未找到"', expect: '幻觉下降 70%', risk: '低', selected: true },
              { id: 'c2', type: '改编排', target: '无结果兜底', diff: '检索相似度<0.6 时直接走兜底话术，不进入生成', expect: '数字编造归零', risk: '低', selected: true },
              { id: 'c3', type: '调参数', target: '库隔离', diff: '多库检索改为按库分组后再合并', expect: '跨库混淆下降', risk: '中（延迟+15%）', selected: true }
            ] },
            { id: 'evaluate', name: '离线评估', state: 'active', detail: '评估中 812 / 1,500，预计剩余 6 分钟', count: 1500, result: null },
            { id: 'gray', name: '灰度上线', state: 'wait', detail: '等待评估通过', count: null, gray: null }
          ]
        },
        {
          id: 'ev-3', name: '标书生成·章节结构优化', agentId: 'ag-sales-bid', agentName: '标书生成 Agent',
          status: 'cluster', statusText: '聚类中', triggerText: '人工发起', createdAt: 0,
          /* 还没走到「改」这一步：聚类没跑完就没有候选改动。
             空态如实写「没有改动」，不许拿上一条任务的改动来充数。 */
          changes: [],
          pendingNote: '聚类进度 128 / 156。聚类完成后产出候选改动，候选须通过离线评估方可生效',
          stages: [
            { id: 'cluster', name: 'badcase 聚类', state: 'active', detail: '聚类中 128 / 156', count: 156, clusters: null },
            { id: 'generate', name: '策略生成', state: 'wait', detail: '—', count: null, candidates: null },
            { id: 'evaluate', name: '离线评估', state: 'wait', detail: '—', count: null, result: null },
            { id: 'gray', name: '灰度上线', state: 'wait', detail: '—', count: null, gray: null }
          ]
        },
        /* 已转全量的样本：页面不能只讲「准备改什么」，还得回答「改完到底有没有用」。
           这一条的全部数字都是**上线后**的线上数据（12 天），不是离线评估。 */
        {
          id: 'ev-4', name: '知识问答·差旅报销口径对齐', agentId: 'ag-kb-qa', agentName: '知识问答 Agent',
          status: 'done', statusText: '已全量 12 天', triggerText: 'badcase 阈值触发', createdAt: -14,
          track: { days: 12, line: '上线 12 天：差旅报销类 badcase 从 61 例/周 降到 6 例/周，P99 时延未变（1.9s → 1.9s）' },
          changes: [
            { id: 'ch-4-0', face: 'tool', kindText: '工具调用',
              title: '新增退款进度、物流轨迹两个查询工具，替代模型推断',
              obj: '+ refund_status · + shipping_track', objSub: 'mcp://order/detail',
              diff: [
                { k: '可用工具', b: '6 个', a: '8 个' },
                { k: '新增', b: '—', a: 'refund_status / shipping_track' },
                { k: '调用配额', b: '40 QPS', a: '60 QPS（读接口）' },
                { k: '失败兜底', b: '重试 3 次后放弃', a: '失败即转人工，不重试' }
              ],
              cause: { name: '无来源时续写（退款进度编造）', cases: 31 },
              effect: [
                { k: '工具调用成功率', b: '96.9%', a: '99.6%', d: '+2.7pp', good: true },
                { k: '进度类答错', b: '31 例 / 月', a: '2 例', d: '-94%', good: true },
                { k: 'P99 时延', b: '1.90s', a: '1.90s', d: '持平', good: null }
              ],
              verify: '上线 12 天共 8,412 次调用，失败 34 次；其中 31 次为订单号不合法的脏数据，已提交业务侧修正',
              state: 'live', stateText: '已生效' },

            { id: 'ch-4-1', face: 'memory', kindText: '经验记忆',
              title: '住宿上限改为按城市分级，替代原统一 500 元',
              obj: '经验库 · 差旅线 v2 → v3', objSub: '被 4 个 Agent 共享',
              mem: {
                action: '改写', entry: '差旅住宿标准（城市分级）',
                trigger: '员工问「出差住宿能报多少 / 这个价超标吗」',
                before: '新版 v2：一线 / 非一线一律 500 元上限（2024 年口径，已废止）',
                after: 'v3：一线 650 / 二线 500 / 其他 380，按发票开具城市判定；超标部分需事前审批单',
                searches: 1238, adopt: 0.82, hit: 0.94
              },
              cause: { name: '报销上限答成旧口径', cases: 43 },
              effect: [
                { k: '该类准确率', b: '71%', a: '94%', d: '+23pp', good: true },
                { k: '被召回', b: '—', a: '1,238 次', d: '12 天', good: null }
              ],
              verify: '版本 v3 保留 v2 供追溯，v2 已标注「2024 口径，已废止」；当前命中 94%、采纳 82%',
              state: 'live', stateText: '已生效' },

            { id: 'ch-4-2', face: 'prompt', kindText: '知识库',
              title: '补 12 条政策原文，逐篇标注生效日期',
              obj: '企业知识库 · §差旅管理办法 v3', objSub: '12 条新增 · 索引已重建',
              diff: [
                { k: '政策原文', b: '缺 2026 版全文（只有摘要）', a: '12 条原文 + 条款编号' },
                { k: '生效日期', b: '未标注', a: '逐篇标注，检索时按日期过滤' },
                { k: '检索方式', b: '按标题匹配', a: '标题 + 条款号 + 生效期三元匹配' }
              ],
              cause: { name: '引用不存在的政策条款', cases: 26 },
              effect: [
                { k: '引用不存在条款', b: '26 例 / 周', a: '0 例', d: '归零', good: true },
                { k: '检索命中', b: '88%', a: '97%', d: '+9pp', good: true }
              ],
              verify: '上线 12 天 0 例「引用不存在的条款」；口径与财务《差旅管理办法 v3》逐条一致',
              state: 'live', stateText: '已生效' },

            { id: 'ch-4-3', face: 'flow', kindText: '流程编排',
              title: '无可用来源时转人工并生成知识缺口单',
              obj: '知识问答流程 r6 → r7', objSub: '新增 1 条分支 · 1 个出口',
              diff: [
                { k: '无结果时', b: '让模型「再想想」（续写）', a: '兜底话术 + 转人工' },
                { k: '知识缺口', b: '不记录', a: '自动生成缺口单，进知识库待补清单' },
                { k: '分支出口', b: '1 个（直接答）', a: '2 个（答 / 转）' }
              ],
              flow: {
                name: '知识问答流程', from: 'r6', to: 'r7',
                head: [
                  { kind: '触发器', name: '用户提问', sub: '站内 / 企业微信', st: 'base' },
                  { kind: '工具', name: '检索', sub: '标题 + 条款 + 生效期', st: 'chg' },
                  { kind: '判断', name: '有没有可用来源', sub: '有 / 没有', st: 'new' }
                ],
                split: [
                  { label: '有', tone: 'ok', nodes: [
                    { kind: '模型', name: '生成答案', sub: '带条款引用', st: 'base' } ] },
                  { label: '没有', tone: 'no', nodes: [
                    { kind: '出口', name: '转人工 + 缺口单', sub: '进知识库待补清单', st: 'new' } ] }
                ],
                note: '缺口单每月汇总一次，为本轮「补 12 条政策原文」的输入来源'
              },
              cause: { name: '无可用来源时续写（编造）', cases: 31 },
              effect: [
                { k: '幻觉客诉', b: '11 件 / 月', a: '1 件', d: '-91%', good: true },
                { k: '转人工率', b: '4.2%', a: '6.8%', d: '+2.6pp', good: true }
              ],
              verify: '转人工率上升为预期结果：命中兜底时不进入生成',
              state: 'live', stateText: '已生效' }
          ],
          stages: [
            { id: 'cluster', name: 'badcase 聚类', state: 'done', detail: '纳入 14 天 74 例，聚为 3 类', count: 74,
              clusters: [
                { name: '报销上限答成旧口径', cases: 43, rootCause: '经验条目 v2 是 2024 年标准，知识库里没有 2026 版原文' },
                { name: '无可用来源时续写（编造）', cases: 31, rootCause: '检索无结果时未走兜底，让模型续写' },
                { name: '其他零散', cases: 0, rootCause: '—' }
              ] },
            { id: 'generate', name: '策略生成', state: 'done', detail: '产出 3 条候选，全部进入评估', count: 3,
              candidates: [
                { id: 'c1', type: '改经验', target: '报销上限口径', diff: '经验条目 v2 → v3：住宿上限按城市分级', expect: '该类准确率回到 90% 以上', risk: '低', selected: true },
                { id: 'c2', type: '补知识', target: '政策原文', diff: '12 条原文入知识库，逐篇标生效日期', expect: '引用不存在的条款归零', risk: '低', selected: true },
                { id: 'c3', type: '改编排', target: '无结果兜底', diff: '无可用来源时转人工 + 生成知识缺口单', expect: '幻觉客诉下降', risk: '中（转人工率上升）', selected: true }
              ] },
            { id: 'evaluate', name: '离线评估', state: 'done', detail: '回归集 900 例 + 本次 74 例', count: 974,
              result: {
                baseline: { pass: 0.812, accuracy: 0.764, latency: 1900, cost: 0.014 },
                candidate: { pass: 0.936, accuracy: 0.921, latency: 1880, cost: 0.014 },
                sideEffect: { regressed: 2, regressedNote: '2 例「境外差旅补贴」问题被兜底错转人工（原能答），已补 1 条知识后复测通过' },
                verdict: '3 条候选合并后通过，转人工率上升到预期区间'
              } },
            { id: 'gray', name: '灰度上线', state: 'done', detail: '灰度 5% → 20% → 100%，已全量 12 天', count: null,
              gray: { ratio: 1, days: 12, autoRollback: '成功率<98% 或 P99>4s' } }
          ]
        }
      ]
    };

    return P;
  }

  /* SECTION: todo-aggregate
   * 待办聚合：总览页的核心。跨域收集"需要人处理"的事项。
   */
  /* v15：待办数字此前是**写死的字面量** —— 6 条里有几条恰好与数据一致，
     另一条写「1 个流程失败率偏高（合同初审流水线）」，而来源页按自己的阈值说「需关注 0」，
     两屏互相打脸。改为全部由数据推导，且与各页 KPI 用同一口径。 */
  function fmtWaitMin(m) {
    if (m == null) return '—';
    return m >= 60 ? (m / 60).toFixed(1) + ' 小时' : (m < 1 ? '刚刚' : Math.round(m) + ' 分钟');
  }
  function buildTodos() {
    var c = v10Collections();
    var q = c.queues || {};
    var out = [];

    /* 2026-10-21 单人系统：审批下线，这里原来那条「N 个审批待我处理」不再生成 ——
       没有第二个人发起，也没有第二个人来批；留着会变成一条点进去只能看存档的待办。 */

    /* badcase：待认领 —— 与 badcase 页「待认领」KPI 同口径 */
    var bc = ((q.badcase && q.badcase.items) || []).filter(function (x) { return !x.owner; });
    var bcP0 = bc.filter(function (x) { return x.level === 'P0' || x.level === 'P1'; }).length;
    out.push({ id: 'td-badcase', kind: 'badcase', count: bc.length, urgent: bcP0,
      text: bc.length + ' 条 badcase 待认领' + (bcP0 ? '，其中 ' + bcP0 + ' 条 P0/P1' : ''),
      target: { cap: 'obs' }, kindColor: bcP0 ? 'bad' : 'warn' });

    /* 合规待复核 —— 与合规页「待人工复核」KPI 同口径 */
    var cp = (q.compliance && q.compliance.items) || [];
    var cpMax = cp.length ? Math.max.apply(null, cp.map(function (x) { return x.waitMin; })) : 0;
    out.push({ id: 'td-comp', kind: '合规复核', count: cp.length, urgent: cp.filter(function (x) { return x.waitMin > 60; }).length,
      text: cp.length + ' 条内容待复核' + (cp.length ? '，最长已等待 ' + fmtWaitMin(cpMax) : ''),
      target: { cap: 'compliance' }, kindColor: 'warn' });

    /* 灰度决策 —— 与 Agent 工作台的灰度标记同源 */
    var gray = (S.AGENTS || []).filter(function (a) { return a.grayVersion; });
    out.push({ id: 'td-gray', kind: '灰度决策', count: gray.length, urgent: 0,
      text: gray.length + ' 个灰度版本等待转全量决策', target: { cap: 'agent-wb' }, kindColor: 'info' });

    /* 经验复核 —— 与经验库「待复核」KPI 同口径 */
    var exp = ((q.experience && q.experience.items) || []).filter(function (x) { return x.status === 'warn'; });
    out.push({ id: 'td-exp', kind: '经验复核', count: exp.length, urgent: 0,
      text: exp.length + ' 条经验条目待复核', target: { cap: 'llm-exp' }, kindColor: 'info' });

    /* 2026-10-20：Workflow 一页下线，原来那条 "td-wf（成功率 < 99% 需关注）" 待办随之删除 ——
       它的 target.cap 指向的入口已经不存在，留着就是一条点不进去的待办。 */

    return out;
  }

  /* SECTION: v10-lookup
   * v10 详情路由泛化（#/{domain}/{cap}/{objId}/{objTab}）后，详情页要"按 id 取一行"。
   * 这里只做取数与 join，不含任何业务判断；取不到一律 null / []，
   * 由页面显示空态，绝不允许白屏。
   */

  /** 全站集合懒加载索引：资产表 / 队列 / 流水线只构建一次（构建是确定性的） */
  var _v10Cache = null;
  function v10Collections() {
    if (_v10Cache) return _v10Cache;
    var A = global.APP_DATA || {};
    _v10Cache = {
      tables: A.getAssetTables ? A.getAssetTables() : {},
      queues: A.getQueues ? A.getQueues() : {},
      pipes: A.getPipelines ? A.getPipelines() : {}
    };
    return _v10Cache;
  }

  /** 集合别名 → seed.js 里的原始维度表 */
  function seedCollections() {
    return {
      agent: S.AGENTS, agents: S.AGENTS,
      model: S.MODELS, models: S.MODELS,
      bizline: S.BIZ_LINES, bizlines: S.BIZ_LINES,
      owner: S.OWNERS, owners: S.OWNERS,
      mcp: S.MCP_SERVICES, mcpservice: S.MCP_SERVICES, services: S.MCP_SERVICES,
      kbs: S.KBS,
      intent: S.INTENTS, intents: S.INTENTS,
      segment: S.SEGMENTS, segments: S.SEGMENTS,
      errorcode: S.ERROR_CODES, errors: S.ERROR_CODES,
      caller: S.CALLER_TYPES, callers: S.CALLER_TYPES,
      incident: S.INCIDENTS, incidents: S.INCIDENTS,
      deploy: S.DEPLOYS, deploys: S.DEPLOYS
    };
  }

  /** 取集合的行数组；collection 也可直接传数组（便于对任意 rows 复用） */
  function rowsOf(collection) {
    if (collection == null) return null;
    if (typeof collection === 'object' && typeof collection.length === 'number') return collection;
    var c = v10Collections();
    if (c.tables[collection]) return c.tables[collection].rows;
    if (c.queues[collection]) return c.queues[collection].items;
    if (c.pipes[collection]) return c.pipes[collection].items;
    var sc = seedCollections();
    return sc[String(collection).toLowerCase()] || null;
  }

  /** 按 id 在某个集合里取一行；取不到返回 null（页面据此显示空态，不许白屏） */
  function byId(collection, id) {
    if (id == null || id === '') return null;
    var rows = rowsOf(collection);
    if (!rows) return null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id === id) return rows[i];
    }
    return null;
  }

  /* 详情页"引用关系"用：这些字段存的是别的对象的 id（不含自身 id，避免自引用） */
  var REF_FIELDS = ['targetId', 'personaId', 'agentId', 'kbId', 'interviewId', 'sandboxId', 'mcpId', 'ruleId', 'ownerId'];

  /** 引用扫描范围：集合名 → 行数组 */
  function refScopes() {
    var c = v10Collections();
    var out = [], key;
    for (key in c.tables) { if (c.tables[key] && c.tables[key].rows) out.push([key, c.tables[key].rows]); }
    for (key in c.queues) { if (c.queues[key] && c.queues[key].items) out.push([key, c.queues[key].items]); }
    for (key in c.pipes) { if (c.pipes[key] && c.pipes[key].items) out.push([key, c.pipes[key].items]); }
    if (S.AGENTS) out.push(['agent', S.AGENTS]);
    if (S.DEPLOYS) out.push(['deploy', S.DEPLOYS]);
    if (S.INCIDENTS) out.push(['incident', S.INCIDENTS]);
    return out;
  }

  /** 通用：按多个字段模糊匹配（详情页的"引用关系"要用）。
   *  返回 [{ collection, field, id, name, row }]；kind 可选，只保留某类引用方集合。 */
  function refsOf(id, kind) {
    if (id == null || id === '') return [];
    var scopes = refScopes(), out = [], i, j, k;
    for (i = 0; i < scopes.length; i++) {
      var cname = scopes[i][0], rows = scopes[i][1];
      if (kind && kind !== cname) continue;
      for (j = 0; j < rows.length; j++) {
        var r = rows[j];
        if (!r) continue;
        var field = null;
        for (k = 0; k < REF_FIELDS.length; k++) {
          if (r[REF_FIELDS[k]] === id) { field = REF_FIELDS[k]; break; }
        }
        if (!field && r.agents && typeof r.agents.indexOf === 'function' && r.agents.indexOf(id) > -1) field = 'agents';
        if (field) {
          out.push({
            collection: cname, field: field, id: r.id,
            name: r.name || r.title || r.agentName || r.id, row: r
          });
        }
      }
    }
    return out;
  }

  /** 全站统计算力：供通知中心与总览聚合用（只做 join，不做业务判断）。
   *  四类来源全部取自 data.js 里已有的队列 / 维度表，数字不写死。 */
  function pendingStats() {
    var c = v10Collections();
    var n = { approvals: 0, compliance: 0, badcase: 0, gray: 0 };
    var i, rows;

    /* 审批队列：未决（无 decided 字段）的单据 */
    rows = (c.queues.approval && c.queues.approval.items) || [];
    for (i = 0; i < rows.length; i++) { if (rows[i] && !rows[i].decided) n.approvals++; }

    /* 合规队列：全部待复核内容 */
    rows = (c.queues.compliance && c.queues.compliance.items) || [];
    n.compliance = rows.length;

    /* badcase 队列：全部条目 */
    rows = (c.queues.badcase && c.queues.badcase.items) || [];
    n.badcase = rows.length;

    /* Agent 灰度：维度表里灰色版本未决（grayVersion 非空）的 Agent */
    rows = S.AGENTS || [];
    for (i = 0; i < rows.length; i++) { if (rows[i] && rows[i].grayVersion) n.gray++; }

    return n;
  }

  /* SECTION: s-level-rules
   * 判级规则表（**可枚举**）—— 「隔离等级」必须由这张表算出，
   * 判定方式原文未规定；此处按「场景 → 等级」对照表推导，不允许页面硬编码字符串。
   * preset 是 S1–S5 的**快捷映射**（创建向导里的三档预设），不是第二套口径。
   * reuseMode 是该等级**建议的**复用模式；池上的 reuseMode 可由用户覆盖。
   */
  var S_LEVEL_RULES = [
    { level: 'S0', taskKind: '普通问答',     runtime: '无（不起沙盒）',        net: '无',           data: '无',       reuseMode: 'reuse',     preset: 'Standard' },
    { level: 'S1', taskKind: '文本处理',     runtime: 'Container',             net: '禁止出网',      data: '临时数据',  reuseMode: 'reuse',     preset: 'Standard' },
    { level: 'S2', taskKind: 'Python 分析',  runtime: 'Container',             net: '白名单',        data: '临时数据',  reuseMode: 'reuse',     preset: 'Standard' },
    { level: 'S3', taskKind: '代码执行',     runtime: 'MicroVM',               net: '白名单',        data: '临时数据',  reuseMode: 'auto',      preset: 'Restricted' },
    { level: 'S4', taskKind: '企业系统操作', runtime: 'MicroVM',               net: 'Tool Gateway',  data: '授权数据',  reuseMode: 'ephemeral', preset: 'Restricted' },
    { level: 'S5', taskKind: '高风险操作',   runtime: 'MicroVM + 独立执行器',  net: '严格',          data: '最小权限',  reuseMode: 'ephemeral', preset: 'Highly Restricted' }
  ];
  var REUSE_LABEL = { reuse: '常驻复用', ephemeral: '用完即毁', auto: '按风险自动' };

  /** 判级：给任务类型，返回规则行（找不到回落到 S3）。判级依据必须可枚举。 */
  function sLevelOf(taskKind) {
    for (var i = 0; i < S_LEVEL_RULES.length; i++) {
      if (S_LEVEL_RULES[i].taskKind === taskKind) return S_LEVEL_RULES[i];
    }
    return S_LEVEL_RULES[3];
  }
  /** 「按风险自动」展开成实际模式：S0–S2 复用、S3 复用（可回收）、S4–S5 新建 */
  function resolveReuse(poolReuseMode, level) {
    if (poolReuseMode !== 'auto') return poolReuseMode;
    return (level === 'S4' || level === 'S5') ? 'ephemeral' : 'reuse';
  }

  global.APP_DATA = {
    domains: DOMAINS,
    caps: CAPS,
    getAssetTables: buildAssetTables,
    getQueues: buildQueues,
    getPipelines: buildPipelines,
    getTodos: buildTodos,
    /* v10 取数 helper（纯 join，挂在导出对象上供详情页/通知中心复用） */
    byId: byId,
    refsOf: refsOf,
    pendingStats: pendingStats,
    /* 企业主数据（模拟，当真数据用）：全池 / 按画像取命中集合 / 按 id 取 */
    /* Agent↔Agent（A2A）通信边：全量 / 按 Agent 取（我调用的 + 调用我的） / 按 id 取 */
    a2aEdges: a2aEdges,
    a2aOf: a2aOf,
    a2aEdgeById: a2aEdgeById,
    a2aTaskStates: A2A_TASK_STATES,
    firms: firmPool,
    firmsOf: firmsOf,
    firmById: firmById,
    /* 企业 / 标签 / 规模的身份图标（走查反馈：那一屏全是文字，分不清谁是谁） */
    firmIndustryIcon: firmIndustryIcon,
    firmIndustryTone: firmIndustryTone,
    firmTagIcon: firmTagIcon,
    firmScaleLevel: firmScaleLevel,
    /* v10 沙盒：判级规则表（可枚举）+ 复用模式（用户可选） */
    sLevelRules: S_LEVEL_RULES,
    sLevelOf: sLevelOf,
    resolveReuse: resolveReuse,
    reuseLabel: REUSE_LABEL
  };
})(window);
