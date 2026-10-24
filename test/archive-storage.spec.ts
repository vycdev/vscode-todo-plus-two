import { expect } from 'chai';

const makeDocument = (filePath: string, text: string) => ({
  version: 1,
  uri: { toString: () => filePath },
  getText: () => text,
  positionAt: (offset: number) => ({ offset }),
});

const loadArchiveStorage = (documents = [], readError?, writeError?) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    storagePath = require.resolve('../src/utils/archive-storage'),
    previousStorage = require.cache[storagePath],
    appliedEdits = [],
    writes = [],
    renames = [];
  let readCount = 0,
    savedContent = 'Saved archive';

  const workspace = {
    textDocuments: documents,
    applyEdit: async (edit) => {
      appliedEdits.push(edit);
      return true;
    },
  };
  const vscode = {
    workspace,
    Uri: { file: (filePath: string) => ({ toString: () => filePath }) },
    Range: class {
      constructor(
        public start,
        public end
      ) {}
    },
    WorkspaceEdit: class {
      entries = new Map();
      set(uri, edits) {
        this.entries.set(uri.toString(), edits);
      }
      replace(uri, range, content) {
        this.entries.set(uri.toString(), [{ range, content }]);
      }
    },
  };
  const File = {
    make: async (filePath, content) => {
      if (writeError) throw writeError;
      writes.push({ filePath, content });
    },
  };

  NodeModule._load = function (request, parent, isMain) {
    if (parent && parent.filename === storagePath) {
      if (request === 'vscode') return vscode;
      if (request === './file') return { default: File };
      if (request === 'fs') {
        return {
          readFileSync: () => {
            readCount++;
            if (readError) throw readError;
            return savedContent;
          },
          renameSync: (from, to) => {
            renames.push({ from, to });
            const written = writes.find((write) => write.filePath === from);
            if (written) savedContent = written.content;
          },
          unlinkSync: () => undefined,
        };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[storagePath];
    return {
      archiveToFile: require(storagePath).archiveToFile,
      workspace,
      File,
      appliedEdits,
      writes,
      renames,
      getReadCount: () => readCount,
      setSavedContent: (content: string) => {
        savedContent = content;
      },
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previousStorage) require.cache[storagePath] = previousStorage;
    else delete require.cache[storagePath];
  }
};

const getFailure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected archive operation to fail');
};

describe('Archive file storage', () => {
  it('matches archive buffers using filesystem path casing rules', async () => {
    if (process.platform !== 'win32') return;
    const source = makeDocument('TODO', 'Task'),
      archive = makeDocument('archive.todo', 'Unsaved archive'),
      storage = loadArchiveStorage([source, archive]);

    await storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content + '\nTask');
    expect(storage.getReadCount()).to.equal(0);
    expect(storage.appliedEdits[0].entries.get('archive.todo')[0].content).to.equal(
      'Unsaved archive\nTask'
    );
  });

  it('merges a hidden dirty archive buffer with source deletion in one workspace edit', async () => {
    const source = makeDocument('TODO', 'Finished task'),
      archive = makeDocument('ARCHIVE.TODO', 'Unsaved archive edit'),
      { archiveToFile, appliedEdits, writes, getReadCount } = loadArchiveStorage([source, archive]),
      sourceEdits = [{ delete: 'Finished task' }];

    await archiveToFile('ARCHIVE.TODO', source, sourceEdits, (content) => content + '\nTask');

    expect(getReadCount()).to.equal(0);
    expect(writes).to.deep.equal([]);
    expect(appliedEdits).to.have.length(1);
    expect(appliedEdits[0].entries.get('TODO')).to.equal(sourceEdits);
    expect(appliedEdits[0].entries.get('ARCHIVE.TODO')[0].content).to.equal(
      'Unsaved archive edit\nTask'
    );
  });

  it('reports a rejected workspace edit without issuing a separate source deletion', async () => {
    const source = makeDocument('TODO', 'Task'),
      archive = makeDocument('ARCHIVE.TODO', 'Archive'),
      storage = loadArchiveStorage([source, archive]);
    let applyCount = 0;

    storage.workspace.applyEdit = async () => {
      applyCount++;
      return false;
    };

    const error = await getFailure(
      storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content)
    );

    expect(error.message).to.contain('Source tasks were kept');
    expect(applyCount).to.equal(1);
  });

  it('does not overwrite an unreadable archive or remove source tasks', async () => {
    const source = makeDocument('TODO', 'Task'),
      readError = { code: 'EACCES' },
      storage = loadArchiveStorage([source], readError);

    expect(
      await getFailure(storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content))
    ).to.equal(readError);
    expect(storage.writes).to.deep.equal([]);
    expect(storage.appliedEdits).to.deep.equal([]);
  });

  it('keeps source tasks when writing a new archive fails', async () => {
    const source = makeDocument('TODO', 'Task'),
      writeError = new Error('Disk full'),
      storage = loadArchiveStorage([source], { code: 'ENOENT' }, writeError);

    expect(
      await getFailure(storage.archiveToFile('ARCHIVE.TODO', source, [], () => 'Task'))
    ).to.equal(writeError);
    expect(storage.appliedEdits).to.deep.equal([]);
    expect(storage.renames).to.deep.equal([]);
  });

  it('writes a temporary file before replacing an existing archive', async () => {
    const source = makeDocument('TODO', 'Task'),
      storage = loadArchiveStorage([source]);

    await storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content + '\nTask');

    expect(storage.writes).to.have.length(1);
    expect(storage.writes[0].filePath).not.to.equal('ARCHIVE.TODO');
    expect(storage.writes[0].content).to.equal('Saved archive\nTask');
    expect(storage.renames).to.deep.equal([
      { from: storage.writes[0].filePath, to: 'ARCHIVE.TODO' },
    ]);
    expect(storage.appliedEdits).to.have.length(1);
  });

  it('keeps the source when it changes during an archive write', async () => {
    const source = makeDocument('TODO', 'Task'),
      storage = loadArchiveStorage([source]);

    storage.File.make = async () => {
      source.version++;
    };

    const error = await getFailure(storage.archiveToFile('ARCHIVE.TODO', source, [], () => 'Task'));

    expect(error.message).to.contain('source changed');
    expect(storage.appliedEdits).to.deep.equal([]);
    expect(storage.renames).to.deep.equal([]);
  });

  it('serializes concurrent operations before reading a shared archive', async () => {
    const firstSource = makeDocument('FIRST.TODO', 'First'),
      secondSource = makeDocument('SECOND.TODO', 'Second'),
      storage = loadArchiveStorage([firstSource, secondSource]);

    await Promise.all([
      storage.archiveToFile('ARCHIVE.TODO', firstSource, [], (content) => content + '\nFirst'),
      storage.archiveToFile('ARCHIVE.TODO', secondSource, [], (content) => content + '\nSecond'),
    ]);

    expect(storage.writes.map((write) => write.content)).to.deep.equal([
      'Saved archive\nFirst',
      'Saved archive\nFirst\nSecond',
    ]);
    expect(storage.appliedEdits).to.have.length(2);
  });

  it('preserves a dirty archive buffer opened during a pending disk write', async () => {
    const source = makeDocument('TODO', 'Task'),
      storage = loadArchiveStorage([source]);

    storage.File.make = async () => {
      storage.workspace.textDocuments.push(makeDocument('ARCHIVE.TODO', 'New unsaved note'));
    };

    await storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content + '\nTask');

    expect(storage.renames).to.deep.equal([]);
    expect(storage.appliedEdits).to.have.length(1);
    expect(storage.appliedEdits[0].entries.get('ARCHIVE.TODO')[0].content).to.equal(
      'New unsaved note\nTask'
    );
  });

  it('rejects stale source edits after waiting for another archive operation', async () => {
    const firstSource = makeDocument('FIRST.TODO', 'First'),
      secondSource = makeDocument('SECOND.TODO', 'Second'),
      storage = loadArchiveStorage([firstSource, secondSource]);
    storage.File.make = async () => {
      secondSource.version++;
    };

    const first = storage.archiveToFile('ARCHIVE.TODO', firstSource, [], (content) => content),
      second = storage.archiveToFile('ARCHIVE.TODO', secondSource, [], (content) => content);

    await first;
    expect((await getFailure(second)).message).to.contain('source changed');
    expect(storage.appliedEdits).to.have.length(1);
  });

  it('keeps both files when an external edit changes the archive during a write', async () => {
    const source = makeDocument('TODO', 'Task'),
      storage = loadArchiveStorage([source]);
    storage.File.make = async () => {
      storage.setSavedContent('Externally edited archive');
    };

    const error = await getFailure(
      storage.archiveToFile('ARCHIVE.TODO', source, [], (content) => content + '\nTask')
    );

    expect(error.message).to.contain('archive changed');
    expect(storage.renames).to.deep.equal([]);
    expect(storage.appliedEdits).to.deep.equal([]);
  });
});
