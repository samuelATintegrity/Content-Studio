"use client";

import { Sidebar } from "@/components/Sidebar";
import { PostCard } from "@/components/PostCard";
import { GenerateFAB } from "@/components/GenerateFAB";
import { useBatchStore } from "@/store/batchStore";

export default function Home() {
  const { posts, loading, error } = useBatchStore();

  return (
    <div className="flex h-screen w-full bg-neutral-100 dark:bg-black text-neutral-900 dark:text-neutral-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-9 pb-28 max-w-[1900px] mx-auto">
          {error && (
            <div className="mb-6 px-4 py-3.5 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium tracking-tight">
              {error}
            </div>
          )}
          {posts.length === 0 && !loading && <EmptyState />}
          {loading && posts.length === 0 && <LoadingState />}
          {posts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 auto-rows-fr">
              {posts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          )}
        </div>
      </main>
      <GenerateFAB />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[70vh] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="mx-auto w-14 h-14 rounded-full border border-neutral-300 dark:border-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-600 mb-6">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <h2 className="text-base font-semibold tracking-tight mb-2">Ready when you are</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
          Pick a language and content type on the left, then click <span className="font-medium text-neutral-700 dark:text-neutral-300">Generate posts</span>. Hover any image to edit or download it. Hover the caption to copy.
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950"
        >
          <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
          <div className="p-4 space-y-2.5">
            <div className="h-3 w-2/3 rounded-full bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            <div className="h-3 w-full rounded-full bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            <div className="h-3 w-5/6 rounded-full bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
