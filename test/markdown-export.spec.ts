import { expect } from 'chai';
import { renderTodoMarkdown } from '../src/utils/markdown-export';

describe('Todo Markdown export', () => {
    it('renders pending, done, and cancelled tasks distinctly', () => {
        const markdown = renderTodoMarkdown('Tasks', [
            { kind: 'todo', level: 0, status: 'pending', text: 'First' },
            { kind: 'todo', level: 0, status: 'done', text: 'Second' },
            { kind: 'todo', level: 0, status: 'cancelled', text: 'Third' },
        ]);

        expect(markdown).to.equal('# Tasks\n\n- [ ] First\n- [x] Second\n- [ ] ~~Third~~\n');
    });

    it('preserves project hierarchy and comment lines', () => {
        const markdown = renderTodoMarkdown('Tasks', [
            { kind: 'project', level: 0, text: 'Project' },
            { kind: 'todo', level: 2, status: 'pending', text: 'Nested' },
            { kind: 'comment', level: 1, text: 'Sibling note' },
        ]);

        expect(markdown).to.equal('# Tasks\n\n- **Project**\n    - [ ] Nested\n  - Sibling note\n');
    });

    it('converts Todo inline formatting to Markdown equivalents', () => {
        const markdown = renderTodoMarkdown('Tasks', [
            {
                kind: 'comment',
                level: 0,
                text: '*bold* _italic_ ~struck~ `code`',
            },
        ]);

        expect(markdown).to.include('- **bold** _italic_ ~~struck~~ `code`');
    });

    it('leaves repeated formatting delimiters unchanged', () => {
        const markdown = renderTodoMarkdown('Tasks', [
            { kind: 'comment', level: 0, text: '**bold** ~~struck~~' },
        ]);

        expect(markdown).to.include('- **bold** ~~struck~~');
    });

    it('renders a useful empty state', () => {
        expect(renderTodoMarkdown('Empty', [])).to.equal('# Empty\n\n_No content to export._\n');
    });
});
