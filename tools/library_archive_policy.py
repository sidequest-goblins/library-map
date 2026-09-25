"""Distinguish physical identity from title/author matches in the archive."""
import re


def canonical_isbn(value):
    """Return a validated ISBN-13, including equivalent ISBN-10 forms."""
    text = re.sub(r"[\s-]", "", str(value or "")).upper()
    if len(text) == 10 and re.fullmatch(r"\d{9}[\dX]", text):
        digits = [10 if c == "X" else int(c) for c in text]
        if sum((10 - i) * n for i, n in enumerate(digits)) % 11:
            return None
        text = "978" + text[:9]
        check = (-sum(int(c) * (1 if i % 2 == 0 else 3)
                      for i, c in enumerate(text))) % 10
        return text + str(check)
    if len(text) == 13 and text.isascii() and text.isdigit() and text.startswith(("978", "979")):
        if sum(int(c) * (1 if i % 2 == 0 else 3)
               for i, c in enumerate(text)) % 10 == 0:
            return text
    return None


def archive_conflicts(books, archived):
    """Different validated ISBNs can coexist; missing/invalid ones need review."""
    conflicts = []
    for book in books:
        for old in archived:
            if book.get("bookId") and book["bookId"] == old.get("bookId"):
                reason = "reuses archived Book ID; deliberately restore the original copy"
            elif book.get("catalogKey") and book["catalogKey"] == old.get("catalogKey"):
                current_isbn = canonical_isbn(book.get("isbn"))
                old_isbn = canonical_isbn(old.get("isbn"))
                if current_isbn and old_isbn and current_isbn != old_isbn:
                    continue
                reason = "same title/author with matching or uncertain ISBN; review original vs replacement copy"
            else:
                continue
            conflicts.append(
                f"{book.get('title')}: {reason} "
                f"(current ISBN {book.get('isbn') or 'missing'}, "
                f"archived ISBN {old.get('isbn') or 'missing'})"
            )
    return conflicts
