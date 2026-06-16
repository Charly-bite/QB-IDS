'use client';

import { useState, useEffect, useCallback } from 'react';

interface StoragePartition {
  device_id: number;
  hostname: string;
  sysName: string;
  ip: string;
  os: string;
  description: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  freeBytes: number;
  percent: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getUsageColor(percent: number): string {
  if (percent >= 95) return '#ef4444';
  if (percent >= 90) return '#f97316';
  if (percent >= 80) return '#f59e0b';
  if (percent >= 60) return '#eab308';
  return '#22c55e';
}

function getUsageGradient(percent: number): string {
  if (percent >= 90) return 'linear-gradient(90deg, #f97316, #ef4444)';
  if (percent >= 75) return 'linear-gradient(90deg, #eab308, #f59e0b)';
  return 'linear-gradient(90deg, #22c55e, #4ade80)';
}

function getOsEmoji(os: string): string {
  if (os === 'windows') return '🖥️';
  if (os === 'linux') return '🐧';
  if (os === 'fortigate') return '🛡️';
  return '💻';
}

export default function TopDiskUsageCard({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [partitions, setPartitions] = useState<StoragePartition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchStorage = useCallback(async () => {
    try {
      const res = await fetch('/api/librenms?action=top-storage&limit=30');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      }
      setPartitions(data.partitions || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStorage();
    const interval = setInterval(fetchStorage, 120000); // Refresh every 2 min
    return () => clearInterval(interval);
  }, [fetchStorage]);

  const criticalCount = partitions.filter(p => p.percent >= 90).length;
  const warningCount = partitions.filter(p => p.percent >= 75 && p.percent < 90).length;
  const displayPartitions = showAll ? partitions : partitions.slice(0, compact ? 5 : 10);

  if (loading) {
    return (
      <div style={{
        padding: '24px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.6))',
        border: '1px solid rgba(51, 65, 85, 0.5)',
        borderRadius: '14px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, #f59e0b, #ef4444, #8b5cf6)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '13px' }}>
          <div style={{ width: 16, height: 16, border: '2px solid #f59e0b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Fetching disk usage across all devices...
        </div>
      </div>
    );
  }

  if (error && partitions.length === 0) {
    return (
      <div style={{
        padding: '16px',
        background: 'rgba(239, 68, 68, 0.06)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: '12px',
        fontSize: '12px',
        color: '#f87171',
      }}>
        ⚠️ Could not load disk usage: {error}
      </div>
    );
  }

  if (partitions.length === 0) {
    return (
      <div style={{
        padding: '24px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.6))',
        border: '1px solid rgba(51, 65, 85, 0.5)',
        borderRadius: '14px',
        textAlign: 'center',
        color: '#475569',
        fontSize: '13px',
      }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>💾</div>
        No storage data available. Devices may not have SNMP storage monitoring configured.
      </div>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.65))',
      border: '1px solid rgba(245, 158, 11, 0.2)',
      borderRadius: '14px',
      padding: compact ? '14px' : '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: 'linear-gradient(90deg, #22c55e, #eab308, #f59e0b, #ef4444)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: compact ? '12px' : '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '11px',
            color: '#f59e0b',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>
            💾 Top — Uso de Disco Duro
          </span>
          {criticalCount > 0 && (
            <span style={{
              padding: '2px 8px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              fontSize: '10px',
              color: '#f87171',
              fontWeight: 600,
              animation: 'pulse 2s infinite',
            }}>
              🔴 {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span style={{
              padding: '2px 8px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: '10px',
              fontSize: '10px',
              color: '#fbbf24',
              fontWeight: 600,
            }}>
              🟡 {warningCount} advertencia{warningCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={fetchStorage}
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

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 100px 60px',
        padding: '6px 10px',
        fontSize: '9px',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 600,
        borderBottom: '1px solid rgba(51, 65, 85, 0.4)',
        marginBottom: '4px',
      }}>
        <span>Dispositivo / Partición</span>
        <span>Usado / Total</span>
        <span>Libre</span>
        <span style={{ textAlign: 'right' }}>Uso</span>
      </div>

      {/* Partition rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {displayPartitions.map((partition, idx) => {
          const usageColor = getUsageColor(partition.percent);
          const gradient = getUsageGradient(partition.percent);
          const isCritical = partition.percent >= 90;
          const deviceLabel = partition.sysName?.split('.')[0] || partition.hostname;

          return (
            <div
              key={`${partition.device_id}-${partition.description}-${idx}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 100px 60px',
                padding: '8px 10px',
                background: idx % 2 === 0 ? 'rgba(30, 41, 59, 0.5)' : 'transparent',
                borderRadius: '6px',
                alignItems: 'center',
                transition: 'background 0.15s',
                borderLeft: isCritical ? '3px solid #ef4444' : '3px solid transparent',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(59, 130, 246, 0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.5)' : 'transparent'; }}
            >
              {/* Device + Partition */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '12px' }}>{getOsEmoji(partition.os)}</span>
                  <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {deviceLabel}
                  </span>
                  <span style={{
                    padding: '1px 5px',
                    background: 'rgba(51, 65, 85, 0.4)',
                    borderRadius: '3px',
                    fontSize: '9px',
                    color: '#94a3b8',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                  }}>
                    {partition.ip}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {partition.description}
                  </span>
                  {/* Usage bar inline */}
                  <div style={{ flex: 1, minWidth: '40px', maxWidth: '120px', height: '4px', background: 'rgba(51, 65, 85, 0.5)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(partition.percent, 100)}%`,
                      height: '100%',
                      background: gradient,
                      borderRadius: '2px',
                      transition: 'width 0.6s ease',
                      boxShadow: isCritical ? `0 0 8px ${usageColor}60` : undefined,
                    }} />
                  </div>
                </div>
              </div>

              {/* Used / Total */}
              <span style={{ fontSize: '11px', color: '#cbd5e1', fontFamily: 'monospace' }}>
                {formatBytes(partition.usedBytes)} / {formatBytes(partition.sizeBytes)}
              </span>

              {/* Free */}
              <span style={{ fontSize: '11px', color: partition.freeBytes < 5 * 1024 * 1024 * 1024 ? '#f87171' : '#94a3b8', fontFamily: 'monospace' }}>
                {formatBytes(partition.freeBytes)}
              </span>

              {/* Usage % */}
              <span style={{
                textAlign: 'right',
                fontSize: '13px',
                fontWeight: 700,
                color: usageColor,
                fontFamily: 'monospace',
              }}>
                {Math.round(partition.percent)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Show all / collapse */}
      {partitions.length > (compact ? 5 : 10) && (
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'rgba(51, 65, 85, 0.3)',
              border: '1px solid rgba(51, 65, 85, 0.5)',
              borderRadius: '6px',
              color: '#94a3b8',
              fontSize: '11px',
              padding: '4px 14px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {showAll ? '▲ Mostrar menos' : `▼ Ver todo (${partitions.length} particiones)`}
          </button>
        </div>
      )}

      {/* Summary stats bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '12px',
        padding: '8px 10px',
        background: 'rgba(30, 41, 59, 0.5)',
        borderRadius: '8px',
        fontSize: '10px',
        color: '#64748b',
      }}>
        <span>
          {partitions.length} particiones • Auto-refresh 2min
        </span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            &lt;75%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            75-89%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            ≥90%
          </span>
        </div>
      </div>

      {/* Partial error warning */}
      {error && (
        <div style={{
          marginTop: '8px',
          padding: '4px 10px',
          background: 'rgba(245, 158, 11, 0.06)',
          border: '1px solid rgba(245, 158, 11, 0.15)',
          borderRadius: '6px',
          fontSize: '10px',
          color: '#fbbf24',
        }}>
          ⚠️ Datos parciales — {error}
        </div>
      )}
    </div>
  );
}
