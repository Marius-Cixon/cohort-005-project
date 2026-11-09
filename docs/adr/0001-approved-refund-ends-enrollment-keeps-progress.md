# An Approved Refund deletes the enrollment and keeps the progress

When an admin approves a Refund, the learner's enrollment in the course is deleted, so they lose access straight away. Their lesson progress, watch history, quiz attempts and course rating stay in the database for as long as their account exists. We delete the enrollment because every access check in the app treats "has an enrollment" as "may see the course", and a forgotten filter on an "ended" flag would give someone access they have not paid for. We keep the progress because a learner who buys again picks up where they stopped, and because Refund Eligibility counts it across all Purchases of a course: no one can watch a course for free in two-hour instalments by buying, refunding and buying again.

## Considered Options

- **Keep the enrollment and mark it ended.** This would preserve `enrolledAt`, `completedAt` and enrollment-based history in analytics. We rejected it: each of the many queries on enrollments would have to filter the mark, and missing one fails open.
- **Delete the progress together with the enrollment.** We rejected this because it cannot be undone if a Refund was approved by mistake. It would also let a learner reset the Refund Eligibility limits by refunding and buying again.

## Consequences

- The enrollment's history (`enrolledAt`, `completedAt`) is lost. The Refund, its Purchase and who approved it are the record that the learner once had the course.
- Instructor analytics must treat refunded Purchases explicitly: revenue is shown net of Approved Refunds, and a refunded buyer does not count as "bought but never enrolled".
- The course rating of a learner without access is kept but left out of the average and the course page. It counts again if they buy again.
- Approving a Refund on a team purchase also voids every Seat Code of that Purchase that no one has claimed.
- Progress is deleted only when the account is deleted. Account deletion is not built yet and is out of scope here.
