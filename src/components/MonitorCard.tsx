'use client';

import { useEffect, useState, useCallback } from 'react';
import LatencyChart from './LatencyChart';
import DevNotes from './NotesSection';

interface MonitorData {
  url: string;
  status: 'Online' | 'Offline' | 'Issues Detected' | 'Loading';
  latency: number;
  statusCode: number | null;
  errorDetail?: string;
}

interface HealthData {
  reachable: boolean;
  status?: string;
  sap?: { status: string; lastChecked: string };
  database?: { status: string; lastChecked: string };
  server?: { uptimeSeconds: number; memoryUsedMB: number; memoryTotalMB: number; memoryPercent: number };
  ssl?: { expiresAt: string; daysRemaining: number };
  metrics?: { labelsPrintedToday?: number; visitorsToday?: number; entriesToday?: number };
}

interface LatencyEntry {
  time: string;
  latency: number;
}

interface MonitorCardProps {
  url: string;
  name: string;
  healthEndpoint?: boolean;
  dbName?: string;
  type?: 'http' | 'ping';
  interval?: number;
  compact?: boolean;
  onStatusChange?: (url: string, name: string, status: string, errorDetail?: string) => void;
}

const MAX_HISTORY = 60;

export default function MonitorCard({ url, name, healthEndpoint = false, dbName, type = 'http', interval = 5000, compact = false, onStatusChange }: MonitorCardProps) {
  const [data, setData] = useState<MonitorData>({
    url,
    status: 'Loading',
    latency: 0,
    statusCode: null,
  });
  const [health, setHealth] = useState<HealthData | null>(null);
  const [history, setHistory] = useState<LatencyEntry[]>([]);
  const [lastChecked, setLastChecked] = useState<string>('—');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [customName, setCustomName] = useState(name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(name);

  // Load custom name from local storage on mount
  useEffect(() => {
    const savedName = localStorage.getItem(`qb-monitor-name-${url}`);
    if (savedName) {
      setCustomName(savedName);
      setEditNameValue(savedName);
    }
  }, [url]);

  const handleNameSave = () => {
    const newName = editNameValue.trim() || name;
    setCustomName(newName);
    setEditNameValue(newName);
    setIsEditingName(false);
    localStorage.setItem(`qb-monitor-name-${url}`, newName);
    
    // Also notify parent if necessary (alarm banner uses the name, so we should trigger onStatusChange to update it)
    if (data.status !== 'Loading' && onStatusChange) {
      onStatusChange(url, newName, data.status, data.errorDetail);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleNameSave();
    if (e.key === 'Escape') {
      setEditNameValue(customName);
      setIsEditingName(false);
    }
  };

  const fetchStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Choose endpoint based on type
      let res;
      if (type === 'ping') {
        res = await fetch(`/api/icmp-ping?host=${encodeURIComponent(url)}`);
      } else {
        res = await fetch(`/api/monitor?url=${encodeURIComponent(url)}`);
      }
      
      const result = await res.json();
      setData(result);
      
      if (result.status === 'Online' && result.latency !== undefined) {
        setHistory((prev) => {
          const newEntry = {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            latency: result.latency,
          };
          const newHistory = [...prev, newEntry];
          return newHistory.slice(-MAX_HISTORY);
        });
      }

      if (healthEndpoint && type !== 'ping' && result.status === 'Online') {
        try {
          const healthRes = await fetch(`/api/health?target=${encodeURIComponent(url)}`);
          const healthData = await healthRes.json();
          setHealth(healthData);
        } catch {
          // ignore health fetch errors
        }
      }
    } catch {
      setData({ url, status: 'Offline', latency: 0, statusCode: null, errorDetail: 'API Unreachable' });
    } finally {
      setIsRefreshing(false);
      setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  }, [url, healthEndpoint, type]);

  useEffect(() => {
    fetchStatus();
    // Use the custom interval (or default 5000ms)
    const timer = setInterval(fetchStatus, interval);
    return () => clearInterval(timer);
  }, [fetchStatus, interval]);

  // Report status changes to parent
  useEffect(() => {
    if (data.status !== 'Loading' && onStatusChange) {
      onStatusChange(url, customName, data.status, data.errorDetail);
    }
  }, [data.status, data.errorDetail, url, customName, onStatusChange]);

  const getStatusColor = () => {
    switch (data.status) {
      case 'Online': return 'status-online';
      case 'Offline': return 'status-offline';
      case 'Issues Detected': return 'status-issues';
      default: return 'status-loading';
    }
  };

  return (
    <div className={`monitor-card ${compact ? 'monitor-card-compact' : ''}`}>
      <div className="monitor-header">
        <div className="monitor-name-container">
          {isEditingName ? (
            <div className="monitor-name-edit">
              <input
                type="text"
                autoFocus
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={handleNameSave}
                className="monitor-name-input"
              />
            </div>
          ) : (
            <h3 className="monitor-name" onClick={() => setIsEditingName(true)} title="Click to edit name">
              {customName}
              <svg className="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </h3>
          )}
        </div>
        <div className="status-tooltip-container">
          <div className="status-indicator-wrapper">
            <span className={`status-dot ${getStatusColor()}`}></span>
            <span className={`status-text ${getStatusColor()}-text`}>{data.status}</span>
            {data.errorDetail && (
              <svg className="status-info-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </div>
          {data.errorDetail && (
            <div className="status-tooltip">
              <div className="status-tooltip-arrow"></div>
              <p className="status-tooltip-text">{data.errorDetail}</p>
            </div>
          )}
        </div>
      </div>

      <div className="monitor-url-row">
        <a href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer" className="monitor-url">
          {url}
        </a>
        <span className="last-checked">
          {isRefreshing && <span className="refresh-indicator"></span>}
          Last check: {lastChecked}
        </span>
      </div>

      {/* Health API: Connection indicators */}
      {healthEndpoint && health && health.reachable && (
        <div className="health-connections">
          {health.sap && (
            <div className="connection-item">
              <span className={`connection-dot ${health.sap.status === 'connected' ? 'conn-ok' : 'conn-fail'}`}></span>
              <span className="connection-label">SAP</span>
              <span className={`connection-status ${health.sap.status === 'connected' ? 'conn-ok-text' : 'conn-fail-text'}`}>
                {health.sap.status === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          )}
          {health.database && (
            <div className="connection-item">
              <span className={`connection-dot ${health.database.status === 'connected' ? 'conn-ok' : 'conn-fail'}`}></span>
              <span className="connection-label">
                {dbName || 'Database'}
              </span>
              <span className={`connection-status ${health.database.status === 'connected' ? 'conn-ok-text' : 'conn-fail-text'}`}>
                {health.database.status === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          )}
          {health.ssl && (
            <div className="connection-item">
              <span className={`connection-dot ${health.ssl.daysRemaining > 30 ? 'conn-ok' : health.ssl.daysRemaining > 7 ? 'conn-warn' : 'conn-fail'}`}></span>
              <span className="connection-label">SSL Cert</span>
              <span className={`connection-status ${health.ssl.daysRemaining > 30 ? 'conn-ok-text' : health.ssl.daysRemaining > 7 ? 'conn-warn-text' : 'conn-fail-text'}`}>
                {health.ssl.daysRemaining} days left
              </span>
            </div>
          )}
        </div>
      )}

      {/* Metrics row */}
      <div className="monitor-metrics">
        <div className="metric">
          <span className="metric-label">Latency</span>
          <span className="metric-value">{data.status === 'Loading' ? '—' : `${data.latency}ms`}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Status Code</span>
          <span className="metric-value">{data.statusCode || '—'}</span>
        </div>
        {/* Health API: KPI metrics */}
        {healthEndpoint && health?.reachable && health.metrics?.labelsPrintedToday !== undefined ? (
          <div className="metric metric-highlight">
            <span className="metric-label">Labels Today</span>
            <span className="metric-value">{health.metrics.labelsPrintedToday}</span>
          </div>
        ) : healthEndpoint && health?.reachable && health.metrics?.visitorsToday !== undefined && name !== 'QB-WEB' && name !== 'Quimica Boss' ? (
          <div className="metric metric-highlight">
            <span className="metric-label">Visitors Today</span>
            <span className="metric-value">{health.metrics.visitorsToday}</span>
          </div>
        ) : healthEndpoint && health?.reachable && health.metrics?.entriesToday !== undefined ? (
          <div className="metric metric-highlight">
            <span className="metric-label">Entries Today</span>
            <span className="metric-value">{health.metrics.entriesToday}</span>
          </div>
        ) : (
          <div className="metric">
            <span className="metric-label">Data Points</span>
            <span className="metric-value">{history.length}</span>
          </div>
        )}
      </div>

      {/* Health API: Server resources */}
      {!compact && healthEndpoint && health?.reachable && health.server && name !== 'QB-WEB' && name !== 'Quimica Boss' && (
        <div className="server-resources">
          <div className="resource-item">
            <div className="resource-header">
              <span className="resource-label">Memory</span>
              <span className="resource-value">{health.server.memoryUsedMB}MB / {health.server.memoryTotalMB}MB</span>
            </div>
            <div className="resource-bar">
              <div
                className={`resource-bar-fill ${health.server.memoryPercent > 80 ? 'bar-danger' : health.server.memoryPercent > 60 ? 'bar-warn' : 'bar-ok'}`}
                style={{ width: `${Math.min(health.server.memoryPercent, 100)}%` }}
              ></div>
            </div>
          </div>
          <div className="resource-uptime">
            <span className="resource-label">Uptime</span>
            <span className="resource-value">{formatUptime(health.server.uptimeSeconds)}</span>
          </div>
        </div>
      )}

      {!compact && (
        <div className="chart-section">
          <div className="chart-header">
            <span className="chart-title">Latency Over Time</span>
            <span className="chart-subtitle">Last {history.length} checks · {interval / 1000}s interval</span>
          </div>
          <LatencyChart history={history} />
        </div>
      )}

      {!compact && <DevNotes url={url} />}

      {!compact && (
        <div className="monitor-actions">
          <button className="action-btn" onClick={fetchStatus} disabled={isRefreshing}>
            {isRefreshing ? 'Checking…' : 'Refresh Now'}
          </button>
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
