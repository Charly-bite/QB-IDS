import { NextResponse } from 'next/server';
import { getAllDevices, initDatabase, seedKnownDevices } from '@/lib/db';

let initialized = false;

// Known infrastructure to seed on first load
const KNOWN_DEVICES = [
  { ip: '192.168.2.2', name: 'Servidor AD Local', type: 'server' },
  { ip: '192.168.2.104', name: 'ServidorCONTAQ', type: 'server' },
  { ip: '192.168.2.103', name: 'Servidor de Archivos', type: 'server' },
  { ip: '192.168.2.218', name: 'Servidor Apps', type: 'server' },
  { ip: '192.168.2.172', name: 'Servidor Dev', type: 'server' },
  { ip: '192.168.2.251', name: 'LibreNMS Monitor', type: 'server' },
  { ip: '192.168.2.237', name: 'DB Server 237', type: 'database' },
  { ip: '192.168.2.187', name: 'DB Server 187', type: 'database' },
  { ip: '192.168.1.254', name: 'Gateway GDL', type: 'firewall' },
  { ip: '192.168.2.1', name: 'Switch Principal', type: 'switch' },
];

export async function GET() {
  try {
    // Initialize database on first request
    if (!initialized) {
      await initDatabase();
      await seedKnownDevices(KNOWN_DEVICES);
      initialized = true;
    }

    const devices = await getAllDevices();
    return NextResponse.json({ devices });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /network/devices] Error:', msg);
    return NextResponse.json({ error: msg, devices: [] }, { status: 500 });
  }
}
