import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

WORKBOOK_PATH = Path("C:/library_app/source/LIBRARY.xlsx")
OUTPUT_DIR = Path("C:/library_app/library-map/public/data")
BOOKS_OUTPUT_PATH = OUTPUT_DIR / "library-books.json"
META_OUTPUT_PATH = OUTPUT_DIR / "library-meta.json"

##BOOKCASE_ROOM_OVERRIDES = {
#    "Living Room": "Living Room",
#    "Office": "Office",
#    "Rainbow": "Living Room",
#    "Hutch": "Bedroom",
#    "Coffee Table": "Living Room",
#    "Yellow Cart": "Living Room",
#    "Star Table": "Living Room",
#    "Bedroom": "Bedroom",
#}

def clean(value: Any) -> str:
    return str(value or "").strip()


def make_author(first: str, last: str) -> str:
    first = clean(first)
    last = clean(last)

    if first and last:
        return f"{first} {last}"

    return first or last


def make_author_sort(first: str, last: str) -> str:
    first = clean(first)
    last = clean(last)

    if first and last:
        return f"{last}, {first}"

    return last or first

def load_bookcase_rooms(workbook) -> dict[str, str]:
    if "Bookcases" not in workbook.sheetnames:
        raise ValueError("Could not find required sheet: Bookcases")

    sheet = workbook["Bookcases"]
    rows = sheet.iter_rows(values_only=True)

    try:
        headers = [clean(value) for value in next(rows)]
    except StopIteration:
        raise ValueError("The Bookcases sheet is empty.")

    header_indexes = {header: index for index, header in enumerate(headers)}

    required_headers = ["Bookcase", "Room"]
    missing_headers = [
        header for header in required_headers if header not in header_indexes
    ]

    if missing_headers:
        raise ValueError(
            "Bookcases sheet is missing expected headers: "
            + ", ".join(missing_headers)
            + f"\nFound headers: {headers}"
        )

    bookcase_rooms = {}

    for row in rows:
        row_values = list(row)

        def get(header: str) -> str:
            index = header_indexes[header]
            if index >= len(row_values):
                return ""
            return clean(row_values[index])

        bookcase = get("Bookcase")
        room = get("Room")

        if bookcase and room:
            bookcase_rooms[bookcase] = room

    return bookcase_rooms

def get_room_for_bookcase(bookcase: str, bookcase_rooms: dict[str, str]) -> str:
    bookcase = clean(bookcase)
    return bookcase_rooms.get(bookcase, "")

def parse_shelf(raw_shelf: str) -> tuple[str, str]:
    raw_shelf = clean(raw_shelf)

    if not raw_shelf:
        return "", "Main"

    parts = [part.strip() for part in raw_shelf.split(",") if part.strip()]

    shelf = parts[0] if parts else raw_shelf
    row = parts[1] if len(parts) > 1 else "Main"

    return shelf, row

def parse_title(raw_title: str) -> dict[str, str | int | None]:
    title = clean(raw_title)

    # Manga:
    # "Rurouni Kenshin, Vol. 2"
    # "Tokyo Ghoul: re, Vol. 14"
    manga_match = re.match(r"^(.*?),\s*Vol\.\s*(\d+)\s*$", title, re.IGNORECASE)
    if manga_match:
        series = manga_match.group(1).strip()
        series_number = int(manga_match.group(2))

        return {
            "title": series,
            "rawTitle": title,
            "series": series,
            "seriesNumber": series_number,
        }

    # Regular books:
    # "The Hunger Games (The Hunger Games #1)"
    # "Catching Fire (The Hunger Games #2)"
    book_match = re.match(r"^(.*?)\s*\((.*?)\s*#\s*(\d+)\)\s*$", title)
    if book_match:
        clean_title = book_match.group(1).strip()
        series = book_match.group(2).strip()
        series_number = int(book_match.group(3))

        return {
            "title": clean_title or title,
            "rawTitle": title,
            "series": series or None,
            "seriesNumber": series_number,
        }

    return {
        "title": title,
        "rawTitle": title,
        "series": None,
        "seriesNumber": None,
    }

def make_book_id(index: int, title: str, author_sort: str) -> str:
    slug_source = f"{author_sort}-{title}".lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug_source).strip("-")
    slug = slug[:60].strip("-")

    return f"book-{index:05d}-{slug or 'untitled'}"


def main() -> None:
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(f"Could not find workbook: {WORKBOOK_PATH}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading workbook: {WORKBOOK_PATH}")
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)
    bookcase_rooms = load_bookcase_rooms(workbook)

    sheet = workbook.worksheets[-1]
    print(f"Using last sheet: {sheet.title}")

    rows = sheet.iter_rows(values_only=True)

    try:
        headers = [clean(value) for value in next(rows)]
    except StopIteration:
        raise ValueError("The List View sheet is empty.")

    header_indexes = {header: index for index, header in enumerate(headers)}

    required_headers = [
        "Title",
        "First",
        "Last",
        "Genre",
        "Publisher",
        "Bookcase",
        "Shelf",
    ]

    missing_headers = [
        header for header in required_headers if header not in header_indexes
    ]

    if missing_headers:
        raise ValueError(
            "Missing expected headers: "
            + ", ".join(missing_headers)
            + f"\nFound headers: {headers}"
        )


    books = []
    skipped_blank_rows = 0
    unmapped_bookcases = set()
    used_bookcases = set()

    for row_number, row in enumerate(rows, start=2):
        row_values = list(row)

        def get(header: str) -> str:
            index = header_indexes[header]
            if index >= len(row_values):
                return ""
            return clean(row_values[index])

        raw_title = get("Title")

        if not raw_title:
            skipped_blank_rows += 1
            continue

        parsed_title = parse_title(raw_title)
        title = clean(parsed_title["title"])

        first = get("First")
        last = get("Last")
        author = make_author(first, last)
        author_sort = make_author_sort(first, last)

        bookcase = get("Bookcase")
        room = get_room_for_bookcase(bookcase, bookcase_rooms)

        if bookcase:
            used_bookcases.add(bookcase)

        if bookcase and not room:
            unmapped_bookcases.add(bookcase)

        raw_shelf = get("Shelf")
        shelf, row_name = parse_shelf(raw_shelf)

        book = {
            "bookId": make_book_id(len(books) + 1, title, author_sort),
            "title": title,
            "rawTitle": raw_title,
            "series": parsed_title["series"],
            "seriesNumber": parsed_title["seriesNumber"],
            "author": author,
            "authorSort": author_sort,
            "firstName": first,
            "lastName": last,
            "genre": get("Genre"),
            "publisher": get("Publisher"),
            "room": room,
            "bookcase": bookcase,
            "shelf": shelf,
            "row": row_name,
            "rawShelf": raw_shelf,
            "notes": "",
        }

        books.append(book)

    unusedBookcases = sorted(
        bookcase for bookcase in bookcase_rooms
        if bookcase not in used_bookcases
    )

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceWorkbook": str(WORKBOOK_PATH),
        "sourceSheet": sheet.title,
        "bookCount": len(books),
        "skippedBlankRows": skipped_blank_rows,
        "headers": headers,
        "bookcaseRooms": bookcase_rooms,
        "usedBookcases": sorted(used_bookcases),
        "unusedBookcases": unusedBookcases,
        "unmappedBookcases": sorted(unmapped_bookcases),
    }

    BOOKS_OUTPUT_PATH.write_text(
        json.dumps(books, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    META_OUTPUT_PATH.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"Wrote {len(books)} books to {BOOKS_OUTPUT_PATH}")
    print(f"Wrote metadata to {META_OUTPUT_PATH}")

    if skipped_blank_rows:
        print(f"Skipped {skipped_blank_rows} blank rows")

    if unmapped_bookcases:
        print("\nUnmapped bookcases:")
        for bookcase in sorted(unmapped_bookcases):
            print(f"  - {bookcase}")


if __name__ == "__main__":
    main()