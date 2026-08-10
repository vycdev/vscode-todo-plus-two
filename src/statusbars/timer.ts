/* IMPORT */

import * as vscode from 'vscode';
import Config from '../config';
import Consts from '../consts';
import Document from '../todo/document';
import Utils from '../utils';
import { getTimerState } from '../utils/timekeeping';

/* TIMER */

class Timer {
    item;
    itemProps;
    config;
    data;
    intervalId;

    constructor() {
        this.item = this._initItem();
        this.itemProps = {};
        this.data = {};
    }

    _initItem() {
        const alignment =
                Config.getKey('timer.statusbar.alignment') === 'right'
                    ? vscode.StatusBarAlignment.Right
                    : vscode.StatusBarAlignment.Left,
            priority = Config.getKey('timer.statusbar.priority');

        return vscode.window.createStatusBarItem(alignment, priority);
    }

    _setItemProp(prop, value, _set = true) {
        if (this.itemProps[prop] === value) return false;

        this.itemProps[prop] = value;

        if (_set) {
            this.item[prop] = value;
        }

        return true;
    }

    update(doc: Document) {
        this.config = Config.get();

        const updated = this.updateData(doc);

        if (!updated) return;

        this.updateVisibility();
        this.updateTimer();

        if (!this.itemProps.visibility) return;

        this.updateColor();
        this.updateCommand();
        this.updateTooltip();
        this.updateText();
    }

    updateData(doc: Document) {
        const startedFormat = this.config.timekeeping.started.format,
            timestampOffset = startedFormat.indexOf('s') >= 0 ? 0 : Date.now() % 60000,
            todo = doc.getTodosBoxStarted().find((candidate) => {
                const state = getTimerState(
                    candidate.text,
                    startedFormat,
                    new Date(),
                    timestampOffset
                );

                return Boolean(state && state.active);
            });

        if (!todo) {
            if (!this.data.line) return false;

            this.data = {};
        } else {
            if (
                this.data.text === todo.text &&
                this.data.line &&
                this.data.line.lineNumber === todo.line.lineNumber
            ) {
                return false;
            }

            const startedTag = todo['getTag'](Consts.regexes.tagStarted); //TSC

            if (
                this.data.line &&
                this.data.line.lineNumber === todo.line.lineNumber &&
                this.data.startedTag === startedTag
            ) {
                // Support for editing the todo without resetting the timer

                this.data.text = todo.text;

                this.updateTooltip();

                return false;
            }

            this.data = {
                filePath: doc.textDocument.uri.fsPath,
                line: todo.line,
                text: todo.text,
                startedTag,
                startedFormat,
                timestampOffset,
            };

            const estTag = todo['getTag'](Consts.regexes.tagEstimate); //TSC

            if (estTag) {
                const estSeconds = Utils.statistics.timeTags.parseEstimate(estTag);

                if (estSeconds) {
                    this.data.estMilliseconds = estSeconds * 1000;
                }
            }
        }

        return true;
    }

    updateColor() {
        const { color } = this.config.timer.statusbar;

        this._setItemProp('color', color);
    }

    updateCommand() {
        const command = Utils.command.get('todo.open', [
            this.data.filePath,
            this.data.line.lineNumber,
        ]);

        this._setItemProp('command', command);
    }

    updateTooltip() {
        this._setItemProp('tooltip', this.data.text);
    }

    updateText() {
        const state = getTimerState(
            this.data.text,
            this.data.startedFormat,
            new Date(),
            this.data.timestampOffset
        );

        if (!state) return;

        const fromDate = this.data.estMilliseconds
                ? new Date(state.elapsedMilliseconds)
                : new Date(0),
            toDate = this.data.estMilliseconds
                ? new Date(this.data.estMilliseconds)
                : new Date(state.elapsedMilliseconds),
            clock = Utils.time.diffClock(toDate, fromDate);

        this._setItemProp('text', clock);
    }

    updateVisibility() {
        const condition = Consts.timer,
            visibility =
                this.data.text &&
                (condition === true || (condition === 'estimate' && this.data.estMilliseconds));

        if (this._setItemProp('visibility', visibility)) {
            this.item[visibility ? 'show' : 'hide']();
        }
    }

    updateTimer() {
        if (this.intervalId) clearInterval(this.intervalId);

        if (!this.itemProps.visibility) return;

        this.intervalId = setInterval(this.updateText.bind(this), 1000);
    }
}

/* EXPORT */

export default new Timer();
