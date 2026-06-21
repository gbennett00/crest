import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Keep rendered route segments in the client Router Cache so navigating
    // back to an already-visited page is instant instead of re-fetching. Server
    // Actions call revalidatePath on mutation, so data still refreshes on edit.
    // NOTE: <Link>/router prefetching only runs in production builds, not `next
    // dev` — test perceived speed with `pnpm build && pnpm start`.
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
};

export default nextConfig;
