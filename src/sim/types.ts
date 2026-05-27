export type Id = string;

export type TraitKey =
  | "bravery"
  | "caution"
  | "greed"
  | "mercy"
  | "curiosity"
  | "ambition"
  | "loyalty"
  | "wrath";

export type SkillKey =
  | "blade"
  | "ward"
  | "sorcery"
  | "medicine"
  | "survival"
  | "diplomacy"
  | "command";

export type CoreStatKey = "physique" | "finesse" | "willpower";
export type DerivedStatKey =
  | "strength"
  | "dexterity"
  | "endurance"
  | "intelligence"
  | "wisdom"
  | "perception"
  | "charisma";
export type ArchetypeKey = "vanguard" | "duelist" | "arcanist" | "medicant" | "pathfinder" | "envoy" | "laborer";
export type AncestryKey = "human" | "elder" | "deepborn" | "skyborn" | "ashkin";
export type AdoptionStatus = "birth-family" | "orphan" | "ward" | "adopted";

export type IdentityAxisKey =
  | "evilGood"
  | "corruptPure"
  | "authoritarianEgalitarian"
  | "warlikePeaceful"
  | "materialistSpiritualist"
  | "vengefulForgiving"
  | "cravenBold"
  | "mightMagic";

export type ItemKind = "weapon" | "armor" | "trinket" | "consumable" | "relic" | "supply";
export type ItemQuality = "crude" | "common" | "sturdy" | "fine" | "masterwork" | "enchanted" | "legendary";
export type ItemMaterial =
  | "wood"
  | "bone"
  | "leather"
  | "bronze"
  | "iron"
  | "steel"
  | "blackwood"
  | "moon-iron"
  | "relic-glass"
  | "storm-quartz"
  | "green-amber"
  | "saint-ash"
  | "auramite"
  | "living-iron";
export type ItemTechLevel = "stone" | "bronze" | "iron" | "steel" | "alchemical" | "runic" | "aetheric" | "precursor";
export type ItemTechVariant = "handmade" | "cast" | "forged" | "tempered" | "laminated" | "rune-bound" | "clockwork" | "vibro" | "aether-woven" | "soulforged";
export type ItemEffectKind = "power" | "stat" | "skill" | "resistance" | "status" | "ability" | "travel" | "mining";
export type ItemDesire = "bloodshed" | "mercy" | "secrets" | "order" | "wealth" | "travel" | "protection" | "dominion";
export type ItemOriginKind = "crafted" | "found" | "relic" | "aether" | "soulforged" | "natural" | "unknown";
export type CraftingRecipeId = string;
export type AbilityId = string;
export type AbilityKind = "strike" | "spell" | "support" | "passive" | "tactic";
export type AbilityTarget = "self" | "ally" | "enemy" | "cluster" | "party";
export type AbilityEffect = "damage" | "heal" | "guard" | "debuff" | "buff" | "travel" | "social" | "mobility";
export type AbilitySchool = "martial" | "ward" | "sorcery" | "medicine" | "survival" | "diplomacy" | "command" | "divine";
export type QuestKind = "defense" | "delve" | "hunt" | "escort" | "politics";
export type EventKind = "decision" | "combat" | "quest" | "world" | "relation" | "inventory" | "divine";
export type BandPurpose = "adventuring" | "raiding" | "guarding" | "pilgrimage" | "rebellion";
export type FactionKind = "barony" | "freehold" | "guild" | "cult" | "clan";
export type LegalEntityKind = "person" | "band" | "faction" | "organization" | "settlement";
export type OrganizationKind = "guild" | "business" | "order" | "cult" | "dynasty" | "political-bloc";
export type OrganizationStatus = "forming" | "active" | "strained" | "outlawed" | "dormant" | "broken";
export type MembershipRole = "founder" | "leader" | "member" | "agent" | "patron" | "heir" | "initiate" | "debtor" | "exile";
export type MembershipStatus = "active" | "oathbound" | "strained" | "hidden" | "suspended" | "banished";
export type AssetKind =
  | "mine"
  | "forge"
  | "apothecary"
  | "caravan"
  | "graveyard"
  | "temple"
  | "guildhall"
  | "vault"
  | "farm"
  | "dock"
  | "road"
  | "fortress";
export type AssetStatus = "planned" | "active" | "damaged" | "seized" | "abandoned" | "sealed";
export type SettlementBuildingKind =
  | "housing"
  | "well"
  | "granary"
  | "palisade"
  | "watchtower"
  | "wall"
  | "gatehouse"
  | "barracks"
  | "market"
  | "caravanserai"
  | "forge"
  | "workshop"
  | "apothecary"
  | "temple"
  | "graveyard"
  | "school"
  | "library"
  | "guildhall"
  | "dock";
export type SettlementBuildingCategory =
  | "housing"
  | "food"
  | "water"
  | "defense"
  | "trade"
  | "craft"
  | "medicine"
  | "faith"
  | "knowledge"
  | "governance"
  | "infrastructure";
export type SettlementBuildingStatus = "planned" | "building" | "active" | "damaged" | "ruined";
export type SettlementBuildOrderStatus = "queued" | "building" | "complete" | "blocked";
export type SettlementBorderKind = "hamlet-edge" | "village-edge" | "town-edge" | "city-edge" | "palisade" | "wall" | "district";
export type SettlementBorderStatus = "open" | "watched" | "fortified" | "breached" | "ruined";
export type BuildingServiceKind =
  | "shelter"
  | "rest"
  | "craft"
  | "repair"
  | "medicine"
  | "ritual"
  | "burial"
  | "training"
  | "trade"
  | "governance"
  | "learning"
  | "watch"
  | "travel";
export type AgreementKind =
  | "charter"
  | "lease"
  | "protection"
  | "trade"
  | "debt"
  | "oath"
  | "vassalage"
  | "banishment"
  | "excommunication"
  | "ceasefire";
export type AgreementStatus = "draft" | "active" | "strained" | "breached" | "expired" | "void";
export type TerrainKind = "plains" | "forest" | "marsh" | "hills" | "riverlands" | "ruins";
export type TopographyKind = "basin" | "lowland" | "wetland" | "valley" | "rolling" | "highland" | "ridge" | "plateau" | "cliff" | "mountain";
export type ElevationBand = "low" | "middle" | "high" | "alpine";
export type MediumLayer = "surface" | "underground" | "deep" | "sky";
export type WorldFeatureKind =
  | "ore-vein"
  | "crystal-seam"
  | "salt-pocket"
  | "peat-bed"
  | "mushroom-grotto"
  | "cavern"
  | "crevice"
  | "underground-river"
  | "ancient-vault"
  | "floating-island"
  | "sky-ruin";
export type WorldFeatureStatus = "hidden" | "known" | "claimed" | "depleted" | "sealed";
export type TerrainHoldingKind = "mine" | "outpost" | "underground-fortress" | "cavern-town" | "sky-dock" | "sealed-vault";
export type TerrainHoldingStatus = "building" | "active" | "damaged" | "abandoned";
export type BiomeKey = "sunmeadow" | "blackpine" | "sableFen" | "oldRoad" | "brokenUplands" | "lowMarch";
export type SeasonKind = "spring" | "summer" | "autumn" | "winter";
export type WeatherKind = "clear" | "rain" | "storm" | "fog" | "heatwave" | "snow" | "ashfall" | "aether-wind";
export type WorldSize = "small" | "medium" | "large";
export type LingeringEffectKind = "projectile" | "impact" | "area" | "status-zone" | "charge" | "trail" | "weather-remnant";
export type CulturePracticeId = string;
export type CultureDomain = "warfare" | "survival" | "medicine" | "sorcery" | "craft" | "governance" | "commerce" | "lore";
export type StoryKind = "artifact" | "boss" | "crisis";
export type ArtifactStatus = "hidden" | "rumored" | "claimed";
export type BossStatus = "active" | "defeated";
export type CrisisStatus = "active" | "resolved";
export type CrisisKind = "invasion" | "plague" | "famine" | "curse" | "succession" | "uprising";
export type LegendTone = "dormant" | "glorious" | "merciful" | "sacrificial" | "dread" | "corrupt" | "contested" | "suppressed" | "neglected";
export type LegendOutcome = "claimed" | "redeemed" | "bloodbound" | "slain" | "broken" | "martyred" | "contained" | "suppressed" | "ignored" | "failed";
export type LegendHookKind = "claimant" | "grudge" | "cult" | "revenge" | "pilgrimage" | "scandal" | "succession" | "cure";
export type SocialIntentKind =
  | "survive"
  | "recover"
  | "protect"
  | "gain-renown"
  | "gain-wealth"
  | "learn-magic"
  | "master-craft"
  | "seek-relic"
  | "avenge"
  | "romance"
  | "serve-society"
  | "undermine-rival"
  | "hide-truth"
  | "obey-compulsion";
export type DeceptionOutcome = "truth" | "believed" | "suspected" | "caught" | "realized-late" | "realized-later";
export type InfluenceActionKind = "teach-ability" | "teach-recipe" | "mind-read" | "implant-intent" | "compel";
export type InfluenceSourceKind = "conversation" | "training" | "spell" | "relic" | "authority" | "ritual" | "unknown";
export type ResourcePoolKey = "focus" | "energy" | "battery" | "charge";
export type PowerChannel = "body" | "mana" | "aether" | "mechanical" | "divine" | "chemical";
export type InjurySeverity = "minor" | "moderate" | "severe" | "critical" | "maiming";
export type ScarSeverity = "faint" | "notable" | "deep" | "crippling" | "legendary";
export type BodyLocus =
  | "head"
  | "eye"
  | "ear"
  | "jaw"
  | "neck"
  | "shoulder"
  | "arm"
  | "hand"
  | "torso"
  | "spine"
  | "heart"
  | "lung"
  | "leg"
  | "foot"
  | "skin"
  | "blood"
  | "mind"
  | "soul"
  | "aura"
  | "whole-body"
  | "equipment";
export type AugmentationKind = "prosthetic" | "bionic" | "implant" | "graft" | "arcane-graft" | "exoskeleton" | "powered-armor" | "ward" | "symbiote";
export type AugmentationSource = "medical" | "crafted" | "battlefield" | "arcane" | "alchemical" | "divine" | "precursor" | "demonic" | "natural" | "unknown";
export type AugmentationUpkeepChannel = ResourcePoolKey | "item-cell" | "mana" | "vitality";
export type AugmentationSideEffectKind =
  | "pain"
  | "fatigue"
  | "stress"
  | "instability"
  | "overheat"
  | "mana-burn"
  | "infection"
  | "rejection"
  | "identity-drift"
  | "low-power"
  | "maintenance-debt";
export type AugmentationCompatibilityTag =
  | "organic"
  | "mechanical"
  | "arcane"
  | "aetheric"
  | "divine"
  | "alchemical"
  | "precursor"
  | "prosthetic"
  | "bionic"
  | "armor-linked"
  | "living-tissue"
  | "soulbound"
  | `ancestry:${AncestryKey}`
  | `source:${AugmentationSource}`
  | `slot:${BodyLocus}`
  | `skill:${SkillKey}`
  | `item:${Id}`
  | `custom:${string}`;
export type AugmentationModifierKind = "core-stat" | "derived-stat" | "skill" | "resource" | "resistance" | "power" | "morale" | "fatigue";
export type MaterialPropertyKey = "hardness" | "sharpness" | "conductivity" | "resonance" | "purity" | "volatility";
export type CreatureCategory = "mortal" | "beast" | "demon" | "undead" | "summon" | "otherworldly" | "construct";
export type EncounterKind = "random" | "boss" | "invasion" | "summoning" | "gravebreak" | "resource-guardian";
export type WorldPhaseKind = "normal" | "blood-moon" | "holiday" | "hard-mode" | "eclipse" | "aether-surge";
export type SpecialWorldEventKind = "blood-moon" | "holiday" | "hard-mode-transition" | "resource-bloom" | "boss-stirring" | "summoning-window";
export type WorldEventConsequenceKind = "resource-spawn" | "encounter-pressure" | "settlement-modifier" | "feature-modifier";
export type MoodKind = "steady" | "hopeful" | "inspired" | "fearful" | "angry" | "grim" | "exhausted" | "despairing" | "compelled" | "wounded" | "grieving";
export type MoraleStateKind = "broken" | "shaken" | "strained" | "steady" | "confident" | "zealous";
export type RelationStanceKind = "kin" | "trusted-friend" | "friend" | "ally" | "neutral" | "uneasy" | "suspicious" | "rival" | "enemy";
export type LoyaltyAnchorKind = "person" | "family" | "band" | "organization" | "faction" | "culture" | "compulsion";
export type LoyaltyConflictSeverity = "none" | "low" | "medium" | "high" | "severe";
export type EmotionalGroupKind = "band" | "organization" | "faction" | "family" | "settlement";
export type RemainsKind = "corpse" | "bones" | "ashes" | "unknown";
export type RemainsClaimStatus = "unknown" | "unclaimed" | "claimed";
export type RemainsBurialStatus = "unburied" | "retrieving" | "buried" | "lost";
export type RemainsHauntingStatus = "none" | "restless" | "haunted";

export interface TraitBlock extends Record<TraitKey, number> {}
export interface SkillBlock extends Record<SkillKey, number> {}
export interface CoreStatBlock extends Record<CoreStatKey, number> {}
export interface DerivedStatBlock extends Record<DerivedStatKey, number> {}
export interface IdentityAxes extends Record<IdentityAxisKey, number> {}

export interface StatBlock {
  core: CoreStatBlock;
  derived: DerivedStatBlock;
}

export interface Item {
  id: Id;
  name: string;
  kind: ItemKind;
  quality: ItemQuality;
  material: ItemMaterial;
  techLevel: ItemTechLevel;
  techVariant: ItemTechVariant;
  power: number;
  value: number;
  durability: number;
  maxDurability: number;
  tags: string[];
  effects: ItemEffect[];
  provenance?: ItemProvenance;
  cursed?: boolean;
  sentience?: ItemSentience;
  materialProfile?: MaterialProfile;
  powerCell?: ItemPowerCell;
}

export interface ItemProvenance {
  originKind: ItemOriginKind;
  recipeId?: CraftingRecipeId;
  creatorPersonId?: Id;
  cultureId?: Id;
  settlementId?: Id;
  featureId?: Id;
  createdTick: number;
  ingredients: string[];
  methods: string[];
  story: string;
}

export interface ItemEffect {
  kind: ItemEffectKind;
  target: string;
  magnitude: number;
  chance?: number;
  status?: string;
  abilityId?: AbilityId;
  tags?: string[];
}

export interface ItemMemory {
  id: Id;
  tick: number;
  label: string;
  weight: number;
  tags: string[];
}

export interface ItemSentience {
  name: string;
  desire: ItemDesire;
  willpower: number;
  intelligence: number;
  loyalty: number;
  hunger: number;
  mood: number;
  lastAppeasedTick: number;
  memories: ItemMemory[];
}

export interface Memory {
  id: Id;
  tick: number;
  label: string;
  weight: number;
  tags: string[];
}

export interface AbilityDefinition {
  id: AbilityId;
  name: string;
  kind: AbilityKind;
  target: AbilityTarget;
  effect: AbilityEffect;
  school: AbilitySchool;
  manaCost: number;
  power: number;
  aoe: number;
  tags: string[];
  description: string;
  requirements?: Partial<Record<SkillKey, number>>;
  statRequirements?: Partial<Record<DerivedStatKey, number>>;
}

export interface AbilityStudy {
  abilityId: AbilityId;
  exposure: number;
  attempts: number;
  lastObservedTick: number;
  lastAttemptTick: number;
  affinity: number;
}

export interface CraftingRecipeDefinition {
  id: CraftingRecipeId;
  name: string;
  tier: number;
  difficulty: number;
  outputKind?: ItemKind;
  outputMaterial?: ItemMaterial;
  outputTechLevel?: ItemTechLevel;
  outputTechVariant?: ItemTechVariant;
  qualityFloor: ItemQuality;
  requiredSkills?: Partial<Record<SkillKey, number>>;
  requiredStats?: Partial<Record<DerivedStatKey, number>>;
  ingredients: string[];
  methods: string[];
  siteTags: string[];
  risks: string[];
  tags: string[];
  description: string;
}

export interface RecipeStudy {
  recipeId: CraftingRecipeId;
  exposure: number;
  attempts: number;
  lastObservedTick: number;
  lastAttemptTick: number;
  affinity: number;
}

export interface CulturePracticeDefinition {
  id: CulturePracticeId;
  name: string;
  domain: CultureDomain;
  tier: number;
  cost: number;
  requires: CulturePracticeId[];
  tags: string[];
  description: string;
  effects: Partial<Record<"prosperity" | "defense" | "stability" | "learning" | "birthRate" | "magic" | "medicine" | "travel", number>>;
}

export interface CultureResearch {
  practiceId: CulturePracticeId;
  progress: number;
}

export interface CultureState {
  id: Id;
  name: string;
  societyId: Id;
  level: number;
  cohesion: number;
  tradition: number;
  values: Partial<Record<IdentityAxisKey, number>>;
  completedPracticeIds: CulturePracticeId[];
  knownRecipeIds: CraftingRecipeId[];
  parentCultureIds: Id[];
  ancestryWeights: Partial<Record<AncestryKey, number>>;
  research: CultureResearch;
}

export interface StoryArtifact {
  id: Id;
  name: string;
  locationId: Id;
  status: ArtifactStatus;
  power: number;
  fame: number;
  attunement: number;
  corruption: number;
  tone: LegendTone;
  legend: string;
  tags: string[];
  history: LegendMutation[];
  hooks: LegendHook[];
  holderPersonId?: Id;
  guardedByBossId?: Id;
  birthrightCultureIds?: Id[];
  birthrightFamilyName?: string;
  birthrightAncestry?: AncestryKey;
  resonantPersonId?: Id;
}

export interface StoryBoss {
  id: Id;
  name: string;
  locationId: Id;
  status: BossStatus;
  power: number;
  threat: number;
  dread: number;
  following: number;
  legacy: LegendTone;
  desire: string;
  tags: string[];
  history: LegendMutation[];
  hooks: LegendHook[];
  guardingArtifactId?: Id;
  lastSpawnTick: number;
}

export interface StoryCrisis {
  id: Id;
  name: string;
  kind: CrisisKind;
  locationId: Id;
  factionId: Id;
  status: CrisisStatus;
  severity: number;
  progress: number;
  publicTrust: number;
  radicalization: number;
  myth: LegendTone;
  tags: string[];
  history: LegendMutation[];
  hooks: LegendHook[];
  lastPulseTick: number;
}

export interface LegendHook {
  id: Id;
  kind: LegendHookKind;
  pressure: number;
  text: string;
  questKind: QuestKind;
  locationId: Id;
  createdTick: number;
}

export interface LegendMutation {
  id: Id;
  tick: number;
  day: number;
  outcome: LegendOutcome;
  tone: LegendTone;
  actorBandId?: Id;
  actorPersonId?: Id;
  text: string;
}

export interface SocialIntent {
  id: Id;
  kind: SocialIntentKind;
  text: string;
  targetPersonId?: Id;
  targetFactionId?: Id;
  targetLocationId?: Id;
  strength: number;
  secrecy: number;
  createdTick: number;
  tags: string[];
}

export interface DeceptionRecord {
  id: Id;
  tick: number;
  speakerId: Id;
  listenerId: Id;
  declaredText: string;
  hiddenText: string;
  outcome: DeceptionOutcome;
  suspicionDelta: number;
  trustDelta?: number;
  liarScore?: number;
  detectorScore?: number;
  margin?: number;
  reason?: string;
  laterRealizationTick?: number;
  realizedTick?: number;
}

export interface MindCompulsion {
  sourceId?: Id;
  sourceKind: "spell" | "relic" | "curse" | "authority" | "unknown";
  intent: SocialIntent;
  strength: number;
  remainingTicks: number;
  detectedByPersonIds: Id[];
}

export interface ImplantedIntent {
  id: Id;
  sourcePersonId?: Id;
  sourceKind: InfluenceSourceKind;
  intent: SocialIntent;
  strength: number;
  secrecy: number;
  remainingTicks: number;
  createdTick: number;
  detectedByPersonIds: Id[];
  tags: string[];
}

export interface InfluenceCheckResult {
  kind: InfluenceActionKind;
  success: boolean;
  margin: number;
  sourcePersonId?: Id;
  targetPersonId?: Id;
  exposureDelta?: number;
  affinityDelta?: number;
  detected?: boolean;
  learned?: boolean;
  notes: string[];
}

export interface MindReadInsight {
  readerId: Id;
  targetId: Id;
  tick: number;
  clarity: number;
  margin: number;
  detected: boolean;
  surfaceIntent: SocialIntent;
  hiddenIntent?: SocialIntent;
  compulsion?: MindCompulsion;
  implantedIntentIds: Id[];
  notes: string[];
}

export interface ResourcePool {
  current: number;
  max: number;
  regenPerTick: number;
  tags: string[];
}

export interface PersonResourceState {
  focus: ResourcePool;
  energy: ResourcePool;
  charge: ResourcePool;
  battery?: ResourcePool;
  lastUpdatedTick: number;
}

export interface InjuryRecord {
  id: Id;
  label: string;
  locus: BodyLocus;
  severity: InjurySeverity;
  burden: number;
  pain: number;
  mobilityPenalty: number;
  createdTick: number;
  source?: string;
  remainingTicks?: number;
  permanent?: boolean;
  tags: string[];
}

export interface ScarRecord {
  id: Id;
  label: string;
  locus: BodyLocus;
  severity: ScarSeverity;
  burden: number;
  createdTick: number;
  fromInjuryId?: Id;
  memoryId?: Id;
  tags: string[];
}

export interface AugmentationSideEffect {
  kind: AugmentationSideEffectKind;
  magnitude: number;
  threshold?: number;
  tags: string[];
}

export interface AugmentationModifier {
  kind: AugmentationModifierKind;
  target: string;
  magnitude: number;
  requiresPower?: boolean;
  tags: string[];
}

export interface AugmentationUpkeep {
  channel: AugmentationUpkeepChannel;
  amount: number;
  itemId?: Id;
  required: boolean;
  intervalTicks?: number;
  lastPaidTick?: number;
  tags: string[];
}

export interface AugmentationRecord {
  id: Id;
  name: string;
  kind: AugmentationKind;
  source: AugmentationSource;
  locus: BodyLocus;
  installedTick: number;
  condition: number;
  maxCondition: number;
  powered: boolean;
  active: boolean;
  effects: AugmentationModifier[];
  sideEffects: AugmentationSideEffect[];
  compatibilityTags: AugmentationCompatibilityTag[];
  incompatibleTags?: AugmentationCompatibilityTag[];
  upkeep?: AugmentationUpkeep;
  replacedInjuryIds?: Id[];
  itemId?: Id;
  tags: string[];
}

export interface RemainsRecord {
  id: Id;
  kind: RemainsKind;
  personId?: Id;
  personName: string;
  factionId?: Id;
  cultureId?: Id;
  ancestry?: AncestryKey;
  locationId?: Id;
  mediumRegionId?: Id;
  x?: number;
  y?: number;
  deathTick: number;
  createdTick: number;
  discoveredTick?: number;
  claimStatus: RemainsClaimStatus;
  burialStatus: RemainsBurialStatus;
  hauntingStatus: RemainsHauntingStatus;
  claimedByPersonId?: Id;
  claimedByFactionId?: Id;
  burialLocationId?: Id;
  graveyardAssetId?: Id;
  retrievalPriority: number;
  tags: string[];
}

export interface ItemPowerCell {
  channel: PowerChannel;
  charge: number;
  capacity: number;
  drainPerUse: number;
  rechargePerTick: number;
  stable: boolean;
  tags: string[];
}

export interface MaterialProfile {
  hardness: number;
  sharpness: number;
  conductivity: number;
  resonance: number;
  purity: number;
  volatility: number;
  tags: string[];
}

export interface MaterialItemAdjustments {
  powerDelta: number;
  durabilityDelta: number;
  valueMultiplier: number;
  effectTags: string[];
}

export interface CreatureCategoryProfile {
  category: CreatureCategory;
  threatBias: number;
  moralePressure: number;
  resourceAffinity: string[];
  tags: string[];
}

export interface EncounterDefinition {
  id: Id;
  kind: EncounterKind;
  category: CreatureCategory;
  name: string;
  danger: number;
  locationId?: Id;
  factionId?: Id;
  tags: string[];
}

export interface WorldEventConsequence {
  kind: WorldEventConsequenceKind;
  magnitude: number;
  locationId?: Id;
  featureId?: Id;
  resource?: string;
  encounterKind?: EncounterKind;
  category?: CreatureCategory;
  tags: string[];
}

export interface SpecialWorldEventState {
  id: Id;
  kind: SpecialWorldEventKind;
  name: string;
  phase: WorldPhaseKind;
  startTick: number;
  remainingTicks: number;
  intensity: number;
  locationId?: Id;
  consequences: WorldEventConsequence[];
  tags: string[];
}

export interface WorldPhaseState {
  current: WorldPhaseKind;
  previous?: WorldPhaseKind;
  changedTick: number;
  hardMode: boolean;
  tags: string[];
}

export interface LegalEntityRef {
  kind: LegalEntityKind;
  id: Id;
}

export interface StressResolveState {
  stress: number;
  resolve: number;
  stressDrift: number;
  resolveDrift: number;
  pressure: number;
  recovery: number;
  tags: string[];
}

export interface PersonEmotionalState {
  mood: MoodKind;
  moraleState: MoraleStateKind;
  valence: number;
  arousal: number;
  stress: StressResolveState;
  updatedTick: number;
  drivers: string[];
}

export interface RelationStance {
  targetPersonId: Id;
  stance: RelationStanceKind;
  affinity: number;
  friendship: number;
  rivalry: number;
  trust: number;
  suspicion: number;
  membershipOverlap: Id[];
  familyOverlap: boolean;
  bandOverlap: boolean;
  tags: string[];
}

export interface LoyaltyAnchor {
  kind: LoyaltyAnchorKind;
  id: Id;
  label: string;
  strength: number;
  pressure: number;
  obligation: number;
  public: boolean;
  tags: string[];
}

export interface LoyaltyConflict {
  id: Id;
  primary: LoyaltyAnchor;
  competing: LoyaltyAnchor;
  pressure: number;
  severity: LoyaltyConflictSeverity;
  reasons: string[];
}

export interface PersonLoyaltyState {
  anchors: LoyaltyAnchor[];
  conflicts: LoyaltyConflict[];
  pressure: number;
  primaryAnchor?: LoyaltyAnchor;
  updatedTick: number;
  tags: string[];
}

export interface GroupEmotionalClimate {
  groupKind: EmotionalGroupKind;
  groupId: Id;
  memberCount: number;
  mood: MoodKind;
  moraleState: MoraleStateKind;
  averageValence: number;
  averageStress: number;
  averageResolve: number;
  averageMorale: number;
  cohesion: number;
  conflictPressure: number;
  dominantDrivers: string[];
  atRiskPersonIds: Id[];
  updatedTick: number;
  tags: string[];
}

export interface GroupOutlook {
  identity: Partial<IdentityAxes>;
  priorities: string[];
  taboos: string[];
  reputation: number;
  cohesion: number;
  legitimacy: number;
  secrecy: number;
  emotionalClimate?: GroupEmotionalClimate;
}

export interface PersonMembership {
  organizationId: Id;
  role: MembershipRole;
  status: MembershipStatus;
  loyalty: number;
  influence: number;
  obligation: number;
  joinedTick: number;
  public: boolean;
}

export interface Organization {
  id: Id;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  factionId?: Id;
  cultureId?: Id;
  homeSettlementId?: Id;
  leaderPersonId?: Id;
  memberIds: Id[];
  assetIds: Id[];
  agreementIds: Id[];
  wealth: number;
  influence: number;
  outlook: GroupOutlook;
  tags: string[];
  foundedTick: number;
}

export type InterestGroup = Organization;

export interface Asset {
  id: Id;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  owner: LegalEntityRef;
  operator: LegalEntityRef;
  locationId?: Id;
  agreementId?: Id;
  value: number;
  integrity: number;
  outputTags: string[];
  tags: string[];
  foundedTick: number;
}

export interface Agreement {
  id: Id;
  name: string;
  kind: AgreementKind;
  status: AgreementStatus;
  parties: LegalEntityRef[];
  assetIds: Id[];
  locationId?: Id;
  terms: string[];
  value: number;
  pressure: number;
  signedTick: number;
  expiresTick?: number;
  tags: string[];
}

export interface SocialMind {
  ambitions: SocialIntent[];
  ambition: SocialIntent;
  currentIntent: SocialIntent;
  declaredIntent: SocialIntent;
  hiddenIntent?: SocialIntent;
  suspicionByPersonId: Record<Id, number>;
  trustByPersonId: Record<Id, number>;
  deceptionHistory: DeceptionRecord[];
  compulsion?: MindCompulsion;
  implantedIntents?: ImplantedIntent[];
  lastConversationTick: number;
}

export interface StoryState {
  artifacts: Record<Id, StoryArtifact>;
  bosses: Record<Id, StoryBoss>;
  crises: Record<Id, StoryCrisis>;
}

export interface Person {
  id: Id;
  name: string;
  familyName: string;
  age: number;
  title: string;
  factionId: Id;
  cultureId: Id;
  birthCultureId: Id;
  fosterCultureId?: Id;
  heritageCultureIds: Id[];
  cultureBlend: number;
  adoptionStatus: AdoptionStatus;
  guardianIds: Id[];
  ancestry: AncestryKey;
  ancestryLineage: AncestryKey[];
  locationId: Id;
  parentIds: Id[];
  childIds: Id[];
  generation: number;
  bandId?: Id;
  alive: boolean;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  fatigue: number;
  morale: number;
  renown: number;
  gold: number;
  role: "leader" | "fighter" | "healer" | "mage" | "scout" | "commoner";
  archetype: ArchetypeKey;
  stats: StatBlock;
  traits: TraitBlock;
  skills: SkillBlock;
  identity: IdentityAxes;
  abilityIds: AbilityId[];
  abilityStudy: Record<AbilityId, AbilityStudy>;
  recipeIds: CraftingRecipeId[];
  recipeStudy: Record<CraftingRecipeId, RecipeStudy>;
  inventory: Item[];
  equipment: {
    weapon?: Item;
    armor?: Item;
    trinket?: Item;
  };
  relations: Record<Id, number>;
  memories: Memory[];
  status: string[];
  memberships?: PersonMembership[];
  social?: SocialMind;
  resources?: PersonResourceState;
  injuries?: InjuryRecord[];
  scars?: ScarRecord[];
  augmentations?: AugmentationRecord[];
  emotionalState?: PersonEmotionalState;
  relationStances?: Record<Id, RelationStance>;
  loyalty?: PersonLoyaltyState;
  buildingId?: Id;
  localTileId?: Id;
  currentService?: BuildingServiceKind;
}

export interface Band {
  id: Id;
  name: string;
  leaderId: Id;
  memberIds: Id[];
  locationId: Id;
  travel?: TravelState;
  purpose: BandPurpose;
  cohesion: number;
  supplies: number;
  notoriety: number;
  currentQuestId?: Id;
  goal: string;
  localTileId?: Id;
  localTileProgress?: number;
  emotionalClimate?: GroupEmotionalClimate;
}

export interface TravelState {
  originId: Id;
  destinationId: Id;
  routeId: Id;
  progress: number;
  total: number;
  purpose: "quest" | "patrol" | "relocate";
  questId?: Id;
}

export interface Faction {
  id: Id;
  name: string;
  kind: FactionKind;
  cultureId: Id;
  color: string;
  capitalId: Id;
  wealth: number;
  stability: number;
  military: number;
  magic: number;
  relations: Record<Id, number>;
  activeWars: Id[];
}

export interface SettlementBuildingFootprint {
  tileIds: Id[];
  width: number;
  height: number;
  anchorQ: number;
  anchorR: number;
  layer: MediumLayer;
}

export interface SettlementBuildingService {
  kind: BuildingServiceKind;
  capacity: number;
  quality: number;
  occupantIds: Id[];
  lastSimulatedTick: number;
  cadenceTicks: number;
  tags: string[];
}

export interface SettlementBuilding {
  id: Id;
  catalogId: SettlementBuildingKind;
  kind: SettlementBuildingKind;
  category: SettlementBuildingCategory;
  name: string;
  status: SettlementBuildingStatus;
  level: number;
  integrity: number;
  progress: number;
  upkeep: number;
  builtTick: number;
  tags: string[];
  footprint?: SettlementBuildingFootprint;
  occupantIds?: Id[];
  services?: SettlementBuildingService[];
  lastServiceTick?: number;
}

export interface SettlementBuildOrder {
  id: Id;
  catalogId: SettlementBuildingKind;
  kind: SettlementBuildingKind;
  category: SettlementBuildingCategory;
  name: string;
  status: SettlementBuildOrderStatus;
  priority: number;
  pressure: number;
  reason: string;
  progress: number;
  laborRequired: number;
  laborInvested: number;
  cost: number;
  createdTick: number;
  startedTick?: number;
  completedTick?: number;
  tags: string[];
}

export interface SettlementBorder {
  id: Id;
  kind: SettlementBorderKind;
  name: string;
  radius: number;
  integrity: number;
  coverage: number;
  gateCount: number;
  status: SettlementBorderStatus;
  tags: string[];
}

export interface Settlement {
  id: Id;
  name: string;
  region: string;
  mediumRegionId: Id;
  sectorId: Id;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  topography: TopographyKind;
  elevationMeters: number;
  elevationBand: ElevationBand;
  factionId: Id;
  x: number;
  y: number;
  population: number;
  prosperity: number;
  defense: number;
  unrest: number;
  threat: number;
  resources: string[];
  flora: string[];
  fauna: string[];
  localThreats: string[];
  tags: string[];
  buildings?: SettlementBuilding[];
  borders?: SettlementBorder[];
  buildOrders?: SettlementBuildOrder[];
}

export interface BiomeProfile {
  id: BiomeKey;
  name: string;
  terrain: TerrainKind;
  color: string;
  hazardBonus: number;
  travelCostBonus: number;
  threats: string[];
  resources: string[];
  loot: string[];
  questHooks: string[];
}

export interface MediumRegion {
  id: Id;
  name: string;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  topography: TopographyKind;
  elevationMin: number;
  elevationMax: number;
  elevationAvg: number;
  elevationBand: ElevationBand;
  hazard: number;
  travelCost: number;
  passDifficulty: number;
  resources: string[];
  flora: string[];
  fauna: string[];
  threats: string[];
  settlementIds: Id[];
  color: string;
}

export interface TravelRoute {
  id: Id;
  fromId: Id;
  toId: Id;
  distance: number;
  danger: number;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  topography: TopographyKind;
  elevationBand: ElevationBand;
  elevationGain: number;
  slopeGrade: number;
  passDifficulty: number;
}

export interface WorldFeature {
  id: Id;
  name: string;
  kind: WorldFeatureKind;
  layer: MediumLayer;
  status: WorldFeatureStatus;
  regionId: Id;
  nearestSettlementId: Id;
  biomeId: BiomeKey;
  topography: TopographyKind;
  elevationBand: ElevationBand;
  depthMeters: number;
  altitudeMeters: number;
  richness: number;
  danger: number;
  stability: number;
  exploration: number;
  depletion: number;
  resources: string[];
  flora: string[];
  fauna: string[];
  threats: string[];
  tags: string[];
  ownerFactionId?: Id;
  holdingId?: Id;
}

export interface TerrainHolding {
  id: Id;
  name: string;
  kind: TerrainHoldingKind;
  status: TerrainHoldingStatus;
  featureId: Id;
  factionId: Id;
  level: number;
  integrity: number;
  workers: number;
  garrison: number;
  stockpile: number;
  outputResource: string;
}

export interface Territory {
  id: Id;
  name: string;
  factionId: Id;
  capitalId: Id;
  settlementIds: Id[];
  regionIds: Id[];
  borderSettlementIds: Id[];
  claimStrength: number;
  cohesion: number;
  unrest: number;
  borderPressure: number;
  contestedBy: Record<Id, number>;
  tags: string[];
}

export interface WeatherFront {
  id: Id;
  regionId: Id;
  kind: WeatherKind;
  intensity: number;
  remainingTicks: number;
  travelPenalty: number;
  threatModifier: number;
  resourceModifier: number;
  tags: string[];
}

export interface WeatherSystem {
  season: SeasonKind;
  fronts: Record<Id, WeatherFront>;
  nextSeasonTick: number;
}

export interface WorldGenConfig {
  size: WorldSize;
  continents: number;
  landmass: number;
  ocean: number;
  climate: number;
}

export interface Continent {
  id: Id;
  name: string;
  x: number;
  y: number;
  radius: number;
  humidity: number;
  temperature: number;
  settlementIds: Id[];
  dominantBiomeIds: BiomeKey[];
}

export interface OceanBody {
  id: Id;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  danger: number;
  knownCrossingCultureIds: Id[];
}

export interface OverworldTile {
  id: Id;
  sectorId: Id;
  q: number;
  r: number;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  elevationBand: ElevationBand;
  layer: MediumLayer;
  passability: number;
  danger: number;
  resourceHints: string[];
  featureIds: Id[];
  tags: string[];
}

export interface WorldSector {
  id: Id;
  q: number;
  r: number;
  x: number;
  y: number;
  kind: "continent" | "coast" | "ocean" | "island";
  continentId?: Id;
  oceanId?: Id;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  elevationBand: ElevationBand;
  humidity: number;
  temperature: number;
  settlementIds: Id[];
  tileIds: Id[];
  tags: string[];
}

export interface WorldGeography {
  continents: Continent[];
  oceans: OceanBody[];
  sectors: Record<Id, WorldSector>;
  tiles: Record<Id, OverworldTile>;
}

export interface LingeringEffect {
  id: Id;
  kind: LingeringEffectKind;
  name: string;
  layer: MediumLayer;
  locationId?: Id;
  routeId?: Id;
  originLocationId?: Id;
  targetLocationId?: Id;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  progress: number;
  durationTicks: number;
  remainingTicks: number;
  radius: number;
  intensity: number;
  color: string;
  actorIds: Id[];
  factionIds: Id[];
  tags: string[];
}

export interface PlanetMedium {
  id: Id;
  name: string;
  kind: "planet";
  radiusKm: number;
  climate: string;
  dayLengthHours: number;
  biomes: Record<BiomeKey, BiomeProfile>;
  regions: Record<Id, MediumRegion>;
  routes: Record<Id, TravelRoute>;
  features: Record<Id, WorldFeature>;
  holdings: Record<Id, TerrainHolding>;
}

export interface Quest {
  id: Id;
  title: string;
  kind: QuestKind;
  issuerFactionId: Id;
  locationId: Id;
  targetFactionId?: Id;
  danger: number;
  rewardGold: number;
  rewardRenown: number;
  urgency: number;
  progress: number;
  status: "open" | "active" | "succeeded" | "failed" | "expired";
  assignedBandId?: Id;
  storyKind?: StoryKind;
  storyId?: Id;
  summary: string;
}

export interface ChronicleEvent {
  id: Id;
  tick: number;
  day: number;
  kind: EventKind;
  severity: "low" | "medium" | "high";
  actorIds: Id[];
  factionIds: Id[];
  locationId?: Id;
  text: string;
}

export interface Doctrine {
  targetPolicy: "weakest" | "casters" | "leaders" | "spread";
  healBelow: number;
  aoeAt: number;
  spendConsumables: "sparingly" | "balanced" | "freely";
  retreatBelow: number;
  riskStance: "cautious" | "balanced" | "bold";
  preferredQuest: QuestKind | "any";
}

export interface DeityState {
  favoredBandId: Id;
  watchedPersonIds: Id[];
  omen: QuestKind | "none";
  blessingByPersonId: Record<Id, number>;
}

export interface DecisionScore {
  action: string;
  score: number;
  reason: string;
}

export interface World {
  version: 1;
  seedName: string;
  rngState: number;
  tick: number;
  day: number;
  persons: Record<Id, Person>;
  bands: Record<Id, Band>;
  factions: Record<Id, Faction>;
  cultures: Record<Id, CultureState>;
  organizations?: Record<Id, Organization>;
  assets?: Record<Id, Asset>;
  agreements?: Record<Id, Agreement>;
  remains?: Record<Id, RemainsRecord>;
  story: StoryState;
  settlements: Record<Id, Settlement>;
  territories: Record<Id, Territory>;
  weather: WeatherSystem;
  generation: WorldGenConfig;
  geography: WorldGeography;
  lingeringEffects: Record<Id, LingeringEffect>;
  planet: PlanetMedium;
  quests: Record<Id, Quest>;
  events: ChronicleEvent[];
  doctrine: Doctrine;
  deity: DeityState;
  worldPhase?: WorldPhaseState;
  specialEvents?: Record<Id, SpecialWorldEventState>;
  encounterPressure?: Partial<Record<EncounterKind, number>>;
  selectedPersonId: Id;
  selectedBandId: Id;
  lastDecisionScores: DecisionScore[];
}
