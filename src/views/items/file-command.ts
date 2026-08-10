export const getFileOpenCommand = (item: object) => ({
    title: 'Open',
    command: 'todo.viewOpenFile',
    arguments: [item],
});
