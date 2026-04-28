"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password.");
        setBusy(false);
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-black text-neutral-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-5">
        <div className="text-center mb-3">
          <h1 className="text-2xl font-semibold tracking-tight">Content Studio</h1>
          <p className="text-sm text-neutral-500 mt-1.5">Enter password to continue</p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          disabled={busy}
          className="w-full px-5 py-3.5 rounded-full bg-neutral-950 border border-neutral-800 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600 transition disabled:opacity-50"
        />

        {error && (
          <div className="text-sm text-neutral-400 text-center -mt-2">{error}</div>
        )}

        <button
          type="submit"
          disabled={busy || !password.trim()}
          className="w-full px-5 py-3.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
