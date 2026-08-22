import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { BomGroup, InventoryPart, MatchResult } from "../../../../../packages/domain/src/bom/types";
import { matchBomGroup } from "../../../../../packages/domain/src/bom/matching";
import { desktopApi, type Part } from "../../app/tauri";
import { useState } from "react";

export type FieldName = "quantity" | "designators" | "name" | "value" | "package" | "manufacturer" | "mpn" | "lcsc_code" | "side";
export type FieldMapping = Partial<Record<FieldName, string>>;
export type BomGroupDto = BomGroup & {
  component_key?: string;
  lcsc_code?: string;
  quantity: number;
  designators?: string[];
  extra_fields?: Record<string, string>;
};
export type NormalizedBomDto = { source_name: string; groups: BomGroupDto[] };
export type ImportPreview =
  | { kind: "Ready"; bom: NormalizedBomDto }
  | { kind: "NeedsMapping"; headers: string[]; suggestions: FieldMapping }
  | { kind: "Unsupported"; message?: string };

export type BomImportApi = {
  inspectTabularBom: (sourcePath: string, mapping?: FieldMapping) => Promise<unknown>;
  cacheInteractiveBom: (sourcePath: string, displayName: string) => Promise<unknown>;
  listParts: () => Promise<Part[]>;
};

export type BomAnalysisRow = {
  componentKey: string;
  name: string;
  value: string;
  package: string;
  required: number;
  stock: number;
  shortage: number;
  match: MatchResult;
  status: "exact" | "candidate" | "none";
  partId?: string;
  boxSlot?: string;
  candidateIds?: string[];
};

const supported = new Set([".html", ".csv", ".xlsx"]);
const fieldNames: FieldName[] = ["quantity", "designators", "name", "value", "package", "manufacturer", "mpn", "lcsc_code", "side"];

const defaultApi: BomImportApi = {
  inspectTabularBom: (sourcePath, mapping) => invoke("inspect_tabular_bom", { sourcePath, mapping }),
  cacheInteractiveBom: (sourcePath, displayName) => invoke("cache_interactive_bom", { sourcePath, displayName }),
  listParts: () => desktopApi.listParts(),
};

export const defaultPickFile = async (): Promise<string | null> => {
  const selected = await open({ multiple: false, filters: [{ name: "BOM", extensions: ["html", "csv", "xlsx"] }] });
  return typeof selected === "string" ? selected : null;
};

type PreviewPayload = {
  kind?: "Ready" | "NeedsMapping";
  bom?: NormalizedBomDto;
  normalized?: NormalizedBomDto;
  Ready?: NormalizedBomDto;
  NeedsMapping?: { headers: string[]; suggestions: FieldMapping };
  headers?: string[];
  suggestions?: FieldMapping;
  message?: string;
};

function toPreview(value: unknown): ImportPreview {
  const payload = (value && typeof value === "object" ? value : {}) as PreviewPayload;
  if (payload.kind === "Ready" && payload.bom) return { kind: "Ready", bom: payload.bom };
  if (payload.kind === "NeedsMapping" && payload.headers && payload.suggestions) return { kind: "NeedsMapping", headers: payload.headers, suggestions: payload.suggestions };
  if (payload.normalized) return { kind: "Ready", bom: payload.normalized };
  if (payload.Ready) return { kind: "Ready", bom: payload.Ready };
  if (payload.NeedsMapping) return { kind: "NeedsMapping", ...payload.NeedsMapping };
  return { kind: "Unsupported", message: payload.message };
}

function normalizedGroup(group: BomGroupDto): BomGroup {
  return {
    componentKey: group.componentKey ?? group.component_key ?? "",
    name: group.name ?? "",
    value: group.value ?? "",
    package: group.package ?? "",
    manufacturer: group.manufacturer ?? "",
    mpn: group.mpn ?? "",
    lcscCode: group.lcscCode ?? group.lcsc_code ?? "",
    placements: group.placements ?? [],
    extraFields: group.extraFields ?? group.extra_fields ?? {},
  };
}

function partAsInventory(part: Part): InventoryPart {
  return { id: part.id, name: part.name, package: part.package ?? "", mpn: part.mpn ?? "", lcscCode: part.lcsc_code ?? "", value: part.name };
}

export function createAnalysisRows(bom: NormalizedBomDto, parts: Part[], confirmed: Record<string, string> = {}): BomAnalysisRow[] {
  const inventory = parts.map(partAsInventory);
  const byId = new Map(parts.map((part) => [part.id, part]));
  return bom.groups.map((group) => {
    const key = group.componentKey ?? group.component_key ?? `${group.name}|${group.value}|${group.package}`;
    const selected = confirmed[key];
    const rawMatch = selected ? { kind: "exact-mpn" as const, partId: selected } : matchBomGroup(normalizedGroup(group), inventory);
    const match = rawMatch;
    const partId = match.kind === "exact-lcsc" || match.kind === "exact-mpn" ? match.partId : undefined;
    const part = partId ? byId.get(partId) : undefined;
    const required = Math.max(Number(group.quantity) || 0, 0);
    const stock = part?.quantity ?? 0;
    return {
      componentKey: key, name: group.name, value: group.value, package: group.package,
      required, stock, shortage: Math.max(required - stock, 0), match,
      status: match.kind === "candidate" ? "candidate" : match.kind === "none" ? "none" : "exact",
      partId, boxSlot: part?.slot, candidateIds: match.kind === "candidate" ? match.partIds : undefined,
    };
  });
}

export function useBomImport({ api = defaultApi, pickFile = defaultPickFile }: { api?: BomImportApi; pickFile?: () => Promise<string | null> } = {}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "needsMapping" | "unsupported" | "error">("idle");
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [bom, setBom] = useState<NormalizedBomDto | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [rows, setRows] = useState<BomAnalysisRow[]>([]);

  async function inspect(sourcePath: string, supplied?: FieldMapping) {
    const extension = sourcePath.slice(sourcePath.lastIndexOf(".")).toLowerCase();
    if (!supported.has(extension)) { setStatus("unsupported"); setError("不支持的 BOM 格式"); return; }
    setPath(sourcePath); setError(""); setStatus("loading");
    try {
      const result = extension === ".html"
        ? toPreview(await api.cacheInteractiveBom(sourcePath, sourcePath.split(/[\\/]/).pop() ?? sourcePath))
        : toPreview(await api.inspectTabularBom(sourcePath, supplied));
      if (result.kind === "NeedsMapping") {
        setHeaders(result.headers); setMapping(result.suggestions ?? {}); setStatus("needsMapping"); return;
      }
      if (result.kind !== "Ready") { setStatus("error"); setError(result.message ?? "BOM 导入失败"); return; }
      const listed = await api.listParts();
      setBom(result.bom); setParts(listed); setRows(createAnalysisRows(result.bom, listed)); setStatus("ready");
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function chooseFile() { const selected = await pickFile(); if (selected) await inspect(selected); }
  async function submitMapping(next = mapping) { setMapping(next); if (path) await inspect(path, next); }
  function confirmMatch(componentKey: string, partId: string) {
    if (!bom) return;
    const next = createAnalysisRows(bom, parts, Object.fromEntries(rows.map((row) => [row.componentKey, row.partId ?? ""]).filter(([, id]) => id).concat([[componentKey, partId]])));
    setRows(next);
  }
  return { status, error, path, headers, mapping, setMapping, bom, rows, chooseFile, submitMapping, confirmMatch, fieldNames };
}

export { fieldNames };
