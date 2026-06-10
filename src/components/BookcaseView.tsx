import ShelfRow, { type Spine } from "./ShelfRow";

export type BookcaseShelf = {
  id: string;
  label: string;
  spines: Spine[];
};

export default function BookcaseView({
  title = "Bookcase",
  shelves,
}: {
  title?: string;
  shelves: BookcaseShelf[];
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
            shelfLabel={s.label}
            spines={s.spines}
            onSpineClick={(sp) => alert(`${s.label}: ${sp.title}`)}
          />
        ))}
      </div>
    </section>
  );
}