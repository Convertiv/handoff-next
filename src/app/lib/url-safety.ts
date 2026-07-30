/**
 * Normalize and refuse anything that isn't a public web page.
 *
 * This fetches a user-supplied URL from the server, so it is an SSRF surface: without these checks a
 * user could point it at `http://localhost`, cloud metadata endpoints, or anything else reachable from
 * the deployment that they cannot reach themselves.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  // Detect ANY scheme before deciding to prefix. Testing only for http(s) meant `file:///etc/passwd`
  // fell through to the prefix branch and became `https://file///etc/passwd` — a valid-looking URL that
  // sailed past the scheme check below, leaving that check unreachable. Harmless in effect, wrong in
  // principle, and exactly the kind of thing that quietly stops protecting you.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('Only http and https URLs can be imported.');
  }
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('That does not look like a URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be imported.');
  }

  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    // IPv4 literals in private and link-local ranges, including the cloud metadata address.
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error('That address is not reachable from here.');

  return parsed.href;
}
