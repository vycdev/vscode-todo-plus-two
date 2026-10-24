import { window } from 'vscode';
import type { DecorationRenderOptions, TextEditorDecorationType } from 'vscode';

export const cachedDecorationType = (options: () => DecorationRenderOptions) => {
  let signature: string;
  let type: TextEditorDecorationType;

  return (): TextEditorDecorationType => {
    const currentOptions = options();
    const currentSignature = JSON.stringify(currentOptions);

    if (!type || currentSignature !== signature) {
      if (type) type.dispose();
      type = window.createTextEditorDecorationType(currentOptions);
      signature = currentSignature;
    }

    return type;
  };
};
