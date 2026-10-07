import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { useStore } from "../../state/store";
import type { Trip } from "../../types/model";
import { formatBytes } from "../../utils/format";

interface Props {
  trips: Trip[];
  /** "trip" trashes originals AND timelapse archives (full removal);
   *  "originals" trashes only the source files, keeping the archive. */
  mode: "trip" | "originals";
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Sum a field across segments, returning null if *any* contributing
 *  size is unknown (a partial total would understate what's deleted). */
function originalsBytes(trips: Trip[]): number | null {
  let total = 0;
  let sawAny = false;
  for (const trip of trips) {
    for (const seg of trip.segments) {
      sawAny = true;
      if (seg.sizeBytes == null) return null;
      total += seg.sizeBytes;
    }
  }
  return sawAny ? total : null;
}

/**
 * Confirms a bulk delete across several selected trips. Mirrors the
 * single-trip dialogs but summarizes the whole selection in aggregate so
 * the user sees the combined blast radius before committing. The "trip"
 * mode is the only path that removes timelapse archives — the copy calls
 * that out, same as `DeleteTripDialog`.
 */
export function BulkDeleteTripsDialog({
  trips,
  mode,
  busy,
  errorMessage,
  onCancel,
  onConfirm,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const tripIds = useMemo(() => new Set(trips.map((t) => t.id)), [trips]);

  const originalFileCount = useMemo(
    () =>
      trips.reduce(
        (sum, t) =>
          sum + t.segments.reduce((s, seg) => s + seg.channels.length, 0),
        0,
      ),
    [trips],
  );
  const originalBytes = useMemo(() => originalsBytes(trips), [trips]);

  const timelapseFileCount = useStore(
    (s) =>
      s.timelapseJobs.filter(
        (j) => tripIds.has(j.tripId) && j.outputPath !== null,
      ).length,
  );
  const timelapseBytes = useStore((s) => {
    const jobs = s.timelapseJobs.filter(
      (j) => tripIds.has(j.tripId) && j.outputSizeBytes != null,
    );
    if (jobs.length === 0) return null;
    return jobs.reduce((sum, j) => sum + (j.outputSizeBytes ?? 0), 0);
  });

  const isTrip = mode === "trip";
  const title = isTrip
    ? `Delete ${trips.length} ${trips.length === 1 ? "trip" : "trips"}?`
    : `Delete originals for ${trips.length} ${trips.length === 1 ? "trip" : "trips"}?`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] rounded-md border border-neutral-700 bg-neutral-900 p-4 text-neutral-100"
      >
        <h2
          className={clsx(
            "text-base font-semibold",
            isTrip ? "text-red-300" : "text-amber-300",
          )}
        >
          {title}
        </h2>
        <ul className="mt-3 space-y-1 text-sm text-neutral-300">
          {originalFileCount > 0 && (
            <li>
              <span className="text-neutral-400">→</span> {originalFileCount}{" "}
              original {originalFileCount === 1 ? "file" : "files"}
              {originalBytes != null && ` (${formatBytes(originalBytes)})`} to
              trash
            </li>
          )}
          {isTrip ? (
            <>
              {timelapseFileCount > 0 && (
                <li>
                  <span className="text-neutral-400">→</span>{" "}
                  {timelapseFileCount} timelapse archive{" "}
                  {timelapseFileCount === 1 ? "file" : "files"}
                  {timelapseBytes != null && ` (${formatBytes(timelapseBytes)})`}{" "}
                  to trash
                </li>
              )}
              <li>
                <span className="text-neutral-400">→</span> Trips and all their
                tags removed from the library
              </li>
            </>
          ) : (
            <li>
              <span className="text-neutral-400">→</span> Timelapse archives
              kept
            </li>
          )}
        </ul>
        {isTrip ? (
          <p className="mt-2 rounded-md bg-red-950 px-2 py-1 text-xs text-red-300">
            This deletes the timelapse archives too. Use{" "}
            <span className="font-semibold">Delete originals</span> instead to
            keep them.
          </p>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">
            Source files move to the system trash. Archive-only trips in the
            selection are skipped.
          </p>
        )}
        {errorMessage && (
          <p className="mt-2 rounded-md bg-red-950 px-2 py-1 text-xs text-red-300">
            {errorMessage}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={clsx(
              "rounded-md px-3 py-1 text-sm text-white",
              busy
                ? "cursor-not-allowed bg-neutral-700"
                : isTrip
                  ? "bg-red-700 hover:bg-red-600"
                  : "bg-amber-700 hover:bg-amber-600",
            )}
          >
            {busy
              ? "Deleting…"
              : isTrip
                ? `Delete ${trips.length} ${trips.length === 1 ? "trip" : "trips"}`
                : "Delete originals"}
          </button>
        </div>
      </div>
    </div>
  );
}
