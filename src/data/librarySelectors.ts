import type { Book, Bookcase } from "./libraryTypes";
import type { BookcaseShelf } from "../components/BookcaseView";
import type { Spine } from "../components/ShelfRow";

function hashString(value: string): number {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function titleWithoutParentheses(title: string): string {
  const cleaned = title
    .replace(/\s*\([^)]*\)/g, "")
    .trim();

  return cleaned || title;
}

function applySpineTitleOverride(title: string): string {
  for (const [fullSeriesTitle, shortSeriesTitle] of Object.entries(
    SPINE_TITLE_OVERRIDES
  )) {
    if (title.startsWith(fullSeriesTitle)) {
      return title.replace(fullSeriesTitle, shortSeriesTitle);
    }
  }

  return title;
}

const SPINE_TITLE_OVERRIDES: Record<string, string> = {
  "Demon Slayer: Kimetsu Academy": "Kimetsu Academy",
  "Demon Slayer: Kimetsu no Yaiba": "Demon Slayer",
  "Fruits Basket Collector's Edition": "Fruits Basket",
  "Nightschool: The Weirn Books": "Nightschool",
  "Tsubasa: RESERVoir CHRoNiCLE": "Tsubasa",
};

function titleForSpineDisplay(book: Book): string {
  // Keep manga/LN volume numbers visible, but remove trailing format labels like:
  // "Some Title, Vol. 2 (Light Novel)"
  // "Some Title, Vol. 3 (Manwha)"
  const cleaned = book.title
    .replace(/\s*\((Light Novel|Manwha|Manhwa|Manga)\)\s*$/i, "")
    .trim();

  return applySpineTitleOverride(cleaned || book.title);
}

function titleForSpineHeight(book: Book): string {
  if (isVolumeSeriesBook(book)) {
    const baseSeriesTitle =
      book.seriesTitle ??
      book.series?.split("|")[0] ??
      book.title;

    const shortenedSeriesTitle = applySpineTitleOverride(baseSeriesTitle);

    return `${shortenedSeriesTitle}, Vol. 1`;
  }

  return titleForSpineDisplay(book);
}

const SPINE_MIN_HEIGHT = 110;
const SPINE_MAX_HEIGHT = 260;
const SPINE_PIXELS_PER_CHARACTER = 8;
const SPINE_TITLE_PADDING = 22;
const SPINE_SNAP_TO = 8;

const GENRE_SPINE_PALETTES: Record<string, string[]> = {
  "Manga / Graphic Novels": [
    "#6a4c93", // purple
    "#355c7d", // blue
    "#2a6f62", // teal
    "#7b3f61", // berry
    "#9a6a2f", // ochre
    "#8c4a3f", // brick
  ],

  Astrology: ["#5d4b73"], // muted violet
  Classical: ["#7a5c3e"], // walnut
  "Contemporary Fiction": ["#8c4a3f"], // brick
  Fantasy: ["#5f7f5a"], // moss green
  Folklore: ["#8a6f3f"], // antique gold
  "Foreign Language": ["#51656f"], // slate blue
  "Historical Fiction": ["#9a6a2f"], // ochre
  History: ["#6f4e37"], // coffee brown
  Horror: ["#7a3f4b"], // garnet
  Humor: ["#8a4f35"], // burnt sienna
  "LGBTQ+": ["#7b3f61"], // berry
  "Literary Fiction": ["#4f6f52"], // forest sage
  Memoir: ["#7a5c3e"], // walnut
  "Mystery / Thriller": ["#355c7d"], // deep blue
  Nature: ["#2a6f62"], // deep teal
  "Poetry / Anthology": ["#6a4c93"], // amethyst
  Psychology: ["#51656f"], // slate blue
  Romance: ["#b87b8b"], // dusty rose
  Science: ["#3f6f6a"], // peacock teal
  "Science Fiction": ["#4f7f8f"], // blue teal
  Sexuality: ["#8a4f6f"], // muted mauve
  "Social Justice / Feminism": ["#8a3f4f"], // cranberry
  Travel: ["#8a6f3f"], // antique gold
  "Young Adult": ["#6a4c93"], // purple

  Unknown: ["#746b60"], // warm gray-brown
};

const AUTO_GENRE_COLORS = [
  "#5f7f5a", // moss green
  "#6a4c93", // amethyst
  "#355c7d", // deep blue
  "#2a6f62", // deep teal
  "#7b3f61", // berry
  "#9a6a2f", // ochre
  "#8c4a3f", // brick
  "#7a5c3e", // walnut
  "#4f6f52", // forest sage
  "#6f4e37", // coffee brown
  "#7a3f4b", // garnet
  "#51656f", // slate blue
  "#8a6f3f", // antique gold
  "#5d4b73", // muted violet
  "#3f6f6a", // peacock teal
  "#8a4f35", // burnt sienna
];

function autoColorForGenre(genre: string): string {
  return AUTO_GENRE_COLORS[hashString(genre) % AUTO_GENRE_COLORS.length];
}

function spineBackgroundForBook(book: Book): string {
  const genre = book.genre?.trim();

  if (!genre) return "#746b60";

  const palette =
    GENRE_SPINE_PALETTES[genre] ?? [autoColorForGenre(genre)];

  const colorKey =
    book.seriesTitle ??
    book.series ??
    book.title ??
    book.bookId ??
    "unknown";

  return palette[hashString(colorKey) % palette.length];
}

function rawSpineHeightForTitle(title: string): number {
  const trimmedTitle = titleWithoutParentheses(title);
  const length = trimmedTitle.length;

  return SPINE_TITLE_PADDING + length * SPINE_PIXELS_PER_CHARACTER;
}

function spineHeightForTitle(title: string): number {
  const rawHeight = rawSpineHeightForTitle(title);
  const snappedHeight = Math.ceil(rawHeight / SPINE_SNAP_TO) * SPINE_SNAP_TO;

  return Math.min(
    SPINE_MAX_HEIGHT,
    Math.max(SPINE_MIN_HEIGHT, snappedHeight)
  );
}

function widthForBook(book: Book): Spine["width"] {
  const hash = hashString(`${book.bookId}-${book.title}-${book.author}`);
  const sizingTitle = book.series ?? book.title;

  if (titleWithoutParentheses(sizingTitle).length > 28) return "l";
  if (hash % 7 === 0) return "s";
  if (hash % 5 === 0) return "l";
  return "m";
}

function sortBooksForShelf(books: Book[]): Book[] {
  return [...books].sort((a, b) => {
    const aShelfPosition = a.shelfPosition;
    const bShelfPosition = b.shelfPosition;

    if (aShelfPosition != null && bShelfPosition != null) {
      return aShelfPosition - bShelfPosition;
    }

    if (aShelfPosition != null) return -1;
    if (bShelfPosition != null) return 1;

    const authorSort = a.authorSort.localeCompare(b.authorSort);

    if (authorSort) return authorSort;

    const aSeries = a.series ?? "";
    const bSeries = b.series ?? "";

    if (aSeries && bSeries && aSeries !== bSeries) {
      return aSeries.localeCompare(bSeries, undefined, { numeric: true });
    }

    if (aSeries && bSeries && aSeries === bSeries) {
      const aSeriesNumber = Number(a.seriesNumber);
      const bSeriesNumber = Number(b.seriesNumber);

      if (!Number.isNaN(aSeriesNumber) && !Number.isNaN(bSeriesNumber)) {
        return aSeriesNumber - bSeriesNumber;
      }
    }

    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
}

function isVolumeSeriesBook(book: Book): boolean {
  return Boolean(
    book.series &&
      book.seriesNumber != null &&
      /,\s*Vol\.\s*\d+/i.test(book.title)
  );
}

function fontSizeForSpine(book: Book): number | undefined {
  if (!isVolumeSeriesBook(book)) return undefined;

  const displayTitle = titleForSpineDisplay(book);
  const displayRawHeight = rawSpineHeightForTitle(displayTitle);

  // If the full display title would exceed max height anyway,
  // do NOT shrink it into unreadable dust. Let ellipsis happen.
  if (displayRawHeight > SPINE_MAX_HEIGHT) return undefined;

  const seriesNumber = Number(book.seriesNumber);

  // Nudge double/triple digit volumes.
  if (seriesNumber < 10) return undefined;

  return 15;
}

function bookToSpine(book: Book): Spine {
  return {
    id: book.bookId,
    title: titleForSpineDisplay(book),
    width: widthForBook(book),
    heightPx: spineHeightForTitle(titleForSpineHeight(book)),
    fontSizePx: fontSizeForSpine(book),
    background: spineBackgroundForBook(book),
  };
}

export function getBooksForBookcase(
  books: Book[],
  bookcase: Bookcase
): Book[] {
  return books.filter(
    (book) =>
      book.room === bookcase.room &&
      book.bookcase === bookcase.bookcase
  );
}

export function getShelvesForBookcase(
  books: Book[],
  bookcase: Bookcase
): BookcaseShelf[] {
  const booksForBookcase = getBooksForBookcase(books, bookcase);

  const groupedBooks = new Map<string, Book[]>();

  booksForBookcase.forEach((book) => {
    const rowLabel = book.row === "Main" ? book.shelf : `${book.shelf} — ${book.row}`;
    const groupKey = `${book.shelf}|${book.row}`;

    if (!groupedBooks.has(groupKey)) {
      groupedBooks.set(groupKey, []);
    }

    groupedBooks.get(groupKey)?.push({
      ...book,
      shelf: rowLabel,
    });
  });

  return Array.from(groupedBooks.entries())
    .sort(([aKey], [bKey]) => {
      const [aShelf, aRow] = aKey.split("|");
      const [bShelf, bRow] = bKey.split("|");

      return (
        aShelf.localeCompare(bShelf, undefined, { numeric: true }) ||
        aRow.localeCompare(bRow)
      );
    })
    .map(([groupKey, groupBooks]) => {
      const firstBook = groupBooks[0];

      return {
        id: `${bookcase.bookcaseId}-${groupKey}`,
        label: firstBook.shelf,
        spines: sortBooksForShelf(groupBooks).map(bookToSpine),
      };
    });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getBookcasesFromBooks(books: Book[]): Bookcase[] {
  const seen = new Map<string, Bookcase>();

  books.forEach((book) => {
    if (!book.bookcase) return;

    const key = `${book.room}|${book.bookcase}`;

    if (!seen.has(key)) {
      seen.set(key, {
        bookcaseId: slugify(key),
        room: book.room,
        bookcase: book.bookcase,
        displayName: book.room
          ? `${book.bookcase} (${book.room})`
          : book.bookcase,
        hasRisers:
          book.room === "Office" && book.bookcase === "Office",
        sortOrder: seen.size + 1,
      });
    }
  });

  return Array.from(seen.values()).sort(
    (a, b) =>
      a.room.localeCompare(b.room) ||
      a.bookcase.localeCompare(b.bookcase)
  );
}

export type SearchScope =
  | "all"
  | "title"
  | "author"
  | "series"
  | "isbn"
  | "genre"
  | "publisher"
  | "bookcase";

export type AuthorNameMode =
  | "last"
  | "first";

export type SearchSortField =
  | "title"
  | "authorLast"
  | "authorFirst";

export type SearchSortDirection =
  | "asc"
  | "desc";

export type SingleLetterMatchMode =
  | "startsWith"
  | "contains";

const LEADING_TITLE_ARTICLE_PATTERN = /^(?:a|an|the)\s+/;

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIsbnSearchText(
  value: unknown
): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^0-9x]+/g, "");
}

function normalizeSearchValueStart(value: string): string {
  return value.replace(/^[^a-z0-9]+/, "");
}

function normalizeTitleForAlphabeticalSearch(title: string): string {
  const normalizedTitle = normalizeSearchValueStart(
    normalizeSearchText(title)
  );

  return normalizedTitle.replace(LEADING_TITLE_ARTICLE_PATTERN, "");
}

function splitAuthorField(value: unknown): string[] {
  return String(value ?? "")
    .split(/\s*[;|]\s*/)
    .map((part) => normalizeSearchText(part))
    .filter(Boolean);
}

function getAuthorSearchValues(
  book: Book,
  authorNameMode: AuthorNameMode
): string[] {
  const authorField =
    authorNameMode === "last" ? book.lastName : book.firstName;

  const authorNames = splitAuthorField(authorField);

  if (authorNames.length > 0) {
    return authorNames;
  }

  const fallbackValues =
    authorNameMode === "last"
      ? splitAuthorField(book.authorSort)
      : splitAuthorField(book.author);

  return fallbackValues.length > 0
    ? fallbackValues
    : [normalizeSearchText(book.author)].filter(Boolean);
}

function getScopedSearchValues(
  book: Book,
  scope: Exclude<SearchScope, "all">,
  authorNameMode: AuthorNameMode
): string[] {
  switch (scope) {
    case "title":
      return [
        normalizeSearchText(book.title),
        normalizeTitleForAlphabeticalSearch(
          book.title
        ),
      ].filter(Boolean);

    case "author":
      return getAuthorSearchValues(
        book,
        authorNameMode
      );

    case "series":
      return [
        book.seriesTitle,
        book.series,
        book.seriesNumber,
      ]
        .map((value) =>
          normalizeSearchText(value)
        )
        .filter(Boolean);

    case "isbn":
      return [
        normalizeSearchText(
          book.isbn
        ),
        normalizeIsbnSearchText(
          book.isbn
        ),
      ].filter(Boolean);

    case "genre":
      return [
        book.genre,
        book.subgenre,
      ]
        .map((value) =>
          normalizeSearchText(value)
        )
        .filter(Boolean);

    case "publisher":
      return [
        book.publisher,
      ]
        .map((value) =>
          normalizeSearchText(value)
        )
        .filter(Boolean);

    case "bookcase":
      return [
        book.bookcase,
        book.room,
      ]
        .map((value) =>
          normalizeSearchText(value)
        )
        .filter(Boolean);
  }
}

function matchesScopedSearch(
  book: Book,
  normalizedQuery: string,
  scope: Exclude<
    SearchScope,
    "all"
  >,
  authorNameMode: AuthorNameMode,
  singleLetterMatchMode:
    SingleLetterMatchMode
): boolean {
  const searchableValues =
    getScopedSearchValues(
      book,
      scope,
      authorNameMode
    );

  if (
    normalizedQuery.length ===
    1
  ) {
    if (
      singleLetterMatchMode ===
      "contains"
    ) {
      return searchableValues.some(
        (value) =>
          value.includes(
            normalizedQuery
          )
      );
    }

    if (
      scope === "title"
    ) {
      return normalizeTitleForAlphabeticalSearch(
        book.title
      ).startsWith(
        normalizedQuery
      );
    }

    return searchableValues.some(
      (value) =>
        normalizeSearchValueStart(
          value
        ).startsWith(
          normalizedQuery
        )
    );
  }

  const queryWords =
    normalizedQuery
      .split(/\s+/)
      .filter(Boolean);

  return queryWords.every(
    (word) =>
      searchableValues.some(
        (value) =>
          value.includes(word)
      )
  );
}

function compareSearchText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function valueMatchesQuery(
  value: string,
  normalizedQuery: string
): boolean {
  if (normalizedQuery.length === 1) {
    return normalizeSearchValueStart(value).startsWith(
      normalizedQuery
    );
  }

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return queryWords.every((word) => value.includes(word));
}

function getMatchingSortValue(
  values: string[],
  normalizedQuery: string
): string {
  const matchingValues = values.filter((value) =>
    valueMatchesQuery(value, normalizedQuery)
  );

  const valuesToSort =
    matchingValues.length > 0
      ? matchingValues
      : values;

  return [...valuesToSort].sort(compareSearchText)[0] ?? "";
}

function getSeriesSortTitle(book: Book): string {
  return normalizeSearchText(
    book.seriesTitle ??
      book.series?.split("|")[0] ??
      ""
  );
}

function normalizeSeriesMediaValue(value: unknown): string {
  return normalizeSearchText(value).replace(
    /\bmanwha\b/g,
    "manhwa"
  );
}

function getSeriesMediaSortValue(book: Book): string {
  const explicitSeriesFormat = normalizeSeriesMediaValue(
    book.seriesFormat
  );

  if (explicitSeriesFormat) {
    return explicitSeriesFormat;
  }

  const rawSeries = String(book.series ?? "");
  const seriesParts = rawSeries.split("|");

  if (seriesParts.length > 1) {
    const formatFromSeries = normalizeSeriesMediaValue(
      seriesParts.slice(1).join("|")
    );

    if (formatFromSeries) {
      return formatFromSeries;
    }
  }

  const titleFormatMatch = book.title.match(
    /\((Light Novel|Manga|Manwha|Manhwa)\)\s*$/i
  );

  return normalizeSeriesMediaValue(
    titleFormatMatch?.[1] ?? ""
  );
}

function compareSeriesNumbers(a: Book, b: Book): number {
  const aSeriesNumber = normalizeSearchText(a.seriesNumber);
  const bSeriesNumber = normalizeSearchText(b.seriesNumber);

  if (!aSeriesNumber && !bSeriesNumber) return 0;
  if (!aSeriesNumber) return 1;
  if (!bSeriesNumber) return -1;

  return compareSearchText(
    aSeriesNumber,
    bSeriesNumber
  );
}

function compareBooksInsideSeries(
  a: Book,
  b: Book
): number {
  const mediaComparison = compareSearchText(
    getSeriesMediaSortValue(a),
    getSeriesMediaSortValue(b)
  );

  if (mediaComparison !== 0) {
    return mediaComparison;
  }

  const volumeComparison = compareSeriesNumbers(a, b);

  if (volumeComparison !== 0) {
    return volumeComparison;
  }

  return compareSearchText(
    normalizeTitleForAlphabeticalSearch(a.title),
    normalizeTitleForAlphabeticalSearch(b.title)
  );
}

function compareBooksWithinSameSeries(
  a: Book,
  b: Book
): number | null {
  const aSeries = getSeriesSortTitle(a);
  const bSeries = getSeriesSortTitle(b);

  if (
    !aSeries ||
    !bSeries ||
    aSeries !== bSeries
  ) {
    return null;
  }

  return compareBooksInsideSeries(a, b);
}

function groupSeriesResultsPreservingOrder(
  books: Book[]
): Book[] {
  const booksBySeries = new Map<string, Book[]>();

  books.forEach((book) => {
    const seriesKey = getSeriesSortTitle(book);

    if (!seriesKey) return;

    const existingBooks =
      booksBySeries.get(seriesKey) ?? [];

    existingBooks.push(book);
    booksBySeries.set(seriesKey, existingBooks);
  });

  const emittedSeries = new Set<string>();
  const groupedResults: Book[] = [];

  books.forEach((book) => {
    const seriesKey = getSeriesSortTitle(book);

    if (!seriesKey) {
      groupedResults.push(book);
      return;
    }

    if (emittedSeries.has(seriesKey)) {
      return;
    }

    emittedSeries.add(seriesKey);

    const seriesBooks =
      booksBySeries.get(seriesKey) ?? [book];

    groupedResults.push(
      ...[...seriesBooks].sort(compareBooksInsideSeries)
    );
  });

  return groupedResults;
}

function compareScopedBooks(
  a: Book,
  b: Book,
  normalizedQuery: string,
  scope: Exclude<SearchScope, "all">,
  authorNameMode: AuthorNameMode
): number {
  let comparison = 0;

  switch (scope) {
    case "title": {
      const seriesComparison =
        compareBooksWithinSameSeries(a, b);

      if (seriesComparison !== null) {
        return seriesComparison;
      }

      comparison = compareSearchText(
        normalizeTitleForAlphabeticalSearch(a.title),
        normalizeTitleForAlphabeticalSearch(b.title)
      );

      break;
    }

    case "author":
      comparison = compareSearchText(
        getMatchingSortValue(
          getAuthorSearchValues(a, authorNameMode),
          normalizedQuery
        ),
        getMatchingSortValue(
          getAuthorSearchValues(b, authorNameMode),
          normalizedQuery
        )
      );

      break;

    case "series": {
      comparison = compareSearchText(
        getSeriesSortTitle(a),
        getSeriesSortTitle(b)
      );

      if (comparison !== 0) {
        return comparison;
      }

      return compareBooksInsideSeries(a, b);
    }

    case "isbn":
    case "genre":
    case "publisher":
    case "bookcase":
      comparison = compareSearchText(
        getMatchingSortValue(
          getScopedSearchValues(
            a,
            scope,
            authorNameMode
          ),
          normalizedQuery
        ),
        getMatchingSortValue(
          getScopedSearchValues(
            b,
            scope,
            authorNameMode
          ),
          normalizedQuery
        )
      );

      break;
  }

  if (comparison !== 0) {
    return comparison;
  }

  const seriesComparison =
    compareBooksWithinSameSeries(a, b);

  if (seriesComparison !== null) {
    return seriesComparison;
  }

  return compareSearchText(
    normalizeTitleForAlphabeticalSearch(a.title),
    normalizeTitleForAlphabeticalSearch(b.title)
  );
}

function getPrimaryAuthorSortValue(
  book: Book,
  authorNameMode:
    AuthorNameMode
): string {
  const directValues =
    authorNameMode === "last"
      ? splitAuthorField(
          book.lastName
        )
      : splitAuthorField(
          book.firstName
        );

  if (
    directValues.length > 0
  ) {
    return directValues[0];
  }

  const fallbackValues =
    authorNameMode === "last"
      ? splitAuthorField(
          book.authorSort
        )
      : splitAuthorField(
          book.author
        );

  return (
    fallbackValues[0] ??
    normalizeSearchText(
      book.author
    )
  );
}

function compareBooksByTitle(
  a: Book,
  b: Book
): number {
  const seriesComparison =
    compareBooksWithinSameSeries(
      a,
      b
    );

  if (
    seriesComparison !== null
  ) {
    return seriesComparison;
  }

  return compareSearchText(
    normalizeTitleForAlphabeticalSearch(
      a.title
    ),
    normalizeTitleForAlphabeticalSearch(
      b.title
    )
  );
}

export function sortBooksForSearchDisplay(
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

export function sortBooksByTitle(
  books: Book[],
  sortDirection:
    SearchSortDirection = "asc"
): Book[] {
  return sortBooksForSearchDisplay(
    books,
    "title",
    sortDirection
  );
}

export function getSearchableBookText(
  book: Book
): string {
  return normalizeSearchText([
    book.title,
    book.author,
    book.authorSort,
    book.series,
    book.seriesTitle,
    book.seriesNumber,
    book.isbn,
    normalizeIsbnSearchText(
      book.isbn
    ),
    book.genre,
    book.subgenre,
    book.publisher,
    book.format,
    book.room,
    book.bookcase,
    book.shelf,
    book.row,
    book.notes,
  ].join(" "));
}

export function searchBooks(
  books: Book[],
  query: string,
  scope: SearchScope = "all",
  authorNameMode:
    AuthorNameMode = "last",
  sortDirection:
    SearchSortDirection = "asc",
  singleLetterMatchMode:
    SingleLetterMatchMode =
      "startsWith"
): Book[] {
  const normalizedQuery =
    normalizeSearchText(
      query
    );

  if (!normalizedQuery) {
    return [];
  }

  if (scope === "all") {
    const queryWords =
      normalizedQuery
        .split(/\s+/)
        .filter(Boolean);

    const matchingBooks =
      books.filter((book) => {
        const searchableText =
          getSearchableBookText(
            book
          );

        return queryWords.every(
          (word) =>
            searchableText.includes(
              word
            )
        );
      });

    return groupSeriesResultsPreservingOrder(
      matchingBooks
    );
  }

  const matchingBooks =
    books.filter((book) =>
      matchesScopedSearch(
        book,
        normalizedQuery,
        scope,
        authorNameMode,
        singleLetterMatchMode
      )
    );

  return matchingBooks.sort(
    (a, b) => {
      const comparison =
        compareScopedBooks(
          a,
          b,
          normalizedQuery,
          scope,
          authorNameMode
        );

      return sortDirection ===
        "asc"
        ? comparison
        : -comparison;
    }
  );
}