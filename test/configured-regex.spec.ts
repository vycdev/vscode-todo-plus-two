import { expect } from 'chai';
import { createConfiguredRegex } from '../src/utils/configured-regex';

describe('Configured embedded regex recovery', () => {
  it('disables matching for invalid syntax without breaking Todo activation', () => {
    const errors: string[] = [];
    const report = (message: string) => {
      errors.push(message);
    };
    const regex = createConfiguredRegex('(', 'g', report);
    expect(regex.test('// TODO task')).to.equal(false);
    createConfiguredRegex('(', 'g', report);
    expect(errors.length).to.equal(1);
    expect(errors[0]).to.include('todo.embedded.regex');
    expect(createConfiguredRegex('(TODO)', 'i', report).test('todo')).to.equal(true);
    createConfiguredRegex('(', 'g', report);
    expect(errors.length).to.equal(2);
  });

  it('handles invalid flags and an intentionally empty expression', () => {
    const errors: string[] = [];
    const report = (message: string) => {
      errors.push(message);
    };
    expect(createConfiguredRegex('TODO', 'gg', report).test('TODO')).to.equal(false);
    expect(errors.length).to.equal(1);
    expect(createConfiguredRegex('', '', report).test('anything')).to.equal(false);
  });
});
