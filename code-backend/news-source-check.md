# 中文资讯来源验证（2026-09-17）

## 本轮改动

- `sources.py`：扩充 AI 产品识别；Claude Office、Mistral Firefox 更新归为产品更新，不能仅凭厂商品牌归为模型发布。明确价格/免费变化优先正确归类；排除传闻、融资、普通教程，不因标题包含“大会”一律拒绝正式发布。原有近 72 小时、最多 6 条、每源最多 2 条保持不变。
- `editorial/sources.json`：启用 [IT之家官方 RSS](https://www.ithome.com/rss/)，沿用现有 RSS 解析和失败保留流程。
- `test_pipeline.py`：增加真实标题的漏选、错分和误选回归用例。

## 实测结果

[实测] 量子位返回 10 条、Solidot 返回 20 条、IT之家返回 60 条。按本轮规则选出 2 条：Claude Office 产品更新、Mistral Firefox Smart Window。当前 IT之家这一页没有命中既定事件规则的条目，不补传闻或融资新闻凑数。RSS 条数为本次样本，不是固定值。

[实测] 17 项离线测试通过。资讯单模块真实采集及结构校验通过，候选输出在 `.cache/news-validation/news.json`。整批发布被现有 models.json 与当前模型契约不一致阻止：旧记录仍含 openrouterId、contextLength，而当前校验不再接受。未改动这部分已有模型代码/数据，也未单独替换公共 news.json 破坏批次一致性。

## AIBase

[实测] [中文列表](https://www.aibase.com/zh/news) 服务端 HTML 中可获取中文文章链接；详情页可获取 h1 标题及 Next.js 页面数据中的带时区 addtime。两篇样本：

- [文章 31139](https://www.aibase.com/zh/news/31139)：中文标题为千问 APP 未成年人保护模式更新；addtime 为 `2026-09-17T17:40:15.1505501+08:00`。
- [文章 31138](https://www.aibase.com/zh/news/31138)：中文融资报道；addtime 为 `2026-09-17T17:31:44.3750506+08:00`。该类内容应被本站精选规则排除。

[实测，后续启用] 已加入专用页面适配器并启用 AIBase。真实列表解析出 20 篇文章，逐篇核对文章 ID、h1 与页面数据标题，读取带时区 addtime 并转换 UTC；不使用列表“刚刚”或 updtime。页面数据结构变化、身份不一致、缺时区或请求失败时中止该源，沿用旧资讯模块。页面内部数据不是稳定公开 API。

适配器不执行网页 JavaScript，只解析内嵌 JSON；正文仅在内存中用于解析，不保存文章全文。新增分块数据解析、文章 ID 错配、缺失时区等回归测试；18 项离线测试通过。

[实测，最终复核] 已有模型批次已恢复契约一致性，本轮未修改模型实现。正式执行 `pipeline.py collect --modules news` 成功，公共批次更新为 `2026-09-17T15:44:56Z`。本次共精选 4 条（AIBase 2、量子位 1、Solidot 1）；排除了“将开源训练细节”的预告，保留 Wan3.0 模型更新与千问 APP 产品更新。上文“整批发布受阻”是上一轮状态，当前已解除。页面采集仍有模板变化风险。

AIBase 的报道链接属于中文报道；只有另行核实官方一手出处时，标题才跳官方页。不能将 AIBase 自身报道标记为厂商官方公告。

## 2026-09-18 来源复核与扩充

### 本轮改动

- `editorial/sources.json`：新增 [InfoQ](https://www.infoq.cn/feed) 与 [智东西](https://zhidx.com/rss) 两个中文 RSS 源；AIBase、量子位、Solidot、IT之家保持不变。
- `sources.py`：`sourceUrl` 落盘前应用 `normalize_url`（按契约 §4.5 去掉 `utm_*`、排序查询参数）；ID 仍为规范化 URL 的 SHA-256，语义不变。
- `test_pipeline.py`：新增跟踪参数剥离回归用例；23 项离线测试全部通过。
- [实测] 正式执行 `pipeline.py collect --modules news` 成功，公共批次更新为 `2026-09-17T16:45:30Z`。精选 6 条（InfoQ 2、AIBase 2、智东西 2）：model-release ×4 → major-update ×2，量子位、Solidot、IT之家本轮 0 入选（额度被更高优先级事件占满）。

### 准入实测（与管道同款 UA、超时、每域 1 请求）

| 源 | 入口 | 实测结果 | 72h 规则命中 | 结论 |
| --- | --- | --- | --- | --- |
| InfoQ | `https://www.infoq.cn/feed` | [实测] HTTP 200，application/xml，20 条，GMT 时间，中文标题 | 3 条（阶跃 StepAudio 3、Union Alpha、vivo AgentOS） | 启用 |
| 智东西 | `https://zhidx.com/rss` | [实测] HTTP 200，text/xml，20 条，+0800 时间，中文标题 | 4 条（网易同传模型、蚂蚁 SingProbe、联发科天玑 9600 Pro、飞书 8.0） | 启用 |
| 雷峰网 | `https://www.leiphone.com/feed` | [实测] 200 RSS 20 条 | 0（行业 PR/访谈为主） | 暂不启用 |
| 爱范儿 | `https://www.ifanr.com/feed` | [实测] 200 RSS 20 条 | 0（消费电子为主） | 暂不启用 |
| 少数派 | `https://sspai.com/feed` | [实测] 200 XML 10 条 | 0 | 暂不启用 |
| 钛媒体 | `https://www.tmtpost.com/rss.xml` | [实测] 200 XML 19 条 | 1 假阳性（Altman 访谈被误判 model-release） | 不启用 |
| OSCHINA | `https://www.oschina.net/news/rss` | [实测] 200 RSS 50 条 | 5 命中中 4 条为普通开源项目发版 | 高噪声，不启用 |
| 雷科技 | `https://www.leikeji.com/rss` | [实测] 200 XML 20 条 | 0 | 暂不启用 |
| 极客公园 | `https://www.geekpark.net/rss` | [实测] 200 RSS 30 条，但 `<pubdate>` 小写、链接为 `http://` | parse_feed 无法取日期 | 不启用（如需接入须专用适配器） |
| 机器之心 | `/rss`、`/rss/articles` | [实测] 前者返回 HTML，后者 404；文章列表无精确时间 | — | 无可用入口 |
| 36氪 / 品玩 / 虎嗅 | `/feed`、`/feed/all`、`/rss/0.xml` | [实测] 非 XML / 404 / 超时 | — | 无可用入口 |
| 智东西 `/feed` | `https://zhidx.com/feed` | [实测] HTTP 500 | — | 有效入口是 `/rss` |

### 厂商官方通道调查（下一步，未采集）

- [实测] DeepSeek 更新日志 `https://api-docs.deepseek.com/zh-cn/updates`：`h2 时间: YYYY-MM-DD` 与 `h3 中文标题` 成对出现；部分条目有独立页（如 `/zh-cn/news/news260910`），部分没有。只有日期无时刻，且无独立页条目的片段锚点会被 URL 规范化剥离，不适合直接作为采集源；适合作为 `news-originals.json` 的一手证据页。
- [实测] 智谱 `https://docs.bigmodel.cn/cn/update/new-releases` 含 50 个 ISO 日期与模型说明、文档链接；无 RSS；`/cn/update/promotion` 无日期。
- [实测] 阿里云百炼 `https://help.aliyun.com/zh/model-studio/newly-released-models` 表格含「时间 / 模型 ID / 功能说明」，但页面 1.1MB、多地域重复表，需专用适配器。
- [实测] MiniMax `https://www.minimaxi.com/news`、火山方舟 `https://www.volcengine.com/docs/82379/1159305` 服务端 HTML 无日期内容（JS 渲染），当前不可采集。
- [实测] Kimi：`platform.moonshot.cn/blog/posts/changelog` 中文但最后可见更新为 2025-11；`platform.kimi.ai/docs/platform-changelog.md` 为英文。暂不接入。

### 遗留事项

- [未定] InfoQ `robots.txt` 含 `Disallow: /feed/`（带尾斜杠），`/feed` 不落在该前缀内，技术可用但来源意图存疑；已向用户披露，是否保留待用户确认。
- [未定] 厂商官方通道若要直接采集，需先确定两件事：只有日期（无时刻）的 `publishedAt` 精度处理、条目唯一 URL（片段锚点被规范化剥离）——属契约边缘，需用户拍板。
- [待办] `news-originals.json` 仍为空：当前所有条目 `originalUrl=null`、标题回退中文报道；可优先为 DeepSeek/智谱/百炼 的高频事件补人工映射。

## 2026-09-19 资讯转官方一手（news v2）准入与验证

### 本轮改动

- 来源整体切换为厂商官方一手：DeepSeek 官网新闻（保留 `deepseek-news` 适配器）＋ OpenAI、Google AI、DeepMind、GitHub changelog、GitHub Copilot label、NVIDIA 官方 RSS；2026-09-17 轮的中文媒体源全部退役（`enabled:false` 保留）。
- `sources.py`：主题词表删 4 词（原 49→45 项）；官方/媒体排除规则分化；新增 `upcoming` 预告判定；`parse_feed` 支持 Atom、按源语言校验标题、提取来源简介；新增 `translate_news`（DeepSeek `deepseek-flash` 分块机译，缓存 `state/news-zh-cache.json`）；`collect_news` 改为累积入库＋北京日配额。
- `contract.py`：`NEWS` 新增 `originalTitle`/`translatedAt`/`addedAt`，`lang` 改为 zh/en 源文语言，`eventType` 新增 `upcoming`；排序改 `publishedAt` 倒序；校验改为每日新增≤6、每源≤2/天、每类≤2/天、72h 入库窗口。
- 契约、架构、data-review 与前端二期备注同步更新，审批稿见 `doc-data/cyber-granary-change-proposal-news-first-party.md`。

### 准入实测（与管道同款 UA、每域 1 请求、超时 15s）

| 源 | 入口 | 实测结果 | 结论 |
| --- | --- | --- | --- |
| OpenAI | `https://openai.com/news/rss.xml` | 200 RSS 2.0、1210 条、GMT 时间；`/blog/rss.xml` 301 到该地址 | 启用 |
| Google AI | `https://blog.google/innovation-and-ai/technology/ai/rss/` | 200 RSS、20 条、+0000；旧的 `/technology/ai/rss/` 301 到该地址 | 启用 |
| Google DeepMind | `https://deepmind.google/blog/rss.xml` | 200 RSS、100 条、+0000；窗口内常为 0 条 | 启用 |
| GitHub changelog | `https://github.blog/changelog/feed/` | 200 RSS、10 条、+0000 | 启用 |
| GitHub Copilot label | `https://github.blog/changelog/label/copilot/feed/` | 200 RSS、10 条、+0000 | 启用（与 changelog 同域，条目按 URL 去重） |
| NVIDIA | `https://blogs.nvidia.com/feed/` | 200 RSS、18 条、+0000；多数为游戏/硬件，由主题词表过滤 | 启用 |
| DeepSeek | `https://www.deepseek.com/news/` | 已有适配器；索引 5 条 | 启用 |
| Anthropic | `https://www.anthropic.com/news` | 服务端含标题、`/news/{slug}` 链接与日期，需专用适配器 | 待接入 |
| developers.googleblog.com | `/en/feed/` | 404 | 不启用 |
| Meta / xAI / MiniMax / Qwen / 火山 / 腾讯 / 讯飞 / 阶跃 | — | 无服务端日期或 403/JS 壳 | 不启用 |
| Hugging Face | `https://huggingface.co/blog/feed.xml` | 200 RSS，但作者含第三方 | 不启用（2026-09-19 用户默认） |

[实测] robots：DeepSeek、ByteDance Seed、Anthropic、Hugging Face、GitHub、MiniMax 均 `Allow` 或无阻断条款；讯飞文档 403、`x.ai` 403 为 UA 层拦截，不是 robots 条款。

### 验证结果

[实测] `python test_pipeline.py` 全部通过（含新增预告、机译重试、每日配额、累积排序、字段成对校验用例）。

[实测] 本地连续两轮 `pipeline.py collect --modules news`：首轮入库 3 条（GitHub 2、GitHub Copilot 1；`action-required` 1、`major-update` 2，均为英文机译条目），第二轮无重复、仅刷新 `dataUpdatedAt`；`pipeline.py validate` 五文件契约 PASS。入库示例见 `public/data/news.json`。

[实测] 首轮曾暴露并修正三类误判：弃用公告改按 `action-required`（新增弃用/下线/停用/迁移词）；官方条目不再单凭「模型」泛词归 `model-release`（新增官方专用模型信号）；客户故事（借助/如何用/白皮书）排除。

### 遗留事项

- [待办] Anthropic `/news` 适配器（服务端数据已核实可解析）。
- [待办] 中文媒体源正式废弃或长期保留禁用配置，待观察一手源产量后决定；媒体回退路径代码仍保留。
- [未定] NVIDIA feed 与 GitHub changelog 的 AI 命中率需积累样本；当前靠主题词表＋每源/每天 2 条上限控制噪声。

### 2026-09-19 第二批：模型榜厂商补齐

模型榜在榜厂商（Anthropic、OpenAI、Meta、Alibaba、Z AI、SpaceXAI、Kimi、Google、DeepSeek、Sapiens AI）逐一复核；本轮新接入 5 源（Anthropic 的「待办」已完成）。

| 源 | 入口 | 机制 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| Anthropic | `https://www.anthropic.com/news` | 列表页 `<time>`＋标题节点；日期无时刻按北京日 00:00 | 10 条解析成功；72h 内 2 条（Accenture 合作、生命科学验证计划）题材未命中，正确不发布 | 启用（`anthropic-news`） |
| SpaceXAI | `https://x.ai/sitemap.xml` | sitemap `lastmod` 预筛＋文章页 h1/`datePublished` | sitemap 82 条 news；72h 内 1 条（Grok Voice Transcribe 2.0）通过分类，因当日 `major-update` 配额已满顺延次日 | 启用（`xai-sitemap`，`guard:false`） |
| 字节 Seed | `https://seed.bytedance.com/sitemap.xml` | sitemap `lastmod` 预筛＋文章页 h1/发布日期；`/blog/*` 会 301 到 `/zh/blog/*` | 2 条通过预筛但均为改版老文（发布 4 月/7 月），72h 窗口正确拦截 | 启用（`seed-blog`，`guard:false`） |
| MiniMax | `https://www.minimax.cn/blog` | 列表页 13 篇文章链接＋文章页中文 h1/JSON-LD `datePublished` | 全部为 7 月及更早文章，窗口内 0 条 | 启用（`minimax-blog`，`guard:false`） |
| Meta | `https://about.fb.com/news/tag/ai/feed/` | 官方 RSS | 10 条；72h 内 1 条（smartARM 义肢报道）题材/规则未命中 | 启用 |

[实测] **未接入与原因：** 智谱 `docs.bigmodel.cn/cn/update/new-releases` 条目只链到模型文档页、无独立公告 URL（仅证据页）；Qwen `qwen.ai/blog` 为 SPA，无 sitemap、`/api/*` 全部回落到前端壳；Kimi `kimi.com/blog` 的 Next.js 列表可解析（id/title/href/date），但更新稀疏且标题为英文专名（译文无中文会被机译校验拒绝）；Sapiens AI（Agnes，`agnes-ai.com` 纯 JS）、腾讯混元、百度、讯飞星火、阶跃星辰均无服务端可解析的官方更新入口。

[实测] **robots：** x.ai `Allow: /`（仅 Disallow `/tools/`）、about.fb.com 仅禁搜索页、`minimax.cn` `Allow: /`、seed.bytedance.com `Allow: /`、anthropic.com `Allow: /`。

[实测] 主题词表增补 `Seedream`、`Seedance`、`Seed3D`、豆包 4 词（现 49 项），避免 Seed 家族模型发布被题材闸门拦截；`python test_pipeline.py` 44 项全过；真实采集 `news: OK`、`pipeline.py validate` PASS。

### 2026-09-19 第三批：二手兜底（AIBase）与模型托管（Hugging Face）

| 源 | 入口 | 机制 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| AIBase（二手兜底） | `https://www.aibase.com/zh/news` | 列表 `/(?:zh/)?news/{id}`＋详情页 h1/内嵌 Next.js `addtime` | 20 条中 19 条可解析；`31168` 专题页缺内嵌数据 → 单条隔离进待复核（骤降保护兜底整体回归） | 重启（媒体规则，来源署 AIBase） |
| Hugging Face ×6 | `huggingface.co/api/models?author=…`（Qwen、zai-org、moonshotai、tencent、baidu、stepfun-ai） | 官方组织新建模型仓＝模型发布；标题模板「{厂商}发布 {模型名}」，`createdAt` 作 publishedAt | 六组织均 200、各 19–20 条；72h 内无新建仓 | 启用（`huggingface-models`） |

[实测] **YouTube 不接入（robots 阻断）：** `www.youtube.com/robots.txt` 明确 `Disallow: /feeds/videos.xml`；频道 RSS 路线违反来源条款。若坚持官方视频渠道，须改用 YouTube Data API（需 Google API Key，免费配额 10k 单位/日）——待用户决定。

[实测] **X/Twitter 不接入：** 官方 API 无免费层、按量计费（读 $0.005/条、查用户 $0.010，[官方] 报道汇总）；RSSHub 公开实例 404/403、Nitter 实例连接失败；Bluesky 公共 API 免费但厂商账号不存在或零发帖。ModelScope 公开接口探测 404，暂不可用。

[实测] 实采结果：AIBase 新增 2 条 GLM-5.3-FlashX 报道（model-release），当日北京日额度 5/6；`python test_pipeline.py` 46 项全过、`pipeline.py validate` PASS。

**相似排除（同日落地，已解除观察）：** 契约 §4.5 新增相似排除规则（同 `eventType` 下品牌标记/标题包含/二元组 Dice ≥0.9 → 视为同一事件，比对近 7 天入库与本轮已选，不同事件类型并存）。本地库存已按规则清理：GLM-5.3-FlashX 两篇合并为 1 条（保留更早发布的 `智谱GLM-5.3-FlashX上线：最高 200 tokens/s`）；复跑 `news: OK`、`pipeline.py validate` PASS、47 项测试全过。

### 2026-09-19 第四批：体裁补齐（量子位）与主题边界修复

| 源 | 入口 | 实测 | 结论 |
| --- | --- | --- | --- |
| 量子位（二手兜底） | `https://www.qbitai.com/feed` | 10 条、中文标题、带时区时间（当天 11:53 UTC 仍有更新） | 重启（媒体规则） |

[实测] **主题边界修复：** `topic_pattern` 后界由「禁止字母数字」改为「只禁止字母」，`Qwen3.8`/`GPT5` 类型号名现在命中主题闸门（此前 AIBase 与 Hugging Face 的 Qwen 条目会被整类丢弃）；`OpenAI`/`AIGC` 仍不会误命中 `AI`。修复后 AIBase 单源 model-release 候选由 3 条增至 4 条。

[实测] 复采 `news: OK`；今日北京日额度 5/6。量子位当日条目未命中事件规则（媒体标题多为行业/观点，不含发布/实测/深度关键词），属预期；47 项离线测试全过。

**并发改动提醒（非本轮资讯改动）：** 13:17 UTC 前后另一工具正在给 plans 增加 `rank`/`rankBasis`（`contract.py` 与 `public/data/models.json`），期间 `pipeline.py validate` 会因 plans 记录字段未同步而报 `plans: object fields mismatch`；待对方完成后复核，勿将资讯改动与此混提。

### 2026-09-19 第五批：微软

| 源 | 入口 | 实测 | 结论 |
| --- | --- | --- | --- |
| Microsoft AI | `https://blogs.microsoft.com/blog/tag/ai/feed/` | 10 条、2026-09-17 仍在更新、无重定向、带时区 | 启用（`rss`） |
| Microsoft Azure | `https://azure.microsoft.com/en-us/blog/feed/` | 10 条、2026-09-10 最新、无重定向、带时区 | 启用（`rss`） |

[实测] **不采用：** `blogs.microsoft.com/ai/feed/` 返回 410；Copilot tag feed 停更于 2025-09；`news.microsoft.com/feed/` 停更于 2025-05；`devblogs.microsoft.com/ai/feed/` 为空 feed；Tech Community Copilot RSS 返回 HTML。robots：blogs.microsoft.com 仅禁 `/wp-admin/`，azure.microsoft.com 仅禁搜索/API 路径。

[实测] 复采 `news: OK`、`pipeline.py validate` PASS；两源各记 10 条候选基线；窗口内条目未命中事件规则（战略/分析类），当日北京日额度 5/6。

[实测] **并发 plans 改动已收敛：** 17 条 plans 均含 `rank`/`rankBasis`，`validate` 恢复 PASS（上一条提醒解除）；资讯与 plans 两批改动仍建议分开提交。

### 2026-09-20 第六批：智谱 / 百度 / 腾讯官方通道补齐

目标：补齐此前「无服务端可解析入口」的国产厂商官方资讯。本轮新增 3 个官方源，其余经实测仍无可用通道。

| 源 | 入口 | 机制 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| 智谱官网 | `https://www.zhipuai.cn/zh/news` | RSC 载荷内嵌 `newsItems`（id / title_zh / createAt，UTC ISO）；无需逐篇请求 | 15 条，最新 2026-03-31；日期均带时区；无外链与缺失字段 | 启用（`zhipu-news`） |
| 百度文心 | `https://ernie.baidu.com/blog/zh/posts/index.xml` | Hugo posts 子节中文 RSS，16 条中文标题、GMT 时间、相对链接 | 父 feed `/blog/zh/index.xml` 混入静态页 `Publication`（无中文标题）→ 改用 posts 子节后 16/16 有效 | 启用（`rss`） |
| 腾讯云 TokenHub | `https://cloud.tencent.com/document/product/1823/130758` | 产品公告表：公告标题 + 发布日期 + 每行唯一 `/announce/detail/{id}` | 26 行；过滤三方模型托管公告（DeepSeek/GLM/Kimi/MiniMax/Qwen 等）后 12 行；最新 2026-09-08 | 启用（`tencent-announce`） |

[实测] **本轮实现：** `common.py` 新增强制 gzip 解压（`cloud.tencent.com` 在未请求压缩时返回 `Content-Encoding: gzip`，此前整页乱码；解压后同样受 8MB 上限约束）；`sources.py` 新增 `flight_payloads`（aibase 与智谱共用 RSC 解析）、`parse_zhipu_news`、`parse_tencent_announcements`，`parse_feed` 支持相对链接，`NEWS_TOPICS` 增补 `文心`/`ERNIE`/`星火`，`OFFICIAL_EXCLUDE_RE` 增补 `业绩`/`财报`/`年报`，`OFFICIAL_MODEL_RE` 增补 `文心[- ]?\d`（Seed 家族 49 → 52 项）。

[实测] **未接入与原因（本轮复核）：** Qwen `qwen.ai/blog`、`/research`、`/sitemap.xml` 均回落同一 94KB SPA 壳（搜索索引可见内容系爬虫渲染 JS），无服务端数据；Kimi `www.kimi.com/blog/` 卡片可解析但仅 6 条且标题为英文专名（译文无中文会被机译校验拒绝），模型发布已由 `hf-moonshot` 覆盖；讯飞 `www.xfyun.cn/news` 404、`www.iflytek.com` 新闻页为 JS 壳、`xinghuo.xfyun.cn` 无日期，官方一手中断；智谱 `docs.bigmodel.cn/cn/update/new-releases` 虽更新至 2026-09-18，但条目只链模型文档页、无独立公告 URL，仅作证据页。

[实测] **URL 唯一性阻断（需用户拍板，沿用既有 [未定]）：** 阿里百炼 `help.aliyun.com/zh/model-studio/newly-released-models`（last-modified 2026-09-18、表格含类型/时间/模型 ID/说明）与腾讯 TokenHub 产品动态 `cloud.tencent.com/document/product/1823/130675`（含 Hy4 preview 2026-08-28、Hy3 2026-07-06 等腾讯自有模型发布记录）均为表格页，行内无唯一文章 URL（只链通用「模型列表」文档）；百度千帆模型更新记录各行虽链 API 文档，但为模型级而非事件级。三者要接入需先确定「表格行唯一 URL」的处理方式（契约 §4.5 归一化会剥离片段锚点），属契约边缘，待用户确认后再实现。

[实测] 复采结果：`python test_pipeline.py` 51 项全过（新增智谱 RSC 分块、腾讯公告三方过滤与去重、相对链接、gzip 解压 4 组用例）；`pipeline.py collect --modules news` 成功，三个新源基线 `ernie 16 / zhipu-news 15 / tencent-announce 12`，`pipeline.py validate` PASS。窗口内三源均无新条目（最新为腾讯 2026-09-08），属预期；首轮百度父 feed 静态页复核项已随换源自动退场。

[实测] **robots：** `www.zhipuai.cn` `Allow: /`、`ernie.baidu.com` 无阻断条款、`cloud.tencent.com` 仅禁查询参数页与 `/login`，三个新源均合规。

[推断] **并发提交提醒：** 本轮改动工作期间，另一工具于 2026-09-20 08:20 前后将工作区快照提交为 `2dccc05`/`cdf4258`/`77718f6`（含本批 `sources.py`/`common.py`/`sources.json` 的中间态）；本文件、`test_pipeline.py` 新增用例与 `ernie` 换源为提交后改动，尚在工作区，提交时请勿混入其它工具的在途改动。

### 2026-09-20 第七批：表格源唯一 URL 机制与 Qwen / 腾讯 Hy / 千帆 / Kimi 接入

用户拍板：接受表格行唯一 URL 方案（由实现方确定机制）；接受 Kimi 厂商模板标题。讯飞、Mistral、Amazon、Apple 不做官方通道，由二手源（AIBase / 量子位）覆盖。第六批遗留的「URL 唯一性阻断」由本轮机制解除。

**机制（不改契约字段与语义）：** 对无独立公告 URL 的表格行，`sourceUrl` 采用「表格页 + 身份查询参数」`?date=YYYY-MM-DD&model=<模型标识>`。契约 §4.5 的 `normalize_url` 保留非跟踪查询参数并排序，因此条目 id（规范化 URL 的 SHA-256）唯一且跨轮稳定；三个合成 URL 均实测 200、无重定向（阿里帮助中心 / 腾讯云文档 / 百度智能云文档），用户点击落到对应表格页。

| 源 | 入口 | 机制 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| 阿里云百炼 | `https://help.aliyun.com/zh/model-studio/newly-released-models` | 表格行（类型/时间/模型 ID/说明）无独立 URL；仅收 Qwen 系（`qwen*/qwq*/qvq*`） | 815 行中 Qwen 系 328 行；「别名 + 快照」同格取首 token；多地域重复表去重后 165 行，最新 2026-09-16 | 启用（`alibaba-bailian`） |
| 腾讯云 TokenHub 动态 | `https://cloud.tencent.com/document/product/1823/130675` | 动态表（名称/描述/时间/文档）无独立 URL；只留腾讯自有模型 | 7 行 Hy/YT（Hy4 preview 2026-08-28、Hy3 2026-07-06 等）；三方托管行剔除 | 启用（`tencent-tokenhub`） |
| 百度千帆 | `https://cloud.baidu.com/doc/qianfan/s/Kmh4stnjp` | 月份章节 + 表格行，年份取自章节标题；只留百度自有行 | 165 行百度行（最新 9 月 15 日）；DeepSeek/GLM 等三方行剔除 | 启用（`baidu-qianfan`） |
| 月之暗面 | `https://www.kimi.com/blog/` | 服务端渲染卡片（链接/标题/日期）；标题用厂商模板 | 9 张卡片（K3 2026-07-16 起）；hero 与列表重复卡按 URL 去重 | 启用（`kimi-blog`） |

[实测] **实现：** `sources.py` 新增 `row_url`（合成身份）、`clip`（摘要 ≤80 码点、优先句读边界）、`parse_bailian`、`parse_tokenhub_dynamics`、`parse_qianfan`、`parse_kimi_blog`，`collect_news` 适配器白名单扩容；`editorial/sources.json` 新增 4 源；`test_pipeline.py` 新增 5 组用例（多 token 模型单元、Hy 名单过滤、章节年份推断、Kimi 模板标题、摘要裁剪）共 56 项。

[实测] **Kimi 模板标题与去重：** 卡片标题为英文专名，标题取「月之暗面发布 {卡片名}」；`PerceptionBench`/`WorldVQA` 等非模型卡片由主题闸门自然排除；与 `hf-moonshot` 的同事件去重由既有相似排除兜底（标题归一化后互相包含）。

[实测] **Qwen 官方博客已废弃：** `qwenlm.github.io/blog` 最新条目 2025-09-23，停更近一年；qwen.ai 仍为 SPA——百炼表格是 Qwen 唯一活跃官方通道。

[实测] 复采 `news: OK`：`alibaba-bailian 165 / tencent-tokenhub 7 / baidu-qianfan 165 / kimi-blog 9`，无错误；`pipeline.py validate` PASS。窗口内四源均无新条目（最新为百炼 2026-09-16），未发生补录。

