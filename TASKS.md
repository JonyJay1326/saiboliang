# TASKS.md — 赛博粮票 整体任务清单

> 单一清单、四条线分区。状态图例：✅ 完成 ｜ 🔄 进行中 ｜ ⬜ 未开始 ｜ ⏸ 等用户决策
> 「建议执行方」只是建议，分工约束见 `AGENTS.md` §8。

## 线 0 · 数据侧（后端任务已总结确认，此为基线）

| ID | 状态 | 任务 | 建议执行方 | 备注 / 验收 |
|---|---|---|---|---|
| B1 | ✅ | 数据架构文档 | WorkBuddy | `doc-data/cyber-granary-architecture.md` |
| B2 | ✅ | 数据契约（冻结层） | WorkBuddy | `doc-data/cyber-granary-data-contract.md`，改动须用户确认 |
| B3 | ✅ | 数据方案审查 | 已完成 | `doc-data/cyber-granary-data-review.md` |
| B4 | 🔄 | 采集管道实现（RSS 优先 → 官方结构化数据 → 专用页面解析；入口须过准入检查才启用） | Codex | [实测] 2026-09-17：模型报价改用 AA 自带 `pricing`，**OpenRouter 已下线**（`openrouterId`/`contextLength` 删除，`model-mappings.json` 作废）；两榜上限放宽至各 30 条并按模型去重；套餐扩到 17 条（6 个官方自动适配器 + 人工 record），`models` 改官方展示名。活动准入仍待确认。2026-09-18 资讯来源复核：InfoQ、智东西已接入，厂商官方公告通道待适配器设计，见 `code-backend/news-source-check.md`。运行见 `code-backend/README.md` |
| B5 | ✅ | GitHub Trending AI 精选采集：直接抓官方周/月榜 → AI 分类筛选，各 ≤10 条，保留来源顺序，默认周榜 | Codex | [实测] 2026-09-17：周/月官方页已采集，规则分类及歧义队列就绪；不自建监控池、star 快照、差分和历史名次。前端默认周榜仍随 F5 实施 |
| B6 | 🔄 | 数据源失败兜底：保留上次数据 + 标注条目旧日期与待确认信息 | Codex | [实测] 管道模块保留、骤降保护、整批校验、构建失败不推进已通过离线测试；前端陈旧提示与部署恢复未验收 |
| B7 | ⬜ | Actions workflow：采集+校验+构建+提交+部署同一 workflow，UTC 03:17/07:17/11:17 | Codex | 见 `AGENTS.md` §7；Trending 与中文资讯每次更新，AA/OpenRouter/套餐/活动每日一次 |
| B8 | ⏸ | 延期项封存：GitHub 监控池 / star 差分、五维评分与权重滑块、英文翻译服务 | — | 均不属于一期；恢复须先形成事实依据 + 走契约变更流程，由用户确认 |
| B9 | ✅ | **构建门禁端到端验收**：`python code-backend/pipeline.py collect --build-cwd code-frontend --build-command npm run build` | Codex / openCode | [实测 2026-09-18] 两个场景均已实跑：① **构建成功** → 45 页产出、`public/data` 与 `source-health` 推进到 `2026-09-18T02:37:02Z`、`run.json` 四模块全绿；② **构建失败**（Windows 下裸 `npm` 触发 WinError 2）→ `public/data`／`source-health`／`run.json` **全部保持原值**、退出码 1。**「构建读候选目录」已证**：构建发生在 `promote` 之前，而产物含本批新增票证，说明吃的是 `DATA_CANDIDATE_DIR`。顺带修 `pipeline.py`：构建命令首词过 `shutil.which`，解决 Windows 上 `.cmd` 无法 spawn |

## 线 1 · 前端（设计未定稿，当前只到盘点）

| ID | 状态 | 任务 | 建议执行方 | 备注 / 验收 |
|---|---|---|---|---|
| F1 | ✅ | 前端现状盘点（参考页/资产/待定项） | WorkBuddy | `doc-front/frontend-inventory.md` |
| F2 | ⏸ | **设计定稿（用户本人决策，AI 不得代定）** | 用户 | 阻塞 F3–F5。2026-09-18 新口径：**默认皮肤档定朴素档**（赛博档可选）；推进顺序＝基调板 → 定朴素档整体 → 逐页过（赛博增量其后），基调板在 `cache-tools/design-lab/`（本机不发布） |
| F3 | 🔄 | 前端结构规格（页面/组件/状态清单，只写结构与文字） | WorkBuddy 起草 → 用户审 | `doc-front/frontend-spec.md` 已就位并在随契约同步（票证 §4.2/§5.1 等章节仍待同步，见 `DATA-CHECK-TASK.md` §3）；不写色值/字号/CSS/动效 |
| F4 | ⬜ | 视觉 Token 重建（定稿后从设计稿提取） | 待定 | 旧稿色值仅存档，不作依据 |
| F5 | 🔄 | Astro + Vue 岛实现，真实路径路由 | Codex / openCode | [实测 2026-09-18] **页面与交互已齐**：Astro 5 + `<ClientRouter />`（真实路径、一期 `transition:animate="none"` + `fallback="swap"`）、10 条路由（`/tickets/[id]` 36 页 SSG，共 45 页）、构建期注入 5 个 JSON（含混批校验）、robots.txt／sitemap.xml（已排除 `/news`）、皮肤档与「我领到了」事件委托（整页一段脚本、挂 `astro:page-load` 重建）、`/tickets` 筛选与排序（岛，URL query 同步）、`/github` 周月切换／`/models` 两榜切换／`/plans` 分组选择（原生脚本显隐，见 F8）。构建 45 页 / 1.3s。**未做**：字体图片化（依赖 F4／A4）、`/tickets` 筛选的浏览器端行为未经真机验证（环境无浏览器自动化）。**首屏 JS 与占比见 F8** |
| F6 | ⬜ | 样式微调与走查 | Cursor | 设计定稿后 |
| F7 | ✅ | **岛架构：列表类页面的数据只允许出现一份** | 用户 | [2026-09-18 用户选 **b**（岛重渲染列表），实现中依据实测改为更优解] 原以为要在 Astro 与 Vue 各维护一份票卡模板——**未发生**：Astro 允许框架组件不加水合指令（纯构建期渲染、零客户端 JS），故票卡只保留 `TicketCard.vue` 一份。进一步实测发现「岛渲染列表」会导致**卡片数据在 HTML 里重复两份**（`content` 一项就占序列化 52%，而卡片根本不用它），HTML 达 97.36KB。**最终方案：岛只做「列表控制器」**——卡片由页面构建期渲染成静态 HTML（`TicketCard.vue` 无 client 指令），岛只接收 7 个索引字段，把筛选排序结果写成已有卡片的 `hidden` 与 CSS `order`，不重渲染。HTML 降至 **57.01KB（gzip 9.62，−56%）**，岛代码 3.1→2.2KB。纪律已写入 `frontend-spec.md` §10.2 |
| F8 | ✅ | **首屏 JS 预算与 Vue 运行时冲突（已实测并拍板）** | 用户 | [2026-09-18 用户选「分级预算 + 记框架占比」] `frontend-spec.md` §10.2 已改：**无岛页 < 15KB gzip／有岛页 < 50KB gzip**，新增「**框架运行时占比 < 60%，超阈值必须重评岛框架选型**」与「有岛页 TBT < 300ms」。实测：无岛页 **5.14KB**；`/tickets` **36.78KB**（去重后，Vue 运行时占 **71%**，**仍超 60% 阈值**）。三个切换未做成岛而是用原生脚本，占比未进一步恶化。**下次新增岛之前必须先复核该比例**。测量脚本 `code-frontend/scripts/measure.mjs`，**必须解析 ESM 传递依赖** |
| F8 | ⏸ | **首屏 JS 预算与 Vue 运行时的冲突** | 用户 | 实测：只装 `@astrojs/vue` 不上岛时，Vue 运行时 `client.js` 为 **28.94KB gzip**，而 `frontend-spec.md` §10.2 的首屏 JS 预算是 **< 30KB**；当前骨架首屏只加载 ClientRouter 的 5.28KB。**一旦接入第一个 Vue 岛，几乎吃掉全部预算**，留给业务逻辑的空间极小。可选：放宽 §10.2 预算／改用更轻的岛框架（Preact 约 4KB gzip）／全用原生脚本做岛。**改栈需用户确认**（现栈由 `AGENTS.md` §7 定为「Astro + Vue 岛」） |

## 线 2 · 部署

| ID | 状态 | 任务 | 建议执行方 | 备注 / 验收 |
|---|---|---|---|---|
| D1 | ✅ | 部署方案确定：GitHub Pages + Cloudflare DNS/CDN | 用户 | 见 `AGENTS.md` §7 |
| D2 | ✅ | 域名 saiboliang.top（NameSilo + Cloudflare NS） | 用户 | 已购 |
| D3 | ⬜ | 创建 GitHub 仓库并接入 Pages | Codex / 用户 | **单仓库**（2026-09-17 用户确认）：`code-frontend/` 与 `code-backend/` 都入库，采集+构建+部署同一 workflow（`AGENTS.md` §7）。根目录用白名单式 `.gitignore`（先排除全部、只放行 code-frontend / code-backend / .github），Secrets 挂本仓库 |
| D4 | ⬜ | Cloudflare DNS/CDN 代理配置 | 用户 | — |
| D5 | ⬜ | 发布前隐私检查：字体/证书/cache-tools 产物不进公开仓库 | 所有工具 | `AGENTS.md` §6，高压线 |

## 线 3 · 资产与授权

| ID | 状态 | 任务 | 建议执行方 | 备注 / 验收 |
|---|---|---|---|---|
| A1 | ✅ | 4 款喜鹊字体授权证书 | 用户 | 均已持有；证书留本机，不入库 |
| A2 | ⬜ | 证书与字体的本地安全存档位置确认 | 用户 | 建议放本目录外或非发布目录 |
| A3 | ✅ | 喜鹊万人造字体退场（2026-09-17 用户确认）：字体线收敛为 4 款喜鹊字体，气泡图 `bub-shou.png` / `bub-hui.png` 已随字体一并删除，`font-assets-preview.html` 对应组已移除 | 用户 | 后续气泡文案不再出图；如需恢复须用户重新确认授权 |
| A4 | ⬜ | `brand.png` 倍率复核：此前实测 1.71x（目标 ≥2x），需重出 2x | 用户 + cache-tools | [待复核] 实测数据来自另一工作区快照，以本目录文件实测为准 |
| A5 | ⬜ | 字体图片化工程军规落地（真实 width/height 属性、`img{width:auto;height:auto}`、`inline-block`） | Codex / Cursor | F5 实现时执行 |

## 线 4 · 合规与版权（二期）

> 来源：2026-09-18 抓取合规风险讨论。结论：一期**不做**，二期再评估。此处仅留痕，避免决策随对话丢失。
> 现状基线（已做到，非待办）：只存「标题 + 链接 + 事实数据」——**不抓正文、`summary` 恒为 null**；频率克制（域间隔 1s、每天 3 次、单源 120s 预算）；UA 带站点标识 `Saiboliang/0.1 (+https://saiboliang.top)`。
> 风险定位：标题 + 可见来源 + 跳转 = 「索引」而非「转载」；每源 ≤2 条、总量 ≤6 条 = 不构成对原站的实质性替代，是《反不正当竞争法》下最有力的抗辩基础。**若将来做站内全文阅读，性质立刻改变。**

| ID | 状态 | 任务 | 建议执行方 | 备注 / 验收 |
|---|---|---|---|---|
| C1 | ⏸ | **robots.txt 自动检查**：采集前拉取并解析，命中 `Disallow` 的入口标记为待确认，替代目前的人工发现 | Codex | 2026-09-18 用户决定暂缓二期。现状：项目内**无任何 robots 检查**；`code-backend/news-source-check.md` 的准入结论全靠人工核验（例：InfoQ `/feed` 被 `Disallow: /feed/` 覆盖但 `/feed` 不在该前缀内，当时靠人工判断 + 用户拍板保留） |
| C2 | ⏸ | **`/about` 增加「版权与下架」入口**（申诉/联系方式），收到权利人通知即删 | Codex / 用户 | 2026-09-18 用户决定暂缓二期，且**菜单不占位**。恢复条件：对外开放流量到一定量级，或收到权利人通知时优先做 |

---

**维护规则**：任务状态变更时直接改本表；新增任务带 ID（线前缀 + 序号）；完成项保留不删，作为进度档案。
