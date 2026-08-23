import { expect } from 'chai';
import { renderTodoHtml } from '../src/utils/html-export';

describe('Todo HTML export', () => {
    it('renders pending, done, and cancelled tasks distinctly', () => {
        const html = renderTodoHtml('Tasks', [
            { kind: 'todo', level: 0, status: 'pending', text: 'First' },
            { kind: 'todo', level: 0, status: 'done', text: 'Second' },
            { kind: 'todo', level: 0, status: 'cancelled', text: 'Third' },
        ]);

        expect(html).to.include('class="todo pending"');
        expect(html).to.include('class="todo done"');
        expect(html).to.include('class="todo cancelled"');
        expect(html).to.include('Pending:');
        expect(html).to.include('Done:');
        expect(html).to.include('Cancelled:');
        expect(html).to.include('>☐</span>');
        expect(html).to.include('>✔</span>');
        expect(html).to.include('>✘</span>');
    });

    it('preserves indentation as nested lists even when levels jump', () => {
        const html = renderTodoHtml('Tasks', [
            { kind: 'project', level: 0, text: 'Project' },
            { kind: 'todo', level: 2, status: 'pending', text: 'Nested' },
            { kind: 'comment', level: 1, text: 'Sibling note' },
            { kind: 'project', level: 0, text: 'Next project' },
        ]);

        expect(html).to.include(
            '<li class="project"><span class="project-title">Project</span>\n<ul>\n' +
                '<li class="todo pending"'
        );
        expect(html).to.include('</ul>\n</li>\n<li class="project">');
    });

    it('escapes titles and content before applying supported inline formatting', () => {
        const html = renderTodoHtml('<script>alert("title")</script>', [
            {
                kind: 'todo',
                level: 0,
                status: 'pending',
                text: '<img src=x onerror=alert(1)> & *safe <b>bold</b>* `x & y`',
            },
        ]);

        expect(html).not.to.include('<script>alert');
        expect(html).not.to.include('<img src=x');
        expect(html).to.include('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
        expect(html).to.include('&lt;img src=x onerror=alert(1)&gt; &amp;');
        expect(html).to.include('<strong>safe &lt;b&gt;bold&lt;/b&gt;</strong>');
        expect(html).to.include('<code>x &amp; y</code>');
    });

    it('leaves repeated formatting delimiters as escaped text', () => {
        const html = renderTodoHtml('Tasks', [
            { kind: 'comment', level: 0, text: '**bold** ~~struck~~' },
        ]);

        expect(html).to.include('**bold** ~~struck~~');
        expect(html).not.to.include('<strong>');
        expect(html).not.to.include('<del>');
    });

    it('renders a useful empty state', () => {
        expect(renderTodoHtml('Empty', [])).to.include(
            '<p class="empty">No content to export.</p>'
        );
    });
});
