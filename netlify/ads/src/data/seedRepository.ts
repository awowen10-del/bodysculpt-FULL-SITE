/**
 * Seed-backed implementation of `DashboardRepository` (Stage 10, Phase 3;
 * refactored Stage 11C).
 *
 * The seed repository is now a THIN WRAPPER: it builds (or accepts) the offline
 * `SeedDataset` and serves it through the shared in-memory engine
 * (`createDatasetRepository`). All query, aggregation, DTO and creative-scoring
 * logic lives in that one engine, shared with the server repository, so the
 * offline and production paths cannot diverge.
 *
 * BROWSER-SAFE: no database, Postgres, sync layer, Meta graph client, node
 * built-in, credential or environment access; opens no connection.
 */
import type { SeedDataset } from '../seed/buildSeedDataset.ts'
import { buildSeedDataset } from '../seed/buildSeedDataset.ts'
import type { DashboardRepository } from './repository.ts'
import { createDatasetRepository } from './datasetRepository.ts'

/**
 * Create a repository over a seed dataset. Defaults to the shipped deterministic
 * seed; tests may inject a custom dataset (e.g. an ad with no creative). A
 * `SeedDataset` is field-compatible with the engine's `DashboardDataset`.
 */
export function createSeedRepository(
  dataset: SeedDataset = buildSeedDataset(),
): DashboardRepository {
  return createDatasetRepository(dataset)
}
