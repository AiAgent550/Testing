// Module registry: the only place that lists every module.
import type { Module } from "./types";
import auth from "./auth";
import system from "./system";
import customers from "./customers";
import vehicles from "./vehicles";
import bookings from "./bookings";
import jobs from "./jobs";
import ai from "./ai";
import leads from "./leads";
import social from "./social";
import notifications from "./notifications";

export const modules: Module[] = [auth, system, customers, vehicles, bookings, jobs, ai, leads, social, notifications];
