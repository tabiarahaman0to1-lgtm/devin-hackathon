"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { addItem, saveCourse, saveScore, setupFields } from "@/app/actions";
import {
  LETTERS,
  courseStats,
  focusOrder,
  formatGpa,
  formatPercent,
  isGraded,
  riskOf,
  stepFor,
  summarize,
  type CourseStats,
  type Risk,
} from "@/lib/grades";
import type { Course, GradeData, GradeItem } from "@/lib/types";

const RISK: Record<Risk, { label: string; tone: string; dot: string }> = {
  locked: { label: "Locked in", tone: "bg-[#ddedea] text-good", dot: "bg-good" },
  "on-track": { label: "On track", tone: "bg-[#ddedea] text-good", dot: "bg-good" },
  stretch: { label: "Stretch", tone: "bg-[#faebdd] text-warn", dot: "bg-warn" },
  "at-risk": { label: "At risk", tone: "bg-[#fbe4e4] text-bad", dot: "bg-bad" },
  "out-of-reach": { label: "Out of reach", tone: "bg-[#fbe4e4] text-bad", dot: "bg-bad" },
  "no-target": { label: "No target", tone: "bg-hover text-muted", dot: "bg-faint" },
};

function formatDue(date: string | null): string {
  if (!date) return "No date";
  const parsed = new Date(date.length === 10 ? `${date}T00:00:00+06:00` : date);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short" }).format(parsed);
}

function todayInDhaka(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}

function neededText(stats: Stats): string {
  if (!stats.target) return "Set a target grade to see what you need.";
  if (stats.needed == null) return "";
  if (stats.needed <= 0) return `${stats.target.letter} is secured even with 0% on what's left.`;
  if (!Number.isFinite(stats.needed)) return `Everything is graded; ${stats.target.letter} wasn't reached.`;
  if (stats.needed > 100) {
    const best = stepFor(stats.projectedBest).letter;
    return `${stats.target.letter} needs ${stats.needed.toFixed(0)}% on the remaining ${stats.remainingWeight.toFixed(0)}%. Best possible now: ${best}.`;
  }
  return `Average ${stats.needed.toFixed(0)}% on the remaining ${stats.remainingWeight.toFixed(0)}% to get ${stats.target.letter}.`;
}

type Stats = CourseStats & { projectedBest: number };

export function Dashboard({ data }: { data: GradeData }) {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>(data.courses);
  const [items, setItems] = useState<GradeItem[]>(data.items);
  const [assume, setAssume] = useState(75);
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setCourses(data.courses);
    setItems(data.items);
  }, [data]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const stats: Stats[] = useMemo(
    () =>
      courses
        .filter((course) => showInactive || course.active)
        .map((course) => {
          const base = courseStats(course, items, assume);
          return { ...base, projectedBest: courseStats(course, items, 100).projected };
        }),
    [courses, items, assume, showInactive],
  );
  const summary = useMemo(() => summarize(stats), [stats]);
  const focus = useMemo(() => focusOrder(stats).slice(0, 3), [stats]);
  const upcoming = useMemo(() => {
    const today = todayInDhaka();
    const visible = new Set(stats.map((s) => s.course.id));
    return items
      .filter((item) => !isGraded(item) && item.due && item.due.slice(0, 10) >= today && visible.has(item.courseId ?? ""))
      .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
      .slice(0, 6);
  }, [items, stats]);
  const codeOf = (id: string | null) => courses.find((course) => course.id === id)?.code ?? "—";

  function act(promise: Promise<{ ok: boolean; error?: string }>, success: string, rollback: () => void) {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        rollback();
        setToast({ text: result.error ?? "Something went wrong.", bad: true });
        return;
      }
      setToast({ text: success });
      router.refresh();
    });
  }

  function updateScore(item: GradeItem, score: number | null, max: number | null) {
    const before = items;
    setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, score, max: max ?? entry.max } : entry)));
    act(
      saveScore(item.id, score, max),
      data.mode === "live" ? `Saved ${item.title} to Notion` : `Saved ${item.title}`,
      () => setItems(before),
    );
  }

  function updateCourse(course: Course, patch: { target?: string | null; credits?: number }) {
    const before = courses;
    setCourses((list) => list.map((entry) => (entry.id === course.id ? { ...entry, ...patch } : entry)));
    act(saveCourse(course.id, patch), `Updated ${course.code}`, () => setCourses(before));
  }

  function createItem(course: Course, title: string, weight: number | null, max: number | null, due: string | null) {
    startTransition(async () => {
      const result = await addItem({ courseId: course.id, title, weight, max, due });
      if (!result.ok) {
        setToast({ text: result.error, bad: true });
        return;
      }
      if (result.value) setItems((list) => [...list, result.value!]);
      setToast({ text: `Added ${title} to ${course.code}` });
      router.refresh();
    });
  }

  function runSetup() {
    startTransition(async () => {
      const result = await setupFields();
      if (!result.ok) {
        setToast({ text: result.error, bad: true });
        return;
      }
      setToast({ text: `Added ${result.value?.length ?? 0} properties to Notion` });
      router.refresh();
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-lg bg-ink text-xl font-bold text-white">G</span>
            <h1 className="text-4xl font-bold tracking-tight">GradePilot</h1>
          </div>
          <p className="mt-2 max-w-xl text-muted">
            Know your grade in every course, the score you need on what&apos;s left, and where your GPA is heading.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${
            data.mode === "live" && !data.error ? "bg-[#ddedea] text-good" : "bg-hover text-muted"
          }`}
        >
          <span className={`size-2 rounded-full ${data.mode === "live" && !data.error ? "bg-good" : "bg-faint"}`} />
          {data.mode === "live" ? (data.error ? "Notion error" : "Connected to Notion Student OS") : "Demo mode: sample Student OS data"}
        </span>
      </header>

      {data.error && (
        <div className="mt-6 rounded-md bg-[#fbe4e4] px-4 py-3 text-sm text-[#5d1715]">{data.error}</div>
      )}

      {data.missing.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-sidebar px-4 py-3 text-sm">
          <p>
            Your Student OS is missing{" "}
            {data.missing.map((field, index) => (
              <span key={`${field.database}.${field.name}`}>
                {index > 0 && ", "}
                <b>{field.name}</b> <span className="text-muted">({field.database})</span>
              </span>
            ))}
            . GradePilot can add them for you.
          </p>
          <button
            type="button"
            onClick={runSetup}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-[#0077d4] disabled:opacity-60"
          >
            Add grade fields to Notion
          </button>
        </div>
      )}

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="GPA so far" value={formatGpa(summary.currentGpa)} hint="Graded work only, out of 4.00" />
        <Stat label="Projected GPA" value={formatGpa(summary.projectedGpa)} hint={`If you average ${assume}% on what's left`} />
        <Stat label="Credits" value={summary.credits.toString()} hint={`${stats.length} course${stats.length === 1 ? "" : "s"}`} />
        <Stat
          label="Courses at risk"
          value={summary.atRisk.toString()}
          hint={summary.atRisk ? "Target needs over 85%" : "All targets look reachable"}
          bad={summary.atRisk > 0}
        />
      </section>

      <section className="mt-4 rounded-lg border border-line px-4 py-3">
        <label className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium">What-if: I average</span>
          <input
            type="range"
            min={0}
            max={100}
            value={assume}
            onChange={(event) => setAssume(Number(event.target.value))}
            className="h-1 flex-1 accent-accent"
            aria-label="Assumed average on remaining work"
          />
          <span className="w-28 font-mono">
            {assume}% → {stepFor(assume).letter}
          </span>
          <span className="text-muted">on everything still ungraded</span>
        </label>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Courses</h2>
            {courses.some((course) => !course.active) && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show completed
              </label>
            )}
          </div>
          {stats.length === 0 && !data.error && (
            <p className="rounded-md bg-sidebar px-4 py-6 text-sm text-muted">
              No active courses yet. Add courses to your Student OS Courses database.
            </p>
          )}
          <div className="grid gap-4">
            {stats.map((s) => (
              <CourseCard
                key={s.course.id}
                stats={s}
                pending={pending}
                onScore={updateScore}
                onCourse={updateCourse}
                onAdd={createItem}
              />
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-lg border border-line p-4">
            <h2 className="font-semibold">Focus this week</h2>
            <p className="mt-1 text-xs text-muted">Courses where your target needs the biggest jump over your current grade.</p>
            {focus.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Set target grades to get focus suggestions.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {focus.map((s, index) => (
                  <li key={s.course.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-faint">{index + 1}</span>
                      <Chip>{s.course.code}</Chip>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-xs ${RISK[riskOf(s)].tone}`}>{RISK[riskOf(s)].label}</span>
                    </div>
                    <p className="mt-1 pl-5 text-muted">
                      Need {formatPercent(s.needed, 0)} vs {formatPercent(s.current, 0)} now for {s.target?.letter}.
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-line p-4">
            <h2 className="font-semibold">Coming up</h2>
            <p className="mt-1 text-xs text-muted">Ungraded work, soonest first, with how much of the grade it&apos;s worth.</p>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing ungraded with a future date.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <Chip>{codeOf(item.courseId)}</Chip>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="text-xs text-muted">{formatDue(item.due)}</span>
                    {item.weight != null && <span className="w-9 text-right font-mono text-xs">{item.weight}%</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-sidebar p-4 text-xs text-muted">
            <p className="font-medium text-ink">Grading scale (UGC)</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
              {["A+ 80+ 4.00", "A 75+ 3.75", "A- 70+ 3.50", "B+ 65+ 3.25", "B 60+ 3.00", "B- 55+ 2.75", "C+ 50+ 2.50", "C 45+ 2.25", "D 40+ 2.00", "F <40 0.00"].map(
                (row) => (
                  <span key={row}>{row}</span>
                ),
              )}
            </div>
          </div>
        </aside>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-lg ${
            toast.bad ? "bg-bad" : "bg-ink"
          }`}
        >
          {toast.text}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, hint, bad }: { label: string; value: string; hint: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${bad ? "text-bad" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-xs text-ink">{children}</span>;
}

function CourseCard({
  stats,
  pending,
  onScore,
  onCourse,
  onAdd,
}: {
  stats: Stats;
  pending: boolean;
  onScore: (item: GradeItem, score: number | null, max: number | null) => void;
  onCourse: (course: Course, patch: { target?: string | null; credits?: number }) => void;
  onAdd: (course: Course, title: string, weight: number | null, max: number | null, due: string | null) => void;
}) {
  const { course } = stats;
  const risk = riskOf(stats);
  const earnedPct = (stats.earned / stats.total) * 100;
  const lostPct = ((stats.gradedWeight - stats.earned) / stats.total) * 100;
  const letter = stats.current == null ? "—" : stepFor(stats.current).letter;

  return (
    <article className="rounded-lg border border-line">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip>{course.code}</Chip>
            <span className={`rounded px-1.5 py-0.5 text-xs ${RISK[risk].tone}`}>{RISK[risk].label}</span>
          </div>
          <h3 className="mt-1.5 truncate font-semibold">{course.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            <label className="flex items-center gap-1.5">
              Credits
              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                defaultValue={course.credits}
                key={course.credits}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== course.credits) onCourse(course, { credits: value });
                }}
                className="w-14 rounded border border-line px-1.5 py-0.5 text-ink"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Target
              <select
                value={course.target ?? ""}
                onChange={(event) => onCourse(course, { target: event.target.value || null })}
                className="rounded border border-line px-1.5 py-0.5 text-ink"
              >
                <option value="">None</option>
                {LETTERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tracking-tight">{letter}</p>
          <p className="font-mono text-sm text-muted">{formatPercent(stats.current)}</p>
        </div>
      </div>

      <div className="px-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-sidebar" aria-hidden="true">
          <div className="bg-good" style={{ width: `${earnedPct}%` }} />
          <div className="bg-[#e3a8a8]" style={{ width: `${lostPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>
            Earned {stats.earned.toFixed(1)} / {stats.gradedWeight.toFixed(0)} graded points
          </span>
          <span>{stats.remainingWeight.toFixed(0)}% still open</span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm">
          <span className={`size-2 shrink-0 rounded-full ${RISK[risk].dot}`} />
          {neededText(stats)}
        </p>
        <p className="mt-1 pl-4 text-xs text-muted">
          Projected final: {formatPercent(stats.projected)} ({stepFor(stats.projected).letter})
        </p>
      </div>

      <details className="mt-3 border-t border-line">
        <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted hover:bg-sidebar">
          {stats.items.length} assessment{stats.items.length === 1 ? "" : "s"} · enter scores
        </summary>
        <div className="px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Assessment</th>
                <th className="py-1 font-medium">Due</th>
                <th className="py-1 text-right font-medium">Weight</th>
                <th className="py-1 text-right font-medium">Score</th>
                <th className="py-1 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {stats.items.map((item) => (
                <ScoreRow key={item.id} item={item} pending={pending} onScore={onScore} />
              ))}
            </tbody>
          </table>
          <AddItemForm onAdd={(title, weight, max, due) => onAdd(course, title, weight, max, due)} pending={pending} />
        </div>
      </details>
    </article>
  );
}

function ScoreRow({
  item,
  pending,
  onScore,
}: {
  item: GradeItem;
  pending: boolean;
  onScore: (item: GradeItem, score: number | null, max: number | null) => void;
}) {
  const [score, setScore] = useState(item.score?.toString() ?? "");
  const [max, setMax] = useState((item.max ?? 100).toString());
  useEffect(() => {
    setScore(item.score?.toString() ?? "");
    setMax((item.max ?? 100).toString());
  }, [item.score, item.max]);

  const dirty = score !== (item.score?.toString() ?? "") || max !== (item.max ?? 100).toString();
  const pct = isGraded(item) ? ((item.score ?? 0) / (item.max ?? 100)) * 100 : null;

  function commit() {
    if (!dirty) return;
    onScore(item, score.trim() === "" ? null : Number(score), max.trim() === "" ? null : Number(max));
  }

  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2">
        {item.title}
        {item.category && <span className="ml-1.5 text-xs text-faint">{item.category}</span>}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-muted">{formatDue(item.due)}</td>
      <td className="py-1.5 text-right font-mono">{item.weight != null ? `${item.weight}%` : "—"}</td>
      <td className="py-1.5 text-right">
        <form
          className="inline-flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input
            value={score}
            onChange={(event) => setScore(event.target.value)}
            onBlur={commit}
            inputMode="decimal"
            placeholder="—"
            aria-label={`Score for ${item.title}`}
            className="w-14 rounded border border-line px-1.5 py-0.5 text-right font-mono"
          />
          <span className="text-faint">/</span>
          <input
            value={max}
            onChange={(event) => setMax(event.target.value)}
            onBlur={commit}
            inputMode="decimal"
            aria-label={`Out of for ${item.title}`}
            className="w-12 rounded border border-line px-1.5 py-0.5 text-right font-mono"
          />
          <button type="submit" disabled={!dirty || pending} className="sr-only">
            Save
          </button>
        </form>
      </td>
      <td className="py-1.5 text-right font-mono text-muted">{pct == null ? "—" : `${pct.toFixed(0)}%`}</td>
    </tr>
  );
}

function AddItemForm({
  onAdd,
  pending,
}: {
  onAdd: (title: string, weight: number | null, max: number | null, due: string | null) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("");
  const [max, setMax] = useState("100");
  const [due, setDue] = useState("");

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        onAdd(title.trim(), weight ? Number(weight) : null, max ? Number(max) : null, due || null);
        setTitle("");
        setWeight("");
        setDue("");
      }}
    >
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="New assessment, e.g. Quiz 4"
        className="min-w-40 flex-1 rounded border border-line px-2 py-1"
      />
      <input
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
        inputMode="decimal"
        placeholder="Weight %"
        className="w-20 rounded border border-line px-2 py-1"
      />
      <input
        value={max}
        onChange={(event) => setMax(event.target.value)}
        inputMode="decimal"
        placeholder="Out of"
        className="w-16 rounded border border-line px-2 py-1"
        aria-label="Out of"
      />
      <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="rounded border border-line px-2 py-1" />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="rounded-md bg-accent px-3 py-1 font-medium text-white hover:bg-[#0077d4] disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
