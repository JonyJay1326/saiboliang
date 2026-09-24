# 赛博粮票数据管道

Python 3.11+，仅标准库。采集器只产 JSON，不启动服务、不提交 Git、不部署。公开字段遵循 `doc-data/cyber-granary-data-contract.md`；五维评分继续延期。

## 运行

从项目根目录执行：

```powershell
python -m unittest discover -s code-backend -v
python code-backend/pipeline.py collect
python code-backend/pipeline.py validate
```

已有本机根目录 `.env` 时按需读取其中 `AA_key` / `AA_API_KEY`（AA 请求头）与 `DEEPSEEK_API_KEY`（GitHub 简介与资讯机译），只取白名单键名，不加载整份文件，不打印 Key；环境变量优先。CI 中使用同名 Actions Secret。禁止将 `.env` 复制到前端。

```powershell
# 独立采集指定模块；日任务成功后当天跳过，配置变化会重采。
python code-backend/pipeline.py collect --modules models github news
# 明确需要重新采集日任务时使用，注意 AA 免费接口请求配额。
python code-backend/pipeline.py collect --modules models --force
# 资讯一次性回补：入库窗口放宽到 7 天、回补条目 addedAt 取 publishedAt（各历史日仍守每日配额）；
# 只用于补录停摆空档，常规运行不加此参数。
python code-backend/pipeline.py collect --modules news --backfill-days 7
# 只在尚无数据且需要空站骨架时初始化，不生成示例业务记录。
python code-backend/pipeline.py init
```

退出码：`0` 成功或内容未变；`2` 部分模块失败、其他模块已更新；`1` 没有可发布更新或校验/构建失败。失败原因同时输出到终端和 `state/run.json`。`tickets` 为人工维护模块，不请求网络，也不参与当日跳过。

## 输出与一致性

- `public/data/`：五文件完整批次，供前端**构建时复制**。不是运行中的静态文件服务目录。
- `.cache/candidate/`：验证通过的候选批次。该目录在 `.gitignore` 中。
- `state/source-cache.json`：未应用人工覆盖的来源结果；保留旧事实和原始核验时间。
- `state/github-zh-cache.json`：GitHub 简介机器译文草稿（`repo -> {text, source, at}`，按 repo 缓存，人工简介优先）；不进入公开数据，缺 key 或翻译失败时不写入。
- `state/news-zh-cache.json`：资讯英文标题与简介机译缓存（条目 id -> `{title, summary, source, at}`）；不进入公开数据，中文条目不进缓存。
- `state/news-summary-cache.json`：资讯简介模型起草缓存（条目 id -> `{summary, source, at}`）；只在来源无简介时使用，成稿进公开数据、正文不落盘。
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
| 官方一手资讯 | [实测] 2026-09-21 启用 29 源：OpenAI、Google AI、DeepMind、GitHub changelog、GitHub Copilot、NVIDIA、Microsoft AI、Azure、Meta（RSS/Atom）；Anthropic、智谱官网（列表页/内嵌数据适配器）；SpaceXAI、字节 Seed、MiniMax（sitemap/列表＋文章页）；DeepSeek 官网；百度文心（Hugo RSS）；腾讯云 TokenHub 公告与产品动态、阿里云百炼、百度千帆（表格行＋身份参数）；月之暗面（官网博客）；阿里/智谱/月之暗面/腾讯/百度/阶跃星辰（Hugging Face 官方模型仓，模板标题「{厂商}发布 {模型名}」）。英文标题/简介经 DeepSeek 机译；来源无简介时由 DeepSeek 据来源页面片段起草（≤80 字、正文不落盘）；每天入库≤20（每来源≤5/天、每事件类型≤5/天）、永久累加、`publishedAt` 倒序；页面只展示当日精选（`featured`，每日≤8，DeepSeek 判定、失败回落固定事件优先级）；准入与验证见 `news-source-check.md` |
| AIBase / 量子位（二手兜底） | [实测] 2026-09-19 重启：中文二手源，补国产厂商动态与评测/上手/深度分析体裁；来源署对应媒体。2026-09-24 起一手核实按 `editorial/news-originals.json` 映射 + `editorial/vendor-domains.json` 白名单自动核验（口径与实测见 `news-source-check.md`）；核实成功才标「中文报道已核实」，否则保持「二手 · 一手未核实」。AIBase 个别专题页缺内嵌数据时单条隔离进待复核 |
| DeepSeek 官网新闻 | [实测] 厂商一手，`deepseek-news` 适配器；只给日期的条目取北京日 00:00 折算 UTC，不伪造时刻 |
| 中文媒体来源 | [已退役] AIBase、量子位、InfoQ、智东西、Solidot、IT之家保留 `enabled:false` 便于临时回退，不再默认采集 |
| GitHub Copilot 官方文档 | [实测] 个人月付常规价与 AI Credits 表解析，保持原单位；价格/额度正常数值变化自动更新 |
| 智谱 Coding Plan 官方文档 | [实测] 国内套餐与双周期积分额度；文档无当前月付价，因此价格为 null |
| 免费活动（tickets） | [人工] 不走采集：管道读取 `editorial/tickets.json` 人工文件，只做契约校验与版本戳；不请求网络 |

套餐适配器对已核对内容范围保留语义指纹，只允许已识别价格/额度表内的数字变化。条款、单位、周期、支持工具或模板变化进入待确认并保留旧整条记录。这里的自动化边界有意保守，不能保证任意厂商页面改版后继续解析。

当前两榜模型已按展示名去重（只剥离纯推理档位括号，版本快照保留），`id` 取 AA `slug` 的 kebab-case 规范化值，报价取自 AA 自带 `pricing`。资讯以厂商官方一手为主、AIBase 为二手兜底：官方条目 `sourceUrl`/`originalUrl`/`url` 三链相同、来源即发布方；英文条目经 DeepSeek 机译并保留 `originalTitle`/`translatedAt`；同一事件的多篇相似报道按「相似排除」（同 `eventType` 下品牌标记/标题包含/二元组 Dice≥0.9，比对近 7 天入库与本轮已选）只留排序在前的一条。

## 编辑入口

`editorial/sources.json` 保存已启用的来源与经核对的套餐适配器（`github`、`news`、`plans` 三个键）。资讯来源含 `official`、`lang`（zh/en）与 `enabled`；中文媒体源保留 `enabled:false` 以便临时回退。套餐使用 `verified-section` 或专用 adapter：需用户确认产品准入、准确公共 record、官方页面 scope、该范围规范化纯文本的 SHA-256 和明确字段证据。adapter 只覆盖已识别的价格/额度表，`tagline`/`highlights`/`quotaBasis` 等文案字段由人工在 record 里维护。内容变化不会自动沿用初始额度冒充新事实。套餐的 `rank` / `rankBasis`（本站编辑推荐序，同 `group` 内独立、成对出现）同样是人工字段，随 record 维护，采集与覆盖流程只读不改。

`editorial/tickets.json` 是**票证的唯一来源**，人工维护的扁平数组，字段见 `cyber-granary-data-contract.md` §4.2。管道只读取、按契约校验并打版本戳，不请求网络。`link` 默认禁止携带邀请码/推荐码等推广参数；本人推广链接按契约 §5.1 例外录入时必须把 `affiliate` 置 true（前端显示「含推广」），`utm_*` 等跟踪参数一律剥离。内容未变时不会刷新 `dataUpdatedAt`，也不会推版本。

`editorial/news-originals.json`（媒体条目的编辑核实映射，2026-09-24 起常态使用）按规范化中文报道 URL 的 SHA-256 保存一手来源证据，值包含 `url`、`publisher`、`articleEvidence`、`originalEvidence`、`eventSpecific`。编辑前须核实发布者官方身份。运行时核定口径为**两页证据**：报道页须含 `articleEvidence`、官方页须含 `originalEvidence`，`url` 必须是事件页（不得是首页）且 `eventSpecific` 为 true；不再要求报道页引用该链接（旧口径实测对 AIBase/量子位 57/57 不成立）。**官方页对管道 UA 403 时**（openai.com 等）第二证据源为该发布方自己的官方 feed：URL 须命中官方 feed 条目（尾斜杠容差）且条目标题含 `originalEvidence`（2026-09-24 用户拍板，`verify_original_via_feed`）。

`editorial/vendor-orgs.json`（2026-09-24 用户拍板：官方仓库 release 与模型权重页承认作一手证据）保存「域 -> {组织: 发布方}」映射，组织按 URL 路径首段、大小写不敏感匹配（如 `github.com/XiaomiMiMo/...`、`huggingface.co/Qwen/...`）。未在映射内的组织不参与核实。

`TAVILY_API_KEY`（`--env-file`，2026-09-24 用户拍板接入）启用搜索候选路径：映射与正文自引都失败时，按条目标题调用一次 Tavily 搜索（免档 1,000 次/月），结果 URL 须命中上面的白名单/组织映射并通过事件证据校验才写 `originalUrl`；结果按查询缓存于 `state/news-search-cache.json`，缺 key 时整条路径关闭（行为与接入前一致）。

`editorial/vendor-domains.json` 是自动核实的一手域名白名单（`domain -> 发布方名称`，更具体的域排在父域之前，**值为 `null` 表示显式排除**，如腾讯云开发者社区这类 UGC 子域）。管道对媒体条目按三条路径自动核实：映射优先；其次读取报道页自身引用的链接（锚点或「官网/原文/来源/出处/官方」标注文本）；最后（有 key 时）搜索候选。三者都要求域名/组织在白名单内、非推广参数、非首页，且目标页含条目标题的事件签名（`Grok 4.7`、`WeatherNext 3` 式的字母数字 token）；正文自引与搜索候选还须通过**最小 robots 门禁**（只看 `User-agent: *` 组的 `Disallow: /`）。失败即保持未核实，不进复核队列。已入库条目可用 `python pipeline.py reverify --limit N` 一次性回填：官方直采条目（`originalUrl == sourceUrl`）不重查；无映射的自动核实条目每轮重查、证据不再成立即撤销；映射条目归编辑所有（仅在映射 URL 变更时重查），有变更才推版本。

事件分类（`eventType`）**2026-09-24 用户拍板拆分**：原 `action-required`（界面文案「需行动」读者看不懂）一分为二——`security-risk`「安全风险」与 `service-retirement`「停服·迁移」；裸「泄露」不再算风险提示（模型内测泄露属传闻、不发布），「停用 / 弃用 / 迁移」必须伴随服务或产品信号。存量条目可用 `python pipeline.py reclassify` 一次性回填：只重判 `eventType` 已不在枚举内的条目，判不出类型的移出批次（**不刷新 `dataUpdatedAt`**，没有发生采集），有变更才推版本；口径见 `cyber-granary-data-contract.md` §4.5。

`editorial/github-zh.json` 保存 GitHub 榜单项目的人工中文简介（`repo -> 简介`，键为 `owner/name`，值为单行、非空）：采集时命中条目用中文简介替换仓库原文。人工未覆盖的条目在配置 `DEEPSEEK_API_KEY` 时调用 DeepSeek（`deepseek-flash` = V4.1-Flash，非思考档 + JSON 输出）生成中文草稿：整榜一次批量请求，按 repo 缓存于 `state/github-zh-cache.json`，命中缓存的 repo 不再请求；译文只作待审校草稿，人工简介优先于缓存。缺 key、翻译失败或译文非中文时保留仓库原文并记入待确认队列，不阻塞发布。

`editorial/overrides.json`：

- `github`：仓库名对应 `allow` / `exclude`，只影响原榜内项目。
- `news`：`featuredExclude` 是规范化 `sourceUrl` 列表（`utm_*` 等跟踪参数由管道剥离后比对）。命中条目即使被 DeepSeek 或回落规则选中也不进「当日精选」，条目仍永久累加；编辑排除优先，跨轮次稳定生效。
- `records`：整条人工纠正，包含 `module`（仅 `plans`）、`record`、`reason`、`evidenceUrl`、`at`。record 必须保留人工核验日期，`checkMethod` 为 manual；覆盖优先于自动采集，并写入审计。**`tiers[].conditions` 可空且只写一句**：取官方口径第一句（来源 / 核验声明，如「价格与额度取自…（…人工核验）」，或该档最关键的实质限制），不追加后续分句、不写税费与结算兜底句；没有可写内容填 `null`（`doc-data/cyber-granary-data-contract.md` §4.3）。

不要手改 `public/data/`（`tickets.json` 也不例外，它的源在 `editorial/tickets.json`）。不支持在公共记录中增加临时字段，新增公共字段必须先确认契约变更。
