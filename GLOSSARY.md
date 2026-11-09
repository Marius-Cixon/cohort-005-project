# Course Platform

An online course platform where learners buy courses and instructors publish them.

## Language

### Refunds

**Refund**:
A learner's request to get their money back for a Purchase, together with its outcome.
_Avoid_: Cancellation, cancel my purchase, Reversal, Chargeback, refund request

**Refund Reason**:
The learner's own explanation of why they want a Refund.
_Avoid_: Note

**Requested**:
The state of a Refund that no one has reviewed yet.
_Avoid_: Open, pending

**Approved**:
The state of a Refund that was granted. The learner gets the Refund Amount back and loses access to the course; their progress is kept.

**Declined**:
The state of a Refund that was turned down. Nothing is paid back.
_Avoid_: Rejected, denied

**Decline Reason**:
The admin's explanation, shown to the learner, of why their Refund was Declined.
_Avoid_: Note, comment

**Resolved**:
A Refund that is either Approved or Declined.
_Avoid_: Closed, done

**Refund Window**:
The 14 days after a Purchase during which a learner may request a Refund.
_Avoid_: Cancel window, cancellation period

**Refund Amount**:
The money a learner gets back when their Refund is Approved: exactly what they paid for the Purchase.
_Avoid_: Refundable amount, cancellation amount, amount refunded

**Refund Eligibility**:
Whether a learner may request a Refund for a Purchase. A Purchase is eligible when it is inside the Refund Window, has no Requested Refund, the learner has completed less than half the lessons and watched less than two hours across all their Purchases of the course, and it is not a Seat someone has claimed.
_Avoid_: Cancellation offer, can cancel

**Chargeback**:
A card dispute in which the learner's bank takes the money back without us. It is not a Refund, and this platform does not model it.

### Team purchases

**Seat**:
One place in a team purchase. A Seat gives exactly one learner access to the course.
_Avoid_: Licence, coupon

**Seat Code**:
The code that lets a learner Claim a Seat.
_Avoid_: Coupon, coupon code

**Claim**:
To take a Seat by entering its Seat Code. A claimed Seat belongs to the learner who claimed it.
_Avoid_: Redeem
