import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

WORKBOOK_PATH = Path("C:/library_app/source/LIBRARY.xlsx")
OUTPUT_DIR = Path("C:/library_app/library-map/public/data")
BOOKS_OUTPUT_PATH = OUTPUT_DIR / "library-books.json"
CATALOG_OUTPUT_PATH = OUTPUT_DIR / "library-catalog.json"
META_OUTPUT_PATH = OUTPUT_DIR / "library-meta.json"
CATALOG_REQUIRED_HEADERS = {"first", "last", "title", "jc", "cj"}

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

def checkbox_to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    text = clean(value).lower()
    return text in {"true", "yes", "y", "1", "checked", "x"}

def load_bookcase_rooms(workbook) -> dict[str, str]:
    if "Bookcases" not in workbook.sheetnames:
        raise ValueError("Could not find required sheet: Bookcases")

    sheet = workbook["Bookcases"]
    rows = sheet.iter_rows(values_only=True)

    try:
        headers = [clean(value) for value in next(rows)]
    except StopIteration:
        raise ValueError("The Bookcases sheet is empty.")

    header_indexes = {normalize_header(header): index for index, header in enumerate(headers)}

    required_headers = ["bookcase", "room"]
    missing_headers = [
        header for header in required_headers if header not in header_indexes
    ]

    if missing_headers:
        raise ValueError(
            "Bookcases sheet is missing expected normalized headers: "
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

        bookcase = get("bookcase")
        room = get("room")

        if bookcase and room:
            bookcase_rooms[bookcase] = room

    return bookcase_rooms

def get_room_for_bookcase(bookcase: str, bookcase_rooms: dict[str, str]) -> str:
    bookcase = clean(bookcase)
    return bookcase_rooms.get(bookcase, "")

def parse_optional_int(value: Any) -> int | None:
    text = clean(value)

    if not text:
        return None

    try:
        return int(float(text))
    except ValueError:
        return None
    
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
    volume_match = re.match(
        r"^(.*?),\s*Vol\.\s*(\d+)(?:\s*\((Light Novel|Manwha|Manhwa|Manga)\))?\s*$",
        title,
        re.IGNORECASE,
    )
    if volume_match:
        series = volume_match.group(1).strip()
        series_number = int(volume_match.group(2))
        format_label = volume_match.group(3).strip() if volume_match.group(3) else None

        series_key = f"{series}|{format_label}" if format_label else series

        return {
            "title": title,
            "rawTitle": title,
            "series": series_key,
            "seriesTitle": series,
            "seriesFormat": format_label,
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
            "seriesTitle": series or None,
            "seriesFormat": None,
            "seriesNumber": series_number,
        }

    return {
        "title": title,
        "rawTitle": title,
        "series": None,
        "seriesTitle": None,
        "seriesFormat": None,
        "seriesNumber": None,
    }

def normalize_header(value: Any) -> str:
    return clean(value).lower().replace(" ", "")


def find_sheet_with_headers(
    workbook,
    required_headers: set[str],
    label: str,
):
    for sheet in workbook.worksheets:
        rows = sheet.iter_rows(values_only=True)

        try:
            headers = [clean(value) for value in next(rows)]
        except StopIteration:
            continue

        normalized_headers = {normalize_header(header) for header in headers}

        if required_headers.issubset(normalized_headers):
            return sheet

    raise ValueError(f"Could not find {label} sheet with headers: {required_headers}")

def get_sheet_headers(sheet) -> list[str]:
    rows = sheet.iter_rows(values_only=True)

    try:
        return [clean(value) for value in next(rows)]
    except StopIteration:
        return []

def is_catalog_sheet(sheet) -> bool:
    headers = get_sheet_headers(sheet)
    normalized_headers = {normalize_header(header) for header in headers}

    return CATALOG_REQUIRED_HEADERS.issubset(normalized_headers)

def make_book_id(index: int, title: str, author_sort: str) -> str:
    slug_source = f"{author_sort}-{title}".lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug_source).strip("-")
    slug = slug[:60].strip("-")

    return f"book-{index:05d}-{slug or 'untitled'}"

def make_catalog_key(title: str, author_sort: str) -> str:
    slug_source = f"{author_sort}-{title}".lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug_source).strip("-")

    return slug or "untitled"

def load_catalog_books(workbook) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    catalog_books: dict[str, dict[str, Any]] = {}
    processed_sheets: dict[str, int] = {}
    skipped_sheets: list[str] = []
    duplicate_catalog_keys: dict[str, list[dict[str, Any]]] = {}

    for sheet in workbook.worksheets:
        if not is_catalog_sheet(sheet):
            skipped_sheets.append(sheet.title)
            continue

        rows = sheet.iter_rows(values_only=True)

        try:
            headers = [clean(value) for value in next(rows)]
        except StopIteration:
            skipped_sheets.append(sheet.title)
            continue

        header_indexes = {
            normalize_header(header): index
            for index, header in enumerate(headers)
        }

        def get(row_values: list[Any], header: str) -> Any:
            index = header_indexes.get(header)
            if index is None or index >= len(row_values):
                return ""
            return row_values[index]

        sheet_count = 0

        for row_number, row in enumerate(rows, start=2):
            row_values = list(row)

            raw_title = clean(get(row_values, "title"))

            if not raw_title:
                continue

            parsed_title = parse_title(raw_title)
            title = clean(parsed_title["title"])

            first = clean(get(row_values, "first"))
            last = clean(get(row_values, "last"))
            author = make_author(first, last)
            author_sort = make_author_sort(first, last)

            catalog_key = make_catalog_key(title, author_sort)

            catalog_book = {
                "catalogKey": catalog_key,
                "title": title,
                "rawTitle": raw_title,
                "coverImage": None,
                "series": parsed_title["series"],
                "seriesTitle": parsed_title["seriesTitle"],
                "seriesFormat": parsed_title["seriesFormat"],
                "seriesNumber": parsed_title["seriesNumber"],
                "author": author,
                "authorSort": author_sort,
                "firstName": first,
                "lastName": last,
                "format": clean(get(row_values, "format")),
                "jc": checkbox_to_bool(get(row_values, "jc")),
                "cj": checkbox_to_bool(get(row_values, "cj")),
                "lgbtq": checkbox_to_bool(get(row_values, "lgbtq+")),
                "sourceSheet": sheet.title,
                "sourceRow": row_number,
            }

            if catalog_key in catalog_books:
                duplicate_catalog_keys.setdefault(catalog_key, [catalog_books[catalog_key]])
                duplicate_catalog_keys[catalog_key].append(catalog_book)

            catalog_books[catalog_key] = catalog_book
            sheet_count += 1

        processed_sheets[sheet.title] = sheet_count

    report = {
        "catalogBookCount": len(catalog_books),
        "catalogRowsWithTitles": sum(processed_sheets.values()),
        "processedCatalogSheets": processed_sheets,
        "skippedCatalogSheets": skipped_sheets,
        "duplicateCatalogKeys": duplicate_catalog_keys,
    }

    return catalog_books, report

def main() -> None:
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(f"Could not find workbook: {WORKBOOK_PATH}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading workbook: {WORKBOOK_PATH}")
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)
    bookcase_rooms = load_bookcase_rooms(workbook)

    catalog_books, catalog_report = load_catalog_books(workbook)

    print(f"Found {len(catalog_books)} catalog books")

    print("\nProcessed catalog sheets:")
    for sheet_name, count in catalog_report["processedCatalogSheets"].items():
        print(f"  - {sheet_name}: {count}")

    print("\nSkipped non-catalog sheets:")
    for sheet_name in catalog_report["skippedCatalogSheets"]:
        print(f"  - {sheet_name}")

    if catalog_report["duplicateCatalogKeys"]:
        print("\nDuplicate catalog keys:")
        for catalog_key, duplicates in catalog_report["duplicateCatalogKeys"].items():
            print(f"  - {catalog_key}: {len(duplicates)} rows")

    sheet = find_sheet_with_headers(
        workbook,
        required_headers={
            "title",
            "first",
            "last",
            "genre",
            "publisher",
            "bookcase",
            "shelf",
        },
        label="List View",
    )
    print(f"Using List View sheet: {sheet.title}")

    rows = sheet.iter_rows(values_only=True)

    try:
        headers = [clean(value) for value in next(rows)]
    except StopIteration:
        raise ValueError("The List View sheet is empty.")

    header_indexes = {normalize_header(header): index for index, header in enumerate(headers)}

    required_headers = [
        "title",
        "first",
        "last",
        "genre",
        "publisher",
        "bookcase",
        "shelf",
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
            index = header_indexes.get(header)
            if index is None or index >= len(row_values):
                return ""
            return clean(row_values[index])

        raw_title = get("title")

        if not raw_title:
            skipped_blank_rows += 1
            continue

        parsed_title = parse_title(raw_title)
        title = clean(parsed_title["title"])

        first = get("first")
        last = get("last")
        author = make_author(first, last)
        author_sort = make_author_sort(first, last)

        bookcase = get("bookcase")
        room = get_room_for_bookcase(bookcase, bookcase_rooms)

        catalog_key = make_catalog_key(title, author_sort)
        catalog_match = catalog_books.get(catalog_key)

        if bookcase:
            used_bookcases.add(bookcase)

        if bookcase and not room:
            unmapped_bookcases.add(bookcase)

        raw_shelf = get("shelf")
        shelf, row_name = parse_shelf(raw_shelf)

        book = {
            "bookId": make_book_id(len(books) + 1, title, author_sort),
            "title": title,
            "rawTitle": raw_title,
            "shelfPosition": parse_optional_int(get("position")),
            "series": parsed_title["series"],
            "seriesNumber": parsed_title["seriesNumber"],
            "author": author,
            "authorSort": author_sort,
            "firstName": first,
            "lastName": last,
            "genre": get("genre"),
            "publisher": get("publisher"),
            "catalogKey": catalog_key,
            "format": catalog_match["format"] if catalog_match else "",
            "jc": catalog_match["jc"] if catalog_match else False,
            "cj": catalog_match["cj"] if catalog_match else False,
            "lgbtq": catalog_match["lgbtq"] if catalog_match else False,
            "coverImage": catalog_match.get("coverImage") if catalog_match else None,
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
        "catalog": catalog_report,
    }

    BOOKS_OUTPUT_PATH.write_text(
        json.dumps(books, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    CATALOG_OUTPUT_PATH.write_text(
        json.dumps(
            sorted(
                catalog_books.values(),
                key=lambda book: (
                    book["authorSort"].lower(),
                    book["title"].lower(),
                    book["sourceSheet"],
                    book["sourceRow"],
                ),
            ),
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    META_OUTPUT_PATH.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"Wrote {len(books)} books to {BOOKS_OUTPUT_PATH}")
    print(f"Wrote {len(catalog_books)} catalog books to {CATALOG_OUTPUT_PATH}")
    print(f"Wrote metadata to {META_OUTPUT_PATH}")

    if skipped_blank_rows:
        print(f"Skipped {skipped_blank_rows} blank rows")

    if unmapped_bookcases:
        print("\nUnmapped bookcases:")
        for bookcase in sorted(unmapped_bookcases):
            print(f"  - {bookcase}")


if __name__ == "__main__":
    main()