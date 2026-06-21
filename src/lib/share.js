// Build the share message and open the native share sheet (or copy to
// clipboard as a fallback). Returns true if the share/copy completed, false if
// the user dismissed it or it failed.
export async function shareCollection({ url, title, targetAmount, suggestedAmount }) {
  const parts = [`Här är länken till insamlingen "${title}"`];
  if (targetAmount) parts.push(`Mål: ${targetAmount} kr`);
  if (suggestedAmount) parts.push(`Rekommenderat belopp: ${suggestedAmount} kr`);
  parts.push(url);
  const text = parts.join("\n");
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
