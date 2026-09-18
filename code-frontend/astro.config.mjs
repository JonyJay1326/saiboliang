import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

// 站点：GitHub Pages 源站 + Cloudflare 代理自定义域名，故 base 为根。
// 路由纪律：真实路径、目录形式输出（/github/ → /github/index.html），禁用 hash 路由。
export default defineConfig({
  site: 'https://saiboliang.top',
  output: 'static',
  integrations: [vue()],
  build: {
    format: 'directory',
  },
  vite: {
    // 数据目录在构建期由 pipeline 通过 DATA_CANDIDATE_DIR 注入（契约 §6 / TASKS.md B9）。
    // 未注入时回退到 code-backend 的公开产物，便于本地 dev。
    server: { fs: { allow: ['..'] } },
  },
});
