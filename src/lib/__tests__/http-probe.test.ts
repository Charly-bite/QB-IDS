import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('http-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache so we get fresh imports
    vi.resetModules();
  });

  describe('probeHTTP', () => {
    it('tries HTTPS first when port 443 is open', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: (key: string) => key === 'server' ? 'nginx' : null },
        text: async () => '<html><title>Test Page</title></html>',
      });

      const result = await probeHTTP('192.168.2.1', [443, 80]);
      expect(result.protocol).toBe('https');
      expect(result.httpTitle).toBe('Test Page');
      expect(result.httpServer).toBe('nginx');
      expect(result.statusCode).toBe(200);
    });

    it('falls back to HTTP when HTTPS fails', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch
        .mockRejectedValueOnce(new Error('SSL error'))  // HTTPS fails
        .mockResolvedValueOnce({
          status: 200,
          headers: { get: (key: string) => key === 'server' ? 'Apache' : null },
          text: async () => '<title>HTTP Page</title>',
        });

      const result = await probeHTTP('192.168.2.1', [443, 80]);
      expect(result.protocol).toBe('http');
      expect(result.httpTitle).toBe('HTTP Page');
    });

    it('handles redirect (3xx) with location', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 301,
        headers: { get: (key: string) => {
          if (key === 'server') return 'nginx';
          if (key === 'location') return 'https://192.168.2.1/login';
          return null;
        }},
        text: async () => '',
      });

      const result = await probeHTTP('192.168.2.1', [80]);
      expect(result.redirectUrl).toBe('https://192.168.2.1/login');
      expect(result.statusCode).toBe(301);
    });

    it('decodes HTML entities in title', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        text: async () => '<title>Test &amp; Demo &lt;Page&gt;</title>',
      });

      const result = await probeHTTP('192.168.2.1', [80]);
      expect(result.httpTitle).toBe('Test & Demo <Page>');
    });

    it('decodes numeric HTML entities in title', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        text: async () => '<title>&#72;&#101;&#108;&#108;&#111;</title>',
      });

      const result = await probeHTTP('192.168.2.1', [80]);
      expect(result.httpTitle).toBe('Hello');
    });

    it('truncates long titles to 150 chars', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      const longTitle = 'A'.repeat(300);
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        text: async () => `<title>${longTitle}</title>`,
      });

      const result = await probeHTTP('192.168.2.1', [80]);
      expect(result.httpTitle!.length).toBeLessThanOrEqual(150);
    });

    it('returns empty result for no web ports', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      const result = await probeHTTP('192.168.2.1', [22, 3389]);
      expect(result.httpTitle).toBeNull();
      expect(result.httpServer).toBeNull();
      expect(result.protocol).toBeNull();
    });

    it('handles body read failure gracefully', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: (key: string) => key === 'server' ? 'IIS' : null },
        text: async () => { throw new Error('stream error'); },
      });

      const result = await probeHTTP('192.168.2.1', [80]);
      expect(result.httpServer).toBe('IIS');
      expect(result.httpTitle).toBeNull();
    });

    it('uses port 8443 for HTTPS-alt', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => 'test' },
        text: async () => '<title>Alt HTTPS</title>',
      });

      await probeHTTP('192.168.2.1', [8443]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://192.168.2.1:8443'),
        expect.anything(),
      );
    });

    it('uses port 8080 for HTTP-alt', async () => {
      const { probeHTTP } = await import('../http-probe');
      
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => 'test' },
        text: async () => '<title>Alt HTTP</title>',
      });

      await probeHTTP('192.168.2.1', [8080]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://192.168.2.1:8080'),
        expect.anything(),
      );
    });
  });

  describe('probeHTTPBatch', () => {
    it('probes multiple hosts in batches', async () => {
      const { probeHTTPBatch } = await import('../http-probe');
      
      // All connections fail
      mockFetch.mockRejectedValue(new Error('refused'));

      const hosts = [
        { ip: '192.168.2.1', openPorts: [80] },
        { ip: '192.168.2.2', openPorts: [443] },
      ];
      const progress = vi.fn();

      const results = await probeHTTPBatch(hosts, 10, progress);
      expect(results).toHaveLength(2);
      expect(progress).toHaveBeenCalled();
    });

    it('calls progress callback with correct counts', async () => {
      const { probeHTTPBatch } = await import('../http-probe');
      
      mockFetch.mockRejectedValue(new Error('refused'));
      const progress = vi.fn();

      const hosts = Array.from({ length: 20 }, (_, i) => ({
        ip: `192.168.2.${i + 1}`,
        openPorts: [80],
      }));

      await probeHTTPBatch(hosts, 15, progress);
      expect(progress).toHaveBeenCalledWith(15, 20);
      expect(progress).toHaveBeenCalledWith(20, 20);
    });
  });
});
