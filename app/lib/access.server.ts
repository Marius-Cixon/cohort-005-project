import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { db as appDb } from "~/db";
import {
  UserRole,
  users,
  courses,
  modules,
  lessons,
  purchases,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";
import { isEnrolled } from "~/lib/enrollments.server";

// ─── Access ───
// Who may do what, decided in one place. `decide` is the core: it takes an
// already-resolved Viewer and returns a Verdict, never throwing, so tests need
// no Request. Routes call `requireAccess`, which turns a denial into the
// 401/403/404 response. Every access message lives here.

export type Db = BetterSQLite3Database<typeof schema>;

type User = typeof users.$inferSelect;
type Course = typeof courses.$inferSelect;
type Module = typeof modules.$inferSelect;
type Lesson = typeof lessons.$inferSelect;

/** Who is asking, as read from their request. */
export type Viewer = { userId: number | null; country: string | null };

/**
 * What the Viewer must be.
 * - `staff`: the course's owning Instructor, or a Platform Admin. A given
 *   `moduleId` and `lessonId` must each belong to the course (independently:
 *   the lesson need not be in that module).
 * - `content`: may read the course's content. Staff always can; a Student
 *   needs an Enrollment that isn't PPP-blocked.
 */
export type Rule =
  | { kind: "signed-in" }
  | { kind: "platform-admin" }
  | { kind: "instructor" }
  | { kind: "staff"; courseId: number; moduleId?: number; lessonId?: number }
  | { kind: "content"; courseId: number; lessonId?: number };

export type Denial =
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "forbidden"; rule: Rule["kind"] }
  | { ok: false; reason: "not-found"; what: "course" | "module" | "lesson" };

/** A Viewer's standing on one course, for pages that show a paywall. */
export type CourseAccess = {
  isPlatformAdmin: boolean;
  /** The Instructor who owns this course. */
  isOwningInstructor: boolean;
  /** Owning Instructor or Platform Admin: the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  canViewContent: boolean;
};

const NO_ACCESS: CourseAccess = {
  isPlatformAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

type WithModule<R> = R extends { moduleId: number } ? { module: Module } : {};
type WithLesson<R> = R extends { lessonId: number } ? { lesson: Lesson } : {};

/** What a passed Rule hands back: the rows it checked. */
export type Granted<R extends Rule> = R extends { kind: "staff" }
  ? { user: User; course: Course; isPlatformAdmin: boolean } & WithModule<R> &
      WithLesson<R>
  : R extends { kind: "content" }
    ? { user: User; course: Course; access: CourseAccess } & WithLesson<R>
    : R extends { kind: "instructor" }
      ? { user: User; isPlatformAdmin: boolean }
      : { user: User };

/**
 * The outcome of `decide`. A denied `content` Rule still carries the Viewer's
 * CourseAccess, so a lesson page can render its paywall from it.
 */
export type Verdict<R extends Rule> =
  | ({ ok: true } & Granted<R>)
  | (R extends { kind: "content" } ? Denial & { access: CourseAccess } : Denial);

/**
 * Decides whether the Viewer passes the Rule. Never throws.
 *
 * Checks run in a fixed order: signed in → role → course exists → Staff →
 * module/lesson in course. A Viewer who isn't Staff learns nothing about which
 * module or lesson ids exist; a lesson in another course is the same
 * `not-found` as a missing one.
 *
 * `content` differs: the course and lesson are checked before the Viewer's
 * standing, because a paywall preview must still 404 on a lesson that isn't
 * in the course. Course curricula are public, so nothing leaks.
 */
export function decide<R extends Rule>(
  db: Db,
  viewer: Viewer,
  rule: R
): Verdict<R> {
  return decideAny(db, viewer, rule) as Verdict<R>;
}

function decideAny(db: Db, viewer: Viewer, rule: Rule) {
  if (rule.kind === "content") return decideContent(db, viewer, rule);

  const user = findUser(db, viewer.userId);
  if (!user) return signedOut();

  const isPlatformAdmin = user.role === UserRole.Admin;

  switch (rule.kind) {
    case "signed-in":
      return { ok: true as const, user };

    case "platform-admin":
      return isPlatformAdmin ? { ok: true as const, user } : forbidden(rule);

    case "instructor":
      return isPlatformAdmin || user.role === UserRole.Instructor
        ? { ok: true as const, user, isPlatformAdmin }
        : forbidden(rule);

    case "staff": {
      if (!isPlatformAdmin && user.role !== UserRole.Instructor) {
        return forbidden(rule);
      }
      const course = findCourse(db, rule.courseId);
      if (!course) return notFound("course");
      if (!isPlatformAdmin && course.instructorId !== user.id) {
        return forbidden(rule);
      }

      const granted: Record<string, unknown> = {
        ok: true,
        user,
        course,
        isPlatformAdmin,
      };
      if (rule.moduleId !== undefined) {
        const module = findModuleInCourse(db, rule.moduleId, course.id);
        if (!module) return notFound("module");
        granted.module = module;
      }
      if (rule.lessonId !== undefined) {
        const lesson = findLessonInCourse(db, rule.lessonId, course.id);
        if (!lesson) return notFound("lesson");
        granted.lesson = lesson;
      }
      return granted;
    }
  }
}

function decideContent(
  db: Db,
  viewer: Viewer,
  rule: Extract<Rule, { kind: "content" }>
) {
  const course = findCourse(db, rule.courseId);
  if (!course) return { ...notFound("course"), access: NO_ACCESS };

  let lesson: Lesson | undefined;
  if (rule.lessonId !== undefined) {
    lesson = findLessonInCourse(db, rule.lessonId, course.id);
    if (!lesson) return { ...notFound("lesson"), access: NO_ACCESS };
  }

  const user = findUser(db, viewer.userId);
  if (!user) return { ...signedOut(), access: NO_ACCESS };

  const access = standingOn(db, user, course, viewer.country);
  if (!access.canViewContent) return { ...forbidden(rule), access };

  return lesson
    ? { ok: true as const, user, course, access, lesson }
    : { ok: true as const, user, course, access };
}

/**
 * The Viewer's standing on the course. Never fails: a signed-out Viewer or a
 * missing course gets no access at all.
 */
export function assessCourseAccess(
  db: Db,
  viewer: Viewer,
  courseId: number
): CourseAccess {
  const user = findUser(db, viewer.userId);
  if (!user) return NO_ACCESS;
  const course = findCourse(db, courseId);
  if (!course) {
    const isPlatformAdmin = user.role === UserRole.Admin;
    return { ...NO_ACCESS, isPlatformAdmin, isStaff: isPlatformAdmin };
  }
  return standingOn(db, user, course, viewer.country);
}

function standingOn(
  db: Db,
  user: User,
  course: Course,
  country: string | null
): CourseAccess {
  const isPlatformAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course.instructorId === user.id;
  const isStaff = isPlatformAdmin || isOwningInstructor;
  const enrolled = isEnrolled(db, user.id, course.id);

  // PPP only restricts Students who bought at a discount; Staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };
  if (enrolled && !isStaff) {
    const purchase = db
      .select({ country: purchases.country })
      .from(purchases)
      .where(
        and(eq(purchases.userId, user.id), eq(purchases.courseId, course.id))
      )
      .get();
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      country
    );
  }

  return {
    isPlatformAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}

function signedOut(): Denial {
  return { ok: false, reason: "signed-out" };
}

function forbidden(rule: Rule): Denial {
  return { ok: false, reason: "forbidden", rule: rule.kind };
}

function notFound(what: "course" | "module" | "lesson"): Denial {
  return { ok: false, reason: "not-found", what };
}

function findUser(db: Db, userId: number | null) {
  if (userId === null) return undefined;
  return db.select().from(users).where(eq(users.id, userId)).get();
}

function findCourse(db: Db, courseId: number) {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

function findModuleInCourse(db: Db, moduleId: number, courseId: number) {
  return db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)))
    .get();
}

function findLessonInCourse(db: Db, lessonId: number, courseId: number) {
  const row = db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(and(eq(lessons.id, lessonId), eq(modules.courseId, courseId)))
    .get();
  return row?.lesson;
}

// ─── Route seam ───

/** Reads the Viewer from the session cookie and the request's country. */
export async function viewerFrom(request: Request): Promise<Viewer> {
  return {
    userId: await getCurrentUserId(request),
    country: await resolveCountry(request),
  };
}

const FORBIDDEN_MESSAGES: Record<Rule["kind"], string> = {
  "signed-in": "Select a user from the DevUI panel.",
  "platform-admin": "Only Platform Admins can do that.",
  instructor: "Only instructors can access this page.",
  staff: "Only this course's instructor can do that.",
  content: "You must be enrolled in this course.",
};

const NOT_FOUND_MESSAGES = {
  course: "Course not found.",
  module: "Module not found.",
  lesson: "Lesson not found.",
};

/** The 401/403/404 response for a denial. */
export function denialResponse(denial: Denial) {
  switch (denial.reason) {
    case "signed-out":
      return data("Select a user from the DevUI panel.", { status: 401 });
    case "forbidden":
      return data(FORBIDDEN_MESSAGES[denial.rule], { status: 403 });
    case "not-found":
      return data(NOT_FOUND_MESSAGES[denial.what], { status: 404 });
  }
}

/**
 * Throws the 401/403/404 response unless the request's Viewer passes the
 * Rule; otherwise returns the rows the Rule checked. Use in loaders and in
 * actions alike: a loader's check doesn't protect its action.
 */
export async function requireAccess<R extends Rule>(
  request: Request,
  rule: R,
  db: Db = appDb
): Promise<Granted<R>> {
  const verdict = decide(db, await viewerFrom(request), rule);
  if (!verdict.ok) throw denialResponse(verdict);
  return verdict as Granted<R>;
}

// ─── Deprecated shims ───
// The pre-#5 interface, kept until every route calls `requireAccess`.

/** @deprecated Use `assessCourseAccess` or `decide` with a `content` Rule. */
export type Access = CourseAccess & {
  userId: number | null;
  user: User | undefined;
  isAdmin: boolean;
};

/** @deprecated Use `assessCourseAccess` or `decide` with a `content` Rule. */
export async function getAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  const viewer = await viewerFrom(request);
  const user = findUser(appDb, viewer.userId);
  const access = assessCourseAccess(appDb, viewer, courseId);
  return {
    ...access,
    userId: user ? user.id : null,
    user,
    isAdmin: access.isPlatformAdmin,
  };
}

/** @deprecated Use `requireAccess(request, { kind: "signed-in" })`. */
export async function requireUserId(request: Request): Promise<number> {
  const { user } = await requireAccess(request, { kind: "signed-in" });
  return user.id;
}

/** @deprecated Use `requireAccess(request, { kind: "content", courseId })`. */
export async function requireContentAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  const { user, access } = await requireAccess(request, {
    kind: "content",
    courseId,
  });
  return { ...access, userId: user.id, user, isAdmin: access.isPlatformAdmin };
}

/** @deprecated Use `requireAccess(request, { kind: "staff", courseId })`. */
export async function requireStaff(
  request: Request,
  courseId: number
): Promise<Access> {
  await requireAccess(request, { kind: "staff", courseId });
  return getAccess(request, courseId);
}

/** @deprecated Use `requireAccess(request, { kind: "instructor" })`. */
export async function requireInstructorOrAdmin(request: Request) {
  const { user, isPlatformAdmin } = await requireAccess(request, {
    kind: "instructor",
  });
  return { userId: user.id, user, isAdmin: isPlatformAdmin };
}
