import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";

import "./App.css";

import BookcaseView from "./components/BookcaseView";
import HouseholdAccountPanel from "./HouseholdAccountPanel";
import { supabase } from "./supabaseClient";
import {
  buildLibraryStateSeedPreview,
  isLibraryReaderId,
  makeLibraryStateKey,
  type LibraryReaderBookState,
  type LibraryReaderId,
  type LibraryReaderReadingAttempt,
  type LibraryStateLoadStatus,
  type LibraryStateSeedFeedback,
} from "./data/libraryState";
import {
  getBookcasesFromBooks,
  getShelvesForBookcase,
  searchBooks,
} from "./data/librarySelectors";
import type {
  AuthorNameMode,
  SearchScope,
  SearchSortDirection,
} from "./data/librarySelectors";
import type { 
  Book,
  ChallengeData,
  ChallengeEntry, 
  WantedBook, 
  WantedLists, 
} from "./data/libraryTypes";

type AppTab =
  | "search"
  | "wanted"
  | "challenges"
  | "map";

type WantedMode =
  | "toBuy"
  | "seriesToComplete";

type ReadingAttemptFeedback = {
  stateKey: string;
  kind: "success" | "error";
  message: string;
} | null;

const SEARCH_SCOPE_OPTIONS: Array<{
  scope: SearchScope;
  label: string;
}> = [
  { scope: "all", label: "All" },
  { scope: "title", label: "Title" },
  { scope: "author", label: "Author" },
  { scope: "series", label: "Series" },
  { scope: "genre", label: "Genre" },
  { scope: "publisher", label: "Publisher" },
  { scope: "bookcase", label: "Bookcase" },
];

function getSearchPlaceholder(
  searchScope: SearchScope,
  authorNameMode: AuthorNameMode
): string {
  switch (searchScope) {
    case "title":
      return "Search titles...";

    case "author":
      return authorNameMode === "last"
        ? "Search author last names..."
        : "Search author first names...";

    case "series":
      return "Search series...";

    case "genre":
      return "Search genres and subgenres...";

    case "publisher":
      return "Search publishers...";

    case "bookcase":
      return "Search bookcases or rooms...";

    case "all":
    default:
      return "Title, author, genre, publisher, location...";
  }
}

type MapReturnPosition = {
  windowScrollY: number;
  shelfScrollerId?: string;
  shelfScrollLeft?: number;
};

const SEARCH_PAGE_SIZE = 25;

const EMPTY_WANTED_LISTS: WantedLists = {
  toBuy: [],
  seriesToComplete: [],
};

const EMPTY_CHALLENGE_DATA: ChallengeData = {
  schemaVersion: 1,
  sourceWorkbook: "",
  challenges: [],
};

const WANTED_MODE_OPTIONS: Array<{
  mode: WantedMode;
  label: string;
  description: string;
  emptyText: string;
  emptySearchText: string;
}> = [
  {
    mode: "toBuy",
    label: "To Buy",
    description: "Books we definitely want but do not own yet.",
    emptyText: "No to-buy books added yet.",
    emptySearchText: "No to-buy books match that search.",
  },
  {
    mode: "seriesToComplete",
    label: "Series to Complete",
    description: "Missing books from series we have already started collecting.",
    emptyText: "No missing-series books added yet.",
    emptySearchText: "No missing-series books match that search.",
  },
];

function normalizeInlineSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

type AutocompleteSearchScope =
  | "series"
  | "genre"
  | "publisher"
  | "bookcase";

type SearchSuggestion = {
  key: string;
  value: string;
  label: string;
  group: string;
  detail?: string;
};

const SEARCH_SUGGESTION_GROUP_ORDER: Record<string, number> = {
  Series: 0,
  Genres: 0,
  Subgenres: 1,
  Publishers: 0,
  Rooms: 0,
  Bookcases: 1,
};

function supportsSearchAutocomplete(
  scope: SearchScope
): scope is AutocompleteSearchScope {
  return (
    scope === "series" ||
    scope === "genre" ||
    scope === "publisher" ||
    scope === "bookcase"
  );
}

function compareSuggestionText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildSearchSuggestions(
  books: Book[],
  scope: SearchScope
): SearchSuggestion[] {
  if (!supportsSearchAutocomplete(scope)) {
    return [];
  }

  const suggestions = new Map<string, SearchSuggestion>();

  function addSuggestion(
    suggestion: Omit<SearchSuggestion, "key">
  ) {
    const normalizedValue = normalizeInlineSearchText(
      suggestion.value
    );

    if (!normalizedValue) return;

    const key = [
      suggestion.group,
      normalizeInlineSearchText(suggestion.label),
      normalizeInlineSearchText(suggestion.detail),
    ].join("|");

    if (suggestions.has(key)) return;

    suggestions.set(key, {
      ...suggestion,
      key,
    });
  }

  books.forEach((book) => {
    switch (scope) {
      case "series": {
        const series = String(
          book.seriesTitle ??
            book.series?.split("|")[0] ??
            ""
        ).trim();

        if (series) {
          addSuggestion({
            value: series,
            label: series,
            group: "Series",
          });
        }

        break;
      }

      case "genre": {
        const genre = String(book.genre ?? "").trim();
        const subgenre = String(book.subgenre ?? "").trim();

        if (genre) {
          addSuggestion({
            value: genre,
            label: genre,
            group: "Genres",
          });
        }

        if (subgenre) {
          addSuggestion({
            value: subgenre,
            label: subgenre,
            group: "Subgenres",
          });
        }

        break;
      }

      case "publisher": {
        const publisher = String(book.publisher ?? "").trim();

        if (publisher) {
          addSuggestion({
            value: publisher,
            label: publisher,
            group: "Publishers",
          });
        }

        break;
      }

      case "bookcase": {
        const room = String(book.room ?? "").trim();
        const bookcase = String(book.bookcase ?? "").trim();

        if (room) {
          addSuggestion({
            value: room,
            label: room,
            group: "Rooms",
          });
        }

        if (bookcase) {
          addSuggestion({
            value: bookcase,
            label: bookcase,
            group: "Bookcases",
            detail:
              room && room !== bookcase
                ? room
                : undefined,
          });
        }

        break;
      }
    }
  });

  return Array.from(suggestions.values()).sort((a, b) => {
    const groupComparison =
      (SEARCH_SUGGESTION_GROUP_ORDER[a.group] ?? 99) -
      (SEARCH_SUGGESTION_GROUP_ORDER[b.group] ?? 99);

    if (groupComparison !== 0) {
      return groupComparison;
    }

    return (
      compareSuggestionText(a.label, b.label) ||
      compareSuggestionText(
        a.detail ?? "",
        b.detail ?? ""
      )
    );
  });
}

function filterSearchSuggestions(
  suggestions: SearchSuggestion[],
  query: string
): SearchSuggestion[] {
  const normalizedQuery = normalizeInlineSearchText(query);

  if (!normalizedQuery) {
    return suggestions;
  }

  const queryWords = normalizedQuery
    .split(/\s+/)
    .filter(Boolean);

  return suggestions.filter((suggestion) => {
    const searchableText = normalizeInlineSearchText([
      suggestion.label,
      suggestion.value,
      suggestion.detail,
    ].join(" "));

    if (normalizedQuery.length === 1) {
      return searchableText
        .split(/\s+/)
        .some((word) => word.startsWith(normalizedQuery));
    }

    return queryWords.every((word) =>
      searchableText.includes(word)
    );
  });
}

function getWantedSearchText(item: WantedBook): string {
  return normalizeInlineSearchText([
    item.title,
    item.rawTitle,
    item.author,
    item.authorSort,
    item.series,
    item.seriesTitle,
    item.seriesNumber,
  ].join(" "));
}

function filterWantedItems(items: WantedBook[], query: string): WantedBook[] {
  const normalizedQuery = normalizeInlineSearchText(query);

  if (!normalizedQuery) return items;

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return items.filter((item) => {
    const searchableText = getWantedSearchText(item);

    return queryWords.every((word) => searchableText.includes(word));
  });
}

function formatWantedSeriesLabel(item: WantedBook): string {
  const series = item.series || item.seriesTitle;
  const seriesNumber = item.seriesNumber;

  if (!series) return "";

  if (seriesNumber === null || seriesNumber === undefined || seriesNumber === "") {
    return series;
  }

  return `${series} #${seriesNumber}`;
}

async function loadWantedLists(): Promise<WantedLists> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/library-wanted.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return EMPTY_WANTED_LISTS;
    }

    throw new Error(`Failed to load wanted lists: ${response.status}`);
  }

  const parsed = (await response.json()) as Partial<WantedLists>;

  return {
    toBuy: parsed.toBuy ?? [],
    seriesToComplete: parsed.seriesToComplete ?? [],
  };
}

async function loadChallengeData(): Promise<ChallengeData> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}data/library-challenges.json`
  );

  if (!response.ok) {
    if (response.status === 404) {
      return EMPTY_CHALLENGE_DATA;
    }

    throw new Error(
      `Failed to load reading challenges: ${response.status}`
    );
  }

  const parsed = (await response.json()) as Partial<ChallengeData>;

  return {
    schemaVersion: parsed.schemaVersion ?? 1,
    sourceWorkbook: parsed.sourceWorkbook ?? "",
    challenges: parsed.challenges ?? [],
  };
}

function getChallengeEntryPagesRead(
  entry: ChallengeEntry
): number {
  const totalPages = Math.max(entry.totalPages ?? 0, 0);

  if (entry.read && totalPages > 0) {
    return totalPages;
  }

  const currentPage = Math.max(entry.currentPage ?? 0, 0);

  if (totalPages > 0) {
    return Math.min(currentPage, totalPages);
  }

  return currentPage;
}

function getChallengeDisplayStatus(
  isRead: boolean,
  pagesRead: number,
  totalPages: number
): string {
  if (isRead) {
    return "Read";
  }

  if (
    pagesRead > 0 &&
    totalPages > 0
  ) {
    return `${pagesRead} / ${totalPages} pages`;
  }

  if (pagesRead > 0) {
    return `Page ${pagesRead}`;
  }

  if (totalPages > 0) {
    return `${totalPages} pages`;
  }

  return "Not started";
}

function formatReadingAttemptDate(
  value: string
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  ).format(date);
}

async function clearAppCache() {
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );
  }

  window.location.reload();
}

function publicAssetPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;

  const base = import.meta.env.BASE_URL;
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanPath = path.replace(/^\/+/, "");

  return `${cleanBase}${cleanPath}`;
}

const preloadedCoverUrls = new Set<string>();

function preloadCoverImage(path: string | null | undefined) {
  const src = publicAssetPath(path);

  if (!src) return;
  if (preloadedCoverUrls.has(src)) return;

  const img = new Image();
  img.src = src;

  preloadedCoverUrls.add(src);
}

function preloadBookCovers(booksToPreload: Book[]) {
  booksToPreload.forEach((book) => {
    preloadCoverImage(book.coverImage);
  });
}

function formatSearchSeriesLabel(book: Book): string {
  const titleAlreadyShowsVolume = /,\s*Vol\.?\s*\d+/i.test(book.title);

  if (titleAlreadyShowsVolume) {
    return "";
  }

  const series = book.seriesTitle || book.series;

  if (!series) {
    return "";
  }

  const cleanSeries = String(series).split("|")[0];
  const seriesNumber = book.seriesNumber;

  if (seriesNumber === null || seriesNumber === undefined || seriesNumber === "") {
    return cleanSeries;
  }

  return `${cleanSeries} #${seriesNumber}`;
}

function sortBooksForDetailShelf(booksToSort: Book[]): Book[] {
  return [...booksToSort].sort((a, b) => {
    const aPosition = a.shelfPosition;
    const bPosition = b.shelfPosition;

    if (aPosition != null && bPosition != null) {
      return aPosition - bPosition;
    }

    if (aPosition != null) return -1;
    if (bPosition != null) return 1;

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

async function fetchLibraryStateRows(
  userId: string
): Promise<LibraryReaderBookState[]> {
  const { data, error } = await supabase
    .from("library_reader_book_state")
    .select(`
      user_id,
      reader_id,
      catalog_key,
      is_read,
      current_page,
      rating,
      notes,
      created_at,
      updated_at
    `)
    .eq("user_id", userId)
    .order("catalog_key", {
      ascending: true,
    })
    .order("reader_id", {
      ascending: true,
    })
    .overrideTypes<
      LibraryReaderBookState[]
    >();

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchActiveReadingAttempts(
  userId: string
): Promise<LibraryReaderReadingAttempt[]> {
  const { data, error } = await supabase
    .from(
      "library_reader_reading_attempts"
    )
    .select(`
      attempt_id,
      user_id,
      reader_id,
      catalog_key,
      status,
      is_reread,
      current_page,
      started_at,
      completed_at,
      abandoned_at,
      created_at,
      updated_at
    `)
    .eq(
      "user_id",
      userId
    )
    .eq(
      "status",
      "active"
    )
    .order(
      "started_at",
      {
        ascending: false,
      }
    )
    .overrideTypes<
      LibraryReaderReadingAttempt[]
    >();

  if (error) {
    throw error;
  }

  return data ?? [];
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [wantedLists, setWantedLists] = useState<WantedLists>(EMPTY_WANTED_LISTS);
  const [challengeData, setChallengeData] =
    useState<ChallengeData>(EMPTY_CHALLENGE_DATA);

  const [
    householdSession,
    setHouseholdSession,
  ] = useState<Session | null>(null);

  const [
    libraryStateRows,
    setLibraryStateRows,
  ] = useState<LibraryReaderBookState[]>([]);

  const [
    libraryStateLoadStatus,
    setLibraryStateLoadStatus,
  ] = useState<LibraryStateLoadStatus>("idle");

  const [
    libraryStateLoadError,
    setLibraryStateLoadError,
  ] = useState("");

  const [
    isSeedingLibraryState,
    setIsSeedingLibraryState,
  ] = useState(false);

  const [
    libraryStateSeedFeedback,
    setLibraryStateSeedFeedback,
  ] = useState<LibraryStateSeedFeedback>(null);

  const [
    readStatusSavingKey,
    setReadStatusSavingKey,
  ] = useState<string | null>(null);

  const [
    readStatusError,
    setReadStatusError,
  ] = useState("");

  const [
    activeReadingAttempts,
    setActiveReadingAttempts,
  ] = useState<
    LibraryReaderReadingAttempt[]
  >([]);

  const [
    readingAttemptsLoadStatus,
    setReadingAttemptsLoadStatus,
  ] = useState<LibraryStateLoadStatus>(
    "idle"
  );

  const [
    readingAttemptsLoadError,
    setReadingAttemptsLoadError,
  ] = useState("");

  const [
    readingAttemptSavingKey,
    setReadingAttemptSavingKey,
  ] = useState<string | null>(null);

  const [
    readingAttemptFeedback,
    setReadingAttemptFeedback,
  ] = useState<ReadingAttemptFeedback>(
    null
  );

  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [loadError, setLoadError] = useState("");
  const [selectedBookcaseId, setSelectedBookcaseId] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [authorNameMode, setAuthorNameMode] =
    useState<AuthorNameMode>("last");
  const [searchSortDirection, setSearchSortDirection] =
    useState<SearchSortDirection>("asc");
  const [wantedMode, setWantedMode] =
    useState<WantedMode>("seriesToComplete");
  const [wantedQueries, setWantedQueries] = useState<Record<WantedMode, string>>({
    toBuy: "",
    seriesToComplete: "",
  });
  const [selectedChallengeId, setSelectedChallengeId] =
    useState("");
  const [
    selectedChallengeReaderId,
    setSelectedChallengeReaderId,
  ] = useState("");
  const [selectedBookId, setSelectedBookId] =
    useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] =
    useState(false);
  const [
    activeSearchSuggestionIndex,
    setActiveSearchSuggestionIndex,
  ] = useState(-1);
  const mapReturnPositionRef =
    useRef<MapReturnPosition | null>(null);
  const searchAutocompleteRef =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleAutocompletePointerDown(
      event: PointerEvent
    ) {
      const target = event.target;

      if (!(target instanceof Node)) return;

      if (
        searchAutocompleteRef.current?.contains(target)
      ) {
        return;
      }

      setSearchSuggestionsOpen(false);
      setActiveSearchSuggestionIndex(-1);
    }

    document.addEventListener(
      "pointerdown",
      handleAutocompletePointerDown
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleAutocompletePointerDown
      );
    };
  }, []);

  function openMapBookDetail(
    bookId: string,
    mapPosition?: Pick<MapReturnPosition, "shelfScrollerId" | "shelfScrollLeft">
  ) {
    mapReturnPositionRef.current = {
      windowScrollY: window.scrollY,
      shelfScrollerId: mapPosition?.shelfScrollerId,
      shelfScrollLeft: mapPosition?.shelfScrollLeft,
    };

    setSelectedBookId(bookId);
  }

  function backToMapFromDetail() {
    const returnPosition = mapReturnPositionRef.current;

    setSelectedBookId(null);

    window.requestAnimationFrame(() => {
      if (returnPosition?.shelfScrollerId) {
        const shelfScroller = document.getElementById(
          returnPosition.shelfScrollerId
        );

        if (shelfScroller instanceof HTMLElement) {
          shelfScroller.scrollLeft = returnPosition.shelfScrollLeft ?? 0;
        }
      }

      window.scrollTo({
        top: returnPosition?.windowScrollY ?? 0,
        behavior: "auto",
      });
    });
  }

  useEffect(() => {
    async function loadBooks() {
      try {
        const [
          booksResponse,
          loadedWantedLists,
          loadedChallengeData,
        ] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}data/library-books.json`),
          loadWantedLists(),
          loadChallengeData(),
        ]);

        if (!booksResponse.ok) {
          throw new Error(
            `Failed to load library data: ${booksResponse.status}`
          );
        }

        const loadedBooks = (await booksResponse.json()) as Book[];

        setBooks(loadedBooks);
        setWantedLists(loadedWantedLists);
        setChallengeData(loadedChallengeData);
        setLoadStatus("ready");
      } catch (error) {
        setLoadStatus("error");
        setLoadError(
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    }

    loadBooks();
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadLibraryState() {
      if (!householdSession) {
        setLibraryStateRows([]);
        setLibraryStateLoadStatus("idle");
        setLibraryStateLoadError("");
        setLibraryStateSeedFeedback(null);
        setIsSeedingLibraryState(false);
        return;
      }

      setLibraryStateLoadStatus("loading");
      setLibraryStateLoadError("");

      try {
        const loadedRows =
          await fetchLibraryStateRows(
            householdSession.user.id
          );

        if (!isActive) {
          return;
        }

        setLibraryStateRows(loadedRows);
        setLibraryStateLoadStatus("ready");
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error(
          "Could not load shared library state.",
          error
        );

        setLibraryStateRows([]);
        setLibraryStateLoadStatus("error");

        setLibraryStateLoadError(
          error instanceof Error
            ? error.message
            : "Unknown Supabase error"
        );
      }
    }

    void loadLibraryState();

    return () => {
      isActive = false;
    };
  }, [householdSession]);

  useEffect(() => {
    let isActive = true;

    async function loadReadingAttempts() {
      if (!householdSession) {
        setActiveReadingAttempts([]);
        setReadingAttemptsLoadStatus(
          "idle"
        );
        setReadingAttemptsLoadError("");
        setReadingAttemptSavingKey(null);
        setReadingAttemptFeedback(null);

        return;
      }

      setReadingAttemptsLoadStatus(
        "loading"
      );

      setReadingAttemptsLoadError("");

      try {
        const loadedAttempts =
          await fetchActiveReadingAttempts(
            householdSession.user.id
          );

        if (!isActive) {
          return;
        }

        setActiveReadingAttempts(
          loadedAttempts
        );

        setReadingAttemptsLoadStatus(
          "ready"
        );
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error(
          "Could not load active reading attempts.",
          error
        );

        setActiveReadingAttempts([]);

        setReadingAttemptsLoadStatus(
          "error"
        );

        setReadingAttemptsLoadError(
          error instanceof Error
            ? error.message
            : "Unknown Supabase error"
        );
      }
    }

    void loadReadingAttempts();

    return () => {
      isActive = false;
    };
  }, [householdSession]);

  const libraryStateByKey = useMemo(
    () =>
      new Map(
        libraryStateRows.map((stateRow) => [
          makeLibraryStateKey(
            stateRow.reader_id,
            stateRow.catalog_key
          ),
          stateRow,
        ])
      ),
    [libraryStateRows]
  );

  const activeReadingAttemptByKey =
    useMemo(
      () =>
        new Map(
          activeReadingAttempts.map(
            (attempt) => [
              makeLibraryStateKey(
                attempt.reader_id,
                attempt.catalog_key
              ),
              attempt,
            ]
          )
        ),
      [activeReadingAttempts]
    );

  const libraryStateSeedPreview =
    useMemo(() => {
      if (
        !householdSession ||
        loadStatus !== "ready"
      ) {
        return null;
      }

      return buildLibraryStateSeedPreview(
        books,
        challengeData,
        householdSession.user.id
      );
    }, [
      books,
      challengeData,
      householdSession,
      loadStatus,
    ]);

  async function seedLibraryStateFromPreview() {
    if (
      !householdSession ||
      !libraryStateSeedPreview
    ) {
      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          "The household session or seed preview is unavailable.",
      });

      return;
    }

    if (
      libraryStateLoadStatus !== "ready"
    ) {
      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          "Wait for shared library state to finish loading.",
      });

      return;
    }

    if (libraryStateByKey.size > 0) {
      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          "Seed stopped because shared records already exist.",
      });

      return;
    }

    if (
      libraryStateSeedPreview.totalRows === 0
    ) {
      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          "The seed preview contains no records.",
      });

      return;
    }

    if (
      libraryStateSeedPreview
        .skippedMissingCatalogKey > 0
    ) {
      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          "Seed stopped because some records are missing catalog keys.",
      });

      return;
    }

    const expectedRowCount =
      libraryStateSeedPreview.totalRows;

    const confirmed = window.confirm(
      `Seed ${expectedRowCount} shared library records now?\n\n` +
        `This is the one-time import from the workbook and challenge data. ` +
        `Existing database rows will not be overwritten.`
    );

    if (!confirmed) {
      return;
    }

    setIsSeedingLibraryState(true);
    setLibraryStateSeedFeedback(null);

    try {
      const {
        count: existingRowCount,
        error: countError,
      } = await supabase
        .from("library_reader_book_state")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq(
          "user_id",
          householdSession.user.id
        );

      if (countError) {
        throw countError;
      }

      if ((existingRowCount ?? 0) > 0) {
        const existingRows =
          await fetchLibraryStateRows(
            householdSession.user.id
          );

        setLibraryStateRows(existingRows);
        setLibraryStateLoadStatus("ready");

        setLibraryStateSeedFeedback({
          kind: "error",
          message:
            `Seed stopped because the database already contains ` +
            `${existingRows.length} shared records.`,
        });

        return;
      }

      const { error: seedError } =
        await supabase
          .from(
            "library_reader_book_state"
          )
          .upsert(
            libraryStateSeedPreview.rows,
            {
              onConflict:
                "user_id,reader_id,catalog_key",
              ignoreDuplicates: true,
            }
          );

      if (seedError) {
        throw seedError;
      }

      setLibraryStateLoadStatus("loading");

      const refreshedRows =
        await fetchLibraryStateRows(
          householdSession.user.id
        );

      setLibraryStateRows(refreshedRows);
      setLibraryStateLoadStatus("ready");
      setLibraryStateLoadError("");

      if (
        refreshedRows.length !==
        expectedRowCount
      ) {
        setLibraryStateSeedFeedback({
          kind: "error",
          message:
            `Seed request finished, but ${refreshedRows.length} of ` +
            `${expectedRowCount} expected records loaded. ` +
            `Stop here and inspect Supabase before editing anything.`,
        });

        return;
      }

      setLibraryStateSeedFeedback({
        kind: "success",
        message:
          `${refreshedRows.length} shared library records ` +
          `were seeded successfully.`,
      });
    } catch (error) {
      console.error(
        "Could not seed shared library state.",
        error
      );

      setLibraryStateSeedFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? `Seed failed: ${error.message}`
            : "Seed failed because of an unknown Supabase error.",
      });
    } finally {
      setIsSeedingLibraryState(false);
    }
  }

  const bookcases = useMemo(
    () =>
      getBookcasesFromBooks(books),
    [books]
  );

  const rooms = useMemo(
    () => Array.from(new Set(bookcases.map((bookcase) => bookcase.room))).sort(),
    [bookcases]
  );

  useEffect(() => {
    if (!selectedRoom) return;

    const selectedRoomStillExists = rooms.includes(selectedRoom);

    if (!selectedRoomStillExists) {
      setSelectedRoom("");
      setSelectedBookcaseId("");
      setSelectedBookId(null);
    }
  }, [rooms, selectedRoom]);

  const bookcasesForSelectedRoom = useMemo(
    () =>
      bookcases.filter((bookcase) =>
        selectedRoom ? bookcase.room === selectedRoom : true
      ),
    [bookcases, selectedRoom]
  );

  useEffect(() => {
    if (!selectedBookcaseId) return;

    const selectedStillExists = bookcasesForSelectedRoom.some(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    );

    if (!selectedStillExists) {
      setSelectedBookcaseId("");
      setSelectedBookId(null);
    }
  }, [bookcasesForSelectedRoom, selectedBookcaseId]);

  const selectedBookcase =
    bookcasesForSelectedRoom.find(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    ) ?? null;

  const shelves = selectedBookcase
    ? getShelvesForBookcase(books, selectedBookcase)
    : [];

  const autocompleteEnabled =
    supportsSearchAutocomplete(searchScope);

  const searchSuggestions = useMemo(
    () => buildSearchSuggestions(books, searchScope),
    [books, searchScope]
  );

  const filteredSearchSuggestions = useMemo(
    () =>
      filterSearchSuggestions(
        searchSuggestions,
        searchQuery
      ),
    [searchSuggestions, searchQuery]
  );

  const groupedSearchSuggestions = useMemo(() => {
    const groups = new Map<
      string,
      Array<{
        suggestion: SearchSuggestion;
        index: number;
      }>
    >();

    filteredSearchSuggestions.forEach(
      (suggestion, index) => {
        const existingGroup =
          groups.get(suggestion.group) ?? [];

        existingGroup.push({
          suggestion,
          index,
        });

        groups.set(suggestion.group, existingGroup);
      }
    );

    return Array.from(groups.entries());
  }, [filteredSearchSuggestions]);

  useEffect(() => {
    if (!searchSuggestionsOpen) return;

    setActiveSearchSuggestionIndex((currentIndex) => {
      if (filteredSearchSuggestions.length === 0) {
        return -1;
      }

      if (
        currentIndex < 0 ||
        currentIndex >= filteredSearchSuggestions.length
      ) {
        return 0;
      }

      return currentIndex;
    });
  }, [
    filteredSearchSuggestions.length,
    searchSuggestionsOpen,
  ]);

  useEffect(() => {
    if (!searchSuggestionsOpen) return;
    if (activeSearchSuggestionIndex < 0) return;

    document
      .getElementById(
        `library-search-suggestion-${activeSearchSuggestionIndex}`
      )
      ?.scrollIntoView({
        block: "nearest",
      });
  }, [
    activeSearchSuggestionIndex,
    searchSuggestionsOpen,
  ]);

  function selectSearchSuggestion(
    suggestion: SearchSuggestion
  ) {
    setSearchQuery(suggestion.value);
    setSearchPage(1);
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);
  }

  function handleSearchInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (!autocompleteEnabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchSuggestionsOpen(true);

      setActiveSearchSuggestionIndex((currentIndex) => {
        if (filteredSearchSuggestions.length === 0) {
          return -1;
        }

        if (currentIndex < 0) {
          return 0;
        }

        return (
          (currentIndex + 1) %
          filteredSearchSuggestions.length
        );
      });

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchSuggestionsOpen(true);

      setActiveSearchSuggestionIndex((currentIndex) => {
        if (filteredSearchSuggestions.length === 0) {
          return -1;
        }

        if (currentIndex <= 0) {
          return filteredSearchSuggestions.length - 1;
        }

        return currentIndex - 1;
      });

      return;
    }

    if (
      event.key === "Enter" &&
      searchSuggestionsOpen &&
      activeSearchSuggestionIndex >= 0
    ) {
      const activeSuggestion =
        filteredSearchSuggestions[
          activeSearchSuggestionIndex
        ];

      if (activeSuggestion) {
        event.preventDefault();
        selectSearchSuggestion(activeSuggestion);
      }

      return;
    }

    if (event.key === "Escape") {
      setSearchSuggestionsOpen(false);
      setActiveSearchSuggestionIndex(-1);
      return;
    }

    if (event.key === "Tab") {
      setSearchSuggestionsOpen(false);
      setActiveSearchSuggestionIndex(-1);
    }
  }

  const searchResults = useMemo(
    () =>
      searchBooks(
        books,
        searchQuery,
        searchScope,
        authorNameMode,
        searchSortDirection
      ),
    [
      books,
      searchQuery,
      searchScope,
      authorNameMode,
      searchSortDirection,
    ]
  );

  const booksById = useMemo(
    () =>
      new Map(
        books.map((book) => [book.bookId, book])
      ),
    [books]
  );

  const sharedLibraryStateIsAuthoritative =
    householdSession !== null &&
    libraryStateLoadStatus === "ready";

  const sharedReadingAttemptsAreAuthoritative =
    householdSession !== null &&
    readingAttemptsLoadStatus ===
      "ready";

  function getBookReaderIsRead(
    book: Book,
    readerId: "cj" | "jc",
    staticFallback: boolean
  ): boolean {
    const catalogKey =
      book.catalogKey?.trim() ?? "";

    if (
      !sharedLibraryStateIsAuthoritative ||
      !catalogKey
    ) {
      return staticFallback;
    }

    return (
      libraryStateByKey.get(
        makeLibraryStateKey(
          readerId,
          catalogKey
        )
      )?.is_read ?? false
    );
  }

  function getChallengeEntryDisplayState(
    entry: ChallengeEntry,
    readerId: string,
    linkedBook?: Book
  ) {
    const totalPages = Math.max(
      entry.totalPages ?? 0,
      0
    );

    const staticPagesRead =
      getChallengeEntryPagesRead(entry);

    const catalogKey =
      entry.catalogKey?.trim() ||
      linkedBook?.catalogKey?.trim() ||
      "";

    if (
      !sharedLibraryStateIsAuthoritative ||
      !isLibraryReaderId(readerId) ||
      !catalogKey
    ) {
      return {
        isRead: entry.read,
        pagesRead: staticPagesRead,
        totalPages,
      };
    }

    const sharedState =
      libraryStateByKey.get(
        makeLibraryStateKey(
          readerId,
          catalogKey
        )
      );

    const isRead =
      sharedState?.is_read ?? false;

    const currentPage = Math.max(
      sharedState?.current_page ?? 0,
      0
    );

    const pagesRead =
      isRead && totalPages > 0
        ? totalPages
        : totalPages > 0
          ? Math.min(
              currentPage,
              totalPages
            )
          : currentPage;

    return {
      isRead,
      pagesRead,
      totalPages,
    };
  }

  async function updateBookReaderReadStatus(
    book: Book,
    readerId: LibraryReaderId,
    nextIsRead: boolean
  ) {
    const catalogKey =
      book.catalogKey?.trim() ?? "";

    if (
      !householdSession ||
      libraryStateLoadStatus !==
        "ready" ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      setReadStatusError(
        "Household sync and reading activity must finish loading before changing read status."
      );

      return;
    }

    if (!catalogKey) {
      setReadStatusError(
        "This book does not have a catalog key, so its shared state cannot be changed safely."
      );

      return;
    }

    if (
      readStatusSavingKey ||
      readingAttemptSavingKey
    ) {
      return;
    }

    const stateKey =
      makeLibraryStateKey(
        readerId,
        catalogKey
      );

    const existingState =
      libraryStateByKey.get(stateKey);

    const activeAttempt =
      activeReadingAttemptByKey.get(
        stateKey
      );

    if (
      !nextIsRead &&
      activeAttempt?.is_reread
    ) {
      setReadStatusError(
        "Read status stays on while a reread is active. Complete or abandon the reread before clearing it."
      );

      return;
    }

    setReadStatusSavingKey(stateKey);
    setReadStatusError("");

    try {
      if (existingState) {
        const { error } = await supabase
          .from("library_reader_book_state")
          .update({
            is_read: nextIsRead,
          })
          .eq(
            "user_id",
            householdSession.user.id
          )
          .eq(
            "reader_id",
            readerId
          )
          .eq(
            "catalog_key",
            catalogKey
          );

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("library_reader_book_state")
          .insert({
            user_id:
              householdSession.user.id,
            reader_id: readerId,
            catalog_key: catalogKey,
            is_read: nextIsRead,
            current_page: null,
            rating: null,
            notes: null,
          });

        if (error) {
          throw error;
        }
      }

      const refreshedRows =
        await fetchLibraryStateRows(
          householdSession.user.id
        );

      const refreshedState =
        refreshedRows.find(
          (stateRow) =>
            stateRow.reader_id ===
              readerId &&
            stateRow.catalog_key ===
              catalogKey
        );

      if (
        !refreshedState ||
        refreshedState.is_read !==
          nextIsRead
      ) {
        throw new Error(
          "Supabase did not return the expected read status after saving."
        );
      }

      setLibraryStateRows(
        refreshedRows
      );
    } catch (error) {
      console.error(
        "Could not update book read status.",
        error
      );

      setReadStatusError(
        error instanceof Error
          ? `Read status failed to save: ${error.message}`
          : "Read status failed to save because of an unknown Supabase error."
      );
    } finally {
      setReadStatusSavingKey(null);
    }
  }

  async function startBookReadingAttempt(
    book: Book,
    readerId: LibraryReaderId
  ) {
    const catalogKey =
      book.catalogKey?.trim() ?? "";

    const stateKey = catalogKey
      ? makeLibraryStateKey(
          readerId,
          catalogKey
        )
      : "";

    const readerName =
      readerId === "cj"
        ? "CJ"
        : "JC";

    if (
      !householdSession ||
      libraryStateLoadStatus !==
        "ready" ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          "Household sync and reading activity must finish loading before starting a book.",
      });

      return;
    }

    if (!catalogKey) {
      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          "This book does not have a catalog key, so a reading attempt cannot be created safely.",
      });

      return;
    }

    if (
      readStatusSavingKey ||
      readingAttemptSavingKey
    ) {
      return;
    }

    const existingAttempt =
      activeReadingAttemptByKey.get(
        stateKey
      );

    if (existingAttempt) {
      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          `${readerName} already has an active reading attempt for this book.`,
      });

      return;
    }

    setReadingAttemptSavingKey(
      stateKey
    );

    setReadingAttemptFeedback(null);

    try {
      const { error } = await supabase
        .from(
          "library_reader_reading_attempts"
        )
        .insert({
          user_id:
            householdSession.user.id,
          reader_id: readerId,
          catalog_key: catalogKey,
        });

      if (error) {
        throw error;
      }

      const refreshedAttempts =
        await fetchActiveReadingAttempts(
          householdSession.user.id
        );

      const refreshedAttempt =
        refreshedAttempts.find(
          (attempt) =>
            attempt.reader_id ===
              readerId &&
            attempt.catalog_key ===
              catalogKey
        );

      if (!refreshedAttempt) {
        throw new Error(
          "Supabase did not return the newly created reading attempt."
        );
      }

      setActiveReadingAttempts(
        refreshedAttempts
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "success",
        message:
          refreshedAttempt.is_reread
            ? `${readerName}'s reread started.`
            : `${readerName}'s reading attempt started.`,
      });
    } catch (error) {
      console.error(
        "Could not start reading attempt.",
        error
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          error instanceof Error
            ? `Reading attempt failed to start: ${error.message}`
            : "Reading attempt failed to start because of an unknown Supabase error.",
      });
    } finally {
      setReadingAttemptSavingKey(null);
    }
  }

  const activeWantedItems =
    wantedMode === "toBuy" ? wantedLists.toBuy : wantedLists.seriesToComplete;

  const activeWantedQuery = wantedQueries[wantedMode];

  const activeWantedModeOption =
    WANTED_MODE_OPTIONS.find((option) => option.mode === wantedMode) ??
    WANTED_MODE_OPTIONS[0];

  const filteredWantedItems = useMemo(
    () => filterWantedItems(activeWantedItems, activeWantedQuery),
    [activeWantedItems, activeWantedQuery]
  );

  const wantedTotal = wantedLists.toBuy.length + wantedLists.seriesToComplete.length;
  const activeWantedTotal = activeWantedItems.length;
  const filteredWantedTotal = filteredWantedItems.length;

  const activeChallenge =
    challengeData.challenges.find(
      (challenge) =>
        challenge.challengeId === selectedChallengeId
    ) ??
    challengeData.challenges[0] ??
    null;

  const activeChallengeReader =
    activeChallenge?.readers.find(
      (reader) =>
        reader.readerId === selectedChallengeReaderId
    ) ??
    activeChallenge?.readers[0] ??
    null;

  const activeChallengeEntries =
    activeChallengeReader?.entries ?? [];

  const challengeSummary = activeChallengeEntries.reduce(
    (summary, entry) => {
      const linkedBook = entry.bookId
        ? booksById.get(entry.bookId)
        : undefined;

      const {
        isRead,
        pagesRead,
        totalPages,
      } = getChallengeEntryDisplayState(
        entry,
        activeChallengeReader?.readerId ?? "",
        linkedBook
      );

      const inProgress =
        !isRead &&
        pagesRead > 0;

      return {
        completed:
          summary.completed +
          (isRead ? 1 : 0),

        inProgress:
          summary.inProgress +
          (inProgress ? 1 : 0),

        pagesRead:
          summary.pagesRead +
          pagesRead,

        totalPages:
          summary.totalPages +
          totalPages,
      };
    },
    {
      completed: 0,
      inProgress: 0,
      pagesRead: 0,
      totalPages: 0,
    }
  );

  const challengeProgressPercent =
    challengeSummary.totalPages > 0
      ? Math.min(
          100,
          Math.round(
            (challengeSummary.pagesRead /
              challengeSummary.totalPages) *
              100
          )
        )
      : 0;

  const totalSearchPages = Math.max(
    1,
    Math.ceil(searchResults.length / SEARCH_PAGE_SIZE)
  );

  const safeSearchPage = Math.min(searchPage, totalSearchPages);

  const pagedSearchResults = searchResults.slice(
    (safeSearchPage - 1) * SEARCH_PAGE_SIZE,
    safeSearchPage * SEARCH_PAGE_SIZE
  );

  const selectedBook = useMemo(
    () => books.find((book) => book.bookId === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const mapDetailBooks = useMemo(() => {
    if (!selectedBook || !selectedBookcase) return [];

    const matchingShelfBooks = books.filter(
      (book) =>
        book.room === selectedBook.room &&
        book.bookcase === selectedBook.bookcase &&
        book.shelf === selectedBook.shelf &&
        book.row === selectedBook.row
    );

    return sortBooksForDetailShelf(matchingShelfBooks);
  }, [books, selectedBook, selectedBookcase]);

  const mapShelfGroups = useMemo(() => {
    if (!selectedBook || !selectedBookcase) return [];

    const booksForSelectedBookcase = books.filter(
      (book) =>
        book.room === selectedBookcase.room &&
        book.bookcase === selectedBookcase.bookcase
    );

    const groupedBooks = new Map<string, Book[]>();

    booksForSelectedBookcase.forEach((book) => {
      const groupKey = `${book.shelf}|${book.row}`;

      if (!groupedBooks.has(groupKey)) {
        groupedBooks.set(groupKey, []);
      }

      groupedBooks.get(groupKey)?.push(book);
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
          groupKey,
          shelf: firstBook.shelf,
          row: firstBook.row,
          books: sortBooksForDetailShelf(groupBooks),
        };
      });
  }, [books, selectedBook, selectedBookcase]);

  const currentMapShelfIndex = useMemo(() => {
    if (!selectedBook) return -1;

    return mapShelfGroups.findIndex(
      (shelfGroup) =>
        shelfGroup.shelf === selectedBook.shelf &&
        shelfGroup.row === selectedBook.row
    );
  }, [mapShelfGroups, selectedBook]);

  const previousMapShelfBooks =
    currentMapShelfIndex > 0
      ? mapShelfGroups[currentMapShelfIndex - 1].books
      : [];

  const nextMapShelfBooks =
    currentMapShelfIndex >= 0 && currentMapShelfIndex < mapShelfGroups.length - 1
      ? mapShelfGroups[currentMapShelfIndex + 1].books
      : [];  

  useEffect(() => {
    if (activeTab !== "map") return;
    if (!selectedBook) return;
    if (mapDetailBooks.length === 0) return;

    preloadBookCovers(mapDetailBooks);
  }, [activeTab, selectedBook, mapDetailBooks]);

  useEffect(() => {
    setReadStatusError("");
    setReadingAttemptFeedback(null);
  }, [selectedBookId]);

  function renderBookDetail(
    backLabel: string,
    onBack: () => void,
    detailBooks?: Book[],
    previousShelfBooks?: Book[],
    nextShelfBooks?: Book[]
  ) {
    if (!selectedBook) return null;

    const currentDetailIndex =
      detailBooks?.findIndex((book) => book.bookId === selectedBook.bookId) ?? -1;

    const previousBook =
      detailBooks && currentDetailIndex > 0
        ? detailBooks[currentDetailIndex - 1]
        : null;

    const nextBook =
      detailBooks &&
      currentDetailIndex >= 0 &&
      currentDetailIndex < detailBooks.length - 1
        ? detailBooks[currentDetailIndex + 1]
        : null;

    const previousShelfBook =
      previousShelfBooks && previousShelfBooks.length > 0
        ? previousShelfBooks[previousShelfBooks.length - 1]
        : null;

    const nextShelfBook =
      nextShelfBooks && nextShelfBooks.length > 0
        ? nextShelfBooks[0]
        : null;

    const showDetailNav = Boolean(
      detailBooks &&
        (detailBooks.length > 1 || previousShelfBook || nextShelfBook)
    );

    const locationParts = [
      selectedBook.room && selectedBook.room !== selectedBook.bookcase
        ? selectedBook.room
        : "",
      selectedBook.bookcase,
      selectedBook.shelf,
      selectedBook.row !== "Main" ? selectedBook.row : "",
    ].filter(Boolean);

    const selectedBookCjRead =
      getBookReaderIsRead(
        selectedBook,
        "cj",
        Boolean(selectedBook.cj)
      );

    const selectedBookJcRead =
      getBookReaderIsRead(
        selectedBook,
        "jc",
        Boolean(selectedBook.jc)
      );

    const readBy = [
      selectedBookCjRead ? "CJ" : "",
      selectedBookJcRead ? "JC" : "",
    ].filter(Boolean);

    const selectedBookCatalogKey =
      selectedBook.catalogKey?.trim() ?? "";

    const cjReadStatusKey =
      selectedBookCatalogKey
        ? makeLibraryStateKey(
            "cj",
            selectedBookCatalogKey
          )
        : "";

    const jcReadStatusKey =
      selectedBookCatalogKey
        ? makeLibraryStateKey(
            "jc",
            selectedBookCatalogKey
          )
        : "";

    const selectedBookCjAttempt =
      cjReadStatusKey
        ? activeReadingAttemptByKey.get(
            cjReadStatusKey
          )
        : undefined;

    const selectedBookJcAttempt =
      jcReadStatusKey
        ? activeReadingAttemptByKey.get(
            jcReadStatusKey
          )
        : undefined;

    const readStatusCanEdit =
      sharedLibraryStateIsAuthoritative &&
      sharedReadingAttemptsAreAuthoritative &&
      Boolean(selectedBookCatalogKey);

    const readingActivityCanEdit =
      readStatusCanEdit;

    const cjReadStatusLockedForReread =
      Boolean(
        selectedBookCjRead &&
        selectedBookCjAttempt?.is_reread
      );

    const jcReadStatusLockedForReread =
      Boolean(
        selectedBookJcRead &&
        selectedBookJcAttempt?.is_reread
      );

    const selectedBookSeriesName = String(
      selectedBook.seriesTitle ??
        selectedBook.series?.split("|")[0] ??
        ""
    ).trim();

    const selectedBookChallengeMemberships =
      challengeData.challenges.flatMap((challenge) =>
        challenge.readers.flatMap((reader) =>
          reader.entries
            .filter(
              (entry) =>
                entry.bookId === selectedBook.bookId
            )
            .map((entry) => ({
              challenge,
              reader,
              entry,
            }))
        )
      );

    const selectedBookReadingProgress =
      selectedBookChallengeMemberships.filter(
        ({ entry }) =>
          Math.max(entry.totalPages ?? 0, 0) > 0
      );

    return (
      <section className="bookDetailPanel">
        <button type="button" className="backButton" onClick={onBack}>
          ← {backLabel}
        </button>

        {showDetailNav ? (
          <div className="detailNavControls" aria-label="Book detail navigation">
            <button
              type="button"
              className="detailNavButton"
              onClick={() => {
                const targetBook = previousBook ?? previousShelfBook;

                if (targetBook) {
                  setSelectedBookId(targetBook.bookId);
                }
              }}
              disabled={!previousBook && !previousShelfBook}
            >
              {previousBook ? "← Previous" : "← Previous shelf"}
            </button>

            <span className="detailNavCount">
              {selectedBook.shelf}
              {selectedBook.row !== "Main" ? ` · ${selectedBook.row}` : ""} ·{" "}
              {currentDetailIndex + 1} of {detailBooks?.length}
            </span>

            <button
              type="button"
              className="detailNavButton"
              onClick={() => {
                const targetBook = nextBook ?? nextShelfBook;

                if (targetBook) {
                  setSelectedBookId(targetBook.bookId);
                }
              }}
              disabled={!nextBook && !nextShelfBook}
            >
              {nextBook ? "Next →" : "Next shelf →"}
            </button>
          </div>
        ) : null}

        <article className="bookDetailCard">
          <div className="bookDetailHero">
            <div className="bookCoverFrame">
              {selectedBook.coverImage ? (
                <img
                  className="bookCoverImage"
                  src={publicAssetPath(selectedBook.coverImage)}
                  alt={`Cover of ${selectedBook.title}`}
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="bookCoverPlaceholder" aria-hidden="true">
                  <span>Cover coming later</span>
                </div>
              )}
            </div>

            <div className="bookDetailTitleBlock">
              <p className="eyebrow">Book detail</p>
              <h2>{selectedBook.title}</h2>
              <p className="bookDetailAuthor">{selectedBook.author}</p>

              <div className="detailChips" aria-label="Book tags">
                {selectedBook.format ? (
                  <span className="detailChip">
                    {selectedBook.format}
                  </span>
                ) : null}

                {selectedBookSeriesName ? (
                  <span className="detailChip detailSeriesChip">
                    {selectedBookSeriesName}
                  </span>
                ) : null}

                {selectedBook.lgbtq ? (
                  <span className="detailChip">
                    LGBTQ+
                  </span>
                ) : null}

                {selectedBookChallengeMemberships.map(
                  ({ challenge, reader, entry }) => (
                    <span
                      key={`challenge-chip-${entry.entryId}`}
                      className="detailChip detailChallengeChip"
                    >
                      {challenge.name} • {reader.readerName}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>

          <div className="bookDetailSections">
            <section className="detailSection">
              <p className="detailLabel">
                Read status
              </p>

              {readStatusCanEdit ? (
                <>
                  <div
                    className="readStatusList"
                    role="group"
                    aria-label="Change book read status"
                  >
                    <button
                      type="button"
                      className={
                        selectedBookCjRead
                          ? "readStatusChip readStatusButton readStatusButtonActive"
                          : "readStatusChip readStatusButton readStatusButtonInactive"
                      }
                      aria-pressed={
                        selectedBookCjRead
                      }
                      aria-label={
                        cjReadStatusLockedForReread
                          ? "CJ remains marked read during an active reread"
                          : selectedBookCjRead
                            ? "Mark CJ as unread"
                            : "Mark CJ as read"
                      }
                      title={
                        cjReadStatusLockedForReread
                          ? "Read status stays on during an active reread."
                          : undefined
                      }
                      disabled={
                        readStatusSavingKey !==
                          null ||
                        readingAttemptSavingKey !==
                          null ||
                        cjReadStatusLockedForReread
                      }
                      onClick={() => {
                        void updateBookReaderReadStatus(
                          selectedBook,
                          "cj",
                          !selectedBookCjRead
                        );
                      }}
                    >
                      {readStatusSavingKey ===
                      cjReadStatusKey
                        ? "CJ · Saving…"
                        : selectedBookCjRead
                          ? "CJ ✓"
                          : "CJ"}
                    </button>

                    <button
                      type="button"
                      className={
                        selectedBookJcRead
                          ? "readStatusChip readStatusButton readStatusButtonActive"
                          : "readStatusChip readStatusButton readStatusButtonInactive"
                      }
                      aria-pressed={
                        selectedBookJcRead
                      }
                      aria-label={
                        jcReadStatusLockedForReread
                          ? "JC remains marked read during an active reread"
                          : selectedBookJcRead
                            ? "Mark JC as unread"
                            : "Mark JC as read"
                      }
                      title={
                        jcReadStatusLockedForReread
                          ? "Read status stays on during an active reread."
                          : undefined
                      }
                      disabled={
                        readStatusSavingKey !==
                          null ||
                        readingAttemptSavingKey !==
                          null ||
                        jcReadStatusLockedForReread
                      }
                      onClick={() => {
                        void updateBookReaderReadStatus(
                          selectedBook,
                          "jc",
                          !selectedBookJcRead
                        );
                      }}
                    >
                      {readStatusSavingKey ===
                      jcReadStatusKey
                        ? "JC · Saving…"
                        : selectedBookJcRead
                          ? "JC ✓"
                          : "JC"}
                    </button>
                  </div>

                  <p className="readStatusHint">
                    Tap a reader to change their
                    shared read status.
                  </p>
                </>
              ) : readBy.length > 0 ? (
                <div className="readStatusList">
                  {selectedBookCjRead ? (
                    <span className="readStatusChip">
                      CJ ✓
                    </span>
                  ) : null}

                  {selectedBookJcRead ? (
                    <span className="readStatusChip">
                      JC ✓
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="detailMuted">
                  Not marked read yet.
                </p>
              )}

              {readStatusError ? (
                <p
                  className="readStatusError"
                  role="alert"
                >
                  {readStatusError}
                </p>
              ) : null}
            </section>

            {householdSession ? (
              <section className="detailSection">
                <p className="detailLabel">
                  Reading activity
                </p>

                {readingAttemptsLoadStatus ===
                "loading" ? (
                  <p className="detailMuted">
                    Loading active reading
                    attempts…
                  </p>
                ) : readingAttemptsLoadStatus ===
                  "error" ? (
                  <p
                    className="readingAttemptFeedbackError"
                    role="alert"
                  >
                    Could not load reading
                    activity:{" "}
                    {readingAttemptsLoadError}
                  </p>
                ) : readingActivityCanEdit ? (
                  <div className="readingAttemptGrid">
                    {[
                      {
                        readerId: "cj" as const,
                        readerName: "CJ",
                        isRead:
                          selectedBookCjRead,
                        attempt:
                          selectedBookCjAttempt,
                      },
                      {
                        readerId: "jc" as const,
                        readerName: "JC",
                        isRead:
                          selectedBookJcRead,
                        attempt:
                          selectedBookJcAttempt,
                      },
                    ].map(
                      ({
                        readerId,
                        readerName,
                        isRead,
                        attempt,
                      }) => {
                        const stateKey =
                          makeLibraryStateKey(
                            readerId,
                            selectedBookCatalogKey
                          );

                        const isSaving =
                          readingAttemptSavingKey ===
                          stateKey;

                        const feedback =
                          readingAttemptFeedback
                            ?.stateKey ===
                          stateKey
                            ? readingAttemptFeedback
                            : null;

                        return (
                          <article
                            key={readerId}
                            className={
                              attempt
                                ? "readingAttemptCard readingAttemptCardActive"
                                : "readingAttemptCard"
                            }
                          >
                            <div className="readingAttemptCardHeader">
                              <span className="readingAttemptReader">
                                {readerName}
                              </span>

                              <span
                                className={
                                  attempt
                                    ? "readingAttemptBadge readingAttemptBadgeActive"
                                    : "readingAttemptBadge"
                                }
                              >
                                {attempt
                                  ? attempt.is_reread
                                    ? "Rereading"
                                    : "Reading"
                                  : "No active read"}
                              </span>
                            </div>

                            {attempt ? (
                              <>
                                <p className="readingAttemptProgress">
                                  {(
                                    attempt.current_page ??
                                    0
                                  ) > 0
                                    ? `Page ${attempt.current_page?.toLocaleString()}`
                                    : "No page saved yet"}
                                </p>

                                <p className="readingAttemptMeta">
                                  Started{" "}
                                  {formatReadingAttemptDate(
                                    attempt.started_at
                                  )}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="readingAttemptMeta">
                                  {isRead
                                    ? `${readerName} has read this book before.`
                                    : `${readerName} has not marked this book read yet.`}
                                </p>

                                <button
                                  type="button"
                                  className="readingAttemptStartButton"
                                  disabled={
                                    isSaving ||
                                    readStatusSavingKey !==
                                      null ||
                                    readingAttemptSavingKey !==
                                      null
                                  }
                                  onClick={() => {
                                    void startBookReadingAttempt(
                                      selectedBook,
                                      readerId
                                    );
                                  }}
                                >
                                  {isSaving
                                    ? "Starting…"
                                    : isRead
                                      ? "Start reread"
                                      : "Start reading"}
                                </button>
                              </>
                            )}

                            {feedback ? (
                              <p
                                className={
                                  feedback.kind ===
                                  "error"
                                    ? "readingAttemptFeedback readingAttemptFeedbackError"
                                    : "readingAttemptFeedback readingAttemptFeedbackSuccess"
                                }
                                role={
                                  feedback.kind ===
                                  "error"
                                    ? "alert"
                                    : "status"
                                }
                              >
                                {feedback.message}
                              </p>
                            ) : null}
                          </article>
                        );
                      }
                    )}
                  </div>
                ) : (
                  <p className="detailMuted">
                    Reading activity is
                    unavailable for this book.
                  </p>
                )}
              </section>
            ) : null}

            {selectedBookReadingProgress.length > 0 ? (
              <section className="detailSection">
                <p className="detailLabel">
                  Reading progress
                </p>

                <div className="detailChallengeList">
                  {selectedBookReadingProgress.map(
                    ({ challenge, reader, entry }) => {
                      const {
                        isRead,
                        pagesRead,
                        totalPages,
                      } = getChallengeEntryDisplayState(
                        entry,
                        reader.readerId,
                        selectedBook
                      );

                      const progressPercent =
                        totalPages > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (pagesRead /
                                  totalPages) *
                                  100
                              )
                            )
                          : 0;

                      const progressStatus =
                        isRead
                          ? "Complete"
                          : pagesRead > 0
                            ? "In progress"
                            : "Not started";

                      return (
                        <article
                          key={entry.entryId}
                          className="detailChallengeCard"
                        >
                          <div className="detailChallengeHeading">
                            <div>
                              <p className="detailChallengeName">
                                {challenge.name} •{" "}
                                {reader.readerName}
                              </p>

                              <p className="detailChallengeStatus">
                                {progressStatus}
                              </p>
                            </div>

                            <span
                              className="detailChallengeLetter"
                              aria-label={`Challenge letter ${entry.letter}`}
                            >
                              {entry.letter}
                            </span>
                          </div>

                          <div
                            className="challengeProgressTrack detailReadingProgressTrack"
                            role="progressbar"
                            aria-label={`${reader.readerName} reading progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progressPercent}
                            aria-valuetext={`${pagesRead} of ${totalPages} pages read`}
                          >
                            <span
                              className="challengeProgressFill"
                              aria-hidden="true"
                              style={{
                                width: `${progressPercent}%`,
                              }}
                            />

                            <span className="detailReadingProgressPercent">
                              {progressPercent}%
                            </span>
                          </div>

                          <p className="detailReadingProgressFraction">
                            {pagesRead.toLocaleString()} /{" "}
                            {totalPages.toLocaleString()} pages
                          </p>
                        </article>
                      );
                    }
                  )}
                </div>
              </section>
            ) : null}

            <section className="detailSection">
              <p className="detailLabel">Location</p>

              <dl className="detailGrid">
                <div>
                  <dt>Place</dt>
                  <dd>{locationParts.join(" · ")}</dd>
                </div>

                {selectedBook.shelfPosition != null ? (
                  <div>
                    <dt>Position</dt>
                    <dd>{selectedBook.shelfPosition}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="detailSection">
              <p className="detailLabel">
                Book details
              </p>

              <dl className="detailGrid">
                {selectedBook.genre ? (
                  <div>
                    <dt>Genre</dt>
                    <dd>{selectedBook.genre}</dd>
                  </div>
                ) : null}

                {selectedBook.publisher ? (
                  <div>
                    <dt>Publisher</dt>
                    <dd>{selectedBook.publisher}</dd>
                  </div>
                ) : null}

                {selectedBook.format ? (
                  <div>
                    <dt>Format</dt>
                    <dd>{selectedBook.format}</dd>
                  </div>
                ) : null}

                {selectedBookSeriesName ? (
                  <div>
                    <dt>Series</dt>
                    <dd>
                      {selectedBookSeriesName}
                      {selectedBook.seriesNumber != null
                        ? ` #${selectedBook.seriesNumber}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>
        </article>
      </section>
    );
  }
  
  function renderWantedSection(
    title: string,
    items: WantedBook[],
    emptyText: string
  ) {
    return (
      <section className="wantedSection">
        <div className="wantedSectionHeader">
          <h2>{title}</h2>
          <p>
            {items.length === 1 ? "1 book" : `${items.length} books`}
          </p>
        </div>

        {items.length > 0 ? (
          <div className="wantedList">
            {items.map((item) => {
              const wantedSeriesLabel = formatWantedSeriesLabel(item);

              return (
                <article key={item.wantedId} className="wantedCard">
                  <div>
                    <h3>{item.title}</h3>
                    <p className="wantedAuthor">
                      {item.author || "Unknown author"}
                    </p>
                  </div>

                  {wantedSeriesLabel ? (
                    <p className="wantedSeries">{wantedSeriesLabel}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="emptySearch">{emptyText}</p>
        )}
      </section>
    );
  }

  const headerTitle =
    activeTab === "map"
      ? selectedBookcase?.bookcase ?? "Map"
      : activeTab === "wanted"
        ? "Wanted"
        : activeTab === "challenges"
          ? activeChallenge?.name ?? "Challenges"
          : "Search";

  const headerMeta =
    activeTab === "map"
      ? selectedBookcase
        ? selectedBookcase.hasRisers
          ? `${selectedBookcase.bookcase} · Risers`
          : selectedBookcase.room
        : `${bookcases.length} bookcases`
      : activeTab === "wanted"
        ? `${wantedTotal} wanted ${
            wantedTotal === 1 ? "book" : "books"
          }`
        : activeTab === "challenges"
          ? activeChallengeReader
            ? `${activeChallengeReader.readerName} · ${
                activeChallengeEntries.length
              } ${
                activeChallengeEntries.length === 1
                  ? "book"
                  : "books"
              }`
            : `${challengeData.challenges.length} ${
                challengeData.challenges.length === 1
                  ? "challenge"
                  : "challenges"
              }`
          : `${books.length} books loaded`;

  return (
    <main
      className="appShell"
      data-household-auth={
        householdSession
          ? "signed-in"
          : "signed-out"
      }
    >
      <header className="appHeader">
        <div>
          <p className="eyebrow">Library Map</p>
          <h1>{headerTitle}</h1>
          <p className="bookcaseMeta">{headerMeta}</p>
        </div>

        <nav className="appTabs" aria-label="Library views">
          <button
            type="button"
            className={activeTab === "search" ? "appTab active" : "appTab"}
            onClick={() => {
              setActiveTab("search");
              setSelectedBookId(null);
            }}
          >
            Search
          </button>

          <button
            type="button"
            className={activeTab === "map" ? "appTab active" : "appTab"}
            onClick={() => {
              setActiveTab("map");
              setSelectedBookId(null);
            }}
          >
            Map
          </button>

          <button
            type="button"
            className={
              activeTab === "challenges"
                ? "appTab active"
                : "appTab"
            }
            onClick={() => {
              setActiveTab("challenges");
              setSelectedBookId(null);
            }}
          >
            Challenges
          </button>

          <button
            type="button"
            className={activeTab === "wanted" ? "appTab active" : "appTab"}
            onClick={() => {
              setActiveTab("wanted");
              setSelectedBookId(null);
            }}
          >
            Wanted
          </button>
        </nav>

        <div className="headerUtilityRow">
          <HouseholdAccountPanel
            onSessionChange={
              setHouseholdSession
            }
            libraryStateLoadStatus={
              libraryStateLoadStatus
            }
            libraryStateRecordCount={
              libraryStateByKey.size
            }
            libraryStateLoadError={
              libraryStateLoadError
            }
            libraryStateSeedPreview={
              libraryStateSeedPreview
            }
            onSeedLibraryState={
              seedLibraryStateFromPreview
            }
            isSeedingLibraryState={
              isSeedingLibraryState
            }
            libraryStateSeedFeedback={
              libraryStateSeedFeedback
            }
          />

          <button
            type="button"
            className="cacheButton"
            onClick={clearAppCache}
          >
            Clear cache
          </button>
        </div>
      </header>

      {loadStatus === "loading" ? (
        <p className="emptySearch">Loading library data...</p>
      ) : loadStatus === "error" ? (
        <section className="emptyBookcase">
          <h2>Could not load library data</h2>
          <p>{loadError}</p>
        </section>
      ) : activeTab === "search" ? (
        selectedBook ? (
          renderBookDetail("Back to results", () => setSelectedBookId(null))
        ) : (
          <section className="searchPanel">
            <div
              className="searchAutocomplete"
              ref={searchAutocompleteRef}
            >
              <label
                className="librarySearch"
                htmlFor="library-search-input"
              >
                <span>Search books</span>

                <input
                  id="library-search-input"
                  type="search"
                  value={searchQuery}
                  autoComplete="off"
                  role={autocompleteEnabled ? "combobox" : undefined}
                  aria-autocomplete={
                    autocompleteEnabled ? "list" : undefined
                  }
                  aria-haspopup={
                    autocompleteEnabled ? "listbox" : undefined
                  }
                  aria-expanded={
                    autocompleteEnabled
                      ? searchSuggestionsOpen
                      : undefined
                  }
                  aria-controls={
                    autocompleteEnabled
                      ? "library-search-suggestions"
                      : undefined
                  }
                  aria-activedescendant={
                    autocompleteEnabled &&
                    searchSuggestionsOpen &&
                    activeSearchSuggestionIndex >= 0
                      ? `library-search-suggestion-${activeSearchSuggestionIndex}`
                      : undefined
                  }
                  onFocus={() => {
                    if (!autocompleteEnabled) return;

                    setSearchSuggestionsOpen(true);
                    setActiveSearchSuggestionIndex(
                      filteredSearchSuggestions.length > 0
                        ? 0
                        : -1
                    );
                  }}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchPage(1);
                    setSelectedBookId(null);

                    if (autocompleteEnabled) {
                      setSearchSuggestionsOpen(true);
                      setActiveSearchSuggestionIndex(0);
                    } else {
                      setSearchSuggestionsOpen(false);
                      setActiveSearchSuggestionIndex(-1);
                    }
                  }}
                  onKeyDown={handleSearchInputKeyDown}
                  placeholder={getSearchPlaceholder(
                    searchScope,
                    authorNameMode
                  )}
                />
              </label>

              {autocompleteEnabled && searchSuggestionsOpen ? (
                <div
                  id="library-search-suggestions"
                  className="searchAutocompleteMenu"
                  role="listbox"
                  aria-label={`${searchScope} suggestions`}
                >
                  {filteredSearchSuggestions.length > 0 ? (
                    groupedSearchSuggestions.map(
                      ([group, suggestions]) => (
                        <div
                          key={group}
                          className="searchSuggestionGroup"
                          role="group"
                          aria-label={group}
                        >
                          <p className="searchSuggestionGroupLabel">
                            {group}
                          </p>

                          <div className="searchSuggestionOptions">
                            {suggestions.map(
                              ({ suggestion, index }) => (
                                <button
                                  key={suggestion.key}
                                  id={`library-search-suggestion-${index}`}
                                  type="button"
                                  role="option"
                                  aria-selected={
                                    activeSearchSuggestionIndex ===
                                    index
                                  }
                                  className={
                                    activeSearchSuggestionIndex ===
                                    index
                                      ? "searchSuggestionOption searchSuggestionOptionActive"
                                      : "searchSuggestionOption"
                                  }
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                  }}
                                  onMouseEnter={() => {
                                    setActiveSearchSuggestionIndex(
                                      index
                                    );
                                  }}
                                  onClick={() => {
                                    selectSearchSuggestion(
                                      suggestion
                                    );
                                  }}
                                >
                                  <span className="searchSuggestionLabel">
                                    {suggestion.label}
                                  </span>

                                  {suggestion.detail ? (
                                    <span className="searchSuggestionDetail">
                                      {suggestion.detail}
                                    </span>
                                  ) : null}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      )
                    )
                  ) : (
                    <p className="searchAutocompleteEmpty">
                      No matching suggestions. You can still
                      search using the text you entered.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <section
              className="searchScopePanel"
              aria-label="Search settings"
            >
              <div className="searchControlGroup">
                <p className="searchControlLabel">Search in</p>

                <div
                  className="searchScopeOptions"
                  role="group"
                  aria-label="Choose where to search"
                >
                  {SEARCH_SCOPE_OPTIONS.map((option) => (
                    <button
                      key={option.scope}
                      type="button"
                      className={
                        searchScope === option.scope
                          ? "searchScopeButton searchScopeButtonActive"
                          : "searchScopeButton"
                      }
                      aria-pressed={searchScope === option.scope}
                      onClick={() => {
                        setSearchScope(option.scope);
                        setSearchSuggestionsOpen(false);
                        setActiveSearchSuggestionIndex(-1);
                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {searchScope === "author" ? (
                <div className="searchControlGroup authorNameGroup">
                  <p className="searchControlLabel">Author name</p>

                  <div
                    className="authorNameOptions"
                    role="group"
                    aria-label="Choose author name field"
                  >
                    <button
                      type="button"
                      className={
                        authorNameMode === "last"
                          ? "authorNameButton authorNameButtonActive"
                          : "authorNameButton"
                      }
                      aria-pressed={authorNameMode === "last"}
                      onClick={() => {
                        setAuthorNameMode("last");
                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      Last name
                    </button>

                    <button
                      type="button"
                      className={
                        authorNameMode === "first"
                          ? "authorNameButton authorNameButtonActive"
                          : "authorNameButton"
                      }
                      aria-pressed={authorNameMode === "first"}
                      onClick={() => {
                        setAuthorNameMode("first");
                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      First name
                    </button>
                  </div>
                </div>
              ) : null}

              {searchScope !== "all" ? (
                <div className="searchControlGroup sortDirectionGroup">
                  <p className="searchControlLabel">Sort results</p>

                  <div
                    className="searchSortOptions"
                    role="group"
                    aria-label="Choose search result order"
                  >
                    <button
                      type="button"
                      className={
                        searchSortDirection === "asc"
                          ? "searchSortButton searchSortButtonActive"
                          : "searchSortButton"
                      }
                      aria-pressed={searchSortDirection === "asc"}
                      onClick={() => {
                        setSearchSortDirection("asc");
                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      A–Z
                    </button>

                    <button
                      type="button"
                      className={
                        searchSortDirection === "desc"
                          ? "searchSortButton searchSortButtonActive"
                          : "searchSortButton"
                      }
                      aria-pressed={searchSortDirection === "desc"}
                      onClick={() => {
                        setSearchSortDirection("desc");
                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      Z–A
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {searchQuery.trim().length > 0 ? (
              <div className="searchResults">
                <div className="searchResultsHeader">
                  <h2>Search results</h2>
                  <p>
                    {searchResults.length === 1
                      ? "1 book found"
                      : `${searchResults.length} books found`}
                    {searchResults.length > SEARCH_PAGE_SIZE
                      ? ` · Page ${safeSearchPage} of ${totalSearchPages}`
                      : ""}
                  </p>
                </div>

                {searchResults.length > 0 ? (
                  <>
                    <div className="searchResultList">
                      {pagedSearchResults.map((book) => {
                        const searchSeriesLabel = formatSearchSeriesLabel(book);

                        return (
                          <button
                            key={book.bookId}
                            type="button"
                            className="searchResultCard searchResultButton"
                            onClick={() => setSelectedBookId(book.bookId)}
                          >
                            <h3>{book.title}</h3>
                            <p className="searchResultAuthor">{book.author}</p>

                            {searchSeriesLabel ? (
                              <p className="searchResultSeries">{searchSeriesLabel}</p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    {searchResults.length > SEARCH_PAGE_SIZE ? (
                      <div className="paginationControls">
                        <button
                          type="button"
                          onClick={() =>
                            setSearchPage((page) => Math.max(1, page - 1))
                          }
                          disabled={safeSearchPage === 1}
                        >
                          Previous
                        </button>

                        <span>
                          Page {safeSearchPage} of {totalSearchPages}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setSearchPage((page) =>
                              Math.min(totalSearchPages, page + 1)
                            )
                          }
                          disabled={safeSearchPage === totalSearchPages}
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="emptySearch">No books match that search.</p>
                )}
              </div>
            ) : (
              <p className="emptySearch">
                Search by title, author, genre, publisher, or location.
              </p>
            )}
          </section>
        )
      ) : activeTab === "wanted" ? (
        <section className="wantedPanel">
          <section className="wantedIntro">
            <p className="eyebrow">Bookstore lists</p>
            <h2>Wanted books</h2>
            <p>
              Books we definitely want, plus missing volumes from series we have
              already started collecting.
            </p>
          </section>

          <div
            className="wantedModeTabs"
            role="tablist"
            aria-label="Choose wanted list"
          >
            {WANTED_MODE_OPTIONS.map((option) => {
              const listCount =
                option.mode === "toBuy"
                  ? wantedLists.toBuy.length
                  : wantedLists.seriesToComplete.length;

              return (
                <button
                  key={option.mode}
                  type="button"
                  role="tab"
                  aria-selected={wantedMode === option.mode}
                  className={
                    wantedMode === option.mode
                      ? "wantedModeButton wantedModeButtonActive"
                      : "wantedModeButton"
                  }
                  onClick={() => setWantedMode(option.mode)}
                >
                  <span className="wantedModeLabel">{option.label}</span>
                  <span className="wantedModeMeta">
                    {listCount} {listCount === 1 ? "book" : "books"}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="librarySearch wantedSearch">
            <span>Search {activeWantedModeOption.label}</span>
            <input
              type="search"
              value={activeWantedQuery}
              onChange={(event) =>
                setWantedQueries((currentQueries) => ({
                  ...currentQueries,
                  [wantedMode]: event.target.value,
                }))
              }
              placeholder="Title, author, or series..."
            />
          </label>

          <div className="wantedSummary">
            <span>
              {activeWantedTotal} {activeWantedModeOption.label}
            </span>
            {activeWantedQuery.trim() ? (
              <span>{filteredWantedTotal} matching</span>
            ) : null}
          </div>

          <p className="wantedModeDescription">
            {activeWantedModeOption.description}
          </p>

          {renderWantedSection(
            activeWantedModeOption.label,
            filteredWantedItems,
            activeWantedQuery.trim()
              ? activeWantedModeOption.emptySearchText
              : activeWantedModeOption.emptyText
          )}
        </section>
      ) : activeTab === "challenges" ? (
        selectedBook ? (
          renderBookDetail(
            "Back to challenge",
            () => setSelectedBookId(null)
          )
        ) : (
          <section className="challengePanel">
            <section className="challengeIntro">
              <p className="eyebrow">Reading challenges</p>

              <h2>
                {activeChallenge?.name ??
                  "No challenges yet"}
              </h2>

              <p>
                Challenge membership and page totals come from
                the challenge workbook. Read status and current
                progress come from household sync when signed in.
              </p>
            </section>

            {challengeData.challenges.length === 0 ? (
              <section className="emptyBookcase">
                <h2>No reading challenges found</h2>
                <p>
                  Generate library-challenges.json from
                  CHALLENGES.xlsx to add one.
                </p>
              </section>
            ) : (
              <>
                {challengeData.challenges.length > 1 ? (
                  <section className="challengeControls">
                    <p className="detailLabel">
                      Choose a challenge
                    </p>

                    <div
                      className="challengePickerTabs"
                      role="tablist"
                      aria-label="Choose a reading challenge"
                    >
                      {challengeData.challenges.map(
                        (challenge) => (
                          <button
                            key={challenge.challengeId}
                            type="button"
                            role="tab"
                            aria-selected={
                              activeChallenge?.challengeId ===
                              challenge.challengeId
                            }
                            className={
                              activeChallenge?.challengeId ===
                              challenge.challengeId
                                ? "challengePickerButton challengePickerButtonActive"
                                : "challengePickerButton"
                            }
                            onClick={() => {
                              setSelectedChallengeId(
                                challenge.challengeId
                              );

                              setSelectedChallengeReaderId(
                                challenge.readers[0]
                                  ?.readerId ?? ""
                              );

                              setSelectedBookId(null);
                            }}
                          >
                            {challenge.name}
                          </button>
                        )
                      )}
                    </div>
                  </section>
                ) : null}

                {activeChallenge ? (
                  <section className="challengeControls">
                    <p className="detailLabel">
                      Choose a reader
                    </p>

                    <div
                      className="challengeReaderTabs"
                      role="tablist"
                      aria-label="Choose a challenge reader"
                    >
                      {activeChallenge.readers.map(
                        (reader) => (
                          <button
                            key={reader.readerId}
                            type="button"
                            role="tab"
                            aria-selected={
                              activeChallengeReader?.readerId ===
                              reader.readerId
                            }
                            className={
                              activeChallengeReader?.readerId ===
                              reader.readerId
                                ? "challengeReaderButton challengeReaderButtonActive"
                                : "challengeReaderButton"
                            }
                            onClick={() => {
                              setSelectedChallengeReaderId(
                                reader.readerId
                              );

                              setSelectedBookId(null);
                            }}
                          >
                            <span>
                              {reader.readerName}
                            </span>

                            <span className="challengeReaderCount">
                              {reader.entries.length} books
                            </span>
                          </button>
                        )
                      )}
                    </div>
                  </section>
                ) : null}

                {activeChallengeReader ? (
                  <>
                    <section className="challengeSummaryPanel">
                      <div className="challengeSummaryHeader">
                        <div>
                          <p className="eyebrow">
                            {activeChallengeReader.readerName}
                          </p>

                          <h2>
                            {activeChallenge?.name}
                          </h2>
                        </div>

                        <p>
                          {challengeProgressPercent}% by pages
                        </p>
                      </div>

                      <div className="challengeSummaryGrid">
                        <article className="challengeStatCard">
                          <span className="challengeStatValue">
                            {activeChallengeEntries.length}
                          </span>

                          <span className="challengeStatLabel">
                            Books
                          </span>
                        </article>

                        <article className="challengeStatCard">
                          <span className="challengeStatValue">
                            {challengeSummary.completed}
                          </span>

                          <span className="challengeStatLabel">
                            Read
                          </span>
                        </article>

                        <article className="challengeStatCard">
                          <span className="challengeStatValue">
                            {challengeSummary.inProgress}
                          </span>

                          <span className="challengeStatLabel">
                            In progress
                          </span>
                        </article>

                        <article className="challengeStatCard">
                          <span className="challengeStatValue">
                            {challengeSummary.pagesRead.toLocaleString()}
                          </span>

                          <span className="challengeStatLabel">
                            Pages read
                          </span>
                        </article>
                      </div>

                      <div className="challengeOverallProgress">
                        <div
                          className="challengeProgressTrack"
                          aria-hidden="true"
                        >
                          <span
                            className="challengeProgressFill"
                            style={{
                              width: `${challengeProgressPercent}%`,
                            }}
                          />
                        </div>

                        <p>
                          {challengeSummary.pagesRead.toLocaleString()}{" "}
                          of{" "}
                          {challengeSummary.totalPages.toLocaleString()}{" "}
                          pages
                        </p>
                      </div>
                    </section>

                    <section className="challengeListSection">
                      <div className="challengeListHeader">
                        <h2>
                          {activeChallengeReader.readerName}
                          ’s books
                        </h2>

                        <p>
                          Tap a book to open its library details.
                        </p>
                      </div>

                      <div className="challengeEntryGrid">
                        {activeChallengeEntries.map(
                          (entry) => {
                            const linkedBook = entry.bookId
                              ? booksById.get(entry.bookId)
                              : undefined;

                            const challengeSeriesLabel =
                              linkedBook
                                ? formatSearchSeriesLabel(
                                    linkedBook
                                  )
                                : "";

                            const {
                              isRead,
                              pagesRead,
                              totalPages,
                            } = getChallengeEntryDisplayState(
                              entry,
                              activeChallengeReader.readerId,
                              linkedBook
                            );

                            const inProgress =
                              !isRead &&
                              pagesRead > 0;

                            const entryProgressPercent =
                              totalPages > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (pagesRead /
                                        totalPages) *
                                        100
                                    )
                                  )
                                : 0;

                            const cardClassName = [
                              "challengeEntryCard",
                              isRead
                                ? "challengeEntryCardRead"
                                : "",
                              inProgress
                                ? "challengeEntryCardInProgress"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ");

                            return (
                              <button
                                key={entry.entryId}
                                type="button"
                                className={cardClassName}
                                disabled={!linkedBook}
                                onClick={() => {
                                  if (linkedBook) {
                                    setSelectedBookId(
                                      linkedBook.bookId
                                    );
                                  }
                                }}
                                aria-label={
                                  linkedBook
                                    ? `Open ${entry.title} book details`
                                    : `${entry.title} is not linked to a library book`
                                }
                              >
                                <span className="challengeLetter">
                                  {entry.letter}
                                </span>

                                <span className="challengeEntryContent">
                                  <span className="challengeEntryTitleRow">
                                    <span className="challengeEntryTitle">
                                      {entry.title}
                                    </span>

                                    {isRead ? (
                                      <span className="challengeBadge challengeReadBadge">
                                        Read ✓
                                      </span>
                                    ) : null}
                                  </span>

                                  <span className="challengeEntryAuthor">
                                    {entry.author ||
                                      "Unknown author"}
                                  </span>

                                  {challengeSeriesLabel ? (
                                    <span className="challengeEntrySeries">
                                      {challengeSeriesLabel}
                                    </span>
                                  ) : null}

                                  <span className="challengeEntryBadges">
                                    <span className="challengeBadge">
                                      {getChallengeDisplayStatus(
                                        isRead,
                                        pagesRead,
                                        totalPages
                                      )}
                                    </span>

                                    {entry.wildcard ? (
                                      <span className="challengeBadge challengeWildcardBadge">
                                        Wildcard ·{" "}
                                        {entry.naturalTitleLetter}{" "}
                                        title
                                      </span>
                                    ) : null}
                                  </span>

                                  {(pagesRead > 0 ||
                                    isRead) &&
                                  totalPages > 0 ? (
                                    <span className="challengeBookProgress">
                                      <span
                                        className="challengeBookProgressFill"
                                        style={{
                                          width: `${entryProgressPercent}%`,
                                        }}
                                      />
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </section>
                  </>
                ) : (
                  <section className="emptyBookcase">
                    <h2>No reader lists found</h2>
                    <p>
                      This challenge does not have any reader
                      sheets yet.
                    </p>
                  </section>
                )}
              </>
            )}
          </section>
        )
      ) : selectedBook ? (
        renderBookDetail(
          "Back to map",
          backToMapFromDetail,
          mapDetailBooks,
          previousMapShelfBooks,
          nextMapShelfBooks
        )
      ) : (
        <section className="mapPanel">
          <section className="mapChooser" aria-label="Choose a library location">
            <div className="mapChooserSection">
              <p className="detailLabel">Choose a room</p>

              <div className="mapCardGrid">
                {rooms.map((room) => {
                  const roomBookcaseCount = bookcases.filter(
                    (bookcase) => bookcase.room === room
                  ).length;

                  return (
                    <button
                      key={room}
                      type="button"
                      className={
                        room === selectedRoom
                          ? "mapCard mapCardActive"
                          : "mapCard"
                      }
                      onClick={() => {
                        setSelectedRoom(room);
                        setSelectedBookcaseId("");
                        setSelectedBookId(null);
                      }}
                    >
                      <span className="mapCardTitle">{room}</span>
                      <span className="mapCardMeta">
                        {roomBookcaseCount} bookcase
                        {roomBookcaseCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedRoom ? (
              <div className="mapChooserSection">
                <p className="detailLabel">Choose a bookcase</p>

                <div className="mapCardGrid">
                  {bookcasesForSelectedRoom.map((bookcase) => (
                    <button
                      key={bookcase.bookcaseId}
                      type="button"
                      className={
                        bookcase.bookcaseId === selectedBookcaseId
                          ? "mapCard mapCardActive"
                          : "mapCard"
                      }
                      onClick={() => {
                        setSelectedBookcaseId(bookcase.bookcaseId);
                        setSelectedBookId(null);
                      }}
                    >
                      <span className="mapCardTitle">{bookcase.bookcase}</span>
                      {bookcase.hasRisers ? (
                        <span className="mapCardMeta">Risers</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {selectedBookcase && shelves.length > 0 ? (
            <BookcaseView
              title={selectedBookcase.bookcase}
              shelves={shelves}
              onBookSelect={openMapBookDetail}
            />
          ) : selectedBookcase ? (
            <section className="emptyBookcase">
              <h2>{selectedBookcase.bookcase}</h2>
              <p>No books added here yet.</p>
            </section>
          ) : null}
        </section>
      )}
    </main>
  );
}