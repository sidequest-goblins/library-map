import { useEffect, useMemo, useState } from "react";
import "./App.css";

import BookcaseView from "./components/BookcaseView";
import {
  getBookcasesFromBooks,
  getShelvesForBookcase,
  searchBooks,
} from "./data/librarySelectors";
import type { Book } from "./data/libraryTypes";

type AppTab = "search" | "map";
const SEARCH_PAGE_SIZE = 25;

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

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [loadError, setLoadError] = useState("");
  const [selectedBookcaseId, setSelectedBookcaseId] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);

  useEffect(() => {
    async function loadBooks() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/library-books.json`);

        if (!response.ok) {
          throw new Error(`Failed to load library data: ${response.status}`);
        }

        const loadedBooks = (await response.json()) as Book[];

        setBooks(loadedBooks);
        setLoadStatus("ready");
      } catch (error) {
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    loadBooks();
  }, []);

  const bookcases = useMemo(() => getBookcasesFromBooks(books), [books]);

  useEffect(() => {
    if (bookcases.length === 0) return;

    const selectedStillExists = bookcases.some(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    );

    if (!selectedBookcaseId || !selectedStillExists) {
      setSelectedBookcaseId(bookcases[0].bookcaseId);
    }
  }, [bookcases, selectedBookcaseId]);

  const selectedBookcase =
    bookcases.find(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    ) ?? bookcases[0];

  const shelves = selectedBookcase
    ? getShelvesForBookcase(books, selectedBookcase)
    : [];

  const searchResults = useMemo(
    () => searchBooks(books, searchQuery),
    [books, searchQuery]
  );

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

  function renderBookDetail(backLabel: string, onBack: () => void) {
    if (!selectedBook) return null;

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

        <article className="bookDetailCard">
          <div className="bookDetailHero">
            <div className="bookCoverFrame">
              {selectedBook.coverImage ? (
                <img
                  className="bookCoverImage"
                  src={publicAssetPath(selectedBook.coverImage)}
                  alt={`Cover of ${selectedBook.title}`}
                  loading="lazy"
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
  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Library Map</p>
          <h1>
            {activeTab === "map" && selectedBookcase
              ? selectedBookcase.bookcase
              : "Search"}
          </h1>
          <p className="bookcaseMeta">
            {activeTab === "map" && selectedBookcase
              ? `${selectedBookcase.room} · ${
                  selectedBookcase.hasRisers ? "Has risers" : "No risers"
                }`
              : `${books.length} books loaded`}
          </p>
        </div>

        <nav className="appTabs" aria-label="Library views">
          <button
            type="button"
            className={activeTab === "search" ? "appTab active" : "appTab"}
            onClick={() => {
              setActiveTab("search");
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
        </nav>

        {activeTab === "map" && selectedBookcase ? (
          <label className="bookcasePicker">
            <span>Bookcase</span>
            <select
              value={selectedBookcaseId}
              onChange={(event) => {
                setSelectedBookcaseId(event.target.value);
                setSelectedBookId(null);
              }}
            >
              {bookcases.map((bookcase) => (
                <option key={bookcase.bookcaseId} value={bookcase.bookcaseId}>
                  {bookcase.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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
      ) : selectedBook ? (
        renderBookDetail("Back to map", () => setSelectedBookId(null))
      ) : selectedBookcase && shelves.length > 0 ? (
        <BookcaseView
          title={selectedBookcase.bookcase}
          shelves={shelves}
          onBookSelect={setSelectedBookId}
        />
      ) : (
        <section className="emptyBookcase">
          <h2>{selectedBookcase?.bookcase ?? "No bookcase selected"}</h2>
          <p>No books added here yet.</p>
        </section>
      )}
    </main>
  );
}