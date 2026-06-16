import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared config accessible from hoisted mock
const { config, createMockSocket } = vi.hoisted(() => {
  const config = { openPorts: new Set<number>() };

  const createMockSocket = () => {
    const handlers: Record<string, Function[]> = {};
    const socket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return socket;
      }),
      connect: vi.fn((port: number) => {
        setTimeout(() => {
          if (config.openPorts.has(port)) {
            handlers['connect']?.forEach(h => h());
          } else {
            handlers['error']?.forEach(h => h(new Error('ECONNREFUSED')));
          }
        }, 0);
      }),
      destroy: vi.fn(),
    };
    return socket;
  };

  return { config, createMockSocket };
});

vi.mock('net', () => {
  // Use a class-like constructor so `new net.Socket()` works
  function MockSocket() { return createMockSocket(); }
  return {
    Socket: MockSocket,
    default: { Socket: MockSocket },
  };
});

import { scanHost, scanHosts, formatPorts } from '../port-scan';

describe('port-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.openPorts = new Set();
  });

  describe('scanHost', () => {
    it('detects open ports', async () => {
      config.openPorts = new Set([22, 80]);
      const result = await scanHost('192.168.2.1');
      expect(result.ip).toBe('192.168.2.1');
      expect(result.openPorts).toContain(22);
      expect(result.openPorts).toContain(80);
      expect(result.services[22]).toBe('SSH');
      expect(result.services[80]).toBe('HTTP');
    });

    it('returns empty when all ports are closed', async () => {
      config.openPorts = new Set();
      const result = await scanHost('192.168.2.99');
      expect(result.ip).toBe('192.168.2.99');
      expect(result.openPorts).toHaveLength(0);
    });

    it('detects multiple port types', async () => {
      config.openPorts = new Set([443, 3389, 445]);
      const result = await scanHost('192.168.2.10');
      expect(result.openPorts).toContain(443);
      expect(result.openPorts).toContain(3389);
      expect(result.openPorts).toContain(445);
      expect(result.services[443]).toBe('HTTPS');
      expect(result.services[3389]).toBe('RDP');
      expect(result.services[445]).toBe('SMB');
    });
  });

  describe('scanHosts', () => {
    it('scans multiple hosts with progress', async () => {
      config.openPorts = new Set();
      const progress = vi.fn();
      const results = await scanHosts(['192.168.2.1', '192.168.2.2'], 2, progress);
      expect(results).toHaveLength(2);
      expect(progress).toHaveBeenCalled();
    });

    it('scans in batches', async () => {
      config.openPorts = new Set();
      const progress = vi.fn();
      const results = await scanHosts(['192.168.2.1', '192.168.2.2', '192.168.2.3'], 1, progress);
      expect(results).toHaveLength(3);
      expect(progress).toHaveBeenCalledTimes(3);
    });
  });

  describe('formatPorts', () => {
    it('formats ports with services', () => {
      expect(formatPorts({
        ip: '192.168.2.1',
        openPorts: [22, 80, 443],
        services: { 22: 'SSH', 80: 'HTTP', 443: 'HTTPS' },
      })).toBe('22(SSH), 80(HTTP), 443(HTTPS)');
    });

    it('uses ? for unknown service', () => {
      expect(formatPorts({ ip: '192.168.2.1', openPorts: [9999], services: {} })).toBe('9999(?)');
    });

    it('returns empty string for no ports', () => {
      expect(formatPorts({ ip: '192.168.2.1', openPorts: [], services: {} })).toBe('');
    });

    it('handles single port', () => {
      expect(formatPorts({ ip: '192.168.2.1', openPorts: [3389], services: { 3389: 'RDP' } })).toBe('3389(RDP)');
    });
  });
});
