import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const host = searchParams.get('host');

  if (!host) {
    return NextResponse.json({ error: 'Host is required' }, { status: 400 });
  }

  // Sanitize host to prevent command injection
  const sanitized = host.replace(/[^a-zA-Z0-9.\-:]/g, '');

  try {
    // -n 1 sends exactly 1 ping packet. -w 3000 waits 3000ms for a response.
    const { stdout, stderr } = await execAsync(`ping -n 1 -w 3000 ${sanitized}`, { timeout: 8000 });
    const output = stdout + (stderr || '');

    // Check for failure indicators (English + Spanish)
    const failPatterns = [
      'unreachable', 'inalcanzable',       // Destination host unreachable
      'timed out', 'agot',                  // Request timed out / Se agotó
      'could not find', 'no pudo encontrar', // Host not found
      'perdidos = 1', 'lost = 1',           // 100% packet loss
      '(100%',                              // 100% loss
    ];

    const failed = failPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()));
    if (failed) {
      return NextResponse.json({
        host: sanitized,
        status: 'Offline',
        latency: 0,
        statusCode: 'FAIL',
        errorDetail: 'Destination host unreachable',
      });
    }

    // Extract latency — handles both English and Spanish:
    // English: "time=4ms" or "time<1ms"
    // Spanish: "tiempo=4m" or "tiempo<1m"
    let latency = 0;
    const timeMatch = output.match(/(?:time|tiempo)[=<]([0-9]+)\s*m/i);
    if (timeMatch && timeMatch[1]) {
      latency = parseInt(timeMatch[1], 10);
    }

    return NextResponse.json({
      host: sanitized,
      status: 'Online',
      latency,
      statusCode: 'PING',
    });
  } catch (error: unknown) {
    // exec throws on non-zero exit code (= ping failed)
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      host: sanitized,
      status: 'Offline',
      latency: 0,
      statusCode: 'FAIL',
      errorDetail: msg.includes('agot') || msg.includes('timeout') ? 'Connection timed out' : 'Destination host unreachable',
    });
  }
}
