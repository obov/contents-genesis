export const CORE_VERSION = "1.0.0";
export type Ref = { id: string; revision?: number };
export type Alias = { namespace: string; value: string };
export type Locator = {
  store: "objects";
  key: string;
  sha256: string;
  size: number;
  media_type: string;
  role: string;
};
export type Relation = {
  from: Ref;
  to: Ref;
  predicate: string;
  predicate_version: string;
  scope: Record<string, unknown>;
  evidence_refs: Ref[];
  assertion_state: "proposed" | "observed" | "verified" | "disputed";
};
export interface RecordData {
  id: string;
  revision: number;
  supersedes_revision: number | null;
  type: string;
  type_version: string;
  owner: string;
  title: string;
  aliases: Alias[];
  recorded_at: string;
  recorded_by: string;
  lifecycle: "active" | "deprecated" | "tombstone";
  locators: Locator[];
  attributes: Record<string, unknown>;
  extensions: Record<string, unknown>;
  relation?: Relation;
  [key: string]: unknown;
}
export type Draft = Pick<
  RecordData,
  "id" | "type" | "type_version" | "owner" | "title" | "attributes"
> & {
  aliases?: Alias[];
  locators?: Locator[];
  extensions?: Record<string, unknown>;
  lifecycle?: RecordData["lifecycle"];
  relation?: Relation;
  [key: string]: unknown;
};
export type Mutation = { expected_revision: number; record: Draft };
export type TypeDefinition = { name: string; version: string; schema: string };
export type RelationDefinition = TypeDefinition & {
  from_types: string[];
  to_types: string[];
  pin?: "both" | "from" | "to";
};
export type Manifest = {
  manifest_version: string;
  id: string;
  version: string;
  requires_core: string;
  requires_modules?: Record<string, string>;
  types: TypeDefinition[];
  relations: RelationDefinition[];
};
export type StoreName =
  | "records"
  | "objects"
  | "stores"
  | "indexes"
  | "runs"
  | "work";
export type ProjectConfig = {
  format_version: string;
  id: string;
  modules: string[];
  stores: Record<StoreName, string>;
  architecture?: {
    target_version: string;
    target_snapshot_sha256: string;
    implemented_version: string | null;
    implementation_evidence: string[];
  };
  /** Shared skills linked from contents-genesis/skills into .agents/skills. */
  skills?: string[];
  production?: {
    /** Legacy shorthand: Remotion renderer directory (implies @cg/remotion). */
    renderer?: string;
    /** Pipeline used when an item does not name one. */
    default_pipeline?: string;
    /** name → { use: "@cg/<id>" | "./path" | "<package>", ...options } */
    pipelines?: Record<string, { use: string; [key: string]: unknown }>;
  };
  [key: string]: unknown;
};
