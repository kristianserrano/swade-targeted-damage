import { MODULE_ID } from "./swade-targeted-damage.mjs";

export class TargetedDamageApplicator extends FormApplication {
    constructor(tokenUuid, damage, ap) {
        super();
        this.object.tokenUuid = tokenUuid;
        this.object.rolledDamage = damage;
        this.object.rolledAP = ap;
        this.object.damage = damage;
        this.object.ap = ap;
        this.object.user = game.user;
        this.object.attemptedSoak = false;
        this.object.bestSoakAttempt = 0;
    }

    /** @override */
    static get defaultOptions() {
        const width = 320;
        const height = width * 4 / 3;

        return foundry.utils.mergeObject(super.defaultOptions, {
            title: `${game.i18n.localize('SWADETargetedDamage.Title')}`,
            template: `modules/${MODULE_ID}/templates/apps/targeted-damage.hbs`,
            width,
            height,
            closeOnSubmit: false,
            submitOnClose: false,
            submitOnChange: true,
            classes: ['swade-app', MODULE_ID],
            resizable: true,
        });
    }

    /** @override */
    async getData(options = {}) {
        await this.refreshObject();
        return await super.getData(options);
    }

    /** @override */
    async _render(force = false, options = {}) {
        await super._render(force, options);
        await this.refreshObject();
    }

    /** @override */
    async _updateObject(event, formData) {
        await this.render(true);
    }

    async activateListeners(html) {
        super.activateListeners(html);
        html[0].querySelector('#damage').addEventListener('change', (event) => {
            this.object.damage = Number(event.currentTarget.value);
        });
        html[0].querySelector('#ap').addEventListener('change', (event) => {
            this.object.ap = Number(event.currentTarget.value);
        });
        html[0].querySelector('.benny-gm-soak')?.addEventListener('click', async (event) => {
            const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
            this.object.user.spendBenny();
            await this.attemptSoak({ isReroll });
        });
        html[0].querySelector('.benny-soak')?.addEventListener('click', async (event) => {
            const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
            this.object.token.actor.spendBenny();
            await this.attemptSoak({ isReroll });
        });
        html[0].querySelector('.free-soak')?.addEventListener('click', async (event) => {
            const isReroll = event.currentTarget.dataset.isReroll === 'true' ? true : false;
            await this.attemptSoak({ isReroll });
        });
        html[0].querySelector('.take-wounds')?.addEventListener('click', async () => {
            // 1. Apply Shaken
            await this.applyShaken();
            // Calculate the total amount of Wounds the Actor will have.
            let totalActorWounds = this.object.token.actor.system.wounds.value + this.object.wounds;

            // 2. Apply Incapacitated if the total wounds will be greater than max Wounds.
            if (totalActorWounds > this.object.token.actor.system.wounds.max) {
                await this.applyIncapacitated();
                // Cap the total Wounds at the Actor's max Wounds.
                totalActorWounds = this.object.token.actor.system.wounds.max;
            }

            // 3. Update the Actor's Wounds.
            await this.object.token.actor.update({ 'system.wounds.value': totalActorWounds });

            // Apply Gritty Damage if the setting rule is enabled
            if (game.settings.get('swade', 'grittyDamage')) {
                await this.rollGrittyDamage();
            }

            // Output chat message.
            const message = game.i18n.format("SWADETargetedDamage.Result.ShakenWithWounds", { name: this.object.token.name, wounds: this.getWoundsText() });
            await this.outputChat(message);
            this.close();
        });
        html[0].querySelector('.apply-shaken')?.addEventListener('click', async () => {
            // Apply Shaken Status Effect.
            this.applyShaken();
            let message = game.i18n.format("SWADETargetedDamage.Result.Shaken", { name: this.object.token.name });

            if (this.object.wounds === 1) {
                // Calculate the total amount of Wounds the Actor will have.
                let totalActorWounds = this.object.token.actor.system.wounds.value + this.object.wounds;

                // Apply Incapacitated if the total wounds will be greater than max Wounds.
                if (totalActorWounds > this.object.token.actor.system.wounds.max) {
                    await this.applyIncapacitated();
                    // Cap the total Wounds at the Actor's max Wounds.
                    totalActorWounds = this.object.token.actor.system.wounds.max;
                }

                await this.object.token.actor.update({ 'system.wounds.value': totalActorWounds });
                message = game.i18n.format("SWADETargetedDamage.Result.WoundedFromShaken", { name: this.object.token.name });
            }

            // Output chat message.
            await this.outputChat(message); this.close();
        });
        html[0].querySelector('.no-damage')?.addEventListener('click', async () => {
            // Output chat message.
            const message = game.i18n.format("SWADETargetedDamage.Result.NoSignificantDamage", { name: this.object.token.name });
            await this.outputChat(message); this.close();
        });
    }

    async refreshObject() {
        this.object.token = await fromUuid(this.object.tokenUuid);
        await this.calcWounds();

        // Set Wounds text for message
        this.object.woundsText = this.getWoundsText();

        // If status is wounded...
        if (this.object.statusToApply === 'shaken' && this.object.wounds === 0) {
            // If Shaken, set message.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Shaken", { name: this.object.token.name });
        } else if (this.object.statusToApply === "shaken" && this.object.wounds === 1) {
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundedFromShaken", { name: this.object.token.name });
        } else if (this.object.statusToApply === 'wounded') {
            // Prompt to Soak the Wounds.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.WoundsAboutToBeTaken", { name: this.object.token.name, wounds: this.object.woundsText });
        } else if (this.object.statusToApply === 'none') {
            // If no status to apply because damage was too low, output a message saying such.
            this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Unharmed", { name: this.object.token.name });
        }
    }

    async rollGrittyDamage() {
        const injuryTable = await fromUuid(game.settings.get("swade", "injuryTable"));
        await injuryTable.draw();
    }

    // for applying the Incapacitated Status Effect
    async applyIncapacitated() {
        // Check if they're already Incapacitated; we don't need to add another instance if so.
        const isIncapacitated = this.object.token.actor.effects.some((e) => e.name === game.i18n.localize('SWADE.Incap'));

        // If there is not such Status Effect, then apply it.
        if (!isIncapacitated) {
            const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
            await this.object.token.actor.toggleActiveEffect(data, { active: true });
        }
    }

    async applyShaken() {
        const isShaken = this.object.token.actor.system.status.isShaken;

        if (!isShaken) {
            const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
            await this.object.token.actor.toggleActiveEffect(data, { active: true });
        }
    }

    // to roll for Soaking Wounds.
    async attemptSoak(options = {}) {
        const soakModifiers = [
            {
                label: game.i18n.localize('SWADETargetedDamage.SoakModifier'),
                value: this.object.token.actor.system.attributes.vigor.soakBonus,
            },
        ];

        if (game.settings.get('swade', 'unarmoredHero') && this.object.token.actor.isUnarmored) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Settings.UnarmoredHero.Name'),
                value: 2,
            });
        }

        if (options?.isReroll && this.object.token.actor.getFlag('swade', 'elan')) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Elan'),
                value: 2,
            });
        }

        // Roll Vigor and get the data.
        const vigorRoll = await this.object.token.actor.rollAttribute('vigor', {
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
                message = game.i18n.format("SWADETargetedDamage.Result.SoakedAll", { name: this.object.token.name });
                await this.outputChat(message);
                this.close();
            } else {
                this.object.attemptedSoak = true;
                this.object.message = game.i18n.format("SWADETargetedDamage.Prompt.Reroll", { name: this.object.token.name });
                await this.render(true);
            }
        }
    }

    // for translating damage to Wounds.
    async calcWounds() {
        // Get Toughness values.
        let { armor, value } = this.object.token.actor.system.stats.toughness;

        // If the Actor is a vehicle, get appropriate values.
        if (this.object.token.actor.type === "vehicle") {
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

            if (this.object.token.actor.system.status.isShaken && this.object.wounds === 0) {
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
        }

        if (!game.settings.get(MODULE_ID, 'hide-defense-values')) {
            msgData.toughness = this.object.token.actor.system.stats.toughness.value;
            msgData.armor = this.object.token.actor.system.stats.toughness.armor;
        }

        const content = await renderTemplate(`/modules/${MODULE_ID}/templates/chat/damage-result.hbs`, msgData);

        const chatMessageData = {
            content,
        }
        await ChatMessage.create(chatMessageData);
    }
}