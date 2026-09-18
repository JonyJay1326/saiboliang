# 厂商图标（vendored）

模型/厂商品牌 SVG 图标，供前端本地引用。**运行时不要拉 CDN**，直接用本目录文件。

## 来源与许可

| 项 | 值 |
|---|---|
| 来源 | [Lobe Icons](https://github.com/lobehub/lobe-icons) · 图标墙 https://icons.lobehub.com |
| 包 | `@lobehub/icons-static-svg` |
| 许可 | **MIT**（覆盖 Lobe 仓库的分发） |
| 抓取日期 | 2026-09-17 |
| CDN 原始地址 | `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/{slug}.svg` |
| 国内镜像 | `https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/{slug}.svg` |

## 命名

**统一为 `{slug}.svg`（57 个文件）**，不再区分 `.color` 后缀——文件名就是 slug，直接可拼。

- 有彩色版的取彩色版（48 个）；Lobe 没有彩色版的取单色版（9 个）。
- 单色版厂商：`OpenAI`、`xAI`、`Grok`、`Anthropic`、`IBM`、`Liquid AI`、`Xiaomi(MiMo)`、`Nous Research`、`AI21 Labs`、`Inception`、`KwaiKAT`。

`vendor-map.json` 是**取图字典**：
- `byVendor`：59 个 AA 厂商名 → 图标 slug（36 家有图标，23 家为 null）
- `planVendors`：22 个套餐厂商/工具 → 图标 slug
- `vendorDisplayName`：需要改写的显示名（`SpaceXAI`→xAI 等）

## 能不能「直接用字段取图」？不能，必须查表

AA 的 `vendor` 不能直接 slug 化。实测反例：

| AA `vendor` | 直接小写 | 实际图标 slug |
|---|---|---|
| `Z AI` | `z ai` ✗ | `zai`（alt `zhipu` / `chatglm`） |
| `SpaceXAI` | `spacexai` ✗ | `xai`（alt `grok`） |
| `ByteDance Seed` | `bytedanceseed` ✗ | `doubao`（alt `bytedance`） |
| `Allen Institute for AI` | `alleninstituteforai` ✗ | `ai2` |
| `TII UAE` | `tiiuae` ✗ | `tii` |
| `OpenAI` / `Anthropic` / `Meta` / `Google` / `DeepSeek` / `Kimi` | ✓ 可小写直接命中 | 同名（`Google` 另可换 `gemini`） |

**所以前端必须读 `vendor-map.json`，不能靠字符串变换。** 映射表覆盖全部 59 个 AA 厂商，新增厂商时同步补表 + 补图标，不得引用未落盘的 slug。


## 使用规则

1. **图标是厂商级，不是模型级**：Lobe 没有模型级 logo（实测 `gpt-6-astra.svg` / `claude-fable-5-1.svg` 均 404）。模型行按 `vendor` 查图标。
2. 一个厂商可能有多个品牌位（如 `anthropic` 公司标 / `claude` 产品标；`alibaba` / `qwen`）。主选已定在 `vendor-map.json` 的 `icon`，可选项在 `alt`。
3. AA 厂商名的显示名改写见 `vendor-map.json` 的 `vendorDisplayName`（属前端派生，不改契约）。
4. **商标声明**：MIT 只覆盖 Lobe 仓库的分发，**不覆盖商标权**。logo 归各厂商所有，此处仅用于指代对应模型/厂商。站点需在"关于"页声明品牌与商标归属。
5. 新增厂商时：补下图标 + 更新 `vendor-map.json`，不要引用未落盘的 slug。

## 覆盖（57 个文件）

| 分组 | 数量 | 示例 |
|---|---|---|
| AA 厂商（`byVendor`） | 36 家有图标 / 共 59 家 | OpenAI、Anthropic、Google/Gemini、Meta、Qwen/Alibaba、Z.ai/Zhipu、xAI/Grok、Kimi/Moonshot、DeepSeek、Mistral、NVIDIA、Microsoft、Cohere、Perplexity、Snowflake、TII、KwaiKAT |
| 套餐/工具（`planVendors`） | 22 个 | GitHub、GitHub Copilot、OpenCode、Trae、Cline、Cursor、OpenClaw、火山引擎方舟、阿里云百炼、讯飞星火、商汤日日新、智谱 |

**Lobe 暂无图标（23 家 AA 厂商）**：AI9Stars、Apodex、Celeris、China Mobile、Databricks、InclusionAI、Institute of Foundation Models、Korea Telecom、Motif Technologies、Multiverse Computing、Nanbeige、Naver、Nex AGI、OpenBMB、Prime Intellect、Reka AI、SK Telecom、Sapiens AI、Sarvam、ServiceNow、Swiss AI Initiative、Thinking Machines、Trillion Labs。遇到时按规则 5 处理。
