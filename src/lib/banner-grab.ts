/**
 * TCP Banner Grabbing — connects to open ports and reads the service greeting.
 * Reveals exact software versions (SSH, FTP, SMTP, MySQL, etc.)
 */

import * as net from 'net';

export interface BannerResult {
  port: number;
  banner: string | null;
  service: string | null;
}

/**
 * Known port-to-service mapping for banner analysis.
 */
const PORT_SERVICES: Record<number, string> = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  587: 'SMTP-TLS',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'MSSQL',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
  27017: 'MongoDB',
};

// Ports that send a banner automatically upon connection
const BANNER_PORTS = [21, 22, 23, 25, 110, 143, 587, 993, 995, 3306, 5432, 6379];

/**
 * Attempt to grab a banner from a single port.
 */
function grabBanner(ip: string, port: number, timeout: number = 3000): Promise<BannerResult> {
  return new Promise((resolve) => {
    const result: BannerResult = {
      port,
      banner: null,
      service: PORT_SERVICES[port] || null,
    };

    // Only attempt banner grab on ports known to send greeting data
    if (!BANNER_PORTS.includes(port)) {
      resolve(result);
      return;
    }

    const socket = new net.Socket();
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      if (data.length > 0) {
        result.banner = cleanBanner(data);
      }
      resolve(result);
    }, timeout);

    socket.connect(port, ip, () => {
      // For some protocols, we need to send a probe
      // Most banner ports send data automatically
    });

    socket.on('data', (chunk) => {
      data += chunk.toString('utf-8');
      // Got enough data, close early
      if (data.length > 512) {
        clearTimeout(timer);
        socket.destroy();
        result.banner = cleanBanner(data);
        resolve(result);
      }
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (data.length > 0 && !result.banner) {
        result.banner = cleanBanner(data);
      }
      resolve(result);
    });
  });
}

/**
 * Clean up a raw banner string.
 */
function cleanBanner(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0e-\x1f\x7f-\xff]/g, '') // Remove control chars
    .replace(/\r\n/g, '\n')
    .trim()
    .substring(0, 200);
}

/**
 * Analyze a banner to extract service version info.
 */
export function analyzeBanner(banner: string, port: number): string | null {
  if (!banner) return null;

  // SSH: "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.7"
  const sshMatch = banner.match(/SSH-[\d.]+-([\S]+)/);
  if (sshMatch) return `SSH: ${sshMatch[1]}`;

  // FTP: "220 Microsoft FTP Service" or "220 ProFTPD 1.3.5"
  const ftpMatch = banner.match(/^220[- ](.*)/m);
  if (ftpMatch) return `FTP: ${ftpMatch[1].trim()}`;

  // SMTP: "220 mail.example.com ESMTP Postfix"
  const smtpMatch = banner.match(/^220[- ](.*)/m);
  if (smtpMatch && [25, 587].includes(port)) return `SMTP: ${smtpMatch[1].trim()}`;

  // MySQL: version string
  const mysqlMatch = banner.match(/([\d.]+[-\w]*)\x00/);
  if (mysqlMatch && port === 3306) return `MySQL: ${mysqlMatch[1]}`;

  // PostgreSQL
  if (banner.includes('PostgreSQL') || port === 5432) return `PostgreSQL`;

  // Redis
  if (banner.includes('REDIS') || banner.includes('redis')) return `Redis`;

  // Generic: return first meaningful line
  const firstLine = banner.split('\n')[0].trim();
  return firstLine.length > 3 ? firstLine.substring(0, 100) : null;
}

/**
 * Grab banners from all open ports on a host.
 */
export async function grabBanners(
  ip: string,
  openPorts: number[]
): Promise<BannerResult[]> {
  const results = await Promise.all(
    openPorts.map(port => grabBanner(ip, port))
  );

  // Enrich with analysis
  for (const r of results) {
    if (r.banner) {
      const analysis = analyzeBanner(r.banner, r.port);
      if (analysis) r.service = analysis;
    }
  }

  return results.filter(r => r.banner !== null);
}

/**
 * Batch banner grab across multiple hosts.
 */
export async function grabBannersBatch(
  hosts: { ip: string; openPorts: number[] }[],
  batchSize: number = 5,
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, BannerResult[]>> {
  const results: Record<string, BannerResult[]> = {};

  for (let i = 0; i < hosts.length; i += batchSize) {
    const batch = hosts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(h => grabBanners(h.ip, h.openPorts))
    );
    for (let j = 0; j < batch.length; j++) {
      if (batchResults[j].length > 0) {
        results[batch[j].ip] = batchResults[j];
      }
    }
    onProgress?.(Math.min(i + batchSize, hosts.length), hosts.length);
  }

  return results;
}
