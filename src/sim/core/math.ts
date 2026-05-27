import type { Id } from "../types";

export function makeId(prefix: string, index: number): Id {
  return `${prefix}-${index.toString(36)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
