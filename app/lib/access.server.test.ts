import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { setCurrentUserId } from "~/lib/session";
import {
  assessCourseAccess,
  decide,
  requireAccess,
  type Rule,
  type Viewer,
} from "./access.server";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let people: {
  student: number;
  enrolledStudent: number;
  pppBlockedStudent: number;
  otherInstructor: number;
  owningInstructor: number;
  platformAdmin: number;
};
let ownModule: typeof schema.modules.$inferSelect;
let ownLesson: typeof schema.lessons.$inferSelect;
let foreignModule: typeof schema.modules.$inferSelect;
let foreignLesson: typeof schema.lessons.$inferSelect;

function addUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get().id;
}

function addModuleWithLesson(courseId: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  const lesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 1 })
    .returning()
    .get();
  return { module, lesson };
}

function enrol(userId: number, courseId: number, country: string | null) {
  db.insert(schema.purchases)
    .values({ userId, courseId, amountPaid: 5000, country })
    .run();
  db.insert(schema.enrollments).values({ userId, courseId }).run();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  db.update(schema.courses)
    .set({ price: 10000, pppEnabled: true })
    .run();

  people = {
    student: base.user.id,
    enrolledStudent: addUser("enrolled", schema.UserRole.Student),
    pppBlockedStudent: addUser("ppp", schema.UserRole.Student),
    otherInstructor: addUser("other", schema.UserRole.Instructor),
    owningInstructor: base.instructor.id,
    platformAdmin: addUser("admin", schema.UserRole.Admin),
  };
  enrol(people.enrolledStudent, base.course.id, "US");
  enrol(people.pppBlockedStudent, base.course.id, "IN");

  ({ module: ownModule, lesson: ownLesson } = addModuleWithLesson(
    base.course.id
  ));
  const foreignCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: markdown("Other"),
      instructorId: people.otherInstructor,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  ({ module: foreignModule, lesson: foreignLesson } = addModuleWithLesson(
    foreignCourse.id
  ));
});

function as(person: keyof typeof people, country: string | null = "US"): Viewer {
  return { userId: people[person], country };
}

const SIGNED_OUT: Viewer = { userId: null, country: null };

function outcome(viewer: Viewer, rule: Rule) {
  const verdict = decide(db, viewer, rule);
  if (verdict.ok) return "ok";
  if (verdict.reason === "forbidden") return "forbidden";
  if (verdict.reason === "not-found") return `not-found ${verdict.what}`;
  return verdict.reason;
}

describe("decide", () => {
  it("treats a Viewer whose user no longer exists as signed out", () => {
    expect(outcome({ userId: 9999, country: null }, { kind: "signed-in" })).toBe(
      "signed-out"
    );
  });

  describe.each([
    ["signed-in", { kind: "signed-in" }],
    ["platform-admin", { kind: "platform-admin" }],
    ["instructor", { kind: "instructor" }],
    ["instructor-only", { kind: "instructor-only" }],
  ] as const)("the %s Rule", (_, rule) => {
    const expected: Record<string, Record<string, string>> = {
      "signed-in": { student: "ok", otherInstructor: "ok", platformAdmin: "ok" },
      "platform-admin": {
        student: "forbidden",
        otherInstructor: "forbidden",
        platformAdmin: "ok",
      },
      instructor: {
        student: "forbidden",
        otherInstructor: "ok",
        platformAdmin: "ok",
      },
      "instructor-only": {
        student: "forbidden",
        otherInstructor: "ok",
        platformAdmin: "forbidden",
      },
    };

    it("denies a signed-out Viewer", () => {
      expect(outcome(SIGNED_OUT, rule)).toBe("signed-out");
    });

    it.each(["student", "otherInstructor", "platformAdmin"] as const)(
      "decides for %s",
      (person) => {
        expect(outcome(as(person), rule)).toBe(expected[rule.kind][person]);
      }
    );
  });

  describe("the staff Rule", () => {
    const staff = (extra: { moduleId?: number; lessonId?: number } = {}) =>
      ({ kind: "staff", courseId: base.course.id, ...extra }) as const;

    it.each([
      ["student", "forbidden"],
      ["enrolledStudent", "forbidden"],
      ["otherInstructor", "forbidden"],
      ["owningInstructor", "ok"],
      ["platformAdmin", "ok"],
    ] as const)("decides for %s: %s", (person, expected) => {
      expect(outcome(as(person), staff())).toBe(expected);
    });

    it("denies a signed-out Viewer", () => {
      expect(outcome(SIGNED_OUT, staff())).toBe("signed-out");
    });

    it("hands back the course and the rows it checked", () => {
      const verdict = decide(
        db,
        as("owningInstructor"),
        staff({ moduleId: ownModule.id, lessonId: ownLesson.id })
      );
      expect(verdict).toMatchObject({
        ok: true,
        user: { id: people.owningInstructor },
        course: { id: base.course.id },
        module: { id: ownModule.id },
        lesson: { id: ownLesson.id },
        isPlatformAdmin: false,
      });
    });

    it("returns not-found for a missing course", () => {
      expect(
        outcome(as("platformAdmin"), { kind: "staff", courseId: 9999 })
      ).toBe("not-found course");
    });

    it("returns not-found for a lesson or module in another course", () => {
      expect(
        outcome(as("owningInstructor"), staff({ lessonId: foreignLesson.id }))
      ).toBe("not-found lesson");
      expect(
        outcome(as("owningInstructor"), staff({ moduleId: foreignModule.id }))
      ).toBe("not-found module");
    });

    it("returns the same not-found for a lesson that doesn't exist", () => {
      expect(outcome(as("owningInstructor"), staff({ lessonId: 9999 }))).toBe(
        "not-found lesson"
      );
    });

    it("tells someone who isn't Staff nothing about which lessons exist", () => {
      expect(
        outcome(as("otherInstructor"), staff({ lessonId: foreignLesson.id }))
      ).toBe("forbidden");
      expect(outcome(as("student"), staff({ lessonId: 9999 }))).toBe(
        "forbidden"
      );
    });
  });

  describe("the content Rule", () => {
    const content = (lessonId?: number) =>
      ({ kind: "content", courseId: base.course.id, lessonId }) as const;

    it.each([
      ["student", "forbidden"],
      ["enrolledStudent", "ok"],
      ["otherInstructor", "forbidden"],
      ["owningInstructor", "ok"],
      ["platformAdmin", "ok"],
    ] as const)("decides for %s: %s", (person, expected) => {
      expect(outcome(as(person), content())).toBe(expected);
    });

    it("denies a Student who bought at a discount and is in another country", () => {
      const verdict = decide(db, as("pppBlockedStudent", "US"), content());
      expect(verdict).toMatchObject({
        ok: false,
        reason: "forbidden",
        access: {
          enrolled: true,
          pppBlocked: true,
          pppBlockedCountry: "US",
          pppPurchaseCountry: "IN",
        },
      });
    });

    it("lets that Student in from the country they bought in", () => {
      expect(outcome(as("pppBlockedStudent", "IN"), content())).toBe("ok");
    });

    it("carries the Viewer's standing on a denial, for the paywall", () => {
      expect(decide(db, as("student"), content())).toMatchObject({
        ok: false,
        access: { enrolled: false, canViewContent: false },
      });
      expect(decide(db, SIGNED_OUT, content())).toMatchObject({
        ok: false,
        reason: "signed-out",
        access: { canViewContent: false },
      });
    });

    it("checks the lesson belongs to the course before the Viewer's standing", () => {
      expect(outcome(as("student"), content(foreignLesson.id))).toBe(
        "not-found lesson"
      );
      expect(outcome(SIGNED_OUT, content(9999))).toBe("not-found lesson");
    });

    it("hands back the lesson it checked", () => {
      expect(
        decide(db, as("enrolledStudent"), content(ownLesson.id))
      ).toMatchObject({ ok: true, lesson: { id: ownLesson.id } });
    });
  });
});

describe("assessCourseAccess", () => {
  it("never fails, whoever is asking", () => {
    expect(
      assessCourseAccess(db, SIGNED_OUT, base.course.id).canViewContent
    ).toBe(false);
    expect(assessCourseAccess(db, as("student"), 9999).canViewContent).toBe(
      false
    );
  });

  it("exempts Staff from PPP", () => {
    expect(
      assessCourseAccess(db, as("owningInstructor", "NG"), base.course.id)
    ).toMatchObject({ isStaff: true, pppBlocked: false, canViewContent: true });
  });
});

describe("requireAccess", () => {
  async function requestAs(userId: number) {
    const setCookie = await setCurrentUserId(
      new Request("http://localhost/"),
      userId
    );
    return new Request("http://localhost/", {
      headers: { Cookie: setCookie.split(";")[0] },
    });
  }

  async function thrownStatus(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return (error as { init: { status: number } }).init.status;
    }
    throw new Error("expected requireAccess to throw");
  }

  it("throws 401 for a signed-out request", async () => {
    expect(
      await thrownStatus(
        requireAccess(new Request("http://localhost/"), { kind: "signed-in" }, db)
      )
    ).toBe(401);
  });

  it("throws 403 when the Rule is broken", async () => {
    expect(
      await thrownStatus(
        requireAccess(
          await requestAs(people.student),
          { kind: "platform-admin" },
          db
        )
      )
    ).toBe(403);
  });

  it("throws 404 for a lesson in another course", async () => {
    expect(
      await thrownStatus(
        requireAccess(
          await requestAs(people.owningInstructor),
          { kind: "staff", courseId: base.course.id, lessonId: foreignLesson.id },
          db
        )
      )
    ).toBe(404);
  });

  it("returns the rows the Rule checked", async () => {
    const { course, lesson } = await requireAccess(
      await requestAs(people.owningInstructor),
      { kind: "staff", courseId: base.course.id, lessonId: ownLesson.id },
      db
    );
    expect(course.id).toBe(base.course.id);
    expect(lesson.id).toBe(ownLesson.id);
  });
});
