import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Nothing is overridden, on purpose.
 *
 * The usual reason to configure this file is to point the incremental cache at
 * R2/KV, which only matters for ISR. Every page here is dynamic — they read the
 * signed-in user's tickets — so there is nothing to cache and no bucket to
 * create. The default in-memory cache is correct until that changes.
 */
export default defineCloudflareConfig();
