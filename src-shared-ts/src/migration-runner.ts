export interface Versioned {
  version: number;
}

export type MigrationStep<T extends Versioned> = (data: T) => T | Promise<T>;

export interface MigrationDefinition<T extends Versioned> {
  targetVersion: number;
  /** Keyed by source version; each step must return data at its key plus one. */
  steps: Readonly<Record<number, MigrationStep<T>>>;
  /** Inputs below this version are reported as 'unsupported' without running any step. */
  minimumSupportedVersion?: number;
  /** Runs only once the data has reached 'targetVersion', including when no step was needed. */
  normalizeCurrentVersion?: (data: T) => T | Promise<T>;
}

/** 'future' means the input version is above the target; 'unsupported' below the minimum. */
export type MigrationResult<T extends Versioned> =
  | { status: 'unchanged'; value: T }
  | { status: 'migrated'; value: T }
  | { status: 'future'; value: T }
  | { status: 'unsupported'; value: T; minimumSupportedVersion: number }
  | { status: 'failed'; sourceVersion: number | null; targetVersion: number; cause: unknown };

/**
 * Migrates a structured clone of `data` up to `definition.targetVersion`; the input is never
 * mutated. A thrown or rejected step or normalizer surfaces as a 'failed' result carrying the
 * original cause.
 */
export async function runMigrations<T extends Versioned>(
  data: T,
  definition: MigrationDefinition<T>
): Promise<MigrationResult<T>> {
  let current: T;
  try {
    current = structuredClone(data);
  } catch (cause) {
    return failed(null, definition.targetVersion, cause);
  }
  const version = readVersion(current);
  if (version === null)
    return failed(
      null,
      definition.targetVersion,
      new Error(`data.version must be an integer, but was ${String(current.version)}`)
    );
  if (
    definition.minimumSupportedVersion !== undefined &&
    version < definition.minimumSupportedVersion
  )
    return {
      status: 'unsupported',
      value: current,
      minimumSupportedVersion: definition.minimumSupportedVersion,
    };
  if (version > definition.targetVersion) return { status: 'future', value: current };
  let migrated = false;
  while (current.version < definition.targetVersion) {
    const sourceVersion = current.version;
    const step = definition.steps[sourceVersion];
    if (!step)
      return failed(
        sourceVersion,
        sourceVersion + 1,
        new Error(`no migration step defined for version ${sourceVersion}`)
      );
    let next: T;
    try {
      next = await step(current);
    } catch (cause) {
      return failed(sourceVersion, sourceVersion + 1, cause);
    }
    const produced = readVersion(next);
    if (produced !== sourceVersion + 1)
      return failed(
        sourceVersion,
        sourceVersion + 1,
        new Error(
          `the migration step for version ${sourceVersion} must produce version ${
            sourceVersion + 1
          }, but produced ${produced === null ? 'no integer version' : produced}`
        )
      );
    current = next;
    migrated = true;
  }
  if (definition.normalizeCurrentVersion) {
    try {
      current = await definition.normalizeCurrentVersion(current);
    } catch (cause) {
      return failed(definition.targetVersion, definition.targetVersion, cause);
    }
  }
  return { status: migrated ? 'migrated' : 'unchanged', value: current };
}

function readVersion(data: unknown): number | null {
  if (typeof data === 'object' && data !== null && Number.isInteger((data as Versioned).version))
    return (data as Versioned).version;
  return null;
}

function failed<T extends Versioned>(
  sourceVersion: number | null,
  targetVersion: number,
  cause: unknown
): MigrationResult<T> {
  return { status: 'failed', sourceVersion, targetVersion, cause };
}
