import { describe, it, expect } from "vitest";
import { buildRefundRequestedEmail, getRefundEligibility } from "./refunds";

// Local time, like the learner's calendar: 1 November 2026, 23:00.
const PURCHASED_AT = new Date(2026, 10, 1, 23, 0).toISOString();

const freshPurchase = {
  purchasedAt: PURCHASED_AT,
  amountPaid: 6320,
  hasRequestedRefund: false,
  isClaimedTeamSeat: false,
};

const noProgress = {
  lessonCount: 10,
  completedLessonCount: 0,
  secondsWatched: 0,
};

describe("getRefundEligibility", () => {
  // The Refund Amount is what was paid ($63.20, e.g. with a coupon), never the
  // list price of the course ($79).
  it("lets a learner with a fresh purchase and no progress request a refund of what they paid", () => {
    const result = getRefundEligibility(
      freshPurchase,
      noProgress,
      new Date(2026, 10, 2, 9, 0)
    );

    expect(result).toEqual({
      eligible: true,
      refundAmount: 6320,
      lastDayOfRefundWindow: "2026-11-15",
    });
  });

  describe("the Refund Window", () => {
    it("stays open for the whole of the fourteenth day after a late-evening purchase", () => {
      const result = getRefundEligibility(
        freshPurchase,
        noProgress,
        new Date(2026, 10, 15, 23, 59)
      );

      expect(result.eligible).toBe(true);
    });

    it("is closed on the fifteenth day", () => {
      const result = getRefundEligibility(
        freshPurchase,
        noProgress,
        new Date(2026, 10, 16, 0, 0)
      );

      expect(result).toEqual({
        eligible: false,
        reason: "outside-refund-window",
      });
    });
  });

  it("refuses a second refund while one is still Requested", () => {
    const result = getRefundEligibility(
      { ...freshPurchase, hasRequestedRefund: true },
      noProgress,
      new Date(2026, 10, 2, 9, 0)
    );

    expect(result).toEqual({ eligible: false, reason: "refund-requested" });
  });

  it("refuses a team seat someone has claimed, because it belongs to the team", () => {
    const result = getRefundEligibility(
      { ...freshPurchase, isClaimedTeamSeat: true },
      noProgress,
      new Date(2026, 10, 2, 9, 0)
    );

    expect(result).toEqual({ eligible: false, reason: "claimed-team-seat" });
  });

  describe("progress through the course", () => {
    const insideWindow = new Date(2026, 10, 3, 12, 0);

    it("refuses a learner who has completed half the lessons, however little they watched", () => {
      const result = getRefundEligibility(
        freshPurchase,
        { lessonCount: 10, completedLessonCount: 5, secondsWatched: 60 * 60 },
        insideWindow
      );

      expect(result).toEqual({
        eligible: false,
        reason: "too-much-completed",
      });
    });

    it("still lets a learner who has completed just under half the lessons request a refund", () => {
      const result = getRefundEligibility(
        freshPurchase,
        { lessonCount: 10, completedLessonCount: 4, secondsWatched: 60 * 60 },
        insideWindow
      );

      expect(result.eligible).toBe(true);
    });

    it("refuses a learner who has watched two hours of the course", () => {
      const result = getRefundEligibility(
        freshPurchase,
        { lessonCount: 10, completedLessonCount: 0, secondsWatched: 7200 },
        insideWindow
      );

      expect(result).toEqual({
        eligible: false,
        reason: "too-much-watched",
      });
    });

    it("still lets a learner who has watched just under two hours request a refund", () => {
      const result = getRefundEligibility(
        freshPurchase,
        { lessonCount: 10, completedLessonCount: 0, secondsWatched: 7199 },
        insideWindow
      );

      expect(result.eligible).toBe(true);
    });
  });
});

describe("buildRefundRequestedEmail", () => {
  const email = buildRefundRequestedEmail({
    learnerName: "Liam",
    learnerEmail: "liam@example.com",
    courseTitle: "Introduction to TypeScript",
    refundAmount: 6320,
  });

  it("goes to the learner and names the Refund in the subject", () => {
    expect(email.to).toBe("liam@example.com");
    expect(email.subject).toBe(
      "Refund requested — Introduction to TypeScript"
    );
  });

  it("states the Refund Amount the learner paid", () => {
    expect(email.body).toContain("$63.20");
  });

  it("never calls the Refund a Reversal or a Chargeback", () => {
    expect(email.body).not.toMatch(/reversal|chargeback|cancel/i);
  });
});
