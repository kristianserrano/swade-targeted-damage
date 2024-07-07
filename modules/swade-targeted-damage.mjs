import { TargetedDamageApplicator } from "./TargetedDamageApplicator.mjs";

export const MODULE_ID = "swade-targeted-damage";

Hooks.on('init', () => {
    game.settings.register(MODULE_ID, 'hide-defense-values', {
        name: game.i18n.localize('SWADETargetedDamage.HideDefenseValues.Name'),
        hint: game.i18n.localize('SWADETargetedDamage.HideDefenseValues.Hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
    });
});

Hooks.on('setup', () => {
    loadTemplates([
        `modules/${MODULE_ID}/templates/apps/targeted-damage.hbs`,
        `modules/${MODULE_ID}/templates/chat/damage-result.hbs`
    ]);
});

Hooks.on('ready', () => {
    // Setup socket
    game.socket.on(`module.${MODULE_ID}`, renderTargetedDamageApp);
});

Hooks.on('swadePreCalcWounds', (actor, damageContext, woundsInflicted, statusToApply) => {
    return false;
});

Hooks.on('renderChatMessage', (msg, html, data) => {
    const roll = msg.significantRoll;

    if (!roll || roll.constructor.name !== 'DamageRoll') return;

    // If the chat message is a damage roll...
    if (roll.constructor.name === 'DamageRoll') {
        const button = html[0].querySelector('.swade-roll-message button.calculate-wounds');
        if (button) {
            button.textContent = '';
            const icon = document.createElement('i');
            icon.classList.add('fa-solid', 'fa-meter-droplet');
            button.append(icon);
            button.insertAdjacentHTML('beforeend', game.i18n.localize('SWADETargetedDamage.ResolveDamage'));
            const buttonHTML = button?.outerHTML;
            const parentElement = button?.parentElement;
            button.remove();

            if (msg._source.user === game.userId || game.user.isGM) {
                parentElement?.insertAdjacentHTML('afterbegin', buttonHTML);
            }
        }

        if (msg._source.user !== game.userId) {
            const rerollButtons = html[0].querySelectorAll('.benny-reroll, .free-reroll');
            rerollButtons.forEach((b) => b.remove());
        }

        html[0].querySelector('.swade-roll-message button.calculate-wounds')?.addEventListener('click', async () => {
            // Collect the user's Targets
            const targets = data.user.targets;
            // If there are targets, get the damage and ap, and trigger the flow with the data.
            if (targets.size) {
                const damage = roll.total;
                const ap = roll.ap;
                await triggerFlow(targets, damage, ap);
            }
        });
    }
});

// to trigger the workflow either on the current client or on other client(s).
async function triggerFlow(targets, damage, ap) {
    // For each token targeted...
    for (const target of targets) {
        // Determine whether there are any owners that are not GMs.
        const hasPlayerOwner = target.actor.hasPlayerOwner;

        if (hasPlayerOwner) {
            // Get the player to whom this actor might be assigned.
            const activeAssignedPlayer = game.users.find((u) => u.active && u.character?.id === target.actor.id);
            const activePlayerOwners = game.users.filter((u) => !u.isGM && u.active && target.actor.ownership[u.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);

            if (activeAssignedPlayer || activePlayerOwners.length || target.actor.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
                if (!activeAssignedPlayer && game.user.isGM && (activePlayerOwners.length > 1 || target.actor.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
                    const buttons = {};
                    const targetPlayers = activePlayerOwners.length ? activePlayerOwners : game.users.filter(u => !u.isGM && u.active);
                    for (const player of targetPlayers) {
                        buttons[player.id] = {
                            label: player.name,
                            callback: () => {
                                promptOtherUser(target.document.uuid, player, damage, ap);
                            }
                        };
                    }

                    new Dialog({
                        title: game.i18n.format("SWADETargetedDamage.ChoosePlayer.Title"),
                        content: `${game.i18n.format("SWADETargetedDamage.ChoosePlayer.Prompt", { name: target.name })}`,
                        buttons,
                        default: ""
                    }, { classes: ['swade-app'] }).render(true);
                } else if (activeAssignedPlayer || activePlayerOwners.length === 1) {
                    // Get the player owning the Token's Actor.
                    const playerOwner = !!activeAssignedPlayer ? activeAssignedPlayer : activePlayerOwners[0];

                    if (playerOwner === game.user) {
                        await new TargetedDamageApplicator(target.document.uuid, damage, ap).render(true);
                    } else {
                        promptOtherUser(target.document.uuid, playerOwner, damage, ap);
                    }
                }
            } else if (game.user.isGM) {
                await new TargetedDamageApplicator(target.document.uuid, damage, ap).render(true);
            }
        } else if (game.user.isGM) {
            await new TargetedDamageApplicator(target.document.uuid, damage, ap).render(true);
        } else {
            promptOtherUser(target.document.uuid, game.users.activeGM, damage, ap);
        }
    }
}

function promptOtherUser(targetUuid, targetUser, damage, ap) {
    game.socket.emit(`module.${MODULE_ID}`, {
        targetUuid,
        targetUserId: targetUser?.id,
        damage,
        ap,
    });
}

async function renderTargetedDamageApp({ targetUuid, damage, ap, targetUserId }) {
    if (game.userId !== targetUserId) return;
    await new TargetedDamageApplicator(targetUuid, damage, ap, targetUserId).render(true);
}
