import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emits a minimal server bundle for the Docker image (`.next/standalone`).
  output: 'standalone',
  // Monaco ships a large amount of ESM; transpiling keeps the worker bundles
  // consistent with the app build.
  transpilePackages: ['monaco-editor'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
