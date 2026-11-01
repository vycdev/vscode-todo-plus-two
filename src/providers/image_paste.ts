import { Disposable, Uri, window, WorkspaceEdit } from 'vscode';
import type { CancellationToken, Range, TextDocument } from 'vscode';
import Config from '../config';
import {
  checkImageAttachmentPath,
  createImageAttachment,
  getImageExtension,
} from '../utils/image-attachments';
import { getImagePasteApi } from '../utils/image-paste-api';
import type {
  ImagePasteEdit,
  ImagePasteContext,
  ImagePasteFile,
  ImagePasteProvider,
  ImagePasteTransfer,
} from '../utils/image-paste-api';

type ImageReadResult = { contents: Uint8Array } | { error: unknown };

const readImage = async (file: ImagePasteFile): Promise<ImageReadResult> => {
  try {
    return { contents: await file.data() };
  } catch (error) {
    // A text edit may win. Save the failure for image resolution instead of
    // reporting it for an edit the user never selected.
    return { error };
  }
};

export const registerImagePasteProvider = (): Disposable | undefined => {
  const api = getImagePasteApi();
  if (!api) return;

  const kind = api.DocumentDropOrPasteEditKind.Empty.append('todo', 'image');
  const pending = new WeakMap<
    ImagePasteEdit,
    {
      document: TextDocument;
      attachments: { data: Promise<ImageReadResult>; filePath: string; link: string }[];
      ranges: readonly Range[];
      insertText: string;
    }
  >();
  let disposed = false;
  const provider: ImagePasteProvider = {
    async provideDocumentPasteEdits(
      document: TextDocument,
      ranges: readonly Range[],
      dataTransfer: ImagePasteTransfer,
      context: ImagePasteContext,
      token: CancellationToken
    ): Promise<ImagePasteEdit[] | undefined> {
      if (disposed || token.isCancellationRequested || document.isClosed || !ranges.length) return;
      const files = new Map<ImagePasteFile, string>();
      dataTransfer.forEach((item, mime) => {
        const file = item.asFile();
        const extension = file && getImageExtension(mime, file.name);
        if (extension && !files.has(file)) files.set(file, extension);
      });
      if (!files.size) return;
      const version = document.version;
      const text = await dataTransfer.get('text/plain')?.asString();
      if (
        disposed ||
        token.isCancellationRequested ||
        document.isClosed ||
        document.version !== version
      )
        return;
      const attachments =
        document.isUntitled || document.uri.scheme !== 'file'
          ? []
          : Array.from(files, ([file, extension]) => ({
              ...createImageAttachment(document.uri.fsPath, extension),
              // VS Code 1.97 releases clipboard file handles when discovery
              // returns. Start reads now, but do not delay normal text paste.
              data: readImage(file),
            }));
      // Angle brackets delimit each link even when pasting between words or
      // replacing a selection. Bare links require surrounding whitespace.
      const insertText = attachments.map(({ link }) => `<${link}>`).join(' ');
      // Native paste inserts non-empty insertText before additional file edits.
      // Put the text in additionalEdit instead, after all image creations, so a
      // failed file write never replaces the selection with a dangling link.
      const edit = new api.DocumentPasteEdit('', 'Paste Image Attachment', kind);
      // VS Code offers a text edit even for an empty text/plain clipboard entry.
      // Let images win over empty text, while preserving meaningful text paste.
      edit.yieldTo = text ? [api.DocumentDropOrPasteEditKind.Text] : [];
      pending.set(edit, { document, attachments, ranges: ranges.slice(), insertText });
      // VS Code 1.97's explicit Paste As path applies the provided edit without
      // calling resolveDocumentPasteEdit. Return a complete edit for that path.
      if (context.triggerKind === api.DocumentPasteTriggerKind.PasteAs) {
        try {
          await provider.resolveDocumentPasteEdit(edit, token);
        } catch (error) {
          if (!(error instanceof api.CancellationError))
            window.showErrorMessage(error.message || String(error));
          return;
        }
      }
      return [edit];
    },
    async resolveDocumentPasteEdit(edit, token) {
      const operation = pending.get(edit);
      if (!operation) throw new api.CancellationError();
      const { document, attachments, ranges, insertText } = operation;
      // The paste widget can undo a text paste before resolving this alternate
      // edit. Capture the current version here, rather than during discovery.
      const version = document.version;
      const stale = () =>
        disposed ||
        token.isCancellationRequested ||
        document.isClosed ||
        document.version !== version;
      try {
        if (stale()) throw new api.CancellationError();
        if (document.isUntitled) throw new Error('Save the Todo file before pasting images.');
        if (document.uri.scheme !== 'file')
          throw new Error('Image paste requires a Todo file on the local filesystem.');
        const additionalEdit = new WorkspaceEdit();
        for (const { data, filePath } of attachments) {
          const result = await data;
          if (stale()) throw new api.CancellationError();
          if ('error' in result) throw result.error;
          const { contents } = result;
          if (!contents.length) throw new Error('The clipboard image is empty');
          checkImageAttachmentPath(filePath, !!Config.getKey('followSymlinks'));
          // Contents are supported by createFile on hosts with the paste API.
          // Keeping options in a variable also works with the pinned 1.36 types.
          const options = { contents, overwrite: false, ignoreIfExists: false };
          additionalEdit.createFile(Uri.file(filePath), options);
        }
        for (const range of ranges) additionalEdit.replace(document.uri, range, insertText);
        edit.additionalEdit = additionalEdit;
        return edit;
      } catch (error) {
        // Throwing aborts the selected paste. Returning undefined here would let
        // VS Code insert the link without its image; the host displays failures.
        if (stale()) throw new api.CancellationError();
        throw new Error(`Unable to paste image: ${error.message || error}`);
      }
    },
  };
  const registration = api.languages.registerDocumentPasteEditProvider(
    { language: 'todo' },
    provider,
    {
      providedPasteEditKinds: [kind],
      pasteMimeTypes: ['image/png', 'image/jpeg', 'files'],
    }
  );
  return new Disposable(() => {
    disposed = true;
    registration.dispose();
  });
};
