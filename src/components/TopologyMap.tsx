'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface TopoNode {
  id: string;
  label: string;
  ip: string;
  type: 'server' | 'switch' | 'firewall' | 'router' | 'internet' | 'database' | 'other' | 'printer' | 'camera' | 'phone' | 'voip-phone' | 'nas' | 'access-point' | 'ups' | 'iot';
  x?: number;
  y?: number;
  isMonitored?: boolean;
}

interface TopoLink {
  from: string;
  to: string;
  label?: string;
}

interface TopologyMapProps {
  nodes: TopoNode[];
  links: TopoLink[];
  statuses: Record<string, string>;
  deviceInfo?: Record<string, {
    latency?: number;
    last_seen?: string | null;
    hostname?: string;
    mac?: string;
    device_type?: string;
    vendor?: string | null;
    os?: string | null;
    ports?: string | null;
  }>;
}

interface PhysicsNode extends TopoNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  isDragging?: boolean;
}

const hubColors: Record<string, string> = {
  'hub-servers': '#10b981',      // Emerald
  'hub-networking': '#3b82f6',   // Blue
  'hub-voip': '#06b6d4',         // Cyan
  'hub-surveillance': '#f43f5e', // Rose
  'hub-printers': '#a855f7',     // Purple
  'hub-workstations': '#8b5cf6', // Violet
  'hub-other': '#64748b',        // Slate
};

const getCategoryColor = (type: string | undefined | null, id: string | undefined | null): string => {
  if (id && id.startsWith('hub-')) {
    return hubColors[id] || '#64748b';
  }
  
  const typeLower = (type || 'other').toLowerCase();
  if (['server', 'database', 'nas'].includes(typeLower)) return '#10b981'; // Emerald
  if (['switch', 'router', 'firewall', 'access-point'].includes(typeLower)) return '#3b82f6'; // Blue
  if (['voip-phone', 'phone'].includes(typeLower)) return '#06b6d4'; // Cyan
  if (['camera'].includes(typeLower)) return '#f43f5e'; // Rose
  if (['printer'].includes(typeLower)) return '#a855f7'; // Purple
  if (['workstation'].includes(typeLower)) return '#8b5cf6'; // Violet
  return '#64748b'; // Slate
};

// Draw functions — clean leaf dots and full core icons
const drawNode = (ctx: CanvasRenderingContext2D, node: PhysicsNode, status: string, isHovered: boolean, scale: number) => {
  const x = node.x;
  const y = node.y;
  const isLeafDot = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(node.type || 'other') && !(node.id && node.id.startsWith('hub-'));
  
  const categoryColor = getCategoryColor(node.type, node.id);
  const color = status === 'online' ? categoryColor
              : status === 'offline' ? '#ef4444' : '#64748b';
  
  if (isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 / scale;
  }

  let r = 6;
  if (isLeafDot) {
    // Small dot for leaf devices
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? color : '#1e293b';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    // Full icon for known devices & hubs
    const isHub = node.id && node.id.startsWith('hub-');
    r = 14;
    if (node.type === 'internet') r = 20;
    else if (node.id === 'switch-main') r = 22; // Make core switch stand out
    else if (isHub) r = 18; // Hubs
    else if (node.type === 'switch' || node.type === 'firewall' || node.type === 'router') r = 16;
    
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Type indicator symbol
    ctx.fillStyle = color;
    ctx.font = `bold ${r === 22 ? 14 : r === 18 ? 12 : 10}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Core/hub symbols
    const symbols: Record<string, string> = {
      internet: '🌐',
      firewall: '🛡️',
      switch: '⬡',
      server: '🖥️',
      router: '⇄',
      database: '🗄️',
      nas: '💾',
    };
    
    let symbol = symbols[node.type || 'other'] || '?';
    if (isHub && node.id) {
      const hubSymbols: Record<string, string> = {
        'hub-servers': '🖥️',
        'hub-networking': '⬡',
        'hub-voip': '📞',
        'hub-surveillance': '📹',
        'hub-printers': '🖨️',
        'hub-workstations': '💻',
        'hub-other': '⚙️',
      };
      symbol = hubSymbols[node.id] || '⬡';
    }
    
    ctx.fillText(symbol, x, y);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Labels (only if zoomed in enough or it's a hovered/known device)
  const labelScale = scale;
  const shouldShowLabel = !isLeafDot || labelScale > 0.8 || isHovered;
  if (shouldShowLabel) {
    const fontSize = isLeafDot ? 8 : 10;
    ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = isLeafDot ? '#94a3b8' : '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(node.label || 'Unknown', x, y + (isLeafDot ? 10 : r + 6));
    
    if (!isLeafDot || isHovered) {
      ctx.font = '8px monospace';
      ctx.fillStyle = '#64748b';
      // Only draw IP for devices that actually have an IP (exclude virtual hubs/internet)
      if (node.ip && node.ip !== '0.0.0.0' && !node.ip.startsWith('0.0.0.')) {
        ctx.fillText(node.ip, x, y + (isLeafDot ? 20 : r + 18));
      }
    }
  }
};

export default function TopologyMap({ nodes, links, statuses, deviceInfo = {} }: TopologyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: TopoNode } | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const physicsNodesRef = useRef<Map<string, PhysicsNode>>(new Map());
  const dragNodeRef = useRef<string | null>(null);
  const animationRef = useRef<number | undefined>(undefined);
  
  // Zoom & Pan state
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  
  // Keep statuses in a ref so the animation loop doesn't restart on every status change
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  
  // Keep hoveredNode in a ref so hovering doesn't restart the animation loop
  const hoveredNodeRef = useRef(hoveredNode);
  hoveredNodeRef.current = hoveredNode;

  // Sync nodes into physics — add new, remove stale
  useEffect(() => {
    const map = physicsNodesRef.current;
    const currentIds = new Set(nodes.map(n => n.id));
    
    // Remove nodes that no longer exist
    map.forEach((_, id) => {
      if (!currentIds.has(id)) map.delete(id);
    });

    // Add new nodes
    nodes.forEach(node => {
      if (!map.has(node.id)) {
        map.set(node.id, {
          ...node,
          x: node.x ?? 400 + (Math.random() - 0.5) * 600,
          y: node.y ?? 300 + (Math.random() - 0.5) * 400,
          vx: 0,
          vy: 0,
        });
      } else {
        // Update metadata without resetting position
        const existing = map.get(node.id)!;
        existing.label = node.label;
        existing.type = node.type;
        existing.isMonitored = node.isMonitored;
      }
    });

    setNodeCount(map.size);
  }, [nodes]);

  const getStatus = useCallback((ip: string, id?: string): string => {
    if (id?.startsWith('hub-')) return 'online';
    if (id === 'internet') return 'online';
    const s = statusesRef.current[ip];
    if (!s) return 'loading';
    return s === 'Online' ? 'online' : 'offline';
  }, []);

  // Convert screen coords to world coords (accounting for zoom/pan)
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const v = viewRef.current;
    return {
      x: (sx - v.panX) / v.zoom,
      y: (sy - v.panY) / v.zoom,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 800;
    let height = 500;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Zoom handler
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.2, Math.min(5, v.zoom * zoomFactor));

      // Zoom towards mouse position
      v.panX = mx - (mx - v.panX) * (newZoom / v.zoom);
      v.panY = my - (my - v.panY) * (newZoom / v.zoom);
      v.zoom = newZoom;
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    const tick = () => {
      try {
      const pNodes = Array.from(physicsNodesRef.current.values());
      const v = viewRef.current;
      
      // Physics forces (with safeguards for large node counts)
      const nodeCount = pNodes.length;
      
      for (let i = 0; i < nodeCount; i++) {
        const n1 = pNodes[i];
        if (n1.isDragging) continue;

        // Core infrastructure is static
        if (n1.type === 'internet' || n1.id === 'switch-main') {
          n1.vx = 0;
          n1.vy = 0;
          continue;
        }

        let fx = 0, fy = 0;

        // Center gravity (gentle pull to keep grouped)
        const gravityStrength = nodeCount > 100 ? 0.004 : 0.003;
        fx += (400 - n1.x) * gravityStrength;
        fy += (250 - n1.y) * gravityStrength;

        // Repulsion — skip distant pairs for performance
        for (let j = 0; j < nodeCount; j++) {
          if (i === j) continue;
          const n2 = pNodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const distSq = dx * dx + dy * dy;
          
          // Skip if too far apart (optimization for large graphs)
          if (distSq > 90000) continue; // skip if > 300px apart
          
          const safeDist = Math.max(distSq, 4); // prevent divide-by-near-zero
          
          const isLeaf1 = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(n1.type) && !n1.id.startsWith('hub-');
          const isLeaf2 = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(n2.type) && !n2.id.startsWith('hub-');
          
          // Leaves repel each other gently; hubs/switches repel strongly
          const minDist = (isLeaf1 && isLeaf2) ? 400 : 2500;
          const force = Math.min(minDist / safeDist, 5); // cap max force
          const dist = Math.sqrt(safeDist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // Cap total force to prevent explosion
        const maxForce = 8;
        const fMag = Math.sqrt(fx * fx + fy * fy);
        if (fMag > maxForce) {
          fx = (fx / fMag) * maxForce;
          fy = (fy / fMag) * maxForce;
        }

        n1.vx = (n1.vx + fx) * 0.7;
        n1.vy = (n1.vy + fy) * 0.7;
      }

      // Spring forces (only for links)
      links.forEach(link => {
        const n1 = physicsNodesRef.current.get(link.from);
        const n2 = physicsNodesRef.current.get(link.to);
        if (!n1 || !n2) return;

        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const isBackboneLink = (n1.id === 'internet' || n1.id === 'switch-main' || (n1.id && n1.id.startsWith('hub-'))) && 
                              (n2.id === 'switch-main' || (n2.id && n2.id.startsWith('hub-')));
        
        // Backbone links are longer & stiffer; leaf connections are shorter & highly elastic
        const targetDist = isBackboneLink ? 160 : 65;
        const stiffness = isBackboneLink ? 0.05 : 0.015;
        const force = Math.max(-3, Math.min(3, (dist - targetDist) * stiffness));
        
        const lfx = (dx / dist) * force;
        const lfy = (dy / dist) * force;

        if (!n1.isDragging) { n1.vx += lfx; n1.vy += lfy; }
        if (!n2.isDragging) { n2.vx -= lfx; n2.vy -= lfy; }
      });

      // Apply velocities with NaN guard and position clamping
      pNodes.forEach(n => {
        if (n.type === 'internet' || n.id === 'switch-main') {
          n.vx = 0;
          n.vy = 0;
          if (n.type === 'internet') {
            n.x = 400;
            n.y = 60;
          } else if (n.id === 'switch-main') {
            n.x = 400;
            n.y = 250;
          }
          return;
        }

        if (!n.isDragging) {
          // NaN guard — reset if corrupted
          if (!isFinite(n.vx)) n.vx = 0;
          if (!isFinite(n.vy)) n.vy = 0;
          
          n.x += n.vx;
          n.y += n.vy;
          
          // Clamp to reasonable bounds
          if (!isFinite(n.x)) n.x = 400 + Math.random() * 100;
          if (!isFinite(n.y)) n.y = 250 + Math.random() * 100;
          n.x = Math.max(-500, Math.min(1300, n.x));
          n.y = Math.max(-300, Math.min(800, n.y));
        }
      });

      // --- Render ---
      ctx.save();
      try {
        ctx.clearRect(0, 0, width, height);
        
        // Apply zoom & pan
        ctx.translate(v.panX, v.panY);
        ctx.scale(v.zoom, v.zoom);

        // Draw links
        links.forEach(link => {
          const from = physicsNodesRef.current.get(link.from);
          const to = physicsNodesRef.current.get(link.to);
          if (!from || !to) return;

          const fromS = getStatus(from.ip, from.id);
          const toS = getStatus(to.ip, to.id);
          const isOtherLink = from.type === 'other' || to.type === 'other' || 
                              (to.type && ['iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(to.type));

          let linkColor = 'rgba(51, 65, 85, 0.4)';
          if (fromS === 'offline' || toS === 'offline') {
            linkColor = 'rgba(239, 68, 68, 0.15)';
          } else if (from.id && from.id.startsWith('hub-')) {
            const hubColor = getCategoryColor(from.type, from.id);
            linkColor = `${hubColor}25`;
          } else if (to.id && to.id.startsWith('hub-')) {
            const hubColor = getCategoryColor(to.type, to.id);
            linkColor = `${hubColor}25`;
          } else if (from.id === 'internet' || from.id === 'switch-main') {
            linkColor = 'rgba(59, 130, 246, 0.5)';
          }

          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = linkColor;
          ctx.lineWidth = isOtherLink ? 0.8 : 1.5;
          ctx.stroke();

          if (link.label && v.zoom > 0.5) {
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            ctx.font = '9px Inter, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(link.label, mx, my - 8);
          }
        });

        // Draw nodes (other/unknown first, known on top)
        const sorted = [...pNodes].sort((a, b) => {
          const isLeafA = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(a.type || 'other') && !(a.id && a.id.startsWith('hub-'));
          const isLeafB = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(b.type || 'other') && !(b.id && b.id.startsWith('hub-'));
          if (isLeafA && !isLeafB) return -1;
          if (!isLeafA && isLeafB) return 1;
          return 0;
        });

        sorted.forEach(node => {
          const status = getStatus(node.ip, node.id);
          const isHovered = hoveredNodeRef.current === node.id || dragNodeRef.current === node.id;
          drawNode(ctx, node, status, isHovered, v.zoom);
        });
      } finally {
        ctx.restore();
      }

      // HUD overlay (not affected by zoom)
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${pNodes.length} devices | Zoom: ${Math.round(v.zoom * 100)}%`, width - 12, height - 8);

      animationRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[TopologyMap] Physics error:', err);
        // Continue animation even if there's an error
        animationRef.current = requestAnimationFrame(tick);
      }
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', handleWheel);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [nodes, links, getStatus]);

  // Pointer handlers with zoom/pan
  const getPointerPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: 0, sy: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const { sx, sy } = getPointerPos(e);
    const { x, y } = screenToWorld(sx, sy);
    let found: string | null = null;
    
    physicsNodesRef.current.forEach((node, id) => {
      const isLeafDot = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(node.type) && !node.id.startsWith('hub-');
      const hitR = isLeafDot ? 10 : 22;
      if (Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2) < hitR) {
        found = id;
      }
    });

    if (found) {
      dragNodeRef.current = found;
      const node = physicsNodesRef.current.get(found)!;
      node.isDragging = true;
      node.vx = 0;
      node.vy = 0;
    } else {
      // Start panning
      isPanningRef.current = true;
      panStartRef.current = { x: sx, y: sy, panX: viewRef.current.panX, panY: viewRef.current.panY };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const { sx, sy } = getPointerPos(e);
    
    // Handle panning
    if (isPanningRef.current) {
      const v = viewRef.current;
      v.panX = panStartRef.current.panX + (sx - panStartRef.current.x);
      v.panY = panStartRef.current.panY + (sy - panStartRef.current.y);
      return;
    }

    // Handle dragging a node
    if (dragNodeRef.current) {
      const { x, y } = screenToWorld(sx, sy);
      const node = physicsNodesRef.current.get(dragNodeRef.current);
      if (node) {
        node.x = x;
        node.y = y;
        return;
      }
    }

    // Handle hover
    const { x, y } = screenToWorld(sx, sy);
    const found = Array.from(physicsNodesRef.current.values()).find(node => {
      const isLeafDot = ['other', 'iot', 'phone', 'voip-phone', 'camera', 'printer', 'workstation', 'access-point', 'ups'].includes(node.type) && !node.id.startsWith('hub-');
      const hitR = isLeafDot ? 10 : 22;
      return Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2) < hitR;
    }) || null;

    if (found) {
      setHoveredNode(found.id);
      setTooltip({ x: sx, y: sy, node: found });
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    } else {
      setHoveredNode(null);
      setTooltip(null);
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    }
  };

  const handlePointerUp = () => {
    if (dragNodeRef.current) {
      const node = physicsNodesRef.current.get(dragNodeRef.current);
      if (node) node.isDragging = false;
      dragNodeRef.current = null;
    }
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  };

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  // Re-trigger resize when fullscreen changes
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [isFullscreen]);

  return (
    <div
      ref={containerRef}
      className={`topology-container ${isFullscreen ? 'topology-fullscreen' : ''}`}
    >
      <div className="topology-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          <path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
        </svg>
        <span>Network Topology</span>
        <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>
          ({nodeCount} devices — scroll to zoom, drag to pan)
        </span>
        <div className="topology-legend">
          <span className="topo-legend-item"><span className="topo-legend-dot" style={{ background: '#22c55e' }}></span>Online</span>
          <span className="topo-legend-item"><span className="topo-legend-dot" style={{ background: '#ef4444' }}></span>Offline</span>
          <span className="topo-legend-item"><span className="topo-legend-dot" style={{ background: '#94a3b8' }}></span>Unknown</span>
        </div>
        <button
          onClick={() => setIsFullscreen(f => !f)}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Toggle fullscreen'}
          style={{
            marginLeft: '8px',
            background: isFullscreen ? 'rgba(59,130,246,0.2)' : 'rgba(51,65,85,0.4)',
            border: `1px solid ${isFullscreen ? 'rgba(59,130,246,0.4)' : '#475569'}`,
            borderRadius: '6px',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: isFullscreen ? '#60a5fa' : '#94a3b8',
            fontSize: '11px',
            transition: 'all 0.2s',
          }}
        >
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
          {isFullscreen ? 'Exit' : 'Fullscreen'}
        </button>
      </div>
      <div className="topology-canvas-wrapper" style={{ height: isFullscreen ? 'calc(100vh - 48px)' : '500px' }}>
        <canvas
          ref={canvasRef}
          className="topology-canvas"
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={() => { handlePointerUp(); setHoveredNode(null); setTooltip(null); }}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
        {tooltip && (() => {
          const isHub = tooltip.node.id.startsWith('hub-');
          const status = getStatus(tooltip.node.ip, tooltip.node.id);
          const info = deviceInfo[tooltip.node.ip];
          const isInfra = tooltip.node.ip === '0.0.0.0' || tooltip.node.ip.startsWith('0.0.0.');
          
          if (isHub) {
            const deviceCount = links.filter(l => l.from === tooltip.node.id).length;
            return (
              <div
                className="topo-tooltip"
                style={{ left: tooltip.x + 12, top: tooltip.y - 10, minWidth: '200px' }}
              >
                <strong>{tooltip.node.label}</strong>
                <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 500 }}>
                  📂 Concentrador Virtual
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                  Dispositivos conectados: <strong>{deviceCount}</strong>
                </span>
              </div>
            );
          }

          return (
            <div
              className="topo-tooltip"
              style={{ left: tooltip.x + 12, top: tooltip.y - 10, minWidth: '200px' }}
            >
              <strong>{tooltip.node.label}</strong>
              {!isInfra && <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{tooltip.node.ip}</span>}
              <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'capitalize' }}>
                Type: {info?.device_type || tooltip.node.type}
              </span>
              <span className={`topo-tip-status topo-tip-${status}`}>
                ● {status.toUpperCase()}
              </span>
              {info?.vendor && (
                <span style={{ fontSize: '11px', color: '#8b5cf6', fontWeight: 500 }}>
                  🏭 {info.vendor}
                </span>
              )}
              {info?.os && (
                <span style={{ fontSize: '11px', color: '#06b6d4' }}>
                  💻 {info.os}
                </span>
              )}
              {info?.latency !== undefined && info.latency > 0 && (
                <span style={{ fontSize: '11px', color: info.latency > 50 ? '#f59e0b' : '#64748b' }}>
                  Latency: {info.latency}ms
                </span>
              )}
              {info?.hostname && (
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Host: {info.hostname}</span>
              )}
              {info?.mac && (
                <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>MAC: {info.mac}</span>
              )}
              {info?.ports && (
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  Ports: {info.ports}
                </span>
              )}
              {info?.last_seen && (
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  Last seen: {new Date(info.last_seen).toLocaleString()}
                </span>
              )}
              {status === 'offline' && !isInfra && (
                <span style={{ fontSize: '10px', color: '#ef4444', marginTop: '2px' }}>
                  ⚠ Host unreachable — no response to ICMP ping
                </span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
