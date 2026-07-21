import * as vscode from 'vscode';
import { ExcludeGlobs, getEnabledExcludeGlobs } from './file-globs';

export const getWorkspaceExcludeRules = (resourcePath: string): ExcludeGlobs =>
    vscode.workspace
        .getConfiguration('files', vscode.Uri.file(resourcePath))
        .get<ExcludeGlobs>('exclude', {});

export const getWorkspaceExcludeGlobs = (resourcePath: string): string[] =>
    getEnabledExcludeGlobs(getWorkspaceExcludeRules(resourcePath));
