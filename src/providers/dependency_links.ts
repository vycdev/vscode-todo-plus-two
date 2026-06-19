/* IMPORT */

import * as vscode from 'vscode';
import DependencyIndex from '../utils/dependency_index';
import { DependencyReference, getDependencies } from '../utils/dependencies';

/* DEPENDENCY LINKS */

class DependencyLinkProvider implements vscode.DocumentLinkProvider {
    async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
        const dependencies = this.getDependencies(document);

        if (!dependencies.length) return [];

        const index = await DependencyIndex.get(document);

        return dependencies
            .map((dependency) => {
                const targets = index.targets[dependency.id] || [];

                if (!targets.length) return;

                const range = new vscode.Range(
                    new vscode.Position(dependency.lineNumber, dependency.tagStart),
                    new vscode.Position(dependency.lineNumber, dependency.tagEnd)
                );
                const args = encodeURIComponent(JSON.stringify([targets]));

                return new vscode.DocumentLink(
                    range,
                    vscode.Uri.parse(`command:todo.openDependency?${args}`)
                );
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
}

interface DependencyReferenceAtLine extends DependencyReference {
    lineNumber: number;
}

/* EXPORT */

export default DependencyLinkProvider;
