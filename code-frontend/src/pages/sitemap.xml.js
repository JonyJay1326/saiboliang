// sitemap.xml —— 构建期生成，含全部 /tickets/[id] 与 /plans/[id]（frontend-spec §2.3）
// /news 为施工占位页且 noindex，不进 sitemap（§4.7）。
import { models, tickets } from '../lib/data.js';

export const prerender = true;

export function GET({ site }) {
  const base = (site ?? new URL('https://saiboliang.top')).origin;

  const staticPaths = [
    '/',
    '/tickets/',
    '/github/',
    '/models/',
    '/plans/',
    '/void/',
    '/collection/',
    '/about/',
  ];

  const ticketPaths = tickets().tickets.map((t) => `/tickets/${t.id}/`);
  const planPaths = models().plans.map((p) => `/plans/${p.id}/`);
  const urls = [...staticPaths, ...ticketPaths, ...planPaths];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((p) => `  <url><loc>${base}${p}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
