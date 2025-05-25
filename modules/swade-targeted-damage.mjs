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
