import { TargetedDamageApplicator } from "./TargetedDamageApplicator.mjs";

export const MODULE_ID = "swade-targeted-damage";

//CONFIG.debug.hooks = true;

Hooks.on('init', () => {
    game.settings.register(MODULE_ID, 'hide-defense-values', {
        name: game.i18n.localize('SWADETargetedDamage.HideDefenseValues.Name'),
        hint: game.i18n.localize('SWADETargetedDamage.HideDefenseValues.Hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.register(MODULE_ID, 'auto-illumination-penalties', {
        name: game.i18n.localize('SWADETargetedDamage.AutoIlluminationPenalties.Name'),
        hint: game.i18n.localize('SWADETargetedDamage.AutoIlluminationPenalties.Hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
    });

    CONFIG.queries[`${MODULE_ID}.renderTargetedDamageApp`] = TargetedDamageApplicator.renderTargetedDamageApp;
});

Hooks.on('setup', () => {
    loadTemplates([
        `modules/${MODULE_ID}/templates/apps/targeted-damage-applicator/buttons.hbs`,
        `modules/${MODULE_ID}/templates/apps/targeted-damage-applicator/input-fields.hbs`,
        `modules/${MODULE_ID}/templates/chat/damage-result.hbs`,
    ]);
});

Hooks.on('ready', () => {
    // Setup socket
    //game.socket.on(`module.${MODULE_ID}`, TargetedDamageApplicator.renderTargetedDamageApp);
});

Hooks.on('swadePreCalcWounds', (actor, damageContext, woundsInflicted, statusToApply) => {
    return false;
});

Hooks.on('renderChatMessageHTML', (message, html, context) => {
    const roll = message.significantRoll;

    if (!roll || roll.constructor.name !== 'DamageRoll') return;


    // If the chat message is a damage roll...
    if (roll.options.rollType === 'damage') {
        const button = html.querySelector('.swade-roll-message button.calculate-wounds');

        if (button) {
            button.textContent = '';
            const icon = document.createElement('i');
            icon.classList.add('fa-solid', 'fa-meter-droplet');
            button.append(icon);
            button.insertAdjacentHTML('beforeend', game.i18n.localize('SWADETargetedDamage.ResolveDamage'));
            const buttonHTML = button?.outerHTML;
            const parentElement = button?.parentElement;
            button.remove();

            if (message._source.author === game.userId || game.user.isGM) {
                parentElement?.insertAdjacentHTML('afterbegin', buttonHTML);
            }
        }

        if (message._source.author !== game.userId) {
            const rerollButtons = html.querySelectorAll('.benny-reroll, .free-reroll');
            rerollButtons.forEach((b) => b.remove());
        }

        html.querySelector('.swade-roll-message button.calculate-wounds')?.addEventListener('click', async () => {
            // Collect the user's Targets
            const targets = context.user.targets;

            // If there are targets, get the damage and ap, and trigger the flow with the data.
            if (targets.size) {
                const damage = roll.total;
                const ap = roll.ap;
                await TargetedDamageApplicator.triggerFlow(targets, damage, ap);
            }
        });
    }

});

Hooks.on('preUpdateScene', (scene, changed, options, userId) => {
    if (game.userId !== userId) return;

    if (!changed.tokenVision) {
        changed['flags.swade-targeted-damage.illumination'] = null;
        return;
    }

    const pitchBlack = changed.environment.globalLight.darkness.max;
    const illuminationRollModifiers = CONFIG.SWADE.prototypeRollGroups.find((rollGroup) => rollGroup.name === game.i18n.localize('SWADE.Illumination._name'))?.modifiers;
    const darknessLevel = changed.environment.darknessLevel;
    let illuminationMod;

    if (darknessLevel >= pitchBlack || !changed.environment.globalLight.enabled) {
        illuminationMod = illuminationRollModifiers.find((m) => m.label = game.i18n.localize('SWADE.Illumination.Pitch'));
    } else if (darknessLevel >= pitchBlack / 2) {
        illuminationMod = illuminationRollModifiers.find((m) => m.label = game.i18n.localize('SWADE.Illumination.Dark'));
    } else if (darknessLevel >= 0.05) {
        illuminationMod = illuminationRollModifiers.find((m) => m.label = game.i18n.localize('SWADE.Illumination.Dim'));
    } else {
        illuminationMod = null;
    }

    changed['flags.swade-targeted-damage.illumination'] = illuminationMod;
});

const swadePreRollHookEvents = ['swadePreRollSkill', 'swadePreRollAttribute'];

for (const hookEvent of swadePreRollHookEvents) {
    Hooks.on(hookEvent, (actor, skill, roll, modifiers, options) => {
        if (!game.settings.get('swade-targeted-damage', 'auto-illumination-penalties')) return;

        const illuminationModifier = game.scenes.current.getFlag('swade-targeted-damage', 'illumination');
        const token = game.scenes.current.tokens.find((t) => t.actorId === actor.id);

        if (illuminationModifier && token) {
            const hasBrightLight = token.light.bright > 0;
            const hasDimLight = token.light.dim > 0;

            if (!hasBrightLight && !hasDimLight) {
                modifiers.push(illuminationModifier);
            }
        }
    });
}
