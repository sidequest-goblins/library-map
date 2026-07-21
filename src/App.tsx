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
  makeLibraryChallengeEntryKey,
  makeLibraryStateKey,
  type LibraryReaderBookState,
  type LibraryReaderChallengeAttemptLink,
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
  | "map"
  | "challenges"
  | "wanted";

const APP_NAV_ITEMS: Array<{
  tab: AppTab;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    tab: "search",
    label: "Search",
    icon: "🔍",
    description: "Find books and open their details.",
  },
  {
    tab: "map",
    label: "Map",
    icon: "🗺️",
    description: "Browse the library by room and shelf.",
  },
  {
    tab: "challenges",
    label: "Challenges",
    icon: "🏆",
    description: "Track challenge books and reading progress.",
  },
  {
    tab: "wanted",
    label: "Wanted",
    icon: "📚",
    description: "View books and series we still need.",
  },
];

type WantedMode =
  | "toBuy"
  | "seriesToComplete";

type ReadingAttemptFeedback = {
  stateKey: string;
  kind: "success" | "error";
  message: string;
} | null;

type ChallengeAttemptAction =
  | "link"
  | "start"
  | "replace";

type ChallengeAttemptActionResult = {
  action_name: string;
  result_link_id: string;
  result_attempt_id: string;
  result_attempt_status:
    | "active"
    | "completed"
    | "abandoned";
  result_is_reread: boolean;
  result_current_page: number | null;
  previous_link_id: string | null;
};

type ChallengeAttemptFeedback =
  | {
      challengeEntryKey: string;
      kind: "success" | "error";
      message: string;
    }
  | null;

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

type BookDetailDisclosureKey =
  | "readingActivity"
  | "challengeProgress"
  | "bookDetails";

type BookDetailDisclosureState = {
  bookId: string | null;
  readingActivity: boolean;
  readingActivityTouched: boolean;
  challengeProgress: boolean;
  bookDetails: boolean;
};

const EMPTY_BOOK_DETAIL_DISCLOSURE_STATE:
  BookDetailDisclosureState = {
    bookId: null,
    readingActivity: false,
    readingActivityTouched: false,
    challengeProgress: false,
    bookDetails: false,
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

function getReadingAttemptStatusLabel(
  attempt: LibraryReaderReadingAttempt
): string {
  switch (attempt.status) {
    case "active":
      return "Active";

    case "completed":
      return "Completed";

    case "abandoned":
      return "Cancelled";
  }
}

function getReadingAttemptDateLabel(
  attempt: LibraryReaderReadingAttempt
): string {
  if (
    attempt.status === "completed" &&
    attempt.completed_at
  ) {
    return `Finished ${formatReadingAttemptDate(
      attempt.completed_at
    )}`;
  }

  if (
    attempt.status === "abandoned" &&
    attempt.abandoned_at
  ) {
    return `Cancelled ${formatReadingAttemptDate(
      attempt.abandoned_at
    )}`;
  }

  return `Started ${formatReadingAttemptDate(
    attempt.started_at
  )}`;
}

async function clearAppCache() {
  if ("serviceWorker" in navigator) {
    const registrations =
      await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) =>
        registration.unregister()
      )
    );
  }

  if ("caches" in window) {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames.map((cacheName) =>
        caches.delete(cacheName)
      )
    );
  }

  const refreshedUrl = new URL(window.location.href);

  refreshedUrl.searchParams.set(
    "_cacheRefresh",
    Date.now().toString()
  );

  window.location.replace(refreshedUrl.toString());
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

async function fetchReadingAttempts(
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

async function fetchChallengeAttemptLinks(
  userId: string
): Promise<
  LibraryReaderChallengeAttemptLink[]
> {
  const { data, error } = await supabase
    .from(
      "library_reader_challenge_attempt_links"
    )
    .select(`
      link_id,
      user_id,
      reader_id,
      challenge_id,
      challenge_entry_id,
      catalog_key,
      attempt_id,
      linked_at,
      unlinked_at,
      created_at,
      updated_at
    `)
    .eq(
      "user_id",
      userId
    )
    .order(
      "linked_at",
      {
        ascending: false,
      }
    )
    .overrideTypes<
      LibraryReaderChallengeAttemptLink[]
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
    readStatusDrafts,
    setReadStatusDrafts,
  ] = useState<Record<string, boolean>>(
    {}
  );

  const [
    bookDetailSaveError,
    setBookDetailSaveError,
  ] = useState("");

  const [
    readingAttempts,
    setReadingAttempts,
  ] = useState<
    LibraryReaderReadingAttempt[]
  >([]);

  const [
    challengeAttemptLinks,
    setChallengeAttemptLinks,
  ] = useState<
    LibraryReaderChallengeAttemptLink[]
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

  const [
    readingAttemptPageDrafts,
    setReadingAttemptPageDrafts,
  ] = useState<Record<string, string>>(
    {}
  );

  const [
    challengeAttemptSavingKey,
    setChallengeAttemptSavingKey,
  ] = useState<string | null>(null);

  const [
    challengeAttemptFeedback,
    setChallengeAttemptFeedback,
  ] = useState<ChallengeAttemptFeedback>(
    null
  );

  const [
    bookDetailDisclosureState,
    setBookDetailDisclosureState,
  ] = useState<BookDetailDisclosureState>(
    EMPTY_BOOK_DETAIL_DISCLOSURE_STATE
  );

  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [loadError, setLoadError] = useState("");
  const [selectedBookcaseId, setSelectedBookcaseId] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [appMenuOpen, setAppMenuOpen] = useState(false);
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

  const appMenuRef =
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

  useEffect(() => {
    if (!appMenuOpen) {
      return;
    }

    function handleAppMenuPointerDown(
      event: PointerEvent
    ) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        appMenuRef.current?.contains(
          target
        )
      ) {
        return;
      }

      setAppMenuOpen(false);
    }

    function handleAppMenuKeyDown(
      event: globalThis.KeyboardEvent
    ) {
      if (event.key === "Escape") {
        setAppMenuOpen(false);
      }
    }

    document.addEventListener(
      "pointerdown",
      handleAppMenuPointerDown
    );

    document.addEventListener(
      "keydown",
      handleAppMenuKeyDown
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleAppMenuPointerDown
      );

      document.removeEventListener(
        "keydown",
        handleAppMenuKeyDown
      );
    };
  }, [appMenuOpen]);

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

    async function loadReadingActivity() {
      if (!householdSession) {
        setReadingAttempts([]);
        setChallengeAttemptLinks([]);

        setReadingAttemptsLoadStatus(
          "idle"
        );

        setReadingAttemptsLoadError("");
        setReadingAttemptSavingKey(null);
        setReadingAttemptFeedback(null);
        setReadingAttemptPageDrafts({});

        return;
      }

      setReadingAttemptsLoadStatus(
        "loading"
      );

      setReadingAttemptsLoadError("");

      try {
        const [
          loadedAttempts,
          loadedChallengeLinks,
        ] = await Promise.all([
          fetchReadingAttempts(
            householdSession.user.id
          ),

          fetchChallengeAttemptLinks(
            householdSession.user.id
          ),
        ]);

        if (!isActive) {
          return;
        }

        setReadingAttempts(
          loadedAttempts
        );

        setChallengeAttemptLinks(
          loadedChallengeLinks
        );

        setReadingAttemptsLoadStatus(
          "ready"
        );
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error(
          "Could not load shared reading activity.",
          error
        );

        setReadingAttempts([]);
        setChallengeAttemptLinks([]);

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

    void loadReadingActivity();

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

  const activeReadingAttempts =
    useMemo(
      () =>
        readingAttempts.filter(
          (attempt) =>
            attempt.status === "active"
        ),
      [readingAttempts]
    );

  const readingAttemptById =
    useMemo(
      () =>
        new Map(
          readingAttempts.map(
            (attempt) => [
              attempt.attempt_id,
              attempt,
            ]
          )
        ),
      [readingAttempts]
    );

  const currentChallengeAttemptLinkByKey =
    useMemo(
      () =>
        new Map(
          challengeAttemptLinks
            .filter(
              (link) =>
                link.unlinked_at === null
            )
            .map(
              (link) => [
                makeLibraryChallengeEntryKey(
                  link.reader_id,
                  link.challenge_id,
                  link.challenge_entry_id
                ),
                link,
              ]
            )
        ),
      [challengeAttemptLinks]
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
    challengeId: string,
    readerId: string
  ) {
    const totalPages = Math.max(
      entry.totalPages ?? 0,
      0
    );

    const workbookFallback = {
      isRead: entry.read,

      pagesRead:
        getChallengeEntryPagesRead(
          entry
        ),

      totalPages,
    };

    if (
      !sharedReadingAttemptsAreAuthoritative ||
      !challengeId ||
      !isLibraryReaderId(readerId)
    ) {
      return workbookFallback;
    }

    const challengeEntryKey =
      makeLibraryChallengeEntryKey(
        readerId,
        challengeId,
        entry.entryId
      );

    const challengeLink =
      currentChallengeAttemptLinkByKey.get(
        challengeEntryKey
      );

    if (!challengeLink) {
      return {
        isRead: false,
        pagesRead: 0,
        totalPages,
      };
    }

    const linkedAttempt =
      readingAttemptById.get(
        challengeLink.attempt_id
      );

    if (!linkedAttempt) {
      console.error(
        "Challenge link references an unavailable reading attempt.",
        {
          challengeEntryId:
            entry.entryId,

          attemptId:
            challengeLink.attempt_id,
        }
      );

      return {
        isRead: false,
        pagesRead: 0,
        totalPages,
      };
    }

    const attemptPage = Math.max(
      linkedAttempt.current_page ?? 0,
      0
    );

    if (
      linkedAttempt.status ===
      "completed"
    ) {
      return {
        isRead: true,

        pagesRead:
          totalPages > 0
            ? totalPages
            : attemptPage,

        totalPages,
      };
    }

    if (
      linkedAttempt.status ===
      "active"
    ) {
      return {
        isRead: false,

        pagesRead:
          totalPages > 0
            ? Math.min(
                attemptPage,
                totalPages
              )
            : attemptPage,

        totalPages,
      };
    }

    return {
      isRead: false,
      pagesRead: 0,
      totalPages,
    };
  }

  async function refreshSharedReadingData(
    userId: string
  ) {
    const [
      refreshedLibraryStateRows,
      refreshedAttempts,
      refreshedChallengeLinks,
    ] = await Promise.all([
      fetchLibraryStateRows(userId),
      fetchReadingAttempts(userId),
      fetchChallengeAttemptLinks(userId),
    ]);

    setLibraryStateRows(
      refreshedLibraryStateRows
    );

    setReadingAttempts(
      refreshedAttempts
    );

    setChallengeAttemptLinks(
      refreshedChallengeLinks
    );

    setLibraryStateLoadError("");
    setReadingAttemptsLoadError("");

    return {
      refreshedLibraryStateRows,
      refreshedAttempts,
      refreshedChallengeLinks,
    };
  }

  async function runChallengeAttemptAction({
    action,
    challengeId,
    challengeEntryId,
    challengeName,
    readerId,
    readerName,
    catalogKey,
    attemptId,
  }: {
    action: ChallengeAttemptAction;
    challengeId: string;
    challengeEntryId: string;
    challengeName: string;
    readerId: LibraryReaderId;
    readerName: string;
    catalogKey: string;
    attemptId?: string;
  }) {
    const challengeEntryKey =
      makeLibraryChallengeEntryKey(
        readerId,
        challengeId,
        challengeEntryId
      );

    if (
      !householdSession ||
      libraryStateLoadStatus !==
        "ready" ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      setChallengeAttemptFeedback({
        challengeEntryKey,
        kind: "error",
        message:
          "Household reading activity must finish loading before changing a challenge link.",
      });

      return;
    }

    if (!catalogKey.trim()) {
      setChallengeAttemptFeedback({
        challengeEntryKey,
        kind: "error",
        message:
          "This book does not have a catalog key, so its challenge activity cannot be changed safely.",
      });

      return;
    }

    if (
      action === "replace" &&
      !attemptId
    ) {
      setChallengeAttemptFeedback({
        challengeEntryKey,
        kind: "error",
        message:
          "The replacement reading attempt is unavailable.",
      });

      return;
    }

    if (
      challengeAttemptSavingKey ||
      readingAttemptSavingKey ||
      readStatusSavingKey
    ) {
      return;
    }

    setChallengeAttemptSavingKey(
      challengeEntryKey
    );

    setChallengeAttemptFeedback(null);

    try {
      const rpcResponse =
        action === "link"
          ? await supabase.rpc(
              "library_link_current_read_to_challenge",
              {
                p_reader_id: readerId,
                p_challenge_id:
                  challengeId,
                p_challenge_entry_id:
                  challengeEntryId,
                p_catalog_key:
                  catalogKey,
              }
            )
          : action === "start"
            ? await supabase.rpc(
                "library_start_reading_for_challenge",
                {
                  p_reader_id:
                    readerId,
                  p_challenge_id:
                    challengeId,
                  p_challenge_entry_id:
                    challengeEntryId,
                  p_catalog_key:
                    catalogKey,
                }
              )
            : await supabase.rpc(
                "library_replace_challenge_attempt_link",
                {
                  p_reader_id:
                    readerId,
                  p_challenge_id:
                    challengeId,
                  p_challenge_entry_id:
                    challengeEntryId,
                  p_catalog_key:
                    catalogKey,
                  p_attempt_id:
                    attemptId as string,
                }
              );

      if (rpcResponse.error) {
        throw rpcResponse.error;
      }

      const actionResult =
        (
          rpcResponse.data as
            | ChallengeAttemptActionResult[]
            | null
        )?.[0];

      if (!actionResult) {
        throw new Error(
          "Supabase did not return the challenge action result."
        );
      }

      const {
        refreshedChallengeLinks,
      } =
        await refreshSharedReadingData(
          householdSession.user.id
        );

      const refreshedCurrentLink =
        refreshedChallengeLinks.find(
          (link) =>
            link.reader_id ===
              readerId &&
            link.challenge_id ===
              challengeId &&
            link.challenge_entry_id ===
              challengeEntryId &&
            link.unlinked_at === null
        );

      if (
        !refreshedCurrentLink ||
        refreshedCurrentLink.attempt_id !==
          actionResult.result_attempt_id
      ) {
        throw new Error(
          "The challenge action finished, but the expected current link did not reload."
        );
      }

      let successMessage: string;

      if (
        actionResult.action_name ===
        "already_linked"
      ) {
        successMessage =
          "This reading attempt is already linked to the challenge.";
      } else if (action === "link") {
        successMessage =
          `${readerName}'s current read now counts for ${challengeName}.`;
      } else if (action === "replace") {
        successMessage =
          `${readerName}'s selected reading attempt now counts for ${challengeName}.`;
      } else {
        successMessage =
          `${readerName}'s challenge read started for ${challengeName}.`;
      }

      setChallengeAttemptFeedback({
        challengeEntryKey,
        kind: "success",
        message: successMessage,
      });
    } catch (error) {
      console.error(
        "Could not update challenge reading activity.",
        error
      );

      setChallengeAttemptFeedback({
        challengeEntryKey,
        kind: "error",
        message:
          error instanceof Error
            ? `Challenge activity failed to save: ${error.message}`
            : "Challenge activity failed to save because of an unknown Supabase error.",
      });
    } finally {
      setChallengeAttemptSavingKey(null);
    }
  }

  function getBookDetailStateKeys(
    book: Book
  ) {
    const catalogKey =
      book.catalogKey?.trim() ?? "";

    return {
      catalogKey,

      cjStateKey: catalogKey
        ? makeLibraryStateKey(
            "cj",
            catalogKey
          )
        : "",

      jcStateKey: catalogKey
        ? makeLibraryStateKey(
            "jc",
            catalogKey
          )
        : "",
    };
  }

  function toggleBookReaderReadStatusDraft({
    stateKey,
    persistedIsRead,
    activeAttempt,
  }: {
    stateKey: string;
    persistedIsRead: boolean;
    activeAttempt:
      | LibraryReaderReadingAttempt
      | undefined;
  }) {
    if (!stateKey) {
      setReadStatusError(
        "This book does not have a catalog key, so its read status cannot be changed safely."
      );

      return;
    }

    const currentIsRead =
      stateKey in readStatusDrafts
        ? readStatusDrafts[stateKey]
        : persistedIsRead;

    const nextIsRead =
      !currentIsRead;

    if (
      !nextIsRead &&
      activeAttempt?.is_reread
    ) {
      setReadStatusError(
        "Read status stays on while a reread is active. Complete or cancel the reread before clearing it."
      );

      return;
    }

    setReadStatusDrafts(
      (currentDrafts) => {
        const nextDrafts = {
          ...currentDrafts,
        };

        if (
          nextIsRead ===
          persistedIsRead
        ) {
          delete nextDrafts[stateKey];
        } else {
          nextDrafts[stateKey] =
            nextIsRead;
        }

        return nextDrafts;
      }
    );

    setReadStatusError("");
    setBookDetailSaveError("");
  }

  function bookHasPendingDetailChanges(
    book: Book
  ): boolean {
    const {
      cjStateKey,
      jcStateKey,
    } =
      getBookDetailStateKeys(book);

    return [
      cjStateKey,
      jcStateKey,
    ].some(
      (stateKey) =>
        Boolean(stateKey) &&
        (
          stateKey in
            readStatusDrafts ||
          stateKey in
            readingAttemptPageDrafts
        )
    );
  }

  function discardBookDetailDrafts(
    book: Book
  ) {
    const {
      cjStateKey,
      jcStateKey,
    } =
      getBookDetailStateKeys(book);

    const detailStateKeys =
      new Set(
        [
          cjStateKey,
          jcStateKey,
        ].filter(Boolean)
      );

    setReadStatusDrafts(
      (currentDrafts) => {
        const nextDrafts = {
          ...currentDrafts,
        };

        detailStateKeys.forEach(
          (stateKey) => {
            delete nextDrafts[
              stateKey
            ];
          }
        );

        return nextDrafts;
      }
    );

    setReadingAttemptPageDrafts(
      (currentDrafts) => {
        const nextDrafts = {
          ...currentDrafts,
        };

        detailStateKeys.forEach(
          (stateKey) => {
            delete nextDrafts[
              stateKey
            ];
          }
        );

        return nextDrafts;
      }
    );

    setReadStatusError("");
    setBookDetailSaveError("");
    setReadingAttemptFeedback(null);
  }

  async function saveBookDetailChanges(
    book: Book,
    onSaved: () => void
  ) {
    const {
      catalogKey,
      cjStateKey,
      jcStateKey,
    } =
      getBookDetailStateKeys(book);

    if (
      !householdSession ||
      libraryStateLoadStatus !==
        "ready" ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      setBookDetailSaveError(
        "Household reading data must finish loading before saving."
      );

      return;
    }

    if (!catalogKey) {
      setBookDetailSaveError(
        "This book does not have a catalog key, so its changes cannot be saved safely."
      );

      return;
    }

    if (
      readStatusSavingKey ||
      readingAttemptSavingKey ||
      challengeAttemptSavingKey
    ) {
      return;
    }

    const readerTargets: Array<{
      readerId: LibraryReaderId;
      stateKey: string;
    }> = [
      {
        readerId: "cj",
        stateKey: cjStateKey,
      },
      {
        readerId: "jc",
        stateKey: jcStateKey,
      },
    ];

    const readChanges: Array<{
      readerId: LibraryReaderId;
      stateKey: string;
      nextIsRead: boolean;
    }> = [];

    for (
      const target of
      readerTargets
    ) {
      if (
        !target.stateKey ||
        !(
          target.stateKey in
          readStatusDrafts
        )
      ) {
        continue;
      }

      const nextIsRead =
        readStatusDrafts[
          target.stateKey
        ];

      const activeAttempt =
        activeReadingAttemptByKey.get(
          target.stateKey
        );

      if (
        !nextIsRead &&
        activeAttempt?.is_reread
      ) {
        setBookDetailSaveError(
          "Read status cannot be cleared while a reread is active."
        );

        return;
      }

      readChanges.push({
        ...target,
        nextIsRead,
      });
    }

    const pageChanges: Array<{
      stateKey: string;
      attempt:
        LibraryReaderReadingAttempt;
      nextCurrentPage:
        | number
        | null;
    }> = [];

    for (
      const target of
      readerTargets
    ) {
      if (
        !target.stateKey ||
        !(
          target.stateKey in
          readingAttemptPageDrafts
        )
      ) {
        continue;
      }

      const attempt =
        activeReadingAttemptByKey.get(
          target.stateKey
        );

      if (!attempt) {
        setBookDetailSaveError(
          "The active reading attempt changed before its page could be saved. Discard the draft and try again."
        );

        return;
      }

      const draftValue =
        readingAttemptPageDrafts[
          target.stateKey
        ].trim();

      let nextCurrentPage:
        | number
        | null = null;

      if (draftValue) {
        const parsedPage =
          Number(draftValue);

        if (
          !Number.isInteger(
            parsedPage
          ) ||
          parsedPage < 0
        ) {
          setBookDetailSaveError(
            "Current page must be a whole number of 0 or greater."
          );

          return;
        }

        nextCurrentPage =
          parsedPage === 0
            ? null
            : parsedPage;
      }

      pageChanges.push({
        stateKey:
          target.stateKey,

        attempt,

        nextCurrentPage,
      });
    }

    if (
      readChanges.length === 0 &&
      pageChanges.length === 0
    ) {
      discardBookDetailDrafts(
        book
      );

      return;
    }

    setReadStatusSavingKey(
      `book-detail:${catalogKey}`
    );

    setBookDetailSaveError("");
    setReadStatusError("");
    setReadingAttemptFeedback(null);

    try {
      let operationError:
        unknown = null;

      try {
        for (
          const change of
          readChanges
        ) {
          const existingState =
            libraryStateByKey.get(
              change.stateKey
            );

          if (existingState) {
            const { error } =
              await supabase
                .from(
                  "library_reader_book_state"
                )
                .update({
                  is_read:
                    change.nextIsRead,
                })
                .eq(
                  "user_id",
                  householdSession
                    .user.id
                )
                .eq(
                  "reader_id",
                  change.readerId
                )
                .eq(
                  "catalog_key",
                  catalogKey
                );

            if (error) {
              throw error;
            }
          } else {
            const { error } =
              await supabase
                .from(
                  "library_reader_book_state"
                )
                .insert({
                  user_id:
                    householdSession
                      .user.id,

                  reader_id:
                    change.readerId,

                  catalog_key:
                    catalogKey,

                  is_read:
                    change.nextIsRead,

                  current_page: null,
                  rating: null,
                  notes: null,
                });

            if (error) {
              throw error;
            }
          }
        }

        for (
          const change of
          pageChanges
        ) {
          if (
            change.attempt
              .current_page ===
            change.nextCurrentPage
          ) {
            continue;
          }

          const { error } =
            await supabase
              .from(
                "library_reader_reading_attempts"
              )
              .update({
                current_page:
                  change.nextCurrentPage,
              })
              .eq(
                "attempt_id",
                change.attempt
                  .attempt_id
              )
              .eq(
                "user_id",
                householdSession
                  .user.id
              )
              .eq(
                "status",
                "active"
              );

          if (error) {
            throw error;
          }
        }
      } catch (error) {
        operationError = error;

        console.error(
          "One or more book detail changes failed to save.",
          error
        );
      }

      let refreshedData: {
        refreshedLibraryStateRows:
          LibraryReaderBookState[];

        refreshedAttempts:
          LibraryReaderReadingAttempt[];

        refreshedChallengeLinks:
          LibraryReaderChallengeAttemptLink[];
      };

      try {
        refreshedData =
          await refreshSharedReadingData(
            householdSession.user.id
          );
      } catch (error) {
        console.error(
          "Could not reload book detail data after saving.",
          error
        );

        setBookDetailSaveError(
          error instanceof Error
            ? `Changes may have partially saved, but the app could not verify them: ${error.message}`
            : "Changes may have partially saved, but the app could not verify them."
        );

        return;
      }

      const refreshedStateByKey =
        new Map(
          refreshedData
            .refreshedLibraryStateRows
            .map(
              (stateRow) => [
                makeLibraryStateKey(
                  stateRow.reader_id,
                  stateRow.catalog_key
                ),
                stateRow,
              ]
            )
        );

      const refreshedAttemptById =
        new Map(
          refreshedData
            .refreshedAttempts
            .map(
              (attempt) => [
                attempt.attempt_id,
                attempt,
              ]
            )
        );

      const failedReadChanges =
        readChanges.filter(
          (change) =>
            refreshedStateByKey.get(
              change.stateKey
            )?.is_read !==
            change.nextIsRead
        );

      const failedPageChanges =
        pageChanges.filter(
          (change) =>
            refreshedAttemptById.get(
              change.attempt
                .attempt_id
            )?.current_page !==
            change.nextCurrentPage
        );

      const savedReadKeys =
        new Set(
          readChanges
            .filter(
              (change) =>
                !failedReadChanges.includes(
                  change
                )
            )
            .map(
              (change) =>
                change.stateKey
            )
        );

      const savedPageKeys =
        new Set(
          pageChanges
            .filter(
              (change) =>
                !failedPageChanges.includes(
                  change
                )
            )
            .map(
              (change) =>
                change.stateKey
            )
        );

      setReadStatusDrafts(
        (currentDrafts) => {
          const nextDrafts = {
            ...currentDrafts,
          };

          savedReadKeys.forEach(
            (stateKey) => {
              delete nextDrafts[
                stateKey
              ];
            }
          );

          return nextDrafts;
        }
      );

      setReadingAttemptPageDrafts(
        (currentDrafts) => {
          const nextDrafts = {
            ...currentDrafts,
          };

          savedPageKeys.forEach(
            (stateKey) => {
              delete nextDrafts[
                stateKey
              ];
            }
          );

          return nextDrafts;
        }
      );

      if (
        failedReadChanges.length >
          0 ||
        failedPageChanges.length >
          0
      ) {
        const operationMessage =
          operationError instanceof Error
            ? ` ${operationError.message}`
            : "";

        setBookDetailSaveError(
          `Some changes did not save. The changes that succeeded were kept; the remaining drafts are still available.${operationMessage}`
        );

        return;
      }

      discardBookDetailDrafts(
        book
      );

      onSaved();
    } finally {
      setReadStatusSavingKey(
        null
      );
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
        await fetchReadingAttempts(
          householdSession.user.id
        );

      const refreshedAttempt =
        refreshedAttempts.find(
          (attempt) =>
            attempt.reader_id ===
              readerId &&
            attempt.catalog_key ===
              catalogKey &&
            attempt.status ===
              "active"
        );

      if (!refreshedAttempt) {
        throw new Error(
          "Supabase did not return the newly created reading attempt."
        );
      }

      setReadingAttempts(
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

  async function completeReadingAttempt(
    attempt: LibraryReaderReadingAttempt
  ) {
    const stateKey =
      makeLibraryStateKey(
        attempt.reader_id,
        attempt.catalog_key
      );

    const readerName =
      attempt.reader_id === "cj"
        ? "CJ"
        : "JC";

    const activityName =
      attempt.is_reread
        ? "reread"
        : "reading attempt";

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
          "Household sync and reading activity must finish loading before completing an attempt.",
      });

      return;
    }

    if (readingAttemptSavingKey) {
      return;
    }

    const confirmed = window.confirm(
      `Finish ${readerName}'s active ${activityName}?\n\n` +
        `This will permanently complete this attempt, mark the book Read, ` +
        `and complete any challenge entries linked to this exact attempt.`
    );

    if (!confirmed) {
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
        .update({
          status: "completed",
        })
        .eq(
          "attempt_id",
          attempt.attempt_id
        )
        .eq(
          "user_id",
          householdSession.user.id
        )
        .eq(
          "status",
          "active"
        );

      if (error) {
        throw error;
      }

      const [
        refreshedAttempts,
        refreshedLibraryStateRows,
      ] = await Promise.all([
        fetchReadingAttempts(
          householdSession.user.id
        ),

        fetchLibraryStateRows(
          householdSession.user.id
        ),
      ]);

      const refreshedAttempt =
        refreshedAttempts.find(
          (candidate) =>
            candidate.attempt_id ===
            attempt.attempt_id
        );

      if (
        !refreshedAttempt ||
        refreshedAttempt.status !==
          "completed"
      ) {
        throw new Error(
          "Supabase did not return the completed reading attempt."
        );
      }

      const refreshedBookState =
        refreshedLibraryStateRows.find(
          (stateRow) =>
            stateRow.reader_id ===
              attempt.reader_id &&
            stateRow.catalog_key ===
              attempt.catalog_key
        );

      if (
        !refreshedBookState ||
        !refreshedBookState.is_read
      ) {
        throw new Error(
          "The attempt completed, but the book did not return as Read."
        );
      }

      setReadingAttempts(
        refreshedAttempts
      );

      setLibraryStateRows(
        refreshedLibraryStateRows
      );

      setReadingAttemptPageDrafts(
        (currentDrafts) => {
          const nextDrafts = {
            ...currentDrafts,
          };

          delete nextDrafts[stateKey];

          return nextDrafts;
        }
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "success",
        message:
          attempt.is_reread
            ? `${readerName}'s reread is complete.`
            : `${readerName}'s reading attempt is complete, and the book is marked Read.`,
      });
    } catch (error) {
      console.error(
        "Could not complete reading attempt.",
        error
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          error instanceof Error
            ? `Reading attempt failed to finish: ${error.message}`
            : "Reading attempt failed to finish because of an unknown Supabase error.",
      });
    } finally {
      setReadingAttemptSavingKey(null);
    }
  }

  async function abandonReadingAttempt(
    attempt: LibraryReaderReadingAttempt
  ) {
    const stateKey =
      makeLibraryStateKey(
        attempt.reader_id,
        attempt.catalog_key
      );

    const readerName =
      attempt.reader_id === "cj"
        ? "CJ"
        : "JC";

    const activityName =
      attempt.is_reread
        ? "reread"
        : "reading attempt";

    if (
      !householdSession ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          "Reading activity must finish loading before cancelling an attempt.",
      });

      return;
    }

    if (readingAttemptSavingKey) {
      return;
    }

    const confirmed = window.confirm(
      `Cancel ${readerName}'s active ${activityName}?\n\n` +
        `Its history will be preserved, but it will no longer appear as active.`
    );

    if (!confirmed) {
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
        .update({
          status: "abandoned",
        })
        .eq(
          "attempt_id",
          attempt.attempt_id
        )
        .eq(
          "user_id",
          householdSession.user.id
        )
        .eq(
          "status",
          "active"
        );

      if (error) {
        throw error;
      }

      const refreshedAttempts =
        await fetchReadingAttempts(
          householdSession.user.id
        );

      const attemptStillActive =
        refreshedAttempts.some(
          (candidate) =>
            candidate.attempt_id ===
              attempt.attempt_id &&
            candidate.status ===
              "active"
        );

      if (attemptStillActive) {
        throw new Error(
          "The reading attempt still appears active after cancellation."
        );
      }

      setReadingAttempts(
        refreshedAttempts
      );

      setReadingAttemptPageDrafts(
        (currentDrafts) => {
          const nextDrafts = {
            ...currentDrafts,
          };

          delete nextDrafts[stateKey];

          return nextDrafts;
        }
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "success",
        message:
          attempt.is_reread
            ? `${readerName}'s reread was cancelled. The book remains marked read.`
            : `${readerName}'s reading attempt was cancelled.`,
      });
    } catch (error) {
      console.error(
        "Could not cancel reading attempt.",
        error
      );

      setReadingAttemptFeedback({
        stateKey,
        kind: "error",
        message:
          error instanceof Error
            ? `Reading attempt failed to cancel: ${error.message}`
            : "Reading attempt failed to cancel because of an unknown Supabase error.",
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
      const {
        isRead,
        pagesRead,
        totalPages,
      } =
        getChallengeEntryDisplayState(
          entry,
          activeChallenge?.challengeId ??
            "",
          activeChallengeReader?.readerId ??
            ""
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

  const selectedBookHasPendingChanges =
    selectedBook
      ? bookHasPendingDetailChanges(
          selectedBook
        )
      : false;

  useEffect(() => {
    if (
      !selectedBookHasPendingChanges
    ) {
      return;
    }

    function handleBeforeUnload(
      event: BeforeUnloadEvent
    ) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
    };
  }, [
    selectedBookHasPendingChanges,
  ]);

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
    if (!selectedBook) {
      setBookDetailDisclosureState(
        (currentState) =>
          currentState.bookId === null
            ? currentState
            : EMPTY_BOOK_DETAIL_DISCLOSURE_STATE
      );

      return;
    }

    const selectedCatalogKey =
      selectedBook.catalogKey?.trim() ?? "";

    const hasActiveReadingAttempt =
      Boolean(
        selectedCatalogKey &&
          (
            activeReadingAttemptByKey.has(
              makeLibraryStateKey(
                "cj",
                selectedCatalogKey
              )
            ) ||
            activeReadingAttemptByKey.has(
              makeLibraryStateKey(
                "jc",
                selectedCatalogKey
              )
            )
          )
      );

    setBookDetailDisclosureState(
      (currentState) => {
        if (
          currentState.bookId ===
          selectedBook.bookId
        ) {
          return currentState;
        }

        return {
          bookId: selectedBook.bookId,

          readingActivity:
            hasActiveReadingAttempt,

          readingActivityTouched:
            false,

          challengeProgress:
            activeTab === "challenges",

          bookDetails: false,
        };
      }
    );
  }, [
    activeReadingAttemptByKey,
    activeTab,
    selectedBook,
  ]);

  useEffect(() => {
    if (
      !selectedBook ||
      readingAttemptsLoadStatus !==
        "ready"
    ) {
      return;
    }

    const selectedCatalogKey =
      selectedBook.catalogKey?.trim() ?? "";

    const hasActiveReadingAttempt =
      Boolean(
        selectedCatalogKey &&
          (
            activeReadingAttemptByKey.has(
              makeLibraryStateKey(
                "cj",
                selectedCatalogKey
              )
            ) ||
            activeReadingAttemptByKey.has(
              makeLibraryStateKey(
                "jc",
                selectedCatalogKey
              )
            )
          )
      );

    if (!hasActiveReadingAttempt) {
      return;
    }

    setBookDetailDisclosureState(
      (currentState) => {
        if (
          currentState.bookId !==
            selectedBook.bookId ||
          currentState
            .readingActivityTouched ||
          currentState.readingActivity
        ) {
          return currentState;
        }

        return {
          ...currentState,
          readingActivity: true,
        };
      }
    );
  }, [
    activeReadingAttemptByKey,
    readingAttemptsLoadStatus,
    selectedBook,
  ]);

  useEffect(() => {
    setReadStatusError("");
    setBookDetailSaveError("");
    setReadingAttemptFeedback(null);
    setChallengeAttemptFeedback(null);
    setReadStatusDrafts({});
    setReadingAttemptPageDrafts({});
  }, [selectedBookId]);

  function runAfterBookDetailDiscardCheck(
    action: () => void
  ) {
    if (
      selectedBook &&
      selectedBookHasPendingChanges
    ) {
      const confirmed =
        window.confirm(
          "Discard the unsaved changes for this book?"
        );

      if (!confirmed) {
        return;
      }

      discardBookDetailDrafts(
        selectedBook
      );
    }

    action();
  }

  function selectAppTab(
    nextTab: AppTab
  ) {
    if (nextTab === activeTab) {
      setAppMenuOpen(false);
      return;
    }

    runAfterBookDetailDiscardCheck(
      () => {
        setActiveTab(nextTab);
        setSelectedBookId(null);
        setSearchSuggestionsOpen(false);
        setActiveSearchSuggestionIndex(-1);
        setAppMenuOpen(false);

        window.scrollTo({
          top: 0,
          behavior: "auto",
        });
      }
    );
  }

  function toggleBookDetailDisclosure(
    section: BookDetailDisclosureKey
  ) {
    setBookDetailDisclosureState(
      (currentState) => {
        if (
          currentState.bookId !==
          selectedBookId
        ) {
          return currentState;
        }

        switch (section) {
          case "readingActivity":
            return {
              ...currentState,

              readingActivity:
                !currentState
                  .readingActivity,

              readingActivityTouched:
                true,
            };

          case "challengeProgress":
            return {
              ...currentState,

              challengeProgress:
                !currentState
                  .challengeProgress,
            };

          case "bookDetails":
            return {
              ...currentState,

              bookDetails:
                !currentState.bookDetails,
            };
        }
      }
    );
  }

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

    const persistedSelectedBookCjRead =
      getBookReaderIsRead(
        selectedBook,
        "cj",
        Boolean(selectedBook.cj)
      );

    const persistedSelectedBookJcRead =
      getBookReaderIsRead(
        selectedBook,
        "jc",
        Boolean(selectedBook.jc)
      );

    const selectedBookCjRead =
      cjReadStatusKey in
      readStatusDrafts
        ? readStatusDrafts[
            cjReadStatusKey
          ]
        : persistedSelectedBookCjRead;

    const selectedBookJcRead =
      jcReadStatusKey in
      readStatusDrafts
        ? readStatusDrafts[
            jcReadStatusKey
          ]
        : persistedSelectedBookJcRead;

    const cjReadStatusHasChanges =
      Boolean(
        cjReadStatusKey &&
          cjReadStatusKey in
            readStatusDrafts
      );

    const jcReadStatusHasChanges =
      Boolean(
        jcReadStatusKey &&
          jcReadStatusKey in
            readStatusDrafts
      );

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

    const selectedBookPageHasChanges =
      [
        cjReadStatusKey,
        jcReadStatusKey,
      ].some(
        (stateKey) =>
          Boolean(stateKey) &&
          stateKey in
            readingAttemptPageDrafts
      );

    const bookDetailHasChanges =
      cjReadStatusHasChanges ||
      jcReadStatusHasChanges ||
      selectedBookPageHasChanges;

    const bookDetailIsSaving =
      readStatusSavingKey !== null;

    const readBy = [
      selectedBookCjRead
        ? "CJ"
        : "",

      selectedBookJcRead
        ? "JC"
        : "",
    ].filter(Boolean);

    const readStatusCanEdit =
      sharedLibraryStateIsAuthoritative &&
      sharedReadingAttemptsAreAuthoritative &&
      Boolean(
        selectedBookCatalogKey
      );

    const readingActivityCanEdit =
      readStatusCanEdit;

    const cjReadStatusLockedForReread =
      Boolean(
        selectedBookCjRead &&
        selectedBookCjAttempt
          ?.is_reread
      );

    const jcReadStatusLockedForReread =
      Boolean(
        selectedBookJcRead &&
        selectedBookJcAttempt
          ?.is_reread
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

    const selectedBookChallengeDetails =
      selectedBookChallengeMemberships;

    return (
      <section className="bookDetailPanel">
        <button
          type="button"
          className="backButton"
          onClick={() => {
            runAfterBookDetailDiscardCheck(
              onBack
            );
          }}
        >
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
                  runAfterBookDetailDiscardCheck(
                    () => {
                      setSelectedBookId(
                        targetBook.bookId
                      );
                    }
                  );
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
                  runAfterBookDetailDiscardCheck(
                    () => {
                      setSelectedBookId(
                        targetBook.bookId
                      );
                    }
                  );
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
                      className={[
                        "readStatusChip",
                        "readStatusButton",

                        selectedBookCjRead
                          ? "readStatusButtonActive"
                          : "readStatusButtonInactive",

                        cjReadStatusHasChanges
                          ? "readStatusButtonPending"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
                          : cjReadStatusHasChanges
                            ? "Unsaved change"
                            : undefined
                      }
                      disabled={
                        bookDetailIsSaving ||
                        readingAttemptSavingKey !==
                          null ||
                        cjReadStatusLockedForReread
                      }
                      onClick={() => {
                        toggleBookReaderReadStatusDraft(
                          {
                            stateKey:
                              cjReadStatusKey,

                            persistedIsRead:
                              persistedSelectedBookCjRead,

                            activeAttempt:
                              selectedBookCjAttempt,
                          }
                        );
                      }}
                    >
                      {selectedBookCjRead
                        ? "CJ ✓"
                        : "CJ"}
                    </button>

                    <button
                      type="button"
                      className={[
                        "readStatusChip",
                        "readStatusButton",

                        selectedBookJcRead
                          ? "readStatusButtonActive"
                          : "readStatusButtonInactive",

                        jcReadStatusHasChanges
                          ? "readStatusButtonPending"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
                          : jcReadStatusHasChanges
                            ? "Unsaved change"
                            : undefined
                      }
                      disabled={
                        bookDetailIsSaving ||
                        readingAttemptSavingKey !==
                          null ||
                        jcReadStatusLockedForReread
                      }
                      onClick={() => {
                        toggleBookReaderReadStatusDraft(
                          {
                            stateKey:
                              jcReadStatusKey,

                            persistedIsRead:
                              persistedSelectedBookJcRead,

                            activeAttempt:
                              selectedBookJcAttempt,
                          }
                        );
                      }}
                    >
                      {selectedBookJcRead
                        ? "JC ✓"
                        : "JC"}
                    </button>
                  </div>

                  <p className="readStatusHint">
                    Tap a reader to change
                    their status, then use
                    Save below.
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

            {householdSession ? (
              <details
                className="detailSection detailDisclosureSection"
                open={
                  bookDetailDisclosureState
                    .readingActivity
                }
              >
                <summary
                  className="detailDisclosureSummary"
                  onClick={(event) => {
                    event.preventDefault();

                    toggleBookDetailDisclosure(
                      "readingActivity"
                    );
                  }}
                >
                  <span className="detailLabel">
                    Reading activity
                  </span>

                  <span
                    className={
                      bookDetailDisclosureState
                        .readingActivity
                        ? "detailDisclosureChevron detailDisclosureChevronOpen"
                        : "detailDisclosureChevron"
                    }
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </summary>

                <div className="detailDisclosureContent">

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

                        const storedPageValue =
                          attempt?.current_page
                            ? String(
                                attempt.current_page
                              )
                            : "";

                        const pageDraftValue =
                          stateKey in
                          readingAttemptPageDrafts
                            ? readingAttemptPageDrafts[
                                stateKey
                              ]
                            : storedPageValue;

                        const pageDraftHasChanges =
                          stateKey in
                          readingAttemptPageDrafts;

                        const feedback =
                          readingAttemptFeedback
                            ?.stateKey ===
                          stateKey
                            ? readingAttemptFeedback
                            : null;

                        return (
                          <article
                            key={readerId}
                            className={[
                              "readingAttemptCard",

                              attempt
                                ? "readingAttemptCardActive"
                                : "",

                              pageDraftHasChanges
                                ? "readingAttemptCardPending"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
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

                                <div className="readingAttemptPageEditor">
                                  <label className="readingAttemptPageField">
                                    <span>
                                      Current page
                                    </span>

                                    <input
                                      className={
                                        pageDraftHasChanges
                                          ? "readingAttemptPageInputPending"
                                          : undefined
                                      }
                                      type="number"
                                      min={0}
                                      step={1}
                                      inputMode="numeric"
                                      value={
                                        pageDraftValue
                                      }
                                      disabled={
                                        isSaving ||
                                        bookDetailIsSaving
                                      }
                                      onChange={(
                                        event
                                      ) => {
                                        const nextValue =
                                          event.target
                                            .value;

                                        setReadingAttemptPageDrafts(
                                          (
                                            currentDrafts
                                          ) => {
                                            const nextDrafts =
                                              {
                                                ...currentDrafts,
                                              };

                                            if (
                                              nextValue.trim() ===
                                              storedPageValue
                                            ) {
                                              delete nextDrafts[
                                                stateKey
                                              ];
                                            } else {
                                              nextDrafts[
                                                stateKey
                                              ] =
                                                nextValue;
                                            }

                                            return nextDrafts;
                                          }
                                        );

                                        setBookDetailSaveError(
                                          ""
                                        );

                                        if (
                                          readingAttemptFeedback
                                            ?.stateKey ===
                                          stateKey
                                        ) {
                                          setReadingAttemptFeedback(
                                            null
                                          );
                                        }
                                      }}
                                    />
                                  </label>
                                </div>

                                <p className="readingAttemptPageHint">
                                  {pageDraftHasChanges
                                    ? "Unsaved page change · use Save below."
                                    : "Enter 0 or clear the field to reset progress."}
                                </p>

                                <div className="readingAttemptActionRow">
                                  <button
                                    type="button"
                                    className="readingAttemptFinishButton"
                                    disabled={
                                      isSaving ||
                                      bookDetailIsSaving ||
                                      bookDetailHasChanges
                                    }
                                    onClick={() => {
                                      void completeReadingAttempt(
                                        attempt
                                      );
                                    }}
                                  >
                                    {isSaving
                                      ? "Working…"
                                      : attempt.is_reread
                                        ? "Finish reread"
                                        : "Finish reading"}
                                  </button>

                                  <button
                                    type="button"
                                    className="readingAttemptCancelButton"
                                    disabled={
                                      isSaving ||
                                      bookDetailIsSaving ||
                                      bookDetailHasChanges
                                    }
                                    onClick={() => {
                                      void abandonReadingAttempt(
                                        attempt
                                      );
                                    }}
                                  >
                                    {isSaving
                                      ? "Working…"
                                      : attempt.is_reread
                                        ? "Cancel reread"
                                        : "Cancel reading"}
                                  </button>
                                </div>
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
                                    bookDetailIsSaving ||
                                    bookDetailHasChanges ||
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
                </div>
              </details>
            ) : null}

            {selectedBookChallengeDetails.length > 0 ? (
              <details
                className="detailSection detailDisclosureSection"
                open={
                  bookDetailDisclosureState
                    .challengeProgress
                }
              >
                <summary
                  className="detailDisclosureSummary"
                  onClick={(event) => {
                    event.preventDefault();

                    toggleBookDetailDisclosure(
                      "challengeProgress"
                    );
                  }}
                >
                  <span className="detailLabel">
                    Challenge progress
                  </span>

                  <span
                    className={
                      bookDetailDisclosureState
                        .challengeProgress
                        ? "detailDisclosureChevron detailDisclosureChevronOpen"
                        : "detailDisclosureChevron"
                    }
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </summary>

                <div className="detailDisclosureContent">
                  <div className="detailChallengeList">
                  {selectedBookChallengeDetails.map(
                    ({
                      challenge,
                      reader,
                      entry,
                    }) => {
                      const {
                        isRead,
                        pagesRead,
                        totalPages,
                      } =
                        getChallengeEntryDisplayState(
                          entry,
                          challenge.challengeId,
                          reader.readerId
                        );

                      const challengeReaderId =
                        isLibraryReaderId(
                          reader.readerId
                        )
                          ? reader.readerId
                          : null;

                      const challengeEntryKey =
                        challengeReaderId
                          ? makeLibraryChallengeEntryKey(
                              challengeReaderId,
                              challenge.challengeId,
                              entry.entryId
                            )
                          : "";

                      const currentChallengeLink =
                        challengeEntryKey
                          ? currentChallengeAttemptLinkByKey.get(
                              challengeEntryKey
                            )
                          : undefined;

                      const linkedChallengeAttempt =
                        currentChallengeLink
                          ? readingAttemptById.get(
                              currentChallengeLink.attempt_id
                            )
                          : undefined;

                      const activeBookAttemptKey =
                        challengeReaderId &&
                        selectedBookCatalogKey
                          ? makeLibraryStateKey(
                              challengeReaderId,
                              selectedBookCatalogKey
                            )
                          : "";

                      const activeBookAttempt =
                        activeBookAttemptKey
                          ? activeReadingAttemptByKey.get(
                              activeBookAttemptKey
                            )
                          : undefined;

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

                      const actionFeedback =
                        challengeAttemptFeedback
                          ?.challengeEntryKey ===
                        challengeEntryKey
                          ? challengeAttemptFeedback
                          : null;

                      const actionIsSaving =
                        challengeAttemptSavingKey ===
                        challengeEntryKey;

                      const challengeActionsReady =
                        Boolean(
                          householdSession &&
                            sharedLibraryStateIsAuthoritative &&
                            sharedReadingAttemptsAreAuthoritative &&
                            challengeReaderId &&
                            selectedBookCatalogKey
                        );

                      let challengeAction:
                        | ChallengeAttemptAction
                        | null = null;

                      let challengeActionLabel =
                        "";

                      if (
                        challengeActionsReady &&
                        !currentChallengeLink
                      ) {
                        if (activeBookAttempt) {
                          challengeAction =
                            "link";

                          challengeActionLabel =
                            "Link current read";
                        } else {
                          challengeAction =
                            "start";

                          challengeActionLabel =
                            "Start for challenge";
                        }
                      }

                      const alternativeChallengeAttempts =
                        challengeReaderId &&
                        selectedBookCatalogKey
                          ? readingAttempts
                              .filter(
                                (attempt) =>
                                  attempt.reader_id ===
                                    challengeReaderId &&
                                  attempt.catalog_key ===
                                    selectedBookCatalogKey &&
                                  attempt.attempt_id !==
                                    currentChallengeLink
                                      ?.attempt_id &&
                                  attempt.status !==
                                    "abandoned"
                              )
                              .sort(
                                (
                                  firstAttempt,
                                  secondAttempt
                                ) =>
                                  new Date(
                                    secondAttempt.started_at
                                  ).getTime() -
                                  new Date(
                                    firstAttempt.started_at
                                  ).getTime()
                              )
                          : [];

                      const canStartNewChallengeRead =
                        Boolean(
                          challengeActionsReady &&
                            currentChallengeLink &&
                            linkedChallengeAttempt &&
                            linkedChallengeAttempt.status !==
                              "active" &&
                            !activeBookAttempt
                        );

                      const challengeLinkNote =
                        linkedChallengeAttempt
                          ?.status === "active"
                          ? `Linked to ${reader.readerName}'s active reading attempt.`
                          : linkedChallengeAttempt
                                ?.status ===
                              "completed"
                            ? "Completed through its linked reading attempt."
                            : linkedChallengeAttempt
                                  ?.status ===
                                "abandoned"
                              ? "The linked reading attempt was cancelled and no longer counts."
                              : currentChallengeLink
                                ? "The linked reading attempt could not be loaded."
                                : "";

                      return (
                        <article
                          key={[
                            challenge.challengeId,
                            reader.readerId,
                            entry.entryId,
                          ].join(":")}
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

                          {totalPages > 0 ? (
                            <>
                              <div
                                className="challengeProgressTrack detailReadingProgressTrack"
                                role="progressbar"
                                aria-label={`${reader.readerName} reading progress`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={
                                  progressPercent
                                }
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
                                {pagesRead.toLocaleString()}{" "}
                                /{" "}
                                {totalPages.toLocaleString()}{" "}
                                pages
                              </p>
                            </>
                          ) : (
                            <p className="detailChallengeNoPageCount">
                              {isRead
                                ? "Completed"
                                : pagesRead > 0
                                  ? `Page ${pagesRead.toLocaleString()}`
                                  : "No page total available"}
                            </p>
                          )}

                          {challengeLinkNote ? (
                            <p className="detailChallengeLinkNote">
                              {challengeLinkNote}
                            </p>
                          ) : null}

                          {currentChallengeLink &&
                          challengeReaderId ? (
                            <details className="detailChallengeManage">
                              <summary className="detailChallengeManageSummary">
                                <span>
                                  Manage challenge read
                                </span>

                                <span
                                  className="detailChallengeManageChevron"
                                  aria-hidden="true"
                                >
                                  ⌄
                                </span>
                              </summary>

                              <div className="detailChallengeManageContent">
                                <p className="detailChallengeManageNote">
                                  Changing the link
                                  keeps the old reading
                                  attempt and link in
                                  history. It only
                                  changes which read
                                  counts for this
                                  challenge entry.
                                </p>

                                <div className="detailChallengeManageCurrent">
                                  <span className="detailChallengeManageEyebrow">
                                    Currently linked
                                  </span>

                                  {linkedChallengeAttempt ? (
                                    <>
                                      <strong className="detailChallengeManageTitle">
                                        {linkedChallengeAttempt
                                          .is_reread
                                          ? "Reread"
                                          : "First read"}
                                        {" · "}
                                        {getReadingAttemptStatusLabel(
                                          linkedChallengeAttempt
                                        )}
                                      </strong>

                                      <span className="detailChallengeManageMeta">
                                        {getReadingAttemptDateLabel(
                                          linkedChallengeAttempt
                                        )}

                                        {(linkedChallengeAttempt
                                          .current_page ??
                                          0) > 0
                                          ? ` · Page ${linkedChallengeAttempt.current_page?.toLocaleString()}`
                                          : ""}
                                      </span>
                                    </>
                                  ) : (
                                    <strong className="detailChallengeManageTitle">
                                      Linked attempt
                                      unavailable
                                    </strong>
                                  )}
                                </div>

                                <div className="detailChallengeManageOptions">
                                  <span className="detailChallengeManageEyebrow">
                                    Other reads for
                                    this book
                                  </span>

                                  {alternativeChallengeAttempts.length >
                                  0 ? (
                                    <div className="detailChallengeAttemptOptions">
                                      {alternativeChallengeAttempts.map(
                                        (
                                          alternativeAttempt
                                        ) => (
                                          <article
                                            key={
                                              alternativeAttempt.attempt_id
                                            }
                                            className="detailChallengeAttemptOption"
                                          >
                                            <div className="detailChallengeAttemptOptionCopy">
                                              <strong>
                                                {alternativeAttempt
                                                  .is_reread
                                                  ? "Reread"
                                                  : "First read"}
                                                {" · "}
                                                {getReadingAttemptStatusLabel(
                                                  alternativeAttempt
                                                )}
                                              </strong>

                                              <span>
                                                {getReadingAttemptDateLabel(
                                                  alternativeAttempt
                                                )}

                                                {(alternativeAttempt
                                                  .current_page ??
                                                  0) >
                                                0
                                                  ? ` · Page ${alternativeAttempt.current_page?.toLocaleString()}`
                                                  : ""}
                                              </span>
                                            </div>

                                            <button
                                              type="button"
                                              disabled={
                                                bookDetailHasChanges ||
                                                actionIsSaving ||
                                                challengeAttemptSavingKey !==
                                                  null ||
                                                readingAttemptSavingKey !==
                                                  null ||
                                                readStatusSavingKey !==
                                                  null
                                              }
                                              onClick={() => {
                                                void runChallengeAttemptAction(
                                                  {
                                                    action:
                                                      "replace",

                                                    challengeId:
                                                      challenge.challengeId,

                                                    challengeEntryId:
                                                      entry.entryId,

                                                    challengeName:
                                                      challenge.name,

                                                    readerId:
                                                      challengeReaderId,

                                                    readerName:
                                                      reader.readerName,

                                                    catalogKey:
                                                      selectedBookCatalogKey,

                                                    attemptId:
                                                      alternativeAttempt.attempt_id,
                                                  }
                                                );
                                              }}
                                            >
                                              {actionIsSaving
                                                ? "Working…"
                                                : alternativeAttempt.status ===
                                                    "active"
                                                  ? "Use active read"
                                                  : "Use this read"}
                                            </button>
                                          </article>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <p className="detailChallengeManageEmpty">
                                      No other active
                                      or completed reads
                                      are available for
                                      this book.
                                    </p>
                                  )}
                                </div>

                                {canStartNewChallengeRead ? (
                                  <div className="detailChallengeManageStart">
                                    <p>
                                      Start a fresh
                                      reading attempt
                                      and make it the
                                      current challenge
                                      read.
                                    </p>

                                    <button
                                      type="button"
                                      className="detailChallengeActionButton"
                                      disabled={
                                        bookDetailHasChanges ||
                                        actionIsSaving ||
                                        challengeAttemptSavingKey !==
                                          null ||
                                        readingAttemptSavingKey !==
                                          null ||
                                        readStatusSavingKey !==
                                          null
                                      }
                                      onClick={() => {
                                        void runChallengeAttemptAction(
                                          {
                                            action:
                                              "start",

                                            challengeId:
                                              challenge.challengeId,

                                            challengeEntryId:
                                              entry.entryId,

                                            challengeName:
                                              challenge.name,

                                            readerId:
                                              challengeReaderId,

                                            readerName:
                                              reader.readerName,

                                            catalogKey:
                                              selectedBookCatalogKey,
                                          }
                                        );
                                      }}
                                    >
                                      {actionIsSaving
                                        ? "Working…"
                                        : "Start new challenge read"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ) : null}

                          {challengeAction &&
                          challengeReaderId ? (
                            <div className="detailChallengeActions">
                              <button
                                type="button"
                                className="detailChallengeActionButton"
                                disabled={
                                  bookDetailHasChanges ||
                                  actionIsSaving ||
                                  challengeAttemptSavingKey !==
                                    null ||
                                  readingAttemptSavingKey !==
                                    null ||
                                  readStatusSavingKey !==
                                    null
                                }
                                onClick={() => {
                                  void runChallengeAttemptAction(
                                    {
                                      action:
                                        challengeAction,

                                      challengeId:
                                        challenge.challengeId,

                                      challengeEntryId:
                                        entry.entryId,

                                      challengeName:
                                        challenge.name,

                                      readerId:
                                        challengeReaderId,

                                      readerName:
                                        reader.readerName,

                                      catalogKey:
                                        selectedBookCatalogKey,
                                    }
                                  );
                                }}
                              >
                                {actionIsSaving
                                  ? "Working…"
                                  : challengeActionLabel}
                              </button>
                            </div>
                          ) : null}

                          {actionFeedback ? (
                            <p
                              className={
                                actionFeedback.kind ===
                                "error"
                                  ? "detailChallengeActionFeedback detailChallengeActionFeedbackError"
                                  : "detailChallengeActionFeedback detailChallengeActionFeedbackSuccess"
                              }
                              role={
                                actionFeedback.kind ===
                                "error"
                                  ? "alert"
                                  : "status"
                              }
                            >
                              {
                                actionFeedback.message
                              }
                            </p>
                          ) : null}
                        </article>
                      );
                    }
                  )}
                  </div>
                </div>
              </details>
            ) : null}

            <details
              className="detailSection detailDisclosureSection"
              open={
                bookDetailDisclosureState
                  .bookDetails
              }
            >
              <summary
                className="detailDisclosureSummary"
                onClick={(event) => {
                  event.preventDefault();

                  toggleBookDetailDisclosure(
                    "bookDetails"
                  );
                }}
              >
                <span className="detailLabel">
                  Book details
                </span>

                <span
                  className={
                    bookDetailDisclosureState
                      .bookDetails
                      ? "detailDisclosureChevron detailDisclosureChevronOpen"
                      : "detailDisclosureChevron"
                  }
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </summary>

              <div className="detailDisclosureContent">
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
                        {selectedBook.seriesNumber !=
                        null
                          ? ` #${selectedBook.seriesNumber}`
                          : ""}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </details>

            {readStatusCanEdit ? (
              <section
                className={
                  bookDetailHasChanges
                    ? "bookDetailSaveBar bookDetailSaveBarPending"
                    : "bookDetailSaveBar"
                }
                aria-label="Save book changes"
              >
                <div className="bookDetailSaveCopy">
                  <strong>
                    {bookDetailHasChanges
                      ? "Unsaved changes"
                      : "Everything saved"}
                  </strong>

                  <span>
                    {bookDetailHasChanges
                      ? "Save or discard these changes before using reading or challenge actions."
                      : "Read status and page progress are up to date."}
                  </span>
                </div>

                <div className="bookDetailSaveActions">
                  {bookDetailHasChanges ? (
                    <button
                      type="button"
                      className="bookDetailDiscardButton"
                      disabled={
                        bookDetailIsSaving ||
                        readingAttemptSavingKey !==
                          null ||
                        challengeAttemptSavingKey !==
                          null
                      }
                      onClick={() => {
                        discardBookDetailDrafts(
                          selectedBook
                        );
                      }}
                    >
                      Discard
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="bookDetailSaveButton"
                    disabled={
                      !bookDetailHasChanges ||
                      bookDetailIsSaving ||
                      readingAttemptSavingKey !==
                        null ||
                      challengeAttemptSavingKey !==
                        null
                    }
                    onClick={() => {
                      void saveBookDetailChanges(
                        selectedBook,
                        onBack
                      );
                    }}
                  >
                    {bookDetailIsSaving
                      ? "Saving…"
                      : "Save"}
                  </button>
                </div>

                {bookDetailSaveError ? (
                  <p
                    className="bookDetailSaveError"
                    role="alert"
                  >
                    {bookDetailSaveError}
                  </p>
                ) : null}
              </section>
            ) : null}
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
        <div className="appHeaderMainRow">
          <div className="appHeaderTitleBlock">
            <p className="eyebrow">
              Library Map
            </p>

            <h1>{headerTitle}</h1>

            <p className="bookcaseMeta">
              {headerMeta}
            </p>
          </div>

          <div
            className="appMenu"
            ref={appMenuRef}
          >
            <button
              type="button"
              className={
                appMenuOpen
                  ? "appMenuButton appMenuButtonOpen"
                  : "appMenuButton"
              }
              aria-expanded={appMenuOpen}
              aria-controls="library-app-menu"
              aria-haspopup="menu"
              onClick={() => {
                setAppMenuOpen(
                  (currentValue) =>
                    !currentValue
                );
              }}
            >
              <span
                className="appMenuButtonIcon"
                aria-hidden="true"
              >
                {appMenuOpen
                  ? "✕"
                  : "☰"}
              </span>

              <span>
                {appMenuOpen
                  ? "Close"
                  : "Menu"}
              </span>
            </button>

            {appMenuOpen ? (
              <nav
                id="library-app-menu"
                className="appMenuPanel"
                aria-label="Library views"
              >
                {APP_NAV_ITEMS.map(
                  (item) => {
                    const isCurrent =
                      item.tab ===
                      activeTab;

                    return (
                      <button
                        key={item.tab}
                        type="button"
                        className={
                          isCurrent
                            ? "appMenuItem appMenuItemActive"
                            : "appMenuItem"
                        }
                        aria-current={
                          isCurrent
                            ? "page"
                            : undefined
                        }
                        onClick={() => {
                          selectAppTab(
                            item.tab
                          );
                        }}
                      >
                        <span
                          className="appMenuItemIcon"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </span>

                        <span className="appMenuItemCopy">
                          <strong>
                            {item.label}
                          </strong>

                          <span>
                            {
                              item.description
                            }
                          </span>
                        </span>

                        {isCurrent ? (
                          <span className="appMenuCurrent">
                            Current
                          </span>
                        ) : (
                          <span
                            className="appMenuArrow"
                            aria-hidden="true"
                          >
                            →
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </nav>
            ) : null}
          </div>
        </div>

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
                Challenge book lists come from the challenge
                workbook. Live progress and completion come
                from explicitly linked reading attempts.
                Overall library Read status is tracked
                separately.
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
                            } =
                              getChallengeEntryDisplayState(
                                entry,
                                activeChallenge?.challengeId ??
                                  "",
                                activeChallengeReader.readerId
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