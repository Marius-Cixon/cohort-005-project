import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import {
  getInstructorAnalytics,
  type AnalyticsParams,
} from "./instructor-analytics.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let otherInstructor: typeof schema.users.$inferSelect;
let otherCourse: typeof schema.courses.$inferSelect;

const params = (overrides: Partial<AnalyticsParams> = {}): AnalyticsParams => ({
  range: "30d",
  requestedInstructorId: null,
  requestedCourseId: null,
  ...overrides,
});

function purchase(courseId: number, amountPaid: number, daysAgo: number) {
  db.insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId,
      amountPaid,
      createdAt: daysBefore(daysAgo),
    })
    .run();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  otherInstructor = db
    .insert(schema.users)
    .values({
      name: "Other Instructor",
      email: "other@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();

  otherCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Someone else's course",
      salesCopy: markdown("## Other"),
      instructorId: otherInstructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
});

describe("getInstructorAnalytics", () => {
  describe("viewer", () => {
    it("pins an instructor to their own figures, whatever they ask for", () => {
      purchase(base.course.id, 1000, 1);
      purchase(otherCourse.id, 5000, 1);

      const result = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: false },
        params({ requestedInstructorId: otherInstructor.id }),
        NOW
      );

      expect(result.instructorId).toBe(base.instructor.id);
      expect(result.summary.grossCents).toBe(1000);
      expect(result.instructors).toEqual([]);
    });

    it("gives an admin with no instructor picked the platform-wide figures", () => {
      purchase(base.course.id, 1000, 1);
      purchase(otherCourse.id, 5000, 1);

      const result = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: true },
        params(),
        NOW
      );

      expect(result.instructorId).toBeNull();
      expect(result.summary.grossCents).toBe(6000);
      expect(result.instructors.map((i) => i.id).sort()).toEqual(
        [base.instructor.id, otherInstructor.id].sort()
      );
    });

    it("drops a requested course the instructor doesn't own", () => {
      const result = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: false },
        params({ requestedCourseId: otherCourse.id }),
        NOW
      );

      expect(result.selectedCourseId).toBeNull();
      expect(result.funnel).toBeNull();
    });
  });

  describe("now", () => {
    it("counts a purchase on the range's first day and drops the day before", () => {
      purchase(base.course.id, 1000, 30);
      purchase(base.course.id, 2000, 31);

      const result = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: false },
        params(),
        NOW
      );

      expect(result.summary.grossCents).toBe(1000);
    });

    it("ends the revenue chart on today", () => {
      const result = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: false },
        params({ range: "7d" }),
        NOW
      );

      expect(result.series.points.at(-1)?.bucket).toBe(
        NOW.toISOString().slice(0, 10)
      );
    });
  });

  describe("refund exposure", () => {
    it("keeps a purchase exposed through its fourteenth day, then releases it", () => {
      purchase(base.course.id, 1000, 14); // last day is today
      purchase(base.course.id, 2000, 15); // window closed yesterday
      purchase(base.course.id, 4000, 3);

      const { refundExposure } = getInstructorAnalytics(
        db,
        { userId: base.instructor.id, isAdmin: false },
        params(),
        NOW
      );

      expect(refundExposure.grossCents).toBe(5000);
      expect(refundExposure.purchaseCount).toBe(2);
      expect(refundExposure.closingTodayCount).toBe(1);
      expect(refundExposure.courses).toEqual([
        expect.objectContaining({
          courseId: base.course.id,
          grossCents: 5000,
          daysLeft: 0,
        }),
      ]);
    });
  });
});
