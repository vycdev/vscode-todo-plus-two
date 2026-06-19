/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../consts';
import Utils from '../utils';
import {
    DependencyReference,
    DependencyTarget,
    getDependencies,
    getIds,
} from '../utils/dependencies';

/* DEPENDENCY LINKS */

class DependencyLinkProvider implements vscode.DocumentLinkProvider {
    async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
        const dependencies = this.getDependencies(document);

        if (!dependencies.length) return [];

        const targets = await this.getTargets(
            document,
            dependencies.map((dependency) => dependency.id)
        );

        return dependencies
            .map((dependency) => {
                const targetsForId = targets[dependency.id];

                if (!targetsForId.length) return;

                const range = new vscode.Range(
                    new vscode.Position(dependency.lineNumber, dependency.tagStart),
                    new vscode.Position(dependency.lineNumber, dependency.tagEnd)
                );
                const args = encodeURIComponent(JSON.stringify([targetsForId]));
                const link = new vscode.DocumentLink(
                    range,
                    vscode.Uri.parse(`command:todo.openDependency?${args}`)
                );

                return link;
            })
            .filter((link) => !!link) as vscode.DocumentLink[];
    }

    private getDependencies(document: vscode.TextDocument): DependencyReferenceAtLine[] {
        const dependencies: DependencyReferenceAtLine[] = [];

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            getDependencies(document.lineAt(lineNumber).text).forEach((dependency) => {
                dependencies.push({ ...dependency, lineNumber });
            });
        }

        return dependencies;
    }

    private async getTargets(document: vscode.TextDocument, referencedIds: string[]) {
        const ids = referencedIds.filter((id, index) => referencedIds.indexOf(id) === index);
        const targets: { [id: string]: DependencyTarget[] } = {};

        ids.forEach((id) => (targets[id] = []));

        const documents = await this.getTodoDocuments(document);

        documents.forEach((candidate) => {
            for (let lineNumber = 0; lineNumber < candidate.lineCount; lineNumber++) {
                const line = candidate.lineAt(lineNumber).text;

                if (!Utils.regex.test(Consts.regexes.todo, line)) continue;

                getIds(line).forEach((reference) => {
                    if (!targets.hasOwnProperty(reference.id)) return;

                    const target: DependencyTarget = {
                        ...reference,
                        filePath: candidate.uri.fsPath,
                        lineNumber,
                        text: line,
                    };

                    targets[reference.id].push(target);
                });
            }
        });

        return targets;
    }

    private async getTodoDocuments(document: vscode.TextDocument) {
        const paths = await Utils.files.getFilePaths(Utils.folder.getAllRootPaths());
        const documents = await Promise.all(
            paths.map((filePath) => vscode.workspace.openTextDocument(filePath))
        );

        if (!documents.some((candidate) => candidate.uri.toString() === document.uri.toString())) {
            documents.push(document);
        }

        return documents;
    }
}

interface DependencyReferenceAtLine extends DependencyReference {
    lineNumber: number;
}

/* EXPORT */

export default DependencyLinkProvider;
