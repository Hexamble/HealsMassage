/** @type {import('next').NextConfig} */
const nextConfig = {
  // Render deployment optimization. Standalone output bundles only the
  // files the app actually needs, so the Render container starts faster
  // after a cold start (~30s instead of ~60s).
  output: 'standalone',
};

export default nextConfig;
