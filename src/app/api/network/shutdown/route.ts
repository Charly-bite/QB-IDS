/**
 * Remote Shutdown API — remotely shuts down or restarts a Windows machine.
 * Uses `shutdown /m \\<ip>` which requires admin privileges.
 */

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { ip, action = 'shutdown', delay = 30, message } = await request.json();

    if (!ip || typeof ip !== 'string') {
      return NextResponse.json({ error: 'IP address is required' }, { status: 400 });
    }

    // Validate action
    const validActions = ['shutdown', 'restart', 'abort'];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: `Invalid action. Must be: ${validActions.join(', ')}` }, { status: 400 });
    }

    let cmd: string;
    if (action === 'abort') {
      cmd = `shutdown /m \\\\${ip} /a`;
    } else {
      const flag = action === 'restart' ? '/r' : '/s';
      const comment = message || `Remote ${action} from Panel Control`;
      cmd = `shutdown /m \\\\${ip} ${flag} /t ${delay} /c "${comment}"`;
    }

    console.log(`[Shutdown] Executing: ${cmd}`);

    try {
      await execAsync(cmd, { timeout: 10000 });
      console.log(`[Shutdown] ${action} command sent to ${ip}`);
      return NextResponse.json({
        success: true,
        message: action === 'abort'
          ? `Shutdown aborted on ${ip}`
          : `${action === 'restart' ? 'Restart' : 'Shutdown'} scheduled on ${ip} in ${delay}s`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Error de sistema 5') || msg.includes('Access is denied')) {
        return NextResponse.json({ error: 'Access denied — requires admin privileges on target' }, { status: 403 });
      }
      if (msg.includes('Error de sistema 53') || msg.includes('not found')) {
        return NextResponse.json({ error: 'Host not reachable' }, { status: 404 });
      }
      throw err;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Shutdown] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
