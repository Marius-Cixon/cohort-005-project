import { formatPrice } from "~/lib/utils";

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_COMPLETION_LIMIT = 0.5;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;

export type RefundPurchaseFacts = {
  purchasedAt: string;
  amountPaid: number;
  hasRequestedRefund: boolean;
  isClaimedTeamSeat: boolean;
};

export type RefundProgressFacts = {
  lessonCount: number;
  completedLessonCount: number;
  secondsWatched: number;
};

export type RefundIneligibleReason =
  | "refund-requested"
  | "claimed-team-seat"
  | "outside-refund-window"
  | "too-much-completed"
  | "too-much-watched";

export type RefundEligibility =
  | { eligible: true; refundAmount: number; lastDayOfRefundWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// The Refund Window is counted in whole days, not hours — someone who buys at
// 23:00 still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function getRefundEligibility(
  purchase: RefundPurchaseFacts,
  progress: RefundProgressFacts,
  today: Date
): RefundEligibility {
  if (purchase.hasRequestedRefund) {
    return { eligible: false, reason: "refund-requested" };
  }

  // A seat that came out of a team licence, and has been claimed, belongs to
  // the team — the learner cannot hand it back on their own.
  if (purchase.isClaimedTeamSeat) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const lastDay = lastDayOfRefundWindow(purchase.purchasedAt);

  if (calendarDay(today) > lastDay) {
    return { eligible: false, reason: "outside-refund-window" };
  }

  if (
    progress.lessonCount > 0 &&
    progress.completedLessonCount / progress.lessonCount >=
      REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "too-much-completed" };
  }

  if (progress.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "too-much-watched" };
  }

  return {
    eligible: true,
    refundAmount: purchase.amountPaid,
    lastDayOfRefundWindow: lastDay,
  };
}

/**
 * The confirmation the learner gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
export function buildRefundRequestedEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundAmount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your Refund request for "${input.courseTitle}".`,
      `The Refund is for ${formatPrice(input.refundAmount)}, the amount you paid.`,
      "",
      "Our team reviews every Refund by hand. You do not need to do anything else — we will email you again when it is done.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
