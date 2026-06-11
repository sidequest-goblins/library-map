export type ShelfRow = "Main" | "Front" | "Back";

export type Book = {
  bookId: string;
  title: string;
  author: string;
  authorSort: string;
  firstName?: string;
  lastName?: string;
  room: string;
  bookcase: string;
  shelf: string;
  row: string;
  genre?: string;
  publisher?: string;
  format?: string;
  jc?: boolean;
  cj?: boolean;
  lgbtq?: boolean;
  coverImage?: string | null;
  catalogKey?: string;
  series?: string;
  seriesTitle?: string;
  seriesFormat?: string;
  seriesNumber?: number | string;
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