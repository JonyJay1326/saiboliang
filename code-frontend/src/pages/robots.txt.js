// robots.txt —— 允许抓取，指向 sitemap（frontend-spec §2.3）
export const prerender = true;

export function GET({ site }) {
  const base = (site ?? new URL('https://saiboliang.top')).origin;
  const body = ['User-agent: *', 'Allow: /', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
