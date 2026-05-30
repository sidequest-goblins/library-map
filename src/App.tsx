import { useState } from "react";
import "./App.css";

import BookcaseView from "./components/BookcaseView";
import { demoBookcases, demoBooks } from "./data/demoLibraryData";
import { getShelvesForBookcase } from "./data/librarySelectors";

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

  const selectedBookcase =
    bookcases.find(
      (bookcase) => bookcase.bookcaseId === selectedBookcaseId
    ) ?? bookcases[0];

  const shelves = getShelvesForBookcase(demoBooks, selectedBookcase);

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

        <button type="button" className="cacheButton" onClick={clearAppCache}>
          Clear cache
        </button>
      </header>

      <BookcaseView title={selectedBookcase.bookcase} shelves={shelves} />
    </main>
  );
}