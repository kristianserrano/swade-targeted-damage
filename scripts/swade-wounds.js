const MODULE_TITLE = "swade-wounds-calculator";

Hooks.on('init', function () {
    game.settings.register(MODULE_TITLE, "woundCap", {
        name: game.i18n.format("SWWC.UseWoundCap"),
        hint: game.i18n.format("SWWC.UseWoundCapHint"),
        type: Boolean,
        default: false,
        scope: "world",
        config: true
    });

    game.settings.register(MODULE_TITLE, "apply-gritty-damage", {
        name: game.i18n.format("SWWC.UseGrittyDamage"),
        hint: game.i18n.format("SWWC.UseGrittyDamageHint"),
        scope: "world",
        requiresReload: true,
        config: true,
        default: false,
        type: Boolean
    });
});

Hooks.on('ready', function () {
    game.socket.on(`module.${MODULE_TITLE}`, adjustDamagePrompt);

    const choices = {};

    if (game.settings.get(MODULE_TITLE, 'apply-gritty-damage')) {
        // Setting to enable Gritty Damage
        for (const p of game.packs) {
            if (p.metadata.type === 'RollTable' && p.metadata.packageType !== 'system') {
                for (const i of p.index) {
                    choices[i._id] = `${i.name} (${p.title})`;
                }
            }
        }
        // Setting to select Injury Table for Gritty Damage
        game.settings.register(MODULE_TITLE, "injury-table", {
            name: game.i18n.format("SWWC.SelectInjuryTable"),
            hint: game.i18n.format("SWWC.SelectInjuryTableHint"),
            scope: "world",
            config: true,
            type: String,
            choices: choices,
            default: ""
        });
    }
});

const appCssClasses = ["swade-app"];

async function soakPrompt(actor, damage, ap, woundsInflicted, statusToApply) {
    const woundsText = `${woundsInflicted} ${woundsInflicted > 1 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
    let message = game.i18n.format("SWWC.woundsAboutToBeTaken", { name: actor.name, wounds: woundsText });
    await ChatMessage.create({ content: message });
    new Dialog({
        title: game.i18n.format("SWWC.soakTitle", { name: actor.name }),
        content: game.i18n.format("SWWC.soakDmgPrompt", { name: actor.name, wounds: woundsText }),
        buttons: {
            soakBenny: {
                label: game.i18n.format("SWWC.soakBenny"),
                callback: async () => {
                    if (actor.isWildcard && actor.bennies > 0) {
                        actor.spendBenny();
                    } else if (!actor.isWildcard && game.user.isGM && game.user.bennies > 0) {
                        game.user.spendBenny();
                    }
                    await attemptSoak(actor, woundsInflicted, statusToApply, woundsText);
                }
            },
            soakFree: {
                label: game.i18n.format("SWWC.soakFree"),
                callback: async () => {
                    await attemptSoak(actor, woundsInflicted, statusToApply, woundsText);
                }
            },
            take: {
                label: game.i18n.format("SWWC.takeWounds", { wounds: woundsText }),
                callback: async () => {
                    const existingWounds = actor.system.wounds.value;
                    const maxWounds = actor.system.wounds.max;
                    const totalWounds = existingWounds + woundsInflicted;
                    const newWoundsValue = totalWounds < maxWounds ? totalWounds : maxWounds;
                    let message = game.i18n.format("SWWC.woundsTaken", { name: actor.name, wounds: woundsText });
                    await actor.update({ 'system.wounds.value': newWoundsValue });
                    if (totalWounds > maxWounds) {
                        message = await applyIncapacitated(actor);
                    } else {
                        await applyShaken(actor);
                    }
                    await ChatMessage.create({ content: message });
                    if (game.settings.get(MODULE_TITLE, "apply-gritty-damage")) {
                        await promptGrittyDamage();
                    }
                }
            },
            adjust: {
                label: game.i18n.format("SWWC.adjustDamage"),
                callback: async () => {
                    adjustDamageValues(actor, damage, ap);
                }
            }
        },
        default: "soakBenny"
    }, { classes: appCssClasses }).render(true);
}

async function attemptSoak(actor, woundsInflicted, statusToApply, woundsText, bestSoakAttempt = null) {
    // TODO: Figure out how to delay the results message until after the DSN roll animation completes.
    let vigorRoll = await actor.rollAttribute('vigor');
    let message;
    const woundsSoaked = Math.floor(vigorRoll.total / 4);
    const existingWounds = actor.system.wounds.value;
    const maxWounds = actor.system.wounds.max;
    let woundsRemaining = woundsInflicted - woundsSoaked;
    if (woundsRemaining <= 0) {
        message = game.i18n.format("SWWC.soakedAll", { name: actor.name });
        await ChatMessage.create({ content: message });
    } else {
        const totalWounds = existingWounds + woundsRemaining;
        const newWoundsValue = totalWounds < maxWounds ? totalWounds : maxWounds;
        if (bestSoakAttempt !== null && woundsRemaining > bestSoakAttempt) {
            woundsRemaining = bestSoakAttempt;
        }
        const woundsRemainingText = `${woundsRemaining} ${woundsRemaining > 1 || woundsRemaining === 0 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
        const newWoundsValueText = `${newWoundsValue} ${newWoundsValue > 1 || newWoundsValue === 0 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
        new Dialog({
            title: game.i18n.format("SWWC.rerollSoakTitle", { name: actor.name }),
            content: game.i18n.format("SWWC.rerollSoakDmgPrompt", { name: actor.name, wounds: woundsRemainingText }),
            buttons: {
                rerollBenny: {
                    label: game.i18n.format("SWWC.rerollSoakBenny"),
                    callback: async () => {
                        if (actor.isWildcard && actor.bennies > 0) {
                            actor.spendBenny();
                        } else if (!actor.isWildcard && game.user.isGM && game.user.bennies > 0) {
                            game.user.spendBenny();
                        }
                        await attemptSoak(actor, woundsInflicted, statusToApply, woundsText, woundsRemaining);
                    }
                },
                rerollFree: {
                    label: game.i18n.format("SWWC.rerollSoakFree"),
                    callback: async () => {
                        await attemptSoak(actor, woundsInflicted, statusToApply, woundsText, woundsRemaining);
                    }
                },
                accept: {
                    label: game.i18n.format("SWWC.takeWounds", { wounds: woundsRemainingText }),
                    callback: async () => {
                        if (statusToApply === 'shaken') {
                            if (actor.system.status.isShaken) {
                                await actor.update({ 'system.wounds.value': newWoundsValue });
                            }
                            await applyShaken(actor);
                            message = game.i18n.format("SWWC.isShaken", { name: actor.name });
                        }
                        if (statusToApply === 'wounded') {
                            await actor.update({ 'system.wounds.value': newWoundsValue });
                            if (totalWounds > maxWounds) {
                                message = await applyIncapacitated(actor);
                            } else {
                                await applyShaken(actor);
                            }
                            message = game.i18n.format("SWWC.woundsTaken", { name: actor.name, wounds: newWoundsValueText });
                            if (game.settings.get(MODULE_TITLE, "apply-gritty-damage")) {
                                await promptGrittyDamage();
                            }
                        }
                        await ChatMessage.create({ content: message });
                    }
                },
            },
            default: "rerollBenny"
        }, { classes: appCssClasses }).render(true);
    }
}

async function applyShaken(actor) {
    const isShaken = actor.system.status.isShaken;
    if (!isShaken) {
        const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
        await actor.toggleActiveEffect(data, { active: true });
    }
}

async function applyIncapacitated(actor) {
    const isIncapacitated = actor.effects.find((e) => e.label === 'Incapacitated');
    if (isIncapacitated === undefined) {
        const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
        await actor.toggleActiveEffect(data, { active: true });
    }
    return game.i18n.format("SWWC.incapacitated", { name: actor.name });
}

async function promptGrittyDamage() {
    const injuryTableId = game.settings.get(MODULE_TITLE, "injury-table");
    let injuryTable;
    for (const p of game.packs) {
        for (const i of p.index) {
            if (i._id === injuryTableId) {
                const pack = await game.packs.get(p.collection);
                injuryTable = await pack.getDocument(i._id);
            }
        }
    }
    new Dialog({
        title: game.i18n.format("SWWC.GrittyDamage"),
        content: `<p>${game.i18n.format("SWWC.RollGrittyDamageDesc")}</p>`,
        buttons: {
            roll: {
                label: "Roll",
                callback: async () => {
                    await injuryTable.draw();
                    // TODO: Add automatic roll on injury subtables when they are added to the modules.
                }
            },
            cancel: {
                label: "Cancel"
            }
        }
    }).render(true);
}

async function calcWounds(actor, damage, ap) {

    const woundCap = game.settings.get(MODULE_TITLE, 'woundCap');
    let message = '';
    let { armor, value } = actor.system.stats.toughness;
    if (actor.type === "vehicle") {
        armor = Number(actor.system.toughness.armor);
        value = Number(actor.system.toughness.total);
    }
    const apNeg = Math.min(ap, armor);
    const newT = value - apNeg;
    const excess = damage - newT;
    let woundsInflicted = Math.floor(excess / 4);
    if (woundCap && woundsInflicted > 4) {
        woundsInflicted = 4;
    }
    let statusToApply = 'none';
    if (excess >= 0 && excess < 4) {
        statusToApply = "shaken";
        if (actor.system.status.isShaken && woundsInflicted === 0) {
            woundsInflicted = 1;
            statusToApply = "wounded";
        }
    } else if (excess >= 4) {
        statusToApply = "wounded";
    }

    if (statusToApply === 'wounded') {
        await soakPrompt(actor, damage, ap, woundsInflicted, statusToApply);
    } else if (statusToApply === "shaken") {
        message = game.i18n.format("SWWC.isShaken", { name: actor.name });
        await applyShaken(actor);
        await ChatMessage.create({ content: message });
    } else if (statusToApply === 'none') {
        message = game.i18n.format("SWWC.noSignificantDamage", { name: actor.name });
        await ChatMessage.create({ content: message });
    }
}

function adjustDamageValues(actor, damage, ap) {
    new Dialog({
        title: game.i18n.format("SWWC.title"),
        content: `
                    <form>
                    <fieldset>
                    <label for="damage">${game.i18n.format("SWADE.Dmg")}</label>
                    <input type="number" id="damage" value="${damage}" autofocus>
                    <label for="ap">${game.i18n.format("SWADE.Ap")}</label>
                    <input type="number" id="ap" value="${ap}">
                    </fieldset>
                    </form>
                `,
        buttons: {
            calculate: {
                label: game.i18n.format("SWWC.calculate"),
                callback: async (html) => {
                    const damage = Number(html.find("#damage")[0].value);
                    const ap = Number(html.find("#ap")[0].value);
                    await calcWounds(actor, damage, ap);
                }
            }
        },
        default: "calculate"
    }, { classes: appCssClasses }).render(true);

}
function triggerFlow(targets, damage, ap) {
    for (const target of targets) {
        const playerOwners = Object.keys(target.actor.ownership).filter((id) => {
            return game.users.find((u) => u.id === id && !u.isGM);
        });
        const userHasOwnerPermission = target.actor.ownership[game.userId] === 3;
        const userIsGM = game.user.isGM;
        const userIsGmAndOwner = userIsGM && playerOwners.length === 0;
        const userIsPlayerAndOwner = !userIsGM && userHasOwnerPermission;
        const userIsOwner = userIsGmAndOwner || userIsPlayerAndOwner;
        if (userIsOwner) {
            adjustDamagePrompt({
                tokenActorUUID: target.actor.uuid,
                damage: damage,
                ap: ap
            });
        } else {
            game.socket.emit(`module.${MODULE_TITLE}`, {
                tokenActorUUID: target.actor.uuid,
                damage: damage,
                ap: ap
            });
        }
    }
}

async function adjustDamagePrompt({ tokenActorUUID, damage, ap }) {
    let actor;
    const target = await fromUuid(tokenActorUUID);
    if (target.documentName === 'Actor'){
        actor = target;
    } else if (target.documentName === 'Token') {
        actor = target.actor;
    }
    const playerOwners = Object.keys(actor.ownership).filter((id) => {
        return game.users.find((u) => u.id === id && !u.isGM);
    });
    const userHasOwnerPermission = actor.ownership[game.userId] === 3;
    const userIsGM = game.user.isGM;
    const userIsGmAndOwner = userIsGM && playerOwners.length === 0;
    const userIsPlayerAndOwner = !userIsGM && userHasOwnerPermission;
    const userIsOwner = userIsGmAndOwner || userIsPlayerAndOwner;
    if (userIsOwner) {
        Dialog.confirm({
            title: game.i18n.format("SWWC.title"),
            content: game.i18n.format("SWWC.adjustDamagePrompt"),
            yes: () => adjustDamageValues(actor, damage, ap),
            no: async () => await calcWounds(actor, damage, ap),
            defaultYes: false
        }, { classes: appCssClasses });
    }
}
class WoundsCalculator {
    static render() {
        const targets = game.user.targets;
        if (targets.size) {
            new Dialog({
                title: game.i18n.format("SWWC.title"),
                content: `
                    <label for="damage">${game.i18n.format("SWADE.Dmg")}</label>
                    <input type="number" id="damage" autofocus>
                    <label for="ap">${game.i18n.format("SWADE.Ap")}</label>
                    <input type="number" id="ap">
                `,
                buttons: {
                    calculate: {
                        label: game.i18n.format("SWWC.calculate"),
                        callback: async (html) => {
                            const damage = Number(html.find("#damage")[0].value);
                            const ap = Number(html.find("#ap")[0].value);
                            calcWounds(targets, damage, ap);
                        }
                    }
                },
                default: "calculate"
            }, { classes: appCssClasses }).render(true);
        } else {
            ui.notifications.warn("Please select one or more Targets.");
        }
    }
}

Hooks.on('createChatMessage', function (data) {
    const sameUser = data.user.id === game.userId;
    const flavor = data.flavor;
    if (sameUser && data.rolls.length && flavor.includes('Damage')) {
        const targets = data.user.targets;
        if (targets.size) {
            const damage = data.rolls[0].total;
            const ap = parseInt(flavor.slice(flavor.indexOf('AP ') + 3));
            triggerFlow(targets, damage, ap);
        }
    }
});

globalThis.WoundsCalculator = WoundsCalculator;
