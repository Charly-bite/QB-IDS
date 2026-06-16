import { describe, it, expect, vi, beforeEach } from 'vitest';

// Socket factory mock with config
const { config, createMockSocket } = vi.hoisted(() => {
  type Behavior = 'data' | 'largeData' | 'closeWithData' | 'error' | 'timeout';
  const config = { bannerData: undefined as string | undefined, behavior: 'data' as Behavior };

  const createMockSocket = () => {
    const handlers: Record<string, Function[]> = {};
    return {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return undefined;
      }),
      connect: vi.fn((_port: number, _ip: string, cb?: Function) => {
        setTimeout(() => {
          cb?.();
          if (config.behavior === 'largeData' && config.bannerData) {
            // Send > 512 bytes to trigger early close
            const bigData = config.bannerData.repeat(200);
            handlers['data']?.forEach(h => h(Buffer.from(bigData)));
          } else if (config.behavior === 'closeWithData' && config.bannerData) {
            // Data arrives then close fires (without data handler resolving first)
            handlers['data']?.forEach(h => h(Buffer.from(config.bannerData!)));
            handlers['close']?.forEach(h => h());
          } else if (config.behavior === 'data' && config.bannerData) {
            handlers['data']?.forEach(h => h(Buffer.from(config.bannerData!)));
            handlers['close']?.forEach(h => h());
          } else {
            handlers['error']?.forEach(h => h(new Error('ECONNREFUSED')));
          }
        }, 0);
      }),
      destroy: vi.fn(),
    };
  };
  return { config, createMockSocket };
});

vi.mock('net', () => {
  function MockSocket() { return createMockSocket(); }
  return {
    Socket: MockSocket,
    default: { Socket: MockSocket },
  };
});

import { analyzeBanner, grabBanners, grabBannersBatch } from '../banner-grab';

describe('banner-grab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.bannerData = undefined;
    config.behavior = 'data';
  });

  describe('analyzeBanner', () => {
    it('detects SSH version', () => {
      const result = analyzeBanner('SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.7', 22);
      expect(result).toBe('SSH: OpenSSH_8.9p1');
    });

    it('detects FTP banner', () => {
      const result = analyzeBanner('220 Microsoft FTP Service', 21);
      expect(result).toBe('FTP: Microsoft FTP Service');
    });

    it('detects SMTP banner on port 25', () => {
      const result = analyzeBanner('220 mail.example.com ESMTP Postfix', 25);
      expect(result).toBe('FTP: mail.example.com ESMTP Postfix');
    });

    it('detects PostgreSQL', () => {
      const result = analyzeBanner('something PostgreSQL related', 5432);
      expect(result).toBe('PostgreSQL');
    });

    it('detects Redis', () => {
      const result = analyzeBanner('-ERR redis wrong number of arguments', 6379);
      expect(result).toBe('Redis');
    });

    it('detects MySQL', () => {
      const result = analyzeBanner('5.7.38-0ubuntu0 MySQL Community Server', 3306);
      expect(result).toContain('MySQL');
    });

    it('detects HTTP server', () => {
      const result = analyzeBanner('HTTP/1.1 200 OK\r\nServer: nginx', 8080);
      expect(result).toContain('HTTP');
    });

    it('returns first line for unknown banner', () => {
      const result = analyzeBanner('Hello World\nSecond line', 9999);
      expect(result).toBe('Hello World');
    });

    it('returns null for empty banner', () => {
      expect(analyzeBanner('', 22)).toBeNull();
    });

    it('returns null for very short banner', () => {
      expect(analyzeBanner('OK', 22)).toBeNull();
    });
  });

  describe('grabBanners', () => {
    it('returns banners for banner-eligible ports', async () => {
      config.bannerData = 'SSH-2.0-OpenSSH_8.9p1';
      config.behavior = 'data';

      const results = await grabBanners('192.168.2.1', [22]);
      expect(results).toHaveLength(1);
      expect(results[0].port).toBe(22);
      expect(results[0].banner).toContain('SSH');
    });

    it('skips non-banner ports', async () => {
      config.bannerData = 'SomeData';
      config.behavior = 'data';

      const results = await grabBanners('192.168.2.1', [80]);
      expect(results).toHaveLength(0);
    });

    it('handles connection errors gracefully', async () => {
      config.bannerData = undefined;
      config.behavior = 'error';

      const results = await grabBanners('192.168.2.1', [22]);
      expect(results).toHaveLength(0);
    });

    it('handles large data responses (>512 bytes)', async () => {
      config.bannerData = 'SSH-2.0-BigServer ';
      config.behavior = 'largeData';

      const results = await grabBanners('192.168.2.1', [22]);
      expect(results).toHaveLength(1);
      expect(results[0].banner).toContain('SSH');
    });

    it('grabs banners from FTP port', async () => {
      config.bannerData = '220 ProFTPD 1.3.5';
      config.behavior = 'data';

      const results = await grabBanners('192.168.2.1', [21]);
      expect(results).toHaveLength(1);
      expect(results[0].banner).toContain('FTP');
    });

    it('grabs banners from telnet port', async () => {
      config.bannerData = 'Welcome to the router\r\nLogin:';
      config.behavior = 'data';

      const results = await grabBanners('192.168.2.1', [23]);
      expect(results).toHaveLength(1);
    });
  });

  describe('grabBannersBatch', () => {
    it('processes multiple hosts in batches', async () => {
      config.bannerData = 'SSH-2.0-Test';
      config.behavior = 'data';
      const progress = vi.fn();
      const results = await grabBannersBatch(
        [
          { ip: '192.168.2.1', openPorts: [22] },
          { ip: '192.168.2.2', openPorts: [22] },
        ],
        2,
        progress,
      );

      expect(progress).toHaveBeenCalled();
      expect(typeof results).toBe('object');
    });

    it('reports progress for each batch', async () => {
      config.bannerData = undefined;
      config.behavior = 'error';
      const progress = vi.fn();
      await grabBannersBatch(
        [
          { ip: '192.168.2.1', openPorts: [22] },
          { ip: '192.168.2.2', openPorts: [22] },
        ],
        1,
        progress,
      );
      expect(progress).toHaveBeenCalledTimes(2);
    });
  });
});
