import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  SPELUNK: DurableObjectNamespace<Spelunk>;
  [name: string]: unknown;
}

/** Settings passed on to the container. Claude keys and git tokens are never passed: visitors bring their own. */
const PASSED = ["SPELUNK_ALLOWED_HOSTS", "SPELUNK_MAX_REPOS", "SPELUNK_CLONES_PER_HOUR"];

/** `spelunk serve`, from the Dockerfile at the repository root. It listens on 8080 and sleeps when idle. */
export class Spelunk extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = {};
    for (const name of PASSED) {
      const value = env[name];
      if (typeof value === "string" && value) vars[name] = value;
    }
    this.envVars = vars;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.SPELUNK, "main").fetch(request);
  },
};
