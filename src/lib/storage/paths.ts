/**
 * Server-generated private-storage object paths (§4.8).
 *
 * The path ALWAYS starts with the owner's uid, which the storage RLS in
 * 0012_storage.sql also enforces. The client never supplies or influences a
 * path. There is no user-controlled component and no guessable filename.
 */
export type ScanKind = "nutrition_label" | "receipt";

export function scanObjectPath(userId: string, kind: ScanKind): string {
  // "<uid>/<kind>/<uuid>" — no extension needed; content is validated by bytes.
  return `${userId}/${kind}/${crypto.randomUUID()}`;
}
