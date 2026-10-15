import { executeJob, type SandboxJob } from './SandboxRunner';

// Child-process entry: runs one job at a time. The parent kills this process (SIGKILL) when a
// job exceeds its time budget; unlike a thread, a process stuck inside SQLite really stops.
process.on('message', (message: { id: number; job: SandboxJob }) => {
  // The callback keeps a write to a parent that has gone from throwing.
  process.send?.({ id: message.id, outcome: executeJob(message.job) }, undefined, {}, () => {});
});
// Loaded and listening: the parent starts a job's clock only from here.
process.send?.({ ready: true }, undefined, {}, () => {});
// The parent went away: nothing more to do.
process.on('disconnect', () => process.exit(0));
