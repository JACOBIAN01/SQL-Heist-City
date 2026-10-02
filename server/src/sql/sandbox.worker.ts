import { parentPort } from 'node:worker_threads';
import { executeJob, type SandboxJob } from './SandboxRunner';

// Worker entry: runs one job at a time. The parent terminates this thread if
// a job exceeds its time budget (e.g. an infinite recursive CTE).
parentPort?.on('message', (message: { id: number; job: SandboxJob }) => {
  parentPort?.postMessage({ id: message.id, outcome: executeJob(message.job) });
});
