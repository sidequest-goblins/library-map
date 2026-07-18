export type LibraryReaderId =
  | "cj"
  | "jc";

export type LibraryReaderBookState = {
  user_id: string;
  reader_id: LibraryReaderId;
  catalog_key: string;
  is_read: boolean;
  current_page: number | null;
  rating: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LibraryStateLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export function makeLibraryStateKey(
  readerId: LibraryReaderId,
  catalogKey: string
): string {
  return `${readerId}:${catalogKey}`;
}