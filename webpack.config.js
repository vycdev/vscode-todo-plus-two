/* IMPORT */

const path = require('path');

/* CONFIG */

const config = {
  // VS Code 1.36 ships Node 10.11; keep generated runtime code compatible.
  target: 'node10.11',
  entry: './src/extension.ts',
  output: {
    clean: true,
    path: path.resolve(__dirname, 'out'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]',
  },
  devtool: 'source-map',
  optimization: {
    minimizeOptions: {
      // Node 10 supports BigInt but cannot parse every ES2020 construct.
      // Keep the minifier aligned with TypeScript's ES2017 output.
      javascript: { ecma: 2017, compress: { passes: 2 } },
    },
  },
  externals: {
    vscode: 'commonjs vscode',
    fsevents: 'commonjs fsevents',
  },
  node: {
    __dirname: false,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
        ],
      },
    ],
  },
};

/* EXPORT */

module.exports = config;
