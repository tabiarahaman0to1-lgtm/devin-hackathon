import type { Course, GradeItem } from "./types";

export type GradeStep = { letter: string; min: number; point: number };

/** UGC uniform grading scale used by Bangladeshi universities. */
export const SCALE: GradeStep[] = [
  { letter: "A+", min: 80, point: 4.0 },
  { letter: "A", min: 75, point: 3.75 },
  { letter: "A-", min: 70, point: 3.5 },
  { letter: "B+", min: 65, point: 3.25 },
  { letter: "B", min: 60, point: 3.0 },
  { letter: "B-", min: 55, point: 2.75 },
  { letter: "C+", min: 50, point: 2.5 },
  { letter: "C", min: 45, point: 2.25 },
  { letter: "D", min: 40, point: 2.0 },
  { letter: "F", min: 0, point: 0 },
];

export const LETTERS = SCALE.map((step) => step.letter);

export function stepFor(percent: number): GradeStep {
  return SCALE.find((step) => percent >= step.min) ?? SCALE[SCALE.length - 1];
}

export function stepByLetter(letter: string | null | undefined): GradeStep | null {
  if (!letter) return null;
  const clean = letter.trim().toUpperCase();
  return SCALE.find((step) => step.letter === clean) ?? null;
}

export type CourseStats = {
  course: Course;
  items: GradeItem[];
  /** Weighted percent on graded work only, or null when nothing is graded yet. */
  current: number | null;
  /** Percentage points already earned out of the course total. */
  earned: number;
  gradedWeight: number;
  remainingWeight: number;
  total: number;
  /** Percent needed on all remaining work to hit the target, or null without a target. */
  needed: number | null;
  /** Final percent if every remaining item scores `assume` percent. */
  projected: number;
  target: GradeStep | null;
};

export function isGraded(item: GradeItem): boolean {
  return item.score != null && (item.max ?? 100) > 0;
}

function weightsFor(items: GradeItem[]): number[] {
  const anyWeight = items.some((item) => item.weight != null && item.weight > 0);
  if (anyWeight) return items.map((item) => Math.max(0, item.weight ?? 0));
  return items.map(() => (items.length ? 100 / items.length : 0));
}

export function courseStats(course: Course, all: GradeItem[], assume: number): CourseStats {
  const items = all.filter((item) => item.courseId === course.id);
  const weights = weightsFor(items);
  const listed = weights.reduce((sum, weight) => sum + weight, 0);
  const total = Math.max(100, listed);

  let earned = 0;
  let gradedWeight = 0;
  items.forEach((item, index) => {
    if (!isGraded(item)) return;
    const max = item.max ?? 100;
    const ratio = Math.min(1.5, Math.max(0, (item.score ?? 0) / max));
    earned += weights[index] * ratio;
    gradedWeight += weights[index];
  });

  const remainingWeight = Math.max(0, total - gradedWeight);
  const current = gradedWeight > 0 ? (earned / gradedWeight) * 100 : null;
  const target = stepByLetter(course.target);
  const needed =
    target == null
      ? null
      : remainingWeight > 0
        ? ((target.min * total) / 100 - earned) / remainingWeight * 100
        : earned / total * 100 >= target.min
          ? 0
          : Infinity;
  const projected = ((earned + (remainingWeight * assume) / 100) / total) * 100;

  return { course, items, current, earned, gradedWeight, remainingWeight, total, needed, projected, target };
}

export type Summary = {
  currentGpa: number | null;
  projectedGpa: number | null;
  credits: number;
  atRisk: number;
};

function weightedGpa(entries: Array<{ credits: number; percent: number | null }>): number | null {
  let credits = 0;
  let points = 0;
  for (const entry of entries) {
    if (entry.percent == null || entry.credits <= 0) continue;
    credits += entry.credits;
    points += entry.credits * stepFor(entry.percent).point;
  }
  return credits > 0 ? points / credits : null;
}

export type Risk = "locked" | "on-track" | "stretch" | "at-risk" | "out-of-reach" | "no-target";

export function riskOf(stats: CourseStats): Risk {
  if (stats.needed == null) return "no-target";
  if (stats.needed <= 0) return "locked";
  if (stats.needed > 100) return "out-of-reach";
  if (stats.needed > 85) return "at-risk";
  if (stats.needed > 70) return "stretch";
  return "on-track";
}

export function summarize(stats: CourseStats[]): Summary {
  return {
    currentGpa: weightedGpa(stats.map((s) => ({ credits: s.course.credits, percent: s.current }))),
    projectedGpa: weightedGpa(stats.map((s) => ({ credits: s.course.credits, percent: s.projected }))),
    credits: stats.reduce((sum, s) => sum + s.course.credits, 0),
    atRisk: stats.filter((s) => {
      const risk = riskOf(s);
      return risk === "at-risk" || risk === "out-of-reach";
    }).length,
  };
}

/** Order courses by how much extra effort they need: biggest gap between needed and current first. */
export function focusOrder(stats: CourseStats[]): CourseStats[] {
  return stats
    .filter((s) => s.needed != null && s.needed > 0 && s.remainingWeight > 0)
    .sort((a, b) => {
      const gapA = (a.needed ?? 0) - (a.current ?? a.needed ?? 0);
      const gapB = (b.needed ?? 0) - (b.current ?? b.needed ?? 0);
      if (gapB !== gapA) return gapB - gapA;
      return b.course.credits - a.course.credits;
    });
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatGpa(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}
