/**
 * React Native CLI configuration.
 *
 * `assets` is the font-linking manifest: `npx react-native-asset` copies these
 * into android/app/src/main/assets/fonts and the iOS bundle (registering them in
 * Info.plist's UIAppFonts), so `fontFamily: 'SpaceMono-Regular'` resolves on both
 * platforms. Space Mono is the DRS mono face — the uppercase micro-labels, status
 * chips and device IDs that carry the Fort Dice design language.
 */
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./assets/fonts', './assets/sounds'],
};
