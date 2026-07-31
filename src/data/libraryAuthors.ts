export type LibraryAuthor = {
  authorId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  sortName: string;
  aliases: string[];
  bookCount: number;
};

export type LibraryBookAuthorLink = {
  bookId: string;
  authorId: string;
  creditOrder: number;
  creditedName: string;
};

export type LibraryAuthorMetadata = {
  user_id: string;
  author_id: string;

  /*
   * true  = reviewed and tagged BIPOC
   * false = reviewed and not tagged BIPOC
   * null  = not reviewed yet
   */
  bipoc: boolean | null;

  created_at: string;
  updated_at: string;
};

export type ResolvedBookAuthor = {
  author: LibraryAuthor;
  link: LibraryBookAuthorLink;
  metadata:
    | LibraryAuthorMetadata
    | null;
};