/**
 * SSL/TLS Certificate Probe — connects to HTTPS services and extracts cert details.
 * Monitors certificate expiry, issuer, and self-signed status.
 */

import * as tls from 'tls';

export interface SSLCertResult {
  ip: string;
  port: number;
  accessible: boolean;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  selfSigned: boolean;
  altNames: string[];
  protocol: string | null;
  error: string | null;
}

/**
 * Probe a single host for SSL certificate info.
 */
export function probeSSL(ip: string, port: number = 443, timeout: number = 5000): Promise<SSLCertResult> {
  return new Promise((resolve) => {
    const result: SSLCertResult = {
      ip,
      port,
      accessible: false,
      subject: null,
      issuer: null,
      validFrom: null,
      validTo: null,
      daysUntilExpiry: null,
      selfSigned: false,
      altNames: [],
      protocol: null,
      error: null,
    };

    const timer = setTimeout(() => {
      socket.destroy();
      result.error = 'Connection timeout';
      resolve(result);
    }, timeout);

    const socket = tls.connect(
      {
        host: ip,
        port,
        rejectUnauthorized: false, // Accept self-signed certs
        servername: ip,
      },
      () => {
        clearTimeout(timer);
        result.accessible = true;
        result.protocol = socket.getProtocol() || null;

        const cert = socket.getPeerCertificate();
        if (cert && cert.subject) {
          const cn = cert.subject.CN;
          result.subject = (Array.isArray(cn) ? cn[0] : cn) || Object.values(cert.subject).flat().join(', ') || null;

          // Issuer
          if (cert.issuer) {
            const issuerCN = cert.issuer.CN;
            const issuerO = cert.issuer.O;
            result.issuer = (Array.isArray(issuerCN) ? issuerCN[0] : issuerCN) || (Array.isArray(issuerO) ? issuerO[0] : issuerO) || Object.values(cert.issuer).flat().join(', ') || null;
          }

          // Validity dates
          if (cert.valid_from) {
            result.validFrom = cert.valid_from;
          }
          if (cert.valid_to) {
            result.validTo = cert.valid_to;
            const expiry = new Date(cert.valid_to);
            const now = new Date();
            result.daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          }

          // Self-signed check
          if (cert.subject && cert.issuer) {
            result.selfSigned = (
              cert.subject.CN === cert.issuer.CN &&
              cert.subject.O === cert.issuer.O
            );
          }

          // Subject Alternative Names
          if (cert.subjectaltname) {
            result.altNames = cert.subjectaltname
              .split(',')
              .map((s: string) => s.trim().replace(/^DNS:/, '').replace(/^IP Address:/, ''));
          }
        }

        socket.end();
        resolve(result);
      }
    );

    socket.on('error', (err) => {
      clearTimeout(timer);
      result.error = err.message.substring(0, 100);
      resolve(result);
    });
  });
}

/**
 * Batch-probe multiple hosts for SSL certificates.
 */
export async function probeSSLBatch(
  hosts: { ip: string; ports: number[] }[],
  batchSize: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<SSLCertResult[]> {
  const results: SSLCertResult[] = [];

  // Flatten: each host may have multiple SSL ports
  const tasks: { ip: string; port: number }[] = [];
  for (const h of hosts) {
    for (const p of h.ports) {
      tasks.push({ ip: h.ip, port: p });
    }
  }

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(t => probeSSL(t.ip, t.port))
    );
    results.push(...batchResults);
    onProgress?.(Math.min(i + batchSize, tasks.length), tasks.length);
  }

  return results;
}
