const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function youtubeVideoId(input) {
  const text = String(input || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.has(url.hostname) || url.username || url.password) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const id = url.hostname === 'youtu.be' ? parts[0]
      : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : url.searchParams.get('v');
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}

export function sharedYouTubeUrl(text) {
  for (const candidate of String(text || '').match(/https?:\/\/[^\s<>]+/gi) || []) {
    const cleaned = candidate.replace(/[),.!?;]+$/, '');
    const id = youtubeVideoId(cleaned);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
    try {
      const url = new URL(cleaned);
      if (HOSTS.has(url.hostname) && !url.username && !url.password && url.pathname === '/playlist' && /^[\w-]+$/.test(url.searchParams.get('list') || '')) return url.toString();
    } catch { /* Ignore non-URL text in shares. */ }
  }
  return '';
}

export function downloadKey(url, type, quality) {
  const id = youtubeVideoId(url);
  return id ? `${id}:${type === 'mp4' ? 'mp4' : 'm4a'}:${quality}` : '';
}

// MediaStore replaces this temporary filename when a download is published.
export function publishedMediaName(name) {
  return String(name || '').replace(/^\.pending-\d+-(.+)$/, '$1');
}
