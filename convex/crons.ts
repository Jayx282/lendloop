import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net for the notification outbox: re-queue events whose scheduled retry never ran.
crons.interval("re-queue stale loan events", { minutes: 10 }, internal.notifications.redeliverStale, {});

export default crons;
