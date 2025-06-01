# SWADE Targeted Damage

## How to Use This Module

### Target and Roll Damage

1. Select one or more Tokens as Targets.
1. Roll damage using an item's damage button.
1. Click the button in the damage Chat Message Card to trigger the app for resolving the damage against the Target's Toughness and Armor.
1. Use the buttons in the app to adjust the damage for any weaknesses or resistances, Soak the Wounds, reroll Soak rolls, and take any Wounds remaining.

### Supported Setting Rules

The following Setting Rules can be employed via the SWADE system settings.

- Gritty Damage
- Unarmored Hero
- Wound Cap

### Additional Features

#### Suggested Illumination Penalties (Beta)

- Adds inclusion of Illumination Penalties to Trait rolls based on the current Scene's global illumination settings and darkness levels as well any Dim lighting the Token is currently in.
- The calculation for Dim, Darkness, and Pitch Dark is based on the Global Illumination Threshold Setting on the Scene. If the Scene's current darkness level is greater than or equal to the threshold, it's considered Pitch Dark. Dim is applied if there's any amount of darkness on the scene (0.05). Darkness starts at half the threshold value.
- The penalty can be overridden in the Roll Dialog to account for a variety of circumstances in which the penalty might be lessened or not apply at all.
- This feature is disabled by default and can be enabled in the module's settings.
