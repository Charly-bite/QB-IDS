/**
 * LibreNMS API Client
 * 
 * Communicates with the LibreNMS REST API v0 to pull device status,
 * alerts, graphs, ports, and other monitoring data.
 * 
 * Configured via environment variables:
 *   LIBRENMS_API_URL   — e.g. http://192.168.2.134:8000/api/v0
 *   LIBRENMS_API_TOKEN — API token from LibreNMS UI
 */

// Read env vars dynamically to avoid stale values cached at module-load time
function getApiUrl(): string {
  return process.env.LIBRENMS_API_URL || 'http://192.168.2.134:8000/api/v0';
}
function getApiToken(): string {
  return process.env.LIBRENMS_API_TOKEN || '';
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function librenmsRequest<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  const { method = 'GET', body, timeout = 10000 } = options;
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();

  if (!apiToken) {
    return { data: null, error: 'LIBRENMS_API_TOKEN not configured — add it to .env.local' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'X-Auth-Token': apiToken,
      'Accept': 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store' as RequestCache, // Disable Next.js fetch caching — data must be fresh
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      // Provide a clear, actionable message for auth failures
      if (res.status === 401) {
        return {
          data: null,
          error: `LibreNMS API token is invalid or expired (HTTP 401). Generate a new token in LibreNMS → Settings → API → API Settings and update LIBRENMS_API_TOKEN in .env.local`,
        };
      }
      if (res.status === 403) {
        return {
          data: null,
          error: `LibreNMS API token lacks permission for ${endpoint} (HTTP 403)`,
        };
      }

      return { data: null, error: `HTTP ${res.status}: ${text}` };
    }

    const json = await res.json();
    return { data: json as T, error: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { data: null, error: 'Request timed out' };
    }
    return { data: null, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ────────────────────────────────────────────────────

export interface LibreNMSDevice {
  device_id: number;
  hostname: string;
  sysName: string;
  ip: string;
  status: number; // 1 = up, 0 = down
  status_reason: string;
  os: string;
  hardware: string;
  serial: string;
  uptime: number;
  location: string;
  type: string;
  last_polled: string;
  last_discovered: string;
  version: string;
  features: string;
}

export interface LibreNMSAlert {
  id: number;
  hostname: string;
  rule: string;
  severity: string;
  state: number;
  timestamp: string;
  alerted: number;
}

export interface LibreNMSPort {
  port_id: number;
  device_id: number;
  ifName: string;
  ifAlias: string;
  ifOperStatus: string;
  ifAdminStatus: string;
  ifSpeed: number;
  ifInOctets_rate: number;
  ifOutOctets_rate: number;
}

// ── Device Operations ────────────────────────────────────────

/** Get all devices from LibreNMS */
export async function getDevices() {
  return librenmsRequest<{ devices: LibreNMSDevice[] }>('/devices');
}

/** Get a single device by ID or hostname */
export async function getDevice(hostnameOrId: string | number) {
  return librenmsRequest<{ devices: LibreNMSDevice[] }>(`/devices/${hostnameOrId}`);
}

/** Delete a device from LibreNMS by ID */
export async function deleteDevice(deviceId: number) {
  return librenmsRequest<{ status: string; message: string }>(`/devices/${deviceId}`, { method: 'DELETE' });
}

/** Get all active alerts */
export async function getAlerts() {
  return librenmsRequest<{ alerts: LibreNMSAlert[] }>('/alerts?state=1');
}

/** Get all alerts (including resolved) */
export async function getAllAlerts() {
  return librenmsRequest<{ alerts: LibreNMSAlert[] }>('/alerts');
}

/** Get ports for a device */
export async function getDevicePorts(deviceId: number) {
  return librenmsRequest<{ ports: LibreNMSPort[] }>(`/devices/${deviceId}/ports`);
}

/** Get device graphs list */
export async function getDeviceGraphs(deviceId: number) {
  return librenmsRequest<{ graphs: { desc: string; graph: string }[] }>(
    `/devices/${deviceId}/graphs`
  );
}

/** Get device availability (uptime %) */
export async function getDeviceAvailability(deviceId: number) {
  return librenmsRequest<{ availability: { duration: number; availability_perc: number }[] }>(
    `/devices/${deviceId}/availability`
  );
}

/** Get system info */
export async function getSystemInfo() {
  return librenmsRequest<{ system_name: string; database_ver: string; php_ver: string; netsnmp_ver: string }>(
    '/system'
  );
}

/** Get device health sensor categories */
export async function getDeviceHealthCategories(deviceId: number) {
  return librenmsRequest<{ graphs: { desc: string; name: string }[]; count: number }>(
    `/devices/${deviceId}/health`
  );
}

/** Get device health sensors */
export async function getDeviceHealth(deviceId: number, sensorType?: string) {
  const endpoint = sensorType
    ? `/devices/${deviceId}/health/${sensorType}`
    : `/devices/${deviceId}/health`;
  return librenmsRequest(endpoint);
}

/** Fetch a graph image (PNG) from LibreNMS and return as Buffer */
export async function getDeviceGraphImage(
  deviceId: number,
  type: string,
  from: string = '-1d',
  width: number = 500,
  height: number = 150
): Promise<{ data: Buffer | null; error: string | null; contentType: string }> {
  const apiToken = getApiToken();
  const apiUrl = getApiUrl();
  if (!apiToken) {
    return { data: null, error: 'LIBRENMS_API_TOKEN not configured — add it to .env.local', contentType: '' };
  }
  try {
    const url = `${apiUrl}/devices/${deviceId}/${type}.png?from=${from}&width=${width}&height=${height}`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': apiToken },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store' as RequestCache,
    });
    if (!res.ok) {
      if (res.status === 401) {
        return { data: null, error: 'API token invalid/expired (HTTP 401)', contentType: '' };
      }
      return { data: null, error: `HTTP ${res.status}`, contentType: '' };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { data: buffer, error: null, contentType: res.headers.get('content-type') || 'image/png' };
  } catch (err) {
    return { data: null, error: String(err), contentType: '' };
  }
}

/** Search devices by query */
export async function searchDevices(query: string) {
  return librenmsRequest<{ devices: LibreNMSDevice[] }>(`/devices?type=all&query=${encodeURIComponent(query)}`);
}

/** Add a device to LibreNMS */
export async function addDevice(hostname: string, snmpVersion: string = 'v2c', community: string = 'public') {
  return librenmsRequest('/devices', {
    method: 'POST',
    body: { hostname, version: snmpVersion, community },
  });
}

/** Test API connectivity */
export async function testConnection() {
  const result = await getSystemInfo();
  return { connected: result.error === null, ...result };
}

// ── Metrics Types ────────────────────────────────────────────

export interface LibreNMSProcessor {
  processor_id: number;
  device_id: number;
  processor_descr: string;
  processor_usage: number;
  processor_type: string;
}

export interface LibreNMSMempool {
  mempool_id: number;
  device_id: number;
  mempool_descr: string;
  mempool_used: number;
  mempool_total: number;
  mempool_perc: number;
  mempool_type: string;
}

export interface LibreNMSStorage {
  storage_id: number;
  device_id: number;
  storage_descr: string;
  storage_type: string;
  storage_size: number;
  storage_used: number;
  storage_free: number;
  storage_perc: number;
  storage_units: number;
}

// ── Metrics Operations ───────────────────────────────────────

/** Get CPU processor usage for a device */
export async function getDeviceProcessors(deviceId: number) {
  return librenmsRequest<{ processors: LibreNMSProcessor[] }>(
    `/devices/${deviceId}/processors`
  );
}

/** Get memory pools for a device */
export async function getDeviceMemory(deviceId: number) {
  return librenmsRequest<{ mempools: LibreNMSMempool[] }>(
    `/devices/${deviceId}/mempools`
  );
}

/** Get disk/storage partitions for a device */
export async function getDeviceStorage(deviceId: number) {
  return librenmsRequest<{ storage: LibreNMSStorage[] }>(
    `/devices/${deviceId}/storage`
  );
}

/** Get all IP addresses on a device */
export async function getDeviceIpAddresses(deviceId: number) {
  return librenmsRequest<{ addresses: { ipv4_address: string; ipv4_network_id: string; port_id: number }[] }>(
    `/devices/${deviceId}/ip`
  );
}

/** Get port traffic stats (enriched with rate data) */
export async function getDevicePortsTraffic(deviceId: number) {
  return librenmsRequest<{ ports: LibreNMSPort[] }>(
    `/devices/${deviceId}/ports?columns=ifName,ifAlias,ifOperStatus,ifAdminStatus,ifSpeed,ifInOctets_rate,ifOutOctets_rate`
  );
}

/**
 * Aggregated metrics fetch — gets CPU, memory, storage, ports, and availability
 * in a single parallel call. Used by DeviceMetricsPanel.
 */
export async function getDeviceMetrics(deviceId: number) {
  const [processorsRes, memoryRes, storageRes, portsRes, availRes] = await Promise.all([
    getDeviceProcessors(deviceId),
    getDeviceMemory(deviceId),
    getDeviceStorage(deviceId),
    getDevicePortsTraffic(deviceId),
    getDeviceAvailability(deviceId),
  ]);

  // Calculate average CPU usage across all processors
  const processors = (processorsRes.data as { processors?: LibreNMSProcessor[] })?.processors || [];
  const cpuAvg = processors.length > 0
    ? Math.round(processors.reduce((sum, p) => sum + (p.processor_usage || 0), 0) / processors.length)
    : null;

  // Get primary memory pool
  const mempools = (memoryRes.data as { mempools?: LibreNMSMempool[] })?.mempools || [];
  const primaryMemory = mempools.length > 0 ? mempools[0] : null;

  // Storage partitions
  const storage = (storageRes.data as { storage?: LibreNMSStorage[] })?.storage || [];

  // Active ports with traffic
  const ports = (portsRes.data as { ports?: LibreNMSPort[] })?.ports || [];
  const activePorts = ports.filter(p => p.ifOperStatus === 'up');

  // Availability
  const availability = (availRes.data as { availability?: { duration: number; availability_perc: number }[] })?.availability || [];
  const uptimePercent = availability.length > 0 ? availability[0].availability_perc : null;

  return {
    cpu: {
      average: cpuAvg,
      processors,
    },
    memory: primaryMemory ? {
      usedBytes: primaryMemory.mempool_used,
      totalBytes: primaryMemory.mempool_total,
      percent: primaryMemory.mempool_perc,
      description: primaryMemory.mempool_descr,
      pools: mempools,
    } : null,
    storage: storage.map(s => ({
      description: s.storage_descr,
      sizeBytes: s.storage_size * (s.storage_units || 1),
      usedBytes: s.storage_used * (s.storage_units || 1),
      freeBytes: s.storage_free * (s.storage_units || 1),
      percent: s.storage_perc,
    })),
    ports: activePorts.map(p => ({
      name: p.ifName,
      alias: p.ifAlias,
      speed: p.ifSpeed,
      inRate: p.ifInOctets_rate,
      outRate: p.ifOutOctets_rate,
      status: p.ifOperStatus,
    })),
    uptimePercent,
    errors: {
      processors: processorsRes.error,
      memory: memoryRes.error,
      storage: storageRes.error,
      ports: portsRes.error,
      availability: availRes.error,
    },
  };
}

/**
 * Fetch storage data for ALL devices and return ranked by usage %.
 * Used by the "TOP - USO DE DISCO DURO" widget.
 */
export async function getAllDevicesStorage(limit: number = 20) {
  // First get all devices
  const devicesResult = await getDevices();
  const devices = (devicesResult.data as { devices?: LibreNMSDevice[] })?.devices || [];
  
  if (devices.length === 0) {
    return { partitions: [], error: devicesResult.error };
  }

  // Only query online devices to avoid timeouts
  const onlineDevices = devices.filter(d => d.status === 1);
  
  // Fetch storage for all online devices in parallel (with concurrency control)
  const results = await Promise.allSettled(
    onlineDevices.map(async (device) => {
      const storageRes = await getDeviceStorage(device.device_id);
      const storage = (storageRes.data as { storage?: LibreNMSStorage[] })?.storage || [];
      return storage.map(s => ({
        device_id: device.device_id,
        hostname: device.hostname,
        sysName: device.sysName,
        ip: device.ip,
        os: device.os,
        description: s.storage_descr,
        type: s.storage_type,
        sizeBytes: s.storage_size * (s.storage_units || 1),
        usedBytes: s.storage_used * (s.storage_units || 1),
        freeBytes: s.storage_free * (s.storage_units || 1),
        percent: s.storage_perc,
      }));
    })
  );

  // Flatten all partitions and sort by usage % descending
  const allPartitions = results
    .filter((r): r is PromiseFulfilledResult<typeof results extends PromiseSettledResult<infer T>[] ? T : never> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(p => p.sizeBytes > 0) // Skip empty/virtual mounts
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);

  return { partitions: allPartitions, error: null };
}

/** Get base URL and token for graph URL construction */
export function getGraphConfig() {
  return { apiUrl: getApiUrl(), token: getApiToken() };
}
