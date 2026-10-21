// The contract every module implements. Modules register their own routes and,
// optionally, work for the scheduled trigger. They talk to each other only through
// each other's service.ts exports, never by reaching into another module's routes.
import type { Env } from "../lib/env";
import type { Router } from "../lib/router";

export interface Module {
  name: string;
  register(router: Router): void;
  scheduled?(env: Env, controller: ScheduledController): Promise<void>;
}
