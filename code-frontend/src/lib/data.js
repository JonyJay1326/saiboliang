import fs from 'node:fs';
import path from 'node:path';

// 数据来源优先级：
//   1. DATA_CANDIDATE_DIR —— 由 code-backend/pipeline.py 在构建期注入的候选批次（契约 §6）
//   2. ../code-backend/public/data —— 本地 dev 回退，指向已发布的公开产物
const INJECTED = process.env.DATA_CANDIDATE_DIR?.trim();
const DIR = INJECTED
  ? path.resolve(INJECTED)
  : path.resolve(import.meta.dirname, '..', '..', '..', 'code-backend', 'public', 'data');

const FILES = ['version', 'tickets', 'models', 'github', 'news'];

let cached = null;

export function dataDir() {
  return DIR;
}

export function batch() {
  if (cached) return cached;

  const out = {};
  for (const name of FILES) {
    const file = path.join(DIR, `${name}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `[data] 缺少 ${name}.json：${file}\n` +
          `构建期应由 DATA_CANDIDATE_DIR 注入候选批次；本地 dev 请先跑 code-backend/pipeline.py collect。`
      );
    }
    out[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // 契约 §1.1：同批五个文件的 version 必须相等，否则是混批。
  const seen = new Map(FILES.map((n) => [n, out[n].version]));
  const unique = new Set(seen.values());
  if (unique.size !== 1) {
    throw new Error(
      `[data] 混批：五个文件的 version 不一致 -> ${[...seen].map(([n, v]) => `${n}=${v}`).join(', ')}`
    );
  }

  cached = out;
  return cached;
}

export function tickets() {
  return batch().tickets;
}

export function models() {
  return batch().models;
}

export function github() {
  return batch().github;
}

export function news() {
  return batch().news;
}

export function version() {
  return batch().version;
}
