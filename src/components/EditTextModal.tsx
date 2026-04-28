"use client";

import { useState } from "react";

interface Props {
  initial: { headline: string; cta: string; caption: string };
  onSave: (next: { headline: string; cta: string; caption: string }) => void;
  onCancel: () => void;
}

export function EditTextModal({ initial, onSave, onCancel }: Props) {
  const [headline, setHeadline] = useState(initial.headline);
  const [cta, setCta] = useState(initial.cta);
  const [caption, setCaption] = useState(initial.caption);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-950 rounded-2xl shadow-2xl w-full max-w-lg p-7 flex flex-col gap-4 border border-neutral-200 dark:border-neutral-800">
        <h3 className="text-base font-semibold tracking-tight">Edit post text</h3>

        <Field label="Top headline (≤4 words, image overlay)">
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
        </Field>

        <Field label="Bottom CTA (≤6 words, image overlay)">
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
        </Field>

        <Field label="Caption (paste into Instagram)">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={8}
            className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm font-mono resize-y focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-sm font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ headline, cta, caption })}
            className="px-4 py-2 rounded-full text-sm font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:hover:bg-white text-white dark:text-neutral-900"
          >
            Save & recompose
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}
