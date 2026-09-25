# Author review during MyLibrary updates

`update mylibrary` previews author changes, then runs
`build_library_author_identities.py --write --reconcile` interactively.

- Unfamiliar names are shown with their books. Previous credits on the same
  permanent Book ID and similar names suggest possible existing identities.
- Choose a numbered match only for the same person. The existing Author ID stays
  in place; the new credited name becomes the display name and the previous name
  remains an alias. Other registry fields are preserved.
- Choose `NEW` for a distinct person. A combined credit split into two people
  should not be reused as one person's identity; retain that historical identity
  and use separate identities for the individuals.
- Names without suggestions can be approved together with `NEW`, or reviewed
  individually by entering an existing Author ID. Suggestions are never applied
  automatically.
- Confirm the completed review with `APPLY AUTHORS`. Cancel or blank input stops
  before author files are written. Earlier workbook/data update steps may already
  have completed.
- Authors no longer credited by active or archived books remain in the permanent
  registry. They do not need new IDs if their names return later. The active app
  author list still includes only authors with active book credits.

Before changed author files are written, their previous contents and the review
decisions are saved under `tools/author-identity-backups/`. Changed inputs during
review cause a stop. Write failures roll back completed author-file writes.
Confirmed aliases make subsequent updates recognize corrected spellings.

For a read-only preview, run:

```powershell
.\.venv\Scripts\python.exe tools\build_library_author_identities.py
```

The book archive is separate: `public/data/library-archive.json` preserves book
records used by the author and challenge builders. The update currently does not
automatically add books removed from List View to this archive. Recovering older
books from saved workbooks or Git history requires a separate review; absence
alone does not establish that a book was offloaded.
