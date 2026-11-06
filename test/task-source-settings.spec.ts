import { expect } from 'chai';

const loadTaskSource = (settings: { [key: string]: any }) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    modulePath = require.resolve('../src/utils/task-source'),
    previousModule = require.cache[modulePath];
  const reads: string[] = [];

  NodeModule._load = function (request: string, parent, isMain: boolean) {
    if (parent && parent.filename === modulePath && request === '../config') {
      return {
        default: {
          getKey: (key: string) => {
            reads.push(key);
            return settings[key];
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    return { taskSource: require(modulePath), reads };
  } finally {
    NodeModule._load = originalLoad;
    if (previousModule) require.cache[modulePath] = previousModule;
    else delete require.cache[modulePath];
  }
};

const markdownDocument = (text: string) => ({
  languageId: 'markdown',
  version: 1,
  getText: () => text,
});

describe('Markdown task settings snapshots', () => {
  it('reads each setting once for a batch of Markdown files', () => {
    const { taskSource, reads } = loadTaskSource({ 'markdown.scope': 'all' });
    const documents = [markdownDocument('- [ ] One'), markdownDocument('- [ ] Two')];
    const settings = taskSource.getMarkdownTaskSettings();

    documents.forEach((document) => {
      expect(taskSource.isMarkdownTaskDocument(document, settings)).to.equal(true);
      expect(taskSource.getMarkdownTaskNodes(document, settings)).to.have.length(1);
    });

    expect(reads.slice().sort()).to.deep.equal([
      'archive.name',
      'markdown.enabled',
      'markdown.scope',
      'markdown.sections',
      'symbols',
    ]);
  });

  it('does not read Markdown settings for Todo files', () => {
    const { taskSource, reads } = loadTaskSource({});
    const settings = taskSource.getMarkdownTaskSettings();

    expect(taskSource.isTaskDocument({ languageId: 'todo' }, settings)).to.equal(true);
    expect(taskSource.isMarkdownTaskDocument({ languageId: 'todo' }, settings)).to.equal(false);
    expect(reads).to.deep.equal([]);
  });

  it('respects a disabled Markdown setting in the snapshot', () => {
    const { taskSource } = loadTaskSource({ 'markdown.enabled': false });
    const settings = taskSource.getMarkdownTaskSettings();

    expect(taskSource.isTaskDocument(markdownDocument('- [ ] One'), settings)).to.equal(false);
  });
});
