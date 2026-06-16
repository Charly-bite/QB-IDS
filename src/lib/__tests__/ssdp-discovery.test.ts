import { describe, it, expect, vi, beforeEach } from 'vitest';

// dgram socket mock factory
const { createMockDgramSocket } = vi.hoisted(() => {
  const createMockDgramSocket = () => {
    const handlers: Record<string, Function[]> = {};
    return {
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return undefined;
      }),
      bind: vi.fn((cb: Function) => { setTimeout(() => cb(), 0); }),
      setBroadcast: vi.fn(),
      setMulticastTTL: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      // Helper to simulate incoming messages
      _emit: (event: string, ...args: unknown[]) => {
        handlers[event]?.forEach(h => h(...args));
      },
    };
  };
  return { createMockDgramSocket };
});

let mockSocket: ReturnType<typeof createMockDgramSocket>;

vi.mock('dgram', () => ({
  createSocket: vi.fn(() => {
    mockSocket = createMockDgramSocket();
    return mockSocket;
  }),
  default: {
    createSocket: vi.fn(() => {
      mockSocket = createMockDgramSocket();
      return mockSocket;
    }),
  },
}));

import { discoverSSDP, groupSSDPByHost } from '../ssdp-discovery';

describe('ssdp-discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('discoverSSDP', () => {
    it('discovers devices from SSDP responses', async () => {
      const promise = discoverSSDP(2000);

      // Advance timers to trigger bind callback
      await vi.advanceTimersByTimeAsync(10);

      // Simulate an SSDP response
      const ssdpResponse = [
        'HTTP/1.1 200 OK',
        'SERVER: Linux/3.0 UPnP/1.0 Synology/1.0',
        'LOCATION: http://192.168.2.50:5000/desc.xml',
        'ST: upnp:rootdevice',
        'USN: uuid:abc-123::upnp:rootdevice',
        '',
      ].join('\r\n');

      mockSocket._emit('message', Buffer.from(ssdpResponse), { address: '192.168.2.50', port: 1900 });

      // Advance past duration
      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;

      expect(devices).toHaveLength(1);
      expect(devices[0].ip).toBe('192.168.2.50');
      expect(devices[0].server).toBe('Linux/3.0 UPnP/1.0 Synology/1.0');
      expect(devices[0].st).toBe('upnp:rootdevice');
    });

    it('deduplicates by IP + USN', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      const response = 'ST: upnp:rootdevice\r\nUSN: uuid:same\r\nSERVER: Test\r\n';
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.50', port: 1900 });
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.50', port: 1900 });

      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;
      expect(devices).toHaveLength(1);
    });

    it('handles socket error gracefully', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      mockSocket._emit('error', new Error('Network error'));

      const devices = await promise;
      expect(devices).toEqual([]);
    });
  });

  describe('groupSSDPByHost', () => {
    it('groups devices by IP', () => {
      const devices = [
        { ip: '192.168.2.50', port: 1900, server: 'Synology', location: 'http://192.168.2.50/desc.xml', st: 'upnp:rootdevice', usn: 'uuid:1', friendlyName: null },
        { ip: '192.168.2.50', port: 1900, server: 'Synology', location: 'http://192.168.2.50/desc.xml', st: 'urn:schemas-upnp-org:device:MediaRenderer:1', usn: 'uuid:2', friendlyName: null },
        { ip: '192.168.2.100', port: 1900, server: 'SmartTV', location: null, st: 'upnp:rootdevice', usn: 'uuid:3', friendlyName: null },
      ];

      const grouped = groupSSDPByHost(devices);
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['192.168.2.50'].types).toHaveLength(2);
      expect(grouped['192.168.2.50'].server).toBe('Synology');
      expect(grouped['192.168.2.100'].server).toBe('SmartTV');
    });

    it('handles null st values', () => {
      const devices = [
        { ip: '192.168.2.50', port: 1900, server: 'Test', location: null, st: null, usn: null, friendlyName: null },
      ];
      const grouped = groupSSDPByHost(devices);
      expect(grouped['192.168.2.50'].types).toHaveLength(0);
    });

    it('deduplicates service types', () => {
      const devices = [
        { ip: '192.168.2.50', port: 1900, server: null, location: null, st: 'upnp:rootdevice', usn: 'uuid:1', friendlyName: null },
        { ip: '192.168.2.50', port: 1900, server: null, location: null, st: 'upnp:rootdevice', usn: 'uuid:2', friendlyName: null },
      ];
      const grouped = groupSSDPByHost(devices);
      expect(grouped['192.168.2.50'].types).toHaveLength(1);
    });

    it('enriches server and location from later devices', () => {
      const devices = [
        { ip: '192.168.2.50', port: 1900, server: null, location: null, st: 'upnp:rootdevice', usn: 'uuid:1', friendlyName: null },
        { ip: '192.168.2.50', port: 1900, server: 'Synology', location: 'http://192.168.2.50/desc.xml', st: 'urn:media', usn: 'uuid:2', friendlyName: null },
      ];
      const grouped = groupSSDPByHost(devices);
      expect(grouped['192.168.2.50'].server).toBe('Synology');
      expect(grouped['192.168.2.50'].location).toBe('http://192.168.2.50/desc.xml');
    });
  });

  describe('discoverSSDP edge cases', () => {
    it('ignores responses without ST, NT, or SERVER headers', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      mockSocket._emit('message', Buffer.from('HTTP/1.1 200 OK\r\n\r\n'), { address: '192.168.2.50', port: 1900 });
      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;
      expect(devices).toHaveLength(0);
    });

    it('parses NT header when ST is missing', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      const response = 'NT: upnp:rootdevice\r\nSERVER: Test\r\nUSN: uuid:abc\r\n';
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.50', port: 1900 });
      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;
      expect(devices).toHaveLength(1);
      expect(devices[0].st).toBe('upnp:rootdevice');
    });

    it('deduplicates by ST when USN is null', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      const response = 'ST: upnp:rootdevice\r\nSERVER: Test\r\n';
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.50', port: 1900 });
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.50', port: 1900 });
      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;
      expect(devices).toHaveLength(1);
    });

    it('parses response with server-only header', async () => {
      const promise = discoverSSDP(2000);
      await vi.advanceTimersByTimeAsync(10);

      const response = 'SERVER: MiniUPnP/2.0\r\nLOCATION: http://192.168.2.1:5000/desc.xml\r\n';
      mockSocket._emit('message', Buffer.from(response), { address: '192.168.2.1', port: 1900 });
      await vi.advanceTimersByTimeAsync(3000);
      const devices = await promise;
      expect(devices).toHaveLength(1);
      expect(devices[0].server).toBe('MiniUPnP/2.0');
      expect(devices[0].location).toBe('http://192.168.2.1:5000/desc.xml');
    });
  });
});
