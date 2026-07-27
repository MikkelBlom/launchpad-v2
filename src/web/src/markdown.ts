// Tiny, dependency-free Markdown → HTML renderer for README previews.
// Supports headings, bold/italic, inline code, code fences, links, lists, blockquotes,
// and paragraphs. HTML is escaped first, so raw HTML in the source is shown as text.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="lp-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n')
  const out: string[] = []
  let inList = false
  let inCode = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        closeList()
        out.push('<pre class="lp-pre"><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(line)
      continue
    }

    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level} class="lp-h">${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^[-*+]\s+/.test(line.trim())) {
      if (!inList) {
        out.push('<ul class="lp-ul">')
        inList = true
      }
      out.push(`<li>${inline(line.trim().replace(/^[-*+]\s+/, ''))}</li>`)
      continue
    }

    if (line.trim().startsWith('&gt;')) {
      closeList()
      out.push(`<blockquote class="lp-quote">${inline(line.trim().replace(/^&gt;\s?/, ''))}</blockquote>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  if (inCode) out.push('</code></pre>')
  closeList()
  return out.join('\n')
}
