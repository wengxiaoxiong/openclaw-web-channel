import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAtypicaRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getAtypicaRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Web Channel runtime not initialized - plugin not registered");
  }
  return runtime;
}
