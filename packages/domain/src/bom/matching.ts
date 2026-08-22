import type { BomGroup, InventoryPart, MatchResult } from "./types";

const trim = (value: string): string => value.trim();
const normalizeMpn = (value: string): string => trim(value).toLowerCase();
const normalizeCandidate = (value: string): string => trim(value).toLowerCase();

export function matchBomGroup(group: BomGroup, inventory: InventoryPart[]): MatchResult {
  const lcscCode = trim(group.lcscCode);
  if (lcscCode !== "") {
    const exact = inventory.find((part) => trim(part.lcscCode) === lcscCode);
    return exact ? { kind: "exact-lcsc", partId: exact.id } : { kind: "none" };
  }

  const mpn = normalizeMpn(group.mpn);
  if (mpn !== "") {
    const exact = inventory.find((part) => normalizeMpn(part.mpn) === mpn);
    if (exact) return { kind: "exact-mpn", partId: exact.id };
  }

  const value = normalizeCandidate(group.value);
  const name = normalizeCandidate(group.name);
  const packageName = normalizeCandidate(group.package);
  const candidateIds = inventory
    .filter((part) => {
      const partName = normalizeCandidate(part.name);
      const partValue = normalizeCandidate(part.value ?? "");
      const identityMatches = (value !== "" && (partName === value || partValue === value))
        || (name !== "" && (partName === name || partValue === name));
      return identityMatches && packageName !== "" && normalizeCandidate(part.package) === packageName;
    })
    .map((part) => part.id);

  return candidateIds.length > 0 ? { kind: "candidate", partIds: candidateIds } : { kind: "none" };
}
