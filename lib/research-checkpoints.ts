import { readDataSnapshot, storeDataSnapshot } from '@/lib/data-snapshot-cache';

export const RESEARCH_CHECKPOINT_TTL = 60 * 60 * 1000;
export const RESEARCH_PIPELINE_VERSION = 'task-budget-evidence-v3';

export async function researchCheckpointKey(input: {
  userId: string;
  model: string;
  listingId: string;
  query: string;
}) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      input.userId,
      input.model,
      input.listingId,
      input.query.trim().toLowerCase(),
    ]),
  );
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(hash, (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  return `research-checkpoint:${RESEARCH_PIPELINE_VERSION}:${digest}`;
}

export async function readResearchCheckpoint<T>(
  key: string,
): Promise<T | null> {
  const saved = await readDataSnapshot<T>(key).catch(() => null);
  return saved && !saved.stale ? saved.value : null;
}

export async function saveResearchCheckpoint<T>(key: string, value: T) {
  await storeDataSnapshot(
    key,
    'research-checkpoint',
    value,
    RESEARCH_CHECKPOINT_TTL,
    '按用户隔离的研究阶段检查点',
    '',
  );
}

export async function checkpointedResearchStage<T>(options: {
  key: string;
  run: () => Promise<T>;
  read?: (key: string) => Promise<T | null>;
  save?: (key: string, value: T) => Promise<unknown>;
  shouldSave?: (value: T) => boolean;
}) {
  const saved = await (options.read || readResearchCheckpoint<T>)(options.key);
  if (saved) return { value: saved, reused: true, saved: true };
  const value = await options.run();
  let persisted = false;
  try {
    if (!options.shouldSave || options.shouldSave(value)) {
      await (options.save || saveResearchCheckpoint<T>)(options.key, value);
      persisted = true;
    }
  } catch {
    // Persistence failures must not discard an already-paid successful result.
    console.warn('research_checkpoint_save_failed');
  }
  return { value, reused: false, saved: persisted };
}
