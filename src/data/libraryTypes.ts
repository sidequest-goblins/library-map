export type ShelfRow = "Main" | "Front" | "Back";

export type Book = {
  bookId: string;
  title: string;
  author: string;
  authorSort: string;
  firstName?: string;
  lastName?: string;
  genre?: string;
  publisher?: string;
  series?: string;
  seriesTitle?: string;
  seriesFormat?: string;
  seriesNumber?: number | string;
  room: string;
  bookcase: string;
  shelf: string;
  row: string;
  shelfPosition?: number | null;
  rawShelf?: string;
  notes?: string;
};

export type Bookcase = {
  bookcaseId: string;
  room: string;
  bookcase: string;
  displayName: string;
  hasRisers: boolean;
  sortOrder: number;
};