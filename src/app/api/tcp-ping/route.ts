import { NextResponse } from 'next/server';
import net from 'net';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const host = searchParams.get('host');
  const portParam = searchParams.get('port');

  if (!host) {
    return NextResponse.json({ error: 'Host is required' }, { status: 400 });
  }

  const port = portParam ? parseInt(portParam, 10) : 1433; // Default to SQL Server

  const startTime = Date.now();
  let status = 'Offline';
  let latency = 0;
  let errorDetail = '';

  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();

      socket.setTimeout(5000); // 5 second timeout

      socket.on('connect', () => {
        status = 'Online';
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        status = 'Offline';
        errorDetail = 'Connection timed out';
        socket.destroy();
        reject(new Error('timeout'));
      });

      socket.on('error', (err) => {
        status = 'Offline';
        errorDetail = err.message;
        socket.destroy();
        reject(err);
      });

      socket.connect(port, host);
    });
  } catch (err) {
    // Error is handled in the event listeners
  }

  latency = Date.now() - startTime;

  return NextResponse.json({
    host,
    port,
    status,
    latency,
    errorDetail: status === 'Offline' && !errorDetail ? 'Unreachable' : errorDetail
  });
}
