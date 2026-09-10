import type { Env as AppEnv } from "../src/server/index";
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}
