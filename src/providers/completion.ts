/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Consts from '../consts';
import Document from '../todo/document';
import DependencyIndex from '../utils/dependency_index';

/* COMPLETION */

class Completion implements vscode.CompletionItemProvider {
    static triggerCharacters = [Consts.symbols.tag, '('];

    async provideCompletionItems(textDocument: vscode.TextDocument, pos: vscode.Position) {
        const line = textDocument.lineAt(pos.line).text;
        const character = line[pos.character - 1];
        const dependency = line.substring(0, pos.character).match(/@depends\(([^)]*)$/);

        if (dependency) return Completion.getDependencyIds(textDocument, pos, dependency[1]);

        if (
            !character ||
            !_.trim(character).length ||
            _.includes(Completion.triggerCharacters, character)
        ) {
            /* SPECIAL */

            const tagsSpecial = Consts.tags.names.map((tag) => {
                const text = `@${tag}`,
                    item = new vscode.CompletionItem(text);

                item.insertText = `${text} `;

                return item;
            });

            /* SMART */

            const doc = new Document(textDocument),
                tags = _.uniq(doc.getTags().map((tag) => tag.text)),
                tagsFiltered = tags.filter((tag) => Consts.regexes.tagNormal.test(tag));

            const tagsSmart = tagsFiltered.map((text) => {
                const item = new vscode.CompletionItem(text);

                item.insertText = `${text} `;

                return item;
            });

            const dependencyTags = ['@id()', '@depends()'].map((text) => {
                const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Reference);

                item.insertText = text;

                return item;
            });

            return dependencyTags.concat(tagsSpecial, tagsSmart);
        }

        return null; // Word-based suggestions
    }

    private static async getDependencyIds(
        textDocument: vscode.TextDocument,
        pos: vscode.Position,
        query: string
    ) {
        const index = await DependencyIndex.get(textDocument);
        const range = new vscode.Range(
            pos.line,
            pos.character - query.length,
            pos.line,
            pos.character
        );

        return Object.keys(index.targets)
            .filter((id) => id.toLowerCase().indexOf(query.toLowerCase()) >= 0)
            .sort()
            .map((id) => {
                const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
                const count = index.targets[id].length;

                item.detail = `${count} matching task${count === 1 ? '' : 's'}`;
                item.insertText = `${id})`;
                item.range = range;

                return item;
            });
    }
}

/* EXPORT */

export default Completion;
