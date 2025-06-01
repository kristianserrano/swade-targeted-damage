# SWADE Targeted Damage

## v3.1.0

- **New Feature - Suggested Illumination Penalties (Beta):** Adds inclusion of Illumination Penalties to Trait rolls based on the current Scene's global illumination settings and darkness levels as well any Dim lighting the Token is currently in.
  - The calculation for Dim, Darkness, and Pitch Dark is based on the Global Illumination Threshold Setting on the Scene. If the Scene's current darkness level is greater than or equal to the threshold, it's considered Pitch Dark. Dim is applied if there's any amount of darkness on the scene (0.05). Darkness starts at half the threshold value.
  - The penalty can be overridden in the Roll Dialog to account for a variety of circumstances in which the penalty might be lessened or not apply at all.
  - This feature is disabled by default and can be disabled in the module's settings.
  - If you run into any issues with this feature or have suggestions for improvements, please submit an issue on [GitHub](https://github.com/kristianserrano/swade-targeted-damage/issues).

## v3.0.2

- Fixes a bug in which data was not being passed into the constructor in the correct format.

## v3.0.1

- Places damage details inside of an expandable details element.

## v3.0.0

- Updates minimum Foundry VTT version to 13.
- Converts apps and dialogs to AppV2.

## v2.3.0

- Updated minimum Foundry VTT version to v12.
- Resolves deprecation warnings.

## v2.2.1

- Housekeeping on the manifest file.

## v2.2.0

- Adds Foundry v12 and SWADE v4.0 support.

## v2.1.0

- Adds setting to exclude a Target's defense values (i.e., Toughness and Armor) from the results Chat Message
- Results Chat Message now includes the original rolled damage and AP if either was modified while resolving the damage.

## v2.0.4

- Fixed applying wounds from second shaken.
- Reorganized i18n strings.

## v2.0.3

- Helps if I remember to bundle in the template files.

## v2.0.2

- Fixes actor's wounds being set beyond their max wounds.
- Change reference to `SwadeActiveEffect#label` to `SwadeActiveEffect#name` (deprecation warning).

## v2.0.1

- Fixes player chooser dialog.
- Fixes soak not updating app window message.

## v2.0.0

Initial release
