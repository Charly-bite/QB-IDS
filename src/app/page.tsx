'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import MonitorCard from '@/components/MonitorCard';
import DatabaseCard from '@/components/DatabaseCard';
import NetworkCard, { type NetworkEvent } from '@/components/NetworkCard';
import EventLog from '@/components/EventLog';
import TopologyMap from '@/components/TopologyMap';
import TabNav from '@/components/TabNav';
import AlarmBanner, { useAlarmSound, sendNotification } from '@/components/AlarmBanner';
import LibreNMSCard from '@/components/LibreNMSCard';
import DeviceMetricsPanel from '@/components/DeviceMetricsPanel';

const TABS = [
  {
    id: 'production',
    label: 'Production',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
  },
  {
    id: 'development',
    label: 'QB-SAO',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    id: 'databases',
    label: 'Databases',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: 'network',
    label: 'Network',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="6" width="22" height="12" rx="2" />
        <line x1="6" y1="10" x2="6.01" y2="10" />
        <line x1="10" y1="10" x2="10.01" y2="10" />
        <line x1="14" y1="10" x2="14.01" y2="10" />
        <line x1="18" y1="10" x2="18.01" y2="10" />
      </svg>
    ),
  },
  {
    id: 'librenms',
    label: 'LibreNMS',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
];

// Developments organized by environment
const environments: Record<string, { name: string; url: string; healthEndpoint?: boolean; dbName?: string; type?: 'http' | 'ping'; interval?: number; port?: number }[]> = {
  production: [
    { name: 'QB-WEB', url: 'www.quimicaboss.com.mx', healthEndpoint: true },
    { name: 'QB-SGA', url: '192.168.2.218:5000', healthEndpoint: true, dbName: 'SQL Server' },
    { name: 'QB-WMS', url: '192.168.2.218:5002', healthEndpoint: true, dbName: 'SQL Server' },
    { name: 'Server 104', url: '192.168.2.104', type: 'ping', interval: 180000 },
  ],
  development: [
    { name: 'QB-SAO', url: '192.168.2.172:5003', healthEndpoint: true, dbName: 'SQL Server' },
    { name: 'SGA Dev', url: '192.168.2.172:5000', healthEndpoint: true, dbName: 'SQL Server' },
    { name: 'App 5008', url: '192.168.2.218:5008', healthEndpoint: true, dbName: 'SQL Server' },
  ],
  databases: [
    { name: 'QB-WMS Database', url: '192.168.2.237', dbName: 'SQL Server', port: 1433 },
    { name: 'SGA Database', url: '192.168.2.187', dbName: 'SQL Server', port: 1433 },
  ]
};

// Network infrastructure devices
const networkDevices = [
  // Servers
  { name: 'Servidor AD Local', ip: '192.168.2.2', type: 'server' as const },
  { name: 'ServidorCONTAQ', ip: '192.168.2.104', type: 'server' as const },
  { name: 'Servidor de Archivos', ip: '192.168.2.103', type: 'server' as const },
  { name: 'Servidor Apps', ip: '192.168.2.218', type: 'server' as const },
  { name: 'Servidor Dev', ip: '192.168.2.172', type: 'server' as const },
  { name: 'LibreNMS Monitor', ip: '192.168.2.251', type: 'server' as const },
  // Databases
  { name: 'DB Server 237', ip: '192.168.2.237', type: 'server' as const },
  { name: 'DB Server 187', ip: '192.168.2.187', type: 'server' as const },
];

// Static infrastructure nodes (always on the map)
const INFRA_NODES = [
  { id: 'internet', label: 'Internet', ip: '0.0.0.0', type: 'internet' as const, x: 400, y: 30 },
  { id: 'switch-main', label: 'Switch Principal', ip: '192.168.2.1', type: 'switch' as const, x: 400, y: 150 },
];

const INFRA_LINKS = [
  { from: 'internet', to: 'switch-main', label: 'WAN' },
];

// DB device record shape
interface DbDevice {
  ip: string;
  name: string;
  device_type: string;
  status: string;
  latency: number;
  is_monitored: boolean;
  last_seen: string | null;
  hostname: string | null;
  mac_address: string | null;
  vendor: string | null;
  open_ports: string | null;
  os_fingerprint: string | null;
  ttl: number | null;
  netbios_name: string | null;
  domain: string | null;
  shared_folders: string | null;
  http_title: string | null;
  http_server: string | null;
}

interface ServerStatus {
  name: string;
  url: string;
  status: string;
  errorDetail?: string;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('production');
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatus>>({});
  const [dismissed, setDismissed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [compact, setCompact] = useState(false);
  const [networkEvents, setNetworkEvents] = useState<NetworkEvent[]>([]);
  
  // Network scanning — discovered hosts stored separately from topology
  const [dbDevices, setDbDevices] = useState<DbDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanSubnet, setScanSubnet] = useState('192.168.2');
  const [dbError, setDbError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<{ phase: string; percent: number; detail: string } | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DbDevice | null>(null);
  const [editingName, setEditingName] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [wmiProfile, setWmiProfile] = useState<any>(null);
  const [wmiLoading, setWmiLoading] = useState(false);
  const prevAlertsRef = useRef<string[]>([]);
  const { startAlarm, stopAlarm, setMuted } = useAlarmSound();

  // LibreNMS cross-reference: IP → device_id map
  const [librenmsDeviceMap, setLibrenmsDeviceMap] = useState<Map<string, { device_id: number; sysName: string; os: string; uptime: number }>>(new Map());

  // Fetch LibreNMS devices for cross-referencing (once on mount)
  useEffect(() => {
    async function fetchLibrenmsDevices() {
      try {
        const res = await fetch('/api/librenms?action=devices');
        if (!res.ok) return;
        const data = await res.json();
        const devices = data?.devices || [];
        const map = new Map<string, { device_id: number; sysName: string; os: string; uptime: number }>();
        devices.forEach((d: { device_id: number; hostname: string; ip: string; sysName: string; os: string; uptime: number }) => {
          if (d.ip) map.set(d.ip, { device_id: d.device_id, sysName: d.sysName, os: d.os, uptime: d.uptime });
          if (d.hostname) map.set(d.hostname, { device_id: d.device_id, sysName: d.sysName, os: d.os, uptime: d.uptime });
        });
        setLibrenmsDeviceMap(map);
      } catch { /* ignore */ }
    }
    fetchLibrenmsDevices();
  }, []);

  // LibreNMS alerts — fetched periodically for the unified alarm system
  const [librenmsAlerts, setLibrenmsAlerts] = useState<{ id: number; hostname: string; rule: string; severity: string; timestamp: string }[]>([]);

  useEffect(() => {
    async function fetchLibrenmsAlerts() {
      try {
        const res = await fetch('/api/librenms?action=alerts');
        if (!res.ok) return;
        const data = await res.json();
        setLibrenmsAlerts(data?.alerts || []);
      } catch { /* ignore */ }
    }
    fetchLibrenmsAlerts();
    const interval = setInterval(fetchLibrenmsAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  const currentDevs = environments[activeTab] || [];

  // Load devices from DB when Network tab is opened
  const loadDevicesFromDB = useCallback(async () => {
    try {
      const res = await fetch('/api/network/devices');
      const data = await res.json();
      if (data.devices) {
        setDbDevices(data.devices);
        setDbError(null);
        // Update statuses for topology map — only monitored devices trigger alarms
        const statusBatch: Record<string, ServerStatus> = {};
        data.devices.forEach((d: DbDevice) => {
          if (d.is_monitored) {
            statusBatch[d.ip] = { name: d.name, url: d.ip, status: d.status };
          }
        });
        setServerStatuses(prev => ({ ...prev, ...statusBatch }));
      }
      if (data.error) setDbError(data.error);
    } catch (e) {
      console.error('Failed to load devices from DB:', e);
      setDbError('Cannot connect to database');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'network') {
      loadDevicesFromDB();
    }
  }, [activeTab, loadDevicesFromDB]);

  // Build topology nodes/links from DB devices + static infra
  const topoNodes = useMemo(() => {
    const nodes: { id: string; label: string; ip: string; type: 'server' | 'switch' | 'firewall' | 'router' | 'internet' | 'database' | 'other'; x?: number; y?: number; isMonitored?: boolean }[] = [...INFRA_NODES];
    dbDevices.forEach(d => {
      // Skip if it's already an infra node
      if (INFRA_NODES.some(n => n.ip === d.ip)) return;
      nodes.push({
        id: `dev-${d.ip.replace(/\./g, '-')}`,
        label: d.name,
        ip: d.ip,
        type: d.device_type as 'server' | 'switch' | 'firewall' | 'router' | 'internet' | 'database' | 'other',
        isMonitored: d.is_monitored,
      });
    });
    return nodes;
  }, [dbDevices]);

  const topoLinks = useMemo(() => {
    const lnks: { from: string; to: string; label?: string }[] = [...INFRA_LINKS];
    dbDevices.forEach(d => {
      if (INFRA_NODES.some(n => n.ip === d.ip)) return;
      lnks.push({
        from: 'switch-main',
        to: `dev-${d.ip.replace(/\./g, '-')}`,
      });
    });
    return lnks;
  }, [dbDevices]);

  // Build device info map for topology tooltips
  const [extraInfo, setExtraInfo] = useState<Record<string, { hostname?: string; mac?: string }>>({});
  
  const deviceInfoMap = useMemo(() => {
    const map: Record<string, { latency?: number; last_seen?: string | null; hostname?: string; mac?: string; device_type?: string; vendor?: string | null; os?: string | null; ports?: string | null }> = {};
    dbDevices.forEach(d => {
      map[d.ip] = {
        latency: d.latency,
        last_seen: d.last_seen,
        device_type: d.device_type,
        hostname: d.hostname || extraInfo[d.ip]?.hostname,
        mac: d.mac_address || extraInfo[d.ip]?.mac,
        vendor: d.vendor,
        os: d.os_fingerprint,
        ports: d.open_ports,
      };
    });
    return map;
  }, [dbDevices, extraInfo]);

  // Fetch hostname/MAC for monitored devices in background
  useEffect(() => {
    if (activeTab !== 'network' || dbDevices.length === 0) return;
    const monitored = dbDevices.filter(d => d.is_monitored);
    monitored.forEach(async (dev) => {
      if (extraInfo[dev.ip]) return; // Already fetched
      try {
        const res = await fetch(`/api/network/device-info?ip=${dev.ip}`);
        const data = await res.json();
        if (data.hostname || data.mac) {
          setExtraInfo(prev => ({
            ...prev,
            [dev.ip]: { hostname: data.hostname || undefined, mac: data.mac || undefined },
          }));
        }
      } catch { /* ignore */ }
    });
  }, [activeTab, dbDevices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect status updates from each MonitorCard
  const handleStatusChange = useCallback((url: string, name: string, status: string, errorDetail?: string) => {
    setServerStatuses((prev) => {
      const next = { ...prev, [url]: { name, url, status, errorDetail } };
      return next;
    });
    // If a server comes back online, un-dismiss the banner so new issues are visible
    if (dismissed) {
      setDismissed(false);
    }
  }, [dismissed]);

  // Stable callback for network events (prevents re-render of all cards)
  const handleNetworkEvent = useCallback((event: NetworkEvent) => {
    setNetworkEvents((prev) => [event, ...prev].slice(0, 100));
  }, []);

  // Compute current alerts
  const alerts = Object.values(serverStatuses).filter(
    (s) => s.status === 'Offline' || s.status === 'Issues Detected'
  );

  // Handle alarm sound and notifications
  useEffect(() => {
    const currentAlertUrls = alerts.map((a) => a.url).sort();
    const prevAlertUrls = prevAlertsRef.current;

    // Detect NEW alerts (servers that just went down)
    const newAlerts = alerts.filter((a) => !prevAlertUrls.includes(a.url));

    if (newAlerts.length > 0) {
      // New server went down — trigger alarm
      setDismissed(false);

      if (!isMuted) {
        startAlarm();
      }

      // Browser notification
      if (newAlerts.length === 1) {
        sendNotification(
          `⚠️ ${newAlerts[0].name} is ${newAlerts[0].status}`,
          newAlerts[0].errorDetail || 'A production server needs attention.'
        );
      } else {
        sendNotification(
          `⚠️ ${newAlerts.length} servers have issues`,
          newAlerts.map((a) => a.name).join(', ')
        );
      }
    }

    // All clear — stop alarm
    if (alerts.length === 0 && prevAlertUrls.length > 0) {
      stopAlarm();
    }

    prevAlertsRef.current = currentAlertUrls;
  }, [alerts, isMuted, startAlarm, stopAlarm]);

  const handleDismiss = () => {
    setDismissed(true);
    stopAlarm();
  };

  const handleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    setMuted(newMuted);
    if (newMuted) {
      stopAlarm();
    } else if (alerts.length > 0) {
      startAlarm();
    }
  };

  // Network Scanner — persists to SQL Server, then reloads from DB
  const handleScanNetwork = async () => {
    if (isScanning || !scanSubnet) return;
    setIsScanning(true);
    setScanPhase({ phase: 'Starting', percent: 0, detail: '' });
    
    // Poll scan progress every 2 seconds
    const progressInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/network/scan-progress');
        const progress = await res.json();
        if (progress.running) {
          setScanPhase({ phase: progress.phase, percent: progress.percent, detail: progress.detail });
        }
      } catch { /* ignore */ }
    }, 2000);
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000); // 5 min for deep scan
      const res = await fetch(`/api/network/scan?subnet=${scanSubnet}`, {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      
      setNetworkEvents(prev => [{
        id: `scan-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        deviceName: 'Deep Scanner',
        type: 'warning' as const,
        message: `Found ${data.activeCount || 0} hosts, ${data.resolvedNames || 0} names, ${data.vendorsResolved || 0} vendors identified`,
      }, ...prev].slice(0, 100));

      // Reload all devices from DB
      await loadDevicesFromDB();
    } catch (e) {
      console.error('Scan failed', e);
    } finally {
      clearInterval(progressInterval);
      setIsScanning(false);
      setScanPhase(null);
    }
  };

  return (
    <main className="dashboard-main">
      <div className="dashboard-container">
        {/* Alarm Banner */}
        {!dismissed && <AlarmBanner alerts={alerts} librenmsAlerts={librenmsAlerts} onDismiss={handleDismiss} onMute={handleMute} isMuted={isMuted} />}

        <header className="dashboard-header">
          <div className="header-content">
            <h1>Control Panel</h1>
            {!compact && <p>Monitor your developments and production servers in real-time.</p>}
          </div>
          <div className="header-actions">
            <button className={`compact-toggle ${compact ? 'active' : ''}`} onClick={() => setCompact(!compact)} title={compact ? 'Switch to normal view' : 'Switch to compact view'}>
              {compact ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              )}
            </button>
            <div className="header-status">
              {alerts.length > 0 ? (
                <div className="status-badge status-badge-alert">
                  <span className="status-dot status-offline"></span>
                  <span>{alerts.length} Issue{alerts.length > 1 ? 's' : ''} Detected</span>
                </div>
              ) : (
                <div className="status-badge">
                  <span className="status-dot status-online"></span>
                  <span>System Operational</span>
                </div>
              )}
            </div>
          </div>
        </header>

        <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

        <section className="tab-content" role="tabpanel">
          <div className="section-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              {TABS.find((t) => t.id === activeTab)?.label}
              {activeTab !== 'databases' && activeTab !== 'network' && activeTab !== 'librenms' && <span className="section-count">{currentDevs.length}</span>}
              {activeTab === 'network' && <span className="section-count">{networkDevices.length}</span>}
            </h2>
            
            {activeTab === 'network' && !compact && (
              <div className="network-scanner" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={scanSubnet}
                  onChange={(e) => setScanSubnet(e.target.value)}
                  placeholder="e.g. 192.168.2"
                  className="monitor-name-input"
                  style={{ width: '120px', fontSize: '13px' }}
                  disabled={isScanning}
                />
                <button 
                  className="action-btn" 
                  onClick={handleScanNetwork}
                  disabled={isScanning}
                  style={{ padding: '6px 12px', fontSize: '13px' }}
                >
                  {isScanning ? 'Scanning...' : 'Deep Scan'}
                </button>
              </div>
            )}
          </div>

          {activeTab === 'network' ? (
            <>
              {/* Scan progress bar */}
              {scanPhase && (
                <div style={{ padding: '12px 16px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '10px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6' }}>
                      🔍 {scanPhase.phase}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{scanPhase.percent}%</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'rgba(59,130,246,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${scanPhase.percent}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                  </div>
                  {scanPhase.detail && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{scanPhase.detail}</div>
                  )}
                </div>
              )}

              {/* DB connection warning */}
              {dbError && (
                <div style={{ padding: '8px 16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#dc2626' }}>
                  ⚠️ Database: {dbError} — showing cached data only.
                </div>
              )}

              {/* Topology Map — ALL devices from DB */}
              <TopologyMap
                nodes={topoNodes}
                links={topoLinks}
                statuses={Object.fromEntries(
                  Object.entries(serverStatuses).map(([key, val]) => [key, val.status])
                )}
                deviceInfo={deviceInfoMap}
              />

              {/* Monitored Servers — live polling cards */}
              <h3 style={{ fontSize: '14px', color: '#64748b', marginBottom: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Monitored Servers <span className="section-count">{networkDevices.length}</span>
              </h3>
              <div className={`monitors-grid monitors-grid-network ${compact ? 'monitors-grid-compact' : ''}`}>
                {networkDevices.map((device) => (
                  <NetworkCard
                    key={device.ip}
                    name={device.name}
                    ip={device.ip}
                    deviceType={device.type}
                    interval={30000}
                    compact={compact}
                    onStatusChange={handleStatusChange}
                    onEvent={handleNetworkEvent}
                  />
                ))}
              </div>

              {/* All Devices from DB — compact table */}
              {dbDevices.length > 0 && (
                <div className="discovered-section" style={{ marginTop: '24px' }}>
                  <h3 style={{ fontSize: '14px', color: '#64748b', marginBottom: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    All Network Devices <span className="section-count">{dbDevices.length}</span>
                  </h3>
                  <div className="discovered-table">
                    <div className="discovered-header" style={{ gridTemplateColumns: '40px 1fr 140px 100px 100px 80px' }}>
                      <span></span>
                      <span>Name</span>
                      <span>IP Address</span>
                      <span>Vendor</span>
                      <span>Type</span>
                      <span>Latency</span>
                    </div>
                    {dbDevices.map((dev, idx) => (
                      <div
                        key={dev.ip}
                        className="discovered-row"
                        style={{
                          gridTemplateColumns: '40px 1fr 140px 100px 100px 80px',
                          background: idx % 2 === 0 ? 'rgba(30, 41, 59, 0.5)' : 'rgba(51, 65, 85, 0.25)',
                          cursor: 'pointer',
                          borderLeft: selectedDevice?.ip === dev.ip ? '3px solid #3b82f6' : '3px solid transparent',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}
                        onClick={() => { setSelectedDevice(dev); setEditingName(dev.name); setWmiProfile(null); }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(59, 130, 246, 0.1)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.5)' : 'rgba(51, 65, 85, 0.25)'; }}
                      >
                        <span>
                          <span className={`status-dot ${dev.status === 'Online' ? 'status-online' : 'status-offline'}`} style={{ width: 8, height: 8, display: 'inline-block' }}></span>
                        </span>
                        <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: dev.is_monitored ? 600 : 400 }}>
                          {dev.name}
                        </span>
                        <span className="discovered-ip">{dev.ip}</span>
                        <span style={{ color: '#8b5cf6', fontSize: '11px' }}>{dev.vendor || '—'}</span>
                        <span style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'capitalize' }}>{dev.device_type}</span>
                        <span style={{ color: dev.latency > 10 ? '#f59e0b' : '#64748b', fontSize: '12px', fontFamily: 'monospace' }}>
                          {dev.status === 'Online' ? `${dev.latency}ms` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Device Detail Panel */}
              {selectedDevice && (() => {
                const shares = selectedDevice.shared_folders ? (() => { try { return JSON.parse(selectedDevice.shared_folders); } catch { return []; } })() : [];
                const hasHTTP = selectedDevice.open_ports?.split(',').some(p => ['80','443','8080','8443'].includes(p.trim()));
                const hasRDP = selectedDevice.open_ports?.split(',').some(p => p.trim() === '3389');
                return (
                <div style={{
                  marginTop: '16px',
                  padding: '20px',
                  background: 'linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.95))',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: '12px',
                  position: 'relative',
                }}>
                  <button
                    onClick={() => setSelectedDevice(null)}
                    style={{ position: 'absolute', top: '12px', right: '16px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '18px' }}
                  >✕</button>

                  {/* Header: Name + Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <span className={`status-dot ${selectedDevice.status === 'Online' ? 'status-online' : 'status-offline'}`} style={{ width: 12, height: 12 }}></span>
                    <div>
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        style={{ background: 'rgba(51,65,85,0.5)', border: '1px solid #475569', borderRadius: '6px', padding: '4px 8px', color: '#e2e8f0', fontSize: '16px', fontWeight: 600, width: '300px' }}
                      />
                      {editingName !== selectedDevice.name && (
                        <button
                          onClick={async () => {
                            try {
                              await fetch('/api/network/update', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ip: selectedDevice.ip, name: editingName }),
                              });
                              await loadDevicesFromDB();
                              setSelectedDevice(prev => prev ? { ...prev, name: editingName } : null);
                            } catch (e) { console.error('Update failed:', e); }
                          }}
                          style={{ marginLeft: '8px', padding: '4px 12px', background: '#3b82f6', border: 'none', borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer' }}
                        >Save</button>
                      )}
                    </div>
                    {selectedDevice.domain && (
                      <span style={{ padding: '2px 8px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '4px', color: '#818cf8', fontSize: '11px' }}>
                        {selectedDevice.domain}
                      </span>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {/* Copy IP */}
                    <button onClick={() => { navigator.clipboard.writeText(selectedDevice.ip); }}
                      style={{ padding: '5px 10px', background: 'rgba(51,65,85,0.4)', border: '1px solid #475569', borderRadius: '6px', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      📋 Copy IP
                    </button>
                    {/* Open Web */}
                    {hasHTTP && (
                      <button onClick={() => window.open(`http://${selectedDevice.ip}`, '_blank')}
                        style={{ padding: '5px 10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#60a5fa', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        🌐 Open Web
                      </button>
                    )}
                    {/* RDP */}
                    {hasRDP && (
                      <button onClick={() => { const a = document.createElement('a'); a.href = `rdp://full%20address=s:${selectedDevice.ip}`; a.click(); }}
                        style={{ padding: '5px 10px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '6px', color: '#c084fc', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        🖥️ Remote Desktop
                      </button>
                    )}
                    {/* Wake-on-LAN */}
                    {selectedDevice.status === 'Offline' && selectedDevice.mac_address && (
                      <button onClick={async () => {
                        try {
                          const res = await fetch('/api/network/wol', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: selectedDevice.mac_address, deviceName: selectedDevice.name }) });
                          const data = await res.json();
                          alert(data.success ? `⚡ WoL packet sent to ${selectedDevice.mac_address}` : `Error: ${data.error}`);
                        } catch (e) { alert('Failed to send WoL packet'); console.error(e); }
                      }}
                        style={{ padding: '5px 10px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px', color: '#4ade80', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ⚡ Wake-on-LAN
                      </button>
                    )}
                    {/* Shutdown */}
                    {selectedDevice.status === 'Online' && (
                      <button onClick={async () => {
                        if (!confirm(`⚠️ Are you sure you want to SHUT DOWN ${selectedDevice.name} (${selectedDevice.ip})?\n\nThe machine will turn off in 30 seconds.`)) return;
                        try {
                          const res = await fetch('/api/network/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: selectedDevice.ip, action: 'shutdown', delay: 30 }) });
                          const data = await res.json();
                          alert(data.success ? `⏻ ${data.message}` : `Error: ${data.error}`);
                        } catch (e) { alert('Failed to send shutdown command'); console.error(e); }
                      }}
                        style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ⏻ Shutdown
                      </button>
                    )}
                    {/* Deep Inspect (WMI) */}
                    {selectedDevice.status === 'Online' && (
                      <button onClick={async () => {
                        setWmiLoading(true);
                        setWmiProfile(null);
                        try {
                          const res = await fetch('/api/network/wmi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: selectedDevice.ip }) });
                          const data = await res.json();
                          setWmiProfile(data);
                        } catch (e) { console.error('WMI failed:', e); }
                        setWmiLoading(false);
                      }}
                        disabled={wmiLoading}
                        style={{ padding: '5px 10px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', color: '#fbbf24', fontSize: '11px', cursor: wmiLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {wmiLoading ? '⏳ Inspecting...' : '🔬 Deep Inspect'}
                      </button>
                    )}
                    {/* Export CSV */}
                    <button onClick={() => window.open('/api/network/export?format=csv', '_blank')}
                      style={{ padding: '5px 10px', background: 'rgba(51,65,85,0.4)', border: '1px solid #475569', borderRadius: '6px', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                      📥 Export CSV
                    </button>
                  </div>

                  {/* Properties Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                    {[
                      { label: 'IP Address', value: selectedDevice.ip, mono: true },
                      { label: 'Status', value: selectedDevice.status },
                      { label: 'Latency', value: selectedDevice.status === 'Online' ? `${selectedDevice.latency}ms` : '—' },
                      { label: 'Type', value: selectedDevice.device_type },
                      { label: 'Vendor', value: selectedDevice.vendor || '—' },
                      { label: 'MAC Address', value: selectedDevice.mac_address || '—', mono: true },
                      { label: 'Hostname (DNS)', value: selectedDevice.hostname || '—' },
                      { label: 'NetBIOS Name', value: selectedDevice.netbios_name || '—' },
                      { label: 'Domain / Workgroup', value: selectedDevice.domain || '—' },
                      { label: 'OS', value: selectedDevice.os_fingerprint || '—' },
                      { label: 'Open Ports', value: selectedDevice.open_ports || '—', mono: true },
                      { label: 'TTL', value: selectedDevice.ttl ? String(selectedDevice.ttl) : '—' },
                      { label: 'HTTP Title', value: selectedDevice.http_title || '—' },
                      { label: 'HTTP Server', value: selectedDevice.http_server || '—', mono: true },
                      { label: 'Last Seen', value: selectedDevice.last_seen ? new Date(selectedDevice.last_seen).toLocaleString() : '—' },
                    ].map(item => (
                      <div key={item.label} style={{ padding: '8px 12px', background: 'rgba(51,65,85,0.3)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{item.label}</div>
                        <div style={{ fontSize: '13px', color: '#e2e8f0', fontFamily: item.mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Shared Folders */}
                  {shares.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                        Shared Folders ({shares.length})
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {shares.map((s: { name: string; type: string; comment: string }) => (
                          <span key={s.name} style={{
                            padding: '3px 8px',
                            background: s.type === 'Disk' ? 'rgba(59,130,246,0.1)' : s.type === 'Print' ? 'rgba(168,85,247,0.1)' : 'rgba(51,65,85,0.3)',
                            border: `1px solid ${s.type === 'Disk' ? 'rgba(59,130,246,0.3)' : s.type === 'Print' ? 'rgba(168,85,247,0.3)' : '#475569'}`,
                            borderRadius: '4px',
                            color: s.type === 'Disk' ? '#60a5fa' : s.type === 'Print' ? '#c084fc' : '#94a3b8',
                            fontSize: '11px',
                            cursor: s.type === 'Disk' ? 'pointer' : 'default',
                          }} title={s.comment || s.type}>
                            {s.type === 'Disk' ? '📁' : s.type === 'Print' ? '🖨️' : '🔗'} {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* WMI Hardware Profile Card */}
                  {wmiProfile && wmiProfile.accessible && (
                    <div style={{ marginTop: '12px', padding: '14px', background: 'linear-gradient(135deg, rgba(245,158,11,0.05), rgba(245,158,11,0.02))', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '11px', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', fontWeight: 600 }}>
                        🔬 Hardware Profile (WMI)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                        {wmiProfile.os && (
                          <div style={{ padding: '8px 10px', background: 'rgba(30,41,59,0.6)', borderRadius: '6px' }}>
                            <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>Operating System</div>
                            <div style={{ fontSize: '12px', color: '#e2e8f0' }}>{wmiProfile.os.caption}</div>
                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{wmiProfile.os.version} ({wmiProfile.os.architecture})</div>
                          </div>
                        )}
                        {wmiProfile.cpu && (
                          <div style={{ padding: '8px 10px', background: 'rgba(30,41,59,0.6)', borderRadius: '6px' }}>
                            <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>Processor</div>
                            <div style={{ fontSize: '12px', color: '#e2e8f0' }}>{wmiProfile.cpu.name}</div>
                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{wmiProfile.cpu.cores} cores / {wmiProfile.cpu.threads} threads</div>
                          </div>
                        )}
                        {wmiProfile.os && wmiProfile.os.totalMemoryKB && (
                          <div style={{ padding: '8px 10px', background: 'rgba(30,41,59,0.6)', borderRadius: '6px' }}>
                            <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>Memory</div>
                            <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                              {((wmiProfile.os.totalMemoryKB - (wmiProfile.os.freeMemoryKB || 0)) / 1048576).toFixed(1)} / {(wmiProfile.os.totalMemoryKB / 1048576).toFixed(1)} GB used
                            </div>
                            <div style={{ marginTop: '4px', height: '4px', background: 'rgba(51,65,85,0.5)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ width: `${((wmiProfile.os.totalMemoryKB - (wmiProfile.os.freeMemoryKB || 0)) / wmiProfile.os.totalMemoryKB * 100).toFixed(0)}%`, height: '100%', background: 'linear-gradient(90deg, #22c55e, #eab308)', borderRadius: '2px' }} />
                            </div>
                          </div>
                        )}
                        {wmiProfile.system && (
                          <div style={{ padding: '8px 10px', background: 'rgba(30,41,59,0.6)', borderRadius: '6px' }}>
                            <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>System</div>
                            <div style={{ fontSize: '12px', color: '#e2e8f0' }}>{wmiProfile.system.manufacturer} {wmiProfile.system.model}</div>
                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>User: {wmiProfile.system.loggedInUser || '—'}</div>
                          </div>
                        )}
                      </div>
                      {/* Disks */}
                      {wmiProfile.disks && wmiProfile.disks.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Storage</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {wmiProfile.disks.map((d: { letter: string; fileSystem: string | null; totalBytes: number | null; freeBytes: number | null }) => {
                              const total = d.totalBytes ? d.totalBytes / (1024 * 1024 * 1024) : 0;
                              const free = d.freeBytes ? d.freeBytes / (1024 * 1024 * 1024) : 0;
                              const usedPct = total > 0 ? ((total - free) / total * 100) : 0;
                              return (
                                <div key={d.letter} style={{ padding: '6px 10px', background: 'rgba(30,41,59,0.6)', borderRadius: '6px', minWidth: '140px' }}>
                                  <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>{d.letter} <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 400 }}>{d.fileSystem}</span></div>
                                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>{free.toFixed(0)} / {total.toFixed(0)} GB free</div>
                                  <div style={{ marginTop: '3px', height: '3px', background: 'rgba(51,65,85,0.5)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${usedPct}%`, height: '100%', background: usedPct > 90 ? '#ef4444' : usedPct > 75 ? '#eab308' : '#22c55e', borderRadius: '2px' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* NICs */}
                      {wmiProfile.nics && wmiProfile.nics.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Network Adapters</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {wmiProfile.nics.map((n: { name: string; mac: string | null; speedBps: number | null }, i: number) => (
                              <span key={i} style={{ padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', color: '#60a5fa', fontSize: '10px' }}>
                                🔌 {n.name} {n.speedBps ? `(${(n.speedBps / 1e9).toFixed(1)}Gbps)` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {wmiProfile && !wmiProfile.accessible && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', fontSize: '12px', color: '#f87171' }}>
                      🔒 WMI access denied — {wmiProfile.error || 'Requires admin privileges on the target machine'}
                    </div>
                  )}

                   {/* LibreNMS SNMP Metrics — shown when device matches a LibreNMS device by IP */}
                   {librenmsDeviceMap.has(selectedDevice.ip) && (
                     <div style={{ marginTop: '16px' }}>
                       <DeviceMetricsPanel
                         deviceId={librenmsDeviceMap.get(selectedDevice.ip)!.device_id}
                         deviceName={selectedDevice.name}
                         showGraphs={true}
                       />
                     </div>
                   )}

                   {/* Bottom Controls */}
                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <select
                      value={selectedDevice.device_type}
                      onChange={async (e) => {
                        try {
                          await fetch('/api/network/update', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ip: selectedDevice.ip, device_type: e.target.value }),
                          });
                          await loadDevicesFromDB();
                          setSelectedDevice(prev => prev ? { ...prev, device_type: e.target.value } : null);
                        } catch (err) { console.error('Update failed:', err); }
                      }}
                      style={{ padding: '6px 10px', background: 'rgba(51,65,85,0.5)', border: '1px solid #475569', borderRadius: '6px', color: '#e2e8f0', fontSize: '12px', cursor: 'pointer' }}
                    >
                      {['other', 'server', 'workstation', 'printer', 'camera', 'phone', 'nas', 'switch', 'router', 'firewall', 'database', 'access-point', 'ups', 'voip-phone', 'iot'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button
                      onClick={async () => {
                        try {
                          const monitored = !selectedDevice.is_monitored;
                          await fetch('/api/network/update', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ip: selectedDevice.ip, is_monitored: monitored }),
                          });
                          await loadDevicesFromDB();
                          setSelectedDevice(prev => prev ? { ...prev, is_monitored: monitored } : null);
                        } catch (err) { console.error('Update failed:', err); }
                      }}
                      style={{ padding: '6px 12px', background: selectedDevice.is_monitored ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)', border: `1px solid ${selectedDevice.is_monitored ? '#ef4444' : '#22c55e'}`, borderRadius: '6px', color: selectedDevice.is_monitored ? '#ef4444' : '#22c55e', fontSize: '12px', cursor: 'pointer' }}
                    >
                      {selectedDevice.is_monitored ? '★ Remove from Monitored' : '☆ Add to Monitored'}
                    </button>
                  </div>
                </div>
                );
              })()}

              <EventLog events={networkEvents} />
            </>
          ) : (
            <div className={`monitors-grid ${compact ? 'monitors-grid-compact' : ''}`}>
              {activeTab === 'databases' ? (
                (environments.databases || []).map((db) => (
                  <DatabaseCard
                    key={`db-${db.url}`}
                    serverName={db.name}
                    host={db.url}
                    dbName={db.dbName}
                    port={db.port || 1433}
                    compact={compact}
                    onStatusChange={handleStatusChange}
                  />
                ))
              ) : (
                currentDevs.map((dev) => (
                  <MonitorCard
                    key={dev.url}
                    name={dev.name}
                    url={dev.url}
                    healthEndpoint={dev.healthEndpoint}
                    dbName={dev.dbName}
                    type={dev.type}
                    interval={dev.interval}
                    compact={compact}
                    onStatusChange={handleStatusChange}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'librenms' && (
            <LibreNMSCard compact={compact} />
          )}
        </section>
      </div>
    </main>
  );
}

