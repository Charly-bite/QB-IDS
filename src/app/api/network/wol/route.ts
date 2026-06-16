/**
 * Wake-on-LAN API — sends a magic packet to wake a remote host.
 * Uses UDP broadcast on port 9.
 */

import { NextResponse } from 'next/server';
import * as dgram from 'dgram';

function sendMagicPacket(mac: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Parse MAC address (handles both : and - separators)
    const macBytes = mac
      .replace(/[:\-]/g, '')
      .match(/.{2}/g)
      ?.map(b => parseInt(b, 16));

    if (!macBytes || macBytes.length !== 6) {
      reject(new Error('Invalid MAC address'));
      return;
    }

    // Build magic packet: 6 bytes of 0xFF + MAC repeated 16 times
    const magicPacket = Buffer.alloc(102);
    magicPacket.fill(0xFF, 0, 6);
    const macBuffer = Buffer.from(macBytes);
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6);
    }

    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => {
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(magicPacket, 0, 102, 9, '255.255.255.255', (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function POST(request: Request) {
  try {
    const { mac, deviceName } = await request.json();

    if (!mac || typeof mac !== 'string') {
      return NextResponse.json({ error: 'MAC address is required' }, { status: 400 });
    }

    await sendMagicPacket(mac);

    console.log(`[WoL] Magic packet sent to ${mac} (${deviceName || 'unknown'})`);
    return NextResponse.json({
      success: true,
      message: `Wake-on-LAN packet sent to ${mac}`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WoL] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
