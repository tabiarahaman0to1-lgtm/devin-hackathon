"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <p className="text-sm text-muted">GradePilot</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Something broke</h1>
      <div className="mt-5 flex gap-3 rounded-md bg-[#fbe4e4] px-4 py-3 text-sm text-[#5d1715]">
        <span aria-hidden="true">!</span>
        <p>{error.message || "GradePilot could not load."}</p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0077d4]"
      >
        Try again
      </button>
    </main>
  );
}
