class TargetedDamageApplicator extends FormApplication {
    constructor(damage, ap, reroll = false) {
        super();
        this.damage = damage;
        this.ap = ap;
        this.reroll = reroll;
    }

    // for applying the Incapacitated Status Effect
    async applyIncapacitated(actor) {
        // Check if they're already Incapacitated; we don't need to add another instance if so.
        const isIncapacitated = actor.effects.find((e) => e.label === 'Incapacitated');

        // If there is not such Status Effect, then apply it.
        if (isIncapacitated === undefined) {
            const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
            await actor.toggleActiveEffect(data, { active: true });
        }
    }

    async promptGrittyDamage() {
        const injuryTableId = game.settings.get("swade", "injuryTable");
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
            title: game.i18n.format("SWADA.GrittyDamage"),
            content: `<p>${game.i18n.format("SWADA.RollGrittyDamageDesc")}</p>`,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async () => {
                        await injuryTable.draw();
                    }
                },
                cancel: {
                    label: "Cancel"
                }
            }
        }).render(true);
    }

    async applyShaken(actor) {
        const isShaken = actor.system.status.isShaken;

        if (!isShaken) {
            const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
            await actor.toggleActiveEffect(data, { active: true });
        }
    }

    // to roll for Soaking Wounds.
    async attemptSoak(actor, woundsInflicted, statusToApply, woundsText, bestSoakAttempt = null) {
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
            message = game.i18n.format("SWADA.soakedAll", { name: actor.name });
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
            const woundsRemainingText = `${woundsRemaining} ${woundsRemaining > 1 || woundsRemaining === 0 ? game.i18n.format("SWADA.wounds") : game.i18n.format("SWADA.wound")}`;

            // Open Dialog to reroll with a Benny, reroll for free, or accept the Wounds.
            const rerollSoakDialog = new Dialog({
                title: game.i18n.format("SWADA.rerollSoakTitle", { name: actor.name }),
                content: game.i18n.format("SWADA.rerollSoakDmgPrompt", { name: actor.name, wounds: woundsRemainingText }),
                buttons: {
                    rerollBenny: {
                        label: game.i18n.format("SWADE.DamageApplicator.RerollSoakDialog.Benny"),
                        callback: async () => {
                            if (actor.isWildcard) {
                                actor.spendBenny();
                            } else if (!actor.isWildcard && game.user.isGM) {
                                game.user.spendBenny();
                            }

                            await this.attemptSoak(actor, woundsInflicted, statusToApply, woundsText, woundsRemaining);
                        }
                    },
                    rerollFree: {
                        label: game.i18n.format("SWADE.DamageApplicator.RerollSoakDialog.Free"),
                        callback: async () => {
                            await this.attemptSoak(actor, woundsInflicted, statusToApply, woundsText, woundsRemaining);
                        }
                    },
                    accept: {
                        label: game.i18n.format("SWADE.DamageApplicator.RerollSoakDialog.TakeWounds", { wounds: woundsRemainingText }),
                        callback: async () => {
                            // Construct text for the new Wounds value to be accepted (singular or plural Wounds).
                            const newWoundsValueText = `${newWoundsValue} ${newWoundsValue > 1 || newWoundsValue === 0 ? game.i18n.format("SWADA.wounds") : game.i18n.format("SWADA.wound")}`;

                            if (statusToApply === 'shaken') {
                                await this.applyShaken(actor);

                                if (actor.system.status.isShaken) {
                                    statusToApply = 'wounded';
                                } else {
                                    // Is Shaken
                                    message = game.i18n.format("SWADE.DamageApplicator.Result.IsShakenWithWounds", { name: actor.name });
                                }
                            }
                            if (statusToApply === 'wounded') {
                                // Update Wounds
                                await actor.update({ 'system.wounds.value': newWoundsValue });
                                // Is Shaken with Wounds
                                message = game.i18n.format("SWADE.DamageApplicator.Result.IsShakenWithWounds", { name: actor.name, wounds: newWoundsValueText });

                                // Apply Status Effects: Incapacitated or Shaken.
                                if (totalWounds > maxWounds) {
                                    await this.applyIncapacitated(actor);
                                    message = game.i18n.format("SWADE.DamageApplicator.Result.IsIncapacitated", { name: actor.name });
                                    await ChatMessage.create({ content: message });
                                } else {
                                    await this.applyShaken(actor);
                                    message = game.i18n.format("SWADE.DamageApplicator.Result.IsShakenWithWounds", { name: actor.name, wounds: newWoundsValueText });
                                }

                                // Output Chat Message.
                                await ChatMessage.create({ content: message });

                                // If Gritty Damage is in play, prompt for Gritty Damage.
                                if (game.settings.get('swade', "grittyDamage")) {
                                    await this.promptGrittyDamage();
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

    // for prompting to Soak.
    async soakPrompt(actor, damage, ap, woundsInflicted, statusToApply) {
        // Set Wounds text for chat message
        const woundsText = `${woundsInflicted} ${woundsInflicted > 1 ? game.i18n.format("SWADA.wounds") : game.i18n.format("SWADA.wound")}`;
        // Text for Wounds about to be taken.
        let message = game.i18n.format("SWADE.DamageApplicator.WoundsAboutToBeTaken", { name: actor.name, wounds: woundsText });
        // Create the message
        await ChatMessage.create({ content: message });

        // Construct the Dialog for Soaking
        const soakDialog = new Dialog({
            title: game.i18n.format("SWADE.DamageApplicator.SoakDialog.WoundedTitle", { name: actor.name }),
            content: game.i18n.format("SWADE.DamageApplicator.SoakDialog.WoundedPrompt", { name: actor.name, wounds: woundsText }),
            buttons: {
                gmBenny: {
                    label: game.i18n.format("SWADE.DamageApplicator.SoakDialog.Benny"),
                    callback: async () => {
                        if (game.user.isGM && game.user.bennies > 0) {
                            game.user.spendBenny();
                        }

                        await this.attemptSoak(actor, woundsInflicted, statusToApply, woundsText);
                    }
                },
                soakBenny: {
                    label: game.i18n.format("SWADE.DamageApplicator.SoakDialog.Benny"),
                    callback: async () => {
                        if (actor.isWildcard && actor.bennies > 0) {
                            actor.spendBenny();
                        } else if (!actor.isWildcard && game.user.isGM && game.user.bennies > 0) {
                            game.user.spendBenny();
                        }

                        await this.attemptSoak(actor, woundsInflicted, statusToApply, woundsText);
                    }
                },
                soakFree: {
                    label: game.i18n.format("SWADE.DamageApplicator.SoakDialog.Free"),
                    callback: async () => {
                        await this.attemptSoak(actor, woundsInflicted, statusToApply, woundsText);
                    }
                },
                take: {
                    label: game.i18n.format("SWADE.DamageApplicator.SoakDialog.TakeWounds", { wounds: woundsText }),
                    callback: async () => {
                        const existingWounds = actor.system.wounds.value;
                        const maxWounds = actor.system.wounds.max;
                        const totalWounds = existingWounds + woundsInflicted;
                        const newWoundsValue = totalWounds < maxWounds ? totalWounds : maxWounds;
                        let message = game.i18n.format("SWADA.isShakenWithWounds", { name: actor.name, wounds: woundsText });
                        await actor.update({ 'system.wounds.value': newWoundsValue });

                        if (totalWounds > maxWounds) {
                            await this.applyIncapacitated(actor);
                            message = game.i18n.format("SWADA.incapacitated", { name: actor.name });
                        } else {
                            await this.applyShaken(actor);
                        }

                        await ChatMessage.create({ content: message });

                        if (game.settings.get('swade', "grittyDamage")) {
                            await this.promptGrittyDamage();
                        }
                    }
                },
                adjust: {
                    label: game.i18n.format("SWADA.adjustDamage"),
                    callback: async () => {
                        this.adjustDamageValues(actor, damage, ap);
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

    // for translating damage to Wounds.
    async calcWounds(actor, damage, ap) {
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
        // Check if Wound Cap is in play.
        const woundCap = game.settings.get('swade', 'woundCap');
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
            message = game.i18n.format("SWADA.isShaken", { name: actor.name });
            // Apply Shaken Status Effect.
            await this.applyShaken(actor);
            // Output chat message.
            await ChatMessage.create({ content: message });
        } else if (statusToApply === 'none') {
            // If no status to apply because damage was too low, output a message saying such.
            message = game.i18n.format("SWADA.noSignificantDamage", { name: actor.name });
            await ChatMessage.create({ content: message });
        }
    }

    // to take in and set adjusted Damage Values
    adjustDamageValues(actor, damage, ap) {
        // TODO: Add options for called shots. Extract armor values for targeted areas from Actor data.
        // Construct dialog with fields for damage and AP values.
        new Dialog({
            title: game.i18n.format("SWADA.title"),
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
                    label: game.i18n.format("SWADA.calculate"),
                    callback: async (html) => {
                        const damage = Number(html.find("#damage")[0].value);
                        const ap = Number(html.find("#ap")[0].value);
                        // Calculate the Wounds.
                        await this.calcWounds(actor, damage, ap);
                    }
                }
            },
            default: "calculate"
        }, { classes: appCssClasses }).render(true);
    }

    // to prompt whether to adjust damage before Wounds are calculated.
    async adjustDamagePrompt({ tokenActorUUID, damage, ap, targetUserId }) {
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

        if ((!targetUserId && this.promptThisUser(actor, damage, ap)) || (targetUserId && game.userId === targetUserId)) {
            Dialog.confirm({
                title: game.i18n.format("SWADA.adjustDamageTitle", { name: actor.name }),
                content: game.i18n.format("SWADA.adjustDamagePrompt", { name: actor.name }),
                yes: () => this.adjustDamageValues(actor, damage, ap),
                no: async () => await this.calcWounds(actor, damage, ap),
                defaultYes: false
            }, { classes: appCssClasses });
        }
    }

    // to determine if this client's user should be prompted.
    promptThisUser(actor, damage, ap) {
        // Find the player who has selected this Target Actor as their character and is active, if any.
        const activeCharacterPlayer = game.users.find((u) => u.character && u.character.id === actor.id && u.active);
        // Is the active character player the current user?
        const userIsActiveCharacterPlayer = activeCharacterPlayer && activeCharacterPlayer.id === game.userId;
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
        const multipleActiveOwners = activePlayerOwners.length > 1 || (multipleActivePlayers.length > 1 && defaultOwnership);
        // Is there any player owner available?
        const noUniquePlayerOwnerAvailable = !activeCharacterPlayer && multipleActiveOwners;

        // Prompt this user if the user is the player to whom the Target Actor is assigned,
        // or if the user is a player and has owner permissions and there are not other active players with owner permissions.
        if (userIsActiveCharacterPlayer || (!userIsGM && userHasOwnerPermission && !multipleActiveOwners)) return true;

        // Prompt this user if the user is a player, is not assigned the Target Actor, and there are no other active players with owner permissions,
        // but the user either has owner permissions or the Target Actor's default ownership is owner.
        if (!activeCharacterPlayer && !userIsGM && !multipleActiveOwners && (userHasOwnerPermission || defaultOwnership)) return true;

        // Prompt the GM to select a player to prompt if they are the GM and there are multiple active players with owner permission.
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
                title: game.i18n.format("SWADA.ChoosePlayerTitle"),
                content: `${game.i18n.format("SWADA.ChoosePlayerPrompt", { name: actor.name })}`,
                buttons: buttons,
                default: ""
            }, { classes: appCssClasses }).render(true);

            return false;
        }

        // Prompt the user if they are the GM and there is no player assigned the Target Actor, no other active player owners with assigned permissions, and no other players that have default ownership.
        if (userIsGM && !activeCharacterPlayer && !activePlayerOwners.length && !multipleActiveOwners && !defaultOwnership) return true;

        return false;
    }

    // to trigger the workflow either on the current client or on other client(s).
   async triggerFlow(targets, damage, ap) {
        // For each token targeted...
        for (const target of targets) {
            // Determine whether there are any owners that are not GMs.
            const characterPlayer = game.users.find((u) => u.character && u.character.id === target.actor.id);
            const targetUserId = !!characterPlayer ? characterPlayer.id : null;

            if (this.promptThisUser(target.actor, damage, ap)) {
                await this.adjustDamagePrompt({
                    tokenActorUUID: target.actor.uuid,
                    damage: damage,
                    ap: ap
                });
            } else {
                game.socket.emit(`module.${MODULE_TITLE}`, {
                    tokenActorUUID: target.actor.uuid,
                    damage: damage,
                    ap: ap,
                    targetUserId
                });
            }
        }
    }
}