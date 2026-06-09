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
        const response = await fetch("/data/library-books.json");

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
              onChange={(event) => setSelectedBookcaseId(event.target.value)}
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
          <section className="bookDetailPanel">
            <button
              type="button"
              className="backButton"
              onClick={() => setSelectedBookId(null)}
            >
              ← Back to results
            </button>

            <div className="bookDetailCard">
              <div>
                <p className="detailLabel">Title</p>
                <h2>{selectedBook.title}</h2>
              </div>

              <div>
                <p className="detailLabel">Author</p>
                <p>{selectedBook.author}</p>
              </div>

              <div>
                <p className="detailLabel">Location</p>
                <p>
                  {selectedBook.bookcase} · {selectedBook.shelf}
                  {selectedBook.row !== "Main" ? ` · ${selectedBook.row}` : ""}
                  {selectedBook.room &&
                  selectedBook.room !== selectedBook.bookcase
                    ? ` · ${selectedBook.room}`
                    : ""}
                </p>
              </div>

              {selectedBook.genre ? (
                <div>
                  <p className="detailLabel">Genre</p>
                  <p>{selectedBook.genre}</p>
                </div>
              ) : null}

              {selectedBook.publisher ? (
                <div>
                  <p className="detailLabel">Publisher</p>
                  <p>{selectedBook.publisher}</p>
                </div>
              ) : null}
            </div>
          </section>
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
                Type something to search your library.
              </p>
            )}
          </section>
        )
      ) : selectedBookcase && shelves.length > 0 ? (
        <BookcaseView title={selectedBookcase.bookcase} shelves={shelves} />
      ) : (
        <section className="emptyBookcase">
          <h2>{selectedBookcase?.bookcase ?? "No bookcase selected"}</h2>
          <p>No books added here yet.</p>
        </section>
      )}
    </main>
  );
}