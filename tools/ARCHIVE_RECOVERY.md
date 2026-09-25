# Recover historical List View records

Run from the app repository:

```powershell
.\tools\scan_library_archive.ps1
```

The default output is `C:\library_app\Archive Review\ARCHIVE.xlsx`, outside OneDrive.
Keep review files local until explicitly ready to share; files in Shared Workbooks
also download to the wife's computer. The older `MyLibrary Archive` folder remains intact.
An existing output is never overwritten: use `-OutputPath` with a new filename
for a later scan so any review decisions or notes stay intact. Additional saved
List View folders can be included with `-HistoryDirectory`.

The scan reads the List View backups under `tools` (including the historically
named `book-id-backups` folder), the older archive workbook, recovery JSON, the
app archive JSON, and every local Git version of `library-books.json`. It compares
them with the saved current `LIBRARY LIST VIEW.xlsx`, using disposable copies for
workbook reads. Close/save Excel first if you want the newest edits included.

The workbook contains:

- **Archive:** permanent Book IDs absent from the current List View, with every
  recovered List View column and editable review decisions/notes.
- **Review:** possible matches to current books and unresolved pre-ID records.
- **History:** distinct saved row versions for these records, including older
  values that were later cleared or changed. Source references are source ID / row.
- **Sources:** source paths, snapshot dates, row counts, and content hashes.

Permanent IDs take priority over titles. Pre-ID rows link to a permanent ID only
through an unambiguous exact title/author/ISBN match, or an exact title/author
match when the old record has no ISBN. Older series-number annotations and
legacy identifiers provide additional evidence. Multiple possible identities
stay in Review. A known different ISBN edition is kept distinct. These checks
identify historical records, not proof of a physical book's disposal.

The primary row combines the latest available columns, preferring actual List
View snapshots to derived JSON. Missing columns may be filled from an older
source; a blank value in a present column stays blank. History preserves all
distinct saved values so the source of a previous value can be checked. Formulas
are frozen to their saved values; saved spreadsheet errors are labeled as source
errors rather than inserted as working formulas. Dates mean "seen in this saved
source", not acquisition or offload dates.

The scanner does not change original workbooks or `library-archive.json`, assign
IDs, copy covers, search remote OneDrive version history, or publish anything.
Review choices currently stay in this workbook; importing confirmed removals
into the app archive and adding ongoing removal detection are separate steps.

The PowerShell wrapper uses the installed Codex spreadsheet runtime to write the
workbook. The Python scan itself can run independently:

```powershell
.\.venv\Scripts\python.exe tools\scan_library_archive.py --output C:\library_app\archive-scan.json
```
