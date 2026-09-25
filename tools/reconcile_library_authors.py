"""Review author identities without guessing that similar names are one person."""
from difflib import SequenceMatcher
import json
import os
from datetime import datetime
from uuid import uuid4


def build_review(authors, credits_by_name, book_rows, previous_rows, titles,
                 normalize, preferred):
    lookup = {}
    for author in authors:
        for name in [author['displayName'], *(author.get('aliases') or [])]:
            lookup[normalize(name)] = author
    credited_ids = {lookup[key]['authorId'] for key in credits_by_name if key in lookup}
    previous_by_book = {}
    for row in previous_rows:
        previous_by_book.setdefault(row['bookId'], set()).add(row['authorId'])
    new = []
    for key in sorted(set(credits_by_name) - set(lookup)):
        credit = preferred(credits_by_name[key])
        book_ids = sorted({r['bookId'] for r in book_rows if r['_nameKey'] == key})
        previous_ids = set().union(*(previous_by_book.get(b, set()) for b in book_ids))
        candidates = []
        for author in authors:
            similarity = max(SequenceMatcher(None, key, normalize(name)).ratio()
                             for name in [author['displayName'], *(author.get('aliases') or [])])
            shared = author['authorId'] in previous_ids
            if shared or similarity >= 0.78:
                candidates.append({
                    'authorId': author['authorId'], 'name': author['displayName'],
                    'reason': 'previously credited on this book' if shared else 'similar name',
                    '_rank': (shared, similarity),
                })
        candidates.sort(key=lambda c: c['_rank'], reverse=True)
        new.append({'key': key, 'credit': credit,
                    'books': [titles.get(b, b) for b in book_ids],
                    'candidates': candidates[:5]})
    return {'new': new, 'retained': [a for a in authors if a['authorId'] not in credited_ids]}


def print_review(review):
    print('\nAUTHOR RECONCILIATION')
    for item in review['new']:
        print(f"  Unfamiliar: {item['credit']['displayName']}")
        print('    Books: ' + '; '.join(item['books'][:4]))
        for c in item['candidates']:
            print(f"    Possible match: {c['name']} ({c['authorId']}; {c['reason']})")
    print('\nRetained identities with no current/archive credits (not deleted):')
    for author in review['retained']:
        print(f"  {author['displayName']} ({author['authorId']})")
    if not review['retained']:
        print('  None')


def collect_decisions(review, authors, ask=None):
    """Collect everything before modifying the registry. Blank input cancels."""
    if ask is None:
        ask = input
    decisions = {}
    valid_ids = {a['authorId'] for a in authors}
    for item in review['new']:
        if not item['candidates']:
            continue
        print(f"\nReview {item['credit']['displayName']}: {'; '.join(item['books'][:3])}")
        for i, candidate in enumerate(item['candidates'], 1):
            print(f"  {i}. {candidate['name']} - {candidate['reason']}")
        print('Choose an existing person only if this is the SAME person.')
        print('For a combined credit split into separate people, use NEW; the combined ID is retained.')
        while True:
            choice = ask('Number = same person; NEW = distinct author; ID author-... = other match; Q = cancel: ').strip()
            if not choice or choice.lower() == 'q':
                raise ValueError('Author review cancelled. No author files were written.')
            if choice.lower() == 'new':
                decisions[item['key']] = None
                break
            if choice.isdigit() and 1 <= int(choice) <= len(item['candidates']):
                decisions[item['key']] = item['candidates'][int(choice) - 1]['authorId']
                break
            if choice.lower().startswith('id ') and choice[3:].strip() in valid_ids:
                decisions[item['key']] = choice[3:].strip()
                break
            print('Enter a listed number, NEW, a valid ID, or Q.')
    unmatched = [i for i in review['new'] if i['key'] not in decisions]
    if unmatched:
        print('\nNames without suggested matches:')
        for item in unmatched:
            print(f"  {item['credit']['displayName']} - {'; '.join(item['books'][:2])}")
        choice = ask('Type NEW to create these identities, REVIEW to choose individually, or Q to cancel: ').strip().lower()
        if choice == 'new':
            decisions.update({i['key']: None for i in unmatched})
        elif choice == 'review':
            for item in unmatched:
                while True:
                    choice = ask(f"{item['credit']['displayName']}: NEW, existing author ID, or Q: ").strip()
                    if choice.lower() == 'new':
                        decisions[item['key']] = None
                        break
                    if choice in valid_ids:
                        decisions[item['key']] = choice
                        break
                    if not choice or choice.lower() == 'q':
                        raise ValueError('Author review cancelled. No author files were written.')
                    print('Unknown author ID.')
        else:
            raise ValueError('Author review cancelled. No author files were written.')
    print(f"\nNew identities: {sum(v is None for v in decisions.values())}")
    for item in review['new']:
        target = decisions[item['key']]
        if target:
            name = next(a['displayName'] for a in authors if a['authorId'] == target)
            print(f"  Preserve {target}: {name} -> {item['credit']['displayName']}")
    if decisions and ask('Type APPLY AUTHORS to save this review, or press Enter to cancel: ').strip() != 'APPLY AUTHORS':
        raise ValueError('Author review cancelled. No author files were written.')
    return decisions


def apply_decisions(review, authors, decisions, normalize):
    by_id = {a['authorId']: a for a in authors}
    for item in review['new']:
        target = decisions[item['key']]
        if target is None:
            continue
        author = by_id[target]
        old_name = author['displayName']
        aliases = list(author.get('aliases') or [])
        if old_name not in aliases:
            aliases.append(old_name)
        author.update(item['credit'])
        author['aliases'] = [a for a in aliases if normalize(a) != item['key']]


def save_author_outputs(outputs, snapshot, backup_root, decisions):
    """Back up and replace the three author files; reject stale review input."""
    for path, expected in snapshot.items():
        if (path.read_bytes() if path.exists() else None) != expected:
            raise ValueError(f'{path.name} changed during review. Run the review again.')
    encoded = {p: (json.dumps(v, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
               for p, v in outputs.items()}
    changed = {p: data for p, data in encoded.items() if data != snapshot.get(p)}
    if not changed:
        return
    backup = backup_root / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid4().hex[:8])
    backup.mkdir(parents=True)
    for p in outputs:
        if snapshot.get(p) is not None:
            (backup / p.name).write_bytes(snapshot[p])
    (backup / 'review-decisions.json').write_text(
        json.dumps(decisions, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    written = []
    temporary = []
    try:
        for path, data in changed.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
            temporary.append(temp)
            temp.write_bytes(data)
            os.replace(temp, path)
            written.append(path)
    except Exception:
        for path in written:
            if snapshot.get(path) is None:
                path.unlink()
            else:
                path.write_bytes(snapshot[path])
        raise
    finally:
        for path in temporary:
            if path.exists():
                path.unlink()
    print(f'Author file backups and review decisions: {backup}')
