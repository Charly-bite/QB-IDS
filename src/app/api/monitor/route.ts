import { NextResponse } from 'next/server';

// Known HTTP status descriptions
const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: 'OK — Server is responding normally.',
  301: 'Moved Permanently — The URL has been permanently redirected.',
  302: 'Found — The URL is temporarily redirected.',
  400: 'Bad Request — The server could not understand the request.',
  401: 'Unauthorized — Authentication is required.',
  403: 'Forbidden — Access to this resource is denied.',
  404: 'Not Found — The requested page does not exist.',
  500: 'Internal Server Error — The server encountered an unexpected error.',
  502: 'Bad Gateway — The server received an invalid response from an upstream server.',
  503: 'Service Unavailable — The server is temporarily overloaded or down for maintenance.',
  504: 'Gateway Timeout — The upstream server did not respond in time.',
};

function getProtocol(url: string): string {
  if (url.startsWith('http')) return url;
  // Use http:// for local/private IPs, https:// for domains
  const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost)/.test(url);
  return isPrivateIp ? `http://${url}` : `https://${url}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const startTime = Date.now();
  let status = 'Offline';
  let latency = 0;
  let statusCode = null;
  let errorDetail = '';

  try {
    const formattedUrl = getProtocol(url);

    const response = await fetch(formattedUrl, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: AbortSignal.timeout(10000),
    });

    statusCode = response.status;

    if (response.ok || (statusCode >= 200 && statusCode < 400)) {
      status = 'Online';
    } else {
      status = 'Issues Detected';
      errorDetail = STATUS_DESCRIPTIONS[statusCode] || `HTTP ${statusCode} — The server returned an unexpected status code.`;
    }

    latency = Date.now() - startTime;
  } catch (error: unknown) {
    status = 'Offline';
    latency = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
        errorDetail = 'Connection timed out — The server did not respond within 10 seconds.';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorDetail = 'Connection refused — The server is not accepting connections on this port.';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorDetail = 'DNS resolution failed — The domain name could not be resolved.';
      } else if (error.message.includes('certificate') || error.message.includes('SSL')) {
        errorDetail = 'SSL/TLS error — There is a problem with the security certificate.';
      } else {
        errorDetail = `Network error — ${error.message}`;
      }
    } else {
      errorDetail = 'Unknown error — Could not reach the server.';
    }
  }

  return NextResponse.json({
    url,
    status,
    latency,
    statusCode,
    errorDetail,
  });
}
