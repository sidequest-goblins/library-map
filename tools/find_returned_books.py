"""Read-only candidates for an explicit original-copy return confirmation."""
import json
from pathlib import Path

from build_library_data import clean, parse_title, make_author_sort, make_catalog_key
from library_archive_policy import archive_conflicts
from scan_library_archive import CURRENT, read_xlsx


def find_candidates(rows, archive):
    candidates = []
    for row in rows:
        title = clean(row.get('Title'))
        book = {
            'title': title, 'bookId': clean(row.get('Book ID')),
            'isbn': clean(row.get('ISBN')),
            'catalogKey': make_catalog_key(clean(parse_title(title)['title']),
                make_author_sort(clean(row.get('First')), clean(row.get('Last')))),
        }
        matches = [old for old in archive if archive_conflicts([book], [old])]
        for old in matches:
            candidates.append({
                'title': title, 'isbn': book['isbn'],
                'replacementId': book['bookId'], 'originalId': old['bookId'],
                'repairable': len(matches) == 1 and bool(book['bookId'])
                    and book['bookId'] != old['bookId']
                    and title == old.get('title') and book['isbn'] == old.get('isbn')
                    and sum(clean(other.get('Book ID')) == book['bookId'] for other in rows) == 1
                    and not any(clean(other.get('Book ID')) == old['bookId'] for other in rows),
            })
    return candidates


if __name__ == '__main__':
    records, _, _ = read_xlsx(CURRENT)
    archive = json.loads((Path(__file__).resolve().parents[1] /
        'public/data/library-archive.json').read_text(encoding='utf-8-sig'))
    print(json.dumps(find_candidates([r['values'] for r in records], archive)))
