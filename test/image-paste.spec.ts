import { expect } from 'chai';
import * as path from 'path';
import { findRelativeFileLinks } from '../src/utils/file-links';

const loadImagePaste = (supported = true, version = '1.97.0') => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/providers/image_paste');
  const previous = require.cache[modulePath];
  const errors: string[] = [];
  const messages: string[] = [];
  const state = { provider: undefined, selector: undefined, metadata: undefined, disposed: 0 };
  class Kind {
    constructor(public value: string) {}
    append(...parts: string[]) {
      return new Kind([this.value, ...parts].filter(Boolean).join('.'));
    }
  }
  const vscode = {
    version,
    languages: supported
      ? {
          registerDocumentPasteEditProvider: (selector, provider, metadata) => {
            Object.assign(state, { selector, provider, metadata });
            return { dispose: () => state.disposed++ };
          },
        }
      : {},
    DocumentDropOrPasteEditKind: { Empty: new Kind(''), Text: new Kind('text') },
    DocumentPasteTriggerKind: { PasteAs: 1 },
    DocumentPasteEdit: class {
      constructor(
        public insertText: string,
        public title: string,
        public kind: Kind
      ) {}
    },
    CancellationError: class extends Error {
      constructor() {
        super('Canceled');
        this.name = 'Canceled';
      }
    },
    Disposable: class {
      constructor(public dispose: () => void) {}
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    WorkspaceEdit: class {
      creates = [];
      replacements = [];
      order = [];
      createFile(uri, options) {
        this.creates.push({ uri, options });
        this.order.push('file');
      }
      replace(uri, range, text) {
        this.replacements.push({ uri, range, text });
        this.order.push('text');
      }
    },
    window: {
      showErrorMessage: (message: string) => errors.push(message),
      showInformationMessage: (message: string) => messages.push(message),
    },
  };
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return vscode;
    if (parent && parent.filename === modulePath && request === '../config') {
      return { default: { getKey: () => false } };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    const registration = require(modulePath).registerImagePasteProvider();
    return { state, registration, errors, messages };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

const documentPath = path.resolve(path.sep, 'workspace', 'My tasks (#1).todo');
const makeDocument = () => ({
  uri: { scheme: 'file', fsPath: documentPath },
  isUntitled: false,
  isClosed: false,
  version: 1,
});
const makeFile = (name = 'clipboard.png', data = new Uint8Array([1, 2, 3])) => ({
  name,
  data: async () => data,
});
const transfer = (entries: [string, ReturnType<typeof makeFile> | undefined][], text?: string) => ({
  get: (mime: string) =>
    mime === 'text/plain' && text !== undefined ? { asString: async () => text } : undefined,
  forEach: (callback) => entries.forEach(([mime, file]) => callback({ asFile: () => file }, mime)),
});
const provide = (
  state,
  entries,
  document = makeDocument(),
  token = { isCancellationRequested: false },
  ranges = [{}],
  text?: string
) => state.provider.provideDocumentPasteEdits(document, ranges, transfer(entries, text), {}, token);
const paste = async (
  state,
  entries,
  document = makeDocument(),
  token = { isCancellationRequested: false },
  ranges = [{}]
) => {
  const edits = await provide(state, entries, document, token, ranges);
  if (edits) for (const edit of edits) await state.provider.resolveDocumentPasteEdit(edit, token);
  return edits;
};
const failure = async (promise): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected image paste to fail');
};

describe('Image paste provider', () => {
  it('leaves hosts without the paste API unregistered', () => {
    const { state, registration } = loadImagePaste(false);
    expect(registration).to.equal(undefined);
    expect(state.provider).to.equal(undefined);
  });

  for (const version of ['1.36.0', '1.96.4', '1.96.0-insider']) {
    it(`avoids the proposal-gated paste API on VS Code ${version}`, () => {
      const { state, registration } = loadImagePaste(true, version);
      expect(registration).to.equal(undefined);
      expect(state.provider).to.equal(undefined);
    });
  }

  for (const version of ['1.97.0-insider', '1.100.0', '2.0.0']) {
    it(`registers the stable paste API on VS Code ${version}`, () => {
      const { state, registration } = loadImagePaste(true, version);
      expect(state.provider).not.to.equal(undefined);
      registration.dispose();
    });
  }

  it('registers Todo-only image paste and disposes it', () => {
    const { state, registration } = loadImagePaste();
    expect(state.selector).to.deep.equal({ language: 'todo' });
    expect(state.metadata.pasteMimeTypes).to.deep.equal(['image/png', 'image/jpeg', 'files']);
    expect(state.metadata.providedPasteEditKinds[0].value).to.equal('todo.image');
    registration.dispose();
    expect(state.disposed).to.equal(1);
  });

  it('returns original image bytes and an encoded clickable link without writing files', async () => {
    const { state, errors } = loadImagePaste();
    const file = makeFile();
    const [edit] = await paste(state, [['image/png', file]]);
    const [{ uri, options }] = edit.additionalEdit.creates;
    expect(uri.fsPath).to.match(/image-[0-9a-f]{32}\.png$/);
    expect(path.dirname(uri.fsPath)).to.equal(`${documentPath}.assets`);
    expect(edit.insertText).to.equal('');
    expect(edit.additionalEdit.replacements[0].text).to.equal(
      `<file://./My%20tasks%20%28%231%29.todo.assets/${path.basename(uri.fsPath)}>`
    );
    expect(options.contents).to.deep.equal(await file.data());
    expect(options.overwrite).to.equal(false);
    expect(options.ignoreIfExists).to.equal(false);
    expect(edit.additionalEdit.order).to.deep.equal(['file', 'text']);
    expect(edit.yieldTo).to.deep.equal([]);
    expect(errors).to.deep.equal([]);
  });

  it('does not wait for clipboard images or report their errors before selection', async () => {
    const { state, errors, messages } = loadImagePaste();
    let reads = 0;
    let rejectRead: (error: Error) => void;
    const file = {
      name: 'unreadable.png',
      data: () => {
        reads++;
        return new Promise<Uint8Array>((_resolve, reject) => {
          rejectRead = reject;
        });
      },
    };
    const [edit] = await provide(
      state,
      [['image/png', file]],
      makeDocument(),
      undefined,
      undefined,
      'Keep this text'
    );
    expect(reads).to.equal(1);
    expect(edit.additionalEdit).to.equal(undefined);
    expect(edit.yieldTo.map((kind) => kind.value)).to.deep.equal(['text']);
    rejectRead(new Error('Clipboard read failed'));
    await Promise.resolve();
    expect(errors.concat(messages)).to.deep.equal([]);
    expect(
      (
        await failure(
          state.provider.resolveDocumentPasteEdit(edit, { isCancellationRequested: false })
        )
      ).message
    ).to.include('Clipboard read failed');
    expect(edit.additionalEdit).to.equal(undefined);
  });

  it('starts clipboard reads while the data-transfer file handle is still valid', async () => {
    const { state } = loadImagePaste();
    let valid = true;
    const file = {
      name: 'clipboard.png',
      data: async () => {
        if (!valid) throw new Error('Clipboard handle expired');
        return new Uint8Array([1, 2, 3]);
      },
    };
    const [edit] = await provide(state, [['image/png', file]]);
    valid = false;
    const resolved = await state.provider.resolveDocumentPasteEdit(edit, {
      isCancellationRequested: false,
    });
    expect(resolved.additionalEdit.creates[0].options.contents).to.deep.equal(
      new Uint8Array([1, 2, 3])
    );
  });

  it('does not yield image edits to an empty text/plain entry', async () => {
    const { state } = loadImagePaste();
    const [edit] = await provide(
      state,
      [['image/png', makeFile()]],
      makeDocument(),
      undefined,
      undefined,
      ''
    );
    expect(edit.yieldTo).to.deep.equal([]);
  });

  it('provides complete image edits for explicit Paste As hosts that skip resolution', async () => {
    const { state } = loadImagePaste();
    const file = makeFile();
    const [edit] = await state.provider.provideDocumentPasteEdits(
      makeDocument(),
      [{}],
      transfer([['image/png', file]], 'Text'),
      { triggerKind: 1 },
      { isCancellationRequested: false }
    );
    expect(edit.additionalEdit.creates).to.have.length(1);
    expect(edit.additionalEdit.creates[0].options.contents).to.deep.equal(await file.data());
  });

  it('declines failed explicit image pastes rather than returning a dangling link', async () => {
    const { state, errors } = loadImagePaste();
    const edits = await state.provider.provideDocumentPasteEdits(
      makeDocument(),
      [{}],
      transfer([['image/png', makeFile('empty.png', new Uint8Array())]]),
      { triggerKind: 1 },
      { isCancellationRequested: false }
    );
    expect(edits).to.equal(undefined);
    expect(errors).to.have.length(1);
    expect(errors[0]).to.include('empty');
  });

  it('allows selecting the image alternative after VS Code undoes the initial text paste', async () => {
    const { state } = loadImagePaste();
    const document = makeDocument();
    const [edit] = await provide(
      state,
      [['image/png', makeFile()]],
      document,
      undefined,
      undefined,
      'Text'
    );
    document.version += 2; // Initial text paste and the widget's undo.
    const resolved = await state.provider.resolveDocumentPasteEdit(edit, {
      isCancellationRequested: false,
    });
    expect(resolved.additionalEdit.creates).to.have.length(1);
  });

  it('keeps pasted links clickable at task ends and next to existing text', async () => {
    const { state } = loadImagePaste();
    const [edit] = await paste(state, [['image/png', makeFile()]]);
    const targetPath = edit.additionalEdit.creates[0].uri.fsPath;
    for (const [before, after] of [
      ['☐ Fix bug', ''],
      ['☐ Fix ', 'bug'],
      ['☐ Re', 'pair'],
      ['☐ (', ').'],
    ]) {
      const text = `${before}${edit.additionalEdit.replacements[0].text}${after}`;
      const links = findRelativeFileLinks(text, documentPath);
      expect(
        links.map((link) => link.targetPath),
        text
      ).to.deep.equal([targetPath]);
    }
  });

  it('uses separate filenames for repeated pastes and deduplicates repeated file representations', async () => {
    const { state } = loadImagePaste();
    const file = makeFile();
    const [first] = await paste(state, [
      ['image/png', file],
      ['application/octet-stream', file],
    ]);
    const [second] = await paste(state, [['image/png', file]]);
    expect(first.additionalEdit.creates).to.have.length(1);
    expect(first.additionalEdit.replacements[0].text).not.to.equal(
      second.additionalEdit.replacements[0].text
    );
  });

  it('pastes multiple PNG/JPEG files and ignores other clipboard content', async () => {
    const { state } = loadImagePaste();
    const [edit] = await paste(state, [
      ['text/plain', undefined],
      ['image/png', makeFile()],
      ['image/jpeg', makeFile('copied.jpg')],
      ['application/octet-stream', makeFile('OTHER.JPEG')],
      ['image/gif', makeFile('animation.gif')],
    ]);
    expect(edit.additionalEdit.creates.map(({ uri }) => path.extname(uri.fsPath))).to.deep.equal([
      '.png',
      '.jpg',
      '.jpeg',
    ]);
    expect(edit.additionalEdit.replacements[0].text.split(' ')).to.have.length(3);
    expect(edit.additionalEdit.order).to.deep.equal(['file', 'file', 'file', 'text']);
  });

  it('creates one shared attachment before replacing every selected range', async () => {
    const { state } = loadImagePaste();
    const document = makeDocument();
    const ranges = [{ selection: 1 }, { selection: 2 }];
    const [edit] = await paste(state, [['image/png', makeFile()]], document, undefined, ranges);
    expect(edit.insertText).to.equal('');
    expect(edit.additionalEdit.creates).to.have.length(1);
    expect(edit.additionalEdit.order).to.deep.equal(['file', 'text', 'text']);
    expect(edit.additionalEdit.replacements.map((replacement) => replacement.range)).to.deep.equal(
      ranges
    );
    expect(edit.additionalEdit.replacements.map((replacement) => replacement.text)).to.deep.equal([
      edit.additionalEdit.replacements[0].text,
      edit.additionalEdit.replacements[0].text,
    ]);
  });

  it('leaves ordinary text and unsupported images to the normal paste handlers', async () => {
    const { state, messages, errors } = loadImagePaste();
    expect(await paste(state, [['text/plain', undefined]])).to.equal(undefined);
    expect(await paste(state, [['image/gif', makeFile('animation.gif')]])).to.equal(undefined);
    expect(messages.concat(errors)).to.deep.equal([]);
  });

  it('reports unsupported documents only when the image edit is selected', async () => {
    const { state, messages } = loadImagePaste();
    const untitled = makeDocument();
    untitled.isUntitled = true;
    untitled.uri.scheme = 'untitled';
    const [unsavedEdit] = await provide(state, [['image/png', makeFile()]], untitled);
    expect(messages).to.deep.equal([]);
    expect(
      (
        await failure(
          state.provider.resolveDocumentPasteEdit(unsavedEdit, { isCancellationRequested: false })
        )
      ).message
    ).to.include('Save the Todo file');
    const virtual = makeDocument();
    virtual.uri.scheme = 'git';
    expect((await failure(paste(state, [['image/png', makeFile()]], virtual))).message).to.include(
      'local filesystem'
    );
    expect(messages).to.deep.equal([]);
  });

  it('reports unreadable and empty images without returning a partial edit', async () => {
    const { state, errors } = loadImagePaste();
    const broken = {
      name: 'broken.png',
      data: async () => {
        throw new Error('Clipboard read failed');
      },
    };
    expect(
      (
        await failure(
          paste(state, [
            ['image/png', makeFile()],
            ['image/png', broken],
          ])
        )
      ).message
    ).to.include('Clipboard read failed');
    expect(
      (await failure(paste(state, [['image/png', makeFile('empty.png', new Uint8Array())]])))
        .message
    ).to.include('empty');
    expect(errors).to.deep.equal([]);
  });

  for (const reason of ['cancelled', 'changed', 'closed', 'disposed']) {
    it(`discards a pending paste when ${reason}`, async () => {
      const { state, registration, errors } = loadImagePaste();
      const document = makeDocument();
      const token = { isCancellationRequested: false };
      let finish: (data: Uint8Array) => void;
      const file = {
        name: 'pending.png',
        data: () =>
          new Promise<Uint8Array>((resolve) => {
            finish = resolve;
          }),
      };
      const [edit] = await provide(state, [['image/png', file]], document, token);
      const pending = state.provider.resolveDocumentPasteEdit(edit, token);
      if (reason === 'cancelled') token.isCancellationRequested = true;
      if (reason === 'changed') document.version++;
      if (reason === 'closed') document.isClosed = true;
      if (reason === 'disposed') registration.dispose();
      finish(new Uint8Array([1]));
      expect((await failure(pending)).name).to.equal('Canceled');
      expect(edit.additionalEdit).to.equal(undefined);
      expect(errors).to.deep.equal([]);
    });
  }

  it('does not read the clipboard for cancelled, closed, empty-selection, or disposed requests', async () => {
    const { state, registration } = loadImagePaste();
    let reads = 0;
    const file = {
      name: 'image.png',
      data: async () => {
        reads++;
        return new Uint8Array([1]);
      },
    };
    await paste(state, [['image/png', file]], makeDocument(), { isCancellationRequested: true });
    await paste(state, [['image/png', file]], { ...makeDocument(), isClosed: true });
    await paste(state, [['image/png', file]], makeDocument(), undefined, []);
    registration.dispose();
    await paste(state, [['image/png', file]]);
    expect(reads).to.equal(0);
  });
});
