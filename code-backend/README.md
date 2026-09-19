# 赛博粮票数据管道

Python 3.11+，仅标准库。采集器只产 JSON，不启动服务、不提交 Git、不部署。公开字段遵循 `doc-data/cyber-granary-data-contract.md`；五维评分继续延期。

## 运行

从项目根目录执行：

```powershell
python -m unittest discover -s code-backend -v
python code-backend/pipeline.py collect
python code-backend/pipeline.py validate
```

已有本机根目录 `.env` 时按需读取其中 `AA_key` / `AA_API_KEY`（AA 请求头）与 `DEEPSEEK_API_KEY`（GitHub 简介翻译），只取白名单键名，不加载整份文件，不打印 Key；环境变量优先。CI 中使用同名 Actions Secret。禁止将 `.env` 复制到前端。

```powershell
# 独立采集指定模块；日任务成功后当天跳过，配置变化会重采。
python code-backend/pipeline.py collect --modules models github news
# 明确需要重新采集日任务时使用，注意 AA 免费接口请求配额。
python code-backend/pipeline.py collect --modules models --force
# 只在尚无数据且需要空站骨架时初始化，不生成示例业务记录。
python code-backend/pipeline.py init
```

退出码：`0` 成功或内容未变；`2` 部分模块失败、其他模块已更新；`1` 没有可发布更新或校验/构建失败。失败原因同时输出到终端和 `state/run.json`。`tickets` 为人工维护模块，不请求网络，也不参与当日跳过。

## 输出与一致性

- `public/data/`：五文件完整批次，供前端**构建时复制**。不是运行中的静态文件服务目录。
- `.cache/candidate/`：验证通过的候选批次。该目录在 `.gitignore` 中。
- `state/source-cache.json`：未应用人工覆盖的来源结果；保留旧事实和原始核验时间。
- `state/github-zh-cache.json`：GitHub 简介机器译文草稿（`repo -> {text, source, at}`，按 repo 缓存，人工简介优先）；不进入公开数据，缺 key 或翻译失败时不写入。
- `state/source-health.json`、`state/run.json`：逐源有效候选数量、成功日期、运行异常。
- `state/review-queue.json`：按对象、原因和证据去重的待确认项。可将 `status` 改成 `accepted` 或 `rejected`；不删除原项，同一问题不会重复排入，新内容仍生成新项。
- `state/audit.jsonl`：人工覆盖决定的追加审计。

采集失败保留整个业务文件；周榜或月榜失败都保留整个 GitHub 模块。AA 必须取得完整同版本分页。合法筛选空结果允许发布；来源有效候选数量低于前次 60% 时保留旧模块。`tickets` 为人工文件，校验失败时保留旧整表并报错，不参与骤降保护。

先写候选、校验全部字段与引用，再替换本地数据目录。替换失败恢复原目录；中断后若存在 `.previous`、`.next` 或 `state/collect.lock`，脚本明确停止，核对没有运行中的进程再人工恢复，禁止盲目删除。候选目录与输出目录必须分离，输出目录不能包含其他文件。

前端就绪后可使用构建门禁；命令会收到绝对路径环境变量 `DATA_CANDIDATE_DIR`。构建必须读取该候选目录，构建失败不会推进公开数据或每日成功状态：

```powershell
python code-backend/pipeline.py collect --build-cwd code-frontend --build-command npm run build
```

这条命令是接口用法，当前前端尚未实现。实际 Actions 同工作流的提交、部署、部署重试和浏览器批次切换仍待前端完成后接入；没有通过网页端或部署端验收。

## 已接入与证据边界

| 来源 | 实现 |
|---|---|
| AA 免费接口 | [实测] 完整分页、指数版本一致性、综合/编程两榜；**自带每百万 Token 价格**（输入+输出全量覆盖 436/652，两榜去重后 top25 为 25/25）；来源署名为 Artificial Analysis |
| ~~OpenRouter~~ | [已下线] 一期不再采集：价格改用 AA 自带定价，`contextLength` 不需要，`editorial/model-mappings.json` 已删除 |
| GitHub Trending | [实测] 官方周/月 HTML，保留原始位置，规则筛选 AI 应用与工具；不明确的项目进待确认清单 |
| 量子位、Solidot、IT之家 RSS | [实测] 中文标题与发布时间、72 小时窗口、事件规则与每源两条限制；不复制全文或生成摘要 |
| InfoQ、智东西 RSS | [实测] 2026-09-18：`infoq.cn/feed` 与 `zhidx.com/rss`，中文标题与带时区时间；InfoQ robots 含 `Disallow: /feed/`（`/feed` 前缀不受限），保留与否待用户确认，详见 `news-source-check.md` |
| AIBase 中文资讯 | [实测] 已启用列表＋详情页适配器；按文章 ID/h1 核对页面数据，读取带时区 addtime，不使用更新时间或相对时间；解析失败保留旧资讯模块 |
| GitHub Copilot 官方文档 | [实测] 个人月付常规价与 AI Credits 表解析，保持原单位；价格/额度正常数值变化自动更新 |
| 智谱 Coding Plan 官方文档 | [实测] 国内套餐与双周期积分额度；文档无当前月付价，因此价格为 null |
| InfoQ | [已接入] 2026-09-18：`/feed` 返回 20 条带 GMT 时间的中文条目；robots 尾斜杠条款见 `news-source-check.md` |
| 免费活动（tickets） | [人工] 不走采集：管道读取 `editorial/tickets.json` 人工文件，只做契约校验与版本戳；不请求网络 |

套餐适配器对已核对内容范围保留语义指纹，只允许已识别价格/额度表内的数字变化。条款、单位、周期、支持工具或模板变化进入待确认并保留旧整条记录。这里的自动化边界有意保守，不能保证任意厂商页面改版后继续解析。

当前两榜模型已按展示名去重（只剥离纯推理档位括号，版本快照保留），`id` 取 AA `slug` 的 kebab-case 规范化值，报价取自 AA 自带 `pricing`。默认资讯标题回到中文报道；只有 `news-originals.json` 的映射核实通过才直达一手页。UI 必须显示契约规定的回退标记。

## 编辑入口

`editorial/sources.json` 保存已启用的来源与经核对的套餐适配器（只有 `news`、`plans` 两个键）。套餐使用 `verified-section` 或专用 adapter：需用户确认产品准入、准确公共 record、官方页面 scope、该范围规范化纯文本的 SHA-256 和明确字段证据。adapter 只覆盖已识别的价格/额度表，`tagline`/`highlights`/`quotaBasis` 等文案字段由人工在 record 里维护。内容变化不会自动沿用初始额度冒充新事实。

`editorial/tickets.json` 是**票证的唯一来源**，人工维护的扁平数组，字段见 `cyber-granary-data-contract.md` §4.2。管道只读取、按契约校验并打版本戳，不请求网络。`link` 默认禁止携带邀请码/推荐码等推广参数；本人推广链接按契约 §5.1 例外录入时必须把 `affiliate` 置 true（前端显示「含推广」），`utm_*` 等跟踪参数一律剥离。内容未变时不会刷新 `dataUpdatedAt`，也不会推版本。

`editorial/news-originals.json` 按规范化中文报道 URL 的 SHA-256 保存一手来源证据，值包含 `url`、`publisher`、`articleEvidence`、`originalEvidence`、`eventSpecific`。编辑前须核实发布者官方身份。运行时再次检查报道出处链接、两页事件文本和最终目标；失败回退报道，官方仓库根链接不用于事件合并。

`editorial/github-zh.json` 保存 GitHub 榜单项目的人工中文简介（`repo -> 简介`，键为 `owner/name`，值为单行、非空）：采集时命中条目用中文简介替换仓库原文。人工未覆盖的条目在配置 `DEEPSEEK_API_KEY` 时调用 DeepSeek（`deepseek-flash` = V4.1-Flash，非思考档 + JSON 输出）生成中文草稿：整榜一次批量请求，按 repo 缓存于 `state/github-zh-cache.json`，命中缓存的 repo 不再请求；译文只作待审校草稿，人工简介优先于缓存。缺 key、翻译失败或译文非中文时保留仓库原文并记入待确认队列，不阻塞发布。

`editorial/overrides.json`：

- `github`：仓库名对应 `allow` / `exclude`，只影响原榜内项目。
- `records`：整条人工纠正，包含 `module`（仅 `plans`）、`record`、`reason`、`evidenceUrl`、`at`。record 必须保留人工核验日期，`checkMethod` 为 manual；覆盖优先于自动采集，并写入审计。

不要手改 `public/data/`（`tickets.json` 也不例外，它的源在 `editorial/tickets.json`）。不支持在公共记录中增加临时字段，新增公共字段必须先确认契约变更。
