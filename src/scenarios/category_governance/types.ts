export type CategoryRawRecord = Record<string, unknown> & {
  id?: string | number;
  name?: string;
  fatherId?: string | number | null;
  parentId?: string | number | null;
  categoryId?: string | number | null;
  children?: CategoryRawRecord[];
};

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  level: number;
  pathIds: string[];
  pathNames: string[];
  categoryId: string | null;
  isLeaf: boolean;
  enabled: boolean;
  payload: CategoryRawRecord;
}

export interface CategoryTreeDocument {
  sourceUrl?: string;
  bucket?: string;
  fetchedAt?: string;
  sourcePath?: string;
  sourceSha256?: string;
  importId?: number;
  version: string;
  nodes: CategoryNode[];
  roots: string[];
  leafCount: number;
}

export interface StdTextOptions {
  groupDepth?: number;
  includePayload?: boolean;
  includeIds?: boolean;
  maxDepth?: number;
}

export interface ContextChunk {
  key: string;
  groupDepth: number;
  rootId: string;
  rootPath: string[];
  nodeCount: number;
  leafCount: number;
  text: string;
}

export type PropertyType =
  | "text"
  | "number"
  | "boolean"
  | "single"
  | "multi"
  | "date"
  | "file";

export interface AttributeProperty {
  key: string;
  name: string;
  description?: string;
  type: PropertyType;
  required: boolean;
  unit?: string | null;
  options?: string[];
  format?: string | null;
  example?: string | null;
  scope?: "shared" | "category";
}

export interface AttributeTemplate {
  category: { id: string; path: string[]; name: string };
  shared?: AttributeProperty[];
  properties: AttributeProperty[];
  notes?: string[];
}

export interface GovernanceResult {
  category: { id: string; path: string[]; name: string };
  shared: AttributeProperty[];
  properties: AttributeProperty[];
  notes: string[];
  meta?: Record<string, unknown>;
}
