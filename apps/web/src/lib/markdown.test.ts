import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('convierte Markdown básico', () => {
    const html = renderMarkdown('# Términos\n\n**Importante**: lee esto.\n\n- uno\n- dos');
    expect(html).toContain('<h1>Términos</h1>');
    expect(html).toContain('<strong>Importante</strong>');
    expect(html).toContain('<li>uno</li>');
  });

  it('no deja pasar HTML ni enlaces peligrosos', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
  });
});
