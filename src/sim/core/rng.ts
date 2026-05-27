export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty list.");
    }
    return items[this.int(0, items.length - 1)];
  }

  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    if (items.length === 0) {
      throw new Error("Cannot choose a weighted item from an empty list.");
    }

    const weightedItems: { value: T; weight: number }[] = [];
    let fallback: { value: T; weight: number } | undefined;
    for (const item of items) {
      if (!item) {
        continue;
      }
      fallback ??= item;
      if (Number.isFinite(item.weight) && item.weight > 0) {
        weightedItems.push({ value: item.value, weight: item.weight });
      }
    }

    if (weightedItems.length === 0) {
      if (!fallback) {
        throw new Error("Cannot choose a weighted item from an empty list.");
      }
      return fallback.value;
    }

    const total = weightedItems.reduce((sum, item) => sum + item.weight, 0);
    let roll = this.next() * total;
    for (const item of weightedItems) {
      roll -= item.weight;
      if (roll <= 0) {
        return item.value;
      }
    }

    return weightedItems[weightedItems.length - 1].value;
  }
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
