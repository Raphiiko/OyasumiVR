import { runMigrations } from './migration-runner';
import type { MigrationDefinition, MigrationResult, Versioned } from './migration-runner';

export interface StoreMigrationSpec {
  storeName: string;
  migrations: Record<string, MigrationDefinition<Versioned>>;
  defaults: Record<string, unknown>;
}

export type StoreCandidateKind = 'live' | 'snapshot' | 'checkpoint';

export interface StoreCandidate {
  id: string;
  kind: StoreCandidateKind;
  /** Raw store bytes; null marks a candidate that exists but cannot be read. */
  contents: string | null;
}

export interface CandidateReport {
  id: string;
  kind: StoreCandidateKind;
  viable: boolean;
  atTarget: boolean;
  reason?: string;
}

export type StoreMigrationDecision =
  | { action: 'keep-live'; reports: CandidateReport[] }
  | { action: 'defer'; reports: CandidateReport[] }
  | {
      action: 'install';
      contents: string;
      selectedId: string;
      checkpointLive: boolean;
      quarantineLive: boolean;
      checkpointReason: 'schema-migration' | 'normalization' | 'store-recovery';
      reports: CandidateReport[];
    }
  | {
      action: 'install-defaults';
      contents: string;
      hadCandidates: boolean;
      reports: CandidateReport[];
    };

export interface StoreMigrationPorts {
  createCheckpoint(
    storeName: string,
    reason: string,
    schemaVersions: Record<string, number>,
    contents: string
  ): Promise<void>;
  /** Must move the live file aside or resolve for an absent file; a rejection blocks the caller. */
  quarantineStore(storeName: string): Promise<void>;
  replaceStore(storeName: string, contents: string): Promise<void>;
  notifyFallback(storeName: string): Promise<void>;
}

export interface LiveStoreState {
  exists: boolean;
  parsesAsObject: boolean;
  contents: string | null;
  parsed: Record<string, unknown> | null;
}

interface CandidateEvaluation {
  report: CandidateReport;
  parsed: Record<string, unknown> | null;
  migrated: Record<string, unknown> | null;
  resolved: Record<string, unknown>;
  migratedAnyKey: boolean;
}

export async function decideStoreMigration(
  candidates: StoreCandidate[],
  spec: StoreMigrationSpec
): Promise<StoreMigrationDecision> {
  const evaluations: CandidateEvaluation[] = [];
  for (const candidate of candidates) {
    evaluations.push(await evaluateCandidate(candidate, spec));
  }
  const reports = evaluations.map((evaluation) => evaluation.report);
  const selected = evaluations.find((evaluation) => evaluation.report.viable);
  if (!selected) {
    const live = evaluations.find((e) => e.report.kind === 'live');
    if (
      live &&
      live.parsed === null &&
      candidates.find((candidate) => candidate.kind === 'live')?.contents === null
    ) {
      return { action: 'defer', reports };
    }
    return {
      action: 'install-defaults',
      contents: recoveredContents(evaluations, spec),
      hadCandidates: candidates.length > 0,
      reports,
    };
  }
  if (selected.report.kind === 'live') {
    if (JSON.stringify(selected.parsed) === JSON.stringify(selected.migrated)) {
      return { action: 'keep-live', reports };
    }
    return {
      action: 'install',
      contents: JSON.stringify(selected.migrated),
      selectedId: selected.report.id,
      checkpointLive: true,
      quarantineLive: false,
      checkpointReason: selected.migratedAnyKey ? 'schema-migration' : 'normalization',
      reports,
    };
  }
  const live = evaluations.find((e) => e.report.kind === 'live');
  return {
    action: 'install',
    contents: JSON.stringify(selected.migrated),
    selectedId: selected.report.id,
    checkpointLive: live?.parsed != null,
    quarantineLive: live !== undefined && live.parsed === null,
    checkpointReason: 'store-recovery',
    reports,
  };
}

export async function applyStoreMigration(
  decision: StoreMigrationDecision,
  live: LiveStoreState,
  spec: StoreMigrationSpec,
  ports: StoreMigrationPorts
): Promise<void> {
  if (decision.action === 'keep-live' || decision.action === 'defer') return;
  if (decision.action === 'install') {
    if (decision.checkpointLive && live.contents !== null) {
      await ports.createCheckpoint(
        spec.storeName,
        decision.checkpointReason,
        schemaVersionVector(live.parsed, spec),
        live.contents
      );
    }
    if (decision.quarantineLive) await ports.quarantineStore(spec.storeName);
    await ports.replaceStore(spec.storeName, decision.contents);
    return;
  }
  if (live.parsed !== null && live.contents !== null) {
    await ports.createCheckpoint(
      spec.storeName,
      'store-recovery',
      schemaVersionVector(live.parsed, spec),
      live.contents
    );
  }
  await ports.quarantineStore(spec.storeName);
  await ports.replaceStore(spec.storeName, decision.contents);
  if (decision.hadCandidates) await ports.notifyFallback(spec.storeName);
}

export function schemaVersionVector(
  parsed: Record<string, unknown> | null,
  spec: StoreMigrationSpec
): Record<string, number> {
  const versions: Record<string, number> = {};
  if (!parsed) return versions;
  for (const key of Object.keys(spec.migrations)) {
    const value = parsed[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      Number.isInteger((value as Versioned).version)
    )
      versions[key] = (value as Versioned).version;
  }
  return versions;
}

async function evaluateCandidate(
  candidate: StoreCandidate,
  spec: StoreMigrationSpec
): Promise<CandidateEvaluation> {
  const report: CandidateReport = {
    id: candidate.id,
    kind: candidate.kind,
    viable: false,
    atTarget: false,
  };
  const unviable = (
    reason: string,
    parsed: Record<string, unknown> | null
  ): CandidateEvaluation => ({
    report: { ...report, reason },
    parsed,
    migrated: null,
    resolved: {},
    migratedAnyKey: false,
  });
  if (candidate.contents === null) return unviable('candidate could not be read', null);
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(candidate.contents);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('not a JSON object');
    parsed = value as Record<string, unknown>;
  } catch {
    return unviable('candidate is not a JSON object', null);
  }
  const migrated = structuredClone(parsed);
  const resolved: Record<string, unknown> = {};
  const failures: string[] = [];
  let migratedAnyKey = false;
  for (const [key, definition] of Object.entries(spec.migrations)) {
    if (!(key in migrated)) {
      migrated[key] = structuredClone(spec.defaults[key]);
      resolved[key] = structuredClone(migrated[key]);
      continue;
    }
    const result = await runMigrations(migrated[key] as Versioned, definition);
    if (result.status !== 'migrated' && result.status !== 'unchanged') {
      failures.push(describeFailure(key, result, definition.targetVersion));
      continue;
    }
    if (result.value.version !== definition.targetVersion) {
      failures.push(
        `key '${key}' finished at version ${result.value.version} instead of ${definition.targetVersion}`
      );
      continue;
    }
    migrated[key] = result.value;
    resolved[key] = result.value;
    if (result.status === 'migrated') migratedAnyKey = true;
  }
  if (failures.length > 0) {
    return {
      report: { ...report, reason: failures.join('; ') },
      parsed,
      migrated: null,
      resolved,
      migratedAnyKey,
    };
  }
  return {
    report: { ...report, viable: true, atTarget: !migratedAnyKey },
    parsed,
    migrated,
    resolved,
    migratedAnyKey,
  };
}

function describeFailure(
  key: string,
  result: MigrationResult<Versioned>,
  targetVersion: number
): string {
  switch (result.status) {
    case 'future':
      return `key '${key}' is at version ${result.value.version}, which is from a newer release (this release supports ${targetVersion})`;
    case 'unsupported':
      return `key '${key}' is at version ${result.value.version}, which is below the minimum supported version ${result.minimumSupportedVersion}`;
    case 'failed':
      return `migrating key '${key}' to version ${result.targetVersion} failed: ${result.cause}`;
    default:
      return `key '${key}' unexpectedly reported ${result.status}`;
  }
}

function recoveredContents(evaluations: CandidateEvaluation[], spec: StoreMigrationSpec): string {
  const contents: Record<string, unknown> = {};
  const liveParsed = evaluations.find((evaluation) => evaluation.report.kind === 'live')?.parsed;
  if (liveParsed) {
    for (const [key, value] of Object.entries(liveParsed)) {
      if (!(key in spec.migrations)) contents[key] = value;
    }
  }
  for (const [key, value] of Object.entries(spec.defaults)) {
    const recovered = evaluations.find((evaluation) => key in evaluation.resolved)?.resolved[key];
    contents[key] = structuredClone(recovered ?? value);
  }
  return JSON.stringify(contents);
}
