import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listSavedBookmarks,
  listSavedNotes,
  MAX_NOTE_LENGTH,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 6, 13, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("bookmarking a Lesson", () => {
  it("adds a Bookmark, and removes it when toggled again", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], LATER)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never gives a Student two Bookmarks on the same Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
    expect(listSavedBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates the Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  Revisit this  ", NOW);

    expect(result).toMatchObject({ ok: true, note: { body: "Revisit this" } });
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Revisit this",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First draft", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second draft", LATER);

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second draft",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(listSavedNotes(db, base.user.id)).toHaveLength(1);
  });

  it("refuses a Note over the cap and accepts one exactly at it", () => {
    const tooLong = saveNote(db, base.user.id, lessonIds[0], "a".repeat(MAX_NOTE_LENGTH + 1), NOW);
    expect(tooLong.ok).toBe(false);
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();

    const atCap = saveNote(db, base.user.id, lessonIds[0], "a".repeat(MAX_NOTE_LENGTH), NOW);
    expect(atCap.ok).toBe(true);
    expect(MAX_NOTE_LENGTH).toBe(2000);
  });

  it("clears the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "Something", NOW);
    saveNote(db, base.user.id, lessonIds[0], "   ", LATER);

    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("show only the Student's own rows, newest first, with Lesson and Course", () => {
    const other = addStudent("Other");
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], LATER);
    toggleBookmark(db, other.id, lessonIds[0], NOW);
    saveNote(db, base.user.id, lessonIds[1], "Older", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Newer", LATER);
    saveNote(db, other.id, lessonIds[0], "Not mine", LATER);

    expect(listSavedBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({ lessonTitle: "Lesson 2", courseTitle: "Test Course", courseSlug: "test-course" }),
      expect.objectContaining({ lessonTitle: "Lesson 1", courseTitle: "Test Course" }),
    ]);
    expect(listSavedNotes(db, base.user.id).map((note) => note.body)).toEqual([
      "Newer",
      "Older",
    ]);
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const notifications = fakeNotifications();
    const admin = db
      .insert(schema.users)
      .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: new Date(2026, 9, 3).toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    saveNote(db, base.user.id, lessonIds[0], "Keep me", NOW);

    const raised = await raiseRefundRequest(db, purchase.id, base.user.id, "Not for me.", NOW, notifications);
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(db, raised.refundRequestId, admin.id, null, NOW, notifications);
    expect(approved.ok).toBe(true);

    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({ body: "Keep me" });
  });
});
