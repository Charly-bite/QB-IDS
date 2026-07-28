import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getDevices as getLibreNMSDevices, type LibreNMSDevice } from '@/lib/librenms-api';
import {
  getDevices as getNetBoxDevices,
  createDevice,
  getDeviceRoles,
  getDeviceTypes,
  getSites,
  getManufacturers,
  createIPAddress,
} from '@/lib/netbox-api';

/**
 * POST /api/netbox/sync — Sync LibreNMS devices into NetBox
 * 
 * Steps:
 * 1. Fetch all devices from LibreNMS
 * 2. Fetch existing devices from NetBox
 * 3. Ensure required device type, role, site, and manufacturer exist (create if missing)
 * 4. For each LibreNMS device not in NetBox, create it
 * 5. Return sync results
 */
export async function POST(request: Request) {
  try {
    // Check if force re-sync requested
    let force = false;
    let rolesFilter: string[] | undefined = undefined;
    let osFilter: string[] | undefined = undefined;
    try {
      const body = await request.json();
      force = body?.force === true;
      rolesFilter = body?.roles;
      osFilter = body?.os;
    } catch { /* no body = normal sync */ }

    // 1. Fetch LibreNMS devices
    const lnmsResult = await getLibreNMSDevices();
    if (lnmsResult.error) {
      return NextResponse.json({ error: `LibreNMS error: ${lnmsResult.error}` }, { status: 502 });
    }

    const lnmsDevices: LibreNMSDevice[] = (lnmsResult.data as { devices?: LibreNMSDevice[] })?.devices || [];
    if (lnmsDevices.length === 0) {
      return NextResponse.json({ error: 'No devices found in LibreNMS' }, { status: 404 });
    }

    // 2. Fetch existing NetBox devices to avoid duplicates
    const nbResult = await getNetBoxDevices();
    const existingDevices = nbResult.data?.results || [];

    // If force re-sync, delete all existing devices first
    if (force && existingDevices.length > 0) {
      const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
      const apiToken = process.env.NETBOX_API_TOKEN || '';
      for (const dev of existingDevices) {
        await fetch(`${apiUrl}/dcim/devices/${dev.id}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${apiToken}`, 'Accept': 'application/json' },
        }).catch(() => {});
      }
      // Also clear IP addresses synced from LibreNMS
      const ipsRes = await fetch(`${apiUrl}/ipam/ip-addresses/?limit=500`, {
        headers: { 'Authorization': `Token ${apiToken}`, 'Accept': 'application/json' },
      });
      if (ipsRes.ok) {
        const ipsData = await ipsRes.json();
        for (const ip of ipsData.results || []) {
          await fetch(`${apiUrl}/ipam/ip-addresses/${ip.id}/`, {
            method: 'DELETE',
            headers: { 'Authorization': `Token ${apiToken}`, 'Accept': 'application/json' },
          }).catch(() => {});
        }
      }
    }

    const existingNames = force ? new Set<string>() : new Set(existingDevices.map(d => d.name?.toLowerCase()));
    const existingIPs = force ? new Set<string>() : new Set(
      existingDevices
        .filter(d => d.primary_ip4?.address)
        .map(d => d.primary_ip4!.address.split('/')[0])
    );

    // 3. Ensure required NetBox objects exist
    const setupResults = await ensureNetBoxSetup();
    if (setupResults.error) {
      return NextResponse.json({ error: `NetBox setup error: ${setupResults.error}` }, { status: 500 });
    }

    // Apply selective filters if provided
    let filteredDevices = lnmsDevices;
    if (rolesFilter && Array.isArray(rolesFilter) && rolesFilter.length > 0) {
      filteredDevices = filteredDevices.filter(dev => {
        const mappedRoleId = mapDeviceRole(dev, setupResults.roles);
        const roleObj = setupResults.roles.find(r => r.id === mappedRoleId);
        return roleObj && rolesFilter.includes(roleObj.slug);
      });
    }
    if (osFilter && Array.isArray(osFilter) && osFilter.length > 0) {
      filteredDevices = filteredDevices.filter(dev => {
        const devOs = (dev.os || '').toLowerCase();
        return osFilter.some(os => devOs.toLowerCase().includes(os.toLowerCase()));
      });
    }

    // 4. Sync each device
    const results = {
      total: filteredDevices.length,
      created: 0,
      skipped: 0,
      errors: 0,
      details: [] as { name: string; ip: string; status: 'created' | 'skipped' | 'error'; reason?: string }[],
    };

    for (const dev of filteredDevices) {
      const deviceName = dev.sysName || dev.hostname || dev.ip || `device-${dev.device_id}`;
      const deviceIP = dev.ip || dev.hostname;

      // Skip if already exists
      if (existingNames.has(deviceName.toLowerCase()) || existingIPs.has(deviceIP)) {
        results.skipped++;
        results.details.push({ name: deviceName, ip: deviceIP, status: 'skipped', reason: 'Already in NetBox' });
        continue;
      }

      // Determine device role based on OS/type
      const roleId = mapDeviceRole(dev, setupResults.roles);
      const typeId = setupResults.defaultTypeId;
      const siteId = setupResults.siteId;

      try {
        // Create the device
        const createResult = await createDevice({
          name: deviceName.slice(0, 64), // NetBox name limit
          device_type: typeId,
          role: roleId,
          site: siteId,
          status: dev.status === 1 ? 'active' : 'offline',
          serial: dev.serial || '',
          comments: [
            `Synced from LibreNMS (device_id: ${dev.device_id})`,
            `OS: ${dev.os || 'unknown'}`,
            `Hardware: ${dev.hardware || 'unknown'}`,
            `Version: ${dev.version || 'unknown'}`,
            `Location: ${dev.location || 'unknown'}`,
          ].join('\n'),
          platform: null,
        });

        if (createResult.error) {
          results.errors++;
          results.details.push({ name: deviceName, ip: deviceIP, status: 'error', reason: createResult.error.slice(0, 100) });
          continue;
        }

        // Assign IP address to the device if available
        if (deviceIP && createResult.data?.id) {
          await createIPAddress({
            address: `${deviceIP}/24`,
            status: 'active',
            assigned_object_type: 'dcim.device',
            assigned_object_id: createResult.data.id,
            dns_name: deviceName,
            description: `LibreNMS device ${dev.device_id}`,
          });
        }

        results.created++;
        results.details.push({ name: deviceName, ip: deviceIP, status: 'created' });
      } catch (err) {
        results.errors++;
        results.details.push({
          name: deviceName,
          ip: deviceIP,
          status: 'error',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json(
      { error: `Sync failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

// ─── Helper: Ensure NetBox has required objects ─────────────

interface SetupResult {
  siteId: number;
  defaultTypeId: number;
  roles: { id: number; name: string; slug: string }[];
  error?: string;
}

export async function ensureNetBoxSetup(): Promise<SetupResult & { error?: string }> {
  // Check for existing site
  const sitesRes = await getSites();
  let siteId: number;
  const sites = sitesRes.data?.results || [];

  if (sites.length > 0) {
    siteId = sites[0].id;
  } else {
    // Create default site
    const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
    const apiToken = process.env.NETBOX_API_TOKEN || '';
    const siteRes = await fetch(`${apiUrl}/dcim/sites/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        name: 'Química Boss - HQ',
        slug: 'quimica-boss-hq',
        status: 'active',
        description: 'Main office network',
      }),
    });
    if (!siteRes.ok) {
      return { siteId: 0, defaultTypeId: 0, roles: [], error: `Failed to create site: ${await siteRes.text()}` };
    }
    const siteData = await siteRes.json();
    siteId = siteData.id;
  }

  // Check for manufacturer
  const mfgRes = await getManufacturers();
  let mfgId: number;
  const mfgs = mfgRes.data?.results || [];
  const genericMfg = mfgs.find(m => m.slug === 'generic');

  if (genericMfg) {
    mfgId = genericMfg.id;
  } else {
    const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
    const apiToken = process.env.NETBOX_API_TOKEN || '';
    const mfgCreateRes = await fetch(`${apiUrl}/dcim/manufacturers/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ name: 'Generic', slug: 'generic' }),
    });
    if (!mfgCreateRes.ok) {
      return { siteId, defaultTypeId: 0, roles: [], error: `Failed to create manufacturer: ${await mfgCreateRes.text()}` };
    }
    const mfgData = await mfgCreateRes.json();
    mfgId = mfgData.id;
  }

  // Check for device type
  const typesRes = await getDeviceTypes();
  let defaultTypeId: number;
  const types = typesRes.data?.results || [];
  const networkDevice = types.find(t => t.model === 'Network Device');

  if (networkDevice) {
    defaultTypeId = networkDevice.id;
  } else {
    const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
    const apiToken = process.env.NETBOX_API_TOKEN || '';
    const typeRes = await fetch(`${apiUrl}/dcim/device-types/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        manufacturer: mfgId,
        model: 'Network Device',
        slug: 'network-device',
      }),
    });
    if (!typeRes.ok) {
      return { siteId, defaultTypeId: 0, roles: [], error: `Failed to create device type: ${await typeRes.text()}` };
    }
    const typeData = await typeRes.json();
    defaultTypeId = typeData.id;
  }

  // Ensure device roles exist
  const rolesRes = await getDeviceRoles();
  const existingRoles = rolesRes.data?.results || [];
  const requiredRoles = [
    { name: 'Server', slug: 'server', color: '2196f3' },
    { name: 'Network', slug: 'network', color: '4caf50' },
    { name: 'Printer', slug: 'printer', color: '9c27b0' },
    { name: 'Workstation', slug: 'workstation', color: 'ff9800' },
    { name: 'IP Phone', slug: 'ip-phone', color: '00bcd4' },
    { name: 'Access Point', slug: 'access-point', color: '8bc34a' },
    { name: 'Firewall', slug: 'firewall', color: 'f44336' },
    { name: 'Surveillance', slug: 'surveillance', color: '607d8b' },
    { name: 'Unknown', slug: 'unknown', color: '9e9e9e' },
  ];

  const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
  const apiToken = process.env.NETBOX_API_TOKEN || '';

  const roles = [...existingRoles.map(r => ({ id: r.id, name: r.name, slug: r.slug }))];

  for (const role of requiredRoles) {
    if (!existingRoles.find(r => r.slug === role.slug)) {
      const roleRes = await fetch(`${apiUrl}/dcim/device-roles/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(role),
      });
      if (roleRes.ok) {
        const roleData = await roleRes.json();
        roles.push({ id: roleData.id, name: roleData.name, slug: roleData.slug });
      }
    }
  }

  // Create prefixes for subnets
  const apiUrl2 = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
  for (const prefix of ['192.168.2.0/24', '192.168.254.0/24']) {
    await fetch(`${apiUrl2}/ipam/prefixes/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        site: siteId,
        status: 'active',
        description: prefix === '192.168.2.0/24' ? 'Main LAN' : 'ICMP/Management network',
      }),
    }).catch(() => { /* ignore if already exists */ });
  }

  return { siteId, defaultTypeId, roles };
}

// ─── Helper: Map LibreNMS OS to NetBox role ─────────────────
//
// Priority order:
//   1. LibreNMS `type` field (server, workstation, network, firewall)
//   2. OS-based heuristics (fortigate → firewall, hikvision → surveillance, etc.)
//   3. Hardware-based detection
//   4. Fallback to 'unknown'

function mapDeviceRole(
  dev: LibreNMSDevice,
  roles: { id: number; name: string; slug: string }[]
): number {
  const os = (dev.os || '').toLowerCase();
  const hardware = (dev.hardware || '').toLowerCase();
  const devType = (dev.type || '').toLowerCase();
  const hostname = (dev.hostname || '').toLowerCase();

  const findRole = (slug: string) => roles.find(r => r.slug === slug)?.id || roles[0]?.id || 1;

  // ── 1. Specific OS-based overrides (highest priority) ──

  // Firewalls — FortiOS, pfSense, OPNsense
  if (os === 'fortios' || os.includes('fortigate') || os.includes('fortinet') ||
      os === 'pfsense' || os === 'opnsense' || devType === 'firewall') {
    return findRole('firewall');
  }

  // Surveillance / NVR — HikVision, Dahua
  if (os.includes('hikvision') || os === 'hikvision-nvr' || os.includes('dahua') ||
      hardware.includes('dvr') || hardware.includes('nvr')) {
    return findRole('surveillance');
  }

  // Grandstream switches
  if (os === 'grandstream-sw' || os.includes('grandstream')) {
    return findRole('network');
  }

  // OCNoS (network OS used on routers/switches)
  if (os === 'ocnos') {
    return findRole('network');
  }

  // ── 2. LibreNMS `type` field (very reliable when present) ──

  if (devType === 'server') {
    return findRole('server');
  }
  if (devType === 'workstation') {
    return findRole('workstation');
  }
  if (devType === 'network') {
    return findRole('network');
  }
  if (devType === 'firewall') {
    return findRole('firewall');
  }
  if (devType === 'wireless') {
    return findRole('access-point');
  }
  if (devType === 'printer') {
    return findRole('printer');
  }
  if (devType === 'power' || devType === 'environment') {
    return findRole('unknown');
  }

  // ── 3. OS-based heuristics (when type is missing) ──

  // Network equipment
  if (os.includes('cisco') || os.includes('aruba') || os.includes('ubiquiti') ||
      os.includes('mikrotik') || os.includes('routeros') || os.includes('junos') ||
      os.includes('tplink') || os.includes('netgear') || os.includes('dlink') ||
      hardware.includes('switch') || hardware.includes('router')) {
    return findRole('network');
  }

  // Access Points
  if (os.includes('airos') || os.includes('unifi') ||
      hardware.includes('access point') || hardware.includes(' ap')) {
    return findRole('access-point');
  }

  // Printers
  if (os.includes('printer') || os.includes('ricoh') || os.includes('canon') ||
      os.includes('xerox') || os.includes('epson') || os.includes('brother') ||
      (os.includes('hp') && devType === 'printer')) {
    return findRole('printer');
  }

  // Windows without type → guess from hardware or hostname
  if (os === 'windows') {
    if (hostname.includes('srv') || hostname.includes('server') || hostname.includes('dc')) {
      return findRole('server');
    }
    return findRole('workstation'); // Default Windows = workstation
  }

  // Linux / VMware / other server OSes
  if (os === 'linux' || os.includes('vmware') || os.includes('proxmox') ||
      os.includes('truenas') || os.includes('freebsd') || os.includes('esxi') ||
      os.includes('debian') || os.includes('ubuntu') || os.includes('centos') ||
      os.includes('rhel')) {
    return findRole('server');
  }

  // IP Phones
  if (os.includes('phone') || os.includes('sip') || hardware.includes('phone') ||
      os.includes('polycom') || os.includes('yealink') || os.includes('grandstream-gxp')) {
    return findRole('ip-phone');
  }

  // Ping-only devices — LibreNMS monitors these via ICMP only
  // They could be anything, so mark as 'unknown'
  if (os === 'ping') {
    return findRole('unknown');
  }

  return findRole('unknown');
}
