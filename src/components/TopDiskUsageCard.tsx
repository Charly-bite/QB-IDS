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
  if (percent >= 95) return '#dc2626';
  if (percent >= 90) return '#ea580c';
  if (percent >= 80) return '#d97706';
  if (percent >= 60) return '#ca8a04';
  return '#16a34a';
}

function getUsageGradient(percent: number): string {
  if (percent >= 90) return 'linear-gradient(90deg, #ea580c, #dc2626)';
  if (percent >= 75) return 'linear-gradient(90deg, #ca8a04, #d97706)';
  return 'linear-gradient(90deg, #16a34a, #22c55e)';
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
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #16a34a, #d97706, #ea580c, #dc2626)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontSize: '14px' }}>
          <div style={{ width: 16, height: 16, border: '2px solid #d97706', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Fetching disk usage across all devices...
        </div>
      </div>
    );
  }

  if (error && partitions.length === 0) {
    return (
      <div style={{
        padding: '18px',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '12px',
        fontSize: '14px',
        color: '#dc2626',
      }}>
        ⚠️ Could not load disk usage: {error}
      </div>
    );
  }

  if (partitions.length === 0) {
    return (
      <div style={{
        padding: '28px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        textAlign: 'center',
        color: '#475569',
        fontSize: '15px',
      }}>
        <div style={{ fontSize: '32px', marginBottom: '10px' }}>💾</div>
        No storage data available. Devices may not have SNMP storage monitoring configured.
      </div>
    );
  }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '14px',
      padding: compact ? '14px' : '20px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: 'linear-gradient(90deg, #16a34a, #ca8a04, #d97706, #dc2626)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: compact ? '12px' : '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '14px',
            color: '#92400e',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 700,
          }}>
            💾 Top — Uso de Disco Duro
          </span>
          {criticalCount > 0 && (
            <span style={{
              padding: '3px 10px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#dc2626',
              fontWeight: 700,
              animation: 'pulse 2s infinite',
            }}>
              🔴 {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span style={{
              padding: '3px 10px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#92400e',
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
            color: '#2563eb',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '2px 6px',
            fontWeight: 600,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 160px 110px 70px',
        padding: '8px 12px',
        fontSize: '12px',
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 700,
        borderBottom: '2px solid #e2e8f0',
        marginBottom: '4px',
        background: '#f8fafc',
        borderRadius: '6px 6px 0 0',
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
                gridTemplateColumns: '1fr 160px 110px 70px',
                padding: '10px 12px',
                background: idx % 2 === 0 ? '#f8fafc' : '#fff',
                borderRadius: '6px',
                alignItems: 'center',
                transition: 'background 0.15s',
                borderLeft: isCritical ? '4px solid #dc2626' : '4px solid transparent',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#eff6ff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#f8fafc' : '#fff'; }}
            >
              {/* Device + Partition */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '14px' }}>{getOsEmoji(partition.os)}</span>
                  <span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {deviceLabel}
                  </span>
                  <span style={{
                    padding: '2px 6px',
                    background: '#e2e8f0',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#475569',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}>
                    {partition.ip}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
                    {partition.description}
                  </span>
                  {/* Usage bar inline */}
                  <div style={{ flex: 1, minWidth: '40px', maxWidth: '120px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(partition.percent, 100)}%`,
                      height: '100%',
                      background: gradient,
                      borderRadius: '3px',
                      transition: 'width 0.6s ease',
                      boxShadow: isCritical ? `0 0 8px ${usageColor}60` : undefined,
                    }} />
                  </div>
                </div>
              </div>

              {/* Used / Total */}
              <span style={{ fontSize: '13px', color: '#1e293b', fontFamily: 'monospace', fontWeight: 500 }}>
                {formatBytes(partition.usedBytes)} / {formatBytes(partition.sizeBytes)}
              </span>

              {/* Free */}
              <span style={{ fontSize: '13px', color: partition.freeBytes < 5 * 1024 * 1024 * 1024 ? '#dc2626' : '#475569', fontFamily: 'monospace', fontWeight: 500 }}>
                {formatBytes(partition.freeBytes)}
              </span>

              {/* Usage % */}
              <span style={{
                textAlign: 'right',
                fontSize: '15px',
                fontWeight: 800,
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
        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              color: '#334155',
              fontSize: '13px',
              padding: '6px 18px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontWeight: 600,
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
        marginTop: '14px',
        padding: '10px 12px',
        background: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        fontSize: '13px',
        color: '#475569',
        fontWeight: 500,
      }}>
        <span>
          {partitions.length} particiones • Auto-refresh 2min
        </span>
        <div style={{ display: 'flex', gap: '14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            &lt;75%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
            75-89%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
            ≥90%
          </span>
        </div>
      </div>

      {/* Partial error warning */}
      {error && (
        <div style={{
          marginTop: '10px',
          padding: '6px 12px',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          fontSize: '13px',
          color: '#92400e',
          fontWeight: 500,
        }}>
          ⚠️ Datos parciales — {error}
        </div>
      )}
    </div>
  );
}
