import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { LessonNote, type LessonNoteData } from "./lesson-note";

function render(note: LessonNoteData) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <LessonNote note={note} /> },
  ]);
  return renderToString(<Stub initialEntries={["/"]} />);
}

function attributesOf(html: string, tag: string) {
  return html.match(new RegExp(`<${tag}[^>]*>`))?.[0] ?? "";
}

describe("LessonNote", () => {
  it("gives an empty note room to write instead of a two-line sliver", () => {
    const textarea = attributesOf(render(null), "textarea");

    expect(textarea).toContain('name="body"');
    expect(textarea).toMatch(/\bmin-h-36\b/);
  });

  it("does not stack its own top padding on the card's", () => {
    const content = attributesOf(render(null), 'div data-slot="card-content"');

    expect(content).not.toMatch(/\bpt-\d/);
  });

  it("shows the saved note and when it was last edited", () => {
    const html = render({
      body: "Types are erased at compile time",
      updatedAt: new Date().toISOString(),
    });

    expect(html).toContain("Types are erased at compile time");
    expect(html).toContain("Last edited");
  });

  it("does not claim an edit time before anything is saved", () => {
    expect(render(null)).not.toContain("Last edited");
  });
});
