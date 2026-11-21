import { demoState } from "./demo";
import { fetchGradeData, friendlyNotionError, hasNotionToken } from "./notion";
import type { GradeData } from "./types";

export async function loadGrades(): Promise<GradeData> {
  if (!hasNotionToken()) {
    const { courses, items } = demoState();
    return { mode: "demo", courses: structuredClone(courses), items: structuredClone(items), missing: [], error: null };
  }
  try {
    const data = await fetchGradeData();
    return { mode: "live", ...data, error: null };
  } catch (error) {
    console.error("[gradepilot] load", error);
    return { mode: "live", courses: [], items: [], missing: [], error: friendlyNotionError(error) };
  }
}
