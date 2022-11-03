const MODULE_TITLE = "swade-wounds-calculator";

Hooks.on('init', function () {
    // Add setting for Wound Cap Setting Rule
    game.settings.register(MODULE_TITLE, "woundCap", {
        name: game.i18n.format("SWWC.UseWoundCap"),
        hint: game.i18n.format("SWWC.UseWoundCapHint"),
        type: Boolean,
        default: false,
        scope: "world",
        config: true
    });
    // Add setting to enable Gritty Damage Setting Rule
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
    // Setup socket
    game.socket.on(`module.${MODULE_TITLE}`, adjustDamagePrompt);

    // Create empty object for choices of Tables to select the Injury Table to use with Gritty Damage rules.
    const choices = {};
    // If Gritty Damage is true, collect a list of Tables
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

// Create string variable for the SWADE CSS class for App Windows.
const appCssClasses = ["swade-app"];

// Function for applying the Incapacitated Status Effect
async function applyIncapacitated(actor) {
    // Check if they're already Incapacitated; we don't need to add another instance if so.
    const isIncapacitated = actor.effects.find((e) => e.label === 'Incapacitated');
    // If there is not such Status Effect, then apply it.
    if (isIncapacitated === undefined) {
        const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
        await actor.toggleActiveEffect(data, { active: true });
    }
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

async function applyShaken(actor) {
    const isShaken = actor.system.status.isShaken;
    if (!isShaken) {
        const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
        await actor.toggleActiveEffect(data, { active: true });
    }
}

// Function to roll for Soaking Wounds.
async function attemptSoak(actor, woundsInflicted, statusToApply, woundsText, bestSoakAttempt = null) {
    // TODO: Figure out how to delay the results message until after the DSN roll animation completes.
    // Roll Vigor and get the data.
    let vigorRoll = await actor.rollAttribute('vigor');
    let message;
    // Calculate how many Wounds have been Soaked with the roll
    const woundsSoaked = Math.floor(vigorRoll.total / 4);
    // Get the number of current Wounds the Actor has.
    const existingWounds = actor.system.wounds.value;
    // Get the maximum amount of Wounds the Actor can suffer before Incapacitation.
    const maxWounds = actor.system.wounds.max;
    // Calculate how many Wounds are remaining after Soaking.
    let woundsRemaining = woundsInflicted - woundsSoaked;
    // If there are no remaining Wounds, output message that they Soaked all the Wounds.
    if (woundsRemaining <= 0) {
        message = game.i18n.format("SWWC.soakedAll", { name: actor.name });
        await ChatMessage.create({ content: message });
    } else {
        // Otherwise, calculate how many Wounds the Actor now has.
        const totalWounds = existingWounds + woundsRemaining;
        // Set the Wounds, but if it's beyond the maximum, set it to the maximum.
        const newWoundsValue = totalWounds < maxWounds ? totalWounds : maxWounds;
        if (bestSoakAttempt !== null && woundsRemaining > bestSoakAttempt) {
            // If they already attempted to Soak, set Wounds remaining to whatever their best roll yielded so far.
            woundsRemaining = bestSoakAttempt;
        }
        // Construct text for number of Wounds remaining.
        const woundsRemainingText = `${woundsRemaining} ${woundsRemaining > 1 || woundsRemaining === 0 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
        // Open Dialog to reroll with a Benny, reroll for free, or accept the Wounds.
        const rerollSoakDialog = new Dialog({
            title: game.i18n.format("SWWC.rerollSoakTitle", { name: actor.name }),
            content: game.i18n.format("SWWC.rerollSoakDmgPrompt", { name: actor.name, wounds: woundsRemainingText }),
            buttons: {
                rerollBenny: {
                    label: game.i18n.format("SWWC.rerollSoakBenny"),
                    callback: async () => {
                        if (actor.isWildcard) {
                            actor.spendBenny();
                        } else if (!actor.isWildcard && game.user.isGM) {
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
                        // Construct text for the new Wounds value to be accepted (singular or plural Wounds).
                        const newWoundsValueText = `${newWoundsValue} ${newWoundsValue > 1 || newWoundsValue === 0 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
                        if (statusToApply === 'shaken') {
                            await applyShaken(actor);
                            if (actor.system.status.isShaken) {
                                statusToApply = 'wounded';
                            } else {
                                // Is Shaken
                                message = game.i18n.format("SWWC.isShaken", { name: actor.name });
                            }
                        }
                        if (statusToApply === 'wounded') {
                            // Update Wounds
                            await actor.update({ 'system.wounds.value': newWoundsValue });
                            // Is Shaken with Wounds
                            message = game.i18n.format("SWWC.isShakenWithWounds", { name: actor.name, wounds: newWoundsValueText });
                            // Apply Status Effects: Incapacitated or Shaken.
                            if (totalWounds > maxWounds) {
                                await applyIncapacitated(actor);
                                message = game.i18n.format("SWWC.incapacitated", { name: actor.name });
                                await ChatMessage.create({ content: message });
                            } else {
                                await applyShaken(actor);
                                message = game.i18n.format("SWWC.shakenWithWounds", { name: actor.name, wounds: newWoundsValueText });
                            }
                            // Output Chat Message.
                            await ChatMessage.create({ content: message });
                            // If Gritty Damage is in play, prompt for Gritty Damage.
                            if (game.settings.get(MODULE_TITLE, "apply-gritty-damage")) {
                                await promptGrittyDamage();
                            }
                        }
                    }
                },
            },
            default: "accept"
        }, { classes: appCssClasses });
        // If no Bennies available, remove the option from the Dialog.
        if ((actor.isWildcard && actor.bennies <= 0) || (!actor.isWildcard && game.user.isGM && game.user.bennies <= 0)) {
            delete rerollSoakDialog.data.buttons.rerollBenny;
        }
        // Render the Dialog.
        rerollSoakDialog.render(true);
    }
}

// Function for prompting to Soak.
async function soakPrompt(actor, damage, ap, woundsInflicted, statusToApply) {
    // Set Wounds text for chat message
    const woundsText = `${woundsInflicted} ${woundsInflicted > 1 ? game.i18n.format("SWWC.wounds") : game.i18n.format("SWWC.wound")}`;
    // Text for Wounds about to be taken.
    let message = game.i18n.format("SWWC.woundsAboutToBeTaken", { name: actor.name, wounds: woundsText });
    // Create the message
    await ChatMessage.create({ content: message });
    // Construct the Dialog for Soaking
    const soakDialog = new Dialog({
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
                    let message = game.i18n.format("SWWC.isShakenWithWounds", { name: actor.name, wounds: woundsText });
                    await actor.update({ 'system.wounds.value': newWoundsValue });
                    if (totalWounds > maxWounds) {
                        await applyIncapacitated(actor);
                        message = game.i18n.format("SWWC.incapacitated", { name: actor.name });
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
    }, { classes: appCssClasses });
    // If Bennies aren't available, remove that option.
    if ((actor.isWildcard && actor.bennies <= 0) || (!actor.isWildcard && game.user.isGM && game.user.bennies <= 0)) {
        delete soakDialog.data.buttons.soakBenny;
    }
    // Render the Dialog.
    soakDialog.render(true);
}

// Function for translating damage to Wounds.
async function calcWounds(actor, damage, ap) {
    let message = '';
    // Get Toughness values.
    let { armor, value } = actor.system.stats.toughness;
    // If the Actor is a vehicle, get appropriate values.
    if (actor.type === "vehicle") {
        armor = Number(actor.system.toughness.armor);
        value = Number(actor.system.toughness.total);
    }
    // AP vs Armor
    const apNeg = Math.min(ap, armor);
    // New Toughness
    const newT = value - apNeg;
    // Calculate how much over.
    const excess = damage - newT;
    // Translate damage raises to Wounds.
    let woundsInflicted = Math.floor(excess / 4);
    // Check if WoundCap is in play.
    const woundCap = game.settings.get(MODULE_TITLE, 'woundCap');
    // If Wound Cap, limit Wounds inflicted (i.e. to Soak) to 4
    if (woundCap && woundsInflicted > 4) {
        woundsInflicted = 4;
    }
    // Default status to apply as none.
    let statusToApply = 'none';
    // If damage meets Toughness without a raise.
    if (excess >= 0 && excess < 4) {
        // Set status to Shaken.
        statusToApply = "shaken";
        // If already shaken, set status to wounded and wounds inflicted to 1.
        if (actor.system.status.isShaken && woundsInflicted === 0) {
            woundsInflicted = 1;
            statusToApply = "wounded";
        }
    } else if (excess >= 4) {
        // If damage is a raise over Toughness, set status to wounded
        statusToApply = "wounded";
    }
    // If status is wounded...
    if (statusToApply === 'wounded') {
        // Prompt to Soak the Wounds.
        await soakPrompt(actor, damage, ap, woundsInflicted, statusToApply);
    } else if (statusToApply === "shaken") {
        // If Shaken, set message.
        message = game.i18n.format("SWWC.isShaken", { name: actor.name });
        // Apply Shaken Status Effect.
        await applyShaken(actor);
        // Output chat message.
        await ChatMessage.create({ content: message });
    } else if (statusToApply === 'none') {
        // If no status to apply because damage was too low, output a message saying such.
        message = game.i18n.format("SWWC.noSignificantDamage", { name: actor.name });
        await ChatMessage.create({ content: message });
    }
}


// Function to take in and set adjusted Damage Values
function adjustDamageValues(actor, damage, ap) {
    // Construct dialog with fields for damage and AP values.
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
                    // Calculate the Wounds.
                    await calcWounds(actor, damage, ap);
                }
            }
        },
        default: "calculate"
    }, { classes: appCssClasses }).render(true);
}

// Function to prompt whether to adjust damage before Wounds are calculated.
async function adjustDamagePrompt({ tokenActorUUID, damage, ap, targetUserId }) {
    let actor;
    // Get the target.
    const target = await fromUuid(tokenActorUUID);
    // Determine if the target is an Actor or Token to set the actor object variable.
    if (target.documentName === 'Actor') {
        actor = target;
    } else if (target.documentName === 'Token') {
        actor = target.actor;
    }

    // TODO: Figure out sending prompt to specific player.
    if (!!targetUserId && game.userId !== targetUserId && actor.ownership.default !== 3) return;

    if ((!targetUserId && promptThisUser(actor, damage, ap)) || (targetUserId && game.userId === targetUserId)) {
        Dialog.confirm({
            title: game.i18n.format("SWWC.adjustDamageTitle", { name: actor.name }),
            content: game.i18n.format("SWWC.adjustDamagePrompt", { name: actor.name }),
            yes: () => adjustDamageValues(actor, damage, ap),
            no: async () => await calcWounds(actor, damage, ap),
            defaultYes: false
        }, { classes: appCssClasses });
    }
}

// Function to determine if this client's user should be prompted.
function promptThisUser(actor, damage, ap) {
    // Find the player who has selected this Actor as their character and is active, if any.
    const activeCharacterPlayer = game.users.find((u) => u.character && u.character.id === actor.id && u.active);
    // Is the active character player the current user?
    const userIsActiveCharacterPlayer = activeCharacterPlayer && activeCharacterPlayer.id === game.userId;
    if (userIsActiveCharacterPlayer) return true;
    // Is the default ownership "owner" (3)?
    const defaultOwnership = actor.ownership.default === 3;
    // Does the current user have ownership of the Actor?
    const userHasOwnerPermission = actor.ownership[game.userId] === 3;
    // Is the user a GM?
    const userIsGM = game.user.isGM;
    // Are there any players (not GMs) with ownership that are active?
    const activePlayerOwners = Object.keys(actor.ownership).filter((id) => { return game.users.find((u) => u.id === id && !u.isGM && u.active); });
    // Are there multiple active players?
    const multipleActivePlayers = game.users.filter((u) => u.active && !u.isGM);
    // Are there multiple active players who own the actor?
    const multipleActiveOwners = activePlayerOwners.length || (multipleActivePlayers.length > 1 && defaultOwnership);
    // If there is no active character player, and the user has ownership in some way, and the user is not a GM, and there are not multiple owners
    if (!activeCharacterPlayer && !userIsGM && !multipleActiveOwners && (userHasOwnerPermission || defaultOwnership)) return true;
    // Is there any player owner available?
    const noUniquePlayerOwnerAvailable = !activeCharacterPlayer && multipleActiveOwners;
    if (userIsGM && noUniquePlayerOwnerAvailable) {
        const buttons = {};
        const activePlayers = game.users.filter((u) => !u.isGM && u.active);
        for (const player of activePlayers) {
            buttons[player.id] = {
                label: player.name,
                callback: () => {
                    game.socket.emit(`module.${MODULE_TITLE}`, {
                        tokenActorUUID: actor.uuid,
                        damage: damage,
                        ap: ap,
                        targetUserId: player.id
                    });
                }
            };
        }
        new Dialog({
            title: game.i18n.format("SWWC.ChoosePlayerTitle"),
            content: `${game.i18n.format("SWWC.ChoosePlayerPrompt", { name: actor.name })}`,
            buttons: buttons,
            default: ""
        }, { classes: appCssClasses }).render(true);
    }
    if (userIsGM && !activeCharacterPlayer && !activePlayerOwners.length && !multipleActiveOwners && !defaultOwnership) return true;
    return false;
}

// Function to trigger the workflow either on the current client or on other client(s).
function triggerFlow(targets, damage, ap) {
    // For each token targeted...
    for (const target of targets) {
        // Determine whether there are any owners that are not GMs.
        const characterPlayer = game.users.find((u) => u.character && u.character.id === target.actor.id);
        let targetUserId;
        if (!!characterPlayer) targetUserId = characterPlayer.id;
        if (promptThisUser(target.actor, damage, ap)) {
            adjustDamagePrompt({
                tokenActorUUID: target.actor.uuid,
                damage: damage,
                ap: ap
            });
        } else {
            game.socket.emit(`module.${MODULE_TITLE}`, {
                tokenActorUUID: target.actor.uuid,
                damage: damage,
                ap: ap,
                targetUserId: targetUserId
            });
        }
    }
}

// Set Hook to trigger the workflow on createChatMessage.
Hooks.on('createChatMessage', function (data) {
    // Determine whether the chat message creator is the same as the current user.
    const sameUser = data.user.id === game.userId;
    const flavor = data.flavor;
    // If the chat message is a damage roll and it's the same user...
    if (sameUser && data.rolls.length && flavor.includes('Damage')) {
        // Collect the user's Targets
        const targets = data.user.targets;
        // If there are targets, get the damage and ap, and trigger the flow with the data.
        if (targets.size) {
            const damage = data.rolls[0].total;
            const ap = parseInt(flavor.slice(flavor.indexOf('AP ') + 3));
            triggerFlow(targets, damage, ap);
        }
    }
});

// Class for executing the script via the Macro.
class WoundsCalculator {
    static render() {
        const targets = game.user.targets;
        if (targets.size) {
            // Construct Dialog for data input and trigger flow.
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
                            triggerFlow(targets, damage, ap);
                        }
                    }
                },
                default: "calculate"
            }, { classes: appCssClasses }).render(true);
        } else {
            // If no targets selected, issue warning notification.
            ui.notifications.warn("Please select one or more Targets.");
        }
    }
}

// Globalize this bad boy.
globalThis.WoundsCalculator = WoundsCalculator;
