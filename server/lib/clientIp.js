// Client IP, trusting the reverse proxy (Coolify/Traefik) that terminates TLS
// and sets these headers. Only safe because the app is not exposed directly;
// if you ever run it without a trusted proxy, do not trust these headers.
export function getClientIp(c) {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}
