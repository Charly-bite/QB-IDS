'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import DeviceMetricsPanel from './DeviceMetricsPanel';
import TopDiskUsageCard from './TopDiskUsageCard';

interface LibreNMSDevice {
  device_id: number;
  hostname: string;
  sysName: string;
  ip: string;
  status: number;
  status_reason: string;
  os: string;
  hardware: string;
  uptime: number;
  location: string;
  type: string;
  last_polled: string;
  version: string;
  features: string;
}

interface LibreNMSAlert {
  id: number;
  hostname: string;
  rule: string;
  severity: string;
  state: number;
  timestamp: string;
}

interface OverviewData {
  summary: {
    totalDevices: number;
    devicesUp: number;
    devicesDown: number;
    activeAlerts: number;
    osCounts: Record<string, number>;
  };
  devices: LibreNMSDevice[];
  alerts: LibreNMSAlert[];
  errors: { devices: string | null; alerts: string | null };
}

// ── Utility Functions ──

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function timeSince(dateStr: string): string {
  if (!dateStr) return '—';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function getOsIcon(os: string): string {
  if (os === 'windows') return '🖥️';
  if (os === 'linux') return '🐧';
  if (os === 'fortigate') return '🛡️';
  if (os.includes('grandstream')) return '🔌';
  if (os.includes('hikvision')) return '📹';
  if (os === 'ping') return '📡';
  if (os.includes('ocnos')) return '🌐';
  return '💻';
}

function getOsLabel(os: string): string {
  if (os === 'windows') return 'Windows';
  if (os === 'linux') return 'Linux';
  if (os === 'fortigate') return 'FortiGate';
  if (os.includes('grandstream')) return 'Switch';
  if (os.includes('hikvision')) return 'NVR/Cámara';
  if (os === 'ping') return 'ICMP';
  if (os.includes('ocnos')) return 'Router/ISP';
  return os;
}

const HIDDEN_DEVICES_KEY = 'librenms-hidden-devices';
function getHiddenDeviceIds(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_DEVICES_KEY) || '[]');
  } catch { return []; }
}
function setHiddenDeviceIds(ids: number[]) {
  localStorage.setItem(HIDDEN_DEVICES_KEY, JSON.stringify(ids));
}

// ── Main Component ──

export default function LibreNMSCard({
  compact = false,
  onAlertCount,
}: {
  compact?: boolean;
  onAlertCount?: (count: number) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'up' | 'down' | 'windows' | 'network'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Alert filtering and silencing states
  const [alertSearch, setAlertSearch] = useState('');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [alertRuleFilter, setAlertRuleFilter] = useState<string>('all');
  const [silencedRules, setSilencedRules] = useState<string[]>([]);
  const [silencedHosts, setSilencedHosts] = useState<string[]>([]);
  const [showSilenced, setShowSilenced] = useState(false);
  const [silencedManagerExpanded, setSilencedManagerExpanded] = useState(false);

  // Latency time range and error handling states
  const [latencyTimeRange, setLatencyTimeRange] = useState<'6h' | '24h' | '1w' | '1m'>('6h');
  const [failedGraphs, setFailedGraphs] = useState<Record<number, boolean>>({});

  // Sync silenced items on mount and reset failed graphs on time range change
  useEffect(() => {
    try {
      setSilencedRules(JSON.parse(localStorage.getItem('librenms-silenced-rules') || '[]'));
      setSilencedHosts(JSON.parse(localStorage.getItem('librenms-silenced-hosts') || '[]'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setFailedGraphs({});
  }, [latencyTimeRange]);

  const handleSilenceRule = (rule: string) => {
    const updated = [...new Set([...silencedRules, rule])];
    setSilencedRules(updated);
    localStorage.setItem('librenms-silenced-rules', JSON.stringify(updated));
    window.dispatchEvent(new Event('librenms-silencing-changed'));
  };

  const handleUnsilenceRule = (rule: string) => {
    const updated = silencedRules.filter(r => r !== rule);
    setSilencedRules(updated);
    localStorage.setItem('librenms-silenced-rules', JSON.stringify(updated));
    window.dispatchEvent(new Event('librenms-silencing-changed'));
  };

  const handleSilenceHost = (host: string) => {
    const updated = [...new Set([...silencedHosts, host])];
    setSilencedHosts(updated);
    localStorage.setItem('librenms-silenced-hosts', JSON.stringify(updated));
    window.dispatchEvent(new Event('librenms-silencing-changed'));
  };

  const handleUnsilenceHost = (host: string) => {
    const updated = silencedHosts.filter(h => h !== host);
    setSilencedHosts(updated);
    localStorage.setItem('librenms-silenced-hosts', JSON.stringify(updated));
    window.dispatchEvent(new Event('librenms-silencing-changed'));
  };

  // Collapsible sections
  const [offlineExpanded, setOfflineExpanded] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [serversExpanded, setServersExpanded] = useState(true);

  // Offline section search
  const [offlineSearch, setOfflineSearch] = useState('');
  const [offlineGroupExpanded, setOfflineGroupExpanded] = useState<Record<string, boolean>>({});

  // Hidden/acknowledged devices
  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  // Deleting state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Pagination for devices table
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 20;

  // Load hidden IDs from localStorage
  useEffect(() => {
    setHiddenIds(getHiddenDeviceIds());
  }, []);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/librenms?action=overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OverviewData = await res.json();
      setData(json);
      setError(json.errors?.devices || json.errors?.alerts || null);
      onAlertCount?.(json.summary?.activeAlerts || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onAlertCount]);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 60000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  // Delete device handler
  const handleDelete = async (deviceId: number) => {
    setDeletingId(deviceId);
    try {
      const res = await fetch(`/api/librenms?id=${deviceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(prev => {
        if (!prev) return prev;
        const devices = prev.devices.filter(d => d.device_id !== deviceId);
        return {
          ...prev,
          devices,
          summary: {
            ...prev.summary,
            totalDevices: devices.length,
            devicesUp: devices.filter(d => d.status === 1).length,
            devicesDown: devices.filter(d => d.status === 0).length,
          },
        };
      });
      setDeleteConfirm(null);
    } catch (e) {
      alert(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleHide = (deviceId: number) => {
    const updated = [...hiddenIds, deviceId];
    setHiddenIds(updated);
    setHiddenDeviceIds(updated);
  };

  const handleUnhide = (deviceId: number) => {
    const updated = hiddenIds.filter(id => id !== deviceId);
    setHiddenIds(updated);
    setHiddenDeviceIds(updated);
  };

  // Derived data
  const downDevices = useMemo(() =>
    (data?.devices || []).filter(d => d.status === 0),
    [data?.devices]
  );

  const visibleDownDevices = useMemo(() =>
    downDevices.filter(d => showHidden || !hiddenIds.includes(d.device_id)),
    [downDevices, hiddenIds, showHidden]
  );

  const hiddenDownCount = useMemo(() =>
    downDevices.filter(d => hiddenIds.includes(d.device_id)).length,
    [downDevices, hiddenIds]
  );

  // Group offline devices by OS type
  const offlineGroups = useMemo(() => {
    const q = offlineSearch.toLowerCase();
    const filtered = visibleDownDevices.filter(d => {
      if (!q) return true;
      return d.hostname.toLowerCase().includes(q) ||
        (d.sysName || '').toLowerCase().includes(q) ||
        (d.ip || '').includes(q) ||
        getOsLabel(d.os).toLowerCase().includes(q);
    });

    const groups: Record<string, LibreNMSDevice[]> = {};
    filtered.forEach(d => {
      const label = getOsLabel(d.os);
      if (!groups[label]) groups[label] = [];
      groups[label].push(d);
    });
    Object.values(groups).forEach(arr =>
      arr.sort((a, b) => daysSince(a.last_polled) - daysSince(b.last_polled))
    );
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [visibleDownDevices, offlineSearch]);

  const filteredDevices = useMemo(() =>
    (data?.devices || []).filter((d) => {
      if (filter === 'up') return d.status === 1;
      if (filter === 'down') return d.status === 0;
      if (filter === 'windows') return d.os === 'windows';
      if (filter === 'network') return ['fortigate', 'grandstream-sw', 'ping', 'ocnos'].includes(d.os);
      return true;
    }).filter(d => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return d.hostname.toLowerCase().includes(q) ||
        (d.sysName || '').toLowerCase().includes(q) ||
        (d.ip || '').includes(q) ||
        (d.os || '').toLowerCase().includes(q);
    }),
    [data?.devices, filter, searchQuery]
  );

  const sortedDevices = useMemo(() =>
    [...filteredDevices].sort((a, b) => {
      if (a.status !== b.status) return a.status - b.status;
      return (a.sysName || a.hostname).localeCompare(b.sysName || b.hostname);
    }),
    [filteredDevices]
  );

  const totalPages = Math.ceil(sortedDevices.length / PAGE_SIZE);
  const pagedDevices = sortedDevices.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const keyServers = useMemo(() =>
    (data?.devices || []).filter(d => d.os === 'windows' && d.status === 1 && d.sysName),
    [data?.devices]
  );

  useEffect(() => { setCurrentPage(0); }, [filter, searchQuery]);

  if (loading) {
    return (
      <div style={{
        padding: '60px',
        textAlign: 'center',
        color: '#334155',
        background: 'rgba(241, 245, 249, 0.8)',
        borderRadius: '16px',
        border: '1px solid #cbd5e1',
      }}>
        <div style={{ fontSize: '36px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }}>📡</div>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>Connecting to LibreNMS...</div>
        <div style={{ fontSize: '13px', marginTop: '4px', color: '#64748b' }}>192.168.2.134:8000</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{
        padding: '24px',
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: '12px',
        color: '#dc2626',
        fontSize: '15px',
      }}>
        <strong>⚠️ LibreNMS Connection Error</strong>
        <div style={{ marginTop: '6px', color: '#64748b', fontSize: '14px' }}>{error}</div>
      </div>
    );
  }

  const { summary } = data || { summary: { totalDevices: 0, devicesUp: 0, devicesDown: 0, activeAlerts: 0, osCounts: {} } };
  const alerts = data?.alerts || [];

  return (
    <div>
      {/* ── Summary Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: '14px',
        marginBottom: '18px',
      }}>
        <SummaryCard label="Total Devices" value={summary.totalDevices} color="#2563eb" gradient="37, 99, 235" />
        <SummaryCard label="Online" value={summary.devicesUp} color="#16a34a" gradient="22, 163, 74" />
        <SummaryCard label="Offline" value={summary.devicesDown} color={summary.devicesDown > 0 ? '#dc2626' : '#64748b'} gradient={summary.devicesDown > 0 ? '220, 38, 38' : '100, 116, 139'} alert={summary.devicesDown > 0} />
        <SummaryCard label="Active Alerts" value={summary.activeAlerts} color={summary.activeAlerts > 0 ? '#d97706' : '#64748b'} gradient={summary.activeAlerts > 0 ? '217, 119, 6' : '100, 116, 139'} alert={summary.activeAlerts > 0} />
      </div>

      {/* ── OS Distribution ── */}
      {summary.osCounts && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {Object.entries(summary.osCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([os, count]) => (
              <div key={os} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '20px',
                fontSize: '13px',
                color: '#1e293b',
                fontWeight: 500,
              }}>
                <span style={{ fontSize: '15px' }}>{getOsIcon(os)}</span>
                <span>{getOsLabel(os)}</span>
                <span style={{ color: '#2563eb', fontWeight: 700 }}>{count}</span>
              </div>
            ))}
        </div>
      )}

      {/* ── Offline Devices — Collapsible, Grouped ── */}
      {downDevices.length > 0 && (
        <div style={{
          marginBottom: '16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '12px',
          overflow: 'hidden',
        }}>
          {/* Header — always visible */}
          <button
            onClick={() => setOfflineExpanded(!offlineExpanded)}
            style={{
              width: '100%',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 18px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#dc2626',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                🔴 Offline Devices ({visibleDownDevices.length})
              </span>
              {hiddenDownCount > 0 && (
                <span style={{
                  fontSize: '12px', color: '#64748b',
                  padding: '2px 8px',
                  background: '#e2e8f0',
                  borderRadius: '8px',
                  fontWeight: 500,
                }}>
                  {hiddenDownCount} hidden
                </span>
              )}
            </div>
            <span style={{ fontSize: '18px', transform: offlineExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#94a3b8' }}>
              ▾
            </span>
          </button>

          {/* Expanded content */}
          {offlineExpanded && (
            <div style={{ padding: '0 18px 16px' }}>
              {/* Search + controls */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search offline devices..."
                  value={offlineSearch}
                  onChange={(e) => setOfflineSearch(e.target.value)}
                  style={{
                    padding: '8px 14px', fontSize: '14px',
                    border: '1px solid #fca5a5',
                    background: '#fff',
                    color: '#1e293b', borderRadius: '8px',
                    flex: '1', minWidth: '180px', outline: 'none',
                  }}
                />
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  style={{
                    padding: '7px 14px', fontSize: '13px',
                    border: `1px solid ${showHidden ? '#a78bfa' : '#cbd5e1'}`,
                    background: showHidden ? '#ede9fe' : '#f8fafc',
                    color: showHidden ? '#7c3aed' : '#475569',
                    borderRadius: '8px', cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {showHidden ? '👁️ Showing hidden' : `👁️‍🗨️ ${hiddenDownCount} hidden`}
                </button>
              </div>

              {/* Grouped offline devices */}
              {offlineGroups.map(([osLabel, devices]) => {
                const isGroupOpen = offlineGroupExpanded[osLabel] !== false;
                return (
                  <div key={osLabel} style={{
                    marginBottom: '10px',
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    overflow: 'hidden',
                  }}>
                    {/* Group header */}
                    <button
                      onClick={() => setOfflineGroupExpanded(prev => ({ ...prev, [osLabel]: !isGroupOpen }))}
                      style={{
                        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 14px',
                        background: '#f8fafc', border: 'none', cursor: 'pointer', color: '#1e293b',
                        borderBottom: isGroupOpen ? '1px solid #e2e8f0' : 'none',
                      }}
                    >
                      <span style={{ fontSize: '14px', fontWeight: 700 }}>
                        {getOsIcon(devices[0].os)} {osLabel}
                        <span style={{ color: '#dc2626', marginLeft: '8px', fontWeight: 600 }}>({devices.length})</span>
                      </span>
                      <span style={{ fontSize: '14px', transform: isGroupOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s', color: '#94a3b8' }}>▾</span>
                    </button>

                    {/* Group devices table */}
                    {isGroupOpen && (
                      <div style={{ padding: '0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                          <thead>
                            <tr style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', background: '#f8fafc' }}>
                              <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Device</th>
                              <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>IP</th>
                              <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Last Seen</th>
                              <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Reason</th>
                              <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700, borderBottom: '1px solid #e2e8f0', width: '140px' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {devices.map((d, idx) => {
                              const daysOff = daysSince(d.last_polled);
                              const isHidden = hiddenIds.includes(d.device_id);
                              return (
                                <tr key={d.device_id} style={{
                                  borderBottom: '1px solid #f1f5f9',
                                  opacity: isHidden ? 0.45 : 1,
                                  background: deleteConfirm === d.device_id ? '#fef2f2' : idx % 2 === 0 ? '#fff' : '#fafbfc',
                                }}>
                                  <td style={{ padding: '10px 14px', color: '#0f172a', fontWeight: 600, fontSize: '14px' }}>
                                    {d.sysName?.split('.')[0] || d.hostname}
                                  </td>
                                  <td style={{ padding: '10px 14px', color: '#475569', fontFamily: 'monospace', fontSize: '13px' }}>
                                    {d.ip || d.hostname}
                                  </td>
                                  <td style={{ padding: '10px 14px' }}>
                                    <span style={{
                                      color: daysOff > 90 ? '#dc2626' : daysOff > 30 ? '#d97706' : '#475569',
                                      fontWeight: daysOff > 90 ? 700 : 500,
                                      fontSize: '14px',
                                    }}>
                                      {timeSince(d.last_polled)}
                                    </span>
                                    {daysOff > 90 && <span style={{ fontSize: '13px', marginLeft: '4px' }}>⚠️</span>}
                                  </td>
                                  <td style={{ padding: '10px 14px', color: '#dc2626', fontSize: '13px', fontWeight: 500 }}>
                                    {d.status_reason || '—'}
                                  </td>
                                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                    {deleteConfirm === d.device_id ? (
                                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                        <button
                                          onClick={() => handleDelete(d.device_id)}
                                          disabled={deletingId === d.device_id}
                                          style={{
                                            padding: '4px 12px', fontSize: '12px',
                                            background: '#fee2e2', border: '1px solid #fca5a5',
                                            color: '#dc2626', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                                          }}
                                        >
                                          {deletingId === d.device_id ? '...' : 'Confirm'}
                                        </button>
                                        <button
                                          onClick={() => setDeleteConfirm(null)}
                                          style={{
                                            padding: '4px 12px', fontSize: '12px',
                                            background: '#f1f5f9', border: '1px solid #cbd5e1',
                                            color: '#475569', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                                        {isHidden ? (
                                          <button
                                            onClick={() => handleUnhide(d.device_id)}
                                            title="Show device again"
                                            style={{
                                              padding: '4px 10px', fontSize: '12px',
                                              background: '#ede9fe', border: '1px solid #c4b5fd',
                                              color: '#7c3aed', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
                                            }}
                                          >
                                            Unhide
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => handleHide(d.device_id)}
                                            title="Hide — mark as reviewed"
                                            style={{
                                              padding: '4px 10px', fontSize: '12px',
                                              background: '#f1f5f9', border: '1px solid #cbd5e1',
                                              color: '#475569', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
                                            }}
                                          >
                                            Hide
                                          </button>
                                        )}
                                        {daysOff > 90 && (
                                          <button
                                            onClick={() => setDeleteConfirm(d.device_id)}
                                            title="Remove from LibreNMS (90+ days offline)"
                                            style={{
                                              padding: '4px 10px', fontSize: '12px',
                                              background: '#fef2f2', border: '1px solid #fca5a5',
                                              color: '#dc2626', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                                            }}
                                          >
                                            🗑️ Delete
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              {offlineGroups.length === 0 && offlineSearch && (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>
                  No offline devices match &quot;{offlineSearch}&quot;
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Active Alerts — Collapsible ── */}
      {(() => {
        const uniqueRules = [...new Set(alerts.map(a => a.rule))].sort();

        const filteredAlerts = alerts.filter(alert => {
          const isRuleSilenced = silencedRules.includes(alert.rule);
          const isHostSilenced = silencedHosts.some(h => alert.hostname.toLowerCase().includes(h.toLowerCase()));
          const isSilenced = isRuleSilenced || isHostSilenced;
          if (isSilenced && !showSilenced) return false;

          if (alertSearch) {
            const q = alertSearch.toLowerCase();
            if (!alert.hostname.toLowerCase().includes(q) && !alert.rule.toLowerCase().includes(q)) return false;
          }

          if (alertSeverityFilter !== 'all') {
            if (alert.severity?.toLowerCase() !== alertSeverityFilter) return false;
          }

          if (alertRuleFilter !== 'all') {
            if (alert.rule !== alertRuleFilter) return false;
          }

          return true;
        });

        if (alerts.length === 0) return null;

        return (
          <div style={{
            marginBottom: '16px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setAlertsExpanded(!alertsExpanded)}
              style={{
                width: '100%',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 18px',
                background: 'none', border: 'none', cursor: 'pointer', color: '#b45309',
              }}
            >
              <span style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                🔔 Active Alerts ({filteredAlerts.length !== alerts.length ? `${filteredAlerts.length} shown of ${alerts.length}` : alerts.length})
              </span>
              <span style={{ fontSize: '18px', transform: alertsExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#94a3b8' }}>▾</span>
            </button>

            {alertsExpanded && (
              <div style={{ padding: '0 18px 14px' }}>
                {/* Filters toolbar */}
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  marginBottom: '12px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  background: 'rgba(217, 119, 6, 0.04)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(217, 119, 6, 0.12)',
                }}>
                  <input
                    type="text"
                    placeholder="Search alert host or rule..."
                    value={alertSearch}
                    onChange={(e) => setAlertSearch(e.target.value)}
                    style={{
                      padding: '6px 12px', fontSize: '13px',
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#1e293b', borderRadius: '6px',
                      flex: '1', minWidth: '150px', outline: 'none',
                    }}
                  />
                  
                  <select
                    value={alertSeverityFilter}
                    onChange={(e) => setAlertSeverityFilter(e.target.value as any)}
                    style={{ padding: '6px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#1e293b', fontSize: '13px', cursor: 'pointer' }}
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                  </select>

                  <select
                    value={alertRuleFilter}
                    onChange={(e) => setAlertRuleFilter(e.target.value)}
                    style={{ padding: '6px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#1e293b', fontSize: '13px', cursor: 'pointer', maxWidth: '200px' }}
                  >
                    <option value="all">All Rules</option>
                    {uniqueRules.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={showSilenced}
                      onChange={(e) => setShowSilenced(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    Show Silenced
                  </label>
                </div>

                {filteredAlerts.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '14px', background: '#fff', border: '1px solid #f1f5f9', borderRadius: '8px' }}>
                    No alerts match the active filters
                  </div>
                ) : (
                  filteredAlerts.map((alert) => {
                    const isRuleSilenced = silencedRules.includes(alert.rule);
                    const isHostSilenced = silencedHosts.some(h => alert.hostname.toLowerCase().includes(h.toLowerCase()));
                    const isSilenced = isRuleSilenced || isHostSilenced;

                    return (
                      <div key={alert.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 14px',
                        background: isSilenced ? 'rgba(248, 250, 252, 0.6)' : '#fff',
                        border: isSilenced ? '1px dashed #cbd5e1' : '1px solid #f1f5f9',
                        borderRadius: '8px',
                        marginBottom: '5px',
                        fontSize: '14px',
                        opacity: isSilenced ? 0.6 : 1,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                            background: alert.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                            color: alert.severity === 'critical' ? '#dc2626' : '#b45309',
                            border: `1px solid ${alert.severity === 'critical' ? '#fecaca' : '#fde68a'}`,
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>
                            {alert.severity || 'warning'}
                          </span>
                          <span style={{ color: '#0f172a', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '14px' }}>{alert.hostname}</span>
                          <span style={{ color: '#475569', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.rule}</span>
                          {isSilenced && (
                            <span style={{ fontSize: '10px', padding: '1px 6px', background: '#e2e8f0', borderRadius: '4px', color: '#475569', fontWeight: 600 }}>
                              🔕 Silenced
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '10px' }}>
                          <span style={{ color: '#64748b', fontSize: '13px', whiteSpace: 'nowrap', fontWeight: 500 }}>{timeSince(alert.timestamp)}</span>
                          
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {isRuleSilenced ? (
                              <button
                                onClick={() => handleUnsilenceRule(alert.rule)}
                                style={{ padding: '3px 8px', fontSize: '11px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#475569', cursor: 'pointer', fontWeight: 500 }}
                              >
                                Unsilence Rule
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSilenceRule(alert.rule)}
                                disabled={isHostSilenced}
                                style={{ padding: '3px 8px', fontSize: '11px', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: '4px', color: '#d97706', cursor: isHostSilenced ? 'not-allowed' : 'pointer', fontWeight: 500 }}
                                title="Silence this rule globally"
                              >
                                🔕 Silence Rule
                              </button>
                            )}

                            {isHostSilenced ? (
                              <button
                                onClick={() => handleUnsilenceHost(alert.hostname)}
                                style={{ padding: '3px 8px', fontSize: '11px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#475569', cursor: 'pointer', fontWeight: 500 }}
                              >
                                Unsilence Host
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSilenceHost(alert.hostname)}
                                disabled={isRuleSilenced}
                                style={{ padding: '3px 8px', fontSize: '11px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '4px', color: '#dc2626', cursor: isRuleSilenced ? 'not-allowed' : 'pointer', fontWeight: 500 }}
                                title="Silence all alerts for this host"
                              >
                                🔕 Silence Host
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Silenced Items Manager */}
                {(silencedRules.length > 0 || silencedHosts.length > 0) && (
                  <div style={{
                    marginTop: '12px',
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '10px'
                  }}>
                    <button
                      onClick={() => setSilencedManagerExpanded(!silencedManagerExpanded)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '12px', color: '#64748b', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '4px', padding: 0
                      }}
                    >
                      ⚙️ Silenced Items Manager ({silencedRules.length} rules, {silencedHosts.length} hosts) {silencedManagerExpanded ? '▲' : '▼'}
                    </button>

                    {silencedManagerExpanded && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        marginTop: '8px',
                        background: '#f8fafc',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px'
                      }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Silenced Rules</div>
                          {silencedRules.length === 0 ? (
                            <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>None</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {silencedRules.map(rule => (
                                <div key={rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '4px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px' }} title={rule}>{rule}</span>
                                  <button onClick={() => handleUnsilenceRule(rule)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Silenced Hosts</div>
                          {silencedHosts.length === 0 ? (
                            <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>None</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {silencedHosts.map(host => (
                                <div key={host} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '4px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px' }} title={host}>{host}</span>
                                  <button onClick={() => handleUnsilenceHost(host)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Key Servers Health Grid — Collapsible ── */}
      {keyServers.length > 0 && !compact && (
        <div style={{ marginBottom: '18px' }}>
          <button
            onClick={() => setServersExpanded(!serversExpanded)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'none', border: 'none', cursor: 'pointer', color: '#1e293b',
              marginBottom: '10px', padding: 0,
            }}
          >
            <span style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              🖥️ Server Status ({keyServers.length} online)
            </span>
            <span style={{ fontSize: '16px', transform: serversExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#94a3b8' }}>▾</span>
          </button>
          {serversExpanded && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '10px',
            }}>
              {keyServers.map(dev => (
                <div key={dev.device_id} style={{
                  padding: '14px',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  borderLeft: '4px solid #16a34a',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
                  onClick={() => setExpandedDevice(expandedDevice === dev.device_id ? null : dev.device_id)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      {dev.sysName?.split('.')[0] || dev.hostname}
                    </span>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '14px' }}>
                    <div>
                      <span style={{ color: '#475569', fontWeight: 600 }}>IP: </span>
                      <span style={{ color: '#1e293b', fontFamily: 'monospace', fontWeight: 500 }}>{dev.ip || dev.hostname}</span>
                    </div>
                    <div>
                      <span style={{ color: '#475569', fontWeight: 600 }}>Up: </span>
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>{formatUptime(dev.uptime)}</span>
                    </div>
                  </div>
                  {expandedDevice === dev.device_id && (
                    <div style={{ marginTop: '12px' }}>
                      <DeviceMetricsPanel deviceId={dev.device_id} deviceName={dev.sysName || dev.hostname} compact showGraphs={false} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Latency Overview — Only named devices ── */}
      {!compact && (data?.devices || []).length > 0 && (() => {
        const latencyDevices = (data?.devices || [])
          .filter(d =>
            d.status === 1 &&
            (['fortigate', 'ping', 'ocnos'].includes(d.os) || d.type === 'network') &&
            d.sysName && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(d.sysName)
          )
          .slice(0, 6);

        if (latencyDevices.length === 0) return null;

        return (
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '14px', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                📡 Latencia de Red — Ping Performance
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['6h', '24h', '1w', '1m'] as const).map(tr => (
                  <button
                    key={tr}
                    onClick={() => setLatencyTimeRange(tr)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      border: `1px solid ${latencyTimeRange === tr ? '#3b82f6' : '#cbd5e1'}`,
                      background: latencyTimeRange === tr ? '#eff6ff' : '#fff',
                      color: latencyTimeRange === tr ? '#2563eb' : '#475569',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {tr}
                  </button>
                ))}
              </div>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '10px',
            }}>
              {latencyDevices.map(dev => (
                <div key={`latency-${dev.device_id}`} style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  <div style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#f8fafc',
                  }}>
                    <span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 700 }}>
                      📡 {dev.sysName?.split('.')[0] || dev.hostname}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                      {dev.ip || dev.hostname}
                    </span>
                  </div>
                  {failedGraphs[dev.device_id] ? (
                    <div style={{
                      height: '120px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#64748b',
                      background: '#f8fafc',
                      fontSize: '12px',
                      fontWeight: 500,
                    }}>
                      📊 No SNMP performance data available
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/librenms?action=graph&id=${dev.device_id}&type=device_ping_perf&from=-${latencyTimeRange}&width=500&height=120`}
                      alt={`Ping latency for ${dev.sysName || dev.hostname}`}
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                      onError={() => setFailedGraphs(prev => ({ ...prev, [dev.device_id]: true }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── TOP — Disk Usage ── */}
      <div style={{ marginBottom: '18px' }}>
        <TopDiskUsageCard compact={compact} />
      </div>

      {/* ── Devices Table — Paginated ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '14px', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
          All Devices ({filteredDevices.length})
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px', fontSize: '14px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#1e293b', borderRadius: '8px',
              width: '160px', outline: 'none',
            }}
          />
          {(['all', 'up', 'down', 'windows', 'network'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', fontSize: '13px',
                border: `1px solid ${filter === f ? '#3b82f6' : '#cbd5e1'}`,
                background: filter === f ? '#eff6ff' : '#f8fafc',
                color: filter === f ? '#2563eb' : '#475569',
                borderRadius: '8px', cursor: 'pointer', textTransform: 'capitalize',
                transition: 'all 0.15s', fontWeight: filter === f ? 600 : 500,
              }}
            >
              {f === 'windows' ? '🖥️' : f === 'network' ? '🌐' : ''} {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {/* Sticky Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '32px 1.5fr 130px 100px 100px 90px 80px',
          padding: '10px 16px',
          fontSize: '12px',
          color: '#475569',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
          borderBottom: '2px solid #e2e8f0',
          position: 'sticky', top: 0,
          background: '#f8fafc',
          zIndex: 1,
        }}>
          <span></span>
          <span>Device</span>
          <span>IP</span>
          <span>OS</span>
          <span>Hardware</span>
          <span>Uptime</span>
          <span>Polled</span>
        </div>

        {/* Rows */}
        {pagedDevices.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>
            {searchQuery ? `No results for "${searchQuery}"` : filter !== 'all' ? `No ${filter} devices` : 'No devices found'}
          </div>
        ) : (
          pagedDevices.map((dev, idx) => (
            <div key={dev.device_id}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1.5fr 130px 100px 100px 90px 80px',
                  padding: '10px 16px',
                  fontSize: '14px',
                  background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                  cursor: 'pointer',
                  borderLeft: expandedDevice === dev.device_id ? '4px solid #3b82f6' : '4px solid transparent',
                  transition: 'all 0.12s',
                  borderBottom: '1px solid #f1f5f9',
                }}
                onClick={() => setExpandedDevice(expandedDevice === dev.device_id ? null : dev.device_id)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'; }}
              >
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: dev.status === 1 ? '#16a34a' : '#dc2626',
                    display: 'inline-block',
                    boxShadow: dev.status === 1 ? '0 0 4px rgba(22,163,74,0.4)' : '0 0 4px rgba(220,38,38,0.4)',
                  }} />
                </span>
                <span style={{ color: '#0f172a', fontWeight: 600 }}>
                  {getOsIcon(dev.os)} {dev.sysName?.split('.')[0] || dev.hostname}
                </span>
                <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: '13px' }}>{dev.ip || dev.hostname}</span>
                <span style={{ color: '#7c3aed', fontSize: '13px', fontWeight: 500 }}>{getOsLabel(dev.os)}</span>
                <span style={{ color: '#475569', fontSize: '13px' }}>{dev.hardware || '—'}</span>
                <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: '13px' }}>{formatUptime(dev.uptime)}</span>
                <span style={{ color: '#64748b', fontSize: '13px' }}>{timeSince(dev.last_polled)}</span>
              </div>

              {/* Expanded Detail */}
              {expandedDevice === dev.device_id && (
                <div style={{
                  padding: '16px 22px',
                  background: '#f8fafc',
                  borderTop: '1px solid #e2e8f0',
                  borderBottom: '1px solid #e2e8f0',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                    {[
                      { label: 'Hostname', value: dev.hostname },
                      { label: 'System Name', value: dev.sysName || '—' },
                      { label: 'Hardware', value: dev.hardware || '—' },
                      { label: 'OS Version', value: dev.version || dev.os },
                      { label: 'Features', value: dev.features || '—' },
                      { label: 'Status', value: dev.status === 1 ? '✅ Online' : `❌ ${dev.status_reason || 'Offline'}` },
                    ].map((item) => (
                      <div key={item.label} style={{ padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: '14px', color: '#0f172a', marginTop: '3px', wordBreak: 'break-all', fontWeight: 500 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                    <a
                      href={`http://192.168.2.134:8000/device/device=${dev.device_id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '7px 14px',
                        background: '#eff6ff',
                        border: '1px solid #93c5fd',
                        borderRadius: '8px',
                        color: '#2563eb', fontSize: '13px', textDecoration: 'none',
                        display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600,
                      }}
                    >
                      📊 Open in LibreNMS
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(dev.ip || dev.hostname)}
                      style={{
                        padding: '7px 14px',
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        color: '#334155', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
                      }}
                    >
                      📋 Copy IP
                    </button>
                  </div>

                  {dev.status === 1 && (
                    <div style={{ marginTop: '14px' }}>
                      <DeviceMetricsPanel
                        deviceId={dev.device_id}
                        deviceName={dev.sysName || dev.hostname}
                        compact={compact}
                        showGraphs={!compact}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
            padding: '12px 16px',
            borderTop: '2px solid #e2e8f0',
            background: '#f8fafc',
          }}>
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              style={{
                padding: '6px 14px', fontSize: '13px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                color: currentPage === 0 ? '#cbd5e1' : '#334155',
                borderRadius: '8px', cursor: currentPage === 0 ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              ← Prev
            </button>
            <div style={{ display: 'flex', gap: '4px' }}>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i)}
                  style={{
                    width: '34px', height: '34px', fontSize: '14px',
                    background: currentPage === i ? '#2563eb' : '#fff',
                    border: `1px solid ${currentPage === i ? '#2563eb' : '#cbd5e1'}`,
                    color: currentPage === i ? '#fff' : '#334155',
                    borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              style={{
                padding: '6px 14px', fontSize: '13px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                color: currentPage >= totalPages - 1 ? '#cbd5e1' : '#334155',
                borderRadius: '8px', cursor: currentPage >= totalPages - 1 ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Partial error warning ── */}
      {error && (
        <div style={{
          marginTop: '10px', padding: '8px 14px',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px', fontSize: '14px', color: '#92400e', fontWeight: 500,
        }}>
          ⚠️ Partial data — {error}
        </div>
      )}

      {/* ── Refresh ── */}
      <div style={{ marginTop: '10px', textAlign: 'right', fontSize: '13px', color: '#64748b' }}>
        Auto-refreshes every 60s •{' '}
        <button onClick={fetchOverview} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          Refresh now
        </button>
      </div>
    </div>
  );
}

// ── Summary Card Sub-Component ──
function SummaryCard({ label, value, color, gradient, alert }: {
  label: string;
  value: number;
  color: string;
  gradient: string;
  alert?: boolean;
}) {
  return (
    <div style={{
      padding: '16px 18px',
      background: `linear-gradient(135deg, rgba(${gradient}, 0.1), rgba(${gradient}, 0.03))`,
      border: `1px solid rgba(${gradient}, 0.25)`,
      borderRadius: '12px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {alert && (
        <div style={{
          position: 'absolute', top: '10px', right: '10px',
          width: '10px', height: '10px', borderRadius: '50%',
          background: color, animation: 'pulse 1.5s infinite',
        }} />
      )}
      <div style={{ fontSize: '12px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: '34px', fontWeight: 800, color, marginTop: '4px' }}>
        {value}
      </div>
    </div>
  );
}
