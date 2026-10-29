# 并行开发约定

这个原型是一个大文件加 41 个脚本，多人同时改会互相踩。这里把「谁改哪里」写死，并用脚本守住。
结论只有一条：**承认有一块串行区，把它冻起来排队；其余 88% 放开。**

## 一、串行区：约 775 行，占 11.7%

| 位置 | 内容 | 为什么串行 |
|---|---|---|
| 主 HTML 1–10 | head、favicon、meta | 只有一份 |
| 主 HTML 11–191 | base 令牌、buttons、topbar、avatar | `--var` 与页头是公共契约 |
| 主 HTML 236–319 | shell-nav、page-head | 侧栏与页头，每屏都用 |
| 主 HTML 424–441、571–626 | controls、cards-metrics | 按钮 / 卡片 / 指标的公共件 |
| 主 HTML 984–1087 | table、empty-fatal、meta-bar | 表格与元信息条，多数页面复用 |
| 主 HTML 1351–1433 | charts | `charts.js` 的配套样式 |
| 主 HTML 2104–2198 | toast、responsive | 全局提示与断点 |
| 主 HTML 6453–6596 | 41 条 script 与版本号 | 加载顺序即语义，版本号全挤在这 72 行 |
| `app.js` | 路由、state、helpers、图标表 | 所有页面都读它 |
| `renderers.js` | UI 导出、pageHead、agentDetail 壳 | 模板契约 |
| `renderers2.js` | 8871 行，15 个页面渲染器 | 多人同时加页面会语义打架 |
| `seed/data/query/decisions/facts/charts.js` | 数据契约 | 字段形状一变全站塌 |
| `v10-ui.js`、`v19-governance-fix.js`、`v39-retired.js` | 弹层 / 确认 / 审计的唯一出口 | 改一处影响所有页 |

**排队规则**：同一时刻只允许一个分支改串行区。改完先合，其它分支 rebase 后再动。

## 二、并行泳道：7 条，可以同时开工

| 泳道 | 文件 | 样式段落 |
|---|---|---|
| `agent-wb` | v23 v24 v27-agent-session v27-session-store v28 v41 | agent-list / agent-detail / agent-detail-top / filters-chips / hit-testing / ds-usage / tf / agent-net / org-view / dsh-tokens / dsh-verbatim / v27-agent-session / v27-scoped-type / v41-journey |
| `assets` | v10-detail-asset v10-detail-sandbox v26 v33 v34 v36 v38 | ent-icon / v26 账号页两段 / v26-kb-desk / v28-identity / v28-twocol / v29-perm-editor / cwall / perm-edit / awc / am-sec |
| `engine` | v10-interview v10-interview-home v10-interview-data v10-detail-survey v10-detail-gov v10-detail-flow v29 | user-pool / AI 访谈作业台 / svc-identity / v29 网关三页签 |
| `decision` | v50-decision | decision-room / 朝堂制 |
| `media` | kol render-kol v37-op-board | kol-task-view / v37 舆情看板 |
| `overview` | v30-overview-links v31-detail-links | 总览屏重排 / overview / misc-pages |
| `settings` | v40-settings | 无 |

样式段是交错的，不是按文件切开的：`assets` 的 `cwall`、`perm-edit` 夹在 `agent-wb` 的 `tf` 和 `v41-journey` 中间。所以归属按**段落**算，不按行号也不按文件。

## 三、三条规则

**开工**
```bash
git switch -c lane/assets
```
分支名带泳道名，一看就知道该跑哪个身份。

**改之前先问自己**：我要动的东西在不在我的段落里？
```bash
node _parallel/guard.cjs --lane assets --list   # 看归属
```

**收工前必跑**
```bash
node _parallel/guard.cjs --lane assets
```
全部落在自己边界内才推。越界会列到行，exit 1，可以挂 pre-push。

**要动串行区怎么办**
不要硬改。两条路：
1. 提一个只改串行区的小提交，让 core 合完、全员 rebase；
2. 或者先在 `lanes.json` 里把那段认领给你的泳道，再改 —— 认领要走一次评审，因为改的是别人的边界。

## 四、脚本用法

```bash
node _parallel/guard.cjs --list                  # 段落归属表，含行范围
node _parallel/guard.cjs --files                 # js 文件归属
node _parallel/guard.cjs --lane assets           # 以 assets 身份查未提交改动
node _parallel/guard.cjs --lane assets --base main   # 查相对 main 的改动
```

`--list` 末尾若提示「配置了但找不到的段落」，说明有人改了段落标题，`lanes.json` 要跟着改。
这是故意的：段落改名必须显式处理，否则归属会悄悄失效。

## 五、还没解决的三件事

1. **基线没建。** 现在 git 只有一个提交，35 个文件是脏的。不 commit 就没法开分支，guard 也会把整棵树当成越界。
2. **版本号还在 72 行里。** 每人改 js 都要 bump 自己那条，相邻两条间距中位数 1 行，98% 会撞。建议分支内不动 `?v=`，合并后统一跑 `_check/_ver-bump.cjs`。
3. **`renderers2.js` 还没拆。** 它整块归 core，意味着所有页面壳的改动都要排队。这是并行能力的实际上限。
