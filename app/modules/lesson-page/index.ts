import type { loadLessonPage } from "./lib/load.server";

/** What the lesson page renders: the full lesson, or a locked teaser. */
export type LessonPageData = Awaited<ReturnType<typeof loadLessonPage>>;
