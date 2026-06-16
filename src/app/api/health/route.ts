import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('target');

  if (!target) {
    return NextResponse.json({ error: 'target parameter is required' }, { status: 400 });
  }

  try {
    // Build the health URL
    const baseUrl = target.startsWith('http') ? target : `http://${target}`;
    const healthUrl = `${baseUrl}/api/monitor/health`;

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8000),
    });

    const data = await response.json();

    return NextResponse.json({
      reachable: true,
      ...data,
    });
  } catch {
    return NextResponse.json({
      reachable: false,
      status: 'error',
      error: 'Could not reach the health endpoint',
    });
  }
}
