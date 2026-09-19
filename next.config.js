/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;

// Lets `next dev` see R2/KV bindings (and other Workers platform data) the
// same way the deployed Worker does, so admin uploads and the page cache
// work locally without a full `wrangler dev` build. Async but intentionally
// not awaited — see the function's own docs.
if (process.env.NODE_ENV === 'development') {
  const { initOpenNextCloudflareForDev } = require('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}
