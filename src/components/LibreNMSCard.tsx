'use client';

import { useState, useEffect, useCallback } from 'react';
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

  const filteredDevices = (data?.devices || []).filter((d) => {
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
  });

  // Separate key servers from general devices
  const keyServers = (data?.devices || []).filter(d =>
    d.os === 'windows' && d.status === 1 && d.sysName
  );

  if (loading) {
    return (
      <div style={{
        padding: '60px',
        textAlign: 'center',
        color: '#64748b',
        background: 'rgba(15, 23, 42, 0.6)',
        borderRadius: '16px',
        border: '1px solid rgba(51, 65, 85, 0.5)',
      }}>
        <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }}>📡</div>
        <div style={{ fontSize: '14px', fontWeight: 500 }}>Connecting to LibreNMS...</div>
        <div style={{ fontSize: '11px', marginTop: '4px', color: '#475569' }}>192.168.2.134:8000</div>
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
        color: '#f87171',
        fontSize: '13px',
      }}>
        <strong>⚠️ LibreNMS Connection Error</strong>
        <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '12px' }}>{error}</div>
      </div>
    );
  }

  const { summary } = data || { summary: { totalDevices: 0, devicesUp: 0, devicesDown: 0, activeAlerts: 0, osCounts: {} } };
  const alerts = data?.alerts || [];
  const downDevices = (data?.devices || []).filter(d => d.status === 0);

  return (
    <div>
      {/* ── Summary Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: '14px',
        marginBottom: '20px',
      }}>
        <SummaryCard label="Total Devices" value={summary.totalDevices} color="#60a5fa" gradient="59, 130, 246" />
        <SummaryCard label="Online" value={summary.devicesUp} color="#4ade80" gradient="34, 197, 94" />
        <SummaryCard label="Offline" value={summary.devicesDown} color={summary.devicesDown > 0 ? '#f87171' : '#475569'} gradient={summary.devicesDown > 0 ? '239, 68, 68' : '51, 65, 85'} alert={summary.devicesDown > 0} />
        <SummaryCard label="Active Alerts" value={summary.activeAlerts} color={summary.activeAlerts > 0 ? '#fbbf24' : '#475569'} gradient={summary.activeAlerts > 0 ? '245, 158, 11' : '51, 65, 85'} alert={summary.activeAlerts > 0} />
      </div>

      {/* ── OS Distribution ── */}
      {summary.osCounts && (
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}>
          {Object.entries(summary.osCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([os, count]) => (
              <div key={os} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid rgba(51, 65, 85, 0.4)',
                borderRadius: '20px',
                fontSize: '11px',
                color: '#94a3b8',
              }}>
                <span>{getOsIcon(os)}</span>
                <span>{getOsLabel(os)}</span>
                <span style={{ color: '#60a5fa', fontWeight: 600 }}>{count}</span>
              </div>
            ))}
        </div>
      )}

      {/* ── Down Devices Alert ── */}
      {downDevices.length > 0 && (
        <div style={{
          marginBottom: '16px',
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.03))',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '11px', color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '8px' }}>
            🔴 Offline Devices ({downDevices.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {downDevices.map(d => (
              <div key={d.device_id} style={{
                padding: '5px 10px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#fca5a5',
              }}>
                <span style={{ fontWeight: 600 }}>{d.sysName || d.hostname}</span>
                <span style={{ color: '#64748b', marginLeft: '6px', fontFamily: 'monospace', fontSize: '10px' }}>{d.ip || d.hostname}</span>
                {d.status_reason && <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '10px' }}>({d.status_reason})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Active Alerts ── */}
      {alerts.length > 0 && (
        <div style={{
          marginBottom: '16px',
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.02))',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '11px', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '10px' }}>
            🔔 Active Alerts ({alerts.length})
          </div>
          {alerts.slice(0, 8).map((alert) => (
            <div key={alert.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 10px',
              background: 'rgba(30, 41, 59, 0.5)',
              borderRadius: '8px',
              marginBottom: '5px',
              fontSize: '12px',
            }}>
              <div>
                <span style={{ color: alert.severity === 'critical' ? '#f87171' : '#fbbf24', fontWeight: 600 }}>
                  {alert.severity === 'critical' ? '🔴' : '🟡'} {alert.hostname}
                </span>
                <span style={{ color: '#94a3b8', marginLeft: '8px' }}>{alert.rule}</span>
              </div>
              <span style={{ color: '#64748b', fontSize: '11px', whiteSpace: 'nowrap' }}>{timeSince(alert.timestamp)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Key Servers Health Grid ── */}
      {keyServers.length > 0 && !compact && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '10px' }}>
            🖥️ Server Status ({keyServers.length} online)
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '10px',
          }}>
            {keyServers.map(dev => (
              <div key={dev.device_id} style={{
                padding: '14px',
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6))',
                border: '1px solid rgba(51, 65, 85, 0.5)',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                borderLeft: `3px solid ${dev.status === 1 ? '#4ade80' : '#ef4444'}`,
              }}
                onClick={() => setExpandedDevice(expandedDevice === dev.device_id ? null : dev.device_id)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59, 130, 246, 0.5)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(51, 65, 85, 0.5)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                    {dev.sysName?.split('.')[0] || dev.hostname}
                  </span>
                  <span className={`status-dot ${dev.status === 1 ? 'status-online' : 'status-offline'}`}
                    style={{ width: 8, height: 8, display: 'inline-block' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                  <div>
                    <span style={{ color: '#64748b' }}>IP: </span>
                    <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{dev.ip || dev.hostname}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>OS: </span>
                    <span style={{ color: '#8b5cf6' }}>{dev.version || dev.os}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>HW: </span>
                    <span style={{ color: '#94a3b8' }}>{dev.hardware || '—'}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Up: </span>
                    <span style={{ color: '#4ade80' }}>{formatUptime(dev.uptime)}</span>
                  </div>
                </div>

                {dev.features && (
                  <div style={{ marginTop: '6px', fontSize: '10px', color: '#475569' }}>
                    {dev.features}
                  </div>
                )}

                {/* Link to LibreNMS */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                  <a
                    href={`http://192.168.2.134:8000/device/device=${dev.device_id}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      padding: '3px 8px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      borderRadius: '5px',
                      color: '#60a5fa',
                      fontSize: '10px',
                      textDecoration: 'none',
                    }}
                  >
                    📊 LibreNMS
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Latency Overview — Ping Graphs for Key Devices ── */}
      {!compact && (data?.devices || []).length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '10px' }}>
            📡 Latencia de Red — Ping Performance
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: '10px',
          }}>
            {(data?.devices || [])
              .filter(d => d.status === 1 && (['fortigate', 'ping', 'ocnos'].includes(d.os) || d.type === 'network'))
              .slice(0, 6)
              .map(dev => (
                <div key={`latency-${dev.device_id}`} style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(51, 65, 85, 0.4)',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '11px', color: '#e2e8f0', fontWeight: 600 }}>
                      📡 {dev.sysName?.split('.')[0] || dev.hostname}
                    </span>
                    <span style={{ fontSize: '9px', color: '#64748b', fontFamily: 'monospace' }}>
                      {dev.ip || dev.hostname}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/librenms?action=graph&id=${dev.device_id}&type=device_ping_perf&from=-6h&width=500&height=120`}
                    alt={`Ping latency for ${dev.sysName || dev.hostname}`}
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── TOP — Uso de Disco Duro ── */}
      <div style={{ marginBottom: '20px' }}>
        <TopDiskUsageCard compact={compact} />
      </div>

      {/* ── Devices Table ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          All Devices ({filteredDevices.length})
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              border: '1px solid #475569',
              background: 'rgba(30, 41, 59, 0.6)',
              color: '#e2e8f0',
              borderRadius: '6px',
              width: '140px',
              outline: 'none',
            }}
          />
          {(['all', 'up', 'down', 'windows', 'network'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                border: `1px solid ${filter === f ? 'rgba(59, 130, 246, 0.4)' : '#475569'}`,
                background: filter === f ? 'rgba(59, 130, 246, 0.15)' : 'rgba(51, 65, 85, 0.3)',
                color: filter === f ? '#60a5fa' : '#94a3b8',
                borderRadius: '6px',
                cursor: 'pointer',
                textTransform: 'capitalize',
                transition: 'all 0.15s',
              }}
            >
              {f === 'windows' ? '🖥️' : f === 'network' ? '🌐' : ''} {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'rgba(15, 23, 42, 0.5)',
        border: '1px solid rgba(51, 65, 85, 0.4)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '28px 1.5fr 120px 90px 90px 80px 70px',
          padding: '10px 14px',
          fontSize: '10px',
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
          borderBottom: '1px solid rgba(51, 65, 85, 0.4)',
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
        {filteredDevices.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: '13px' }}>
            {searchQuery ? `No results for "${searchQuery}"` : filter !== 'all' ? `No ${filter} devices` : 'No devices found'}
          </div>
        ) : (
          filteredDevices.map((dev, idx) => (
            <div key={dev.device_id}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1.5fr 120px 90px 90px 80px 70px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  background: idx % 2 === 0 ? 'rgba(30, 41, 59, 0.4)' : 'transparent',
                  cursor: 'pointer',
                  borderLeft: expandedDevice === dev.device_id ? '3px solid #3b82f6' : '3px solid transparent',
                  transition: 'all 0.12s',
                }}
                onClick={() => setExpandedDevice(expandedDevice === dev.device_id ? null : dev.device_id)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(59, 130, 246, 0.06)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.4)' : 'transparent'; }}
              >
                <span>
                  <span
                    className={`status-dot ${dev.status === 1 ? 'status-online' : 'status-offline'}`}
                    style={{ width: 7, height: 7, display: 'inline-block' }}
                  />
                </span>
                <span style={{ color: '#e2e8f0', fontWeight: 500 }}>
                  {getOsIcon(dev.os)} {dev.sysName?.split('.')[0] || dev.hostname}
                </span>
                <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '11px' }}>{dev.ip || dev.hostname}</span>
                <span style={{ color: '#8b5cf6', fontSize: '11px' }}>{getOsLabel(dev.os)}</span>
                <span style={{ color: '#64748b', fontSize: '10px' }}>{dev.hardware || '—'}</span>
                <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '11px' }}>{formatUptime(dev.uptime)}</span>
                <span style={{ color: '#475569', fontSize: '10px' }}>{timeSince(dev.last_polled)}</span>
              </div>

              {/* Expanded Detail */}
              {expandedDevice === dev.device_id && (
                <div style={{
                  padding: '14px 20px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  borderTop: '1px solid rgba(59, 130, 246, 0.15)',
                  borderBottom: '1px solid rgba(59, 130, 246, 0.15)',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                    {[
                      { label: 'Hostname', value: dev.hostname },
                      { label: 'System Name', value: dev.sysName || '—' },
                      { label: 'Hardware', value: dev.hardware || '—' },
                      { label: 'OS Version', value: dev.version || dev.os },
                      { label: 'Features', value: dev.features || '—' },
                      { label: 'Status', value: dev.status === 1 ? '✅ Online' : `❌ ${dev.status_reason || 'Offline'}` },
                    ].map((item) => (
                      <div key={item.label} style={{ padding: '6px 10px', background: 'rgba(51, 65, 85, 0.3)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
                        <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px', wordBreak: 'break-all' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
                    <a
                      href={`http://192.168.2.134:8000/device/device=${dev.device_id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '5px 12px',
                        background: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '6px',
                        color: '#60a5fa',
                        fontSize: '11px',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      📊 Open in LibreNMS
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(dev.ip || dev.hostname)}
                      style={{
                        padding: '5px 10px',
                        background: 'rgba(51, 65, 85, 0.4)',
                        border: '1px solid #475569',
                        borderRadius: '6px',
                        color: '#94a3b8',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      📋 Copy IP
                    </button>
                  </div>

                  {/* Embedded SNMP Metrics from LibreNMS */}
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
      </div>

      {/* ── Partial error warning ── */}
      {error && (
        <div style={{
          marginTop: '10px',
          padding: '6px 12px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: '8px',
          fontSize: '11px',
          color: '#fbbf24',
        }}>
          ⚠️ Partial data — {error}
        </div>
      )}

      {/* ── Refresh ── */}
      <div style={{ marginTop: '10px', textAlign: 'right', fontSize: '10px', color: '#475569' }}>
        Auto-refreshes every 60s •{' '}
        <button onClick={fetchOverview} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '10px' }}>
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
      padding: '16px',
      background: `linear-gradient(135deg, rgba(${gradient}, 0.12), rgba(${gradient}, 0.03))`,
      border: `1px solid rgba(${gradient}, 0.25)`,
      borderRadius: '12px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {alert && (
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          animation: 'pulse 1.5s infinite',
        }} />
      )}
      <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '30px', fontWeight: 700, color, marginTop: '4px' }}>
        {value}
      </div>
    </div>
  );
}
