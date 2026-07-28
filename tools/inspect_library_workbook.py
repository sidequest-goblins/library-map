from pathlib import Path
from typing import Any

from openpyxl import load_workbook


WORKBOOK_PATH = Path(
    "C:/Users/cjade/OneDrive/Shared Workbooks/MyLibrary/LIBRARY.xlsx"
)

LIST_VIEW_REQUIRED_HEADERS = {
    "isbn",
    "year",
    "pages",
    "title",
    "series",
    "first",
    "last",
    "genre",
    "subgenre",
    "publisher",
    "origin",
    "bookcase",
    "shelf",
    "position",
}


def clean(value: Any) -> str:
    return str(value or "").strip()


def normalize_header(value: Any) -> str:
    return clean(value).lower().replace(" ", "")


def is_missing(value: Any) -> bool:
    normalized_value = clean(value).lower()

    return normalized_value in {
        "",
        "unknown",
        "n/a",
        "na",
        "none",
    }


def get_header_index(
    header_indexes: dict[str, int],
    *header_names: str,
) -> int | None:
    for header_name in header_names:
        index = header_indexes.get(
            normalize_header(header_name)
        )

        if index is not None:
            return index

    return None


def get_value(
    row_values: list[Any],
    header_indexes: dict[str, int],
    *header_names: str,
) -> Any:
    index = get_header_index(
        header_indexes,
        *header_names,
    )

    if (
        index is None
        or index >= len(row_values)
    ):
        return ""

    return row_values[index]


def find_list_view_sheet(workbook):
    """
    Prefer the explicitly named List View sheet.

    If the sheet is ever renamed, fall back to identifying it
    by its complete expected header structure.
    """
    if "List View" in workbook.sheetnames:
        sheet = workbook["List View"]

        header_row = next(
            sheet.iter_rows(
                min_row=1,
                max_row=1,
                values_only=True,
            ),
            (),
        )

        normalized_headers = {
            normalize_header(header)
            for header in header_row
        }

        missing_headers = (
            LIST_VIEW_REQUIRED_HEADERS
            - normalized_headers
        )

        if missing_headers:
            raise ValueError(
                "The List View sheet was found, but it is "
                "missing expected headers: "
                + ", ".join(
                    sorted(missing_headers)
                )
                + "\nFound headers: "
                + ", ".join(
                    clean(header)
                    for header in header_row
                    if clean(header)
                )
            )

        return sheet

    for sheet in workbook.worksheets:
        header_row = next(
            sheet.iter_rows(
                min_row=1,
                max_row=1,
                values_only=True,
            ),
            (),
        )

        normalized_headers = {
            normalize_header(header)
            for header in header_row
        }

        if LIST_VIEW_REQUIRED_HEADERS.issubset(
            normalized_headers
        ):
            return sheet

    raise ValueError(
        "Could not find the List View sheet. "
        "Expected these normalized headers: "
        + ", ".join(
            sorted(
                LIST_VIEW_REQUIRED_HEADERS
            )
        )
    )

def load_bookcase_rooms(
    workbook,
) -> dict[str, str]:
    if "Bookcases" not in workbook.sheetnames:
        raise ValueError(
            "Could not find the Bookcases sheet."
        )

    sheet = workbook["Bookcases"]
    rows = sheet.iter_rows(
        values_only=True
    )

    try:
        headers = next(rows)
    except StopIteration:
        raise ValueError(
            "The Bookcases sheet is empty."
        )

    header_indexes = {
        normalize_header(header): index
        for index, header in enumerate(
            headers
        )
    }

    bookcase_rooms: dict[str, str] = {}

    for row in rows:
        row_values = list(row)

        bookcase = clean(
            get_value(
                row_values,
                header_indexes,
                "bookcase",
            )
        )

        room = clean(
            get_value(
                row_values,
                header_indexes,
                "room",
            )
        )

        if bookcase:
            bookcase_rooms[bookcase] = room

    return bookcase_rooms


def format_count(
    missing_count: int,
    total_count: int,
) -> str:
    complete_count = (
        total_count - missing_count
    )

    if total_count <= 0:
        percentage = 0
    else:
        percentage = round(
            complete_count
            / total_count
            * 100,
            1,
        )

    return (
        f"{missing_count:>4} missing"
        f"  |  "
        f"{complete_count:>4} complete"
        f"  |  "
        f"{percentage:>5.1f}% complete"
    )


def main() -> None:
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(
            f"Could not find workbook: "
            f"{WORKBOOK_PATH}"
        )

    print(
        f"Loading workbook: "
        f"{WORKBOOK_PATH}"
    )

    workbook = load_workbook(
        WORKBOOK_PATH,
        read_only=True,
        data_only=True,
    )

    list_view_sheet = (
        find_list_view_sheet(
            workbook
        )
    )

    bookcase_rooms = (
        load_bookcase_rooms(
            workbook
        )
    )

    print(
        f"Using List View sheet: "
        f"{list_view_sheet.title}"
    )

    rows = list_view_sheet.iter_rows(
        values_only=True
    )

    try:
        headers = next(rows)
    except StopIteration:
        raise ValueError(
            "The List View sheet is empty."
        )

    header_indexes = {
        normalize_header(header): index
        for index, header in enumerate(
            headers
        )
    }

    year_header_index = (
        get_header_index(
            header_indexes,
            "year",
            "publication year",
            "publicationyear",
        )
    )

    isbn_header_index = (
        get_header_index(
            header_indexes,
            "isbn",
            "isbn-13",
            "isbn13",
        )
    )

    position_header_index = (
        get_header_index(
            header_indexes,
            "position",
            "shelf position",
            "shelfposition",
        )
    )

    if year_header_index is None:
        raise ValueError(
            "Could not find the Year column "
            "in List View."
        )

    if isbn_header_index is None:
        raise ValueError(
            "Could not find the ISBN column "
            "in List View."
        )

    total_books = 0

    missing_year = 0
    missing_isbn = 0

    missing_bookcase = 0
    missing_shelf = 0
    missing_room = 0
    incomplete_location = 0

    office_books = 0
    missing_office_position = 0

    fully_complete = 0

    incomplete_rows: list[
        dict[str, Any]
    ] = []

    for row_number, row in enumerate(
        rows,
        start=2,
    ):
        row_values = list(row)

        title = clean(
            get_value(
                row_values,
                header_indexes,
                "title",
            )
        )

        if not title:
            continue

        total_books += 1

        year = get_value(
            row_values,
            header_indexes,
            "year",
            "publication year",
            "publicationyear",
        )

        isbn = get_value(
            row_values,
            header_indexes,
            "isbn",
            "isbn-13",
            "isbn13",
        )

        bookcase = clean(
            get_value(
                row_values,
                header_indexes,
                "bookcase",
            )
        )

        shelf = clean(
            get_value(
                row_values,
                header_indexes,
                "shelf",
            )
        )

        position = get_value(
            row_values,
            header_indexes,
            "position",
            "shelf position",
            "shelfposition",
        )

        room = (
            bookcase_rooms.get(
                bookcase,
                "",
            )
            if bookcase
            else ""
        )

        row_missing_year = (
            is_missing(year)
        )

        row_missing_isbn = (
            is_missing(isbn)
        )

        row_missing_bookcase = (
            is_missing(bookcase)
        )

        row_missing_shelf = (
            is_missing(shelf)
        )

        row_missing_room = (
            is_missing(room)
        )

        row_incomplete_location = (
            row_missing_room
            or row_missing_bookcase
            or row_missing_shelf
        )

        is_office_book = (
            bookcase.lower()
            == "office"
        )

        row_missing_office_position = (
            is_office_book
            and is_missing(position)
        )

        if row_missing_year:
            missing_year += 1

        if row_missing_isbn:
            missing_isbn += 1

        if row_missing_bookcase:
            missing_bookcase += 1

        if row_missing_shelf:
            missing_shelf += 1

        if row_missing_room:
            missing_room += 1

        if row_incomplete_location:
            incomplete_location += 1

        if is_office_book:
            office_books += 1

        if row_missing_office_position:
            missing_office_position += 1

        row_is_fully_complete = (
            not row_missing_year
            and not row_missing_isbn
            and not row_incomplete_location
            and not row_missing_office_position
        )

        if row_is_fully_complete:
            fully_complete += 1
        else:
            missing_fields: list[str] = []

            if row_missing_year:
                missing_fields.append(
                    "Year"
                )

            if row_missing_isbn:
                missing_fields.append(
                    "ISBN"
                )

            if row_missing_room:
                missing_fields.append(
                    "Room"
                )

            if row_missing_bookcase:
                missing_fields.append(
                    "Bookcase"
                )

            if row_missing_shelf:
                missing_fields.append(
                    "Shelf"
                )

            if row_missing_office_position:
                missing_fields.append(
                    "Office position"
                )

            incomplete_rows.append(
                {
                    "row": row_number,
                    "title": title,
                    "missing": missing_fields,
                }
            )

    print()
    print("=" * 68)
    print("LIBRARY WORKBOOK COVERAGE")
    print("=" * 68)

    print(
        f"\nTotal List View books: "
        f"{total_books}"
    )

    print("\nCore book data:")
    print(
        "  Year:              "
        + format_count(
            missing_year,
            total_books,
        )
    )

    print(
        "  ISBN:              "
        + format_count(
            missing_isbn,
            total_books,
        )
    )

    print("\nLocation data:")
    print(
        "  Complete location: "
        + format_count(
            incomplete_location,
            total_books,
        )
    )

    print(
        "  Room:              "
        + format_count(
            missing_room,
            total_books,
        )
    )

    print(
        "  Bookcase:          "
        + format_count(
            missing_bookcase,
            total_books,
        )
    )

    print(
        "  Shelf:             "
        + format_count(
            missing_shelf,
            total_books,
        )
    )

    print("\nOffice-only data:")
    print(
        f"  Office books:      "
        f"{office_books}"
    )

    print(
        "  Position:          "
        + format_count(
            missing_office_position,
            office_books,
        )
    )

    fully_complete_missing = (
        total_books
        - fully_complete
    )

    print("\nOverall tracked coverage:")
    print(
        "  All fields:        "
        + format_count(
            fully_complete_missing,
            total_books,
        )
    )

    if incomplete_rows:
        print(
            "\nFirst 20 books needing work:"
        )

        for item in incomplete_rows[:20]:
            missing_label = ", ".join(
                item["missing"]
            )

            print(
                f"  Row {item['row']}: "
                f"{item['title']} "
                f"— {missing_label}"
            )

        remaining_count = (
            len(incomplete_rows)
            - 20
        )

        if remaining_count > 0:
            print(
                f"  ...and "
                f"{remaining_count} more"
            )
    else:
        print(
            "\n✨ Every tracked field is complete."
        )

    print()
    print("=" * 68)


if __name__ == "__main__":
    main()