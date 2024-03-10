import { MODULE_ID } from "./swade-targeted-damage.mjs";

export class TargetedDamageApplicator extends FormApplication {
    constructor(tokenActorUUID, damage, ap) {
        super();
        this.object.targetActorUuid = tokenActorUUID;
        this.object.damage = damage;
        this.object.ap = ap;
        this.object.user = game.user;
    }

    /** @override */
    static get defaultOptions() {
        const width = 320;
        const height = width * 4 / 3;

        return foundry.utils.mergeObject(super.defaultOptions, {
            title: game.i18n.localize('SWADETargetedDamage.Title'),
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
        this.object.actor = await fromUuid(this.object.targetActorUuid);
        await this.calcWounds();

        // Set Wounds text for message
        this.object.woundsText = this.getWoundsText();

        // If status is wounded...
        if (this.object.statusToApply === 'shaken' && this.object.wounds === 0) {
            // If Shaken, set message.
            this.object.message = game.i18n.format("SWADE.DamageApplicator.SoakDialog.ShakenPrompt", { name: this.object.actor.name });
        } else if (this.object.statusToApply === "shaken" && this.object.wounds === 1) {
            this.object.message = game.i18n.format("SWADETargetedDamage.WoundedFromShakenPrompt", { name: this.object.actor.name });
        } else if (this.object.statusToApply === 'wounded') {
            // Prompt to Soak the Wounds.
            this.object.message = game.i18n.format("SWADE.DamageApplicator.SoakDialog.WoundedPrompt", { name: this.object.actor.name, wounds: this.object.woundsText });
        } else if (this.object.statusToApply === 'none') {
            // If no status to apply because damage was too low, output a message saying such.
            this.object.message = game.i18n.format("SWADE.DamageApplicator.SoakDialog.UnharmedPrompt", { name: this.object.actor.name });
        }

        return await super.getData(options);
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
            this.object.actor.spendBenny();
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
            let totalActorWounds = this.object.actor.system.wounds.value + this.object.wounds

            // 2. Apply Incapacitated if the total wounds will be greater than max Wounds.
            if (totalActorWounds > this.object.actor.system.wounds.max) {
                await this.applyIncapacitated();
                // Cap the total Wounds at the Actor's max Wounds.
                totalActorWounds === this.object.actor.system.wounds.max;
            }

            // 3. Update the Actor's Wounds.
            await this.object.actor.update({ 'system.wounds.value': totalActorWounds });

            // Apply Gritty Damage if the setting rule is enabled
            if (game.settings.get('swade', 'grittyDamage')) {
                await this.rollGrittyDamage();
            }

            // Output chat message.
            const message = game.i18n.format("SWADETargetedDamage.IsShakenWithWounds", { name: this.object.actor.name, wounds: this.getWoundsText() });
            await this.outputChat(message);
            this.close();
        });
        html[0].querySelector('.apply-shaken')?.addEventListener('click', async () => {
            // Apply Shaken Status Effect.
            this.applyShaken();
            let message = game.i18n.format("SWADE.DamageApplicator.Result.IsShaken", { name: this.object.actor.name });

            if (this.object.wounds === 1 && this.object.statusToApply === 'shaken') {
                await this.object.actor.update({ 'system.wounds.value': this.object.actor.system.wounds.value + this.object.wounds });
                message = game.i18n.format("SWADETargetedDamage.WoundedFromShaken", { name: this.object.actor.name });
            }

            // Output chat message.
            await this.outputChat(message); this.close();
        });
        html[0].querySelector('.no-damage')?.addEventListener('click', async () => {
            // Output chat message.
            const message = game.i18n.format("SWADE.DamageApplicator.Result.NoSignificantDamage", { name: this.object.actor.name });
            await this.outputChat(message); this.close();
        });
    }

    async rollGrittyDamage() {
        const injuryTable = await fromUuid(game.settings.get("swade", "injuryTable"));
        await injuryTable.draw();
    }

    // for applying the Incapacitated Status Effect
    async applyIncapacitated() {
        // Check if they're already Incapacitated; we don't need to add another instance if so.
        const isIncapacitated = this.object.actor.effects.some((e) => e.label === game.i18n.localize('SWADE.Incap'));

        // If there is not such Status Effect, then apply it.
        if (!isIncapacitated) {
            const data = CONFIG.SWADE.statusEffects.find((s) => s.id === 'incapacitated');
            await this.object.actor.toggleActiveEffect(data, { active: true });
        }
    }

    async applyShaken() {
        const isShaken = this.object.actor.system.status.isShaken;

        if (!isShaken) {
            const data = CONFIG.SWADE.statusEffects.find(s => s.id === 'shaken');
            await this.object.actor.toggleActiveEffect(data, { active: true });
        }
    }

    // to roll for Soaking Wounds.
    async attemptSoak(options = {}) {
        const soakModifiers = [
            {
                label: game.i18n.localize('SWADE.DamageApplicator.SoakModifier'),
                value: this.object.actor.system.attributes.vigor.soakBonus,
            },
        ];

        if (game.settings.get('swade', 'unarmoredHero') && this.object.actor.isUnarmored) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Settings.UnarmoredHero.Name'),
                value: 2,
            });
        }

        if (options?.isReroll && this.object.actor.getFlag('swade', 'elan')) {
            soakModifiers.push({
                label: game.i18n.localize('SWADE.Elan'),
                value: 2,
            });
        }

        // Roll Vigor and get the data.
        let vigorRoll = await this.object.actor.rollAttribute('vigor', { isRerollable: false });
        let message;
        // Calculate how many Wounds have been Soaked with the roll
        const woundsSoaked = Math.floor(vigorRoll.total / 4);
        // Get the number of current Wounds the Actor has.
        const existingWounds = this.object.actor.system.wounds.value;
        // Get the maximum amount of Wounds the Actor can suffer before Incapacitation.
        const maxWounds = this.object.actor.system.wounds.max;
        // Calculate how many Wounds are remaining after Soaking.
        this.object.wounds -= woundsSoaked;

        // If there are no remaining Wounds, output message that they Soaked all the Wounds.
        if (this.object.wounds <= 0) {
            message = game.i18n.format("SWADE.DamageApplicator.Result.SoakedAll", { name: this.object.actor.name });
            await this.outputChat(message);
            this.close();
        } else {
            // Otherwise, calculate how many Wounds the Actor now has.
            this.object.wounds = existingWounds + this.object.wounds;

            // Set the Wounds, but if it's beyond the maximum, set it to the maximum.
            if (this.object.wounds > maxWounds) {
                this.object.wounds = maxWounds;
            }

            // If they already attempted to Soak, set Wounds remaining to whatever their best roll yielded so far.
            if (!this.object.bestSoakAttempt || (!!this.object.bestSoakAttempt && this.object.wounds < this.object.bestSoakAttempt)) {
                this.object.bestSoakAttempt = this.object.wounds;
            }

            // Construct text for number of Wounds remaining.
            this.object.woundsText = this.getWoundsText();
            await this.render(true);
        }
    }

    // for translating damage to Wounds.
    async calcWounds() {
        // Get Toughness values.
        let { armor, value } = this.object.actor.system.stats.toughness;

        // If the Actor is a vehicle, get appropriate values.
        if (this.object.actor.type === "vehicle") {
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
        this.object.wounds = Math.floor(excess / 4);
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

            if (this.object.actor.system.status.isShaken && this.object.wounds === 0) {
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
        const content = await renderTemplate(`/modules/${MODULE_ID}/templates/chat/damage-result.hbs`, {
            message,
            ap: this.object.ap,
            damage: this.object.damage,
            toughness: this.object.actor.system.stats.toughness.value,
            armor: this.object.actor.system.stats.toughness.armor,
        });
        await ChatMessage.create({ content });
    }
}