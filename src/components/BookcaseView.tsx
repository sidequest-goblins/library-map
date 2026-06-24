import ShelfRow, { type Spine, type SpineClickContext } from "./ShelfRow";

export type BookcaseShelf = {
  id: string;
  label: string;
  spines: Spine[];
};

export default function BookcaseView({
  title = "Bookcase",
  shelves,
  onBookSelect,
}: {
  title?: string;
  shelves: BookcaseShelf[];
  onBookSelect?: (bookId: string, context: SpineClickContext) => void;
}) {
  return (
    <section className="bookcaseView">
      <div className="bookcaseViewHeader">
        <p className="eyebrow">Map view</p>
        <h2>{title}</h2>
      </div>

      <div className="bookcaseShelves">
        {shelves.map((s) => (
          <ShelfRow
            key={s.id}
            shelfId={s.id}
            shelfLabel={s.label}
            spines={s.spines}
            onSpineClick={(sp, context) => onBookSelect?.(sp.id, context)}
          />
        ))}
      </div>
    </section>
  );
}