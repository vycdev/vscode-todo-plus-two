/* IMPORT */

import * as vscode from 'vscode';
import Config from '../config';
import Utils from '../utils';

/* STATISTICS */

class Statistics {
    item;
    itemProps;
    config;
    tokens;
    layout: {
        alignment: vscode.StatusBarAlignment;
        priority: number;
    };

    constructor() {
        this.item = this._initItem();
        this.itemProps = {};

        this.update();
    }

    _getLayout() {
        return {
            alignment:
                Config.getKey('statistics.statusbar.alignment') === 'right'
                    ? vscode.StatusBarAlignment.Right
                    : vscode.StatusBarAlignment.Left,
            priority: Config.getKey('statistics.statusbar.priority'),
        };
    }

    _initItem() {
        const layout = this._getLayout();

        this.layout = layout;

        return vscode.window.createStatusBarItem(layout.alignment, layout.priority);
    }

    _updateLayout() {
        const layout = this._getLayout();

        if (
            this.layout &&
            this.layout.alignment === layout.alignment &&
            this.layout.priority === layout.priority
        )
            return;

        const previousItem = this.item;

        this.item = this._initItem();
        this.itemProps = {};
        if (previousItem) previousItem.dispose();
    }

    _setItemProp(prop, value, _set = true) {
        if (this.itemProps[prop] === value) return false;

        this.itemProps[prop] = value;

        if (_set) {
            this.item[prop] = value;
        }

        return true;
    }

    update() {
        this._updateLayout();
        this.config = Config.get();
        this.tokens = Utils.statistics.tokens.global;

        this.updateVisibility();

        if (!this.itemProps.visibility) return;

        this.updateColor();
        this.updateCommand();
        this.updateTooltip();
        this.updateText();
    }

    updateColor() {
        const { color } = this.config.statistics.statusbar;

        this._setItemProp('color', color);
    }

    updateCommand() {
        const { command } = this.config.statistics.statusbar;

        this._setItemProp('command', command);
    }

    updateTooltip() {
        let template = this.config.statistics.statusbar.tooltip,
            tooltip = Utils.statistics.template.render(template, this.tokens);

        this._setItemProp('tooltip', tooltip);
    }

    updateText() {
        let template = this.config.statistics.statusbar.text,
            text = Utils.statistics.template.render(template, this.tokens);

        this._setItemProp('text', text);
    }

    updateVisibility() {
        const condition = this.config.statistics.statusbar.enabled,
            visibility =
                Utils.editor.isSupported(vscode.window.activeTextEditor) &&
                Utils.statistics.condition.is(condition, this.tokens, undefined);

        if (this._setItemProp('visibility', visibility)) {
            this.item[visibility ? 'show' : 'hide']();
        }
    }
}

/* EXPORT */

export default new Statistics();
