# assets 目录说明（生成于 2026-10-07，改动后请重跑 .audit-tmp/review/gen-assets-readme.cjs）

> ## ⚠ 2026-10-15：Agent 详情页「删了又回来了」——现在是**原样还原**状态
> 这一天里这一屏被删过一次、又按要求整页还原，过程留档如下（避免下次看到 diff 时误判）：
> 1. **删除**：整页（8 个 Tab）删除，含 `v27-agent-session.js` / `v27-session-store.js` /
>    `v28-session-engine.js` 三个文件与两段 CSS（`SECTION: dsh-verbatim`、`SECTION: v27-agent-session`，约 2160 行）。
> 2. **改向**：删除期间加过 `v32-agent-detail-link.js`，把入口指向另一个真前端工程 `系统4/agent-detail`。
> 3. **还原**（业主指示「先把旧页面恢复过来」）：从 `_bak/20261015-211249-del-agent-detail/`
>    **逐字节还原** 17 个文件 —— 主 HTML、`assets/{app,data,renderers,renderers2,seed,v10-builder,
>    v23-exp-agent-link,v24-agent-net}.js`、三个会话文件、5 个门禁脚本。
>    `v32-agent-detail-link.js` 已移出 assets（存 `_bak/…/tools/v32-agent-detail-link.js.removed`），
>    入口回到本原型的 `#/platform/agent-wb/{agentId}/{tab}`；`app.js` 里的 `agentRetiredBar` 兜底屏
>    随还原一起消失（已无触发路径）。
> **因此**：这一版是「删除前那一刻」的纯还原，没有夹带其它改动。
> `系统4/agent-detail` 那个新工程仍在（已按要求停手），与本原型互不影响。
> `_bak/20261015-211249-del-agent-detail/` 是这次删/还原的完整备份，别删。
> 本 README 下面的表**没有**跟着增减，别拿它当文件清单用 —— 真源始终是主 HTML 的 `<script src>` 顺序。

本目录是设计稿的**全部可执行部分**：`AI运营中台原型.html` 只是外壳（结构 + 全站 CSS），
业务数据与渲染逻辑都在这 25 个脚本里。**加载顺序是隐式契约**（下面的序号即 HTML 里的 `<script>` 顺序），
调换顺序会改变「谁覆盖谁」——尤其是下面标了自注入样式表的三个文件。

| # | 文件 | 行数 | KB | 自注入 <style> |
|:-:|---|--:|--:|---|
| 1 | `seed.js` | 658 | 42 | — |
| 2 | `decisions.js` | 278 | 26 | — |
| 3 | `facts.js` | 683 | 32 | — |
| 4 | `charts.js` | 292 | 14 | — |
| 5 | `query.js` | 883 | 42 | — |
| 6 | `kol.js` | 413 | 23 | — |
| 7 | `data.js` | 1959 | 132 | — |
| 8 | `renderers.js` | 732 | 52 | — |
| 9 | `renderers2.js` | 7927 | 557 | — |
| 10 | `render-kol.js` | 507 | 37 | — |
| 11 | `v10-ui.js` | 723 | 40 | v10-ui-css |
| 12 | `v10-detail-sandbox.js` | 1577 | 99 | v10-sbx-css |
| 13 | `v10-detail-asset.js` | 1740 | 112 | — |
| 14 | `v10-detail-flow.js` | 1629 | 91 | — |
| 15 | `v10-detail-survey.js` | 1310 | 78 | — |
| 16 | `v10-interview-data.js` | 497 | 32 | — |
| 17 | `v10-interview.js` | 1047 | 79 | — |
| 18 | `v10-interview-home.js` | 767 | 56 | — |
| 19 | `v10-detail-gov.js` | 456 | 26 | — |
| 20 | `v10-builder.js` | 15 | 1 | — |
| 21 | `v19-governance-fix.js` | 156 | 7 | — |
| 22 | `v23-exp-agent-link.js` | 602 | 35 | — |
| 23 | `v24-agent-net.js` | 599 | 30 | — |
| 24 | `app.js` | 1338 | 74 | — |
| 25 | `v29-gateway-tabs.js` | 697 | 49 | — |

> 第 25 行由手工补登（本仓的 `.audit-tmp/review/gen-assets-readme.cjs` 在当前交付目录里不存在，
> 跑不了生成脚本）。`v29-gateway-tabs.js` **拥有**网关页：三个页内 Tab（MCP 服务 / LLM 路由 / Skill）、
> 各自的渲染器、密钥清单 `GW_KEYS` 与「轮换 / 吊销」动作 `gw-key` 都在这里。
> `renderers2.js` 里原先那版 `gatewayPage` 与内联的 svc 健康计算**已删除**（留了一条指向本文件的注释），
> 所以它现在没有要覆盖的对象，只要排在 `renderers.js` 之后、`app.js` 之前即可。
> 它不注入样式表，CSS 写在主 HTML 里。

## 两条必须知道的事

**① 「阈值」只有一个真源**：`decisions.js` 必须先于一切消费它的文件加载（HTML 里有注释标着）。
改任何阈值都改这一个文件，不要在别处再写一个字面量。

**② 有两张运行时注入的样式表**：`v10-ui.js` 与 `v10-detail-sandbox.js` 会在页面加载后往 `<head>` 里
插自己的 `<style>`。这意味着同名类**谁生效取决于加载顺序**（实测 11 个类名跨表同名，例如
`metric` / `btn-ghost` / `lnk` / `msg`）。改样式时若发现"改了不生效"，先查是不是被后注入的表盖掉了。
**后续建议**：把这两张表并回 `AI运营中台原型.html` 的 `<style>`，并给跨表同名的类名做一次去重 —— 这是一次
有风险的改动（会改变现有覆盖关系），建议单独一轮做，不要和其它改动混在一起。

## 备份在哪

历史上的 `.bak*` / `_fixKB` 备份**不在本目录**，已移到仓库根的 `_backup/assets/`（保留，未删除）。
交付目录只留 24 个在跑的脚本。
