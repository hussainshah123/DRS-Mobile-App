/**
 * Client-side password rules on the settings form.
 *
 * These mirror the limits auth_handler.go enforces, and the ORDER of the checks is the part worth
 * pinning: the message an operator reads has to name the actual problem. Reporting "the two
 * passwords do not match" for a pair of identical 4-character passwords sends them looking for a
 * typo that is not there.
 *
 * The 72-character ceiling is not arbitrary — it is bcrypt's input limit, and the backend rejects
 * anything longer, so a client that silently accepts 80 characters produces a failed save with no
 * explanation.
 */
import { passwordProblem } from '../src/screens/SettingsScreen';

const CURRENT = 'old-password';

describe('passwordProblem', () => {
  it('accepts a valid change', () => {
    expect(passwordProblem(CURRENT, 'brand-new-one', 'brand-new-one')).toBe('');
  });

  it('rejects anything shorter than 8 characters', () => {
    expect(passwordProblem(CURRENT, 'short', 'short')).toMatch(/at least 8/);
  });

  it('accepts exactly 8 characters', () => {
    expect(passwordProblem(CURRENT, 'a'.repeat(8), 'a'.repeat(8))).toBe('');
  });

  it('accepts exactly 72 characters but not 73', () => {
    expect(passwordProblem(CURRENT, 'a'.repeat(72), 'a'.repeat(72))).toBe('');
    expect(passwordProblem(CURRENT, 'a'.repeat(73), 'a'.repeat(73))).toMatch(/72 characters or fewer/);
  });

  it('rejects reusing the current password', () => {
    expect(passwordProblem(CURRENT, CURRENT, CURRENT)).toMatch(/different/);
  });

  it('rejects a mismatched confirmation', () => {
    expect(passwordProblem(CURRENT, 'brand-new-one', 'brand-new-two')).toMatch(/do not match/);
  });

  it('names the length problem before the mismatch', () => {
    // Both are wrong here. Length is the one the operator can act on.
    expect(passwordProblem(CURRENT, 'abc', 'xyz')).toMatch(/at least 8/);
  });

  it('does not treat an empty confirmation as a match', () => {
    expect(passwordProblem(CURRENT, 'brand-new-one', '')).toMatch(/do not match/);
  });
});
