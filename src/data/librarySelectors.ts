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

function widthForBook(book: Book): Spine["width"] {
  const hash = hashString(`${book.bookId}-${book.title}-${book.author}`);

  if (book.title.length > 28) return "l";
  if (hash % 7 === 0) return "s";
  if (hash % 5 === 0) return "l";
  return "m";
}

function heightForBook(book: Book): Spine["height"] {
  const hash = hashString(`${book.author}-${book.title}-${book.bookId}`);

  if (hash % 8 === 0) return "tall";
  if (hash % 3 === 0) return "short";
  return "medium";
}

function sortBooksForShelf(books: Book[]): Book[] {
  return [...books].sort((a, b) => {
    return (
      a.authorSort.localeCompare(b.authorSort) ||
      (a.series ?? "").localeCompare(b.series ?? "") ||
      (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0) ||
      a.title.localeCompare(b.title)
    );
  });
}

function bookToSpine(book: Book): Spine {
  return {
    id: book.bookId,
    title: book.title,
    width: widthForBook(book),
    height: heightForBook(book),
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

  return Array.from(groupedBooks.entries()).map(([groupKey, groupBooks]) => {
    const firstBook = groupBooks[0];

    return {
      id: `${bookcase.bookcaseId}-${groupKey}`,
      label: firstBook.shelf,
      spines: sortBooksForShelf(groupBooks).map(bookToSpine),
    };
  });
}