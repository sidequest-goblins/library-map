#!/usr/bin/env python3
"""Build public/data/library-challenges.json from CHALLENGES.xlsx.

Workbook convention:

    <Challenge Name> - <Reader Name>

Each challenge sheet must contain:

    Letter | Title | First | Last

Extra workbook columns are allowed but ignored. The generator preserves workbook
order and duplicate letters, links entries against public/data/library-books.json,
and takes total page counts from the matched library book. Reading progress and
completion are supplied by Supabase rather than CHALLENGES.xlsx.

This script intentionally uses only Python's standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET


SCHEMA_VERSION = 2
SHEET_NAME_SEPARATOR = " - "
LEADING_ARTICLES = {"a", "an", "the"}
TITLE_SUBTITLE_SEPARATORS = (
    ":",
    " — ",
    " – ",
    " - ",
)

AUTHOR_INITIAL_CHALLENGE_IDS = {
    "abc-author",
}

EXPECTED_HEADERS = {
    "letter": {"letter"},
    "title": {"title"},
    "first": {
        "first",
        "first name",
        "author first",
        "author first name",
    },
    "last": {
        "last",
        "last name",
        "author last",
        "author last name",
    },
}

MAIN_NS = (
    "http://schemas.openxmlformats.org/"
    "spreadsheetml/2006/main"
)
DOC_REL_NS = (
    "http://schemas.openxmlformats.org/"
    "officeDocument/2006/relationships"
)
PKG_REL_NS = (
    "http://schemas.openxmlformats.org/"
    "package/2006/relationships"
)


class BuildError(RuntimeError):
    """Raised when challenge data cannot be generated safely."""


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize(
        "NFD",
        str(value or ""),
    )

    text = "".join(
        char
        for char in text
        if unicodedata.category(char) != "Mn"
    )

    text = text.lower().replace("’", "'")

    return " ".join(
        re.findall(r"[a-z0-9]+", text)
    )

def normalized_title_variants(
    value: Any,
) -> set[str]:
    """Return full-title and conservative subtitle-shortened variants."""

    raw_title = display_text(value)

    if not raw_title:
        return set()

    candidate_titles = {
        raw_title,
    }

    for separator in TITLE_SUBTITLE_SEPARATORS:
        if separator not in raw_title:
            continue

        shortened_title = raw_title.split(
            separator,
            1,
        )[0].strip()

        if shortened_title:
            candidate_titles.add(
                shortened_title
            )

    return {
        normalized
        for candidate in candidate_titles
        if (
            normalized :=
            normalize_text(candidate)
        )
    }

def slugify(value: Any) -> str:
    return normalize_text(value).replace(" ", "-")

def display_text(value: Any) -> str:
    return str(value or "").strip()

def natural_title_letter(title: str) -> str:
    words = normalize_text(title).split()

    if words and words[0] in LEADING_ARTICLES:
        words = words[1:]

    if not words:
        return ""

    return words[0][0].upper()

def coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return value != 0

    return normalize_text(value) in {
        "1",
        "true",
        "yes",
        "y",
        "x",
        "read",
        "complete",
        "completed",
    }

def coerce_number(
    value: Any,
) -> int | float | None:
    if value is None or value == "":
        return None

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, int):
        return value

    if isinstance(value, float):
        return (
            int(value)
            if value.is_integer()
            else value
        )

    text = str(value).strip().replace(",", "")

    if not text:
        return None

    try:
        number = float(text)
    except ValueError as exc:
        raise BuildError(
            f"Expected a number, found {value!r}"
        ) from exc

    return (
        int(number)
        if number.is_integer()
        else number
    )

# ---------------------------------------------------------------------------
# Minimal .xlsx reader
# ---------------------------------------------------------------------------

def column_index_from_reference(
    reference: str,
) -> int:
    match = re.match(
        r"([A-Z]+)",
        reference.upper(),
    )

    if not match:
        raise BuildError(
            f"Invalid Excel cell reference: "
            f"{reference!r}"
        )

    index = 0

    for char in match.group(1):
        index = (
            index * 26
            + (ord(char) - ord("A") + 1)
        )

    return index - 1

def read_shared_strings(
    archive: zipfile.ZipFile,
) -> list[str]:
    path = "xl/sharedStrings.xml"

    if path not in archive.namelist():
        return []

    root = ET.fromstring(
        archive.read(path)
    )

    values: list[str] = []

    for item in root.findall(
        f"{{{MAIN_NS}}}si"
    ):
        values.append(
            "".join(
                node.text or ""
                for node in item.iter(
                    f"{{{MAIN_NS}}}t"
                )
            )
        )

    return values

def read_cell_value(
    cell: ET.Element,
    shared_strings: list[str],
) -> Any:
    cell_type = cell.attrib.get("t")

    if cell_type == "inlineStr":
        inline = cell.find(
            f"{{{MAIN_NS}}}is"
        )

        if inline is None:
            return ""

        return "".join(
            node.text or ""
            for node in inline.iter(
                f"{{{MAIN_NS}}}t"
            )
        )

    value_node = cell.find(
        f"{{{MAIN_NS}}}v"
    )

    if (
        value_node is None
        or value_node.text is None
    ):
        return None

    raw = value_node.text

    if cell_type == "s":
        return shared_strings[int(raw)]

    if cell_type == "b":
        return raw == "1"

    if cell_type in {"str", "e"}:
        return raw

    try:
        number = float(raw)
    except ValueError:
        return raw

    return (
        int(number)
        if number.is_integer()
        else number
    )

def workbook_sheet_paths(
    archive: zipfile.ZipFile,
) -> list[tuple[str, str]]:
    workbook_root = ET.fromstring(
        archive.read("xl/workbook.xml")
    )

    relationships_root = ET.fromstring(
        archive.read(
            "xl/_rels/workbook.xml.rels"
        )
    )

    targets = {
        relationship.attrib["Id"]:
            relationship.attrib["Target"]
        for relationship
        in relationships_root.findall(
            f"{{{PKG_REL_NS}}}Relationship"
        )
    }

    sheets_node = workbook_root.find(
        f"{{{MAIN_NS}}}sheets"
    )

    if sheets_node is None:
        return []

    sheets: list[tuple[str, str]] = []

    for sheet in sheets_node.findall(
        f"{{{MAIN_NS}}}sheet"
    ):
        name = sheet.attrib["name"]

        relationship_id = sheet.attrib[
            f"{{{DOC_REL_NS}}}id"
        ]

        target = targets[relationship_id]

        if target.startswith("/"):
            worksheet_path = target.lstrip("/")
        else:
            worksheet_path = posixpath.normpath(
                posixpath.join(
                    "xl",
                    target,
                )
            )

        sheets.append(
            (
                name,
                worksheet_path,
            )
        )

    return sheets

def read_worksheet_rows(
    archive: zipfile.ZipFile,
    worksheet_path: str,
    shared_strings: list[str],
) -> list[tuple[int, list[Any]]]:
    root = ET.fromstring(
        archive.read(worksheet_path)
    )

    sheet_data = root.find(
        f"{{{MAIN_NS}}}sheetData"
    )

    if sheet_data is None:
        return []

    output: list[
        tuple[int, list[Any]]
    ] = []

    for row in sheet_data.findall(
        f"{{{MAIN_NS}}}row"
    ):
        row_number = int(
            row.attrib.get(
                "r",
                len(output) + 1,
            )
        )

        indexed_values: dict[
            int,
            Any,
        ] = {}

        max_column = -1

        for cell in row.findall(
            f"{{{MAIN_NS}}}c"
        ):
            column_index = (
                column_index_from_reference(
                    cell.attrib.get(
                        "r",
                        "A1",
                    )
                )
            )

            indexed_values[column_index] = (
                read_cell_value(
                    cell,
                    shared_strings,
                )
            )

            max_column = max(
                max_column,
                column_index,
            )

        values = [
            indexed_values.get(index)
            for index in range(
                max_column + 1
            )
        ]

        output.append(
            (
                row_number,
                values,
            )
        )

    return output

def read_workbook(
    path: Path,
) -> list[
    tuple[
        str,
        list[
            tuple[
                int,
                list[Any],
            ]
        ],
    ]
]:
    if not path.exists():
        raise BuildError(
            f"Challenge workbook not found: "
            f"{path}"
        )

    try:
        with zipfile.ZipFile(path) as archive:
            shared_strings = (
                read_shared_strings(archive)
            )

            return [
                (
                    name,
                    read_worksheet_rows(
                        archive,
                        worksheet_path,
                        shared_strings,
                    ),
                )
                for name, worksheet_path
                in workbook_sheet_paths(
                    archive
                )
            ]

    except zipfile.BadZipFile as exc:
        raise BuildError(
            f"Not a valid .xlsx workbook: "
            f"{path}"
        ) from exc

# ---------------------------------------------------------------------------
# Workbook validation and library matching
# ---------------------------------------------------------------------------

def canonical_header(value: Any) -> str:
    return normalize_text(
        value
    ).replace("_", " ")

def resolve_headers(
    sheet_name: str,
    values: list[Any],
) -> dict[str, int]:
    normalized_headers = [
        canonical_header(value)
        for value in values
    ]

    resolved: dict[str, int] = {}

    for (
        canonical_name,
        aliases,
    ) in EXPECTED_HEADERS.items():
        matching_indexes = [
            index
            for index, header
            in enumerate(
                normalized_headers
            )
            if header in aliases
        ]

        if len(matching_indexes) != 1:
            readable = (
                canonical_name.replace(
                    "_",
                    " ",
                )
            )

            raise BuildError(
                f"Sheet {sheet_name!r} must "
                f"contain exactly one "
                f"{readable!r} column. "
                f"Found headers: {values!r}"
            )

        resolved[canonical_name] = (
            matching_indexes[0]
        )

    return resolved

def value_at(
    values: list[Any],
    index: int,
) -> Any:
    return (
        values[index]
        if index < len(values)
        else None
    )

def split_semicolon_values(
    value: Any,
) -> list[str]:
    return [
        part.strip()
        for part in str(
            value or ""
        ).split(";")
        if part.strip()
    ]

def author_initial_letters(
    author_first: Any,
    author_last: Any,
) -> set[str]:
    """Return every usable first/last-name initial for an entry."""

    initials: set[str] = set()

    for value in (
        author_first,
        author_last,
    ):
        for name in split_semicolon_values(
            value
        ):
            normalized_name = normalize_text(
                name
            )

            if normalized_name:
                initials.add(
                    normalized_name[0].upper()
                )

    return initials

def author_pairs(
    book: dict[str, Any],
) -> list[tuple[str, str]]:
    first_names = split_semicolon_values(
        book.get("firstName")
    )

    last_names = split_semicolon_values(
        book.get("lastName")
    )

    pairs: list[
        tuple[str, str]
    ] = []

    for index in range(
        max(
            len(first_names),
            len(last_names),
        )
    ):
        first = (
            first_names[index]
            if index < len(first_names)
            else ""
        )

        last = (
            last_names[index]
            if index < len(last_names)
            else ""
        )

        if first or last:
            pairs.append(
                (
                    normalize_text(first),
                    normalize_text(last),
                )
            )

    if pairs:
        return pairs

    author = display_text(
        book.get("author")
    )

    if not author:
        return []

    pieces = author.split()

    return [
        (
            normalize_text(
                " ".join(
                    pieces[:-1]
                )
            ),
            normalize_text(
                pieces[-1]
            ),
        )
    ]

def title_variants(
    book: dict[str, Any],
) -> set[str]:
    fields = (
        "title",
        "rawTitle",
        "catalogTitle",
        "catalogRawTitle",
    )

    variants: set[str] = set()

    for field in fields:
        variants.update(
            normalized_title_variants(
                book.get(field)
            )
        )

    return variants

def unique_books(
    books: Iterable[
        dict[str, Any]
    ],
) -> list[dict[str, Any]]:
    seen: set[str] = set()

    output: list[
        dict[str, Any]
    ] = []

    for book in books:
        identity = str(
            book.get("catalogKey")
            or book.get("bookId")
            or id(book)
        )

        if identity in seen:
            continue

        seen.add(identity)
        output.append(book)

    return output

def build_book_indexes(
    books: list[
        dict[str, Any]
    ],
) -> dict[
    str,
    dict[
        Any,
        list[
            dict[str, Any]
        ],
    ],
]:
    by_title_author: dict[
        tuple[str, str, str],
        list[dict[str, Any]],
    ] = defaultdict(list)

    by_title_last: dict[
        tuple[str, str],
        list[dict[str, Any]],
    ] = defaultdict(list)

    by_title: dict[
        str,
        list[dict[str, Any]],
    ] = defaultdict(list)

    for book in books:
        for title in title_variants(
            book
        ):
            by_title[title].append(
                book
            )

            for (
                first,
                last,
            ) in author_pairs(book):
                by_title_author[
                    (
                        title,
                        first,
                        last,
                    )
                ].append(book)

                by_title_last[
                    (
                        title,
                        last,
                    )
                ].append(book)

    return {
        "by_title_author":
            dict(by_title_author),
        "by_title_last":
            dict(by_title_last),
        "by_title":
            dict(by_title),
    }

def match_book(
    title: str,
    author_first: str,
    author_last: str,
    indexes: dict[
        str,
        dict[
            Any,
            list[
                dict[str, Any]
            ],
        ],
    ],
) -> tuple[
    dict[str, Any] | None,
    str,
    list[str],
]:
    title_key = normalize_text(title)

    first_key = normalize_text(
        author_first
    )

    last_key = normalize_text(
        author_last
    )

    attempts = [
        (
            "title-author",
            indexes[
                "by_title_author"
            ].get(
                (
                    title_key,
                    first_key,
                    last_key,
                ),
                [],
            ),
        ),
        (
            "title-last",
            indexes[
                "by_title_last"
            ].get(
                (
                    title_key,
                    last_key,
                ),
                [],
            ),
        ),
        (
            "title-only",
            indexes[
                "by_title"
            ].get(
                title_key,
                [],
            ),
        ),
    ]

    for (
        match_method,
        candidates,
    ) in attempts:
        unique_candidates = (
            unique_books(
                candidates
            )
        )

        if len(unique_candidates) == 1:
            return (
                unique_candidates[0],
                match_method,
                [],
            )

        if len(unique_candidates) > 1:
            keys = sorted(
                str(
                    candidate.get(
                        "catalogKey"
                    )
                    or candidate.get(
                        "bookId"
                    )
                    or "unknown"
                )
                for candidate
                in unique_candidates
            )

            return (
                None,
                "ambiguous",
                keys,
            )

    return (
        None,
        "unmatched",
        [],
    )

def load_books(
    path: Path,
) -> list[dict[str, Any]]:
    if not path.exists():
        raise BuildError(
            f"Library books JSON not found: "
            f"{path}"
        )

    with path.open(
        "r",
        encoding="utf-8",
    ) as file:
        data = json.load(file)

    if not isinstance(
        data,
        list,
    ):
        raise BuildError(
            f"Expected a JSON array in "
            f"{path}"
        )

    return data

# ---------------------------------------------------------------------------
# Challenge JSON generation
# ---------------------------------------------------------------------------

def build_challenge_data(
    workbook_path: Path,
    books_path: Path,
) -> tuple[
    dict[str, Any],
    list[str],
]:
    workbook_sheets = (
        read_workbook(
            workbook_path
        )
    )

    books = load_books(
        books_path
    )

    indexes = build_book_indexes(
        books
    )

    challenges: dict[
        str,
        dict[
            str,
            list[
                dict[str, Any]
            ],
        ],
    ] = {}

    challenge_names: dict[
        str,
        str,
    ] = {}

    reader_names: dict[
        tuple[str, str],
        str,
    ] = {}

    warnings: list[str] = []

    entry_id_counts: dict[
        str,
        int,
    ] = defaultdict(int)

    for (
        sheet_name,
        rows,
    ) in workbook_sheets:
        if (
            SHEET_NAME_SEPARATOR
            not in sheet_name
        ):
            continue

        (
            challenge_name,
            reader_name,
        ) = (
            part.strip()
            for part
            in sheet_name.rsplit(
                SHEET_NAME_SEPARATOR,
                1,
            )
        )

        if (
            not challenge_name
            or not reader_name
        ):
            warnings.append(
                "Skipped sheet with "
                "incomplete name: "
                f"{sheet_name!r}"
            )
            continue

        nonempty_rows = [
            (
                row_number,
                values,
            )
            for (
                row_number,
                values,
            ) in rows
            if any(
                value not in (
                    None,
                    "",
                )
                for value in values
            )
        ]

        if not nonempty_rows:
            warnings.append(
                f"Skipped empty sheet: "
                f"{sheet_name!r}"
            )
            continue

        (
            _,
            header_values,
        ) = nonempty_rows[0]

        headers = resolve_headers(
            sheet_name,
            header_values,
        )

        challenge_id = slugify(
            challenge_name
        )

        reader_id = slugify(
            reader_name
        )

        is_author_initial_challenge = (
            challenge_id
            in AUTHOR_INITIAL_CHALLENGE_IDS
        )

        challenge_names[
            challenge_id
        ] = challenge_name

        reader_names[
            (
                challenge_id,
                reader_id,
            )
        ] = reader_name

        challenge_readers = (
            challenges.setdefault(
                challenge_id,
                {},
            )
        )

        if reader_id in challenge_readers:
            raise BuildError(
                "Duplicate challenge/reader "
                "sheets for "
                f"{challenge_name!r} and "
                f"{reader_name!r}"
            )

        entries: list[
            dict[str, Any]
        ] = []

        challenge_readers[
            reader_id
        ] = entries

        for (
            row_number,
            values,
        ) in nonempty_rows[1:]:
            letter = display_text(
                value_at(
                    values,
                    headers["letter"],
                )
            ).upper()

            title = display_text(
                value_at(
                    values,
                    headers["title"],
                )
            )

            author_first = display_text(
                value_at(
                    values,
                    headers["first"],
                )
            )

            author_last = display_text(
                value_at(
                    values,
                    headers["last"],
                )
            )

            template_only_row = (
                bool(letter)
                and not any(
                    (
                        title,
                        author_first,
                        author_last,
                    )
                )
            )

            # Allows pre-filled A-Z/Wildcard template rows
            # to remain in otherwise empty challenge sheets.
            if template_only_row:
                continue

            if not any(
                (
                    letter,
                    title,
                    author_first,
                    author_last,
                )
            ):
                continue

            if (
                not letter
                or not title
            ):
                raise BuildError(
                    f"Sheet {sheet_name!r}, "
                    f"row {row_number}: "
                    "Letter and Title are "
                    "required"
                )

            explicit_wildcard = (
                normalize_text(letter)
                == "wildcard"
            )

            author_letters = (
                author_initial_letters(
                    author_first,
                    author_last,
                )
            )

            if is_author_initial_challenge:
                if not author_letters:
                    raise BuildError(
                        f"Sheet {sheet_name!r}, "
                        f"row {row_number}: "
                        "ABC Author entries must "
                        "contain an author First "
                        "or Last name"
                    )

                if (
                    not explicit_wildcard
                    and (
                        len(letter) != 1
                        or not letter.isalpha()
                    )
                ):
                    raise BuildError(
                        f"Sheet {sheet_name!r}, "
                        f"row {row_number}: "
                        "Letter must be A-Z or "
                        "'Wildcard'"
                    )

            (
                matched_book,
                match_status,
                candidate_keys,
            ) = match_book(
                title,
                author_first,
                author_last,
                indexes,
            )

            matched_book_id = (
                matched_book.get(
                    "bookId"
                )
                if matched_book
                else None
            )

            catalog_key = (
                matched_book.get(
                    "catalogKey"
                )
                if matched_book
                else None
            )

            if (
                match_status
                == "unmatched"
            ):
                warnings.append(
                    f"UNMATCHED: "
                    f"{sheet_name} "
                    f"row {row_number}: "
                    f"{title} — "
                    f"{author_first} "
                    f"{author_last}"
                )

            elif (
                match_status
                == "ambiguous"
            ):
                warnings.append(
                    f"AMBIGUOUS: "
                    f"{sheet_name} "
                    f"row {row_number}: "
                    f"{title} — "
                    f"{author_first} "
                    f"{author_last}; "
                    f"candidates: "
                    f"{', '.join(candidate_keys)}"
                )

            author = " ".join(
                part
                for part in (
                    author_first,
                    author_last,
                )
                if part
            )

            natural_letter = (
                natural_title_letter(
                    title
                )
            )

            if explicit_wildcard:
                wildcard = True

            elif is_author_initial_challenge:
                wildcard = (
                    letter not in author_letters
                )

            else:
                wildcard = (
                    len(letter) == 1
                    and letter.isalpha()
                    and natural_letter
                    != letter
                )

            identity_key = (
                catalog_key
                or matched_book_id
                or slugify(
                    f"{author_last} "
                    f"{author_first} "
                    f"{title}"
                )
            )

            base_entry_id = slugify(
                f"{challenge_id} "
                f"{reader_id} "
                f"{letter} "
                f"{identity_key}"
            )

            entry_id_counts[
                base_entry_id
            ] += 1

            occurrence = (
                entry_id_counts[
                    base_entry_id
                ]
            )

            entry_id = (
                base_entry_id
                if occurrence == 1
                else (
                    f"{base_entry_id}-"
                    f"{occurrence}"
                )
            )

            entries.append(
                {
                    "entryId":
                        entry_id,
                    "letter":
                        letter,
                    "title":
                        title,
                    "author":
                        author,
                    "authorFirst":
                        author_first,
                    "authorLast":
                        author_last,
                    "bookId":
                        matched_book_id,
                    "catalogKey":
                        catalog_key,
                    "read":
                        False,
                    "currentPage":
                        None,
                    "totalPages":
                        coerce_number(
                            matched_book.get(
                                "totalPages"
                            )
                        )
                        if matched_book
                        else None,
                    "naturalTitleLetter":
                        natural_letter,
                    "wildcard":
                        wildcard,
                    "sourceSheet":
                        sheet_name,
                    "sourceRow":
                        row_number,
                }
            )

        if not entries:
            challenge_readers.pop(
                reader_id,
                None,
            )

            reader_names.pop(
                (
                    challenge_id,
                    reader_id,
                ),
                None,
            )

            if not challenge_readers:
                challenges.pop(
                    challenge_id,
                    None,
                )

                challenge_names.pop(
                    challenge_id,
                    None,
                )

            warnings.append(
                "Skipped template-only "
                f"sheet: {sheet_name!r}"
            )

    if not challenges:
        raise BuildError(
            "No challenge sheets found. "
            "Expected names like "
            f"'ABC - CJ' in "
            f"{workbook_path}"
        )

    challenge_output: list[
        dict[str, Any]
    ] = []

    for challenge_id in sorted(
        challenges,
        key=lambda key:
            challenge_names[
                key
            ].casefold(),
    ):
        readers = challenges[
            challenge_id
        ]

        reader_output = [
            {
                "readerId":
                    reader_id,
                "readerName":
                    reader_names[
                        (
                            challenge_id,
                            reader_id,
                        )
                    ],
                "entries":
                    readers[
                        reader_id
                    ],
            }
            for reader_id in sorted(
                readers,
                key=lambda key:
                    reader_names[
                        (
                            challenge_id,
                            key,
                        )
                    ].casefold(),
            )
        ]

        challenge_output.append(
            {
                "challengeId":
                    challenge_id,
                "name":
                    challenge_names[
                        challenge_id
                    ],
                "readers":
                    reader_output,
            }
        )

    return (
        {
            "schemaVersion":
                SCHEMA_VERSION,
            "sourceWorkbook":
                workbook_path.name,
            "challenges":
                challenge_output,
        },
        warnings,
    )

# ---------------------------------------------------------------------------
# Command-line behavior
# ---------------------------------------------------------------------------

def default_workbook_path() -> Path:
    configured = os.environ.get(
        "MYLIBRARY_CHALLENGES_WORKBOOK"
    )

    if configured:
        return Path(
            configured
        ).expanduser()

    return (
        Path.home()
        / "OneDrive"
        / "Shared Workbooks"
        / "MyLibrary"
        / "CHALLENGES.xlsx"
    )

def parse_args() -> argparse.Namespace:
    repo_root = (
        Path(__file__)
        .resolve()
        .parents[1]
    )

    parser = argparse.ArgumentParser(
        description=(
            "Build library-challenges.json "
            "from CHALLENGES.xlsx"
        )
    )

    parser.add_argument(
        "--workbook",
        type=Path,
        default=default_workbook_path(),
        help="Path to CHALLENGES.xlsx",
    )

    parser.add_argument(
        "--books",
        type=Path,
        default=(
            repo_root
            / "public"
            / "data"
            / "library-books.json"
        ),
        help=(
            "Path to "
            "library-books.json"
        ),
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=(
            repo_root
            / "public"
            / "data"
            / "library-challenges.json"
        ),
        help=(
            "Output path for "
            "library-challenges.json"
        ),
    )

    parser.add_argument(
        "--allow-unmatched",
        action="store_true",
        help=(
            "Write JSON even when "
            "rows cannot be linked "
            "unambiguously"
        ),
    )

    mode_group = (
        parser.add_mutually_exclusive_group()
    )

    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Validate and summarize "
            "without reading or "
            "writing the output file"
        ),
    )

    mode_group.add_argument(
        "--check",
        action="store_true",
        help=(
            "Compare generated data "
            "with the output file "
            "without changing it"
        ),
    )

    return parser.parse_args()

def summarize(
    data: dict[str, Any],
) -> dict[str, int]:
    entries = [
        entry
        for challenge
        in data["challenges"]
        for reader
        in challenge["readers"]
        for entry
        in reader["entries"]
    ]

    return {
        "challenges":
            len(
                data["challenges"]
            ),
        "readers":
            sum(
                len(
                    challenge[
                        "readers"
                    ]
                )
                for challenge
                in data[
                    "challenges"
                ]
            ),
        "entries":
            len(entries),
        "matched":
            sum(
                entry["bookId"]
                is not None
                for entry in entries
            ),
        "wildcards":
            sum(
                entry["wildcard"]
                for entry in entries
            ),
    }

def first_difference(
    left: Any,
    right: Any,
    path: str = "root",
) -> str | None:
    if type(left) is not type(right):
        return (
            f"{path}: "
            f"{type(left).__name__} "
            f"!= "
            f"{type(right).__name__}"
        )

    if isinstance(left, dict):
        left_keys = set(left)
        right_keys = set(right)

        if left_keys != right_keys:
            missing = sorted(
                left_keys - right_keys
            )

            extra = sorted(
                right_keys - left_keys
            )

            return (
                f"{path}: "
                f"missing keys={missing}, "
                f"extra keys={extra}"
            )

        for key in left:
            difference = first_difference(
                left[key],
                right[key],
                f"{path}.{key}",
            )

            if difference:
                return difference

        return None

    if isinstance(left, list):
        if len(left) != len(right):
            return (
                f"{path}: list length "
                f"{len(left)} != "
                f"{len(right)}"
            )

        for (
            index,
            (
                left_item,
                right_item,
            ),
        ) in enumerate(
            zip(
                left,
                right,
            )
        ):
            difference = (
                first_difference(
                    left_item,
                    right_item,
                    f"{path}[{index}]",
                )
            )

            if difference:
                return difference

        return None

    if left != right:
        return (
            f"{path}: "
            f"{left!r} != "
            f"{right!r}"
        )

    return None

def main() -> int:
    args = parse_args()

    workbook_path = (
        args.workbook
        .expanduser()
        .resolve()
    )

    books_path = (
        args.books
        .expanduser()
        .resolve()
    )

    output_path = (
        args.output
        .expanduser()
        .resolve()
    )

    try:
        (
            data,
            warnings,
        ) = build_challenge_data(
            workbook_path,
            books_path,
        )

    except (
        BuildError,
        OSError,
        json.JSONDecodeError,
    ) as error:
        print(
            f"ERROR: {error}",
            file=sys.stderr,
        )
        return 1

    blocking_warnings = [
        warning
        for warning in warnings
        if (
            warning.startswith(
                "UNMATCHED:"
            )
            or warning.startswith(
                "AMBIGUOUS:"
            )
        )
    ]

    for warning in warnings:
        print(
            f"WARNING: {warning}",
            file=sys.stderr,
        )

    summary = summarize(data)

    print(
        f"Challenges: "
        f"{summary['challenges']}"
    )

    print(
        f"Readers: "
        f"{summary['readers']}"
    )

    print(
        f"Entries: "
        f"{summary['entries']}"
    )

    print(
        f"Matched to library: "
        f"{summary['matched']}"
    )

    print(
        f"Wildcards: "
        f"{summary['wildcards']}"
    )

    if (
        blocking_warnings
        and not args.allow_unmatched
    ):
        print(
            "ERROR: Some challenge rows "
            "were unmatched or ambiguous. "
            "Fix the workbook/library data, "
            "or rerun with "
            "--allow-unmatched.",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        print(
            "Dry run complete; "
            "no file written."
        )
        return 0

    if args.check:
        if not output_path.exists():
            print(
                "CHECK FAILED: "
                "Comparison file does "
                "not exist: "
                f"{output_path}",
                file=sys.stderr,
            )
            return 3

        try:
            with output_path.open(
                "r",
                encoding="utf-8",
            ) as file:
                existing_data = (
                    json.load(file)
                )

        except (
            OSError,
            json.JSONDecodeError,
        ) as error:
            print(
                f"CHECK FAILED: {error}",
                file=sys.stderr,
            )
            return 3

        difference = first_difference(
            data,
            existing_data,
        )

        if difference:
            print(
                f"CHECK FAILED: "
                f"{difference}",
                file=sys.stderr,
            )
            return 3

        print(
            "CHECK PASSED: "
            "Generated data matches "
            f"{output_path}"
        )

        return 0

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = (
        output_path.with_name(
            f".{output_path.name}.tmp"
        )
    )

    try:
        with temporary_path.open(
            "w",
            encoding="utf-8",
            newline="\n",
        ) as file:
            json.dump(
                data,
                file,
                indent=2,
                ensure_ascii=False,
            )

            file.write("\n")

        temporary_path.replace(
            output_path
        )

    except OSError as error:
        temporary_path.unlink(
            missing_ok=True
        )

        print(
            "ERROR: Could not write "
            f"{output_path}: {error}",
            file=sys.stderr,
        )

        return 1

    print(
        f"Wrote: {output_path}"
    )

    return 0

if __name__ == "__main__":
    raise SystemExit(main())