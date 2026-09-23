/**
 * 赛博粮站 · 驿传收单端点（Cloudflare Worker）
 * 契约：cyber-granary-impl-spec-tip-submission.md §3
 * Phase 1：不落库，仅转发 ServerChan；零依赖原生 ESM。
 */

const ALLOWED_ORIGIN = "https://saiboliang.top";
const MAX_BODY_CHARS = 100_000;

/** 类型枚举 → 推送标题用中文 */
const TYPE_LABEL = {
  new: "报新粮",
  rotten: "报作废",
  feedback: "报差错",
};

/** 零宽字符：U+200B–U+200D、U+FEFF */
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * 返回 JSON 响应；error 为 null 时写 { ok: true }
 * @param {number} status
 * @param {string | null} error
 * @param {{ ok: boolean } | null} [extra]
 */
function json(status, error, extra = null) {
  const body = extra ?? (error == null ? { ok: true } : { ok: false, error });
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Origin / Referer 弱闸：只拦浏览器侧非本站页面，不是安全边界。
 * 脚本可任意伪造 Origin；真正防滥用靠 Turnstile（第 3 闸）。
 * @param {Request} req
 */
function originOk(req) {
  const origin = req.headers.get("Origin");
  if (origin) {
    return origin === ALLOWED_ORIGIN;
  }
  const referer = req.headers.get("Referer");
  if (!referer) return false;
  try {
    const u = new URL(referer);
    return u.origin === ALLOWED_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * 控制字符归一化：去零宽、\r\n→\n、两端 trim
 * @param {unknown} value
 */
function normalizeText(value) {
  if (value == null) return "";
  return String(value)
    .replace(ZERO_WIDTH_RE, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/**
 * 读 JSON body；超长或非法 → 抛错由调用方转 400
 * @param {Request} req
 */
async function readJson(req) {
  const text = await req.text();
  if (!text || text.length > MAX_BODY_CHARS) {
    throw new Error("bad-json");
  }
  try {
    const data = JSON.parse(text);
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("bad-json");
    }
    return data;
  } catch {
    throw new Error("bad-json");
  }
}

/**
 * 蜜罐：website 非空即命中（不 trim，空白也算填过）
 * @param {unknown} website
 */
function honeypotHit(website) {
  if (website == null) return false;
  return String(website).length > 0;
}

/**
 * Turnstile 服务端校验；超时 / 网络错 / success≠true 一律未通过（宁可拦，不放过）
 * @param {unknown} token
 * @param {{ TURNSTILE_SECRET: string }} env
 * @returns {true | false | "missing-secret"} missing-secret → 调用方应 502
 */
async function turnstileOk(token, env) {
  if (typeof token !== "string" || !token) return false;
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    console.log("[tip] TURNSTILE_SECRET missing");
    return "missing-secret";
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.success === true;
  } catch {
    // 超时或网络失败 → 视为未通过（§3.7）
    return false;
  }
}

/**
 * 字段校验（第 4 闸）；文案字面照 §3.6，不得改写
 * @param {Record<string, unknown>} body
 * @returns {{ error: string } | { type: string, title: string, url: string, detail: string, contact: string, ticket: string }}
 */
function normalizeAndValidate(body) {
  const type = typeof body.type === "string" ? body.type : "";
  if (!Object.prototype.hasOwnProperty.call(TYPE_LABEL, type)) {
    return { error: "请求格式不正确" };
  }

  const title = normalizeText(body.title);
  if (title.length < 2) return { error: "标题至少写两个字" };
  if (title.length > 120) return { error: "标题太长了，最多 120 个字" };

  const url = normalizeText(body.url);
  if (url) {
    if (!/^https?:\/\//i.test(url)) return { error: "链接要以 http(s):// 开头" };
    if (url.length > 500) return { error: "链接太长了，最多 500 个字" };
  }

  const detail = normalizeText(body.detail);
  if (detail.length < 5) return { error: "详情再写几句吧（至少 5 个字）" };
  if (detail.length > 4000) return { error: "详情太长了，最多 4000 个字" };

  const contact = normalizeText(body.contact);
  if (contact.length > 200) return { error: "请求格式不正确" };

  const ticket = normalizeText(body.ticket);
  if (ticket && !/^[a-z0-9-]{1,64}$/.test(ticket)) {
    return { error: "请求格式不正确" };
  }

  return { type, title, url, detail, contact, ticket };
}

/**
 * 把访客输入包进代码块，防止在站长微信里构造 markdown 链接
 * @param {string} text
 */
function fence(text) {
  const safe = String(text).replace(/```/g, "'''");
  return "```\n" + safe + "\n```";
}

/**
 * 组装 ServerChan title（≤32 字）与 desp
 * @param {{ type: string, title: string, url: string, detail: string, contact: string, ticket: string }} fields
 */
function buildPushPayload(fields) {
  const label = TYPE_LABEL[fields.type];
  const titleHead = `驿传·${label}·${fields.title.slice(0, 20)}`;
  const title = titleHead.length > 32 ? titleHead.slice(0, 32) : titleHead;

  const now = new Date();
  const utc = now.toISOString();
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+08:00");

  const lines = [
    `**类型** ${label}（\`${fields.type}\`）`,
    "",
    "**标题**",
    fence(fields.title),
    "",
    "**相关链接**",
    fields.url ? fence(fields.url) : "_（未填）_",
    "",
    "**关联票证**",
    fields.ticket ? `\`${fields.ticket}\`` : "_（无）_",
    "",
    "**详情**",
    fence(fields.detail),
    "",
    "**联系方式**（仅站长可见）",
    fields.contact ? fence(fields.contact) : "_（未填）_",
    "",
    `**服务器收到时间** UTC \`${utc}\` ／ 北京 \`${beijing}\``,
  ];

  return { title, desp: lines.join("\n") };
}

/**
 * 单次推送 ServerChan
 * @param {{ SERVERCHAN_KEY: string }} env
 * @param {{ title: string, desp: string }} payload
 */
async function pushOnce(env, payload) {
  const key = env.SERVERCHAN_KEY;
  if (!key) return { ok: false, status: 0 };

  const form = new URLSearchParams();
  form.set("title", payload.title);
  form.set("desp", payload.desp);

  const res = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  return { ok: res.ok, status: res.status };
}

/**
 * 推送最多 3 次，退避约 300ms / 900ms；每次 console.log 状态码（§3.8 防静默丢单）
 * @param {{ SERVERCHAN_KEY: string }} env
 * @param {{ type: string, title: string, url: string, detail: string, contact: string, ticket: string }} fields
 */
async function pushWithRetry(env, fields) {
  const payload = buildPushPayload(fields);
  const delays = [0, 300, 900];

  for (let i = 0; i < 3; i++) {
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    try {
      const result = await pushOnce(env, payload);
      console.log(`[tip] ServerChan attempt ${i + 1}/3 status=${result.status}`);
      if (result.ok) return true;
    } catch (err) {
      console.log(
        `[tip] ServerChan attempt ${i + 1}/3 status=0 error=${err && err.message}`,
      );
    }
  }
  return false;
}

/**
 * Worker 入口
 * @param {Request} req
 * @param {{ TURNSTILE_SECRET: string, SERVERCHAN_KEY: string }} env
 */
async function handle(req, env) {
  const url = new URL(req.url);

  // 路径白名单：仅 POST /api/tip
  if (url.pathname !== "/api/tip") {
    return json(404, "无此端点");
  }
  if (req.method !== "POST") {
    return json(405, "方法不允许");
  }

  // 闸 1：Origin 白名单（弱闸，不是安全边界——可伪造；真正防滥用靠闸 3）
  if (!originOk(req)) {
    return json(403, "来源不合法");
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(400, "请求格式不正确");
  }

  // 闸 2：蜜罐 —— 命中返回 200 {"ok":true} 且不推送，与成功不可区分
  if (honeypotHit(body.website)) {
    return json(200, null, { ok: true });
  }

  // 闸 3：Turnstile 服务端校验（超时视为未通过；密钥未配 → 502）
  const turnstile = await turnstileOk(body.turnstileToken, env);
  if (turnstile === "missing-secret") {
    return json(502, "驿传暂闭，请稍后再试");
  }
  if (turnstile !== true) {
    return json(400, "请先完成人机校验");
  }

  // 闸 4：字段校验 + 控制字符归一化
  const fields = normalizeAndValidate(body);
  if (fields.error) {
    return json(400, fields.error);
  }

  const pushed = await pushWithRetry(env, fields);
  if (!pushed) {
    return json(502, "驿传暂闭，请稍后再试");
  }
  return json(200, null, { ok: true });
}

export default {
  /**
   * Cloudflare Workers fetch 入口；未捕获异常一律 502 JSON（§3.7）
   * @param {Request} req
   * @param {{ TURNSTILE_SECRET: string, SERVERCHAN_KEY: string }} env
   */
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (err) {
      console.log(`[tip] uncaught ${err && err.message}`);
      return json(502, "驿传暂闭，请稍后再试");
    }
  },
};
