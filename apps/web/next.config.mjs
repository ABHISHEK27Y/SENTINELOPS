/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared workspace image serves this build with `next start`.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws',
  },
};
export default nextConfig;
