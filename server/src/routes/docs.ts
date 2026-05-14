import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const router = Router();

// docs/ lives at the project root, two levels up from server/dist.
const DOCS_DIR = path.resolve(__dirname, '../../../docs');

const PAGE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #09090b; color: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; line-height: 1.6; }
.wrap { max-width: 880px; margin: 0 auto; padding: 32px 24px; }
nav { background: rgba(24,24,27,0.6); border: 1px solid rgba(63,63,70,0.6); border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }
nav a { display: inline-block; margin-right: 14px; color: #22d3ee; text-decoration: none; font-size: 13px; }
nav a:hover { text-decoration: underline; }
nav .crumb { color: #71717a; margin-right: 8px; }
h1, h2, h3, h4 { color: #f4f4f5; font-family: 'Space Grotesk', system-ui, sans-serif; letter-spacing: -0.01em; margin-top: 1.6em; }
h1 { font-size: 28px; border-bottom: 1px solid rgba(63,63,70,0.5); padding-bottom: 8px; }
h2 { font-size: 22px; }
h3 { font-size: 18px; }
p, li { font-size: 14.5px; color: #d4d4d8; }
code { font-family: 'JetBrains Mono', SFMono-Regular, ui-monospace, monospace; font-size: 12.5px; background: rgba(24,24,27,0.8); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(63,63,70,0.6); color: #22d3ee; }
pre { background: rgba(9,9,11,0.7); border: 1px solid rgba(63,63,70,0.6); border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
pre code { background: transparent; border: none; padding: 0; color: #d4d4d8; }
a { color: #22d3ee; }
table { border-collapse: collapse; margin: 12px 0; width: 100%; }
th, td { border: 1px solid rgba(63,63,70,0.6); padding: 6px 10px; font-size: 13px; text-align: left; }
th { background: rgba(24,24,27,0.6); color: #f4f4f5; }
hr { border: none; border-top: 1px solid rgba(63,63,70,0.5); margin: 32px 0; }
blockquote { border-left: 3px solid #22d3ee; margin: 12px 0; padding: 4px 16px; color: #a1a1aa; background: rgba(34,211,238,0.05); }
`;

function listMarkdown(dir: string, prefix = ''): Array<{ slug: string; title: string }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ slug: string; title: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      out.push(...listMarkdown(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.md')) {
      const slug = (prefix + entry.name).replace(/\.md$/, '');
      out.push({ slug, title: prettifyTitle(slug) });
    }
  }
  return out;
}

function prettifyTitle(slug: string): string {
  return slug.split('/').pop()!.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function shell(crumbs: { href: string; label: string }[], body: string, title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — VarrokEdge docs</title><style>${PAGE_CSS}</style></head><body><div class="wrap"><nav>${crumbs.map(c => `<a href="${c.href}"><span class="crumb">›</span>${escapeHtml(c.label)}</a>`).join('')}</nav>${body}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

router.get('/', (_req, res) => {
  const pages = listMarkdown(DOCS_DIR);
  const grouped = new Map<string, typeof pages>();
  for (const p of pages) {
    const group = p.slug.includes('/') ? p.slug.split('/')[0]! : 'root';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(p);
  }
  const sections: string[] = [];
  for (const [group, items] of grouped.entries()) {
    const heading = group === 'root' ? 'Top-level' : prettifyTitle(group);
    const list = items.map(p => `<li><a href="/docs/${p.slug}">${escapeHtml(p.title)}</a> <code>${escapeHtml(p.slug)}.md</code></li>`).join('');
    sections.push(`<h2>${escapeHtml(heading)}</h2><ul>${list}</ul>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(shell([{ href: '/docs', label: 'docs' }], `<h1>VarrokEdge documentation</h1>${sections.join('')}`, 'VarrokEdge docs'));
});

router.get('/:slug(*)', (req, res) => {
  const slug = req.params.slug;
  // Allow only [a-z0-9_/-]; strip leading/trailing slashes.
  if (!/^[a-z0-9_/-]+$/i.test(slug)) return res.status(400).send('bad slug');
  const file = path.join(DOCS_DIR, `${slug}.md`);
  // Defend against escapes.
  if (!file.startsWith(DOCS_DIR + path.sep) && file !== DOCS_DIR) return res.status(400).send('bad slug');
  if (!fs.existsSync(file)) return res.status(404).send(shell([{ href: '/docs', label: 'docs' }], `<h1>Not found</h1><p><code>${escapeHtml(slug)}.md</code> doesn't exist.</p>`, 'Not found'));
  const md = fs.readFileSync(file, 'utf8');
  const html = marked.parse(md, { async: false }) as string;
  const crumbs: { href: string; label: string }[] = [{ href: '/docs', label: 'docs' }];
  const parts = slug.split('/');
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ href: `/docs/${acc}`, label: part });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(shell(crumbs, html, slug));
});

export default router;
