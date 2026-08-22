import type { BomGroup, InventoryPart, MatchResult } from "./types";

const trim = (value: string): string => value.trim();
const normalizeMpn = (value: string): string => trim(value).toLowerCase();
const normalizeCandidate = (value: string): string => trim(value).toLowerCase();

export function matchBomGroup(group: BomGroup, inventory: InventoryPart[]): MatchResult {
  const lcscCode = trim(group.lcscCode);
  if (lcscCode !== "") {
    const lcscMatches = inventory
      .filter((part) => trim(part.lcscCode) === lcscCode)
      .map((part) => part.id);
    if (lcscMatches.length === 1) return { kind: "exact-lcsc", partId: lcscMatches[0] };
    return lcscMatches.length > 1 ? { kind: "candidate", partIds: lcscMatches } : { kind: "none" };
  }

  const mpn = normalizeMpn(group.mpn);
  if (mpn !== "") {
    const mpnMatches = inventory
      .filter((part) => normalizeMpn(part.mpn) === mpn)
      .map((part) => part.id);
    if (mpnMatches.length === 1) return { kind: "exact-mpn", partId: mpnMatches[0] };
    if (mpnMatches.length > 1) return { kind: "candidate", partIds: mpnMatches };
    // A supplied manufacturer part number is authoritative. Do not turn a
    // conflicting identifier into a name/value match.
    return { kind: "none" };
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
