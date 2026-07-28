/**
 * Nmap API Client
 * 
 * Communicates with the custom Nmap REST API wrapper to perform
 * network scanning, OS detection, and service fingerprinting.
 * 
 * Configured via environment variables:
 *   NMAP_API_URL — e.g. http://192.168.2.134:5001
 */

function getApiUrl(): string {
  return process.env.NMAP_API_URL || 'http://192.168.2.134:5001';
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function nmapRequest<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  const { method = 'GET', body, timeout = 60000 } = options;
  const apiUrl = getApiUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
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
      return { data: null, error: `Nmap API ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    return { data: data as T, error: null };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { data: null, error: 'Nmap scan timed out (this is normal for large scans)' };
    }
    return { data: null, error: `Nmap API error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Types ──────────────────────────────────────────────────

export interface NmapPortResult {
  port: number;
  protocol: string;
  state: string;
  service: string;
  version: string;
  product: string;
  extra_info?: string;
}

export interface NmapOSMatch {
  name: string;
  accuracy: number;
  os_family?: string;
  os_gen?: string;
  vendor?: string;
  type?: string;
}

export interface NmapHostResult {
  ip: string;
  hostname: string | null;
  state: string;
  os_matches: NmapOSMatch[];
  ports: NmapPortResult[];
  mac_address: string | null;
  vendor: string | null;
}

export interface NmapScanStatus {
  id: string;
  target: string;
  scan_type: string;
  status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled';
  host_count?: number;
  results?: NmapHostResult[];
  command?: string;
  error?: string;
  errors_list?: { host: string; error: string }[];
  progress?: number;
  progress_message?: string;
  hosts_scanned?: number;
  hosts_total?: number;
  elapsed_seconds?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface NmapScanSummary {
  id: string;
  target: string;
  scan_type: string;
  status: string;
  host_count: number;
  progress: number;
  progress_message: string;
  hosts_scanned: number;
  hosts_total: number;
  elapsed_seconds: number;
  created_at: string;
  completed_at?: string;
}

// ─── Scan Operations ────────────────────────────────────────

export type ScanType = 'quick' | 'ports' | 'full' | 'os' | 'aggressive' | 'vuln';

/**
 * Start an async scan. Returns immediately with a scan_id.
 * Poll with getScanResult() to check progress.
 */
export async function startScan(target: string, scanType: ScanType = 'full') {
  return nmapRequest<{ scan_id: string; target: string; status: string }>(
    '/scan',
    {
      method: 'POST',
      body: { target, scan_type: scanType },
    }
  );
}

/**
 * Get the status and results of a scan.
 */
export async function getScanResult(scanId: string) {
  return nmapRequest<NmapScanStatus>(`/scan/${scanId}`);
}

/**
 * List all recent scans.
 */
export async function listScans() {
  return nmapRequest<{ scans: NmapScanSummary[] }>('/scans');
}

/**
 * Cancel a running scan.
 */
export async function cancelScan(scanId: string) {
  return nmapRequest<{ status: string; scan_id: string }>(
    `/scan/${scanId}/cancel`,
    { method: 'POST' }
  );
}

/**
 * Quick synchronous scan of a single host (10-30 seconds).
 * Returns OS, ports, and services immediately.
 */
export async function quickScan(ip: string) {
  return nmapRequest<NmapHostResult>(`/quick/${ip}`, { timeout: 45000 });
}

/**
 * Discover all live hosts in a subnet via ping sweep.
 */
export async function discoverSubnet(subnet: string) {
  // URL-encode the CIDR slash
  const safeSubnet = subnet.replace('/', '_');
  return nmapRequest<{
    subnet: string;
    host_count: number;
    hosts: { ip: string; hostname: string | null; state: string; mac_address: string | null; vendor: string | null }[];
    command: string;
  }>(`/discover/${safeSubnet}`, { timeout: 120000 });
}

// ─── Health Check ───────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; nmapVersion?: string; activeScans?: number }> {
  try {
    const res = await nmapRequest<{ status: string; nmap_version: string; active_scans: number }>('/health');
    if (res.error) {
      return { ok: false, error: res.error };
    }
    return {
      ok: res.data?.status === 'ok',
      nmapVersion: res.data?.nmap_version,
      activeScans: res.data?.active_scans,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
