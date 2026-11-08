import { marked } from 'marked';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * Renders the admin-edited legal texts. Raw HTML is escaped first, so only Markdown formatting
 * reaches the page (no script injection even if the admin account were compromised).
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(escapeHtml(source), { async: false, gfm: true, breaks: true });
  // Links: only http(s), mailto and relative; neutralize anything else (javascript:, data:).
  return html.replace(/href="(?!https?:\/\/|mailto:|\/|#)[^"]*"/gi, 'href="#"');
}
