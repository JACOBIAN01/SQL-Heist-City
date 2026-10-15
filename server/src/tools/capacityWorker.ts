import { parentPort, workerData } from 'node:worker_threads';
import { runHeadlessBench } from '../loadtest/HeadlessBench';
import { makeBenchMap } from '../loadtest/benchMap';

// One class room's match, ticking as fast as it can, for the capacity tool.
const { players, seconds, seed } = workerData as { players: number; seconds: number; seed: string };
const result = runHeadlessBench({ players, map: makeBenchMap(), seconds, fireRate: 0.1, seed });
parentPort?.postMessage({ tickMs: result.tickMs, rss: process.memoryUsage().rss });
