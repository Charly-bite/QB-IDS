import { NextResponse } from 'next/server';
import { updateDevice } from '@/lib/db';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { ip, name, device_type, is_monitored } = body;

    if (!ip) {
      return NextResponse.json({ error: 'IP is required' }, { status: 400 });
    }

    await updateDevice(ip, { name, device_type, is_monitored });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
