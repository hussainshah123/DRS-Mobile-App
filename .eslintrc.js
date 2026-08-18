module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void somePromise()` as a STATEMENT is the explicit, greppable way to say "this promise is
    // deliberately not awaited" — which the session, poll and sign-out paths all do on purpose.
    // Still flagged inside expressions, where it is almost always a mistake.
    'no-void': ['warn', { allowAsStatement: true }],
  },
  overrides: [
    {
      // The Jest setup file runs in the test environment, where `jest` is a global.
      files: ['jest.setup.js', '**/__tests__/**'],
      env: { jest: true },
    },
  ],
};
