import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tls module
vi.mock('tls', () => ({
  connect: vi.fn(),
}));

import * as tls from 'tls';
import { probeSSL, probeSSLBatch } from '../ssl-probe';

const mockConnect = vi.mocked(tls.connect);

describe('ssl-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('probeSSL', () => {
    it('returns cert info on successful TLS connection', async () => {
      const mockSocket = {
        getProtocol: vi.fn(() => 'TLSv1.3'),
        getPeerCertificate: vi.fn(() => ({
          subject: { CN: 'example.com' },
          issuer: { CN: 'Let\'s Encrypt', O: 'ISRG' },
          valid_from: 'Jan 1 00:00:00 2025 GMT',
          valid_to: 'Dec 31 23:59:59 2027 GMT',
          subjectaltname: 'DNS:example.com, DNS:www.example.com, IP Address:192.168.2.1',
        })),
        end: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation((_opts: unknown, cb: unknown) => {
        setTimeout(() => (cb as Function)(), 0);
        return mockSocket as unknown as tls.TLSSocket;
      });

      const result = await probeSSL('192.168.2.1', 443, 5000);
      expect(result.accessible).toBe(true);
      expect(result.subject).toBe('example.com');
      expect(result.issuer).toBe("Let's Encrypt");
      expect(result.protocol).toBe('TLSv1.3');
      expect(result.selfSigned).toBe(false);
      expect(result.altNames).toContain('example.com');
      expect(result.altNames).toContain('www.example.com');
      expect(result.altNames).toContain('192.168.2.1');
      expect(result.daysUntilExpiry).not.toBeNull();
    });

    it('detects self-signed certificate', async () => {
      const mockSocket = {
        getProtocol: vi.fn(() => 'TLSv1.2'),
        getPeerCertificate: vi.fn(() => ({
          subject: { CN: 'MyServer', O: 'MyOrg' },
          issuer: { CN: 'MyServer', O: 'MyOrg' },
          valid_from: 'Jan 1 00:00:00 2025 GMT',
          valid_to: 'Dec 31 23:59:59 2025 GMT',
        })),
        end: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation((_opts: unknown, cb: unknown) => {
        setTimeout(() => (cb as Function)(), 0);
        return mockSocket as unknown as tls.TLSSocket;
      });

      const result = await probeSSL('192.168.2.1');
      expect(result.selfSigned).toBe(true);
    });

    it('handles connection error', async () => {
      const mockSocket = {
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation(() => {
        const socket = mockSocket as unknown as tls.TLSSocket;
        setTimeout(() => {
          const errorHandler = (mockSocket.on as vi.Mock).mock.calls.find(
            (c: unknown[]) => c[0] === 'error'
          );
          if (errorHandler) errorHandler[1](new Error('ECONNREFUSED'));
        }, 0);
        return socket;
      });

      const result = await probeSSL('192.168.2.1');
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('handles missing subject in cert', async () => {
      const mockSocket = {
        getProtocol: vi.fn(() => 'TLSv1.2'),
        getPeerCertificate: vi.fn(() => ({})),
        end: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation((_opts: unknown, cb: unknown) => {
        setTimeout(() => (cb as Function)(), 0);
        return mockSocket as unknown as tls.TLSSocket;
      });

      const result = await probeSSL('192.168.2.1');
      expect(result.accessible).toBe(true);
      expect(result.subject).toBeNull();
    });

    it('uses issuer O when CN is missing', async () => {
      const mockSocket = {
        getProtocol: vi.fn(() => 'TLSv1.2'),
        getPeerCertificate: vi.fn(() => ({
          subject: { CN: 'server' },
          issuer: { O: 'OrgName' },
          valid_from: 'Jan 1 00:00:00 2025 GMT',
          valid_to: 'Dec 31 23:59:59 2025 GMT',
        })),
        end: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation((_opts: unknown, cb: unknown) => {
        setTimeout(() => (cb as Function)(), 0);
        return mockSocket as unknown as tls.TLSSocket;
      });

      const result = await probeSSL('192.168.2.1');
      expect(result.issuer).toBe('OrgName');
    });
  });

  describe('probeSSLBatch', () => {
    it('probes multiple hosts and ports', async () => {
      const mockSocket = {
        getProtocol: vi.fn(() => 'TLSv1.2'),
        getPeerCertificate: vi.fn(() => ({ subject: { CN: 'test' } })),
        end: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockConnect.mockImplementation((_opts: unknown, cb: unknown) => {
        setTimeout(() => (cb as Function)(), 0);
        return mockSocket as unknown as tls.TLSSocket;
      });

      const progress = vi.fn();
      const results = await probeSSLBatch(
        [{ ip: '192.168.2.1', ports: [443, 8443] }],
        10,
        progress
      );
      expect(results).toHaveLength(2);
      expect(progress).toHaveBeenCalled();
    });
  });
});
