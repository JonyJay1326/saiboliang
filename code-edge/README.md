# code-edge · 驿传收单端点

Cloudflare Worker，只接管 `saiboliang.top/api/*`。Phase 1 不落库，把 `/api/tip` 报料推到 ServerChan。

施工单：`doc-data/cyber-granary-impl-spec-tip-submission.md` §2 / §3 / §8。

## 本地预览

```bash
cp .dev.vars.example .dev.vars
# 填入 TURNSTILE_SECRET、SERVERCHAN_KEY
npx wrangler dev
```

零 npm 依赖；`wrangler` 仅作 CLI，不必装进本目录。

## 部署（用户手动，§8）

1. **建 Turnstile widget**：CF 控制台 → Turnstile → 点 **`Add widget manually`**（不要点 `Set up with Spin`——那是让 CF 的 AI agent 去改后端自动接入 siteverify；本仓库的 siteverify 已在 `src/worker.js` 里自己实现，零依赖，不需要也不允许它介入）。表单三项：Widget name 随意（如 `saiboliang-tip`）／Hostname `saiboliang.top`（**裸域**，与 `code-frontend/astro.config.mjs` 的 `site` 一致，不带 `www`）／Widget Mode **Managed**。创建后记下两个值：**Site Key**（公开，批 3 写进 `/tip` 页面的前端常量）、**Secret Key**（**只在创建时显示一次**，立刻存好）。
2. **设两个 Secret**（**必须在 deploy 之前**，否则 Route 会先上线，出现「已接单但没 Secret」的 502 窗口）：
   ```bash
   npx wrangler login                            # 或配 CLOUDFLARE_API_TOKEN
   npx wrangler secret put TURNSTILE_SECRET      # 粘贴第 1 步拿到的 Secret Key
   npx wrangler secret put SERVERCHAN_KEY        # 粘贴 ServerChan 的 SendKey（sct.ftqq.com →「SendKey」页）
   ```
   命令是**交互式提示粘贴**（不回显），值不能写在命令行里；此时 Worker 还不存在，wrangler 会问「是否创建」→ 选是。
   **`SERVERCHAN_KEY` 只填 `SCT…` 本体**，不带 `.send`、不带 `https://`——代码里拼的是 `https://sctapi.ftqq.com/${key}.send`。
   两个值**只在设置时输入一次、之后无法读回**（只能删除重建），自己留备份。
3. **部署 Worker**：本目录下 `npx wrangler deploy`（或 CF 控制台直接粘 `src/worker.js`）。**Worker 与 Route 在这一步同时生效**（`routes` 写在 `wrangler.toml` 里）。
4. **Route（第 3 步已生效）**：需核对时走控制台 → Worker → Settings → Triggers → Routes；`wrangler.toml` 里的写法是
   `routes = [{ pattern = "saiboliang.top/api/*", zone_name = "saiboliang.top" }]`。
5. **验证**：见施工单 §9 前 4 条（连通性）。
6. **回滚**：删 Route 即完全还原；本目录留着不影响站点。

> 发布前检查：本目录内无真实 Secret、无字体、无证书；`.dev.vars` 未被 git 跟踪。

## 四道闸（顺序不可换）

1. Origin 白名单（**弱闸**，不是安全边界）
2. 蜜罐 `website`（命中 → `200 {"ok":true}`，不推送）
3. Turnstile 服务端校验（超时 = 未通过）
4. 字段校验 + 控制字符归一化

## 不做的事

- 不加 KV / D1 / 任何存储
- 不建 Cloudflare Pages
- 不引入 npm 依赖
- 本仓库不提交真实密钥
