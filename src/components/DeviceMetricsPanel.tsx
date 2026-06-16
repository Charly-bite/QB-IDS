'use client';

import { useState, useEffect, useCallback } from 'react';
import GaugeChart from './GaugeChart';

interface DeviceMetrics {
  cpu: {
    average: number | null;
    processors: { processor_descr: string; processor_usage: number }[];
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    percent: number;
    description: string;
    pools: { mempool_descr: string; mempool_perc: number; mempool_used: number; mempool_total: number }[];
  } | null;
  storage: {
    description: string;
    sizeBytes: number;
    usedBytes: number;
    freeBytes: number;
    percent: number;
  }[];
  ports: {
    name: string;
    alias: string;
    speed: number;
    inRate: number;
    outRate: number;
    status: string;
  }[];
  uptimePercent: number | null;
  errors: Record<string, string | null>;
}

interface DeviceMetricsPanelProps {
  deviceId: number;
  deviceName: string;
  /** Compact mode — shows only gauges without graphs */
  compact?: boolean;
  /** Show embedded PNG graph images from LibreNMS */
  showGraphs?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatRate(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 bps';
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1e9) return `${(bitsPerSec / 1e9).toFixed(1)} Gbps`;
  if (bitsPerSec >= 1e6) return `${(bitsPerSec / 1e6).toFixed(1)} Mbps`;
  if (bitsPerSec >= 1e3) return `${(bitsPerSec / 1e3).toFixed(1)} Kbps`;
  return `${bitsPerSec.toFixed(0)} bps`;
}

export default function DeviceMetricsPanel({
  deviceId,
  deviceName,
  compact = false,
  showGraphs = true,
}: DeviceMetricsPanelProps) {
  const [metrics, setMetrics] = useState<DeviceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphTimeRange, setGraphTimeRange] = useState('-1d');

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/librenms?action=device-metrics&id=${deviceId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DeviceMetrics = await res.json();
      setMetrics(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div style={{
        padding: compact ? '12px' : '20px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.6))',
        border: '1px solid rgba(51, 65, 85, 0.5)',
        borderRadius: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '13px' }}>
          <div style={{ width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading metrics for {deviceName}...
        </div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div style={{
        padding: '12px 16px',
        background: 'rgba(239, 68, 68, 0.06)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: '10px',
        fontSize: '12px',
        color: '#f87171',
      }}>
        ⚠️ Could not load metrics: {error}
      </div>
    );
  }

  if (!metrics) return null;

  const hasCpu = metrics.cpu.average !== null;
  const hasMemory = metrics.memory !== null;
  const hasStorage = metrics.storage.length > 0;
  const hasPorts = metrics.ports.length > 0;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.65))',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      borderRadius: '14px',
      padding: compact ? '14px' : '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle gradient accent line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: compact ? '12px' : '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
            📊 SNMP Metrics
          </span>
          {metrics.uptimePercent !== null && (
            <span style={{
              padding: '2px 8px',
              background: metrics.uptimePercent >= 99.9 ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              border: `1px solid ${metrics.uptimePercent >= 99.9 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
              borderRadius: '10px',
              fontSize: '10px',
              color: metrics.uptimePercent >= 99.9 ? '#4ade80' : '#fbbf24',
              fontWeight: 600,
            }}>
              {metrics.uptimePercent.toFixed(2)}% uptime
            </span>
          )}
        </div>
        <button
          onClick={fetchMetrics}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '10px',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Gauges Row — CPU & Memory */}
      {(hasCpu || hasMemory) && (
        <div style={{
          display: 'flex',
          gap: compact ? '12px' : '20px',
          justifyContent: 'center',
          alignItems: 'flex-start',
          marginBottom: compact ? '12px' : '20px',
          flexWrap: 'wrap',
        }}>
          {hasCpu && (
            <div style={{ textAlign: 'center' }}>
              <GaugeChart
                value={metrics.cpu.average!}
                label="CPU Usage"
                size={compact ? 90 : 120}
                thresholds={{ warn: 60, danger: 85 }}
              />
              {!compact && metrics.cpu.processors.length > 1 && (
                <div style={{
                  display: 'flex',
                  gap: '3px',
                  justifyContent: 'center',
                  marginTop: '6px',
                  flexWrap: 'wrap',
                  maxWidth: '140px',
                }}>
                  {metrics.cpu.processors.slice(0, 8).map((p, i) => (
                    <div
                      key={i}
                      title={`${p.processor_descr}: ${p.processor_usage}%`}
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '3px',
                        background: p.processor_usage > 85 ? '#ef4444' : p.processor_usage > 60 ? '#f59e0b' : '#22c55e',
                        opacity: 0.3 + (p.processor_usage / 100) * 0.7,
                        transition: 'all 0.3s',
                        cursor: 'help',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {hasMemory && (
            <div style={{ textAlign: 'center' }}>
              <GaugeChart
                value={metrics.memory!.percent}
                label="Memory"
                size={compact ? 90 : 120}
                thresholds={{ warn: 70, danger: 90 }}
              />
              {!compact && (
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                  {formatBytes(metrics.memory!.usedBytes)} / {formatBytes(metrics.memory!.totalBytes)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Storage Bars */}
      {hasStorage && (
        <div style={{ marginBottom: compact ? '12px' : '16px' }}>
          <div style={{
            fontSize: '10px',
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
            marginBottom: '8px',
          }}>
            💾 Storage
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {metrics.storage.map((s, i) => {
              const usedPct = Math.round(s.percent);
              const barColor = usedPct > 90 ? '#ef4444' : usedPct > 75 ? '#f59e0b' : '#22c55e';
              return (
                <div key={i}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '3px',
                  }}>
                    <span style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 500 }}>
                      {s.description}
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
                      {formatBytes(s.freeBytes)} free / {formatBytes(s.sizeBytes)}
                    </span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: 'rgba(51, 65, 85, 0.5)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${usedPct}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${barColor}, ${barColor}dd)`,
                      borderRadius: '3px',
                      transition: 'width 0.6s ease',
                      boxShadow: `0 0 6px ${barColor}40`,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Port Traffic */}
      {hasPorts && !compact && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '10px',
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
            marginBottom: '8px',
          }}>
            🌐 Network Ports ({metrics.ports.length} active)
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '6px',
          }}>
            {metrics.ports.slice(0, 8).map((port, i) => (
              <div key={i} style={{
                padding: '8px 10px',
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid rgba(51, 65, 85, 0.4)',
                borderRadius: '8px',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}>
                  <span style={{ fontSize: '11px', color: '#e2e8f0', fontWeight: 600 }}>
                    {port.name}
                  </span>
                  {port.speed > 0 && (
                    <span style={{ fontSize: '9px', color: '#475569' }}>
                      {port.speed >= 1e9 ? `${(port.speed / 1e9).toFixed(0)}G` : `${(port.speed / 1e6).toFixed(0)}M`}
                    </span>
                  )}
                </div>
                {port.alias && (
                  <div style={{ fontSize: '9px', color: '#475569', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {port.alias}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px', fontSize: '10px' }}>
                  <span>
                    <span style={{ color: '#22c55e' }}>▼</span>{' '}
                    <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{formatRate(port.inRate)}</span>
                  </span>
                  <span>
                    <span style={{ color: '#3b82f6' }}>▲</span>{' '}
                    <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{formatRate(port.outRate)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Embedded LibreNMS Graph Images */}
      {showGraphs && !compact && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}>
            <span style={{
              fontSize: '10px',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}>
              📈 Performance Graphs
            </span>
            <div style={{ display: 'flex', gap: '3px' }}>
              {[
                { label: '6h', value: '-6h' },
                { label: '1d', value: '-1d' },
                { label: '1w', value: '-1w' },
                { label: '1m', value: '-1m' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setGraphTimeRange(opt.value)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '9px',
                    border: `1px solid ${graphTimeRange === opt.value ? 'rgba(59, 130, 246, 0.4)' : 'rgba(51, 65, 85, 0.4)'}`,
                    background: graphTimeRange === opt.value ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: graphTimeRange === opt.value ? '#60a5fa' : '#64748b',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              { type: 'device_processor', label: 'CPU' },
              { type: 'device_mempool', label: 'Memory' },
              { type: 'device_ping_perf', label: 'Ping Latency' },
              { type: 'device_storage', label: 'Storage' },
            ].map(graph => (
              <div key={graph.type} style={{
                background: 'rgba(30, 41, 59, 0.4)',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid rgba(51, 65, 85, 0.3)',
              }}>
                <div style={{ fontSize: '9px', color: '#475569', padding: '4px 8px', borderBottom: '1px solid rgba(51, 65, 85, 0.3)' }}>
                  {graph.label}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/librenms?action=graph&id=${deviceId}&type=${graph.type}&from=${graphTimeRange}&width=400&height=120`}
                  alt={`${graph.label} graph`}
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

      {/* No data message */}
      {!hasCpu && !hasMemory && !hasStorage && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          color: '#475569',
          fontSize: '12px',
        }}>
          No SNMP metrics available for this device. It may not support SNMP monitoring or hasn&apos;t been polled yet.
        </div>
      )}
    </div>
  );
}
