import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { message } from '@tauri-apps/plugin-dialog';
import { applyStoreMigration, decideStoreMigration } from 'src-shared-ts/src/store-migration';
import type {
  LiveStoreState,
  StoreCandidate,
  StoreMigrationPorts,
  StoreMigrationSpec,
} from 'src-shared-ts/src/store-migration';
import { STORE_MIGRATIONS } from '../migrations/store-migrations';
import { StoreSnapshotService } from './store-snapshot.service';
import type { StoreCheckpoint } from './store-snapshot.service';

const STORE_FALLBACK_LABELS: Record<string, string> = {
  settings: 'settings',
  event_log: 'event log',
};

/** Migrates stores before services read them, restoring compatible candidates when needed. */
@Injectable({
  providedIn: 'root',
})
export class MigrationCoordinatorService {
  constructor(
    private storeSnapshotService: StoreSnapshotService,
    private translate: TranslocoService
  ) {}

  public async run(): Promise<void> {
    for (const spec of STORE_MIGRATIONS) {
      await this.runStore(spec);
    }
  }

  private async runStore(spec: StoreMigrationSpec): Promise<void> {
    const candidates = await this.gatherCandidates(spec.storeName);
    const decision = await decideStoreMigration(candidates, spec);
    for (const report of decision.reports) {
      if (report.viable) {
        info(
          `[MigrationCoordinator] ${spec.storeName}: candidate '${report.id}' is ${
            report.atTarget ? 'at the current schema' : 'viable after migration'
          }`
        );
      } else {
        warn(
          `[MigrationCoordinator] ${spec.storeName}: skipping candidate '${report.id}' (${report.reason})`
        );
      }
    }
    switch (decision.action) {
      case 'keep-live':
        info(`[MigrationCoordinator] ${spec.storeName}: live store is current, nothing to do`);
        break;
      case 'install':
        info(
          `[MigrationCoordinator] ${spec.storeName}: installing candidate '${decision.selectedId}' (checkpoint reason '${decision.checkpointReason}')`
        );
        break;
      case 'install-defaults':
        if (decision.hadCandidates) {
          error(
            `[MigrationCoordinator] ${spec.storeName}: no viable candidate, quarantining the live store and installing defaults`
          );
        } else {
          info(`[MigrationCoordinator] ${spec.storeName}: no store yet, installing defaults`);
        }
        break;
    }
    await applyStoreMigration(decision, this.liveState(candidates), spec, this.createPorts());
  }

  private async gatherCandidates(storeName: string): Promise<StoreCandidate[]> {
    const candidates: StoreCandidate[] = [];
    const backups: Array<{ candidate: StoreCandidate; createdAtMillis: number }> = [];
    const live = await this.storeSnapshotService.readLiveStore(storeName);
    if (live.exists) candidates.push({ id: 'live', kind: 'live', contents: live.contents });
    try {
      const snapshot = await this.storeSnapshotService.readSnapshot(storeName);
      if (snapshot !== null)
        backups.push({
          candidate: { id: 'snapshot', kind: 'snapshot', contents: snapshot.contents },
          createdAtMillis: snapshot.modifiedAtMillis,
        });
    } catch (e) {
      warn(`[MigrationCoordinator] ${storeName}: rolling snapshot could not be read (${e})`);
      backups.push({
        candidate: { id: 'snapshot', kind: 'snapshot', contents: null },
        createdAtMillis: 0,
      });
    }
    let checkpoints: StoreCheckpoint[];
    try {
      checkpoints = await this.storeSnapshotService.listCheckpoints(storeName);
    } catch (e) {
      warn(`[MigrationCoordinator] ${storeName}: checkpoints could not be listed (${e})`);
      backups.push({
        candidate: { id: 'checkpoints', kind: 'checkpoint', contents: null },
        createdAtMillis: 0,
      });
      candidates.push(...this.sortBackups(backups));
      return candidates;
    }
    for (const checkpoint of checkpoints) {
      if (!checkpoint.contentFileExists) {
        backups.push({
          candidate: { id: checkpoint.id, kind: 'checkpoint', contents: null },
          createdAtMillis: checkpoint.createdAtMillis,
        });
        continue;
      }
      try {
        const contents = await this.storeSnapshotService.readCheckpoint(storeName, checkpoint.id);
        backups.push({
          candidate: { id: checkpoint.id, kind: 'checkpoint', contents },
          createdAtMillis: checkpoint.createdAtMillis,
        });
      } catch (e) {
        warn(`[MigrationCoordinator] ${storeName}: skipping checkpoint '${checkpoint.id}' (${e})`);
        backups.push({
          candidate: { id: checkpoint.id, kind: 'checkpoint', contents: null },
          createdAtMillis: checkpoint.createdAtMillis,
        });
      }
    }
    candidates.push(...this.sortBackups(backups));
    return candidates;
  }

  private sortBackups(
    backups: Array<{ candidate: StoreCandidate; createdAtMillis: number }>
  ): StoreCandidate[] {
    return backups
      .sort(
        (a, b) =>
          b.createdAtMillis - a.createdAtMillis ||
          Number(b.candidate.kind === 'checkpoint') - Number(a.candidate.kind === 'checkpoint')
      )
      .map(({ candidate }) => candidate);
  }

  private liveState(candidates: StoreCandidate[]): LiveStoreState {
    const live = candidates.find((candidate) => candidate.kind === 'live');
    if (!live) return { exists: false, parsesAsObject: false, contents: null, parsed: null };
    if (live.contents === null)
      return { exists: true, parsesAsObject: false, contents: null, parsed: null };
    try {
      const parsed: unknown = JSON.parse(live.contents);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('not a JSON object');
      return {
        exists: true,
        parsesAsObject: true,
        contents: live.contents,
        parsed: parsed as Record<string, unknown>,
      };
    } catch {
      return { exists: true, parsesAsObject: false, contents: live.contents, parsed: null };
    }
  }

  private createPorts(): StoreMigrationPorts {
    return {
      createCheckpoint: (storeName, reason, schemaVersions, contents) =>
        this.storeSnapshotService
          .createCheckpoint(storeName, reason, schemaVersions, contents)
          .then(() => undefined),
      quarantineStore: async (storeName) => {
        const quarantined = await this.storeSnapshotService.quarantineStore(storeName);
        info(
          `[MigrationCoordinator] ${storeName}: ${
            quarantined ? 'live store quarantined' : 'no live store to quarantine'
          }`
        );
      },
      replaceStore: (storeName, contents) =>
        this.storeSnapshotService.replaceStore(storeName, contents),
      notifyFallback: async (storeName) => {
        const label = STORE_FALLBACK_LABELS[storeName] ?? storeName;
        void message(this.translate.translate('migration-recovery.message', { store: label }), {
          title: this.translate.translate('migration-recovery.title', { store: label }),
          kind: 'error',
        }).catch((e) => {
          warn(`[MigrationCoordinator] ${storeName}: failed to show the recovery dialog: ${e}`);
        });
      },
    };
  }
}
