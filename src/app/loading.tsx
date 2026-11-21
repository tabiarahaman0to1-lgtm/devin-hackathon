export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <h1 className="text-4xl font-bold tracking-tight">GradePilot</h1>
      <p className="mt-3 text-muted">Reading Courses and Assignments from Notion…</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-24 animate-pulse rounded-lg bg-sidebar" />
        ))}
      </div>
    </main>
  );
}
