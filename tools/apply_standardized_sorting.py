from __future__ import annotations

import argparse
from pathlib import Path
import sys


KNOWN_REPO = Path(r"C:\library_app\library-map")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)

    if count != 1:
        raise RuntimeError(
            f"{label}: expected exactly one source match, found {count}."
        )

    return text.replace(old, new, 1)


def resolve_repo_root(argument: str | None) -> Path:
    candidates = []

    if argument:
        candidates.append(Path(argument))

    candidates.extend([Path.cwd(), KNOWN_REPO])

    for candidate in candidates:
        root = candidate.expanduser().resolve()

        if (
            (root / "src" / "App.tsx").is_file()
            and (root / "src" / "data" / "librarySelectors.ts").is_file()
        ):
            return root

    raise FileNotFoundError(
        "Could not find the library-map repo. Run this from the repo root "
        "or pass --repo C:\\library_app\\library-map."
    )


def patch_selectors(source: str) -> str:
    source = replace_once(
        source,
        '''export type SearchScope =
''',
        '''export type LibrarySortItem = {
  title: string;
  author: string;
  authorSort: string;
  firstName?: string;
  lastName?: string;
  series?: string | null;
  seriesTitle?: string | null;
  seriesFormat?: string | null;
  seriesNumber?: number | string | null;
};

export type SearchScope =
''',
        "librarySelectors: add LibrarySortItem",
    )

    source = replace_once(
        source,
        '''export type SearchSortDirection =
  | "asc"
  | "desc";

export type SingleLetterMatchMode =
''',
        '''export type SearchSortDirection =
  | "asc"
  | "desc";

export type LibrarySortField =
  | SearchSortField
  | "series";

export type LibrarySortDirection =
  SearchSortDirection;

export type SingleLetterMatchMode =
''',
        "librarySelectors: add shared sort types",
    )

    signature_replacements = [
        (
            '''function getAuthorSearchValues(
  book: Book,
''',
            '''function getAuthorSearchValues(
  book: LibrarySortItem,
''',
            "librarySelectors: broaden author sorter item",
        ),
        (
            '''function getSeriesSortTitle(book: Book): string {
''',
            '''function getSeriesSortTitle(
  book: LibrarySortItem
): string {
''',
            "librarySelectors: broaden series title sorter item",
        ),
        (
            '''function getSeriesMediaSortValue(book: Book): string {
''',
            '''function getSeriesMediaSortValue(
  book: LibrarySortItem
): string {
''',
            "librarySelectors: broaden series media sorter item",
        ),
        (
            '''function compareSeriesNumbers(a: Book, b: Book): number {
''',
            '''function compareSeriesNumbers(
  a: LibrarySortItem,
  b: LibrarySortItem
): number {
''',
            "librarySelectors: broaden series number comparator",
        ),
        (
            '''function compareBooksInsideSeries(
  a: Book,
  b: Book
): number {
''',
            '''function compareBooksInsideSeries(
  a: LibrarySortItem,
  b: LibrarySortItem
): number {
''',
            "librarySelectors: broaden in-series comparator",
        ),
        (
            '''function compareBooksWithinSameSeries(
  a: Book,
  b: Book
): number | null {
''',
            '''function compareBooksWithinSameSeries(
  a: LibrarySortItem,
  b: LibrarySortItem
): number | null {
''',
            "librarySelectors: broaden same-series comparator",
        ),
        (
            '''function getPrimaryAuthorSortValue(
  book: Book,
''',
            '''function getPrimaryAuthorSortValue(
  book: LibrarySortItem,
''',
            "librarySelectors: broaden primary author sorter item",
        ),
        (
            '''function compareBooksByTitle(
  a: Book,
  b: Book
): number {
''',
            '''function compareBooksByTitle(
  a: LibrarySortItem,
  b: LibrarySortItem
): number {
''',
            "librarySelectors: broaden title comparator",
        ),
    ]

    for old, new, label in signature_replacements:
        source = replace_once(source, old, new, label)

    old_sorter = '''export function sortBooksForSearchDisplay(
  books: Book[],
  sortField:
    SearchSortField = "title",
  sortDirection:
    SearchSortDirection = "asc"
): Book[] {
  return [...books].sort(
    (a, b) => {
      let comparison = 0;

      if (
        sortField === "title"
      ) {
        comparison =
          compareBooksByTitle(
            a,
            b
          );
      } else {
        const authorNameMode:
          AuthorNameMode =
            sortField ===
            "authorLast"
              ? "last"
              : "first";

        comparison =
          compareSearchText(
            getPrimaryAuthorSortValue(
              a,
              authorNameMode
            ),
            getPrimaryAuthorSortValue(
              b,
              authorNameMode
            )
          );

        if (
          comparison === 0
        ) {
          comparison =
            compareBooksByTitle(
              a,
              b
            );
        }
      }

      return sortDirection ===
        "asc"
        ? comparison
        : -comparison;
    }
  );
}
'''

    new_sorter = '''function compareLibraryItemsBySeries(
  a: LibrarySortItem,
  b: LibrarySortItem
): number {
  const aSeries =
    getSeriesSortTitle(a);

  const bSeries =
    getSeriesSortTitle(b);

  if (!aSeries && !bSeries) {
    return compareBooksByTitle(
      a,
      b
    );
  }

  if (!aSeries) return 1;
  if (!bSeries) return -1;

  const seriesComparison =
    compareSearchText(
      aSeries,
      bSeries
    );

  if (seriesComparison !== 0) {
    return seriesComparison;
  }

  return compareBooksInsideSeries(
    a,
    b
  );
}

export function sortLibraryItemsForDisplay<
  Item extends LibrarySortItem
>(
  items: Item[],
  sortField:
    LibrarySortField = "title",
  sortDirection:
    LibrarySortDirection = "asc"
): Item[] {
  return [...items].sort(
    (a, b) => {
      let comparison = 0;

      if (
        sortField === "title"
      ) {
        comparison =
          compareBooksByTitle(
            a,
            b
          );
      } else if (
        sortField === "series"
      ) {
        comparison =
          compareLibraryItemsBySeries(
            a,
            b
          );
      } else {
        const authorNameMode:
          AuthorNameMode =
            sortField ===
            "authorLast"
              ? "last"
              : "first";

        comparison =
          compareSearchText(
            getPrimaryAuthorSortValue(
              a,
              authorNameMode
            ),
            getPrimaryAuthorSortValue(
              b,
              authorNameMode
            )
          );

        if (
          comparison === 0
        ) {
          comparison =
            compareBooksByTitle(
              a,
              b
            );
        }
      }

      return sortDirection ===
        "asc"
        ? comparison
        : -comparison;
    }
  );
}

export function sortBooksForSearchDisplay(
  books: Book[],
  sortField:
    SearchSortField = "title",
  sortDirection:
    SearchSortDirection = "asc"
): Book[] {
  return sortLibraryItemsForDisplay(
    books,
    sortField,
    sortDirection
  );
}
'''

    return replace_once(
        source,
        old_sorter,
        new_sorter,
        "librarySelectors: replace Search-only sorter with shared sorter",
    )


def patch_app(source: str) -> str:
    source = replace_once(
        source,
        '''  getBookcasesFromBooks,
  getShelvesForBookcase,
  searchBooks,
  sortBooksForSearchDisplay,
} from "./data/librarySelectors";
''',
        '''  getBookcasesFromBooks,
  getShelvesForBookcase,
  searchBooks,
  sortLibraryItemsForDisplay,
  sortBooksForSearchDisplay,
} from "./data/librarySelectors";
''',
        "App: import shared sorter",
    )

    source = replace_once(
        source,
        '''import type {
  AuthorNameMode,
  SearchScope,
''',
        '''import type {
  AuthorNameMode,
  LibrarySortDirection,
  LibrarySortField,
  SearchScope,
''',
        "App: import shared sort types",
    )

    wanted_sort_options = '''const WANTED_SORT_FIELD_OPTIONS:
  Record<
    WantedMode,
    Array<{
      field: LibrarySortField;
      label: string;
    }>
  > = {
    toBuy: [
      {
        field: "title",
        label: "Title",
      },
      {
        field: "authorLast",
        label: "Author last",
      },
      {
        field: "authorFirst",
        label: "Author first",
      },
      {
        field: "series",
        label: "Series",
      },
    ],

    seriesToComplete: [
      {
        field: "series",
        label: "Series",
      },
      {
        field: "title",
        label: "Title",
      },
      {
        field: "authorLast",
        label: "Author last",
      },
      {
        field: "authorFirst",
        label: "Author first",
      },
    ],
  };

'''

    source = replace_once(
        source,
        '''];

function normalizeInlineSearchText(value: unknown): string {
''',
        '''];

''' + wanted_sort_options + '''function normalizeInlineSearchText(value: unknown): string {
''',
        "App: add Wanted sort option configuration",
    )

    wanted_sort_state = '''  const [
    wantedSortFields,
    setWantedSortFields,
  ] = useState<
    Record<
      WantedMode,
      LibrarySortField
    >
  >({
    toBuy: "title",
    seriesToComplete: "series",
  });

  const [
    wantedSortDirections,
    setWantedSortDirections,
  ] = useState<
    Record<
      WantedMode,
      LibrarySortDirection
    >
  >({
    toBuy: "asc",
    seriesToComplete: "asc",
  });
'''

    source = replace_once(
        source,
        '''  const [wantedQueries, setWantedQueries] = useState<Record<WantedMode, string>>({
    toBuy: "",
    seriesToComplete: "",
  });
  const [selectedChallengeId, setSelectedChallengeId] =
''',
        '''  const [wantedQueries, setWantedQueries] = useState<Record<WantedMode, string>>({
    toBuy: "",
    seriesToComplete: "",
  });

''' + wanted_sort_state + '''  const [selectedChallengeId, setSelectedChallengeId] =
''',
        "App: add per-Wanted-list sort state",
    )

    old_active_wanted = '''  const activeWantedQuery = wantedQueries[wantedMode];

  const activeWantedModeOption =
    WANTED_MODE_OPTIONS.find((option) => option.mode === wantedMode) ??
    WANTED_MODE_OPTIONS[0];

  const filteredWantedItems = useMemo(
    () => filterWantedItems(activeWantedItems, activeWantedQuery),
    [activeWantedItems, activeWantedQuery]
  );

  const wantedTotal = wantedLists.toBuy.length + wantedLists.seriesToComplete.length;
'''

    new_active_wanted = '''  const activeWantedQuery = wantedQueries[wantedMode];

  const activeWantedSortField =
    wantedSortFields[wantedMode];

  const activeWantedSortDirection =
    wantedSortDirections[wantedMode];

  const activeWantedModeOption =
    WANTED_MODE_OPTIONS.find((option) => option.mode === wantedMode) ??
    WANTED_MODE_OPTIONS[0];

  const filteredWantedItems = useMemo(
    () => filterWantedItems(activeWantedItems, activeWantedQuery),
    [activeWantedItems, activeWantedQuery]
  );

  const sortedWantedItems =
    useMemo(
      () =>
        sortLibraryItemsForDisplay(
          filteredWantedItems,
          activeWantedSortField,
          activeWantedSortDirection
        ),
      [
        filteredWantedItems,
        activeWantedSortField,
        activeWantedSortDirection,
      ]
    );

  const wantedTotal = wantedLists.toBuy.length + wantedLists.seriesToComplete.length;
'''

    source = replace_once(
        source,
        old_active_wanted,
        new_active_wanted,
        "App: sort filtered Wanted results",
    )

    wanted_sort_controls = '''          <div className="searchControlGroup sortDirectionGroup">
            <p className="searchControlLabel">
              Sort by
            </p>

            <div
              className="searchSortOptions"
              role="group"
              aria-label={`Choose how ${activeWantedModeOption.label} books are sorted`}
            >
              {WANTED_SORT_FIELD_OPTIONS[
                wantedMode
              ].map(
                (option) => (
                  <button
                    key={
                      option.field
                    }
                    type="button"
                    className={
                      activeWantedSortField ===
                      option.field
                        ? "searchSortButton searchSortButtonActive"
                        : "searchSortButton"
                    }
                    aria-pressed={
                      activeWantedSortField ===
                      option.field
                    }
                    onClick={() => {
                      setWantedSortFields(
                        (
                          currentFields
                        ) => ({
                          ...currentFields,

                          [wantedMode]:
                            option.field,
                        })
                      );
                    }}
                  >
                    {
                      option.label
                    }
                  </button>
                )
              )}
            </div>
          </div>

          <div className="searchControlGroup sortDirectionGroup">
            <p className="searchControlLabel">
              Order
            </p>

            <div
              className="searchSortOptions"
              role="group"
              aria-label={`Choose alphabetical direction for ${activeWantedModeOption.label}`}
            >
              <button
                type="button"
                className={
                  activeWantedSortDirection ===
                  "asc"
                    ? "searchSortButton searchSortButtonActive"
                    : "searchSortButton"
                }
                aria-pressed={
                  activeWantedSortDirection ===
                  "asc"
                }
                onClick={() => {
                  setWantedSortDirections(
                    (
                      currentDirections
                    ) => ({
                      ...currentDirections,

                      [wantedMode]:
                        "asc",
                    })
                  );
                }}
              >
                A–Z
              </button>

              <button
                type="button"
                className={
                  activeWantedSortDirection ===
                  "desc"
                    ? "searchSortButton searchSortButtonActive"
                    : "searchSortButton"
                }
                aria-pressed={
                  activeWantedSortDirection ===
                  "desc"
                }
                onClick={() => {
                  setWantedSortDirections(
                    (
                      currentDirections
                    ) => ({
                      ...currentDirections,

                      [wantedMode]:
                        "desc",
                    })
                  );
                }}
              >
                Z–A
              </button>
            </div>
          </div>

'''

    source = replace_once(
        source,
        '''          <div className="wantedSummary">
''',
        wanted_sort_controls + '''          <div className="wantedSummary">
''',
        "App: add Wanted sort controls",
    )

    source = replace_once(
        source,
        '''            filteredWantedItems,
            activeWantedQuery.trim()
''',
        '''            sortedWantedItems,
            activeWantedQuery.trim()
''',
        "App: render sorted Wanted results",
    )

    return source


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Standardize MyLibrary alphabetical sorting and add "
            "sort controls to both Wanted lists."
        )
    )
    parser.add_argument(
        "--repo",
        help="Path to the library-map repository.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate all source anchors without writing changes.",
    )
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo)
    app_path = repo_root / "src" / "App.tsx"
    selectors_path = repo_root / "src" / "data" / "librarySelectors.ts"

    original_app = app_path.read_text(encoding="utf-8")
    original_selectors = selectors_path.read_text(encoding="utf-8")

    patched_selectors = patch_selectors(original_selectors)
    patched_app = patch_app(original_app)

    if args.check:
        print("PASS: every expected source anchor matched exactly.")
        print(f"Repo: {repo_root}")
        return 0

    selectors_path.write_text(patched_selectors, encoding="utf-8")
    app_path.write_text(patched_app, encoding="utf-8")

    print("Applied standardized sorting changes.")
    print(f"Updated: {selectors_path}")
    print(f"Updated: {app_path}")
    print()
    print("Next:")
    print("  npm run build")
    print("  git diff -- src/data/librarySelectors.ts src/App.tsx")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
