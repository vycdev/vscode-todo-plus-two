/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../config';
import Consts from '../consts';
import Document from '../todo/document';
import DependencyIndex from '../utils/dependency_index';
import {
    getTagArgumentCompletions,
    getTagArgumentPrefix,
    getTagNameCompletions,
} from '../utils/tag_completions';
import Timestamps from '../utils/timestamps';

/* COMPLETION */

const TAG_TRIGGER_CHARACTERS = [Consts.symbols.tag, '('];
const TIMESTAMP_TRIGGER_CHARACTERS = 'creatednowCREATEDNOW'.split('');

class Completion implements vscode.CompletionItemProvider {
    static triggerCharacters = _.uniq(TAG_TRIGGER_CHARACTERS.concat(TIMESTAMP_TRIGGER_CHARACTERS));

    async provideCompletionItems(textDocument: vscode.TextDocument, pos: vscode.Position) {
        const line = textDocument.lineAt(pos.line).text;
        const character = line[pos.character - 1];
        const tagPrefix = Timestamps.getPrefix(line, pos.character);
        const tagArgumentPrefix = getTagArgumentPrefix(line, pos.character);
        const dependency = line.substring(0, pos.character).match(/@depends\(([^)]*)$/);

        if (dependency) return Completion.getDependencyIds(textDocument, pos, dependency[1]);

        if (
            !character ||
            !_.trim(character).length ||
            _.includes(TAG_TRIGGER_CHARACTERS, character) ||
            tagPrefix ||
            tagArgumentPrefix
        ) {
            const activeTagPrefix = tagArgumentPrefix || tagPrefix;
            const range = activeTagPrefix
                ? new vscode.Range(pos.line, activeTagPrefix.start, pos.line, activeTagPrefix.end)
                : undefined;

            const doc = new Document(textDocument),
                tags = doc.getTags().map((tag) => tag.text),
                tagsFiltered = tags.filter((tag) => Consts.regexes.tagNormal.test(tag));

            const tagArguments = getTagArgumentCompletions(tagsFiltered, tagArgumentPrefix);

            if (tagArgumentPrefix && tagArguments) {
                const tagsSmart = tagArguments.map((text) => {
                    const item = new vscode.CompletionItem(text);

                    item.filterText = text;
                    item.insertText = `${text} `;
                    item.range = range;

                    return item;
                });

                return Completion.filterByPrefix(tagsSmart, tagArgumentPrefix.text);
            }

            /* TIMESTAMPS */

            const timestampFormat = Config.getKey('timekeeping.created.format');
            const timestampTags = Timestamps.aliases.map((text) => {
                const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Value);

                item.detail =
                    text === '@now' ? 'Insert current timestamp' : 'Insert @created timestamp';
                item.filterText = text;
                item.insertText = Timestamps.expand(text, timestampFormat);
                if (range) item.range = range;

                return item;
            });

            /* SPECIAL */

            const tagsSpecial = Consts.tags.names.map((tag) => {
                const text = `@${tag}`,
                    item = new vscode.CompletionItem(text);

                item.filterText = text;
                item.insertText = `${text} `;
                if (range) item.range = range;

                return item;
            });

            /* SMART */

            const tagsSmart = getTagNameCompletions(
                tagsFiltered,
                Config.getKey('tags.namesInference') !== false
            ).map((text) => {
                const item = new vscode.CompletionItem(text);

                item.filterText = text;
                item.insertText = text;
                if (range) item.range = range;

                return item;
            });

            const dependencyTags = ['@id()', '@depends()'].map((text) => {
                const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Reference);

                item.filterText = text;
                item.insertText = text;
                if (range) item.range = range;

                return item;
            });

            return Completion.filterByPrefix(
                timestampTags.concat(dependencyTags, tagsSpecial, tagsSmart),
                tagPrefix && tagPrefix.text
            );
        }

        return null; // Word-based suggestions
    }

    private static filterByPrefix(items: vscode.CompletionItem[], prefix?: string) {
        if (!prefix || prefix === Consts.symbols.tag) return items;

        const prefixLower = prefix.toLowerCase();

        return items.filter(
            (item) =>
                String(item.filterText || item.label)
                    .toLowerCase()
                    .indexOf(prefixLower) === 0
        );
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
