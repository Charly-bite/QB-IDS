/**
 * NetBox API Client
 * 
 * Communicates with the NetBox REST API to manage network inventory,
 * IP address management (IPAM), and device tracking.
 * 
 * Configured via environment variables:
 *   NETBOX_API_URL   — e.g. http://192.168.2.134:8085/api
 *   NETBOX_API_TOKEN — API token from NetBox admin panel
 */

function getApiUrl(): string {
  return process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
}
function getApiToken(): string {
  return process.env.NETBOX_API_TOKEN || '';
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function netboxRequest<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  const { method = 'GET', body, timeout = 15000 } = options;
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();

  if (!apiToken) {
    return { data: null, error: 'NETBOX_API_TOKEN not configured — deploy NetBox and add token to .env.local' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Token ${apiToken}`,
      'Accept': 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { data: null, error: `NetBox API ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    return { data: data as T, error: null };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { data: null, error: 'NetBox API request timed out' };
    }
    return { data: null, error: `NetBox API error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Types ──────────────────────────────────────────────────

export interface NetBoxDevice {
  id: number;
  name: string;
  display: string;
  device_type: { id: number; display: string; manufacturer: { name: string } };
  role: { id: number; name: string; slug: string; color: string } | null;
  tenant: { id: number; name: string } | null;
  site: { id: number; name: string; slug: string } | null;
  rack: { id: number; name: string } | null;
  position: number | null;
  serial: string;
  asset_tag: string | null;
  status: { value: string; label: string };
  primary_ip: { id: number; address: string; family: { value: number } } | null;
  primary_ip4: { id: number; address: string } | null;
  platform: { id: number; name: string } | null;
  comments: string;
  tags: { id: number; name: string; slug: string; color: string }[];
  custom_fields: Record<string, unknown>;
  created: string;
  last_updated: string;
  url: string;
}

export interface NetBoxIPAddress {
  id: number;
  address: string;
  family: { value: number; label: string };
  status: { value: string; label: string };
  dns_name: string;
  description: string;
  assigned_object: {
    id: number;
    name: string;
    device: { id: number; name: string } | null;
  } | null;
  tenant: { id: number; name: string } | null;
  tags: { id: number; name: string; color: string }[];
  created: string;
  last_updated: string;
}

export interface NetBoxPrefix {
  id: number;
  prefix: string;
  site: { id: number; name: string } | null;
  vlan: { id: number; vid: number; name: string } | null;
  status: { value: string; label: string };
  role: { id: number; name: string } | null;
  description: string;
  is_pool: boolean;
  children: number;
  created: string;
}

export interface NetBoxVLAN {
  id: number;
  vid: number;
  name: string;
  status: { value: string; label: string };
  site: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  role: { id: number; name: string } | null;
  tenant: { id: number; name: string } | null;
  description: string;
  tags: { id: number; name: string; color: string }[];
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ─── Device Operations ──────────────────────────────────────

export async function getDevices(filters?: Record<string, string>) {
  let endpoint = '/dcim/devices/?limit=500';
  if (filters) {
    const params = new URLSearchParams(filters);
    endpoint += `&${params.toString()}`;
  }
  return netboxRequest<PaginatedResponse<NetBoxDevice>>(endpoint);
}

export async function getDevice(id: number) {
  return netboxRequest<NetBoxDevice>(`/dcim/devices/${id}/`);
}

export async function createDevice(data: Record<string, unknown>) {
  return netboxRequest<NetBoxDevice>('/dcim/devices/', { method: 'POST', body: data });
}

export async function updateDevice(id: number, data: Record<string, unknown>) {
  return netboxRequest<NetBoxDevice>(`/dcim/devices/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteDevice(id: number) {
  return netboxRequest(`/dcim/devices/${id}/`, { method: 'DELETE' });
}

export async function searchDevices(query: string) {
  return netboxRequest<PaginatedResponse<NetBoxDevice>>(`/dcim/devices/?q=${encodeURIComponent(query)}&limit=50`);
}

// ─── IPAM Operations ────────────────────────────────────────

export async function getIPAddresses(filters?: Record<string, string>) {
  let endpoint = '/ipam/ip-addresses/?limit=500';
  if (filters) {
    const params = new URLSearchParams(filters);
    endpoint += `&${params.toString()}`;
  }
  return netboxRequest<PaginatedResponse<NetBoxIPAddress>>(endpoint);
}

export async function getPrefixes() {
  return netboxRequest<PaginatedResponse<NetBoxPrefix>>('/ipam/prefixes/?limit=100');
}

export async function getVLANs() {
  return netboxRequest<PaginatedResponse<NetBoxVLAN>>('/ipam/vlans/?limit=100');
}

export async function createIPAddress(data: Record<string, unknown>) {
  return netboxRequest<NetBoxIPAddress>('/ipam/ip-addresses/', { method: 'POST', body: data });
}

// ─── Device Types & Roles ───────────────────────────────────

export async function getDeviceTypes() {
  return netboxRequest<PaginatedResponse<{ id: number; display: string; manufacturer: { name: string }; model: string }>>('/dcim/device-types/?limit=100');
}

export async function getDeviceRoles() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; color: string; device_count: number }>>('/dcim/device-roles/?limit=50');
}

export async function getSites() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; status: { value: string }; device_count: number }>>('/dcim/sites/?limit=50');
}

export async function getRegions() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; description: string; site_count: number }>>('/dcim/regions/?limit=100');
}

export async function createRegion(data: Record<string, unknown>) {
  return netboxRequest<{ id: number; name: string; slug: string }>('/dcim/regions/', { method: 'POST', body: data });
}

export async function getSiteGroups() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; description: string; site_count: number }>>('/dcim/site-groups/?limit=100');
}

export async function createSiteGroup(data: Record<string, unknown>) {
  return netboxRequest<{ id: number; name: string; slug: string }>('/dcim/site-groups/', { method: 'POST', body: data });
}

export async function getLocations() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; description: string; site: { id: number; name: string }; device_count: number }>>('/dcim/locations/?limit=100');
}

export async function createLocation(data: Record<string, unknown>) {
  return netboxRequest<{ id: number; name: string; slug: string }>('/dcim/locations/', { method: 'POST', body: data });
}

export async function getManufacturers() {
  return netboxRequest<PaginatedResponse<{ id: number; name: string; slug: string; devicetype_count: number }>>('/dcim/manufacturers/?limit=50');
}

// ─── Dashboard Overview ─────────────────────────────────────

export async function getOverview() {
  // Fetch counts in parallel for the summary cards
  const [devicesRes, ipsRes, prefixesRes, vlansRes] = await Promise.all([
    netboxRequest<PaginatedResponse<unknown>>('/dcim/devices/?limit=1'),
    netboxRequest<PaginatedResponse<unknown>>('/ipam/ip-addresses/?limit=1'),
    netboxRequest<PaginatedResponse<unknown>>('/ipam/prefixes/?limit=1'),
    netboxRequest<PaginatedResponse<unknown>>('/ipam/vlans/?limit=1'),
  ]);

  return {
    devices: devicesRes.data?.count ?? 0,
    ipAddresses: ipsRes.data?.count ?? 0,
    prefixes: prefixesRes.data?.count ?? 0,
    vlans: vlansRes.data?.count ?? 0,
    error: devicesRes.error || ipsRes.error || prefixesRes.error || vlansRes.error || null,
  };
}

// ─── Test Connection ────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; version?: string }> {
  const apiUrl = getApiUrl();
  const apiToken = getApiToken();

  if (!apiToken) {
    return { ok: false, error: 'NETBOX_API_TOKEN not configured' };
  }

  try {
    const res = await fetch(`${apiUrl}/status/`, {
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, version: data['netbox-version'] || 'unknown' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
