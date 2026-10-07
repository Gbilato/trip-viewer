import { invoke } from "@tauri-apps/api/core";
import type { Trip } from "../types/model";
import type { DeleteFailure } from "./tags";

/**
 * Trips that exist in the DB only because they have a timelapse archive
 * — their source segments have all been deleted. Returned with
 * `segments: []` and `archiveOnly: true` so the frontend can interleave
 * them into the main trip list and filter for them in the UI without a
 * separate code path.
 */
export function listArchiveOnlyTrips(): Promise<Trip[]> {
  return invoke<Trip[]>("list_archive_only_trips");
}

export interface DeleteTripReport {
  segmentFilesTrashed: number;
  timelapseFilesTrashed: number;
  timelapseJobsRemoved: number;
  tripRemoved: boolean;
  failures: DeleteFailure[];
}

/**
 * Wholesale "delete this entire trip". Trashes every source MP4 *and*
 * the trip's timelapse pre-renders, then removes all DB rows. This is
 * the only IPC that ever removes a timelapse archive — per-segment
 * deletion never touches it.
 *
 * `inMemoryPaths` maps segmentId → channel paths so the backend can
 * trash every channel file (DB only stores the master path).
 */
export function deleteTrip(
  tripId: string,
  inMemoryPaths: Record<string, string[]>,
): Promise<DeleteTripReport> {
  return invoke<DeleteTripReport>("delete_trip", {
    tripId,
    inMemoryPaths,
  });
}

// ── Manual trip merge ──────────────────────────────────────────────

export type TupleStatus = "concatenable" | "partialOutputs";

export interface TupleAssessment {
  tier: string;
  channel: string;
  status: TupleStatus;
  primaryHas: boolean;
  absorbedWithOutput: string[];
}

/** A (trip, tier, channel) render that would be destroyed rather than
 *  concatenated if the merge proceeds — for a trip whose originals are
 *  already deleted, meaning there's no way to rebuild it afterward. */
export interface ArchiveOnlyRisk {
  tripId: string;
  tier: string;
  channel: string;
  /** True when this tuple isn't concat-ready (coverage gap or
   *  non-chronological inputs) — `concatWherePossible` would still
   *  drop it. False means only `discardAll` is unsafe for it. */
  blocksConcatStrategy: boolean;
}

export interface TimelapseMergeAssessment {
  /** False when no source trip has any timelapse_jobs row — frontend
   *  can skip the strategy dialog and merge silently. */
  hasAnyTimelapses: boolean;
  tuples: TupleAssessment[];
  /** Distinct `camera_kind` values across primary + absorbed, sorted.
   *  More than one entry means concat will fail at ffmpeg time on
   *  resolution / pix_fmt mismatches; the dialog surfaces a warning. */
  cameraKinds: string[];
  /** Non-empty means the merge would destroy an archive-only trip's
   *  only remaining copy — the backend refuses the merge outright in
   *  this case, so the dialog must hard-block rather than warn. */
  archiveOnlyAtRisk: ArchiveOnlyRisk[];
}

export type TimelapseMergeStrategy = "concatWherePossible" | "discardAll";

export interface PruneSummary {
  trashed: number;
  bytesReclaimed: number;
  sample: string[];
}

export interface MergeReport {
  primaryTripId: string;
  absorbedTripIds: string[];
  /** Tuples successfully concatenated (one entry per [tier, channel]). */
  concatenated: [string, string][];
  /** Total timelapse_jobs rows removed. */
  timelapseJobsRemoved: number;
  /** Redundant files this merge left behind (concatenated sources,
   *  discarded outputs) that were swept to trash immediately after the
   *  merge, scoped to just this merge's trips. `null` if the sweep
   *  itself failed — the merge still succeeded, but these weren't
   *  auto-cleared and need a manual Prune later. */
  pruned: PruneSummary | null;
}

export function assessTripMerge(
  primaryTripId: string,
  absorbedTripIds: string[],
): Promise<TimelapseMergeAssessment> {
  return invoke<TimelapseMergeAssessment>("assess_trip_merge", {
    primaryTripId,
    absorbedTripIds,
  });
}

export function mergeTrips(
  primaryTripId: string,
  absorbedTripIds: string[],
  strategy: TimelapseMergeStrategy,
): Promise<MergeReport> {
  return invoke<MergeReport>("merge_trips", {
    primaryTripId,
    absorbedTripIds,
    strategy,
  });
}
