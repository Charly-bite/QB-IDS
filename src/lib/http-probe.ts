/**
 * HTTP Banner Probe — fetches page title and server headers from web-enabled devices.
 * Identifies device type from web interface (FortiGate, Synology, IIS, printers, etc.)
 */

export interface HTTPProbeResult {
  ip: string;
  httpTitle: string | null;
  httpServer: string | null;
  statusCode: number | null;
  redirectUrl: string | null;
  protocol: 'http' | 'https' | null;
}

/**
 * Probe a single host for HTTP/HTTPS info.
 * Tries HTTPS first (port 443), falls back to HTTP (port 80).
 */
export async function probeHTTP(
  ip: string,
  openPorts: number[]
): Promise<HTTPProbeResult> {
  const result: HTTPProbeResult = {
    ip,
    httpTitle: null,
    httpServer: null,
    statusCode: null,
    redirectUrl: null,
    protocol: null,
  };

  const hasHTTPS = openPorts.includes(443) || openPorts.includes(8443);
  const hasHTTP = openPorts.includes(80) || openPorts.includes(8080);

  // Try HTTPS first, then HTTP
  const urls: string[] = [];
  if (hasHTTPS) urls.push(`https://${ip}${openPorts.includes(8443) ? ':8443' : ''}`);
  if (hasHTTP) urls.push(`http://${ip}${openPorts.includes(8080) ? ':8080' : ''}`);

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'PanelControl/1.0 NetworkScanner',
          'Accept': 'text/html',
        },
        ...(url.startsWith('https') ? { dispatcher: undefined } : {}),
      });

      clearTimeout(timeoutId);

      result.statusCode = response.status;
      result.protocol = url.startsWith('https') ? 'https' : 'http';

      // Get server header
      result.httpServer = response.headers.get('server') || null;

      // Get redirect URL
      if (response.status >= 300 && response.status < 400) {
        result.redirectUrl = response.headers.get('location') || null;
      }

      // Try to extract page title from HTML
      try {
        const body = await response.text();
        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          result.httpTitle = titleMatch[1]
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
            .trim()
            .substring(0, 150);
        }
      } catch { /* body read failed */ }

      // If we got useful data, stop trying other protocols
      if (result.httpTitle || result.httpServer) break;
    } catch {
      // Connection refused, timeout, SSL error — try next
      continue;
    }
  }

  return result;
}

/**
 * Batch-probe multiple hosts for HTTP info.
 */
export async function probeHTTPBatch(
  hosts: { ip: string; openPorts: number[] }[],
  batchSize: number = 15,
  onProgress?: (done: number, total: number) => void
): Promise<HTTPProbeResult[]> {
  const results: HTTPProbeResult[] = [];

  for (let i = 0; i < hosts.length; i += batchSize) {
    const batch = hosts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(h => probeHTTP(h.ip, h.openPorts))
    );
    results.push(...batchResults);
    onProgress?.(Math.min(i + batchSize, hosts.length), hosts.length);
  }

  return results;
}
