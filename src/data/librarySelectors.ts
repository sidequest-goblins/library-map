import type { Book, Bookcase } from "./libraryTypes";
import type { BookcaseShelf } from "../components/BookcaseView";
import type { Spine } from "../components/ShelfRow";

function hashString(value: string): number {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function titleWithoutParentheses(title: string): string {
  const cleaned = title
    .replace(/\s*\([^)]*\)/g, "")
    .trim();

  return cleaned || title;
}

function spineHeightForTitle(title: string): number {
  const trimmedTitle = titleWithoutParentheses(title);
  const length = trimmedTitle.length;

  const minHeight = 110;
  const maxHeight = 260;
  const pixelsPerCharacter = 8;
  const titlePadding = 22;
  const snapTo = 8;

  const rawHeight = titlePadding + length * pixelsPerCharacter;
  const snappedHeight = Math.ceil(rawHeight / snapTo) * snapTo;

  return Math.min(maxHeight, Math.max(minHeight, snappedHeight));
}

function widthForBook(book: Book): Spine["width"] {
  const hash = hashString(`${book.bookId}-${book.title}-${book.author}`);
  const sizingTitle = book.series ?? book.title;

  if (titleWithoutParentheses(sizingTitle).length > 28) return "l";
  if (hash % 7 === 0) return "s";
  if (hash % 5 === 0) return "l";
  return "m";
}

function sortBooksForShelf(books: Book[]): Book[] {
  return [...books].sort((a, b) => {
    return (
      a.authorSort.localeCompare(b.authorSort) ||
      a.title.localeCompare(b.title)
    );
  });
}

function bookToSpine(book: Book): Spine {
  return {
    id: book.bookId,
    title: book.title,
    width: widthForBook(book),
    heightPx: spineHeightForTitle(book.series ?? book.title),
  };
}

export function getBooksForBookcase(
  books: Book[],
  bookcase: Bookcase
): Book[] {
  return books.filter(
    (book) =>
      book.room === bookcase.room &&
      book.bookcase === bookcase.bookcase
  );
}

export function getShelvesForBookcase(
  books: Book[],
  bookcase: Bookcase
): BookcaseShelf[] {
  const booksForBookcase = getBooksForBookcase(books, bookcase);

  const groupedBooks = new Map<string, Book[]>();

  booksForBookcase.forEach((book) => {
    const rowLabel = book.row === "Main" ? book.shelf : `${book.shelf} — ${book.row}`;
    const groupKey = `${book.shelf}|${book.row}`;

    if (!groupedBooks.has(groupKey)) {
      groupedBooks.set(groupKey, []);
    }

    groupedBooks.get(groupKey)?.push({
      ...book,
      shelf: rowLabel,
    });
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
        id: `${bookcase.bookcaseId}-${groupKey}`,
        label: firstBook.shelf,
        spines: sortBooksForShelf(groupBooks).map(bookToSpine),
      };
    });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getBookcasesFromBooks(books: Book[]): Bookcase[] {
  const seen = new Map<string, Bookcase>();

  books.forEach((book) => {
    if (!book.bookcase) return;

    const key = `${book.room}|${book.bookcase}`;

    if (!seen.has(key)) {
      seen.set(key, {
        bookcaseId: slugify(key),
        room: book.room,
        bookcase: book.bookcase,
        displayName: book.room
          ? `${book.bookcase} (${book.room})`
          : book.bookcase,
        hasRisers: false,
        sortOrder: seen.size + 1,
      });
    }
  });

  return Array.from(seen.values()).sort(
    (a, b) =>
      a.room.localeCompare(b.room) ||
      a.bookcase.localeCompare(b.bookcase)
  );
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export function getSearchableBookText(book: Book): string {
  return normalizeSearchText([
    book.title,
    book.author,
    book.authorSort,
    book.series,
    book.seriesNumber,
    book.room,
    book.bookcase,
    book.shelf,
    book.row,
    book.notes,
  ].join(" "));
}

export function searchBooks(books: Book[], query: string): Book[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return books.filter((book) => {
    const searchableText = getSearchableBookText(book);

    return queryWords.every((word) => searchableText.includes(word));
  });
}