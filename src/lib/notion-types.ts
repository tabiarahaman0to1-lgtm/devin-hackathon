export type NotionPropertySchema = {
  name?: string;
  type?: string;
  select?: { options?: Array<{ name?: string }> };
  status?: { options?: Array<{ name?: string }> };
  multi_select?: { options?: Array<{ name?: string }> };
};

export type NotionPropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  status?: { name?: string } | null;
  date?: { start?: string | null } | null;
  relation?: Array<{ id?: string }>;
  multi_select?: Array<{ name?: string }>;
  number?: number | null;
  formula?: {
    type?: string;
    string?: string | null;
    number?: number | null;
    date?: { start?: string | null } | null;
  };
  rollup?: { type?: string; number?: number | null };
  unique_id?: { prefix?: string | null; number?: number | null };
};

export type LoosePage = {
  object?: string;
  id?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties?: Record<string, NotionPropertyValue>;
};

export type QueryList = {
  results?: LoosePage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export type LooseDatabase = {
  properties?: Record<string, NotionPropertySchema>;
  data_sources?: Array<{ id?: string; name?: string }>;
};
