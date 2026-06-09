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

type AppTab = "search" | "map";

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
  const [activeTab, setActiveTab] = useState<AppTab>("search");
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

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Library Map</p>
          <h1>{activeTab === "map" ? selectedBookcase.bookcase : "Search"}</h1>
          <p className="bookcaseMeta">
            {activeTab === "map"
              ? `${selectedBookcase.room} · ${
                  selectedBookcase.hasRisers ? "Has risers" : "No risers"
                }`
              : `${demoBooks.length} demo books loaded`}
          </p>
        </div>

        <nav className="appTabs" aria-label="Library views">
          <button
            type="button"
            className={activeTab === "search" ? "appTab active" : "appTab"}
            onClick={() => setActiveTab("search")}
          >
            Search
          </button>

          <button
            type="button"
            className={activeTab === "map" ? "appTab active" : "appTab"}
            onClick={() => setActiveTab("map")}
          >
            Map
          </button>
        </nav>

        {activeTab === "map" ? (
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

      {activeTab === "search" ? (
        <section className="searchPanel">
          <label className="librarySearch">
            <span>Search books</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Title, author, series, location..."
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
            </div>
          ) : (
            <p className="emptySearch">Type something to search your library.</p>
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