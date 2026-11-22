/** (Ben, 28 Oct) `Count as Pull?` on an imported or past-logged workout's Summary: the shortest copy (minimal-copy rule). */
export const PLAN_DAY_ASK_COPY = {
  question: (day: string) => `Count as ${day}?`,
  yes: 'Count',
  no: 'Not a plan day',
  counted: (day: string) => `Counted as ${day}`,
  notPlanDay: 'Not a plan day',
  undo: 'Undo',
} as const;
