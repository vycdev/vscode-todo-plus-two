import { parse } from 'acorn';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const webpack = require('webpack');
const config = require('../webpack.config');

describe('Production bundle compatibility', () => {
  it('minifies null checks without introducing syntax newer than Node 10.11', async function () {
    this.timeout(15000);
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-build-compatibility-'));
    const entry = path.join(fixture, 'entry.js');
    const output = path.join(fixture, 'out');
    const bundle = path.join(output, 'bundle.js');
    fs.writeFileSync(entry, 'module.exports = value => value == null ? 42 : value;');

    try {
      await new Promise<void>((resolve, reject) => {
        const compiler = webpack({
          ...config,
          mode: 'production',
          entry,
          devtool: false,
          output: { ...config.output, path: output, filename: 'bundle.js' },
        });
        compiler.run((error, stats) => {
          compiler.close((closeError) => {
            const failure =
              error || closeError || (stats.hasErrors() && new Error(stats.toString()));
            if (failure) reject(failure);
            else resolve();
          });
        });
      });

      // The default minifier can otherwise turn this into ES2020's `value ?? 42`.
      parse(fs.readFileSync(bundle, 'utf8'), { ecmaVersion: 2018 });
      const fallback = require(bundle);
      expect(fallback(null)).to.equal(42);
      expect(fallback(undefined)).to.equal(42);
      for (const value of [0, false, '', 'text']) expect(fallback(value)).to.equal(value);
    } finally {
      delete require.cache[bundle];
      if (fs.existsSync(bundle)) fs.unlinkSync(bundle);
      if (fs.existsSync(output)) fs.rmdirSync(output);
      fs.unlinkSync(entry);
      fs.rmdirSync(fixture);
    }
  });
});
