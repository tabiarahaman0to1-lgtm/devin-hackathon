import {
  APIResponseError,
  Client,
  extractDatabaseId,
  isHTTPResponseError,
} from "@notionhq/client";
import { LETTERS } from "./grades";
import type { LooseDatabase, LoosePage, NotionPropertySchema, NotionPropertyValue, QueryList } from "./notion-types";
import {
  deriveCode,
  propAt,
  readDate,
  readPlain,
  readRelationIds,
  resolveSchema,
  type PropSchema,
} from "./schema";
import type { Course, GradeItem, MissingField, NewItemInput } from "./types";

type QueryStrategy = "database-request" | "data-source";
type PageProperties = NonNullable<Parameters<Client["pages"]["create"]>[0]["properties"]>;

/** Student OS databases were created with this API version (properties live on the database). */
export const NOTION_VERSION = "2022-06-28";

let notionClient: Client | null = null;
let queryStrategy: QueryStrategy | null = null;

export function hasNotionToken(): boolean {
  return Boolean(process.env.NOTION_TOKEN?.trim());
}

export function getNotionClient(): Client {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) throw new Error("NOTION_TOKEN is not set.");
  if (!notionClient) {
    notionClient = new Client({ auth: token, notionVersion: NOTION_VERSION });
  }
  return notionClient;
}

export function parseDatabaseId(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const extracted = extractDatabaseId(trimmed);
  if (extracted) return extracted;
  const match = trimmed.replace(/-/g, "").match(/[0-9a-fA-F]{32}/);
  if (!match) return null;
  const hex = match[0].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readDatabaseIds() {
  const specs = [
    ["courses", "NOTION_COURSES_DB_ID"],
    ["assignments", "NOTION_ASSIGNMENTS_DB_ID"],
  ] as const;
  const ids = {} as Record<(typeof specs)[number][0], string>;
  const problems: string[] = [];
  for (const [key, envName] of specs) {
    const id = parseDatabaseId(process.env[envName]);
    if (id) ids[key] = id;
    else problems.push(envName);
  }
  if (problems.length) {
    throw new Error(`Set ${problems.join(" and ")} in .env.local to a Notion database URL or 32-character ID.`);
  }
  return ids;
}

export function friendlyNotionError(error: unknown): string {
  if (error instanceof Error && /^Set NOTION_/.test(error.message)) return error.message;
  const status = isHTTPResponseError(error) ? error.status : undefined;
  const code = APIResponseError.isAPIResponseError(error) ? error.code : undefined;
  if (status === 401 || code === "unauthorized") {
    return "Notion returned 401. Check NOTION_TOKEN: create an internal integration at notion.so/my-integrations and paste its secret.";
  }
  if (status === 403 || status === 404 || code === "restricted_resource" || code === "object_not_found") {
    return "Notion can't find that database. Share Courses and Assignments with your integration (••• → Connections) and check the IDs in .env.local.";
  }
  if (status === 429 || code === "rate_limited") return "Notion is rate limiting requests. Wait a few seconds and try again.";
  if ((status && status >= 500) || code === "service_unavailable") return "Notion is having trouble right now. Try again in a minute.";
  if (code === "validation_error") {
    return `Notion rejected the request: ${error instanceof Error ? error.message : "check the property types"}.`;
  }
  return `Could not reach Notion (${error instanceof Error ? error.message : "unknown error"}).`;
}

function wantsDataSource(error: unknown): boolean {
  return /data[_ ]?source/i.test(error instanceof Error ? error.message : String(error));
}

async function queryPage(notion: Client, databaseId: string, dataSourceId: string | undefined, cursor?: string) {
  const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
  if (queryStrategy !== "data-source") {
    try {
      const result = await notion.request<QueryList>({ path: `databases/${databaseId}/query`, method: "post", body });
      queryStrategy = "database-request";
      return result;
    } catch (error) {
      if (!dataSourceId || !wantsDataSource(error)) throw error;
    }
  }
  if (!dataSourceId) throw new Error("This database has no data source to query.");
  queryStrategy = "data-source";
  return (await notion.dataSources.query({ data_source_id: dataSourceId, ...body })) as QueryList;
}

async function queryAll(notion: Client, databaseId: string, dataSourceId?: string): Promise<LoosePage[]> {
  const pages: LoosePage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const list = await queryPage(notion, databaseId, dataSourceId, cursor);
    pages.push(...(list.results ?? []));
    if (!list.has_more || !list.next_cursor) break;
    cursor = list.next_cursor;
  }
  return pages.filter((page) => page.id && page.properties && !page.archived && !page.in_trash);
}

type RawSchema = Record<string, NotionPropertySchema>;

async function loadDatabase(notion: Client, databaseId: string) {
  const database = (await notion.databases.retrieve({ database_id: databaseId })) as LooseDatabase;
  const dataSourceId = database.data_sources?.find((source) => source.id)?.id;
  let properties = database.properties;
  if ((!properties || !Object.keys(properties).length) && dataSourceId) {
    properties = ((await notion.dataSources.retrieve({ data_source_id: dataSourceId })) as LooseDatabase).properties;
  }
  return { raw: (properties ?? {}) as RawSchema, dataSourceId };
}

function findProp(raw: RawSchema, names: string[], types: string[], exclude: Array<PropSchema | undefined> = []) {
  const skip = new Set(exclude.filter(Boolean).map((prop) => prop!.name));
  const props: PropSchema[] = Object.entries(raw)
    .map(([key, value]) => ({
      key,
      name: value.name || key,
      type: value.type || "unknown",
      options: (value.select?.options ?? []).map((option) => option.name ?? "").filter(Boolean),
    }))
    .filter((prop) => types.includes(prop.type) && !skip.has(prop.name));
  for (const name of names) {
    const hit = props.find((prop) => prop.name.toLowerCase() === name);
    if (hit) return hit;
  }
  for (const name of names) {
    const hit = props.find((prop) => prop.name.toLowerCase().includes(name));
    if (hit) return hit;
  }
  return undefined;
}

const NUMERIC = ["number", "formula", "rollup"];

function courseSchema(raw: RawSchema) {
  const base = resolveSchema(raw);
  const credits = findProp(raw, ["credits", "credit", "credit hours", "credit hour", "ch"], NUMERIC);
  const target = findProp(raw, ["target grade", "target", "goal grade", "goal"], ["select", "rich_text"]);
  const status = findProp(raw, ["status", "state"], ["status", "select"], [target]);
  return { title: base.title, code: base.code, credits, target, status };
}

function assignmentSchema(raw: RawSchema) {
  const base = resolveSchema(raw);
  const max = findProp(raw, ["out of", "max score", "max marks", "max", "full marks", "total marks", "possible"], NUMERIC);
  const weight = findProp(raw, ["weight", "weightage", "worth", "percent", "%"], NUMERIC, [max]);
  const score = findProp(raw, ["score", "marks obtained", "obtained", "marks", "mark", "points", "result"], NUMERIC, [max, weight]);
  const category = findProp(raw, ["type", "category", "kind"], ["select", "multi_select"]);
  return { title: base.title, course: base.course, due: base.due, score, max, weight, category };
}

function readNumber(prop: NotionPropertyValue | undefined): number | null {
  if (!prop) return null;
  if (prop.type === "number") return prop.number ?? null;
  if (prop.type === "formula" && prop.formula?.type === "number") return prop.formula.number ?? null;
  if (prop.type === "rollup" && prop.rollup?.type === "number") return prop.rollup.number ?? null;
  const parsed = Number.parseFloat(readPlain(prop));
  return Number.isFinite(parsed) ? parsed : null;
}

function isActive(status: string): boolean {
  return !/(complete|finished|dropped|archived|past)/i.test(status);
}

export async function fetchGradeData(): Promise<{ courses: Course[]; items: GradeItem[]; missing: MissingField[] }> {
  const notion = getNotionClient();
  const ids = readDatabaseIds();
  const [courseDb, assignmentDb] = await Promise.all([
    loadDatabase(notion, ids.courses),
    loadDatabase(notion, ids.assignments),
  ]);
  const cs = courseSchema(courseDb.raw);
  const as = assignmentSchema(assignmentDb.raw);
  const [coursePages, assignmentPages] = await Promise.all([
    queryAll(notion, ids.courses, courseDb.dataSourceId),
    queryAll(notion, ids.assignments, assignmentDb.dataSourceId),
  ]);

  const courses: Course[] = coursePages.map((page) => {
    const name = readPlain(propAt(page.properties, cs.title)) || "Untitled course";
    return {
      id: page.id!,
      name,
      code: deriveCode(name, readPlain(propAt(page.properties, cs.code))),
      credits: readNumber(propAt(page.properties, cs.credits)) ?? 3,
      active: isActive(readPlain(propAt(page.properties, cs.status))),
      target: readPlain(propAt(page.properties, cs.target)) || null,
    };
  });

  const items: GradeItem[] = assignmentPages.map((page) => ({
    id: page.id!,
    title: readPlain(propAt(page.properties, as.title)) || "Untitled",
    courseId: readRelationIds(propAt(page.properties, as.course))[0] ?? null,
    due: readDate(propAt(page.properties, as.due)),
    category: readPlain(propAt(page.properties, as.category)) || null,
    score: readNumber(propAt(page.properties, as.score)),
    max: readNumber(propAt(page.properties, as.max)),
    weight: readNumber(propAt(page.properties, as.weight)),
  }));

  const missing: MissingField[] = [];
  if (!cs.credits) missing.push({ database: "Courses", name: "Credits" });
  if (!cs.target) missing.push({ database: "Courses", name: "Target grade" });
  if (!as.score) missing.push({ database: "Assignments", name: "Score" });
  if (!as.max) missing.push({ database: "Assignments", name: "Out of" });
  if (!as.weight) missing.push({ database: "Assignments", name: "Weight" });

  return { courses, items, missing };
}

function assertPageId(id: string) {
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, ""))) throw new Error("That item is not a Notion page.");
}

function writable(prop: PropSchema | undefined, label: string): PropSchema {
  if (!prop) throw new Error(`Add a ${label} property first (use "Add grade fields to Notion").`);
  if (prop.type === "formula" || prop.type === "rollup") {
    throw new Error(`${prop.name} is a ${prop.type}, so it can't be edited from here.`);
  }
  return prop;
}

async function updatePage(pageId: string, properties: Record<string, unknown>) {
  await getNotionClient().pages.update({ page_id: pageId, properties: properties as PageProperties });
}

export async function updateScore(itemId: string, score: number | null, max: number | null) {
  assertPageId(itemId);
  const { raw } = await loadDatabase(getNotionClient(), readDatabaseIds().assignments);
  const schema = assignmentSchema(raw);
  const properties: Record<string, unknown> = { [writable(schema.score, "Score").name]: { number: score } };
  if (max != null && schema.max && schema.max.type === "number") properties[schema.max.name] = { number: max };
  await updatePage(itemId, properties);
}

export async function updateCourse(courseId: string, patch: { target?: string | null; credits?: number }) {
  assertPageId(courseId);
  const { raw } = await loadDatabase(getNotionClient(), readDatabaseIds().courses);
  const schema = courseSchema(raw);
  const properties: Record<string, unknown> = {};
  if (patch.target !== undefined) {
    const prop = writable(schema.target, "Target grade");
    properties[prop.name] =
      prop.type === "select"
        ? { select: patch.target ? { name: patch.target } : null }
        : { rich_text: patch.target ? [{ text: { content: patch.target } }] : [] };
  }
  if (patch.credits !== undefined) {
    properties[writable(schema.credits, "Credits").name] = { number: patch.credits };
  }
  await updatePage(courseId, properties);
}

export async function createItem(input: NewItemInput): Promise<GradeItem> {
  assertPageId(input.courseId);
  const notion = getNotionClient();
  const ids = readDatabaseIds();
  const { raw, dataSourceId } = await loadDatabase(notion, ids.assignments);
  const schema = assignmentSchema(raw);
  if (!schema.title) throw new Error("The Assignments database has no title property.");
  const properties: Record<string, unknown> = {
    [schema.title.name]: { title: [{ text: { content: input.title } }] },
  };
  if (schema.course) properties[schema.course.name] = { relation: [{ id: input.courseId }] };
  if (schema.due && input.due) properties[schema.due.name] = { date: { start: input.due } };
  if (schema.weight?.type === "number" && input.weight != null) properties[schema.weight.name] = { number: input.weight };
  if (schema.max?.type === "number" && input.max != null) properties[schema.max.name] = { number: input.max };

  const body = properties as PageProperties;
  let page: { id: string };
  try {
    page = await notion.pages.create({ parent: { database_id: ids.assignments }, properties: body });
  } catch (error) {
    if (!dataSourceId || !wantsDataSource(error)) throw error;
    page = await notion.pages.create({ parent: { data_source_id: dataSourceId }, properties: body });
  }
  return {
    id: page.id,
    title: input.title,
    courseId: input.courseId,
    due: input.due,
    category: null,
    score: null,
    max: input.max,
    weight: input.weight,
  };
}

/** Add the number/select properties GradePilot needs to the Student OS databases. */
export async function addMissingFields(): Promise<string[]> {
  const notion = getNotionClient();
  const ids = readDatabaseIds();
  const [courseDb, assignmentDb] = await Promise.all([
    loadDatabase(notion, ids.courses),
    loadDatabase(notion, ids.assignments),
  ]);
  const cs = courseSchema(courseDb.raw);
  const as = assignmentSchema(assignmentDb.raw);
  const number = { number: { format: "number" } };

  const coursePatch: Record<string, unknown> = {};
  if (!cs.credits) coursePatch.Credits = number;
  if (!cs.target) coursePatch["Target grade"] = { select: { options: LETTERS.map((name) => ({ name })) } };
  const assignmentPatch: Record<string, unknown> = {};
  if (!as.score) assignmentPatch.Score = number;
  if (!as.max) assignmentPatch["Out of"] = number;
  if (!as.weight) assignmentPatch.Weight = number;

  const added: string[] = [];
  const patch = async (databaseId: string, dataSourceId: string | undefined, properties: Record<string, unknown>, label: string) => {
    if (!Object.keys(properties).length) return;
    try {
      await notion.request({ path: `databases/${databaseId}`, method: "patch", body: { properties } });
    } catch (error) {
      if (!dataSourceId || !wantsDataSource(error)) throw error;
      await notion.request({ path: `data_sources/${dataSourceId}`, method: "patch", body: { properties } });
    }
    added.push(...Object.keys(properties).map((name) => `${label}.${name}`));
  };
  await patch(ids.courses, courseDb.dataSourceId, coursePatch, "Courses");
  await patch(ids.assignments, assignmentDb.dataSourceId, assignmentPatch, "Assignments");
  return added;
}
