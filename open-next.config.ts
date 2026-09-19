import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

// Page cache (ISR) lives in the kpb-cache KV namespace bound as
// NEXT_INC_CACHE_KV in wrangler.jsonc, rather than the default in-memory
// cache — an in-memory cache resets on every Worker isolate restart, which
// would make the `revalidate = 60` on the public pages meaningless.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
});
