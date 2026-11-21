export type Course = {
  id: string;
  name: string;
  code: string;
  credits: number;
  active: boolean;
  target: string | null;
};

export type GradeItem = {
  id: string;
  title: string;
  courseId: string | null;
  due: string | null;
  category: string | null;
  score: number | null;
  max: number | null;
  weight: number | null;
};

export type MissingField = {
  database: "Courses" | "Assignments";
  name: string;
};

export type GradeData = {
  mode: "demo" | "live";
  courses: Course[];
  items: GradeItem[];
  missing: MissingField[];
  error: string | null;
};

export type ActionResult<T = unknown> = { ok: true; value?: T } | { ok: false; error: string };

export type NewItemInput = {
  courseId: string;
  title: string;
  weight: number | null;
  max: number | null;
  due: string | null;
};
