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

