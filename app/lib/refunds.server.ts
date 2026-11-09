import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import {
  getRefundEligibility,
  type RefundProgressFacts,
  type RefundPurchaseFacts,
} from "~/lib/refunds";

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasRequestedRefund(purchaseId: number) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .get();

  return row !== undefined;
}

function isClaimedTeamSeat(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();

  return row !== undefined;
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getProgress(userId: number, courseId: number): RefundProgressFacts {
  const lessonIds = getLessonIdsForCourse(courseId);

  if (lessonIds.length === 0) {
    return { lessonCount: 0, completedLessonCount: 0, secondsWatched: 0 };
  }

  const completed = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return {
    lessonCount: lessonIds.length,
    completedLessonCount: completed?.count ?? 0,
    secondsWatched: furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    ),
  };
}

/**
 * The learner's latest Purchase of a course and its Refund Eligibility, or
 * null if they have not bought the course.
 */
export function getRefundEligibilityForCourse(
  userId: number,
  courseId: number,
  today: Date = new Date()
) {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) return null;

  const purchaseFacts: RefundPurchaseFacts = {
    purchasedAt: purchase.createdAt,
    amountPaid: purchase.amountPaid,
    hasRequestedRefund: hasRequestedRefund(purchase.id),
    isClaimedTeamSeat: isClaimedTeamSeat(purchase.id),
  };

  return {
    purchase,
    eligibility: getRefundEligibility(
      purchaseFacts,
      getProgress(userId, courseId),
      today
    ),
  };
}
