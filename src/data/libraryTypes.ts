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
  subgenre?: string;
  publisher?: string;
  format?: string;
  jc?: boolean;
  cj?: boolean;
  lgbtq?: boolean;
  coverImage?: string | null;
  catalogKey?: string;
  catalogTitle?: string;
  catalogRawTitle?: string;
  catalogMatchType?: string;
  series?: string | null;
  seriesTitle?: string | null;
  seriesFormat?: string | null;
  seriesNumber?: number | string | null;
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

export type WantedBook = {
  wantedId: string;
  listType: "to-buy" | "series-to-complete" | string;
  title: string;
  rawTitle?: string;
  series?: string | null;
  seriesTitle?: string | null;
  seriesNumber?: number | string | null;
  author: string;
  authorSort: string;
  firstName?: string;
  lastName?: string;
  sourceSheet?: string;
  sourceRow?: number;
};

export type WantedLists = {
  toBuy: WantedBook[];
  seriesToComplete: WantedBook[];
};
