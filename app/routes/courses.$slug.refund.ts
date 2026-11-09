import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  buildRefundRequestedEmail,
  REFUND_WINDOW_DAYS,
  type RefundIneligibleReason,
} from "~/lib/refunds";
import { getRefundEligibilityForCourse } from "~/lib/refunds.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

const INELIGIBLE_RESPONSES: Record<
  RefundIneligibleReason,
  { message: string; status: number }
> = {
  "refund-requested": {
    message: "You already have a Refund requested for this purchase.",
    status: 409,
  },
  "claimed-team-seat": {
    message: "A claimed team seat cannot be refunded.",
    status: 403,
  },
  "outside-refund-window": {
    message: `The ${REFUND_WINDOW_DAYS}-day Refund Window has closed.`,
    status: 403,
  },
  "too-much-completed": {
    message:
      "You have completed too much of this course to request a refund.",
    status: 403,
  },
  "too-much-watched": {
    message: "You have watched too much of this course to request a refund.",
    status: 403,
  },
};

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = db.select().from(courses).where(eq(courses.slug, slug)).get();

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  const refund = getRefundEligibilityForCourse(currentUserId, course.id);

  if (!refund) {
    throw data("You have not bought this course.", { status: 403 });
  }

  if (!refund.eligibility.eligible) {
    const { message, status } = INELIGIBLE_RESPONSES[refund.eligibility.reason];
    throw data(message, { status });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db.insert(refunds)
    .values({
      purchaseId: refund.purchase.id,
      status: RefundStatus.Requested,
      reason: parsed.data.reason,
    })
    .run();

  const email = buildRefundRequestedEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
    refundAmount: refund.eligibility.refundAmount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
