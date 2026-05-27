import type { BandPurpose, BiomeKey, BiomeProfile, FactionKind, ItemKind, QuestKind, SkillKey } from "../types";

export const givenNames = [
  "Arel",
  "Bran",
  "Cerys",
  "Dain",
  "Elo",
  "Farah",
  "Garric",
  "Hale",
  "Iona",
  "Jorren",
  "Kael",
  "Lysa",
  "Marek",
  "Niva",
  "Orin",
  "Petra",
  "Quill",
  "Runa",
  "Sable",
  "Tovan",
  "Uri",
  "Vessa",
  "Wren",
  "Yara"
];

export const familyNames = [
  "Ashen",
  "Briar",
  "Cairn",
  "Dusk",
  "Ember",
  "Fen",
  "Gale",
  "Harrow",
  "Irons",
  "Kest",
  "Lorn",
  "Mire",
  "Noon",
  "Orchard",
  "Pale",
  "Quarry",
  "Rill",
  "Stern",
  "Thorn",
  "Vale"
];

export const settlementNames = [
  "Greyford",
  "Mistwick",
  "Redwater",
  "Oathhill",
  "Thistle Gate",
  "Marrowfen",
  "Eldergrove",
  "Cinderwatch"
];

export const regions = [
  "The Low March",
  "Blackpine Reach",
  "The Old Road",
  "Sable Fen",
  "The Broken Uplands"
];

export const factionRoots: { name: string; kind: FactionKind; color: string }[] = [
  { name: "Barony of Alder", kind: "barony", color: "#b96f3a" },
  { name: "Covenant of the Veil", kind: "cult", color: "#7d8f5b" },
  { name: "Lantern Freeholds", kind: "freehold", color: "#c6a64d" },
  { name: "Ironledger Guild", kind: "guild", color: "#8f9aa3" },
  { name: "Wolfmark Clans", kind: "clan", color: "#9a4b46" }
];

export const purposes: BandPurpose[] = ["adventuring", "raiding", "guarding", "pilgrimage", "rebellion"];

export const questTemplates: Record<QuestKind, string[]> = {
  defense: [
    "Hold the palisade before the next moonrise",
    "Drive off raiders gathering near the farms",
    "Guard the granary while unrest spreads"
  ],
  delve: [
    "Open the sealed stair under the old shrine",
    "Recover relics from a drowned crypt",
    "Map the lower vault before the dead wake"
  ],
  hunt: [
    "Track the ash-warg stalking the road",
    "Find the oathbreaker hiding among the stones",
    "Kill the fever-spider in the mill tunnels"
  ],
  escort: [
    "Carry medicine through hostile passes",
    "Escort witnesses to the moot",
    "Guide a caravan past hungry deserters"
  ],
  politics: [
    "Expose the hand behind a border feud",
    "Negotiate passage with a bitter rival house",
    "Stop a succession riot before it hardens"
  ]
};

export const questKindLabels: Record<QuestKind, string> = {
  defense: "Defense",
  delve: "Delve",
  hunt: "Hunt",
  escort: "Escort",
  politics: "Politics"
};

export const itemRoots: Record<ItemKind, string[]> = {
  weapon: ["hooked spear", "moon-iron sabre", "blackwood bow", "oath axe", "silvered knife"],
  armor: ["boiled leather coat", "ringmail shirt", "sunmarked shield", "lamellar vest", "grave helm"],
  trinket: ["foxbone charm", "amber lens", "saint's bead", "storm knot", "river coin"],
  consumable: ["bitter tonic", "smoke bomb", "warding salt", "bloodmoss poultice", "spark vial"],
  relic: ["bell of second dawn", "crown shard", "sleepless idol", "verdant nail", "mirror tooth"],
  supply: ["travel rations", "lamp oil", "rope bundle", "clean bandages", "iron spikes"]
};

export const biomeProfiles: Record<BiomeKey, BiomeProfile> = {
  sunmeadow: {
    id: "sunmeadow",
    name: "Sunmeadow Downs",
    terrain: "plains",
    color: "#c6a64d",
    hazardBonus: 4,
    travelCostBonus: 0,
    threats: ["thorn jackals", "bandit gleaners", "locust sprites", "dry-grass revenants"],
    resources: ["sungrain", "wild flax", "amber honey", "white clay"],
    loot: ["sungrain cakes", "amber honey seal", "flax-wrapped charm", "white-clay ward"],
    questHooks: ["harvest shrines", "open grass roads", "old boundary stones"]
  },
  blackpine: {
    id: "blackpine",
    name: "Blackpine Reach",
    terrain: "forest",
    color: "#4f7a53",
    hazardBonus: 15,
    travelCostBonus: 0.18,
    threats: ["moss wolves", "bark witches", "rootbound dead", "needle archers"],
    resources: ["blackpine resin", "ironwood", "shadecap mushrooms", "green amber"],
    loot: ["resin-sealed charm", "ironwood haft", "shadecap tonic", "green amber lens"],
    questHooks: ["old logging roads", "root-choked shrines", "watchful tree lines"]
  },
  sableFen: {
    id: "sableFen",
    name: "Sable Fen",
    terrain: "marsh",
    color: "#617a6b",
    hazardBonus: 21,
    travelCostBonus: 0.32,
    threats: ["bog ghouls", "lamp eels", "fen hags", "mud-crowned deserters"],
    resources: ["bog iron", "sour reeds", "moonmilk", "black peat"],
    loot: ["bog-iron rivets", "moonmilk draught", "reed mask", "peat-blackened relic"],
    questHooks: ["sinking causeways", "reed-choked graves", "lanternless crossings"]
  },
  oldRoad: {
    id: "oldRoad",
    name: "The Old Road",
    terrain: "ruins",
    color: "#8f7f8f",
    hazardBonus: 24,
    travelCostBonus: 0.38,
    threats: ["oathless legionaries", "mirror wights", "road saints", "glass-fed spiders"],
    resources: ["relic glass", "road silver", "saint ash", "old mortar"],
    loot: ["relic-glass shard", "road-silver clasp", "saint-ash vial", "mortar-marked tablet"],
    questHooks: ["collapsed milestones", "buried waystations", "saint roads"]
  },
  brokenUplands: {
    id: "brokenUplands",
    name: "Broken Uplands",
    terrain: "hills",
    color: "#9a7c55",
    hazardBonus: 16,
    travelCostBonus: 0.24,
    threats: ["crag ogres", "stone kites", "cairn bandits", "storm-bitten goats"],
    resources: ["storm quartz", "copper bloom", "goat wool", "sky salt"],
    loot: ["storm-quartz focus", "copper-bloom buckle", "sky-salt packet", "wool-lined mantle"],
    questHooks: ["knife-edged passes", "cairn fields", "storm shelves"]
  },
  lowMarch: {
    id: "lowMarch",
    name: "The Low March",
    terrain: "riverlands",
    color: "#5d8b91",
    hazardBonus: 9,
    travelCostBonus: 0.08,
    threats: ["river raiders", "flood cultists", "silt serpents", "toll ghosts"],
    resources: ["river pearls", "blue rushes", "eel oil", "salt fish"],
    loot: ["river-pearl button", "blue-rush bandage", "eel-oil flask", "salt-fish ration"],
    questHooks: ["ford markets", "flooded shrines", "toll bridges"]
  }
};

export const skillLabels: Record<SkillKey, string> = {
  blade: "Blade",
  ward: "Ward",
  sorcery: "Sorcery",
  medicine: "Medicine",
  survival: "Survival",
  diplomacy: "Diplomacy",
  command: "Command"
};
