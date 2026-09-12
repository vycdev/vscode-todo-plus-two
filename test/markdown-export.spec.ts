import { expect } from 'chai';
import { renderTodoMarkdown } from '../src/utils/markdown-export';

const MarkdownIt = require('markdown-it');

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

    expect(markdown).to.equal('# Tasks\n\n- **Project**\n  - [ ] Nested\n  - Sibling note\n');
  });

  it('renders indented roots and skipped indentation levels as a task hierarchy', () => {
    const markdown = renderTodoMarkdown('Tasks', [
        { kind: 'project', level: 3, text: 'Indented project' },
        { kind: 'todo', level: 7, text: 'Deep task' },
        { kind: 'comment', level: 5, text: 'Sibling note' },
        { kind: 'todo', level: 1, text: 'Next root' },
      ]),
      tokens = new MarkdownIt().parse(markdown, {});

    expect(
      tokens.filter((token) => token.type === 'list_item_open').map((token) => token.level)
    ).to.deep.equal([1, 3, 3, 1]);
    expect(tokens.some((token) => token.type === 'code_block')).to.equal(false);
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

  it('escapes repeated formatting delimiters that are literal Todo text', () => {
    const markdown = renderTodoMarkdown('Tasks', [
      { kind: 'comment', level: 0, text: '**bold** ~~struck~~' },
    ]);

    expect(markdown).to.include('- \\*\\*bold\\*\\* \\~\\~struck\\~\\~');
  });

  it('preserves formatting with edge spaces and adjacent text when rendered', () => {
    const markdown = renderTodoMarkdown('Tasks', [
        {
          kind: 'comment',
          level: 0,
          text: '* bold <T> &copy; * _ italic _ ~ struck ~ _italic_2 *!!*2',
        },
      ]),
      html = new MarkdownIt({ html: true }).render(markdown);

    expect(html).to.include('<strong> bold &lt;T&gt; &amp;copy; </strong>');
    expect(html).to.include('<em> italic </em>');
    expect(html).to.include('<s> struck </s>');
    expect(html).to.include('<em>italic</em>2');
    expect(html).to.include('<strong>!!</strong>2');
  });

  it('preserves empty code spans and their significant spaces', () => {
    const markdown = renderTodoMarkdown('Tasks', [
        { kind: 'comment', level: 0, text: '`` ` ` ` code `' },
      ]),
      html = new MarkdownIt({ html: true }).render(markdown);

    expect(html).to.include('<code></code> <code> </code> <code> code </code>');
  });

  it('preserves HTML-like text and entities in rendered Markdown', () => {
    const markdown = renderTodoMarkdown('Plan <T> &copy;', [
        { kind: 'project', level: 0, text: 'Project <T> &copy;' },
        { kind: 'todo', level: 1, text: 'Document <T> and &copy;' },
        { kind: 'comment', level: 1, text: '<!-- keep this note -->' },
        {
          kind: 'comment',
          level: 1,
          text: '*Bold <T> &copy;* _Italic <T> &copy;_ ~Struck <T> &copy;~ `Code <T> &copy;`',
        },
      ]),
      html = new MarkdownIt({ html: true }).render(markdown);

    expect(html).to.include('<h1>Plan &lt;T&gt; &amp;copy;</h1>');
    expect(html).to.include('<strong>Project &lt;T&gt; &amp;copy;</strong>');
    expect(html).to.include('Document &lt;T&gt; and &amp;copy;');
    expect(html).to.include('&lt;!-- keep this note --&gt;');
    expect(html).to.include('<strong>Bold &lt;T&gt; &amp;copy;</strong>');
    expect(html).to.include('<em>Italic &lt;T&gt; &amp;copy;</em>');
    expect(html).to.include('<s>Struck &lt;T&gt; &amp;copy;</s>');
    expect(html).to.include('<code>Code &lt;T&gt; &amp;copy;</code>');
  });

  it('renders a useful empty state', () => {
    expect(renderTodoMarkdown('Empty', [])).to.equal('# Empty\n\n_No content to export._\n');
  });
});
