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
        requireReload: true,
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

Hooks.on('renderSceneConfig', (app, html, context, options) => {
    if (!options.parts?.includes('lighting') || !game.settings.get(MODULE_ID, 'auto-illumination-penalties')) return;

    const illuminationThresholds = [
        {
            key: 'dim-light-threshold',
            label: game.i18n.localize('SWADE.Illumination.Dim')
        },
        {
            key: 'darkness-threshold',
            label: game.i18n.localize('SWADE.Illumination.Dark'),
        }
    ];

    for (const threshold of illuminationThresholds) {
        const isDim = threshold.key === 'dim-light-threshold';
        const name = `flags.${MODULE_ID}.${threshold.key}`;
        const pitchDarkGroup = html.querySelector(`.form-group:has(label[for="${app.id}-environment.globalLight.darkness.max"]`);
        const min = isDim ? 0.05 : 0.1;
        const max = isDim ? 0.9 : 0.95;
        const input = foundry.applications.elements.HTMLRangePickerElement.create({
            name,
            value: app.document.getFlag(MODULE_ID, threshold.key) ?? min,
            step: 0.05,
            max,
            min,
            id: `${app.id}-${name}`
        });

        const group = foundry.applications.fields.createFormGroup({
            input,
            label: isDim ? game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.DimLight.Label') : game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.Darkness.Label'),
            localize: true
        });

        group.querySelector('label').setAttribute('for', input.id);
        let p = document.createElement('p');
        p.innerText = isDim ? game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.DimLight.Hint') : game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.Darkness.Hint');
        p.classList.add('hint');
        group.insertAdjacentElement('beforeend', p);

        function adjustThresholds(event) {
            const step = Number(event.target.getAttribute('step'));
            // Get the input's new value
            const newValue = Number(event.target.querySelector('input').value);
            // Get the range pickers
            const dimLightRangePicker = html.querySelector(`range-picker[name="flags.${MODULE_ID}.dim-light-threshold"]`);
            const darknessRangePicker = html.querySelector(`range-picker[name="flags.${MODULE_ID}.darkness-threshold"]`);
            const pitchDarkRangePicker = pitchDarkGroup.querySelector('range-picker');
            // Get the current values from each threshold setting
            const dimLightValue = Number(dimLightRangePicker.querySelector('input').value);
            const darknessValue = Number(darknessRangePicker.querySelector('input').value);
            const pitchDarkValue = Number(pitchDarkGroup.querySelector('input').value);
            const newHigherValue = Math.round((newValue + step) * 20) / 20;
            const newLowerValue = Math.round((newValue - step) * 20) / 20;

            function makeChange(rangePicker, changedValue) {
                for (const rangeInput of rangePicker.querySelectorAll('input')) {
                    rangeInput.value = changedValue;
                }
                const rangeInput = rangePicker.querySelector('input');
                const name = rangePicker.name;
                const value = changedValue;
                const max = Number(rangeInput.max);
                const min = Number(rangeInput.min);
                const step = Number(rangeInput.step);
                const id = rangePicker.id;
                rangePicker.replaceWith(foundry.applications.elements.HTMLRangePickerElement.create({ name, value, step, max, min, id }));
                console.dir(rangePicker);
                const newRangePicker = html.querySelector(`range-picker[name="${name}"]`);
                newRangePicker.addEventListener('change', (event) => adjustThresholds(event));
                newRangePicker.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (event.target.name.includes('dim-light-threshold')) {
                if (darknessValue <= newValue) makeChange(darknessRangePicker, newHigherValue);
            } else if (event.target.name.includes('darkness-threshold')) {
                if (pitchDarkValue <= newValue) makeChange(pitchDarkRangePicker, newHigherValue);
                if (dimLightValue >= newValue) makeChange(dimLightRangePicker, newLowerValue);
            } else if (event.target.name.includes('global')) {
                if (darknessValue >= newValue) makeChange(darknessRangePicker, newLowerValue);
            }
        }

        input.addEventListener('change', (event) => adjustThresholds(event));
        pitchDarkGroup.querySelector('range-picker')?.addEventListener('change', (event) => adjustThresholds(event));
        pitchDarkGroup.querySelector('label').innerText = game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.PitchDark.Label');
        p = document.createElement('p');
        p.classList.add('hint');
        p.innerText = game.i18n.localize('SWADETargetedDamage.IlluminationThresholds.PitchDark.Hint');
        pitchDarkGroup.querySelector('p').replaceWith(p);
        pitchDarkGroup.insertAdjacentElement("beforebegin", group);
    }
});

for (const hookEvent of ['swadePreRollSkill', 'swadePreRollAttribute']) {
    Hooks.on(hookEvent, (actor, skill, roll, modifiers, options) => {
        // Ignore all of this if the feature is disabled in settings.
        if (!game.settings.get(MODULE_ID, 'auto-illumination-penalties')) return;

        // Get the system's Illumination roll modifiers.
        const illuminationRollModifiers = foundry.utils.deepClone(CONFIG.SWADE.prototypeRollGroups.find((rollGroup) => rollGroup.name === game.i18n.localize('SWADE.Illumination._name'))?.modifiers);
        // Get the tokens that the user is targeting.
        // Check each one using the same script for the actor's token but label them as (Target) instead.
        const targetedTokenIDs = game.user.targets.ids;
        // If there's a token associated with this actor, get its contextual darkness level; this includes scene region contexts. Otherwise, use the scene's current global darkness level.
        const token = game.scenes.current.tokens.find((t) => t.actorId === actor.id);
        const sceneDarknessLevel = canvas.effects.getDarknessLevel(token?.position);
        // Get the scene's thresholds for Dim Light, Darkness, and Pitch Dark (Global Illumination Threshold in FVTT terms).
        const pitchDarkLevel = game.scenes.current.environment.globalLight.darkness.max;
        const dimLevel = Number(game.scenes.current.getFlag(MODULE_ID, 'dim-light-threshold'));
        const darknessLevel = Number(game.scenes.current.getFlag(MODULE_ID, 'darkness-threshold'));
        // Add darkness level ranges to each Illumination modifiers.
        const dimIlluminationModifier = illuminationRollModifiers?.find((m) => m.label === game.i18n.localize('SWADE.Illumination.Dim'));
        dimIlluminationModifier.threshold = dimLevel;
        const darknessIlluminationModifier = illuminationRollModifiers?.find((m) => m.label === game.i18n.localize('SWADE.Illumination.Dark'));
        darknessIlluminationModifier.threshold = darknessLevel;
        const pitchDarkIlluminationModifier = illuminationRollModifiers?.find((m) => m.label === game.i18n.localize('SWADE.Illumination.Pitch'));
        pitchDarkIlluminationModifier.threshold = pitchDarkLevel;
        // Get an illumination modifier based on the scene's current darkness level.
        //const sceneIlluminationModifier = illuminationRollModifiers.find((m) => sceneDarknessLevel > m.levels.min && sceneDarknessLevel <= m.levels.max);
        const sceneIlluminationModifier = illuminationRollModifiers.reduce((maxModifier, currentModifier) => {
            if (sceneDarknessLevel > currentModifier.threshold) {
                if (!maxModifier || currentModifier.threshold > maxModifier.threshold) {
                    return currentModifier;
                }
            }

            return sceneDarknessLevel > dimLevel ? maxModifier : null;
        });

        // If there's a darkness level set, and there's the Actor's token to consider, begin evaluating its own light source as well as nearby light sources.
        if (sceneDarknessLevel > 0 && sceneIlluminationModifier && (token || targetedTokenIDs.length)) {
            // This function determines what kind of illumination from nearby light sources the token is in.
            function getProximityLight(token) {
                let c = Object.values(token.object.center);
                let lights = canvas.effects.lightSources.filter(src => !(src instanceof foundry.canvas.sources.GlobalLightSource) && src.shape.contains(...c));

                // If there are no light sources, just return false
                if (!lights.length) return false;

                // Determine if the token is in any bright light.
                let inBright = lights.some(light => {
                    let { data: { x, y }, ratio } = light;
                    let bright = foundry.canvas.geometry.ClockwiseSweepPolygon.create({ 'x': x, 'y': y }, {
                        type: 'light',
                        boundaryShapes: [new PIXI.Circle(x, y, ratio * light.shape.config.radius)]
                    });
                    return bright.contains(...c);
                });

                // If it's in bright light, return 'bright'.
                if (inBright) return 'bright';

                // Otherwise, the assumption at this point is that it's in dim light.
                return 'dim';
            }

            function checkTokenLighting(token, options = { isTargeted: false }) {
                // Get the dim and bright light sources the token might have.
                const hasBrightLight = token.light.bright > 0;
                const hasDimLight = token.light.dim > 0;

                // If the token doesn't have any light source, then let's define which Illumination penalty to apply, if any.
                if (!hasBrightLight) {
                    // Get any proximity light conditions that the token might be in. This will include token and ambient light sources.
                    const proximityLight = getProximityLight(token);

                    // If the token is in any light that's in proximity, make the scene darkness penalty optional.
                    if (proximityLight) sceneIlluminationModifier.ignore = true;

                    // Append the source to the label
                    const label = `${dimIlluminationModifier.label} ${game.i18n.format("SWADETargetedDamage.IlluminationModifierLabels.Contexts.AroundToken", { name: token.name })}`;

                    if ((hasDimLight || proximityLight === 'dim') && !modifiers.some((m) => m.label === label)) {
                        // If the token is in Dim lighting, push in that option for a possible modifier.
                        const dimLightModifier = foundry.utils.deepClone(dimIlluminationModifier);
                        // Set the label.
                        dimLightModifier.label = label;

                        // If the user is targeting a token, it's likely not necessary to apply any Illumination penalties for where the Actor is since its the target's lighting that matters, so set its modifier to be inactive by default. Additionally, if the token is targeted and the user has multiple targets selected, do the same thing.
                        if ((!options.isTargeted && game.user.targets.size) || (options.isTargeted && game.user.targets.size > 1)) {
                            dimLightModifier.ignore = true;
                        }

                        modifiers.push(dimLightModifier);

                        // Set the scene darkness penalty to optional since this token has light.
                        sceneIlluminationModifier.ignore = true;
                    }
                } else {
                    // If it has bright light, set the scene's illumination penalty to be optional.
                    sceneIlluminationModifier.ignore = true;
                }
            }

            // First check the Actor's token lighting situation.
            checkTokenLighting(token);

            // Now check the user's targets lighting situations.
            for (const targetID of targetedTokenIDs) {
                const target = game.scenes.current.tokens.get(targetID);
                checkTokenLighting(target, { isTargeted: true });
            }

            // Append the source to the label
            sceneIlluminationModifier.label = `${sceneIlluminationModifier.label} ${game.i18n.format("SWADETargetedDamage.IlluminationModifierLabels.Contexts.GlobalIllumination", { name: token.name })}`;
            // Finally push in the scene's illumination modifier.
            modifiers.push(sceneIlluminationModifier);
        }
    });
}
