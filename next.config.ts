import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['mysql2'],
  allowedDevOrigins: [
    '192.168.2.172',
    '192.168.1.96',
    '192.168.86.1',
    '192.168.2.134',
  ],
};

export default nextConfig;
