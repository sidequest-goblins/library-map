import { useState } from "react";
import "./App.css";

import BookcaseView, { type BookcaseShelf } from "./components/BookcaseView";
import { type Spine } from "./components/ShelfRow";

type Bookcase = {
  id: string;
  room: string;
  title: string;
  hasRisers: boolean;
  shelves: BookcaseShelf[];
};

function widthFor(i: number): Spine["width"] {
  if (i % 10 === 0) return "l";
  if (i % 3 === 0) return "s";
  return "m";
}

function heightFor(i: number): Spine["height"] {
  if (i % 8 === 0) return "tall";
  if (i % 3 === 0) return "short";
  return "medium";
}

function makeShelf(bookcaseId: string, label: string, count: number): BookcaseShelf {
  const spines: Spine[] = Array.from({ length: count }).map((_, i) => ({
    id: `${bookcaseId}-${label}-${i + 1}`,
    title: `Book ${i + 1}`,
    width: widthFor(i),
    height: heightFor(i),
  }));

  return {
    id: `${bookcaseId}-${label}`,
    label,
    spines,
  };
}

const bookcases: Bookcase[] = [
  {
    id: "office-main-riser",
    room: "Office",
    title: "Main Riser Shelf",
    hasRisers: true,
    shelves: [
      makeShelf("office-main-riser", "Top Shelf", 30),
      makeShelf("office-main-riser", "Shelf 2", 26),
      makeShelf("office-main-riser", "Shelf 3", 28),
      makeShelf("office-main-riser", "Shelf 4", 24),
      makeShelf("office-main-riser", "Bottom Shelf", 22),
    ],
  },
  {
    id: "rainbow-bookcase",
    room: "Office",
    title: "Rainbow Bookcase",
    hasRisers: false,
    shelves: [
      makeShelf("rainbow-bookcase", "Top Shelf", 18),
      makeShelf("rainbow-bookcase", "Middle Shelf", 22),
      makeShelf("rainbow-bookcase", "Bottom Shelf", 20),
    ],
  },
  {
    id: "living-room-bookcase",
    room: "Living Room",
    title: "Living Room Bookcase",
    hasRisers: false,
    shelves: [
      makeShelf("living-room-bookcase", "Top Shelf", 24),
      makeShelf("living-room-bookcase", "Shelf 2", 28),
      makeShelf("living-room-bookcase", "Shelf 3", 25),
      makeShelf("living-room-bookcase", "Bottom Shelf", 21),
    ],
  },
  {
    id: "bedroom-hutch",
    room: "Bedroom",
    title: "Bedroom Hutch",
    hasRisers: false,
    shelves: [
      makeShelf("bedroom-hutch", "Top Shelf", 14),
      makeShelf("bedroom-hutch", "Middle Shelf", 16),
      makeShelf("bedroom-hutch", "Bottom Shelf", 12),
    ],
  },
  {
    id: "yellow-side-table",
    room: "Living Room",
    title: "Yellow Side Table",
    hasRisers: false,
    shelves: [
      makeShelf("yellow-side-table", "Top Shelf", 10),
      makeShelf("yellow-side-table", "Bottom Shelf", 12),
    ],
  },
];

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
  const [selectedBookcaseId, setSelectedBookcaseId] = useState(bookcases[0].id);

  const selectedBookcase =
    bookcases.find((bookcase) => bookcase.id === selectedBookcaseId) ?? bookcases[0];

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Library Map</p>
          <h1>{selectedBookcase.title}</h1>
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
              <option key={bookcase.id} value={bookcase.id}>
                {bookcase.room} — {bookcase.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="cacheButton" onClick={clearAppCache}>
          Clear cache
        </button>
      </header>

      <BookcaseView title={selectedBookcase.title} shelves={selectedBookcase.shelves} />
    </main>
  );
}