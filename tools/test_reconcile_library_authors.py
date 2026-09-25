import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_library_author_identities as builder
from reconcile_library_authors import (
    apply_decisions, build_review, collect_decisions, save_author_outputs,
)


def author(name, author_id='old'):
    return dict(authorId=author_id, displayName=name, firstName=name.split()[0],
                lastName=name.split()[-1], sortName=name, aliases=[])


def review_for(names, authors, previous=()):
    credits = {name.lower(): [author(name)] for name in names}
    rows = [dict(bookId='book', _nameKey=n.lower()) for n in names]
    return build_review(authors, credits, rows, previous, {'book': 'Example book'},
                        str.lower, lambda c: {k: v for k, v in c[0].items()
                                             if k not in ('authorId', 'aliases')})


class ReconciliationTests(unittest.TestCase):
    def test_correction_keeps_id_old_spelling_and_metadata(self):
        authors = [author('Jenni Olsen')]
        authors[0]['custom'] = 'preserved'
        review = review_for(['Jenni Ogden'], authors)
        self.assertEqual(review['new'][0]['candidates'][0]['authorId'], 'old')
        apply_decisions(review, authors, {'jenni ogden': 'old'}, str.lower)
        self.assertEqual(authors[0]['authorId'], 'old')
        self.assertEqual(authors[0]['displayName'], 'Jenni Ogden')
        self.assertEqual(authors[0]['aliases'], ['Jenni Olsen'])
        self.assertEqual(authors[0]['custom'], 'preserved')

    def test_shared_book_finds_dissimilar_previous_credit(self):
        review = review_for(['Completely Different'], [author('Old Name')],
                            [dict(bookId='book', authorId='old')])
        self.assertEqual(review['new'][0]['candidates'][0]['reason'],
                         'previously credited on this book')

    def test_split_creates_people_without_reassigning_combined_id(self):
        authors = [author('Roger Tory & Virginia Marie Peterson')]
        before = copy.deepcopy(authors)
        review = review_for(['Virginia Marie Peterson'], authors)
        answers = iter(['NEW', 'APPLY AUTHORS'])
        with contextlib.redirect_stdout(io.StringIO()):
            decisions = collect_decisions(review, authors, lambda _: next(answers))
        apply_decisions(review, authors, decisions, str.lower)
        self.assertEqual(authors, before)
        self.assertIsNone(decisions['virginia marie peterson'])

    def test_cancel_after_selection_does_not_mutate(self):
        authors = [author('Jenni Olsen')]
        before = copy.deepcopy(authors)
        answers = iter(['1', ''])
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(ValueError):
            collect_decisions(review_for(['Jenni Ogden'], authors), authors,
                              lambda _: next(answers))
        self.assertEqual(authors, before)

    def test_uncredited_authors_retained(self):
        authors = [author('Missing Author')]
        review = review_for([], authors)
        self.assertEqual(review['retained'], authors)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(collect_decisions(review, authors,
                             lambda _: self.fail('No review should be needed')), {})

    def test_stale_review_cannot_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'registry.json'
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                save_author_outputs({path: []}, {path: b'original'},
                                    Path(directory) / 'backups', {})
            self.assertEqual(path.read_bytes(), b'changed')

    def test_backup_and_failure_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / 'one.json', root / 'two.json']
            for p in paths:
                p.write_bytes(b'original')
            import os
            replace = os.replace
            def fail_second(src, dst):
                if dst == paths[1]:
                    raise OSError('Simulated write failure')
                replace(src, dst)
            with patch('reconcile_library_authors.os.replace', side_effect=fail_second):
                with self.assertRaises(OSError):
                    save_author_outputs({p: [] for p in paths},
                                        {p: b'original' for p in paths}, root / 'backups', {})
            self.assertEqual([p.read_bytes() for p in paths], [b'original', b'original'])
            self.assertFalse(list(root.glob('*.tmp')))
            self.assertEqual(len(list((root / 'backups').glob('*/one.json'))), 1)

    def test_builder_review_write_and_repeat(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory)
            for attr, filename in [('BOOKS_PATH', 'books.json'), ('ARCHIVE_PATH', 'archive.json'),
                                   ('REGISTRY_PATH', 'registry.json'),
                                   ('AUTHORS_OUTPUT_PATH', 'authors.json'),
                                   ('BOOK_AUTHORS_OUTPUT_PATH', 'credits.json')]:
                stack.enter_context(patch.object(builder, attr, root / filename))
            old_id = 'author-11111111-1111-4111-8111-111111111111'
            retired_id = 'author-22222222-2222-4222-8222-222222222222'
            old = author('Jenni Olsen', old_id)
            retired = author('Missing Author', retired_id)
            builder.REGISTRY_PATH.write_text(json.dumps({'version': 1, 'authors': [old, retired]}))
            books = [dict(bookId='book-33333333-3333-4333-8333-333333333333', title='Trouble in Mind',
                          firstName='Jenni', lastName='Ogden', author='Jenni Ogden'),
                     dict(bookId='book-44444444-4444-4444-8444-444444444444', title='Half a Soul',
                          firstName='Olivia', lastName='Atwater', author='Olivia Atwater')]
            builder.BOOKS_PATH.write_text(json.dumps(books))
            builder.ARCHIVE_PATH.write_text('[]')
            stack.enter_context(patch('sys.argv', ['authors', '--write', '--reconcile']))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            with patch('builtins.input', side_effect=['1', 'NEW', 'APPLY AUTHORS']):
                builder.main()
            records = json.loads(builder.REGISTRY_PATH.read_text())['authors']
            self.assertEqual(len(records), 3)
            self.assertEqual(next(a for a in records if a['authorId'] == old_id)['displayName'], 'Jenni Ogden')
            self.assertIn(retired, records)
            credits = json.loads(builder.BOOK_AUTHORS_OUTPUT_PATH.read_text())
            self.assertEqual(next(c for c in credits if c['bookId'] == books[0]['bookId'])['authorId'], old_id)
            snapshot = builder.REGISTRY_PATH.read_bytes()
            with patch('builtins.input', side_effect=AssertionError('Repeat review not expected')):
                builder.main()
            self.assertEqual(builder.REGISTRY_PATH.read_bytes(), snapshot)


if __name__ == '__main__':
    unittest.main()
