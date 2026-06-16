import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
      addMembership: vi.fn(),
      setMulticastTTL: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
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

import { discoverMDNS, groupMDNSByHost } from '../mdns-discovery';

/**
 * Build a minimal DNS response with a PTR answer record.
 * Format: DNS header (12 bytes) + question section + answer section
 */
function buildDNSResponseWithPTR(): Buffer {
  // DNS Header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);     // ID
  header.writeUInt16BE(0x8400, 2); // Flags: response, authoritative
  header.writeUInt16BE(0, 4);     // QDCOUNT = 0 (no questions)
  header.writeUInt16BE(1, 6);     // ANCOUNT = 1 (one answer)
  header.writeUInt16BE(0, 8);     // NSCOUNT = 0
  header.writeUInt16BE(0, 10);    // ARCOUNT = 0

  // Answer: PTR record for "_http._tcp.local" -> "MyServer._http._tcp.local"
  // Name: _http._tcp.local (encoded as DNS labels)
  const name = encodeDNSName('_http._tcp.local');
  
  // TYPE = PTR (12), CLASS = IN (1), TTL = 120, RDLENGTH = variable
  const typeClassTTL = Buffer.alloc(8);
  typeClassTTL.writeUInt16BE(12, 0);  // TYPE = PTR
  typeClassTTL.writeUInt16BE(1, 2);   // CLASS = IN
  typeClassTTL.writeUInt32BE(120, 4); // TTL = 120

  // RDATA: the PTR target name
  const ptrTarget = encodeDNSName('MyServer._http._tcp.local');
  
  const rdLength = Buffer.alloc(2);
  rdLength.writeUInt16BE(ptrTarget.length, 0);

  return Buffer.concat([header, name, typeClassTTL, rdLength, ptrTarget]);
}

/**
 * Build DNS response with PTR + A record
 */
function buildDNSResponseWithPTRAndA(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);     // QDCOUNT = 0
  header.writeUInt16BE(2, 6);     // ANCOUNT = 2 (PTR + A)
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  // Answer 1: PTR record
  const ptrName = encodeDNSName('_http._tcp.local');
  const ptrTypeClass = Buffer.alloc(8);
  ptrTypeClass.writeUInt16BE(12, 0); // PTR
  ptrTypeClass.writeUInt16BE(1, 2);
  ptrTypeClass.writeUInt32BE(120, 4);
  const ptrTarget = encodeDNSName('WebServer._http._tcp.local');
  const ptrRdLen = Buffer.alloc(2);
  ptrRdLen.writeUInt16BE(ptrTarget.length, 0);

  // Answer 2: A record for myhost.local -> 192.168.2.50
  const aName = encodeDNSName('myhost.local');
  const aTypeClass = Buffer.alloc(8);
  aTypeClass.writeUInt16BE(1, 0);  // A record
  aTypeClass.writeUInt16BE(1, 2);
  aTypeClass.writeUInt32BE(120, 4);
  const aRdLen = Buffer.alloc(2);
  aRdLen.writeUInt16BE(4, 0);
  const aData = Buffer.from([192, 168, 2, 50]);

  return Buffer.concat([
    header,
    ptrName, ptrTypeClass, ptrRdLen, ptrTarget,
    aName, aTypeClass, aRdLen, aData,
  ]);
}

/**
 * Build DNS response with SRV record
 */
function buildDNSResponseWithSRV(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(2, 6);     // ANCOUNT = 2 (PTR + SRV)
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  // PTR record
  const ptrName = encodeDNSName('_ssh._tcp.local');
  const ptrTypeClass = Buffer.alloc(8);
  ptrTypeClass.writeUInt16BE(12, 0);
  ptrTypeClass.writeUInt16BE(1, 2);
  ptrTypeClass.writeUInt32BE(120, 4);
  const ptrTarget = encodeDNSName('mybox._ssh._tcp.local');
  const ptrRdLen = Buffer.alloc(2);
  ptrRdLen.writeUInt16BE(ptrTarget.length, 0);

  // SRV record: priority(2) + weight(2) + port(2) + target name
  const srvName = encodeDNSName('mybox._ssh._tcp.local');
  const srvTypeClass = Buffer.alloc(8);
  srvTypeClass.writeUInt16BE(33, 0); // SRV
  srvTypeClass.writeUInt16BE(1, 2);
  srvTypeClass.writeUInt32BE(120, 4);
  const srvRdata = Buffer.alloc(6);
  srvRdata.writeUInt16BE(0, 0);    // priority
  srvRdata.writeUInt16BE(0, 2);    // weight
  srvRdata.writeUInt16BE(22, 4);   // port = 22
  const srvTarget = encodeDNSName('mybox.local');
  const srvRdLen = Buffer.alloc(2);
  srvRdLen.writeUInt16BE(srvRdata.length + srvTarget.length, 0);

  return Buffer.concat([
    header,
    ptrName, ptrTypeClass, ptrRdLen, ptrTarget,
    srvName, srvTypeClass, srvRdLen, srvRdata, srvTarget,
  ]);
}

function encodeDNSName(name: string): Buffer {
  const parts = name.split('.');
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const len = Buffer.alloc(1);
    len.writeUInt8(part.length);
    buffers.push(len, Buffer.from(part, 'utf-8'));
  }
  buffers.push(Buffer.alloc(1)); // Root label
  return Buffer.concat(buffers);
}

describe('mdns-discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('discoverMDNS', () => {
    it('sends queries and resolves after duration', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockSocket.send).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(Array.isArray(services)).toBe(true);
    });

    it('handles socket error gracefully', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);
      mockSocket._emit('error', new Error('Network error'));
      const services = await promise;
      expect(services).toEqual([]);
    });

    it('ignores messages shorter than 12 bytes', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);
      mockSocket._emit('message', Buffer.alloc(5), { address: '192.168.2.50', port: 5353 });
      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(0);
    });

    it('ignores messages with zero answers', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);
      const header = Buffer.alloc(12);
      header.writeUInt16BE(0, 6); // ANCOUNT = 0
      mockSocket._emit('message', header, { address: '192.168.2.50', port: 5353 });
      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(0);
    });

    it('parses PTR record from DNS response', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);

      const packet = buildDNSResponseWithPTR();
      mockSocket._emit('message', packet, { address: '192.168.2.50', port: 5353 });

      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(1);
      expect(services[0].ip).toBe('192.168.2.50');
      expect(services[0].serviceType).toBe('_http._tcp.local');
    });

    it('parses PTR + A records and sets hostname', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);

      const packet = buildDNSResponseWithPTRAndA();
      mockSocket._emit('message', packet, { address: '192.168.2.50', port: 5353 });

      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(1);
      expect(services[0].hostname).toBe('myhost.local');
    });

    it('parses SRV record and sets port', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);

      const packet = buildDNSResponseWithSRV();
      mockSocket._emit('message', packet, { address: '192.168.2.50', port: 5353 });

      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(1);
      expect(services[0].port).toBe(22);
    });

    it('deduplicates services by IP + type + name', async () => {
      const promise = discoverMDNS(2000);
      await vi.advanceTimersByTimeAsync(10);

      const packet = buildDNSResponseWithPTR();
      // Send same packet twice
      mockSocket._emit('message', packet, { address: '192.168.2.50', port: 5353 });
      mockSocket._emit('message', packet, { address: '192.168.2.50', port: 5353 });

      await vi.advanceTimersByTimeAsync(3000);
      const services = await promise;
      expect(services).toHaveLength(1);
    });
  });

  describe('groupMDNSByHost', () => {
    it('groups services by IP', () => {
      const services = [
        { ip: '192.168.2.50', hostname: 'macbook.local', serviceType: '_http._tcp.local', serviceName: 'Web Server', port: 80, txt: {} },
        { ip: '192.168.2.50', hostname: 'macbook.local', serviceType: '_ssh._tcp.local', serviceName: null, port: 22, txt: {} },
        { ip: '192.168.2.100', hostname: 'printer.local', serviceType: '_ipp._tcp.local', serviceName: 'HP Printer', port: 631, txt: {} },
      ];

      const grouped = groupMDNSByHost(services);
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['192.168.2.50'].hostname).toBe('macbook.local');
      expect(grouped['192.168.2.50'].services).toHaveLength(2);
      expect(grouped['192.168.2.100'].services).toHaveLength(1);
    });

    it('uses hostname from first service if null in subsequent', () => {
      const services = [
        { ip: '192.168.2.50', hostname: null, serviceType: '_http._tcp.local', serviceName: null, port: 80, txt: {} },
        { ip: '192.168.2.50', hostname: 'found-later.local', serviceType: '_ssh._tcp.local', serviceName: null, port: 22, txt: {} },
      ];

      const grouped = groupMDNSByHost(services);
      expect(grouped['192.168.2.50'].hostname).toBe('found-later.local');
    });

    it('formats service labels with names', () => {
      const services = [
        { ip: '192.168.2.50', hostname: null, serviceType: '_http._tcp.local', serviceName: 'My Web', port: 80, txt: {} },
      ];

      const grouped = groupMDNSByHost(services);
      expect(grouped['192.168.2.50'].services[0]).toBe('http: My Web');
    });

    it('formats service labels without names', () => {
      const services = [
        { ip: '192.168.2.50', hostname: null, serviceType: '_ssh._tcp.local', serviceName: null, port: 22, txt: {} },
      ];

      const grouped = groupMDNSByHost(services);
      expect(grouped['192.168.2.50'].services[0]).toBe('ssh');
    });
  });
});
