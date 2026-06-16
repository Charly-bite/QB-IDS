/**
 * SSDP/UPnP Discovery — finds UPnP-enabled devices on the network.
 * Discovers smart TVs, media players, routers, NAS, printers, IoT devices.
 */

import * as dgram from 'dgram';

export interface SSDPDevice {
  ip: string;
  port: number;
  server: string | null;
  location: string | null;
  st: string | null;         // Search Target (device type)
  usn: string | null;        // Unique Service Name
  friendlyName: string | null;
}

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;

const M_SEARCH = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 3',
  'ST: ssdp:all',
  '',
  '',
].join('\r\n');

/**
 * Parse an SSDP response into structured data.
 */
function parseSSDPResponse(msg: string, rinfo: { address: string; port: number }): SSDPDevice | null {
  const headers: Record<string, string> = {};

  const lines = msg.split('\r\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  if (!headers['st'] && !headers['nt'] && !headers['server']) return null;

  return {
    ip: rinfo.address,
    port: rinfo.port,
    server: headers['server'] || null,
    location: headers['location'] || null,
    st: headers['st'] || headers['nt'] || null,
    usn: headers['usn'] || null,
    friendlyName: null, // Will be enriched later from the location URL
  };
}

/**
 * Discover UPnP devices on the local network.
 * Sends M-SEARCH multicast and collects responses for `durationMs`.
 */
export function discoverSSDP(durationMs: number = 5000): Promise<SSDPDevice[]> {
  return new Promise((resolve) => {
    const devices: SSDPDevice[] = [];
    const seen = new Set<string>();

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg, rinfo) => {
      try {
        const device = parseSSDPResponse(msg.toString(), rinfo);
        if (device) {
          // Deduplicate by IP + USN
          const key = `${device.ip}:${device.usn || device.st}`;
          if (!seen.has(key)) {
            seen.add(key);
            devices.push(device);
          }
        }
      } catch { /* ignore malformed */ }
    });

    socket.on('error', () => {
      socket.close();
      resolve(devices);
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(4);

        const buf = Buffer.from(M_SEARCH, 'utf-8');
        socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_MULTICAST);

        // Send twice for reliability
        setTimeout(() => {
          socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_MULTICAST);
        }, 500);

      } catch { /* ignore */ }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve(devices);
    }, durationMs);
  });
}

/**
 * Group SSDP devices by IP and extract the most useful info per host.
 */
export function groupSSDPByHost(devices: SSDPDevice[]): Record<string, {
  server: string | null;
  types: string[];
  location: string | null;
}> {
  const grouped: Record<string, { server: string | null; types: Set<string>; location: string | null }> = {};

  for (const d of devices) {
    if (!grouped[d.ip]) {
      grouped[d.ip] = { server: d.server, types: new Set(), location: d.location };
    }
    if (d.st) grouped[d.ip].types.add(d.st);
    if (d.server && !grouped[d.ip].server) grouped[d.ip].server = d.server;
    if (d.location && !grouped[d.ip].location) grouped[d.ip].location = d.location;
  }

  const result: Record<string, { server: string | null; types: string[]; location: string | null }> = {};
  for (const [ip, data] of Object.entries(grouped)) {
    result[ip] = { server: data.server, types: Array.from(data.types), location: data.location };
  }
  return result;
}
