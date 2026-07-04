import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import BookcaseView from "./components/BookcaseView";
import {
  getBookcasesFromBooks,
  getShelvesForBookcase,
  searchBooks,
} from "./data/librarySelectors";
import type { Book, WantedBook, WantedLists } from "./data/libraryTypes";

type AppTab = "search" | "wanted" | "map";

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

function normalizeInlineSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
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

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [wantedLists, setWantedLists] = useState<WantedLists>(EMPTY_WANTED_LISTS);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [loadError, setLoadError] = useState("");
  const [selectedBookcaseId, setSelectedBookcaseId] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [wantedQuery, setWantedQuery] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const mapReturnPositionRef = useRef<MapReturnPosition | null>(null);

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
        const [booksResponse, loadedWantedLists] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}data/library-books.json`),
          loadWantedLists(),
        ]);

        if (!booksResponse.ok) {
          throw new Error(`Failed to load library data: ${booksResponse.status}`);
        }

        const loadedBooks = (await booksResponse.json()) as Book[];

        setBooks(loadedBooks);
        setWantedLists(loadedWantedLists);
        setLoadStatus("ready");
      } catch (error) {
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    loadBooks();
  }, []);

  const bookcases = useMemo(() => getBookcasesFromBooks(books), [books]);

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

  const searchResults = useMemo(
    () => searchBooks(books, searchQuery),
    [books, searchQuery]
  );

  const filteredToBuy = useMemo(
    () => filterWantedItems(wantedLists.toBuy, wantedQuery),
    [wantedLists.toBuy, wantedQuery]
  );

  const filteredSeriesToComplete = useMemo(
    () => filterWantedItems(wantedLists.seriesToComplete, wantedQuery),
    [wantedLists.seriesToComplete, wantedQuery]
  );

  const wantedTotal = wantedLists.toBuy.length + wantedLists.seriesToComplete.length;
  const filteredWantedTotal = filteredToBuy.length + filteredSeriesToComplete.length;

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

    const readBy = [
      selectedBook.cj ? "CJ" : "",
      selectedBook.jc ? "JC" : "",
    ].filter(Boolean);

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
                  <span className="detailChip">{selectedBook.format}</span>
                ) : null}

                {selectedBook.lgbtq ? (
                  <span className="detailChip">LGBTQ+</span>
                ) : null}

                {selectedBook.seriesTitle ? (
                  <span className="detailChip">Series</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bookDetailSections">
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
              <p className="detailLabel">Book details</p>
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

                {selectedBook.seriesTitle ? (
                  <div>
                    <dt>Series</dt>
                    <dd>
                      {selectedBook.seriesTitle}
                      {selectedBook.seriesNumber != null
                        ? ` #${selectedBook.seriesNumber}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="detailSection">
              <p className="detailLabel">Read by</p>

              {readBy.length > 0 ? (
                <div className="readStatusList">
                  {selectedBook.cj ? (
                    <span className="readStatusChip">CJ ✓</span>
                  ) : null}

                  {selectedBook.jc ? (
                    <span className="readStatusChip">JC ✓</span>
                  ) : null}
                </div>
              ) : (
                <p className="detailMuted">Not marked read yet.</p>
              )}
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
            {items.map((item) => (
              <article key={item.wantedId} className="wantedCard">
                <div>
                  <h3>{item.title}</h3>
                  <p className="wantedAuthor">
                    {item.author || "Unknown author"}
                  </p>
                </div>

                {item.series ? (
                  <p className="wantedSeries">{item.series}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="emptySearch">{emptyText}</p>
        )}
      </section>
    );
  }

  const headerTitle =
    activeTab === "map" && selectedBookcase
      ? selectedBookcase.bookcase
      : activeTab === "wanted"
        ? "Wanted"
        : "Search";

  const headerMeta =
    activeTab === "map" && selectedBookcase
      ? selectedBookcase.hasRisers
        ? `${selectedBookcase.bookcase} · Risers`
        : selectedBookcase.room
      : activeTab === "wanted"
        ? `${wantedTotal} wanted ${wantedTotal === 1 ? "book" : "books"}`
        : `${books.length} books loaded`;

  return (
    <main className="appShell">
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
            className={activeTab === "wanted" ? "appTab active" : "appTab"}
            onClick={() => {
              setActiveTab("wanted");
              setSelectedBookId(null);
            }}
          >
            Wanted
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
        </nav>

        <button type="button" className="cacheButton" onClick={clearAppCache}>
          Clear cache
        </button>
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
            <label className="librarySearch">
              <span>Search books</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchPage(1);
                  setSelectedBookId(null);
                }}
                placeholder="Title, author, genre, publisher, location..."
              />
            </label>

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
                      {pagedSearchResults.map((book) => (
                        <button
                          key={book.bookId}
                          type="button"
                          className="searchResultCard searchResultButton"
                          onClick={() => setSelectedBookId(book.bookId)}
                        >
                          <h3>{book.title}</h3>
                          <p className="searchResultAuthor">{book.author}</p>
                        </button>
                      ))}
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

          <label className="librarySearch wantedSearch">
            <span>Search wanted books</span>
            <input
              type="search"
              value={wantedQuery}
              onChange={(event) => setWantedQuery(event.target.value)}
              placeholder="Title, author, or series..."
            />
          </label>

          <div className="wantedSummary">
            <span>{wantedTotal} total</span>
            {wantedQuery.trim() ? <span>{filteredWantedTotal} matching</span> : null}
          </div>

          {renderWantedSection(
            "To Buy",
            filteredToBuy,
            wantedQuery.trim()
              ? "No to-buy books match that search."
              : "No to-buy books added yet."
          )}

          {renderWantedSection(
            "Series to Complete",
            filteredSeriesToComplete,
            wantedQuery.trim()
              ? "No missing-series books match that search."
              : "No missing-series books added yet."
          )}
        </section>
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