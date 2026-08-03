import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
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
  sortLibraryItemsForDisplay,
  sortBooksForSearchDisplay,
} from "./data/librarySelectors";
import type {
  AuthorNameMode,
  LibrarySortDirection,
  LibrarySortField,
  SearchScope,
  SearchSortDirection,
  SearchSortField,
  SingleLetterMatchMode,
} from "./data/librarySelectors";
import type { 
  Book,
  ChallengeData,
  ChallengeEntry, 
  WantedBook, 
  WantedLists, 
} from "./data/libraryTypes";
import type {
  LibraryBookMetadata,
} from "./data/libraryMetadata";
import type {
  LibraryAuthor,
  LibraryAuthorMetadata,
  LibraryBookAuthorLink,
  ResolvedBookAuthor,
} from "./data/libraryAuthors";

/*
 * Master switch for temporary developer-only tools.
 *
 * true  = show and run debugging features
 * false = keep debugging features dormant
 */
const DEBUG_MODE: boolean = false;

type AppTab =
  | "search"
  | "map"
  | "challenges"
  | "wanted"
  | "stats"
  | "update";

type UpdateField =
  | "isbn"
  | "totalPages"
  | "publicationYear"
  | "coverImage"
  | "origin"
  | "catalogMatch"
  | "classificationReview";

type ClassificationReviewField =
  | "author"
  | "genre"
  | "subgenre"
  | "format"
  | "publisher"
  | "room"
  | "bookcase"
  | "shelf";

type ClassificationReviewIssue = {
  field: ClassificationReviewField;
  label: string;
  workbookValue: string;
  displayValue: string;
};

const CLASSIFICATION_REVIEW_FIELDS: Array<{
  field: ClassificationReviewField;
  label: string;
}> = [
  {
    field: "author",
    label: "Author",
  },
  {
    field: "genre",
    label: "Genre",
  },
  {
    field: "subgenre",
    label: "Subgenre",
  },
  {
    field: "format",
    label: "Format",
  },
  {
    field: "publisher",
    label: "Publisher",
  },
  {
    field: "room",
    label: "Room",
  },
  {
    field: "bookcase",
    label: "Bookcase",
  },
  {
    field: "shelf",
    label: "Shelf",
  },
];

type StatsDataset =
  | "collection"
  | "cjRead"
  | "jadeRead"
  | "eitherRead"
  | "bothRead"
  | "neitherRead";

type StatsBreakdown =
  | "genre"
  | "subgenre"
  | "format"
  | "publicationDecade"
  | "publisher"
  | "origin"
  | "author"
  | "room"
  | "bookcase"
  | "pageRange";

type StatsDisplay =
  | "bars"
  | "pie"
  | "list";

type StatsCountMode =
  | "works"
  | "volumes";

type StatsWorkAuditBook = {
  bookId: string;
  title: string;
  rawSeries: string;
  seriesTitle: string;
  seriesNumber: string;
  catalogKey: string;
  countedAsNewWork: boolean;
};

type StatsWorkAuditGroup = {
  workKey: string;
  workType:
    | "series"
    | "standalone";
  label: string;
  reason: string;
  books: StatsWorkAuditBook[];
};

type StatsWorkAudit = {
  authorLabel: string;
  sourceBookCount: number;
  workCount: number;
  groups: StatsWorkAuditGroup[];
};

type StatsCompositionRow = {
  key: string;
  label: string;
  count: number;
  fill: string;
};

const STATS_DATASET_OPTIONS: Array<{
  value: StatsDataset;
  label: string;
  description: string;
}> = [
  {
    value: "collection",
    label: "Whole collection",
    description: "Every book in the household library.",
  },
  {
    value: "cjRead",
    label: "Read by CJ",
    description: "Books CJ has marked Read.",
  },
  {
    value: "jadeRead",
    label: "Read by Jade",
    description: "Books Jade has marked Read.",
  },
  {
    value: "eitherRead",
    label: "Read by either",
    description: "Books at least one of you has read.",
  },
  {
    value: "bothRead",
    label: "Read by both",
    description: "Books both CJ and Jade have read.",
  },
  {
    value: "neitherRead",
    label: "Read by neither",
    description: "Books neither reader has marked Read.",
  },
];

const STATS_BREAKDOWN_OPTIONS: Array<{
  value: StatsBreakdown;
  label: string;
}> = [
  {
    value: "genre",
    label: "Genre",
  },
  {
    value: "subgenre",
    label: "Subgenre",
  },
  {
    value: "format",
    label: "Format",
  },
  {
    value: "publicationDecade",
    label: "Publication decade",
  },
  {
    value: "publisher",
    label: "Publisher",
  },
  {
    value: "origin",
    label: "Origin",
  },
  {
    value: "author",
    label: "Author",
  },
  {
    value: "room",
    label: "Room",
  },
  {
    value: "bookcase",
    label: "Bookcase",
  },
  {
    value: "pageRange",
    label: "Book length",
  },
];

const STATS_DISPLAY_OPTIONS: Array<{
  value: StatsDisplay;
  label: string;
}> = [
  {
    value: "bars",
    label: "Bars",
  },
  {
    value: "pie",
    label: "Pie",
  },
  {
    value: "list",
    label: "List",
  },
];

const STATS_COUNT_MODE_OPTIONS: Array<{
  value: StatsCountMode;
  label: string;
}> = [
  {
    value: "works",
    label: "Works",
  },
  {
    value: "volumes",
    label: "Volumes",
  },
];

const STATS_PIE_COLORS = [
  "#526f45",
  "#c99a45",
  "#b86450",
  "#7a4d2b",
  "#8ea176",
  "#d7b86f",
  "#6f604b",
  "#3f665f",
  "#9a6a8d",
  "#d28a5f",
  "#6f7f9a",
  "#a85f6a",
  "#7f8c4d",
  "#b08a5a",
  "#5f4f77",
];

const STATS_PIE_TARGET_OTHER_SHARE =
  0.25;

const STATS_PIE_MIN_VISIBLE_CATEGORIES =
  4;

const STATS_PIE_MAX_VISIBLE_CATEGORIES =
  14;

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
  {
    tab: "stats",
    label: "Stats",
    icon: "📊",
    description: "Explore the household library by the numbers.",
  },
  {
    tab: "update",
    label: "Review",
    icon: "🔎",
    description: "Find books with missing or questionable details.",
  },
];

const UPDATE_FIELD_OPTIONS: Array<{
  field: UpdateField;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    field: "isbn",
    label: "ISBN",
    icon: "🔢",
    description:
      "Books without an ISBN.",
  },
  {
    field: "totalPages",
    label: "Page count",
    icon: "📄",
    description:
      "Books without a total page count.",
  },
  {
    field: "publicationYear",
    label: "Publication year",
    icon: "🗓️",
    description:
      "Books without a publication year.",
  },
  {
    field: "coverImage",
    label: "Cover image",
    icon: "🖼️",
    description:
      "Books that do not have a cover yet.",
  },
  {
    field: "origin",
    label: "Origin",
    icon: "🛍️",
    description:
      "Books without an acquisition source.",
  },
  {
    field: "catalogMatch",
    label: "Catalog match",
    icon: "🔗",
    description:
      "List View books without a matching Catalog entry.",
  },
  {
    field: "classificationReview",
    label: "Unknown / Other",
    icon: "🔎",
    description:
      "Books with blank, Unknown, or Other category values.",
  },
];

const UPDATE_FIELD_LABELS: Record<
  UpdateField,
  string
> = {
  isbn: "Missing ISBN",
  totalPages: "Missing page count",
  publicationYear:
    "Missing publication year",
  origin: "Missing origin",
  coverImage: "Missing cover",
  catalogMatch:
    "Missing catalog match",
  classificationReview:
    "Review Unknown / Other",
};

type WantedMode =
  | "toBuy"
  | "seriesToComplete";

type ReadingAttemptFeedback = {
  stateKey: string;
  kind: "success" | "error";
  message: string;
} | null;

type BookRatingFeedback = {
  stateKey: string;
  kind: "success" | "error";
  message: string;
} | null;

type BookMetadataFeedback = {
  bookId: string;
  kind: "success" | "error";
  message: string;
} | null;

type AuthorMetadataFeedback = {
  authorId: string;
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

  type PageLengthBucket =
  | "under200"
  | "200to399"
  | "400to599"
  | "600to799"
  | "800plus"
  | "unknown";

type SearchPageLength =
  | ""
  | "known"
  | PageLengthBucket;

const PAGE_LENGTH_LABELS: Record<
  PageLengthBucket,
  string
> = {
  under200: "Under 200 pages",
  "200to399": "200–399 pages",
  "400to599": "400–599 pages",
  "600to799": "600–799 pages",
  "800plus": "800+ pages",
  unknown: "Unknown page count",
};

const SEARCH_PAGE_LENGTH_OPTIONS: Array<{
  value: SearchPageLength;
  label: string;
}> = [
  {
    value: "",
    label: "Any length",
  },
  {
    value: "known",
    label: "Known page count",
  },
  {
    value: "under200",
    label:
      PAGE_LENGTH_LABELS.under200,
  },
  {
    value: "200to399",
    label:
      PAGE_LENGTH_LABELS[
        "200to399"
      ],
  },
  {
    value: "400to599",
    label:
      PAGE_LENGTH_LABELS[
        "400to599"
      ],
  },
  {
    value: "600to799",
    label:
      PAGE_LENGTH_LABELS[
        "600to799"
      ],
  },
  {
    value: "800plus",
    label:
      PAGE_LENGTH_LABELS[
        "800plus"
      ],
  },
  {
    value: "unknown",
    label:
      PAGE_LENGTH_LABELS.unknown,
  },
];

function getBookPageLengthBucket(
  book: Book
): PageLengthBucket {
  const totalPages =
    Number(book.totalPages);

  if (
    !Number.isFinite(totalPages) ||
    totalPages <= 0
  ) {
    return "unknown";
  }

  if (totalPages < 200) {
    return "under200";
  }

  if (totalPages < 400) {
    return "200to399";
  }

  if (totalPages < 600) {
    return "400to599";
  }

  if (totalPages < 800) {
    return "600to799";
  }

  return "800plus";
}

function bookMatchesPageLength(
  book: Book,
  pageLength: SearchPageLength
): boolean {
  if (!pageLength) {
    return true;
  }

  const bucket =
    getBookPageLengthBucket(book);

  if (pageLength === "known") {
    return bucket !== "unknown";
  }

  return bucket === pageLength;
}

function getPageLengthFilterLabel(
  pageLength: SearchPageLength
): string {
  return (
    SEARCH_PAGE_LENGTH_OPTIONS.find(
      (option) =>
        option.value === pageLength
    )?.label ?? "Any length"
  );
}

type SearchFilters = {
  proseOnly: boolean;
  lgbtqOnly: boolean;
  bipocOnly: boolean;
  genre: string;
  subgenre: string;
  format: string;
  origin: string;
  pageLength: SearchPageLength;
};

type SearchDrilldown = {
  label: string;
  bookIds: string[];
};

type OpenSearchWithFiltersOptions = {
  filters?: Partial<SearchFilters>;

  filterMode?:
    | "replace"
    | "merge";

  query?: string;

  scope?: SearchScope;

  authorNameMode?:
    AuthorNameMode;

  sortField?:
    SearchSortField;

  sortDirection?:
    SearchSortDirection;

  singleLetterMatchMode?:
    SingleLetterMatchMode;

  filtersOpen?: boolean;

  drilldown?:
    SearchDrilldown | null;
};

const EMPTY_SEARCH_FILTERS:
  SearchFilters = {
    proseOnly: false,
    lgbtqOnly: false,
    bipocOnly: false,
    genre: "",
    subgenre: "",
    format: "",
    origin: "",
    pageLength: "",
  };

const SEARCH_SCOPE_OPTIONS: Array<{
  scope: SearchScope;
  label: string;
}> = [
  { scope: "all", label: "All", },
  { scope: "title", label: "Title", },
  { scope: "author", label: "Author", },
  { scope: "series", label: "Series", },
  { scope: "isbn", label: "ISBN", },
  { scope: "genre", label: "Genre", },
  { scope: "publisher", label: "Publisher", },
  { scope: "bookcase", label: "Bookcase", },
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

    case "isbn":
      return "Search ISBN...";

    case "genre":
      return "Search genres and subgenres...";

    case "publisher":
      return "Search publishers...";

    case "bookcase":
      return "Search bookcases or rooms...";

    case "all":
    default:
      return "Title, author, ISBN, genre, publisher, location...";
  }
}

type MapReturnPosition = {
  windowScrollY: number;
  shelfScrollerId?: string;
  shelfScrollLeft?: number;
};

type UpdateReturnPosition = {
  windowScrollY: number;
};

type StatsReturnPosition = {
  windowScrollY: number;
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

const STATS_PAGE_SIZE = 15;

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
    label: "Series",
    description: "Missing books from series we have already started collecting.",
    emptyText: "No missing-series books added yet.",
    emptySearchText: "No missing-series books match that search.",
  },
];

const WANTED_SORT_FIELD_OPTIONS:
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

function getStatsPercent(
  part: number,
  total: number
): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round(
    (part / total) * 100
  );
}

function handleStatsDrilldownKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onActivate: () => void
) {
  if (
    event.key !== "Enter" &&
    event.key !== " "
  ) {
    return;
  }

  event.preventDefault();

  onActivate();
}

function StatsCompositionChart({
  title,
  description,
  rows,
  featuredKey,
  unitLabel,
  onRowSelect,
}: {
  title: string;
  description: string;
  rows: StatsCompositionRow[];
  featuredKey: string;
  unitLabel: string;

  onRowSelect?: (
    row: StatsCompositionRow
  ) => void;
}) {
  const total = rows.reduce(
    (
      runningTotal,
      row
    ) =>
      runningTotal +
      row.count,
    0
  );

  const featuredRow =
    rows.find(
      (row) =>
        row.key ===
        featuredKey
    ) ??
    rows[0];

  const featuredCount =
    featuredRow?.count ?? 0;

  const featuredPercentage =
    getStatsPercent(
      featuredCount,
      total
    );

  return (
    <article className="statsRepresentationCard">
      <div className="statsRepresentationCardHeader">
        <div>
          <h3>{title}</h3>

          <p>{description}</p>
        </div>

        <strong>
          {featuredCount.toLocaleString()}{" "}
          of{" "}
          {total.toLocaleString()}{" "}
          {unitLabel}
        </strong>
      </div>

      <div className="statsPieLayout statsRepresentationPieLayout">
        <div
          className="statsPieChart"
          role="img"
          aria-label={`${title}: ${featuredCount.toLocaleString()} of ${total.toLocaleString()} ${unitLabel}`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <PieChart
              accessibilityLayer
            >
              <Pie
                data={rows}
                dataKey="count"
                nameKey="label"
                innerRadius="52%"
                outerRadius="82%"
                paddingAngle={2}
                stroke="#fff8e9"
                strokeWidth={2}
                isAnimationActive={
                  false
                }
              />

              <Tooltip
                formatter={(
                  value,
                  _name,
                  item
                ) => [
                  Number(
                    value ?? 0
                  ).toLocaleString(),

                  String(
                    item.payload
                      .label ??
                      unitLabel
                  ),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>

          <div
            className="statsPieCenter"
            aria-hidden="true"
          >
            <strong>
              {featuredPercentage}%
            </strong>

            <span>
              {featuredRow?.label ??
                title}
            </span>
          </div>
        </div>

        <div className="statsPieLegend">
          {rows.map(
            (row) => {
              const canDrillDown =
                Boolean(
                  onRowSelect
                );

              return (
                <div
                  key={row.key}
                  className={
                    canDrillDown
                      ? "statsPieLegendItem statsDrilldownTarget"
                      : "statsPieLegendItem"
                  }
                  role={
                    canDrillDown
                      ? "button"
                      : undefined
                  }
                  tabIndex={
                    canDrillDown
                      ? 0
                      : undefined
                  }
                  aria-label={
                    canDrillDown
                      ? `View ${row.label} books in Search`
                      : undefined
                  }
                  onClick={
                    canDrillDown
                      ? () => {
                          onRowSelect?.(
                            row
                          );
                        }
                      : undefined
                  }
                  onKeyDown={
                    canDrillDown
                      ? (event) => {
                          handleStatsDrilldownKeyDown(
                            event,
                            () => {
                              onRowSelect?.(
                                row
                              );
                            }
                          );
                        }
                      : undefined
                  }
                >
                  <span
                    className="statsPieSwatch"
                    style={{
                      backgroundColor:
                        row.fill,
                    }}
                    aria-hidden="true"
                  />

                  <span className="statsPieLegendLabel">
                    {row.label}
                  </span>

                  <span className="statsPieLegendValue">
                    {row.count.toLocaleString()}{" "}
                    ·{" "}
                    {getStatsPercent(
                      row.count,
                      total
                    )}
                    %
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>
    </article>
  );
}

const BOOK_RATING_VALUES = [
  1,
  2,
  3,
  4,
  5,
] as const;

function BookRatingControl({
  readerName,
  value,
  isRead,
  disabled,
  isSaving,
  feedback,
  onChange,
}: {
  readerName: string;
  value: number | null;
  isRead: boolean;
  disabled: boolean;
  isSaving: boolean;
  feedback: BookRatingFeedback;
  onChange: (
    nextRating: number | null
  ) => void;
}) {
  const controlsDisabled =
    disabled ||
    isSaving ||
    !isRead;

  return (
    <article className="bookRatingCard">
      <div className="bookRatingHeader">
        <strong>
          {readerName}
        </strong>

        <span>
          {value === null
            ? "Not rated"
            : `${value} / 5`}
        </span>
      </div>

      <div
        className="bookRatingStars"
        role="group"
        aria-label={`${readerName}'s rating`}
      >
        {BOOK_RATING_VALUES.map(
          (starValue) => {
            const isFilled =
              value !== null &&
              starValue <= value;

            return (
              <button
                key={starValue}
                type="button"
                className={
                  isFilled
                    ? "bookRatingStar bookRatingStarActive"
                    : "bookRatingStar"
                }
                aria-label={`Rate ${starValue} out of 5`}
                aria-pressed={
                  value ===
                  starValue
                }
                disabled={
                  controlsDisabled
                }
                onClick={() => {
                  onChange(
                    starValue
                  );
                }}
              >
                ★
              </button>
            );
          }
        )}
      </div>

      <div className="bookRatingFooter">
        <span className="bookRatingHint">
          {!isRead
            ? "Mark this book read before rating it."
            : isSaving
              ? "Saving rating…"
              : "Tap a star to save your rating."}
        </span>

        {value !== null &&
        isRead ? (
          <button
            type="button"
            className="bookRatingClear"
            disabled={
              disabled ||
              isSaving
            }
            onClick={() => {
              onChange(null);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {feedback ? (
        <p
          className={
            feedback.kind ===
            "error"
              ? "bookRatingFeedback bookRatingFeedbackError"
              : "bookRatingFeedback bookRatingFeedbackSuccess"
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

function getStatsBreakdownValue(
  book: Book,
  breakdown: StatsBreakdown
): string {
  switch (breakdown) {
    case "genre":
      return (
        String(book.genre ?? "").trim() ||
        "Unknown"
      );

    case "subgenre":
      return (
        String(book.subgenre ?? "").trim() ||
        "Unknown"
      );

    case "format":
      return (
        String(book.format ?? "").trim() ||
        "Unknown"
      );

    case "publisher":
      return (
        String(book.publisher ?? "").trim() ||
        "Unknown"
      );

    case "origin":
      return (
        String(book.origin ?? "").trim() ||
        "Unknown"
      );

    case "author":
      return (
        String(book.author ?? "").trim() ||
        "Unknown"
      );

    case "room":
      return (
        String(book.room ?? "").trim() ||
        "Unknown"
      );

    case "bookcase":
      return (
        String(book.bookcase ?? "").trim() ||
        "Unknown"
      );

    case "publicationDecade": {
      const publicationYear =
        Number(book.publicationYear);

      if (
        !Number.isFinite(
          publicationYear
        ) ||
        publicationYear <= 0
      ) {
        return "Unknown";
      }

      const decade =
        Math.floor(
          publicationYear / 10
        ) * 10;

      return `${decade}s`;
    }

    case "pageRange":
      return PAGE_LENGTH_LABELS[
        getBookPageLengthBucket(book)
      ];
  }
}

function getStatsAuthorNames(
  book: Book
): string[] {
  const rawAuthor = String(
    book.author ?? ""
  ).trim();

  if (!rawAuthor) {
    return ["Unknown"];
  }

  const uniqueAuthors =
    new Map<string, string>();

  rawAuthor
    .split(/\s*;\s*|\r?\n+/)
    .map((author) => author.trim())
    .filter(Boolean)
    .forEach((author) => {
      const authorKey =
        normalizeInlineSearchText(
          author
        );

      if (
        authorKey &&
        !uniqueAuthors.has(
          authorKey
        )
      ) {
        uniqueAuthors.set(
          authorKey,
          author
        );
      }
    });

  return uniqueAuthors.size > 0
    ? Array.from(
        uniqueAuthors.values()
      )
    : ["Unknown"];
}

type StatsWorkResolution = {
  workKey: string;

  seriesName: string;

  workType:
    | "series"
    | "standalone";

  reason: string;
};

type StatsWorkSeriesOverride = {
  seriesName: string;

  authorKeys: string[];

  titlePattern: RegExp;

  description: string;
};

/*
 * These are intentional Stats-only overrides for unusual
 * publication formats that do not use the workbook's normal
 * Series column.
 *
 * They do not modify the workbook data or exported JSON.
 */
const STATS_WORK_SERIES_OVERRIDES:
  StatsWorkSeriesOverride[] = [
  {
    seriesName:
      "I Hear the Sunspot",

    authorKeys: [
      "yuki fumino",
    ],

    titlePattern:
      /^i hear the sunspot(?:,|$)/,

    description:
      "the I Hear the Sunspot series, including the Limit arc",
  },
  {
    seriesName:
      "Parasyte",

    authorKeys: [
      "hitoshi iwaaki",
    ],

    titlePattern:
      /^parasyte,\s*vol\.?\s*\d+/,

    description:
      "the Parasyte Full Color Collection volumes",
  },
  {
    seriesName:
      "Solo Leveling",

    authorKeys: [
      "chugong",
      "dubu",
    ],

    titlePattern:
      /^solo leveling,\s*vol\.?\s*\d+.*\(manhwa\)/,

    description:
      "the Solo Leveling manhwa, including its side-story volumes",
  },
  {
    seriesName:
      "Teahouse",

    authorKeys: [
      "emirain",
    ],

    titlePattern:
      /^teahouse,\s*ch\.?\s*\d+/,

    description:
      "the physical Teahouse webcomic chapter editions",
  },
];

function getStatsWorkbookSeriesName(
  book: Book
): string {
  return String(
    book.seriesTitle ??
      book.series?.split("|")[0] ??
      ""
  ).trim();
}

function getStatsWorkSeriesOverride(
  book: Book
): StatsWorkSeriesOverride | null {
  const normalizedTitle =
    normalizeInlineSearchText(
      book.title
    );

  const creditedAuthorKeys =
    new Set(
      getStatsAuthorNames(book).map(
        (author) =>
          normalizeInlineSearchText(
            author
          )
      )
    );

  return (
    STATS_WORK_SERIES_OVERRIDES.find(
      (override) => {
        const creditsMatchingAuthor =
          override.authorKeys.some(
            (authorKey) =>
              creditedAuthorKeys.has(
                authorKey
              )
          );

        return (
          creditsMatchingAuthor &&
          override.titlePattern.test(
            normalizedTitle
          )
        );
      }
    ) ?? null
  );
}

function getStatsWorkResolution(
  book: Book
): StatsWorkResolution {
  const seriesOverride =
    getStatsWorkSeriesOverride(
      book
    );

  if (seriesOverride) {
    const normalizedSeriesName =
      normalizeInlineSearchText(
        seriesOverride.seriesName
      );

    return {
      workKey:
        `series:${normalizedSeriesName}`,

      seriesName:
        seriesOverride.seriesName,

      workType:
        "series",

      reason:
        `Code override: this title matches ${seriesOverride.description}. ` +
        `The workbook data remains unchanged.`,
    };
  }

  const workbookSeriesName =
    getStatsWorkbookSeriesName(
      book
    );

  if (workbookSeriesName) {
    return {
      workKey:
        `series:${normalizeInlineSearchText(
          workbookSeriesName
        )}`,

      seriesName:
        workbookSeriesName,

      workType:
        "series",

      reason:
        `The workbook series value resolves to “${workbookSeriesName}”, ` +
        `so every book with that resolved value shares this work key.`,
    };
  }

  const individualBookKey =
    String(
      book.catalogKey ??
        book.bookId
    ).trim();

  return {
    workKey:
      `book:${individualBookKey}`,

    seriesName:
      "",

    workType:
      "standalone",

    reason:
      "No workbook series value or Stats override matched, so this book receives its own standalone work key.",
  };
}

function getStatsWorkKey(
  book: Book
): string {
  return getStatsWorkResolution(
    book
  ).workKey;
}

function formatStatsReadingProgress(
  attempt: LibraryReaderReadingAttempt,
  book?: Book
): string {
  const parts = [
    attempt.is_reread
      ? "Rereading"
      : "Reading",
  ];

  const currentPage = Math.max(
    attempt.current_page ?? 0,
    0
  );

  const totalPages = Number(
    book?.totalPages
  );

  if (currentPage > 0) {
    parts.push(
      Number.isFinite(totalPages) &&
        totalPages > 0
        ? `Page ${currentPage.toLocaleString()} of ${totalPages.toLocaleString()}`
        : `Page ${currentPage.toLocaleString()}`
    );
  } else if (
    Number.isFinite(totalPages) &&
    totalPages > 0
  ) {
    parts.push(
      `${totalPages.toLocaleString()} pages`
    );
  }

  return parts.join(" · ");
}

function AutoFitStatValue({
  value,
}: {
  value: string;
}) {
  const valueRef =
    useRef<HTMLElement | null>(
      null
    );

  useLayoutEffect(() => {
    const element =
      valueRef.current;

    const container =
      element?.parentElement;

    if (
      !element ||
      !container
    ) {
      return;
    }

    let animationFrameId = 0;
    let lastContainerWidth = -1;

    function fitValue() {
      window.cancelAnimationFrame(
        animationFrameId
      );

      animationFrameId =
        window.requestAnimationFrame(
          () => {
            if (
              !element ||
              element.clientWidth <= 0
            ) {
              return;
            }

            element.style.fontSize =
              "";

            const maximumFontSize =
              Number.parseFloat(
                window
                  .getComputedStyle(
                    element
                  )
                  .fontSize
              ) || 38;

            const minimumFontSize =
              16;

            let lowerSize =
              minimumFontSize;

            let upperSize =
              maximumFontSize;

            let bestSize =
              minimumFontSize;

            for (
              let step = 0;
              step < 12;
              step += 1
            ) {
              const testSize =
                (lowerSize +
                  upperSize) /
                2;

              element.style.fontSize =
                `${testSize}px`;

              if (
                element.scrollWidth <=
                element.clientWidth
              ) {
                bestSize =
                  testSize;

                lowerSize =
                  testSize;
              } else {
                upperSize =
                  testSize;
              }
            }

            element.style.fontSize =
              `${bestSize}px`;
          }
        );
    }

    const resizeObserver =
      new ResizeObserver(
        ([entry]) => {
          const nextWidth =
            entry?.contentRect
              .width ?? 0;

          if (
            Math.abs(
              nextWidth -
                lastContainerWidth
            ) < 0.5
          ) {
            return;
          }

          lastContainerWidth =
            nextWidth;

          fitValue();
        }
      );

    resizeObserver.observe(
      container
    );

    fitValue();

    return () => {
      resizeObserver.disconnect();

      window.cancelAnimationFrame(
        animationFrameId
      );

      element.style.fontSize =
        "";
    };
  }, [value]);

  return (
    <strong
      ref={valueRef}
      className="statsMetricValue"
      title={value}
    >
      {value}
    </strong>
  );
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
  suggestions:
    SearchSuggestion[],
  query: string,
  singleLetterMatchMode:
    SingleLetterMatchMode
): SearchSuggestion[] {
  const normalizedQuery =
    normalizeInlineSearchText(
      query
    );

  if (!normalizedQuery) {
    return suggestions;
  }

  const queryWords =
    normalizedQuery
      .split(/\s+/)
      .filter(Boolean);

  return suggestions.filter(
    (suggestion) => {
      const searchableText =
        normalizeInlineSearchText(
          [
            suggestion.label,
            suggestion.value,
            suggestion.detail,
          ].join(" ")
        );

      if (
        normalizedQuery.length ===
        1
      ) {
        if (
          singleLetterMatchMode ===
          "contains"
        ) {
          return searchableText.includes(
            normalizedQuery
          );
        }

        return searchableText
          .split(/\s+/)
          .some((word) =>
            word.startsWith(
              normalizedQuery
            )
          );
      }

      return queryWords.every(
        (word) =>
          searchableText.includes(
            word
          )
      );
    }
  );
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

const APP_UPDATE_QUERY_KEY =
  "_appUpdate";

const APP_UPDATE_TOKEN = (() => {
  const currentUrl =
    new URL(
      window.location.href
    );

  const updateToken =
    currentUrl.searchParams.get(
      APP_UPDATE_QUERY_KEY
    ) ?? "";

  /*
   * Keep the update token available to this
   * running app session, but remove it from
   * the visible URL after the fresh page loads.
   */
  if (updateToken) {
    currentUrl.searchParams.delete(
      APP_UPDATE_QUERY_KEY
    );

    window.history.replaceState(
      window.history.state,
      "",
      currentUrl.toString()
    );
  }

  return updateToken;
})();

function appAssetPath(
  path: string
): string {
  const base =
    import.meta.env.BASE_URL;

  const cleanBase =
    base.endsWith("/")
      ? base
      : `${base}/`;

  const cleanPath =
    path.replace(/^\/+/, "");

  return `${cleanBase}${cleanPath}`;
}

async function fetchAppData(
  path: string
): Promise<Response> {
  return fetch(
    appAssetPath(path),
    {
      /*
       * A normal app opening can use the
       * browser cache normally.
       *
       * After Update app is pressed, reload
       * retrieves the network version and
       * refreshes the browser's stored copy
       * for the original JSON URL.
       */
      cache: APP_UPDATE_TOKEN
        ? "reload"
        : "default",
    }
  );
}

async function loadWantedLists(): Promise<WantedLists> {
  const response =
    await fetchAppData(
      "data/library-wanted.json"
    );

  if (!response.ok) {
    if (response.status === 404) {
      return EMPTY_WANTED_LISTS;
    }

    throw new Error(
      `Failed to load wanted lists: ${response.status}`
    );
  }

  const parsed =
    (await response.json()) as
      Partial<WantedLists>;

  return {
    toBuy:
      parsed.toBuy ?? [],

    seriesToComplete:
      parsed.seriesToComplete ?? [],
  };
}

async function loadChallengeData(): Promise<ChallengeData> {
  const response =
    await fetchAppData(
      "data/library-challenges.json"
    );

  if (!response.ok) {
    if (response.status === 404) {
      return EMPTY_CHALLENGE_DATA;
    }

    throw new Error(
      `Failed to load reading challenges: ${response.status}`
    );
  }

  const parsed =
    (await response.json()) as
      Partial<ChallengeData>;

  return {
    schemaVersion:
      parsed.schemaVersion ?? 1,

    sourceWorkbook:
      parsed.sourceWorkbook ?? "",

    challenges:
      parsed.challenges ?? [],
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

const LAST_CHALLENGE_READER_STORAGE_KEY =
  "mylibrary:lastChallengeReader";

function getStoredChallengeReaderId(): string {
  try {
    const storedReaderId =
      window.localStorage.getItem(
        LAST_CHALLENGE_READER_STORAGE_KEY
      );

    return storedReaderId &&
      isLibraryReaderId(storedReaderId)
      ? storedReaderId
      : "";
  } catch {
    return "";
  }
}

function scrollToStatsSection(
  sectionId: string
) {
  const section =
    document.getElementById(sectionId);

  if (!section) {
    return;
  }

  const prefersReducedMotion =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

  section.scrollIntoView({
    behavior: prefersReducedMotion
      ? "auto"
      : "smooth",
    block: "start",
  });
}

async function updateApp() {
  /*
   * Service workers are scoped by URL.
   * Only unregister workers belonging to
   * this MyLibrary app.
   */
  if (
    "serviceWorker" in
    navigator
  ) {
    const appScopeUrl =
      new URL(
        import.meta.env.BASE_URL,
        window.location.origin
      ).href;

    const registrations =
      await navigator
        .serviceWorker
        .getRegistrations();

    const appRegistrations =
      registrations.filter(
        (registration) =>
          registration.scope.startsWith(
            appScopeUrl
          )
      );

    await Promise.all(
      appRegistrations.map(
        (registration) =>
          registration.unregister()
      )
    );
  }

  /*
   * A unique page URL bypasses a stale
   * app-shell response. The new app session
   * sees this token and reloads its generated
   * JSON files directly from the network.
   */
  const refreshedUrl =
    new URL(
      window.location.href
    );

  refreshedUrl.searchParams.set(
    APP_UPDATE_QUERY_KEY,
    Date.now().toString()
  );

  window.location.replace(
    refreshedUrl.toString()
  );
}

function publicAssetPath(
  path: string | null | undefined
): string | undefined {
  if (!path) {
    return undefined;
  }

  const resolvedPath =
    appAssetPath(path);

  /*
   * During an Update app session, give
   * cover images a unique URL too. This
   * refreshes changed covers without
   * permanently disabling image caching.
   */
  if (!APP_UPDATE_TOKEN) {
    return resolvedPath;
  }

  const refreshedAssetUrl =
    new URL(
      resolvedPath,
      window.location.origin
    );

  refreshedAssetUrl.searchParams.set(
    APP_UPDATE_QUERY_KEY,
    APP_UPDATE_TOKEN
  );

  return refreshedAssetUrl.toString();
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

function getClassificationReviewIssues(
  book: Book
): ClassificationReviewIssue[] {
  return CLASSIFICATION_REVIEW_FIELDS.flatMap(
    ({ field, label }) => {
      const workbookValue = String(
        book[field] ?? ""
      ).trim();

      const normalizedValue =
        workbookValue.toLowerCase();

      const needsReview =
        !workbookValue ||
        normalizedValue === "unknown" ||
        normalizedValue === "other";

      if (!needsReview) {
        return [];
      }

      return [
        {
          field,
          label,
          workbookValue,
          displayValue: workbookValue
            ? workbookValue
            : "blank → Unknown",
        },
      ];
    }
  );
}

function hasCompleteWorkbookText(
  value: unknown
): boolean {
  const normalizedValue = String(
    value ?? ""
  )
    .trim()
    .toLowerCase();

  return (
    Boolean(normalizedValue) &&
    normalizedValue !== "unknown" &&
    normalizedValue !== "other"
  );
}

type UpdateCoverageDefinition = {
  label: string;
  updateField: UpdateField;
  classificationField?:
    ClassificationReviewField;
  isComplete: (book: Book) => boolean;
};

type UpdateCoverageRow =
  UpdateCoverageDefinition & {
    complete: number;
  };

const UPDATE_COVERAGE_DEFINITIONS:
  UpdateCoverageDefinition[] = [
  {
    label: "ISBN",
    updateField: "isbn",

    isComplete: (book) =>
      Boolean(
        String(
          book.isbn ?? ""
        ).trim()
      ),
  },
  {
    label: "Page count",
    updateField: "totalPages",

    isComplete: (book) => {
      const value = Number(
        book.totalPages
      );

      return (
        Number.isFinite(value) &&
        value > 0
      );
    },
  },
  {
    label: "Publication year",
    updateField: "publicationYear",

    isComplete: (book) => {
      const value = Number(
        book.publicationYear
      );

      return (
        Number.isFinite(value) &&
        value > 0
      );
    },
  },
  {
    label: "Cover image",
    updateField: "coverImage",

    isComplete: (book) =>
      Boolean(
        String(
          book.coverImage ?? ""
        ).trim()
      ),
  },
  {
    label: "Origin",
    updateField: "origin",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.origin
      ),
  },
  {
    label: "Catalog match",
    updateField: "catalogMatch",

    isComplete: (book) => {
      const matchType = String(
        book.catalogMatchType ?? ""
      )
        .trim()
        .toLowerCase();

      return (
        matchType === "exact" ||
        matchType === "title-prefix"
      );
    },
  },
  {
    label: "Author",
    updateField:
      "classificationReview",
    classificationField: "author",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.author
      ),
  },
  {
    label: "Genre",
    updateField:
      "classificationReview",
    classificationField: "genre",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.genre
      ),
  },
  {
    label: "Subgenre",
    updateField:
      "classificationReview",
    classificationField: "subgenre",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.subgenre
      ),
  },
  {
    label: "Format",
    updateField:
      "classificationReview",
    classificationField: "format",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.format
      ),
  },
  {
    label: "Publisher",
    updateField:
      "classificationReview",
    classificationField: "publisher",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.publisher
      ),
  },
  {
    label: "Room",
    updateField:
      "classificationReview",
    classificationField: "room",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.room
      ),
  },
  {
    label: "Bookcase",
    updateField:
      "classificationReview",
    classificationField: "bookcase",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.bookcase
      ),
  },
  {
    label: "Shelf",
    updateField:
      "classificationReview",
    classificationField: "shelf",

    isComplete: (book) =>
      hasCompleteWorkbookText(
        book.shelf
      ),
  },
];

function getMissingUpdateFields(
  book: Book
): UpdateField[] {
  const missingFields: UpdateField[] = [];

  const totalPages = Number(
    book.totalPages
  );

  const publicationYear = Number(
    book.publicationYear
  );

  if (
    !String(
      book.isbn ?? ""
    ).trim()
  ) {
    missingFields.push(
      "isbn"
    );
  }

  if (
    !Number.isFinite(totalPages) ||
    totalPages <= 0
  ) {
    missingFields.push(
      "totalPages"
    );
  }

  if (
    !Number.isFinite(
      publicationYear
    ) ||
    publicationYear <= 0
  ) {
    missingFields.push(
      "publicationYear"
    );
  }

  if (
    !String(
      book.coverImage ?? ""
    ).trim()
  ) {
    missingFields.push(
      "coverImage"
    );
  }

  if (
    !hasCompleteWorkbookText(
      book.origin
    )
  ) {
    missingFields.push(
      "origin"
    );
  }

  const catalogMatchType = String(
    book.catalogMatchType ?? ""
  )
    .trim()
    .toLowerCase();

  if (
    !catalogMatchType ||
    catalogMatchType === "missing"
  ) {
    missingFields.push(
      "catalogMatch"
    );
  }

  if (
    getClassificationReviewIssues(
      book
    ).length > 0
  ) {
    missingFields.push(
      "classificationReview"
    );
  }

  return missingFields;
}

function sortBooksForUpdate(
  booksToSort: Book[]
): Book[] {
  const rowOrder: Record<
    string,
    number
  > = {
    Main: 0,
    Front: 0,
    Back: 1,
  };

  return [...booksToSort].sort(
    (a, b) =>
      compareSuggestionText(
        a.room,
        b.room
      ) ||
      compareSuggestionText(
        a.bookcase,
        b.bookcase
      ) ||
      compareSuggestionText(
        a.shelf,
        b.shelf
      ) ||
      (
        (rowOrder[a.row] ?? 99) -
        (rowOrder[b.row] ?? 99)
      ) ||
      (
        (
          a.shelfPosition ??
          Number.MAX_SAFE_INTEGER
        ) -
        (
          b.shelfPosition ??
          Number.MAX_SAFE_INTEGER
        )
      ) ||
      compareSuggestionText(
        a.authorSort,
        b.authorSort
      ) ||
      compareSuggestionText(
        a.title,
        b.title
      )
  );
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

const SUPABASE_PAGE_SIZE = 1000;

async function fetchBookMetadataRows(
  userId: string
): Promise<LibraryBookMetadata[]> {
  const rows: LibraryBookMetadata[] = [];

  for (
    let from = 0;
    ;
    from += SUPABASE_PAGE_SIZE
  ) {
    const to =
      from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } =
      await supabase
        .from("library_book_metadata")
        .select(`
          user_id,
          book_id,
          lgbtq,
          created_at,
          updated_at
        `)
        .eq(
          "user_id",
          userId
        )
        .order(
          "book_id",
          {
            ascending: true,
          }
        )
        .range(
          from,
          to
        )
        .overrideTypes<
          LibraryBookMetadata[]
        >();

    if (error) {
      throw error;
    }

    const page = data ?? [];

    rows.push(...page);

    if (
      page.length <
      SUPABASE_PAGE_SIZE
    ) {
      break;
    }
  }

  return rows;
}

async function fetchAuthorMetadataRows(
  userId: string
): Promise<
  LibraryAuthorMetadata[]
> {
  const { data, error } =
    await supabase
      .from(
        "library_author_metadata"
      )
      .select(`
        user_id,
        author_id,
        bipoc,
        created_at,
        updated_at
      `)
      .eq(
        "user_id",
        userId
      )
      .order(
        "author_id",
        {
          ascending: true,
        }
      )
      .overrideTypes<
        LibraryAuthorMetadata[]
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
  const [
    workbookBooks,
    setWorkbookBooks,
  ] = useState<Book[]>([]);
  const [
    libraryAuthors,
    setLibraryAuthors,
  ] = useState<
    LibraryAuthor[]
  >([]);

  const [
    libraryBookAuthorLinks,
    setLibraryBookAuthorLinks,
  ] = useState<
    LibraryBookAuthorLink[]
  >([]);
  const [wantedLists, setWantedLists] = useState<WantedLists>(EMPTY_WANTED_LISTS);
  const [challengeData, setChallengeData] =
    useState<ChallengeData>(EMPTY_CHALLENGE_DATA);

  const [
    householdSession,
    setHouseholdSession,
  ] = useState<Session | null>(null);

  const [
    bookMetadataRows,
    setBookMetadataRows,
  ] = useState<
    LibraryBookMetadata[]
  >([]);

  const [
    bookMetadataLoadStatus,
    setBookMetadataLoadStatus,
  ] = useState<
    LibraryStateLoadStatus
  >("idle");

  const [
    bookMetadataLoadError,
    setBookMetadataLoadError,
  ] = useState("");

  const [
    bookMetadataSavingBookId,
    setBookMetadataSavingBookId,
  ] = useState<string | null>(
    null
  );

  const [
    bookMetadataFeedback,
    setBookMetadataFeedback,
  ] = useState<
    BookMetadataFeedback
  >(null);

  const [
    authorMetadataRows,
    setAuthorMetadataRows,
  ] = useState<
    LibraryAuthorMetadata[]
  >([]);

  const [
    authorMetadataLoadStatus,
    setAuthorMetadataLoadStatus,
  ] = useState<
    LibraryStateLoadStatus
  >("idle");

  const [
    authorMetadataLoadError,
    setAuthorMetadataLoadError,
  ] = useState("");

  const [
    authorMetadataSavingAuthorId,
    setAuthorMetadataSavingAuthorId,
  ] = useState<string | null>(
    null
  );

  const [
    authorMetadataFeedback,
    setAuthorMetadataFeedback,
  ] = useState<AuthorMetadataFeedback>(
    null
  );

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
    ratingSavingKey,
    setRatingSavingKey,
  ] = useState<string | null>(
    null
  );

  const [
    bookRatingFeedback,
    setBookRatingFeedback,
  ] = useState<BookRatingFeedback>(
    null
  );

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
  const [activeTab, setActiveTab] =
    useState<AppTab>("search");

  const [appMenuOpen, setAppMenuOpen] =
    useState(false);

  const [
    selectedUpdateFields,
    setSelectedUpdateFields,
  ] = useState<
    Record<UpdateField, boolean>
  >({
    isbn: true,
    totalPages: true,
    publicationYear: true,
    coverImage: true,
    origin: false,
    catalogMatch: false,
    classificationReview: false,
  });

  const [
    selectedClassificationReviewField,
    setSelectedClassificationReviewField,
  ] = useState<
    ClassificationReviewField | null
  >(null);

  const [
    statsDataset,
    setStatsDataset,
  ] = useState<StatsDataset>(
    "collection"
  );

  const [
    statsBreakdown,
    setStatsBreakdown,
  ] = useState<StatsBreakdown>(
    "genre"
  );

  const [
    statsDisplay,
    setStatsDisplay,
  ] = useState<StatsDisplay>(
    "bars"
  );

  const [
    statsCountMode,
    setStatsCountMode,
  ] = useState<StatsCountMode>(
    "works"
  );

  const [
    statsProseOnly,
    setStatsProseOnly,
  ] = useState(false);

  const [
    statsLgbtqOnly,
    setStatsLgbtqOnly,
  ] = useState(false);

  const [
    statsPage,
    setStatsPage,
  ] = useState(1);

  const [
    statsDebugAuthorKey,
    setStatsDebugAuthorKey,
  ] = useState("");

  const [searchQuery, setSearchQuery] =
    useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [
    authorNameMode,
    setAuthorNameMode,
  ] =
    useState<AuthorNameMode>(
      "last"
    );

  const [
    searchSortField,
    setSearchSortField,
  ] =
    useState<SearchSortField>(
      "title"
    );

  const [
    searchSortDirection,
    setSearchSortDirection,
  ] =
    useState<SearchSortDirection>(
      "asc"
    );

  const [
    singleLetterMatchMode,
    setSingleLetterMatchMode,
  ] =
    useState<SingleLetterMatchMode>(
      "startsWith"
    );

  const [wantedMode, setWantedMode] =
    useState<WantedMode>("seriesToComplete");
  const [wantedQueries, setWantedQueries] = useState<Record<WantedMode, string>>({
    toBuy: "",
    seriesToComplete: "",
  });

  const [
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
  const [selectedChallengeId, setSelectedChallengeId] =
    useState("");
  const [
    selectedChallengeReaderId,
    setSelectedChallengeReaderId,
  ] = useState(getStoredChallengeReaderId);
  const [selectedBookId, setSelectedBookId] =
    useState<string | null>(null);

  const [searchPage, setSearchPage] =
    useState(1);

  const [
    browseAllBooks,
    setBrowseAllBooks,
  ] = useState(false);

  const [
    searchFiltersOpen,
    setSearchFiltersOpen,
  ] = useState(false);

  const [
    searchFilters,
    setSearchFilters,
  ] = useState<SearchFilters>(
    EMPTY_SEARCH_FILTERS
  );

  const [
    searchDrilldown,
    setSearchDrilldown,
  ] = useState<
    SearchDrilldown | null
  >(null);

  const [searchSuggestionsOpen, setSearchSuggestionsOpen] =
    useState(false);
  const [
    activeSearchSuggestionIndex,
    setActiveSearchSuggestionIndex,
  ] = useState(-1);
  const mapReturnPositionRef =
    useRef<MapReturnPosition | null>(null);

  const updateReturnPositionRef =
    useRef<UpdateReturnPosition | null>(null);

  const statsReturnPositionRef =
    useRef<StatsReturnPosition | null>(null);

  const statsDrilldownReturnPositionRef =
    useRef<StatsReturnPosition | null>(null);

  const searchAutocompleteRef =
    useRef<HTMLDivElement | null>(null);

  const searchResultsTopRef =
    useRef<HTMLDivElement | null>(null);

  const appMenuRef =
    useRef<HTMLDivElement | null>(null);

  const bookMetadataByBookId =
    useMemo(
      () =>
        new Map(
          bookMetadataRows.map(
            (metadataRow) => [
              metadataRow.book_id,
              metadataRow,
            ]
          )
        ),
      [bookMetadataRows]
    );

  const sharedBookMetadataIsAuthoritative =
    householdSession !== null &&
    bookMetadataLoadStatus ===
      "ready";

  const books = useMemo(
    () =>
      workbookBooks.map(
        (book) => {
          if (
            !sharedBookMetadataIsAuthoritative
          ) {
            return book;
          }

          const sharedLgbtq = Boolean(
            bookMetadataByBookId.get(
              book.bookId
            )?.lgbtq
          );

          return {
            ...book,

            lgbtq:
              Boolean(book.lgbtq) ||
              sharedLgbtq,
          };
        }
      ),
    [
      workbookBooks,
      sharedBookMetadataIsAuthoritative,
      bookMetadataByBookId,
    ]
  );

  const authorById = useMemo(
    () =>
      new Map(
        libraryAuthors.map(
          (author) => [
            author.authorId,
            author,
          ]
        )
      ),
    [libraryAuthors]
  );

  const authorMetadataByAuthorId =
    useMemo(
      () =>
        new Map(
          authorMetadataRows.map(
            (metadataRow) => [
              metadataRow.author_id,
              metadataRow,
            ]
          )
        ),
      [authorMetadataRows]
    );

  const bookAuthorLinksByBookId =
    useMemo(() => {
      const linksByBookId =
        new Map<
          string,
          LibraryBookAuthorLink[]
        >();

      libraryBookAuthorLinks.forEach(
        (link) => {
          const existingLinks =
            linksByBookId.get(
              link.bookId
            ) ?? [];

          existingLinks.push(
            link
          );

          linksByBookId.set(
            link.bookId,
            existingLinks
          );
        }
      );

      linksByBookId.forEach(
        (links) => {
          links.sort(
            (a, b) =>
              a.creditOrder -
              b.creditOrder
          );
        }
      );

      return linksByBookId;
    }, [libraryBookAuthorLinks]);

  const resolvedAuthorsByBookId =
    useMemo(() => {
      const resolvedByBookId =
        new Map<
          string,
          ResolvedBookAuthor[]
        >();

      bookAuthorLinksByBookId.forEach(
        (links, bookId) => {
          const resolvedAuthors =
            links.flatMap(
              (link) => {
                const author =
                  authorById.get(
                    link.authorId
                  );

                if (!author) {
                  return [];
                }

                return [
                  {
                    author,
                    link,

                    metadata:
                      authorMetadataByAuthorId.get(
                        author.authorId
                      ) ?? null,
                  },
                ];
              }
            );

          resolvedByBookId.set(
            bookId,
            resolvedAuthors
          );
        }
      );

      return resolvedByBookId;
    }, [
      bookAuthorLinksByBookId,
      authorById,
      authorMetadataByAuthorId,
    ]);

  useEffect(() => {
    if (
      loadStatus !== "ready"
    ) {
      return;
    }

    console.info(
      "Library author identities loaded.",
      {
        authors:
          libraryAuthors.length,

        bookAuthorLinks:
          libraryBookAuthorLinks.length,

        booksWithResolvedAuthors:
          resolvedAuthorsByBookId.size,

        authorMetadataRows:
          authorMetadataRows.length,

        authorMetadataStatus:
          authorMetadataLoadStatus,

        authorMetadataError:
          authorMetadataLoadError,
      }
    );
  }, [
    loadStatus,
    libraryAuthors.length,
    libraryBookAuthorLinks.length,
    resolvedAuthorsByBookId.size,
    authorMetadataRows.length,
    authorMetadataLoadStatus,
    authorMetadataLoadError,
  ]);

  useEffect(() => {
    if (
      !isLibraryReaderId(
        selectedChallengeReaderId
      )
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        LAST_CHALLENGE_READER_STORAGE_KEY,
        selectedChallengeReaderId
      );
    } catch {
      // The app still works if browser storage
      // is unavailable.
    }
  }, [selectedChallengeReaderId]);

  useEffect(() => {
    setStatsPage(1);
  }, [
    statsDataset,
    statsBreakdown,
    statsCountMode,
    statsProseOnly,
    statsLgbtqOnly,
  ]);

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

    const previousBodyOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

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

      document.body.style.overflow =
        previousBodyOverflow;
    };
  }, [appMenuOpen]);

  function openMapBookDetail(
    bookId: string,
    mapPosition?: Pick<
      MapReturnPosition,
      "shelfScrollerId" | "shelfScrollLeft"
    >
  ) {
    mapReturnPositionRef.current = {
      windowScrollY: window.scrollY,
      shelfScrollerId:
        mapPosition?.shelfScrollerId,
      shelfScrollLeft:
        mapPosition?.shelfScrollLeft,
    };

    setSelectedBookId(bookId);
  }

  function backToMapFromDetail() {
    const returnPosition =
      mapReturnPositionRef.current;

    setSelectedBookId(null);

    window.requestAnimationFrame(
      () => {
        if (
          returnPosition?.shelfScrollerId
        ) {
          const shelfScroller =
            document.getElementById(
              returnPosition.shelfScrollerId
            );

          if (
            shelfScroller instanceof
            HTMLElement
          ) {
            shelfScroller.scrollLeft =
              returnPosition
                .shelfScrollLeft ?? 0;
          }
        }

        window.scrollTo({
          top:
            returnPosition
              ?.windowScrollY ?? 0,
          behavior: "auto",
        });
      }
    );
  }

  function openUpdateBookDetail(
    bookId: string
  ) {
    updateReturnPositionRef.current = {
      windowScrollY: window.scrollY,
    };

    setSelectedBookId(bookId);
  }

  function backToUpdateFromDetail() {
    const returnPosition =
      updateReturnPositionRef.current;

    setSelectedBookId(null);

    window.requestAnimationFrame(
      () => {
        window.scrollTo({
          top:
            returnPosition
              ?.windowScrollY ?? 0,
          behavior: "auto",
        });

        updateReturnPositionRef.current =
          null;
      }
    );
  }

  function openStatsBookDetail(
    bookId: string
  ) {
    statsReturnPositionRef.current = {
      windowScrollY: window.scrollY,
    };

    setSelectedBookId(bookId);
  }

  function backToStatsFromDetail() {
    const returnPosition =
      statsReturnPositionRef.current;

    setSelectedBookId(null);

    window.requestAnimationFrame(
      () => {
        window.scrollTo({
          top:
            returnPosition
              ?.windowScrollY ?? 0,
          behavior: "auto",
        });

        statsReturnPositionRef.current =
          null;
      }
    );
  }

  function returnToStatsFromDrilldown() {
    const returnPosition =
      statsDrilldownReturnPositionRef.current;

    setActiveTab("stats");
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);

    window.requestAnimationFrame(
      () => {
        window.scrollTo({
          top:
            returnPosition
              ?.windowScrollY ?? 0,
          behavior: "auto",
        });

        statsDrilldownReturnPositionRef.current =
          null;
      }
    );
  }

  useEffect(() => {
    async function loadBooks() {
      try {
        const [
          booksResponse,
          authorsResponse,
          bookAuthorsResponse,
          loadedWantedLists,
          loadedChallengeData,
        ] = await Promise.all([
          fetchAppData(
            "data/library-books.json"
          ),

          fetchAppData(
            "data/library-authors.json"
          ),

          fetchAppData(
            "data/library-book-authors.json"
          ),

          loadWantedLists(),

          loadChallengeData(),
        ]);

        if (!booksResponse.ok) {
          throw new Error(
            `Failed to load library data: ${booksResponse.status}`
          );
        }

        if (!authorsResponse.ok) {
          throw new Error(
            `Failed to load library authors: ${authorsResponse.status}`
          );
        }

        if (!bookAuthorsResponse.ok) {
          throw new Error(
            `Failed to load book-author links: ${bookAuthorsResponse.status}`
          );
        }

        const loadedBooks =
          (await booksResponse.json()) as Book[];

        const loadedAuthors =
          (await authorsResponse.json()) as
            LibraryAuthor[];

        const loadedBookAuthorLinks =
          (await bookAuthorsResponse.json()) as
            LibraryBookAuthorLink[];

        const loadedBookIds = new Set(
          loadedBooks.map(
            (book) => book.bookId
          )
        );

        const loadedAuthorIds = new Set(
          loadedAuthors.map(
            (author) =>
              author.authorId
          )
        );

        const duplicateAuthorIds =
          loadedAuthors.filter(
            (
              author,
              index,
              authors
            ) =>
              authors.findIndex(
                (candidate) =>
                  candidate.authorId ===
                  author.authorId
              ) !== index
          );

        if (
          duplicateAuthorIds.length > 0
        ) {
          throw new Error(
            `Author data contains ${duplicateAuthorIds.length} duplicate Author IDs.`
          );
        }

        const invalidBookAuthorLinks =
          loadedBookAuthorLinks.filter(
            (link) =>
              !loadedBookIds.has(
                link.bookId
              ) ||
              !loadedAuthorIds.has(
                link.authorId
              )
          );

        if (
          invalidBookAuthorLinks.length > 0
        ) {
          throw new Error(
            `${invalidBookAuthorLinks.length} book-author links reference missing books or authors.`
          );
        }

        setWorkbookBooks(loadedBooks);
        setLibraryAuthors(loadedAuthors);
        setLibraryBookAuthorLinks(loadedBookAuthorLinks);
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

    async function loadBookMetadata() {
      if (!householdSession) {
        setBookMetadataRows([]);

        setBookMetadataLoadStatus(
          "idle"
        );

        setBookMetadataLoadError("");

        setBookMetadataSavingBookId(
          null
        );

        setBookMetadataFeedback(null);

        return;
      }

      setBookMetadataLoadStatus(
        "loading"
      );

      setBookMetadataLoadError("");

      try {
        const loadedRows =
          await fetchBookMetadataRows(
            householdSession.user.id
          );

        if (!isActive) {
          return;
        }

        setBookMetadataRows(
          loadedRows
        );

        setBookMetadataLoadStatus(
          "ready"
        );

      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error(
          "Could not load shared book metadata.",
          error
        );

        setBookMetadataRows([]);

        setBookMetadataLoadStatus(
          "error"
        );

        setBookMetadataLoadError(
          error instanceof Error
            ? error.message
            : "Unknown Supabase error"
        );
      }
    }

    void loadBookMetadata();

    return () => {
      isActive = false;
    };
  }, [householdSession]);

  useEffect(() => {
    let isActive = true;

    async function loadAuthorMetadata() {
      if (!householdSession) {
        setAuthorMetadataRows([]);

        setAuthorMetadataLoadStatus(
          "idle"
        );

        setAuthorMetadataLoadError("");

        setAuthorMetadataSavingAuthorId(
          null
        );

        setAuthorMetadataFeedback(null);

        return;
      }

      setAuthorMetadataLoadStatus(
        "loading"
      );

      setAuthorMetadataLoadError("");

      try {
        const loadedRows =
          await fetchAuthorMetadataRows(
            householdSession.user.id
          );

        if (!isActive) {
          return;
        }

        setAuthorMetadataRows(
          loadedRows
        );

        setAuthorMetadataLoadStatus(
          "ready"
        );
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error(
          "Could not load shared author metadata.",
          error
        );

        setAuthorMetadataRows([]);

        setAuthorMetadataLoadStatus(
          "error"
        );

        setAuthorMetadataLoadError(
          error instanceof Error
            ? error.message
            : "Unknown Supabase error"
        );
      }
    }

    void loadAuthorMetadata();

    return () => {
      isActive = false;
    };
  }, [householdSession]);

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
    ? getShelvesForBookcase(
        books,
        selectedBookcase
      )
    : [];

  const searchFilterOptions =
    useMemo(() => {
      function collectValues(
        getValue: (
          book: Book
        ) => unknown
      ): string[] {
        return Array.from(
          new Set(
            books
              .map((book) =>
                String(
                  getValue(book) ??
                    ""
                ).trim()
              )
              .filter(Boolean)
          )
        ).sort(
          compareSuggestionText
        );
      }

      return {
        genres:
          collectValues(
            (book) =>
              book.genre
          ),

        subgenres:
          collectValues(
            (book) =>
              book.subgenre
          ),

        formats:
          collectValues(
            (book) =>
              book.format
          ),

        origins:
          collectValues(
            (book) =>
              book.origin
          ),
      };
    }, [books]);

  const activeSearchFilterCount =
    [
      searchFilters.proseOnly,
      searchFilters.lgbtqOnly,
      searchFilters.bipocOnly,
      searchFilters.genre,
      searchFilters.subgenre,
      searchFilters.format,
      searchFilters.origin,
      searchFilters.pageLength,
    ].filter(Boolean).length;

  const hasActiveSearchFilters =
    activeSearchFilterCount > 0;

  const searchDrilldownBookIds =
    useMemo(
      () =>
        searchDrilldown
          ? new Set(
              searchDrilldown.bookIds
            )
          : null,
      [searchDrilldown]
    );

  const searchFilteredBooks =
    useMemo(
      () =>
        books.filter(
          (book) => {
            if (
              searchDrilldownBookIds &&
              !searchDrilldownBookIds.has(
                book.bookId
              )
            ) {
              return false;
            }
            if (
              searchFilters
                .proseOnly &&
              normalizeInlineSearchText(
                book.genre
              ) ===
                "manga / graphic novels"
            ) {
              return false;
            }

            if (
              searchFilters
                .lgbtqOnly &&
              !book.lgbtq
            ) {
              return false;
            }

            if (
              searchFilters
                .bipocOnly
            ) {
              const bookAuthors =
                resolvedAuthorsByBookId.get(
                  book.bookId
                ) ?? [];

              const hasBipocAuthor =
                bookAuthors.some(
                  ({
                    metadata,
                  }) =>
                    metadata?.bipoc ===
                    true
                );

              if (
                !hasBipocAuthor
              ) {
                return false;
              }
            }

            if (
              searchFilters.genre &&
              String(
                book.genre ?? ""
              ).trim() !==
                searchFilters.genre
            ) {
              return false;
            }

            if (
              searchFilters
                .subgenre &&
              String(
                book.subgenre ?? ""
              ).trim() !==
                searchFilters
                  .subgenre
            ) {
              return false;
            }

            if (
              searchFilters.format &&
              String(
                book.format ?? ""
              ).trim() !==
                searchFilters.format
            ) {
              return false;
            }

            if (
              searchFilters.origin &&
              String(
                book.origin ?? ""
              ).trim() !==
                searchFilters.origin
            ) {
              return false;
            }

            if (
              searchFilters.pageLength &&
              !bookMatchesPageLength(
                book,
                searchFilters.pageLength
              )
            ) {
              return false;
            }

            return true;
          }
        ),
      [
        books,
        resolvedAuthorsByBookId,
        searchDrilldownBookIds,
        searchFilters,
      ]
    );

  const autocompleteEnabled =
    supportsSearchAutocomplete(
      searchScope
    );

  const singleLetterShortcutMatch =
    searchQuery.match(
      /^\s*([a-z0-9])\*\s*$/i
    );

  const plainSingleLetterMatch =
    searchQuery.match(
      /^\s*([a-z0-9])\s*$/i
    );

  const singleLetterSearchValue =
    singleLetterShortcutMatch
      ?.[1] ??
    plainSingleLetterMatch
      ?.[1] ??
    "";

  const singleLetterSearchActive =
    searchScope !== "all" &&
    Boolean(
      singleLetterSearchValue
    );

  const effectiveSingleLetterMatchMode:
    SingleLetterMatchMode =
      singleLetterShortcutMatch
        ? "contains"
        : singleLetterMatchMode;

  const effectiveSearchQuery =
    singleLetterShortcutMatch
      ? singleLetterSearchValue
      : searchQuery;

  const searchSuggestions = useMemo(
    () =>
      buildSearchSuggestions(
        searchFilteredBooks,
        searchScope
      ),
    [
      searchFilteredBooks,
      searchScope,
    ]
  );

  const filteredSearchSuggestions =
    useMemo(
      () =>
        filterSearchSuggestions(
          searchSuggestions,
          effectiveSearchQuery,
          effectiveSingleLetterMatchMode
        ),
      [
        searchSuggestions,
        effectiveSearchQuery,
        effectiveSingleLetterMatchMode,
      ]
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

  function updateSearchFilter<
    Key extends keyof SearchFilters
  >(
    key: Key,
    value: SearchFilters[Key]
  ) {
    const nextFilters = {
      ...searchFilters,
      [key]: value,
    };

    const nextHasActiveFilters =
      [
        nextFilters.proseOnly,
        nextFilters.lgbtqOnly,
        nextFilters.bipocOnly,
        nextFilters.genre,
        nextFilters.subgenre,
        nextFilters.format,
        nextFilters.origin,
        nextFilters.pageLength,
      ].some(Boolean);

    setSearchFilters(
      nextFilters
    );

    setBrowseAllBooks(
      searchQuery.trim().length ===
        0 &&
      (
        nextHasActiveFilters ||
        searchDrilldown !== null
      )
    );

    setSearchPage(1);
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);
  }

  function clearSearchFilters() {
    setSearchFilters({
      ...EMPTY_SEARCH_FILTERS,
    });

    setBrowseAllBooks(
      searchQuery.trim().length ===
        0 &&
      searchDrilldown !== null
    );

    setSearchPage(1);
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);
  }

  function clearSearchDrilldown() {
    setSearchDrilldown(
      null
    );

    setBrowseAllBooks(
      searchQuery.trim().length ===
        0 &&
      hasActiveSearchFilters
    );

    setSearchPage(1);
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);
  }

  function selectSearchSuggestion(
    suggestion: SearchSuggestion
  ) {
    setSearchQuery(
      suggestion.value
    );

    setSingleLetterMatchMode(
      "startsWith"
    );

    setBrowseAllBooks(
      false
    );

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
        searchFilteredBooks,
        effectiveSearchQuery,
        searchScope,
        authorNameMode,
        searchSortDirection,
        effectiveSingleLetterMatchMode
      ),
    [
      searchFilteredBooks,
      effectiveSearchQuery,
      searchScope,
      authorNameMode,
      searchSortDirection,
      effectiveSingleLetterMatchMode,
    ]
  );

  const updateFieldCounts =
    useMemo<
      Record<
        UpdateField,
        number
      >
    >(() => {
      const counts: Record<
        UpdateField,
        number
      > = {
        isbn: 0,
        totalPages: 0,
        publicationYear: 0,
        coverImage: 0,
        origin: 0,
        catalogMatch: 0,
        classificationReview: 0,
      };

      books.forEach((book) => {
        getMissingUpdateFields(
          book
        ).forEach((field) => {
          counts[field] += 1;
        });
      });

      return counts;
    }, [books]);

  const selectedUpdateFieldList =
    useMemo<UpdateField[]>(
      () =>
        UPDATE_FIELD_OPTIONS
          .filter(
            (option) =>
              selectedUpdateFields[
                option.field
              ]
          )
          .map(
            (option) =>
              option.field
          ),
      [selectedUpdateFields]
    );

  const updateBooks =
    useMemo(() => {
      if (
        selectedUpdateFieldList
          .length === 0
      ) {
        return [];
      }

      const selectedFields =
        new Set(
          selectedUpdateFieldList
        );

      return sortBooksForUpdate(
        books.filter((book) =>
          getMissingUpdateFields(
            book
          ).some((field) => {
            if (
              !selectedFields.has(
                field
              )
            ) {
              return false;
            }

            if (
              field !==
                "classificationReview" ||
              !selectedClassificationReviewField
            ) {
              return true;
            }

            return getClassificationReviewIssues(
              book
            ).some(
              (issue) =>
                issue.field ===
                selectedClassificationReviewField
            );
          })
        )
      );
    }, [
      books,
      selectedUpdateFieldList,
      selectedClassificationReviewField,
    ]);

  const updateCoverageRows =
    useMemo<UpdateCoverageRow[]>(
      () =>
        UPDATE_COVERAGE_DEFINITIONS.map(
          (definition) => ({
            ...definition,

            complete:
              books.reduce(
                (
                  runningTotal,
                  book
                ) =>
                  runningTotal +
                  (
                    definition.isComplete(
                      book
                    )
                      ? 1
                      : 0
                  ),
                0
              ),
          })
        ),
      [books]
    );

  function openUpdateCoverageQueue(
    row: UpdateCoverageRow
  ) {
    const nextSelectedFields =
      Object.fromEntries(
        UPDATE_FIELD_OPTIONS.map(
          (option) => [
            option.field,

            option.field ===
              row.updateField,
          ]
        )
      ) as Record<
        UpdateField,
        boolean
      >;

    setSelectedUpdateFields(
      nextSelectedFields
    );

    setSelectedClassificationReviewField(
      row.classificationField ??
        null
    );

    setSelectedBookId(null);

    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            document
              .getElementById(
                "update-results"
              )
              ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
          }
        );
      }
    );
  }

  const booksById = useMemo(
    () =>
      new Map(
        books.map((book) => [book.bookId, book])
      ),
    [books]
  );

  const booksByCatalogKey =
    useMemo(() => {
      const nextBooksByCatalogKey =
        new Map<string, Book>();

      books.forEach((book) => {
        const catalogKey =
          book.catalogKey?.trim();

        if (catalogKey) {
          nextBooksByCatalogKey.set(
            catalogKey,
            book
          );
        }
      });

      return nextBooksByCatalogKey;
    }, [books]);

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

    const sharedIsRead = Boolean(
      libraryStateByKey.get(
        makeLibraryStateKey(
          readerId,
          catalogKey
        )
      )?.is_read
    );

    return (
      staticFallback ||
      sharedIsRead
    );
  }

  const statsBookFacts =
    useMemo(
      () =>
        books.map((book) => {
          const cjRead =
            getBookReaderIsRead(
              book,
              "cj",
              Boolean(book.cj)
            );

          const jadeRead =
            getBookReaderIsRead(
              book,
              "jc",
              Boolean(book.jc)
            );

          return {
            book,
            cjRead,
            jadeRead,
          };
        }),
      [
        books,
        sharedLibraryStateIsAuthoritative,
        libraryStateByKey,
      ]
    );

  const statsSummary =
    useMemo(() => {
      let totalPages = 0;
      let pageCountBooks = 0;
      let publicationYearBooks = 0;
      let coverBooks = 0;
      let originBooks = 0;
      let lgbtqBooks = 0;
      let cjReadBooks = 0;
      let jadeReadBooks = 0;
      let eitherReadBooks = 0;
      let bothReadBooks = 0;

      statsBookFacts.forEach(
        ({
          book,
          cjRead,
          jadeRead,
        }) => {
          const totalBookPages =
            Number(book.totalPages);

          if (
            Number.isFinite(
              totalBookPages
            ) &&
            totalBookPages > 0
          ) {
            totalPages +=
              totalBookPages;

            pageCountBooks += 1;
          }

          const publicationYear =
            Number(
              book.publicationYear
            );

          if (
            Number.isFinite(
              publicationYear
            ) &&
            publicationYear > 0
          ) {
            publicationYearBooks += 1;
          }

          if (
            String(
              book.coverImage ?? ""
            ).trim()
          ) {
            coverBooks += 1;
          }

          if (
            hasCompleteWorkbookText(
              book.origin
            )
          ) {
            originBooks += 1;
          }

          if (book.lgbtq) {
            lgbtqBooks += 1;
          }

          if (cjRead) {
            cjReadBooks += 1;
          }

          if (jadeRead) {
            jadeReadBooks += 1;
          }

          if (cjRead || jadeRead) {
            eitherReadBooks += 1;
          }

          if (cjRead && jadeRead) {
            bothReadBooks += 1;
          }
        }
      );

      const totalBooks =
        statsBookFacts.length;

      return {
        totalBooks,
        totalPages,
        pageCountBooks,
        publicationYearBooks,
        coverBooks,
        originBooks,
        lgbtqBooks,
        cjReadBooks,
        jadeReadBooks,
        eitherReadBooks,
        bothReadBooks,

        neitherReadBooks:
          totalBooks -
          eitherReadBooks,

        averageBookPages:
          pageCountBooks > 0
            ? Math.round(
                totalPages /
                  pageCountBooks
              )
            : 0,
      };
    }, [statsBookFacts]);

  const statsDatasetBookFacts =
    useMemo(() => {
      switch (statsDataset) {
        case "cjRead":
          return statsBookFacts.filter(
            (item) => item.cjRead
          );

        case "jadeRead":
          return statsBookFacts.filter(
            (item) => item.jadeRead
          );

        case "eitherRead":
          return statsBookFacts.filter(
            (item) =>
              item.cjRead ||
              item.jadeRead
          );

        case "bothRead":
          return statsBookFacts.filter(
            (item) =>
              item.cjRead &&
              item.jadeRead
          );

        case "neitherRead":
          return statsBookFacts.filter(
            (item) =>
              !item.cjRead &&
              !item.jadeRead
          );

        case "collection":
        default:
          return statsBookFacts;
      }
    }, [
      statsBookFacts,
      statsDataset,
    ]);

  const statsChartBookFacts =
    useMemo(
      () =>
        statsDatasetBookFacts.filter(
          ({ book }) => {
            if (
              statsProseOnly &&
              normalizeInlineSearchText(
                book.genre
              ) ===
                "manga / graphic novels"
            ) {
              return false;
            }

            if (
              statsLgbtqOnly &&
              !book.lgbtq
            ) {
              return false;
            }

            return true;
          }
        ),
      [
        statsDatasetBookFacts,
        statsProseOnly,
        statsLgbtqOnly,
      ]
    );

  const statsBreakdownRows =
    useMemo(() => {
      const counts =
        new Map<
          string,
          {
            label: string;
            count: number;
          }
        >();

      const seenWorksByAuthor =
        new Map<
          string,
          Set<string>
        >();

      function addCount(
        label: string
      ) {
        const countKey =
          statsBreakdown === "author"
            ? normalizeInlineSearchText(
                label
              ) || "unknown"
            : label;

        const currentCount =
          counts.get(countKey);

        counts.set(countKey, {
          label:
            currentCount?.label ??
            label,

          count:
            (currentCount?.count ??
              0) + 1,
        });
      }

      statsChartBookFacts.forEach(
        ({ book }) => {
          if (
            statsBreakdown ===
            "author"
          ) {
            const authors =
              getStatsAuthorNames(
                book
              );

            const workKey =
              getStatsWorkKey(book);

            authors.forEach(
              (author) => {
                const authorKey =
                  normalizeInlineSearchText(
                    author
                  ) || "unknown";

                if (
                  statsCountMode ===
                  "works"
                ) {
                  const seenWorks =
                    seenWorksByAuthor.get(
                      authorKey
                    ) ??
                    new Set<string>();

                  if (
                    seenWorks.has(
                      workKey
                    )
                  ) {
                    return;
                  }

                  seenWorks.add(
                    workKey
                  );

                  seenWorksByAuthor.set(
                    authorKey,
                    seenWorks
                  );
                }

                addCount(author);
              }
            );

            return;
          }

          addCount(
            getStatsBreakdownValue(
              book,
              statsBreakdown
            )
          );
        }
      );

      const datasetTotal =
        Array.from(
          counts.values()
        ).reduce(
          (
            runningTotal,
            row
          ) =>
            runningTotal +
            row.count,
          0
        );

      return Array.from(
        counts.values()
      )
        .map(
          ({
            label,
            count,
          }) => ({
            label,
            count,

            percentage:
              getStatsPercent(
                count,
                datasetTotal
              ),
          })
        )
        .sort(
          (a, b) =>
            b.count - a.count ||
            compareSuggestionText(
              a.label,
              b.label
            )
        );
    }, [
      statsChartBookFacts,
      statsBreakdown,
      statsCountMode,
    ]);

  const statsDebugAuthorOptions =
    useMemo(() => {
      if (
        !DEBUG_MODE ||
        statsBreakdown !==
          "author" ||
        statsCountMode !==
          "works"
      ) {
        return [];
      }

      return statsBreakdownRows.map(
        (row) => ({
          key:
            normalizeInlineSearchText(
              row.label
            ) || "unknown",

          label: row.label,
          count: row.count,
        })
      );
    }, [
      statsBreakdown,
      statsBreakdownRows,
      statsCountMode,
    ]);

  useEffect(() => {
    if (
      !DEBUG_MODE ||
      statsBreakdown !==
        "author" ||
      statsCountMode !==
        "works"
    ) {
      setStatsDebugAuthorKey("");

      return;
    }

    setStatsDebugAuthorKey(
      (currentAuthorKey) => {
        const currentAuthorStillExists =
          statsDebugAuthorOptions.some(
            (option) =>
              option.key ===
              currentAuthorKey
          );

        if (
          currentAuthorStillExists
        ) {
          return currentAuthorKey;
        }

        return (
          statsDebugAuthorOptions[0]
            ?.key ?? ""
        );
      }
    );
  }, [
    statsBreakdown,
    statsCountMode,
    statsDebugAuthorOptions,
  ]);

  const statsWorkAudit =
    useMemo<StatsWorkAudit | null>(
      () => {
        if (
          !DEBUG_MODE ||
          statsBreakdown !==
            "author" ||
          statsCountMode !==
            "works" ||
          !statsDebugAuthorKey
        ) {
          return null;
        }

        const selectedAuthor =
          statsDebugAuthorOptions.find(
            (option) =>
              option.key ===
              statsDebugAuthorKey
          );

        if (!selectedAuthor) {
          return null;
        }

        const groupsByWorkKey =
          new Map<
            string,
            StatsWorkAuditGroup
          >();

        let sourceBookCount = 0;

        statsChartBookFacts.forEach(
          ({ book }) => {
            const bookCreditsAuthor =
              getStatsAuthorNames(
                book
              ).some(
                (author) =>
                  (
                    normalizeInlineSearchText(
                      author
                    ) ||
                    "unknown"
                  ) ===
                  statsDebugAuthorKey
              );

            if (
              !bookCreditsAuthor
            ) {
              return;
            }

            sourceBookCount += 1;

            const workResolution =
              getStatsWorkResolution(
                book
              );

            const existingGroup =
              groupsByWorkKey.get(
                workResolution.workKey
              );

            const auditBook:
              StatsWorkAuditBook = {
              bookId: book.bookId,

              title:
                String(
                  book.title ?? ""
                ).trim() ||
                "(Untitled book)",

              rawSeries:
                String(
                  book.series ?? ""
                ).trim(),

              seriesTitle:
                String(
                  book.seriesTitle ?? ""
                ).trim(),

              seriesNumber:
                book.seriesNumber ===
                  null ||
                book.seriesNumber ===
                  undefined
                  ? ""
                  : String(
                      book.seriesNumber
                    ).trim(),

              catalogKey:
                String(
                  book.catalogKey ?? ""
                ).trim(),

              countedAsNewWork:
                !existingGroup,
            };

            if (existingGroup) {
              existingGroup.books.push(
                auditBook
              );

              return;
            }

            groupsByWorkKey.set(
              workResolution.workKey,
              {
                workKey:
                  workResolution.workKey,

                workType:
                  workResolution.workType,

                label:
                  workResolution.seriesName ||
                  auditBook.title,

                reason:
                  workResolution.reason,

                books: [
                  auditBook,
                ],
              }
            );
          }
        );

        const groups =
          Array.from(
            groupsByWorkKey.values()
          ).sort(
            (a, b) => {
              const aTypeOrder =
                a.workType ===
                "standalone"
                  ? 0
                  : 1;

              const bTypeOrder =
                b.workType ===
                "standalone"
                  ? 0
                  : 1;

              return (
                aTypeOrder -
                  bTypeOrder ||
                compareSuggestionText(
                  a.label,
                  b.label
                )
              );
            }
          );

        return {
          authorLabel:
            selectedAuthor.label,

          sourceBookCount,

          workCount:
            groups.length,

          groups,
        };
      },
      [
        statsBreakdown,
        statsCountMode,
        statsChartBookFacts,
        statsDebugAuthorKey,
        statsDebugAuthorOptions,
      ]
    );

  const statsBreakdownTotal =
    statsBreakdownRows.reduce(
      (
        runningTotal,
        row
      ) =>
        runningTotal +
        row.count,
      0
    );

  const statsCountSingular =
    statsBreakdown === "author"
      ? statsCountMode ===
        "works"
        ? "work"
        : "volume"
      : "book";

  const statsCountPlural =
    statsBreakdown === "author"
      ? statsCountMode ===
        "works"
        ? "works"
        : "volumes"
      : "books";

  function formatStatsBreakdownCount(
    count: number
  ): string {
    return `${count.toLocaleString()} ${
      count === 1
        ? statsCountSingular
        : statsCountPlural
    }`;
  }

  const statsBreakdownMaxCount =
    statsBreakdownRows[0]
      ?.count ?? 0;

  const totalStatsPages =
    Math.max(
      1,
      Math.ceil(
        statsBreakdownRows.length /
          STATS_PAGE_SIZE
      )
    );

  const safeStatsPage =
    Math.min(
      statsPage,
      totalStatsPages
    );

  const pagedStatsBreakdownRows =
    statsBreakdownRows.slice(
      (
        safeStatsPage - 1
      ) * STATS_PAGE_SIZE,
      safeStatsPage *
        STATS_PAGE_SIZE
    );

  const firstStatsRowNumber =
    statsBreakdownRows.length > 0
      ? (
          safeStatsPage - 1
        ) *
          STATS_PAGE_SIZE +
        1
      : 0;

  const lastStatsRowNumber =
    Math.min(
      safeStatsPage *
        STATS_PAGE_SIZE,
      statsBreakdownRows.length
    );
    
  const statsPieRows =
    useMemo(() => {
      const totalCount =
        statsBreakdownRows.reduce(
          (
            runningTotal,
            row
          ) =>
            runningTotal +
            row.count,
          0
        );

      if (totalCount <= 0) {
        return [];
      }

      const minimumVisibleCount =
        Math.min(
          STATS_PIE_MIN_VISIBLE_CATEGORIES,
          statsBreakdownRows.length
        );

      const maximumVisibleCount =
        Math.min(
          STATS_PIE_MAX_VISIBLE_CATEGORIES,
          statsBreakdownRows.length
        );

      let visibleCount =
        minimumVisibleCount;

      while (
        visibleCount <
        maximumVisibleCount
      ) {
        const remainingRows =
          statsBreakdownRows.slice(
            visibleCount
          );

        if (
          remainingRows.length <= 1
        ) {
          break;
        }

        const remainingCount =
          remainingRows.reduce(
            (
              runningTotal,
              row
            ) =>
              runningTotal +
              row.count,
            0
          );

        const remainingShare =
          remainingCount /
          totalCount;

        if (
          remainingShare <=
          STATS_PIE_TARGET_OTHER_SHARE
        ) {
          break;
        }

        visibleCount += 1;
      }

      const possibleGroupedRows =
        statsBreakdownRows.slice(
          visibleCount
        );

      const shouldGroupRows =
        possibleGroupedRows.length > 1;

      const visibleRows =
        shouldGroupRows
          ? statsBreakdownRows.slice(
              0,
              visibleCount
            )
          : statsBreakdownRows;

      const groupedRows =
        shouldGroupRows
          ? possibleGroupedRows
          : [];

      const groupedOtherCount =
        groupedRows.reduce(
          (
            runningTotal,
            row
          ) =>
            runningTotal +
            row.count,
          0
        );

      const groupedCategoryLabels =
        groupedRows
          .map(
            (row) => row.label
          )
          .filter(
            (label) =>
              label !== "Other"
          );

      const previewLabels =
        groupedCategoryLabels.slice(
          0,
          3
        );

      const groupedOtherLegendLabel =
        previewLabels.length > 0
          ? `Other (${previewLabels.join(
              ", "
            )}${
              groupedCategoryLabels.length >
              3
                ? ", etc."
                : ""
            })`
          : "Other";

      const pieRows = [
        ...visibleRows.map(
          (row) => ({
            ...row,

            pieKey:
              `category:${row.label}`,

            legendLabel:
              row.label,
          })
        ),

        ...(shouldGroupRows
          ? [
              {
                pieKey:
                  "grouped-other",

                label: "Other",

                legendLabel:
                  groupedOtherLegendLabel,

                count:
                  groupedOtherCount,

                percentage:
                  getStatsPercent(
                    groupedOtherCount,
                    totalCount
                  ),
              },
            ]
          : []),
      ];

      return pieRows.map(
        (row, index) => ({
          ...row,

          fill:
            STATS_PIE_COLORS[
              index %
                STATS_PIE_COLORS.length
            ],
        })
      );
    }, [statsBreakdownRows]);

  const currentReadingItems =
    useMemo(
      () =>
        activeReadingAttempts.map(
          (attempt) => ({
            attempt,

            book:
              booksByCatalogKey.get(
                attempt.catalog_key
              ),
          })
        ),
      [
        activeReadingAttempts,
        booksByCatalogKey,
      ]
    );

  const statsCurrentReadingGroups = [
    {
      readerId: "cj" as const,
      label: "CJ",

      items:
        currentReadingItems.filter(
          ({ attempt }) =>
            attempt.reader_id ===
            "cj"
        ),
    },
    {
      readerId: "jc" as const,
      label: "Jade",

      items:
        currentReadingItems.filter(
          ({ attempt }) =>
            attempt.reader_id ===
            "jc"
        ),
    },
  ];

  const activeStatsDataset =
    STATS_DATASET_OPTIONS.find(
      (option) =>
        option.value ===
        statsDataset
    ) ??
    STATS_DATASET_OPTIONS[0];

  const activeStatsBreakdown =
    STATS_BREAKDOWN_OPTIONS.find(
      (option) =>
        option.value ===
        statsBreakdown
    ) ??
    STATS_BREAKDOWN_OPTIONS[0];

  function openStatsBreakdownDrilldown(
    row: {
      label: string;
      count: number;
    }
  ) {
    const normalizedRowLabel =
      normalizeInlineSearchText(
        row.label
      );

    const matchingBookIds =
      statsChartBookFacts.flatMap(
        ({ book }) => {
          const bookLabels =
            statsBreakdown ===
            "author"
              ? getStatsAuthorNames(
                  book
                )
              : [
                  getStatsBreakdownValue(
                    book,
                    statsBreakdown
                  ),
                ];

          const isMatch =
            bookLabels.some(
              (label) =>
                normalizeInlineSearchText(
                  label
                ) ===
                normalizedRowLabel
            );

          return isMatch
            ? [book.bookId]
            : [];
        }
      );

    if (
      matchingBookIds.length ===
      0
    ) {
      return;
    }

    const filters:
      Partial<SearchFilters> = {};

    if (statsProseOnly) {
      filters.proseOnly =
        true;
    }

    if (statsLgbtqOnly) {
      filters.lgbtqOnly =
        true;
    }

    if (
      row.label !==
      "Unknown"
    ) {
      switch (
        statsBreakdown
      ) {
        case "genre":
          filters.genre =
            row.label;
          break;

        case "subgenre":
          filters.subgenre =
            row.label;
          break;

        case "format":
          filters.format =
            row.label;
          break;

        case "origin":
          filters.origin =
            row.label;
          break;

        case "pageRange": {
          const pageLengthOption =
            SEARCH_PAGE_LENGTH_OPTIONS.find(
              (option) =>
                option.value !== "" &&
                option.value !==
                  "known" &&
                option.label ===
                  row.label
            );

          if (pageLengthOption) {
            filters.pageLength =
              pageLengthOption.value;
          }

          break;
        }
      }
    }

    openSearchWithFilters({
      filters,

      drilldown: {
        label: [
          activeStatsDataset.label,

          `${activeStatsBreakdown.label}: ${row.label}`,

          formatStatsBreakdownCount(
            row.count
          ),
        ].join(" · "),

        bookIds:
          matchingBookIds,
      },
    });
  }

  function openLgbtqRepresentationDrilldown(
    row: StatsCompositionRow
  ) {
    const lgbtqOnly =
      row.key === "lgbtq";

    const matchingBookIds =
      books
        .filter(
          (book) =>
            Boolean(book.lgbtq) ===
            lgbtqOnly
        )
        .map(
          (book) =>
            book.bookId
        );

    openSearchWithFilters({
      filters:
        lgbtqOnly
          ? {
              lgbtqOnly:
                true,
            }
          : {},

      drilldown: {
        label:
          `Representation · ${row.label}`,

        bookIds:
          matchingBookIds,
      },
    });
  }

  const lgbtqRepresentationRows =
    useMemo<
      StatsCompositionRow[]
    >(
      () => [
        {
          key: "lgbtq",
          label: "LGBTQ+",
          count:
            statsSummary
              .lgbtqBooks,
          fill:
            STATS_PIE_COLORS[0],
        },
        {
          key: "rest",
          label:
            "Rest of library",
          count:
            Math.max(
              statsSummary
                .totalBooks -
                statsSummary
                  .lgbtqBooks,
              0
            ),
          fill:
            STATS_PIE_COLORS[5],
        },
      ],
      [
        statsSummary
          .lgbtqBooks,
        statsSummary
          .totalBooks,
      ]
    );

  function openStatsOverviewDrilldown({
    label,
    matchesBook,
    filters = {},
  }: {
    label: string;

    matchesBook: (item: {
      book: Book;
      cjRead: boolean;
      jadeRead: boolean;
    }) => boolean;

    filters?: Partial<SearchFilters>;
  }) {
    const matchingBookIds =
      statsBookFacts
        .filter(
          matchesBook
        )
        .map(
          ({ book }) =>
            book.bookId
        );

    const bookCountLabel =
      matchingBookIds.length ===
      1
        ? "1 book"
        : `${matchingBookIds.length.toLocaleString()} books`;

    openSearchWithFilters({
      filters,

      drilldown: {
        label:
          `Overview · ${label} · ${bookCountLabel}`,

        bookIds:
          matchingBookIds,
      },
    });
  }

  function openStatsBookLengthBreakdown() {
    setStatsBreakdown(
      "pageRange"
    );

    setStatsPage(1);

    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            document
              .getElementById(
                "stats-charts"
              )
              ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
          }
        );
      }
    );
  }

  const statsOverviewCards: Array<{
    label: string;
    value: string;
    meta: string;
    onClick?: () => void;
    ariaLabel?: string;
  }> = [
    {
      label: "Books owned",

      value:
        statsSummary.totalBooks
          .toLocaleString(),

      meta: "Whole collection",

      ariaLabel:
        "View every owned book in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label: "Books owned",

          matchesBook: () =>
            true,
        });
      },
    },
    {
      label: "LGBTQ+",

      value:
        statsSummary.lgbtqBooks
          .toLocaleString(),

      meta: `${getStatsPercent(
        statsSummary.lgbtqBooks,
        statsSummary.totalBooks
      )}% of the library`,

      ariaLabel:
        "View LGBTQ+ books in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label: "LGBTQ+",

          matchesBook: ({
            book,
          }) =>
            Boolean(
              book.lgbtq
            ),

          filters: {
            lgbtqOnly: true,
          },
        });
      },
    },
    {
      label: "Known pages",

      value:
        statsSummary.totalPages
          .toLocaleString(),

      meta: `${statsSummary.pageCountBooks.toLocaleString()} books counted`,

      ariaLabel:
        "View books with known page counts in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label:
            "Known page count",

          matchesBook: ({
            book,
          }) =>
            getBookPageLengthBucket(
              book
            ) !== "unknown",

          filters: {
            pageLength: "known",
          },
        });
      },
    },
    {
      label: "Average length",

      value:
        statsSummary.pageCountBooks >
        0
          ? `${statsSummary.averageBookPages.toLocaleString()} pages`
          : "—",

      meta:
        "Explore the length distribution",

      ariaLabel:
        statsSummary.pageCountBooks >
        0
          ? "Show the book length breakdown"
          : undefined,

      onClick:
        statsSummary.pageCountBooks >
        0
          ? openStatsBookLengthBreakdown
          : undefined,
    },
    {
      label: "Household reach",

      value:
        statsSummary.eitherReadBooks
          .toLocaleString(),

      meta: `${getStatsPercent(
        statsSummary.eitherReadBooks,
        statsSummary.totalBooks
      )}% read by at least one`,

      ariaLabel:
        "View books read by CJ or Jade in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label:
            "Read by at least one",

          matchesBook: ({
            cjRead,
            jadeRead,
          }) =>
            cjRead ||
            jadeRead,
        });
      },
    },
    {
      label: "CJ has read",

      value:
        statsSummary.cjReadBooks
          .toLocaleString(),

      meta: `${getStatsPercent(
        statsSummary.cjReadBooks,
        statsSummary.totalBooks
      )}% of the library`,

      ariaLabel:
        "View books CJ has read in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label: "Read by CJ",

          matchesBook: ({
            cjRead,
          }) =>
            cjRead,
        });
      },
    },
    {
      label: "Jade has read",

      value:
        statsSummary.jadeReadBooks
          .toLocaleString(),

      meta: `${getStatsPercent(
        statsSummary.jadeReadBooks,
        statsSummary.totalBooks
      )}% of the library`,

      ariaLabel:
        "View books Jade has read in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label: "Read by Jade",

          matchesBook: ({
            jadeRead,
          }) =>
            jadeRead,
        });
      },
    },
    {
      label: "Both have read",

      value:
        statsSummary.bothReadBooks
          .toLocaleString(),

      meta:
        "Shared reading overlap",

      ariaLabel:
        "View books both CJ and Jade have read in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label:
            "Read by both",

          matchesBook: ({
            cjRead,
            jadeRead,
          }) =>
            cjRead &&
            jadeRead,
        });
      },
    },
    {
      label: "Neither has read",

      value:
        statsSummary.neitherReadBooks
          .toLocaleString(),

      meta:
        "Fresh household territory",

      ariaLabel:
        "View books neither CJ nor Jade has read in Search",

      onClick: () => {
        openStatsOverviewDrilldown({
          label:
            "Read by neither",

          matchesBook: ({
            cjRead,
            jadeRead,
          }) =>
            !cjRead &&
            !jadeRead,
        });
      },
    },
  ];

  const statsCoverageRows = [
    {
      label: "Page count",
      complete:
        statsSummary.pageCountBooks,
    },
    {
      label: "Publication year",
      complete:
        statsSummary
          .publicationYearBooks,
    },
    {
      label: "Cover image",
      complete:
        statsSummary.coverBooks,
    },
    {
      label: "Origin",
      complete:
        statsSummary.originBooks,
    },
  ];

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

  async function saveBookLgbtq(
    book: Book,
    nextLgbtq: boolean
  ) {
    if (
      !householdSession ||
      bookMetadataLoadStatus !==
        "ready"
    ) {
      setBookMetadataFeedback({
        bookId: book.bookId,
        kind: "error",
        message:
          "Shared book metadata must finish loading before saving.",
      });

      return;
    }

    if (bookMetadataSavingBookId) {
      return;
    }

    const userId =
      householdSession.user.id;

    const previousRows =
      bookMetadataRows;

    const localTimestamp =
      new Date().toISOString();

    setBookMetadataSavingBookId(
      book.bookId
    );

    setBookMetadataFeedback(null);

    // Optimistically update the app so the checkbox,
    // detail chip, and future Stats values change
    // immediately.
    setBookMetadataRows(
      (currentRows) => {
        const existingRow =
          currentRows.find(
            (metadataRow) =>
              metadataRow.book_id ===
              book.bookId
          );

        if (existingRow) {
          return currentRows.map(
            (metadataRow) =>
              metadataRow.book_id ===
              book.bookId
                ? {
                    ...metadataRow,
                    lgbtq:
                      nextLgbtq,
                    updated_at:
                      localTimestamp,
                  }
                : metadataRow
          );
        }

        return [
          ...currentRows,
          {
            user_id: userId,
            book_id: book.bookId,
            lgbtq: nextLgbtq,
            created_at:
              localTimestamp,
            updated_at:
              localTimestamp,
          },
        ].sort((a, b) =>
          a.book_id.localeCompare(
            b.book_id
          )
        );
      }
    );

    try {
      const { error } =
        await supabase
          .from(
            "library_book_metadata"
          )
          .upsert(
            {
              user_id: userId,
              book_id: book.bookId,
              lgbtq: nextLgbtq,
            },
            {
              onConflict:
                "user_id,book_id",
            }
          );

      if (error) {
        throw error;
      }

      setBookMetadataFeedback({
        bookId: book.bookId,
        kind: "success",
        message:
          "LGBTQ+ metadata saved.",
      });
    } catch (error) {
      // Put the previous authoritative values
      // back if Supabase rejects the save.
      setBookMetadataRows(
        previousRows
      );

      console.error(
        "Could not save LGBTQ+ metadata.",
        error
      );

      setBookMetadataFeedback({
        bookId: book.bookId,
        kind: "error",
        message:
          error instanceof Error
            ? `LGBTQ+ failed to save: ${error.message}`
            : "LGBTQ+ failed to save because of an unknown Supabase error.",
      });
    } finally {
      setBookMetadataSavingBookId(
        null
      );
    }
  }

  async function saveBookRating(
    book: Book,
    readerId: LibraryReaderId,
    nextRating: number | null
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
        : "Jade";

    if (
      !householdSession ||
      libraryStateLoadStatus !==
        "ready"
    ) {
      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          "Household library state must finish loading before saving a rating.",
      });

      return;
    }

    if (!catalogKey) {
      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          "This book does not have a catalog key, so its rating cannot be saved safely.",
      });

      return;
    }

    if (
      nextRating !== null &&
      (
        !Number.isFinite(
          nextRating
        ) ||
        nextRating < 0.5 ||
        nextRating > 5 ||
        !Number.isInteger(
          nextRating * 2
        )
      )
    ) {
      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          "Ratings must be between 0.5 and 5 in half-star steps.",
      });

      return;
    }

    const existingState =
      libraryStateByKey.get(
        stateKey
      );

    if (!existingState) {
      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          "The shared reader record for this book is unavailable.",
      });

      return;
    }

    if (!existingState.is_read) {
      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          `${readerName} must mark this book read before rating it.`,
      });

      return;
    }

    if (ratingSavingKey) {
      return;
    }

    setRatingSavingKey(
      stateKey
    );

    setBookRatingFeedback(null);

    try {
      const { error } =
        await supabase
          .from(
            "library_reader_book_state"
          )
          .update({
            rating:
              nextRating,
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

      const refreshedRating =
        refreshedState?.rating ??
        null;

      if (
        refreshedRating !==
        nextRating
      ) {
        throw new Error(
          "The rating update finished, but the saved value did not reload correctly."
        );
      }

      setLibraryStateRows(
        refreshedRows
      );

      setBookRatingFeedback({
        stateKey,
        kind: "success",
        message:
          nextRating === null
            ? `${readerName}'s rating was cleared.`
            : `${readerName}'s ${nextRating}-star rating was saved.`,
      });
    } catch (error) {
      console.error(
        "Could not save book rating.",
        error
      );

      setBookRatingFeedback({
        stateKey,
        kind: "error",
        message:
          error instanceof Error
            ? `Rating failed to save: ${error.message}`
            : "Rating failed to save because of an unknown Supabase error.",
      });
    } finally {
      setRatingSavingKey(
        null
      );
    }
  }

  async function saveAuthorBipoc(
    author: LibraryAuthor,
    nextBipoc: boolean | null
  ) {
    if (
      !householdSession ||
      authorMetadataLoadStatus !==
        "ready"
    ) {
      setAuthorMetadataFeedback({
        authorId: author.authorId,
        kind: "error",
        message:
          "Shared author metadata must finish loading before saving.",
      });

      return;
    }

    if (
      authorMetadataSavingAuthorId
    ) {
      return;
    }

    const existingRow =
      authorMetadataByAuthorId.get(
        author.authorId
      );

    const previousBipoc =
      existingRow?.bipoc ?? null;

    if (
      previousBipoc === nextBipoc
    ) {
      return;
    }

    const userId =
      householdSession.user.id;

    const previousRows =
      authorMetadataRows;

    const localTimestamp =
      new Date().toISOString();

    setAuthorMetadataSavingAuthorId(
      author.authorId
    );

    setAuthorMetadataFeedback(null);

    // Optimistically update every book connected
    // to this permanent Author ID.
    setAuthorMetadataRows(
      (currentRows) => {
        const currentRow =
          currentRows.find(
            (metadataRow) =>
              metadataRow.author_id ===
              author.authorId
          );

        if (currentRow) {
          return currentRows.map(
            (metadataRow) =>
              metadataRow.author_id ===
              author.authorId
                ? {
                    ...metadataRow,
                    bipoc: nextBipoc,
                    updated_at:
                      localTimestamp,
                  }
                : metadataRow
          );
        }

        return [
          ...currentRows,
          {
            user_id: userId,
            author_id:
              author.authorId,
            bipoc: nextBipoc,
            created_at:
              localTimestamp,
            updated_at:
              localTimestamp,
          },
        ].sort((a, b) =>
          a.author_id.localeCompare(
            b.author_id
          )
        );
      }
    );

    try {
      const { error } =
        await supabase
          .from(
            "library_author_metadata"
          )
          .upsert(
            {
              user_id: userId,
              author_id:
                author.authorId,
              bipoc: nextBipoc,
            },
            {
              onConflict:
                "user_id,author_id",
            }
          );

      if (error) {
        throw error;
      }

      setAuthorMetadataFeedback({
        authorId: author.authorId,
        kind: "success",
        message:
          nextBipoc === true
            ? `${author.displayName} marked BIPOC.`
            : nextBipoc === false
              ? `${author.displayName} marked reviewed, not BIPOC.`
              : `${author.displayName} returned to Unreviewed.`,
      });
    } catch (error) {
      setAuthorMetadataRows(
        previousRows
      );

      console.error(
        "Could not save BIPOC author metadata.",
        error
      );

      setAuthorMetadataFeedback({
        authorId: author.authorId,
        kind: "error",
        message:
          error instanceof Error
            ? `BIPOC status failed to save: ${error.message}`
            : "BIPOC status failed to save because of an unknown Supabase error.",
      });
    } finally {
      setAuthorMetadataSavingAuthorId(
        null
      );
    }
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

  const hasSearchQuery =
    searchQuery.trim().length > 0;

  const hasSearchDrilldown =
    searchDrilldown !== null;

  const showSearchResults =
    browseAllBooks ||
    hasSearchQuery ||
    hasActiveSearchFilters ||
    hasSearchDrilldown;

  const unsortedSearchResultBooks =
    hasSearchQuery
      ? searchResults
      : showSearchResults
        ? searchFilteredBooks
        : [];

  const searchResultBooks =
    useMemo(
      () =>
        sortBooksForSearchDisplay(
          unsortedSearchResultBooks,
          searchSortField,
          searchSortDirection
        ),
      [
        unsortedSearchResultBooks,
        searchSortField,
        searchSortDirection,
      ]
    );

  const totalSearchPages = Math.max(
    1,
    Math.ceil(
      searchResultBooks.length /
        SEARCH_PAGE_SIZE
    )
  );

  const safeSearchPage = Math.min(
    searchPage,
    totalSearchPages
  );

  const pagedSearchResults =
    searchResultBooks.slice(
      (safeSearchPage - 1) *
        SEARCH_PAGE_SIZE,

      safeSearchPage *
        SEARCH_PAGE_SIZE
    );

  function scrollToSearchResultsTop() {
    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            const resultsTop =
              searchResultsTopRef.current;

            if (resultsTop) {
              resultsTop.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });

              return;
            }

            window.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }
        );
      }
    );
  }

  function changeSearchPage(
    nextPage: number
  ) {
    const boundedPage = Math.min(
      totalSearchPages,
      Math.max(
        1,
        nextPage
      )
    );

    if (
      boundedPage ===
      safeSearchPage
    ) {
      return;
    }

    setSearchPage(
      boundedPage
    );

    scrollToSearchResultsTop();
  }

  function showAllLibraryBooks() {
    openSearchWithFilters();
  }

  function hideAllLibraryBooks() {
    setSearchQuery("");

    setSearchDrilldown(
      null
    );

    setBrowseAllBooks(
      false
    );

    setSearchFiltersOpen(
      false
    );

    setSingleLetterMatchMode(
      "startsWith"
    );

    setSearchSortField(
      "title"
    );

    setSearchSortDirection(
      "asc"
    );

    setSearchPage(1);
    setSelectedBookId(null);
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestionIndex(-1);

    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }
        );
      }
    );
  }

  function renderSearchPaginationControls() {
    const hasMultipleSearchPages =
      searchResultBooks.length >
      SEARCH_PAGE_SIZE;

    const showHideAllBooksButton =
      browseAllBooks &&
      !hasSearchQuery &&
      !hasActiveSearchFilters &&
      !hasSearchDrilldown;

    const showStatsReturnButton =
      Boolean(
        searchDrilldown &&
        statsDrilldownReturnPositionRef.current
      );

    if (
      !hasMultipleSearchPages &&
      !showHideAllBooksButton &&
      !showStatsReturnButton
    ) {
      return null;
    }

    return (
      <div
        className="paginationControls"
        role="navigation"
        aria-label={
          showStatsReturnButton
            ? "Stats drilldown result controls"
            : hasSearchQuery
              ? "Search result pagination"
              : "Library pagination"
        }
      >
        {showStatsReturnButton ? (
          <button
            type="button"
            aria-label="Return to Stats"
            onClick={
              returnToStatsFromDrilldown
            }
          >
            ← Return
          </button>
        ) : null}

        {hasMultipleSearchPages ? (
          <>
            <button
              type="button"
              onClick={() =>
                changeSearchPage(
                  safeSearchPage - 1
                )
              }
              disabled={
                safeSearchPage === 1
              }
            >
              Previous
            </button>

            <span aria-live="polite">
              Page {safeSearchPage} of{" "}
              {totalSearchPages}
            </span>

            <button
              type="button"
              onClick={() =>
                changeSearchPage(
                  safeSearchPage + 1
                )
              }
              disabled={
                safeSearchPage ===
                totalSearchPages
              }
            >
              Next
            </button>
          </>
        ) : null}

        {showHideAllBooksButton ? (
          <button
            type="button"
            onClick={
              hideAllLibraryBooks
            }
          >
            Hide all books
          </button>
        ) : null}
      </div>
    );
  }

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
    setAuthorMetadataFeedback(null);
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

  function openSearchWithFilters({
    filters = {},
    filterMode = "replace",
    query = "",
    scope = "all",
    authorNameMode:
      nextAuthorNameMode =
        "last",
    sortField:
      nextSortField =
        "title",
    sortDirection =
      "asc",
    singleLetterMatchMode:
      nextSingleLetterMatchMode =
        "startsWith",
    filtersOpen = false,
    drilldown = null,
  }: OpenSearchWithFiltersOptions = {}) {
    runAfterBookDetailDiscardCheck(
      () => {
        if (
          activeTab === "stats" &&
          drilldown
        ) {
          statsDrilldownReturnPositionRef.current = {
            windowScrollY: window.scrollY,
          };
        }

        const nextFilters =
          filterMode === "merge"
            ? {
                ...searchFilters,
                ...filters,
              }
            : {
                ...EMPTY_SEARCH_FILTERS,
                ...filters,
              };

        setActiveTab(
          "search"
        );

        setSearchFilters(
          nextFilters
        );

        setSearchDrilldown(
          drilldown
        );

        setSearchFiltersOpen(
          filtersOpen
        );

        setSearchQuery(
          query
        );

        setSearchScope(
          scope
        );

        setAuthorNameMode(
          nextAuthorNameMode
        );

        setSearchSortField(
          nextSortField
        );

        setSearchSortDirection(
          sortDirection
        );

        setSingleLetterMatchMode(
          nextSingleLetterMatchMode
        );

        setBrowseAllBooks(
          query.trim().length ===
            0
        );

        setSearchPage(1);
        setSelectedBookId(null);
        setSearchSuggestionsOpen(false);
        setActiveSearchSuggestionIndex(-1);
        setAppMenuOpen(false);

        scrollToSearchResultsTop();
      }
    );
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

    const selectedBookCjState =
      cjReadStatusKey
        ? libraryStateByKey.get(
            cjReadStatusKey
          )
        : undefined;

    const selectedBookJcState =
      jcReadStatusKey
        ? libraryStateByKey.get(
            jcReadStatusKey
          )
        : undefined;

    const selectedBookCjRating =
      selectedBookCjState
        ?.rating ?? null;

    const selectedBookJcRating =
      selectedBookJcState
        ?.rating ?? null;

    const cjRatingIsSaving =
      ratingSavingKey ===
      cjReadStatusKey;

    const jcRatingIsSaving =
      ratingSavingKey ===
      jcReadStatusKey;

    const cjRatingFeedback =
      bookRatingFeedback
        ?.stateKey ===
      cjReadStatusKey
        ? bookRatingFeedback
        : null;

    const jcRatingFeedback =
      bookRatingFeedback
        ?.stateKey ===
      jcReadStatusKey
        ? bookRatingFeedback
        : null;

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

    const selectedBookMetadataCanEdit =
      sharedBookMetadataIsAuthoritative;

    const selectedBookMetadataIsSaving =
      bookMetadataSavingBookId ===
      selectedBook.bookId;

    const selectedBookMetadataFeedback =
      bookMetadataFeedback?.bookId ===
      selectedBook.bookId
        ? bookMetadataFeedback
        : null;

    const selectedBookAuthors =
      resolvedAuthorsByBookId.get(
        selectedBook.bookId
      ) ?? [];

    const selectedBookHasBipocAuthor =
      selectedBookAuthors.some(
        ({ metadata }) =>
          metadata?.bipoc === true
      );

    const selectedBookBipocAuthorCount =
      selectedBookAuthors.filter(
        ({ metadata }) =>
          metadata?.bipoc === true
      ).length;

    const selectedBookUnreviewedAuthorCount =
      selectedBookAuthors.filter(
        ({ metadata }) =>
          metadata?.bipoc == null
      ).length;

    const selectedBookAuthorSummary =
      selectedBookAuthors.length === 0
        ? "No resolved authors"
        : [
            `${selectedBookAuthors.length} ${
              selectedBookAuthors.length === 1
                ? "author"
                : "authors"
            }`,

            selectedBookBipocAuthorCount > 0
              ? `${selectedBookBipocAuthorCount} BIPOC`
              : "",

            selectedBookUnreviewedAuthorCount > 0
              ? `${selectedBookUnreviewedAuthorCount} unreviewed`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");

    const selectedBookAuthorMetadataCanEdit =
      householdSession !== null &&
      authorMetadataLoadStatus ===
        "ready";

    const selectedBookAuthorMetadataIsSaving =
      authorMetadataSavingAuthorId !==
      null;

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

                {selectedBookHasBipocAuthor ? (
                  <span className="detailChip">
                    BIPOC
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
                Tags
              </p>

              <div
                className="bookMetadataList"
                role="group"
                aria-label="Book metadata"
              >
                <label
                  className={[
                    "bookMetadataToggle",

                    !selectedBookMetadataCanEdit ||
                    selectedBookMetadataIsSaving
                      ? "bookMetadataToggleDisabled"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(
                      selectedBook.lgbtq
                    )}
                    disabled={
                      !selectedBookMetadataCanEdit ||
                      selectedBookMetadataIsSaving
                    }
                    onChange={(event) => {
                      void saveBookLgbtq(
                        selectedBook,
                        event.currentTarget
                          .checked
                      );
                    }}
                  />

                  <span>LGBTQ+</span>
                </label>
              </div>

              {selectedBookMetadataIsSaving ? (
                <p className="bookMetadataStatus">
                  Saving…
                </p>
              ) : selectedBookMetadataFeedback ? (
                <p
                  className={[
                    "bookMetadataStatus",

                    selectedBookMetadataFeedback
                      .kind === "error"
                      ? "bookMetadataStatusError"
                      : "bookMetadataStatusSuccess",
                  ].join(" ")}
                  role={
                    selectedBookMetadataFeedback
                      .kind === "error"
                      ? "alert"
                      : "status"
                  }
                >
                  {
                    selectedBookMetadataFeedback
                      .message
                  }
                </p>
              ) : bookMetadataLoadStatus ===
                "loading" ? (
                <p className="bookMetadataStatus">
                  Loading shared metadata…
                </p>
              ) : bookMetadataLoadStatus ===
                "error" ? (
                <p className="bookMetadataStatus bookMetadataStatusError">
                  Shared metadata could not
                  load:{" "}
                  {bookMetadataLoadError}
                </p>
              ) : !householdSession ? (
                <p className="bookMetadataStatus">
                  Sign in to edit shared
                  metadata.
                </p>
              ) : null}
            </section>

            <details
              key={`author-metadata-${selectedBook.bookId}`}
              className="detailSection authorMetadataDisclosure"
            >
              <summary className="authorMetadataDisclosureSummary">
                <span className="authorMetadataDisclosureHeading">
                  <span className="detailLabel">
                    Authors
                  </span>

                  <span className="authorMetadataDisclosureMeta">
                    {selectedBookAuthorSummary}
                  </span>
                </span>
              </summary>

              <div className="authorMetadataDisclosureContent">
                {authorMetadataLoadStatus ===
              "loading" ? (
                <p className="authorMetadataStatus">
                  Loading shared author
                  metadata…
                </p>
              ) : authorMetadataLoadStatus ===
                "error" ? (
                <p
                  className="authorMetadataStatus authorMetadataStatusError"
                  role="alert"
                >
                  Shared author metadata could
                  not load:{" "}
                  {authorMetadataLoadError}
                </p>
              ) : !householdSession ? (
                <p className="authorMetadataStatus">
                  Sign in to load and edit
                  BIPOC author metadata.
                </p>
              ) : selectedBookAuthors.length ===
                0 ? (
                <p className="authorMetadataStatus authorMetadataStatusError">
                  No permanent author identity
                  was resolved for this book.
                </p>
              ) : (
                <div className="authorMetadataList">
                  {selectedBookAuthors.map(
                    ({
                      author,
                      link,
                      metadata,
                    }) => {
                      const bipocValue =
                        metadata?.bipoc ?? null;

                      const displayName =
                        link.creditedName ||
                        author.displayName;

                      const isSaving =
                        authorMetadataSavingAuthorId ===
                        author.authorId;

                      const feedback =
                        authorMetadataFeedback
                          ?.authorId ===
                        author.authorId
                          ? authorMetadataFeedback
                          : null;

                      const choices: Array<{
                        label: string;
                        value: boolean | null;
                      }> = [
                        {
                          label: "Unreviewed",
                          value: null,
                        },
                        {
                          label: "BIPOC",
                          value: true,
                        },
                        {
                          label: "Not BIPOC",
                          value: false,
                        },
                      ];

                      return (
                        <article
                          key={author.authorId}
                          className="authorMetadataCard"
                        >
                          <div className="authorMetadataHeading">
                            <strong>
                              {displayName}
                            </strong>

                            {displayName !==
                            author.displayName ? (
                              <span>
                                Author record:{" "}
                                {author.displayName}
                              </span>
                            ) : null}
                          </div>

                          <div
                            className="authorMetadataChoices"
                            role="group"
                            aria-label={`BIPOC status for ${displayName}`}
                          >
                            {choices.map(
                              (choice) => {
                                const isActive =
                                  bipocValue ===
                                  choice.value;

                                return (
                                  <button
                                    key={
                                      choice.label
                                    }
                                    type="button"
                                    className={[
                                      "authorMetadataChoice",

                                      isActive
                                        ? "authorMetadataChoiceActive"
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    aria-pressed={
                                      isActive
                                    }
                                    disabled={
                                      !selectedBookAuthorMetadataCanEdit ||
                                      selectedBookAuthorMetadataIsSaving
                                    }
                                    onClick={() => {
                                      void saveAuthorBipoc(
                                        author,
                                        choice.value
                                      );
                                    }}
                                  >
                                    {choice.label}
                                  </button>
                                );
                              }
                            )}
                          </div>

                          {isSaving ? (
                            <p className="authorMetadataStatus">
                              Saving…
                            </p>
                          ) : feedback ? (
                            <p
                              className={[
                                "authorMetadataStatus",

                                feedback.kind ===
                                "error"
                                  ? "authorMetadataStatusError"
                                  : "authorMetadataStatusSuccess",
                              ].join(" ")}
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
              )}
            </div>
          </details>

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
              <p className="detailLabel">
                Ratings
              </p>

              {readStatusCanEdit ? (
                <div className="bookRatingGrid">
                  <BookRatingControl
                    readerName="CJ"
                    value={
                      selectedBookCjRating
                    }
                    isRead={
                      selectedBookCjRead
                    }
                    disabled={
                      bookDetailHasChanges ||
                      ratingSavingKey !==
                        null ||
                      readStatusSavingKey !==
                        null ||
                      readingAttemptSavingKey !==
                        null ||
                      challengeAttemptSavingKey !==
                        null
                    }
                    isSaving={
                      cjRatingIsSaving
                    }
                    feedback={
                      cjRatingFeedback
                    }
                    onChange={(
                      nextRating
                    ) => {
                      void saveBookRating(
                        selectedBook,
                        "cj",
                        nextRating
                      );
                    }}
                  />

                  <BookRatingControl
                    readerName="Jade"
                    value={
                      selectedBookJcRating
                    }
                    isRead={
                      selectedBookJcRead
                    }
                    disabled={
                      bookDetailHasChanges ||
                      ratingSavingKey !==
                        null ||
                      readStatusSavingKey !==
                        null ||
                      readingAttemptSavingKey !==
                        null ||
                      challengeAttemptSavingKey !==
                        null
                    }
                    isSaving={
                      jcRatingIsSaving
                    }
                    feedback={
                      jcRatingFeedback
                    }
                    onChange={(
                      nextRating
                    ) => {
                      void saveBookRating(
                        selectedBook,
                        "jc",
                        nextRating
                      );
                    }}
                  />
                </div>
              ) : (
                <p className="detailMuted">
                  Sign in to load and
                  edit household
                  ratings.
                </p>
              )}
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
                                              className="detailChallengeManageUseButton"
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

                      <dd>
                        {selectedBook.genre}
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.publisher ? (
                    <div>
                      <dt>Publisher</dt>

                      <dd>
                        {selectedBook.publisher}
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.origin ? (
                    <div>
                      <dt>Origin</dt>

                      <dd>
                        {selectedBook.origin}
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.isbn ? (
                    <div>
                      <dt>ISBN</dt>

                      <dd>
                        {selectedBook.isbn}
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.publicationYear ? (
                    <div>
                      <dt>
                        Publication year
                      </dt>

                      <dd>
                        {
                          selectedBook
                            .publicationYear
                        }
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.totalPages ? (
                    <div>
                      <dt>Page count</dt>

                      <dd>
                        {selectedBook.totalPages.toLocaleString()}{" "}
                        pages
                      </dd>
                    </div>
                  ) : null}

                  {selectedBook.format ? (
                    <div>
                      <dt>Format</dt>

                      <dd>
                        {selectedBook.format}
                      </dd>
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

  const headerMeta =
    activeTab === "map"
      ? selectedBookcase
        ? selectedBookcase.hasRisers
          ? `${selectedBookcase.bookcase} · Risers`
          : selectedBookcase.room
        : `${bookcases.length} bookcases`
      : activeTab === "wanted"
        ? `${wantedTotal} wanted ${
            wantedTotal === 1
              ? "book"
              : "books"
          }`
        : activeTab ===
            "challenges"
          ? activeChallengeReader
            ? `${
                activeChallengeReader.readerName
              } · ${
                activeChallengeEntries.length
              } ${
                activeChallengeEntries.length ===
                1
                  ? "book"
                  : "books"
              }`
            : `${
                challengeData
                  .challenges.length
              } ${
                challengeData
                  .challenges.length ===
                1
                  ? "challenge"
                  : "challenges"
              }`
          : activeTab === "stats"
            ? `${statsSummary.totalBooks.toLocaleString()} books · ${statsSummary.totalPages.toLocaleString()} known pages`
            : activeTab === "update"
              ? selectedUpdateFieldList.length > 0
                ? `${updateBooks.length} ${
                    updateBooks.length === 1
                      ? "book"
                      : "books"
                  } in current queue`
                : "Choose a research queue"
              : `${books.length} books loaded`;

  const activeNavItem =
    APP_NAV_ITEMS.find(
      (item) => item.tab === activeTab
    ) ?? APP_NAV_ITEMS[0];

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
        <div
          className="appBrandIconPill"
          aria-hidden="true"
        >
          <img
            className="appBrandIcon"
            src={publicAssetPath(
              "icons/icon-192.jpg"
            )}
            alt=""
          />
        </div>

        <div className="appBrandInfoPill">
          <div className="appBrandCopy">
            <strong>MyLibrary</strong>

            <span>{headerMeta}</span>
          </div>
        </div>
      </header>

      <div className="appNavigation">
        {appMenuOpen ? (
          <button
            type="button"
            className="appMenuBackdrop"
            aria-label="Close navigation"
            onClick={() => {
              setAppMenuOpen(false);
            }}
          />
        ) : null}

        <div
          className="appNavigationDock"
          ref={appMenuRef}
        >
          {!appMenuOpen &&
          !selectedBookHasPendingChanges ? (
            <button
              type="button"
              className="appNavPill"
              aria-label={`Open navigation. Current page: ${activeNavItem.label}`}
              aria-controls="library-app-menu"
              aria-expanded={false}
              onClick={() => {
                setAppMenuOpen(true);
              }}
            >
              <span
                className="appNavPillIcon"
                aria-hidden="true"
              >
                {activeNavItem.icon}
              </span>

              <span className="appNavPillLabel">
                {activeNavItem.label}
              </span>

              <span
                className="appNavPillChevron"
                aria-hidden="true"
              >
                ⌃
              </span>
            </button>
          ) : null}

          <section
            id="library-app-menu"
            className={
              appMenuOpen
                ? "appMenuSheet appMenuSheetOpen"
                : "appMenuSheet"
            }
            aria-label="MyLibrary menu"
            aria-hidden={!appMenuOpen}
          >
            <div className="appMenuSheetHeader">
              <div>
                <p className="appMenuSheetEyebrow">
                  MyLibrary
                </p>

                <strong>Where to?</strong>
              </div>

              <button
                type="button"
                className="appMenuCloseButton"
                aria-label="Close navigation"
                onClick={() => {
                  setAppMenuOpen(false);
                }}
              >
                ×
              </button>
            </div>

            <nav
              className="appMenuGrid"
              aria-label="Library views"
            >
              {APP_NAV_ITEMS.map((item) => {
                const isCurrent =
                  item.tab === activeTab;

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
                      selectAppTab(item.tab);
                    }}
                  >
                    <span
                      className="appMenuItemIcon"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>

                    <strong>{item.label}</strong>

                    {isCurrent ? (
                      <span className="appMenuCurrent">
                        Here
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="appMenuUtility">
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

              <div className="appUpdateCard">
                <span
                  className="appUpdateCardIcon"
                  aria-hidden="true"
                >
                  ↻
                </span>

                <span className="appUpdateCardCopy">
                  <strong>Update app</strong>

                  <span>
                    Reload the latest app and library data.
                  </span>
                </span>

                <button
                  type="button"
                  className="appUpdateAction"
                  aria-label="Update app and library data"
                  onClick={() => {
                    runAfterBookDetailDiscardCheck(
                      () => {
                        void updateApp();
                      }
                    );
                  }}
                >
                  Update
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

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
                    const nextQuery =
                      event.target.value;

                    const usesAnywhereShortcut =
                      /^\s*[a-z0-9]\*\s*$/i.test(
                        nextQuery
                      );

                    setSearchQuery(
                      nextQuery
                    );

                    setSingleLetterMatchMode(
                      usesAnywhereShortcut
                        ? "contains"
                        : "startsWith"
                    );

                    setBrowseAllBooks(
                      false
                    );

                    setSearchPage(1);
                    setSelectedBookId(null);

                    if (
                      autocompleteEnabled
                    ) {
                      setSearchSuggestionsOpen(
                        true
                      );

                      setActiveSearchSuggestionIndex(
                        0
                      );
                    } else {
                      setSearchSuggestionsOpen(
                        false
                      );

                      setActiveSearchSuggestionIndex(
                        -1
                      );
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
              <section
                className="searchFilterSection"
                aria-label="Book filters"
              >
                <div className="searchFilterToolbar">
                  <button
                    type="button"
                    className={
                      searchFiltersOpen
                        ? "searchFilterToggleButton searchFilterToggleButtonActive"
                        : "searchFilterToggleButton"
                    }
                    aria-expanded={
                      searchFiltersOpen
                    }
                    aria-controls="library-search-filters"
                    onClick={() => {
                      setSearchFiltersOpen(
                        (
                          currentValue
                        ) =>
                          !currentValue
                      );
                    }}
                  >
                    <span>
                      Filters
                    </span>

                    {activeSearchFilterCount >
                    0 ? (
                      <span className="searchFilterCount">
                        {
                          activeSearchFilterCount
                        }
                      </span>
                    ) : null}

                    <span
                      className="searchFilterChevron"
                      aria-hidden="true"
                    >
                      {searchFiltersOpen
                        ? "⌃"
                        : "⌄"}
                    </span>
                  </button>

                  {hasActiveSearchFilters ? (
                    <button
                      type="button"
                      className="searchFilterClearButton"
                      onClick={
                        clearSearchFilters
                      }
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>

                {searchDrilldown ||
                hasActiveSearchFilters ? (
                  <div
                    className="searchFilterChips"
                    aria-label="Active search constraints"
                  >
                    {searchDrilldown ? (
                      <button
                        type="button"
                        className="searchFilterChip searchDrilldownChip"
                        aria-label={`Remove Stats drilldown ${searchDrilldown.label}`}
                        onClick={
                          clearSearchDrilldown
                        }
                      >
                        Stats:{" "}
                        {
                          searchDrilldown.label
                        }

                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.proseOnly ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label="Remove Prose only filter"
                        onClick={() => {
                          updateSearchFilter(
                            "proseOnly",
                            false
                          );
                        }}
                      >
                        Prose only
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.lgbtqOnly ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label="Remove LGBTQ+ filter"
                        onClick={() => {
                          updateSearchFilter(
                            "lgbtqOnly",
                            false
                          );
                        }}
                      >
                        LGBTQ+
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.bipocOnly ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label="Remove BIPOC author filter"
                        onClick={() => {
                          updateSearchFilter(
                            "bipocOnly",
                            false
                          );
                        }}
                      >
                        BIPOC authors
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.genre ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label={`Remove genre filter ${searchFilters.genre}`}
                        onClick={() => {
                          updateSearchFilter(
                            "genre",
                            ""
                          );
                        }}
                      >
                        Genre:{" "}
                        {
                          searchFilters.genre
                        }
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.subgenre ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label={`Remove subgenre filter ${searchFilters.subgenre}`}
                        onClick={() => {
                          updateSearchFilter(
                            "subgenre",
                            ""
                          );
                        }}
                      >
                        Subgenre:{" "}
                        {
                          searchFilters.subgenre
                        }
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.format ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label={`Remove format filter ${searchFilters.format}`}
                        onClick={() => {
                          updateSearchFilter(
                            "format",
                            ""
                          );
                        }}
                      >
                        Format:{" "}
                        {
                          searchFilters.format
                        }
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.origin ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label={`Remove origin filter ${searchFilters.origin}`}
                        onClick={() => {
                          updateSearchFilter(
                            "origin",
                            ""
                          );
                        }}
                      >
                        Origin:{" "}
                        {
                          searchFilters.origin
                        }
                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}

                    {searchFilters.pageLength ? (
                      <button
                        type="button"
                        className="searchFilterChip"
                        aria-label={`Remove length filter ${getPageLengthFilterLabel(
                          searchFilters.pageLength
                        )}`}
                        onClick={() => {
                          updateSearchFilter(
                            "pageLength",
                            ""
                          );
                        }}
                      >
                        Length:{" "}
                        {getPageLengthFilterLabel(
                          searchFilters.pageLength
                        )}

                        <span aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {searchFiltersOpen ? (
                  <div
                    id="library-search-filters"
                    className="searchFilterPanel"
                  >
                    <div className="searchFilterToggleGrid">
                      <label className="searchFilterBoolean">
                        <input
                          type="checkbox"
                          checked={
                            searchFilters
                              .proseOnly
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "proseOnly",
                              event.target
                                .checked
                            );
                          }}
                        />

                        <span className="searchFilterBooleanCopy">
                          <strong>
                            Prose only
                          </strong>

                          <span>
                            Exclude Manga /
                            Graphic Novels.
                          </span>
                        </span>
                      </label>

                      <label className="searchFilterBoolean">
                        <input
                          type="checkbox"
                          checked={
                            searchFilters
                              .lgbtqOnly
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "lgbtqOnly",
                              event.target
                                .checked
                            );
                          }}
                        />

                        <span className="searchFilterBooleanCopy">
                          <strong>
                            LGBTQ+
                          </strong>

                          <span>
                            Include only
                            tagged books.
                          </span>
                        </span>
                      </label>

                      <label
                        className={
                          authorMetadataLoadStatus ===
                          "ready"
                            ? "searchFilterBoolean"
                            : "searchFilterBoolean searchFilterBooleanDisabled"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={
                            searchFilters
                              .bipocOnly
                          }
                          disabled={
                            authorMetadataLoadStatus !==
                            "ready"
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "bipocOnly",
                              event.target
                                .checked
                            );
                          }}
                        />

                        <span className="searchFilterBooleanCopy">
                          <strong>
                            BIPOC authors
                          </strong>

                          <span>
                            {authorMetadataLoadStatus ===
                            "ready"
                              ? "At least one credited author is marked BIPOC."
                              : "Available after shared author metadata loads."}
                          </span>
                        </span>
                      </label>
                    </div>

                    <div className="searchFilterSelectGrid">
                      <label className="searchFilterField">
                        <span>
                          Genre
                        </span>

                        <select
                          value={
                            searchFilters.genre
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "genre",
                              event.target
                                .value
                            );
                          }}
                        >
                          <option value="">
                            Any genre
                          </option>

                          {searchFilterOptions.genres.map(
                            (genre) => (
                              <option
                                key={
                                  genre
                                }
                                value={
                                  genre
                                }
                              >
                                {
                                  genre
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <label className="searchFilterField">
                        <span>
                          Subgenre
                        </span>

                        <select
                          value={
                            searchFilters
                              .subgenre
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "subgenre",
                              event.target
                                .value
                            );
                          }}
                        >
                          <option value="">
                            Any subgenre
                          </option>

                          {searchFilterOptions.subgenres.map(
                            (
                              subgenre
                            ) => (
                              <option
                                key={
                                  subgenre
                                }
                                value={
                                  subgenre
                                }
                              >
                                {
                                  subgenre
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <label className="searchFilterField">
                        <span>
                          Format
                        </span>

                        <select
                          value={
                            searchFilters.format
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "format",
                              event.target
                                .value
                            );
                          }}
                        >
                          <option value="">
                            Any format
                          </option>

                          {searchFilterOptions.formats.map(
                            (format) => (
                              <option
                                key={
                                  format
                                }
                                value={
                                  format
                                }
                              >
                                {
                                  format
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <label className="searchFilterField">
                        <span>
                          Origin
                        </span>

                        <select
                          value={
                            searchFilters.origin
                          }
                          onChange={(
                            event
                          ) => {
                            updateSearchFilter(
                              "origin",
                              event.target
                                .value
                            );
                          }}
                        >
                          <option value="">
                            Any origin
                          </option>

                          {searchFilterOptions.origins.map(
                            (origin) => (
                              <option
                                key={
                                  origin
                                }
                                value={
                                  origin
                                }
                              >
                                {
                                  origin
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <label className="searchFilterField">
                        <span>
                          Length
                        </span>

                        <select
                          value={
                            searchFilters.pageLength
                          }
                          onChange={(event) => {
                            updateSearchFilter(
                              "pageLength",
                              event.target
                                .value as SearchPageLength
                            );
                          }}
                        >
                          {SEARCH_PAGE_LENGTH_OPTIONS.map(
                            (option) => (
                              <option
                                key={
                                  option.value ||
                                  "any"
                                }
                                value={
                                  option.value
                                }
                              >
                                {
                                  option.label
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>
                    </div>

                    <p
                      className="searchFilterMatchCount"
                      aria-live="polite"
                    >
                      {searchDrilldown
                        ? `${searchFilteredBooks.length.toLocaleString()} books remain in this Stats drilldown after filters.`
                        : `${searchFilteredBooks.length.toLocaleString()} of ${books.length.toLocaleString()} books match these filters.`}
                    </p>
                  </div>
                ) : null}
              </section>

              <div className="searchControlGroup">
                <p className="searchControlLabel">
                  Search in
                </p>

                <div
                  className="searchScopeOptions"
                  role="group"
                  aria-label="Choose where to search"
                >
                  {SEARCH_SCOPE_OPTIONS.map(
                    (option) => (
                      <button
                        key={
                          option.scope
                        }
                        type="button"
                        className={
                          searchScope ===
                          option.scope
                            ? "searchScopeButton searchScopeButtonActive"
                            : "searchScopeButton"
                        }
                        aria-pressed={
                          searchScope ===
                          option.scope
                        }
                        onClick={() => {
                          setSearchScope(
                            option.scope
                          );

                          setSearchSuggestionsOpen(
                            false
                          );

                          setActiveSearchSuggestionIndex(
                            -1
                          );

                          setSearchPage(
                            1
                          );

                          setSelectedBookId(
                            null
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

              {searchScope ===
              "author" ? (
                <div className="searchControlGroup authorNameGroup">
                  <p className="searchControlLabel">
                    Author name
                  </p>

                  <div
                    className="authorNameOptions"
                    role="group"
                    aria-label="Choose author name field"
                  >
                    <button
                      type="button"
                      className={
                        authorNameMode ===
                        "last"
                          ? "authorNameButton authorNameButtonActive"
                          : "authorNameButton"
                      }
                      aria-pressed={
                        authorNameMode ===
                        "last"
                      }
                      onClick={() => {
                        setAuthorNameMode(
                          "last"
                        );

                        setSearchPage(
                          1
                        );

                        setSelectedBookId(
                          null
                        );
                      }}
                    >
                      Last name
                    </button>

                    <button
                      type="button"
                      className={
                        authorNameMode ===
                        "first"
                          ? "authorNameButton authorNameButtonActive"
                          : "authorNameButton"
                      }
                      aria-pressed={
                        authorNameMode ===
                        "first"
                      }
                      onClick={() => {
                        setAuthorNameMode(
                          "first"
                        );

                        setSearchPage(
                          1
                        );

                        setSelectedBookId(
                          null
                        );
                      }}
                    >
                      First name
                    </button>
                  </div>
                </div>
              ) : null}

              {singleLetterSearchActive ? (
                <div className="searchControlGroup sortDirectionGroup">
                  <p className="searchControlLabel">
                    Letter match
                  </p>

                  <div
                    className="searchSortOptions"
                    role="group"
                    aria-label="Choose how the single letter should match"
                  >
                    <button
                      type="button"
                      className={
                        effectiveSingleLetterMatchMode ===
                        "startsWith"
                          ? "searchSortButton searchSortButtonActive"
                          : "searchSortButton"
                      }
                      aria-pressed={
                        effectiveSingleLetterMatchMode ===
                        "startsWith"
                      }
                      onClick={() => {
                        setSingleLetterMatchMode(
                          "startsWith"
                        );

                        if (
                          singleLetterShortcutMatch
                        ) {
                          setSearchQuery(
                            singleLetterSearchValue
                          );
                        }

                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      Starts with
                    </button>

                    <button
                      type="button"
                      className={
                        effectiveSingleLetterMatchMode ===
                        "contains"
                          ? "searchSortButton searchSortButtonActive"
                          : "searchSortButton"
                      }
                      aria-pressed={
                        effectiveSingleLetterMatchMode ===
                        "contains"
                      }
                      title="Shortcut: type one letter followed by *"
                      onClick={() => {
                        setSingleLetterMatchMode(
                          "contains"
                        );

                        setSearchPage(1);
                        setSelectedBookId(null);
                      }}
                    >
                      Anywhere
                    </button>
                  </div>
                </div>
              ) : null}

              {showSearchResults ? (
                <>
                  <div className="searchControlGroup sortDirectionGroup">
                    <p className="searchControlLabel">
                      Sort by
                    </p>

                    <div
                      className="searchSortOptions"
                      role="group"
                      aria-label="Choose how books are alphabetized"
                    >
                      <button
                        type="button"
                        className={
                          searchSortField ===
                          "title"
                            ? "searchSortButton searchSortButtonActive"
                            : "searchSortButton"
                        }
                        aria-pressed={
                          searchSortField ===
                          "title"
                        }
                        onClick={() => {
                          setSearchSortField(
                            "title"
                          );

                          setSearchPage(1);
                          setSelectedBookId(null);
                        }}
                      >
                        Title
                      </button>

                      <button
                        type="button"
                        className={
                          searchSortField ===
                          "authorLast"
                            ? "searchSortButton searchSortButtonActive"
                            : "searchSortButton"
                        }
                        aria-pressed={
                          searchSortField ===
                          "authorLast"
                        }
                        onClick={() => {
                          setSearchSortField(
                            "authorLast"
                          );

                          setSearchPage(1);
                          setSelectedBookId(null);
                        }}
                      >
                        Author last
                      </button>

                      <button
                        type="button"
                        className={
                          searchSortField ===
                          "authorFirst"
                            ? "searchSortButton searchSortButtonActive"
                            : "searchSortButton"
                        }
                        aria-pressed={
                          searchSortField ===
                          "authorFirst"
                        }
                        onClick={() => {
                          setSearchSortField(
                            "authorFirst"
                          );

                          setSearchPage(1);
                          setSelectedBookId(null);
                        }}
                      >
                        Author first
                      </button>
                    </div>
                  </div>

                  <div className="searchControlGroup sortDirectionGroup">
                    <p className="searchControlLabel">
                      Order
                    </p>

                    <div
                      className="searchSortOptions"
                      role="group"
                      aria-label="Choose alphabetical direction"
                    >
                      <button
                        type="button"
                        className={
                          searchSortDirection ===
                          "asc"
                            ? "searchSortButton searchSortButtonActive"
                            : "searchSortButton"
                        }
                        aria-pressed={
                          searchSortDirection ===
                          "asc"
                        }
                        onClick={() => {
                          setSearchSortDirection(
                            "asc"
                          );

                          setSearchPage(1);
                          setSelectedBookId(null);
                        }}
                      >
                        A–Z
                      </button>

                      <button
                        type="button"
                        className={
                          searchSortDirection ===
                          "desc"
                            ? "searchSortButton searchSortButtonActive"
                            : "searchSortButton"
                        }
                        aria-pressed={
                          searchSortDirection ===
                          "desc"
                        }
                        onClick={() => {
                          setSearchSortDirection(
                            "desc"
                          );

                          setSearchPage(1);
                          setSelectedBookId(null);
                        }}
                      >
                        Z–A
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </section>

            {showSearchResults ? (
              <div className="searchResults">
                <div
                  ref={
                    searchResultsTopRef
                  }
                  className="searchResultsHeader"
                >
                  <h2>
                    {hasSearchQuery
                      ? "Search results"
                      : hasSearchDrilldown
                        ? "Stats drilldown"
                        : hasActiveSearchFilters
                          ? "Filtered books"
                          : "All books"}
                  </h2>

                  <p>
                    {hasSearchQuery
                      ? searchResultBooks.length ===
                        1
                        ? "1 book found"
                        : `${searchResultBooks.length} books found`
                      : hasSearchDrilldown
                        ? searchResultBooks.length ===
                          1
                          ? "1 source book from Stats"
                          : `${searchResultBooks.length} source books from Stats`
                        : hasActiveSearchFilters
                          ? searchResultBooks.length ===
                            1
                            ? "1 matching book"
                            : `${searchResultBooks.length} matching books`
                          : searchResultBooks.length ===
                            1
                          ? "1 book in library"
                          : `${searchResultBooks.length} books in library`}

                    {searchResultBooks.length >
                    SEARCH_PAGE_SIZE
                      ? ` · Page ${safeSearchPage} of ${totalSearchPages}`
                      : ""}
                  </p>
                </div>

                {renderSearchPaginationControls()}

                {searchResultBooks.length > 0 ? (
                  <>
                    <div className="searchResultList">
                      {pagedSearchResults.map(
                        (book) => {
                          const searchSeriesLabel =
                            formatSearchSeriesLabel(
                              book
                            );

                          return (
                            <button
                              key={
                                book.bookId
                              }
                              type="button"
                              className="searchResultCard searchResultButton"
                              onClick={() =>
                                setSelectedBookId(
                                  book.bookId
                                )
                              }
                            >
                              <h3>
                                {book.title}
                              </h3>

                              <p className="searchResultAuthor">
                                {
                                  book.author
                                }
                              </p>

                              {searchSeriesLabel ? (
                                <p className="searchResultSeries">
                                  {
                                    searchSeriesLabel
                                  }
                                </p>
                              ) : null}
                            </button>
                          );
                        }
                      )}
                    </div>

                    {renderSearchPaginationControls()}
                  </>
                ) : (
                  <p className="emptySearch">
                    {hasSearchQuery
                      ? hasActiveSearchFilters
                        ? "No books match that search and filter combination."
                        : "No books match that search."
                      : "No books match those filters."}
                  </p>
                )}
              </div>
            ) : (
              <div className="emptySearch">
                <p>
                  Search by title,
                  author, genre,
                  publisher, or
                  location.
                </p>

                <div className="paginationControls">
                  <button
                    type="button"
                    onClick={
                      showAllLibraryBooks
                    }
                  >
                    Show all books
                  </button>
                </div>
              </div>
            )}
          </section>
        )
      ) : activeTab === "wanted" ? (
        <section className="wantedPanel">
          <section className="wantedIntro">
            <h2>Wanted books</h2>
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

          <div className="searchControlGroup sortDirectionGroup">
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
            sortedWantedItems,
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
                                        {activeChallenge?.challengeId ===
                                        "abc-author"
                                          ? `${
                                              entry.naturalAuthorLetters?.join(
                                                "/"
                                              ) || "?"
                                            } author`
                                          : `${
                                              entry.naturalTitleLetter ||
                                              "?"
                                            } title`}
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
      ) : activeTab === "stats" ? (
        selectedBook ? (
          renderBookDetail(
            "Back to household business",
            backToStatsFromDetail
          )
        ) : (
          <section className="statsPanel">
            <section className="statsIntro">
              <h2>
                The collection by the
                numbers
              </h2>

              <p className="statsDataSource">
                {sharedLibraryStateIsAuthoritative
                  ? "Live household read data."
                  : "Sign in for live read data."}
              </p>
            </section>

          <nav
            className="statsJumpNav"
            aria-label="Jump to a statistics section"
          >
            <span className="statsJumpLabel">
              Explore
            </span>

            <div className="statsJumpList">
              <button
                type="button"
                className="statsJumpButton"
                onClick={() => {
                  scrollToStatsSection(
                    "stats-reading"
                  );
                }}
              >
                <span aria-hidden="true">
                  📖
                </span>

                <span>
                  Reading
                </span>
              </button>

              <button
                type="button"
                className="statsJumpButton"
                onClick={() => {
                  scrollToStatsSection(
                    "stats-representation"
                  );
                }}
              >
                <span aria-hidden="true">
                  🌈
                </span>

                <span>
                  Representation
                </span>
              </button>

              <button
                type="button"
                className="statsJumpButton"
                onClick={() => {
                  scrollToStatsSection(
                    "stats-data-health"
                  );
                }}
              >
                <span aria-hidden="true">
                  🧹
                </span>

                <span>
                  Completion
                </span>
              </button>

              <button
                type="button"
                className="statsJumpButton"
                onClick={() => {
                  scrollToStatsSection(
                    "stats-charts"
                  );
                }}
              >
                <span aria-hidden="true">
                  📊
                </span>

                <span>
                  Charts
                </span>
              </button>
            </div>
          </nav>

          <div className="statsOverviewGrid">
            {statsOverviewCards.map(
              (card) => (
                <article
                  key={card.label}
                  className={
                    card.onClick
                      ? "statsMetricCard statsDrilldownTarget"
                      : "statsMetricCard"
                  }
                  role={
                    card.onClick
                      ? "button"
                      : undefined
                  }
                  tabIndex={
                    card.onClick
                      ? 0
                      : undefined
                  }
                  aria-label={
                    card.ariaLabel
                  }
                  onClick={
                    card.onClick
                  }
                  onKeyDown={
                    card.onClick
                      ? (event) => {
                          handleStatsDrilldownKeyDown(
                            event,
                            card.onClick!
                          );
                        }
                      : undefined
                  }
                >
                  <span className="statsMetricLabel">
                    {card.label}
                  </span>

                  <AutoFitStatValue
                    value={
                      card.value
                    }
                  />

                  <span className="statsMetricMeta">
                    {card.meta}
                  </span>
                </article>
              )
            )}
          </div>

          <section
            id="stats-representation"
            className="statsSection"
          >
            <div className="statsSectionHeader">
              <div>
                <h2>
                  Representation
                </h2>
              </div>
            </div>

            <div className="statsRepresentationGrid">
              <StatsCompositionChart
                title="LGBTQ+ books"
                description="Books tagged LGBTQ+ compared with the rest of the library."
                rows={
                  lgbtqRepresentationRows
                }
                featuredKey="lgbtq"
                unitLabel="books"
                onRowSelect={
                  openLgbtqRepresentationDrilldown
                }
              />
            </div>
          </section>

          <section
            id="stats-reading"
            className="statsSection"
          >
            <div className="statsSectionHeader">
              <h2>
                Currently reading
              </h2>
            </div>

            {sharedReadingAttemptsAreAuthoritative ? (
              <div className="statsCurrentGrid">
                {statsCurrentReadingGroups.map(
                  (group) => (
                    <article
                      key={
                        group.readerId
                      }
                      className="statsReaderColumn"
                    >
                      <div className="statsReaderHeader">
                        <h3>
                          {group.label}
                        </h3>

                        <span>
                          {
                            group.items
                              .length
                          }{" "}
                          active
                        </span>
                      </div>

                      {group.items.length >
                      0 ? (
                        <div className="statsCurrentList">
                          {group.items.map(
                            ({
                              attempt,
                              book,
                            }) => (
                              <button
                                key={
                                  attempt.attempt_id
                                }
                                type="button"
                                className="statsCurrentBook"
                                disabled={!book}
                                onClick={() => {
                                  if (!book) {
                                    return;
                                  }

                                  openStatsBookDetail(
                                    book.bookId
                                  );
                                }}
                              >
                                <strong>
                                  {book?.title ??
                                    attempt.catalog_key}
                                </strong>

                                <span>
                                  {book?.author ??
                                    "Library book"}
                                </span>

                                <span className="statsCurrentProgress">
                                  {formatStatsReadingProgress(
                                    attempt,
                                    book
                                  )}
                                </span>
                              </button>
                            )
                          )}
                        </div>
                      ) : (
                        <p className="statsEmptyText">
                          Nothing active
                          right now.
                        </p>
                      )}
                    </article>
                  )
                )}
              </div>
            ) : (
              <p className="statsNotice">
                Sign in to CJade to
                load live current
                reads.
              </p>
            )}
          </section>

          <section
            id="stats-data-health"
            className="statsSection"
          >
            <div className="statsSectionHeader">
              <h2>
                Completion
              </h2>

              <p>
                {statsSummary.totalBooks.toLocaleString()}{" "}
                total books
              </p>
            </div>

            <div className="statsCoverageList">
              {statsCoverageRows.map(
                (row) => {
                  const percentage =
                    getStatsPercent(
                      row.complete,
                      statsSummary.totalBooks
                    );

                  return (
                    <div
                      key={row.label}
                      className="statsCoverageRow"
                    >
                      <div className="statsCoverageCopy">
                        <strong>
                          {row.label}
                        </strong>

                        <span>
                          {row.complete.toLocaleString()}{" "}
                          of{" "}
                          {statsSummary.totalBooks.toLocaleString()}{" "}
                          books
                        </span>
                      </div>

                      <div
                        className="statsCoverageTrack"
                        role="progressbar"
                        aria-label={`${row.label} coverage`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={
                          percentage
                        }
                      >
                        <span
                          className="statsCoverageFill"
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>

                      <strong className="statsCoveragePercent">
                        {percentage}%
                      </strong>
                    </div>
                  );
                }
              )}
            </div>
          </section>

          <section
              id="stats-charts"
              className="statsSection statsExplorer"
            >
            <div className="statsSectionHeader">
              <h2>
                Chart explorer
              </h2>

              <p>
                {
                  statsChartBookFacts
                    .length
                }{" "}
                books included
              </p>
            </div>

            <div className="statsControls">
              <label className="statsSelectField">
                <span>
                  Books to include
                </span>

                <select
                  value={statsDataset}
                  onChange={(event) => {
                    setStatsDataset(
                      event.target
                        .value as StatsDataset
                    );
                  }}
                >
                  {STATS_DATASET_OPTIONS.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="statsSelectField">
                <span>
                  Break down by
                </span>

                <select
                  value={
                    statsBreakdown
                  }
                  onChange={(event) => {
                    setStatsBreakdown(
                      event.target
                        .value as StatsBreakdown
                    );
                  }}
                >
                  {STATS_BREAKDOWN_OPTIONS.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>

            <div className="statsFilterToggles">
              <label className="statsFilterToggle">
                <input
                  type="checkbox"
                  checked={
                    statsProseOnly
                  }
                  onChange={(event) => {
                    setStatsProseOnly(
                      event.target.checked
                    );
                  }}
                />

                <span className="statsFilterToggleCopy">
                  <strong>
                    Prose only
                  </strong>

                  <span>
                    Exclude Manga /
                    Graphic Novels.
                  </span>
                </span>
              </label>

              <label className="statsFilterToggle">
                <input
                  type="checkbox"
                  checked={
                    statsLgbtqOnly
                  }
                  onChange={(event) => {
                    setStatsLgbtqOnly(
                      event.target.checked
                    );
                  }}
                />

                <span className="statsFilterToggleCopy">
                  <strong>
                    LGBTQ+
                  </strong>

                  <span>
                    Include only tagged
                    books.
                  </span>
                </span>
              </label>
            </div>

            {statsBreakdown ===
              "author" ? (
                <div className="statsDisplayControl">
                  <span className="statsDisplayLabel">
                    Count authors by
                  </span>

                  <div
                    className="statsDisplayOptions"
                    role="group"
                    aria-label="Choose whether author statistics count works or volumes"
                  >
                    {STATS_COUNT_MODE_OPTIONS.map(
                      (option) => {
                        const isActive =
                          statsCountMode ===
                          option.value;

                        return (
                          <button
                            key={
                              option.value
                            }
                            type="button"
                            className={
                              isActive
                                ? "statsDisplayButton statsDisplayButtonActive"
                                : "statsDisplayButton"
                            }
                            aria-pressed={
                              isActive
                            }
                            onClick={() => {
                              setStatsCountMode(
                                option.value
                              );
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>
              ) : null}

            <div className="statsDisplayControl">
              <span className="statsDisplayLabel">
                View as
              </span>

              <div
                className="statsDisplayOptions"
                role="group"
                aria-label="Choose chart display"
              >
                {STATS_DISPLAY_OPTIONS.map(
                  (option) => {
                    const isActive =
                      statsDisplay ===
                      option.value;

                    return (
                      <button
                        key={
                          option.value
                        }
                        type="button"
                        className={
                          isActive
                            ? "statsDisplayButton statsDisplayButtonActive"
                            : "statsDisplayButton"
                        }
                        aria-pressed={
                          isActive
                        }
                        onClick={() => {
                          setStatsDisplay(
                            option.value
                          );
                        }}
                      >
                        {
                          option.label
                        }
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <div className="statsExplorerSummary">
              <strong>
                {
                  activeStatsDataset.label
                }
              </strong>

              <span>
                {
                  activeStatsDataset.description
                }
              </span>

              <span>
                Grouped by{" "}
                {
                  activeStatsBreakdown.label
                }
              </span>

              {statsBreakdown ===
                "author" ? (
                  <span>
                    Counted as{" "}
                    {statsCountMode ===
                    "works"
                      ? "works"
                      : "volumes"}
                  </span>
                ) : null}

              {statsProseOnly ? (
                <span>
                  Manga / Graphic
                  Novels excluded
                </span>
              ) : null}

              {statsLgbtqOnly ? (
                <span>
                  LGBTQ+ books only
                </span>
              ) : null}
            </div>

            {statsBreakdown ===
              "author" ? (
                <p className="statsListNote">
                  Works count each
                  series once per
                  credited creator.
                  Standalone books
                  count individually,
                  and co-authored works
                  count once for each
                  creator.
                </p>
              ) : null}

            {DEBUG_MODE &&
            statsBreakdown ===
              "author" &&
            statsCountMode ===
              "works" ? (
              <details className="statsWorkDebugger">
                <summary className="statsWorkDebuggerSummary">
                  <span className="statsWorkDebuggerTitle">
                    🔍 Audit counted
                    works
                  </span>

                  <span className="statsWorkDebuggerMeta">
                    Show exactly what
                    increased an
                    author’s total
                  </span>
                </summary>

                <div className="statsWorkDebuggerContent">
                  <label className="statsSelectField statsWorkDebuggerAuthor">
                    <span>
                      Author to inspect
                    </span>

                    <select
                      value={
                        statsDebugAuthorKey
                      }
                      onChange={(
                        event
                      ) => {
                        setStatsDebugAuthorKey(
                          event.target
                            .value
                        );
                      }}
                    >
                      {statsDebugAuthorOptions.map(
                        (option) => (
                          <option
                            key={
                              option.key
                            }
                            value={
                              option.key
                            }
                          >
                            {
                              option.label
                            }{" "}
                            —{" "}
                            {
                              option.count
                            }{" "}
                            {option.count ===
                            1
                              ? "work"
                              : "works"}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  {statsWorkAudit ? (
                    <>
                      <div className="statsWorkAuditSummary">
                        <strong>
                          {
                            statsWorkAudit.authorLabel
                          }
                        </strong>

                        <span>
                          {statsWorkAudit.workCount.toLocaleString()}{" "}
                          {statsWorkAudit.workCount ===
                          1
                            ? "work"
                            : "works"}{" "}
                          counted from{" "}
                          {statsWorkAudit.sourceBookCount.toLocaleString()}{" "}
                          matching{" "}
                          {statsWorkAudit.sourceBookCount ===
                          1
                            ? "book"
                            : "books"}
                          .
                        </span>
                      </div>

                      <div className="statsWorkAuditGroups">
                        {statsWorkAudit.groups.map(
                          (group) => (
                            <details
                              key={
                                group.workKey
                              }
                              className={
                                group.workType ===
                                "standalone"
                                  ? "statsWorkAuditGroup statsWorkAuditGroupWarning"
                                  : "statsWorkAuditGroup"
                              }
                            >
                              <summary className="statsWorkAuditGroupSummary">
                                <span
                                  className={
                                    group.workType ===
                                    "standalone"
                                      ? "statsWorkAuditType statsWorkAuditTypeWarning"
                                      : "statsWorkAuditType"
                                  }
                                >
                                  {group.workType ===
                                  "series"
                                    ? "Series"
                                    : "Standalone"}
                                </span>

                                <span className="statsWorkAuditGroupCopy">
                                  <strong>
                                    {
                                      group.label
                                    }
                                  </strong>

                                  <span>
                                    {group.books.length.toLocaleString()}{" "}
                                    source{" "}
                                    {group.books.length ===
                                    1
                                      ? "book"
                                      : "books"}
                                  </span>
                                </span>

                                <span className="statsWorkAuditGroupCount">
                                  +1 work
                                </span>
                              </summary>

                              <div className="statsWorkAuditGroupContent">
                                <p className="statsWorkAuditReason">
                                  {
                                    group.reason
                                  }
                                </p>

                                <p className="statsWorkAuditKey">
                                  <span>
                                    Work key
                                  </span>

                                  <code>
                                    {
                                      group.workKey
                                    }
                                  </code>
                                </p>

                                <div className="statsWorkAuditBookList">
                                  {group.books.map(
                                    (
                                      auditBook
                                    ) => (
                                      <article
                                        key={
                                          auditBook.bookId
                                        }
                                        className="statsWorkAuditBook"
                                      >
                                        <div className="statsWorkAuditBookHeader">
                                          <strong>
                                            {
                                              auditBook.title
                                            }
                                          </strong>

                                          <span
                                            className={
                                              auditBook.countedAsNewWork
                                                ? "statsWorkAuditBookStatus statsWorkAuditBookStatusCounted"
                                                : "statsWorkAuditBookStatus"
                                            }
                                          >
                                            {auditBook.countedAsNewWork
                                              ? "+1 work"
                                              : "Grouped with existing work"}
                                          </span>
                                        </div>

                                        <dl className="statsWorkAuditFields">
                                          <div>
                                            <dt>
                                              seriesTitle
                                            </dt>

                                            <dd>
                                              {auditBook.seriesTitle ||
                                                "(blank)"}
                                            </dd>
                                          </div>

                                          <div>
                                            <dt>
                                              series
                                            </dt>

                                            <dd>
                                              {auditBook.rawSeries ||
                                                "(blank)"}
                                            </dd>
                                          </div>

                                          <div>
                                            <dt>
                                              seriesNumber
                                            </dt>

                                            <dd>
                                              {auditBook.seriesNumber ||
                                                "(blank)"}
                                            </dd>
                                          </div>

                                          <div>
                                            <dt>
                                              catalogKey
                                            </dt>

                                            <dd>
                                              {auditBook.catalogKey ||
                                                "(blank)"}
                                            </dd>
                                          </div>
                                        </dl>
                                      </article>
                                    )
                                  )}
                                </div>
                              </div>
                            </details>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="statsEmptyText">
                      Choose an author
                      to inspect.
                    </p>
                  )}
                </div>
              </details>
            ) : null}

            {statsBreakdownRows.length >
            0 ? (
              <>
                {statsDisplay ===
                "bars" ? (
                  <div className="statsBreakdownList">
                    {pagedStatsBreakdownRows.map(
                      (row) => {
                        const relativeWidth =
                          statsBreakdownMaxCount >
                          0
                            ? Math.round(
                                (row.count /
                                  statsBreakdownMaxCount) *
                                  100
                              )
                            : 0;

                        return (
                          <article
                            key={
                              row.label
                            }
                            className="statsBreakdownRow statsDrilldownTarget"
                            role="button"
                            tabIndex={0}
                            aria-label={`View ${row.label} books in Search`}
                            onClick={() => {
                              openStatsBreakdownDrilldown(
                                row
                              );
                            }}
                            onKeyDown={(event) => {
                              handleStatsDrilldownKeyDown(
                                event,
                                () => {
                                  openStatsBreakdownDrilldown(
                                    row
                                  );
                                }
                              );
                            }}
                          >
                            <div className="statsBreakdownHeading">
                              <strong>
                                {
                                  row.label
                                }
                              </strong>

                              <span>
                                {row.count.toLocaleString()}{" "}
                                ·{" "}
                                {
                                  row.percentage
                                }
                                %
                              </span>
                            </div>

                            <div
                              className="statsBreakdownTrack"
                              aria-hidden="true"
                            >
                              <span
                                className="statsBreakdownFill"
                                style={{
                                  width: `${relativeWidth}%`,
                                }}
                              />
                            </div>
                          </article>
                        );
                      })}
                  </div>
                ) : statsDisplay ===
                  "pie" ? (
                  <div className="statsPieLayout">
                    <div
                      className="statsPieChart"
                      role="img"
                      aria-label={`${activeStatsDataset.label} grouped by ${activeStatsBreakdown.label}`}
                    >
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <PieChart
                          accessibilityLayer
                        >
                          <Pie
                            data={
                              statsPieRows
                            }
                            dataKey="count"
                            nameKey="label"
                            innerRadius="52%"
                            outerRadius="82%"
                            paddingAngle={2}
                            stroke="#fff8e9"
                            strokeWidth={2}
                            isAnimationActive={
                              false
                            }
                          />

                          <Tooltip
                            formatter={(
                              value,
                              _name,
                              item
                            ) => [
                              Number(
                                value ??
                                  0
                              ).toLocaleString(),
                              String(
                                item.payload.label ??
                                  "Books"
                              ),
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      <div
                        className="statsPieCenter"
                        aria-hidden="true"
                      >
                        <strong>
                          {statsBreakdownTotal.toLocaleString()}
                        </strong>

                        <span>
                          {statsBreakdownTotal ===
                          1
                            ? statsCountSingular
                            : statsCountPlural}
                        </span>
                      </div>
                    </div>

                    <div className="statsPieLegend">
                      {statsPieRows.map(
                        (row) => (
                          <div
                            key={
                              row.pieKey
                            }
                            className="statsPieLegendItem"
                          >
                            <span
                              className="statsPieSwatch"
                              style={{
                                backgroundColor:
                                  row.fill,
                              }}
                              aria-hidden="true"
                            />

                            <span className="statsPieLegendLabel">
                              {
                                row.legendLabel
                              }
                            </span>

                            <span className="statsPieLegendValue">
                              {row.count.toLocaleString()}{" "}
                              ·{" "}
                              {
                                row.percentage
                              }
                              %
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="statsPlainList">
                    {pagedStatsBreakdownRows.map(
                        (
                          row,
                          index
                        ) => (
                          <article
                            key={
                              row.label
                            }
                            className="statsPlainRow statsDrilldownTarget"
                            role="button"
                            tabIndex={0}
                            aria-label={`View ${row.label} books in Search`}
                            onClick={() => {
                              openStatsBreakdownDrilldown(
                                row
                              );
                            }}
                            onKeyDown={(event) => {
                              handleStatsDrilldownKeyDown(
                                event,
                                () => {
                                  openStatsBreakdownDrilldown(
                                    row
                                  );
                                }
                              );
                            }}
                          >
                            <span className="statsPlainRank">
                              {(
                                safeStatsPage - 1
                              ) *
                                STATS_PAGE_SIZE +
                                index +
                                1}
                            </span>

                            <div className="statsPlainCopy">
                              <strong>
                                {
                                  row.label
                                }
                              </strong>

                              <span>
                                {formatStatsBreakdownCount(
                                  row.count
                                )}{" "}
                                ·{" "}
                                {
                                  row.percentage
                                }
                                %
                              </span>
                            </div>
                          </article>
                        )
                      )}
                  </div>
                )}

                {statsDisplay !==
                  "pie" &&
                statsBreakdownRows.length >
                  0 ? (
                  <>
                    <p className="statsListNote">
                      Showing{" "}
                      {firstStatsRowNumber}
                      –{lastStatsRowNumber} of{" "}
                      {
                        statsBreakdownRows.length
                      }{" "}
                      categories.
                    </p>

                    {totalStatsPages > 1 ? (
                      <div className="paginationControls">
                        <button
                          type="button"
                          onClick={() => {
                            setStatsPage(
                              (page) =>
                                Math.max(
                                  1,
                                  page - 1
                                )
                            );
                          }}
                          disabled={
                            safeStatsPage === 1
                          }
                        >
                          Previous
                        </button>

                        <span>
                          Page {safeStatsPage} of{" "}
                          {totalStatsPages}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setStatsPage(
                              (page) =>
                                Math.min(
                                  totalStatsPages,
                                  page + 1
                                )
                            );
                          }}
                          disabled={
                            safeStatsPage ===
                            totalStatsPages
                          }
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {statsDisplay ===
                  "pie" &&
                statsBreakdownRows.length >
                  statsPieRows.length ? (
                  <p className="statsListNote">
                    Smaller categories
                    are grouped
                    adaptively. Up to 14
                    named categories are
                    shown before the
                    remainder becomes
                    Other.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="statsEmptyText">
                No books are available
                for this combination.
              </p>
            )}
          </section>
        </section>
        )
      ) : activeTab === "update" ? (
        selectedBook ? (
          renderBookDetail(
            "Back to review list",
            backToUpdateFromDetail,
            updateBooks
          )
        ) : (
          <section className="updatePanel">
            <section className="updateIntro">
              <h2>
                Workbook helper
              </h2>
            </section>

            <section className="statsSection">
              <div className="statsSectionHeader">
                <h2>
                  Workbook coverage
                </h2>

                <p>
                  {books.length.toLocaleString()}{" "}
                  total books
                </p>
              </div>

              <div className="statsCoverageList">
                {updateCoverageRows.map(
                  (row) => {
                    const missing =
                      books.length -
                      row.complete;

                    const percentage =
                      getStatsPercent(
                        row.complete,
                        books.length
                      );

                    return (
                      <div
                        key={row.label}
                        className="statsCoverageRow updateCoverageRowButton"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open the ${row.label} update queue`}
                        onClick={() => {
                          openUpdateCoverageQueue(
                            row
                          );
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" ||
                            event.key === " "
                          ) {
                            event.preventDefault();

                            openUpdateCoverageQueue(
                              row
                            );
                          }
                        }}
                      >
                        <div className="statsCoverageCopy">
                          <strong>
                            {row.label}
                          </strong>

                          <span>
                            {row.complete.toLocaleString()}{" "}
                            complete
                            {missing > 0
                              ? ` · ${missing.toLocaleString()} to check`
                              : " · none missing"}
                          </span>
                        </div>

                        <div
                          className="statsCoverageTrack"
                          role="progressbar"
                          aria-label={`${row.label} coverage`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={
                            percentage
                          }
                        >
                          <span
                            className="statsCoverageFill"
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>

                        <strong className="statsCoveragePercent">
                          {percentage}%
                        </strong>
                      </div>
                    );
                  }
                )}
              </div>
            </section>

            <div
              id="update-reasearch-queues"
              className="updateFieldGrid"
              role="group"
              aria-label="Choose review queues"
            >
              {UPDATE_FIELD_OPTIONS.map(
                (option) => {
                  const isSelected =
                    selectedUpdateFields[
                      option.field
                    ];

                  const fieldCount =
                    updateFieldCounts[
                      option.field
                    ];

                  return (
                    <button
                      key={
                        option.field
                      }
                      type="button"
                      className={
                        isSelected
                          ? "updateFieldButton updateFieldButtonActive"
                          : "updateFieldButton"
                      }
                      aria-pressed={
                        isSelected
                      }
                      onClick={() => {
                        setSelectedBookId(
                          null
                        );

                        if (
                          option.field ===
                            "classificationReview" &&
                          selectedClassificationReviewField
                        ) {
                          setSelectedClassificationReviewField(
                            null
                          );

                          setSelectedUpdateFields(
                            (currentFields) => ({
                              ...currentFields,
                              classificationReview:
                                true,
                            })
                          );

                          return;
                        }

                        if (
                          option.field ===
                          "classificationReview"
                        ) {
                          setSelectedClassificationReviewField(
                            null
                          );
                        }

                        setSelectedUpdateFields(
                          (currentFields) => ({
                            ...currentFields,

                            [option.field]:
                              !currentFields[
                                option.field
                              ],
                          })
                        );
                      }}
                    >
                      <span
                        className="updateFieldIcon"
                        aria-hidden="true"
                      >
                        {
                          option.icon
                        }
                      </span>

                      <span className="updateFieldCopy">
                        <strong>
                          {
                            option.label
                          }
                        </strong>

                        <span>
                          {
                            option.description
                          }
                        </span>
                      </span>

                      <span className="updateFieldCount">
                        {fieldCount}
                      </span>
                    </button>
                  );
                }
              )}
            </div>

            <section
              id="update-results"
              className="updateResults"
            >
              <div className="updateResultsHeader">
                <h2>
                  Field research queue
                </h2>

                <p>
                  {selectedUpdateFieldList
                    .length === 0
                    ? "No fields selected"
                    : updateBooks.length ===
                        1
                      ? "1 book"
                      : `${updateBooks.length} books`}
                </p>
              </div>

              {selectedUpdateFieldList
                .length === 0 ? (
                <p className="emptySearch">
                  Choose at least one
                  research or review
                  queue above.
                </p>
              ) : updateBooks.length >
                0 ? (
                <div className="updateList">
                  {updateBooks.map(
                    (book) => {
                      const missingFields =
                        getMissingUpdateFields(
                          book
                        ).filter(
                          (field) =>
                            selectedUpdateFieldList.includes(
                              field
                            )
                        );

                      const classificationReviewIssues =
                        selectedUpdateFieldList.includes(
                          "classificationReview"
                        )
                          ? getClassificationReviewIssues(
                              book
                            ).filter(
                              (issue) =>
                                !selectedClassificationReviewField ||
                                issue.field ===
                                  selectedClassificationReviewField
                            )
                          : [];

                      const locationParts =
                        [
                          book.room &&
                          book.room !==
                            book.bookcase
                            ? book.room
                            : "",

                          book.bookcase,
                          book.shelf,

                          book.row !==
                          "Main"
                            ? book.row
                            : "",
                        ].filter(
                          Boolean
                        );

                      return (
                        <button
                          key={
                            book.bookId
                          }
                          type="button"
                          className="updateCard"
                          onClick={() => {
                            openUpdateBookDetail(
                              book.bookId
                            );
                          }}
                        >
                          <div className="updateCardHeading">
                            <div>
                              <h3>
                                {
                                  book.title
                                }
                              </h3>

                              <p className="updateAuthor">
                                {
                                  book.author
                                }
                              </p>
                            </div>

                            {book.shelfPosition !=
                            null ? (
                              <span className="updatePosition">
                                Position{" "}
                                {
                                  book.shelfPosition
                                }
                              </span>
                            ) : null}
                          </div>

                          <div className="updateMissingBadges">
                            {missingFields.map(
                              (field) =>
                                field ===
                                "classificationReview"
                                  ? classificationReviewIssues.map(
                                      (
                                        issue
                                      ) => (
                                        <span
                                          key={`classificationReview-${issue.field}`}
                                          className="updateMissingBadge"
                                          title={
                                            issue.workbookValue
                                              ? `${issue.label} workbook value: ${issue.workbookValue}`
                                              : `${issue.label} is blank in the exported workbook data`
                                          }
                                        >
                                          {
                                            issue.label
                                          }
                                          :{" "}
                                          {
                                            issue.displayValue
                                          }
                                        </span>
                                      )
                                    )
                                  : (
                                      <span
                                        key={
                                          field
                                        }
                                        className="updateMissingBadge"
                                      >
                                        {
                                          UPDATE_FIELD_LABELS[
                                            field
                                          ]
                                        }
                                      </span>
                                    )
                            )}
                          </div>

                          <p className="updateLocation">
                            {locationParts.join(
                              " · "
                            )}
                          </p>
                        </button>
                      );
                    }
                  )}
                </div>
              ) : (
                <section className="updateComplete">
                  <span
                    aria-hidden="true"
                  >
                    ✨
                  </span>

                  <div>
                    <h3>
                      Queue complete
                    </h3>

                    <p>
                      Every book has
                      the selected
                      information.
                    </p>
                  </div>
                </section>
              )}
            </section>
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