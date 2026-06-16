import type { ApiTask, TaskPatch } from "@/lib/api";

export type TaskPatchSetter = <K extends keyof TaskPatch>(key: K, value: TaskPatch[K]) => void;

/** Task fields merged with in-progress patch edits. */
export type MergedTask = ApiTask & TaskPatch;

export interface TaskSectionProps {
  merged: MergedTask;
  set: TaskPatchSetter;
}
