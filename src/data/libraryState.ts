import type {
  Book,
  ChallengeData,
} from "./libraryTypes";

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

export type LibraryReaderBookStateSeedRow = {
  user_id: string;
  reader_id: LibraryReaderId;
  catalog_key: string;
  is_read: boolean;
  current_page: number | null;
  rating: null;
  notes: null;
};

export type LibraryStateLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export type LibraryStateSeedPreview = {
  rows: LibraryReaderBookStateSeedRow[];
  totalRows: number;
  cjRows: number;
  jcRows: number;
  readRows: number;
  inProgressRows: number;
  skippedMissingCatalogKey: number;
};

export type LibraryStateSeedFeedback = {
  kind: "success" | "error";
  message: string;
} | null;

export function makeLibraryStateKey(
  readerId: LibraryReaderId,
  catalogKey: string
): string {
  return `${readerId}:${catalogKey}`;
}

function isLibraryReaderId(
  value: string
): value is LibraryReaderId {
  return value === "cj" || value === "jc";
}

function normalizePageNumber(
  value: number | null | undefined
): number | null {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.trunc(value)
  );
}

export function buildLibraryStateSeedPreview(
  books: Book[],
  challengeData: ChallengeData,
  userId: string
): LibraryStateSeedPreview {
  const rowsByKey =
    new Map<
      string,
      LibraryReaderBookStateSeedRow
    >();

  const catalogKeyByBookId =
    new Map<string, string>();

  let skippedMissingCatalogKey = 0;

  for (const book of books) {
    const catalogKey =
      book.catalogKey?.trim();

    if (
      book.bookId &&
      catalogKey
    ) {
      catalogKeyByBookId.set(
        book.bookId,
        catalogKey
      );
    }
  }

  function mergeSeedState(
    readerId: LibraryReaderId,
    catalogKeyValue: string | null | undefined,
    isRead: boolean,
    currentPageValue: number | null | undefined
  ) {
    const catalogKey =
      catalogKeyValue?.trim() ?? "";

    if (!catalogKey) {
      skippedMissingCatalogKey += 1;
      return;
    }

    const currentPage =
      normalizePageNumber(
        currentPageValue
      );

    const stateKey =
      makeLibraryStateKey(
        readerId,
        catalogKey
      );

    const existingRow =
      rowsByKey.get(stateKey);

    if (!existingRow) {
      rowsByKey.set(
        stateKey,
        {
          user_id: userId,
          reader_id: readerId,
          catalog_key: catalogKey,
          is_read: isRead,
          current_page:
            currentPage !== null &&
            currentPage > 0
              ? currentPage
              : null,
          rating: null,
          notes: null,
        }
      );

      return;
    }

    existingRow.is_read =
      existingRow.is_read ||
      isRead;

    if (
      (currentPage ?? 0) >
      (existingRow.current_page ?? 0)
    ) {
      existingRow.current_page =
        currentPage;
    }
  }

  for (const book of books) {
    if (book.cj) {
      mergeSeedState(
        "cj",
        book.catalogKey,
        true,
        null
      );
    }

    if (book.jc) {
      mergeSeedState(
        "jc",
        book.catalogKey,
        true,
        null
      );
    }
  }

  for (
    const challenge
    of challengeData.challenges
  ) {
    for (
      const reader
      of challenge.readers
    ) {
      if (
        !isLibraryReaderId(
          reader.readerId
        )
      ) {
        continue;
      }

      for (
        const entry
        of reader.entries
      ) {
        const totalPages =
          normalizePageNumber(
            entry.totalPages
          );

        const currentPage =
          entry.read &&
          totalPages !== null &&
          totalPages > 0
            ? totalPages
            : normalizePageNumber(
                entry.currentPage
              );

        const hasMeaningfulState =
          entry.read ||
          (currentPage ?? 0) > 0;

        if (!hasMeaningfulState) {
          continue;
        }

        const catalogKey =
          entry.catalogKey?.trim() ||
          (
            entry.bookId
              ? catalogKeyByBookId.get(
                  entry.bookId
                )
              : undefined
          );

        mergeSeedState(
          reader.readerId,
          catalogKey,
          entry.read,
          currentPage
        );
      }
    }
  }

  const rows = Array.from(
    rowsByKey.values()
  ).sort((a, b) => {
    const catalogComparison =
      a.catalog_key.localeCompare(
        b.catalog_key
      );

    if (catalogComparison) {
      return catalogComparison;
    }

    return a.reader_id.localeCompare(
      b.reader_id
    );
  });

  return {
    rows,
    totalRows: rows.length,
    cjRows: rows.filter(
      (row) =>
        row.reader_id === "cj"
    ).length,
    jcRows: rows.filter(
      (row) =>
        row.reader_id === "jc"
    ).length,
    readRows: rows.filter(
      (row) => row.is_read
    ).length,
    inProgressRows: rows.filter(
      (row) =>
        !row.is_read &&
        (row.current_page ?? 0) > 0
    ).length,
    skippedMissingCatalogKey,
  };
}