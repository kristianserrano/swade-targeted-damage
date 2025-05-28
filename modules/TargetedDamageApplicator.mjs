import { MODULE_ID } from "./swade-targeted-damage.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export class TargetedDamageApplicator extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options = {}) {
        super(options);

        this.object = {
            tokenUuid: options.token.uuid,
            rolledDamage: options.damage,
            rolledAP: options.ap,
            damage: options.damage,
            ap: options.ap,
            user: game.user,
            attemptedSoak: false,
            bestSoakAttempt: 0,
        };
    }

    static DEFAULT_OPTIONS = {
        tag: 'form',
        form: {
            handler: TargetedDamageApplicator.updateObject,
            closeOnSubmit: false,
            submitOnChange: false,
        },
        actions: {
            bennySoak: TargetedDamageApplicator.onBennySoak,
            bennyGMSoak: TargetedDamageApplicator.onBennyGMSoak,
            freeSoak: TargetedDamageApplicator.onFreeSoak,
            takeWounds: TargetedDamageApplicator.onTakeWounds,
            applyShaken: TargetedDamageApplicator.onApplyShaken,
            noDamage: TargetedDamageApplicator.onNoDamage,
        },
        window: {
            width: 320,
            height: 'auto',
        },
        classes: ['swade-targeted-damage', 'targeted-damage-applicator'],
    };

    static PARTS = {
        fieldset: {
            template: `modules/swade-targeted-damage/templates/apps/targeted-damage-applicator/input-fields.hbs`,
        },
        buttons: {
            template: `modules/swade-targeted-damage/templates/apps/targeted-damage-applicator/buttons.hbs`,
        },
    };


    get actor() {
        return this.options.token.actor;
    }

    get title() {
        return `${game.i18n.localize('SWADETargetedDamage.Title')}: ${this.actor.name}`;
    }

    async _prepareContext(context, options) {
        context = await super._prepareContext(options);
        context.actor = this.actor;
        await this.calcWounds();

        // Set Wounds text for message
        this.object.woundsText = this.getWoundsText();

        // If status is wounded...
        if (this.object.statusToApply === 'shaken' && this.object.wounds === 0) {
            // If Shaken, set message.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Shaken", { name: context.actor.name });
        } else if (this.object.statusToApply === "shaken" && this.object.wounds === 1) {
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundedFromShaken", { name: context.actor.name });
        } else if (this.object.statusToApply === 'wounded') {
            // Prompt to Soak the Wounds.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundsAboutToBeTaken", { name: context.actor.name, wounds: this.object.woundsText });
        } else if (this.object.statusToApply === 'none') {
            // If no status to apply because damage was too low, output a message saying such.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Unharmed", { name: context.actor.name });
        }

        context.object = this.object;
        return context;
    }

    static async updateObject(event, form, formData) {
        this.object = foundry.utils.mergeObject(this.object, formData.object);
        await this.render({
            parts: ['buttons'],
            force: true,
        });
    }

    static async onBennyGMSoak(event, target) {
        const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
        this.object.user.spendBenny();
        await this.attemptSoak({ isReroll });
    }

    static async onBennySoak(event, target) {
        const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
        this.actor.spendBenny();
        await this.attemptSoak({ isReroll });
    }

    static async onFreeSoak(event, target) {
        const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
        await this.attemptSoak({ isReroll });
    }

    static async onTakeWounds(event, target) {
        // 1. Apply Shaken
        await this.applyShaken();
        // Calculate the total amount of Wounds the Actor will have.
        let totalActorWounds = this.actor.system.wounds.value + this.object.wounds;

        // 2. Apply Incapacitated if the total wounds will be greater than max Wounds.
        if (totalActorWounds > this.actor.system.wounds.max) {
            await this.applyIncapacitated();
            // Cap the total Wounds at the Actor's max Wounds.
            totalActorWounds = this.actor.system.wounds.max;
        }

        // 3. Update the Actor's Wounds.
        await this.actor.update({ 'system.wounds.value': totalActorWounds });

        // 4. Apply Gritty Damage if the setting rule is enabled and a table is configured.
        const injuryTable = await fromUuid(game.settings.get("swade", "injuryTable"))

        if (game.settings.get('swade', 'grittyDamage') && injuryTable) {
            // If the Injury Table is set, roll for Gritty Damage.
            await injuryTable.draw();
        }

        // Output chat message.
        const message = game.i18n.format("SWADETargetedDamage.Result.ShakenWithWounds", { name: this.actor.name, wounds: this.getWoundsText() });
        await this.outputChat(message);
        this.close();
    }

    static async onApplyShaken(event, target) {
        // Apply Shaken Status Effect.
        this.applyShaken();
        let message = game.i18n.format("SWADETargetedDamage.Result.Shaken", { name: this.actor.name });

        if (this.object.wounds === 1) {
            // Calculate the total amount of Wounds the Actor will have.
            let totalActorWounds = this.actor.system.wounds.value + this.object.wounds;

            // Apply Incapacitated if the total wounds will be greater than max Wounds.
            if (totalActorWounds > this.actor.system.wounds.max) {
                await this.applyIncapacitated();
                // Cap the total Wounds at the Actor's max Wounds.
                totalActorWounds = this.actor.system.wounds.max;
            }

            await this.actor.update({ 'system.wounds.value': totalActorWounds });
            message = game.i18n.format("SWADETargetedDamage.Result.WoundedFromShaken", { name: this.actor.name });
        }

        // Output chat message.
        await this.outputChat(message); this.close();
    }

    static async onNoDamage(event, target) {
        // Output chat message.
        const message = game.i18n.format("SWADETargetedDamage.Result.NoSignificantDamage", { name: this.actor.name });
        await this.outputChat(message); this.close();
    }

    async refreshObject() {
        await this.calcWounds();

        // Set Wounds text for message
        this.object.woundsText = this.getWoundsText();

        // If status is wounded...
        if (this.object.statusToApply === 'shaken' && this.object.wounds === 0) {
            // If Shaken, set message.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Shaken", { name: this.actor.name });
        } else if (this.object.statusToApply === "shaken" && this.object.wounds === 1) {
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundedFromShaken", { name: this.actor.name });
        } else if (this.object.statusToApply === 'wounded') {
            // Prompt to Soak the Wounds.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundsAboutToBeTaken", { name: this.actor.name, wounds: this.object.woundsText });
        } else if (this.object.statusToApply === 'none') {
            // If no status to apply because damage was too low, output a message saying such.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Unharmed", { name: this.actor.name });
        }
    }

    // for applying the Incapacitated Status Effect
    async applyIncapacitated() {
        // Check if they're already Incapacitated; we don't need to add another instance if so.
        const isIncapacitated = this.actor.effects.some((e) => e.name === game.i18n.localize('SWADE.Incap'));

        // If there is not such Status Effect, then apply it.
        if (!isIncapacitated) {
            const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
            await this.actor.toggleActiveEffect(data, { active: true });
        }
    }

    async applyShaken() {
        const isShaken = this.actor.system.status.isShaken;

        if (!isShaken) {
            const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
            await this.actor.toggleActiveEffect(data, { active: true });
        }
    }

    // to roll for Soaking Wounds.
    async attemptSoak(options = {}) {
        const soakModifiers = [
            {
                label: game.i18n.localize('SWADETargetedDamage.SoakModifier'),
                value: this.actor.system.attributes.vigor.soakBonus,
            },
        ];

        if (game.settings.get('swade', 'unarmoredHero') && this.actor.isUnarmored) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Settings.UnarmoredHero.Name'),
                value: 2,
            });
        }

        if (options?.isReroll && this.actor.getFlag('swade', 'elan')) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Elan'),
                value: 2,
            });
        }

        // Roll Vigor and get the data.
        const vigorRoll = await this.actor.rollAttribute('vigor', {
            title: game.i18n.localize('SWADETargetedDamage.SoakRoll'),
            flavour: game.i18n.localize('SWADETargetedDamage.SoakRoll'),
            additionalMods: soakModifiers,
            isRerollable: false,
        });

        if (vigorRoll) {
            // Calculate how many Wounds have been Soaked with the roll
            const woundsSoaked = Math.floor(vigorRoll.total / 4);

            // If they already attempted to Soak, set Wounds remaining to whatever their best roll yielded so far.
            if (woundsSoaked > this.object.bestSoakAttempt) {
                // Restore original Wounds amount.
                this.object.wounds += this.object.bestSoakAttempt;
                // Replace best Soak attempt.
                this.object.bestSoakAttempt = woundsSoaked;
                // Subtract the wounds  soaked from the wounds to be applied.
                this.object.wounds -= this.object.bestSoakAttempt;
            }

            let message;

            // If there are no remaining Wounds, output message that they Soaked all the Wounds.
            if (this.object.wounds <= 0) {
                message = game.i18n.format("SWADETargetedDamage.Result.SoakedAll", { name: this.actor.name });
                await this.outputChat(message);
                this.close();
            } else {
                this.object.attemptedSoak = true;
                this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Reroll", { name: this.actor.name });
                await this.render(true);
            }
        }
    }

    // for translating damage to Wounds.
    async calcWounds() {
        // Get Toughness values.
        let { armor, value } = this.actor.system.stats.toughness;

        // If the Actor is a vehicle, get appropriate values.
        if (this.actor.type === "vehicle") {
            armor = Number(actor.system.toughness.armor);
            value = Number(actor.system.toughness.total);
        }

        // AP vs Armor
        const apNeg = Math.min(this.object.ap, armor);
        // New Toughness
        const newT = value - apNeg;
        // Calculate how much over.
        const excess = this.object.damage - newT;
        // Translate damage raises to Wounds.
        this.object.wounds = this.object.bestSoakAttempt > 0 ? this.object.wounds : Math.floor(excess / 4);
        // Check if Wound Cap is in play.
        const woundCapEnabled = game.settings.get('swade', 'woundCap');

        // If Wound Cap, limit Wounds inflicted (i.e. to Soak) to 4
        if (woundCapEnabled && this.object.wounds > 4) {
            this.object.wounds = 4;
        }

        // Default status to apply as none.
        this.object.statusToApply = 'none';

        // If damage meets Toughness without a raise.
        if (excess >= 0 && excess < 4) {
            // Set status to Shaken.
            this.object.statusToApply = "shaken";

            if (this.actor.system.status.isShaken && this.object.wounds === 0) {
                this.object.wounds = 1;
            }
        } else if (excess >= 4) {
            // If damage is a raise over Toughness, set status to wounded
            this.object.statusToApply = "wounded";
        }
    }

    getWoundsText() {
        return `${this.object.wounds} ${this.object.wounds > 1 || this.object.wounds === 0 ? game.i18n.format("SWADE.Wounds") : game.i18n.format("SWADE.Wound")}`;
    }

    async outputChat(message) {
        const msgData = {
            message,
            ap: this.object.ap,
            damage: this.object.damage,
            rolledAP: this.object.rolledAP,
            rolledDamage: this.object.rolledDamage,
            isAdjusted: this.object.rolledAP !== this.object.ap || this.object.rolledDamage !== this.object.damage,
        };

        if (!game.settings.get(MODULE_ID, 'hide-defense-values')) {
            msgData.toughness = this.actor.system.stats.toughness.value;
            msgData.armor = this.actor.system.stats.toughness.armor;
        }

        const content = await foundry.applications.handlebars.renderTemplate(`/modules/${MODULE_ID}/templates/chat/damage-result.hbs`, msgData);

        const chatMessageData = {
            content,
        };
        await ChatMessage.create(chatMessageData);
    }

    // to trigger the workflow either on the current client or on other client(s).
    static async triggerFlow(targets, damage, ap) {
        // For each token targeted...
        for (const target of targets) {
            // Determine whether there are any owners that are not GMs.
            const hasPlayerOwner = target.actor.hasPlayerOwner;

            if (hasPlayerOwner) {
                // Get the player to whom this actor might be assigned.
                const activeAssignedPlayer = game.users.find((u) => u.active && u.character?.id === target.actor.id);
                const activePlayerOwners = game.users.filter((u) => !u.isGM && u.active && (target.actor.ownership[u.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER || target.actor.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER));

                if (activeAssignedPlayer || activePlayerOwners.length) {
                    // If there's multiple player owners.
                    if (!activeAssignedPlayer && game.user.isGM && (activePlayerOwners.length > 1 || target.actor.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
                        const buttons = [];
                        const targetPlayers = activePlayerOwners.length ? activePlayerOwners : game.users.filter(u => !u.isGM && u.active);

                        // Create a button for each player that owns the Token's Actor.
                        for (const player of targetPlayers) {
                            buttons.push({
                                action: `select${player.id}`,
                                label: player.name,
                                callback: () => {
                                    TargetedDamageApplicator.promptOtherUser(target.document.uuid, player, damage, ap);
                                    return `${player.name} has been selected to handle the damage for ${target.name}.`;
                                }
                            });
                        }

                        new foundry.applications.api.DialogV2({
                            window: {
                                title: game.i18n.format("SWADETargetedDamage.ChoosePlayer.Title"),
                            },
                            content: `${game.i18n.format("SWADETargetedDamage.ChoosePlayer.Prompt", { name: target.name })}`,
                            buttons,
                            classes: ['swade-targeted-damage', 'player-selection'],
                        }).render({ force: true });
                    } else if (activeAssignedPlayer || activePlayerOwners.length === 1) {
                        // Get the player owning the Token's Actor.
                        const playerOwner = !!activeAssignedPlayer ? activeAssignedPlayer : activePlayerOwners[0];

                        if (playerOwner === game.user) {
                            await new TargetedDamageApplicator({token: target.document,
                                damage,
                                ap}).render(true);
                        } else {
                            TargetedDamageApplicator.promptOtherUser(target.document.uuid, playerOwner, damage, ap);
                        }
                    }
                } else if (game.user.isGM) {
                    await new TargetedDamageApplicator({token: target.document,
                        damage,
                        ap}).render(true);
                }
            } else if (game.user.isGM) {
                await new TargetedDamageApplicator({token: target.document,
                    damage,
                    ap}).render(true);
            } else {
                TargetedDamageApplicator.promptOtherUser(target.document.uuid, game.users.activeGM, damage, ap);
            }
        }
    }

    static async promptOtherUser(targetUuid, targetUser, damage, ap) {
        const data = {
            targetUuid,
            targetUserId: targetUser?.id,
            damage,
            ap,
        };

        await targetUser.query(`${MODULE_ID}.renderTargetedDamageApp`, data);
    }

    static async renderTargetedDamageApp({ targetUuid, damage, ap, targetUserId }) {
        if (game.userId !== targetUserId) return;
        const token = await fromUuid(targetUuid);
        await new TargetedDamageApplicator({
            token,
            damage,
            ap,
            targetUserId,
        }).render(true);
    }
}
