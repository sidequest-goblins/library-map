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
    <div
      style={{
        padding: 16,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ margin: "0 0 12px 0" }}>{title}</h2>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {shelves.map((s) => (
          <ShelfRow
            key={s.id}
            shelfLabel={s.label}
            spines={s.spines}
            onSpineClick={(sp) => alert(`${s.label}: ${sp.title}`)}
          />
        ))}
      </div>
    </div>
  );
}