import type { NotionPropertySchema, NotionPropertyValue } from "./notion-types";

export type PropSchema = {
  key: string;
  name: string;
  type: string;
  options: string[];
};

export type ResolvedSchema = {
  title?: PropSchema;
  code?: PropSchema;
  status?: PropSchema;
  priority?: PropSchema;
  due?: PropSchema;
  course?: PropSchema;
};

function optionNames(value: NotionPropertySchema): string[] {
  const list = value.select?.options ?? value.status?.options ?? value.multi_select?.options ?? [];
  return list.map((option) => option.name).filter((name): name is string => Boolean(name));
}

function toProps(raw: Record<string, NotionPropertySchema>): PropSchema[] {
  return Object.entries(raw).map(([key, value]) => ({
    key,
    name: value.name || key,
    type: value.type || "unknown",
    options: optionNames(value),
  }));
}

function nameScore(prop: PropSchema, names: string[]): number {
  const current = prop.name.toLowerCase();
  const exact = names.findIndex((name) => current === name);
  if (exact >= 0) return exact;
  const contains = names.findIndex((name) => current.includes(name));
  if (contains >= 0) return 100 + contains;
  return -1;
}

function pickNamed(props: PropSchema[], names: string[], types?: string[]): PropSchema | undefined {
  const ranked = props
    .filter((prop) => (!types || types.includes(prop.type)) && nameScore(prop, names) >= 0)
    .sort((a, b) => nameScore(a, names) - nameScore(b, names));
  if (ranked[0]) return ranked[0];
  return props
    .filter((prop) => nameScore(prop, names) >= 0)
    .sort((a, b) => nameScore(a, names) - nameScore(b, names))[0];
}

function takeType(props: PropSchema[], used: Set<string>, types: string[]): PropSchema | undefined {
  return props.find((prop) => !used.has(prop.key) && types.includes(prop.type));
}

export function resolveSchema(raw: Record<string, NotionPropertySchema> | undefined): ResolvedSchema {
  const props = toProps(raw ?? {});
  const used = new Set<string>();
  const claim = (prop: PropSchema | undefined) => {
    if (prop) used.add(prop.key);
    return prop;
  };

  const title =
    claim(pickNamed(props.filter((prop) => !used.has(prop.key)), ["name", "title", "assignment", "task", "note"], ["title"])) ??
    claim(takeType(props, used, ["title"]));
  const statusNamed = claim(
    pickNamed(props.filter((prop) => !used.has(prop.key)), ["status", "state"], ["status", "select", "rich_text"]),
  );
  const priorityNamed = claim(
    pickNamed(
      props.filter((prop) => !used.has(prop.key)),
      ["priority", "urgency", "importance"],
      ["select", "status"],
    ),
  );
  const due =
    claim(
      pickNamed(props.filter((prop) => !used.has(prop.key)), ["due date", "deadline", "due", "date"], ["date"]),
    ) ?? claim(takeType(props, used, ["date"]));
  const course =
    claim(
      pickNamed(props.filter((prop) => !used.has(prop.key)), ["course", "class", "subject"], ["relation"]),
    ) ?? claim(takeType(props, used, ["relation"]));
  const code = claim(
    pickNamed(
      props.filter((prop) => !used.has(prop.key)),
      ["code", "course code", "abbr", "abbreviation"],
      ["rich_text", "select"],
    ),
  );
  const status = statusNamed ?? claim(takeType(props, used, ["status"])) ?? claim(takeType(props, used, ["select"]));
  const priority = priorityNamed ?? claim(takeType(props, used, ["select"]));

  return { title, code, status, priority, due, course };
}

function joinPlain(parts: Array<{ plain_text?: string }> | undefined): string {
  if (!parts) return "";
  return parts.map((part) => part.plain_text ?? "").join("").trim();
}

export function readPlain(prop: NotionPropertyValue | undefined): string {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return joinPlain(prop.title);
    case "rich_text":
      return joinPlain(prop.rich_text);
    case "select":
      return prop.select?.name ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "multi_select":
      return prop.multi_select?.map((option) => option.name).filter(Boolean).join(", ") ?? "";
    case "formula":
      if (prop.formula?.type === "string") return prop.formula.string ?? "";
      return "";
    case "unique_id": {
      const prefix = prop.unique_id?.prefix ?? "";
      const number = prop.unique_id?.number;
      return number == null ? prefix : `${prefix}${number}`;
    }
    default:
      return "";
  }
}

export function readDate(prop: NotionPropertyValue | undefined): string | null {
  if (!prop) return null;
  if (prop.type === "date") return prop.date?.start ?? null;
  if (prop.type === "formula" && prop.formula?.type === "date") return prop.formula.date?.start ?? null;
  const text = readPlain(prop);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text : null;
}

export function readRelationIds(prop: NotionPropertyValue | undefined): string[] {
  if (!prop || prop.type !== "relation" || !prop.relation) return [];
  return prop.relation.map((item) => item.id).filter((id): id is string => Boolean(id));
}

export function propAt(
  properties: Record<string, NotionPropertyValue> | undefined,
  schema: PropSchema | undefined,
): NotionPropertyValue | undefined {
  if (!properties || !schema) return undefined;
  if (properties[schema.name]) return properties[schema.name];
  if (properties[schema.key]) return properties[schema.key];
  const lower = schema.name.toLowerCase();
  const key = Object.keys(properties).find((name) => name.toLowerCase() === lower);
  return key ? properties[key] : undefined;
}

export function matchOption(options: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const exact = options.find((option) => option.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = options.find((option) => option.toLowerCase().includes(candidate.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

export function deriveCode(name: string, code: string): string {
  if (code.trim()) return code.trim();
  const match = name.match(/\b([A-Za-z]{2,6}\s?-?\d{2,4}[A-Za-z]?)\b/);
  if (match) return match[1].replace(/\s+/g, "").toUpperCase();
  return name.split(/\s+/)[0]?.slice(0, 8) || "COURSE";
}
