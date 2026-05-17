import type { SchedulePlan } from '../types';

export function explainSchedule(plan: SchedulePlan): string {
  if (plan.ordered.length === 0) return 'Nothing scheduled — add tasks or lower your load.';

  const lines = plan.ordered.slice(0, 5).map((s, i) => {
    const why = s.reasons.length ? ` (${s.reasons.join(', ')})` : '';
    return `${i + 1}. ${s.task.text}${why}`;
  });

  return `Plan: ${plan.workloadMinutes} min total.\n${lines.join('\n')}`;
}
