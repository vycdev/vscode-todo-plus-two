import type { CancellationToken } from 'vscode';

interface TransferItem {
  readonly value: unknown;
}

interface TreeDataTransfer {
  get(mimeType: string): TransferItem | undefined;
  set(mimeType: string, item: TransferItem): void;
}

interface DragAndDropRuntime {
  version: string;
  DataTransferItem?: new (value: unknown) => TransferItem;
}

interface ReorderableView<T> {
  canDrag(item: T): boolean;
  drop(item: T, target: T, token: CancellationToken): Promise<void>;
}

// Tree drag and drop became stable in VS Code 1.66. Keep the new API's small
// structural surface here so the rest of the extension still checks against 1.36.
export const getEmbeddedDragAndDropOptions = <T>(
  runtime: DragAndDropRuntime,
  view: ReorderableView<T>
) => {
  const version = /^(\d+)\.(\d+)\./.exec(runtime.version || ''),
    TransferItem = runtime.DataTransferItem;

  if (
    !version ||
    (Number(version[1]) === 1 && Number(version[2]) < 66) ||
    Number(version[1]) < 1 ||
    typeof TransferItem !== 'function'
  )
    return {};

  // VS Code advertises the tree's own MIME type before handleDrag resolves,
  // allowing native drop validation to recognize drags within this view.
  const mimeType = 'application/vnd.code.tree.todo.views.2embedded';
  let activeDrag: { item: T; payload: object } | undefined;

  return {
    dragAndDropController: {
      // The payload is for this controller only; it is not a file/URI export.
      dragMimeTypes: [],
      dropMimeTypes: [mimeType],
      handleDrag(source: readonly T[], transfer: TreeDataTransfer, token: CancellationToken) {
        activeDrag = undefined;
        if (token.isCancellationRequested || source.length !== 1 || !view.canDrag(source[0]))
          return;
        // Tree items include navigation commands that point back to themselves.
        // VS Code may stringify transfer values, so keep the row locally and
        // transfer a serializable token whose identity survives same-tree drops.
        const payload = {};
        activeDrag = { item: source[0], payload };
        transfer.set(mimeType, new TransferItem(payload));
      },
      handleDrop(target: T | undefined, transfer: TreeDataTransfer, token: CancellationToken) {
        const drag = activeDrag;
        activeDrag = undefined;
        if (token.isCancellationRequested || !target || !drag) return;
        const source = transfer.get(mimeType);
        if (!source || source.value !== drag.payload) return;
        return view.drop(drag.item, target, token);
      },
    },
  };
};
