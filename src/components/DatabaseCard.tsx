'use client';

import { useEffect, useState, useCallback } from 'react';
import LatencyChart from './LatencyChart';

interface DatabaseCardProps {
  host: string;
  port: number;
  serverName: string;
  dbName?: string;
  compact?: boolean;
  onStatusChange?: (url: string, name: string, status: string, errorDetail?: string) => void;
}

interface TcpStatus {
  status: 'Online' | 'Offline' | 'Loading';
  latency: number;
  errorDetail?: string;
}

interface LatencyEntry {
  time: string;
  latency: number;
}

export default function DatabaseCard({ host, port, serverName, dbName, compact = false, onStatusChange }: DatabaseCardProps) {
  const [data, setData] = useState<TcpStatus>({ status: 'Loading', latency: 0 });
  const [history, setHistory] = useState<LatencyEntry[]>([]);
  
  // Custom name state (similar to MonitorCard for editability)
  const [customName, setCustomName] = useState(serverName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(serverName);

  // Load custom name from local storage on mount
  useEffect(() => {
    const savedName = localStorage.getItem(`qb-db-name-${host}-${port}`);
    if (savedName) {
      setCustomName(savedName);
      setEditNameValue(savedName);
    }
  }, [host, port]);

  const handleNameSave = () => {
    const newName = editNameValue.trim() || serverName;
    setCustomName(newName);
    setEditNameValue(newName);
    setIsEditingName(false);
    localStorage.setItem(`qb-db-name-${host}-${port}`, newName);
    
    if (data.status !== 'Loading' && onStatusChange) {
      onStatusChange(`${host}:${port}`, newName, data.status, data.errorDetail);
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
    try {
      const res = await fetch(`/api/tcp-ping?host=${encodeURIComponent(host)}&port=${port}`);
      const result = await res.json();
      setData(result);
      
      // Update history if online
      if (result.status === 'Online' && result.latency !== undefined) {
        setHistory((prev) => {
          const newEntry = {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            latency: result.latency,
          };
          const newHistory = [...prev, newEntry];
          if (newHistory.length > 20) newHistory.shift();
          return newHistory;
        });
      }
    } catch {
      setData({ status: 'Offline', latency: 0, errorDetail: 'API Unreachable' });
    }
  }, [host, port]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Report status changes to parent
  useEffect(() => {
    if (data.status !== 'Loading' && onStatusChange) {
      onStatusChange(`${host}:${port}`, customName, data.status, data.errorDetail);
    }
  }, [data.status, data.errorDetail, host, port, customName, onStatusChange]);

  return (
    <div className={`db-card ${data.status === 'Offline' ? 'db-card-error' : ''} ${compact ? 'db-card-compact' : ''}`}>
      <div className="monitor-name-container" style={{ marginBottom: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
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
      
      {data.status === 'Loading' ? (
        <div className="db-status-row">
          <span className="status-dot status-loading"></span>
          <span className="db-status-text">Checking connection...</span>
        </div>
      ) : (
        <div className="db-connection-block">
          <div className="db-connection-header">
            <div className="db-connection-title">
              <span className={`status-dot ${data.status === 'Online' ? 'status-online' : 'status-offline'}`}></span>
              <h4>{dbName || 'Database'}</h4>
            </div>
            <span className={`db-badge ${data.status === 'Online' ? 'db-badge-ok' : 'db-badge-error'}`}>
              {data.status}
            </span>
          </div>
          
          <div className="db-connection-meta" style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '8px' }}>
            <span>Host: {host}:{port}</span>
            {data.status === 'Online' && <span>{data.latency}ms</span>}
          </div>
          {data.errorDetail && (
            <div className="db-connection-meta" style={{ color: '#dc2626', marginTop: '4px' }}>
              Error: {data.errorDetail}
            </div>
          )}
        </div>
      )}
      
      {!compact && (
        <div className="chart-section" style={{ marginTop: '16px' }}>
          <div className="chart-header">
            <span className="chart-title">Latency Over Time</span>
            <span className="chart-subtitle">Last {history.length} checks · 5s interval</span>
          </div>
          <LatencyChart history={history} />
        </div>
      )}
    </div>
  );
}
