import type { Course, GradeItem } from "./types";

function day(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(date);
}

function seedCourses(): Course[] {
  return [
    { id: "demo-cse220", name: "CSE220 Data Structures", code: "CSE220", credits: 3, active: true, target: "A+" },
    { id: "demo-cse221", name: "CSE221 Algorithms", code: "CSE221", credits: 3, active: true, target: "A" },
    { id: "demo-mat215", name: "MAT215 Linear Algebra", code: "MAT215", credits: 3, active: true, target: "A-" },
    { id: "demo-phy111", name: "PHY111 Physics I", code: "PHY111", credits: 3, active: true, target: "B+" },
    { id: "demo-eng101", name: "ENG101 English Composition", code: "ENG101", credits: 2, active: true, target: null },
  ];
}

type Row = [string, string, number, number, number | null, number, string];

function seedItems(): GradeItem[] {
  const rows: Row[] = [
    ["demo-cse220", "Quiz 1", 5, 10, 9, -40, "Quiz"],
    ["demo-cse220", "Quiz 2", 5, 10, 7, -26, "Quiz"],
    ["demo-cse220", "Lab assignment: linked lists", 10, 20, 18, -18, "Assignment"],
    ["demo-cse220", "Midterm", 30, 30, 22, -10, "Exam"],
    ["demo-cse220", "Quiz 3", 5, 10, null, 3, "Quiz"],
    ["demo-cse220", "Project: BST visualizer", 15, 100, null, 12, "Project"],
    ["demo-cse220", "Final exam", 30, 50, null, 30, "Exam"],
    ["demo-cse221", "Problem set 1", 10, 50, 41, -35, "Assignment"],
    ["demo-cse221", "Midterm", 30, 40, 27, -9, "Exam"],
    ["demo-cse221", "Problem set 2", 10, 50, null, 5, "Assignment"],
    ["demo-cse221", "Final exam", 50, 60, null, 28, "Exam"],
    ["demo-mat215", "Quiz 1", 10, 15, 14, -30, "Quiz"],
    ["demo-mat215", "Quiz 2", 10, 15, 13, -14, "Quiz"],
    ["demo-mat215", "Midterm", 30, 30, 24, -7, "Exam"],
    ["demo-mat215", "Final exam", 50, 50, null, 25, "Exam"],
    ["demo-phy111", "Lab report 1", 10, 10, 6, -28, "Lab"],
    ["demo-phy111", "Midterm", 30, 30, 15, -8, "Exam"],
    ["demo-phy111", "Lab report 2", 10, 10, null, 4, "Lab"],
    ["demo-phy111", "Final exam", 50, 50, null, 26, "Exam"],
    ["demo-eng101", "Essay 1", 20, 20, 16, -20, "Assignment"],
    ["demo-eng101", "Presentation", 20, 20, null, 9, "Presentation"],
    ["demo-eng101", "Final paper", 60, 100, null, 22, "Assignment"],
  ];
  return rows.map(([courseId, title, weight, max, score, offset, category], index) => ({
    id: `demo-item-${index + 1}`,
    title,
    courseId,
    due: day(offset),
    category,
    score,
    max,
    weight,
  }));
}

type DemoState = { courses: Course[]; items: GradeItem[] };
const globalStore = globalThis as typeof globalThis & { __gradepilotDemo?: DemoState };

/** In-memory demo data so edits survive refreshes while the dev server runs. */
export function demoState(): DemoState {
  globalStore.__gradepilotDemo ??= { courses: seedCourses(), items: seedItems() };
  return globalStore.__gradepilotDemo;
}
