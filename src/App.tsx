import { useMemo, useState } from "react";
import "./App.css";

import BookcaseView from "./components/BookcaseView";
import { demoBookcases, demoBooks } from "./data/demoLibraryData";
import {
  getShelvesForBookcase,
  searchBooks,
} from "./data/librarySelectors";

const bookcases = [...demoBookcases].sort(
  (a, b) => a.sortOrder - b.sortOrder
);

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
  const [selectedBookcaseId, setSelectedBookcaseId] = useState(
    bookcases[0].bookcaseId
  );
  const [searchQuery, setSearchQuery] = useState("");

  const selectedBookcase =
    bookcases.find(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    ) ?? bookcases[0];

  const shelves = getShelvesForBookcase(demoBooks, selectedBookcase);
  const searchResults = useMemo(
    () => searchBooks(demoBooks, searchQuery),
    [searchQuery]
  );

const isSearching = searchQuery.trim().length > 0;

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Library Map</p>
          <h1>{selectedBookcase.bookcase}</h1>
          <p className="bookcaseMeta">
            {selectedBookcase.room} ·{" "}
            {selectedBookcase.hasRisers ? "Has risers" : "No risers"}
          </p>
        </div>

        <label className="bookcasePicker">
          <span>Bookcase</span>
          <select
            value={selectedBookcaseId}
            onChange={(event) => setSelectedBookcaseId(event.target.value)}
          >
            {bookcases.map((bookcase) => (
              <option
                key={bookcase.bookcaseId}
                value={bookcase.bookcaseId}
              >
                {bookcase.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="librarySearch">
          <span>Search books</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Title, author, series, location..."
          />
        </label>

        <button type="button" className="cacheButton" onClick={clearAppCache}>
          Clear cache
        </button>
      </header>

      {isSearching ? (
        <section className="searchResults">
          <div className="searchResultsHeader">
            <h2>Search results</h2>
            <p>
              {searchResults.length === 1
                ? "1 book found"
                : `${searchResults.length} books found`}
            </p>
          </div>

          {searchResults.length > 0 ? (
            <div className="searchResultList">
              {searchResults.map((book) => (
                <article key={book.bookId} className="searchResultCard">
                  <h3>{book.title}</h3>
                  <p className="searchResultAuthor">{book.author}</p>
                  <p className="searchResultLocation">
                    {book.room} · {book.bookcase} · {book.shelf}
                    {book.row !== "Main" ? ` · ${book.row}` : ""}
                  </p>
                  {book.series ? (
                    <p className="searchResultSeries">
                      {book.series}
                      {book.seriesNumber ? ` #${book.seriesNumber}` : ""}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="emptySearch">No books match that search.</p>
          )}
        </section>
      ) : shelves.length > 0 ? (
        <BookcaseView title={selectedBookcase.bookcase} shelves={shelves} />
      ) : (
        <section className="emptyBookcase">
          <h2>{selectedBookcase.bookcase}</h2>
          <p>No books added here yet.</p>
        </section>
      )}
    </main>
  );
}