import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useStore } from "../../state/store";
import {
  type MergeReport,
  type TimelapseMergeAssessment,
  type TimelapseMergeStrategy,
} from "../../ipc/trips";
import type { Trip } from "../../types/model";
import { formatBytes, formatTripStart } from "../../utils/format";

interface Props {
  marked: Trip[];
  onClose: () => void;
}

/**
 * Confirmation dialog for the trip-merge action.
 *
 * Three paths:
 *  - No marked trip has any timelapse outputs → show a simple
 *    "Merge N trips?" confirm with no strategy picker.
 *  - An archive-only trip (originals already deleted) would lose its
 *    only remaining render under the merge → hard-block, no strategy
 *    picker, Merge disabled. The backend refuses this too; this is
 *    just the pre-flight version of that same refusal.
 *  - Otherwise, call `assess_trip_merge` to get a per-(tier, channel)
 *    feasibility matrix and let the user pick "Concatenate where
 *    possible" or "Discard all".
 *
 * On success, shows a result summary (concatenated tuples, tuples that
 * now need a rebuild, and what the post-merge cleanup swept) instead of
 * closing immediately — so the cleanup that happens automatically isn't
 * invisible.
 */
export function MergeTripsDialog({ marked, onClose }: Props) {
  const mergeMarkedTrips = useStore((s) => s.mergeMarkedTrips);
  const assessMergeMarked = useStore((s) => s.assessMergeMarked);

  const [assessment, setAssessment] =
    useState<TimelapseMergeAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [strategy, setStrategy] =
    useState<TimelapseMergeStrategy>("concatWherePossible");
  const [result, setResult] = useState<
    { report: MergeReport; rebuildCount: number } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void assessMergeMarked()
      .then((a) => {
        if (cancelled) return;
        setAssessment(a);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assessMergeMarked]);

  // Sorted earliest-first so the user sees which trip becomes the
  // primary (it's the first row in this list). The store action uses
  // the same earliest-start rule.
  const orderedMarked = [...marked].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  // Group archive-only risk entries by trip so the banner reads as
  // "these trips" rather than a raw per-tuple dump.
  const archiveOnlyByTrip = useMemo(() => {
    if (!assessment) return [];
    const tupleCounts = new Map<string, number>();
    for (const r of assessment.archiveOnlyAtRisk) {
      tupleCounts.set(r.tripId, (tupleCounts.get(r.tripId) ?? 0) + 1);
    }
    return Array.from(tupleCounts.entries()).map(([tripId, tupleCount]) => ({
      tripId,
      tupleCount,
      trip: marked.find((t) => t.id === tripId),
    }));
  }, [assessment, marked]);
  const archiveOnlyBlocked = archiveOnlyByTrip.length > 0;

  async function onConfirm() {
    setBusy(true);
    setErrorMessage(null);
    try {
      // When no timelapses exist the strategy is irrelevant — pass
      // discardAll because it's a no-op in that case.
      const effective: TimelapseMergeStrategy = assessment?.hasAnyTimelapses
        ? strategy
        : "discardAll";
      // Figure out "how many tuples still need a rebuild" from the
      // pre-merge assessment rather than from the report's
      // `timelapseJobsRemoved` count — that count includes rows on
      // *both* sides of a successful concat too, so it doesn't map
      // directly to "tuples with no output now."
      const rebuildCount = !assessment
        ? 0
        : effective === "discardAll"
          ? assessment.tuples.length
          : assessment.tuples.filter((t) => t.status === "partialOutputs")
              .length;
      const report = await mergeMarkedTrips(effective);
      setResult({ report, rebuildCount });
      setBusy(false);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (result) {
    return (
      <MergeResultView
        result={result.report}
        rebuildCount={result.rebuildCount}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-lg">
        <h2 className="text-base font-semibold">
          Merge {marked.length} trips?
        </h2>
        <p className="mt-2 text-sm text-neutral-400">
          The earliest-starting trip becomes the primary; the others fold
          into it. The merge is recorded persistently so a folder rescan
          won&apos;t split them apart.
        </p>

        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-xs">
          {orderedMarked.map((t, idx) => (
            <div key={t.id} className="flex items-center justify-between">
              <span className="text-neutral-200">
                {formatTripStart(t.startTime)}
              </span>
              <span className="text-neutral-500">
                {idx === 0 ? "primary" : "absorbed"}
              </span>
            </div>
          ))}
        </div>

        {loading && (
          <p className="mt-3 text-xs text-neutral-500">
            Checking timelapse outputs…
          </p>
        )}

        {!loading && archiveOnlyBlocked && (
          <div className="mt-3 rounded-md border border-red-800 bg-red-950 p-2.5 text-xs text-red-200">
            <p className="font-semibold text-red-300">
              ⛔ This merge would permanently destroy a timelapse render.
            </p>
            <ul className="mt-1.5 space-y-1">
              {archiveOnlyByTrip.map(({ tripId, tupleCount, trip }) => (
                <li key={tripId}>
                  <span className="text-red-400">→</span>{" "}
                  <span className="font-medium">
                    {trip ? formatTripStart(trip.startTime) : tripId}
                  </span>{" "}
                  — originals already deleted; {tupleCount}{" "}
                  {tupleCount === 1 ? "render is" : "renders are"} the only
                  remaining copy and can&apos;t be rebuilt.
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-red-300">
              Deselect {archiveOnlyByTrip.length === 1 ? "this trip" : "these trips"}{" "}
              to merge the rest — Merge is disabled while any of them are
              included.
            </p>
          </div>
        )}

        {!loading && assessment && assessment.cameraKinds.length > 1 && (
          <p className="mt-3 rounded-md bg-amber-950 px-2 py-1.5 text-xs text-amber-200">
            <span className="font-medium">
              ⚠ Mixed cameras ({assessment.cameraKinds.join(", ")}).
            </span>{" "}
            Different brands record at different resolutions and pixel
            formats; concatenating their timelapse outputs will fail at
            ffmpeg time. Pick <span className="font-medium">Discard all</span>{" "}
            below and re-encode after the merge.
          </p>
        )}

        {!loading && !archiveOnlyBlocked && assessment && assessment.hasAnyTimelapses && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-neutral-300">
              Existing timelapse outputs:
            </p>
            <table className="w-full border border-neutral-800 text-xs">
              <thead className="bg-neutral-950 text-neutral-500">
                <tr>
                  <th className="px-2 py-1 text-left">Tier</th>
                  <th className="px-2 py-1 text-left">Channel</th>
                  <th className="px-2 py-1 text-left">State</th>
                </tr>
              </thead>
              <tbody>
                {assessment.tuples.map((t) => (
                  <tr
                    key={`${t.tier}-${t.channel}`}
                    className="border-t border-neutral-800"
                  >
                    <td className="px-2 py-1 text-neutral-300">{t.tier}</td>
                    <td className="px-2 py-1 text-neutral-300">{t.channel}</td>
                    <td className="px-2 py-1">
                      {t.status === "concatenable" ? (
                        <span className="text-emerald-300">
                          ✓ eligible to combine (every source has it)
                        </span>
                      ) : (
                        <span className="text-amber-300">
                          <span className="font-semibold">
                            will be deleted
                          </span>{" "}
                          (only {1 + t.absorbedWithOutput.length} of{" "}
                          {marked.length} sources have it) — rebuild
                          afterward
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-neutral-500">
              "Eligible to combine" isn't a guarantee — ffmpeg still has to
              actually splice the files at merge time. If it fails, the
              primary trip's existing render is kept untouched rather than
              lost.
            </p>

            <fieldset className="mt-2 space-y-1.5">
              <legend className="text-xs font-medium text-neutral-300">
                Strategy
              </legend>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-neutral-300">
                <input
                  type="radio"
                  name="merge-strategy"
                  checked={strategy === "concatWherePossible"}
                  onChange={() => setStrategy("concatWherePossible")}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Concatenate where possible</span>
                  <br />
                  <span className="text-neutral-500">
                    Splice eligible tuples losslessly into the merged trip.
                    Partial tuples will be deleted — you&apos;ll need to
                    click Rebuild on the merged trip afterward to fill them
                    back in.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-neutral-300">
                <input
                  type="radio"
                  name="merge-strategy"
                  checked={strategy === "discardAll"}
                  onChange={() => setStrategy("discardAll")}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Discard all</span>
                  <br />
                  <span className="text-neutral-500">
                    <span className="font-semibold">
                      Every existing render will be deleted
                    </span>{" "}
                    — the merged trip starts with nothing encoded; you
                    click Rebuild to re-encode from originals.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        )}

        {errorMessage && (
          <p className="mt-3 rounded-md bg-red-950 px-2 py-1 text-xs text-red-300">
            {errorMessage}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={busy || loading || archiveOnlyBlocked}
            title={
              archiveOnlyBlocked
                ? "Deselect the archive-only trip(s) above to enable merge"
                : undefined
            }
            className={clsx(
              "rounded-md px-3 py-1 text-sm",
              busy || loading || archiveOnlyBlocked
                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                : "bg-sky-700 text-white hover:bg-sky-600",
            )}
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Post-merge result screen. Replaces the confirm dialog once
 * `mergeMarkedTrips` resolves, following the same "don't just close on
 * success" pattern as `ImportSummary` — the merge-scoped orphan sweep
 * that runs automatically on the backend is otherwise an invisible
 * background fact; this surfaces it as a visible line item at the
 * moment it happens instead of leaving the user to discover it later
 * via the file count on the Timelapse Library's Prune button.
 */
function MergeResultView({
  result,
  rebuildCount,
  onClose,
}: {
  result: MergeReport;
  rebuildCount: number;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-100">
          Merge complete
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="text-neutral-400">Trips merged</span>
          <span className="text-neutral-200">
            {1 + result.absorbedTripIds.length}
          </span>
          {result.concatenated.length > 0 && (
            <>
              <span className="text-neutral-400">Renders combined</span>
              <span className="text-emerald-300">
                {result.concatenated.length}
              </span>
            </>
          )}
          {rebuildCount > 0 && (
            <>
              <span className="text-neutral-400">Needs a rebuild</span>
              <span className="text-amber-300">
                {rebuildCount} render{rebuildCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          {result.pruned && result.pruned.trashed > 0 && (
            <>
              <span className="text-neutral-400">
                Redundant files cleared
              </span>
              <span className="text-neutral-200">
                {result.pruned.trashed} (
                {formatBytes(result.pruned.bytesReclaimed)})
              </span>
            </>
          )}
        </div>
        {result.pruned === null && (
          <p className="mt-2 rounded-md bg-amber-950 px-2 py-1 text-xs text-amber-200">
            The automatic cleanup sweep didn&apos;t run — leftover files from
            this merge may still be sitting in the archive. Run Prune from
            the Timelapse Library to clear them.
          </p>
        )}
        {rebuildCount > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Click Rebuild on the merged trip in the Timelapse Library to
            re-encode the renders that couldn&apos;t be combined.
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
