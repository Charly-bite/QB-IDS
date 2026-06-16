/**
 * mDNS/Bonjour Discovery — discovers devices advertising via Multicast DNS.
 * Finds Apple devices, Chromecast, printers, SSH servers, etc.
 */

import * as dgram from 'dgram';

export interface MDNSService {
  ip: string;
  hostname: string | null;
  serviceType: string;
  serviceName: string | null;
  port: number | null;
  txt: Record<string, string>;
}

const MDNS_MULTICAST = '224.0.0.251';
const MDNS_PORT = 5353;

// Service types to query
const SERVICE_TYPES = [
  '_http._tcp.local',
  '_https._tcp.local',
  '_ssh._tcp.local',
  '_smb._tcp.local',
  '_ipp._tcp.local',           // Printers
  '_printer._tcp.local',
  '_airplay._tcp.local',       // Apple TV
  '_raop._tcp.local',          // AirPlay Audio
  '_googlecast._tcp.local',    // Chromecast
  '_homekit._tcp.local',       // HomeKit
  '_hap._tcp.local',           // HomeKit Accessory Protocol
  '_workstation._tcp.local',
  '_device-info._tcp.local',
  '_companion-link._tcp.local', // Apple devices
  '_rdp._tcp.local',           // Remote Desktop
  '_ftp._tcp.local',
];

/**
 * Build a DNS query packet for a service type.
 * Simplified DNS packet construction.
 */
function buildMDNSQuery(serviceType: string): Buffer {
  const parts = serviceType.split('.');
  const labels: Buffer[] = [];

  for (const part of parts) {
    const len = Buffer.alloc(1);
    len.writeUInt8(part.length);
    labels.push(len);
    labels.push(Buffer.from(part, 'utf-8'));
  }
  labels.push(Buffer.alloc(1)); // Root label

  // DNS Header: ID=0, Flags=0 (standard query), QDCOUNT=1
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);    // ID
  header.writeUInt16BE(0, 2);    // Flags
  header.writeUInt16BE(1, 4);    // Questions
  header.writeUInt16BE(0, 6);    // Answers
  header.writeUInt16BE(0, 8);    // Authority
  header.writeUInt16BE(0, 10);   // Additional

  // Question: name + QTYPE(PTR=12) + QCLASS(IN=1)
  const qtype = Buffer.alloc(4);
  qtype.writeUInt16BE(12, 0);    // PTR
  qtype.writeUInt16BE(1, 2);     // IN

  return Buffer.concat([header, ...labels, qtype]);
}

/**
 * Parse a DNS name from a buffer at a given offset.
 */
function parseDNSName(buf: Buffer, offset: number): { name: string; newOffset: number } {
  const parts: string[] = [];
  let currentOffset = offset;
  let jumped = false;
  let jumpOffset = 0;

  while (currentOffset < buf.length) {
    const len = buf.readUInt8(currentOffset);

    if (len === 0) {
      currentOffset++;
      break;
    }

    // Compression pointer
    if ((len & 0xC0) === 0xC0) {
      if (!jumped) jumpOffset = currentOffset + 2;
      jumped = true;
      currentOffset = ((len & 0x3F) << 8) | buf.readUInt8(currentOffset + 1);
      continue;
    }

    currentOffset++;
    if (currentOffset + len <= buf.length) {
      parts.push(buf.toString('utf-8', currentOffset, currentOffset + len));
    }
    currentOffset += len;
  }

  return {
    name: parts.join('.'),
    newOffset: jumped ? jumpOffset : currentOffset,
  };
}

/**
 * Discover mDNS services on the local network.
 */
export function discoverMDNS(durationMs: number = 5000): Promise<MDNSService[]> {
  return new Promise((resolve) => {
    const services: MDNSService[] = [];
    const seen = new Set<string>();

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg, rinfo) => {
      try {
        if (msg.length < 12) return;

        // Parse DNS response
        const ancount = msg.readUInt16BE(6);
        if (ancount === 0) return;

        // Skip questions
        let offset = 12;
        const qdcount = msg.readUInt16BE(4);
        for (let q = 0; q < qdcount; q++) {
          const { newOffset } = parseDNSName(msg, offset);
          offset = newOffset + 4; // Skip QTYPE + QCLASS
        }

        // Parse answers
        for (let a = 0; a < ancount + msg.readUInt16BE(8) + msg.readUInt16BE(10); a++) {
          if (offset >= msg.length) break;

          const { name, newOffset } = parseDNSName(msg, offset);
          offset = newOffset;

          if (offset + 10 > msg.length) break;

          const rtype = msg.readUInt16BE(offset);
          offset += 8; // Skip TYPE, CLASS, TTL
          const rdlen = msg.readUInt16BE(offset);
          offset += 2;

          if (offset + rdlen > msg.length) break;

          // PTR record — service discovery
          if (rtype === 12) {
            const { name: ptrName } = parseDNSName(msg, offset);
            const key = `${rinfo.address}:${name}:${ptrName}`;
            if (!seen.has(key)) {
              seen.add(key);
              services.push({
                ip: rinfo.address,
                hostname: null,
                serviceType: name,
                serviceName: ptrName.replace(`.${name}`, ''),
                port: null,
                txt: {},
              });
            }
          }

          // A record — IP address
          if (rtype === 1 && rdlen === 4) {
            // Associate with existing services from this host
            for (const svc of services) {
              if (svc.ip === rinfo.address && !svc.hostname) {
                svc.hostname = name;
              }
            }
          }

          // SRV record — port info
          if (rtype === 33 && rdlen >= 6) {
            const srvPort = msg.readUInt16BE(offset + 4);
            for (const svc of services) {
              if (svc.ip === rinfo.address && svc.port === null) {
                svc.port = srvPort;
              }
            }
          }

          offset += rdlen;
        }
      } catch { /* ignore malformed packets */ }
    });

    socket.on('error', () => {
      socket.close();
      resolve(services);
    });

    socket.bind(() => {
      try {
        socket.addMembership(MDNS_MULTICAST);
        socket.setMulticastTTL(255);

        // Send queries for all service types
        for (let i = 0; i < SERVICE_TYPES.length; i++) {
          setTimeout(() => {
            try {
              const query = buildMDNSQuery(SERVICE_TYPES[i]);
              socket.send(query, 0, query.length, MDNS_PORT, MDNS_MULTICAST);
            } catch { /* ignore */ }
          }, i * 100); // Stagger queries 100ms apart
        }
      } catch { /* ignore */ }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve(services);
    }, durationMs);
  });
}

/**
 * Group mDNS services by IP.
 */
export function groupMDNSByHost(services: MDNSService[]): Record<string, {
  hostname: string | null;
  services: string[];
}> {
  const grouped: Record<string, { hostname: string | null; services: Set<string> }> = {};

  for (const s of services) {
    if (!grouped[s.ip]) {
      grouped[s.ip] = { hostname: s.hostname, services: new Set() };
    }
    const label = s.serviceName
      ? `${s.serviceType.split('.')[0].replace('_', '')}: ${s.serviceName}`
      : s.serviceType.split('.')[0].replace('_', '');
    grouped[s.ip].services.add(label);
    if (s.hostname && !grouped[s.ip].hostname) grouped[s.ip].hostname = s.hostname;
  }

  const result: Record<string, { hostname: string | null; services: string[] }> = {};
  for (const [ip, data] of Object.entries(grouped)) {
    result[ip] = { hostname: data.hostname, services: Array.from(data.services) };
  }
  return result;
}
