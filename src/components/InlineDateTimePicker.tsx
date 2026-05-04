"use client";

import { useMemo, useState } from "react";

// Inline calendar + time picker. Replaces native datetime-local because
// native is hard to read on desktop and the wrapping `min` clamp was
// causing the time portion to reset when the user nudged it. This
// component owns its own view state (which month is showing), but
// derives nothing else from props — date + time changes are pushed up
// via onChange the moment the user clicks.
//
// Value format: "YYYY-MM-DDTHH:mm" (local time, same shape native
// datetime-local emitted, so callers can keep parsing it the same way).

interface Parts {
  year: number;
  month: number;  // 0-11
  day: number;    // 1-31
  hour: number;   // 0-23
  minute: number; // 0-59
}

function parseValue(value: string): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

function partsToValue(p: Parts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Build the 6-row × 7-col calendar grid of dates for a given month. Days
// from the prior + next months fill the gaps so the grid is always 42
// cells. Each cell is { date, inMonth }.
function buildCalendarGrid(year: number, month: number): Array<{ date: Date; inMonth: boolean }> {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startWeekday);
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function InlineDateTimePicker({
  value,
  onChange,
  minDate,
}: {
  value: string;
  onChange: (next: string) => void;
  minDate?: Date;
}) {
  const parts = useMemo(() => parseValue(value), [value]);
  // The visible month/year. Tracked locally so paging doesn't change the
  // selected value; only clicking a day does.
  const [view, setView] = useState({ year: parts.year, month: parts.month });

  const minDay = minDate ? startOfDay(minDate) : null;
  const today = startOfDay(new Date());
  const grid = buildCalendarGrid(view.year, view.month);

  function patch(p: Partial<Parts>) {
    onChange(partsToValue({ ...parts, ...p }));
  }

  function pickDay(d: Date) {
    if (minDay && startOfDay(d) < minDay) return;
    patch({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() });
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      const year = v.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  }

  // Hour displayed as 12-hour (1-12). Minute snapped to 5-min grid for
  // saner select length. AM/PM toggles the underlying 24-hour value.
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const isPm = parts.hour >= 12;

  function setHour12(h12: number) {
    const h24 = isPm
      ? (h12 === 12 ? 12 : h12 + 12)
      : (h12 === 12 ? 0 : h12);
    patch({ hour: h24 });
  }

  function setMinute(min: number) {
    patch({ minute: min });
  }

  function togglePm(next: boolean) {
    if (next === isPm) return;
    let h = parts.hour;
    if (next && h < 12) h += 12;
    else if (!next && h >= 12) h -= 12;
    patch({ hour: h });
  }

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 flex flex-col gap-3">
      {/* Month nav */}
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[12px] font-semibold tracking-tight">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-500 py-1"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {grid.map(({ date, inMonth }, i) => {
          const isSelected =
            date.getFullYear() === parts.year &&
            date.getMonth() === parts.month &&
            date.getDate() === parts.day;
          const isToday = startOfDay(date).getTime() === today.getTime();
          const isPast = minDay ? startOfDay(date) < minDay : false;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pickDay(date)}
              disabled={isPast}
              className={`text-[12px] tabular-nums h-8 rounded-lg transition flex items-center justify-center ${
                isSelected
                  ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold"
                  : isPast
                    ? "text-neutral-300 dark:text-neutral-700 cursor-not-allowed"
                    : inMonth
                      ? `text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 ${isToday ? "ring-1 ring-neutral-400 dark:ring-neutral-600" : ""}`
                      : "text-neutral-400 dark:text-neutral-600 hover:bg-neutral-200 dark:hover:bg-neutral-800"
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {/* Time row */}
      <div className="flex items-center gap-2 px-1 pt-1 border-t border-neutral-200 dark:border-neutral-800">
        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
          Time
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <select
            value={hour12}
            onChange={(e) => setHour12(Number(e.target.value))}
            className="text-[12px] tabular-nums px-2 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:outline-none"
            aria-label="Hour"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-[12px] text-neutral-500">:</span>
          <select
            value={parts.minute - (parts.minute % 5)}
            onChange={(e) => setMinute(Number(e.target.value))}
            className="text-[12px] tabular-nums px-2 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:outline-none"
            aria-label="Minute"
          >
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
            ))}
          </select>
          <div className="flex rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 ml-1">
            <button
              type="button"
              onClick={() => togglePm(false)}
              className={`text-[11px] px-2 py-1.5 transition ${
                !isPm
                  ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold"
                  : "bg-white dark:bg-neutral-950 text-neutral-600 dark:text-neutral-400"
              }`}
            >
              AM
            </button>
            <button
              type="button"
              onClick={() => togglePm(true)}
              className={`text-[11px] px-2 py-1.5 transition ${
                isPm
                  ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold"
                  : "bg-white dark:bg-neutral-950 text-neutral-600 dark:text-neutral-400"
              }`}
            >
              PM
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
