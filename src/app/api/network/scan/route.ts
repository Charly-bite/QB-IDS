import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { upsertDevice, recordScan, initDatabase } from '@/lib/db';
import { lookupVendor } from '@/lib/oui-lookup';
import { scanHosts } from '@/lib/port-scan';
import { classifyDevice } from '@/lib/device-classifier';
import { queryNetBIOSBatch } from '@/lib/netbios-scan';
import { enumSharesBatch } from '@/lib/smb-scan';
import { probeHTTPBatch } from '@/lib/http-probe';
import { setScanProgress } from '@/lib/scan-progress';
import { grabBannersBatch } from '@/lib/banner-grab';
import { probeSSLBatch } from '@/lib/ssl-probe';
import { discoverSSDP, groupSSDPByHost } from '@/lib/ssdp-discovery';
import { discoverMDNS, groupMDNSByHost } from '@/lib/mdns-discovery';

const execAsync = promisify(exec);

// Ping host with -a flag to resolve hostname + capture TTL
async function pingHost(ip: string): Promise<{
  ip: string;
  status: 'Online' | 'Offline';
  latency: number;
  hostname: string | null;
  ttl: number | null;
}> {
  try {
    const { stdout, stderr } = await execAsync(`ping -a -n 1 -w 1500 ${ip}`, { timeout: 8000 });
    const output = stdout + (stderr || '');
    
    const failPatterns = ['unreachable', 'inalcanzable', 'timed out', 'agot', 'could not find', 'perdidos = 1', '(100%'];
    const failed = failPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()));
    
    if (failed) return { ip, status: 'Offline', latency: 0, hostname: null, ttl: null };

    let latency = 0;
    const timeMatch = output.match(/(?:time|tiempo)[=<]([0-9]+)\s*m/i);
    if (timeMatch && timeMatch[1]) latency = parseInt(timeMatch[1], 10);

    // Extract hostname
    let hostname: string | null = null;
    const nameMatch = output.match(/(?:Pinging|Haciendo ping a)\s+(\S+)\s+\[/i);
    if (nameMatch && nameMatch[1] && nameMatch[1] !== ip) {
      hostname = nameMatch[1];
    }

    // Extract TTL
    let ttl: number | null = null;
    const ttlMatch = output.match(/TTL[=:](\d+)/i);
    if (ttlMatch && ttlMatch[1]) ttl = parseInt(ttlMatch[1], 10);

    return { ip, status: 'Online', latency, hostname, ttl };
  } catch {
    return { ip, status: 'Offline', latency: 0, hostname: null, ttl: null };
  }
}

// DNS reverse lookup via nslookup (fallback for ping -a)
async function dnsReverseLookup(ip: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`nslookup ${ip}`, { timeout: 5000 });
    // Look for "Name: xxx" or "Nombre: xxx" in the output
    const nameMatch = stdout.match(/(?:Name|Nombre)\s*:\s*(\S+)/i);
    if (nameMatch && nameMatch[1] && !nameMatch[1].includes('in-addr.arpa')) {
      return nameMatch[1];
    }
  } catch { /* ignore */ }
  return null;
}

// Get all MAC addresses from the ARP table
async function getArpTable(): Promise<Record<string, string>> {
  const macs: Record<string, string> = {};
  try {
    const { stdout } = await execAsync('arp -a', { timeout: 5000 });
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})/);
      if (match && match[1] && match[2]) {
        macs[match[1]] = match[2].toUpperCase();
      }
    }
  } catch { /* ignore */ }
  return macs;
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subnet = searchParams.get('subnet');
    const deep = searchParams.get('deep') !== 'false'; // Deep scan by default

    if (!subnet || !subnet.match(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/)) {
      return NextResponse.json({ error: 'Invalid subnet. Expected e.g. 192.168.2' }, { status: 400 });
    }

    setScanProgress({ phase: 'Initializing', percent: 0, detail: '', running: true });

    // Ensure DB is ready
    await initDatabase();

    // Build IP list
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) ips.push(`${subnet}.${i}`);

    // ═══════════════════════════════════════════
    // PHASE 1: Ping Sweep + Hostname + TTL
    // ═══════════════════════════════════════════
    setScanProgress({ phase: 'Ping Sweep', percent: 5, detail: 'Scanning 254 hosts...', running: true });
    console.log(`[Scan] Phase 1: Ping sweep on ${subnet}.0/24...`);
    
    const pingResults: { ip: string; status: 'Online' | 'Offline'; latency: number; hostname: string | null; ttl: number | null }[] = [];
    const chunkSize = 30;
    for (let i = 0; i < ips.length; i += chunkSize) {
      const chunk = ips.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(pingHost));
      pingResults.push(...chunkResults);
      setScanProgress({ percent: Math.round(5 + (i / ips.length) * 30), detail: `${Math.min(i + chunkSize, 254)}/254 hosts pinged` });
    }

    const onlineHosts = pingResults.filter(r => r.status === 'Online');
    console.log(`[Scan] Phase 1 done: ${onlineHosts.length} online hosts`);

    // DNS enrichment — resolve hostnames for hosts that ping -a didn't catch
    if (deep) {
      const unresolvedHosts = onlineHosts.filter(h => !h.hostname);
      if (unresolvedHosts.length > 0) {
        setScanProgress({ phase: 'DNS Lookup', percent: 37, detail: `Resolving ${unresolvedHosts.length} hostnames...`, running: true });
        console.log(`[Scan] DNS enrichment: ${unresolvedHosts.length} hosts need reverse lookup...`);
        
        const batchSize = 20;
        let resolved = 0;
        for (let i = 0; i < unresolvedHosts.length; i += batchSize) {
          const batch = unresolvedHosts.slice(i, i + batchSize);
          const results = await Promise.all(batch.map(h => dnsReverseLookup(h.ip)));
          for (let j = 0; j < batch.length; j++) {
            if (results[j]) {
              batch[j].hostname = results[j];
              resolved++;
            }
          }
        }
        console.log(`[Scan] DNS enrichment done: resolved ${resolved}/${unresolvedHosts.length} hostnames`);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 2: ARP Harvest + MAC Vendor Lookup
    // ═══════════════════════════════════════════
    setScanProgress({ phase: 'MAC Lookup', percent: 40, detail: 'Reading ARP table + vendor lookup...', running: true });
    console.log(`[Scan] Phase 2: ARP + OUI lookup...`);
    
    const arpTable = await getArpTable();
    const vendorMap: Record<string, string | null> = {};
    for (const host of onlineHosts) {
      const mac = arpTable[host.ip];
      vendorMap[host.ip] = mac ? lookupVendor(mac) : null;
    }
    const vendorsFound = Object.values(vendorMap).filter(v => v !== null).length;
    console.log(`[Scan] Phase 2 done: ${Object.keys(arpTable).length} MACs, ${vendorsFound} vendors identified`);

    // ═══════════════════════════════════════════
    // PHASE 3: Port Scanning (if deep scan)
    // ═══════════════════════════════════════════
    let portResults: Record<string, { openPorts: number[]; services: Record<number, string> }> = {};
    
    if (deep && onlineHosts.length > 0) {
      setScanProgress({ phase: 'Port Scan', percent: 45, detail: `Scanning ${onlineHosts.length} hosts × 20 ports...`, running: true });
      console.log(`[Scan] Phase 3: Port scan on ${onlineHosts.length} hosts...`);
      
      const onlineIps = onlineHosts.map(h => h.ip);
      const scanResults = await scanHosts(onlineIps, 10, (done, total) => {
        setScanProgress({ percent: Math.round(45 + (done / total) * 35), detail: `${done}/${total} hosts scanned` });
      });
      
      for (const r of scanResults) {
        portResults[r.ip] = { openPorts: r.openPorts, services: r.services };
      }
      
      const withPorts = scanResults.filter(r => r.openPorts.length > 0).length;
      console.log(`[Scan] Phase 3 done: ${withPorts}/${onlineHosts.length} hosts have open ports`);
    }

    // ═══════════════════════════════════════════
    // PHASE 4: NetBIOS Enumeration
    // ═══════════════════════════════════════════
    const netbiosMap: Record<string, { computerName: string | null; domain: string | null; isFileServer: boolean }> = {};
    if (deep && onlineHosts.length > 0) {
      setScanProgress({ phase: 'NetBIOS', percent: 82, detail: `Querying ${onlineHosts.length} hosts...`, running: true });
      console.log(`[Scan] Phase 4: NetBIOS enumeration...`);
      
      const windowsHosts = onlineHosts.filter(h => {
        const ports = portResults[h.ip]?.openPorts || [];
        return ports.includes(139) || ports.includes(445) || (h.ttl !== null && h.ttl >= 120 && h.ttl <= 128);
      });
      
      if (windowsHosts.length > 0) {
        const nbResults = await queryNetBIOSBatch(
          windowsHosts.map(h => h.ip), 10,
          (done, total) => { setScanProgress({ detail: `${done}/${total} NetBIOS queries` }); }
        );
        for (const r of nbResults) {
          netbiosMap[r.ip] = { computerName: r.computerName, domain: r.domain, isFileServer: r.isFileServer };
          // Use NetBIOS MAC as backup
          if (r.mac && !arpTable[r.ip]) arpTable[r.ip] = r.mac;
        }
      }
      console.log(`[Scan] Phase 4 done: ${Object.values(netbiosMap).filter(n => n.computerName).length} NetBIOS names resolved`);
    }

    // ═══════════════════════════════════════════
    // PHASE 5: Shared Folder Discovery
    // ═══════════════════════════════════════════
    const sharesMap: Record<string, string> = {}; // IP -> JSON string of shares
    if (deep) {
      const smbHosts = onlineHosts.filter(h => {
        const ports = portResults[h.ip]?.openPorts || [];
        return ports.includes(445) || netbiosMap[h.ip]?.isFileServer;
      });
      
      if (smbHosts.length > 0) {
        setScanProgress({ phase: 'Shares', percent: 87, detail: `Scanning ${smbHosts.length} SMB hosts...`, running: true });
        console.log(`[Scan] Phase 5: SMB share discovery on ${smbHosts.length} hosts...`);
        
        const smbResults = await enumSharesBatch(
          smbHosts.map(h => h.ip), 5,
          (done, total) => { setScanProgress({ detail: `${done}/${total} hosts checked` }); }
        );
        for (const r of smbResults) {
          if (r.shares.length > 0) {
            sharesMap[r.ip] = JSON.stringify(r.shares);
          }
        }
        console.log(`[Scan] Phase 5 done: ${Object.keys(sharesMap).length} hosts with shared folders`);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 6: HTTP Banner Grabbing
    // ═══════════════════════════════════════════
    const httpMap: Record<string, { title: string | null; server: string | null }> = {};
    if (deep) {
      const httpHosts = onlineHosts.filter(h => {
        const ports = portResults[h.ip]?.openPorts || [];
        return ports.includes(80) || ports.includes(443) || ports.includes(8080) || ports.includes(8443);
      });
      
      if (httpHosts.length > 0) {
        setScanProgress({ phase: 'HTTP Probe', percent: 91, detail: `Grabbing banners from ${httpHosts.length} web hosts...`, running: true });
        console.log(`[Scan] Phase 6: HTTP banner grab on ${httpHosts.length} hosts...`);
        
        const httpResults = await probeHTTPBatch(
          httpHosts.map(h => ({ ip: h.ip, openPorts: portResults[h.ip]?.openPorts || [] })), 15,
          (done, total) => { setScanProgress({ detail: `${done}/${total} web hosts probed` }); }
        );
        for (const r of httpResults) {
          if (r.httpTitle || r.httpServer) {
            httpMap[r.ip] = { title: r.httpTitle, server: r.httpServer };
          }
        }
        console.log(`[Scan] Phase 6 done: ${Object.keys(httpMap).length} HTTP banners captured`);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 7: TCP Banner Grabbing
    // ═══════════════════════════════════════════
    const bannersMap: Record<string, string> = {}; // IP -> JSON banners
    if (deep) {
      const bannerHosts = onlineHosts.filter(h => {
        const ports = portResults[h.ip]?.openPorts || [];
        return ports.some(p => [21, 22, 23, 25, 110, 143, 587, 3306, 5432].includes(p));
      });

      if (bannerHosts.length > 0) {
        setScanProgress({ phase: 'Banners', percent: 88, detail: `Grabbing ${bannerHosts.length} service banners...`, running: true });
        console.log(`[Scan] Phase 7: TCP banner grab on ${bannerHosts.length} hosts...`);

        const bannerResults = await grabBannersBatch(
          bannerHosts.map(h => ({ ip: h.ip, openPorts: portResults[h.ip]?.openPorts || [] })), 5,
          (done, total) => { setScanProgress({ detail: `${done}/${total} hosts probed` }); }
        );
        for (const [ip, banners] of Object.entries(bannerResults)) {
          bannersMap[ip] = JSON.stringify(banners.map(b => ({ port: b.port, service: b.service, banner: b.banner })));
        }
        console.log(`[Scan] Phase 7 done: ${Object.keys(bannersMap).length} hosts with banners`);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 8: SSL Certificate Analysis
    // ═══════════════════════════════════════════
    const sslMap: Record<string, { subject: string | null; issuer: string | null; expiry: string | null; selfSigned: boolean }> = {};
    if (deep) {
      const sslHosts = onlineHosts.filter(h => {
        const ports = portResults[h.ip]?.openPorts || [];
        return ports.includes(443) || ports.includes(8443);
      });

      if (sslHosts.length > 0) {
        setScanProgress({ phase: 'SSL Certs', percent: 90, detail: `Analyzing ${sslHosts.length} SSL certificates...`, running: true });
        console.log(`[Scan] Phase 8: SSL cert analysis on ${sslHosts.length} hosts...`);

        const sslResults = await probeSSLBatch(
          sslHosts.map(h => ({
            ip: h.ip,
            ports: (portResults[h.ip]?.openPorts || []).filter(p => [443, 8443].includes(p)),
          })), 10,
          (done, total) => { setScanProgress({ detail: `${done}/${total} certs analyzed` }); }
        );
        for (const r of sslResults) {
          if (r.accessible) {
            sslMap[r.ip] = {
              subject: r.subject,
              issuer: r.issuer,
              expiry: r.validTo,
              selfSigned: r.selfSigned,
            };
          }
        }
        console.log(`[Scan] Phase 8 done: ${Object.keys(sslMap).length} SSL certs captured`);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 9: SSDP/UPnP Discovery
    // ═══════════════════════════════════════════
    const ssdpMap: Record<string, string> = {}; // IP -> SSDP server name
    if (deep) {
      setScanProgress({ phase: 'UPnP/SSDP', percent: 92, detail: 'Discovering UPnP devices...', running: true });
      console.log(`[Scan] Phase 9: SSDP/UPnP discovery...`);

      try {
        const ssdpDevices = await discoverSSDP(4000);
        const grouped = groupSSDPByHost(ssdpDevices);
        for (const [ip, data] of Object.entries(grouped)) {
          if (data.server) ssdpMap[ip] = data.server;
        }
        console.log(`[Scan] Phase 9 done: ${Object.keys(ssdpMap).length} UPnP devices found`);
      } catch (e) {
        console.log(`[Scan] Phase 9 error:`, e);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 10: mDNS/Bonjour Discovery
    // ═══════════════════════════════════════════
    const mdnsMap: Record<string, string> = {}; // IP -> JSON services
    if (deep) {
      setScanProgress({ phase: 'mDNS/Bonjour', percent: 94, detail: 'Discovering Bonjour services...', running: true });
      console.log(`[Scan] Phase 10: mDNS/Bonjour discovery...`);

      try {
        const mdnsServices = await discoverMDNS(4000);
        const grouped = groupMDNSByHost(mdnsServices);
        for (const [ip, data] of Object.entries(grouped)) {
          mdnsMap[ip] = JSON.stringify(data.services);
        }
        console.log(`[Scan] Phase 10 done: ${Object.keys(mdnsMap).length} mDNS hosts found`);
      } catch (e) {
        console.log(`[Scan] Phase 10 error:`, e);
      }
    }

    // ═══════════════════════════════════════════
    // PHASE 11: Device Classification (enhanced)
    // ═══════════════════════════════════════════
    setScanProgress({ phase: 'Classifying', percent: 96, detail: 'Identifying device types...', running: true });
    console.log(`[Scan] Phase 11: Classifying devices...`);
    
    const classifications: Record<string, { deviceType: string; osFingerprint: string | null }> = {};
    for (const host of onlineHosts) {
      const ports = portResults[host.ip]?.openPorts || [];
      const mac = arpTable[host.ip] || null;
      const http = httpMap[host.ip];
      const result = classifyDevice({
        openPorts: ports,
        ttl: host.ttl,
        vendor: vendorMap[host.ip] || null,
        hostname: netbiosMap[host.ip]?.computerName || host.hostname,
        mac: mac,
        httpTitle: http?.title || null,
        httpServer: http?.server || null,
      });
      classifications[host.ip] = { deviceType: result.deviceType, osFingerprint: result.osFingerprint };
    }

    // ═══════════════════════════════════════════
    // PHASE 12: Persist to Database
    // ═══════════════════════════════════════════
    setScanProgress({ phase: 'Saving', percent: 98, detail: 'Persisting to database...', running: true });
    console.log(`[Scan] Phase 12: Saving to database...`);
    
    for (const host of onlineHosts) {
      const mac = arpTable[host.ip] || null;
      const vendor = vendorMap[host.ip] || null;
      const ports = portResults[host.ip]?.openPorts;
      const portsStr = ports && ports.length > 0 ? ports.join(',') : null;
      const classification = classifications[host.ip];
      const nb = netbiosMap[host.ip];
      const http = httpMap[host.ip];
      const ssl = sslMap[host.ip];

      await upsertDevice(
        host.ip,
        host.status,
        host.latency,
        subnet,
        host.hostname,
        mac,
        vendor,
        portsStr,
        classification?.osFingerprint || null,
        host.ttl,
        classification?.deviceType || null,
        nb?.computerName || null,
        nb?.domain || null,
        sharesMap[host.ip] || null,
        http?.title || null,
        http?.server || null,
        bannersMap[host.ip] || null,
        ssl?.subject || null,
        ssl?.issuer || null,
        ssl?.expiry || null,
        ssl?.selfSigned ?? null,
        ssdpMap[host.ip] || null,
        mdnsMap[host.ip] || null,
      );
    }

    // Record scan
    await recordScan(subnet, onlineHosts.length);

    setScanProgress({ phase: 'Complete', percent: 100, detail: 'Scan finished!', running: false });
    console.log(`[Scan] All phases complete!`);

    // Build stats
    const typeCounts: Record<string, number> = {};
    for (const c of Object.values(classifications)) {
      typeCounts[c.deviceType] = (typeCounts[c.deviceType] || 0) + 1;
    }

    return NextResponse.json({
      subnet: `${subnet}.0/24`,
      scanned: 254,
      activeCount: onlineHosts.length,
      resolvedNames: onlineHosts.filter(r => r.hostname !== null).length,
      vendorsResolved: vendorsFound,
      portsScanned: deep,
      deviceTypes: typeCounts,
      activeHosts: onlineHosts.map(h => ({
        ip: h.ip,
        latency: h.latency,
        hostname: h.hostname,
        ttl: h.ttl,
        mac: arpTable[h.ip] || null,
        vendor: vendorMap[h.ip] || null,
        openPorts: portResults[h.ip]?.openPorts || [],
        deviceType: classifications[h.ip]?.deviceType || 'other',
        os: classifications[h.ip]?.osFingerprint || null,
      })),
    });
  } catch (error: unknown) {
    setScanProgress({ phase: 'Error', percent: 0, detail: '', running: false });
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /network/scan] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
