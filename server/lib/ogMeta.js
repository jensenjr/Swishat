// Builds per-campaign OpenGraph / Twitter meta tags, injected server-side into
// the SPA's HTML so that links shared on Messenger/WhatsApp/Facebook/X render a
// rich card. Social crawlers don't execute the SPA's JS, so this must happen on
// the server.

// Escape for safe insertion into double-quoted HTML attributes.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOgTags({ title, description, collected, target, count, url, image }) {
  const fmt = (n) => Number(n || 0).toLocaleString('sv-SE');
  const progress = target
    ? `${fmt(collected)} kr insamlat av ${fmt(target)} kr · ${count} bidragsgivare`
    : `${fmt(collected)} kr insamlat · ${count} bidragsgivare`;

  const desc = description && description.trim()
    ? description.trim().slice(0, 200)
    : progress;
  const fullTitle = `${title} · Swish Insamling`;

  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Swish Insamling'],
    ['property', 'og:title', fullTitle],
    ['property', 'og:description', desc],
    url ? ['property', 'og:url', url] : null,
    image ? ['property', 'og:image', image] : null,
    ['name', 'twitter:card', image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', fullTitle],
    ['name', 'twitter:description', desc],
    ['name', 'description', desc],
  ];

  return tags
    .filter(Boolean)
    .map(([attr, key, val]) => `<meta ${attr}="${key}" content="${escapeHtml(val)}" />`)
    .join('\n    ');
}
