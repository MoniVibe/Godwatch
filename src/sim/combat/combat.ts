import { event } from "../chronicle/events";
import {
  attemptObservedAbilityLearning,
  bestKnownAbility,
  getAbility,
  observeAbilityUse,
  partyAbilityBonus
} from "../abilities/compendium";
import { ensureItem, itemEffectBonus, useConsumable } from "../economy/items";
import { biomeAtSettlement } from "../environment/planet";
import { shiftIdentity } from "../individuals/identity";
import { addMemory, adjustTrait, ensureBandLeader, livingMembers, personPower } from "../individuals/people";
import { addCombatEffect } from "../world/effects";
import { average, clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type { AbilityDefinition, AbilityId, Band, Doctrine, Person, Quest, World } from "../types";

interface Enemy {
  name: string;
  role: "brute" | "caster" | "leader" | "skirmisher";
  hp: number;
  attack: number;
  mana: number;
  abilityId?: AbilityId;
}

function buildEnemies(world: World, quest: Quest, rng: Rng): Enemy[] {
  const count = clamp(Math.ceil(quest.danger / 28) + rng.int(0, 2), 1, 6);
  const settlement = world.settlements[quest.locationId];
  const biome = biomeAtSettlement(world, quest.locationId);
  const localThreats = settlement.localThreats.length ? settlement.localThreats : biome.threats;
  const roots = {
    defense: ["raider", "deserter", "wolfmarked torchbearer"],
    delve: ["bone knight", "crypt leech", "hollow acolyte"],
    hunt: ["ash-warg", "fever-spider", "oathbreaker"],
    escort: ["road cutter", "hungry mercenary", "black-feather scout"],
    politics: ["knife envoy", "masked duelist", "riot captain"]
  };
  const threatRoots = [...localThreats, ...roots[quest.kind]];
  const enemies: Enemy[] = [];
  for (let index = 0; index < count; index += 1) {
    const role = rng.weighted<Enemy["role"]>([
      { value: "brute", weight: 5 },
      { value: "skirmisher", weight: 4 },
      { value: "caster", weight: quest.kind === "delve" || quest.kind === "politics" ? 3 : 1 },
      { value: "leader", weight: index === 0 && quest.danger > 54 ? 2 : 0 }
    ]);
    enemies.push({
      name: `${role === "leader" ? "veteran " : role === "caster" ? "hexing " : ""}${rng.pick(threatRoots)}`,
      role,
      hp: Math.round(22 + quest.danger * 0.8 + biome.hazardBonus * 0.25 + rng.int(-8, 18) + (role === "leader" ? 28 : 0)),
      attack: Math.round(8 + quest.danger * 0.22 + biome.hazardBonus * 0.08 + (role === "caster" ? 5 : 0) + (role === "leader" ? 7 : 0)),
      mana: role === "caster" ? rng.int(18, 42) : role === "leader" ? rng.int(4, 16) : 0,
      abilityId:
        role === "caster"
          ? rng.pick(["hex-of-ash", "wither-mark", quest.danger > 58 ? "grave-command" : "ember-arc"] as const)
          : role === "leader" && rng.chance(0.35)
            ? "battle-cry"
            : undefined
    });
  }
  return enemies;
}

function pickEnemy(enemies: Enemy[], policy: Doctrine["targetPolicy"], rng: Rng): Enemy {
  const living = enemies.filter((enemy) => enemy.hp > 0);
  if (policy === "weakest") {
    return living.sort((a, b) => a.hp - b.hp)[0];
  }
  if (policy === "casters") {
    return living.find((enemy) => enemy.role === "caster") ?? living.sort((a, b) => a.hp - b.hp)[0];
  }
  if (policy === "leaders") {
    return living.find((enemy) => enemy.role === "leader") ?? living[0];
  }
  return rng.pick(living);
}

function strongestHealer(members: Person[]): Person | undefined {
  return members
    .filter((member) => member.alive && Boolean(bestReadyAbility(member, (ability) => ability.effect === "heal")))
    .sort((a, b) => b.skills.medicine + b.skills.sorcery * 0.3 - (a.skills.medicine + a.skills.sorcery * 0.3))[0];
}

function bestReadyAbility(person: Person, predicate: (ability: AbilityDefinition) => boolean): AbilityDefinition | undefined {
  return bestKnownAbility(person, (ability) => person.mana >= ability.manaCost && predicate(ability));
}

function recordObservedUse(
  world: World,
  witnesses: Person[],
  casterId: string | undefined,
  ability: AbilityDefinition,
  rng: Rng,
  learningNotes: string[]
): void {
  for (const witness of witnesses) {
    if (!witness.alive || witness.id === casterId) {
      continue;
    }
    const study = observeAbilityUse(witness, ability.id, world.tick, rng);
    if (!study) {
      continue;
    }
    const attemptChance = clamp((study.exposure + Math.max(0, study.affinity)) / 210, 0.05, 0.72);
    if (!rng.chance(attemptChance)) {
      continue;
    }
    const learned = attemptObservedAbilityLearning(witness, rng, world.tick);
    if (learned) {
      addMemory(witness, world, `Learned ${learned.name} by watching it used`, 6, ["ability", "observation", learned.school]);
      learningNotes.push(`${witness.name} learns ${learned.name} by watching.`);
    }
  }
}

export function simulateCombat(world: World, band: Band, quest: Quest, rng: Rng): "victory" | "retreat" | "defeat" {
  const doctrine = world.doctrine;
  const enemies = buildEnemies(world, quest, rng);
  const members = livingMembers(world, band);
  let leader = world.persons[band.leaderId];
  let round = 0;
  let notable = "";
  const learningNotes: string[] = [];

  while (round < 7 && enemies.some((enemy) => enemy.hp > 0) && members.some((member) => member.alive && member.hp > 0)) {
    round += 1;
    const healer = strongestHealer(members);
    const wounded = members
      .filter((member) => member.alive)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];

    const healAbility = healer ? bestReadyAbility(healer, (ability) => ability.effect === "heal") : undefined;
    if (healer && wounded && healAbility && wounded.hp / wounded.maxHp < doctrine.healBelow / 100) {
      const heal = Math.round(healAbility.power + healer.skills.medicine * 0.22 + healer.skills.sorcery * 0.1 + rng.int(2, 10));
      wounded.hp = clamp(wounded.hp + heal, 0, wounded.maxHp);
      healer.mana = clamp(healer.mana - healAbility.manaCost, 0, healer.maxMana);
      addCombatEffect(world, quest.locationId, {
        kind: "area",
        name: healAbility.name,
        color: "#7d8f5b",
        radius: 22,
        intensity: 58,
        actorIds: [healer.id, wounded.id],
        factionIds: [healer.factionId],
        tags: ["heal", healAbility.school, healAbility.effect]
      });
      recordObservedUse(world, members, healer.id, healAbility, rng, learningNotes);
      notable ||= `${healer.name} uses ${healAbility.name} to keep ${wounded.name} standing.`;
    }

    const consumableThreshold =
      doctrine.spendConsumables === "freely" ? doctrine.healBelow + 18 : doctrine.spendConsumables === "balanced" ? doctrine.healBelow : 18;
    if (wounded && wounded.hp / wounded.maxHp < consumableThreshold / 100) {
      const tonic = useConsumable(wounded, "consumable");
      if (tonic) {
        ensureItem(tonic);
        const heal = 10 + tonic.power * 6 + rng.int(1, 8);
        wounded.hp = clamp(wounded.hp + heal, 0, wounded.maxHp);
        for (const effect of tonic.effects.filter((candidate) => candidate.kind === "status" && candidate.status)) {
          if (effect.status) {
            wounded.status = [...new Set([...wounded.status, effect.status])];
          }
        }
        notable ||= `${wounded.name} spends ${tonic.name} under the ${doctrine.spendConsumables} consumable policy.`;
      }
    }

    const livingEnemies = enemies.filter((enemy) => enemy.hp > 0);
    const buffOptions = members.flatMap((member) => {
      const ability = bestReadyAbility(member, (candidate) => candidate.effect === "buff" && candidate.target === "party");
      return ability ? [{ member, ability }] : [];
    });
    if (buffOptions.length > 0 && rng.chance(0.28)) {
      const { member: caller, ability } = buffOptions.sort(
        (a, b) => b.ability.power + b.member.skills.command - (a.ability.power + a.member.skills.command)
      )[0];
      caller.mana = clamp(caller.mana - ability.manaCost, 0, caller.maxMana);
      for (const member of members.filter((candidate) => candidate.alive && candidate.hp > 0)) {
        member.morale = clamp(member.morale + Math.ceil(ability.power * 0.16), 0, 100);
      }
      addCombatEffect(world, quest.locationId, {
        kind: "status-zone",
        name: ability.name,
        color: "#d8c99e",
        radius: 34,
        intensity: 52,
        actorIds: [caller.id],
        factionIds: [caller.factionId],
        tags: ["buff", ability.school, ability.effect]
      });
      recordObservedUse(world, members, caller.id, ability, rng, learningNotes);
      notable ||= `${caller.name} raises the line with ${ability.name}.`;
    }

    const aoeOptions = members.flatMap((member) => {
      const ability = bestReadyAbility(member, (candidate) => candidate.effect === "damage" && candidate.target === "cluster");
      return ability ? [{ member, ability }] : [];
    });
    if (livingEnemies.length >= doctrine.aoeAt && aoeOptions.length > 0) {
      const { member: caster, ability } = aoeOptions.sort(
        (a, b) => b.ability.power + b.member.skills.sorcery - (a.ability.power + a.member.skills.sorcery)
      )[0];
      const damage = Math.round(ability.power + caster.skills.sorcery * 0.24 + rng.int(1, 8));
      caster.mana = clamp(caster.mana - ability.manaCost, 0, caster.maxMana);
      for (const enemy of livingEnemies.slice(0, Math.max(doctrine.aoeAt, ability.aoe))) {
        enemy.hp -= damage;
      }
      addCombatEffect(world, quest.locationId, {
        kind: "area",
        name: ability.name,
        color: "#c64737",
        radius: 36 + ability.aoe * 5,
        intensity: 78,
        actorIds: [caster.id],
        factionIds: [caster.factionId],
        tags: ["aoe", "damage", ability.school]
      });
      shiftIdentity(caster, { mightMagic: rng.int(1, 2), materialistSpiritualist: rng.chance(0.35) ? 1 : 0 });
      recordObservedUse(world, members, caster.id, ability, rng, learningNotes);
      notable ||= `${caster.name} casts ${ability.name} into clustered foes, following the AoE doctrine.`;
    }

    const debuffOptions = members.flatMap((member) => {
      const ability = bestReadyAbility(member, (candidate) => candidate.effect === "debuff" && candidate.target === "enemy");
      return ability ? [{ member, ability }] : [];
    });
    if (livingEnemies.length > 0 && debuffOptions.length > 0 && rng.chance(0.32)) {
      const { member: caster, ability } = debuffOptions.sort(
        (a, b) => b.ability.power + b.member.skills.sorcery - (a.ability.power + a.member.skills.sorcery)
      )[0];
      const target = pickEnemy(enemies, doctrine.targetPolicy, rng);
      const penalty = Math.round(ability.power * 0.42 + caster.skills.sorcery * 0.05 + rng.int(1, 4));
      target.attack = Math.max(1, target.attack - penalty);
      caster.mana = clamp(caster.mana - ability.manaCost, 0, caster.maxMana);
      addCombatEffect(world, quest.locationId, {
        kind: "projectile",
        name: ability.name,
        color: "#7f6a99",
        radius: 16,
        intensity: 62,
        actorIds: [caster.id],
        factionIds: [caster.factionId],
        tags: ["debuff", ability.school]
      });
      recordObservedUse(world, members, caster.id, ability, rng, learningNotes);
      notable ||= `${caster.name} marks ${target.name} with ${ability.name}, dulling its violence.`;
    }

    for (const member of members.filter((candidate) => candidate.alive && candidate.hp > 0)) {
      const target = pickEnemy(enemies, doctrine.targetPolicy, rng);
      if (!target) {
        break;
      }
      const attackAbility = bestReadyAbility(
        member,
        (ability) => ability.effect === "damage" && ability.target === "enemy" && ability.kind !== "passive"
      );
      const activePower = attackAbility?.power ?? 0;
      const damage = Math.round(Math.max(3, personPower(member) * 0.13 + activePower + rng.int(1, 12)));
      target.hp -= damage;
      if (attackAbility && attackAbility.manaCost > 0) {
        member.mana = clamp(member.mana - attackAbility.manaCost, 0, member.maxMana);
        addCombatEffect(world, quest.locationId, {
          kind: "projectile",
          name: attackAbility.name,
          color: attackAbility.school === "martial" ? "#a87048" : "#c64737",
          radius: 14,
          intensity: 54,
          actorIds: [member.id],
          factionIds: [member.factionId],
          tags: ["attack", attackAbility.school, attackAbility.effect]
        });
        notable ||= rng.chance(0.18) ? `${member.name} presses with ${attackAbility.name}.` : notable;
      }
      if (attackAbility) {
        recordObservedUse(world, members, member.id, attackAbility, rng, learningNotes);
      }
      member.fatigue = clamp(member.fatigue + rng.int(2, 5), 0, 100);
    }

    if (!enemies.some((enemy) => enemy.hp > 0)) {
      break;
    }

    const guardBonus = partyAbilityBonus(
      members.filter((member) => member.alive && member.hp > 0),
      "guard"
    );
    for (const enemy of enemies.filter((candidate) => candidate.hp > 0)) {
      const availableTargets = members.filter((member) => member.alive && member.hp > 0);
      if (availableTargets.length === 0) {
        break;
      }
      const enemyAbility = enemy.abilityId ? getAbility(enemy.abilityId) : undefined;
        if (enemyAbility && enemy.mana >= enemyAbility.manaCost && rng.chance(enemy.role === "caster" ? 0.48 : 0.24)) {
        const target = rng.pick(availableTargets);
        enemy.mana = Math.max(0, enemy.mana - enemyAbility.manaCost);
        addCombatEffect(world, quest.locationId, {
          kind: enemyAbility.effect === "buff" ? "status-zone" : "projectile",
          name: enemyAbility.name,
          color: enemyAbility.effect === "debuff" ? "#7f6a99" : "#c64737",
          radius: 18,
          intensity: 62,
          actorIds: [target.id],
          factionIds: [quest.issuerFactionId],
          tags: ["enemy", enemyAbility.school, enemyAbility.effect]
        });
        if (enemyAbility.effect === "damage") {
          const armor = target.equipment.armor ? ensureItem(target.equipment.armor) : undefined;
          const damage = Math.max(
            2,
            Math.round(enemyAbility.power + enemy.attack * 0.42 + rng.int(-2, 6) - (armor?.power ?? 0) - itemEffectBonus(armor, "resistance", "physical") * 0.5)
          );
          target.hp = clamp(target.hp - damage, -20, target.maxHp);
        } else if (enemyAbility.effect === "debuff") {
          target.morale = clamp(target.morale - Math.ceil(enemyAbility.power * 0.45), 0, 100);
          target.fatigue = clamp(target.fatigue + rng.int(2, 6), 0, 100);
        } else if (enemyAbility.effect === "buff") {
          enemy.attack += Math.ceil(enemyAbility.power * 0.16);
        }
        recordObservedUse(world, availableTargets, undefined, enemyAbility, rng, learningNotes);
        notable ||= `${enemy.name} reveals ${enemyAbility.name} in the press.`;
        if (target.hp <= 0) {
          target.hp = 1;
          target.status = [...new Set([...target.status, "wounded"])];
        }
        continue;
      }
      const target = rng.weighted(
        availableTargets.map((member) => ({
          value: member,
          weight: member.role === "fighter" ? 5 : member.role === "leader" ? 4 : 2
        }))
      );
      const armorItem = target.equipment.armor ? ensureItem(target.equipment.armor) : undefined;
      const armor = armorItem?.power ?? 0;
      const damage = Math.max(1, Math.round(enemy.attack + rng.int(-4, 8) - armor * 2 - itemEffectBonus(armorItem, "resistance", "physical") - guardBonus * 0.08));
      target.hp = clamp(target.hp - damage, -20, target.maxHp);
      if (target.hp <= 0) {
        const deathRisk = 0.015 + quest.danger / 2500 + (target.status.includes("wounded") ? 0.06 : 0) + (target.hp <= -10 ? 0.04 : 0);
        if (rng.chance(deathRisk)) {
          target.alive = false;
          target.hp = 0;
          notable = `${target.name} ${target.familyName} dies under ${enemy.name}'s blow.`;
        } else {
          target.hp = 1;
          target.status = [...new Set([...target.status, "wounded"])];
          addMemory(target, world, `Nearly killed by ${enemy.name}`, -9, ["near-death", quest.kind]);
          adjustTrait(target, "caution", 3);
          shiftIdentity(target, { vengefulForgiving: -rng.int(2, 5), cravenBold: -rng.int(1, 3) });
          notable = `${target.name} is dragged back from the edge, wounded and changed.`;
        }
      }
    }

    const currentLeader = ensureBandLeader(world, band);
    if (currentLeader) {
      leader = currentLeader;
    }

    const leaderRatio = leader.hp / leader.maxHp;
    const teamHealth = average(members.filter((member) => member.alive).map((member) => member.hp / member.maxHp));
    if ((leaderRatio * 100 < doctrine.retreatBelow || teamHealth < 0.26) && doctrine.riskStance !== "bold") {
      const learningText = learningNotes.length ? ` ${learningNotes.slice(0, 2).join(" ")}` : "";
      event(
        world,
        "combat",
        "high",
        `${band.name} retreats from ${quest.title}. ${notable || "The doctrine judged survival above glory."}${learningText}`,
        members.map((member) => member.id),
        [quest.issuerFactionId],
        quest.locationId
      );
      return "retreat";
    }
  }

  if (enemies.some((enemy) => enemy.hp > 0) && !members.some((member) => member.alive && member.hp > 0)) {
    const learningText = learningNotes.length ? ` ${learningNotes.slice(0, 2).join(" ")}` : "";
    event(
      world,
      "combat",
      "high",
      `${band.name} is broken during ${quest.title}. ${notable || "No one carries the field."}${learningText}`,
      members.map((member) => member.id),
      [quest.issuerFactionId],
      quest.locationId
    );
    return "defeat";
  }

  if (enemies.some((enemy) => enemy.hp > 0)) {
    const learningText = learningNotes.length ? ` ${learningNotes.slice(0, 2).join(" ")}` : "";
    event(
      world,
      "combat",
      "medium",
      `${band.name} withdraws after ${round} rounds at ${quest.title}. ${notable || "The enemy still holds ground."}${learningText}`,
      members.map((member) => member.id),
      [quest.issuerFactionId],
      quest.locationId
    );
    return "retreat";
  }

  const learningText = learningNotes.length ? ` ${learningNotes.slice(0, 2).join(" ")}` : "";
  event(
    world,
    "combat",
    "medium",
    `${band.name} wins the fight at ${quest.title} in ${round} rounds. ${notable || "The line holds."}${learningText}`,
    members.map((member) => member.id),
    [quest.issuerFactionId],
    quest.locationId
  );
  return "victory";
}
