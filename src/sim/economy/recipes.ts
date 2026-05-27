import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  CraftingRecipeDefinition,
  CraftingRecipeId,
  CultureState,
  DerivedStatKey,
  Item,
  ItemOriginKind,
  ItemProvenance,
  Person,
  RecipeStudy,
  SkillBlock,
  SkillKey,
  StatBlock,
  WorldFeature
} from "../types";

const maxKnownRecipes = 12;

export const craftingRecipes: Record<CraftingRecipeId, CraftingRecipeDefinition> = {
  "hearth-forging": {
    id: "hearth-forging",
    name: "Hearth Forging",
    tier: 1,
    difficulty: 34,
    outputTechVariant: "forged",
    qualityFloor: "common",
    requiredSkills: { survival: 12 },
    requiredStats: { dexterity: 18 },
    ingredients: ["charcoal", "local metal or bone", "hide binding"],
    methods: ["heat-and-hammer work", "practical balancing", "field repair"],
    siteTags: ["settlement", "forge"],
    risks: ["waste", "bad temper"],
    tags: ["craft", "mundane", "practical", "might"],
    description: "The ordinary craft tradition behind useful weapons, armor, tools, and travel gear."
  },
  "tempered-steel-arms": {
    id: "tempered-steel-arms",
    name: "Tempered Steel Arms",
    tier: 2,
    difficulty: 52,
    outputMaterial: "steel",
    outputTechLevel: "steel",
    outputTechVariant: "tempered",
    qualityFloor: "fine",
    requiredSkills: { blade: 24, survival: 18 },
    requiredStats: { strength: 28, dexterity: 28 },
    ingredients: ["good ore", "quench brine", "hard charcoal"],
    methods: ["folded heat cycles", "edge tempering", "balance testing"],
    siteTags: ["forge", "mine"],
    risks: ["warping", "brittle edges"],
    tags: ["craft", "weapon", "armor", "practical", "might"],
    description: "Battlefield craft for reliable steel arms that can become famous through use."
  },
  "green-amber-alchemy": {
    id: "green-amber-alchemy",
    name: "Green-Amber Alchemy",
    tier: 2,
    difficulty: 58,
    outputMaterial: "green-amber",
    outputTechLevel: "alchemical",
    outputTechVariant: "clockwork",
    qualityFloor: "fine",
    requiredSkills: { medicine: 24, survival: 18 },
    requiredStats: { intelligence: 30, wisdom: 28 },
    ingredients: ["green amber", "resin distillate", "quiet oil"],
    methods: ["slow distillation", "lens setting", "tiny ratchet work"],
    siteTags: ["forest", "workbench"],
    risks: ["toxic fumes", "spoiled charge"],
    tags: ["craft", "alchemy", "trinket", "medicine", "materialist"],
    description: "Forest and guild craft that turns resin, amber, and clockwork into useful lenses or tonics."
  },
  "moon-iron-warding": {
    id: "moon-iron-warding",
    name: "Moon-Iron Warding",
    tier: 3,
    difficulty: 72,
    outputMaterial: "moon-iron",
    outputTechLevel: "runic",
    outputTechVariant: "rune-bound",
    qualityFloor: "masterwork",
    requiredSkills: { ward: 34, survival: 24 },
    requiredStats: { wisdom: 36, endurance: 30 },
    ingredients: ["moon-iron", "grave salt", "oath ash"],
    methods: ["cold hammering", "ward letter binding", "night quench"],
    siteTags: ["moon", "vault", "forge"],
    risks: ["curse recoil", "failed binding"],
    tags: ["craft", "ward", "magic", "pure", "protection"],
    description: "A defensive rite for metal that remembers vows and resists curses."
  },
  "storm-quartz-focusing": {
    id: "storm-quartz-focusing",
    name: "Storm-Quartz Focusing",
    tier: 3,
    difficulty: 76,
    outputMaterial: "storm-quartz",
    outputTechLevel: "runic",
    outputTechVariant: "clockwork",
    qualityFloor: "masterwork",
    requiredSkills: { sorcery: 34, survival: 24 },
    requiredStats: { intelligence: 38, perception: 32 },
    ingredients: ["storm quartz", "sky salt", "silver wire"],
    methods: ["facet listening", "charge tuning", "nested gear indexing"],
    siteTags: ["crystal", "highland", "storm"],
    risks: ["mana flash", "shattered focus"],
    tags: ["craft", "sorcery", "magic", "trinket", "materialist"],
    description: "A focusing discipline that makes quartz hold a repeatable magical pattern."
  },
  "saint-ash-consecration": {
    id: "saint-ash-consecration",
    name: "Saint-Ash Consecration",
    tier: 3,
    difficulty: 80,
    outputMaterial: "saint-ash",
    outputTechLevel: "runic",
    outputTechVariant: "rune-bound",
    qualityFloor: "enchanted",
    requiredSkills: { medicine: 34, ward: 30 },
    requiredStats: { wisdom: 40, charisma: 30 },
    ingredients: ["saint ash", "witness vows", "clean water"],
    methods: ["public vow taking", "ash setting", "mercy seal"],
    siteTags: ["shrine", "vault", "settlement"],
    risks: ["false sanctity", "public scandal"],
    tags: ["craft", "holy", "pure", "forgiving", "spiritualist"],
    description: "A social and sacred process that turns ash, witness, and restraint into protection."
  },
  "relic-glass-cutting": {
    id: "relic-glass-cutting",
    name: "Relic-Glass Cutting",
    tier: 4,
    difficulty: 92,
    outputMaterial: "relic-glass",
    outputTechLevel: "precursor",
    outputTechVariant: "aether-woven",
    qualityFloor: "enchanted",
    requiredSkills: { sorcery: 38, survival: 28 },
    requiredStats: { perception: 42, intelligence: 40 },
    ingredients: ["relic glass", "old-road silver", "unbroken reflection"],
    methods: ["memory polishing", "angle cutting", "echo inscription"],
    siteTags: ["vault", "ruin", "mirror"],
    risks: ["false memories", "mirror sickness"],
    tags: ["craft", "relic", "magic", "lore", "precursor"],
    description: "A dangerous old-road craft that preserves reflections of places, people, and vows."
  },
  "aether-weaving": {
    id: "aether-weaving",
    name: "Aether Weaving",
    tier: 5,
    difficulty: 110,
    outputTechLevel: "aetheric",
    outputTechVariant: "aether-woven",
    qualityFloor: "enchanted",
    requiredSkills: { sorcery: 42, ward: 34, survival: 28 },
    requiredStats: { intelligence: 44, perception: 40 },
    ingredients: ["sky salt", "portal thread", "thin-air poppies"],
    methods: ["door finding", "thread anchoring", "breath-count weaving"],
    siteTags: ["sky", "aether-door", "highland"],
    risks: ["lost hours", "unmoored travel"],
    tags: ["craft", "aether", "magic", "travel", "spiritualist"],
    description: "A recipe family that starts with finding a door into the aether and keeping it open long enough to weave."
  },
  "auramite-vibro-edge": {
    id: "auramite-vibro-edge",
    name: "Auramite Vibro-Edge",
    tier: 6,
    difficulty: 128,
    outputKind: "weapon",
    outputMaterial: "auramite",
    outputTechLevel: "precursor",
    outputTechVariant: "vibro",
    qualityFloor: "legendary",
    requiredSkills: { blade: 42, sorcery: 40, command: 28 },
    requiredStats: { dexterity: 44, intelligence: 42 },
    ingredients: ["auramite", "storm-quartz driver", "bloodless edge oil"],
    methods: ["harmonic edge tuning", "aura tempering", "last-sound calibration"],
    siteTags: ["vault", "crystal", "forge"],
    risks: ["harmonic backlash", "edge hunger"],
    tags: ["craft", "weapon", "aura", "precursor", "might", "magic"],
    description: "A legendary weapons craft that joins auramite aura memory to a singing edge."
  },
  soulforging: {
    id: "soulforging",
    name: "Soulforging",
    tier: 6,
    difficulty: 136,
    outputMaterial: "living-iron",
    outputTechLevel: "precursor",
    outputTechVariant: "soulforged",
    qualityFloor: "legendary",
    requiredSkills: { sorcery: 44, ward: 36, command: 30 },
    requiredStats: { wisdom: 46, intelligence: 42, charisma: 32 },
    ingredients: ["living iron", "named soul debt", "sealed witness"],
    methods: ["soul binding", "bloodless bargain", "will tempering"],
    siteTags: ["deep", "vault", "death"],
    risks: ["possession", "curse inheritance", "witness madness"],
    tags: ["craft", "soul", "corrupt", "death", "dominion", "magic"],
    description: "The forbidden family of recipes that makes an object remember hunger, names, and obedience."
  }
};

export const recipeList = Object.values(craftingRecipes);

function statValue(stats: StatBlock | undefined, key: DerivedStatKey): number {
  return stats?.derived[key] ?? 50;
}

function primarySkillForRecipe(recipe: CraftingRecipeDefinition): keyof SkillBlock {
  const requirements = Object.keys(recipe.requiredSkills ?? {}) as SkillKey[];
  if (requirements.length > 0) {
    return requirements.sort((a, b) => (recipe.requiredSkills?.[b] ?? 0) - (recipe.requiredSkills?.[a] ?? 0))[0];
  }
  if (recipe.tags.includes("weapon") || recipe.tags.includes("might")) return "blade";
  if (recipe.tags.includes("sorcery") || recipe.tags.includes("aether") || recipe.tags.includes("magic")) return "sorcery";
  if (recipe.tags.includes("holy") || recipe.tags.includes("protection")) return "ward";
  if (recipe.tags.includes("medicine") || recipe.tags.includes("alchemy")) return "medicine";
  return "survival";
}

function requirementGap(person: Person, recipe: CraftingRecipeDefinition): number {
  const skillGap = Object.entries(recipe.requiredSkills ?? {}).reduce(
    (sum, [key, minimum]) => sum + Math.max(0, (minimum ?? 0) - person.skills[key as SkillKey]),
    0
  );
  const statGap = Object.entries(recipe.requiredStats ?? {}).reduce(
    (sum, [key, minimum]) => sum + Math.max(0, (minimum ?? 0) - statValue(person.stats, key as DerivedStatKey)),
    0
  );
  return skillGap + statGap;
}

export function recipeMeetsRequirements(person: Person, recipe: CraftingRecipeDefinition): boolean {
  return requirementGap(person, recipe) <= 0;
}

export function recipeLearningAffinity(person: Person, recipe: CraftingRecipeDefinition): number {
  const primarySkill = primarySkillForRecipe(recipe);
  let score =
    person.traits.curiosity * 0.18 +
    person.traits.ambition * 0.1 +
    person.stats.derived.intelligence * 0.2 +
    person.stats.derived.wisdom * 0.12 +
    person.stats.derived.perception * 0.14 +
    person.skills[primarySkill] * 0.18 -
    recipe.tier * 3;
  if (recipe.tags.includes("magic") || recipe.tags.includes("aether")) score += person.identity.mightMagic * 0.18 + person.skills.sorcery * 0.08;
  if (recipe.tags.includes("might") || recipe.tags.includes("practical")) score -= person.identity.mightMagic * 0.12 + person.skills.blade * 0.05;
  if (recipe.tags.includes("pure") || recipe.tags.includes("holy")) score += person.identity.corruptPure * 0.14 + person.identity.evilGood * 0.1;
  if (recipe.tags.includes("corrupt") || recipe.tags.includes("death") || recipe.tags.includes("soul")) {
    score -= person.identity.corruptPure * 0.18 + person.identity.evilGood * 0.14 + person.identity.vengefulForgiving * 0.1;
  }
  if (recipe.tags.includes("dominion")) score -= person.identity.authoritarianEgalitarian * 0.1;
  if (recipe.tags.includes("spiritualist")) score += person.identity.materialistSpiritualist * 0.1;
  if (recipe.tags.includes("materialist")) score -= person.identity.materialistSpiritualist * 0.08;
  if (person.role === "mage" && (recipe.tags.includes("magic") || recipe.tags.includes("sorcery"))) score += 10;
  if (person.role === "healer" && (recipe.tags.includes("holy") || recipe.tags.includes("medicine"))) score += 10;
  if (person.role === "fighter" && (recipe.tags.includes("weapon") || recipe.tags.includes("might"))) score += 8;
  if (person.role === "scout" && (recipe.tags.includes("travel") || recipe.tags.includes("practical"))) score += 6;
  return Math.round(score);
}

export function ensureCultureRecipes(culture: CultureState | undefined): CraftingRecipeId[] {
  if (!culture) {
    return [];
  }
  culture.knownRecipeIds ??= [];
  return culture.knownRecipeIds;
}

export function teachCultureRecipe(culture: CultureState | undefined, recipeId: CraftingRecipeId): boolean {
  if (!culture || !craftingRecipes[recipeId]) {
    return false;
  }
  culture.knownRecipeIds ??= [];
  if (culture.knownRecipeIds.includes(recipeId)) {
    return false;
  }
  culture.knownRecipeIds.push(recipeId);
  return true;
}

export function ensureRecipeKnowledge(person: Person, rng: Rng, culture?: CultureState): CraftingRecipeId[] {
  person.recipeIds ??= [];
  person.recipeStudy ??= {};
  const known = new Set(person.recipeIds.filter((id) => Boolean(craftingRecipes[id])));
  if (person.age >= 16 && known.size === 0) {
    known.add("hearth-forging");
    if ((person.role === "fighter" || person.role === "leader") && rng.chance(0.34)) known.add("tempered-steel-arms");
    if ((person.role === "mage" || person.skills.sorcery > 34) && rng.chance(0.24)) known.add("storm-quartz-focusing");
    if ((person.role === "healer" || person.skills.ward + person.skills.medicine > 66) && rng.chance(0.22)) known.add("saint-ash-consecration");
  }
  const cultureRecipeIds = ensureCultureRecipes(culture);
  if (!culture) {
    person.recipeIds = [...known].slice(0, maxKnownRecipes);
    return person.recipeIds;
  }
  for (const recipeId of cultureRecipeIds) {
    const recipe = craftingRecipes[recipeId];
    if (!recipe || known.has(recipeId) || known.size >= maxKnownRecipes) continue;
    const learnChance = clamp(0.2 + culture.level * 0.035 + Math.max(0, recipeLearningAffinity(person, recipe)) / 520 - recipe.tier * 0.018, 0.04, 0.48);
    if (recipe.tier <= culture.level + 1 && rng.chance(learnChance)) {
      known.add(recipeId);
    }
  }
  person.recipeIds = [...known].slice(0, maxKnownRecipes);
  return person.recipeIds;
}

export function knownRecipes(person: Person): CraftingRecipeDefinition[] {
  return (person.recipeIds ?? [])
    .map((id) => craftingRecipes[id])
    .filter((recipe): recipe is CraftingRecipeDefinition => Boolean(recipe));
}

export function studiedRecipes(person: Person): { recipe: CraftingRecipeDefinition; study: RecipeStudy }[] {
  return Object.values(person.recipeStudy ?? {})
    .map((study) => ({ study, recipe: craftingRecipes[study.recipeId] }))
    .filter((entry): entry is { recipe: CraftingRecipeDefinition; study: RecipeStudy } => Boolean(entry.recipe))
    .sort((a, b) => b.study.exposure + b.study.affinity * 0.25 - (a.study.exposure + a.study.affinity * 0.25));
}

export function learnRecipe(person: Person, recipeId: CraftingRecipeId, rng: Rng, culture?: CultureState): CraftingRecipeDefinition | undefined {
  const recipe = craftingRecipes[recipeId];
  if (!recipe) {
    return undefined;
  }
  ensureRecipeKnowledge(person, rng, culture);
  if (!person.recipeIds.includes(recipeId)) {
    person.recipeIds = [...person.recipeIds, recipeId].slice(0, maxKnownRecipes);
  }
  delete person.recipeStudy[recipeId];
  teachCultureRecipe(culture, recipeId);
  return recipe;
}

export function recipeForItem(item: Item): CraftingRecipeDefinition | undefined {
  if (item.provenance?.recipeId && craftingRecipes[item.provenance.recipeId]) {
    return craftingRecipes[item.provenance.recipeId];
  }
  if (item.techVariant === "soulforged" || item.material === "living-iron") return craftingRecipes.soulforging;
  if (item.material === "auramite" && item.techVariant === "vibro") return craftingRecipes["auramite-vibro-edge"];
  if (item.techVariant === "aether-woven" || item.techLevel === "aetheric") return craftingRecipes["aether-weaving"];
  if (item.material === "relic-glass" || item.kind === "relic" || item.techLevel === "precursor") return craftingRecipes["relic-glass-cutting"];
  if (item.material === "saint-ash") return craftingRecipes["saint-ash-consecration"];
  if (item.material === "moon-iron" || item.techVariant === "rune-bound") return craftingRecipes["moon-iron-warding"];
  if (item.material === "storm-quartz" || item.techVariant === "clockwork") return craftingRecipes["storm-quartz-focusing"];
  if (item.material === "green-amber" || item.techLevel === "alchemical") return craftingRecipes["green-amber-alchemy"];
  if (item.material === "steel" || item.techLevel === "steel" || item.techVariant === "tempered") return craftingRecipes["tempered-steel-arms"];
  return craftingRecipes["hearth-forging"];
}

function originKindForItem(item: Item, recipe: CraftingRecipeDefinition | undefined, requested?: ItemOriginKind): ItemOriginKind {
  if (requested) return requested;
  if (item.techVariant === "soulforged" || recipe?.id === "soulforging") return "soulforged";
  if (item.techVariant === "aether-woven" || item.techLevel === "aetheric" || recipe?.tags.includes("aether")) return "aether";
  if (item.kind === "relic" || item.quality === "legendary" || item.techLevel === "precursor") return "relic";
  return "found";
}

export function makeItemProvenance(
  item: Item,
  context: {
    originKind?: ItemOriginKind;
    creatorPersonId?: string;
    creatorName?: string;
    cultureId?: string;
    settlementId?: string;
    settlementName?: string;
    featureId?: string;
    featureName?: string;
    createdTick?: number;
    resource?: string;
  } = {}
): ItemProvenance {
  const recipe = recipeForItem(item);
  const inferredOrigin = originKindForItem(item, recipe, context.originKind);
  const originKind = !context.originKind && context.creatorPersonId && inferredOrigin === "found" ? "crafted" : inferredOrigin;
  const place = context.featureName ?? context.settlementName ?? "unknown ground";
  const actor = context.creatorName ? `${context.creatorName} made it` : originKind === "found" ? "It was found" : "It was made";
  const recipeText = recipe ? `through ${recipe.name}` : "by an unknown method";
  const ingredientText = context.resource ? ` around ${context.resource}` : "";
  const story =
    originKind === "soulforged"
      ? `${actor} ${recipeText}, binding will and memory at ${place}${ingredientText}.`
      : originKind === "aether"
        ? `${actor} ${recipeText}, after a door or thin place at ${place} gave the work its thread.`
        : originKind === "relic"
          ? `${actor} ${recipeText}; later witnesses treated the craft as a relic-origin at ${place}.`
          : originKind === "crafted"
            ? `${actor} ${recipeText} at ${place}${ingredientText}.`
            : `${actor} near ${place}${ingredientText}, with marks of ${recipe?.name ?? "unknown craft"}.`;
  return {
    originKind,
    recipeId: recipe?.id,
    creatorPersonId: context.creatorPersonId,
    cultureId: context.cultureId,
    settlementId: context.settlementId,
    featureId: context.featureId,
    createdTick: context.createdTick ?? 0,
    ingredients: recipe?.ingredients ?? [],
    methods: recipe?.methods ?? [],
    story
  };
}

export function recipesForFeature(feature: WorldFeature): CraftingRecipeDefinition[] {
  const text = [...feature.resources, ...feature.threats, feature.kind, feature.layer, ...feature.tags].join(" ").toLowerCase();
  const ids: CraftingRecipeId[] = [];
  if (feature.kind === "sky-ruin" || feature.kind === "floating-island" || feature.layer === "sky") ids.push("aether-weaving");
  if (feature.kind === "ancient-vault" || text.includes("relic glass") || text.includes("old-road") || text.includes("mirror")) ids.push("relic-glass-cutting");
  if (feature.kind === "crystal-seam" || text.includes("storm quartz") || text.includes("quartz")) ids.push("storm-quartz-focusing");
  if (text.includes("saint ash") || text.includes("saint")) ids.push("saint-ash-consecration");
  if (text.includes("moon") || text.includes("road silver") || text.includes("silver")) ids.push("moon-iron-warding");
  if (text.includes("green amber") || text.includes("amber")) ids.push("green-amber-alchemy");
  if (text.includes("bog iron") || text.includes("copper") || text.includes("ore") || feature.kind === "ore-vein") ids.push("tempered-steel-arms");
  if (feature.layer === "deep" && (text.includes("dead") || text.includes("wight") || text.includes("ghost") || text.includes("ghoul") || feature.kind === "ancient-vault")) {
    ids.push("soulforging");
  }
  if (ids.length === 0 && feature.kind === "ore-vein") ids.push("hearth-forging");
  return [...new Set(ids)].map((id) => craftingRecipes[id]).filter((recipe): recipe is CraftingRecipeDefinition => Boolean(recipe));
}

function observeRecipe(person: Person, recipe: CraftingRecipeDefinition, tick: number, rng: Rng, bonus: number): RecipeStudy | undefined {
  if ((person.recipeIds ?? []).includes(recipe.id)) {
    return undefined;
  }
  ensureRecipeKnowledge(person, rng);
  const primarySkill = primarySkillForRecipe(recipe);
  const noticed =
    person.stats.derived.perception +
    person.stats.derived.intelligence * 0.4 +
    person.stats.derived.wisdom * 0.14 +
    person.skills[primarySkill] * 0.22 +
    bonus +
    rng.int(-28, 20);
  if (noticed < 42 && rng.chance(0.62)) {
    return undefined;
  }

  const study =
    person.recipeStudy[recipe.id] ??
    ({
      recipeId: recipe.id,
      exposure: 0,
      attempts: 0,
      lastObservedTick: tick,
      lastAttemptTick: -1,
      affinity: recipeLearningAffinity(person, recipe)
    } satisfies RecipeStudy);
  const clarity = clamp(4 + person.stats.derived.perception * 0.05 + person.stats.derived.intelligence * 0.06 + person.skills[primarySkill] * 0.05 + bonus + rng.int(0, 6), 2, 24);
  study.exposure = clamp(study.exposure + clarity, 0, 220);
  study.lastObservedTick = tick;
  study.affinity = recipeLearningAffinity(person, recipe);
  person.recipeStudy[recipe.id] = study;
  return study;
}

export function observeRecipeFromItem(person: Person, item: Item, tick: number, rng: Rng, bonus = 0): RecipeStudy | undefined {
  const recipe = recipeForItem(item);
  return recipe ? observeRecipe(person, recipe, tick, rng, bonus + (item.provenance?.methods.length ?? 0)) : undefined;
}

export function observeRecipesFromFeature(person: Person, feature: WorldFeature, tick: number, rng: Rng, bonus = 0): RecipeStudy[] {
  return recipesForFeature(feature)
    .map((recipe) => observeRecipe(person, recipe, tick, rng, bonus + Math.floor(feature.exploration / 18)))
    .filter((study): study is RecipeStudy => Boolean(study));
}

export function attemptObservedRecipeLearning(person: Person, rng: Rng, tick: number, culture?: CultureState): CraftingRecipeDefinition | undefined {
  ensureRecipeKnowledge(person, rng, culture);
  if (person.recipeIds.length >= maxKnownRecipes) {
    return undefined;
  }
  const candidates = Object.values(person.recipeStudy ?? {})
    .map((study) => ({ study, recipe: craftingRecipes[study.recipeId] }))
    .filter(
      (entry): entry is { study: RecipeStudy; recipe: CraftingRecipeDefinition } =>
        Boolean(entry.recipe) && !person.recipeIds.includes(entry.study.recipeId) && entry.study.exposure >= 18
    );
  if (candidates.length === 0) {
    return undefined;
  }
  const chosen = rng.weighted(
    candidates.map((entry) => ({
      value: entry,
      weight: Math.max(1, entry.study.exposure + entry.study.affinity * 0.65 - requirementGap(person, entry.recipe) * 0.7)
    }))
  );
  const difficulty = chosen.recipe.difficulty + requirementGap(person, chosen.recipe) * 1.35;
  const aptitude =
    chosen.study.exposure * 0.72 +
    chosen.study.affinity * 0.34 +
    person.stats.derived.intelligence * 0.2 +
    person.stats.derived.wisdom * 0.16 +
    person.stats.derived.perception * 0.12 +
    person.skills[primarySkillForRecipe(chosen.recipe)] * 0.18 +
    chosen.study.attempts * 5 +
    rng.int(-18, 30);

  chosen.study.attempts += 1;
  chosen.study.lastAttemptTick = tick;
  chosen.study.exposure = clamp(chosen.study.exposure + 3, 0, 240);

  if (aptitude < difficulty) {
    return undefined;
  }
  return learnRecipe(person, chosen.recipe.id, rng, culture);
}
