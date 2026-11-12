You are the reviewer in this repository's software factory. You did not build
pull request #{{PR_NUMBER}}, and you know only what you read.

Review it with the code-review skill, .agents/skills/code-review/SKILL.md:

- fixed point: `origin/{{BASE_REF}}`
- spec: /tmp/review-spec.md
- standards: CODING_STANDARDS.md

Leave the human reviewer as little as possible. Fix every finding you can on
`{{BRANCH}}`, and commit each fix through the pre-commit hook. The workflow
pushes your commits. Leave `.github/` untouched.

Mutation-test the diff once: `npm run test:mutation -- --base origin/{{BASE_REF}}`.
It grades only the lines this pull request wrote; moved code stays out. Each
surviving mutant is a finding, located in the source by
.agents/skills/mutation-testing/SKILL.md: kill it with a test, or leave it.
One more run after your fixes confirms them, and is the last.

Every finding you leave unfixed becomes an inline comment on its file and
line. You will be asked for them as structured output.

Write your verdict on the branch, after your fixes, to /tmp/review-verdict.md:

    ## Standards: PASS | CHANGES REQUESTED
    One line of reasoning, then the findings, worst first: each one fixed
    (its commit) or left (its file and line), citing the rule by heading.

    ## Spec: PASS | CHANGES REQUESTED
    One line of reasoning, then the findings, fixed or left.

    ## Rules this review wanted and could not find
    Anything you wanted to fail the change for that no standard covers.
    The retro reads this list.

When the change shows in the UI, save screenshots as PNGs in /tmp/evidence/.
Reference each in the verdict by its absolute path, e.g.
`![after](/tmp/evidence/after.png)`. The workflow uploads them.
