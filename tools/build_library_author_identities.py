from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4


REPO_ROOT = Path(__file__).resolve().parents[1]

BOOKS_PATH = (
    REPO_ROOT
    / "public"
    / "data"
    / "library-books.json"
)

ARCHIVE_PATH = (
    REPO_ROOT
    / "public"
    / "data"
    / "library-archive.json"
)

REGISTRY_PATH = (
    REPO_ROOT
    / "tools"
    / "library-author-identities.json"
)

AUTHORS_OUTPUT_PATH = (
    REPO_ROOT
    / "public"
    / "data"
    / "library-authors.json"
)

BOOK_AUTHORS_OUTPUT_PATH = (
    REPO_ROOT
    / "public"
    / "data"
    / "library-book-authors.json"
)

AUTHOR_ID_PATTERN = re.compile(
    r"^author-"
    r"[0-9a-f]{8}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{12}$"
)

BOOK_ID_PATTERN = re.compile(
    r"^book-"
    r"[0-9a-f]{8}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{12}$"
)


def clean(value: Any) -> str:
    return str(value or "").strip()


def split_name_parts(value: Any) -> list[str]:
    return [
        clean(part)
        for part in re.split(
            r"[;\r\n]+",
            clean(value),
        )
        if clean(part)
    ]


def normalize_author_name(
    value: Any,
) -> str:
    text = unicodedata.normalize(
        "NFKC",
        clean(value),
    )

    text = (
        text.replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("–", "-")
        .replace("—", "-")
        .casefold()
    )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def make_display_name(
    first_name: str,
    last_name: str,
) -> str:
    return " ".join(
        part
        for part in [
            clean(first_name),
            clean(last_name),
        ]
        if part
    )


def make_sort_name(
    first_name: str,
    last_name: str,
    display_name: str,
) -> str:
    first_name = clean(first_name)
    last_name = clean(last_name)

    if first_name and last_name:
        return (
            f"{last_name}, "
            f"{first_name}"
        )

    return (
        last_name
        or first_name
        or display_name
    )


def validate_prefixed_uuid(
    value: str,
    prefix: str,
) -> None:
    if not value.startswith(prefix):
        raise ValueError(
            f"Expected an ID beginning "
            f"with {prefix!r}: {value!r}"
        )

    uuid_text = value.removeprefix(prefix)

    try:
        parsed = UUID(uuid_text)
    except ValueError as error:
        raise ValueError(
            f"Malformed ID: {value!r}"
        ) from error

    if (
        parsed.version != 4
        or str(parsed) != uuid_text
    ):
        raise ValueError(
            "Expected a canonical version-4 "
            f"UUID: {value!r}"
        )


def validate_author_id(
    author_id: str,
) -> None:
    if not AUTHOR_ID_PATTERN.fullmatch(
        author_id
    ):
        raise ValueError(
            "Malformed Author ID: "
            f"{author_id!r}"
        )

    validate_prefixed_uuid(
        author_id,
        "author-",
    )


def validate_book_id(
    book_id: str,
) -> None:
    if not BOOK_ID_PATTERN.fullmatch(
        book_id
    ):
        raise ValueError(
            "Malformed Book ID: "
            f"{book_id!r}"
        )

    validate_prefixed_uuid(
        book_id,
        "book-",
    )


def load_json(path: Path) -> Any:
    return json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


def load_optional_json_array(
    path: Path,
) -> list[Any]:
    if not path.exists():
        return []

    value = load_json(path)

    if not isinstance(value, list):
        raise ValueError(
            f"{path.name} must contain "
            "a JSON array."
        )

    return value


def write_json(
    path: Path,
    value: Any,
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    path.write_text(
        json.dumps(
            value,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def load_registry() -> dict[str, Any]:
    if not REGISTRY_PATH.exists():
        return {
            "version": 1,
            "authors": [],
        }

    registry = load_json(
        REGISTRY_PATH
    )

    if not isinstance(
        registry,
        dict,
    ):
        raise ValueError(
            "Author registry must be "
            "a JSON object."
        )

    if registry.get("version") != 1:
        raise ValueError(
            "Unsupported author registry "
            "version."
        )

    authors = registry.get(
        "authors"
    )

    if not isinstance(
        authors,
        list,
    ):
        raise ValueError(
            "Author registry authors must "
            "be a JSON array."
        )

    return registry


def extract_book_credits(
    book: dict[str, Any],
) -> tuple[
    list[dict[str, str]],
    bool,
]:
    first_parts = split_name_parts(
        book.get("firstName")
    )

    last_parts = split_name_parts(
        book.get("lastName")
    )

    unbalanced = (
        bool(first_parts)
        and bool(last_parts)
        and len(first_parts)
        != len(last_parts)
    )

    credit_count = max(
        len(first_parts),
        len(last_parts),
    )

    credits: list[
        dict[str, str]
    ] = []

    if credit_count > 0:
        for index in range(
            credit_count
        ):
            first_name = (
                first_parts[index]
                if index
                < len(first_parts)
                else ""
            )

            last_name = (
                last_parts[index]
                if index
                < len(last_parts)
                else ""
            )

            display_name = (
                make_display_name(
                    first_name,
                    last_name,
                )
            )

            if not display_name:
                continue

            credits.append(
                {
                    "displayName":
                        display_name,

                    "firstName":
                        first_name,

                    "lastName":
                        last_name,

                    "sortName":
                        make_sort_name(
                            first_name,
                            last_name,
                            display_name,
                        ),
                }
            )

        return (
            deduplicate_credits(
                credits
            ),
            unbalanced,
        )

    # Defensive fallback for a future or
    # malformed row that has the combined
    # author string but no First/Last data.
    for display_name in (
        split_name_parts(
            book.get("author")
        )
    ):
        credits.append(
            {
                "displayName":
                    display_name,

                "firstName": "",

                "lastName": "",

                "sortName":
                    display_name,
            }
        )

    return (
        deduplicate_credits(
            credits
        ),
        unbalanced,
    )


def deduplicate_credits(
    credits: list[
        dict[str, str]
    ],
) -> list[dict[str, str]]:
    seen_names: set[str] = set()

    unique_credits: list[
        dict[str, str]
    ] = []

    for credit in credits:
        name_key = (
            normalize_author_name(
                credit["displayName"]
            )
        )

        if (
            not name_key
            or name_key in seen_names
        ):
            continue

        seen_names.add(name_key)
        unique_credits.append(
            credit
        )

    return unique_credits


def build_registry_lookup(
    registry_authors: list[
        dict[str, Any]
    ],
) -> dict[
    str,
    dict[str, Any],
]:
    lookup: dict[
        str,
        dict[str, Any]
    ] = {}

    seen_author_ids: set[
        str
    ] = set()

    for author in registry_authors:
        author_id = clean(
            author.get("authorId")
        )

        validate_author_id(
            author_id
        )

        if author_id in seen_author_ids:
            raise ValueError(
                "Duplicate Author ID in "
                f"registry: {author_id}"
            )

        seen_author_ids.add(
            author_id
        )

        names = [
            clean(
                author.get(
                    "displayName"
                )
            ),
            *[
                clean(alias)
                for alias in (
                    author.get(
                        "aliases"
                    )
                    or []
                )
            ],
        ]

        for name in names:
            name_key = (
                normalize_author_name(
                    name
                )
            )

            if not name_key:
                continue

            existing = lookup.get(
                name_key
            )

            if (
                existing is not None
                and existing[
                    "authorId"
                ]
                != author_id
            ):
                raise ValueError(
                    "Author name or alias "
                    "belongs to multiple "
                    "identities: "
                    f"{name!r}"
                )

            lookup[name_key] = author

    return lookup


def choose_preferred_credit(
    credits: list[
        dict[str, str]
    ],
) -> dict[str, str]:
    variants = Counter(
        (
            credit[
                "displayName"
            ],
            credit[
                "firstName"
            ],
            credit[
                "lastName"
            ],
            credit[
                "sortName"
            ],
        )
        for credit in credits
    )

    preferred_variant = sorted(
        variants.items(),
        key=lambda item: (
            -item[1],
            normalize_author_name(
                item[0][3]
            ),
            normalize_author_name(
                item[0][0]
            ),
        ),
    )[0][0]

    return {
        "displayName":
            preferred_variant[0],

        "firstName":
            preferred_variant[1],

        "lastName":
            preferred_variant[2],

        "sortName":
            preferred_variant[3],
    }


def make_author_record(
    credit: dict[str, str],
) -> dict[str, Any]:
    return {
        "authorId":
            f"author-{uuid4()}",

        "displayName":
            credit["displayName"],

        "firstName":
            credit["firstName"],

        "lastName":
            credit["lastName"],

        "sortName":
            credit["sortName"],

        # Alternate spellings, corrected
        # forms, or credited names can be
        # added here later without changing
        # the permanent Author ID.
        "aliases": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create and preserve permanent "
            "MyLibrary author identities."
        )
    )

    parser.add_argument(
        "--write",
        action="store_true",
        help=(
            "Write the persistent registry "
            "and generated author files."
        ),
    )

    args = parser.parse_args()

    if not BOOKS_PATH.exists():
        raise FileNotFoundError(
            "Could not find generated "
            f"book data: {BOOKS_PATH}"
        )

    books = load_json(
        BOOKS_PATH
    )

    if not isinstance(
        books,
        list,
    ):
        raise ValueError(
            "library-books.json must "
            "contain a JSON array."
        )

    archived_books = load_optional_json_array(
        ARCHIVE_PATH
    )

    registry = load_registry()

    registry_authors = (
        registry["authors"]
    )

    registry_lookup = (
        build_registry_lookup(
            registry_authors
        )
    )

    credits_by_name: dict[
        str,
        list[dict[str, str]],
    ] = defaultdict(list)

    book_credit_rows: list[
        dict[str, Any]
    ] = []

    identity_credit_count = 0

    unbalanced_books: list[
        dict[str, Any]
    ] = []

    books_without_authors: list[
        dict[str, Any]
    ] = []

    multi_author_book_count = 0

    for source_name, source_books in (
        ("current", books),
        ("archive", archived_books),
    ):
        for book in source_books:
            if not isinstance(
                book,
                dict,
            ):
                raise ValueError(
                    f"Every {source_name} "
                    "book row must be a "
                    "JSON object."
                )

            book_id = clean(
                book.get("bookId")
            )

            validate_book_id(
                book_id
            )

            credits, unbalanced = (
                extract_book_credits(
                    book
                )
            )

            if unbalanced:
                unbalanced_books.append(
                    {
                        "bookId":
                            book_id,

                        "title":
                            clean(
                                book.get(
                                    "title"
                                )
                            ),

                        "firstName":
                            clean(
                                book.get(
                                    "firstName"
                                )
                            ),

                        "lastName":
                            clean(
                                book.get(
                                    "lastName"
                                )
                            ),

                        "author":
                            clean(
                                book.get(
                                    "author"
                                )
                            ),

                        "source":
                            source_name,
                    }
                )

            if not credits:
                books_without_authors.append(
                    {
                        "bookId":
                            book_id,

                        "title":
                            clean(
                                book.get(
                                    "title"
                                )
                            ),

                        "source":
                            source_name,
                    }
                )

                continue

            if len(credits) > 1:
                multi_author_book_count += 1

            for credit_order, credit in (
                enumerate(
                    credits,
                    start=1,
                )
            ):
                name_key = (
                    normalize_author_name(
                        credit[
                            "displayName"
                        ]
                    )
                )

                credits_by_name[
                    name_key
                ].append(
                    credit
                )

                identity_credit_count += 1

                if source_name != "current":
                    continue

                book_credit_rows.append(
                    {
                        "bookId":
                            book_id,

                        "creditOrder":
                            credit_order,

                        "creditedName":
                            credit[
                                "displayName"
                            ],

                        "_nameKey":
                            name_key,
                    }
                )

    current_name_keys = sorted(
        credits_by_name
    )

    existing_name_keys = [
        name_key
        for name_key
        in current_name_keys
        if name_key
        in registry_lookup
    ]

    new_name_keys = [
        name_key
        for name_key
        in current_name_keys
        if name_key
        not in registry_lookup
    ]

    active_registry_ids = {
        registry_lookup[
            name_key
        ]["authorId"]
        for name_key
        in existing_name_keys
    }

    orphaned_registry_authors = [
        author
        for author
        in registry_authors
        if author["authorId"]
        not in active_registry_ids
    ]

    print(
        "\nLibrary author identity "
        "preview"
    )

    print(
        f"  Books: {len(books)}"
    )

    print(
        "  Archived books protecting "
        "identities: "
        f"{len(archived_books)}"
    )

    print(
        "  Active book-author credits: "
        f"{len(book_credit_rows)}"
    )

    print(
        "  Current/archive "
        "book-author credits: "
        f"{identity_credit_count}"
    )

    print(
        "  Unique current/archive "
        "authors: "
        f"{len(current_name_keys)}"
    )

    print(
        "  Existing identities matched: "
        f"{len(existing_name_keys)}"
    )

    print(
        "  New identities needed: "
        f"{len(new_name_keys)}"
    )

    print(
        "  Multi-author books: "
        f"{multi_author_book_count}"
    )

    print(
        "  Mismatched populated First/Last rows: "
        f"{len(unbalanced_books)}"
    )

    print(
        "  Books without an author: "
        f"{len(books_without_authors)}"
    )

    print(
        "  Registry identities no longer "
        "credited: "
        f"{len(orphaned_registry_authors)}"
    )

    if unbalanced_books:
        print(
            "\nFirst mismatched "
            "author rows:"
        )

        for row in (
            unbalanced_books[:10]
        ):
            print(
                "  - "
                f"{row['title']}: "
                f"First={row['firstName']!r}, "
                f"Last={row['lastName']!r}"
            )

    if books_without_authors:
        print(
            "\nBooks without "
            "author credits:"
        )

        for row in (
            books_without_authors[:10]
        ):
            print(
                "  - "
                f"{row['title']} "
                f"({row['bookId']})"
            )

    if not args.write:
        print(
            "\nPreview only. No files "
            "were changed."
        )

        print(
            "Run again with --write "
            "after reviewing this summary."
        )

        return

    author_by_name_key = dict(
        registry_lookup
    )

    for name_key in new_name_keys:
        preferred_credit = (
            choose_preferred_credit(
                credits_by_name[
                    name_key
                ]
            )
        )

        new_author = (
            make_author_record(
                preferred_credit
            )
        )

        registry_authors.append(
            new_author
        )

        author_by_name_key[
            name_key
        ] = new_author

    registry_authors.sort(
        key=lambda author: (
            normalize_author_name(
                author.get(
                    "sortName"
                )
            ),
            author["authorId"],
        )
    )

    author_book_counts: Counter[
        str
    ] = Counter()

    generated_book_authors: list[
        dict[str, Any]
    ] = []

    for row in book_credit_rows:
        author = (
            author_by_name_key[
                row["_nameKey"]
            ]
        )

        author_id = author[
            "authorId"
        ]

        author_book_counts[
            author_id
        ] += 1

        generated_book_authors.append(
            {
                "bookId":
                    row["bookId"],

                "authorId":
                    author_id,

                "creditOrder":
                    row[
                        "creditOrder"
                    ],

                "creditedName":
                    row[
                        "creditedName"
                    ],
            }
        )

    generated_book_authors.sort(
        key=lambda row: (
            row["bookId"],
            row["creditOrder"],
        )
    )

    active_author_ids = set(
        author_book_counts
    )

    generated_authors = [
        {
            "authorId":
                author[
                    "authorId"
                ],

            "displayName":
                author[
                    "displayName"
                ],

            "firstName":
                clean(
                    author.get(
                        "firstName"
                    )
                ),

            "lastName":
                clean(
                    author.get(
                        "lastName"
                    )
                ),

            "sortName":
                author[
                    "sortName"
                ],

            "aliases":
                author.get(
                    "aliases"
                )
                or [],

            "bookCount":
                author_book_counts[
                    author[
                        "authorId"
                    ]
                ],
        }
        for author in registry_authors
        if author["authorId"]
        in active_author_ids
    ]

    generated_authors.sort(
        key=lambda author: (
            normalize_author_name(
                author[
                    "sortName"
                ]
            ),
            author[
                "authorId"
            ],
        )
    )

    write_json(
        REGISTRY_PATH,
        {
            "version": 1,
            "authors":
                registry_authors,
        },
    )

    write_json(
        AUTHORS_OUTPUT_PATH,
        generated_authors,
    )

    write_json(
        BOOK_AUTHORS_OUTPUT_PATH,
        generated_book_authors,
    )

    print(
        "\nAuthor identities written."
    )

    print(
        "  Registry: "
        f"{REGISTRY_PATH}"
    )

    print(
        "  Generated authors: "
        f"{AUTHORS_OUTPUT_PATH}"
    )

    print(
        "  Generated book links: "
        f"{BOOK_AUTHORS_OUTPUT_PATH}"
    )

    print(
        "  Permanent Author IDs: "
        f"{len(registry_authors)}"
    )

    print(
        "  Active authors: "
        f"{len(generated_authors)}"
    )

    print(
        "  Book-author links: "
        f"{len(generated_book_authors)}"
    )


if __name__ == "__main__":
    main()
