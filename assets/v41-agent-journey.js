/* SECTION: v41-agent-journey（2026-10-21 业主指定）
 * Agent 详情第五个页签「编排」—— 把旅程编排器搬进 Agent 详情。
 *
 * 业主原话：「agent工作台，把编排放置在agent详情第五页」，配一张成熟旅程编排软件
 * （左侧节点工具箱 / 中间流程画布 / 右侧旅程概览）的截图。
 *
 * ── 这一页回答什么（和「管理 › 02 编排」分工）──────────────────────────
 *   管理页那张讲的是**本 Agent 内部的节点链路**（开始→意图识别→检索→生成→输出）。
 *   这一页讲的是**本 Agent 被编排进哪条业务旅程**：谁触发、等待多久、哪一步分流、
 *   本 Agent 在哪一环接手、接手后交出什么、卡住了谁兜底。
 *   一个是"机器内部接线"，一个是"业务流程里它在第几棒"，不是同一件事的两遍渲染。
 *
 * ── 流程要能走通（业主的硬要求：「空有数据没有流程」）────────────────────
 *   每个节点都必须回答四件事，右栏「节点详情」里逐条给出：
 *     谁做 · 上一步交给它什么 · 它交给下一步什么 · 卡住怎么办
 *   不是只有名字和图标 —— 只画方框不写交接物，就是一张好看的图，不是流程。
 *
 * ── 交互（真的能改，改的是本机草稿）────────────────────────────────
 *   切旅程 / 新建旅程 / 加一步（工具箱点选，插到输出前）/ 删一步（自动把上下游接起来）
 *   选节点看详情 / 拖节点改位置 / 缩放 / 撤销 / 保存（localStorage 草稿）/ 预览 / 发布
 *   改的是**本机草稿**，不是线上：新建的旅程、改过的节点、改名与状态都写进 localStorage，
 *   刷新不丢（2026-10-22 补的读写）；换浏览器或清缓存会丢。
 *   仍不提供「保存到线上」这种在本原型里必然是假的按钮。
 *
 * ── 数据纪律 ──────────────────────────────────────────────────
 *   旅程节点是**配置态**（seed 派生，按业务线各一份，不随天变化）；
 *   右栏「累计触达」是**运行态**，从本 Agent 的真实调用量折算，口径写在页尾 metaBar。
 *   随机只走确定性哈希，不出现 Math.random() / Date.now()。
 */
(function (global) {
  'use strict';

  var S = global.DATA_SEED, F = global.FACTS, Q = global.QUERY;
  var ACTIONS = global.ACTIONS, RENDERERS = global.RENDERERS;
  if (!S || !F || !ACTIONS) return;

  /* 节点/工具图标：线性、24 视框、stroke 走 currentColor。
     参照图的工具箱是「浅色圆角方块 + 彩色线条图标」，不是实心圆里的字符符号 —— 这套就是给它用的。 */
  var ICON = {
    page: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/><path d="M6.5 6.8h.01"/>',
    cart: '<path d="M3 4.5h2.4l2.6 11h9.6l1.9-8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
    drop: '<path d="M3 4.5h2.4l2.6 11h9.6l1.9-8H7"/><path d="M15 3.2l3.6 3.6M18.6 3.2L15 6.8"/>',
    wallet: '<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14.5" r="1.1"/>',
    user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.4 3.1-5.4 7-5.4s7 2 7 5.4"/>',
    useradd: '<circle cx="10" cy="8" r="3.2"/><path d="M3.5 20c0-3.2 2.9-5.1 6.5-5.1"/><path d="M17.5 12.5v6M14.5 15.5h6"/>',
    zap: '<path d="M13 2.6L5 13.4h5l-1 8 8-11h-5z"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7v5.4l3.4 2"/>',
    fork: '<circle cx="6" cy="5.5" r="1.9"/><circle cx="18" cy="5.5" r="1.9"/><circle cx="12" cy="19" r="1.9"/><path d="M6 7.4v2.2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.4"/><path d="M12 12.9V17"/>',
    split: '<path d="M4 6h5l3 6-3 6H4"/><path d="M12 12h8"/><path d="M17 9l3 3-3 3"/>',
    target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".9"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.6 7.2l8.4 5.8 8.4-5.8"/>',
    sms: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M10.5 18.2h3"/>',
    wecom: '<path d="M4 6h16v9.5H9.5L4 19.5z"/><path d="M8 9.8h8M8 12.6h5"/>',
    ad: '<path d="M3 10v4l5 1 8 4V5L8 9z"/><path d="M8 9.4v5.6"/><path d="M18.6 9.6a3.4 3.4 0 0 1 0 4.8"/>',
    push: '<path d="M18 9.5a6 6 0 1 0-12 0c0 4.4-2 5.4-2 5.4h16s-2-1-2-5.4"/><path d="M10.4 18.6a2 2 0 0 0 3.2 0"/>',
    hook: '<path d="M9 8.5V6.2a3 3 0 0 1 6 0v2.3"/><path d="M6 8.5h12v5.8a6 6 0 0 1-12 0z"/><path d="M6 14.3h12"/>',
    profile: '<circle cx="11" cy="7.6" r="3.1"/><path d="M5 19.6c0-3.2 2.8-5 6-5"/><circle cx="17.4" cy="6.4" r="2.1"/><path d="M14.6 19.6c0-2.4 1.6-3.8 3.6-3.8"/>',
    coupon: '<path d="M3 8h18v2.8a2 2 0 0 0 0 3.4V17H3v-2.8a2 2 0 0 0 0-3.4z"/><path d="M9 8v9"/>',
    human: '<circle cx="12" cy="7.4" r="3"/><path d="M6.2 20c0-3.2 2.6-5 5.8-5s5.8 1.8 5.8 5"/><path d="M9.4 13.6h5.2"/>',
    ab: '<rect x="3.5" y="4.5" width="6.8" height="6.8" rx="1.6"/><rect x="13.7" y="12.7" width="6.8" height="6.8" rx="1.6"/><path d="M13.2 7.9h7.3M6.9 13.3v7.3"/>',
    api: '<path d="M8.6 5L3.6 12l5 7"/><path d="M15.4 5l5 7-5 7"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4.2M8.3 4.2h7.4"/><circle cx="9" cy="14" r=".9"/><circle cx="15" cy="14" r=".9"/>',
    undo: '<path d="M4.5 9.5h9a5 5 0 0 1 0 10H8.5"/><path d="M8 6L4.5 9.5 8 13"/>',
    save: '<path d="M5 4.5h11l3.5 3.5v11.5H5z"/><path d="M8.5 4.5v5h6.5v-5"/><path d="M8.5 19.5v-6h7v6"/>',
    eye: '<path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.5"/>',
    refresh: '<path d="M19.8 12a7.8 7.8 0 1 1-2.4-5.6"/><path d="M20 3.8v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.6" cy="10.6" r="5.9"/><path d="M15 15l4.6 4.6"/>',
    tidy: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.4"/>'
  };
  function ico(name, cls) {
    var d = ICON[name];
    if (!d) return '';
    return '<svg class="jr-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  }

  function UI() { return global.V10UI || {}; }

  /* ============================================================
   * 1. 节点类型的公共语义（谁做 / 卡住怎么办 —— 同一类节点共用一套）
   * ============================================================ */
  /* 分类与色值照抄 nexus-frontend 的 NODE_CATEGORY_META（components/nodeCatalog.ts:43-46）：
     只有 4 类，触发器 #10b981 / 动作 #3b82f6 / 流控 #f59e0b / 高级 #8b5cf6。
     我上一版把"分支"单列成一类、把"等待"叫"流程"，都是自己加的，原产品里它们都归「流控」。 */
  var CAT = {
    trigger: { label: '触发器', color: '#10b981' },
    action: { label: '动作', color: '#3b82f6' },
    flow: { label: '流控', color: '#f59e0b' },
    advanced: { label: '高级', color: '#8b5cf6' }
  };
  var CAT_ORDER = ['trigger', 'action', 'flow', 'advanced'];
  function catOf(kind) {
    if (kind === 'wait' || kind === 'branch') return 'flow';
    if (kind === 'agent') return 'advanced';
    if (kind === 'end') return 'flow';
    return kind === 'trigger' ? 'trigger' : 'action';
  }

  var KIND = {
    trigger: { label: '触发器', tone: 'green', who: '平台 · 事件总线',
      fail: '事件漏投由每小时后置对账补齐，T+1 重跑；不靠人盯' },
    wait: { label: '等待', tone: 'amber', who: '平台 · 调度器',
      fail: '到点未触发转成一条人工待办，不静默丢弃' },
    action: { label: '动作', tone: 'blue', who: '平台 · 触达通道',
      fail: '通道失败自动降级（短信 → 企微 → 站内信），全失败进补发队列' },
    branch: { label: '条件分支', tone: 'purple', who: '平台 · 规则引擎',
      fail: '判定数据缺失一律走「否」分支，宁可少打扰也不重复轰炸' },
    agent: { label: 'Agent 节点', tone: 'blue', who: '本 Agent',
      fail: '超时 8s 或连续两次失败 → 转人工坐席队列，同时挂「待人工」角标' },
    end: { label: '输出', tone: 'grey', who: '平台 · 回写通道',
      fail: '回写失败进重试队列，3 次后告警到运营值班' }
  };

  /* ============================================================
   * 2. 旅程库（配置态）
   *    字段：k 节点键 / kind 类型 / name 名称 / sub 一句话 / io 这一棒的量
   *          tin 上一步交给它什么 / tout 它交给下一步什么 / cfg 参数（选填）
   *          col 列 / row 行（同列上下分叉用 ±1）
   * ============================================================ */
  function J(o) { return o; }

  var LIB = {
    cs: [J({
      id: 'cs-refund', name: '售后挽回旅程', status: 'running', ver: 'v2',
      desc: '工单关闭 30 分钟后自动触达：先走短信 + 企微问候，点击者交给客服助手 Agent 回访，未点击者走优惠券召回；Agent 接不住就转人工坐席。',
      tags: ['售后', '客服线', '高阶'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '工单关闭', sub: '工单已关闭', io: '日均 1.2 万', col: 0, row: 0,
          tin: '工单系统状态变更事件（含客户 ID、退款金额）', tout: '一条待触达的客户记录 + 工单上下文' },
        { k: 'w1', kind: 'wait', name: '等 30 分钟', sub: '避过情绪峰值', io: '排队 1.2 万', col: 1, row: 0,
          tin: '待触达客户记录', tout: '到点后仍满足「未二次投诉」的客户', cfg: [['等待时长', '30 分钟'], ['跳过条件', '同一客户 24h 内已触达']] },
        { k: 'a1', kind: 'action', name: '双渠道触达', sub: '短信 + 企微', io: '送达 1.1 万', col: 2, row: 0,
          tin: '到点客户名单 + 工单摘要', tout: '触达回执（送达 / 点击 / 退订）', cfg: [['渠道', '短信 · 企业微信'], ['文案', '售后回访-温和版 v3']] },
        { k: 'b1', kind: 'branch', name: '是否点击', sub: '24h 内点击', io: '是 34% · 否 66%', col: 3, row: 0,
          tin: '触达回执流', tout: '两条互斥的客户队列（点过的 / 没点的）' },
        { k: 'a2', kind: 'action', name: '优惠券短信', sub: '发 15 元券', io: '7,128 人', col: 4, row: 1,
          tin: '未点击队列', tout: '领券记录；48h 内未用券的进入下一轮', cfg: [['券面额', '15 元（成本上限 8%）'], ['有效期', '48 小时']] },
        { k: 'ag', kind: 'agent', name: '回访 Agent', sub: '本 Agent 接住', io: '1.9s', col: 4, row: -1,
          tin: '点击回执 + 工单上下文 + 客户近 3 次会话', tout: '处理结论（已解决 / 需换货 / 需补偿 / 转人工）', cfg: [['模型', 'qwen-plus'], ['知识库', '退换货政策 v12'], ['工具', 'query_contact · create_ticket']] },
        { k: 'a3', kind: 'action', name: '转人工兜底', sub: '超时 / 连败时', io: '约 3%', col: 4, row: 1, hidden: true,
          tin: 'Agent 失败回执（含失败原因）', tout: '一张带上下文的坐席工单',
          /* 这一棒卡住的原因不是"通道发不出去"，是"人接不住"——
             按 kind 套默认文案会说成"通道失败自动降级（短信→企微→站内信）"，语义完全错位 */
          fail: '坐席 30 分钟未接单自动升级到售后二线组长，同时给客户补一条「已安排专人」的进度消息',
          cfg: [['触发', '超时 8s 或连败 2 次'], ['排队', '售后二线']] },
        { k: 'e1', kind: 'end', name: '回写 CRM', sub: '结论落库', io: '日终对账', col: 5, row: 0,
          tin: '各分支的最终结论', tout: 'CRM 客户卡新增一条交互记录；进入下月复购模型' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'a1' }, { f: 'a1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '是 34%', tone: 'ok' },
        { f: 'b1', t: 'a2', label: '否 66%', tone: 'no' },
        { f: 'ag', t: 'e1' }, { f: 'a2', t: 'e1' },
        { f: 'ag', t: 'a3', label: '兜底', tone: 'fb', dash: true }
      ],
      reach: { span: 45 }
    }), J({
      id: 'cs-bad', name: '差评预警处置', status: 'running', ver: 'v1',
      desc: '差评出现后 15 分钟内先安抚，再判断是否升级：升级件由客服助手 Agent 拉群处理并给出补偿方案，未升级件由运营私信解释。',
      tags: ['口碑', '客服线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '新增差评', sub: '评分 ≤ 2 含文字', io: '日均 86 条', col: 0, row: 0,
          tin: '评价系统事件（评分、正文、订单号）', tout: '一条带情绪标签的预警工单' },
        { k: 'w1', kind: 'wait', name: '等 15 分钟', sub: '给客户改评窗口', io: '排队 86', col: 1, row: 0,
          tin: '预警工单', tout: '仍未被客户修改或删除的差评', cfg: [['等待时长', '15 分钟']] },
        { k: 'b1', kind: 'branch', name: '是否需升级', sub: '金额 > 500 或投诉', io: '升级 41%', col: 2, row: 0,
          tin: '差评正文 + 订单金额', tout: '升级队列 / 普通队列' },
        { k: 'ag', kind: 'agent', name: '处置 Agent', sub: '出补偿方案', io: '35 条 / 日 · P99 2.4s', col: 3, row: -1,
          tin: '差评正文 + 订单 + 历史会话', tout: '补偿方案（退款 / 补发 / 券）+ 一段可发的话术', cfg: [['模型', 'qwen-plus'], ['上限', '补偿 ≤ 订单金额 30%'], ['审批', '超上限转人工']] },
        { k: 'a1', kind: 'action', name: '私信解释', sub: '模板 + 人工微调', io: '51 条 / 日', col: 3, row: 1,
          tin: '普通队列 + 差评原文', tout: '私信回执；48h 未改评价的回到升级队列' },
        { k: 'e1', kind: 'end', name: '回写看板', sub: '进周报', io: '日终', col: 4, row: 0,
          tin: '两条分支的处置结论', tout: '口碑看板 + 客服质检样本池' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '升级', tone: 'no' },
        { f: 'b1', t: 'a1', label: '普通', tone: 'ok' },
        { f: 'ag', t: 'e1' }, { f: 'a1', t: 'e1' }
      ],
      reach: { span: 21 }
    }), J({
      id: 'cs-renew', name: '续费提醒旅程', status: 'paused', ver: 'v3',
      desc: '会员到期前 7 天开始分三次提醒，最后一次由客服助手 Agent 按客户历史用量生成一版「为什么值得续」的说明。',
      tags: ['复购', '客服线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '到期前 7 天', sub: '到期前 7 天', io: '日均 320 人', col: 0, row: 0,
          tin: '会员表到期日字段', tout: '一批待续费客户 + 历史用量' },
        { k: 'w1', kind: 'wait', name: '等到 D-3', sub: '等到 D-3', io: '320', col: 1, row: 0,
          tin: '待续费客户', tout: '未续费客户（已续费的自动出队）', cfg: [['等待时长', 'D-7 → D-3']] },
        { k: 'a1', kind: 'action', name: '第二次提醒', sub: '企微 + 站内信', io: '送达 298', col: 2, row: 0,
          tin: '未续费客户 + 剩余权益摘要', tout: '触达回执（打开 / 咨询 / 退订）' },
        { k: 'b1', kind: 'branch', name: '是否咨询', sub: '48h 内有无提问', io: '是 22% / 否 78%', col: 3, row: 0,
          tin: '咨询工单流', tout: '咨询队列 / 沉默队列' },
        { k: 'ag', kind: 'agent', name: '续费顾问', sub: '按用量写理由', io: '66 人 / 日', col: 4, row: -1,
          tin: '咨询内容 + 客户近 90 天用量', tout: '一版定制说明 + 一个明确的下一步（点这里续）', cfg: [['模型', 'qwen-plus'], ['口径', '只讲已发生的用量，不承诺未上线能力']] },
        { k: 'a2', kind: 'action', name: '最后提醒', sub: '到期当天发', io: '232 人', col: 4, row: 1,
          tin: '沉默队列', tout: '到期日触达回执' },
        { k: 'e1', kind: 'end', name: '标记结果', sub: '标记续 / 不续', io: '日终', col: 5, row: 0,
          tin: '两条分支的最终状态', tout: '会员表状态 + 流失原因标签' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'a1' }, { f: 'a1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '咨询', tone: 'ok' },
        { f: 'b1', t: 'a2', label: '沉默', tone: 'no' },
        { f: 'ag', t: 'e1' }, { f: 'a2', t: 'e1' }
      ],
      reach: { span: 30 }
    })],
    sales: [J({
      id: 'sales-lead', name: '线索跟进旅程', status: 'running', ver: 'v2',
      desc: '线索入库后先做意向评分，高分线索 10 分钟内由销售助手 Agent 出第一版跟进话术与报价区间；低分线索走内容培育。',
      tags: ['线索', '销售线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '线索入库', sub: '表单/电话/展会', io: '日均 640 条', col: 0, row: 0,
          tin: '各来源线索原始记录', tout: '一条去重后的线索 + 来源标签' },
        { k: 'w1', kind: 'wait', name: '等 5 分钟', sub: '等工商补全', io: '640', col: 1, row: 0,
          tin: '线索记录', tout: '补全了行业 / 规模 / 融资阶段的线索', cfg: [['等待时长', '5 分钟']] },
        { k: 'b1', kind: 'branch', name: '是否达标', sub: '评分 ≥ 70', io: '达标 38%', col: 2, row: 0,
          tin: '评分结果', tout: '高分队列 / 培育队列' },
        { k: 'ag', kind: 'agent', name: '销售助手', sub: '出话术 + 报价', io: '243 条/日', col: 3, row: -1,
          tin: '线索画像 + 同类成交案例', tout: '一段开场话术 + 报价区间 + 三个必问问题', cfg: [['模型', 'qwen-max'], ['引用', '近半年同类成交 42 单']] },
        { k: 'a1', kind: 'action', name: '内容培育', sub: '3 周内容序列', io: '397 条/日', col: 3, row: 1,
          tin: '培育队列', tout: '打开 / 下载行为回执，再次达标的回流高分队列' },
        { k: 'e1', kind: 'end', name: '写回 CRM', sub: '写回商机阶段', io: '日终', col: 4, row: 0,
          tin: '两条分支的跟进状态', tout: 'CRM 商机阶段 + 下次跟进时间' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '达标', tone: 'ok' },
        { f: 'b1', t: 'a1', label: '培育', tone: 'no' },
        { f: 'ag', t: 'e1' }, { f: 'a1', t: 'e1' }
      ],
      reach: { span: 30 }
    })],
    legal: [J({
      id: 'legal-ctr', name: '合同审查旅程', status: 'running', ver: 'v1',
      desc: '合同上传后先做格式与要素校验，再由合同初审 Agent 逐条过风险条款，命中红线直接退回，灰区交法务复核。',
      tags: ['合规', '法务线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '合同上传', sub: '采购 / 销售合同', io: '日均 46 份', col: 0, row: 0,
          tin: '合同文件 + 合同类型', tout: '解析后的合同正文与要素表' },
        { k: 'w1', kind: 'wait', name: '解析排队', sub: 'OCR + 条款切分', io: '平均 40 秒', col: 1, row: 0,
          tin: '合同文件', tout: '切成条款的正文（含条款编号）', cfg: [['耗时', '约 40 秒'], ['失败', '转人工上传']] },
        { k: 'b1', kind: 'branch', name: '是否命中红线', sub: '命中红线规则', io: '命中 17%', col: 2, row: 0,
          tin: '条款文本 + 红线规则包', tout: '退回队列 / 复核队列' },
        { k: 'ag', kind: 'agent', name: '合同初审', sub: '逐条给改法', io: '38 份 / 日 · P99 6.2s', col: 3, row: -1,
          tin: '条款正文 + 历史同类合同的修订意见', tout: '每条风险条款的等级、理由、建议改法', cfg: [['模型', 'qwen-max'], ['规则包', '广告法 / 数据出境 / 违约金上限'], ['输出', '修订建议 + 引用条款']] },
        { k: 'a1', kind: 'action', name: '直接退回', sub: '退回业务方', io: '8 份 / 日', col: 3, row: 1,
          tin: '命中红线的条款清单', tout: '一份带条款定位的退回说明' },
        { k: 'e1', kind: 'end', name: '归档结论', sub: '归档 + 留痕', io: '日终', col: 4, row: 0,
          tin: '复核结论 / 退回记录', tout: '合同档案 + 法务复核待办' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '灰区', tone: 'ok' },
        { f: 'b1', t: 'a1', label: '红线', tone: 'no' },
        { f: 'ag', t: 'e1' }, { f: 'a1', t: 'e1' }
      ],
      reach: { span: 14 }
    })],
    ops: [J({
      id: 'ops-camp', name: '活动召回旅程', status: 'running', ver: 'v4',
      desc: '大促开始后按人群分层召回：高潜人群走专属文案，沉默人群走大额券；文案由营销文案 Agent 按人群特征批量生成。',
      tags: ['大促', '运营线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '活动开始', sub: '大促日历到点', io: '一场 1 次', col: 0, row: 0,
          tin: '活动配置（时间、人群、券池）', tout: '一份待召回人群清单' },
        { k: 'w1', kind: 'wait', name: '等 2 小时', sub: '避开流量高峰', io: '—', col: 1, row: 0,
          tin: '人群清单', tout: '仍在活动期内的人群', cfg: [['等待时长', '2 小时']] },
        { k: 'b1', kind: 'branch', name: '是否高潜', sub: '90 天复购 ≥ 2', io: '高潜 29%', col: 2, row: 0,
          tin: '人群标签', tout: '专属队列 / 大额券队列' },
        { k: 'ag', kind: 'agent', name: '营销文案', sub: '按人群写文案', io: '1.4 万条 / 场', col: 3, row: -1,
          tin: '人群画像 + 活动机制 + 历史打开率', tout: '每位客户一版文案（含合规预检结果）', cfg: [['模型', 'qwen-plus'], ['合规', '广告法预检必过'], ['上限', '每人一版，不做群发同一句']] },
        { k: 'a1', kind: 'action', name: '大额券群发', sub: '沉默人群发券', io: '3.4 万人', col: 3, row: 1,
          tin: '大额券队列', tout: '领券与核销回执' },
        { k: 'e1', kind: 'end', name: '回收效果', sub: '按人群归因', io: 'T+1', col: 4, row: 0,
          tin: '两条分支的核销数据', tout: '活动复盘表 + 下一场的人群修正' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '高潜', tone: 'ok' },
        { f: 'b1', t: 'a1', label: '沉默', tone: 'no' },
        { f: 'ag', t: 'e1' }, { f: 'a1', t: 'e1' }
      ],
      reach: { span: 7 }
    })],
    know: [J({
      id: 'know-service', name: '知识服务回访旅程', status: 'paused', ver: 'v1',
      desc: '知识问答结束后 24 小时回访：没解决问题的人交给知识问答 Agent 追问一轮，仍未解决就生成一条知识库缺口。',
      tags: ['知识库', '知识服务线'],
      nodes: [
        { k: 't1', kind: 'trigger', name: '问答结束', sub: '关闭且未解决', io: '日均 210 次', col: 0, row: 0,
          tin: '问答会话（问题、答案、反馈）', tout: '一条待回访的会话记录' },
        { k: 'w1', kind: 'wait', name: '等 24 小时', sub: '不打断手上事', io: '210', col: 1, row: 0,
          tin: '待回访会话', tout: '尚未自行找到答案的会话', cfg: [['等待时长', '24 小时']] },
        { k: 'b1', kind: 'branch', name: '是否已解决', sub: '期间有无再检索', io: '已解决 63%', col: 2, row: 0,
          tin: '检索日志', tout: '已解决（归档）/ 未解决（追问）' },
        { k: 'ag', kind: 'agent', name: '知识问答', sub: '换问法再答', io: '78 次 / 日', col: 3, row: -1,
          tin: '原问题 + 上次答案 + 知识库命中情况', tout: '新一轮答案；仍答不上就产出一条缺口单', cfg: [['模型', 'qwen-plus'], ['知识库', '企业知识库 v5'], ['兜底', '答不上时明确说"没有"，不编']] },
        { k: 'a1', kind: 'action', name: '归档已解决', sub: '不再打扰', io: '132 次 / 日', col: 3, row: 1,
          tin: '已解决队列', tout: '会话归档标记' },
        { k: 'e1', kind: 'end', name: '生成缺口', sub: '进缺口清单', io: '日终', col: 4, row: 0,
          tin: '未解决的追问 + 检索失败记录', tout: '知识库缺口清单（按出现次数排序）' }
      ],
      edges: [
        { f: 't1', t: 'w1' }, { f: 'w1', t: 'b1' },
        { f: 'b1', t: 'ag', label: '未解决', tone: 'no' },
        { f: 'b1', t: 'a1', label: '已解决', tone: 'ok' },
        { f: 'ag', t: 'e1' }, { f: 'a1', t: 'e1' }
      ],
      reach: { span: 60 }
    })]
  };

  /* 业务线取不到时兜底到客服线（宁可给一条能看的，也不给空页）。
     jr.local = 本会话新建的旅程（2026-10-22 修）：上一版 jr-new 直接 push 进 LIB，
     而 LIB 是按业务线共享的常量 —— 在客服助手里建一条，售前咨询、质检评分两个 Agent
     的下拉里也会冒出「未命名旅程 1」，点进去还是 0 节点的空画布。
     现在本地旅程只挂在当前 Agent 的会话态上，渲染时与 LIB 拼接，换 Agent 即散。 */
  function libOf(a, jr) {
    var base = LIB[a.biz] || LIB.cs;
    if (!jr || !jr.local) return base;
    var extra = Object.keys(jr.local).map(function (k) { return jr.local[k]; });
    return extra.length ? base.concat(extra) : base;
  }

  /* ============================================================
   * 3. 会话态
   *    state.jr = {
   *      agent, pick 当前旅程, sel 选中节点, zoom 缩放(null=自动适应),
   *      edit{ jid: {nodes, edges} } 本会话改过的旅程, undo[快照], saved 保存时刻, status{ jid: 状态 },
   *      local{ jid: 旅程定义 } 新建的旅程（不写 LIB）
   *    }
   *    换 Agent 自动重建 —— 否则会把 A 的草稿带到 B 上。
   *
   *    草稿落盘（2026-10-22 修「新建的旅程刷新就没了」）：
   *    新建的旅程 + 改过的节点 + 改名 + 状态，都写进 localStorage，重建会话时读回来。
   *    上一版删掉了这段写入（因为当时没有读取路径，写了不读等于假持久化），
   *    但业主实际期望是"我建的东西别一刷就没"，所以这次把读写补齐，页尾文案也改成
   *    "存本机浏览器，刷新不丢；换浏览器 / 清缓存会丢"。
   * ============================================================ */
  var LS = 'aiops:jr:v1:';
  function loadDraft(a) {
    try {
      var raw = global.localStorage && global.localStorage.getItem(LS + a.id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveDraft(a, jr) {
    try {
      if (!global.localStorage || !jr || !a) return;
      global.localStorage.setItem(LS + a.id, JSON.stringify({
        pick: jr.pick || null,
        local: jr.local || {},
        edit: jr.edit || {},
        names: jr.names || {},
        status: jr.status || {}
      }));
    } catch (e) { /* 隐私模式 / 配额满：退回纯内存，不阻断操作 */ }
  }

  function Jr(state, a) {
    var cur = state.jr;
    if (!cur || cur.agent !== a.id) {
      var sv = loadDraft(a) || {};
      cur = state.jr = {
        agent: a.id, pick: sv.pick || null, sel: null, zoom: null, undo: [],
        saved: sv.pick ? 1 : null,
        edit: sv.edit || {}, status: sv.status || {}, added: 0,
        local: sv.local || {}, names: sv.names || {}
      };
    }
    var lib = libOf(a, cur);
    /* 盘里记的 pick 指向的旅程可能已经不在了（清过缓存 / 换了版本），退回第一条，
       否则下拉会显示成第一条、而 pick 里还挂着不存在的 id，右栏和画布对不上。 */
    var ok = false;
    for (var i = 0; i < lib.length; i++) if (lib[i].id === cur.pick) ok = true;
    if (!ok) cur.pick = lib[0].id;
    return cur;
  }

  function baseOf(a, jid, jr) {
    var lib = libOf(a, jr);
    for (var i = 0; i < lib.length; i++) if (lib[i].id === jid) return lib[i];
    return lib[0];
  }

  /* 旅程当前形态：改过的用改动版，没改过的用原始定义（深拷贝一份再给渲染层用，
     防止渲染期的临时字段写回 LIB —— LIB 是共享的，一旦被污染，切回来就变样了） */
  function shapeOf(a, jr) {
    var jid = jr.pick;
    var base = baseOf(a, jid, jr);
    var ed = jr.edit[jid];
    var nodes = (ed ? ed.nodes : base.nodes).map(function (n) {
      var c = {}; for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) c[k] = n[k];
      return c;
    });
    var edges = (ed ? ed.edges : base.edges).map(function (e) {
      var c = {}; for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) c[k] = e[k];
      return c;
    });
    /* dirty 的定义照源码：当前快照 ≠ 上次保存的快照。
       没保存过就和"原始定义"比；保存过就和保存那一刻比。改名也算改动。 */
    var nameNow = (jr.names && jr.names[jid] != null) ? jr.names[jid] : base.name;
    var snap = JSON.stringify({ n: nodes, e: edges, name: nameNow });
    var ref = (jr.clean && jr.clean[jid] != null)
      ? jr.clean[jid]
      : JSON.stringify({ n: base.nodes, e: base.edges, name: base.name });
    return { base: base, nodes: nodes, edges: edges, name: nameNow, dirty: snap !== ref };
  }

  function snapshot(a, jr) {
    var s = shapeOf(a, jr);
    return { jid: jr.pick, nodes: s.nodes, edges: s.edges };
  }
  function pushUndo(a, jr) {
    /* 结构一改，上一次试运行的结果就作废了 —— 留着那些绿勾等于拿旧结论糊在新图上 */
    jr.run = null;
    jr.undo.push(snapshot(a, jr));
    if (jr.undo.length > 20) jr.undo.shift();
  }

  /* ============================================================
   * 4. 布局
   * ============================================================ */
  /* 列宽按「中栏真实宽度」定（2026-10-22 实测修正）。
     上一版照抄 nexus 的 208 宽卡片 + 256 列距：6 列排下来画布 1556px，而 Agent 详情中栏
     在 1440 屏只有 610px（1920 屏 1058px）。fit 需要 0.373，被 0.5 下限兜住 → 横向溢出 168px，
     卡片名 14px 缩到 7px —— 一句话：**全屏画布的几何不能原样搬进 610px 的面板**。
     现在：卡片 168 宽（名称 13px 足够放 7 个汉字）、列距 196，6 列画布 1212px；
     610 容器下 fit 求 0.374，被 0.72 下限兜住（字数 13×0.72≈9.4px 仍可读），
     剩下的宽度交给横向滚动 + 小地图 —— 宁可"要看全得滚一下"，不要"全塞进去但字看不清"。 */
  /* 卡片尺寸仍照 nexus-frontend 的 JourneyNodeCard 结构：
     图标 + 名称 + 「分类 · 类型」+ 摘要行；只是整体收窄一档，高度按新内距重算。 */
  var COL_STEP = 196, PAD_X = 18, PAD_Y = 20, ROW_GAP = 36, BRANCH_GAP = 28;
  var NW = 168;
  var W = { trigger: NW, wait: NW, action: NW, branch: NW, agent: NW, end: NW };
  var H = { trigger: 84, wait: 84, action: 84, branch: 66, agent: 84, end: 66 };

  function num(v) { return typeof v === 'number' ? v : 0; }

  /* 新节点的键：扫现有节点取最大序号 +1，**不能用 nodes.length**（2026-10-22 修）。
     加两步得 n9/n10 → 删掉 n9 → 节点数又回到 9 → 再加一步算出 n10，与现存 n10 撞键：
     state 里两个节点同 key、DOM 里两张卡同 data-key，geo 互相覆盖，拖动和删除会同时命中两个。 */
  function nextKey(nodes, kind) {
    var max = 0;
    nodes.forEach(function (n) {
      var m = /^n(\d+)-/.exec(String(n.k));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'n' + (max + 1) + '-' + kind;
  }

  function layout(nodes) {
    var cols = {};
    /* 兜底节点默认不占位（它是失败路径，铺在明面上会让人以为主流程有四条腿） */
    nodes = nodes.filter(function (n) { return !n.hidden; });
    nodes.forEach(function (n) {
      var c = num(n.col);
      (cols[c] = cols[c] || []).push(n);
    });
    /* 每列按 row 排序（上 → 下），再算这一列的堆叠高度 */
    var colH = {};
    Object.keys(cols).forEach(function (c) {
      cols[c].sort(function (x, y) { return num(x.row) - num(y.row); });
      var h = 0;
      cols[c].forEach(function (n) { h += H[n.kind] || 80; });
      colH[c] = h + (cols[c].length - 1) * ROW_GAP;
    });
    var maxH = 0;
    Object.keys(cols).forEach(function (c) { maxH = Math.max(maxH, colH[c]); });
    var canvasH = maxH + PAD_Y * 2;

    /* 列 x 位置：分支列后面多留 26px —— 不然后面那一列正好贴着分支卡，
       「是 34% / 否 66%」这两颗标签没地方站，只能压在卡片边框上。 */
    var order = Object.keys(cols).map(Number).sort(function (x, y) { return x - y; });
    if (!order.length) return { geo: {}, w: PAD_X * 2 + NW, h: 140 };   /* 空画布：给个最小尺寸，别让 canvasW 变 NaN */
    var xOf = {}, x = PAD_X;
    order.forEach(function (c, i) {
      if (i > 0) {
        var prev = cols[order[i - 1]];
        var gap = prev.some(function (n) { return n.kind === 'branch'; }) ? BRANCH_GAP : 0;
        x += COL_STEP + gap;
      }
      xOf[c] = x;
    });
    var lastCol = order[order.length - 1];
    var lastMaxW = 0;
    cols[lastCol].forEach(function (n) { lastMaxW = Math.max(lastMaxW, W[n.kind] || 150); });
    var canvasW = xOf[lastCol] + lastMaxW + PAD_X;

    var geo = {};
    order.forEach(function (c) {
      var list = cols[c];
      var y = PAD_Y + (maxH - colH[c]) / 2;
      list.forEach(function (n) {
        geo[n.k] = { x: xOf[c], y: y, w: W[n.kind] || 150, h: H[n.kind] || 80 };
        y += (H[n.kind] || 80) + ROW_GAP;
      });
    });
    /* 从工具箱拖进来的节点：停在鼠标落点，不跟着自动排布跑；
       落点可能超出自动排布算出的画布边界，边界要跟着长 */
    nodes.forEach(function (n) {
      if (n.dropX == null || !geo[n.k]) return;
      geo[n.k].x = n.dropX;
      geo[n.k].y = n.dropY;
      canvasW = Math.max(canvasW, n.dropX + (W[n.kind] || 150) + PAD_X);
      canvasH = Math.max(canvasH, n.dropY + (H[n.kind] || 80) + PAD_Y);
    });
    return { geo: geo, w: canvasW, h: canvasH };
  }

  /* ============================================================
   * 5. 画布上的节点卡
   * ============================================================ */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function iconOf(kind) {
    return { trigger: '⚡', wait: '◷', action: '↗', branch: '⑂', agent: '◆', end: '▣' }[kind] || '•';
  }

  /* 节点图标：先看名字里有没有强特征（短信/邮件/企微/券/Agent…），没有再按类型给默认值 */
  function nodeIcon(n) {
    var nm = n.name || '';
    if (/Agent/.test(nm)) return 'bot';
    if (/短信/.test(nm)) return 'sms';
    if (/邮件/.test(nm)) return 'mail';
    if (/企微/.test(nm)) return 'wecom';
    if (/券/.test(nm)) return 'coupon';
    if (/广告/.test(nm)) return 'ad';
    if (/人工|坐席/.test(nm)) return 'human';
    if (/等待|等 /.test(nm)) return 'clock';
    if (/分支|判定|分流|是否|达标/.test(nm)) return 'fork';
    if (/回写|归档|缺口|结果/.test(nm)) return 'target';
    if (/提醒|通知|推送/.test(nm)) return 'push';
    if (/画像/.test(nm)) return 'profile';
    if (/触发|关闭|入库|上传|开始|结束|访问|购买|注册|加购/.test(nm)) return 'zap';
    return { trigger: 'zap', wait: 'clock', action: 'mail', branch: 'fork', agent: 'bot', end: 'target' }[n.kind] || 'zap';
  }

  function nodeHtml(n, g, sel, a, run) {
    var kd = KIND[n.kind] || KIND.action;
    var cat = catOf(n.kind), cm = CAT[cat];
    var self = n.kind === 'agent';
    var out = n.kind === 'end' ? null : (n.io ? n.io : '');
    /* 试运行的痕迹：跑过的打绿勾，被排除在主线外的兜底路径打灰点（不假装跑过） */
    var badge = '', runCls = '';
    if (run && run.done) {
      if (run.ok && run.ok[n.k]) { badge = '<span class="jr-run-badge ok" title="本次试运行走通">✓</span>'; runCls = ' run-ok'; }
      else if (run.skip && run.skip[n.k]) { badge = '<span class="jr-run-badge skip" title="本次未触发（失败兜底路径）">—</span>'; runCls = ' run-skip'; }
    }
    return '<div class="jr-node k-' + n.kind + (self ? ' is-self' : '') + (sel === n.k ? ' on' : '') + runCls + '"' +
      ' data-key="' + esc(n.k) + '" tabindex="0" role="button"' +
      ' style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px;' +
      'border-left-color:' + cm.color + '"' +
      ' title="' + esc(cm.label + ' · ' + kd.label + '：' + n.name + (n.sub ? '\n' + n.sub : '')) + '">' +
      '<span class="jr-n-row">' +
      '<span class="jr-n-ico" style="background:' + cm.color + '15;color:' + cm.color + '">' +
      ico(nodeIcon(n)) + '</span>' +
      '<span class="jr-n-body">' +
      '<b class="jr-n-name">' + esc(n.name) + '</b>' +
      '<i class="jr-n-sub">' + esc(cm.label === kd.label ? kd.label : cm.label + ' · ' + kd.label) +
        (self ? ' · ' + esc(a.online) : '') + '</i>' +
      '</span>' +
      '</span>' +
      (n.sub ? '<span class="jr-n-sum">' + esc(n.sub) + '</span>' : '') +
      badge +
      (sel ? '<button class="jr-n-del" data-act="jr-del" data-id="' + esc(n.k) + '" title="删除节点">×</button>' : '') +
      (n.kind === 'end' ? '' : '<span class="jr-port" data-port="out" title="从这里拖到另一个节点，接线"></span>') +
      '</div>';
  }

  /* 小地图：把画布按比例压成 120×70 的缩略图。
     2026-10-22：加两样原版都有、这里没有的东西 —— ① 当前视口框（不然小地图只是装饰）；
     ② 可点击跳转（点到哪，主画布滚到哪）。映射参数写在 data-* 上给 updateMiniViewport 用。 */
  function miniHtml(nodes, lay) {
    var MW = MINI_W, MH = MINI_H, pad = 4;
    var k = Math.min((MW - pad * 2) / lay.w, (MH - pad * 2) / lay.h);
    var ox = (MW - lay.w * k) / 2, oy = (MH - lay.h * k) / 2;
    var body = nodes.map(function (n) {
      var g = lay.geo[n.k];
      if (!g) return '';
      return '<rect x="' + (ox + g.x * k).toFixed(1) + '" y="' + (oy + g.y * k).toFixed(1) +
        '" width="' + Math.max(2, g.w * k).toFixed(1) + '" height="' + Math.max(2, g.h * k).toFixed(1) +
        '" rx="1.5" class="jr-mini-b k-' + n.kind + '"/>';
    }).join('');
    return '<div class="jr-mini" data-mini="1" data-k="' + k.toFixed(5) + '" data-ox="' + ox.toFixed(2) +
      '" data-oy="' + oy.toFixed(2) + '" title="点这里跳到画布对应位置（框 = 当前视口）">' +
      '<svg width="' + MW + '" height="' + MH + '">' + body +
      '<rect class="jr-mini-vp" id="jr-mini-vp" x="0" y="0" width="0" height="0" rx="2"/></svg></div>';
  }

  /* 视口框：把 stage 的可见矩形换算回画布坐标，再压进小地图 */
  var MINI_W = 120, MINI_H = 70;
  function updateMiniViewport() {
    var d = global.document;
    var mini = d.querySelector('.jr-mini');
    var vp = d.getElementById('jr-mini-vp');
    var st = d.getElementById('jr-stage');
    var cv = d.getElementById('jr-canvas');
    if (!mini || !vp || !st || !cv) return;
    var k = parseFloat(mini.getAttribute('data-k')) || 1;
    var ox = parseFloat(mini.getAttribute('data-ox')) || 0;
    var oy = parseFloat(mini.getAttribute('data-oy')) || 0;
    var z = parseFloat(cv.style.zoom) || 1;
    var cb = cv.getBoundingClientRect(), sb = st.getBoundingClientRect();
    /* 画布在 stage 里是居中的（margin auto）：可见区起点不是 0，而是画布坐标下的负偏移。
       pan 走的是 transform，rect 已经把位移算进去了 —— 所以这里不用再单独处理平移。 */
    var vx = (sb.left - cb.left) / z, vy = (sb.top - cb.top) / z;
    var vw = st.clientWidth / z, vh = st.clientHeight / z;
    var bx = ox + vx * k, by = oy + vy * k;
    var bw = Math.max(5, vw * k), bh = Math.max(5, vh * k);
    /* 拖空白把画布推出视口时，框会算到小地图外、被 svg 裁掉就"不见了"。
       允许它贴边、最多只剩 6px 在画内，保证"我还在这个方向"这件事看得见。 */
    bx = Math.min(Math.max(bx, -bw + 6), MINI_W - 6);
    by = Math.min(Math.max(by, -bh + 6), MINI_H - 6);
    vp.setAttribute('x', bx.toFixed(1));
    vp.setAttribute('y', by.toFixed(1));
    vp.setAttribute('width', bw.toFixed(1));
    vp.setAttribute('height', bh.toFixed(1));
  }

  /* 连线：cubic bezier；分支标签贴在中点 */
  function edgePath(ga, gb) {
    var x1 = ga.x + ga.w, y1 = ga.y + ga.h / 2;
    var x2 = gb.x, y2 = gb.y + gb.h / 2;
    /* 目标在源的左侧 / 同一列（2026-10-22 修）：原来只按"左出右进"算，
       同列节点（兜底路径 ag → 转人工，两卡同在 col4）会算出
       `M1282,68 C1344,68 1012,340 1074,340` —— 先往右甩 62px 再折回 268px，
       曲线横穿中间那张「优惠券短信」。同列改成从源卡左缘出、绕左进目标卡左缘，不穿卡。 */
    if (x2 <= x1 - 8) {
      var ax = ga.x, ay = ga.y + ga.h / 2;
      var bx = gb.x, by = gb.y + gb.h / 2;
      var kk = Math.max(26, Math.min(48, Math.abs(by - ay) * 0.5));
      return {
        d: 'M' + ax + ',' + ay + ' C' + (ax - kk) + ',' + ay + ' ' + (bx - kk) + ',' + by + ' ' + bx + ',' + by,
        mx: Math.min(ax, bx) - kk * 0.8, my: (ay + by) / 2
      };
    }
    var dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
    return {
      d: 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2,
      mx: x1 + Math.max(18, (x2 - x1) * 0.22), my: (y1 + y2) / 2
    };
  }

  function edgesHtml(nodes, edges, geo, sel, W, H, jrEdgeSel) {
    var svg = '', labels = '';
    /* 箭头必须画：没有箭头的曲线在两条腿分叉/合流的地方读不出方向（哪条是"进去"哪条是"出来"） */
    var defs = '<defs>' +
      '<marker id="jr-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" class="jr-ah-p"/></marker>' +
      '<marker id="jr-ah-fb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" class="jr-ah-p fb"/></marker>' +
      '</defs>';
    edges.forEach(function (e) {
      var ga = geo[e.f], gb = geo[e.t];
      if (!ga || !gb) return;
      var p = edgePath(ga, gb);
      var key = e.f + '>' + e.t;
      var on = sel && (sel === e.f || sel === e.t);
      var isSel = jrEdgeSel === key;
      /* 边上挂一个 hover 才出现的删除点（2026-10-22）。原来删一条线要"点选中 → 按 Delete"，
         三步；原版是 hover 就在线上给你一个 ×。有标签的边把 × 抬到标签上方 15px，免得压字。 */
      var bx = p.mx, by = p.my - (e.label ? 15 : 0);
      var xd = 'M' + (bx - 2.6).toFixed(1) + ',' + (by - 2.6).toFixed(1) + 'L' + (bx + 2.6).toFixed(1) + ',' + (by + 2.6).toFixed(1) +
        'M' + (bx + 2.6).toFixed(1) + ',' + (by - 2.6).toFixed(1) + 'L' + (bx - 2.6).toFixed(1) + ',' + (by + 2.6).toFixed(1);
      svg += '<g class="jr-eg' + (isSel ? ' sel' : '') + '">' +
        '<path class="jr-e' + (e.dash ? ' fb' : '') + (on ? ' on' : '') + (isSel ? ' sel' : '') + '" d="' + p.d +
        '" marker-end="url(#' + (e.dash ? 'jr-ah-fb' : 'jr-ah') + ')" data-edge="' + esc(key) + '"/>' +
        '<circle class="jr-e-del" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="7"' +
        ' data-act="jr-edge-del" data-id="' + esc(key) + '"><title>删除这条连线</title></circle>' +
        '<path class="jr-e-x" d="' + xd + '"/>' +
        '</g>';
      if (e.label) {
        labels += '<span class="jr-el ' + (e.tone || '') + '" data-for="' + esc(key) +
          '" style="left:' + p.mx + 'px;top:' + p.my + 'px">' + esc(e.label) + '</span>';
      }
    });
    return '<svg class="jr-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + defs + svg + '</svg>' + labels;
  }

  /* ============================================================
   * 6. 三栏
   * ============================================================ */
  /* 22 项，与参照图左栏的清单同构（触发器 6 / 流程 4 / 动作 7 / 高级 5）。
     每项都带一句「什么时候用它」—— 只写名字的工具箱，用的人得先背下来它是干嘛的。 */
  var TOOLS = [
    { g: '触发器', items: [
      { kind: 'trigger', icon: 'page', name: '页面访问', sub: '访问产品详情页时触发' },
      { kind: 'trigger', icon: 'cart', name: '加入购物车', sub: '加购商品时触发' },
      { kind: 'trigger', icon: 'wallet', name: '下单', sub: '提交订单时触发' },
      { kind: 'trigger', icon: 'wallet', name: '购买', sub: '完成支付时触发' },
      { kind: 'trigger', icon: 'useradd', name: '注册', sub: '完成注册时触发' },
      { kind: 'trigger', icon: 'zap', name: '自定义事件', sub: '任意事件上报时触发' }
    ] },
    { g: '流程', items: [
      { kind: 'wait', icon: 'clock', name: '等待一段时间', sub: '延迟指定时长后继续' },
      { kind: 'branch', icon: 'fork', name: '条件分支', sub: '按判定结果走不同路径' },
      { kind: 'branch', icon: 'split', name: '随机分流', sub: '按比例分人群' },
      { kind: 'branch', icon: 'target', name: '目标达成退出', sub: '命中目标就结束' }
    ] },
    { g: '动作', items: [
      { kind: 'action', icon: 'mail', name: '发送邮件', sub: '向用户发营销邮件' },
      { kind: 'action', icon: 'sms', name: '发送短信', sub: '向用户发营销短信' },
      { kind: 'action', icon: 'wecom', name: '发送企微', sub: '发企业微信消息' },
      { kind: 'action', icon: 'ad', name: '投放广告', sub: '向指定人群投广告' },
      { kind: 'action', icon: 'push', name: '推送通知', sub: 'App / Web 推送' },
      { kind: 'action', icon: 'hook', name: 'Webhook', sub: '回调业务数据' },
      { kind: 'action', icon: 'profile', name: '更新客户画像', sub: '更新分群 / 标签' }
    ] },
    { g: '高级', items: [
      { kind: 'agent', icon: 'bot', name: 'Agent 节点', sub: '把这一棒交给 Agent' },
      { kind: 'action', icon: 'coupon', name: '发放优惠券', sub: '发券并跟踪核销' },
      { kind: 'action', icon: 'human', name: '转人工坐席', sub: '进人工队列带上文' },
      { kind: 'branch', icon: 'ab', name: 'A/B 测试', sub: '按比例分发两版' },
      { kind: 'action', icon: 'api', name: '外部 API 调用', sub: '调用第三方接口' }
    ] }
  ];

  function railHtml(jr) {
    var q = (jr.toolQ || '').trim();
    var out = '<div class="jr-panel jr-rail"><div class="jr-panel-h"><span>节点工具箱</span>' +
      '<span class="jr-count">' + TOOLS.reduce(function (s, g) { return s + g.items.length; }, 0) + ' 种</span></div>' +
      '<div class="jr-rail-q"><input class="jr-input" id="jr-tool-q" placeholder="搜索节点类型" value="' + esc(q) + '" data-act="jr-tool-q"></div>' +

      '<div class="jr-tools">' +
      '<div class="jr-rail-hint">拖拽到画布添加，或点击快速插入</div>';
    var shown = 0;
    TOOLS.forEach(function (g) {
      /* 搜索要覆盖每项的说明文字：左栏每项都写了「什么时候用它」，
         只搜名字的话搜「回调」找不到 Webhook、搜「分群」找不到「更新客户画像」—— 那句说明就白写了 */
      var items = g.items.filter(function (t) {
        return !q || t.name.indexOf(q) >= 0 || t.sub.indexOf(q) >= 0 || g.g.indexOf(q) >= 0;
      });
      if (!items.length) return;
      shown += items.length;
      var _gc = catOf(g.items[0].kind);
      out += '<div class="jr-tool-g"><span class="jr-dot" style="background:' + CAT[_gc].color + '"></span>' +
        '<b>' + esc(g.g) + '</b><i>' + items.length + '</i></div>';
      items.forEach(function (t) {
        out += '<button class="jr-tool" draggable="true" data-drag-kind="' + t.kind + '" data-drag-name="' + esc(t.name) + '"' +
          ' data-act="jr-add" data-id="' + t.kind + '|' + esc(t.name) + '" title="' + esc(t.sub) + '">' +
          '<span class="jr-tool-i k-' + t.kind + '">' + ico(t.icon || 'zap') + '</span>' +
          '<span class="jr-tool-t"><b>' + esc(t.name) + '</b><i>' + esc(t.sub) + '</i></span>' +
          '<span class="jr-tool-plus">＋</span></button>';
      });
    });
    if (q && !shown) out += '<div class="jr-tip">没有匹配的节点类型，换个词试试（如「短信」「等待」）。</div>';
    return out + '</div></div>';
  }

  /* 右栏：没选节点 = 旅程概览；选了节点 = 这一步谁做、收什么、交什么、卡了怎么办 */
  function sideHtml(a, ai, jr, sh, geo) {
    var b = sh.base;
    if (jr.sel) {
      var sn = null;
      sh.nodes.forEach(function (x) { if (x.k === jr.sel) sn = x; });
      if (sn) return nodeSide(a, jr, sh, sn);
      jr.sel = null;
    }
    /* 计数口径与参照图一致：触发器 / 动作 / 流程 / 高级 四类（流程 = 等待 + 分支，高级 = Agent 节点） */
    var cnt = { trigger: 0, action: 0, flow: 0, adv: 0 };
    sh.nodes.forEach(function (n) {
      if (n.hidden) return;
      if (n.kind === 'trigger') cnt.trigger++;
      else if (n.kind === 'action') cnt.action++;
      else if (n.kind === 'wait' || n.kind === 'branch') cnt.flow++;
      else if (n.kind === 'agent') cnt.adv++;
    });
    /* 新建的空旅程 / 一个节点都没有：不编运行数据，照源码给一句"尚未发布" */
    var isNew = String(b.id).indexOf('local-') === 0 || sh.nodes.length === 0;
    var dr = F.dailyRow(ai, 0);
    /* 运行态数字：从本 Agent 的真实日调用量折算（口径见页尾 metaBar）
       进入 = 日调用 × 0.29（一趟旅程通常对应多次调用）× 天数；
       完成 = 进入 × 走完全链路的比例；召回率 = 走完之后真正转化的人 / 进入。 */
    var span = Math.max(1, b.reach.span);
    var perDay = Math.round(dr.calls * 0.29);
    var enter = perDay * span;
    var doneRate = (a.id === 'ag-cs-refund') ? 0.822 : (a.biz === 'legal' ? 0.68 : 0.74);
    var done = Math.round(enter * doneRate);
    var convRate = (a.id === 'ag-cs-refund') ? 0.184 : (a.biz === 'sales' ? 0.212 : 0.166);
    var money = Math.round(done * convRate * 268);

    return '<div class="jr-panel jr-side">' +
      '<div class="jr-panel-h"><span>旅程概览</span><span class="jr-st ' + (statusOf(jr, b) === 'running' ? 'ok' : (statusOf(jr, b) === 'paused' ? 'warn' : '')) + '">' +
      statusLabel(statusOf(jr, b)) + ' · ' + esc(b.ver) + '</span></div>' +
      '<div class="jr-side-b">' +
      '<div class="jr-side-t">旅程描述</div>' +
      '<p class="jr-desc">' + esc(b.desc) + '</p>' +
      '<div class="jr-tags">' + b.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<div class="jr-side-t">节点构成</div>' +
      '<div class="jr-comp two">' +
      compRow('触发器', cnt.trigger, 'green') + compRow('动作', cnt.action, 'blue') +
      compRow('流程', cnt.flow, 'amber') + compRow('高级', cnt.adv, 'purple') +
      '</div>' +
      '<div class="jr-side-t">连线</div><p class="jr-saved">' + sh.edges.length + ' 条（含 ' +
      sh.edges.filter(function (e) { return e.dash; }).length + ' 条兜底）· 跨度 ' + b.reach.span + ' 天</p>' +

      (isNew ? '<div class="jr-side-t">累计运行指标</div>' +
        '<p class="jr-saved">旅程尚未发布，暂无运行数据</p>'
      : '<div class="jr-side-t">累计触达 · 近 ' + b.reach.span + ' 天</div>' +
      '<div class="jr-grid2">' +
      '<div><b>' + fmtInt(enter) + '</b><span>进入人数</span></div>' +
      '<div><b>' + fmtInt(done) + '</b><span>完成人数</span></div>' +
      '<div><b>' + (convRate * 100).toFixed(1) + '%</b><span>召回率</span></div>' +
      '<div><b>¥' + fmtK(money) + '</b><span>预估挽回</span></div>' +
      '</div>') +
      /* 「上次保存 3 天前 · 只改了文案」是参照图上的装饰文案，本原型没有保存历史可算，
         写死等于编一条不存在的记录（刚建的空旅程也显示"3 天前"）。这里只说本会话的事实。 */
      '<p class="jr-saved jr-saved2">' + (jr.saved ? '本会话已保存 · 未发布' : '本会话尚未保存') + '</p>' +
      runBlock(jr, sh) +
      '</div></div>';
  }

  function compRow(label, n, tone) {
    return '<div class="jr-comp-r"><span class="jr-dot ' + tone + '"></span><span class="jr-comp-l">' + label + '</span><b>' + n + '</b></div>';
  }

  /* 右栏的「上次试运行」：只写这一次的结果，没跑过整块不出现 —— 不编历史 */
  function runBlock(jr, sh) {
    var r = jr.run;
    if (!r || !r.done) return '';
    var okN = Object.keys(r.ok || {}).length;
    var skipN = Object.keys(r.skip || {}).length;
    return '<div class="jr-side-t">上次试运行</div>' +
      '<p class="jr-saved">' + okN + ' 步走通' +
      (skipN ? '，' + skipN + ' 步未触发（失败兜底）' : '') +
      '。按节点配置模拟，不调真实 Agent。</p>';
  }

  /* 右栏：选中节点 → 配置表单（源码 ConfigPanel 的行为）。
     和源码一样，参数是**可编辑的输入框**，不是只读说明；「谁做 / 交什么 / 卡住怎么办」
     压成底部三行只读小字，不占主位。 */
  function nodeSide(a, jr, sh, n) {
    var kd = KIND[n.kind] || KIND.action;
    var cat = catOf(n.kind), cm = CAT[cat];
    var ups = [], downs = [];
    sh.edges.forEach(function (e) {
      if (e.t === n.k) ups.push(e.f);
      if (e.f === n.k) downs.push(e.t);
    });
    function names(list) {
      return list.map(function (k) {
        var x = null;
        sh.nodes.forEach(function (y) { if (y.k === k) x = y; });
        return esc(x ? x.name : k);
      }).join(' · ') || '—';
    }
    var cfg = (n.cfg || []).map(function (c, i) {
      return '<label class="jr-field"><span>' + esc(c[0]) + '</span>' +
        '<input class="jr-input" value="' + esc(c[1]) + '" data-jr-cfg="' + esc(n.k) + '|' + i + '"></label>';
    }).join('');
    return '<div class="jr-panel jr-side">' +
      '<div class="jr-panel-h"><span>节点配置</span>' +
      '<button class="jr-back" data-act="jr-sel" data-id="">× 关闭</button></div>' +
      '<div class="jr-side-b">' +
      '<div class="jr-ns-h">' +
      '<span class="jr-n-ico" style="background:' + cm.color + '15;color:' + cm.color + '">' + ico(nodeIcon(n)) + '</span>' +
      '<span><b>' + esc(n.name) + '</b><i>' + esc(cm.label + ' · ' + kd.label) + '</i></span>' +
      '</div>' +
      '<label class="jr-field"><span>节点名称</span>' +
      '<input class="jr-input" value="' + esc(n.name) + '" data-jr-label="' + esc(n.k) + '"></label>' +
      (cfg ? '<div class="jr-side-t">参数</div><div class="jr-cfg-form">' + cfg + '</div>'
        : '<p class="jr-saved" style="margin-top:10px">该节点类型无需额外配置</p>') +
      '<div class="jr-side-t">上下游</div>' +
      '<p class="jr-saved">上游：' + names(ups) + '</p>' +
      '<p class="jr-saved">下游：' + names(downs) + '</p>' +
      '<div class="jr-side-t">交接（只读）</div>' +
      '<div class="jr-flow4">' +
      '<div class="jr-flow4-r"><span>谁做</span><b>' + esc(kd.who) + '</b></div>' +
      '<div class="jr-flow4-r"><span>交出去</span><b>' + esc(n.tout || '—') + '</b></div>' +
      '<div class="jr-flow4-r fail"><span>卡住</span><b>' + esc(n.fail || kd.fail) + '</b></div>' +
      '</div>' +
      '<button class="btn-danger jr-del" data-act="jr-del" data-id="' + esc(n.k) + '">删除节点</button>' +
      '</div></div>';
  }

  function openNodeSheet(a, jr, sh, n, h) {
    var u = UI();
    if (typeof u.openSheet !== 'function') return;
    var kd = KIND[n.kind] || KIND.action;
    var ups = [], downs = [];
    sh.edges.forEach(function (e) {
      if (e.t === n.k) ups.push(e.f);
      if (e.f === n.k) downs.push(e.t);
    });
    function names(list) {
      return list.map(function (k) {
        var x = null;
        sh.nodes.forEach(function (y) { if (y.k === k) x = y; });
        return esc(x ? x.name : k);
      }).join(' · ') || '—';
    }
    var cfg = (n.cfg || []).map(function (c) {
      return '<div class="jr-cfg-r"><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b></div>';
    }).join('');
    u.openSheet({
      title: '节点详情 · ' + n.name,
      bodyHtml:
        '<div class="jr-ns-h"><span class="jr-n-ico k-' + n.kind + '">' + iconOf(n.kind) + '</span>' +
        '<span><b>' + esc(n.name) + '</b><i>' + esc(kd.label) + ' · ' + esc(n.sub || '') + '</i></span></div>' +
        '<div class="jr-flow4">' +
        '<div class="jr-flow4-r"><span>谁做</span><b>' + esc(kd.who) + '</b></div>' +
        '<div class="jr-flow4-r"><span>上一步交出</span><b>' + esc(n.tin || '—') + '</b></div>' +
        '<div class="jr-flow4-r"><span>这一步交出</span><b>' + esc(n.tout || '—') + '</b></div>' +
        '<div class="jr-flow4-r fail"><span>卡住怎么办</span><b>' + esc(n.fail || kd.fail) + '</b></div>' +
        '</div>' +
        (cfg ? '<div class="jr-side-t">参数</div><div class="jr-cfg">' + cfg + '</div>' : '') +
        '<div class="jr-side-t">上下游</div>' +
        '<p class="jr-saved">上游：' + names(ups) + '</p>' +
        '<p class="jr-saved">下游：' + names(downs) + '</p>' +
        '<div class="jr-side-t">这一棒的实况</div><p class="jr-saved">' + esc(n.io || '—') + '</p>',
      footHtml: (n.kind === 'end' ? '' : '<button class="btn-ghost danger" data-jr-del="1">删除这一步</button>') +
        '<button class="btn-ghost" data-v10="close">关掉</button>',
      /* 删除入口跟着节点详情走（原来在右栏，右栏改回纯概览后按钮会丢，删不掉节点） */
      onOpen: function (root) {
        var del = root.querySelector('[data-jr-del]');
        if (!del) return;
        del.addEventListener('click', function () {
          if (typeof u.closeSheet === 'function') u.closeSheet();
          ACTIONS['jr-del'](n.k, del, h);
        });
      }
    });
  }

  function statusOf(jr, b) { return jr.status[b.id] || b.status || 'draft'; }
  function statusLabel(s) { return { running: '运行中', paused: '已暂停', draft: '草稿' }[s] || '草稿'; }

  /* ============================================================
   * 7. 顶栏
   * ============================================================ */
  function barHtml(a, jr, sh) {
    var lib = libOf(a, jr);
    var st = statusOf(jr, sh.base);
    var opts = lib.map(function (x) {
      var nm = (jr.names && jr.names[x.id] != null) ? jr.names[x.id] : x.name;
      return '<option value="' + esc(x.id) + '"' + (x.id === jr.pick ? ' selected' : '') + '>' + esc(nm) + '</option>';
    }).join('');
    return '<div class="jr-bar">' +
      '<span class="jr-bar-l">' +
      /* ⚠ 这个 <select> 故意**不写 data-act**（2026-10-22 修「下拉点开就消失」）。
         app.js 的 bindContent 会给所有 [data-act] 挂 click —— 点击展开下拉时 click 先到，
         读到的是**展开前的旧值**，于是 jr-pick(旧值) 立刻整页重渲染，下拉框被销毁重建：
         表现就是"点开就消失 / 选了又跳回去"。改成自有属性 data-jr-pick，
         只由 bindToolSearch 的 change 监听接管，click 不再触发任何动作。 */
      '<span class="jr-selwrap"><select class="jr-input jr-select" data-jr-pick="1">' + opts + '</select></span>' +
      '<button class="btn-ghost sm" data-act="jr-new">＋ 新建旅程</button>' +
      '</span>' +
      '<span class="jr-bar-m jr-name-wrap"><input class="jr-name" id="jr-name" value="' +
      esc(sh.name || sh.base.name) + '" placeholder="旅程名称" title="点这里改旅程名称（本会话）" data-jr-name="1"></span>' +
      /* 「未保存」原来是一枚带字的胶囊，宽度 50px —— 它一出现，工具条就挤到换行，
         整页内容下移 39px，画布跟着跳。改成 7px 的小圆点，宽度恒定，不参与换行计算。 */
      (sh.dirty ? '<i class="jr-dirty-dot" title="有未保存的改动"></i>' : '') +
      '<span class="jr-bar-r">' +
      '<span class="jr-seg" role="group" aria-label="旅程状态">' +
      segBtn('draft', '草稿', st) + segBtn('running', '运行中', st) + segBtn('paused', '已暂停', st) +
      '</span>' +
      '<button class="btn-ghost sm jr-btn" data-act="jr-undo"' + (jr.undo.length ? '' : ' disabled') + '>' + ico('undo') + '恢复</button>' +
      '<button class="btn-ghost sm jr-btn" data-act="jr-save"' + (sh.dirty ? '' : ' disabled') + '>' + ico('save') + '保存</button>' +
      '<button class="btn-ghost sm jr-btn" data-act="jr-preview">' + ico('eye') + '预览</button>' +
      '<button class="btn-primary sm jr-btn" data-act="jr-publish">' + ico('refresh') +
      (statusOf(jr, sh.base) === 'running' ? '重新发布' : '发布') + '</button>' +
      '</span></div>';
    /* 工具条下面那行「演示态 · 改动只在本会话，刷新还原」已按业主意见删掉（2026-10-22）。
       这句话没有丢：页尾口径条里仍写着「编辑范围：本会话草稿…刷新还原，不写线上」，
       而且真正的边界在「发布旅程」的确认层里。 */
  }
  function segBtn(id, label, cur) {
    return '<button class="jr-seg-b' + (id === cur ? ' on ' + id : '') + '" data-act="jr-status" data-id="' + id + '">' + label + '</button>';
  }

  /* ============================================================
   * 8. 数值格式
   * ============================================================ */
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtK(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  /* ============================================================
   * 9. 一屏
   * ============================================================ */
  function page(a, ai, state, h) {
    var jr = Jr(state, a);
    var sh = shapeOf(a, jr);
    if (!sh.nodes.some(function (n) { return n.k === jr.sel; })) jr.sel = null;
    var lay = layout(sh.nodes);
    /* jr.zoom = 用户手动缩放的档位；jr.fit = 上次自动适应算出来的比例。
       渲染时先用 fit 顶上（2026-10-22）：原来 jr.zoom 为 null 就是 1，重渲染瞬间画布
       从 0.72 弹回 1:1，等 setTimeout 的 __jrFit 再缩回去 —— 每点一次节点就闪一下，
       还会让"刚落位的节点"和鼠标对不上（拖放测出来偏 117px 就是这一帧的账）。 */
    var zoom = jr.zoom == null ? (jr.fit || 1) : jr.zoom;
    /* 居中留白也在渲染时就写死（2026-10-22）：交给渲染后的 centerCanvas 补，会有一帧
       "旧的 margin + 新的画布高度"，新建旅程时看着就是画布跳一下。
       旧 stage 还在，高度可以直接量 —— 面板高度跟视口走、不随内容变，所以这个值是准的。 */
    var mc = 0;
    var stOld = global.document.getElementById('jr-stage');
    if (stOld && stOld.clientHeight) {
      var pad0 = Math.floor(((stOld.clientHeight - lay.h * zoom) / 2) / zoom) - 1;
      mc = pad0 > 6 ? pad0 : 6;
    }
    /* 兜底节点（失败路径）默认不铺在画布上，只留一条入口；点开才画 */
    var shown = sh.nodes.filter(function (n) { return !n.hidden; });
    var hiddenN = sh.nodes.length - shown.length;

    var body =
      barHtml(a, jr, sh) +
      '<div class="jr-main' + (jr.focus ? ' focus' : '') + '">' +
      railHtml(jr) +
      '<div class="jr-panel jr-stage-wrap">' +
      (jr.focus ? '<button class="jr-tools-btn" data-act="jr-tools" title="展开 / 收起节点工具箱">' + ico('plus') + '工具箱</button>' : '') +
      '<div class="jr-panel-h"><span>' + esc(sh.base.name) + ' · 画布</span>' +
      '<span class="jr-hd">' +
      '<span class="jr-hint">拖节点改位置 · 点节点看「交给下一步什么」 · 虚线 = 兜底路径</span>' +
      '<button class="jr-hd-btn" data-act="jr-tidy" title="整理：清掉手工拖动的位置，按流程列重新排布">' + ico('tidy') + '</button>' +
      /* 专注模式：三栏把中栏压到 610px，六列流程必然看不全。收起左右两栏后画布 1190px，
         同一张图 0.96 缩放下全见、字 12px —— 这才是"一屏看全整条旅程"该有的样子。 */
      '<button class="jr-hd-btn' + (jr.focus ? ' on' : '') + '" data-act="jr-focus" title="专注模式：收起左右两栏，画布占满（Esc 退出）">' + ico('eye') + '</button>' +
      /* 试运行（2026-10-22，照扣子）：它是这类画布上最该显眼的动作，放绿色实心，不做成幽灵按钮。
         跑的是"按节点配置模拟一遍"：状态、交接物、节奏都用配置里的数据，不调真实 Agent。 */
      '<button class="jr-hd-run" data-act="jr-run" title="按节点配置把这条旅程模拟走一遍（不调真实 Agent）">' +
      ico('zap') + '试运行</button>' +
      '</span></div>' +
      '<div class="jr-stage" id="jr-stage" data-zoom="' + zoom + '">' +
      (shown.length ? '' : '<div class="jr-empty">画布为空：从左侧拖拽节点开始编排旅程</div>') +
      '<div class="jr-canvas" id="jr-canvas" style="width:' + lay.w + 'px;height:' + lay.h + 'px;' +
        (zoom === 1 ? '' : 'zoom:' + zoom) +
        ';margin-top:' + mc + 'px;margin-bottom:' + mc + 'px' +
        (jr.pan && (jr.pan.x || jr.pan.y) ? ';transform:translate(' + jr.pan.x + 'px,' + jr.pan.y + 'px)' : '') + '">' +
      edgesHtml(shown, sh.edges, lay.geo, jr.sel, lay.w, lay.h, jr.edgeSel) +
      shown.map(function (n) { return nodeHtml(n, lay.geo[n.k], jr.sel, a, jr.run); }).join('') +
      '</div>' +
      /* 兜底提示 / 小地图 / 缩放控件必须挂在 stage **外面**（2026-10-22 修）：
         stage 是 overflow:auto 的滚动容器，绝对定位的子元素会跟着内容一起滚 ——
         实测横向滚 180px，小地图和缩放按钮整个左移 180px，跑到画布中间。
         挂到 .jr-stage-wrap（position:relative，不滚动）上，它们才钉在右下/左下。 */
      '</div>' +
      (hiddenN
        ? '<button class="jr-tail" data-act="jr-tail">⚑ 还有 1 条兜底路径未显示 · 点开看</button>'
        : '') +
      (shown.length ? miniHtml(shown, lay) : '') +
      '<div class="jr-zoom">' +
      '<span class="jr-pct" id="jr-pct">' + Math.round(zoom * 100) + '%</span>' +
      '<button data-act="jr-zoom" data-id="in" aria-label="放大" title="放大">＋</button>' +
      '<button data-act="jr-zoom" data-id="out" aria-label="缩小" title="缩小">−</button>' +
      '<button data-act="jr-zoom" data-id="fit" aria-label="适应宽度" title="适应宽度：整条旅程塞进一屏（字会变小）">⤢</button>' +
      '</div>' +
      '</div>' +
      sideHtml(a, ai, jr, sh, lay.geo) +
      '</div>';

    /* 渲染完那一拍再量尺寸：没手动缩放过就自适应，缩放过就只做居中 + 小地图视口框 */
    setTimeout(function () {
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      var jrv = (hh && hh.state) ? hh.state.jr : null;
      if (!jrv || jrv.zoom == null) { if (global.__jrFit) global.__jrFit(); return; }
      if (global.__jrLayout) global.__jrLayout();
    }, 0);

    /* 页尾只写「这一屏的口径 + 编辑边界」两行小字。
       不用 h.metaBar：agentDetail 已经在每页末尾统一挂一条，这里再挂就是两条叠在一起（实测两个"数据口径"块）。
       （2026-10-22 补充：renderers 那边现在对编排页不再挂 metaBar，这一条成为本页唯一的口径条。） */
    var foot = '<div class="jr-foot">' +
      '<span><b>本页口径</b>节点与参数是配置态（按业务线内置，不随天变化）；「累计触达」按本 Agent 日均 ' +
      fmtInt(F.dailyRow(ai, 0).calls) + ' 次调用 × 0.29 折算成每天进入旅程的人数，再乘天数。' +
      /* 召回率 18.4% 与客单价 ¥268 是内置估值参数，不是实测 —— 上一版只交代了 0.29，
         另外两个数字（尤其"预估挽回 ¥205 万"）等于凭空出现，评审一定会问出处。 */
      '其中召回率与「预估挽回」用的客单价 ¥268 是业务线内置的估值参数，不是本期实测值。</span>' +
      '<span><b>草稿范围</b>改动存本机浏览器（刷新不丢），不写线上；换浏览器 / 清缓存会丢。</span>' +
      '</div>';
    return '<div class="jr-wrap">' + body + foot + '</div>';
  }

  /* ============================================================
   * 10. 动作
   * ============================================================ */
  /* 视图状态跨重渲染保持（2026-10-22）。
     整页重渲染会换掉 #jr-stage 这个 DOM，新元素的 scrollLeft 天然是 0 ——
     实测滚到 200px 后点一个节点，画面直接跳回最左；放大后停在中间的图也一样被拽走。
     React Flow 里没有这件事，因为容器不重建、节点增量更新。
     这一版先把"重渲染后回到原处"补上，选中/取消选中再走真正的局部更新（见 applySelection）。 */
  function refresh(h) {
    var d = global.document;
    var st = d.getElementById('jr-stage');
    var sl = st ? st.scrollLeft : 0, sp = st ? st.scrollTop : 0;
    /* 每次重渲染落一次草稿：加/删/接线/改名/切状态都走这里，一处覆盖全部写操作。
       只有拖动不走（它不重渲染），由 jr-drop 单独落盘。 */
    var a0 = agentOf(h);
    if (a0) saveDraft(a0, Jr(h.state, a0));
    h.navigate({}, { scroll: false });
    var st2 = d.getElementById('jr-stage');
    if (st2 && (sl || sp)) { st2.scrollLeft = sl; st2.scrollTop = sp; }
    if (global.__jrLayout) global.__jrLayout(); else updateMiniViewport();
  }
  function agentOf(h) { return S.AGENTS[S.idx.agent[h.state.agentId]]; }

  /* 切旅程 */
  /* 切旅程 / 新建 / 整理之后都要重新自适应，但**不能**"先按旧比例画一帧、下一帧 __jrFit 再改" ——
     两帧之间整块画布突然缩一下，就是那句「秒闪」：新建旅程时画布从 0.72（1212 宽）跳到 1.0（400 宽），
     画布高度和居中位置在同一帧里全变。这里在动作里先把新画布的宽算出来（layout 不需要 DOM），
     直接把 zoom 定死，渲染就一帧到位。 */
  function presetZoom(a, jr) {
    var st = global.document.getElementById('jr-stage');
    if (!st || !st.clientWidth) { jr.zoom = null; return; }
    var sh = shapeOf(a, jr);
    var lay = layout(sh.nodes);
    var avail = st.clientWidth - 30;
    if (avail <= 0) { jr.zoom = null; return; }
    jr.zoom = Math.max(MIN_AUTO, Math.min(1, avail / lay.w));
    jr.fit = jr.zoom;
  }

  ACTIONS['jr-pick'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var v = id || (btn && btn.value) || '';
    if (!v) return;
    /* 撤销栈按旅程隔离：切到另一条旅程后，栈里那些"上一条旅程的改动"不该还能撤
       （按下去撤的是别处的账，操作者会以为撤的是眼前这条） */
    jr.pick = v; jr.sel = null; jr.undo = []; jr.edgeSel = null; jr.run = null;
    /* 清 zoom 再让 __jrFit 补是上一版的做法，代价是两帧不一致的闪烁；
       现在先把新画布的缩放算好，一次渲染到位。 */
    presetZoom(a, jr);
    refresh(h);
  };

  /* 新建旅程：真的建一条空旅程（触发器 + 输出），可以往里加步骤 */
  ACTIONS['jr-new'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    /* 序号取本地旅程里的最大号 +1（LIB 那条同前缀的也要算），避免造出两条「未命名旅程 1」 */
    var lib = libOf(a, jr);
    var n = 0;
    lib.forEach(function (x) {
      var mm = /^local-(\d+)$/.exec(x.id);
      if (mm) n = Math.max(n, Number(mm[1]));
    });
    n += 1;
    jr.added = n;
    var jid = 'local-' + n;
    jr.edit[jid] = {
      nodes: [
        { k: 't1', kind: 'trigger', name: '新旅程起点', sub: '选一个触发器事件', io: '未接入', col: 0, row: 0,
          tin: '还没选触发事件', tout: '一条待处理的客户记录', cfg: [['出发事件', '未配置']] },
        { k: 'e1', kind: 'end', name: '结果回写', sub: '结论落库', io: '未接入', col: 1, row: 0,
          tin: '前面各步的结论', tout: 'CRM 交互记录' }
      ],
      edges: [{ f: 't1', t: 'e1' }]
    };
    /* 让新旅程出现在下拉里：写进本会话的 jr.local，**不碰 LIB**。
       LIB 是按业务线共享的常量，push 进去等于让同业务线的所有 Agent 都多一条它没有的旅程。 */
    jr.local[jid] = {
      id: jid, name: '未命名旅程 ' + n, status: 'draft', ver: 'v0.1',
      desc: '刚建的空旅程：只有一个触发器和一支输出。从左边工具箱加步骤，加完点「发布旅程」才会生效。',
      tags: ['草稿'], nodes: [], edges: [], reach: { span: 1 }
    };
    jr.pick = jid; jr.sel = null; jr.edgeSel = null; jr.run = null;
    presetZoom(a, jr);       /* 先算好新空旅程的缩放，避免"旧比例 → 新比例"闪一下 */
    h.toast('已新建一条空旅程（草稿）', 'ok');
    refresh(h);
  };

  /* 加一步：插到「输出」之前，并把它接进链上 */
  ACTIONS['jr-add'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var p = String(id || '').split('|');
    var kind = p[0] || 'action', name = p[1] || '新步骤';
    var at = null;
    if (p[2] && p[2].charAt(0) === '@') {
      var xy = p[2].slice(1).split(',');
      at = { x: Number(xy[0]) || 0, y: Number(xy[1]) || 0 };
    }
    var sh = shapeOf(a, jr);
    pushUndo(a, jr);
    var end = null;
    sh.nodes.forEach(function (n) { if (n.kind === 'end') end = n; });
    var key = nextKey(sh.nodes, kind);
    var col, row = 0;
    if (end) { col = num(end.col); end.col = num(end.col) + 1; }
    else { col = sh.nodes.length; }
    var nn = {
      k: key, kind: kind, name: name, sub: '本会话新加的一步', io: '尚未接入',
      col: col, row: row,
      /* 落点换算成"卡片中心对准鼠标"，并夹到画布内（负坐标的节点会被 stage 的
         overflow 裁掉又滚不回来，等于凭空丢一步） */
      dropX: at ? Math.max(0, at.x - NW / 2) : null,
      dropY: at ? Math.max(0, at.y - (H[kind] || H.action) / 2) : null,
      tin: end ? '上游交给这一步的内容（待配置）' : '（起点）',
      tout: '这一步交给下一步的内容（待配置）',
      /* 2026-10-28：「负责人」改为「执行方」—— who 里存的是「平台 · 事件总线」「本 Agent」这类执行方，
       本来就不是人名，挂「负责人」是错标。 */
      cfg: [['状态', '未配置'], ['执行方', KIND[kind] ? KIND[kind].who : '平台']]
    };
    /* 原来指向 end 的边改指新节点，再加一条 新节点 → end */
    var edges = sh.edges.map(function (e) {
      return e.t === (end && end.k) ? { f: e.f, t: key, label: e.label, tone: e.tone, dash: e.dash } : e;
    });
    if (end) edges.push({ f: key, t: end.k });
    else if (sh.nodes.length) edges.push({ f: sh.nodes[sh.nodes.length - 1].k, t: key });
    jr.edit[jr.pick] = { nodes: sh.nodes.concat([nn]), edges: edges };
    jr.sel = key;
    h.toast('已加一步「' + name + '」（插在输出前）', 'ok');
    refresh(h);
  };

  /* 删一步：上下游自动接起来 */
  ACTIONS['jr-del'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var key = String(id || '');
    var target = null;
    sh.nodes.forEach(function (n) { if (n.k === key) target = n; });
    if (!target) return;
    pushUndo(a, jr);
    var ups = [], downs = [];
    sh.edges.forEach(function (e) { if (e.t === key) ups.push(e.f); if (e.f === key) downs.push(e.t); });
    var edges = sh.edges.filter(function (e) { return e.f !== key && e.t !== key; });
    ups.forEach(function (u) { downs.forEach(function (d) { edges.push({ f: u, t: d }); }); });
    jr.edit[jr.pick] = { nodes: sh.nodes.filter(function (n) { return n.k !== key; }), edges: edges };
    jr.sel = null;
    jr.edgeSel = null;
    h.toast('已删「' + target.name + '」，上下游已接上', 'ok');
    refresh(h);
  };

  /* 局部更新出来的 DOM 不会被 app.js 的 bindContent 扫到（它只在整页渲染后跑一次），
     所以换完右栏 / 插进删除按钮之后，必须自己把里面的 [data-act] 绑上 ——
     否则「× 关闭」「删除节点」这些点了完全没反应。语义与 app.js 的 handleAction 一致。 */
  function bindActs(root, h) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-act]'), function (el) {
      if (el.__jrBound) return;
      el.__jrBound = 1;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = el.getAttribute('data-act');
        var fn = global.ACTIONS[act];
        if (fn) { fn(el.getAttribute('data-id'), el, h); return; }
        if (h && h.toast) h.toast('演示环境：该操作（' + act + '）未接线', 'info');
      });
    });
  }

  /* 选中 / 取消选中走局部更新，不整页重渲染。
     一次整页重渲染的代价不只是 11ms：整块 content 换新（23.8KB HTML），
     画布滚动归零、卡片 hover 与 transition 全断、正在拖的对象被换掉 —— 手感全在这些细节里。
     这里只动三处：目标卡片的 class、相关连线的 class、右栏那块面板。 */
  function applySelection(h, key) {
    var d = global.document;
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    jr.sel = key || null;
    jr.edgeSel = null;

    Array.prototype.forEach.call(d.querySelectorAll('.jr-node'), function (n) {
      var k = n.getAttribute('data-key');
      var on = k === jr.sel;
      n.classList.toggle('on', on);
      var del = n.querySelector('.jr-n-del');
      if (on && !del) {
        var btn = d.createElement('button');
        btn.className = 'jr-n-del';
        btn.setAttribute('data-act', 'jr-del');
        btn.setAttribute('data-id', k);
        btn.title = '删除节点';
        btn.textContent = '×';
        n.appendChild(btn);
        bindActs(n, h);
      } else if (!on && del) {
        del.parentNode.removeChild(del);
      }
    });

    Array.prototype.forEach.call(d.querySelectorAll('.jr-e[data-edge]'), function (p) {
      var pair = String(p.getAttribute('data-edge')).split('>');
      p.classList.remove('sel');
      p.classList.toggle('on', !!jr.sel && (jr.sel === pair[0] || jr.sel === pair[1]));
    });

    var side = d.querySelector('.jr-side');
    if (side) {
      side.outerHTML = sideHtml(a, S.idx.agent[a.id], jr, sh, null);
      var side2 = d.querySelector('.jr-side');
      if (side2) bindActs(side2, h);
    }
  }

  ACTIONS['jr-sel'] = function (id, btn, h) {
    applySelection(h, id || null);
  };

  /* 展开兜底路径：把定义里 hidden 的那条放出来（只是显示，不改流程） */
  ACTIONS['jr-tail'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var node = null;
    sh.nodes.forEach(function (n) { if (n.hidden) node = n; });
    if (!node) return;
    node.hidden = false;
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges };
    jr.sel = node.k;
    refresh(h);
  };

  ACTIONS['jr-status'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var st = String(id || '');
    if (!st || st === statusOf(jr, sh.base)) return;
    var apply = function () {
      jr.status[sh.base.id] = st;
      h.toast('旅程状态已改为「' + statusLabel(st) + '」', st === 'paused' ? 'warn' : 'ok');
      refresh(h);
    };
    if (st === 'paused') {
      var ai = S.idx.agent[a.id];
      var queued = Math.round(F.dailyRow(ai, 0).calls * 0.02);
      h.dangerConfirm(h, {
        title: '暂停「' + sh.base.name + '」？',
        desc: '暂停后这条旅程不再产生新的触达，已经在队列里的 ' + fmtInt(queued) + ' 条会先跑完。',
        tone: 'danger',
        impacts: [
          { label: '新客户', value: '不再进入这条旅程' },
          { label: '在途客户', value: '按当前步骤跑完，不中断' },
          { label: '恢复', value: '从暂停点继续，不补发暂停期间的触达' }
        ],
        onConfirm: apply
      });
      return;
    }
    apply();
  };

  /* 一键整理：把手工拖过的位置清掉，回到按列自动排布。
     拖动可以随便来，但拖乱了得有一条能回去的路 —— 原版这类画布都有 auto layout 入口。 */
  ACTIONS['jr-tidy'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var moved = sh.nodes.filter(function (n) { return n.ox || n.oy || n.dropX != null; }).length;
    if (!moved) { h.toast('没有手工挪过的节点，已经是自动排布', 'warn'); return; }
    pushUndo(a, jr);
    sh.nodes.forEach(function (n) { delete n.ox; delete n.oy; delete n.dropX; delete n.dropY; });
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges };
    jr.sel = null; jr.pan = { x: 0, y: 0 };
    presetZoom(a, jr);       /* 画布随位移清空而变窄，缩放也跟着一帧到位 */
    h.toast('已按流程列重新排布（' + moved + ' 个节点归位）', 'ok');
    refresh(h);
  };

  /* 专注模式：收起左右两栏，画布吃满宽度。
     三栏时中栏只有 610px，六列流程只能靠 0.72 缩放 + 横向滚动看；专注后 1190px，
     0.96 缩放就能一屏看全且字 12px —— 这是"看全"和"看清"能同时成立的那个尺度。 */
  ACTIONS['jr-focus'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    jr.focus = !jr.focus;
    jr.zoom = null; jr.fit = null; jr.sel = null;   /* 换了容器宽度，重新自适应 */
    refresh(h);
    h.toast(jr.focus ? '专注模式：画布已占满（Esc 退出）' : '已回到三栏', 'ok');
  };

  /* 专注模式下左栏是浮层：点一次出来，再点收起（不重渲染，纯 class 切换） */
  ACTIONS['jr-tools'] = function (id, btn, h) {
    var rail = global.document.querySelector('.jr-main .jr-rail');
    if (!rail) return;
    rail.classList.toggle('show');
  };

  ACTIONS['jr-undo'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    if (!jr.undo.length) { h.toast('没有可撤销的改动', 'warn'); return; }
    var s = jr.undo.pop();
    var name = baseOf(a, s.jid, jr).name;
    jr.pick = s.jid;
    jr.edit[s.jid] = { nodes: s.nodes, edges: s.edges };
    jr.sel = null;
    h.toast('已撤销「' + name + '」的上一步改动', 'ok');
    refresh(h);
  };

  ACTIONS['jr-save'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    jr.saved = 1;
    /* clean 快照 = "上次保存时的样子"，dirty 靠它比出来（shapeOf 里用） */
    jr.clean = jr.clean || {};
    jr.clean[sh.base.id] = JSON.stringify({ n: sh.nodes, e: sh.edges, name: sh.name || sh.base.name });
    /* 真落盘（2026-10-22）：上一版这里是把 localStorage 写入删掉的，因为当时没有读取路径。
       现在 Jr() 会 loadDraft 读回来，写入才有意义 —— 保存 = 立刻写本机，不刷新也丢不了。 */
    saveDraft(a, jr);
    h.toast('草稿已保存到本机 · 刷新不丢', 'ok');
    refresh(h);
  };

  ACTIONS['jr-preview'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var u = UI();
    if (typeof u.openSheet !== 'function') { h.toast('预览组件未加载', 'bad'); return; }
    /* 预览 = 拿这条旅程真跑一遍：按列顺序走，每一步写清谁做、交什么、多久 */
    var rows = sh.nodes.filter(function (n) { return !n.hidden; }).sort(function (x, y) {
      return (num(x.col) - num(y.col)) || (num(x.row) - num(y.row));
    }).map(function (n, i) {
      var kd = KIND[n.kind] || KIND.action;
      var dur = { trigger: '即时', wait: '按时长', action: '1–3 分钟', branch: '< 1 秒', agent: '1.9s（P99）', end: '即时' }[n.kind];
      return '<tr><td class="jr-pv-i">' + (i + 1) + '</td>' +
        '<td><b>' + esc(n.name) + '</b><div class="jr-pv-s">' + esc(n.sub || '') + '</div></td>' +
        '<td>' + esc(kd.label) + '</td><td>' + esc(kd.who) + '</td>' +
        '<td class="jr-pv-io">' + esc(n.tout || '—') + '</td>' +
        '<td>' + esc(dur || '—') + '</td></tr>';
    }).join('');
    u.openSheet({
      title: '预览：' + sh.base.name + '（' + statusLabel(statusOf(jr, sh.base)) + ' · ' + sh.base.ver + '）',
      wide: true,
      bodyHtml: '<div class="jr-pv-h">这条旅程按节点顺序走一遍：每一步谁做、交出什么、大概多久。' +
        '真正的分支判定要等运行数据，这里按主路径展示。</div>' +
        '<table class="jr-pv"><thead><tr><th>#</th><th>这一步</th><th>类型</th><th>谁做</th><th>交给下一步</th><th>耗时</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>',
      footHtml: '<button class="btn-ghost" data-v10="close">关掉</button>'
    });
  };

  /* ============================================================
   * 9b. 试运行（2026-10-22，照扣子的做法补）
   *   扣子的编排画布上，「试运行」是绿色主按钮，跑完节点边框变绿、右上角能看输入输出。
   *   这里的差别：我们没接真实执行引擎，所以跑的是**配置态模拟** ——
   *   顺序、交接物、参数都取自节点定义，节奏是固定步进（不是真实时延）。
   *   兜底路径（虚线那条）不参与绿灯：它没被执行过，标成跑通就是编。
   * ============================================================ */
  function durMs(n) {
    /* 步进节奏，纯演示用；真实时延要等接上执行引擎。别把它当性能数据引用。 */
    return { trigger: 120, wait: 520, action: 380, branch: 120, agent: 760, end: 120 }[n.kind] || 300;
  }
  function runPlan(sh) {
    var fb = {};
    sh.edges.forEach(function (e) { if (e.dash) fb[e.t] = 1; });
    var vis = sh.nodes.filter(function (n) { return !n.hidden; });
    var order = vis.filter(function (n) { return !fb[n.k]; }).sort(function (x, y) {
      return (num(x.col) - num(y.col)) || (num(x.row) - num(y.row));
    });
    var skip = {};
    vis.forEach(function (n) { if (fb[n.k]) skip[n.k] = 1; });
    return { order: order, skip: skip };
  }
  function badgeEl(cls, txt, title) {
    var s = global.document.createElement('span');
    s.className = 'jr-run-badge ' + cls;
    s.textContent = txt;
    s.title = title;
    return s;
  }
  function showRunBar(i, total, name) {
    var wrap = global.document.querySelector('.jr-stage-wrap');
    if (!wrap) return;
    var bar = wrap.querySelector('.jr-runbar');
    if (!bar) {
      bar = global.document.createElement('div');
      bar.className = 'jr-runbar';
      wrap.appendChild(bar);
    }
    bar.innerHTML = '<b>' + i + '/' + total + '</b> 正在跑：' + esc(name);
  }
  function hideRunBar() {
    var wrap = global.document.querySelector('.jr-stage-wrap');
    var bar = wrap && wrap.querySelector('.jr-runbar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  var runTimer = null;
  function playRun(h, a, jr, plan) {
    var d = global.document;
    var cv = d.getElementById('jr-canvas');
    if (!cv) return;
    if (runTimer) { clearTimeout(runTimer); runTimer = null; }
    Array.prototype.forEach.call(cv.querySelectorAll('.jr-node'), function (n) {
      n.classList.remove('run-active', 'run-ok', 'run-skip');
      var b = n.querySelector('.jr-run-badge');
      if (b && b.parentNode) b.parentNode.removeChild(b);
    });
    jr.run = null;
    var order = plan.order, i = 0;
    var tick = function () {
      if (i > 0) {
        var prev = cv.querySelector('.jr-node[data-key="' + order[i - 1].k + '"]');
        if (prev) {
          prev.classList.remove('run-active');
          prev.classList.add('run-ok');
          prev.appendChild(badgeEl('ok', '✓', '本次走通'));
        }
      }
      if (i >= order.length) { finishRun(h, a, jr, plan); return; }
      var cur = cv.querySelector('.jr-node[data-key="' + order[i].k + '"]');
      if (cur) cur.classList.add('run-active');
      showRunBar(i + 1, order.length, order[i].name);
      i++;
      runTimer = setTimeout(tick, 320);
    };
    tick();
  }
  function finishRun(h, a, jr, plan) {
    runTimer = null;
    var cv = global.document.getElementById('jr-canvas');
    if (cv) {
      Array.prototype.forEach.call(cv.querySelectorAll('.jr-node'), function (n) {
        n.classList.remove('run-active');
        if (plan.skip[n.getAttribute('data-key')]) {
          n.classList.add('run-skip');
          n.appendChild(badgeEl('skip', '—', '本次未触发（失败兜底路径）'));
        }
      });
    }
    hideRunBar();
    var ok = {};
    plan.order.forEach(function (n) { ok[n.k] = 1; });
    jr.run = { done: 1, ok: ok, skip: plan.skip, total: plan.order.length };
    h.toast('试运行完成：' + plan.order.length + ' 步走通', 'ok');
    refresh(h);   /* 右栏出结果；画布重建后徽标与绿框由 nodeHtml 按 jr.run 重画 */
  }

  ACTIONS['jr-run'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var u = UI();
    if (typeof u.openSheet !== 'function') { h.toast('运行组件未加载', 'bad'); return; }
    var plan = runPlan(sh);
    if (!plan.order.length) { h.toast('画布是空的，先加节点再试运行', 'warn'); return; }
    var est = plan.order.reduce(function (s, n) { return s + durMs(n); }, 0);
    var skipN = Object.keys(plan.skip).length;
    var rows = plan.order.slice(0, 4).map(function (n) {
      var kd = KIND[n.kind] || KIND.action;
      return '<div class="jr-flow4-r"><span>' + esc(kd.label) + '</span><b>' + esc(n.name) +
        '　' + esc(n.tout || '—') + '</b></div>';
    }).join('');
    u.openSheet({
      title: '试运行：' + sh.base.name,
      bodyHtml: '<div class="jr-pv-h">按节点配置把这条旅程走一遍：<b>' + plan.order.length + ' 步</b>，节奏约 ' +
        (est / 1000).toFixed(1) + ' 秒' + (skipN ? '；另有 ' + skipN + ' 步兜底路径本次不触发' : '') +
        '。用配置里的交接物和参数模拟，<b>不调用真实 Agent</b>，也不产生真实触达。</div>' +
        '<div class="jr-flow4">' + rows + '</div>' +
        (plan.order.length > 4 ? '<p class="jr-saved" style="margin-top:8px">…后面还有 ' + (plan.order.length - 4) + ' 步</p>' : ''),
      footHtml: '<button class="btn-ghost" data-v10="close">取消</button>' +
        '<button class="btn-primary" data-jr-run-go>开始运行</button>',
      onOpen: function (root) {
        var go = root.querySelector('[data-jr-run-go]');
        if (!go) return;
        go.addEventListener('click', function () {
          if (typeof u.closeSheet === 'function') u.closeSheet();
          playRun(h, a, jr, plan);
        });
      }
    });
  };

  ACTIONS['jr-publish'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    h.dangerConfirm(h, {
      title: '发布「' + sh.base.name + '」到线上？',
      desc: '发布后新客户会按这条旅程走，影响的量级见下；本原型里「发布」只改本会话状态，不真发。',
      tone: 'danger',
      impacts: [
        { label: '生效范围', value: '新进入的客户立即按新版走' },
        { label: '在途客户', value: '仍按旧版跑完，不打断' },
        { label: '回滚', value: '可回滚到 ' + sh.base.ver + '，但要重新预检', tone: 'warn' }
      ],
      onConfirm: function () {
        jr.status[sh.base.id] = 'running';
        jr.saved = 1;
        h.toast('已发布（演示）· 新客户按新版进入', 'ok');
        refresh(h);
      }
    });
  };

  ACTIONS['jr-zoom'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var cur = jr.zoom == null ? fitZoom() : jr.zoom;
    if (id === 'in') cur = Math.min(MAX_ZOOM, cur + 0.1);
    else if (id === 'out') cur = Math.max(MIN_FIT, cur - 0.1);
    /* 「适应宽度」是显式动作：允许掉到 MIN_FIT 把整条旅程塞进一屏，同时把平移归零 */
    else { cur = fitZoom(true); jr.pan = { x: 0, y: 0 }; }
    jr.zoom = cur;
    refresh(h);
  };

  /* 从连接点拉到另一个节点：建一条边（同一对节点已有边就不重复加） */
  ACTIONS['jr-link'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var p = String(id || '').split('>');
    var from = p[0], to = p[1];
    if (!from || !to || from === to) return;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    var dup = sh.edges.some(function (e) { return e.f === from && e.t === to; });
    if (dup) { h.toast('这两步已经连过了', 'warn'); return; }
    /* 起点不能是输出 */
    var f = null, t2 = null;
    sh.nodes.forEach(function (n) { if (n.k === from) f = n; if (n.k === to) t2 = n; });
    if (!f || !t2 || f.kind === 'end') { h.toast('这一步不能再往外连', 'warn'); return; }
    pushUndo(a, jr);
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges.concat([{ f: from, t: to }]) };
    h.toast('已连上：' + (f.name || from) + ' → ' + (t2.name || to), 'ok');
    refresh(h);
  };

  ACTIONS['jr-blank'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    if (!jr.sel && !jr.edgeSel) return;      /* 本来就没选中，不用动 DOM */
    if (jr.sel) { applySelection(h, null); return; }
    jr.edgeSel = null;
    var d = global.document;
    Array.prototype.forEach.call(d.querySelectorAll('.jr-e[data-edge]'), function (p) { p.classList.remove('sel', 'on'); });
  };

  ACTIONS['jr-edge-sel'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    jr.edgeSel = id || null;
    jr.sel = null;
    var d = global.document;
    Array.prototype.forEach.call(d.querySelectorAll('.jr-e[data-edge]'), function (p) {
      p.classList.toggle('sel', !!jr.edgeSel && p.getAttribute('data-edge') === jr.edgeSel);
      p.classList.remove('on');
    });
    Array.prototype.forEach.call(d.querySelectorAll('.jr-node'), function (n) {
      n.classList.remove('on');
      var del = n.querySelector('.jr-n-del');
      if (del) del.parentNode.removeChild(del);
    });
  };

  ACTIONS['jr-edge-del'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var key = String(id || '');
    if (!key) return;
    var sh = shapeOf(a, jr);
    var hit = sh.edges.filter(function (e) { return (e.f + '>' + e.t) === key; })[0];
    if (!hit) { jr.edgeSel = null; refresh(h); return; }
    pushUndo(a, jr);
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges.filter(function (e) { return (e.f + '>' + e.t) !== key; }) };
    jr.edgeSel = null;
    h.toast('已删掉这条连线 · 要还原就点「恢复」', 'ok');
    refresh(h);
  };

  /* Ctrl + 滚轮：一次 0.08，比按钮的 0.1 细，滚起来不跳 */
  ACTIONS['jr-zoom-step'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var cur = jr.zoom == null ? fitZoom() : jr.zoom;
    jr.zoom = Math.max(MIN_FIT, Math.min(MAX_ZOOM, cur + Number(id || 0)));
    refresh(h);
  };

  /* 顶栏改名：写进本会话（不改 LIB —— 那是共享的，改了别的 Agent 也会看到） */
  /* 输入类操作不整页重渲染（重渲染会让输入框失焦、光标跳到末尾），
     但顶栏的「未保存」和保存键要立刻醒过来 —— 这里只动那两个节点。 */
  function nudgeDirty() {
    var d = global.document;
    if (!d) return;
    var bar = d.querySelector('.jr-bar-m');
    if (bar && !d.querySelector('.jr-dirty-dot')) {
      var tag = d.createElement('i');
      tag.className = 'jr-dirty-dot';
      tag.title = '有未保存的改动';
      bar.parentNode.insertBefore(tag, bar.nextSibling);
    }
    var save = d.querySelector('[data-act="jr-save"]');
    if (save) save.removeAttribute('disabled');
    var undo = d.querySelector('[data-act="jr-undo"]');
    if (undo) undo.removeAttribute('disabled');
  }

  ACTIONS['jr-cfg'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var p = String(id || '').split('|');
    var key = p[0], idx = Number(p[1]);
    var val = btn ? btn.value : '';
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    sh.nodes.forEach(function (n) {
      if (n.k !== key || !n.cfg || !n.cfg[idx]) return;
      n.cfg[idx] = [n.cfg[idx][0], val];
    });
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges };
    nudgeDirty();
  };

  ACTIONS['jr-node-label'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var val = btn ? String(btn.value).trim() : '';
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    sh.nodes.forEach(function (n) { if (n.k === id && val) n.name = val; });
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges };
    nudgeDirty();
    var card = document.querySelector('.jr-node[data-key="' + id + '"] .jr-n-name');
    if (card) card.textContent = val;
  };

  ACTIONS['jr-rename'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    var v = String(id == null ? '' : id).trim();
    jr.names = jr.names || {};
    jr.names[jr.pick] = v || baseOf(a, jr.pick, jr).name;
    refresh(h);
    var el = global.document.getElementById('jr-name');
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
  };

  ACTIONS['jr-tool-q'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var jr = Jr(h.state, a);
    jr.toolQ = String(id || '');
    refresh(h);
    /* 输入框重渲染后要还焦点，否则打一个字就丢焦 */
    var el = global.document.getElementById('jr-tool-q');
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
  };

  /* 缩放边界（2026-10-22 修正）。
     自动缩放的下限是 0.72 而不是 0.5：0.5 时卡片名 13px 只剩 6.5px，等于把字缩成噪点。
     自动缩放宁可留下横向滚动（stage 本来就是 overflow:auto），也不把字压到看不清。
     用户点「适应宽度」是显式动作，才允许掉到 0.4 把整条旅程塞进一屏。 */
  var MIN_AUTO = 0.72, MIN_FIT = 0.4, MAX_ZOOM = 1.6;

  function fitZoom(allowTiny) {
    var d = global.document;
    var st = d.getElementById('jr-stage');
    var cv = d.getElementById('jr-canvas');
    if (!st || !cv) return 1;
    var avail = st.clientWidth - 28;
    var w = parseFloat(cv.style.width) || cv.offsetWidth || 1;
    /* 上限 1：自动缩放只负责"装得下"，不负责"放大到铺满"—— 放大反而溢出 */
    return Math.max(allowTiny ? MIN_FIT : MIN_AUTO, Math.min(1, avail / w));
  }

  /* 搜索框：回车/输入即过滤（input 事件不走 data-act 的 click 委托，单独绑一次） */
  function bindToolSearch() {
    var d = global.document;
    if (!d || d.__jrToolBound) return;
    d.__jrToolBound = 1;
    d.addEventListener('input', function (e) {
      var t = e.target;
      if (!t) return;
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (!hh) return;
      if (t.id === 'jr-tool-q') {
        var A = global.ACTIONS['jr-tool-q'];
        if (A) A(t.value, t, hh);
        return;
      }
      if (t.getAttribute && t.getAttribute('data-jr-name')) {
        var B = global.ACTIONS['jr-rename'];
        if (B) B(t.value, t, hh);
        return;
      }
      if (t.getAttribute && t.getAttribute('data-jr-cfg')) {
        var C = global.ACTIONS['jr-cfg'];
        if (C) C(t.getAttribute('data-jr-cfg'), t, hh);
        return;
      }
      if (t.getAttribute && t.getAttribute('data-jr-label')) {
        var E = global.ACTIONS['jr-node-label'];
        if (E) E(t.getAttribute('data-jr-label'), t, hh);
      }
    }, false);
    /* 旅程下拉：<select> 走 change，不走 click（click 在展开时就触发，读到的是旧值）。
       它不带 data-act（见 barHtml 里的说明），所以只能在这里接。 */
    d.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute('data-jr-pick') !== '1') return;
      var A = global.ACTIONS['jr-pick'];
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (A && hh) A(t.value, t, hh);
    }, false);
  }

  /* ============================================================
   * 11. 拖动 / 首次适应（document 上绑一次，不随重渲染失效）
   * ============================================================ */
  /* 对齐辅助线（2026-10-22 补）。原版 FlowCanvas 拖动时会出 helper lines：
     左/中/右三条竖线、上/中/下三条横线，差几像素就吸上去并画一条贯穿画布的线。
     少了它，节点永远差一两像素、连线看起来是歪的 —— 这是"专业感"最直接的一处。
     只和"同一条水平/垂直线上最近的另一个节点"比，不做全图两两匹配，节点数 <20 足够。 */
  function clearGuides(cv) {
    if (!cv) return;
    Array.prototype.forEach.call(cv.querySelectorAll('.jr-guide'), function (g) {
      if (g.parentNode) g.parentNode.removeChild(g);
    });
  }
  function addGuide(cv, cls, x, y, w, h) {
    var g = global.document.createElement('div');
    g.className = 'jr-guide ' + cls;
    g.style.left = x + 'px';
    g.style.top = y + 'px';
    g.style.width = w + 'px';
    g.style.height = h + 'px';
    cv.appendChild(g);
  }
  function snapGuides(cv, el, x, y, w, h) {
    clearGuides(cv);
    var TH = 6, bestX = null, bestY = null;
    var mineX = [x, x + w / 2, x + w];
    var mineY = [y, y + h / 2, y + h];
    Array.prototype.forEach.call(cv.querySelectorAll('.jr-node'), function (o) {
      if (o === el) return;
      var ox = parseFloat(o.style.left) || 0, oy = parseFloat(o.style.top) || 0;
      var ow = parseFloat(o.style.width) || 0, oh = parseFloat(o.style.height) || 0;
      [ox, ox + ow / 2, ox + ow].forEach(function (v) {
        mineX.forEach(function (m) {
          var dd = v - m;
          if (Math.abs(dd) <= TH && (!bestX || Math.abs(dd) < Math.abs(bestX.d))) bestX = { d: dd, v: v };
        });
      });
      [oy, oy + oh / 2, oy + oh].forEach(function (v) {
        mineY.forEach(function (m) {
          var dd = v - m;
          if (Math.abs(dd) <= TH && (!bestY || Math.abs(dd) < Math.abs(bestY.d))) bestY = { d: dd, v: v };
        });
      });
    });
    var out = { x: x, y: y, hitX: !!bestX, hitY: !!bestY };
    var cw = parseFloat(cv.style.width) || 0, chh = parseFloat(cv.style.height) || 0;
    if (bestX) { out.x = x + bestX.d; addGuide(cv, 'v', bestX.v, 0, 1, chh); }
    if (bestY) { out.y = y + bestY.d; addGuide(cv, 'h', 0, bestY.v, cw, 1); }
    return out;
  }

  /* 拖动时让相关连线实时跟着走（2026-10-22 补）。
     原来拖动过程中 SVG 一动不动，松手才整页重画 —— 节点在动、线不动，两张皮，
     这是最像"演示稿"的一处手感。这里只重算与被拖节点相连的边，其它边不碰。 */
  function liveEdges(cv, key) {
    if (!cv) return;
    Array.prototype.forEach.call(cv.querySelectorAll('.jr-e[data-edge]'), function (p) {
      var pair = String(p.getAttribute('data-edge')).split('>');
      if (pair[0] !== key && pair[1] !== key) return;
      var a = cv.querySelector('.jr-node[data-key="' + pair[0] + '"]');
      var b = cv.querySelector('.jr-node[data-key="' + pair[1] + '"]');
      if (!a || !b) return;
      var ga = { x: parseFloat(a.style.left) || 0, y: parseFloat(a.style.top) || 0,
        w: parseFloat(a.style.width) || NW, h: parseFloat(a.style.height) || H.action };
      var gb = { x: parseFloat(b.style.left) || 0, y: parseFloat(b.style.top) || 0,
        w: parseFloat(b.style.width) || NW, h: parseFloat(b.style.height) || H.action };
      var pt = edgePath(ga, gb);
      p.setAttribute('d', pt.d);
      var lab = cv.querySelector('.jr-el[data-for="' + pair[0] + '>' + pair[1] + '"]');
      if (lab) { lab.style.left = pt.mx + 'px'; lab.style.top = pt.my + 'px'; }
      /* 线上的删除点跟着走，不然拖完节点那个 × 会留在原地 */
      var grp = p.parentNode;
      var cir = grp && grp.querySelector ? grp.querySelector('.jr-e-del') : null;
      var xx = grp && grp.querySelector ? grp.querySelector('.jr-e-x') : null;
      var by = pt.my - (lab ? 15 : 0);
      if (cir) { cir.setAttribute('cx', pt.mx.toFixed(1)); cir.setAttribute('cy', by.toFixed(1)); }
      if (xx) {
        xx.setAttribute('d',
          'M' + (pt.mx - 2.6).toFixed(1) + ',' + (by - 2.6).toFixed(1) + 'L' + (pt.mx + 2.6).toFixed(1) + ',' + (by + 2.6).toFixed(1) +
          'M' + (pt.mx + 2.6).toFixed(1) + ',' + (by - 2.6).toFixed(1) + 'L' + (pt.mx - 2.6).toFixed(1) + ',' + (by + 2.6).toFixed(1));
      }
    });
  }

  function bindStage() {
    var d = global.document;
    if (!d || d.__jrStageBound) return;
    d.__jrStageBound = 1;
    var drag = null, pan = null;

    /* ── 从工具箱拖到画布 ──────────────────────────────
       左栏那句「拖拽到画布添加」以前只是文案，没接任何事件（等于骗人）。这里补上：
       dragstart 记下类型与名字，drop 时按落点算出坐标，作为这一步的初始偏移。 */
    d.addEventListener('dragstart', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.jr-tool');
      if (!t || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', t.getAttribute('data-drag-kind') + '|' + t.getAttribute('data-drag-name'));
      e.dataTransfer.effectAllowed = 'copy';
      t.classList.add('dragging');
    }, false);
    d.addEventListener('dragend', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.jr-tool');
      if (t) t.classList.remove('dragging');
    }, false);

    d.addEventListener('dragover', function (e) {
      var st = e.target && e.target.closest && e.target.closest('#jr-stage');
      if (!st) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      st.classList.add('drop-on');
    }, false);
    d.addEventListener('dragleave', function (e) {
      var st = e.target && e.target.closest && e.target.closest('#jr-stage');
      if (st && !st.contains(e.relatedTarget)) st.classList.remove('drop-on');
    }, false);
    d.addEventListener('drop', function (e) {
      var st = e.target && e.target.closest && e.target.closest('#jr-stage');
      if (!st) return;
      e.preventDefault();
      st.classList.remove('drop-on');
      var raw = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (!raw) return;
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      var A = global.ACTIONS['jr-add'];
      if (!hh || !A) return;
      var cv = d.getElementById('jr-canvas');
      if (!cv) return;
      /* 落点换算必须锚在 **canvas** 上，不能锚在 stage 上（2026-10-22 修）。
         原来用 (clientX - stage.left + scrollLeft)/k：漏掉了三样东西 ——
         ① canvas 在 stage 里是 margin:auto 居中的，左右各有一段留白；
         ② pan 的 translate；③ zoom 只作用在 canvas 上。于是实测拖到 (785,428)，
         节点落在 (990,581)，偏 205×154px。canvas.getBoundingClientRect() 已经把
         居中 / 滚动 / 平移 / 缩放全部算进去了，反算回来就是画布坐标。 */
      var k = parseFloat(cv.style.zoom) || 1;
      var cb = cv.getBoundingClientRect();
      var x = Math.round((e.clientX - cb.left) / k);
      var y = Math.round((e.clientY - cb.top) / k);
      A(raw + '|@' + x + ',' + y, st, hh);
    }, false);

    /* ── 空白处拖拽平移 ────────────────────────────────
       React Flow 那类画布的基本功：抓空白拖，图跟着走。画布小于视口时用 margin 平移，
       大于视口时用滚动条位移 —— 两条路都走，才不会出现"拖了没反应"。 */
    d.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      /* 连线、小地图、缩放控件上不启动平移 */
      if (t.closest('.jr-zoom') || t.closest('.jr-mini') || t.closest('.jr-tail') || t.closest('.jr-port')) return;
      if (t.closest('.jr-node')) return;
      var st = t.closest('#jr-stage');
      if (!st) return;
      var hh0 = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      var pv = (hh0 && hh0.state && hh0.state.jr) ? (hh0.state.jr.pan || { x: 0, y: 0 }) : { x: 0, y: 0 };
      pan = { st: st, x: e.clientX, y: e.clientY, sl: st.scrollLeft, stt: st.scrollTop,
        cv: d.getElementById('jr-canvas'), moved: false, px: pv.x || 0, py: pv.y || 0, nx: pv.x || 0, ny: pv.y || 0 };
      st.classList.add('panning');
    }, true);

    d.addEventListener('pointermove', function (e) {
      if (!pan) return;
      var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
      if (!pan.cv) return;
      /* 统一用 transform 平移（= React Flow 的 viewport 位移）。
         之前按"能不能滚"分两条路走，结果画布比视口小时走不到任何一条，拖了没反应 ——
         现在只有一条路，跟手。放大到超出容器时交给滚动条兜底。 */
      var px = pan.px + dx, py = pan.py + dy;
      pan.cv.style.transform = 'translate(' + px + 'px,' + py + 'px)';
      pan.nx = px; pan.ny = py;
      /* 小地图的视口框要跟着走（2026-10-22 修）。
         平移走的是 transform，不是 scroll —— 不触发 scroll 事件，所以滚动条那条路能更新、
         拖空白这条路纹丝不动（实测 translate(-100,30) 之后框的 x 一点没变）。
         这里按帧节流地补一次：pointermove 一帧好几次，没必要每次都写四个属性。 */
      if (!pan.raf) {
        pan.raf = 1;
        (global.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
          if (pan) pan.raf = 0;
          updateMiniViewport();
        });
      }
    }, true);

    d.addEventListener('pointerup', function (e) {
      if (!pan) return;
      pan.st.classList.remove('panning');
      /* 把平移记进会话态：不记的话下一次重渲染（点节点、切旅程）图会"跳"回正中 */
      var hh1 = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (hh1 && hh1.state && hh1.state.jr && pan.moved) hh1.state.jr.pan = { x: pan.nx, y: pan.ny };
      pan = null;
    }, true);

    /* 滚轮缩放：React Flow 的 zoomOnScroll 默认为 true —— 鼠标在画布上直接滚就是缩放，
       不用按住 Ctrl（按住也能用）。想滚页面就把指针移出画布。 */
    d.addEventListener('wheel', function (e) {
      var st = e.target && e.target.closest && e.target.closest('#jr-stage');
      if (!st) return;
      e.preventDefault();
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      var A = global.ACTIONS['jr-zoom-step'];
      if (A && hh) A(e.deltaY > 0 ? -0.08 : 0.08, st, hh);
    }, { passive: false });

    /* ── 从连接点拉线（React Flow 的核心动作）────────────────
       按住节点右侧的小圆点拖到另一个节点上松手 = 新建一条委派边。
       拖的过程中画一根临时线跟着鼠标走，松手落在空白处就取消。 */
    var link = null;
    d.addEventListener('pointerdown', function (e) {
      var port = e.target && e.target.closest && e.target.closest('.jr-port');
      if (!port) return;
      e.preventDefault(); e.stopPropagation();
      var node = port.closest('.jr-node');
      var cv = d.getElementById('jr-canvas');
      if (!node || !cv) return;
      var k = parseFloat(cv.style.zoom) || 1;
      var r = node.getBoundingClientRect();
      link = { from: node.getAttribute('data-key'), k: k, cv: cv,
        x1: (r.right - cv.getBoundingClientRect().left) / k,
        y1: (r.top + r.height / 2 - cv.getBoundingClientRect().top) / k,
        path: null };
      var svg = cv.querySelector('.jr-svg');
      if (svg) {
        link.path = d.createElementNS('http://www.w3.org/2000/svg', 'path');
        link.path.setAttribute('class', 'jr-e linking');
        svg.appendChild(link.path);
      }
      cv.classList.add('linking');
    }, true);

    d.addEventListener('pointermove', function (e) {
      if (!link || !link.path) return;
      var box = link.cv.getBoundingClientRect();
      var x2 = (e.clientX - box.left) / link.k, y2 = (e.clientY - box.top) / link.k;
      var dx = Math.max(30, Math.abs(x2 - link.x1) * 0.45);
      link.path.setAttribute('d', 'M' + link.x1 + ',' + link.y1 +
        ' C' + (link.x1 + dx) + ',' + link.y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
      /* 松手会连到哪个节点，得在拖的时候就说出来（原版拖线时目标节点会亮）。
         半径 40px 起亮，松手判定用的还是源码的 20px connectionRadius。 */
      var hot = null, best = 40;
      Array.prototype.forEach.call(d.querySelectorAll('.jr-node'), function (n) {
        if (n.getAttribute('data-key') === link.from) return;
        var r = n.getBoundingClientRect();
        var hx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        var hy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        var dist = Math.sqrt(hx * hx + hy * hy);
        if (dist <= best) { best = dist; hot = n; }
      });
      Array.prototype.forEach.call(d.querySelectorAll('.jr-node.link-hot'), function (n) {
        if (n !== hot) n.classList.remove('link-hot');
      });
      if (hot) hot.classList.add('link-hot');
    }, true);

    d.addEventListener('pointerup', function (e) {
      if (!link) return;
      var from = link.from, path = link.path, cv = link.cv;
      link = null;
      if (path && path.parentNode) path.parentNode.removeChild(path);
      if (cv) cv.classList.remove('linking');
      Array.prototype.forEach.call(d.querySelectorAll('.jr-node.link-hot'), function (n) { n.classList.remove('link-hot'); });
      var t = e.target;
      var to = t && t.closest ? t.closest('.jr-node') : null;
      /* 松手没落在节点上时，按 20px 半径找最近的节点（React Flow 的 connectionRadius 默认就是 20）。
         要求"像素级点中"会让接线变成一件需要瞄准的事。 */
      if (!to) {
        var best = null, bestD = 20;
        d.querySelectorAll('.jr-node').forEach(function (n) {
          var r = n.getBoundingClientRect();
          var dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
          var dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= bestD) { bestD = dist; best = n; }
        });
        to = best;
      }
      if (!to) return;
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      var A = global.ACTIONS['jr-link'];
      if (A && hh) A(from + '>' + to.getAttribute('data-key'), to, hh);
    }, true);

    /* 点连线：选中（再按 Delete 删）；点空白：取消选中 */
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      /* 小地图：点哪滚哪（原版 minimap 的基本功，只能看不能走就是个色块） */
      var mini = t.closest('.jr-mini');
      if (mini) {
        var st0 = d.getElementById('jr-stage'), cv0 = d.getElementById('jr-canvas');
        if (st0 && cv0) {
          var svg = mini.querySelector('svg');
          var rr = (svg || mini).getBoundingClientRect();
          var mk = parseFloat(mini.getAttribute('data-k')) || 1;
          var mox = parseFloat(mini.getAttribute('data-ox')) || 0;
          var moy = parseFloat(mini.getAttribute('data-oy')) || 0;
          var mz = parseFloat(cv0.style.zoom) || 1;
          var mcx = ((e.clientX - rr.left) - mox) / mk;
          var mcy = ((e.clientY - rr.top) - moy) / mk;
          st0.scrollLeft = mcx * mz - st0.clientWidth / 2;
          st0.scrollTop = mcy * mz - st0.clientHeight / 2;
          updateMiniViewport();
        }
        return;
      }
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (!hh) return;
      var p = t.closest('.jr-e');
      if (p && p.getAttribute('data-edge')) {
        var A = global.ACTIONS['jr-edge-sel'];
        if (A) A(p.getAttribute('data-edge'), p, hh);
        return;
      }
      if (t.closest('#jr-stage') && !t.closest('.jr-node')) {
        /* 点空白 = 取消一切选中：连线选中、节点选中（右栏回概览） */
        var B = global.ACTIONS['jr-blank'];
        if (B) B('', t, hh);
      }
    }, false);

    /* 滚动时小地图的视口框要跟着走（scroll 不冒泡，用捕获） */
    d.addEventListener('scroll', function (e) {
      if (e.target && e.target.id === 'jr-stage') updateMiniViewport();
    }, true);

    d.addEventListener('keydown', function (e) {
      if (!d.querySelector('.jr-main')) return;   /* 不在编排页就别接管键位 */
      var tag0 = (e.target && e.target.tagName) || '';
      if (tag0 === 'INPUT' || tag0 === 'TEXTAREA') return;
      /* Ctrl/⌘ + Z：撤销（画布类工具的通用键位，和左上角「恢复」同一件事） */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        var st0 = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
        if (!st0 || !st0.state || !st0.state.jr) return;
        e.preventDefault();
        var U = global.ACTIONS['jr-undo'];
        if (U) U('', null, st0);
        return;
      }
      /* Esc：取消连线的选中态 */
      if (e.key === 'Escape') {
        var st1 = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
        /* Esc 逐层退出：先退出专注模式，再清连线选中 —— 和画布类工具的习惯一致 */
        if (st1 && st1.state && st1.state.jr && st1.state.jr.focus) {
          var F2 = global.ACTIONS['jr-focus'];
          if (F2) F2('', null, st1);
          return;
        }
        if (st1 && st1.state && st1.state.jr && st1.state.jr.edgeSel) {
          var S2 = global.ACTIONS['jr-edge-sel'];
          if (S2) S2('', null, st1);
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (!hh || !hh.state || !hh.state.jr) return;
      var jrv = hh.state.jr;
      if (!jrv.edgeSel && !jrv.sel) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      /* 优先删选中的连线；没有连线选中就删选中的节点（源码 deleteKeyCode 两者都管） */
      if (jrv.edgeSel) {
        var A = global.ACTIONS['jr-edge-del'];
        if (A) A(jrv.edgeSel, null, hh);
      } else {
        var B = global.ACTIONS['jr-del'];
        if (B) B(jrv.sel, null, hh);
      }
    }, false);

    d.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var node = t.closest('.jr-node');
      if (!node) return;
      var canvas = node.closest('#jr-canvas');
      if (!canvas) return;
      var key = node.getAttribute('data-key');
      drag = { el: node, key: key, canvas: canvas, x: e.clientX, y: e.clientY, moved: false,
        left: parseFloat(node.style.left) || 0, top: parseFloat(node.style.top) || 0 };
      node.classList.add('dragging');
      try { node.setPointerCapture(e.pointerId); } catch (err) {}
    }, false);

    d.addEventListener('pointermove', function (e) {
      if (!drag) return;
      /* 缩放走 style.zoom（会改布局尺寸，滚动条才对）：拖动位移要按同一比例换算 */
      var k = parseFloat(drag.canvas.style.zoom) || 1;
      var dx = (e.clientX - drag.x) / k, dy = (e.clientY - drag.y) / k;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      /* 吸附 10px 网格（源码 FlowCanvas 的 snapToGrid / snapGrid [10,10]）——
         不吸附的话节点永远差几个像素对不齐，连线看起来是歪的。 */
      var cw = parseFloat(drag.canvas.style.width) || 0;
      var ch = parseFloat(drag.canvas.style.height) || 0;
      var nw = parseFloat(drag.el.style.width) || NW;
      var nh = parseFloat(drag.el.style.height) || H.action;
      /* 夹在画布内（2026-10-22 修）。上一版没有上下界：往左上拖能到 left:-660/top:-490，
         节点落到 stage 可视区外，而 stage 的 scrollLeft/Top 归零、maxScrollLeft 只有 168，
         滚不回来也点不到 —— 一步就这么没了。 */
      var rawX = drag.left + dx, rawY = drag.top + dy;
      /* 先按原始位置比对辅助线（若先取整到 10px 网格，两个都在网格上的节点差值恒为 0 或 10，
         6px 阈值永远命中不了）。命中就吸到对齐线上，没命中再落回网格。 */
      var sg = snapGuides(drag.canvas, drag.el, rawX, rawY, nw, nh);
      var nx = sg.hitX ? sg.x : Math.round(rawX / 10) * 10;
      var ny = sg.hitY ? sg.y : Math.round(rawY / 10) * 10;
      nx = Math.max(0, Math.min(Math.max(0, cw - nw), nx));
      ny = Math.max(0, Math.min(Math.max(0, ch - nh), ny));
      drag.el.style.left = nx + 'px';
      drag.el.style.top = ny + 'px';
      drag.nx = nx; drag.ny = ny;
      liveEdges(drag.canvas, drag.key);
    }, false);

    d.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var dr = drag; drag = null;
      dr.el.classList.remove('dragging');
      clearGuides(dr.el.closest('#jr-canvas'));
      var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
      if (!hh) return;
      if (!dr.moved) {
        /* 没拖动 = 点选，交给统一动作通道 */
        var A = global.ACTIONS['jr-sel'];
        if (A) A(dr.key, dr.el, hh);
        return;
      }
      /* 拖过 = 记位置（写进本会话草稿），不触发选中。
         增量取"吸附后的最终位置 − 起始位置"，不用未取整的鼠标位移 ——
         否则每次拖动最多差 4.5px，拖几次状态里的位置就和画面对不上了。 */
      var ddx = (dr.nx == null ? dr.left : dr.nx) - dr.left;
      var ddy = (dr.ny == null ? dr.top : dr.ny) - dr.top;
      var A2 = global.ACTIONS['jr-drop'];
      if (A2) A2(dr.key + '|' + ddx + '|' + ddy, dr.el, hh);
    }, false);
  }

  /* 落位：把拖动位移写进节点（left/top 已由拖动直接改，这里只同步 state，供下次渲染重建） */
  ACTIONS['jr-drop'] = function (id, btn, h) {
    var a = agentOf(h); if (!a) return;
    var p = String(id || '').split('|');
    var key = p[0], dx = Number(p[1]) || 0, dy = Number(p[2]) || 0;
    var jr = Jr(h.state, a);
    var sh = shapeOf(a, jr);
    sh.nodes.forEach(function (n) {
      if (n.k === key) { n.ox = (n.ox || 0) + dx; n.oy = (n.oy || 0) + dy; }
    });
    jr.edit[jr.pick] = { nodes: sh.nodes, edges: sh.edges };
    /* 不重渲染：节点已经在拖动里就位了，重渲染会让它闪一下 */
    /* 但"未保存"要亮：拖位置也是改动，上一版没亮，顶栏看着像没改过 */
    nudgeDirty();
    /* 拖动不重渲染，落盘得自己补一次，否则刷新后位置回到自动排布 */
    saveDraft(a, jr);
  };

  /* 布局时把人工位移算进去 */
  var _layout = layout;
  layout = function (nodes) {
    var r = _layout(nodes);
    nodes.forEach(function (n) {
      if (!n.ox && !n.oy) return;
      var g = r.geo[n.k];
      if (!g) return;
      g.x += n.ox || 0;
      g.y += n.oy || 0;
    });
    return r;
  };

  bindToolSearch();
  bindStage();

  /* ============================================================
   * 12. 注册
   * ============================================================ */
  global.AGENT_TAB_RENDER = global.AGENT_TAB_RENDER || {};
  global.AGENT_TAB_RENDER.journey = page;

  /* 画布在 stage 里垂直居中（2026-10-22 业主意见「铺到底下」）。
     一行节点挤在画布顶端、下面空一大片，看着像没渲染完。
     用 margin-top 而不是 flex 的 align-items:center：flex 居中在内容高于容器时会把顶部裁掉
     （滚不到），而且画布一变高整图就位移；margin 是显式值，尺寸变化时只动 Δh/2，可控。 */
  function centerCanvas() {
    var d = global.document;
    var st = d.getElementById('jr-stage');
    var cv = d.getElementById('jr-canvas');
    if (!st || !cv) return;
    var visH = cv.getBoundingClientRect().height;   /* 含 zoom 的实际视觉高度 */
    /* margin 会被 zoom 一起缩放，所以先按 CSS 像素算再除回来 —— 不减这一步，
       1440 下量出来上留白 99、下留白 180，图还是偏上（实测）。 */
    var z = parseFloat(cv.style.zoom) || 1;
    var pad = Math.floor(((st.clientHeight - visH) / 2) / z) - 1;
    var v = pad > 6 ? pad : 6;
    cv.style.marginTop = v + 'px';
    /* 底部补同样的留白：滚动范围对称，滚到底时内容不会贴边 */
    cv.style.marginBottom = v + 'px';
  }

  global.__jrLayout = function () {
    centerCanvas();
    updateMiniViewport();
  };

  /* 按可视宽度自适应：只在用户没手动缩放过（state 里 zoom 为 null）时执行 */
  global.__jrFit = function () {
    var d = global.document;
    var st = d.getElementById('jr-stage');
    var cv = d.getElementById('jr-canvas');
    if (!st || !cv) return;
    var avail = st.clientWidth - 30;
    var w = parseFloat(cv.style.width) || 1;
    /* 下限走 MIN_AUTO（0.72）：小于这个值字数就不可读了，剩下的宽度交给滚动条 */
    var k = Math.max(MIN_AUTO, Math.min(1, avail / w));
    cv.style.zoom = k.toFixed(3);
    var pct = d.getElementById('jr-pct');
    if (pct) pct.textContent = Math.round(k * 100) + '%';
    centerCanvas();
    updateMiniViewport();
    /* 把算出来的比例记回会话态：下一次重渲染直接用这个值起手，不再"先 1:1 再缩回去" */
    var hh = global.APP_SHELL && global.APP_SHELL.helpers ? global.APP_SHELL.helpers() : null;
    if (hh && hh.state && hh.state.jr && hh.state.jr.zoom == null) hh.state.jr.fit = k;
  };
})(window);
