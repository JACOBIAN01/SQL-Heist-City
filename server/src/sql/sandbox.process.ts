import { executeJob, type SandboxJob } from './SandboxRunner';

// Child-process entry: runs one job at a time. The parent kills this process (SIGKILL) when a
// job exceeds its time budget; unlike a thread, a process stuck inside SQLite really stops.
process.on('message', (message: { id: number; job: SandboxJob }) => {
  process.send?.({ id: message.id, outcome: executeJob(message.job) });
});
// The parent went away: nothing more to do.
process.on('disconnect', () => process.exit(0));
