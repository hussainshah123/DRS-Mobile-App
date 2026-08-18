module.exports = {
  preset: '@react-native/jest-preset',
  /**
   * The RN preset only transforms `react-native` itself. Several of this app's dependencies ship
   * untranspiled ESM in their published `lib/module` output, so Jest hits a bare `export` and
   * throws a SyntaxError unless they are transformed too.
   */
  transformIgnorePatterns: [
    'node_modules/(?!(?:jest-)?react-native' +
      '|@react-native(?:-community)?' +
      '|@react-navigation' +
      '|react-native-webrtc' +
      '|react-native-screens' +
      '|react-native-safe-area-context' +
      '|react-native-svg' +
      '|react-native-sound' +
      '|react-native-keychain' +
      ')/',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
