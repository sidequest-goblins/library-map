import json
import re
from pathlib import Path
from typing import Any
from uuid import UUID


ROOT_DIR = Path(__file__).resolve().parents[1]

BOOKS_PATH = (
    ROOT_DIR
    / "public"
    / "data"
    / "library-books.json"
)

OUTPUT_PATH = (
    ROOT_DIR
    / "supabase"
    / "migrations"
    / "library_09_migrate_lgbtq_from_workbook"
)

HOUSEHOLD_USER_ID = UUID(
    "2ffd4a75-0f05-41ca-bd69-fa035ee57e22"
)

BOOK_ID_PATTERN = re.compile(
    r"^book-[0-9a-f]{8}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{12}$"
)

def parse_checkbox(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    return str(value or "").strip().lower() in {
        "true",
        "yes",
        "y",
        "1",
        "checked",
        "x",
    }

def load_books() -> list[dict[str, Any]]:
    if not BOOKS_PATH.exists():
        raise FileNotFoundError(
            f"Could not find library data: {BOOKS_PATH}"
        )

    payload = json.loads(
        BOOKS_PATH.read_text(encoding="utf-8")
    )

    if isinstance(payload, list):
        books = payload
    elif (
        isinstance(payload, dict)
        and isinstance(payload.get("books"), list)
    ):
        books = payload["books"]
    else:
        raise ValueError(
            "library-books.json must contain either a "
            "top-level array or an object with a books array."
        )

    return books

def build_metadata_rows(
    books: list[dict[str, Any]],
) -> list[tuple[str, bool]]:
    rows: list[tuple[str, bool]] = []
    seen_book_ids: set[str] = set()

    for index, book in enumerate(books, start=1):
        book_id = str(
            book.get("bookId") or ""
        ).strip()

        if not book_id:
            raise ValueError(
                f"Book entry {index} has no bookId."
            )

        if not BOOK_ID_PATTERN.fullmatch(book_id):
            raise ValueError(
                f"Book entry {index} has an invalid "
                f"bookId: {book_id!r}"
            )

        if book_id in seen_book_ids:
            raise ValueError(
                f"Duplicate bookId found: {book_id}"
            )

        seen_book_ids.add(book_id)

        rows.append(
            (
                book_id,
                parse_checkbox(book.get("lgbtq")),
            )
        )

    rows.sort(key=lambda row: row[0])

    return rows

def build_sql(
    rows: list[tuple[UUID, bool]],
) -> str:
    lgbtq_count = sum(
        1
        for _, is_lgbtq in rows
        if is_lgbtq
    )

    value_lines = []

    for book_id, is_lgbtq in rows:
        sql_boolean = (
            "true"
            if is_lgbtq
            else "false"
        )

        value_lines.append(
            "  "
            f"('{HOUSEHOLD_USER_ID}'::uuid, "
            f"'{book_id}', "
            f"{sql_boolean})"
        )

    values_sql = ",\n".join(value_lines)

    return f"""-- ============================================================
-- MyLibrary: one-time LGBTQ+ workbook metadata migration
-- ============================================================
--
-- Generated from:
--   public/data/library-books.json
--
-- Expected book rows: {len(rows)}
-- Expected LGBTQ+ rows: {lgbtq_count}
--
-- ON CONFLICT DO NOTHING is intentional.
-- Rerunning this migration will fill missing rows but will not
-- overwrite metadata already edited in Supabase.
-- ============================================================

insert into public.library_book_metadata (
  user_id,
  book_id,
  lgbtq
)
values
{values_sql}
on conflict (user_id, book_id)
do nothing;

-- ============================================================
-- Verification
-- ============================================================

select
  count(*) as total_metadata_rows,
  count(*) filter (
    where lgbtq
  ) as lgbtq_rows,
  count(*) filter (
    where not lgbtq
  ) as non_lgbtq_rows
from public.library_book_metadata
where user_id =
  '{HOUSEHOLD_USER_ID}'::uuid;
"""

def main() -> None:
    books = load_books()
    rows = build_metadata_rows(books)
    sql = build_sql(rows)

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_PATH.write_text(
        sql,
        encoding="utf-8",
    )

    lgbtq_count = sum(
        1
        for _, is_lgbtq in rows
        if is_lgbtq
    )

    print("LGBTQ+ metadata migration generated.")
    print(f"  Source: {BOOKS_PATH}")
    print(f"  Output: {OUTPUT_PATH}")
    print(f"  Total books: {len(rows)}")
    print(f"  LGBTQ+ books: {lgbtq_count}")
    print(
        "  Non-LGBTQ+ books: "
        f"{len(rows) - lgbtq_count}"
    )

if __name__ == "__main__":
    main()