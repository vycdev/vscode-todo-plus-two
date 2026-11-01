import Tags from './tags';
import { getMarkdownTaskTags, getTodoTaskTags } from './markdown-task-text';

export const normalizeTagGroupNames = (names: string[] = []): string[] =>
  Tags.normalizeNames(Array.isArray(names) ? names.map((name) => String(name).trim()) : []);

/** Match outer tag names, keeping arguments and inline examples out of groups. */
export const getTaskTagNames = (text: string, markdown = false): string[] => {
  const tags = markdown ? getMarkdownTaskTags(text) : getTodoTaskTags(text);

  return Array.from(
    new Set(
      tags
        .map(({ text: tag }) =>
          tag
            .slice(1)
            .replace(/\([^)]*\)$/, '')
            .replace(/[.,;:!?()[\]{}<>"']+$/, '')
        )
        .filter(Boolean)
    )
  );
};

export interface TagGroup<T> {
  name: string;
  tasks: T[];
}

/** Empty group names identify tasks that have none of the selected tags. */
export const groupTasksByTags = <T extends { tagNames: string[] }>(
  tasks: T[],
  names: string[]
): TagGroup<T>[] => {
  const groups = normalizeTagGroupNames(names).map((name) => ({ name, tasks: [] as T[] }));
  const other: TagGroup<T> = { name: '', tasks: [] };

  tasks.forEach((task) => {
    const matching = groups.filter((group) => task.tagNames.includes(group.name));
    if (!matching.length) other.tasks.push(task);
    matching.forEach((group) => group.tasks.push(task));
  });

  return groups.concat(other).filter((group) => group.tasks.length > 0);
};
