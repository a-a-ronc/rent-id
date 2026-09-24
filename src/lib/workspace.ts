import { useSyncExternalStore } from "react";

export type WorkspaceMode = "own" | "demo";

const KEY = "rentid.workspace";

let mode: WorkspaceMode = "own";
const listeners = new Set<() => void>();

function init() {
  if (typeof window === "undefined") return;
  const stored = window.localStorage.getItem(KEY);
  if (stored === "demo" || stored === "own") mode = stored;
}
init();

export function getWorkspaceMode(): WorkspaceMode {
  return mode;
}

export function setWorkspaceMode(next: WorkspaceMode) {
  mode = next;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceMode(): [WorkspaceMode, (m: WorkspaceMode) => void] {
  const value = useSyncExternalStore(subscribe, getWorkspaceMode, () => "own" as WorkspaceMode);
  return [value, setWorkspaceMode];
}
