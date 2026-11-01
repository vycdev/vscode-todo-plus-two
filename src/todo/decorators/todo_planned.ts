import { DecorationRangeBehavior, Range } from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import { getActivePlannedTags } from '../../utils/planned';
import { cachedDecorationType } from './cached-type';

const getDecorationType = cachedDecorationType(() => ({
  color: Consts.colors.planned,
  fontWeight: 'bold',
  rangeBehavior: DecorationRangeBehavior.ClosedClosed,
  dark: { color: Consts.colors.dark.planned || Consts.colors.planned },
  light: { color: Consts.colors.light.planned || Consts.colors.planned },
}));

export const getPlannedDecorations = (
  todos: { text: string; range: Range; markdownNode?: object }[],
  now: Date = new Date()
) => {
  const ranges: Range[] = [];

  if (Config.getKey('planned.enabled') === true) {
    todos.forEach((todo) => {
      getActivePlannedTags(todo.text, now, !!todo.markdownNode).forEach(({ start, end }) => {
        ranges.push(
          new Range(
            todo.range.start.line,
            todo.range.start.character + start,
            todo.range.start.line,
            todo.range.start.character + end
          )
        );
      });
    });
  }

  return [{ type: getDecorationType(), ranges }];
};
