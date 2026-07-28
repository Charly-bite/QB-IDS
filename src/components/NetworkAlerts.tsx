'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface AlertItem {
  id: number;
  alert_type: string;
  severity: string;
  ip: string;
  device_name: string | null;
  message: string;
  details: string | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface ScannerStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  subnet: string;
  lastScanTime: string | null;
  lastScanResult: { hostsFound: number; newAlerts: number } | null;
}

interface NetworkAlertsProps {
  compact?: boolean;
  onAlertCountChange?: (count: number) => void;
}

// ─── Helpers ────────────────────────────────────────────────

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'warning': return '🟡';
    case 'info': return '🔵';
    default: return '⚪';
  }
}

function alertTypeLabel(type: string): string {
  switch (type) {
    case 'new_device': return '🆕 New Device';
    case 'device_changed': return '🔄 Changed';
    case 'device_gone': return '👻 Disappeared';
    default: return type;
  }
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ─── Component ──────────────────────────────────────────────

export default function NetworkAlerts({ compact = false, onAlertCountChange }: NetworkAlertsProps) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyAlerts, setHistoryAlerts] = useState<AlertItem[]>([]);
  const [scanner, setScanner] = useState<ScannerStatus | null>(null);
  const [isRunningDiff, setIsRunningDiff] = useState(false);
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);

  // ── Fetch active alerts ──
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/network/alerts');
      const data = await res.json();
      setAlerts(data.alerts || []);
      setScanner(data.scanner || null);
      onAlertCountChange?.(data.total || 0);
    } catch { /* ignore */ }
  }, [onAlertCountChange]);

  // ── Fetch history ──
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/network/alerts?history=true&limit=50');
      const data = await res.json();
      setHistoryAlerts(data.alerts || []);
    } catch { /* ignore */ }
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Load history when toggled
  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  // ── Actions ──
  const handleAcknowledge = async (id: number) => {
    try {
      await fetch('/api/network/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge', id }),
      });
      fetchAlerts();
    } catch { /* ignore */ }
  };

  const handleAcknowledgeAll = async () => {
    try {
      await fetch('/api/network/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge-all' }),
      });
      fetchAlerts();
    } catch { /* ignore */ }
  };

  const handleRunDiff = async () => {
    if (isRunningDiff) return;
    setIsRunningDiff(true);
    try {
      await fetch('/api/network/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-diff' }),
      });
      await fetchAlerts();
    } catch { /* ignore */ }
    setIsRunningDiff(false);
  };

  const handleToggleScanner = async () => {
    const action = scanner?.enabled ? 'stop-scanner' : 'start-scanner';
    try {
      await fetch('/api/network/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchAlerts();
    } catch { /* ignore */ }
  };

  // ── Render ──
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const displayAlerts = showHistory ? historyAlerts : alerts;

  if (compact && alerts.length === 0) return null;

  return (
    <div style={{
      marginBottom: '20px',
      background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.9))',
      border: `1px solid ${alerts.length > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(71,85,105,0.3)'}`,
      borderRadius: '14px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(51,65,85,0.5)',
        background: alerts.length > 0
          ? 'linear-gradient(90deg, rgba(239,68,68,0.05), transparent)'
          : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>
            {alerts.length > 0 ? '🔔' : '🔕'}
          </span>
          <div>
            <div style={{
              fontSize: '15px', fontWeight: 700, color: '#e2e8f0',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              Network Alerts
              {alerts.length > 0 && (
                <span style={{
                  padding: '2px 8px',
                  background: criticalCount > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                  border: `1px solid ${criticalCount > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'}`,
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: criticalCount > 0 ? '#f87171' : '#fbbf24',
                  animation: 'pulse 2s infinite',
                }}>
                  {alerts.length}
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
              {alerts.length === 0 ? 'No active alerts' : (
                <>
                  {criticalCount > 0 && <span style={{ color: '#f87171' }}>{criticalCount} critical</span>}
                  {criticalCount > 0 && warningCount > 0 && ' · '}
                  {warningCount > 0 && <span style={{ color: '#fbbf24' }}>{warningCount} warning</span>}
                  {(criticalCount > 0 || warningCount > 0) && alerts.length > criticalCount + warningCount && ' · '}
                  {alerts.length > criticalCount + warningCount && (
                    <span style={{ color: '#60a5fa' }}>{alerts.length - criticalCount - warningCount} info</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Auto-scanner toggle */}
          <button
            onClick={handleToggleScanner}
            style={{
              padding: '5px 10px',
              background: scanner?.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(51,65,85,0.4)',
              border: `1px solid ${scanner?.enabled ? 'rgba(34,197,94,0.3)' : '#475569'}`,
              borderRadius: '6px',
              color: scanner?.enabled ? '#4ade80' : '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s',
            }}
            title={scanner?.enabled ? 'Stop auto-scan' : 'Start auto-scan (30 min intervals)'}
          >
            {scanner?.enabled ? '⏹' : '▶'} Auto-Scan
            {scanner?.running && (
              <span style={{ 
                width: '6px', height: '6px', borderRadius: '50%',
                background: '#4ade80', animation: 'pulse 1.5s infinite',
                display: 'inline-block',
              }} />
            )}
          </button>

          {/* Manual diff scan */}
          <button
            onClick={handleRunDiff}
            disabled={isRunningDiff}
            style={{
              padding: '5px 10px',
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '6px',
              color: '#60a5fa',
              fontSize: '11px',
              cursor: isRunningDiff ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Run a quick ping sweep and check for new devices"
          >
            {isRunningDiff ? '⏳ Scanning...' : '🔍 Scan Now'}
          </button>

          {/* History toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: '5px 10px',
              background: showHistory ? 'rgba(139,92,246,0.15)' : 'rgba(51,65,85,0.4)',
              border: `1px solid ${showHistory ? 'rgba(139,92,246,0.3)' : '#475569'}`,
              borderRadius: '6px',
              color: showHistory ? '#a78bfa' : '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            📋 {showHistory ? 'Active' : 'History'}
          </button>

          {/* Acknowledge all */}
          {alerts.length > 0 && !showHistory && (
            <button
              onClick={handleAcknowledgeAll}
              style={{
                padding: '5px 10px',
                background: 'rgba(51,65,85,0.4)',
                border: '1px solid #475569',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              ✓ Dismiss All
            </button>
          )}
        </div>
      </div>

      {/* Auto-scanner status bar */}
      {scanner?.lastScanTime && (
        <div style={{
          padding: '6px 18px',
          borderBottom: '1px solid rgba(51,65,85,0.3)',
          fontSize: '11px',
          color: '#64748b',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          background: 'rgba(30,41,59,0.5)',
        }}>
          <span>
            Last scan: <strong style={{ color: '#94a3b8' }}>{timeAgo(scanner.lastScanTime)}</strong>
          </span>
          {scanner.lastScanResult && (
            <>
              <span>
                Hosts: <strong style={{ color: '#94a3b8' }}>{scanner.lastScanResult.hostsFound}</strong>
              </span>
              {scanner.lastScanResult.newAlerts > 0 && (
                <span style={{ color: '#fbbf24' }}>
                  ⚡ {scanner.lastScanResult.newAlerts} new alert{scanner.lastScanResult.newAlerts > 1 ? 's' : ''}
                </span>
              )}
            </>
          )}
          {scanner.enabled && (
            <span style={{ marginLeft: 'auto', color: '#4ade80' }}>
              ● Auto-scan every {scanner.intervalMinutes}m
            </span>
          )}
        </div>
      )}

      {/* Alert List */}
      {displayAlerts.length > 0 ? (
        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {displayAlerts.map((alert, idx) => (
            <div
              key={alert.id}
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid rgba(51,65,85,0.3)',
                background: idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.3)',
                transition: 'background 0.15s',
                cursor: 'pointer',
                opacity: alert.acknowledged ? 0.5 : 1,
              }}
              onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.05)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.3)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flex: 1 }}>
                  {/* Severity icon */}
                  <span style={{ fontSize: '16px', marginTop: '1px', flexShrink: 0 }}>
                    {severityIcon(alert.severity)}
                  </span>
                  
                  <div style={{ flex: 1 }}>
                    {/* Alert type badge + IP */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '1px 6px',
                        background: alert.alert_type === 'new_device' ? 'rgba(34,197,94,0.15)' :
                                   alert.alert_type === 'device_changed' ? 'rgba(59,130,246,0.15)' :
                                   'rgba(168,85,247,0.15)',
                        border: `1px solid ${alert.alert_type === 'new_device' ? 'rgba(34,197,94,0.3)' :
                                             alert.alert_type === 'device_changed' ? 'rgba(59,130,246,0.3)' :
                                             'rgba(168,85,247,0.3)'}`,
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: alert.alert_type === 'new_device' ? '#4ade80' :
                               alert.alert_type === 'device_changed' ? '#60a5fa' :
                               '#c084fc',
                      }}>
                        {alertTypeLabel(alert.alert_type)}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>
                        {alert.ip}
                      </span>
                      {alert.device_name && (
                        <span style={{ fontSize: '12px', color: '#8b5cf6' }}>
                          {alert.device_name}
                        </span>
                      )}
                    </div>
                    
                    {/* Message */}
                    <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.4' }}>
                      {alert.message}
                    </div>

                    {/* Expanded details */}
                    {expandedAlert === alert.id && alert.details && (
                      <div style={{
                        marginTop: '8px',
                        padding: '8px 12px',
                        background: 'rgba(15,23,42,0.6)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#94a3b8',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: '120px',
                        overflow: 'auto',
                      }}>
                        {JSON.stringify(JSON.parse(alert.details), null, 2)}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '10px' }}>
                  {/* Timestamp */}
                  <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {timeAgo(alert.created_at)}
                  </span>

                  {/* Acknowledge button */}
                  {!alert.acknowledged && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAcknowledge(alert.id); }}
                      style={{
                        padding: '3px 8px',
                        background: 'rgba(51,65,85,0.4)',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        color: '#94a3b8',
                        fontSize: '10px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.15)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.3)';
                        (e.currentTarget as HTMLElement).style.color = '#4ade80';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(51,65,85,0.4)';
                        (e.currentTarget as HTMLElement).style.borderColor = '#475569';
                        (e.currentTarget as HTMLElement).style.color = '#94a3b8';
                      }}
                      title="Acknowledge this alert"
                    >
                      ✓
                    </button>
                  )}
                  {alert.acknowledged && (
                    <span style={{ fontSize: '10px', color: '#4ade80' }} title={`Acknowledged by ${alert.acknowledged_by}`}>
                      ✓
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '24px 18px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '13px',
        }}>
          {showHistory ? (
            <span>No alert history yet. Run a scan to start monitoring.</span>
          ) : (
            <span>✅ All clear — no new or unknown devices detected.</span>
          )}
        </div>
      )}
    </div>
  );
}
