"use server";

import { revalidatePath } from "next/cache";
import { demoState } from "@/lib/demo";
import { stepByLetter } from "@/lib/grades";
import { addMissingFields, createItem, friendlyNotionError, hasNotionToken, updateCourse, updateScore } from "@/lib/notion";
import type { ActionResult, GradeItem, NewItemInput } from "@/lib/types";

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function run<T>(label: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const value = await work();
    revalidatePath("/");
    return { ok: true, value };
  } catch (error) {
    console.error(`[gradepilot] ${label}`, error);
    return { ok: false, error: friendlyNotionError(error) };
  }
}

export async function saveScore(itemId: string, scoreRaw: unknown, maxRaw: unknown): Promise<ActionResult> {
  const score = finiteOrNull(scoreRaw);
  const max = finiteOrNull(maxRaw);
  if (score === undefined || (score != null && score < 0)) return { ok: false, error: "Enter a score of 0 or more." };
  if (max === undefined || (max != null && max <= 0)) return { ok: false, error: "Out of must be more than 0." };
  if (!hasNotionToken()) {
    const item = demoState().items.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, error: "Item not found." };
    item.score = score;
    if (max != null) item.max = max;
    return { ok: true };
  }
  return run("save score", () => updateScore(itemId, score, max));
}

export async function saveCourse(courseId: string, patch: { target?: string | null; credits?: number }): Promise<ActionResult> {
  if (patch.target !== undefined && patch.target !== null && !stepByLetter(patch.target)) {
    return { ok: false, error: "Pick a grade from the list." };
  }
  if (patch.credits !== undefined && (!Number.isFinite(patch.credits) || patch.credits <= 0 || patch.credits > 12)) {
    return { ok: false, error: "Credits should be between 0.5 and 12." };
  }
  if (!hasNotionToken()) {
    const course = demoState().courses.find((entry) => entry.id === courseId);
    if (!course) return { ok: false, error: "Course not found." };
    if (patch.target !== undefined) course.target = patch.target;
    if (patch.credits !== undefined) course.credits = patch.credits;
    return { ok: true };
  }
  return run("save course", () => updateCourse(courseId, patch));
}

export async function addItem(input: NewItemInput): Promise<ActionResult<GradeItem>> {
  const title = input?.title?.replace(/\s+/g, " ").trim();
  if (!title || title.length > 200) return { ok: false, error: "Give it a title." };
  const weight = finiteOrNull(input.weight);
  const max = finiteOrNull(input.max);
  if (weight === undefined || (weight != null && (weight < 0 || weight > 100))) return { ok: false, error: "Weight is a percent from 0 to 100." };
  if (max === undefined || (max != null && max <= 0)) return { ok: false, error: "Out of must be more than 0." };
  const due = input.due?.trim() || null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: "Use a valid date." };
  const clean: NewItemInput = { courseId: input.courseId, title, weight, max, due };

  if (!hasNotionToken()) {
    const state = demoState();
    if (!state.courses.some((course) => course.id === clean.courseId)) return { ok: false, error: "Pick a course." };
    const item: GradeItem = { id: `demo-item-${crypto.randomUUID()}`, ...clean, category: null, score: null };
    state.items.push(item);
    return { ok: true, value: item };
  }
  return run("add item", () => createItem(clean));
}

export async function setupFields(): Promise<ActionResult<string[]>> {
  if (!hasNotionToken()) return { ok: true, value: [] };
  return run("setup fields", addMissingFields);
}
