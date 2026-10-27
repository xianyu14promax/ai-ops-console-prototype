/* SECTION: seed-core
 * 确定性数据基座。
 * 设计原则：同一 seed 永远产出同一份数据集 —— 刷新页面数字不变，
 * 这是"把模拟数据当真数据"的第一条：真实数据不会因为你看它两次就变。
 */
(function (global) {
  'use strict';

  /* SECTION: prng */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** 由字符串种子得到独立随机流：同一 seedStr 永远同一序列 */
  function rng(seedStr) { return mulberry32(hashStr(String(seedStr))); }

  var R = {
    /** 主随机流，生成期唯一，保证全局一致 */
    main: rng('aiops-dataset-v1'),
    /** 派生随机流：用于按 traceId 惰性生成 span，无需存储 */
    of: rng,
    pick: function (r, arr) { return arr[Math.floor(r() * arr.length)]; },
    int: function (r, min, max) { return min + Math.floor(r() * (max - min + 1)); },
    /** 近似对数正态：用于时延、token 等天然右偏分布 */
    logNormal: function (r, median, sigma) {
      var u = Math.max(r(), 1e-9), v = r();
      var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return median * Math.exp(sigma * z);
    },
    /** 按权重取样，weights 无需归一 */
    weighted: function (r, items, weightFn) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += weightFn(items[i], i);
      var x = r() * total, acc = 0;
      for (i = 0; i < items.length; i++) {
        acc += weightFn(items[i], i);
        if (x <= acc) return items[i];
      }
      return items[items.length - 1];
    }
  };

  /* SECTION: dim-model
   * 模型维度 + 示例计价。
   * 口径说明：单价为示例定价（元/千 token），用于成本推算；
   * 生产环境应替换为网关下发的真实计价表。
   * tierText 是给界面看的中文档位（模型名全是 qwen-xxx / embed-xxx，非技术同事看不出档次差别）。
   */
  var MODELS = [
    { id: 'qwen-max',    name: 'qwen-max',    tier: 'flagship', tierText: '旗舰', inPer1k: 0.020, outPer1k: 0.060, baseLatency: 1500, share: 0.22 },
    { id: 'qwen-plus',   name: 'qwen-plus',   tier: 'balance',  tierText: '均衡', inPer1k: 0.004, outPer1k: 0.012, baseLatency: 780,  share: 0.46 },
    { id: 'qwen-turbo',  name: 'qwen-turbo',  tier: 'economy',  tierText: '经济', inPer1k: 0.001, outPer1k: 0.002, baseLatency: 420,  share: 0.24 },
    { id: 'embed-v3',    name: 'text-embed-v3', tier: 'embed',  tierText: '向量', inPer1k: 0.0007, outPer1k: 0,    baseLatency: 120,  share: 0.08 }
  ];

  /* SECTION: dim-bizline */
  var BIZ_LINES = [
    { id: 'cs',      name: '客服线',     budget: 42000, peak: 'evening' },
    { id: 'sales',   name: '销售线',     budget: 30000, peak: 'workday' },
    { id: 'legal',   name: '法务线',     budget: 16000, peak: 'workday' },
    { id: 'ops',     name: '运营线',     budget: 22000, peak: 'workday' },
    { id: 'know',    name: '知识服务线', budget: 18000, peak: 'flat' }
  ];

  /* SECTION: dim-owner
   * 2026-10-21 业主定：**本系统只为一个账号服务**（一人公司 / 单人自用）。
   * 原先是 8 个虚构同事（张三/王五/赵六/孙琪/周明/吴桐/郑楠/李四），
   * 由此带出成员卡片、角色分配、彼此审批、互相复核一整套组织戏 —— 单人场景下全是废动作。
   * 现在 OWNERS 只剩唯一账号；**引用旧 uid 的地方一律查不到人**，
   * 查不到就显示「—」（见 nameOf），不再编造第二个人。 */
  var OWNERS = [
    { id: 'u102', name: 'xianyu', dept: '—' }
  ];
  /** uid → 姓名；查不到返回 ''（渲染层统一落成「—」，避免出现 undefined） */
  function nameOf(uid) {
    for (var i = 0; i < OWNERS.length; i++) if (OWNERS[i].id === uid) return OWNERS[i].name;
    return '';
  }

  /* SECTION: dim-agent
   * Agent 维度表。字段含义：
   *  - publishedAt / retiredAt 用于生成流量爬坡与衰减曲线（真实数据有生命周期）
   *  - grayVersion + grayRatio 让灰度对比拥有真实双组数据
   *  - errorBias / latencyBias 体现各 Agent 的固有差异，避免所有曲线长得一样
   *  - nowDoing（2026-10-21 加）：这台 Agent「此刻手上这一单在做什么」，给工作台卡片底行用。
   *    为什么放在数据层：它是**业务事实**（客服在处理售后工单、标书在写技术标第 3 章），
   *    不是在渲染里按名字瞎猜 —— 真实系统里这个字段应来自运行时 trace 的 running 记录。
   *    代码用例：query.js 的 nowEvent()，只取这个字段 + 该 Agent 最近一次调用的耗时。
   */
  var AGENTS = [
    { id: 'ag-cs-refund',  name: '客服助手 Agent',   biz: 'cs',    owner: '', model: 'qwen-plus',  online: 'v2.3', grayVersion: 'v2.4', grayRatio: 0.20, publishedAt: -186, dailyBase: 4200, errorBias: 1.00, latencyBias: 1.00, desc: '自动处理售后工单，覆盖退换货、物流与发票咨询', nowDoing: '正在处理退货退款工单 #T-88213' },
    { id: 'ag-cs-pre',     name: '售前咨询 Agent',   biz: 'cs',    owner: '', model: 'qwen-plus',  online: 'v1.8', grayVersion: null, grayRatio: 0, publishedAt: -142, dailyBase: 2600, errorBias: 0.82, latencyBias: 0.92, desc: '商品参数对比、选型建议与活动规则解答', nowDoing: '正在答复商品参数对比咨询' },
    { id: 'ag-sales-bid',  name: '标书生成 Agent',   biz: 'sales', owner: '', model: 'qwen-max',   online: 'v3.1', grayVersion: null, grayRatio: 0, publishedAt: -210, dailyBase: 320,  errorBias: 1.35, latencyBias: 3.10, desc: '按招标要求生成技术标与商务标章节', nowDoing: '正在撰写技术标第 3 章' },
    { id: 'ag-sales-lead', name: '线索评分 Agent',   biz: 'sales', owner: '', model: 'qwen-turbo', online: 'v2.0', grayVersion: null, grayRatio: 0, publishedAt: -96,  dailyBase: 3100, errorBias: 0.55, latencyBias: 0.48, desc: '对新增线索做意向分层与跟进优先级排序', nowDoing: '正在评分线索 L-88213' },
    { id: 'ag-legal-ctr',  name: '合同初审 Agent',   biz: 'legal', owner: '', model: 'qwen-max',   online: 'v1.4', grayVersion: 'v1.5', grayRatio: 0.05, publishedAt: -74, dailyBase: 260, errorBias: 1.18, latencyBias: 2.40, desc: '识别合同风险条款并给出修订建议', nowDoing: '正在初审采购合同（12 条）' },
    { id: 'ag-legal-comp', name: '合规问答 Agent',   biz: 'legal', owner: '', model: 'qwen-plus',  online: 'v2.2', grayVersion: null, grayRatio: 0, publishedAt: -158, dailyBase: 540, errorBias: 0.74, latencyBias: 1.05, desc: '回答广告法、数据合规与行业监管问题', nowDoing: '正在答复广告用语合规问题' },
    { id: 'ag-ops-copy',   name: '营销文案 Agent',   biz: 'ops',   owner: '', model: 'qwen-plus',  online: 'v4.0', grayVersion: null, grayRatio: 0, publishedAt: -233, dailyBase: 1450, errorBias: 0.91, latencyBias: 1.15, desc: '生成多渠道营销文案并做合规预检', nowDoing: '正在生成双 11 短信文案' },
    { id: 'ag-ops-seg',    name: '人群圈选 Agent',   biz: 'ops',   owner: '', model: 'qwen-turbo', online: 'v1.2', grayVersion: null, grayRatio: 0, publishedAt: -51, dailyBase: 380, errorBias: 0.68, latencyBias: 0.72, desc: '把自然语言运营诉求翻译为圈人条件', nowDoing: '正在圈选高潜复购人群' },
    { id: 'ag-kb-qa',      name: '知识问答 Agent',   biz: 'know',  owner: '', model: 'qwen-plus',  online: 'v5.2', grayVersion: null, grayRatio: 0, publishedAt: -298, dailyBase: 3600, errorBias: 0.63, latencyBias: 0.88, desc: '企业知识库统一问答入口', nowDoing: '正在检索差旅报销标准' },
    { id: 'ag-kb-sum',     name: '文档摘要 Agent',   biz: 'know',  owner: '', model: 'qwen-turbo', online: 'v2.6', grayVersion: null, grayRatio: 0, publishedAt: -187, dailyBase: 1180, errorBias: 0.49, latencyBias: 0.66, desc: '长文档结构化摘要与要点抽取', nowDoing: '正在摘要经营分析 12/28 页' },
    { id: 'ag-cs-qa',      name: '质检评分 Agent',   biz: 'cs',    owner: '', model: 'qwen-plus',  online: 'v1.9', grayVersion: null, grayRatio: 0, publishedAt: -119, dailyBase: 720, errorBias: 0.86, latencyBias: 1.28, desc: '对客服会话做质量抽检与评分', nowDoing: '正在抽检会话 CS-1182' },
    { id: 'ag-new-onb',    name: '新人引导 Agent',   biz: 'ops',   owner: '', model: 'qwen-turbo', online: 'v0.9', grayVersion: null, grayRatio: 0, publishedAt: -12, dailyBase: 640, errorBias: 1.62, latencyBias: 0.95, desc: '新客户 onboarding 引导（新上线，处于爬坡期）', nowDoing: '正在引导新客户第 2 步' },
    { id: 'ag-legacy-faq', name: '旧版 FAQ Agent',   biz: 'know',  owner: '', model: 'qwen-turbo', online: 'v1.1', grayVersion: null, grayRatio: 0, publishedAt: -402, retiredAt: -23, dailyBase: 900, errorBias: 1.44, latencyBias: 1.36, desc: '已于 23 天前下线，历史数据保留' }
  ];

  /* SECTION: dim-mcp
   * icon / tone / purpose 是这个服务的**身份**，不是装饰：6 个服务在网关健康墙、
   * Agent 详情的依赖表、网关详情页头反复出现，而它们只有一串等宽的 mcp://xxx/yyy ——
   * 扫一屏分不清谁是谁（走查实测反馈）。
   * tone 只取非状态色（蓝/紫/青/粉/青绿/靛）：绿=正常、琥珀=警告、红=异常在本系统里
   * 是状态语义，拿来当身份色会和健康状态打架。
   *
   * tools / offTools（v30 加）：这个服务**对外暴露哪些工具**，以及其中当前停用的。
   * 为什么要有这一层：网关页此前只答「这个服务健康吗」（QPS/错误率/P99），答不了
   * 「它到底能干什么、能干几件事」—— 而接入一个服务时人先问的正是后者。
   * 与 rw 同一条纪律：这是**数据层的事实声明**，真实系统里应来自 MCP 的 capability
   * 清单（tools/list），不在渲染里现推。停用的工具仍然登记在 tools 里 ——
   * 「停用」不等于「不存在」，界面上显示成 x/y 已启用。
   *
   * source（v30 加）：服务从哪来。内部中台尤其要分得清"平台自建"、"随插件带进来的"、
   * "对接的外部系统"—— 出问题时找的人不一样。
   */
  var MCP_SERVICES = [
    /* rw：读 / 写声明（v27 加，给「Agent 会话」判断"本轮有没有可回滚的改动"用）。
       依据是各服务自身的 purpose：查询 / 检索 / 明细 / 解析 属读，创建 / 推送 属写。
       这是**数据层的事实声明**，不在渲染里现推 —— 真实系统里这份声明应来自 MCP 的
       capability 清单；如果某个服务的实际语义与此不符，改这里一处即可。 */
    { id: 'mcp-crm-query',  name: 'mcp://crm/query',          kind: 'MCP', icon: 'crm',    tone: 'blue',   purpose: '客户与联系人查询', qpsCap: 60,  errorBias: 0.9, rw: 'read',
      source: 'local',
      tools: ['query_contact', 'get_contact_detail', 'search_by_company', 'list_recent_activity', 'resolve_uscc', 'export_contact_view'],
      offTools: ['export_contact_view'] },
    { id: 'mcp-kb-search',  name: 'mcp://knowledge/search',   kind: 'MCP', icon: 'search', tone: 'purple', purpose: '知识库检索',       qpsCap: 120, errorBias: 0.6, rw: 'read',
      source: 'local',
      tools: ['search_chunks', 'search_by_doc', 'hybrid_search', 'rerank', 'list_collections', 'get_chunk_context', 'fetch_document', 'collection_stats'] },
    { id: 'mcp-ticket',     name: 'mcp://ticket/create',      kind: 'MCP', icon: 'ticket', tone: 'cyan',   purpose: '创建工单',         qpsCap: 40,  errorBias: 1.3, rw: 'write',
      source: 'local',
      tools: ['create_ticket', 'update_ticket', 'add_comment', 'assign_ticket', 'close_ticket', 'attach_file'] },
    { id: 'mcp-order',      name: 'mcp://order/detail',       kind: 'MCP', icon: 'order',  tone: 'pink',   purpose: '订单明细查询',     qpsCap: 80,  errorBias: 1.9, rw: 'read',
      source: 'local',
      tools: ['get_order', 'list_orders', 'order_timeline', 'refund_status', 'shipping_track', 'order_items'] },
    { id: 'mcp-doc-parse',  name: 'mcp://doc/parse',          kind: 'MCP', icon: 'parse',  tone: 'teal',   purpose: '文档解析',         qpsCap: 25,  errorBias: 2.2, rw: 'read',
      source: 'plugin', sourceName: 'doc-parser',
      tools: ['parse_pdf', 'parse_docx', 'parse_xlsx', 'ocr_image', 'extract_tables', 'split_chunks'] },
    { id: 'mcp-notify',     name: 'mcp://notify/send',        kind: 'MCP', icon: 'bell',   tone: 'indigo', purpose: '消息通知推送',     qpsCap: 100, errorBias: 0.5, rw: 'write',
      source: 'external', sourceName: 'Webhook 网关',
      tools: ['send_im', 'send_wecom', 'send_sms', 'send_email', 'send_webhook', 'batch_send'],
      offTools: ['batch_send'] }
  ];

  /* SECTION: dim-kb */
  var KBS = [
    { id: 'kb-product', name: '产品文档库',   docs: 480, chunks: 6720, embed: 'embed-v3', chunkSize: 512, overlap: 64, lastSync: -2 , hue: 'blue' },
    { id: 'kb-policy',  name: '行业政策库',   docs: 320, chunks: 3840,  embed: 'embed-v3', chunkSize: 768, overlap: 96, lastSync: -1 , hue: 'indigo' },
    { id: 'kb-script',  name: '销售话术库',   docs: 240, chunks: 2160,  embed: 'embed-v3', chunkSize: 384, overlap: 48, lastSync: -4 , hue: 'teal' },
    { id: 'kb-case',    name: '售后案例库',   docs: 300, chunks: 3000,  embed: 'embed-v3', chunkSize: 512, overlap: 64, lastSync: -1 , hue: 'amber' },
    { id: 'kb-legal',   name: '合同条款库',   docs: 180, chunks: 3060,  embed: 'embed-v3', chunkSize: 1024, overlap: 128, lastSync: -7 , hue: 'purple' }
  ];

  /* SECTION: dim-skill
   * 技能包（Skill）资产表。
   *
   * 为什么 name 要跟 A2A 边的 skill 字段**逐字一致**：技能不是新造的一层数据，
   * 而是 data.js 里那些 A2A 委派边「办的那件事」被升格成可管理资产。
   * 引用方（谁委派给谁）与今日触发次数/A2A 失败率/P99 全部从边表 join 得到，
   * 这里**不重复登记**运行数据 —— 否则同一件事有了两个数，对不上时无法判断信谁。
   * 改名要连边表一起改，这正是把技能收成资产的代价与收益。
   *
   * invocable 取 DSH 的 skill 调用口径：
   *   model = 模型可自行触发（description 命中即加载）· user = 仅用户显式调用（/名称）
   *   · both = 两者皆可。真实系统里 disable-model-invocation 就落在 user 这一类，
   *   它必须有单独的入口，否则界面上看不见、也调不动。
   *
   * deps 只引已存在的资产 id（MCP_SERVICES / KBS / MODELS）—— 依赖写错会在
   * 「全部技能」表里显示成「依赖缺失」，这是刻意留的自检口子，不要用兜底文案盖掉。
   */
  var SKILLS = [
    {
      id: 'sk-policy-lookup', name: '政策条款检索', icon: 'policy', tone: 'blue',
      purpose: '取回退款 / 换货政策条款原文，带文档名与切片号',
      trigger: '用户问及退换货、退款时效，且回答必须给出处',
      invocable: 'both', version: 'v3.2', status: 'on', owner: '', updatedDay: -12,
      /* v30：补 mcp-order —— 退款口径按**订单状态**分档（未发货可直接退、已发货要走退货流程），
         所以这条技能除了检索条款，还要读订单明细。补它的另一个效果是：
         网关页那条未恢复的 P1 事故（影响 mcp://order/detail）会在这条技能上显示成
         「依赖的 mcp://order/detail 当前错误率超标」—— 同一个依赖，两页说法一致。 */
      deps: { mcp: ['mcp-kb-search', 'mcp-order'], kb: ['kb-policy'], model: 'qwen-plus' },
      body: '## 何时用\n用户提到退货、换货、退款时效，且要求给依据。\n\n## 步骤\n1. 抽取意图与商品类目；2. 读订单明细拿当前状态（未发货 / 已发货 / 已签收）；3. 检索行业政策库与产品文档库，按状态取对应口径；4. 命中条款按生效日期倒序取最新一版。\n\n## 输出\n条款原文（含文档名 + 切片号）+ 置信度 + 兜底话术。置信度 < 0.72 时不作答，转人工。'
    },
    {
      id: 'sk-compliance-precheck', name: '对外话术合规预检', icon: 'shield', tone: 'purple',
      purpose: '外发回复前查绝对化用语与承诺性表述',
      trigger: '回复将直接发给用户，且含承诺、价格或时效表述',
      invocable: 'model', version: 'v2.6', status: 'on', owner: '', updatedDay: -5,
      deps: { mcp: [], kb: ['kb-legal', 'kb-script'], model: 'qwen-plus' },
      body: '## 何时用\n任何将外发给终端用户的文本，尤其是带"最""保证""一定"的句子。\n\n## 规则来源\n合同条款库的规则条目 + 销售话术库的禁用词表，规则版本随库更新。\n\n## 输出\n放行 / 拦截（命中规则 id）/ 建议改写。被拦的进人工复核队列，不静默改写。'
    },
    {
      id: 'sk-bid-material', name: '方案素材生成', icon: 'folder', tone: 'cyan',
      purpose: '产出投标方案的章节骨架与可引用案例',
      trigger: '售前接到新客户方案需求，需要骨架与案例素材',
      invocable: 'model', version: 'v1.4', status: 'on', owner: '', updatedDay: -34,
      deps: { mcp: ['mcp-doc-parse'], kb: ['kb-case', 'kb-product'], model: 'qwen-max' },
      body: '## 何时用\n新客户方案从零起草时。\n\n## 步骤\n1. 按行业取案例库命中项；2. 生成章节骨架；3. 每个论据挂一个可追溯的案例 artifactId。\n\n## 纪律\n案例必须来自案例库，不允许模型自行编造客户名与数据。'
    },
    {
      id: 'sk-clause-risk', name: '风险条款标注', icon: 'contract', tone: 'pink',
      purpose: '在合同文本里标出风险条款与对应法规条目',
      trigger: '合同 / 协议文本进入初审',
      invocable: 'model', version: 'v2.1', status: 'on', owner: '', updatedDay: -8,
      deps: { mcp: ['mcp-doc-parse'], kb: ['kb-legal'], model: 'qwen-max' },
      body: '## 何时用\n合同、补充协议、订单条款进入初审。\n\n## 步骤\n1. 切片并编号；2. 逐条比对法规库；3. 按风险等级（高/中/低）输出清单。\n\n## 边界\n只做标注与建议，**不出具法律意见**；判定权归法务。'
    },
    {
      id: 'sk-bid-precheck', name: '标书合规预检', icon: 'checklist', tone: 'teal',
      purpose: '提交前扫绝对化用语与废标风险段落',
      trigger: '标书章节定稿、提交投标之前',
      invocable: 'model', version: 'v1.2', status: 'on', owner: '', updatedDay: -21,
      deps: { mcp: [], kb: ['kb-legal'], model: 'qwen-plus' },
      body: '## 何时用\n投标文件定稿、用印之前，最后一次全量扫描。\n\n## 规则\n招标投标法实施条例的绝对化用语清单 + 本项目历年被废标案例。\n\n## 输出\n违规段落 + 命中规则 + 替换建议，逐段给出。'
    },
    {
      id: 'sk-doc-index', name: '长文切片与索引', icon: 'parse', tone: 'indigo',
      purpose: '解析长文档并按目标知识库参数切片入库',
      trigger: '新文档入知识库，且长度超过单次上下文',
      invocable: 'both', version: 'v4.0', status: 'on', owner: '', updatedDay: -3,
      deps: { mcp: ['mcp-doc-parse'], kb: ['kb-product'], model: 'embed-v3' },
      scripts: ['scripts/split_index.py'],
      body: '## 何时用\nPDF / Word 入库前。\n\n## 步骤\n1. 解析为结构化文本；2. 按目标知识库的 chunkSize / overlap 切片；3. 向量化并写索引，返回切片数与向量条数。\n\n## 脚本\nscripts/split_index.py —— 本地切片校验，入库前先跑一遍看边界是否切断了表格。'
    },
    {
      id: 'sk-lead-score', name: '线索价值评分', icon: 'chart', tone: 'blue',
      purpose: '给候选企业打分分档，排跟进优先级',
      trigger: '圈选出一批候选企业，需要排优先级',
      invocable: 'model', version: 'v2.3', status: 'on', owner: '', updatedDay: -17,
      deps: { mcp: ['mcp-crm-query'], kb: [], model: 'qwen-turbo' },
      body: '## 何时用\n人群圈选产出候选名单之后。\n\n## 输入\n统一社会信用代码 + 行业 + 行为特征。\n\n## 输出\n评分 + 分档（高/中/低）+ **缺失字段清单** —— 拿不到年采购额时回问，不猜。'
    },
    {
      id: 'sk-onboard-faq', name: '新人常见问题检索', icon: 'book', tone: 'purple',
      purpose: '回答新人制度类问题并给出处链接',
      trigger: '新人提问涉及公司制度、报销、流程',
      invocable: 'both', version: 'v1.6', status: 'on', owner: '', updatedDay: -9,
      deps: { mcp: ['mcp-kb-search'], kb: ['kb-policy'], model: 'qwen-turbo' },
      body: '## 何时用\n入职 30 天内的提问。\n\n## 纪律\n只答制度类问题，给出处链接；答不出时说不知道，**不推测**。'
    },
    /* 下面两个是「零引用」样本：技能目录里一定会有没人用的条目，
       要么推广、要么下线 —— 这正是 Skill 页要暴露的那类决策，
       所以数据层必须真的存在这种条目，而不是在界面上写一句静态提示。 */
    {
      id: 'sk-quote', name: '报价单生成', icon: 'currency', tone: 'teal',
      purpose: '按客户规模与折扣政策生成报价单草稿',
      trigger: '销售提交报价申请，且客户已完成资质校验',
      invocable: 'user', version: 'v0.9', status: 'gray', owner: '', updatedDay: -2,
      deps: { mcp: ['mcp-crm-query'], kb: ['kb-product'], model: 'qwen-plus' },
      body: '## 状态\n灰度中，未接入任何 Agent 的编排，只能由用户在会话里用 /报价单生成 调用。\n\n## 何时用\n销售提交报价申请时。\n\n## 边界\n折扣超过政策上限时必须转审批，技能自身不做例外判断。'
    },
    {
      id: 'sk-meeting-notes', name: '会议纪要结构化', icon: 'clipboard', tone: 'purple',
      purpose: '把会议转写文本整理成决议、待办与责任人',
      trigger: '上传会议转写文本，需要产出纪要与待办',
      invocable: 'both', version: 'v1.0', status: 'on', owner: '', updatedDay: -46,
      deps: { mcp: [], kb: [], model: 'qwen-plus' },
      body: '## 何时用\n会议转写文本落库后。\n\n## 输出\n决议 / 待办（含责任人）/ 悬而未决 三栏。\n\n## 现状\n上线 46 天，零 Agent 引用、零调用 —— 待决策：推广或下线。'
    }
  ];

  /* SECTION: dim-intent */
  var INTENTS = [
    { id: 'refund',      name: '退货退款',   weight: 22, tokens: 1.35, latency: 1.10 },
    { id: 'logistics',   name: '物流查询',   weight: 18, tokens: 0.72, latency: 0.68 },
    { id: 'product',     name: '产品咨询',   weight: 16, tokens: 1.05, latency: 0.95 },
    { id: 'invoice',     name: '发票开具',   weight: 9,  tokens: 0.88, latency: 0.82 },
    { id: 'complaint',   name: '投诉处理',   weight: 7,  tokens: 1.62, latency: 1.34 },
    { id: 'doc-gen',     name: '文档生成',   weight: 8,  tokens: 3.40, latency: 2.85 },
    { id: 'data-query',  name: '数据查询',   weight: 11, tokens: 0.94, latency: 1.12 },
    { id: 'other',       name: '其他',       weight: 9,  tokens: 1.00, latency: 1.00 }
  ];

  /* SECTION: dim-segment */
  var SEGMENTS = [
    { id: 'vip',     name: 'VIP 客户',   weight: 12 },
    { id: 'ent',     name: '企业客户',   weight: 26 },
    { id: 'smb',     name: '中小客户',   weight: 34 },
    { id: 'consumer',name: '个人用户',   weight: 21 },
    { id: 'internal',name: '内部员工',   weight: 7 }
  ];

  /* SECTION: dim-error
   * 错误码维度。分布权重决定失败原因构成，
   * 使"错误分类"图有稳定的、可解释的结构而非随机噪声。
   */
  var ERROR_CODES = [
    { id: 'E_MODEL_TIMEOUT',  name: '模型超时',        weight: 26, retryable: true,  http: 504 },
    { id: 'E_TOOL_FAIL',      name: '工具调用失败',    weight: 24, retryable: true,  http: 502 },
    { id: 'E_RATE_LIMIT',     name: '网关限流',        weight: 17, retryable: true,  http: 429 },
    { id: 'E_COMPLIANCE',     name: '合规拦截',        weight: 13, retryable: false, http: 451 },
    { id: 'E_BAD_PARAMS',     name: '入参校验失败',    weight: 11, retryable: false, http: 400 },
    { id: 'E_MODEL_ERROR',    name: '模型服务异常',    weight: 6,  retryable: true,  http: 500 },
    { id: 'E_CTX_OVERFLOW',   name: '上下文超限',      weight: 3,  retryable: false, http: 413 }
  ];

  /* SECTION: dim-caller
   * 2026-10-20：Workflow 页下线后，调用方类型里原来那条 name:'Workflow' 改成「外部编排」——
   * id 仍是 workflow（口径与占比 38% 不动），只是不再冒用已经下线的产品名：
   * 这批 trace 的语义是「由外部编排引擎发起」，不是「由本平台的 Workflow 能力发起」。 */
  var CALLER_TYPES = [
    { id: 'direct', name: '直接调用', weight: 46 },
    { id: 'workflow', name: '外部编排', weight: 38 },
    { id: 'api', name: '外部 API', weight: 11 },
    { id: 'unknown', name: '未标记来源', weight: 5 }  /* 归因覆盖率的缺口来源，故意保留 */
  ];

  /* SECTION: dim-incident
   * 植入的异常事件。真实数据一定有事故，
   * 没有事故的监控数据反而不可信。
   * dayOffset 为相对今天的天数（负数=过去），hourRange 为当天时段。
   */
  var INCIDENTS = [
    {
      id: 'inc-2026-0927-gw', dayOffset: -5, hourStart: 14, hourEnd: 16,
      title: 'MCP 网关连接池耗尽', level: 'P1',
      affect: { errorMul: 6.5, latencyMul: 2.4, errorCodes: ['E_TOOL_FAIL', 'E_RATE_LIMIT'] },
      rootCause: 'mcp://order/detail 上游响应变慢导致连接未释放，连接池打满',
      resolvedAt: -5, resolvedBy: 'u103', action: '扩容连接池并加熔断'
    },
    {
      id: 'inc-2026-0929-model', dayOffset: -2, hourStart: 9, hourEnd: 11,
      title: 'qwen-max 服务端抖动', level: 'P0',
      affect: { errorMul: 9.0, latencyMul: 3.2, errorCodes: ['E_MODEL_TIMEOUT', 'E_MODEL_ERROR'], models: ['qwen-max'] },
      rootCause: '模型服务侧容量不足，高峰期请求排队超时',
      resolvedAt: -2, resolvedBy: 'u103', action: '临时降级至 qwen-plus 并扩容'
    },
    {
      id: 'inc-2026-0930-kb', dayOffset: -1, hourStart: 20, hourEnd: 23,
      title: '知识库索引重建期间检索命中率下降', level: 'P2',
      affect: { errorMul: 2.2, latencyMul: 1.3, errorCodes: ['E_TOOL_FAIL'] },
      rootCause: '行业政策库全量重建索引，检索服务降级为旧快照',
      resolvedAt: -1, resolvedBy: 'u106', action: '改为增量索引 + 双版本切换'
    },
    /* C-1c：补一条**进行中**的事故。
       此前 3 条全部已填 resolvedAt ⇒ 所谓「事故处理台」里**没有任何未恢复的事故**，
       三态（open/ack/resolved）不可达。只有真的存在未恢复事故，这个区域才从"档案柜"变成处理台。
       v30：补 services —— 事故影响哪个服务必须落在数据上。此前只有 rootCause 里一句散文
       「怀疑与上游 mcp://order/* 变更有关」，于是出现「网关健康墙 6/6 全绿」与
       「有一条未恢复的 P1」同屏打架。现在 QUERY 的 mcpHealth 读这个字段：
       有未恢复事故的服务在健康墙上直接标异常，并把错误率/时延按事故倍数放大 —— 数字和状态说同一件事。 */
    {
      id: 'inc-2026-1001-gw', dayOffset: 0, hourStart: 10, hourEnd: 12,
      title: 'MCP 工具调用失败率飙升（进行中）', level: 'P1',
      services: ['mcp-order'],
      affect: { errorMul: 4.2, latencyMul: 1.8, errorCodes: ['E_TOOL_FAIL', 'E_MODEL_TIMEOUT'] },
      rootCause: '（待定位）已排除网络与容量，怀疑与上游 mcp://order/* 变更有关',
      resolvedAt: null, resolvedBy: null, action: null
    }
  ];

  /* SECTION: dim-todo-filter
   * C-1a：每个待办项的**筛选语义**。
   * 为什么需要：待办是**聚合数**（"N 个审批待我处理"），没有"单个对象"可传；
   *   所以点进去要带的是**筛选条件**，而不是对象 id。
   * 这里的描述与 data.js 的 buildTodos 里的过滤条件**一一对应**（同一份口径）。
   */
  var TODO_FILTERS = {
    /* td-appr（审批 · 待我审批）2026-10-21 删除：单人系统里审批已下线，没有"等我批"的单子 */
    'td-badcase': { cap: 'obs',        label: 'badcase · 待认领', filter: { owner: null } },
    'td-comp':    { cap: 'compliance', label: '合规 · 待人工复核', filter: { decided: false } },
    'td-gray':    { cap: 'agent-wb',   label: '灰度 · 等待转全量决策', filter: { hasGrayVersion: true } },
    'td-exp':     { cap: 'llm-exp',    label: '经验 · 待复核', filter: { status: 'warn' } }
  };

  /* SECTION: dim-kb-eval
   * 检索评测集（qrels 形态）。
   * 🔴 C-4（第21屏问题③）：此前**没有评测集**，检索测试只能单次定性看，
   *   无法定量回答"这套参数到底比那套好多少"。
   *
   * 数据性质：**示例评测集**（本原型无后端，取不到真实标注）。
   *   30 条 = 覆盖 5 个库 × 6 条；每条含 query 与**相关切片数** rel（ground truth）。
   *   指标与参数扫描都由它算出 —— 换了参数，分数会真的变。
   */
  var KB_EVAL = (function () {
    var KBIDS = ['kb-product', 'kb-policy', 'kb-script', 'kb-case', 'kb-legal'];
    var QS = [
      ['退货政策适用哪些商品', 3], ['企业版怎么开专票', 2], ['API 限流阈值', 1],
      ['数据出境要做哪些申报', 2], ['个人信息保存期限', 2], ['算法备案流程', 1],
      ['竞品对比怎么说', 2], ['价格异议处理话术', 3], ['续约异议怎么接', 2],
      ['物流延迟怎么赔付', 2], ['超七天退货案例', 3], ['重复扣款怎么处理', 2],
      ['违约金上限', 2], ['保密条款例外', 2], ['合同解除条件', 3], ['不可抗力认定', 1]
    ];
    var out = [], n = 0;
    for (var i = 0; i < 30; i++) {
      var kb = KBIDS[i % KBIDS.length];
      var qa = QS[i % QS.length];
      /* rel：ground truth 的相关切片数（1–3），由索引确定性派生而非随机，
         保证同一份评测集每次打开一致 */
      var rel = qa[1];
      /* gold：该查询在库中**应当**被召回的相关切片编号（1-based），用于算 Precision */
      var gold = [];
      for (var g = 0; g < rel; g++) gold.push(1 + ((i + g) % 4));
      out.push({ id: 'ke-' + (++n), kbId: kb, q: qa[0], rel: rel, gold: gold });
    }
    return out;
  })();

  /* SECTION: dim-kb-miss
   * 检索未命中日志。
   * 🔴 C-3（第 11 屏问题①）：此前**零结果率只是一个数**，不落在任何对象上 ——
   *   界面上唯一动作是「去检索测试」（单条试查），而真正该做的是
   *   「哪些查询没命中 ⇒ 补哪份文档 / 调哪个参数」。
   *
   * 数据性质：**示例数据**（本原型无后端，取不到真实检索日志）。
   *   条目按知识库的真实定位与切片策略构造，界面上必须标「示例」。
   *   结构刻意做成"可执行清单"要用的形态：查询 + 次数 + 无命中原因 + 建议动作。
   */
  var KB_MISSES = [
    { id: 'km-1', kbId: 'kb-product', q: '企业版能不能开专票', n: 428, days: 7,
      cause: 'no_doc', hint: '产品文档库无「发票 / 开票」类目，此类问题此前由客服口头答复，未入库',
      suggest: { type: 'addDoc', label: '补「开票与发票」类目' } },
    { id: 'km-2', kbId: 'kb-policy', q: '2026 年数据出境新规怎么要求', n: 361, days: 7,
      cause: 'stale', hint: '政策库最近同步 1 天前，但该政策在同步窗口之后发布',
      suggest: { type: 'syncNow', label: '立即同步并核对增量' } },
    { id: 'km-3', kbId: 'kb-case', q: '超过七天还能退货吗', n: 297, days: 7,
      cause: 'threshold', hint: '文档存在但相似度落在 0.62–0.71，低于当前阈值 0.72',
      suggest: { type: 'threshold', label: '该库阈值下调至 0.68 试算' } },
    { id: 'km-4', kbId: 'kb-legal', q: '对方逾期付款违约金上限', n: 214, days: 7,
      cause: 'chunk', hint: '条款库切片 1024 字，违约金条款与相邻条文被切在同一块，召回后排序偏低',
      suggest: { type: 'chunk', label: '该库切片改为 768 / overlap 96' } },
    { id: 'km-5', kbId: 'kb-script', q: '竞品报价对比话术', n: 186, days: 7,
      cause: 'no_doc', hint: '话术库无「竞争对比」类目（合规上需法务先审核话术）',
      suggest: { type: 'addDoc', label: '走法务审核后补话术' } },
    { id: 'km-6', kbId: 'kb-product', q: 'API 限流阈值是多少', n: 143, days: 7,
      cause: 'no_doc', hint: '技术文档未纳入本库（本库仅含面向客户的产品说明）',
      suggest: { type: 'routeElsewhere', label: '不是本库职责 → 指向技术文档库' } }
  ];

  /* SECTION: dim-deploy
   * 植入的发布事件，用于在时序图上标记竖线，
   * 让"发布后指标变化"可被观察。
   */
  var DEPLOYS = [
    { id: 'dep-1', agentId: 'ag-cs-refund', version: 'v2.4', dayOffset: -3, hour: 15, kind: 'gray', note: '灰度 20%：升级模型 + 新增合规检查节点' },
    { id: 'dep-2', agentId: 'ag-new-onb',  version: 'v0.9', dayOffset: -12, hour: 11, kind: 'release', note: '新 Agent 首次上线' },
    { id: 'dep-3', agentId: 'ag-legal-ctr',version: 'v1.5', dayOffset: -6, hour: 10, kind: 'gray', note: '灰度 5%：条款识别提示词重写' },
    { id: 'dep-4', agentId: 'ag-legacy-faq',version: 'v1.1', dayOffset: -23, hour: 18, kind: 'offline', note: '旧版 FAQ 下线，流量迁移至知识问答 Agent' }
  ];

  /* SECTION: time-anchor */
  var NOW = new Date();
  var TODAY_START = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
  var DAY = 86400000;
  /** 数据窗口：过去 N 天（含今天）。30 天足以支撑月度口径与同比环比 */
  var WINDOW_DAYS = 30;
  var WINDOW_START = TODAY_START - (WINDOW_DAYS - 1) * DAY;

  /** 日内负载曲线：0-23 时的相对权重。B2B 双峰、客服晚间峰 */
  var HOUR_CURVE = {
    workday: [0.4,0.3,0.2,0.2,0.3,0.6,1.2,2.4,3.6,4.4,4.8,4.5,3.4,3.6,4.4,4.7,4.2,3.2,2.2,1.6,1.2,0.9,0.7,0.5],
    evening: [0.5,0.4,0.3,0.2,0.2,0.4,0.8,1.4,2.0,2.4,2.6,2.5,2.2,2.3,2.6,2.8,3.2,4.0,4.8,5.2,4.6,3.4,2.2,1.2],
    flat:    [0.8,0.6,0.5,0.4,0.5,0.8,1.4,2.0,2.6,3.0,3.2,3.1,2.8,2.9,3.1,3.2,3.0,2.6,2.1,1.7,1.4,1.2,1.0,0.9]
  };
  /** 星期系数：周六周日 B2B 明显下降，客服略降 */
  function weekdayFactor(peak, dow) {
    if (peak === 'evening') return [0.72, 1.06, 1.08, 1.05, 1.04, 1.02, 0.78][dow];
    if (peak === 'flat')    return [0.85, 1.03, 1.04, 1.03, 1.02, 1.00, 0.88][dow];
    return [0.34, 1.14, 1.16, 1.10, 1.08, 1.05, 0.38][dow]; // workday
  }

  /* SECTION: dim-identity
   * 登录身份（单一数据源）。
   *
   * 为什么必须集中：此前全站没有 user/me 字段，顶栏写死「运」、
   * 审批页口径写「当前用户 = 李四」、数据里 owner 叫「李四」—— 三处对不上。
   * 现在凡是要显示「我是谁」的地方，一律读 ME，不许再硬编码字符串。
   *
   * role / perms 是给账号菜单与「我的权限」看的；本原型尚未接入真门禁，
   * 但数据先立起来，后续加 checkPerm 不用回头改所有渲染点。
   */
  var ME = {
    id: 'u102',
    name: 'xianyu',
    dept: '所有者',
    role: '平台管理员',
    roleId: 'r-admin',
    roleShort: '管理员',
    mail: 'xianyu@local',
    initials: 'x',
    tenant: 'company_A',
    /* 单账号系统：没有「邀请成员」「切换身份」，也没有第二个人可以代理审批 */
    solo: true,
    /* 演示环境不具备真实会话，令牌过期时间仅用于说明机制 */
    session: { issuedMin: 42, ttlMin: 480 },
    /* 权限点由角色推导（见 rolePerms），不再手写 —— 手写必然与角色矩阵漂移。 */
    perms: null
  };
  /* v20 修复（声明顺序）：perms 推导挪到 ROLE_PERM_MAP / PERM_POINTS 赋值之后执行。
     原先写在这里，var 声明虽提升但赋值未提升 —— 运行到这行时两个表都是 undefined，直接 TypeError。
     真正的推导调用见文件尾（global.DATA_SEED 之前）。 */

  /* SECTION: dim-rbac
   * 权限点表 + 角色矩阵。
   *
   * 此前全站只有一堆散落的 perm 字符串（写在 dangerConfirm 的 opts.perm 里），
   * 没有任何一处真正校验 —— 界面写着「所需权限 xxx」，实际人人可点。
   * 这里把权限点集中登记为一张表，角色绑定权限点集合，
   * checkPerm(perm) 才有唯一事实来源可查。
   *
   * risk: high 的权限点会触发额外门禁（要求二次确认 + 强制填理由）。
   *
   * plane / tier / act —— 三个**正交**的分档，不要互相推导：
   *   plane  mgmt   改变系统以后的行为（配置 / 定义 / 策略 / 发布 / 启停 / 资源增删）
   *          data   读写业务数据，或对运行中的东西与外部世界动手
   *                 （导出、读原始日志、运行时干预、对外触达真人）
   *          两个平面的权限**独立评估**（Microsoft 对 AI 工作负载的管理面/数据面划分）
   *   tier   0      身份 / 权限 / 凭证控制平面（改「谁能做什么」）
   *          1      业务资源的生命周期与数据
   *          2      只读与个人动作
   *          依据 MS AD DS Tier Model。tier:0 只有这 8 条：
   *            rbac:role:write · rbac:member:write
   *            approval:authrule:write / enable / disable · approval:flow:write
   *            gateway:key:rotate · gateway:key:revoke
   *   act    each   每次都要批：不可逆 / 对外发送 / 权限与凭证变更 / 数据出口
   *          first  首次批、期内免：可逆的资源绑定与启停
   *          auto   免批留痕：只读、计算、以及本身就是审批的动作
   */
  var PERM_POINTS = [
    /* 审批治理 */
    { p: 'approval:decide:approve', label: '审批通过', grp: '审批治理', risk: 'high', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'approval:decide:reject', label: '审批驳回', grp: '审批治理', risk: 'high', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'approval:decide:escalate', label: '转交上级', grp: '审批治理', risk: 'mid', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'approval:authrule:enable', label: '启用授权规则', grp: '审批治理', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'approval:authrule:disable', label: '停用授权规则', grp: '审批治理', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'approval:create', label: '发起审批', grp: '审批治理', risk: 'low', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'approval:authrule:write', label: '新建授权规则', grp: '审批治理', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    /* 审批流配置（操作类型 / 审批链路 / 条件路由 / SLA）此前是**写死在渲染里的 5 行静态表**，
       卡名却叫「配置」—— 名实不符。改为真可编辑：增 / 改 / 删（软删，可恢复）。 */
    { p: 'approval:flow:write', label: '配置审批流', grp: '审批治理', risk: 'mid', plane: 'mgmt', tier: 0, act: 'each' },
    /* 合规 */
    { p: 'compliance:decide', label: '合规判定', grp: '合规', risk: 'mid', plane: 'data', tier: 1, act: 'auto' },
    { p: 'compliance:rulepack:publish', label: '合规规则包发布', grp: '合规', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'compliance:rulepack:backtest', label: '规则回测', grp: '合规', risk: 'low', plane: 'mgmt', tier: 1, act: 'auto' },
    /* 🔴 补注册：动作传的是 `'compliance:rulepack:' + m.state`，m.state ∈ disabled/enabled/rolledback
       —— 这三点此前只在注册表里没有 ⇒ 仅 r-admin（全权限）能点，其余角色全部被拦（校验 12） */
    { p: 'compliance:rulepack:enabled', label: '启用规则包', grp: '合规', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'compliance:rulepack:disabled', label: '停用规则包', grp: '合规', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'compliance:rulepack:rolledback', label: '回滚规则包', grp: '合规', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    /* Agent 生命周期 */
    { p: 'agent:publish', label: 'Agent 全量发布', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:gray:promote', label: '灰度转全量', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:gray:rollback', label: '灰度回滚', grp: 'Agent', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'agent:retire', label: 'Agent 下线', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:notifyRefs', label: '通知引用方', grp: 'Agent', risk: 'low', plane: 'mgmt', tier: 2, act: 'auto' },
    /* v26c：Agent 关系图上的「断开 / 新增关系」—— 这两件事改的是**真实依赖**（A2A 边表、
       经验的 agents[]、编排模板的 MCP 节点），比改名字危险得多，所以单列权限点。
       r-ops 持有 'agent:*' 通配，因此业务运营可直接用；r-arch 只持有显式列出的 agent 权限，
       会被拦下并告知找谁授权（这正是权限矩阵该有的差别）。 */
    { p: 'agent:rel:detach', label: '断开 Agent 关系', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:rel:attach', label: '新增 Agent 关系', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* v27：Agent 详情「会话与干预」Tab —— 人插手 Agent 正在做的事。四道门分开列，
       因为它们的风险完全不同：喊停（可恢复）< 改本轮产物（不可逆）< 批准高危动作 / 接管（责任转移）。
       r-ops 持有 'agent:*' 通配，业务运营四条都过；r-arch 只显式给了「干预」一条，
       点「接管 / 批准 / 自主模式」会被拦下并提示找谁授权 —— 权限矩阵该有的差别。 */
    { p: 'agent:intervene', label: '干预 Agent 会话（暂停/中断/追加指令）', grp: 'Agent', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'agent:session:autonomy', label: '调整 Agent 自主权限', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:approve', label: '批准 Agent 高危动作', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:takeover', label: '接管 Agent 会话', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:round:rollback', label: '回滚 Agent 本轮改动', grp: 'Agent', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* v34（2026-10-15，业主清单第 ⑥ 项）：工具授权与自动回滚策略**可编辑**之后新增的权限点。
       风险分级落在权限点上（不是各页面自己定一套）：只读授权低危、写授权高危（强制理由）、
       收回中危、调整回滚条件高危。角色矩阵与审批页读同一份，所以这里登记了才算数。 */
    { p: 'agent:tool:grant', label: '授予 Agent 只读工具', grp: 'Agent', risk: 'low', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:tool:grant:write', label: '授予 Agent 写工具（高危）', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'agent:tool:revoke', label: '收回 Agent 工具授权', grp: 'Agent', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'agent:rollback:rule', label: '调整自动回滚条件', grp: 'Agent', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* v37（2026-10-18）：Agent「联系」页（管理 › 联系）新增两类绑定动作 ——
       技能与知识库的挂载/摘除。它们改的是"这个 Agent 和谁连"，不改能力本身，
       所以都是低危（挂）/中危（摘）；角色矩阵读同一份：r-ops 的 agent:* 与 knowledge:* 直接覆盖。 */
    { p: 'agent:skill:bind', label: '给 Agent 挂载/摘除技能', grp: 'Agent', risk: 'low', plane: 'mgmt', tier: 1, act: 'each' },
    /* 知识与经验 */
    { p: 'llm-exp:entry:verified', label: '经验复核通过', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'llm-exp:entry:rejected', label: '经验驳回', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'llm-exp:entry:deprecated', label: '经验弃用', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'llm-exp:entry:restore', label: '经验恢复', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 经验正文编辑 —— 此前经验只有「复核 / 驳回 / 弃用 / 恢复」四个生命周期动作，
       正文四段（触发条件 / 处置策略 / 禁忌 / 示例）**建完就改不动**。
       管理型的「改」在经验库上缺的正是这一刀。 */
    { p: 'llm-exp:entry:edit', label: '编辑经验正文', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 经验升级为共享 —— 把一条已验证的经验扩大可见范围，别人引用过就收不回，故 act 归 each。
       原先由 v23-exp-agent-link.js 在加载时 push 注册；权限点登记统一放在本表。 */
    { p: 'llm-exp:entry:share', label: '经验升级为共享', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* 画像生命周期 —— 管理型对象必须能停用/恢复。此前画像没有任何权限点，
       「登记更新」连门禁都没走；这条补上，与新加的「停用/恢复画像」配套。 */
    { p: 'persona:lifecycle:disable', label: '停用画像', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'persona:lifecycle:restore', label: '恢复画像', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 画像内容编辑 —— 此前画像只能改「状态」（停用/恢复）与「登记更新」，
       名称 / 类型 / 行业 / 负责人 / 标签这些**内容字段建完改不动**。
       管理型的「改」在画像库上缺的正是这一刀。 */
    { p: 'persona:content:edit', label: '编辑画像内容', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 知识库整库停用/恢复 —— 此前只有**文档级**下线，已发布的库无法整体下架。
       停用 = 移出检索池（Agent 检索不再命中），文档与配置都留着，可恢复。 */
    { p: 'knowledge:kb:disable', label: '停用知识库', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    /* v37：把知识库挂到某个 Agent 上 / 摘下来（只改这个 Agent 的检索范围，不动库本身） */
    { p: 'knowledge:kb:bind', label: '给 Agent 挂载/摘除知识库', grp: '知识经验', risk: 'low', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'knowledge:kb:restore', label: '恢复知识库', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 企业知识库（v17 批 A：上传/下线/删除文档、重建/回滚索引、发布） */
    { p: 'knowledge:doc:upload', label: '上传文档', grp: '知识经验', risk: 'low', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'knowledge:doc:offline', label: '下线文档', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'knowledge:doc:delete', label: '删除文档', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'knowledge:index:rebuild', label: '重建索引', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'knowledge:index:rollback', label: '回滚索引', grp: '知识经验', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'knowledge:kb:publish', label: '发布知识库', grp: '知识经验', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* 沙盒 */
    { p: 'sandbox:create', label: '创建沙盒', grp: '沙盒', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'sandbox:config:write', label: '沙盒配置', grp: '沙盒', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'sandbox:operate', label: '沙盒启停', grp: '沙盒', risk: 'mid', plane: 'data', tier: 1, act: 'first' },
    { p: 'sandbox:destroy', label: '销毁沙盒', grp: '沙盒', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'sandbox:network:write', label: '沙盒网络策略', grp: '沙盒', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'sandbox:process:kill', label: '终止进程', grp: '沙盒', risk: 'high', plane: 'data', tier: 1, act: 'each' },
    { p: 'sandbox:audit:read', label: '查看沙盒审计', grp: '沙盒', risk: 'low', plane: 'data', tier: 1, act: 'auto' },
    /* 🔴 补注册：这两个点在代码里被使用（v10-detail-sandbox.js 的 sbx-prio / 改模式），
       但此前未登记 ⇒ checkPerm 拿不到 meta、角色也不持有 ⇒ **对任何角色都点不通**（校验 12） */
    { p: 'sandbox:queue:write', label: '沙盒队列写', grp: '沙盒', risk: 'mid', plane: 'data', tier: 1, act: 'auto' },
    { p: 'sandbox:policy:write', label: '沙盒策略写', grp: '沙盒', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* 网关与成本 */
    { p: 'gateway:key:rotate', label: '轮换密钥', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'gateway:key:revoke', label: '吊销密钥', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'gateway:global:degrade', label: '全局降级', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* 补注册：gw-breaker / gw-log-raw 此前无权限点可用 */
    { p: 'gateway:breaker', label: '熔断参数调整', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'gateway:log:raw', label: '查看原始日志', grp: '网关成本', risk: 'high', plane: 'data', tier: 1, act: 'each' },
    /* v29 补注册：技能启停此前借的是 gateway:global:degrade（全局降级）——
       「停用一个技能」与「把全部 MCP 服务切降级」不是同一个动作，影响面差着一个数量级；
       而且那一个权限点只有架构负责人持有，于是"谁能停技能"被绑死在全局降级上。
       登记技能（写入）不设门禁，与其余「新建 X」一致；停用是**收走一个共享能力**，单独授权。 */
    { p: 'gateway:skill:toggle', label: '技能启停', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'cost:export', label: '导出成本报表', grp: '网关成本', risk: 'high', plane: 'data', tier: 1, act: 'each' },
    { p: 'cost:suggestion:submit', label: '提交降本建议', grp: '网关成本', risk: 'low', plane: 'mgmt', tier: 2, act: 'auto' },
    /* C-2：降本建议此前只能"转审批"；现补「直接应用配置」这条路，需要独立权限点 */
    { p: 'cost:config:apply', label: '应用降本配置', grp: '网关成本', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    { p: 'cost:config:rollback', label: '撤销降本配置', grp: '网关成本', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 运营流水线 */
    { p: 'userops:strategy:submit', label: '策略上线', grp: '运营', risk: 'low', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'userops:strategy:scale', label: '灰度放量', grp: '运营', risk: 'mid', plane: 'data', tier: 1, act: 'each' },
    { p: 'userops:strategy:pause', label: '暂停灰度', grp: '运营', risk: 'mid', plane: 'data', tier: 1, act: 'first' },
    { p: 'userops:strategy:terminate', label: '终止投放', grp: '运营', risk: 'high', plane: 'data', tier: 1, act: 'each' },
    { p: 'userops:strategy:requestFull', label: '转全量', grp: '运营', risk: 'high', plane: 'data', tier: 1, act: 'each' },
    { p: 'userops:strategy:review', label: '发起复盘', grp: '运营', risk: 'low', plane: 'mgmt', tier: 2, act: 'auto' },
    { p: 'evo:strategy:rollback', label: '进化策略回滚', grp: '运营', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'evo:strategy:requestFull', label: '进化转全量', grp: '运营', risk: 'high', plane: 'mgmt', tier: 1, act: 'each' },
    /* 调研与投放 */
    { p: 'survey:publish', label: '访谈投放（旧名，保留兼容）', grp: '调研投放', risk: 'mid', plane: 'data', tier: 1, act: 'each' },
    /* AI 访谈：权限点必须用「叶子名」并在此登记 + 授予角色，否则前端门禁会对谁都点不通 */
    { p: 'interview:create', label: '新建访谈', grp: 'AI 访谈', risk: 'low', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'interview:dispatch', label: '派发访谈', grp: 'AI 访谈', risk: 'mid', plane: 'data', tier: 1, act: 'each' },
    { p: 'interview:review:approve', label: '访谈结论通过', grp: 'AI 访谈', risk: 'mid', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'interview:review:reject', label: '访谈结论退回', grp: 'AI 访谈', risk: 'low', plane: 'mgmt', tier: 1, act: 'auto' },
    { p: 'interview:conclude', label: '结论归档', grp: 'AI 访谈', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    { p: 'kol:plan:write', label: '投放计划', grp: '调研投放', risk: 'mid', plane: 'mgmt', tier: 1, act: 'first' },
    /* 平台元治理（本模块自身） */
    { p: 'rbac:member:read', label: '查看成员', grp: '账号权限', risk: 'low', plane: 'mgmt', tier: 2, act: 'auto' },
    { p: 'rbac:member:write', label: '成员增停', grp: '账号权限', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'rbac:role:write', label: '角色与权限配置', grp: '账号权限', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' },
    { p: 'rbac:audit:read', label: '查看审计记录', grp: '账号权限', risk: 'low', plane: 'data', tier: 1, act: 'auto' },
    { p: 'session:logout', label: '退出登录', grp: '账号权限', risk: 'low', plane: 'mgmt', tier: 2, act: 'auto' },
    /* v26：访问复核需要一条**自己的**权限点。
       此前复核动作借 rbac:role:write（角色与权限配置）当门禁 —— 但按权限点命名约定
       「资源:动作」，复核的对象是**授权实例**、配置的对象是**角色模板**，不是同一个动作；
       更实际的问题是：只有平台管理员持有 rbac:role:write，于是「谁能做复核」被绑死在超管身上，
       业务运营/安全/合规这些真正该做复核的人一律被拦。 */
    { p: 'rbac:review:decide', label: '访问复核与决定提交', grp: '账号权限', risk: 'high', plane: 'mgmt', tier: 0, act: 'each' }
    /* 2026-10-20：Workflow 一页下线 —— 原来补注册的 3 个权限点
       （workflow:run:cancel / workflow:run:rerun / workflow:rollback）随能力一起删除；
       版本结构查看改用 agent:publish（见 v10-detail-flow.js 的 ver-diff）。 */
  ];

  /* 角色矩阵：单人系统里只有一个角色 —— 唯一账号持有全部权限。
     原先 6 个角色（平台管理员 / 业务运营 / 架构 / 数据安全 / 合规 / 只读）是给 8 个人分权的；
     没有第二个人之后，「分权」这件事本身不存在，留着只会让界面自问自答。 */
  var ROLES = [
    { id: 'r-admin', name: '平台管理员', dept: '—', users: 1, desc: '唯一账号，持有全部权限点', color: 'bad' }
  ];

  /* 角色 → 权限点集合。读权限点表前缀做通配（'x:*' 命中该前缀全部），
     避免每加一个权限点要手工补角色。 */
  var ROLE_PERM_MAP = {
    'r-admin': ['*']
  };

  /** 角色实际持有的权限点（展开通配） */
  function rolePerms(roleId) {
    var pats = ROLE_PERM_MAP[roleId] || [];
    var out = {};
    PERM_POINTS.forEach(function (pp) {
      var ok = pats.some(function (pat) {
        if (pat === '*' || pat === pp.p) return true;
        if (pat.slice(-1) === '*') return pp.p.indexOf(pat.slice(0, -1)) === 0;
        return false;
      });
      if (ok) out[pp.p] = 1;
    });
    return Object.keys(out);
  }
  function permMeta(p) {
    for (var i = 0; i < PERM_POINTS.length; i++) if (PERM_POINTS[i].p === p) return PERM_POINTS[i];
    return { p: p, label: p, grp: '未登记', risk: 'low' };
  }
  function permGroups() {
    var g = [], seen = {};
    PERM_POINTS.forEach(function (pp) {
      if (!seen[pp.grp]) { seen[pp.grp] = 1; g.push(pp.grp); }
    });
    return g;
  }

  /* v20：ME.perms 推导必须在 ROLE_PERM_MAP / PERM_POINTS 赋值之后（见 dim-me 处的注释） */
  ME.perms = rolePerms(ME.roleId);

  /* 权限点数量是「授权的结果」，不是角色属性。
     要谈 90 天重新确认，就必须知道「这份授权是什么时候给的、给到谁头上」——
     没有授予记录，90 天倒计时只能靠编数字。放在 GRANT_RECORDS 而不是 ROLES 上：
     角色是模板，授权是实例；一个人可以换角色、也可以额外被单独授予某些高危权限。 */
  var TODAY = NOW;   /* 与 NOW 同一个时间基准，保证「剩余天数」算得出来 */
  var DAY = 86400000;
  /** 剩余天数 = 到期日 - 今天。负数表示已过期。 */
  function grantDaysLeft(g) {
    return Math.round((g.grantAt + g.ttlDays * DAY - TODAY.getTime()) / DAY);
  }
  function grantState(g) {
    var d = grantDaysLeft(g);
    return d < 0 ? 'expired' : (d <= g.warnDays ? 'expiring' : 'active');
  }
  /** 该授权是否已影响实际可用权限：过期即失效，不进 ME.perms */
  function grantEffective(g) { return grantState(g) !== 'expired'; }

  /* 授权记录：单人系统里只有一条 —— 唯一账号持有平台管理员角色。
     原先 10 条是给 8 个人演示「临期 / 超期 / 单独授予高危」三种复核情形用的；
     访问复核已下线（没有第二个人可以复核），这些样本不再需要。
     保留一条真实来源，是为了回答「我这个管理员权限是哪来的」。 */
  var GRANT_RECORDS = [
    { id: 'g-01', member: 'u102', role: 'r-admin', via: 'role', grantAt: TODAY.getTime() - 30 * DAY, ttlDays: 3650, warnDays: 15, approver: null, reason: '唯一账号初始配置（平台管理员）' }
  ];

  /* ── 复核证据两个字段 ──────────────────────────────────────────────────
     成熟产品（Okta 的 review item 详情）要求评审人看到「最近一次访问」与「上一次被复核」，
     否则「这个账号还该不该留」只能靠评审人自己猜。按工号确定性生成，刷新/重放一致。 */

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION: v28 身份层（identity）
     为什么补这一层：这一屏原来只有「姓名 + 部门 + 角色」，于是三个问题答不出来 ——
       ① 这个人从哪来、能不能改？（企业目录同步 vs 手工创建）
       ② 这个账号怎么登进来？（控制台口令 / AccessKey / MFA / Passkey）
       ③ 他这些权限是哪来的？（直接授予，还是经角色 / 用户组继承）
     字段口径照阿里云 RAM（见「管理 RAM 用户信息」一文的字段解读表：
       UserPrincipalName=登录名称、DisplayName=显示名称、UserId=系统唯一 ID、
       ProvisionType=同步类型、CreateDate=创建时间、Tags=标签），
     但**不是照抄**：云控制台的身份层核心是"凭证"，我们这层核心是
     「这份权限还该不该留着」——所以额外给了 nextReviewAt（下一轮复核到期）
     与 permissions[].via（权限来源），这两项是为"访问复核"服务的，是我们的侧重。
     ══════════════════════════════════════════════════════════════════════════ */

  /* 账号类型：主账号 / 子用户 / 协作者 / 消息接收人。
     类型决定能力（腾讯云 CAM 用户类型的做法）：例如"消息接收人"只收通知、不能登录。 */
  var ACCOUNT_KINDS = [
    { id: 'master', name: '主账号', desc: '拥有租户内全部资源，不建议用于日常操作', canLogin: true, canApi: true, canGrant: true },
    { id: 'sub', name: '子用户', desc: '由本租户创建，完全归属本租户', canLogin: true, canApi: true, canGrant: true },
    { id: 'collaborator', name: '协作者', desc: '对方本身是另一租户的主账号，被邀请为协作者；可切回自己身份', canLogin: true, canApi: true, canGrant: true },
    { id: 'notify', name: '消息接收人', desc: '仅接收通知，不能登录、不参与授权', canLogin: false, canApi: false, canGrant: false }
  ];

  /* 用户组：单人系统里没有"组"——组的用途是给一群人批量分权，一个人不需要。
     保留空结构（不删函数），因为权限来源的三种口径仍要在页面口径里解释清楚。 */
  var GROUPS = [];
  var GROUP_MEMBERS = {};
  /** 某成员加入的全部用户组（→ 数组，供「加入的组」与权限来源展示） */
  function groupsOfUser(uid) {
    return GROUPS.filter(function (g) { return (GROUP_MEMBERS[g.id] || []).indexOf(uid) > -1; });
  }
  /** 某用户组包含的全部成员 */
  function usersOfGroup(gid) {
    return (GROUP_MEMBERS[gid] || []).map(function (uid) {
      return OWNERS.filter(function (o) { return o.id === uid; })[0];
    }).filter(Boolean);
  }

  /* ── 身份字段：登录名称 / 显示名称 / 系统 ID / 来源 / 账号类型 ──────────────
     source 与 editable 的对应关系是这一层的关键：
       目录同步（directory）= 姓名、部门、工号由企业目录说了算 → 本页**只读**
       手工创建（manual）   = 本页可改显示名称与备注
     这样"同步来的账号改不了"就不再是靠文案提醒，而是数据里写明的。 */
  var IDENTITIES = {
    /* 唯一账号。kind=master（主账号）：一人公司没有"子用户"这一层，
       xianyu 既是所有者也是唯一操作者，凭据（Passkey + 硬件 MFA）挂在自己身上。 */
    u102: { login: 'xianyu', upn: 'xianyu@local', display: 'xianyu', uid: '20261021', kind: 'master', roleId: 'r-admin',
            source: 'manual', idp: null, syncedMinAgo: null, mfa: 'passkey', passkey: true, console: true, api: true,
            createDaysAgo: 365, lastLoginMin: 3, lastIp: '127.0.0.1', tags: { dept: '—', jobNo: 'u102', level: 'OWNER' } }
  };
  /* 人 → 角色：**唯一数据源**。原来这份映射手写在 renderers2.js 里（6 处副本），
     于是"赵六是业务运营管理员"改不了、也解释不了。挪到这里之后，
     调整角色才有落点，刷新也不会还原（会话内改动见 setRoleOfUser）。
     ⚠ 这里只放"当前存值"，不表达"应该是什么" —— 权限体系里"应该"必须来自审批。 */
  var ROLE_OVERRIDE = {};
  function roleOfUser(uid) {
    if (ROLE_OVERRIDE[uid]) return ROLE_OVERRIDE[uid];
    var i = IDENTITIES[uid];
    return (i && i.roleId) ? i.roleId : 'r-viewer';
  }
  /** 审批通过后在本会话内生效（真实系统里由服务端落库） */
  function setRoleOfUser(uid, roleId) { ROLE_OVERRIDE[uid] = roleId; }
  function roleOverrideOf(uid) { return ROLE_OVERRIDE[uid] || null; }

  /* 逐权限点的覆盖表：{ uid: { 'perm:key': true|false } }
     用途：低危权限的调整走"保存即生效"，需要有个落点。
     高危权限不写这里，而是生成变更单（见 renderers2 的 rbac-perm-save）——
     两者的区别不是技术实现，而是"改错了有没有后果"。 */
  var PERM_OVERRIDE = {};
  function permsOverrideOf(uid) { return PERM_OVERRIDE[uid] || null; }
  function setPermsOverride(uid, map) { PERM_OVERRIDE[uid] = map; }

  /** 取某成员的身份记录；缺省时给一份保守兜底（宁可显示"未知"也不编造） */
  function identityOf(uid) {
    var o = OWNERS.filter(function (x) { return x.id === uid; })[0] || {};
    var i = IDENTITIES[uid] || {};
    return {
      id: uid, name: o.name || uid, dept: o.dept || '—',
      login: i.login || null, upn: i.upn || null, display: i.display || o.name || uid,
      uid: i.uid || null, kind: i.kind || 'sub', source: i.source || 'manual', idp: i.idp || null,
      syncedMinAgo: (i.syncedMinAgo == null ? null : i.syncedMinAgo),
      mfa: i.mfa || 'none', passkey: !!i.passkey, console: i.console !== false, api: !!i.api,
      createDaysAgo: (i.createDaysAgo == null ? null : i.createDaysAgo),
      lastLoginMin: (i.lastLoginMin == null ? null : i.lastLoginMin),
      lastIp: i.lastIp || null, tags: i.tags || {}
    };
  }
  /** 账号来源是否权威（同步而来的字段在本页只读 —— 这是"改不了"的正当理由，不是权限不足） */
  function isSourceAuthoritative(uid) {
    var s = identityOf(uid).source;
    /* 语义是「这个账号的人事字段由上游权威系统决定，因此本页只读」。
       正确的对应：directory（企业目录同步）/ sso（单点登录同步）→ true；manual（本页手工创建）→ false。
       我第一版写反了，自检时 u102（目录同步）返回 false、u106（手工）返回 true，一眼可见。 */
    return s === 'directory' || s === 'sso';
  }
  /** 这个账号当前能不能登录（账号类型 + 开关共同决定） */
  function accessMethods(uid) {
    var i = identityOf(uid);
    var m = [];
    if (i.console) m.push('控制台访问');
    if (i.api) m.push('编程访问');
    return m;
  }
  var SOURCE_LABEL = {
    directory: '企业目录同步', sso: '单点登录同步', manual: '本页手工创建'
  };
  var MFA_LABEL = {
    none: '未启用', virtual: '虚拟 MFA', hardware: '硬件 MFA', passkey: 'Passkey / 指纹'
  };

  /* ── 权限来源：直接授予 / 经角色 / 经用户组 ────────────────────────────────
     审计里最常被追问的一句是"他这个权限哪来的"。三种来源必须分得开：
       角色 = 岗位决定的（换岗就该跟着变）
       用户组 = 临时职责（值班、专项），到期该退
       直接授予 = 例外，必须单独复核、单独标注 */
  function permissionSources(uid, roleId) {
    var direct = DIRECT_GRANTS[uid] || [];
    var out = [];
    (rolePerms(roleId) || []).forEach(function (p) {
      out.push({ p: p, via: 'role', ref: roleId, refName: (ROLES.filter(function (r) { return r.id === roleId; })[0] || {}).name || roleId });
    });
    groupsOfUser(uid).forEach(function (g) {
      (GROUP_PERM_MAP[g.id] || []).forEach(function (p) {
        if (out.some(function (x) { return x.p === p; })) return;   /* 角色已给的，不重复计数 */
        out.push({ p: p, via: 'group', ref: g.id, refName: g.name });
      });
    });
    direct.forEach(function (p) {
      if (out.some(function (x) { return x.p === p; })) return;
      out.push({ p: p, via: 'direct', ref: null, refName: '直接授予' });
    });
    return out;
  }
  /** 例外授予（直接给的权限）——数量应当被压到很低，这里显式留了记录 */
  var DIRECT_GRANTS = {};   /* 单人系统：没有"例外授予给某个人"这回事 */
  /* 用户组自身携带的权限（组是"临时职责"的载体） */
  var GROUP_PERM_MAP = {};

  /* ── 复核节奏：我们的侧重 ────────────────────────────────────────────────
     云控制台回答"他是谁、他能干什么"；这一屏还要回答
     "这份权限还该不该留着、下次什么时候必须再看一遍"。 */
  var REVIEW_CYCLE_DAYS = 90;                 /* 与「访问复核」一轮 90 天对齐 */
  var REVIEW_WARN_DAYS = 15;                  /* 预警窗口 */
  /** 下一轮复核到期日（相对 today 的天数）；从未复核过则从建号日起算 */
  function nextReviewInDays(uid) {
    /* ⚠ 两个坑：① TODAY 的赋值在本段之后，函数体内直接引用它在首次调用前的时序不稳，
       改用 NOW（同一时间基准，且在文件前部已赋值）；② lastReviewAt 返回的是**毫秒时间戳**，
       不是 'YYYY-MM-DD' 串 —— 我第一版按串拼 'T00:00:00'，结果 new Date 得到 Invalid Date，
       所有复核天数都算成 NaN（自检时 7 个人全是 NaN，只有从未复核的那个蒙对）。 */
    var last = lastReviewAt(uid);
    var baseMs;
    if (last != null) { baseMs = Number(last); }
    else {
      var d = identityOf(uid).createDaysAgo;
      baseMs = NOW.getTime() - (d == null ? REVIEW_CYCLE_DAYS : d) * 86400000;
    }
    var dueMs = baseMs + REVIEW_CYCLE_DAYS * 86400000;
    return Math.round((dueMs - NOW.getTime()) / 86400000);
  }
  /** 复核状态：overdue（已超期）/ warn（进入预警窗口）/ ok */
  function reviewState(uid) {
    var d = nextReviewInDays(uid);
    if (d < 0) return 'overdue';
    if (d <= REVIEW_WARN_DAYS) return 'warn';
    return 'ok';
  }

  /* ── 操作记录：类型化 + 可筛选（阿里云「操作记录」模块的做法）────────────
     比"最近访问一个时间点"有用得多：复核时要看的是"他最近干了什么、
     有没有越权尝试、有没有改过自己的凭证"。 */
  var AUDIT_EVENTS = {
    u102: [
      { at: '2026-10-21 09:42', kind: 'login', text: 'Passkey 登录成功', ip: '127.0.0.1', result: 'ok' },
      { at: '2026-10-21 09:38', kind: 'policy', text: '调整「客服助手 Agent」的工具白名单（加 mcp://ticket/create）', ip: '127.0.0.1', result: 'ok' },
      { at: '2026-10-20 18:11', kind: 'key', text: '轮换模型网关密钥（qwen-*）', ip: '127.0.0.1', result: 'ok' },
      { at: '2026-10-20 15:03', kind: 'denied', text: 'Agent「合同初审」尝试读取客户联系方式，被工具白名单拦下', ip: '—', result: 'denied' },
      { at: '2026-10-19 11:20', kind: 'login', text: 'Passkey 登录成功', ip: '127.0.0.1', result: 'ok' }
    ]
  };
  function auditOf(uid) { return (AUDIT_EVENTS[uid] || []).slice(); }

  /* ── AccessKey / 凭证台账 ────────────────────────────────────────────────
     阿里云把 AccessKey 单独列一个模块（还有回收站）。我们不做云凭证托管，
     但"这个人有没有长期密钥、多久没轮换"是账号页必须能答的。 */
  var ACCESS_KEYS = {
    u102: [{ id: 'sk-local-01', createdDaysAgo: 42, lastUsedMin: 3, status: 'active', rotateWarnDays: 180 }]
  };
  function keysOf(uid) {
    return (ACCESS_KEYS[uid] || []).map(function (k) {
      return { id: k.id, createdDaysAgo: k.createdDaysAgo, lastUsedMin: k.lastUsedMin, status: k.status,
               rotateWarnDays: k.rotateWarnDays, stale: k.createdDaysAgo > k.rotateWarnDays };
    });
  }

  /* ── 标签：人事维度用标签承载，而不是写死成字段 ──────────────────────────
     阿里云原文：标签"用于自定义维度标记 RAM 用户（如：部门、项目、工号）"。
     我们原来的 dept/jobNo 是固定字段，加一个维度就要改表结构 —— 改成标签后不用。 */
  var TAG_DICT = {
    dept: { label: '部门', source: 'directory' },
    jobNo: { label: '工号', source: 'directory' },
    level: { label: '职级', source: 'directory' },
    project: { label: '项目', source: 'manual' }
  };
  function tagsOf(uid) {
    var t = identityOf(uid).tags;
    return Object.keys(t).map(function (k) {
      return { key: k, label: (TAG_DICT[k] || {}).label || k, value: t[k], editable: (TAG_DICT[k] || {}).source !== 'directory' };
    });
  }

  /* SYS_ID 别名：有些调用点用这个名字，保持两处指向同一份身份表 */
  var SYS_ID = IDENTITIES;

  function lastAccessMin(uid) {
    if (uid === ME.id) return ME.session && ME.session.issuedMin != null ? ME.session.issuedMin : 42;
    var r = R.of('access|' + uid);
    /* u107（智能客服组只读）刻意做成长期未使用：「长期未使用」那条 KPI 要有真实样本可点。 */
    if (uid === 'u107') return (95 + R.int(r, 0, 20)) * 1440;
    return R.int(r, 20, 4200);
  }
  /* 上一次被复核的时间；null = 从未复核（这是最重要的一个空值，不许用占位符糊过去）。 */
  function lastReviewAt(uid) {
    if (uid === 'u108') return null;
    if (uid === ME.id) return TODAY.getTime() - 55 * DAY;
    var r = R.of('review|' + uid);
    return TODAY.getTime() - (20 + R.int(r, 0, 150)) * DAY;
  }
  /** 距今多少天没访问过。成员表用「天」不用「小时」——
   *  「2280 小时前」这种数字读者得自己换算，等于没给。 */
  function lastAccessDays(uid) {
    var m = lastAccessMin(uid);
    return m == null ? null : Math.round(m / 1440);
  }

  /* 部门可见范围：谁能看到哪些数据。
     演示「同一份数据，不同角色看到的范围不同」—— 这不是权限点能表达的，
     权限点管「能做什么动作」，可见范围管「能看见谁的东西」，两者必须分开建模。 */
  var TENANTS = [
    { id: 'company_A', name: '公司 A（主租户）', members: 7 },
    { id: 'company_B', name: '公司 B（子公司）', members: 1 }
  ];
  var SCOPE_RULES = [
    { role: 'r-admin', scope: 'tenant', value: '本租户全部数据' },
    { role: 'r-ops', scope: 'dept', value: '本部门 + 下属部门' },
    { role: 'r-arch', scope: 'tenant', value: '本租户全部数据' },
    { role: 'r-security', scope: 'tenant', value: '本租户全部数据（含跨部门审计）' },
    { role: 'r-compliance', scope: 'tenant', value: '本租户全部数据' },
    { role: 'r-viewer', scope: 'self', value: '仅与自己相关的数据' }
  ];
  function scopeOf(roleId) {
    return SCOPE_RULES.filter(function (r) { return r.role === roleId; })[0] || { scope: 'self', value: '仅与自己相关的数据' };
  }
  /* 可见范围是否含跨部门。用于页面上「这条数据你为什么看得到 / 看不到」的说明。 */
  function scopeCrossDept(roleId) { return scopeOf(roleId).scope === 'tenant'; }

  global.DATA_SEED = {
    VERSION: 'dataset-v1',
    R: R,
    NOW: NOW,
    NOW_TS: NOW.getTime(),
    TODAY_START: TODAY_START,
    DAY: DAY,
    WINDOW_DAYS: WINDOW_DAYS,
    WINDOW_START: WINDOW_START,
    MODELS: MODELS,
    BIZ_LINES: BIZ_LINES,
    OWNERS: OWNERS,
    nameOf: nameOf,
    ME: ME,
    PERM_POINTS: PERM_POINTS,
    ROLES: ROLES,
    ROLE_PERM_MAP: ROLE_PERM_MAP,
    rolePerms: rolePerms,
    permMeta: permMeta,
    permGroups: permGroups,
    /* v23 第三批：授权记录（含授予时间与 90 天到期）+ 数据可见范围 */
    GRANT_RECORDS: GRANT_RECORDS,
    /* v26：复核依据两个字段（最近访问 / 上次复核） */
    lastAccessMin: lastAccessMin,
    lastAccessDays: lastAccessDays,
    lastReviewAt: lastReviewAt,
    grantDaysLeft: grantDaysLeft,
    grantState: grantState,
    grantEffective: grantEffective,
    TENANTS: TENANTS,
    SCOPE_RULES: SCOPE_RULES,
    scopeOf: scopeOf,
    scopeCrossDept: scopeCrossDept,
    AGENTS: AGENTS,
    MCP_SERVICES: MCP_SERVICES,
    SKILLS: SKILLS,
    KBS: KBS,
    KB_MISSES: KB_MISSES,
    KB_EVAL: KB_EVAL,
    TODO_FILTERS: TODO_FILTERS,
    INTENTS: INTENTS,
    SEGMENTS: SEGMENTS,
    ERROR_CODES: ERROR_CODES,
    CALLER_TYPES: CALLER_TYPES,
    INCIDENTS: INCIDENTS,
    DEPLOYS: DEPLOYS,
    HOUR_CURVE: HOUR_CURVE,
    weekdayFactor: weekdayFactor,
    /* 索引表，供事实层与聚合层 O(1) 查维度 */
    idx: {
      agent: (function () { var m = {}; AGENTS.forEach(function (a, i) { m[a.id] = i; }); return m; })(),
      model: (function () { var m = {}; MODELS.forEach(function (a, i) { m[a.id] = i; }); return m; })(),
      biz: (function () { var m = {}; BIZ_LINES.forEach(function (a, i) { m[a.id] = i; }); return m; })(),
      err: (function () { var m = {}; ERROR_CODES.forEach(function (a, i) { m[a.id] = i; }); return m; })()
    }
  ,
    /* ── v28 身份层 ────────────────────────────────────────────────────── */
    IDENTITIES: IDENTITIES, identityOf: identityOf, isSourceAuthoritative: isSourceAuthoritative,
    accessMethods: accessMethods, ACCOUNT_KINDS: ACCOUNT_KINDS,
    SOURCE_LABEL: SOURCE_LABEL, MFA_LABEL: MFA_LABEL,
    GROUPS: GROUPS, GROUP_MEMBERS: GROUP_MEMBERS, groupsOfUser: groupsOfUser,
    usersOfGroup: usersOfGroup, GROUP_PERM_MAP: GROUP_PERM_MAP,
    DIRECT_GRANTS: DIRECT_GRANTS, permissionSources: permissionSources,
    nextReviewInDays: nextReviewInDays, reviewState: reviewState,
    REVIEW_CYCLE_DAYS: REVIEW_CYCLE_DAYS, REVIEW_WARN_DAYS: REVIEW_WARN_DAYS,
    auditOf: auditOf, keysOf: keysOf, tagsOf: tagsOf, TAG_DICT: TAG_DICT,
    roleOfUser: roleOfUser, setRoleOfUser: setRoleOfUser, roleOverrideOf: roleOverrideOf,
    permsOverrideOf: permsOverrideOf, setPermsOverride: setPermsOverride
  };
})(window);
