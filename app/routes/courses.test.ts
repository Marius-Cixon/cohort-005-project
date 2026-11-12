import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";

let testDb: TestDb;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("~/lib/country.server", () => ({
  resolveCountry: vi.fn(async () => "US"),
}));

import { loader } from "./courses";

async function search(term: string) {
  const url = new URL("http://localhost:3000/courses");
  url.searchParams.set("q", term);
  const request = new Request(url);
  const result = await loader({ request, url } as Parameters<typeof loader>[0]);
  return result.courses.map((course) => course.title);
}

describe("courses loader search", () => {
  beforeEach(() => {
    testDb = createTestDb();
    const { instructor, category } = seedBaseData(testDb);
    testDb
      .insert(schema.courses)
      .values({
        title: "Secret Draft",
        slug: "secret-draft",
        description: "Not published yet",
        salesCopy: markdown("Draft"),
        instructorId: instructor.id,
        categoryId: category.id,
        status: schema.CourseStatus.Draft,
      })
      .run();
  });

  it("finds published courses by title", async () => {
    expect(await search("Test")).toEqual(["Test Course"]);
  });

  it("treats quotes in the term as text", async () => {
    expect(await search("O'Reilly")).toEqual([]);
  });

  it("keeps the published filter against an injected condition", async () => {
    expect(await search("' OR 1=1 --")).toEqual([]);
  });
});
