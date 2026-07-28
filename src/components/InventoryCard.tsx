'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface NetBoxOverview {
  devices: number;
  ipAddresses: number;
  prefixes: number;
  vlans: number;
  error?: string | null;
}

interface NetBoxDeviceItem {
  id: number;
  name: string;
  display: string;
  device_type?: { display: string; manufacturer?: { name: string } };
  role?: { id: number; name: string; slug: string; color: string } | null;
  site?: { id: number; name: string; slug: string } | null;
  location?: { id: number; name: string; slug: string } | null;
  status?: { value: string; label: string };
  primary_ip?: { address: string } | null;
  primary_ip4?: { address: string } | null;
  platform?: { name: string } | null;
  serial?: string;
  tags?: { name: string; color: string }[];
  last_updated?: string;
}

interface NmapScanItem {
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

interface NmapHostResult {
  ip: string;
  hostname: string | null;
  state: string;
  os_matches: { name: string; accuracy: number }[];
  ports: { port: number; protocol: string; state: string; service: string; version: string; product: string }[];
  mac_address: string | null;
  vendor: string | null;
}

interface ArpEntry {
  ip: string;
  mac: string;
  vendor: string | null;
  seenBy: string;
}

interface ArpTableData {
  count: number;
  subnet: string;
  source: string;
  entries: ArpEntry[];
  timestamp: string;
  error?: string;
}

interface NmapScanDetail {
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
}

interface DhcpLease {
  ip: string;
  mac: string;
  hostname: string;
  type: string;
  expire: string;
  interface: string;
  vendor: string | null;
}

const vendorColors: Record<string, string> = {
  'Fortinet': '#e74c3c', 'HP/HPE': '#2563eb', 'TP-Link': '#16a34a', 'Ubiquiti': '#7c3aed',
  'Cisco': '#0891b2', 'Cisco Linksys': '#0891b2', 'Cisco Meraki': '#0891b2',
  'Intel': '#2563eb', 'VMware': '#6d28d9', 'Hyper-V': '#6d28d9',
  'Grandstream': '#d97706', 'HikVision': '#dc2626', 'Dell': '#1d4ed8',
  'Apple': '#374151', 'Samsung': '#1d4ed8', 'MikroTik': '#059669',
  'Brother': '#6b7280', 'Kyocera': '#6b7280', 'Epson': '#6b7280', 'Ricoh/NRG': '#6b7280',
  'Realtek': '#0ea5e9', 'Synology': '#0f766e', 'Raspberry Pi': '#c026d3',
  'Dahua': '#b91c1c', 'ASUSTek': '#1e40af', 'Peplink': '#a16207',
  'Unknown': '#94a3b8',
};

const getVendorColor = (v: string | null) => vendorColors[v || 'Unknown'] || '#64748b';

// ─── Component ──────────────────────────────────────────────

export default function InventoryCard({ compact = false }: { compact?: boolean }) {
  // Connection status
  const [netboxStatus, setNetboxStatus] = useState<{ ok: boolean; error?: string; version?: string } | null>(null);
  const [nmapStatus, setNmapStatus] = useState<{ ok: boolean; error?: string; nmapVersion?: string } | null>(null);

  // NetBox data
  const [overview, setOverview] = useState<NetBoxOverview | null>(null);
  const [devices, setDevices] = useState<NetBoxDeviceItem[]>([]);
  const [nbSearch, setNbSearch] = useState('');

  // Nmap data
  const [scans, setScans] = useState<NmapScanItem[]>([]);
  const [activeScan, setActiveScan] = useState<NmapScanDetail | null>(null);
  const [scanTarget, setScanTarget] = useState('192.168.2.0/24');
  const [scanType, setScanType] = useState('full');
  const [isScanning, setIsScanning] = useState(false);
  const [hideEmptyHosts, setHideEmptyHosts] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ARP Discovery data
  const [arpData, setArpData] = useState<ArpTableData | null>(null);
  const [arpLoading, setArpLoading] = useState(false);
  const [arpSearch, setArpSearch] = useState('');
  const [arpVendorFilter, setArpVendorFilter] = useState<string>('all');

  // DHCP Leases data
  const [dhcpLeases, setDhcpLeases] = useState<DhcpLease[]>([]);
  const [dhcpLoading, setDhcpLoading] = useState(false);
  const [dhcpSearch, setDhcpSearch] = useState('');
  const [dhcpTypeFilter, setDhcpTypeFilter] = useState<'all' | 'dynamic' | 'reserved'>('all');
  const [dhcpStatus, setDhcpStatus] = useState<{ configured: boolean; simulated: boolean; error: string | null } | null>(null);

  // NetBox metadata states
  const [netboxRoles, setNetboxRoles] = useState<{ id: number; name: string; slug: string; color: string }[]>([]);
  const [netboxSites, setNetboxSites] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [addDeviceData, setAddDeviceData] = useState<{ ip: string; name: string; vendor: string | null; roleId: string; siteId: string; deviceType: string } | null>(null);
  const [addingDevice, setAddingDevice] = useState(false);

  // Sync options states
  const [showSyncOptionsModal, setShowSyncOptionsModal] = useState(false);
  const [syncRolesFilter, setSyncRolesFilter] = useState<string[]>([]);
  const [syncOsFilter, setSyncOsFilter] = useState<string>('');

  // UI state
  const [activeSection, setActiveSection] = useState<'netbox' | 'arp' | 'nmap' | 'dhcp'>('arp');
  const [expandedHost, setExpandedHost] = useState<string | null>(null);

  // NetBox sub-sections
  const [netboxSubSection, setNetboxSubSection] = useState<'devices' | 'regions' | 'site-groups' | 'locations'>('devices');
  const [netboxRegions, setNetboxRegions] = useState<{ id: number; name: string; slug: string; description: string; site_count: number }[]>([]);
  const [netboxSiteGroups, setNetboxSiteGroups] = useState<{ id: number; name: string; slug: string; description: string; site_count: number }[]>([]);
  const [netboxLocations, setNetboxLocations] = useState<{ id: number; name: string; slug: string; description: string; site: { id: number; name: string }; device_count: number }[]>([]);

  // Creation forms
  const [newRegionData, setNewRegionData] = useState({ name: '', slug: '', description: '' });
  const [newSiteGroupData, setNewSiteGroupData] = useState({ name: '', slug: '', description: '' });
  const [newLocationData, setNewLocationData] = useState({ name: '', slug: '', description: '', siteId: '' });
  
  // Modals / Editing NetBox Device
  const [editingNetBoxDevice, setEditingNetBoxDevice] = useState<NetBoxDeviceItem | null>(null);
  const [updatingDeviceLoading, setUpdatingDeviceLoading] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    total: number; created: number; skipped: number; errors: number;
    details: { name: string; ip: string; status: 'created' | 'skipped' | 'error'; reason?: string }[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ── Sync LibreNMS → NetBox ──
  const handleSync = async (force = false, roles?: string[], os?: string) => {
    setIsSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const body: Record<string, any> = {};
      if (force) body.force = true;
      if (roles && roles.length > 0) body.roles = roles;
      if (os && os.trim()) body.os = os.trim().split(',').map(x => x.trim()).filter(Boolean);

      const res = await fetch('/api/netbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
      } else {
        setSyncResult(data);
        loadNetBoxData(); // Refresh NetBox data
      }
    } catch (err) {
      setSyncError(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Test connections on mount ──
  useEffect(() => {
    async function testConnections() {
      try {
        const [nb, nm] = await Promise.all([
          fetch('/api/netbox?action=test').then(r => r.json()).catch(() => ({ ok: false, error: 'Connection failed' })),
          fetch('/api/nmap?action=test').then(r => r.json()).catch(() => ({ ok: false, error: 'Connection failed' })),
        ]);
        setNetboxStatus(nb);
        setNmapStatus(nm);
      } catch { /* ignore */ }
    }
    testConnections();
  }, []);

  // ── Load NetBox data ──
  const loadNetBoxData = useCallback(async () => {
    try {
      const [overviewRes, devicesRes, rolesRes, sitesRes, regionsRes, siteGroupsRes, locationsRes] = await Promise.all([
        fetch('/api/netbox?action=overview').then(r => r.json()).catch(() => null),
        fetch('/api/netbox?action=devices').then(r => r.json()).catch(() => ({ devices: [] })),
        fetch('/api/netbox?action=roles').then(r => r.json()).catch(() => ({ roles: [] })),
        fetch('/api/netbox?action=sites').then(r => r.json()).catch(() => ({ sites: [] })),
        fetch('/api/netbox?action=regions').then(r => r.json()).catch(() => ({ regions: [] })),
        fetch('/api/netbox?action=site-groups').then(r => r.json()).catch(() => ({ siteGroups: [] })),
        fetch('/api/netbox?action=locations').then(r => r.json()).catch(() => ({ locations: [] })),
      ]);
      if (overviewRes) setOverview(overviewRes);
      setDevices(devicesRes.devices || []);
      setNetboxRoles(rolesRes.roles || []);
      setNetboxSites(sitesRes.sites || []);
      setNetboxRegions(regionsRes.regions || []);
      setNetboxSiteGroups(siteGroupsRes.siteGroups || []);
      setNetboxLocations(locationsRes.locations || []);
    } catch { /* ignore */ }
  }, []);

  const handleCreateRegion = async () => {
    if (!newRegionData.name || !newRegionData.slug) return alert('Name and Slug are required.');
    try {
      const res = await fetch('/api/netbox?action=create-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRegionData),
      });
      const data = await res.json();
      if (res.ok) {
        setNewRegionData({ name: '', slug: '', description: '' });
        loadNetBoxData();
        alert('Region created successfully!');
      } else {
        alert(`Error: ${data.error || 'Failed to create region'}`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCreateSiteGroup = async () => {
    if (!newSiteGroupData.name || !newSiteGroupData.slug) return alert('Name and Slug are required.');
    try {
      const res = await fetch('/api/netbox?action=create-site-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSiteGroupData),
      });
      const data = await res.json();
      if (res.ok) {
        setNewSiteGroupData({ name: '', slug: '', description: '' });
        loadNetBoxData();
        alert('Site Group created successfully!');
      } else {
        alert(`Error: ${data.error || 'Failed to create site group'}`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCreateLocation = async () => {
    if (!newLocationData.name || !newLocationData.slug || !newLocationData.siteId) {
      return alert('Name, Slug, and Site are required.');
    }
    try {
      const res = await fetch('/api/netbox?action=create-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLocationData.name,
          slug: newLocationData.slug,
          description: newLocationData.description,
          site: parseInt(newLocationData.siteId),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewLocationData({ name: '', slug: '', description: '', siteId: '' });
        loadNetBoxData();
        alert('Location created successfully!');
      } else {
        alert(`Error: ${data.error || 'Failed to create location'}`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUpdateNetBoxDevice = async (id: number, updatedFields: Record<string, any>) => {
    setUpdatingDeviceLoading(true);
    try {
      const res = await fetch(`/api/netbox?action=update&id=${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingNetBoxDevice(null);
        loadNetBoxData();
        alert('Device updated successfully!');
      } else {
        alert(`Error: ${data.error || 'Failed to update device'}`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingDeviceLoading(false);
    }
  };

  // Check if device already exists in NetBox by IP address
  const isDeviceInNetBox = useCallback((ip: string) => {
    if (!ip) return false;
    return devices.some(d => {
      const addr = d.primary_ip4?.address || d.primary_ip?.address || '';
      return addr.split('/')[0] === ip;
    });
  }, [devices]);

  // ── Handle Add Host to NetBox ──
  const handleAddDeviceToNetBox = async () => {
    if (!addDeviceData) return;
    setAddingDevice(true);
    try {
      const res = await fetch('/api/netbox?action=sync-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: addDeviceData.ip,
          name: addDeviceData.name,
          roleId: addDeviceData.roleId,
          siteId: addDeviceData.siteId,
          vendor: addDeviceData.vendor,
          deviceType: addDeviceData.deviceType,
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Failed to add device: ${data.error}`);
      } else {
        setShowAddDeviceModal(false);
        setAddDeviceData(null);
        loadNetBoxData();
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddingDevice(false);
    }
  };

  useEffect(() => {
    if (netboxStatus?.ok) loadNetBoxData();
  }, [netboxStatus, loadNetBoxData]);

  // ── Load ARP data ──
  const loadArpData = useCallback(async () => {
    setArpLoading(true);
    try {
      const res = await fetch('/api/arp-table?subnet=192.168.2');
      const data = await res.json();
      if (!data.error) setArpData(data);
    } catch { /* ignore */ }
    setArpLoading(false);
  }, []);

  useEffect(() => {
    loadArpData();
  }, [loadArpData]);

  // ── Load DHCP Leases ──
  const loadDhcpLeases = useCallback(async () => {
    setDhcpLoading(true);
    try {
      const res = await fetch('/api/network/dhcp');
      const data = await res.json();
      if (data.leases) {
        setDhcpLeases(data.leases);
      }
      setDhcpStatus({
        configured: data.configured,
        simulated: data.simulated,
        error: data.error
      });
    } catch (err) {
      setDhcpStatus({
        configured: false,
        simulated: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    setDhcpLoading(false);
  }, []);

  useEffect(() => {
    loadDhcpLeases();
  }, [loadDhcpLeases]);

  // ── Load Nmap scans ──
  const loadScans = useCallback(async () => {
    try {
      const res = await fetch('/api/nmap?action=scans');
      const data = await res.json();
      setScans(data.scans || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (nmapStatus?.ok) loadScans();
  }, [nmapStatus, loadScans]);

  // ── Start Nmap scan ──
  const handleStartScan = async () => {
    if (isScanning || !scanTarget) return;
    setIsScanning(true);
    setActiveScan(null);

    try {
      const res = await fetch('/api/nmap?action=scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: scanTarget, scan_type: scanType }),
      });
      const data = await res.json();

      if (data.error) {
        setActiveScan({ id: '', target: scanTarget, scan_type: scanType, status: 'error', error: data.error });
        setIsScanning(false);
        return;
      }

      const scanId = data.scan_id;
      setActiveScan({
        id: scanId, target: scanTarget, scan_type: scanType, status: 'queued',
        progress: 0, progress_message: 'Starting...',
      });

      // Poll for results every 2s
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/nmap?action=result&id=${scanId}`);
          const result = await r.json();
          setActiveScan(result);

          if (['completed', 'error', 'cancelled'].includes(result.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsScanning(false);
            loadScans();
          }
        } catch {
          // Network error — don't stop polling, nmap might still be working
        }
      }, 2000);
    } catch (err) {
      setActiveScan({
        id: '', target: scanTarget, scan_type: scanType, status: 'error',
        error: `Failed to start scan: ${err instanceof Error ? err.message : String(err)}`,
      });
      setIsScanning(false);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Load past scan result ──
  const loadScanResult = async (scanId: string) => {
    try {
      const res = await fetch(`/api/nmap?action=result&id=${scanId}`);
      const data = await res.json();
      setActiveScan(data);
    } catch { /* ignore */ }
  };

  // ── Search NetBox ──
  const filteredDevices = nbSearch
    ? devices.filter(d =>
        d.name?.toLowerCase().includes(nbSearch.toLowerCase()) ||
        d.primary_ip?.address?.includes(nbSearch) ||
        d.primary_ip4?.address?.includes(nbSearch) ||
        d.device_type?.display?.toLowerCase().includes(nbSearch.toLowerCase()) ||
        d.role?.name?.toLowerCase().includes(nbSearch.toLowerCase())
      )
    : devices;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div>
      {/* Connection Status Banners */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{
          flex: 1, minWidth: '200px', padding: '12px 16px',
          background: netboxStatus?.ok ? '#f0fdf4' : '#fefce8',
          border: `1px solid ${netboxStatus?.ok ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '18px' }}>🗃️</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
              NetBox {netboxStatus?.ok ? `v${netboxStatus.version}` : ''}
            </div>
            <div style={{ fontSize: '12px', color: netboxStatus?.ok ? '#16a34a' : '#92400e', fontWeight: 500 }}>
              {netboxStatus === null ? 'Checking...' : netboxStatus.ok ? '● Connected' : `⚠ ${netboxStatus.error}`}
            </div>
          </div>
        </div>
        <div style={{
          flex: 1, minWidth: '200px', padding: '12px 16px',
          background: nmapStatus?.ok ? '#f0fdf4' : '#fefce8',
          border: `1px solid ${nmapStatus?.ok ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '18px' }}>🔍</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
              Nmap Scanner {nmapStatus?.ok ? `v${nmapStatus.nmapVersion}` : ''}
            </div>
            <div style={{ fontSize: '12px', color: nmapStatus?.ok ? '#16a34a' : '#92400e', fontWeight: 500 }}>
              {nmapStatus === null ? 'Checking...' : nmapStatus.ok ? '● Connected' : `⚠ ${nmapStatus.error}`}
            </div>
          </div>
        </div>
      </div>

      {/* Section Toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: '#f1f5f9', borderRadius: '10px', padding: '4px' }}>
        {[
          { id: 'arp' as const, label: '📡 Network Map', count: arpData?.count },
          { id: 'dhcp' as const, label: '🔌 DHCP Leases', count: dhcpLeases.length },
          { id: 'netbox' as const, label: '🗃️ Inventory', count: overview?.devices },
          { id: 'nmap' as const, label: '🔍 Deep Scanner', count: undefined },
        ].map(sec => (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id)}
            style={{
              flex: 1, padding: '10px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              background: activeSection === sec.id ? '#fff' : 'transparent',
              boxShadow: activeSection === sec.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              color: activeSection === sec.id ? '#0f172a' : '#64748b',
              fontWeight: activeSection === sec.id ? 700 : 500,
              fontSize: '14px', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            {sec.label}
            {sec.count != null && (
              <span style={{
                padding: '1px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                background: activeSection === sec.id ? '#2563eb' : '#cbd5e1',
                color: activeSection === sec.id ? '#fff' : '#475569',
              }}>
                {sec.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── ARP Network Map Section ─── */}
      {activeSection === 'arp' && (() => {
        const entries = arpData?.entries || [];
        // Vendor stats
        const vendorCounts: Record<string, number> = {};
        entries.forEach(e => {
          const v = e.vendor || 'Unknown';
          vendorCounts[v] = (vendorCounts[v] || 0) + 1;
        });
        const sortedVendors = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]);

        // Filter entries
        const filtered = entries.filter(e => {
          const matchesSearch = !arpSearch || 
            e.ip.includes(arpSearch) || 
            e.mac.toLowerCase().includes(arpSearch.toLowerCase()) ||
            (e.vendor || '').toLowerCase().includes(arpSearch.toLowerCase());
          const matchesVendor = arpVendorFilter === 'all' || 
            (arpVendorFilter === 'unknown' ? !e.vendor : e.vendor === arpVendorFilter);
          return matchesSearch && matchesVendor;
        });


        return (
        <div>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'TOTAL DEVICES', value: entries.length, icon: '📡', color: '#2563eb' },
              { label: 'VENDORS', value: sortedVendors.filter(([v]) => v !== 'Unknown').length, icon: '🏭', color: '#16a34a' },
              { label: 'UNIDENTIFIED', value: vendorCounts['Unknown'] || 0, icon: '❓', color: '#d97706' },
              { label: 'DATA SOURCE', value: 'ARP', icon: '🔗', color: '#7c3aed', isText: true },
            ].map(card => (
              <div key={card.label} style={{
                padding: '14px 18px', background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {card.icon} {card.label}
                </div>
                <div style={{ fontSize: (card as {isText?: boolean}).isText ? '18px' : '32px', fontWeight: 800, color: card.color, marginTop: '4px' }}>
                  {(card as {isText?: boolean}).isText ? 'LibreNMS SNMP' : card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Vendor Breakdown Bar */}
          {sortedVendors.length > 0 && (
            <div style={{
              padding: '14px 18px', background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: '12px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '10px' }}>
                Vendor Distribution
              </div>
              <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', marginBottom: '10px' }}>
                {sortedVendors.map(([vendor, count]) => (
                  <div
                    key={vendor}
                    title={`${vendor}: ${count} devices`}
                    style={{
                      width: `${(count / entries.length) * 100}%`,
                      background: getVendorColor(vendor),
                      transition: 'width 0.3s',
                      cursor: 'pointer',
                    }}
                    onClick={() => setArpVendorFilter(arpVendorFilter === vendor ? 'all' : vendor)}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {sortedVendors.slice(0, 10).map(([vendor, count]) => (
                  <span
                    key={vendor}
                    onClick={() => setArpVendorFilter(arpVendorFilter === vendor ? 'all' : (vendor === 'Unknown' ? 'unknown' : vendor))}
                    style={{
                      padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                      background: `${getVendorColor(vendor)}12`,
                      color: getVendorColor(vendor),
                      border: `1px solid ${getVendorColor(vendor)}30`,
                      cursor: 'pointer',
                      outline: arpVendorFilter === vendor || (arpVendorFilter === 'unknown' && vendor === 'Unknown') ? `2px solid ${getVendorColor(vendor)}` : 'none',
                      outlineOffset: '1px',
                    }}
                  >
                    {vendor} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search + Refresh */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
            <input
              type="text"
              value={arpSearch}
              onChange={e => setArpSearch(e.target.value)}
              placeholder="Search by IP, MAC, or vendor..."
              style={{
                flex: 1, padding: '10px 14px', border: '1px solid #cbd5e1',
                borderRadius: '8px', fontSize: '14px', background: '#fff', color: '#0f172a',
                fontFamily: 'monospace', outline: 'none',
              }}
            />
            {arpVendorFilter !== 'all' && (
              <button
                onClick={() => setArpVendorFilter('all')}
                style={{
                  padding: '10px 16px', background: '#fefce8', border: '1px solid #fde68a',
                  borderRadius: '8px', color: '#92400e', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                }}
              >
                ✕ Clear Filter
              </button>
            )}
            <button
              onClick={loadArpData}
              disabled={arpLoading}
              style={{
                padding: '10px 16px', background: arpLoading ? '#f8fafc' : '#eff6ff',
                border: `1px solid ${arpLoading ? '#e2e8f0' : '#bfdbfe'}`,
                borderRadius: '8px', color: arpLoading ? '#94a3b8' : '#2563eb', fontWeight: 600,
                fontSize: '13px', cursor: arpLoading ? 'wait' : 'pointer',
              }}
            >
              {arpLoading ? '⏳ Loading...' : '↻ Refresh'}
            </button>
          </div>

          {/* Device Table */}
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px',
            overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1.1fr 1.3fr 1fr 0.8fr 1.2fr',
              padding: '10px 16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
              fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              <span>IP Address</span>
              <span>MAC Address</span>
              <span>Vendor</span>
              <span>Seen By</span>
              <span>NetBox</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                {arpLoading ? '⏳ Loading ARP table...' : entries.length === 0 ? 'No ARP data available.' : 'No devices match your search.'}
              </div>
            ) : (
              filtered.map((entry, idx) => (
                <div key={entry.ip + entry.mac} style={{
                  display: 'grid', gridTemplateColumns: '1.1fr 1.3fr 1fr 0.8fr 1.2fr',
                  padding: '10px 16px', background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                  borderBottom: '1px solid #f1f5f9', alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                    {entry.ip}
                  </span>
                  <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace', fontWeight: 500 }}>
                    {entry.mac}
                  </span>
                  <span>
                    {entry.vendor ? (
                      <span style={{
                        padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                        background: `${getVendorColor(entry.vendor)}12`,
                        color: getVendorColor(entry.vendor),
                        border: `1px solid ${getVendorColor(entry.vendor)}30`,
                      }}>
                        {entry.vendor}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px', fontStyle: 'italic' }}>Unknown</span>
                    )}
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                    {entry.seenBy === '192.168.2.1' ? '🛡️ GW' : entry.seenBy?.split('.').pop() || '—'}
                  </span>
                  <span>
                    {isDeviceInNetBox(entry.ip) ? (
                      <span style={{
                        padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                        background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                        display: 'inline-flex', alignItems: 'center', gap: '4px'
                      }}>
                        🗃️ Sync'd
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          const defaultName = `device-${entry.ip.replace(/\./g, '-')}`;
                          setAddDeviceData({
                            ip: entry.ip,
                            name: defaultName,
                            vendor: entry.vendor,
                            roleId: netboxRoles[0]?.id ? String(netboxRoles[0].id) : '1',
                            siteId: netboxSites[0]?.id ? String(netboxSites[0].id) : '1',
                            deviceType: 'Network Device'
                          });
                          setShowAddDeviceModal(true);
                        }}
                        style={{
                          padding: '4px 10px', background: '#eff6ff', border: '1px solid #bfdbfe',
                          borderRadius: '6px', color: '#2563eb', fontWeight: 600, fontSize: '11px',
                          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#2563eb'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2563eb'; }}
                      >
                        ➕ Add
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
            <span>Showing {filtered.length} of {entries.length} devices</span>
            {arpData?.timestamp && (
              <span>Last updated: {new Date(arpData.timestamp).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        );
      })()}

      {/* ─── NetBox Section ─── */}
      {activeSection === 'netbox' && (
        <div>
          {/* Summary Cards */}
          {overview && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'DEVICES', value: overview.devices, icon: '🖥️', color: '#2563eb' },
                { label: 'IP ADDRESSES', value: overview.ipAddresses, icon: '🌐', color: '#16a34a' },
                { label: 'PREFIXES', value: overview.prefixes, icon: '📡', color: '#9333ea' },
                { label: 'VLANs', value: overview.vlans, icon: '🔀', color: '#ea580c' },
              ].map(card => (
                <div key={card.label} style={{
                  padding: '14px 18px', background: '#fff', border: '1px solid #e2e8f0',
                  borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {card.icon} {card.label}
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 800, color: card.color, marginTop: '4px' }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!netboxStatus?.ok && (
            <div style={{
              padding: '40px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: '14px', color: '#475569',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗃️</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                NetBox Not Connected
              </div>
              <div style={{ fontSize: '14px', maxWidth: '500px', margin: '0 auto', lineHeight: '1.6' }}>
                Deploy NetBox using the Docker Compose file, then add your API token to <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>.env.local</code>
              </div>
              <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: '#334155' }}>
                docker compose -f docker-compose.phase1.yml up -d
              </div>
            </div>
          )}

          {netboxStatus?.ok && (
            <>
              {/* NetBox Sub-Section Toggle */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: '#f1f5f9', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
                {[
                  { id: 'devices' as const, label: '🖥️ Devices' },
                  { id: 'regions' as const, label: '🗺️ Regions' },
                  { id: 'site-groups' as const, label: '🏢 Site Groups' },
                  { id: 'locations' as const, label: '📍 Locations' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setNetboxSubSection(sub.id)}
                    style={{
                      padding: '8px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                      background: netboxSubSection === sub.id ? '#fff' : 'transparent',
                      boxShadow: netboxSubSection === sub.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      color: netboxSubSection === sub.id ? '#0f172a' : '#64748b',
                      fontWeight: netboxSubSection === sub.id ? 700 : 500,
                      fontSize: '13px', transition: 'all 0.15s',
                    }}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {/* ─── Sub-Section 1: Devices ─── */}
              {netboxSubSection === 'devices' && (
                <>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
                    <input
                      type="text"
                      value={nbSearch}
                      onChange={e => setNbSearch(e.target.value)}
                      placeholder="Search devices, IPs, roles..."
                      style={{
                        flex: 1, padding: '10px 14px', border: '1px solid #cbd5e1',
                        borderRadius: '8px', fontSize: '14px', background: '#fff', color: '#0f172a',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => handleSync(false)}
                      disabled={isSyncing}
                      style={{
                        padding: '10px 16px', background: isSyncing ? '#f8fafc' : '#f0fdf4',
                        border: `1px solid ${isSyncing ? '#e2e8f0' : '#bbf7d0'}`,
                        borderRadius: '8px', color: isSyncing ? '#94a3b8' : '#16a34a', fontWeight: 600,
                        fontSize: '13px', cursor: isSyncing ? 'wait' : 'pointer',
                      }}
                    >
                      {isSyncing ? '⏳ Syncing...' : '🔄 Sync New'}
                    </button>
                    <button
                      onClick={() => setShowSyncOptionsModal(true)}
                      disabled={isSyncing}
                      style={{
                        padding: '10px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1',
                        borderRadius: '8px', color: '#475569', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                    >
                      ⚙️ Filter Sync
                    </button>
                    <button
                      onClick={() => { if (confirm('This will delete all devices in NetBox and re-sync from LibreNMS with updated role detection. Continue?')) handleSync(true); }}
                      disabled={isSyncing}
                      style={{
                        padding: '10px 16px', background: isSyncing ? '#f8fafc' : '#fefce8',
                        border: `1px solid ${isSyncing ? '#e2e8f0' : '#fde68a'}`,
                        borderRadius: '8px', color: isSyncing ? '#94a3b8' : '#92400e', fontWeight: 600,
                        fontSize: '13px', cursor: isSyncing ? 'wait' : 'pointer',
                      }}
                    >
                      🔁 Re-Sync All
                    </button>
                    <button
                      onClick={loadNetBoxData}
                      style={{
                        padding: '10px 16px', background: '#eff6ff', border: '1px solid #bfdbfe',
                        borderRadius: '8px', color: '#2563eb', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                      }}
                    >
                      ↻ Refresh
                    </button>
                  </div>

                  <div style={{
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px',
                    overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    {/* Header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr 0.8fr',
                      padding: '10px 16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
                      fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      <span>Device</span>
                      <span>IP Address</span>
                      <span>Role</span>
                      <span>Type</span>
                      <span>Status</span>
                    </div>

                    {filteredDevices.length === 0 ? (
                      <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                        {devices.length === 0 ? (
                          <div>
                            <div style={{ marginBottom: '12px' }}>No devices in NetBox yet.</div>
                            <button
                              onClick={() => handleSync(false)}
                              disabled={isSyncing}
                              style={{
                                padding: '10px 24px', border: 'none', borderRadius: '8px',
                                background: isSyncing ? '#94a3b8' : '#2563eb', color: '#fff',
                                fontWeight: 700, fontSize: '14px', cursor: isSyncing ? 'wait' : 'pointer',
                                transition: 'background 0.2s',
                              }}
                            >
                              {isSyncing ? '⏳ Syncing...' : '🔄 Sync from LibreNMS'}
                            </button>
                          </div>
                        ) : 'No devices match your search.'}
                      </div>
                    ) : (
                      filteredDevices.map((dev, idx) => (
                        <div key={dev.id} style={{
                          display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr 0.8fr',
                          padding: '12px 16px', background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                          borderBottom: '1px solid #f1f5f9', alignItems: 'center',
                          transition: 'background 0.15s', cursor: 'pointer',
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                          onClick={() => setEditingNetBoxDevice(dev)}
                        >
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{dev.name}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {dev.device_type?.manufacturer?.name && (
                                <span>{dev.device_type.manufacturer.name} — {dev.device_type.display}</span>
                              )}
                              {dev.site && <span style={{ color: '#0284c7' }}>🏢 {dev.site.name}</span>}
                              {dev.location && <span style={{ color: '#7c3aed' }}>📍 {dev.location.name}</span>}
                            </div>
                          </div>
                          <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace', fontWeight: 500 }}>
                            {dev.primary_ip4?.address || dev.primary_ip?.address || '—'}
                          </span>
                          <span>
                            {dev.role ? (
                              <span style={{
                                padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                                background: `#${dev.role.color}18`, color: `#${dev.role.color}`,
                                border: `1px solid #${dev.role.color}40`,
                              }}>
                                {dev.role.name}
                              </span>
                            ) : <span style={{ color: '#94a3b8', fontSize: '13px' }}>—</span>}
                          </span>
                          <span style={{ fontSize: '13px', color: '#475569' }}>
                            {dev.platform?.name || dev.device_type?.display || '—'}
                          </span>
                          <span>
                            <span style={{
                              padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                              background: dev.status?.value === 'active' ? '#f0fdf4' : '#fefce8',
                              color: dev.status?.value === 'active' ? '#16a34a' : '#92400e',
                              border: `1px solid ${dev.status?.value === 'active' ? '#bbf7d0' : '#fde68a'}`,
                            }}>
                              {dev.status?.label || 'Unknown'}
                            </span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
                    Showing {filteredDevices.length} of {devices.length} devices (Click a device to edit/populate site & location)
                  </div>
                </>
              )}

              {/* ─── Sub-Section 2: Regions ─── */}
              {netboxSubSection === 'regions' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
                  {/* Regions List */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      Regions List
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {netboxRegions.map(reg => (
                        <div key={reg.id} style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{reg.name}</span>
                            <span style={{ fontSize: '11px', color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '10px', fontFamily: 'monospace' }}>
                              {reg.slug}
                            </span>
                          </div>
                          {reg.description && (
                            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>{reg.description}</div>
                          )}
                          <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '6px', fontWeight: 600 }}>
                            📍 {reg.site_count || 0} Sites in Region
                          </div>
                        </div>
                      ))}
                      {netboxRegions.length === 0 && (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                          No regions created in NetBox yet. Use the form on the right to add one.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Add Region Form */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      ➕ Create New Region
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Region Name
                        </label>
                        <input
                          type="text"
                          value={newRegionData.name}
                          onChange={e => {
                            const name = e.target.value;
                            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                            setNewRegionData({ ...newRegionData, name, slug });
                          }}
                          placeholder="e.g. Jalisco, Mexico"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Slug
                        </label>
                        <input
                          type="text"
                          value={newRegionData.slug}
                          onChange={e => setNewRegionData({ ...newRegionData, slug: e.target.value })}
                          placeholder="e.g. jalisco"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Description
                        </label>
                        <textarea
                          value={newRegionData.description}
                          onChange={e => setNewRegionData({ ...newRegionData, description: e.target.value })}
                          placeholder="Region details..."
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', minHeight: '60px', resize: 'vertical' }}
                        />
                      </div>
                      <button
                        onClick={handleCreateRegion}
                        style={{ padding: '10px', background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', marginTop: '10px' }}
                      >
                        Create Region
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Sub-Section 3: Site Groups ─── */}
              {netboxSubSection === 'site-groups' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
                  {/* Site Groups List */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      Site Groups List
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {netboxSiteGroups.map(sg => (
                        <div key={sg.id} style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{sg.name}</span>
                            <span style={{ fontSize: '11px', color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '10px', fontFamily: 'monospace' }}>
                              {sg.slug}
                            </span>
                          </div>
                          {sg.description && (
                            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>{sg.description}</div>
                          )}
                          <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '6px', fontWeight: 600 }}>
                            🏢 {sg.site_count || 0} Sites in Group
                          </div>
                        </div>
                      ))}
                      {netboxSiteGroups.length === 0 && (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                          No site groups created in NetBox yet. Use the form on the right to add one.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Add Site Group Form */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      🏢 Create New Site Group
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Site Group Name
                        </label>
                        <input
                          type="text"
                          value={newSiteGroupData.name}
                          onChange={e => {
                            const name = e.target.value;
                            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                            setNewSiteGroupData({ ...newSiteGroupData, name, slug });
                          }}
                          placeholder="e.g. Offices, Factories"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Slug
                        </label>
                        <input
                          type="text"
                          value={newSiteGroupData.slug}
                          onChange={e => setNewSiteGroupData({ ...newSiteGroupData, slug: e.target.value })}
                          placeholder="e.g. offices"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Description
                        </label>
                        <textarea
                          value={newSiteGroupData.description}
                          onChange={e => setNewSiteGroupData({ ...newSiteGroupData, description: e.target.value })}
                          placeholder="Site group details..."
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', minHeight: '60px', resize: 'vertical' }}
                        />
                      </div>
                      <button
                        onClick={handleCreateSiteGroup}
                        style={{ padding: '10px', background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', marginTop: '10px' }}
                      >
                        Create Site Group
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Sub-Section 4: Locations ─── */}
              {netboxSubSection === 'locations' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
                  {/* Locations List */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      Locations List
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {netboxLocations.map(loc => (
                        <div key={loc.id} style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{loc.name}</span>
                            <span style={{ fontSize: '11px', color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '10px', fontFamily: 'monospace' }}>
                              {loc.slug}
                            </span>
                          </div>
                          {loc.site && (
                            <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '4px', fontWeight: 600 }}>
                              🏢 Site: {loc.site.name}
                            </div>
                          )}
                          {loc.description && (
                            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>{loc.description}</div>
                          )}
                          <div style={{ fontSize: '11px', color: '#7c3aed', marginTop: '6px', fontWeight: 600 }}>
                            🖥️ {loc.device_count || 0} Devices in Location
                          </div>
                        </div>
                      ))}
                      {netboxLocations.length === 0 && (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                          No locations created in NetBox yet. Use the form on the right to add one.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Add Location Form */}
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      📍 Create New Location
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Location Name
                        </label>
                        <input
                          type="text"
                          value={newLocationData.name}
                          onChange={e => {
                            const name = e.target.value;
                            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                            setNewLocationData({ ...newLocationData, name, slug });
                          }}
                          placeholder="e.g. Server Room, Rack A"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Slug
                        </label>
                        <input
                          type="text"
                          value={newLocationData.slug}
                          onChange={e => setNewLocationData({ ...newLocationData, slug: e.target.value })}
                          placeholder="e.g. server-room"
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Select Site
                        </label>
                        <select
                          value={newLocationData.siteId}
                          onChange={e => setNewLocationData({ ...newLocationData, siteId: e.target.value })}
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                        >
                          <option value="">-- Choose Site --</option>
                          {netboxSites.map(site => (
                            <option key={site.id} value={site.id}>
                              {site.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Description
                        </label>
                        <textarea
                          value={newLocationData.description}
                          onChange={e => setNewLocationData({ ...newLocationData, description: e.target.value })}
                          placeholder="Location details..."
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', minHeight: '60px', resize: 'vertical' }}
                        />
                      </div>
                      <button
                        onClick={handleCreateLocation}
                        style={{ padding: '10px', background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', marginTop: '10px' }}
                      >
                        Create Location
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Sync Results */}
              {syncResult && (
                <div style={{
                  marginTop: '14px', padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0',
                  borderRadius: '12px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#15803d' }}>
                      ✅ Sync Complete
                    </span>
                    <button
                      onClick={() => setSyncResult(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#64748b' }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: '#475569' }}>
                      📦 Total: <strong>{syncResult.total}</strong>
                    </span>
                    <span style={{ fontSize: '14px', color: '#16a34a' }}>
                      ✅ Created: <strong>{syncResult.created}</strong>
                    </span>
                    <span style={{ fontSize: '14px', color: '#d97706' }}>
                      ⏩ Skipped: <strong>{syncResult.skipped}</strong>
                    </span>
                    {syncResult.errors > 0 && (
                      <span style={{ fontSize: '14px', color: '#dc2626' }}>
                        ❌ Errors: <strong>{syncResult.errors}</strong>
                      </span>
                    )}
                  </div>
                  {syncResult.details.filter(d => d.status !== 'skipped').length > 0 && (
                    <div style={{ maxHeight: '200px', overflow: 'auto', fontSize: '13px' }}>
                      {syncResult.details.filter(d => d.status !== 'skipped').map((d, i) => (
                        <div key={i} style={{
                          padding: '6px 10px', background: i % 2 === 0 ? '#fff' : '#f0fdf4',
                          borderRadius: '4px', display: 'flex', gap: '10px', alignItems: 'center',
                        }}>
                          <span style={{ color: d.status === 'created' ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                            {d.status === 'created' ? '✅' : '❌'}
                          </span>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{d.name}</span>
                          <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{d.ip}</span>
                          {d.reason && <span style={{ color: '#dc2626', fontSize: '12px' }}>{d.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sync Error */}
              {syncError && (
                <div style={{
                  marginTop: '14px', padding: '14px 16px', background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: '10px', color: '#dc2626', fontSize: '14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>⚠️ {syncError}</span>
                  <button
                    onClick={() => setSyncError(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626' }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Nmap Scanner Section ─── */}
      {activeSection === 'nmap' && (
        <div>
          {!nmapStatus?.ok ? (
            <div style={{
              padding: '40px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: '14px', color: '#475569',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                Nmap Scanner Not Connected
              </div>
              <div style={{ fontSize: '14px', maxWidth: '500px', margin: '0 auto', lineHeight: '1.6' }}>
                Deploy the Nmap API wrapper using Docker Compose:
              </div>
              <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: '#334155' }}>
                docker compose -f docker-compose.phase1.yml up -d nmap-api
              </div>
            </div>
          ) : (
            <>
              {/* Scan Controls */}
              <div style={{
                padding: '16px', background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: '12px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
                  🚀 Launch Scan
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={scanTarget}
                    onChange={e => setScanTarget(e.target.value)}
                    placeholder="192.168.2.0/24 or single IP"
                    style={{
                      flex: 1, minWidth: '200px', padding: '10px 14px', border: '1px solid #cbd5e1',
                      borderRadius: '8px', fontSize: '14px', background: '#fff', color: '#0f172a',
                      fontFamily: 'monospace',
                    }}
                    disabled={isScanning}
                  />
                  <select
                    value={scanType}
                    onChange={e => setScanType(e.target.value)}
                    style={{
                      padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px',
                      fontSize: '13px', background: '#fff', color: '#0f172a', cursor: 'pointer',
                    }}
                    disabled={isScanning}
                  >
                    <option value="quick">Quick — Ping sweep</option>
                    <option value="ports">Ports — Top 100 ports</option>
                    <option value="full">Full — Services + OS</option>
                    <option value="os">OS — OS detection only</option>
                    <option value="aggressive">Aggressive — Everything</option>
                    <option value="vuln">Vuln — Vulnerability scan</option>
                  </select>
                  <button
                    onClick={handleStartScan}
                    disabled={isScanning || !scanTarget}
                    style={{
                      padding: '10px 24px', border: 'none', borderRadius: '8px', cursor: isScanning ? 'wait' : 'pointer',
                      background: isScanning ? '#94a3b8' : '#2563eb', color: '#fff',
                      fontWeight: 700, fontSize: '14px', transition: 'background 0.2s',
                    }}
                  >
                    {isScanning ? '⏳ Scanning...' : '🔍 Start Scan'}
                  </button>
                </div>

                {/* Scan type descriptions */}
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                  {scanType === 'quick' && 'Fast ping sweep — finds live hosts in seconds'}
                  {scanType === 'ports' && 'Scans top 100 ports — takes ~1 min per host'}
                  {scanType === 'full' && 'Service version + OS detection — takes ~2-3 min per host'}
                  {scanType === 'os' && 'OS fingerprinting only — takes ~1 min per host'}
                  {scanType === 'aggressive' && 'Full scan with scripts — takes ~5 min per host ⚠️'}
                  {scanType === 'vuln' && 'Vulnerability detection scripts — takes ~5 min per host ⚠️'}
                </div>
              </div>

              {/* Active Scan Progress */}
              {activeScan && ['queued', 'running'].includes(activeScan.status) && (
                <div style={{
                  padding: '18px 20px', background: '#fff', border: '1px solid #bfdbfe',
                  borderRadius: '12px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(37,99,235,0.08)',
                }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '18px', animation: 'spin 1.5s linear infinite' }}>🔄</span>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#1d4ed8' }}>
                          Scanning {activeScan.target}
                        </div>
                        <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                          {activeScan.progress_message || activeScan.status}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await fetch('/api/nmap?action=cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scan_id: activeScan.id }),
                          });
                        } catch { /* ignore */ }
                      }}
                      style={{
                        padding: '8px 16px', border: '1px solid #fecaca', borderRadius: '8px',
                        background: '#fef2f2', color: '#dc2626', fontWeight: 600, fontSize: '13px',
                        cursor: 'pointer', transition: 'all 0.2s',
                      }}
                    >
                      ✕ Cancel
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div style={{ width: '100%', height: '10px', background: '#e0e7ff', borderRadius: '5px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{
                      width: `${Math.max(activeScan.progress || 0, 2)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #3b82f6, #6366f1)',
                      borderRadius: '5px',
                      transition: 'width 0.5s ease-out',
                    }} />
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af' }}>
                      {activeScan.progress || 0}%
                    </span>
                    {(activeScan.hosts_total || 0) > 0 && (
                      <span style={{ fontSize: '13px', color: '#475569' }}>
                        🖥️ {activeScan.hosts_scanned || 0} / {activeScan.hosts_total} hosts
                      </span>
                    )}
                    {(activeScan.host_count || 0) > 0 && (
                      <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>
                        ✅ {activeScan.host_count} found
                      </span>
                    )}
                    {(activeScan.elapsed_seconds || 0) > 0 && (
                      <span style={{ fontSize: '13px', color: '#64748b', fontFamily: 'monospace' }}>
                        ⏱ {Math.floor((activeScan.elapsed_seconds || 0) / 60)}m {(activeScan.elapsed_seconds || 0) % 60}s
                      </span>
                    )}
                  </div>

                  {/* Per-host errors (if any during scan) */}
                  {activeScan.errors_list && activeScan.errors_list.length > 0 && (
                    <div style={{ marginTop: '10px', fontSize: '12px', color: '#d97706' }}>
                      ⚠️ {activeScan.errors_list.length} host(s) had errors
                    </div>
                  )}
                </div>
              )}

              {/* Cancelled State */}
              {activeScan?.status === 'cancelled' && (
                <div style={{
                  padding: '16px', background: '#fefce8', border: '1px solid #fde68a',
                  borderRadius: '10px', marginBottom: '14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#92400e' }}>
                      ⏹ Scan Cancelled
                    </span>
                    <span style={{ fontSize: '13px', color: '#a16207', marginLeft: '12px' }}>
                      {activeScan.progress_message}
                    </span>
                  </div>
                  {(activeScan.host_count || 0) > 0 && (
                    <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>
                      {activeScan.host_count} hosts collected before cancellation
                    </span>
                  )}
                </div>
              )}

              {/* Scan Results */}
              {activeScan?.status === 'completed' && activeScan.results && (() => {
                // ── Known false-positive OS fingerprints ──
                // These are generic fingerprints that Nmap returns when it only has ICMP data
                const FALSE_POSITIVE_OS = [
                  'sanyo plc', 'axis 2100', 'dell integrated',
                  'brother hl', 'buffalo linkstation',
                ];

                const isReliableOS = (host: NmapHostResult) => {
                  if (host.os_matches.length === 0) return false;
                  const name = host.os_matches[0].name.toLowerCase();
                  const openPorts = host.ports.filter(p => p.state === 'open').length;
                  // If no open ports, OS detection is ICMP-only and unreliable
                  if (openPorts === 0 && FALSE_POSITIVE_OS.some(fp => name.includes(fp))) return false;
                  return true;
                };

                const getOSDisplay = (host: NmapHostResult) => {
                  if (!isReliableOS(host)) {
                    const openPorts = host.ports.filter(p => p.state === 'open').length;
                    if (openPorts === 0) return { name: 'Ping only — no TCP data', reliable: false };
                    return { name: 'Unknown', reliable: false };
                  }
                  return { name: host.os_matches[0].name, reliable: true, accuracy: host.os_matches[0].accuracy };
                };

                // Filter results
                const filteredResults = hideEmptyHosts
                  ? activeScan.results.filter(h => {
                      const openPorts = h.ports.filter(p => p.state === 'open').length;
                      return openPorts > 0 || isReliableOS(h);
                    })
                  : activeScan.results;

                const hiddenCount = (activeScan.results?.length || 0) - filteredResults.length;

                return (
                <div style={{
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px',
                  overflow: 'hidden', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{
                    padding: '12px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#15803d' }}>
                      ✅ Scan Complete — {activeScan.host_count} hosts responded, {filteredResults.length} with services
                    </span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={hideEmptyHosts}
                          onChange={e => setHideEmptyHosts(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        Hide empty hosts {hiddenCount > 0 && <span style={{ color: '#94a3b8' }}>({hiddenCount} hidden)</span>}
                      </label>
                      <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                        Target: {activeScan.target}
                      </span>
                    </div>
                  </div>

                  {/* Results Header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.6fr 0.9fr 1.2fr',
                    padding: '10px 16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
                    fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                  }}>
                    <span>Host</span>
                    <span>OS Detection</span>
                    <span>Open Ports / Services</span>
                    <span>Vendor</span>
                    <span>NetBox</span>
                  </div>

                  {filteredResults.map((host, idx) => (
                    <div key={host.ip}>
                      <div
                        style={{
                          display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.6fr 0.9fr 1.2fr',
                          padding: '12px 16px', background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                          borderBottom: '1px solid #f1f5f9', alignItems: 'center',
                          cursor: 'pointer', transition: 'background 0.15s',
                        }}
                        onClick={() => setExpandedHost(expandedHost === host.ip ? null : host.ip)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                      >
                        {/* Host */}
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                            {host.ip}
                          </div>
                          {host.hostname && (
                            <div style={{ fontSize: '12px', color: '#64748b' }}>{host.hostname}</div>
                          )}
                          {host.mac_address && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{host.mac_address}</div>
                          )}
                        </div>

                        {/* OS — with false-positive filtering */}
                        <div>
                          {(() => {
                            const os = getOSDisplay(host);
                            if (!os.reliable) {
                              return <span style={{ color: '#94a3b8', fontSize: '12px', fontStyle: 'italic' }}>{os.name}</span>;
                            }
                            return (
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                                  {os.name.length > 40 ? os.name.slice(0, 40) + '...' : os.name}
                                </div>
                                <div style={{ fontSize: '11px', color: (os.accuracy || 0) >= 90 ? '#16a34a' : '#d97706', fontWeight: 500 }}>
                                  {os.accuracy}% confidence
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Ports */}
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {host.ports.filter(p => p.state === 'open').slice(0, 6).map(p => (
                            <span key={`${p.port}-${p.protocol}`} style={{
                              padding: '2px 8px', background: '#eff6ff', border: '1px solid #bfdbfe',
                              borderRadius: '4px', fontSize: '11px', color: '#1d4ed8', fontFamily: 'monospace',
                              fontWeight: 500,
                            }}>
                              {p.port}/{p.service || p.protocol}
                            </span>
                          ))}
                          {host.ports.filter(p => p.state === 'open').length > 6 && (
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              +{host.ports.filter(p => p.state === 'open').length - 6} more
                            </span>
                          )}
                          {host.ports.filter(p => p.state === 'open').length === 0 && (
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>No open ports</span>
                          )}
                        </div>

                        {/* Vendor */}
                        <span style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>
                          {host.vendor || '—'}
                        </span>

                        {/* NetBox */}
                        <span onClick={e => e.stopPropagation()}>
                          {isDeviceInNetBox(host.ip) ? (
                            <span style={{
                              padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                              background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                              display: 'inline-flex', alignItems: 'center', gap: '4px'
                            }}>
                              🗃️ Sync'd
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                const defaultName = host.hostname || `device-${host.ip.replace(/\./g, '-')}`;
                                const calculatedType = getOSDisplay(host).name.toLowerCase().includes('windows') ? 'Workstation' : (getOSDisplay(host).name.toLowerCase().includes('linux') || getOSDisplay(host).name.toLowerCase().includes('server') ? 'Server' : 'Network Device');
                                setAddDeviceData({
                                  ip: host.ip,
                                  name: defaultName,
                                  vendor: host.vendor,
                                  roleId: netboxRoles[0]?.id ? String(netboxRoles[0].id) : '1',
                                  siteId: netboxSites[0]?.id ? String(netboxSites[0].id) : '1',
                                  deviceType: calculatedType
                                });
                                setShowAddDeviceModal(true);
                              }}
                              style={{
                                padding: '4px 10px', background: '#eff6ff', border: '1px solid #bfdbfe',
                                borderRadius: '6px', color: '#2563eb', fontWeight: 600, fontSize: '11px',
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px',
                                transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#2563eb'; e.currentTarget.style.color = '#fff'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2563eb'; }}
                            >
                              ➕ Add
                            </button>
                          )}
                        </span>
                      </div>

                      {/* Expanded Host Detail */}
                      {expandedHost === host.ip && (
                        <div style={{
                          padding: '16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
                        }}>
                          {/* OS Matches */}
                          {host.os_matches.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '6px' }}>
                                OS Detection Results
                              </div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {host.os_matches.map((os, i) => (
                                  <span key={i} style={{
                                    padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0',
                                    borderRadius: '6px', fontSize: '13px',
                                    color: os.accuracy >= 90 ? '#15803d' : os.accuracy >= 70 ? '#92400e' : '#475569',
                                    fontWeight: os.accuracy >= 90 ? 600 : 400,
                                  }}>
                                    {os.name} <span style={{ fontWeight: 700 }}>({os.accuracy}%)</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Port Details Table */}
                          {host.ports.filter(p => p.state === 'open').length > 0 && (
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '6px' }}>
                                Open Ports & Services
                              </div>
                              <div style={{
                                display: 'grid', gridTemplateColumns: '80px 100px 1fr 1fr',
                                gap: '1px', background: '#e2e8f0', borderRadius: '8px', overflow: 'hidden',
                              }}>
                                <div style={{ padding: '6px 10px', background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: '#475569' }}>PORT</div>
                                <div style={{ padding: '6px 10px', background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: '#475569' }}>SERVICE</div>
                                <div style={{ padding: '6px 10px', background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: '#475569' }}>PRODUCT</div>
                                <div style={{ padding: '6px 10px', background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: '#475569' }}>VERSION</div>
                                {host.ports.filter(p => p.state === 'open').map(p => (
                                  <>
                                    <div key={`${p.port}-port`} style={{ padding: '6px 10px', background: '#fff', fontSize: '13px', fontFamily: 'monospace', color: '#0f172a', fontWeight: 600 }}>
                                      {p.port}/{p.protocol}
                                    </div>
                                    <div key={`${p.port}-svc`} style={{ padding: '6px 10px', background: '#fff', fontSize: '13px', color: '#334155' }}>
                                      {p.service || '—'}
                                    </div>
                                    <div key={`${p.port}-prod`} style={{ padding: '6px 10px', background: '#fff', fontSize: '13px', color: '#475569' }}>
                                      {p.product || '—'}
                                    </div>
                                    <div key={`${p.port}-ver`} style={{ padding: '6px 10px', background: '#fff', fontSize: '13px', color: '#64748b', fontFamily: 'monospace' }}>
                                      {p.version || '—'}
                                    </div>
                                  </>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                );
              })()}

              {/* Error State */}
              {activeScan?.status === 'error' && (
                <div style={{
                  padding: '16px', background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: '12px', marginBottom: '14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#dc2626' }}>
                      ⚠️ Scan Failed
                    </span>
                    <button
                      onClick={() => setActiveScan(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626' }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ fontSize: '14px', color: '#991b1b', lineHeight: '1.5' }}>
                    {activeScan.error}
                  </div>
                  <button
                    onClick={handleStartScan}
                    style={{
                      marginTop: '12px', padding: '8px 20px', border: 'none', borderRadius: '8px',
                      background: '#dc2626', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    }}
                  >
                    🔄 Retry Scan
                  </button>
                </div>
              )}

              {/* Scan History */}
              {scans.length > 0 && (
                <div style={{
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px',
                  overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{
                    padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
                    fontSize: '14px', fontWeight: 700, color: '#0f172a',
                  }}>
                    📋 Scan History
                  </div>
                  {scans.slice(0, 10).map((scan, idx) => (
                    <div
                      key={scan.id}
                      onClick={() => loadScanResult(scan.id)}
                      style={{
                        display: 'grid', gridTemplateColumns: '80px 1fr 100px 100px 120px',
                        padding: '10px 16px', background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                        borderBottom: '1px solid #f1f5f9', alignItems: 'center',
                        cursor: 'pointer', transition: 'background 0.15s', fontSize: '13px',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                    >
                      <span style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>#{scan.id}</span>
                      <span style={{ color: '#0f172a', fontFamily: 'monospace' }}>{scan.target}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                        background: scan.scan_type === 'aggressive' ? '#fef2f2' : '#eff6ff',
                        color: scan.scan_type === 'aggressive' ? '#dc2626' : '#2563eb',
                        border: `1px solid ${scan.scan_type === 'aggressive' ? '#fecaca' : '#bfdbfe'}`,
                        textTransform: 'uppercase', textAlign: 'center',
                      }}>
                        {scan.scan_type}
                      </span>
                      <span style={{
                        color: scan.status === 'completed' ? '#16a34a' : scan.status === 'error' ? '#dc2626' : scan.status === 'cancelled' ? '#92400e' : '#d97706',
                        fontWeight: 600, fontSize: '12px',
                      }}>
                        {scan.status === 'running'
                          ? `${scan.progress || 0}% (${scan.hosts_scanned || 0}/${scan.hosts_total || '?'})`
                          : scan.status === 'completed'
                            ? `✅ ${scan.host_count} hosts`
                            : scan.status === 'cancelled'
                              ? `⏹ ${scan.host_count || 0} hosts`
                              : scan.status}
                      </span>
                      <span style={{ color: '#64748b', fontSize: '12px' }}>
                        {scan.created_at ? new Date(scan.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── DHCP Leases Section ─── */}
      {activeSection === 'dhcp' && (() => {
        // Filter leases
        const filtered = dhcpLeases.filter(entry => {
          const matchesSearch = !dhcpSearch ||
            entry.ip.includes(dhcpSearch) ||
            entry.mac.toLowerCase().includes(dhcpSearch.toLowerCase()) ||
            (entry.hostname || '').toLowerCase().includes(dhcpSearch.toLowerCase()) ||
            (entry.vendor || '').toLowerCase().includes(dhcpSearch.toLowerCase());
          const matchesType = dhcpTypeFilter === 'all' || entry.type === dhcpTypeFilter;
          return matchesSearch && matchesType;
        });

        const totalLeases = dhcpLeases.length;
        const dynamicCount = dhcpLeases.filter(l => l.type === 'dynamic').length;
        const reservedCount = dhcpLeases.filter(l => l.type === 'reserved').length;

        return (
          <div>
            {/* Connection / Status Banner */}
            {dhcpStatus && (
              <div style={{
                padding: '12px 16px',
                background: dhcpStatus.error ? '#fef2f2' : dhcpStatus.simulated ? '#fefce8' : '#f0fdf4',
                border: `1px solid ${dhcpStatus.error ? '#fecaca' : dhcpStatus.simulated ? '#fde68a' : '#bbf7d0'}`,
                borderRadius: '10px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                fontWeight: 500,
                color: dhcpStatus.error ? '#dc2626' : dhcpStatus.simulated ? '#92400e' : '#16a34a',
              }}>
                <span style={{ fontSize: '16px' }}>
                  {dhcpStatus.error ? '⚠️' : dhcpStatus.simulated ? '🔌' : '🟢'}
                </span>
                <div>
                  {dhcpStatus.error ? (
                    <>FortiGate API Connection Failed: {dhcpStatus.error}</>
                  ) : dhcpStatus.simulated ? (
                    <>Using simulated DHCP leases. Configure <code>FORTIGATE_API_URL</code> and <code>FORTIGATE_API_TOKEN</code> to query the gateway.</>
                  ) : (
                    <>Connected to FortiGate Gateway. Active DHCP lease discovery is enabled.</>
                  )}
                </div>
              </div>
            )}

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'ACTIVE LEASES', value: totalLeases, icon: '🔌', color: '#2563eb' },
                { label: 'DYNAMIC LEASES', value: dynamicCount, icon: '🔄', color: '#16a34a' },
                { label: 'RESERVATIONS', value: reservedCount, icon: '📌', color: '#7c3aed' },
                { label: 'STATUS', value: dhcpStatus?.simulated ? 'Simulated' : dhcpStatus?.error ? 'Offline' : 'Connected', icon: '⚡', color: dhcpStatus?.simulated ? '#d97706' : dhcpStatus?.error ? '#dc2626' : '#16a34a', isText: true },
              ].map(card => (
                <div key={card.label} style={{
                  padding: '14px 18px', background: '#fff', border: '1px solid #e2e8f0',
                  borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {card.icon} {card.label}
                  </div>
                  <div style={{ fontSize: card.isText ? '18px' : '32px', fontWeight: 800, color: card.color, marginTop: '4px' }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Search + Filter controls */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={dhcpSearch}
                onChange={e => setDhcpSearch(e.target.value)}
                placeholder="Search by IP, MAC, hostname, or vendor..."
                style={{
                  flex: 1, minWidth: '200px', padding: '10px 14px', border: '1px solid #cbd5e1',
                  borderRadius: '8px', fontSize: '14px', background: '#fff', color: '#0f172a',
                  fontFamily: 'monospace', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
                {(['all', 'dynamic', 'reserved'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setDhcpTypeFilter(type)}
                    style={{
                      padding: '6px 12px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                      background: dhcpTypeFilter === type ? '#fff' : 'transparent',
                      boxShadow: dhcpTypeFilter === type ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      color: dhcpTypeFilter === type ? '#0f172a' : '#64748b',
                      fontWeight: dhcpTypeFilter === type ? 700 : 500,
                      fontSize: '12px', textTransform: 'capitalize',
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <button
                onClick={loadDhcpLeases}
                disabled={dhcpLoading}
                style={{
                  padding: '10px 16px', background: dhcpLoading ? '#f8fafc' : '#eff6ff',
                  border: `1px solid ${dhcpLoading ? '#e2e8f0' : '#bfdbfe'}`,
                  borderRadius: '8px', color: dhcpLoading ? '#94a3b8' : '#2563eb', fontWeight: 600,
                  fontSize: '13px', cursor: dhcpLoading ? 'wait' : 'pointer',
                }}
              >
                {dhcpLoading ? '⏳ Loading...' : '↻ Refresh'}
              </button>
            </div>

            {/* Leases Table */}
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px',
              overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '0.9fr 1.2fr 1fr 0.8fr 1.4fr 0.7fr 1.1fr 1.1fr',
                padding: '10px 16px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
                fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                <span>IP Address</span>
                <span>MAC Address</span>
                <span>Hostname</span>
                <span>Type</span>
                <span>Expiry</span>
                <span>Interface</span>
                <span>Vendor</span>
                <span>NetBox</span>
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                  {dhcpLoading ? '⏳ Loading DHCP leases...' : dhcpLeases.length === 0 ? 'No DHCP lease data available.' : 'No leases match your search.'}
                </div>
              ) : (
                filtered.map((entry, idx) => (
                  <div key={entry.ip + entry.mac} style={{
                    display: 'grid', gridTemplateColumns: '0.9fr 1.2fr 1fr 0.8fr 1.4fr 0.7fr 1.1fr 1.1fr',
                    padding: '10px 16px', background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                    borderBottom: '1px solid #f1f5f9', alignItems: 'center',
                    transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                  >
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                      {entry.ip}
                    </span>
                    <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace', fontWeight: 500 }}>
                      {entry.mac}
                    </span>
                    <span style={{ fontSize: '13px', color: '#334155', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={entry.hostname}>
                      {entry.hostname || '—'}
                    </span>
                    <span>
                      <span style={{
                        padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                        background: entry.type === 'reserved' ? '#ecfdf5' : '#f1f5f9',
                        color: entry.type === 'reserved' ? '#047857' : '#475569',
                        border: `1px solid ${entry.type === 'reserved' ? '#a7f3d0' : '#e2e8f0'}`,
                        textTransform: 'capitalize'
                      }}>
                        {entry.type}
                      </span>
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontFamily: entry.type === 'reserved' ? 'sans-serif' : 'monospace' }}>
                      {entry.type === 'reserved' ? (
                        'Never'
                      ) : (
                        entry.expire && entry.expire !== 'Never' ? (
                          entry.expire.includes('T') ? (
                            new Date(entry.expire).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (' + new Date(entry.expire).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')'
                          ) : (
                            entry.expire
                          )
                        ) : '—'
                      )}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                      {entry.interface || '—'}
                    </span>
                    <span>
                      {entry.vendor ? (
                        <span style={{
                          padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                          background: `${getVendorColor(entry.vendor)}12`,
                          color: getVendorColor(entry.vendor),
                          border: `1px solid ${getVendorColor(entry.vendor)}30`,
                        }}>
                          {entry.vendor}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px', fontStyle: 'italic' }}>Unknown</span>
                      )}
                    </span>
                    <span>
                      {isDeviceInNetBox(entry.ip) ? (
                        <span style={{
                          padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                          background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          🗃️ Sync'd
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            const defaultName = entry.hostname && entry.hostname !== '—' ? entry.hostname : `device-${entry.ip.replace(/\./g, '-')}`;
                            setAddDeviceData({
                              ip: entry.ip,
                              name: defaultName,
                              vendor: entry.vendor,
                              roleId: netboxRoles[0]?.id ? String(netboxRoles[0].id) : '1',
                              siteId: netboxSites[0]?.id ? String(netboxSites[0].id) : '1',
                              deviceType: entry.type === 'reserved' ? 'Server' : 'Workstation'
                            });
                            setShowAddDeviceModal(true);
                          }}
                          style={{
                            padding: '4px 10px', background: '#eff6ff', border: '1px solid #bfdbfe',
                            borderRadius: '6px', color: '#2563eb', fontWeight: 600, fontSize: '11px',
                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#2563eb'; e.currentTarget.style.color = '#fff'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2563eb'; }}
                        >
                          ➕ Add
                        </button>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
              <span>Showing {filtered.length} of {totalLeases} leases</span>
            </div>
          </div>
        );
      })()}

      {/* ─── Add Device to NetBox Modal ─── */}
      {showAddDeviceModal && addDeviceData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', width: '90%', maxWidth: '480px',
            padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04)',
            border: '1px solid #e2e8f0', animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                🗃️ Add Device to NetBox
              </h3>
              <button
                onClick={() => { setShowAddDeviceModal(false); setAddDeviceData(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  IP Address
                </label>
                <input
                  type="text"
                  value={addDeviceData.ip}
                  disabled
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#f8fafc', color: '#64748b', fontFamily: 'monospace', fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Device Name
                </label>
                <input
                  type="text"
                  value={addDeviceData.name}
                  onChange={e => setAddDeviceData({ ...addDeviceData, name: e.target.value })}
                  placeholder="Enter custom name"
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Select NetBox Site
                </label>
                <select
                  value={addDeviceData.siteId}
                  onChange={e => setAddDeviceData({ ...addDeviceData, siteId: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  {netboxSites.map(site => (
                    <option key={site.id} value={String(site.id)}>
                      {site.name} ({site.slug})
                    </option>
                  ))}
                  {netboxSites.length === 0 && (
                    <option value="1">Default Site</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Select NetBox Role
                </label>
                <select
                  value={addDeviceData.roleId}
                  onChange={e => setAddDeviceData({ ...addDeviceData, roleId: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  {netboxRoles.map(role => (
                    <option key={role.id} value={String(role.id)}>
                      {role.name}
                    </option>
                  ))}
                  {netboxRoles.length === 0 && (
                    <option value="1">Unknown Role</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Device Type Hint (Mapped to Role Heuristic)
                </label>
                <input
                  type="text"
                  value={addDeviceData.deviceType}
                  onChange={e => setAddDeviceData({ ...addDeviceData, deviceType: e.target.value })}
                  placeholder="e.g. Workstation, Server, Switch, Camera"
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => { setShowAddDeviceModal(false); setAddDeviceData(null); }}
                style={{
                  padding: '10px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px',
                  color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddDeviceToNetBox}
                disabled={addingDevice}
                style={{
                  padding: '10px 20px', background: '#2563eb', border: 'none', borderRadius: '8px',
                  color: '#fff', fontWeight: 700, fontSize: '14px', cursor: addingDevice ? 'wait' : 'pointer',
                }}
              >
                {addingDevice ? '⏳ Adding...' : 'Confirm Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Sync Options Modal ─── */}
      {showSyncOptionsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', width: '90%', maxWidth: '440px',
            padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04)',
            border: '1px solid #e2e8f0', animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                ⚙️ Filtered Sync Options
              </h3>
              <button
                onClick={() => setShowSyncOptionsModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                  Sync Only Selected Roles:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {['server', 'network', 'printer', 'workstation', 'ip-phone', 'access-point', 'firewall', 'surveillance', 'unknown'].map(roleSlug => {
                    const isChecked = syncRolesFilter.includes(roleSlug);
                    return (
                      <label key={roleSlug} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSyncRolesFilter(syncRolesFilter.filter(x => x !== roleSlug));
                            } else {
                              setSyncRolesFilter([...syncRolesFilter, roleSlug]);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ textTransform: 'capitalize' }}>{roleSlug.replace('-', ' ')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Operating System filter (optional):
                </label>
                <input
                  type="text"
                  value={syncOsFilter}
                  onChange={e => setSyncOsFilter(e.target.value)}
                  placeholder="e.g. windows, fortios, linux (comma-separated)"
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '13px',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  Leave empty to sync all OS platforms.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button
                onClick={() => {
                  setSyncRolesFilter([]);
                  setSyncOsFilter('');
                }}
                style={{
                  padding: '10px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px',
                  color: '#475569', fontWeight: 600, fontSize: '13px', cursor: 'pointer', marginRight: 'auto'
                }}
              >
                Clear All
              </button>
              <button
                onClick={() => setShowSyncOptionsModal(false)}
                style={{
                  padding: '10px 16px', background: '#cbd5e1', border: 'none', borderRadius: '8px',
                  color: '#334155', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                }}
              >
                Save Filters
              </button>
              <button
                onClick={() => {
                  setShowSyncOptionsModal(false);
                  handleSync(false, syncRolesFilter, syncOsFilter);
                }}
                disabled={isSyncing}
                style={{
                  padding: '10px 20px', background: '#16a34a', border: 'none', borderRadius: '8px',
                  color: '#fff', fontWeight: 700, fontSize: '13px', cursor: isSyncing ? 'wait' : 'pointer',
                }}
              >
                🚀 Run Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit/Populate NetBox Device Modal ─── */}
      {editingNetBoxDevice && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', width: '90%', maxWidth: '480px',
            padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04)',
            border: '1px solid #e2e8f0', animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                ✏️ Edit & Populate Device
              </h3>
              <button
                onClick={() => setEditingNetBoxDevice(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Device Name
                </label>
                <input
                  type="text"
                  value={editingNetBoxDevice.name || ''}
                  onChange={e => setEditingNetBoxDevice({ ...editingNetBoxDevice, name: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  IP Address
                </label>
                <input
                  type="text"
                  value={editingNetBoxDevice.primary_ip4?.address || editingNetBoxDevice.primary_ip?.address || '—'}
                  disabled
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#f8fafc', color: '#64748b', fontFamily: 'monospace', fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Site
                </label>
                <select
                  value={editingNetBoxDevice.site?.id || ''}
                  onChange={e => {
                    const siteId = parseInt(e.target.value);
                    const selectedSiteObj = netboxSites.find(s => s.id === siteId);
                    setEditingNetBoxDevice({
                      ...editingNetBoxDevice,
                      site: selectedSiteObj ? { id: selectedSiteObj.id, name: selectedSiteObj.name, slug: selectedSiteObj.slug } : null,
                      location: null // Clear location if site changes
                    });
                  }}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  <option value="">Select a Site</option>
                  {netboxSites.map(site => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Location (within Site)
                </label>
                <select
                  value={editingNetBoxDevice.location?.id || ''}
                  onChange={e => {
                    const locId = parseInt(e.target.value);
                    const selectedLocObj = netboxLocations.find(l => l.id === locId);
                    setEditingNetBoxDevice({
                      ...editingNetBoxDevice,
                      location: selectedLocObj ? { id: selectedLocObj.id, name: selectedLocObj.name, slug: selectedLocObj.slug } : null
                    });
                  }}
                  disabled={!editingNetBoxDevice.site?.id}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: editingNetBoxDevice.site?.id ? '#fff' : '#f8fafc',
                    color: '#0f172a', fontSize: '14px', cursor: editingNetBoxDevice.site?.id ? 'pointer' : 'not-allowed',
                  }}
                >
                  <option value="">No Location (None)</option>
                  {netboxLocations
                    .filter(loc => loc.site?.id === editingNetBoxDevice.site?.id)
                    .map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Role
                </label>
                <select
                  value={editingNetBoxDevice.role?.id || ''}
                  onChange={e => {
                    const rId = parseInt(e.target.value);
                    const selectedRoleObj = netboxRoles.find(r => r.id === rId);
                    setEditingNetBoxDevice({
                      ...editingNetBoxDevice,
                      role: selectedRoleObj ? { id: selectedRoleObj.id, name: selectedRoleObj.name, slug: selectedRoleObj.slug, color: selectedRoleObj.color } : null
                    });
                  }}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  {netboxRoles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  Status
                </label>
                <select
                  value={editingNetBoxDevice.status?.value || 'active'}
                  onChange={e => setEditingNetBoxDevice({
                    ...editingNetBoxDevice,
                    status: { value: e.target.value, label: e.target.options[e.target.selectedIndex].text }
                  })}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                    background: '#fff', color: '#0f172a', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  <option value="active">Active</option>
                  <option value="offline">Offline</option>
                  <option value="planned">Planned</option>
                  <option value="staged">Staged</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setEditingNetBoxDevice(null)}
                style={{
                  padding: '10px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px',
                  color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingNetBoxDevice) {
                    handleUpdateNetBoxDevice(editingNetBoxDevice.id, {
                      name: editingNetBoxDevice.name,
                      site: editingNetBoxDevice.site?.id || null,
                      location: editingNetBoxDevice.location?.id || null,
                      role: editingNetBoxDevice.role?.id || null,
                      status: editingNetBoxDevice.status?.value || 'active',
                    });
                  }
                }}
                disabled={updatingDeviceLoading}
                style={{
                  padding: '10px 20px', background: '#2563eb', border: 'none', borderRadius: '8px',
                  color: '#fff', fontWeight: 700, fontSize: '14px', cursor: updatingDeviceLoading ? 'wait' : 'pointer',
                }}
              >
                {updatingDeviceLoading ? '⏳ Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
