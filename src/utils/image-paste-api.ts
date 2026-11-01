import type {
  CancellationToken,
  Disposable,
  DocumentSelector,
  Range,
  TextDocument,
  WorkspaceEdit,
} from 'vscode';

// The paste API was stabilized in VS Code 1.97. Keep its small runtime boundary
// separate so the extension can still compile and activate against 1.36.
export interface ImagePasteKind {
  readonly value: string;
  append(...parts: string[]): ImagePasteKind;
}

export interface ImagePasteFile {
  readonly name: string;
  data(): Thenable<Uint8Array>;
}

export interface ImagePasteTransfer {
  get(mime: string): { asString(): Thenable<string> } | undefined;
  forEach(callback: (item: { asFile(): ImagePasteFile | undefined }, mime: string) => void): void;
}

export interface ImagePasteEdit {
  insertText: string;
  additionalEdit?: WorkspaceEdit;
  yieldTo?: readonly ImagePasteKind[];
}

export interface ImagePasteContext {
  readonly triggerKind?: number;
}

export interface ImagePasteProvider {
  provideDocumentPasteEdits(
    document: TextDocument,
    ranges: readonly Range[],
    dataTransfer: ImagePasteTransfer,
    context: ImagePasteContext,
    token: CancellationToken
  ): Promise<ImagePasteEdit[] | undefined>;
  resolveDocumentPasteEdit(edit: ImagePasteEdit, token: CancellationToken): Promise<ImagePasteEdit>;
}

interface ImagePasteApi {
  readonly version: string;
  DocumentDropOrPasteEditKind: { Empty: ImagePasteKind; Text: ImagePasteKind };
  DocumentPasteTriggerKind: { PasteAs: number };
  DocumentPasteEdit: new (text: string, title: string, kind: ImagePasteKind) => ImagePasteEdit;
  CancellationError: new () => Error;
  languages: {
    registerDocumentPasteEditProvider(
      selector: DocumentSelector,
      provider: ImagePasteProvider,
      metadata: { providedPasteEditKinds: ImagePasteKind[]; pasteMimeTypes: string[] }
    ): Disposable;
  };
}

export const getImagePasteApi = (): ImagePasteApi | undefined => {
  const api = require('vscode') as ImagePasteApi;
  const [major, minor] = api.version.split('.').map(Number);
  // Older hosts expose this method too, but calling it requires a proposed API
  // permission. Feature detection alone would break extension activation there.
  if (!(major > 1 || (major === 1 && minor >= 97))) return;
  if (
    typeof api.languages.registerDocumentPasteEditProvider !== 'function' ||
    typeof api.DocumentPasteEdit !== 'function' ||
    !api.DocumentDropOrPasteEditKind
  )
    return;
  return api;
};
