const MODULE_TITLE = "swade-targeted-damage";

Hooks.on('ready', function () {
    // Setup socket
    game.socket.on(`module.${MODULE_TITLE}`, adjustDamagePrompt);
});

Hooks.on('swadePreCalcWounds', (actor, damageContext, woundsInflicted, statusToApply) => {
    return false;
});

Hooks.on('renderChatMessage', (msg, html, data) => {
    const button = html[0].querySelector('.swade-roll-message button.calculate-wounds');
    const buttonHTML = button.outerHTML;
    const parentElement = button?.parentElement;
    button?.remove();
    parentElement?.insertAdjacentHTML('afterbegin', buttonHTML);

    html[0].querySelector('.swade-roll-message button.calculate-wounds').addEventListener('click', () => {
        const roll = msg.significantRoll;

        if (!roll || roll.constructor.name !== 'DamageRoll') return;
        // If the chat message is a damage roll and it's the same user...
        // Collect the user's Targets
        const targets = data.user.targets;
        // If there are targets, get the damage and ap, and trigger the flow with the data.
        if (targets.size) {
            const damage = roll.total;
            const ap = roll.ap;
            triggerFlow(targets, damage, ap);
        }
    });
});

// Set Hook to trigger the workflow on createChatMessage.
/* Hooks.on('createChatMessage', function (msg, data, userId) {
    // Determine whether the chat message creator is the same as the current user.
    if (userId !== game.userId) return;
    html.querySelector('.swade-roll-message button.calculate-wounds')?.addEventListener('click', () => {
        const roll = msg.significantRoll;
        if (!roll || !(roll instanceof DamageRoll)) return;

        // If the chat message is a damage roll and it's the same user...
        // Collect the user's Targets
        const targets = data.user.targets;
        // If there are targets, get the damage and ap, and trigger the flow with the data.
        if (targets.size) {
            const damage = roll.total;
            const ap = roll.ap;
            triggerFlow(targets, damage, ap);
        }
    });
}); */
// Create string variable for the SWADE CSS class for App Windows.
const appCssClasses = ["swade-app"];

// Class for executing the script via the Macro.
class WoundsCalculator {
    static render() {
        const targets = game.user.targets;
        if (targets.size) {
            // Construct Dialog for data input and trigger flow.
            new Dialog({
                title: game.i18n.format("SWADA.title"),
                content: `
                    <label for="damage">${game.i18n.format("SWADE.Dmg")}</label>
                    <input type="number" id="damage" autofocus>
                    <label for="ap">${game.i18n.format("SWADE.Ap")}</label>
                    <input type="number" id="ap">
                `,
                buttons: {
                    calculate: {
                        label: game.i18n.format("SWADA.calculate"),
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
