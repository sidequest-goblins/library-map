export type ShelfRow = "Main" | "Front" | "Back";

export type Book = {
  bookId: string;
  title: string;
  author: string;
  authorSort: string;
  series?: string;
  seriesNumber?: number;
  room: string;
  bookcase: string;
  shelf: string;
  row: ShelfRow;
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