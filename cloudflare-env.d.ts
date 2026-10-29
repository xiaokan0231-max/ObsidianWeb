declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ASSETS?: Fetcher;
    OBSIDIAN_API_KEY?: string;
    OBSIDIAN_API_URL?: string;
    CODEX_BRIDGE_TOKEN?: string;
    CODEX_BRIDGE_URL?: string;
  }
}
