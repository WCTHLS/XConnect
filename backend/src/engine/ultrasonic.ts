import { getAcousticTokenForRoom } from "@confpresence/shared";

/**
 * Checks whether an acoustic token heard by an attendee matches an expected presenter/room token.
 * Normalizes case, removes hyphens/underscores/spaces, and resolves common room aliases (e.g., 'ROOM-A' == 'RM-A').
 */
export function isUltrasonicTokenMatch(heard?: string, expected?: string): boolean {
  if (!heard || !expected) return false;

  const normalize = (tok: string): string =>
    tok
      .trim()
      .toUpperCase()
      .replace(/[\s\-_]+/g, "");

  const hNorm = normalize(heard);
  const eNorm = normalize(expected);

  if (hNorm === eNorm) return true;
  if (hNorm.length >= 2 && (eNorm.includes(hNorm) || hNorm.includes(eNorm))) return true;

  // Compare using standardized room tokenizer tokens
  const hTokenNorm = normalize(getAcousticTokenForRoom(heard));
  const eTokenNorm = normalize(getAcousticTokenForRoom(expected));
  if (hTokenNorm === eTokenNorm) return true;
  if (hTokenNorm === eNorm || eTokenNorm === hNorm) return true;

  // Resolve standard room aliases (ROOM <-> RM, HALL <-> HL, WORKSHOP <-> WK, STAGE <-> ST)
  const toAlias = (n: string): string =>
    n
      .replace(/^ROOM/g, "RM")
      .replace(/^HALL/g, "HL")
      .replace(/^WORKSHOP/g, "WK")
      .replace(/^STAGE/g, "ST")
      .replace(/^AUDITORIUM/g, "AUD");

  const hAlias = toAlias(hNorm);
  const eAlias = toAlias(eNorm);

  if (hAlias === eAlias) return true;
  if (hAlias.length >= 2 && (eAlias.includes(hAlias) || hAlias.includes(eAlias))) return true;

  // Suffix code match (e.g., '1' for 'WK-1' or 'WORKSHOP-1')
  const hSuffix = hAlias.replace(/^(RM|HL|WK|ST)/, "");
  const eSuffix = eAlias.replace(/^(RM|HL|WK|ST)/, "");
  if (hSuffix && eSuffix && hSuffix === eSuffix) return true;

  return false;
}
