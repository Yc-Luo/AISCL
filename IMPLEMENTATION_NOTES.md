# AISCL Implementation Notes

## Deferred: Group Leader Role

Date: 2026-04-27

Decision: do not implement the group leader feature before the current deployment round.

Recommended future design:

- Add `leader_id` to the project/group model instead of overloading `members.role`.
- Keep `members.role` as the permission role only: `owner`, `editor`, or `viewer`.
- Ensure each group has at most one leader, and the leader must be a student member of that group.
- Let teachers choose the leader when creating or editing a group; if omitted, default to the first selected student.
- Show a clear "group leader" badge in the student member list and teacher monitoring views.
- Give the leader lightweight responsibility actions only, such as final artifact submission, stage artifact confirmation, and group archive upload.
- Do not let the leader manage members, change experiment settings, control task stages, or access teacher-only monitoring tools.

Research event ideas for later implementation:

- `group_leader_assigned`
- `group_leader_changed`
- `group_final_submission_created`
- `group_final_submission_updated`
- `group_final_submission_confirmed`

Research rationale:

The leader should be treated as a collaborative responsibility role rather than a permission role. This avoids disrupting existing permission checks while still supporting later analysis of responsibility distribution, final artifact submission behavior, and group coordination quality.
