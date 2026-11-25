import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';

const parser = new Marked({ gfm: true, breaks: false });
parser.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      tokenizer(source) {
        const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(source);
        return match ? { type: 'mathBlock', raw: match[0], text: match[1] } : undefined;
      },
      renderer(token) {
        return `${katex.renderToString(String(token.text ?? ''), { displayMode: true, throwOnError: false })}\n`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(source) {
        const index = source.indexOf('$');
        return index < 0 ? undefined : index;
      },
      tokenizer(source) {
        if (source.startsWith('\\$')) return undefined;
        const match = /^\$((?:\\.|[^\\$\n])+?)\$(?!\$)/.exec(source);
        if (!match || /^\s|\s$/.test(match[1])) return undefined;
        return { type: 'mathInline', raw: match[0], text: match[1] };
      },
      renderer(token) {
        return katex.renderToString(String(token.text ?? ''), { throwOnError: false });
      },
    },
  ],
});

/** All user-authored Markdown goes through the same parser and HTML sanitizer. */
export function renderMarkdown(source: string): string {
  const html = parser.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['aria-hidden', 'xmlns'],
  });
}
